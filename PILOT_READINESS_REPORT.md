# Kazi — Phase 5 Pilot-Readiness Report

**Phase:** 5 — Small-group pilot readiness only (no public launch, no new features).
**Date:** 2026-10-11
**Scope:** Inspection, test execution, this report, and two tester documents. No application
source, authentication, database schema, welcome screen, or build settings were changed.

---

## 1. Deliverables created

| Document | Purpose |
|----------|---------|
| `PILOT_TESTING_CHECKLIST.md` | Non-technical step-by-step checklist for testers (install → account → record → find → verify totals → reopen app → report issues). |
| `PILOT_FEEDBACK_TEMPLATE.md` | Plain-language feedback form (easy to use / difficult to understand / anything fail / could you find past transactions / would you continue / single most important improvement + optional ratings). |

Both use clear wording for non-technical business owners and instruct testers to use
**pretend (synthetic) data only**.

---

## 2. Existing features actually verified

Verification means the behaviour was exercised through the existing automated suites and/or
read directly in the code path — not assumed from the presence of a file.

| Journey | Verified how | Result |
|---------|--------------|--------|
| Account creation & sign-in | Server `auth` tests: signup, duplicate email, invalid input, login, wrong password, `/me`, tampered token; mobile `auth.validation` tests; `AuthContext` + `SignupScreen`/`LoginScreen` reviewed | Pass |
| Session persistence after restart | `AuthContext` rehydrates from Keychain token + AsyncStorage cached profile; 401 clears session | Pass (code path); not re-run on a physical device (see §6) |
| Product management | Server `items.test.ts`, `items/stock.test.ts`; `ProductsScreen` reviewed | Pass |
| Recording sales & expenses | Server `transactions.test.ts` (sale/purchase/capital, stock effects, delete-reversal); `TransactionFormScreen` reviewed | Pass |
| Transaction history & date filters | Server `activity.test.ts` (period filters, range, stable paging, cross-account isolation); `HistoryScreen` reviewed | Pass |
| Daily / weekly summaries | Server `summary` (today received/spent/net, totals) + activity summary (received/spent/made/capital); `HomeScreen` reviewed | Pass |
| Outstanding money owed | Server `debts` tests (create/list/pay/delete, paid-on date, owner scoping); `DebtsScreen` reviewed | Pass |
| Daily reminders (if implemented) | `reminder.test.ts` unit tests + `reminder.screen.test.tsx` (passes in isolation) | Feature works; see the test-runner defect in §4 |
| Feedback capture | Server `feedback` validation/routes; `FeedbackScreen` reviewed | Pass |

**Data protection / isolation — verified, not assumed.** Every resource query in
`server/src/*/service.ts` is filtered by `user_id`, and the suite contains explicit
cross-account tests that pass: items (`each user sees only their own items`,
`cannot touch another user item`), transactions (`isolation: another user cannot see or
delete these transactions`), debts (`a user cannot read or delete another user debt`),
activity (`another account sees none of this history in any period`) and notifications
(`a user cannot unregister another user token`). The session token is stored only in the
device Keychain (`WHEN_UNLOCKED_THIS_DEVICE_ONLY`), no financial data is cached locally,
and no tokens or passwords are logged. No cross-tenant exposure was found.

---

## 3. Tests and checks performed — actual results

| Check | Command | Result |
|-------|---------|--------|
| Server tests | `cd server && npm test` | **103 / 103 pass** (8 files) |
| Server typecheck | `cd server && npm run typecheck` | **Clean** |
| Mobile unit tests | `npm test` (Jest) | 14 suites / 119 tests: **119/119 pass on one full run**, but **fails intermittently** (1–3 failures) — see §4 |
| Mobile typecheck | `npx tsc --noEmit` | **Clean** (exit 0) |
| Mobile lint | `npm run lint` | **0 errors, 0 warnings** (exit 0) |
| JS bundle (build check) | `npx react-native bundle --platform android --dev false` | **Built successfully** (exit 0, 20 assets) |

All server tests use an **in-memory** SQLite database (`openDatabase({ filename: ':memory:' })`).
The existing `server/data/kazi.db` was **not** opened, reset, or modified. Mobile tests use a
mocked AsyncStorage. No real business records were used.

---

## 4. Defects and status

### No critical product defect found
No cross-user data exposure, authentication bypass, or figure-accuracy defect was found.
Money arithmetic uses exact summing and FCFA formatting; delete operations reverse stock and
remove the matching history entry in the same transaction.

### Non-blocking defect (test infrastructure only) — NOT FIXED, approval requested
- **Symptom:** the mobile Jest suite is flaky. Across four full runs it produced 1 failure, 3
  failures, 0 failures, and a hard process exit. The failing tests are in
  `__tests__/reminder.screen.test.tsx` (`schedules a daily reminder when switched on` times
  out at the default 5 s under parallel load). The three reminder tests **all pass in
  isolation** (577 ms), so the reminder feature itself is working.
- **Root cause:** `src/components/ui/Toast.tsx:75` schedules `setTimeout(hide, 3200)` but
  never clears it on unmount. When the test renderer is torn down first, the pending timer
  fires against a torn-down module registry (`Animated` undefined) and crashes the worker.
  The "worker process has failed to exit gracefully" and "import after Jest environment torn
  down" warnings are the same pending timer.
- **Real-user impact:** none observed. In the running app `Animated` is always defined and a
  post-unmount `setToast(null)` is a harmless no-op under React 19. This is a test-runner
  cleanliness problem, not a user-facing failure.
- **Proposed fix (needs approval — it is in a shared component, outside the checklist's
  direct scope):** add a `useEffect(() => () => clearTimeout(timer.current), [])` cleanup in
  `ToastProvider`. One small, self-contained change; no behaviour change.

No other defect was introduced or discovered that falls inside the pilot-checklist scope.

---

## 5. Remaining prerequisites for a small pilot

These are **hard blockers** for handing the app to real testers; none were changed in this
phase.

1. **Production JWT secret.** `server/.env` currently holds the development placeholder
   secret. Set a long random `JWT_SECRET` before any real use (documented in
   `SECURITY_ASSESSMENT.md` F8).
2. **A reachable backend for testers.** In a non-dev build the app targets
   `PROD_API_URL = 'https://api.kazi.app'` (`src/config/env.ts:37`), which is a placeholder.
   A pilot build must point at a real, running HTTPS backend.
3. **An installable build that does not need Metro.** The existing
   `android/app/build/outputs/apk/debug/app-debug.apk` loads JavaScript from Metro and needs a
   developer laptop on the same network; it is not suitable for non-technical testers. A
   release/standalone build is required. The release build currently reuses the **debug
   keystore** (`android/app/build.gradle:104`) — acceptable for an internal pilot sideload
   only, not for any store.
4. **Password reset has no delivery channel.** In production the reset code is deliberately
   withheld (`server/src/auth/routes.ts:62`) and there is no email/SMS sender, so a tester who
   forgets their password cannot recover it. Either wire a sender, or pre-create pilot
   accounts and tell testers to contact the team.
5. **Push notifications (optional).** Disabled without a Firebase service account; this does
   **not** affect daily reminders, which are scheduled locally on the device.
6. **Data handling decision.** Agree what happens to any pilot data after the pilot, and
   reinforce the checklist instruction to use synthetic data only.

---

## 6. Manual steps required before testing with real users

1. Set a real `JWT_SECRET` in `server/.env`; start the backend; confirm `GET /health` returns
   `{ "status": "ok" }`.
2. Deploy/host the backend on HTTPS reachable from tester phones; update `PROD_API_URL` in
   `src/config/env.ts` (or provide an environment-specific build) and rebuild.
3. Produce and sideload (or internal-track distribute) a standalone pilot build; verify it
   opens **without** Metro and that sign-in works against the pilot server.
4. Create the pilot test accounts (or enable reset delivery, see §5.4).
5. Do a **one-time smoke test on a real device** covering: install → create account → record a
   sale → find it in History → check Home totals → force-close and reopen → confirm the record
   and totals persist. This satisfies checklist steps 1–6 on hardware, which the automated
   suite does not cover.
6. Hand testers `PILOT_TESTING_CHECKLIST.md` and `PILOT_FEEDBACK_TEMPLATE.md`; collect results.
7. (Recommended, separately approved) apply the one-line `Toast` timer cleanup from §4 so the
   mobile suite is deterministic, and re-run `npm test`.

---

## 7. Verdict

- **No critical security or data-integrity defect was found**, and account/tenant isolation
  is verified by passing cross-account tests.
- **Kazi is NOT yet pilot-ready for real users** until the prerequisites in §5 are completed —
  above all a strong `JWT_SECRET`, a reachable backend, a standalone installable build, and a
  password-reset decision (§5.1–5.4).
- No application code, database, authentication, welcome screen, or unrelated logic was
  modified in this phase. This phase did not publish, distribute, or launch anything.

**Awaiting your explicit approval before any further changes or distribution.**
