<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-06-20 | Commit: 6f0fc7e | Branch: main -->

# agentic30

## OVERVIEW
SwiftUI/AppKit macOS app target. Owns windows, menu bar extra, Settings, onboarding, Keychain/OAuth, telemetry preferences, Sparkle update UI, PostHog SDK capture, and the WebSocket client to the Node sidecar.

## STRUCTURE
| Path | Purpose |
|------|---------|
| `agentic30App.swift` | `@main`, `AppDelegate`, workspace window, Settings scene, MenuBarExtra, Sparkle updater |
| `AgenticViewModel.swift` | Central observable state and event reducer; very large by design |
| `ContentView.swift` | Main workspace/chat/mission surface |
| `SettingsView.swift` | Provider, integration, workspace, telemetry, diagnostics settings |
| `SidecarBridge.swift` | Launches `sidecar/index.mjs`, authenticates local WebSocket, decodes events |
| `AgenticModels.swift` | Shared app models, including morning briefing drilldown decoders |
| `KeychainHelper.swift` | Only path for Keychain reads/writes |
| `NodeExecutableResolver.swift` | `NODE_BINARY`, common paths, mise/asdf/Volta, login-shell PATH |
| `WorkspaceSettings.swift`, `LoginItemsManager.swift` | Workspace persistence and launch-at-login plumbing |
| `MacOnboarding*.swift` | First-run onboarding and selected-project context |
| `IntakeV2*.swift` | Intake, decision, notification, and showcase screens |
| `Day1SituationSummaryCard.swift`, `BipReadinessModels.swift` | BIP/readiness UI models and cards |
| `OpenDesign*.swift` | Open Design Day reference/workspace screens |
| `MorningBriefing*.swift` | Briefing and per-source drilldown screens |
| `OnboardingWorkspaceRequestStore.swift` | Helper CLI registration, nonce, app-support plumbing |
| `Assets.xcassets/` | App icon, status icon, provider/integration brand assets |

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Add a bridge event | `AgenticViewModel.swift`, `AgenticModels.swift`, `SidecarBridge.swift` | Mirror sidecar emitter and Swift decoding tests |
| Add app UI state | `AgenticViewModel.swift` | Keep `@MainActor` expectations intact |
| Add settings/integration UI | `SettingsView.swift`, `AgenticModels.swift` | Probe result shapes come from sidecar integration modules |
| Add onboarding behavior | `MacOnboardingContext*.swift`, `OnboardingWorkspaceRequestStore.swift` | Keep helper token/TTL semantics aligned with sidecar |
| Add telemetry | `PostHogTelemetry.swift` | Respect opt-out and debug telemetry env gates |
| Add updater behavior | `agentic30App.swift`, `docs/release-*.md` | Sparkle feed/public key rules are release blockers |

## CONVENTIONS
- UI state is observed from `@Published` view-model properties. Long async flows marshal back to the main actor.
- Use `KeychainHelper` for credentials and tokens. Never call `SecItem*` directly in feature code.
- Use `PostHogTelemetry.capture(...)`; never call PostHog directly from feature surfaces.
- Hermetic UI tests inject `--ui-testing-opaque-window` and `AGENTIC30_TEST_STUB_PROVIDER=1`; new views must respect those flags.
- Forks should change Bundle ID from `october-academy.agentic30` to avoid Keychain and Launch Services collisions.
- App Sandbox is intentionally off for the direct-distribution track; do not add sandbox assumptions to file or sidecar launch paths.

## ANTI-PATTERNS
- Do not refactor `AgenticViewModel.swift` or `ContentView.swift` structurally without focused coverage.
- Do not introduce wall-clock, locale, network, or provider-auth assumptions into default UI state.
- Do not update sidecar event payloads here without matching `sidecar/` emitters and `agentic30Tests/` decoders.
- Do not bypass `NodeExecutableResolver` when locating Node for local development builds.

## TESTS
```bash
npm run test:swift:unit
AGENTIC30_ALLOW_BLOCKING_UI_E2E=1 npm run test:swift:ui:smoke
```
Local UI E2E requires the root approval prompt before launch.

## DEPENDENCIES
- Apple frameworks: SwiftUI, AppKit, UserNotifications, AuthenticationServices.
- Swift packages: Sparkle updater, PostHog SDK.
- Runtime dependency: bundled or local Node sidecar launched by `SidecarBridge`.

<!-- MANUAL: -->

### Morning briefing screens

`MorningBriefingPageView.swift` (main briefing, OD ref briefing.html) and `MorningBriefingDrilldownView.swift` (per-source drilldowns, OD refs briefing-cloudflare/github/posthog.html) share the scroll-spy plumbing (`MorningBriefingScrollRequest` / `MorningBriefingSectionOffsetKey`) and the `OpenDesignDayColor` palette (`violet` is derived in `OpenDesignDayPageView.swift`, not part of the palette struct). Drilldown payloads come from the sidecar `briefing.drilldowns` map; every ready source is guaranteed one (counts-grade at minimum), so the card's 드릴다운 button always navigates to the per-source screen. Hermetic fixtures live in `MorningBriefing.uiTestingSample`.
