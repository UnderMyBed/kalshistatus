# Runbook

## Health check

```bash
curl https://kalshistatus.dev/healthz
# {"ok":true,...}
```

## Checking status

```bash
curl https://kalshistatus.dev/api/status?env=prod
```

## Logs

Cloudflare Workers dashboard → kalshi-status → Logs

## Alerts

Workers Observability is enabled with head_sampling_rate=1.0. Errors surface in the CF dashboard.

## Cost controls — current posture & follow-ups

### Configured

- Billing usage alert at $1 projected month-end (Cloudflare dashboard)
- Bot Fight Mode enabled
- WAF Managed Rules (free baseline)
- Runtime cost circuit breaker (see `src/cost-control.ts`): soft 80K req/day, hard 95K req/day

### Not yet configured (free plan limitations)

- Workers daily-usage notification: CF Notifications UI changed; revisit when stable
- Workers spend cap: not available on free Workers tier
- Rate limiting rules: free plan allows 1 rule; priority order when upgraded:
  1. `/api/*` — 60 req/min/IP
  2. `/badge.svg` — 120 req/min/IP
  3. `/embed` — 120 req/min/IP
  4. `*` — 600 req/min/IP (catchall)
- Daily usage digest email

### Primary defense

Runtime circuit breaker in `src/cost-control.ts` is the main protection until rate limiting rules are configured.

## Incidents

See `incidents/` directory for post-mortems.
