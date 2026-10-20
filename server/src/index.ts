import 'dotenv/config';
import { createApp } from './app.js';
import { openDatabase, resolveDatabasePath } from './db/index.js';
import { resetDeliveryFromEnv } from './auth/delivery.js';
import { log } from './log.js';
import { checkJwtSecret } from './secrets.js';
import { parseTrustProxy } from './trustProxy.js';
import { testSendFromEnv } from './notifications/routes.js';
import { settleLowStockAlerts } from './notifications/lowStock.js';
import { startInactivityScheduler } from './notifications/inactivity.js';
import { gracefulShutdown } from './shutdown.js';

// Fail fast instead of serving 500s on the first authenticated request, and
// never run production with a guessable signing secret (KZ-29).
const secretCheck = checkJwtSecret(process.env.JWT_SECRET, process.env.NODE_ENV);
if (!secretCheck.ok) {
  log.error(secretCheck.error);
  process.exit(1);
}
if (secretCheck.warning) {
  log.warn(secretCheck.warning);
}

// Password reset codes must reach the account holder and nobody else
// (KZ-06): production needs a real email sender, and the development shortcut
// that returns codes in responses is refused outside development and test.
const resetDelivery = resetDeliveryFromEnv(process.env);
if (!resetDelivery.ok) {
  log.error(resetDelivery.error);
  process.exit(1);
}
log.info(`Password reset codes go to ${resetDelivery.delivery.sender.description}.`);
if (resetDelivery.delivery.devCodeInResponse) {
  log.warn('ALLOW_DEV_RESET_CODE=1: forgot-password also returns the code in its response (development only).');
}

// Per-IP rate limits behind a reverse proxy need the client address from
// X-Forwarded-For, trusted for exactly the configured number of hops (KZ-08).
const trustProxy = parseTrustProxy(process.env.TRUST_PROXY);
if (!trustProxy.ok) {
  log.error(trustProxy.error);
  process.exit(1);
}
log.info(
  trustProxy.value === false
    ? 'Client addresses: from the connection (TRUST_PROXY unset; X-Forwarded-For ignored).'
    : `Client addresses: from X-Forwarded-For, trusting ${trustProxy.value} proxy hop(s).`,
);

// Push (KZ-03): low-stock alerts need a Firebase service account; without
// one they are skipped. The manual send route is for testing only.
log.info(
  process.env.FIREBASE_SERVICE_ACCOUNT || process.env.GOOGLE_APPLICATION_CREDENTIALS
    ? 'Push notifications: Firebase credentials set.'
    : 'Push notifications: disabled (no Firebase credentials).',
);
const testSend = testSendFromEnv(process.env);
if (testSend) {
  log.warn('NOTIFICATIONS_TEST_SEND=1: POST /notifications/send is enabled (testing only).');
}

const port = Number(process.env.PORT ?? 4000);

log.info(`Kazi API database: ${resolveDatabasePath()}`);

const db = openDatabase();
const app = createApp(db, {
  resetDelivery: resetDelivery.delivery,
  trustProxy: trustProxy.value,
  testSend,
});

// Push (KZ-04, decision D9): the inactivity scheduler. It only ever sends to
// accounts that opted in and kept pushes on, and only when Firebase is
// configured; without credentials every send is skipped, so the scheduler is
// not started at all. One scheduler per process — the production topology is a
// single API process (DEPLOYMENT.md §2, ARCHITECTURE §10).
const firebaseConfigured = Boolean(
  process.env.FIREBASE_SERVICE_ACCOUNT || process.env.GOOGLE_APPLICATION_CREDENTIALS,
);
const inactivity = firebaseConfigured ? startInactivityScheduler(db) : null;
if (firebaseConfigured) {
  log.info('Inactivity notifications: scheduler started (opt-in accounts only).');
}

const server = app.listen(port, () => {
  log.info(`Kazi API listening on http://localhost:${port}`);
});

server.on('error', (err: NodeJS.ErrnoException) => {
  log.error(`Kazi API could not start on port ${port}: ${err.message}`);
  process.exit(1);
});

// Graceful stop: finish requests and queued push alerts, then close the
// database (shutdown.ts).
const shutdown = gracefulShutdown({
  server,
  settle: async () => {
    // Stop the recurring scan first, then let any in-flight scan and every
    // queued low-stock alert finish.
    inactivity?.stop();
    await settleLowStockAlerts();
  },
  close: () => db.close(),
  exit: code => process.exit(code),
});
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
