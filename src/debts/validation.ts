import {
  DEBT_NAME_MAX,
  DEBT_NOTE_MAX,
  MONEY_MAX,
  isCalendarDate,
  isWithinBusinessDateWindow,
  parseMoneyInput,
} from '@kazi/shared';

export type DebtField = 'name' | 'amount' | 'note' | 'date';
export type DebtFieldErrors = Partial<Record<DebtField, string>>;

// What the form holds: the amount is still the text the user typed.
export interface DebtFormInput {
  name: string;
  amount: string;
  note?: string;
  date: string;
}

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
  if (trimmed.length > DEBT_NAME_MAX) {
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

// Same window as the API and the date picker: 2000-01-01 up to a year ahead.
export function validateDebtDate(value: string): string | null {
  if (!isCalendarDate(value)) {
    return 'debts.errors.dateInvalid';
  }
  if (!isWithinBusinessDateWindow(value)) {
    return 'debts.errors.dateOutOfRange';
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
  if (input.note && input.note.trim().length > DEBT_NOTE_MAX) {
    errors.note = 'debts.errors.noteMax';
  }
  return errors;
}

export function hasErrors(errors: DebtFieldErrors): boolean {
  return Object.keys(errors).length > 0;
}