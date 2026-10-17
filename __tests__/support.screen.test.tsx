import React from 'react';
import { Linking } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';
import '../src/i18n';
import SupportScreen from '../src/screens/more/SupportScreen';

jest.mock('react-native-safe-area-context', () => {
  const ReactModule = require('react');
  const zero = { top: 0, right: 0, bottom: 0, left: 0 };
  const Context = ReactModule.createContext(zero);
  return {
    SafeAreaProvider: ({ children }: { children: React.ReactNode }) => children,
    SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
    SafeAreaConsumer: ({ children }: { children: (insets: typeof zero) => React.ReactNode }) =>
      children(zero),
    SafeAreaInsetsContext: Context,
    useSafeAreaInsets: () => zero,
    initialWindowMetrics: {
      frame: { x: 0, y: 0, width: 0, height: 0 },
      insets: zero,
    },
  };
});

const navigation = { goBack: jest.fn() } as never;

describe('SupportScreen', () => {
  it('opens the mail app with the support address when the email is pressed', async () => {
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true as never);

    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;
    await act(async () => {
      renderer = ReactTestRenderer.create(
        <SupportScreen navigation={navigation} route={{} as never} />,
      );
    });

    await act(async () => {
      renderer!.root.findByProps({ testID: 'support-email' }).props.onPress();
    });

    expect(openURL).toHaveBeenCalledWith('mailto:support@kazi.app');

    await act(async () => {
      renderer!.unmount();
    });
    openURL.mockRestore();
  });
});
