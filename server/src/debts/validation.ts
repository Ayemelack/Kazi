import { z } from 'zod';

export const debtNameSchema = z
  .string()
  .trim()
  .min(1, "The person's name is required.")
  .max(100, 'Name must be at most 100 characters.');

export const debtAmountSchema = z.coerce
  .number()
  .positive('Amount owed must be greater than 0.')
  .max(1e12, 'Amount is too large.');

export const debtNoteSchema = z
  .string()
  .trim()
  .max(200, 'Note must be at most 200 characters.')
  .optional()
  .transform(value => (value === '' ? undefined : value));

export const debtDateSchema = z.string().regex(
  /^\d{4}-\d{2}-\d{2}$/,
  'Date must be in YYYY-MM-DD format.',
);

export const createDebtSchema = z.object({
  name: debtNameSchema,
  amount: debtAmountSchema,
  note: debtNoteSchema,
  date: debtDateSchema,
  clientOpId: z
    .string()
    .trim()
    .min(8, 'Client operation id is too short.')
    .max(64, 'Client operation id is too long.')
    .optional(),
});

export const debtIdSchema = z.coerce.number().int().positive();

export const payDebtSchema = z.object({
  clientOpId: z
    .string()
    .trim()
    .min(8, 'Client operation id is too short.')
    .max(64, 'Client operation id is too long.')
    .optional(),
});

export type CreateDebtInput = z.infer<typeof createDebtSchema>;

export function validate<T>(schema: z.ZodType<T>, data: unknown): T {
  return schema.parse(data);
}