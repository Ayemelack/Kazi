# Kazi — Remediation Plan

The fix specification for every task in [PROJECT_TRACKER.md](PROJECT_TRACKER.md). Each task lists
the problem, the fix, the files involved, and acceptance criteria. Tick the criteria as they are
met, then update the tracker.

Rules for every fix:

- Follow the architecture rules in [ARCHITECTURE.md](ARCHITECTURE.md) and the controls in
  [SECURITY.md](SECURITY.md); stay inside the budgets in [PERFORMANCE.md](PERFORMANCE.md).
- Every fix ships with tests (see [TESTING_QA.md](TESTING_QA.md#tests-required-per-task)).
- No behaviour change goes in without updating the three locales and any affected doc.

---

## P0 — Production blockers

### KZ-01
**Connectivity check fails in release builds**

- **Problem:** `src/offline/connectivity.ts` probes `http://clients3.google.com/generate_204`.
  Release Android builds disallow cleartext HTTP (the React Native Gradle plugin sets
  `usesCleartextTraffic=false` for release) and iOS App Transport Security blocks it too. The probe
  then always fails, the offline pill never disappears, and real server errors are reported as
  "you're offline". It also wakes the radio every 30 seconds.
- **Fix:** replace the polling probe with `@react-native-community/netinfo` (event-driven, uses OS
  signals). Configure its reachability check with an HTTPS URL
  (`https://connectivitycheck.gstatic.com/generate_204`) or the Kazi API's `/health`. Keep the
  `isOnline()` / `subscribeConnectivity()` interface so `api/client.ts` and `OfflineProvider` keep
  working. Remove the 30-second timer.
- **Files:** `src/offline/connectivity.ts`, `src/offline/OfflineProvider.tsx`, `package.json`,
  `jest.setup.js` (NetInfo mock).
- **Acceptance:**
  - [ ] Release APK on a real phone: no offline pill while online; pill appears within 3 s of
        airplane mode and disappears within 3 s of reconnecting. _(Needs a physical device:
        device QA script, [TESTING_QA.md](TESTING_QA.md) §4.)_
  - [x] With the API stopped and the phone online, the app says "server unreachable", not "offline".
        _(Unit-tested in `__tests__/connectivity.test.ts`; confirm on a device in the QA script.)_
  - [x] No plain-HTTP URL remains in `src/` (`grep -rn "http://" src` returns only dev-host code;
        guarded by `__tests__/source.guards.test.js`).
- **Done (2026-10-11):** `@react-native-community/netinfo` 12.0.1 (TurboModule spec, so New
  Architecture). Android decides reachability from the OS's validated-internet signal; iOS checks
  `https://connectivitycheck.gstatic.com/generate_204` (expects 204) only while the app is active.
  Unknown reachability counts as online so a slow first check never shows the pill.

### KZ-02
**iOS Firebase setup / startup crash**

- **Problem:** `index.js` calls `setupBackgroundHandler()` → `getMessaging()` at module load. iOS
  has no `GoogleService-Info.plist` and `AppDelegate.swift` never configures Firebase, so this is
  expected to throw "No Firebase App '[DEFAULT]'" before the app registers.
- **Fix:** add `GoogleService-Info.plist` (from the real Firebase project, KZ-03), call
  `FirebaseApp.configure()` in `AppDelegate`, follow the React Native Firebase iOS install steps
  (Podfile settings, APNs key uploaded to Firebase, Push Notifications + Background Modes →
  Remote notifications capabilities). Wrap the background-handler setup in `try/catch` so a
  Firebase failure can never stop the app from starting.
- **Files:** `index.js`, `ios/Kazi/AppDelegate.swift`, `ios/Podfile`, `ios/Kazi/Info.plist`,
  Xcode project (capabilities).
- **Acceptance:**
  - [ ] Release build launches on a real iPhone and on the simulator.
  - [ ] With Firebase deliberately misconfigured, the app still starts (push simply disabled).
  - [ ] A test push reaches the iPhone in foreground and background.
- **Status (2026-10-15, session 8):** code done, 🟨 Blocked on a Mac, the Apple Developer account
  and the Firebase project (steps in [DEPLOYMENT.md §6](DEPLOYMENT.md#firebase-and-push-setup-kz-02-kz-03)).
  Done in the repository: `AppDelegate` configures Firebase only when a valid
  `GoogleService-Info.plist` for `com.kazi.app` is bundled; a build phase copies the plist only if
  present (git-ignored, per environment); `Kazi.entitlements` (`aps-environment`) +
  `UIBackgroundModes` `remote-notification`; Podfile on CocoaPods + static frameworks
  (`$RNFirebaseDisableSPM`, `$RNFirebaseAsStaticFramework`), as RNFB 26 documents for non-SPM
  setups; empty `NSLocationWhenInUseUsageDescription` removed. In JavaScript every messaging call
  goes through `src/notifications/firebase.ts` (no default app or any throw → push off for the
  session, logged once in development), and `index.js` wraps the module-load call. The "still
  starts when misconfigured" criterion is covered by `__tests__/push.startup.test.ts` but stays
  unticked until it is seen on a device. Not built: no Mac here, so neither `pod install` nor an
  Xcode build has run against these changes.

### KZ-03
**Push notifications are not wired end to end**

- **Problem:** `android/app/google-services.json` is a placeholder (`kazi-notifications-placeholder`),
  so FCM tokens cannot be issued. The server never sends a notification on its own; the only sender
  is `POST /notifications/send`, which pushes to the caller's own devices.
- **Fix:**
  1. Create the real Firebase project; add the real Android and iOS config files (they are
     public client identifiers, but keep the server service-account key out of git).
  2. Decide the triggers (decision D6). Recommended v1: low-stock alert when a sale or stock-out
     crosses the threshold.
  3. Send from the service layer **after** the database transaction commits, never inside it, and
     never let a push failure fail the write.
  4. Restrict or remove the public `/notifications/send` route (keep it for admin/testing only,
     behind a feature flag).
- **Files:** `android/app/google-services.json`, `ios/Kazi/GoogleService-Info.plist`,
  `server/src/notifications/*`, `server/src/items/service.ts`, `server/src/transactions/service.ts`.
- **Acceptance:**
  - [ ] A sale that drops a tracked item to its threshold delivers one notification to each of the
        owner's devices.
  - [ ] FCM being down does not slow or fail the sale (push is fire-and-forget with a timeout).
  - [ ] Dead tokens are removed (existing behaviour, keep the test).
- **Status (2026-10-15, session 8):** code done, 🟨 Blocked on real-delivery verification, which
  needs the Firebase projects, both apps' config files, the APNs key and the service account
  (steps 1–9 in [DEPLOYMENT.md §6](DEPLOYMENT.md#firebase-and-push-setup-kz-02-kz-03)). Fix step 1
  is now a human step: the placeholder `google-services.json` stays committed and the app treats
  it as "push disabled" (no permission prompt, no token request; native FCM auto-init off in
  `firebase.json` until a real project's token is requested). Trigger per D6: `stockOut` (sale,
  manual stock-out, purchase reversal) queues a low-stock alert with `setImmediate` when a
  tracked item crosses from above its threshold to at or below it; it runs after the commit,
  re-checks the item, claims `items.last_low_stock_alert_at` (migration 0006, once per item per
  12 hours), sends in `users.language` with a 5-second timeout and only logs failures. `POST
  /notifications/send` exists only with `NOTIFICATIONS_TEST_SEND=1` outside production. The
  criteria are covered by `notifications/lowStock.test.ts` with fake messaging (one multicast to
  every device, sale unaffected by failure or timeout, dead-token cleanup) but stay unticked until
  seen with real FCM.

### KZ-04
**Money input "1,000" / "1.000" is saved as 1 FCFA**

- **Problem:** `parseAmount` (`src/transactions/validation.ts`), `parsePrice`
  (`src/items/validation.ts`) and `DebtFormScreen` replace the first `,` with `.`, so `"1,000"` and
  `"1.000"` both become `1`. The debt form also rejects `"1 000"` while the sale form accepts it.
- **Fix:** FCFA has no minor unit, so money is a whole number (ADR A6).
  1. One shared parser `shared/src/money.ts → parseMoneyInput(text): number | null` (in
     `@kazi/shared`, so the app and the API's tests use the same code — ADR A10):
     trim; remove spaces and non-breaking spaces; accept `,` or `.` **only** as thousands
     separators in groups of three (`1,000`, `1.000.000`); reject anything else (`1,5`, `12.34`,
     `0x10`, `1e5`, signs, mixed separators like `1,000.000`); return an integer.
  2. Use it in the sale, expense, capital, debt and product forms; delete the three local parsers.
  3. Server: `moneyAmountSchema` and item `price` require integers.
  4. Show the parsed value under the field as the user types ("= 1 000 FCFA") so they can see what
     will be saved.
- **Files:** `shared/src/money.ts` (new: `parseMoneyInput`, `formatMoney`, `MONEY_MAX`),
  `src/money/input.ts` (new: live preview), `src/transactions/validation.ts`, `src/items/validation.ts`,
  `src/debts/validation.ts`, `src/screens/**/{TransactionForm,AddMoney,DebtForm,ProductForm}Screen.tsx`,
  `server/src/validation/money.ts`, `server/src/items/validation.ts`.
- **Acceptance:**
  - [x] `1,000`, `1.000`, `1 000`, `1000` → 1000. `1,000,000` and `1.000.000` → 1000000.
  - [x] `1,5`, `12.34`, `0x10`, `1e3`, `-5`, `` → rejected with a translated message.
  - [x] API rejects `amount: 12.5` with `VALIDATION_ERROR`.
  - [x] Table-driven unit tests for the parser on both sides.

### KZ-05
**Password-uniqueness rule reveals which passwords are in use**

- **Problem:** `signUp` and `resetPassword` (`server/src/auth/service.ts`) refuse a password any
  other account has used (`PASSWORD_NOT_ALLOWED`). Anyone can test a password at signup and learn
  that some account uses it; combined with email enumeration this helps password guessing. The
  fingerprints are HMAC-keyed with `JWT_SECRET`, so rotating that secret silently breaks the rule.
- **Fix (decision D1, recommended option):**
  1. Remove the cross-account check and stop writing fingerprints; drop `password_fingerprints` in
     a migration.
  2. Replace it with a denylist of common and breached passwords (bundle a top-10k list on the
     server; optional k-anonymity check against Have I Been Pwned) → `PASSWORD_TOO_COMMON`.
  3. Update README and the app copy that advertise the old rule.
- **Files (as built):** `server/src/auth/{service,passwordPolicy}.ts`,
  `server/assets/common-passwords.txt` (SecLists 10k, MIT; source and licence in its header),
  `server/src/db/migrations/0004_drop_password_fingerprints.ts`, `shared/src/{password,commonPasswords,errors}.ts`,
  `src/auth/validation.ts`, `src/errors/messages.ts`, locales, README. The rules (list, patterns,
  name/email) live in `shared/` so the app's instant check (top 1000) and the API (full list) can't
  drift; the API is the authority. The optional Have I Been Pwned check was not added (it would
  send password-hash prefixes to a third party; left for a later decision).
- **Acceptance:**
  - [x] Two accounts can use the same strong password; the response never reveals it.
  - [x] `Password123`-style common passwords are refused with a translated message.
  - [x] No code reads or writes `password_fingerprints`.

### KZ-06
**Password reset: fail-open in dev, broken in production**

- **Problem:** `server/src/auth/routes.ts` returns the reset code in the HTTP response whenever
  `NODE_ENV !== 'production'`. A deployment that forgets `NODE_ENV` lets anyone with a victim's
  email and full name take over the account. With `NODE_ENV=production`, the app's reset flow
  always shows "could not verify" because there is no delivery channel.
- **Fix:**
  1. Fail closed: return the code only when `ALLOW_DEV_RESET_CODE=1` **and** `NODE_ENV` is
     `development` or `test`, checked at boot and again on each request. Refuse to boot if
     `ALLOW_DEV_RESET_CODE=1` with any other `NODE_ENV` (production included). The old
     `!== 'production'` logic is gone.
  2. Delivery channel (decision D2: email): a `ResetCodeSender` interface (`send(to, code,
     language)`) chosen at boot: `EmailSender` (en/fr/wes templates, HTTPS API call with a
     5-second timeout) when `EMAIL_PROVIDER` is set, `ConsoleSender` only with `NODE_ENV`
     `development`/`test`; anything else refuses to boot. The provider is still pending, so the
     adapter is provider-agnostic: Brevo and Postmark request shapes plus a generic `http` relay.
  3. Code: 6 digits from `crypto.randomInt`, stored as an HMAC-SHA256 keyed with
     `HKDF(JWT_SECRET, info "kazi-reset-code")`, 15-minute expiry, dead after 5 wrong tries; a new
     code replaces the account's older ones; single-use.
  4. Uniform response: forgot-password always answers `202 { message: "If an account exists for
     this email, we've sent it a reset code." }`; the lookup, code and sending run after the
     response (`setImmediate`). 3 codes per email address per hour, counted for every address.
     reset-password answers one `400 RESET_CODE_INVALID` for every failure.
  5. App: Forgot Password asks only for the email → "enter the code we sent" + new password
     screen. No code in route params. Names are no longer part of the reset.
- **Spec corrections (2026-10-14, while building):**
  - Expired and used-up codes can't get their own server error: an unknown email can never have
    an expired code, so a distinct answer would reveal that the account exists. The server answers
    `RESET_CODE_INVALID` for all of them; the app words it from what it knows (15 minutes since it
    asked → "expired"; 5 refused tries → "used up"; otherwise "wrong").
  - The password policy (which refuses passwords containing the account's names) now runs only
    after the code matches; before, a wrong code plus a name-like password would have told an
    attacker the account's name.
  - The HMAC input is `"<user id>:<code>"`, so equal codes on two accounts are stored differently.
  - The table is recreated (`0005_reset_codes`) rather than extended: the old key was the hash of
    a long token, and a 6-digit code can repeat across accounts.
  - An unset or unknown `NODE_ENV` counts as production for delivery (fail closed);
    `server/.env.example` keeps `NODE_ENV=development` commented out for local machines.
  - A new error code `RESET_CODE_INVALID` replaces the reset screen's reuse of the session codes
    `INVALID_TOKEN` / `TOKEN_EXPIRED` (still used for sessions).
- **Files (as built):** `server/src/auth/{routes,service,validation,jwt,resetCode,delivery,
  emailTransport,resetEmail}.ts`, `server/src/middleware/rateLimit.ts` (`keyedLimiter`),
  `server/src/{app,index}.ts`, `server/src/db/migrations/0005_reset_codes.ts`,
  `shared/src/{reset,errors}.ts`, `src/auth/{resetFlow,validation,types}.ts`,
  `src/screens/auth/{ForgotPassword,ResetPassword}Screen.tsx`, `src/navigation/RootNavigator.tsx`,
  `src/components/ui/TextField.tsx` (one-time-code autofill), locales, `server/.env.example`.
- **Acceptance:**
  - [x] No environment configuration causes the code to appear in a production response.
  - [ ] End-to-end reset works on staging with the real channel. 🟨 **Blocked:** the email
        provider (decision D2) and the domain (D3) are pending. Setup and check steps:
        [DEPLOYMENT.md §3 "Password-reset email"](DEPLOYMENT.md#password-reset-email-kz-06-decision-d2).
  - [x] After 5 wrong tries the code is dead: the sixth try fails even with the right code.
  - [x] Response for unknown email and for known email are indistinguishable (status, body,
        headers; timing: the work happens after the response).
  - [x] A new code kills the previous one; codes expire at 15 minutes (fake-clock test).
  - [x] No code or email appears in the logs, including when delivery fails.
  - [x] The API refuses to start in production without an email sender, and with
        `ALLOW_DEV_RESET_CODE=1` anywhere but development/test.
  - [x] App: email-only request, code + new password screen, translated messages for too many
        requests and for wrong, expired and used-up codes in en/fr/wes; a debug build prefills
        the dev code without route params.

### KZ-07
**No way to delete or correct a transaction**

- **Problem:** the API has `DELETE /transactions/:id` (with stock reversal), but no screen calls
  it. A mistyped sale stays forever and corrupts totals.
- **Fix:**
  1. `GET /activity` returns `refType` and `refId` for each event.
  2. Tapping a sale, expense or capital row in History opens a detail sheet with Delete
     (confirm dialog). After delete, reload History and Home totals.
  3. "Edit" in v1 = delete + prefilled new form (single server call later if needed).
  4. Debt rows open the existing debt actions.
- **Files:** `server/src/activity/service.ts`, `src/activity/types.ts`,
  `src/screens/history/HistoryScreen.tsx`, new `TransactionDetailSheet.tsx`, locales.
- **Acceptance:**
  - [x] Deleting a sale of a tracked item restores stock and removes the History row.
  - [x] Home and History totals update after delete.
  - [x] Another user's transaction id returns 404 (existing isolation test still passes).
- **Done (session 7):** the sheet loads the record with `GET /transactions/:id` (amount, date,
  item, quantity, description). Correct opens TransactionForm / AddMoney prefilled
  (`params.correct`), saves the new record first with its own `clientOpId` (KZ-11) and only then
  deletes the old one (`src/transactions/correction.ts`; an old record already gone counts as
  removed; a failed delete says the new record is saved and the old one must be deleted from
  History). Debt rows open Debts with that debt highlighted; product rows and legacy rows without a
  reference open nothing. Decision D5: deleting a purchase now reverses its full quantity even if
  stock goes negative (`stockOut(…, { allowNegative: true })`); session 11 (KZ-23) decides the
  rule for sales and manual stock-outs and can reuse that option. Also fixed: `ToastProvider`
  gave a new context value on every render, so each toast re-ran History's focus load.

### KZ-08
**Rate limiter ignores proxies and never frees memory**

- **Problem:** `server/src/middleware/rateLimit.ts` keys on `req.ip`, but `trust proxy` is never
  set. Behind the planned reverse proxy every user shares one IP, so 12 signups or 25 logins per
  15 minutes would lock out everyone. The `hits` map is never pruned.
- **Fix:**
  1. `app.set('trust proxy', process.env.TRUST_PROXY ?? false)` — set to the proxy hop count or
     address in production (see [DEPLOYMENT.md](DEPLOYMENT.md)).
  2. Sweep expired buckets on an interval (`unref()` the timer) and cap the map size.
  3. Login: limit by IP **and** by target email (e.g. 10 failures / 15 min per email), so a
     distributed attack on one account is still slowed.
  4. Return `Retry-After` on 429.
  5. Add a per-user limiter on authenticated write routes (generous, e.g. 120/min) to stop scripted abuse.
- **Files:** `server/src/middleware/rateLimit.ts`, `server/src/app.ts`, `server/src/auth/routes.ts`.
- **Acceptance:**
  - [x] Behind a proxy, two different client IPs get separate buckets (test with `X-Forwarded-For`).
  - [x] A spoofed `X-Forwarded-For` is ignored when `TRUST_PROXY` is unset.
  - [x] Map size stays bounded under a 100k-distinct-key load test.
- _Session 6:_ `TRUST_PROXY` is a hop count only (unset/0 → false; anything else stops the boot),
  never `true`. New `FixedWindowLimiter` + `rateLimit({ key })` middleware (sweep every minute on
  an unref'd timer, 10 000-key cap, `Retry-After`). Login: 25/15 min per IP plus 10 failures/15 min
  per normalized email (counted when the attempt starts, cleared on success or a completed reset);
  account deletion the same per user; 120 writes a minute per user on every authenticated router;
  push send 10 a minute per user. Also the daily reset-code cap (10 per email) that SECURITY §6
  assigned to this task. Tests: `server/src/middleware/rateLimit{,.routes}.test.ts`,
  `server/src/trustProxy.test.ts`, `server/src/auth/reset.test.ts`.

### KZ-09
**Release signing and production API URL**

- **Problem:** `android/app/build.gradle` signs release builds with `debug.keystore`.
  `src/config/env.ts` hard-codes `PROD_API_URL = 'https://api.kazi.app'` (placeholder) and a dev
  fallback LAN IP.
- **Fix:**
  1. Generate an upload keystore (kept out of git, backed up offline); read its path and passwords
     from `~/.gradle/gradle.properties` or CI secrets. Enrol in Play App Signing.
  2. Build `.aab` for the Play Store.
  3. Production API URL set at build time (Gradle `buildConfigField` / Xcode config read through a
     tiny native constant, or a generated `src/config/build.ts` written by a pre-build script).
     Release builds must fail if it is missing or not `https://`.
- **Files:** `android/app/build.gradle`, `android/gradle.properties` (no secrets), `src/config/env.ts`,
  `.gitignore`.
- **Acceptance:**
  - [ ] `./gradlew bundleRelease` produces an AAB signed with the upload key.
  - [ ] A release build cannot be produced with an `http://` or missing API URL.
  - [ ] No keystore or password is committed.

---

## P1 — Correctness, security and data integrity

### KZ-10
**Home "today" totals use the server's date**

- **Problem:** `server/src/summary/service.ts` computes "today" from the server clock; `/summary`
  ignores `asOf`. Home and History can disagree around midnight.
- **Fix:** accept `asOf` (validated with `businessDateSchema`) on `/summary`; the app sends
  `todayAsDateString()`. Return `lowStockCount` from `/summary` too (used by KZ-14).
- **Acceptance:** [x] With the server in UTC and the phone at 00:30 WAT, a sale dated today counts
  in Home "today" and History "today" alike. [x] Unit test with a fixed `asOf`.
- **Done (session 7):** `lowStockCount` = tracked items with `low_stock_threshold > 0` and
  `stock <= low_stock_threshold` (the item's own `lowStock` rule); Home no longer calls `/items`
  and counts capital as activity. The whole summary is one aggregate statement, which also
  covers the "compute `/summary` in one aggregate query" part of KZ-32.

### KZ-11
**Idempotent writes from the app**

- **Problem:** the server supports `clientOpId`, the app never sends it. A save that times out
  after the server committed, then retried, creates a duplicate.
- **Fix:** each form creates one `clientOpId` when it mounts / when the user first taps Save
  (≥ 16 chars, timestamp + random) and reuses it for every retry of that submission; a new id only
  after success or after the user changes the form. Apply to item create, stock in/out,
  transaction create, debt create and debt pay.
- **Acceptance:** [x] Simulated lost response + retry → one record, second call returns 200 with
  the same body. [x] Jest test that the id is stable across retries.
- **Done (session 7):** ids are 25 characters (`newClientOpId`, timestamp + random + counter), above
  the spec's 16, and are created on the first Save tap rather than on mount, so an opened-and-left
  form never holds one. "A new id after the user changes the form" is implemented as "a new id
  whenever the values about to be sent differ from the ones the id was made for", so one id can
  never cover two different bodies (the API would answer the second with the first's record).

### KZ-12
**Errors in the user's language**

- **Problem:** most screens show `err.message`, which is English text from the server.
  `apiErrorMessage` maps only 8 codes.
- **Fix:** every server error code gets a translation key; `ApiError` → message mapping lives in
  one place (`src/errors/messages.ts`) and every screen uses it. Validation errors return
  `{ code: 'VALIDATION_ERROR', field, rule }` so forms show the error under the right field.
  Unknown codes fall back to a translated generic message, never to server text.
- **Acceptance:** [x] `grep -rn "err.message" src/screens` returns nothing. [x] Test: every code in
  `server/src/errors.ts` has a key in all three locales.
- **Done (2026-10-11):** the code list is `API_ERROR_CODES` in `shared/src/errors.ts`, which the
  server's `ErrorCode` type is, so "every code in `server/src/errors.ts`" means every shared code.
  Validation errors carry `rule` (shared `VALIDATION_RULES`) and `field` (shared
  `VALIDATION_FIELDS`); every locale has a message per rule and a label per field.

### KZ-13
**Sessions, logout and expiry**

- **Problem:** 30-day JWTs; `/auth/logout` does nothing; a token can only be revoked by a password
  reset. Mid-session 401s show errors instead of returning to login.
- **Fix (decision D4):** `sessions` table (id, user_id, refresh_hash, device, created_at,
  last_used_at, revoked_at). Access token 15 min; refresh token 60 days, rotated on each use,
  reuse of an old refresh token revokes the whole session family. Logout revokes the session.
  "Log out other devices" in More. App: `apiRequest` refreshes once on `TOKEN_EXPIRED`, and on a
  final 401 calls `logOut()` and shows the login screen with a message.
- **Acceptance:** [x] After logout the old access token stops working immediately (the session row
  is revoked, not just after the 15 minutes) and the refresh token immediately. [x] Expired session
  returns the user to Login without error toasts (the client renews once; a failed renewal clears
  the tokens and the auth provider signs out).

### KZ-14
**Item list ships every photo**

- **Problem:** `GET /items` embeds each item's base64 image (up to 2 MB). Home loads the full list
  just to count low stock; the sale form loads it on every focus.
- **Fix:** store images in an `item_images` table (or files under `data/`), return
  `imageVersion`/`hasImage` in item JSON, serve bytes at `GET /items/:id/image` with
  `Cache-Control: private, max-age=31536000, immutable` keyed by version and an ETag. Home uses
  `lowStockCount` from `/summary` (KZ-10). Lower `express.json` limit to 256 kB once images use a
  dedicated upload route.
- **Acceptance:** [ ] `GET /items` for 200 items with photos is < 50 kB. [ ] Home makes no
  `/items` call. [ ] Images load once and come from cache afterwards.

### KZ-15
**Photo formats and content checks**

- **Problem:** iPhone photos can arrive as `image/heic` and are rejected. The server trusts the
  declared type and never checks the bytes. The error text omits GIF, which is allowed.
- **Fix:** app: `assetRepresentationMode: 'compatible'` in `react-native-image-picker` so iOS
  returns JPEG. Server: decode base64, check magic bytes (JPEG `FF D8 FF`, PNG `89 50 4E 47`,
  WebP `RIFF....WEBP`), refuse GIF and anything else, enforce a decoded-size limit (≤ 1 MB).
- **Acceptance:** [ ] HEIC from an iPhone saves as JPEG. [ ] An HTML file labelled `image/png` is
  rejected. [ ] Error message matches the allowed list in all locales.

### KZ-16
**Validation parity**

- **Problem:** the app doesn't enforce password max length (server counts bytes for bcrypt's 72),
  business-type max 60, or the date window (2000-01-01 to one year ahead); the date picker allows
  years 1000–9999.
- **Fix (revised 2026-10-11, session 2):** one file, `shared/src/limits.ts` (plus the date window
  in `shared/src/date.ts` and `MONEY_MAX` in `shared/src/money.ts`), imported by the server's zod
  schemas and the app's validators alike — so there is no second copy that could differ, and the
  originally planned parity test (comparing two constants files) has nothing to compare. Instead,
  each side has a boundary test per limit (`server/src/validation/limits.test.ts`,
  `__tests__/limits.boundary.test.ts`): the value at the shared constant passes and one past it
  fails, so a validator that stops using the constant, or a literal that drifts from it, fails its
  side's test. Fields limited only by a `TextInput` `maxLength` are covered by a test that fails on
  any literal `maxLength={<number>}` in `src/`. Password max is checked as UTF-8 bytes on both
  sides (tested with 2- and 4-byte characters). The date picker's min/max come from the shared
  window and the app validators reject dates outside it.
- **Acceptance:** [x] Every limit both sides enforce comes from `@kazi/shared`; a boundary test
  per limit on each side fails when a validator stops using the shared constant (shown: the
  pre-change password validators fail 3 tests on each side).

### KZ-17
**Offline start with no cached profile**

- **Problem:** `AuthContext` sets `status: 'authenticated'` with `user: null` when `/auth/me`
  fails and nothing is cached; `RootNavigator` then shows Business Profile to an existing owner.
- **Fix:** add a `'offline-unknown'` status that shows a "Can't reach Kazi — Retry" screen; only
  enter the app with a known profile.
- **Acceptance:** [ ] Clear app storage (keep Keychain), start offline → retry screen, not
  Business Profile. [ ] Retry when online lands on Home.

### KZ-18
**Admin dashboard start and build**

- **Problem:** no npm script starts the dashboard; `npm run build` doesn't copy
  `src/admin/public`, so the compiled dashboard has no page.
- **Fix:** scripts `admin:dev` (`tsx src/admin/index.ts`) and `admin` (`node dist/admin/index.js`);
  a `postbuild` step copies `src/admin/public` to `dist/admin/public` (`fs.cpSync`). Document in
  README and [DEPLOYMENT.md](DEPLOYMENT.md).
- **Acceptance:** [ ] `npm run build && npm run admin` serves the login page.

### KZ-19
**Vulnerable dependencies**

- **Problem:** server audit: `proxy-addr` (critical, through express), `@grpc/grpc-js` and
  `brace-expansion` (high), `qs`, `uuid` (moderate). App: `shell-quote` (critical, tooling),
  `braces`, `image-size`, `@grpc/grpc-js` (high).
- **Fix:** `npm audit fix` on both; upgrade express to the latest 4.x patch; re-run tests; for
  anything that can't be fixed, record the reason and exposure in [SECURITY.md](SECURITY.md#6-accepted-risks).
  `proxy-addr` matters once `trust proxy` is on (KZ-08), so do this before or with KZ-08.
- **Acceptance:** [x] `npm audit --omit=dev` shows no critical or high on the server. [x] App
  runtime dependencies have no critical/high; tooling exceptions documented.
- _Session 6:_ server fixed by `npm audit fix` + express 4.22.3; app by `npm audit fix` (patch/minor
  only) and an `overrides` pin of `@grpc/grpc-js` (firebase@12 has no fixed `~1.9` release). Left:
  `braces` and `image-size` in Metro/Jest/CLI tooling, no fix in range, documented in
  SECURITY.md §6 and excepted (with a review date) by `scripts/audit-gate.js`, which the CI audit
  job now runs as a blocking step.

---

## P2 — Hardening and performance

### KZ-20
**Require the password to delete the account** — `DELETE /auth/me` takes `{ password }` and
verifies it; the screen asks for it. Acceptance: [x] wrong password → 401, account intact.
As built: `{ password }` is validated with zod (missing/empty → 400 on `password`), the wrong one
is `401 INVALID_CREDENTIALS`, and the route has its own limiter with login's limits (25 per 15 min
per IP). The app asks for the password inside the confirm dialog, keeps the dialog open with the
reason on failure, and unregisters the push token only after the server has deleted the account.

### KZ-21
**Login timing and blocking hashing** — when the email is unknown, still run a bcrypt compare
against a fixed dummy hash; switch to async `bcrypt.hash` / `bcrypt.compare` so the event loop is
not blocked (~70–100 ms per call today). Acceptance: [x] response time for unknown vs known email
differs by < 20 ms at p50 over 100 tries. [x] Health checks stay < 20 ms during a login burst.
Spec corrected: bcryptjs's async API only yields every 100 ms and one cost-10 hash fits in a single
slice, so "async" alone still blocked the event loop; the async calls run on a worker-thread pool
(`server/src/auth/passwordHash.ts`, ADR A14). Measured numbers are in the tracker's update log.

### KZ-22
**Explain disabled Save buttons** — show field errors after a field is touched (on blur) rather
than only after Save, so a disabled button always has a visible reason. In
`AddMoneyScreen.tsx` pass errors through `t()`. Acceptance: [x] every form shows why Save is
disabled; [x] no raw translation key can render (test).
**Done (2026-10-11):** `src/forms/useFormErrors.ts` shows a field's error once it is touched (blur,
or a picked date / star) or after a Save attempt, and Save is disabled only while an error is
visible, so an untouched form keeps Save enabled and pressing it reveals every reason. Applied to
all 12 forms (Login, Signup, ForgotPassword, ResetPassword, BusinessProfile, MyBusiness, Feedback,
DebtForm, AddMoney, TransactionForm, ProductForm, StockMovementDialog); Feedback gained a visible
"choose a rating" reason. A `VALIDATION_ERROR` from the API about one of the form's fields shows
under that field (KZ-12). `__tests__/forms.errors.test.tsx` checks every form in en, fr and
Pidgin.

### KZ-23
**Stock rules** — implement decision D5 (recommended: allow the sale, let stock go negative, flag
it red, and log a warning activity). Allow "starting stock" on the create-product form (one
stock-in movement with reason "Opening stock"). Acceptance: [ ] chosen policy covered by API
tests; [ ] new product can be created with stock in one step.
**Constraint from KZ-03:** every stock decrease must keep going through `stockOut` in
`server/src/items/service.ts`; that is where the low-stock alert (decision D6) is detected and
queued. If a sale's negative-stock rule needs a new path, reuse `stockOut(…, { allowNegative })`
rather than writing `UPDATE items SET stock` elsewhere. `notifications/lowStock.test.ts` fails if
a sale, a manual stock-out or a purchase reversal stops alerting.

### KZ-24
**Language code and server sync** — rename `pid` to a valid tag (migration of the stored
preference: read `pid`, write the new tag). `setAppLanguage` also `PATCH /auth/me/language`; on
login, use the server value if the device has none. Acceptance: [x] language survives reinstall +
login _(unit-tested with empty storage + login; confirm on a device in the QA script)_; [x] dates
format correctly in all three languages.
**Done (2026-10-11):** the valid tag is `wes`, the ISO 639-3 code for Cameroonian Pidgin, rather
than a private-use tag (ADR A13). Dates use a formatting locale separate from the language code
(`en-CM`, `fr-CM`, `wes` → `en-CM`). Server: `PATCH /auth/me/language` (`en|fr|wes`) and
migration `0003_language_wes`. The app saves the choice on the phone first and on the server best
effort; a new account is saved with the language on screen.

### KZ-25
**Integer money storage and one formatter** — migration: `amount`/`price` columns to `INTEGER`
(round existing values; log any row that had a fraction). One formatter for money and prices
(`1 000 FCFA`); delete `src/items/format.ts` and `src/money/format.ts`. Done as
`server/src/db/migrations/0002_integer_money.ts` (INTEGER + `typeof(x) = 'integer'` CHECKs on
`items.price`, `transactions.amount`, `debts.amount`, `activity.amount`; `ROUND()`, positive
amounts never below 1; logs the count of rounded rows, not the values) and `formatMoney` in
`@kazi/shared`, also used by the admin dashboard. Acceptance: [x] all amounts in DB are integers;
[x] prices and money render the same way.

### KZ-26
**Restore the dropped index** — `migrateTransactionsTable` must recreate
`idx_transactions_user_type_date`. _Done in session 1:_ the old boot-time code became migration
`0001_baseline`, which recreates all three transaction indexes after the rebuild. With numbered
migrations a separate "ensure indexes" step is not needed: any later migration that rebuilds a
table recreates its indexes (rule in [ARCHITECTURE.md](ARCHITECTURE.md) §6.1).
Acceptance: [x] test on a legacy-schema DB shows all three transaction indexes
(`server/src/db/migrations.test.ts`, "pre-capital database upgrades…"; fails if the re-creation is removed).

### KZ-27
**Admin cookie parsing** — wrap `decodeURIComponent` in `try/catch`, ignore bad cookies.
Acceptance: [x] `Cookie: kazi_admin_session=%E0%A4%A` → 401, not 500.
_Session 6:_ `parseCookies` moved to `server/src/admin/cookies.ts` (index.ts starts the server on
import, so it could not be unit-tested there); a value that fails `decodeURIComponent` is skipped
and the other cookies are kept. `server/src/admin/admin.test.ts` boots the real dashboard: the
malformed cookie gets 401 on `/api/stats`, `/api/users` and `/api/session` (500 before the fix),
and a valid session beside a malformed cookie still gets 200.

### KZ-28
**History "Older" range** — with only From, cap `endDate` at the day before this week starts;
with only To, cap at that day. Acceptance: [x] "Older" never shows events from this week.
**Done (session 7):** `src/activity/olderRange.ts`. "This week" is today − 6 … today (the
server's `this_week`), so "Older" ends on today − 7. Spec made precise: a To date inside this
week is also capped at today − 7 (otherwise "with only To" could still show this week); From
after To, or a From date inside this week, is a translated message under the From field
(`history.rangeFromAfterTo` / `history.rangeFromThisWeek`), the list is not requested and no
error screen is shown.

### KZ-29
**Secret strength at boot** — refuse to start in production if `JWT_SECRET` is shorter than 32
bytes or equals the `.env.example` value. Acceptance: [x] boot fails with a clear message.
`server/src/secrets.ts` (`checkJwtSecret`), called first in `server/src/index.ts`; outside
production a weak secret only logs a warning, a missing one still stops the server.

### KZ-30
**Flaky Jest suites** — set `testTimeout: 30000` for the screen suites, run CI with
`--maxWorkers=50%`, and cache Babel transforms in CI. Find and remove whatever makes the first run
slow.

_Root cause (measured in session 1 with an instrumented transformer):_ not `lucide-react-native`
(already mocked). React Native's index requires most components lazily, and host-component refs pull
in the renderer's public-instance / DOM modules, so on a cold cache the **first test** of each screen
suite transformed ~70 modules inside its own timeout (28 s of a 30 s budget on a loaded machine;
the other tests took < 3 s). The timeout alone was not enough: a cold `npm run check` with only
`testTimeout: 30000` still failed the same 3 suites. Fix: `jest/preloadReactNative.js`
(`setupFilesAfterEnv`, not timed) loads those modules and renders a tiny host tree once per test
file; `jest/unmountAfterEach.js` unmounts every rendered tree after each test (stray toast, tab and
animation timers used to fire after teardown and kept single-file runs from exiting); `ToastProvider`
clears its timer on unmount; Jest `roots` limited to app folders (no haste crawl of `server/`,
`shared/`, native folders); form-test harnesses get a first tab so `goBack()` is handled (no
`GO_BACK` noise).

Acceptance (restated in session 1: the owner's session prompt defines the proof as cold local runs;
CI runs can't be observed until the branch is pushed):
[x] 3 consecutive cold full runs pass locally, Jest cache cleared before each (see tracker log).
CI keeps `--maxWorkers=50%` and a cached transform directory; watch the first CI runs after push.

### KZ-31
**List virtualization** — Products, History and Debts render `ScrollView` + `map`. Use `FlatList`
(or `SectionList` for History day groups) with stable keys, `getItemLayout` where rows are fixed
height, memoized rows, and `onEndReached` for History paging. Acceptance: [ ] 1 000-item list
scrolls at ≥ 55 fps on a budget Android device (see [PERFORMANCE.md](PERFORMANCE.md)).

### KZ-32
**Server performance** — set `synchronous = NORMAL`, `busy_timeout = 5000`, `temp_store = MEMORY`
on open; prepare hot statements once per service instead of per call; compute `/summary` in one
aggregate query (done with KZ-10 in session 7); run `PRAGMA optimize` on shutdown and daily. Acceptance: [ ] budgets in
[PERFORMANCE.md](PERFORMANCE.md#performance-budgets) met with the load script.

### KZ-33
**Release build size and speed** — enable R8 (`enableProguardInReleaseBuilds = true`) with
`shrinkResources`, add keep rules for React Native Firebase / Notifee / Keychain if needed, ship an
AAB so each device downloads only its ABI. Acceptance: [ ] download size on an arm64 phone
< 20 MB; [ ] full manual QA pass on the minified build.

### KZ-34
**Observability** — one JSON log line per request (method, route pattern, status, duration ms,
user id — no bodies, no tokens, no emails); `/health` = liveness, new `/ready` = DB reachable;
log slow queries (> 50 ms). Acceptance: [ ] logs contain no secrets or personal data (test);
[ ] `/ready` fails when the DB file is unavailable.

### KZ-35
**Database backups** — online backups with better-sqlite3 `db.backup()` (or Litestream) every
hour, kept 7 days + daily for 30 days, encrypted, copied off the host; monthly restore drill.
Acceptance: [ ] a restore from last night's backup boots and passes the smoke test.

---

## P3 — Documentation, hygiene and CI

### KZ-36
**Docs corrections** — README: remove `GET /feedback/:id`, describe the auto-detected dev host,
remove the password-uniqueness claim (after KZ-05), add admin scripts (KZ-18), link `docs/`.
`OFFLINE_FIRST_VERIFICATION.md`: it says the app polls `/health`; it probes Google (or NetInfo
after KZ-01). Acceptance: [ ] every endpoint and command in README exists.

### KZ-37
**Hygiene** — move `zulu-chronicle/` out of this repo; remove `@react-native/new-app-screen`;
delete unused offline types (`PendingOp`, `LocalItem`, `LocalTransaction`, `LocalDebt`,
`pendingCount`, `queued`) and unused API functions after KZ-07 decides which stay.

_Done in session 1:_ `zulu-chronicle/` copied to `../kazi-archive/zulu-chronicle/` (SHA-256 of all
three files verified) and removed; `@react-native/new-app-screen` uninstalled (no references);
`PendingOp`, `LocalItem`, `LocalTransaction`, `LocalDebt` removed; `pendingCount` removed from
`OfflineProvider` and `OfflinePill`; `queued` removed from the `offline/api.ts` write results and
the four screens that read it; unused `KAZI_NOTIFICATION_CHANNEL` alias removed; locale keys
`offline.offlineWithPending`, `offline.savedOnPhone`, `offline.notAvailableOffline` removed from
en/fr/pid. Kept (still used): `LocalActivity`, `SyncStatus`, `syncStatus` (History).
Left for KZ-07 (session 7), as this spec says: `getDebt`, `getTransaction`, `listStockMovements`.
Acceptance: [x] `tsc`, lint and tests pass; [x] no unused exports reported other than the three
API functions deferred to KZ-07 (a scan of every `export` in `src/` against all other app files;
exports used only inside their own module, such as prop types, are allowed).

### KZ-38
**CI pipeline** — GitHub Actions (or equivalent) on every push and PR: app `tsc`, lint, Jest;
server typecheck, tests, build; `npm audit --omit=dev --audit-level=high` on both; Android
`assembleRelease` on main. See [TESTING_QA.md](TESTING_QA.md#ci-pipeline).
_Session 1:_ `.github/workflows/ci.yml` added (jobs per TESTING_QA.md "CI pipeline"; the audit
job was non-blocking until KZ-19, which made it blocking in session 6; `android-release` / `ios-build` are manual
placeholders for session 9). Each job's commands pass locally via `npm run check`, and a failing
Jest test makes `npx jest --ci` exit non-zero, which fails the job.
Acceptance: [ ] a failing test blocks merge — **blocked on owner actions:** push the branch so the
workflow runs on GitHub, then enable branch protection on `main` requiring the `app` and `server`
checks (TESTING_QA.md "CI pipeline").
