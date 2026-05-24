# Incident YYYY-MM-DD: short title

**Severity:** SEV-1 | SEV-2 | SEV-3 (see `docs/runbook.md`)
**Duration:** HH:MM UTC — HH:MM UTC (D min)
**Detected by:** alert | user report | manual check
**Resolved by:** rollback | fix-forward | upstream recovery

## What happened

One paragraph: user-facing impact, what the symptom was, who/what saw it.

## Timeline (UTC)

- **HH:MM** — first symptom
- **HH:MM** — page fired / first manual notice
- **HH:MM** — investigation starts
- **HH:MM** — root cause identified
- **HH:MM** — fix deployed / rollback completed
- **HH:MM** — monitoring confirms recovery

## Root cause

A short, blameless technical explanation. Cite commit hashes, file paths, log
excerpts. Avoid "human error" as a root cause — find the system that made the
error possible.

## What we changed

- Concrete code/config changes that closed the immediate gap
- Link to PRs

## What we'll change next

- Things that would prevent or shorten the next occurrence
- Each should map to an action item with an owner

## Lessons

Distill anything reusable into `CLAUDE.md` under "Lessons learned" so future
work doesn't repeat the failure mode.
