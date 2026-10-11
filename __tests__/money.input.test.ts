import { parseMoneyInput } from '@kazi/shared';
import { validateTransactionAmount } from '../src/transactions/validation';
import { validateItemPrice } from '../src/items/validation';
import { validateDebtAmount } from '../src/debts/validation';
import { moneyPreview } from '../src/money/input';

const NNBSP = ' ';

// KZ-04: every money field in the app reads text the same way. The examples
// are the ones in REMEDIATION_PLAN.md; the full parser table lives in
// shared/src/money.test.ts.
const VALID: Array<[string, number]> = [
  ['1,000', 1000],
  ['1.000', 1000],
  ['1 000', 1000],
  ['1000', 1000],
  ['1,000,000', 1_000_000],
  ['1.000.000', 1_000_000],
];

const INVALID = ['1,5', '12.34', '0x10', '1e3', '-5', '1,000.000'];

describe('money input (KZ-04)', () => {
  it.each(VALID)('the app reads %j as %d', (text, expected) => {
    expect(parseMoneyInput(text)).toBe(expected);
  });

  it.each(VALID)('every money form accepts %j', text => {
    expect(validateTransactionAmount(text)).toBeNull();
    expect(validateItemPrice(text)).toBeNull();
    expect(validateDebtAmount(text)).toBeNull();
  });

  it.each(INVALID)('every money form rejects %j with a translated key', text => {
    expect(parseMoneyInput(text)).toBeNull();
    expect(validateTransactionAmount(text)).toBe('transactions.errors.amountInvalid');
    expect(validateItemPrice(text)).toBe('products.errors.priceInvalid');
    expect(validateDebtAmount(text)).toBe('debts.errors.amountInvalid');
  });

  it('every money form requires a value', () => {
    expect(validateTransactionAmount('')).toBe('transactions.errors.amountRequired');
    expect(validateItemPrice('')).toBe('products.errors.priceRequired');
    expect(validateDebtAmount('')).toBe('debts.errors.amountRequired');
  });

  it('previews the parsed value under the field', () => {
    expect(moneyPreview('1,000')).toBe(`= 1${NNBSP}000${NNBSP}FCFA`);
    expect(moneyPreview('1.000.000')).toBe(`= 1${NNBSP}000${NNBSP}000${NNBSP}FCFA`);
    expect(moneyPreview('1,5')).toBeUndefined();
    expect(moneyPreview('')).toBeUndefined();
  });
});
