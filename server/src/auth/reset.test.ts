import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, mock, test } from 'node:test';
import type { Server } from 'node:http';
import type Database from 'better-sqlite3';
import {
  RESET_CODES_PER_EMAIL_PER_DAY,
  RESET_CODES_PER_EMAIL_PER_HOUR,
  RESET_CODE_MAX_ATTEMPTS,
  type AppLanguage,
} from '@kazi/shared';
import { openDatabase } from '../db/index.js';
import { createApp } from '../app.js';
import { EmailDeliveryError } from './emailTransport.js';
import type { ResetCodeSender, ResetDelivery } from './delivery.js';
import { RESET_REQUESTED } from './routes.js';
import { RESET_CODE_TTL_MS, hashResetCode } from './resetCode.js';

// KZ-06: password reset by a 6-digit code sent out of band.

const SECRET = 'test-secret-not-for-production';

interface Sent {
  to: string;
  code: string;
  language: AppLanguage;
}

let server: Server;
let baseUrl: string;
let db: Database.Database;
let sent: Sent[];
let failNextSend: Error | null;

function capturingSender(): ResetCodeSender {
  return {
    description: 'test inbox',
    async send(to, code, language) {
      if (failNextSend) {
        const err = failNextSend;
        failNextSend = null;
        throw err;
      }
      sent.push({ to, code, language });
    },
  };
}

async function start(delivery: Partial<ResetDelivery> = {}): Promise<void> {
  db = openDatabase({ filename: ':memory:' });
  server = createApp(db, {
    resetDelivery: { sender: capturingSender(), devCodeInResponse: false, ...delivery },
  }).listen(0);
  await new Promise<void>(resolve => server.once('listening', () => resolve()));
  const address = server.address();
  baseUrl = `http://localhost:${typeof address === 'object' && address ? address.port : 4000}`;
}

beforeEach(async () => {
  process.env.JWT_SECRET = SECRET;
  sent = [];
  failNextSend = null;
  await start();
});

afterEach(() => {
  mock.timers.reset();
  server.close();
  db.close();
});

interface Reply {
  status: number;
  text: string;
  headers: Headers;
  data: Record<string, unknown>;
}

async function call(path: string, body: unknown, token?: string, method = 'POST'): Promise<Reply> {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return {
    status: response.status,
    text,
    headers: response.headers,
    data: text ? (JSON.parse(text) as Record<string, unknown>) : {},
  };
}

function errorCode(reply: Reply): string | undefined {
  return (reply.data.error as { code?: string } | undefined)?.code;
}

async function signup(email: string, password = 'mboaLedger2026'): Promise<string> {
  const result = await call('/auth/signup', { firstName: 'Ngum', lastName: 'Achu', email, password });
  assert.equal(result.status, 201, result.text);
  return result.data.token as string;
}

/** Resolves once the background job has delivered `count` codes in total. */
async function delivered(count: number): Promise<Sent> {
  const deadline = performance.now() + 10_000;
  while (sent.length < count) {
    if (performance.now() > deadline) {
      throw new Error(`expected ${count} delivered codes, got ${sent.length}`);
    }
    await new Promise(resolve => setImmediate(resolve));
  }
  return sent[count - 1]!;
}

async function requestCode(email: string): Promise<string> {
  const before = sent.length;
  const reply = await call('/auth/forgot-password', { email });
  assert.equal(reply.status, 202, reply.text);
  return (await delivered(before + 1)).code;
}

async function canLogIn(email: string, password: string): Promise<boolean> {
  return (await call('/auth/login', { email, password })).status === 200;
}

function resetRows(): { user_id: number; code_hash: string; attempts: number; used: number; expires_at: number }[] {
  return db
    .prepare('SELECT user_id, code_hash, attempts, used, expires_at FROM password_resets ORDER BY id')
    .all() as never;
}

// ── Requesting a code ──

test('known and unknown emails get the same status, body and headers; only the account gets a code', async () => {
  await signup('known@market.cm');

  const known = await call('/auth/forgot-password', { email: 'known@market.cm' });
  const unknown = await call('/auth/forgot-password', { email: 'nobody@market.cm' });

  assert.equal(known.status, 202);
  assert.equal(unknown.status, 202);
  assert.equal(known.text, unknown.text);
  assert.deepEqual(known.data, RESET_REQUESTED);
  for (const header of ['content-type', 'content-length', 'etag', 'cache-control']) {
    assert.equal(known.headers.get(header), unknown.headers.get(header), header);
  }

  const { code, to } = await delivered(1);
  // The second request is processed after the first; give it the same time.
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(sent.length, 1, 'nothing is sent for an email without an account');
  assert.equal(to, 'known@market.cm');
  assert.match(code, /^[0-9]{6}$/);
  assert.ok(!known.text.includes(code), 'the code is never in the response');
});

// A route that awaited the sender would never answer: the request gives up
// after 10 s and the provider is always released, so that fails instead of
// hanging the run.
test('the response does not wait for the lookup, the code or the email', { timeout: 30_000 }, async () => {
  server.close();
  db.close();
  let release: () => void = () => undefined;
  let calls = 0;
  await start({
    sender: {
      description: 'stuck provider',
      send: () => {
        calls += 1;
        return new Promise<void>(resolve => {
          release = resolve;
        });
      },
    },
  });
  await signup('patient@market.cm');

  try {
    const response = await fetch(`${baseUrl}/auth/forgot-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'patient@market.cm' }),
      signal: AbortSignal.timeout(10_000),
    });
    assert.equal(response.status, 202, 'answered while the provider has not answered');
    await response.arrayBuffer();
    // The code is created after the response was written.
    const deadline = performance.now() + 10_000;
    while (calls === 0 && performance.now() < deadline) {
      await new Promise(resolve => setImmediate(resolve));
    }
    assert.equal(calls, 1);
    assert.equal(resetRows().length, 1);
  } finally {
    release();
    server.closeAllConnections();
  }
});

test('forgot-password needs only the email; names are ignored', async () => {
  await signup('plain@market.cm');
  const withNames = await call('/auth/forgot-password', {
    email: 'Plain@Market.cm',
    firstName: 'Wrong',
    lastName: 'Names',
  });
  assert.equal(withNames.status, 202);
  assert.equal((await delivered(1)).to, 'plain@market.cm');

  const missing = await call('/auth/forgot-password', {});
  assert.equal(missing.status, 400);
  assert.deepEqual(
    { code: errorCode(missing), field: (missing.data.error as { field?: string }).field },
    { code: 'VALIDATION_ERROR', field: 'email' },
  );
});

test('three codes per email per hour, counted for unknown emails too', async () => {
  await signup('limited@market.cm');
  for (const email of ['limited@market.cm', 'ghost@market.cm']) {
    for (let i = 0; i < RESET_CODES_PER_EMAIL_PER_HOUR; i += 1) {
      assert.equal((await call('/auth/forgot-password', { email })).status, 202, `${email} #${i + 1}`);
    }
  }
  const known = await call('/auth/forgot-password', { email: 'limited@market.cm' });
  const unknown = await call('/auth/forgot-password', { email: 'ghost@market.cm' });
  assert.equal(known.status, 429);
  assert.equal(errorCode(known), 'TOO_MANY_REQUESTS');
  assert.equal(known.text, unknown.text, 'the limit looks the same for both');
  assert.equal(unknown.status, 429);

  // Another address is not affected, and the account got exactly three codes.
  assert.equal((await call('/auth/forgot-password', { email: 'other@market.cm' })).status, 202);
  await delivered(RESET_CODES_PER_EMAIL_PER_HOUR);
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(sent.length, RESET_CODES_PER_EMAIL_PER_HOUR);
});

test('the per-email limit resets after an hour (fake clock)', async () => {
  mock.timers.enable({ apis: ['Date'], now: Date.now() });
  await signup('hourly@market.cm');
  for (let i = 0; i < RESET_CODES_PER_EMAIL_PER_HOUR; i += 1) {
    await requestCode('hourly@market.cm');
  }
  assert.equal((await call('/auth/forgot-password', { email: 'hourly@market.cm' })).status, 429);
  mock.timers.tick(60 * 60 * 1000);
  assert.equal((await call('/auth/forgot-password', { email: 'hourly@market.cm' })).status, 202);
});

// KZ-08 (SECURITY.md §6): a daily cap bounds online guessing of one
// account's code to 10 codes × 5 tries a day.
test('ten codes per email per day; requests the hourly limit refused do not count (fake clock)', async () => {
  mock.timers.enable({ apis: ['Date'], now: Date.now() });
  const hour = 60 * 60 * 1000;
  let granted = 0;
  for (let h = 0; h < 4; h += 1) {
    for (let i = 0; i < 5; i += 1) {
      const reply = await call('/auth/forgot-password', { email: 'daily@market.cm' });
      if (reply.status === 202) {
        granted += 1;
      } else {
        assert.equal(reply.status, 429);
        assert.equal(errorCode(reply), 'TOO_MANY_REQUESTS');
      }
    }
    mock.timers.tick(hour);
  }
  assert.equal(granted, RESET_CODES_PER_EMAIL_PER_DAY);

  // A new hour, but the day's allowance is spent until 24 h after the first code.
  const spent = await call('/auth/forgot-password', { email: 'daily@market.cm' });
  assert.equal(spent.status, 429);
  assert.equal(Number(spent.headers.get('retry-after')), 20 * 60 * 60);
  mock.timers.tick(20 * hour);
  assert.equal((await call('/auth/forgot-password', { email: 'daily@market.cm' })).status, 202);
});

test('the stored code is an HMAC bound to the account, expiring in 15 minutes, never the code', async () => {
  await signup('stored@market.cm');
  const before = Date.now();
  const code = await requestCode('stored@market.cm');
  const rows = resetRows();
  assert.equal(rows.length, 1);
  const row = rows[0]!;
  assert.equal(row.attempts, 0);
  assert.equal(row.used, 0);
  assert.ok(row.expires_at >= before + RESET_CODE_TTL_MS && row.expires_at <= Date.now() + RESET_CODE_TTL_MS);
  assert.equal(RESET_CODE_TTL_MS, 15 * 60 * 1000);
  assert.equal(row.code_hash, hashResetCode(row.user_id, code, SECRET));
  assert.notEqual(row.code_hash, createHash('sha256').update(code).digest('hex'));
  assert.notEqual(row.code_hash, hashResetCode(row.user_id + 1, code, SECRET), 'bound to the account');
  const dump = JSON.stringify(db.prepare('SELECT * FROM password_resets').all());
  assert.ok(!dump.includes(code));
});

test('the code goes out in the account language', async () => {
  const token = await signup('langue@market.cm');
  assert.equal((await call('/auth/me/language', { language: 'fr' }, token, 'PATCH')).status, 200);
  await requestCode('langue@market.cm');
  assert.equal(sent[0]!.language, 'fr');
});

// ── Using a code ──

test('the right code resets the password, ends old sessions and uses the code up', async () => {
  const session = await signup('owner@market.cm');
  const code = await requestCode('owner@market.cm');

  const reset = await call('/auth/reset-password', {
    email: 'owner@market.cm',
    code,
    password: 'kribiLedger2026',
  });
  assert.equal(reset.status, 200, reset.text);
  assert.equal(await canLogIn('owner@market.cm', 'kribiLedger2026'), true);
  assert.equal(await canLogIn('owner@market.cm', 'mboaLedger2026'), false);
  // token_version was bumped: the session from before the reset is dead.
  assert.equal((await call('/auth/me', undefined, session, 'GET')).status, 401);
  assert.deepEqual(resetRows().map(r => r.used), [1]);

  const again = await call('/auth/reset-password', {
    email: 'owner@market.cm',
    code,
    password: 'limbeLedger2026',
  });
  assert.equal(again.status, 400);
  assert.equal(errorCode(again), 'RESET_CODE_INVALID');
  assert.equal(await canLogIn('owner@market.cm', 'kribiLedger2026'), true);
});

test('issuing a second code kills the first', async () => {
  await signup('twice@market.cm');
  const first = await requestCode('twice@market.cm');
  let second = await requestCode('twice@market.cm');
  // One in a million: draw again rather than flake.
  while (second === first) {
    second = await requestCode('twice@market.cm');
  }
  assert.equal(resetRows().length, 1, 'only the newest code is kept');

  const old = await call('/auth/reset-password', { email: 'twice@market.cm', code: first, password: 'kribiLedger2026' });
  assert.equal(old.status, 400);
  assert.equal(errorCode(old), 'RESET_CODE_INVALID');

  const fresh = await call('/auth/reset-password', { email: 'twice@market.cm', code: second, password: 'kribiLedger2026' });
  assert.equal(fresh.status, 200);
});

function wrongCode(code: string): string {
  return code === '000000' ? '000001' : '000000';
}

test(`after ${RESET_CODE_MAX_ATTEMPTS} wrong tries the code is dead, even for the right code`, async () => {
  await signup('guessed@market.cm');
  const code = await requestCode('guessed@market.cm');
  for (let i = 1; i <= RESET_CODE_MAX_ATTEMPTS; i += 1) {
    const wrong = await call('/auth/reset-password', {
      email: 'guessed@market.cm',
      code: wrongCode(code),
      password: 'kribiLedger2026',
    });
    assert.equal(errorCode(wrong), 'RESET_CODE_INVALID', `try ${i}`);
    assert.equal(resetRows()[0]!.attempts, i);
  }
  const sixth = await call('/auth/reset-password', {
    email: 'guessed@market.cm',
    code,
    password: 'kribiLedger2026',
  });
  assert.equal(sixth.status, 400);
  assert.equal(errorCode(sixth), 'RESET_CODE_INVALID');
  assert.equal(resetRows()[0]!.attempts, RESET_CODE_MAX_ATTEMPTS, 'a dead code counts no more tries');
  assert.equal(await canLogIn('guessed@market.cm', 'mboaLedger2026'), true, 'password unchanged');
});

test(`${RESET_CODE_MAX_ATTEMPTS - 1} wrong tries still leave the right code working`, async () => {
  await signup('typo@market.cm');
  const code = await requestCode('typo@market.cm');
  for (let i = 0; i < RESET_CODE_MAX_ATTEMPTS - 1; i += 1) {
    await call('/auth/reset-password', { email: 'typo@market.cm', code: wrongCode(code), password: 'kribiLedger2026' });
  }
  const right = await call('/auth/reset-password', { email: 'typo@market.cm', code, password: 'kribiLedger2026' });
  assert.equal(right.status, 200);
});

test('codes expire at 15 minutes (fake clock)', async () => {
  mock.timers.enable({ apis: ['Date'], now: Date.now() });
  await signup('late@market.cm');
  await signup('ontime@market.cm');

  const late = await requestCode('late@market.cm');
  const onTime = await requestCode('ontime@market.cm');

  mock.timers.tick(RESET_CODE_TTL_MS - 1);
  const justInTime = await call('/auth/reset-password', { email: 'ontime@market.cm', code: onTime, password: 'kribiLedger2026' });
  assert.equal(justInTime.status, 200, 'one millisecond before expiry it still works');

  mock.timers.tick(1);
  const expired = await call('/auth/reset-password', { email: 'late@market.cm', code: late, password: 'kribiLedger2026' });
  assert.equal(expired.status, 400);
  assert.equal(errorCode(expired), 'RESET_CODE_INVALID');
  assert.equal(await canLogIn('late@market.cm', 'mboaLedger2026'), true);
});

test('unknown email, no code, wrong, used, replaced, expired and dead codes all get the same answer', async () => {
  mock.timers.enable({ apis: ['Date'], now: Date.now() });
  const body = (email: string, code: string) => ({ email, code, password: 'kribiLedger2026' });
  await signup('nocode@market.cm');
  await signup('wrong@market.cm');
  await signup('dead@market.cm');
  await signup('expired@market.cm');
  const wrong = await requestCode('wrong@market.cm');
  const dead = await requestCode('dead@market.cm');
  const expired = await requestCode('expired@market.cm');
  for (let i = 0; i < RESET_CODE_MAX_ATTEMPTS; i += 1) {
    await call('/auth/reset-password', body('dead@market.cm', wrongCode(dead)));
  }

  const replies = [
    await call('/auth/reset-password', body('nobody@market.cm', '123456')),
    await call('/auth/reset-password', body('nocode@market.cm', '123456')),
    await call('/auth/reset-password', body('wrong@market.cm', wrongCode(wrong))),
    await call('/auth/reset-password', body('dead@market.cm', dead)),
  ];
  mock.timers.tick(RESET_CODE_TTL_MS);
  replies.push(await call('/auth/reset-password', body('expired@market.cm', expired)));

  for (const reply of replies) {
    assert.equal(reply.status, 400);
    assert.equal(reply.text, replies[0]!.text);
  }
  assert.equal(errorCode(replies[0]!), 'RESET_CODE_INVALID');
});

test('the password policy (names, email) is applied only after the code is right', async () => {
  await signup('policy@market.cm');
  const code = await requestCode('policy@market.cm');

  // "achu" is the account's last name. With a wrong code the answer must not
  // reveal it: same as for any wrong code.
  const guess = await call('/auth/reset-password', { email: 'policy@market.cm', code: wrongCode(code), password: 'achuLedger2026' });
  assert.equal(errorCode(guess), 'RESET_CODE_INVALID');

  const refused = await call('/auth/reset-password', { email: 'policy@market.cm', code, password: 'achuLedger2026' });
  assert.equal(refused.status, 400);
  assert.equal(errorCode(refused), 'PASSWORD_TOO_COMMON');
  // The right code with a refused password is not a wrong try and still works.
  assert.equal(resetRows()[0]!.attempts, 1);
  const ok = await call('/auth/reset-password', { email: 'policy@market.cm', code, password: 'kribiLedger2026' });
  assert.equal(ok.status, 200);
});

test('reset-password validates email, code and password; the old token body is refused', async () => {
  const field = (reply: Reply) => (reply.data.error as { field?: string; rule?: string }) ?? {};
  const badCode = await call('/auth/reset-password', { email: 'a@market.cm', code: '12345', password: 'kribiLedger2026' });
  assert.equal(badCode.status, 400);
  assert.deepEqual([field(badCode).field, field(badCode).rule], ['code', 'format']);

  const letters = await call('/auth/reset-password', { email: 'a@market.cm', code: '12a456', password: 'kribiLedger2026' });
  assert.deepEqual([field(letters).field, field(letters).rule], ['code', 'format']);

  const old = await call('/auth/reset-password', { token: 'a'.repeat(48), password: 'kribiLedger2026' });
  assert.equal(old.status, 400);
  assert.equal(errorCode(old), 'VALIDATION_ERROR');
});

test('deleting the account deletes its codes', async () => {
  const token = await signup('leaving@market.cm');
  await requestCode('leaving@market.cm');
  assert.equal(resetRows().length, 1);
  assert.equal((await call('/auth/me', { password: 'mboaLedger2026' }, token, 'DELETE')).status, 204);
  assert.equal(resetRows().length, 0);
});

// ── Logs and failures ──

test('no code or email appears in the logs, even when delivery fails', async () => {
  const lines: string[] = [];
  const capture = (...args: unknown[]) => {
    lines.push(args.map(arg => (arg instanceof Error ? `${arg.message} ${arg.stack}` : String(arg))).join(' '));
  };
  const restore = [
    mock.method(console, 'log', capture),
    mock.method(console, 'info', capture),
    mock.method(console, 'warn', capture),
    mock.method(console, 'error', capture),
  ];
  try {
    await signup('private@market.cm');
    const code = await requestCode('private@market.cm');
    await call('/auth/forgot-password', { email: 'stranger@market.cm' });
    await call('/auth/reset-password', { email: 'private@market.cm', code: wrongCode(code), password: 'kribiLedger2026' });
    await call('/auth/reset-password', { email: 'stranger@market.cm', code, password: 'kribiLedger2026' });

    // A provider failure, then an unexpected error whose message holds the
    // address: neither may reach the log beyond the account id and a reason.
    failNextSend = new EmailDeliveryError('brevo answered HTTP 500');
    await call('/auth/forgot-password', { email: 'private@market.cm' });
    await waitForLine(lines, /not delivered: brevo answered HTTP 500/);
    failNextSend = new Error('smtp refused private@market.cm');
    await call('/auth/forgot-password', { email: 'private@market.cm' });
    await waitForLine(lines, /not delivered: unexpected Error/);

    assert.equal(
      (await call('/auth/reset-password', { email: 'private@market.cm', code, password: 'kribiLedger2026' })).status,
      400,
      'the code was replaced by the later requests',
    );
    const log = lines.join('\n');
    for (const secret of [code, 'private@market.cm', 'stranger@market.cm', 'private@']) {
      assert.ok(!log.includes(secret), `log contains ${secret}`);
    }
    // The codes issued by the failed sends are unknown here: no six-digit run
    // may appear at all (timestamps and account ids have none).
    assert.doesNotMatch(log, /[0-9]{6}/);
    assert.match(log, /Password reset code for user \d+ was not delivered/);
  } finally {
    restore.forEach(m => m.mock.restore());
  }
});

async function waitForLine(lines: string[], pattern: RegExp): Promise<void> {
  const deadline = performance.now() + 10_000;
  while (!lines.some(line => pattern.test(line))) {
    if (performance.now() > deadline) {
      throw new Error(`no log line matching ${pattern}`);
    }
    await new Promise(resolve => setImmediate(resolve));
  }
}

test('a failed delivery still answers 202 and the server keeps serving', async () => {
  await signup('flaky@market.cm');
  failNextSend = new EmailDeliveryError('postmark did not answer within 5 s');
  const restore = mock.method(console, 'warn', () => undefined);
  try {
    const reply = await call('/auth/forgot-password', { email: 'flaky@market.cm' });
    assert.equal(reply.status, 202);
    assert.deepEqual(reply.data, RESET_REQUESTED);
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal((await call('/health', undefined, undefined, 'GET')).status, 200);
  } finally {
    restore.mock.restore();
  }
});

// ── The development shortcut ──

async function withEnv(vars: Record<string, string | undefined>, run: () => Promise<void>): Promise<void> {
  const previous = Object.fromEntries(Object.keys(vars).map(key => [key, process.env[key]]));
  const apply = (values: Record<string, string | undefined>) => {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  };
  apply(vars);
  try {
    await run();
  } finally {
    apply(previous);
  }
}

test('the dev shortcut returns the code only with ALLOW_DEV_RESET_CODE=1 and NODE_ENV development/test', async () => {
  server.close();
  db.close();
  await start({ devCodeInResponse: true });
  await signup('dev@market.cm');

  await withEnv({ ALLOW_DEV_RESET_CODE: '1', NODE_ENV: 'test' }, async () => {
    const known = await call('/auth/forgot-password', { email: 'dev@market.cm' });
    assert.equal(known.status, 202);
    assert.match(String(known.data.devCode), /^[0-9]{6}$/);
    assert.equal(known.data.devCode, sent[0]!.code);
    const unknown = await call('/auth/forgot-password', { email: 'nobody@market.cm' });
    assert.deepEqual(unknown.data, RESET_REQUESTED);
  });

  // Whatever the app was built with, these environments never get the code.
  for (const env of [
    { ALLOW_DEV_RESET_CODE: '1', NODE_ENV: 'production' },
    { ALLOW_DEV_RESET_CODE: '1', NODE_ENV: undefined },
    { ALLOW_DEV_RESET_CODE: '1', NODE_ENV: 'staging' },
    { ALLOW_DEV_RESET_CODE: undefined, NODE_ENV: 'development' },
    { ALLOW_DEV_RESET_CODE: 'true', NODE_ENV: 'test' },
  ]) {
    await withEnv(env, async () => {
      server.close();
      db.close();
      await start({ devCodeInResponse: true });
      await signup('dev@market.cm');
      const reply = await call('/auth/forgot-password', { email: 'dev@market.cm' });
      assert.equal(reply.status, 202);
      assert.deepEqual(reply.data, RESET_REQUESTED, JSON.stringify(env));
    });
  }
});
