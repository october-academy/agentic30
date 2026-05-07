<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-05-07 | Updated: 2026-05-07 -->

# agentic30 (Swift App)

## Purpose
SwiftUI/AppKit source for the macOS app target. Owns the menu bar extra, workspace window, settings window, onboarding flow, pet/wolf overlay, Keychain-backed credential storage, OAuth presentation, PostHog telemetry, and the WebSocket bridge to the Node sidecar. The view model (`AgenticViewModel`) is the single source of truth that the views observe.

## Key Files

| File | Description |
|------|-------------|
| `agentic30App.swift` | `@main` SwiftUI app: workspace window, Settings scene, MenuBarExtra; `AppDelegate` owns `AgenticViewModel`, `WolfStateMachine`, `PetWindowController` |
| `AgenticViewModel.swift` | Central observable view model — sidecar bridge wiring, session/state, auth, provider routing, BIP coach, onboarding hypothesis (large file, treat as the central nervous system) |
| `AgenticModels.swift` | Shared data models for messages, sessions, providers, settings |
| `ContentView.swift` | Main workspace view tree (large file housing chat surface, panel routing, mission UI) |
| `SettingsView.swift` | Settings UI: providers, Keychain entries, workspace picker, telemetry toggle |
| `SidecarBridge.swift` | WebSocket client that talks to `sidecar/index.mjs`; encodes outgoing requests, decodes events |
| `KeychainHelper.swift` | Keychain CRUD wrapper for provider keys, OAuth tokens, BIP coach config |
| `NodeExecutableResolver.swift` | Locates a usable Node binary via `NODE_BINARY`, common install paths, mise/asdf/Volta shims, login shell `PATH` |
| `MacAuthModels.swift` | Auth session models for the `agentic30.app` Mac auth endpoint |
| `MacOnboardingView.swift` | First-run onboarding flow (3 questions → project stage, users, proof target) |
| `MacOnboardingContextView.swift` | Onboarding context surface (project picker, summary) |
| `MacOnboardingContext.swift` | Onboarding context data structure |
| `BipReadinessModels.swift` | Models for the BIP (Build in Public) readiness flow |
| `BipCoachConstants.swift` | Constants shared with the sidecar BIP coach |
| `WorkspaceSettings.swift` | Persisted workspace path + scoped bookmark handling |
| `PostHogTelemetry.swift` | PostHog event capture wrapper (respects telemetry toggle) |
| `Item.swift` | Minimal SwiftData example model — likely scaffold residue |
| `Info.plist` | App bundle metadata |

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `Pet/` | Pet/wolf overlay window, state machine, sequence package (see `Pet/AGENTS.md`) |
| `wolf/` | Sprite assets (PNG frames + GIF animations) used by `PetView` — no code, do not document with AGENTS.md |
| `Assets.xcassets/` | Xcode asset catalog (app icon, accent color, status bar icon, profile image) |

## For AI Agents

### Working In This Directory
- `AgenticViewModel.swift` is enormous (~135k chars) by design — keep additions composable and test-backed; do not blindly refactor without coverage.
- All UI state must be `@MainActor`-safe. Sidecar callbacks marshal back through `SidecarBridge` onto the main actor.
- Telemetry events go through `PostHogTelemetry.capture(...)` and must respect the user's telemetry preference; never call PostHog directly.
- Hermetic UI tests inject `AGENTIC30_TEST_STUB_PROVIDER=1` and `--ui-testing-opaque-window`. New views must respect these flags so screenshots stay stable.
- Bundle ID is `october-academy.agentic30`. Forks should change it to avoid Keychain/Launch Services collisions.

### Testing Requirements
- Unit tests in `agentic30Tests/` use XCTest; run via `xcodebuild test ...` from the repo root.
- UI tests in `agentic30UITests/` should be hermetic by default; live canaries are opt-in via env vars (`AGENTIC30_RUN_LIVE_PROVIDER_E2E`, Google credentials, etc.).
- Avoid time-of-day or network-dependent assertions.

### Common Patterns
- View models expose `@Published` state; views observe via `@ObservedObject`/`@StateObject`.
- Long-running async work uses Swift concurrency; bridge events are bridged through `AsyncStream`.
- Keychain access goes through `KeychainHelper` only — never call `SecItem*` directly.

## Dependencies

### Internal
- The Swift target depends on the Node sidecar at runtime — see `sidecar/AGENTS.md`.
- `Pet/WolfStateMachine.swift` consumes sidecar events surfaced through `AgenticViewModel` to drive pet state.

### External
- SwiftUI / AppKit / UserNotifications (Apple frameworks)
- No third-party Swift packages currently — all integrations are Apple SDKs plus the WebSocket-driven sidecar.

<!-- MANUAL: -->
