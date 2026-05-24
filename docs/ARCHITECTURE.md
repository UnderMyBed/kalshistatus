# Architecture

kalshistatus.dev is a Cloudflare Worker that probes the Kalshi API every minute
and serves the results.

## Components

- **Worker** (`src/index.ts`) — Routes HTTP requests, applies security headers,
  enforces the cost circuit breaker, and dispatches cron jobs.
- **Cron: fast** (`* * * * *`) — Probes Kalshi REST endpoints for both prod and
  demo environments. Writes results to D1 and KV (KV write-on-change).
- **Cron: slow** (`0 * * * *`) — Processes changelog RSS, generates AI summaries,
  pushes Prometheus metrics to Grafana, prunes old snapshots, and recomputes
  uptime windows.
- **D1** (`kalshi_status` database) — Persistent storage for snapshots (90-day
  retention), changelog summaries, region probes (7-day retention), and
  precomputed uptime metrics (24h / 7d / 30d windows per environment).
- **KV** (`KALSHI_KV`) — Read cache for the latest snapshot per environment.
  Written only on content change.
- **Workers AI** — One-shot summarization of Kalshi changelog entries.
- **Static Assets** (`./public`) — Dashboard HTML/JS/CSS served via the
  `[assets]` binding.
- **Durable Object: `CostCounter`** — Single-writer atomic counter for
  the daily request budget (see [ADR-0012](adr/0012-cost-counter-durable-object.md)).
  SQLite-backed, free-tier compatible.

## Endpoint health groups

Probes are split by trust:

- **Public** (`exchange_status`, `markets_list`, `events_list`, `series_list`) —
  No auth required. **Only these probes determine the headline status.**
- **Authenticated** (`portfolio_balance`, `portfolio_positions`,
  `portfolio_orders`, `portfolio_fills`) — Require RSA-PSS signed headers.
  Surfaced in the API response but do not roll up to headline status; they
  represent "can we authenticate at all," not Kalshi's public health.

If `KALSHI_*_KEY_ID` or `KALSHI_*_PRIVATE_KEY` is missing, authenticated probes
return `status: "unknown"` with `error: "no_credentials"` (never silently 401).

## Data Flow

```
Cron (fast) → probe Kalshi REST → compute status → write D1 + KV (if changed)
Cron (slow) → fetch RSS → AI summaries → D1 → push Prometheus
HTTP /api/status → read KV → JSON response
HTTP /api/history → read D1 → JSON response
HTTP / → serve public/index.html
```

## Routes

| Path             | Method    | Description                                   |
| ---------------- | --------- | --------------------------------------------- |
| `/`              | GET, HEAD | Dashboard HTML                                |
| `/embed`         | GET, HEAD | iframe-friendly compact status widget         |
| `/badge.svg`     | GET, HEAD | SVG badge for embedding (`?env=prod\|demo`)   |
| `/healthz`       | GET, HEAD | Liveness probe                                |
| `/api/status`    | GET, HEAD | Latest snapshot (`?env=prod\|demo&at=<ts>`)   |
| `/api/history`   | GET, HEAD | Snapshot history (`?env=prod\|demo&limit=N`)  |
| `/api/changelog` | GET, HEAD | AI-summarized Kalshi changelog entries        |
| `/api/version`   | GET, HEAD | Deployed `{ version, commit }`                |
| `/feed.xml`      | GET, HEAD | RSS 2.0 feed of changelog entries             |
| `/architecture`  | GET       | 302 → GitHub source of `docs/ARCHITECTURE.md` |
| `/openapi.yaml`  | GET, HEAD | OpenAPI 3.1 spec for the REST API             |
| `/og.svg`        | GET, HEAD | Open Graph image (1200×630 SVG)               |
| (all)            | OPTIONS   | CORS preflight                                |

## Security headers

All responses pass through `withSecurityHeaders()`:

- `Strict-Transport-Security: max-age=31536000; includeSubDomains; preload`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: accelerometer=(), camera=(), geolocation=(), microphone=()`
- `X-Frame-Options: DENY` on framed-by-default routes; CSP `frame-ancestors *`
  on `/embed` only
- `Content-Security-Policy` is applied per-route (strict for app, permissive
  for `/embed`)

## Secrets

| Name                          | Purpose                                      |
| ----------------------------- | -------------------------------------------- |
| `KALSHI_PROD_KEY_ID`          | Kalshi prod API key ID                       |
| `KALSHI_PROD_PRIVATE_KEY_PEM` | Kalshi prod RSA private key (PKCS#8 PEM)     |
| `KALSHI_DEMO_KEY_ID`          | Kalshi demo API key ID                       |
| `KALSHI_DEMO_PRIVATE_KEY_PEM` | Kalshi demo RSA private key                  |
| `GRAFANA_API_TOKEN`           | Grafana Cloud service-account token (writer) |
| `CLOUDFLARE_API_TOKEN`        | GitHub Actions deploy token (CI only)        |

Secrets are pushed via `wrangler secret put` once. CI never sets secrets. If
rotation is needed, do it interactively from a developer machine.

## See also

- [ADRs](adr/) for decision rationale
- [Runbook](runbook.md) for operations
