import { MONEY_MAX, parseMoneyInput } from '@kazi/shared';

export type DebtField = 'name' | 'amount' | 'note' | 'date';
export type DebtFieldErrors = Partial<Record<DebtField, string>>;

// What the form holds: the amount is still the text the user typed.
export interface DebtFormInput {
  name: string;
  amount: string;
  note?: string;
  date: string;
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function toDateInput(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

export function todayInput(): string {
  return toDateInput(new Date());
}

export function validateDebtName(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return 'debts.errors.nameRequired';
  }
  if (trimmed.length > 100) {
    return 'debts.errors.nameMax';
  }
  return null;
}

// Same whole-FCFA parser as the sale and expense forms, so "1 000" and
// "1,000" mean the same thing here as everywhere else (KZ-04).
export function validateDebtAmount(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return 'debts.errors.amountRequired';
  }
  const numeric = parseMoneyInput(trimmed);
  if (numeric === null) {
    return 'debts.errors.amountInvalid';
  }
  if (numeric <= 0) {
    return 'debts.errors.amountPositive';
  }
  if (numeric > MONEY_MAX) {
    return 'debts.errors.amountTooLarge';
  }
  return null;
}

export function validateDebtDate(value: string): string | null {
  if (!DATE_PATTERN.test(value)) {
    return 'debts.errors.dateInvalid';
  }
  return null;
}

export function validateDebt(input: DebtFormInput): DebtFieldErrors {
  const errors: DebtFieldErrors = {};
  const nameError = validateDebtName(input.name);
  if (nameError) {
    errors.name = nameError;
  }
  const amountError = validateDebtAmount(input.amount);
  if (amountError) {
    errors.amount = amountError;
  }
  const dateError = validateDebtDate(input.date);
  if (dateError) {
    errors.date = dateError;
  }
  if (input.note && input.note.trim().length > 200) {
    errors.note = 'debts.errors.noteMax';
  }
  return errors;
}

export function hasErrors(errors: DebtFieldErrors): boolean {
  return Object.keys(errors).length > 0;
}