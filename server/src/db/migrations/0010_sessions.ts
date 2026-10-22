import type { Migration } from '../migrate.js';

// KZ-13: server-side sessions. The access token (now 15 minutes) names its
// session; the session row is what makes the token revocable. The refresh
// token is `<session id>.<secret>` and only its HMAC is stored here, so a
// database leak does not hand out working sessions. Rows disappear with their
// account (ON DELETE CASCADE). Existing accounts simply sign in again: they
// had no session row, so their old 30-day tokens are refused.
export const sessions: Migration = {
  version: 10,
  name: 'sessions',
  up(db) {
    db.exec(`
      CREATE TABLE sessions (
        id           TEXT PRIMARY KEY CHECK (length(id) = 32),
        user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        refresh_hash TEXT NOT NULL CHECK (length(refresh_hash) = 64),
        created_at   INTEGER NOT NULL,
        last_used_at INTEGER NOT NULL,
        expires_at   INTEGER NOT NULL,
        revoked_at   INTEGER
      );

      CREATE INDEX idx_sessions_user ON sessions(user_id);
    `);
  },
};
