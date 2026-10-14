import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { Server } from 'node:http';
import { openDatabase } from '../db/index.js';
import { createApp } from '../app.js';
import type { AuthResult } from '../auth/service.js';
import type { Item } from './service.js';

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
  authToken: string = token,
): Promise<{ status: number; data: Record<string, unknown> }> {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, data: text ? (JSON.parse(text) as Record<string, unknown>) : {} };
}

test('items require authentication', async () => {
  const result = await call('GET', '/items', undefined, '');
  assert.equal(result.status, 401);
});

test('creating an item returns it', async () => {
  const result = await call('POST', '/items', {
    name: 'Haircut',
    type: 'service',
    price: 2000,
    notes: 'Men',
  });
  assert.equal(result.status, 201);
  const item = (result.data as { item: Item }).item;
  assert.equal(item.name, 'Haircut');
  assert.equal(item.type, 'service');
  assert.equal(item.price, 2000);
  assert.equal(item.notes, 'Men');
  assert.equal(typeof item.id, 'number');
});

test('rejects an invalid item', async () => {
  const result = await call('POST', '/items', {
    name: 'X',
    type: 'widget',
    price: -5,
  });
  assert.equal(result.status, 400);
});

const SAMPLE_IMAGE =
  'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////wAALCAABAAEBASIA/up';

test('creates and returns an item with an image', async () => {
  const result = await call('POST', '/items', {
    name: 'Bag',
    type: 'product',
    price: 15000,
    image: SAMPLE_IMAGE,
  });
  assert.equal(result.status, 201);
  const item = (result.data as { item: Item }).item;
  assert.equal(item.image, SAMPLE_IMAGE);
});

test('rejects an invalid image', async () => {
  const result = await call('POST', '/items', {
    name: 'Bag',
    type: 'product',
    price: 1,
    image: 'not-a-data-uri',
  });
  assert.equal(result.status, 400);
});

test('removes an item image on update', async () => {
  const created = (await call('POST', '/items', {
    name: 'Bag',
    type: 'product',
    price: 15000,
    image: SAMPLE_IMAGE,
  })).data as { item: Item };

  const result = await call('PUT', `/items/${created.item.id}`, {
    name: 'Bag',
    type: 'product',
    price: 15000,
  });
  assert.equal(result.status, 200);
  const item = (result.data as { item: Item }).item;
  assert.equal(item.image, undefined);
});

test('lists items', async () => {
  await call('POST', '/items', { name: 'Shampoo', type: 'product', price: 3500 });
  const result = await call('GET', '/items');
  assert.equal(result.status, 200);
  const items = (result.data as { items: Item[] }).items;
  assert.ok(items.length >= 2);
});

test('each user sees only their own items', async () => {
  const other = await fetch(`${baseUrl}/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      firstName: 'Marc',
      lastName: 'Dupont',
      email: 'other@example.com',
      password: 'secondShop123',
    }),
  });
  const otherAuth = (await other.json()) as unknown as AuthResult;

  const result = await call('GET', '/items', undefined, otherAuth.token);
  assert.equal(result.status, 200);
  assert.deepEqual((result.data as { items: Item[] }).items, []);
});

test('updates an item', async () => {
  const created = (await call('POST', '/items', { name: 'Manicure', type: 'service', price: 3000 }))
    .data as { item: Item };
  const result = await call('PUT', `/items/${created.item.id}`, {
    name: 'Premium Manicure',
    type: 'service',
    price: 4500,
  });
  assert.equal(result.status, 200);
  const item = (result.data as { item: Item }).item;
  assert.equal(item.name, 'Premium Manicure');
  assert.equal(item.price, 4500);
});

test('updates a missing item with 404', async () => {
  const result = await call('PUT', '/items/99999', {
    name: 'Whatever',
    type: 'product',
    price: 100,
  });
  assert.equal(result.status, 404);
});

test('cannot touch another user item', async () => {
  const other = await fetch(`${baseUrl}/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      firstName: 'Thierry',
      lastName: 'Mbarga',
      email: 'third@example.com',
      password: 'shopTrois123',
    }),
  });
  const otherAuth = (await other.json()) as unknown as AuthResult;

  const created = (await call('POST', '/items', { name: 'Lipstick', type: 'product', price: 1500 }))
    .data as { item: Item };

  const forbiddenUpdate = await call('PUT', `/items/${created.item.id}`, {
    name: 'Sneaky',
    type: 'product',
    price: 1,
  }, otherAuth.token);
  assert.equal(forbiddenUpdate.status, 404);

  const forbiddenDelete = await call('DELETE', `/items/${created.item.id}`, undefined, otherAuth.token);
  assert.equal(forbiddenDelete.status, 404);
});

test('deletes an item', async () => {
  const created = (await call('POST', '/items', { name: 'Temporary', type: 'product', price: 1 }))
    .data as { item: Item };

  const result = await call('DELETE', `/items/${created.item.id}`);
  assert.equal(result.status, 204);

  const gone = await call('GET', `/items/${created.item.id}`);
  assert.equal(gone.status, 404);
});