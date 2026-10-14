# Kazi

Kazi is a simple, secure, trilingual (English / French / Cameroon Pidgin) digital business
notebook for small businesses in Cameroon. It helps you track what you sell, what you buy, what
you have in stock, who owes you money, and how much money is moving through the business —
without the complexity of a full accounting system.

The project is split into two parts:

- **`Kazi/`** — the React Native mobile app (Android + iOS).
- **`Kazi/server/`** — the Node.js + TypeScript + SQLite backend API.

Both are built for the value proposition: *"Your business, kept simple."*

---

## Features

- **Accounts** — sign up, sign in, forgot/reset password, update your name or business profile,
  delete your account. Sessions are 30-day JWTs stored in the device Keychain; passwords are
  hashed with bcrypt and a password another account already uses is refused.
- **Products & services** — a catalog of what you sell, each with a name, type (product or
  service), price and optional notes.
- **Inventory** — optional stock tracking per item: record stock in/out (with reasons), get a
  low-stock alert above a threshold you choose, and see stock badges in the product list.
- **Transactions** — record money in (**sales**) and money out (**purchases**), optionally linked
  to a catalog item. A sale of a tracked item reduces its stock automatically; a purchase
  increases it. Deleting a transaction reverses its stock effect.
- **Expenses without a product** — an expense does not need a catalog entry: pick a preset
  (transport, rent, worker pay, …) or say what the money was spent on. The description is
  required and is enforced identically on the app and the API.
- **Add money** — record cash you put into the business from your own pocket (capital), separate
  from sales.
- **Debts** — note money someone owes you, see what is still owed versus settled, and settle a
  debt with the day it was paid. Dates of record are shown as `YYYY-MM-DD`.
- **History** — a "What happened" feed of every sale, expense, capital, debt and product change,
  grouped by day with received/spent/made totals. Filter by period (today, yesterday, this week,
  older) or by a custom from–to range; long lists page with "Load more".
- **Cash balance** — the Home dashboard shows money received, money spent, money made for today,
  plus low-stock alerts.
- **Trilingual** — English, French and Cameroon Pidgin, detected from the device and switchable
  in the More tab.

---

## Repository layout

```
Kazi/
  App.tsx                     App entry (language boot, providers, navigator)
  src/
    activity/     history query types + API (periods, ranges, summaries)
    api/          HTTP client + env config
    auth/         auth types, session context, validation, error mapping
    components/   shared UI (Button, Card, TextField, dialogs, toast, logo…)
    config/       env.ts (API host for the dev backend)
    debts/        debt types, API, client validation
    errors/       ApiError / NetworkError
    feedback/     in-app feedback API
    i18n/         i18next setup + en / fr / wes (Cameroonian Pidgin) translations
    items/        catalog types, API, client validation, formatting
    money/        FCFA formatter + balance math
    navigation/   root stack, tabs, auth flow, param lists
    notifications/ push-token registration API
    offline/      online API facade + NetInfo connectivity (no local queue)
    screens/      auth · home · products · history · debts · business · more
    storage/      Keychain (secure) + AsyncStorage (preferences)
    summary/      money summary API
    theme/        colors, spacing, typography
    transactions/ transaction types, API, client validation
  android/  android/…   native Android project (package com.kazi.app)
  ios/                native iOS project
  __tests__/          jest unit tests
  shared/             @kazi/shared — contracts imported by both app and server
    src/              pure TypeScript (no runtime deps, no Node/RN APIs) → built to dist/
  .github/workflows/  ci.yml — app, server and audit jobs on every push / PR
  server/
    src/
      activity/     activity feed (period/range filters, pagination)
      admin/        owner-only read-only dashboard (separate port, optional TLS)
      auth/         signup, login, password reset, JWT, password fingerprints
      debts/        debt CRUD + pay
      feedback/     in-app feedback
      items/        catalog CRUD + stock in/out
      middleware/   auth + rate limiting
      notifications/ push tokens + FCM send
      summary/      money received / spent / net
      transactions/ sale / purchase / capital + stock effects
      validation/   shared zod helpers (money, business dates, strict numbers)
      db/           openDatabase() + migration runner (schema_migrations)
        migrations/ numbered schema migrations (0001_baseline, …)
      app.ts errors.ts idempotency.ts index.ts log.ts
    data/       SQLite database (git-ignored, created on first boot)
    .env        runtime secrets (git-ignored)
```

---

## Running the backend

Requirements: **Node.js ≥ 22.11**.

```sh
(cd shared && npm install)   # first time only — builds @kazi/shared, which the API imports
cd server
npm install            # first time only
cp .env.example .env   # first time only — set a real JWT_SECRET
npm run dev            # starts the API on http://localhost:4000 (auto-reloads)
```

The API listens on port `4000` by default (override with `PORT`). It creates its SQLite
database at `server/data/kazi.db` on first boot and applies any pending numbered migrations
(`server/src/db/migrations/`) on every boot.

> **Dev note:** there is no email service yet. Outside production, `POST /auth/forgot-password`
> returns the reset code in the response body so the app flow can be tested end to end. In
> production (`NODE_ENV=production`) the code is never returned, so a real sender must be added
> before the reset flow can be used there.

Useful scripts:

| Command                | What it does                                    |
| ---------------------- | ------------------------------------------------ |
| `npm run dev`          | Start the API with auto-reload (`tsx watch`)     |
| `npm run typecheck`    | Type-check the API                               |
| `npm test`             | Run the API test suite (node --test)             |
| `npm run build`        | Compile to `dist/`                               |
| `npm start`            | Run the compiled `dist/` build                   |
| `npm run check`        | Typecheck + tests + build                        |

### API overview

Authorized endpoints take `Authorization: Bearer <token>`. Errors always use the shape
`{ "error": { "code": "...", "message": "..." } }`.

| Mount | Endpoints |
| ----- | --------- |
| `/auth` | `POST /signup`, `POST /login`, `POST /logout`, `GET /me`, `PATCH /me`, `PATCH /me/names`, `PATCH /me/language`, `DELETE /me`, `POST /forgot-password`, `POST /reset-password` |
| `/items` | `GET/POST /`, `GET/PUT/DELETE /:id`, `POST /:id/stock-in`, `POST /:id/stock-out`, `GET /:id/movements` |
| `/transactions` | `GET/POST /`, `GET/DELETE /:id` |
| `/debts` | `GET/POST /`, `POST /:id/pay`, `DELETE /:id` |
| `/summary` | `GET /` — money received, spent and net |
| `/activity` | `GET /` — `period`, `from`/`to` range, `asOf`, `limit`/`offset`, per-type totals |
| `/feedback` | `GET/POST /`, `GET/DELETE /:id` |
| `/notifications` | `POST /push-tokens`, `DELETE /push-tokens`, `POST /send` |
| `/health` | `GET /` — liveness probe (no auth) |

Every query is scoped to the authenticated user, and business dates (`transactions.date`,
`debts.date`, `activity.event_date`) are filtered in the caller's own time zone via `asOf`.
Create, payment and stock writes carry a `clientOpId` in the body: a retried request replays the
stored response instead of duplicating the record, and reusing the same id for a different
operation returns `409 IDEMPOTENCY_CONFLICT`.

Authentication and password-reset routes are rate-limited (signup/forgot/reset: 12 per 15 min,
login: 25 per 15 min), as is `POST /notifications/send` (10 per minute).

The owner-only read-only dashboard runs as a **separate server** — `server/src/admin/`, default
`http://127.0.0.1:4100` with optional TLS and a `HttpOnly; SameSite=Strict` session cookie —
exposing `/api/stats`, `/api/series`, `/api/activity`, `/api/feedback` and `/api/users`.

---

## Running the mobile app

Requirements: React Native 0.87 toolchain (Android SDK / Xcode), Node ≥ 22.11.

```sh
# 1. Start the backend API (see above), then:
npm install
npm start          # starts Metro
npm run android    # build + launch on the connected device/emulator
```

The app talks to the dev backend at `Kazi/src/config/env.ts`:

| Where you run the app         | Host it should use                |
| ----------------------------- | --------------------------------- |
| Android emulator (default)    | `10.0.2.2` — reaches the host PC  |
| iOS simulator                 | `localhost` (already set)         |
| Physical Android/iOS device   | your computer's LAN IP, e.g. `192.168.1.20` |

To test on a physical device, change `DEV_API_HOST` in `src/config/env.ts` to your PC's LAN IP and
keep your phone on the same network.

### Install the debug APK (no dev machine needed on the phone)

```sh
cd android && ./gradlew assembleDebug
```

Then copy `android/app/build/outputs/apk/debug/app-debug.apk` to the phone and open it to install.
The debug build loads JavaScript from Metro, so keep `npm start` running on the PC while testing.
For a standalone build, use `assembleRelease` (requires a signing configuration added in
`android/app/build.gradle`).

### Tests & checks

Install order matters on a fresh clone: `shared/` first (its `prepare` script builds
`shared/dist`), then the app and the server.

```sh
(cd shared && npm ci) && npm ci && (cd server && npm ci)

npm run check        # everything: shared, then app typecheck + lint + Jest, then server typecheck + tests + build
npm run typecheck    # app types only (npx tsc --noEmit)
npm run lint
npm test             # Jest: validation, formatting, screens, i18n parity
cd server && npm run check    # server only
cd shared && npm run check    # shared only (typecheck + node --test + build)
```

After editing `shared/src`, rebuild it (`npm run check` at the root does) so the app and server
see the change. CI (`.github/workflows/ci.yml`) runs the same checks on every push and pull
request, plus a dependency audit.

---

## Testing everything together

1. Start the backend: `cd server && npm run dev`.
2. Anticipate: `npm run check` passes — backend 111 tests (10 files), mobile 110 tests
   (13 suites), shared 1 test, clean `tsc`/`eslint` — and a successful `assembleDebug`.
3. Run the app from Metro. Create an account, add products/services, toggle stock tracking, add
   stock, record a sale (watch stock drop), record a purchase (watch it rise), add money, and
   confirm the Home balance and History feed update.

---

## Security notes

- Passwords are never stored in plain text (bcrypt). Tokens live only in the device Keychain.
- A password another account already uses is refused at signup and at password reset: each
  account stores salted fingerprints of the passwords it has used, recorded when the password is
  first used (signup or a successful sign-in).
- Every query is scoped to the authenticated user; no endpoint exposes other users' data
  (covered by tests).
- Input is validated with zod on both sides. Money, business dates and page limits reject hex
  strings, booleans and non-finite numbers instead of coercing them, and out-of-range paging
  returns `400` rather than a server error.
- Auth, password-reset and push-send routes are rate-limited. API responses omit `X-Powered-By`;
  admin dashboard responses are `Cache-Control: no-store`.
- `JWT_SECRET` must be at least 32 random bytes: with `NODE_ENV=production` the API refuses to
  start with a shorter value or the `.env.example` placeholder (see `.env.example`).
- The SQLite DB and `.env` are git-ignored — never commit them.
- Transport is HTTP in development. Production should terminate TLS in front of the API.
- Known accepted limitation: signup and forgot-password reveal whether an email is registered.
  Documented in `SECURITY_ASSESSMENT.md`.

## Known environment notes

- On networks where Android SDK/NDK auto-downloads fail, install the NDK manually (Kazi was built
  and verified with NDK `27.1.12297006` at
  `%LOCALAPPDATA%\Android\Sdk\ndk\27.1.12297006`)
- iOS builds require macOS + Xcode; the iOS icons and natives are already generated in `ios/`.