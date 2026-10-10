const path = require('path');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const config = {
  // @kazi/shared is a file: dependency, so node_modules/@kazi/shared is a
  // symlink to ./shared. Metro 0.87 follows symlinks and package "exports" by
  // default; the real path must be watched. The app consumes the built dist/,
  // so run `npm run build` in shared/ after editing it.
  watchFolders: [path.resolve(__dirname, 'shared')],
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
