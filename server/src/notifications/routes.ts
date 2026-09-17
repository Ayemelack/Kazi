import { Router } from 'express';
import type Database from 'better-sqlite3';
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

export function createNotificationsRouter(db: Database.Database): Router {
  const router = Router();

  router.use(requireAuth(db));

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

  router.post('/send', async (req, res, next) => {
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