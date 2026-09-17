import { apiRequest } from '../api/client';
import type { Item, ItemInput, StockMovement } from './types';

export interface StockMovementInput {
  quantity: number;
  reason?: string;
}

export function listItems(): Promise<{ items: Item[] }> {
  return apiRequest<{ items: Item[] }>('/items', { auth: true });
}

export function getItem(itemId: number): Promise<{ item: Item }> {
  return apiRequest<{ item: Item }>(`/items/${itemId}`, { auth: true });
}

export function createItem(input: ItemInput): Promise<{ item: Item }> {
  return apiRequest<{ item: Item }>('/items', {
    method: 'POST',
    body: input,
    auth: true,
  });
}

export function updateItem(itemId: number, input: ItemInput): Promise<{ item: Item }> {
  return apiRequest<{ item: Item }>(`/items/${itemId}`, {
    method: 'PUT',
    body: input,
    auth: true,
  });
}

export function deleteItem(itemId: number): Promise<void> {
  return apiRequest<void>(`/items/${itemId}`, {
    method: 'DELETE',
    auth: true,
  });
}

export function stockIn(
  itemId: number,
  input: StockMovementInput,
): Promise<{ item: Item; movement: StockMovement }> {
  return apiRequest<{ item: Item; movement: StockMovement }>(`/items/${itemId}/stock-in`, {
    method: 'POST',
    body: input,
    auth: true,
  });
}

export function stockOut(
  itemId: number,
  input: StockMovementInput,
): Promise<{ item: Item; movement: StockMovement }> {
  return apiRequest<{ item: Item; movement: StockMovement }>(`/items/${itemId}/stock-out`, {
    method: 'POST',
    body: input,
    auth: true,
  });
}

export function listStockMovements(
  itemId: number,
): Promise<{ movements: StockMovement[] }> {
  return apiRequest<{ movements: StockMovement[] }>(`/items/${itemId}/movements`, {
    auth: true,
  });
}