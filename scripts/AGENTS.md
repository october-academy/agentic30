<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-05-07 | Updated: 2026-05-07 -->

# scripts

## Purpose
Build, sync, preflight, and verification scripts wired into `package.json`. Covers sidecar bundling for distribution, gstack vendor sync, response-time reporting, foundation-first prompt verification, and the gstack skill patcher.

## Key Files

| File | Description |
|------|-------------|
| `build-sidecar.mjs` | Bundles the sidecar for inclusion in the Mac app DMG (`npm run build:sidecar`) |
| `preflight-bundle.mjs` | Bundle preflight checks (`npm run preflight:bundle`) |
| `asc-xcode-cloud-release.mjs` | App Store Connect/Xcode Cloud build wait + artifact download helper for release workflow |
| `check-release-automation.sh` | Preflight for local/Xcode Cloud/GitHub Actions release configuration |
| `publish-github-release.sh` | Publishes appcast/DMG/PKG artifacts to GitHub Releases |
| `upload-sparkle-r2.sh` | Uploads Sparkle appcast artifacts to Cloudflare R2 |
| `sync-gstack.mjs` | Pulls gstack assets into `sidecar/vendor/gstack/` per `gstack-pin.json` (`npm run sync:gstack`) |
| `gstack-pin.json` | Pinned gstack version + integrity metadata consumed by `sync-gstack.mjs` |
| `patch-gstack-skill.mjs` | Patches a vendored gstack skill into a sidecar specialist |
| `report-response-timings.mjs` | Aggregates sidecar response-time logs (`npm run report:timings`) |
| `verify-foundation-first-prompts.mjs` | Verifies the foundation-first prompt registry; executable script |

## For AI Agents

### Working In This Directory
- Scripts are ES modules (`.mjs`) executed with plain `node`. Keep them dependency-free or rely only on what is already in `package.json`.
- Do not write to `sidecar/vendor/` outside of `sync-gstack.mjs`. The vendor tree is upstream-owned.
- `build-sidecar.mjs` is invoked during the Mac app build and must remain idempotent and side-effect-free outside its output directory (`sidecar-build/`, gitignored).
- `verify-foundation-first-prompts.mjs` is referenced by tests in `sidecar-tests/`; changes to its CLI surface should be matched by test updates.

### Testing Requirements
- `patch-gstack-skill.mjs` has coverage in `sidecar-tests/patch-gstack-skill.test.mjs`.
- Bundling and preflight are validated end-to-end at release time per `docs/release-checklist.md`.

### Common Patterns
- ESM, `node:` built-ins (`fs/promises`, `path`, `child_process`).
- Scripts exit non-zero on failure to integrate cleanly with CI.

## Dependencies

### Internal
- `sidecar/vendor/gstack/` — managed by `sync-gstack.mjs`.
- `sidecar-evals/` — `report-response-timings.mjs` consumes evaluator output.

### External
- Node `node:*` only.

<!-- MANUAL: -->
