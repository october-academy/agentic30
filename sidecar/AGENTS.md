<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-05-07 | Updated: 2026-05-07 -->

# sidecar

## Purpose
Local Node.js sidecar that the macOS app launches as a child process. Provides a WebSocket bridge for chat/streaming, runs the Claude Agent SDK and Codex SDK provider streams, exposes an MCP server for tool surfacing, an ACP adapter for IDE integration, BIP coach state machine, foundation-summary review loop, monetization-ask flow, onboarding hypothesis derivation, IDD doc gate, adaptive curriculum, Google Workspace client, Notion OAuth, Meta Ads client, qmd memory support, and PostHog-style telemetry events. Entry points are `index.mjs` (default WebSocket runner), `mcp-server.mjs`, and `acp-adapter.mjs`.

## Key Files

### Entry points
| File | Description |
|------|-------------|
| `index.mjs` | WebSocket sidecar daemon — the one big front door (~226k chars). Owns session routing, provider dispatch, BIP coach + foundation-summary integration, telemetry, OAuth flows |
| `mcp-server.mjs` | MCP server exposing tool surfaces (Read/Glob/Grep, qmd memory) for Codex parity and external MCP clients |
| `acp-adapter.mjs` | ACP (Agent Client Protocol) adapter for IDE integrations |
| `acp-utils.mjs` | Shared helpers for the ACP adapter |
| `preflight-cli.mjs` | CLI wrapper for `preflight.mjs` (`npm run preflight:release`) |

### Provider runner
| File | Description |
|------|-------------|
| `provider-runner.mjs` | Central provider dispatcher — Claude Agent SDK + Codex SDK streams, auth state, model selection (~46k chars) |
| `auth-context.mjs` | Builds env/auth context for provider invocations; mutable per-session |
| `chat-route.mjs` | Classifies chat input → execution route (foundation, BIP, monetization, generic) |
| `inline-decision.mjs` | Inline decision sentinel parsing/validation for AskUserQuestion-style flows |

### Foundation / BIP / monetization subsystems
| File | Description |
|------|-------------|
| `foundation-chat.mjs` | Unified Day-7 foundation chat orchestration |
| `foundation-summary-integration.mjs` | Glue between foundation-chat and the foundation-summary review loop |
| `bip-coach-state.mjs` | BIP (Build in Public) coach state machine + Google Doc/Sheet plumbing (~38k chars) |
| `bip-prompt.mjs` | Prompt builder for BIP coach |
| `bip-readiness.mjs` | BIP readiness gating logic |
| `monetization-ask-state.mjs` | Monetization-ask flow state machine |
| `monetization-ask-prompt.mjs` | Prompt builder for monetization-ask |
| `monetization-ask-result.mjs` | Result handling/normalization for monetization-ask |
| `monetization-ask-integration.mjs` | Glue between monetization-ask and the chat surface |
| `onboarding-hypothesis.mjs` | Derives + merges workspace onboarding hypothesis; accepts an injected `agentHistory` digest (attached as `recentWork`) |
| `agent-work-history.mjs` | Deterministic, redacted digest of recent agent work on a workspace from `~/.claude` (encoded project dir) + `~/.codex` (grep + cwd verify). cli-first (excludes Agentic30's own sdk-ts runs), streaming, KST-bucketed. Pure record→event reducers exported for tests; `collectAgentWorkEvents` exposes raw session-level events for the work-history indexer |
| `work-history.mjs` | History 탭 weekly retrospective indexer (schemaVersion 1). Mon–Sun local-tz week; AI session wall-clock time (Claude/Codex/Gemini) per feature area; commits (git `--all`) as activity/evidence only; session↔commit linking via file overlap (+prompt token boost); unlinked sessions → 미분류; gh CLI remote data with `github_required` fail-closed; derived-data-only snapshot at `<workspace>/.agentic30/work-history.json` (no raw prompts persisted). Optional agent refinement via injectable `queryImpl` (deterministic fallback). Hourly background + tab-entry fingerprint + manual refresh via `work_history_get`/`work_history_refresh` |
| `workspace-safety.mjs` | Single runtime source for workspace path-safety + secret redaction (`isSecretPath`, `isSecretFilename`, `redactSecrets`, `SEARCH_EXCLUDE_GLOBS`). Used by the MCP workspace tools + agent-work-history. Separate from the CI gate in `scripts/check-public-safety.mjs` |
| `readme-drift.mjs` | Deterministic README ↔ reality drift detector (recent commits/agent intents/files vs README vocabulary) → `missingFromReadme` / `staleInReadme` + suggestion |
| `generate-day1-situation-summary.mjs` | Day-1 project situation v3 summary (evidence graph, ranked diagnosis, optional reality gap, baseline, observed path, evidence-backed actions, quality gate, trust). Deterministic local floor + optional provider signals; broadcast on `workspace_scan_result.day1SituationSummary` |
| `onboarding-helper.mjs` | Onboarding helper CLI: `agentic30-onboarding --register --path X --source Y --token T` registers the current project folder by calling `registerOnboardingWorkspaceRequest` and exits. No MCP, no stdio server. No-args invocation prints usage and exits 64. |
| `onboarding-workspace-request.mjs` | Persists pending workspace registrations under `appSupport/onboarding-workspace-requests/` with 30 min TTL; verifies nonce from `AGENTIC30_ONBOARDING_NONCE_PATH` when provided; records caller-claimed source as `claimedSource` (do not treat as trusted). |
| `idd-doc-gate.mjs` | Iterative Doc Development gate (~37k chars) |
| `adaptive-curriculum.mjs` | Adaptive curriculum builder |

### Specialists / prompts
| File | Description |
|------|-------------|
| `specialist-router.mjs` | Routes to a specialist module (office-hours, plan-ceo-review, design-*, devex-*) |
| `office-hours-docs-prompt.mjs` | Builds the `/office-hours-docs` prompt that updates `docs/{ICP,GOAL,VALUES,SPEC}.md` |
| `ad-strategy-prompt.mjs` | Prompt builder for `/analyze-ads` |

### Integrations
| File | Description |
|------|-------------|
| `gws-client.mjs` | Google Workspace client — Docs/Sheets read |
| `gws-memory.mjs` | qmd-backed Google Workspace memory cache |
| `notion-oauth.mjs` | Notion OAuth flow (initiate, exchange, refresh) |
| `meta-ads.mjs` | Meta Ads API client |
| `qmd-support.mjs` | qmd guidance + MCP config for the qmd memory subsystem |
| `vendor-skill-loader.mjs` | Loads vendored gstack skills into specialists |

### Infrastructure / utilities
| File | Description |
|------|-------------|
| `session-store.mjs` | Session persistence (load/save with schema versioning) |
| `context-cache.mjs` | Cached BIP context |
| `diagnostics.mjs` | Builds diagnostics snapshots |
| `preflight.mjs` | Preflight report generator |
| `telemetry.mjs` | PostHog-style telemetry client |
| `structured-input-tools.mjs` | Helpers for structured input parsing |
| `user-input.mjs` | User input normalization helpers |

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `foundation-summary/` | Day-7 foundation-summary review loop sub-workflow (see `foundation-summary/AGENTS.md`) |
| `specialists/` | Vendored specialist prompt builders (office-hours, plan-ceo-review, design suite, devex suite) (see `specialists/AGENTS.md`) |
| `vendor/` | Vendored gstack assets — synced via `scripts/sync-gstack.mjs`, do not edit (see `vendor/AGENTS.md`) |

## For AI Agents

### Working In This Directory
- ESM only (`.mjs`). Use named exports, not default exports.
- The bridge to the Mac app is WebSocket on a localhost port; the protocol envelope shapes are tested in `agentic30Tests/SidecarEventDecodingTests.swift` and `sidecar-tests/chat-route.test.mjs`. Changing event shapes requires updates on both sides.
- Provider auth: never log raw API keys or OAuth tokens. Auth values flow through `auth-context.mjs` and are scrubbed in telemetry.
- Long-running provider streams must remain cancellable. Avoid blocking on synchronous work inside async stream consumers.
- `index.mjs` is intentionally a single large file because it owns the lifetime of the daemon — prefer extracting helpers into siblings rather than splitting `index.mjs` itself.
- Do not modify `vendor/` — it is upstream-synced.

### Testing Requirements
- Most modules in this directory have a sibling `node --test` suite in `sidecar-tests/`; a few (`ad-strategy-prompt`, `meta-ads`, `notion-oauth`, `structured-input-tools`) are exercised only indirectly through `index.mjs`. Run `npm run test:sidecar` before pushing.
- Live provider canaries are gated by `AGENTIC30_RUN_LIVE_PROVIDER_*=1` env vars.
- Schema-changing edits to `session-store.mjs`, BIP coach state, or monetization-ask state require a version bump and a migration path.

### Common Patterns
- Sentinel-bracketed inline decisions: `INLINE_DECISION_SENTINEL_START`/`END` from `inline-decision.mjs`.
- Read-only tool gating via Claude Agent SDK `canUseTool` + `allowedTools` allowlist (see `foundation-summary/index.mjs` for the pattern).
- Stateful subsystems persist to JSON in the workspace's `.agentic30/` directory.

## Dependencies

### Internal
- Mac app via WebSocket (`agentic30/SidecarBridge.swift`).
- `scripts/sync-gstack.mjs` populates `vendor/`.

### External
- `@anthropic-ai/claude-agent-sdk`, `@openai/codex-sdk`, `@modelcontextprotocol/sdk`, `@tobilu/qmd`, `ws`, `zod`.

<!-- MANUAL: -->

### Build integration

When editing `ENTRY_POINTS` in `scripts/build-sidecar.mjs`, also update the matching `inputPaths` list in the "Build Sidecar Bundle" Run Script phase of `agentic30.xcodeproj/project.pbxproj`. Xcode's incremental build graph relies on the pbxproj input list; without it, edits to new entry-point modules may not trigger a Run Script rerun even though `build-sidecar.mjs`'s own fingerprint would catch the change.
