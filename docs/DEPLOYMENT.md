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
| `NODE_ENV` | ✅ `production` | — | Enables production behaviour |
| `JWT_SECRET` | ✅ | — | ≥ 32 random bytes; weak values refused after KZ-29 |
| `PORT` | | `4000` | Bind behind the proxy |
| `DATABASE_PATH` | | `server/data/kazi.db` | Absolute path on SSD recommended |
| `TRUST_PROXY` | ✅ `1` | unset | **New (KZ-08)** — number of proxy hops |
| `CORS_ORIGIN` | | unset (denied) | Only if a browser client is added |
| `FIREBASE_SERVICE_ACCOUNT` or `GOOGLE_APPLICATION_CREDENTIALS` | ✅ for push | unset | Push disabled when unset |
| `ALLOW_DEV_RESET_CODE` | ❌ must be unset | unset | **New (KZ-06)** — dev only; boot fails if set in production |
| Reset delivery settings (provider key, sender id) | ✅ | — | **New (KZ-06, decision D2)** |

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
| Reset-code provider key | `/etc/kazi/api.env` | Per provider instructions |
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
2. Copy `server/dist/`, `server/package.json`, `server/package-lock.json` **and** `shared/package.json`
   + `shared/dist/` to the host, keeping the `server/` and `shared/` folders side by side (the API
   depends on `"@kazi/shared": "file:../shared"`). Run `npm ci --omit=dev` in `server/` there
   (better-sqlite3 builds natively for the server's platform).
3. **Back up the database** (`§5`) before every deploy — pending numbered migrations
   (`server/src/db/migrations`, see [ARCHITECTURE.md](ARCHITECTURE.md) §6.1) run on boot, each in
   its own transaction; a failed migration stops the boot and leaves the database at the last good
   version. The first deploy after session 2 runs `2_integer_money` (KZ-25), which rebuilds four
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
1. Firebase and APNs configured (KZ-02); Push and Background Modes capabilities on.
2. Remove the empty `NSLocationWhenInUseUsageDescription` from `Info.plist`; keep
   `PrivacyInfo.xcprivacy` accurate.
3. `cd ios && bundle exec pod install` after every native dependency change (for example
   `@react-native-community/netinfo`, added in KZ-01); Android autolinks it at build time.
4. Archive in Xcode (Release), upload to App Store Connect, TestFlight QA, submit.
5. App Privacy answers must match the Play data-safety form.

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
