# Runbook

Operations for kalshistatus.dev. Update this file in the same commit
as any behavior change.

## Quick triage

| You see                        | Look here first                                        |
| ------------------------------ | ------------------------------------------------------ |
| Site won't load                | `curl -sf https://kalshistatus.dev/healthz`            |
| Headline status wrong          | `wrangler tail` for probe-cron output                  |
| `/api/status` stale by >10 min | Edge cache TTL expired and cron not landing — see below |
| CI red on a PR                 | `gh run view <id> --log-failed`                        |

## Provisioning

Run once when standing up a new deployment:

```bash
# 1. Create the D1 database:
npx wrangler d1 create kalshi_status

# 2. Paste the returned database_id into wrangler.toml under [d1_databases].

# 3. Apply migrations to production:
npx wrangler d1 migrations apply kalshi_status --remote

# 4. Deploy the Worker:
npx wrangler deploy
```

For **local development**, apply migrations locally before starting the
dev server — wrangler dev does not auto-apply migrations or auto-run
scheduled crons:

```bash
npx wrangler d1 migrations apply kalshi_status --local
npm run dev
```

To manually trigger a cron in local dev, use the `/__scheduled` path
(wrangler dev exposes this):

```bash
curl "http://localhost:8787/__scheduled?cron=*/5+*+*+*+*"
```

## Verify the site is healthy

```bash
curl -sf https://kalshistatus.dev/healthz | jq .ok           # → true

curl -sf "https://kalshistatus.dev/api/status" \
  | jq '{status,
         exchange_active: .exchange_active,
         trading_active:  .trading_active,
         endpoint_count:  (.endpoints | length),
         snapshot_age_s:  ((now * 1000 - .ts) / 1000 | floor)}'
```

A healthy snapshot has `endpoint_count: 4`, `snapshot_age_s` under 300
(5 minutes), and `status` in `{operational, degraded, partial_outage,
major_outage}`.

## Observing the running Worker

### Primary surface: `wrangler tail`

Every probe-cycle exception and every `console.error` from the Worker
surfaces here. Use this for any in-the-moment diagnostic.

```bash
npx wrangler tail kalshi-status --format pretty
```

What you should see, healthy:

```
"*/5 * * * *" @ <ts> - Ok
GET https://kalshistatus.dev/api/status - Ok @ <ts>
```

What you should not see, but might:

```
"*/5 * * * *" @ <ts> - Exception Thrown
✘ [ERROR] <error class>: <message>
  → cron threw; no snapshot landed for this tick.
    Find the throwing line in the printed stack.
```

A `wrangler tail` session expires after ~6 hours; re-run if needed.
Filter by status with `--status error` to see only failures.

### Cloudflare dashboard

Workers & Pages → `kalshi-status` → Observability for a UI view of the
same logs, plus invocation count, error rate, and CPU time charts.

## Deploy

There is no automated deploy pipeline (see [ADR 0014](adr/0014-decommission-stack.md)).
Land changes via PR with green CI, then deploy manually:

```bash
npx wrangler d1 migrations apply kalshi_status --remote  # if schema changed
npx wrangler deploy
```

After deploy, the **next cron tick** is the real verification — not the
deploy succeeding. Watch `wrangler tail` for at least one full cron
cycle before walking away.

## Rollback

```bash
npx wrangler deployments list --name kalshi-status | head -20

# Pick the previous-good version UUID, then:
npx wrangler rollback <version-uuid> --name kalshi-status
```

After rollback, **also revert the code on `main`**. Open a `fix:` PR
that reverts the offending change so production matches the repo. A
rollback without a revert leaves production on code that the repo no
longer reflects, and the next manual deploy will undo the rollback.

No D1 schema rollback is needed unless the deploy included a migration;
if it did, assess whether a compensating migration is required or
whether the old code is compatible with the new schema.

## Schedule

| Cron             | What it does                                    |
| ---------------- | ----------------------------------------------- |
| `*/5 * * * *`    | Probe 4 public REST endpoints, write 1 D1 row   |
| `0 0 * * *`      | Prune `snapshots` rows older than 30 days       |

Retention is 30 days (`SNAPSHOT_RETENTION_DAYS` in `wrangler.toml`
`[vars]`). To change it, update the var and document the reason in an
ADR.

## Cost

Budget is by-construction:

- ≈288 D1 writes/day (one per probe tick at 5-minute intervals)
- Public reads served from `caches.default` — no per-request D1 access
- No secrets, no KV, no Durable Objects, no Workers AI

There is no runtime cost breaker. The design does not need one: 288
writes/day is far under the 100k/day free-tier ceiling, and reads are
served from cache without touching D1.

Cloudflare protections still in place:

- Billing usage alert at $1 projected month-end (zone setting)
- Bot Fight Mode (zone setting)
- WAF Managed Rules (free baseline)
- Edge caching on every public route (`caches.default`)

## D1 operations

Inspect data (read-only):

```bash
npx wrangler d1 execute kalshi_status --remote \
  --command "SELECT COUNT(*) FROM snapshots"

npx wrangler d1 execute kalshi_status --remote \
  --command "SELECT ts, status FROM snapshots ORDER BY ts DESC LIMIT 5"
```

Backup before any destructive operation:

```bash
npx wrangler d1 export kalshi_status --remote \
  --output backup-$(date +%Y%m%d).sql
```

## Force a cache refresh

Every public route is cached at the edge via `caches.default`. To
bust without waiting for TTL, hit a unique URL once:

```bash
curl -s "https://kalshistatus.dev/api/status?_bust=$(date +%s)" >/dev/null
```

The cache key includes all query params (sorted), so any unique
`_bust=` value gives a miss → handler → fresh response → cached for
subsequent requests.

## Troubleshooting recipes

### "Cron isn't firing (D1 history stops growing)"

```bash
npx wrangler tail kalshi-status --format pretty
# Wait ~5-6 minutes — you should see "*/5 * * * *" land at least once.
```

If no cron lands:

1. Cloudflare dashboard → Workers → `kalshi-status` → Triggers.
   Confirm both `*/5 * * * *` and `0 0 * * *` are listed.
2. If they're missing, the most recent deploy stripped them.
   `wrangler.toml` `[triggers] crons = [...]` must be set; redeploy.

If cron lands but throws:

1. Tail shows `"*/5 * * * *" - Exception Thrown` followed by an error
   class and message.
2. Find the throwing line in the printed stack.
3. Common throws: missing env var (read of undefined), D1 write error.

### "Headline status is wrong"

`status` is derived from the four public probes. Check `src/status.ts`
for the determination logic. If all probes are returning `up` but
status shows something else, there is a logic regression — read the
snapshot directly:

```bash
npx wrangler d1 execute kalshi_status --remote \
  --command "SELECT ts, status, endpoints FROM snapshots ORDER BY ts DESC LIMIT 1"
```

### "Site shows stale data"

`/api/status` is cached for 15 s at the edge. If data is older than
~5 minutes, the probe cron has stopped writing — check `wrangler tail`.
If the cron is healthy and the snapshot is fresh but the API is serving
old data, the edge cache may be stuck — force a cache miss with a
unique `_bust=` param (see above).

### "D1 rows not being pruned"

Verify the daily cron has fired recently:

```bash
npx wrangler tail kalshi-status --format pretty | grep "0 0"
```

If the prune cron is not appearing, check `wrangler.toml` triggers as
above. To manually trigger a prune in local dev:

```bash
curl "http://localhost:8787/__scheduled?cron=0+0+*+*+*"
```

## Incidents

Post-mortems live in `incidents/YYYY-MM-DD-slug.md`. Use
[`incidents/0000-template.md`](../incidents/0000-template.md) as a
starting point.

Severity:

- **SEV-1** — Site down, or wrong data shown to all users
- **SEV-2** — Subset of users affected, or single component degraded
- **SEV-3** — Internal monitoring fired, no user impact

For SEV-1, **fix forward or roll back first, then write the
post-mortem**. The post-mortem should answer: timeline (UTC),
contributing factors, what was tried, what worked, what we'd change.

## Acceptance smoke tests

Run after any deploy that touches the cron, probe, or API code paths:

```bash
# 1. Liveness
curl -sf https://kalshistatus.dev/healthz | jq '.ok'             # → true

# 2. Status shape
curl -sf "https://kalshistatus.dev/api/status" | jq \
  '{status, exchange_active, trading_active,
    endpoints: (.endpoints | length)}'
# Expect: status in {operational,degraded,partial_outage,major_outage},
#         endpoints == 4

# 3. Badge
curl -sI "https://kalshistatus.dev/badge.svg" | grep -i content-type
# Expect: image/svg+xml

# 4. History (24h window)
curl -sf "https://kalshistatus.dev/api/history?window=24h" | jq 'length'
# Expect: > 0

# 5. Security headers
curl -sI https://kalshistatus.dev/ \
  | grep -iE 'strict-transport-security|content-security-policy|x-frame-options'
# Expect: all three present, max-age >= 31536000
```

## See also

- [ARCHITECTURE.md](ARCHITECTURE.md) — what the system does and why
- [ADRs](adr/) — decision records
- [Incidents](../incidents/) — post-mortems
- [`CLAUDE.md`](../CLAUDE.md) — operating-envelope constraints
