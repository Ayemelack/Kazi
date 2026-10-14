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

async function resetCodeFor(email: string, firstName = 'Ngum', lastName = 'Achu'): Promise<string> {
  const requested = await call('POST', '/auth/forgot-password', { email, firstName, lastName });
  assert.equal(requested.status, 200);
  return (requested.data as { resetToken: string }).resetToken;
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

  const code = await resetCodeFor('third.shared@market.cm');
  const reset = await call('POST', '/auth/reset-password', { token: code, password: 'mboaLedger2026' });
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
  const code = await resetCodeFor('resetter@market.cm');

  for (const password of ['Password123', 'achuLedger2026', 'resetter99']) {
    const refused = await call('POST', '/auth/reset-password', { token: code, password });
    assert.equal(refused.status, 400, password);
    assert.equal(errorOf(refused.data).code, 'PASSWORD_TOO_COMMON', password);
  }

  const old = await call('POST', '/auth/login', { email: 'resetter@market.cm', password: 'firstLedger2026' });
  assert.equal(old.status, 200, 'the old password still works');

  // A refused password does not use up the code.
  const ok = await call('POST', '/auth/reset-password', { token: code, password: 'secondLedger2026' });
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
