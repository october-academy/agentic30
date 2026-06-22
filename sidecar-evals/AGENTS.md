<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-06-20 | Commit: 6f0fc7e | Branch: main -->

# sidecar-evals

## OVERVIEW
Dogfood evaluator for sidecar chat behavior. Replays scripted scenarios through the same sidecar code paths, judges transcripts, writes artifacts, and supports offline, gated, summary, compare, and live-provider modes.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Main runner | `dogfood-simulation.mjs` | `runDogfoodSimulation`, gate evaluation, markdown report |
| Day-arc runner | `office-hours-arc-simulation.mjs` | `runOfficeHoursArcSimulation`: onboarding handshake → office_hours_start forcing-question loop → day_progress commit → gate authority. Configurable persona/plan. Pure exports (`OFFICE_HOURS_ARC_PERSONAS`, `DEFAULT_ARC_PLAN`, `selectStructuredResponse`, `summarizeArcRun`) are unit-tested |
| Judge / rubric | `dogfood-judge.mjs` | Score keys, verdicts, failure classes, prompt parser |
| Summaries | `dogfood-summary.mjs` | Reads latest result JSONL and aggregates |
| Comparisons | `dogfood-compare.mjs` | Baseline vs current regression view |
| Fixtures | `fixtures/dogfood-scenarios.json` | Scenario catalog; child AGENTS applies |
| Timings | `../scripts/report-response-timings.mjs` | Consumes eval timing artifacts |

## CONVENTIONS
- Default eval mode is offline/stubbed. Use live mode only for explicit provider parity checks.
- `--gate` enforces the pass/fail bar suitable for CI.
- Artifacts belong under `sidecar-evals/.artifacts/` and must stay out of git.
- Rubric strings are contract-like; change them deliberately and update tests if fixture semantics move.

## ANTI-PATTERNS
- Do not commit eval artifacts or live-provider transcripts.
- Do not make default evaluator behavior depend on real provider availability.
- Do not rename fixture fields without updating `dogfood-judge.mjs`, `dogfood-simulation.mjs`, and `sidecar-tests/dogfood-eval.test.mjs`.

## TESTS
```bash
npm run eval:dogfood
npm run eval:dogfood:gate
AGENTIC30_RUN_LIVE_PROVIDER_EVAL=1 npm run eval:dogfood:live
node --test sidecar-tests/dogfood-eval.test.mjs

# Day-arc office-hours simulation (stub default; live drives the real provider)
npm run sim:office-hours
npm run sim:office-hours:live
node --test sidecar-tests/office-hours-arc-simulation.test.mjs
AGENTIC30_RUN_ARC_STUB_SMOKE=1 node --test sidecar-tests/office-hours-arc-simulation.test.mjs  # opt-in stub gate smoke
```

## DEPENDENCIES
- Internal: `../sidecar/`, `fixtures/`, `../scripts/report-response-timings.mjs`.
- External: provider SDKs only in live mode.

<!-- MANUAL: -->
