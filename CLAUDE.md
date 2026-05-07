# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

For per-directory specifics, prefer the closest `AGENTS.md` (root + every significant subdirectory). This file covers the cross-cutting big picture.

## Commands

### Sidecar (Node)

```bash
npm install                          # install sidecar deps (run once)
npm run test:sidecar                 # node --test sidecar-tests/**/*.test.mjs
npm run sidecar                      # start the WebSocket sidecar daemon
npm run mcp                          # run sidecar/mcp-server.mjs (MCP surface)
npm run acp                          # run sidecar/acp-adapter.mjs (ACP surface)
npm run build:sidecar                # bundle sidecar for DMG distribution
npm run preflight:release            # CLI preflight report
npm run preflight:bundle             # bundle preflight checks
npm run sync:gstack                  # refresh sidecar/vendor/gstack/ from upstream pin
npm run report:timings               # aggregate response-time logs
```

Run a single sidecar test by passing `--test-name-pattern` or just the file:

```bash
node --test sidecar-tests/foundation-summary-rule-check.test.mjs
node --test --test-name-pattern "checkThreeSectionMinimal" sidecar-tests/foundation-summary-rule-check.test.mjs
```

### Mac app (Swift)

Open `agentic30.xcodeproj` in Xcode and run the `agentic30` scheme, or:

```bash
xcodebuild test -project agentic30.xcodeproj -scheme agentic30 -destination 'platform=macOS'
```

Hermetic UI subset (recommended for CI-style local runs):

```bash
xcodebuild test -project agentic30.xcodeproj -scheme agentic30 -destination 'platform=macOS' \
  -only-testing:agentic30UITests/agentic30UITests/testNativeProjectPickerSelectsDirectory \
  -only-testing:agentic30UITests/agentic30UITests/testSettingsModelPickersSelectClaudeAndCodexModels \
  -only-testing:agentic30UITests/agentic30UITests/testSidecarChatFlowHermetic
```

Live canaries are opt-in via env vars: `AGENTIC30_RUN_LIVE_PROVIDER_E2E=1`, `AGENTIC30_GOOGLE_E2E_{EMAIL,PASSWORD,TOTP_SECRET}`, `AGENTIC30_MAC_AUTH_BASE_URL`.

### Dogfood evaluator

```bash
npm run eval:dogfood                 # offline dogfood replay
npm run eval:dogfood:gate            # same, but enforces pass/fail gate
npm run eval:dogfood:live            # AGENTIC30_RUN_LIVE_PROVIDER_EVAL=1 — real provider
npm run eval:dogfood:summary         # summarize latest run
npm run eval:dogfood:compare         # diff two runs
```

Output lands in `sidecar-evals/.artifacts/` (gitignored).

## Architecture

### Two-process split: Swift shell + Node sidecar

The Mac app (`agentic30/`) is a SwiftUI/AppKit shell that owns macOS surface area: menu bar extra, workspace window, settings, Keychain, OAuth presentation, the floating wolf pet overlay, and the WebSocket client to the sidecar. It does **not** call provider APIs directly. All provider execution, MCP/ACP, workspace introspection, BIP coach state, foundation-summary review loop, monetization-ask flow, Google Workspace, and Notion OAuth live in the Node sidecar (`sidecar/`).

The bridge is a localhost WebSocket. `agentic30/SidecarBridge.swift` ↔ `sidecar/index.mjs`. **Any change to event envelopes, route classifications, or session-store schema must be reflected on both sides** — Swift decoders live in `agentic30Tests/SidecarEventDecodingTests.swift` and `agentic30Tests/ChatMessageDecodingTests.swift`; sidecar emitters live throughout `sidecar/index.mjs` and the route classifier in `sidecar/chat-route.mjs`.

`AgenticViewModel.swift` is the Mac side's central nervous system (~135k chars). It is large by design — auth, sessions, provider routing, BIP coach, onboarding hypothesis, mission UI all hang off it. Prefer adding tests + composable additions over restructuring it.

`sidecar/index.mjs` is the Node side's central nervous system (~226k chars). Same reasoning: it owns the daemon's lifetime. Extract helpers into siblings (e.g., `sidecar/chat-route.mjs`, `sidecar/auth-context.mjs`) rather than splitting `index.mjs`.

### Provider parity (Claude + Codex)

`sidecar/provider-runner.mjs` dispatches to either the Claude Agent SDK or the Codex SDK. Both must be supported for general chat routes. Auth env construction goes through `sidecar/auth-context.mjs` — never log raw keys or OAuth tokens; telemetry is scrubbed there.

Some sub-workflows are intentionally Claude-only because they call the Claude Agent SDK `query()` directly (e.g. `sidecar/foundation-summary/`); the Mac side gates these via `AgenticViewModel` so a Codex-only session fails closed rather than silently degrading.

`sidecar/mcp-server.mjs` is a separate MCP surface for external clients (it exposes workspace tools like `list_workspace_files`, `read_workspace_file`, `search_workspace`, `read_project_doc`); it is not the conduit by which Claude-only sub-workflows get tools.

Auth precedence is: Claude Code login or `ANTHROPIC_API_KEY`; Codex login or `CODEX_API_KEY`/`OPENAI_API_KEY`. At least one provider must be available at runtime.

### Foundation-summary READ-ONLY contract

`sidecar/foundation-summary/` enforces "agent reads, user writes" via a strict tool allowlist (`Read`, `Glob`, `Grep`, `AskUserQuestion`) plus a fail-closed `canUseTool` callback. Outputs land under `<workspace>/.agentic30/foundation/`. Do not extend the allowlist — tests pin the contract.

### Stateful subsystems

These all persist JSON state (versioned schemas; bumping schema requires a migration test):

- BIP coach (`sidecar/bip-coach-state.mjs`) — Build in Public flow, drives Google Doc/Sheet integration via `sidecar/gws-client.mjs`.
- Monetization-ask (`sidecar/monetization-ask-state.mjs`) — three-file split: state / prompt / result.
- Onboarding hypothesis (`sidecar/onboarding-hypothesis.mjs`) — derives + merges per-workspace.
- Session store (`sidecar/session-store.mjs`) — `SESSION_STORE_SCHEMA_VERSION` is the migration anchor.

Inline decisions (single-shot AskUserQuestion-style flows) are sentinel-bracketed: see `INLINE_DECISION_SENTINEL_START`/`END` in `sidecar/inline-decision.mjs`. Any path that produces or parses these must use the helpers, not raw string surgery.

### Specialists vs. vendored gstack

`sidecar/specialists/` is the project's own catalog of prompt builders (office-hours, plan-ceo-review, design suite, devex suite). Each module exports `{ ID, NAME, PHASES, DECISIONS, SUMMARY, buildPrompt }` and is registered in `sidecar/specialists/index.mjs`. `buildPrompt` must be pure.

`sidecar/vendor/gstack/` is **vendored upstream** content synced via `scripts/sync-gstack.mjs` according to `scripts/gstack-pin.json`. Never edit `vendor/` by hand — overwritten on every sync. To adapt a skill, copy the relevant fragment into `sidecar/specialists/` and modify there.

### Product source-of-truth docs

`docs/ICP.md`, `docs/GOAL.md`, `docs/VALUES.md`, `docs/SPEC.md` are the canonical product-shape documents. They are managed by the `/office-hours-docs` assistant command (prompt builder at `sidecar/office-hours-docs-prompt.mjs`) and consumed at runtime by sidecar prompts and the foundation-summary review loop. Schema-breaking edits (heading restructure, section removal) must be paired with prompt updates and `npm run test:sidecar` passes.

### UI testing posture

UI tests run hermetically by default via `--ui-testing-opaque-window` and `AGENTIC30_TEST_STUB_PROVIDER=1`. New views must respect the stub flag so screenshots stay pixel-stable. Avoid time-of-day or network-dependent assertions — both Swift and sidecar test suites must remain deterministic (called out in `CONTRIBUTING.md`).

### Pet/wolf overlay

`agentic30/Pet/` is a borderless always-on-top NSWindow. The state machine maps sidecar events (delivered via `sidecar/pet-hooks.mjs`) to wolf moods. Adding a new wolf state requires sprite assets in `agentic30/wolf/`, a `WolfState` enum case, plus matching emitter on the sidecar side.

### Distribution posture

v1 distribution target is direct DMG, **not** the Mac App Store. App Sandbox is intentionally disabled because the app spawns a Node child process (`NodeExecutableResolver.swift` locates Node via `NODE_BINARY`, common paths, mise/asdf/Volta shims, and login shell `PATH`) and accesses user-selected workspace paths. Hardened Runtime, Developer ID signing, notarization, and updater validation are release blockers — see `docs/release-checklist.md`.

Forks: change Bundle ID from `october-academy.agentic30` to your own to avoid Keychain/Launch Services collisions.

### AGENTS.md hierarchy

Per-directory `AGENTS.md` files exist throughout the tree (root, `agentic30/`, `agentic30/Pet/`, `sidecar/`, `sidecar/foundation-summary/`, etc.). Each non-root file starts with `<!-- Parent: ../AGENTS.md -->` and ends with a `<!-- MANUAL: -->` marker — content below that marker is preserved on regeneration; auto-generated sections above it can be rewritten. When you make significant structural changes, update the affected `AGENTS.md` instead of letting it drift.
