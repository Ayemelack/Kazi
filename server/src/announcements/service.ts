import type Database from 'better-sqlite3';
import type { AnnouncementWriteInput } from './validation.js';

export interface Announcement {
  id: number;
  bodyEn: string;
  bodyFr?: string;
  bodyPid?: string;
  minVersion: string;
  maxVersion: string;
}

interface AnnouncementRow {
  id: number;
  body_en: string;
  body_fr: string | null;
  body_pid: string | null;
  min_version: string;
  max_version: string;
  active: number;
  created_at: string;
  updated_at: string;
}

const SELECT_COLUMNS = `
  id, body_en, body_fr, body_pid, min_version, max_version, active,
  created_at, updated_at
`;

function toAnnouncement(row: AnnouncementRow): Announcement {
  return {
    id: row.id,
    bodyEn: row.body_en,
    bodyFr: row.body_fr ?? undefined,
    bodyPid: row.body_pid ?? undefined,
    minVersion: row.min_version,
    maxVersion: row.max_version,
  };
}

function findById(db: Database.Database, id: number): AnnouncementRow {
  return db
    .prepare(`SELECT ${SELECT_COLUMNS} FROM announcements WHERE id = ?`)
    .get(id) as AnnouncementRow;
}

export function getActiveAnnouncement(db: Database.Database): Announcement | null {
  const row = db
    .prepare(
      `SELECT ${SELECT_COLUMNS}
       FROM announcements
       WHERE active = 1
       ORDER BY updated_at DESC, id DESC
       LIMIT 1`,
    )
    .get() as AnnouncementRow | undefined;
  return row ? toAnnouncement(row) : null;
}

// A single announcement slot (id = 1) is upserted so that a dismissal recorded
// on a device keeps matching across edits: the id never changes.
export function upsertAnnouncement(
  db: Database.Database,
  input: AnnouncementWriteInput,
): Announcement {
  db.prepare(
    `INSERT INTO announcements
       (id, body_en, body_fr, body_pid, min_version, max_version, active,
        created_at, updated_at)
     VALUES
       (1, ?, ?, ?, ?, ?, 1,
        COALESCE((SELECT created_at FROM announcements WHERE id = 1), datetime('now')),
        datetime('now'))
     ON CONFLICT(id) DO UPDATE SET
       body_en     = excluded.body_en,
       body_fr     = excluded.body_fr,
       body_pid    = excluded.body_pid,
       min_version = excluded.min_version,
       max_version = excluded.max_version,
       active      = 1,
       updated_at  = datetime('now')`,
  ).run(
    input.body_en,
    input.body_fr ?? null,
    input.body_pid ?? null,
    input.min_version,
    input.max_version,
  );
  return toAnnouncement(findById(db, 1));
}

export function clearAnnouncement(db: Database.Database): void {
  db.prepare(
    'UPDATE announcements SET active = 0, updated_at = datetime(\'now\') WHERE id = 1',
  ).run();
}