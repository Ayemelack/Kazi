import * as Keychain from 'react-native-keychain';

const SERVICE_NAME = 'com.kazi.app.auth';
// KZ-13: the refresh token lives in its own Keychain entry, so the access
// token can be replaced on every renewal without touching it.
const REFRESH_SERVICE_NAME = 'com.kazi.app.auth.refresh';

const OPTIONS = {
  accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
} as const;

export async function saveToken(token: string): Promise<boolean> {
  try {
    const result = await Keychain.setGenericPassword('kazi-auth', token, {
      service: SERVICE_NAME,
      ...OPTIONS,
    });
    return result !== false;
  } catch {
    return false;
  }
}

export async function getToken(): Promise<string | null> {
  try {
    const credentials = await Keychain.getGenericPassword({ service: SERVICE_NAME });
    return credentials ? credentials.password : null;
  } catch {
    return null;
  }
}

export async function clearToken(): Promise<void> {
  try {
    await Keychain.resetGenericPassword({ service: SERVICE_NAME });
  } catch {
    // Ignore reset failures; a missing credential is an acceptable outcome.
  }
}

export async function saveRefreshToken(refreshToken: string): Promise<boolean> {
  try {
    const result = await Keychain.setGenericPassword('kazi-refresh', refreshToken, {
      service: REFRESH_SERVICE_NAME,
      ...OPTIONS,
    });
    return result !== false;
  } catch {
    return false;
  }
}

export async function getRefreshToken(): Promise<string | null> {
  try {
    const credentials = await Keychain.getGenericPassword({ service: REFRESH_SERVICE_NAME });
    return credentials ? credentials.password : null;
  } catch {
    return null;
  }
}

export async function clearRefreshToken(): Promise<void> {
  try {
    await Keychain.resetGenericPassword({ service: REFRESH_SERVICE_NAME });
  } catch {
    // Ignore reset failures; a missing credential is an acceptable outcome.
  }
}

/** Stores the pair a sign-in or refresh returned. */
export async function saveSession(token: string, refreshToken: string): Promise<boolean> {
  const refreshSaved = await saveRefreshToken(refreshToken);
  const tokenSaved = await saveToken(token);
  return refreshSaved && tokenSaved;
}

/** Forgets the pair; the server session is revoked separately. */
export async function clearSession(): Promise<void> {
  await Promise.all([clearToken(), clearRefreshToken()]);
}
