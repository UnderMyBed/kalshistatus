# Architecture

kalshistatus.dev is one Cloudflare Worker that probes the Kalshi API
every 5 minutes, persists the results, and serves a public dashboard plus
a JSON API. This document is the long-form reference; the
[runbook](runbook.md) is the operational counterpart and the
[ADRs](adr/) record the load-bearing decisions.

## At a glance

```
                 PR merged to main
                       │
                       ▼
               (no deploy pipeline yet —
                ADR 0014; re-arch pending)

   ┌──────────────────────────────────────────────┐
   │  Cloudflare Worker  (kalshi-status)          │
   │  routes via wrangler.toml [[routes]]:        │
   │    kalshistatus.dev/*                        │
   │    www.kalshistatus.dev/*                    │
   │                                              │
   │  fetch() — public API + static dashboard     │
   │  scheduled() — two crons:                    │
   │     */5 * * * *  → probe (REST, D1 write)    │
   │     0 0 * * *    → prune (30-day retention)  │
   └───────┬──────────────────────────────────────┘
           │
       ┌───▼──┐     ┌─────────────────────┐
       │  D1  │     │ caches.default      │
       │ snap │     │ (Cloudflare edge)   │
       └──────┘     └─────────────────────┘
           │
   ┌───────▼────────┐
   │  Kalshi REST   │
   │  (4 public     │
   │   endpoints)   │
   └────────────────┘

   Logs  →  Cloudflare Workers Observability
```

## Components

| Component            | File(s)                | Purpose                                                                                   |
| -------------------- | ---------------------- | ----------------------------------------------------------------------------------------- |
| Worker entry         | `src/index.ts`         | Routes HTTP, applies security headers, dispatches cron.                                   |
| Probe cron           | `src/cron.ts`          | Probes 4 public REST endpoints, writes one snapshot row to D1.                            |
| Kalshi client        | `src/kalshi-client.ts` | REST probe execution, endpoint definitions.                                               |
| Status determination | `src/status.ts`        | Rolls public probes up to `operational` / `degraded` / `partial_outage` / `major_outage`. |
| Storage              | `src/storage.ts`       | D1 reads/writes for the `snapshots` table.                                                |
| Edge cache           | `src/edge-cache.ts`    | `caches.default` for all public routes — no per-request D1 reads.                         |
| HTTP API             | `src/api.ts`           | `/api/status`, `/api/history`, `/api/version`, `/badge.svg`.                              |
| Static page          | `public/`              | Dashboard HTML, CSS, JS served via the `ASSETS` binding.                                  |

## Cron timeline

Both crons run on Cloudflare's serverless cron triggers (declared in
`wrangler.toml` `[triggers]`). The dispatch happens in
`src/index.ts:scheduled()`.

### Probe cron — `*/5 * * * *` (every 5 minutes)

```
runProbeCron(env):
  Promise.all([
    probe('exchange_status'),   # GET /exchange/status
    probe('markets_list'),      # GET /markets?limit=1
    probe('events_list'),       # GET /events?limit=1
    probe('series_list'),       # GET /series?limit=1
  ])
    │
    ▼
  determineStatus(results)   → operational | degraded | partial_outage | major_outage
    │
    ▼
  D1: INSERT one row into snapshots
```

Each endpoint result carries `status` (up/down), `latency_ms`, and on
failure `http_status` or `error`.

If the probe cron throws, `wrangler tail` shows
`"*/5 * * * *" @ <ts> - Exception Thrown` and **no snapshot lands for
that tick**. The cron handler does not retry within the tick.

### Prune cron — `0 0 * * *` (daily at midnight UTC)

```
runPruneCron(env):
  DELETE FROM snapshots
  WHERE ts < now - SNAPSHOT_RETENTION_DAYS * 86400 * 1000
```

`SNAPSHOT_RETENTION_DAYS` defaults to 30 (set in `wrangler.toml`
`[vars]`). To change retention, update the var and document why in an
ADR.

## Probes

### REST endpoints

| Key               | Path               | Auth | Group  |
| ----------------- | ------------------ | ---- | ------ |
| `exchange_status` | `/exchange/status` | none | public |
| `markets_list`    | `/markets?limit=1` | none | public |
| `events_list`     | `/events?limit=1`  | none | public |
| `series_list`     | `/series?limit=1`  | none | public |

Status mapping per probe (`src/kalshi-client.ts`):

- HTTP 2xx → `up`
- HTTP 4xx / 5xx → `down` with `http_status` populated
- Network error / abort → `down` with `error` populated

### Status determination (headline)

`src/status.ts:determineStatus()` considers all four public probes:

- All probes `up` → `operational`
- `exchange_status` not `up` → `major_outage`
- All probes not `up` → `major_outage`
- > 50% probes not `up` → `partial_outage`
- Any probe not `up` → `degraded`

## Storage

### D1 (`kalshi_status`)

Single table:

```sql
CREATE TABLE snapshots (
  ts               INTEGER NOT NULL,
  status           TEXT NOT NULL,
  exchange_active  INTEGER NOT NULL,
  trading_active   INTEGER NOT NULL,
  endpoints        TEXT NOT NULL   -- JSON array of per-endpoint results
);
```

One row per probe cron tick: ≈288 rows/day at 5-minute intervals.
Retention: 30 days (`SNAPSHOT_RETENTION_DAYS`), enforced by the daily
prune cron.

Uptime windows (24h / 7d / 30d) are computed in SQL at read time. A
snapshot counts as "available" when `status IN ('operational',
'degraded')`.

Migrations live in `migrations/*.sql`. There is no automated deploy
pipeline yet (see ADR 0014); apply migrations manually before deploying
a new schema — see the [runbook](runbook.md#provisioning).

### Edge cache (`caches.default`)

All public routes are explicitly cached via `caches.default` in
`src/edge-cache.ts`. `Cache-Control` headers alone do not cache Worker
responses — they only advise clients. The first request through a cold
edge node is a miss; subsequent requests within TTL are hits
(`X-Cache: HIT`). There is no per-request D1 access on cache hits.

| Route          | TTL   |
| -------------- | ----- |
| `/api/status`  | 60 s  |
| `/api/history` | 5 min |
| `/api/version` | 5 min |
| `/badge.svg`   | 60 s  |

See [ADR-0010](adr/0010-edge-caching-and-region-history.md) for the
original rationale; ADR-0015 removes KV and makes the edge cache the
sole hot-read path.

## HTTP routes

| Path            | Methods   | Description                               |
| --------------- | --------- | ----------------------------------------- |
| `/`             | GET, HEAD | Dashboard HTML (static asset via ASSETS)  |
| `/badge.svg`    | GET, HEAD | SVG badge                                 |
| `/healthz`      | GET, HEAD | `{ok: true, ts}`                          |
| `/api/status`   | GET, HEAD | Latest snapshot                           |
| `/api/history`  | GET, HEAD | Recent snapshots (`?window=24h\|7d\|30d`) |
| `/api/version`  | GET, HEAD | `{version, commit}`                       |
| `/openapi.yaml` | GET, HEAD | OpenAPI 3.1 contract                      |
| (all)           | OPTIONS   | CORS preflight (204)                      |

## Bindings and vars

| Binding / var             | Type   | Purpose                                 |
| ------------------------- | ------ | --------------------------------------- |
| `DB`                      | D1     | The `kalshi_status` database            |
| `ASSETS`                  | Assets | Static files (`public/`)                |
| `KALSHI_PROD_REST_BASE`   | var    | Base URL for Kalshi prod REST API       |
| `SNAPSHOT_RETENTION_DAYS` | var    | Days of snapshots to keep (default: 30) |
| `VERSION`                 | var    | Semantic version string                 |
| `COMMIT_SHA`              | var    | Git commit SHA at deploy time           |

There are no secrets. All probed endpoints are public and require no
authentication.

## Security headers

`withSecurityHeaders()` in `src/index.ts` applies on every response:

- `Strict-Transport-Security: max-age=31536000; includeSubDomains; preload`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: accelerometer=(), camera=(), geolocation=(), microphone=()`
- `X-Frame-Options: DENY` on framed-by-default routes (`/`, `/api/status`,
  `/api/history`, `/healthz`)
- `Content-Security-Policy` strict on app routes.

> **Operational gotcha.** Cloudflare's zone-level HSTS UI setting can
> override the Worker's header. If you see `max-age=0` in production
> response headers, check the zone HSTS settings in the Cloudflare
> dashboard.

## Observability

Enabled in `wrangler.toml` `[observability]` with
`head_sampling_rate = 1.0`. All `console.log` / `console.error` and
unhandled exceptions land in the Cloudflare dashboard under Workers →
`kalshi-status` → Observability.

Live tail from the CLI:

```bash
npx wrangler tail kalshi-status --format pretty
```

This is the **primary debug surface**. Every probe-cycle exception
shows up here with the line that threw.

## Budget

By-construction, not runtime-gated:

- ≈288 D1 writes/day (one per probe tick) — far under the 100k/day free limit
- Public reads served from edge cache — no D1 reads on cache hits
- No secrets, no KV, no Durable Objects, no Workers AI, no external push

See [ADR-0015](adr/0015-public-only-probe-rearchitecture.md) for the
design rationale.

## Comparison with kalshistatus.com

|                  | kalshistatus.dev (this)              | kalshistatus.com         |
| ---------------- | ------------------------------------ | ------------------------ |
| Audience         | Integrating engineers                | Consumer / trader        |
| Hosting          | Cloudflare Workers (free tier)       | GCP (us-east4)           |
| Status detection | Automated probes every 5 minutes     | Manual incident reports  |
| REST latency     | Per-endpoint, with sparklines        | None                     |
| Uptime windows   | 24h / 7d / 30d                       | "No incidents" indicator |
| Public JSON API  | OpenAPI 3.1, full snapshot           | None                     |
| Embeddable badge | `/badge.svg` (Shields.io-compatible) | None                     |

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
