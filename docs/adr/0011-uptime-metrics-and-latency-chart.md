# 11. Uptime metrics + latency chart on the dashboard

Date: 2026-05-24

## Status

Accepted

## Context

A status page without an **uptime percentage** is unusual; a portfolio-grade
status page without one reads as half-finished. The audit also called out
the lack of any latency time-series and the use of a 660-line inline
`<style>` block that defeats browser caching for the home page.

## Decision

**Uptime**: a new D1 table `uptime_metrics` holds one row per
`(environment, window_hours)`. The slow cron (`0 * * * *`) computes
24h/7d/30d windows for both prod and demo (six rows total) using a single
aggregate SQL query per window:

```sql
SELECT COUNT(*) AS total_count,
       SUM(CASE WHEN json_extract(payload, '$.status')
            IN ('operational', 'degraded') THEN 1 ELSE 0 END) AS ok_count
FROM snapshots WHERE environment = ? AND ts >= ?
```

`/api/status` reads the six rows in one query and attaches them to the
response. The dashboard renders the three percentages as the right-aligned
banner content, color-coded by SLO bucket (≥99.9% green, ≥99% yellow,
otherwise red).

**Uptime definition**: `operational` and `degraded` count as "up";
`partial_outage`, `major_outage`, and `unknown` count as "down." Rationale:
"degraded" still means the API is usable for most integrations — counting
it as outage would punish the SLO for minor portfolio-only auth blips.

**Latency chart**: an SVG line chart rendered client-side from
`/api/history?limit=1440`. Each data point is the mean latency across all
public endpoints in that snapshot. Computed in `public/app.js` —
zero server-side work, zero JS dependencies. Y-axis auto-scales to the
nearest 100 ms; x-axis labels at quarter points (UTC).

**CSS extraction**: `public/index.html`'s inline `<style>` block (660
lines) moves to `public/style.css` served via `[assets]`. The embed
keeps its inline style — single self-contained widget is preferable
there.

## Alternatives considered

- **Compute uptime on every `/api/status` read**. Rejected: scanning ~1440
  snapshot rows per read × ~4 cold-cache reads/min × 86400 sec/day puts
  us over D1's 5M-reads/day free tier. Hourly precompute is six writes
  per hour — well inside both write and read caps.
- **`degraded` counts as 0.5 up**. Rejected: more complex to explain on
  the page, doesn't change the headline number much (we rarely sit at
  exactly degraded for long).
- **Latency chart as a server-side SVG endpoint**. Rejected: another
  D1-reading endpoint to cache and rate-limit. Client-side from
  `/api/history` (already cached) is cleaner.
- **Multi-line chart per endpoint**. Rejected: visual noise at 8
  endpoints. A single "mean public latency" line tells the story; the
  per-endpoint sparklines in the Endpoints section provide the breakdown.

## Consequences

- The headline number every visitor sees is now an uptime percentage —
  matches reader expectations for a status page.
- Six new D1 writes per hour, six new reads per cache miss. Well inside
  the free tier.
- `uptime_metrics` is a new D1 table — migration `0005_uptime_metrics.sql`.
  Empty on first run; the slow cron populates it within an hour. The
  dashboard hides the uptime block until data exists (graceful, not
  defensive — the field is genuinely absent until first cron).
- `Snapshot` type gains an optional `uptime?: UptimeMetrics` field.
- `public/style.css` exists as a separate cacheable asset. First-load
  for `/` now has a stylesheet request, but the file is cacheable across
  visits and embedded font preloads keep LCP ≤300 ms.
- The latency chart in `public/app.js` is ~80 lines of vanilla SVG —
  no chart library, no external dependency.
