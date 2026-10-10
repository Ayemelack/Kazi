import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { Server } from 'node:http';
import type Database from 'better-sqlite3';
import { openDatabase } from '../db/index.js';
import { createApp } from '../app.js';

let server: Server;
let baseUrl: string;
let db: Database.Database;

before(async () => {
  process.env.JWT_SECRET = 'test-secret-not-for-production';

  db = openDatabase({ filename: ':memory:' });
  const app = createApp(db);
  server = app.listen(0);
  await new Promise<void>(resolve => server.once('listening', () => resolve()));

  const address = server.address();
  baseUrl = `http://localhost:${typeof address === 'object' && address ? address.port : 4000}`;
});

after(() => {
  server.close();
});

async function call(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; data: Record<string, unknown> }> {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, data: text ? (JSON.parse(text) as Record<string, unknown>) : {} };
}

function errorCode(data: Record<string, unknown>): string {
  return (data.error as { code?: string } | undefined)?.code ?? '';
}

async function signup(email: string, password: string): Promise<void> {
  const result = await call('POST', '/auth/signup', {
    firstName: 'Kazi',
    lastName: 'Tester',
    email,
    password,
  });
  assert.equal(result.status, 201, `signup ${email}`);
}

function fingerprintCount(userId: number): number {
  const row = db
    .prepare('SELECT COUNT(*) AS count FROM password_fingerprints WHERE user_id = ?')
    .get(userId) as { count: number };
  return row.count;
}

function userIdFor(email: string): number {
  const row = db.prepare('SELECT id FROM users WHERE email = ?').get(email) as
    | { id: number }
    | undefined;
  assert.ok(row, `user ${email} exists`);
  return row.id;
}

test('a password reset refuses a password another account already uses', async () => {
  await signup('owner@market.cm', 'ownerPass2026');
  await signup('keeper@market.cm', 'keeperPass2026');

  const requested = await call('POST', '/auth/forgot-password', {
    email: 'keeper@market.cm',
    firstName: 'Kazi',
    lastName: 'Tester',
  });
  assert.equal(requested.status, 200);
  const resetToken = (requested.data as { resetToken: string }).resetToken;

  const reuse = await call('POST', '/auth/reset-password', {
    token: resetToken,
    password: 'ownerPass2026',
  });
  assert.equal(reuse.status, 400);
  assert.equal(errorCode(reuse.data), 'PASSWORD_NOT_ALLOWED');

  // The rejected attempt must leave the account exactly as it was.
  const keptOld = await call('POST', '/auth/login', {
    email: 'keeper@market.cm',
    password: 'keeperPass2026',
  });
  assert.equal(keptOld.status, 200);
});

test('a sign-in records the password so a later account cannot reuse it', async () => {
  await signup('legacy@market.cm', 'legacyPass2026');
  const legacyId = userIdFor('legacy@market.cm');

  // Simulate an account that predates password fingerprinting: it authenticated
  // once at signup but never contributed a fingerprint.
  db.prepare('DELETE FROM password_fingerprints WHERE user_id = ?').run(legacyId);
  assert.equal(fingerprintCount(legacyId), 0);

  const wrongPassword = await call('POST', '/auth/login', {
    email: 'legacy@market.cm',
    password: 'wrong-password-1',
  });
  assert.equal(wrongPassword.status, 401);
  assert.equal(fingerprintCount(legacyId), 0, 'a failed sign-in records nothing');

  const login = await call('POST', '/auth/login', {
    email: 'legacy@market.cm',
    password: 'legacyPass2026',
  });
  assert.equal(login.status, 200);
  assert.equal(fingerprintCount(legacyId), 1, 'a verified sign-in records the fingerprint');

  const reuse = await call('POST', '/auth/signup', {
    firstName: 'Copy',
    lastName: 'Cat',
    email: 'copycat@market.cm',
    password: 'legacyPass2026',
  });
  assert.equal(reuse.status, 400);
  assert.equal(errorCode(reuse.data), 'PASSWORD_NOT_ALLOWED');
});

test('signing up with a password that is not in use still succeeds', async () => {
  const result = await call('POST', '/auth/signup', {
    firstName: 'Fresh',
    lastName: 'Start',
    email: 'freshstart@market.cm',
    password: 'freshStartPass2026',
  });
  assert.equal(result.status, 201);
});
