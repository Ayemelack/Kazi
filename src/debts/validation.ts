import type { DebtInput } from './types';

export type DebtField = 'name' | 'amount' | 'note' | 'date';
export type DebtFieldErrors = Partial<Record<DebtField, string>>;

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

export function validateDebtAmount(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return 'debts.errors.amountRequired';
  }
  const numeric = Number(trimmed.replace(',', '.'));
  if (!Number.isFinite(numeric)) {
    return 'debts.errors.amountInvalid';
  }
  if (numeric <= 0) {
    return 'debts.errors.amountPositive';
  }
  if (numeric > 1e12) {
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

export function validateDebt(input: DebtInput): DebtFieldErrors {
  const errors: DebtFieldErrors = {};
  const nameError = validateDebtName(input.name);
  if (nameError) {
    errors.name = nameError;
  }
  const amountError = validateDebtAmount(String(input.amount));
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