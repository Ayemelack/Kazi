import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import type { Server } from 'node:http';
import { openDatabase } from '../db/index.js';
import { createApp } from '../app.js';
import { buildApp, LoginThrottle, SessionStore } from './app.js';
import { loadCredentials } from './credentials.js';

// Announcement authoring (merged from main, 2026-10-15). Editing is off unless
// the dashboard is started with ADMIN_ANNOUNCEMENTS=1 (decision D8): the
// read-only admin gets no writable handle and answers 403.

let adminServer: Server;
let readOnlyServer: Server;
let publicServer: Server;
let adminBaseUrl: string;
let readOnlyBaseUrl: string;
let publicBaseUrl: string;
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kazi-admin-announcements-'));

before(async () => {
  process.env.ADMIN_PASSWORD = 'admin-test-password';

  const statsDb = openDatabase({ filename: ':memory:' });
  const writeDb = openDatabase({ filename: ':memory:' });

  const credentials = loadCredentials(path.join(tempDir, 'credentials.json')).credentials;
  const sessions = new SessionStore(60_000);
  const throttle = new LoginThrottle();
  const adminApp = buildApp(statsDb, writeDb, credentials, sessions, throttle, {
    sessionTtlMs: 60_000,
    cookieSecure: false,
  });

  adminServer = adminApp.listen(0);
  await new Promise<void>(resolve => adminServer.once('listening', () => resolve()));

  const readOnlyApp = buildApp(statsDb, null, credentials, new SessionStore(60_000), new LoginThrottle(), {
    sessionTtlMs: 60_000,
    cookieSecure: false,
  });
  readOnlyServer = readOnlyApp.listen(0);
  await new Promise<void>(resolve => readOnlyServer.once('listening', () => resolve()));
  const readOnlyAddress = readOnlyServer.address();
  readOnlyBaseUrl = `http://localhost:${typeof readOnlyAddress === 'object' && readOnlyAddress ? readOnlyAddress.port : 4101}`;

  const publicApp = createApp(writeDb);
  publicServer = publicApp.listen(0);
  await new Promise<void>(resolve => publicServer.once('listening', () => resolve()));

  const adminAddress = adminServer.address();
  adminBaseUrl = `http://localhost:${typeof adminAddress === 'object' && adminAddress ? adminAddress.port : 4100}`;
  const publicAddress = publicServer.address();
  publicBaseUrl = `http://localhost:${typeof publicAddress === 'object' && publicAddress ? publicAddress.port : 4000}`;
});

after(() => {
  for (const server of [adminServer, readOnlyServer, publicServer]) {
    server.closeAllConnections();
    server.close();
  }
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('admin announcements require an authenticated admin', async () => {
  const response = await fetch(`${adminBaseUrl}/api/announcements`);
  assert.equal(response.status, 401);
});

test('admin can post, read and delete the announcement; the public API serves it', async () => {
  const login = await fetch(`${adminBaseUrl}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-admin-request': '1' },
    body: JSON.stringify({ username: 'admin', password: 'admin-test-password' }),
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie, 'login should set a session cookie');

  const authedHeaders = { cookie, 'x-admin-request': '1', 'Content-Type': 'application/json' };

  const post = await fetch(`${adminBaseUrl}/api/announcements`, {
    method: 'POST',
    headers: authedHeaders,
    body: JSON.stringify({
      body_en: 'Stock check tomorrow morning',
      body_fr: 'Inventaire demain matin',
      min_version: '1.0',
      max_version: '',
    }),
  });
  assert.equal(post.status, 200);
  const created = (await post.json()) as {
    announcement: { id: number; bodyEn: string; bodyFr: string };
  };
  assert.equal(created.announcement.id, 1);
  assert.equal(created.announcement.bodyEn, 'Stock check tomorrow morning');

  const adminRead = await fetch(`${adminBaseUrl}/api/announcements`, {
    headers: { cookie },
  });
  assert.equal(adminRead.status, 200);
  const read = (await adminRead.json()) as { announcement: { bodyEn: string } };
  assert.equal(read.announcement.bodyEn, 'Stock check tomorrow morning');

  const publicRead = await fetch(`${publicBaseUrl}/announcements`);
  assert.equal(publicRead.status, 200);
  const publicAnnouncement = (await publicRead.json()) as {
    announcement: { bodyFr: string; minVersion: string };
  };
  assert.equal(publicAnnouncement.announcement.bodyFr, 'Inventaire demain matin');
  assert.equal(publicAnnouncement.announcement.minVersion, '1.0');

  const deleted = await fetch(`${adminBaseUrl}/api/announcements`, {
    method: 'DELETE',
    headers: authedHeaders,
  });
  assert.equal(deleted.status, 200);

  const afterDelete = await fetch(`${publicBaseUrl}/announcements`);
  assert.equal(((await afterDelete.json()) as { announcement: unknown }).announcement, null);
});

test('admin write rejects requests missing the same-origin header', async () => {
  const login = await fetch(`${adminBaseUrl}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-admin-request': '1' },
    body: JSON.stringify({ username: 'admin', password: 'admin-test-password' }),
  });
  const cookie = login.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie);

  const response = await fetch(`${adminBaseUrl}/api/announcements`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({ body_en: 'No header' }),
  });
  assert.equal(response.status, 400);
});

test('admin write rejects a missing required body with a 400', async () => {
  const login = await fetch(`${adminBaseUrl}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-admin-request': '1' },
    body: JSON.stringify({ username: 'admin', password: 'admin-test-password' }),
  });
  const cookie = login.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie);

  const response = await fetch(`${adminBaseUrl}/api/announcements`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie, 'x-admin-request': '1' },
    body: JSON.stringify({ body_en: '' }),
  });
  assert.equal(response.status, 400);
});
test('without ADMIN_ANNOUNCEMENTS the dashboard reads the announcement but cannot write it', async () => {
  const login = await fetch(`${readOnlyBaseUrl}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-admin-request': '1' },
    body: JSON.stringify({ username: 'admin', password: 'admin-test-password' }),
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie);
  const headers = { cookie, 'x-admin-request': '1', 'Content-Type': 'application/json' };

  const read = await fetch(`${readOnlyBaseUrl}/api/announcements`, { headers: { cookie } });
  assert.equal(read.status, 200);
  assert.deepEqual(await read.json(), { announcement: null, editable: false });

  const post = await fetch(`${readOnlyBaseUrl}/api/announcements`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ body_en: 'Should not be stored', min_version: '', max_version: '' }),
  });
  assert.equal(post.status, 403);
  const del = await fetch(`${readOnlyBaseUrl}/api/announcements`, { method: 'DELETE', headers });
  assert.equal(del.status, 403);
});
