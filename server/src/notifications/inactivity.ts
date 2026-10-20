import type Database from 'better-sqlite3';
import { isAppLanguage, inactivityPushData } from '@kazi/shared';
import { log } from '../log.js';
import { inactivityMessage } from './inactivityMessage.js';
import { pushNotificationsAllowed } from './preferences.js';
import {
  PUSH_TIMEOUT_MS,
  PushTimeoutError,
  deliverPush,
  pushMessagingFor,
  type PushSendResult,
} from './service.js';

// Decision D9: the inactivity push. An account that has not made an
// authenticated request for INACTIVITY_THRESHOLD_MS gets at most one
// re-engagement nudge per INACTIVITY_REPEAT_MS, best-effort, on its own
// devices. It is the second automated remote sender after the low-stock alert.
//
// Why a scheduler is safe here: DEPLOYMENT.md §2 and ARCHITECTURE §10 fix the
// production topology at ONE API process on one host (rate limits and admin
// sessions are in-memory), so an in-process interval cannot double-send across
// instances. The send is still guarded by a database-backed slot claim, so two
// overlapping ticks inside the one process — or a future second instance —
// cannot both win. Deployment docs must be revisited before a second API
// instance is added (ARCHITECTURE §10 does not permit it yet).
//
// The whole feature is OFF unless the account has opted in (migration 0009)
// AND kept the master push switch on. The account-level switch stays a hard
// gate: this sender never reaches an account whose pushes are off.

/** No nudge until the account has been unseen this long. */
export const INACTIVITY_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000;
/** At most one nudge per account per this window. */
export const INACTIVITY_REPEAT_MS = 7 * 24 * 60 * 60 * 1000;
/** How often the scheduler looks for eligible accounts. */
export const INACTIVITY_SCAN_INTERVAL_MS = 60 * 60 * 1000;
/** The most accounts one scan handles, so a huge backlog can't stall a tick. */
export const INACTIVITY_BATCH_SIZE = 500;

export interface InactivityOptions {
  thresholdMs: number;
  repeatMs: number;
  timeoutMs: number;
  batchSize: number;
}

export const DEFAULT_INACTIVITY_OPTIONS: InactivityOptions = {
  thresholdMs: INACTIVITY_THRESHOLD_MS,
  repeatMs: INACTIVITY_REPEAT_MS,
  timeoutMs: PUSH_TIMEOUT_MS,
  batchSize: INACTIVITY_BATCH_SIZE,
};

export type InactivityOutcome =
  | 'sent'
  | 'no-devices'
  | 'not-configured'
  | 'opted-out'
  | 'skipped';

interface CandidateRow {
  id: number;
  language: string;
}

/**
 * Every account that is eligible right now, oldest activity first. Eligibility
 * is entirely in SQL so a scan never reads tokens or sends for an account that
 * does not qualify:
 *  - last_seen_at exists (a never-seen account is NOT inactive),
 *  - it is older than the threshold,
 *  - the account opted in AND kept the master push switch on,
 *  - it has at least one registered device,
 *  - it has not been nudged within the repeat window.
 */
function findCandidates(
  db: Database.Database,
  now: number,
  options: InactivityOptions,
): CandidateRow[] {
  return db
    .prepare(
      `SELECT id, language
         FROM users
        WHERE last_seen_at IS NOT NULL
          AND last_seen_at <= ?
          AND push_notifications = 1
          AND inactivity_notifications = 1
          AND (inactivity_notified_at IS NULL OR inactivity_notified_at <= ?)
          AND EXISTS (SELECT 1 FROM push_tokens t WHERE t.user_id = users.id)
        ORDER BY last_seen_at ASC
        LIMIT ?`,
    )
    .all(
      now - options.thresholdMs,
      now - options.repeatMs,
      options.batchSize,
    ) as unknown as CandidateRow[];
}

/**
 * Sends at most one inactivity nudge to one account. The repeat slot is
 * claimed before the send (same rule as the low-stock alert): a crash or a
 * restart mid-send can never produce a second nudge. FCM refusing the send or
 * no device accepting it releases the claim so the next scan retries; a
 * timeout keeps it, because FCM may still deliver and a duplicate is worse
 * than a missed nudge.
 */
export async function sendInactivityNudge(
  db: Database.Database,
  userId: number,
  now = Date.now(),
  options: InactivityOptions = DEFAULT_INACTIVITY_OPTIONS,
): Promise<InactivityOutcome> {
  // The master switch first, exactly as the low-stock alert does: the owner's
  // choice beats every other condition. A missing opt-in is the same hard no.
  const row = db
    .prepare(
      'SELECT language, push_notifications, inactivity_notifications, last_seen_at FROM users WHERE id = ?',
    )
    .get(userId) as
    | {
        language: string;
        push_notifications: number;
        inactivity_notifications: number;
        last_seen_at: number | null;
      }
    | undefined;
  if (!row) {
    return 'skipped';
  }
  if (row.push_notifications === 0 || row.inactivity_notifications !== 1) {
    return 'opted-out';
  }
  // A never-seen or recently-seen account is not inactive. This also makes the
  // "user returned" case fall out naturally: their last_seen_at moved.
  if (row.last_seen_at === null || row.last_seen_at > now - options.thresholdMs) {
    return 'skipped';
  }

  const devices = db
    .prepare('SELECT COUNT(*) AS n FROM push_tokens WHERE user_id = ?')
    .get(userId) as { n: number };
  if (devices.n === 0) {
    return 'no-devices';
  }

  // Resolve the sender before claiming the slot, so a server without Firebase
  // credentials doesn't use it up.
  try {
    pushMessagingFor(db);
  } catch (error) {
    if (error instanceof Error && (error as { code?: string }).code === 'PUSH_NOT_CONFIGURED') {
      return 'not-configured';
    }
    throw error;
  }

  // Claim the repeat window and re-check everything in one statement: still
  // opted in, still on, still unseen, and no nudge inside the window.
  const claimed = db
    .prepare(
      `UPDATE users SET inactivity_notified_at = ?
        WHERE id = ?
          AND push_notifications = 1
          AND inactivity_notifications = 1
          AND last_seen_at IS NOT NULL
          AND last_seen_at <= ?
          AND (inactivity_notified_at IS NULL OR inactivity_notified_at <= ?)`,
    )
    .run(now, userId, now - options.thresholdMs, now - options.repeatMs);
  if (claimed.changes !== 1) {
    return 'skipped';
  }

  const language = isAppLanguage(row.language) ? row.language : 'en';
  let result: PushSendResult;
  try {
    result = await deliverPush(
      db,
      userId,
      {
        ...inactivityMessage(language),
        data: inactivityPushData(),
      },
      options.timeoutMs,
    );
  } catch (error) {
    if (!(error instanceof PushTimeoutError)) {
      releaseSlot(db, userId, now);
    }
    throw error;
  }
  if (result.sent === 0) {
    releaseSlot(db, userId, now);
    throw new NoDeviceAcceptedError();
  }
  return 'sent';
}

class NoDeviceAcceptedError extends Error {
  override name = 'NoDeviceAccepted';
  readonly code = 'no-device-accepted';
}

// Only the claim this job made: a later job's claim is left alone.
function releaseSlot(db: Database.Database, userId: number, claimedAt: number): void {
  db.prepare(
    'UPDATE users SET inactivity_notified_at = NULL WHERE id = ? AND inactivity_notified_at = ?',
  ).run(userId, claimedAt);
}

/**
 * One scan: find every eligible account and nudge each one. A per-account
 * failure is logged and does not stop the scan. Returns how many were sent.
 */
export async function runInactivityScan(
  db: Database.Database,
  now = Date.now(),
  options: InactivityOptions = DEFAULT_INACTIVITY_OPTIONS,
): Promise<number> {
  const candidates = findCandidates(db, now, options);
  let sent = 0;
  for (const candidate of candidates) {
    try {
      const outcome = await sendInactivityNudge(db, candidate.id, now, options);
      if (outcome === 'sent') {
        sent += 1;
      }
    } catch (error) {
      log.warn(
        `Inactivity nudge for user ${candidate.id} was not delivered: ${describe(error)}`,
      );
    }
  }
  return sent;
}

export interface InactivityScheduler {
  /** The unref'd interval handle; calling stop() clears it. */
  stop(): void;
  /** Runs one scan now (tests, and an immediate warm-up scan on boot). */
  runOnce(): Promise<number>;
}

/**
 * Starts the recurring scan. The timer is unref'd so it never by itself keeps
 * the process alive; the server's shutdown handler clears it and lets an
 * in-flight scan finish. Only one scheduler should be created per process
 * (index.ts does it once).
 */
export function startInactivityScheduler(
  db: Database.Database,
  intervalMs = INACTIVITY_SCAN_INTERVAL_MS,
  options: InactivityOptions = DEFAULT_INACTIVITY_OPTIONS,
): InactivityScheduler {
  let running = false;
  let stopped = false;
  let inFlight: Promise<number> = Promise.resolve(0);

  const tick = (): Promise<number> => {
    if (running || stopped) {
      return inFlight;
    }
    running = true;
    inFlight = runInactivityScan(db, Date.now(), options)
      .catch(error => {
        log.warn(`Inactivity scan failed: ${describe(error)}`);
        return 0;
      })
      .finally(() => {
        running = false;
      });
    return inFlight;
  };

  const timer = setInterval(() => {
    void tick();
  }, intervalMs);
  timer.unref();

  return {
    stop() {
      stopped = true;
      clearInterval(timer);
    },
    async runOnce() {
      // A caller-driven scan waits for any tick already running, then settles.
      await inFlight.catch(() => undefined);
      return tick();
    },
  };
}

// Error codes only (ours or FCM's): never a token, a message or user data.
function describe(error: unknown): string {
  if (error instanceof PushTimeoutError) {
    return 'timeout';
  }
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === 'string' && /^[a-z0-9/_-]{1,80}$/i.test(code)) {
    return code;
  }
  return error instanceof Error ? error.name : 'unknown error';
}
