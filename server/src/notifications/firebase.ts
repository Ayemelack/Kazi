import fs from 'node:fs';
import { cert, getApps, initializeApp, type App, type ServiceAccount } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import { AppError } from '../errors.js';

/**
 * Resolves Firebase service-account credentials from the environment.
 * Credentials are only ever read on the server, never shipped to the app.
 *
 * Accepted sources, in order:
 *   FIREBASE_SERVICE_ACCOUNT  base64-encoded service-account JSON
 *   GOOGLE_APPLICATION_CREDENTIALS  path to a service-account JSON file
 */
function loadServiceAccount(): ServiceAccount | null {
  const base64 = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (base64) {
    try {
      return JSON.parse(Buffer.from(base64, 'base64').toString('utf8')) as ServiceAccount;
    } catch {
      throw new AppError(
        500,
        'INTERNAL',
        'FIREBASE_SERVICE_ACCOUNT is invalid. It must be a base64-encoded service-account JSON.',
      );
    }
  }

  const path = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (path) {
    return JSON.parse(fs.readFileSync(path, 'utf8')) as ServiceAccount;
  }

  return null;
}

let app: App | null = null;

export function firebaseApp(): App {
  if (app) {
    return app;
  }
  const account = loadServiceAccount();
  if (!account) {
    throw new AppError(
      503,
      'PUSH_NOT_CONFIGURED',
      'Push notifications are not configured on this server.',
    );
  }
  const current = getApps()[0];
  if (current) {
    app = current;
    return current;
  }
  app = initializeApp({ credential: cert(account) });
  return app;
}

export function firebaseMessaging(): ReturnType<typeof getMessaging> {
  return getMessaging(firebaseApp());
}