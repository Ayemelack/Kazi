import type { Migration } from '../migrate.js';

// Push preferences and notification history (decision C1/C2): whether the
// account wants pushes at all, and every push the API actually delivered so
// the app can show a centre. The column defaults to on, so every existing
// account keeps receiving pushes; the app's More > Notifications screen is
// where it is turned off. user_notifications only grows from sends that were
// accepted by at least one device (notifications/service.ts), and is pruned
// to the newest NOTIFY_HISTORY_KEEP rows per user when a new one lands.
export const pushNotifications: Migration = {
  version: 8,
  name: 'push_notifications',
  up(db) {
    db.exec(`ALTER TABLE users ADD COLUMN push_notifications INTEGER NOT NULL DEFAULT 1`);
    db.exec(`
    CREATE TABLE IF NOT EXISTS user_notifications (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type       TEXT,
      item_id    INTEGER,
      title      TEXT NOT NULL,
      body       TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      read_at    TEXT
    );
`);
    db.exec(
      'CREATE INDEX IF NOT EXISTS idx_user_notifications_user ON user_notifications(user_id, id DESC)',
    );
  },
};
