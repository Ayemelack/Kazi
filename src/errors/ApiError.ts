import type { ApiErrorCode, ValidationRule } from '@kazi/shared';

// Codes the app itself produces when no API response arrived.
export type ClientErrorCode = 'SERVER_UNREACHABLE';

// `message` is the API's English text (or a fixed English description) for
// logs and developers. It is never shown to users: src/errors/messages.ts
// turns `code` (and `field` + `rule`) into text in the user's language
// (KZ-12).
export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly field?: string;
  readonly rule?: ValidationRule;

  constructor(
    status: number,
    message: string,
    code?: ApiErrorCode | ClientErrorCode | string,
    detail?: { field?: string; rule?: ValidationRule },
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.field = detail?.field;
    this.rule = detail?.rule;
  }
}

export class NetworkError extends Error {
  constructor() {
    super('The device is offline.');
    this.name = 'NetworkError';
  }
}
