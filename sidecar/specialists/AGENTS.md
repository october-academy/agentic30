<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-06-20 | Commit: 6f0fc7e | Branch: main -->

# specialists

## OVERVIEW
Project-owned specialist prompt catalog used by `../specialist-router.mjs`. Each module is an inline prompt builder; vendored gstack skill files are attached separately by the router.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Catalog wiring | `index.mjs` | `MODULES`, `SPECIALIST_CATALOG`, lookup helpers |
| Office Hours | `office-hours.mjs` | Planning-phase forcing-question specialist |
| CEO plan review | `plan-ceo-review.mjs` | Founder-mode plan critique |
| Design work | `design-shotgun.mjs`, `design-html.mjs`, `design-review.mjs`, `plan-design-review.mjs`, `design-consultation.mjs` | Planning/build design specialists |
| DevEx work | `devex-review.mjs`, `plan-devex-review.mjs` | Live and pre-implementation DevEx review |
| Shared schema | `schema.mjs` | Rubric axis constants and labels |
| Vendor attachment | `../vendor-skill-loader.mjs`, `../specialist-router.mjs` | Resolves synced gstack assets outside this directory |

## CONVENTIONS
- Every specialist exports `ID`, `NAME`, `PHASES`, `SUMMARY`, `RUBRIC`, and `buildPrompt(context)`.
- `buildPrompt(context)` must be pure: no filesystem, network, process env, time, or mutation.
- Add new modules to `index.mjs` so `listSpecialists*` and `buildSpecialistPrompt` can reach them.
- Keep `PHASES` accurate; they gate availability by session phase.

## ANTI-PATTERNS
- Do not splice vendored skill text into these modules. Update inline prompt and vendored source deliberately when both need to move.
- Do not mutate catalog entries at runtime; callers expect frozen/stable data.
- Do not add side effects to prompt builders.

## TESTS
```bash
npm run test:sidecar
node --test sidecar-tests/specialist-router.test.mjs
```
Adding a specialist should add router coverage proving its `ID` is reachable.

## DEPENDENCIES
- Internal: `../specialist-router.mjs`, `../vendor-skill-loader.mjs`, `../vendor/gstack/`.
- External: none directly.

<!-- MANUAL: -->
