import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { Server } from 'node:http';
import type Database from 'better-sqlite3';
import { openDatabase } from '../db/index.js';
import { createApp } from '../app.js';
import type { AuthResult } from '../auth/service.js';

let server: Server;
let baseUrl: string;
let db: Database.Database;

before(async () => {
  process.env.JWT_SECRET = 'test-secret-not-for-production';

  db = openDatabase({ filename: ':memory:' });
  const app = createApp(db);
  server = app.listen(0);
  await new Promise<void>(resolve => server.once('listening', () => resolve()));

  const address = server.address();
  baseUrl = `http://localhost:${typeof address === 'object' && address ? address.port : 4000}`;
});

after(() => {
  server.close();
});

async function call(
  method: string,
  path: string,
  body?: unknown,
  token?: string,
): Promise<{ status: number; data: Record<string, unknown> }> {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, data: text ? (JSON.parse(text) as Record<string, unknown>) : {} };
}

function errorCode(data: Record<string, unknown>): string {
  return (data.error as { code?: string } | undefined)?.code ?? '';
}

function errorMessage(data: Record<string, unknown>): string {
  return (data.error as { message?: string } | undefined)?.message ?? '';
}

async function signup(email: string, password: string): Promise<string> {
  const result = await call('POST', '/auth/signup', {
    firstName: 'History',
    lastName: 'Tester',
    email,
    password,
  });
  assert.equal(result.status, 201, `signup ${email}`);
  return (result.data as unknown as AuthResult).token;
}

interface ActivityData {
  events: { id: number; type: string; title?: string; eventDate?: string }[];
  summary: { received: number; spent: number; made: number; capital: number };
  totalCount: number;
  hasMore: boolean;
}

async function activity(
  token: string,
  query: string,
): Promise<{ status: number; body: ActivityData }> {
  const result = await call('GET', `/activity${query}`, undefined, token);
  return { status: result.status, body: result.data as unknown as ActivityData };
}

interface SummaryData {
  todayReceived: number;
  todaySpent: number;
  todayNet: number;
  totalReceived: number;
  totalSpent: number;
  totalNet: number;
  totalCapital: number;
}

async function summary(token: string): Promise<SummaryData> {
  const result = await call('GET', '/summary', undefined, token);
  assert.equal(result.status, 200);
  return (result.data as { summary: SummaryData }).summary;
}

let periodToken: string;
let cascadeToken: string;
let otherToken: string;

const DAY_ONE = '2026-09-10';
const DAY_OLDER = '2026-09-05';
const DAY_ANCHOR = '2026-09-12';

test('period filters follow the caller supplied asOf day', async () => {
  periodToken = await signup('period@market.cm', 'ledgerMonth2026');

  await call(
    'POST',
    '/transactions',
    { type: 'sale', amount: 1000, description: 'Sold soap', date: DAY_ONE },
    periodToken,
  );
  await call(
    'POST',
    '/transactions',
    { type: 'purchase', amount: 400, description: 'Buy fuel', date: DAY_ONE },
    periodToken,
  );
  await call(
    'POST',
    '/transactions',
    { type: 'sale', amount: 500, description: 'Sold belt', date: DAY_OLDER },
    periodToken,
  );

  // The server clock must not decide what "today" means: the caller says.
  const today = await activity(periodToken, `?period=today&asOf=${DAY_ONE}`);
  assert.equal(today.status, 200);
  assert.equal(today.body.events.length, 2);
  assert.equal(today.body.summary.received, 1000);
  assert.equal(today.body.summary.spent, 400);
  assert.equal(today.body.summary.made, 600);

  const yesterday = await activity(periodToken, `?period=yesterday&asOf=2026-09-11`);
  assert.equal(yesterday.body.events.length, 2);

  const week = await activity(periodToken, `?period=this_week&asOf=${DAY_ANCHOR}`);
  assert.equal(week.body.events.length, 2);

  const older = await activity(periodToken, `?period=older&asOf=${DAY_ANCHOR}`);
  assert.equal(older.body.events.length, 1);
  assert.equal(older.body.summary.received, 500);

  const all = await activity(periodToken, '?period=all');
  assert.equal(all.body.events.length, 3);
});

test('range filters accept one bound, reject an inverted range', async () => {
  const fromOnly = await activity(periodToken, `?startDate=${DAY_ONE}`);
  assert.equal(fromOnly.status, 200);
  assert.equal(fromOnly.body.events.length, 2);

  const toOnly = await activity(periodToken, `?endDate=${DAY_OLDER}`);
  assert.equal(toOnly.status, 200);
  assert.equal(toOnly.body.events.length, 1);

  const both = await activity(periodToken, `?startDate=${DAY_OLDER}&endDate=${DAY_ONE}`);
  assert.equal(both.status, 200);
  assert.equal(both.body.events.length, 3);

  const inverted = await activity(periodToken, `?startDate=${DAY_ONE}&endDate=${DAY_OLDER}`);
  assert.equal(inverted.status, 400);
  assert.equal(errorCode(inverted.body as unknown as Record<string, unknown>), 'VALIDATION_ERROR');

  const nonsense = await activity(periodToken, '?asOf=2026-02-30');
  assert.equal(nonsense.status, 400);
});

test('history paginates with a stable total', async () => {
  const first = await activity(periodToken, '?period=all&limit=2');
  assert.equal(first.body.events.length, 2);
  assert.equal(first.body.totalCount, 3);
  assert.equal(first.body.hasMore, true);

  const second = await activity(periodToken, '?period=all&limit=2&offset=2');
  assert.equal(second.body.events.length, 1);
  assert.equal(second.body.hasMore, false);
});

test('a purchase must say what the money was spent on', async () => {
  const missing = await call(
    'POST',
    '/transactions',
    { type: 'purchase', amount: 900, date: DAY_ONE },
    periodToken,
  );
  assert.equal(missing.status, 400);
  assert.equal(errorCode(missing.data), 'VALIDATION_ERROR');
  assert.ok(errorMessage(missing.data).includes('Describe what the money was spent on.'));

  const items = await call('POST', '/items', {
    name: 'Sugar 1kg',
    type: 'product',
    price: 1200,
  }, periodToken);
  assert.equal(items.status, 201);
  const itemId = (items.data as { item: { id: number } }).item.id;

  const withItem = await call(
    'POST',
    '/transactions',
    { type: 'purchase', amount: 900, date: DAY_ONE, itemId, quantity: 3 },
    periodToken,
  );
  assert.equal(withItem.status, 201);

  // A sale still works without a description: general income is allowed.
  const sale = await call(
    'POST',
    '/transactions',
    { type: 'sale', amount: 250, date: DAY_ONE },
    periodToken,
  );
  assert.equal(sale.status, 201);
});

test('amounts and dates reject non-money and impossible values', async () => {
  const amountCases: unknown[] = [true, [800], 'abc', {}, null];
  for (const amount of amountCases) {
    const result = await call(
      'POST',
      '/transactions',
      { type: 'sale', amount, date: DAY_ONE },
      periodToken,
    );
    assert.equal(result.status, 400, `amount ${JSON.stringify(amount)}`);
    assert.equal(errorCode(result.data), 'VALIDATION_ERROR');
  }

  const badDates = ['2026-02-30', '1999-01-01', '10-07-2026', '2031-01-01'];
  for (const date of badDates) {
    const result = await call(
      'POST',
      '/transactions',
      { type: 'sale', amount: 100, date },
      periodToken,
    );
    assert.equal(result.status, 400, `date ${date}`);
    assert.equal(errorCode(result.data), 'VALIDATION_ERROR');
  }

  const badDebt = await call(
    'POST',
    '/debts',
    { name: 'Late', amount: 500, date: '2026-02-30' },
    periodToken,
  );
  assert.equal(badDebt.status, 400);
  assert.equal(errorCode(badDebt.data), 'VALIDATION_ERROR');
});

test('paging bounds and coerced number tricks are rejected as 400s', async () => {
  // Regression: an unbounded OFFSET made SQLite raise SQLITE_MISMATCH, which
  // the error handler reported as a 500 with a stack trace.
  const paging = [
    '?limit=1e308',
    '?offset=1e18',
    '?offset=1e308',
    '?limit=0',
    '?limit=201',
    '?limit=abc',
    '?offset=-5',
  ];
  for (const query of paging) {
    const result = await activity(periodToken, query);
    assert.equal(result.status, 400, query);
    assert.equal(
      errorCode(result.body as unknown as Record<string, unknown>),
      'VALIDATION_ERROR',
      query,
    );
  }

  // Regression: z.coerce.number() turned these into real numbers, so a client
  // could store 16 where it appeared to send a flag or a hex string.
  const hostileAmounts: unknown[] = ['0x10', true, '0b10000'];
  for (const amount of hostileAmounts) {
    const result = await call(
      'POST',
      '/transactions',
      { type: 'sale', amount, date: DAY_ONE },
      periodToken,
    );
    assert.equal(result.status, 400, `amount ${JSON.stringify(amount)}`);
    assert.equal(errorCode(result.data), 'VALIDATION_ERROR', `amount ${JSON.stringify(amount)}`);
  }

  const hostilePrice = await call(
    'POST',
    '/items',
    { name: 'Flagged', type: 'product', price: true },
    periodToken,
  );
  assert.equal(hostilePrice.status, 400);
  assert.equal(errorCode(hostilePrice.data), 'VALIDATION_ERROR');

  const item = await call(
    'POST',
    '/items',
    { name: 'Rice bag', type: 'product', price: 5000 },
    periodToken,
  );
  assert.equal(item.status, 201);
  const itemId = (item.data as { item: { id: number } }).item.id;

  const hostileQuantity = await call(
    'POST',
    '/transactions',
    { type: 'sale', amount: 5000, date: DAY_ONE, itemId, quantity: '0x10' },
    periodToken,
  );
  assert.equal(hostileQuantity.status, 400);
  assert.equal(errorCode(hostileQuantity.data), 'VALIDATION_ERROR');
});

test('deleting a transaction removes its history entry and keeps totals in step', async () => {
  cascadeToken = await signup('cascade@market.cm', 'ledgerChain2026');

  const sale = await call(
    'POST',
    '/transactions',
    { type: 'sale', amount: 1000, description: 'Sold shoes', date: DAY_ONE },
    cascadeToken,
  );
  const saleId = (sale.data as { transaction: { id: number } }).transaction.id;

  await call(
    'POST',
    '/transactions',
    { type: 'purchase', amount: 400, description: 'Restock', date: DAY_ONE },
    cascadeToken,
  );
  await call(
    'POST',
    '/transactions',
    { type: 'capital', amount: 5000, date: '2026-09-08' },
    cascadeToken,
  );

  const before = await activity(cascadeToken, '?period=all');
  const beforeSummary = await summary(cascadeToken);
  assert.equal(before.body.events.length, 3);
  assert.equal(before.body.summary.received, beforeSummary.totalReceived);
  assert.equal(before.body.summary.spent, beforeSummary.totalSpent);
  assert.equal(before.body.summary.capital, beforeSummary.totalCapital);

  const removed = await call('DELETE', `/transactions/${saleId}`, undefined, cascadeToken);
  assert.equal(removed.status, 204);

  const after = await activity(cascadeToken, '?period=all');
  const afterSummary = await summary(cascadeToken);
  assert.equal(after.body.events.length, 2);
  assert.equal(
    after.body.events.some(event => event.type === 'sale'),
    false,
    'the deleted sale must not appear in history',
  );
  assert.equal(after.body.summary.received, 0);
  assert.equal(after.body.summary.received, afterSummary.totalReceived);
  assert.equal(after.body.summary.spent, afterSummary.totalSpent);
  assert.equal(after.body.summary.capital, afterSummary.totalCapital);
  assert.equal(afterSummary.totalReceived, 0);
});

test('deleting a debt removes its history entries', async () => {
  const created = await call(
    'POST',
    '/debts',
    { name: 'Mama Rose', amount: 3000, date: DAY_ONE },
    cascadeToken,
  );
  assert.equal(created.status, 201);
  const debtId = (created.data as { debt: { id: number } }).debt.id;

  const withDebt = await activity(cascadeToken, '?period=all');
  assert.ok(withDebt.body.events.some(event => event.type === 'debt_added'));

  const removed = await call('DELETE', `/debts/${debtId}`, undefined, cascadeToken);
  assert.equal(removed.status, 204);

  const afterDebt = await activity(cascadeToken, '?period=all');
  assert.equal(
    afterDebt.body.events.some(event => event.type === 'debt_added'),
    false,
    'a deleted debt must not appear in history',
  );
});

test('deleting an item removes its product history entries', async () => {
  const created = await call('POST', '/items', {
    name: 'Bar soap',
    type: 'product',
    price: 500,
  }, cascadeToken);
  assert.equal(created.status, 201);
  const itemId = (created.data as { item: { id: number } }).item.id;

  const withItem = await activity(cascadeToken, '?period=all');
  assert.ok(withItem.body.events.some(event => event.type === 'product_added'));

  const removed = await call('DELETE', `/items/${itemId}`, undefined, cascadeToken);
  assert.equal(removed.status, 204);

  const afterItem = await activity(cascadeToken, '?period=all');
  assert.equal(
    afterItem.body.events.some(event => event.type === 'product_added'),
    false,
    'a deleted product must not appear in history',
  );
});

test('paying a debt honours the owner given day and stores an ISO instant', async () => {
  const created = await call(
    'POST',
    '/debts',
    { name: 'Idris', amount: 2500, date: '2026-09-01' },
    cascadeToken,
  );
  const debtId = (created.data as { debt: { id: number } }).debt.id;

  const paid = await call('POST', `/debts/${debtId}/pay`, { date: '2026-09-03' }, cascadeToken);
  assert.equal(paid.status, 200);
  const debt = (paid.data as { debt: { status: string; paidAt: string } }).debt;
  assert.equal(debt.status, 'paid');
  assert.match(debt.paidAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);

  const onPaymentDay = await activity(cascadeToken, '?period=today&asOf=2026-09-03');
  assert.equal(
    onPaymentDay.body.events.some(event => event.type === 'debt_paid'),
    true,
    'the payment must be logged on the day the owner says it was paid',
  );

  const onCreationDay = await activity(cascadeToken, '?period=today&asOf=2026-09-01');
  assert.ok(
    onCreationDay.body.events.some(event => event.type === 'debt_added' && event.title === 'Idris'),
    'the debt itself stays logged on the day it was added',
  );

  const again = await call('POST', `/debts/${debtId}/pay`, { date: '2026-09-03' }, cascadeToken);
  assert.equal(again.status, 400);
  assert.equal(errorCode(again.data), 'ALREADY_PAID');
});

test('another account sees none of this history in any period', async () => {
  otherToken = await signup('nobodyelse@market.cm', 'nobodyPass2026');

  const periods = ['today', 'yesterday', 'this_week', 'older', 'all'];
  for (const period of periods) {
    const result = await activity(otherToken, `?period=${period}&asOf=${DAY_ONE}`);
    assert.equal(result.status, 200, period);
    assert.equal(result.body.events.length, 0, `${period} must be empty for another account`);
    assert.equal(result.body.totalCount, 0);
    assert.equal(result.body.summary.received, 0);
    assert.equal(result.body.summary.spent, 0);
  }

  const ranged = await activity(otherToken, '?startDate=2026-01-01&endDate=2026-12-31');
  assert.equal(ranged.status, 200);
  assert.equal(ranged.body.events.length, 0);
});

// KZ-07: every event names the record it came from, so History can open and
// delete it; deleting through that reference restores stock and totals.
test('events carry refType and refId, and deleting through them restores stock and totals', async () => {
  const token = await signup('refs@market.cm', 'mboaLedger2026');
  const stranger = await signup('refs-other@market.cm', 'mboaLedger2026');
  const day = '2026-10-14';

  const item = await call('POST', '/items', {
    name: 'Palm oil',
    type: 'product',
    price: 1500,
    trackStock: true,
    lowStockThreshold: 1,
  }, token);
  const itemId = (item.data.item as { id: number }).id;
  await call('POST', `/items/${itemId}/stock-in`, { quantity: 10 }, token);

  const sale = await call('POST', '/transactions', {
    type: 'sale', amount: 4500, date: day, itemId, quantity: 3,
  }, token);
  const saleId = (sale.data.transaction as { id: number }).id;
  const spend = await call('POST', '/transactions', {
    type: 'purchase', amount: 800, date: day, description: 'Transport',
  }, token);
  const spendId = (spend.data.transaction as { id: number }).id;
  const capital = await call('POST', '/transactions', { type: 'capital', amount: 20000, date: day }, token);
  const capitalId = (capital.data.transaction as { id: number }).id;
  const debt = await call('POST', '/debts', { name: 'Ma Ngono', amount: 3000, date: day }, token);
  const debtId = (debt.data.debt as { id: number }).id;
  await call('POST', `/debts/${debtId}/pay`, { date: day }, token);

  const all = await call('GET', '/activity?period=all&limit=50', undefined, token);
  const events = (all.data as { events: { type: string; refType?: string; refId?: number }[] }).events;
  const refs = (type: string) => events.filter(event => event.type === type).map(event => [event.refType, event.refId]);
  assert.deepEqual(refs('sale'), [['transaction', saleId]]);
  assert.deepEqual(refs('spend'), [['transaction', spendId]]);
  assert.deepEqual(refs('capital'), [['transaction', capitalId]]);
  assert.deepEqual(refs('debt_added'), [['debt', debtId]]);
  assert.deepEqual(refs('debt_paid'), [['debt', debtId]]);
  assert.deepEqual(refs('product_added'), [['item', itemId]]);

  const stockOf = async () =>
    ((await call('GET', `/items/${itemId}`, undefined, token)).data.item as { stock: number }).stock;
  assert.equal(await stockOf(), 7);

  // Someone else can't delete it through the reference.
  const foreign = await call('DELETE', `/transactions/${saleId}`, undefined, stranger);
  assert.equal(foreign.status, 404);
  assert.equal(await stockOf(), 7);

  const today = async () => (await activity(token, `?period=today&asOf=${day}`)).body;
  const homeToday = async () =>
    ((await call('GET', `/summary?asOf=${day}`, undefined, token)).data.summary as SummaryData);
  assert.equal((await today()).summary.received, 4500);
  assert.equal((await homeToday()).todayReceived, 4500);

  const removed = await call('DELETE', `/transactions/${saleId}`, undefined, token);
  assert.equal(removed.status, 204);
  assert.equal(await stockOf(), 10);
  const after = await today();
  assert.equal(after.summary.received, 0);
  assert.equal(after.summary.made, -800);
  assert.ok(after.events.every(event => event.type !== 'sale'));
  const home = await homeToday();
  assert.equal(home.todayReceived, 0);
  assert.equal(home.todayNet, -800);
});
