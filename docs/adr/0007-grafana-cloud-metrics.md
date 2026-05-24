# ADR-0007: Grafana Cloud Free for metrics and observability

**Status:** Accepted

## Context

Need a public dashboard showing historical API performance without hosting infrastructure.

## Decision

Push Prometheus metrics to Grafana Cloud Free via remote_write in the slow cron (`0 * * * *`). Provision a public dashboard. Store the public URL in `PUBLIC_DASHBOARD_URL` wrangler var.

## Consequences

- Free tier: 10K series, 50GB logs, 14-day retention
- One public unauthenticated dashboard URL
- Push-based (no inbound firewall holes needed)
