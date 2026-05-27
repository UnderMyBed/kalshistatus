# CLAUDE.md — AI assistant instructions

A public status and performance page for the [Kalshi](https://kalshi.com) API,
aimed at engineers integrating against it, served at
[kalshistatus.dev](https://kalshistatus.dev). Built and run by `@UnderMyBed`.

The previous compute stack was decommissioned (ADR 0014) and the project is
being re-architected. **Cloudflare stays in the stack for DNS, CDN, and WAF
only** — not as the compute platform. The compute target is being re-decided;
until it is, don't assume Workers, D1, KV, Durable Objects, or Workers AI.

This file is the source of truth for how you collaborate on this repo. Follow it.

---

## How we work — Superpowers

All non-trivial work on this repo goes through the **Superpowers** skill set.
Use the skills; don't freelance the process.

- **Brainstorm before building.** Any new feature, behavior change, or design
  decision starts with the `brainstorming` skill to pin down intent and
  requirements before any code.
- **Plan, then execute.** Multi-step work gets a written plan (`writing-plans`)
  executed with review checkpoints (`executing-plans`,
  `subagent-driven-development`).
- **TDD.** Implementation is test-first (`test-driven-development`).
- **Verify before claiming done** (`verification-before-completion`) — run the
  command, read the output, then make the claim. Evidence before assertions.
- **Debug systematically** (`systematic-debugging`) — find the root cause, don't
  paper over the symptom.
- **Review before merge** (`requesting-code-review`).

If there's even a small chance a skill applies, invoke it.

---

## Operating envelope — free tier, low maintenance

Two constraints define this project and override convenience:

1. **It runs on free tiers. No change may take it off them.** This is a
   non-negotiable architectural constraint, not a preference.
2. **It must be near-zero maintenance.** The operator does not want to babysit
   this site. A design that needs routine human attention is the wrong design.

Cloudflare provides **DNS, CDN, and WAF**. Compute, storage, and any scheduled
work live on whatever platform the re-architecture selects; that platform's
concrete free-tier ceilings get documented here (and in an ADR) once chosen.

Rules that hold regardless of which platform we land on:

- **Cacheable responses must actually be cached at the edge.** A `Cache-Control`
  header only advises the client — it does not, by itself, make the CDN serve a
  cached copy. Cache hot public routes explicitly.
- **Nothing that scales with traffic may write to a datastore per request.** A
  bot hitting a badge endpoint 100k/day must not become 100k writes. Batch,
  defer to a scheduled job, or drop the write.
- **Globally atomic state needs real shared storage**, not per-instance memory.
  Counters kept in the memory of a stateless or replicated runtime drift
  arbitrarily far from reality.
- **`continue-on-error: true` in CI is forbidden** unless documented why a
  silent failure is correct (it almost never is).

---

## NO DEFENSIVE CODING — THIS MEANS YOU

Do not add fallbacks. They hide data issues — they mask when refactors are
missing data — and they cost both of us time and tokens while we rapidly
iterate. **Stop.**

- **Don't write tests for edge cases that shouldn't exist**
- **Don't catch and swallow exceptions** — If something throws, let it throw.
  We need to see it.
- **Don't provide defaults for missing data**
- **Don't "gracefully degrade"** — Graceful degradation is a lie. It means
  "silently do the wrong thing."

**FAIL FAST. FAIL LOUD.**

---

## Docs are part of the change

When a change alters behavior, env vars, the CLI surface, settings,
tools/capabilities, or architecture, **update the relevant file under `docs/`
in the same commit**. New architectural decisions get a new ADR under
`docs/adr/` (copy the existing format, take the next number, link from
`docs/adr/README.md`). A change that touches behavior without touching docs
is **incomplete** — treat it the same as a change with failing tests.

The docs tree is small and focused (`runbook.md`, `ARCHITECTURE.md`, `adr/`);
if the "right place" isn't obvious, it usually means the change deserves an
ADR.

Specifically:

- New env var or secret → `docs/runbook.md` (Secrets section) + relevant ADR
- New route → `docs/ARCHITECTURE.md` (Routes section) + `/openapi.yaml`
- New infrastructure dependency (datastore, queue, scheduler, external service)
  → `docs/ARCHITECTURE.md` + new ADR
- New scheduled-job behavior or schedule → `docs/ARCHITECTURE.md` +
  `docs/runbook.md`
- Rollback steps that change → `docs/runbook.md`
- Cost-control behavior change → `docs/runbook.md` (Cost section) + ADR

---

## Code style

- TypeScript strict mode (already set; do not weaken)
- Prettier formatting (already set; do not weaken)
- **No comments explaining what code does** — only **why** when non-obvious.
  Well-named identifiers are documentation enough for the "what."
- No JSDoc / docstrings on internal functions
- No "removed in PR #N" comments — git history is the record
- No "TODO" without an opened issue link

---

## Privacy

- The repo author is `@UnderMyBed` on GitHub. **Never** use a real name in
  any committed file, rendered page, commit message, or OG image
- **Never** reference private spec paths or internal planning documents in any
  committed file. Distill architectural decisions into ADRs. Distill
  operational knowledge into `docs/runbook.md`
- `docs/superpowers/`, `*.local`, `.env*` are gitignored — keep it that way

---

## Git

- Author: `UnderMyBed` (already set via repo-local config)
- **Never** `git push --force` to main or `git reset --hard origin/main` on
  main
- **Never** skip hooks (`--no-verify`) or bypass signing
- **Squash-merge only** via `gh pr merge --squash --auto`
- **Never** create or rotate production secrets from automation — ask the
  human if you think one needs rotating

---

## CI / Deployment

- All CI workflows must declare an explicit `permissions:` block — never inherit
  the default token scope
- There is currently **no deploy pipeline** — the production stack was
  decommissioned (ADR 0014) and the re-architecture will rebuild it. Until
  then, **land changes via PR with green CI**; do not push directly to main
- Conventional Commits required (`feat:`, `fix:`, `chore:`, `docs:`,
  `refactor:`, `test:`)
- One change per PR — don't bundle a security-headers patch with a UI
  redesign; reviewers can't reason about it
- If a PR widens or weakens a threshold to make a test pass (e.g. extending a
  freshness window from 2m → 60m to satisfy "≥2 regions within 10 min"),
  **stop and fix the underlying design instead**. The 60-minute hack is a
  cautionary tale, not a precedent

---

## Lessons learned — patterns we have actively burned by

These are real incidents from this codebase. **Do not repeat them.**

1. **A `Cache-Control` header is not edge caching.** A dynamic response is not
   served from the CDN just because it carries cache headers — they advise the
   client, not the edge. Cacheable responses must be explicitly stored at the
   edge.

2. **Per-request datastore writes are a cost amplifier.** A bot hitting
   `/badge.svg` 100k times a day is 100k writes if you write on every request.
   Defer to a scheduled job, debounce, or drop the write.

3. **In-memory counters are not circuit breakers.** A stateless or replicated
   runtime runs many instances concurrently; in-memory counters with
   periodic-persist drift arbitrarily far from reality. Atomic global state
   belongs in real shared storage.

4. **`continue-on-error: true` masks deploys silently failing.** If a step is
   allowed to fail, the failure must be observable somewhere else (alert,
   logged metric, dashboard). Otherwise: don't allow it.

5. **A failed cron silently catching auth errors looks identical to upstream
   downtime.** Any caught exception in the cron path that affects probe
   results must log the discriminant so we can tell "config broken" from
   "Kalshi down."

6. **Acceptance tests are not the goal — user experience is.** PRs #25-#28
   widened a 2-minute window to 60 minutes to make a probe-recency check
   pass; the underlying multi-region design never worked. Don't do that
   again. When the test feels hard to pass, the design is wrong, not the
   test.

7. **Status-determination logic that treats `401` from an auth-required probe
   as `down` makes the headline permanently `degraded`.** Probes that
   require credentials must be in a separate group from probes that
   represent public health, and only the public group rolls up to the
   headline.

8. **A hardcoded string constant is not authentication.** `const GUARD =
"kalshi-grafana-init-2026"` committed to a public repo is a public
   string. Use a real secret for any admin endpoint, or remove the
   endpoint after use.

9. **`max-age=0` HSTS is worse than no HSTS** — it actively tells browsers to
   forget. If you set a security header, set it correctly (`max-age=31536000;
includeSubDomains; preload` minimum).

10. **Inline `<style>` blocks of hundreds of lines mean no caching and slow
    first paint.** Static CSS belongs in a cached static asset (e.g.
    `public/style.css`), not inline.

---

## When in doubt

Ask. The cost of pausing to confirm is low; the cost of an unwanted
destructive action or a wrong-shape refactor is high.
