// KZ-02: a misconfigured Firebase must never stop the app from starting.
// index.js sets up the push background handler at module load, before it
// registers the app; every Firebase failure must leave push disabled and the
// app registered.

type FirebaseAppMock = { getApps: jest.Mock };
type MessagingMock = {
  getMessaging: jest.Mock;
  getToken: jest.Mock;
  onMessage: jest.Mock;
  onTokenRefresh: jest.Mock;
  setBackgroundMessageHandler: jest.Mock;
};
type Service = typeof import('../src/notifications/service');

jest.mock('../App', () => () => null);

interface Loaded {
  firebaseApp: FirebaseAppMock;
  messaging: MessagingMock;
  registerComponent: jest.SpyInstance;
  notifee: { requestPermission: jest.Mock };
  startupError: unknown;
  service: Service;
}

// A fresh module registry per test, so the push module's state starts over
// and each test can break Firebase before index.js loads.
function load(arrange: (loaded: Omit<Loaded, 'startupError' | 'service'>) => void): Loaded {
  let loaded!: Loaded;
  jest.isolateModules(() => {
    const base = {
      firebaseApp: require('@react-native-firebase/app') as FirebaseAppMock,
      messaging: require('@react-native-firebase/messaging') as MessagingMock,
      registerComponent: jest
        .spyOn(require('react-native').AppRegistry, 'registerComponent')
        .mockImplementation(() => 'Kazi'),
      notifee: require('@notifee/react-native').default,
    };
    arrange(base);
    let startupError: unknown = null;
    try {
      require('../index');
    } catch (error) {
      startupError = error;
    }
    loaded = { ...base, startupError, service: require('../src/notifications/service') };
  });
  return loaded;
}

let info: jest.SpyInstance;

beforeEach(() => {
  info = jest.spyOn(console, 'info').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('index.js startup with push', () => {
  it('registers the background handler when Firebase is configured', () => {
    const loaded = load(() => {});
    expect(loaded.startupError).toBeNull();
    expect(loaded.messaging.setBackgroundMessageHandler).toHaveBeenCalledTimes(1);
    expect(loaded.registerComponent).toHaveBeenCalledWith('Kazi', expect.any(Function));
  });

  it('still registers the app when getMessaging() throws', () => {
    const loaded = load(({ messaging }) => {
      messaging.getMessaging.mockImplementation(() => {
        throw new Error("No Firebase App '[DEFAULT]' has been created");
      });
    });
    expect(loaded.startupError).toBeNull();
    expect(loaded.messaging.setBackgroundMessageHandler).not.toHaveBeenCalled();
    expect(loaded.registerComponent).toHaveBeenCalledWith('Kazi', expect.any(Function));
    expect(info).toHaveBeenCalledTimes(1);
  });

  it('never calls getMessaging() when the native side configured no Firebase app', () => {
    const loaded = load(({ firebaseApp }) => {
      firebaseApp.getApps.mockReturnValue([]);
    });
    expect(loaded.startupError).toBeNull();
    expect(loaded.messaging.getMessaging).not.toHaveBeenCalled();
    expect(loaded.registerComponent).toHaveBeenCalledWith('Kazi', expect.any(Function));
  });

  it('still registers the app when getApps() or the handler registration throws', () => {
    const broken = load(({ firebaseApp }) => {
      firebaseApp.getApps.mockImplementation(() => {
        throw new Error('native module missing');
      });
    });
    expect(broken.startupError).toBeNull();
    expect(broken.registerComponent).toHaveBeenCalledTimes(1);

    const throwing = load(({ messaging }) => {
      messaging.setBackgroundMessageHandler.mockImplementation(() => {
        throw new Error('handler registration failed');
      });
    });
    expect(throwing.startupError).toBeNull();
    expect(throwing.registerComponent).toHaveBeenCalledTimes(1);
  });

  it('keeps push disabled for the session once Firebase failed, logging once', async () => {
    const loaded = load(({ messaging }) => {
      messaging.getMessaging.mockImplementation(() => {
        throw new Error('broken');
      });
    });
    const { service } = loaded;

    await expect(service.initializeNotifications()).resolves.toBeUndefined();
    await expect(service.getAndRegisterToken()).resolves.toBeNull();
    expect(() => service.onTokenRefresh()).not.toThrow();
    expect(() => service.setupForegroundMessageListener()).not.toThrow();

    expect(loaded.messaging.getMessaging).toHaveBeenCalledTimes(1);
    expect(loaded.messaging.getToken).not.toHaveBeenCalled();
    expect(loaded.notifee.requestPermission).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledTimes(1);
  });
});
