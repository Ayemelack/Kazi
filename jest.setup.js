// The native module is not compiled for tests. Node's crypto already provides
// getRandomValues, so the polyfill only has to exist, not do anything.
jest.mock('react-native-get-random-values', () => ({
  getRandomValues: (array) => require('crypto').randomFillSync(array),
}));

jest.mock('react-native-localize', () => ({
  getLocales: () => [{ countryCode: 'US', languageCode: 'en', languageTag: 'en-US', isRTL: false }],
  getNumberFormatSettings: () => ({
    decimalSeparator: '.',
    groupingSeparator: ',',
  }),
  getCalendar: () => 'gregorian',
  getCountry: () => 'US',
  getCurrencies: () => ['USD'],
  getTemperatureUnit: () => 'celsius',
  getTimeZone: () => 'America/New_York',
  uses24HourClock: () => false,
  usesMetricSystem: () => false,
  findBestAvailableLanguage: () => ({ languageTag: 'en-US', isRTL: false }),
}));

jest.mock('react-native-keychain', () => {
  const store = {};
  return {
    ACCESSIBLE: { WHEN_UNLOCKED_THIS_DEVICE_ONLY: '1' },
    ACCESS_CONTROL: {
      BIOMETRY_ANY: 'BiometryAny',
      BIOMETRY_CURRENT_SET: 'BiometryCurrentSet',
      DEVICE_PASSCODE: 'DevicePasscode',
    },
    AUTHENTICATION_TYPE: {
      BIOMETRICS: 'AuthenticationWithBiometrics',
      DEVICE_PASSCODE_OR_BIOMETRICS: 'AuthenticationWithDevicePasscode',
    },
    BIOMETRY_TYPE: {
      TOUCH_ID: 'TouchId',
      FACE_ID: 'FaceId',
      FINGERPRINT: 'Fingerprint',
      FACE: 'Face',
      IRIS: 'Iris',
      OPTIC_ID: 'OpticId',
    },
    setGenericPassword: jest.fn(async (username, password, options = {}) => {
      store[options.service || 'default'] = { username, password };
      return { service: options.service || 'default', storage: 'keychain' };
    }),
    getGenericPassword: jest.fn(async (options = {}) => {
      const entry = store[options.service || 'default'];
      return entry ? { ...entry, service: options.service || 'default', storage: 'keychain' } : false;
    }),
    hasGenericPassword: jest.fn(async (options = {}) =>
      Boolean(store[options.service || 'default']),
    ),
    resetGenericPassword: jest.fn(async (options = {}) => {
      delete store[options.service || 'default'];
      return true;
    }),
    getSupportedBiometryType: jest.fn(async () => null),
    __reset: () => {
      Object.keys(store).forEach(key => {
        delete store[key];
      });
    },
  };
});

jest.mock('@react-native-async-storage/async-storage', () => {
  const store = {};
  return {
    __esModule: true,
    default: {
      getItem: jest.fn(async key => (key in store ? store[key] : null)),
      setItem: jest.fn(async (key, value) => {
        store[key] = value;
      }),
      removeItem: jest.fn(async key => {
        delete store[key];
      }),
    },
  };
});

jest.mock('@notifee/react-native', () => ({
  __esModule: true,
  default: {
    createChannel: jest.fn(async () => 'kazi'),
    displayNotification: jest.fn(async () => 'notification-id'),
    requestPermission: jest.fn(async () => ({ authorizationStatus: 1 })),
    onForegroundEvent: jest.fn(),
    onBackgroundEvent: jest.fn(async () => undefined),
    getInitialNotification: jest.fn(async () => null),
    createTriggerNotification: jest.fn(async () => 'kazi-daily-reminder'),
    cancelNotification: jest.fn(async () => undefined),
    getTriggerNotifications: jest.fn(async () => []),
  },
  AndroidImportance: { DEFAULT: 3, HIGH: 4 },
  AndroidVisibility: { PRIVATE: 0, PUBLIC: 1, SECRET: -1 },
  EventType: { PRESS: 1 },
  TriggerType: { TIMESTAMP: 0 },
  RepeatFrequency: { HOURLY: 0, DAILY: 1, WEEKLY: 2 },
}));

jest.mock('@react-native-firebase/app', () => ({
  __esModule: true,
  getApps: jest.fn(() => [
    { name: '[DEFAULT]', options: { projectId: 'kazi-test', messagingSenderId: '123456789012' } },
  ]),
}));

jest.mock('@react-native-firebase/messaging', () => ({
  __esModule: true,
  getMessaging: jest.fn(() => ({})),
  getToken: jest.fn(async () => 'test-fcm-token'),
  isAutoInitEnabled: jest.fn(() => false),
  setAutoInitEnabled: jest.fn(async () => undefined),
  onMessage: jest.fn(),
  onTokenRefresh: jest.fn(),
  setBackgroundMessageHandler: jest.fn(),
}));

// NetInfo (KZ-01): online by default. Tests drive changes by calling the
// listener passed to addEventListener, or by stubbing refresh().
jest.mock('@react-native-community/netinfo', () => {
  const online = {
    type: 'wifi',
    isConnected: true,
    isInternetReachable: true,
    details: null,
  };
  return {
    __esModule: true,
    default: {
      configure: jest.fn(),
      fetch: jest.fn(async () => online),
      refresh: jest.fn(async () => online),
      addEventListener: jest.fn(() => jest.fn()),
      useNetInfo: jest.fn(() => online),
    },
  };
});

jest.mock('react-native-image-picker', () => ({
  launchImageLibrary: jest.fn(async () => ({
    didCancel: true,
    errorCode: undefined,
    assets: undefined,
  })),
}));