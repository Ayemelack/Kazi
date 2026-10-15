import { Router } from 'express';
import type Database from 'better-sqlite3';
import { getActiveAnnouncement } from './service.js';

export function createAnnouncementsRouter(db: Database.Database): Router {
  const router = Router();

  // Public, unauthenticated: the active announcement is read once per app home
  // visit by the mobile client. It only ever carries the announcement text and
  // its targeting versions, never account data.
  router.get('/', (_req, res, next) => {
    try {
      res.status(200).json({ announcement: getActiveAnnouncement(db) });
    } catch (err) {
      next(err);
    }
  });

  return router;
}