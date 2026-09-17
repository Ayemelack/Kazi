/**
 * @format
 */

import { AppRegistry } from 'react-native';
import App from './App';
import { name as appName } from './app.json';
import { setupBackgroundHandler } from './src/notifications/service';

setupBackgroundHandler();

AppRegistry.registerComponent(appName, () => App);
