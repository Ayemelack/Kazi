# Kazi Security Assessment

**Target:** Kazi mobile app (React Native 0.87) and its backend API (`server/`, Node + TypeScript + Express + better-sqlite3)
**Type:** Authorized adversarial assessment (grey-box, source-assisted)
**Date:** 2026-09-17
**Method:** Recon -> attack -> classify -> patch confirmed issues -> re-attack -> regression test

---

## 1. Executive summary

The API is built with a strong authorization model: every resource route requires a
verified session token, every data access is scoped to the authenticated `user_id`, and
the JWT handling is hardened. Adversarial testing did not find any cross-tenant data
exposure, authentication bypass, SQL injection, or mass-assignment issue.

Three real defects were confirmed and fixed:

1. **High - Password reset code returned in the HTTP response in all environments.**
   Anyone who knew a victim's email and full name could reset the password. Now the code
   is only returned outside production.
2. **Medium - Idempotency ledger ignored the operation type.** Reusing a client operation
   id for a different action silently returned the first action's stored response and
   dropped the new operation. Now such reuse is rejected with `409 IDEMPOTENCY_CONFLICT`.
3. **Low - Malformed JSON returned `500` and logged the raw request body.** Now it returns
   `400 VALIDATION_ERROR` without logging the payload.

Several lower-risk items are documented as residual risk (account enumeration, upload
content-type spoofing, dependency advisories, deployment hardening). After the fixes the
server suite passes **86/86** and the mobile suite **96/96**.

---

## 2. Scope and environment

- **In scope:** All HTTP API routes (`/auth`, `/items`, `/transactions`, `/debts`,
  `/summary`, `/activity`, `/feedback`, `/notifications`), authentication/session
  handling, authorization/tenant isolation, input validation, upload handling, business
  logic, error/logging behaviour, and the mobile client's credential storage and network
  configuration.
- **Out of scope:** Third-party services (Firebase/FCM), physical device compromises,
  social engineering, and the build/signing pipeline beyond configuration review.
- **Environment:** Local deployment. Server: `server/` (SQLite WAL, foreign keys ON).
  Mobile: `Kazi/` (Keychain-backed session, no local financial cache).
- **No destructive actions:** Testing used an in-memory database. No production data was
  read, modified, or deleted. No secrets are reproduced in this report.

---

## 3. Findings

| # | Severity | Finding | Status |
|---|----------|---------|--------|
| F1 | High | Password reset code disclosed in the API response in production | Fixed |
| F2 | Medium | Idempotency key collision across operation types | Fixed |
| F3 | Low | Malformed JSON -> HTTP 500 and raw body written to logs | Fixed |
| F4 | Low | Signup reveals whether an email is registered (enumeration) | Accepted |
| F5 | Low | Uploaded image declared MIME type is not verified against content | Accepted |
| F6 | Low | Auth rate limiter is per-IP and never releases (shared-IP lockout) | Accepted |
| F7 | Info | `z.coerce.number()` accepts hex strings, arrays and booleans | Accepted |
| F8 | Info | Deployment hardening gaps (secret strength, release signing, TLS) | Recommendation |
| F9 | Info | Vulnerable transitive dependencies | Recommendation |

---

### F1 (High) - Password reset code returned in the HTTP response

**Description.** `POST /auth/forgot-password` returned the raw password-reset code in the
JSON response whenever the supplied email, first name and last name matched an account.
This ran in every environment.

**Impact.** An attacker who knew a victim's email and full name (both commonly public or
guessable for a small-business owner) could call the endpoint, obtain the reset code and
complete `POST /auth/reset-password`, taking over the account. The full name check is the
only factor protecting the flow, and there is no email-delivery factor.

**Evidence.** Before the fix the response body contained a `resetToken` field on a
successful match; a mismatched name or unknown email returned no token (so the endpoint
did not distinguish unknown-email from wrong-name, but did distinguish a valid match).

**Root cause.** `server/src/auth/routes.ts` returned `resetToken` unconditionally. The
project README documented this as a development-only convenience, but no code enforced
that boundary.

**Fix applied.** The reset code is now only disclosed when `NODE_ENV !== 'production'`.
In production the endpoint responds without the code (and logs a warning that no delivery
channel is configured). Development and the mobile flow are unchanged. See
`server/src/auth/routes.ts:55`.

**Notes.** A real email/SMS sender must be wired up before the reset flow is usable in
production. The mobile client currently depends on the returned code, which is acceptable
only for development builds.

---

### F2 (Medium) - Idempotency key collision across operation types

**Description.** The offline/idempotency ledger is keyed by `(user_id, client_op_id)`. The
lookup ignored the `op_type` column that was stored with each entry. Submitting the same
`clientOpId` for a *different* operation returned the first operation's stored response
and skipped the new operation entirely.

**Impact.** A client that reused an operation id (or an attacker with a valid session who
replayed one) would receive a misleading success response containing an unrelated record,
while the intended write silently never happened. Impact was confined to the attacker's
own account (the lookup is scoped by `user_id`), so this was a data-integrity and
correctness flaw rather than a cross-tenant issue. The in-repo client does not currently
send `clientOpId`, so the impact today is latent.

**Evidence.** Creating a transaction with `clientOpId = X` then creating an item with the
same `clientOpId = X` returned the transaction object with HTTP `200`; `GET /items`
confirmed the item was not created.

**Root cause.** `server/src/idempotency.ts` selected only on `(user_id, client_op_id)`.

**Fix applied.** The lookup now also reads `op_type`; if the stored type differs from the
requested type the request is rejected with `409 IDEMPOTENCY_CONFLICT` instead of
replaying the wrong response. The database primary key already prevents storing two rows
for the same key, so an explicit, safe conflict error is the correct behaviour. See
`server/src/idempotency.ts` and the new `IDEMPOTENCY_CONFLICT` code in
`server/src/errors.ts`.

**Verification.** Same key used across a transaction and an item now returns `409` and the
item is not created; same key, same operation still replays correctly (existing tests).

---

### F3 (Low) - Malformed JSON returns 500 and logs the raw body

**Description.** A body that failed `express.json()` parsing (for example, truncated JSON)
fell through to the generic handler, which returned `500 INTERNAL` and called
`log.error('Unhandled error', err)`. body-parser attaches the raw request body to that
error object, so the submitted payload could be written to logs.

**Impact.** Low but real: (a) an incorrect 5xx for a client input error, and (b) possible
logging of sensitive submitted fields (for example, a password) when a request is
malformed. An attacker could also deliberately generate noisy 500s.

**Root cause.** `server/src/errors.ts` did not handle body-parser errors.

**Fix applied.** `errorHandler` now maps `entity.parse.failed` to `400 VALIDATION_ERROR`
and `entity.too.large` to `413`, before any logging, so the raw body is never logged.
`server/src/errors.ts`.

---

### F4 (Low, accepted) - Account enumeration on signup

**Description.** `POST /auth/signup` returns `409 EMAIL_IN_USE` for a registered email and
`201` for a new one, so an attacker can enumerate registered email addresses.

**Decision.** This is a deliberate usability trade-off; the mobile signup screen depends
on the `409` to tell the user to sign in instead. Changing the message would degrade the
product without removing the underlying difference. **Mitigation:** the `signup` endpoint
is rate-limited by the `slowDown` limiter, which constrains bulk enumeration. If
enumeration must be eliminated, move to an email-verification/response-uniform flow.

*(Reference: `server/src/auth/service.ts:80`, `server/src/auth/routes.ts:32`.)*

---

### F5 (Low, accepted) - Uploaded image content type is not verified

**Description.** Item images are stored as base64 data URIs. Validation checks only the
declared media type (`data:image/(jpeg|png|webp|gif);base64,...`) and a maximum length; the
decoded bytes are not checked against magic numbers. Arbitrary content (for example HTML
or SVG bytes) can be labelled as a JPEG/PNG and stored.

**Impact.** Low for the current architecture: the API is JSON-only (no `text/html`
responses), images are rendered through React Native `<Image>` for the owning user only,
and there is no web dashboard or `WebView`. If the image is ever rendered in a browser or
served from an object store, this becomes a stored-XSS/SSRF-style risk.

**Recommendation.** Validate decoded bytes against a small magic-number allowlist and
re-encode images server-side before any future browser rendering. Intentionally not
patched now to avoid rejecting legitimate re-encoded uploads without a rendering sink.

*(Reference: `server/src/items/validation.ts`.)*

---

### F6 (Low, accepted) - Auth rate limiter behaviour

**Description.** The in-memory limiter is keyed by `req.ip` + path and never resets within
its window. After 25 login attempts from one IP, further logins from that IP (including
legitimate ones behind the same NAT/proxy) are blocked for 15 minutes. The `hits` map also
grows without eviction.

**Impact.** A shared-IP or carrier-NAT user can be locked out; an attacker on a shared IP
could deny login to others. This is a well-known trade-off of IP-based limiting.

**Recommendation.** Add per-account throttling (by email) alongside IP limiting, and evict
expired entries. Keep IP limiting for credential-stuffing defense.

*(Reference: `server/src/middleware/rateLimit.ts`.)*

---

### F7 (Info, accepted) - Coercion in numeric validation

**Description.** `z.coerce.number()` accepts values such as `"0x10"` (-> 16), `[5]` (-> 5)
and `true` (-> 1). Values are still stored as numbers and remain scoped to the user, so no
authorization or financial boundary is crossed.

**Recommendation.** Use `z.number()` for JSON bodies (coercion is only needed for string
sources such as route params/query).

*(Reference: `server/src/items/validation.ts`, `server/src/transactions/validation.ts`.)*

---

### F8 (Info, recommendation) - Deployment hardening

- The repository `.env` contains a clearly labelled development JWT secret. Ensure a
  strong, unique `JWT_SECRET` is injected in production and never committed.
- The Android release build is signed with the debug keystore, and cleartext traffic
  defaults are placeholders. Configure a real release keystore and keep
  `usesCleartextTraffic=false` for production.
- Transport is HTTP in development; terminate TLS in front of the API in production.
- `google-services.json` in the repo is a placeholder with no real key material.

*(References: `server/.env.example`, `android/app/build.gradle`,
`android/app/src/main/AndroidManifest.xml`, `ios/Kazi/Info.plist`.)*

---

### F9 (Info, recommendation) - Dependency advisories

- **Server:** `qs` (via `express`) and `uuid` (via Firebase tooling) have moderate
  advisory entries; the `qs` parsing issues are remotely reachable through Express query
  parsing. Update when convenient.
- **Mobile:** `image-size` (via Metro) and `query-string` (via React Navigation) have
  advisory entries; `image-size` is build-time only.

These were not auto-upgraded, to avoid unintended changes to a working dependency tree
without a functional test pass on the updated graph. Schedule a dependency refresh with
regression testing.

---

## 4. Controls that held (no vulnerability found)

- **Tenant isolation / IDOR.** Items, transactions, debts, feedback and stock movements
  were probed with a second authenticated account: reads, updates, deletes, stock moves,
  debt payment and "create transaction with another user's item" all returned `404`/no
  effect. Ownership is enforced in the service layer (`WHERE ... AND user_id = ?`).
- **Authentication.** Missing, malformed, tampered, `alg: none`, wrong-secret, expired,
  and wrong-`ver`/non-numeric-`sub` tokens were all rejected `401`. Token version is
  bumped on password reset, invalidating prior sessions.
- **Mass assignment / prototype pollution.** Unknown fields (including `user_id`, `id`,
  `__proto__`, `constructor`) are stripped/ignored by Zod object schemas.
- **SQL injection.** Injection attempts in names and route ids were rejected or treated as
  data; all queries are parameterized.
- **Path/parameter handling.** Non-numeric, array and oversized ids returned `400`.
  Activity `limit` is clamped.
- **CORS.** Denied by default; no `Access-Control-Allow-Origin` is returned to arbitrary
  browser origins, so a malicious website cannot drive or read the API via a user's
  browser.
- **Security headers.** `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`
  and `Cache-Control: no-store` are set on all responses.
- **Mobile credential storage.** The session token is stored in
  `react-native-keychain` with device-only accessibility; no tokens are logged; no
  financial data is cached locally; development HTTP / production HTTPS are separated.

---

## 5. Changes applied (all server-side)

| File | Change |
|------|--------|
| `server/src/auth/routes.ts` | Reset code only disclosed when `NODE_ENV !== 'production'`; warning logged when withheld. |
| `server/src/idempotency.ts` | Reads `op_type`; mismatched reuse rejected with `409`. |
| `server/src/errors.ts` | Added `IDEMPOTENCY_CONFLICT`; map body-parser `entity.parse.failed`/`entity.too.large` to `400`/`413` without logging the body. |
| `server/src/app.test.ts` | New tests: production withholds reset code; malformed JSON -> `400`. |
| `server/src/sync.test.ts` | New test: cross-operation `clientOpId` reuse -> `409 IDEMPOTENCY_CONFLICT`. |
| `server/src/__probe*.security.ts` | Temporary assessment probes removed. |

No mobile source, schema, or dependency changes were made.

---

## 6. Verification

Re-attacked against the patched code:

```
[idem]  txn=201; item-with-same-op=409 code=IDEMPOTENCY_CONFLICT; items=0
[json]  malformed body -> 400 code=VALIDATION_ERROR
[reset-prod]     status=200 hasToken=false
[reset-dev]      status=200 hasToken=true
[reset-wrongname] status=200 hasToken=false
[idor-item] get=404 del=404
[idor-txn]  get=404 del=404 createWithVictimItem=404
[idor-debt] get=404 pay=404 del=404
```

- **Server:** `npm run typecheck` clean; `npm test` -> **86/86 pass** (83 pre-existing + 3 new).
- **Mobile:** `npx tsc --noEmit` clean; `npx jest --silent` -> **96/96 pass** (no client changes).

---

## 7. Residual risk and recommended follow-ups

1. Wire a real email/SMS sender so password reset works in production without returning the code (F1 follow-through).
2. Decide whether to accept signup email enumeration or move to a uniform response with verification (F4).
3. Add server-side image content validation before any browser/object-store rendering path exists (F5).
4. Add per-account (email) login throttling alongside IP limits and evict expired limiter entries (F6).
5. Inject a strong production `JWT_SECRET`; configure a real release keystore and enforce non-cleartext transport (F8).
6. Refresh dependencies with a regression pass (F9).

## 8. Assessment limitations

This was a time-boxed, source-assisted assessment of a local build. It does not prove the
absence of vulnerabilities. Areas not fully exercised include long-running concurrency,
multi-instance deployments, the Firebase/FCM path with live credentials, and native
build/reverse-engineering review.
