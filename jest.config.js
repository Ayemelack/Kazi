module.exports = {
  preset: '@react-native/jest-preset',
  // Only crawl the app's own code. Without watchman (Windows, CI) Jest walks
  // every file under each root to build its haste map; server/, shared/ and
  // the native folders hold tens of thousands of files that no app test uses.
  roots: ['<rootDir>/__tests__', '<rootDir>/src', '<rootDir>/__mocks__'],
  setupFiles: ['./jest.setup.js'],
  // KZ-30: preload React Native's lazily required modules outside any test's
  // timeout, and unmount rendered trees after each test so their timers stop.
  setupFilesAfterEnv: ['./jest/preloadReactNative.js', './jest/unmountAfterEach.js'],
  // Headroom for slow, loaded machines; a cold transform cache no longer lands
  // inside a test (see jest/preloadReactNative.js).
  testTimeout: 30000,
  testPathIgnorePatterns: ['/node_modules/', '/server/', '/shared/'],
  moduleNameMapper: {
    '^lucide-react-native$': '<rootDir>/__mocks__/lucide-react-native.js',
  },
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|@react-navigation|react-native-screens|react-native-safe-area-context|react-native-keychain|react-native-localize|react-native-image-picker|@react-native-async-storage|lucide-react-native|react-native-svg|i18next|react-i18next|@egjs|react-freeze)/)',
  ],
};
