import { Platform, PermissionsAndroid } from 'react-native';
import notifee, {
  AndroidImportance,
  type Event,
  EventType,
} from '@notifee/react-native';
import {
  getToken,
  isAutoInitEnabled,
  setAutoInitEnabled,
  onMessage,
  onTokenRefresh as subscribeTokenRefresh,
  setBackgroundMessageHandler,
  type RemoteMessage,
} from '@react-native-firebase/messaging';
import { KAZI_PUSH_CHANNEL_ID, parsePushData, type ParsedPush } from '@kazi/shared';
import { apiRequest } from '../api/client';
import { pushMessaging, withPushMessaging } from './firebase';
import { handlePushOpened } from './pushNavigation';

// The same channel the API names in every push (shared contract).
const KAZI_CHANNEL_ID = KAZI_PUSH_CHANNEL_ID;
const KAZI_CHANNEL_NAME = 'Kazi';
// The Android channel local notifications use too (daily reminder).
export const KAZI_NOTIFICATION_CHANNEL = KAZI_CHANNEL_ID;
let currentToken: string | null = null;
let foregroundEventRegistered = false;
let backgroundOpenRegistered = false;
let foregroundMessageRegistered = false;
let tokenRefreshRegistered = false;

export async function ensureNotificationChannel(): Promise<string> {
  return notifee.createChannel({
    id: KAZI_CHANNEL_ID,
    name: KAZI_CHANNEL_NAME,
    importance: AndroidImportance.HIGH,
    vibration: true,
    sound: 'default',
    bypassDnd: false,
  });
}

async function requestNativePermission(): Promise<boolean> {
  if (Platform.OS !== 'android') {
    return true;
  }
  if (Platform.Version < 33) {
    return true;
  }
  const granted = await PermissionsAndroid.request(
    PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
  );
  return granted === PermissionsAndroid.RESULTS.GRANTED;
}

export async function requestNotificationPermission(): Promise<boolean> {
  if (Platform.OS === 'android') {
    return requestNativePermission();
  }
  const settings = await notifee.requestPermission();
  return settings.authorizationStatus === 1;
}

export async function getAndRegisterToken(): Promise<string | null> {
  const messaging = pushMessaging();
  if (!messaging) {
    return null;
  }
  try {
    // Auto-init ships off (firebase.json) so a placeholder build never asks
    // FCM for a token; with a real project, turn it on so FCM keeps the token
    // fresh by itself from now on.
    if (!isAutoInitEnabled(messaging)) {
      await setAutoInitEnabled(messaging, true);
    }
    const token = await getToken(messaging);
    if (!token) {
      return null;
    }
    currentToken = token;
    await registerTokenWithBackend(token);
    return token;
  } catch {
    return null;
  }
}

async function registerTokenWithBackend(token: string): Promise<void> {
  try {
    await apiRequest('/notifications/push-tokens', {
      method: 'POST',
      body: { token, platform: Platform.OS },
    });
  } catch {
    // Best-effort: token will be retried on next app foreground.
  }
}

export function onTokenRefresh(): void {
  if (tokenRefreshRegistered) {
    return;
  }
  tokenRefreshRegistered = withPushMessaging(messaging =>
    subscribeTokenRefresh(messaging, async token => {
      if (currentToken && currentToken !== token) {
        try {
          await apiRequest('/notifications/push-tokens', {
            method: 'DELETE',
            body: { token: currentToken },
          });
        } catch {
          // Old token removal is best-effort.
        }
      }
      currentToken = token;
      await registerTokenWithBackend(token);
    }),
  );
}

export async function unregisterCurrentToken(): Promise<void> {
  if (!currentToken) {
    return;
  }
  try {
    await apiRequest('/notifications/push-tokens', {
      method: 'DELETE',
      body: { token: currentToken },
    });
  } catch {
    // Token removal is best-effort; expired tokens are auto-cleaned server-side.
  }
  currentToken = null;
}

export function setupForegroundHandler(): void {
  if (foregroundEventRegistered) {
    return;
  }
  foregroundEventRegistered = true;
  notifee.onForegroundEvent(({ type, detail }: Event) => {
    if (type === EventType.PRESS && detail.notification) {
      // Tapped while the app is in the foreground.
      handleNotificationOpened(detail.notification.data);
    }
  });
}

// Called from index.js at module load: a tap that put the app in the
// background (or launched it, on platforms where the headless handler runs)
// reaches this before any navigator exists, so the navigation is queued until
// AppStack registers the navigator.
export function setupBackgroundOpenHandler(): void {
  if (backgroundOpenRegistered) {
    return;
  }
  backgroundOpenRegistered = true;
  notifee.onBackgroundEvent(async event => {
    if (event.type === EventType.PRESS && event.detail.notification) {
      handleNotificationOpened(event.detail.notification.data);
    }
  });
}

// A tap that launched the app from terminated state: notifee hands the
// initial notification over once, when the JS runtime starts. Consumed after
// the navigator exists, so the queued tap can navigate.
export async function consumeInitialNotificationNavigation(): Promise<void> {
  try {
    const initial = await notifee.getInitialNotification();
    if (initial?.notification) {
      handleNotificationOpened(initial.notification.data);
    }
  } catch {
    // A missing initial notification must never crash startup.
  }
}

function handleNotificationOpened(data: unknown): void {
  const push = parsePushData(data);
  if (push) {
    handlePushOpened(push);
  }
}

/** The push's own fields, so a tap can be routed after the app restarts. */
function notificationData(data: RemoteMessage['data']): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(data ?? {})) {
    if (typeof value === 'string') {
      result[key] = value;
    } else if (value != null) {
      result[key] = String(value);
    }
  }
  return result;
}

// Called from index.js at module load: it must never throw (KZ-02).
export function setupBackgroundHandler(): void {
  withPushMessaging(messaging =>
    setBackgroundMessageHandler(messaging, async remoteMessage => {
      const { title, body } = extractNotification(remoteMessage);
      if (!title || !body) {
        return;
      }
      await ensureNotificationChannel();
      await notifee.displayNotification({
        title,
        body,
        data: notificationData(remoteMessage.data),
        android: {
          channelId: KAZI_CHANNEL_ID,
          importance: AndroidImportance.HIGH,
          pressAction: { id: 'default' },
        },
      });
    }),
  );
}

export function setupForegroundMessageListener(): void {
  if (foregroundMessageRegistered) {
    return;
  }
  foregroundMessageRegistered = withPushMessaging(messaging =>
    onMessage(messaging, async remoteMessage => {
      const { title, body } = extractNotification(remoteMessage);
      if (!title || !body) {
        return;
      }
      await ensureNotificationChannel();
      await notifee.displayNotification({
        title,
        body,
        data: notificationData(remoteMessage.data),
        android: {
          channelId: KAZI_CHANNEL_ID,
          importance: AndroidImportance.HIGH,
          pressAction: { id: 'default' },
        },
      });
    }),
  );
}

export async function initializeNotifications(): Promise<void> {
  // Without Firebase there is nothing to deliver, so don't ask for permission.
  if (!pushMessaging()) {
    return;
  }
  const granted = await requestNotificationPermission();
  if (!granted) {
    return;
  }
  await ensureNotificationChannel();
  setupForegroundHandler();
  setupForegroundMessageListener();
  onTokenRefresh();
  await getAndRegisterToken();
}

function extractNotification(remoteMessage: RemoteMessage): {
  title?: string;
  body?: string;
} {
  // Data-only pushes (what the API sends) are validated against the shared
  // contract; a notification-block message still displays as-is.
  const parsed: ParsedPush | null = parsePushData(remoteMessage.data);
  if (parsed) {
    return { title: parsed.title, body: parsed.body };
  }
  if (remoteMessage.notification) {
    return {
      title: remoteMessage.notification.title,
      body: remoteMessage.notification.body,
    };
  }
  return {};
}
