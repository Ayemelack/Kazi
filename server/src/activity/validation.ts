import { z } from 'zod';
import {
  ACTIVITY_OFFSET_MAX,
  ACTIVITY_PAGE_DEFAULT,
  ACTIVITY_PAGE_MAX,
} from '@kazi/shared';
import { businessDateSchema } from '../validation/date.js';
import { strictNumber } from '../validation/number.js';

export const historyPeriodSchema = z
  .enum(['today', 'yesterday', 'this_week', 'older', 'all'])
  .optional();

const optionalDateSchema = businessDateSchema.optional();

export const activityQuerySchema = z.object({
  period: historyPeriodSchema,
  startDate: optionalDateSchema,
  endDate: optionalDateSchema,
  // asOf is the caller's local calendar day. Period filters (today, yesterday,
  // this week) are resolved against it so a record written just after midnight
  // in the owner's timezone is never bucketed into the wrong business day by
  // the server's clock.
  asOf: optionalDateSchema,
  limit: strictNumber(z.coerce.number().int().min(1).max(ACTIVITY_PAGE_MAX))
    .optional()
    .default(ACTIVITY_PAGE_DEFAULT),
  // Bounded because SQLite rejects an OFFSET it cannot store as an integer,
  // which would surface as a 500 instead of a validation error.
  offset: strictNumber(z.coerce.number().int().min(0).max(ACTIVITY_OFFSET_MAX))
    .optional()
    .default(0),
});

export type ActivityQueryInput = z.infer<typeof activityQuerySchema>;

export function validate<S extends z.ZodTypeAny>(
  schema: S,
  data: unknown,
): z.infer<S> {
  return schema.parse(data) as z.infer<S>;
}
