import { Router } from 'express';
import type Database from 'better-sqlite3';
import { requireAuth } from '../middleware/auth.js';
import { moneySummary } from './service.js';
import { summaryQuerySchema } from './validation.js';

export function createSummaryRouter(db: Database.Database): Router {
  const router = Router();

  router.use(requireAuth(db));

  router.get('/', (req, res, next) => {
    try {
      const { asOf } = summaryQuerySchema.parse(req.query);
      res.status(200).json({ summary: moneySummary(db, req.user?.id ?? 0, asOf) });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
