<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-06-20 | Commit: 6f0fc7e | Branch: main -->

# sidecar

## OVERVIEW
Node.js ESM sidecar launched by the macOS app. Owns the localhost WebSocket daemon, provider execution, MCP/ACP entry points, workspace scans, curriculum/program state, BIP, foundation-summary integration, monetization, onboarding hypothesis, morning briefing, integrations, and telemetry.

## STRUCTURE
| Path | Purpose |
|------|---------|
| `index.mjs` | Main WebSocket daemon and sidecar lifetime owner |
| `mcp-server.mjs`, `qmd-bootstrap-worker.mjs` | MCP server and QMD worker entry points |
| `onboarding-helper.mjs`, `preflight-cli.mjs` | Helper CLI registration and diagnostics CLI entry points |
| `acp-adapter.mjs`, `acp-utils.mjs` | Agent Client Protocol surface |
| `provider-runner.mjs`, `auth-context.mjs` | Claude, Codex, Gemini, Cursor execution and scrubbed auth env |
| `telemetry.mjs`, `error-telemetry.mjs`, `ai-generation-telemetry.mjs` | PostHog capture pipeline, error/log forwarding, and `$ai_generation` LLM-analytics emission for provider runs |
| `chat-route.mjs`, `inline-decision.mjs`, `structured-input-tools.mjs` | Routing and structured decision contracts |
| `icp-fit-assessment.mjs` | Deterministic item-by-item match of the founder against `docs/ICP.md`'s 5 required conditions; powers the Day-1 fast-path ICP checklist + costume naming (pure, unit-tested) |
| `foundation-chat.mjs`, `foundation-summary-integration.mjs` | Unified foundation chat and Day-7 summary glue |
| `bip-*.mjs`, `monetization-ask-*.mjs`, `onboarding-*.mjs` | Stateful product subsystems |
| `program-gate-engine.mjs`, `day-progress-state.mjs`, `mission-card.mjs` | 30-day program gates, progress, bridge events |
| `action-day-*.mjs`, `review-day-*.mjs` | Evidence verification and review-day composition |
| `morning-briefing*.mjs`, `news-market-radar.mjs`, `work-history.mjs` | Briefing, external digest, history surfaces |
| `workspace-*.mjs`, `local-discovery.mjs`, `read-only-workspace-tool-policy.mjs` | Workspace scan/safety/discovery |
| `github/posthog/cloudflare/vercel/exa *-mcp-config*.mjs` | Integration settings and OAuth/API-key config |

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Bridge event shape | `index.mjs`, Swift decoders in `../agentic30/` | Update both sides and tests |
| Provider auth/execution | `provider-runner.mjs`, `auth-context.mjs`, `provider-sdk-contracts.mjs` | Never log secrets or tokens |
| Workspace scanning | `index.mjs`, `scan-provider-select.mjs`, `workspace-safety.mjs` | Read-only provider readiness is fail-closed |
| Office Hours cards | `office-hours-structured-input.mjs`, `office-hours-resume.mjs`, `index.mjs` | Provider channels converge through card-ready payloads |
| MCP OAuth status | `mcp-oauth-prewarm.mjs`, `mcp-oauth-state.mjs`, `integration-status.mjs` | Durable state is verification only, never tokens |
| State schema changes | `session-store.mjs`, `bip-coach-state.mjs`, `monetization-ask-state.mjs`, `day-progress-state.mjs` | Bump schema and add migration tests |
| Build bundle inputs | `../scripts/build-sidecar.mjs`, `../agentic30.xcodeproj/project.pbxproj` | Keep `ENTRY_POINTS` and Xcode input paths in sync; remove stale inputs |

## CONVENTIONS
- ESM only. Prefer explicit named exports and small pure helpers beside the owner module.
- `index.mjs` is intentionally large because it owns daemon lifetime; extract helpers, but do not split lifetime orchestration casually.
- Provider streams must remain cancellable and avoid synchronous blocking inside async stream consumers.
- Workspace-derived state persists under `<workspace>/.agentic30/` with versioned schemas.
- `workspace-safety.mjs` is the runtime path-safety/secret-redaction source; `scripts/check-public-safety.mjs` is the repo CI gate.
- Bundle entry points are `index.mjs`, `qmd-bootstrap-worker.mjs`, `mcp-server.mjs`, `onboarding-helper.mjs`, `acp-adapter.mjs`, and `preflight-cli.mjs`.

## ANTI-PATTERNS
- Do not add write-capable tools to read-only provider or foundation-summary paths.
- Do not parse inline-decision sentinels with ad hoc string surgery.
- Do not add provider-specific behavior that breaks Claude/Codex parity unless the app gate explicitly fails closed.
- Do not persist raw prompts, provider tokens, OAuth credentials, or raw external event rows.
- Do not leave Xcode Run Script `inputPaths` pointing at removed sidecar files.

## TESTS
`npm run test:sidecar`; single files via `node --test sidecar-tests/<module>.test.mjs`. Live provider canaries are gated by `AGENTIC30_RUN_LIVE_PROVIDER_*=1`.

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

### Day-1 get_users LLM-card path

Day-1 `get_users` now uses the same generic Office Hours LLM-card path as `build_product` and `make_money`. Do not reintroduce host-owned get_users cards, attempt reducers, or receipt-gated attempt evidence for this Day-1 flow. Hard evidence checks remain in the shared docs/proof-ledger evidence surfaces, not as a get_users card-generation prerequisite.
