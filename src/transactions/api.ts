import { apiRequest } from '../api/client';
import type { Transaction, TransactionInput } from './types';

export function listTransactions(): Promise<{ transactions: Transaction[] }> {
  return apiRequest<{ transactions: Transaction[] }>('/transactions', { auth: true });
}

export function getTransaction(transactionId: number): Promise<{ transaction: Transaction }> {
  return apiRequest<{ transaction: Transaction }>(`/transactions/${transactionId}`, {
    auth: true,
  });
}

export function createTransaction(input: TransactionInput): Promise<{ transaction: Transaction }> {
  return apiRequest<{ transaction: Transaction }>('/transactions', {
    method: 'POST',
    body: input,
    auth: true,
  });
}

export function deleteTransaction(transactionId: number): Promise<void> {
  return apiRequest<void>(`/transactions/${transactionId}`, {
    method: 'DELETE',
    auth: true,
  });
}