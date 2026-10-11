# Kazi — Design Architecture

How Kazi is built today, the rules every change must follow, and the target shape after the
tasks in [PROJECT_TRACKER.md](PROJECT_TRACKER.md) are done. Sections marked **Target** describe
planned changes and name the task that delivers them.

---

## 1. Product scope

Kazi is a trilingual (English / French / Cameroonian Pidgin) digital business notebook for small
businesses in Cameroon. An owner can:

- keep a catalog of products and services, with optional stock tracking and low-stock alerts;
- record sales (money in), expenses (money out) and capital (owner's own money put in);
- note debts (money owed to them) and mark them paid;
- see today's totals on Home and a day-by-day history with period totals.

Design priorities, in order: **correct money data → security → speed on low-end Android phones and
slow networks → simplicity**.

---

## 2. System context

```mermaid
flowchart LR
  subgraph Phone["Owner's phone"]
    App["Kazi app<br/>React Native 0.87 · Hermes"]
    KC[("Keychain / Keystore<br/>session token")]
    AS[("AsyncStorage<br/>profile, language")]
  end
  subgraph Server["Kazi server (single host)"]
    Proxy["Reverse proxy<br/>TLS · gzip"]
    API["Kazi API<br/>Express 4 · Node ≥ 22"]
    DB[("SQLite (WAL)<br/>data/kazi.db")]
    Admin["Admin dashboard<br/>read-only · 127.0.0.1:4100"]
  end
  FCM["Firebase Cloud Messaging"]
  Owner["Kazi owner (operator)"]

  App -- "HTTPS JSON" --> Proxy --> API --> DB
  App --- KC
  App --- AS
  API -- "push (data-only)" --> FCM --> App
  Admin -- "read-only" --> DB
  Owner -- "SSH tunnel" --> Admin
```

The reverse proxy, TLS and SSH-tunnel access are the **target** deployment ([DEPLOYMENT.md](DEPLOYMENT.md)).
Today the API serves plain HTTP on port 4000.

---

## 3. Repository layout

```
kazi/
  App.tsx, index.js       App entry: language boot, providers, navigator, FCM background handler
  src/                    Mobile app (see §4)
  android/, ios/          Native projects (package com.kazi.app)
  __tests__/              Jest tests for the app
  shared/                 @kazi/shared: contracts both sides import (ADR A10)
    src/                  Pure TypeScript; tests run with node --test
    dist/                 Build output (ESM + .d.ts, git-ignored), what app and server load
  server/src/             API (see §5) and admin dashboard (server/src/admin)
    db/                   openDatabase(), migration runner (§6.1)
      migrations/         Numbered migrations NNNN_<name>.ts
  .github/workflows/      CI: ci.yml (app, server, audit; release jobs are manual placeholders)
  docs/                   This documentation set
```

**Shared contracts.** Anything the app and the API must agree on — limits, parsers, error codes,
types — lives once in `shared/src`. The package has no runtime dependencies and no Node or React
Native APIs (its `tsconfig.json` has no `types` and no DOM lib, so the compiler rejects them).
It is built with `tsc` and consumed through `file:` links: `"@kazi/shared": "file:./shared"`
(app) and `"file:../shared"` (server). Metro watches `shared/` and follows the symlink; Jest
transforms `shared/dist` with the app's Babel config; the server resolves it with NodeNext. Install
`shared/` first (its `prepare` script builds `dist/`) and rebuild it after editing.

---

## 4. Mobile app

### 4.1 Layers

```
screens/*            UI, form state, navigation           (no fetch calls)
   │
offline/api.ts       Facade the screens import            (pass-through today)
   │
<domain>/api.ts      items, transactions, debts, activity, summary, auth, feedback
   │
api/client.ts        apiRequest(): token, timeout, error mapping → ApiError / NetworkError
   │
fetch → HTTPS → API
```

Rules:

- Screens never call `fetch` directly; they go through the facade.
- All user-visible text goes through i18next (`src/i18n/locales/{en,fr,pid}.ts`); the parity test
  keeps the three locales in sync.
- Validation lives in `<domain>/validation.ts` and returns **translation keys**, never text.
- Forms show errors through `useFormErrors` (`src/forms/`, KZ-22): a field's error appears once the
  field is touched or after a Save attempt, and Save is disabled only while an error is visible.
- Request errors reach the user only through `errorMessage()` in `src/errors/messages.ts`
  (§5.4); `err.message` is never rendered (guarded by `__tests__/source.guards.test.js`).

### 4.2 App-wide state

| Provider | Holds | Notes |
|---|---|---|
| `AuthProvider` | `status`, `user`, auth actions | Token in Keychain (`WHEN_UNLOCKED_THIS_DEVICE_ONLY`), profile cached in AsyncStorage |
| `OfflineProvider` | `online` flag + offline pill | Event-driven via NetInfo (KZ-01): Android uses the OS's validated-internet signal; iOS checks `https://connectivitycheck.gstatic.com/generate_204` only while the app is active. No timer. Unknown reachability counts as online |
| `ToastProvider` | Transient messages | |

Screen data is loaded on focus (`useFocusEffect`) and kept in local component state. There is no
global data store.

### 4.3 Navigation

```
RootNavigator
├─ AuthFlow (stack): Welcome · Login · Signup · ForgotPassword · ResetPassword
└─ AppStack
   ├─ BusinessProfile             (shown until the user has a business)
   └─ MainTabs
      ├─ Home
      ├─ Products (stack): ProductsList · ProductForm
      ├─ History  (stack): HistoryList · TransactionForm · AddMoney · Debts · DebtForm
      └─ More     (stack): MoreHome · MyBusiness · Feedback · Support · Privacy · Terms · DeleteAccount
```

**Target (KZ-07):** add a transaction detail screen under History, reached by tapping a sale,
expense or capital row, with Delete (and later Edit).

### 4.4 Connectivity model

Kazi is **online-only**: reads hit the server and writes wait for the server's answer. Nothing is
queued on the phone. The backend keeps an idempotency ledger so that a retried write is safe
(see §5.5).

**Target (decision D7):** an optional read-only cache of the last Home, Products and History
results so screens render instantly and show "last updated" data when offline. Writes stay online.

---

## 5. API

### 5.1 Request pipeline

```
express()
 ├─ disable x-powered-by
 ├─ security headers (nosniff, DENY frames, no-referrer, Cache-Control: no-store)
 ├─ CORS (denied unless CORS_ORIGIN is set)
 ├─ express.json({ limit: '4mb' })        Target (KZ-14): lower once images move out of JSON
 ├─ /health
 ├─ /auth  /items  /transactions  /debts  /summary  /activity  /feedback  /notifications
 │     └─ router: requireAuth → validate(zod) → runIdempotent? → service (SQL) → JSON
 ├─ 404 handler
 └─ errorHandler → { error: { code, message } }
```

**Target:** `trust proxy` set from config (KZ-08), request timing and structured logs (KZ-34).

### 5.2 Module pattern

Each domain folder has the same three files:

| File | Responsibility |
|---|---|
| `routes.ts` | HTTP only: parse, call the service, pick the status code |
| `validation.ts` | zod schemas; numbers go through `strictNumber`, money through `moneyAmountSchema`, dates through `businessDateSchema` |
| `service.ts` | SQL and business rules; always scoped by `user_id`; multi-step writes in `db.transaction` |

### 5.3 Authentication and sessions

- Passwords: bcrypt (cost 10). **Target (KZ-21):** async hashing so the event loop is never blocked.
- Session: HS256 JWT, 30 days, carries `sub` and `ver` (`users.token_version`). `requireAuth`
  checks the version on every request, so a password reset invalidates old tokens.
- **Target (KZ-13, decision D4):** 15-minute access token + rotating refresh token stored hashed in
  a `sessions` table; logout and "log out everywhere" revoke server-side.
- Password reset: **Target (KZ-06):** 6-digit code, hashed, 15-minute expiry, 5 attempts,
  delivered by SMS/email (decision D2), never returned in the HTTP response.

### 5.4 Error contract

Every error is `{ "error": { "code": "<CODE>", "message": "<English text>", "field"?, "rule"? } }`
(type `ApiErrorBody` in `shared/src/errors.ts`).

- `code` is one of `API_ERROR_CODES` in `@kazi/shared`; `server/src/errors.ts` types `AppError`
  with it, so an unknown code does not compile. It is what the app uses.
- `message` is for logs and developers. The app never shows it.
- A `VALIDATION_ERROR` also carries `rule` (one of `VALIDATION_RULES`: `required`, `invalid`,
  `format`, `tooShort`, `tooLong`, `tooSmall`, `tooLarge`, `tooEarly`, `tooLate`, `notAllowed`)
  and, when the failure is about one request field, `field` (one of `VALIDATION_FIELDS`). Both come
  from the first zod issue (`issueDetail()`); a refinement names its rule with
  `params: { rule }`, and errors thrown by services pass `{ field, rule }` to `AppError`.
- App (KZ-12): `src/errors/messages.ts` is the only place that turns an error into text:
  `errors.codes.<CODE>`, or `errors.validation.<rule>` with the label `errors.fields.<field>`;
  `NetworkError` → `errors.offline`; `SERVER_UNREACHABLE` (app-side code) →
  `errors.serverUnreachable`; anything else → `errors.generic`. A screen may override a code's
  wording (the reset screen words `INVALID_TOKEN` as a bad reset code). Screens keep the error
  object in state and translate it while rendering, so a language switch re-translates it.
  Tests require a key for every code, rule and field in all three locales.

### 5.5 Idempotency

`client_ops(user_id, client_op_id, op_type, response)`. A write that carries a `clientOpId` is run
once; a repeat with the same id and type replays the stored response, a repeat with a different
type returns `409 IDEMPOTENCY_CONFLICT`. Applies to item create, stock in/out, transaction create,
debt create and debt pay.

**Target (KZ-11):** the app generates one `clientOpId` per form submission and reuses it on retry.

### 5.6 Activity log

Every money or catalog change writes an `activity` row in the same transaction, with
`ref_type`/`ref_id` pointing back at the source record. Deleting the source deletes its activity
rows, so History totals always agree with the source tables.

**Target (KZ-07):** `GET /activity` returns `refType` and `refId` so the app can open and delete
the source record from History.

### 5.7 Admin dashboard

A separate Express process (`server/src/admin`). Opens the database with `readonly: true` and
`query_only = ON`; its own credentials (scrypt), in-memory sessions, `HttpOnly; SameSite=Strict`
cookie, strict CSP, login throttling. App tokens mean nothing there. Binds to `127.0.0.1` by default.

---

## 6. Data model

```mermaid
erDiagram
  users ||--o{ items : owns
  users ||--o{ transactions : owns
  users ||--o{ debts : owns
  users ||--o{ activity : owns
  users ||--o{ feedback : writes
  users ||--o{ push_tokens : has
  users ||--o{ password_resets : has
  users ||--o{ client_ops : has
  items ||--o{ stock_movements : has
  items |o--o{ transactions : "linked (SET NULL on delete)"
```

| Table | Key columns | Notes |
|---|---|---|
| `users` | email (unique, lower-case), password_hash, token_version, company_name, business_type, language | |
| `items` | type (product/service), price (INTEGER FCFA ≥ 0), stock, track_stock, low_stock_threshold, image | **Target (KZ-14):** image moves to its own table |
| `stock_movements` | direction, quantity, new_quantity, reason | Audit trail of stock |
| `transactions` | type (sale/purchase/capital), amount (INTEGER FCFA > 0), item_id, quantity, date (YYYY-MM-DD) | |
| `debts` | name, amount (INTEGER FCFA > 0), date, status (open/paid), paid_at | |
| `activity` | type, title, amount (INTEGER FCFA or NULL), quantity, event_date, ref_type, ref_id | History feed |
| `client_ops` | (user_id, client_op_id) PK, op_type, response | Idempotency ledger |
| `password_resets` | token (SHA-256), expires_at, used | |
| `password_fingerprints` | HMAC of password | **Target (KZ-05):** remove |
| `push_tokens` | token (unique), platform | |
| `feedback` | rating 1–5, liked, disliked, suggestion | |

### 6.1 Migrations

The schema changes only through numbered migrations in `server/src/db/migrations/`
(`NNNN_<name>.ts`, listed in order in `migrations/index.ts`). `openDatabase()` in
`server/src/db/index.ts` sets `journal_mode = WAL` and `foreign_keys = ON`, then
`runMigrations()` (`server/src/db/migrate.ts`) applies every migration newer than the highest
version in `schema_migrations(version INTEGER PRIMARY KEY, name TEXT, applied_at TEXT)`:

1. For each pending migration: `foreign_keys = OFF` (so tables can be rebuilt), then one
   transaction that runs `up(db)`, runs `PRAGMA foreign_key_check` (any violation throws and rolls
   the migration back), and records the version; then `foreign_keys = ON`.
2. A failure stops the server from starting; earlier migrations stay committed.
3. A database whose version is newer than the build logs a warning and is left alone (rollback to
   the previous release, see [DEPLOYMENT.md](DEPLOYMENT.md) §4).

`0001_baseline` is the schema as it stood when the framework was introduced (2026-10-10): the
original `CREATE … IF NOT EXISTS` statements (SQL text unchanged), every column added later with
`addColumnIfMissing`, the `activity.event_date` backfill and the rebuild that lets `transactions`
hold `'capital'`. Every step is idempotent, so the same migration creates a fresh database and
baselines a database created before `schema_migrations` existed, without data loss; both end with
an identical `sqlite_master` (tested). It also restores `idx_transactions_user_type_date`, which the
old rebuild dropped (KZ-26).

`0002_integer_money` (KZ-25) rebuilds `items`, `transactions`, `debts` and `activity` so every
money column is `INTEGER` with `CHECK (typeof(x) = 'integer' …)` (INTEGER affinity alone would
still store 12.5 as a REAL). Old values are rounded half away from zero; a positive amount below
0.5 becomes 1 so `amount > 0` still holds. It logs one warning with the number of rounded rows per
table, never the values.

Rules for new migrations:

- Never edit a migration that has shipped; add a new file with the next number.
- SQLite can't change a column type or CHECK in place: rename the old table aside, create the new
  one under its real name (so `sqlite_master` keeps an unquoted name), copy, drop the old one, then
  recreate **every** index; preserve `sqlite_sequence` when ids must not be reused. If other tables
  reference the rebuilt one, do the rename with `PRAGMA legacy_alter_table = ON`, or SQLite
  rewrites their `REFERENCES` to the copy that is about to be dropped. `rebuild()` in
  `0002_integer_money.ts` does all of this.
- Test each migration on a fresh database and on a database with the previous schema and data
  (`server/src/db/migrations.test.ts`; `legacyFixtures.ts` holds the frozen pre-framework code).

---

## 7. Cross-cutting rules

### 7.1 Business dates and time zones

- A business date is a calendar day in the **owner's** time zone, always `YYYY-MM-DD`, chosen on
  the phone. It is never derived from a server timestamp.
- Any endpoint that answers "today", "yesterday" or "this week" takes `asOf` from the phone.
  `/activity` does; **Target (KZ-10):** `/summary` will too.
- Instants (`created_at`, `paid_at`) are UTC.
- The accepted window is `BUSINESS_DATE_MIN` (2000-01-01) to today + 365 days (`@kazi/shared`
  `date.ts`); the API, the app's validators and the date picker all use it (KZ-16).

### 7.2 Money

- Currency is FCFA (XAF), which has no minor unit.
- **Input (KZ-04, done):** every money field (sale, expense, capital, debt, product price) reads
  text with `parseMoneyInput` from `@kazi/shared`: spaces ignored, `,` or `.` only as thousands
  separators in groups of three, anything else rejected. The parsed value is shown under the field
  as the user types (`= 1 000 FCFA`). The API accepts only a JSON integer or a digit string
  (`moneyAmountSchema`, `priceSchema`), at most `MONEY_MAX`.
- **Storage (KZ-25, done):** `INTEGER` money columns with integer CHECKs (§6.1, migration 0002).
- **Display (KZ-25, done):** one formatter, `formatMoney` from `@kazi/shared`: `1 000 FCFA` with
  the narrow no-break space (U+202F) between groups and before `FCFA`, so an amount never wraps.
  The app uses it for every amount and price; the admin dashboard loads the same built module from
  `/shared/index.js` (served from `node_modules/@kazi/shared/dist`).

### 7.3 Internationalisation

- Locales: `en`, `fr`, Pidgin. **Target (KZ-24):** rename the Pidgin code from `pid` (which is the
  ISO code for Piaroa) to a private-use tag such as `x-pidgin-cm` or `en-CM`, and keep the
  user's choice on the server.
- No user-facing English text may come from the server: errors are translated by code (KZ-12,
  §5.4).

### 7.4 Validation parity

The API is the authority; the app mirrors its limits so users see errors before submitting.
Since KZ-16 there is one copy: `shared/src/limits.ts` (lengths, quantity and threshold max,
password 8 characters min / 72 UTF-8 bytes max, page sizes, client-op-id length), `MONEY_MAX` and
the business-date window. Server zod schemas and app validators both import it, and the app's
`maxLength` props name the same constants. Each side boundary-tests every limit, so a validator
that stops using the shared constant fails a test.

---

## 8. Key flows

### 8.1 Record a sale of a tracked product

```mermaid
sequenceDiagram
  participant S as TransactionForm
  participant C as apiRequest
  participant R as /transactions
  participant DB as SQLite
  S->>C: createTransaction({type:'sale', amount, itemId, quantity, date, clientOpId})
  C->>R: POST (Bearer token, 15 s timeout)
  R->>R: requireAuth → zod validate → runIdempotent
  R->>DB: BEGIN
  R->>DB: stockOut(item, qty) → items.stock, stock_movements
  R->>DB: INSERT transactions
  R->>DB: INSERT activity (ref = transaction)
  R->>DB: INSERT client_ops (response)
  R->>DB: COMMIT
  R-->>S: 201 { transaction }
```

If the response is lost and the user taps Save again, the same `clientOpId` replays the stored
response: no second sale, no second stock movement (after KZ-11).

### 8.2 App start

1. Load stored language → initialise i18next.
2. Read token from Keychain. None → AuthFlow.
3. `GET /auth/me`. 200 → AppStack. 401 → clear token → AuthFlow. Network error → use cached
   profile. **Target (KZ-17):** if there is no cached profile, show a retry screen instead of
   AppStack with no user.
4. Authenticated → request notification permission → register FCM token.

---

## 9. Architecture decisions

| ADR | Decision | Status | Why |
|---|---|---|---|
| A1 | Online-only app, server is the source of truth | Accepted | The offline-first attempt was abandoned (see `OFFLINE_FIRST_VERIFICATION.md`); a single source avoids sync conflicts on money data |
| A2 | SQLite (WAL) on one server | Accepted | Very low ops cost; plenty for the expected scale. Revisit at roughly 50 writes/s sustained or when a second API instance is needed |
| A3 | Idempotency ledger for writes | Accepted | Makes retries on flaky mobile networks safe |
| A4 | Activity log written in the same transaction as the source record | Accepted | History can never disagree with the source tables |
| A5 | Separate read-only admin process | Accepted | App users can never reach admin data; admin cannot write |
| A6 | Whole-number FCFA everywhere | Accepted (2026-10-11, KZ-04, KZ-25) | Removes the decimal-separator ambiguity that corrupts amounts |
| A7 | Short-lived access token + refresh token | Proposed (KZ-13, D4) | Real logout and revocation |
| A8 | Images stored and served separately from item JSON | Proposed (KZ-14) | Keeps list payloads small on 3G |
| A9 | Error codes, not messages, drive the UI | Proposed (KZ-12) | Correct language for every user |
| A10 | One shared contracts package (`@kazi/shared`, built with tsc, `file:` links) | Accepted (2026-10-10, session 1) | App and API can't drift on limits, parsers and codes. Metro 0.87 (symlinks + `exports` on by default), Jest and NodeNext all resolved the link without workarounds, so the path-mapped-source fallback wasn't needed |
| A11 | Numbered migrations recorded in `schema_migrations`, one transaction each, `foreign_key_check` before commit | Accepted (2026-10-10, session 1) | Each schema change runs exactly once, in order, all-or-nothing; pre-framework databases are baselined in place (§6.1) |

Add a row for every new architectural decision, and update the status when it changes.

---

## 10. Scaling path (for later, not needed for launch)

1. Vertical: bigger host, SQLite stays (handles thousands of shops comfortably).
2. Move rate limiting and admin sessions to a shared store before running more than one API process.
3. Move to PostgreSQL only when write concurrency or multi-region needs require it. Services already
   isolate SQL per domain, which keeps that move contained.
