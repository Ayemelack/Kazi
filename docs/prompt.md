# Kazi — Session Prompts (start → production-complete)

A sequence of prompts that takes Kazi from its current state to production-complete. **Each prompt
starts a brand-new chat** with an AI coding agent (Claude Code) opened at the repository root. The
agent has no memory of earlier sessions; everything it needs is in this file, in `docs/`, and in
the git history.

---

## How to use this file

1. Fill in **Owner decisions** below once (edit this file and commit). Session 1 copies them into
   the tracker.
2. Run the sessions **in order**, one per new chat. Copy the text inside the session's code block
   and paste it as the first message.
3. When a session ends, read its handoff report. Start the next session only when the report says
   the session's tasks are Done or Blocked with a documented reason.
4. If a session runs out of context or stops mid-way, open a new chat and paste the
   **Resume prompt** (end of this file). It continues from the tracker.
5. All sessions work on one branch, `release/production-readiness`, with one commit per task.
   Nothing is pushed or merged to `main` unless you ask.

| # | Session | Tasks | Tracker phase |
|---|---|---|---|
| 1 | Foundation and project structure | Structure, KZ-30, KZ-37, KZ-38 | Setup |
| 2 | Shared contracts: money and validation | KZ-04, KZ-16, KZ-25 | P0 / P1 / P2 |
| 3 | Connectivity, errors and language | KZ-01, KZ-12, KZ-22, KZ-24 | P0 / P1 / P2 |
| 4 | Authentication hardening | KZ-05, KZ-29, KZ-21, KZ-20 | P0 / P2 |
| 5 | Password reset | KZ-06 | P0 |
| 6 | Abuse protection and dependencies | KZ-19, KZ-08, KZ-27 | P0 / P1 / P2 |
| 7 | Transactions, history and idempotency | KZ-07, KZ-11, KZ-10, KZ-28 | P0 / P1 / P2 |
| 8 | Push notifications and Firebase | KZ-02, KZ-03 | P0 |
| 9 | Release build and configuration | KZ-09, KZ-33 | P0 / P2 |
| 10 | Sessions and app start | KZ-13, KZ-17 | P1 |
| 11 | Items, images and stock | KZ-14, KZ-15, KZ-23 | P1 / P2 |
| 12 | Server performance, observability, backups, admin | KZ-32, KZ-34, KZ-35, KZ-26, KZ-18 | P1 / P2 |
| 13 | App performance and read cache | KZ-31, decision D7 | P2 |
| 14 | Documentation | KZ-36 | P3 |
| 15 | Release-readiness audit | Milestones M1–M5 | Final |

All 38 tracker tasks are covered. Sessions follow dependency order (shared contracts and error
codes first, because later tasks build on them). Every P0 blocker is cleared by the end of session 9.

---

## Owner decisions

Edit the values, then commit. `PENDING` means the agent builds everything that doesn't depend on
the answer and marks the remainder Blocked.

```
D1  Password-uniqueness rule:       REMOVE it; block common/breached passwords instead
D2  Reset-code delivery:            EMAIL first (address already on every account);
                                    SMS later (needs phone numbers collected and verified first)
    Email provider:                 PENDING  (examples: Brevo, Postmark, Amazon SES)
D3  Production API domain/hosting:  PENDING
D4  Session model:                  15-min access token + rotating refresh token (sessions table)
D5  Overselling stock:              ALLOW; stock may go negative, shown in red, warning in history
D6  Push triggers (v1):             Low-stock alert only
D7  Offline read cache:             YES — last results for Home, Products, History page 1
```

---

## Standing rules (every session reads and follows these)

**Role.** You are a senior software engineer on Kazi, a trilingual small-business notebook for
Cameroon: a React Native 0.87 app (repository root) and a Node/Express/better-sqlite3 API
(`server/`). Work like a careful senior engineer: understand before changing, keep changes scoped,
prove every claim with a command's output, and leave the codebase and docs better than you found
them.

**Sources of truth.**
- `docs/PROJECT_TRACKER.md` — task status, decisions, milestones, update log.
- `docs/REMEDIATION_PLAN.md` — the spec and acceptance criteria for each task.
- `docs/ARCHITECTURE.md`, `docs/SECURITY.md`, `docs/PERFORMANCE.md`, `docs/TESTING_QA.md`,
  `docs/DEPLOYMENT.md` — rules every change must follow.
- If code and docs disagree, the code is the fact; fix the doc in the same change and log it.

**Start of every session.**
1. `git status` and `git log --oneline -15`. You must be on `release/production-readiness` with a
   clean tree (session 1 creates the branch). If the tree is dirty with work you didn't make, stop
   and report.
2. Read the tracker. Confirm the previous session's tasks are ✅ Done or 🟨 Blocked. If any are
   🟦 In progress, finish them first (that is a resumed session).
3. Run the baseline checks and keep the output: app `npx tsc --noEmit && npm run lint && npm test`;
   server `cd server && npm run typecheck && npm test`. If something already fails, record it
   before changing code so you never mistake an old failure for a new one.

**Per-task loop.**
1. Tracker: set the task to 🟦 In progress.
2. Read the task's spec, the code it touches, and the tests around that code.
3. If the spec is wrong or incomplete, correct the spec first and say why in the update log.
4. Implement. Match the existing style, naming and comment density. Smallest change that fully
   meets the acceptance criteria.
5. Add the tests listed for the task in `docs/TESTING_QA.md` ("Tests required per task"). Each new
   test must fail without the fix — check this at least once per task.
6. Verify (paste real output into your notes):
   - App: `npx tsc --noEmit`, `npm run lint`, `npm test`
   - Server: `cd server && npm run typecheck && npm test && npm run build`
   - After session 1: `npm run check` at the root runs everything.
7. Check the PR checklists in `docs/SECURITY.md` §8 and `docs/PERFORMANCE.md` §7.
8. Every user-facing string exists in `en`, `fr` and Pidgin; the parity test passes.
9. Docs, in the same commit: tick the acceptance boxes in REMEDIATION_PLAN.md; set the task ✅ Done
   in the tracker; update phase counts and the overall % line; add an update-log row (date, task,
   change, verification command + result, commit hash — amend the row with the hash after
   committing, or reference "this commit"); update any other doc whose area changed.
10. Commit: `KZ-xx: <imperative summary>`. One commit per task (a structural setup step may get
    its own commit with a `chore:` prefix).

**Definition of Done** is in `docs/TESTING_QA.md`. Never mark Done if a check failed, was skipped
or was assumed.

**Engineering non-negotiables.**
- Security (`docs/SECURITY.md` §5): every user-data query scoped by `user_id`; zod on every input;
  no secrets, tokens, codes, emails, names or amounts in logs; no `http://` in release paths; no
  synchronous crypto or file I/O in request handlers.
- Money is whole FCFA end to end (after session 2). Business dates come from the phone (`asOf`).
- Keep the idempotency ledger, activity-log consistency, cross-user isolation and the admin
  dashboard's read-only mode intact.
- Database changes only through numbered migrations (framework from session 1); every migration is
  tested on a fresh DB and on a legacy-schema DB, runs in a transaction, and finishes with
  `PRAGMA foreign_key_check` clean.
- Stay within the budgets in `docs/PERFORMANCE.md`; `EXPLAIN QUERY PLAN` for new/changed queries.
- Existing tests keep passing. Change a test only for an intended, documented behaviour change.
- The app and API ship together and there are no production users yet, so API contracts may
  change — but change both sides in the same commit.

**Git.** Stay on `release/production-readiness`. Do not push, open PRs, force-push, rebase shared
history or touch `main`. Before deleting or overwriting a file you didn't create, read it.

**Things outside the repository** (real Firebase projects, `GoogleService-Info.plist`, APNs key,
release keystore, email/SMS provider credentials, production domain, macOS/Xcode, physical
devices): do every part that doesn't need them, guard the code so a missing resource never crashes
anything, document the exact human steps in `docs/DEPLOYMENT.md`, mark the remainder 🟨 Blocked
with what's missing, and continue. Never invent credentials, keys, device results or measurements.

**Decisions.** Use the Owner decisions recorded in the tracker. If you hit a new decision that
touches security, money data or deletion of user data and no safe default exists, add it to the
tracker's Decisions table, mark the task Blocked, and move on.

**Context discipline.** If your context is getting long, finish the current task completely (or
revert its partial changes), update the tracker, and end with the handoff report. Never leave a
half-done task uncommitted.

**Handoff report** (end of every session, in chat):
1. Tasks completed, with commit hashes.
2. Tasks blocked: what is missing and who must provide it.
3. Checks before vs after (test counts, typecheck, lint, audit).
4. Deviations from the plan and why.
5. Risks or follow-ups the next session should know about.

---

## Session 1 — Foundation and project structure

```text
New session. Before anything else, read docs/prompt.md — "Standing rules" and "Owner decisions" — and follow the standing rules for this whole session. Then read every file in docs/.

Goal: set up the project structure and tooling that every later session depends on. Behaviour of the app and API must not change in this session.

1. Branch. From an up-to-date main, create release/production-readiness. The working tree currently has an uncommitted package-lock.json change that only adds "peer": true flags; commit it as "chore: refresh lockfile metadata" first.

2. Decisions. Copy the Owner decisions from docs/prompt.md into the tracker's Decisions table, dated today. Add an "Execution plan" section to the tracker that lists the 15 sessions from docs/prompt.md and their task IDs, and link docs/prompt.md from the tracker header.

3. Shared contracts package. Create shared/ at the repo root as an internal package "@kazi/shared":
   - Pure TypeScript, zero runtime dependencies, no Node or React Native APIs, so both sides can import it.
   - Built with tsc to shared/dist (ES modules + .d.ts); package.json "exports" points to dist; a "prepare" script builds it so npm install leaves it ready.
   - Consumed by the app ("@kazi/shared": "file:./shared") and the server ("file:../shared").
   - Metro: add shared/ to watchFolders and make sure the symlink resolves. Jest: make sure @kazi/shared resolves and is transformed if needed. Server: NodeNext resolution works for build, tsx and node --test.
   - Seed it with one trivial exported constant plus a unit test, and prove the import works from an app test, a server test, a Metro bundle (npx react-native bundle --platform android --dev false --entry-file index.js --bundle-output to a temp file) and the server build.
   - If the tooling fights this design, pick the simplest alternative that keeps a single source of truth (for example a path-mapped source folder), and record the choice as an ADR row in docs/ARCHITECTURE.md §9.

4. Migration framework. Move server/src/db.ts into server/src/db/ (index.ts keeps the same exported API: openDatabase, resolveDatabasePath) with numbered migrations in server/src/db/migrations/:
   - Table schema_migrations(version INTEGER PRIMARY KEY, name TEXT, applied_at TEXT).
   - 0001_baseline reproduces today's full schema, including every addColumnIfMissing column, the activity event_date backfill and the transactions 'capital' rebuild, so an existing database upgrades and a fresh one is identical. Detect an existing pre-framework database and baseline it without data loss.
   - Each migration runs in its own transaction; finish with PRAGMA foreign_key_check.
   - Tests: fresh DB; a DB built with the old pre-capital transactions schema; opening the same DB twice is a no-op; resulting schema (sqlite_master) is identical for fresh and upgraded DBs.
   - Fold in KZ-26 only if it falls out naturally (recreate idx_transactions_user_type_date); otherwise leave KZ-26 for session 12.

5. Root scripts. Root package.json: "typecheck", and "check" = app typecheck + lint + tests, then server typecheck + tests + build. server/package.json: "check". The server test script currently lists test files one by one; switch to a glob so new test files are never silently skipped (verify the count stays at 103 or more).

6. KZ-30 flaky tests, per the spec and docs/TESTING_QA.md §3. Prove it: clear the Jest cache and run the full suite cold 3 times; all green.

7. KZ-37 hygiene. Copy zulu-chronicle/ to ../kazi-archive/zulu-chronicle/ and confirm the copy, then remove it from the repo. Remove the unused @react-native/new-app-screen dependency. Remove offline types and fields that nothing uses (check each with grep and tsc before removing; LocalActivity and syncStatus are still used by History — keep what is used). Remove the now-unused translation keys from all three locales only if nothing references them.

8. KZ-38 CI. Add .github/workflows/ci.yml with the app, server and audit jobs from docs/TESTING_QA.md "CI pipeline". The audit job must run but may be non-blocking until session 6 (comment why). Add android-release and ios-build jobs as workflow_dispatch-only placeholders that session 9 completes.

9. Docs. Update docs/ARCHITECTURE.md §3 (layout: shared/, server/src/db/migrations, .github/) and §6 (migration framework), docs/TESTING_QA.md §1 (new commands, CI), README "Tests & checks".

Done when: npm run check passes from a clean npm ci in root, shared/ and server/; three cold Jest runs pass; the tracker shows KZ-30, KZ-37, KZ-38 Done and the execution plan is recorded. End with the handoff report.
```

---

## Session 2 — Shared contracts: money and validation

```text
New session. Read docs/prompt.md "Standing rules" and follow them for the whole session. Then read docs/PROJECT_TRACKER.md, docs/REMEDIATION_PLAN.md (KZ-04, KZ-16, KZ-25), docs/ARCHITECTURE.md §7.2 and §7.4, and the shared/ package created in session 1.

Goal: make money and validation rules a single shared contract so the app and API can never disagree, and fix the bug where "1,000" is saved as 1 FCFA.

KZ-04 — money input.
- In shared/: parseMoneyInput(text): number | null and formatMoney(amount): string ("1 000 FCFA", using a regular space or narrow no-break space consistently — pick one and test it), plus MONEY_MAX.
- Parser rules from the spec: whole numbers only; spaces and no-break spaces removed; "," or "." accepted only as thousands separators in groups of exactly three; everything else rejected (decimals, exponents, hex, signs, empty, mixed separators like "1,000.000"). Write the table-driven tests first, including every example in the spec, then implement.
- Replace parseAmount, parsePrice, and the debt form's parsing with the shared parser in every form (sale, expense, capital, debt, product). Show the parsed value under the amount field as the user types.
- Server: moneyAmountSchema and item price accept only integers (JSON integer, or a string of digits). Keep strictNumber's protections.

KZ-25 — integer storage and one formatter.
- Migration: rebuild transactions, debts, items and activity so amount/price columns are INTEGER with CHECKs (amount > 0 where it already applies; price >= 0). SQLite can't change a column type in place: create new table, copy with ROUND(), drop, rename, recreate every index and the foreign keys, then PRAGMA foreign_key_check. Count rows that had a fractional part and log the count (not the values).
- Test the migration on a DB containing fractional values and on a fresh DB.
- Delete src/items/format.ts and src/money/format.ts in favour of the shared formatter; prices and money render identically everywhere, including the admin dashboard's JS if it formats money.

KZ-16 — validation parity.
- Move every limit both sides enforce into shared/ (name lengths, company name, business type 60, email 254, password 8 min / 72 bytes max, notes 500, description 200, debt note 200, quantity max, threshold max, money max, business-date window 2000-01-01 to +365 days, page sizes).
- Server zod schemas and app validators both import from shared/. Password max is measured in UTF-8 bytes on both sides (bcrypt's limit); add a test with multi-byte characters.
- The date picker's min and max come from the shared date window.
- Because both sides now import one source, replace the "parity test" in the spec with a test that fails if a validator stops using the shared constant (for example, a boundary test per limit on each side). Update the KZ-16 spec text accordingly.

Out of scope: error-message translation (session 3). Validation errors may still show English server text for now.

Done when: all three tasks meet their acceptance criteria, npm run check passes, and a manual sanity run of the money parser examples is included in the update log. End with the handoff report.
```

---

## Session 3 — Connectivity, errors and language

```text
New session. Read docs/prompt.md "Standing rules" and follow them. Then read the tracker, docs/REMEDIATION_PLAN.md (KZ-01, KZ-12, KZ-22, KZ-24), docs/ARCHITECTURE.md §4.2, §5.4, §7.3, and src/api/client.ts, src/offline/, src/auth/errorMessage.ts, src/i18n/.

Goal: the app knows correctly when it is offline, and every message a user sees is in their language.

KZ-01 — connectivity.
- Add @react-native-community/netinfo (check the version supports RN 0.87 and the New Architecture). Configure its reachability check over HTTPS. Keep the public interface of src/offline/connectivity.ts (isOnline, subscribeConnectivity, probeConnectivity) so callers don't change. Remove the 30-second polling timer.
- Add a NetInfo mock in jest.setup.js. Tests per docs/TESTING_QA.md.
- grep for "http://" in src/: only the dev-host code in src/config/env.ts may remain.

KZ-12 — errors by code.
- Put the canonical list of API error codes in shared/ (as a const array + union type). server/src/errors.ts uses that type, so the compiler rejects an unknown code.
- Validation errors from the server carry { code: 'VALIDATION_ERROR', field, rule } derived from the first zod issue. Keep message for logs.
- App: one module, src/errors/messages.ts, maps an ApiError/NetworkError to translated text (by code; for VALIDATION_ERROR by field + rule). Every screen uses it. Replace apiErrorMessage. Unknown codes fall back to a translated generic message — never to server text.
- Tests: every shared error code has a key in all three locales; grep src/screens for err.message returns nothing.

KZ-22 — visible reasons.
- Forms show a field's error once the field has been touched (on blur) or after a Save attempt, so a disabled Save button always has a visible reason. Apply to every form. In AddMoneyScreen, errors pass through t(). Add a test that no raw translation key (a string matching /^[a-z]+(\.[a-zA-Z]+)+$/) can render as an error.

KZ-24 — language.
- Rename the Pidgin language code from "pid" (ISO 639-3 for Piaroa) to "wes" (ISO 639-3 for Cameroonian Pidgin). Migrate a stored "pid" preference to "wes" on load.
- Separate the i18n language code from the date/number formatting locale: en → en-CM, fr → fr-CM, wes → en-CM. Use the formatting locale everywhere toLocaleDateString / Intl is used (date picker, history day labels).
- Server: PATCH /auth/me/language (enum en|fr|wes, validated, user-scoped). The app calls it when the language changes (best-effort, never blocks the UI), and after login uses the server value if the device has no stored choice. Migration: update any existing users.language = 'pid' to 'wes'.
- Update docs/ARCHITECTURE.md §7.3 (it currently suggests a private-use tag; record the decision for "wes").

Done when: acceptance criteria met for all four tasks, npm run check passes, and switching language on a running app changes every visible error and date. End with the handoff report.
```

---

## Session 4 — Authentication hardening

```text
New session. Read docs/prompt.md "Standing rules" and follow them. Then read the tracker (check decision D1), docs/REMEDIATION_PLAN.md (KZ-05, KZ-29, KZ-21, KZ-20), docs/SECURITY.md §5.1 and §5.6, and server/src/auth/, server/src/index.ts, src/auth/, src/screens/auth/, src/screens/more/DeleteAccountScreen.tsx.

Goal: close the account-security gaps that don't depend on sessions or password reset.

KZ-05 — remove the password-uniqueness oracle (decision D1).
- Migration: drop password_fingerprints. Remove every read and write of it, hashPasswordFingerprint, and the PASSWORD_NOT_ALLOWED path.
- Add a common-password denylist on the server: a list file of at least 10 000 entries from a permissively licensed source (for example SecLists, MIT) if you can download it; record source and licence in a header comment. If you cannot download, ship a smaller curated list plus pattern checks (sequences, keyboard walks, repeated characters) and log a follow-up in the tracker. Load it once at startup into a Set; compare case-insensitively. Also reject passwords containing the user's email local part or first/last name (case-insensitive, length ≥ 4).
- New error code PASSWORD_TOO_COMMON (add to shared/ codes and all locales). Mirror a lightweight version of the check in the app (pattern checks + a small top-1000 list) so users get instant feedback; the server remains the authority.
- Update README and in-app copy that advertised the old rule.

KZ-29 — refuse weak JWT_SECRET in production (fewer than 32 bytes, or equal to the .env.example value), with a clear boot message. Test it.

KZ-21 — timing and blocking.
- Use bcryptjs async hash/compare everywhere. When the email is unknown, compare against a fixed dummy hash generated once at startup at the same cost.
- Measure: 100 logins each for a known and an unknown email against a local server; record p50 for both in the update log (difference under 20 ms). Measure event-loop delay with monitorEventLoopDelay during a burst of 20 parallel logins; record p99.

KZ-20 — password to delete the account.
- DELETE /auth/me requires { password }; wrong password → 401 INVALID_CREDENTIALS and nothing deleted; rate-limit it like login. The DeleteAccount screen asks for the password inside the confirm step.

Done when: all four tasks meet their acceptance criteria, the old PASSWORD_NOT_ALLOWED tests are replaced by tests for the new behaviour, and npm run check passes. End with the handoff report.
```

---

## Session 5 — Password reset

```text
New session. Read docs/prompt.md "Standing rules" and follow them. Then read the tracker (decision D2), docs/REMEDIATION_PLAN.md (KZ-06), docs/SECURITY.md §5.1, docs/ARCHITECTURE.md §5.3, and server/src/auth/, src/screens/auth/ForgotPasswordScreen.tsx, ResetPasswordScreen.tsx, src/navigation/RootNavigator.tsx.

Goal: a password reset that is secure by default in every environment and actually works in production.

Design (implement exactly, or update the spec first if you find a flaw):
- Request: POST /auth/forgot-password { email }. Always returns 202 with the same body ("If an account exists, we've sent a code"), whether or not the account exists. Do the lookup, code creation and sending off the response path (setImmediate) so timing doesn't reveal existence. Keep the existing rate limit and add a per-email limit (3 codes per hour).
- Code: 6 digits from crypto.randomInt. Store HMAC-SHA256(code) keyed with a key derived from JWT_SECRET via HKDF (info "kazi-reset-code"), plus user_id, expires_at (15 minutes), attempts (0). Issuing a new code invalidates older unused codes for that user. Migration for the new columns.
- Verify: POST /auth/reset-password { email, code, password }. Look up the newest active code for that email's user; compare in constant time; on mismatch increment attempts; at 5 attempts the code is dead. On success: new password (passes the KZ-05 checks), bump token_version, mark code used, delete the user's other codes. Same error for "no such email" and "wrong code".
- Delivery: interface ResetCodeSender { send(to, code, language) }. Implementations: ConsoleSender (development/test only — prints the code to the server console) and EmailSender (provider from decision D2, configured through env vars; HTTPS API call with a 5-second timeout; message templates in en/fr/wes). The server chooses the sender from config at boot and refuses to start in production without a real sender configured. If the provider is still PENDING, build EmailSender against a small provider-agnostic HTTP adapter with documented env vars, test it with a mocked HTTP client, and mark only the "end-to-end on staging" criterion Blocked.
- Fail-closed dev shortcut: the code is returned in the HTTP response only when ALLOW_DEV_RESET_CODE=1 and NODE_ENV is development or test. Boot fails if ALLOW_DEV_RESET_CODE=1 with NODE_ENV=production. Remove the old "!== 'production'" logic entirely.
- App: ForgotPassword asks only for email, then navigates to a "Enter code + new password" screen (no code in route params). Show the uniform message. Handle TOO_MANY_REQUESTS and expired/dead codes with translated messages. In dev builds with the shortcut enabled, prefill the code from the response.
- Names are no longer part of the reset flow; remove the first/last name matching and its tests, replacing them with tests for the new flow.
- Document env vars in server/.env.example and docs/DEPLOYMENT.md §3; update docs/ARCHITECTURE.md §5.3 and docs/SECURITY.md.

Tests: every acceptance criterion in the spec, plus: issuing a second code kills the first; codes expire at 15 minutes (fake clock); response bodies and status are identical for known and unknown emails; no code or email appears in logs.

Done when: KZ-06 meets every criterion except, if the provider is PENDING, the staging end-to-end check, which is marked Blocked with exact setup steps. npm run check passes. End with the handoff report.
```

---

## Session 6 — Abuse protection and dependencies

```text
New session. Read docs/prompt.md "Standing rules" and follow them. Then read the tracker, docs/REMEDIATION_PLAN.md (KZ-19, KZ-08, KZ-27), docs/SECURITY.md §5.4, §5.9, §6, docs/DEPLOYMENT.md §2, and server/src/middleware/, server/src/app.ts, server/src/auth/routes.ts, server/src/admin/index.ts.

Goal: patch vulnerable dependencies, then make rate limiting correct behind a proxy and bounded in memory.

KZ-19 first (KZ-08 turns on trust proxy, which makes the proxy-addr advisory relevant).
- Run npm audit --omit=dev in root and server/. Apply npm audit fix (never --force without reading what it changes). Upgrade express to the latest 4.x. Re-run all checks.
- For anything still high/critical: if it is build tooling only, document it in docs/SECURITY.md §6 with reason, exposure and review date; otherwise find a fixed version or an alternative.
- Make the CI audit job blocking at --audit-level=high.

KZ-08 — rate limiting.
- app.set('trust proxy', ...) from TRUST_PROXY: unset → false; a number → hop count; anything else → refuse to boot with a clear message. Never true.
- Rewrite the limiter as a small reusable module: fixed-window buckets keyed by a caller-supplied key function, expired buckets swept every minute by an unref'd interval, hard cap on map size (evict oldest), Retry-After header on 429. Unit-test it with a fake clock.
- Apply: signup/forgot/reset per IP (existing limits); login per IP (25/15 min) plus per normalized email on failures only (10/15 min, reset on success); delete-account like login; authenticated write routes per user (120/min); /notifications/send stays limited.
- Tests: separate buckets for different X-Forwarded-For values when TRUST_PROXY=1; header ignored when unset; per-email lockout works across IPs; map size stays bounded when hammered with 100 000 distinct keys.
- Document TRUST_PROXY in server/.env.example and docs/DEPLOYMENT.md §3.

KZ-27 — admin cookie parsing: ignore cookies that fail decodeURIComponent; test that a malformed cookie returns 401, not 500.

Done when: server and app audits are clean at high/critical or each exception is documented; all three tasks meet their acceptance criteria; npm run check passes. End with the handoff report.
```

---

## Session 7 — Transactions, history and idempotency

```text
New session. Read docs/prompt.md "Standing rules" and follow them. Then read the tracker (decision D5), docs/REMEDIATION_PLAN.md (KZ-07, KZ-11, KZ-10, KZ-28), docs/ARCHITECTURE.md §5.5, §5.6, §7.1, §8.1, and server/src/{activity,transactions,summary,debts}/, server/src/idempotency.ts, src/screens/history/, src/screens/home/HomeScreen.tsx, src/screens/debts/.

Goal: users can correct mistakes, retries never duplicate data, and "today" means the owner's today everywhere.

KZ-07 — delete (and correct) transactions.
- GET /activity returns refType and refId per event.
- History: tapping a sale, expense or capital row opens a detail sheet (amount, date, item, quantity, description) with Delete (confirm dialog, translated) and "Correct" (deletes after the user saves a prefilled new form — save first, then delete, so a failed save never loses the original; use the same clientOpId rules as KZ-11). Debt rows open the debt actions. Product rows do nothing new.
- With decision D5 (negative stock allowed), deleting a purchase must reverse the full quantity even if stock goes negative; remove the clamp in deleteTransaction and update its test. Coordinate with session 11, which implements the rest of D5.
- After a delete, History and Home reflect it (refetch on focus is fine).

KZ-11 — idempotent writes.
- shared/: newClientOpId() — timestamp base36 + random base36 + a module counter, at least 20 characters. It is an idempotency key, not a secret; document that.
- A small hook (useSubmission) holds one clientOpId per form submission: created on first Save tap, reused for retries of that same submission, replaced after success or when any field changes. Use it for item create, stock in/out, transaction create, debt create, debt pay.
- Tests: the same id is sent on retry; a different id after editing; server replay returns 200 with the identical body for every idempotent route (extend server/src/sync.test.ts).

KZ-10 — today's totals.
- /summary accepts asOf (businessDateSchema) and returns lowStockCount (tracked items at or under threshold, threshold > 0). Compute everything in one aggregate query (this also covers that part of KZ-32; note it in the log).
- Home sends asOf, stops calling /items, uses lowStockCount. Include capital in "has any activity".

KZ-28 — "Older" range: with only From, end at the day before this week starts; with only To, cap at that day; From after To is a translated validation error shown inline, not an error screen.

Done when: acceptance criteria met for all four tasks, a manual run (server + app in an emulator, if available) of "record a sale, delete it, stock and totals restored" is noted in the log, and npm run check passes. End with the handoff report.
```

---

## Session 8 — Push notifications and Firebase

```text
New session. Read docs/prompt.md "Standing rules" and follow them. Then read the tracker (decision D6), docs/REMEDIATION_PLAN.md (KZ-02, KZ-03), docs/DEPLOYMENT.md §6, and index.js, src/notifications/service.ts, ios/Kazi/AppDelegate.swift, ios/Podfile, ios/Kazi/Info.plist, android/app/google-services.json, server/src/notifications/, server/src/items/service.ts, server/src/transactions/service.ts.

Goal: push works end to end on Android and iOS once real Firebase credentials are dropped in, and a misconfigured Firebase can never stop the app from starting.

KZ-02 — iOS (you cannot build iOS on this machine; write the changes carefully and mark device verification Blocked).
- Follow the React Native Firebase iOS setup for the exact version in node_modules (read its docs/README there): Podfile settings it requires for the New Architecture, FirebaseApp.configure() in AppDelegate guarded so it only runs when GoogleService-Info.plist is in the bundle, Push Notifications and Background Modes (remote-notification) entitlements, UIBackgroundModes in Info.plist.
- JS: wrap setupBackgroundHandler and every getMessaging() use in a guard (try/catch plus an "is Firebase available" check) so failure disables push silently and logs once in development.
- Remove the empty NSLocationWhenInUseUsageDescription key from Info.plist.
- Add a test that index.js setup survives a throwing getMessaging().

KZ-03 — push pipeline.
- Android: keep the placeholder google-services.json but make the app treat a placeholder project id as "push disabled" (no token requests, no errors). Document exactly how to drop in the real files per environment in docs/DEPLOYMENT.md.
- Server, decision D6 (low-stock alert): in the stock-changing paths (sale, stock-out, purchase-delete reversal), detect the crossing (before > threshold and after <= threshold, threshold > 0, item tracked). After the database transaction commits, enqueue the push (setImmediate), with a 5-second timeout, never awaited by the request, never failing the write. Message text localized using users.language (en/fr/wes). Deduplicate: at most one alert per item per 12 hours (store last_low_stock_alert_at on items via a migration).
- Restrict POST /notifications/send: disabled unless NOTIFICATIONS_TEST_SEND=1 and NODE_ENV is not production. Document it.
- Tests: alert sent exactly once on crossing; not sent when already below; not sent twice within 12 hours; push failure or timeout does not affect the sale's response or data; existing dead-token cleanup still works.

Done when: all code and tests are in; KZ-02 device check and KZ-03 real-delivery check are marked Blocked with precise steps (create Firebase projects, add apps com.kazi.app, download config files, upload APNs key, set FIREBASE_SERVICE_ACCOUNT); npm run check passes. End with the handoff report.
```

---

## Session 9 — Release build and configuration

```text
New session. Read docs/prompt.md "Standing rules" and follow them. Then read the tracker (decision D3), docs/REMEDIATION_PLAN.md (KZ-09, KZ-33), docs/DEPLOYMENT.md §3, §6, "Secrets", docs/PERFORMANCE.md budgets, and src/config/env.ts, android/app/build.gradle, android/gradle.properties, android/app/proguard-rules.pro, .gitignore, .github/workflows/ci.yml.

Goal: release builds are signed properly, point at an https production API, and are as small and fast as practical.

KZ-09 — signing and API URL.
- Signing: read the upload keystore path, alias and passwords from Gradle properties (KAZI_UPLOAD_STORE_FILE, KAZI_UPLOAD_STORE_PASSWORD, KAZI_UPLOAD_KEY_ALIAS, KAZI_UPLOAD_KEY_PASSWORD) supplied by ~/.gradle/gradle.properties or CI env. If they are missing, a release build fails with a clear message — unless -PkaziAllowDebugSigning=true is passed for local testing, which logs a loud warning. Never commit keys; check .gitignore.
- API URL: production URL comes from build configuration, not source. Preferred approach: a generated module (src/config/build.generated.ts) written by a small Node script from KAZI_API_URL, run automatically before release bundling on Android (Gradle task wired before the JS bundle task) and iOS (Xcode build phase); the committed version holds the dev default. The script and the Gradle task fail a release build if the URL is missing or not https://. If you find a cleaner mechanism that keeps the same guarantees, use it and record an ADR.
- Remove the hard-coded PROD_API_URL. Keep the dev auto-detection but move the fallback LAN IP into an optional untracked local config, defaulting to 10.0.2.2 for the Android emulator.
- CI: complete the android-release job (secrets for keystore and KAZI_API_URL; uses bundleRelease); keep it manual until the secrets exist.

KZ-33 — release optimization.
- Enable R8 (enableProguardInReleaseBuilds = true) and shrinkResources. Add keep rules only where needed (check each library's consumer rules first: React Native Firebase, Notifee, Keychain, NetInfo, SVG, image picker, screens).
- Build an AAB. If the Android SDK is available here, build a release APK with -PkaziAllowDebugSigning=true, install it on an emulator, and walk the smoke path: launch, sign up, record a sale, view history, change language, log out. Record results. If no SDK or emulator is available, mark the runtime check Blocked.
- Record the AAB size and (if measurable) the per-ABI download size in the tracker log.

Done when: release builds can't be produced with a debug key (without the explicit flag) or an http/missing API URL; R8 build runs the smoke path cleanly or the runtime check is Blocked with steps; npm run check passes. End with the handoff report.
```

---

## Session 10 — Sessions and app start

```text
New session. Read docs/prompt.md "Standing rules" and follow them. Then read the tracker (decision D4), docs/REMEDIATION_PLAN.md (KZ-13, KZ-17), docs/ARCHITECTURE.md §5.3, §8.2, docs/SECURITY.md §5.1, and server/src/auth/, server/src/middleware/auth.ts, src/auth/, src/api/client.ts, src/storage/secure.storage.ts, src/navigation/RootNavigator.tsx.

Goal: real sessions — short-lived access, revocable refresh, working logout — and an app start that never shows the wrong screen.

KZ-13 — server.
- Migration: sessions(id TEXT PK, user_id FK cascade, family_id, refresh_hash, device_label, created_at, last_used_at, expires_at, revoked_at).
- Access token: HS256 JWT, 15 minutes, claims sub, ver, sid. requireAuth verifies the JWT, then in one query checks the user exists, ver matches token_version, and the session is not revoked or expired.
- Refresh token: 32 random bytes base64url, stored as SHA-256, 60-day expiry. POST /auth/refresh rotates it (new row in the same family, old row revoked). Presenting an already-rotated token revokes the whole family (reuse detection).
- Signup and login return { accessToken, refreshToken, user }. POST /auth/logout revokes the current session. POST /auth/logout-all { password } revokes every session of the user. Password reset and account deletion revoke all sessions.
- Rate-limit /auth/refresh per IP. Prune expired sessions daily.
- Tests: rotation, reuse detection, logout, logout-all, expiry, reset revokes, isolation.

KZ-13 — app.
- Store { accessToken, refreshToken } as one JSON value in the Keychain.
- apiRequest: on 401 TOKEN_EXPIRED, refresh once through a single-flight lock (parallel requests wait for the same refresh), then retry the original request once. If refresh fails, call logOut() and show the login screen with a translated "Your session ended" message. No error toasts for that case.
- More: "Log out other devices" (asks for the password).

KZ-17 — app start.
- Add an 'offline-unknown' auth status: token present, /auth/me failed for a non-401 reason, and no cached profile. Show a "Can't reach Kazi — Retry" screen. Enter the app only with a known profile.

Done when: every acceptance criterion for both tasks is met, there are tests for the single-flight refresh, and npm run check passes. End with the handoff report.
```

---

## Session 11 — Items, images and stock

```text
New session. Read docs/prompt.md "Standing rules" and follow them. Then read the tracker (decision D5), docs/REMEDIATION_PLAN.md (KZ-14, KZ-15, KZ-23), docs/PERFORMANCE.md §2–3, docs/SECURITY.md §5.3, and server/src/items/, server/src/transactions/service.ts, server/src/app.ts, src/items/, src/screens/products/, src/screens/history/ItemPickerDialog.tsx.

Goal: product lists stay small and fast, photos work from every phone and are safe to store, and stock rules match how small shops actually trade.

KZ-14 — images out of the list.
- Migration: item_images(item_id PK FK cascade, user_id, mime, bytes BLOB, size, version, updated_at). Move existing items.image data into it (decode base64, validate per KZ-15, skip and count invalid rows), then rebuild items without the image column.
- Item JSON carries imageVersion (null when none) instead of image.
- PUT /items/:id/image (JSON { data: base64 }, route-specific body limit about 1.5 MB) and DELETE /items/:id/image. GET /items/:id/image streams the bytes with the stored Content-Type, ETag = version, Cache-Control: private, max-age=31536000, immutable, and returns 304 on If-None-Match. All user-scoped.
- Lower the global express.json limit to 256 kB.
- App: product create/edit uploads the photo after saving the item (show a retry action if the upload fails — the item itself is saved). Image components use { uri: <api>/items/<id>/image?v=<version>, headers: { Authorization } }.
- Measure GET /items for 200 items with photos before and after and record both in the log.

KZ-15 — formats and content checks.
- App: assetRepresentationMode 'compatible' in the image picker so iOS returns JPEG; keep maxWidth/maxHeight 1024 and quality 0.6.
- Server: check magic bytes (JPEG, PNG, WebP only), decoded size ≤ 1 MB, declared type must match the detected one. Error text and the allowed list agree in all locales.

KZ-23 — stock rules (decision D5).
- A sale or stock-out may take stock below zero; the API no longer returns INSUFFICIENT_STOCK for sales (keep it only if a manual stock-out would go negative and the UI asked for a strict check — decide, document, test). Negative stock shows in red with a translated label; a warning activity entry is written when stock goes negative.
- Create-product form: optional "Opening stock" for tracked items, recorded as one stock-in movement with reason "Opening stock" in the same transaction.
- Item picker and lists use the lightweight item JSON.

Done when: acceptance criteria met for all three, the before/after payload measurement is logged, and npm run check passes. End with the handoff report.
```

---

## Session 12 — Server performance, observability, backups, admin

```text
New session. Read docs/prompt.md "Standing rules" and follow them. Then read the tracker, docs/REMEDIATION_PLAN.md (KZ-32, KZ-34, KZ-35, KZ-26, KZ-18), docs/PERFORMANCE.md (all), docs/DEPLOYMENT.md §4–5, docs/SECURITY.md §5.7, and server/src/ (db/, every service.ts, app.ts, index.ts, log.ts, admin/).

Goal: the API meets its performance budgets, can be observed safely, can be restored from backup, and the admin dashboard runs from a build.

KZ-32 — performance.
- PRAGMAs from docs/PERFORMANCE.md §2 at open. PRAGMA optimize daily (unref'd timer) and on shutdown. Graceful shutdown on SIGINT/SIGTERM: stop accepting, finish in-flight requests, close the DB.
- Prepare hot statements once per router/service instead of on every call (keep code readable — a small per-module cache is fine).
- EXPLAIN QUERY PLAN every query in every service.ts; add indexes through a migration where a hot path scans. Paste the plans for changed queries into the log.
- Add server/scripts/seed-perf.ts (one user with 10 000 transactions, 500 items, 300 debts, matching activity) and server/scripts/load.ts using autocannon (devDependency) for the endpoints in the budget table. Run it and record p50/p95 and sizes in the tracker log and docs/PERFORMANCE.md. Fix anything over budget.

KZ-34 — observability.
- One JSON log line per request: time, method, route pattern (not raw URL), status, duration_ms, user id, error code. No bodies, no query strings, no tokens, no emails. Slow-query log for queries over 50 ms (statement name only, no parameters).
- GET /ready checks the DB with a trivial query; /health stays a pure liveness probe.
- Snapshot test proving logs contain no secrets or personal data.

KZ-35 — backups.
- server/scripts/backup.ts: online backup via better-sqlite3 db.backup() to a timestamped file; retention 48 hourly / 30 daily / 12 monthly; optional encryption with age if AGE_RECIPIENT is set (documented); exits non-zero on failure.
- server/scripts/restore-drill.ts: restores the newest backup to a temp path, opens it with the migration framework, runs integrity_check and a few count queries, exits 0 on success. Test both against a temp DB.
- Document scheduling (systemd timer or cron) and off-site copy in docs/DEPLOYMENT.md §5.

KZ-26 — if session 1 didn't already, make sure idx_transactions_user_type_date exists on every upgraded DB (migration + test).

KZ-18 — admin: scripts admin:dev and admin; postbuild copies src/admin/public to dist/admin/public; npm run build && npm run admin serves the login page (verify with curl). Document in README and docs/DEPLOYMENT.md.

Done when: budgets met (or the gap explained with a follow-up task added to the tracker), all five tasks meet their acceptance criteria, and npm run check passes. End with the handoff report.
```

---

## Session 13 — App performance and read cache

```text
New session. Read docs/prompt.md "Standing rules" and follow them. Then read the tracker (decision D7), docs/REMEDIATION_PLAN.md (KZ-31), docs/PERFORMANCE.md §3–4, docs/ARCHITECTURE.md §4.4 and ADR A1, and src/screens/{products,history,debts,home}/, src/offline/api.ts, src/auth/AuthContext.tsx.

Goal: long lists stay smooth on a budget phone, and the main screens appear instantly from the last known data.

KZ-31 — virtualized lists.
- Products: FlatList. Debts: SectionList (open / paid). History: SectionList grouped by day, with onEndReached paging (keep the requestId stale-response guard), RefreshControl, stable keys, memoized row components, getItemLayout where row height is fixed, sensible initialNumToRender/windowSize.
- Keep every testID used by existing tests; update tests that relied on ScrollView structure.
- Seed 1 000 items/events (use the server seed script from session 12) and, if an emulator or device is available, record fps while scrolling; otherwise mark the measurement Blocked.

D7 — read cache (single source of truth stays the server).
- src/cache/: per-user, keyed by request (Home summary, Products list, History page 1 for the default period), stored in memory and AsyncStorage with a timestamp. Cleared on logout, on account deletion and on user switch. Never caches tokens or anything from auth endpoints.
- Screens render cached data immediately with a subtle "Updated <time>" line, then refresh in the background; after any successful write, invalidate the affected keys.
- When offline, cached screens stay readable and write actions show the translated offline message. Writes are never queued.
- Update docs/ARCHITECTURE.md §4.4 and ADR table (A12: read-only cache; A10/A11 were used in session 1), and docs/PERFORMANCE.md §4.

Done when: KZ-31 acceptance met (or fps measurement Blocked with steps), the cache has tests for per-user isolation, invalidation and logout clearing, and npm run check passes. End with the handoff report.
```

---

## Session 14 — Documentation

```text
New session. Read docs/prompt.md "Standing rules" and follow them. Then read the tracker, docs/REMEDIATION_PLAN.md (KZ-36), every file in docs/, README.md, SECURITY_ASSESSMENT.md, OFFLINE_FIRST_VERIFICATION.md, server/.env.example, and skim git log since the branch started.

Goal: every document tells the truth about the code as it is now.

- README: rewrite to match reality — features (including transaction delete/correct, opening stock, negative stock, read cache, sessions, password reset by email), repository layout (shared/, migrations, scripts), setup for app and server, every npm script (root, server, shared), environment variables (link docs/DEPLOYMENT.md), API overview generated from the actual routers (list every route; remove any that don't exist), testing commands, link to docs/.
- OFFLINE_FIRST_VERIFICATION.md: keep it as a historical record but correct the "what survives" note (connectivity is NetInfo-based now) and point to docs/ARCHITECTURE.md.
- SECURITY_ASSESSMENT.md: add a header note that it is dated and that the current posture lives in docs/SECURITY.md.
- Cross-check every doc in docs/ against the code: endpoints, env vars, file paths, commands, decisions, ADR statuses. Fix every mismatch. Verify every relative link resolves.
- Verify each command in README by running it (or explain in the log why it can't run here).

Done when: KZ-36 acceptance met, every README command was run or justified, links are valid, and npm run check passes. End with the handoff report.
```

---

## Session 15 — Release-readiness audit

```text
New session. Read docs/prompt.md "Standing rules" and follow them. Then read every file in docs/ completely.

Goal: prove, with evidence, how close Kazi is to production-complete, fix anything small that is still wrong, and hand the owner an exact list of what only a human can finish. Don't start large new work in this session; if you find a significant gap, add it to the tracker as a new task with a spec and report it.

1. Clean-room verification: fresh clone of the branch into a temp directory, npm ci in root, shared/ and server/, then npm run check, server build, admin build, and npm audit --omit=dev --audit-level=high on both. Paste results.
2. Tracker audit: every task is ✅ Done (all acceptance boxes ticked and backed by a test or a logged measurement) or 🟨 Blocked (with exact missing resource and steps). Reopen any task whose evidence is missing.
3. Security: walk docs/SECURITY.md "Release security gate" item by item. Then run a fresh adversarial pass against a local production-mode server (NODE_ENV=production, TRUST_PROXY=1, real-looking config) in the style of SECURITY_ASSESSMENT.md: auth bypass, cross-user access on every route, injection, mass assignment, idempotency abuse, rate-limit bypass via headers, reset-flow enumeration and brute force, session reuse, upload content spoofing, error leakage, log leakage. Write the results as docs/SECURITY_ASSESSMENT_<today>.md. Fix anything Low that is quick; add tasks for the rest.
4. Performance: re-run the seed + load scripts; compare with docs/PERFORMANCE.md budgets; record results.
5. Data integrity: on a seeded DB, check that /summary, /activity totals and the admin dashboard totals agree for the same user and period, and that every amount is an integer.
6. Milestones: tick M1–M5 in the tracker where the evidence supports it; for each unticked one, list what blocks it.
7. Go-live checklist (docs/DEPLOYMENT.md): mark each item done, blocked (owner action) or not applicable, with a one-line reason.

Final report (in chat and appended to the tracker as a "Release readiness — <date>" section):
- Overall status in one sentence.
- Evidence summary: checks, tests, audit, security pass, performance numbers.
- Remaining owner actions in the order they should happen (for example: choose email provider and set its keys; create Firebase projects and drop in config files; generate the upload keystore; register the domain and run the server setup in docs/DEPLOYMENT.md; build and test on a Mac and a physical iPhone; device QA script on three phones; store listings).
- Any new tasks added, with IDs.
```

---

## Resume prompt (use when a session stopped part-way)

```text
New session, resuming earlier work on Kazi. Read docs/prompt.md "Standing rules" and follow them.

1. Run git status and git log --oneline -20 on release/production-readiness. If there are uncommitted changes, inspect them: if they complete a task cleanly and checks pass, finish and commit that task properly; if they are partial or broken, tell me what they are and wait for my go-ahead before discarding anything.
2. Read docs/PROJECT_TRACKER.md (Execution plan and Update log) to find the session that was running and which of its tasks are not yet Done.
3. Open docs/prompt.md, find that session's prompt, and continue it from the first unfinished task, following its instructions exactly.
4. End with the standard handoff report, stating clearly which session you resumed and whether it is now complete.
```
