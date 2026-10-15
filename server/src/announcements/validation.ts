import { z } from 'zod';

export const announcementBodySchema = z
  .string()
  .trim()
  .min(1, 'Announcement text must not be empty.')
  .max(2000, 'Announcement text must be at most 2000 characters.');

export const announcementLocaleBodySchema = z
  .string()
  .trim()
  .max(2000, 'Announcement text must be at most 2000 characters.')
  .optional()
  .transform(value => (value === '' ? undefined : value));

export const announcementVersionSchema = z
  .string()
  .trim()
  .max(32, 'Version must be at most 32 characters.')
  .default('');

export const announcementWriteSchema = z.object({
  body_en: announcementBodySchema,
  body_fr: announcementLocaleBodySchema,
  body_pid: announcementLocaleBodySchema,
  min_version: announcementVersionSchema,
  max_version: announcementVersionSchema,
});

export type AnnouncementWriteInput = z.infer<typeof announcementWriteSchema>;

export function validate<S extends z.ZodTypeAny>(
  schema: S,
  data: unknown,
): z.infer<S> {
  return schema.parse(data) as z.infer<S>;
}