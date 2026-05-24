# CLAUDE.md — AI assistant instructions

A Cloudflare Worker that probes the Kalshi API and serves a public status page at
[kalshistatus.dev](https://kalshistatus.dev). Built and run by `@UnderMyBed`.

This file is the source of truth for how you collaborate on this repo. Follow it.

---

## Operating envelope — this fits in the free tier

This entire stack runs on free tiers. **No change may take it off them.** That is
a non-negotiable architectural constraint, not a preference.

The hard ceilings we live under:

| Resource         | Free-tier limit             | What this means in practice                        |
| ---------------- | --------------------------- | -------------------------------------------------- |
| Workers requests | 100,000 / day               | `/api/status`, `/badge.svg`, `/embed` are the risk |
| Workers CPU      | 10 ms / request             | No heavy computation per request                   |
| KV reads/writes  | 100k reads, 1k writes / day | Read cache only; write-on-change                   |
| D1 reads/writes  | 5M reads, 100k writes / day | Snapshots + region probes only                     |
| Workers AI       | 10k Neurons / day           | Slow cron only, ≤1 call per RSS item               |
| Durable Objects  | SQLite-backed only (free)   | `new_sqlite_classes` migrations, no Storage tier   |
| Cloudflare Pages | Not used                    | Avoid — Wrangler v3 CVE was here                   |

Concrete rules that follow from the envelope:

- **Public routes must be edge-cached** via `caches.default`. Cache-Control headers
  alone do NOT cache Workers responses — they only advise clients.
- **No per-request writes** to D1 or KV from the fetch handler. Anything that
  scales with traffic must batch, defer to cron, or live in a Durable Object.
- **Counters that need to be globally atomic** belong in a SQLite-backed Durable
  Object, not per-isolate memory. The cost circuit breaker is one of these.
- **Durable Objects must use `new_sqlite_classes`** migrations (free-tier
  compatible). Plain `new_classes` triggers the paid tier.
- **No Pages deploys.** Wrangler `pages deploy` had a high-sev OS-injection CVE
  in v3 and remains a footgun. Use Workers + `[assets]` for static.
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
- New binding (D1 / KV / DO / AI / Queue / etc.) → `docs/ARCHITECTURE.md` +
  new ADR
- New cron behavior or schedule → `docs/ARCHITECTURE.md` + `docs/runbook.md`
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

## Bindings in `wrangler.toml`

- **Never modify** `[d1_databases]`, `[kv_namespaces]`, or `[ai]` blocks after
  Phase 1 unless replacing the binding wholesale via a documented ADR
- **Adding** new binding types (e.g. `[[durable_objects.bindings]]`) is
  allowed and expected as the system grows — write an ADR
- Compatibility date may be advanced; the test runtime must match (bump
  `@cloudflare/vitest-pool-workers` if necessary so tests are not 8 months
  behind prod)

---

## Privacy

- The repo author is `@UnderMyBed` on GitHub. **Never** use a real name in
  any committed file, rendered page, commit message, or OG image
- **Never** reference private spec paths or internal planning documents in any
  committed file. Distill architectural decisions into ADRs. Distill
  operational knowledge into `docs/runbook.md`
- The handoff config at `/home/matt/source/kalshistatus-spec/handoff.local`
  is **outside the repo by design**. Never copy any of its contents into a
  committed file
- `docs/superpowers/`, `*.local`, `.env*` are gitignored — keep it that way

---

## Git

- Author: `UnderMyBed` (already set via repo-local config)
- **Never** `git push --force` to main or `git reset --hard origin/main` on
  main
- **Never** skip hooks (`--no-verify`) or bypass signing
- **Squash-merge only** via `gh pr merge --squash --auto`
- **Never** run `wrangler secret put` from automation (secrets are
  pre-pushed; ask the human if you think one needs rotating)

---

## CI / Deployment

- All CI workflows must declare an explicit `permissions:` block — never inherit
  the default token scope
- Production deploy is on every push to `main`. There is no staging. **Land
  changes via PR with green CI**; do not push directly to main
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

1. **`Cache-Control` headers on `/api/*` are not edge caching.** Workers responses
   bypass the CDN unless you `caches.default.put(request, response.clone())`
   explicitly. Always use the Cache API for cacheable Worker responses.

2. **Per-request D1 writes are a cost amplifier.** A bot hitting `/badge.svg`
   100k times a day is 100k D1 writes if you write on every request. Defer to
   cron, debounce in a Durable Object, or drop the write.

3. **Per-isolate counters are not circuit breakers.** Cloudflare runs many
   isolates concurrently. In-memory counters with periodic-persist drift
   arbitrarily far from reality. Atomic global state belongs in a Durable
   Object.

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
   string. Use a secret binding for any admin endpoint, or remove the
   endpoint after use.

9. **`max-age=0` HSTS is worse than no HSTS** — it actively tells browsers to
   forget. If you set a security header, set it correctly (`max-age=31536000;
includeSubDomains; preload` minimum).

10. **Inline `<style>` blocks of hundreds of lines mean no caching and slow
    first paint.** Static CSS belongs in `public/style.css` served by
    `[assets]`.

---

## When in doubt

Ask. The cost of pausing to confirm is low; the cost of an unwanted
destructive action or a wrong-shape refactor is high.
