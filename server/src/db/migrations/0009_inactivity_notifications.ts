import type { Migration } from '../migrate.js';

// KZ-04 (decision D9): the inactivity push. Two plain added columns on users,
// no rebuild:
//
//   last_seen_at              when the account last made an authenticated
//                             request, in epoch milliseconds, or NULL if never.
//                             Written by requireAuth at most once per hour
//                             (notifications/presence.ts). NULL is never treated as
//                             "inactive": a user who has not opened the app
//                             since this ship gets no inactivity push until a
//                             real last_seen_at exists.
//   inactivity_notifications  0 or 1: whether the account opted in from
//                             More > Notifications. Defaults to 0 (off), so no
//                             existing account is silently enrolled; a nudge
//                             needs both this and the account-level push
//                             switch (users.push_notifications).
//   inactivity_notified_at    when the last inactivity nudge for this account
//                             was claimed, epoch milliseconds, or NULL. The
//                             scheduler claims this slot before sending, so a
//                             crash or restart mid-send cannot double up
//                             (notifications/inactivity.ts).
export const inactivityNotifications: Migration = {
  version: 9,
  name: 'inactivity_notifications',
  up(db) {
    db.exec('ALTER TABLE users ADD COLUMN last_seen_at INTEGER');
    db.exec(
      'ALTER TABLE users ADD COLUMN inactivity_notifications INTEGER NOT NULL DEFAULT 0',
    );
    db.exec('ALTER TABLE users ADD COLUMN inactivity_notified_at INTEGER');
  },
};
