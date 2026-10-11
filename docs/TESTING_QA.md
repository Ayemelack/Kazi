# Kazi — Testing and Quality

How Kazi is tested, what "done" means for a task, which tests each task must add, and the CI
pipeline that enforces it.

---

## 1. Current state (updated 2026-10-10, session 1)

**One command runs everything:** `npm run check` at the repository root — `shared/` typecheck +
tests + build, then app typecheck + lint + Jest, then server typecheck + tests + build. On a fresh
clone install `shared/` first: `(cd shared && npm ci) && npm ci && (cd server && npm ci)`.

| Suite | Runner | Command | Result |
|---|---|---|---|
| Shared (`shared/src/**/*.test.ts`) | `node --test` via `tsx` | `cd shared && npm run check` | ✅ 1 / 1; typecheck + build clean |
| Server (`src/**/*.test.ts`, 10 files, 111 tests) | `node --test` via `tsx` (glob, so new files are never skipped) | `cd server && npm run check` (typecheck + test + build) | ✅ all pass |
| App (13 suites, 110 tests) | Jest, `@react-native/jest-preset`, `testTimeout` 30 s | `npm test` | ✅ passes cold (KZ-30) |
| App types | `tsc` | `npm run typecheck` | ✅ clean |
| App lint | ESLint | `npm run lint` | ✅ clean |
| CI | GitHub Actions | `.github/workflows/ci.yml` | Added (KZ-38); see [CI pipeline](#ci-pipeline) |

Existing coverage is strong on server validation, idempotency, stock effects and cross-user
isolation, and on app validation, money formatting and i18n parity. Gaps: no end-to-end tests, no
native-build checks, no performance or load tests, no test for release-only behaviour (cleartext,
minification).

---

## 2. Test layers

| Layer | Tool | Scope | Runs |
|---|---|---|---|
| Unit (app) | Jest | Validation, parsers, formatters, helpers | Every push |
| Component (app) | Jest + react-test-renderer | Screens with mocked API | Every push |
| API integration | `node --test` + in-memory SQLite | Routes end to end, isolation, idempotency | Every push |
| Contract | Jest + node:test | Both sides import limits from `@kazi/shared` and boundary-test each one (KZ-16); error codes match across app and API (KZ-12) | Every push |
| Release build | Gradle `bundleRelease` / Xcode archive | Builds, R8 keep rules, config present | `main` and release branches |
| Load / performance | autocannon or k6 + seed script | Budgets in [PERFORMANCE.md](PERFORMANCE.md) | Before each release |
| Device QA | Manual script below | Real phones, release build | Before each release |
| Security | Checklist + adversarial pass | [SECURITY.md](SECURITY.md) gate | Before each release |

---

## Definition of Done

A task in [PROJECT_TRACKER.md](PROJECT_TRACKER.md) is Done only when all of these hold:

1. All acceptance criteria in [REMEDIATION_PLAN.md](REMEDIATION_PLAN.md) are ticked.
2. New or changed behaviour is covered by tests listed below; tests fail without the fix.
3. App: `npx tsc --noEmit`, `npm run lint`, `npm test` pass. Server: `npm run typecheck`,
   `npm test`, `npm run build` pass.
4. New user-facing text exists in `en`, `fr` and Pidgin (parity test passes).
5. Security and performance PR checklists in [SECURITY.md](SECURITY.md#8-review-checklist-for-every-pull-request)
   and [PERFORMANCE.md](PERFORMANCE.md#7-performance-review-checklist-for-every-pull-request) are satisfied.
6. Affected docs updated in the same change.
7. Tracker status, counts and update log updated, including the verification command and result.

---

## Tests required per task

| Task | Tests to add |
|---|---|
| KZ-01 | Connectivity module with NetInfo mock: online/offline events, `isOnline()` result; API client maps fetch failure to `NetworkError` only when offline |
| KZ-02 | Background-handler setup survives a throwing `getMessaging()` (Jest); manual iOS launch check |
| KZ-03 | Server: low-stock push sent after commit, not sent when below-threshold not crossed, push failure doesn't fail the sale (mock messaging) |
| KZ-04 | Table-driven `parseMoneyInput` tests (valid and invalid inputs listed in the plan); server rejects fractional amounts |
| KZ-05 | Same password on two accounts succeeds; common password refused; table gone after migration |
| KZ-06 | Code never in response with `NODE_ENV=production`; boot refuses `ALLOW_DEV_RESET_CODE` in production; attempt limit; uniform responses |
| KZ-07 | `/activity` returns refs; History delete flow (component test); stock restored after delete |
| KZ-08 | Separate buckets per forwarded IP with `TRUST_PROXY`; spoofed header ignored without it; per-email login limit; map pruning |
| KZ-09 | Build script fails without an `https://` API URL (CI job) |
| KZ-10 | `/summary?asOf=` with fixed dates across a midnight boundary |
| KZ-11 | Retry reuses `clientOpId` (app); replay returns same record (server, exists — extend to each write route) |
| KZ-12 | Every server error code has a key in all locales; screens never render `err.message` |
| KZ-13 | Refresh rotation, reuse detection, logout revocation, expired session → login screen |
| KZ-14 | `/items` has no image data; image route ETag/304; Home makes no `/items` call |
| KZ-15 | Magic-byte checks: JPEG/PNG/WebP accepted, GIF/HTML/SVG rejected; decoded size limit |
| KZ-16 | Boundary test per shared limit on each side (`__tests__/limits.boundary.test.ts`, `server/src/validation/limits.test.ts`); multi-byte password test; no literal `maxLength` in `src/` |
| KZ-17 | Offline start without cached profile shows retry screen |
| KZ-18 | Build output contains `dist/admin/public/index.html` |
| KZ-19 | CI audit step |
| KZ-20 – KZ-29 | One regression test per item covering the acceptance criterion |
| KZ-30 | 10 consecutive cold CI runs green |
| KZ-31 – KZ-33 | Measurements recorded per [PERFORMANCE.md](PERFORMANCE.md#6-how-to-measure) |
| KZ-34 | Log output contains no body, token, email or amount (snapshot test) |
| KZ-35 | Restore drill script exits 0 |

---

## 3. Flaky suites on a cold cache (KZ-30, fixed in session 1)

Observed: on a cold Jest cache, `App.test.tsx`, `addmoney.capital.test.tsx` and
`transactionform.items.test.tsx` took ~60–800 s each and failed; alone and warm they take seconds.

Cause (measured with an instrumented Babel transformer): React Native's index requires most
components lazily, and host-component refs pull in the renderer's public-instance / DOM modules.
So the **first test** of each screen suite transformed ~70 modules inside its own timeout. Raising
`testTimeout` to 30 s alone did not fix it on a loaded machine.

What is in place:

1. `jest/preloadReactNative.js` (`setupFilesAfterEnv`) loads those modules and renders a tiny host
   tree once per test file — setup files are not timed. Add an export here if the app starts using
   a new `react-native` component.
2. `jest/unmountAfterEach.js` unmounts every `ReactTestRenderer.create` tree after each test, so
   timers (toasts, tab transitions, animation loops, the connectivity poll) never fire after
   teardown or keep a single-file run alive. `ToastProvider` clears its timer on unmount.
3. `testTimeout: 30000` for headroom; Jest `roots` limited to `__tests__`, `src`, `__mocks__`.
4. Screens that call `goBack()` are rendered with a first tab, so there is no
   `GO_BACK was not handled` noise and real navigation errors stay visible.
5. CI runs `jest --ci --maxWorkers=50%` with the transform cache restored by `actions/cache`.

---

## 4. Manual device QA script (release build)

Run on one low-end Android phone, one recent Android phone and one iPhone, in English and French
(and Pidgin spot-checks), before every release. Record pass/fail in the tracker log.

**Account**
- [ ] Sign up → business profile → lands on Home.
- [ ] Log out, log in; wrong password shows a translated error.
- [ ] Forgot password: code arrives by the chosen channel (KZ-06), reset works, old session ends.
- [ ] Delete account asks for the password and removes all data.

**Money**
- [ ] Record a sale typing `1 000`, `1,000` and `1.000` → each saved as 1 000 FCFA (KZ-04).
- [ ] Record an expense with a preset; with a custom description.
- [ ] Add capital. Record and settle a debt.
- [ ] Home "today" totals match History "today" totals, including just after midnight (KZ-10).
- [ ] Delete a sale from History; totals and stock update (KZ-07).

**Products and stock**
- [ ] Create a tracked product with opening stock; sell it below the threshold → low-stock badge,
      Home alert and push (KZ-03, KZ-23).
- [ ] Add a photo from the gallery (iPhone HEIC photo too) (KZ-15).
- [ ] Scroll a list of 1 000 items smoothly (seeded account) (KZ-31).

**Network**
- [ ] Airplane mode → offline pill within 3 s; back online → pill gone (KZ-01).
- [ ] API stopped, phone online → "server unreachable", not "offline".
- [ ] Slow 3G: save a sale, kill the network before the response, retry → one sale only (KZ-11).

**Platform**
- [ ] Cold start time within budget; app starts with Firebase misconfigured (KZ-02).
- [ ] Notifications arrive in foreground, background and when the app is closed.
- [ ] Language switch persists after reinstall + login (KZ-24).

---

## CI pipeline

`.github/workflows/ci.yml` (KZ-38). Every job runs `npm ci` with the lockfile, installing
`shared/` first (its `prepare` builds `shared/dist`). Node 22.

| Job | Trigger | Steps |
|---|---|---|
| `app` | push, PR, manual | `shared`: `npm run check` · `npx tsc --noEmit` · `npm run lint` · `npx jest --ci --maxWorkers=50%` with the Jest transform cache restored from `actions/cache` |
| `server` | push, PR, manual | `npm run typecheck` · `npm test` · `npm run build` |
| `audit` | push, PR, weekly, manual | `npm audit --omit=dev --audit-level=high` in root, `server/` and `shared/`. **Non-blocking (`continue-on-error`) until session 6 (KZ-19)** fixes or documents the known advisories; then it becomes blocking |
| `android-release` | manual only (placeholder) | Session 9 (KZ-09/KZ-33): `./gradlew bundleRelease` with signing secrets and `KAZI_API_URL` |
| `ios-build` | manual only (placeholder) | Session 9: macOS runner, `pod install` · `xcodebuild archive` |

Branch protection on `main` (owner action in GitHub → Settings → Branches): require the `app`,
`server` and (after session 6) `audit` checks to pass, and one review, before merge.
