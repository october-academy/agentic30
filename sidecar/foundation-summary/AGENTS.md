<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-06-14 | Commit: 230c007 | Branch: main -->

# foundation-summary

## OVERVIEW
Day-7 foundation-summary sub-workflow. Runs Claude Agent SDK `query()` with a strict read-only tool contract so the agent reads and asks while the user remains the writer.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Entry point / tool gate | `index.mjs` | `runFoundationSummary()`, `FOUNDATION_SUMMARY_ALLOWED_TOOLS`, `canUseTool` |
| Prompt contract | `prompt.mjs` | Persona, system prompt, initial prompt |
| Evidence draft | `evidence-collector.mjs` | Workspace artifact reads and evidence context |
| Draft output | `draft-writer.mjs` | `writeFoundationSummaryDraftV2()`, `draft.v2.json` audit shape |
| Rule validation | `rule-check.mjs` | SPEC v3 / go-no-go verification |
| Review convergence | `review-loop.mjs` | Bounded multi-pass review against rule feedback |
| Sidecar glue | `../foundation-summary-integration.mjs`, `../foundation-chat.mjs` | Unified Day-7 chat orchestration |

## CONVENTIONS
- Allowed tools are exactly `Read`, `Glob`, `Grep`, and `AskUserQuestion`.
- `canUseTool` fails closed. Unknown tools are denied, not ignored.
- Outputs stay under `<workspace>/.agentic30/foundation/`.
- Pure helpers are preferred; the Agent SDK `query()` call is the intentional side effect.
- Shape changes to evidence, draft, or rule-check outputs need matching tests.

## ANTI-PATTERNS
- Do not add `Write`, `Edit`, `Bash`, shell tools, or any mutating tool.
- Do not add Codex parity here casually. The Swift app gates Codex-only sessions away from this Claude-only path.
- Do not introduce unbounded review loops or writes outside the foundation namespace.

## TESTS
```bash
npm run test:sidecar
node --test sidecar-tests/foundation-summary-rule-check.test.mjs
```
Sibling tests cover evidence, draft writer, rule check, review loop, and integration.

## DEPENDENCIES
- Internal: `../foundation-chat.mjs`, `../foundation-summary-integration.mjs`, `../mcp-server.mjs`.
- External: `@anthropic-ai/claude-agent-sdk`.

<!-- MANUAL: -->
