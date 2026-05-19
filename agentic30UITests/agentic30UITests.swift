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
            "AGENTIC30_CODEX_MODEL": "gpt-5.4-mini",
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
        XCTAssertTrue(app.staticTexts["첫 결정을 만들 프로젝트 폴더를 선택할까요?"].waitForExistence(timeout: 5))
        assertStableIntakeStepLayout(
            in: app,
            current: 6,
            baseline: &intakeLayoutBaseline
        )
        XCTAssertTrue(button(in: app, matching: ["Back"]).exists)
        XCTAssertFalse(button(in: app, matching: ["Continue →", "Continue"]).exists)
        clickCenter(of: buttonContaining(in: app, text: "폴더 선택하기"))
        XCTAssertTrue(buttonContaining(in: app, text: "다른 폴더 선택").waitForExistence(timeout: 3))
        XCTAssertFalse(buttonContaining(in: app, text: "나중에 폴더 선택").exists)
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
        let day1ReadyHandoff = elementWithIdentifier(in: app, "intakeV2.day1ReadyHandoff")
        XCTAssertTrue(bootLog.waitForExistence(timeout: 5))
        let bootLogFrameBeforeDecision = bootLog.frame
        assertBootLogLayoutStableUntilDecisionReady(
            bootLog: bootLog,
            baselineFrame: bootLogFrameBeforeDecision,
            readyElement: day1ReadyHandoff
        )
        XCTAssertTrue(day1ReadyHandoff.waitForExistence(timeout: 30))
        assertBootLogLayoutStable(bootLog: bootLog, baselineFrame: bootLogFrameBeforeDecision)
        XCTAssertTrue(openInbox.waitForExistence(timeout: 5))
        XCTAssertFalse(executeButton.exists)
        XCTAssertFalse(firstDecisionCard.exists)
        XCTAssertFalse(todoListWindow.exists)
        XCTAssertTrue(waitForButtonLabel(in: app, identifier: "intakeV2.openInboxButton", containing: "Open inbox", timeout: 10))
        XCTAssertTrue(waitUntilEnabled(openInbox, timeout: 5))
        openInbox.click()
        XCTAssertTrue(app.descendants(matching: .any)["opendesign.day.shell"].waitForExistence(timeout: 30))
        XCTAssertTrue(app.descendants(matching: .any)["opendesign.day.task.day1"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.descendants(matching: .any)["opendesign.day.task.day2"].waitForExistence(timeout: 10))
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
        XCTAssertTrue(app.staticTexts["첫 결정을 만들 프로젝트 폴더를 선택할까요?"].waitForExistence(timeout: 5))
        XCTAssertFalse(button(in: app, matching: ["Continue →", "Continue"]).exists)
        clickCenter(of: buttonContaining(in: app, text: "나중에 폴더 선택"))

        XCTAssertTrue(app.staticTexts["읽을 기록 더 연결하기"].waitForExistence(timeout: 10))
        assertIntakeProgress(in: app, current: 7)
        let githubSource = buttonContaining(in: app, text: "GitHub")
        XCTAssertTrue(githubSource.waitForExistence(timeout: 5))
        clickCenter(of: githubSource)
        XCTAssertTrue(buttonContaining(in: app, text: "Connected later").waitForExistence(timeout: 3))
        XCTAssertFalse(element(githubSource, contains: "Connected ·"))
        clickCenter(of: button(in: app, matching: ["Continue →", "Continue", "Skip →", "Skip"]))

        assertIntakeProgress(in: app, current: 8, timeout: 10)
        let day1ReadyHandoff = elementWithIdentifier(in: app, "intakeV2.day1ReadyHandoff")
        XCTAssertTrue(day1ReadyHandoff.waitForExistence(timeout: 30))
        let renderedTree = app.debugDescription
        XCTAssertTrue(renderedTree.contains("폴더 없이 시작합니다"))
        XCTAssertFalse(renderedTree.contains("kernel.init"))
        XCTAssertFalse(renderedTree.contains("signals.detect"))
        XCTAssertFalse(renderedTree.contains("context.read (no folder)"))
        XCTAssertFalse(renderedTree.contains("intake-only"))
        XCTAssertFalse(renderedTree.contains("당신의 폴더를 읽고"))
        let openInbox = elementWithIdentifier(in: app, "intakeV2.openInboxButton")
        XCTAssertTrue(openInbox.exists)
        XCTAssertTrue(openInbox.isEnabled)
        XCTAssertTrue(waitForButtonLabel(in: app, identifier: "intakeV2.openInboxButton", containing: "Open inbox", timeout: 5))
        XCTAssertFalse(elementWithIdentifier(in: app, "intakeV2.executeButton").exists)
        XCTAssertFalse(elementWithIdentifier(in: app, "intakeV2.firstDecisionCard").exists)
        XCTAssertFalse(elementWithIdentifier(in: app, "intakeV2.todoListWindow").exists)
        XCTAssertTrue(button(in: app, matching: ["Back"]).exists)
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
        XCTAssertTrue(app.staticTexts["첫 결정을 만들 프로젝트 폴더를 선택할까요?"].waitForExistence(timeout: 5))
        clickCenter(of: buttonContaining(in: app, text: "나중에 폴더 선택"))

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
            attachScreenshot(from: app, named: "OpenDesign Day Shell Missing")
            attachText(app.debugDescription, named: "OpenDesign Day Shell Missing Tree")
        }
        XCTAssertTrue(openDesignShell.exists)
        attachScreenshot(from: app, named: "OpenDesign Day Initial Wide")

        let workspaceSurface = elementWithIdentifier(in: app, "workspace.surface")
        let tasks = elementWithIdentifier(in: app, "opendesign.day.tasks")
        let main = elementWithIdentifier(in: app, "opendesign.day.main")
        let meta = elementWithIdentifier(in: app, "opendesign.day.meta")
        XCTAssertTrue(workspaceSurface.exists)
        XCTAssertTrue(tasks.exists)
        XCTAssertTrue(main.exists)
        XCTAssertTrue(meta.exists)
        XCTAssertTrue(elementWithIdentifier(in: app, "opendesign.day.header.context").exists)
        XCTAssertTrue(waitForButtonLabel(in: app, identifier: "opendesign.day.header.primary", containing: "인터뷰 계속", timeout: 2))
        let shareButton = elementWithIdentifier(in: app, "opendesign.day.share")
        XCTAssertTrue(shareButton.exists)
        clickCenter(of: shareButton)
        XCTAssertTrue(waitForButtonLabel(in: app, identifier: "opendesign.day.share", containing: "복사됨", timeout: 2))
        assertOpenDesignWideColumns(surface: workspaceSurface.frame, tasks: tasks.frame, main: main.frame, meta: meta.frame)

        let searchButton = elementWithIdentifier(in: app, "opendesign.day.search")
        XCTAssertTrue(searchButton.exists)
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

        app.typeText("/")
        XCTAssertTrue(elementWithIdentifier(in: app, "opendesign.day.searchPalette").waitForExistence(timeout: 5))
        let slashSearchField = elementWithIdentifier(in: app, "opendesign.day.searchField")
        XCTAssertTrue(slashSearchField.waitForExistence(timeout: 3))
        slashSearchField.typeText("3")
        XCTAssertTrue(day3SearchResult.waitForExistence(timeout: 3))
        app.typeKey(XCUIKeyboardKey.return, modifierFlags: [])
        XCTAssertTrue(waitForElementToDisappear(elementWithIdentifier(in: app, "opendesign.day.searchPalette"), timeout: 3))

        let primaryHeaderAction = app.buttons["opendesign.day.header.primary"]
        XCTAssertTrue(primaryHeaderAction.waitForExistence(timeout: 3))
        clickCenter(of: primaryHeaderAction)

        let missionAccept = app.buttons["opendesign.day.mission.accept"]
        XCTAssertTrue(waitUntilHittable(missionAccept, timeout: 5))
        clickCenter(of: missionAccept)
        XCTAssertTrue(waitForButtonLabel(in: app, identifier: "opendesign.day.mission.accept", containing: "미션 수락됨", timeout: 2))

        let postMissionSearchButton = elementWithIdentifier(in: app, "opendesign.day.search")
        XCTAssertTrue(postMissionSearchButton.waitForExistence(timeout: 3))
        clickCenter(of: postMissionSearchButton)
        XCTAssertTrue(elementWithIdentifier(in: app, "opendesign.day.searchPalette").waitForExistence(timeout: 5))
        let icpSearchField = elementWithIdentifier(in: app, "opendesign.day.searchField")
        XCTAssertTrue(icpSearchField.waitForExistence(timeout: 3))
        clickCenter(of: icpSearchField)
        icpSearchField.typeText("4지선다")
        let icpPickerSearchResult = app.buttons["opendesign.day.search.result.section-picker"]
        XCTAssertTrue(icpPickerSearchResult.waitForExistence(timeout: 3))
        app.typeKey(XCUIKeyboardKey.return, modifierFlags: [])
        XCTAssertTrue(waitForElementToDisappear(elementWithIdentifier(in: app, "opendesign.day.searchPalette"), timeout: 3))

        let icpOption = app.buttons["opendesign.day.icp.option.3"]
        XCTAssertTrue(waitUntilHittable(icpOption, timeout: 5))
        clickCenter(of: icpOption)
        XCTAssertTrue(waitForElementLabel(in: app, identifier: "opendesign.day.icp.footer.status", containing: "선택됨 · 3번", timeout: 3))

        let icpSubmit = app.buttons["opendesign.day.icp.submit"]
        XCTAssertTrue(icpSubmit.waitForExistence(timeout: 3))
        XCTAssertTrue(icpSubmit.isEnabled)
        clickCenter(of: icpSubmit)
        XCTAssertTrue(waitForButtonLabel(in: app, identifier: "opendesign.day.icp.submit", containing: "제출됨", timeout: 3))
        XCTAssertTrue(waitForElementLabel(in: app, identifier: "opendesign.day.icp.footer.status", containing: "제출 완료 · 3번", timeout: 3))
        XCTAssertTrue(waitForElementLabel(in: app, identifier: "opendesign.day.icp.option.3", containing: "제출됨", timeout: 3))
        XCTAssertTrue(app.buttons["opendesign.day.interview.2.option.1"].waitForExistence(timeout: 5))
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

        let newsRailItem = elementWithIdentifier(in: app, "opendesign.day.rail.item.news")
        XCTAssertTrue(newsRailItem.exists)
        clickCenter(of: newsRailItem)

        let side = elementWithIdentifier(in: app, "opendesign.reference.news.side")
        let main = elementWithIdentifier(in: app, "opendesign.reference.news.main")
        let meta = elementWithIdentifier(in: app, "opendesign.reference.news.meta")
        let takeaway = elementWithIdentifier(in: app, "opendesign.reference.news.takeaway")
        if !main.waitForExistence(timeout: 5) || !side.exists || !meta.exists || !takeaway.exists {
            attachScreenshot(from: app, named: "OpenDesign News Wide Missing")
            attachText(app.debugDescription, named: "OpenDesign News Wide Missing Tree")
        }
        XCTAssertTrue(side.exists)
        XCTAssertTrue(main.exists)
        XCTAssertTrue(meta.exists)
        XCTAssertTrue(takeaway.exists)

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

        let bipRailItem = elementWithIdentifier(in: app, "opendesign.day.rail.item.bip")
        XCTAssertTrue(bipRailItem.exists)
        clickCenter(of: bipRailItem)

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

        let interviewsRailItem = elementWithIdentifier(in: app, "opendesign.day.rail.item.interviews")
        XCTAssertTrue(interviewsRailItem.exists)
        clickCenter(of: interviewsRailItem)

        let side = elementWithIdentifier(in: app, "opendesign.reference.interviews.side")
        let main = elementWithIdentifier(in: app, "opendesign.reference.interviews.main")
        let meta = elementWithIdentifier(in: app, "opendesign.reference.interviews.meta")
        if !main.waitForExistence(timeout: 5) || !side.exists || !meta.exists {
            attachScreenshot(from: app, named: "OpenDesign Interviews Wide Missing")
            attachText(app.debugDescription, named: "OpenDesign Interviews Wide Missing Tree")
        }
        XCTAssertTrue(side.exists)
        XCTAssertTrue(main.exists)
        XCTAssertTrue(meta.exists)
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

        let projectsRailItem = elementWithIdentifier(in: app, "opendesign.day.rail.item.projects")
        XCTAssertTrue(projectsRailItem.exists)
        clickCenter(of: projectsRailItem)

        let side = elementWithIdentifier(in: app, "opendesign.reference.projects.side")
        let main = elementWithIdentifier(in: app, "opendesign.reference.projects.main")
        let meta = elementWithIdentifier(in: app, "opendesign.reference.projects.meta")
        let overview = elementWithIdentifier(in: app, "opendesign.reference.projects.overview.card")
        if !main.waitForExistence(timeout: 5) || !side.exists || !meta.exists || !overview.exists {
            attachScreenshot(from: app, named: "OpenDesign Projects Wide Missing")
            attachText(app.debugDescription, named: "OpenDesign Projects Wide Missing Tree")
        }
        XCTAssertTrue(side.exists)
        XCTAssertTrue(main.exists)
        XCTAssertTrue(meta.exists)
        XCTAssertTrue(overview.exists)

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

        completeOpenDesignDayInterviews(in: app)

        let previewCopy = app.buttons["opendesign.day.icpPreview.copy"]
        XCTAssertTrue(waitForOpenDesignMainHittable(previewCopy, in: app, timeout: 6))
        app.buttons["opendesign.day.icpPreview.copy"].click()
        XCTAssertTrue(waitForButtonLabel(in: app, identifier: "opendesign.day.icpPreview.copy", containing: "복사됨", timeout: 3))

        let previewNext = elementWithIdentifier(in: app, "opendesign.day.preview.next")
        XCTAssertTrue(waitForOpenDesignMainHittable(previewNext, in: app, timeout: 6))
        clickCenter(of: elementWithIdentifier(in: app, "opendesign.day.preview.next"))
        XCTAssertTrue(elementWithIdentifier(in: app, "opendesign.day.final").waitForExistence(timeout: 5))

        tapOpenDesignHandoffButton(containing: "후보/Anti-ICP", in: app, expecting: "opendesign.day.candidate")
        XCTAssertTrue(elementWithIdentifier(in: app, "opendesign.day.candidate.replace").waitForExistence(timeout: 3))

        tapOpenDesignHandoffButton(containing: "약속 슬롯", in: app, expecting: "opendesign.day.slot")

        let selectedSlot = app.buttons["opendesign.day.slot.2"]
        XCTAssertTrue(waitForOpenDesignMainHittable(selectedSlot, in: app, timeout: 6))
        app.buttons["opendesign.day.slot.2"].click()

        tapOpenDesignHandoffButton(containing: "첫 메시지", in: app, expecting: "opendesign.day.message")

        let dmCopy = app.buttons["opendesign.day.dm.copy"]
        XCTAssertTrue(waitForOpenDesignMainHittable(dmCopy, in: app, timeout: 6))
        app.buttons["opendesign.day.dm.copy"].click()
        XCTAssertTrue(waitForButtonLabel(in: app, identifier: "opendesign.day.dm.copy", containing: "복사됨", timeout: 3))

        tapOpenDesignHandoffButton(containing: "Day 1 게이트", in: app, expecting: "opendesign.day.gate")

        let interviewGate = app.buttons["opendesign.day.gate.row.3"]
        XCTAssertTrue(waitForOpenDesignMainHittable(interviewGate, in: app, timeout: 6))
        app.buttons["opendesign.day.gate.row.3"].click()
        XCTAssertTrue(waitForElementLabel(in: app, identifier: "opendesign.day.gate.row.3", containing: "완료", timeout: 3))

        let complete = app.buttons["opendesign.day.complete"]
        XCTAssertTrue(waitForOpenDesignMainHittable(complete, in: app, timeout: 6))
        app.buttons["opendesign.day.complete"].click()
        XCTAssertTrue(waitForButtonLabel(in: app, identifier: "opendesign.day.complete", containing: "완료됨", timeout: 3))
        XCTAssertTrue(elementWithIdentifier(in: app, "opendesign.day.completion").waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["opendesign.day.day2"].waitForExistence(timeout: 5))
    }

    @MainActor
    func testOpenDesignDayPageResponsivePrimarySmoke() throws {
        try assertOpenDesignDayResponsiveLayout(
            windowSize: CGSize(width: 1136, height: 720),
            expectedRailWidth: 48,
            expectedTaskSidebarWidth: 220,
            expectedMetaPanelWidth: 252,
            screenshotName: "OpenDesign Day Responsive 1136"
        )
    }

    @MainActor
    func testOpenDesignDayPageResponsiveCompactSmoke() throws {
        try assertOpenDesignDayResponsiveLayout(
            windowSize: CGSize(width: 900, height: 720),
            expectedRailWidth: 48,
            expectedTaskSidebarWidth: 200,
            expectedMetaPanelWidth: nil,
            screenshotName: "OpenDesign Day Responsive 900"
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
                "--ui-testing-open-settings-section=agents",
                "--ui-testing-opaque-window",
            ],
            environment: [
                "AGENTIC30_APP_SUPPORT_PATH": appSupportPath,
                "AGENTIC30_UI_TEST_SETTINGS_CLAUDE_MODEL": "claude-opus-4-7",
                "AGENTIC30_UI_TEST_SETTINGS_CODEX_MODEL": "gpt-5.4-mini",
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
        XCTAssertTrue(app.staticTexts["Agents"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Anthropic Claude Code"].exists)
        XCTAssertTrue(app.staticTexts["OpenAI GPT Codex"].exists)
        XCTAssertTrue(app.staticTexts["Google Gemini"].exists)
        attachScreenshot(from: app, named: "01 Settings Model Pickers")

        let claudeApiField = elementWithIdentifier(in: app, "settings.claude.apiKeyField")
        XCTAssertTrue(claudeApiField.waitForExistence(timeout: 2))

        XCTAssertTrue(
            chooseModelOption(
                in: app,
                pickerIdentifier: "settings.claude.modelPicker",
                optionLabel: "Claude Opus 4.7 (Best)",
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
            "settings.agents.saveButton",
            timeout: 2
        ) ?? elementWithIdentifier(in: app, "settings.agents.saveButton")
        XCTAssertTrue(saveModels.waitForExistence(timeout: 2))
        clickCenter(of: saveModels)
        XCTAssertTrue(waitForPreferredModelSettings(
            appSupportPath: appSupportPath,
            claude: "claude-opus-4-7",
            codex: "gpt-5.4-mini",
            gemini: "gemini-2.5-flash",
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
    func testWorkspaceStartupShowsOpenDesignDayAndLocksFutureNavigation() throws {
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

        XCTAssertTrue(app.descendants(matching: .any)["opendesign.day.shell"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["먼저 도울 사람을 정해요"].exists)
        XCTAssertTrue(app.descendants(matching: .any)["opendesign.day.task.day1"].exists)
        XCTAssertTrue(app.descendants(matching: .any)["opendesign.day.task.day2"].exists)
        XCTAssertTrue(app.descendants(matching: .any)["opendesign.day.task.day2"].label.contains("잠금"))
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
    private func completeOpenDesignDayInterviews(
        in app: XCUIApplication,
        file: StaticString = #filePath,
        line: UInt = #line
    ) {
        let primaryHeaderAction = app.buttons["opendesign.day.header.primary"]
        XCTAssertTrue(waitUntilHittable(primaryHeaderAction, timeout: 5), file: file, line: line)
        clickCenter(of: primaryHeaderAction)

        let missionAccept = app.buttons["opendesign.day.mission.accept"]
        XCTAssertTrue(waitUntilHittable(missionAccept, timeout: 5), file: file, line: line)
        clickCenter(of: missionAccept)
        XCTAssertTrue(
            waitForButtonLabel(in: app, identifier: "opendesign.day.mission.accept", containing: "미션 수락됨", timeout: 3),
            file: file,
            line: line
        )

        submitOpenDesignInterviewStep(1, option: 3, in: app, file: file, line: line)
        submitOpenDesignInterviewStep(2, option: 1, in: app, file: file, line: line)
        submitOpenDesignInterviewStep(3, option: 2, in: app, file: file, line: line)
        submitOpenDesignInterviewStep(4, option: 1, in: app, file: file, line: line)

        XCTAssertTrue(app.buttons["opendesign.day.icpPreview.copy"].waitForExistence(timeout: 5), file: file, line: line)
    }

    @MainActor
    private func submitOpenDesignInterviewStep(
        _ step: Int,
        option: Int,
        in app: XCUIApplication,
        file: StaticString = #filePath,
        line: UInt = #line
    ) {
        let optionIdentifier = step == 1 ? "opendesign.day.icp.option.\(option)" : "opendesign.day.interview.\(step).option.\(option)"
        let submitIdentifier = step == 1 ? "opendesign.day.icp.submit" : "opendesign.day.interview.\(step).submit"
        let footerIdentifier = step == 1 ? "opendesign.day.icp.footer.status" : "opendesign.day.interview.\(step).footer.status"

        let choice = app.buttons[optionIdentifier]
        XCTAssertTrue(waitForOpenDesignMainHittable(choice, in: app, timeout: 6), file: file, line: line)
        app.buttons[optionIdentifier].click()
        XCTAssertTrue(
            waitForElementLabel(in: app, identifier: footerIdentifier, containing: "선택됨 · \(option)번", timeout: 3),
            file: file,
            line: line
        )

        let submit = app.buttons[submitIdentifier]
        XCTAssertTrue(waitUntilHittable(submit, timeout: 5), file: file, line: line)
        app.buttons[submitIdentifier].click()
        XCTAssertTrue(
            waitForElementLabel(in: app, identifier: footerIdentifier, containing: "제출 완료 · \(option)번", timeout: 3),
            file: file,
            line: line
        )

        if step < 4 {
            XCTAssertTrue(
                app.buttons["opendesign.day.interview.\(step + 1).option.1"].waitForExistence(timeout: 5),
                file: file,
                line: line
            )
        }
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
        app.staticTexts["Agents"].exists
            || app.staticTexts["Agent Models"].exists
            || app.staticTexts["Developer Tools"].exists
            // Sidebar identifiers — pick whichever section the launch flag opened to.
            || elementWithIdentifier(in: app, "settings.section.agents").exists
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
        expectedTaskSidebarWidth: CGFloat,
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
        let tasks = elementWithIdentifier(in: app, "opendesign.day.tasks")
        let main = elementWithIdentifier(in: app, "opendesign.day.main")
        let meta = elementWithIdentifier(in: app, "opendesign.day.meta")
        XCTAssertTrue(rail.exists, file: file, line: line)
        XCTAssertTrue(tasks.exists, file: file, line: line)
        XCTAssertTrue(main.exists, file: file, line: line)
        XCTAssertTrue(
            waitForColumnOffset(tasks, from: workspaceSurface, offset: expectedTaskAccessibilityOffset(railWidth: expectedRailWidth), timeout: 5),
            "Expected task sidebar to start after rail width \(expectedRailWidth), got rail=\(rail.frame), tasks=\(tasks.frame), surface=\(workspaceSurface.frame), window=\(app.windows.firstMatch.frame)",
            file: file,
            line: line
        )
        XCTAssertTrue(
            waitForElementFrameWidth(tasks, width: expectedTaskSidebarWidth, timeout: 5),
            "Expected task sidebar width \(expectedTaskSidebarWidth), got tasks=\(tasks.frame), surface=\(workspaceSurface.frame), window=\(app.windows.firstMatch.frame)",
            file: file,
            line: line
        )
        if let expectedMetaPanelWidth {
            XCTAssertTrue(
                waitForElementFrameWidth(meta, width: expectedMetaPanelWidth, timeout: 5),
                "Expected meta width \(expectedMetaPanelWidth), got meta=\(meta.frame), surface=\(workspaceSurface.frame), window=\(app.windows.firstMatch.frame)",
                file: file,
                line: line
            )
        }

        assertOpenDesignResponsiveColumns(
            surface: workspaceSurface.frame,
            rail: rail.frame,
            tasks: tasks.frame,
            main: main.frame,
            meta: expectedMetaPanelWidth == nil ? nil : meta.frame,
            expectedRailWidth: expectedRailWidth,
            expectedTaskSidebarWidth: expectedTaskSidebarWidth,
            expectedMetaPanelWidth: expectedMetaPanelWidth,
            file: file,
            line: line
        )
        if expectedMetaPanelWidth == nil {
            XCTAssertFalse(meta.exists, "Meta panel should collapse at this native responsive width", file: file, line: line)
        } else {
            XCTAssertTrue(meta.exists, file: file, line: line)
        }
    }

    @MainActor
    private func waitForOpenDesignSurfaceWidth(
        _ surface: XCUIElement,
        width: CGFloat,
        timeout: TimeInterval
    ) -> Bool {
        let tolerance: CGFloat = 24
        let deadline = Date().addingTimeInterval(timeout)
        repeat {
            if surface.exists && abs(surface.frame.width - width) <= tolerance {
                return true
            }
            RunLoop.current.run(until: Date().addingTimeInterval(0.1))
        } while Date() < deadline
        return surface.exists && abs(surface.frame.width - width) <= tolerance
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
            RunLoop.current.run(until: Date().addingTimeInterval(0.35))
            assertBootLogLayoutStable(
                bootLog: bootLog,
                baselineFrame: baselineFrame,
                file: file,
                line: line
            )
        } while Date() < deadline && !readyElement.exists
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
        if let baselineFrame = baseline.primaryButtonFrame {
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
        element.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).click()
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
            if element.exists && element.isHittable {
                return true
            }
            let scrollView: XCUIElement
            if let scrollViewIdentifier {
                scrollView = elementWithIdentifier(in: app, scrollViewIdentifier)
            } else {
                scrollView = app.scrollViews.firstMatch
            }
            if scrollView.exists {
                scrollUp(in: scrollView)
            } else {
                app.swipeUp()
            }
            RunLoop.current.run(until: Date().addingTimeInterval(0.15))
        } while Date() < deadline
        return element.exists && element.isHittable
    }

    @MainActor
    private func scrollUp(in element: XCUIElement) {
        let start = element.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.78))
        let end = element.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.24))
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
        clickCenter(of: buttonContaining(in: app, text: text))
        let expectedElement = elementWithIdentifier(in: app, identifier)
        guard expectedElement.waitForExistence(timeout: 5) else {
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
        let button = app.buttons[identifier]
        repeat {
            if button.exists && element(button, contains: marker) {
                return true
            }
            RunLoop.current.run(until: Date().addingTimeInterval(0.25))
        } while Date() < deadline
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
        let element = elementWithIdentifier(in: app, identifier)
        repeat {
            if element.exists && self.element(element, contains: marker) {
                return true
            }
            RunLoop.current.run(until: Date().addingTimeInterval(0.25))
        } while Date() < deadline
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
