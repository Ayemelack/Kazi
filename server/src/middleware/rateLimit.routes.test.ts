import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import type { Server } from 'node:http';
import type Database from 'better-sqlite3';
import { openDatabase } from '../db/index.js';
import { USER_WRITES_PER_MINUTE, createApp } from '../app.js';
import {
  ACCOUNT_REQUESTS_PER_IP,
  AUTH_WINDOW_MS,
  PASSWORD_ATTEMPTS_PER_IP,
  PASSWORD_FAILURES_PER_ACCOUNT,
} from '../auth/routes.js';
import { issueResetCode } from '../auth/service.js';

// KZ-08: rate limits as clients see them, behind a proxy and not.

const PASSWORD = 'mboaLedger2026';

let server: Server | undefined;
let db: Database.Database | undefined;
let baseUrl = '';

async function start(trustProxy: false | number, options: { testSend?: boolean } = {}): Promise<void> {
  process.env.JWT_SECRET = 'test-secret-not-for-production';
  db = openDatabase({ filename: ':memory:' });
  server = createApp(db, { trustProxy, ...options }).listen(0);
  await new Promise<void>(resolve => server!.once('listening', () => resolve()));
  const address = server.address();
  baseUrl = `http://localhost:${typeof address === 'object' && address ? address.port : 4000}`;
}

afterEach(() => {
  server?.closeAllConnections();
  server?.close();
  db?.close();
  server = undefined;
  db = undefined;
});

interface Reply {
  status: number;
  retryAfter: string | null;
  data: Record<string, unknown>;
}

async function call(
  method: string,
  path: string,
  { body, from, token }: { body?: unknown; from?: string; token?: string } = {},
): Promise<Reply> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (from !== undefined) {
    headers['X-Forwarded-For'] = from;
  }
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  const text = await response.text();
  return {
    status: response.status,
    retryAfter: response.headers.get('retry-after'),
    data: text ? (JSON.parse(text) as Record<string, unknown>) : {},
  };
}

function codeOf(reply: Reply): string | undefined {
  return (reply.data.error as { code?: string } | undefined)?.code;
}

function assertTooMany(reply: Reply, maxSeconds: number): void {
  assert.equal(reply.status, 429);
  assert.equal(codeOf(reply), 'TOO_MANY_REQUESTS');
  const seconds = Number(reply.retryAfter);
  assert.ok(Number.isInteger(seconds) && seconds >= 1 && seconds <= maxSeconds, `Retry-After ${reply.retryAfter}`);
}

let addressCounter = 0;
/** A client address not used before in this run. */
function nextAddress(): string {
  addressCounter += 1;
  return `10.${(addressCounter >> 16) & 255}.${(addressCounter >> 8) & 255}.${addressCounter & 255}`;
}

async function signup(email: string, from = '192.0.2.250'): Promise<string> {
  const reply = await call('POST', '/auth/signup', {
    body: { firstName: 'Ngum', lastName: 'Achu', email, password: PASSWORD },
    from,
  });
  assert.equal(reply.status, 201, JSON.stringify(reply.data));
  return reply.data.token as string;
}

/** Sends requests until the first 429; returns how many were let through. */
async function allowedBefore429(send: (i: number) => Promise<Reply>, limit: number): Promise<{ allowed: number; refused: Reply }> {
  for (let i = 0; i <= limit + 1; i += 1) {
    const reply = await send(i);
    if (reply.status === 429) {
      return { allowed: i, refused: reply };
    }
  }
  assert.fail(`no 429 after ${limit + 2} requests`);
}

// --- per-IP buckets and TRUST_PROXY -----------------------------------------

test('TRUST_PROXY=1: each forwarded client address gets its own bucket', async () => {
  await start(1);
  const first = await allowedBefore429(
    () => call('POST', '/auth/signup', { body: {}, from: '203.0.113.7' }),
    ACCOUNT_REQUESTS_PER_IP,
  );
  assert.equal(first.allowed, ACCOUNT_REQUESTS_PER_IP);
  assertTooMany(first.refused, AUTH_WINDOW_MS / 1000);

  // Another client behind the same proxy is not affected.
  const other = await call('POST', '/auth/signup', { body: {}, from: '203.0.113.8' });
  assert.equal(other.status, 400, 'validated, not limited');
});

test('TRUST_PROXY=1 trusts one hop only: a client-written X-Forwarded-For prefix is ignored', async () => {
  await start(1);
  // The proxy appends the address it saw; whatever the client sent before it
  // must not pick the bucket.
  const result = await allowedBefore429(
    i => call('POST', '/auth/signup', { body: {}, from: `10.9.8.${i}, 203.0.113.7` }),
    ACCOUNT_REQUESTS_PER_IP,
  );
  assert.equal(result.allowed, ACCOUNT_REQUESTS_PER_IP);
});

test('TRUST_PROXY unset: a spoofed X-Forwarded-For is ignored', async () => {
  await start(false);
  const result = await allowedBefore429(
    i => call('POST', '/auth/signup', { body: {}, from: `203.0.113.${i}` }),
    ACCOUNT_REQUESTS_PER_IP,
  );
  assert.equal(result.allowed, ACCOUNT_REQUESTS_PER_IP, 'every request shared the connection address');
});

test('signup, forgot-password and reset-password each have their own per-IP bucket', async () => {
  await start(1);
  const from = '203.0.113.20';
  for (let i = 0; i < ACCOUNT_REQUESTS_PER_IP; i += 1) {
    assert.equal((await call('POST', '/auth/signup', { body: {}, from })).status, 400);
  }
  assert.equal((await call('POST', '/auth/signup', { body: {}, from })).status, 429);
  assert.equal((await call('POST', '/auth/forgot-password', { body: {}, from })).status, 400);
  assert.equal((await call('POST', '/auth/reset-password', { body: {}, from })).status, 400);
});

test(`login: ${PASSWORD_ATTEMPTS_PER_IP} attempts per IP across different emails`, async () => {
  await start(1);
  const result = await allowedBefore429(
    i => call('POST', '/auth/login', { body: { email: `nobody${i}@market.cm`, password: 'wrong-guess-1' }, from: '203.0.113.30' }),
    PASSWORD_ATTEMPTS_PER_IP,
  );
  assert.equal(result.allowed, PASSWORD_ATTEMPTS_PER_IP);
  assertTooMany(result.refused, AUTH_WINDOW_MS / 1000);
});

// --- per-account password failures ------------------------------------------

test('login: wrong passwords for one email lock it from every address; other emails are not affected', async () => {
  await start(1);
  await signup('target@market.cm');

  for (let i = 0; i < PASSWORD_FAILURES_PER_ACCOUNT; i += 1) {
    const reply = await call('POST', '/auth/login', {
      body: { email: 'target@market.cm', password: `wrong-guess-${i}` },
      from: nextAddress(),
    });
    assert.equal(reply.status, 401, `attempt ${i + 1}`);
  }
  // From yet another address, even the right password (in another case) is refused.
  const locked = await call('POST', '/auth/login', {
    body: { email: 'Target@Market.cm', password: PASSWORD },
    from: nextAddress(),
  });
  assertTooMany(locked, AUTH_WINDOW_MS / 1000);

  const other = await call('POST', '/auth/login', {
    body: { email: 'someone-else@market.cm', password: 'wrong-guess-x' },
    from: nextAddress(),
  });
  assert.equal(other.status, 401);
});

test('login: an unknown email locks the same way, so the lockout reveals nothing', async () => {
  await start(1);
  await signup('known@market.cm');
  const replies: Record<string, Reply> = {};
  for (const email of ['known@market.cm', 'ghost@market.cm']) {
    for (let i = 0; i < PASSWORD_FAILURES_PER_ACCOUNT; i += 1) {
      await call('POST', '/auth/login', { body: { email, password: 'wrong-guess-1' }, from: nextAddress() });
    }
    replies[email] = await call('POST', '/auth/login', { body: { email, password: 'wrong-guess-1' }, from: nextAddress() });
  }
  assert.equal(replies['known@market.cm']!.status, 429);
  assert.deepEqual(replies['known@market.cm']!.data, replies['ghost@market.cm']!.data);
  assert.equal(replies['ghost@market.cm']!.status, 429);
});

test('login: a success clears the failure count', async () => {
  await start(1);
  await signup('forgetful@market.cm');
  const attempt = (password: string) =>
    call('POST', '/auth/login', { body: { email: 'forgetful@market.cm', password }, from: nextAddress() });

  for (let i = 0; i < PASSWORD_FAILURES_PER_ACCOUNT - 1; i += 1) {
    assert.equal((await attempt('wrong-guess-1')).status, 401);
  }
  assert.equal((await attempt(PASSWORD)).status, 200);
  for (let i = 0; i < PASSWORD_FAILURES_PER_ACCOUNT; i += 1) {
    assert.equal((await attempt('wrong-guess-2')).status, 401, `after success, attempt ${i + 1}`);
  }
  assert.equal((await attempt(PASSWORD)).status, 429);
});

test('a completed password reset lifts the login lockout', async () => {
  await start(1);
  await signup('locked@market.cm');
  for (let i = 0; i <= PASSWORD_FAILURES_PER_ACCOUNT; i += 1) {
    await call('POST', '/auth/login', { body: { email: 'locked@market.cm', password: 'wrong-guess-1' }, from: nextAddress() });
  }
  const issued = issueResetCode(db!, 'locked@market.cm');
  assert.ok(issued);
  const reset = await call('POST', '/auth/reset-password', {
    body: { email: 'locked@market.cm', code: issued.code, password: 'freshLedger2027' },
    from: nextAddress(),
  });
  assert.equal(reset.status, 200, JSON.stringify(reset.data));
  const login = await call('POST', '/auth/login', {
    body: { email: 'locked@market.cm', password: 'freshLedger2027' },
    from: nextAddress(),
  });
  assert.equal(login.status, 200);
});

test('delete account: wrong passwords are limited per account, from every address', async () => {
  await start(1);
  const token = await signup('keeper@market.cm');
  for (let i = 0; i < PASSWORD_FAILURES_PER_ACCOUNT; i += 1) {
    const reply = await call('DELETE', '/auth/me', { body: { password: `wrong-guess-${i}` }, token, from: nextAddress() });
    assert.equal(reply.status, 401, `attempt ${i + 1}`);
  }
  const locked = await call('DELETE', '/auth/me', { body: { password: PASSWORD }, token, from: nextAddress() });
  assertTooMany(locked, AUTH_WINDOW_MS / 1000);
  assert.equal((await call('GET', '/auth/me', { token })).status, 200, 'the account is still there');
});

// --- authenticated writes per user ------------------------------------------

test(`authenticated writes: ${USER_WRITES_PER_MINUTE} a minute per user, across routes; reads and other users are not counted`, async () => {
  await start(1);
  const busy = await signup('busy@market.cm');
  const calm = await signup('calm@market.cm');
  const from = '203.0.113.40'; // both users share one address

  for (let i = 0; i < USER_WRITES_PER_MINUTE; i += 1) {
    const reply = await call('PATCH', '/auth/me/language', { body: { language: i % 2 ? 'fr' : 'en' }, token: busy, from });
    assert.equal(reply.status, 200, `write ${i + 1}`);
  }
  const refused = await call('PATCH', '/auth/me/language', { body: { language: 'en' }, token: busy, from });
  assertTooMany(refused, 60);
  // The bucket is the user's, not the route's.
  assertTooMany(await call('POST', '/items', { body: { name: 'Rice 5kg', price: 4500 }, token: busy, from }), 60);
  // Reads still work, and another user on the same address can still write.
  assert.equal((await call('GET', '/auth/me', { token: busy, from })).status, 200);
  assert.equal((await call('PATCH', '/auth/me/language', { body: { language: 'fr' }, token: calm, from })).status, 200);
});

test('POST /notifications/send stays limited, per user', async () => {
  // The route exists only as a testing aid since KZ-03 (NOTIFICATIONS_TEST_SEND).
  await start(1, { testSend: true });
  const token = await signup('pusher@market.cm');
  const result = await allowedBefore429(
    () => call('POST', '/notifications/send', { body: { title: 'Hi', body: 'Test' }, token, from: nextAddress() }),
    10,
  );
  assert.equal(result.allowed, 10);
  assertTooMany(result.refused, 60);
});
