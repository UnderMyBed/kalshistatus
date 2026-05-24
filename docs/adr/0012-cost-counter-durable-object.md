# 12. Cost circuit breaker as a SQLite-backed Durable Object

Date: 2026-05-24

## Status

Accepted

## Context

The previous `CostController` kept its counter in per-isolate memory and
flushed to KV every 100 requests. The audit identified this as
fundamentally broken: Cloudflare runs many isolates concurrently, each
held an independent count, and the KV state lagged actual traffic
arbitrarily — by ~20 isolates × 99 un-persisted increments, the KV
counter could be ~2,000 requests behind reality. The 95,000-req/day hard
threshold was effectively unreachable under sustained burst.

This is the only line of defense after the rate-limiting gap (free
Cloudflare plan allows one rule, not yet configured), so accuracy
matters.

## Decision

Replace with a SQLite-backed Durable Object (`CostCounter`). One named
instance (`global`) is the single writer for the counter. Every
`check()` does one SQL `INSERT … ON CONFLICT DO UPDATE` and one
`SELECT` — atomic at the DO level. Free-tier compatible:
`new_sqlite_classes` migration in `wrangler.toml`; SQLite storage is on
the free Workers tier.

The DO holds:

```sql
CREATE TABLE daily_count (
  day   TEXT PRIMARY KEY,   -- ISO date "YYYY-MM-DD" UTC
  count INTEGER NOT NULL
);
```

`check()` upserts today's row (+1), reads the count, and prunes rows for
prior days. `getMode()` is read-only (no increment), used by the cron
handler to avoid double-counting cron runs against user-facing budget.

`CostController` is now a thin client over the DO stub: `idFromName` →
`get` → `check`/`getMode`. The Worker's `env.COST_COUNTER` binding
provides the namespace.

## Alternatives considered

- **Keep KV with per-request persist instead of per-100.** Rejected: KV
  writes are rate-limited (1k writes/day free), so per-request writes
  would exceed the budget at 1000 req/day — defeats the purpose.
- **Use D1 with `UPSERT`.** Rejected: D1 transactions are not
  single-writer; concurrent isolates could race on the same row. DO is
  the single-writer abstraction Workers provides.
- **Bigger isolate-local counter + smaller persist interval.** Rejected:
  this is the same broken design with a smaller error window. The fix
  is "atomic", not "less wrong."
- **Skip the breaker entirely and rely on Cloudflare's free-tier
  enforcement.** Rejected: CF enforces by rejecting requests at the
  edge with a 1027 error after the daily cap is hit, which is harsher
  UX than our 503 with a `Retry-After` header — and it gives us no
  in-band signal to log/alert on.

## Consequences

- Cost breaker is now correct under concurrency.
- New binding `COST_COUNTER` and migration `v1` (new_sqlite_classes:
  ["CostCounter"]) in `wrangler.toml`. The Worker now exports
  `CostCounter` from `src/index.ts` so it can be deployed.
- `Env.COST_COUNTER` typed as `DurableObjectNamespace<CostCounter>`.
- Old KV key `cost:daily_count` is orphaned; not actively cleaned up.
  Will TTL out (25h) on its own. No code reads it any more.
- Each `check()` is one DO roundtrip (~5-10ms warm, ~100ms cold). With
  the edge cache from [[0010-edge-caching-and-region-history]] absorbing
  most read traffic, the breaker only fires on actual handler runs.
- DO billing on free tier: SQLite-backed instances have 1GB storage and
  unlimited compute on the free tier (subject to overall Workers
  free-tier limits). Six rows of state, negligible. The DO request
  count counts toward the 100k/day Workers request cap — so each
  status-page hit that goes to the worker (cache miss) does two
  Workers requests (the main fetch + the DO call). At 95% cache hit
  rate, this halves remaining budget vs. cached requests, but cache
  rate would have to be lower than 10% for the DO to become the
  bottleneck.
- Tests in `test/cost-control.test.ts` updated to use
  `runInDurableObject` to seed counter state.
