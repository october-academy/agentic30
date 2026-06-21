<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-06-20 | Commit: 6f0fc7e | Branch: main -->

# agentic30Tests

## OVERVIEW
Swift XCTest unit tests for app logic, decoders, view-model state transitions, telemetry policy, Keychain/settings migration, onboarding, Node resolution, and Open Design Day content. These tests link the app target but must not launch the real sidecar.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Sidecar event contract | `SidecarEventDecodingTests.swift`, `ChatMessageDecodingTests.swift` | Pin JSON fixture strings in the test file |
| Auth and provider state | `AgenticViewModelAuthTests.swift`, `MacAuthModelsTests.swift` | Use fakes; no real OAuth/browser login |
| Keychain/settings | `KeychainSettingsMigrationTests.swift`, `WorkspaceSettingsTests.swift` | Use scoped suffixes and cleanup |
| Node lookup | `NodeExecutableResolverTests.swift` | Exercise env/common-path/shim cases |
| Telemetry policy | `PostHogTelemetryTests.swift` | Snapshot/restore defaults to avoid leakage |
| Open Design Day / briefing | `OpenDesignDayContentTests.swift`, related UI model tests | Keep fixtures deterministic |
| Sidecar parity | `ChatMessageRouteTests.swift`, `FoundationFirstPromptHandlerTests.swift` | Mirror sidecar route/prompt changes |

## CONVENTIONS
- XCTest only; no external test framework.
- Async tests use XCTest async support instead of expectation polling when possible.
- Mock `SidecarTransport` or injected helpers; never spawn `node sidecar/index.mjs` from unit tests.
- Add target membership in `agentic30.xcodeproj` when creating a new test file.

## ANTI-PATTERNS
- No real network, real provider auth, real sidecar process, or unscoped Keychain writes.
- No global `UserDefaults` or singleton state leaks; snapshot and restore host defaults.
- Do not duplicate bridge fixture shapes by memory. Share the same JSON payload intent with `sidecar-tests/`.

## TESTS
```bash
npm run test:swift:unit
```
This command intentionally excludes XCUITest and does not need the blocking UI approval gate.

## DEPENDENCIES
- Internal: `agentic30/` app target.
- External: XCTest.

<!-- MANUAL: -->
