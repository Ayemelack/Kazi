import { getApps } from '@react-native-firebase/app';
import { getMessaging, type Messaging } from '@react-native-firebase/messaging';

// KZ-02: push must never stop the app from starting. index.js sets up the
// background handler at module load, before the app registers, so a missing
// or broken Firebase config (no GoogleService-Info.plist on iOS, a native
// module that throws) would otherwise kill the app on launch. Every use of
// messaging goes through pushMessaging(): when Firebase is unavailable it
// returns null, push is switched off for the rest of the session, and the
// reason is logged once in development builds.

let disabled = false;
let messaging: Messaging | null = null;

export function disablePush(reason: string, error?: unknown): null {
  if (!disabled) {
    disabled = true;
    if (__DEV__) {
      console.info(`[push] disabled: ${reason}`, error ?? '');
    }
  }
  messaging = null;
  return null;
}

/** The messaging instance, or null when push is disabled for this session. */
export function pushMessaging(): Messaging | null {
  if (disabled) {
    return null;
  }
  if (messaging) {
    return messaging;
  }
  try {
    // getMessaging() throws "No Firebase App '[DEFAULT]'" when the native
    // side never configured Firebase (iOS without its plist), so look first.
    const app = getApps().find(candidate => candidate.name === '[DEFAULT]');
    if (!app) {
      return disablePush('no Firebase app is configured in this build');
    }
    messaging = getMessaging(app);
    return messaging;
  } catch (error) {
    return disablePush('Firebase failed to start', error);
  }
}

/**
 * Runs a synchronous messaging call (registering a handler or listener).
 * If it throws, push is disabled instead of the error reaching the caller.
 */
export function withPushMessaging(run: (instance: Messaging) => void): boolean {
  const instance = pushMessaging();
  if (!instance) {
    return false;
  }
  try {
    run(instance);
    return true;
  } catch (error) {
    disablePush('a messaging call failed', error);
    return false;
  }
}
