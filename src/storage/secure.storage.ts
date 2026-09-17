import * as Keychain from 'react-native-keychain';

const SERVICE_NAME = 'com.kazi.app.auth';

export async function saveToken(token: string): Promise<boolean> {
  try {
    const result = await Keychain.setGenericPassword('kazi-auth', token, {
      service: SERVICE_NAME,
      accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
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