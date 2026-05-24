# ADR-0001: Cloudflare Workers as deployment platform

**Status:** Accepted

## Context

Need a globally-distributed, low-latency hosting platform with free tier suitable for a monitoring tool with unpredictable traffic.

## Decision

Deploy as a Cloudflare Worker. Use D1 for persistent storage, KV for cache, Workers AI for LLM inference, and Workers Static Assets for the dashboard.

## Consequences

- Zero cold-start latency (V8 isolate model)
- Free tier covers expected traffic
- Locked to Cloudflare ecosystem for storage primitives
- `nodejs_compat_v2` flag required for Web Crypto RSA-PSS
