<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-06-20 | Commit: 6f0fc7e | Branch: main -->

# fixtures

## OVERVIEW
Static JSON fixtures for dogfood evaluator scenarios. The catalog is replayed by `../dogfood-simulation.mjs`, judged by `../dogfood-judge.mjs`, and validated by sidecar tests.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Scenario catalog | `dogfood-scenarios.json` | Workspace shape, prompts, expected milestone hits |
| Runner usage | `../dogfood-simulation.mjs` | Reads and replays scenarios |
| Judge usage | `../dogfood-judge.mjs` | Rubric keys depend on fixture fields |
| Validation | `../../sidecar-tests/dogfood-eval.test.mjs` | Pins IDs, prompt shape, and scenario validity |

## CONVENTIONS
- JSON only. Keep scenarios small, deterministic, and self-contained.
- Stable scenario IDs matter for summaries, comparison, and regression reporting.
- Add only data needed by the runner or judge; update both if fields change.

## ANTI-PATTERNS
- No PII, real customer data, private links, binaries, symlinks, or generated artifacts.
- Do not make fixtures depend on live provider behavior.
- Do not rename/remove fields without updating the judge and tests in the same change.

## TESTS
```bash
node --test sidecar-tests/dogfood-eval.test.mjs
npm run eval:dogfood
```

## DEPENDENCIES
- Internal: `../dogfood-simulation.mjs`, `../dogfood-judge.mjs`.
- External: none.

<!-- MANUAL: -->
