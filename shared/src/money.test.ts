import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { MONEY_MAX, MONEY_SEPARATOR, formatMoney, parseMoneyInput } from './index.js';

const NBSP = '\u00a0';
const NNBSP = '\u202f';

// Every example from REMEDIATION_PLAN.md KZ-04, plus the edge cases the rules
// imply. FCFA has no minor unit, so "," and "." can only be thousands
// separators, in groups of exactly three.
const VALID: ReadonlyArray<readonly [string, number]> = [
  ['1000', 1000],
  ['1,000', 1000],
  ['1.000', 1000],
  ['1 000', 1000],
  [`1${NBSP}000`, 1000],
  [`1${NNBSP}000`, 1000],
  ['1,000,000', 1_000_000],
  ['1.000.000', 1_000_000],
  ['1 000 000', 1_000_000],
  ['  2500  ', 2500],
  ['0', 0],
  ['007', 7],
  ['999', 999],
  ['12,345', 12_345],
  ['123.456', 123_456],
  ['1,000,000,000,000', 1_000_000_000_000],
  ['1 000 000 000 001', 1_000_000_000_001],
  ['9007199254740991', Number.MAX_SAFE_INTEGER],
];

const INVALID: readonly string[] = [
  '',
  '   ',
  '1,5',
  '12.34',
  '1.5',
  '2500,50',
  '0x10',
  '1e3',
  '1e5',
  '-5',
  '+5',
  '-1,000',
  '1,000.000',
  '1.000,000',
  '1,00',
  '1,0000',
  '1000,000',
  '1,000,00',
  ',000',
  '.000',
  '1,000,',
  '1.',
  '0,500',
  '01,000',
  'abc',
  '12a',
  'Infinity',
  'NaN',
  '१२३',
  '9007199254740992',
  '99999999999999999999',
];

describe('parseMoneyInput', () => {
  for (const [input, expected] of VALID) {
    test(`accepts ${JSON.stringify(input)} as ${expected}`, () => {
      assert.equal(parseMoneyInput(input), expected);
    });
  }

  for (const input of INVALID) {
    test(`rejects ${JSON.stringify(input)}`, () => {
      assert.equal(parseMoneyInput(input), null);
    });
  }

  test('rejects non-string input', () => {
    assert.equal(parseMoneyInput(1000 as unknown as string), null);
    assert.equal(parseMoneyInput(undefined as unknown as string), null);
  });
});

describe('formatMoney', () => {
  test('uses the narrow no-break space everywhere', () => {
    assert.equal(MONEY_SEPARATOR, NNBSP);
  });

  const CASES: ReadonlyArray<readonly [number, string]> = [
    [0, '0 FCFA'],
    [999, '999 FCFA'],
    [1000, '1 000 FCFA'],
    [1500, '1 500 FCFA'],
    [100_000, '100 000 FCFA'],
    [1_000_000, '1 000 000 FCFA'],
    [MONEY_MAX, '1 000 000 000 000 FCFA'],
    [-1500, '-1 500 FCFA'],
    // Amounts are whole numbers; anything else is rounded for display.
    [1500.5, '1 501 FCFA'],
    [1500.4, '1 500 FCFA'],
  ];
  for (const [amount, expected] of CASES) {
    test(`formats ${amount}`, () => {
      assert.equal(formatMoney(amount), expected.replace(/ /g, NNBSP));
    });
  }

  test('round-trips through the parser', () => {
    for (const amount of [0, 7, 1000, 123_456, 1_000_000, MONEY_MAX]) {
      const text = formatMoney(amount).replace(`${NNBSP}FCFA`, '');
      assert.equal(parseMoneyInput(text), amount);
    }
  });

  test('shows non-finite values as 0 instead of NaN', () => {
    assert.equal(formatMoney(Number.NaN), `0${NNBSP}FCFA`);
  });
});

test('MONEY_MAX is one trillion FCFA', () => {
  assert.equal(MONEY_MAX, 1_000_000_000_000);
});
