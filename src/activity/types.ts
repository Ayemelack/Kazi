import { apiRequest } from '../api/client';

export type ActivityType =
  | 'sale'
  | 'spend'
  | 'capital'
  | 'debt_added'
  | 'debt_paid'
  | 'product_added'
  | 'product_updated';

export type HistoryPeriod =
  | 'today'
  | 'yesterday'
  | 'this_week'
  | 'older'
  | 'all';

// What an event points back at (KZ-07): History opens a transaction's detail
// sheet, or the debt in the Debts list.
export type ActivityRefType = 'transaction' | 'debt' | 'item';

export interface ActivityEvent {
  id: number;
  type: ActivityType;
  title?: string;
  amount?: number;
  quantity?: number;
  eventDate?: string;
  createdAt: string;
  refType?: ActivityRefType;
  refId?: number;
}

export interface ActivitySummary {
  received: number;
  spent: number;
  made: number;
  capital: number;
}

export interface ActivityResponse {
  events: ActivityEvent[];
  summary: ActivitySummary;
  totalCount: number;
  hasMore: boolean;
}

export interface ActivityQuery {
  period?: HistoryPeriod;
  startDate?: string;
  endDate?: string;
  // The device's local calendar day. Period filters are resolved against it by
  // the server, so a record saved just after midnight belongs to the same
  // business day the owner saw on their phone.
  asOf?: string;
  limit?: number;
  offset?: number;
}

export function listActivity(query: ActivityQuery = {}): Promise<ActivityResponse> {
  const parts: string[] = [];
  const add = (key: string, value: string | number | undefined) => {
    if (value === undefined || value === '') {
      return;
    }
    parts.push(`${key}=${encodeURIComponent(String(value))}`);
  };

  add('period', query.period);
  add('startDate', query.startDate);
  add('endDate', query.endDate);
  add('asOf', query.asOf);
  add('limit', query.limit);
  add('offset', query.offset);

  const search = parts.length > 0 ? `?${parts.join('&')}` : '';
  return apiRequest<ActivityResponse>(`/activity${search}`, { auth: true });
}
