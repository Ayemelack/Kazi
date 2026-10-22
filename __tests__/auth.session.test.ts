import { apiRequest } from '../src/api/client';
import { logOutAccount } from '../src/auth/api';
import { ApiError } from '../src/errors/ApiError';
import { emitSessionExpired, onSessionExpired } from '../src/auth/sessionEvents';
import {
  clearSession,
  getRefreshToken,
  getToken,
  saveSession,
} from '../src/storage/secure.storage';

// KZ-13: the access token lives 15 minutes, so the client renews it with the
// refresh token, once, without the screens noticing. A session that cannot be
// renewed ends: the tokens are forgotten and the provider is told.

function json(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

function noContent(): Response {
  return {
    ok: true,
    status: 204,
    json: async () => {
      throw new Error('204 has no body');
    },
  } as unknown as Response;
}

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function mockFetch(
  handler: (url: string, init: RequestInit) => Response | Promise<Response>,
): jest.Mock {
  const fetchMock = jest.fn(handler);
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

function authorizationOf(init: RequestInit): string | undefined {
  return (init.headers as Record<string, string> | undefined)?.Authorization;
}

test('an expired access token is renewed and the request is retried', async () => {
  await saveSession('old-access', 'aaaa.bbbb');

  let mainCalls = 0;
  const fetchMock = mockFetch(url => {
    if (url.endsWith('/auth/refresh')) {
      return json(200, { token: 'new-access', refreshToken: 'cccc.dddd' });
    }
    mainCalls += 1;
    return mainCalls === 1
      ? json(401, { error: { code: 'TOKEN_EXPIRED', message: 'expired' } })
      : json(200, { items: [] });
  });

  await expect(apiRequest('/items')).resolves.toEqual({ items: [] });

  expect(fetchMock).toHaveBeenCalledTimes(3);
  const [, refreshInit] = fetchMock.mock.calls[1] as [string, RequestInit];
  expect(JSON.parse(String(refreshInit.body))).toEqual({ refreshToken: 'aaaa.bbbb' });
  const [, retryInit] = fetchMock.mock.calls[2] as [string, RequestInit];
  expect(authorizationOf(retryInit)).toBe('Bearer new-access');

  // The rotated pair replaced the stored one.
  await expect(getToken()).resolves.toBe('new-access');
  await expect(getRefreshToken()).resolves.toBe('cccc.dddd');
});

test('two requests refused at once share a single renewal', async () => {
  await saveSession('old-access', 'aaaa.bbbb');

  let refreshes = 0;
  const seen = new Map<string, number>();
  const fetchMock = mockFetch(url => {
    if (url.endsWith('/auth/refresh')) {
      refreshes += 1;
      return json(200, { token: 'new-access', refreshToken: 'cccc.dddd' });
    }
    const count = (seen.get(url) ?? 0) + 1;
    seen.set(url, count);
    return count === 1
      ? json(401, { error: { code: 'INVALID_TOKEN', message: 'invalid' } })
      : json(200, { ok: true });
  });

  const [first, second] = await Promise.all([apiRequest('/items'), apiRequest('/debts')]);

  expect(first).toEqual({ ok: true });
  expect(second).toEqual({ ok: true });
  expect(refreshes).toBe(1);
  // Two originals + one renewal + two retries.
  expect(fetchMock).toHaveBeenCalledTimes(5);
});

test('a renewal that fails clears the session and reports it', async () => {
  await saveSession('old-access', 'aaaa.bbbb');
  const expired = jest.fn();
  const unsubscribe = onSessionExpired(expired);

  const fetchMock = mockFetch(url =>
    url.endsWith('/auth/refresh')
      ? json(401, { error: { code: 'INVALID_TOKEN', message: 'revoked' } })
      : json(401, { error: { code: 'INVALID_TOKEN', message: 'revoked' } }),
  );

  await expect(apiRequest('/items')).rejects.toBeInstanceOf(ApiError);
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(expired).toHaveBeenCalledTimes(1);
  await expect(getToken()).resolves.toBeNull();
  await expect(getRefreshToken()).resolves.toBeNull();

  unsubscribe();
});

test('a refused password is never retried and leaves the session alone', async () => {
  await saveSession('old-access', 'aaaa.bbbb');
  const fetchMock = mockFetch(() =>
    json(401, { error: { code: 'INVALID_CREDENTIALS', message: 'wrong' } }),
  );

  await expect(apiRequest('/auth/login', { method: 'POST', auth: false })).rejects.toMatchObject({
    status: 401,
    code: 'INVALID_CREDENTIALS',
  });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  await expect(getToken()).resolves.toBe('old-access');
});

test('a renewed request is retried at most once', async () => {
  await saveSession('old-access', 'aaaa.bbbb');
  const expired = jest.fn();
  const unsubscribe = onSessionExpired(expired);
  const fetchMock = mockFetch(url =>
    url.endsWith('/auth/refresh')
      ? json(200, { token: 'new-access', refreshToken: 'cccc.dddd' })
      : json(401, { error: { code: 'INVALID_TOKEN', message: 'revoked' } }),
  );

  await expect(apiRequest('/items')).rejects.toMatchObject({ status: 401 });
  // Original, renewal, retry: no second renewal. The retry was refused too, so
  // the session is over rather than left half-alive.
  expect(fetchMock).toHaveBeenCalledTimes(3);
  expect(expired).toHaveBeenCalledTimes(1);
  await expect(getToken()).resolves.toBeNull();
  await expect(getRefreshToken()).resolves.toBeNull();

  unsubscribe();
});

test('logging out sends the refresh token and needs no access token', async () => {
  const fetchMock = mockFetch(() => noContent());

  await logOutAccount('sample.secret');

  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  expect(url).toContain('/auth/logout');
  expect(JSON.parse(String(init.body))).toEqual({ refreshToken: 'sample.secret' });
  expect(authorizationOf(init)).toBeUndefined();
});

test('saving a session stores both tokens and clearing it forgets both', async () => {
  await expect(saveSession('access-1', 'id.secret')).resolves.toBe(true);
  await expect(getToken()).resolves.toBe('access-1');
  await expect(getRefreshToken()).resolves.toBe('id.secret');

  await clearSession();
  await expect(getToken()).resolves.toBeNull();
  await expect(getRefreshToken()).resolves.toBeNull();
});

test('the expiry signal reaches every listener and can be unsubscribed', () => {
  const first = jest.fn();
  const second = jest.fn();
  const stopFirst = onSessionExpired(first);
  const stopSecond = onSessionExpired(second);

  emitSessionExpired();
  expect(first).toHaveBeenCalledTimes(1);
  expect(second).toHaveBeenCalledTimes(1);

  stopFirst();
  stopSecond();
  emitSessionExpired();
  expect(first).toHaveBeenCalledTimes(1);
  expect(second).toHaveBeenCalledTimes(1);
});
