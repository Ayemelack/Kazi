import { env } from '../config/env';
import { getToken } from '../storage/secure.storage';
import { ApiError, NetworkError } from '../errors/ApiError';
import { isOnline } from '../offline/connectivity';
import i18n from '../i18n';

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  auth?: boolean;
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError';
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, auth = true } = options;

  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };

  if (auth) {
    const token = await getToken();
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), env.API_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(`${env.API_BASE_URL}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    if (isAbortError(err)) {
      // The request timed out. The device is online (otherwise we would have
      // failed faster); the server took too long or is unresponsive.
      throw new ApiError(
        0,
        i18n.t('common.error.serverUnreachable'),
        'SERVER_UNREACHABLE',
      );
    }
    if (!isOnline()) {
      throw new NetworkError();
    }
    // The device has an internet connection, but the backend could not be
    // reached (wrong host, server down, firewall, etc.). This is NOT the same
    // as being offline, so report a server error instead of a connectivity one.
    throw new ApiError(
      0,
      i18n.t('common.error.serverUnreachable'),
      'SERVER_UNREACHABLE',
    );
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    let message = i18n.t('common.error.generic');
    let code: string | undefined;
    try {
      const data = (await response.json()) as {
        message?: string;
        code?: string;
        error?: { message?: string; code?: string };
      };
      const errorBody = data.error;
      if (typeof errorBody?.message === 'string' && errorBody.message.length > 0) {
        message = errorBody.message;
      } else if (typeof data.message === 'string' && data.message.length > 0) {
        message = data.message;
      }
      code = errorBody?.code ?? data.code;
    } catch {
      // Non-JSON error body; the generic message remains.
    }
    throw new ApiError(response.status, message, code);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}