import { NativeModules, Platform } from 'react-native';

// Fallback LAN IP used when the scriptURL cannot be resolved (e.g. iOS
// simulator, production builds). Update this if your laptop's LAN IP changes.
const FALLBACK_DEV_HOST = '192.168.1.163';

function devHost(): string {
  if (Platform.OS === 'ios') {
    return 'localhost';
  }

  try {
    const scriptURL: string | undefined =
      NativeModules?.SourceCode?.scriptURL ??
      NativeModules?.DevSettings?.getScriptURL?.();
    if (typeof scriptURL === 'string' && scriptURL.length > 0) {
      const host = new URL(scriptURL).hostname;
      if (host && host !== 'localhost' && host !== '127.0.0.1') {
        return host;
      }
    }
  } catch {
    // NativeModules may not be available in tests or unusual environments.
  }

  return FALLBACK_DEV_HOST;
}

const DEV_API_HOST = devHost();

const DEV_API_URL = Platform.select({
  android: `http://${DEV_API_HOST}:4000`,
  ios: `http://localhost:4000`,
  default: `http://${DEV_API_HOST}:4000`,
});

const PROD_API_URL = 'https://api.kazi.app';

export const env = {
  API_BASE_URL: __DEV__ ? DEV_API_URL : PROD_API_URL,
  API_TIMEOUT_MS: 15000,
};
