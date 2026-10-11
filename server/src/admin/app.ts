import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type NextFunction, type Request, type Response } from 'express';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import {
  getActivity,
  getFeedback,
  getSeries,
  getStats,
  getUsers,
} from './data.js';
import { verifyPassword, type StoredCredentials } from './credentials.js';
import {
  clearAnnouncement,
  getActiveAnnouncement,
  upsertAnnouncement,
} from '../announcements/service.js';
import { announcementWriteSchema, validate } from '../announcements/validation.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const COOKIE_NAME = 'kazi_admin_session';
const PUBLIC_DIR = path.join(__dirname, 'public');

export interface AdminConfig {
  sessionTtlMs: number;
  cookieSecure: boolean;
}

interface AdminSession {
  token: string;
  username: string;
  expiresAt: number;
}

export class SessionStore {
  private readonly sessions = new Map<string, AdminSession>();

  constructor(private readonly ttlMs: number) {}

  create(username: string): AdminSession {
    const token = crypto.randomBytes(32).toString('base64url');
    const session: AdminSession = { token, username, expiresAt: Date.now() + this.ttlMs };
    this.sessions.set(token, session);
    return session;
  }

  get(token: string | undefined): AdminSession | undefined {
    if (!token) {
      return undefined;
    }
    const session = this.sessions.get(token);
    if (!session) {
      return undefined;
    }
    if (session.expiresAt <= Date.now()) {
      this.sessions.delete(token);
      return undefined;
    }
    return session;
  }

  destroy(token: string | undefined): void {
    if (token) {
      this.sessions.delete(token);
    }
  }
}

export class LoginThrottle {
  private readonly perKey = new Map<string, { count: number; resetAt: number }>();
  private global = { count: 0, resetAt: 0 };

  constructor(
    private readonly maxPerKey = 8,
    private readonly maxGlobal = 50,
    private readonly windowMs = 15 * 60 * 1000,
  ) {}

  private active(bucket: { count: number; resetAt: number }): boolean {
    return bucket.resetAt > Date.now();
  }

  check(key: string): { allowed: boolean; retryAfterMs: number } {
    const now = Date.now();
    if (!this.active(this.global)) {
      this.global = { count: 0, resetAt: now + this.windowMs };
    }
    // The global cap is checked first and for every key, including a key seen
    // for the first time; otherwise rotating source IPs would walk straight
    // past the per-process ceiling.
    if (this.global.count >= this.maxGlobal) {
      return { allowed: false, retryAfterMs: Math.max(this.global.resetAt - now, 0) };
    }
    const bucket = this.perKey.get(key);
    if (!bucket || !this.active(bucket)) {
      return { allowed: true, retryAfterMs: 0 };
    }
    if (bucket.count >= this.maxPerKey) {
      return { allowed: false, retryAfterMs: Math.max(bucket.resetAt - now, 0) };
    }
    return { allowed: true, retryAfterMs: 0 };
  }

  fail(key: string): void {
    const now = Date.now();
    const bucket = this.perKey.get(key);
    if (!bucket || !this.active(bucket)) {
      this.perKey.set(key, { count: 1, resetAt: now + this.windowMs });
    } else {
      bucket.count += 1;
    }
    this.global.count += 1;
  }

  reset(key: string): void {
    this.perKey.delete(key);
  }
}

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) {
    return out;
  }
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) {
      continue;
    }
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) {
      out[key] = decodeURIComponent(value);
    }
  }
  return out;
}

function sessionCookie(token: string, maxAgeSeconds: number, secure: boolean): string {
  const attrs = [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    'HttpOnly',
    'Path=/',
    'SameSite=Strict',
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (secure) {
    attrs.push('Secure');
  }
  return attrs.join('; ');
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) {
    return false;
  }
  return crypto.timingSafeEqual(left, right);
}

// The admin dashboard reads most tables through a read-only connection opened
// at startup, but the announcement slot is written by admins, so a separate
// writable handle is passed in alongside it.
export function buildApp(
  db: Database.Database,
  writeDb: Database.Database,
  credentials: StoredCredentials,
  sessions: SessionStore,
  throttle: LoginThrottle,
  config: AdminConfig,
): express.Express {
  const app = express();
  app.disable('x-powered-by');

  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    // Authenticated responses must never be written to a shared cache.
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    );
    next();
  });

  app.use(express.json({ limit: '64kb' }));

  app.use(express.static(PUBLIC_DIR, { index: 'index.html', etag: false }));

  const requireAdmin = (req: Request, res: Response, next: NextFunction): void => {
    const cookies = parseCookies(req.headers.cookie);
    const session = sessions.get(cookies[COOKIE_NAME]);
    if (!session) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    next();
  };

  const requireSameOriginPost = (req: Request, res: Response, next: NextFunction): void => {
    if (req.method !== 'POST') {
      next();
      return;
    }
    if (req.get('x-admin-request') !== '1') {
      res.status(400).json({ error: 'Missing request header.' });
      return;
    }
    next();
  };

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.get('/api/session', (req, res) => {
    const cookies = parseCookies(req.headers.cookie);
    const session = sessions.get(cookies[COOKIE_NAME]);
    if (!session) {
      res.status(401).json({ authenticated: false });
      return;
    }
    res.json({ authenticated: true, username: session.username });
  });

  app.post('/api/login', requireSameOriginPost, (req, res) => {
    const key = req.ip ?? req.socket.remoteAddress ?? 'unknown';
    const gate = throttle.check(key);
    if (!gate.allowed) {
      res.setHeader('Retry-After', Math.ceil(gate.retryAfterMs / 1000).toString());
      res.status(429).json({ error: 'Too many attempts. Try again later.' });
      return;
    }

    const body = req.body as { username?: unknown; password?: unknown };
    const username = typeof body.username === 'string' ? body.username : '';
    const password = typeof body.password === 'string' ? body.password : '';

    const usernameOk = safeEqual(username, credentials.username);
    const passwordOk = verifyPassword(password, credentials);

    if (!usernameOk || !passwordOk) {
      throttle.fail(key);
      res.status(401).json({ error: 'Invalid username or password.' });
      return;
    }

    throttle.reset(key);
    const session = sessions.create(credentials.username);
    res.setHeader(
      'Set-Cookie',
      sessionCookie(session.token, Math.floor(config.sessionTtlMs / 1000), config.cookieSecure),
    );
    res.json({ authenticated: true, username: session.username });
  });

  app.post('/api/logout', requireSameOriginPost, (req, res) => {
    const cookies = parseCookies(req.headers.cookie);
    sessions.destroy(cookies[COOKIE_NAME]);
    res.setHeader('Set-Cookie', sessionCookie('', 0, config.cookieSecure));
    res.json({ authenticated: false });
  });

  app.get('/api/stats', requireAdmin, (_req, res) => {
    res.json(getStats(db));
  });

  app.get('/api/series', requireAdmin, (req, res) => {
    const requested = Number(req.query.days ?? 30);
    const days = Number.isFinite(requested) ? Math.min(Math.max(Math.trunc(requested), 7), 90) : 30;
    res.json(getSeries(db, days));
  });

  app.get('/api/activity', requireAdmin, (req, res) => {
    const requested = Number(req.query.limit ?? 100);
    const limit = Number.isFinite(requested) ? Math.min(Math.max(Math.trunc(requested), 1), 500) : 100;
    res.json({ items: getActivity(db, limit) });
  });

  app.get('/api/feedback', requireAdmin, (req, res) => {
    const requested = Number(req.query.limit ?? 200);
    const limit = Number.isFinite(requested) ? Math.min(Math.max(Math.trunc(requested), 1), 500) : 200;
    res.json({ items: getFeedback(db, limit) });
  });

  app.get('/api/users', requireAdmin, (req, res) => {
    const requested = Number(req.query.limit ?? 200);
    const limit = Number.isFinite(requested) ? Math.min(Math.max(Math.trunc(requested), 1), 500) : 200;
    res.json({ items: getUsers(db, limit) });
  });

  app.get('/api/announcements', requireAdmin, (_req, res, next) => {
    try {
      res.json({ announcement: getActiveAnnouncement(writeDb) });
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/announcements', requireAdmin, requireSameOriginPost, (req, res, next) => {
    try {
      const input = validate(announcementWriteSchema, req.body);
      res.json({ announcement: upsertAnnouncement(writeDb, input) });
    } catch (err) {
      next(err);
    }
  });

  app.delete('/api/announcements', requireAdmin, requireSameOriginPost, (_req, res, next) => {
    try {
      clearAnnouncement(writeDb);
      res.json({ announcement: null });
    } catch (err) {
      next(err);
    }
  });

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Not found.' });
  });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: 'Invalid request.' });
      return;
    }
    const status = (err as { status?: number }).status ?? 500;
    if (status >= 500) {
      console.error('[admin] request failed:', err);
      res.status(500).json({ error: 'Internal server error.' });
      return;
    }
    res.status(status).json({ error: 'Invalid request.' });
  });

  return app;
}