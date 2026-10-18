// Device-level internet connectivity detection.
//
// This module answers ONE question: does the phone have internet access?
// It deliberately does NOT probe the Kazi backend. Backend reachability is a
// separate concern handled by the API client, which reports a distinct
// "server unreachable" error when the device is online but the API cannot be
// reached. That separation is what keeps a dead backend from being reported
// as a missing internet connection.
//
// KZ-01: the answer comes from NetInfo, which listens to the operating
// system's network events instead of polling. On Android the OS's own
// "validated internet" signal decides reachability; where the OS gives no such
// signal (iOS), NetInfo checks the HTTPS URL below. Plain HTTP must never be
// used: release builds block cleartext traffic, so an HTTP check always fails.
//
// NetInfo is loaded behind a guard: its native module throws at load time on
// a build whose APK predates it, and one missing optional native module must
// never take the whole app down. In that case connectivity tracking is
// disabled and the device is treated as online.

import { AppState } from 'react-native';
import type { NetInfoState } from '@react-native-community/netinfo';

type NetInfoModule = typeof import('@react-native-community/netinfo').default;

// Required (not imported) so a build whose APK predates NetInfo — where the
// package throws at load time — degrades to "no connectivity tracking"
// instead of crashing the app at startup.
function loadNetInfo(): NetInfoModule | null {
  try {
    const loaded = require('@react-native-community/netinfo') as { default?: NetInfoModule };
    return loaded.default ?? null;
  } catch {
    return null;
  }
}

const netInfo = loadNetInfo();

// Google's always-204 endpoint, the one Android uses for its own checks.
export const REACHABILITY_URL = 'https://connectivitycheck.gstatic.com/generate_204';

let online = true;
let started = false;
const listeners = new Set<(value: boolean) => void>();

// `null` means "not known yet" (for example while the first reachability check
// runs). Unknown is treated as online so a slow check never shows the pill.
function toOnline(state: NetInfoState): boolean {
  return state.isConnected !== false && state.isInternetReachable !== false;
}

function emit(next: boolean): void {
  if (next === online) {
    return;
  }
  online = next;
  listeners.forEach(listener => {
    try {
      listener(next);
    } catch {
      // Listener errors must not break connectivity detection.
    }
  });
}

function start(): void {
  if (started) {
    return;
  }
  started = true;
  if (netInfo === null) {
    // Offline pill stays hidden; everything else keeps working.
    return;
  }
  try {
    netInfo.configure({
      reachabilityUrl: REACHABILITY_URL,
      reachabilityTest: async response => response.status === 204,
      // Only check while the app is on screen, so the radio is not woken in
      // the background.
      reachabilityShouldRun: () => AppState.currentState === 'active',
      shouldFetchWiFiSSID: false,
    });
    netInfo.addEventListener(state => emit(toOnline(state)));
  } catch {
    // A partially-working native module must not crash the app either.
  }
}

export function isOnline(): boolean {
  start();
  return online;
}

export function subscribeConnectivity(listener: (value: boolean) => void): () => void {
  start();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// Asks NetInfo to re-read the network state now (for example when the app
// returns to the foreground). Never throws; on failure the last known state
// stays.
export async function probeConnectivity(): Promise<boolean> {
  start();
  if (netInfo === null) {
    return online;
  }
  try {
    emit(toOnline(await netInfo.refresh()));
  } catch {
    // Keep the last known state.
  }
  return online;
}
