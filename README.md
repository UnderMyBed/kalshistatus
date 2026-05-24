# kalshistatus.dev

Real-time status and performance page for the [Kalshi](https://kalshi.com)
prediction-market API.

Built for engineers integrating with Kalshi who want to know whether the API
is up, slow, or having issues — before opening a support ticket.

[![status](https://kalshistatus.dev/badge.svg)](https://kalshistatus.dev)

## What it monitors

- REST API endpoints (prod + demo environments) — public-health and
  authenticated probes, surfaced separately
- Exchange `exchange_active` / `trading_active` flags
- WebSocket connectivity and tick rate
- Response latency over the last 24h
- Uptime windows: 24h / 7d / 30d
- AI-summarized Kalshi changelog entries

## Public API

```bash
curl https://kalshistatus.dev/api/status?env=prod
curl https://kalshistatus.dev/api/history?env=prod&limit=60
curl https://kalshistatus.dev/api/changelog?limit=10
curl https://kalshistatus.dev/badge.svg
```

Full spec at [`/openapi.yaml`](https://kalshistatus.dev/openapi.yaml).
RSS feed at [`/feed.xml`](https://kalshistatus.dev/feed.xml).

## Tech

Cloudflare Workers (TypeScript) · D1 · KV · SQLite-backed Durable Object ·
Workers AI · Grafana Cloud · Cloudflare Edge Cache

The entire stack runs on free tiers — see [`CLAUDE.md`](CLAUDE.md) for the
operating envelope.

## Development

```bash
npm install
npm test         # 119 tests, runs against local miniflare
npm run dev      # wrangler dev
```

## Deploy

Push to `main` — GitHub Actions runs CI, applies D1 migrations, and deploys.

## Docs

- [Architecture](docs/ARCHITECTURE.md) — components, routes, security headers
- [Runbook](docs/runbook.md) — health checks, rollback, secret rotation,
  incident severity
- [ADRs](docs/adr/) — 12 architectural decision records
- [Incidents](incidents/) — post-mortems

## Author

[`@UnderMyBed`](https://github.com/UnderMyBed). Unofficial; not affiliated
with Kalshi.
