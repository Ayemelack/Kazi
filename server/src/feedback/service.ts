import type Database from 'better-sqlite3';
import { AppError } from '../errors.js';
import type { CreateFeedbackInput } from './validation.js';

export interface Feedback {
  id: number;
  rating: number;
  liked?: string;
  disliked?: string;
  suggestion?: string;
  createdAt: string;
}

interface FeedbackRow {
  id: number;
  user_id: number;
  rating: number;
  liked: string | null;
  disliked: string | null;
  suggestion: string | null;
  created_at: string;
}

function toFeedback(row: FeedbackRow): Feedback {
  return {
    id: row.id,
    rating: row.rating,
    liked: row.liked ?? undefined,
    disliked: row.disliked ?? undefined,
    suggestion: row.suggestion ?? undefined,
    createdAt: row.created_at,
  };
}

export function createFeedback(
  db: Database.Database,
  userId: number,
  input: CreateFeedbackInput,
): Feedback {
  const result = db
    .prepare(
      `INSERT INTO feedback (user_id, rating, liked, disliked, suggestion)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(userId, input.rating, input.liked ?? null, input.disliked ?? null, input.suggestion ?? null);

  const row = db
    .prepare('SELECT * FROM feedback WHERE id = ?')
    .get(result.lastInsertRowid) as unknown as FeedbackRow;

  return toFeedback(row);
}

export function listFeedback(db: Database.Database, userId: number): Feedback[] {
  const rows = db
    .prepare(
      'SELECT * FROM feedback WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 50',
    )
    .all(userId) as unknown as FeedbackRow[];
  return rows.map(toFeedback);
}

export function deleteFeedback(
  db: Database.Database,
  userId: number,
  feedbackId: number,
): void {
  const row = db
    .prepare('SELECT id FROM feedback WHERE id = ? AND user_id = ?')
    .get(feedbackId, userId) as { id: number } | undefined;
  if (!row) {
    throw new AppError(404, 'NOT_FOUND', 'This feedback does not exist.');
  }
  db.prepare('DELETE FROM feedback WHERE id = ? AND user_id = ?').run(feedbackId, userId);
}