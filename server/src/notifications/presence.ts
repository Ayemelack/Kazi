import type Database from 'better-sqlite3';

// The one place that records that an authenticated account was seen
// (migration 0009, users.last_seen_at). This is the signal the inactivity
// scheduler uses to tell "has not opened Kazi" from "opened it but did not
// record a sale" — the business activity table only knows the latter.
//
// It is deliberately cheap and privacy-conscious: a single timestamp on the
// user's own row, overwritten at most once an hour, never a per-request row or
// a browsing history. It is called from requireAuth, so it only ever touches
// the authenticated caller's own row.

/** At most one last_seen_at write per account per hour. */
export const LAST_SEEN_THROTTLE_MS = 60 * 60 * 1000;

/**
 * Records that the account made an authenticated request, at most once per
 * hour. Best-effort: a failure here must never fail the request it rode in on,
 * so the caller (requireAuth) also guards it. The UPDATE is a single statement
 * and matches at most the one user row.
 */
export function recordUserSeen(db: Database.Database, userId: number, now = Date.now()): void {
  db.prepare(
    `UPDATE users SET last_seen_at = ?
      WHERE id = ?
        AND (last_seen_at IS NULL OR last_seen_at <= ?)`,
  ).run(now, userId, now - LAST_SEEN_THROTTLE_MS);
}
