import { createHmac, hkdfSync, randomInt, timingSafeEqual } from 'node:crypto';
import { RESET_CODE_LENGTH, RESET_CODE_TTL_MINUTES } from '@kazi/shared';

// Reset codes (KZ-06). A 6-digit code has only a million values, so a plain
// SHA-256 of it would be reversed in a moment by anyone who reads the
// database. The stored value is an HMAC keyed with a key derived from
// JWT_SECRET, which never lives in the database. The account id is part of the
// HMAC input, so equal codes for two accounts are stored differently.
//
// These are microsecond operations on a few bytes (like verifying a session
// JWT); the slow, worker-thread rule is for password hashing (KZ-21).

export const RESET_CODE_TTL_MS = RESET_CODE_TTL_MINUTES * 60 * 1000;

const KEY_INFO = 'kazi-reset-code';
const DIGEST_BYTES = 32;

/** Stands in for a stored hash when there is no code, so the compare still runs. */
export const NO_CODE_HASH = '0'.repeat(DIGEST_BYTES * 2);

let derived: { secret: string; key: Buffer } | null = null;

// HKDF-SHA256 with the "kazi-reset-code" label, so this key is unrelated to
// the JWT signing key even though both come from JWT_SECRET. Rotating
// JWT_SECRET therefore invalidates outstanding codes (they last 15 minutes).
function resetCodeKey(secret: string): Buffer {
  if (derived?.secret !== secret) {
    const key = Buffer.from(hkdfSync('sha256', secret, Buffer.alloc(0), KEY_INFO, DIGEST_BYTES));
    derived = { secret, key };
  }
  return derived.key;
}

/** A uniformly random code, zero-padded: "000000" to "999999". */
export function generateResetCode(): string {
  return String(randomInt(0, 10 ** RESET_CODE_LENGTH)).padStart(RESET_CODE_LENGTH, '0');
}

export function hashResetCode(userId: number, code: string, secret: string): string {
  return createHmac('sha256', resetCodeKey(secret)).update(`${userId}:${code}`).digest('hex');
}

/** Constant-time comparison of `code` against a stored hash. */
export function resetCodeMatches(
  userId: number,
  code: string,
  storedHash: string,
  secret: string,
): boolean {
  const expected = Buffer.from(storedHash, 'hex');
  const actual = Buffer.from(hashResetCode(userId, code, secret), 'hex');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
