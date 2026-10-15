import type { Server } from 'node:http';
import { log } from './log.js';

export interface ShutdownOptions {
  server: Server;
  /** Waits for queued background work (low-stock alerts, KZ-03). */
  settle: () => Promise<void>;
  /** Closes the database (checkpoints the WAL). */
  close: () => void;
  exit: (code: number) => void;
  /** After this long the process exits anyway. */
  graceMs?: number;
}

export const SHUTDOWN_GRACE_MS = 15_000;

/**
 * The SIGTERM/SIGINT handler (systemd sends SIGTERM). It stops taking
 * requests and lets the in-flight ones finish (they may queue low-stock
 * alerts), lets queued alerts finish (each gives FCM at most 5 s), then closes
 * the database and exits 0. A second signal, or the grace period running out,
 * exits 1 at once.
 */
export function gracefulShutdown(options: ShutdownOptions): (signal: NodeJS.Signals) => void {
  const { server, settle, close, exit, graceMs = SHUTDOWN_GRACE_MS } = options;
  let stopping = false;
  let done = false;
  const finish = (code: number) => {
    if (!done) {
      done = true;
      exit(code);
    }
  };

  return signal => {
    if (stopping) {
      log.warn(`${signal} again: exiting now.`);
      finish(1);
      return;
    }
    stopping = true;
    log.info(`${signal} received: finishing in-flight work.`);
    const force = setTimeout(() => {
      log.warn('Shutdown took too long: exiting.');
      finish(1);
    }, graceMs);
    force.unref();

    server.close(() => {
      void settle()
        .catch(() => undefined)
        .finally(() => {
          clearTimeout(force);
          if (done) {
            return;
          }
          close();
          log.info('Kazi API stopped.');
          finish(0);
        });
    });
    server.closeIdleConnections();
  };
}
