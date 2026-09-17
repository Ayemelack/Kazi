// Device-level internet connectivity detection.
//
// This module answers ONE question: does the phone have internet access?
// It deliberately does NOT probe the Kazi backend. Backend reachability is a
// separate concern handled by the API client, which reports a distinct
// "server unreachable" error when the device is online but the API cannot be
// reached. That separation is what keeps a dead backend from being reported
// as a missing internet connection.

const PROBE_TIMEOUT_MS = 6_000;

// A tiny, reliable, always-204 endpoint used by Android itself for its own
// connectivity checks. If this responds, the device has an internet path.
const PUBLIC_CHECK_URL = 'http://clients3.google.com/generate_204';

let online = true;
let probing = false;
const listeners = new Set<(value: boolean) => void>();

async function probe(): Promise<boolean> {
  if (typeof fetch !== 'function') {
    return true;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const response = await fetch(PUBLIC_CHECK_URL, {
      method: 'HEAD',
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
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

export function isOnline(): boolean {
  return online;
}

export function subscribeConnectivity(listener: (value: boolean) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// Cheap opportunistic probe from the app or a sync attempt. Deduplicates if
// another probe is in-flight and intentionally never blocks the caller.
export async function probeConnectivity(): Promise<boolean> {
  if (probing) {
    return online;
  }
  probing = true;
  try {
    const next = await probe();
    emit(next);
    return next;
  } finally {
    probing = false;
  }
}