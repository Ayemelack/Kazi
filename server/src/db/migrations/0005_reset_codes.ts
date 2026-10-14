import type { Migration } from '../migrate.js';

// KZ-06: password reset by a 6-digit code sent by email. A row holds the
// code's HMAC (never the code), when it expires and how many wrong tries it
// has had. The old table was keyed by the hash of a long token that the API
// returned in its response; a 6-digit code can repeat across accounts, so it
// can't be the key, and the old rows are useless to the new flow (they expired
// within 30 minutes anyway). The table is recreated empty.
export const resetCodes: Migration = {
  version: 5,
  name: 'reset_codes',
  up(db) {
    db.exec(`
      DROP TABLE IF EXISTS password_resets;

      CREATE TABLE password_resets (
        id         INTEGER PRIMARY KEY,
        user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        code_hash  TEXT NOT NULL CHECK (length(code_hash) = 64),
        expires_at INTEGER NOT NULL,
        attempts   INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
        used       INTEGER NOT NULL DEFAULT 0 CHECK (used IN (0, 1)),
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX idx_password_resets_user ON password_resets(user_id);
    `);
  },
};
