import type { ActivityRefType, ActivityType } from '../activity/types';

// Local sync status of a record. Kept simple and user facing:
// synced = on the server, pending/waiting = stored on this phone.
export type SyncStatus = 'synced' | 'pending' | 'syncing' | 'failed';

// An entry in the History feed as the screens see it. Kazi is online-only, so
// every event comes from the server with syncStatus 'synced'; History still
// renders a "waiting to sync" hint for any other status.
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
  refType?: ActivityRefType;
  refId?: number;
}
