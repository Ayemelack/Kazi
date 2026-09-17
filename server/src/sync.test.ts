import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { Server } from 'node:http';
import type Database from 'better-sqlite3';
import { openDatabase } from './db.js';
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