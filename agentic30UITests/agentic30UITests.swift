//
//  agentic30UITests.swift
//  agentic30UITests
//
//  Created by october on 4/8/26.
//

import AppKit
import CryptoKit
import Darwin
import Foundation
import XCTest

final class agentic30UITests: XCTestCase {

    override func setUpWithError() throws {
        // Put setup code here. This method is called before the invocation of each test method in the class.

        // In UI tests it is usually best to stop immediately when a failure occurs.
        continueAfterFailure = false

        // In UI tests it’s important to set the initial state - such as interface orientation - required for your tests before they run. The setUp method is a good place to do this.
    }

    override func tearDownWithError() throws {
        dismissOAuthHandoffIfPresent()
    }

    @MainActor
    func testFirstRunContextAppearsWithoutLogin() throws {
        let app = launchApp(
            arguments: [
                "--ui-testing-reset-onboarding",
                "--ui-testing-disable-sidecar",
                "--ui-testing-open-workspace",
                "--ui-testing-opaque-window",
            ],
            environment: [
                "AGENTIC30_TEST_STUB_PROVIDER": "1",
            ]
        )
        addTeardownBlock {
            app.terminate()
        }

        XCTAssertTrue(
            app.staticTexts["지금 어떤 상황에서 만들고 있나요?"].waitForExistence(timeout: 5)
        )
        XCTAssertFalse(app.buttons["Sign in with Google"].exists)
        XCTAssertTrue(app.buttons["Next"].exists)
    }

    @MainActor
    func testFirstRunDoesNotShowGoogleLogin() throws {
        let runID = UUID().uuidString
        let appSupportPath = "/tmp/agentic30-ui-login-app-support-\(runID)"
        resetDirectory(at: appSupportPath)

        let onboardingApp = launchApp(arguments: [
            "--ui-testing-reset-onboarding",
            "--ui-testing-disable-sidecar",
            "--ui-testing-open-workspace",
            "--ui-testing-opaque-window",
        ], environment: [
            "AGENTIC30_APP_SUPPORT_PATH": appSupportPath,
        ])
        hideKnownInterferingApplications()
        onboardingApp.activate()
        addTeardownBlock {
            onboardingApp.terminate()
            self.unhideKnownInterferingApplications()
            self.removeDirectory(at: appSupportPath)
        }

        let contextVisible = onboardingApp.staticTexts["지금 어떤 상황에서 만들고 있나요?"].waitForExistence(timeout: 5)
        if !contextVisible {
            attachText(onboardingApp.debugDescription, named: "00 Onboarding Context Missing Tree")
        }
        XCTAssertTrue(contextVisible)
        XCTAssertFalse(onboardingApp.buttons["Sign in with Google"].exists)
        XCTAssertFalse(onboardingApp.buttons["Opening Google"].exists)
        XCTAssertFalse(onboardingApp.buttons["Completing sign in"].exists)
        attachScreenshot(from: onboardingApp, named: "01 Loginless Onboarding Context")
    }

    @MainActor
    func testWorkspaceSetupTelemetryCompletesOnlyAfterFolderSelectionAndFirstInput() throws {
        let runID = UUID().uuidString
        let workspacePath = "/tmp/agentic30-ui-setup-telemetry-workspace-\(runID)"
        let appSupportPath = "/tmp/agentic30-ui-setup-telemetry-app-support-\(runID)"
        let telemetryPath = "/tmp/agentic30-ui-setup-telemetry-\(runID).jsonl"
        resetDirectory(at: workspacePath)
        resetDirectory(at: appSupportPath)
        try? FileManager.default.removeItem(atPath: telemetryPath)

        let app = launchApp(arguments: [
            "--ui-testing-reset-onboarding",
            "--ui-testing-seed-onboarding-context",
            "--ui-testing-picker-path=\(workspacePath)",
            "--ui-testing-open-workspace",
            "--ui-testing-opaque-window",
        ], environment: [
            "AGENTIC30_APP_SUPPORT_PATH": appSupportPath,
            "AGENTIC30_TELEMETRY_CAPTURE_FILE": telemetryPath,
            "AGENTIC30_TEST_STUB_PROVIDER": "1",
            "AGENTIC30_CODEX_MODEL": "gpt-5.4-mini",
        ])
        hideKnownInterferingApplications()
        app.activate()
        addTeardownBlock {
            app.terminate()
            self.unhideKnownInterferingApplications()
            self.removeDirectory(at: workspacePath)
            self.removeDirectory(at: appSupportPath)
            try? FileManager.default.removeItem(atPath: telemetryPath)
        }

        let selectDirectory = button(in: app, matching: [
            "workspace.selectDirectoryButton",
            "Select project directory",
        ])
        XCTAssertTrue(selectDirectory.waitForExistence(timeout: 10))
        selectDirectory.click()

        XCTAssertNotNil(
            waitForTelemetryEvent(named: "workspace_setup_started", at: telemetryPath, timeout: 120),
            "Expected folder selection to start workspace setup telemetry."
        )
        XCTAssertFalse(
            telemetryEvents(at: telemetryPath).contains(where: { $0["event"] as? String == "workspace_setup_completed" }),
            "Workspace setup must not complete from folder selection and scan alone."
        )

        answerBootstrapPromptIfNeeded(in: app)

        let completed = waitForTelemetryEvent(
            named: "workspace_setup_completed",
            at: telemetryPath,
            timeout: 60
        )
        if completed == nil {
            attachText(telemetryEvents(at: telemetryPath).description, named: "Workspace Setup Telemetry Events")
            attachText(app.debugDescription, named: "Workspace Setup Activation Tree")
        }
        XCTAssertNotNil(completed)
        app.terminate()
    }

    @MainActor
    func testCredentialedGoogleLoginCompletesMacAuth() throws {
        throw XCTSkip("Google sign-in UI is disabled while the macOS app runs in loginless local mode.")
    }

    @MainActor
    func testProjectPickerAndContextSelectionFlow() throws {
        let contextWorkspacePath = "/tmp/agentic30-ui-context-workspace-\(UUID().uuidString)"
        resetDirectory(at: contextWorkspacePath)

        let projectApp = launchApp(arguments: [
            "--ui-testing-reset-onboarding",
            "--ui-testing-seed-auth",
            "--ui-testing-disable-sidecar",
            "--ui-testing-open-workspace",
            "--ui-testing-opaque-window",
        ])
        hideKnownInterferingApplications()
        projectApp.activate()
        addTeardownBlock {
            projectApp.terminate()
            self.unhideKnownInterferingApplications()
            self.removeDirectory(at: contextWorkspacePath)
        }

        XCTAssertTrue(projectApp.staticTexts["지금 어떤 상황에서 만들고 있나요?"].waitForExistence(timeout: 5))
        XCTAssertFalse(projectApp.staticTexts["Choose your project folder"].exists)
        attachScreenshot(from: projectApp, named: "01 Context Before Project Picker")
        projectApp.terminate()

        let contextApp = launchApp(arguments: [
            "--ui-testing-reset-onboarding",
            "--ui-testing-seed-auth",
            "--ui-testing-seed-onboarding-context",
            "--ui-testing-disable-sidecar",
            "--ui-testing-open-workspace",
            "--ui-testing-opaque-window",
        ])
        contextApp.activate()
        addTeardownBlock {
            contextApp.terminate()
        }

        XCTAssertTrue(contextApp.staticTexts["Choose your project folder"].waitForExistence(timeout: 10))
        XCTAssertTrue(button(in: contextApp, matching: [
            "workspace.selectDirectoryButton",
            "Select project directory",
        ]).exists)
        XCTAssertFalse(button(in: contextApp, matching: [
            "workspace.startAssistantButton",
            "Start assistant",
        ]).isEnabled)
        attachScreenshot(from: contextApp, named: "02 Project Picker After Context")
        contextApp.terminate()

        let seededWorkspaceApp = launchApp(arguments: [
            "--ui-testing-reset-onboarding",
            "--ui-testing-seed-auth",
            "--ui-testing-seed-workspace=\(contextWorkspacePath)",
            "--ui-testing-disable-sidecar",
            "--ui-testing-open-workspace",
            "--ui-testing-opaque-window",
        ])
        seededWorkspaceApp.activate()
        addTeardownBlock {
            seededWorkspaceApp.terminate()
        }

        XCTAssertTrue(seededWorkspaceApp.staticTexts["지금 어떤 상황에서 만들고 있나요?"].waitForExistence(timeout: 10))
        let fullTimeOption = button(in: seededWorkspaceApp, matching: [
            "onboardingContext.option.full_time_solo",
            "전업 1인 개발자, 퇴사했고 혼자 제품을 만들고 있습니다",
            "전업 1인 개발자",
        ])
        XCTAssertTrue(fullTimeOption.exists)
        attachScreenshot(from: seededWorkspaceApp, named: "02 Context Work Mode")

        let contextPrimary = button(in: seededWorkspaceApp, matching: [
            "onboardingContext.primaryButton",
            "Next",
        ])
        clickCenter(of: contextPrimary)

        XCTAssertTrue(seededWorkspaceApp.staticTexts["어떤 일을 하고 계신가요?"].waitForExistence(timeout: 5))
        let developerOption = button(in: seededWorkspaceApp, matching: [
            "onboardingContext.option.developer",
            "개발자, 앱·웹·제품을 직접 구현합니다",
            "개발자",
        ])
        let designerOption = button(in: seededWorkspaceApp, matching: [
            "onboardingContext.option.designer",
            "디자이너, 브랜드, 시각, 프로덕트 디자인을 다룹니다",
            "디자이너",
        ])
        XCTAssertTrue(developerOption.exists)
        XCTAssertTrue(designerOption.exists)
        let developerFrameBefore = developerOption.frame
        let designerFrameBefore = designerOption.frame
        attachScreenshot(from: seededWorkspaceApp, named: "03 Context Role")

        designerOption.click()
        XCTAssertEqual(developerOption.frame.height, developerFrameBefore.height, accuracy: 0.5)
        XCTAssertEqual(designerOption.frame.height, designerFrameBefore.height, accuracy: 0.5)
        XCTAssertEqual(designerOption.frame.minY, designerFrameBefore.minY, accuracy: 0.5)
        attachScreenshot(from: seededWorkspaceApp, named: "04 Context Role Changed")

        clickCenter(of: contextPrimary)
        XCTAssertTrue(seededWorkspaceApp.staticTexts["현재 가장 큰 막힘은 무엇인가요?"].waitForExistence(timeout: 5))
        attachScreenshot(from: seededWorkspaceApp, named: "05 Context Blocker")

        clickCenter(of: contextPrimary)
        XCTAssertTrue(seededWorkspaceApp.staticTexts["어떤 기록을 연결할 수 있나요?"].waitForExistence(timeout: 5))
        let projectFolderOption = button(in: seededWorkspaceApp, matching: [
            "onboardingContext.option.project_folder",
            "작업 중인 프로젝트 폴더",
        ])
        let workLogOption = button(in: seededWorkspaceApp, matching: [
            "onboardingContext.option.work_log",
            "업무 일지",
        ])
        let occasionalOption = button(in: seededWorkspaceApp, matching: [
            "onboardingContext.option.occasional",
            "고객 인터뷰",
        ])
        XCTAssertTrue(projectFolderOption.exists)
        XCTAssertTrue(workLogOption.exists)
        XCTAssertTrue(occasionalOption.exists)
        XCTAssertEqual(projectFolderOption.value as? String, "Selected")
        XCTAssertEqual(workLogOption.value as? String, "Not selected")
        workLogOption.click()
        occasionalOption.click()
        XCTAssertEqual(projectFolderOption.value as? String, "Selected")
        XCTAssertEqual(workLogOption.value as? String, "Selected")
        XCTAssertEqual(occasionalOption.value as? String, "Selected")
        attachScreenshot(from: seededWorkspaceApp, named: "06 Context Evidence")
    }

    @MainActor
    func testNativeProjectPickerSelectsDirectory() throws {
        let runID = UUID().uuidString
        let workspacePath = "/tmp/agentic30-ui-picker-workspace-\(runID)"
        resetDirectory(at: workspacePath)

        let app = launchApp(arguments: [
            "--ui-testing-reset-onboarding",
            "--ui-testing-seed-auth",
            "--ui-testing-seed-onboarding-context",
            "--ui-testing-disable-sidecar",
            "--ui-testing-open-workspace",
            "--ui-testing-picker-path=\(workspacePath)",
            "--ui-testing-picker-autostart",
            "--ui-testing-opaque-window",
        ])
        hideKnownInterferingApplications()
        app.activate()
        addTeardownBlock {
            app.terminate()
            self.unhideKnownInterferingApplications()
            self.removeDirectory(at: workspacePath)
        }

        XCTAssertTrue(app.staticTexts["Choose your project folder"].waitForExistence(timeout: 5))
        let selectDirectory = button(in: app, matching: [
            "workspace.selectDirectoryButton",
            "Select project directory",
        ])
        XCTAssertTrue(selectDirectory.exists)
        XCTAssertFalse(button(in: app, matching: [
            "workspace.startAssistantButton",
            "Start assistant",
        ]).isEnabled)
        clickCenter(of: selectDirectory)

        let workspaceVisible = app.staticTexts["Sidecar disabled for UI tests"].waitForExistence(timeout: 5)
        if !workspaceVisible {
            attachText(app.debugDescription, named: "02 Native Project Picker Workspace Missing Tree")
        }
        XCTAssertTrue(workspaceVisible)
        attachScreenshot(from: app, named: "02 Native Project Picker Continued")
    }

    @MainActor
    func testSettingsModelPickersSelectClaudeAndCodexModels() throws {
        let workspacePath = FileManager.default.temporaryDirectory
            .appendingPathComponent("agentic30-ui-settings-workspace-\(UUID().uuidString)", isDirectory: true)
            .path
        let appSupportPath = FileManager.default.temporaryDirectory
            .appendingPathComponent("agentic30-ui-settings-support-\(UUID().uuidString)", isDirectory: true)
            .path
        resetDirectory(at: workspacePath)
        resetDirectory(at: appSupportPath)

        let app = launchApp(
            arguments: [
                "--ui-testing-reset-onboarding",
                "--ui-testing-seed-auth",
                "--ui-testing-seed-workspace=\(workspacePath)",
                "--ui-testing-seed-onboarding-context",
                "--ui-testing-disable-sidecar",
                "--ui-testing-open-settings",
                "--ui-testing-open-settings-section=account",
                "--ui-testing-opaque-window",
            ],
            environment: [
                "AGENTIC30_APP_SUPPORT_PATH": appSupportPath,
                "AGENTIC30_UI_TEST_SETTINGS_CLAUDE_MODEL": "claude-opus-4-7",
                "AGENTIC30_UI_TEST_SETTINGS_CODEX_MODEL": "gpt-5.4-mini",
            ]
        )
        hideKnownInterferingApplications()
        app.activate()
        addTeardownBlock {
            app.terminate()
            self.unhideKnownInterferingApplications()
            self.removeDirectory(at: workspacePath)
            self.removeDirectory(at: appSupportPath)
        }

        XCTAssertTrue(openSettingsWindow(in: app))
        XCTAssertTrue(app.staticTexts["Agent Models"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Claude Agent SDK"].exists)
        XCTAssertTrue(app.staticTexts["OpenAI Codex SDK"].exists)
        attachScreenshot(from: app, named: "01 Settings Model Pickers")

        XCTAssertTrue(
            chooseModelOption(
                in: app,
                pickerIdentifier: "settings.claude.modelPicker",
                optionLabel: "Claude Opus 4.7",
                optionIdentifier: "settings.claude.modelOption.claude-opus-4-7"
            )
        )
        XCTAssertTrue(waitForModelID(in: app, identifier: "settings.claude.modelID", value: "claude-opus-4-7"))

        XCTAssertTrue(
            chooseModelOption(
                in: app,
                pickerIdentifier: "settings.codex.modelPicker",
                optionLabel: "GPT 5.4 Mini",
                optionIdentifier: "settings.codex.modelOption.gpt-5.4-mini"
            )
        )
        XCTAssertTrue(waitForModelID(in: app, identifier: "settings.codex.modelID", value: "gpt-5.4-mini"))

        let saveModels = hittableElementWithIdentifier(
            in: app,
            "settings.models.saveButton",
            timeout: 2
        ) ?? elementWithIdentifier(in: app, "settings.models.saveButton")
        XCTAssertTrue(saveModels.waitForExistence(timeout: 2))
        clickCenter(of: saveModels)
        XCTAssertTrue(waitForPreferredModelSettings(
            appSupportPath: appSupportPath,
            claude: "claude-opus-4-7",
            codex: "gpt-5.4-mini",
            timeout: 2
        ))
        attachScreenshot(from: app, named: "02 Settings Models Saved")
    }

    @MainActor
    func testRubricQuarantineSettingsSectionIsAvailable() throws {
        // R5-1: Settings → Quarantine Recovery 탭이 빈 상태로 등장하는지
        // 검증. fixture 주입까지는 가지 않고 surface 존재 + 빈 상태 copy만 확인
        // (sidecar는 disable-sidecar로 막혀 있으므로 list가 비어 있다).
        let workspacePath = FileManager.default.temporaryDirectory
            .appendingPathComponent("agentic30-ui-quarantine-workspace-\(UUID().uuidString)", isDirectory: true)
            .path
        let appSupportPath = FileManager.default.temporaryDirectory
            .appendingPathComponent("agentic30-ui-quarantine-support-\(UUID().uuidString)", isDirectory: true)
            .path
        resetDirectory(at: workspacePath)
        resetDirectory(at: appSupportPath)

        let app = launchApp(
            arguments: [
                "--ui-testing-reset-onboarding",
                "--ui-testing-seed-auth",
                "--ui-testing-seed-workspace=\(workspacePath)",
                "--ui-testing-seed-onboarding-context",
                "--ui-testing-disable-sidecar",
                "--ui-testing-open-settings",
                "--ui-testing-open-settings-section=quarantineRecovery",
                "--ui-testing-opaque-window",
            ],
            environment: [
                "AGENTIC30_APP_SUPPORT_PATH": appSupportPath,
            ]
        )
        hideKnownInterferingApplications()
        app.activate()
        addTeardownBlock {
            app.terminate()
            self.unhideKnownInterferingApplications()
            self.removeDirectory(at: workspacePath)
            self.removeDirectory(at: appSupportPath)
        }

        XCTAssertTrue(openSettingsWindow(in: app))
        // 빈 상태 copy. RubricQuarantineView의 emptyState text와 정확히 일치해야 한다.
        XCTAssertTrue(
            app.staticTexts["복구할 record가 없습니다."].waitForExistence(timeout: 5),
            "Quarantine Recovery 탭의 빈 상태 메시지가 보이지 않음"
        )
    }

    @MainActor
    func testSettingsDeveloperToolsExposeBipNotificationTestButtons() throws {
        let workspacePath = FileManager.default.temporaryDirectory
            .appendingPathComponent("agentic30-ui-devtools-workspace-\(UUID().uuidString)", isDirectory: true)
            .path
        let appSupportPath = FileManager.default.temporaryDirectory
            .appendingPathComponent("agentic30-ui-devtools-support-\(UUID().uuidString)", isDirectory: true)
            .path
        resetDirectory(at: workspacePath)
        resetDirectory(at: appSupportPath)

        let app = launchApp(
            arguments: [
                "--ui-testing-reset-onboarding",
                "--ui-testing-seed-auth",
                "--ui-testing-seed-workspace=\(workspacePath)",
                "--ui-testing-seed-onboarding-context",
                "--ui-testing-disable-sidecar",
                "--ui-testing-open-settings",
                "--ui-testing-open-settings-section=developerTools",
                "--ui-testing-opaque-window",
            ],
            environment: [
                "AGENTIC30_APP_SUPPORT_PATH": appSupportPath,
            ]
        )
        hideKnownInterferingApplications()
        app.activate()
        addTeardownBlock {
            app.terminate()
            self.unhideKnownInterferingApplications()
            self.removeDirectory(at: workspacePath)
            self.removeDirectory(at: appSupportPath)
        }

        XCTAssertTrue(openSettingsWindow(in: app))
        XCTAssertTrue(app.staticTexts["Developer Tools"].waitForExistence(timeout: 3))
        XCTAssertTrue(app.staticTexts["BIP Notifications"].exists)
        XCTAssertTrue(app.buttons["settings.developerTools.sendMorningBipNotification"].exists)
        XCTAssertTrue(app.buttons["settings.developerTools.sendEveningBipNotification"].exists)
        attachScreenshot(from: app, named: "01 Settings Developer Tools")
    }

    @MainActor
    func testSidecarChatFlowHermetic() throws {
        try runSidecarChatFlow(liveProvider: false)
    }

    @MainActor
    func testIcpIddStructuredPromptCanBeAnsweredByClickingChoices() throws {
        let workspacePath = "/tmp/agentic30-ui-icp-structured-\(UUID().uuidString)"
        let app = launchApp(
            arguments: [
                "--ui-testing-reset-onboarding",
                "--ui-testing-seed-auth",
                "--ui-testing-seed-onboarding-context",
                "--ui-testing-seed-workspace=\(workspacePath)",
                "--ui-testing-sidecar-failure",
                "--ui-testing-seed-icp-structured-prompt",
                "--ui-testing-open-workspace",
                "--ui-testing-opaque-window",
            ],
            environment: [
                "AGENTIC30_UI_TEST_INLINE_STUB_RESPONSES": "1",
            ]
        )
        hideKnownInterferingApplications()
        app.activate()
        addTeardownBlock {
            app.terminate()
            self.unhideKnownInterferingApplications()
            self.removeDirectory(at: workspacePath)
        }

        let structuredPromptTitle = app.staticTexts["assistant.structuredPromptTitle"]
        let structuredPrompt = app.descendants(matching: .any)["assistant.structuredPrompt"]
        let workspaceStructuredPrompt = app.descendants(matching: .any)["workspace.chat.structuredPrompt"]
        let promptVisible = structuredPromptTitle.waitForExistence(timeout: 5)
            || structuredPrompt.waitForExistence(timeout: 1)
            || workspaceStructuredPrompt.waitForExistence(timeout: 2)
        if !promptVisible {
            attachScreenshot(from: app, named: "ICP Structured Prompt Missing")
            attachText(app.debugDescription, named: "ICP Structured Prompt Missing Tree")
        }
        XCTAssertTrue(promptVisible)
        XCTAssertTrue(structuredPromptTitle.waitForExistence(timeout: 2))
        XCTAssertTrue(app.staticTexts["첫 고객"].waitForExistence(timeout: 2))
        XCTAssertTrue(app.staticTexts["기타"].waitForExistence(timeout: 2))

        let freeText = app.descendants(matching: .any)
            .matching(NSPredicate(format: "identifier BEGINSWITH %@", "assistant.structuredFreeText."))
            .firstMatch
        XCTAssertTrue(freeText.waitForExistence(timeout: 2))
        freeText.click()
        freeText.typeText("B2B SaaS founder team")

        let continueButton = button(in: app, matching: [
            "assistant.structuredContinueButton",
            "Continue",
        ])
        XCTAssertTrue(continueButton.waitForExistence(timeout: 2))
        XCTAssertTrue(waitUntilEnabled(continueButton, timeout: 2))
        clickCenter(of: continueButton)

        XCTAssertTrue(structuredPrompt.waitForExistence(timeout: 1))
        XCTAssertTrue(app.descendants(matching: .any)["assistant.structuredSubmissionReceipt"].waitForExistence(timeout: 2))
        XCTAssertTrue(app.descendants(matching: .any)
            .matching(NSPredicate(format: "label CONTAINS %@", "저장 중"))
            .firstMatch
            .waitForExistence(timeout: 2))
        XCTAssertFalse(app.descendants(matching: .any)["workspace.iddSetup.waiting"].exists)
    }

    @MainActor
    func testRunningBasisSessionDoesNotShowPublicExecutionSetupCard() throws {
        let app = launchApp(
            arguments: [
                "--ui-testing-reset-onboarding",
                "--ui-testing-seed-auth",
                "--ui-testing-seed-onboarding-context",
                "--ui-testing-disable-sidecar",
                "--ui-testing-seed-running-idd-session",
                "--ui-testing-seed-bip-current-mission",
                "--ui-testing-open-workspace",
                "--ui-testing-opaque-window",
            ],
            environment: [
                "AGENTIC30_UI_TEST_INLINE_STUB_RESPONSES": "1",
            ]
        )
        hideKnownInterferingApplications()
        app.activate()
        addTeardownBlock {
            app.terminate()
            self.unhideKnownInterferingApplications()
        }

        XCTAssertTrue(app.descendants(matching: .any)["workspace.supportThread"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", "지금 하는 방식부터 정리")).firstMatch.waitForExistence(timeout: 2))
        XCTAssertFalse(app.descendants(matching: .any)["workspace.chat.bipMissionCard"].exists)
        XCTAssertFalse(app.staticTexts["오늘 공개 실행 준비"].exists)
        XCTAssertFalse(app.staticTexts["먼저 프로젝트 기준과 기록 장소를 준비합니다."].exists)
    }

    @MainActor
    func testDay1ICPUserFiveTurnConversationSimulation() throws {
        guard shouldRunLiveProviderE2E() else {
            throw XCTSkip("Set AGENTIC30_RUN_LIVE_PROVIDER_E2E=1 in the test runner environment, or create /tmp/agentic30-run-live-provider-e2e, to run the live Codex SDK Day 1 UI E2E.")
        }
        let runID = UUID().uuidString
        let temporaryRoot = FileManager.default.temporaryDirectory
        let workspacePath = temporaryRoot
            .appendingPathComponent("agentic30-ui-day1-icp-workspace-\(runID)", isDirectory: true)
            .path
        let appSupportPath = temporaryRoot
            .appendingPathComponent("agentic30-ui-day1-icp-app-support-\(runID)", isDirectory: true)
            .path
        resetDirectory(at: workspacePath)
        resetDirectory(at: appSupportPath)
        try writeDay1ICPWorkspaceFixture(workspacePath: workspacePath, appSupportPath: appSupportPath)

        let app = launchApp(
            arguments: [
                "--ui-testing-reset-onboarding",
                "--ui-testing-seed-auth",
                "--ui-testing-seed-workspace=\(workspacePath)",
                "--ui-testing-seed-onboarding-context",
                "--ui-testing-opaque-window",
            ],
            environment: [
                "AGENTIC30_APP_SUPPORT_PATH": appSupportPath,
                "AGENTIC30_CODEX_MODEL": ProcessInfo.processInfo.environment["AGENTIC30_CODEX_MODEL"] ?? "gpt-5.4-mini",
                "AGENTIC30_CODEX_REASONING_EFFORT": ProcessInfo.processInfo.environment["AGENTIC30_CODEX_REASONING_EFFORT"] ?? "low",
            ]
        )
        hideKnownInterferingApplications()
        app.activate()
        addTeardownBlock {
            app.terminate()
            self.unhideKnownInterferingApplications()
            self.removeDirectory(at: workspacePath)
            self.removeDirectory(at: appSupportPath)
        }

        let promptComposer = textField(in: app, matching: [
            "assistant.promptComposer",
            "메시지 보내기",
            "오늘 무엇을 도와드릴까요? /office-hours-docs",
        ])
        guard promptComposer.waitForExistence(timeout: 60) else {
            attachText(app.debugDescription, named: "00 Day1 ICP UI Tree")
            throw XCTSkip("The macOS UI automation host did not expose the assistant composer window.")
        }
        let sendButton = button(in: app, matching: [
            "assistant.sendPromptButton",
            "Send prompt",
        ])
        XCTAssertTrue(sendButton.waitForExistence(timeout: 5), "The assistant send button should be visible.")
        answerWorkspaceBootstrapPromptIfNeeded(in: app, promptComposer: promptComposer, sendButton: sendButton)
        attachScreenshot(from: app, named: "01 Day1 ICP Chat Ready")

        let turns = [
            "LIVE_DAY1_ICP_STEP_1: Day 1 시작. docs/ICP.md 기준으로 내가 맞는 유저인지 진단해줘. 응답에는 반드시 LIVE_DAY1_ICP_STEP_1_OK 를 포함해.",
            "LIVE_DAY1_ICP_STEP_2: 나는 퇴사한 전업 1인 개발자이고 수익은 0원, macOS에서 Codex를 쓴다. Day 1 builder-state를 판정해줘. 응답에는 반드시 LIVE_DAY1_ICP_STEP_2_OK 를 포함해.",
            "LIVE_DAY1_ICP_STEP_3: 이미 랜딩 페이지와 작은 프로토타입은 있다. blank-slate discovery 대신 fast path로 가야 하는지 확인해줘. 응답에는 반드시 LIVE_DAY1_ICP_STEP_3_OK 를 포함해.",
            "LIVE_DAY1_ICP_STEP_4: SPEC.md v0 proof baseline에는 어떤 현재 상태와 다음 proof target을 남겨야 해? 응답에는 반드시 LIVE_DAY1_ICP_STEP_4_OK 를 포함해.",
            "LIVE_DAY1_ICP_STEP_5: 5턴 대화의 결론으로 오늘 바로 실행할 우선순위 1개와 확인할 응답을 정리해줘. 응답에는 반드시 LIVE_DAY1_ICP_STEP_5_OK 를 포함해.",
        ]
        var timings: [[String: Any]] = []

        for (index, prompt) in turns.enumerated() {
            let promptMarker = "LIVE_DAY1_ICP_STEP_\(index + 1)"
            let answerMarker = "LIVE_DAY1_ICP_STEP_\(index + 1)_OK"
            XCTAssertTrue(promptComposer.waitForExistence(timeout: 10), "Turn \(index + 1) composer should be visible.")
            enterPrompt(prompt, in: app, promptComposer: promptComposer)
            XCTAssertTrue(sendButton.isEnabled, "Turn \(index + 1) send button should become enabled after typing.")
            let startedAt = Date()
            sendButton.click()

            let promptRenderedAfterClick = waitForLatestPrompt(
                in: app,
                containing: promptMarker,
                timeout: 2
            )
            if !promptRenderedAfterClick {
                app.activate()
                app.typeKey(.return, modifierFlags: [])
            }
            let latestPromptRendered = promptRenderedAfterClick || waitForLatestPrompt(
                in: app,
                containing: promptMarker,
                timeout: 15
            )
            if !latestPromptRendered {
                attachText(app.debugDescription, named: "Turn \(index + 1) Day1 ICP UI Tree After Submit")
            }
            XCTAssertTrue(latestPromptRendered, "Turn \(index + 1) latest prompt should render after actual input.")
            XCTAssertTrue(
                waitForLatestAnswer(in: app, containing: answerMarker, timeout: 240),
                "Turn \(index + 1) should render the live Codex SDK answer marker."
            )
            let elapsed = Date().timeIntervalSince(startedAt)
            XCTAssertLessThan(elapsed, 240.0, "Live Day 1 turn \(index + 1) should complete inside the E2E timeout budget.")
            timings.append([
                "turn": index + 1,
                "elapsed_ms": Int((elapsed * 1000).rounded()),
            ])
        }

        XCTAssertTrue(waitForLatestPrompt(in: app, containing: "LIVE_DAY1_ICP_STEP_5", timeout: 5))
        XCTAssertTrue(waitForLatestAnswer(in: app, containing: "LIVE_DAY1_ICP_STEP_5_OK", timeout: 10))
        let sessionStorePath = "\(appSupportPath)/sessions.json"
        if let sessionStore = try? String(contentsOfFile: sessionStorePath, encoding: .utf8) {
            XCTAssertTrue(sessionStore.contains("\"performance\""), "Live UI E2E should persist response timing breakdowns.")
            XCTAssertTrue(sessionStore.contains("provider.codex.stream_opened"), "Live UI E2E should use the Codex SDK provider stream.")
            assertSessionStoreHasTerminalAssistantTurns(sessionStore, afterUserPrompts: turns)
            attachText(sessionStore, named: "03 Day1 ICP Live Session Store With Timings")
        }
        attachText(String(data: try JSONSerialization.data(withJSONObject: timings, options: [.prettyPrinted]), encoding: .utf8) ?? "\(timings)", named: "02 Day1 ICP Response Timings")
        attachScreenshot(from: app, named: "04 Day1 ICP Five Turn Complete")
    }

    private func shouldRunLiveProviderE2E() -> Bool {
        ProcessInfo.processInfo.environment["AGENTIC30_RUN_LIVE_PROVIDER_E2E"] == "1"
            || FileManager.default.fileExists(atPath: "/tmp/agentic30-run-live-provider-e2e")
    }

    @MainActor
    func testRealSidecarChatLiveCanary() throws {
        guard ProcessInfo.processInfo.environment["AGENTIC30_RUN_LIVE_PROVIDER_E2E"] == "1" else {
            throw XCTSkip("Set AGENTIC30_RUN_LIVE_PROVIDER_E2E=1 to run the live provider canary.")
        }
        try runSidecarChatFlow(liveProvider: true)
    }

    @MainActor
    func testHiPromptLiveLatencyFromMacApp() throws {
        guard ProcessInfo.processInfo.environment["AGENTIC30_RUN_HI_LATENCY_E2E"] == "1"
            || FileManager.default.fileExists(atPath: "/tmp/agentic30-run-hi-latency-e2e")
        else {
            throw XCTSkip("Set AGENTIC30_RUN_HI_LATENCY_E2E=1 or create /tmp/agentic30-run-hi-latency-e2e to measure the live macOS app hi prompt latency.")
        }

        let runID = UUID().uuidString
        let temporaryRoot = FileManager.default.temporaryDirectory
        let workspacePath = temporaryRoot
            .appendingPathComponent("agentic30-ui-hi-latency-workspace-\(runID)", isDirectory: true)
            .path
        let appSupportPath = temporaryRoot
            .appendingPathComponent("agentic30-ui-hi-latency-app-support-\(runID)", isDirectory: true)
            .path
        resetDirectory(at: workspacePath)
        resetDirectory(at: appSupportPath)
        try writeDay1ICPWorkspaceFixture(workspacePath: workspacePath, appSupportPath: appSupportPath)

        let launchStartedAt = Date()
        let app = launchApp(
            arguments: [
                "--ui-testing-reset-onboarding",
                "--ui-testing-seed-auth",
                "--ui-testing-seed-workspace=\(workspacePath)",
                "--ui-testing-seed-onboarding-context",
                "--ui-testing-opaque-window",
            ],
            environment: [
                "AGENTIC30_APP_SUPPORT_PATH": appSupportPath,
                "AGENTIC30_CODEX_MODEL": ProcessInfo.processInfo.environment["AGENTIC30_CODEX_MODEL"] ?? "gpt-5.4-mini",
                "AGENTIC30_CODEX_REASONING_EFFORT": ProcessInfo.processInfo.environment["AGENTIC30_CODEX_REASONING_EFFORT"] ?? "low",
                "AGENTIC30_RESTORE_SESSIONS_ON_BOOT": "0",
            ]
        )
        hideKnownInterferingApplications()
        app.activate()
        addTeardownBlock {
            app.terminate()
            self.unhideKnownInterferingApplications()
            self.removeDirectory(at: workspacePath)
            self.removeDirectory(at: appSupportPath)
        }

        let bootstrapPrompt = app.descendants(matching: .any)["assistant.structuredPrompt"]
        XCTAssertTrue(
            bootstrapPrompt.waitForExistence(timeout: 120),
            "The startup session should appear as the initial structured prompt before measuring hi latency."
        )
        let startupSessionVisibleMs = Int((Date().timeIntervalSince(launchStartedAt) * 1000).rounded())
        answerBootstrapPromptIfNeeded(in: app)

        let promptComposer = textField(in: app, matching: [
            "assistant.promptComposer",
            "메시지 보내기",
            "오늘 무엇을 도와드릴까요? /office-hours-docs",
        ])
        XCTAssertTrue(promptComposer.waitForExistence(timeout: 120), "The assistant composer should be visible before measuring hi latency.")
        let sendButton = button(in: app, matching: [
            "assistant.sendPromptButton",
            "Send prompt",
        ])
        XCTAssertTrue(sendButton.waitForExistence(timeout: 5), "The assistant send button should be visible.")
        let warmStore = try XCTUnwrap(
            waitForCodexWarmupReady(appSupportPath: appSupportPath, timeout: 90),
            "Expected Codex warm-up to complete before measuring hi latency."
        )
        let warmSummary = extractCodexWarmSummary(fromSessionStore: warmStore)
        let startupTiming = extractSessionStartupTiming(fromSessionStore: warmStore)

        let response = app.staticTexts["assistant.latestAnswer"]
        let previousAnswer = response.exists ? response.label : ""
        enterPrompt("하이", in: app, promptComposer: promptComposer)
        XCTAssertTrue(sendButton.isEnabled, "Send button should become enabled after typing hi.")

        let startedAt = Date()
        sendButton.click()
        XCTAssertTrue(waitForLatestPrompt(in: app, containing: "하이", timeout: 10), "The hi prompt should render as a user bubble.")

        let sessionStore = try XCTUnwrap(
            waitForCompletedAssistantResponse(
                appSupportPath: appSupportPath,
                afterUserMessageContaining: "하이",
                timeout: 180
            ),
            "Expected a completed live assistant response after the hi prompt."
        )
        let storeCompletedAt = Date()

        let assistantContent = extractLatestCompletedAssistantContent(
            fromSessionStore: sessionStore,
            afterUserMessageContaining: "하이"
        )
        let visibleAnswerSnippet = assistantContent
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .components(separatedBy: .newlines)
            .first?
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let answerTextVisible = visibleAnswerSnippet.isEmpty
            ? waitForAnswerChange(in: app, previousAnswer: previousAnswer, timeout: 30)
            : waitForLatestAnswer(in: app, containing: visibleAnswerSnippet, timeout: 30)
        let visibleAt = Date()
        let timingSummary = extractLatestAssistantTimingSummary(
            fromSessionStore: sessionStore,
            afterUserMessageContaining: "하이"
        )
        let uiStoreMs = Int((storeCompletedAt.timeIntervalSince(startedAt) * 1000).rounded())
        let uiVisibleMs = Int((visibleAt.timeIntervalSince(startedAt) * 1000).rounded())
        let result = [
            "prompt": "하이",
            "startup_session_visible_ms": startupSessionVisibleMs,
            "session_startup_timing": startupTiming,
            "ui_to_session_store_complete_ms": uiStoreMs,
            "ui_to_visible_answer_ms": uiVisibleMs,
            "visible": answerTextVisible,
            "assistant_content_preview": String(assistantContent.prefix(240)),
            "warm": warmSummary,
            "assistant_timing": timingSummary,
        ] as [String: Any]
        let resultText = String(
            data: try JSONSerialization.data(withJSONObject: result, options: [.prettyPrinted, .sortedKeys]),
            encoding: .utf8
        ) ?? "\(result)"
        print("AGENTIC30_HI_LATENCY_E2E_RESULT \(resultText)")
        attachText(resultText, named: "Hi Prompt Live Latency Result")
        attachText(sessionStore, named: "Hi Prompt Live Session Store")
        if !answerTextVisible {
            attachScreenshot(from: app, named: "Hi Prompt Answer Not Visible")
            attachText(app.debugDescription, named: "Hi Prompt Answer Not Visible Tree")
        }
        XCTAssertTrue(answerTextVisible, "The assistant answer should become visible in the macOS app.")
    }

    @MainActor
    private func runSidecarChatFlow(liveProvider: Bool) throws {
        let runID = UUID().uuidString
        let workspacePath = "/tmp/agentic30-ui-\(liveProvider ? "live" : "stub")-workspace-\(runID)"
        let appSupportPath = "/tmp/agentic30-ui-\(liveProvider ? "live" : "stub")-app-support-\(runID)"
        let marker = liveProvider ? "UI_REAL_CHAT_LIVE_OK" : "UI_STUB_CHAT_OK"
        resetDirectory(at: workspacePath)
        resetDirectory(at: appSupportPath)

        var environment = [
            "AGENTIC30_APP_SUPPORT_PATH": appSupportPath,
            "AGENTIC30_CODEX_MODEL": "gpt-5.4-mini",
        ]
        if !liveProvider {
            environment["AGENTIC30_TEST_STUB_PROVIDER"] = "1"
            environment["AGENTIC30_UI_TEST_INLINE_STUB_RESPONSES"] = "1"
        }

        var launchArguments = [
            "--ui-testing-reset-onboarding",
            "--ui-testing-seed-auth",
            "--ui-testing-seed-workspace=\(workspacePath)",
            "--ui-testing-seed-onboarding-context",
            "--ui-testing-seed-draft=\(marker)",
            "--ui-testing-open-workspace",
            "--ui-testing-opaque-window",
        ]
        if !liveProvider {
            launchArguments.append("--ui-testing-disable-sidecar")
        }

        let chatApp = launchApp(
            arguments: launchArguments,
            environment: environment
        )
        hideKnownInterferingApplications()
        chatApp.activate()
        addTeardownBlock {
            chatApp.terminate()
            self.unhideKnownInterferingApplications()
            self.removeDirectory(at: workspacePath)
            self.removeDirectory(at: appSupportPath)
        }

        answerBootstrapPromptIfNeeded(in: chatApp, allowComposerFallback: false)

        let promptComposer = textField(in: chatApp, matching: [
            "assistant.promptComposer",
            "오늘 무엇을 도와드릴까요? /office-hours-docs",
        ])
        XCTAssertTrue(promptComposer.waitForExistence(timeout: liveProvider ? 180 : 60))
        XCTAssertTrue(waitForSessionBackedComposer(promptComposer, timeout: liveProvider ? 180 : 60))
        attachScreenshot(from: chatApp, named: "01 Real Sidecar Chat Ready")

        let sendButton = button(in: chatApp, matching: [
            "assistant.sendPromptButton",
            "Send prompt",
        ])
        if !element(promptComposer, contains: marker) || !sendButton.isEnabled {
            enterPrompt(marker, in: chatApp, promptComposer: promptComposer)
        }
        XCTAssertTrue(waitUntilEnabled(sendButton, timeout: 10))
        let latestPromptUpdated = submitPromptAndWaitForLatestPrompt(
            in: chatApp,
            promptComposer: promptComposer,
            sendButton: sendButton,
            marker: marker,
            timeout: 30
        )
        if !latestPromptUpdated {
            attachText(chatApp.debugDescription, named: "03 Latest Prompt Accessibility Tree")
        }
        XCTAssertTrue(latestPromptUpdated)
        attachScreenshot(from: chatApp, named: "03 Real Sidecar Chat Sent")

        if liveProvider {
            let sessionStore = try XCTUnwrap(
                waitForCompletedAssistantResponse(
                    appSupportPath: appSupportPath,
                    afterUserMessageContaining: marker,
                    timeout: 180
                ),
                "Expected sessions.json to contain the sent marker followed by a completed assistant response."
            )
            XCTAssertFalse(sessionStore.contains("gpt-5.5"))
            XCTAssertFalse(sessionStore.contains("does not exist or you do not have access"))
            attachText(sessionStore, named: "05 Real Sidecar Session Store")
        }
        XCTAssertTrue(
            waitForLatestAnswer(in: chatApp, containing: marker, timeout: 5),
            "Expected the completed assistant response to render in either the latest-answer panel or the workspace chat thread."
        )
        attachScreenshot(from: chatApp, named: "04 Real Sidecar Chat Response")
        chatApp.terminate()
    }

    @MainActor
    func testLaunchPerformance() throws {
        measure(metrics: [XCTApplicationLaunchMetric()]) {
            let app = launchApp(arguments: [
                "--ui-testing-reset-onboarding",
                "--ui-testing-disable-sidecar",
            ])
            app.terminate()
        }
    }

    @MainActor
    func testBipCoachShowsActionableSidecarFailure() throws {
        let workspacePath = "/tmp/agentic30-ui-bip-sidecar-failure-\(UUID().uuidString)"
        resetDirectory(at: workspacePath)
        let app = launchApp(arguments: [
            "--ui-testing-reset-onboarding",
            "--ui-testing-seed-auth",
            "--ui-testing-seed-onboarding-context",
            "--ui-testing-seed-workspace=\(workspacePath)",
            "--ui-testing-seed-idd-complete",
            "--ui-testing-sidecar-failure",
            "--ui-testing-open-workspace",
            "--ui-testing-opaque-window",
        ])
        hideKnownInterferingApplications()
        app.activate()
        addTeardownBlock {
            app.terminate()
            self.unhideKnownInterferingApplications()
            self.removeDirectory(at: workspacePath)
        }

        XCTAssertTrue(app.descendants(matching: .any)["workspace.missionFirstSurface"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.descendants(matching: .any)["workspace.bipCoach.inlineModule"].exists)
        XCTAssertFalse(app.descendants(matching: .any)["workspace.chatThread"].exists)
        XCTAssertFalse(app.descendants(matching: .any)["workspace.chat.bipMissionCard"].exists)
        XCTAssertTrue(app.descendants(matching: .any)["workspace.missionFirst.retry"].exists)
        XCTAssertTrue(app.descendants(matching: .any)["workspace.missionFirst.retry"].label.contains("다시 연결"))
        XCTAssertTrue(app.descendants(matching: .any)["workspace.missionFirst.errorMessage"].exists)
        XCTAssertFalse(app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", "Cannot read properties")).firstMatch.exists)
        app.terminate()
    }

    @MainActor
    func testWorkspaceStartupShowsFoundationSetupAndLocksNavigation() throws {
        let workspacePath = "/tmp/agentic30-ui-startup-queue-\(UUID().uuidString)"
        resetDirectory(at: workspacePath)
        let app = launchApp(arguments: [
            "--ui-testing-reset-onboarding",
            "--ui-testing-seed-auth",
            "--ui-testing-seed-onboarding-context",
            "--ui-testing-seed-workspace=\(workspacePath)",
            "--ui-testing-disable-sidecar",
            "--ui-testing-open-workspace",
            "--ui-testing-opaque-window",
        ])
        hideKnownInterferingApplications()
        app.activate()
        addTeardownBlock {
            app.terminate()
            self.unhideKnownInterferingApplications()
            self.removeDirectory(at: workspacePath)
        }

        XCTAssertTrue(app.descendants(matching: .any)["workspace.iddSetupSurface"].waitForExistence(timeout: 10))
        XCTAssertFalse(app.descendants(matching: .any)["workspace.missionFirstSurface"].exists)
        XCTAssertTrue(app.staticTexts["먼저 도울 사람을 정해요"].exists)
        XCTAssertTrue(app.staticTexts["오늘 할 일을 만들기 전에, 누구를 위해 무엇을 검증할지 먼저 정해요."].exists)
        XCTAssertTrue(app.descendants(matching: .any)["workspace.day.1"].exists)
        XCTAssertTrue(app.descendants(matching: .any)["workspace.day.2"].exists)
        XCTAssertFalse(app.descendants(matching: .any)["workspace.day.8"].exists)
        XCTAssertTrue(app.descendants(matching: .any)["workspace.curriculumFutureModule"].exists)
        XCTAssertTrue(app.descendants(matching: .any)["workspace.iddSetup.progress"].exists)
        XCTAssertTrue(app.descendants(matching: .any)["workspace.iddSetup.doc.icp"].exists)
        XCTAssertTrue(app.descendants(matching: .any)["workspace.iddSetup.doc.goal"].exists)
        XCTAssertTrue(app.descendants(matching: .any)["workspace.iddSetup.doc.values"].exists)
        XCTAssertTrue(app.descendants(matching: .any)["workspace.iddSetup.doc.spec"].exists)
        XCTAssertTrue(app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", "Foundation Setup을 승인해야 이동할 수 있어요")).firstMatch.exists)
        app.descendants(matching: .any)["workspace.day.2"].click()
        XCTAssertTrue(app.staticTexts["먼저 도울 사람을 정해요"].waitForExistence(timeout: 2))
        XCTAssertTrue(app.descendants(matching: .any)["workspace.iddSetupSurface"].exists)
        XCTAssertFalse(app.descendants(matching: .any)["workspace.startupStatusRail"].exists)
        XCTAssertFalse(app.descendants(matching: .any)["workspace.startupQueueHint"].exists)
        XCTAssertFalse(app.descendants(matching: .any)["workspace.curriculumFocus"].exists)
        XCTAssertFalse(app.descendants(matching: .any)["workspace.chatAssistant"].exists)
        XCTAssertFalse(app.descendants(matching: .any)["workspace.queueBipMission"].exists)
        XCTAssertFalse(app.descendants(matching: .any)["assistant.promptComposer"].exists)
        XCTAssertFalse(app.descendants(matching: .any)["workspace.generateBipMission"].exists)
    }

    @MainActor
    func testBipMissionGenerationStaysInlineInCurriculum() throws {
        let workspacePath = "/tmp/agentic30-ui-bip-inline-generation-\(UUID().uuidString)"
        resetDirectory(at: workspacePath)
        let app = launchApp(
            arguments: [
                "--ui-testing-reset-onboarding",
                "--ui-testing-seed-auth",
                "--ui-testing-seed-onboarding-context",
                "--ui-testing-seed-workspace=\(workspacePath)",
                "--ui-testing-seed-idd-complete",
                "--ui-testing-disable-sidecar",
                "--ui-testing-open-workspace",
                "--ui-testing-opaque-window",
            ],
            environment: [
                "AGENTIC30_UI_TEST_INLINE_STUB_RESPONSES": "1",
            ]
        )
        hideKnownInterferingApplications()
        app.activate()
        addTeardownBlock {
            app.terminate()
            self.unhideKnownInterferingApplications()
            self.removeDirectory(at: workspacePath)
        }

        let generateMission = button(in: app, matching: [
            "workspace.generateBipMission",
            "오늘 실행 생성",
        ])
        XCTAssertTrue(generateMission.waitForExistence(timeout: 10))
        XCTAssertEqual(app.descendants(matching: .any).matching(identifier: "workspace.generateBipMission").count, 1)
        XCTAssertFalse(app.descendants(matching: .any)["workspace.curriculumFocus"].exists)
        XCTAssertFalse(app.descendants(matching: .any)["workspace.chatAssistant"].exists)
        XCTAssertFalse(app.descendants(matching: .any)["workspace.chat.todayTasksCard"].exists)
        clickCenter(of: generateMission)

        XCTAssertTrue(app.descendants(matching: .any)["workspace.missionFirstSurface"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.descendants(matching: .any)["workspace.bipCoach.inlineModule"].exists)
        XCTAssertTrue(app.descendants(matching: .any)["workspace.missionFirst.generating"].waitForExistence(timeout: 3))
        XCTAssertFalse(app.descendants(matching: .any)["workspace.chatThread"].exists)
        XCTAssertFalse(app.descendants(matching: .any)["workspace.chat.bipMissionCard"].exists)
        XCTAssertFalse(app.descendants(matching: .any)["workspace.settingsPage"].exists)
    }

    @MainActor
    func testLocalBipMissionChoicesAppearWithoutGoogleSetup() throws {
        let workspacePath = "/tmp/agentic30-ui-bip-local-mission-\(UUID().uuidString)"
        resetDirectory(at: workspacePath)
        let app = launchApp(
            arguments: [
                "--ui-testing-reset-onboarding",
                "--ui-testing-seed-auth",
                "--ui-testing-seed-onboarding-context",
                "--ui-testing-seed-workspace=\(workspacePath)",
                "--ui-testing-disable-sidecar",
                "--ui-testing-seed-idd-complete",
                "--ui-testing-seed-bip-local-mission-choices",
                "--ui-testing-open-workspace",
                "--ui-testing-opaque-window",
            ],
            environment: [
                "AGENTIC30_UI_TEST_INLINE_STUB_RESPONSES": "1",
            ]
        )
        hideKnownInterferingApplications()
        app.activate()
        addTeardownBlock {
            app.terminate()
            self.unhideKnownInterferingApplications()
            self.removeDirectory(at: workspacePath)
        }

        XCTAssertTrue(app.descendants(matching: .any)["workspace.missionFirstSurface"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.descendants(matching: .any)["workspace.bipCoach.inlineModule"].exists)
        XCTAssertFalse(app.descendants(matching: .any)["workspace.chat.bipMissionCard"].exists)
        XCTAssertTrue(app.staticTexts["프로젝트를 읽고 오늘 검증할 행동 하나를 고르세요"].exists)
        XCTAssertTrue(app.descendants(matching: .any)["workspace.missionFirst.introCard"].exists)
        XCTAssertTrue(app.descendants(matching: .any)["workspace.missionFirst.introToggle"].exists)
        app.descendants(matching: .any)["workspace.missionFirst.introToggle"].click()
        XCTAssertTrue(app.descendants(matching: .any)["workspace.missionFirst.introDemo"].waitForExistence(timeout: 2))
        XCTAssertTrue(app.descendants(matching: .any)["workspace.missionFirst.guide"].exists)
        XCTAssertTrue(app.descendants(matching: .any)["workspace.missionFirst.guideStep.1"].exists)
        XCTAssertTrue(app.staticTexts["프로젝트 기준 확인"].exists)
        XCTAssertTrue(app.staticTexts["오늘 실행 하나 선택"].exists)
        XCTAssertTrue(app.staticTexts["필요한 초안 요청"].exists)
        XCTAssertTrue(app.descendants(matching: .any)["workspace.missionFirst.choices"].waitForExistence(timeout: 3))
        XCTAssertTrue(app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", "첫 고객 후보 3명 정하기")).firstMatch.exists)
        XCTAssertTrue(app.descendants(matching: .any)["workspace.missionFirst.recommendationReason"].exists)
        XCTAssertTrue(app.descendants(matching: .any)["workspace.missionFirst.choiceEvidence"].exists)
        XCTAssertTrue(app.descendants(matching: .any)["workspace.missionFirst.choiceOutcome"].exists)
        XCTAssertTrue(app.descendants(matching: .any)["workspace.missionFirst.choicePrimaryAction"].exists)
        XCTAssertTrue(app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", "이 미션으로 시작")).firstMatch.exists)
        XCTAssertTrue(textField(in: app, matching: [
            "assistant.promptComposer",
            "예: 왜 1번이 추천인가요? / 더 작은 미션으로 줄여줘",
        ]).exists)
        XCTAssertFalse(app.staticTexts["먼저 프로젝트 기준과 기록 장소를 준비합니다."].exists)
        XCTAssertFalse(app.descendants(matching: .any)["workspace.settingsPage"].exists)
    }

    @MainActor
    func testMorningBipNotificationWithChoicesShowsTaskSurfacePrimaryAction() throws {
        let workspacePath = "/tmp/agentic30-ui-bip-notification-choices-\(UUID().uuidString)"
        resetDirectory(at: workspacePath)
        let app = launchApp(
            arguments: [
                "--ui-testing-reset-onboarding",
                "--ui-testing-seed-auth",
                "--ui-testing-seed-onboarding-context",
                "--ui-testing-seed-workspace=\(workspacePath)",
                "--ui-testing-disable-sidecar",
                "--ui-testing-seed-idd-complete",
                "--ui-testing-seed-bip-local-mission-choices",
                "--ui-testing-open-bip-notification=morning",
                "--ui-testing-opaque-window",
            ],
            environment: [
                "AGENTIC30_UI_TEST_INLINE_STUB_RESPONSES": "1",
            ]
        )
        hideKnownInterferingApplications()
        app.activate()
        addTeardownBlock {
            app.terminate()
            self.unhideKnownInterferingApplications()
            self.removeDirectory(at: workspacePath)
        }

        XCTAssertTrue(app.descendants(matching: .any)["workspace.bipNotificationTaskSurface"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["10시 오늘 실행"].exists)
        XCTAssertTrue(app.staticTexts["작게 하나 공개할 미션을 정하세요."].exists)
        let primaryActions = app.descendants(matching: .any).matching(identifier: "workspace.bipNotificationPrimaryAction")
        XCTAssertTrue(primaryActions.firstMatch.waitForExistence(timeout: 3))
        XCTAssertEqual(primaryActions.count, 1)
        XCTAssertTrue(primaryActions.firstMatch.label.contains("이 미션으로 시작"))
        XCTAssertTrue(app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", "첫 고객 후보 3명 정하기")).firstMatch.exists)
    }

    @MainActor
    func testMorningBipNotificationRoutesToInlineCoach() throws {
        let workspacePath = "/tmp/agentic30-ui-bip-notification-morning-\(UUID().uuidString)"
        resetDirectory(at: workspacePath)
        let app = launchApp(arguments: [
            "--ui-testing-reset-onboarding",
            "--ui-testing-seed-auth",
            "--ui-testing-seed-onboarding-context",
            "--ui-testing-seed-workspace=\(workspacePath)",
            "--ui-testing-seed-idd-complete",
            "--ui-testing-sidecar-failure",
            "--ui-testing-open-workspace",
            "--ui-testing-open-bip-notification=morning",
            "--ui-testing-opaque-window",
        ])
        hideKnownInterferingApplications()
        app.activate()
        addTeardownBlock {
            app.terminate()
            self.unhideKnownInterferingApplications()
            self.removeDirectory(at: workspacePath)
        }

        XCTAssertTrue(app.descendants(matching: .any)["workspace.bipNotificationTaskSurface"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["10시 오늘 실행"].exists)
        XCTAssertTrue(app.staticTexts["작게 하나 공개할 미션을 정하세요."].exists)
        XCTAssertTrue(app.buttons["workspace.bipNotificationPrimaryAction"].label.contains("연결 문제 해결"))
        XCTAssertTrue(app.descendants(matching: .any)["workspace.bipNotificationBlockingRow"].exists)
        XCTAssertTrue(app.descendants(matching: .any)["workspace.bipCoach.inlineModule"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.descendants(matching: .any)["workspace.missionFirst.retry"].exists)
        XCTAssertTrue(app.descendants(matching: .any)["workspace.missionFirst.retry"].label.contains("다시 연결"))
        XCTAssertFalse(app.descendants(matching: .any)["workspace.settingsPage"].exists)
    }

    @MainActor
    func testEveningBipNotificationExpandsCompletionFieldsForCurrentMission() throws {
        let workspacePath = "/tmp/agentic30-ui-bip-notification-evening-\(UUID().uuidString)"
        resetDirectory(at: workspacePath)
        hideKnownInterferingApplications()
        let app = launchApp(
            arguments: [
                "--ui-testing-reset-onboarding",
                "--ui-testing-seed-auth",
                "--ui-testing-seed-onboarding-context",
                "--ui-testing-seed-workspace=\(workspacePath)",
                "--ui-testing-disable-sidecar",
                "--ui-testing-seed-idd-complete",
                "--ui-testing-seed-bip-current-mission",
                "--ui-testing-open-bip-notification=evening",
                "--ui-testing-opaque-window",
            ],
            environment: [
                "AGENTIC30_UI_TEST_INLINE_STUB_RESPONSES": "1",
            ]
        )
        app.activate()
        addTeardownBlock {
            app.terminate()
            self.unhideKnownInterferingApplications()
            self.removeDirectory(at: workspacePath)
        }

        XCTAssertTrue(app.descendants(matching: .any)["workspace.bipNotificationTaskSurface"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["21시 마감 체크"].exists)
        XCTAssertTrue(app.staticTexts["게시 기록을 남기면 오늘 루프가 닫힙니다."].exists)
        XCTAssertTrue(app.descendants(matching: .any)["workspace.bipCoach.inlineModule"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["게시 기록 자동 확인"].waitForExistence(timeout: 3))
        XCTAssertTrue(app.buttons["assistant.completeBipMission"].exists)
        XCTAssertFalse(app.textFields["assistant.bipThreadsURL"].exists)
        XCTAssertFalse(app.textFields["assistant.bipSheetRowNote"].exists)
        XCTAssertFalse(app.staticTexts["생성 중..."].exists)
        XCTAssertFalse(app.descendants(matching: .any)["workspace.settingsPage"].exists)
    }

    @MainActor
    private func launchApp(
        arguments: [String],
        environment: [String: String] = [:]
    ) -> XCUIApplication {
        terminateRunningAgenticAppIfNeeded()

        let app = XCUIApplication()
        app.launchArguments = arguments
        app.launchEnvironment = environment
        app.launch()
        return app
    }

    private func terminateRunningAgenticAppIfNeeded() {
        let bundleIdentifier = "october-academy.agentic30"
        let runningApplications = NSWorkspace.shared.runningApplications.filter {
            $0.bundleIdentifier == bundleIdentifier
        }

        guard !runningApplications.isEmpty else { return }

        for application in runningApplications {
            application.terminate()
        }
        waitForAgenticAppToExit(bundleIdentifier: bundleIdentifier, timeout: 2)

        for application in runningApplications where !application.isTerminated {
            application.forceTerminate()
        }
        waitForAgenticAppToExit(bundleIdentifier: bundleIdentifier, timeout: 2)

        for application in runningApplications where !application.isTerminated {
            let pid = application.processIdentifier
            if pid > 0 {
                kill(pid, SIGKILL)
            }
        }
        waitForAgenticAppToExit(bundleIdentifier: bundleIdentifier, timeout: 2)
    }

    private func waitForAgenticAppToExit(bundleIdentifier: String, timeout: TimeInterval) {
        let deadline = Date().addingTimeInterval(timeout)
        repeat {
            let stillRunning = NSWorkspace.shared.runningApplications.contains {
                $0.bundleIdentifier == bundleIdentifier
            }
            if !stillRunning { return }
            RunLoop.current.run(until: Date().addingTimeInterval(0.1))
        } while Date() < deadline
    }

    private func macAuthBaseURLArguments() -> [String] {
        guard let baseURL = ProcessInfo.processInfo.environment["AGENTIC30_MAC_AUTH_BASE_URL"]?.trimmedNonEmpty else {
            return []
        }
        return ["--ui-testing-web-base-url=\(baseURL)"]
    }

    @MainActor
    private func openSettingsWindow(in app: XCUIApplication) -> Bool {
        if settingsWindowVisible(in: app) {
            return true
        }

        app.activate()
        app.typeKey(",", modifierFlags: .command)
        if waitForSettingsWindow(in: app, timeout: 3) {
            return true
        }

        let appMenu = app.menuBars.menuBarItems["agentic30"]
        if appMenu.exists {
            appMenu.click()
            let settingsItem = app.menuItems["Settings…"]
            if settingsItem.waitForExistence(timeout: 2) {
                settingsItem.click()
                return waitForSettingsWindow(in: app, timeout: 5)
            }
        }

        return waitForSettingsWindow(in: app, timeout: 2)
    }

    @MainActor
    private func settingsWindowVisible(in app: XCUIApplication) -> Bool {
        app.staticTexts["Agent Models"].exists
            || app.staticTexts["Developer Tools"].exists
            // Sidebar identifiers — pick whichever section the launch flag opened to.
            || app.buttons["quarantineRecovery"].exists
            || app.staticTexts["정직 모드 복구"].exists
    }

    @MainActor
    private func waitForSettingsWindow(in app: XCUIApplication, timeout: TimeInterval) -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        repeat {
            if settingsWindowVisible(in: app) {
                return true
            }
            RunLoop.current.run(until: Date().addingTimeInterval(0.1))
        } while Date() < deadline
        return settingsWindowVisible(in: app)
    }

    @MainActor
    private func chooseModelOption(
        in app: XCUIApplication,
        pickerIdentifier: String,
        optionLabel: String,
        optionIdentifier: String
    ) -> Bool {
        let modelIDIdentifier = pickerIdentifier.replacingOccurrences(of: "modelPicker", with: "modelID")
        if let expectedModelID = optionIdentifier.split(separator: ".").last,
           waitForModelID(in: app, identifier: modelIDIdentifier, value: String(expectedModelID), timeout: 1) {
            return true
        }

        for _ in 0..<3 {
            app.activate()
            let shortcut = elementWithIdentifier(in: app, optionIdentifier)
            if shortcut.waitForExistence(timeout: 1) {
                clickCenter(of: shortcut)
                return true
            }

            let picker = hittableElementWithIdentifier(
                in: app,
                pickerIdentifier,
                timeout: 2
            ) ?? elementWithIdentifier(in: app, pickerIdentifier)
            guard picker.waitForExistence(timeout: 2) else {
                continue
            }

            clickCenter(of: picker)

            let menuItem = app.menuItems[optionLabel]
            if menuItem.waitForExistence(timeout: 3) {
                menuItem.click()
                return true
            }

            let labelMatch = app.descendants(matching: .any)
                .matching(NSPredicate(format: "label == %@", optionLabel))
                .element(boundBy: 0)
            if labelMatch.waitForExistence(timeout: 1) {
                clickCenter(of: labelMatch)
                return true
            }

            let shortcutAfterMenuAttempt = elementWithIdentifier(in: app, optionIdentifier)
            if shortcutAfterMenuAttempt.waitForExistence(timeout: 1) {
                clickCenter(of: shortcutAfterMenuAttempt)
                return true
            }

            app.typeKey(.escape, modifierFlags: [])
            RunLoop.current.run(until: Date().addingTimeInterval(0.25))
        }
        return false
    }

    @MainActor
    private func waitForModelID(
        in app: XCUIApplication,
        identifier: String,
        value: String,
        timeout: TimeInterval = 3
    ) -> Bool {
        let modelID = elementWithIdentifier(in: app, identifier)
        let deadline = Date().addingTimeInterval(timeout)

        repeat {
            if modelID.exists && element(modelID, contains: value) {
                return true
            }
            RunLoop.current.run(until: Date().addingTimeInterval(0.25))
        } while Date() < deadline

        return modelID.exists && element(modelID, contains: value)
    }

    @MainActor
    private func elementWithIdentifier(in app: XCUIApplication, _ identifier: String) -> XCUIElement {
        app.descendants(matching: .any)
            .matching(NSPredicate(format: "identifier == %@", identifier))
            .element(boundBy: 0)
    }

    @MainActor
    private func hittableElementWithIdentifier(
        in app: XCUIApplication,
        _ identifier: String,
        timeout: TimeInterval
    ) -> XCUIElement? {
        let deadline = Date().addingTimeInterval(timeout)
        let matches = app.descendants(matching: .any)
            .matching(NSPredicate(format: "identifier == %@", identifier))

        repeat {
            if let element = matches.allElementsBoundByIndex.first(where: { $0.exists && $0.isHittable }) {
                return element
            }
            RunLoop.current.run(until: Date().addingTimeInterval(0.2))
        } while Date() < deadline

        return matches.allElementsBoundByIndex.first(where: { $0.exists && $0.isHittable })
    }

    @MainActor
    private func advanceToGoogleSignIn(in app: XCUIApplication) {
        let primary = button(in: app, matching: [
            "macOnboarding.primaryButton",
            "Next",
            "Sign in with Google",
        ])
        for _ in 0..<4 where !app.staticTexts["Sign in to get started"].exists {
            XCTAssertTrue(primary.waitForExistence(timeout: 5))
            primary.click()
            RunLoop.current.run(until: Date().addingTimeInterval(0.25))
        }

        XCTAssertTrue(app.staticTexts["Sign in to get started"].waitForExistence(timeout: 5))
        let termsCheckbox = button(in: app, matching: [
            "macOnboarding.termsCheckbox",
            "Accept Terms and Privacy Policy",
        ])
        XCTAssertTrue(termsCheckbox.exists)
        if !button(in: app, matching: ["macOnboarding.primaryButton", "Sign in with Google"]).isEnabled {
            termsCheckbox.click()
        }
        let signInButton = button(in: app, matching: [
            "macOnboarding.primaryButton",
            "Sign in with Google",
        ])
        XCTAssertTrue(waitUntilEnabled(signInButton, timeout: 5))
        signInButton.click()
    }

    @MainActor
    private func completeGoogleSignIn(
        credentials: GoogleE2ECredentials,
        hostApp: XCUIApplication
    ) throws {
        let authApps = googleAuthApplications(hostApp: hostApp)

        if let existingAccount = waitForGoogleElement(
            in: authApps,
            timeout: 12,
            candidates: { app in
                [
                    app.staticTexts[credentials.email],
                    app.buttons[credentials.email],
                    app.staticTexts["Use another account"],
                    app.buttons["Use another account"],
                ]
            }
        ) {
            existingAccount.click()
        }

        if !hostApp.staticTexts["Choose your project folder"].exists {
            if let emailField = waitForGoogleTextInput(
                in: authApps,
                labels: ["Email or phone", "Email", "Enter your email"],
                timeout: 45
            ) {
                emailField.click()
                emailField.typeText(credentials.email)
                clickGoogleNext(in: authApps)
            }
        }

        if !hostApp.staticTexts["Choose your project folder"].exists {
            let passwordField = try XCTUnwrap(
                waitForGoogleSecureInput(in: authApps, timeout: 45),
                "Google password field did not appear."
            )
            passwordField.click()
            passwordField.typeText(credentials.password)
            clickGoogleNext(in: authApps)
        }

        if !hostApp.staticTexts["Choose your project folder"].waitForExistence(timeout: 8) {
            let code = try currentTOTPCode(secret: credentials.totpSecret)
            if let codeField = waitForGoogleTextInput(
                in: authApps,
                labels: ["Enter code", "Enter the code", "Code", "인증 코드"],
                timeout: 45
            ) {
                codeField.click()
                codeField.typeText(code)
                clickGoogleNext(in: authApps)
            }
        }
    }

    @MainActor
    private func googleAuthApplications(hostApp: XCUIApplication) -> [XCUIApplication] {
        [
            hostApp,
            XCUIApplication(bundleIdentifier: "com.apple.SafariViewService"),
            XCUIApplication(bundleIdentifier: "com.apple.AuthenticationServicesUI"),
            XCUIApplication(bundleIdentifier: "com.apple.Safari"),
            XCUIApplication(bundleIdentifier: "com.google.Chrome"),
            XCUIApplication(bundleIdentifier: "company.thebrowser.Browser"),
        ]
    }

    @MainActor
    private func waitForGoogleTextInput(
        in apps: [XCUIApplication],
        labels: [String],
        timeout: TimeInterval
    ) -> XCUIElement? {
        waitForGoogleElement(in: apps, timeout: timeout) { app in
            labels.flatMap { label in
                [
                    app.textFields[label],
                    app.textFields.matching(NSPredicate(format: "label CONTAINS[c] %@", label)).element(boundBy: 0),
                    app.textFields.matching(NSPredicate(format: "value CONTAINS[c] %@", label)).element(boundBy: 0),
                ]
            } + [
                app.textFields.element(boundBy: 0),
            ]
        }
    }

    @MainActor
    private func waitForGoogleSecureInput(
        in apps: [XCUIApplication],
        timeout: TimeInterval
    ) -> XCUIElement? {
        waitForGoogleElement(in: apps, timeout: timeout) { app in
            [
                app.secureTextFields["Enter your password"],
                app.secureTextFields["Password"],
                app.secureTextFields.matching(NSPredicate(format: "label CONTAINS[c] %@", "password")).element(boundBy: 0),
                app.secureTextFields.element(boundBy: 0),
            ]
        }
    }

    @MainActor
    private func clickGoogleNext(in apps: [XCUIApplication]) {
        if let nextButton = waitForGoogleElement(in: apps, timeout: 15, candidates: { app in
            [
                app.buttons["Next"],
                app.buttons["다음"],
                app.buttons["Continue"],
                app.buttons.matching(NSPredicate(format: "label CONTAINS[c] %@", "Next")).element(boundBy: 0),
            ]
        }) {
            nextButton.click()
        }
    }

    @MainActor
    private func waitForGoogleElement(
        in apps: [XCUIApplication],
        timeout: TimeInterval,
        candidates: (XCUIApplication) -> [XCUIElement]
    ) -> XCUIElement? {
        let deadline = Date().addingTimeInterval(timeout)
        repeat {
            for app in apps {
                for candidate in candidates(app) where candidate.exists && candidate.isHittable {
                    return candidate
                }
                for candidate in candidates(app) where candidate.exists {
                    return candidate
                }
            }
            RunLoop.current.run(until: Date().addingTimeInterval(0.25))
        } while Date() < deadline
        return nil
    }

    private func dismissOAuthHandoffIfPresent(in app: XCUIApplication? = nil) {
        if let app {
            app.typeKey(.escape, modifierFlags: [])
            RunLoop.current.run(until: Date().addingTimeInterval(0.5))
        }
        terminateProcess(matching: "SafariServices.framework.*com.apple.SafariServices")
    }

    private func terminateProcess(matching pattern: String) {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/pkill")
        process.arguments = ["-9", "-f", pattern]
        try? process.run()
        process.waitUntilExit()
    }

    private func resetDirectory(at path: String) {
        let url = URL(fileURLWithPath: path, isDirectory: true)
        try? FileManager.default.removeItem(at: url)
        try? FileManager.default.createDirectory(
            at: url,
            withIntermediateDirectories: true,
            attributes: nil
        )
    }

    private func removeDirectory(at path: String) {
        try? FileManager.default.removeItem(at: URL(fileURLWithPath: path, isDirectory: true))
    }

    private func hideKnownInterferingApplications() {
        for application in NSWorkspace.shared.runningApplications where shouldHideForUITest(application) {
            application.hide()
        }
        closeFinderWindows()
        RunLoop.current.run(until: Date().addingTimeInterval(0.5))
    }

    private func unhideKnownInterferingApplications() {
        for application in NSWorkspace.shared.runningApplications where shouldHideForUITest(application) {
            application.unhide()
        }
    }

    private func shouldHideForUITest(_ application: NSRunningApplication) -> Bool {
        guard application.activationPolicy == .regular else { return false }
        guard application.processIdentifier != NSRunningApplication.current.processIdentifier else { return false }
        guard application.localizedName != "agentic30" else { return false }
        guard application.bundleIdentifier != "october-academy.agentic30" else { return false }
        guard application.bundleIdentifier != "october-academy.agentic30UITests-Runner" else { return false }
        return true
    }

    private func closeFinderWindows() {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
        process.arguments = ["-e", "tell application \"Finder\" to close every window"]
        try? process.run()
        process.waitUntilExit()
    }

    private func writeDay1ICPWorkspaceFixture(workspacePath: String, appSupportPath: String) throws {
        let workspaceURL = URL(fileURLWithPath: workspacePath, isDirectory: true)
        let docsURL = workspaceURL.appendingPathComponent("docs", isDirectory: true)
        try FileManager.default.createDirectory(at: docsURL, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(
            at: URL(fileURLWithPath: appSupportPath, isDirectory: true),
            withIntermediateDirectories: true
        )

        try """
        # Ideal Customer Profile (ICP)

        ## Our ICP: 전업 1인 개발자 (수익 0원, macOS)

        에이전트 코딩 도구로 프로덕트를 만들 수 있고, 이미 전업했지만 아직 수익 0원인 macOS 사용자.
        고객 인터뷰를 직접 수행할 의향이 있으며 transcript를 파일로 확보할 수 있다.

        ## Persona

        퇴사 후 전업자, macOS 사용자, Codex/Claude Code로 제품 구현 가능, 첫 매출 전.
        """.write(to: docsURL.appendingPathComponent("ICP.md"), atomically: true, encoding: .utf8)

        try """
        # SPEC

        ## v0 proof baseline

        Day 1은 builder-state 진단 후 현재 proof 상태와 다음 proof target을 기록한다.
        기존 landing_live/product_live 사용자는 blank-slate discovery 대신 asset audit 또는 bottleneck diagnosis fast path로 진행한다.
        """.write(to: docsURL.appendingPathComponent("SPEC.md"), atomically: true, encoding: .utf8)

        let config: [String: Any] = [
            "workspace": [
                "root": workspacePath,
                "icp": "docs/ICP.md",
                "spec": "docs/SPEC.md",
                "designSystem": "",
                "adr": "",
                "goal": "",
            ],
            "externalDocs": [
                "googleDocs": [],
                "googleSheets": [],
                "notion": [],
            ],
            "social": [
                "threads": "",
                "x": "",
            ],
        ]
        let data = try JSONSerialization.data(withJSONObject: config, options: [.prettyPrinted, .sortedKeys])
        try data.write(to: URL(fileURLWithPath: appSupportPath, isDirectory: true).appendingPathComponent("bip-config.json"))
    }

    private func waitForCompletedAssistantResponse(
        appSupportPath: String,
        afterUserMessageContaining marker: String,
        timeout: TimeInterval
    ) -> String? {
        let sessionsURL = URL(fileURLWithPath: appSupportPath, isDirectory: true)
            .appendingPathComponent("sessions.json")
        let deadline = Date().addingTimeInterval(timeout)

        repeat {
            if let data = try? Data(contentsOf: sessionsURL),
               let raw = String(data: data, encoding: .utf8) {
                if sessionStore(data: data, hasCompletedAssistantAfterUserMessageContaining: marker) {
                    return raw
                }
            }

            RunLoop.current.run(until: Date().addingTimeInterval(0.5))
        } while Date() < deadline

        return nil
    }

    private func waitForCodexWarmupReady(
        appSupportPath: String,
        timeout: TimeInterval
    ) -> String? {
        let sessionsURL = URL(fileURLWithPath: appSupportPath, isDirectory: true)
            .appendingPathComponent("sessions.json")
        let deadline = Date().addingTimeInterval(timeout)

        repeat {
            if let data = try? Data(contentsOf: sessionsURL),
               let raw = String(data: data, encoding: .utf8),
               sessionStoreHasCodexWarmupReady(raw) {
                return raw
            }

            RunLoop.current.run(until: Date().addingTimeInterval(0.5))
        } while Date() < deadline

        return nil
    }

    private func waitForPreferredModelSettings(
        appSupportPath: String,
        claude: String,
        codex: String,
        timeout: TimeInterval
    ) -> Bool {
        let deadline = Date().addingTimeInterval(timeout)

        repeat {
            if let models = preferredModelSettings(appSupportPath: appSupportPath),
               models.claude == claude,
               models.codex == codex {
                return true
            }

            RunLoop.current.run(until: Date().addingTimeInterval(0.2))
        } while Date() < deadline

        guard let models = preferredModelSettings(appSupportPath: appSupportPath) else {
            return false
        }
        return models.claude == claude && models.codex == codex
    }

    private func preferredModelSettings(appSupportPath: String) -> (claude: String, codex: String)? {
        let secretsURL = URL(fileURLWithPath: appSupportPath, isDirectory: true)
            .appendingPathComponent("dev-secrets.json")
        guard let data = try? Data(contentsOf: secretsURL),
              let rawObject = try? JSONSerialization.jsonObject(with: data),
              let object = rawObject as? [String: Any],
              let settings = object["settings"] as? [String: Any],
              let claude = settings["preferredClaudeModel"] as? String,
              let codex = settings["preferredCodexModel"] as? String
        else {
            return nil
        }

        return (claude, codex)
    }

    private func sessionStoreHasCodexWarmupReady(_ raw: String) -> Bool {
        extractCodexWarmSummary(fromSessionStore: raw)["state"] as? String == "ready"
    }

    private func sessionStore(
        data: Data,
        hasCompletedAssistantAfterUserMessageContaining marker: String
    ) -> Bool {
        guard
            let payload = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
            let sessions = payload["sessions"] as? [[String: Any]]
        else { return false }

        for session in sessions {
            guard let messages = session["messages"] as? [[String: Any]] else { continue }

            for (index, message) in messages.enumerated() {
                guard
                    message["role"] as? String == "user",
                    let content = message["content"] as? String,
                    content.contains(marker)
                else { continue }

                let followingMessages = messages.dropFirst(index + 1)
                if followingMessages.contains(where: isCompletedAssistantMessage) {
                    return true
                }
            }
        }

        return false
    }

    private func isCompletedAssistantMessage(_ message: [String: Any]) -> Bool {
        guard message["role"] as? String == "assistant" else { return false }
        guard message["state"] as? String == "final" else { return false }
        guard (message["error"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ?? true else {
            return false
        }
        guard let content = message["content"] as? String else { return false }
        return !content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private func assertSessionStoreHasTerminalAssistantTurns(
        _ raw: String,
        afterUserPrompts prompts: [String],
        file: StaticString = #filePath,
        line: UInt = #line
    ) {
        guard
            let data = raw.data(using: .utf8),
            let payload = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
            let sessions = payload["sessions"] as? [[String: Any]]
        else {
            XCTFail("sessions.json should decode as a sessions payload.", file: file, line: line)
            return
        }

        for prompt in prompts {
            let marker = prompt.components(separatedBy: ":").first ?? prompt
            let hasTerminalTurn = sessions.contains { session in
                guard let messages = session["messages"] as? [[String: Any]] else { return false }
                for (index, message) in messages.enumerated() {
                    guard
                        message["role"] as? String == "user",
                        let content = message["content"] as? String,
                        content.contains(marker)
                    else { continue }

                    return messages.dropFirst(index + 1).contains(where: isTerminalAssistantMessage)
                }
                return false
            }
            XCTAssertTrue(hasTerminalTurn, "Expected user prompt \(marker) to be followed by an assistant final/error/orphan turn.", file: file, line: line)
        }
    }

    private func isTerminalAssistantMessage(_ message: [String: Any]) -> Bool {
        guard message["role"] as? String == "assistant" else { return false }
        let state = message["state"] as? String
        if state == "final" { return true }
        if state == "error" { return true }
        if message["recoverable"] as? Bool == true { return true }
        return false
    }

    private func extractLatestAssistantTimingSummary(
        fromSessionStore raw: String,
        afterUserMessageContaining marker: String
    ) -> [String: Any] {
        guard
            let data = raw.data(using: .utf8),
            let payload = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
            let sessions = payload["sessions"] as? [[String: Any]]
        else { return [:] }

        for session in sessions {
            guard let messages = session["messages"] as? [[String: Any]] else { continue }
            for (index, message) in messages.enumerated() {
                guard
                    message["role"] as? String == "user",
                    let content = message["content"] as? String,
                    content.contains(marker)
                else { continue }

                let assistant = messages.dropFirst(index + 1).first(where: isCompletedAssistantMessage)
                guard let performance = assistant?["performance"] as? [String: Any] else {
                    return [:]
                }
                let marks = (performance["marks"] as? [[String: Any]] ?? [])
                    .compactMap { mark -> [String: Any]? in
                        guard let phase = mark["phase"] as? String else { return nil }
                        let details = mark["details"] as? [String: Any] ?? [:]
                        var summary: [String: Any] = [
                            "phase": phase,
                            "elapsed_ms": mark["elapsedMs"] as? Int ?? mark["elapsed_ms"] as? Int ?? 0,
                        ]
                        if !details.isEmpty {
                            summary["details"] = details
                        }
                        return summary
                    }
                let segments = timingSegments(from: marks)
                return [
                    "total_ms": performance["totalMs"] as? Int ?? 0,
                    "marks": marks,
                    "segments": segments,
                ]
            }
        }

        return [:]
    }

    private func timingSegments(from marks: [[String: Any]]) -> [[String: Any]] {
        var segments: [[String: Any]] = []
        var previousPhase: String?
        var previousElapsed: Int?

        for mark in marks {
            guard
                let phase = mark["phase"] as? String,
                let elapsed = mark["elapsed_ms"] as? Int
            else { continue }

            if let previousPhase, let previousElapsed {
                segments.append([
                    "from": previousPhase,
                    "to": phase,
                    "delta_ms": max(0, elapsed - previousElapsed),
                ])
            }
            previousPhase = phase
            previousElapsed = elapsed
        }

        return segments
    }

    private func extractCodexWarmSummary(fromSessionStore raw: String) -> [String: Any] {
        guard
            let data = raw.data(using: .utf8),
            let payload = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
            let sessions = payload["sessions"] as? [[String: Any]]
        else { return [:] }

        for session in sessions {
            guard
                session["provider"] as? String == "codex",
                let runtime = session["runtime"] as? [String: Any],
                let warm = runtime["codexWarm"] as? [String: Any]
            else { continue }

            return [
                "state": warm["state"] as? String ?? "",
                "elapsed_ms": warm["elapsedMs"] as? Int ?? 0,
                "model": warm["model"] as? String ?? "",
                "execution_mode": warm["executionMode"] as? String ?? "",
                "error": warm["error"] as? String ?? "",
            ]
        }

        return [:]
    }

    private func extractSessionStartupTiming(fromSessionStore raw: String) -> [String: Any] {
        guard
            let data = raw.data(using: .utf8),
            let payload = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
            let sessions = payload["sessions"] as? [[String: Any]]
        else { return [:] }

        for session in sessions {
            guard
                session["provider"] as? String == "codex",
                let runtime = session["runtime"] as? [String: Any],
                let timing = runtime["startupTiming"] as? [String: Any]
            else { continue }

            return [
                "process_to_session_created_ms": timing["processToSessionCreatedMs"] as? Int ?? 0,
                "create_session_elapsed_ms": timing["createSessionElapsedMs"] as? Int ?? 0,
                "bootstrap_intake_elapsed_ms": timing["bootstrapIntakeElapsedMs"] as? Int ?? 0,
                "persist_elapsed_ms": timing["persistElapsedMs"] as? Int ?? 0,
                "bip_coach_sync_elapsed_ms": timing["bipCoachSyncElapsedMs"] as? Int ?? 0,
                "client_count_at_create": timing["clientCountAtCreate"] as? Int ?? 0,
            ]
        }

        return [:]
    }

    private func extractLatestCompletedAssistantContent(
        fromSessionStore raw: String,
        afterUserMessageContaining marker: String
    ) -> String {
        guard
            let data = raw.data(using: .utf8),
            let payload = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
            let sessions = payload["sessions"] as? [[String: Any]]
        else { return "" }

        for session in sessions {
            guard let messages = session["messages"] as? [[String: Any]] else { continue }
            for (index, message) in messages.enumerated() {
                guard
                    message["role"] as? String == "user",
                    let content = message["content"] as? String,
                    content.contains(marker)
                else { continue }

                let assistant = messages.dropFirst(index + 1).first(where: isCompletedAssistantMessage)
                return assistant?["content"] as? String ?? ""
            }
        }

        return ""
    }

    @MainActor
    private func answerBootstrapPromptIfNeeded(in app: XCUIApplication, allowComposerFallback: Bool = true) {
        let promptComposer = textField(in: app, matching: [
            "assistant.promptComposer",
            "오늘 무엇을 도와드릴까요? /office-hours-docs",
        ])

        let structuredPrompt = app.descendants(matching: .any)["assistant.structuredPrompt"]
        let structuredPromptTitle = app.staticTexts["assistant.structuredPromptTitle"]
        let structuredChoices = app.descendants(matching: .any).matching(
            NSPredicate(format: "identifier BEGINSWITH %@", "assistant.structuredChoice.")
        )
        guard waitForBootstrapPromptOrComposer(
            promptComposer: promptComposer,
            structuredPrompt: structuredPrompt,
            structuredPromptTitle: structuredPromptTitle,
            structuredChoices: structuredChoices,
            timeout: 120
        ) == .structuredPrompt else {
            guard allowComposerFallback else { return }
            let sendButton = button(in: app, matching: [
                "assistant.sendPromptButton",
                "Send prompt",
            ])
            answerWorkspaceBootstrapPromptIfNeeded(
                in: app,
                promptComposer: promptComposer,
                sendButton: sendButton
            )
            return
        }

        let clickedBootstrapChoice = clickFirstBootstrapChoice(
            in: app,
            structuredChoices: structuredChoices,
            timeout: 10
        )
        if !clickedBootstrapChoice {
            attachScreenshot(from: app, named: "00 Bootstrap Prompt Visible")
            attachText(app.debugDescription, named: "00 Bootstrap Accessibility Tree")
        }
        XCTAssertTrue(clickedBootstrapChoice)

        let continueButton = button(in: app, matching: [
            "assistant.structuredContinueButton",
            "Continue",
        ])
        XCTAssertTrue(continueButton.waitForExistence(timeout: 5))
        if !waitUntilEnabled(continueButton, timeout: 5) {
            attachScreenshot(from: app, named: "00 Bootstrap Continue Disabled")
            attachText(app.debugDescription, named: "00 Bootstrap Continue Disabled Tree")
        }
        XCTAssertTrue(waitUntilEnabled(continueButton, timeout: 5))
        attachScreenshot(from: app, named: "00 Bootstrap Prompt Answered")
        continueButton.click()
    }

    @MainActor
    private func clickFirstBootstrapChoice(
        in app: XCUIApplication,
        structuredChoices: XCUIElementQuery,
        timeout: TimeInterval
    ) -> Bool {
        let deadline = Date().addingTimeInterval(timeout)

        repeat {
            for label in [
                "프로젝트 전략 문서 만들기",
                "아이디어 압박 검증하기",
                "공개 글 초안 작성하기",
                "워크스페이스 살펴보기",
                "Define project strategy docs",
                "Pressure-test an idea",
                "Draft public post",
                "Inspect the workspace",
            ] {
                let element = app.descendants(matching: .any)
                    .matching(NSPredicate(format: "label == %@", label))
                    .element(boundBy: 0)
                if element.exists {
                    clickCenter(of: element)
                    return true
                }
            }

            if structuredChoices.count > 0 {
                clickCenter(of: structuredChoices.element(boundBy: 0))
                return true
            }

            RunLoop.current.run(until: Date().addingTimeInterval(0.25))
        } while Date() < deadline

        return false
    }

    @MainActor
    private func waitForLatestPrompt(
        in app: XCUIApplication,
        containing marker: String,
        timeout: TimeInterval
    ) -> Bool {
        let deadline = Date().addingTimeInterval(timeout)

        repeat {
            if anyStaticText(in: app, identifiers: ["assistant.latestPrompt", "workspace.chat.user", "workspace.chat.pendingUser", "workspace.supportThread", "workspace.chatThread"], contains: marker) {
                return true
            }
            RunLoop.current.run(until: Date().addingTimeInterval(0.25))
        } while Date() < deadline

        return anyStaticText(in: app, identifiers: ["assistant.latestPrompt", "workspace.chat.user", "workspace.chat.pendingUser", "workspace.supportThread", "workspace.chatThread"], contains: marker)
    }

    @MainActor
    private func waitForSessionBackedComposer(_ promptComposer: XCUIElement, timeout: TimeInterval) -> Bool {
        let deadline = Date().addingTimeInterval(timeout)

        repeat {
            if promptComposer.exists && promptComposer.label.contains("메시지 보내기") {
                return true
            }
            RunLoop.current.run(until: Date().addingTimeInterval(0.25))
        } while Date() < deadline

        return promptComposer.exists && promptComposer.label.contains("메시지 보내기")
    }

    @MainActor
    private func waitForLatestAnswer(
        in app: XCUIApplication,
        containing marker: String,
        timeout: TimeInterval
    ) -> Bool {
        let deadline = Date().addingTimeInterval(timeout)

        repeat {
            if anyStaticText(in: app, identifiers: ["assistant.latestAnswer", "workspace.chat.assistant", "workspace.supportThread", "workspace.chatThread"], contains: marker) {
                return true
            }
            RunLoop.current.run(until: Date().addingTimeInterval(0.25))
        } while Date() < deadline

        return anyStaticText(in: app, identifiers: ["assistant.latestAnswer", "workspace.chat.assistant", "workspace.supportThread", "workspace.chatThread"], contains: marker)
    }

    @MainActor
    private func waitForAnswerChange(
        in app: XCUIApplication,
        previousAnswer: String,
        timeout: TimeInterval
    ) -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        let response = app.staticTexts["assistant.latestAnswer"]

        repeat {
            if response.exists {
                let next = response.label.trimmingCharacters(in: .whitespacesAndNewlines)
                if !next.isEmpty && next != previousAnswer && next != "대기 중" {
                    return true
                }
            }
            if app.staticTexts.matching(identifier: "workspace.chat.assistant").count > 0 {
                return true
            }
            RunLoop.current.run(until: Date().addingTimeInterval(0.25))
        } while Date() < deadline

        return false
    }

    @MainActor
    private func answerWorkspaceBootstrapPromptIfNeeded(
        in app: XCUIApplication,
        promptComposer: XCUIElement,
        sendButton: XCUIElement
    ) {
        enterPrompt("Use docs ICP for Day 1.", in: app, promptComposer: promptComposer)
        _ = waitUntilEnabled(sendButton, timeout: 5)
        clickCenter(of: sendButton)

        let deadline = Date().addingTimeInterval(12)
        repeat {
            if !element(promptComposer, contains: "Use docs ICP for Day 1.") {
                break
            }
            if sendButton.exists && sendButton.isEnabled {
                sendButton.click()
            }
            RunLoop.current.run(until: Date().addingTimeInterval(0.5))
        } while Date() < deadline

        let readyDeadline = Date().addingTimeInterval(30)
        repeat {
            if !app.debugDescription.contains("AWAITING_INPUT") {
                return
            }
            RunLoop.current.run(until: Date().addingTimeInterval(0.5))
        } while Date() < readyDeadline
    }

    @MainActor
    private func enterPrompt(_ prompt: String, in app: XCUIApplication, promptComposer: XCUIElement) {
        app.activate()
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(prompt, forType: .string)
        promptComposer.click()
        app.typeKey("a", modifierFlags: [.command])
        app.typeKey("v", modifierFlags: [.command])
        RunLoop.current.run(until: Date().addingTimeInterval(0.2))
        if !element(promptComposer, contains: prompt) {
            promptComposer.click()
            app.typeKey("a", modifierFlags: [.command])
            app.typeText(prompt)
            RunLoop.current.run(until: Date().addingTimeInterval(0.2))
        }
    }

    @MainActor
    private func submitPromptAndWaitForLatestPrompt(
        in app: XCUIApplication,
        promptComposer: XCUIElement,
        sendButton: XCUIElement,
        marker: String,
        timeout: TimeInterval
    ) -> Bool {
        let deadline = Date().addingTimeInterval(timeout)

        repeat {
            if !element(promptComposer, contains: marker) {
                enterPrompt(marker, in: app, promptComposer: promptComposer)
            }
            if waitUntilEnabled(sendButton, timeout: 2) {
                clickCenter(of: sendButton)
            }
            if waitForLatestPrompt(in: app, containing: marker, timeout: 2) {
                return true
            }
            RunLoop.current.run(until: Date().addingTimeInterval(0.25))
        } while Date() < deadline

        return waitForLatestPrompt(in: app, containing: marker, timeout: 1)
    }

    @MainActor
    private func anyStaticText(
        in app: XCUIApplication,
        identifiers: [String],
        contains marker: String
    ) -> Bool {
        for identifier in identifiers {
            let matches = app.descendants(matching: .any).matching(identifier: identifier)
            for index in 0..<matches.count {
                let element = matches.element(boundBy: index)
                if element.exists && self.element(element, contains: marker) {
                    return true
                }
            }
        }
        return false
    }

    @MainActor
    private func element(_ element: XCUIElement, contains marker: String) -> Bool {
        element.label.contains(marker) || ((element.value as? String)?.contains(marker) ?? false)
    }

    @MainActor
    private func clickCenter(of element: XCUIElement) {
        element.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).click()
    }

    @MainActor
    private func replaceText(in app: XCUIApplication, with text: String) {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
        app.typeKey("a", modifierFlags: [.command])
        app.typeKey(.delete, modifierFlags: [])
        app.typeKey("v", modifierFlags: [.command])
    }

    @MainActor
    private func waitUntilEnabled(_ element: XCUIElement, timeout: TimeInterval) -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        repeat {
            if element.exists && element.isEnabled {
                return true
            }
            RunLoop.current.run(until: Date().addingTimeInterval(0.25))
        } while Date() < deadline
        return element.exists && element.isEnabled
    }

    private enum BootstrapReadiness {
        case composer
        case structuredPrompt
    }

    @MainActor
    private func waitForBootstrapPromptOrComposer(
        promptComposer: XCUIElement,
        structuredPrompt: XCUIElement,
        structuredPromptTitle: XCUIElement,
        structuredChoices: XCUIElementQuery,
        timeout: TimeInterval
    ) -> BootstrapReadiness? {
        let deadline = Date().addingTimeInterval(timeout)

        repeat {
            if promptComposer.exists {
                return .composer
            }
            if structuredPromptTitle.exists || structuredChoices.count > 0 {
                return .structuredPrompt
            }
            RunLoop.current.run(until: Date().addingTimeInterval(0.5))
        } while Date() < deadline

        return nil
    }

    private func waitForTelemetryEvent(
        named eventName: String,
        at path: String,
        timeout: TimeInterval
    ) -> [String: Any]? {
        let deadline = Date().addingTimeInterval(timeout)
        repeat {
            if let event = telemetryEvents(at: path).first(where: { $0["event"] as? String == eventName }) {
                return event
            }
            RunLoop.current.run(until: Date().addingTimeInterval(0.25))
        } while Date() < deadline
        return telemetryEvents(at: path).first(where: { $0["event"] as? String == eventName })
    }

    private func telemetryEvents(at path: String) -> [[String: Any]] {
        guard let raw = try? String(contentsOfFile: path, encoding: .utf8) else {
            return []
        }
        return raw
            .split(separator: "\n")
            .compactMap { line in
                guard let data = String(line).data(using: .utf8) else { return nil }
                return try? JSONSerialization.jsonObject(with: data) as? [String: Any]
            }
    }

    @MainActor
    private func attachScreenshot(from app: XCUIApplication, named name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    private func attachText(_ text: String, named name: String) {
        let attachment = XCTAttachment(string: text)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    @MainActor
    private func button(in app: XCUIApplication, matching names: [String]) -> XCUIElement {
        for name in names {
            let element = app.buttons[name]
            if element.exists {
                return element
            }
        }
        return app.buttons[names[0]]
    }

    @MainActor
    private func textField(in app: XCUIApplication, matching names: [String]) -> XCUIElement {
        for name in names {
            let element = app.textFields[name]
            if element.exists {
                return element
            }
            let anyElement = app.descendants(matching: .any)
                .matching(NSPredicate(format: "identifier == %@ OR label == %@", name, name))
                .element(boundBy: 0)
            if anyElement.exists {
                return anyElement
            }
        }
        return app.textFields[names[0]]
    }

    private func currentTOTPCode(secret: String, date: Date = Date()) throws -> String {
        let keyData = try base32Decode(secret)
        let counter = UInt64(floor(date.timeIntervalSince1970 / 30.0))
        var bigEndianCounter = counter.bigEndian
        let counterData = Data(bytes: &bigEndianCounter, count: MemoryLayout<UInt64>.size)
        let key = SymmetricKey(data: keyData)
        let digest = HMAC<Insecure.SHA1>.authenticationCode(for: counterData, using: key)
        let bytes = Array(digest)
        let offset = Int(bytes[bytes.count - 1] & 0x0f)
        let truncated = (UInt32(bytes[offset] & 0x7f) << 24)
            | (UInt32(bytes[offset + 1]) << 16)
            | (UInt32(bytes[offset + 2]) << 8)
            | UInt32(bytes[offset + 3])
        return String(format: "%06d", truncated % 1_000_000)
    }

    private func base32Decode(_ input: String) throws -> Data {
        let alphabet = Array("ABCDEFGHIJKLMNOPQRSTUVWXYZ234567")
        let lookup = Dictionary(uniqueKeysWithValues: alphabet.enumerated().map { ($0.element, UInt8($0.offset)) })
        let normalized = input
            .uppercased()
            .filter { !$0.isWhitespace && $0 != "=" }
        var buffer = 0
        var bitsLeft = 0
        var output = Data()

        for character in normalized {
            guard let value = lookup[character] else {
                throw GoogleE2EError.invalidTOTPSecret
            }
            buffer = (buffer << 5) | Int(value)
            bitsLeft += 5
            if bitsLeft >= 8 {
                output.append(UInt8((buffer >> (bitsLeft - 8)) & 0xff))
                bitsLeft -= 8
            }
        }

        guard !output.isEmpty else {
            throw GoogleE2EError.invalidTOTPSecret
        }
        return output
    }
}

private struct GoogleE2ECredentials {
    let email: String
    let password: String
    let totpSecret: String

    static func fromEnvironment(_ environment: [String: String] = ProcessInfo.processInfo.environment) -> GoogleE2ECredentials? {
        guard
            let email = environment["AGENTIC30_GOOGLE_E2E_EMAIL"]?.trimmedNonEmpty,
            let password = environment["AGENTIC30_GOOGLE_E2E_PASSWORD"]?.trimmedNonEmpty,
            let totpSecret = environment["AGENTIC30_GOOGLE_E2E_TOTP_SECRET"]?.trimmedNonEmpty
        else {
            return nil
        }
        return GoogleE2ECredentials(email: email, password: password, totpSecret: totpSecret)
    }
}

private enum GoogleE2EError: Error {
    case invalidTOTPSecret
}

private extension String {
    var trimmedNonEmpty: String? {
        let value = trimmingCharacters(in: .whitespacesAndNewlines)
        return value.isEmpty ? nil : value
    }
}
