import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { Server } from 'node:http';
import { openDatabase } from '../db/index.js';
import { createApp } from '../app.js';
import type { AuthResult } from '../auth/service.js';
import type { Item } from '../items/service.js';
import type { Transaction } from './service.js';

let server: Server;
let baseUrl: string;
let token: string;

before(async () => {
  process.env.JWT_SECRET = 'test-secret-not-for-production';

  const db = openDatabase({ filename: ':memory:' });
  const app = createApp(db);
  server = app.listen(0);
  await new Promise<void>(resolve => server.once('listening', () => resolve()));

  const address = server.address();
  baseUrl = `http://localhost:${typeof address === 'object' && address ? address.port : 4000}`;

  const response = await fetch(`${baseUrl}/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      firstName: 'Café',
      lastName: 'Port',
      email: 'cafe@transactions.cm',
      password: 'port1234',
    }),
  });
  const auth = (await response.json()) as unknown as AuthResult;
  token = auth.token;
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
      Authorization: `Bearer ${token}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, data: text ? (JSON.parse(text) as Record<string, unknown>) : {} };
}

async function createTrackedItem(initialStock = 10): Promise<Item> {
  const created = await call('POST', '/items', {
    name: 'Coffee beans',
    type: 'product',
    price: 3500,
    trackStock: true,
    lowStockThreshold: 3,
  });
  const item = (created.data as { item: Item }).item;
  if (initialStock > 0) {
    await call('POST', `/items/${item.id}/stock-in`, { quantity: initialStock });
  }
  const fetched = await call('GET', `/items/${item.id}`);
  return (fetched.data as { item: Item }).item;
}

test('records a sale and reduces tracked stock', async () => {
  const item = await createTrackedItem(10);

  const result = await call('POST', '/transactions', {
    type: 'sale',
    amount: 3500,
    date: '2026-09-12',
    description: 'Walk-in customer',
    itemId: item.id,
    quantity: 2,
  });
  assert.equal(result.status, 201);

  const transaction = (result.data as { transaction: Transaction }).transaction;
  assert.equal(transaction.type, 'sale');
  assert.equal(transaction.amount, 3500);
  assert.equal(transaction.quantity, 2);
  assert.equal(transaction.item?.name, 'Coffee beans');

  const updated = await call('GET', `/items/${item.id}`);
  assert.equal((updated.data as { item: Item }).item.stock, 8);
});

test('records a purchase and adds tracked stock', async () => {
  const item = await createTrackedItem(3);

  const result = await call('POST', '/transactions', {
    type: 'purchase',
    amount: 60000,
    date: '2026-09-12',
    itemId: item.id,
    quantity: 10,
  });
  assert.equal(result.status, 201);
  assert.equal((result.data as { transaction: Transaction }).transaction.quantity, 10);

  const updated = await call('GET', `/items/${item.id}`);
  assert.equal((updated.data as { item: Item }).item.stock, 13);
});

test('defaults quantity to 1 for a tracked item', async () => {
  const item = await createTrackedItem(5);

  const result = await call('POST', '/transactions', {
    type: 'sale',
    amount: 3500,
    date: '2026-09-12',
    itemId: item.id,
  });
  assert.equal(result.status, 201);
  const transaction = (result.data as { transaction: Transaction }).transaction;
  assert.equal(transaction.quantity, 1);

  const updated = await call('GET', `/items/${item.id}`);
  assert.equal((updated.data as { item: Item }).item.stock, 4);
});

test('rejects a sale that would drop stock below zero', async () => {
  const item = await createTrackedItem(2);
  const before = await call('GET', '/transactions');
  const beforeCount = (before.data as { transactions: Transaction[] }).transactions.length;

  const result = await call('POST', '/transactions', {
    type: 'sale',
    amount: 3500,
    date: '2026-09-12',
    itemId: item.id,
    quantity: 5,
  });
  assert.equal(result.status, 400);
  assert.equal((result.data.error as { code: string }).code, 'INSUFFICIENT_STOCK');

  const after = await call('GET', '/transactions');
  assert.equal((after.data as { transactions: Transaction[] }).transactions.length, beforeCount);
  const updated = await call('GET', `/items/${item.id}`);
  assert.equal((updated.data as { item: Item }).item.stock, 2);
});

test('allows a sale without an item (general income)', async () => {
  const result = await call('POST', '/transactions', {
    type: 'sale',
    amount: 5000,
    date: '2026-09-11',
    description: 'Job done',
  });
  assert.equal(result.status, 201);
  const transaction = (result.data as { transaction: Transaction }).transaction;
  assert.equal(transaction.item, undefined);
  assert.equal(transaction.quantity, undefined);
});

test('rejects quantity without an item', async () => {
  const result = await call('POST', '/transactions', {
    type: 'sale',
    amount: 1000,
    date: '2026-09-11',
    quantity: 3,
  });
  assert.equal(result.status, 400);
});

test('rejects a missing item', async () => {
  const result = await call('POST', '/transactions', {
    type: 'sale',
    amount: 1000,
    date: '2026-09-11',
    itemId: 999999,
  });
  assert.equal(result.status, 404);
});

test('lists transactions newest by date first', async () => {
  await call('POST', '/transactions', { type: 'sale', amount: 100, date: '2026-09-21' });
  await call('POST', '/transactions', { type: 'sale', amount: 300, date: '2026-09-23' });
  await call('POST', '/transactions', { type: 'sale', amount: 200, date: '2026-09-22' });

  const result = await call('GET', '/transactions');
  const transactions = (result.data as { transactions: Transaction[] }).transactions;
  assert.ok(transactions.length >= 3);
  assert.deepEqual(
    transactions.slice(0, 3).map(t => t.amount),
    [300, 200, 100],
  );
});

test('deleting a sale restores stock', async () => {
  const item = await createTrackedItem(5);
  const created = await call('POST', '/transactions', {
    type: 'sale',
    amount: 3500,
    date: '2026-09-12',
    itemId: item.id,
    quantity: 2,
  });
  const transactionId = (created.data as { transaction: Transaction }).transaction.id;

  const before = await call('GET', `/items/${item.id}`);
  assert.equal((before.data as { item: Item }).item.stock, 3);

  const removed = await call('DELETE', `/transactions/${transactionId}`);
  assert.equal(removed.status, 204);

  const after = await call('GET', `/items/${item.id}`);
  assert.equal((after.data as { item: Item }).item.stock, 5);
});

test('deleting a purchase removes the added stock (clamped at zero)', async () => {
  const item = await createTrackedItem(2);
  const created = await call('POST', '/transactions', {
    type: 'purchase',
    amount: 60000,
    date: '2026-09-12',
    itemId: item.id,
    quantity: 10,
  });
  const transactionId = (created.data as { transaction: Transaction }).transaction.id;
  const boosted = await call('GET', `/items/${item.id}`);
  assert.equal((boosted.data as { item: Item }).item.stock, 12);

  const removed = await call('DELETE', `/transactions/${transactionId}`);
  assert.equal(removed.status, 204);

  const after = await call('GET', `/items/${item.id}`);
  assert.equal((after.data as { item: Item }).item.stock, 2);
});

test('records money added (capital) with no stock effect', async () => {
  const item = await createTrackedItem(4);

  const result = await call('POST', '/transactions', {
    type: 'capital',
    amount: 100000,
    date: '2026-09-12',
    description: 'Starting cash',
  });
  assert.equal(result.status, 201);
  const transaction = (result.data as { transaction: Transaction }).transaction;
  assert.equal(transaction.type, 'capital');
  assert.equal(transaction.amount, 100000);
  assert.equal(transaction.item, undefined);

  const updated = await call('GET', `/items/${item.id}`);
  assert.equal((updated.data as { item: Item }).item.stock, 4);
});

test('rejects capital that links to an item', async () => {
  const item = await createTrackedItem(2);
  const result = await call('POST', '/transactions', {
    type: 'capital',
    amount: 50000,
    date: '2026-09-12',
    itemId: item.id,
  });
  assert.equal(result.status, 400);
});

test('deleting capital does not touch stock', async () => {
  const item = await createTrackedItem(6);
  const created = await call('POST', '/transactions', {
    type: 'capital',
    amount: 20000,
    date: '2026-09-12',
  });
  const transactionId = (created.data as { transaction: Transaction }).transaction.id;

  const removed = await call('DELETE', `/transactions/${transactionId}`);
  assert.equal(removed.status, 204);

  const updated = await call('GET', `/items/${item.id}`);
  assert.equal((updated.data as { item: Item }).item.stock, 6);
});

test('gets a single transaction', async () => {
  const created = await call('POST', '/transactions', {
    type: 'purchase',
    amount: 20000,
    date: '2026-09-12',
    description: 'Bags',
  });
  const transactionId = (created.data as { transaction: Transaction }).transaction.id;

  const result = await call('GET', `/transactions/${transactionId}`);
  assert.equal(result.status, 200);
  assert.equal(
    (result.data as { transaction: Transaction }).transaction.description,
    'Bags',
  );
});

test('isolation: another user cannot see or delete these transactions', async () => {
  const other = await fetch(`${baseUrl}/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      firstName: 'Autre',
      lastName: 'Boutique',
      email: 'autre@transactions.cm',
      password: 'boutique1',
    }),
  });
  const auth = (await other.json()) as unknown as AuthResult;
  const otherToken = auth.token;

  const list = await fetch(`${baseUrl}/transactions`, {
    headers: { Authorization: `Bearer ${otherToken}` },
  });
  assert.equal(((await list.json()) as { transactions: Transaction[] }).transactions.length, 0);

  const created = await call('POST', '/transactions', {
    type: 'sale',
    amount: 900,
    date: '2026-09-12',
  });
  const transactionId = (created.data as { transaction: Transaction }).transaction.id;

  const get = await fetch(`${baseUrl}/transactions/${transactionId}`, {
    headers: { Authorization: `Bearer ${otherToken}` },
  });
  assert.equal(get.status, 404);

  const del = await fetch(`${baseUrl}/transactions/${transactionId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${otherToken}` },
  });
  assert.equal(del.status, 404);

  const stillThere = await call('GET', `/transactions/${transactionId}`);
  assert.equal(stillThere.status, 200);
});