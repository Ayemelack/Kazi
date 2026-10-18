// Android hides a notification's time unless the app asks for it, and the
// time shown must be the moment of delivery. So every Kazi display call sets
// `showTimestamp` and leaves `android.timestamp` unset: a timestamp captured
// at scheduling time would be shown as if it were the delivery time.

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
  android?: { showTimestamp?: boolean; timestamp?: unknown };
}): void {
  expect(notification.android?.showTimestamp).toBe(true);
  expect(notification.android?.timestamp).toBeUndefined();
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
});
