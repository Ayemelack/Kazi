// KZ-12: every message a user sees for a failed request comes from the app's
// own translations, chosen by the error's code (and field + rule for
// validation errors). Server text is never shown.
import {
  API_ERROR_CODES,
  VALIDATION_FIELDS,
  VALIDATION_RULES,
} from '@kazi/shared';
import i18n from '../src/i18n';
import en from '../src/i18n/locales/en';
import fr from '../src/i18n/locales/fr';
import wes from '../src/i18n/locales/wes';
import { ApiError, NetworkError } from '../src/errors/ApiError';
import { LocalError, errorField, errorMessage } from '../src/errors/messages';

const LOCALES = { en, fr, wes };

describe('error translations', () => {
  it.each(Object.entries(LOCALES))('%s has a message for every API error code', (_, locale) => {
    const codes = locale.errors.codes as Record<string, string>;
    expect(Object.keys(codes).sort()).toEqual([...API_ERROR_CODES].sort());
  });

  it.each(Object.entries(LOCALES))('%s has a message for every validation rule', (_, locale) => {
    const rules = locale.errors.validation as Record<string, string>;
    expect(Object.keys(rules).sort()).toEqual([...VALIDATION_RULES].sort());
  });

  it.each(Object.entries(LOCALES))('%s has a label for every validated field', (_, locale) => {
    const fields = locale.errors.fields as Record<string, string>;
    expect(Object.keys(fields).sort()).toEqual([...VALIDATION_FIELDS].sort());
  });
});

describe('errorMessage', () => {
  const t = i18n.t.bind(i18n);

  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('translates a known code, ignoring the server text', () => {
    const err = new ApiError(409, 'Server English text', 'EMAIL_IN_USE');
    expect(errorMessage(err, t)).toBe(en.errors.codes.EMAIL_IN_USE);
  });

  it('falls back to the translated generic message for unknown codes and errors', () => {
    const leaky = 'Internal detail from the server';
    expect(errorMessage(new ApiError(418, leaky, 'TEAPOT'), t)).toBe(en.errors.generic);
    expect(errorMessage(new ApiError(502, leaky), t)).toBe(en.errors.generic);
    expect(errorMessage(new Error(leaky), t)).toBe(en.errors.generic);
    expect(errorMessage('a string', t)).toBe(en.errors.generic);
  });

  it('separates offline from server unreachable', () => {
    expect(errorMessage(new NetworkError(), t)).toBe(en.errors.offline);
    expect(errorMessage(new ApiError(0, 'x', 'SERVER_UNREACHABLE'), t)).toBe(
      en.errors.serverUnreachable,
    );
  });

  it('words a validation error from its field and rule', () => {
    const err = new ApiError(400, 'amount: Amount is too large.', 'VALIDATION_ERROR', {
      field: 'amount',
      rule: 'tooLarge',
    });
    expect(errorMessage(err, t)).toBe('Amount is too large.');
    expect(errorField(err)).toBe('amount');
  });

  it('uses the generic validation message when the field is unknown', () => {
    const err = new ApiError(400, 'x', 'VALIDATION_ERROR', { field: 'mystery', rule: 'tooLong' });
    expect(errorMessage(err, t)).toBe(en.errors.codes.VALIDATION_ERROR);
  });

  it('lets a screen word a code for its context', () => {
    const err = new ApiError(429, 'x', 'TOO_MANY_REQUESTS');
    expect(errorMessage(err, t, { TOO_MANY_REQUESTS: 'auth.errors.tooManyCodes' })).toBe(
      en.auth.errors.tooManyCodes,
    );
    expect(errorMessage(err, t)).toBe(en.errors.codes.TOO_MANY_REQUESTS);
  });

  it('translates app-raised messages', () => {
    expect(errorMessage(new LocalError('auth.errors.codeExpired'), t)).toBe(
      en.auth.errors.codeExpired,
    );
  });

  it('follows the current language for the same error object', async () => {
    const err = new ApiError(400, 'x', 'VALIDATION_ERROR', { field: 'amount', rule: 'required' });
    expect(errorMessage(err, t)).toBe('Amount is required.');
    await i18n.changeLanguage('fr');
    expect(errorMessage(err, t)).toBe('Montant : champ obligatoire.');
    expect(errorMessage(new NetworkError(), t)).toBe(fr.errors.offline);
  });
});

describe('apiRequest error parsing', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  function respond(status: number, body: string) {
    const response = { ok: status < 400, status, json: async () => JSON.parse(body) };
    globalThis.fetch = jest.fn(async () => response) as unknown as typeof fetch;
  }

  it('keeps code, field and rule, and the server text only as the internal message', async () => {
    const { apiRequest } = require('../src/api/client');
    respond(
      400,
      JSON.stringify({
        error: { code: 'VALIDATION_ERROR', message: 'date: too late', field: 'date', rule: 'tooLate' },
      }),
    );
    const failure = apiRequest('/transactions', { method: 'POST', auth: false });
    await expect(failure).rejects.toMatchObject({
      status: 400,
      code: 'VALIDATION_ERROR',
      field: 'date',
      rule: 'tooLate',
      message: 'date: too late',
    });
  });

  it('drops a rule outside the shared list', async () => {
    const { apiRequest } = require('../src/api/client');
    respond(400, JSON.stringify({ error: { code: 'VALIDATION_ERROR', rule: 'made-up' } }));
    const err = await apiRequest('/x', { auth: false }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).rule).toBeUndefined();
  });

  it('has no code for a non-JSON error page, so users see the generic message', async () => {
    const { apiRequest } = require('../src/api/client');
    respond(502, '<html>Bad gateway</html>');
    const err = await apiRequest('/x', { auth: false }).catch((e: unknown) => e);
    expect((err as ApiError).code).toBeUndefined();
    expect(errorMessage(err, i18n.t.bind(i18n))).toBe(en.errors.generic);
  });
});
