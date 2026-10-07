import { z } from 'zod';
import { strictNumber } from '../validation/number.js';

export const itemTypeSchema = z.enum(['product', 'service']);

const nameSchema = z
  .string()
  .trim()
  .min(2, 'Name must be at least 2 characters.')
  .max(100, 'Name must be at most 100 characters.');

const notesSchema = z
  .string()
  .trim()
  .max(500, 'Notes must be at most 500 characters.')
  .optional()
  .transform(value => (value === '' ? undefined : value));

const IMAGE_MAX = 2_000_000;

const imageSchema = z
  .string()
  .trim()
  .max(IMAGE_MAX, 'Image is too large.')
  .regex(
    /^data:image\/(jpeg|png|webp|gif);base64,[A-Za-z0-9+/=]+$/,
    'Image must be a JPEG, PNG, or WebP data URI.',
  )
  .optional();

export const trackStockSchema = z.boolean().optional();

export const lowStockThresholdSchema = strictNumber(
  z.coerce
    .number()
    .int()
    .min(0, 'Low stock alert must be 0 or more.')
    .max(1e9, 'Low stock alert is too large.'),
).optional();

export const createItemSchema = z.object({
  name: nameSchema,
  type: itemTypeSchema,
  price: strictNumber(
    z.coerce.number().min(0, 'Price cannot be negative.').max(1e12, 'Price is too large.'),
  ),
  notes: notesSchema,
  image: imageSchema,
  trackStock: z.boolean().optional(),
  lowStockThreshold: lowStockThresholdSchema,
  clientOpId: z
    .string()
    .trim()
    .min(8, 'Client operation id is too short.')
    .max(64, 'Client operation id is too long.')
    .optional(),
});

export const updateItemSchema = createItemSchema;

export const stockQuantitySchema = strictNumber(
  z.coerce
    .number()
    .int()
    .positive('Quantity must be at least 1.')
    .max(1e9, 'Quantity is too large.'),
);

export const stockReasonSchema = z
  .string()
  .trim()
  .max(200, 'Reason must be at most 200 characters.')
  .optional()
  .transform(value => (value === '' ? undefined : value));

export const stockMovementSchema = z.object({
  quantity: stockQuantitySchema,
  reason: stockReasonSchema,
  clientOpId: z
    .string()
    .trim()
    .min(8, 'Client operation id is too short.')
    .max(64, 'Client operation id is too long.')
    .optional(),
});

export const itemIdSchema = strictNumber(z.coerce.number().int().positive());

export type ItemType = z.infer<typeof itemTypeSchema>;
export type CreateItemInput = z.infer<typeof createItemSchema>;
export type UpdateItemInput = z.infer<typeof updateItemSchema>;
export type StockMovementInput = z.infer<typeof stockMovementSchema>;

export function validate<S extends z.ZodTypeAny>(
  schema: S,
  data: unknown,
): z.infer<S> {
  return schema.parse(data) as z.infer<S>;
}