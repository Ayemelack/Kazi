import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CURRENCY_CODE } from './index.js';

test('CURRENCY_CODE is the ISO 4217 code for FCFA', () => {
  assert.equal(CURRENCY_CODE, 'XAF');
});
