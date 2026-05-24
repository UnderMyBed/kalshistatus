# ADR-0006: Multi-region active probing strategy

**Status:** Accepted

## Context

API latency varies by region. Engineers in different geographies see different performance.

## Decision

Probe from three Cloudflare regions: us-east (canonical, writes to KV + D1), eu-west, asia (D1 only). The fast cron (`* * * * *`) triggers probes; each region's Worker instance records its own measurements.

## Consequences

- Regional latency data in every snapshot
- us-east result is authoritative for overall status
- eu-west and asia may lag by up to 1 minute if their crons fire slightly after us-east
