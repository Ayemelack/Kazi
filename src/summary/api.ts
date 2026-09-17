import { apiRequest } from '../api/client';

export interface MoneySummary {
  todayReceived: number;
  todaySpent: number;
  todayNet: number;
  totalReceived: number;
  totalSpent: number;
  totalNet: number;
  totalCapital: number;
}

export function fetchSummary(): Promise<{ summary: MoneySummary }> {
  return apiRequest<{ summary: MoneySummary }>('/summary', { auth: true });
}