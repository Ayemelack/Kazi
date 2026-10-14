import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import type { Server } from 'node:http';
import { MONEY_MAX } from '@kazi/shared';
import { openDatabase } from '../db/index.js';
import { createApp } from '../app.js';
import type { AuthResult } from '../auth/service.js';
import { moneyAmountSchema, priceSchema } from './money.js';

// KZ-04: the API stores whole FCFA only. It accepts a JSON integer or a string
// of plain digits and nothing else; thousands separators are parsed on the
// phone (parseMoneyInput), never here.
const ACCEPTED: ReadonlyArray<readonly [unknown, number]> = [
  [1, 1],
  [1000, 1000],
  ['1000', 1000],
  [' 2500 ', 2500],
  [MONEY_MAX, MONEY_MAX],
  [String(MONEY_MAX), MONEY_MAX],
];

const REJECTED: readonly unknown[] = [
  12.5,
  0.5,
  '12.5',
  '1,000',
  '1.000',
  '1 000',
  '1e3',
  '0x10',
  '0b10000',
  '-5',
  '+5',
  -5,
  '',
  '   ',
  true,
  null,
  [800],
  { amount: 800 },
  Number.NaN,
  Number.POSITIVE_INFINITY,
  MONEY_MAX + 1,
  String(MONEY_MAX + 1),
  '99999999999999999999',
];

describe('moneyAmountSchema', () => {
  for (const [input, expected] of ACCEPTED) {
    test(`accepts ${JSON.stringify(input)}`, () => {
      assert.equal(moneyAmountSchema.parse(input), expected);
    });
  }
  for (const input of [...REJECTED, 0, '0']) {
    test(`rejects ${String(JSON.stringify(input))}`, () => {
      assert.equal(moneyAmountSchema.safeParse(input).success, false);
    });
  }
});

describe('priceSchema', () => {
  test('accepts 0 (free or unknown)', () => {
    assert.equal(priceSchema.parse(0), 0);
    assert.equal(priceSchema.parse('0'), 0);
  });
  for (const [input, expected] of ACCEPTED) {
    test(`accepts ${JSON.stringify(input)}`, () => {
      assert.equal(priceSchema.parse(input), expected);
    });
  }
  for (const input of REJECTED) {
    test(`rejects ${String(JSON.stringify(input))}`, () => {
      assert.equal(priceSchema.safeParse(input).success, false);
    });
  }
});

describe('money routes reject fractional amounts', () => {
  let server: Server;
  let baseUrl: string;
  let token: string;

  before(async () => {
    process.env.JWT_SECRET = 'test-secret-not-for-production';
    const app = createApp(openDatabase({ filename: ':memory:' }));
    server = app.listen(0);
    await new Promise<void>(resolve => server.once('listening', () => resolve()));
    const address = server.address();
    baseUrl = `http://localhost:${typeof address === 'object' && address ? address.port : 4000}`;
    const signup = await fetch(`${baseUrl}/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        firstName: 'Awa',
        lastName: 'Money',
        email: 'awa@money.cm',
        password: 'mboaCash1234',
      }),
    });
    token = ((await signup.json()) as AuthResult).token;
  });

  after(() => {
    server.close();
  });

  async function post(path: string, body: unknown) {
    const response = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    const data = (await response.json()) as { error?: { code: string } };
    return { status: response.status, code: data.error?.code };
  }

  const today = new Date().toISOString().slice(0, 10);

  test('POST /transactions rejects amount 12.5 with VALIDATION_ERROR', async () => {
    const result = await post('/transactions', { type: 'sale', amount: 12.5, date: today });
    assert.deepEqual(result, { status: 400, code: 'VALIDATION_ERROR' });
  });

  test('POST /transactions rejects "1,000" instead of storing 1', async () => {
    const result = await post('/transactions', { type: 'sale', amount: '1,000', date: today });
    assert.deepEqual(result, { status: 400, code: 'VALIDATION_ERROR' });
  });

  test('POST /debts rejects amount 12.5 with VALIDATION_ERROR', async () => {
    const result = await post('/debts', { name: 'Paul', amount: 12.5, date: today });
    assert.deepEqual(result, { status: 400, code: 'VALIDATION_ERROR' });
  });

  test('POST /items rejects price 2500.5 with VALIDATION_ERROR', async () => {
    const result = await post('/items', { name: 'Soap', type: 'product', price: 2500.5 });
    assert.deepEqual(result, { status: 400, code: 'VALIDATION_ERROR' });
  });

  test('whole amounts are still accepted', async () => {
    assert.equal((await post('/transactions', { type: 'sale', amount: 1000, date: today })).status, 201);
    assert.equal((await post('/debts', { name: 'Paul', amount: '1000', date: today })).status, 201);
    assert.equal((await post('/items', { name: 'Soap', type: 'product', price: 0 })).status, 201);
  });
});
