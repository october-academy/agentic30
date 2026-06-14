<!-- Generated: 2026-06-14 | Commit: 230c007 | Branch: main -->

# PROJECT KNOWLEDGE BASE: agentic30-public

## OVERVIEW
Native macOS menu bar assistant with a SwiftUI/AppKit shell and a local Node.js ESM sidecar. The app owns macOS surfaces, Keychain/OAuth, telemetry preferences, and the WebSocket client; the sidecar owns provider execution, MCP/ACP, workspace scanning, curriculum state, foundation-summary review, BIP, and external integrations.

## STRUCTURE
```
agentic30-public/
├── agentic30/              # Swift app target; not SwiftPM
├── agentic30.xcodeproj/    # Xcode project; edit deliberately, not by hand casually
├── agentic30Tests/         # Swift XCTest unit coverage
├── agentic30UITests/       # Blocking desktop XCUITest coverage
├── sidecar/                # Node ESM daemon, MCP/ACP, provider runners
├── sidecar-tests/          # node:test integration suite
├── sidecar-evals/          # dogfood evaluator and fixtures
├── scripts/                # build, release, sync, preflight, test wrappers
├── docs/                   # product, specs, diagnostics, release docs
└── .github/                # workflows, PR template, issue templates
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| App entry / menus / windows | `agentic30/agentic30App.swift` | `@main`, `AppDelegate`, MenuBarExtra, workspace window |
| Main app state / routing | `agentic30/AgenticViewModel.swift` | Large by design; bridge events, auth, sessions, missions, UI state |
| Swift ↔ Node bridge | `agentic30/SidecarBridge.swift`, `sidecar/index.mjs` | Envelope/schema changes require both sides plus tests |
| Provider execution | `sidecar/provider-runner.mjs`, `sidecar/auth-context.mjs`, `sidecar/chat-route.mjs` | Claude, Codex, Gemini, Cursor paths; scrub auth values |
| MCP / ACP surfaces | `sidecar/mcp-server.mjs`, `sidecar/acp-adapter.mjs` | Separate entry points, both bundled for release |
| Foundation summary | `sidecar/foundation-summary/` | Claude-only read-only sub-workflow; fail-closed allowlist |
| BIP / program state | `sidecar/bip-coach-state.mjs`, `sidecar/program-gate-engine.mjs`, `sidecar/day-progress-state.mjs` | JSON schemas need migrations when changed |
| Specialist prompts | `sidecar/specialists/`, `sidecar/vendor/gstack/` | Modify project specialists, not vendored upstream |
| Swift unit tests | `agentic30Tests/` | XCTest, no real sidecar process |
| UI E2E | `agentic30UITests/`, `scripts/xcode-test.sh` | Requires explicit local approval before launching |
| Sidecar tests | `sidecar-tests/` | `node:test`, deterministic fakes |
| Dogfood eval | `sidecar-evals/` | Offline by default; live mode env-gated |
| Release / CI | `scripts/`, `.github/workflows/` | PKG primary, DMG fallback, Sparkle update archive |

## CODE MAP
| Symbol | Type | Location | Refs | Role |
|--------|------|----------|------|------|
| `agentic30App` | Swift `@main` struct | `agentic30/agentic30App.swift:26` | LSP | App process entry |
| `AppDelegate` | Swift class | `agentic30/agentic30App.swift:81` | LSP | App lifecycle, updater, workspace window |
| `SidecarBridge` | Swift class | `agentic30/SidecarBridge.swift:31` | LSP | Launches Node, authenticates WebSocket, decodes events |
| `AgenticViewModel` | Swift class | `agentic30/AgenticViewModel.swift:2233` | LSP | Observable app state and command dispatcher |
| `SidecarEvent` | Swift struct | `agentic30/AgenticViewModel.swift:12224` | LSP | Swift decoder for sidecar event envelope |
| `index.mjs` | Node entry | `sidecar/index.mjs` | rg | WebSocket daemon and sidecar lifetime owner |
| `runDogfoodSimulation` | Node export | `sidecar-evals/dogfood-simulation.mjs:33` | rg | Dogfood evaluator runner |
| `build-sidecar.mjs` | Node script | `scripts/build-sidecar.mjs` | rg | Bundles Node entry points into app distribution |

## CONVENTIONS
- Swift uses an Xcode project layout, not SwiftPM. Add files to the proper target membership when needed.
- Node code is ESM (`.mjs`) with explicit named exports; `package.json` is the command registry.
- There is no repo-level ESLint, Prettier, EditorConfig, SwiftLint, or SwiftFormat config. Follow local style and tests.
- Sidecar stateful subsystems persist versioned JSON under the selected workspace's `.agentic30/`; schema bumps require migration coverage.
- Release distribution is Developer ID signed/notarized PKG first, DMG fallback, plus Sparkle appcast. Mac App Store and App Sandbox are intentionally out of scope.

## ANTI-PATTERNS
- Do not edit `sidecar/vendor/` directly. It is synced from upstream by `scripts/sync-gstack.mjs`.
- Do not run local UI E2E without explicit approval. Ask: "이 명령은 Agentic30 앱을 전면으로 띄우고 키보드/마우스/포커스를 점유할 수 있습니다. 지금 실행할까요?" Then set `AGENTIC30_ALLOW_BLOCKING_UI_E2E=1`.
- Do not introduce time-of-day, locale, network, or live-provider assumptions into default tests.
- Do not log raw API keys, OAuth tokens, Keychain values, or workspace secrets.
- Do not hand-roll inline-decision parsing; use the sentinel helpers in `sidecar/inline-decision.mjs`.

## COMMANDS
```bash
npm install
npm run doctor
npm run check:public-safety
npm run test:sidecar
npm run test:swift:unit
npm run build:sidecar
npm run preflight:bundle
npm run eval:dogfood
npm run eval:dogfood:gate
AGENTIC30_ALLOW_BLOCKING_UI_E2E=1 npm run test:swift:ui:smoke
AGENTIC30_ALLOW_BLOCKING_UI_E2E=1 npm run test:swift:ui:full
```

## NOTES
- Build, cache, local state, and artifact directories can exist in the checkout (`build/`, `sidecar-build/`, `sidecar-evals/.artifacts/`, `.agentic30/`, `.omo/`, `.omc/`, `.omx/`, `Library/`, `_workspace/`). Do not score or document them as source modules.
- Bridge-contract edits need both Swift and sidecar tests: `npm run test:sidecar` and `npm run test:swift:unit`.
- Live provider canaries are opt-in behind `AGENTIC30_RUN_LIVE_PROVIDER_*=1` and related credential env vars.
- Public-safety and secret scans are part of the normal contribution surface: `npm run check:public-safety`, optional `npm run scan:secrets:gh`.

<!-- MANUAL: Custom project notes can be added below -->

## USER CONTEXT
- User-designated competitors to remember for future strategy/product/market work:
  - https://indiefounders.net/
  - https://www.threads.com/@classbinu
