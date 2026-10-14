// KZ-12: error responses carry a stable code from @kazi/shared, and a
// validation error also says which field failed and why (field + rule), so the
// app can show it in the user's language. `message` stays for logs.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { Server } from 'node:http';
import { z } from 'zod';
import type Database from 'better-sqlite3';
import { API_ERROR_CODES, VALIDATION_FIELDS, VALIDATION_RULES } from '@kazi/shared';
import { openDatabase } from './db/index.js';
import { createApp } from './app.js';
import * as activityValidation from './activity/validation.js';
import * as authValidation from './auth/validation.js';
import * as debtsValidation from './debts/validation.js';
import * as feedbackValidation from './feedback/validation.js';
import * as itemsValidation from './items/validation.js';
import * as notificationsValidation from './notifications/validation.js';
import * as transactionsValidation from './transactions/validation.js';

let server: Server;
let baseUrl: string;
let db: Database.Database;
let token: string;

interface ErrorBody {
  code: string;
  message: string;
  field?: string;
  rule?: string;
}

async function call(
  method: string,
  path: string,
  body?: unknown,
  raw?: string,
): Promise<{ status: number; error: ErrorBody }> {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
  });
  const data = (await response.json()) as { error: ErrorBody };
  return { status: response.status, error: data.error };
}

before(async () => {
  process.env.JWT_SECRET = 'test-secret-not-for-production';
  db = openDatabase({ filename: ':memory:' });
  server = createApp(db).listen(0);
  await new Promise<void>(resolve => server.once('listening', () => resolve()));
  const address = server.address();
  baseUrl = `http://localhost:${typeof address === 'object' && address ? address.port : 4000}`;

  const signup = await fetch(`${baseUrl}/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      firstName: 'Ada',
      lastName: 'Ngono',
      email: 'ada.errors@example.com',
      password: 'ledgerErr123',
    }),
  });
  token = ((await signup.json()) as { token: string }).token;
});

after(() => {
  server.close();
});

const sale = { type: 'sale', amount: 1000, date: '2026-01-15' };

const cases: Array<[string, string, string, unknown, string | undefined, string]> = [
  ['missing field', 'POST', '/auth/login', { password: 'x' }, 'email', 'required'],
  ['empty required text', 'POST', '/auth/login', { email: '', password: 'x' }, 'email', 'required'],
  ['bad email', 'POST', '/auth/login', { email: 'nope', password: 'x' }, 'email', 'format'],
  ['text too long', 'PATCH', '/auth/me', { companyName: 'x'.repeat(101), businessType: 'Shop' }, 'companyName', 'tooLong'],
  ['text too short', 'PATCH', '/auth/me', { companyName: 'x', businessType: 'Shop' }, 'companyName', 'tooShort'],
  ['password over 72 bytes', 'POST', '/auth/signup', { firstName: 'A', lastName: 'B', email: 'a@b.cm', password: `a1${'é'.repeat(36)}` }, 'password', 'tooLong'],
  ['fractional money', 'POST', '/transactions', { ...sale, amount: 12.5 }, 'amount', 'format'],
  ['zero money', 'POST', '/transactions', { ...sale, amount: 0 }, 'amount', 'tooSmall'],
  ['money too large', 'POST', '/transactions', { ...sale, amount: 1e13 }, 'amount', 'tooLarge'],
  ['missing money', 'POST', '/transactions', { type: 'sale', date: '2026-01-15' }, 'amount', 'required'],
  ['unknown enum value', 'POST', '/transactions', { ...sale, type: 'gift' }, 'type', 'notAllowed'],
  ['impossible date', 'POST', '/transactions', { ...sale, date: '2026-02-30' }, 'date', 'format'],
  ['date before the window', 'POST', '/transactions', { ...sale, date: '1999-12-31' }, 'date', 'tooEarly'],
  ['date after the window', 'POST', '/transactions', { ...sale, date: '2999-01-01' }, 'date', 'tooLate'],
  ['expense without a description', 'POST', '/transactions', { ...sale, type: 'purchase' }, 'description', 'required'],
  ['quantity without an item', 'POST', '/transactions', { ...sale, quantity: 2 }, 'itemId', 'required'],
  ['capital linked to an item', 'POST', '/transactions', { ...sale, type: 'capital', itemId: 1 }, 'itemId', 'notAllowed'],
  ['non-numeric query value', 'GET', '/activity?limit=abc', undefined, 'limit', 'invalid'],
  ['inverted date range', 'GET', '/activity?startDate=2026-02-01&endDate=2026-01-01', undefined, 'startDate', 'tooLate'],
];

for (const [name, method, path, body, field, rule] of cases) {
  test(`validation error carries field and rule: ${name}`, async () => {
    const { status, error } = await call(method, path, body);
    assert.equal(status, 400);
    assert.equal(error.code, 'VALIDATION_ERROR');
    assert.equal(error.field, field);
    assert.equal(error.rule, rule);
    assert.equal(typeof error.message, 'string');
    assert.ok(error.message.length > 0, 'message is kept for logs');
  });
}

test('malformed JSON is a VALIDATION_ERROR with rule format and no field', async () => {
  const { status, error } = await call('POST', '/auth/login', undefined, '{"email":');
  assert.equal(status, 400);
  assert.deepEqual(
    { code: error.code, field: error.field, rule: error.rule },
    { code: 'VALIDATION_ERROR', field: undefined, rule: 'format' },
  );
});

test('non-validation errors carry only a shared code and a message', async () => {
  token = '';
  const { status, error } = await call('GET', '/auth/me');
  assert.equal(status, 401);
  assert.deepEqual(Object.keys(error).sort(), ['code', 'message']);
  assert.ok((API_ERROR_CODES as readonly string[]).includes(error.code));
});

test('every rule the server can send is in the shared list', () => {
  for (const [, , , , , rule] of cases) {
    assert.ok((VALIDATION_RULES as readonly string[]).includes(rule), rule);
  }
});

// Collects the top-level keys of every exported object schema, looking
// through .optional(), .superRefine() and similar wrappers.
function objectKeys(schema: unknown): string[] {
  if (schema instanceof z.ZodObject) {
    return Object.keys(schema.shape as Record<string, unknown>);
  }
  if (schema instanceof z.ZodEffects) {
    return objectKeys(schema.innerType());
  }
  if (schema instanceof z.ZodOptional || schema instanceof z.ZodNullable) {
    return objectKeys(schema.unwrap());
  }
  return [];
}

test('every field a request schema validates is in the shared field list', () => {
  const modules = [
    activityValidation,
    authValidation,
    debtsValidation,
    feedbackValidation,
    itemsValidation,
    notificationsValidation,
    transactionsValidation,
  ];
  const keys = new Set(modules.flatMap(m => Object.values(m).flatMap(objectKeys)));
  assert.ok(keys.size >= 20, `found ${keys.size} schema fields`);
  const unknown = [...keys].filter(k => !(VALIDATION_FIELDS as readonly string[]).includes(k));
  assert.deepEqual(unknown, []);
});
