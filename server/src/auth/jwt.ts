import jwt from 'jsonwebtoken';

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
