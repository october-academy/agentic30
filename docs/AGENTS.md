<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-06-20 | Commit: 6f0fc7e | Branch: main -->

# docs

## OVERVIEW
Product, program, diagnostics, release, and operations documentation. Some files are runtime prompt inputs; others are release/operator references.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Product source docs | `ICP.md`, `GOAL.md`, `VALUES.md`, `SPEC.md` | Managed by `/office-hours-docs`; consumed by sidecar prompts |
| Voice/product frame | `PHILOSOPHY.md`, `SOUL.md`, `JARGON.md`, `mandal-art.md` | Product language and thinking references |
| First run / diagnostics | `first-run-walkthrough.md`, `diagnostics-guide.md`, `known-limitations.md` | Linked from README |
| Release operations | `release-checklist.md`, `release-automation.md` | Signing, notarization, Sparkle, updater, automation |
| Performance/evals | `response-time-improvement-plan.md`, `productization-benchmark.md`, `qmd-advice-setup.md` | Consumed by scripts and operator workflows |
| Program specs | `specs/` | Cross-linked to sidecar program modules; specs can be draft/change docs |
| Alignment/private refs | `private/alignment/`, `october-academy/` | Treat as source/reference material, not public copy text |

## CONVENTIONS
- Markdown headings are parser-sensitive for runtime prompt consumers.
- `/office-hours-docs` should update the four product source docs instead of ad hoc manual edits.
- Schema-breaking heading changes must update sidecar prompt builders and run sidecar tests.
- README links to operational docs; keep relative links live.
- Private alignment docs are source/reference material for operators; do not quote them into public docs by default.

## ANTI-PATTERNS
- Do not rewrite `ICP.md`, `GOAL.md`, `VALUES.md`, or `SPEC.md` without considering `sidecar/office-hours-docs-prompt.mjs` and `sidecar/foundation-summary/`.
- Do not copy `private/alignment/` content into public-facing docs casually.
- Do not commit generated eval artifacts, screenshots, or local `.DS_Store` churn.

## TESTS
```bash
npm run test:sidecar
```
Run sidecar tests when headings or sections consumed by prompt builders change. Otherwise verify Markdown renderability and links manually.

## DEPENDENCIES
- Internal: `sidecar/office-hours-docs-prompt.mjs`, `sidecar/foundation-summary/`, `scripts/report-response-timings.mjs`.
- External: none.

<!-- MANUAL: -->
