import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, afterEach, before, beforeEach, mock, test } from 'node:test';
import type { Server } from 'node:http';
import type Database from 'better-sqlite3';
import type { BatchResponse, MulticastMessage } from 'firebase-admin/messaging';
import { openDatabase } from '../db/index.js';
import { createApp } from '../app.js';
import { stockOut } from '../items/service.js';
import { log } from '../log.js';
import {
  LOW_STOCK_ALERT_INTERVAL_MS,
  crossesLowStock,
  sendLowStockAlert,
  settleLowStockAlerts,
} from './lowStock.js';
import type { PushMessaging } from './service.js';

// KZ-03 (decision D6): a stock-out that takes a tracked item to its threshold
// sends one push to the owner's devices, after the write, at most once per
// item per 12 hours, and a push problem never touches the write.

type Behaviour = 'ok' | 'fail' | 'hang' | 'dead-token' | 'all-refused';

let behaviour: Behaviour = 'ok';
let sent: MulticastMessage[] = [];

const fakeMessaging: PushMessaging = {
  sendEachForMulticast(message: MulticastMessage): Promise<BatchResponse> {
    sent.push(message);
    if (behaviour === 'fail') {
      return Promise.reject(Object.assign(new Error('FCM unavailable'), { code: 'messaging/internal-error' }));
    }
    if (behaviour === 'hang') {
      return new Promise<BatchResponse>(() => {});
    }
    const responses = message.tokens.map((token, index) =>
      behaviour === 'all-refused'
        ? { success: false, error: { code: 'messaging/third-party-auth-error' } }
        : behaviour === 'dead-token' && index === 0
          ? {
              success: false,
              error: { code: 'messaging/registration-token-not-registered' },
            }
          : { success: true, messageId: `m-${token}` },
    ) as BatchResponse['responses'];
    const successCount = responses.filter(r => r.success).length;
    return Promise.resolve({ responses, successCount, failureCount: responses.length - successCount });
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

afterEach(async () => {
  await settleLowStockAlerts();
  warn.mock.restore();
  db.prepare('DELETE FROM users').run();
});

const today = new Date().toISOString().slice(0, 10);

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

interface Owner {
  token: string;
  userId: number;
}

async function owner(devices = ['device-a', 'device-b']): Promise<Owner> {
  const email = `stock-${Date.now()}-${Math.random()}@push.dev`;
  const signup = await call('POST', '/auth/signup', {
    firstName: 'Awa',
    lastName: 'Shop',
    email,
    password: 'mboaLedger2026',
  }, undefined, `10.0.0.${++signups}`); // one address each: signup is limited per address
  assert.equal(signup.status, 201);
  const token = (signup.data as { token: string }).token;
  for (const device of devices) {
    const registered = await call('POST', '/notifications/push-tokens', { token: `${device}-${email}`, platform: 'android' }, token);
    assert.equal(registered.status, 200);
  }
  const { id } = db.prepare('SELECT id FROM users WHERE email = ?').get(email) as { id: number };
  return { token, userId: id };
}

async function trackedItem(who: Owner, stock: number, threshold: number, name = 'Rice 5kg'): Promise<number> {
  const created = await call(
    'POST',
    '/items',
    { name, type: 'product', price: 500, trackStock: true, lowStockThreshold: threshold },
    who.token,
  );
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const id = (created.data.item as { id: number }).id;
  if (stock > 0) {
    const stocked = await call('POST', `/items/${id}/stock-in`, { quantity: stock }, who.token);
    assert.equal(stocked.status, 200);
  }
  return id;
}

function sale(who: Owner, itemId: number, quantity: number) {
  return call('POST', '/transactions', { type: 'sale', amount: 1000, date: today, itemId, quantity }, who.token);
}

function stockOf(itemId: number): number {
  return (db.prepare('SELECT stock FROM items WHERE id = ?').get(itemId) as { stock: number }).stock;
}

function lastAlertAt(itemId: number): number | null {
  return (db.prepare('SELECT last_low_stock_alert_at AS at FROM items WHERE id = ?').get(itemId) as { at: number | null }).at;
}

test('stock is written only by stockIn and stockOut, so every decrease can alert', () => {
  // The low-stock alert is detected in stockOut. A new path that lowers stock
  // with its own UPDATE would silently skip it (see REMEDIATION_PLAN KZ-23).
  const src = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const files = (dir: string): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return files(full);
      return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [full] : [];
    });
  const writes: string[] = [];
  for (const file of files(src)) {
    fs.readFileSync(file, 'utf8')
      .split('\n')
      .forEach((line, index) => {
        if (/\bstock\s*=\s*(\?|stock\b|-?\d)/.test(line)) {
          writes.push(`${path.relative(src, file).split(path.sep).join('/')}:${index + 1}`);
        }
      });
  }
  const source = fs.readFileSync(path.join(src, 'items', 'service.ts'), 'utf8').split('\n');
  const owner = (hit: string) => {
    const line = Number(hit.split(':')[1]);
    const above = source.slice(0, line).reverse();
    return above.find(l => /^export function /.test(l))?.match(/^export function (\w+)/)?.[1];
  };
  assert.ok(writes.every(hit => hit.startsWith('items/service.ts:')), writes.join(', '));
  assert.deepEqual(writes.map(owner).sort(), ['stockIn', 'stockOut']);
});

test('crossesLowStock: only a tracked item going from above the threshold to at or below it', () => {
  const tracked = { track_stock: 1, low_stock_threshold: 3 };
  assert.equal(crossesLowStock(tracked, 10, 3), true);
  assert.equal(crossesLowStock(tracked, 4, 0), true);
  assert.equal(crossesLowStock(tracked, 4, -2), true, 'a purchase reversal may go negative (D5)');
  assert.equal(crossesLowStock(tracked, 10, 4), false, 'still above');
  assert.equal(crossesLowStock(tracked, 3, 2), false, 'already at the threshold');
  assert.equal(crossesLowStock(tracked, 2, 1), false, 'already below');
  assert.equal(crossesLowStock({ track_stock: 1, low_stock_threshold: 0 }, 5, 0), false, 'alert off');
  assert.equal(crossesLowStock({ track_stock: 0, low_stock_threshold: 3 }, 10, 1), false, 'not tracked');
});

test('a sale that crosses the threshold sends one alert to each of the owner\'s devices', async () => {
  const awa = await owner();
  const itemId = await trackedItem(awa, 10, 3);

  const response = await sale(awa, itemId, 7);
  assert.equal(response.status, 201);
  await settleLowStockAlerts();

  assert.equal(sent.length, 1);
  const [message] = sent;
  assert.equal(message?.tokens.length, 2);
  assert.ok(message?.tokens.every(t => t.startsWith('device-')));
  assert.deepEqual(message?.data, {
    type: 'low_stock',
    itemId: String(itemId),
    title: 'Low stock alert',
    body: 'Rice 5kg: only 3 left.',
    channel: 'kazi',
  });
  assert.ok(lastAlertAt(itemId));

  // Already at the threshold: the next sale doesn't alert again.
  assert.equal((await sale(awa, itemId, 1)).status, 201);
  await settleLowStockAlerts();
  assert.equal(sent.length, 1);
});

test('no alert when the item was already below its threshold', async () => {
  const awa = await owner();
  const itemId = await trackedItem(awa, 2, 3);
  assert.equal((await sale(awa, itemId, 1)).status, 201);
  assert.equal((await call('POST', `/items/${itemId}/stock-out`, { quantity: 1 }, awa.token)).status, 200);
  await settleLowStockAlerts();
  assert.equal(sent.length, 0);
  assert.equal(lastAlertAt(itemId), null);
});

test('no alert for untracked items, items with the alert off, or a sale still above the threshold', async () => {
  const awa = await owner();
  const off = await trackedItem(awa, 10, 0);
  const above = await trackedItem(awa, 10, 3);
  const untracked = await call('POST', '/items', { name: 'Haircut', type: 'service', price: 500 }, awa.token);
  const untrackedId = (untracked.data.item as { id: number }).id;

  assert.equal((await sale(awa, off, 10)).status, 201);
  assert.equal((await sale(awa, above, 6)).status, 201);
  assert.equal((await sale(awa, untrackedId, 1)).status, 201);
  await settleLowStockAlerts();
  assert.equal(sent.length, 0);
});

test('at most one alert per item per 12 hours, then alerts again', async () => {
  const awa = await owner();
  const itemId = await trackedItem(awa, 10, 3);

  await sale(awa, itemId, 8);
  await settleLowStockAlerts();
  assert.equal(sent.length, 1);

  // Restocked and sold down again within 12 hours: no second alert.
  await call('POST', `/items/${itemId}/stock-in`, { quantity: 10 }, awa.token);
  await sale(awa, itemId, 10);
  await settleLowStockAlerts();
  assert.equal(sent.length, 1);

  // 12 hours later the next crossing alerts.
  db.prepare('UPDATE items SET last_low_stock_alert_at = ? WHERE id = ?').run(
    Date.now() - LOW_STOCK_ALERT_INTERVAL_MS - 1,
    itemId,
  );
  await call('POST', `/items/${itemId}/stock-in`, { quantity: 10 }, awa.token);
  await sale(awa, itemId, 12);
  await settleLowStockAlerts();
  assert.equal(sent.length, 2);
  assert.equal(sent[1]?.data?.body, 'Rice 5kg is out of stock.');
});

test('a manual stock-out and a purchase reversal that cross the threshold alert too', async () => {
  const awa = await owner();
  const manual = await trackedItem(awa, 10, 3, 'Soap');
  assert.equal((await call('POST', `/items/${manual}/stock-out`, { quantity: 8 }, awa.token)).status, 200);
  await settleLowStockAlerts();
  assert.equal(sent.length, 1);
  assert.equal(sent[0]?.data?.itemId, String(manual));

  const reversed = await trackedItem(awa, 2, 3, 'Oil');
  const purchase = await call(
    'POST',
    '/transactions',
    { type: 'purchase', amount: 2000, date: today, itemId: reversed, quantity: 5 },
    awa.token,
  );
  assert.equal(purchase.status, 201);
  await settleLowStockAlerts();
  assert.equal(sent.length, 1, 'stock went up: no alert');

  const id = (purchase.data.transaction as { id: number }).id;
  assert.equal((await call('DELETE', `/transactions/${id}`, undefined, awa.token)).status, 204);
  await settleLowStockAlerts();
  assert.equal(stockOf(reversed), 2);
  assert.equal(sent.length, 2);
  assert.equal(sent[1]?.data?.itemId, String(reversed));
});

test('the alert is in the account\'s language', async () => {
  const fr = await owner();
  db.prepare("UPDATE users SET language = 'fr' WHERE id = ?").run(fr.userId);
  const frItem = await trackedItem(fr, 5, 2, 'Savon');
  await sale(fr, frItem, 3);

  const wes = await owner();
  db.prepare("UPDATE users SET language = 'wes' WHERE id = ?").run(wes.userId);
  const wesItem = await trackedItem(wes, 5, 2, 'Garri');
  await sale(wes, wesItem, 5);

  await settleLowStockAlerts();
  assert.equal(sent.length, 2);
  const byItem = new Map(sent.map(m => [m.data?.itemId, m.data]));
  assert.equal(byItem.get(String(frItem))?.title, 'Alerte de stock bas');
  assert.equal(byItem.get(String(frItem))?.body, 'Savon : plus que 2 en stock.');
  assert.equal(byItem.get(String(wesItem))?.title, 'Low stock alert');
  assert.equal(byItem.get(String(wesItem))?.body, 'Garri don finish for stock.');
});

test('FCM failing does not affect the sale, is logged without user data, and frees the slot', async () => {
  behaviour = 'fail';
  const awa = await owner();
  const itemId = await trackedItem(awa, 10, 3);

  const response = await sale(awa, itemId, 7);
  assert.equal(response.status, 201);
  assert.equal((response.data.transaction as { quantity: number }).quantity, 7);
  await settleLowStockAlerts();

  assert.equal(sent.length, 1);
  assert.equal(stockOf(itemId), 3);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM transactions WHERE item_id = ?').get(itemId) as { n: number }).n, 1);
  const lines = warn.mock.calls.map(c => c.arguments.join(' '));
  assert.equal(lines.length, 1);
  assert.match(
    lines[0] ?? '',
    new RegExp(`^Low-stock alert for user ${awa.userId} was not delivered: messaging/internal-error$`),
  );
  assert.ok(!lines[0]?.includes('Rice') && !lines[0]?.includes('device-') && !lines[0]?.includes('FCM unavailable'));

  // Nothing was delivered, so the slot is free: the next crossing alerts.
  assert.equal(lastAlertAt(itemId), null);
  behaviour = 'ok';
  await call('POST', `/items/${itemId}/stock-in`, { quantity: 10 }, awa.token);
  await sale(awa, itemId, 10);
  await settleLowStockAlerts();
  assert.equal(sent.length, 2);
  assert.ok(lastAlertAt(itemId));
});

test('when every device is refused the slot is freed and the failure logged', async () => {
  behaviour = 'all-refused';
  const awa = await owner();
  const itemId = await trackedItem(awa, 10, 3);
  assert.equal((await sale(awa, itemId, 7)).status, 201);
  await settleLowStockAlerts();
  assert.equal(sent.length, 1);
  assert.equal(lastAlertAt(itemId), null);
  assert.equal(
    warn.mock.calls.map(c => c.arguments.join(' '))[0],
    `Low-stock alert for user ${awa.userId} was not delivered: no-device-accepted`,
  );
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM push_tokens WHERE user_id = ?').get(awa.userId) as { n: number }).n, 2, 'not dead tokens: kept');
});

test('a hanging FCM never delays the sale; the push gives up after its timeout', async () => {
  behaviour = 'hang';
  const awa = await owner();
  const itemId = await trackedItem(awa, 10, 3);

  const started = performance.now();
  const response = await sale(awa, itemId, 7);
  const elapsed = performance.now() - started;
  assert.equal(response.status, 201);
  assert.ok(elapsed < 2_000, `sale took ${Math.round(elapsed)} ms`);
  assert.equal(stockOf(itemId), 3);

  // The queued alert times out after 5 seconds and is logged. FCM may still
  // deliver it, so the slot stays claimed: no second alert within 12 hours.
  const settledAt = performance.now();
  await settleLowStockAlerts();
  assert.ok(performance.now() - settledAt >= 4_000, 'the alert waited for its timeout');
  assert.deepEqual(
    warn.mock.calls.map(c => c.arguments.join(' ')),
    [`Low-stock alert for user ${awa.userId} was not delivered: timeout`],
  );
  assert.ok(lastAlertAt(itemId));
});

test('sendLowStockAlert rejects when FCM does not answer within the timeout', async () => {
  behaviour = 'hang';
  const awa = await owner();
  const itemId = await trackedItem(awa, 10, 3);
  db.prepare('UPDATE items SET stock = 1 WHERE id = ?').run(itemId);
  await assert.rejects(sendLowStockAlert(db, awa.userId, itemId, Date.now(), 50), { name: 'PushTimeoutError' });
  assert.ok(lastAlertAt(itemId), 'a timed-out alert keeps its slot');
});

test('a crossing inside a transaction that rolls back sends nothing', async () => {
  const awa = await owner();
  const itemId = await trackedItem(awa, 10, 3);
  assert.throws(() =>
    db.transaction(() => {
      stockOut(db, awa.userId, itemId, { quantity: 8 });
      throw new Error('later step failed');
    })(),
  );
  await settleLowStockAlerts();
  assert.equal(stockOf(itemId), 10);
  assert.equal(sent.length, 0);
  assert.equal(lastAlertAt(itemId), null);
});

test('Firebase not configured: the alert is skipped and the 12-hour slot is not used', async () => {
  const bare = openDatabase({ filename: ':memory:' });
  bare.exec(`
    INSERT INTO users (id, company_name, email, password_hash) VALUES (1, 'A', 'a@example.com', 'h');
    INSERT INTO push_tokens (user_id, token, platform) VALUES (1, 'tok', 'android');
    INSERT INTO items (id, user_id, name, type, price, stock, track_stock, low_stock_threshold)
      VALUES (1, 1, 'Rice', 'product', 500, 2, 1, 3);
  `);
  assert.equal(await sendLowStockAlert(bare, 1, 1), 'not-configured');
  assert.equal((bare.prepare('SELECT last_low_stock_alert_at AS at FROM items').get() as { at: null }).at, null);
  bare.close();
});

test('no devices: nothing sent and the 12-hour slot is not used', async () => {
  const awa = await owner([]);
  const itemId = await trackedItem(awa, 10, 3);
  await sale(awa, itemId, 7);
  await settleLowStockAlerts();
  assert.equal(sent.length, 0);
  assert.equal(lastAlertAt(itemId), null);
});

test('a dead token reported by FCM is removed when an alert is sent', async () => {
  behaviour = 'dead-token';
  const awa = await owner();
  const itemId = await trackedItem(awa, 10, 3);
  await sale(awa, itemId, 7);
  await settleLowStockAlerts();
  assert.equal(sent.length, 1);
  const dead = sent[0]?.tokens[0];
  const remaining = db.prepare('SELECT token FROM push_tokens WHERE user_id = ?').all(awa.userId) as { token: string }[];
  assert.equal(remaining.length, 1);
  assert.notEqual(remaining[0]?.token, dead);
});
