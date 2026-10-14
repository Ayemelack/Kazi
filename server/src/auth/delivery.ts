import { EMAIL_MAX, type AppLanguage } from '@kazi/shared';
import { log } from '../log.js';
import {
  EMAIL_PROVIDERS,
  EmailDeliveryError,
  HttpEmailTransport,
  isEmailProvider,
  type EmailAddress,
  type EmailTransport,
  type HttpClient,
} from './emailTransport.js';
import { resetCodeEmail } from './resetEmail.js';

// How password reset codes reach the account holder (KZ-06, decision D2:
// email first). The server picks the sender once, at boot, from its
// environment, and refuses to start without one that can really deliver,
// unless NODE_ENV says this is a development or test machine.

export interface ResetCodeSender {
  /** Where codes go, for the boot log. Never contains a secret. */
  readonly description: string;
  send(to: string, code: string, language: AppLanguage): Promise<void>;
}

export interface ResetDelivery {
  sender: ResetCodeSender;
  /**
   * Development shortcut (ALLOW_DEV_RESET_CODE=1 with NODE_ENV=development or
   * test): forgot-password also returns the code in its response.
   */
  devCodeInResponse: boolean;
}

export function isDevelopmentOrTest(nodeEnv: string | undefined): boolean {
  return nodeEnv === 'development' || nodeEnv === 'test';
}

function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  return at > 0 ? `${email[0]}***${email.slice(at)}` : '***';
}

/**
 * Prints codes to the server console. The only place a reset code is ever
 * written out, so it refuses to exist outside development and test.
 */
export class ConsoleSender implements ResetCodeSender {
  readonly description = 'the server console (development only)';

  constructor(nodeEnv: string | undefined = process.env.NODE_ENV) {
    if (!isDevelopmentOrTest(nodeEnv)) {
      throw new Error('ConsoleSender prints reset codes; it only runs with NODE_ENV=development or test.');
    }
  }

  async send(to: string, code: string): Promise<void> {
    log.info(`[development] Password reset code for ${maskEmail(to)}: ${code}`);
  }
}

/** Emails the code, in the account's language, through an HTTPS email API. */
export class EmailSender implements ResetCodeSender {
  readonly description: string;

  constructor(
    private readonly transport: EmailTransport,
    private readonly from: EmailAddress,
    provider: string,
  ) {
    this.description = `email (${provider})`;
  }

  async send(to: string, code: string, language: AppLanguage): Promise<void> {
    const { subject, text } = resetCodeEmail(code, language);
    await this.transport.send({ from: this.from, to, subject, text });
  }
}

/**
 * What createApp uses when it is given no delivery (tests that don't exercise
 * the reset flow): nothing is sent and nothing is printed.
 */
export const NO_RESET_DELIVERY: ResetDelivery = {
  sender: {
    description: 'nothing (no sender configured)',
    async send() {
      throw new EmailDeliveryError('no reset-code sender is configured');
    },
  },
  devCodeInResponse: false,
};

/** A failure reason that is safe to log: no address, code or key. */
export function deliveryFailureReason(err: unknown): string {
  if (err instanceof EmailDeliveryError) {
    return err.message;
  }
  return `unexpected ${err instanceof Error ? err.name : 'error'}`;
}

type Env = Record<string, string | undefined>;

export type ResetDeliveryVerdict =
  | { ok: true; delivery: ResetDelivery }
  | { ok: false; error: string };

// An empty variable counts as unset (a blank line in an env file).
function setting(env: Env, name: string): string | undefined {
  const value = env[name]?.trim();
  return value ? value : undefined;
}

const EMAIL_PATTERN = /^[^\s@"<>]+@[^\s@"<>]+\.[^\s@"<>]+$/;
const FROM_NAME_PATTERN = /^[\p{L}\p{N} .'&-]{1,60}$/u;

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

function emailSenderFromEnv(
  env: Env,
  http?: HttpClient,
): { sender?: EmailSender; error?: string } {
  const provider = setting(env, 'EMAIL_PROVIDER');
  const apiKey = setting(env, 'EMAIL_API_KEY');
  const from = setting(env, 'EMAIL_FROM');
  const apiUrl = setting(env, 'EMAIL_API_URL');
  const fromName = setting(env, 'EMAIL_FROM_NAME') ?? 'Kazi';

  if (provider === undefined) {
    if (apiKey || from || apiUrl) {
      return { error: 'EMAIL_API_KEY, EMAIL_FROM or EMAIL_API_URL is set but EMAIL_PROVIDER is not.' };
    }
    return {};
  }
  if (!isEmailProvider(provider)) {
    return { error: `EMAIL_PROVIDER must be one of: ${EMAIL_PROVIDERS.join(', ')}.` };
  }
  if (!apiKey) {
    return { error: `EMAIL_API_KEY is missing (the ${provider} API key).` };
  }
  if (!from || from.length > EMAIL_MAX || !EMAIL_PATTERN.test(from)) {
    return { error: 'EMAIL_FROM must be the sender address, for example no-reply@yourdomain, verified with the provider.' };
  }
  if (!FROM_NAME_PATTERN.test(fromName)) {
    return { error: "EMAIL_FROM_NAME may only contain letters, digits, spaces and . ' & - (at most 60)." };
  }
  if (provider === 'http' && !apiUrl) {
    return { error: 'EMAIL_API_URL is required with EMAIL_PROVIDER=http.' };
  }
  if (apiUrl !== undefined && !isHttpsUrl(apiUrl)) {
    return { error: 'EMAIL_API_URL must be an https:// URL.' };
  }
  const transport = new HttpEmailTransport({ provider, apiKey, apiUrl }, http);
  return { sender: new EmailSender(transport, { email: from, name: fromName }, provider) };
}

/**
 * Chooses how reset codes are delivered. Fails closed: production, or a
 * missing or unknown NODE_ENV, must have a working email sender, and the
 * development shortcut is refused anywhere but development and test. Messages
 * name the variable to fix and never echo a value.
 */
export function resetDeliveryFromEnv(env: Env, http?: HttpClient): ResetDeliveryVerdict {
  const nodeEnv = setting(env, 'NODE_ENV');
  const devOrTest = isDevelopmentOrTest(nodeEnv);
  const where = nodeEnv ? `NODE_ENV=${nodeEnv}` : 'NODE_ENV is not set';
  const refusal =
    nodeEnv === 'production' ? 'Refusing to start in production.' : `Refusing to start (${where}).`;

  const allow = setting(env, 'ALLOW_DEV_RESET_CODE');
  if (allow !== undefined && allow !== '0' && allow !== '1') {
    return { ok: false, error: 'ALLOW_DEV_RESET_CODE must be 1 or unset.' };
  }
  const devCodeInResponse = allow === '1';
  if (devCodeInResponse && !devOrTest) {
    return {
      ok: false,
      error: `ALLOW_DEV_RESET_CODE=1 returns reset codes in HTTP responses and only works with NODE_ENV=development or test. Unset it. ${refusal}`,
    };
  }

  const email = emailSenderFromEnv(env, http);
  if (email.error) {
    return { ok: false, error: `${email.error} ${refusal}` };
  }
  if (email.sender) {
    return { ok: true, delivery: { sender: email.sender, devCodeInResponse } };
  }
  if (devOrTest) {
    return { ok: true, delivery: { sender: new ConsoleSender(nodeEnv), devCodeInResponse } };
  }
  return {
    ok: false,
    error:
      'No way to send password reset codes: set EMAIL_PROVIDER, EMAIL_API_KEY and EMAIL_FROM ' +
      '(docs/DEPLOYMENT.md §3). For local development set NODE_ENV=development instead, which ' +
      `prints codes to this console. ${refusal}`,
  };
}
