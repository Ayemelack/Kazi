import { createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';
import type Database from 'better-sqlite3';
import { AppError } from '../errors.js';
import { accessTokenSecret, signAccessToken } from './jwt.js';

// KZ-13: revocable sessions.
//
// The access token lasts 15 minutes and can't be withdrawn, so the app also
// holds a refresh token. Refreshing rotates that token, so each one works
// once; a second use of an already-rotated token is treated as theft and
// revokes the session. Only an HMAC of the refresh token's secret is stored,
// so a database leak does not yield working sessions.
//
// A refresh token is "<session id>.<secret>". The id travels in the token so a
// lookup can find the row without scanning, and the id is part of the HMAC
// input so the stored hash is bound to its session.

// A session lives 60 days (the old token lifetime) and ends earlier when it is
// revoked: by logout, by a password reset, or by refresh-token reuse.
export const SESSION_TTL_MS = 60 * 24 * 60 * 60 * 1000;

const SESSION_ID_HEX_LENGTH = 32;
const REFRESH_SECRET_HEX_LENGTH = 64;
const KEY_INFO = 'kazi-refresh-token';
const DIGEST_BYTES = 32;

export const REFRESH_TOKEN_PATTERN = new RegExp(
  `^[0-9a-f]{${SESSION_ID_HEX_LENGTH}}\\.[0-9a-f]{${REFRESH_SECRET_HEX_LENGTH}}$`,
);

export interface SessionTokens {
  token: string;
  refreshToken: string;
}

export interface RotatedSession extends SessionTokens {
  userId: number;
}

let derived: { secret: string; key: Buffer } | null = null;

// HKDF-SHA256 with the "kazi-refresh-token" label, so this key is unrelated to
// the JWT signing key and to the reset-code key even though all come from
// JWT_SECRET.
function refreshKey(secret: string): Buffer {
  if (derived?.secret !== secret) {
    const key = Buffer.from(hkdfSync('sha256', secret, Buffer.alloc(0), KEY_INFO, DIGEST_BYTES));
    derived = { secret, key };
  }
  return derived.key;
}

function hashRefreshToken(sessionId: string, secret: string, key: string): string {
  return createHmac('sha256', refreshKey(key)).update(`${sessionId}:${secret}`).digest('hex');
}

function hashesMatch(a: string, b: string): boolean {
  const expected = Buffer.from(a, 'hex');
  const actual = Buffer.from(b, 'hex');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function invalidSession(): AppError {
  return new AppError(401, 'INVALID_TOKEN', 'Your session is invalid. Sign in again.');
}

function parseRefreshToken(token: string): { sessionId: string; secret: string } | null {
  if (typeof token !== 'string' || !REFRESH_TOKEN_PATTERN.test(token)) {
    return null;
  }
  const [sessionId, secret] = token.split('.') as [string, string];
  return { sessionId, secret };
}

function newRefreshToken(sessionId: string): { token: string; hash: string } {
  const secret = randomBytes(REFRESH_SECRET_HEX_LENGTH / 2).toString('hex');
  return {
    token: `${sessionId}.${secret}`,
    hash: hashRefreshToken(sessionId, secret, accessTokenSecret()),
  };
}

/** Drops rows that can no longer be used, so the table stays small. */
export function deleteDeadSessions(db: Database.Database, now = Date.now()): void {
  db.prepare('DELETE FROM sessions WHERE expires_at <= ? OR revoked_at IS NOT NULL').run(now);
}

/** Opens a session and returns its first token pair. */
export function startSession(
  db: Database.Database,
  user: { id: number; token_version: number },
  now = Date.now(),
): SessionTokens {
  const key = accessTokenSecret();
  const sessionId = randomBytes(SESSION_ID_HEX_LENGTH / 2).toString('hex');
  const refresh = newRefreshToken(sessionId);
  db.prepare(
    `INSERT INTO sessions (id, user_id, refresh_hash, created_at, last_used_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(sessionId, user.id, refresh.hash, now, now, now + SESSION_TTL_MS);
  return {
    token: signAccessToken(user.id, user.token_version, sessionId, key),
    refreshToken: refresh.token,
  };
}

/**
 * Exchanges a refresh token for a new pair, rotating the stored hash. Throws
 * INVALID_TOKEN for an unknown, expired or revoked session, and revokes the
 * session when a token that was already rotated comes back.
 */
export function rotateSession(
  db: Database.Database,
  refreshToken: string,
  now = Date.now(),
): RotatedSession {
  const parsed = parseRefreshToken(refreshToken);
  if (!parsed) {
    throw invalidSession();
  }
  const key = accessTokenSecret();

  const rotated = db.transaction((): RotatedSession | null => {
    const row = db
      .prepare(
        'SELECT id, user_id, refresh_hash, expires_at, revoked_at FROM sessions WHERE id = ?',
      )
      .get(parsed.sessionId) as
      | {
          id: string;
          user_id: number;
          refresh_hash: string;
          expires_at: number;
          revoked_at: number | null;
        }
      | undefined;
    if (!row || row.revoked_at !== null || row.expires_at <= now) {
      return null;
    }
    if (!hashesMatch(hashRefreshToken(row.id, parsed.secret, key), row.refresh_hash)) {
      // The right session, but a token it no longer honours: either a stale
      // copy or a stolen one. Ending the session also ends the legitimate
      // copy's access, which is the safe side of that ambiguity.
      db.prepare('UPDATE sessions SET revoked_at = ? WHERE id = ?').run(now, row.id);
      return null;
    }
    const user = db
      .prepare('SELECT id, token_version FROM users WHERE id = ?')
      .get(row.user_id) as { id: number; token_version: number } | undefined;
    if (!user) {
      return null;
    }
    const next = newRefreshToken(row.id);
    db.prepare('UPDATE sessions SET refresh_hash = ?, last_used_at = ? WHERE id = ?').run(
      next.hash,
      now,
      row.id,
    );
    return {
      userId: user.id,
      token: signAccessToken(user.id, user.token_version, row.id, key),
      refreshToken: next.token,
    };
  })();

  if (!rotated) {
    throw invalidSession();
  }
  return rotated;
}

/**
 * Revokes the session a refresh token belongs to. Best effort and silent: a
 * logout must succeed even when the token is old, and must not reveal whether
 * a session existed. Returns whether a session was revoked.
 */
export function revokeSession(
  db: Database.Database,
  refreshToken: string,
  now = Date.now(),
): boolean {
  const parsed = parseRefreshToken(refreshToken);
  if (!parsed) {
    return false;
  }
  const key = accessTokenSecret();
  const row = db
    .prepare('SELECT id, refresh_hash, revoked_at FROM sessions WHERE id = ?')
    .get(parsed.sessionId) as
    | { id: string; refresh_hash: string; revoked_at: number | null }
    | undefined;
  if (!row || row.revoked_at !== null) {
    return false;
  }
  if (!hashesMatch(hashRefreshToken(row.id, parsed.secret, key), row.refresh_hash)) {
    return false;
  }
  db.prepare('UPDATE sessions SET revoked_at = ? WHERE id = ?').run(now, row.id);
  return true;
}

/** Revokes every session of the account (password reset, sign out everywhere). */
export function revokeAllSessions(
  db: Database.Database,
  userId: number,
  now = Date.now(),
): void {
  db.prepare('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL').run(
    now,
    userId,
  );
}

/**
 * The account a live session belongs to, for requireAuth. Returns null unless
 * the session matches this exact user, is unrevoked and has not expired.
 */
export function sessionUser(
  db: Database.Database,
  sessionId: string,
  userId: number,
  now = Date.now(),
): { id: number; token_version: number } | null {
  const row = db
    .prepare(
      `SELECT u.id AS id, u.token_version AS token_version
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.id = ? AND s.revoked_at IS NULL AND s.expires_at > ?`,
    )
    .get(sessionId, now) as { id: number; token_version: number } | undefined;
  return row && row.id === userId ? row : null;
}
