import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { AppError } from '../errors.js';

// In-memory, fixed-window rate limiting (KZ-08). Per process: acceptable for
// the single-instance deployment (SECURITY.md §6); a second instance needs a
// shared store.

export const DEFAULT_MAX_KEYS = 10_000;
const SWEEP_INTERVAL_MS = 60_000;

const TOO_MANY = 'Too many attempts. Please try again in a few minutes.';

export interface LimiterOptions {
  windowMs: number;
  /** Events allowed per key in one window. */
  max: number;
  /** Most keys tracked at once; beyond it the oldest window is dropped. */
  maxKeys?: number;
  /** Clock, for tests. */
  now?: () => number;
}

export interface Verdict {
  allowed: boolean;
  /** Whole seconds until the key's window ends (0 when allowed). */
  retryAfterSeconds: number;
}

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * Counts events per key in fixed windows. Every window of one limiter has the
 * same length, and a bucket is (re)inserted when its window starts, so the
 * map's insertion order is also expiry order: the first entry is always the
 * oldest. That makes eviction and sweeping cheap. A timer sweeps expired
 * buckets every minute; it is unref'd so it never keeps the process alive.
 */
export class FixedWindowLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private readonly windowMs: number;
  private readonly max: number;
  private readonly maxKeys: number;
  private readonly now: () => number;
  private readonly timer: NodeJS.Timeout;

  constructor({ windowMs, max, maxKeys = DEFAULT_MAX_KEYS, now = () => Date.now() }: LimiterOptions) {
    this.windowMs = windowMs;
    this.max = max;
    this.maxKeys = maxKeys;
    this.now = now;
    this.timer = setInterval(() => this.sweep(), SWEEP_INTERVAL_MS);
    this.timer.unref();
  }

  /** Records one event for `key`; refused once the key is over its limit. */
  hit(key: string): Verdict {
    const time = this.now();
    let bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= time) {
      // Delete first so a renewed window moves to the end of the order.
      this.buckets.delete(key);
      bucket = { count: 0, resetAt: time + this.windowMs };
      this.buckets.set(key, bucket);
      this.evictOverflow();
    }
    bucket.count += 1;
    return this.verdict(bucket, bucket.count <= this.max, time);
  }

  /** Whether one more event would be allowed, without recording it. */
  peek(key: string): Verdict {
    const time = this.now();
    const bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= time) {
      return { allowed: true, retryAfterSeconds: 0 };
    }
    return this.verdict(bucket, bucket.count < this.max, time);
  }

  /** Forgets a key (for example after a successful login). */
  reset(key: string): void {
    this.buckets.delete(key);
  }

  /** Drops every bucket whose window has ended. */
  sweep(): void {
    const time = this.now();
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt > time) {
        break; // the rest are newer
      }
      this.buckets.delete(key);
    }
  }

  /** Keys currently tracked. */
  get size(): number {
    return this.buckets.size;
  }

  /** Stops the sweep timer. */
  stop(): void {
    clearInterval(this.timer);
  }

  private evictOverflow(): void {
    while (this.buckets.size > this.maxKeys) {
      const oldest = this.buckets.keys().next();
      if (oldest.done) {
        return;
      }
      this.buckets.delete(oldest.value);
    }
  }

  private verdict(bucket: Bucket, allowed: boolean, time: number): Verdict {
    return {
      allowed,
      retryAfterSeconds: allowed ? 0 : Math.max(1, Math.ceil((bucket.resetAt - time) / 1000)),
    };
  }
}

/**
 * The 429 for a refused verdict, with `Retry-After` set on the response. The
 * caller passes it to next() or throws it.
 */
export function tooManyRequests(res: Response, verdict: Verdict, message = TOO_MANY): AppError {
  res.setHeader('Retry-After', String(verdict.retryAfterSeconds));
  return new AppError(429, 'TOO_MANY_REQUESTS', message);
}

export interface RateLimitOptions extends LimiterOptions {
  /** The bucket a request counts against; null means it is not counted. */
  key: (req: Request) => string | null;
}

/** Express middleware over a FixedWindowLimiter. */
export function rateLimit({ key, ...options }: RateLimitOptions): RequestHandler {
  const limiter = new FixedWindowLimiter(options);
  return (req: Request, res: Response, next: NextFunction): void => {
    const bucket = key(req);
    if (bucket === null) {
      next();
      return;
    }
    const verdict = limiter.hit(bucket);
    next(verdict.allowed ? undefined : tooManyRequests(res, verdict));
  };
}

/** Key: the client address. Behind a proxy this is only right with `trust proxy` set (app.ts). */
export function byIp(req: Request): string {
  return req.ip ?? req.socket.remoteAddress ?? 'unknown';
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Key: the signed-in user, for requests that change data. Use after requireAuth. */
export function byUserWrite(req: Request): string | null {
  if (SAFE_METHODS.has(req.method) || !req.user) {
    return null;
  }
  return String(req.user.id);
}
