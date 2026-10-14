# Kazi — Performance

Kazi's users run budget Android phones on 3G/4G networks that are often slow or patchy. This
document sets the performance budgets, lists the current hotspots (each mapped to a task in
[PROJECT_TRACKER.md](PROJECT_TRACKER.md)), and gives the rules and the measurement method.

**Reference device:** a 2 GB RAM, Android 11–13, low-end handset (Samsung Galaxy A0x / Tecno Spark
class). **Reference network:** "Fast 3G" profile (≈ 1.6 Mbps down, 750 kbps up, 150 ms RTT).

---

## Performance budgets

These are the targets for milestone M4. Measure them as described in §6.

### App

| Metric | Budget |
|---|---|
| Cold start to first screen (release build, reference device) | ≤ 2.5 s |
| Home: tap tab → totals visible (reference network) | ≤ 1.0 s |
| Save a sale: tap Save → back on previous screen | ≤ 1.5 s |
| Scroll Products / History with 1 000 rows | ≥ 55 fps, no blank cells longer than one frame |
| JS heap after 10 minutes of normal use | ≤ 150 MB |
| Android download size (arm64, AAB) | ≤ 20 MB |
| Background network when idle | No polling (event-driven connectivity) |

### API (single server, 2 vCPU, SSD; account with 10 000 transactions and 500 items)

| Endpoint | p50 | p95 | Response size |
|---|---|---|---|
| `GET /summary` | ≤ 10 ms | ≤ 30 ms | ≤ 1 kB |
| `GET /activity` (page of 30) | ≤ 20 ms | ≤ 60 ms | ≤ 15 kB |
| `GET /items` (500 items, no images) | ≤ 20 ms | ≤ 60 ms | ≤ 80 kB (≤ 20 kB gzipped) |
| `POST /transactions` | ≤ 15 ms | ≤ 50 ms | ≤ 1 kB |
| `POST /auth/login` | ≤ 120 ms | ≤ 250 ms | ≤ 1 kB |
| `GET /health` during a login burst | ≤ 5 ms | ≤ 20 ms | tiny |

Sustained throughput target: 200 requests/s mixed read/write without breaching p95.

---

## 1. Current hotspots

| Hotspot | Effect | Task |
|---|---|---|
| `GET /items` embeds every photo (up to 2 MB each); Home and the sale form load it on every focus | Megabytes per screen visit on 3G | KZ-14 |
| ~~Connectivity probe every 30 s over plain HTTP~~ | Fixed (KZ-01): NetInfo events; no timer; iOS reachability checks pause in the background | KZ-01 ✅ |
| ~~bcrypt `hashSync` / `compareSync` on the request thread~~ | Fixed (KZ-21): bcryptjs async on a worker-thread pool started with the server (its async mode alone still blocks up to 100 ms per slice); measured numbers in the tracker log | KZ-21 ✅ |
| `/summary` runs 5 separate queries | Avoidable round trips into SQLite | KZ-32 |
| `db.prepare()` on every call | Re-parses SQL on hot paths | KZ-32 |
| SQLite default `synchronous=FULL` with WAL | Slower commits than needed | KZ-32 |
| Products / History / Debts use `ScrollView` + `map` | All rows render at once; jank on long lists | KZ-31 |
| R8 / resource shrinking off; one APK with 4 ABIs | Larger download, slower install and start | KZ-33 |
| ~~Rate-limiter map never pruned~~ | Fixed (KZ-08): expired buckets swept every minute (unref'd timer, stops at the first live bucket), at most 10 000 keys per limiter; 100 000 distinct keys tested | KZ-08 ✅ |
| Duplicate writes on retry | Extra load and wrong data | KZ-11 |

---

## 2. Server rules

1. **Never block the event loop.** No `*Sync` crypto or file I/O in request handlers. CPU-heavy
   work (hashing) uses async APIs.
2. **SQLite settings on open** (KZ-32):
   ```
   journal_mode = WAL
   synchronous  = NORMAL     -- safe with WAL; much faster commits
   foreign_keys = ON
   busy_timeout = 5000
   temp_store   = MEMORY
   ```
   Run `PRAGMA optimize` on shutdown and once a day.
3. **Prepare once.** Hot statements are prepared when the router is created and reused.
4. **One query per question.** Aggregate in SQL (`SUM(CASE WHEN …)`) instead of several queries.
5. **Every filter has an index.** Add or check an index whenever a new `WHERE` / `ORDER BY` pattern
   is introduced; verify with `EXPLAIN QUERY PLAN` (no `SCAN` on user tables in hot paths).
6. **Paginate everything that grows.** Lists default to ≤ 50 rows, max 200.
7. **Small payloads.** No binary data inside JSON lists; images served separately with long-lived
   cache headers and ETags (KZ-14).
8. **Compression at the proxy.** gzip/brotli for JSON at the reverse proxy (see
   [DEPLOYMENT.md](DEPLOYMENT.md)), not in Node.
9. **Side effects after commit.** Push notifications and other network calls run after the
   transaction commits, with a timeout, and never delay the response (KZ-03).
10. **Measure.** Every request logs its duration; queries over 50 ms are logged (KZ-34).

## 3. App rules

1. **Lists:** `FlatList`/`SectionList` with stable `keyExtractor`, memoized rows,
   `getItemLayout` for fixed-height rows, `initialNumToRender` ≈ one screen, paging via
   `onEndReached` (KZ-31).
2. **Fetch only what the screen shows.** Home uses `/summary` only; the item picker loads items
   without images and caches them for the session.
3. **No polling.** Connectivity via NetInfo events; refresh data on screen focus and pull-to-refresh.
4. **Images:** pick at ≤ 1024 px, quality 0.6 (current); display thumbnails sized to the view;
   rely on HTTP caching once images have URLs (KZ-14).
5. **Re-renders:** context values memoized (already done for Auth/Offline); avoid inline object
   props on list rows; keep heavy computation in `useMemo`.
6. **Start-up:** keep the root light — language load, token read and `/auth/me` only. Defer
   notification setup until after the first screen renders.
7. **Release build:** Hermes on (done), R8 + `shrinkResources`, AAB delivery (KZ-33).
8. **Request timeout** stays 15 s, and writes are idempotent so a retry is always safe (KZ-11).

## 4. Optional: instant screens with a read cache (decision D7)

The app is online-only, so every screen waits for the network. Recommended improvement after P1:
keep the last successful response for Home, Products and History page 1 (in memory and
AsyncStorage, per user, cleared on logout). Show it immediately with a "last updated" time, then
refresh in the background. Writes still go straight to the server. This keeps the
single-source-of-truth design (ADR A1) while making the app feel instant on slow networks.

---

## 5. Network-friendly API conventions

- JSON only, no pretty-printing in production.
- `Cache-Control: no-store` on data responses (privacy), long-lived caching only on versioned image URLs.
- Requests carry only changed fields where possible; responses return the saved record so the app
  doesn't need a second fetch.
- Error responses are tiny and coded (KZ-12).

---

## 6. How to measure

| What | How |
|---|---|
| API latency | Seed a test DB with 10 000 transactions / 500 items for one user (script to add under `server/scripts/seed-perf.ts`), then run `autocannon` (or `k6`) against each endpoint for 30 s; record p50/p95 from the request logs (KZ-34) |
| Event-loop blocking | `monitorEventLoopDelay` from `node:perf_hooks` during a login burst; p99 delay ≤ 20 ms |
| Query plans | `EXPLAIN QUERY PLAN` for every query in `*/service.ts`; check into the PR description when queries change |
| App start and frames | Release build on the reference device; Android Studio profiler or `adb shell am start -W` for start time; Perf Monitor / Flashlight for fps |
| Payload sizes | Proxy access logs or a network inspector on the reference network profile |
| Download size | Play Console "App size" report for the AAB |

Record each measurement with date and build in the tracker's update log when a performance task
closes.

---

## 7. Performance review checklist for every pull request

- [ ] No slow synchronous crypto (bcrypt, scrypt, PBKDF2: use the worker pool, KZ-21) or file I/O
      in request handlers. Microsecond HMACs on a few bytes (JWT checks, reset codes) are fine.
- [ ] New queries use an index (`EXPLAIN QUERY PLAN` checked) and are paginated if unbounded.
- [ ] No binary or unbounded data in list responses.
- [ ] Lists in the app are virtualized; no new polling.
- [ ] Payload and latency budgets above still hold.
