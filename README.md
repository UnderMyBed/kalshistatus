# kalshistatus.dev

Real-time status and performance page for the Kalshi API.

Built for engineers integrating with Kalshi who want to know if the API is up, slow, or having issues — before opening a support ticket.

## What it monitors

- REST API endpoints (prod + demo environments)
- Exchange status and trading active flags
- WebSocket connectivity
- Response latency by region (us-east, eu-west, asia)

## Tech

Cloudflare Workers · D1 · KV · Workers AI · Grafana Cloud

## Development

```bash
npm install
npm test
npm run dev
```

## Deploy

Push to `main` — GitHub Actions handles it.

## Docs

- [Architecture](docs/ARCHITECTURE.md)
- [Runbook](docs/runbook.md)
- [ADRs](docs/adr/)
