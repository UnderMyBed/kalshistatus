# 14. Decommission production stack pending re-architecture

Date: 2026-05-24

## Status

Accepted

## Context

The deployed stack was simultaneously (a) exceeding Cloudflare free-tier
limits and (b) not serving a working status page. The every-minute cron
(`* * * * *`) combined with per-tick D1/KV/AI work pushed daily usage past
the ceilings the project is contractually bound to stay under (see
`CLAUDE.md` "Operating envelope"), while the public site was still not
healthy. Continuing to run a broken, over-budget stack costs money and
masks the design problems behind day-to-day operational noise.

The decision was made to take the stack fully offline and re-plan the
architecture rather than keep patching the live deployment.

## Decision

Tear down the deployed stack completely and stop all automated deploys:

- Deleted the `kalshi-status` Worker (removes its `kalshistatus.dev` /
  `www.kalshistatus.dev` custom-domain routes, both cron triggers, and the
  `CostCounter` Durable Object).
- Deleted the D1 database `kalshi_status` and the KV namespace
  `KALSHI_KV` — all historical snapshot/probe data is gone.
- Removed `.github/workflows/deploy.yml` so pushes to `main` no longer
  attempt a production deploy.

The application code, `wrangler.toml`, and the rest of CI (`ci.yml`,
`release-please.yml`) are retained unchanged. The repo remains the source
of truth for the re-architecture.

## Alternatives considered

- **Keep the Worker, strip crons + routes** — leaves a deployed shell and
  the bindings live; doesn't actually take the stack off the free-tier
  meter cleanly, and invites confusion about whether the site is "up."
  Rejected: a half-deployed stack is worse than none while we re-plan.
- **Keep D1/KV data, delete only the Worker** — preserves history for the
  re-arch. Rejected by the operator: the re-architecture is expected to
  change the data model, so the old snapshots have little forward value
  and retaining them is needless surface.
- **Gate `deploy.yml` to `workflow_dispatch` instead of deleting it** —
  keeps the pipeline one click away. Rejected: the deploy steps reference
  resources that no longer exist (`d1 migrations apply kalshi_status`),
  so the workflow is dead until the re-arch rebuilds it anyway.

## Consequences

- Code-level: no code changes; `wrangler.toml` still references the now
  deleted `DB`, `KALSHI_KV`, and `COST_COUNTER` bindings — any future
  deploy must re-create those resources (or be re-architected) first.
- Operational: the site at `kalshistatus.dev` is offline. Nothing consumes
  free-tier quota. The runbook's Deploy/Rollback/D1/KV/secret-rotation
  procedures are inert until a new stack is stood up. The `kalshistatus.dev`
  DNS records remain in the zone, now pointing at no Worker.
- Future-facing: a clean slate for the re-architecture. The prior design's
  ADRs (1–13) remain as the record of what was tried; this ADR marks the
  line where that deployment ended. The re-arch should open a fresh ADR for
  its target design rather than amending the old ones.
