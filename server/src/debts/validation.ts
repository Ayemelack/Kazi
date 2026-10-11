import { z } from 'zod';
import {
  CLIENT_OP_ID_MAX,
  CLIENT_OP_ID_MIN,
  DEBT_NAME_MAX,
  DEBT_NOTE_MAX,
} from '@kazi/shared';
import { businessDateSchema } from '../validation/date.js';
import { moneyAmountSchema } from '../validation/money.js';
import { strictNumber } from '../validation/number.js';

export const debtNameSchema = z
  .string()
  .trim()
  .min(1, "The person's name is required.")
  .max(DEBT_NAME_MAX, `Name must be at most ${DEBT_NAME_MAX} characters.`);

export const debtAmountSchema = moneyAmountSchema;

export const debtNoteSchema = z
  .string()
  .trim()
  .max(DEBT_NOTE_MAX, `Note must be at most ${DEBT_NOTE_MAX} characters.`)
  .optional()
  .transform(value => (value === '' ? undefined : value));

export const debtDateSchema = businessDateSchema;

export const debtStatusSchema = z.enum(['open', 'paid']).optional();
export const listDebtsQuerySchema = z.object({
  status: debtStatusSchema,
});

export const createDebtSchema = z.object({
  name: debtNameSchema,
  amount: debtAmountSchema,
  note: debtNoteSchema,
  date: debtDateSchema,
  clientOpId: z
    .string()
    .trim()
    .min(CLIENT_OP_ID_MIN, 'Client operation id is too short.')
    .max(CLIENT_OP_ID_MAX, 'Client operation id is too long.')
    .optional(),
});

export const debtIdSchema = strictNumber(z.coerce.number().int().positive());

export const payDebtSchema = z.object({
  // The owner marks the debt paid on their own calendar day, which may not be
  // the server's day. That date becomes the history entry's business date; the
  // exact instant is recorded separately in paid_at.
  date: businessDateSchema.optional(),
  clientOpId: z
    .string()
    .trim()
    .min(CLIENT_OP_ID_MIN, 'Client operation id is too short.')
    .max(CLIENT_OP_ID_MAX, 'Client operation id is too long.')
    .optional(),
});

export type CreateDebtInput = z.infer<typeof createDebtSchema>;
export type PayDebtInput = z.infer<typeof payDebtSchema>;

export function validate<S extends z.ZodTypeAny>(
  schema: S,
  data: unknown,
): z.infer<S> {
  return schema.parse(data) as z.infer<S>;
}