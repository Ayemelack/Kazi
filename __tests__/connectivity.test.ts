// KZ-01: connectivity comes from NetInfo events over HTTPS, not a plain-HTTP
// poll, and the API client reports "offline" only when the device is offline.
import type { NetInfoState } from '@react-native-community/netinfo';

type Connectivity = typeof import('../src/offline/connectivity');
type NetInfoMock = {
  configure: jest.Mock;
  refresh: jest.Mock;
  addEventListener: jest.Mock;
};

function state(isConnected: boolean | null, isInternetReachable: boolean | null) {
  const value = { type: 'wifi', isConnected, isInternetReachable, details: null };
  return value as unknown as NetInfoState;
}

// A fresh module registry per test, so the module-level state starts over.
function load(): { connectivity: Connectivity; netInfo: NetInfoMock } {
  let result!: { connectivity: Connectivity; netInfo: NetInfoMock };
  jest.isolateModules(() => {
    result = {
      connectivity: require('../src/offline/connectivity'),
      netInfo: require('@react-native-community/netinfo').default,
    };
  });
  return result;
}

function netInfoListener(netInfo: NetInfoMock): (s: NetInfoState) => void {
  expect(netInfo.addEventListener).toHaveBeenCalledTimes(1);
  return netInfo.addEventListener.mock.calls[0][0];
}

describe('connectivity (NetInfo)', () => {
  it('configures an HTTPS reachability check that expects 204', async () => {
    const { connectivity, netInfo } = load();
    connectivity.isOnline();

    expect(netInfo.configure).toHaveBeenCalledTimes(1);
    const config = netInfo.configure.mock.calls[0][0];
    expect(config.reachabilityUrl).toMatch(/^https:\/\//);
    expect(await config.reachabilityTest({ status: 204 })).toBe(true);
    expect(await config.reachabilityTest({ status: 200 })).toBe(false);
  });

  it('starts online and follows offline / online events', () => {
    const { connectivity, netInfo } = load();
    const seen: boolean[] = [];
    connectivity.subscribeConnectivity(value => seen.push(value));
    expect(connectivity.isOnline()).toBe(true);

    const emit = netInfoListener(netInfo);
    emit(state(false, false));
    expect(connectivity.isOnline()).toBe(false);
    emit(state(true, false)); // Wi-Fi without internet is still offline.
    expect(connectivity.isOnline()).toBe(false);
    emit(state(true, true));
    expect(connectivity.isOnline()).toBe(true);

    expect(seen).toEqual([false, true]);
  });

  it('treats an unknown reachability as online', () => {
    const { connectivity, netInfo } = load();
    connectivity.isOnline();
    const emit = netInfoListener(netInfo);

    emit(state(false, false));
    emit(state(true, null));
    expect(connectivity.isOnline()).toBe(true);
  });

  it('stops notifying after unsubscribe', () => {
    const { connectivity, netInfo } = load();
    const listener = jest.fn();
    const unsubscribe = connectivity.subscribeConnectivity(listener);
    unsubscribe();

    netInfoListener(netInfo)(state(false, false));
    expect(listener).not.toHaveBeenCalled();
  });

  it('probeConnectivity re-reads the state and keeps the last one on failure', async () => {
    const { connectivity, netInfo } = load();
    netInfo.refresh.mockResolvedValueOnce(state(false, false));
    await expect(connectivity.probeConnectivity()).resolves.toBe(false);

    netInfo.refresh.mockRejectedValueOnce(new Error('native module gone'));
    await expect(connectivity.probeConnectivity()).resolves.toBe(false);
  });
});

describe('apiRequest when fetch fails', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  function loadClient(online: boolean) {
    let client!: typeof import('../src/api/client');
    let errors!: typeof import('../src/errors/ApiError');
    jest.isolateModules(() => {
      jest.doMock('../src/offline/connectivity', () => ({ isOnline: () => online }));
      client = require('../src/api/client');
      errors = require('../src/errors/ApiError');
    });
    globalThis.fetch = jest.fn(async () => {
      throw new TypeError('Network request failed');
    }) as unknown as typeof fetch;
    return { client, errors };
  }

  it('throws NetworkError when the device is offline', async () => {
    const { client, errors } = loadClient(false);
    await expect(client.apiRequest('/items', { auth: false })).rejects.toBeInstanceOf(
      errors.NetworkError,
    );
  });

  it('throws SERVER_UNREACHABLE (not offline) when the device is online', async () => {
    const { client, errors } = loadClient(true);
    const failure = client.apiRequest('/items', { auth: false });
    await expect(failure).rejects.toBeInstanceOf(errors.ApiError);
    await expect(failure).rejects.toMatchObject({ code: 'SERVER_UNREACHABLE' });
  });
});
