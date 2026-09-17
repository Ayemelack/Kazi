import { createHash, randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';

const TOKEN_TTL_MS = 1000 * 60 * 30; // 30 minutes

export interface TokenPayload {
  sub: string;
  ver: number;
}

// The access token carries the user's token_version (ver). Every password
// reset bumps that version, so any token minted before the reset stops being
// accepted by the server. This makes a stolen session token non-recoverable
// once the account holder changes their password.
export function signAccessToken(
  userId: number,
  version: number,
  secret: string,
): string {
  return jwt.sign(
    { sub: String(userId), ver: version },
    secret,
    { expiresIn: '30d', algorithm: 'HS256' },
  );
}

export function verifyAccessToken(token: string, secret: string): TokenPayload {
  // The algorithm is pinned to HS256. Accepting an arbitrary alg from the
  // token header (for example an attacker-set "none") is an algorithm
  // confusion/bypass vector, so it must never be honored.
  const decoded = jwt.verify(token, secret, {
    algorithms: ['HS256'],
  }) as jwt.JwtPayload & TokenPayload;
  if (typeof decoded.sub !== 'string' || typeof decoded.ver !== 'number') {
    throw new Error('Invalid token payload');
  }
  return { sub: decoded.sub, ver: decoded.ver };
}

// The reset code is unique, short-lived and single-use. Only its SHA-256 digest
// is stored, so a database leak never exposes active reset codes.
export function createResetToken(): { token: string; expiresAt: number } {
  const token = randomBytes(24).toString('hex');
  return { token, expiresAt: Date.now() + TOKEN_TTL_MS };
}

export function hashResetToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}