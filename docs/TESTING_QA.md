# Kazi — Testing and Quality

How Kazi is tested, what "done" means for a task, which tests each task must add, and the CI
pipeline that enforces it.

---

## 1. Current state (baseline 2026-10-09)

| Suite | Runner | Command | Result |
|---|---|---|---|
| Server (8 files, 103 tests) | `node --test` via `tsx` | `cd server && npm test` | ✅ all pass |
| Server types | `tsc` | `cd server && npm run typecheck` | ✅ clean |
| App (12 suites, 109 tests) | Jest, `@react-native/jest-preset` | `npm test` | ⚠️ 3 suites time out on a cold cache, pass on rerun (KZ-30) |
| App types | `tsc` | `npx tsc --noEmit` | ✅ clean |
| App lint | ESLint | `npm run lint` | ✅ clean |
| CI | — | — | ❌ none (KZ-38) |

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
| Contract | Jest + server source | Validation limits and error codes match across app and API (KZ-12, KZ-16) | Every push |
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
| KZ-16 | Limits parity test |
| KZ-17 | Offline start without cached profile shows retry screen |
| KZ-18 | Build output contains `dist/admin/public/index.html` |
| KZ-19 | CI audit step |
| KZ-20 – KZ-29 | One regression test per item covering the acceptance criterion |
| KZ-30 | 10 consecutive cold CI runs green |
| KZ-31 – KZ-33 | Measurements recorded per [PERFORMANCE.md](PERFORMANCE.md#6-how-to-measure) |
| KZ-34 | Log output contains no body, token, email or amount (snapshot test) |
| KZ-35 | Restore drill script exits 0 |

---

## 3. Fixing the flaky suites (KZ-30)

Observed: on a cold Jest cache, `App.test.tsx`, `addmoney.capital.test.tsx` and
`transactionform.items.test.tsx` took ~60 s each and failed; alone they take ~6 s and pass.
This points at transform time under parallel load hitting the 5 s per-test default.

1. Set `testTimeout: 30000` in `jest.config.js` (or per screen suite).
2. In CI run `jest --ci --maxWorkers=50%` and cache `node_modules/.cache` / Jest cache dir.
3. Check which modules are transformed on first run (`--logHeapUsage`, `--detectOpenHandles`);
   mock heavy native-UI modules the same way `lucide-react-native` is mocked.
4. Remove the `GO_BACK was not handled` noise by rendering screens inside a navigator in tests,
   so real navigation errors stay visible.

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

To be added under `.github/workflows/ci.yml` (KZ-38). Every job runs `npm ci` with the lockfile.

| Job | Trigger | Steps |
|---|---|---|
| `app` | push, PR | `npx tsc --noEmit` · `npm run lint` · `npx jest --ci --maxWorkers=50%` |
| `server` | push, PR | `npm run typecheck` · `npm test` · `npm run build` |
| `audit` | push, PR, weekly | `npm audit --omit=dev --audit-level=high` in root and `server/` |
| `android-release` | push to `main`, tags | `./gradlew bundleRelease` with signing secrets (KZ-09) |
| `ios-build` | tags (macOS runner) | `pod install` · `xcodebuild archive` |

Branch protection on `main`: all jobs green and one review before merge.
