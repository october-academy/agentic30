<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-06-14 | Commit: 230c007 | Branch: main -->

# agentic30UITests

## OVERVIEW
XCTest UI tests that drive the macOS app with `XCUIApplication`. Default mode is hermetic: opaque test window, stub provider, seeded workspace/context fixtures, and no live auth.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Main UI suite | `agentic30UITests.swift` | Intake, settings pickers, Open Design Day, Morning Briefing, seeded flows |
| Launch screenshot | `agentic30UITestsLaunchTests.swift` | Standard Xcode launch screenshot coverage |
| Runner gate | `../scripts/xcode-test.sh` | Blocks local UI E2E unless explicitly allowed |
| App-side fixtures | `../agentic30/AgenticViewModel.swift`, `../agentic30/MorningBriefingPageView.swift` | Launch args and stub sample payloads |

## CONVENTIONS
- Hermetic launch uses `--ui-testing-opaque-window` and `AGENTIC30_TEST_STUB_PROVIDER=1`.
- Live provider chat canary is opt-in with `AGENTIC30_RUN_LIVE_PROVIDER_E2E=1`.
- Credentialed Google E2E requires `AGENTIC30_GOOGLE_E2E_EMAIL`, `AGENTIC30_GOOGLE_E2E_PASSWORD`, and `AGENTIC30_GOOGLE_E2E_TOTP_SECRET`.
- `AGENTIC30_MAC_AUTH_BASE_URL` can point Mac auth tests at staging.
- Keep screenshots pixel-stable. New screens must honor the stub-provider and opaque-window flags.

## ANTI-PATTERNS
- Do not run local XCUITest without explicit approval. It launches Agentic30 in the foreground and can take keyboard, mouse, and focus.
- Do not add default coverage that depends on wall-clock time, locale, network, real OAuth, or live provider output.
- Do not add coverage for deprecated legacy workspace curriculum surfaces; cover Open Design Day surfaces instead.

## TESTS
```bash
AGENTIC30_ALLOW_BLOCKING_UI_E2E=1 npm run test:swift:ui:smoke
AGENTIC30_ALLOW_BLOCKING_UI_E2E=1 npm run test:swift:ui:full
```
Before either local command, ask exactly: "이 명령은 Agentic30 앱을 전면으로 띄우고 키보드/마우스/포커스를 점유할 수 있습니다. 지금 실행할까요?"

## DEPENDENCIES
- Internal: `agentic30/` app target and sidecar stub behavior.
- External: XCTest / XCUITest.

<!-- MANUAL: -->
