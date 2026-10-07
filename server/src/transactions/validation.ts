import { z } from 'zod';
import { businessDateSchema } from '../validation/date.js';
import { moneyAmountSchema } from '../validation/money.js';
import { strictNumber } from '../validation/number.js';

export const transactionTypeSchema = z.enum(['sale', 'purchase', 'capital']);

export const amountSchema = moneyAmountSchema;

export const transactionDateSchema = businessDateSchema;

export const transactionDescriptionSchema = z
  .string()
  .trim()
  .max(200, 'Description must be at most 200 characters.')
  .optional()
  .transform(value => (value === '' ? undefined : value));

export const transactionItemIdSchema = strictNumber(
  z.coerce.number().int().positive(),
).optional();

export const transactionQuantitySchema = strictNumber(
  z.coerce
    .number()
    .int()
    .positive('Quantity must be at least 1.')
    .max(1e9, 'Quantity is too large.'),
).optional();

export const clientOpIdSchema = z
  .string()
  .trim()
  .min(8, 'Client operation id is too short.')
  .max(64, 'Client operation id is too long.')
  .optional();

export const createTransactionSchema = z
  .object({
    type: transactionTypeSchema,
    amount: amountSchema,
    description: transactionDescriptionSchema,
    date: transactionDateSchema,
    itemId: transactionItemIdSchema,
    quantity: transactionQuantitySchema,
    clientOpId: clientOpIdSchema,
  })
  .superRefine((value, ctx) => {
    // A money-out record must always say what the money went to. Linking an
    // item names it, so that satisfies it too; otherwise the description is
    // required. This is what keeps the history readable months later.
    if (
      value.type === 'purchase' &&
      value.itemId === undefined &&
      !value.description
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['description'],
        message: 'Describe what the money was spent on.',
      });
    }
  });

export const transactionIdSchema = strictNumber(z.coerce.number().int().positive());

export type TransactionType = z.infer<typeof transactionTypeSchema>;
export type CreateTransactionInput = z.infer<typeof createTransactionSchema>;

export function validate<S extends z.ZodTypeAny>(
  schema: S,
  data: unknown,
): z.infer<S> {
  return schema.parse(data) as z.infer<S>;
}
