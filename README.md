# Kazi

Kazi is a simple, secure, bilingual (English / French) digital business notebook for small
businesses in Cameroon. It helps you track what you sell, what you buy, what you have in stock,
and how much money is moving through the business — without the complexity of a full accounting
system.

The project is split into two parts:

- **`Kazi/`** — the React Native mobile app (Android + iOS).
- **`Kazi/server/`** — the Node.js + TypeScript + SQLite backend API.

Both are built for the value proposition: *"Your business, kept simple."*

---

## Features

- **Accounts** — sign up, sign in, forgot/reset password. Sessions are 30-day JWTs stored in the
  device Keychain; passwords are hashed with bcrypt. No account enumeration on the API.
- **Products & services** — a catalog of what you sell, each with a name, type (product or
  service), price and optional notes.
- **Inventory** — optional stock tracking per item: record stock in/out (with reasons), get a
  low-stock alert above a threshold you choose, and see stock badges in the product list.
- **Transactions** — record money in (**sales**) and money out (**purchases**), optionally linked
  to a catalog item. A sale of a tracked item reduces its stock automatically; a purchase
  increases it. Deleting a transaction reverses its stock effect.
- **Add money** — record cash you put into the business from your own pocket, separate from sales.
- **History** — a "What happened" feed of every sale, purchase and money-added event, newest first.
- **Cash balance** — the Home dashboard shows money in, money out, and your current balance.
- **Bilingual** — English and French, chosen automatically from the device and switchable in the
  More tab.

---

## Repository layout

```
Kazi/
  App.tsx                     App entry (language boot, providers, navigator)
  src/
    api/          HTTP client + env config
    auth/         auth types, session context, validation
    components/   shared UI (Button, Card, TextField, dialogs, toast, logo…)
    config/       env.ts (API host for the dev backend)
    errors/       ApiError / NetworkError
    i18n/         i18next setup + EN/FR translations
    items/        catalog types, API, client validation, formatting
    money/        FCFA formatter + balance math
    navigation/   root stack, tabs, auth flow, param lists
    screens/      auth · home · products · history · more
    storage/      Keychain (secure) + AsyncStorage (preferences)
    theme/        colors, spacing, typography
  android/  android/…   native Android project (package com.kazi.app)
  ios/                native iOS project
  __tests__/          jest unit tests
  server/
    src/
      auth/     signup, login, password reset, JWT
      items/    catalog CRUD + stock in/out
      transactions/  sale / purchase / capital + stock effects
      middleware/, errors.ts, db.ts, app.ts, index.ts
    data/       SQLite database (git-ignored, created on first boot)
    .env        runtime secrets (git-ignored)
```

---

## Running the backend

Requirements: **Node.js ≥ 22.11**.

```sh
cd server
npm install            # first time only
cp .env.example .env   # first time only — set a real JWT_SECRET
npm run dev            # starts the API on http://localhost:4000 (auto-reloads)
```

The API listens on port `4000` by default (override with `PORT`). It creates and migrates its
SQLite database automatically at `server/data/kazi.db` on first boot.

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

### API overview

Auth (`/auth`): `signup`, `login`, `logout`, `me`, `forgot-password`, `reset-password`.
Items (`/items`, requires auth): `GET/POST /`, `GET/PUT/DELETE /:id`, `POST /:id/stock-in`,
`POST /:id/stock-out`, `GET /:id/movements`.
Transactions (`/transactions`, requires auth): `GET/POST /`, `GET/DELETE /:id`.

Authorized endpoints take `Authorization: Bearer <token>`. Errors always use the shape
`{ "error": { "code": "...", "message": "..." } }`.

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

### Tests & checks — mobile

```sh
npm test        # jest unit tests (validation, formatting, app render)
npx tsc --noEmit
npm run lint
```

---

## Testing everything together

1. Start the backend: `cd server && npm run dev`.
2. Anticipate: backend `npm test` → 47 tests, mobile `npm test` → 69 tests, plus clean
   `tsc`/`eslint` and a successful `assembleDebug`.
3. Run the app from Metro. Create an account, add products/services, toggle stock tracking, add
   stock, record a sale (watch stock drop), record a purchase (watch it rise), add money, and
   confirm the Home balance and History feed update.

---

## Security notes

- Passwords are never stored in plain text (bcrypt). Tokens live only in the device Keychain.
- Every query is scoped to the authenticated user; no endpoint exposes other users' data
  (covered by tests).
- `JWT_SECRET` must be set to a long random value in production (see `.env.example`).
- The SQLite DB and `.env` are git-ignored — never commit them.
- Transport is HTTP in development. Production should terminate TLS in front of the API.

## Known environment notes

- On networks where Android SDK/NDK auto-downloads fail, install the NDK manually (Kazi was built
  and verified with NDK `27.1.12297006` at
  `%LOCALAPPDATA%\Android\Sdk\ndk\27.1.12297006`)
- iOS builds require macOS + Xcode; the iOS icons and natives are already generated in `ios/`.