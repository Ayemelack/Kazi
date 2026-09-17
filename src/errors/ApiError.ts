import i18n from '../i18n';

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export class NetworkError extends Error {
  constructor() {
    super(i18n.t('common.error.offline'));
    this.name = 'NetworkError';
  }
}