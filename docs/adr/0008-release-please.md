# ADR-0008: Release Please for automated versioning

**Status:** Accepted

## Context

Need a CHANGELOG.md and GitHub Releases generated from Conventional Commits without manual curation.

## Decision

Use `google-github-actions/release-please-action` in `.github/workflows/release-please.yml`. Release type: `node`. All PRs use Conventional Commits format.

## Consequences

- CHANGELOG.md maintained automatically
- v1.0.0 entry generated after first release PR is merged
- PR titles must follow `type: description` format
