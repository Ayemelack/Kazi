import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { openDatabase } from '../db/index.js';
import { parseCookies } from './cookies.js';

// KZ-27: a cookie that is not valid percent-encoding is ignored, so the
// dashboard answers 401 instead of failing with a 500.

const SERVER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const MALFORMED = '%E0%A4%A';
const PASSWORD = 'dashboard-test-pass-2026';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kazi-admin-'));
after(() => fs.rmSync(tempDir, { recursive: true, force: true }));

describe('parseCookies', () => {
  test('decodes well-formed cookies', () => {
    assert.deepEqual(parseCookies('a=1; kazi_admin_session=abc%2Fdef; empty='), {
      a: '1',
      kazi_admin_session: 'abc/def',
      empty: '',
    });
    assert.deepEqual(parseCookies(undefined), {});
    assert.deepEqual(parseCookies('novalue; =x'), {});
  });

  test('skips a cookie that fails decodeURIComponent and keeps the others', () => {
    assert.throws(() => decodeURIComponent(MALFORMED), URIError);
    assert.deepEqual(parseCookies(`kazi_admin_session=${MALFORMED}`), {});
    assert.deepEqual(parseCookies(`theme=%ZZ; kazi_admin_session=tok%3D; other=${MALFORMED}`), {
      kazi_admin_session: 'tok=',
    });
  });
});

async function freePort(): Promise<number> {
  const probe = net.createServer();
  await new Promise<void>(resolve => probe.listen(0, '127.0.0.1', () => resolve()));
  const address = probe.address();
  await new Promise<void>(resolve => probe.close(() => resolve()));
  assert.ok(typeof address === 'object' && address !== null);
  return address.port;
}

describe('admin dashboard (KZ-27)', { timeout: 120_000 }, () => {
  test('a malformed session cookie gets 401, not 500; a valid session still works beside one', async () => {
    const databasePath = path.join(tempDir, 'kazi.db');
    openDatabase({ filename: databasePath }).close();
    const port = await freePort();
    const child = spawn(process.execPath, ['--import', 'tsx', 'src/admin/index.ts'], {
      cwd: SERVER_DIR,
      env: {
        ...process.env,
        ADMIN_HOST: '127.0.0.1',
        ADMIN_PORT: String(port),
        ADMIN_TLS: 'off',
        ADMIN_USERNAME: 'admin',
        ADMIN_PASSWORD: PASSWORD,
        ADMIN_CREDENTIALS_PATH: path.join(tempDir, 'admin-auth.json'),
        DATABASE_PATH: databasePath,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const exited = new Promise<void>(resolve => child.on('exit', () => resolve()));
    let output = '';
    try {
      await new Promise<void>((resolve, reject) => {
        const onData = (chunk: Buffer) => {
          output += chunk.toString();
          if (output.includes('Kazi Admin dashboard')) {
            resolve();
          }
        };
        child.stdout.on('data', onData);
        child.stderr.on('data', onData);
        child.on('exit', code => reject(new Error(`admin exited with ${code}: ${output}`)));
      });
      const base = `http://127.0.0.1:${port}`;
      const get = (route: string, cookie: string) =>
        fetch(`${base}${route}`, { headers: { Cookie: cookie }, signal: AbortSignal.timeout(20_000) });

      for (const route of ['/api/stats', '/api/users', '/api/session']) {
        const response = await get(route, `kazi_admin_session=${MALFORMED}`);
        assert.equal(response.status, 401, route);
      }

      const login = await fetch(`${base}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Request': '1' },
        body: JSON.stringify({ username: 'admin', password: PASSWORD }),
        signal: AbortSignal.timeout(20_000),
      });
      assert.equal(login.status, 200);
      const session = (login.headers.get('set-cookie') ?? '').split(';')[0]!;
      assert.match(session, /^kazi_admin_session=/);

      const stats = await get('/api/stats', `theme=${MALFORMED}; ${session}`);
      assert.equal(stats.status, 200);
      assert.ok(!output.includes('request failed'), output);
    } finally {
      child.kill();
      await exited;
    }
  });
});
