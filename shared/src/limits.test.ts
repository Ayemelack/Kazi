import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  BUSINESS_DATE_MAX_AHEAD_DAYS,
  BUSINESS_DATE_MIN,
  BUSINESS_TYPE_MAX,
  EMAIL_MAX,
  PASSWORD_MAX_BYTES,
  PASSWORD_MIN,
  businessDateMax,
  isCalendarDate,
  isWithinBusinessDateWindow,
  shiftDate,
  utf8ByteLength,
} from './index.js';

describe('utf8ByteLength', () => {
  const CASES: ReadonlyArray<readonly [string, number]> = [
    ['', 0],
    ['abc123', 6],
    ['é', 2],
    ['café', 5],
    ['€', 3],
    ['😀', 4],
    ['a😀é€', 10],
    ['\ud800', 3],
  ];
  for (const [text, bytes] of CASES) {
    test(`${JSON.stringify(text)} is ${bytes} bytes`, () => {
      assert.equal(utf8ByteLength(text), bytes);
      assert.equal(Buffer.byteLength(text, 'utf8'), bytes, 'agrees with Node');
    });
  }
});

describe('business date window', () => {
  test('starts on 2000-01-01 and ends 365 days after today', () => {
    assert.equal(BUSINESS_DATE_MIN, '2000-01-01');
    assert.equal(BUSINESS_DATE_MAX_AHEAD_DAYS, 365);
    assert.equal(businessDateMax('2026-10-11'), '2027-10-11');
    assert.equal(businessDateMax('2027-03-01'), '2028-02-29');
  });

  test('boundaries are inclusive', () => {
    const today = '2026-10-11';
    assert.equal(isWithinBusinessDateWindow('2000-01-01', today), true);
    assert.equal(isWithinBusinessDateWindow('1999-12-31', today), false);
    assert.equal(isWithinBusinessDateWindow('2027-10-11', today), true);
    assert.equal(isWithinBusinessDateWindow('2027-10-12', today), false);
  });

  test('isCalendarDate rejects impossible days and other formats', () => {
    assert.equal(isCalendarDate('2024-02-29'), true);
    assert.equal(isCalendarDate('2026-02-29'), false);
    assert.equal(isCalendarDate('2026-13-01'), false);
    assert.equal(isCalendarDate('12/09/2026'), false);
    assert.equal(isCalendarDate(''), false);
  });

  test('shiftDate crosses months and years', () => {
    assert.equal(shiftDate('2026-12-31', 1), '2027-01-01');
    assert.equal(shiftDate('2026-03-01', -1), '2026-02-28');
  });
});

test('account limits match the API contract', () => {
  assert.equal(PASSWORD_MIN, 8);
  assert.equal(PASSWORD_MAX_BYTES, 72);
  assert.equal(EMAIL_MAX, 254);
  assert.equal(BUSINESS_TYPE_MAX, 60);
});
