import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../errors.js';

interface RateLimitOptions {
  windowMs: number;
  max: number;
}

// Minimal in-memory rate limiter for sensitive auth endpoints. It is per
// process; acceptable for the single-instance V1 deployment.
export function rateLimit({ windowMs, max }: RateLimitOptions) {
  const hits = new Map<string, { count: number; resetAt: number }>();

  return (req: Request, _res: Response, next: NextFunction): void => {
    const key = `${req.ip ?? 'unknown'}:${req.path}`;
    const now = Date.now();
    const current = hits.get(key);

    if (!current || current.resetAt < now) {
      hits.set(key, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }

    current.count += 1;
    if (current.count > max) {
      next(
        new AppError(
          429,
          'TOO_MANY_REQUESTS',
          'Too many attempts. Please try again in a few minutes.',
        ),
      );
      return;
    }

    next();
  };
}