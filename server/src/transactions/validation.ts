import { z } from 'zod';

export const transactionTypeSchema = z.enum(['sale', 'purchase', 'capital']);

export const amountSchema = z.coerce
  .number()
  .positive('Amount must be greater than 0.')
  .max(1e12, 'Amount is too large.');

export const transactionDateSchema = z.string().regex(
  /^\d{4}-\d{2}-\d{2}$/,
  'Date must be in YYYY-MM-DD format.',
);

export const transactionDescriptionSchema = z
  .string()
  .trim()
  .max(200, 'Description must be at most 200 characters.')
  .optional()
  .transform(value => (value === '' ? undefined : value));

export const transactionItemIdSchema = z.coerce.number().int().positive().optional();

export const transactionQuantitySchema = z.coerce
  .number()
  .int()
  .positive('Quantity must be at least 1.')
  .max(1e9, 'Quantity is too large.')
  .optional();

export const clientOpIdSchema = z
  .string()
  .trim()
  .min(8, 'Client operation id is too short.')
  .max(64, 'Client operation id is too long.')
  .optional();

export const createTransactionSchema = z.object({
  type: transactionTypeSchema,
  amount: amountSchema,
  description: transactionDescriptionSchema,
  date: transactionDateSchema,
  itemId: transactionItemIdSchema,
  quantity: transactionQuantitySchema,
  clientOpId: clientOpIdSchema,
});

export const transactionIdSchema = z.coerce.number().int().positive();

export type TransactionType = z.infer<typeof transactionTypeSchema>;
export type CreateTransactionInput = z.infer<typeof createTransactionSchema>;

export function validate<T>(schema: z.ZodType<T>, data: unknown): T {
  return schema.parse(data);
}