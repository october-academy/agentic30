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
| `provider-runner.mjs` | Central provider dispatcher — Claude Agent SDK, Codex SDK, Gemini (Gen AI), Cursor (`@cursor/sdk`) streams, auth state, model selection (~46k chars) |
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
| `workspace-gitignore.mjs` | Keeps `<workspace>/.agentic30/` out of git: `ensureAgentic30Gitignored` appends/creates a `.gitignore` entry (ancestor `.git` walk covers monorepo subdir workspaces; `!.agentic30/` negation = durable user opt-in, never overridden). Fail-soft statuses, never throws. Wired at `runWorkspaceScan` start + once per daemon start (`onlyIfAgentic30Exists`) |
| `readme-drift.mjs` | Deterministic README ↔ reality drift detector (recent commits/agent intents/files vs README vocabulary) → `missingFromReadme` / `staleInReadme` + suggestion |
| `generate-day1-situation-summary.mjs` | Day-1 project situation v3 summary (evidence graph, ranked diagnosis, optional reality gap, baseline, observed path, evidence-backed actions, quality gate, trust). Deterministic local floor + optional provider signals; broadcast on `workspace_scan_result.day1SituationSummary` |
| `onboarding-helper.mjs` | Onboarding helper CLI: `agentic30-onboarding --register --path X --source Y --token T` registers the current project folder by calling `registerOnboardingWorkspaceRequest` and exits. No MCP, no stdio server. No-args invocation prints usage and exits 64. |
| `onboarding-workspace-request.mjs` | Persists pending workspace registrations under `appSupport/onboarding-workspace-requests/` with 30 min TTL; verifies nonce from `AGENTIC30_ONBOARDING_NONCE_PATH` when provided; records caller-claimed source as `claimedSource` (do not treat as trusted). |
| `idd-doc-gate.mjs` | Iterative Doc Development gate (~37k chars) |
| `adaptive-curriculum.mjs` | Adaptive curriculum builder |

### 30-day program (gates / evidence / adaptive rules — spec `docs/specs/agentic30-30day-adaptive-program.md`)
| File | Description |
|------|-------------|
| `program-gate-engine.mjs` | Milestone gate engine (G1–G7): pure, idempotent evaluation persisted to `<ws>/.agentic30/gate-ledger.json` (schema v1). Owns the §15.3 recovery substitution table, §13.4 intervention tokens (once per gate, program cap 3, dueDay expiry), §21 provisional overlays, and `evaluateDayProgressPatchGate` — wired BEFORE `patchDayStep` in index.mjs (the authority seat) |
| `proof-ledger-write-through.mjs` | Terminal verification verdicts (auto pass → verified/strong, judge accepted → strength by curriculum actionType, insufficient → weak) written through to proof-ledger `action_evidence` events; judge errors/auto failures never write (fail-closed) |
| `mission-card.mjs` | `mission_card` bridge event for execution-step entry: IDD mission + evidence spec (education/review days are evidence-free) + gate context; gate-ledger substitutions override the mission |
| `active-users-snapshot.mjs` | §15.4 active-user store (`.agentic30/metrics/active-users.json`): one cumulative `first_value` HogQL query, piggybacked on the morning-briefing cycle; `latestFirstValueSignal` feeds G4② |
| `oh-intervention.mjs` / `oh-intervention-prompts.mjs` | §13 system-triggered Office Hours interventions: the prompts module OWNS the trigger registry (unregistered triggers never fire); the wiring module builds `office_hours_intervention_required` events, the session-contract context block, and commitment-confirmed token issuance |
| `adaptive-rules.mjs` / `adaptive-rule-signals.mjs` | §12 MVP rules AR-01/02/05/07/08/14/17/19 evaluated over persisted-store signals; firings land in gate-ledger `adaptiveEvents` (one per rule per day), false-positive labels impose a 48h cooldown, AR-17 enforces the new-commitment block |

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
- Office Hours structured input ("three providers, one card"): `office-hours-structured-input.mjs` is the single source of truth. `officeHoursStructuredInputChannel(provider)` describes how each provider asks a forcing question (claude → `AskUserQuestion` tool, codex → `agentic30_request_user_input` MCP tool, gemini → `inline_decision` sentinel — text-only). All channels converge through `prepareOfficeHoursStructuredInputRequest`, the single "make card-ready" entry point: it canonicalizes demand choices, normalizes each question's presentation (intent-derived Korean header fallback so the card title never shows a raw placeholder; validated `highlightPhrases`/`emphasis` spans for consistent statement styling — the tool schemas in `mcp-server.mjs` + `normalizeClaudeQuestions` carry these through), and stamps an `office_hours*` `generation.mode`. With the stamp the Mac timeline renders a stacked submitted card (not a "you" bubble) and submit logs an Office Hours turn. The `generation.mode` `office_hours` prefix is the Swift card-vs-bubble switch (`isOfficeHoursStructuredPrompt`). Result: the stacked card is provider-identical (Claude/Codex/Gemini); the only residual difference is inter-card prose-bubble count (tool channels block-and-resume one run; Gemini, being text-only, continues per answer), which is intrinsic to the channel, not the card.
- Interview resume (Day 1 + Day 2+ standard): in-flight interview state (provider stream, question index, pendingUserInput) dies with the daemon and `sessions.json` is wiped on boot, so `runOfficeHours` rebuilds an in-progress interview from the two stores that survive — `.agentic30/day-progress.json` (the day's kind-scoped interview step still `active`: `day1` → `first_interview`, `standard` → `interview`; unknown kinds fail closed to a fresh start) + `.agentic30/memory/office-hours-turns.json` (answered day-scoped turns, deduped per question keep-last). Pure gating/preamble helpers live in `office-hours-resume.mjs`; `index.mjs` seeds the prior Q/A into the new session transcript with the `officeHoursSeededTurn` wire marker (decoded by `ChatMessage`, pinned in `agentic30Tests/ChatMessageDecodingTests.swift`; the Mac exempts seeded rows from snapshot-based hiding/dedup since their card snapshots died with the prior session) and stamps `session.runtime.officeHours.resumedTurns` with OTHER-session turns only (the Mac retry path reuses the same failed session, whose own turns the incomplete-interview detector already counts). A concluded resume skips the provider run entirely and settles idle: turns ≥ expected, or a `terminal: true` turn (대안 비교 closing-card answer — smart-skip interviews legitimately end below the expected count), which also restores `runtime.officeHours.terminalAnswered` from the durable turn flag so the Mac interview-complete gate and the incomplete-interview detector treat the resumed session as done. The commitment bar closes the interview from the seeded count + day-progress.
- Past-day Office Hours snapshot: the Day timeline scopes the live Office Hours screen by day and the Mac auto-start fires for whichever day-scoped session it lands on, so `runOfficeHours` gates on `isPastOfficeHoursSnapshotDay` (`office-hours-resume.mjs`) — a start whose day is strictly before the challenge-elapsed day never runs a provider (and never resumes the interview). It rebuilds the read-only transcript from that day's turn log via `selectOfficeHoursSnapshotTurns` (same seeded-row shape/`officeHoursSeededTurn` marker as resume, but deliberately ignoring day-progress step state — the day is over) and settles idle. The gate sits BEFORE the Day 2+ source gate so viewing a past Day 2+ never surfaces a source-gate error. Same-day relaunches keep the resume path; day 999 and unknown elapsed days fail open.
- Commitment-close candidates: the interview's last stage (the commitment bar) mirrors the interview's option pattern — `office-hours-commitment-suggest.mjs` (pure prompt builder + parser + merge) turns THIS interview's turn log + open memory threads into ≤3 next-customer-action proposals. `index.mjs` serves them via `office_hours_commitment_candidates_request` → broadcast `office_hours_commitment_candidates` (`generating` → `ready`), generated read-only through `runProviderStream` with a soft timeout. Fail-open everywhere: missing provider/timeout/junk output still emit `ready` with the memory-thread fallback, so the close never blocks. Proposals only — the user-origin gate in `office-hours-memory.mjs` still governs the actual commitment write.
- Read-only tool gating via Claude Agent SDK `canUseTool` + `allowedTools` allowlist (see `foundation-summary/index.mjs` for the pattern).
- Stateful subsystems persist to JSON in the workspace's `.agentic30/` directory.

## Dependencies

### Internal
- Mac app via WebSocket (`agentic30/SidecarBridge.swift`).
- `scripts/sync-gstack.mjs` populates `vendor/`.

### External
- `@anthropic-ai/claude-agent-sdk`, `@openai/codex-sdk`, `@google/genai`, `@cursor/sdk`, `@modelcontextprotocol/sdk`, `@tobilu/qmd`, `ws`, `zod`.

<!-- MANUAL: -->

### Workspace-scan fail-closed gate

The scan's agent verification never falls back to local-only signals. `runWorkspaceScanAgent` (index.mjs) returns a structured outcome (`{ ok, reason: "unavailable" | "usage_limit" | "error" }`); when the foreground scan gets no successful outcome it broadcasts `workspace_scan_blocked` (instead of `workspace_scan_result`) carrying `nextProvider`/`availableProviders` computed by `selectNextScanProvider` in `scan-provider-select.mjs` over the provider consent chain filtered by `getProviderScanReadiness(...).scanReady`. Cursor remains in the generic provider cycle for non-scan paths, but workspace scan must not recommend Cursor until it has enforceable read-only tool gating (`scanSupported: false`, `scanReady: false`). `nextProvider: null` means no scan-ready provider is available and the UI must say Agentic30 cannot proceed. Switching always requires the user's click (`rescanWorkspace` on the Mac side). Background context refreshes (`day_completed`) skip failed outcomes silently. Contract pinned by `sidecar-tests/workspace-scan-blocked.test.mjs`; the stub provider answers the scan prompt with valid empty JSON so hermetic tests stay on the success path.

### Cursor provider

`runCursorProvider` (provider-runner.mjs) runs `@cursor/sdk` `Agent.create` → `send` → `run.stream()` with `local.cwd = workspaceRoot`. Auth is API-key only (`CURSOR_API_KEY` env or settings `cursor.apiKey`); there is no browser/CLI login flow. Execution modes are gated by `supportsCursorExecutionMode` — the read-only judge modes are excluded because a local Cursor agent has filesystem tools and cannot guarantee text-only execution. Usage limits surface as `RateLimitError` (name/status 429), covered by `isProviderUsageLimitError`. The package stays unbundled in `scripts/build-sidecar.mjs` (`EXTERNAL_CLOSURE_PACKAGES`) because it ships sqlite3 (native addon) in its dependency closure.

### Build integration

When editing `ENTRY_POINTS` in `scripts/build-sidecar.mjs`, also update the matching `inputPaths` list in the "Build Sidecar Bundle" Run Script phase of `agentic30.xcodeproj/project.pbxproj`. Xcode's incremental build graph relies on the pbxproj input list; without it, edits to new entry-point modules may not trigger a Run Script rerun even though `build-sidecar.mjs`'s own fingerprint would catch the change.

### Morning-briefing drilldowns

`morning-briefing-drilldown.mjs` builds the per-source drilldown payloads (`briefing.drilldowns.{cloudflare,github,posthog}`). GitHub is collected locally from `git`/`gh` CLI (deterministic, stub `execImpl` in tests); Cloudflare/PostHog ride the same provider digest call via `buildMorningBriefingExternalDigestPrompt` + `normalizeMorningBriefingExternalDigest` — aggregates only, never raw event rows. Every ready source is guaranteed a drilldown: richer provider/CLI payloads win, and `ensureMorningBriefingDrilldowns` fills gaps with a counts-grade drilldown built from already-collected aggregates (never invented numbers); not-ready sources get none. Swift decoders live in `agentic30/AgenticModels.swift` (`MorningBriefingDrilldown*`), screen in `agentic30/MorningBriefingDrilldownView.swift`; keep both sides in sync.

### Integration wiring (Settings > 연동)

`github-mcp-config.mjs` rides `gh auth token` (60s cache; env `GITHUB_MCP_TOKEN`/`GITHUB_PERSONAL_ACCESS_TOKEN`/`GITHUB_TOKEN` win) to inject the official GitHub MCP into provider sessions — same `uses*Mcp` execution-mode gates as PostHog/Cloudflare in `provider-runner.mjs`. `integration-status.mjs` answers the `integration_status_check` socket message with live probes (gh auth status, PostHog `/api/users/@me`, Cloudflare `/zones`) so the Settings badges mean "verified against the real service", not "field non-empty". PostHog/Cloudflare MCP auth is OAuth-first: configs are emitted URL-only (provider runs its native browser login; works with zero stored keys) and a stored key only upgrades the briefing drilldowns to direct API aggregation — `mcpAuthMode: "api_key"` (config/env) is the explicit escape hatch that pins the Bearer header. Probe shapes `{ state: ready|missing|failed, detail }` are decoded by `IntegrationStatusSnapshot` in `agentic30/AgenticModels.swift`.

`mcp-oauth-prewarm.mjs` backs the Settings "MCP 연결" button (`mcp_oauth_connect` socket message). OAuth-first MCPs can't be verified by a settings probe (the token lives in the provider's own cache), so the prewarm runs a minimal provider query in a dedicated execution mode (`mcp_oauth_prewarm_posthog` / `mcp_oauth_prewarm_cloudflare` — injects only the target MCP server, read-only by construction). Field-measured handshake: an unauthorized server exposes only `mcp__<server>__authenticate`/`complete_authentication` placeholder tools — there is no automatic browser login on first tool use. The prompt therefore instructs the model to call `authenticate` when only placeholders exist; the returned login URL is streamed out via an `MCP_PREWARM_LOGIN_URL:` sentinel line, relayed as `mcp_oauth_connect_status` progress events (the Mac side opens the browser), and the run ends in `MCP_PREWARM_OK` / `MCP_PREWARM_LOGIN_PENDING` / `MCP_PREWARM_FAIL`. OAuth tokens persist in the provider's cache across runs (field-verified), so a `login_pending` first attempt triggers automatic rechecks with a verify-only prompt (`buildMcpOauthVerifyPrompt` — never calls `authenticate`, which would issue a fresh URL and break the user's in-progress login); this closes the race where the user finishes the browser login after the model's last in-run retry. Result shape `{ server, provider, state: ready|login_pending|failed, detail, loginUrl?, checkedAt }` is decoded by `McpOauthConnectResult` (Swift) and rides the `mcp_oauth_connect_result` event together with a refreshed `integrationStatus`.

`mcp-oauth-state.mjs` persists the latest prewarm result per server to `<appSupport>/mcp-oauth-state.json` (verification fact only — no tokens touch disk). This is the only durable evidence that an OAuth-first MCP is connected, so readiness checks treat it as equivalent to a stored API key: `daily-office-hours-digest.mjs#externalSourceStatus` (the briefing/Office Hours source gate) and `integration-status.mjs` probes report `ready` when `tokenValid OR isMcpOauthServerReady(...)`. Without this, an OAuth-connected PostHog/Cloudflare renders forever as "token missing" in the morning briefing (the original bug). The latest attempt wins — a failed reconnect downgrades a previously ready server; `login_pending` never counts as ready.
