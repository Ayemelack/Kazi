import assert from 'node:assert/strict';
import { afterEach, beforeEach, mock, test } from 'node:test';
import type { AddressInfo } from 'node:net';
import type { BatchResponse, MulticastMessage } from 'firebase-admin/messaging';
import { createApp } from './app.js';
import { openDatabase } from './db/index.js';
import { log } from './log.js';
import { settleLowStockAlerts } from './notifications/lowStock.js';
import { gracefulShutdown } from './shutdown.js';

// SIGTERM/SIGINT (KZ-03): queued low-stock alerts finish before the database
// closes; a second signal or the grace period exits at once.

beforeEach(() => {
  mock.method(log, 'info', () => {});
  mock.method(log, 'warn', () => {});
});

afterEach(() => {
  mock.restoreAll();
});

function waitFor(condition: () => boolean, ms = 5_000): Promise<void> {
  const deadline = performance.now() + ms;
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (condition()) {
        resolve();
      } else if (performance.now() > deadline) {
        reject(new Error('timed out waiting'));
      } else {
        setTimeout(tick, 10);
      }
    };
    tick();
  });
}

test('SIGTERM lets a queued alert finish, then closes the database and exits 0', async () => {
  process.env.JWT_SECRET = 'test-secret-not-for-production';
  const events: string[] = [];
  const db = openDatabase({ filename: ':memory:' });
  const app = createApp(db, {
    pushMessaging: () => ({
      async sendEachForMulticast(message: MulticastMessage): Promise<BatchResponse> {
        events.push('push started');
        await new Promise(resolve => setTimeout(resolve, 300));
        events.push('push answered');
        return {
          responses: message.tokens.map(() => ({ success: true, messageId: 'm' })),
          successCount: message.tokens.length,
          failureCount: 0,
        };
      },
    }),
  });
  const server = app.listen(0);
  await new Promise<void>(resolve => server.once('listening', () => resolve()));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  try {
    const post = async (path: string, body: unknown, token?: string) => {
      const response = await fetch(`${url}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      });
      return { status: response.status, data: (await response.json()) as { token?: string; item?: { id: number } } };
    };
    const signup = await post('/auth/signup', {
      firstName: 'Awa',
      lastName: 'Shop',
      email: 'shutdown@push.dev',
      password: 'mboaLedger2026',
    });
    const token = signup.data.token ?? '';
    await post('/notifications/push-tokens', { token: 'device-1', platform: 'android' }, token);
    const item = await post(
      '/items',
      { name: 'Rice', type: 'product', price: 500, trackStock: true, lowStockThreshold: 3 },
      token,
    );
    const itemId = item.data.item?.id ?? 0;
    await post(`/items/${itemId}/stock-in`, { quantity: 10 }, token);
    const sale = await post(
      '/transactions',
      { type: 'sale', amount: 1000, date: new Date().toISOString().slice(0, 10), itemId, quantity: 8 },
      token,
    );
    assert.equal(sale.status, 201);
  } finally {
    // The alert is queued; stop the server as systemd would.
    const shutdown = gracefulShutdown({
      server,
      settle: settleLowStockAlerts,
      close: () => {
        events.push('db closed');
        db.close();
      },
      exit: code => events.push(`exit ${code}`),
    });
    shutdown('SIGTERM');
  }

  await waitFor(() => events.some(e => e.startsWith('exit')));
  assert.deepEqual(events, ['push started', 'push answered', 'db closed', 'exit 0']);
  assert.equal(db.open, false);
});

function idleServer() {
  const server = createApp(openDatabase({ filename: ':memory:' })).listen(0);
  return new Promise<typeof server>(resolve => server.once('listening', () => resolve(server)));
}

test('a second signal exits 1 at once and the first never exits afterwards', async () => {
  const server = await idleServer();
  const exits: number[] = [];
  let release!: () => void;
  const settle = () => new Promise<void>(resolve => (release = resolve));
  const shutdown = gracefulShutdown({ server, settle, close: () => {}, exit: code => exits.push(code) });

  shutdown('SIGTERM');
  await waitFor(() => release !== undefined);
  shutdown('SIGINT');
  assert.deepEqual(exits, [1]);

  release();
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.deepEqual(exits, [1]);
});

test('when background work outlasts the grace period it exits 1 without closing the database', async () => {
  const server = await idleServer();
  const exits: number[] = [];
  let closed = false;
  const shutdown = gracefulShutdown({
    server,
    settle: () => new Promise<void>(() => {}),
    close: () => {
      closed = true;
    },
    exit: code => exits.push(code),
    graceMs: 100,
  });
  shutdown('SIGTERM');
  await waitFor(() => exits.length > 0);
  assert.deepEqual(exits, [1]);
  assert.equal(closed, false);
});
