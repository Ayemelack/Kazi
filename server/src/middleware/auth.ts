import type { NextFunction, Request, Response } from 'express';
import type Database from 'better-sqlite3';
import jwt from 'jsonwebtoken';
import { AppError } from '../errors.js';
import { verifyAccessToken } from '../auth/jwt.js';
import { sessionUser } from '../auth/session.js';
import { recordUserSeen } from '../notifications/presence.js';

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
      // The session row is what makes a token revocable (KZ-13): logging out
      // revokes it, and a password reset deletes it. Its token_version must
      // also still match the account's, which a password reset bumps. A
      // missing session also rejects tokens for accounts that were deleted.
      const user = sessionUser(db, payload.sid, Number(payload.sub));
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
      // The account is active (migration 0009): note it, at most hourly. This
      // powers the inactivity push only; it never gates the request, and a
      // tracking failure must not turn a valid request into an error.
      try {
        recordUserSeen(db, user.id);
      } catch {
        // Best-effort by design.
      }
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