// KZ-06: Forgot Password asks only for the email; the next screen takes the
// emailed code and the new password, and words each failure in the user's
// language without the API ever saying whether the account exists.
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { Text, TextInput } from 'react-native';
import {
  RESET_CODE_LENGTH,
  RESET_CODE_MAX_ATTEMPTS,
  RESET_CODE_TTL_MINUTES,
} from '@kazi/shared';
import i18n from '../src/i18n';
import en from '../src/i18n/locales/en';
import fr from '../src/i18n/locales/fr';
import wes from '../src/i18n/locales/wes';
import { ToastProvider } from '../src/components/ui/Toast';
import ForgotPasswordScreen from '../src/screens/auth/ForgotPasswordScreen';
import ResetPasswordScreen from '../src/screens/auth/ResetPasswordScreen';
import { ApiError } from '../src/errors/ApiError';
import {
  cleanResetCode,
  holdDevResetCode,
  resetCodeFailureKey,
  takeDevResetCode,
} from '../src/auth/resetFlow';
import {
  requestPasswordReset as requestPasswordResetApi,
  resetPassword as resetPasswordApi,
} from '../src/auth/api';

const { authMocks } = jest.requireMock('../src/auth/AuthContext') as {
  authMocks: { requestPasswordReset: jest.Mock; resetPassword: jest.Mock };
};
const { apiRequestMock } = jest.requireMock('../src/api/client') as { apiRequestMock: jest.Mock };

jest.mock('../src/auth/AuthContext', () => {
  const mocks = { requestPasswordReset: jest.fn(), resetPassword: jest.fn() };
  return { authMocks: mocks, useAuth: () => mocks };
});

jest.mock('../src/api/client', () => {
  const apiRequest = jest.fn(async () => ({ message: '' }));
  return { apiRequestMock: apiRequest, apiRequest };
});

jest.mock('react-native-safe-area-context', () => {
  const zero = { top: 0, right: 0, bottom: 0, left: 0 };
  return {
    SafeAreaProvider: ({ children }: { children: React.ReactNode }) => children,
    SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
    useSafeAreaInsets: () => zero,
    SafeAreaInsetsContext: require('react').createContext(zero),
    initialWindowMetrics: { frame: { x: 0, y: 0, width: 0, height: 0 }, insets: zero },
  };
});

type Renderer = ReactTestRenderer.ReactTestRenderer;
type ScreenComponent = React.ComponentType<{ navigation: unknown; route: unknown }>;

const EMAIL = 'owner@jolie.cm';
const LOCALES = { en, fr, wes };

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function render(
  Screen: ScreenComponent,
  params?: object,
): Promise<{ renderer: Renderer; navigate: jest.Mock }> {
  const navigate = jest.fn();
  let renderer: Renderer | undefined;
  await act(async () => {
    renderer = ReactTestRenderer.create(
      <ToastProvider>
        <Screen navigation={{ navigate }} route={{ key: 'test', name: 'Test', params }} />
      </ToastProvider>,
    );
  });
  await flush();
  return { renderer: renderer!, navigate };
}

function input(renderer: Renderer, testID: string) {
  return renderer.root.find(node => node.type === TextInput && node.props.testID === testID);
}

async function type(renderer: Renderer, testID: string, value: string) {
  await act(async () => {
    input(renderer, testID).props.onChangeText(value);
  });
}

async function press(renderer: Renderer, testID: string) {
  await act(async () => {
    renderer.root
      .find(node => node.props.testID === testID && node.props.accessibilityState !== undefined)
      .props.onPress();
  });
  await flush();
}

function texts(renderer: Renderer): string[] {
  return renderer.root
    .findAllByType(Text)
    .map(node => [node.props.children].flat(Infinity).join(''))
    .filter(text => text.length > 0);
}

async function inLanguage(lng: string, check: () => void) {
  await act(async () => {
    await i18n.changeLanguage(lng);
  });
  check();
}

const codeRefused = () => new ApiError(400, 'x', 'RESET_CODE_INVALID');
const tooMany = () => new ApiError(429, 'x', 'TOO_MANY_REQUESTS');

beforeEach(() => {
  authMocks.requestPasswordReset.mockReset().mockResolvedValue({ message: 'ok' });
  authMocks.resetPassword.mockReset().mockResolvedValue(undefined);
  apiRequestMock.mockClear();
  takeDevResetCode();
});

afterEach(async () => {
  await act(async () => {
    await i18n.changeLanguage('en');
  });
});

describe('Forgot password (KZ-06)', () => {
  it('asks only for the email and sends only the email', async () => {
    const { renderer, navigate } = await render(ForgotPasswordScreen as never);
    expect(renderer.root.findAllByType(TextInput).map(node => node.props.testID)).toEqual([
      'forgot-email',
    ]);

    await type(renderer, 'forgot-email', ` ${EMAIL} `);
    await press(renderer, 'forgot-submit');

    expect(authMocks.requestPasswordReset).toHaveBeenCalledWith({ email: EMAIL });
    expect(navigate).toHaveBeenCalledWith('ResetPassword', {
      email: EMAIL,
      requestedAt: expect.any(Number),
    });
  });

  it('never puts the code in navigation params; a dev build prefills it once', async () => {
    authMocks.requestPasswordReset.mockResolvedValue({ message: 'ok', devCode: '042917' });
    const { renderer, navigate } = await render(ForgotPasswordScreen as never);
    await type(renderer, 'forgot-email', EMAIL);
    await press(renderer, 'forgot-submit');

    const params = navigate.mock.calls[0]![1];
    expect(JSON.stringify(params)).not.toContain('042917');

    const reset = await render(ResetPasswordScreen as never, params);
    expect(input(reset.renderer, 'reset-code').props.value).toBe('042917');
    const again = await render(ResetPasswordScreen as never, params);
    expect(input(again.renderer, 'reset-code').props.value).toBe('');
  });

  it('says too many codes were asked for, in every language', async () => {
    authMocks.requestPasswordReset.mockRejectedValue(tooMany());
    const { renderer, navigate } = await render(ForgotPasswordScreen as never);
    await type(renderer, 'forgot-email', EMAIL);
    await press(renderer, 'forgot-submit');

    expect(navigate).not.toHaveBeenCalled();
    for (const [lng, locale] of Object.entries(LOCALES)) {
      await inLanguage(lng, () => {
        expect(texts(renderer)).toContain(locale.auth.errors.tooManyCodes);
      });
    }
  });

  it('"I already have a code" opens the code screen without asking for a new one', async () => {
    const { renderer, navigate } = await render(ForgotPasswordScreen as never);
    await press(renderer, 'forgot-have-code');
    expect(navigate).not.toHaveBeenCalled();
    expect(texts(renderer)).toContain(en.auth.errors.required);

    await type(renderer, 'forgot-email', EMAIL);
    await press(renderer, 'forgot-have-code');
    expect(navigate).toHaveBeenCalledWith('ResetPassword', { email: EMAIL });
    expect(authMocks.requestPasswordReset).not.toHaveBeenCalled();
  });
});

describe('Reset password with the emailed code (KZ-06)', () => {
  async function fill(renderer: Renderer, code = '123456') {
    await type(renderer, 'reset-code', code);
    await type(renderer, 'reset-password', 'kribiLedger2026');
    await type(renderer, 'reset-confirm', 'kribiLedger2026');
  }

  it('says a code was sent if an account exists, without claiming one does', async () => {
    const { renderer } = await render(ResetPasswordScreen as never, { email: EMAIL });
    expect(texts(renderer)).toContain(
      en.auth.resetCodeSent.replace('{{email}}', EMAIL),
    );
  });

  it('keeps only digits in the code field', async () => {
    const { renderer } = await render(ResetPasswordScreen as never, { email: EMAIL });
    await type(renderer, 'reset-code', ' 12 34-56 7');
    expect(input(renderer, 'reset-code').props.value).toBe('123456');
    expect(input(renderer, 'reset-code').props.keyboardType).toBe('number-pad');
  });

  it('sends the email, the code and the new password, then goes to Login', async () => {
    const { renderer, navigate } = await render(ResetPasswordScreen as never, { email: EMAIL });
    await fill(renderer);
    await press(renderer, 'reset-submit');
    expect(authMocks.resetPassword).toHaveBeenCalledWith({
      email: EMAIL,
      code: '123456',
      password: 'kribiLedger2026',
    });
    expect(navigate).toHaveBeenCalledWith('Login');
  });

  it(`a refused code reads "wrong", then "used up" after ${RESET_CODE_MAX_ATTEMPTS} tries, in every language`, async () => {
    authMocks.resetPassword.mockRejectedValue(codeRefused());
    const { renderer, navigate } = await render(ResetPasswordScreen as never, {
      email: EMAIL,
      requestedAt: Date.now(),
    });
    await fill(renderer);
    for (let i = 1; i < RESET_CODE_MAX_ATTEMPTS; i += 1) {
      await press(renderer, 'reset-submit');
      expect(texts(renderer)).toContain(en.auth.errors.codeWrong);
    }
    await press(renderer, 'reset-submit');
    expect(texts(renderer)).toContain(en.auth.errors.codeUsedUp);
    for (const [lng, locale] of Object.entries(LOCALES)) {
      await inLanguage(lng, () => {
        expect(texts(renderer)).toContain(locale.auth.errors.codeUsedUp);
      });
    }
    expect(navigate).not.toHaveBeenCalled();
  });

  it(`a code asked for ${RESET_CODE_TTL_MINUTES} minutes ago reads "expired"`, async () => {
    authMocks.resetPassword.mockRejectedValue(codeRefused());
    const { renderer } = await render(ResetPasswordScreen as never, {
      email: EMAIL,
      requestedAt: Date.now() - RESET_CODE_TTL_MINUTES * 60 * 1000,
    });
    await fill(renderer);
    await press(renderer, 'reset-submit');
    expect(texts(renderer)).toContain(en.auth.errors.codeExpired);
    await inLanguage('fr', () => {
      expect(texts(renderer)).toContain(fr.auth.errors.codeExpired);
    });
  });

  it('"Send a new code" asks again for the same email and starts the tries over', async () => {
    authMocks.resetPassword.mockRejectedValue(codeRefused());
    const { renderer } = await render(ResetPasswordScreen as never, { email: EMAIL });
    await fill(renderer);
    for (let i = 0; i < RESET_CODE_MAX_ATTEMPTS; i += 1) {
      await press(renderer, 'reset-submit');
    }
    expect(texts(renderer)).toContain(en.auth.errors.codeUsedUp);

    await press(renderer, 'reset-resend');
    expect(authMocks.requestPasswordReset).toHaveBeenCalledWith({ email: EMAIL });
    expect(texts(renderer)).not.toContain(en.auth.errors.codeUsedUp);
    // The old code no longer works, so the field is cleared.
    expect(input(renderer, 'reset-code').props.value).toBe('');

    await type(renderer, 'reset-code', '654321');
    await press(renderer, 'reset-submit');
    expect(texts(renderer)).toContain(en.auth.errors.codeWrong);

    authMocks.requestPasswordReset.mockRejectedValue(tooMany());
    await press(renderer, 'reset-resend');
    expect(texts(renderer)).toContain(en.auth.errors.tooManyCodes);
  });

  it('a password the API refuses shows under the password field', async () => {
    authMocks.resetPassword.mockRejectedValue(
      new ApiError(400, 'x', 'PASSWORD_TOO_COMMON', { field: 'password', rule: 'notAllowed' }),
    );
    const { renderer } = await render(ResetPasswordScreen as never, { email: EMAIL });
    await fill(renderer);
    await press(renderer, 'reset-submit');
    const passwordField = renderer.root.find(
      node => node.props.label === en.auth.password && typeof node.props.error === 'string',
    );
    expect(passwordField.props.error).toBe(en.errors.codes.PASSWORD_TOO_COMMON);
  });

  it('asks for the 6-digit code before sending anything', async () => {
    const { renderer } = await render(ResetPasswordScreen as never, { email: EMAIL });
    await fill(renderer, '123');
    await press(renderer, 'reset-submit');
    expect(authMocks.resetPassword).not.toHaveBeenCalled();
    expect(texts(renderer)).toContain(en.auth.errors.codeFormat);
  });
});

describe('reset flow helpers', () => {
  it('cleanResetCode keeps up to six digits', () => {
    expect(cleanResetCode('12 34 56')).toBe('123456');
    expect(cleanResetCode('1234567')).toBe('123456');
    expect(cleanResetCode('abc')).toBe('');
    expect(RESET_CODE_LENGTH).toBe(6);
  });

  it('resetCodeFailureKey: expired at exactly the TTL, used up at the attempt limit', () => {
    const now = 1_000_000_000;
    const ttl = RESET_CODE_TTL_MINUTES * 60 * 1000;
    expect(resetCodeFailureKey(1, now - ttl + 1, now)).toBe('auth.errors.codeWrong');
    expect(resetCodeFailureKey(1, now - ttl, now)).toBe('auth.errors.codeExpired');
    expect(resetCodeFailureKey(RESET_CODE_MAX_ATTEMPTS - 1, undefined, now)).toBe('auth.errors.codeWrong');
    expect(resetCodeFailureKey(RESET_CODE_MAX_ATTEMPTS, undefined, now)).toBe('auth.errors.codeUsedUp');
  });

  it('holds a dev code only in development builds and only if it looks like a code', () => {
    holdDevResetCode('12345a');
    expect(takeDevResetCode()).toBe('');
    holdDevResetCode(undefined);
    expect(takeDevResetCode()).toBe('');

    const dev = (globalThis as unknown as { __DEV__: boolean }).__DEV__;
    (globalThis as unknown as { __DEV__: boolean }).__DEV__ = false;
    try {
      holdDevResetCode('042917');
      expect(takeDevResetCode()).toBe('');
    } finally {
      (globalThis as unknown as { __DEV__: boolean }).__DEV__ = dev;
    }
  });

  it('the API client sends { email } and { email, code, password }', async () => {
    await requestPasswordResetApi({ email: EMAIL });
    await resetPasswordApi({ email: EMAIL, code: '123456', password: 'kribiLedger2026' });
    expect(apiRequestMock.mock.calls).toEqual([
      ['/auth/forgot-password', { method: 'POST', body: { email: EMAIL }, auth: false }],
      [
        '/auth/reset-password',
        { method: 'POST', body: { email: EMAIL, code: '123456', password: 'kribiLedger2026' }, auth: false },
      ],
    ]);
  });

  it.each(Object.entries(LOCALES))('%s states the code length, lifetime and try limit the API uses', (_, locale) => {
    const auth = locale.auth;
    expect(auth.forgotPasswordMessage).toContain(String(RESET_CODE_LENGTH));
    expect(auth.resetCodeSent).toContain(String(RESET_CODE_LENGTH));
    expect(auth.resetCodeSent).toContain(String(RESET_CODE_TTL_MINUTES));
    expect(auth.errors.codeFormat).toContain(String(RESET_CODE_LENGTH));
    expect(auth.errors.codeExpired).toContain(String(RESET_CODE_TTL_MINUTES));
    expect(locale.errors.codes.RESET_CODE_INVALID.length).toBeGreaterThan(0);
    // The old flow asked for names; nothing may still say so.
    expect(JSON.stringify(auth)).not.toMatch(/resetVerificationFailed|tokenInvalid/);
  });
});
