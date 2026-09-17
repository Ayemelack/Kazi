import { Router } from 'express';
import type Database from 'better-sqlite3';
import { requireAuth } from '../middleware/auth.js';
import {
  createFeedback,
  deleteFeedback,
  listFeedback,
} from './service.js';
import { createFeedbackSchema, feedbackIdSchema, validate } from './validation.js';

export function createFeedbackRouter(db: Database.Database): Router {
  const router = Router();

  router.use(requireAuth(db));

  router.get('/', (req, res, next) => {
    try {
      res
        .status(200)
        .json({ feedback: listFeedback(db, req.user?.id ?? 0) });
    } catch (err) {
      next(err);
    }
  });

  router.post('/', (req, res, next) => {
    try {
      const fb = createFeedback(
        db,
        req.user?.id ?? 0,
        validate(createFeedbackSchema, req.body),
      );
      res.status(201).json({ feedback: fb });
    } catch (err) {
      next(err);
    }
  });

  router.delete('/:id', (req, res, next) => {
    try {
      const id = validate(feedbackIdSchema, req.params.id);
      deleteFeedback(db, req.user?.id ?? 0, id);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  return router;
}