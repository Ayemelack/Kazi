import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import type { Server } from 'node:http';
import bcrypt from 'bcryptjs';
import type Database from 'better-sqlite3';
import { openDatabase } from '../db/index.js';
import { createApp } from '../app.js';
import { BCRYPT_COST, hashPassword, prepareDummyHash, verifyPassword } from './passwordHash.js';

// KZ-21. Thresholds are relative to a measured login, not absolute
// milliseconds, so a slow or busy machine does not make these flaky.

let server: Server;
let baseUrl: string;
let db: Database.Database;

beforeEach(async () => {
  process.env.JWT_SECRET = 'test-secret-not-for-production';
  db = openDatabase({ filename: ':memory:' });
  server = createApp(db).listen(0);
  await new Promise<void>(resolve => server.once('listening', () => resolve()));
  const address = server.address();
  baseUrl = `http://localhost:${typeof address === 'object' && address ? address.port : 4000}`;
});

afterEach(() => {
  server.close();
  db.close();
});

async function timed(path: string, body?: unknown): Promise<{ status: number; ms: number }> {
  const start = performance.now();
  const response = await fetch(`${baseUrl}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  await response.arrayBuffer();
  return { status: response.status, ms: performance.now() - start };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

async function signup(email: string): Promise<void> {
  const result = await timed('/auth/signup', {
    firstName: 'Ngum',
    lastName: 'Achu',
    email,
    password: 'timingLedger2026',
  });
  assert.equal(result.status, 201);
}

test('hashes are bcrypt at cost 10 and interoperate with existing bcryptjs hashes', async () => {
  const hash = await hashPassword('timingLedger2026');
  assert.match(hash, /^\$2[aby]\$10\$/);
  assert.equal(BCRYPT_COST, 10);
  assert.equal(bcrypt.compareSync('timingLedger2026', hash), true);
  // A hash made the old (synchronous) way still verifies.
  const legacy = bcrypt.hashSync('olderLedger2024', 10);
  assert.equal(await verifyPassword('olderLedger2024', legacy), true);
  assert.equal(await verifyPassword('wrongLedger2024', legacy), false);
});

test('the dummy hash is made once, at the same cost, and matches nothing', async () => {
  const first = await prepareDummyHash();
  assert.equal(await prepareDummyHash(), first);
  assert.match(first, /^\$2[aby]\$10\$/);
  assert.equal(await verifyPassword('', first), false);
});

test('an unknown email costs a bcrypt compare like a wrong password does', async () => {
  await signup('known@market.cm');
  const known: number[] = [];
  const unknown: number[] = [];
  for (let i = 0; i < 5; i += 1) {
    const a = await timed('/auth/login', { email: 'known@market.cm', password: 'wrongLedger2026' });
    const b = await timed('/auth/login', { email: `nobody${i}@market.cm`, password: 'wrongLedger2026' });
    assert.equal(a.status, 401);
    assert.equal(b.status, 401);
    known.push(a.ms);
    unknown.push(b.ms);
  }
  // Without the dummy compare an unknown email answered in ~1 ms against
  // ~70 ms for a known one.
  assert.ok(
    median(unknown) > median(known) * 0.5,
    `unknown p50 ${median(unknown).toFixed(1)} ms vs known p50 ${median(known).toFixed(1)} ms`,
  );
});

test('/health answers during a burst of logins faster than one login takes', async () => {
  await signup('burst@market.cm');
  const single: number[] = [];
  for (let i = 0; i < 3; i += 1) {
    single.push((await timed('/auth/login', { email: 'burst@market.cm', password: 'timingLedger2026' })).ms);
  }
  const oneLogin = median(single);

  const burst = Array.from({ length: 8 }, () =>
    timed('/auth/login', { email: 'burst@market.cm', password: 'timingLedger2026' }),
  );
  await new Promise(resolve => setTimeout(resolve, 5));
  const health = await timed('/health');
  const results = await Promise.all(burst);

  assert.equal(health.status, 200);
  assert.ok(results.every(r => r.status === 200));
  // With hashing on the request thread /health queued behind the logins
  // (several × one login); off it, it does not wait for them.
  assert.ok(
    health.ms < oneLogin,
    `/health took ${health.ms.toFixed(1)} ms during the burst; one login takes ${oneLogin.toFixed(1)} ms`,
  );
});

test('two resets racing with one code: exactly one succeeds', async () => {
  await signup('racer@market.cm');
  const requested = await fetch(`${baseUrl}/auth/forgot-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'racer@market.cm', firstName: 'Ngum', lastName: 'Achu' }),
  });
  const { resetToken } = (await requested.json()) as { resetToken: string };

  // Both pass the "unused" check before either finishes hashing; the code is
  // claimed inside the transaction, so only one may change the password.
  const results = await Promise.all(
    ['mboaLedger2026', 'kribiLedger2026'].map(password =>
      timed('/auth/reset-password', { token: resetToken, password }),
    ),
  );
  assert.deepEqual(results.map(r => r.status).sort(), [200, 400]);
});
