// Sends one email through a provider's HTTPS API (KZ-06). The email provider
// is still an open owner decision (D2), so this is a small adapter: each
// provider is a function that turns a message into one HTTPS request. Brevo
// and Postmark (two of the providers D2 names) are built in; "http" posts a
// plain JSON body with a bearer token, for a relay you run or a provider added
// later. Amazon SES needs request signing and is not built in.
//
// Nothing here logs. Errors carry the provider and the HTTP status only, never
// the recipient, the message or the API key.

export const EMAIL_PROVIDERS = ['brevo', 'postmark', 'http'] as const;
export type EmailProvider = (typeof EMAIL_PROVIDERS)[number];

export function isEmailProvider(value: unknown): value is EmailProvider {
  return (EMAIL_PROVIDERS as readonly unknown[]).includes(value);
}

/** Give up on a provider that hasn't answered within this time. */
export const EMAIL_TIMEOUT_MS = 5000;

export const DEFAULT_API_URLS: Partial<Record<EmailProvider, string>> = {
  brevo: 'https://api.brevo.com/v3/smtp/email',
  postmark: 'https://api.postmarkapp.com/email',
};

export interface EmailAddress {
  email: string;
  name: string;
}

export interface EmailMessage {
  from: EmailAddress;
  to: string;
  subject: string;
  text: string;
}

export interface EmailTransportConfig {
  provider: EmailProvider;
  apiKey: string;
  /** HTTPS endpoint; required for "http", optional override for the others. */
  apiUrl?: string;
}

export interface HttpRequest {
  method: 'POST';
  headers: Record<string, string>;
  body: string;
  signal: AbortSignal;
}

export interface HttpResponse {
  ok: boolean;
  status: number;
  body?: { cancel(): Promise<void> } | null;
}

/** The subset of fetch the transport uses, so tests can pass a fake. */
export type HttpClient = (url: string, init: HttpRequest) => Promise<HttpResponse>;

export interface EmailTransport {
  send(message: EmailMessage): Promise<void>;
}

export class EmailDeliveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmailDeliveryError';
  }
}

type RequestParts = { headers: Record<string, string>; body: unknown };

const JSON_HEADERS = { 'Content-Type': 'application/json', Accept: 'application/json' };

// Request shapes checked against the providers' API references (2026-10-14):
// Brevo POST /v3/smtp/email with an `api-key` header (201 on success);
// Postmark POST /email with `X-Postmark-Server-Token` (200 on success).
const REQUESTS: Record<EmailProvider, (message: EmailMessage, apiKey: string) => RequestParts> = {
  brevo: (message, apiKey) => ({
    headers: { ...JSON_HEADERS, 'api-key': apiKey },
    body: {
      sender: { name: message.from.name, email: message.from.email },
      to: [{ email: message.to }],
      subject: message.subject,
      textContent: message.text,
    },
  }),
  postmark: (message, apiKey) => ({
    headers: { ...JSON_HEADERS, 'X-Postmark-Server-Token': apiKey },
    body: {
      From: `"${message.from.name}" <${message.from.email}>`,
      To: message.to,
      Subject: message.subject,
      TextBody: message.text,
      MessageStream: 'outbound',
    },
  }),
  http: (message, apiKey) => ({
    headers: { ...JSON_HEADERS, Authorization: `Bearer ${apiKey}` },
    body: {
      from: message.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
    },
  }),
};

export class HttpEmailTransport implements EmailTransport {
  private readonly url: string;

  constructor(
    private readonly config: EmailTransportConfig,
    private readonly http: HttpClient = fetch,
  ) {
    const url = config.apiUrl ?? DEFAULT_API_URLS[config.provider];
    if (!url || !url.startsWith('https://')) {
      throw new Error(`The ${config.provider} email API URL must be an https:// URL.`);
    }
    this.url = url;
  }

  async send(message: EmailMessage): Promise<void> {
    const { headers, body } = REQUESTS[this.config.provider](message, this.config.apiKey);
    let response: HttpResponse;
    try {
      response = await this.http(this.url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(EMAIL_TIMEOUT_MS),
      });
    } catch (err) {
      const timedOut =
        err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
      throw new EmailDeliveryError(
        timedOut
          ? `${this.config.provider} did not answer within ${EMAIL_TIMEOUT_MS / 1000} s`
          : `${this.config.provider} could not be reached`,
      );
    }
    // The reply body is not needed; release the connection.
    await response.body?.cancel().catch(() => undefined);
    if (!response.ok) {
      throw new EmailDeliveryError(`${this.config.provider} answered HTTP ${response.status}`);
    }
  }
}
