// Notification taps open the right screen in every app state: foreground
// (navigator ready), background/terminated (navigator registered later), and
// after sign-in (queued until AppStack mounts). The payload is the shared
// push contract, so the server and the app can't drift.

import { parsePushData } from '@kazi/shared';

type PushNavigation = typeof import('../src/notifications/pushNavigation');
type Service = typeof import('../src/notifications/service');
type NotifeeMock = {
  onForegroundEvent: jest.Mock;
  onBackgroundEvent: jest.Mock;
  getInitialNotification: jest.Mock;
};

jest.mock('../src/api/client', () => ({ apiRequest: jest.fn(async () => ({})) }));

// The wire shape deliverPush builds for a low-stock alert.
const lowStockWire = {
  title: 'Running low: Sugar',
  body: 'Sugar is down to 3. Tap to reorder.',
  channel: 'kazi',
  type: 'low_stock',
  itemId: '42',
};

const lowStockTap = parsePushData(lowStockWire);

function fakeNavigator(ready = true) {
  return { isReady: jest.fn(() => ready), navigate: jest.fn() };
}

function loadNavigation(): PushNavigation {
  let navigation!: PushNavigation;
  jest.isolateModules(() => {
    navigation = require('../src/notifications/pushNavigation');
  });
  return navigation;
}

describe('pushRoute', () => {
  it('opens the item form for a low-stock push that names an item', () => {
    const { pushRoute } = loadNavigation();
    expect(pushRoute(lowStockTap!)).toEqual({
      name: 'Main',
      params: {
        screen: 'Products',
        params: { screen: 'ProductForm', params: { itemId: 42 } },
      },
    });
  });

  it('opens the stock list when the push names no item', () => {
    const { pushRoute } = loadNavigation();
    const push = parsePushData({ ...lowStockWire, itemId: 'not-a-number' });
    expect(pushRoute(push!)).toEqual({ name: 'Main', params: { screen: 'Products' } });
  });

  it('has nowhere to open for a display-only push', () => {
    const { pushRoute } = loadNavigation();
    const push = parsePushData({ title: 'Hello', body: 'From the test route' });
    expect(pushRoute(push!)).toBeNull();
  });
});

describe('handlePushOpened', () => {
  it('navigates immediately when the navigator is ready', () => {
    const navigation = loadNavigation();
    const navigator = fakeNavigator();
    navigation.setPushNavigator(navigator);

    navigation.handlePushOpened(lowStockTap!);

    expect(navigator.navigate).toHaveBeenCalledTimes(1);
  });

  it('queues the tap until a navigator registers, then flushes it once', () => {
    const navigation = loadNavigation();

    navigation.handlePushOpened(lowStockTap!);
    const navigator = fakeNavigator();
    navigation.setPushNavigator(navigator);
    expect(navigator.navigate).toHaveBeenCalledTimes(1);

    // Re-registering (e.g. a remount) never replays the tap.
    const second = fakeNavigator();
    navigation.setPushNavigator(second);
    expect(second.navigate).not.toHaveBeenCalled();
  });

  it('queues when the registered navigator is not ready yet, then flushes', () => {
    const navigation = loadNavigation();
    navigation.setPushNavigator(fakeNavigator(false));

    navigation.handlePushOpened(lowStockTap!);
    const ready = fakeNavigator();
    navigation.setPushNavigator(ready);

    expect(ready.navigate).toHaveBeenCalledTimes(1);
  });

  it('never throws when navigation fails', () => {
    const navigation = loadNavigation();
    const navigator = fakeNavigator();
    navigator.navigate.mockImplementation(() => {
      throw new Error('no such route');
    });
    navigation.setPushNavigator(navigator);

    expect(() => navigation.handlePushOpened(lowStockTap!)).not.toThrow();
  });

  it('drops display-only pushes without queueing them', () => {
    const navigation = loadNavigation();
    const displayOnly = parsePushData({ title: 'Hello', body: 'From the test route' });

    navigation.handlePushOpened(displayOnly!);
    const navigator = fakeNavigator();
    navigation.setPushNavigator(navigator);

    expect(navigator.navigate).not.toHaveBeenCalled();
  });
});

describe('notification taps end to end', () => {
  interface Loaded {
    navigation: PushNavigation;
    service: Service;
    notifee: NotifeeMock;
  }

  // Service handlers and the navigation module in one fresh registry, the way
  // index.js and the app load them.
  function load(setup: (service: Service, notifee: NotifeeMock) => void): Loaded {
    let loaded!: Loaded;
    jest.isolateModules(() => {
      const service = require('../src/notifications/service') as Service;
      const notifee = require('@notifee/react-native').default as NotifeeMock;
      notifee.onForegroundEvent.mockReset();
      notifee.onBackgroundEvent.mockReset().mockResolvedValue(undefined);
      notifee.getInitialNotification.mockReset().mockResolvedValue(null);
      setup(service, notifee);
      loaded = { navigation: require('../src/notifications/pushNavigation'), service, notifee };
    });
    return loaded;
  }

  it('a foreground press routes through the shared contract to the item form', () => {
    const { navigation, notifee } = load(service => service.setupForegroundHandler());
    const onEvent = notifee.onForegroundEvent.mock.calls[0][0];

    onEvent({ type: 1, detail: { notification: { data: lowStockWire } } });
    const navigator = fakeNavigator();
    navigation.setPushNavigator(navigator);

    expect(navigator.navigate).toHaveBeenCalledWith('Main', {
      screen: 'Products',
      params: { screen: 'ProductForm', params: { itemId: 42 } },
    });
  });

  it('a background press (app in background) is queued for AppStack', () => {
    const { navigation, notifee } = load(service => service.setupBackgroundOpenHandler());
    const onBackgroundEvent = notifee.onBackgroundEvent.mock.calls[0][0];

    onBackgroundEvent({ type: 1, detail: { notification: { data: lowStockWire } } });
    const navigator = fakeNavigator();
    navigation.setPushNavigator(navigator);

    expect(navigator.navigate).toHaveBeenCalledWith('Main', expect.anything());
  });

  it('a background event that is not a press does nothing', () => {
    const { navigation, notifee } = load(service => service.setupBackgroundOpenHandler());
    const onBackgroundEvent = notifee.onBackgroundEvent.mock.calls[0][0];

    onBackgroundEvent({ type: 0, detail: { notification: { data: lowStockWire } } });
    const navigator = fakeNavigator();
    navigation.setPushNavigator(navigator);

    expect(navigator.navigate).not.toHaveBeenCalled();
  });

  it('the tap that launched the app from terminated state navigates once the navigator exists', async () => {
    const { navigation, service, notifee } = load(() => {});
    notifee.getInitialNotification.mockResolvedValue({ notification: { data: lowStockWire } });

    await service.consumeInitialNotificationNavigation();
    const navigator = fakeNavigator();
    navigation.setPushNavigator(navigator);

    expect(navigator.navigate).toHaveBeenCalledWith('Main', expect.anything());
  });

  it('a press event with no push payload does nothing', () => {
    const { navigation, notifee } = load(service => service.setupForegroundHandler());
    const onEvent = notifee.onForegroundEvent.mock.calls[0][0];

    onEvent({ type: 1, detail: { notification: { data: { hello: 'world' } } } });
    const navigator = fakeNavigator();
    navigation.setPushNavigator(navigator);

    expect(navigator.navigate).not.toHaveBeenCalled();
  });
});
