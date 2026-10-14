import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, mock, test } from 'node:test';
import {
  ConsoleSender,
  EmailSender,
  resetDeliveryFromEnv,
  type ResetCodeSender,
  type ResetDeliveryVerdict,
} from './delivery.js';
import {
  EMAIL_TIMEOUT_MS,
  EmailDeliveryError,
  HttpEmailTransport,
  type HttpClient,
  type HttpRequest,
} from './emailTransport.js';
import { resetCodeEmail } from './resetEmail.js';

// KZ-06: how reset codes are delivered, and the boot-time rules that keep a
// code out of every response outside development.

const API_KEY = 'xkeysib-secret-api-key-value';

const BREVO = {
  EMAIL_PROVIDER: 'brevo',
  EMAIL_API_KEY: API_KEY,
  EMAIL_FROM: 'no-reply@kazi.example',
};

interface Recorded {
  url: string;
  init: HttpRequest;
}

function fakeHttp(status = 201): { http: HttpClient; calls: Recorded[]; cancelled: () => number } {
  const calls: Recorded[] = [];
  let cancelled = 0;
  const http: HttpClient = async (url, init) => {
    calls.push({ url, init });
    return {
      ok: status >= 200 && status < 300,
      status,
      body: {
        cancel: async () => {
          cancelled += 1;
        },
      },
    };
  };
  return { http, calls, cancelled: () => cancelled };
}

function delivery(verdict: ResetDeliveryVerdict) {
  assert.ok(verdict.ok, verdict.ok ? '' : verdict.error);
  return verdict.delivery;
}

function failure(verdict: ResetDeliveryVerdict): string {
  assert.equal(verdict.ok, false, 'expected a refusal');
  return verdict.ok ? '' : verdict.error;
}

describe('resetDeliveryFromEnv', () => {
  test('production needs a real sender and never returns codes', () => {
    assert.match(failure(resetDeliveryFromEnv({ NODE_ENV: 'production' })), /No way to send password reset codes.*Refusing to start in production/s);
    const sender = delivery(resetDeliveryFromEnv({ NODE_ENV: 'production', ...BREVO })).sender;
    assert.ok(sender instanceof EmailSender);
    assert.equal(sender.description, 'email (brevo)');
    assert.equal(delivery(resetDeliveryFromEnv({ NODE_ENV: 'production', ...BREVO })).devCodeInResponse, false);
  });

  test('ALLOW_DEV_RESET_CODE=1 stops a production boot, with or without email', () => {
    for (const email of [{}, BREVO]) {
      const error = failure(resetDeliveryFromEnv({ NODE_ENV: 'production', ALLOW_DEV_RESET_CODE: '1', ...email }));
      assert.match(error, /ALLOW_DEV_RESET_CODE=1 .* only works with NODE_ENV=development or test\. Unset it\. Refusing to start in production\./);
    }
  });

  test('an unset or unknown NODE_ENV is treated like production (fail closed)', () => {
    for (const nodeEnv of [undefined, '', '  ', 'staging', 'prod']) {
      assert.match(failure(resetDeliveryFromEnv({ NODE_ENV: nodeEnv })), /set NODE_ENV=development/, String(nodeEnv));
      assert.match(failure(resetDeliveryFromEnv({ NODE_ENV: nodeEnv, ALLOW_DEV_RESET_CODE: '1', ...BREVO })), /ALLOW_DEV_RESET_CODE=1/);
      assert.ok(delivery(resetDeliveryFromEnv({ NODE_ENV: nodeEnv, ...BREVO })).sender instanceof EmailSender);
    }
  });

  test('development and test print codes to the console unless email is configured', () => {
    for (const nodeEnv of ['development', 'test']) {
      const local = delivery(resetDeliveryFromEnv({ NODE_ENV: nodeEnv }));
      assert.ok(local.sender instanceof ConsoleSender);
      assert.equal(local.devCodeInResponse, false);
      assert.equal(delivery(resetDeliveryFromEnv({ NODE_ENV: nodeEnv, ALLOW_DEV_RESET_CODE: '1' })).devCodeInResponse, true);
      assert.equal(delivery(resetDeliveryFromEnv({ NODE_ENV: nodeEnv, ALLOW_DEV_RESET_CODE: '0' })).devCodeInResponse, false);
      assert.ok(delivery(resetDeliveryFromEnv({ NODE_ENV: nodeEnv, ...BREVO })).sender instanceof EmailSender);
    }
  });

  test('ALLOW_DEV_RESET_CODE accepts only 1, 0 or nothing', () => {
    for (const value of ['true', 'yes', '2', 'on']) {
      assert.match(failure(resetDeliveryFromEnv({ NODE_ENV: 'development', ALLOW_DEV_RESET_CODE: value })), /must be 1 or unset/);
    }
  });

  test('no combination of settings returns codes outside development and test', () => {
    const nodeEnvs = [undefined, '', 'production', 'staging', 'development', 'test'];
    const allows = [undefined, '', '0', '1', 'true'];
    const emails = [{}, BREVO];
    let combinations = 0;
    for (const NODE_ENV of nodeEnvs) {
      for (const ALLOW_DEV_RESET_CODE of allows) {
        for (const email of emails) {
          combinations += 1;
          const verdict = resetDeliveryFromEnv({ NODE_ENV, ALLOW_DEV_RESET_CODE, ...email });
          const devOrTest = NODE_ENV === 'development' || NODE_ENV === 'test';
          if (verdict.ok && verdict.delivery.devCodeInResponse) {
            assert.ok(devOrTest && ALLOW_DEV_RESET_CODE === '1', JSON.stringify({ NODE_ENV, ALLOW_DEV_RESET_CODE }));
          }
          if (verdict.ok && verdict.delivery.sender instanceof ConsoleSender) {
            assert.ok(devOrTest);
          }
          if (NODE_ENV === 'production' && verdict.ok) {
            assert.ok(verdict.delivery.sender instanceof EmailSender);
          }
        }
      }
    }
    assert.equal(combinations, 60);
  });

  test('email settings are checked at boot and the key is never echoed', () => {
    const cases: Array<[Record<string, string>, RegExp]> = [
      [{ EMAIL_PROVIDER: 'sendgrid', EMAIL_API_KEY: API_KEY, EMAIL_FROM: BREVO.EMAIL_FROM }, /EMAIL_PROVIDER must be one of: brevo, postmark, http/],
      [{ EMAIL_PROVIDER: 'brevo', EMAIL_FROM: BREVO.EMAIL_FROM }, /EMAIL_API_KEY is missing/],
      [{ EMAIL_PROVIDER: 'brevo', EMAIL_API_KEY: API_KEY }, /EMAIL_FROM must be the sender address/],
      [{ ...BREVO, EMAIL_FROM: 'not-an-address' }, /EMAIL_FROM must be the sender address/],
      [{ ...BREVO, EMAIL_FROM_NAME: 'Kazi" <evil@x.cm>' }, /EMAIL_FROM_NAME may only contain/],
      [{ ...BREVO, EMAIL_PROVIDER: 'http' }, /EMAIL_API_URL is required with EMAIL_PROVIDER=http/],
      [{ ...BREVO, EMAIL_API_URL: 'http://relay.example/send' }, /EMAIL_API_URL must be an https:\/\/ URL/],
      [{ ...BREVO, EMAIL_API_URL: 'not a url' }, /EMAIL_API_URL must be an https:\/\/ URL/],
      [{ EMAIL_API_KEY: API_KEY, EMAIL_FROM: BREVO.EMAIL_FROM }, /EMAIL_PROVIDER is not/],
    ];
    for (const [env, pattern] of cases) {
      for (const NODE_ENV of ['production', 'development']) {
        const error = failure(resetDeliveryFromEnv({ NODE_ENV, ...env }));
        assert.match(error, pattern, JSON.stringify(env));
        assert.ok(!error.includes(API_KEY), 'the API key is never printed');
      }
    }
  });

  test('blank variables count as unset', () => {
    const local = delivery(resetDeliveryFromEnv({
      NODE_ENV: 'development',
      ALLOW_DEV_RESET_CODE: '',
      EMAIL_PROVIDER: '',
      EMAIL_API_KEY: ' ',
      EMAIL_FROM: '',
    }));
    assert.ok(local.sender instanceof ConsoleSender);
    assert.equal(local.devCodeInResponse, false);
  });
});

describe('ConsoleSender', () => {
  afterEach(() => mock.restoreAll());

  test('refuses to exist outside development and test', () => {
    for (const nodeEnv of ['production', undefined, 'staging']) {
      assert.throws(() => new ConsoleSender(nodeEnv), /only runs with NODE_ENV=development or test/);
    }
  });

  test('prints the code with a masked address', async () => {
    const lines: string[] = [];
    mock.method(console, 'log', (...args: unknown[]) => lines.push(args.join(' ')));
    const sender: ResetCodeSender = new ConsoleSender('development');
    await sender.send('awa.nkono@market.cm', '042917', 'fr');
    assert.equal(lines.length, 1);
    assert.match(lines[0]!, /Password reset code for a\*\*\*@market\.cm: 042917/);
    assert.ok(!lines[0]!.includes('awa.nkono'));
  });
});

describe('EmailSender over the HTTP adapter (mocked HTTP client)', () => {
  test('brevo: POST /v3/smtp/email with the api-key header and a text body', async () => {
    const { http, calls, cancelled } = fakeHttp(201);
    const sender = delivery(resetDeliveryFromEnv({ NODE_ENV: 'production', ...BREVO }, http)).sender;
    await sender.send('owner@market.cm', '381204', 'en');

    assert.equal(calls.length, 1);
    const { url, init } = calls[0]!;
    assert.equal(url, 'https://api.brevo.com/v3/smtp/email');
    assert.equal(init.method, 'POST');
    assert.equal(init.headers['api-key'], API_KEY);
    assert.equal(init.headers['Content-Type'], 'application/json');
    const body = JSON.parse(init.body);
    assert.deepEqual(body.sender, { name: 'Kazi', email: 'no-reply@kazi.example' });
    assert.deepEqual(body.to, [{ email: 'owner@market.cm' }]);
    assert.equal(body.subject, 'Your Kazi password reset code');
    assert.match(body.textContent, /381204/);
    assert.equal(cancelled(), 1, 'the reply body is released');
  });

  test('postmark: POST /email with X-Postmark-Server-Token', async () => {
    const { http, calls } = fakeHttp(200);
    const sender = delivery(resetDeliveryFromEnv({
      NODE_ENV: 'production',
      EMAIL_PROVIDER: 'postmark',
      EMAIL_API_KEY: API_KEY,
      EMAIL_FROM: 'no-reply@kazi.example',
      EMAIL_FROM_NAME: 'Kazi Cameroun',
    }, http)).sender;
    await sender.send('owner@market.cm', '381204', 'fr');

    const { url, init } = calls[0]!;
    assert.equal(url, 'https://api.postmarkapp.com/email');
    assert.equal(init.headers['X-Postmark-Server-Token'], API_KEY);
    const body = JSON.parse(init.body);
    assert.equal(body.From, '"Kazi Cameroun" <no-reply@kazi.example>');
    assert.equal(body.To, 'owner@market.cm');
    assert.equal(body.Subject, 'Votre code de réinitialisation Kazi');
    assert.match(body.TextBody, /381204/);
    assert.equal(body.MessageStream, 'outbound');
  });

  test('http: the configured https URL with a bearer token and a plain JSON body', async () => {
    const { http, calls } = fakeHttp(202);
    const sender = delivery(resetDeliveryFromEnv({
      NODE_ENV: 'production',
      EMAIL_PROVIDER: 'http',
      EMAIL_API_KEY: API_KEY,
      EMAIL_FROM: 'no-reply@kazi.example',
      EMAIL_API_URL: 'https://mail-relay.kazi.example/v1/send',
    }, http)).sender;
    await sender.send('owner@market.cm', '381204', 'wes');

    const { url, init } = calls[0]!;
    assert.equal(url, 'https://mail-relay.kazi.example/v1/send');
    assert.equal(init.headers.Authorization, `Bearer ${API_KEY}`);
    const body = JSON.parse(init.body);
    assert.deepEqual(Object.keys(body).sort(), ['from', 'subject', 'text', 'to']);
    assert.equal(body.subject, 'Your Kazi code for reset password');
  });

  test('every request carries a 5-second timeout', async () => {
    assert.equal(EMAIL_TIMEOUT_MS, 5000);
    const timeouts: number[] = [];
    const original = AbortSignal.timeout.bind(AbortSignal);
    const spy = mock.method(AbortSignal, 'timeout', (ms: number) => {
      timeouts.push(ms);
      return original(ms);
    });
    try {
      const { http, calls } = fakeHttp(201);
      await new HttpEmailTransport({ provider: 'brevo', apiKey: API_KEY }, http).send({
        from: { email: 'no-reply@kazi.example', name: 'Kazi' },
        to: 'owner@market.cm',
        subject: 's',
        text: 't',
      });
      assert.deepEqual(timeouts, [5000]);
      assert.ok(calls[0]!.init.signal instanceof AbortSignal);
    } finally {
      spy.mock.restore();
    }
  });

  test('a provider that does not answer in time, refuses, or cannot be reached is a delivery error without personal data', async () => {
    const message = {
      from: { email: 'no-reply@kazi.example', name: 'Kazi' },
      to: 'owner@market.cm',
      subject: 'Your Kazi password reset code',
      text: 'code 381204',
    };
    const hanging: HttpClient = (_url, init) =>
      new Promise((_resolve, reject) => {
        // What fetch does when its AbortSignal.timeout fires.
        if (init.signal.aborted) {
          reject(init.signal.reason);
        }
        init.signal.addEventListener('abort', () => reject(init.signal.reason));
      });
    const timeoutSpy = mock.method(AbortSignal, 'timeout', () => AbortSignal.abort(new DOMException('timed out', 'TimeoutError')));
    try {
      await assert.rejects(
        new HttpEmailTransport({ provider: 'brevo', apiKey: API_KEY }, hanging).send(message),
        (err: unknown) => err instanceof EmailDeliveryError && /brevo did not answer within 5 s/.test(err.message),
      );
    } finally {
      timeoutSpy.mock.restore();
    }

    const refused = fakeHttp(401).http;
    await assert.rejects(
      new HttpEmailTransport({ provider: 'postmark', apiKey: API_KEY }, refused).send(message),
      (err: unknown) => err instanceof EmailDeliveryError && err.message === 'postmark answered HTTP 401',
    );

    const offline: HttpClient = async () => {
      throw new TypeError('fetch failed: getaddrinfo ENOTFOUND api.brevo.com');
    };
    await assert.rejects(
      new HttpEmailTransport({ provider: 'brevo', apiKey: API_KEY }, offline).send(message),
      (err: unknown) => {
        assert.ok(err instanceof EmailDeliveryError);
        assert.equal(err.message, 'brevo could not be reached');
        for (const secret of [API_KEY, 'owner@market.cm', '381204']) {
          assert.ok(!err.message.includes(secret));
        }
        return true;
      },
    );
  });

  test('the transport refuses a URL that is not https', () => {
    assert.throws(
      () => new HttpEmailTransport({ provider: 'http', apiKey: API_KEY, apiUrl: 'http://relay.example' }),
      /must be an https:\/\/ URL/,
    );
  });
});

describe('reset email templates', () => {
  test('en, fr and wes each carry the code, the 15 minutes and the 5 tries, and keep the code out of the subject', () => {
    const subjects = new Set<string>();
    for (const language of ['en', 'fr', 'wes'] as const) {
      const { subject, text } = resetCodeEmail('905113', language);
      subjects.add(subject);
      assert.ok(!subject.includes('905113'), `${language}: no code in the subject`);
      assert.match(text, /^ {4}905113$/m, language);
      assert.match(text, /\b15\b/, language);
      assert.match(text, /\b5\b/, language);
      assert.ok(!/https?:\/\//.test(text), `${language}: no links`);
    }
    assert.equal(subjects.size, 3, 'each language has its own subject');
  });
});

describe('documentation', () => {
  test('every setting the server reads for reset delivery is in .env.example and DEPLOYMENT.md §3', () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const source = fs.readFileSync(path.join(here, 'delivery.ts'), 'utf8');
    const names = [...source.matchAll(/setting\(env, '([A-Z_]+)'\)/g)].map(match => match[1]!);
    assert.deepEqual(
      [...new Set(names)].sort(),
      ['ALLOW_DEV_RESET_CODE', 'EMAIL_API_KEY', 'EMAIL_API_URL', 'EMAIL_FROM', 'EMAIL_FROM_NAME', 'EMAIL_PROVIDER', 'NODE_ENV'],
    );
    const example = fs.readFileSync(path.join(here, '..', '..', '.env.example'), 'utf8');
    const deployment = fs.readFileSync(path.join(here, '..', '..', '..', 'docs', 'DEPLOYMENT.md'), 'utf8');
    for (const name of names) {
      assert.match(example, new RegExp(`^#?${name}=`, 'm'), `.env.example: ${name}`);
      assert.ok(deployment.includes(`| \`${name}\` |`), `DEPLOYMENT.md: ${name}`);
    }
  });
});
