import { Router } from 'express';
import type Database from 'better-sqlite3';
import { requireAuth } from '../middleware/auth.js';
import { listActivity } from './service.js';
import { activityQuerySchema, validate } from './validation.js';

export function createActivityRouter(db: Database.Database): Router {
  const router = Router();

  router.use(requireAuth(db));

  router.get('/', (req, res, next) => {
    try {
      const query = validate(activityQuerySchema, req.query);
      const result = listActivity(db, req.user?.id ?? 0, query);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  });

  return router;
}