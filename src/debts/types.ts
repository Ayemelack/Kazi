export type DebtStatus = 'open' | 'paid';

export interface Debt {
  id: number;
  name: string;
  amount: number;
  note?: string;
  date: string;
  status: DebtStatus;
  // ISO-8601 instant the debt was settled, set only once status is 'paid'.
  paidAt?: string;
  createdAt: string;
}

export interface DebtInput {
  name: string;
  amount: number;
  note?: string;
  date: string;
}