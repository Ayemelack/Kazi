/**
 * @format
 */

import { AppRegistry } from 'react-native';
import App from './App';
import { name as appName } from './app.json';
import { setupBackgroundHandler } from './src/notifications/service';

// Push is optional: a Firebase problem disables it but never stops the app
// from registering (KZ-02). setupBackgroundHandler already guards itself; the
// try/catch is the last line of defence for this module-load call.
try {
  setupBackgroundHandler();
} catch {
  // Push stays disabled for this session.
}

AppRegistry.registerComponent(appName, () => App);
