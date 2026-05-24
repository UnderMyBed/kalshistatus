# kalshistatus.dev

**Real-time status and performance page for the
[Kalshi](https://kalshi.com) prediction-market API. For the engineers
shipping against it.**

[![status](https://kalshistatus.dev/badge.svg)](https://kalshistatus.dev)
[![ci](https://github.com/UnderMyBed/kalshistatus/actions/workflows/ci.yml/badge.svg)](https://github.com/UnderMyBed/kalshistatus/actions/workflows/ci.yml)

Probes the Kalshi REST + WebSocket APIs every minute from Cloudflare's
edge, persists snapshots, and serves a public status page plus a
machine-readable JSON API. The entire stack runs on free tiers.

## What this is (and isn't)

There is already an unofficial status site at
[kalshistatus.com](https://kalshistatus.com) — consumer-positioned,
answers "is Kalshi down?", hand-curated incident reports, no historical
latency. **kalshistatus.dev is positioned differently**: per-endpoint
latency, sparklines, 24h/7d/30d uptime windows, multi-region probes,
per-channel WebSocket sampling, an OpenAPI contract, an embeddable
badge, an Atom feed, and AI-summarized changelog entries. The audience
is an engineer integrating with the Kalshi API who wants to know
whether their bug is on their end or upstream — before opening a
support ticket.

It is **unofficial** and not affiliated with Kalshi. Data is best-effort.

## Public surfaces

| Surface                                     | Purpose                                |
| ------------------------------------------- | -------------------------------------- |
| `https://kalshistatus.dev/`                 | Live dashboard (prod + demo)           |
| `/api/status?env=prod\|demo[&at=<unix_ms>]` | JSON snapshot (live or historical)     |
| `/api/history?env=prod\|demo&limit=N`       | Up to 1440 recent snapshots            |
| `/api/changelog?limit=N`                    | AI-summarized Kalshi changelog entries |
| `/api/version`                              | Deployed `{version, commit}`           |
| `/badge.svg?env=prod\|demo`                 | Shields.io-style status badge          |
| `/embed?theme=auto\|light\|dark`            | iframe-friendly compact widget         |
| `/feed.xml`                                 | Atom 1.0 feed of changelog entries     |
| `/openapi.yaml`                             | OpenAPI 3.1 contract for `/api/*`      |
| `/healthz`                                  | `{ok: true, ts}` liveness probe        |

## Example: read live status

```bash
curl -s https://kalshistatus.dev/api/status?env=prod \
  | jq '{status, exchange, endpoints: [.endpoints[] | {name, status, latency_ms}]}'
```

```jsonc
{
  "status": "operational",
  "exchange": { "exchange_active": true, "trading_active": true },
  "endpoints": [
    { "name": "exchange_status", "status": "up", "latency_ms": 92 },
    { "name": "markets_list", "status": "up", "latency_ms": 64 },
    { "name": "events_list", "status": "up", "latency_ms": 92 },
    { "name": "series_list", "status": "up", "latency_ms": 305 },
    // ...
  ],
}
```

Headline `status` is rolled up from **public probes only**
(`exchange_status`, `markets_list`, `events_list`, `series_list`). The
four `portfolio_*` probes appear in the response but represent
"can we authenticate at all," not Kalshi's public health.

## What it monitors

- **REST endpoints**, prod and demo: `exchange_status`, `markets_list`,
  `events_list`, `series_list` (public) plus `portfolio_balance`,
  `portfolio_positions`, `portfolio_orders`, `portfolio_fills`
  (authenticated; require RSA-PSS signed headers).
- **Exchange flags**: `exchange_active`, `trading_active`.
- **WebSocket** (per environment): one authenticated connection per
  cron tick, subscribed to `trade`, `ticker_v2`, `orderbook_delta`,
  `communications`. Reports `msg_count`, `rate_per_sec`, and
  `median_age_ms` per channel.
- **Multi-region probes**: us-east, eu-west, asia (best-effort,
  driven by the colo the cron lands in).
- **Uptime windows**: 24h / 7d / 30d, computed on a slow cron.
- **Changelog**: Kalshi RSS pulled hourly, summarized by Workers AI.

## Tech

Cloudflare Workers (TypeScript) · D1 · KV · SQLite-backed Durable
Object (cost circuit breaker) · Workers AI · Grafana Cloud · Cloudflare
edge cache (`caches.default`).

The whole stack runs on free tiers — see
[`CLAUDE.md`](CLAUDE.md) for the operating envelope.

## Docs

- **[Architecture](docs/ARCHITECTURE.md)** — components, cron timeline,
  probes, WebSocket sampling, regions, storage, edge caching, cost
  circuit breaker, security headers, comparison with kalshistatus.com.
- **[Runbook](docs/runbook.md)** — deploy, rollback, log tailing,
  Grafana, secrets, D1 ops, troubleshooting recipes, cost-control
  posture, incident severity definitions.
- **[ADRs](docs/adr/)** — 13 architecture decision records covering
  every load-bearing choice in the stack.
- **[Incidents](incidents/)** — post-mortems.

## Develop

```bash
npm install
npm test               # 129 tests, runs against local miniflare
npm run dev            # wrangler dev — local Worker at localhost:8787
```

Test fixtures don't touch real Kalshi keys; the WebSocket sampler
accepts an injected auth-header builder so tests stay off Web Crypto.

## Deploy

Pushing to `main` triggers `.github/workflows/deploy.yml`:

1. `npx wrangler d1 migrations apply kalshi_status --remote`
2. `npx wrangler deploy`

There is no staging — production deploys on every merge to main.
Land changes via PR with green CI; never push directly. See the
[runbook](docs/runbook.md) for rollback steps.

## Author

[`@UnderMyBed`](https://github.com/UnderMyBed). Unofficial; not
affiliated with Kalshi.
