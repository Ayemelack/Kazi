# Kazi — Offline-First Verification Report

Date: 2026-09-13
Scope: Add offline-first capability to the Kazi React Native app and its Express + SQLite backend. Work was strictly limited to offline-first functionality; no unrelated files were changed.

## Files changed

### Backend (Express + SQLite, `server/`)
- `server/src/idempotency.ts` (new) — `runIdempotent(db, userId, clientOpId, opType, run)` helper.
- `server/src/db.ts` — added `client_ops` table (`user_id`, `client_op_id`, `op_type`, `response` JSON, `created_at`) and its index.
- `server/src/transactions/validation.ts` — added `clientOpIdSchema`.
- `server/src/debts/validation.ts` — added `clientOpId` to `createDebtSchema`; relaxed `payDebtSchema` from `.strict()` to accept `clientOpId`.
- `server/src/items/validation.ts` — added `clientOpId` to `createItemSchema` and `stockMovementSchema`.
- `server/src/transactions/routes.ts`, `server/src/debts/routes.ts`, `server/src/items/routes.ts` — POST /transactions, POST /debts, POST /debts/:id/pay, POST /items, POST /items/:id/stock-in, POST /items/:id/stock-out now run through `runIdempotent`. Fresh creates respond **201**, replays respond **200** with the stored body.
- `server/src/sync.test.ts` (new), `server/package.json` — idempotency/replay tests wired into the test script.

### Mobile (React Native, `Kazi/`)
- `src/offline/` (new module directory):
  - `types.ts` — `LocalItem/LocalTransaction/LocalDebt/LocalActivity`, `SyncStatus`, `PendingOp` union.
  - `store.ts` — per-user local store, AsyncStorage persistence.
  - `id.ts` — stable `clientOpId` generator.
  - `connectivity.ts` — `/health` probe + connectivity listeners.
  - `repository.ts` — local domain operations + money summary.
  - `sync.ts` — FIFO sync engine with backoff.
  - `refresh.ts` — server cache refresh + merge/dedup.
  - `api.ts` — offline-aware replacements for the screen-facing API functions.
  - `OfflineProvider.tsx` — app shell that rehydrates, probes, syncs.
- `src/components/ui/OfflinePill.tsx` (new) — offline indicator.
- `App.tsx` — wrapped the navigator in `OfflineProvider` (inside `AuthProvider`).
- `src/auth/AuthContext.tsx` — local store wiped on account deletion.
- `src/theme/index.ts` — added `zIndex.offline`.
- `src/i18n/locales/en.ts`, `src/i18n/locales/fr.ts` — `offline` translation block.
- Screens switched to the offline-aware API: `src/screens/home/HomeScreen.tsx`, `history/HistoryScreen.tsx`, `history/TransactionFormScreen.tsx`, `history/AddMoneyScreen.tsx`, `debts/DebtFormScreen.tsx`, `debts/DebtsScreen.tsx`, `products/ProductsScreen.tsx`, `products/ProductFormScreen.tsx`. Queued writes show a "saved on this phone" toast instead of a fake success; History shows a "waiting to sync" badge.
- `__tests__/offline.test.ts` (new) — unit tests for the offline layer.

## Backend idempotency
The backend previously had no way to detect a retried write. Now:
- The client sends a stable `clientOpId` with every create/payment/stock write.
- `runIdempotent` checks `(user_id, client_op_id)`. On first sight it executes the operation and stores its JSON response in `client_ops` inside the same transaction; on a repeat of the same id it **replays the stored response** without touching the tables.
- A lost response can therefore be retried safely — the second attempt returns the already-created record instead of duplicating it. If the write logic fails mid-flight, the operation rolls back along with the stored response, so a later retry still works.

## Local storage
- Everything the app needs offline lives in **AsyncStorage** as a single JSON document per user under `kazi.offline.<userId>`. It survives screen changes, backgrounding and full app restarts.
- Records created online store their real positive `id`; records created offline get locally generated negative ids, and `serverId` is filled in once they sync. The UI always reads through the local store.
- Authentication tokens stay in the Keychain (unchanged); passwords are never stored. Deleting the account purges the per-user store.

## Write path and sync engine
- While connected, writes go straight to the server with a `clientOpId`; on a transient failure (network, timeout, server ≥500) the same operation is written locally with the **same** `clientOpId`, so nothing is lost and nothing duplicates.
- While offline, writes validate locally against the same business rules the server enforces (insufficient stock, quantity-without-item, paying an already-paid debt) and are persisted immediately as pending records paired with a queue operation.
- Business errors (422/400/404/401 — e.g. invalid input, item not found) are never faked; they surface to the user as before.
- The sync engine replays the queue in FIFO order, waiting for dependency ops (an item must reach the server before its sales/stock movements; a debt before its payment). Transient failures back off (5s doubling to 5 min, ±20% jitter). A 401 marks the op failed and stops syncing until re-auth. Failures never delete local data.
- Reads are served from the local store immediately, and a throttled (2 min) background refresh pulls fresh server lists whenever the backend is reachable.

## Duplicate protection
Two layers prevent duplicates:
1. Client: a queued write always reuses the same `clientOpId`, so retries against the server are identical requests.
2. Server: `(user_id, client_op_id)` is a unique key; replays return the stored response. Covered by `server/src/sync.test.ts` for transactions, item create, stock-in and debt create+pay.

## Tests
- **Server**: 63/63 pass (`npm run typecheck` clean, `npm test` in `server/`). New idempotency tests verify a replayed create returns the original record and does not change counts.
- **Mobile**: `npx tsc --noEmit`, `npx eslint . --max-warnings=0`, `npx jest --silent` — 97/97 pass (78 existing + 19 new offline tests). The new suite covers: offline sale surviving a simulated app restart (persistence + stock effect + queue), user isolation, reset/wipe, insufficient-stock rejection offline, quantity rules, debt create→pay FIFO ordering and already-paid rejection, pending-record cancellation, money summary math, the API's server-first/fallback behavior (including clientOpId reuse and rethrowing business errors), and the sync engine (skip without token, flush in order filling serverIds, 401 → failed/stop).

## Limitations (known)
- Editing or deleting a **synced** record requires connectivity (throws `offline.notAvailableOffline`). Only records created offline can be cancelled while offline.
- Local data is per-device; changes made on another device while this one is offline appear only after the throttle/manual reconnect refresh.
- "No network" and "backend down" are not visually distinguished; both show the same offline indicator (a `/health` probe decides).
- The 401-stopped queue needs a fresh sign-in before syncing resumes.
- E2E behaviour on a device (airplane-mode launch, reconnect sync, indicator hiding) was verified by the unit/integration tests above, not on a physical build.

## Unrelated changes
None. No authentication, UI, branding, or business logic was altered except the offline-write wiring and leaf view changes required to read from the local store. The stale typo'd account in `server/data/kazi.db` was intentionally not touched.