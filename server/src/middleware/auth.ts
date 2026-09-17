import type { NextFunction, Request, Response } from 'express';
import type Database from 'better-sqlite3';
import jwt from 'jsonwebtoken';
import { AppError } from '../errors.js';
import { verifyAccessToken } from '../auth/jwt.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: { id: number };
    }
  }
}

export function requireAuth(db: Database.Database) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      next(new AppError(401, 'UNAUTHORIZED', 'Authentication required.'));
      return;
    }

    const token = header.slice('Bearer '.length).trim();
    let secret: string;
    try {
      secret = process.env.JWT_SECRET ?? (() => { throw new Error('missing'); })();
    } catch {
      next(new AppError(500, 'INTERNAL', 'Server is missing the JWT secret.'));
      return;
    }

    try {
      const payload = verifyAccessToken(token, secret);
      // The token is only valid while its version matches the account's
      // current token_version. A password reset bumps the version, which
      // invalidates every previously issued token. This lookup also rejects
      // tokens for accounts that have been deleted.
      const user = db
        .prepare('SELECT id, token_version FROM users WHERE id = ?')
        .get(Number(payload.sub)) as
        | { id: number; token_version: number }
        | undefined;
      if (!user || payload.ver !== user.token_version) {
        next(
          new AppError(
            401,
            'INVALID_TOKEN',
            'Your session is invalid. Sign in again.',
          ),
        );
        return;
      }
      req.user = { id: user.id };
    } catch (err) {
      if (err instanceof jwt.TokenExpiredError) {
        next(new AppError(401, 'TOKEN_EXPIRED', 'Your session has expired. Sign in again.'));
        return;
      }
      next(new AppError(401, 'INVALID_TOKEN', 'Your session is invalid. Sign in again.'));
      return;
    }

    next();
  };
}