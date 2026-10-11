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

import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';
import { AppState } from 'react-native';

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
  NetInfo.configure({
    reachabilityUrl: REACHABILITY_URL,
    reachabilityTest: async response => response.status === 204,
    // Only check while the app is on screen, so the radio is not woken in the
    // background.
    reachabilityShouldRun: () => AppState.currentState === 'active',
    shouldFetchWiFiSSID: false,
  });
  NetInfo.addEventListener(state => emit(toOnline(state)));
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
  try {
    emit(toOnline(await NetInfo.refresh()));
  } catch {
    // Keep the last known state.
  }
  return online;
}
