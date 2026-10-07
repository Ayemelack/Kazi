import { z } from 'zod';
import { strictNumber } from '../validation/number.js';

export const feedbackRatingSchema = strictNumber(
  z.coerce.number().int().min(1).max(5),
);

export const feedbackTextSchema = z
  .string()
  .trim()
  .max(1000, 'Feedback must be at most 1000 characters.')
  .optional()
  .transform(value => (value === '' ? undefined : value));

export const createFeedbackSchema = z.object({
  rating: feedbackRatingSchema,
  liked: feedbackTextSchema,
  disliked: feedbackTextSchema,
  suggestion: feedbackTextSchema,
});

export const feedbackIdSchema = strictNumber(z.coerce.number().int().positive());

export type CreateFeedbackInput = z.infer<typeof createFeedbackSchema>;

export function validate<S extends z.ZodTypeAny>(
  schema: S,
  data: unknown,
): z.infer<S> {
  return schema.parse(data) as z.infer<S>;
}