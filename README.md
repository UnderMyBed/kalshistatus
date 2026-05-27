# kalshistatus.dev

**Real-time status and performance page for the
[Kalshi](https://kalshi.com) prediction-market API. For the engineers
shipping against it.**

[![status](https://kalshistatus.dev/badge.svg)](https://kalshistatus.dev)
[![ci](https://github.com/UnderMyBed/kalshistatus/actions/workflows/ci.yml/badge.svg)](https://github.com/UnderMyBed/kalshistatus/actions/workflows/ci.yml)

Probes the Kalshi REST API every 5 minutes from a Cloudflare Worker,
persists snapshots to D1, and serves a public status page plus a
machine-readable JSON API. The entire stack runs on free tiers.

## What this is (and isn't)

There is already an unofficial status site at
[kalshistatus.com](https://kalshistatus.com) — consumer-positioned,
answers "is Kalshi down?", hand-curated incident reports, no historical
latency. **kalshistatus.dev is positioned differently**: per-endpoint
latency, sparklines, 24h/7d/30d uptime windows, an OpenAPI contract,
and an embeddable badge. The audience is an engineer integrating with
the Kalshi API who wants to know whether their bug is on their end or
upstream — before opening a support ticket.

It is **unofficial** and not affiliated with Kalshi. Data is best-effort.

## Public surfaces

| Surface                            | Purpose                           |
| ---------------------------------- | --------------------------------- |
| `https://kalshistatus.dev/`        | Live dashboard                    |
| `/api/status`                      | JSON snapshot (latest)            |
| `/api/history?window=24h\|7d\|30d` | Recent snapshots                  |
| `/api/version`                     | Deployed `{version, commit}`      |
| `/badge.svg`                       | Shields.io-style status badge     |
| `/openapi.yaml`                    | OpenAPI 3.1 contract for `/api/*` |
| `/healthz`                         | `{ok: true, ts}` liveness probe   |

## Example: read live status

```bash
curl -s https://kalshistatus.dev/api/status \
  | jq '{status, exchange_active, trading_active,
         endpoints: [.endpoints[] | {name, status, latency_ms}]}'
```

```jsonc
{
  "status": "operational",
  "exchange_active": true,
  "trading_active": true,
  "endpoints": [
    { "name": "exchange_status", "status": "up", "latency_ms": 92 },
    { "name": "markets_list", "status": "up", "latency_ms": 64 },
    { "name": "events_list", "status": "up", "latency_ms": 92 },
    { "name": "series_list", "status": "up", "latency_ms": 305 },
  ],
}
```

Headline `status` is rolled up from the four public probes
(`exchange_status`, `markets_list`, `events_list`, `series_list`).

## What it monitors

- **REST endpoints**: `exchange_status`, `markets_list`, `events_list`,
  `series_list` — all public, no authentication required.
- **Exchange flags**: `exchange_active`, `trading_active`.
- **Uptime windows**: 24h / 7d / 30d, computed in SQL at read time.
- **Latency**: per-endpoint, with sparklines on the dashboard.

## Tech

Cloudflare Workers (TypeScript) · D1 · Cloudflare edge cache
(`caches.default`).

The whole stack runs on free tiers — see
[`CLAUDE.md`](CLAUDE.md) for the operating envelope.

## Docs

- **[Architecture](docs/ARCHITECTURE.md)** — components, cron timeline,
  probes, storage, edge caching, security headers, comparison with
  kalshistatus.com.
- **[Runbook](docs/runbook.md)** — provisioning, deploy, rollback, log
  tailing, D1 ops, troubleshooting recipes, cost posture, incident
  severity definitions.
- **[ADRs](docs/adr/)** — 15 architecture decision records covering
  every load-bearing choice in the stack.
- **[Incidents](incidents/)** — post-mortems.

## Develop

```bash
npm install
npm test               # 33 tests, runs against local miniflare
npm run dev            # wrangler dev — local Worker at localhost:8787
```

Before `npm run dev`, apply migrations locally (wrangler dev does not
auto-apply them):

```bash
npx wrangler d1 migrations apply kalshi_status --local
```

## Deploy

There is no automated deploy pipeline — the production stack was
decommissioned in ADR 0014 and the re-architecture is in progress.
Land changes via PR with green CI; never push directly to main. See the
[runbook](docs/runbook.md) for manual deploy and rollback steps.

## Author

[`@UnderMyBed`](https://github.com/UnderMyBed). Unofficial; not
affiliated with Kalshi.
