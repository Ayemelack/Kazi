import { apiRequest } from '../api/client';
import type { Debt, DebtInput } from './types';

export function listDebts(): Promise<{ debts: Debt[] }> {
  return apiRequest<{ debts: Debt[] }>('/debts', { auth: true });
}

export function getDebt(debtId: number): Promise<{ debt: Debt }> {
  return apiRequest<{ debt: Debt }>(`/debts/${debtId}`, { auth: true });
}

export function createDebt(input: DebtInput): Promise<{ debt: Debt }> {
  return apiRequest<{ debt: Debt }>('/debts', {
    method: 'POST',
    body: input,
    auth: true,
  });
}

export function payDebt(debtId: number, paidOn?: string): Promise<{ debt: Debt }> {
  return apiRequest<{ debt: Debt }>(`/debts/${debtId}/pay`, {
    method: 'POST',
    body: paidOn ? { date: paidOn } : {},
    auth: true,
  });
}

export function deleteDebt(debtId: number): Promise<void> {
  return apiRequest<void>(`/debts/${debtId}`, {
    method: 'DELETE',
    auth: true,
  });
}