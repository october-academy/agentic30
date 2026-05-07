<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-05-07 | Updated: 2026-05-07 -->

# .github

## Purpose
GitHub repository metadata: pull request template and issue templates. No CI workflows are committed here today — Swift and sidecar test commands are run locally per `CONTRIBUTING.md`.

## Key Files

| File | Description |
|------|-------------|
| `PULL_REQUEST_TEMPLATE.md` | PR description scaffolding |

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `ISSUE_TEMPLATE/` | Bug report and feature request templates (see `ISSUE_TEMPLATE/AGENTS.md`) |

## For AI Agents

### Working In This Directory
- The PR template should not list every checkbox under the sun — keep it brief, since the repo's contribution norms live in `CONTRIBUTING.md`.
- Adding a workflow file under `.github/workflows/` is fine if introduced deliberately; keep secrets and credentials out of the repo.
- Security disclosures go to `security@october-academy.com` (per `CONTRIBUTING.md`), not via public issues.

### Testing Requirements
- None — these are Markdown forms.

### Common Patterns
- GitHub front-matter (`name`, `about`, `title`, `labels`) for issue templates.

## Dependencies

### Internal
- `CONTRIBUTING.md` — referenced from the PR template.

### External
- None.

<!-- MANUAL: -->
