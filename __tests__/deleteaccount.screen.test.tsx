// KZ-20: deleting the account asks for the password inside the confirm step.
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import i18n from '../src/i18n';
import en from '../src/i18n/locales/en';
import fr from '../src/i18n/locales/fr';
import wes from '../src/i18n/locales/wes';
import DeleteAccountScreen from '../src/screens/more/DeleteAccountScreen';
import { ApiError } from '../src/errors/ApiError';

const { deleteAccountMock } = jest.requireMock('../src/auth/AuthContext') as {
  deleteAccountMock: jest.Mock;
};
const { apiRequestMock } = jest.requireMock('../src/api/client') as { apiRequestMock: jest.Mock };

jest.mock('../src/auth/AuthContext', () => {
  const deleteAccount = jest.fn(async () => undefined);
  return { deleteAccountMock: deleteAccount, useAuth: () => ({ deleteAccount }) };
});

jest.mock('../src/api/client', () => {
  const apiRequest = jest.fn(async () => undefined);
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

async function render(): Promise<Renderer> {
  let renderer: Renderer | undefined;
  await act(async () => {
    renderer = ReactTestRenderer.create(
      <NavigationContainer>
        <Tab.Navigator initialRouteName="Delete" screenOptions={{ headerShown: false }}>
          <Tab.Screen name="Blank" component={Blank} />
          <Tab.Screen name="Delete" component={DeleteAccountScreen as never} />
        </Tab.Navigator>
      </NavigationContainer>,
    );
  });
  await flush();
  return renderer!;
}

function pressable(renderer: Renderer, testID: string) {
  return renderer.root.find(node => node.props.testID === testID && node.props.accessibilityState);
}

function passwordField(renderer: Renderer) {
  return renderer.root.find(
    node => node.props.testID === 'delete-account-password' && node.props.onChangeText,
  );
}

function errorText(renderer: Renderer): string | null {
  const found = renderer.root.findAll(
    node => node.type === Text && node.props.testID === 'delete-account-error',
  );
  return found.length > 0 ? [found[0]!.props.children].flat().join('') : null;
}

async function press(renderer: Renderer, testID: string) {
  await act(async () => {
    pressable(renderer, testID).props.onPress();
  });
  await flush();
}

async function type(renderer: Renderer, value: string) {
  await act(async () => {
    passwordField(renderer).props.onChangeText(value);
  });
}

beforeEach(() => {
  deleteAccountMock.mockReset();
  deleteAccountMock.mockResolvedValue(undefined);
});

afterEach(async () => {
  await i18n.changeLanguage('en');
});

it('the password field is part of the confirm step', async () => {
  const renderer = await render();
  expect(renderer.root.findAll(node => node.props.testID === 'delete-account-password')).toHaveLength(0);
  await press(renderer, 'delete-account-open');
  expect(passwordField(renderer).props.secure).toBe(true);
});

it('an empty password shows why and sends nothing', async () => {
  const renderer = await render();
  await press(renderer, 'delete-account-open');
  await press(renderer, 'delete-account-confirm');
  expect(deleteAccountMock).not.toHaveBeenCalled();
  expect(passwordField(renderer).props.error).toBe(en.auth.errors.required);
});

it('a wrong password keeps the dialog open with a translated reason', async () => {
  deleteAccountMock.mockRejectedValueOnce(new ApiError(401, 'bad', 'INVALID_CREDENTIALS'));
  const renderer = await render();
  await press(renderer, 'delete-account-open');
  await type(renderer, 'not-my-password1');
  await press(renderer, 'delete-account-confirm');

  expect(deleteAccountMock).toHaveBeenCalledWith('not-my-password1');
  expect(errorText(renderer)).toBe(en.deleteAccount.wrongPassword);
  expect(passwordField(renderer)).toBeDefined();

  for (const [language, locale] of [['fr', fr], ['wes', wes]] as const) {
    await act(async () => {
      await i18n.changeLanguage(language);
    });
    expect(errorText(renderer)).toBe(locale.deleteAccount.wrongPassword);
  }
});

it('the right password deletes with that password', async () => {
  const renderer = await render();
  await press(renderer, 'delete-account-open');
  await type(renderer, 'mboaLedger2026');
  await press(renderer, 'delete-account-confirm');
  expect(deleteAccountMock).toHaveBeenCalledWith('mboaLedger2026');
  expect(errorText(renderer)).toBeNull();
});

it('cancel clears the typed password', async () => {
  const renderer = await render();
  await press(renderer, 'delete-account-open');
  await type(renderer, 'half-typed');
  const cancel = renderer.root.find(
    node => node.props.label === en.common.cancel && typeof node.props.onPress === 'function',
  );
  await act(async () => {
    cancel.props.onPress();
  });
  await press(renderer, 'delete-account-open');
  expect(passwordField(renderer).props.value).toBe('');
});

it('the API call sends the password in the DELETE body', async () => {
  const { deleteAccount } = jest.requireActual('../src/auth/api') as typeof import('../src/auth/api');
  await deleteAccount('mboaLedger2026');
  expect(apiRequestMock).toHaveBeenCalledWith('/auth/me', {
    method: 'DELETE',
    body: { password: 'mboaLedger2026' },
    auth: true,
  });
});

it('every new string exists in all three languages', () => {
  for (const locale of [en, fr, wes]) {
    for (const key of ['passwordLabel', 'passwordPrompt', 'wrongPassword'] as const) {
      expect(locale.deleteAccount[key]).toEqual(expect.any(String));
    }
  }
});
