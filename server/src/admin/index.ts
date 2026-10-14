import crypto from 'node:crypto';
import https from 'node:https';
import type { Server } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type NextFunction, type Request, type Response } from 'express';
import Database from 'better-sqlite3';
import {
  getActivity,
  getFeedback,
  getSeries,
  getStats,
  getUsers,
} from './data.js';
import { parseCookies } from './cookies.js';
import { loadCredentials, verifyPassword, type StoredCredentials } from './credentials.js';
import { ensureCertificate, lanAddresses, readTlsMaterial, type TlsMaterial } from './tls.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const COOKIE_NAME = 'kazi_admin_session';
const PUBLIC_DIR = path.join(__dirname, 'public');
// The built @kazi/shared package (pure ES modules, no secrets), served so the
// dashboard formats money with the app's own formatMoney (KZ-25).
const SHARED_DIR = path.dirname(fileURLToPath(import.meta.resolve('@kazi/shared')));

type TlsMode = 'auto' | 'on' | 'off';

interface Config {
  host: string;
  port: number;
  databasePath: string;
  credentialsPath: string;
  sessionTtlMs: number;
  cookieSecure: boolean;
  tlsMode: TlsMode;
  tlsDir: string;
  tlsCertPath: string;
  tlsKeyPath: string;
  tlsOpensslPath?: string;
  tlsHosts: string[];
}

function parseTlsMode(value: string | undefined): TlsMode {
  if (value === '1' || value === 'on' || value === 'true') {
    return 'on';
  }
  if (value === '0' || value === 'off' || value === 'false') {
    return 'off';
  }
  return 'auto';
}

function loadConfig(): Config {
  const serverRoot = path.join(__dirname, '..', '..');
  const tlsDir = path.join(serverRoot, 'data', 'admin-tls');
  return {
    host: process.env.ADMIN_HOST?.trim() || '127.0.0.1',
    port: Number(process.env.ADMIN_PORT ?? 4100),
    databasePath:
      process.env.DATABASE_PATH ?? path.join(serverRoot, 'data', 'kazi.db'),
    credentialsPath:
      process.env.ADMIN_CREDENTIALS_PATH ??
      path.join(serverRoot, 'data', 'admin-auth.json'),
    sessionTtlMs: Number(process.env.ADMIN_SESSION_TTL_MS ?? 12 * 60 * 60 * 1000),
    cookieSecure: process.env.ADMIN_COOKIE_SECURE === '1',
    tlsMode: parseTlsMode(process.env.ADMIN_TLS),
    tlsDir,
    tlsCertPath: process.env.ADMIN_TLS_CERT ?? path.join(tlsDir, 'cert.pem'),
    tlsKeyPath: process.env.ADMIN_TLS_KEY ?? path.join(tlsDir, 'key.pem'),
    tlsOpensslPath: process.env.ADMIN_TLS_OPENSSL,
    tlsHosts: (process.env.ADMIN_TLS_HOSTS ?? '')
      .split(',')
      .map((host) => host.trim())
      .filter((host) => host.length > 0),
  };
}


interface Session {
  token: string;
  username: string;
  expiresAt: number;
}

class SessionStore {
  private readonly sessions = new Map<string, Session>();

  constructor(private readonly ttlMs: number) {}

  create(username: string): Session {
    const token = crypto.randomBytes(32).toString('base64url');
    const session: Session = { token, username, expiresAt: Date.now() + this.ttlMs };
    this.sessions.set(token, session);
    return session;
  }

  get(token: string | undefined): Session | undefined {
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

class LoginThrottle {
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

function buildApp(
  db: Database.Database,
  credentials: StoredCredentials,
  sessions: SessionStore,
  throttle: LoginThrottle,
  config: Config,
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
  app.use('/shared', express.static(SHARED_DIR, { index: false, etag: false }));

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

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Not found.' });
  });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
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

function reachableUrls(scheme: string, host: string, port: number): string[] {
  if (host !== '0.0.0.0' && host !== '::') {
    return [`${scheme}://${host}:${port}`];
  }
  const addresses = lanAddresses();
  return addresses.length > 0
    ? addresses.map((address) => `${scheme}://${address}:${port}`)
    : [`${scheme}://localhost:${port}`];
}

function resolveTls(config: Config): TlsMaterial | undefined {
  if (config.tlsMode === 'off') {
    return undefined;
  }
  try {
    ensureCertificate({
      dir: config.tlsDir,
      certFile: config.tlsCertPath,
      keyFile: config.tlsKeyPath,
      hosts: ['localhost', '127.0.0.1', ...lanAddresses(), ...config.tlsHosts],
      opensslPath: config.tlsOpensslPath,
    });
    return readTlsMaterial(config.tlsCertPath, config.tlsKeyPath);
  } catch (err) {
    if (config.tlsMode === 'on') {
      throw err;
    }
    console.warn(
      '[admin] HTTPS unavailable, falling back to HTTP:',
      err instanceof Error ? err.message : err,
    );
    return undefined;
  }
}

function main(): void {
  const config = loadConfig();

  const loaded = loadCredentials(config.credentialsPath);

  let db: Database.Database;
  try {
    db = new Database(config.databasePath, { readonly: true, fileMustExist: true });
    db.pragma('query_only = ON');
  } catch (err) {
    console.error(`[admin] could not open database read-only at ${config.databasePath}`);
    console.error(err);
    process.exit(1);
  }

  const tls = resolveTls(config);
  config.cookieSecure = tls
    ? process.env.ADMIN_COOKIE_SECURE !== '0'
    : process.env.ADMIN_COOKIE_SECURE === '1';
  const scheme = tls ? 'https' : 'http';

  const sessions = new SessionStore(config.sessionTtlMs);
  const throttle = new LoginThrottle();
  const app = buildApp(db, loaded.credentials, sessions, throttle, config);

  const onReady = (): void => {
    const urls = reachableUrls(scheme, config.host, config.port);
    console.log('============================================================');
    console.log(` Kazi Admin dashboard (${tls ? 'HTTPS' : 'HTTP'})`);
    for (const url of urls) {
      console.log(`   URL:      ${url}`);
    }
    console.log(`   Bind:     ${config.host}:${config.port}`);
    console.log(`   Username: ${loaded.credentials.username}`);
    if (loaded.generatedPassword) {
      console.log(`   Password: ${loaded.generatedPassword}`);
      console.log('   (generated on first run and shown once; a hash is stored in');
      console.log(`    ${config.credentialsPath})`);
    } else {
      console.log(`   Password: ${loaded.source === 'env' ? 'from ADMIN_PASSWORD' : 'from credentials file'}`);
    }
    console.log('   Read-only database:', config.databasePath);
    if (tls) {
      console.log(`   Certificate: ${config.tlsCertPath}`);
      console.log('   Self-signed: your browser will warn once; choose "Advanced"');
      console.log('   and proceed. The connection is still encrypted.');
    }
    console.log('   This dashboard is separate from the app. App user tokens are');
    console.log('   not accepted here and app users have no access.');
    console.log('============================================================');
  };

  const server: Server = tls
    ? https
        .createServer({ key: tls.key, cert: tls.cert }, app)
        .listen(config.port, config.host, onReady)
    : app.listen(config.port, config.host, onReady);

  const shutdown = (): void => {
    server.close(() => {
      db.close();
      process.exit(0);
    });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main();
