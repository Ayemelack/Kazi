import assert from 'node:assert/strict';
import { after, afterEach, before, beforeEach, test } from 'node:test';
import type { Server } from 'node:http';
import type Database from 'better-sqlite3';
import { openDatabase } from '../db.js';
import { createApp } from '../app.js';

let server: Server;
let baseUrl: string;
let db: Database.Database;

before(async () => {
  process.env.JWT_SECRET = 'test-secret-not-for-production';
  // Ensure the test process never accidentally talks to real FCM. These are
  // validated by the tests that exercise the not-configured graceful path.
  delete process.env.FIREBASE_SERVICE_ACCOUNT;
  delete process.env.GOOGLE_APPLICATION_CREDENTIALS;

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
  token?: string,
): Promise<{ status: number; data: Record<string, unknown> }> {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, data: text ? (JSON.parse(text) as Record<string, unknown>) : {} };
}

async function signUpUser(email: string): Promise<string> {
  const result = await call('POST', '/auth/signup', {
    firstName: 'Fcm',
    lastName: 'Tester',
    email,
    password: 'coupe123',
  });
  assert.equal(result.status, 201);
  return (result.data as { token: string }).token;
}

let awaToken: string;

beforeEach(async () => {
  awaToken = await signUpUser(`awa-${Date.now()}-${Math.random()}@push.dev`);
});

afterEach(() => {
  db.prepare('DELETE FROM users').run();
});

test('push token registration requires authentication', async () => {
  const result = await call('POST', '/notifications/push-tokens', { token: 'abc' });
  assert.equal(result.status, 401);
  assert.equal((result.data.error as { code: string }).code, 'UNAUTHORIZED');
});

test('registers a push token for the authenticated user', async () => {
  const result = await call(
    'POST',
    '/notifications/push-tokens',
    { token: 'fcm-device-token-1', platform: 'android' },
    awaToken,
  );
  assert.equal(result.status, 200);
  const token = result.data.token as { token: string; platform: string };
  assert.equal(token.token, 'fcm-device-token-1');
  assert.equal(token.platform, 'android');

  const rows = db.prepare('SELECT * FROM push_tokens').all() as unknown as {
    token: string;
    user_id: number;
  }[];
  assert.equal(rows.length, 1);
  assert.ok(rows[0]);
  assert.equal(rows[0]?.token, 'fcm-device-token-1');
});

test('re-registering the same token stays idempotent', async () => {
  await call('POST', '/notifications/push-tokens', { token: 'dup-token', platform: 'android' }, awaToken);
  await call('POST', '/notifications/push-tokens', { token: 'dup-token', platform: 'android' }, awaToken);
  const rows = db.prepare('SELECT * FROM push_tokens WHERE token = ?').all('dup-token');
  assert.equal(rows.length, 1);
});

test('rejects an empty push token', async () => {
  const result = await call('POST', '/notifications/push-tokens', { token: '' }, awaToken);
  assert.equal(result.status, 400);
  assert.equal((result.data.error as { code: string }).code, 'VALIDATION_ERROR');
});

test('unregisters a push token', async () => {
  await call('POST', '/notifications/push-tokens', { token: 'todelete', platform: 'android' }, awaToken);
  const result = await call('DELETE', '/notifications/push-tokens', { token: 'todelete' }, awaToken);
  assert.equal(result.status, 204);
  const rows = db.prepare('SELECT * FROM push_tokens WHERE token = ?').all('todelete');
  assert.equal(rows.length, 0);
});

test('a user cannot unregister another user token', async () => {
  await call('POST', '/notifications/push-tokens', { token: 'long-live-awa', platform: 'android' }, awaToken);
  const awa2 = await signUpUser(`nono-${Date.now()}@push.dev`);
  const rows = db.prepare('SELECT id, user_id, token FROM push_tokens').all() as unknown as {
    token: string;
    user_id: number;
  }[];
  const other = rows[0];
  assert.ok(other);
  await call('DELETE', '/notifications/push-tokens', { token: other?.token }, awa2);
  assert.ok(db.prepare('SELECT 1 FROM push_tokens WHERE token = ?').get(other?.token));
});

test('send with no registered devices is a no-op without touching FCM', async () => {
  const result = await call('POST', '/notifications/send', { title: 'Hi', body: 'There' }, awaToken);
  assert.equal(result.status, 200);
  const send = result.data.result as { sent: number; failed: number };
  assert.equal(send.sent, 0);
  assert.equal(send.failed, 0);
});

test('send without FCM credentials fails gracefully with PUSH_NOT_CONFIGURED', async () => {
  await call('POST', '/notifications/push-tokens', { token: 'abc', platform: 'android' }, awaToken);
  const result = await call('POST', '/notifications/send', { title: 'Hi', body: 'There' }, awaToken);
  assert.equal(result.status, 503);
  assert.equal((result.data.error as { code: string }).code, 'PUSH_NOT_CONFIGURED');
});

test('rejects a send with an empty title', async () => {
  const result = await call('POST', '/notifications/send', { title: '', body: 'There' }, awaToken);
  assert.equal(result.status, 400);
  assert.equal((result.data.error as { code: string }).code, 'VALIDATION_ERROR');
});