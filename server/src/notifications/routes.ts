import { Router, type RequestHandler } from 'express';
import type Database from 'better-sqlite3';
import { rateLimit } from '../middleware/rateLimit.js';
import { requireAuth } from '../middleware/auth.js';
import {
  registerPushToken,
  sendNotificationToUser,
  unregisterPushToken,
} from './service.js';
import {
  registerPushTokenSchema,
  sendNotificationSchema,
  unregisterPushTokenSchema,
  validate,
} from './validation.js';

export function createNotificationsRouter(db: Database.Database, userWrites: RequestHandler): Router {
  const router = Router();

  router.use(requireAuth(db), userWrites);

  router.post('/push-tokens', (req, res, next) => {
    try {
      const input = validate(registerPushTokenSchema, req.body);
      const token = registerPushToken(db, req.user?.id ?? 0, input);
      res.status(200).json({ token });
    } catch (err) {
      next(err);
    }
  });

  router.delete('/push-tokens', (req, res, next) => {
    try {
      const input = validate(unregisterPushTokenSchema, req.body);
      unregisterPushToken(db, req.user?.id ?? 0, input.token);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  });

  // Every send fans out to the caller's own push tokens, so an authenticated
  // caller could otherwise burn the Firebase quota in a tight loop. Counted
  // per user (on top of the general write limit), not per address.
  const sendLimiter = rateLimit({ windowMs: 60_000, max: 10, key: req => `send:${req.user?.id ?? 0}` });

  router.post('/send', sendLimiter, async (req, res, next) => {
    try {
      const input = validate(sendNotificationSchema, req.body);
      const result = await sendNotificationToUser(db, req.user?.id ?? 0, input);
      res.status(200).json({ result });
    } catch (err) {
      next(err);
    }
  });

  return router;
}