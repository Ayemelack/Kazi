import type { Item, ItemInput } from '../items/types';
import type { Transaction, TransactionInput } from '../transactions/types';
import type { Debt, DebtInput } from '../debts/types';
import type { CreateItemInput, StockMovementInput } from '../items/api';
import type { MoneySummary } from '../summary/api';
import type { LocalActivity } from './types';
import type { ActivityQuery, ActivitySummary } from '../activity/types';
import { fetchSummary as fetchSummaryRequest } from '../summary/api';
import {
  createItem as createItemRequest,
  deleteItem as deleteItemRequest,
  getItem as getItemRequest,
  listItems as listItemsRequest,
  stockIn as stockInRequest,
  stockOut as stockOutRequest,
  updateItem as updateItemRequest,
} from '../items/api';
import {
  createTransaction as createTransactionRequest,
  deleteTransaction as deleteTransactionRequest,
  listTransactions as listTransactionsRequest,
} from '../transactions/api';
import {
  createDebt as createDebtRequest,
  deleteDebt as deleteDebtRequest,
  listDebts as listDebtsRequest,
  payDebt as payDebtRequest,
} from '../debts/api';
import { listActivity as listActivityRequest } from '../activity/types';

// Kazi is a fully online application. These wrappers keep the screen-facing
// API shape stable while delegating every operation to the live backend.
// Reads always hit the server and writes always wait for the server's answer;
// nothing is cached locally, queued for later, or served from a fake local
// copy when the backend is unreachable. A failed request surfaces the real
// error (server unreachable, validation, auth, etc.) to the caller instead of
// silently keeping a local record.

export async function fetchSummary(): Promise<{ summary: MoneySummary }> {
  return fetchSummaryRequest();
}

export async function listItems(): Promise<{ items: Item[] }> {
  return listItemsRequest();
}

export async function getItem(itemId: number): Promise<{ item: Item }> {
  return getItemRequest(itemId);
}

export async function listActivity(
  query: ActivityQuery = {},
): Promise<{
  events: LocalActivity[];
  summary: ActivitySummary;
  totalCount: number;
  hasMore: boolean;
}> {
  const result = await listActivityRequest(query);
  return {
    ...result,
    events: result.events.map(event => ({ ...event, syncStatus: 'synced' })),
  };
}

export async function listDebts(): Promise<{ debts: Debt[] }> {
  return listDebtsRequest();
}

export async function listTransactions(): Promise<{ transactions: Transaction[] }> {
  return listTransactionsRequest();
}

// ---- Writes ------------------------------------------------------------

export async function createTransaction(
  input: TransactionInput,
): Promise<{ transaction: Transaction }> {
  const { transaction } = await createTransactionRequest(input);
  return { transaction };
}

export async function deleteTransaction(transactionId: number): Promise<void> {
  await deleteTransactionRequest(transactionId);
}

export async function createDebt(
  input: DebtInput,
): Promise<{ debt: Debt }> {
  const { debt } = await createDebtRequest(input);
  return { debt };
}

export async function payDebt(
  debtId: number,
  paidOn?: string,
  clientOpId?: string,
): Promise<{ debt: Debt }> {
  return payDebtRequest(debtId, paidOn, clientOpId);
}

export async function deleteDebt(debtId: number): Promise<void> {
  await deleteDebtRequest(debtId);
}

export async function createItem(
  input: CreateItemInput,
): Promise<{ item: Item }> {
  const { item } = await createItemRequest(input);
  return { item };
}

export async function updateItem(
  itemId: number,
  input: ItemInput,
): Promise<{ item: Item }> {
  return updateItemRequest(itemId, input);
}

export async function deleteItem(itemId: number): Promise<void> {
  await deleteItemRequest(itemId);
}

export async function stockIn(
  itemId: number,
  input: StockMovementInput,
): Promise<{ item: Item }> {
  const { item } = await stockInRequest(itemId, input);
  return { item };
}

export async function stockOut(
  itemId: number,
  input: StockMovementInput,
): Promise<{ item: Item }> {
  const { item } = await stockOutRequest(itemId, input);
  return { item };
}