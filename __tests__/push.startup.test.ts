// KZ-02: a misconfigured Firebase must never stop the app from starting.
// index.js sets up the push background handler at module load, before it
// registers the app; every Firebase failure must leave push disabled and the
// app registered. KZ-03: the committed placeholder google-services.json
// counts as "push disabled".

type FirebaseAppMock = { getApps: jest.Mock };
type MessagingMock = {
  getMessaging: jest.Mock;
  getToken: jest.Mock;
  isAutoInitEnabled: jest.Mock;
  setAutoInitEnabled: jest.Mock;
  onMessage: jest.Mock;
  onTokenRefresh: jest.Mock;
  setBackgroundMessageHandler: jest.Mock;
};
type Service = typeof import('../src/notifications/service');

jest.mock('../App', () => () => null);
jest.mock('../src/api/client', () => ({ apiRequest: jest.fn(async () => ({})) }));

const REAL_APP = {
  name: '[DEFAULT]',
  options: { projectId: 'kazi-test', messagingSenderId: '123456789012' },
};

let spies: jest.SpyInstance[] = [];

interface Loaded {
  firebaseApp: FirebaseAppMock;
  messaging: MessagingMock;
  registerComponent: jest.SpyInstance;
  notifee: { requestPermission: jest.Mock; onBackgroundEvent: jest.Mock };
  apiRequest: jest.Mock;
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
      apiRequest: require('../src/api/client').apiRequest,
    };
    spies.push(base.registerComponent);
    // The jest.setup.js mocks outlive a test; start each from known defaults.
    base.firebaseApp.getApps.mockReset().mockReturnValue([REAL_APP]);
    base.messaging.getMessaging.mockReset().mockReturnValue({});
    base.messaging.getToken.mockReset().mockResolvedValue('test-fcm-token');
    base.messaging.isAutoInitEnabled.mockReset().mockReturnValue(false);
    base.messaging.setAutoInitEnabled.mockReset().mockResolvedValue(undefined);
    base.messaging.onMessage.mockReset();
    base.messaging.onTokenRefresh.mockReset();
    base.messaging.setBackgroundMessageHandler.mockReset();
    base.notifee.requestPermission.mockReset().mockResolvedValue({ authorizationStatus: 1 });
    base.notifee.onBackgroundEvent.mockReset().mockResolvedValue(undefined);
    base.apiRequest.mockReset().mockResolvedValue({});
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
  info.mockRestore();
  spies.forEach(spy => spy.mockRestore());
  spies = [];
});

describe('index.js startup with push', () => {
  it('registers the background handler when Firebase is configured', () => {
    const loaded = load(() => {});
    expect(loaded.startupError).toBeNull();
    expect(loaded.messaging.setBackgroundMessageHandler).toHaveBeenCalledTimes(1);
    // Tap handling needs no Firebase: it must register even on a placeholder
    // build, so a tap can never crash at startup.
    expect(loaded.notifee.onBackgroundEvent).toHaveBeenCalledTimes(1);
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

describe('placeholder Firebase config (KZ-03)', () => {
  // The values the committed android/app/google-services.json gives the app.
  const placeholder = require('../android/app/google-services.json');
  const placeholderOptions = {
    projectId: placeholder.project_info.project_id,
    messagingSenderId: placeholder.project_info.project_number,
  };

  it('recognises the committed placeholder and nothing else', () => {
    const { isPlaceholderFirebaseProject } = require('../src/notifications/firebase');
    expect(isPlaceholderFirebaseProject(placeholderOptions)).toBe(true);
    expect(isPlaceholderFirebaseProject({ projectId: 'kazi-placeholder-dev', messagingSenderId: '1' })).toBe(true);
    expect(isPlaceholderFirebaseProject({ projectId: 'kazi-prod', messagingSenderId: '000000000000' })).toBe(true);
    expect(isPlaceholderFirebaseProject({ projectId: '' })).toBe(true);
    expect(isPlaceholderFirebaseProject({ projectId: 'kazi-prod', messagingSenderId: '123456789012' })).toBe(false);
    expect(isPlaceholderFirebaseProject({ projectId: 'kazi-staging' })).toBe(false);
  });

  it('starts with push disabled: no messaging, no permission prompt, no token request', async () => {
    const loaded = load(({ firebaseApp }) => {
      firebaseApp.getApps.mockReturnValue([{ name: '[DEFAULT]', options: placeholderOptions }]);
    });
    expect(loaded.startupError).toBeNull();
    expect(loaded.registerComponent).toHaveBeenCalledWith('Kazi', expect.any(Function));

    await loaded.service.initializeNotifications();
    await expect(loaded.service.getAndRegisterToken()).resolves.toBeNull();

    expect(loaded.messaging.getMessaging).not.toHaveBeenCalled();
    expect(loaded.messaging.setBackgroundMessageHandler).not.toHaveBeenCalled();
    expect(loaded.messaging.setAutoInitEnabled).not.toHaveBeenCalled();
    expect(loaded.messaging.getToken).not.toHaveBeenCalled();
    expect(loaded.notifee.requestPermission).not.toHaveBeenCalled();
    expect(loaded.apiRequest).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledTimes(1);
  });

  it('with a real project, turns FCM auto-init on and registers the token', async () => {
    const loaded = load(() => {});
    await loaded.service.initializeNotifications();

    expect(loaded.notifee.requestPermission).toHaveBeenCalledTimes(1);
    expect(loaded.messaging.setAutoInitEnabled).toHaveBeenCalledWith(expect.anything(), true);
    expect(loaded.messaging.getToken).toHaveBeenCalledTimes(1);
    expect(loaded.apiRequest).toHaveBeenCalledWith('/notifications/push-tokens', {
      method: 'POST',
      body: { token: 'test-fcm-token', platform: 'ios' },
    });
    expect(info).not.toHaveBeenCalled();
  });
});
