import { apiRequest } from '../api/client';

export interface MoneySummary {
  todayReceived: number;
  todaySpent: number;
  todayNet: number;
  totalReceived: number;
  totalSpent: number;
  totalNet: number;
  totalCapital: number;
  // Tracked items at or under their low-stock threshold.
  lowStockCount: number;
}

// `asOf` is the phone's calendar day: "today" totals are the owner's today,
// never the server's (KZ-10).
export function fetchSummary(asOf: string): Promise<{ summary: MoneySummary }> {
  return apiRequest<{ summary: MoneySummary }>(`/summary?asOf=${encodeURIComponent(asOf)}`, {
    auth: true,
  });
}