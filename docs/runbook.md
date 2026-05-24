# Runbook

Operations for kalshistatus.dev. Update this file in the same commit
as any behavior change.

## Quick triage

| You see                                         | Look here first                                            |
| ----------------------------------------------- | ---------------------------------------------------------- |
| Site won't load                                 | `curl -sf https://kalshistatus.dev/healthz`                |
| Headline status wrong                           | `wrangler tail` for fast-cron output                       |
| `/api/status` stale by >5 min                   | KV write path stuck (us-east cron not landing) — see below |
| WS card shows `error: ...`                      | `wrangler tail` — the error string is the discriminant     |
| All `portfolio_*` show `no_credentials`         | Secret missing — `wrangler secret list`                    |
| All `portfolio_*` show `auth_build_failed: ...` | PEM is malformed — re-push                                 |
| Grafana dashboard empty                         | Push 401ing — see "Grafana push" below                     |
| CI red on a PR                                  | `gh run view <id> --log-failed`                            |

## Verify the site is healthy

```bash
curl -sf https://kalshistatus.dev/healthz | jq .ok           # → true

curl -sf "https://kalshistatus.dev/api/status?env=prod" \
  | jq '{status,
         exchange_active: .exchange.exchange_active,
         endpoint_count:  (.endpoints | length),
         auth_unknowns:   ([.endpoints[] | select(.requires_auth and .status=="unknown")] | length),
         ws_connected:    .ws_sample.connected,
         snapshot_age_s:  ((now * 1000 - .ts) / 1000 | floor)}'
```

A healthy snapshot has `endpoint_count: 8`, `auth_unknowns: 0`,
`snapshot_age_s` under 120, and either `ws_connected: true` with
non-zero channel rates or a specific `ws_sample.error`.

## Observing the running Worker

### Primary surface: `wrangler tail`

Every probe-cycle exception and every `console.error` from the Worker
surfaces here. Use this **before** Grafana for any in-the-moment
diagnostic.

```bash
npx wrangler tail kalshi-status --format pretty
```

What you should see, healthy:

```
"* * * * *" @ <ts> - Ok
CostCounter.check - Ok @ <ts>
GET https://kalshistatus.dev/api/status?env=prod - Ok @ <ts>
```

What you should not see, but might:

```
"* * * * *" @ <ts> - Exception Thrown
✘ [ERROR] <error class>: <message>
  → cron threw; no snapshot landed for this minute.
    Find the throwing line in the printed stack.

(error) grafana remote-write failed: 401
  → Grafana token wrong or expired (does not block probes).

(error) grafana remote-write failed: 5xx
  → Grafana is having a moment (does not block probes).
```

A `wrangler tail` session expires after ~6 hours; re-run if needed.
Filter by status with `--status error` to see only failures.

### Cloudflare dashboard

Workers & Pages → `kalshi-status` → Observability for a UI view of the
same logs, plus invocation count, error rate, and CPU time charts.

### Grafana Cloud dashboard

Public dashboard URL is in `wrangler.toml` as `PUBLIC_DASHBOARD_URL`
and linked from the site footer. Carries the metrics from
`src/grafana.ts:pushMetrics()`:

- `kalshi_status_up{environment}` — 1 / 0.5 / 0.25 / 0 / -1
- `kalshi_exchange_active`, `kalshi_trading_active`
- `kalshi_endpoint_latency_ms{environment,endpoint}`
- `kalshi_endpoint_up{environment,endpoint}`

If the dashboard looks empty for hours, the push is probably failing
(see below).

## Deploy

Pushes to `main` trigger `.github/workflows/deploy.yml`:

```
1. checkout
2. setup node, npm ci
3. npx wrangler d1 migrations apply kalshi_status --remote
4. npx wrangler deploy
```

There is no staging — production deploys on every merge.

To watch a deploy land:

```bash
gh run list --workflow=deploy.yml --limit 3
gh run watch <run-id>            # follow live
npx wrangler tail kalshi-status  # confirm next cron tick runs clean
```

After deploy, the **next cron tick** is the real verification — not the
deploy succeeding. A green deploy + a thrown exception in the next
fast cron is a regression. Watch for at least one full cron cycle in
the tail before walking away.

## Rollback

```bash
npx wrangler deployments list --name kalshi-status | head -20

# Pick the previous-good version UUID, then:
npx wrangler rollback <version-uuid> --name kalshi-status
```

After rollback, **also revert the code on `main`**. Open a `fix:` PR
that reverts the offending change so production matches the repo. A
rollback without a revert leaves production on code that the repo no
longer reflects, and the next push to `main` will undo the rollback.

## Secrets

| Name                          | Source                          | Required for                   |
| ----------------------------- | ------------------------------- | ------------------------------ |
| `KALSHI_PROD_KEY_ID`          | Kalshi web UI                   | Authed REST + WS probes (prod) |
| `KALSHI_PROD_PRIVATE_KEY_PEM` | `.key` file from Kalshi         | Same                           |
| `KALSHI_DEMO_KEY_ID`          | Demo Kalshi web UI              | Authed probes (demo)           |
| `KALSHI_DEMO_PRIVATE_KEY_PEM` | `.key` file from demo           | Same                           |
| `GRAFANA_API_TOKEN`           | Grafana Cloud → Access Policies | Prometheus push                |
| `CLOUDFLARE_API_TOKEN`        | Cloudflare → API Tokens         | GitHub Actions deploy          |

### List configured secrets

```bash
npx wrangler secret list
```

Returns the names but not the values. Compare against the table above.
**Common bug**: a secret pushed under a name that doesn't match what
the code reads (e.g. `KALSHI_PROD_PRIVATE_KEY` vs
`KALSHI_PROD_PRIVATE_KEY_PEM`) silently degrades to
`status: "unknown", error: "no_credentials"`.

### Rotate a Kalshi key

```bash
# 1. Generate new key in the Kalshi web UI; download the .key file.
# 2. Push it (paste the key-id string when prompted, or pipe the file):

wrangler secret put KALSHI_PROD_KEY_ID --name kalshi-status
wrangler secret put KALSHI_PROD_PRIVATE_KEY_PEM --name kalshi-status \
  < /path/to/kalshi-prod.key

# 3. Watch the next cron tick:
npx wrangler tail kalshi-status

# Healthy: `"* * * * *" Ok`, no `atob` or `auth_build_failed` errors.
# 4. Verify:
curl -s "https://kalshistatus.dev/api/status?env=prod" \
  | jq '.endpoints[] | select(.requires_auth) | {name, status, http_status}'
# Expect: all `status: "up"` once a us-east cron tick has landed.

# 5. Revoke the old key in the Kalshi UI.
```

### Rotate the Grafana token

```bash
# 1. In Grafana Cloud → Administration → Access Policies, create a new
#    policy or add a token to the existing kalshistatus policy with
#    scope: metrics:write.
# 2. Push:
wrangler secret put GRAFANA_API_TOKEN --name kalshi-status

# 3. Watch the next cron tick — `grafana remote-write failed: 401`
#    should stop appearing in `wrangler tail`.
# 4. Verify metric flow in the public Grafana dashboard within ~2 min.
# 5. Delete the old token in Grafana.
```

### Rotate the CI deploy token

```bash
# 1. Cloudflare → My Profile → API Tokens → create token with scopes:
#    Account.Workers Scripts:Edit, Account.D1:Edit,
#    Account.Workers KV Storage:Edit, Account.Workers AI:Edit,
#    Zone.Workers Routes:Edit (for kalshistatus.dev zone).
# 2. gh secret set CLOUDFLARE_API_TOKEN
# 3. Trigger a no-op deploy to verify:
gh workflow run deploy.yml
```

**Never** commit secrets to the repo. **Never** run
`wrangler secret put` from CI or any automation.

## Cost controls

### Configured

- Cloudflare billing usage alert at $1 projected month-end
- Bot Fight Mode (zone setting)
- WAF Managed Rules (free baseline)
- Runtime cost circuit breaker (`src/cost-counter-do.ts`):
  soft 80k req/day, hard 95k req/day → 503 with `Retry-After: 3600`
- Edge caching on every public route (`caches.default`)
- KV write-on-change for snapshots
- 7-day region-probe retention, 90-day snapshot retention

### Known gaps (free-plan limitations)

- Workers daily-usage notification — CF Notifications UI churn; revisit
- Workers spend cap — not available on free Workers plan
- Rate limiting rules — free zone allows 1 rule. Priority order when
  upgraded:
  1. `/api/*` — 60 req/min/IP
  2. `/badge.svg` — 120 req/min/IP
  3. `/embed` — 120 req/min/IP
  4. `*` — 600 req/min/IP (catchall)
- Daily usage digest email

### Inspecting the circuit breaker

```bash
# Cloudflare dashboard → Workers → kalshi-status → Durable Objects →
# CostCounter. Click into the instance; the SQLite table shows the
# per-day count.
```

Or via tail:

```bash
npx wrangler tail kalshi-status --format pretty | grep -i cost
```

## D1 operations

Migrations:

```bash
# All migrations run automatically on deploy.
# Manual apply (e.g. for a back-filled migration):
npx wrangler d1 migrations apply kalshi_status --remote
```

Inspect data (read-only, ask before running in prod):

```bash
npx wrangler d1 execute kalshi_status --remote \
  --command "SELECT COUNT(*) FROM snapshots WHERE environment='prod'"
```

Backup before any destructive op:

```bash
npx wrangler d1 export kalshi_status --remote \
  --output backup-$(date +%Y%m%d).sql
```

Retention is enforced by `runSlowCron` (`* * * * *`):

- `snapshots`: 90 days (env var `SNAPSHOT_RETENTION_DAYS`)
- `region_probes`: 7 days (hard-coded in `cron.ts`)

To change retention, update `wrangler.toml` `[vars]` and document
the why in an ADR.

## KV operations

```bash
npx wrangler kv key list --binding KALSHI_KV --remote        # ~6 keys
npx wrangler kv key get latest:prod --binding KALSHI_KV --remote | jq .ts
```

If `latest:prod` is stale by >5 minutes:

- The us-east cron path hasn't landed recently. Cron is dispatched to
  one colo per tick; KV is only written when that colo maps to
  `us-east` (per `src/regions.ts`).
- Check `/api/history` instead — D1 is written from every region and
  is the source of truth even when KV is stale.

## Force a cache refresh

Every public route is cached at the edge via `caches.default`. To
bust without waiting for TTL, hit a unique URL once:

```bash
curl -s "https://kalshistatus.dev/api/status?env=prod&_bust=$(date +%s)" >/dev/null
```

The cache key includes all query params (sorted), so any unique
`_bust=` value gives a miss → handler → fresh response → cached.

## Troubleshooting recipes

### "All `portfolio_*` endpoints show `status: unknown, error: no_credentials`"

The relevant secrets are missing. Verify:

```bash
npx wrangler secret list | jq '.[].name' | grep -i KALSHI
```

If `KALSHI_PROD_KEY_ID` or `KALSHI_PROD_PRIVATE_KEY_PEM` is absent,
push them. If the names are present but the symptom persists, the code
may be reading a different env var name — `git grep KALSHI_PROD` in
`src/` to confirm. (Historical incident: PR #39 fixed a mismatch where
the code was reading `KALSHI_PROD_PRIVATE_KEY` but the secret was
stored as `KALSHI_PROD_PRIVATE_KEY_PEM`.)

### "All `portfolio_*` endpoints show `status: down, error: auth_build_failed: ...`"

The secret exists but the PEM body can't be parsed. The error string
after `auth_build_failed:` is the discriminant:

- `atob() called with invalid base64-encoded data` — PEM body has
  non-base64 characters after stripping BEGIN/END. Re-push the secret
  from the raw `.key` file using stdin: `wrangler secret put NAME < file`.
- `key import failed` — the parsed DER is not a valid PKCS8 key.
  Confirm the key file is PKCS8 (`openssl rsa -in file -text -noout`),
  not PKCS1.

The cron isolates these failures per probe since PR #42, so public
probes and snapshots continue.

### "`ws_sample.error = upgrade_failed_401`"

WS auth is being rejected. Same root cause family as REST auth:
secret missing or wrong, signing message format mismatch, or key
revoked upstream. Cross-check with the REST authed probes — if those
are `up` but WS is 401, suspect a path-signing mismatch in
`src/ws-sampler.ts` (signed path should be `/trade-api/ws/v2`, no
query string).

### "Cron isn't firing (D1 history stops growing)"

```bash
npx wrangler tail kalshi-status --format pretty
# Wait ~70 seconds — you should see "* * * * *" land at least once.
```

If no cron lands:

1. Cloudflare dashboard → Workers → `kalshi-status` → Triggers.
   Confirm both `* * * * *` and `0 * * * *` are listed.
2. If they're missing, the most recent deploy stripped them.
   `wrangler.toml` `[triggers] crons = [...]` must be set; redeploy.

If cron lands but throws:

1. Tail shows `"* * * * *" - Exception Thrown` followed by an error
   class and message.
2. Find the throwing line in the printed stack.
3. Common throws: PEM parse (`atob()`), missing env var (read of
   undefined), Workers AI quota exceeded.

### "Grafana dashboard is empty"

```bash
npx wrangler tail kalshi-status --format pretty | grep grafana
# Look for "grafana remote-write failed: <status>"
```

- `401` — token bad/expired. Rotate (see "Rotate the Grafana token").
- `403` — token has wrong scopes; needs `metrics:write` on the right
  Cloud Access Policy.
- `4xx` other — likely the body format is wrong (Grafana Cloud
  Prometheus expects snappy-encoded protobuf; if the push code was
  changed to plain exposition format, it'll 400).
- `5xx` — Grafana having a moment; usually self-resolves.

Cron data writes to D1/KV are unaffected by Grafana failures.

### "Headline status is wrong"

`status` is derived from public probes only (see
[ARCHITECTURE.md](ARCHITECTURE.md#status-determination-headline)). A
401 on `portfolio_balance` should not cause `degraded`. If it does,
the determination logic has regressed — check `src/status.ts` and the
`requires_auth` filter.

### "Site shows `unknown` for everything"

Either:

- KV `latest:<env>` has never been written (fresh deploy, no us-east
  cron has landed yet) — check `/api/history` directly.
- The Worker is returning a fallback before reading KV (rare; check
  `src/api.ts:handleApiStatus`).

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
curl -sf "https://kalshistatus.dev/api/status?env=prod" | jq \
  '{status, exchange_active: .exchange.exchange_active,
    endpoints: (.endpoints | length),
    auth_up: ([.endpoints[] | select(.requires_auth and .status=="up")] | length),
    ws_connected: .ws_sample.connected}'
# Expect: status in {operational,degraded,partial_outage}, endpoints == 8,
#         auth_up == 4 (after a us-east cron tick has landed),
#         ws_connected == true (or a specific ws_sample.error)

# 3. Demo
curl -sf "https://kalshistatus.dev/api/status?env=demo" | jq '.status'

# 4. Badge
curl -sI "https://kalshistatus.dev/badge.svg" | grep -i content-type
# Expect: image/svg+xml

# 5. History
curl -sf "https://kalshistatus.dev/api/history?env=prod&limit=5" | jq 'length'
# Expect: 5

# 6. Security headers
curl -sI https://kalshistatus.dev/ \
  | grep -iE 'strict-transport-security|content-security-policy|x-frame-options'
# Expect: all three present, max-age >= 31536000
```

## See also

- [ARCHITECTURE.md](ARCHITECTURE.md) — what the system does and why
- [ADRs](adr/) — decision records
- [Incidents](../incidents/) — post-mortems
- [`CLAUDE.md`](../CLAUDE.md) — operating-envelope constraints
