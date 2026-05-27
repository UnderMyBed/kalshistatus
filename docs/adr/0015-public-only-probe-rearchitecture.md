# 15. Re-architect as a public-only probe on the Workers free tier

Date: 2026-05-26

## Status

Accepted

Supersedes the operative parts of 0003 (KV read cache), 0004 (Workers AI
changelog), 0005 (RSA-PSS signing), 0006 & 0010 (multi-region probing),
0007 (Grafana Cloud), 0012 (cost-counter Durable Object), 0013 (WebSocket
multi-channel sampling), and partially 0009 (public/auth probe separation —
authenticated probes are removed entirely). Builds on 0014 (decommission).

## Context

The stack torn down in ADR 0014 failed for one root reason: scope. An
every-minute cron doing per-tick D1 + KV + Workers AI work exceeded the free
tier while the page still was not healthy. Multi-region never worked, the
authenticated-probe path made the headline permanently degraded on 401s, and a
Durable-Object "cost breaker" papered over a design that was over budget by
construction.

The mission is narrower than what was built: a public status and performance
page for the Kalshi API, for engineers — not an auth monitor, an AI changelog,
or a multi-region map. The two hard constraints are: it must stay on free
tiers, and it must be near-zero maintenance.

## Decision

Rebuild as a single Worker that, on a 5-minute Cron Trigger, probes only the
four public prod REST endpoints (`exchange_status`, `markets_list`,
`events_list`, `series_list`), rolls them into one status snapshot, and writes
exactly one row to D1. A daily cron prunes rows older than 30 days. All public
routes are served from the edge cache (`caches.default`), so request traffic
never writes to or reads through to D1 per request.

Removed entirely: authenticated `portfolio_*` probes (and therefore all API
keys and RSA-PSS signing), WebSocket sampling, the AI changelog and Atom feed,
multi-region probing, Grafana export, the prod/demo split, and the
cost-counter Durable Object.

## Consequences

- **Cost is bounded by construction**, not by a runtime breaker: 289 D1 writes
  per day and reads served from cache, far under every free-tier ceiling. The
  three cost-amplifier lessons (Cache-Control != edge cache; per-request writes;
  in-memory counters) are designed out, not guarded against.
- **Near-zero maintenance**: with no secrets, there is nothing to rotate. The
  401-degraded-headline footgun is structurally impossible.
- **Less capability**: no auth-path health, no live WebSocket metrics, no
  changelog. These return only with their own ADR justifying the
  maintenance/budget cost.
- **Data model reset**: the D1 schema is a single `snapshots` table; migrations
  were reset to a fresh `0001_init.sql` because ADR 0014 deleted the database
  and left no history to preserve.
- **Demo environment** is a documented fast-follow (public demo probes need no
  secrets) but is out of this change.
