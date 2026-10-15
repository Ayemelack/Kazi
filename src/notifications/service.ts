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
import { apiRequest } from '../api/client';
import { pushMessaging, withPushMessaging } from './firebase';

const KAZI_CHANNEL_ID = 'kazi';
const KAZI_CHANNEL_NAME = 'Kazi';
let currentToken: string | null = null;
let foregroundEventRegistered = false;
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
      // Notification was tapped while app is in the foreground.
      // Future: navigate to a specific screen based on notification data.
    }
  });
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
  if (remoteMessage.data) {
    return {
      title: remoteMessage.data.title as string | undefined,
      body: remoteMessage.data.body as string | undefined,
    };
  }
  if (remoteMessage.notification) {
    return {
      title: remoteMessage.notification.title,
      body: remoteMessage.notification.body,
    };
  }
  return {};
}
