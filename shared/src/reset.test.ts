import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  RESET_CODES_PER_EMAIL_PER_HOUR,
  RESET_CODE_LENGTH,
  RESET_CODE_MAX_ATTEMPTS,
  RESET_CODE_TTL_MINUTES,
  isResetCodeFormat,
} from './index.js';

test('reset code limits are the ones in the KZ-06 spec', () => {
  assert.equal(RESET_CODE_LENGTH, 6);
  assert.equal(RESET_CODE_TTL_MINUTES, 15);
  assert.equal(RESET_CODE_MAX_ATTEMPTS, 5);
  assert.equal(RESET_CODES_PER_EMAIL_PER_HOUR, 3);
});

test('a reset code is exactly six ASCII digits', () => {
  for (const ok of ['000000', '123456', '999999']) {
    assert.equal(isResetCodeFormat(ok), true, ok);
  }
  // Arabic-Indic digits are digits to \d in some engines; only 0-9 count.
  for (const bad of ['', '12345', '1234567', '12 456', '12345a', '-12345', '١٢٣٤٥٦', ' 123456']) {
    assert.equal(isResetCodeFormat(bad), false, JSON.stringify(bad));
  }
});
