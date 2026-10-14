import type { ItemType } from '../items/types';

export type TransactionType = 'sale' | 'purchase' | 'capital';

export interface TransactionItem {
  id: number;
  name: string;
  type: ItemType;
}

export interface Transaction {
  id: number;
  type: TransactionType;
  amount: number;
  description?: string;
  item?: TransactionItem;
  quantity?: number;
  date: string;
  createdAt: string;
}

export interface TransactionInput {
  type: TransactionType;
  amount: number;
  description?: string;
  date: string;
  itemId?: number;
  quantity?: number;
  // Idempotency key for this submission (KZ-11, src/forms/useSubmission.ts).
  clientOpId?: string;
}