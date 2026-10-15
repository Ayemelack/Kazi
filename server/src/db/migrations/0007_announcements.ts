import type { Migration } from '../migrate.js';

// In-app announcements (merged from main on 2026-10-15): one slot (id 1) the
// admin dashboard can edit when ADMIN_ANNOUNCEMENTS=1 (decision D8) and the
// public GET /announcements serves. main created this table in the old
// pre-framework db.ts, so a database made by that code already has it: the
// statement keeps IF NOT EXISTS and main's exact text, so such a database is
// baselined and ends with the same schema as a fresh one. body_pid keeps
// main's column name; it holds the Pidgin (language code 'wes') text.
export const announcements: Migration = {
  version: 7,
  name: 'announcements',
  up(db) {
    db.exec(`
    CREATE TABLE IF NOT EXISTS announcements (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      body_en     TEXT NOT NULL DEFAULT '',
      body_fr     TEXT,
      body_pid    TEXT,
      min_version TEXT NOT NULL DEFAULT '',
      max_version TEXT NOT NULL DEFAULT '',
      active      INTEGER NOT NULL DEFAULT 1,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
`);
  },
};
