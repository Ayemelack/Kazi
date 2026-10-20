import assert from 'node:assert/strict';
import { after, afterEach, before, beforeEach, mock, test } from 'node:test';
import type { Server } from 'node:http';
import type Database from 'better-sqlite3';
import type { BatchResponse, MulticastMessage } from 'firebase-admin/messaging';
import { openDatabase } from '../db/index.js';
import { createApp } from '../app.js';
import { log } from '../log.js';
import { LAST_SEEN_THROTTLE_MS, recordUserSeen } from './presence.js';
import { inactivityNotificationsAllowed, setPushPreferences } from './preferences.js';
import {
  DEFAULT_INACTIVITY_OPTIONS,
  INACTIVITY_SCAN_INTERVAL_MS,
  sendInactivityNudge,
  startInactivityScheduler,
  runInactivityScan,
} from './inactivity.js';
import type { PushMessaging } from './service.js';

// Decision D9: the inactivity push. An opted-in account unseen for a while
// gets at most one nudge per repeat window, best-effort, and only when BOTH
// the master push switch and the opt-in are on.

type Behaviour = 'ok' | 'fail' | 'hang' | 'dead-token' | 'all-refused';

let behaviour: Behaviour = 'ok';
let sent: MulticastMessage[] = [];

const fakeMessaging: PushMessaging = {
  sendEachForMulticast(message: MulticastMessage): Promise<BatchResponse> {
    sent.push(message);
    if (behaviour === 'fail') {
      return Promise.reject(
        Object.assign(new Error('FCM unavailable'), { code: 'messaging/internal-error' }),
      );
    }
    if (behaviour === 'hang') {
      return new Promise<BatchResponse>(() => {});
    }
    const responses = message.tokens.map((token, index) =>
      behaviour === 'all-refused'
        ? { success: false, error: { code: 'messaging/third-party-auth-error' } }
        : behaviour === 'dead-token' && index === 0
          ? { success: false, error: { code: 'messaging/registration-token-not-registered' } }
          : { success: true, messageId: `m-${token}` },
    ) as BatchResponse['responses'];
    const successCount = responses.filter(r => r.success).length;
    return Promise.resolve({
      responses,
      successCount,
      failureCount: responses.length - successCount,
    });
  },
};

let server: Server;
let baseUrl: string;
let db: Database.Database;
let warn: ReturnType<typeof mock.method>;

before(async () => {
  process.env.JWT_SECRET = 'test-secret-not-for-production';
  delete process.env.FIREBASE_SERVICE_ACCOUNT;
  delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
  db = openDatabase({ filename: ':memory:' });
  server = createApp(db, { pushMessaging: () => fakeMessaging, trustProxy: 1 }).listen(0);
  await new Promise<void>(resolve => server.once('listening', () => resolve()));
  const address = server.address();
  baseUrl = `http://localhost:${typeof address === 'object' && address ? address.port : 4000}`;
});

after(() => {
  server.closeAllConnections();
  server.close();
});

beforeEach(() => {
  behaviour = 'ok';
  sent = [];
  warn = mock.method(log, 'warn', () => {});
});

afterEach(() => {
  warn.mock.restore();
  db.prepare('DELETE FROM users').run();
});

const DAY = 24 * 60 * 60 * 1000;
const THRESHOLD = DEFAULT_INACTIVITY_OPTIONS.thresholdMs;

async function call(
  method: string,
  path: string,
  body?: unknown,
  token?: string,
  forwardedFor?: string,
): Promise<{ status: number; data: Record<string, unknown> }> {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(forwardedFor ? { 'X-Forwarded-For': forwardedFor } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  const text = await response.text();
  return { status: response.status, data: text ? (JSON.parse(text) as Record<string, unknown>) : {} };
}

let signups = 0;

interface Account {
  token: string;
  userId: number;
}

async function account(devices = ['device-a']): Promise<Account> {
  const email = `inactive-${Date.now()}-${Math.random()}@push.dev`;
  const signup = await call(
    'POST',
    '/auth/signup',
    { firstName: 'Awa', lastName: 'Shop', email, password: 'mboaLedger2026' },
    undefined,
    `10.5.0.${++signups}`,
  );
  assert.equal(signup.status, 201);
  const token = (signup.data as { token: string }).token;
  for (const device of devices) {
    const registered = await call(
      'POST',
      '/notifications/push-tokens',
      { token: `${device}-${email}`, platform: 'android' },
      token,
    );
    assert.equal(registered.status, 200);
  }
  const { id } = db.prepare('SELECT id FROM users WHERE email = ?').get(email) as { id: number };
  return { token, userId: id };
}

function setSeen(userId: number, at: number | null): void {
  db.prepare('UPDATE users SET last_seen_at = ? WHERE id = ?').run(at, userId);
}

function notifiedAt(userId: number): number | null {
  return (
    db.prepare('SELECT inactivity_notified_at AS at FROM users WHERE id = ?').get(userId) as {
      at: number | null;
    }
  ).at;
}

function optIn(userId: number, value: boolean): void {
  db.prepare('UPDATE users SET inactivity_notifications = ? WHERE id = ?').run(value ? 1 : 0, userId);
}

// ---------------------------------------------------------------------------
// Activity tracking (presence.ts)
// ---------------------------------------------------------------------------

test('recordUserSeen writes the timestamp once and throttles for an hour', () => {
  const fresh = openDatabase({ filename: ':memory:' });
  fresh.exec("INSERT INTO users (id, company_name, email, password_hash) VALUES (1, 'A', 'a@x.dev', 'h')");

  const t0 = 1_000_000_000_000;
  recordUserSeen(fresh, 1, t0);
  assert.equal((fresh.prepare('SELECT last_seen_at AS at FROM users').get() as { at: number }).at, t0);

  // Inside the throttle window: no write.
  recordUserSeen(fresh, 1, t0 + 1000);
  assert.equal((fresh.prepare('SELECT last_seen_at AS at FROM users').get() as { at: number }).at, t0);

  // Past the window: the timestamp moves.
  const later = t0 + LAST_SEEN_THROTTLE_MS + 1;
  recordUserSeen(fresh, 1, later);
  assert.equal((fresh.prepare('SELECT last_seen_at AS at FROM users').get() as { at: number }).at, later);

  // It only ever touches the one user row.
  fresh.exec("INSERT INTO users (id, company_name, email, password_hash) VALUES (2, 'B', 'b@x.dev', 'h')");
  recordUserSeen(fresh, 1, later + LAST_SEEN_THROTTLE_MS + 1);
  assert.equal((fresh.prepare('SELECT last_seen_at AS at FROM users WHERE id = 2').get() as { at: null }).at, null);
  fresh.close();
});

test('an authenticated request records the caller as seen; a bad token records nothing', async () => {
  const awa = await account();
  setSeen(awa.userId, null);

  const ok = await call('GET', '/auth/me', undefined, awa.token);
  assert.equal(ok.status, 200);
  const seen = db.prepare('SELECT last_seen_at AS at FROM users WHERE id = ?').get(awa.userId) as {
    at: number | null;
  };
  assert.ok(seen.at !== null, 'a valid session marks the account active');

  setSeen(awa.userId, null);
  const bad = await call('GET', '/auth/me', undefined, 'not-a-token');
  assert.equal(bad.status, 401);
  assert.equal(
    (db.prepare('SELECT last_seen_at AS at FROM users WHERE id = ?').get(awa.userId) as { at: null }).at,
    null,
  );
});

test('a tracking failure never fails the request it rode in on', async () => {
  const awa = await account();
  // Make the presence UPDATE itself fail (a trigger raising on every write to
  // users.last_seen_at). The authenticated request must still succeed: the
  // tracking write is best-effort and guarded in requireAuth.
  db.exec(`
    CREATE TRIGGER block_presence BEFORE UPDATE OF last_seen_at ON users
    BEGIN
      SELECT RAISE(ABORT, 'presence blocked');
    END;
  `);
  try {
    const result = await call('GET', '/auth/me', undefined, awa.token);
    assert.equal(result.status, 200);
  } finally {
    db.exec('DROP TRIGGER block_presence');
  }
});

// ---------------------------------------------------------------------------
// Eligibility and consent
// ---------------------------------------------------------------------------

test('a never-seen account is not inactive, even when opted in with devices', async () => {
  const awa = await account();
  optIn(awa.userId, true);
  setSeen(awa.userId, null);

  assert.equal(await sendInactivityNudge(db, awa.userId), 'skipped');
  assert.equal(sent.length, 0);
  assert.equal(notifiedAt(awa.userId), null);
});

test('an account below the inactivity threshold receives nothing; past it, one nudge', async () => {
  const awa = await account();
  optIn(awa.userId, true);
  const now = Date.now();

  setSeen(awa.userId, now - DAY);
  assert.equal(await sendInactivityNudge(db, awa.userId, now), 'skipped');
  assert.equal(sent.length, 0);

  setSeen(awa.userId, now - THRESHOLD - 1);
  assert.equal(await sendInactivityNudge(db, awa.userId, now), 'sent');
  assert.equal(sent.length, 1);
  assert.ok(notifiedAt(awa.userId));
});

test('the nudge is data-only, on the Kazi channel, and names no record', async () => {
  const awa = await account();
  optIn(awa.userId, true);
  const now = Date.now();
  setSeen(awa.userId, now - THRESHOLD - 1);

  assert.equal(await sendInactivityNudge(db, awa.userId, now), 'sent');
  const message = sent[0];
  assert.ok(message);
  assert.equal(message.tokens.length, 1);
  assert.equal(message.data?.type, 'inactivity');
  assert.equal(message.data?.channel, 'kazi');
  assert.equal(message.data?.itemId, undefined);
  assert.equal(message.android?.priority, 'high');
  assert.match(String(message.data?.body), /Open Kazi/);
});

test('the opted-in, master-off account is blocked by the master switch', async () => {
  const awa = await account();
  optIn(awa.userId, true);
  db.prepare('UPDATE users SET push_notifications = 0 WHERE id = ?').run(awa.userId);
  setSeen(awa.userId, Date.now() - THRESHOLD - 1);

  assert.equal(inactivityNotificationsAllowed(db, awa.userId), false);
  assert.equal(await sendInactivityNudge(db, awa.userId), 'opted-out');
  assert.equal(sent.length, 0);
  assert.equal(notifiedAt(awa.userId), null, 'a blocked send never claims the slot');
});

test('the master-on, opt-out account is blocked by the missing opt-in', async () => {
  const awa = await account();
  db.prepare('UPDATE users SET push_notifications = 1 WHERE id = ?').run(awa.userId);
  optIn(awa.userId, false);
  setSeen(awa.userId, Date.now() - THRESHOLD - 1);

  assert.equal(inactivityNotificationsAllowed(db, awa.userId), false);
  assert.equal(await sendInactivityNudge(db, awa.userId), 'opted-out');
  assert.equal(sent.length, 0);
  assert.equal(notifiedAt(awa.userId), null);
});

test('a user returning to Kazi becomes ineligible for the old window', async () => {
  const awa = await account();
  optIn(awa.userId, true);
  const now = Date.now();
  setSeen(awa.userId, now - THRESHOLD - 1);

  // They come back: last_seen_at moves to now.
  recordUserSeen(db, awa.userId, now);
  assert.equal(await sendInactivityNudge(db, awa.userId, now), 'skipped');
  assert.equal(sent.length, 0);
});

test('users without a registered device are skipped and use no slot', async () => {
  const awa = await account([]);
  optIn(awa.userId, true);
  setSeen(awa.userId, Date.now() - THRESHOLD - 1);

  assert.equal(await sendInactivityNudge(db, awa.userId), 'no-devices');
  assert.equal(sent.length, 0);
  assert.equal(notifiedAt(awa.userId), null);
});

// ---------------------------------------------------------------------------
// Deduplication and scheduling
// ---------------------------------------------------------------------------

test('repeated nudges are deduped inside the repeat window, then allowed again', async () => {
  const awa = await account();
  optIn(awa.userId, true);
  const now = Date.now();
  setSeen(awa.userId, now - THRESHOLD - 1);

  assert.equal(await sendInactivityNudge(db, awa.userId, now), 'sent');
  assert.equal(sent.length, 1);
  const firstClaim = notifiedAt(awa.userId);
  assert.ok(firstClaim);

  // Same window: a second call is skipped and does not move the claim.
  assert.equal(await sendInactivityNudge(db, awa.userId, now + 1000), 'skipped');
  assert.equal(sent.length, 1);
  assert.equal(notifiedAt(awa.userId), firstClaim);

  // Past the repeat window: eligible again.
  const later = now + DEFAULT_INACTIVITY_OPTIONS.repeatMs + 1;
  setSeen(awa.userId, later - THRESHOLD - 1);
  assert.equal(await sendInactivityNudge(db, awa.userId, later), 'sent');
  assert.equal(sent.length, 2);
});

test('two overlapping scans cannot claim the same slot (the UPDATE is atomic)', async () => {
  const awa = await account();
  optIn(awa.userId, true);
  const now = Date.now();
  setSeen(awa.userId, now - THRESHOLD - 1);

  const [a, b] = await Promise.all([
    sendInactivityNudge(db, awa.userId, now),
    sendInactivityNudge(db, awa.userId, now),
  ]);
  const outcomes = [a, b].sort();
  assert.deepEqual(outcomes, ['sent', 'skipped']);
  assert.equal(sent.length, 1, 'exactly one send won the slot');
});

test('all of one account\'s devices receive the one nudge', async () => {
  const awa = await account(['device-a', 'device-b']);
  optIn(awa.userId, true);
  setSeen(awa.userId, Date.now() - THRESHOLD - 1);

  assert.equal(await runInactivityScan(db), 1);
  assert.equal(sent.length, 1);
  assert.equal(sent[0]?.tokens.length, 2);
  assert.ok(sent[0]?.tokens.every(t => t.startsWith('device-')));
});

test('a scan only reaches eligible accounts and reports the sent count', async () => {
  const eligible = await account();
  optIn(eligible.userId, true);
  setSeen(eligible.userId, Date.now() - THRESHOLD - 1);

  const tooRecent = await account();
  optIn(tooRecent.userId, true);
  setSeen(tooRecent.userId, Date.now() - DAY);

  const notOptedIn = await account();
  setSeen(notOptedIn.userId, Date.now() - THRESHOLD - 1);

  const sentCount = await runInactivityScan(db);
  assert.equal(sentCount, 1);
  assert.equal(sent.length, 1);
  assert.equal(notifiedAt(eligible.userId) !== null, true);
  assert.equal(notifiedAt(tooRecent.userId), null);
  assert.equal(notifiedAt(notOptedIn.userId), null);
});

test('the scheduler scans once immediately and stops cleanly', async () => {
  const awa = await account();
  optIn(awa.userId, true);
  setSeen(awa.userId, Date.now() - THRESHOLD - 1);

  const scheduler = startInactivityScheduler(db, INACTIVITY_SCAN_INTERVAL_MS);
  try {
    assert.equal(await scheduler.runOnce(), 1);
    assert.equal(sent.length, 1);
    // A second run inside the window sends nothing.
    assert.equal(await scheduler.runOnce(), 0);
  } finally {
    scheduler.stop();
  }
});

// ---------------------------------------------------------------------------
// Failure behaviour
// ---------------------------------------------------------------------------

test('a server without Firebase credentials skips the nudge and frees the slot', async () => {
  const bare = openDatabase({ filename: ':memory:' });
  const now = Date.now();
  bare.exec(`
    INSERT INTO users (id, company_name, email, password_hash, push_notifications, inactivity_notifications, last_seen_at)
      VALUES (1, 'A', 'a@example.com', 'h', 1, 1, ${now - THRESHOLD - 1});
    INSERT INTO push_tokens (user_id, token, platform) VALUES (1, 'tok', 'android');
  `);
  assert.equal(await sendInactivityNudge(bare, 1), 'not-configured');
  assert.equal(
    (bare.prepare('SELECT inactivity_notified_at AS at FROM users').get() as { at: null }).at,
    null,
    'an unconfigured server never uses up the repeat slot',
  );
  bare.close();
});

test('FCM refusing the send is logged without user data and frees the slot', async () => {
  behaviour = 'fail';
  const awa = await account();
  optIn(awa.userId, true);
  const now = Date.now();
  setSeen(awa.userId, now - THRESHOLD - 1);

  await assert.rejects(sendInactivityNudge(db, awa.userId, now), {
    code: 'messaging/internal-error',
  });
  assert.equal(notifiedAt(awa.userId), null, 'the slot is released so the next scan retries');

  behaviour = 'ok';
  sent = [];
  const scanSent = await runInactivityScan(db);
  assert.equal(scanSent, 1);
  assert.equal(sent.length, 1);
  const lines = warn.mock.calls.map(c => c.arguments.join(' '));
  assert.ok(lines.every(line => !line.includes('device-') && !line.includes('@push.dev')));
});

test('when every device is refused the slot is freed and logged', async () => {
  behaviour = 'all-refused';
  const awa = await account();
  optIn(awa.userId, true);
  setSeen(awa.userId, Date.now() - THRESHOLD - 1);

  assert.equal(await runInactivityScan(db), 0);
  assert.equal(sent.length, 1);
  assert.equal(notifiedAt(awa.userId), null);
  assert.match(
    warn.mock.calls.map(c => c.arguments.join(' '))[0] ?? '',
    /no-device-accepted/,
  );
});

test('a hanging FCM times out, keeps the slot, and is logged', async () => {
  behaviour = 'hang';
  const awa = await account();
  optIn(awa.userId, true);
  const now = Date.now();
  setSeen(awa.userId, now - THRESHOLD - 1);

  await assert.rejects(
    sendInactivityNudge(db, awa.userId, now, { ...DEFAULT_INACTIVITY_OPTIONS, timeoutMs: 50 }),
    { name: 'PushTimeoutError' },
  );
  assert.ok(notifiedAt(awa.userId), 'a timed-out nudge keeps its slot');
});

test('a dead token reported by FCM is removed on a send', async () => {
  behaviour = 'dead-token';
  const awa = await account(['dead', 'live']);
  optIn(awa.userId, true);
  setSeen(awa.userId, Date.now() - THRESHOLD - 1);

  assert.equal(await runInactivityScan(db), 1);
  const remaining = db
    .prepare('SELECT token FROM push_tokens WHERE user_id = ?')
    .all(awa.userId) as { token: string }[];
  assert.equal(remaining.length, 1);
  assert.ok(remaining[0]?.token.startsWith('live-'));
});

// ---------------------------------------------------------------------------
// History and the master switch interaction
// ---------------------------------------------------------------------------

test('a delivered nudge is recorded in the account history with its type', async () => {
  const awa = await account();
  optIn(awa.userId, true);
  setSeen(awa.userId, Date.now() - THRESHOLD - 1);

  assert.equal(await runInactivityScan(db), 1);
  const row = db
    .prepare('SELECT type, title, body FROM user_notifications WHERE user_id = ?')
    .get(awa.userId) as { type: string; title: string; body: string } | undefined;
  assert.ok(row);
  assert.equal(row.type, 'inactivity');
  assert.equal(row.title, 'Kazi');
  assert.match(row.body, /Open Kazi/);
});

test('setPushPreferences from the API keeps the two switches independent', async () => {
  const awa = await account();
  setPushPreferences(db, awa.userId, true, true);
  assert.equal(inactivityNotificationsAllowed(db, awa.userId), true);
  setPushPreferences(db, awa.userId, false, true);
  assert.equal(inactivityNotificationsAllowed(db, awa.userId), false);
  setPushPreferences(db, awa.userId, true, false);
  assert.equal(inactivityNotificationsAllowed(db, awa.userId), false);
  setPushPreferences(db, awa.userId, true, true);
  assert.equal(inactivityNotificationsAllowed(db, awa.userId), true);
});
