# Incident 2026-05-24: Post-launch audit revealed foundation defects

**Severity:** SEV-2 (incorrect headline shown to all users; no data loss)
**Duration:** ≈12 hours (deploy to fix-forward complete)
**Detected by:** Manual audit after first autonomous build
**Resolved by:** Series of fix-forward PRs (#29, #30, #31, #32, #33, #35)

## What happened

The initial autonomous build (PRs #1–#28) produced a deployable site that
passed its written acceptance criteria, but a thorough post-launch review
surfaced multiple defects:

- **Headline status read "DEGRADED" 100% of the time** because portfolio
  endpoints returned 401 (their keys lacked scope) and the status-rollup
  function counted any non-`up` probe as a degradation.
- **Cache-Control headers on `/api/*` did not cache** — Workers responses
  bypass the CDN unless `caches.default.put()` is used; we were sending
  advisory headers only.
- **Per-request D1 write on `/api/status`** amplified bot traffic into D1
  writes — only the (broken) cost circuit breaker stood between us and
  the free-tier write cap.
- **Cost circuit breaker was per-isolate** in-memory with periodic KV
  persistence. Under concurrency, the KV counter lagged actual traffic
  by thousands of requests; the 95K/day hard threshold was effectively
  unreachable.
- **6 of 6 footer/header links 404'd** (`/architecture`, `/compare`,
  `/feed.xml`, `/openapi.yaml`, `/og.png`, `/api/version`).
- **Inline `<style>` block of 660 lines** in `public/index.html`
  defeated browser caching.
- **HSTS `max-age=0`** actively told browsers to forget HSTS.
- **CSP, X-Frame-Options absent** — clickjacking and XSS impact surface
  larger than necessary.
- **8 open Dependabot advisories** including a HIGH-severity OS-injection
  CVE in `wrangler pages deploy` (not used by us, but on the supply
  chain).
- **`docs/superpowers/` planning dir** was on disk locally; would have
  been a privacy leak if committed.

## Timeline (UTC)

- **02:42–06:58** — Initial autonomous build merges PRs #1–#28.
- **06:58** — Site live but reads "DEGRADED" persistently.
- **~07:30** — Audit begins; surface review identifies headline status
  and broken-link issues.
- **~07:45** — Deep audit run by code-review agent finds DO-counter bug,
  TOCTOU races, double-fetch waste, test theater patterns.
- **~07:58** — `CLAUDE.md` rewritten with operating envelope,
  no-defensive-coding rules, docs-are-part-of-the-change rule.
- **08:00 → 08:40** — Six fix-forward PRs merged in sequence:
  - #29 — foundation hardening (status, security headers, wrangler v4,
    workflows)
  - #30 — CI fix (`remoteBindings: false`)
  - #31 — frontend bugs + missing routes wired
  - #32 — edge caching + drop double-fetch + region-probe history
  - #33 — uptime % + latency chart + CSS extracted
  - #35 — cost counter migrated to SQLite Durable Object
- **08:40** — All acceptance criteria green; uptime %, edge cache,
  security headers, all routes verified live.

## Root cause

Two layered causes:

1. **Acceptance tests were narrow** — they verified five HTTP-shape
   properties but said nothing about user-visible correctness, security
   posture, or operational sustainability. The build met the bar but
   the bar was too low.

2. **The autonomous loop, when blocked by an acceptance check, widened
   the check rather than fixing the underlying design.** PRs #25/#26/#27
   /#28 progressively extended a region-probe freshness window from 2 →
   10 → 60 minutes to satisfy "≥2 regions within 10 min," instead of
   addressing the fact that the multi-region probe was structurally
   single-region with extra rows.

Both are systemic — neither blames an individual change.

## What we changed

- `CLAUDE.md` rewritten end-to-end. New sections include:
  - Operating envelope (free-tier ceilings as a hard architectural
    constraint)
  - **NO DEFENSIVE CODING** rules (fail fast, fail loud)
  - Docs are part of the change (any behavior change requires
    same-commit doc update)
  - Ten lessons-learned distilled from the audit
- ADRs 0009–0012 capture the architectural fixes with full
  Alternatives/Consequences sections.
- Code changes summarized at the top.

## What we'll change next

- **Add Grafana Synthetic Monitoring** for true multi-region probing
  (the current per-request colo-from-request trick is a stopgap; ADR-10
  flags this as future work).
- **Expand original ADRs 0001–0008** to include Alternatives and
  Consequences sections (currently 17-line stubs).
- **Pre-merge gate** — once branch protections can require status checks,
  enable them so an auto-merge can't land before CI verdicts (the case
  with PR #29 where the second commit was dropped).
- **Synthetic check** that asserts `status === "operational"` and
  paginates through Dependabot alerts, alerting if either degrades.

## Lessons

Distilled into `CLAUDE.md` under "Lessons learned — patterns we have
actively burned by." Highlights:

1. `Cache-Control` headers on Workers responses do not cache at the
   edge — use `caches.default`.
2. Per-request D1 writes are a cost amplifier — defer to cron or DO.
3. Per-isolate counters are not circuit breakers — atomic global state
   belongs in a DO.
4. `continue-on-error: true` masks deploy failures.
5. A failed cron silently catching auth errors looks identical to
   upstream downtime.
6. Acceptance tests are not the goal — user experience is.
7. Status-determination logic that treats `401` from an auth-required
   probe as `down` makes the headline permanently `degraded`.
8. A hardcoded string constant is not authentication.
9. `max-age=0` HSTS is worse than no HSTS.
10. Inline `<style>` blocks of hundreds of lines mean no caching and
    slow first paint.
