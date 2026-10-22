/**
 * @format
 */

// Must load before anything that needs a secure random source: App Lock salts
// use crypto.getRandomValues, which React Native does not provide on its own.
import 'react-native-get-random-values';
import { AppRegistry } from 'react-native';
import App from './App';
import { name as appName } from './app.json';
import { setupBackgroundHandler, setupBackgroundOpenHandler } from './src/notifications/service';

// Push is optional: a Firebase problem disables it but never stops the app
// from registering (KZ-02). The setup functions already guard themselves; the
// try/catch is the last line of defence for these module-load calls.
try {
  setupBackgroundHandler();
  setupBackgroundOpenHandler();
} catch {
  // Push stays disabled for this session.
}

AppRegistry.registerComponent(appName, () => App);
