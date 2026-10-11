import { MONEY_MAX, parseMoneyInput } from '@kazi/shared';
import type { ItemType } from './types';

export interface ItemFormInput {
  name: string;
  type: ItemType;
  price: string;
  notes: string;
  trackStock: boolean;
  lowStockThreshold: string;
}

export type ItemFormField = 'name' | 'price' | 'lowStockThreshold';
export type ItemFormErrors = Partial<Record<ItemFormField, string>>;

const THRESHOLD_MAX = 1e9;

export function validateStockQuantity(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return 'products.errors.quantityRequired';
  }
  if (!/^\d+$/.test(trimmed)) {
    return 'products.errors.quantityInvalid';
  }
  const number = Number(trimmed);
  if (!Number.isSafeInteger(number) || number < 1 || number > THRESHOLD_MAX) {
    return 'products.errors.quantityInvalid';
  }
  return null;
}

export function parseWholeNumber(value: string): number | null {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    return null;
  }
  const number = Number(trimmed);
  if (!Number.isSafeInteger(number)) {
    return null;
  }
  return number;
}

export function validateLowStockThreshold(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  if (!/^\d+$/.test(trimmed)) {
    return 'products.errors.thresholdInvalid';
  }
  const number = Number(trimmed);
  if (!Number.isSafeInteger(number) || number < 0 || number > THRESHOLD_MAX) {
    return 'products.errors.thresholdInvalid';
  }
  return null;
}

export function validateItemName(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return 'products.errors.nameRequired';
  }
  if (trimmed.length < 2) {
    return 'products.errors.nameMin';
  }
  if (trimmed.length > 100) {
    return 'products.errors.nameMax';
  }
  return null;
}

// Whole FCFA only, read by the same parser as every other money field. A sign
// is not a valid character, so a negative price is simply an invalid one.
export function validateItemPrice(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return 'products.errors.priceRequired';
  }
  const number = parseMoneyInput(trimmed);
  if (number === null) {
    return 'products.errors.priceInvalid';
  }
  if (number > MONEY_MAX) {
    return 'products.errors.priceTooLarge';
  }
  return null;
}

export function validateItemForm(input: ItemFormInput): ItemFormErrors {
  const errors: ItemFormErrors = {};
  const nameError = validateItemName(input.name);
  if (nameError) {
    errors.name = nameError;
  }
  const priceError = validateItemPrice(input.price);
  if (priceError) {
    errors.price = priceError;
  }
  if (input.trackStock) {
    const thresholdError = validateLowStockThreshold(input.lowStockThreshold);
    if (thresholdError) {
      errors.lowStockThreshold = thresholdError;
    }
  }
  return errors;
}

export function hasItemErrors(errors: ItemFormErrors): boolean {
  return Object.keys(errors).length > 0;
}