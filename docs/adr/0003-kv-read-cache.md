# ADR-0003: KV for low-latency read cache with write-on-change

**Status:** Accepted

## Context

/api/status must return the latest snapshot with sub-10ms latency. D1 reads have ~10-50ms overhead.

## Decision

Cache the latest snapshot in KV under key `status:{environment}`. Write only when content hash changes to stay under the 1,000 writes/day free limit.

## Consequences

- Dashboard reads hit KV (1-2ms), not D1
- Write amplification bounded by actual API state changes
- KV value is JSON string; parse on read
