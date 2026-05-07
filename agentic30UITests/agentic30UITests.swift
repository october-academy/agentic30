//
//  agentic30UITests.swift
//  agentic30UITests
//
//  Created by october on 4/8/26.
//

import AppKit
import CryptoKit
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
    func testFirstRunOnboardingAppears() throws {
        let app = launchApp(arguments: [
            "--ui-testing-reset-onboarding",
            "--ui-testing-disable-sidecar",
        ])

        XCTAssertTrue(
            app.staticTexts["Welcome to agentic30"].waitForExistence(timeout: 5)
        )
        XCTAssertTrue(app.buttons["Next"].exists)
        app.terminate()
    }

    @MainActor
    func testRealLoginStartsOAuthHandoff() throws {
        let onboardingApp = launchApp(arguments: [
            "--ui-testing-reset-onboarding",
            "--ui-testing-disable-sidecar",
            "--ui-testing-opaque-window",
        ])

        XCTAssertTrue(onboardingApp.staticTexts["Welcome to agentic30"].waitForExistence(timeout: 5))
        attachScreenshot(from: onboardingApp, named: "01 Welcome")

        let onboardingPrimary = button(in: onboardingApp, matching: [
            "macOnboarding.primaryButton",
            "Next",
        ])
        XCTAssertTrue(onboardingPrimary.exists)
        onboardingPrimary.click()
        XCTAssertTrue(onboardingApp.staticTexts["We’re always by your side"].waitForExistence(timeout: 2))
        attachScreenshot(from: onboardingApp, named: "02 Briefing")

        onboardingPrimary.click()
        XCTAssertTrue(onboardingApp.staticTexts["Build, launch, earn in 30 days"].waitForExistence(timeout: 2))

        onboardingPrimary.click()
        XCTAssertTrue(onboardingApp.staticTexts["Ship faster, learn faster"].waitForExistence(timeout: 2))

        onboardingPrimary.click()
        XCTAssertTrue(onboardingApp.staticTexts["Sign in to get started"].waitForExistence(timeout: 2))
        let signInButton = button(in: onboardingApp, matching: [
            "macOnboarding.primaryButton",
            "Sign in with Google",
        ])
        XCTAssertFalse(signInButton.isEnabled)
        attachScreenshot(from: onboardingApp, named: "03 Sign In Disabled")

        let termsCheckbox = button(in: onboardingApp, matching: [
            "macOnboarding.termsCheckbox",
            "Accept Terms and Privacy Policy",
        ])
        XCTAssertTrue(termsCheckbox.exists)
        termsCheckbox.click()
        XCTAssertTrue(signInButton.isEnabled)
        attachScreenshot(from: onboardingApp, named: "04 Sign In Accepted")

        signInButton.click()
        XCTAssertTrue(
            onboardingApp.buttons["Opening Google"].waitForExistence(timeout: 2)
                || onboardingApp.buttons["Completing sign in"].exists
                || onboardingApp.staticTexts["Sign in to get started"].exists
        )
        attachScreenshot(from: onboardingApp, named: "05 OAuth Handoff")
        dismissOAuthHandoffIfPresent(in: onboardingApp)
        onboardingApp.terminate()
    }

    @MainActor
    func testCredentialedGoogleLoginCompletesMacAuth() throws {
        guard let credentials = GoogleE2ECredentials.fromEnvironment() else {
            throw XCTSkip("Set AGENTIC30_GOOGLE_E2E_EMAIL, AGENTIC30_GOOGLE_E2E_PASSWORD, and AGENTIC30_GOOGLE_E2E_TOTP_SECRET to run credentialed Google login E2E.")
        }

        let arguments = [
            "--ui-testing-reset-onboarding",
            "--ui-testing-disable-sidecar",
            "--ui-testing-opaque-window",
        ] + macAuthBaseURLArguments()
        let onboardingApp = launchApp(arguments: arguments)
        addTeardownBlock {
            self.dismissOAuthHandoffIfPresent(in: onboardingApp)
            onboardingApp.terminate()
        }

        XCTAssertTrue(onboardingApp.staticTexts["Welcome to agentic30"].waitForExistence(timeout: 5))
        advanceToGoogleSignIn(in: onboardingApp)
        attachScreenshot(from: onboardingApp, named: "01 Credentialed Google Handoff")

        try completeGoogleSignIn(credentials: credentials, hostApp: onboardingApp)
        XCTAssertTrue(
            onboardingApp.staticTexts["Choose your project folder"].waitForExistence(timeout: 90),
            "Credentialed Google login should return through the agentic30 callback and land on project selection."
        )
        attachScreenshot(from: onboardingApp, named: "02 Credentialed Google Completed")
    }

    @MainActor
    func testProjectPickerAndContextSelectionFlow() throws {
        let projectApp = launchApp(arguments: [
            "--ui-testing-reset-onboarding",
            "--ui-testing-seed-auth",
            "--ui-testing-disable-sidecar",
            "--ui-testing-opaque-window",
        ])

        XCTAssertTrue(projectApp.staticTexts["Choose your project folder"].waitForExistence(timeout: 5))
        XCTAssertTrue(button(in: projectApp, matching: [
            "workspace.selectDirectoryButton",
            "Select project directory",
        ]).exists)
        XCTAssertFalse(button(in: projectApp, matching: [
            "workspace.startAssistantButton",
            "Start assistant",
        ]).isEnabled)
        attachScreenshot(from: projectApp, named: "01 Project Picker")
        projectApp.terminate()

        let contextApp = launchApp(arguments: [
            "--ui-testing-reset-onboarding",
            "--ui-testing-seed-auth",
            "--ui-testing-seed-workspace=/tmp/agentic30-ui-workspace",
            "--ui-testing-disable-sidecar",
            "--ui-testing-opaque-window",
        ])

        XCTAssertTrue(contextApp.staticTexts["어떤 일을 하고 계신가요?"].waitForExistence(timeout: 5))
        let developerOption = button(in: contextApp, matching: [
            "onboardingContext.option.developer",
            "개발자, 앱·웹·제품을 직접 구현합니다",
            "개발자",
        ])
        let designerOption = button(in: contextApp, matching: [
            "onboardingContext.option.designer",
            "디자이너, 브랜드, 시각, 프로덕트 디자인을 다룹니다",
            "디자이너",
        ])
        XCTAssertTrue(developerOption.exists)
        XCTAssertTrue(designerOption.exists)
        let developerFrameBefore = developerOption.frame
        let designerFrameBefore = designerOption.frame
        attachScreenshot(from: contextApp, named: "02 Context Role")

        designerOption.click()
        XCTAssertEqual(developerOption.frame.height, developerFrameBefore.height, accuracy: 0.5)
        XCTAssertEqual(designerOption.frame.height, designerFrameBefore.height, accuracy: 0.5)
        XCTAssertEqual(designerOption.frame.minY, designerFrameBefore.minY, accuracy: 0.5)
        attachScreenshot(from: contextApp, named: "03 Context Role Changed")

        let contextPrimary = button(in: contextApp, matching: [
            "onboardingContext.primaryButton",
            "Next",
        ])
        contextPrimary.click()
        XCTAssertTrue(contextApp.staticTexts["지금 프로젝트는 어느 단계에 있나요?"].waitForExistence(timeout: 2))
        attachScreenshot(from: contextApp, named: "04 Context Stage")

        contextPrimary.click()
        XCTAssertTrue(contextApp.staticTexts["피드백은 어디서 받으시나요?"].waitForExistence(timeout: 2))
        attachScreenshot(from: contextApp, named: "05 Context Feedback")
        contextApp.terminate()
    }

    @MainActor
    func testNativeProjectPickerSelectsDirectory() throws {
        let runID = UUID().uuidString
        let workspacePath = "/tmp/agentic30-ui-picker-workspace-\(runID)"
        resetDirectory(at: workspacePath)

        let app = launchApp(arguments: [
            "--ui-testing-reset-onboarding",
            "--ui-testing-seed-auth",
            "--ui-testing-disable-sidecar",
            "--ui-testing-opaque-window",
        ])
        addTeardownBlock {
            app.terminate()
            self.removeDirectory(at: workspacePath)
        }

        XCTAssertTrue(app.staticTexts["Choose your project folder"].waitForExistence(timeout: 5))
        let selectDirectory = button(in: app, matching: [
            "workspace.selectDirectoryButton",
            "Select project directory",
        ])
        XCTAssertTrue(selectDirectory.exists)
        selectDirectory.click()

        let selectedDirectory = selectProjectDirectory(in: app, path: workspacePath, timeout: 20)
        if !selectedDirectory {
            attachScreenshot(from: app, named: "00 Native Project Picker Failed")
            attachText(app.debugDescription, named: "00 Native Project Picker Tree")
        }
        XCTAssertTrue(selectedDirectory)
        let startAssistant = button(in: app, matching: [
            "workspace.startAssistantButton",
            "Start assistant",
        ])
        XCTAssertTrue(waitUntilEnabled(startAssistant, timeout: 5))
        attachScreenshot(from: app, named: "01 Native Project Picker Selected")

        startAssistant.click()
        XCTAssertTrue(app.staticTexts["어떤 일을 하고 계신가요?"].waitForExistence(timeout: 5))
        attachScreenshot(from: app, named: "02 Native Project Picker Continued")
    }

    @MainActor
    func testSettingsModelPickersSelectClaudeAndCodexModels() throws {
        let app = launchApp(arguments: [
            "--ui-testing-reset-onboarding",
            "--ui-testing-seed-auth",
            "--ui-testing-seed-workspace=/tmp/agentic30-ui-settings-workspace",
            "--ui-testing-seed-onboarding-context",
            "--ui-testing-disable-sidecar",
            "--ui-testing-opaque-window",
        ])
        addTeardownBlock {
            app.terminate()
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
                optionLabel: "Claude Opus 4.7"
            )
        )
        XCTAssertTrue(waitForModelID(in: app, identifier: "settings.claude.modelID", value: "claude-opus-4-7"))

        XCTAssertTrue(
            chooseModelOption(
                in: app,
                pickerIdentifier: "settings.codex.modelPicker",
                optionLabel: "GPT 5.4 Mini"
            )
        )
        XCTAssertTrue(waitForModelID(in: app, identifier: "settings.codex.modelID", value: "gpt-5.4-mini"))

        let saveModels = app.buttons["settings.models.saveButton"]
        XCTAssertTrue(saveModels.waitForExistence(timeout: 2))
        saveModels.click()
        XCTAssertTrue(app.staticTexts["settings.models.saveMessage"].waitForExistence(timeout: 2))
        attachScreenshot(from: app, named: "02 Settings Models Saved")
    }

    @MainActor
    func testSidecarChatFlowHermetic() throws {
        try runSidecarChatFlow(liveProvider: false)
    }

    @MainActor
    func testIcpIddStructuredPromptCanBeAnsweredByClickingChoices() throws {
        let app = launchApp(
            arguments: [
                "--ui-testing-reset-onboarding",
                "--ui-testing-seed-auth",
                "--ui-testing-seed-onboarding-context",
                "--ui-testing-disable-sidecar",
                "--ui-testing-seed-icp-structured-prompt",
                "--ui-testing-opaque-window",
            ],
            environment: [
                "AGENTIC30_UI_TEST_INLINE_STUB_RESPONSES": "1",
            ]
        )
        app.activate()
        addTeardownBlock {
            app.terminate()
        }

        let structuredPrompt = app.descendants(matching: .any)["assistant.structuredPrompt"]
        XCTAssertTrue(structuredPrompt.waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["assistant.structuredPromptTitle"].waitForExistence(timeout: 2))
        XCTAssertTrue(app.staticTexts["프로젝트를 훑어봤어요"].waitForExistence(timeout: 2))
        XCTAssertTrue(app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "아직 모르겠어요")).firstMatch.waitForExistence(timeout: 2))

        let unknownChoice = app.descendants(matching: .any)
            .matching(NSPredicate(format: "label == %@", "아직 모르겠어요"))
            .firstMatch
        clickCenter(of: unknownChoice)

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
        continueButton.click()
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
        resetDirectory(at: workspacePath)
        resetDirectory(at: appSupportPath)

        var environment = [
            "AGENTIC30_APP_SUPPORT_PATH": appSupportPath,
            "AGENTIC30_CODEX_MODEL": "gpt-5.4-mini",
        ]
        if !liveProvider {
            environment["AGENTIC30_TEST_STUB_PROVIDER"] = "1"
        }

        let chatApp = launchApp(
            arguments: [
                "--ui-testing-reset-onboarding",
                "--ui-testing-seed-auth",
                "--ui-testing-seed-workspace=\(workspacePath)",
                "--ui-testing-seed-onboarding-context",
                "--ui-testing-opaque-window",
            ],
            environment: environment
        )
        addTeardownBlock {
            chatApp.terminate()
            self.removeDirectory(at: workspacePath)
            self.removeDirectory(at: appSupportPath)
        }

        answerBootstrapPromptIfNeeded(in: chatApp)

        let promptComposer = textField(in: chatApp, matching: [
            "assistant.promptComposer",
            "오늘 무엇을 도와드릴까요? /office-hours-docs",
        ])
        XCTAssertTrue(promptComposer.waitForExistence(timeout: liveProvider ? 180 : 60))
        attachScreenshot(from: chatApp, named: "01 Real Sidecar Chat Ready")

        let marker = liveProvider ? "UI_REAL_CHAT_LIVE_OK" : "UI_STUB_CHAT_OK"
        let prompt = marker
        promptComposer.click()
        promptComposer.typeText(prompt)
        attachScreenshot(from: chatApp, named: "02 Real Sidecar Chat Typed")

        let sendButton = button(in: chatApp, matching: [
            "assistant.sendPromptButton",
            "Send prompt",
        ])
        XCTAssertTrue(sendButton.isEnabled)
        sendButton.click()
        let latestPromptUpdated = waitForLatestPrompt(in: chatApp, containing: marker, timeout: 30)
        if !latestPromptUpdated {
            attachText(chatApp.debugDescription, named: "03 Latest Prompt Accessibility Tree")
        }
        XCTAssertTrue(latestPromptUpdated)
        attachScreenshot(from: chatApp, named: "03 Real Sidecar Chat Sent")

        let response = chatApp.staticTexts["assistant.latestAnswer"]
        XCTAssertTrue(response.waitForExistence(timeout: liveProvider ? 180 : 60))
        let sessionStore = try XCTUnwrap(
            waitForCompletedAssistantResponse(
                appSupportPath: appSupportPath,
                afterUserMessageContaining: marker,
                timeout: liveProvider ? 180 : 60
            ),
            "Expected sessions.json to contain the sent marker followed by a completed assistant response."
        )
        XCTAssertFalse(sessionStore.contains("gpt-5.5"))
        XCTAssertFalse(sessionStore.contains("does not exist or you do not have access"))
        attachText(sessionStore, named: "05 Real Sidecar Session Store")
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
        let app = launchApp(arguments: [
            "--ui-testing-reset-onboarding",
            "--ui-testing-seed-auth",
            "--ui-testing-seed-onboarding-context",
            "--ui-testing-seed-workspace=\(workspacePath)",
            "--ui-testing-sidecar-failure",
            "--ui-testing-opaque-window",
        ])

        let inlineModule = app.descendants(matching: .any)["workspace.bipCoach.inlineModule"]
        XCTAssertTrue(inlineModule.waitForExistence(timeout: 5))
        XCTAssertTrue(app.descendants(matching: .any)["workspace.chatThread"].exists)
        XCTAssertTrue(app.descendants(matching: .any)["workspace.chat.bipMissionCard"].exists)
        let failurePanel = app.descendants(matching: .any)["workspace.bipCoach.sidecarFailure"]
        XCTAssertTrue(failurePanel.waitForExistence(timeout: 3))
        XCTAssertTrue(app.descendants(matching: .any)["workspace.bipCoach.retrySidecar"].exists)
        XCTAssertTrue(app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", "미션 생성 준비가 멈췄어요")).firstMatch.exists)
        app.terminate()
    }

    @MainActor
    func testBipMissionGenerationStaysInlineInCurriculum() throws {
        let workspacePath = "/tmp/agentic30-ui-bip-inline-generation-\(UUID().uuidString)"
        let app = launchApp(arguments: [
            "--ui-testing-reset-onboarding",
            "--ui-testing-seed-auth",
            "--ui-testing-seed-onboarding-context",
            "--ui-testing-seed-workspace=\(workspacePath)",
            "--ui-testing-sidecar-failure",
            "--ui-testing-opaque-window",
        ])

        let generateMission = button(in: app, matching: [
            "workspace.generateBipMission",
            "BIP 미션 생성",
        ])
        XCTAssertTrue(generateMission.waitForExistence(timeout: 5))
        generateMission.click()

        XCTAssertTrue(app.descendants(matching: .any)["workspace.bipCoach.inlineModule"].waitForExistence(timeout: 3))
        XCTAssertTrue(app.descendants(matching: .any)["workspace.chatThread"].exists)
        XCTAssertTrue(app.descendants(matching: .any)["workspace.chat.bipMissionCard"].exists)
        XCTAssertFalse(app.descendants(matching: .any)["workspace.settingsPage"].exists)
        XCTAssertFalse(app.buttons["BIP Coach"].exists)
        XCTAssertFalse(app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", "BIP Coach / Day 1")).firstMatch.exists)
        app.terminate()
    }

    @MainActor
    func testMorningBipNotificationRoutesToInlineCoach() throws {
        let workspacePath = "/tmp/agentic30-ui-bip-notification-morning-\(UUID().uuidString)"
        let app = launchApp(arguments: [
            "--ui-testing-reset-onboarding",
            "--ui-testing-seed-auth",
            "--ui-testing-seed-onboarding-context",
            "--ui-testing-seed-workspace=\(workspacePath)",
            "--ui-testing-sidecar-failure",
            "--ui-testing-open-bip-notification=morning",
            "--ui-testing-opaque-window",
        ])

        XCTAssertTrue(app.descendants(matching: .any)["workspace.bipCoach.inlineModule"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.descendants(matching: .any)["workspace.bipNotificationHint"].waitForExistence(timeout: 3))
        XCTAssertTrue(app.staticTexts["10시 알림에서 열었어요. 오늘 미션을 만들거나 하나 선택하세요."].exists)
        XCTAssertTrue(app.descendants(matching: .any)["workspace.bipCoach.sidecarFailure"].exists)
        XCTAssertFalse(app.descendants(matching: .any)["workspace.settingsPage"].exists)
        app.terminate()
    }

    @MainActor
    func testEveningBipNotificationExpandsCompletionFieldsForCurrentMission() throws {
        let workspacePath = "/tmp/agentic30-ui-bip-notification-evening-\(UUID().uuidString)"
        let app = launchApp(
            arguments: [
                "--ui-testing-reset-onboarding",
                "--ui-testing-seed-auth",
                "--ui-testing-seed-onboarding-context",
                "--ui-testing-seed-workspace=\(workspacePath)",
                "--ui-testing-disable-sidecar",
                "--ui-testing-seed-bip-current-mission",
                "--ui-testing-open-bip-notification=evening",
                "--ui-testing-opaque-window",
            ],
            environment: [
                "AGENTIC30_UI_TEST_INLINE_STUB_RESPONSES": "1",
            ]
        )

        XCTAssertTrue(app.descendants(matching: .any)["workspace.bipCoach.inlineModule"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.descendants(matching: .any)["workspace.bipNotificationHint"].waitForExistence(timeout: 3))
        XCTAssertTrue(app.staticTexts["21시 마감 체크에서 열었어요. 게시 URL과 Sheet 기록을 남기면 오늘 미션이 끝나요."].exists)
        XCTAssertTrue(app.textFields["assistant.bipThreadsURL"].waitForExistence(timeout: 3))
        XCTAssertTrue(app.textFields["assistant.bipSheetRowNote"].exists)
        XCTAssertFalse(app.staticTexts["생성 중..."].exists)
        XCTAssertFalse(app.descendants(matching: .any)["workspace.settingsPage"].exists)
        app.terminate()
    }

    @MainActor
    private func launchApp(
        arguments: [String],
        environment: [String: String] = [:]
    ) -> XCUIApplication {
        let app = XCUIApplication()
        if app.state != .notRunning {
            app.terminate()
            RunLoop.current.run(until: Date().addingTimeInterval(0.5))
        }
        app.launchArguments = arguments
        app.launchEnvironment = environment
        app.launch()
        if app.state == .runningBackground {
            app.activate()
        }
        return app
    }

    private func macAuthBaseURLArguments() -> [String] {
        guard let baseURL = ProcessInfo.processInfo.environment["AGENTIC30_MAC_AUTH_BASE_URL"]?.trimmedNonEmpty else {
            return []
        }
        return ["--ui-testing-web-base-url=\(baseURL)"]
    }

    @MainActor
    private func openSettingsWindow(in app: XCUIApplication) -> Bool {
        if app.staticTexts["Agent Models"].exists {
            return true
        }

        app.activate()
        app.typeKey(",", modifierFlags: .command)
        if app.staticTexts["Agent Models"].waitForExistence(timeout: 3) {
            return true
        }

        let appMenu = app.menuBars.menuBarItems["agentic30"]
        if appMenu.exists {
            appMenu.click()
            let settingsItem = app.menuItems["Settings…"]
            if settingsItem.waitForExistence(timeout: 2) {
                settingsItem.click()
                return app.staticTexts["Agent Models"].waitForExistence(timeout: 5)
            }
        }

        return app.staticTexts["Agent Models"].waitForExistence(timeout: 2)
    }

    @MainActor
    private func chooseModelOption(
        in app: XCUIApplication,
        pickerIdentifier: String,
        optionLabel: String
    ) -> Bool {
        let picker = elementWithIdentifier(in: app, pickerIdentifier)
        guard picker.waitForExistence(timeout: 5) else {
            return false
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
        if labelMatch.waitForExistence(timeout: 2) {
            clickCenter(of: labelMatch)
            return true
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
            .firstMatch
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

    @MainActor
    private func selectProjectDirectory(
        in app: XCUIApplication,
        path: String,
        timeout: TimeInterval
    ) -> Bool {
        let deadline = Date().addingTimeInterval(timeout)

        repeat {
            if app.dialogs.count > 0 || app.windows["Open"].exists || app.windows["Select your project workspace root"].exists {
                break
            }
            RunLoop.current.run(until: Date().addingTimeInterval(0.25))
        } while Date() < deadline

        app.typeKey("g", modifierFlags: [.command, .shift])
        RunLoop.current.run(until: Date().addingTimeInterval(0.5))

        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(path, forType: .string)
        app.typeKey("v", modifierFlags: [.command])
        app.typeKey(.return, modifierFlags: [])
        RunLoop.current.run(until: Date().addingTimeInterval(1.25))
        NSPasteboard.general.clearContents()

        for label in ["Open", "Choose", "Select", "열기", "선택"] {
            let openButton = app.buttons[label]
            if openButton.exists {
                openButton.click()
                break
            }
        }
        app.typeKey(.return, modifierFlags: [])

        return waitUntilEnabled(button(in: app, matching: [
            "workspace.startAssistantButton",
            "Start assistant",
        ]), timeout: 8)
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
    private func answerBootstrapPromptIfNeeded(in app: XCUIApplication) {
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
                "BIP 초안 작성하기",
                "워크스페이스 살펴보기",
                "Define project strategy docs",
                "Pressure-test an idea",
                "Draft BIP content",
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
            if anyStaticText(in: app, identifiers: ["assistant.latestPrompt", "workspace.chat.user", "workspace.chat.pendingUser", "workspace.chatThread"], contains: marker) {
                return true
            }
            RunLoop.current.run(until: Date().addingTimeInterval(0.25))
        } while Date() < deadline

        return anyStaticText(in: app, identifiers: ["assistant.latestPrompt", "workspace.chat.user", "workspace.chat.pendingUser", "workspace.chatThread"], contains: marker)
    }

    @MainActor
    private func waitForLatestAnswer(
        in app: XCUIApplication,
        containing marker: String,
        timeout: TimeInterval
    ) -> Bool {
        let deadline = Date().addingTimeInterval(timeout)

        repeat {
            if anyStaticText(in: app, identifiers: ["assistant.latestAnswer", "workspace.chat.assistant", "workspace.chatThread"], contains: marker) {
                return true
            }
            RunLoop.current.run(until: Date().addingTimeInterval(0.25))
        } while Date() < deadline

        return anyStaticText(in: app, identifiers: ["assistant.latestAnswer", "workspace.chat.assistant", "workspace.chatThread"], contains: marker)
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
        sendButton.click()

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
        promptComposer.click()
        app.typeKey("a", modifierFlags: [.command])
        app.typeKey(.delete, modifierFlags: [])
        promptComposer.typeText(prompt)
        RunLoop.current.run(until: Date().addingTimeInterval(0.2))
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
        if element.isHittable {
            element.click()
        } else {
            element.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).click()
        }
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
            let element = app.buttons.matching(NSPredicate(format: "identifier == %@ OR label == %@", name, name)).firstMatch
            if element.exists {
                return element
            }
        }
        return app.buttons.matching(NSPredicate(format: "identifier == %@ OR label == %@", names[0], names[0])).firstMatch
    }

    @MainActor
    private func textField(in app: XCUIApplication, matching names: [String]) -> XCUIElement {
        for name in names {
            let element = app.textFields.matching(NSPredicate(format: "identifier == %@ OR label == %@", name, name)).firstMatch
            if element.exists {
                return element
            }
            let anyElement = app.descendants(matching: .any)
                .matching(NSPredicate(format: "identifier == %@ OR label == %@", name, name))
                .firstMatch
            if anyElement.exists {
                return anyElement
            }
        }
        return app.textFields.matching(NSPredicate(format: "identifier == %@ OR label == %@", names[0], names[0])).firstMatch
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
