<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-05-07 | Updated: 2026-05-07 -->

# fixtures

## Purpose
Static fixtures consumed by the dogfood evaluator. Currently a single JSON catalog of scripted scenarios (`dogfood-scenarios.json`) replayed by `../dogfood-simulation.mjs` and scored by `../dogfood-judge.mjs`.

## Key Files

| File | Description |
|------|-------------|
| `dogfood-scenarios.json` | Scripted scenarios — workspace shape, user prompts, expected milestone hits |

## For AI Agents

### Working In This Directory
- Add scenarios by extending the JSON array — keep them small and self-contained.
- The judge rubric is keyed against the scenario fields; renaming or removing fields requires updating `../dogfood-judge.mjs` in the same change.
- Avoid PII or external links in fixtures — these run in CI and dogfood runs.

### Testing Requirements
- The fixture's shape is validated by `../../sidecar-tests/dogfood-eval.test.mjs`.

### Common Patterns
- JSON only. No symlinks, no binaries.

## Dependencies

### Internal
- `../dogfood-simulation.mjs`, `../dogfood-judge.mjs`.

### External
- None.

<!-- MANUAL: -->
