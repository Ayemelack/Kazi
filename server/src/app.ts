import cors from 'cors';
import express, { type Express } from 'express';
import type Database from 'better-sqlite3';
import { createAuthRouter } from './auth/routes.js';
import type { ResetDelivery } from './auth/delivery.js';
import { createActivityRouter } from './activity/routes.js';
import { createDebtsRouter } from './debts/routes.js';
import { createFeedbackRouter } from './feedback/routes.js';
import { createItemsRouter } from './items/routes.js';
import { createNotificationsRouter } from './notifications/routes.js';
import { createSummaryRouter } from './summary/routes.js';
import { createTransactionsRouter } from './transactions/routes.js';
import { errorHandler } from './errors.js';
import { byUserWrite, rateLimit } from './middleware/rateLimit.js';

export interface AppOptions {
  /**
   * How password reset codes are delivered, chosen at boot by
   * resetDeliveryFromEnv (KZ-06). Without it nothing is sent.
   */
  resetDelivery?: ResetDelivery;
  /**
   * Express's `trust proxy`: false (X-Forwarded-For ignored) or the number of
   * proxy hops, from TRUST_PROXY (KZ-08, see trustProxy.ts). Never `true`.
   */
  trustProxy?: false | number;
}

// Generous enough for any person using the app, low enough to stop a script
// (KZ-08). One bucket per user across every write route.
export const USER_WRITES_PER_MINUTE = 120;

export function createApp(db: Database.Database, options: AppOptions = {}): Express {
  const app = express();
  // Fingerprinting aid only: without this Express advertises "X-Powered-By:
  // Express" on every response, including error responses.
  app.disable('x-powered-by');
  // Per-IP rate limits key on req.ip, which follows this setting.
  app.set('trust proxy', options.trustProxy ?? false);

  // Every authenticated router counts writes (POST, PUT, PATCH, DELETE) per
  // user after requireAuth, so the bucket is the verified account, not an
  // address a proxy or mobile network shares.
  const userWrites = rateLimit({
    windowMs: 60_000,
    max: USER_WRITES_PER_MINUTE,
    key: byUserWrite,
  });

  // Lean security headers for the JSON API. Kept inline so no middleware
  // dependency is introduced for a small, fixed set of headers. Cache-Control
  // no-store keeps responses carrying account and financial data out of shared
  // proxies and intermediary caches.
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  // CORS is denied by default: the mobile client never sends an Origin header
  // and never needs browser CORS headers. It is only enabled when CORS_ORIGIN
  // (a comma-separated allowlist) is configured, so a malicious website
  // visiting a user's browser cannot drive requests against the auth endpoints
  // (rate-limit poisoning, request spam) or read API responses. The explicit
  // value "*" opts into the open behavior.
  const corsConfig = process.env.CORS_ORIGIN
    ?.split(',')
    .map(origin => origin.trim())
    .filter(Boolean);
  const corsIsOpen = corsConfig?.includes('*') === true;
  if (corsIsOpen) {
    app.use(cors());
  } else if (corsConfig && corsConfig.length > 0) {
    app.use(cors({ origin: corsConfig }));
  }
  app.use(express.json({ limit: '4mb' }));

  app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  app.use('/auth', createAuthRouter(db, userWrites, options.resetDelivery));
  app.use('/items', createItemsRouter(db, userWrites));
  app.use('/transactions', createTransactionsRouter(db, userWrites));
  app.use('/debts', createDebtsRouter(db, userWrites));
  app.use('/summary', createSummaryRouter(db));
  app.use('/activity', createActivityRouter(db));
  app.use('/feedback', createFeedbackRouter(db, userWrites));
  app.use('/notifications', createNotificationsRouter(db, userWrites));

  app.use((_req, res) => {
    res.status(404).json({
      error: { code: 'NOT_FOUND', message: 'This endpoint does not exist.' },
    });
  });

  app.use(errorHandler);

  return app;
}