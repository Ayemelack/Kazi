import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import type { Server } from 'node:http';
import { fileURLToPath } from 'node:url';
import type Database from 'better-sqlite3';
import { isTooCommonPassword } from '@kazi/shared';
import { openDatabase } from '../db/index.js';
import { createApp } from '../app.js';
import { commonPasswordCount } from './passwordPolicy.js';
import { issueResetCode } from './service.js';

let server: Server;
let baseUrl: string;
let db: Database.Database;

// Every test gets its own database and app, so the per-path rate limits
// (signup allows 12 per 15 minutes) never carry over between tests.
beforeEach(async () => {
  process.env.JWT_SECRET = 'test-secret-not-for-production';

  db = openDatabase({ filename: ':memory:' });
  const app = createApp(db);
  server = app.listen(0);
  await new Promise<void>(resolve => server.once('listening', () => resolve()));

  const address = server.address();
  baseUrl = `http://localhost:${typeof address === 'object' && address ? address.port : 4000}`;
});

afterEach(() => {
  server.close();
  db.close();
});

async function call(
  method: string,
  path: string,
  body?: unknown,
  token?: string,
): Promise<{ status: number; data: Record<string, unknown> }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, data: text ? (JSON.parse(text) as Record<string, unknown>) : {} };
}

function errorOf(data: Record<string, unknown>): { code?: string; field?: string; rule?: string } {
  return (data.error as { code?: string; field?: string; rule?: string } | undefined) ?? {};
}

async function signup(email: string, password: string, names = { firstName: 'Ngum', lastName: 'Achu' }) {
  return call('POST', '/auth/signup', { ...names, email, password });
}

function userCount(email: string): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM users WHERE email = ?').get(email) as { n: number }).n;
}

// A code issued the way forgot-password does (KZ-06; delivery is tested in
// reset.test.ts).
function resetCodeFor(email: string): string {
  const issued = issueResetCode(db, email);
  assert.ok(issued, email);
  return issued.code;
}

// ── KZ-05: common passwords instead of the password-uniqueness oracle ──

test('the server list has at least 10 000 entries', () => {
  assert.ok(commonPasswordCount() >= 10000, `${commonPasswordCount()} entries`);
});

test('two accounts can use the same strong password, and a reset can pick it too', async () => {
  assert.equal((await signup('first.shared@market.cm', 'mboaLedger2026')).status, 201);
  assert.equal((await signup('second.shared@market.cm', 'mboaLedger2026')).status, 201);
  assert.equal((await signup('third.shared@market.cm', 'ownLedger7788')).status, 201);

  for (const email of ['first.shared@market.cm', 'second.shared@market.cm']) {
    const login = await call('POST', '/auth/login', { email, password: 'mboaLedger2026' });
    assert.equal(login.status, 200, email);
  }

  const code = resetCodeFor('third.shared@market.cm');
  const reset = await call('POST', '/auth/reset-password', { email: 'third.shared@market.cm', code, password: 'mboaLedger2026' });
  assert.equal(reset.status, 200);
});

test('common passwords are refused at signup with PASSWORD_TOO_COMMON on the password field', async () => {
  const cases = [
    'Password123', // listed word with digits, any case
    'trustno1', // listed as is
    'qwerty123', // keyboard walk
    'Azerty2026', // French keyboard walk
    'abcd1234', // runs
    'aaaa1111', // repeats
    'Wrinkle1', // only on the server's full list, not the app's top 1000
  ];
  for (const [i, password] of cases.entries()) {
    const email = `common${i}@market.cm`;
    const result = await signup(email, password);
    assert.equal(result.status, 400, password);
    const { code, field, rule } = errorOf(result.data);
    assert.deepEqual({ code, field, rule }, {
      code: 'PASSWORD_TOO_COMMON',
      field: 'password',
      rule: 'notAllowed',
    });
    assert.equal(userCount(email), 0, `${password}: no account created`);
  }
  // The app's quick check misses this one; the server is the authority.
  assert.equal(isTooCommonPassword('Wrinkle1'), false);
});

test('passwords containing the email local part or a name (4+ letters) are refused', async () => {
  const names = { firstName: 'Mbango', lastName: 'Essomba' };
  for (const [i, password] of ['ESSOMBA2026x', 'mbango-77ledger', 'Kribi.Market9'].entries()) {
    const email = i === 2 ? 'kribi.market@shop.cm' : `owner${i}@shop.cm`;
    const result = await signup(email, password, names);
    assert.equal(result.status, 400, password);
    assert.equal(errorOf(result.data).code, 'PASSWORD_TOO_COMMON', password);
  }
  // "Awa" is shorter than 4 characters, so it may appear.
  const short = await signup('short.name@shop.cm', 'awaLedger2026', { firstName: 'Awa', lastName: 'Bi' });
  assert.equal(short.status, 201);
});

test('a password reset refuses a common or personal password and leaves the account as it was', async () => {
  assert.equal((await signup('resetter@market.cm', 'firstLedger2026')).status, 201);
  const code = resetCodeFor('resetter@market.cm');

  for (const password of ['Password123', 'achuLedger2026', 'resetter99']) {
    const refused = await call('POST', '/auth/reset-password', { email: 'resetter@market.cm', code, password });
    assert.equal(refused.status, 400, password);
    assert.equal(errorOf(refused.data).code, 'PASSWORD_TOO_COMMON', password);
  }

  const old = await call('POST', '/auth/login', { email: 'resetter@market.cm', password: 'firstLedger2026' });
  assert.equal(old.status, 200, 'the old password still works');

  // A refused password does not use up the code.
  const ok = await call('POST', '/auth/reset-password', { email: 'resetter@market.cm', code, password: 'secondLedger2026' });
  assert.equal(ok.status, 200);
});

test('password_fingerprints is gone from the database and the code', () => {
  const table = db
    .prepare("SELECT name FROM sqlite_master WHERE name LIKE '%password_fingerprints%'")
    .all();
  assert.deepEqual(table, []);

  // Only the frozen baseline (which once created it), the migration that
  // drops it and the legacy test fixture may still name it.
  const allowed = new Set([
    path.join('db', 'migrations', '0001_baseline.ts'),
    path.join('db', 'migrations', '0004_drop_password_fingerprints.ts'),
    path.join('db', 'migrations', 'index.ts'), // imports the 0004 file by name
    path.join('db', 'legacyFixtures.ts'),
  ]);
  const srcDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
        const rel = path.relative(srcDir, full);
        const text = fs.readFileSync(full, 'utf8');
        if (!allowed.has(rel) && /password_fingerprints|hashPasswordFingerprint|PASSWORD_NOT_ALLOWED/.test(text)) {
          offenders.push(rel);
        }
      }
    }
  };
  walk(srcDir);
  assert.deepEqual(offenders, []);
});

// ── KZ-20: deleting the account needs the password ──

async function itemCount(userId: number): Promise<number> {
  return (db.prepare('SELECT COUNT(*) AS n FROM items WHERE user_id = ?').get(userId) as { n: number }).n;
}

test('DELETE /auth/me with a wrong or missing password deletes nothing', async () => {
  const created = await signup('keeper@market.cm', 'tenantShop2026x');
  assert.equal(created.status, 201);
  const token = created.data.token as string;
  const userId = (created.data.user as { id: number }).id;
  const item = await call('POST', '/items', { name: 'Rice', type: 'product', price: 1000 }, token);
  assert.equal(item.status, 201);

  const wrong = await call('DELETE', '/auth/me', { password: 'not-the-password-1' }, token);
  assert.equal(wrong.status, 401);
  assert.equal(errorOf(wrong.data).code, 'INVALID_CREDENTIALS');

  const missing = await call('DELETE', '/auth/me', {}, token);
  assert.equal(missing.status, 400);
  assert.equal(errorOf(missing.data).code, 'VALIDATION_ERROR');
  assert.equal(errorOf(missing.data).field, 'password');

  const empty = await call('DELETE', '/auth/me', { password: '' }, token);
  assert.equal(empty.status, 400);

  // The account, its session and its data are intact.
  assert.equal(userCount('keeper@market.cm'), 1);
  assert.equal(await itemCount(userId), 1);
  assert.equal((await call('GET', '/auth/me', undefined, token)).status, 200);

  const right = await call('DELETE', '/auth/me', { password: 'tenantShop2026x' }, token);
  assert.equal(right.status, 204);
  assert.equal(userCount('keeper@market.cm'), 0);
  assert.equal(await itemCount(userId), 0);
});

test('DELETE /auth/me needs a session before the password is checked', async () => {
  const result = await call('DELETE', '/auth/me', { password: 'whatever-it-is-1' });
  assert.equal(result.status, 401);
  assert.notEqual(errorOf(result.data).code, 'INVALID_CREDENTIALS');
});

test('DELETE /auth/me is rate-limited like login', async () => {
  const created = await signup('guessed@market.cm', 'strongShop2026x');
  const token = created.data.token as string;
  let status = 0;
  let attempts = 0;
  while (attempts < 30) {
    attempts += 1;
    status = (await call('DELETE', '/auth/me', { password: `wrong-guess-${attempts}` }, token)).status;
    if (status === 429) break;
    assert.equal(status, 401);
  }
  assert.equal(status, 429);
  assert.equal(attempts, 26, '25 attempts allowed, the 26th refused');
  assert.equal(userCount('guessed@market.cm'), 1);
});
