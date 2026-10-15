# Kazi — Deployment and Release

How to run Kazi in production: server setup, configuration, secrets, backups, mobile releases, and
the go-live checklist. Items that depend on unfinished tasks name the task from
[PROJECT_TRACKER.md](PROJECT_TRACKER.md).

---

## 1. Environments

| Environment | API | Database | App build | Purpose |
|---|---|---|---|---|
| Local | `http://<dev-host>:4000` (auto-detected from Metro) | `server/data/kazi.db` | Debug | Development |
| Staging | `https://staging-api.<domain>` | Own SQLite file | Release, internal track / TestFlight | Pre-release QA |
| Production | `https://api.<domain>` (decision D3) | Own SQLite file + backups | Release, store | Users |

Staging and production never share secrets, databases or Firebase projects.

---

## 2. Server topology (production)

```
Internet ──443──▶ Reverse proxy (Caddy or nginx)
                    • TLS 1.2+ with auto-renewed certificate, HSTS
                    • gzip/brotli for JSON
                    • request body limit, per-IP connection limits
                    • forwards to 127.0.0.1:4000
                 ─▶ Kazi API (Node ≥ 22, NODE_ENV=production, systemd service)
                    • TRUST_PROXY=1 (exactly one proxy hop)
                 ─▶ SQLite file on local SSD (data/kazi.db, WAL)

Operator ──SSH tunnel──▶ 127.0.0.1:4100  Admin dashboard (read-only)
```

- Firewall: allow 22 (SSH, key-only) and 443 (and 80 for certificate issuance/redirect). Port 4000
  and 4100 are **never** exposed.
- One API process (rate limits and admin sessions are in-memory; see ARCHITECTURE §10).

### Example proxy config (Caddy)

```caddy
api.example.com {
    encode zstd gzip
    request_body {
        max_size 2MB
    }
    header Strict-Transport-Security "max-age=31536000; includeSubDomains"
    reverse_proxy 127.0.0.1:4000
}
```

### Example service unit (systemd)

```ini
[Unit]
Description=Kazi API
After=network.target

[Service]
User=kazi
WorkingDirectory=/opt/kazi/server
EnvironmentFile=/etc/kazi/api.env
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=3
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=/opt/kazi/server/data
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

`/etc/kazi/api.env` is owned by root, mode `0600`, readable by the service only.

---

## 3. Configuration

### API (`server/`)

| Variable | Required in prod | Default | Notes |
|---|---|---|---|
| `NODE_ENV` | ✅ `production` | — | Enables production behaviour. Only `development` and `test` count as non-production for password reset: unset or any other value needs an email sender (KZ-06) |
| `JWT_SECRET` | ✅ | — | ≥ 32 random bytes. With `NODE_ENV=production` the API exits at boot if it is missing, shorter, or the `.env.example` value (KZ-29); elsewhere it only warns |
| `PORT` | | `4000` | Bind behind the proxy |
| `DATABASE_PATH` | | `server/data/kazi.db` | Absolute path on SSD recommended |
| `TRUST_PROXY` | ✅ `1` | unset | Number of reverse proxies in front of the API (KZ-08): a whole number 0–10. Unset or `0`: `X-Forwarded-For` is ignored and limits use the connection address. Any other value (`true`, an address list, a typo) stops the API at boot. See "Rate limits and TRUST_PROXY" below |
| `CORS_ORIGIN` | | unset (denied) | Only if a browser client is added |
| `FIREBASE_SERVICE_ACCOUNT` or `GOOGLE_APPLICATION_CREDENTIALS` | ✅ for push | unset | Push disabled when unset: low-stock alerts are skipped. Boot logs `Push notifications: Firebase credentials set.` or `…: disabled (no Firebase credentials).` See §6 "Firebase and push setup" |
| `NOTIFICATIONS_TEST_SEND` | ❌ must be unset | unset | `1` serves `POST /notifications/send` (push a message you write to your own devices) for testing delivery (KZ-03). Ignored when `NODE_ENV=production`; the route answers 404 otherwise. Boot warns while it is on |
| `EMAIL_PROVIDER` | ✅ | unset | `brevo`, `postmark` or `http` (KZ-06). Without it the API starts only with `NODE_ENV=development` or `test`, where reset codes are printed to the console |
| `EMAIL_API_KEY` | ✅ | — | Brevo API key, Postmark server token, or the bearer token of an `http` relay. Secret; never printed |
| `EMAIL_FROM` | ✅ | — | Sender address, verified with the provider (SPF + DKIM on the domain) |
| `EMAIL_FROM_NAME` | | `Kazi` | Letters, digits, spaces and `. ' & -`, at most 60 |
| `EMAIL_API_URL` | for `http` | provider's endpoint | `https://` only. Required for `http`; overrides the Brevo/Postmark endpoint otherwise |
| `ALLOW_DEV_RESET_CODE` | ❌ must be unset | unset | Development only: `1` also returns the reset code in the forgot-password response. Works only with `NODE_ENV=development` or `test`; with any other `NODE_ENV` the API refuses to start while it is set. Values other than `1`/`0` are refused |

The API checks these at boot and exits with a message naming the variable to fix (never its
value). It logs where codes go: `Password reset codes go to email (brevo).`

#### Rate limits and TRUST_PROXY (KZ-08)

Limits are per client address (signup, forgot-password and reset-password 12 per 15 min each;
login and account deletion 25 per 15 min), per account (10 wrong passwords per 15 min for login,
counted per email from every address, and for account deletion; reset codes 3 per hour and 10 per
day per email) and per user (120 writes a minute; push sends 10 a minute). A refused request gets
`429 TOO_MANY_REQUESTS` with `Retry-After` in seconds. All counters are in memory in the one API
process and reset on restart.

Behind a reverse proxy every connection comes from the proxy, so without `TRUST_PROXY` all users
would share one bucket and 25 bad logins anywhere would lock everyone out. Set it to the number
of proxies that append to `X-Forwarded-For` on the way in, counting from the API:

- One Caddy or nginx on the same host (the topology in §2): `TRUST_PROXY=1`. Caddy's
  `reverse_proxy` and nginx's `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for`
  append the client address; the API takes the last entry and ignores anything the client wrote
  before it.
- A CDN or load balancer in front of that proxy: `2` — only if it also appends to
  `X-Forwarded-For`, and only if the API cannot be reached except through it.
- Clients connect straight to the API (local development): leave it unset.

Too high a count lets a client pick its own address by sending the header; too low makes every
user share the proxy's bucket. Check after deploying: the journal shows
`Client addresses: from X-Forwarded-For, trusting 1 proxy hop(s).`; then from two networks (for
example Wi-Fi and mobile data) make 13 bad `POST /auth/signup` requests with `{}` from the first
— the 13th answers 429 — and one from the second, which must still answer 400.

#### Password-reset email (KZ-06, decision D2)

Codes are sent by `server/src/auth/delivery.ts` (`EmailSender`) through a small HTTPS adapter
(`emailTransport.ts`, 5-second timeout). Brevo and Postmark are built in; `http` posts
`{ from: { email, name }, to, subject, text }` with `Authorization: Bearer <EMAIL_API_KEY>` to
`EMAIL_API_URL` (for a relay, or a provider added later). Amazon SES needs request signing and is
not built in. Messages are plain text in the account's language (en, fr, wes), with the code in
the body only (not the subject) and no links.

**Staging setup and end-to-end check** (the 🟨 Blocked KZ-06 criterion; needs D2's provider and
D3's domain):

1. Choose the provider (D2) and record it in the tracker. Brevo or Postmark need no code change.
2. In the provider: create the account, add the sending domain and publish the SPF and DKIM DNS
   records it gives (plus a DMARC record, e.g. `v=DMARC1; p=none; rua=mailto:<ops address>`), and
   wait until it shows the domain as verified. Postmark: use a server's **transactional**
   (`outbound`) message stream and its Server API token. Brevo: create an API key (SMTP & API →
   API keys).
3. On the staging host add to `/etc/kazi/api.env` (root, `0600`): `EMAIL_PROVIDER=…`,
   `EMAIL_API_KEY=…`, `EMAIL_FROM=no-reply@<domain>`, optionally `EMAIL_FROM_NAME=Kazi`. Make
   sure `ALLOW_DEV_RESET_CODE` is absent. Restart the service; the journal must show
   `Password reset codes go to email (<provider>).`
4. With a staging build of the app and a real mailbox you can read:
   - Sign up, sign in on a second phone, then on the first: Forgot password → email → "Send code".
     The email arrives within a minute, in English, code in the body only.
   - While signed in, switch the app to Français in More (the language is saved on the account),
     sign out and request again: the email is in French and the earlier code no longer works.
   - Enter the code and a new password: success; the second phone is signed out on its next
     request; the new password signs in.
   - Request again, enter 5 wrong codes, then the right one: refused ("Too many wrong tries").
   - Request again, wait 15 minutes, enter the code: refused ("This code has expired").
   - Request 4 times within an hour for one address: the 4th says too many codes.
   - Request for an address with no account: the same screen and message; no email arrives.
5. On the host: `journalctl -u kazi-api --since "1 hour ago" | grep -E "[0-9]{6}|@"` prints no
   code and no address (the database path line may contain digits). Record the result in the
   tracker update log and tick the KZ-06 criterion.
6. Production: repeat steps 2–3 with production's own key (never share keys between
   environments) and one real reset.

If the provider rejects a send (bad key, unverified sender), the API still answers `202` and logs
`Password reset code for user <id> was not delivered: <provider> answered HTTP <status>`.

### Admin dashboard (`server/src/admin`)

| Variable | Default | Notes |
|---|---|---|
| `ADMIN_HOST` | `127.0.0.1` | Keep on loopback in production |
| `ADMIN_PORT` | `4100` | |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | `admin` / generated on first run | Prefer the generated credentials file; if using `ADMIN_PASSWORD`, use ≥ 20 random characters |
| `ADMIN_CREDENTIALS_PATH` | `server/data/admin-auth.json` | Mode `0600` |
| `ADMIN_SESSION_TTL_MS` | 12 h | |
| `ADMIN_TLS` | `auto` | Through an SSH tunnel, `off` is acceptable |
| `ADMIN_COOKIE_SECURE`, `ADMIN_TLS_CERT`, `ADMIN_TLS_KEY`, `ADMIN_TLS_OPENSSL`, `ADMIN_TLS_HOSTS` | | See `server/src/admin/index.ts` |

Start: `npm run admin` (after KZ-18). Access: `ssh -L 4100:127.0.0.1:4100 user@server`, then open
`http://localhost:4100`.

### App

| Setting | Where | Notes |
|---|---|---|
| Production API URL | Build-time config (KZ-09) | Must be `https://`; build fails otherwise |
| Firebase config | `android/app/google-services.json`, `ios/Kazi/GoogleService-Info.plist` | Real project per environment (KZ-02, KZ-03) |
| Version | `versionCode` / `versionName` in `android/app/build.gradle`; Xcode build/marketing version | Bump on every store upload |

---

## Secrets

| Secret | Stored in | Rotation |
|---|---|---|
| `JWT_SECRET` | `/etc/kazi/api.env` | Generate new, restart. Logs everyone out until KZ-13; afterwards sessions are revoked instead |
| Firebase service account | `/etc/kazi/firebase.json` (0600) | Create new key in Google Cloud, deploy, delete old key |
| Reset-code email key (`EMAIL_API_KEY`) | `/etc/kazi/api.env` | Create a new key in the provider, update `api.env`, restart, then revoke the old key. Rotating `JWT_SECRET` also invalidates outstanding reset codes (15-minute lifetime) |
| Admin credentials | `server/data/admin-auth.json` (0600) | Delete the file and restart to generate new ones; or set `ADMIN_PASSWORD` |
| Android upload keystore + passwords | Offline backup + CI secrets | Never rotate casually; Play App Signing allows upload-key reset via Google |
| Apple certificates / APNs key | Apple developer account + CI secrets | Yearly (certificates) |
| Backup encryption key | Password manager, separate from backups | On personnel change |

Never commit any of these. `.gitignore` already covers `.env`, `data/`, `*.keystore` (except the
template `debug.keystore`).

---

## 4. Deploying the API

1. On a clean checkout of the release tag: `(cd shared && npm ci)`, then
   `cd server && npm ci && npm run build && npm test`.
2. Copy `server/dist/`, `server/assets/` (the common-password list the API loads at start,
   KZ-05), `server/package.json`, `server/package-lock.json` **and** `shared/package.json`
   + `shared/dist/` to the host, keeping the `server/` and `shared/` folders side by side (the API
   depends on `"@kazi/shared": "file:../shared"`). Run `npm ci --omit=dev` in `server/` there
   (better-sqlite3 builds natively for the server's platform).
3. **Back up the database** (`§5`) before every deploy — pending numbered migrations
   (`server/src/db/migrations`, see [ARCHITECTURE.md](ARCHITECTURE.md) §6.1) run on boot, each in
   its own transaction; a failed migration stops the boot and leaves the database at the last good
   version. The first deploy after session 4 also runs `4_drop_password_fingerprints` (KZ-05),
   which deletes the password fingerprints table. The first deploy after session 2 runs
   `2_integer_money` (KZ-25), which rebuilds four
   tables to whole-FCFA `INTEGER` money; if it logs `rounded N fractional money value(s)`, keep
   the pre-deploy backup — it is the only copy of the original fractions. A previous build still
   starts on the new schema (it skips migrations newer than itself), but any fractional amount it
   accepts would now fail the integer CHECK with a 500, so roll back with the backup.
   The admin dashboard also serves `server/node_modules/@kazi/shared/dist` at `/shared/` (its
   money formatter), so `shared/` must be built wherever the admin runs.
4. `systemctl restart kazi-api`; check `curl -fsS https://api.<domain>/health` and `/ready` (KZ-34).
5. Watch logs for 10 minutes (error rate, p95 latency).

**Rollback:** stop the service, restore the previous `dist/` and, if a migration ran, the
pre-deploy backup; start the service. Migrations must be backward-compatible for one release
whenever possible so rollback doesn't need a data restore.

---

## 5. Backups (KZ-35)

- Hourly online backup using better-sqlite3's `db.backup()` (or Litestream continuous replication)
  — never copy the live `.db` file with `cp`.
- Retain 48 hourly, 30 daily, 12 monthly. Encrypt (`age` or `gpg`) and copy off the server
  (object storage in another region).
- Monthly restore drill: restore the latest backup to a scratch host, boot the API on it, run the
  smoke test, record the result in the tracker log.

---

## 6. Mobile release

### Android
1. Upload keystore configured (KZ-09); Play App Signing enabled.
2. Bump `versionCode` and `versionName`.
3. `cd android && ./gradlew bundleRelease` → `app/build/outputs/bundle/release/app-release.aab`.
4. Upload to the internal testing track → run the device QA script in
   [TESTING_QA.md](TESTING_QA.md#4-manual-device-qa-script-release-build) → promote to production
   with a staged rollout (10% → 50% → 100%), watching crash rates in Play Console.
5. Store listing: privacy policy URL, data-safety form (account data, financial records,
   photos), account-deletion URL / in-app path (More → Delete account).

### iOS
1. Firebase and APNs configured (KZ-02, steps below). The repository already has what doesn't
   need an Apple account: `ios/Kazi/Kazi.entitlements` (`aps-environment`, the Push
   Notifications capability; Xcode switches it to `production` when it signs for the App Store),
   `UIBackgroundModes` = `remote-notification` in `Info.plist` (Background Modes → Remote
   notifications), and the Podfile settings React Native Firebase 26 needs (below).
2. Keep `PrivacyInfo.xcprivacy` accurate. (The empty `NSLocationWhenInUseUsageDescription` was
   removed in KZ-02; Kazi uses no location.)
3. `cd ios && bundle exec pod install` after every native dependency change (for example
   `@react-native-community/netinfo`, added in KZ-01); Android autolinks it at build time. The
   first install after KZ-02 switches the project to static frameworks and rewrites
   `Kazi.xcodeproj` (`libPods-Kazi.a` becomes `Pods_Kazi.framework`); commit that change and the
   new `Podfile.lock`.
4. Archive in Xcode (Release), upload to App Store Connect, TestFlight QA, submit.
5. App Privacy answers must match the Play data-safety form.

**Podfile (KZ-02).** `$RNFirebaseDisableSPM = true`, `$RNFirebaseAsStaticFramework = true` and
`use_frameworks! :linkage => :static`, before the target block. RNFB 26 otherwise pulls Firebase
through Swift Package Manager, which needs dynamic frameworks and gives each RNFB pod a private
FirebaseCore; CocoaPods with static frameworks is its supported alternative. RNFB 26 requires the
New Architecture, which is React Native 0.87's default — don't turn it off.

**Startup safety (KZ-02).** `AppDelegate.swift` calls `FirebaseApp.configure(options:)` only when
the bundle contains a `GoogleService-Info.plist` with an app id and sender id whose `BUNDLE_ID` is
`com.kazi.app`; otherwise it logs `Firebase is not configured for this build` and the app runs
with push disabled. A build phase (`[Kazi] Copy GoogleService-Info.plist if present`) copies
`ios/Kazi/GoogleService-Info.plist` into the app when the file exists and prints a build warning
when it doesn't, so a build without it still succeeds. In JavaScript every messaging call goes
through `src/notifications/firebase.ts`, which switches push off for the session (logging once in
development) instead of throwing.

### Firebase and push setup (KZ-02, KZ-03)

The 🟨 Blocked device checks. Needs a Google account for Firebase, the Apple Developer account,
a Mac with Xcode, an iPhone and an Android phone. One Firebase project per environment
(`kazi-staging`, `kazi-prod`); never point a staging build at the production project.

1. **Firebase projects.** In the [Firebase console](https://console.firebase.google.com) create
   the project (Analytics not needed). Cloud Messaging is on by default.
2. **Android app.** Project settings → Add app → Android, package name `com.kazi.app`. Download
   `google-services.json`.
3. **iOS app.** Add app → iOS, bundle id `com.kazi.app`. Download `GoogleService-Info.plist`.
4. **APNs key.** In the Apple Developer account → Certificates, IDs & Profiles → Keys → create a
   key with "Apple Push Notifications service (APNs)", download the `.p8` (only once; store it
   with the other Apple secrets) and note its Key ID and the Team ID. In Identifiers →
   `com.kazi.app`, enable Push Notifications. In Firebase → Project settings → Cloud Messaging →
   Apple app configuration, upload the `.p8` with the Key ID and Team ID.
5. **Service account (server).** Firebase → Project settings → Service accounts → Generate new
   private key. Put the JSON on the API host as `/etc/kazi/firebase.json` (root, `0600`) and set
   `GOOGLE_APPLICATION_CREDENTIALS=/etc/kazi/firebase.json` in `/etc/kazi/api.env`, or set
   `FIREBASE_SERVICE_ACCOUNT` to the file's base64 (`base64 -w0 firebase.json`). Never commit it.
   Restart the API.
6. **Drop in the app files, per build.** Keep each environment's `google-services.json` and
   `GoogleService-Info.plist` with the release secrets (they are public client identifiers, but
   per environment, so they are not committed). Before building an environment, copy its files
   to `android/app/google-services.json` (over the placeholder) and
   `ios/Kazi/GoogleService-Info.plist` (git-ignored). In CI, write them from secret files in the
   build job. After a local build, `git checkout android/app/google-services.json` puts the
   placeholder back.
7. **iOS launch check (KZ-02).** On the simulator and a real iPhone, Release configuration:
   - With the plist: the app launches; after sign-in it asks for notification permission.
   - Without it (delete `ios/Kazi/GoogleService-Info.plist`, clean build folder, build): the
     build shows the missing-plist warning, the app launches and works, no permission prompt,
     and the device log shows `[Kazi] Firebase is not configured for this build`.
   Record both in the tracker update log and tick the KZ-02 criteria.
8. **Android placeholder check.** With the committed placeholder `google-services.json` (project
   id `kazi-notifications-placeholder`), the app treats push as disabled: no notification
   permission prompt, no FCM token request (native auto-init is off in `firebase.json`; the app
   turns it on only after it gets a real project's token) and no error. A debug build logs
   `[push] disabled: this build has the placeholder Firebase config` once.
9. **Real delivery check (KZ-03; also KZ-02's push criterion on iOS).** On staging, with the
   environment's files dropped in (step 6) and the service account set (step 5):
   - The API boot log shows `Push notifications: Firebase credentials set.`
   - Sign in on an Android phone and an iPhone with the same account and allow notifications;
     `SELECT platform, updated_at FROM push_tokens WHERE user_id = <id>` shows both devices.
   - Create a product with stock tracking, stock 5, low-stock alert 2. Record a sale of 3: both
     phones get "Low stock alert — <name>: only 2 left." in the account's language, with the app
     in the foreground, in the background and closed. A second sale of 1 sends nothing (already
     below). Restock to 5 and sell 3 again within 12 hours: nothing.
   - FCM down: on the staging host add `10.255.255.1 fcm.googleapis.com` to `/etc/hosts` (a
     non-routable address, so the send hangs). Reset the item's slot
     (`UPDATE items SET last_low_stock_alert_at = NULL WHERE id = <item>`), restock and make a
     crossing sale: it still answers 201 at its usual speed, and about 5 seconds later the journal
     shows `Low-stock alert for user <id> was not delivered: INTERNAL`. Remove the hosts line.
   - Optional manual send: set `NOTIFICATIONS_TEST_SEND=1` on staging only, restart, and
     `POST /notifications/send {"title":"Test","body":"Hello"}` with the account's token; unset
     it and restart afterwards.
   - Uninstall the app on one phone, cause another alert (or a test send): the response reports
     `removedUnregisteredTokens: 1` (test send) and that device's row is gone.
   Record the results in the tracker update log and tick the KZ-02 and KZ-03 criteria.

---

## Go-live checklist

Milestone M5 in the tracker. All must be true:

**Product**
- [ ] All P0 and P1 tasks Done.
- [ ] Device QA script passed on Android (low-end + recent) and iPhone in EN and FR.

**Security** — the [release security gate](SECURITY.md#release-security-gate) passes.

**Performance** — the [budgets](PERFORMANCE.md#performance-budgets) are met and recorded.

**Infrastructure**
- [ ] DNS, TLS certificate and HSTS live on the API domain.
- [ ] Firewall exposes only 22/80/443; SSH key-only.
- [ ] `NODE_ENV=production`, `TRUST_PROXY` set, `ALLOW_DEV_RESET_CODE` unset, strong `JWT_SECRET`.
- [ ] Reset-code email configured (`EMAIL_*`), sending domain verified, staging end-to-end reset
      check passed (§3, KZ-06).
- [ ] Service restarts on failure and on reboot.
- [ ] Hourly encrypted off-site backups running; restore drill passed.
- [ ] Uptime check on `/health` and `/ready` alerting the operator.
- [ ] Log rotation configured (journald or logrotate).

**Release**
- [ ] AAB signed with the upload key; R8 build passed QA.
- [ ] iOS build in TestFlight passed QA.
- [ ] Privacy policy, terms and support email (`support@kazi.app` or the real address) live and
      matching the in-app screens.
- [ ] Rollback plan rehearsed on staging.
