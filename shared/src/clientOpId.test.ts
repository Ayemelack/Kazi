import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CLIENT_OP_ID_LENGTH,
  CLIENT_OP_ID_MAX,
  CLIENT_OP_ID_MIN,
  newClientOpId,
} from './index.js';

test('a client op id is at least 20 lowercase base36 characters the API accepts', () => {
  assert.ok(CLIENT_OP_ID_LENGTH >= 20);
  assert.ok(CLIENT_OP_ID_LENGTH >= CLIENT_OP_ID_MIN && CLIENT_OP_ID_LENGTH <= CLIENT_OP_ID_MAX);
  for (let i = 0; i < 200; i += 1) {
    const id = newClientOpId();
    assert.equal(id.length, CLIENT_OP_ID_LENGTH);
    assert.match(id, /^[0-9a-z]+$/);
  }
});

test('the id starts with the clock in base36', () => {
  const now = Date.UTC(2026, 9, 14, 12, 0, 0);
  assert.equal(newClientOpId(now).slice(0, 9), now.toString(36).padStart(9, '0'));
  assert.equal(newClientOpId(0).slice(0, 9), '000000000');
});

test('ids made in the same millisecond never repeat, even with a fixed random source', t => {
  t.mock.method(Math, 'random', () => 0.5);
  const now = 1_760_000_000_000;
  const ids = new Set<string>();
  for (let i = 0; i < 5000; i += 1) {
    ids.add(newClientOpId(now));
  }
  assert.equal(ids.size, 5000);
});

test('ids are unique across a large sample', () => {
  const ids = new Set<string>();
  for (let i = 0; i < 20_000; i += 1) {
    ids.add(newClientOpId());
  }
  assert.equal(ids.size, 20_000);
});
