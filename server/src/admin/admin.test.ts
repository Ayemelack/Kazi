import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { Server } from 'node:http';
import type Database from 'better-sqlite3';
import { openDatabase } from '../db.js';
import { createApp } from '../app.js';
import { buildApp, LoginThrottle, SessionStore } from './app.js';
import { loadCredentials } from './credentials.js';

let adminServer: Server;
let publicServer: Server;
let adminBaseUrl: string;
let publicBaseUrl: string;

before(async () => {
  process.env.ADMIN_PASSWORD = 'admin-test-password';

  const statsDb = openDatabase({ filename: ':memory:' });
  const writeDb = openDatabase({ filename: ':memory:' });

  const credentials = loadCredentials('/tmp/kazi-admin-test-credentials.json').credentials;
  const sessions = new SessionStore(60_000);
  const throttle = new LoginThrottle();
  const adminApp = buildApp(statsDb, writeDb, credentials, sessions, throttle, {
    sessionTtlMs: 60_000,
    cookieSecure: false,
  });

  adminServer = adminApp.listen(0);
  await new Promise<void>(resolve => adminServer.once('listening', () => resolve()));

  const publicApp = createApp(writeDb);
  publicServer = publicApp.listen(0);
  await new Promise<void>(resolve => publicServer.once('listening', () => resolve()));

  const adminAddress = adminServer.address();
  adminBaseUrl = `http://localhost:${typeof adminAddress === 'object' && adminAddress ? adminAddress.port : 4100}`;
  const publicAddress = publicServer.address();
  publicBaseUrl = `http://localhost:${typeof publicAddress === 'object' && publicAddress ? publicAddress.port : 4000}`;
});

after(() => {
  adminServer.close();
  publicServer.close();
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