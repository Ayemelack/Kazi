import { z } from 'zod';
import { MONEY_MAX } from '@kazi/shared';

// Money is whole FCFA (ADR A6), so only two forms are accepted: a JSON integer,
// or a string of plain digits (form-encoded bodies). Like strictNumber, this
// never coerces: `true`, `[800]`, "0x10", "1e3", "12.5" and "1,000" are all
// rejected instead of being turned into some other number. Thousands
// separators are the app's job (parseMoneyInput); the API only sees integers.
const DIGITS = /^\d+$/;

interface WholeMoneyOptions {
  min: 0 | 1;
  label: string;
  minMessage: string;
}

function wholeMoneySchema({ min, label, minMessage }: WholeMoneyOptions) {
  const invalid = `${label} must be a whole number of FCFA.`;
  return z
    .unknown()
    .refine(
      (value): value is number | string =>
        typeof value === 'number' || typeof value === 'string',
      value => ({
        message: invalid,
        params: { rule: value === undefined || value === null ? 'required' : 'format' },
      }),
    )
    .transform((value, ctx) => {
      const text = typeof value === 'string' ? value.trim() : '';
      const numeric = typeof value === 'number' ? value : DIGITS.test(text) ? Number(text) : NaN;

      if (!Number.isSafeInteger(numeric)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: invalid, params: { rule: 'format' } });
        return z.NEVER;
      }
      if (numeric < min) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: minMessage,
          params: { rule: 'tooSmall' },
        });
        return z.NEVER;
      }
      if (numeric > MONEY_MAX) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${label} is too large.`,
          params: { rule: 'tooLarge' },
        });
        return z.NEVER;
      }
      return numeric;
    });
}

/** A transaction or debt amount: whole FCFA, at least 1. */
export const moneyAmountSchema = wholeMoneySchema({
  min: 1,
  label: 'Amount',
  minMessage: 'Amount must be greater than 0.',
});

/** An item price: whole FCFA, 0 allowed (free or unknown). */
export const priceSchema = wholeMoneySchema({
  min: 0,
  label: 'Price',
  minMessage: 'Price cannot be negative.',
});

export type MoneyAmountInput = z.infer<typeof moneyAmountSchema>;
