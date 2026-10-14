import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { Server } from 'node:http';
import type Database from 'better-sqlite3';
import { openDatabase } from '../db/index.js';
import { createApp } from '../app.js';
import type { AuthResult } from '../auth/service.js';
import { moneySummary } from './service.js';

let server: Server;
let baseUrl: string;
let db: Database.Database;

before(async () => {
  process.env.JWT_SECRET = 'test-secret-not-for-production';
  db = openDatabase({ filename: ':memory:' });
  server = createApp(db).listen(0);
  await new Promise<void>(resolve => server.once('listening', () => resolve()));
  const address = server.address();
  baseUrl = `http://localhost:${typeof address === 'object' && address ? address.port : 4000}`;
});

after(() => {
  server.closeAllConnections();
  server.close();
});

async function signUp(email: string): Promise<string> {
  const response = await fetch(`${baseUrl}/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      firstName: 'Awa',
      lastName: 'Ndong',
      email,
      password: 'mboaLedger2026',
    }),
    signal: AbortSignal.timeout(10_000),
  });
  return ((await response.json()) as unknown as AuthResult).token;
}

async function call(
  token: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; data: Record<string, unknown> }> {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  const text = await response.text();
  return { status: response.status, data: text ? (JSON.parse(text) as Record<string, unknown>) : {} };
}

interface Summary {
  todayReceived: number;
  todaySpent: number;
  todayNet: number;
  totalReceived: number;
  totalSpent: number;
  totalNet: number;
  totalCapital: number;
  lowStockCount: number;
}

test('"today" is the owner\'s day from asOf, whatever the server clock says', async t => {
  const token = await signUp('midnight@market.cm');
  // Yesterday evening and just after midnight, in the owner's calendar.
  for (const [type, amount, date] of [
    ['sale', 4000, '2026-10-13'],
    ['purchase', 1500, '2026-10-13'],
    ['sale', 2500, '2026-10-14'],
    ['purchase', 700, '2026-10-14'],
    ['capital', 20000, '2026-10-14'],
  ] as const) {
    const created = await call(token, 'POST', '/transactions', {
      type,
      amount,
      date,
      description: 'Midnight test',
    });
    assert.equal(created.status, 201);
  }

  // 00:30 in Douala (WAT, UTC+1) is still 23:30 the day before on a UTC server.
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-13T23:30:00Z') });

  const today = await call(token, 'GET', '/summary?asOf=2026-10-14');
  assert.equal(today.status, 200);
  const summary = today.data.summary as Summary;
  assert.equal(summary.todayReceived, 2500);
  assert.equal(summary.todaySpent, 700);
  assert.equal(summary.todayNet, 1800);
  assert.equal(summary.totalReceived, 6500);
  assert.equal(summary.totalSpent, 2200);
  assert.equal(summary.totalNet, 4300);
  assert.equal(summary.totalCapital, 20000);

  // Home and History agree about "today".
  const history = await call(token, 'GET', '/activity?period=today&asOf=2026-10-14');
  const historySummary = history.data.summary as { received: number; spent: number; made: number };
  assert.equal(historySummary.received, summary.todayReceived);
  assert.equal(historySummary.spent, summary.todaySpent);
  assert.equal(historySummary.made, summary.todayNet);

  // The day before, asked for explicitly.
  const yesterday = (await call(token, 'GET', '/summary?asOf=2026-10-13')).data.summary as Summary;
  assert.equal(yesterday.todayReceived, 4000);
  assert.equal(yesterday.todaySpent, 1500);
  assert.equal(yesterday.totalReceived, 6500);
});

test('without asOf the server day is the fallback', async () => {
  const token = await signUp('fallback@market.cm');
  const now = new Date();
  const serverDay = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-');
  await call(token, 'POST', '/transactions', { type: 'sale', amount: 900, date: serverDay });
  const summary = (await call(token, 'GET', '/summary')).data.summary as Summary;
  assert.equal(summary.todayReceived, 900);
});

test('asOf is validated like every business date', async () => {
  const token = await signUp('badday@market.cm');
  for (const bad of ['2026-13-01', '14-10-2026', '1999-12-31', 'today']) {
    const result = await call(token, 'GET', `/summary?asOf=${encodeURIComponent(bad)}`);
    assert.equal(result.status, 400, bad);
    const error = result.data.error as { code: string; field: string };
    assert.equal(error.code, 'VALIDATION_ERROR');
    assert.equal(error.field, 'asOf');
  }
});

test('lowStockCount counts tracked items at or under a positive threshold, for this user only', async () => {
  const token = await signUp('lowstock@market.cm');
  const other = await signUp('neighbour@market.cm');
  const make = async (owner: string, name: string, stock: number, threshold: number, trackStock = true) => {
    const created = await call(owner, 'POST', '/items', {
      name,
      type: 'product',
      price: 100,
      trackStock,
      lowStockThreshold: threshold,
    });
    assert.equal(created.status, 201);
    const id = (created.data.item as { id: number }).id;
    if (stock > 0) {
      await call(owner, 'POST', `/items/${id}/stock-in`, { quantity: stock });
    }
  };
  await make(token, 'Under threshold', 2, 5);
  await make(token, 'At threshold', 5, 5);
  await make(token, 'Above threshold', 6, 5);
  await make(token, 'No threshold', 0, 0);
  await make(token, 'Not tracked', 0, 0, false);
  await make(token, 'Service', 0, 3, false);
  await make(other, 'Other user low', 1, 5);

  const summary = (await call(token, 'GET', '/summary?asOf=2026-10-14')).data.summary as Summary;
  assert.equal(summary.lowStockCount, 2);

  // The same rule as the item's own lowStock flag.
  const items = (await call(token, 'GET', '/items')).data.items as { lowStock: boolean }[];
  assert.equal(items.filter(item => item.lowStock).length, summary.lowStockCount);
});

test('the summary is one statement that uses the indexes', () => {
  const statements: string[] = [];
  const prepare = db.prepare.bind(db);
  (db as unknown as { prepare: (sql: string) => unknown }).prepare = (sql: string) => {
    statements.push(sql);
    return prepare(sql);
  };
  try {
    moneySummary(db, 1, '2026-10-14');
  } finally {
    (db as unknown as { prepare: typeof prepare }).prepare = prepare;
  }
  assert.equal(statements.length, 1);

  const plan = db
    .prepare(`EXPLAIN QUERY PLAN ${statements[0]}`)
    .all({ userId: 1, asOf: '2026-10-14' }) as { detail: string }[];
  const details = plan.map(row => row.detail).join('\n');
  assert.match(details, /transactions USING (COVERING )?INDEX idx_transactions_user/);
  assert.match(details, /items USING INDEX idx_items_user/);
  assert.doesNotMatch(details, /SCAN (transactions|items)\b(?! USING)/);
});
