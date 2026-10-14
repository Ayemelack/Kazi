import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { ApiError } from '../errors/ApiError';
import { getJson, removeKey, setJson } from '../storage/app.storage';
import { clearToken, getToken, saveToken } from '../storage/secure.storage';
import {
  deleteAccount,
  fetchCurrentUser,
  logInAccount,
  logOutAccount,
  requestPasswordReset,
  resetPassword,
  signUpAccount,
  updateAccountNames,
  updateLanguage,
  updateProfile,
} from './api';
import { isAppLanguage, type AppLanguage } from '@kazi/shared';
import i18n, { loadStoredChoice, setAppLanguage } from '../i18n';
import { initializeNotifications, unregisterCurrentToken } from '../notifications/service';
import type {
  AccountNamesInput,
  ForgotPasswordInput,
  ForgotPasswordResult,
  LogInInput,
  ProfileInput,
  PublicUser,
  ResetPasswordInput,
  SignUpInput,
} from './types';

const USER_STORAGE_KEY = 'kazi.user';

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

export interface AuthContextValue {
  status: AuthStatus;
  user: PublicUser | null;
  hasBusiness: boolean;
  signUp: (input: SignUpInput) => Promise<void>;
  logIn: (input: LogInInput) => Promise<void>;
  logOut: () => Promise<void>;
  requestPasswordReset: (input: ForgotPasswordInput) => Promise<ForgotPasswordResult>;
  resetPassword: (input: ResetPasswordInput) => Promise<void>;
  completeBusinessProfile: (input: ProfileInput) => Promise<void>;
  updateAccountNames: (input: AccountNamesInput) => Promise<void>;
  deleteAccount: (password: string) => Promise<void>;
  changeLanguage: (language: AppLanguage) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// KZ-24: the language follows the account. The phone's own choice wins; a
// phone with no choice yet (new install) takes the one saved on the server.
async function adoptServerLanguage(user: PublicUser): Promise<void> {
  if (!isAppLanguage(user.language) || (await loadStoredChoice()) !== null) {
    return;
  }
  await setAppLanguage(user.language);
}

// Saving the language on the server is best effort: it never blocks or fails
// the switch on the phone.
function saveLanguageOnServer(language: string): void {
  if (isAppLanguage(language)) {
    updateLanguage(language).catch(() => {});
  }
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<PublicUser | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const token = await getToken();
      if (!token) {
        setStatus('unauthenticated');
        return;
      }

      const cachedUser = await getJson<PublicUser>(USER_STORAGE_KEY);

      try {
        const { user: freshUser } = await fetchCurrentUser();
        if (cancelled) {
          return;
        }
        await adoptServerLanguage(freshUser);
        setUser(freshUser);
        await setJson(USER_STORAGE_KEY, freshUser);
        setStatus('authenticated');
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          await clearToken();
          await removeKey(USER_STORAGE_KEY);
          if (!cancelled) {
            setUser(null);
            setStatus('unauthenticated');
          }
          return;
        }
        // Offline or server unavailable: keep the session going with the
        // cached profile so a flaky network never locks the user out.
        if (!cancelled) {
          setUser(cachedUser);
          setStatus('authenticated');
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (status === 'authenticated') {
      initializeNotifications().catch(() => {});
    }
  }, [status]);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user,
      hasBusiness: user?.hasBusiness ?? false,
      async signUp(input) {
        const result = await signUpAccount(input);
        await saveToken(result.token);
        await setJson(USER_STORAGE_KEY, result.user);
        // A new account starts in the language the app is showing.
        saveLanguageOnServer(i18n.language);
        setUser(result.user);
        setStatus('authenticated');
      },
      async logIn(input) {
        const result = await logInAccount(input);
        await saveToken(result.token);
        await adoptServerLanguage(result.user);
        await setJson(USER_STORAGE_KEY, result.user);
        setUser(result.user);
        setStatus('authenticated');
      },
      async logOut() {
        await unregisterCurrentToken().catch(() => {});
        logOutAccount().catch(() => {});
        await clearToken();
        await removeKey(USER_STORAGE_KEY);
        setUser(null);
        setStatus('unauthenticated');
      },
      requestPasswordReset,
      resetPassword: async input => {
        await resetPassword(input);
      },
      async completeBusinessProfile(input) {
        const { user: updated } = await updateProfile(input);
        await setJson(USER_STORAGE_KEY, updated);
        setUser(updated);
      },
      async updateAccountNames(input) {
        const { user: updated } = await updateAccountNames(input);
        await setJson(USER_STORAGE_KEY, updated);
        setUser(updated);
      },
      async deleteAccount(password) {
        // Delete first: a wrong password must leave the account, its session
        // and this phone's push registration exactly as they were.
        await deleteAccount(password);
        await unregisterCurrentToken().catch(() => {});
        logOutAccount().catch(() => {});
        await clearToken();
        await removeKey(USER_STORAGE_KEY);
        setUser(null);
        setStatus('unauthenticated');
      },
      async changeLanguage(language) {
        await setAppLanguage(language);
        if (status === 'authenticated') {
          saveLanguageOnServer(language);
        }
      },
    }),
    [status, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}