# Kazi — Security

Kazi holds small businesses' financial records and their owners' personal details. This document
sets the security baseline every change must keep, lists the gaps found in the 2026-10-09 review
(each mapped to a task in [PROJECT_TRACKER.md](PROJECT_TRACKER.md)), and defines the release gate.
The earlier adversarial test report is in `SECURITY_ASSESSMENT.md` at the repository root.

---

## 1. What we protect

| Asset | Where it lives | Impact if exposed or altered |
|---|---|---|
| Sales, expenses, capital, debts, stock | `transactions`, `debts`, `items`, `activity` | Wrong business decisions; leaked commercial data |
| Owner identity (name, email, business) | `users`, AsyncStorage cache | Privacy breach, phishing |
| Debtor names and amounts | `debts` | Third-party personal data |
| Account access | Session tokens (Keychain), password hashes | Account takeover |
| Server secrets | `JWT_SECRET`, Firebase service account, admin credentials | Full compromise |
| Admin view of all users | Admin dashboard | Mass data exposure |

## 2. Who we defend against

| Actor | Typical goal | Main controls |
|---|---|---|
| Internet attacker | Guess passwords, enumerate accounts, abuse reset | Rate limits, uniform responses, strong reset flow |
| Another Kazi user | Read or change someone else's data | Every query scoped by `user_id`; isolation tests |
| Someone holding an unlocked phone | Delete account, read data | Password re-entry for destructive actions |
| Network observer | Read or alter traffic | HTTPS only in release; no cleartext |
| Malicious upload | Store active content | Image byte checks, size limits |
| Supply chain | Vulnerable dependency | Audit in CI, pinned lockfiles |

---

## 3. Controls already in place (keep them)

- Every resource route is behind `requireAuth`; every SQL query filters by the authenticated
  `user_id`. Tests cover cross-user isolation.
- JWT algorithm pinned to HS256; `token_version` check on every request; deleted accounts rejected.
- Passwords hashed with bcrypt; reset codes stored as SHA-256 hashes and single-use.
- All input validated with zod; `strictNumber` rejects hex, booleans, arrays and non-finite numbers.
- SQL uses bound parameters everywhere (no string-built user input).
- Security headers on the API (`nosniff`, `X-Frame-Options: DENY`, `no-referrer`, `no-store`);
  `X-Powered-By` disabled; CORS denied by default.
- Malformed JSON → 400 without logging the body.
- Idempotency keys scoped per user, cross-operation reuse rejected.
- App: token in Keychain/Keystore (`WHEN_UNLOCKED_THIS_DEVICE_ONLY`); `android:allowBackup="false"`;
  iOS ATS does not allow arbitrary loads.
- Admin: separate process, read-only DB handle, scrypt credentials, `HttpOnly; SameSite=Strict`
  cookie, strict CSP, login throttle, binds to `127.0.0.1`.

---

## 4. Gaps and their fixes

| Gap | Risk | Task |
|---|---|---|
| Password-uniqueness check reveals that a password is in use somewhere | High | KZ-05 |
| Reset code returned in HTTP response unless `NODE_ENV=production` (fail-open) | High | KZ-06 |
| Rate limiter shares one bucket for all users behind a proxy; unbounded memory | High | KZ-08 |
| Release APK signed with the public debug key | High | KZ-09 |
| Logout doesn't revoke; 30-day tokens | Medium | KZ-13 |
| Image bytes never checked against declared type | Medium | KZ-15 |
| Vulnerable dependencies (`proxy-addr` critical, others high) | Medium | KZ-19 |
| Account deletion without password re-entry | Low | KZ-20 |
| Login timing reveals registered emails | Low | KZ-21 |
| ~~Weak `JWT_SECRET` accepted~~ | Fixed (KZ-29): production refuses < 32 bytes or the `.env.example` value | KZ-29 ✅ |
| Malformed admin cookie → 500 | Low | KZ-27 |
| No structured, PII-free request logging | Low | KZ-34 |
| No backups (availability and integrity) | Medium | KZ-35 |

---

## 5. Security requirements (apply to every change)

### 5.1 Authentication and sessions
- Passwords: 8+ characters, at least one letter and one digit, max 72 **bytes**, not on the
  common/breached list (after KZ-05).
- Hashing: bcrypt cost ≥ 10, async only (KZ-21). Never log, return or store a plain password.
- Sessions (after KZ-13): access token ≤ 15 min; refresh token rotated on use, stored hashed,
  revocable; reuse of a rotated refresh token revokes the session family.
- Password reset (after KZ-06): 6-digit code, hashed, 15-min expiry, 5 attempts, delivered out of
  band, uniform responses.
- Destructive account actions (delete account, log out all devices) require the password.

### 5.2 Authorization
- Every new route uses `requireAuth` unless explicitly public (`/health`, `/ready`, signup, login,
  reset).
- Every query on user data includes `user_id = ?`. Look up the parent record by id **and** user
  before acting on children (pattern: `requireOwned*`).
- Every new resource gets a cross-user isolation test.

### 5.3 Input and output
- Validate every body, query and param with zod; reject unknown numeric forms via `strictNumber`.
- Money: whole FCFA, `> 0`, `≤ 1e12` (after KZ-04).
- Strings: trim and cap length; never render user text as HTML (admin dashboard escapes output).
- Uploads: check magic bytes, cap decoded size, allow JPEG/PNG/WebP only (KZ-15).
- Errors: stable `code` for the client, no stack traces or SQL in responses.

### 5.4 Abuse protection
- Rate limits: signup / forgot / reset 12 per 15 min per IP; login 25 per 15 min per IP plus a
  per-email failure limit; authenticated writes per user (KZ-08). Always send `Retry-After`.
- `trust proxy` set to the exact proxy configuration in production, never `true` blindly.

### 5.5 Transport
- Release builds talk to the API over HTTPS only (TLS 1.2+ at the proxy, HSTS on the API domain).
- No `http://` URL in release code paths (KZ-01, KZ-09).
- Certificate pinning: **not** planned for v1 (risk of locking users out on certificate rotation);
  revisit if the threat model changes.

### 5.6 Secrets
- `JWT_SECRET`: ≥ 32 random bytes; production refuses to start with a shorter value or the
  `.env.example` placeholder, and prints why without the value (KZ-29). Generate with
  `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`.
- Firebase service account, admin password, keystore and its passwords: never in git; stored in
  the host's secret store or CI secrets; access limited to the operator.
- Rotation: document every secret's rotation steps in [DEPLOYMENT.md](DEPLOYMENT.md#secrets).

### 5.7 Logging and privacy
- Log: method, route pattern, status, duration, user id, error code.
- Never log: request bodies, passwords, tokens, reset codes, emails, debtor names, amounts.
- Personal data is deleted with the account (FK cascades); backups age out on schedule (KZ-35).
- Kazi must meet Cameroon's personal-data protection requirements and the Play Store / App Store
  account-deletion and privacy-policy rules — confirm the exact obligations with a lawyer before
  launch, and keep the in-app Privacy and Terms screens in line with them.

### 5.8 Mobile app
- No secrets in the JS bundle (it is readable by anyone with the APK).
- Session token only in Keychain/Keystore; nothing sensitive in AsyncStorage beyond the display
  profile.
- Release builds: R8 on (KZ-33), `allowBackup=false`, no debug menu, no `console.log` of data.
- Permissions: request only Internet, notifications and photo library. Remove the empty
  `NSLocationWhenInUseUsageDescription` key from `Info.plist` (Kazi does not use location).

### 5.9 Dependencies
- Lockfiles committed; `npm ci` in CI.
- `npm audit --omit=dev --audit-level=high` must pass in CI (KZ-38). Exceptions are recorded below
  with an expiry date.
- Review new dependencies for maintenance, licence and install scripts before adding.

---

## 6. Accepted risks

Each entry needs an owner and a review date.

| Risk | Why accepted | Mitigation | Review by |
|---|---|---|---|
| Signup returns `EMAIL_IN_USE` (email enumeration) | Users need to be told to sign in instead | Rate limits; per-email login limits (KZ-08) | 2027-01-31 |
| Single-process rate limiting and admin sessions | One API instance | Move to a shared store before scaling out | When adding a 2nd instance |

---

## 7. Incident response (short form)

1. **Contain:** rotate the affected secret (rotating `JWT_SECRET` logs everyone out; after KZ-13,
   revoke sessions instead); block abusive IPs at the proxy.
2. **Assess:** use request logs (KZ-34) to identify affected users and time window.
3. **Recover:** restore from backup if data was altered (KZ-35).
4. **Notify:** affected users and, where required by law, the authorities, within the legal deadline.
5. **Learn:** add a regression test and update this document.

---

## 8. Review checklist for every pull request

- [ ] New routes authenticated and user-scoped; isolation test added.
- [ ] All input validated with zod; limits mirrored in the app (KZ-16).
- [ ] No secrets, tokens or personal data in logs, errors or the JS bundle.
- [ ] No new `http://` URL in release paths.
- [ ] New dependency reviewed; `npm audit` clean at high/critical.
- [ ] Error responses use a stable code with a translation in all three locales.

---

## Release security gate

All must be true before a production release (milestone M3 in the tracker):

- [ ] KZ-05, KZ-06, KZ-08, KZ-09, KZ-13, KZ-15, KZ-19, KZ-20, KZ-29 are Done.
- [ ] `NODE_ENV=production`, `TRUST_PROXY` set, `ALLOW_DEV_RESET_CODE` unset on the server.
- [ ] API reachable only through the TLS proxy; port 4000 not exposed publicly.
- [ ] Admin dashboard bound to `127.0.0.1`, reachable only through an SSH tunnel.
- [ ] Release app signed with the upload key; R8 enabled; API URL is `https://`.
- [ ] Server and app `npm audit` clean at high/critical (or documented above).
- [ ] Backups running and a restore has been tested.
- [ ] A fresh adversarial pass (as in `SECURITY_ASSESSMENT.md`) finds no High or Critical issue.
