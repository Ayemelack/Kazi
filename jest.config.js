module.exports = {
  preset: '@react-native/jest-preset',
  setupFiles: ['./jest.setup.js'],
  testPathIgnorePatterns: ['/node_modules/', '/server/', '/shared/'],
  moduleNameMapper: {
    '^lucide-react-native$': '<rootDir>/__mocks__/lucide-react-native.js',
  },
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|@react-navigation|react-native-screens|react-native-safe-area-context|react-native-keychain|react-native-localize|react-native-image-picker|@react-native-async-storage|lucide-react-native|react-native-svg|i18next|react-i18next|@egjs|react-freeze)/)',
  ],
};