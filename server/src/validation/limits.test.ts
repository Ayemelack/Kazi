import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { z } from 'zod';
import {
  ACTIVITY_OFFSET_MAX,
  ACTIVITY_PAGE_DEFAULT,
  ACTIVITY_PAGE_MAX,
  BUSINESS_DATE_MIN,
  BUSINESS_TYPE_MAX,
  CLIENT_OP_ID_MAX,
  CLIENT_OP_ID_MIN,
  COMPANY_NAME_MAX,
  COMPANY_NAME_MIN,
  DEBT_NAME_MAX,
  DEBT_NOTE_MAX,
  EMAIL_MAX,
  FEEDBACK_TEXT_MAX,
  ITEM_NAME_MAX,
  ITEM_NAME_MIN,
  ITEM_NOTES_MAX,
  LOW_STOCK_THRESHOLD_MAX,
  PASSWORD_MAX_BYTES,
  PASSWORD_MIN,
  PERSON_NAME_MAX,
  QUANTITY_MAX,
  STOCK_REASON_MAX,
  TRANSACTION_DESCRIPTION_MAX,
  businessDateMax,
  shiftDate,
} from '@kazi/shared';
import { profileSchema, signupSchema } from '../auth/validation.js';
import { createItemSchema, stockMovementSchema } from '../items/validation.js';
import { createTransactionSchema } from '../transactions/validation.js';
import { createDebtSchema } from '../debts/validation.js';
import { createFeedbackSchema } from '../feedback/validation.js';
import { activityQuerySchema } from '../activity/validation.js';
import { businessDateSchema } from './date.js';

// KZ-16: the API and the app import every limit from @kazi/shared. These tests
// pin each API schema to the shared constant at its exact boundary, so a schema
// that goes back to a literal number (or drifts from the constant) fails here.
// __tests__/limits.boundary.test.ts does the same for the app's validators.

const today = new Date().toISOString().slice(0, 10);
const VALID_SIGNUP = { firstName: 'Awa', lastName: 'Ndi', email: 'awa@shop.cm', password: 'kazi1234' };
const VALID_ITEM = { name: 'Rice', type: 'product', price: 1000 };
const VALID_SALE = { type: 'sale', amount: 1000, date: today };
const VALID_DEBT = { name: 'Paul', amount: 1000, date: today };

function accepts(schema: z.ZodTypeAny, data: unknown): boolean {
  return schema.safeParse(data).success;
}

// `ok` must pass and `over` must fail; both are built from the shared constant.
function boundary(label: string, schema: z.ZodTypeAny, ok: unknown, over: unknown): void {
  test(label, () => {
    assert.equal(accepts(schema, ok), true, `${label}: value at the limit is accepted`);
    assert.equal(accepts(schema, over), false, `${label}: value past the limit is rejected`);
  });
}

const text = (n: number) => 'a'.repeat(n);
const email = (n: number) => `${text(n - '@example.com'.length)}@example.com`;

describe('account limits', () => {
  boundary('first name max', signupSchema, { ...VALID_SIGNUP, firstName: text(PERSON_NAME_MAX) }, { ...VALID_SIGNUP, firstName: text(PERSON_NAME_MAX + 1) });
  boundary('last name max', signupSchema, { ...VALID_SIGNUP, lastName: text(PERSON_NAME_MAX) }, { ...VALID_SIGNUP, lastName: text(PERSON_NAME_MAX + 1) });
  boundary('email max', signupSchema, { ...VALID_SIGNUP, email: email(EMAIL_MAX) }, { ...VALID_SIGNUP, email: email(EMAIL_MAX + 1) });
  boundary('password min', signupSchema, { ...VALID_SIGNUP, password: `a1${text(PASSWORD_MIN - 2)}` }, { ...VALID_SIGNUP, password: `a1${text(PASSWORD_MIN - 3)}` });
  boundary('password max (ASCII bytes)', signupSchema, { ...VALID_SIGNUP, password: `a1${text(PASSWORD_MAX_BYTES - 2)}` }, { ...VALID_SIGNUP, password: `a1${text(PASSWORD_MAX_BYTES - 1)}` });
  // "é" is 2 bytes and "😀" 4: 37 and 19 characters already reach 72 bytes.
  boundary('password max (2-byte characters)', signupSchema, { ...VALID_SIGNUP, password: `a1${'é'.repeat(35)}` }, { ...VALID_SIGNUP, password: `a1${'é'.repeat(36)}` });
  boundary('password max (4-byte characters)', signupSchema, { ...VALID_SIGNUP, password: `a1${'😀'.repeat(17)}` }, { ...VALID_SIGNUP, password: `a1${'😀'.repeat(18)}` });
  boundary('company name min', profileSchema, { companyName: text(COMPANY_NAME_MIN), businessType: 'Shop' }, { companyName: text(COMPANY_NAME_MIN - 1), businessType: 'Shop' });
  boundary('company name max', profileSchema, { companyName: text(COMPANY_NAME_MAX), businessType: 'Shop' }, { companyName: text(COMPANY_NAME_MAX + 1), businessType: 'Shop' });
  boundary('business type max', profileSchema, { companyName: 'Shop', businessType: text(BUSINESS_TYPE_MAX) }, { companyName: 'Shop', businessType: text(BUSINESS_TYPE_MAX + 1) });

  test('a 37-character password of 2-byte letters is refused, not truncated by bcrypt', () => {
    const password = `a1${'é'.repeat(36)}`;
    assert.equal(password.length, 38);
    const result = signupSchema.safeParse({ ...VALID_SIGNUP, password });
    assert.equal(result.success, false);
    assert.match(JSON.stringify(result.error?.issues), /72 bytes/);
  });
});

describe('item and stock limits', () => {
  boundary('item name min', createItemSchema, { ...VALID_ITEM, name: text(ITEM_NAME_MIN) }, { ...VALID_ITEM, name: text(ITEM_NAME_MIN - 1) });
  boundary('item name max', createItemSchema, { ...VALID_ITEM, name: text(ITEM_NAME_MAX) }, { ...VALID_ITEM, name: text(ITEM_NAME_MAX + 1) });
  boundary('item notes max', createItemSchema, { ...VALID_ITEM, notes: text(ITEM_NOTES_MAX) }, { ...VALID_ITEM, notes: text(ITEM_NOTES_MAX + 1) });
  boundary('low-stock threshold max', createItemSchema, { ...VALID_ITEM, lowStockThreshold: LOW_STOCK_THRESHOLD_MAX }, { ...VALID_ITEM, lowStockThreshold: LOW_STOCK_THRESHOLD_MAX + 1 });
  boundary('stock quantity max', stockMovementSchema, { quantity: QUANTITY_MAX }, { quantity: QUANTITY_MAX + 1 });
  boundary('stock reason max', stockMovementSchema, { quantity: 1, reason: text(STOCK_REASON_MAX) }, { quantity: 1, reason: text(STOCK_REASON_MAX + 1) });
});

describe('transaction, debt and feedback limits', () => {
  boundary('transaction description max', createTransactionSchema, { ...VALID_SALE, description: text(TRANSACTION_DESCRIPTION_MAX) }, { ...VALID_SALE, description: text(TRANSACTION_DESCRIPTION_MAX + 1) });
  boundary('transaction quantity max', createTransactionSchema, { ...VALID_SALE, quantity: QUANTITY_MAX }, { ...VALID_SALE, quantity: QUANTITY_MAX + 1 });
  boundary('client op id min', createTransactionSchema, { ...VALID_SALE, clientOpId: text(CLIENT_OP_ID_MIN) }, { ...VALID_SALE, clientOpId: text(CLIENT_OP_ID_MIN - 1) });
  boundary('client op id max', createTransactionSchema, { ...VALID_SALE, clientOpId: text(CLIENT_OP_ID_MAX) }, { ...VALID_SALE, clientOpId: text(CLIENT_OP_ID_MAX + 1) });
  boundary('debt name max', createDebtSchema, { ...VALID_DEBT, name: text(DEBT_NAME_MAX) }, { ...VALID_DEBT, name: text(DEBT_NAME_MAX + 1) });
  boundary('debt note max', createDebtSchema, { ...VALID_DEBT, note: text(DEBT_NOTE_MAX) }, { ...VALID_DEBT, note: text(DEBT_NOTE_MAX + 1) });
  boundary('feedback text max', createFeedbackSchema, { rating: 5, liked: text(FEEDBACK_TEXT_MAX) }, { rating: 5, liked: text(FEEDBACK_TEXT_MAX + 1) });
});

describe('business date window and paging', () => {
  boundary('earliest business date', businessDateSchema, BUSINESS_DATE_MIN, shiftDate(BUSINESS_DATE_MIN, -1));
  boundary('latest business date', businessDateSchema, businessDateMax(), shiftDate(businessDateMax(), 1));
  boundary('history page size max', activityQuerySchema, { limit: ACTIVITY_PAGE_MAX }, { limit: ACTIVITY_PAGE_MAX + 1 });
  boundary('history offset max', activityQuerySchema, { offset: ACTIVITY_OFFSET_MAX }, { offset: ACTIVITY_OFFSET_MAX + 1 });

  test('history page size defaults to the shared default', () => {
    assert.equal(activityQuerySchema.parse({}).limit, ACTIVITY_PAGE_DEFAULT);
  });
});
