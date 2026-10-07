import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { log } from './log.js';

export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'EMAIL_IN_USE'
  | 'INVALID_CREDENTIALS'
  | 'NOT_FOUND'
  | 'INVALID_TOKEN'
  | 'TOKEN_EXPIRED'
  | 'UNAUTHORIZED'
  | 'INSUFFICIENT_STOCK'
  | 'ALREADY_PAID'
  | 'PASSWORD_NOT_ALLOWED'
  | 'TOO_MANY_REQUESTS'
  | 'PUSH_NOT_CONFIGURED'
  | 'IDEMPOTENCY_CONFLICT'
  | 'INTERNAL';

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;

  constructor(status: number, code: ErrorCode, message: string) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
  }
}

// body-parser (express.json) rejects unreadable or oversized bodies before any
// route runs. Its errors carry the raw request body on `err.body`; treating
// them as validation failures keeps the raw payload out of the error log.
function bodyParseFailureStatus(err: unknown): number | null {
  if (typeof err !== 'object' || err === null || !('type' in err)) {
    return null;
  }
  const type = (err as { type?: unknown }).type;
  if (type === 'entity.parse.failed') {
    return 400;
  }
  if (type === 'entity.too.large') {
    return 413;
  }
  return null;
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof AppError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message } });
    return;
  }

  if (err instanceof ZodError) {
    const issue = err.issues[0];
    const message = issue
      ? `${issue.path.join('.') || 'body'}: ${issue.message}`
      : 'Invalid request body.';
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message } });
    return;
  }

  const parseStatus = bodyParseFailureStatus(err);
  if (parseStatus !== null) {
    res.status(parseStatus).json({
      error: {
        code: 'VALIDATION_ERROR',
        message:
          parseStatus === 413
            ? 'The request body is too large.'
            : 'The request body must be valid JSON.',
      },
    });
    return;
  }

  log.error('Unhandled error', err);
  res.status(500).json({
    error: { code: 'INTERNAL', message: 'Something went wrong on the server.' },
  });
}