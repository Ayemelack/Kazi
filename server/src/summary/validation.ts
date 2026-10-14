import { z } from 'zod';
import { businessDateSchema } from '../validation/date.js';

export const summaryQuerySchema = z.object({
  // The caller's calendar day; "today" totals are computed for it (KZ-10).
  asOf: businessDateSchema.optional(),
});
