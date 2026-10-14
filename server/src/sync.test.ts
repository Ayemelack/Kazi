import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { Server } from 'node:http';
import type Database from 'better-sqlite3';
import { openDatabase } from './db/index.js';
import { createApp } from './app.js';
import type { AuthResult } from './auth/service.js';

let server: Server;
let baseUrl: string;
let db: Database.Database;
let authToken: string;

before(async () => {
  process.env.JWT_SECRET = 'test-secret-not-for-production';

  db = openDatabase({ filename: ':memory:' });
  const app = createApp(db);
  server = app.listen(0);
  await new Promise<void>(resolve => server.once('listening', () => resolve()));

  const address = server.address();
  baseUrl = `http://localhost:${typeof address === 'object' && address ? address.port : 4000}`;

  const response = await fetch(`${baseUrl}/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      firstName: 'Sold',
      lastName: 'Offline',
      email: 'offline@market.cm',
      password: 'coupe123',
    }),
  });
  const auth = (await response.json()) as unknown as AuthResult;
  authToken = auth.token;
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
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${authToken}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return {
    status: response.status,
    data: text ? (JSON.parse(text) as Record<string, unknown>) : {},
  };
}

function countRows(table: string): number {
  const row = db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as {
    count: number;
  };
  return row.count;
}

test('replaying the same transaction clientOpId does not duplicate', async () => {
  const body = {
    type: 'sale',
    amount: 3000,
    date: '2026-09-13',
    description: 'Bottled water',
    clientOpId: `txn-${Date.now()}-0001`,
  };

  const first = await call('POST', '/transactions', body);
  assert.equal(first.status, 201);
  const replay = await call('POST', '/transactions', body);
  assert.equal(replay.status, 200);
  assert.equal(
    (replay.data.transaction as { id: number }).id,
    (first.data.transaction as { id: number }).id,
  );
  assert.equal(countRows('transactions'), 1);
  assert.equal(countRows('activity'), 1);
});

test('a different clientOpId creates an extra transaction', async () => {
  const body = {
    type: 'purchase',
    amount: 500,
    description: 'Buy fuel',
    date: '2026-09-13',
    clientOpId: `txn-${Date.now()}-0002`,
  };
  const first = await call('POST', '/transactions', body);
  assert.equal(first.status, 201);
  const second = await call('POST', '/transactions', { ...body, clientOpId: undefined } as object);
  assert.equal(second.status, 201);
  assert.equal(countRows('transactions'), 3);
});

test('replaying a debt create does not duplicate the debt', async () => {
  const body = {
    name: 'Mama Rose',
    amount: 15000,
    date: '2026-09-13',
    clientOpId: `debt-${Date.now()}-0001`,
  };
  const first = await call('POST', '/debts', body);
  assert.equal(first.status, 201);
  const activityBefore = countRows('activity');
  const replay = await call('POST', '/debts', body);
  assert.equal(replay.status, 200);
  assert.equal(countRows('debts'), 1);
  assert.equal(countRows('activity'), activityBefore);
});

test('replaying a debt payment is idempotent', async () => {
  const created = await call('POST', '/debts', {
    name: 'Claire',
    amount: 8000,
    date: '2026-09-13',
  });
  const debtId = (created.data.debt as { id: number }).id;

  const payBody = { clientOpId: `pay-${Date.now()}-0001` };
  const first = await call('POST', `/debts/${debtId}/pay`, payBody);
  assert.equal(first.status, 200);
  const activityBefore = countRows('activity');
  const replay = await call('POST', `/debts/${debtId}/pay`, payBody);
  assert.equal(replay.status, 200);
  assert.equal((replay.data.debt as { status: string }).status, 'paid');
  assert.equal(countRows('activity'), activityBefore);
});

test('replaying an item create does not duplicate the item', async () => {
  const body = {
    name: 'Bottled Water',
    type: 'product',
    price: 500,
    trackStock: true,
    lowStockThreshold: 10,
    clientOpId: `item-${Date.now()}-0001`,
  };
  const first = await call('POST', '/items', body);
  assert.equal(first.status, 201);
  const itemId = (first.data.item as { id: number }).id;

  const activityBefore = countRows('activity');
  const replay = await call('POST', '/items', body);
  assert.equal(replay.status, 200);
  assert.equal((replay.data.item as { id: number }).id, itemId);
  assert.equal(countRows('items'), 1);
  assert.equal(countRows('activity'), activityBefore);
});

test('replaying a stock-in movement does not double the stock', async () => {
  const items = (await call('GET', '/items')).data.items as {
    id: number;
    stock: number;
  }[];
  assert.ok(items[0], 'there is at least one item');
  const itemId = items[0].id;

  const movementBody = {
    quantity: 5,
    reason: 'Delivery',
    clientOpId: `stk-${Date.now()}-0001`,
  };
  const first = await call('POST', `/items/${itemId}/stock-in`, movementBody);
  assert.equal(first.status, 200);
  const replay = await call('POST', `/items/${itemId}/stock-in`, movementBody);
  assert.equal(replay.status, 200);

  const fresh = await call('GET', '/items');
  const freshItems = fresh.data.items as { id: number; stock: number }[];
  const freshItem = freshItems.find(item => item.id === itemId);
  assert.ok(freshItem, 'item exists after movement');
  assert.equal(freshItem.stock, 5);
});

test('reusing a clientOpId for a different operation is rejected', async () => {
  const clientOpId = `cross-${Date.now()}-0001`;
  const txn = await call('POST', '/transactions', {
    type: 'sale',
    amount: 1000,
    date: '2026-09-13',
    clientOpId,
  });
  assert.equal(txn.status, 201);

  const itemsBefore = countRows('items');
  const clash = await call('POST', '/items', {
    name: 'Collision Item',
    type: 'product',
    price: 5,
    clientOpId,
  });
  assert.equal(clash.status, 409);
  assert.equal(
    (clash.data.error as { code: string }).code,
    'IDEMPOTENCY_CONFLICT',
  );
  assert.equal(countRows('items'), itemsBefore);
});
// KZ-11: the app retries a write with the same clientOpId when the answer was
// lost. Every idempotent route must answer the retry with 200 and exactly the
// body it sent the first time, and must not write anything again.
test('every idempotent route replays 200 with the identical body and writes nothing', async () => {
  const stamp = Date.now();
  const tables = ['transactions', 'debts', 'items', 'stock_movements', 'activity', 'client_ops'];
  const snapshot = () => tables.map(table => countRows(table));

  const item = await call('POST', '/items', {
    name: 'Rice bag',
    type: 'product',
    price: 25000,
    trackStock: true,
    lowStockThreshold: 2,
    clientOpId: `kz11-item-${stamp}`,
  });
  assert.equal(item.status, 201);
  const itemId = (item.data.item as { id: number }).id;
  const debt = await call('POST', '/debts', {
    name: 'Papa Joe',
    amount: 4000,
    date: '2026-10-14',
    clientOpId: `kz11-debt-${stamp}`,
  });
  assert.equal(debt.status, 201);
  const debtId = (debt.data.debt as { id: number }).id;

  const writes: Array<[string, string, Record<string, unknown>, number]> = [
    ['POST', '/items', {
      name: 'Rice bag',
      type: 'product',
      price: 25000,
      trackStock: true,
      lowStockThreshold: 2,
      clientOpId: `kz11-item-${stamp}`,
    }, 201],
    ['POST', '/debts', {
      name: 'Papa Joe',
      amount: 4000,
      date: '2026-10-14',
      clientOpId: `kz11-debt-${stamp}`,
    }, 201],
    ['POST', `/items/${itemId}/stock-in`, { quantity: 8, reason: 'Delivery', clientOpId: `kz11-in-${stamp}` }, 200],
    ['POST', `/items/${itemId}/stock-out`, { quantity: 3, reason: 'Spoiled', clientOpId: `kz11-out-${stamp}` }, 200],
    ['POST', '/transactions', {
      type: 'sale',
      amount: 50000,
      date: '2026-10-14',
      itemId,
      quantity: 2,
      clientOpId: `kz11-sale-${stamp}`,
    }, 201],
    ['POST', `/debts/${debtId}/pay`, { date: '2026-10-14', clientOpId: `kz11-pay-${stamp}` }, 200],
  ];

  for (const [method, path, body, firstStatus] of writes) {
    // The item and debt were already created above; their first answer is that one.
    const first =
      path === '/items' ? item : path === '/debts' ? debt : await call(method, path, body);
    assert.equal(first.status, firstStatus, `${path} first status`);
    const before = snapshot();
    const replay = await call(method, path, body);
    assert.equal(replay.status, 200, `${path} replay status`);
    assert.deepEqual(replay.data, first.data, `${path} replay body`);
    assert.deepEqual(snapshot(), before, `${path} wrote nothing on replay`);
  }

  // Stock moved once per write: 8 in, 3 out, 2 sold.
  const fresh = await call('GET', `/items/${itemId}`);
  assert.equal((fresh.data.item as { stock: number }).stock, 3);
});

test('a clientOpId is scoped to its user', async () => {
  const signup = await fetch(`${baseUrl}/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      firstName: 'Second',
      lastName: 'Trader',
      email: 'second@market.cm',
      password: 'mboaLedger2026',
    }),
  });
  const other = ((await signup.json()) as unknown as AuthResult).token;
  const clientOpId = `kz11-shared-${Date.now()}`;
  const body = { type: 'sale', amount: 700, date: '2026-10-14', clientOpId };

  const mine = await call('POST', '/transactions', body);
  assert.equal(mine.status, 201);
  const theirs = await fetch(`${baseUrl}/transactions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${other}` },
    body: JSON.stringify(body),
  });
  assert.equal(theirs.status, 201);
  const theirTransaction = ((await theirs.json()) as { transaction: { id: number } }).transaction;
  assert.notEqual(theirTransaction.id, (mine.data.transaction as { id: number }).id);
});
