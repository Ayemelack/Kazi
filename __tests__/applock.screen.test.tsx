import React from 'react';
import { Text } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';
import * as Keychain from 'react-native-keychain';
import i18n from '../src/i18n';
import AppLockScreen from '../src/screens/more/AppLockScreen';
import AppLockUnlockScreen from '../src/screens/applock/AppLockUnlockScreen';
import { AppLockProvider, useAppLock } from '../src/applock/AppLockContext';
import { ToastProvider } from '../src/components/ui/Toast';
import { configureFingerprint, configureSecret, loadConfig } from '../src/applock/storage';

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

const CONFIG_SERVICE = 'com.kazi.app.lock';

const navigation = { goBack: jest.fn() } as never;

const mounted: ReactTestRenderer.ReactTestRenderer[] = [];

afterEach(() => {
  act(() => {
    mounted.splice(0).forEach(renderer => {
      renderer.unmount();
    });
  });
  jest.clearAllMocks();
});

async function flush(): Promise<void> {
  for (let i = 0; i < 8; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function render(node: React.ReactElement): Promise<ReactTestRenderer.ReactTestRenderer> {
  let renderer: ReactTestRenderer.ReactTestRenderer | undefined;
  await act(async () => {
    renderer = ReactTestRenderer.create(node);
  });
  await flush();
  mounted.push(renderer!);
  return renderer!;
}

async function changeText(
  renderer: ReactTestRenderer.ReactTestRenderer,
  testID: string,
  value: string,
): Promise<void> {
  await act(async () => {
    renderer.root.findByProps({ testID }).props.onChangeText(value);
  });
}

async function press(renderer: ReactTestRenderer.ReactTestRenderer, testID: string): Promise<void> {
  await act(async () => {
    await renderer.root.findByProps({ testID }).props.onPress();
  });
  await flush();
}

function texts(renderer: ReactTestRenderer.ReactTestRenderer): string[] {
  return renderer.root
    .findAllByType(Text)
    .map(node => node.props.children)
    .filter((value): value is string => typeof value === 'string');
}

function UnlockWhenReady() {
  const { ready } = useAppLock();
  return ready ? <AppLockUnlockScreen /> : null;
}

beforeEach(async () => {
  jest.clearAllMocks();
  (Keychain.getSupportedBiometryType as jest.Mock).mockResolvedValue(null);
  await Keychain.resetGenericPassword({ service: CONFIG_SERVICE });
});

describe('AppLockScreen', () => {
  it('does not start configuration or activation when the toggle is switched on', async () => {
    const renderer = await render(
      <AppLockProvider>
        <ToastProvider>
          <AppLockScreen navigation={navigation} route={{} as never} />
        </ToastProvider>
      </AppLockProvider>,
    );

    await act(async () => {
      renderer.root.findByProps({ testID: 'applock-toggle' }).props.onValueChange(true);
    });
    await flush();

    expect(renderer.root.findAllByProps({ testID: 'applock-first' })).toHaveLength(0);
    expect(renderer.root.findByProps({ testID: 'applock-toggle' }).props.value).toBe(true);
    expect((await loadConfig()).enabled).toBe(false);
  });

  it('enables App Lock with a PIN only after the user selects a method and saves', async () => {
    const renderer = await render(
      <AppLockProvider>
        <ToastProvider>
          <AppLockScreen navigation={navigation} route={{} as never} />
        </ToastProvider>
      </AppLockProvider>,
    );

    await act(async () => {
      renderer.root.findByProps({ testID: 'applock-toggle' }).props.onValueChange(true);
    });
    await flush();

    await press(renderer, 'applock-method-pin');
    expect((await loadConfig()).enabled).toBe(false);

    await changeText(renderer, 'applock-first', '1234');
    await changeText(renderer, 'applock-second', '1234');
    await press(renderer, 'applock-save');

    expect((await loadConfig()).enabled).toBe(true);
    expect(Keychain.setGenericPassword).toHaveBeenCalledWith(
      'kazi-lock',
      expect.stringContaining('"enabled":true'),
      expect.objectContaining({ service: CONFIG_SERVICE }),
    );
    expect(renderer.root.findByProps({ testID: 'applock-change-secret' })).toBeTruthy();
  });

  it('enables fingerprint without requiring a PIN or password', async () => {
    (Keychain.getSupportedBiometryType as jest.Mock).mockResolvedValue('Fingerprint');

    const renderer = await render(
      <AppLockProvider>
        <ToastProvider>
          <AppLockScreen navigation={navigation} route={{} as never} />
        </ToastProvider>
      </AppLockProvider>,
    );

    await act(async () => {
      renderer.root.findByProps({ testID: 'applock-toggle' }).props.onValueChange(true);
    });
    await flush();

    await press(renderer, 'applock-method-fingerprint');
    expect(renderer.root.findAllByProps({ testID: 'applock-first' })).toHaveLength(0);
    expect(renderer.root.findAllByProps({ testID: 'applock-second' })).toHaveLength(0);

    await press(renderer, 'applock-save');

    const config = await loadConfig();
    expect(config.enabled).toBe(true);
    expect(config.method).toBe('fingerprint');
    expect(config.hash).toBeNull();
  });

  it('rejects mismatched PINs before saving', async () => {
    const renderer = await render(
      <AppLockProvider>
        <ToastProvider>
          <AppLockScreen navigation={navigation} route={{} as never} />
        </ToastProvider>
      </AppLockProvider>,
    );

    await act(async () => {
      renderer.root.findByProps({ testID: 'applock-toggle' }).props.onValueChange(true);
    });
    await flush();

    await press(renderer, 'applock-method-pin');
    await changeText(renderer, 'applock-first', '1234');
    await changeText(renderer, 'applock-second', '4321');
    await press(renderer, 'applock-save');

    expect(Keychain.setGenericPassword).not.toHaveBeenCalled();
    expect(texts(renderer)).toContain(i18n.t('appLock.pinMismatch'));
  });

  it('verifies the secret before turning App Lock off', async () => {
    await configureSecret({ method: 'pin', secretKind: 'pin', secret: '1234' });

    const renderer = await render(
      <AppLockProvider>
        <ToastProvider>
          <AppLockScreen navigation={navigation} route={{} as never} />
        </ToastProvider>
      </AppLockProvider>,
    );

    await act(async () => {
      renderer.root.findByProps({ testID: 'applock-toggle' }).props.onValueChange(false);
    });
    await flush();

    await changeText(renderer, 'applock-verify-input', '1234');
    await press(renderer, 'applock-verify-submit');

    expect((await loadConfig()).enabled).toBe(false);
  });

  it('does not turn off App Lock when the wrong secret is entered', async () => {
    await configureSecret({ method: 'pin', secretKind: 'pin', secret: '1234' });

    const renderer = await render(
      <AppLockProvider>
        <ToastProvider>
          <AppLockScreen navigation={navigation} route={{} as never} />
        </ToastProvider>
      </AppLockProvider>,
    );

    await act(async () => {
      renderer.root.findByProps({ testID: 'applock-toggle' }).props.onValueChange(false);
    });
    await flush();

    await changeText(renderer, 'applock-verify-input', '0000');
    await press(renderer, 'applock-verify-submit');

    expect((await loadConfig()).enabled).toBe(true);
    expect(texts(renderer)).toContain(i18n.t('appLock.wrongSecret'));
  });
});

describe('AppLockUnlockScreen', () => {
  it('does not offer fingerprint unlock for a PIN configuration even when biometrics exist', async () => {
    (Keychain.getSupportedBiometryType as jest.Mock).mockResolvedValue('Fingerprint');
    await configureSecret({ method: 'pin', secretKind: 'pin', secret: '1234' });

    const renderer = await render(
      <AppLockProvider>
        <UnlockWhenReady />
      </AppLockProvider>,
    );

    expect(renderer.root.findByProps({ testID: 'applock-secret-input' })).toBeTruthy();
    expect(renderer.root.findAllByProps({ testID: 'applock-biometric' })).toHaveLength(0);
    expect(renderer.root.findAllByProps({ testID: 'applock-use-fingerprint' })).toHaveLength(0);
  });

  it('uses the saved fingerprint method and keeps the PIN fallback available', async () => {
    (Keychain.getSupportedBiometryType as jest.Mock).mockResolvedValue('Fingerprint');
    await configureSecret({ method: 'fingerprint', secretKind: 'pin', secret: '1234' });

    const renderer = await render(
      <AppLockProvider>
        <UnlockWhenReady />
      </AppLockProvider>,
    );

    expect(renderer.root.findByProps({ testID: 'applock-use-secret' })).toBeTruthy();

    await press(renderer, 'applock-use-secret');
    expect(renderer.root.findByProps({ testID: 'applock-secret-input' })).toBeTruthy();
    expect(renderer.root.findByProps({ testID: 'applock-use-fingerprint' })).toBeTruthy();
  });

  it('does not offer a PIN or password fallback for a fingerprint-only lock', async () => {
    (Keychain.getSupportedBiometryType as jest.Mock).mockResolvedValue('Fingerprint');
    await configureFingerprint();

    const renderer = await render(
      <AppLockProvider>
        <UnlockWhenReady />
      </AppLockProvider>,
    );

    expect(renderer.root.findAllByProps({ testID: 'applock-use-secret' })).toHaveLength(0);
  });

  it('shows the PIN field and hides biometrics when unavailable', async () => {
    await configureSecret({ method: 'pin', secretKind: 'pin', secret: '1234' });

    const renderer = await render(
      <AppLockProvider>
        <AppLockUnlockScreen />
      </AppLockProvider>,
    );

    expect(renderer.root.findByProps({ testID: 'applock-secret-input' })).toBeTruthy();
    expect(renderer.root.findAllByProps({ testID: 'applock-biometric' })).toHaveLength(0);
  });

  it('shows an error for an incorrect secret and clears it for the right one', async () => {
    await configureSecret({ method: 'pin', secretKind: 'pin', secret: '1234' });

    const renderer = await render(
      <AppLockProvider>
        <AppLockUnlockScreen />
      </AppLockProvider>,
    );

    await changeText(renderer, 'applock-secret-input', '0000');
    await press(renderer, 'applock-submit');
    expect(texts(renderer)).toContain(i18n.t('appLock.incorrect'));

    await changeText(renderer, 'applock-secret-input', '1234');
    await press(renderer, 'applock-submit');
    expect(texts(renderer)).not.toContain(i18n.t('appLock.incorrect'));
  });
});
