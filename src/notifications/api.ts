import { apiRequest } from '../api/client';

/** The account's one push switch, exactly as the server keeps it. */
export interface PushPreferences {
  pushNotifications: boolean;
}

/** One delivered push as the account's history lists it. */
export interface NotificationItem {
  id: number;
  /** low_stock for an item alert; null for a display-only message. */
  type: string | null;
  /** The record the push is about, when it names one. */
  itemId: number | null;
  title: string;
  body: string;
  /** The server's UTC timestamp, "YYYY-MM-DD HH:MM:SS". */
  createdAt: string;
  read: boolean;
}

export function fetchPushPreferences(): Promise<PushPreferences> {
  return apiRequest<PushPreferences>('/notifications/preferences');
}

export function savePushPreferences(pushNotifications: boolean): Promise<PushPreferences> {
  return apiRequest<PushPreferences>('/notifications/preferences', {
    method: 'PUT',
    body: { pushNotifications },
  });
}

export function fetchNotifications(limit = 50): Promise<{ notifications: NotificationItem[] }> {
  return apiRequest<{ notifications: NotificationItem[] }>(
    `/notifications/history?limit=${encodeURIComponent(String(limit))}`,
  );
}

/** For the More screen's badge: what this account has not read yet. */
export function fetchUnreadCount(): Promise<{ unread: number }> {
  return apiRequest<{ unread: number }>('/notifications/unread-count');
}

export function markAllNotificationsRead(): Promise<{ updated: number }> {
  return apiRequest<{ updated: number }>('/notifications/read-all', { method: 'POST' });
}
