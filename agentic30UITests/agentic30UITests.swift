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
    func testFirstRunIntroAdvancesIntoContextCollectionWithoutLogin() throws {
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

        if app.staticTexts["Welcome to Agentic30"].waitForExistence(timeout: 5) {
            advanceOnboardingIntroToContext(in: app)
        } else if elementWithIdentifier(in: app, "intakeV2.boot.cards").waitForExistence(timeout: 5) {
            verifyBootIntroLayout(in: app)
            clickCenter(of: button(in: app, matching: ["Continue →", "Continue"]))
        } else if app.staticTexts["지금 하루를 가장 많이 쓰는 역할은 무엇인가요?"].waitForExistence(timeout: 2) {
            // Some persisted UI-test launch states enter the first intake step directly.
        } else {
            XCTFail("Expected first-run intro or Intake V2 boot intro")
        }
        XCTAssertFalse(app.buttons["Sign in with Google"].exists)
        XCTAssertTrue(app.staticTexts["지금 하루를 가장 많이 쓰는 역할은 무엇인가요?"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["Next"].exists)
    }

    @MainActor
    func testIntakeV2PrefetchShowsPreparedQuestionOnWorkspaceEntry() throws {
        let runID = UUID().uuidString
        let tempRoot = FileManager.default.temporaryDirectory
        let workspacePath = tempRoot
            .appendingPathComponent("agentic30-ui-intake-prefetch-workspace-\(runID)", isDirectory: true)
            .path
        let appSupportPath = tempRoot
            .appendingPathComponent("agentic30-ui-intake-prefetch-app-\(runID)", isDirectory: true)
            .path
        resetDirectory(at: workspacePath)
        resetDirectory(at: appSupportPath)
        try FileManager.default.createDirectory(
            atPath: workspacePath,
            withIntermediateDirectories: true
        )
        try FileManager.default.createDirectory(
            atPath: appSupportPath,
            withIntermediateDirectories: true
        )
        try "Agentic30 UI prefetch fixture\n".write(
            toFile: "\(workspacePath)/README.md",
            atomically: true,
            encoding: .utf8
        )

        let app = launchApp(arguments: [
            "--ui-testing-reset-onboarding",
            "--ui-testing-seed-auth",
            "--ui-testing-picker-path=\(workspacePath)",
            "--ui-testing-open-workspace",
            "--ui-testing-opaque-window",
        ], environment: [
            "AGENTIC30_APP_SUPPORT_PATH": appSupportPath,
            "AGENTIC30_DISABLE_IDD_AGENT_SYNTHESIS": "1",
            "AGENTIC30_TEST_STUB_PROVIDER": "1",
            "AGENTIC30_CODEX_MODEL": "gpt-5.5",
        ])
        hideKnownInterferingApplications()
        app.activate()
        addTeardownBlock {
            app.terminate()
            self.unhideKnownInterferingApplications()
            self.removeDirectory(at: workspacePath)
            self.removeDirectory(at: appSupportPath)
        }

        var intakeLayoutBaseline = IntakeLayoutBaseline()
        if app.staticTexts["Welcome to Agentic30"].waitForExistence(timeout: 3) {
            advanceOnboardingIntroToContext(in: app)
        } else if elementWithIdentifier(in: app, "intakeV2.boot.cards").waitForExistence(timeout: 3) {
            clickCenter(of: button(in: app, matching: ["Continue →", "Continue"]))
        }
        XCTAssertTrue(app.staticTexts["지금 하루를 가장 많이 쓰는 역할은 무엇인가요?"].waitForExistence(timeout: 10))
        assertStableIntakeStepLayout(
            in: app,
            current: 2,
            baseline: &intakeLayoutBaseline
        )
        XCTAssertTrue(button(in: app, matching: ["Back"]).exists)
        clickCenter(of: button(in: app, matching: ["Back"]))
        verifyBootIntroLayout(in: app)
        clickCenter(of: button(in: app, matching: ["Continue →", "Continue"]))
        XCTAssertTrue(app.staticTexts["지금 하루를 가장 많이 쓰는 역할은 무엇인가요?"].waitForExistence(timeout: 5))
        assertStableIntakeStepLayout(
            in: app,
            current: 2,
            baseline: &intakeLayoutBaseline
        )
        clickCenter(of: buttonContaining(in: app, text: "개발자"))
        XCTAssertTrue(button(in: app, matching: ["Next →", "Next"]).isEnabled)
        clickCenter(of: button(in: app, matching: ["Next →", "Next"]))
        XCTAssertTrue(app.staticTexts["지금 가장 큰 막힘은 무엇인가요?"].waitForExistence(timeout: 5))
        assertStableIntakeStepLayout(
            in: app,
            current: 3,
            baseline: &intakeLayoutBaseline
        )
        XCTAssertTrue(button(in: app, matching: ["Back"]).exists)
        clickCenter(of: button(in: app, matching: ["Back"]))
        XCTAssertTrue(app.staticTexts["지금 하루를 가장 많이 쓰는 역할은 무엇인가요?"].waitForExistence(timeout: 5))
        assertStableIntakeStepLayout(
            in: app,
            current: 2,
            baseline: &intakeLayoutBaseline
        )
        clickCenter(of: button(in: app, matching: ["Next →", "Next"]))
        XCTAssertTrue(app.staticTexts["지금 가장 큰 막힘은 무엇인가요?"].waitForExistence(timeout: 5))
        assertStableIntakeStepLayout(
            in: app,
            current: 3,
            baseline: &intakeLayoutBaseline
        )
        clickCenter(of: buttonContaining(in: app, text: "첫 사용자를 찾지 못하고 있다"))
        XCTAssertTrue(button(in: app, matching: ["Next →", "Next"]).isEnabled)
        clickCenter(of: button(in: app, matching: ["Next →", "Next"]))
        XCTAssertTrue(app.staticTexts["하루에 얼마나 시간을 쓸 수 있나요?"].waitForExistence(timeout: 5))
        assertStableIntakeStepLayout(
            in: app,
            current: 4,
            baseline: &intakeLayoutBaseline
        )
        XCTAssertTrue(button(in: app, matching: ["Back"]).exists)
        clickCenter(of: buttonContaining(in: app, text: "전업으로 6시간 이상"))
        clickCenter(of: button(in: app, matching: ["Next →", "Next"]))
        XCTAssertTrue(app.staticTexts["이미 가진 기록이 있나요?"].waitForExistence(timeout: 5))
        assertStableIntakeStepLayout(
            in: app,
            current: 5,
            baseline: &intakeLayoutBaseline
        )
        clickCenter(of: buttonContaining(in: app, text: "프로젝트 일지"))
        clickCenter(of: button(in: app, matching: ["Next →", "Next"]))
        XCTAssertTrue(app.staticTexts["프로젝트 폴더를 연결할까요?"].waitForExistence(timeout: 5))
        assertStableIntakeStepLayout(
            in: app,
            current: 6,
            baseline: &intakeLayoutBaseline
        )
        XCTAssertTrue(button(in: app, matching: ["Back"]).exists)
        XCTAssertFalse(button(in: app, matching: ["Continue →", "Continue"]).exists)
        clickCenter(of: buttonContaining(in: app, text: "AI 도구로 연결"))
        XCTAssertTrue(elementWithIdentifier(in: app, "intakeV2.folderPromptPasteGuide").waitForExistence(timeout: 3))
        XCTAssertTrue(app.staticTexts["열어 둔 Cursor, Claude Code, Codex에 붙여넣으세요."].exists)
        clickCenter(of: buttonContaining(in: app, text: "직접 선택"))
        XCTAssertTrue(buttonContaining(in: app, text: "다른 폴더 선택").waitForExistence(timeout: 3))
        XCTAssertFalse(buttonContaining(in: app, text: "나중에").exists)
        let selectedFolderName = elementWithIdentifier(in: app, "intakeV2.selectedFolderName")
        XCTAssertTrue(selectedFolderName.waitForExistence(timeout: 3))
        XCTAssertEqual(selectedFolderName.label, (workspacePath as NSString).lastPathComponent)
        clickCenter(of: button(in: app, matching: ["Continue →", "Continue"]))

        XCTAssertTrue(app.staticTexts["읽을 기록 더 연결하기"].waitForExistence(timeout: 10))
        assertStableIntakeStepLayout(
            in: app,
            current: 7,
            baseline: &intakeLayoutBaseline
        )
        XCTAssertTrue(button(in: app, matching: ["Back"]).exists)
        XCTAssertTrue(button(in: app, matching: ["Continue →", "Continue"]).exists)

        let continueButton = button(in: app, matching: ["Continue →", "Continue", "Skip →", "Skip"])
        XCTAssertTrue(continueButton.waitForExistence(timeout: 10))
        clickCenter(of: continueButton)

        assertStableIntakeStepLayout(
            in: app,
            current: 8,
            timeout: 10,
            baseline: &intakeLayoutBaseline
        )
        XCTAssertTrue(button(in: app, matching: ["Back"]).exists)
        let bootLog = elementWithIdentifier(in: app, "intakeV2.bootLog")
        let openInbox = elementWithIdentifier(in: app, "intakeV2.openInboxButton")
        let executeButton = elementWithIdentifier(in: app, "intakeV2.executeButton")
        let firstDecisionCard = elementWithIdentifier(in: app, "intakeV2.firstDecisionCard")
        let todoListWindow = elementWithIdentifier(in: app, "intakeV2.todoListWindow")
        let scanPreview = elementWithIdentifier(in: app, "intakeV2.scanPreview")
        let day1ReadyHandoff = elementWithIdentifier(in: app, "intakeV2.day1ReadyHandoff")
        let bootLogDetails = elementWithIdentifier(in: app, "intakeV2.bootLogDetails")
        let elapsedChip = elementWithIdentifier(in: app, "intakeV2.bootLog.elapsed")
        if scanPreview.waitForExistence(timeout: 5) {
            XCTAssertTrue(bootLog.waitForExistence(timeout: 5))
            XCTAssertTrue(elapsedChip.waitForExistence(timeout: 5))
            XCTAssertTrue(
                elapsedChip.label.contains("스캔 진행 시간")
                    || elapsedChip.label.contains("스캔 완료 시간")
                    || elapsedChip.label.contains("스캔 중단 시간")
            )
            let bootLogFrameBeforeDecision = bootLog.frame
            assertBootLogLayoutStableUntilDecisionReady(
                bootLog: bootLog,
                baselineFrame: bootLogFrameBeforeDecision,
                readyElement: openInbox,
                timeout: 30
            )
        } else {
            XCTAssertTrue(openInbox.waitForExistence(timeout: 30))
        }
        XCTAssertTrue(day1ReadyHandoff.waitForExistence(timeout: 5))
        XCTAssertTrue(bootLogDetails.waitForExistence(timeout: 5))
        XCTAssertLessThan(day1ReadyHandoff.frame.minY, bootLogDetails.frame.minY)
        XCTAssertFalse(scanPreview.exists)
        XCTAssertFalse(bootLog.exists)
        XCTAssertTrue(openInbox.waitForExistence(timeout: 5))
        XCTAssertFalse(executeButton.exists)
        XCTAssertFalse(firstDecisionCard.exists)
        XCTAssertFalse(todoListWindow.exists)
        XCTAssertTrue(waitForButtonLabel(in: app, identifier: "intakeV2.openInboxButton", containing: "시작하기", timeout: 10))
        XCTAssertTrue(waitUntilEnabled(openInbox, timeout: 5))
        openInbox.click()
        XCTAssertTrue(app.descendants(matching: .any)["opendesign.day.shell"].waitForExistence(timeout: 30))
    }

    @MainActor
    func testIntakeV2FolderSkipUsesIntakeOnlyTrustCopyAndRequestedSources() throws {
        let runID = UUID().uuidString
        let appSupportPath = FileManager.default.temporaryDirectory
            .appendingPathComponent("agentic30-ui-intake-skip-app-\(runID)", isDirectory: true)
            .path
        resetDirectory(at: appSupportPath)

        let app = launchApp(arguments: [
            "--ui-testing-reset-onboarding",
            "--ui-testing-open-workspace",
            "--ui-testing-opaque-window",
        ], environment: [
            "AGENTIC30_APP_SUPPORT_PATH": appSupportPath,
            "AGENTIC30_DISABLE_IDD_AGENT_SYNTHESIS": "1",
            "AGENTIC30_TEST_STUB_PROVIDER": "1",
        ])
        hideKnownInterferingApplications()
        app.activate()
        addTeardownBlock {
            app.terminate()
            self.unhideKnownInterferingApplications()
            self.removeDirectory(at: appSupportPath)
        }

        if app.staticTexts["Welcome to Agentic30"].waitForExistence(timeout: 3) {
            advanceOnboardingIntroToContext(in: app)
        } else if elementWithIdentifier(in: app, "intakeV2.boot.cards").waitForExistence(timeout: 3) {
            clickCenter(of: button(in: app, matching: ["Continue →", "Continue"]))
        }

        XCTAssertTrue(app.staticTexts["지금 하루를 가장 많이 쓰는 역할은 무엇인가요?"].waitForExistence(timeout: 5))
        clickCenter(of: buttonContaining(in: app, text: "개발자"))
        clickCenter(of: button(in: app, matching: ["Next →", "Next"]))
        XCTAssertTrue(app.staticTexts["지금 가장 큰 막힘은 무엇인가요?"].waitForExistence(timeout: 5))
        clickCenter(of: buttonContaining(in: app, text: "첫 사용자를 찾지 못하고 있다"))
        clickCenter(of: button(in: app, matching: ["Next →", "Next"]))
        XCTAssertTrue(app.staticTexts["하루에 얼마나 시간을 쓸 수 있나요?"].waitForExistence(timeout: 10))
        clickCenter(of: buttonContaining(in: app, text: "전업으로 6시간 이상"))
        clickCenter(of: button(in: app, matching: ["Next →", "Next"]))
        XCTAssertTrue(app.staticTexts["이미 가진 기록이 있나요?"].waitForExistence(timeout: 5))
        clickCenter(of: buttonContaining(in: app, text: "아직 기록은 없다"))
        clickCenter(of: button(in: app, matching: ["Next →", "Next"]))
        XCTAssertTrue(app.staticTexts["프로젝트 폴더를 연결할까요?"].waitForExistence(timeout: 5))
        XCTAssertFalse(button(in: app, matching: ["Continue →", "Continue"]).exists)
        clickCenter(of: buttonContaining(in: app, text: "나중에"))

        if !app.staticTexts["읽을 기록 더 연결하기"].waitForExistence(timeout: 10) {
            attachText(app.debugDescription, named: "Intake V2 source step missing after folder skip")
            XCTFail("Source connection step should appear after skipping folder selection.")
            return
        }
        assertIntakeProgress(in: app, current: 7)
        let representativeMainGridSources: [(label: String, identifier: String)] = [
            ("GitHub", "intakeV2.source.github"),
            ("Cursor", "intakeV2.source.cursor"),
            ("Claude Code", "intakeV2.source.claude_code"),
            ("Codex", "intakeV2.source.codex"),
            ("Instagram", "intakeV2.source.instagram"),
            ("AWS", "intakeV2.source.aws"),
        ]
        for source in representativeMainGridSources {
            let sourceTile = elementWithIdentifier(in: app, source.identifier)
            XCTAssertTrue(
                scrollElementToVisible(sourceTile, in: app, timeout: 5),
                "\(source.label) should be visible in the 7/8 main grid."
            )
            XCTAssertTrue(element(sourceTile, contains: source.label))
            clickCenter(of: sourceTile)
            XCTAssertTrue(buttonContaining(in: app, text: "Connected later").waitForExistence(timeout: 3))
            XCTAssertFalse(element(sourceTile, contains: "Connected ·"))
        }
        clickCenter(of: button(in: app, matching: ["Continue →", "Continue", "Skip →", "Skip"]))

        assertIntakeProgress(in: app, current: 8, timeout: 10)
        let openInbox = elementWithIdentifier(in: app, "intakeV2.openInboxButton")
        let day1ReadyHandoff = elementWithIdentifier(in: app, "intakeV2.day1ReadyHandoff")
        XCTAssertTrue(waitUntilEnabled(openInbox, timeout: 30))
        XCTAssertTrue(day1ReadyHandoff.waitForExistence(timeout: 5))
        let renderedTree = app.debugDescription
        XCTAssertTrue(renderedTree.contains("질문 3개가 준비됐어요"))
        XCTAssertTrue(renderedTree.contains("기본 질문 3개가 준비됐습니다"))
        XCTAssertFalse(renderedTree.contains("kernel.init"))
        XCTAssertFalse(renderedTree.contains("signals.detect"))
        XCTAssertFalse(renderedTree.contains("context.read (no folder)"))
        XCTAssertFalse(renderedTree.contains("intake-only"))
        XCTAssertFalse(renderedTree.contains("당신의 폴더를 읽고"))
        XCTAssertTrue(openInbox.exists)
        XCTAssertTrue(openInbox.isEnabled)
        XCTAssertLessThanOrEqual(openInbox.frame.maxX, day1ReadyHandoff.frame.maxX + 2)
        XCTAssertTrue(waitForButtonLabel(in: app, identifier: "intakeV2.openInboxButton", containing: "질문 3개 시작하기", timeout: 5))
        XCTAssertFalse(elementWithIdentifier(in: app, "intakeV2.bootLogDetails").exists)
        XCTAssertFalse(elementWithIdentifier(in: app, "intakeV2.bootLog.elapsed").exists)
        XCTAssertFalse(elementWithIdentifier(in: app, "intakeV2.executeButton").exists)
        XCTAssertFalse(elementWithIdentifier(in: app, "intakeV2.firstDecisionCard").exists)
        XCTAssertFalse(elementWithIdentifier(in: app, "intakeV2.todoListWindow").exists)
        XCTAssertTrue(button(in: app, matching: ["Back"]).exists)

        clickCenter(of: openInbox)
        XCTAssertTrue(elementWithIdentifier(in: app, "workspace.surface").waitForExistence(timeout: 10))
        XCTAssertFalse(elementWithIdentifier(in: app, "intakeV2.openInboxButton").exists)
        XCTAssertFalse(elementWithIdentifier(in: app, "intakeV2.bootLogDetails").exists)
        XCTAssertFalse(elementWithIdentifier(in: app, "intakeV2.bootLog.elapsed").exists)
        XCTAssertTrue(elementWithIdentifier(in: app, "opendesign.day.shell").waitForExistence(timeout: 10))
    }

    @MainActor
    func testIntakeV2ScanWaitDoesNotShowEarlyAnswerQuestions() throws {
        let runID = UUID().uuidString
        let tempRoot = FileManager.default.temporaryDirectory
        let workspacePath = tempRoot
            .appendingPathComponent("agentic30-ui-intake-scan-wait-workspace-\(runID)", isDirectory: true)
            .path
        let appSupportPath = tempRoot
            .appendingPathComponent("agentic30-ui-intake-scan-wait-app-\(runID)", isDirectory: true)
            .path
        resetDirectory(at: workspacePath)
        resetDirectory(at: appSupportPath)
        try FileManager.default.createDirectory(
            atPath: workspacePath,
            withIntermediateDirectories: true
        )
        try "Agentic30 UI scan wait fixture\n".write(
            toFile: "\(workspacePath)/README.md",
            atomically: true,
            encoding: .utf8
        )

        let app = launchApp(arguments: [
            "-agentic30.appearance.theme.v1",
            "white",
            "--ui-testing-reset-onboarding",
            "--ui-testing-picker-path=\(workspacePath)",
            "--ui-testing-disable-sidecar",
            "--ui-testing-seed-intake-scan-wait",
            "--ui-testing-open-workspace",
            "--ui-testing-opaque-window",
        ], environment: [
            "AGENTIC30_APP_SUPPORT_PATH": appSupportPath,
            "AGENTIC30_TEST_STUB_PROVIDER": "1",
        ])
        hideKnownInterferingApplications()
        app.activate()
        addTeardownBlock {
            app.terminate()
            self.unhideKnownInterferingApplications()
            self.removeDirectory(at: workspacePath)
            self.removeDirectory(at: appSupportPath)
        }

        let bootCards = app.groups["intakeV2.boot.cards"]
        if app.staticTexts["Welcome to Agentic30"].waitForExistence(timeout: 3) {
            advanceOnboardingIntroToContext(in: app)
        } else if bootCards.waitForExistence(timeout: 3) || elementWithIdentifier(in: app, "intakeV2.boot.cards").exists {
            verifyBootIntroLayout(in: app)
            clickCenter(of: button(in: app, matching: ["Continue →", "Continue"]))
        }

        if !app.staticTexts["지금 하루를 가장 많이 쓰는 역할은 무엇인가요?"].waitForExistence(timeout: 10),
           bootCards.exists {
            clickCenter(of: button(in: app, matching: ["Continue →", "Continue"]))
        }
        XCTAssertTrue(app.staticTexts["지금 하루를 가장 많이 쓰는 역할은 무엇인가요?"].waitForExistence(timeout: 5))
        clickCenter(of: buttonContaining(in: app, text: "개발자"))
        clickCenter(of: button(in: app, matching: ["Next →", "Next"]))
        XCTAssertTrue(app.staticTexts["지금 가장 큰 막힘은 무엇인가요?"].waitForExistence(timeout: 5))
        clickCenter(of: buttonContaining(in: app, text: "첫 사용자를 찾지 못하고 있다"))
        clickCenter(of: button(in: app, matching: ["Next →", "Next"]))
        XCTAssertTrue(app.staticTexts["하루에 얼마나 시간을 쓸 수 있나요?"].waitForExistence(timeout: 5))
        clickCenter(of: buttonContaining(in: app, text: "전업으로 6시간 이상"))
        clickCenter(of: button(in: app, matching: ["Next →", "Next"]))
        XCTAssertTrue(app.staticTexts["이미 가진 기록이 있나요?"].waitForExistence(timeout: 5))
        clickCenter(of: buttonContaining(in: app, text: "프로젝트 일지"))
        clickCenter(of: button(in: app, matching: ["Next →", "Next"]))
        XCTAssertTrue(app.staticTexts["프로젝트 폴더를 연결할까요?"].waitForExistence(timeout: 5))
        clickCenter(of: buttonContaining(in: app, text: "직접 선택"))
        XCTAssertTrue(buttonContaining(in: app, text: "다른 폴더 선택").waitForExistence(timeout: 3))
        clickCenter(of: button(in: app, matching: ["Continue →", "Continue"]))
        XCTAssertTrue(app.staticTexts["읽을 기록 더 연결하기"].waitForExistence(timeout: 10))
        clickCenter(of: button(in: app, matching: ["Continue →", "Continue", "Skip →", "Skip"]))

        assertIntakeProgress(in: app, current: 8, timeout: 10)
        let bootLog = elementWithIdentifier(in: app, "intakeV2.bootLog")
        let openInbox = elementWithIdentifier(in: app, "intakeV2.openInboxButton")
        let scanPreview = elementWithIdentifier(in: app, "intakeV2.scanPreview")
        let footerSpinner = elementWithIdentifier(in: app, "intakeV2.footerNextSpinner")
        XCTAssertTrue(scanPreview.waitForExistence(timeout: 5))
        XCTAssertTrue(bootLog.waitForExistence(timeout: 5))
        XCTAssertTrue(openInbox.waitForExistence(timeout: 5))
        XCTAssertTrue(footerSpinner.waitForExistence(timeout: 5))
        XCTAssertFalse(openInbox.isEnabled)
        XCTAssertTrue(button(in: app, matching: ["Back"]).exists)
        let scanWaitTree = app.debugDescription
        XCTAssertFalse(scanWaitTree.contains("보통 30-45초 걸립니다."))
        XCTAssertFalse(scanWaitTree.contains("질문 3개 준비 중…"))
        XCTAssertTrue(openInbox.label.contains("초 남음 예상") || openInbox.label.contains("마무리 중"))

        let removedButtonIdentifier = "intakeV2." + "early" + "StartButton"
        let removedPromptIdentifier = "intakeV2." + "early" + "StartPrompt"
        let removedQuestionsIdentifier = "intakeV2." + "early" + "StartQuestions"
        let removedMergeIdentifier = "intakeV2." + "scan" + "MergeWait"
        let removedButton = elementWithIdentifier(in: app, removedButtonIdentifier)
        XCTAssertFalse(removedButton.waitForExistence(timeout: 2))
        XCTAssertFalse(elementWithIdentifier(in: app, removedPromptIdentifier).exists)
        XCTAssertFalse(elementWithIdentifier(in: app, removedQuestionsIdentifier).exists)
        XCTAssertFalse(elementWithIdentifier(in: app, removedMergeIdentifier).exists)
        XCTAssertFalse(removedButton.exists)
        XCTAssertFalse(openInbox.isEnabled)
        XCTAssertTrue(scanPreview.exists)
        XCTAssertTrue(bootLog.exists)
        let renderedTree = app.debugDescription
        XCTAssertFalse(renderedTree.contains("기다리는 동안 " + "먼저 답할 수 있어요"))
        XCTAssertFalse(renderedTree.contains("3개 질문 " + "먼저 답하기"))
        XCTAssertFalse(renderedTree.contains("답변은 " + "저장했습니다"))
        XCTAssertFalse(renderedTree.contains("intake 답변으로 먼저 시작하기"))
    }

    @MainActor
    func testIntakeV2ScanWaitRendersInDarkTheme() throws {
        let runID = UUID().uuidString
        let tempRoot = FileManager.default.temporaryDirectory
        let workspacePath = tempRoot
            .appendingPathComponent("agentic30-ui-intake-scan-wait-dark-workspace-\(runID)", isDirectory: true)
            .path
        let appSupportPath = tempRoot
            .appendingPathComponent("agentic30-ui-intake-scan-wait-dark-app-\(runID)", isDirectory: true)
            .path
        resetDirectory(at: workspacePath)
        resetDirectory(at: appSupportPath)
        try FileManager.default.createDirectory(
            atPath: workspacePath,
            withIntermediateDirectories: true
        )
        try "Agentic30 UI dark scan wait fixture\n".write(
            toFile: "\(workspacePath)/README.md",
            atomically: true,
            encoding: .utf8
        )

        let app = launchApp(arguments: [
            "-agentic30.appearance.theme.v1",
            "dark",
            "--ui-testing-reset-onboarding",
            "--ui-testing-picker-path=\(workspacePath)",
            "--ui-testing-disable-sidecar",
            "--ui-testing-open-workspace",
            "--ui-testing-opaque-window",
        ], environment: [
            "AGENTIC30_APP_SUPPORT_PATH": appSupportPath,
            "AGENTIC30_TEST_STUB_PROVIDER": "1",
        ])
        hideKnownInterferingApplications()
        app.activate()
        addTeardownBlock {
            app.terminate()
            self.unhideKnownInterferingApplications()
            self.removeDirectory(at: workspacePath)
            self.removeDirectory(at: appSupportPath)
        }

        let bootCards = elementWithIdentifier(in: app, "intakeV2.boot.cards")
        if app.staticTexts["Welcome to Agentic30"].waitForExistence(timeout: 3) {
            advanceOnboardingIntroToContext(in: app)
        } else if bootCards.waitForExistence(timeout: 3) {
            verifyBootIntroLayout(in: app)
            clickCenter(of: button(in: app, matching: ["Continue →", "Continue"]))
        } else {
            XCTFail("Expected Intake V2 boot intro in dark theme")
        }

        XCTAssertTrue(app.staticTexts["지금 하루를 가장 많이 쓰는 역할은 무엇인가요?"].waitForExistence(timeout: 5))
        clickCenter(of: buttonContaining(in: app, text: "개발자"))
        clickCenter(of: button(in: app, matching: ["Next →", "Next"]))
        XCTAssertTrue(app.staticTexts["지금 가장 큰 막힘은 무엇인가요?"].waitForExistence(timeout: 5))
        clickCenter(of: buttonContaining(in: app, text: "첫 사용자를 찾지 못하고 있다"))
        clickCenter(of: button(in: app, matching: ["Next →", "Next"]))
        XCTAssertTrue(app.staticTexts["하루에 얼마나 시간을 쓸 수 있나요?"].waitForExistence(timeout: 5))
        clickCenter(of: buttonContaining(in: app, text: "전업으로 6시간 이상"))
        clickCenter(of: button(in: app, matching: ["Next →", "Next"]))
        XCTAssertTrue(app.staticTexts["이미 가진 기록이 있나요?"].waitForExistence(timeout: 5))
        clickCenter(of: buttonContaining(in: app, text: "프로젝트 일지"))
        clickCenter(of: button(in: app, matching: ["Next →", "Next"]))
        XCTAssertTrue(app.staticTexts["프로젝트 폴더를 연결할까요?"].waitForExistence(timeout: 5))
        clickCenter(of: buttonContaining(in: app, text: "직접 선택"))
        XCTAssertTrue(buttonContaining(in: app, text: "다른 폴더 선택").waitForExistence(timeout: 3))
        clickCenter(of: button(in: app, matching: ["Continue →", "Continue"]))
        XCTAssertTrue(app.staticTexts["읽을 기록 더 연결하기"].waitForExistence(timeout: 10))
        clickCenter(of: button(in: app, matching: ["Continue →", "Continue", "Skip →", "Skip"]))

        assertIntakeProgress(in: app, current: 8, timeout: 10)
        XCTAssertTrue(elementWithIdentifier(in: app, "intakeV2.progress").waitForExistence(timeout: 5))
        XCTAssertTrue(elementWithIdentifier(in: app, "intakeV2.scanPreview").waitForExistence(timeout: 5))
        XCTAssertTrue(elementWithIdentifier(in: app, "intakeV2.openInboxButton").waitForExistence(timeout: 5))
        XCTAssertTrue(elementWithIdentifier(in: app, "intakeV2.footerNextSpinner").waitForExistence(timeout: 5))
    }

    @MainActor
    func testIntakeV2AddSourceModalSearchSelectsAndShowsCustomEmptyState() throws {
        let runID = UUID().uuidString
        let appSupportPath = FileManager.default.temporaryDirectory
            .appendingPathComponent("agentic30-ui-add-source-app-\(runID)", isDirectory: true)
            .path
        resetDirectory(at: appSupportPath)

        let app = launchApp(arguments: [
            "--ui-testing-reset-onboarding",
            "--ui-testing-open-workspace",
            "--ui-testing-opaque-window",
        ], environment: [
            "AGENTIC30_APP_SUPPORT_PATH": appSupportPath,
            "AGENTIC30_DISABLE_IDD_AGENT_SYNTHESIS": "1",
            "AGENTIC30_TEST_STUB_PROVIDER": "1",
        ])
        hideKnownInterferingApplications()
        app.activate()
        addTeardownBlock {
            app.terminate()
            self.unhideKnownInterferingApplications()
            self.removeDirectory(at: appSupportPath)
        }

        if app.staticTexts["Welcome to Agentic30"].waitForExistence(timeout: 3) {
            advanceOnboardingIntroToContext(in: app)
        } else if elementWithIdentifier(in: app, "intakeV2.boot.cards").waitForExistence(timeout: 3) {
            clickCenter(of: button(in: app, matching: ["Continue →", "Continue"]))
        }

        XCTAssertTrue(app.staticTexts["지금 하루를 가장 많이 쓰는 역할은 무엇인가요?"].waitForExistence(timeout: 5))
        clickCenter(of: buttonContaining(in: app, text: "개발자"))
        clickCenter(of: button(in: app, matching: ["Next →", "Next"]))
        XCTAssertTrue(app.staticTexts["지금 가장 큰 막힘은 무엇인가요?"].waitForExistence(timeout: 5))
        clickCenter(of: buttonContaining(in: app, text: "첫 사용자를 찾지 못하고 있다"))
        clickCenter(of: button(in: app, matching: ["Next →", "Next"]))
        XCTAssertTrue(app.staticTexts["하루에 얼마나 시간을 쓸 수 있나요?"].waitForExistence(timeout: 10))
        clickCenter(of: buttonContaining(in: app, text: "전업으로 6시간 이상"))
        clickCenter(of: button(in: app, matching: ["Next →", "Next"]))
        XCTAssertTrue(app.staticTexts["이미 가진 기록이 있나요?"].waitForExistence(timeout: 5))
        clickCenter(of: buttonContaining(in: app, text: "아직 기록은 없다"))
        clickCenter(of: button(in: app, matching: ["Next →", "Next"]))
        XCTAssertTrue(app.staticTexts["프로젝트 폴더를 연결할까요?"].waitForExistence(timeout: 5))
        clickCenter(of: buttonContaining(in: app, text: "나중에"))

        XCTAssertTrue(app.staticTexts["읽을 기록 더 연결하기"].waitForExistence(timeout: 10))
        assertIntakeProgress(in: app, current: 7)

        func selectCatalogSource(
            _ displayName: String,
            rowID: String,
            in sourceSearch: XCUIElement,
            file: StaticString = #filePath,
            line: UInt = #line
        ) {
            replaceSearchText(displayName, in: sourceSearch)

            let sourceRow = elementWithIdentifier(in: app, rowID)
            XCTAssertTrue(sourceRow.waitForExistence(timeout: 3), file: file, line: line)
            clickCenter(of: sourceRow)
        }

        func replaceSearchText(_ text: String, in sourceSearch: XCUIElement) {
            if let currentValue = sourceSearch.value as? String,
               currentValue != "소스 검색" {
                for _ in currentValue {
                    app.typeKey(.delete, modifierFlags: [])
                }
            }
            sourceSearch.typeText(text)
        }

        let addSourceButton = elementWithIdentifier(in: app, "intakeV2.addSource")
        XCTAssertTrue(scrollElementToVisible(addSourceButton, in: app, timeout: 5))
        clickCenter(of: addSourceButton)
        XCTAssertTrue(elementWithIdentifier(in: app, "intakeV2.addSource.modal").waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["기록 소스 추가"].exists)

        let search = textField(in: app, matching: ["intakeV2.addSource.search", "소스 검색"])
        XCTAssertTrue(search.waitForExistence(timeout: 3))
        replaceSearchText("GitHub", in: search)
        XCTAssertFalse(
            elementWithIdentifier(in: app, "intakeV2.addSource.row.github").waitForExistence(timeout: 1),
            "Built-in main-grid sources should not be offered again in the Add Source modal."
        )
        XCTAssertFalse(
            elementWithIdentifier(in: app, "intakeV2.addSource.row.github_issues_linear").waitForExistence(timeout: 1),
            "GitHub search should not surface the Linear source through the legacy github_issues_linear id."
        )

        let sourceSelections: [(displayName: String, rowID: String)] = [
            ("Linear", "intakeV2.addSource.row.github_issues_linear"),
        ]
        for source in sourceSelections {
            selectCatalogSource(source.displayName, rowID: source.rowID, in: search)
        }
        let addSelectedInModal = elementWithIdentifier(in: app, "intakeV2.addSource.addSelected")
        XCTAssertTrue(addSelectedInModal.waitForExistence(timeout: 3))
        clickCenter(of: addSelectedInModal)

        for source in sourceSelections {
            XCTAssertTrue(app.staticTexts[source.displayName].waitForExistence(timeout: 5))
        }
        XCTAssertTrue(app.staticTexts["Connect later · Settings"].exists)

        XCTAssertTrue(scrollElementToVisible(addSourceButton, in: app, timeout: 5))
        clickCenter(of: addSourceButton)
        XCTAssertTrue(elementWithIdentifier(in: app, "intakeV2.addSource.modal").waitForExistence(timeout: 5))
        let reopenedSearch = textField(in: app, matching: ["intakeV2.addSource.search", "소스 검색"])
        XCTAssertTrue(reopenedSearch.waitForExistence(timeout: 3))
        replaceSearchText("Linear", in: reopenedSearch)
        XCTAssertFalse(
            elementWithIdentifier(in: app, "intakeV2.addSource.row.github_issues_linear").waitForExistence(timeout: 1),
            "Sources already added to the main grid should not remain Add Source candidates."
        )

        replaceSearchText("zzzzzz", in: reopenedSearch)
        XCTAssertTrue(app.staticTexts["결과 없음"].waitForExistence(timeout: 3))
    }

    @MainActor
    func testOpenDesignDayPageParitySmoke() throws {
        let runID = UUID().uuidString
        let workspacePath = "/tmp/agentic30-ui-opendesign-day-workspace-\(runID)"
        let appSupportPath = "/tmp/agentic30-ui-opendesign-day-app-support-\(runID)"
        resetDirectory(at: workspacePath)
        resetDirectory(at: appSupportPath)

        let app = launchApp(arguments: [
            "--ui-testing-reset-onboarding",
            "--ui-testing-seed-auth",
            "--ui-testing-seed-onboarding-context",
            "--ui-testing-seed-workspace=\(workspacePath)",
            "--ui-testing-seed-idd-complete",
            "--ui-testing-disable-sidecar",
            "--ui-testing-open-workspace",
            "--ui-testing-opaque-window",
            "--ui-testing-workspace-window-size=1360x835",
        ], environment: [
            "AGENTIC30_APP_SUPPORT_PATH": appSupportPath,
            "AGENTIC30_TEST_STUB_PROVIDER": "1",
        ])
        hideKnownInterferingApplications()
        app.activate()
        addTeardownBlock {
            app.terminate()
            self.unhideKnownInterferingApplications()
            self.removeDirectory(at: workspacePath)
            self.removeDirectory(at: appSupportPath)
        }

        let openDesignShell = elementWithIdentifier(in: app, "opendesign.day.shell")
        if !openDesignShell.waitForExistence(timeout: 10) {
            attachScreenshot(from: app, named: "OpenDesign Day Shell Missing")
            attachText(app.debugDescription, named: "OpenDesign Day Shell Missing Tree")
        }
        XCTAssertTrue(openDesignShell.exists)
        attachScreenshot(from: app, named: "OpenDesign Day Initial Wide")

        let workspaceSurface = elementWithIdentifier(in: app, "workspace.surface")
        let rail = elementWithIdentifier(in: app, "opendesign.day.rail")
        let sessions = elementWithIdentifier(in: app, "opendesign.officeHours.sessions")
        let main = elementWithIdentifier(in: app, "opendesign.officeHours.main")
        let meta = elementWithIdentifier(in: app, "opendesign.officeHours.meta")
        XCTAssertTrue(workspaceSurface.exists)
        XCTAssertTrue(rail.exists)
        XCTAssertTrue(sessions.exists)
        XCTAssertTrue(main.exists)
        XCTAssertTrue(meta.exists)
        assertNativeWindowShellVisible(in: app)
        assertOpenDesignResponsiveColumns(
            surface: workspaceSurface.frame,
            rail: rail.frame,
            tasks: sessions.frame,
            main: main.frame,
            meta: meta.frame,
            expectedRailWidth: 52,
            expectedTaskSidebarWidth: 240,
            expectedMetaPanelWidth: 280
        )

        XCTAssertFalse(elementWithIdentifier(in: app, "opendesign.day.tasks").exists)
        XCTAssertFalse(elementWithIdentifier(in: app, "opendesign.day.main").exists)
        XCTAssertFalse(elementWithIdentifier(in: app, "opendesign.day.meta").exists)
        XCTAssertFalse(app.buttons["opendesign.day.header.context"].exists)
        XCTAssertFalse(app.buttons["opendesign.day.header.primary"].exists)
        XCTAssertFalse(app.buttons["opendesign.day.header.reset"].exists)
        XCTAssertFalse(app.buttons["opendesign.day.header.previous"].exists)
        XCTAssertFalse(app.buttons["opendesign.day.header.next"].exists)
        XCTAssertFalse(elementWithIdentifier(in: app, "opendesign.day.hypothesis").exists)
        XCTAssertFalse(app.buttons["opendesign.day.mission.accept"].exists)
        XCTAssertFalse(app.buttons["opendesign.day.share"].exists)
        XCTAssertFalse(app.buttons["opendesign.day.meta.toggle"].exists)
        XCTAssertFalse(elementWithIdentifier(in: app, "opendesign.officeHours.export").exists)
        let officeHoursPanelToggle = app.buttons["opendesign.officeHours.panel"]
        XCTAssertTrue(officeHoursPanelToggle.exists)
        XCTAssertTrue(waitForButtonLabel(in: app, identifier: "opendesign.officeHours.panel", containing: "닫기", timeout: 2))
        assertOpenDesignResponsiveColumns(
            surface: workspaceSurface.frame,
            rail: rail.frame,
            tasks: sessions.frame,
            main: main.frame,
            meta: meta.frame,
            expectedRailWidth: 52,
            expectedTaskSidebarWidth: 240,
            expectedMetaPanelWidth: 280
        )
        let expandedOfficeHoursMainMaxX = main.frame.maxX

        clickCenter(of: officeHoursPanelToggle)
        XCTAssertTrue(waitForElementToDisappear(meta, timeout: 3))
        XCTAssertTrue(waitForButtonLabel(in: app, identifier: "opendesign.officeHours.panel", containing: "열기", timeout: 2))
        XCTAssertGreaterThanOrEqual(main.frame.maxX, expandedOfficeHoursMainMaxX + 280 - 24)

        clickCenter(of: officeHoursPanelToggle)
        XCTAssertTrue(waitForElementFrameWidth(meta, width: 280, timeout: 5))
        XCTAssertTrue(waitForButtonLabel(in: app, identifier: "opendesign.officeHours.panel", containing: "닫기", timeout: 2))
        assertOpenDesignResponsiveColumns(
            surface: workspaceSurface.frame,
            rail: rail.frame,
            tasks: sessions.frame,
            main: main.frame,
            meta: meta.frame,
            expectedRailWidth: 52,
            expectedTaskSidebarWidth: 240,
            expectedMetaPanelWidth: 280
        )

        let searchButton = elementWithIdentifier(in: app, "opendesign.officeHours.search")
        XCTAssertTrue(searchButton.exists)
        let shareButton = elementWithIdentifier(in: app, "opendesign.officeHours.share")
        XCTAssertTrue(shareButton.exists)
        XCTAssertLessThan(searchButton.frame.maxX, shareButton.frame.minX)
        XCTAssertLessThan(shareButton.frame.maxX, officeHoursPanelToggle.frame.minX)
        clickCenter(of: searchButton)
        let initialSearchPalette = elementWithIdentifier(in: app, "opendesign.day.searchPalette")
        XCTAssertTrue(initialSearchPalette.waitForExistence(timeout: 5))
        let searchField = elementWithIdentifier(in: app, "opendesign.day.searchField")
        XCTAssertTrue(searchField.waitForExistence(timeout: 3))
        clickCenter(of: searchField)
        searchField.typeText("day")
        let day1SearchResult = app.buttons["opendesign.day.search.result.task-day1"]
        let day2SearchResult = app.buttons["opendesign.day.search.result.task-day2"]
        XCTAssertTrue(day1SearchResult.waitForExistence(timeout: 3))
        XCTAssertTrue(day2SearchResult.waitForExistence(timeout: 3))
        XCTAssertTrue(element(day1SearchResult, contains: "active"))
        app.typeKey(XCUIKeyboardKey.downArrow, modifierFlags: [])
        XCTAssertTrue(waitForElementLabel(in: app, identifier: "opendesign.day.search.result.task-day2", containing: "active", timeout: 3))
        app.typeKey(XCUIKeyboardKey.upArrow, modifierFlags: [])
        XCTAssertTrue(waitForElementLabel(in: app, identifier: "opendesign.day.search.result.task-day1", containing: "active", timeout: 3))
        app.typeKey(.escape, modifierFlags: [])
        XCTAssertTrue(waitForElementToDisappear(elementWithIdentifier(in: app, "opendesign.day.searchPalette"), timeout: 3))

        clickCenter(of: searchButton)
        XCTAssertTrue(elementWithIdentifier(in: app, "opendesign.day.searchPalette").waitForExistence(timeout: 5))
        let reopenedSearchField = elementWithIdentifier(in: app, "opendesign.day.searchField")
        XCTAssertTrue(reopenedSearchField.waitForExistence(timeout: 3))
        clickCenter(of: reopenedSearchField)
        reopenedSearchField.typeText("3")
        let day3SearchResult = app.buttons["opendesign.day.search.result.task-day3"]
        if !day3SearchResult.waitForExistence(timeout: 3) {
            attachText(app.debugDescription, named: "OpenDesign Search Missing Day3 Tree")
            XCTFail("Expected Day 3 search result")
        }
        app.typeKey(.escape, modifierFlags: [])
        XCTAssertTrue(waitForElementToDisappear(elementWithIdentifier(in: app, "opendesign.day.searchPalette"), timeout: 3))

        clickCenter(of: main)
        app.typeText("/")
        XCTAssertTrue(elementWithIdentifier(in: app, "opendesign.day.searchPalette").waitForExistence(timeout: 5))
        let slashSearchField = elementWithIdentifier(in: app, "opendesign.day.searchField")
        XCTAssertTrue(slashSearchField.waitForExistence(timeout: 3))
        slashSearchField.typeText("1")
        XCTAssertTrue(day1SearchResult.waitForExistence(timeout: 3))
        app.typeKey(.escape, modifierFlags: [])
        XCTAssertTrue(waitForElementToDisappear(elementWithIdentifier(in: app, "opendesign.day.searchPalette"), timeout: 3))

        XCTAssertTrue(elementWithIdentifier(in: app, "opendesign.officeHours.main").waitForExistence(timeout: 5))
        XCTAssertTrue(elementWithIdentifier(in: app, "opendesign.officeHours.goal.card").waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["opendesign.officeHours.goal.option.make_money"].exists)
        XCTAssertTrue(app.buttons["opendesign.officeHours.goal.option.get_users"].exists)
        XCTAssertTrue(app.buttons["opendesign.officeHours.goal.option.build_product"].exists)
        XCTAssertTrue(waitForElementLabel(in: app, identifier: "opendesign.day.rail.item.today", containing: "active", timeout: 3))
        XCTAssertFalse(elementWithIdentifier(in: app, "opendesign.day.rail.item.office-hours").exists)
        XCTAssertFalse(app.buttons["opendesign.day.start"].exists)
        XCTAssertFalse(app.buttons["opendesign.day.icp.option.1"].exists)
        XCTAssertFalse(elementWithIdentifier(in: app, "opendesign.day.start.phase").exists)
    }

    @MainActor
    func testOpenDesignDayLegacyStartPhaseIsRemoved() throws {
        let runID = UUID().uuidString
        let workspacePath = "/tmp/agentic30-ui-opendesign-day-resume-\(runID)"
        let appSupportPath = "/tmp/agentic30-ui-opendesign-day-resume-app-\(runID)"
        resetDirectory(at: workspacePath)
        resetDirectory(at: appSupportPath)

        let app = launchApp(arguments: [
            "--ui-testing-reset-onboarding",
            "--ui-testing-seed-auth",
            "--ui-testing-seed-onboarding-context",
            "--ui-testing-seed-workspace=\(workspacePath)",
            "--ui-testing-seed-idd-complete",
            "--ui-testing-disable-sidecar",
            "--ui-testing-open-workspace",
            "--ui-testing-opaque-window",
            "--ui-testing-workspace-window-size=1360x835",
        ], environment: [
            "AGENTIC30_APP_SUPPORT_PATH": appSupportPath,
            "AGENTIC30_TEST_STUB_PROVIDER": "1",
        ])
        hideKnownInterferingApplications()
        app.activate()
        addTeardownBlock {
            app.terminate()
            self.unhideKnownInterferingApplications()
            self.removeDirectory(at: workspacePath)
            self.removeDirectory(at: appSupportPath)
        }

        XCTAssertTrue(elementWithIdentifier(in: app, "opendesign.day.shell").waitForExistence(timeout: 10))
        XCTAssertTrue(elementWithIdentifier(in: app, "opendesign.officeHours.main").waitForExistence(timeout: 5))
        XCTAssertTrue(elementWithIdentifier(in: app, "opendesign.officeHours.goal.card").waitForExistence(timeout: 5))
        XCTAssertFalse(elementWithIdentifier(in: app, "opendesign.day.start.title").exists)
        XCTAssertFalse(app.buttons["opendesign.day.start"].exists)
        XCTAssertFalse(app.buttons["opendesign.day.start.resume"].exists)
        XCTAssertFalse(app.buttons["opendesign.day.icp.option.1"].exists)
        XCTAssertFalse(elementWithIdentifier(in: app, "opendesign.day.start.phase").exists)
    }

    @MainActor
    func testOpenDesignDayTaskSearchRoutesToOfficeHours() throws {
        let runID = UUID().uuidString
        let workspacePath = "/tmp/agentic30-ui-opendesign-day-freeform-\(runID)"
        let appSupportPath = "/tmp/agentic30-ui-opendesign-day-freeform-app-\(runID)"
        resetDirectory(at: workspacePath)
        resetDirectory(at: appSupportPath)

        let app = launchApp(arguments: [
            "--ui-testing-reset-onboarding",
            "--ui-testing-seed-auth",
            "--ui-testing-seed-onboarding-context",
            "--ui-testing-seed-workspace=\(workspacePath)",
            "--ui-testing-seed-idd-complete",
            "--ui-testing-disable-sidecar",
            "--ui-testing-open-workspace",
            "--ui-testing-opaque-window",
            "--ui-testing-workspace-window-size=1360x820",
        ], environment: [
            "AGENTIC30_APP_SUPPORT_PATH": appSupportPath,
            "AGENTIC30_TEST_STUB_PROVIDER": "1",
        ])
        hideKnownInterferingApplications()
        app.activate()
        addTeardownBlock {
            app.terminate()
            self.unhideKnownInterferingApplications()
            self.removeDirectory(at: workspacePath)
            self.removeDirectory(at: appSupportPath)
        }

        XCTAssertTrue(elementWithIdentifier(in: app, "opendesign.day.shell").waitForExistence(timeout: 10))
        let searchButton = elementWithIdentifier(in: app, "opendesign.officeHours.search")
        XCTAssertTrue(searchButton.waitForExistence(timeout: 5))
        clickCenter(of: searchButton)
        let searchField = elementWithIdentifier(in: app, "opendesign.day.searchField")
        XCTAssertTrue(searchField.waitForExistence(timeout: 3))
        clickCenter(of: searchField)
        searchField.typeText("day")
        let day1SearchResult = app.buttons["opendesign.day.search.result.task-day1"]
        XCTAssertTrue(day1SearchResult.waitForExistence(timeout: 3))
        XCTAssertTrue(element(day1SearchResult, contains: "active"))
        app.typeKey(.return, modifierFlags: [])
        XCTAssertTrue(elementWithIdentifier(in: app, "opendesign.officeHours.main").waitForExistence(timeout: 5))
        XCTAssertTrue(elementWithIdentifier(in: app, "opendesign.officeHours.goal.card").waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["opendesign.day.start"].exists)
        XCTAssertFalse(app.buttons["opendesign.day.icp.option.1"].exists)
    }

    @MainActor
    func testOpenDesignDayRestoresCachedScanResultAfterRelaunch() throws {
        let runID = UUID().uuidString
        let workspacePath = "/tmp/agentic30-ui-day1-relaunch-workspace-\(runID)"
        let appSupportPath = "/tmp/agentic30-ui-day1-relaunch-app-support-\(runID)"
        resetDirectory(at: workspacePath)
        resetDirectory(at: appSupportPath)

        hideKnownInterferingApplications()
        addTeardownBlock {
            self.unhideKnownInterferingApplications()
            self.removeDirectory(at: workspacePath)
            self.removeDirectory(at: appSupportPath)
        }

        let environment = [
            "AGENTIC30_APP_SUPPORT_PATH": appSupportPath,
            "AGENTIC30_TEST_STUB_PROVIDER": "1",
        ]
        let firstLaunch = launchApp(arguments: [
            "--ui-testing-reset-onboarding",
            "--ui-testing-seed-auth",
            "--ui-testing-seed-onboarding-context",
            "--ui-testing-seed-workspace=\(workspacePath)",
            "--ui-testing-seed-idd-complete",
            "--ui-testing-disable-sidecar",
            "--ui-testing-open-workspace",
            "--ui-testing-opaque-window",
        ], environment: environment)
        addTeardownBlock {
            firstLaunch.terminate()
        }
        firstLaunch.activate()

        XCTAssertTrue(elementWithIdentifier(in: firstLaunch, "opendesign.day.shell").waitForExistence(timeout: 10))
        XCTAssertFalse(elementWithIdentifier(in: firstLaunch, "opendesign.day.planPreparing").exists)

        firstLaunch.terminate()
        waitForAgenticAppToExit(bundleIdentifier: "october-academy.agentic30", timeout: 3)

        let relaunched = launchApp(arguments: [
            "--ui-testing-seed-auth",
            "--ui-testing-seed-onboarding-context",
            "--ui-testing-seed-idd-complete",
            "--ui-testing-disable-sidecar",
            "--ui-testing-open-workspace",
            "--ui-testing-opaque-window",
        ], environment: environment)
        addTeardownBlock {
            relaunched.terminate()
        }
        relaunched.activate()

        let shell = elementWithIdentifier(in: relaunched, "opendesign.day.shell")
        if !shell.waitForExistence(timeout: 10) {
            attachScreenshot(from: relaunched, named: "OpenDesign Day Relaunch Shell Missing")
            attachText(relaunched.debugDescription, named: "OpenDesign Day Relaunch Tree")
        }
        XCTAssertTrue(shell.exists)
        XCTAssertFalse(elementWithIdentifier(in: relaunched, "opendesign.day.planPreparing").exists)
    }

    @MainActor
    func testOpenDesignRailShowsOnlyPrimaryItems() throws {
        let runID = UUID().uuidString
        let workspacePath = "/tmp/agentic30-ui-opendesign-reference-route-workspace-\(runID)"
        let appSupportPath = "/tmp/agentic30-ui-opendesign-reference-route-support-\(runID)"
        resetDirectory(at: workspacePath)
        resetDirectory(at: appSupportPath)

        let app = launchApp(arguments: [
            "--ui-testing-reset-onboarding",
            "--ui-testing-seed-auth",
            "--ui-testing-seed-onboarding-context",
            "--ui-testing-seed-workspace=\(workspacePath)",
            "--ui-testing-seed-idd-complete",
            "--ui-testing-disable-sidecar",
            "--ui-testing-open-workspace",
            "--ui-testing-opaque-window",
            "--ui-testing-workspace-window-size=1360x820",
        ], environment: [
            "AGENTIC30_APP_SUPPORT_PATH": appSupportPath,
            "AGENTIC30_TEST_STUB_PROVIDER": "1",
        ])
        hideKnownInterferingApplications()
        app.activate()
        addTeardownBlock {
            app.terminate()
            self.unhideKnownInterferingApplications()
            self.removeDirectory(at: workspacePath)
            self.removeDirectory(at: appSupportPath)
        }

        let openDesignShell = elementWithIdentifier(in: app, "opendesign.day.shell")
        if !openDesignShell.waitForExistence(timeout: 10) {
            attachScreenshot(from: app, named: "OpenDesign Reference Route Shell Missing")
            attachText(app.debugDescription, named: "OpenDesign Reference Route Shell Missing Tree")
        }
        XCTAssertTrue(openDesignShell.exists)

        for railID in ["today", "settings"] {
            let railItemID = "opendesign.day.rail.item.\(railID)"
            XCTAssertTrue(elementWithIdentifier(in: app, railItemID).waitForExistence(timeout: 3))
        }

        for hiddenRailID in ["office-hours", "search", "projects", "interviews", "bip", "news", "history"] {
            XCTAssertFalse(elementWithIdentifier(in: app, "opendesign.day.rail.item.\(hiddenRailID)").exists)
        }

        XCTAssertTrue(waitForElementLabel(in: app, identifier: "opendesign.day.rail.item.today", containing: "active", timeout: 3))
    }

    @MainActor
    func testOpenDesignHistoryPrioritizesRetrospectiveAndKeepsEvidenceTimelineCollapsed() throws {
        let runID = UUID().uuidString
        let workspacePath = "/tmp/agentic30-ui-opendesign-history-workspace-\(runID)"
        let appSupportPath = "/tmp/agentic30-ui-opendesign-history-support-\(runID)"
        resetDirectory(at: workspacePath)
        resetDirectory(at: appSupportPath)

        let app = launchApp(arguments: [
            "--ui-testing-reset-onboarding",
            "--ui-testing-seed-auth",
            "--ui-testing-seed-onboarding-context",
            "--ui-testing-seed-workspace=\(workspacePath)",
            "--ui-testing-seed-idd-complete",
            "--ui-testing-disable-sidecar",
            "--ui-testing-open-workspace",
            "--ui-testing-opaque-window",
            "--ui-testing-workspace-window-size=1360x820",
            "--ui-testing-open-design-reference-page=history",
            "--ui-testing-stub-work-history-events",
        ], environment: [
            "AGENTIC30_APP_SUPPORT_PATH": appSupportPath,
            "AGENTIC30_TEST_STUB_PROVIDER": "1",
        ])
        hideKnownInterferingApplications()
        app.activate()
        addTeardownBlock {
            app.terminate()
            self.unhideKnownInterferingApplications()
            self.removeDirectory(at: workspacePath)
            self.removeDirectory(at: appSupportPath)
        }

        let openDesignShell = elementWithIdentifier(in: app, "opendesign.day.shell")
        if !openDesignShell.waitForExistence(timeout: 10) {
            attachScreenshot(from: app, named: "OpenDesign History Shell Missing")
            attachText(app.debugDescription, named: "OpenDesign History Shell Missing Tree")
        }
        XCTAssertTrue(openDesignShell.exists)

        let main = elementWithIdentifier(in: app, "opendesign.reference.history.main")
        let retrospective = elementWithIdentifier(in: app, "opendesign.reference.history.retrospective")
        let evidenceTimeline = elementWithIdentifier(in: app, "opendesign.reference.history.evidenceTimeline")
        if !retrospective.waitForExistence(timeout: 5) || !evidenceTimeline.exists {
            attachScreenshot(from: app, named: "OpenDesign History Retrospective Missing")
            attachText(app.debugDescription, named: "OpenDesign History Retrospective Missing Tree")
        }
        XCTAssertTrue(main.exists)
        XCTAssertTrue(retrospective.exists)
        XCTAssertTrue(evidenceTimeline.exists)
        XCTAssertTrue(app.staticTexts["이번 주 판단"].exists)
        XCTAssertTrue(app.staticTexts["핵심 인사이트"].exists)
        XCTAssertTrue(app.staticTexts["다음 행동"].exists)
        XCTAssertLessThan(retrospective.frame.minY, evidenceTimeline.frame.minY)
        XCTAssertLessThanOrEqual(
            retrospective.frame.maxY,
            evidenceTimeline.frame.minY + 2,
            "History retrospective card must render above the evidence timeline without overlap"
        )

        let weeklyEvidence = elementWithIdentifier(in: app, "opendesign.reference.history.weekly")
        XCTAssertFalse(weeklyEvidence.exists)
        clickCenter(of: evidenceTimeline)
        if !weeklyEvidence.waitForExistence(timeout: 3) {
            attachScreenshot(from: app, named: "OpenDesign History Evidence Timeline Collapsed")
            attachText(app.debugDescription, named: "OpenDesign History Evidence Timeline Tree")
        }
        XCTAssertTrue(weeklyEvidence.exists)

        let metaToggle = app.buttons["opendesign.reference.meta.toggle"]
        XCTAssertTrue(metaToggle.exists)
        clickCenter(of: metaToggle)
        XCTAssertTrue(elementWithIdentifier(in: app, "opendesign.reference.history.meta").waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["근거 커버리지"].waitForExistence(timeout: 3))
        XCTAssertTrue(app.staticTexts["프롬프트 원문은 연결 근거로만 사용하고 화면·저장본에는 남기지 않아요."].waitForExistence(timeout: 3))
    }

    @MainActor
    func testOpenDesignNewsSearchRouteOpensHiddenRailPage() throws {
        let runID = UUID().uuidString
        let workspacePath = "/tmp/agentic30-ui-opendesign-news-route-workspace-\(runID)"
        let appSupportPath = "/tmp/agentic30-ui-opendesign-news-route-support-\(runID)"
        resetDirectory(at: workspacePath)
        resetDirectory(at: appSupportPath)

        let app = launchApp(arguments: [
            "--ui-testing-reset-onboarding",
            "--ui-testing-seed-auth",
            "--ui-testing-seed-onboarding-context",
            "--ui-testing-seed-workspace=\(workspacePath)",
            "--ui-testing-seed-idd-complete",
            "--ui-testing-disable-sidecar",
            "--ui-testing-open-workspace",
            "--ui-testing-opaque-window",
            "--ui-testing-workspace-window-size=1360x820",
            "--ui-testing-open-design-reference-page=news",
            "--ui-testing-stub-news-market-radar-events",
        ], environment: [
            "AGENTIC30_APP_SUPPORT_PATH": appSupportPath,
            "AGENTIC30_TEST_STUB_PROVIDER": "1",
        ])
        hideKnownInterferingApplications()
        app.activate()
        addTeardownBlock {
            app.terminate()
            self.unhideKnownInterferingApplications()
            self.removeDirectory(at: workspacePath)
            self.removeDirectory(at: appSupportPath)
        }

        let openDesignShell = elementWithIdentifier(in: app, "opendesign.day.shell")
        if !openDesignShell.waitForExistence(timeout: 10) {
            attachScreenshot(from: app, named: "OpenDesign News Route Shell Missing")
            attachText(app.debugDescription, named: "OpenDesign News Route Shell Missing Tree")
        }
        XCTAssertTrue(openDesignShell.exists)

        XCTAssertFalse(elementWithIdentifier(in: app, "opendesign.day.rail.item.news").exists)
        XCTAssertTrue(elementWithIdentifier(in: app, "opendesign.reference.news.main").waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["UI 테스트 리서치 결과"].waitForExistence(timeout: 5))
        XCTAssertTrue(elementWithIdentifier(in: app, "opendesign.reference.news.main").exists)
    }

    @MainActor
    func testOpenDesignNewsPageParitySmoke() throws {
        let runID = UUID().uuidString
        let workspacePath = "/tmp/agentic30-ui-opendesign-news-workspace-\(runID)"
        let appSupportPath = "/tmp/agentic30-ui-opendesign-news-app-support-\(runID)"
        resetDirectory(at: workspacePath)
        resetDirectory(at: appSupportPath)

        let app = launchApp(arguments: [
            "--ui-testing-reset-onboarding",
            "--ui-testing-seed-auth",
            "--ui-testing-seed-onboarding-context",
            "--ui-testing-seed-workspace=\(workspacePath)",
            "--ui-testing-seed-idd-complete",
            "--ui-testing-disable-sidecar",
            "--ui-testing-open-workspace",
            "--ui-testing-opaque-window",
            "--ui-testing-workspace-window-size=1360x820",
            "--ui-testing-open-design-reference-page=news",
            "--ui-testing-stub-news-market-radar-events",
        ], environment: [
            "AGENTIC30_APP_SUPPORT_PATH": appSupportPath,
            "AGENTIC30_TEST_STUB_PROVIDER": "1",
        ])
        hideKnownInterferingApplications()
        app.activate()
        addTeardownBlock {
            app.terminate()
            self.unhideKnownInterferingApplications()
            self.removeDirectory(at: workspacePath)
            self.removeDirectory(at: appSupportPath)
        }

        let openDesignShell = elementWithIdentifier(in: app, "opendesign.day.shell")
        if !openDesignShell.waitForExistence(timeout: 10) {
            attachScreenshot(from: app, named: "OpenDesign News Shell Missing")
            attachText(app.debugDescription, named: "OpenDesign News Shell Missing Tree")
        }
        XCTAssertTrue(openDesignShell.exists)

        let workspaceSurface = elementWithIdentifier(in: app, "workspace.surface")
        XCTAssertTrue(waitForOpenDesignSurfaceWidth(workspaceSurface, width: 1360, timeout: 5))
        let rail = elementWithIdentifier(in: app, "opendesign.day.rail")
        XCTAssertTrue(rail.exists)

        let side = elementWithIdentifier(in: app, "opendesign.reference.news.side")
        let main = elementWithIdentifier(in: app, "opendesign.reference.news.main")
        let meta = elementWithIdentifier(in: app, "opendesign.reference.news.meta")
        if !main.waitForExistence(timeout: 5) || !side.exists {
            attachScreenshot(from: app, named: "OpenDesign News Wide Missing")
            attachText(app.debugDescription, named: "OpenDesign News Wide Missing Tree")
        }
        XCTAssertTrue(side.exists)
        XCTAssertTrue(main.exists)
        XCTAssertFalse(meta.exists)
        assertOpenDesignResponsiveColumns(
            surface: workspaceSurface.frame,
            rail: rail.frame,
            tasks: side.frame,
            main: main.frame,
            meta: nil,
            expectedRailWidth: 52,
            expectedTaskSidebarWidth: 240,
            expectedMetaPanelWidth: nil
        )

        let metaToggle = app.buttons["opendesign.reference.meta.toggle"]
        XCTAssertTrue(metaToggle.exists)
        XCTAssertTrue(waitForButtonLabel(in: app, identifier: "opendesign.reference.meta.toggle", containing: "열기", timeout: 2))
        clickCenter(of: metaToggle)
        XCTAssertTrue(waitForElementFrameWidth(meta, width: 280, timeout: 5))
        XCTAssertTrue(waitForButtonLabel(in: app, identifier: "opendesign.reference.meta.toggle", containing: "닫기", timeout: 2))

        attachScreenshot(from: app, named: "OpenDesign News Wide")
        assertOpenDesignWideColumns(surface: workspaceSurface.frame, tasks: side.frame, main: main.frame, meta: meta.frame)
    }

    @MainActor
    func testOpenDesignBipLogPageParitySmoke() throws {
        let runID = UUID().uuidString
        let workspacePath = "/tmp/agentic30-ui-opendesign-bip-workspace-\(runID)"
        let appSupportPath = "/tmp/agentic30-ui-opendesign-bip-app-support-\(runID)"
        resetDirectory(at: workspacePath)
        resetDirectory(at: appSupportPath)

        let app = launchApp(arguments: [
            "--ui-testing-reset-onboarding",
            "--ui-testing-seed-auth",
            "--ui-testing-seed-onboarding-context",
            "--ui-testing-seed-workspace=\(workspacePath)",
            "--ui-testing-seed-idd-complete",
            "--ui-testing-disable-sidecar",
            "--ui-testing-open-workspace",
            "--ui-testing-opaque-window",
            "--ui-testing-workspace-window-size=1360x820",
            "--ui-testing-open-design-reference-page=bip",
            "--ui-testing-stub-bip-research-events",
        ], environment: [
            "AGENTIC30_APP_SUPPORT_PATH": appSupportPath,
            "AGENTIC30_TEST_STUB_PROVIDER": "1",
        ])
        hideKnownInterferingApplications()
        app.activate()
        addTeardownBlock {
            app.terminate()
            self.unhideKnownInterferingApplications()
            self.removeDirectory(at: workspacePath)
            self.removeDirectory(at: appSupportPath)
        }

        let openDesignShell = elementWithIdentifier(in: app, "opendesign.day.shell")
        if !openDesignShell.waitForExistence(timeout: 10) {
            attachScreenshot(from: app, named: "OpenDesign BIP Shell Missing")
            attachText(app.debugDescription, named: "OpenDesign BIP Shell Missing Tree")
        }
        XCTAssertTrue(openDesignShell.exists)

        let workspaceSurface = elementWithIdentifier(in: app, "workspace.surface")
        XCTAssertTrue(waitForOpenDesignSurfaceWidth(workspaceSurface, width: 1360, timeout: 5))

        let side = elementWithIdentifier(in: app, "opendesign.reference.bipLog.side")
        let main = elementWithIdentifier(in: app, "opendesign.reference.bipLog.main")
        let brief = elementWithIdentifier(in: app, "opendesign.reference.bipLog.brief")
        let firstCandidate = elementWithIdentifier(in: app, "opendesign.reference.bipLog.candidate.speakmac")
        if !main.waitForExistence(timeout: 5) || !side.exists || !brief.exists || !firstCandidate.exists {
            attachScreenshot(from: app, named: "OpenDesign BIP Wide Missing")
            attachText(app.debugDescription, named: "OpenDesign BIP Wide Missing Tree")
        }
        XCTAssertTrue(side.exists)
        XCTAssertTrue(main.exists)
        XCTAssertTrue(brief.exists)
        XCTAssertTrue(firstCandidate.exists)
        XCTAssertFalse(elementWithIdentifier(in: app, "opendesign.reference.bipLog.meta").exists)

        attachScreenshot(from: app, named: "OpenDesign BIP Wide")
        assertOpenDesignBipLogWideColumns(surface: workspaceSurface.frame, side: side.frame, main: main.frame)

        let selectSpeakmac = app.buttons["opendesign.reference.bipLog.candidate.speakmac.select"]
        let draft = elementWithIdentifier(in: app, "opendesign.reference.bipLog.draft")
        if !selectSpeakmac.exists || !draft.exists {
            attachText(app.debugDescription, named: "OpenDesign BIP Actions Missing Tree")
        }
        XCTAssertTrue(selectSpeakmac.exists)
        XCTAssertTrue(draft.exists)
    }

    @MainActor
    func testOpenDesignInterviewsPageParitySmoke() throws {
        let runID = UUID().uuidString
        let workspacePath = "/tmp/agentic30-ui-opendesign-interviews-workspace-\(runID)"
        let appSupportPath = "/tmp/agentic30-ui-opendesign-interviews-app-support-\(runID)"
        resetDirectory(at: workspacePath)
        resetDirectory(at: appSupportPath)

        let app = launchApp(arguments: [
            "--ui-testing-reset-onboarding",
            "--ui-testing-seed-auth",
            "--ui-testing-seed-onboarding-context",
            "--ui-testing-seed-workspace=\(workspacePath)",
            "--ui-testing-seed-idd-complete",
            "--ui-testing-disable-sidecar",
            "--ui-testing-open-workspace",
            "--ui-testing-opaque-window",
            "--ui-testing-workspace-window-size=1360x820",
            "--ui-testing-open-design-reference-page=interviews",
        ], environment: [
            "AGENTIC30_APP_SUPPORT_PATH": appSupportPath,
            "AGENTIC30_TEST_STUB_PROVIDER": "1",
        ])
        hideKnownInterferingApplications()
        app.activate()
        addTeardownBlock {
            app.terminate()
            self.unhideKnownInterferingApplications()
            self.removeDirectory(at: workspacePath)
            self.removeDirectory(at: appSupportPath)
        }

        let openDesignShell = elementWithIdentifier(in: app, "opendesign.day.shell")
        if !openDesignShell.waitForExistence(timeout: 10) {
            attachScreenshot(from: app, named: "OpenDesign Interviews Shell Missing")
            attachText(app.debugDescription, named: "OpenDesign Interviews Shell Missing Tree")
        }
        XCTAssertTrue(openDesignShell.exists)

        let workspaceSurface = elementWithIdentifier(in: app, "workspace.surface")
        XCTAssertTrue(waitForOpenDesignSurfaceWidth(workspaceSurface, width: 1360, timeout: 5))
        let rail = elementWithIdentifier(in: app, "opendesign.day.rail")
        XCTAssertTrue(rail.exists)

        let side = elementWithIdentifier(in: app, "opendesign.reference.interviews.side")
        let main = elementWithIdentifier(in: app, "opendesign.reference.interviews.main")
        let meta = elementWithIdentifier(in: app, "opendesign.reference.interviews.meta")
        if !main.waitForExistence(timeout: 5) || !side.exists {
            attachScreenshot(from: app, named: "OpenDesign Interviews Wide Missing")
            attachText(app.debugDescription, named: "OpenDesign Interviews Wide Missing Tree")
        }
        XCTAssertTrue(side.exists)
        XCTAssertTrue(main.exists)
        XCTAssertFalse(meta.exists)
        assertOpenDesignResponsiveColumns(
            surface: workspaceSurface.frame,
            rail: rail.frame,
            tasks: side.frame,
            main: main.frame,
            meta: nil,
            expectedRailWidth: 52,
            expectedTaskSidebarWidth: 240,
            expectedMetaPanelWidth: nil
        )

        let metaToggle = app.buttons["opendesign.reference.meta.toggle"]
        XCTAssertTrue(metaToggle.exists)
        XCTAssertTrue(waitForButtonLabel(in: app, identifier: "opendesign.reference.meta.toggle", containing: "열기", timeout: 2))
        clickCenter(of: metaToggle)
        XCTAssertTrue(waitForElementFrameWidth(meta, width: 280, timeout: 5))
        XCTAssertTrue(waitForButtonLabel(in: app, identifier: "opendesign.reference.meta.toggle", containing: "닫기", timeout: 2))
        XCTAssertTrue(app.staticTexts["장지창"].exists)
        XCTAssertTrue(app.staticTexts["전 직장 동료"].exists)
        XCTAssertTrue(app.staticTexts["추출 신호"].exists)
        XCTAssertTrue(app.staticTexts["진행 상황"].exists)

        attachScreenshot(from: app, named: "OpenDesign Interviews Wide")
        assertOpenDesignWideColumns(surface: workspaceSurface.frame, tasks: side.frame, main: main.frame, meta: meta.frame)
    }

    @MainActor
    func testOpenDesignProjectsPageParitySmoke() throws {
        let runID = UUID().uuidString
        let workspacePath = "/tmp/agentic30-ui-opendesign-projects-workspace-\(runID)"
        let appSupportPath = "/tmp/agentic30-ui-opendesign-projects-app-support-\(runID)"
        resetDirectory(at: workspacePath)
        resetDirectory(at: appSupportPath)

        let app = launchApp(arguments: [
            "--ui-testing-reset-onboarding",
            "--ui-testing-seed-auth",
            "--ui-testing-seed-onboarding-context",
            "--ui-testing-seed-workspace=\(workspacePath)",
            "--ui-testing-seed-idd-complete",
            "--ui-testing-disable-sidecar",
            "--ui-testing-open-workspace",
            "--ui-testing-opaque-window",
            "--ui-testing-workspace-window-size=1360x820",
            "--ui-testing-open-design-reference-page=projects",
        ], environment: [
            "AGENTIC30_APP_SUPPORT_PATH": appSupportPath,
            "AGENTIC30_TEST_STUB_PROVIDER": "1",
        ])
        hideKnownInterferingApplications()
        app.activate()
        addTeardownBlock {
            app.terminate()
            self.unhideKnownInterferingApplications()
            self.removeDirectory(at: workspacePath)
            self.removeDirectory(at: appSupportPath)
        }

        let openDesignShell = elementWithIdentifier(in: app, "opendesign.day.shell")
        if !openDesignShell.waitForExistence(timeout: 10) {
            attachScreenshot(from: app, named: "OpenDesign Projects Shell Missing")
            attachText(app.debugDescription, named: "OpenDesign Projects Shell Missing Tree")
        }
        XCTAssertTrue(openDesignShell.exists)

        let workspaceSurface = elementWithIdentifier(in: app, "workspace.surface")
        XCTAssertTrue(waitForOpenDesignSurfaceWidth(workspaceSurface, width: 1360, timeout: 5))
        let rail = elementWithIdentifier(in: app, "opendesign.day.rail")
        XCTAssertTrue(rail.exists)

        let side = elementWithIdentifier(in: app, "opendesign.reference.projects.side")
        let main = elementWithIdentifier(in: app, "opendesign.reference.projects.main")
        let meta = elementWithIdentifier(in: app, "opendesign.reference.projects.meta")
        let overview = elementWithIdentifier(in: app, "opendesign.reference.projects.overview.card")
        if !main.waitForExistence(timeout: 5) || !side.exists || !overview.exists {
            attachScreenshot(from: app, named: "OpenDesign Projects Wide Missing")
            attachText(app.debugDescription, named: "OpenDesign Projects Wide Missing Tree")
        }
        XCTAssertTrue(side.exists)
        XCTAssertTrue(main.exists)
        XCTAssertFalse(meta.exists)
        XCTAssertTrue(overview.exists)
        assertOpenDesignResponsiveColumns(
            surface: workspaceSurface.frame,
            rail: rail.frame,
            tasks: side.frame,
            main: main.frame,
            meta: nil,
            expectedRailWidth: 52,
            expectedTaskSidebarWidth: 240,
            expectedMetaPanelWidth: nil
        )

        let metaToggle = app.buttons["opendesign.reference.meta.toggle"]
        XCTAssertTrue(metaToggle.exists)
        XCTAssertTrue(waitForButtonLabel(in: app, identifier: "opendesign.reference.meta.toggle", containing: "열기", timeout: 2))
        clickCenter(of: metaToggle)
        XCTAssertTrue(waitForElementFrameWidth(meta, width: 280, timeout: 5))
        XCTAssertTrue(waitForButtonLabel(in: app, identifier: "opendesign.reference.meta.toggle", containing: "닫기", timeout: 2))

        attachScreenshot(from: app, named: "OpenDesign Projects Wide")
        let tolerance: CGFloat = 2.0
        XCTAssertEqual(side.frame.minX - workspaceSurface.frame.minX, 52, accuracy: tolerance, "Projects shell should preserve projects.html 52px rail width")
        XCTAssertEqual(side.frame.width, 240, accuracy: tolerance, "Projects sidebar should preserve projects.html 240px width")
        XCTAssertEqual(meta.frame.width, 280, accuracy: tolerance, "Projects meta panel should preserve projects.html 280px width")
        XCTAssertEqual(side.frame.maxX, main.frame.minX, accuracy: tolerance, "Projects sidebar and main content should share a boundary")
        XCTAssertEqual(main.frame.maxX, meta.frame.minX, accuracy: tolerance, "Projects main content and meta panel should share a boundary")
    }

    @MainActor
    func testOpenDesignDayHandoffFlowSmoke() throws {
        let runID = UUID().uuidString
        let workspacePath = "/tmp/agentic30-ui-opendesign-day-handoff-\(runID)"
        let appSupportPath = "/tmp/agentic30-ui-opendesign-day-handoff-support-\(runID)"
        resetDirectory(at: workspacePath)
        resetDirectory(at: appSupportPath)

        let app = launchApp(arguments: [
            "--ui-testing-reset-onboarding",
            "--ui-testing-seed-auth",
            "--ui-testing-seed-onboarding-context",
            "--ui-testing-seed-workspace=\(workspacePath)",
            "--ui-testing-seed-office-hours-structured-prompt",
            "--ui-testing-disable-sidecar",
            "--ui-testing-open-workspace",
            "--ui-testing-opaque-window",
            "--ui-testing-workspace-window-size=1360x820",
        ], environment: [
            "AGENTIC30_APP_SUPPORT_PATH": appSupportPath,
            "AGENTIC30_TEST_STUB_PROVIDER": "1",
        ])
        hideKnownInterferingApplications()
        app.activate()
        addTeardownBlock {
            app.terminate()
            self.unhideKnownInterferingApplications()
            self.removeDirectory(at: workspacePath)
            self.removeDirectory(at: appSupportPath)
        }

        XCTAssertTrue(elementWithIdentifier(in: app, "opendesign.day.shell").waitForExistence(timeout: 10))
        XCTAssertFalse(elementWithIdentifier(in: app, "opendesign.officeHours.realProjectTest").exists)
        let day2Main = elementWithIdentifier(in: app, "opendesign.day2.main")
        XCTAssertFalse(day2Main.exists)
        XCTAssertFalse(app.buttons["opendesign.day.start"].exists)
        XCTAssertFalse(app.buttons["opendesign.day.icp.option.1"].exists)

        let officeHoursMain = elementWithIdentifier(in: app, "opendesign.officeHours.main")
        XCTAssertTrue(officeHoursMain.waitForExistence(timeout: 5))
        let officeHoursSessions = elementWithIdentifier(in: app, "opendesign.officeHours.sessions")
        let officeHoursMeta = elementWithIdentifier(in: app, "opendesign.officeHours.meta")
        XCTAssertTrue(officeHoursSessions.waitForExistence(timeout: 5))
        XCTAssertTrue(officeHoursMeta.waitForExistence(timeout: 5))
        XCTAssertEqual(officeHoursSessions.frame.width, 240, accuracy: 2)
        XCTAssertEqual(officeHoursMeta.frame.width, 280, accuracy: 2)
        XCTAssertEqual(officeHoursSessions.frame.maxX, officeHoursMain.frame.minX, accuracy: 2)
        XCTAssertEqual(officeHoursMain.frame.maxX, officeHoursMeta.frame.minX, accuracy: 2)
        confirmDay1GoalIfPresent(in: app)
        let structuredPrompt = elementWithIdentifier(in: app, "assistant.structuredPrompt")
        XCTAssertTrue(structuredPrompt.waitForExistence(timeout: 5))
        XCTAssertTrue(elementWithIdentifier(in: app, "opendesign.officeHours.intro.title").waitForExistence(timeout: 5))
        XCTAssertTrue(elementWithIdentifier(in: app, "opendesign.officeHours.context").waitForExistence(timeout: 5))
        let structuredContinue = app.buttons["assistant.structuredContinueButton"]
        XCTAssertTrue(structuredContinue.waitForExistence(timeout: 5))
        XCTAssertTrue(waitForElementLabel(in: app, identifier: "assistant.structuredContinueButton", containing: "Incomplete", timeout: 3))
        movePointerAwayFromContent()
        attachWindowScreenshot(from: app, named: "Office Hours SwiftUI Q1 Active")
        let structuredChoice = app.buttons["assistant.structuredChoice.office_hours_demand_evidence.돈을 냈거나 제안함"]
        XCTAssertTrue(scrollElementToVisible(
            structuredChoice,
            in: app,
            timeout: 5,
            scrollViewIdentifier: "opendesign.officeHours.main.scroll"
        ))
        clickCenter(of: structuredChoice)
        // Selecting a choice no longer auto-submits — the explicit submit button
        // must turn Ready and be clicked for the answer to go out.
        XCTAssertTrue(waitForElementLabel(in: app, identifier: "assistant.structuredContinueButton", containing: "Ready", timeout: 3))
        if !structuredContinue.isHittable {
            XCTAssertTrue(scrollElementToVisible(
                structuredContinue,
                in: app,
                timeout: 4,
                scrollViewIdentifier: "opendesign.officeHours.main.scroll"
            ))
        }
        clickCenter(of: structuredContinue)
        let submittedLoader = elementWithIdentifier(in: app, "opendesign.officeHours.questionLoader")
        XCTAssertTrue(submittedLoader.waitForExistence(timeout: 2))
        XCTAssertTrue(waitForElementLabel(in: app, identifier: "opendesign.officeHours.runState", containing: "다음 질문 생성 중", timeout: 3))
        attachWindowScreenshot(from: app, named: "Office Hours SwiftUI Q1 Locked Loader")
        let submittedPrompt = elementWithIdentifier(in: app, "opendesign.officeHours.submittedPrompt.ui-test-office-hours-request")
        XCTAssertTrue(submittedPrompt.waitForExistence(timeout: 5))
        let submittedChoice = elementWithIdentifier(in: app, "opendesign.officeHours.submittedChoice.office_hours_demand_evidence.돈을 냈거나 제안함")
        XCTAssertTrue(submittedChoice.waitForExistence(timeout: 5))
        XCTAssertTrue(waitForElementLabel(in: app, identifier: "opendesign.officeHours.submittedChoice.office_hours_demand_evidence.돈을 냈거나 제안함", containing: "제출됨", timeout: 3))
        movePointerAwayFromContent()
        attachWindowScreenshot(from: app, named: "Office Hours SwiftUI Q1 Locked Awaiting Q2")
        let nextStructuredChoice = app.buttons["assistant.structuredChoice.office_hours_status_quo.스프레드시트와 메신저"]
        XCTAssertTrue(nextStructuredChoice.waitForExistence(timeout: 5))
        XCTAssertTrue(waitForElementLabel(in: app, identifier: "opendesign.officeHours.runState", containing: "/office-hours 실행 중", timeout: 3))
        movePointerAwayFromContent()
        attachWindowScreenshot(from: app, named: "Office Hours SwiftUI Q1 Submitted Q2 Active")
        XCTAssertTrue(waitUntilHittable(nextStructuredChoice, timeout: 5))
        let remainingOfficeHoursChoices = [
            ("office_hours_status_quo", "스프레드시트와 메신저", "ui-test-office-hours-request-2"),
            ("office_hours_human", "이름과 회사까지 안다", "ui-test-office-hours-request-3"),
            ("office_hours_wedge", "유료 첫 테스트 1건", "ui-test-office-hours-request-4"),
            ("office_hours_observation", "직접 관찰했다", "ui-test-office-hours-request-5"),
            ("office_hours_future_fit", "더 필수적이다", "ui-test-office-hours-request-6"),
        ]
        for (questionId, label, requestId) in remainingOfficeHoursChoices {
            let choice = app.buttons["assistant.structuredChoice.\(questionId).\(label)"]
            XCTAssertTrue(choice.waitForExistence(timeout: 8))
            RunLoop.current.run(until: Date().addingTimeInterval(0.7))
            if !choice.isHittable {
                XCTAssertTrue(scrollElementToVisible(
                    choice,
                    in: app,
                    timeout: 4,
                    scrollViewIdentifier: "opendesign.officeHours.main.scroll"
                ))
            }
            clickCenter(of: choice)
            // Same two-step contract as Q1: choose, then press the submit button.
            let continueButton = app.buttons["assistant.structuredContinueButton"]
            XCTAssertTrue(continueButton.waitForExistence(timeout: 5))
            XCTAssertTrue(waitForElementLabel(in: app, identifier: "assistant.structuredContinueButton", containing: "Ready", timeout: 3))
            if !continueButton.isHittable {
                XCTAssertTrue(scrollElementToVisible(
                    continueButton,
                    in: app,
                    timeout: 4,
                    scrollViewIdentifier: "opendesign.officeHours.main.scroll"
                ))
            }
            clickCenter(of: continueButton)
            let lockedCard = elementWithIdentifier(in: app, "opendesign.officeHours.submittedPrompt.\(requestId)")
            XCTAssertTrue(lockedCard.waitForExistence(timeout: 8))
            XCTAssertTrue(waitForElementLabel(in: app, identifier: "opendesign.officeHours.submittedChoice.\(questionId).\(label)", containing: "제출됨", timeout: 3))
        }
        let officeHoursDocReady = elementWithIdentifier(in: app, "opendesign.officeHours.docReady")
        XCTAssertTrue(officeHoursDocReady.waitForExistence(timeout: 8))
        XCTAssertTrue(waitForElementLabel(in: app, identifier: "opendesign.officeHours.bridgeStatus", containing: "doc ready", timeout: 3))
        XCTAssertTrue(elementWithIdentifier(in: app, "opendesign.officeHours.docHandoff").waitForExistence(timeout: 5))
        let docConfirm = app.buttons["opendesign.officeHours.docHandoff.confirm"]
        XCTAssertTrue(scrollElementToVisible(
            docConfirm,
            in: app,
            timeout: 5,
            scrollViewIdentifier: "opendesign.officeHours.main.scroll"
        ))
        XCTAssertTrue(waitForButtonLabel(in: app, identifier: "opendesign.officeHours.docHandoff.confirm", containing: "4개 문서 저장", timeout: 3))
        clickCenter(of: docConfirm)
        XCTAssertTrue(waitForButtonLabel(in: app, identifier: "opendesign.officeHours.docHandoff.confirm", containing: "문서 저장 중", timeout: 3))
        for docType in ["goal", "icp", "values", "spec"] {
            let didSave = waitForElementLabel(
                in: app,
                identifier: "opendesign.officeHours.docHandoff.doc.\(docType)",
                containing: "저장됨",
                timeout: 12
            )
            guard didSave else {
                let row = elementWithIdentifier(in: app, "opendesign.officeHours.docHandoff.doc.\(docType)")
                XCTFail("\(docType) row label=\(row.label); value=\(String(describing: row.value)); confirm=\(docConfirm.label)")
                return
            }
        }
        XCTAssertTrue(waitForButtonLabel(in: app, identifier: "opendesign.officeHours.docHandoff.confirm", containing: "Day 1 완료", timeout: 3))
        RunLoop.current.run(until: Date().addingTimeInterval(1.0))
        attachWindowScreenshot(from: app, named: "Office Hours SwiftUI Final Doc")
        clickCenter(of: docConfirm)
        if !day2Main.waitForExistence(timeout: 5) {
            attachScreenshot(from: app, named: "OpenDesign Day2 Missing After Office Hours Completion")
            attachText(app.debugDescription, named: "OpenDesign Day2 Missing Tree")
        }
        XCTAssertTrue(day2Main.exists)
        XCTAssertTrue(app.staticTexts["시장 신호 읽기"].waitForExistence(timeout: 3))
        XCTAssertTrue(waitForElementLabel(in: app, identifier: "opendesign.day.task.day1", containing: "done", timeout: 3))
        XCTAssertTrue(waitForElementLabel(in: app, identifier: "opendesign.day.task.day2", containing: "active", timeout: 3))

        let day2Meta = elementWithIdentifier(in: app, "opendesign.day2.meta")
        let day2MetaToggle = app.buttons["opendesign.day2.meta.toggle"]
        XCTAssertFalse(day2Meta.exists)
        XCTAssertTrue(day2MetaToggle.exists)
        XCTAssertTrue(waitForButtonLabel(in: app, identifier: "opendesign.day2.meta.toggle", containing: "열기", timeout: 2))
        clickCenter(of: day2MetaToggle)
        XCTAssertTrue(waitForElementFrameWidth(day2Meta, width: 280, timeout: 5))
        XCTAssertTrue(waitForButtonLabel(in: app, identifier: "opendesign.day2.meta.toggle", containing: "닫기", timeout: 2))
        clickCenter(of: day2MetaToggle)
        XCTAssertTrue(waitForElementToDisappear(day2Meta, timeout: 3))
        XCTAssertTrue(waitForButtonLabel(in: app, identifier: "opendesign.day2.meta.toggle", containing: "열기", timeout: 2))
    }

    @MainActor
    func testOfficeHoursRevisingPreviousAnswerRestartsFromThatCard() throws {
        let runID = UUID().uuidString
        let workspacePath = "/tmp/agentic30-ui-office-hours-revision-\(runID)"
        let appSupportPath = "/tmp/agentic30-ui-office-hours-revision-support-\(runID)"
        resetDirectory(at: workspacePath)
        resetDirectory(at: appSupportPath)

        let app = launchApp(arguments: [
            "--ui-testing-reset-onboarding",
            "--ui-testing-seed-auth",
            "--ui-testing-seed-onboarding-context",
            "--ui-testing-seed-workspace=\(workspacePath)",
            "--ui-testing-seed-office-hours-structured-prompt",
            "--ui-testing-disable-sidecar",
            "--ui-testing-open-workspace",
            "--ui-testing-opaque-window",
            "--ui-testing-workspace-window-size=1360x820",
        ], environment: [
            "AGENTIC30_APP_SUPPORT_PATH": appSupportPath,
            "AGENTIC30_TEST_STUB_PROVIDER": "1",
            "AGENTIC30_UI_TEST_INLINE_STUB_RESPONSES": "1",
        ])
        hideKnownInterferingApplications()
        app.activate()
        addTeardownBlock {
            app.terminate()
            self.unhideKnownInterferingApplications()
            self.removeDirectory(at: workspacePath)
            self.removeDirectory(at: appSupportPath)
        }

        XCTAssertTrue(elementWithIdentifier(in: app, "opendesign.day.shell").waitForExistence(timeout: 10))
        XCTAssertTrue(elementWithIdentifier(in: app, "opendesign.officeHours.main").waitForExistence(timeout: 6))
        confirmDay1GoalIfPresent(in: app)

        let q1Choice = app.buttons["assistant.structuredChoice.office_hours_demand_evidence.돈을 냈거나 제안함"]
        XCTAssertTrue(q1Choice.waitForExistence(timeout: 5))
        XCTAssertTrue(scrollElementToVisible(
            q1Choice,
            in: app,
            timeout: 5,
            scrollViewIdentifier: "opendesign.officeHours.main.scroll"
        ))
        clickCenter(of: q1Choice)
        let continueButton = app.buttons["assistant.structuredContinueButton"]
        XCTAssertTrue(waitForElementLabel(in: app, identifier: "assistant.structuredContinueButton", containing: "Ready", timeout: 3))
        if !continueButton.isHittable {
            XCTAssertTrue(scrollElementToVisible(
                continueButton,
                in: app,
                timeout: 4,
                scrollViewIdentifier: "opendesign.officeHours.main.scroll"
            ))
        }
        clickCenter(of: continueButton)

        let q1Submitted = elementWithIdentifier(in: app, "opendesign.officeHours.submittedPrompt.ui-test-office-hours-request")
        XCTAssertTrue(q1Submitted.waitForExistence(timeout: 5))

        let q2Choice = app.buttons["assistant.structuredChoice.office_hours_status_quo.스프레드시트와 메신저"]
        XCTAssertTrue(q2Choice.waitForExistence(timeout: 5))
        XCTAssertTrue(scrollElementToVisible(
            q2Choice,
            in: app,
            timeout: 5,
            scrollViewIdentifier: "opendesign.officeHours.main.scroll"
        ))
        clickCenter(of: q2Choice)
        XCTAssertTrue(waitForElementLabel(in: app, identifier: "assistant.structuredContinueButton", containing: "Ready", timeout: 3))
        if !continueButton.isHittable {
            XCTAssertTrue(scrollElementToVisible(
                continueButton,
                in: app,
                timeout: 4,
                scrollViewIdentifier: "opendesign.officeHours.main.scroll"
            ))
        }
        clickCenter(of: continueButton)

        let q2Submitted = elementWithIdentifier(in: app, "opendesign.officeHours.submittedPrompt.ui-test-office-hours-request-2")
        XCTAssertTrue(q2Submitted.waitForExistence(timeout: 5))
        XCTAssertTrue(waitForElementLabel(in: app, identifier: "opendesign.officeHours.submittedChoice.office_hours_status_quo.스프레드시트와 메신저", containing: "제출됨", timeout: 3))

        let q1RevisedChoice = elementWithIdentifier(in: app, "opendesign.officeHours.submittedChoice.office_hours_demand_evidence.업무에 이미 의존함")
        let officeHoursScroll = elementWithIdentifier(in: app, "opendesign.officeHours.main.scroll")
        let q1ScrollDeadline = Date().addingTimeInterval(5)
        while !(q1RevisedChoice.exists && q1RevisedChoice.isHittable), Date() < q1ScrollDeadline {
            officeHoursScroll.swipeDown()
            RunLoop.current.run(until: Date().addingTimeInterval(0.2))
        }
        XCTAssertTrue(q1RevisedChoice.exists && q1RevisedChoice.isHittable)
        clickCenter(of: q1RevisedChoice)

        XCTAssertTrue(elementWithIdentifier(in: app, "opendesign.officeHours.questionLoader").waitForExistence(timeout: 3))
        XCTAssertTrue(waitForElementToDisappear(q2Submitted, timeout: 3))
        XCTAssertTrue(waitForElementLabel(in: app, identifier: "opendesign.officeHours.submittedChoice.office_hours_demand_evidence.업무에 이미 의존함", containing: "제출됨", timeout: 3))
        XCTAssertTrue(q2Choice.waitForExistence(timeout: 5))
        XCTAssertFalse(q2Submitted.exists)
    }

    @MainActor
    func testOfficeHoursPastDayShowsCustomerEvidenceReviewSections() throws {
        let runID = UUID().uuidString
        let workspacePath = "/tmp/agentic30-ui-past-day-review-\(runID)"
        let appSupportPath = "/tmp/agentic30-ui-past-day-review-support-\(runID)"
        resetDirectory(at: workspacePath)
        resetDirectory(at: appSupportPath)

        let app = launchApp(arguments: [
            "--ui-testing-reset-onboarding",
            "--ui-testing-seed-auth",
            "--ui-testing-seed-onboarding-context",
            "--ui-testing-seed-workspace=\(workspacePath)",
            "--ui-testing-seed-office-hours-structured-prompt",
            "--ui-testing-seed-office-hours-timeline-fixture",
            "--ui-testing-open-office-hours-past-day=1",
            "--ui-testing-disable-sidecar",
            "--ui-testing-open-workspace",
            "--ui-testing-opaque-window",
            "--ui-testing-workspace-window-size=1360x820",
        ], environment: [
            "AGENTIC30_APP_SUPPORT_PATH": appSupportPath,
            "AGENTIC30_TEST_STUB_PROVIDER": "1",
        ])
        hideKnownInterferingApplications()
        app.activate()
        addTeardownBlock {
            app.terminate()
            self.unhideKnownInterferingApplications()
            self.removeDirectory(at: workspacePath)
            self.removeDirectory(at: appSupportPath)
        }

        XCTAssertTrue(elementWithIdentifier(in: app, "opendesign.day.shell").waitForExistence(timeout: 10))
        XCTAssertTrue(elementWithIdentifier(in: app, "opendesign.officeHours.sessions").waitForExistence(timeout: 6))

        let day1Row = elementWithIdentifier(in: app, "opendesign.officeHours.timeline.day.1")
        XCTAssertTrue(day1Row.waitForExistence(timeout: 6))
        let pastDayRoot = elementWithIdentifier(in: app, "opendesign.officeHours.pastDay.1")
        if !pastDayRoot.exists {
            XCTAssertTrue(scrollElementToVisible(
                day1Row,
                in: app,
                timeout: 5,
                scrollViewIdentifier: "opendesign.officeHours.sessions"
            ))
            clickCenter(of: day1Row)
        }

        XCTAssertTrue(pastDayRoot.waitForExistence(timeout: 6))
        XCTAssertTrue(elementWithIdentifier(in: app, "opendesign.officeHours.pastDay.goalSnapshot").waitForExistence(timeout: 6))
        XCTAssertTrue(elementWithIdentifier(in: app, "opendesign.officeHours.pastDay.carryForward").waitForExistence(timeout: 6))
        XCTAssertTrue(elementWithIdentifier(in: app, "opendesign.officeHours.pastDay.review.verdict.1").waitForExistence(timeout: 6))
        XCTAssertTrue(elementWithIdentifier(in: app, "opendesign.officeHours.pastDay.review.evidence").waitForExistence(timeout: 6))
        XCTAssertTrue(elementWithIdentifier(in: app, "opendesign.officeHours.pastDay.review.commitment").waitForExistence(timeout: 6))
        XCTAssertTrue(app.staticTexts["고객 증거 없이 빌드함"].waitForExistence(timeout: 3))
        XCTAssertTrue(app.staticTexts["장지창"].waitForExistence(timeout: 3))
        XCTAssertTrue(app.staticTexts["결제 의향 묻기"].waitForExistence(timeout: 3))
        XCTAssertTrue(app.staticTexts["증거 없음"].waitForExistence(timeout: 3))
        XCTAssertTrue(app.staticTexts["오늘 장지창에게 결제 의향 DM을 보내고 screenshot 증거를 붙이기"].waitForExistence(timeout: 3))
        XCTAssertTrue(app.staticTexts["다음 약속"].waitForExistence(timeout: 3))
        XCTAssertTrue(elementWithIdentifier(in: app, "opendesign.officeHours.evidenceOS.attach").waitForExistence(timeout: 3))
        XCTAssertTrue(elementWithIdentifier(in: app, "opendesign.officeHours.evidenceOS.carry").waitForExistence(timeout: 3))
        XCTAssertTrue(elementWithIdentifier(in: app, "opendesign.officeHours.evidenceOS.abandon").waitForExistence(timeout: 3))
        movePointerAwayFromContent()
        attachWindowScreenshot(from: app, named: "Office Hours Past Day Customer Evidence Review")
    }

    @MainActor
    func testOfficeHoursCommitmentGateShowsDraftAndRequiresUserConfirmation() throws {
        let runID = UUID().uuidString
        let workspacePath = "/tmp/agentic30-ui-commitment-gate-\(runID)"
        let appSupportPath = "/tmp/agentic30-ui-commitment-gate-support-\(runID)"
        resetDirectory(at: workspacePath)
        resetDirectory(at: appSupportPath)

        let app = launchApp(arguments: [
            "--ui-testing-reset-onboarding",
            "--ui-testing-seed-auth",
            "--ui-testing-seed-onboarding-context",
            "--ui-testing-seed-workspace=\(workspacePath)",
            "--ui-testing-seed-office-hours-commitment-gate",
            "--ui-testing-disable-sidecar",
            "--ui-testing-open-workspace",
            "--ui-testing-opaque-window",
            "--ui-testing-workspace-window-size=1360x820",
        ], environment: [
            "AGENTIC30_APP_SUPPORT_PATH": appSupportPath,
            "AGENTIC30_TEST_STUB_PROVIDER": "1",
        ])
        hideKnownInterferingApplications()
        app.activate()
        addTeardownBlock {
            app.terminate()
            self.unhideKnownInterferingApplications()
            self.removeDirectory(at: workspacePath)
            self.removeDirectory(at: appSupportPath)
        }

        XCTAssertTrue(elementWithIdentifier(in: app, "opendesign.day.shell").waitForExistence(timeout: 10))
        XCTAssertTrue(elementWithIdentifier(in: app, "opendesign.officeHours.main").waitForExistence(timeout: 6))

        let commitmentBar = elementWithIdentifier(in: app, "opendesign.officeHours.commitmentBar")
        XCTAssertTrue(scrollElementToVisible(
            commitmentBar,
            in: app,
            timeout: 5,
            scrollViewIdentifier: "opendesign.officeHours.main.scroll"
        ))
        XCTAssertTrue(app.staticTexts["다음 한 가지 고객 행동을 약속해줘."].waitForExistence(timeout: 3))
        let customField = elementWithIdentifier(in: app, "opendesign.officeHours.commitmentCustomField")
        XCTAssertTrue(scrollElementToVisible(
            customField,
            in: app,
            timeout: 5,
            scrollViewIdentifier: "opendesign.officeHours.main.scroll"
        ))
        let commitButton = elementWithIdentifier(in: app, "opendesign.officeHours.commitButton")
        XCTAssertTrue(commitButton.exists)
        XCTAssertFalse(commitButton.isEnabled)
        clickCenter(of: customField)
        customField.typeText("Jane에게 DM으로 가격 물어보기")
        XCTAssertTrue(commitButton.isEnabled)
        movePointerAwayFromContent()
        attachWindowScreenshot(from: app, named: "Office Hours Commitment Gate Requires Confirmation")
    }

    @MainActor
    func testOfficeHoursRunningStateShowsLiveStatus() throws {
        let runID = UUID().uuidString
        let workspacePath = "/tmp/agentic30-ui-office-hours-running-\(runID)"
        let appSupportPath = "/tmp/agentic30-ui-office-hours-running-support-\(runID)"
        resetDirectory(at: workspacePath)
        resetDirectory(at: appSupportPath)

        let app = launchApp(arguments: [
            "--ui-testing-reset-onboarding",
            "--ui-testing-seed-auth",
            "--ui-testing-seed-onboarding-context",
            "--ui-testing-seed-workspace=\(workspacePath)",
            "--ui-testing-seed-idd-complete",
            "--ui-testing-seed-office-hours-running",
            "--ui-testing-disable-sidecar",
            "--ui-testing-open-workspace",
            "--ui-testing-opaque-window",
            "--ui-testing-workspace-window-size=1360x820",
        ], environment: [
            "AGENTIC30_APP_SUPPORT_PATH": appSupportPath,
            "AGENTIC30_TEST_STUB_PROVIDER": "1",
        ])
        hideKnownInterferingApplications()
        app.activate()
        addTeardownBlock {
            app.terminate()
            self.unhideKnownInterferingApplications()
            self.removeDirectory(at: workspacePath)
            self.removeDirectory(at: appSupportPath)
        }

        XCTAssertTrue(elementWithIdentifier(in: app, "opendesign.day.shell").waitForExistence(timeout: 10))
        XCTAssertTrue(elementWithIdentifier(in: app, "opendesign.officeHours.main").waitForExistence(timeout: 5))
        let questionLoaders = app.descendants(matching: .any)
            .matching(NSPredicate(format: "identifier == %@", "opendesign.officeHours.questionLoader"))
        XCTAssertLessThanOrEqual(questionLoaders.count, 1)
        XCTAssertTrue(elementWithIdentifier(in: app, "opendesign.officeHours.liveStatus").waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["opendesign.day.start"].exists)
        movePointerAwayFromContent()
        attachWindowScreenshot(from: app, named: "Office Hours SwiftUI Running Status")
        XCTAssertFalse(elementWithIdentifier(in: app, "assistant.structuredPrompt").exists)
    }

    @MainActor
    func testOpenDesignDayAlignmentFinalCardRendersStructuredRows() throws {
        let runID = UUID().uuidString
        let workspacePath = "/tmp/agentic30-ui-opendesign-day-alignment-\(runID)"
        let appSupportPath = "/tmp/agentic30-ui-opendesign-day-alignment-support-\(runID)"
        resetDirectory(at: workspacePath)
        resetDirectory(at: appSupportPath)

        let app = launchApp(arguments: [
            "--ui-testing-reset-onboarding",
            "--ui-testing-seed-auth",
            "--ui-testing-seed-onboarding-context",
            "--ui-testing-seed-workspace=\(workspacePath)",
            "--ui-testing-seed-day1-alignment-plan",
            "--ui-testing-disable-sidecar",
            "--ui-testing-open-workspace",
            "--ui-testing-opaque-window",
            "--ui-testing-workspace-window-size=1136x720",
        ], environment: [
            "AGENTIC30_APP_SUPPORT_PATH": appSupportPath,
            "AGENTIC30_TEST_STUB_PROVIDER": "1",
        ])
        hideKnownInterferingApplications()
        app.activate()
        addTeardownBlock {
            app.terminate()
            self.unhideKnownInterferingApplications()
            self.removeDirectory(at: workspacePath)
            self.removeDirectory(at: appSupportPath)
        }

        XCTAssertTrue(elementWithIdentifier(in: app, "opendesign.day.shell").waitForExistence(timeout: 10))
        XCTAssertTrue(elementWithIdentifier(in: app, "opendesign.officeHours.main").waitForExistence(timeout: 5))
        XCTAssertTrue(elementWithIdentifier(in: app, "opendesign.officeHours.goal.card").waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["opendesign.officeHours.goal.option.make_money"].exists)
        XCTAssertTrue(app.buttons["opendesign.officeHours.goal.option.get_users"].exists)
        XCTAssertTrue(app.buttons["opendesign.officeHours.goal.option.build_product"].exists)
        XCTAssertFalse(elementWithIdentifier(in: app, "opendesign.day.final.confirm").exists)
        XCTAssertFalse(elementWithIdentifier(in: app, "opendesign.day.final.row.icp").exists)
        attachScreenshot(from: app, named: "OpenDesign Day Alignment Routes To Office Hours")
    }

    @MainActor
    func testDay1SituationSummaryCardRendersOnWorkspaceSurface() throws {
        let runID = UUID().uuidString
        let workspacePath = "/tmp/agentic30-ui-day1-situation-\(runID)"
        let appSupportPath = "/tmp/agentic30-ui-day1-situation-support-\(runID)"
        resetDirectory(at: workspacePath)
        resetDirectory(at: appSupportPath)

        let app = launchApp(arguments: [
            "--ui-testing-reset-onboarding",
            "--ui-testing-seed-auth",
            "--ui-testing-seed-onboarding-context",
            "--ui-testing-seed-workspace=\(workspacePath)",
            "--ui-testing-seed-day1-situation-summary",
            "--ui-testing-disable-sidecar",
            "--ui-testing-open-workspace",
            "--ui-testing-opaque-window",
            "--ui-testing-workspace-window-size=1136x820",
            // Force the explicit white theme so the card's contrast is verified
            // deterministically regardless of any persisted theme.
            "-agentic30.appearance.theme.v1", "white",
        ], environment: [
            "AGENTIC30_APP_SUPPORT_PATH": appSupportPath,
            "AGENTIC30_TEST_STUB_PROVIDER": "1",
        ])
        hideKnownInterferingApplications()
        app.activate()
        addTeardownBlock {
            app.terminate()
            self.unhideKnownInterferingApplications()
            self.removeDirectory(at: workspacePath)
            self.removeDirectory(at: appSupportPath)
        }

        XCTAssertTrue(elementWithIdentifier(in: app, "opendesign.day.shell").waitForExistence(timeout: 10))
        XCTAssertTrue(elementWithIdentifier(in: app, "opendesign.officeHours.main").waitForExistence(timeout: 5))
        XCTAssertTrue(elementWithIdentifier(in: app, "opendesign.officeHours.goal.card").waitForExistence(timeout: 5))
        XCTAssertFalse(elementWithIdentifier(in: app, "day1.situationSummary.card").exists)
        XCTAssertFalse(elementWithIdentifier(in: app, "day1.situationSummary.title").exists)
        XCTAssertFalse(app.buttons["opendesign.day.start"].exists)
        XCTAssertFalse(app.buttons["opendesign.day.icp.option.1"].exists)
        attachScreenshot(from: app, named: "Day1 Situation Seed Routes To Office Hours")
    }

    @MainActor
    func testOpenDesignDayCompletionNoLongerUsesLegacyFinalCard() throws {
        let runID = UUID().uuidString
        let workspacePath = "/tmp/agentic30-ui-opendesign-day-unlocked-\(runID)"
        let appSupportPath = "/tmp/agentic30-ui-opendesign-day-unlocked-support-\(runID)"
        resetDirectory(at: workspacePath)
        resetDirectory(at: appSupportPath)

        let app = launchApp(arguments: [
            "--ui-testing-reset-onboarding",
            "--ui-testing-seed-auth",
            "--ui-testing-seed-onboarding-context",
            "--ui-testing-seed-workspace=\(workspacePath)",
            "--ui-testing-disable-sidecar",
            "--ui-testing-open-workspace",
            "--ui-testing-opaque-window",
            "--ui-testing-workspace-window-size=1360x820",
        ], environment: [
            "AGENTIC30_APP_SUPPORT_PATH": appSupportPath,
            "AGENTIC30_TEST_STUB_PROVIDER": "1",
        ])
        hideKnownInterferingApplications()
        app.activate()
        addTeardownBlock {
            app.terminate()
            self.unhideKnownInterferingApplications()
            self.removeDirectory(at: workspacePath)
            self.removeDirectory(at: appSupportPath)
        }

        XCTAssertTrue(elementWithIdentifier(in: app, "opendesign.day.shell").waitForExistence(timeout: 10))
        XCTAssertTrue(elementWithIdentifier(in: app, "opendesign.officeHours.main").waitForExistence(timeout: 5))
        XCTAssertTrue(elementWithIdentifier(in: app, "opendesign.officeHours.goal.card").waitForExistence(timeout: 5))
        XCTAssertFalse(elementWithIdentifier(in: app, "opendesign.day.final.confirm").exists)
        XCTAssertFalse(elementWithIdentifier(in: app, "opendesign.day.final.docs").exists)
        for docType in ["goal", "icp", "values", "spec"] {
            XCTAssertFalse(elementWithIdentifier(in: app, "opendesign.day.final.doc.\(docType)").exists)
        }
    }

    @MainActor
    func testOpenDesignDayDocumentRowsMovedToOfficeHoursHandoff() throws {
        let runID = UUID().uuidString
        let workspacePath = "/tmp/agentic30-ui-opendesign-day-doc-status-\(runID)"
        let appSupportPath = "/tmp/agentic30-ui-opendesign-day-doc-status-support-\(runID)"
        resetDirectory(at: workspacePath)
        resetDirectory(at: appSupportPath)

        let app = launchApp(arguments: [
            "--ui-testing-reset-onboarding",
            "--ui-testing-seed-auth",
            "--ui-testing-seed-onboarding-context",
            "--ui-testing-seed-workspace=\(workspacePath)",
            "--ui-testing-disable-sidecar",
            "--ui-testing-open-workspace",
            "--ui-testing-opaque-window",
            "--ui-testing-workspace-window-size=1360x820",
        ], environment: [
            "AGENTIC30_APP_SUPPORT_PATH": appSupportPath,
            "AGENTIC30_TEST_STUB_PROVIDER": "1",
        ])
        hideKnownInterferingApplications()
        app.activate()
        addTeardownBlock {
            app.terminate()
            self.unhideKnownInterferingApplications()
            self.removeDirectory(at: workspacePath)
            self.removeDirectory(at: appSupportPath)
        }

        XCTAssertTrue(elementWithIdentifier(in: app, "opendesign.day.shell").waitForExistence(timeout: 10))
        XCTAssertTrue(elementWithIdentifier(in: app, "opendesign.officeHours.main").waitForExistence(timeout: 5))
        XCTAssertTrue(elementWithIdentifier(in: app, "opendesign.officeHours.goal.card").waitForExistence(timeout: 5))
        XCTAssertFalse(elementWithIdentifier(in: app, "opendesign.day.final.confirm").exists)
        XCTAssertFalse(elementWithIdentifier(in: app, "opendesign.day.final.doc.goal").exists)
    }

    @MainActor
    func testOpenDesignDayPageResponsivePrimarySmoke() throws {
        try assertOpenDesignDayResponsiveLayout(
            windowSize: CGSize(width: 1136, height: 720),
            expectedRailWidth: 48,
            expectedSessionsWidth: 240,
            expectedMetaPanelWidth: nil,
            screenshotName: "OpenDesign Day Responsive 1136"
        )
    }

    @MainActor
    func testOpenDesignDayPageResponsiveCompactSmoke() throws {
        try assertOpenDesignDayResponsiveLayout(
            windowSize: CGSize(width: 900, height: 720),
            expectedRailWidth: 48,
            expectedSessionsWidth: nil,
            expectedMetaPanelWidth: nil,
            screenshotName: "OpenDesign Day Responsive 900"
        )
    }

    @MainActor
    func testOpenDesignDayPageResponsiveWideSmoke() throws {
        try assertOpenDesignDayResponsiveLayout(
            windowSize: CGSize(width: 1360, height: 820),
            expectedRailWidth: 52,
            expectedSessionsWidth: 240,
            expectedMetaPanelWidth: 280,
            screenshotName: "OpenDesign Day Responsive 1360"
        )
    }

    @MainActor
    func testCredentialedGoogleLoginCompletesMacAuth() throws {
        throw XCTSkip("Google sign-in UI is disabled while the macOS app runs in loginless local mode.")
    }

    @MainActor
    func testAgentSettingsModelPickersSaveClaudeCodexAndGeminiModels() throws {
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
                "--ui-testing-open-settings-section=providers",
                "--ui-testing-opaque-window",
            ],
            environment: [
                "AGENTIC30_APP_SUPPORT_PATH": appSupportPath,
                "AGENTIC30_UI_TEST_SETTINGS_CLAUDE_MODEL": "claude-opus-4-8",
                "AGENTIC30_UI_TEST_SETTINGS_CODEX_MODEL": "gpt-5.5",
                "AGENTIC30_UI_TEST_SETTINGS_GEMINI_MODEL": "gemini-2.5-flash",
                "AGENTIC30_UI_TEST_SETTINGS_CLAUDE_AUTH_MODE": "api_key",
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
        assertNativeWindowShellVisible(in: app)
        XCTAssertTrue(openSettingsSection(in: app, "providers"))
        XCTAssertTrue(app.staticTexts["Anthropic Claude Code"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["OpenAI GPT Codex"].exists)
        XCTAssertTrue(app.staticTexts["Google Gemini"].exists)
        attachScreenshot(from: app, named: "01 Settings Model Pickers")

        let claudeApiField = elementWithIdentifier(in: app, "settings.claude.apiKeyField")
        XCTAssertTrue(claudeApiField.waitForExistence(timeout: 2))

        XCTAssertTrue(
            chooseModelOption(
                in: app,
                pickerIdentifier: "settings.claude.modelPicker",
                optionLabel: "Claude Opus 4.8 (Best)",
                optionIdentifier: "settings.claude.modelOption.claude-opus-4-8"
            )
        )
        XCTAssertTrue(waitForModelID(in: app, identifier: "settings.claude.modelID", value: "claude-opus-4-8"))

        XCTAssertTrue(
            chooseModelOption(
                in: app,
                pickerIdentifier: "settings.codex.modelPicker",
                optionLabel: "GPT 5.5 (Best)",
                optionIdentifier: "settings.codex.modelOption.gpt-5.5"
            )
        )
        XCTAssertTrue(waitForModelID(in: app, identifier: "settings.codex.modelID", value: "gpt-5.5"))

        app.scrollViews.firstMatch.swipeUp()

        XCTAssertTrue(
            chooseModelOption(
                in: app,
                pickerIdentifier: "settings.gemini.modelPicker",
                optionLabel: "Gemini 2.5 Flash",
                optionIdentifier: "settings.gemini.modelOption.gemini-2.5-flash"
            )
        )
        XCTAssertTrue(waitForModelID(in: app, identifier: "settings.gemini.modelID", value: "gemini-2.5-flash"))

        let saveModels = hittableElementWithIdentifier(
            in: app,
            "settings.saveButton",
            timeout: 2
        ) ?? elementWithIdentifier(in: app, "settings.saveButton")
        XCTAssertTrue(saveModels.waitForExistence(timeout: 2))
        clickCenter(of: saveModels)
        XCTAssertTrue(waitForPreferredModelSettings(
            appSupportPath: appSupportPath,
            claude: "claude-opus-4-8",
            codex: "gpt-5.5",
            gemini: "gemini-2.5-flash",
            timeout: 2
        ))
        attachScreenshot(from: app, named: "02 Settings Models Saved")
    }

    @MainActor
    func testSettingsWorkspaceMainProjectMatchesOpenDesignPathRow() throws {
        let runID = UUID().uuidString
        let workspaceURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("agentic30-settings-workspace-\(runID)", isDirectory: true)
        let appSupportURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("agentic30-settings-support-\(runID)", isDirectory: true)
        resetDirectory(at: workspaceURL.path)
        resetDirectory(at: appSupportURL.path)

        let app = launchApp(
            arguments: [
                "--ui-testing-reset-onboarding",
                "--ui-testing-seed-auth",
                "--ui-testing-seed-workspace=\(workspaceURL.path)",
                "--ui-testing-seed-onboarding-context",
                "--ui-testing-disable-sidecar",
                "--ui-testing-open-settings",
                "--ui-testing-open-settings-section=workspace",
                "--ui-testing-opaque-window",
            ],
            environment: [
                "AGENTIC30_APP_SUPPORT_PATH": appSupportURL.path,
                "AGENTIC30_TEST_STUB_PROVIDER": "1",
            ]
        )
        hideKnownInterferingApplications()
        app.activate()
        addTeardownBlock {
            app.terminate()
            self.unhideKnownInterferingApplications()
            self.removeDirectory(at: workspaceURL.path)
            self.removeDirectory(at: appSupportURL.path)
        }

        XCTAssertTrue(openSettingsWindow(in: app))
        XCTAssertTrue(openSettingsSection(in: app, "workspace"))

        let pathRow = elementWithIdentifier(in: app, "settings.workspace.mainProject.pathRow")
        let pathPill = elementWithIdentifier(in: app, "settings.workspace.mainProject.pathPill")
        let changeButton = elementWithIdentifier(in: app, "settings.workspace.mainProject.changeButton")

        guard pathRow.waitForExistence(timeout: 5),
              pathPill.waitForExistence(timeout: 2),
              changeButton.waitForExistence(timeout: 2)
        else {
            attachScreenshot(from: app, named: "Settings Workspace Path Row Missing")
            attachText(app.debugDescription, named: "Settings Workspace Path Row Tree")
            XCTFail("Expected Open Design workspace path row, pill, and change button")
            return
        }

        XCTAssertTrue(
            element(pathPill, contains: workspaceURL.lastPathComponent),
            "Path pill should expose the workspace basename"
        )
        XCTAssertLessThan(pathPill.frame.minX, changeButton.frame.minX)
        XCTAssertLessThanOrEqual(pathPill.frame.maxX, changeButton.frame.minX + 1)
        XCTAssertGreaterThanOrEqual(pathPill.frame.minX, pathRow.frame.minX - 1)
        XCTAssertLessThanOrEqual(changeButton.frame.maxX, pathRow.frame.maxX + 1)
        XCTAssertEqual(pathPill.frame.midY, changeButton.frame.midY, accuracy: 2)

        attachScreenshot(from: app, named: "Settings Workspace Path Row")
    }

    @MainActor
    func testSettingsResetLocalDataReturnsToOnboardingBootIntro() throws {
        let runID = UUID().uuidString
        let tempRoot = FileManager.default.temporaryDirectory
            .appendingPathComponent("agentic30-ui-reset-\(runID)", isDirectory: true)
        let homePath = tempRoot.appendingPathComponent("home", isDirectory: true).path
        let workspacePath = tempRoot.appendingPathComponent("workspace", isDirectory: true).path
        let appSupportPath = tempRoot.appendingPathComponent("app-support", isDirectory: true).path
        let xdgCachePath = tempRoot.appendingPathComponent("xdg-cache", isDirectory: true).path
        let xdgConfigPath = tempRoot.appendingPathComponent("xdg-config", isDirectory: true).path
        resetDirectory(at: tempRoot.path)
        try FileManager.default.createDirectory(atPath: homePath, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(atPath: "\(workspacePath)/.agentic30", withIntermediateDirectories: true)
        try FileManager.default.createDirectory(atPath: appSupportPath, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(atPath: "\(xdgCachePath)/qmd", withIntermediateDirectories: true)
        try FileManager.default.createDirectory(atPath: "\(xdgConfigPath)/qmd", withIntermediateDirectories: true)
        try "# Project".write(toFile: "\(workspacePath)/README.md", atomically: true, encoding: .utf8)
        try "setup".write(toFile: "\(workspacePath)/.agentic30/setup.json", atomically: true, encoding: .utf8)
        try "session".write(toFile: "\(appSupportPath)/session.json", atomically: true, encoding: .utf8)
        try "default".write(toFile: "\(xdgCachePath)/qmd/index.sqlite", atomically: true, encoding: .utf8)
        try "agentic30".write(toFile: "\(xdgCachePath)/qmd/agentic30.sqlite", atomically: true, encoding: .utf8)
        try "default".write(toFile: "\(xdgConfigPath)/qmd/index.yml", atomically: true, encoding: .utf8)
        try "agentic30".write(toFile: "\(xdgConfigPath)/qmd/agentic30.yml", atomically: true, encoding: .utf8)

        let app = launchApp(
            arguments: [
                "--ui-testing-reset-onboarding",
                "--ui-testing-seed-auth",
                "--ui-testing-seed-workspace=\(workspacePath)",
                "--ui-testing-seed-onboarding-context",
                "--ui-testing-disable-sidecar",
                "--ui-testing-skip-keychain-reset",
                "--ui-testing-open-settings-section=privacy",
                "--ui-testing-opaque-window",
            ],
            environment: [
                "HOME": homePath,
                "AGENTIC30_APP_SUPPORT_PATH": appSupportPath,
                "XDG_CACHE_HOME": xdgCachePath,
                "XDG_CONFIG_HOME": xdgConfigPath,
                "AGENTIC30_TEST_STUB_PROVIDER": "1",
            ]
        )
        hideKnownInterferingApplications()
        app.activate()
        addTeardownBlock {
            app.terminate()
            self.unhideKnownInterferingApplications()
            self.removeDirectory(at: tempRoot.path)
        }

        XCTAssertTrue(openSettingsWindow(in: app))
        XCTAssertTrue(openSettingsSection(in: app, "privacy"))
        let resetButton = app.buttons["settings.privacy.resetLocalDataButton"]
        XCTAssertTrue(resetButton.waitForExistence(timeout: 5))
        XCTAssertTrue(scrollSettingsContentUntilHittable(resetButton, in: app, timeout: 5))
        clickCenter(of: resetButton)
        let confirmReset = app.buttons["settings.privacy.localDataConfirmation.action"]
        XCTAssertTrue(confirmReset.waitForExistence(timeout: 3))
        clickCenter(of: confirmReset)

        let bootCards = elementWithIdentifier(in: app, "intakeV2.boot.cards")
        XCTAssertTrue(
            bootCards.waitForExistence(timeout: 8)
                || app.staticTexts["Welcome to Agentic30"].waitForExistence(timeout: 2),
            "Expected reset to return to the first onboarding screen"
        )
        XCTAssertFalse(FileManager.default.fileExists(atPath: "\(workspacePath)/.agentic30"))
        XCTAssertTrue(FileManager.default.fileExists(atPath: "\(workspacePath)/README.md"))
        XCTAssertFalse(FileManager.default.fileExists(atPath: appSupportPath))
        XCTAssertFalse(FileManager.default.fileExists(atPath: "\(xdgCachePath)/qmd/agentic30.sqlite"))
        XCTAssertFalse(FileManager.default.fileExists(atPath: "\(xdgConfigPath)/qmd/agentic30.yml"))
        XCTAssertTrue(FileManager.default.fileExists(atPath: "\(xdgCachePath)/qmd/index.sqlite"))
        XCTAssertTrue(FileManager.default.fileExists(atPath: "\(xdgConfigPath)/qmd/index.yml"))
    }

    @MainActor
    func testSettingsDeveloperToolsDoNotExposeDailyCheckNotificationControls() throws {
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
                "--ui-testing-open-settings-section=advanced",
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
        XCTAssertTrue(openSettingsSection(in: app, "advanced"))
        XCTAssertTrue(app.buttons["settings.advanced.confettiTestButton"].waitForExistence(timeout: 3))
        XCTAssertFalse(app.staticTexts["인터뷰/실행 체크 알림"].exists)
        XCTAssertFalse(app.buttons["settings.advanced.sendMorningBipNotification"].exists)
        XCTAssertFalse(app.buttons["settings.advanced.sendEveningBipNotification"].exists)
        attachScreenshot(from: app, named: "01 Settings Developer Tools")
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
    func testWorkspaceStartupDay1RoutesToOfficeHours() throws {
        // Day 1 workspace startup routes to the Office Hours screen, NOT the
        // 30-day task grid. This is the intended chrome: routesTodayToOfficeHours
        // (day == 1) → effectiveOfficeHoursPresented in OpenDesignDayShell renders
        // the office-hours column instead of the task sidebar.
        //
        // NOTE: the former grid + future-Day lock-navigation coverage (day7 locked,
        // week2 → day8) only applies on day >= 2, where the grid renders. Restoring
        // it needs a dayNumber>=2 seed flag (seed foundation completedDays), which
        // does not exist yet — track that as a separate day>=2 grid-navigation test.
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

        // The Day shell renders, and on Day 1 routes to the Office Hours main column.
        XCTAssertTrue(app.descendants(matching: .any)["opendesign.day.shell"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.descendants(matching: .any)["opendesign.officeHours.main"].waitForExistence(timeout: 10))

        // The 30-day task grid (and its task identifiers) is therefore absent on Day 1.
        XCTAssertFalse(app.descendants(matching: .any)["opendesign.day.task.day1"].exists)
        XCTAssertFalse(app.descendants(matching: .any)["opendesign.day.tasks"].exists)
    }

    @MainActor
    func testMorningBriefingRailOpensBriefingScreenWithAllSections() throws {
        // The rail gains an "아침 브리핑" item between today and settings. Clicking it
        // swaps the main column for the briefing screen (summary, source cards,
        // timeline, anomaly picker, action drafts, meta panel) driven by the
        // deterministic --ui-testing-stub-morning-briefing-events fixture.
        let workspacePath = "/tmp/agentic30-ui-morning-briefing-\(UUID().uuidString)"
        resetDirectory(at: workspacePath)
        let app = launchApp(arguments: [
            "--ui-testing-reset-onboarding",
            "--ui-testing-seed-auth",
            "--ui-testing-seed-onboarding-context",
            "--ui-testing-seed-workspace=\(workspacePath)",
            "--ui-testing-disable-sidecar",
            "--ui-testing-open-workspace",
            "--ui-testing-opaque-window",
            "--ui-testing-stub-morning-briefing-events",
        ])
        hideKnownInterferingApplications()
        app.activate()
        addTeardownBlock {
            app.terminate()
            self.unhideKnownInterferingApplications()
            self.removeDirectory(at: workspacePath)
        }

        XCTAssertTrue(app.descendants(matching: .any)["opendesign.day.shell"].waitForExistence(timeout: 10))

        let railItem = elementWithIdentifier(in: app, "opendesign.day.rail.item.briefing")
        XCTAssertTrue(railItem.waitForExistence(timeout: 5))
        railItem.click()

        // Briefing screen with every OD reference section.
        XCTAssertTrue(elementWithIdentifier(in: app, "morningBriefing.screen").waitForExistence(timeout: 5))
        XCTAssertTrue(elementWithIdentifier(in: app, "morningBriefing.summary").waitForExistence(timeout: 5))
        XCTAssertTrue(elementWithIdentifier(in: app, "morningBriefing.sources").exists)
        XCTAssertTrue(elementWithIdentifier(in: app, "morningBriefing.card.cloudflare").exists)
        XCTAssertTrue(elementWithIdentifier(in: app, "morningBriefing.card.github").exists)
        XCTAssertTrue(elementWithIdentifier(in: app, "morningBriefing.card.posthog").exists)
        XCTAssertTrue(elementWithIdentifier(in: app, "morningBriefing.timeline").exists)
        XCTAssertTrue(waitForElementLabel(in: app, identifier: "morningBriefing.timeline.badge.0", containing: "어제", timeout: 3))
        XCTAssertTrue(waitForElementLabel(in: app, identifier: "morningBriefing.timeline.badge.1", containing: "오늘", timeout: 3))
        XCTAssertTrue(elementWithIdentifier(in: app, "morningBriefing.anomaly").exists)
        XCTAssertTrue(elementWithIdentifier(in: app, "morningBriefing.actions").exists)
        XCTAssertTrue(elementWithIdentifier(in: app, "morningBriefing.syncbar").exists)

        // The rail marks the briefing item active while the screen is presented.
        XCTAssertTrue(waitForElementLabel(in: app, identifier: "opendesign.day.rail.item.briefing", containing: "active", timeout: 3))
        attachScreenshot(from: app, named: "Morning Briefing Screen")

        // Anomaly labeling: jump via the section nav (scrolls the main column),
        // pick option 1 → submit enables → toast confirms.
        elementWithIdentifier(in: app, "morningBriefing.nav.anomaly").click()
        let option = elementWithIdentifier(in: app, "morningBriefing.anomaly.option.real_churn")
        XCTAssertTrue(option.waitForExistence(timeout: 3))
        option.click()
        let submit = elementWithIdentifier(in: app, "morningBriefing.anomaly.submit")
        XCTAssertTrue(submit.waitForExistence(timeout: 3))
        submit.click()
        XCTAssertTrue(elementWithIdentifier(in: app, "morningBriefing.toast").waitForExistence(timeout: 3))

        // Action draft applies (copy/적용 buttons are real controls).
        elementWithIdentifier(in: app, "morningBriefing.nav.actions").click()
        let apply = elementWithIdentifier(in: app, "morningBriefing.action.apply.message")
        XCTAssertTrue(apply.waitForExistence(timeout: 3))
        apply.click()

        // Returning via the today rail item restores the Day 1 office-hours column.
        elementWithIdentifier(in: app, "opendesign.day.rail.item.today").click()
        XCTAssertTrue(app.descendants(matching: .any)["opendesign.officeHours.main"].waitForExistence(timeout: 10))
        XCTAssertFalse(elementWithIdentifier(in: app, "morningBriefing.screen").exists)
    }

    @MainActor
    func testMorningBriefingDrilldownOpensPerSourceScreens() throws {
        // Each source card's 드릴다운 link swaps the briefing for the per-source
        // drilldown screen (briefing-github/cloudflare/posthog.html): KPI grid,
        // chart, scan/funnel sections, source switcher, and back navigation —
        // driven by the deterministic stub fixture's drilldowns payload.
        let workspacePath = "/tmp/agentic30-ui-briefing-drilldown-\(UUID().uuidString)"
        resetDirectory(at: workspacePath)
        let app = launchApp(arguments: [
            "--ui-testing-reset-onboarding",
            "--ui-testing-seed-auth",
            "--ui-testing-seed-onboarding-context",
            "--ui-testing-seed-workspace=\(workspacePath)",
            "--ui-testing-disable-sidecar",
            "--ui-testing-open-workspace",
            "--ui-testing-opaque-window",
            "--ui-testing-stub-morning-briefing-events",
        ])
        hideKnownInterferingApplications()
        app.activate()
        addTeardownBlock {
            app.terminate()
            self.unhideKnownInterferingApplications()
            self.removeDirectory(at: workspacePath)
        }

        XCTAssertTrue(app.descendants(matching: .any)["opendesign.day.shell"].waitForExistence(timeout: 10))
        elementWithIdentifier(in: app, "opendesign.day.rail.item.briefing").click()
        XCTAssertTrue(elementWithIdentifier(in: app, "morningBriefing.screen").waitForExistence(timeout: 5))

        // GitHub drilldown: KPI grid + commit chart + repo scan + maintenance draft.
        let githubDrill = elementWithIdentifier(in: app, "morningBriefing.drill.github")
        XCTAssertTrue(githubDrill.waitForExistence(timeout: 5))
        githubDrill.click()
        // Per-source head badge is the reliable leaf identifier; the screen-sized
        // container identifier does not surface in the accessibility tree.
        XCTAssertTrue(elementWithIdentifier(in: app, "morningBriefing.drilldown.head.github").waitForExistence(timeout: 10))
        XCTAssertTrue(elementWithIdentifier(in: app, "morningBriefing.drilldown.kpis").exists)
        XCTAssertTrue(elementWithIdentifier(in: app, "morningBriefing.drilldown.chart").exists)
        XCTAssertTrue(elementWithIdentifier(in: app, "morningBriefing.drilldown.scan").exists)
        XCTAssertTrue(elementWithIdentifier(in: app, "morningBriefing.drilldown.draft.github_keep_readme").exists)
        attachScreenshot(from: app, named: "Morning Briefing Drilldown GitHub")

        // Source switcher jumps straight to the PostHog drilldown (retention
        // curve + onboarding funnel) without going back to the briefing.
        elementWithIdentifier(in: app, "morningBriefing.drilldown.source.posthog").click()
        XCTAssertTrue(elementWithIdentifier(in: app, "morningBriefing.drilldown.head.posthog").waitForExistence(timeout: 5))
        XCTAssertTrue(elementWithIdentifier(in: app, "morningBriefing.drilldown.funnel").exists)
        XCTAssertTrue(elementWithIdentifier(in: app, "morningBriefing.drilldown.signals").exists)
        attachScreenshot(from: app, named: "Morning Briefing Drilldown PostHog")

        // Cloudflare drilldown renders the path table; back returns to the briefing.
        elementWithIdentifier(in: app, "morningBriefing.drilldown.source.cloudflare").click()
        XCTAssertTrue(elementWithIdentifier(in: app, "morningBriefing.drilldown.head.cloudflare").waitForExistence(timeout: 5))
        XCTAssertTrue(elementWithIdentifier(in: app, "morningBriefing.drilldown.table").exists)
        elementWithIdentifier(in: app, "morningBriefing.drilldown.back").click()
        XCTAssertTrue(elementWithIdentifier(in: app, "morningBriefing.summary").waitForExistence(timeout: 5))
        XCTAssertFalse(elementWithIdentifier(in: app, "morningBriefing.drilldown.head.cloudflare").exists)
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

    @MainActor
    private func confirmDay1GoalIfPresent(
        in app: XCUIApplication,
        file: StaticString = #filePath,
        line: UInt = #line
    ) {
        let goalCard = elementWithIdentifier(in: app, "opendesign.officeHours.goal.card")
        guard goalCard.waitForExistence(timeout: 1.5) else { return }

        XCTAssertTrue(app.buttons["opendesign.officeHours.goal.option.make_money"].exists, file: file, line: line)
        XCTAssertTrue(app.buttons["opendesign.officeHours.goal.option.get_users"].exists, file: file, line: line)
        XCTAssertTrue(app.buttons["opendesign.officeHours.goal.option.build_product"].exists, file: file, line: line)

        // No goal is selected by default, so the start button stays disabled until
        // the user taps an option. Pick one before driving the start button.
        let makeMoneyOption = app.buttons["opendesign.officeHours.goal.option.make_money"]
        XCTAssertTrue(waitForOpenDesignMainHittable(makeMoneyOption, in: app, timeout: 5), file: file, line: line)
        clickCenter(of: makeMoneyOption)

        let saveButton = app.buttons["opendesign.officeHours.goal.save"]
        XCTAssertTrue(waitForOpenDesignMainHittable(saveButton, in: app, timeout: 5), file: file, line: line)
        clickCenter(of: saveButton)
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
        elementWithIdentifier(in: app, "opendesign.reference.settings.main").exists
            || app.staticTexts["Agents"].exists
            || app.staticTexts["Agent Models"].exists
            || app.staticTexts["Developer Tools"].exists
            // Sidebar identifiers — pick whichever section the launch flag opened to.
            || elementWithIdentifier(in: app, "settings.section.providers").exists
    }

    @MainActor
    private func assertNativeWindowShellVisible(
        in app: XCUIApplication,
        file: StaticString = #filePath,
        line: UInt = #line
    ) {
        XCTAssertTrue(app.windows.firstMatch.waitForExistence(timeout: 3), file: file, line: line)
        XCTAssertTrue(elementWithIdentifier(in: app, "opendesign.window.titlebar").waitForExistence(timeout: 3), file: file, line: line)
        XCTAssertFalse(app.buttons["opendesign.window.close"].exists, file: file, line: line)
        XCTAssertFalse(app.buttons["opendesign.window.minimize"].exists, file: file, line: line)
        XCTAssertFalse(app.buttons["opendesign.window.zoom"].exists, file: file, line: line)
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
    private func openSettingsSection(
        in app: XCUIApplication,
        _ section: String,
        timeout: TimeInterval = 5
    ) -> Bool {
        let sectionButton = elementWithIdentifier(in: app, "settings.section.\(section)")
        guard sectionButton.waitForExistence(timeout: timeout) else {
            return false
        }
        clickCenter(of: sectionButton)
        return true
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
    private func advanceOnboardingIntroToContext(in app: XCUIApplication) {
        let primary = button(in: app, matching: [
            "macOnboarding.primaryButton",
            "Next",
            "Start setup",
        ])

        for expectedTitle in [
            "We’re always by your side",
            "Build, launch, earn in 30 days",
            "Ship faster, learn faster",
        ] {
            XCTAssertTrue(primary.waitForExistence(timeout: 5))
            clickCenter(of: primary)
            XCTAssertTrue(app.staticTexts[expectedTitle].waitForExistence(timeout: 5))
        }

        XCTAssertTrue(primary.waitForExistence(timeout: 5))
        clickCenter(of: primary)

        verifyBootIntroLayout(in: app)
        XCTAssertFalse(app.staticTexts["지금 하루를 가장 많이 쓰는 역할은 무엇인가요?"].exists)
        let continueButton = button(in: app, matching: ["Continue →", "Continue"])
        XCTAssertTrue(continueButton.waitForExistence(timeout: 5))
        clickCenter(of: continueButton)
    }

    @MainActor
    private func verifyBootIntroLayout(in app: XCUIApplication) {
        let bootHeader = elementWithIdentifier(in: app, "intakeV2.boot.header")
        let bootSubtitle = elementWithIdentifier(in: app, "intakeV2.boot.subtitle")
        let bootCards = elementWithIdentifier(in: app, "intakeV2.boot.cards")
        XCTAssertTrue(bootHeader.waitForExistence(timeout: 10))
        assertIntakeProgress(in: app, current: 1)
        XCTAssertTrue(bootSubtitle.waitForExistence(timeout: 10))
        XCTAssertTrue(bootCards.waitForExistence(timeout: 10))
        XCTAssertLessThanOrEqual(
            bootSubtitle.frame.maxY + 16,
            bootCards.frame.minY,
            "Boot intro cards must not overlap the header/subtitle area"
        )
        let readVisual = elementWithIdentifier(in: app, "intakeV2.boot.read.visual")
        let decideVisual = elementWithIdentifier(in: app, "intakeV2.boot.decide.visual")
        let executeVisual = elementWithIdentifier(in: app, "intakeV2.boot.execute.visual")
        XCTAssertTrue(readVisual.waitForExistence(timeout: 5))
        XCTAssertTrue(decideVisual.waitForExistence(timeout: 5))
        XCTAssertTrue(executeVisual.waitForExistence(timeout: 5))
        assertFrame(decideVisual.frame, isInside: bootCards.frame, message: "Decide visual viewport must stay inside the BOOT card container")
        XCTAssertLessThanOrEqual(
            abs(readVisual.frame.minY - decideVisual.frame.minY),
            2,
            "Read and Decide visual modules should start on the same internal card grid line"
        )
        XCTAssertLessThanOrEqual(
            abs(decideVisual.frame.minY - executeVisual.frame.minY),
            2,
            "Decide and Execute visual modules should start on the same internal card grid line"
        )
        RunLoop.current.run(until: Date().addingTimeInterval(0.8))
        assertFrame(decideVisual.frame, isInside: bootCards.frame, message: "Animated Decide visual viewport must stay inside the BOOT card container")
        XCTAssertTrue(button(in: app, matching: ["Continue →", "Continue"]).exists)
        XCTAssertFalse(button(in: app, matching: ["Back"]).exists)
    }

    @MainActor
    private func assertFrame(
        _ frame: CGRect,
        isInside container: CGRect,
        message: String,
        file: StaticString = #filePath,
        line: UInt = #line
    ) {
        let tolerance: CGFloat = 1.5
        XCTAssertGreaterThanOrEqual(frame.minX, container.minX - tolerance, message, file: file, line: line)
        XCTAssertGreaterThanOrEqual(frame.minY, container.minY - tolerance, message, file: file, line: line)
        XCTAssertLessThanOrEqual(frame.maxX, container.maxX + tolerance, message, file: file, line: line)
        XCTAssertLessThanOrEqual(frame.maxY, container.maxY + tolerance, message, file: file, line: line)
    }

    @MainActor
    private func assertOpenDesignWideColumns(
        surface: CGRect,
        tasks: CGRect,
        main: CGRect,
        meta: CGRect,
        file: StaticString = #filePath,
        line: UInt = #line
    ) {
        let tolerance: CGFloat = 2.0
        XCTAssertEqual(tasks.minX, surface.minX + 52, accuracy: tolerance, "Day shell rail column should match day.html 52px width", file: file, line: line)
        XCTAssertEqual(tasks.width, 240, accuracy: tolerance, "Day shell task sidebar should match day.html 240px width", file: file, line: line)
        XCTAssertEqual(tasks.maxX, main.minX, accuracy: tolerance, "Task sidebar and main content should share a boundary", file: file, line: line)
        XCTAssertEqual(meta.width, 280, accuracy: tolerance, "Day shell meta panel should match day.html 280px width", file: file, line: line)
        XCTAssertEqual(main.maxX, meta.minX, accuracy: tolerance, "Main content and meta panel should share a boundary", file: file, line: line)
        XCTAssertEqual(meta.maxX, surface.maxX, accuracy: tolerance, "Meta panel should terminate at the workspace surface edge", file: file, line: line)
    }

    @MainActor
    private func assertOpenDesignBipLogWideColumns(
        surface: CGRect,
        side: CGRect,
        main: CGRect,
        file: StaticString = #filePath,
        line: UInt = #line
    ) {
        let tolerance: CGFloat = 2.0
        XCTAssertEqual(side.minX, surface.minX + 52, accuracy: tolerance, "BIP shell rail column should match bip-log.html 52px width", file: file, line: line)
        XCTAssertEqual(side.width, 240, accuracy: tolerance, "BIP shell side column should match bip-log.html 240px width", file: file, line: line)
        XCTAssertEqual(side.maxX, main.minX, accuracy: tolerance, "BIP side and main content should share a boundary", file: file, line: line)
        XCTAssertEqual(main.maxX, surface.maxX, accuracy: tolerance, "BIP main content should terminate at the workspace surface edge without a meta panel", file: file, line: line)
    }

    @MainActor
    private func assertOpenDesignDayResponsiveLayout(
        windowSize: CGSize,
        expectedRailWidth: CGFloat,
        expectedSessionsWidth: CGFloat?,
        expectedMetaPanelWidth: CGFloat?,
        screenshotName: String,
        file: StaticString = #filePath,
        line: UInt = #line
    ) throws {
        let runID = UUID().uuidString
        let workspacePath = "/tmp/agentic30-ui-opendesign-day-responsive-\(Int(windowSize.width))-\(runID)"
        let appSupportPath = "/tmp/agentic30-ui-opendesign-day-responsive-support-\(Int(windowSize.width))-\(runID)"
        resetDirectory(at: workspacePath)
        resetDirectory(at: appSupportPath)

        let app = launchApp(arguments: [
            "--ui-testing-reset-onboarding",
            "--ui-testing-seed-auth",
            "--ui-testing-seed-onboarding-context",
            "--ui-testing-seed-workspace=\(workspacePath)",
            "--ui-testing-seed-idd-complete",
            "--ui-testing-disable-sidecar",
            "--ui-testing-open-workspace",
            "--ui-testing-opaque-window",
            "--ui-testing-workspace-window-size=\(Int(windowSize.width))x\(Int(windowSize.height))",
        ], environment: [
            "AGENTIC30_APP_SUPPORT_PATH": appSupportPath,
            "AGENTIC30_TEST_STUB_PROVIDER": "1",
        ])
        hideKnownInterferingApplications()
        app.activate()
        addTeardownBlock {
            app.terminate()
            self.unhideKnownInterferingApplications()
            self.removeDirectory(at: workspacePath)
            self.removeDirectory(at: appSupportPath)
        }

        let openDesignShell = elementWithIdentifier(in: app, "opendesign.day.shell")
        if !openDesignShell.waitForExistence(timeout: 10) {
            attachScreenshot(from: app, named: "\(screenshotName) Missing")
            attachText(app.debugDescription, named: "\(screenshotName) Missing Tree")
        }
        XCTAssertTrue(openDesignShell.exists, file: file, line: line)

        let workspaceSurface = elementWithIdentifier(in: app, "workspace.surface")
        XCTAssertTrue(waitForOpenDesignSurfaceWidth(workspaceSurface, width: windowSize.width, timeout: 5), file: file, line: line)
        attachScreenshot(from: app, named: screenshotName)

        let rail = elementWithIdentifier(in: app, "opendesign.day.rail")
        let sessions = elementWithIdentifier(in: app, "opendesign.officeHours.sessions")
        let main = elementWithIdentifier(in: app, "opendesign.officeHours.main")
        let mainScroll = elementWithIdentifier(in: app, "opendesign.officeHours.main.scroll")
        let meta = elementWithIdentifier(in: app, "opendesign.officeHours.meta")
        XCTAssertTrue(rail.waitForExistence(timeout: 5), file: file, line: line)
        let mainColumn: XCUIElement
        if main.waitForExistence(timeout: 2) {
            mainColumn = main
        } else {
            XCTAssertTrue(mainScroll.waitForExistence(timeout: 5), file: file, line: line)
            mainColumn = mainScroll
        }
        if let expectedSessionsWidth {
            XCTAssertTrue(sessions.waitForExistence(timeout: 5), file: file, line: line)
            XCTAssertTrue(
                waitForColumnOffset(sessions, from: workspaceSurface, offset: expectedTaskAccessibilityOffset(railWidth: expectedRailWidth), timeout: 5),
                "Expected Office Hours sessions column to start after rail width \(expectedRailWidth), got rail=\(rail.frame), sessions=\(sessions.frame), surface=\(workspaceSurface.frame), window=\(app.windows.firstMatch.frame)",
                file: file,
                line: line
            )
            XCTAssertTrue(
                waitForElementFrameWidth(sessions, width: expectedSessionsWidth, timeout: 5),
                "Expected Office Hours sessions width \(expectedSessionsWidth), got sessions=\(sessions.frame), surface=\(workspaceSurface.frame), window=\(app.windows.firstMatch.frame)",
                file: file,
                line: line
            )
            if let expectedMetaPanelWidth {
                XCTAssertTrue(
                    waitForElementFrameWidth(meta, width: expectedMetaPanelWidth, timeout: 5),
                    "Expected Office Hours meta width \(expectedMetaPanelWidth), got meta=\(meta.frame), surface=\(workspaceSurface.frame), window=\(app.windows.firstMatch.frame)",
                    file: file,
                    line: line
                )
            }
            assertOpenDesignResponsiveColumns(
                surface: workspaceSurface.frame,
                rail: rail.frame,
                tasks: sessions.frame,
                main: mainColumn.frame,
                meta: expectedMetaPanelWidth == nil ? nil : meta.frame,
                expectedRailWidth: expectedRailWidth,
                expectedTaskSidebarWidth: expectedSessionsWidth,
                expectedMetaPanelWidth: expectedMetaPanelWidth,
                file: file,
                line: line
            )
            if let expectedMetaPanelWidth {
                let expandedMainMaxX = mainColumn.frame.maxX
                let panelToggle = app.buttons["opendesign.officeHours.panel"]
                XCTAssertTrue(panelToggle.waitForExistence(timeout: 2), file: file, line: line)
                XCTAssertTrue(waitForButtonLabel(in: app, identifier: "opendesign.officeHours.panel", containing: "닫기", timeout: 2), file: file, line: line)
                clickCenter(of: panelToggle)
                XCTAssertTrue(waitForElementToDisappear(meta, timeout: 3), file: file, line: line)
                XCTAssertTrue(waitForButtonLabel(in: app, identifier: "opendesign.officeHours.panel", containing: "열기", timeout: 2), file: file, line: line)
                XCTAssertGreaterThanOrEqual(mainColumn.frame.maxX, expandedMainMaxX + expectedMetaPanelWidth - 24, file: file, line: line)
                clickCenter(of: panelToggle)
                XCTAssertTrue(waitForElementFrameWidth(meta, width: expectedMetaPanelWidth, timeout: 5), file: file, line: line)
                XCTAssertTrue(waitForButtonLabel(in: app, identifier: "opendesign.officeHours.panel", containing: "닫기", timeout: 2), file: file, line: line)
            }
        } else {
            XCTAssertTrue(
                waitForElementToDisappear(sessions, timeout: 3),
                "Office Hours sessions column should collapse at this native responsive width",
                file: file,
                line: line
            )
            XCTAssertTrue(
                waitForColumnOffset(mainColumn, from: workspaceSurface, offset: expectedTaskAccessibilityOffset(railWidth: expectedRailWidth), timeout: 5),
                "Expected Office Hours main column to start after rail width \(expectedRailWidth), got rail=\(rail.frame), main=\(mainColumn.frame), surface=\(workspaceSurface.frame), window=\(app.windows.firstMatch.frame)",
                file: file,
                line: line
            )
            let surfaceEdgeTolerance: CGFloat = 8.0
            if let expectedMetaPanelWidth {
                XCTAssertTrue(
                    waitForElementFrameWidth(meta, width: expectedMetaPanelWidth, timeout: 5),
                    "Expected Office Hours meta width \(expectedMetaPanelWidth), got meta=\(meta.frame), surface=\(workspaceSurface.frame), window=\(app.windows.firstMatch.frame)",
                    file: file,
                    line: line
                )
                XCTAssertEqual(mainColumn.frame.maxX, meta.frame.minX, accuracy: 2.0, file: file, line: line)
                XCTAssertEqual(meta.frame.maxX, workspaceSurface.frame.maxX, accuracy: surfaceEdgeTolerance, file: file, line: line)
            } else {
                XCTAssertEqual(mainColumn.frame.maxX, workspaceSurface.frame.maxX, accuracy: surfaceEdgeTolerance, file: file, line: line)
            }
        }
        if expectedMetaPanelWidth == nil {
            XCTAssertFalse(meta.exists, "Meta panel should collapse at this native responsive width", file: file, line: line)
        } else {
            XCTAssertTrue(meta.exists, file: file, line: line)
        }

        XCTAssertFalse(app.buttons["opendesign.day.header.context"].exists, file: file, line: line)
        XCTAssertFalse(app.buttons["opendesign.day.header.primary"].exists, file: file, line: line)
        XCTAssertFalse(app.buttons["opendesign.day.header.reset"].exists, file: file, line: line)
        XCTAssertFalse(app.buttons["opendesign.day.header.previous"].exists, file: file, line: line)
        XCTAssertFalse(app.buttons["opendesign.day.header.next"].exists, file: file, line: line)
        XCTAssertTrue(mainColumn.exists, file: file, line: line)
        XCTAssertTrue(elementWithIdentifier(in: app, "opendesign.officeHours.goal.card").waitForExistence(timeout: 5), file: file, line: line)
        XCTAssertFalse(app.buttons["opendesign.day.start"].exists, file: file, line: line)
        XCTAssertFalse(elementWithIdentifier(in: app, "opendesign.day.hypothesis").exists, file: file, line: line)
    }

    @MainActor
    private func waitForOpenDesignSurfaceWidth(
        _ surface: XCUIElement,
        width: CGFloat,
        timeout: TimeInterval
    ) -> Bool {
        let tolerance: CGFloat = 24
        let deadline = Date().addingTimeInterval(timeout)
        var lastObservedWidth: CGFloat?
        var stableSince: Date?
        repeat {
            if surface.exists && abs(surface.frame.width - width) <= tolerance {
                return true
            }
            if surface.exists && surface.frame.width >= 900 {
                let currentWidth = surface.frame.width
                if let previousWidth = lastObservedWidth, abs(previousWidth - currentWidth) <= 1 {
                    let now = Date()
                    if let stableSince, now.timeIntervalSince(stableSince) >= 0.35 {
                        return true
                    }
                    if stableSince == nil {
                        stableSince = now
                    }
                } else {
                    lastObservedWidth = currentWidth
                    stableSince = nil
                }
            }
            RunLoop.current.run(until: Date().addingTimeInterval(0.1))
        } while Date() < deadline
        return surface.exists && (abs(surface.frame.width - width) <= tolerance || surface.frame.width >= 900)
    }

    @MainActor
    private func waitForElementFrameWidth(
        _ element: XCUIElement,
        width: CGFloat,
        timeout: TimeInterval
    ) -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        repeat {
            if element.exists && abs(element.frame.width - width) <= 2 {
                return true
            }
            RunLoop.current.run(until: Date().addingTimeInterval(0.1))
        } while Date() < deadline
        return element.exists && abs(element.frame.width - width) <= 2
    }

    @MainActor
    private func waitForMainToFillSurface(
        _ main: XCUIElement,
        surface: XCUIElement,
        timeout: TimeInterval
    ) -> Bool {
        let tolerance: CGFloat = 8
        let deadline = Date().addingTimeInterval(timeout)
        repeat {
            if main.exists && surface.exists && abs(main.frame.maxX - surface.frame.maxX) <= tolerance {
                return true
            }
            RunLoop.current.run(until: Date().addingTimeInterval(0.1))
        } while Date() < deadline
        return main.exists && surface.exists && abs(main.frame.maxX - surface.frame.maxX) <= tolerance
    }

    @MainActor
    private func waitForColumnOffset(
        _ element: XCUIElement,
        from surface: XCUIElement,
        offset: CGFloat,
        timeout: TimeInterval
    ) -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        repeat {
            if element.exists && surface.exists && abs(element.frame.minX - (surface.frame.minX + offset)) <= 2 {
                return true
            }
            RunLoop.current.run(until: Date().addingTimeInterval(0.1))
        } while Date() < deadline
        return element.exists && surface.exists && abs(element.frame.minX - (surface.frame.minX + offset)) <= 2
    }

    private func expectedTaskAccessibilityOffset(railWidth: CGFloat) -> CGFloat {
        railWidth
    }

    @MainActor
    private func assertOpenDesignResponsiveColumns(
        surface: CGRect,
        rail: CGRect,
        tasks: CGRect,
        main: CGRect,
        meta: CGRect?,
        expectedRailWidth: CGFloat,
        expectedTaskSidebarWidth: CGFloat,
        expectedMetaPanelWidth: CGFloat?,
        file: StaticString = #filePath,
        line: UInt = #line
    ) {
        let tolerance: CGFloat = 2.0
        let surfaceEdgeTolerance: CGFloat = 8.0
        XCTAssertGreaterThanOrEqual(rail.minX, surface.minX - surfaceEdgeTolerance, "Rail should stay inside the workspace surface", file: file, line: line)
        XCTAssertLessThanOrEqual(rail.maxX, surface.maxX + surfaceEdgeTolerance, "Rail should stay inside the workspace surface", file: file, line: line)
        XCTAssertEqual(tasks.minX, surface.minX + expectedTaskAccessibilityOffset(railWidth: expectedRailWidth), accuracy: tolerance, "Task sidebar should start after the Open Design rail column", file: file, line: line)
        XCTAssertEqual(tasks.width, expectedTaskSidebarWidth, accuracy: tolerance, "Task sidebar width should match the Open Design breakpoint", file: file, line: line)
        XCTAssertEqual(tasks.maxX, main.minX, accuracy: tolerance, "Task sidebar and main content should share a boundary", file: file, line: line)

        if let meta, let expectedMetaPanelWidth {
            XCTAssertEqual(meta.width, expectedMetaPanelWidth, accuracy: tolerance, "Meta panel width should match the Open Design breakpoint", file: file, line: line)
            XCTAssertEqual(main.maxX, meta.minX, accuracy: tolerance, "Main content and meta panel should share a boundary", file: file, line: line)
            XCTAssertEqual(meta.maxX, surface.maxX, accuracy: surfaceEdgeTolerance, "Meta panel should terminate near the workspace surface edge", file: file, line: line)
        } else {
            XCTAssertEqual(main.maxX, surface.maxX, accuracy: surfaceEdgeTolerance, "Main content should fill the collapsed meta-panel space", file: file, line: line)
        }
    }

    @MainActor
    private func assertExecuteTodoLayoutStable(
        firstDecisionCard: XCUIElement,
        baselineFirstDecisionFrame: CGRect,
        openInboxButton: XCUIElement,
        baselineOpenInboxFrame: CGRect,
        todoListWindow: XCUIElement,
        baselineTodoListFrame: CGRect,
        file: StaticString = #filePath,
        line: UInt = #line
    ) {
        let firstDecisionFrame = firstDecisionCard.frame
        XCTAssertEqual(firstDecisionFrame.minY, baselineFirstDecisionFrame.minY, accuracy: 2.0, file: file, line: line)
        XCTAssertEqual(firstDecisionFrame.midX, baselineFirstDecisionFrame.midX, accuracy: 2.0, file: file, line: line)

        let openInboxFrame = openInboxButton.frame
        XCTAssertEqual(openInboxFrame.maxX, baselineOpenInboxFrame.maxX, accuracy: 2.0, file: file, line: line)
        XCTAssertEqual(openInboxFrame.midY, baselineOpenInboxFrame.midY, accuracy: 2.0, file: file, line: line)

        let todoListFrame = todoListWindow.frame
        XCTAssertEqual(todoListFrame.minY, baselineTodoListFrame.minY, accuracy: 2.0, file: file, line: line)
        XCTAssertEqual(todoListFrame.height, baselineTodoListFrame.height, accuracy: 2.0, file: file, line: line)
    }

    @MainActor
    private func assertBootLogLayoutStableUntilDecisionReady(
        bootLog: XCUIElement,
        baselineFrame: CGRect,
        readyElement: XCUIElement,
        timeout: TimeInterval = 8,
        file: StaticString = #filePath,
        line: UInt = #line
    ) {
        let deadline = Date().addingTimeInterval(timeout)
        repeat {
            if readyElement.exists && readyElement.isEnabled {
                return
            }
            RunLoop.current.run(until: Date().addingTimeInterval(0.35))
            if readyElement.exists && readyElement.isEnabled {
                return
            }
            assertBootLogLayoutStable(
                bootLog: bootLog,
                baselineFrame: baselineFrame,
                file: file,
                line: line
            )
        } while Date() < deadline && !(readyElement.exists && readyElement.isEnabled)
    }

    @MainActor
    private func assertBootLogLayoutStable(
        bootLog: XCUIElement,
        baselineFrame: CGRect,
        file: StaticString = #filePath,
        line: UInt = #line
    ) {
        let frame = bootLog.frame
        XCTAssertEqual(frame.minY, baselineFrame.minY, accuracy: 2.0, file: file, line: line)
        XCTAssertEqual(frame.midX, baselineFrame.midX, accuracy: 2.0, file: file, line: line)
        XCTAssertEqual(frame.width, baselineFrame.width, accuracy: 2.0, file: file, line: line)
        XCTAssertEqual(frame.height, baselineFrame.height, accuracy: 2.0, file: file, line: line)
    }

    @MainActor
    private func assertIntakeProgress(
        in app: XCUIApplication,
        current: Int,
        timeout: TimeInterval = 5,
        file: StaticString = #filePath,
        line: UInt = #line
    ) {
        let expectedLabel = "Step \(current) of 8"
        let progress = app.descendants(matching: .any)
            .matching(NSPredicate(
                format: "identifier == %@ AND label == %@",
                "intakeV2.progress",
                expectedLabel
            ))
            .firstMatch
        XCTAssertTrue(
            progress.waitForExistence(timeout: timeout),
            "Expected intake progress label: \(expectedLabel)",
            file: file,
            line: line
        )
    }

    @MainActor
    private struct IntakeLayoutBaseline {
        var windowFrame: CGRect?
        var shellFrame: CGRect?
        var progressFrame: CGRect?
        var primaryButtonFrame: CGRect?
        var executePrimaryButtonFrame: CGRect?
    }

    @MainActor
    private func assertStableIntakeStepLayout(
        in app: XCUIApplication,
        current: Int,
        timeout: TimeInterval = 5,
        baseline: inout IntakeLayoutBaseline,
        file: StaticString = #filePath,
        line: UInt = #line
    ) {
        assertIntakeProgress(
            in: app,
            current: current,
            timeout: timeout,
            file: file,
            line: line
        )

        let shell = elementWithIdentifier(in: app, "intakeV2.stepShell")
        XCTAssertTrue(
            shell.waitForExistence(timeout: timeout),
            "Expected intake step shell for step \(current)",
            file: file,
            line: line
        )

        let windowFrame = app.windows.firstMatch.frame
        let shellFrame = shell.frame

        if let baselineFrame = baseline.windowFrame {
            XCTAssertEqual(windowFrame.width, baselineFrame.width, accuracy: 1.0, file: file, line: line)
            XCTAssertEqual(windowFrame.height, baselineFrame.height, accuracy: 1.0, file: file, line: line)
        } else {
            baseline.windowFrame = windowFrame
        }

        if let baselineFrame = baseline.shellFrame {
            XCTAssertEqual(shellFrame.width, baselineFrame.width, accuracy: 1.0, file: file, line: line)
            XCTAssertEqual(shellFrame.height, baselineFrame.height, accuracy: 1.0, file: file, line: line)
        } else {
            baseline.shellFrame = shellFrame
        }

        let progress = intakeProgressElement(in: app, current: current)
        XCTAssertTrue(
            progress.waitForExistence(timeout: timeout),
            "Expected intake progress frame for step \(current)",
            file: file,
            line: line
        )
        let progressFrame = progress.frame
        if let baselineFrame = baseline.progressFrame {
            XCTAssertEqual(progressFrame.minX, baselineFrame.minX, accuracy: 1.5, file: file, line: line)
            XCTAssertEqual(progressFrame.minY, baselineFrame.minY, accuracy: 1.5, file: file, line: line)
        } else {
            baseline.progressFrame = progressFrame
        }

        if current == 6 && !button(in: app, matching: ["Continue →", "Continue"]).exists {
            return
        }

        let primaryButton = intakePrimaryButton(in: app, current: current)
        XCTAssertTrue(
            primaryButton.waitForExistence(timeout: timeout),
            "Expected intake primary button for step \(current)",
            file: file,
            line: line
        )
        let primaryFrame = primaryButton.frame
        if current == 8 {
            if let baselineFrame = baseline.executePrimaryButtonFrame {
                XCTAssertEqual(primaryFrame.maxX, baselineFrame.maxX, accuracy: 1.5, file: file, line: line)
                XCTAssertEqual(primaryFrame.midY, baselineFrame.midY, accuracy: 1.5, file: file, line: line)
            } else {
                baseline.executePrimaryButtonFrame = primaryFrame
            }
        } else if let baselineFrame = baseline.primaryButtonFrame {
            XCTAssertEqual(primaryFrame.maxX, baselineFrame.maxX, accuracy: 1.5, file: file, line: line)
            XCTAssertEqual(primaryFrame.midY, baselineFrame.midY, accuracy: 1.5, file: file, line: line)
        } else {
            baseline.primaryButtonFrame = primaryFrame
        }
    }

    @MainActor
    private func intakeProgressElement(in app: XCUIApplication, current: Int) -> XCUIElement {
        let expectedLabel = "Step \(current) of 8"
        return app.descendants(matching: .any)
            .matching(NSPredicate(
                format: "identifier == %@ AND label == %@",
                "intakeV2.progress",
                expectedLabel
            ))
            .firstMatch
    }

    @MainActor
    private func intakePrimaryButton(in app: XCUIApplication, current: Int) -> XCUIElement {
        switch current {
        case 2, 3, 4, 5:
            return button(in: app, matching: ["Next →", "Next"])
        case 7:
            return button(in: app, matching: ["Continue →", "Continue", "Skip →", "Skip"])
        case 8:
            return elementWithIdentifier(in: app, "intakeV2.openInboxButton")
        default:
            return button(in: app, matching: ["Continue →", "Continue"])
        }
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

    private func waitForPreferredModelSettings(
        appSupportPath: String,
        claude: String,
        codex: String,
        gemini: String,
        timeout: TimeInterval
    ) -> Bool {
        let deadline = Date().addingTimeInterval(timeout)

        repeat {
            if let models = preferredModelSettings(appSupportPath: appSupportPath),
               models.claude == claude,
               models.codex == codex,
               models.gemini == gemini {
                return true
            }

            RunLoop.current.run(until: Date().addingTimeInterval(0.2))
        } while Date() < deadline

        guard let models = preferredModelSettings(appSupportPath: appSupportPath) else {
            return false
        }
        return models.claude == claude && models.codex == codex && models.gemini == gemini
    }

    private func preferredModelSettings(appSupportPath: String) -> (claude: String, codex: String, gemini: String)? {
        let secretsURL = URL(fileURLWithPath: appSupportPath, isDirectory: true)
            .appendingPathComponent("dev-secrets.json")
        guard let data = try? Data(contentsOf: secretsURL),
              let rawObject = try? JSONSerialization.jsonObject(with: data),
              let object = rawObject as? [String: Any],
              let settings = object["settings"] as? [String: Any],
              let claude = settings["preferredClaudeModel"] as? String,
              let codex = settings["preferredCodexModel"] as? String,
              let gemini = settings["preferredGeminiModel"] as? String
        else {
            return nil
        }

        return (claude, codex, gemini)
    }

    @MainActor
    private func element(_ element: XCUIElement, contains marker: String) -> Bool {
        element.label.contains(marker) || ((element.value as? String)?.contains(marker) ?? false)
    }

    @MainActor
    private func clickCenter(of element: XCUIElement) {
        if element.waitForExistence(timeout: 2), element.isHittable {
            element.click()
            return
        }
        element.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).click()
    }

    @MainActor
    private func movePointerAwayFromContent() {
        CGWarpMouseCursorPosition(CGPoint(x: 2, y: 2))
        RunLoop.current.run(until: Date().addingTimeInterval(0.1))
    }

    @MainActor
    private func scrollElementToVisible(
        _ element: XCUIElement,
        in app: XCUIApplication,
        timeout: TimeInterval,
        scrollViewIdentifier: String? = nil
    ) -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        repeat {
            let scrollView = scrollViewElement(in: app, identifier: scrollViewIdentifier)
            if elementIsVisible(element, in: scrollView, app: app) {
                return true
            }
            if scrollView.exists {
                scrollToward(element, in: scrollView)
            }
            RunLoop.current.run(until: Date().addingTimeInterval(0.15))
        } while Date() < deadline
        return elementIsVisible(element, in: scrollViewElement(in: app, identifier: scrollViewIdentifier), app: app)
    }

    @MainActor
    private func scrollSettingsContentUntilHittable(
        _ element: XCUIElement,
        in app: XCUIApplication,
        timeout: TimeInterval
    ) -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        repeat {
            if element.exists && element.isHittable {
                return true
            }
            let scrollView = scrollViewElement(in: app, identifier: "settings.contentScroll")
            if scrollView.exists {
                scrollToward(element, in: scrollView)
            }
            RunLoop.current.run(until: Date().addingTimeInterval(0.2))
        } while Date() < deadline
        return element.exists && element.isHittable
    }

    @MainActor
    private func scrollViewElement(in app: XCUIApplication, identifier: String?) -> XCUIElement {
        guard let identifier else {
            return app.scrollViews.firstMatch
        }
        let identifiedElement = elementWithIdentifier(in: app, identifier)
        if identifiedElement.exists {
            return identifiedElement
        }
        let identifiedScrollView = app.scrollViews[identifier]
        if identifiedScrollView.exists {
            return identifiedScrollView
        }
        let fallbackScrollView = app.scrollViews.firstMatch
        return fallbackScrollView
    }

    @MainActor
    private func elementIsVisible(_ element: XCUIElement, in scrollView: XCUIElement, app: XCUIApplication) -> Bool {
        guard element.exists else {
            return false
        }
        if element.isHittable {
            return true
        }
        guard scrollView.exists else {
            return false
        }
        let elementFrame = element.frame
        guard !elementFrame.isEmpty else {
            return false
        }
        let visibleFrame = scrollView.frame.insetBy(dx: 0, dy: 6)
        if !visibleFrame.isEmpty {
            return visibleFrame.intersects(elementFrame)
        }
        let windowFrame = app.windows.firstMatch.frame.insetBy(dx: 0, dy: 6)
        return !windowFrame.isEmpty && windowFrame.intersects(elementFrame)
    }

    @MainActor
    private func scrollToward(_ element: XCUIElement, in scrollView: XCUIElement) {
        guard element.exists else {
            scrollUp(in: scrollView)
            return
        }
        if element.frame.minY < scrollView.frame.minY {
            scrollDown(in: scrollView)
        } else {
            scrollUp(in: scrollView)
        }
    }

    @MainActor
    private func scrollUp(in element: XCUIElement) {
        element.swipeUp()
        RunLoop.current.run(until: Date().addingTimeInterval(0.1))
        let start = element.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.78))
        let end = element.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.24))
        start.press(forDuration: 0.05, thenDragTo: end)
    }

    @MainActor
    private func scrollDown(in element: XCUIElement) {
        element.swipeDown()
        RunLoop.current.run(until: Date().addingTimeInterval(0.1))
        let start = element.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.24))
        let end = element.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.78))
        start.press(forDuration: 0.05, thenDragTo: end)
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

    @MainActor
    private func waitUntilHittable(_ element: XCUIElement, timeout: TimeInterval) -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        repeat {
            if element.exists && element.isHittable {
                return true
            }
            RunLoop.current.run(until: Date().addingTimeInterval(0.25))
        } while Date() < deadline
        return element.exists && element.isHittable
    }

    @MainActor
    private func waitForOpenDesignMainHittable(
        _ element: XCUIElement,
        in app: XCUIApplication,
        timeout: TimeInterval
    ) -> Bool {
        if waitUntilHittable(element, timeout: 1) {
            return true
        }
        _ = scrollElementToVisible(
            element,
            in: app,
            timeout: timeout,
            scrollViewIdentifier: "opendesign.day.main.scroll"
        )
        return waitUntilHittable(element, timeout: 1)
    }

    @MainActor
    private func tapOpenDesignHandoffButton(
        containing text: String,
        in app: XCUIApplication,
        expecting identifier: String,
        file: StaticString = #filePath,
        line: UInt = #line
    ) {
        hideKnownInterferingApplications()
        app.activate()
        let nextButton = buttonContaining(in: app, text: text)
        guard waitForOpenDesignMainHittable(nextButton, in: app, timeout: 6) else {
            attachScreenshot(from: app, named: "OpenDesign handoff button not hittable before \(identifier)")
            attachText(app.debugDescription, named: "OpenDesign handoff button accessibility tree")
            XCTFail(
                "Expected OpenDesign handoff button containing \(text)",
                file: file,
                line: line
            )
            return
        }
        clickCenter(of: nextButton)
        let expectedElement = elementWithIdentifier(in: app, identifier)
        guard waitForOpenDesignMainHittable(expectedElement, in: app, timeout: 8) else {
            attachScreenshot(from: app, named: "OpenDesign handoff failed before \(identifier)")
            attachText(app.debugDescription, named: "OpenDesign handoff accessibility tree")
            XCTFail(
                "Expected OpenDesign handoff to reveal \(identifier)",
                file: file,
                line: line
            )
            return
        }
    }

    @MainActor
    private func waitForButtonLabel(
        in app: XCUIApplication,
        identifier: String,
        containing marker: String,
        timeout: TimeInterval
    ) -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        repeat {
            let button = app.buttons[identifier]
            if button.exists && element(button, contains: marker) {
                return true
            }
            RunLoop.current.run(until: Date().addingTimeInterval(0.25))
        } while Date() < deadline
        let button = app.buttons[identifier]
        return button.exists && element(button, contains: marker)
    }

    @MainActor
    private func waitForElementLabel(
        in app: XCUIApplication,
        identifier: String,
        containing marker: String,
        timeout: TimeInterval
    ) -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        repeat {
            let element = elementWithIdentifier(in: app, identifier)
            if element.exists && self.element(element, contains: marker) {
                return true
            }
            RunLoop.current.run(until: Date().addingTimeInterval(0.25))
        } while Date() < deadline
        let element = elementWithIdentifier(in: app, identifier)
        return element.exists && self.element(element, contains: marker)
    }

    @MainActor
    private func waitForElementToDisappear(_ element: XCUIElement, timeout: TimeInterval) -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        repeat {
            if !element.exists {
                return true
            }
            RunLoop.current.run(until: Date().addingTimeInterval(0.2))
        } while Date() < deadline
        return !element.exists
    }

    @MainActor
    private func attachScreenshot(from app: XCUIApplication, named name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    @MainActor
    private func attachWindowScreenshot(from app: XCUIApplication, named name: String) {
        let window = app.windows.firstMatch
        let surface = elementWithIdentifier(in: app, "workspace.surface")
        let shell = elementWithIdentifier(in: app, "opendesign.day.shell")
        let screenshot: XCUIScreenshot
        if surface.waitForExistence(timeout: 2), surface.frame.height > 300 {
            screenshot = surface.screenshot()
        } else if shell.waitForExistence(timeout: 1) {
            screenshot = shell.screenshot()
        } else if window.waitForExistence(timeout: 1) {
            screenshot = window.screenshot()
        } else {
            screenshot = app.screenshot()
        }
        let attachment = XCTAttachment(screenshot: screenshot)
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
    private func buttonContaining(in app: XCUIApplication, text: String) -> XCUIElement {
        app.buttons
            .matching(NSPredicate(format: "label CONTAINS %@", text))
            .firstMatch
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
