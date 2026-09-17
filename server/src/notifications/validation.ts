import { z } from 'zod';
import { validate } from '../auth/validation.js';

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

export type RegisterPushTokenInput = z.infer<typeof registerPushTokenSchema>;
export type UnregisterPushTokenInput = z.infer<typeof unregisterPushTokenSchema>;
export type SendNotificationInput = z.infer<typeof sendNotificationSchema>;

export { validate };