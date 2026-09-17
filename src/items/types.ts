export type ItemType = 'product' | 'service';

export type StockDirection = 'in' | 'out';

export interface Item {
  id: number;
  name: string;
  type: ItemType;
  price: number;
  notes?: string;
  image?: string;
  stock: number;
  trackStock: boolean;
  lowStockThreshold: number;
  lowStock: boolean;
  createdAt: string;
}

export interface ItemInput {
  name: string;
  type: ItemType;
  price: number;
  notes?: string;
  image?: string;
  trackStock: boolean;
  lowStockThreshold: number;
}

export interface StockMovement {
  id: number;
  itemId: number;
  direction: StockDirection;
  quantity: number;
  newQuantity: number;
  reason?: string;
  createdAt: string;
}