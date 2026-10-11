import { MONEY_MAX, parseMoneyInput } from '@kazi/shared';
import type { TransactionType } from './types';

export interface TransactionFormInput {
  type: TransactionType;
  amount: string;
  description: string;
  date: string;
  quantity: string;
}

export type TransactionFormField = 'amount' | 'date' | 'quantity' | 'description';
export type TransactionFormErrors = Partial<Record<TransactionFormField, string>>;

const QUANTITY_MAX = 1e9;

// Whole FCFA only: "1,000", "1.000" and "1 000" are all one thousand, while
// "1,5" or "12.34" are rejected instead of being saved as 1 or 12 (KZ-04).
export function validateTransactionAmount(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return 'transactions.errors.amountRequired';
  }
  const number = parseMoneyInput(trimmed);
  if (number === null) {
    return 'transactions.errors.amountInvalid';
  }
  if (number <= 0) {
    return 'transactions.errors.amountPositive';
  }
  if (number > MONEY_MAX) {
    return 'transactions.errors.amountTooLarge';
  }
  return null;
}

export function validateTransactionDate(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    return 'transactions.errors.dateInvalid';
  }
  const date = new Date(`${value.trim()}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return 'transactions.errors.dateInvalid';
  }
  return null;
}

export function validateTransactionQuantity(value: string, required: boolean): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return required ? 'transactions.errors.quantityRequired' : null;
  }
  if (!/^\d+$/.test(trimmed)) {
    return 'transactions.errors.quantityInvalid';
  }
  const number = Number(trimmed);
  if (!Number.isSafeInteger(number) || number < 1 || number > QUANTITY_MAX) {
    return 'transactions.errors.quantityInvalid';
  }
  return null;
}

export function dateToDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function todayAsDateString(): string {
  return dateToDateString(new Date());
}

// An expense has to say what the money went to. Picking an item names it, so
// that satisfies the rule on its own; otherwise the description is required.
// Without this the save would only fail once the server rejects it.
export function validateTransactionDescription(
  type: TransactionType,
  description: string,
  itemSelected: boolean,
): string | null {
  if (type !== 'purchase' || itemSelected) {
    return null;
  }
  return description.trim().length === 0
    ? 'transactions.errors.descriptionRequired'
    : null;
}

export function validateTransactionForm(
  input: TransactionFormInput,
  quantityRequired: boolean,
  itemSelected = false,
): TransactionFormErrors {
  const errors: TransactionFormErrors = {};
  const amountError = validateTransactionAmount(input.amount);
  if (amountError) {
    errors.amount = amountError;
  }
  const dateError = validateTransactionDate(input.date);
  if (dateError) {
    errors.date = dateError;
  }
  const quantityError = validateTransactionQuantity(input.quantity, quantityRequired);
  if (quantityError) {
    errors.quantity = quantityError;
  }
  const descriptionError = validateTransactionDescription(
    input.type,
    input.description,
    itemSelected,
  );
  if (descriptionError) {
    errors.description = descriptionError;
  }
  return errors;
}

export function hasTransactionErrors(errors: TransactionFormErrors): boolean {
  return Object.keys(errors).length > 0;
}