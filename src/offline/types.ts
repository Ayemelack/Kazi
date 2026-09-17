import type { ActivityType } from '../activity/types';
import type { Item } from '../items/types';
import type { Transaction } from '../transactions/types';
import type { Debt } from '../debts/types';

// Local sync status of a record. Kept simple and user facing:
// synced = on the server, pending/waiting = stored on this phone.
export type SyncStatus = 'synced' | 'pending' | 'syncing' | 'failed';

// A record stored on the phone. `id` is the local identifier used by the UI:
//   - positive: matches the server id (record was created or fetched online)
//   - negative: a locally generated id for a record created offline that has
//     not reached the server yet; `serverId` is filled in once it syncs.
export interface LocalItem extends Item {
  syncStatus: SyncStatus;
  serverId?: number;
}

export interface LocalTransaction extends Transaction {
  syncStatus: SyncStatus;
  serverId?: number;
}

export interface LocalDebt extends Debt {
  syncStatus: SyncStatus;
  serverId?: number;
}

export interface LocalActivity {
  id: number;
  clientOpId?: string;
  syncStatus: SyncStatus;
  type: ActivityType;
  title?: string;
  amount?: number;
  quantity?: number;
  eventDate?: string;
  createdAt: string;
}

export type PendingOp =
  | {
      clientOpId: string;
      kind: 'transaction_create';
      localId: number;
      payload: {
        type: Transaction['type'];
        amount: number;
        description?: string;
        date: string;
        itemId?: number;
        quantity?: number;
      };
      status: SyncStatus;
      attempts: number;
      nextAttemptAt: number;
      lastError?: string;
    }
  | {
      clientOpId: string;
      kind: 'debt_create';
      localId: number;
      payload: {
        name: string;
        amount: number;
        note?: string;
        date: string;
      };
      status: SyncStatus;
      attempts: number;
      nextAttemptAt: number;
      lastError?: string;
    }
  | {
      clientOpId: string;
      kind: 'debt_pay';
      localId: number;
      status: SyncStatus;
      attempts: number;
      nextAttemptAt: number;
      lastError?: string;
    }
  | {
      clientOpId: string;
      kind: 'item_create';
      localId: number;
      payload: {
        name: string;
        type: Item['type'];
        price: number;
        notes?: string;
        image?: string;
        trackStock: boolean;
        lowStockThreshold: number;
      };
      status: SyncStatus;
      attempts: number;
      nextAttemptAt: number;
      lastError?: string;
    }
  | {
      clientOpId: string;
      kind: 'stock_in' | 'stock_out';
      localId: number;
      quantity: number;
      reason?: string;
      status: SyncStatus;
      attempts: number;
      nextAttemptAt: number;
      lastError?: string;
    };