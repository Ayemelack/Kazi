// KZ-05: the app warns about easy-to-guess passwords as the user types, and a
// refusal from the API (which checks a longer list) shows under the field.
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import i18n from '../src/i18n';
import en from '../src/i18n/locales/en';
import fr from '../src/i18n/locales/fr';
import wes from '../src/i18n/locales/wes';
import { ToastProvider } from '../src/components/ui/Toast';
import SignupScreen from '../src/screens/auth/SignupScreen';
import { ApiError } from '../src/errors/ApiError';
import { errorField, errorMessage } from '../src/errors/messages';
import { validatePassword, validateResetPassword, validateSignup } from '../src/auth/validation';

const { signUpMock } = jest.requireMock('../src/auth/AuthContext') as { signUpMock: jest.Mock };

jest.mock('../src/auth/AuthContext', () => {
  const signUp = jest.fn(async () => undefined);
  return { signUpMock: signUp, useAuth: () => ({ signUp }) };
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

const tooCommon = new ApiError(400, 'too easy', 'PASSWORD_TOO_COMMON', {
  field: 'password',
  rule: 'notAllowed',
});

describe('validatePassword', () => {
  it.each(['Password123', 'qwerty123', 'Azerty2026', 'abcd1234', 'aaaa1111', 'trustno1', 'dragon99'])(
    'refuses %s as too common',
    password => {
      expect(validatePassword(password)).toBe('auth.errors.passwordTooCommon');
    },
  );

  it.each(['kaziShop2026', 'Mboa-Market7', 'x7Kp9mQ2'])('accepts %s', password => {
    expect(validatePassword(password)).toBeNull();
  });

  it('checks the basic rules first', () => {
    expect(validatePassword('pass1')).toBe('auth.errors.passwordMin');
    expect(validatePassword('password')).toBe('auth.errors.passwordNumber');
  });

  it('signup refuses a password containing the email local part or a name', () => {
    const base = { firstName: 'Mbango', lastName: 'Essomba', email: 'kribi.market@shop.cm' };
    expect(validateSignup({ ...base, password: 'ESSOMBA2026x' }).password).toBe(
      'auth.errors.passwordTooCommon',
    );
    expect(validateSignup({ ...base, password: 'mbango-77ledger' }).password).toBe(
      'auth.errors.passwordTooCommon',
    );
    expect(validateSignup({ ...base, password: 'Kribi.Market9' }).password).toBe(
      'auth.errors.passwordTooCommon',
    );
    expect(validateSignup({ ...base, password: 'mboaLedger2026' }).password).toBeUndefined();
  });

  it('reset uses the same list and patterns', () => {
    expect(validateResetPassword({ email: 'a@b.cm', code: '123456', password: 'Password123' }).password).toBe(
      'auth.errors.passwordTooCommon',
    );
  });
});

describe('PASSWORD_TOO_COMMON from the API', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('belongs to the password field', () => {
    expect(errorField(tooCommon)).toBe('password');
    // Other non-validation codes still have no field.
    expect(errorField(new ApiError(401, 'x', 'INVALID_CREDENTIALS', { field: 'password' }))).toBeUndefined();
  });

  it('is translated in every language and the old code is gone', () => {
    for (const locale of [en, fr, wes]) {
      const codes = locale.errors.codes as Record<string, string>;
      expect(codes.PASSWORD_TOO_COMMON).toEqual(expect.any(String));
      expect(codes.PASSWORD_NOT_ALLOWED).toBeUndefined();
      expect((locale.auth.errors as Record<string, string>).passwordTooCommon).toEqual(expect.any(String));
    }
    expect(errorMessage(tooCommon, i18n.t.bind(i18n))).toBe(en.errors.codes.PASSWORD_TOO_COMMON);
  });

  it('no copy in any language still advertises the old rule', () => {
    const text = JSON.stringify([en, fr, wes]).toLowerCase();
    expect(text).not.toMatch(/another account|autre compte/);
  });
});

const Tab = createBottomTabNavigator<Record<string, object | undefined>>();

function Blank() {
  return <Text>Blank</Text>;
}

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function renderSignup(): Promise<ReactTestRenderer.ReactTestRenderer> {
  let renderer: ReactTestRenderer.ReactTestRenderer | undefined;
  await act(async () => {
    renderer = ReactTestRenderer.create(
      <ToastProvider>
        <NavigationContainer>
          <Tab.Navigator initialRouteName="Signup" screenOptions={{ headerShown: false }}>
            <Tab.Screen name="Blank" component={Blank} />
            <Tab.Screen name="Signup" component={SignupScreen as never} />
          </Tab.Navigator>
        </NavigationContainer>
      </ToastProvider>,
    );
  });
  await flush();
  return renderer!;
}

function byTestID(renderer: ReactTestRenderer.ReactTestRenderer, testID: string) {
  return renderer.root.find(node => node.props.testID === testID && node.props.onChangeText);
}

describe('Signup screen', () => {
  it('shows the instant warning under the password field', async () => {
    const renderer = await renderSignup();
    await act(async () => {
      byTestID(renderer, 'signup-password').props.onChangeText('Password123');
    });
    await act(async () => {
      byTestID(renderer, 'signup-password').props.onBlur();
    });
    expect(byTestID(renderer, 'signup-password').props.error).toBe(en.auth.errors.passwordTooCommon);
  });

  it('shows the API refusal under the password field, in the current language', async () => {
    signUpMock.mockRejectedValueOnce(tooCommon);
    const renderer = await renderSignup();
    const fill: Array<[string, string]> = [
      ['signup-first-name', 'Ngum'],
      ['signup-last-name', 'Achu'],
      ['signup-email', 'ngum@shop.cm'],
      // On the server's list but not in the app's top 1000.
      ['signup-password', 'Wrinkle1'],
      ['signup-confirm', 'Wrinkle1'],
    ];
    for (const [id, value] of fill) {
      await act(async () => {
        byTestID(renderer, id).props.onChangeText(value);
      });
    }
    await act(async () => {
      renderer.root
        .find(node => node.props.testID === 'signup-submit' && node.props.accessibilityState)
        .props.onPress();
    });
    await flush();
    expect(signUpMock).toHaveBeenCalledTimes(1);
    expect(byTestID(renderer, 'signup-password').props.error).toBe(en.errors.codes.PASSWORD_TOO_COMMON);

    await act(async () => {
      await i18n.changeLanguage('fr');
    });
    expect(byTestID(renderer, 'signup-password').props.error).toBe(fr.errors.codes.PASSWORD_TOO_COMMON);
  });
});
