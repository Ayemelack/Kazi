// KZ-30: load React Native's lazily required modules before any test starts.
//
// react-native's index exposes most components through lazy getters, and a host
// component's ref pulls in the renderer's public-instance / DOM modules. On a
// cold transform cache, the first test that renders a screen used to pay for
// Babel-transforming all of them inside its own timeout and failed under load.
// Setup files are not timed, so loading them here moves that one-off cost out
// of the tests. With a warm cache this takes a few milliseconds per test file.
const React = require('react');
const ReactNative = require('react-native');
const { act, create } = require('react-test-renderer');

// Every runtime export the app imports from 'react-native' (plus the ones those
// components require lazily themselves).
[
  'AccessibilityInfo',
  'ActivityIndicator',
  'Animated',
  'AppState',
  'Easing',
  'FlatList',
  'I18nManager',
  'Image',
  'Keyboard',
  'KeyboardAvoidingView',
  'LayoutAnimation',
  'Modal',
  'NativeModules',
  'PermissionsAndroid',
  'Platform',
  'Pressable',
  'RefreshControl',
  'ScrollView',
  'StatusBar',
  'StyleSheet',
  'Switch',
  'Text',
  'TextInput',
  'View',
  'useWindowDimensions',
].forEach(name => ReactNative[name]);
ReactNative.Easing.bezier(0.42, 0, 0.58, 1);

const h = React.createElement;
const { FlatList, KeyboardAvoidingView, Modal, ScrollView, Text, TextInput, View } = ReactNative;

let renderer;
act(() => {
  renderer = create(
    h(
      KeyboardAvoidingView,
      null,
      h(
        ScrollView,
        null,
        h(View, { ref: () => {} }, h(Text, null, 'warm-up')),
        h(TextInput, { value: '' }),
        h(FlatList, { data: [1], renderItem: () => null, keyExtractor: String }),
      ),
      h(Modal, { visible: true }, h(View)),
    ),
  );
});
act(() => {
  renderer.unmount();
});
