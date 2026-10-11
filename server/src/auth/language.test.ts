// KZ-24: the app language is stored per account and accepts only en, fr and
// wes (Cameroonian Pidgin).
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { Server } from 'node:http';
import type Database from 'better-sqlite3';
import { openDatabase } from '../db/index.js';
import { createApp } from '../app.js';

let server: Server;
let baseUrl: string;
let db: Database.Database;

async function call(
  method: string,
  path: string,
  body?: unknown,
  token?: string,
): Promise<{ status: number; data: Record<string, any> }> {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, data: text ? JSON.parse(text) : {} };
}

// Each account gets its own password: the API still refuses a password that
// another account uses (removed by KZ-05).
let accounts = 0;

async function signUp(email: string): Promise<string> {
  accounts += 1;
  const result = await call('POST', '/auth/signup', {
    firstName: 'Awa',
    lastName: 'Fon',
    email,
    password: `secret12${accounts}`,
  });
  assert.equal(result.status, 201);
  return result.data.token as string;
}

before(async () => {
  process.env.JWT_SECRET = 'test-secret-not-for-production';
  db = openDatabase({ filename: ':memory:' });
  server = createApp(db).listen(0);
  await new Promise<void>(resolve => server.once('listening', () => resolve()));
  const address = server.address();
  baseUrl = `http://localhost:${typeof address === 'object' && address ? address.port : 4000}`;
});

after(() => {
  server.close();
});

test('a new account starts in English', async () => {
  const token = await signUp('lang.default@example.com');
  const me = await call('GET', '/auth/me', undefined, token);
  assert.equal(me.data.user.language, 'en');
});

test('PATCH /auth/me/language saves the choice and login returns it', async () => {
  const token = await signUp('lang.save@example.com');
  for (const language of ['fr', 'wes', 'en', 'wes']) {
    const result = await call('PATCH', '/auth/me/language', { language }, token);
    assert.equal(result.status, 200);
    assert.equal(result.data.user.language, language);
  }

  const login = await call('POST', '/auth/login', {
    email: 'lang.save@example.com',
    password: 'secret122',
  });
  assert.equal(login.data.user.language, 'wes');
});

test('only en, fr and wes are accepted', async () => {
  const token = await signUp('lang.invalid@example.com');
  for (const language of ['pid', 'de', 'EN', '', 1, null]) {
    const result = await call('PATCH', '/auth/me/language', { language }, token);
    assert.equal(result.status, 400, `language ${JSON.stringify(language)}`);
    assert.equal(result.data.error.code, 'VALIDATION_ERROR');
    assert.equal(result.data.error.field, 'language');
  }
  const missing = await call('PATCH', '/auth/me/language', {}, token);
  assert.equal(missing.data.error.rule, 'required');
  const unknown = await call('PATCH', '/auth/me/language', { language: 'pid' }, token);
  assert.equal(unknown.data.error.rule, 'notAllowed');

  const me = await call('GET', '/auth/me', undefined, token);
  assert.equal(me.data.user.language, 'en');
});

test('requires a session and changes only the caller', async () => {
  const unauthenticated = await call('PATCH', '/auth/me/language', { language: 'fr' });
  assert.equal(unauthenticated.status, 401);

  const first = await signUp('lang.first@example.com');
  const second = await signUp('lang.second@example.com');
  await call('PATCH', '/auth/me/language', { language: 'fr', userId: 999 }, first);

  const firstMe = await call('GET', '/auth/me', undefined, first);
  const secondMe = await call('GET', '/auth/me', undefined, second);
  assert.equal(firstMe.data.user.language, 'fr');
  assert.equal(secondMe.data.user.language, 'en');
});
