import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  KAZI_PUSH_CHANNEL_ID,
  lowStockPushData,
  parsePushData,
} from './index.js';

// The wire shape the API's deliverPush builds: title/body/channel always, plus
// per-type extras.
const lowStockWire = {
  title: 'Running low: Sugar',
  body: 'Sugar is down to 3. Tap to reorder.',
  channel: KAZI_PUSH_CHANNEL_ID,
  ...lowStockPushData(42),
};

test('a well-formed low-stock push parses with its type and item id', () => {
  assert.deepEqual(parsePushData(lowStockWire), {
    title: 'Running low: Sugar',
    body: 'Sugar is down to 3. Tap to reorder.',
    type: 'low_stock',
    itemId: 42,
  });
});

test('the test-send shape (title and body only) parses as display-only', () => {
  const parsed = parsePushData({ title: 'Hello', body: 'From the test route', channel: 'kazi' });
  assert.deepEqual(parsed, { title: 'Hello', body: 'From the test route', type: null, itemId: null });
});

test('an unknown type still parses, without a screen to open', () => {
  const parsed = parsePushData({ ...lowStockWire, type: 'something_new' });
  assert.equal(parsed?.type, null);
  assert.equal(parsed?.itemId, 42);
});

test('title and body are trimmed and must be non-empty', () => {
  assert.deepEqual(
    parsePushData({ ...lowStockWire, title: '  Hi  ' })?.title,
    'Hi',
  );
  assert.equal(parsePushData({ ...lowStockWire, title: '   ' }), null);
  assert.equal(parsePushData({ ...lowStockWire, body: '' }), null);
  assert.equal(parsePushData({ channel: 'kazi' }), null);
});

test('a missing or unparseable item id degrades to null, not a failure', () => {
  assert.equal(parsePushData(lowStockWire)?.itemId, 42);
  assert.equal(parsePushData({ ...lowStockWire, itemId: '12.5' })?.itemId, null);
  assert.equal(parsePushData({ ...lowStockWire, itemId: '-3' })?.itemId, null);
  assert.equal(parsePushData({ ...lowStockWire, itemId: 'abc' })?.itemId, null);
  const { itemId: _itemId, ...withoutItem } = lowStockWire;
  assert.equal(parsePushData(withoutItem)?.itemId, null);
});

test('anything that is not an object of strings fails cleanly', () => {
  assert.equal(parsePushData(undefined), null);
  assert.equal(parsePushData(null), null);
  assert.equal(parsePushData('title=x'), null);
  assert.equal(parsePushData(42), null);
  assert.equal(parsePushData({ ...lowStockWire, title: 7 }), null);
});

test('lowStockPushData names the type and always sends the item id as a string', () => {
  assert.deepEqual(lowStockPushData(7), { type: 'low_stock', itemId: '7' });
});
