import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { availableParallelism } from 'node:os';
import { Worker } from 'node:worker_threads';

// Password hashing off the request thread (KZ-21).
//
// bcryptjs is pure JavaScript. Its async API only yields every 100 ms of work
// (MAX_EXECUTION_TIME in bcryptjs 2.4.3), and one cost-10 hash fits inside a
// single slice, so on the main thread every login would still freeze every
// other request for the whole hash. The same async calls therefore run on a
// small pool of worker threads, and the main thread only awaits the result.

export const BCRYPT_COST = 10;

const POOL_SIZE = Math.max(1, Math.min(4, availableParallelism() - 1));

// An eval'd CommonJS worker, so it starts the same way under tsx (tests) and
// from dist/ (production); bcryptjs is resolved from this package.
const BCRYPTJS_PATH = createRequire(import.meta.url).resolve('bcryptjs');
const WORKER_SOURCE = `
const { parentPort } = require('node:worker_threads');
const bcrypt = require(${JSON.stringify(BCRYPTJS_PATH)});
parentPort.on('message', job => {
  const work = job.op === 'hash'
    ? bcrypt.hash(job.password, job.cost)
    : bcrypt.compare(job.password, job.hash);
  work.then(
    result => parentPort.postMessage({ result }),
    err => parentPort.postMessage({ error: String(err && err.message ? err.message : err) }),
  );
});
`;

type Job =
  | { op: 'hash'; password: string; cost: number }
  | { op: 'compare'; password: string; hash: string };

interface Pending {
  job: Job;
  resolve: (value: string | boolean) => void;
  reject: (err: Error) => void;
}

const idle: Worker[] = [];
const busy = new Map<Worker, Pending>();
const queue: Pending[] = [];

function spawn(): Worker {
  const worker = new Worker(WORKER_SOURCE, { eval: true });
  worker.on('message', (message: { result?: string | boolean; error?: string }) => {
    const pending = busy.get(worker);
    busy.delete(worker);
    // An idle worker never keeps the process alive.
    worker.unref();
    idle.push(worker);
    if (pending) {
      if (message.error !== undefined) {
        pending.reject(new Error(message.error));
      } else {
        pending.resolve(message.result as string | boolean);
      }
    }
    pump();
  });
  const fail = (err: Error) => {
    const pending = busy.get(worker);
    busy.delete(worker);
    const at = idle.indexOf(worker);
    if (at !== -1) {
      idle.splice(at, 1);
    }
    pending?.reject(err);
    pump();
  };
  worker.on('error', fail);
  worker.on('exit', code => fail(new Error(`password worker stopped (exit ${code})`)));
  return worker;
}

// Starting a worker costs the main thread several milliseconds, so the whole
// pool starts with the server instead of during the first burst of logins.
export function startHashWorkers(): void {
  while (idle.length + busy.size < POOL_SIZE) {
    const worker = spawn();
    worker.unref();
    idle.push(worker);
  }
}

function pump(): void {
  while (queue.length > 0) {
    let worker = idle.pop();
    if (!worker) {
      if (busy.size >= POOL_SIZE) {
        return;
      }
      worker = spawn();
    }
    const next = queue.shift() as Pending;
    busy.set(worker, next);
    worker.ref();
    worker.postMessage(next.job);
  }
}

function run(job: Job): Promise<string | boolean> {
  return new Promise((resolve, reject) => {
    queue.push({ job, resolve, reject });
    pump();
  });
}

export async function hashPassword(password: string): Promise<string> {
  return (await run({ op: 'hash', password, cost: BCRYPT_COST })) as string;
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return (await run({ op: 'compare', password, hash })) === true;
}

// Compared against when the email is unknown, so a failed login costs the
// same bcrypt work whether or not the account exists (KZ-21). Made once, when
// the server starts, at the same cost; its input is random and thrown away, so
// no password can match it.
let dummyHash: Promise<string> | undefined;

export function prepareDummyHash(): Promise<string> {
  dummyHash ??= hashPassword(randomBytes(32).toString('base64url'));
  return dummyHash;
}
