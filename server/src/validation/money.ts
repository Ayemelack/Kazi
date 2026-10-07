import { z } from 'zod';
import { isDecimalString } from './number.js';

// Coercion alone is not a validator: z.coerce.number() happily turns `true`
// into 1, `[800]` into 800 and "0x10" into 16. Only JSON numbers and plain
// decimal strings (form-encoded bodies) are accepted, and the value must
// survive Number() as a real finite number before it is treated as money.
export const moneyAmountSchema = z
  .unknown()
  .refine(
    (value): value is number | string =>
      typeof value === 'number' || typeof value === 'string',
    { message: 'Amount must be a number.' },
  )
  .transform((value, ctx) => {
    const isText = typeof value === 'string';
    const text = isText ? value.trim() : '';
    const numeric = isText ? Number(text) : value;

    if (!Number.isFinite(numeric) || (isText && (!text || !isDecimalString(text)))) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Amount must be a number.',
      });
      return z.NEVER;
    }
    if (numeric <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Amount must be greater than 0.',
      });
      return z.NEVER;
    }
    if (numeric > 1e12) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Amount is too large.',
      });
      return z.NEVER;
    }
    return numeric;
  });

export type MoneyAmountInput = z.infer<typeof moneyAmountSchema>;
