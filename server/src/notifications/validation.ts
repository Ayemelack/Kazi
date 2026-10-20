import { z } from 'zod';
import { validate } from '../auth/validation.js';
import { DEFAULT_LIMIT, MAX_LIMIT } from './history.js';

export const registerPushTokenSchema = z.object({
  token: z.string().trim().min(1, 'Token is required.').max(512, 'Token is too long.'),
  platform: z.enum(['android', 'ios', 'web']),
});

export const unregisterPushTokenSchema = z.object({
  token: z.string().trim().min(1, 'Token is required.').max(512, 'Token is too long.'),
});

export const sendNotificationSchema = z.object({
  title: z.string().trim().min(1, 'Title is required.').max(120, 'Title is too long.'),
  body: z.string().trim().min(1, 'Message is required.').max(500, 'Message is too long.'),
});

// PUT /notifications/preferences: the master push switch, plus the opt-in
// inactivity switch (decision D9). Both fields are accepted; a client that
// only knows the master switch still works (the inactivity value is then left
// as it is, not reset).
export const pushPreferencesSchema = z.object({
  pushNotifications: z.boolean(),
  inactivityNotifications: z.boolean().optional(),
});

// GET /notifications/history?limit=50: a missing limit pages in at 50, a
// value outside 1..MAX_LIMIT is a validation error rather than a surprise
// full-table response.
export const listNotificationsSchema = z.object({
  limit: z.coerce.number().int().min(1, 'Limit is too small.').max(MAX_LIMIT, 'Limit is too big.').default(DEFAULT_LIMIT),
});

export type RegisterPushTokenInput = z.infer<typeof registerPushTokenSchema>;
export type UnregisterPushTokenInput = z.infer<typeof unregisterPushTokenSchema>;
export type SendNotificationInput = z.infer<typeof sendNotificationSchema>;
export type PushPreferencesInput = z.infer<typeof pushPreferencesSchema>;
export type ListNotificationsInput = z.infer<typeof listNotificationsSchema>;

export { validate };