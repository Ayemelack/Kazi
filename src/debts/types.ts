export type DebtStatus = 'open' | 'paid';

export interface Debt {
  id: number;
  name: string;
  amount: number;
  note?: string;
  date: string;
  status: DebtStatus;
  createdAt: string;
}

export interface DebtInput {
  name: string;
  amount: number;
  note?: string;
  date: string;
}