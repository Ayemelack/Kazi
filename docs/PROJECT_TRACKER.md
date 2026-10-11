# Kazi — Project Tracker

Single source of truth for getting Kazi from "works in development" to "production complete".
Every task below comes from the full code review of 2026-10-09. The detailed fix for each task is
in [REMEDIATION_PLAN.md](REMEDIATION_PLAN.md); security and performance rules that every task must
respect are in [SECURITY.md](SECURITY.md) and [PERFORMANCE.md](PERFORMANCE.md). The work is
executed in 15 agent sessions; their prompts, the standing rules and the owner decisions are in
**[prompt.md](prompt.md)** (see [Execution plan](#execution-plan)).

**Last updated:** 2026-10-11 · **Overall progress:** 8 / 38 tasks done (21%)

---

## How to update this file (do this after every task)

1. Change the task's **Status** in the board below.
2. Tick its acceptance criteria in [REMEDIATION_PLAN.md](REMEDIATION_PLAN.md).
3. Update the counts in **Progress by phase** and the **Overall progress** line at the top.
4. Add one line to the **Update log** at the bottom: date, task ID, what changed, how it was
   verified (test command and result), and the commit hash.
5. If the task changed architecture, security posture, performance budgets or deployment steps,
   update the matching doc in the same commit.

A task is only **Done** when it meets the Definition of Done in [TESTING_QA.md](TESTING_QA.md#definition-of-done).

### Status legend

| Status | Meaning |
|---|---|
| ⬜ Not started | No work yet |
| 🟦 In progress | Someone is working on it |
| 🟨 Blocked | Waiting on a decision or an external dependency (say which in the log) |
| 🟪 In review | Code done, waiting for review / verification |
| ✅ Done | Merged and verified against its acceptance criteria |

---

## Progress by phase

| Phase | Goal | Tasks | Done | Progress |
|---|---|---|---|---|
| **P0** | Production blockers — the app cannot ship without these | 9 | 1 | 11% |
| **P1** | Correctness, security and data integrity | 10 | 2 | 20% |
| **P2** | Hardening and performance | 16 | 4 | 25% |
| **P3** | Documentation, hygiene and CI | 3 | 1 | 33% |
| **Total** | | **38** | **8** | **21%** |

Work the phases in order. Inside a phase, tasks can run in parallel unless the board says otherwise.

---

## Decisions

Owner decisions that shape specific tasks, copied from [prompt.md](prompt.md#owner-decisions) on
2026-10-10. Record each new decision and its date here. A task that depends on a _pending_ entry
builds everything that doesn't need the answer and marks the rest 🟨 Blocked.

| # | Decision | Blocks | Options | Decision |
|---|---|---|---|---|
| D1 | Remove the "no two accounts may share a password" rule? | KZ-05 | (a) Remove it and block common/breached passwords instead (**recommended**) · (b) Keep it (leaks which passwords exist) | **2026-10-10:** REMOVE it; block common/breached passwords instead |
| D2 | How are password-reset codes delivered? | KZ-06 | SMS (best fit for Cameroon) · Email · WhatsApp Business | **2026-10-10:** EMAIL first (address already on every account); SMS later (needs phone numbers collected and verified first). Email provider: _pending_ (examples: Brevo, Postmark, Amazon SES) |
| D3 | Production API domain and hosting | KZ-09, deployment | Domain, VPS/provider, region | _pending_ (still open 2026-10-10) |
| D4 | Session model | KZ-13 | Short access token + rotating refresh token (**recommended**) · Keep 30-day tokens with a server-side session table | **2026-10-10:** 15-min access token + rotating refresh token (`sessions` table) |
| D5 | Can a sale reduce stock below zero? | KZ-23 | Block (current) · Allow and warn (**recommended** for small shops) | **2026-10-10:** ALLOW; stock may go negative, shown in red, warning in history |
| D6 | What sends push notifications? | KZ-03 | Low-stock alert · Daily summary · Debt reminders · None for v1 | **2026-10-10:** Low-stock alert only (v1) |
| D7 | Show the last loaded data when the phone is offline? | PERFORMANCE §4 | Read-only cache of last results (**recommended**) · Stay strictly online | **2026-10-10:** YES — last results for Home, Products, History page 1 |

---

## Execution plan

The work runs as 15 agent sessions on the branch `release/production-readiness`, one commit per
task. Each session's prompt is in [prompt.md](prompt.md); a stopped session continues with the
resume prompt at the end of that file.

| # | Session | Tasks | Tracker phase | Status |
|---|---|---|---|---|
| 1 | Foundation and project structure | Structure (shared/, migrations, root scripts), KZ-30, KZ-37, KZ-38 (+ KZ-26, folded into the baseline migration) | Setup | ✅ Done — KZ-38 🟨 Blocked on owner (push + branch protection) |
| 2 | Shared contracts: money and validation | KZ-04, KZ-16, KZ-25 | P0 / P1 / P2 | ✅ Done |
| 3 | Connectivity, errors and language | KZ-01, KZ-12, KZ-22, KZ-24 | P0 / P1 / P2 | 🟦 In progress |
| 4 | Authentication hardening | KZ-05, KZ-29, KZ-21, KZ-20 | P0 / P2 | ⬜ |
| 5 | Password reset | KZ-06 | P0 | ⬜ |
| 6 | Abuse protection and dependencies | KZ-19, KZ-08, KZ-27 | P0 / P1 / P2 | ⬜ |
| 7 | Transactions, history and idempotency | KZ-07, KZ-11, KZ-10, KZ-28 | P0 / P1 / P2 | ⬜ |
| 8 | Push notifications and Firebase | KZ-02, KZ-03 | P0 | ⬜ |
| 9 | Release build and configuration | KZ-09, KZ-33 | P0 / P2 | ⬜ |
| 10 | Sessions and app start | KZ-13, KZ-17 | P1 | ⬜ |
| 11 | Items, images and stock | KZ-14, KZ-15, KZ-23 | P1 / P2 | ⬜ |
| 12 | Server performance, observability, backups, admin | KZ-32, KZ-34, KZ-35, KZ-18 (KZ-26 done in session 1) | P1 / P2 | ⬜ |
| 13 | App performance and read cache | KZ-31, decision D7 | P2 | ⬜ |
| 14 | Documentation | KZ-36 | P3 | ⬜ |
| 15 | Release-readiness audit | Milestones M1–M5 | Final | ⬜ |

---

## Task board

### P0 — Production blockers

| ID | Task | Sev | Area | Status | Spec |
|---|---|---|---|---|---|
| KZ-01 | Connectivity check uses plain HTTP and fails in release builds (permanent "offline" pill) | High | App | 🟨 Blocked | [→](REMEDIATION_PLAN.md#kz-01) |
| KZ-02 | iOS has no Firebase setup; app is expected to crash on launch | High | App / iOS | ⬜ Not started | [→](REMEDIATION_PLAN.md#kz-02) |
| KZ-03 | Push notifications: placeholder `google-services.json`, nothing triggers sends | High | App / API | ⬜ Not started | [→](REMEDIATION_PLAN.md#kz-03) |
| KZ-04 | Money input "1,000" / "1.000" is saved as 1 FCFA | High | App / API | ✅ Done | [→](REMEDIATION_PLAN.md#kz-04) |
| KZ-05 | Password-uniqueness rule reveals which passwords are in use | High | API / Security | ⬜ Not started | [→](REMEDIATION_PLAN.md#kz-05) |
| KZ-06 | Password reset is fail-open in dev and does not work at all in production | High | API / App | ⬜ Not started | [→](REMEDIATION_PLAN.md#kz-06) |
| KZ-07 | No way to delete or correct a transaction | High | App / API | ⬜ Not started | [→](REMEDIATION_PLAN.md#kz-07) |
| KZ-08 | Rate limiter ignores proxies, never frees memory | High | API / Security | ⬜ Not started | [→](REMEDIATION_PLAN.md#kz-08) |
| KZ-09 | Release signed with debug key; production API URL is a placeholder | High | Build | ⬜ Not started | [→](REMEDIATION_PLAN.md#kz-09) |

### P1 — Correctness, security and data integrity

| ID | Task | Sev | Area | Status | Spec |
|---|---|---|---|---|---|
| KZ-10 | Home "today" totals use the server's date instead of the user's | Medium | API / App | ⬜ Not started | [→](REMEDIATION_PLAN.md#kz-10) |
| KZ-11 | App never sends `clientOpId`; retries create duplicate records | Medium | App | ⬜ Not started | [→](REMEDIATION_PLAN.md#kz-11) |
| KZ-12 | Server errors shown in English to French / Pidgin users | Medium | App / API | ✅ Done | [→](REMEDIATION_PLAN.md#kz-12) |
| KZ-13 | Logout does not end the session; 30-day tokens; mid-session 401 not handled | Medium | API / App / Security | ⬜ Not started | [→](REMEDIATION_PLAN.md#kz-13) |
| KZ-14 | Item list ships every photo (up to 2 MB each) on every load | Medium | API / App / Perf | ⬜ Not started | [→](REMEDIATION_PLAN.md#kz-14) |
| KZ-15 | iPhone HEIC photos rejected; image bytes never checked | Medium | App / API / Security | ⬜ Not started | [→](REMEDIATION_PLAN.md#kz-15) |
| KZ-16 | App and server validation rules drift apart | Medium | App / API | ✅ Done | [→](REMEDIATION_PLAN.md#kz-16) |
| KZ-17 | Offline start with no cached profile shows the business-setup screen | Medium | App | ⬜ Not started | [→](REMEDIATION_PLAN.md#kz-17) |
| KZ-18 | Admin dashboard has no start script; build omits its web files | Medium | API / Admin | ⬜ Not started | [→](REMEDIATION_PLAN.md#kz-18) |
| KZ-19 | Vulnerable dependencies (1 critical + 2 high on server; 1 critical on app tooling) | Medium | Deps / Security | ⬜ Not started | [→](REMEDIATION_PLAN.md#kz-19) |

### P2 — Hardening and performance

| ID | Task | Sev | Area | Status | Spec |
|---|---|---|---|---|---|
| KZ-20 | Require password to delete the account | Low | API / App / Security | ⬜ Not started | [→](REMEDIATION_PLAN.md#kz-20) |
| KZ-21 | Login timing reveals registered emails; blocking password hashing | Low | API / Security / Perf | ⬜ Not started | [→](REMEDIATION_PLAN.md#kz-21) |
| KZ-22 | Disabled Save buttons give no reason; AddMoney would show raw keys | Low | App / UX | ✅ Done | [→](REMEDIATION_PLAN.md#kz-22) |
| KZ-23 | Stock rules: oversell policy, starting stock on create | Low | API / App | ⬜ Not started | [→](REMEDIATION_PLAN.md#kz-23) |
| KZ-24 | Pidgin language code is wrong (`pid`); language never saved on server | Low | App / API | ⬜ Not started | [→](REMEDIATION_PLAN.md#kz-24) |
| KZ-25 | Money stored as REAL with fractions; inconsistent number formatting | Low | API / App | ✅ Done | [→](REMEDIATION_PLAN.md#kz-25) |
| KZ-26 | Legacy migration drops `idx_transactions_user_type_date` | Low | API / DB | ✅ Done | [→](REMEDIATION_PLAN.md#kz-26) |
| KZ-27 | Admin: malformed cookie causes a 500 | Low | Admin | ⬜ Not started | [→](REMEDIATION_PLAN.md#kz-27) |
| KZ-28 | History "Older" with only a From date includes recent days | Low | App | ⬜ Not started | [→](REMEDIATION_PLAN.md#kz-28) |
| KZ-29 | Weak `JWT_SECRET` accepted at boot | Low | API / Security | ⬜ Not started | [→](REMEDIATION_PLAN.md#kz-29) |
| KZ-30 | Flaky Jest suites time out on a cold cache | Low | Tests | ✅ Done | [→](REMEDIATION_PLAN.md#kz-30) |
| KZ-31 | Long lists render with ScrollView + map (no virtualization) | Low | App / Perf | ⬜ Not started | [→](REMEDIATION_PLAN.md#kz-31) |
| KZ-32 | Server performance: SQLite pragmas, statement reuse, single-query summary | Low | API / Perf | ⬜ Not started | [→](REMEDIATION_PLAN.md#kz-32) |
| KZ-33 | Release build: R8/minify off, all ABIs in one APK | Low | Build / Perf | ⬜ Not started | [→](REMEDIATION_PLAN.md#kz-33) |
| KZ-34 | Observability: structured logs, request timing, readiness check | Low | API / Ops | ⬜ Not started | [→](REMEDIATION_PLAN.md#kz-34) |
| KZ-35 | Automated, tested database backups | Medium | Ops | ⬜ Not started | [→](REMEDIATION_PLAN.md#kz-35) |

### P3 — Documentation, hygiene and CI

| ID | Task | Sev | Area | Status | Spec |
|---|---|---|---|---|---|
| KZ-36 | Correct README and OFFLINE_FIRST_VERIFICATION.md | Low | Docs | ⬜ Not started | [→](REMEDIATION_PLAN.md#kz-36) |
| KZ-37 | Remove unrelated files, unused dependencies and dead offline code | Low | Hygiene | ✅ Done | [→](REMEDIATION_PLAN.md#kz-37) |
| KZ-38 | CI pipeline: typecheck, lint, tests, audit on every push | Medium | CI | 🟨 Blocked | [→](REMEDIATION_PLAN.md#kz-38) |

---

## Production-complete milestones

The product is "complete" when every milestone is checked.

- [ ] **M1 — Ship-blockers cleared:** all P0 tasks Done.
- [ ] **M2 — Data you can trust:** KZ-04, KZ-07, KZ-10, KZ-11, KZ-25 Done; money totals match between Home, History and the admin dashboard.
- [ ] **M3 — Secure by default:** every item in the [SECURITY.md](SECURITY.md#release-security-gate) release gate passes.
- [ ] **M4 — Fast on a budget phone on 3G:** every budget in [PERFORMANCE.md](PERFORMANCE.md#performance-budgets) is met and measured.
- [ ] **M5 — Release ready:** the [DEPLOYMENT.md](DEPLOYMENT.md#go-live-checklist) go-live checklist passes on a staging server and on real Android and iOS devices.

---

## Baseline (2026-10-09, before any fixes)

| Check | Result |
|---|---|
| Server `npm run typecheck` | ✅ clean |
| Server `npm test` | ✅ 103 / 103 |
| App `npx tsc --noEmit` | ✅ clean |
| App `npm run lint` | ✅ clean |
| App `npm test` | ⚠️ flaky — 3 suites time out on a cold cache; 109 / 109 on rerun |
| Server `npm audit --omit=dev` | 7 (1 critical, 2 high, 4 moderate) |
| App `npm audit --omit=dev` | 1 critical (`shell-quote`, tooling), several high |

---

## Update log

Newest first. One line per task or decision.

| Date | Task / Decision | Change | Verified by | Commit |
|---|---|---|---|---|
| 2026-10-11 | KZ-22 | New `src/forms/useFormErrors.ts`: a field's error (translation key from its validator, computed live) shows once the field is touched (TextField blur; picking a date or a star counts) or after a Save attempt; Save is disabled only while an error is visible, so an untouched form keeps Save enabled and pressing it reveals every reason (intended behaviour change: Save used to start disabled with no explanation). Holds the failed request too: a `VALIDATION_ERROR` about one of the form's fields shows under that field, anything else as the form message, translated while rendering. `reset` / `fail` are stable for effects. Applied to all 12 forms: Login, Signup, ForgotPassword, ResetPassword, BusinessProfile, MyBusiness, Feedback, DebtForm, AddMoney (errors through `t()`), TransactionForm, ProductForm, StockMovementDialog. Feedback gained a visible reason (`feedback.ratingRequired`, en / fr / pid); confirm-password rules moved to `validateConfirmPassword` (empty → required); Signup's email-in-use stays under the field until the address changes | `__tests__/forms.errors.test.tsx` 39: for each form, untouched → no errors and Save enabled; Save attempt → errors shown, Save disabled, and in en / fr / Pidgin a disabled Save always has a visible field error and no text matches `/^[a-z]+(\.[a-zA-Z]+)+$/`; editing / blurring every input keeps that invariant; blur shows only that field's error and clears when fixed; a visible error re-translates on `changeLanguage('fr')`; every key the validators return (sampled over 25 inputs) exists in all 3 locales. 27 of 39 fail on the pre-change forms. `npm run check:app` on exactly this commit's files: tsc clean, eslint clean, Jest 19 suites 215/215 (server and shared unchanged since KZ-12's full check) | this commit |
| 2026-10-11 | KZ-12 | Error contract in `shared/src/errors.ts`: `API_ERROR_CODES` (14 codes) + `ApiErrorCode`, `VALIDATION_RULES` (`required`, `invalid`, `format`, `tooShort`, `tooLong`, `tooSmall`, `tooLarge`, `tooEarly`, `tooLate`, `notAllowed`), `VALIDATION_FIELDS` (every request field the API validates), `ApiErrorBody`. Server: `ErrorCode = ApiErrorCode`; `VALIDATION_ERROR` responses add `field` + `rule` from the first zod issue (`issueDetail()`; custom refinements name their rule via `params: { rule }` in money, date, password-bytes and expense-description checks; service-thrown validation errors pass `{ field, rule }`); malformed / oversized bodies get `rule` without `field`; `message` kept for logs. App: `src/errors/messages.ts` `errorMessage(err, t, overrides?)` maps `NetworkError`, `SERVER_UNREACHABLE`, every shared code and field + rule to `errors.*` keys (en, fr, pid), unknown → `errors.generic`, never server text; `LocalError` for app-raised messages; the reset screen overrides `INVALID_TOKEN` / `TOKEN_EXPIRED` wording. `apiErrorMessage` deleted; every screen (13) keeps the error object in state and translates while rendering, so a language switch re-translates it. `ApiError` / `NetworkError` no longer call i18n; the client keeps `code`, `field`, valid `rule`. Fixed on the way: Home said "offline" for every failure (now the real reason, e.g. "can't reach Kazi"); Signup passed already-translated text through `t()`; the image picker returned pre-translated text. 10 superseded keys removed from each locale (`common.error.*`, `auth.errors.{emailInUse,invalidCredentials,tooManyRequests,passwordNotAllowed,generic}`, `products.errors.insufficientStock`, `debts.errors.alreadyPaid`) | Server `errors.test.ts` 23 (19 field/rule cases over HTTP, malformed JSON, non-validation shape, shared rule list, every schema field in `VALIDATION_FIELDS`): 20 of 23 fail on the pre-change server. App `errors.messages.test.ts` (codes / rules / fields in all 3 locales; unknown code and non-JSON body → generic, never server text; offline vs unreachable; field + rule wording; overrides; same error re-translated after `changeLanguage('fr')`; client parsing), `source.guards` (no `err.message` / `apiErrorMessage` in screens), Home: unreachable ≠ offline and re-translates on a language switch. `npm run check` on exactly this commit's files: shared 78/78, app tsc + eslint clean, Jest 18 suites 176/176, server 232/232 + build, exit 0 | this commit |
| 2026-10-11 | KZ-01 | `@react-native-community/netinfo` 12.0.1 added (ships a codegen TurboModule spec → New Architecture; peer `react-native >=0.59`). `src/offline/connectivity.ts` keeps `isOnline` / `subscribeConnectivity` / `probeConnectivity` but now follows NetInfo events: Android uses the OS's validated-internet signal, iOS checks `https://connectivitycheck.gstatic.com/generate_204` (status 204) only while the app is active; unknown reachability counts as online. `OfflineProvider`'s 30-second timer removed (reads once on mount, re-reads on return to foreground). NetInfo mock in `jest.setup.js`. Only `src/config/env.ts` (dev host) still contains `http://`, now enforced by `__tests__/source.guards.test.js`. Tracker housekeeping: the KZ-16 and KZ-25 log rows had landed in the "Progress by phase" table and were moved here. **🟨 Blocked** on the real-phone check (pill within 3 s of airplane mode on/off): needs a release build on a physical device (owner, device QA script) | **Baseline this session:** shared 78/78; app tsc + eslint clean; Jest 138/145 cold with 7 timeouts at 100% CPU (VS Code + Chrome), and the 3 affected suites pass 18/18 at HEAD run serially, so baseline = 145/145; server 209/209 + build. **KZ-01:** new `connectivity.test.ts` (7) + `source.guards.test.js` (1); 5 of the 7 fail on the old module (the 2 API-client tests pin behaviour that already existed). `npm run check:app` on exactly this commit's files: tsc clean, eslint clean, Jest 17 suites 153/153 | this commit |
| 2026-10-11 | KZ-16 | `shared/src/limits.ts` holds every limit both sides enforce (person name 50, company name 2–100, business type 60, email 254, password 8 chars min / 72 UTF-8 bytes max + `utf8ByteLength`, item name 2–100, notes 500, stock reason 200, quantity and low-stock threshold 1e9, transaction description 200, debt name 100 / note 200, feedback 1000, client-op-id 8–64, history page 30 / API default 50 / max 200 / offset 1e6); `shared/src/date.ts` holds the business-date window (2000-01-01 to today + 365) and the date helpers moved from `server/src/validation/date.ts`. Server zod schemas (auth, items, transactions, debts, feedback, activity, dates) and app validators import them; password max is now bytes on the server (was 72 characters) and enforced on the app (was missing); the app now enforces business type 60 and the date window (new keys `auth.errors.businessTypeMax`, `auth.errors.passwordMax`, `transactions.errors.dateOutOfRange`, `debts.errors.dateOutOfRange` in en, fr, pid). Date picker: window from the shared constants (was years 1000–9999), out-of-window days and months disabled, opens on today when the value is outside the window. Every `maxLength` names a shared constant; History asks for `HISTORY_PAGE_SIZE`. Spec revised: one shared source makes the planned two-file parity test meaningless, so each side has a boundary test per limit, plus a guard against literal `maxLength` (plain JS test, because the app's type program has no Node types) | `server/src/validation/limits.test.ts` 29 boundary tests (incl. 2- and 4-byte passwords); `__tests__/limits.boundary.test.ts` 20 + `limits.maxlength.test.js` 2; shared `limits.test.ts` 13 (`utf8ByteLength` agrees with `Buffer.byteLength`, inclusive window, leap years). Pre-change auth validators fail 3 tests on each side (app: business type, ASCII and multi-byte password max; server: 2-byte, 4-byte and 37-character password). Root `npm run check` exit 0: shared 78/78, app tsc + eslint clean, Jest 15 suites 145/145, server 209/209 + build. Session 2 complete | this commit |
| 2026-10-11 | KZ-25 | Migration `0002_integer_money`: rebuilds `items`, `transactions`, `debts`, `activity` with `INTEGER` money columns and `typeof(x) = 'integer'` CHECKs (plus `price >= 0`, `amount > 0`; activity amount nullable); copies with `ROUND()` (half away from zero; a positive amount under 0.5 becomes 1 so `amount > 0` holds); recreates every index and trigger from its own SQL, keeps FKs and `sqlite_sequence`; renames with `legacy_alter_table = ON` (without it SQLite rewrote `stock_movements`/`transactions` REFERENCES to the dropped `items_legacy` — measured); logs one warning with per-table counts of rounded rows, never values. `src/items/format.ts`, `src/money/format.ts` and their test deleted; Home, History, AddMoney, Debts and Products (prices) all use `formatMoney` from `@kazi/shared`. Admin dashboard: `app.js` is now an ES module importing `formatMoney` from `/shared/index.js` (the built package, served read-only) for Money in/out, Capital, Net flow, chart volume and activity amounts; counts still use `num()`. Migration tests no longer hardcode "baseline is last". Intended test change: screen tests now expect U+202F; NNBSP literals written as `\u202f` escapes (the KZ-04 commit had invisible U+202F characters in tests and `MONEY_SEPARATOR`; same value) | New `0002_integer_money.test.ts` (3): fresh DB (INTEGER types; 12.5, 0, -1 rejected by CHECK), DB with fractions (7 rounded, counts-only warning, rows/indexes/FKs/sequence kept, CASCADE and SET NULL still act, no `_legacy` left), upgraded schema == fresh. With `legacy_alter_table` forced OFF, 2 of 3 fail. Root `npm run check` exit 0: shared 65/65, app tsc + eslint clean, Jest 13 suites 123/123, server 180/180 + build. Manual: real file DB applied `1_baseline`, `2_integer_money`; admin (`ADMIN_TLS=off`) served `/`, `/app.js`, `/shared/index.js`, `/shared/money.js` 200 `application/javascript`, `/shared/nope.js` 404, `<script type="module">`; `/api/stats` totals 1234567 / 1000 formatted by the served module as `1 234 567 FCFA` / `1 000 FCFA` | this commit |
| 2026-10-11 | KZ-04 | `@kazi/shared` gains `parseMoneyInput` (whole FCFA; spaces/NBSP/NNBSP removed; `,` or `.` only as thousands separators in groups of three, one kind per number; decimals, exponents, hex, signs, empty and mixed separators rejected; returns a safe integer), `formatMoney` (`1 000 FCFA`, narrow no-break space U+202F everywhere) and `MONEY_MAX` (1e12). `parseAmount`, `parsePrice` and the debt form's `Number(x.replace(',', '.'))` deleted; sale, expense, capital, debt and product forms validate and submit through the shared parser, show `= 1 000 FCFA` under the field while typing (`src/money/input.ts`), allow 24 characters and use `decimal-pad`. AddMoney now translates its field errors (raw keys before; overlaps KZ-22). `amountInvalid`/`priceInvalid` messages say what is accepted (en, fr, pid); unused `priceNegative` removed. Server: `moneyAmountSchema` and new `priceSchema` accept only a JSON safe integer or a digit string (no coercion: booleans, arrays, hex, exponents, decimals, separators rejected). Spec corrected: parser lives in `shared/src/money.ts`, not `src/money/parse.ts`. Tests changed for the intended behaviour change: `-5` / `2500.5` are now "invalid" rather than "negative"/accepted. **Baseline:** this session's pre-change `npm run check` overlapped my first edits, so I stopped it; the baseline is session 1's clean `npm run check` at the same code (`e7b1181` was docs-only) | Manual sanity run (`shared/dist`, `·` = U+202F): `"1,000"`, `"1.000"`, `"1 000"`, `"1000"` → 1000 → `1·000·FCFA`; `"1,000,000"`, `"1.000.000"` → 1000000; `"1,5"`, `"12.34"`, `"0x10"`, `"1e3"`, `"-5"`, `""`, `"1,000.000"` → rejected. The old parser gave `"1,000"`→1, `"1.000"`→1, `"0x10"`→16, `"1e3"`→1000, `"-5"`→-5 (9 of 13 wrong), and the old server schemas accepted `12.5`, `"12.5"`, `"1e3"` and price `2500.5`. `shared` `npm run check` 65/65; app `tsc` clean, `eslint .` clean, Jest 14 suites 127/127; server typecheck clean, 177/177, build OK | this commit |
| 2026-10-11 | Session 1 docs | ARCHITECTURE §3 (layout: shared/, server/src/db/migrations, .github/; shared-contracts rules), §6.1 (migrations, in the KZ-26 commit), §9 ADRs A10 (shared package; the path-mapped fallback was not needed) and A11 (numbered migrations); prompt.md session 13 now says A12 for the read cache since A10/A11 are taken; TESTING_QA §1 (`npm run check`, install order, counts); DEPLOYMENT §4 (deploy shared/ next to server/; migrations on boot); README layout, setup order, scripts and "Tests & checks". Session 1 complete | Same evidence as KZ-30 (clean `npm ci` + `npm run check` exit 0 + 3 cold Jest runs) | this commit |
| 2026-10-11 | KZ-38 | `.github/workflows/ci.yml`: `app` (shared check, tsc, lint, `jest --ci --maxWorkers=50%` with cached transforms), `server` (typecheck, test, build), `audit` (root, server, shared at `--audit-level=high`; push, PR, weekly; `continue-on-error` until KZ-19 in session 6, comment says why), `android-release` / `ios-build` manual-only placeholders for session 9. Every job installs `shared/` first. **🟨 Blocked:** the acceptance "a failing test blocks merge" needs (1) the branch pushed so the workflow runs on GitHub (pushing is outside this session's rules) and (2) branch protection on `main` requiring `app` and `server` — both owner actions (TESTING_QA.md "CI pipeline") | YAML parses (js-yaml: 5 jobs); each job's commands pass locally (`npm run check`, run 1 under KZ-30); a failing Jest test exits non-zero (cold run before the KZ-30 fix: `EXIT=1`). Not yet run on GitHub | this commit |
| 2026-10-11 | KZ-37 | `zulu-chronicle/` copied to `../kazi-archive/zulu-chronicle/` (all 3 files SHA-256 verified) and removed; `@react-native/new-app-screen` uninstalled (no references in src, App, index.js, tests, Gradle or Podfile); removed `PendingOp`, `LocalItem`, `LocalTransaction`, `LocalDebt`, `pendingCount` (provider + pill), `queued` (facade results + 4 screens + test mocks), the unused `KAZI_NOTIFICATION_CHANNEL` alias, and locale keys `offline.offlineWithPending` / `savedOnPhone` / `notAvailableOffline` (en, fr, pid). Kept `LocalActivity`, `SyncStatus`, `syncStatus` (History). Left `getDebt`, `getTransaction`, `listStockMovements` for KZ-07 per spec. No user-visible change: `queued` was always false and `pendingCount` always 0 | `npx tsc --noEmit` clean; `eslint .` clean; unused-export scan of `src/` → only the 3 deferred API functions; i18n parity test passes; full suites green in the 3 cold runs logged under KZ-30 | this commit |
| 2026-10-11 | KZ-30 | Cause measured with an instrumented Babel transformer: RN lazy getters + host-component refs made the first test of each screen suite transform ~70 modules inside its timeout (28 s of 30 s). `testTimeout: 30000` alone still failed (cold `npm run check` before the fix: 3 suites timed out at 30 s, 107/110). Fix: `jest/preloadReactNative.js` (untimed setup), `jest/unmountAfterEach.js` (no timers after teardown), `ToastProvider` clears its timer on unmount, Jest `roots` limited to app folders, form harnesses get a first tab (no `GO_BACK` noise) | Clean `npm ci` in shared/, root, server/, then Jest cache cleared before each of 3 cold runs: run 1 `npm run check` exit 0 (shared 1/1, app 13 suites 110/110 + tsc + lint, server 111/111 + tsc + build); runs 2 and 3 `npx jest` 110/110; 0 `GO_BACK` / post-teardown messages. Machine was CPU-saturated (99%) by other apps, so suite times were 25–340 s | this commit |
| 2026-10-10 | KZ-26 + structure | Numbered migration framework: `server/src/db.ts` → `server/src/db/` (same exports), `schema_migrations`, per-migration transaction with foreign keys off + `foreign_key_check`; `0001_baseline` reproduces the old boot schema byte-for-byte and recreates all three transaction indexes after the capital rebuild (KZ-26, folded in) and keeps `sqlite_sequence`. 7 new tests (fresh, pre-capital, pre-framework, reopen no-op, rollback, FK violation, ordering); KZ-26 assertion and sequence assertion each fail when their fix is removed. Server test script now globs `src/**/*.test.ts` | `cd server && npm run typecheck && npm test && npm run build` → clean, 111/111 pass (103 before + 1 shared + 7 migrations), build OK; built server boots on a temp DB and applies `1_baseline` | this commit |
| 2026-10-10 | D1–D7 | Owner decisions copied from prompt.md into the Decisions table (D2 email provider and D3 still pending); Execution plan section added; branch `release/production-readiness` created | — | this commit |
| 2026-10-10 | — | Added docs/prompt.md: 15 session prompts + resume prompt covering all 38 tasks | — | — |
| 2026-10-09 | — | Docs folder created from the full code review; 38 tasks logged, 7 decisions open | — | — |
