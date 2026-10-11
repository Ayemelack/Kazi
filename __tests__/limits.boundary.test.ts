import {
  ACTIVITY_PAGE_MAX,
  BUSINESS_DATE_MIN,
  BUSINESS_TYPE_MAX,
  COMPANY_NAME_MAX,
  COMPANY_NAME_MIN,
  DEBT_NAME_MAX,
  DEBT_NOTE_MAX,
  EMAIL_MAX,
  HISTORY_PAGE_SIZE,
  ITEM_NAME_MAX,
  ITEM_NAME_MIN,
  LOW_STOCK_THRESHOLD_MAX,
  MONEY_MAX,
  PASSWORD_MAX_BYTES,
  PASSWORD_MIN,
  PERSON_NAME_MAX,
  QUANTITY_MAX,
  businessDateMax,
  localDateString,
  shiftDate,
} from '@kazi/shared';
import {
  validateBusinessType,
  validateCompanyName,
  validateEmail,
  validateName,
  validatePassword,
} from '../src/auth/validation';
import {
  validateItemName,
  validateItemPrice,
  validateLowStockThreshold,
  validateStockQuantity,
} from '../src/items/validation';
import {
  validateTransactionAmount,
  validateTransactionDate,
  validateTransactionQuantity,
} from '../src/transactions/validation';
import {
  validateDebt,
  validateDebtAmount,
  validateDebtDate,
  validateDebtName,
} from '../src/debts/validation';
import { pickerBounds, shiftMonth } from '../src/components/ui/DatePickerModal';

// KZ-16: the app and the API import every limit from @kazi/shared. Each app
// validator is pinned to the shared constant at its exact boundary, so one
// that goes back to a literal number (or drifts from the constant) fails here.
// server/src/validation/limits.test.ts does the same for the API's schemas.

type Validator = (value: string) => string | null;

function expectBoundary(validator: Validator, ok: string, over: string): void {
  expect(validator(ok)).toBeNull();
  expect(validator(over)).not.toBeNull();
}

const text = (n: number) => 'a'.repeat(n);
const email = (n: number) => `${text(n - '@example.com'.length)}@example.com`;
const today = localDateString();

describe('account limits', () => {
  it('person name max', () => expectBoundary(validateName, text(PERSON_NAME_MAX), text(PERSON_NAME_MAX + 1)));
  it('company name min', () => expectBoundary(validateCompanyName, text(COMPANY_NAME_MIN), text(COMPANY_NAME_MIN - 1)));
  it('company name max', () => expectBoundary(validateCompanyName, text(COMPANY_NAME_MAX), text(COMPANY_NAME_MAX + 1)));
  it('business type max', () => expectBoundary(validateBusinessType, text(BUSINESS_TYPE_MAX), text(BUSINESS_TYPE_MAX + 1)));
  it('email max', () => expectBoundary(validateEmail, email(EMAIL_MAX), email(EMAIL_MAX + 1)));
  it('password min', () => expectBoundary(validatePassword, `a1${text(PASSWORD_MIN - 2)}`, `a1${text(PASSWORD_MIN - 3)}`));
  it('password max in ASCII', () =>
    expectBoundary(validatePassword, `a1${text(PASSWORD_MAX_BYTES - 2)}`, `a1${text(PASSWORD_MAX_BYTES - 1)}`));

  it('password max counts UTF-8 bytes, as bcrypt and the API do', () => {
    // "é" is 2 bytes and "😀" 4, so 37 and 19 characters already reach 72 bytes.
    expectBoundary(validatePassword, `a1${'é'.repeat(35)}`, `a1${'é'.repeat(36)}`);
    expectBoundary(validatePassword, `a1${'😀'.repeat(17)}`, `a1${'😀'.repeat(18)}`);
    expect(validatePassword(`a1${'é'.repeat(36)}`)).toBe('auth.errors.passwordMax');
  });
});

describe('item, stock and transaction limits', () => {
  it('item name min', () => expectBoundary(validateItemName, text(ITEM_NAME_MIN), text(ITEM_NAME_MIN - 1)));
  it('item name max', () => expectBoundary(validateItemName, text(ITEM_NAME_MAX), text(ITEM_NAME_MAX + 1)));
  it('low-stock threshold max', () =>
    expectBoundary(validateLowStockThreshold, String(LOW_STOCK_THRESHOLD_MAX), String(LOW_STOCK_THRESHOLD_MAX + 1)));
  it('stock quantity max', () => expectBoundary(validateStockQuantity, String(QUANTITY_MAX), String(QUANTITY_MAX + 1)));
  it('transaction quantity max', () =>
    expectBoundary(v => validateTransactionQuantity(v, true), String(QUANTITY_MAX), String(QUANTITY_MAX + 1)));
  it('money max', () => {
    expectBoundary(validateTransactionAmount, String(MONEY_MAX), String(MONEY_MAX + 1));
    expectBoundary(validateItemPrice, String(MONEY_MAX), String(MONEY_MAX + 1));
    expectBoundary(validateDebtAmount, String(MONEY_MAX), String(MONEY_MAX + 1));
  });
  it('debt name max', () => expectBoundary(validateDebtName, text(DEBT_NAME_MAX), text(DEBT_NAME_MAX + 1)));
  it('debt note max', () => {
    const debt = (note: string) => validateDebt({ name: 'Paul', amount: '1000', date: today, note }).note ?? null;
    expectBoundary(debt, text(DEBT_NOTE_MAX), text(DEBT_NOTE_MAX + 1));
  });
});

describe('business date window', () => {
  const max = businessDateMax();

  it('transaction dates', () => {
    expectBoundary(validateTransactionDate, BUSINESS_DATE_MIN, shiftDate(BUSINESS_DATE_MIN, -1));
    expectBoundary(validateTransactionDate, max, shiftDate(max, 1));
    expect(validateTransactionDate(shiftDate(max, 1))).toBe('transactions.errors.dateOutOfRange');
  });

  it('debt dates', () => {
    expectBoundary(validateDebtDate, BUSINESS_DATE_MIN, shiftDate(BUSINESS_DATE_MIN, -1));
    expectBoundary(validateDebtDate, max, shiftDate(max, 1));
    expect(validateDebtDate('2026-02-30')).toBe('debts.errors.dateInvalid');
  });

  it('the date picker offers exactly the same window', () => {
    expect(pickerBounds(today)).toEqual({ min: BUSINESS_DATE_MIN, max });
    const bounds = pickerBounds('2026-10-11');
    const january2000 = { year: 2000, month: 0 };
    expect(shiftMonth(january2000, -1, bounds)).toBe(january2000);
    expect(shiftMonth(january2000, 1, bounds)).toEqual({ year: 2000, month: 1 });
    const october2027 = { year: 2027, month: 9 };
    expect(shiftMonth(october2027, 1, bounds)).toBe(october2027);
    expect(shiftMonth(october2027, -1, bounds)).toEqual({ year: 2027, month: 8 });
  });
});

// Inputs limited only by maxLength are guarded in limits.maxlength.test.js.
describe('paging', () => {
  it('the app never asks for more history rows than the API serves', () => {
    expect(HISTORY_PAGE_SIZE).toBeLessThanOrEqual(ACTIVITY_PAGE_MAX);
  });
});
