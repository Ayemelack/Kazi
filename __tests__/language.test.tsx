// KZ-24: Pidgin is "wes" (ISO 639-3 for Cameroonian Pidgin), dates use a
// formatting locale separate from the language code, and the choice follows
// the account.
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import i18n, { formattingLocale, loadStoredChoice, loadStoredLanguage } from '../src/i18n';
import DatePickerModal from '../src/components/ui/DatePickerModal';
import { AuthProvider, useAuth, type AuthContextValue } from '../src/auth/AuthContext';
import { logInAccount, signUpAccount, updateLanguage } from '../src/auth/api';
import type { PublicUser } from '../src/auth/types';

jest.mock('../src/auth/api', () => ({
  fetchCurrentUser: jest.fn(),
  logInAccount: jest.fn(),
  signUpAccount: jest.fn(),
  logOutAccount: jest.fn(async () => undefined),
  updateLanguage: jest.fn(),
  deleteAccount: jest.fn(),
  requestPasswordReset: jest.fn(),
  resetPassword: jest.fn(),
  updateAccountNames: jest.fn(),
  updateProfile: jest.fn(),
}));

jest.mock('../src/notifications/service', () => ({
  initializeNotifications: jest.fn(async () => undefined),
  unregisterCurrentToken: jest.fn(async () => undefined),
}));

const KEY = 'kazi.language';

function user(language: string): PublicUser {
  return {
    id: 1,
    firstName: 'Awa',
    lastName: 'Fon',
    companyName: 'Shop',
    businessType: 'Retail',
    hasBusiness: true,
    email: 'awa@example.cm',
    language,
  };
}

async function stored(): Promise<unknown> {
  const raw = await AsyncStorage.getItem(KEY);
  return raw === null ? null : JSON.parse(raw);
}

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.removeItem(KEY);
  await act(async () => {
    await i18n.changeLanguage('en');
  });
});

describe('language codes', () => {
  it('uses wes for Pidgin and migrates a stored "pid" choice', async () => {
    await AsyncStorage.setItem(KEY, JSON.stringify('pid'));
    await expect(loadStoredChoice()).resolves.toBe('wes');
    await expect(stored()).resolves.toBe('wes');
    await expect(loadStoredLanguage()).resolves.toBe('wes');
  });

  it('falls back to the device language when nothing valid is stored', async () => {
    await expect(loadStoredChoice()).resolves.toBeNull();
    await expect(loadStoredLanguage()).resolves.toBe('en');
    await AsyncStorage.setItem(KEY, JSON.stringify('xx'));
    await expect(loadStoredChoice()).resolves.toBeNull();
  });

  it('has Pidgin translations under wes', async () => {
    await act(async () => {
      await i18n.changeLanguage('wes');
    });
    expect(i18n.t('common.retry')).toBe('Try am again');
    expect(i18n.t('products.itemCount', { count: 1 })).not.toContain('products.');
  });

  it('formats dates with a locale separate from the language code', () => {
    expect(formattingLocale('en')).toBe('en-CM');
    expect(formattingLocale('fr')).toBe('fr-CM');
    expect(formattingLocale('wes')).toBe('en-CM');
    expect(formattingLocale('pid')).toBe('en-CM');

    const day = new Date(2026, 0, 15);
    const month = (lng: string) => day.toLocaleDateString(formattingLocale(lng), { month: 'long' });
    expect(month('en')).toBe('January');
    expect(month('fr')).toBe('janvier');
    expect(month('wes')).toBe('January');
  });
});

describe('date picker', () => {
  it('re-labels the month when the language changes', async () => {
    let renderer!: ReactTestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = ReactTestRenderer.create(
        <DatePickerModal visible value="2026-01-15" onSelect={() => undefined} onClose={() => undefined} />,
      );
    });
    const text = () =>
      renderer.root
        .findAllByType(Text)
        .map(node => [node.props.children].flat(Infinity).join(''))
        .join('|');

    expect(text()).toContain('January 2026');
    await act(async () => {
      await i18n.changeLanguage('fr');
    });
    expect(text()).toContain('janvier 2026');
    await act(async () => {
      await i18n.changeLanguage('wes');
    });
    expect(text()).toContain('January 2026');
  });
});

describe('language follows the account', () => {
  async function renderAuth(): Promise<{ current: () => AuthContextValue }> {
    let value!: AuthContextValue;
    function Probe() {
      value = useAuth();
      return null;
    }
    await act(async () => {
      ReactTestRenderer.create(
        <AuthProvider>
          <Probe />
        </AuthProvider>,
      );
    });
    return { current: () => value };
  }

  it('after login, a phone with no saved choice takes the server language', async () => {
    (logInAccount as jest.Mock).mockResolvedValue({ token: 't', refreshToken: 'r', user: user('wes') });
    const auth = await renderAuth();
    await act(async () => {
      await auth.current().logIn({ email: 'awa@example.cm', password: 'secret123' });
    });

    expect(i18n.language).toBe('wes');
    await expect(stored()).resolves.toBe('wes');
  });

  it('after login, the phone keeps a choice it already has', async () => {
    await AsyncStorage.setItem(KEY, JSON.stringify('fr'));
    await act(async () => {
      await i18n.changeLanguage('fr');
    });
    (logInAccount as jest.Mock).mockResolvedValue({ token: 't', refreshToken: 'r', user: user('wes') });
    const auth = await renderAuth();
    await act(async () => {
      await auth.current().logIn({ email: 'awa@example.cm', password: 'secret123' });
    });

    expect(i18n.language).toBe('fr');
  });

  it('saves a language change on the server without waiting for it or failing', async () => {
    (logInAccount as jest.Mock).mockResolvedValue({ token: 't', refreshToken: 'r', user: user('en') });
    let rejectServer!: (err: Error) => void;
    (updateLanguage as jest.Mock).mockReturnValue(
      new Promise((_, reject) => {
        rejectServer = reject;
      }),
    );
    const auth = await renderAuth();
    await act(async () => {
      await auth.current().logIn({ email: 'awa@example.cm', password: 'secret123' });
    });

    await act(async () => {
      await auth.current().changeLanguage('fr');
    });
    // Switched and saved on the phone while the server call is still pending.
    expect(i18n.language).toBe('fr');
    await expect(stored()).resolves.toBe('fr');
    expect(updateLanguage).toHaveBeenCalledWith('fr');

    await act(async () => {
      rejectServer(new Error('offline'));
    });
    expect(i18n.language).toBe('fr');
  });

  it('a new account is saved with the language the app is showing', async () => {
    await act(async () => {
      await i18n.changeLanguage('fr');
    });
    (signUpAccount as jest.Mock).mockResolvedValue({ token: 't', refreshToken: 'r', user: user('en') });
    (updateLanguage as jest.Mock).mockResolvedValue({ user: user('fr') });
    const auth = await renderAuth();
    await act(async () => {
      await auth.current().signUp({
        firstName: 'Awa',
        lastName: 'Fon',
        email: 'awa@example.cm',
        password: 'secret123',
      });
    });

    expect(updateLanguage).toHaveBeenCalledWith('fr');
  });

  it('does not call the server when switching language signed out', async () => {
    const auth = await renderAuth();
    await act(async () => {
      await auth.current().changeLanguage('wes');
    });
    expect(i18n.language).toBe('wes');
    expect(updateLanguage).not.toHaveBeenCalled();
  });
});
