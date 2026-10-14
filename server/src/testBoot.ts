// Test helper: starts the real entry point (src/index.ts) in a child process,
// as `npm start` would, so boot-time checks are tested end to end.
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LISTENING = 'Kazi API listening';

// Variables a developer's shell (or server/.env, which dotenv reads only for
// variables that are not set) could otherwise leak into a boot test. Blank
// means unset to the server.
const ISOLATED: Record<string, string> = {
  NODE_ENV: '',
  ALLOW_DEV_RESET_CODE: '',
  EMAIL_PROVIDER: '',
  EMAIL_API_KEY: '',
  EMAIL_FROM: '',
  EMAIL_FROM_NAME: '',
  EMAIL_API_URL: '',
};

export const bootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kazi-boot-'));

export function removeBootDir(): void {
  fs.rmSync(bootDir, { recursive: true, force: true });
}

let databases = 0;

function spawnServer(env: Record<string, string>): ChildProcess {
  databases += 1;
  return spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
    cwd: SERVER_DIR,
    env: {
      ...process.env,
      ...ISOLATED,
      PORT: '0',
      DATABASE_PATH: path.join(bootDir, `boot-${databases}.db`),
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

export interface Boot {
  /** Exit code, or null when the server started listening (it is then stopped). */
  code: number | null;
  output: string;
}

/** Boots the server and reports whether it refused to start. */
export function boot(env: Record<string, string>): Promise<Boot> {
  return new Promise((resolve, reject) => {
    const child = spawnServer(env);
    let output = '';
    let listening = false;
    const onData = (chunk: Buffer) => {
      output += chunk.toString();
      if (!listening && output.includes(LISTENING)) {
        listening = true;
        child.kill();
      }
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    child.on('error', reject);
    child.on('exit', code => resolve({ code: listening ? null : code, output }));
  });
}

export interface RunningServer {
  baseUrl: string;
  output(): string;
  stop(): Promise<void>;
}

async function freePort(): Promise<number> {
  const probe = net.createServer();
  await new Promise<void>(resolve => probe.listen(0, '127.0.0.1', () => resolve()));
  const address = probe.address();
  await new Promise<void>(resolve => probe.close(() => resolve()));
  if (typeof address !== 'object' || address === null) {
    throw new Error('no free port');
  }
  return address.port;
}

/** Boots the server and leaves it running until `stop()`. */
export async function startServer(env: Record<string, string>): Promise<RunningServer> {
  const port = await freePort();
  const child = spawnServer({ ...env, PORT: String(port) });
  let output = '';
  const exited = new Promise<void>(resolve => child.on('exit', () => resolve()));
  await new Promise<void>((resolve, reject) => {
    const onData = (chunk: Buffer) => {
      output += chunk.toString();
      if (output.includes(LISTENING)) {
        resolve();
      }
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    child.on('error', reject);
    child.on('exit', code => reject(new Error(`server exited with ${code}: ${output}`)));
  });
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    output: () => output,
    async stop() {
      child.kill();
      await exited;
    },
  };
}
