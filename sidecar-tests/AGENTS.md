<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-05-07 | Updated: 2026-05-07 -->

# sidecar-tests

## Purpose
`node --test` integration suite for every module in `sidecar/`. Each test file maps roughly 1:1 to a sidecar module. Covers ACP adapter, adaptive curriculum, auth context, BIP coach state, BIP readiness, BIP token expiration, BIP URL validation, BIP Google auth hang, chat route classification, Day-1 ICP conversation flow, diagnostics, dogfood eval, foundation-day, foundation-first prompts (unit + integration), foundation-summary (draft writer, evidence, integration, review loop, rule check), gws-memory, IDD doc gate, inline decision, monetization-ask (state, result, integration), office-hours-docs prompt, onboarding hypothesis, patch-gstack-skill, preflight, provider runner, qmd support, session store, specialist router, telemetry, user input, vendor skill loader.

## Key Files

| File | Description |
|------|-------------|
| `acp-adapter.test.mjs` | ACP adapter protocol coverage |
| `acp-utils.test.mjs` | ACP helper unit tests |
| `adaptive-curriculum.test.mjs` | Adaptive curriculum builder |
| `auth-context.test.mjs` | Auth env construction + scrubbing |
| `bip-coach-state.test.mjs` | BIP coach state machine transitions (~20k chars) |
| `bip-google-auth-hang.test.mjs` | Regression for BIP Google auth hang |
| `bip-readiness.test.mjs` | BIP readiness gating |
| `bip-token-expired.test.mjs` | BIP token-expired path |
| `bip-url-validate.test.mjs` | BIP Doc/Sheet URL validation |
| `chat-route.test.mjs` | Chat route classifier |
| `day1-icp-conversation.test.mjs` | Day-1 ICP conversation flow (~32k chars) |
| `diagnostics.test.mjs` | Diagnostics snapshot |
| `dogfood-eval.test.mjs` | Dogfood eval runner integration (~25k chars) |
| `foundation-day.test.mjs` | Foundation day orchestration |
| `foundation-first-prompt.test.mjs` | Foundation-first prompt registry |
| `foundation-first-prompt-integration.test.mjs` | Integration coverage of the registry against routing |
| `foundation-summary-draft-writer.test.mjs` | Draft writer for foundation-summary |
| `foundation-summary-evidence.test.mjs` | Evidence collector |
| `foundation-summary-integration.test.mjs` | Integration with foundation-chat |
| `foundation-summary-review-loop.test.mjs` | Review loop convergence |
| `foundation-summary-rule-check.test.mjs` | Rule-check verifier |
| `gws-memory.test.mjs` | Google Workspace qmd memory cache |
| `idd-doc-gate.test.mjs` | IDD doc gate (~18k chars) |
| `inline-decision.test.mjs` | Inline decision sentinel parsing |
| `monetization-ask-integration.test.mjs` | Monetization-ask integration |
| `monetization-ask-result.test.mjs` | Result handling |
| `monetization-ask-state.test.mjs` | State machine |
| `office-hours-docs-prompt.test.mjs` | `/office-hours-docs` prompt |
| `onboarding-hypothesis.test.mjs` | Onboarding hypothesis derivation |
| `patch-gstack-skill.test.mjs` | Skill patcher (covers `scripts/patch-gstack-skill.mjs`) |
| `preflight.test.mjs` | Preflight report |
| `provider-runner.test.mjs` | Claude + Codex provider runner |
| `qmd-support.test.mjs` | qmd guidance + MCP config |
| `session-store.test.mjs` | Session persistence + schema versioning |
| `specialist-router.test.mjs` | Specialist router |
| `telemetry.test.mjs` | Telemetry client |
| `user-input.test.mjs` | User input normalization |
| `vendor-skill-loader.test.mjs` | Vendor skill loader |

## For AI Agents

### Working In This Directory
- Run with `npm run test:sidecar`. The npm script globs `sidecar-tests/**/*.test.mjs`.
- Tests use `node:test` and `node:assert`. No external test framework.
- New tests must be deterministic. Mock provider SDKs and external HTTP rather than calling real services.
- A new sidecar module should ship with its sibling test file in this directory.
- When changing schemas (`session-store`, BIP coach, monetization-ask), add a migration test alongside the schema bump.

### Testing Requirements
- The test command is the gate; CI runs the same `npm run test:sidecar`.
- For tests that exercise the WebSocket envelope, share fixture JSON with the Swift-side test (`agentic30Tests/SidecarEventDecodingTests.swift`) so both ends decode the same payload.

### Common Patterns
- `import { test } from "node:test";` and `import assert from "node:assert/strict";`.
- Stub Claude / Codex SDK invocations by patching the imported module via DI hooks where the sidecar exposes them; otherwise use small fakes inside the test.

## Dependencies

### Internal
- `sidecar/` modules under test.
- `scripts/patch-gstack-skill.mjs` (covered by `patch-gstack-skill.test.mjs`).

### External
- Node `node:test` only.

<!-- MANUAL: -->
