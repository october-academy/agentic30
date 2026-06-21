<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-06-20 | Commit: 6f0fc7e | Branch: main -->

# scripts

## OVERVIEW
Build, release, sync, preflight, safety, and reporting scripts wired through `package.json`. Most Node scripts are ESM and most release/test wrappers are Bash.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Sidecar bundle | `build-sidecar.mjs`, `preflight-bundle.mjs` | Bundle/runtime smoke checks for app distribution |
| Swift tests | `xcode-test.sh` | Unit/UI split and local UI E2E gate |
| Release preflight | `preflight-release.sh`, `check-release-automation.sh` | Version/feed/build/test/env checks |
| Release build | `build-and-notarize.sh`, `sign-sidecar-native-binaries.sh` | Archive/export/notarize/sign/verify |
| Publishing | `publish-github-release.sh`, `upload-sparkle-r2.sh`, `r2-upload-object.mjs`, `setup-sparkle-r2.sh` | GitHub Releases, Sparkle appcasts, R2 |
| Public safety | `check-public-safety.mjs`, `scan-secrets-ci.sh`, `scan-secrets-gh.sh`, `git-hooks/` | Secret/path gates |
| Vendor sync | `sync-gstack.mjs`, `gstack-pin.json`, `patch-gstack-skill.mjs` | Upstream gstack import and specialist patching |
| Alignment/reporting | `sync-alignment-sources.mjs`, `check-alignment-leak.mjs`, `report-response-timings.mjs`, `posthog-release-funnel.mjs` | Private alignment and release analytics |
| Prompt verification | `verify-foundation-first-prompts.mjs` | Covered by sidecar tests |

## CONVENTIONS
- `.mjs` scripts run with plain `node` and should stay dependency-light.
- Bash release scripts should fail fast and keep env-var validation near the top.
- `build-sidecar.mjs` must be idempotent outside `sidecar-build/`.
- When `build-sidecar.mjs` entry points change, update the Xcode "Build Sidecar Bundle" Run Script `inputPaths`.
- `preflight-bundle.mjs` fails explicitly when the bundle entry, Node runtime, or bundled Codex CLI is missing.
- Git hooks are opt-in local config via `npm run hooks:install`; do not assume they are installed.

## ANTI-PATTERNS
- Do not write to `sidecar/vendor/` except through `sync-gstack.mjs`.
- Do not weaken `xcode-test.sh`'s local UI E2E approval gate.
- Do not add release scripts that silently skip signing/notarization/Sparkle validation.
- Do not store credentials, app-store keys, R2 keys, or signing material in the repo.
- Do not make public-safety, alignment-leak, or secret scans recover silently; expose the blocking path or pattern.

## TESTS
```bash
npm run preflight:bundle
npm run release:preflight
npm run check:public-safety
node --test sidecar-tests/patch-gstack-skill.test.mjs
```
`release:preflight` may invoke a Release xcodebuild dry-run and sidecar tests.

## DEPENDENCIES
- Internal: `sidecar/`, `sidecar-build/`, `.github/workflows/`, `agentic30.xcodeproj`.
- External CLIs by script: `xcodebuild`, `xcrun`, `gh`, `wrangler`, TruffleHog, Sparkle tools.

<!-- MANUAL: -->
