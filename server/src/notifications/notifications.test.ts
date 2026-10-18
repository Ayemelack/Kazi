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

// ---------------------------------------------------------------------------
// Push preferences (decision C1): one switch per account, off = nothing sent.
// ---------------------------------------------------------------------------

test('push preferences default to on, save, and are validated', async () => {
  const fresh = await call('GET', '/notifications/preferences', undefined, awaToken);
  assert.equal(fresh.status, 200);
  assert.deepEqual(fresh.data, { pushNotifications: true });

  const saved = await call(
    'PUT',
    '/notifications/preferences',
    { pushNotifications: false },
    awaToken,
  );
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.data, { pushNotifications: false });

  const reread = await call('GET', '/notifications/preferences', undefined, awaToken);
  assert.deepEqual(reread.data, { pushNotifications: false });

  const invalid = await call(
    'PUT',
    '/notifications/preferences',
    { pushNotifications: 'off' },
    awaToken,
  );
  assert.equal(invalid.status, 400);
  assert.equal((invalid.data.error as { code: string }).code, 'VALIDATION_ERROR');
  assert.deepEqual(await call('GET', '/notifications/preferences', undefined, awaToken), reread);
});

test('push preferences need an authenticated account', async () => {
  assert.equal((await call('GET', '/notifications/preferences')).status, 401);
  assert.equal((await call('PUT', '/notifications/preferences', { pushNotifications: false })).status, 401);
});

test('an opted-out account is never sent to and records no history', async () => {
  let pushes = 0;
  const messaging: PushMessaging = {
    sendEachForMulticast: async message => {
      pushes += 1;
      return {
        responses: message.tokens.map(() => ({ success: true, messageId: 'm1' })),
        successCount: message.tokens.length,
        failureCount: 0,
      } as Awaited<ReturnType<PushMessaging['sendEachForMulticast']>>;
    },
  };
  await withApp({ testSend: true, pushMessaging: () => messaging }, async (url, appDb) => {
    const token = await signUpAt(url);
    const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
    await fetch(`${url}/notifications/push-tokens`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ token: 'opt-out-device', platform: 'android' }),
    });
    const optedOut = await fetch(`${url}/notifications/preferences`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ pushNotifications: false }),
    });
    assert.equal(optedOut.status, 200);

    const send = await fetch(`${url}/notifications/send`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ title: 'Hi', body: 'There' }),
    });
    assert.equal(send.status, 200);
    assert.deepEqual(((await send.json()) as { result: unknown }).result, {
      sent: 0,
      failed: 0,
      removedUnregisteredTokens: 0,
    });
    assert.equal(pushes, 0, 'FCM is never asked');

    const history = await fetch(`${url}/notifications/history`, { headers });
    assert.deepEqual(await history.json(), { notifications: [] });
  });
});

// ---------------------------------------------------------------------------
// Notification history (decision C2): what a device accepted, per account.
// ---------------------------------------------------------------------------

test('an empty history answers with an empty page and a zero badge', async () => {
  const history = await call('GET', '/notifications/history', undefined, awaToken);
  assert.equal(history.status, 200);
  assert.deepEqual(history.data, { notifications: [] });

  assert.deepEqual((await call('GET', '/notifications/unread-count', undefined, awaToken)).data, {
    unread: 0,
  });
  assert.deepEqual((await call('POST', '/notifications/read-all', undefined, awaToken)).data, {
    updated: 0,
  });
});

test('history paging outside 1..100 is rejected and the routes need a session', async () => {
  assert.equal((await call('GET', '/notifications/history?limit=0', undefined, awaToken)).status, 400);
  assert.equal((await call('GET', '/notifications/history?limit=101', undefined, awaToken)).status, 400);
  assert.equal((await call('GET', '/notifications/history?limit=abc', undefined, awaToken)).status, 400);
  assert.equal((await call('GET', '/notifications/history?limit=10', undefined, awaToken)).status, 200);

  assert.equal((await call('GET', '/notifications/history')).status, 401);
  assert.equal((await call('GET', '/notifications/unread-count')).status, 401);
  assert.equal((await call('POST', '/notifications/read-all')).status, 401);
});

let gates = 20;

async function signUpOther(url: string): Promise<string> {
  // signUpAt always uses the same address and email; a second account needs
  // both to be its own (signup is limited per address and unique per email).
  const response = await fetch(`${url}/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': `10.11.0.${++gates}` },
    body: JSON.stringify({
      firstName: 'Ngozi',
      lastName: 'Tester',
      email: `other-${gates}-${Math.random()}@push.dev`,
      password: 'pushLedger2026',
    }),
  });
  assert.equal(response.status, 201);
  return ((await response.json()) as { token: string }).token;
}

test('a delivered push is listed unread, then cleared; accounts never see each other', async () => {
  const messaging: PushMessaging = {
    sendEachForMulticast: async message => ({
      responses: message.tokens.map(() => ({ success: true, messageId: 'm1' })),
      successCount: message.tokens.length,
      failureCount: 0,
    }) as Awaited<ReturnType<PushMessaging['sendEachForMulticast']>>,
  };
  await withApp({ testSend: true, pushMessaging: () => messaging }, async (url, appDb) => {
    const first = await signUpAt(url);
    const second = await signUpOther(url);
    const headers = (token: string) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    });
    const register = async (token: string, device: string) => {
      const response = await fetch(`${url}/notifications/push-tokens`, {
        method: 'POST',
        headers: headers(token),
        body: JSON.stringify({ token: device, platform: 'android' }),
      });
      assert.equal(response.status, 200);
    };

    await register(first, 'first-device');
    await register(second, 'second-device');

    const send = await fetch(`${url}/notifications/send`, {
      method: 'POST',
      headers: headers(first),
      body: JSON.stringify({ title: 'Low stock alert', body: 'Rice 5kg: only 3 left.' }),
    });
    assert.equal(send.status, 200);
    assert.equal(((await send.json()) as { result: { sent: number } }).result.sent, 1);

    const history = await fetch(`${url}/notifications/history`, { headers: headers(first) });
    const rows = ((await history.json()) as { notifications: Record<string, unknown>[] })
      .notifications;
    assert.equal(rows.length, 1);
    const [row] = rows;
    assert.equal(row?.title, 'Low stock alert');
    assert.equal(row?.body, 'Rice 5kg: only 3 left.');
    assert.equal(row?.type, null, 'a message without a type is display-only');
    assert.equal(row?.itemId, null);
    assert.equal(row?.read, false);
    assert.match(String(row?.createdAt), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);

    const badge = await fetch(`${url}/notifications/unread-count`, { headers: headers(first) });
    assert.deepEqual(await badge.json(), { unread: 1 });

    // The other account sees neither the row nor the badge.
    const theirs = await fetch(`${url}/notifications/history`, { headers: headers(second) });
    assert.deepEqual(await theirs.json(), { notifications: [] });
    const theirBadge = await fetch(`${url}/notifications/unread-count`, {
      headers: headers(second),
    });
    assert.deepEqual(await theirBadge.json(), { unread: 0 });

    const read = await fetch(`${url}/notifications/read-all`, {
      method: 'POST',
      headers: headers(first),
    });
    assert.deepEqual(await read.json(), { updated: 1 });
    assert.deepEqual(
      await (await fetch(`${url}/notifications/unread-count`, { headers: headers(first) })).json(),
      { unread: 0 },
    );
    const after = await fetch(`${url}/notifications/history`, { headers: headers(first) });
    assert.equal(((await after.json()) as { notifications: { read: boolean }[] }).notifications[0]?.read, true);

    // Reading twice changes nothing the second time.
    const again = await fetch(`${url}/notifications/read-all`, {
      method: 'POST',
      headers: headers(first),
    });
    assert.deepEqual(await again.json(), { updated: 0 });
  });
});
