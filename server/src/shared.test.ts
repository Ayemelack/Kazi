import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CURRENCY_CODE } from '@kazi/shared';

// Proves the server toolchain (tsc NodeNext, tsx and plain node on the build
// output) resolves the @kazi/shared file: link and its "exports".
test('@kazi/shared is importable from the server', () => {
  assert.equal(CURRENCY_CODE, 'XAF');
});
