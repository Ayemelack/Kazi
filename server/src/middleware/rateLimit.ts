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

interface KeyedLimitOptions extends RateLimitOptions {
  now?: () => number;
}

/**
 * Counts events per key (for example, reset codes per email address) in
 * fixed windows. `hit` records one event and returns false once the key is
 * over its limit. Finished windows are swept at most once per window, so keys
 * that are never seen again don't pile up.
 */
export function keyedLimiter({ windowMs, max, now = () => Date.now() }: KeyedLimitOptions) {
  const hits = new Map<string, { count: number; resetAt: number }>();
  let nextSweep = 0;

  return {
    hit(key: string): boolean {
      const time = now();
      if (time >= nextSweep) {
        for (const [k, entry] of hits) {
          if (entry.resetAt <= time) {
            hits.delete(k);
          }
        }
        nextSweep = time + windowMs;
      }
      const current = hits.get(key);
      if (!current || current.resetAt <= time) {
        hits.set(key, { count: 1, resetAt: time + windowMs });
        return true;
      }
      current.count += 1;
      return current.count <= max;
    },
    /** Keys currently tracked (for tests). */
    size(): number {
      return hits.size;
    },
  };
}
