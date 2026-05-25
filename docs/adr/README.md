# Architecture Decision Records

ADRs capture the _why_ behind a structural decision: the context, the
options considered, the choice, and the consequences. They're the
durable artifact a CLAUDE.md rule, runbook section, or code comment
can't be.

## When to write one

Per `CLAUDE.md`'s "Docs are part of the change" rule, write a new ADR
when a change introduces:

- A new architectural component (binding, service, durable object)
- A new cross-cutting concern (caching, auth, rate limiting)
- A new operating constraint (free-tier ceiling, retention policy)
- A reversal of a prior ADR

Take the next number, copy [`template.md`](template.md), and link it
from this index.

## Index

| #   | Title                                                                          | Status               |
| --- | ------------------------------------------------------------------------------ | -------------------- |
| 1   | [Cloudflare Workers platform](0001-cloudflare-workers-platform.md)             | Accepted             |
| 2   | [D1 snapshot storage](0002-d1-snapshot-storage.md)                             | Accepted             |
| 3   | [KV read cache](0003-kv-read-cache.md)                                         | Accepted             |
| 4   | [Workers AI changelog summaries](0004-workers-ai-changelog.md)                 | Accepted             |
| 5   | [RSA-PSS request signing](0005-rsa-pss-signing.md)                             | Accepted             |
| 6   | [Multi-region probing](0006-multi-region-probing.md)                           | Superseded by ADR-10 |
| 7   | [Grafana Cloud metrics](0007-grafana-cloud-metrics.md)                         | Accepted             |
| 8   | [Release Please](0008-release-please.md)                                       | Accepted             |
| 9   | [Public/auth probe separation](0009-public-auth-probe-separation.md)           | Accepted             |
| 10  | [Edge caching + region-probe history](0010-edge-caching-and-region-history.md) | Accepted             |
| 11  | [Uptime metrics + latency chart](0011-uptime-metrics-and-latency-chart.md)     | Accepted             |
| 12  | [Cost counter Durable Object](0012-cost-counter-durable-object.md)             | Accepted             |
| 13  | [WebSocket multi-channel sampling](0013-websocket-multi-channel-sampling.md)   | Accepted             |
| 14  | [Decommission production stack](0014-decommission-stack.md)                    | Accepted             |
