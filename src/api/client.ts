import { env } from '../config/env';
import { getToken } from '../storage/secure.storage';
import { ApiError, NetworkError } from '../errors/ApiError';
import { isOnline } from '../offline/connectivity';
import { isValidationRule } from '@kazi/shared';

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
      throw new ApiError(0, 'The server did not answer in time.', 'SERVER_UNREACHABLE');
    }
    if (!isOnline()) {
      throw new NetworkError();
    }
    // The device has an internet connection, but the backend could not be
    // reached (wrong host, server down, firewall, etc.). This is NOT the same
    // as being offline, so report a server error instead of a connectivity one.
    throw new ApiError(0, 'The server could not be reached.', 'SERVER_UNREACHABLE');
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    // The body's message is kept for logs only; users see text chosen by
    // `code` in src/errors/messages.ts (KZ-12).
    let message = `HTTP ${response.status}`;
    let code: string | undefined;
    let field: string | undefined;
    let rule: unknown;
    try {
      const data = (await response.json()) as {
        error?: { message?: unknown; code?: unknown; field?: unknown; rule?: unknown };
      };
      const errorBody = data.error;
      if (typeof errorBody?.message === 'string' && errorBody.message.length > 0) {
        message = errorBody.message;
      }
      code = typeof errorBody?.code === 'string' ? errorBody.code : undefined;
      field = typeof errorBody?.field === 'string' ? errorBody.field : undefined;
      rule = errorBody?.rule;
    } catch {
      // Non-JSON error body (a proxy page, for example): no code, so the
      // generic message is shown.
    }
    throw new ApiError(response.status, message, code, {
      field,
      rule: isValidationRule(rule) ? rule : undefined,
    });
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}