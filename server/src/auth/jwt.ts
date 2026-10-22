import jwt from 'jsonwebtoken';
import { AppError } from '../errors.js';

export interface TokenPayload {
  sub: string;
  ver: number;
  /** The server-side session this token belongs to (KZ-13). */
  sid: string;
}

// KZ-13: access tokens are short-lived because they cannot be withdrawn before
// they expire; the refresh token (auth/session.ts) keeps the user signed in.
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;

// The access token carries the user's token_version (ver) and session id
// (sid). A password reset bumps the version, and logging out revokes the
// session, so a stolen token stops being accepted without waiting out its
// 15 minutes.
export function signAccessToken(
  userId: number,
  version: number,
  sessionId: string,
  secret: string,
): string {
  return jwt.sign(
    { sub: String(userId), ver: version, sid: sessionId },
    secret,
    { expiresIn: ACCESS_TOKEN_TTL_SECONDS, algorithm: 'HS256' },
  );
}

export function verifyAccessToken(token: string, secret: string): TokenPayload {
  // The algorithm is pinned to HS256. Accepting an arbitrary alg from the
  // token header (for example an attacker-set "none") is an algorithm
  // confusion/bypass vector, so it must never be honored.
  const decoded = jwt.verify(token, secret, {
    algorithms: ['HS256'],
  }) as jwt.JwtPayload & TokenPayload;
  if (
    typeof decoded.sub !== 'string' ||
    typeof decoded.ver !== 'number' ||
    typeof decoded.sid !== 'string'
  ) {
    throw new Error('Invalid token payload');
  }
  return { sub: decoded.sub, ver: decoded.ver, sid: decoded.sid };
}

/** The signing secret, or a 500 for a server that was started misconfigured. */
export function accessTokenSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new AppError(500, 'INTERNAL', 'Server is missing the JWT secret.');
  }
  return secret;
}
