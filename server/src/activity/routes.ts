import { Router } from 'express';
import type Database from 'better-sqlite3';
import { requireAuth } from '../middleware/auth.js';
import { listActivity } from './service.js';

export function createActivityRouter(db: Database.Database): Router {
  const router = Router();

  router.use(requireAuth(db));

  router.get('/', (req, res, next) => {
    try {
      const rawLimit = Number(req.query.limit);
      const limit = Number.isNaN(rawLimit) ? 100 : rawLimit;
      res.status(200).json({ events: listActivity(db, req.user?.id ?? 0, limit) });
    } catch (err) {
      next(err);
    }
  });

  return router;
}