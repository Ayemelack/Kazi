import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import notifee from '@notifee/react-native';
import '../src/i18n';
import ReminderScreen from '../src/screens/more/ReminderScreen';
import { ToastProvider } from '../src/components/ui/Toast';
import { REMINDER_NOTIFICATION_ID } from '../src/notifications/reminder';

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

async function flush(): Promise<void> {
  for (let i = 0; i < 6; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function renderScreen(): Promise<ReactTestRenderer.ReactTestRenderer> {
  let renderer: ReactTestRenderer.ReactTestRenderer | undefined;
  await act(async () => {
    renderer = ReactTestRenderer.create(
      <ToastProvider>
        <ReminderScreen navigation={navigation} route={{} as never} />
      </ToastProvider>,
    );
  });
  await flush();
  return renderer!;
}

describe('ReminderScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (notifee.requestPermission as jest.Mock).mockResolvedValue({ authorizationStatus: 1 });
  });

  it('schedules a daily reminder when switched on', async () => {
    const renderer = await renderScreen();
    const toggle = renderer.root.findByProps({ testID: 'reminder-toggle' });

    await act(async () => {
      await toggle.props.onValueChange(true);
    });

    expect(notifee.createTriggerNotification).toHaveBeenCalledWith(
      expect.objectContaining({ id: REMINDER_NOTIFICATION_ID }),
      expect.objectContaining({ repeatFrequency: 1 }),
    );
    expect(renderer.root.findByProps({ testID: 'reminder-time' })).toBeTruthy();
  });

  it('cancels the reminder when switched off', async () => {
    const renderer = await renderScreen();
    const toggle = renderer.root.findByProps({ testID: 'reminder-toggle' });

    await act(async () => {
      await toggle.props.onValueChange(true);
    });
    await act(async () => {
      await toggle.props.onValueChange(false);
    });

    expect(notifee.cancelNotification).toHaveBeenCalledWith(REMINDER_NOTIFICATION_ID);
  });

  it('shows a message when notification permission is refused', async () => {
    (notifee.requestPermission as jest.Mock).mockResolvedValue({ authorizationStatus: 0 });
    const renderer = await renderScreen();
    const toggle = renderer.root.findByProps({ testID: 'reminder-toggle' });

    await act(async () => {
      await toggle.props.onValueChange(true);
    });

    expect(renderer.root.findByProps({ testID: 'reminder-permission' })).toBeTruthy();
    expect(notifee.createTriggerNotification).not.toHaveBeenCalled();
  });
});
