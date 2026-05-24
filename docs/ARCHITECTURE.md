# Architecture

kalshistatus.dev is a Cloudflare Worker that probes the Kalshi API every minute
and serves the results.

## Components

- **Worker** (`src/index.ts`) — Routes HTTP requests, applies security headers,
  enforces the cost circuit breaker, and dispatches cron jobs.
- **Cron: fast** (`* * * * *`) — Probes Kalshi REST endpoints for both prod and
  demo environments. Writes results to D1 and KV (KV write-on-change).
- **Cron: slow** (`0 * * * *`) — Processes changelog RSS, generates AI summaries,
  pushes Prometheus metrics to Grafana, prunes old snapshots.
- **D1** (`kalshi_status` database) — Persistent storage for snapshots (90-day
  retention), changelog summaries, and region probes.
- **KV** (`KALSHI_KV`) — Read cache for the latest snapshot per environment.
  Written only on content change.
- **Workers AI** — One-shot summarization of Kalshi changelog entries.
- **Static Assets** (`./public`) — Dashboard HTML/JS/CSS served via the
  `[assets]` binding.

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

| Path           | Method    | Description                                  |
| -------------- | --------- | -------------------------------------------- |
| `/`            | GET, HEAD | Dashboard HTML                               |
| `/embed`       | GET, HEAD | iframe-friendly compact status widget        |
| `/badge.svg`   | GET, HEAD | SVG badge for embedding (`?env=prod\|demo`)  |
| `/healthz`     | GET, HEAD | Liveness probe                               |
| `/api/status`  | GET, HEAD | Latest snapshot (`?env=prod\|demo&at=<ts>`)  |
| `/api/history` | GET, HEAD | Snapshot history (`?env=prod\|demo&limit=N`) |
| (all)          | OPTIONS   | CORS preflight                               |

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

| Name                      | Purpose                                      |
| ------------------------- | -------------------------------------------- |
| `KALSHI_PROD_KEY_ID`      | Kalshi prod API key ID                       |
| `KALSHI_PROD_PRIVATE_KEY` | Kalshi prod RSA private key (PKCS#8 PEM)     |
| `KALSHI_DEMO_KEY_ID`      | Kalshi demo API key ID                       |
| `KALSHI_DEMO_PRIVATE_KEY` | Kalshi demo RSA private key                  |
| `GRAFANA_API_TOKEN`       | Grafana Cloud service-account token (writer) |
| `CLOUDFLARE_API_TOKEN`    | GitHub Actions deploy token (CI only)        |

Secrets are pushed via `wrangler secret put` once. CI never sets secrets. If
rotation is needed, do it interactively from a developer machine.

## See also

- [ADRs](adr/) for decision rationale
- [Runbook](runbook.md) for operations
