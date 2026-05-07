<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-05-07 | Updated: 2026-05-07 -->

# vendor

## Purpose
Vendored upstream assets — currently only `gstack/`, which holds Claude and Codex skill content used by `../specialists/` and `../vendor-skill-loader.mjs`. Synced from upstream via `scripts/sync-gstack.mjs` per the pin in `scripts/gstack-pin.json`.

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `gstack/` | Vendored gstack skills (claude/, codex/) plus a `VERSION.json` describing the pinned version |

## For AI Agents

### Working In This Directory
- **Do not edit files under `vendor/` by hand.** They are upstream-owned and overwritten on every sync.
- To update content: bump the pin in `scripts/gstack-pin.json` and run `npm run sync:gstack`.
- If a vendored skill needs adaptation, copy the relevant fragment into `../specialists/` and modify there — never patch the vendored copy.

### Testing Requirements
- Sync correctness is validated by the patcher tests in `../../sidecar-tests/patch-gstack-skill.test.mjs` and the vendor-skill-loader tests in `../../sidecar-tests/vendor-skill-loader.test.mjs`.

### Common Patterns
- Version-pinned upstream import; no in-place mutation.

## Dependencies

### Internal
- `scripts/sync-gstack.mjs` — performs the sync.
- `scripts/patch-gstack-skill.mjs` — adapts a vendored skill into a specialist.
- `../vendor-skill-loader.mjs` — read path used at runtime.

### External
- gstack upstream (resolved at sync time).

<!-- MANUAL: -->
