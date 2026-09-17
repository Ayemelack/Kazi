import type Database from 'better-sqlite3';
import { AppError } from '../errors.js';
import { firebaseMessaging } from './firebase.js';
import type { RegisterPushTokenInput, SendNotificationInput } from './validation.js';

export const KAZI_PUSH_CHANNEL = 'kazi';

// Firebase error codes that mean a token is dead and should be dropped.
const UNREGISTERED_ERROR_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
]);

interface PushTokenRow {
  id: number;
  user_id: number;
  token: string;
  platform: string;
  created_at: string;
  updated_at: string;
}

export interface PublicPushToken {
  token: string;
  platform: string;
  updatedAt: string;
}

export interface PushSendResult {
  sent: number;
  failed: number;
  removedUnregisteredTokens: number;
}

/**
 * Associates a device push token with the authenticated user. The token is
 * unique: if the same device signed in to a different account, the token is
 * moved to the current user so a logout/login never leaks notifications.
 */
export function registerPushToken(
  db: Database.Database,
  userId: number,
  input: RegisterPushTokenInput,
): PublicPushToken {
  const { token, platform } = input;

  const existing = db
    .prepare('SELECT id, user_id FROM push_tokens WHERE token = ?')
    .get(token) as { id: number; user_id: number } | undefined;

  if (existing) {
    if (existing.user_id === userId) {
      db.prepare(
        "UPDATE push_tokens SET platform = ?, updated_at = datetime('now') WHERE id = ?",
      ).run(platform, existing.id);
    } else {
      db.prepare('DELETE FROM push_tokens WHERE id = ?').run(existing.id);
      db.prepare('INSERT INTO push_tokens (user_id, token, platform) VALUES (?, ?, ?)').run(
        userId,
        token,
        platform,
      );
    }
  } else {
    db.prepare('INSERT INTO push_tokens (user_id, token, platform) VALUES (?, ?, ?)').run(
      userId,
      token,
      platform,
    );
  }

  const row = db
    .prepare('SELECT * FROM push_tokens WHERE user_id = ? AND token = ?')
    .get(userId, token) as unknown as PushTokenRow;

  return {
    token: row.token,
    platform: row.platform,
    updatedAt: row.updated_at,
  };
}

/** Removes a device token when the user signs out. */
export function unregisterPushToken(
  db: Database.Database,
  userId: number,
  token: string,
): void {
  db.prepare('DELETE FROM push_tokens WHERE user_id = ? AND token = ?').run(userId, token);
}

/** Returns every device token registered for a user. */
export function listPushTokens(db: Database.Database, userId: number): string[] {
  const rows = db
    .prepare('SELECT token FROM push_tokens WHERE user_id = ?')
    .all(userId) as unknown as { token: string }[];
  return rows.map(row => row.token);
}

/**
 * Sends a push notification to every device registered to the user via FCM.
 *
 * Messages are data-only so the app renders them in every app state
 * (foreground, background, terminated, locked screen) through the configured
 * channel. Tokens that FCM reports as unregistered are removed so the device
 * never silently receives pushes to a dead token.
 */
export async function sendNotificationToUser(
  db: Database.Database,
  userId: number,
  input: SendNotificationInput,
): Promise<PushSendResult> {
  const rows = db
    .prepare('SELECT id, token FROM push_tokens WHERE user_id = ?')
    .all(userId) as unknown as { id: number; token: string }[];

  if (rows.length === 0) {
    return { sent: 0, failed: 0, removedUnregisteredTokens: 0 };
  }

  const messaging = firebaseMessaging();

  let response;
  try {
    response = await messaging.sendEachForMulticast({
      tokens: rows.map(row => row.token),
      data: {
        title: input.title,
        body: input.body,
        channel: KAZI_PUSH_CHANNEL,
      },
      android: { priority: 'high' },
    });
  } catch (err) {
    throw new AppError(502, 'INTERNAL', 'Push notification delivery failed.');
  }

  let removed = 0;
  response.responses.forEach((result, index) => {
    if (!result.success && isUnregisteredError(result.error?.code)) {
      const row = rows[index];
      if (row) {
        db.prepare('DELETE FROM push_tokens WHERE id = ?').run(row.id);
        removed += 1;
      }
    }
  });

  return {
    sent: response.successCount,
    failed: response.failureCount,
    removedUnregisteredTokens: removed,
  };
}

function isUnregisteredError(code?: string): boolean {
  return UNREGISTERED_ERROR_CODES.has(code ?? '');
}