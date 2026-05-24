# ADR-0005: RSA-PSS SHA-256 for Kalshi API authentication

**Status:** Accepted

## Context

Kalshi authenticated endpoints require RSA-PSS SHA-256 request signing. The private key is stored as a Cloudflare Worker secret.

## Decision

Use Web Crypto API (`crypto.subtle.importKey` + `crypto.subtle.sign`) in the Worker. Key stored as PEM in `KALSHI_PROD_PRIVATE_KEY` / `KALSHI_DEMO_PRIVATE_KEY` secrets.

## Consequences

- No external crypto library needed (Web Crypto is available in Workers)
- `nodejs_compat_v2` compatibility flag required
- Key import happens per-request (cached in memory within isolate lifetime)
