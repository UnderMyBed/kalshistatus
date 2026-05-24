# ADR-0002: D1 for persistent snapshot storage

**Status:** Accepted

## Context

Need to retain 90 days of API probe snapshots for the history endpoint and trend analysis.

## Decision

Use D1 (Cloudflare's SQLite-backed database). Schema: `snapshots(ts, environment, payload)` with index on `(environment, ts DESC)`.

## Consequences

- SQL queries for time-range history
- 90-day retention enforced by slow cron DELETE
- D1 free tier: 5M reads/day, 100K writes/day — sufficient at 1 write/min per environment
