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

jest.mock('react-native-keychain', () => ({
  ACCESSIBLE: { WHEN_UNLOCKED_THIS_DEVICE_ONLY: '1' },
  setGenericPassword: jest.fn(async () => ({ service: 'kazi', storage: 'keychain' })),
  getGenericPassword: jest.fn(async () => false),
  resetGenericPassword: jest.fn(async () => true),
}));

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
  },
  AndroidImportance: { DEFAULT: 3, HIGH: 4 },
  EventType: { PRESS: 1 },
}));

jest.mock('@react-native-firebase/messaging', () => ({
  __esModule: true,
  getMessaging: jest.fn(() => ({})),
  getToken: jest.fn(async () => 'test-fcm-token'),
  onMessage: jest.fn(),
  onTokenRefresh: jest.fn(),
  setBackgroundMessageHandler: jest.fn(),
}));

jest.mock('react-native-image-picker', () => ({
  launchImageLibrary: jest.fn(async () => ({
    didCancel: true,
    errorCode: undefined,
    assets: undefined,
  })),
}));