// The keychain mock in jest.setup.js keeps an in-memory store. Clear it between
// tests so a token saved in one test never leaks into the next.
beforeEach(() => {
  require('react-native-keychain').__reset();
});
