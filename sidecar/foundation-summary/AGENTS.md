<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-05-07 | Updated: 2026-05-07 -->

# foundation-summary

## Purpose
Day-7 foundation-summary sub-workflow. Runs an Agent SDK `query()` with a strict READ-ONLY tool allowlist (`Read`, `Glob`, `Grep`, `AskUserQuestion`) and a `canUseTool` callback that fail-closed denies anything else. Enforces the "agent reads, user writes" contract. Composes evidence collection, draft writing, rule checking, and a multi-pass review loop into the unified Day-7 foundation chat (called from `../foundation-chat.mjs`). Outputs the `SPEC.md`, `go-no-go.md`, and `foundation-summary.md` artifacts under the workspace's `.agentic30/foundation/` directory.

## Key Files

| File | Description |
|------|-------------|
| `index.mjs` | Entry point — exposes `runFoundationSummary()`, the allowed-tools allowlist, and the `canUseTool` enforcer |
| `prompt.mjs` | Persona, system prompt, and initial-prompt builders |
| `evidence-collector.mjs` | Reads workspace artifacts and produces a structured evidence draft (~24k chars) |
| `draft-writer.mjs` | `writeFoundationSummaryDraftV2()` and the `draft.v2.json` audit writer for the foundation-summary draft |
| `rule-check.mjs` | Verifies SPEC v3 / go-no-go rules over the produced draft (~21k chars) |
| `review-loop.mjs` | Multi-pass review loop that converges the draft against rule-check feedback (~25k chars) |

## For AI Agents

### Working In This Directory
- The READ-ONLY tool allowlist is a contract. Do not extend it with `Write`, `Edit`, `Bash`, or any tool that mutates the workspace. The user writes; the agent only reads + asks.
- `canUseTool` is fail-closed — anything not in `FOUNDATION_SUMMARY_ALLOWED_TOOLS` is denied. Tests pin the contract; do not loosen it.
- This sub-workflow is Claude-only by design — it imports the Claude Agent SDK `query()` directly. The Mac app (`AgenticViewModel.swift`) fails closed when a Codex-only session reaches `/foundation-summary`. Do not "add Codex parity" here without first updating the gate on the Swift side.
- The review loop is iterative — bounded retries with explicit termination criteria. Do not introduce unbounded loops.
- Output paths land under `<workspace>/.agentic30/foundation/`. Do not write outside that namespace.

### Testing Requirements
- Each module has a sibling test in `../../sidecar-tests/`:
  - `foundation-summary-evidence.test.mjs`
  - `foundation-summary-draft-writer.test.mjs`
  - `foundation-summary-rule-check.test.mjs`
  - `foundation-summary-review-loop.test.mjs`
  - `foundation-summary-integration.test.mjs`
- Run via `npm run test:sidecar`.

### Common Patterns
- Pure functions where possible; the `query()` invocation is the only side-effecting bit.
- Evidence/draft/rule-check shapes are cross-pinned in tests — keep them stable.

## Dependencies

### Internal
- `../foundation-chat.mjs` — calls `runFoundationSummary()`.
- `../foundation-summary-integration.mjs` — orchestrates artifact placement.
- `../mcp-server.mjs` — surfaces Read/Glob/Grep for Codex parity.

### External
- `@anthropic-ai/claude-agent-sdk` — `query()` and tool gating.

<!-- MANUAL: -->
