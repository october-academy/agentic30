<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-05-07 | Updated: 2026-05-07 -->

# agentic30UITests

## Purpose
XCTest UI tests that drive the SwiftUI app via `XCUIApplication`. Default mode is hermetic — uses `--ui-testing-opaque-window` and `AGENTIC30_TEST_STUB_PROVIDER=1` so screenshots are pixel-stable and provider auth is not required. Live canaries (real provider chat, credentialed Google login) are opt-in behind environment variables.

## Key Files

| File | Description |
|------|-------------|
| `agentic30UITests.swift` | Main UI test suite — native project picker, Settings model pickers, hermetic sidecar chat flow, plus optional live canaries (~89k chars covering many flows) |
| `agentic30UITestsLaunchTests.swift` | Launch screenshot test |

## For AI Agents

### Working In This Directory
- Hermetic mode is the default. Real provider runs are gated by:
  - `AGENTIC30_RUN_LIVE_PROVIDER_E2E=1` — enable real provider chat canary.
  - `AGENTIC30_GOOGLE_E2E_EMAIL`, `AGENTIC30_GOOGLE_E2E_PASSWORD`, `AGENTIC30_GOOGLE_E2E_TOTP_SECRET` — credentialed Google login E2E.
  - `AGENTIC30_MAC_AUTH_BASE_URL` — staging Mac auth endpoint (defaults to `https://agentic30.app`).
- Adding a UI test must not break hermetic determinism. New screens that gate behavior on time, locale, or network must respect the stub provider flag.

### Testing Requirements
- Run hermetic-only:
  ```bash
  xcodebuild test -project agentic30.xcodeproj -scheme agentic30 -destination 'platform=macOS' \
    -only-testing:agentic30UITests/agentic30UITests/testNativeProjectPickerSelectsDirectory \
    -only-testing:agentic30UITests/agentic30UITests/testSettingsModelPickersSelectClaudeAndCodexModels \
    -only-testing:agentic30UITests/agentic30UITests/testSidecarChatFlowHermetic
  ```
- Live canaries should be excluded from default CI runs.

### Common Patterns
- `XCUIApplication.launchArguments` to inject hermetic flags.
- `XCUIApplication.launchEnvironment` for stub-provider toggles.
- Screenshot diffs rely on opaque-window mode; do not enable transparency in tests.

## Dependencies

### Internal
- `agentic30/` app target.

### External
- XCTest, XCUITest.

<!-- MANUAL: -->
