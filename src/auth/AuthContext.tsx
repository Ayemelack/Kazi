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
  updateProfile,
} from './api';
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
  deleteAccount: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

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
        setUser(result.user);
        setStatus('authenticated');
      },
      async logIn(input) {
        const result = await logInAccount(input);
        await saveToken(result.token);
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
      async deleteAccount() {
        await unregisterCurrentToken().catch(() => {});
        await deleteAccount();
        logOutAccount().catch(() => {});
        await clearToken();
        await removeKey(USER_STORAGE_KEY);
        setUser(null);
        setStatus('unauthenticated');
      },
    }),
    [status, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}