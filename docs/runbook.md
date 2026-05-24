# Runbook

Operational guide for kalshistatus.dev. Update this file in the same commit as
any behavior change.

## Health check

```bash
curl https://kalshistatus.dev/healthz
# {"ok":true,"ts":...}
```

## Checking status

```bash
curl https://kalshistatus.dev/api/status?env=prod | jq '.status, .endpoints[].name'
curl https://kalshistatus.dev/api/status?env=demo | jq '.status'
```

Headline `status` is derived **only from public endpoints**
(`exchange_status`, `markets_list`, `events_list`, `series_list`). The
`portfolio_*` endpoints are authenticated probes — they appear in the
`endpoints` array but do not roll up to the headline. If they all return
`unknown` with `error: "no_credentials"`, that means the relevant Kalshi key
secrets are missing, not that Kalshi is down.

## Logs

Cloudflare dashboard → Workers → `kalshi-status` → Logs (live tail) or
Observability tab.

Workers Observability is enabled with `head_sampling_rate=1.0`. Errors and
console output surface there directly.

## Cost controls — current posture & follow-ups

### Configured

- Billing usage alert at $1 projected month-end (Cloudflare dashboard)
- Bot Fight Mode enabled
- WAF Managed Rules (free baseline)
- Runtime cost circuit breaker (`src/cost-control.ts`): soft 80K req/day,
  hard 95K req/day
- All public routes hardened with security headers via `withSecurityHeaders()`
- Edge caching via `caches.default` on `/api/*`, `/badge.svg`, `/feed.xml`
  (see [ADR-0010](adr/0010-edge-caching-and-region-history.md)). Cache hits
  return `X-Cache: HIT`; `curl -sI` to verify during incidents.
- `region_probes` table prunes to 7 days in `runSlowCron`.

### Known gaps (free-plan limitations)

- Workers daily-usage notification: CF Notifications UI changed; revisit when
  stable
- Workers spend cap: not available on free Workers tier
- Rate limiting rules: free plan allows 1 rule; priority order when upgraded:
  1. `/api/*` — 60 req/min/IP
  2. `/badge.svg` — 120 req/min/IP
  3. `/embed` — 120 req/min/IP
  4. `*` — 600 req/min/IP (catchall)
- Daily usage digest email

### Primary defense

Runtime circuit breaker in `src/cost-control.ts` is the main protection until
rate-limiting rules are configured. **Known limitation**: the breaker is
per-isolate at the moment, which means it can underestimate request count
under high concurrency. Migration to a Durable Object is tracked in a
follow-up ADR.

## Rotating a secret

1. Generate the new value out-of-band.
2. Push to Cloudflare:
   ```bash
   echo -n "$NEW_VALUE" | wrangler secret put SECRET_NAME --name kalshi-status
   ```
3. If the secret is also stored in GitHub Actions (`CLOUDFLARE_API_TOKEN`),
   update there: `gh secret set CLOUDFLARE_API_TOKEN`.
4. Verify next deploy succeeds.

Never put secrets in `wrangler.toml`, `.env`, or any committed file.

## Rolling back a deploy

```bash
# Find the previous good deploy ID
wrangler deployments list --name kalshi-status | head -10

# Roll back
wrangler rollback <deploy-id> --name kalshi-status
```

After rollback, open a `fix:` PR to revert the offending change — never leave
production in a state that doesn't match `main`.

## D1 operations

- Schema migrations live in `migrations/` and are applied automatically on
  deploy (`npx wrangler d1 migrations apply kalshi_status --remote`).
- Manual query (read-only):
  ```bash
  wrangler d1 execute kalshi_status --remote --command "SELECT COUNT(*) FROM snapshots"
  ```
- Backup before destructive ops:
  ```bash
  wrangler d1 export kalshi_status --remote --output backup-$(date +%Y%m%d).sql
  ```

Snapshots are pruned at 90-day retention by `runSlowCron`. To change retention,
update `SNAPSHOT_RETENTION_DAYS` in `wrangler.toml` and document why in an ADR.

Region probes are pruned at 7-day retention by `runSlowCron`.

To force-refresh the edge cache after an incident fix:

```bash
# Cache-bust by appending a unique query param, then the next plain hit repopulates
curl -s "https://kalshistatus.dev/api/status?env=prod&_bust=$(date +%s)" >/dev/null
```

## Incidents

Post-mortems live in `incidents/YYYY-MM-DD-slug.md`. Use
`incidents/0000-template.md` as a starting point.

Severity definitions:

- **SEV-1** — Site is down or showing wrong data to all users
- **SEV-2** — Subset of users affected, or single component degraded
- **SEV-3** — Internal monitoring fired but no user impact

For SEV-1, fix forward or roll back **first**, then write the post-mortem.

## Acceptance tests

```bash
# Health check
curl -sf https://kalshistatus.dev/healthz | jq '.ok'
# true

# Prod status — must have >= 8 endpoints, exchange object
curl -sf "https://kalshistatus.dev/api/status?env=prod" \
  | jq '{status, exchange_active: .exchange.exchange_active, endpoint_count: (.endpoints | length)}'

# Demo status
curl -sf "https://kalshistatus.dev/api/status?env=demo" | jq '.status'

# Badge
curl -sI https://kalshistatus.dev/badge.svg | grep content-type

# History API
curl -sf "https://kalshistatus.dev/api/history?env=prod&limit=5" | jq 'length'

# Security headers present
curl -sI https://kalshistatus.dev/ | grep -E 'strict-transport-security|content-security-policy|x-frame-options'
```
