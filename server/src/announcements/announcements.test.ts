import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { Server } from 'node:http';
import type Database from 'better-sqlite3';
import { openDatabase } from '../db.js';
import { createApp } from '../app.js';
import { clearAnnouncement, upsertAnnouncement } from './service.js';
import { announcementWriteSchema, validate } from './validation.js';

let server: Server;
let baseUrl: string;
let db: Database.Database;

before(async () => {
  db = openDatabase({ filename: ':memory:' });
  const app = createApp(db);
  server = app.listen(0);
  await new Promise<void>(resolve => server.once('listening', () => resolve()));

  const address = server.address();
  baseUrl = `http://localhost:${typeof address === 'object' && address ? address.port : 4000}`;
});

after(() => {
  server.close();
});

async function get(path: string): Promise<{ status: number; data: Record<string, unknown> }> {
  const response = await fetch(`${baseUrl}${path}`);
  const text = await response.text();
  return { status: response.status, data: text ? (JSON.parse(text) as Record<string, unknown>) : {} };
}

test('announcements endpoint is public and empty until one is posted', async () => {
  const result = await get('/announcements');
  assert.equal(result.status, 200);
  assert.equal(result.data.announcement, null);
});

test('the active announcement is served to unauthenticated clients', async () => {
  upsertAnnouncement(db, {
    body_en: 'Maintenance Sunday at 02:00',
    body_fr: 'Maintenance dimanche à 02:00',
    min_version: '1.0',
    max_version: '1.1',
  });

  const result = await get('/announcements');
  assert.equal(result.status, 200);
  const announcement = result.data.announcement as {
    id: number;
    bodyEn: string;
    bodyFr: string | undefined;
    bodyPid: string | undefined;
    minVersion: string;
    maxVersion: string;
  };
  assert.equal(announcement.id, 1);
  assert.equal(announcement.bodyEn, 'Maintenance Sunday at 02:00');
  assert.equal(announcement.bodyFr, 'Maintenance dimanche à 02:00');
  assert.equal(announcement.bodyPid, undefined);
  assert.equal(announcement.minVersion, '1.0');
  assert.equal(announcement.maxVersion, '1.1');
});

test('upserting a new announcement keeps the stable id', async () => {
  upsertAnnouncement(db, {
    body_en: 'Updated text',
    min_version: '',
    max_version: '',
  });

  const result = await get('/announcements');
  const announcement = result.data.announcement as { id: number; bodyEn: string; bodyFr?: string };
  assert.equal(announcement.id, 1);
  assert.equal(announcement.bodyEn, 'Updated text');
  assert.equal(announcement.bodyFr, undefined);
});

test('clearing an announcement soft-disables it', async () => {
  clearAnnouncement(db);

  const result = await get('/announcements');
  assert.equal(result.status, 200);
  assert.equal(result.data.announcement, null);
});

test('write validation trims bodies and defaults missing versions', () => {
  const parsed = validate(announcementWriteSchema, {
    body_en: '  Hello Kazi  ',
    body_fr: '',
  });
  assert.deepEqual(parsed, {
    body_en: 'Hello Kazi',
    body_fr: undefined,
    min_version: '',
    max_version: '',
  });
});

test('write validation rejects an empty required body', () => {
  assert.throws(() => validate(announcementWriteSchema, { body_en: '   ' }));
});

test('write validation rejects an oversized body', () => {
  assert.throws(() =>
    validate(announcementWriteSchema, { body_en: 'x'.repeat(2001) }),
  );
});