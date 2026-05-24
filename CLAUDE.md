# CLAUDE.md — AI assistant instructions

## Privacy

Never reference private spec paths or internal planning documents in any committed file.
Distill architectural decisions into ADRs. Distill operational knowledge into docs/runbook.md.

## Git

- Author: `UnderMyBed` (never a real name)
- No `git push --force` or `git reset --hard origin/main` on main
- Squash-merge via `gh pr merge --squash --auto` only
- Never run `wrangler secret put` (secrets already pushed)

## Bindings in wrangler.toml

Never modify `[d1_databases]`, `[kv_namespaces]`, or `[ai]` blocks after Phase 1.

## Code style

TypeScript strict mode. Prettier formatting. No comments explaining what code does — only why when non-obvious.
