<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-06-20 | Commit: 6f0fc7e | Branch: main -->

# sidecar-tests

## OVERVIEW
`node --test` integration and unit suite for `sidecar/`, with one-file-per-module coverage where possible. Tests are deterministic by default and should fake provider SDKs, HTTP, filesystem roots, and time.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Provider execution | `provider-runner*.test.mjs`, `auth-context.test.mjs` | Claude/Codex/Gemini/Cursor auth and readiness paths |
| Bridge/routing | `chat-route.test.mjs`, `request-emit.test.mjs`, Swift decoder tests | Keep WebSocket payload fixtures aligned |
| Stateful schemas | `session-store.test.mjs`, `bip-coach-state.test.mjs`, `monetization-ask-state.test.mjs`, `day-progress*.test.mjs` | Schema bumps need migration coverage |
| Foundation summary | `foundation-summary-*.test.mjs` | Evidence, draft, rule, review, integration |
| Program/adaptive rules | `program-gate*.test.mjs`, `adaptive-*.test.mjs`, `action-day-*.test.mjs` | Gate/evidence behavior is fail-closed |
| Integrations | `mcp-oauth-prewarm.test.mjs`, `github/posthog/cloudflare/vercel` config tests | Stub live services |
| Dogfood fixtures | `dogfood-eval.test.mjs` | Validates scenario shape and evaluator behavior |
| Scripts coverage | `patch-gstack-skill.test.mjs`, preflight tests | Script CLI surfaces are tested here |

## CONVENTIONS
- Use `import { test } from "node:test";` and `import assert from "node:assert/strict";`.
- Prefer dependency-injection hooks exposed by sidecar modules; otherwise use small local fakes.
- New sidecar modules should add a sibling test file here unless they are intentionally covered through an owner module.
- Keep fixture strings small and explicit. For WebSocket envelopes, mirror Swift fixture intent in `agentic30Tests/`.

## ANTI-PATTERNS
- No real provider calls, live HTTP, secret reads, global env leakage, or reliance on local user state.
- Do not weaken tests to satisfy a behavior change. Update fixtures only when the contract intentionally changes.
- Do not create tests that require UI E2E approval; this suite must stay CLI-only.

## TESTS
```bash
npm run test:sidecar
node --test sidecar-tests/<name>.test.mjs
node --test --test-name-pattern "<pattern>" sidecar-tests/<name>.test.mjs
```

## DEPENDENCIES
- Internal: `sidecar/`, selected `scripts/`, `sidecar-evals/fixtures/`.
- External: Node built-in test runner and assertions.

<!-- MANUAL: -->
