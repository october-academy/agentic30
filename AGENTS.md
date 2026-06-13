<!-- Generated: 2026-05-07 | Updated: 2026-05-07 -->

# agentic30-public

## Purpose
Native macOS menu bar assistant that pairs a SwiftUI app shell with a local Node.js sidecar. The Mac app owns macOS surface area (floating panel, settings, Keychain, OAuth presentation, pet/wolf UI, menu bar extra) while the sidecar handles provider execution (Claude Agent SDK, Codex SDK), MCP/ACP adapters, workspace introspection, session persistence, BIP coach state, foundation-summary review loop, and Google Workspace integration. Public companion to the private October Academy `agentic30` learning platform — code merges here flow back into the platform via a one-way submodule pointer bump.

## Key Files

| File | Description |
|------|-------------|
| `package.json` | Sidecar npm manifest: `test:sidecar`, `eval:dogfood`, `build:sidecar`, `sidecar`, `mcp`, `acp`, `preflight:*`, `sync:gstack` scripts; deps include Claude Agent SDK, Codex SDK, MCP SDK, qmd, ws, zod |
| `package-lock.json` | Pinned npm dependency tree |
| `README.md` | Run-locally guide, runtime requirements (macOS 26.4 SDK, Node 20+), UI E2E modes, contributor checks, distribution posture (DMG, not MAS) |
| `CONTRIBUTING.md` | PR guidelines, fork-and-sign instructions, public/private repo relationship to October Academy |
| `CODE_OF_CONDUCT.md` | Contributor Covenant |
| `LICENSE` | License file |
| `.gitignore` | Excludes `node_modules/`, `dist/`, `sidecar-build/`, `sidecar-evals/.artifacts/`, `.omc/`, `.omx/`, `.env*`, `xcuserdata/` |

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `agentic30/` | SwiftUI macOS app source (see `agentic30/AGENTS.md`) |
| `agentic30.xcodeproj/` | Xcode project — do not edit by hand; use Xcode |
| `agentic30Tests/` | XCTest unit tests for Swift code (see `agentic30Tests/AGENTS.md`) |
| `agentic30UITests/` | XCTest UI tests including hermetic E2E with stub provider (see `agentic30UITests/AGENTS.md`) |
| `sidecar/` | Node.js sidecar — provider runner, MCP/ACP, foundation-summary, BIP coach, specialists (see `sidecar/AGENTS.md`) |
| `sidecar-tests/` | `node --test` integration suite for sidecar modules (see `sidecar-tests/AGENTS.md`) |
| `sidecar-evals/` | Dogfood simulation evaluator with judge + compare/summary tools (see `sidecar-evals/AGENTS.md`) |
| `scripts/` | Build, sync, preflight, and verification scripts (see `scripts/AGENTS.md`) |
| `docs/` | Product docs (ICP, GOAL, VALUES, SPEC), release/known-limitations, response-time plan (see `docs/AGENTS.md`) |
| `.github/` | GitHub issue templates and PR template (see `.github/AGENTS.md`) |

## For AI Agents

### Working In This Directory
- The Swift app and the Node sidecar are coupled via a WebSocket bridge (`SidecarBridge.swift` ↔ `sidecar/index.mjs`). Changes to message envelopes, event types, or session-store schema must be reflected on both sides.
- Do not modify `sidecar/vendor/` directly — it is synced from upstream via `scripts/sync-gstack.mjs`.
- Provider execution must support both Claude (Anthropic) and Codex (OpenAI) auth paths. Test fixtures often gate live runs behind `AGENTIC30_RUN_LIVE_PROVIDER_*=1` env vars.
- Hermetic UI tests rely on `--ui-testing-opaque-window` and `AGENTIC30_TEST_STUB_PROVIDER=1`. Do not introduce non-determinism (time-of-day, network) into UI assertions.
- Blocking local UI E2E requires explicit user approval before execution because XCUITest launches Agentic30 in the foreground and can take keyboard, mouse, and focus. This includes the `agentic30UITests` scheme, full `agentic30` scheme tests, `-only-testing:agentic30UITests/*`, and any macOS XCUITest that opens the app and clicks or types. Ask with the structured question tool available to you (Codex: `request_user_input`/`ask_user_question`; Claude: `AskUserQuestion`/`ask_user_question`) using: "이 명령은 Agentic30 앱을 전면으로 띄우고 키보드/마우스/포커스를 점유할 수 있습니다. 지금 실행할까요?" If the user does not approve, do not run it. After approval, set `AGENTIC30_ALLOW_BLOCKING_UI_E2E=1`.
- Distribution target is direct DMG, not the Mac App Store. App Sandbox is intentionally disabled because the app spawns a Node child process and accesses user-selected workspace paths.

### Testing Requirements
- Sidecar logic: `npm run test:sidecar` (uses `node --test` against `sidecar-tests/**/*.test.mjs`).
- Swift unit tests: `npm run test:swift:unit` (does not run XCUITest).
- UI E2E smoke/full: `AGENTIC30_ALLOW_BLOCKING_UI_E2E=1 npm run test:swift:ui:smoke` or `AGENTIC30_ALLOW_BLOCKING_UI_E2E=1 npm run test:swift:ui:full` after local approval. GitHub Actions or a self-hosted Mac runner may run UI E2E without local desktop approval.
- Dogfood evaluator: `npm run eval:dogfood` (offline) or `npm run eval:dogfood:live` (provider canary).
- Run both Swift and sidecar suites before any PR that touches the bridge contract.

### Common Patterns
- Sidecar modules are ES modules (`.mjs`) with explicit named exports; treat them like a library, not a framework.
- BIP coach, foundation-summary, monetization-ask, and onboarding-hypothesis are stateful subsystems with their own persistence; check the state schema before mutating.
- Inline decisions use sentinel-bracketed payloads (`INLINE_DECISION_SENTINEL_START/END`) — see `sidecar/inline-decision.mjs`.

## Dependencies

### External
- `@anthropic-ai/claude-agent-sdk` — Claude provider runner and tool gating
- `@openai/codex-sdk` — Codex provider runner
- `@modelcontextprotocol/sdk` — MCP server bindings (`sidecar/mcp-server.mjs`)
- `@tobilu/qmd` — qmd memory subsystem
- `ws` — WebSocket bridge between Mac app and sidecar
- `zod` — runtime schema validation

### Internal
- The Swift app expects the sidecar binary at runtime; locate Node via `NodeExecutableResolver.swift`.
- `sidecar/vendor/gstack/` provides shared Claude/Codex skill assets used by `sidecar/specialists/`.

<!-- MANUAL: Custom project notes can be added below -->
