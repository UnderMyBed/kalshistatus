# Architecture

kalshistatus.dev is one Cloudflare Worker that probes the Kalshi API
every minute, persists the results, and serves a public dashboard plus
a JSON API. This document is the long-form reference; the
[runbook](runbook.md) is the operational counterpart and the
[ADRs](adr/) record the load-bearing decisions.

## At a glance

```
                 GitHub Actions (push to main)
                          │
                          ▼
                  npx wrangler deploy
                          │
                          ▼
   ┌──────────────────────────────────────────────┐
   │  Cloudflare Worker  (kalshi-status)          │
   │  routes via wrangler.toml [[routes]]:        │
   │    kalshistatus.dev/*                        │
   │    www.kalshistatus.dev/*                    │
   │                                              │
   │  fetch() — public API + static dashboard     │
   │  scheduled() — two crons:                    │
   │     * * * * *  → runFastCron (REST + WS)     │
   │     0 * * * *  → runSlowCron (RSS, AI,       │
   │                  prune, uptime rollups)      │
   └───────┬──────────────┬─────────┬─────────────┘
           │              │         │
       ┌───▼──┐       ┌───▼──┐ ┌────▼────────┐
       │  D1  │       │  KV  │ │ Durable Obj │
       │ hist │       │ hot  │ │ CostCounter │
       └──────┘       └──────┘ └─────────────┘
           │
   ┌───────▼────────┐    ┌────────────┐   ┌──────────────┐
   │  Kalshi REST   │    │ Kalshi WS  │   │ Workers AI   │
   │  (prod + demo) │    │ (4 chans)  │   │ Llama-3.1    │
   └────────────────┘    └────────────┘   └──────────────┘

   Prometheus push  →  Grafana Cloud (one public dashboard)
   Logs            →  Cloudflare Workers Observability
```

## Components

| Component            | File                                            | Purpose                                                                                   |
| -------------------- | ----------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Worker entry         | `src/index.ts`                                  | Routes HTTP, applies security headers, dispatches cron.                                   |
| Fast cron            | `src/cron.ts` `runFastCron`                     | Probes REST + WS, writes snapshots.                                                       |
| Slow cron            | `src/cron.ts` `runSlowCron`                     | Prunes old rows, refreshes changelog summaries, recomputes uptime windows.                |
| Kalshi client        | `src/kalshi-client.ts`                          | RSA-PSS signing, REST probe, endpoint definitions.                                        |
| WebSocket sampler    | `src/ws-sampler.ts`                             | Authenticated WS, 4-channel sample, per-channel rate + msg-age.                           |
| Status determination | `src/status.ts`                                 | Rolls public probes up to `operational` / `degraded` / `partial_outage` / `major_outage`. |
| Storage              | `src/storage.ts`                                | D1 reads/writes for snapshots, region probes, uptime.                                     |
| KV cache             | `src/kv.ts`                                     | KV read cache for the latest snapshot (write-on-change).                                  |
| Edge cache           | `src/edge-cache.ts`                             | `caches.default` for public routes.                                                       |
| Cost circuit breaker | `src/cost-counter-do.ts`, `src/cost-control.ts` | SQLite-backed Durable Object atomic request counter.                                      |
| Changelog            | `src/changelog.ts`                              | RSS fetch + Workers AI summarization.                                                     |
| Prometheus push      | `src/grafana.ts`                                | Builds exposition format, posts to Grafana Cloud.                                         |
| Uptime rollups       | `src/uptime.ts`                                 | 24h / 7d / 30d windows precomputed by slow cron.                                          |
| Region detection     | `src/regions.ts`                                | Maps `cdn-cgi/trace` colo to `us-east` / `eu-west` / `asia`.                              |
| HTTP API             | `src/api.ts`                                    | `/api/status`, `/api/history`, `/api/changelog`, `/api/version`, `/badge.svg`.            |
| Atom feed            | `src/feed.ts`                                   | `/feed.xml`.                                                                              |

## Cron timeline

Both crons run on Cloudflare's serverless cron triggers (declared in
`wrangler.toml` `[triggers]`). The dispatch happens in
`src/index.ts:scheduled()`.

### Fast cron — `* * * * *` (every minute)

```
runFastCron(env):
  Promise.all([
    probeEnvironment('prod'),   # REST + WS
    probeEnvironment('demo'),   # REST + WS
    detectRegion()              # GET /cdn-cgi/trace → colo → region
  ])
    │
    ▼
  for each env:
    REST: 8 endpoints in Promise.all
      - 4 public: exchange_status, markets_list, events_list, series_list
      - 4 authed (RSA-PSS signed): portfolio_balance, portfolio_positions,
                                    portfolio_orders, portfolio_fills
      - auth failures isolated per probe (status='down', error='auth_build_failed: ...')
        so one bad PEM cannot kill the whole cycle
    WS: one authenticated upgrade, 4 channel subscribes, 5s sample
      - per-channel msg_count, rate_per_sec, median_age_ms
    │
    ▼
  D1: always write snapshot (every region, every env)
  KV: write-on-change AND only from us-east (canonical)
  D1 region_probes: append from whichever region the cron landed in
  Grafana: best-effort push to Prometheus remote-write
```

If the fast cron throws, `wrangler tail` shows
`"* * * * *" @ <ts> - Exception Thrown` and **no snapshot lands for
that minute**. The cron handler does not retry within the tick.

### Slow cron — `0 * * * *` (hourly)

```
runSlowCron(env):
  Promise.all([
    pruneSnapshots(now, 90 days),
    pruneRegionProbes(now, 7 days),
    fetchAndSummarizeChangelog(),  # RSS + Workers AI
    computeAndStoreUptime(now)     # 24h / 7d / 30d rollups → D1
  ])
```

## Probes

### REST endpoints

| Key                   | Path                                       | Auth    | Group         |
| --------------------- | ------------------------------------------ | ------- | ------------- |
| `exchange_status`     | `/exchange/status`                         | none    | public        |
| `markets_list`        | `/markets?limit=1`                         | none    | public        |
| `events_list`         | `/events?limit=1`                          | none    | public        |
| `series_list`         | `/series?limit=1`                          | none    | public        |
| `portfolio_balance`   | `/portfolio/balance`                       | RSA-PSS | authenticated |
| `portfolio_positions` | `/portfolio/positions?limit=1`             | RSA-PSS | authenticated |
| `portfolio_orders`    | `/portfolio/orders?status=resting&limit=1` | RSA-PSS | authenticated |
| `portfolio_fills`     | `/portfolio/fills?limit=1`                 | RSA-PSS | authenticated |

Status mapping per probe (`src/kalshi-client.ts`):

- HTTP 2xx → `up`
- HTTP 4xx / 5xx → `down` with `http_status` populated
- Network error / abort → `down` with `error` populated
- Authed probe with missing creds → `unknown` with `error: "no_credentials"`
- Authed probe with crypto failure → `down` with `error: "auth_build_failed: ..."`

### Status determination (headline)

`src/status.ts:determineStatus()` only considers **public** probes:

- All public probes `up` → `operational`
- `exchange_status` not `up` → `major_outage`
- All public probes not `up` → `major_outage`
- > 50% public probes not `up` → `partial_outage`
- Any public probe not `up` → `degraded`

Authenticated probes are surfaced in the JSON but **do not roll up to
the headline**. Rationale: a 401 on `portfolio_balance` means our key
is wrong; it isn't Kalshi being down. See
[ADR-0009](adr/0009-public-auth-probe-separation.md).

### RSA-PSS signing

`buildAuthHeaders(method, path, keyId, privatePem)` produces three
headers Kalshi expects:

```
KALSHI-ACCESS-KEY: <key_id>
KALSHI-ACCESS-TIMESTAMP: <unix_ms>
KALSHI-ACCESS-SIGNATURE: base64( RSA-PSS-SHA256( <ts><METHOD><path_no_query> ) )
```

The signed message uses `url.pathname` only — query strings are excluded.
PKCS8 PEM is parsed by `normalizePemBody()` which tolerates PKCS1 and
PKCS8 labels, CRLF/LF line endings, and literal `\n` escape sequences
(useful when secrets are set through a wrapper that JSON-encodes the
value). See [ADR-0005](adr/0005-rsa-pss-signing.md).

## WebSocket sampling

Each fast-cron tick opens one authenticated WebSocket via
`fetch(httpsUrl, { headers: { Upgrade: 'websocket', ...authHeaders } })`
— the only Workers path that can attach custom headers on a WS upgrade.
A plain `new WebSocket(url)` cannot send the RSA-PSS signature and was
the cause of a long-standing "0 tickers received" bug.

| Channel           | What it tells you                                                                |
| ----------------- | -------------------------------------------------------------------------------- |
| `trade`           | Executed-trade message rate                                                      |
| `ticker_v2`       | Quote-update rate and freshness                                                  |
| `orderbook_delta` | Book update rate (`orderbook_snapshot` and `orderbook_delta` types both counted) |
| `communications`  | RFQ / official communications rate                                               |

Per channel the snapshot records:

- `msg_count` over the sample window
- `rate_per_sec` = `count / (WS_SAMPLE_MS / 1000)`
- `median_age_ms` — median of `Date.now() - msg.msg.ts` across observed
  messages (median over mean so one slow message doesn't dominate)

Failure modes carried in `ws_sample.error`:
`no_credentials` (env vars missing), `upgrade_failed_<status>` (auth
rejected at upgrade), `ws_error` (post-accept error), or the thrown
message. See [ADR-0013](adr/0013-websocket-multi-channel-sampling.md).

## Multi-region detection

`detectRegion()` reads `https://www.cloudflare.com/cdn-cgi/trace`,
parses the `colo=` line, and maps the IATA airport code to one of
three logical regions:

```
iad, dca, ewr, bos, atl, mia  → us-east
lhr, dub, cdg, ams, fra, mad  → eu-west
nrt, hnd, kix, sin, hkg, icn  → asia
anything else                  → null (no region probe written)
```

Three behaviors follow:

- **D1 snapshot** is always written, regardless of region.
- **KV `latest:<env>` is written only from `us-east`.** us-east is the
  canonical view; other regions writing KV would race over the
  per-minute snapshot and cost extra writes.
- **D1 `region_probes`** is written from any of the three known
  regions, so the dashboard can show per-region latency over time.

Cloudflare crons are dispatched to a single colo per tick, picked by
the platform. The dispatch is not pinned to a region, so KV freshness
depends on the cron landing in us-east. See
[ADR-0006](adr/0006-multi-region-probing.md) and
[ADR-0010](adr/0010-edge-caching-and-region-history.md).

## Storage

### D1 (`kalshi_status`)

| Table                 | Rows                                          | Retention                |
| --------------------- | --------------------------------------------- | ------------------------ |
| `snapshots`           | one per cron tick per env (~2,880/day)        | 90 days                  |
| `region_probes`       | one per cron tick per env per detected region | 7 days                   |
| `changelog_summaries` | one per Kalshi changelog entry                | indefinite               |
| `uptime_metrics`      | one per env per window (24h, 168h, 720h)      | overwritten by slow cron |

Migrations live in `migrations/*.sql` and are applied by the deploy
workflow before each `wrangler deploy`.

### KV (`KALSHI_KV`)

| Key                | Value                                    | Notes                                         |
| ------------------ | ---------------------------------------- | --------------------------------------------- |
| `latest:prod`      | latest prod snapshot JSON                | Written from us-east only, on content change. |
| `latest:demo`      | latest demo snapshot JSON                | Same.                                         |
| `latest:hash:prod` | sha256 of payload excluding noise fields | Used for write-on-change comparison.          |
| `latest:hash:demo` | same, demo                               |                                               |
| `changelog_cache`  | parsed RSS items (JSON)                  | 1 h TTL.                                      |

The noise-field exclusion list (response times, last-checked
timestamps, latency history, region snapshots) means cron updates that
only change probe timing don't burn KV writes. See
[ADR-0003](adr/0003-kv-read-cache.md).

### Cost counter Durable Object (`CostCounter`)

SQLite-backed, free-tier compatible (`new_sqlite_classes` migration).
Single-writer atomic counter for daily HTTP request volume. Two
thresholds:

- **Soft** at 80k req/day → `shed` mode (reserved for future degraded
  responses)
- **Hard** at 95k req/day → `blocked` mode (Worker returns
  `503 Retry-After: 3600` and cron skips probes for the rest of the day)

The counter is keyed on UTC date and rolls over naturally at midnight.
See [ADR-0012](adr/0012-cost-counter-durable-object.md).

## Edge caching

Public routes are explicitly cached via `caches.default` in
`src/edge-cache.ts`. `Cache-Control` headers alone do not cache Worker
responses — they only advise clients. The first request through is a
miss; the second within TTL is a hit (`X-Cache: HIT` in the response).

| Route            | TTL    |
| ---------------- | ------ |
| `/api/status`    | 15 s   |
| `/api/history`   | 60 s   |
| `/api/changelog` | 5 min  |
| `/api/version`   | 5 min  |
| `/badge.svg`     | 60 s   |
| `/feed.xml`      | 10 min |

Cache key normalization: query params are sorted alphabetically so
`?env=prod&at=123` and `?at=123&env=prod` share a key. See
[ADR-0010](adr/0010-edge-caching-and-region-history.md).

## HTTP routes

| Path             | Methods   | Description                                  |
| ---------------- | --------- | -------------------------------------------- |
| `/`              | GET, HEAD | Dashboard HTML (static asset)                |
| `/embed`         | GET, HEAD | iframe-friendly compact widget               |
| `/badge.svg`     | GET, HEAD | SVG badge (`?env=prod\|demo`)                |
| `/healthz`       | GET, HEAD | `{ok: true, ts}`                             |
| `/api/status`    | GET, HEAD | Latest snapshot (`?env=prod\|demo&at=<ts>`)  |
| `/api/history`   | GET, HEAD | Recent snapshots (`?env=prod\|demo&limit=N`) |
| `/api/changelog` | GET, HEAD | AI-summarized changelog entries              |
| `/api/version`   | GET, HEAD | `{version, commit}`                          |
| `/feed.xml`      | GET, HEAD | Atom 1.0 feed of changelog entries           |
| `/architecture`  | GET       | 302 → GitHub source of this file             |
| `/openapi.yaml`  | GET, HEAD | OpenAPI 3.1 contract                         |
| `/og.svg`        | GET, HEAD | OG image (1200×630 SVG)                      |
| (all)            | OPTIONS   | CORS preflight (204)                         |

## Security headers

`withSecurityHeaders()` in `src/index.ts` applies on every response:

- `Strict-Transport-Security: max-age=31536000; includeSubDomains; preload`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: accelerometer=(), camera=(), geolocation=(), microphone=()`
- `X-Frame-Options: DENY` on framed-by-default routes (`/`,
  `/architecture`, `/api/status`, `/api/history`, `/healthz`)
- `Content-Security-Policy` strict on app routes, permissive
  `frame-ancestors *` only on `/embed` so partners can iframe it.

> **Operational gotcha.** Cloudflare's zone-level HSTS UI setting can
> override the Worker's header. If you see `max-age=0` in production
> response headers, check the zone HSTS settings in the Cloudflare
> dashboard.

## Observability

### Cloudflare Workers Observability

Enabled in `wrangler.toml` `[observability]` with
`head_sampling_rate = 1.0`. All `console.log` / `console.error` and
unhandled exceptions land in the Cloudflare dashboard under Workers →
`kalshi-status` → Observability.

Live tail from the CLI:

```bash
npx wrangler tail kalshi-status --format pretty
```

This is the **primary debug surface**. Every probe-cycle exception
shows up here with the line that threw. Use this before reaching for
Grafana for any in-the-moment diagnostic.

### Grafana Cloud (Prometheus push)

`src/grafana.ts:pushMetrics()` pushes a small set of gauges to Grafana
Cloud Prometheus remote-write after every fast cron tick:

- `kalshi_status_up{environment}` (1 = operational, 0 = major_outage)
- `kalshi_exchange_active{environment}`, `kalshi_trading_active{environment}`
- `kalshi_endpoint_latency_ms{environment,endpoint}`
- `kalshi_endpoint_up{environment,endpoint}` (1/0/0.5/-1)

Public dashboard: `PUBLIC_DASHBOARD_URL` in `wrangler.toml`. Linked
from the site footer.

> **Known issue (2026-05-24).** The Prometheus push currently logs
> `grafana remote-write failed: 401` on every cycle. Either the
> `GRAFANA_API_TOKEN` is expired/wrong or the request body needs
> snappy-encoded protobuf instead of plain exposition format. Cron data
> writes to D1/KV are unaffected. See the runbook's troubleshooting
> section for diagnosis and rotation steps.

## Secrets

| Name                          | Purpose                                       |
| ----------------------------- | --------------------------------------------- |
| `KALSHI_PROD_KEY_ID`          | Kalshi prod API key ID (the short identifier) |
| `KALSHI_PROD_PRIVATE_KEY_PEM` | Kalshi prod RSA private key (PKCS8 PEM)       |
| `KALSHI_DEMO_KEY_ID`          | Kalshi demo API key ID                        |
| `KALSHI_DEMO_PRIVATE_KEY_PEM` | Kalshi demo RSA private key                   |
| `GRAFANA_API_TOKEN`           | Grafana Cloud Prometheus push token           |
| `CLOUDFLARE_API_TOKEN`        | GitHub Actions deploy token (CI only)         |

All are pushed via `wrangler secret put` once, interactively, from a
developer machine. CI never sets secrets. See the runbook for
rotation.

## Free-tier envelope

| Resource           | Cap       | Typical usage               | Margin  |
| ------------------ | --------- | --------------------------- | ------- |
| Workers requests   | 100k/day  | a few thousand/day          | safe    |
| Workers CPU        | 10 ms/req | REST probes 1–3 ms          | safe    |
| KV reads           | 100k/day  | ~1 per /api/status miss     | safe    |
| KV writes          | 1k/day    | ~300/day (write-on-change)  | safe    |
| D1 rows read       | 5M/day    | history lookups only        | safe    |
| D1 rows written    | 100k/day  | ~2,880/day (cron)           | safe    |
| D1 storage         | 5 GB      | ~250 MB at 90d retention    | safe    |
| Workers AI neurons | 10k/day   | ~5 changelog summaries/week | trivial |

The cost circuit breaker hard-caps Workers requests at 95k/day so we
cannot accidentally exceed the free tier even under viral traffic.

## Comparison with kalshistatus.com

|                  | kalshistatus.dev (this)              | kalshistatus.com              |
| ---------------- | ------------------------------------ | ----------------------------- |
| Audience         | Integrating engineers                | Consumer / trader             |
| Hosting          | Cloudflare Workers (free tier)       | GCP (us-east4)                |
| Status detection | Automated probes every minute        | Manual incident reports       |
| REST latency     | Per-endpoint, with sparklines        | None                          |
| WebSocket        | 4 channels, msg rate, median msg-age | 4 channels, msg rate, msg age |
| Multi-region     | us-east, eu-west, asia               | Single region (us-east4)      |
| Uptime windows   | 24h / 7d / 30d                       | "No incidents" indicator      |
| Public JSON API  | OpenAPI 3.1, full snapshot           | None                          |
| Embeddable badge | `/badge.svg` (Shields.io-compatible) | None                          |
| Atom/RSS feed    | `/feed.xml`                          | None                          |
| Historical view  | `?at=<unix_ms>` snapshot lookups     | None                          |

The two pages don't compete — they answer different questions. This
one is built for the engineer who needs to know whether their bug is
upstream or local. kalshistatus.com is built for the trader who wants
a green dot.

## See also

- [Runbook](runbook.md) — operations, deploy, troubleshooting recipes
- [ADRs](adr/) — design decision records
- [Incidents](../incidents/) — post-mortems
- [`CLAUDE.md`](../CLAUDE.md) — the operating-envelope constraints
  every change must respect
