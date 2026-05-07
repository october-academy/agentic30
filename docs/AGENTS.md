<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-05-07 | Updated: 2026-05-07 -->

# docs

## Purpose
Product and operations documentation. Includes the canonical product source-of-truth files (`ICP.md`, `GOAL.md`, `VALUES.md`, `SPEC.md`) generated/updated by the `/office-hours-docs` assistant command, plus release operations references (release checklist, known limitations, diagnostics guide), the qmd advice setup, the response-time improvement plan, and the productization benchmark.

## Key Files

| File | Description |
|------|-------------|
| `ICP.md` | Ideal Customer Profile — managed by `/office-hours-docs`, consumed by sidecar prompts and BIP coach |
| `GOAL.md` | Product goals — managed by `/office-hours-docs`, consumed by foundation-summary and adaptive curriculum |
| `VALUES.md` | Product values — managed by `/office-hours-docs` |
| `SPEC.md` | Product spec — managed by `/office-hours-docs` and the foundation-summary review loop |
| `release-checklist.md` | Pre-release verification (signing, notarization, updater, hardened runtime) |
| `known-limitations.md` | Documented limitations (Sandbox-off, Node child process, etc.) |
| `diagnostics-guide.md` | How to capture and interpret sidecar diagnostics |
| `qmd-advice-setup.md` | qmd memory setup instructions for the assistant |
| `response-time-improvement-plan.md` | Response-time tracking plan (used by `scripts/report-response-timings.mjs`) |
| `productization-benchmark.md` | Productization benchmark notes |

## For AI Agents

### Working In This Directory
- `ICP.md`, `GOAL.md`, `VALUES.md`, `SPEC.md` are the canonical project-shape documents. Update them via the `/office-hours-docs` assistant command rather than ad-hoc edits, so the office-hours interview output stays in sync.
- The sidecar reads these files at runtime to ground prompts (`sidecar/office-hours-docs-prompt.mjs`, `sidecar/foundation-summary/`). Schema-breaking changes (heading restructure, section removal) must be paired with prompt updates.
- Operational docs (`release-checklist.md`, `known-limitations.md`, `diagnostics-guide.md`) are referenced from the README — keep cross-links live.

### Testing Requirements
- No direct tests; verify renderability and link integrity manually.
- If you change document section headers consumed by sidecar prompts, run `npm run test:sidecar` to catch parser regressions.

### Common Patterns
- Markdown with conventional headings (`#`, `##`, `###`).
- Cross-links use relative paths from the repo root (e.g., `docs/release-checklist.md`).

## Dependencies

### Internal
- `sidecar/office-hours-docs-prompt.mjs` — consumes the four canonical product docs.
- `sidecar/foundation-summary/` — references SPEC.md sections during review loops.

### External
- None.

<!-- MANUAL: -->
