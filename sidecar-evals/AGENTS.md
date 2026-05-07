<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-05-07 | Updated: 2026-05-07 -->

# sidecar-evals

## Purpose
Dogfood evaluator for the sidecar. Replays scripted scenarios from `fixtures/dogfood-scenarios.json` through the sidecar's chat surface, scores them with `dogfood-judge.mjs`, and produces summaries / cross-run comparisons. Has both an offline mode (default, mocked provider) and a live mode (`AGENTIC30_RUN_LIVE_PROVIDER_EVAL=1`). Outputs land in `.artifacts/` (gitignored).

## Key Files

| File | Description |
|------|-------------|
| `dogfood-simulation.mjs` | Main eval runner — replays fixtures through the sidecar pipeline (`npm run eval:dogfood` / `eval:dogfood:gate` / `eval:dogfood:live`) (~55k chars) |
| `dogfood-judge.mjs` | LLM-as-judge scoring of dogfood transcripts (~21k chars) |
| `dogfood-summary.mjs` | Summarizes the latest dogfood run (`npm run eval:dogfood:summary`) |
| `dogfood-compare.mjs` | Diffs two dogfood runs (`npm run eval:dogfood:compare`) |

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `fixtures/` | Scenario fixtures consumed by the simulation runner (see `fixtures/AGENTS.md`) |

## For AI Agents

### Working In This Directory
- The eval runner is heavy — only run live mode when explicitly verifying provider parity. Default to `npm run eval:dogfood` during iteration.
- The `--gate` flag enforces a pass/fail bar suitable for CI.
- Evaluator output goes to `sidecar-evals/.artifacts/` (gitignored). Do not commit artifacts.
- Adding a fixture requires updating `fixtures/dogfood-scenarios.json` and possibly the judge rubric in `dogfood-judge.mjs`.

### Testing Requirements
- The evaluator itself is exercised by `sidecar-tests/dogfood-eval.test.mjs`.
- Run `npm run eval:dogfood:gate` before merging changes that touch sidecar prompts or routing.

### Common Patterns
- ESM scripts that import from `../sidecar/`.
- LLM judge rubrics are pinned strings inside the script — version-bump the rubric carefully.

## Dependencies

### Internal
- `sidecar/` modules — the runner imports the same code paths the daemon uses.
- `scripts/report-response-timings.mjs` — consumes timing data from eval runs.

### External
- Same SDKs as the sidecar (Claude / Codex) for live mode.

<!-- MANUAL: -->
