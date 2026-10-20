import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import '../src/i18n';
import { ToastProvider } from '../src/components/ui/Toast';
import NotificationsScreen from '../src/screens/more/NotificationsScreen';
import {
  fetchNotifications,
  fetchPushPreferences,
  markAllNotificationsRead,
  savePushPreferences,
  type NotificationItem,
} from '../src/notifications/api';
import { handlePushOpened } from '../src/notifications/pushNavigation';

jest.mock('../src/notifications/api', () => ({
  fetchPushPreferences: jest.fn(),
  savePushPreferences: jest.fn(),
  fetchNotifications: jest.fn(),
  fetchUnreadCount: jest.fn(),
  markAllNotificationsRead: jest.fn(),
}));

jest.mock('../src/notifications/pushNavigation', () => ({
  handlePushOpened: jest.fn(),
}));

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
        <NotificationsScreen navigation={navigation} route={{} as never} />
      </ToastProvider>,
    );
  });
  await flush();
  return renderer!;
}

function item(overrides: Partial<NotificationItem> = {}): NotificationItem {
  return {
    id: 1,
    type: 'low_stock',
    itemId: 7,
    title: 'Low stock alert',
    body: 'Rice 5kg: only 3 left.',
    createdAt: '2026-10-18 12:34:56',
    read: false,
    ...overrides,
  };
}

function givenPreferences(pushNotifications: boolean, inactivityNotifications = false): void {
  (fetchPushPreferences as jest.Mock).mockResolvedValue({
    pushNotifications,
    inactivityNotifications,
  });
}

function givenHistory(notifications: NotificationItem[]): void {
  (fetchNotifications as jest.Mock).mockResolvedValue({ notifications });
}

describe('NotificationsScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    givenPreferences(true);
    givenHistory([]);
  });

  it('shows the saved switch and the notifications the server delivered', async () => {
    givenHistory([
      item(),
      item({ id: 2, type: null, itemId: null, title: 'Hello', body: 'From Kazi', read: true }),
    ]);

    const renderer = await renderScreen();

    expect(renderer.root.findByProps({ testID: 'push-toggle' }).props.value).toBe(true);
    expect(renderer.root.findByProps({ testID: 'notification-1' })).toBeTruthy();
    expect(renderer.root.findByProps({ children: 'Rice 5kg: only 3 left.' })).toBeTruthy();
    expect(renderer.root.findByProps({ children: 'From Kazi' })).toBeTruthy();
    expect(renderer.root.findByProps({ testID: 'notifications-mark-all' })).toBeTruthy();
  });

  it('holds the switch disabled until the preference has loaded', async () => {
    (fetchPushPreferences as jest.Mock).mockImplementation(() => new Promise(() => {}));

    const renderer = await renderScreen();

    const toggle = renderer.root.findByProps({ testID: 'push-toggle' });
    expect(toggle.props.value).toBe(false);
    expect(toggle.props.disabled).toBe(true);
  });

  it('saves the switch to the server and shows the saved state', async () => {
    (savePushPreferences as jest.Mock).mockResolvedValue({ pushNotifications: false });
    const renderer = await renderScreen();

    await act(async () => {
      renderer.root.findByProps({ testID: 'push-toggle' }).props.onValueChange(false);
    });
    await flush();

    // The master toggle also passes the current opt-in so turning it off and
    // on never silently clears the inactivity choice.
    expect(savePushPreferences).toHaveBeenCalledWith(false, false);
    expect(renderer.root.findByProps({ testID: 'push-toggle' }).props.value).toBe(false);
  });

  it('keeps the switch where it was when saving fails', async () => {
    (savePushPreferences as jest.Mock).mockRejectedValue(new Error('offline'));
    const renderer = await renderScreen();

    await act(async () => {
      renderer.root.findByProps({ testID: 'push-toggle' }).props.onValueChange(false);
    });
    await flush();

    expect(renderer.root.findByProps({ testID: 'push-toggle' }).props.value).toBe(true);
  });

  it('marks everything as read and hides the action afterwards', async () => {
    givenHistory([item(), item({ id: 2, read: false })]);
    (markAllNotificationsRead as jest.Mock).mockResolvedValue({ updated: 2 });
    const renderer = await renderScreen();

    await act(async () => {
      renderer.root.findByProps({ testID: 'notifications-mark-all' }).props.onPress();
    });
    await flush();

    expect(markAllNotificationsRead).toHaveBeenCalledTimes(1);
    expect(renderer.root.findAllByProps({ testID: 'notifications-mark-all' })).toHaveLength(0);
  });

  it('offers a retry when the history fails to load', async () => {
    (fetchNotifications as jest.Mock)
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ notifications: [] });

    const renderer = await renderScreen();
    expect(renderer.root.findByProps({ testID: 'notifications-retry' })).toBeTruthy();

    await act(async () => {
      renderer.root.findByProps({ testID: 'notifications-retry' }).props.onPress();
    });
    await flush();

    expect(renderer.root.findAllByProps({ testID: 'notifications-retry' })).toHaveLength(0);
    expect(renderer.root.findByProps({ children: 'No notifications yet' })).toBeTruthy();
  });

  it('opens the item an alert is about when its row is pressed', async () => {
    givenHistory([item()]);

    const renderer = await renderScreen();

    await act(async () => {
      renderer.root.findByProps({ testID: 'notification-1' }).props.onPress();
    });

    expect(handlePushOpened).toHaveBeenCalledWith({
      title: 'Low stock alert',
      body: 'Rice 5kg: only 3 left.',
      type: 'low_stock',
      itemId: 7,
    });
  });

  it('shows nothing to open for a message without a type', async () => {
    givenHistory([item({ id: 9, type: null, itemId: null, title: 'Hello', body: 'From Kazi' })]);

    const renderer = await renderScreen();
    const row = renderer.root.findByProps({ testID: 'notification-9' });

    expect(row.props.onPress).toBeUndefined();
    expect(handlePushOpened).not.toHaveBeenCalled();
  });
});
