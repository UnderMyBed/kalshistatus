# 13. WebSocket multi-channel sampling

Date: 2026-05-24

## Status

Accepted

## Context

The original WebSocket sampler (`src/ws-sampler.ts` pre-1.3.0) opened a plain
`new WebSocket(wssUrl)`, subscribed to a single `ticker_v2` channel, and
reported `tickers_received` plus the TCP handshake `latency_ms`. Two
problems compounded:

1. **No auth.** The browser-style `WebSocket(url)` constructor accepts no
   custom headers, so the Kalshi-required RSA-PSS signature could never be
   attached. Every probe failed at the upgrade with `error: "websocket error"`
   and `connected: false`. We had been shipping a WebSocket card that read
   "0 tickers received" for the lifetime of the project.
2. **Wrong shape even on success.** A single channel of "messages received"
   tells you almost nothing operationally — you can't tell whether trades
   are flowing, whether the orderbook is updating, or whether RFQs are being
   delivered. The inspiring consumer site at `kalshistatus.com` surfaces
   `trade`, `ticker`, `orderbook`, and `communications` separately with msg
   rate and average message age. Our engineer-facing page should match or
   exceed that.

## Decision

Replace the sampler with an authenticated, multi-channel implementation:

- Authenticate the upgrade by calling `fetch(httpsUrl, { headers: { Upgrade:
'websocket', ...RSA-PSS auth headers } })` — the only path in Workers that
  attaches custom headers to a WebSocket. The signed message uses
  `path = url.pathname` (no query string).
- Subscribe to all four production channels: `trade`, `ticker_v2`,
  `orderbook_delta`, `communications`.
- For each channel record `msg_count`, `rate_per_sec` (`count / (sample_ms /
1000)`), and `median_age_ms` (median of `Date.now() - msg.msg.ts` across
  observed messages). Median over mean to keep one slow message from
  dominating.
- The sampler returns a typed `WsSample` carrying `connected`,
  `handshake_ms`, `sample_ms`, `sampled_at`, `channels[]`, and an optional
  `error` (`no_credentials`, `upgrade_failed_<status>`, `ws_error`, or the
  thrown message). The shape is documented in `public/openapi.yaml`.
- Sample window stays at the existing `WS_SAMPLE_MS` (default 5 s).

## Alternatives considered

- **Four separate WebSocket connections (one per channel).** Rejected: 4×
  the handshake budget per cron tick, no operational gain — Kalshi's WS
  supports multiplexed subscriptions on a single socket.
- **Keep the existing single-channel shape and just add auth.** Rejected:
  half a fix. The single-channel summary was the bigger semantic problem;
  the auth bug just hid it.
- **Use a third-party Workers-compatible WS client library.** Rejected:
  Workers `fetch()` + `Upgrade: websocket` already supports the upgrade and
  custom headers — no library needed, no bundle bloat, no extra dependency
  to track for CVEs.
- **Move WS sampling out of the fast cron into its own slow cron.**
  Rejected for now: msg-age is most useful when fresh; bucketing sample data
  by minute aligns with the REST snapshot cadence.

## Consequences

Code-level:

- `WsSample` and `WsChannelSample` types replace the old single-counter
  shape. Old D1 snapshots written before this change have the legacy fields;
  the UI handles both via the optional-chain reads (no migration).
- `sampleWebSocket` now takes a `WsSampleParams` object with `wsUrl`,
  `keyId`, `privatePem`, `sampleMs`, plus optional `fetchFn` and
  `authBuilder` for tests.
- New tests in `test/ws-sampler.test.ts` cover the no-credentials
  short-circuit, upgrade-failure surfacing, signed-path correctness, and
  channel ordering.

Operational:

- The WebSocket card now shows four rows. A `silent` row is a live signal
  (Kalshi isn't pushing on that channel right now) rather than the previous
  uniformly-broken state.
- `ws_sample.error = "upgrade_failed_401"` cleanly distinguishes "auth is
  misconfigured" from "Kalshi WS is down."
- One extra outbound WS message per cron tick per env (4 subscribes instead
  of 1). Same connection count. Free-tier impact: nil.

Future-facing:

- Per-channel rates can move to Grafana as labeled gauges (`kalshi_ws_rate{channel="trade"}`)
  in a follow-up.
- If Kalshi adds a channel (e.g. `ticker_v3`), the `CHANNELS` constant in
  `src/ws-sampler.ts` is the only addition point.

Supersedes nothing. Cross-link: [[0005-rsa-pss-signing]] (signing
implementation reused), [[0009-public-auth-probe-separation]] (WS auth state
is independent of REST authed probes; both are "can we talk to Kalshi as
ourselves" signals).
