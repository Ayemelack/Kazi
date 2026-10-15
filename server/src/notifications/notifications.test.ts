import assert from 'node:assert/strict';
import { after, afterEach, before, beforeEach, test } from 'node:test';
import type { Server } from 'node:http';
import type Database from 'better-sqlite3';
import { openDatabase } from '../db/index.js';
import { createApp } from '../app.js';
import { testSendFromEnv } from './routes.js';
import type { PushMessaging } from './service.js';

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
  // POST /send is a testing aid, off unless asked for (KZ-03).
  const app = createApp(db, { testSend: true, trustProxy: 1 });
  server = app.listen(0);
  await new Promise<void>(resolve => server.once('listening', () => resolve()));

  const address = server.address();
  baseUrl = `http://localhost:${typeof address === 'object' && address ? address.port : 4000}`;
});

after(() => {
  server.close();
});

// Every test signs up a user; signup is limited per client address, so each
// request comes from its own.
let requests = 0;

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
      'X-Forwarded-For': `10.8.${Math.floor(++requests / 250)}.${requests % 250}`,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, data: text ? (JSON.parse(text) as Record<string, unknown>) : {} };
}

async function signUpUser(email: string, password?: string): Promise<string> {
  const pwd = password ?? 'pushLedger2026';
  const result = await call('POST', '/auth/signup', {
    firstName: 'Fcm',
    lastName: 'Tester',
    email,
    password: pwd,
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
test('POST /send exists only with NOTIFICATIONS_TEST_SEND=1 outside production', () => {
  assert.equal(testSendFromEnv({ NOTIFICATIONS_TEST_SEND: '1', NODE_ENV: 'development' }), true);
  assert.equal(testSendFromEnv({ NOTIFICATIONS_TEST_SEND: '1', NODE_ENV: 'test' }), true);
  assert.equal(testSendFromEnv({ NOTIFICATIONS_TEST_SEND: '1' }), true);
  assert.equal(testSendFromEnv({ NOTIFICATIONS_TEST_SEND: '1', NODE_ENV: 'production' }), false);
  assert.equal(testSendFromEnv({ NODE_ENV: 'development' }), false);
  assert.equal(testSendFromEnv({ NOTIFICATIONS_TEST_SEND: 'true', NODE_ENV: 'development' }), false);
  assert.equal(testSendFromEnv({ NOTIFICATIONS_TEST_SEND: '0', NODE_ENV: 'development' }), false);
});

async function withApp<T>(
  options: Parameters<typeof createApp>[1],
  run: (url: string, appDb: Database.Database) => Promise<T>,
): Promise<T> {
  const appDb = openDatabase({ filename: ':memory:' });
  const appServer = createApp(appDb, { ...options, trustProxy: 1 }).listen(0);
  await new Promise<void>(resolve => appServer.once('listening', () => resolve()));
  const address = appServer.address();
  try {
    return await run(`http://localhost:${typeof address === 'object' && address ? address.port : 4000}`, appDb);
  } finally {
    appServer.closeAllConnections();
    appServer.close();
    appDb.close();
  }
}

let gateSignups = 0;

async function signUpAt(url: string): Promise<string> {
  // Signup is limited per address across the process; each gets its own.
  const response = await fetch(`${url}/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': `10.9.0.${++gateSignups}` },
    body: JSON.stringify({ firstName: 'Fcm', lastName: 'Tester', email: 'gate@push.dev', password: 'pushLedger2026' }),
  });
  assert.equal(response.status, 201);
  return ((await response.json()) as { token: string }).token;
}

test('without the flag POST /send answers 404 and never pushes; token routes still work', async () => {
  let pushes = 0;
  const messaging: PushMessaging = {
    sendEachForMulticast: async () => {
      pushes += 1;
      throw new Error('must not be called');
    },
  };
  await withApp({ pushMessaging: () => messaging }, async url => {
    const token = await signUpAt(url);
    const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
    const registered = await fetch(`${url}/notifications/push-tokens`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ token: 'gate-token', platform: 'android' }),
    });
    assert.equal(registered.status, 200);
    const send = await fetch(`${url}/notifications/send`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ title: 'Hi', body: 'There' }),
    });
    assert.equal(send.status, 404);
    assert.equal(((await send.json()) as { error: { code: string } }).error.code, 'NOT_FOUND');
  });
  assert.equal(pushes, 0);
});

test('tokens FCM reports as dead are removed after a send; live ones stay', async () => {
  const messaging: PushMessaging = {
    sendEachForMulticast: async message => ({
      responses: message.tokens.map(token =>
        token === 'dead-token'
          ? { success: false, error: { code: 'messaging/registration-token-not-registered' } }
          : token === 'flaky-token'
            ? { success: false, error: { code: 'messaging/internal-error' } }
            : { success: true, messageId: 'm1' },
      ),
      successCount: 1,
      failureCount: 2,
    }) as Awaited<ReturnType<PushMessaging['sendEachForMulticast']>>,
  };
  await withApp({ testSend: true, pushMessaging: () => messaging }, async (url, appDb) => {
    const token = await signUpAt(url);
    const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
    for (const device of ['live-token', 'dead-token', 'flaky-token']) {
      await fetch(`${url}/notifications/push-tokens`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ token: device, platform: 'android' }),
      });
    }
    const send = await fetch(`${url}/notifications/send`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ title: 'Hi', body: 'There' }),
    });
    assert.equal(send.status, 200);
    assert.deepEqual(((await send.json()) as { result: unknown }).result, {
      sent: 1,
      failed: 2,
      removedUnregisteredTokens: 1,
    });
    const left = (appDb.prepare('SELECT token FROM push_tokens ORDER BY token').all() as { token: string }[]).map(
      row => row.token,
    );
    assert.deepEqual(left, ['flaky-token', 'live-token']);
  });
});
