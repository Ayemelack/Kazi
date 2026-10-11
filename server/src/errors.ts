import type { NextFunction, Request, Response } from 'express';
import { ZodError, type ZodIssue } from 'zod';
import {
  isValidationRule,
  type ApiErrorBody,
  type ApiErrorCode,
  type ValidationRule,
} from '@kazi/shared';
import { log } from './log.js';

// The list of codes lives in @kazi/shared (KZ-12) so the app translates
// exactly the codes the API can send; an unknown code does not compile.
export type ErrorCode = ApiErrorCode;

export interface ValidationDetail {
  field?: string;
  rule: ValidationRule;
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly detail?: ValidationDetail;

  constructor(status: number, code: ErrorCode, message: string, detail?: ValidationDetail) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.detail = detail;
  }
}

// Turns zod's first issue into the field and rule the app translates. A
// refinement can name its rule with `params: { rule }`.
export function issueDetail(issue: ZodIssue): ValidationDetail {
  const head = issue.path[0];
  const field = typeof head === 'string' ? head : undefined;
  return { field, rule: issueRule(issue) };
}

function issueRule(issue: ZodIssue): ValidationRule {
  switch (issue.code) {
    case 'invalid_type':
      return issue.received === 'undefined' || issue.received === 'null'
        ? 'required'
        : 'invalid';
    case 'too_small':
      if (issue.type === 'string') {
        return issue.minimum === 1 ? 'required' : 'tooShort';
      }
      if (issue.type === 'array' || issue.type === 'set') {
        return 'tooShort';
      }
      return issue.type === 'date' ? 'tooEarly' : 'tooSmall';
    case 'too_big':
      if (issue.type === 'string' || issue.type === 'array' || issue.type === 'set') {
        return 'tooLong';
      }
      return issue.type === 'date' ? 'tooLate' : 'tooLarge';
    case 'invalid_string':
    case 'invalid_date':
      return 'format';
    case 'invalid_enum_value':
    case 'invalid_literal':
      return 'notAllowed';
    case 'custom': {
      const rule: unknown = issue.params?.rule;
      return isValidationRule(rule) ? rule : 'invalid';
    }
    default:
      return 'invalid';
  }
}

function errorBody(
  code: ErrorCode,
  message: string,
  detail?: ValidationDetail,
): { error: ApiErrorBody } {
  const body: ApiErrorBody = { code, message };
  if (detail?.field !== undefined) {
    body.field = detail.field;
  }
  if (detail) {
    body.rule = detail.rule;
  }
  return { error: body };
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
    res.status(err.status).json(errorBody(err.code, err.message, err.detail));
    return;
  }

  if (err instanceof ZodError) {
    const issue = err.issues[0];
    if (!issue) {
      res
        .status(400)
        .json(errorBody('VALIDATION_ERROR', 'Invalid request body.', { rule: 'invalid' }));
      return;
    }
    const message = `${issue.path.join('.') || 'body'}: ${issue.message}`;
    res.status(400).json(errorBody('VALIDATION_ERROR', message, issueDetail(issue)));
    return;
  }

  const parseStatus = bodyParseFailureStatus(err);
  if (parseStatus !== null) {
    res
      .status(parseStatus)
      .json(
        parseStatus === 413
          ? errorBody('VALIDATION_ERROR', 'The request body is too large.', {
              rule: 'tooLarge',
            })
          : errorBody('VALIDATION_ERROR', 'The request body must be valid JSON.', {
              rule: 'format',
            }),
      );
    return;
  }

  log.error('Unhandled error', err);
  res.status(500).json(errorBody('INTERNAL', 'Something went wrong on the server.'));
}