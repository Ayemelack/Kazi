import type Database from 'better-sqlite3';

// The account-level push preference (decision C1): one switch, per user,
// stored on the users row so every sender sees it without a join to a
// settings table. Default 1 (migration 0008), so an account that has never
// opened the screen keeps getting pushes. The app turns it off from
// More > Notifications; deliverPush and the low-stock alert both check it
// before anything reaches FCM.

export interface PushPreferences {
  pushNotifications: boolean;
}

/** The preference for an account; an unknown id reads as "on". */
export function getPushPreferences(db: Database.Database, userId: number): PushPreferences {
  const row = db
    .prepare('SELECT push_notifications FROM users WHERE id = ?')
    .get(userId) as { push_notifications: number } | undefined;
  return { pushNotifications: row?.push_notifications !== 0 };
}

/** Saves the preference and returns the saved state. */
export function setPushPreferences(
  db: Database.Database,
  userId: number,
  pushNotifications: boolean,
): PushPreferences {
  db.prepare('UPDATE users SET push_notifications = ? WHERE id = ?').run(
    pushNotifications ? 1 : 0,
    userId,
  );
  return getPushPreferences(db, userId);
}

/** Whether pushes may be sent to this account right now. */
export function pushNotificationsAllowed(db: Database.Database, userId: number): boolean {
  return getPushPreferences(db, userId).pushNotifications;
}
