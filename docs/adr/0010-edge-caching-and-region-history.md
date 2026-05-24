# 10. Edge caching for hot routes; region-probe history schema

Date: 2026-05-24

## Status

Accepted

## Context

The audit surfaced three connected issues:

1. **Cache-Control headers do nothing on Workers responses.** Workers
   responses bypass the Cloudflare CDN cache unless you explicitly use
   `caches.default.put()`. The `Cache-Control: public, max-age=30` we were
   sending was advisory to clients only. Every hit to `/api/status` ran
   the worker (1 KV read + 1 D1 read + 1 D1 write per request). At
   100k req/day this is squarely against the free-tier envelope.

2. **`extractExchangeStatus()` double-fetched `/exchange/status` every
   cron tick.** The probe loop already fetched it; the status extraction
   then fetched it again — without auth headers, so the fallback path was
   taken whenever Kalshi added auth requirements. Doubled the outbound
   request count on the hottest endpoint.

3. **`region_probes` PRIMARY KEY was `(environment, region)`** — only 3
   rows per environment, ever. The "region probe history" the dashboard
   needs literally couldn't exist. Every save overwrote the last row.

## Decision

**Edge caching** via `caches.default`:

- `src/edge-cache.ts` exposes `buildCacheKey()`, `readCache()`,
  `writeCache()`, `withCacheHit()`.
- The cache key is the canonical URL with sorted query params (no
  synthetic hostname; preserves the request's origin so `Cache-Control`
  semantics are predictable).
- TTLs per route: `/api/status` 15s, `/api/history` 60s, `/api/changelog`
  300s, `/api/version` 300s, `/badge.svg` 60s, `/feed.xml` 600s.
- The wrapper sets `X-Cache: HIT` on served responses to make the cache
  observable during incident response.

**Single exchange fetch**: `probeEndpoint()` now returns
`{ probe, body }`. For JSON responses on successful probes it parses the
body once. The cron uses `outcomes.find(o => o.probe.name ===
'exchange_status').body` as the input to a new sync
`exchangeStatusFromBody()` — no second fetch.

**Region-probe schema** (`migrations/0004_region_probes_history.sql`):

- PK changes to `(environment, region, probed_at)` so rows accumulate
  over time. `runSlowCron` prunes anything older than 7 days.
- `loadRecentRegionProbes()` adds `GROUP BY region` so the public API
  still returns one row per region (the most recent), backwards
  compatible with the existing UI.
- `saveRegionProbePresence()` is gone entirely (the per-request D1
  writes from the audit are gone with it).

## Alternatives considered

- **Cloudflare Cache Rules** (dashboard-configured) instead of the Cache
  API. Rejected: needs paid Workers to interact correctly with custom
  domain Workers, and config-as-code is preferred — having TTL live in
  source-controlled code is part of the operational story.
- **KV instead of Cache API** for the API responses. Rejected: KV is
  not designed for short-lived high-volume reads, and the daily-write
  cap (1k free) is much lower than the workers daily-request cap (100k
  free). Using KV would just move the bottleneck.
- **Keep region_probes overwrite semantics** and add a parallel
  `region_probes_history` table. Rejected: two tables to keep in sync
  is worse than one with an index. The pre-change "history" was zero
  rows.
- **Read exchange body from the probe response in `extractExchangeStatus`
  via `Response.clone()`**. Rejected: would require threading the
  Response through the type system; making `probeEndpoint` return
  `{probe, body}` is cleaner and lets future probes opt into body
  capture too.

## Consequences

- `/api/status` now serves cached responses to >90% of requests at the
  edge. KV/D1 read load drops by ~95% for traffic at typical
  patterns. The 15s TTL is acceptable for a status page; the underlying
  cron is 60s.
- Existing region_probes rows are wiped on deploy (DROP TABLE in the
  migration). The data is short-lived (60 min freshness window) so this
  is a one-tick refill. Documented in the migration file.
- Cache hits return `X-Cache: HIT` — operators can `curl -I` to verify
  caching during incidents.
- Test suites in `api.test.ts` must now clear specific cache keys in
  `beforeEach` because `caches.default` persists across `it()` blocks.
  A `CACHEABLE_TEST_URLS` constant lists them; new cacheable routes must
  be added here too.
- `extractExchangeStatus()` is gone. `exchangeStatusFromBody()` replaces
  it (no fetch, takes parsed body as input). Tests updated.
- The runtime cost circuit breaker
  ([[0009-public-auth-probe-separation]]) is still per-isolate; this PR
  does not address that — the next ADR will migrate it to a Durable
  Object.
