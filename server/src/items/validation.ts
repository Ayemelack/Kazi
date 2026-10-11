import { z } from 'zod';
import {
  CLIENT_OP_ID_MAX,
  CLIENT_OP_ID_MIN,
  ITEM_NAME_MAX,
  ITEM_NAME_MIN,
  ITEM_NOTES_MAX,
  LOW_STOCK_THRESHOLD_MAX,
  QUANTITY_MAX,
  STOCK_REASON_MAX,
} from '@kazi/shared';
import { priceSchema } from '../validation/money.js';
import { strictNumber } from '../validation/number.js';

export const itemTypeSchema = z.enum(['product', 'service']);

const nameSchema = z
  .string()
  .trim()
  .min(ITEM_NAME_MIN, `Name must be at least ${ITEM_NAME_MIN} characters.`)
  .max(ITEM_NAME_MAX, `Name must be at most ${ITEM_NAME_MAX} characters.`);

const notesSchema = z
  .string()
  .trim()
  .max(ITEM_NOTES_MAX, `Notes must be at most ${ITEM_NOTES_MAX} characters.`)
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
    .max(LOW_STOCK_THRESHOLD_MAX, 'Low stock alert is too large.'),
).optional();

export const createItemSchema = z.object({
  name: nameSchema,
  type: itemTypeSchema,
  price: priceSchema,
  notes: notesSchema,
  image: imageSchema,
  trackStock: z.boolean().optional(),
  lowStockThreshold: lowStockThresholdSchema,
  clientOpId: z
    .string()
    .trim()
    .min(CLIENT_OP_ID_MIN, 'Client operation id is too short.')
    .max(CLIENT_OP_ID_MAX, 'Client operation id is too long.')
    .optional(),
});

export const updateItemSchema = createItemSchema;

export const stockQuantitySchema = strictNumber(
  z.coerce
    .number()
    .int()
    .positive('Quantity must be at least 1.')
    .max(QUANTITY_MAX, 'Quantity is too large.'),
);

export const stockReasonSchema = z
  .string()
  .trim()
  .max(STOCK_REASON_MAX, `Reason must be at most ${STOCK_REASON_MAX} characters.`)
  .optional()
  .transform(value => (value === '' ? undefined : value));

export const stockMovementSchema = z.object({
  quantity: stockQuantitySchema,
  reason: stockReasonSchema,
  clientOpId: z
    .string()
    .trim()
    .min(CLIENT_OP_ID_MIN, 'Client operation id is too short.')
    .max(CLIENT_OP_ID_MAX, 'Client operation id is too long.')
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