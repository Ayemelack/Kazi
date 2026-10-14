import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { Server } from 'node:http';
import type Database from 'better-sqlite3';
import { openDatabase } from './db/index.js';
import { createApp } from './app.js';
import type { AuthResult } from './auth/service.js';
import { createResetToken, hashResetToken } from './auth/jwt.js';

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

// Mirrors server-side token issuance so tests can exercise reset-password
// through the HTTP API. The raw code is never exposed by the API itself.
function issueResetToken(email: string): string {
  const user = db.prepare('SELECT id FROM users WHERE email = ?').get(email) as
    | { id: number }
    | undefined;
  assert.ok(user, `user ${email} exists before issuing a reset token`);
  const { token, expiresAt } = createResetToken();
  db.prepare(
    'INSERT INTO password_resets (token, user_id, expires_at) VALUES (?, ?, ?)',
  ).run(hashResetToken(token), user.id, expiresAt);
  return token;
}

let signupToken: string;

test('health endpoint responds ok', async () => {
  const result = await call('GET', '/health');
  assert.equal(result.status, 200);
  assert.equal(result.data.status, 'ok');
});

test('API responses include security headers', async () => {
  const response = await fetch(`${baseUrl}/health`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('x-frame-options'), 'DENY');
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(response.headers.get('x-powered-by'), null);
});

test('resource endpoints reject unauthenticated requests', async () => {
  const bannedRoutes = ['/items', '/transactions', '/debts', '/summary', '/activity', '/feedback'];
  for (const route of bannedRoutes) {
    const result = await call('GET', route);
    assert.equal(result.status, 401, `${route} should require authentication`);
    assert.equal((result.data.error as { code: string }).code, 'UNAUTHORIZED');
  }
});

test('signup creates an account with first/last name and returns a token', async () => {
  const result = await call('POST', '/auth/signup', {
    firstName: 'Awa',
    lastName: 'Nkono',
    email: 'awa@market.cm',
    password: 'coupe123',
  });
  assert.equal(result.status, 201);
  const auth = result.data as unknown as AuthResult;
  assert.equal(typeof auth.token, 'string');
  assert.equal(auth.user.firstName, 'Awa');
  assert.equal(auth.user.lastName, 'Nkono');
  assert.equal(auth.user.companyName, '');
  assert.equal(auth.user.hasBusiness, false);
  signupToken = auth.token;
});

test('signup rejects a duplicate email', async () => {
  const result = await call('POST', '/auth/signup', {
    firstName: 'Someone',
    lastName: 'Else',
    email: 'AWA@market.cm',
    password: 'coupe123',
  });
  assert.equal(result.status, 409);
  assert.equal((result.data.error as { code: string }).code, 'EMAIL_IN_USE');
});

test('signup maps a database unique-constraint race to a clean 409', async () => {
  // Insert directly into the database to bypass the pre-check so the UNIQUE
  // constraint (rather than the SELECT guard) is what rejects the signup.
  db.prepare(
    'INSERT INTO users (first_name, last_name, company_name, email, password_hash) VALUES (?, ?, ?, ?, ?)',
  ).run('Race', 'Case', '', 'race@example.com', 'not-a-real-hash');

  const result = await call('POST', '/auth/signup', {
    firstName: 'Different',
    lastName: 'Person',
    email: 'race@example.com',
    password: 'coupe123',
  });
  assert.equal(result.status, 409);
  assert.equal((result.data.error as { code: string }).code, 'EMAIL_IN_USE');
  assert.equal(typeof (result.data.error as { message: string }).message, 'string');
});

test('signup rejects invalid input', async () => {
  const result = await call('POST', '/auth/signup', {
    firstName: '',
    lastName: 'Nkono',
    email: 'not-an-email',
    password: 'short',
  });
  assert.equal(result.status, 400);
  assert.equal((result.data.error as { code: string }).code, 'VALIDATION_ERROR');
});

test('signup rejects names containing digits', async () => {
  const result = await call('POST', '/auth/signup', {
    firstName: 'Awa1967',
    lastName: 'Nkono',
    email: 'digits@market.cm',
    password: 'coupe123',
  });
  assert.equal(result.status, 400);
  assert.equal((result.data.error as { code: string }).code, 'VALIDATION_ERROR');
});

test('login succeeds with correct credentials', async () => {
  const result = await call('POST', '/auth/login', {
    email: 'awa@market.cm',
    password: 'coupe123',
  });
  assert.equal(result.status, 200);
  const auth = result.data as unknown as AuthResult;
  assert.equal(auth.user.firstName, 'Awa');
  assert.equal(auth.user.hasBusiness, false);
});

test('login fails with a wrong password', async () => {
  const result = await call('POST', '/auth/login', {
    email: 'awa@market.cm',
    password: 'wrong-password',
  });
  assert.equal(result.status, 401);
  assert.equal((result.data.error as { code: string }).code, 'INVALID_CREDENTIALS');
});

test('/me returns the current user with a valid token', async () => {
  const result = await call('GET', '/auth/me', undefined, signupToken);
  assert.equal(result.status, 200);
  const user = (result.data as { user: { email: string; hasBusiness: boolean } }).user;
  assert.equal(user.email, 'awa@market.cm');
  assert.equal(user.hasBusiness, false);
});

test('/me rejects a missing token', async () => {
  const result = await call('GET', '/auth/me');
  assert.equal(result.status, 401);
});

test('/me rejects a tampered token', async () => {
  const result = await call('GET', '/auth/me', undefined, `${signupToken}x`);
  assert.equal(result.status, 401);
});

test('PATCH /auth/me sets the business profile', async () => {
  const result = await call(
    'PATCH',
    '/auth/me',
    { companyName: 'Awa Market', businessType: 'Retail shop' },
    signupToken,
  );
  assert.equal(result.status, 200);
  const user = (result.data as { user: { companyName: string; businessType: string; hasBusiness: boolean } }).user;
  assert.equal(user.companyName, 'Awa Market');
  assert.equal(user.businessType, 'Retail shop');
  assert.equal(user.hasBusiness, true);
});

test('PATCH /auth/me rejects an empty business name', async () => {
  const result = await call(
    'PATCH',
    '/auth/me',
    { companyName: '', businessType: 'Retail shop' },
    signupToken,
  );
  assert.equal(result.status, 400);
  assert.equal((result.data.error as { code: string }).code, 'VALIDATION_ERROR');
});

test('PATCH /auth/me/names updates first and last name', async () => {
  const result = await call(
    'PATCH',
    '/auth/me/names',
    { firstName: 'Awa', lastName: 'Nkono-Bella' },
    signupToken,
  );
  assert.equal(result.status, 200);
  const user = (result.data as { user: { lastName: string } }).user;
  assert.equal(user.lastName, 'Nkono-Bella');
});

test('logout returns 204', async () => {
  const result = await call('POST', '/auth/logout', undefined, signupToken);
  assert.equal(result.status, 204);
});

test('forgot-password returns a reset token when email and names match', async () => {
  const result = await call('POST', '/auth/forgot-password', {
    firstName: 'Awa',
    lastName: 'Nkono-Bella',
    email: 'awa@market.cm',
  });
  assert.equal(result.status, 200);
  const data = result.data as { message: string; resetToken?: string };
  assert.equal(typeof data.message, 'string');
  assert.equal(typeof data.resetToken, 'string');
});

test('forgot-password rejects a request without names', async () => {
  const result = await call('POST', '/auth/forgot-password', {
    email: 'awa@market.cm',
  });
  assert.equal(result.status, 400);
  assert.equal((result.data.error as { code: string }).code, 'VALIDATION_ERROR');
});

test('forgot-password never returns a token without a matching name', async () => {
  const wrongName = await call('POST', '/auth/forgot-password', {
    firstName: 'Someone',
    lastName: 'Else',
    email: 'awa@market.cm',
  });
  const unknownEmail = await call('POST', '/auth/forgot-password', {
    firstName: 'Awa',
    lastName: 'Nkono-Bella',
    email: 'nobody@example.com',
  });
  assert.equal(wrongName.status, 200);
  assert.equal(unknownEmail.status, 200);
  assert.equal('resetToken' in wrongName.data, false);
  assert.equal('resetToken' in unknownEmail.data, false);
  assert.deepEqual(wrongName.data, unknownEmail.data);
});

test('forgot-password withholds the reset token in production', async () => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    const result = await call('POST', '/auth/forgot-password', {
      firstName: 'Awa',
      lastName: 'Nkono-Bella',
      email: 'awa@market.cm',
    });
    assert.equal(result.status, 200);
    assert.equal('resetToken' in result.data, false);
  } finally {
    process.env.NODE_ENV = previous;
  }
});

test('malformed JSON is rejected as a validation error, not a server error', async () => {
  const response = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{ this is not json',
  });
  assert.equal(response.status, 400);
  const data = (await response.json()) as { error: { code: string } };
  assert.equal(data.error.code, 'VALIDATION_ERROR');
});

test('a token from forgot-password completes the reset flow', async () => {
  const requested = await call('POST', '/auth/forgot-password', {
    firstName: 'Awa',
    lastName: 'Nkono-Bella',
    email: 'awa@market.cm',
  });
  const resetToken = (requested.data as { resetToken: string }).resetToken;

  const reset = await call('POST', '/auth/reset-password', {
    token: resetToken,
    password: 'freshpass007',
  });
  assert.equal(reset.status, 200);

  // SECURITY: the token issued at signup predates this password reset and must
  // be rejected now that the account token_version was bumped.
  const staleSession = await call('GET', '/auth/me', undefined, signupToken);
  assert.equal(staleSession.status, 401);

  const oldLogin = await call('POST', '/auth/login', {
    email: 'awa@market.cm',
    password: 'coupe123',
  });
  assert.equal(oldLogin.status, 401);

  const login = await call('POST', '/auth/login', {
    email: 'awa@market.cm',
    password: 'freshpass007',
  });
  assert.equal(login.status, 200);
  assert.equal(typeof (login.data as unknown as AuthResult).token, 'string');
});

test('reset-password updates the password and invalidates the old one', async () => {
  const resetToken = issueResetToken('awa@market.cm');

  const reset = await call('POST', '/auth/reset-password', {
    token: resetToken,
    password: 'coupeNeuve456',
  });
  assert.equal(reset.status, 200);

  const oldLogin = await call('POST', '/auth/login', {
    email: 'awa@market.cm',
    password: 'coupe123',
  });
  assert.equal(oldLogin.status, 401);

  const newLogin = await call('POST', '/auth/login', {
    email: 'awa@market.cm',
    password: 'coupeNeuve456',
  });
  assert.equal(newLogin.status, 200);
  assert.equal(typeof (newLogin.data as unknown as AuthResult).token, 'string');
});

test('a used reset token cannot be reused', async () => {
  const resetToken = issueResetToken('awa@market.cm');

  await call('POST', '/auth/reset-password', {
    token: resetToken,
    password: 'coupeAutre123',
  });
  const second = await call('POST', '/auth/reset-password', {
    token: resetToken,
    password: 'coupeAutre456',
  });
  assert.equal(second.status, 400);
  assert.equal((second.data.error as { code: string }).code, 'INVALID_TOKEN');
});

test('a bogus reset token is rejected', async () => {
  const result = await call('POST', '/auth/reset-password', {
    token: 'no-such-token',
    password: 'whatever123',
  });
  assert.equal(result.status, 400);
  assert.equal((result.data.error as { code: string }).code, 'INVALID_TOKEN');
});

// Password resets above bumped the account token_version, which invalidates
// the token issued at signup. Re-authenticate so later tests keep exercising
// the API with a currently valid session.
test('re-authenticate with a fresh token after password resets', async () => {
  const login = await call('POST', '/auth/login', {
    email: 'awa@market.cm',
    password: 'coupeAutre123',
  });
  assert.equal(login.status, 200);
  signupToken = (login.data as unknown as AuthResult).token;
});

test('debts can be created, listed, paid and deleted', async () => {
  const create = await call(
    'POST',
    '/debts',
    { name: 'Bintou', amount: 5000, note: 'Maquis bill', date: '2026-09-12' },
    signupToken,
  );
  assert.equal(create.status, 201);
  const created = (create.data as { debt: { id: number; status: string; note: string } }).debt;
  assert.equal(created.status, 'open');
  assert.equal(created.note, 'Maquis bill');

  const second = await call(
    'POST',
    '/debts',
    { name: 'Sali', amount: 2000, date: '2026-09-11' },
    signupToken,
  );
  assert.equal(second.status, 201);

  const list = await call('GET', '/debts', undefined, signupToken);
  assert.equal(list.status, 200);
  const debts = (list.data as { debts: { id: number }[] }).debts;
  assert.equal(debts.length, 2);

  const paid = await call(
    'POST',
    `/debts/${created.id}/pay`,
    {},
    signupToken,
  );
  assert.equal(paid.status, 200);
  assert.equal((paid.data as { debt: { status: string } }).debt.status, 'paid');

  const single = await call('GET', `/debts/${created.id}`, undefined, signupToken);
  assert.equal(single.status, 200);
  assert.equal((single.data as { debt: { status: string } }).debt.status, 'paid');

  const alreadyPaid = await call(
    'POST',
    `/debts/${created.id}/pay`,
    {},
    signupToken,
  );
  assert.equal(alreadyPaid.status, 400);
  assert.equal((alreadyPaid.data.error as { code: string }).code, 'ALREADY_PAID');

  const del = await call('DELETE', `/debts/${(second.data as { debt: { id: number } }).debt.id}`, {}, signupToken);
  assert.equal(del.status, 204);
});

test('debts are scoped to their owner', async () => {
  const otherSignup = await call('POST', '/auth/signup', {
    firstName: 'Yann',
    lastName: 'Essomba',
    email: 'yann@shop.cm',
    password: 'coupe123',
  });
  const otherToken = (otherSignup.data as unknown as AuthResult).token;

  const result = await call('POST', `/debts/999999/pay`, {}, otherToken);
  assert.equal(result.status, 404);
  assert.equal((result.data.error as { code: string }).code, 'NOT_FOUND');
});

test('a user cannot read or delete another user debt', async () => {
  const create = await call(
    'POST',
    '/debts',
    { name: 'Idris', amount: 3000, date: '2026-09-12' },
    signupToken,
  );
  const debtId = (create.data as { debt: { id: number } }).debt.id;

  const otherSignup = await call('POST', '/auth/signup', {
    firstName: 'Frida',
    lastName: 'Kamga',
    email: 'frida@market.cm',
    password: 'kribiMarket999',
  });
  assert.equal(otherSignup.status, 201);
  const otherToken = (otherSignup.data as unknown as AuthResult).token;

  const get = await call('GET', `/debts/${debtId}`, undefined, otherToken);
  assert.equal(get.status, 404);
  assert.equal((get.data.error as { code: string }).code, 'NOT_FOUND');

  const del = await call('DELETE', `/debts/${debtId}`, undefined, otherToken);
  assert.equal(del.status, 404);
});

test('summary reports money received, spent and net', async () => {
  const now = new Date();
  const today = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-');

  await call(
    'POST',
    '/transactions',
    { type: 'sale', amount: 3000, description: 'Provisions', date: today },
    signupToken,
  );
  await call(
    'POST',
    '/transactions',
    { type: 'purchase', amount: 800, description: 'Restock sugar', date: today },
    signupToken,
  );
  await call(
    'POST',
    '/transactions',
    { type: 'capital', amount: 10000, date: '2026-09-01' },
    signupToken,
  );
  await call(
    'POST',
    '/transactions',
    { type: 'sale', amount: 500, date: '2026-08-01' },
    signupToken,
  );

  const result = await call('GET', '/summary', undefined, signupToken);
  assert.equal(result.status, 200);
  const summary = (result.data as { summary: Record<string, number> }).summary;
  assert.equal(summary.todayReceived, 3000);
  assert.equal(summary.todaySpent, 800);
  assert.equal(summary.todayNet, 2200);
  assert.equal(summary.totalReceived, 3500);
  assert.equal(summary.totalSpent, 800);
  assert.equal(summary.totalNet, 2700);
  assert.equal(summary.totalCapital, 10000);
});

test('activity lists business events', async () => {
  const result = await call('GET', '/activity?limit=50', undefined, signupToken);
  assert.equal(result.status, 200);
  const events = (result.data as { events: { type: string }[] }).events;

  const types = events.map(event => event.type);
  assert.ok(types.includes('sale'));
  assert.ok(types.includes('spend'));
  assert.ok(types.includes('capital'));
  assert.ok(types.includes('debt_added'));
  assert.ok(types.includes('debt_paid'));

  assert.ok(
    events.some(
      event =>
        event.type === 'sale' &&
        (event as { title?: string }).title === 'Provisions' &&
        (event as { amount?: number }).amount === 3000,
    ),
    'expected a sale event for Provisions',
  );
});

test('feedback can be submitted and listed', async () => {
  const result = await call(
    'POST',
    '/feedback',
    {
      rating: 5,
      liked: 'Simple to record sales',
      disliked: '',
      suggestion: 'Offline mode would help',
    },
    signupToken,
  );
  assert.equal(result.status, 201);
  const fb = (result.data as { feedback: { rating: number; suggestion: string } }).feedback;
  assert.equal(fb.rating, 5);
  assert.equal(fb.suggestion, 'Offline mode would help');

  const list = await call('GET', '/feedback', undefined, signupToken);
  assert.equal(list.status, 200);
  assert.equal((list.data as { feedback: unknown[] }).feedback.length, 1);

  const invalid = await call(
    'POST',
    '/feedback',
    { rating: 9 },
    signupToken,
  );
  assert.equal(invalid.status, 400);
});

test('feedback delete rejects a malformed id', async () => {
  const result = await call('DELETE', '/feedback/not-a-number', undefined, signupToken);
  assert.equal(result.status, 400);
  assert.equal((result.data.error as { code: string }).code, 'VALIDATION_ERROR');
});

test('DELETE /auth/me removes the account', async () => {
  // KZ-20: the current password (set by the reset tests above) is required.
  const result = await call('DELETE', '/auth/me', { password: 'coupeAutre123' }, signupToken);
  assert.equal(result.status, 204);

  // SECURITY: once the account is gone there is no row for its token_version,
  // so the old session token is rejected as invalid rather than reaching the
  // resource handlers.
  const afterDelete = await call('GET', '/auth/me', undefined, signupToken);
  assert.equal(afterDelete.status, 401);

  const login = await call('POST', '/auth/login', {
    email: 'awa@market.cm',
    password: 'coupeNeuve456',
  });
  assert.equal(login.status, 401);
});

test('SECURITY: two accounts may use the same password and nothing reveals it (KZ-05)', async () => {
  const alpha = await call('POST', '/auth/signup', {
    firstName: 'Alpha',
    lastName: 'User',
    email: 'alpha@market.cm',
    password: 'sharedLedger2026',
  });
  assert.equal(alpha.status, 201);

  const beta = await call('POST', '/auth/signup', {
    firstName: 'Beta',
    lastName: 'User',
    email: 'beta@market.cm',
    password: 'sharedLedger2026',
  });
  assert.equal(beta.status, 201);
  // Same response shape as any signup: a token and the new account only.
  assert.deepEqual(Object.keys(beta.data).sort(), ['token', 'user']);
  assert.equal((beta.data.user as { email: string }).email, 'beta@market.cm');
});

test('history supports period filtering and financial totals', async () => {
  const userRes = await call('POST', '/auth/signup', {
    firstName: 'History',
    lastName: 'Tester',
    email: 'history@market.cm',
    password: 'ledgerHist2026',
  });
  assert.equal(userRes.status, 201);
  const token = (userRes.data as unknown as AuthResult).token;

  const now = new Date();
  const todayStr = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-');

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = [
    yesterday.getFullYear(),
    String(yesterday.getMonth() + 1).padStart(2, '0'),
    String(yesterday.getDate()).padStart(2, '0'),
  ].join('-');

  // Create today's sale and spend
  await call('POST', '/transactions', { type: 'sale', amount: 5000, description: 'Sold shoes', date: todayStr }, token);
  await call('POST', '/transactions', { type: 'purchase', amount: 1500, description: 'Transport', date: todayStr }, token);

  // Create yesterday's sale
  await call('POST', '/transactions', { type: 'sale', amount: 2000, description: 'Sold belt', date: yesterdayStr }, token);

  // Query today
  const todayRes = await call('GET', '/activity?period=today', undefined, token);
  assert.equal(todayRes.status, 200);
  const todayData = todayRes.data as { events: unknown[]; summary: { received: number; spent: number; made: number } };
  assert.equal(todayData.events.length, 2);
  assert.equal(todayData.summary.received, 5000);
  assert.equal(todayData.summary.spent, 1500);
  assert.equal(todayData.summary.made, 3500);

  // Query yesterday
  const yesterdayRes = await call('GET', '/activity?period=yesterday', undefined, token);
  assert.equal(yesterdayRes.status, 200);
  const yesterdayData = yesterdayRes.data as { events: unknown[]; summary: { received: number; spent: number; made: number } };
  assert.equal(yesterdayData.events.length, 1);
  assert.equal(yesterdayData.summary.received, 2000);
  assert.equal(yesterdayData.summary.spent, 0);
  assert.equal(yesterdayData.summary.made, 2000);
});

test('debts records paid_at timestamp and filters by status', async () => {
  const userRes = await call('POST', '/auth/signup', {
    firstName: 'Debts',
    lastName: 'Tester',
    email: 'debt_tester@market.cm',
    password: 'ledgerDette2026',
  });
  assert.equal(userRes.status, 201);
  const token = (userRes.data as unknown as AuthResult).token;

  // Create debt
  const createRes = await call('POST', '/debts', { name: 'Paul', amount: 15000, date: '2026-09-01' }, token);
  assert.equal(createRes.status, 201);
  const debt = (createRes.data as { debt: { id: number; status: string; paidAt?: string } }).debt;
  assert.equal(debt.status, 'open');
  assert.equal(debt.paidAt, undefined);

  // Mark debt as paid
  const payRes = await call('POST', `/debts/${debt.id}/pay`, {}, token);
  assert.equal(payRes.status, 200);
  const paidDebt = (payRes.data as { debt: { status: string; paidAt: string } }).debt;
  assert.equal(paidDebt.status, 'paid');
  assert.ok(typeof paidDebt.paidAt === 'string' && paidDebt.paidAt.length > 0);

  // Filter open debts -> should be empty
  const openRes = await call('GET', '/debts?status=open', undefined, token);
  assert.equal(openRes.status, 200);
  assert.equal((openRes.data as { debts: unknown[] }).debts.length, 0);

  // Filter paid debts -> should contain Paul
  const paidRes = await call('GET', '/debts?status=paid', undefined, token);
  assert.equal(paidRes.status, 200);
  assert.equal((paidRes.data as { debts: { name: string }[] }).debts[0]?.name, 'Paul');
});