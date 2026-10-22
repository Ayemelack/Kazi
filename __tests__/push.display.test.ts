// Android hides a notification's time unless the app asks for it, and the
// time shown must be the moment of delivery. So every Kazi display call sets
// `showTimestamp` and leaves `android.timestamp` unset: a timestamp captured
// at scheduling time would be shown as if it were the delivery time.
//
// The lock screen must not reveal low-stock detail: Android posts with
// `visibility: SECRET`, and on iOS (where there is no such switch) the
// OS-visible text stays generic.

import { AndroidVisibility } from '@notifee/react-native';
import i18n from '../src/i18n';

export {};

type Service = typeof import('../src/notifications/service');
type MessagingMock = { onMessage: jest.Mock; setBackgroundMessageHandler: jest.Mock };
type NotifeeMock = { displayNotification: jest.Mock; createChannel: jest.Mock };

jest.mock('../src/api/client', () => ({ apiRequest: jest.fn(async () => ({})) }));

// The wire shape the API sends for a low-stock alert.
const pushWire = {
  title: 'Running low: Sugar',
  body: 'Sugar is down to 3. Tap to reorder.',
  channel: 'kazi',
  type: 'low_stock',
  itemId: '42',
};

function load(): { service: Service; messaging: MessagingMock; notifee: NotifeeMock } {
  let loaded!: { service: Service; messaging: MessagingMock; notifee: NotifeeMock };
  jest.isolateModules(() => {
    const messaging = require('@react-native-firebase/messaging') as MessagingMock;
    const notifee = require('@notifee/react-native').default as NotifeeMock;
    messaging.onMessage.mockReset();
    messaging.setBackgroundMessageHandler.mockReset();
    notifee.displayNotification.mockReset().mockResolvedValue('notification-id');
    notifee.createChannel.mockReset().mockResolvedValue('kazi');
    loaded = { service: require('../src/notifications/service'), messaging, notifee };
  });
  return loaded;
}

function expectPostTimeShown(notification: {
  android?: { showTimestamp?: boolean; timestamp?: unknown; visibility?: number };
}): void {
  expect(notification.android?.showTimestamp).toBe(true);
  expect(notification.android?.timestamp).toBeUndefined();
  expect(notification.android?.visibility).toBe(AndroidVisibility.SECRET);
}

describe('push display options', () => {
  it('shows the post time on a push received in the foreground', async () => {
    const { service, messaging, notifee } = load();
    service.setupForegroundMessageListener();

    const handler = messaging.onMessage.mock.calls[0][1];
    await handler({ data: pushWire });

    expect(notifee.displayNotification).toHaveBeenCalledTimes(1);
    expectPostTimeShown(notifee.displayNotification.mock.calls[0][0]);
  });

  it('shows the post time on a push received in the background', async () => {
    const { service, messaging, notifee } = load();
    service.setupBackgroundHandler();

    const handler = messaging.setBackgroundMessageHandler.mock.calls[0][1];
    await handler({ data: pushWire });

    expect(notifee.displayNotification).toHaveBeenCalledTimes(1);
    expectPostTimeShown(notifee.displayNotification.mock.calls[0][0]);
  });

  it('keeps the low-stock detail out of the OS text on iOS', async () => {
    const { service, messaging, notifee } = load();
    service.setupForegroundMessageListener();

    const handler = messaging.onMessage.mock.calls[0][1];
    await handler({ data: pushWire });

    const shown = notifee.displayNotification.mock.calls[0][0];
    expect(shown.title).toBe(i18n.t('notifications.privateTitle'));
    expect(shown.body).toBe(i18n.t('notifications.privateBody'));
    expect(`${shown.title} ${shown.body}`).not.toContain('Sugar');
    // The payload still carries the routing fields (never rendered by the OS).
    expect(shown.data).toEqual(expect.objectContaining({ type: 'low_stock', itemId: '42' }));
  });
});
