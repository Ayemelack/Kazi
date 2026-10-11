import { formatMoney, parseMoneyInput } from '@kazi/shared';

// Room for the largest amount written with separators ("1.000.000.000.000"
// is 17 characters) plus a few stray spaces.
export const MONEY_INPUT_MAX_LENGTH = 24;

// Shown under a money field while the user types, so they see exactly what
// will be saved ("= 1 000 FCFA"). Nothing is shown until the text reads as a
// whole amount; the field's own validation explains anything else on save.
export function moneyPreview(text: string): string | undefined {
  const amount = parseMoneyInput(text);
  return amount === null ? undefined : `= ${formatMoney(amount)}`;
}
