import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { afterEach, mock, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../errors.js';
import {
  DEFAULT_MAX_KEYS,
  FixedWindowLimiter,
  byUserWrite,
  rateLimit,
} from './rateLimit.js';

// KZ-08: the fixed-window limiter, on a fake clock.

const SERVER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function fakeClock(start = 1_000_000) {
  let time = start;
  return {
    now: () => time,
    advance(ms: number) {
      time += ms;
    },
  };
}

const limiters: FixedWindowLimiter[] = [];
function limiter(options: ConstructorParameters<typeof FixedWindowLimiter>[0]): FixedWindowLimiter {
  const created = new FixedWindowLimiter(options);
  limiters.push(created);
  return created;
}

afterEach(() => {
  mock.timers.reset();
  for (const created of limiters.splice(0)) {
    created.stop();
  }
});

test('allows max events per window, then refuses with the whole seconds left', () => {
  const clock = fakeClock();
  const l = limiter({ windowMs: 60_000, max: 3, now: clock.now });
  for (let i = 0; i < 3; i += 1) {
    assert.deepEqual(l.hit('a'), { allowed: true, retryAfterSeconds: 0 });
  }
  assert.deepEqual(l.hit('a'), { allowed: false, retryAfterSeconds: 60 });

  clock.advance(59_001);
  assert.deepEqual(l.hit('a'), { allowed: false, retryAfterSeconds: 1 }, 'never 0 while refused');

  clock.advance(999); // exactly the end of the window: a new one starts
  assert.deepEqual(l.hit('a'), { allowed: true, retryAfterSeconds: 0 });
});

test('keys are counted separately', () => {
  const clock = fakeClock();
  const l = limiter({ windowMs: 1_000, max: 1, now: clock.now });
  assert.equal(l.hit('a').allowed, true);
  assert.equal(l.hit('a').allowed, false);
  assert.equal(l.hit('b').allowed, true);
});

test('peek does not count; reset forgets the key', () => {
  const clock = fakeClock();
  const l = limiter({ windowMs: 1_000, max: 2, now: clock.now });
  assert.equal(l.peek('a').allowed, true);
  assert.equal(l.size, 0, 'peek tracks nothing');
  l.hit('a');
  assert.equal(l.peek('a').allowed, true);
  l.hit('a');
  assert.deepEqual(l.peek('a'), { allowed: false, retryAfterSeconds: 1 });
  l.reset('a');
  assert.equal(l.size, 0);
  assert.equal(l.hit('a').allowed, true);
});

test('sweep drops windows that have ended and keeps the rest', () => {
  const clock = fakeClock();
  const l = limiter({ windowMs: 10_000, max: 5, now: clock.now });
  l.hit('old');
  clock.advance(6_000);
  l.hit('new');
  l.hit('old'); // a hit inside a window does not extend it
  clock.advance(4_000); // 'old' ended exactly now; 'new' has 6 s left
  l.sweep();
  assert.equal(l.size, 1);
  assert.equal(l.peek('new').retryAfterSeconds, 0);
  l.hit('new');
  l.hit('new');
  l.hit('new');
  l.hit('new');
  assert.deepEqual(l.hit('new'), { allowed: false, retryAfterSeconds: 6 });
});

test('a renewed window moves to the back, so the sweep never skips an ended one', () => {
  const clock = fakeClock();
  const l = limiter({ windowMs: 10_000, max: 5, now: clock.now });
  l.hit('a');
  clock.advance(5_000);
  l.hit('b');
  clock.advance(5_000);
  l.hit('a'); // a's window ended: a new one starts after b's
  clock.advance(5_000); // b ended; a has 5 s left
  l.sweep();
  assert.equal(l.size, 1);
  assert.equal(l.hit('a').allowed, true);
});

test('expired buckets are swept every minute by the timer (fake timers)', () => {
  mock.timers.enable({ apis: ['setInterval', 'Date'], now: 0 });
  const l = limiter({ windowMs: 30_000, max: 1 });
  l.hit('early'); // window ends at 30 s
  mock.timers.tick(45_000);
  l.hit('late'); // window ends at 75 s
  assert.equal(l.size, 2);
  mock.timers.tick(15_000); // 60 s: the sweep runs
  assert.equal(l.size, 1);
  mock.timers.tick(60_000); // 120 s
  assert.equal(l.size, 0);
});

test('the sweep timer does not keep the process alive', () => {
  const script =
    "import { FixedWindowLimiter } from './src/middleware/rateLimit.ts';" +
    "new FixedWindowLimiter({ windowMs: 60000, max: 1 }).hit('x');" +
    "console.log('done');";
  const result = spawnSync(
    process.execPath,
    ['--import', 'tsx', '--input-type=module', '-e', script],
    { cwd: SERVER_DIR, encoding: 'utf8', timeout: 30_000 },
  );
  assert.equal(result.signal, null, 'the process had to be killed: the timer kept it alive');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /done/);
});

test('100 000 distinct keys: the map stays at its cap and the oldest keys go first', () => {
  const clock = fakeClock();
  const l = limiter({ windowMs: 15 * 60_000, max: 1, now: clock.now });
  for (let i = 0; i < 100_000; i += 1) {
    l.hit(`198.51.${i >> 8}.${i & 255}#${i}`);
    assert.ok(l.size <= DEFAULT_MAX_KEYS);
  }
  assert.equal(l.size, DEFAULT_MAX_KEYS);
  // The newest key is still counted; the first one was dropped.
  assert.equal(l.hit(`198.51.${99_999 >> 8}.${99_999 & 255}#99999`).allowed, false);
  assert.equal(l.peek('198.51.0.0#0').allowed, true);
});

test('maxKeys can be set per limiter', () => {
  const clock = fakeClock();
  const l = limiter({ windowMs: 1_000, max: 1, maxKeys: 3, now: clock.now });
  for (const key of ['a', 'b', 'c', 'd']) {
    l.hit(key);
  }
  assert.equal(l.size, 3);
  assert.equal(l.peek('a').allowed, true, 'a was evicted');
  assert.equal(l.peek('d').allowed, false);
});

// --- middleware --------------------------------------------------------------

function fakeRes(): { res: Response; headers: Record<string, string> } {
  const headers: Record<string, string> = {};
  const res = {
    setHeader(name: string, value: string) {
      headers[name] = value;
      return res;
    },
  } as unknown as Response;
  return { res, headers };
}

function run(handler: ReturnType<typeof rateLimit>, req: Partial<Request>) {
  const { res, headers } = fakeRes();
  let passed: unknown = 'not called';
  handler(req as Request, res, ((err?: unknown) => {
    passed = err;
  }) as NextFunction);
  return { error: passed, headers };
}

test('rateLimit answers 429 TOO_MANY_REQUESTS with Retry-After once a key is over', () => {
  const clock = fakeClock();
  const handler = rateLimit({ windowMs: 90_000, max: 2, now: clock.now, key: req => req.ip ?? null });
  const req = { ip: '203.0.113.9' };
  assert.equal(run(handler, req).error, undefined);
  assert.equal(run(handler, req).error, undefined);
  clock.advance(500);
  const refused = run(handler, req);
  assert.ok(refused.error instanceof AppError);
  assert.equal(refused.error.status, 429);
  assert.equal(refused.error.code, 'TOO_MANY_REQUESTS');
  assert.equal(refused.headers['Retry-After'], '90');
  assert.equal(run(handler, { ip: '203.0.113.10' }).error, undefined, 'another address');
});

test('a null key is not counted', () => {
  const handler = rateLimit({ windowMs: 1_000, max: 1, key: () => null });
  for (let i = 0; i < 5; i += 1) {
    assert.equal(run(handler, {}).error, undefined);
  }
});

test('byUserWrite counts only writes by a signed-in user', () => {
  const user = { id: 7 };
  assert.equal(byUserWrite({ method: 'GET', user } as Request), null);
  assert.equal(byUserWrite({ method: 'HEAD', user } as Request), null);
  assert.equal(byUserWrite({ method: 'OPTIONS', user } as Request), null);
  assert.equal(byUserWrite({ method: 'POST' } as Request), null);
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    assert.equal(byUserWrite({ method, user } as Request), '7');
  }
});
