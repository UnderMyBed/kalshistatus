# 9. Separate public-health and authenticated probes

Date: 2026-05-24

## Status

Accepted

## Context

The initial design rolled all 8 Kalshi probes (4 public + 4 authenticated
portfolio endpoints) into a single `determineStatus()` function. Any non-`up`
result degraded the headline.

In practice, the `portfolio_*` endpoints returned 401 on every probe because
the configured Kalshi keys lacked account-level portfolio scope. The headline
status therefore read `degraded` permanently, regardless of Kalshi's actual
health. Every visitor, embedded badge, and iframe widget displayed
"DEGRADED" as the front-door message.

## Decision

Endpoint definitions in `src/kalshi-client.ts` now carry a `requires_auth`
flag. `EndpointProbe` records it on every result. `determineStatus()` filters
to `!requires_auth` probes before computing the headline. Authenticated
probes are still surfaced in the API response — they are diagnostic — but
they no longer affect the rolled-up status string.

When credentials are missing, authenticated probes return `status: "unknown"`
with `error: "no_credentials"` rather than silently being fired without
headers and receiving 401.

## Alternatives considered

- **Treat 401 as `unknown` instead of `down` in the existing status
  function.** Rejected: the function then has implicit knowledge of which
  http_status codes are expected per endpoint, which is fragile.
- **Drop the portfolio probes entirely.** Rejected: they are still useful as
  diagnostic signals for the operator, just not as headline contributors.
- **Add a separate `/api/auth-status` endpoint.** Rejected: doubles request
  volume for no clarity benefit. The split is a presentation concern, not a
  routing concern.

## Consequences

- Headline status reflects public-API health, which is the meaningful signal
  for engineers integrating against Kalshi.
- `EndpointProbe` schema gained a `requires_auth: boolean` field (non-optional
  on new writes). Existing D1 rows without the field will deserialize with
  `undefined`; readers must treat `undefined` as `false` for backward
  compatibility, OR a migration script will be added in a future ADR.
- The dashboard can now group endpoints by trust level visually (deferred
  to UI redesign).
- The cron loop must check `def.requires_auth && (!keyId || !privateKey)` and
  emit a `no_credentials` probe — no silent fallback to unauthenticated
  requests.
