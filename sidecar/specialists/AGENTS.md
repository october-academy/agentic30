<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-05-07 | Updated: 2026-05-07 -->

# specialists

## Purpose
Catalog of specialist prompt builders that can be invoked through `../specialist-router.mjs`. Each module exports `ID`, `NAME`, `PHASES`, `DECISIONS`, `SUMMARY`, and `buildPrompt(context)`; `index.mjs` aggregates them into `SPECIALIST_CATALOG`. `buildPrompt` returns an inline prompt string (not a wrapped vendored skill). The vendored gstack skill files under `../vendor/gstack/` are surfaced separately by `specialist-router.mjs` via `specialistVendorPath()` and attached to the selection, so the agent has access to both representations.

## Key Files

| File | Description |
|------|-------------|
| `index.mjs` | Aggregates the specialist modules into `SPECIALIST_CATALOG`, `SPECIALIST_IDS`, and provides `getSpecialist`/`listSpecialists`/`listSpecialistsByPhase`/`buildSpecialistPrompt` |
| `office-hours.mjs` | YC-style Office Hours specialist (forcing questions / design thinking) |
| `plan-ceo-review.mjs` | CEO/founder-mode plan review specialist |
| `design-shotgun.mjs` | Multiple AI design variants comparison |
| `design-html.mjs` | Pretext-native HTML/CSS finalization |
| `design-review.mjs` | Designer's-eye QA over a live site |
| `plan-design-review.mjs` | Designer's-eye plan review (pre-implementation) |
| `design-consultation.mjs` | Design system consultation → DESIGN.md |
| `devex-review.mjs` | Live developer experience audit |
| `plan-devex-review.mjs` | Developer experience plan review |

## For AI Agents

### Working In This Directory
- Each specialist exports the same surface (`ID`, `NAME`, `PHASES`, `DECISIONS`, `SUMMARY`, `buildPrompt`). Adding a new specialist means adding a module here and wiring it into `index.mjs`'s `MODULES` array.
- `buildPrompt` is inline. It does not read or splice the vendored gstack skill text. The router attaches vendor paths separately via `vendor-skill-loader.mjs`. If you need to keep an inline prompt and the vendored skill in lockstep, update both deliberately.
- `buildPrompt(context)` is pure — it must not perform I/O. Side effects belong in `../specialist-router.mjs` or higher up.
- Phases gate specialist availability per session phase; keep `PHASES` accurate.

### Testing Requirements
- The router and aggregator are exercised by `../../sidecar-tests/specialist-router.test.mjs`.
- Adding a specialist should come with a router test that confirms its `ID` is reachable.

### Common Patterns
- Frozen catalog entries to prevent accidental mutation.
- Phase filtering via `Array.prototype.includes`.

## Dependencies

### Internal
- `../specialist-router.mjs` — the dispatcher.
- `../vendor-skill-loader.mjs` — resolves the upstream gstack skill path; called from `specialist-router.mjs`, not from inside `buildPrompt`.
- `../vendor/gstack/` — vendored skill assets.

### External
- None directly; specialists are pure prompt builders.

<!-- MANUAL: -->
