# ADR-0004: Workers AI for changelog summaries

**Status:** Accepted

## Context

Kalshi publishes a changelog RSS feed. Engineers want a plain-English summary of each entry without reading full release notes.

## Decision

Use Workers AI (`@cf/meta/llama-3.1-8b-instruct`, temp=0.0) to summarize each changelog entry once. Store result in D1 `changelog_summaries` table keyed by entry link (idempotent).

## Consequences

- Zero external LLM cost (Workers AI free tier: 10K neurons/day)
- Summaries are deterministic (temp=0.0)
- One-time inference per changelog entry; not regenerated on re-fetch
