import { apiRequest } from '../api/client';

export type ActivityType =
  | 'sale'
  | 'spend'
  | 'capital'
  | 'debt_added'
  | 'debt_paid'
  | 'product_added'
  | 'product_updated';

export interface ActivityEvent {
  id: number;
  type: ActivityType;
  title?: string;
  amount?: number;
  quantity?: number;
  eventDate?: string;
  createdAt: string;
}

export function listActivity(limit = 100): Promise<{ events: ActivityEvent[] }> {
  return apiRequest<{ events: ActivityEvent[] }>(`/activity?limit=${limit}`, {
    auth: true,
  });
}