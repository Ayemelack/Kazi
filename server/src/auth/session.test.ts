import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import type { Server } from 'node:http';
import type Database from 'better-sqlite3';
import jwt from 'jsonwebtoken';
import { openDatabase } from '../db/index.js';
import { createApp } from '../app.js';
import { REFRESH_TOKEN_PATTERN } from './session.js';
import type { AuthResult } from './service.js';
import { issueResetCode } from './service.js';

let server: Server;
let baseUrl: string;
let db: Database.Database;

const SECRET = 'test-secret-not-for-production';

// KZ-13: server-side sessions. Each test gets a fresh database so the per-IP
// session rate limit and the session table never carry over.
beforeEach(async () => {
  process.env.JWT_SECRET = SECRET;

  db = openDatabase({ filename: ':memory:' });
  const app = createApp(db);
  server = app.listen(0);
  await new Promise<void>(resolve => server.once('listening', () => resolve()));

  const address = server.address();
  baseUrl = `http://localhost:${typeof address === 'object' && address ? address.port : 4000}`;
});

afterEach(() => {
  server.close();
  db.close();
});

async function call(
  method: string,
  path: string,
  body?: unknown,
  token?: string,
): Promise<{ status: number; data: Record<string, unknown> }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, data: text ? (JSON.parse(text) as Record<string, unknown>) : {} };
}

function codeOf(data: Record<string, unknown>): string | undefined {
  return (data.error as { code?: string } | undefined)?.code;
}

async function signup(email = 'awa@market.cm', password = 'coupe123'): Promise<AuthResult> {
  const result = await call('POST', '/auth/signup', {
    firstName: 'Awa',
    lastName: 'Nkono',
    email,
    password,
  });
  assert.equal(result.status, 201);
  return result.data as unknown as AuthResult;
}

async function logIn(email = 'awa@market.cm', password = 'coupe123'): Promise<AuthResult> {
  const result = await call('POST', '/auth/login', { email, password });
  assert.equal(result.status, 200);
  return result.data as unknown as AuthResult;
}

function sessionRows(): { id: string; user_id: number; revoked_at: number | null }[] {
  return db
    .prepare('SELECT id, user_id, revoked_at FROM sessions ORDER BY id')
    .all() as { id: string; user_id: number; revoked_at: number | null }[];
}

function userId(email: string): number {
  return (db.prepare('SELECT id FROM users WHERE email = ?').get(email) as { id: number }).id;
}

// ── Opening a session ──

test('signup opens a revocable session and returns both tokens', async () => {
  const auth = await signup();

  assert.equal(typeof auth.token, 'string');
  assert.match(auth.refreshToken, REFRESH_TOKEN_PATTERN);
  assert.equal(sessionRows().length, 1);

  const me = await call('GET', '/auth/me', undefined, auth.token);
  assert.equal(me.status, 200);
});

test('login opens its own session', async () => {
  await signup();
  const auth = await logIn();

  assert.equal(sessionRows().length, 2);
  assert.equal((await call('GET', '/auth/me', undefined, auth.token)).status, 200);
});

test('a token whose session belongs to another account is refused', async () => {
  await signup('awa@market.cm', 'coupe123');
  await signup('bello@market.cm', 'coupe456');
  const belloSession = sessionRows().find(row => row.user_id === userId('bello@market.cm'));
  assert.ok(belloSession);

  // Signed with the real secret, but user A's id on user B's session.
  const forged = jwt.sign(
    { sub: String(userId('awa@market.cm')), ver: 0, sid: belloSession.id },
    SECRET,
    { algorithm: 'HS256', expiresIn: '15m' },
  );
  const result = await call('GET', '/auth/me', undefined, forged);
  assert.equal(result.status, 401);
  assert.equal(codeOf(result.data), 'INVALID_TOKEN');
});

// ── Refresh ──

test('refresh trades the token for a new pair', async () => {
  const first = await signup();

  const second = await call('POST', '/auth/refresh', { refreshToken: first.refreshToken });
  assert.equal(second.status, 200);
  const rotated = second.data as unknown as { token: string; refreshToken: string };
  assert.notEqual(rotated.refreshToken, first.refreshToken);
  assert.match(rotated.refreshToken, REFRESH_TOKEN_PATTERN);

  assert.equal((await call('GET', '/auth/me', undefined, rotated.token)).status, 200);
  // Same session: rotating does not open another one.
  assert.equal(sessionRows().length, 1);
});

test('reusing a rotated refresh token revokes the session', async () => {
  const first = await signup();

  const second = await call('POST', '/auth/refresh', { refreshToken: first.refreshToken });
  const rotated = second.data as unknown as { token: string; refreshToken: string };

  // A second use of the token that was just rotated is treated as theft.
  const replay = await call('POST', '/auth/refresh', { refreshToken: first.refreshToken });
  assert.equal(replay.status, 401);
  assert.equal(codeOf(replay.data), 'INVALID_TOKEN');

  // The session family is gone: neither the token from the legitimate
  // rotation nor its access token works any more.
  const afterTheft = await call('POST', '/auth/refresh', { refreshToken: rotated.refreshToken });
  assert.equal(afterTheft.status, 401);
  assert.equal((await call('GET', '/auth/me', undefined, rotated.token)).status, 401);
  assert.ok(sessionRows().every(row => row.revoked_at !== null));
});

test('refresh rejects a malformed token without looking anything up', async () => {
  const result = await call('POST', '/auth/refresh', { refreshToken: 'not-a-token' });
  assert.equal(result.status, 400);
  assert.equal(codeOf(result.data), 'VALIDATION_ERROR');
  assert.equal(sessionRows().length, 0);
});

test('an expired access token is refused as TOKEN_EXPIRED and refresh recovers it', async () => {
  const auth = await signup();
  const session = sessionRows()[0];
  assert.ok(session);

  const expired = jwt.sign(
    { sub: String(userId('awa@market.cm')), ver: 0, sid: session.id },
    SECRET,
    { algorithm: 'HS256', expiresIn: -1 },
  );
  const refused = await call('GET', '/auth/me', undefined, expired);
  assert.equal(refused.status, 401);
  assert.equal(codeOf(refused.data), 'TOKEN_EXPIRED');

  const refreshed = await call('POST', '/auth/refresh', { refreshToken: auth.refreshToken });
  assert.equal(refreshed.status, 200);
  const next = refreshed.data as unknown as { token: string };
  assert.equal((await call('GET', '/auth/me', undefined, next.token)).status, 200);
});

// ── Revocation ──

test('logout revokes the session, so both tokens stop working', async () => {
  const auth = await signup();

  const logout = await call('POST', '/auth/logout', { refreshToken: auth.refreshToken });
  assert.equal(logout.status, 204);

  const me = await call('GET', '/auth/me', undefined, auth.token);
  assert.equal(me.status, 401);
  assert.equal(codeOf(me.data), 'INVALID_TOKEN');

  const refresh = await call('POST', '/auth/refresh', { refreshToken: auth.refreshToken });
  assert.equal(refresh.status, 401);
});

test('logout leaves the account\'s other sessions alone', async () => {
  const phone = await signup();
  const tablet = await logIn();

  assert.equal(
    (await call('POST', '/auth/logout', { refreshToken: phone.refreshToken })).status,
    204,
  );

  assert.equal((await call('GET', '/auth/me', undefined, phone.token)).status, 401);
  assert.equal((await call('GET', '/auth/me', undefined, tablet.token)).status, 200);
});

test('logout with no token still answers 204 and revokes nothing', async () => {
  const auth = await signup();

  const logout = await call('POST', '/auth/logout', {});
  assert.equal(logout.status, 204);
  assert.equal((await call('GET', '/auth/me', undefined, auth.token)).status, 200);
});

test('a password reset kills the refresh token as well', async () => {
  const auth = await signup();
  const issued = issueResetCode(db, 'awa@market.cm');
  assert.ok(issued);

  const reset = await call('POST', '/auth/reset-password', {
    email: 'awa@market.cm',
    code: issued.code,
    password: 'freshpass007',
  });
  assert.equal(reset.status, 200);

  const refresh = await call('POST', '/auth/refresh', { refreshToken: auth.refreshToken });
  assert.equal(refresh.status, 401);
  assert.equal((await call('GET', '/auth/me', undefined, auth.token)).status, 401);
});

test('deleting the account removes its sessions', async () => {
  const auth = await signup();

  const deleted = await call('DELETE', '/auth/me', { password: 'coupe123' }, auth.token);
  assert.equal(deleted.status, 204);
  assert.equal(sessionRows().length, 0);

  assert.equal(
    (await call('POST', '/auth/refresh', { refreshToken: auth.refreshToken })).status,
    401,
  );
});
