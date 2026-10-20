import { Router, type RequestHandler } from 'express';
import type Database from 'better-sqlite3';
import { rateLimit } from '../middleware/rateLimit.js';
import { requireAuth } from '../middleware/auth.js';
import { listNotifications, markAllRead, unreadCount } from './history.js';
import { getPushPreferences, setPushPreferences } from './preferences.js';
import {
  registerPushToken,
  sendNotificationToUser,
  unregisterPushToken,
} from './service.js';
import {
  listNotificationsSchema,
  pushPreferencesSchema,
  registerPushTokenSchema,
  sendNotificationSchema,
  unregisterPushTokenSchema,
  validate,
} from './validation.js';

/**
 * POST /notifications/send is a testing aid (KZ-03): it is served only when
 * NOTIFICATIONS_TEST_SEND=1 and NODE_ENV is not production. Anywhere else the
 * route doesn't exist (404). The real sender is the low-stock alert.
 */
export function testSendFromEnv(env: NodeJS.ProcessEnv): boolean {
  return env.NOTIFICATIONS_TEST_SEND === '1' && env.NODE_ENV !== 'production';
}

export interface NotificationsRouterOptions {
  testSend: boolean;
}

export function createNotificationsRouter(
  db: Database.Database,
  userWrites: RequestHandler,
  options: NotificationsRouterOptions = { testSend: false },
): Router {
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

  // One switch per account: whether Kazi may push to it at all (decision C1).
  // deliverPush and the low-stock alert both read it before calling FCM.
  router.get('/preferences', (req, res, next) => {
    try {
      res.status(200).json(getPushPreferences(db, req.user?.id ?? 0));
    } catch (err) {
      next(err);
    }
  });

  router.put('/preferences', (req, res, next) => {
    try {
      const input = validate(pushPreferencesSchema, req.body);
      res
        .status(200)
        .json(
          setPushPreferences(
            db,
            req.user?.id ?? 0,
            input.pushNotifications,
            input.inactivityNotifications,
          ),
        );
    } catch (err) {
      next(err);
    }
  });

  // What at least one device actually accepted (decision C2), newest first.
  router.get('/history', (req, res, next) => {
    try {
      const { limit } = validate(listNotificationsSchema, req.query);
      res.status(200).json({ notifications: listNotifications(db, req.user?.id ?? 0, limit) });
    } catch (err) {
      next(err);
    }
  });

  router.get('/unread-count', (req, res, next) => {
    try {
      res.status(200).json({ unread: unreadCount(db, req.user?.id ?? 0) });
    } catch (err) {
      next(err);
    }
  });

  router.post('/read-all', (req, res, next) => {
    try {
      res.status(200).json({ updated: markAllRead(db, req.user?.id ?? 0) });
    } catch (err) {
      next(err);
    }
  });

  if (!options.testSend) {
    return router;
  }

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