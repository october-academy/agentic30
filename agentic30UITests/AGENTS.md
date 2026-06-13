<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-05-07 | Updated: 2026-05-07 -->

# agentic30UITests

## Purpose
XCTest UI tests that drive the SwiftUI app via `XCUIApplication`. Default mode is hermetic — uses `--ui-testing-opaque-window` and `AGENTIC30_TEST_STUB_PROVIDER=1` so screenshots are pixel-stable and provider auth is not required. Live canaries (real provider chat, credentialed Google login) are opt-in behind environment variables.

## Key Files

| File | Description |
|------|-------------|
| `agentic30UITests.swift` | Main UI test suite — current intake flow, Settings model pickers, Open Design Day workspace smoke/responsive coverage, plus optional live canaries |
| `agentic30UITestsLaunchTests.swift` | Launch screenshot test |

## For AI Agents

### Working In This Directory
- Hermetic mode is the default. Real provider runs are gated by:
  - `AGENTIC30_RUN_LIVE_PROVIDER_E2E=1` — enable real provider chat canary.
  - `AGENTIC30_GOOGLE_E2E_EMAIL`, `AGENTIC30_GOOGLE_E2E_PASSWORD`, `AGENTIC30_GOOGLE_E2E_TOTP_SECRET` — credentialed Google login E2E.
  - `AGENTIC30_MAC_AUTH_BASE_URL` — staging Mac auth endpoint (defaults to `https://agentic30.app`).
- Local XCUITest runs are blocking desktop operations: they launch Agentic30 in the foreground and can take keyboard, mouse, and focus. Before running the `agentic30UITests` scheme, full `agentic30` scheme tests, any `-only-testing:agentic30UITests/*` command, or any UI test that opens the app and clicks or types, ask the user with the structured question tool available to you (Codex: `request_user_input`/`ask_user_question`; Claude: `AskUserQuestion`/`ask_user_question`): "이 명령은 Agentic30 앱을 전면으로 띄우고 키보드/마우스/포커스를 점유할 수 있습니다. 지금 실행할까요?" If the user does not approve, do not run it. After approval, set `AGENTIC30_ALLOW_BLOCKING_UI_E2E=1`.
- Adding a UI test must not break hermetic determinism. New screens that gate behavior on time, locale, or network must respect the stub provider flag.
- Do not add coverage for legacy workspace curriculum surfaces. They are deprecated; cover the Open Design Day surface instead.

### Testing Requirements
- Run hermetic-only:
  ```bash
  AGENTIC30_ALLOW_BLOCKING_UI_E2E=1 npm run test:swift:ui:smoke
  ```
- Run full UI E2E only after approval:
  ```bash
  AGENTIC30_ALLOW_BLOCKING_UI_E2E=1 npm run test:swift:ui:full
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
