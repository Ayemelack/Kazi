import { z } from 'zod';

export const feedbackRatingSchema = z.coerce.number().int().min(1).max(5);

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

export const feedbackIdSchema = z.coerce.number().int().positive();

export type CreateFeedbackInput = z.infer<typeof createFeedbackSchema>;

export function validate<T>(schema: z.ZodType<T>, data: unknown): T {
  return schema.parse(data);
}