import type Database from 'better-sqlite3';

// The account-level push preference (decision C1): one switch, per user,
// stored on the users row so every sender sees it without a join to a
// settings table. Default 1 (migration 0008), so an account that has never
// opened the screen keeps getting pushes. The app turns it off from
// More > Notifications; deliverPush and the low-stock alert both check it
// before anything reaches FCM.
//
// The inactivity push (decision D9) adds a second, opt-in switch,
// inactivity_notifications (migration 0009, default 0). It is subordinate to
// the master switch: pushNotificationsAllowed stays a hard gate for every
// remote push, and the inactivity scheduler sends only when BOTH are on. This
// is deliberately not the same as the master switch, so a user can keep
// low-stock alerts without also receiving re-engagement nudges.

export interface PushPreferences {
  pushNotifications: boolean;
  inactivityNotifications: boolean;
}

/** The preference for an account; an unknown id reads as "on" + "opt-out". */
export function getPushPreferences(db: Database.Database, userId: number): PushPreferences {
  const row = db
    .prepare('SELECT push_notifications, inactivity_notifications FROM users WHERE id = ?')
    .get(userId) as { push_notifications: number; inactivity_notifications: number } | undefined;
  return {
    pushNotifications: row?.push_notifications !== 0,
    inactivityNotifications: row?.inactivity_notifications === 1,
  };
}

/** Saves the preferences and returns the saved state. */
export function setPushPreferences(
  db: Database.Database,
  userId: number,
  pushNotifications: boolean,
  inactivityNotifications?: boolean,
): PushPreferences {
  if (inactivityNotifications === undefined) {
    db.prepare('UPDATE users SET push_notifications = ? WHERE id = ?').run(
      pushNotifications ? 1 : 0,
      userId,
    );
  } else {
    db.prepare(
      'UPDATE users SET push_notifications = ?, inactivity_notifications = ? WHERE id = ?',
    ).run(pushNotifications ? 1 : 0, inactivityNotifications ? 1 : 0, userId);
  }
  return getPushPreferences(db, userId);
}

/** Whether pushes may be sent to this account right now. */
export function pushNotificationsAllowed(db: Database.Database, userId: number): boolean {
  return getPushPreferences(db, userId).pushNotifications;
}

/**
 * Whether the account may receive an inactivity nudge: it must have kept the
 * master switch on AND opted in. Either one off is a hard no.
 */
export function inactivityNotificationsAllowed(db: Database.Database, userId: number): boolean {
  const preferences = getPushPreferences(db, userId);
  return preferences.pushNotifications && preferences.inactivityNotifications;
}

