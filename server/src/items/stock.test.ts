import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { Server } from 'node:http';
import { openDatabase } from '../db/index.js';
import { createApp } from '../app.js';
import type { AuthResult } from '../auth/service.js';
import type { Item, StockMovement } from './service.js';

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
      firstName: 'Awa',
      lastName: 'Nkono',
      email: 'owner@jolie.cm',
      password: 'coupe123',
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

async function createTrackedProduct(quantity?: never): Promise<Item> {
  const result = await call('POST', '/items', {
    name: 'Shampoo',
    type: 'product',
    price: 3500,
    trackStock: true,
    lowStockThreshold: 3,
  });
  return (result.data as { item: Item }).item;
}

test('creates an item with stock tracking off by default', async () => {
  const result = await call('POST', '/items', { name: 'Haircut', type: 'service', price: 2000 });
  assert.equal(result.status, 201);
  const item = (result.data as { item: Item }).item;
  assert.equal(item.stock, 0);
  assert.equal(item.trackStock, false);
  assert.equal(item.lowStock, false);
});

test('creates a tracked item with threshold', async () => {
  const item = await createTrackedProduct();
  assert.equal(item.trackStock, true);
  assert.equal(item.lowStockThreshold, 3);
  assert.equal(item.lowStock, true); // stock 0 <= threshold 3
});

test('stock-in adds quantity and records movement', async () => {
  const item = await createTrackedProduct();
  const result = await call('POST', `/items/${item.id}/stock-in`, {
    quantity: 10,
    reason: 'Bought from supplier',
  });
  assert.equal(result.status, 200);
  const { item: updated, movement } = result.data as {
    item: Item;
    movement: StockMovement;
  };
  assert.equal(updated.stock, 10);
  assert.equal(updated.lowStock, false);
  assert.equal(movement.direction, 'in');
  assert.equal(movement.quantity, 10);
  assert.equal(movement.newQuantity, 10);
  assert.equal(movement.reason, 'Bought from supplier');
});

test('stock-out removes quantity', async () => {
  const item = await createTrackedProduct();
  await call('POST', `/items/${item.id}/stock-in`, { quantity: 8 });

  const result = await call('POST', `/items/${item.id}/stock-out`, { quantity: 3 });
  assert.equal(result.status, 200);
  const { item: updated, movement } = result.data as {
    item: Item;
    movement: StockMovement;
  };
  assert.equal(updated.stock, 5);
  assert.equal(movement.direction, 'out');
  assert.equal(movement.newQuantity, 5);
});

test('stock-out below zero is rejected', async () => {
  const item = await createTrackedProduct();
  await call('POST', `/items/${item.id}/stock-in`, { quantity: 2 });

  const result = await call('POST', `/items/${item.id}/stock-out`, { quantity: 3 });
  assert.equal(result.status, 400);
  assert.equal((result.data.error as { code: string }).code, 'INSUFFICIENT_STOCK');

  const check = await call('GET', `/items/${item.id}`);
  assert.equal((check.data as { item: Item }).item.stock, 2);
});

test('rejects a zero or negative stock quantity', async () => {
  const item = await createTrackedProduct();
  const result = await call('POST', `/items/${item.id}/stock-in`, { quantity: 0 });
  assert.equal(result.status, 400);
});

test('lists movements newest first', async () => {
  const item = await createTrackedProduct();
  await call('POST', `/items/${item.id}/stock-in`, { quantity: 5 });
  await call('POST', `/items/${item.id}/stock-out`, { quantity: 2, reason: 'Used for a client' });

  const result = await call('GET', `/items/${item.id}/movements`);
  assert.equal(result.status, 200);
  const movements = (result.data as { movements: StockMovement[] }).movements;
  assert.equal(movements.length, 2);
  assert.equal(movements[0]?.direction, 'out');
  assert.equal(movements[1]?.direction, 'in');
});

test('updating an item to stop tracking zeroes the threshold but keeps stock', async () => {
  const item = await createTrackedProduct();
  await call('POST', `/items/${item.id}/stock-in`, { quantity: 7 });

  const result = await call('PUT', `/items/${item.id}`, {
    name: 'Shampoo',
    type: 'product',
    price: 3500,
    trackStock: false,
    lowStockThreshold: 3,
  });
  assert.equal(result.status, 200);
  const updated = (result.data as { item: Item }).item;
  assert.equal(updated.trackStock, false);
  assert.equal(updated.lowStockThreshold, 0);
  assert.equal(updated.lowStock, false);
  assert.equal(updated.stock, 7);
});