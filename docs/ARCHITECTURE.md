# Architecture

kalshistatus.dev is a Cloudflare Worker that probes the Kalshi API every minute and serves the results.

## Components

**Worker** (`src/index.ts`) — Routes HTTP requests and dispatches cron jobs.

**Cron: fast** (`* * * * *`) — Probes Kalshi REST endpoints for both prod and demo environments. Writes results to D1 and KV.

**Cron: slow** (`0 * * * *`) — Processes changelog RSS, generates AI summaries, pushes Prometheus metrics to Grafana, prunes old snapshots.

**D1** (`kalshi_status` database) — Persistent storage for snapshots (90-day retention) and changelog summaries.

**KV** (`KALSHI_KV`) — Read cache for latest snapshot. Written only on content change.

**Workers AI** — One-shot summarization of Kalshi changelog entries.

**Static Assets** (`./public`) — Dashboard HTML/CSS/JS served directly.

## Data Flow

```
Cron (fast) → probe Kalshi REST → compute status → write D1 + KV (if changed)
Cron (slow) → fetch RSS → AI summaries → D1 → push Prometheus
HTTP /api/status → read KV → JSON response
HTTP /api/history → read D1 → JSON response
HTTP / → serve public/index.html
```

## Secrets

`KALSHI_PROD_KEY_ID`, `KALSHI_PROD_PRIVATE_KEY`, `KALSHI_DEMO_KEY_ID`, `KALSHI_DEMO_PRIVATE_KEY`, `GRAFANA_PROM_TOKEN` — set via `wrangler secret put` before deploy.

## See Also

- [ADRs](adr/) for decision rationale
- [Runbook](runbook.md) for operations
