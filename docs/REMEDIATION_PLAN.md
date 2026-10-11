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
        airplane mode and disappears within 3 s of reconnecting.
  - [ ] With the API stopped and the phone online, the app says "server unreachable", not "offline".
  - [ ] No plain-HTTP URL remains in `src/` (`grep -rn "http://" src` returns only dev-host code).

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

### KZ-04
**Money input "1,000" / "1.000" is saved as 1 FCFA**

- **Problem:** `parseAmount` (`src/transactions/validation.ts`), `parsePrice`
  (`src/items/validation.ts`) and `DebtFormScreen` replace the first `,` with `.`, so `"1,000"` and
  `"1.000"` both become `1`. The debt form also rejects `"1 000"` while the sale form accepts it.
- **Fix:** FCFA has no minor unit, so money is a whole number (ADR A6).
  1. One shared parser `src/money/parse.ts → parseMoneyInput(text): number | null`:
     trim; remove spaces and non-breaking spaces; accept `,` or `.` **only** as thousands
     separators in groups of three (`1,000`, `1.000.000`); reject anything else (`1,5`, `12.34`,
     `0x10`, `1e5`); return an integer.
  2. Use it in the sale, expense, capital, debt and product forms; delete the three local parsers.
  3. Server: `moneyAmountSchema` and item `price` require integers.
  4. Show the parsed value under the field as the user types ("= 1 000 FCFA") so they can see what
     will be saved.
- **Files:** `src/money/parse.ts` (new), `src/transactions/validation.ts`, `src/items/validation.ts`,
  `src/debts/validation.ts`, `src/screens/**/{TransactionForm,AddMoney,DebtForm,ProductForm}Screen.tsx`,
  `server/src/validation/money.ts`, `server/src/items/validation.ts`.
- **Acceptance:**
  - [ ] `1,000`, `1.000`, `1 000`, `1000` → 1000. `1,000,000` and `1.000.000` → 1000000.
  - [ ] `1,5`, `12.34`, `0x10`, `1e3`, `-5`, `` → rejected with a translated message.
  - [ ] API rejects `amount: 12.5` with `VALIDATION_ERROR`.
  - [ ] Table-driven unit tests for the parser on both sides.

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
- **Files:** `server/src/auth/service.ts`, `server/src/auth/validation.ts`, `server/src/db.ts`,
  `server/src/errors.ts`, `src/auth/errorMessage.ts`, locales, README.
- **Acceptance:**
  - [ ] Two accounts can use the same strong password; the response never reveals it.
  - [ ] `Password123`-style common passwords are refused with a translated message.
  - [ ] No code reads or writes `password_fingerprints`.

### KZ-06
**Password reset: fail-open in dev, broken in production**

- **Problem:** `server/src/auth/routes.ts` returns the reset code in the HTTP response whenever
  `NODE_ENV !== 'production'`. A deployment that forgets `NODE_ENV` lets anyone with a victim's
  email and full name take over the account. With `NODE_ENV=production`, the app's reset flow
  always shows "could not verify" because there is no delivery channel.
- **Fix:**
  1. Fail closed: return the code only when `ALLOW_DEV_RESET_CODE=1` **and** `NODE_ENV` is
     `development` or `test`. Refuse to boot if `ALLOW_DEV_RESET_CODE=1` and `NODE_ENV=production`.
  2. Delivery channel (decision D2): a `ResetCodeSender` interface with an SMS or email
     implementation; send asynchronously after the code is stored.
  3. Code: 6 digits, SHA-256 hashed, 15-minute expiry, max 5 verification attempts, then invalid.
  4. Uniform response: "If the details match, we've sent a code" — same status, body and similar
     timing whether or not the account exists.
  5. App: Forgot Password → "enter the code we sent" screen → new password. Stop navigating with
     the code in route params.
- **Files:** `server/src/auth/{routes,service,jwt}.ts`, new `server/src/auth/delivery.ts`,
  `server/src/index.ts`, `src/screens/auth/{ForgotPassword,ResetPassword}Screen.tsx`, locales.
- **Acceptance:**
  - [ ] No environment configuration causes the code to appear in a production response.
  - [ ] End-to-end reset works on staging with the real channel.
  - [ ] Sixth wrong code attempt invalidates the code.
  - [ ] Response for unknown email and for known email are indistinguishable.

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
  - [ ] Deleting a sale of a tracked item restores stock and removes the History row.
  - [ ] Home and History totals update after delete.
  - [ ] Another user's transaction id returns 404 (existing isolation test still passes).

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
  - [ ] Behind a proxy, two different client IPs get separate buckets (test with `X-Forwarded-For`).
  - [ ] A spoofed `X-Forwarded-For` is ignored when `TRUST_PROXY` is unset.
  - [ ] Map size stays bounded under a 100k-distinct-key load test.

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
- **Acceptance:** [ ] With the server in UTC and the phone at 00:30 WAT, a sale dated today counts
  in Home "today" and History "today" alike. [ ] Unit test with a fixed `asOf`.

### KZ-11
**Idempotent writes from the app**

- **Problem:** the server supports `clientOpId`, the app never sends it. A save that times out
  after the server committed, then retried, creates a duplicate.
- **Fix:** each form creates one `clientOpId` when it mounts / when the user first taps Save
  (≥ 16 chars, timestamp + random) and reuses it for every retry of that submission; a new id only
  after success or after the user changes the form. Apply to item create, stock in/out,
  transaction create, debt create and debt pay.
- **Acceptance:** [ ] Simulated lost response + retry → one record, second call returns 200 with
  the same body. [ ] Jest test that the id is stable across retries.

### KZ-12
**Errors in the user's language**

- **Problem:** most screens show `err.message`, which is English text from the server.
  `apiErrorMessage` maps only 8 codes.
- **Fix:** every server error code gets a translation key; `ApiError` → message mapping lives in
  one place (`src/errors/messages.ts`) and every screen uses it. Validation errors return
  `{ code: 'VALIDATION_ERROR', field, rule }` so forms show the error under the right field.
  Unknown codes fall back to a translated generic message, never to server text.
- **Acceptance:** [ ] `grep -rn "err.message" src/screens` returns nothing. [ ] Test: every code in
  `server/src/errors.ts` has a key in all three locales.

### KZ-13
**Sessions, logout and expiry**

- **Problem:** 30-day JWTs; `/auth/logout` does nothing; a token can only be revoked by a password
  reset. Mid-session 401s show errors instead of returning to login.
- **Fix (decision D4):** `sessions` table (id, user_id, refresh_hash, device, created_at,
  last_used_at, revoked_at). Access token 15 min; refresh token 60 days, rotated on each use,
  reuse of an old refresh token revokes the whole session family. Logout revokes the session.
  "Log out other devices" in More. App: `apiRequest` refreshes once on `TOKEN_EXPIRED`, and on a
  final 401 calls `logOut()` and shows the login screen with a message.
- **Acceptance:** [ ] After logout the old access token stops working within 15 min and the
  refresh token immediately. [ ] Expired session returns the user to Login without error toasts.

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
- **Fix:** `src/config/limits.ts` and `server/src/validation/limits.ts` hold every limit; a Jest
  test reads the server file and fails on any difference. Password max is checked as UTF-8 bytes on
  both sides. Date picker min/max come from the limits.
- **Acceptance:** [ ] Parity test passes and fails when a limit is changed on one side only.

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
- **Acceptance:** [ ] `npm audit --omit=dev` shows no critical or high on the server. [ ] App
  runtime dependencies have no critical/high; tooling exceptions documented.

---

## P2 — Hardening and performance

### KZ-20
**Require the password to delete the account** — `DELETE /auth/me` takes `{ password }` and
verifies it; the screen asks for it. Acceptance: [ ] wrong password → 401, account intact.

### KZ-21
**Login timing and blocking hashing** — when the email is unknown, still run a bcrypt compare
against a fixed dummy hash; switch to async `bcrypt.hash` / `bcrypt.compare` so the event loop is
not blocked (~70–100 ms per call today). Acceptance: [ ] response time for unknown vs known email
differs by < 20 ms at p50 over 100 tries. [ ] Health checks stay < 20 ms during a login burst.

### KZ-22
**Explain disabled Save buttons** — show field errors after a field is touched (on blur) rather
than only after Save, so a disabled button always has a visible reason. In
`AddMoneyScreen.tsx` pass errors through `t()`. Acceptance: [ ] every form shows why Save is
disabled; [ ] no raw translation key can render (test).

### KZ-23
**Stock rules** — implement decision D5 (recommended: allow the sale, let stock go negative, flag
it red, and log a warning activity). Allow "starting stock" on the create-product form (one
stock-in movement with reason "Opening stock"). Acceptance: [ ] chosen policy covered by API
tests; [ ] new product can be created with stock in one step.

### KZ-24
**Language code and server sync** — rename `pid` to a valid tag (migration of the stored
preference: read `pid`, write the new tag). `setAppLanguage` also `PATCH /auth/me/language`; on
login, use the server value if the device has none. Acceptance: [ ] language survives reinstall +
login; [ ] dates format correctly in all three languages.

### KZ-25
**Integer money storage and one formatter** — migration: `amount`/`price` columns to `INTEGER`
(round existing values; log any row that had a fraction). One formatter for money and prices
(`1 000 FCFA`); delete `src/items/format.ts`. Acceptance: [ ] all amounts in DB are integers;
[ ] prices and money render the same way.

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
Acceptance: [ ] `Cookie: kazi_admin_session=%E0%A4%A` → 401, not 500.

### KZ-28
**History "Older" range** — with only From, cap `endDate` at the day before this week starts;
with only To, cap at that day. Acceptance: [ ] "Older" never shows events from this week.

### KZ-29
**Secret strength at boot** — refuse to start in production if `JWT_SECRET` is shorter than 32
bytes or equals the `.env.example` value. Acceptance: [ ] boot fails with a clear message.

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
aggregate query; run `PRAGMA optimize` on shutdown and daily. Acceptance: [ ] budgets in
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
Acceptance: [ ] `tsc`, lint and tests pass; no unused exports reported.

### KZ-38
**CI pipeline** — GitHub Actions (or equivalent) on every push and PR: app `tsc`, lint, Jest;
server typecheck, tests, build; `npm audit --omit=dev --audit-level=high` on both; Android
`assembleRelease` on main. See [TESTING_QA.md](TESTING_QA.md#ci-pipeline).
Acceptance: [ ] a failing test blocks merge.
