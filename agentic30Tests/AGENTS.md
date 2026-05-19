<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-05-07 | Updated: 2026-05-07 -->

# agentic30Tests

## Purpose
XCTest unit tests for the Swift macOS app. Covers view-model auth flows, BIP readiness, chat-message decoding/routing, foundation-first prompt handling, Keychain settings migration, Mac auth models, Node executable resolution, PostHog telemetry, sidecar event decoding, and workspace settings.

## Key Files

| File | Description |
|------|-------------|
| `AgenticViewModelAuthTests.swift` | Auth state transitions on `AgenticViewModel` |
| `BipReadinessViewModelTests.swift` | BIP readiness gating, transitions, and persistence |
| `ChatMessageDecodingTests.swift` | Decoding inbound chat messages from sidecar event stream |
| `ChatMessageRouteTests.swift` | Routing logic for chat-route classifications |
| `FoundationFirstPromptHandlerTests.swift` | Foundation-first prompt handler behavior |
| `KeychainSettingsMigrationTests.swift` | Settings migration paths for Keychain entries |
| `MacAuthModelsTests.swift` | Decoding/encoding of Mac auth session payloads |
| `NodeExecutableResolverTests.swift` | Node binary discovery across `NODE_BINARY`, common paths, shim managers |
| `PostHogTelemetryTests.swift` | PostHog wrapper behavior including opt-out |
| `SidecarEventDecodingTests.swift` | Decoding the event types emitted by the sidecar over WebSocket |
| `WorkspaceSettingsTests.swift` | Workspace path + bookmark persistence |

## For AI Agents

### Working In This Directory
- These tests run against the `agentic30` target. Run them with `xcodebuild test -project agentic30.xcodeproj -scheme agentic30 -destination 'platform=macOS'`.
- Adding a new test file requires registering it with the test target in Xcode (the project file tracks membership).
- Mock the sidecar bridge — never spin up a real Node process inside unit tests.
- Avoid global-state leaks across tests (Keychain entries, UserDefaults). Use scoped helpers and tear down what you create.

### Testing Requirements
- Unit tests must be deterministic — no real network, no real Keychain side effects beyond a test-scoped suffix.
- When testing event decoding, pin the JSON payload as a fixture string in the test file.

### Common Patterns
- XCTest with `XCTAssertEqual` / `XCTAssertThrowsError` patterns.
- Async tests use `await` with `XCTestCase` async support, not expectation polling.

## Dependencies

### Internal
- `agentic30/` source target — these tests link against the app target.

### External
- XCTest only.

<!-- MANUAL: -->
