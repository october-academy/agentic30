<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-06-20 | Commit: 6f0fc7e | Branch: main -->

# .github

## OVERVIEW
GitHub repository metadata: PR template, issue templates, secret/public-safety workflow, and release automation.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| PR shape | `PULL_REQUEST_TEMPLATE.md` | Keep brief; contribution norms live in `CONTRIBUTING.md` |
| Issue forms | `ISSUE_TEMPLATE/` | Bug and feature templates; child AGENTS applies |
| Secret/public safety CI | `workflows/secret-scanning.yml` | Runs public-safety check and pinned TruffleHog scan |
| Release CI | `workflows/release.yml` | Tag/manual release, arm64 + x64 macOS matrix, draft/publish gate |

## CONVENTIONS
- Workflow changes should keep secrets out of YAML and use repository/Actions secrets.
- Release workflow publishes only after both architecture DMGs are present.
- Release workflow uses a non-canceling `release` concurrency group; stale-run appcast protection is intentional.
- Release jobs use macOS runners, Node 20, `npm ci`, Wrangler, signing/notarization env, Sparkle feed controls.
- PR template stays short and points to test evidence rather than duplicating this knowledge base.

## ANTI-PATTERNS
- Do not add public issue paths for security disclosures; point reporters to `security@october-academy.com`.
- Do not weaken the secret scanning/public-safety workflow.
- Do not bypass draft-release cleanup or the two-architecture publish check in release automation.
- Do not publish x64 builds to the arm64 historical `appcast.xml`; x64 uses `appcast-x64.xml`.

## TESTS
```bash
npm run check:public-safety
npm run release:preflight
```
Use `actionlint` locally when available for workflow syntax.

## DEPENDENCIES
- Internal: `CONTRIBUTING.md`, `scripts/check-public-safety.mjs`, `scripts/scan-secrets-ci.sh`, release scripts.
- External: GitHub Actions, macOS runners, TruffleHog, Wrangler, Apple signing/notarization services.

<!-- MANUAL: -->
