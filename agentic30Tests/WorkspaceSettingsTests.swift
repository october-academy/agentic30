import XCTest
import Darwin
@testable import agentic30

final class WorkspaceSettingsTests: XCTestCase {
    private let defaultsKey = "agentic30.workspaceRoot"
    private let productionLegacyProvider: () -> String = {
        KeychainHelper.loadSettings().bipWorkspaceRoot
    }

    override func setUp() {
        super.setUp()
        // Hermetic: stub the legacy keychain fallback so tests don't depend on
        // (or mutate) whatever the dev box's login keychain happens to hold.
        WorkspaceSettings.legacyWorkspaceProvider = { "" }
        UserDefaults.standard.removeObject(forKey: defaultsKey)
    }

    override func tearDown() {
        UserDefaults.standard.removeObject(forKey: defaultsKey)
        WorkspaceSettings.legacyWorkspaceProvider = productionLegacyProvider
        super.tearDown()
    }

    func testResolvedURLFallsBackToHomeWhenUnset() {
        let resolved = WorkspaceSettings.resolvedURL()
        XCTAssertEqual(resolved.standardized, FileManager.default.homeDirectoryForCurrentUser.standardized)
        XCTAssertFalse(WorkspaceSettings.hasExplicitWorkspace)
    }

    func testStorePersistsAndResolves() {
        let tmp = FileManager.default.temporaryDirectory.appendingPathComponent(
            "agentic30-workspace-\(UUID().uuidString)",
            isDirectory: true
        )
        try? FileManager.default.createDirectory(at: tmp, withIntermediateDirectories: true)
        addTeardownBlock {
            try? FileManager.default.removeItem(at: tmp)
        }
        WorkspaceSettings.store(tmp)

        XCTAssertTrue(WorkspaceSettings.hasExplicitWorkspace)
        XCTAssertEqual(WorkspaceSettings.resolvedURL().path, tmp.path)
    }

    func testClearRemovesStoredPath() {
        let tmp = FileManager.default.temporaryDirectory
            .appendingPathComponent("agentic30-clear-\(UUID().uuidString)", isDirectory: true)
        try? FileManager.default.createDirectory(at: tmp, withIntermediateDirectories: true)
        addTeardownBlock {
            try? FileManager.default.removeItem(at: tmp)
        }
        WorkspaceSettings.store(tmp)
        XCTAssertTrue(WorkspaceSettings.hasExplicitWorkspace)

        WorkspaceSettings.clear()
        XCTAssertFalse(WorkspaceSettings.hasExplicitWorkspace)
    }

    func testHasExplicitWorkspaceMigratesLegacyWorkspaceRoot() {
        let legacy = FileManager.default.temporaryDirectory
            .appendingPathComponent("agentic30-legacy-\(UUID().uuidString)", isDirectory: true)
        try? FileManager.default.createDirectory(at: legacy, withIntermediateDirectories: true)
        addTeardownBlock {
            try? FileManager.default.removeItem(at: legacy)
        }
        WorkspaceSettings.legacyWorkspaceProvider = { legacy.path }

        XCTAssertTrue(WorkspaceSettings.hasExplicitWorkspace)
        XCTAssertEqual(UserDefaults.standard.string(forKey: defaultsKey), legacy.path)
        XCTAssertEqual(WorkspaceSettings.resolvedURL().path, legacy.path)
    }

    func testDisplayPathPrefersExplicitWorkspaceOverLegacyFallback() {
        let explicit = FileManager.default.temporaryDirectory
            .appendingPathComponent("agentic30-display-\(UUID().uuidString)", isDirectory: true)
        try? FileManager.default.createDirectory(at: explicit, withIntermediateDirectories: true)
        addTeardownBlock {
            try? FileManager.default.removeItem(at: explicit)
        }
        WorkspaceSettings.store(explicit)

        let displayed = WorkspaceSettings.displayPath(legacyFallback: "/tmp/legacy-bip-root")

        XCTAssertEqual(displayed, explicit.path)
    }

    func testMissingStoredWorkspaceIsClearedAndFallsBackHome() {
        let missing = FileManager.default.temporaryDirectory
            .appendingPathComponent("agentic30-missing-\(UUID().uuidString)", isDirectory: true)
        WorkspaceSettings.store(missing)

        XCTAssertFalse(WorkspaceSettings.hasExplicitWorkspace)
        XCTAssertEqual(WorkspaceSettings.resolvedURL().standardized, FileManager.default.homeDirectoryForCurrentUser.standardized)
        XCTAssertNil(UserDefaults.standard.string(forKey: defaultsKey))
    }

    func testDisplayPathFallsBackToLegacyWhenExplicitWorkspaceIsUnset() {
        let displayed = WorkspaceSettings.displayPath(legacyFallback: "/tmp/legacy-bip-root")

        XCTAssertEqual(displayed, "/tmp/legacy-bip-root")
    }

    func testFoundationProgressStorePersistsByWorkspaceAndAppSupport() {
        let appSupport = FileManager.default.temporaryDirectory
            .appendingPathComponent("agentic30-progress-support-\(UUID().uuidString)", isDirectory: true)
        let workspace = FileManager.default.temporaryDirectory
            .appendingPathComponent("agentic30-progress-workspace-\(UUID().uuidString)", isDirectory: true)
        try? FileManager.default.createDirectory(at: workspace, withIntermediateDirectories: true)
        addTeardownBlock {
            try? FileManager.default.removeItem(at: appSupport)
            try? FileManager.default.removeItem(at: workspace)
        }

        let store = FoundationProgressStore(workspaceRoot: workspace.path, appSupportURL: appSupport)
        let startedAt = Date(timeIntervalSince1970: 1_777_000_000)
        store.save(
            FoundationProgressSnapshot(
                workspaceRoot: workspace.path,
                startedAt: startedAt,
                selectedDay: 2,
                completedDays: [1]
            )
        )

        let loaded = store.load()
        XCTAssertEqual(loaded?.workspaceRoot, workspace.path)
        XCTAssertEqual(loaded?.startedAt, startedAt)
        XCTAssertEqual(loaded?.selectedDay, 2)
        XCTAssertEqual(loaded?.completedDays, Set([1]))
        XCTAssertTrue(FileManager.default.fileExists(atPath: store.fileURL.path))
    }

    func testFoundationProgressStoreDoesNotInheritAcrossWorkspaces() {
        let appSupport = FileManager.default.temporaryDirectory
            .appendingPathComponent("agentic30-progress-isolation-\(UUID().uuidString)", isDirectory: true)
        let workspaceA = FileManager.default.temporaryDirectory
            .appendingPathComponent("agentic30-progress-a-\(UUID().uuidString)", isDirectory: true)
        let workspaceB = FileManager.default.temporaryDirectory
            .appendingPathComponent("agentic30-progress-b-\(UUID().uuidString)", isDirectory: true)
        try? FileManager.default.createDirectory(at: workspaceA, withIntermediateDirectories: true)
        try? FileManager.default.createDirectory(at: workspaceB, withIntermediateDirectories: true)
        addTeardownBlock {
            try? FileManager.default.removeItem(at: appSupport)
            try? FileManager.default.removeItem(at: workspaceA)
            try? FileManager.default.removeItem(at: workspaceB)
        }

        let storeA = FoundationProgressStore(workspaceRoot: workspaceA.path, appSupportURL: appSupport)
        let storeB = FoundationProgressStore(workspaceRoot: workspaceB.path, appSupportURL: appSupport)
        storeA.save(
            FoundationProgressSnapshot(
                workspaceRoot: workspaceA.path,
                startedAt: Date(timeIntervalSince1970: 1_777_000_000),
                selectedDay: 2,
                completedDays: [1]
            )
        )

        XCTAssertNotEqual(storeA.fileURL, storeB.fileURL)
        XCTAssertNotNil(storeA.load())
        XCTAssertNil(storeB.load())
    }

    func testFoundationProgressSnapshotUnlocksFoundationWeekAndNextPhaseAfterCompletion() {
        let startedAt = Date(timeIntervalSince1970: 1_777_000_000)
        var snapshot = FoundationProgressSnapshot(
            workspaceRoot: "/tmp/project",
            startedAt: startedAt,
            selectedDay: 1,
            completedDays: []
        )

        XCTAssertEqual(snapshot.currentDayNumber(now: startedAt.addingTimeInterval(25 * 60 * 60)), 2)
        XCTAssertTrue(snapshot.isUnlocked(1))
        XCTAssertTrue(snapshot.isUnlocked(2))
        XCTAssertTrue(snapshot.isUnlocked(7))
        XCTAssertFalse(snapshot.isUnlocked(8))

        snapshot.completedDays.insert(7)

        XCTAssertTrue(snapshot.isUnlocked(8))
        XCTAssertFalse(snapshot.isUnlocked(9))
    }

    func testDayOneCompletionSaveHandlerPersistsDoneStateAndUnlocksDayTwo() {
        let appSupport = FileManager.default.temporaryDirectory
            .appendingPathComponent("agentic30-day1-completion-support-\(UUID().uuidString)", isDirectory: true)
        let workspace = FileManager.default.temporaryDirectory
            .appendingPathComponent("agentic30-day1-completion-workspace-\(UUID().uuidString)", isDirectory: true)
        try? FileManager.default.createDirectory(at: workspace, withIntermediateDirectories: true)
        addTeardownBlock {
            try? FileManager.default.removeItem(at: appSupport)
            try? FileManager.default.removeItem(at: workspace)
        }

        let store = FoundationProgressStore(workspaceRoot: workspace.path, appSupportURL: appSupport)
        let handler = FoundationDayCompletionSaveHandler(store: store)
        let startedAt = Date(timeIntervalSince1970: 1_777_000_000)

        let result = handler.saveDayCompletion(
            1,
            snapshot: FoundationProgressSnapshot(
                workspaceRoot: workspace.path,
                startedAt: startedAt,
                selectedDay: 1,
                completedDays: []
            ),
            workspaceRoot: workspace.path
        )

        XCTAssertEqual(result.completedDay, 1)
        XCTAssertEqual(result.unlockedDay, 2)
        XCTAssertEqual(result.snapshot.completedDays, Set([1]))
        XCTAssertTrue(result.snapshot.isUnlocked(2))

        let loaded = store.load()
        XCTAssertEqual(loaded?.completedDays, Set([1]))
        XCTAssertEqual(loaded?.selectedDay, 2)
        XCTAssertEqual(loaded?.startedAt, startedAt)
    }

    func testDayOneCompletionIncludesDayTwoTopicTeaser() {
        let dayOne = BipCoachCurriculumDay(day: 1)
        let dayTwo = BipCoachCurriculumDay(day: 2)

        XCTAssertEqual(
            dayOne.completionNextDayTeaser,
            "다음: Day 2 Market - 돈이 흐르는 기준 시장을 가볍게 확인해보세요."
        )
        XCTAssertNil(dayTwo.completionNextDayTeaser)
    }

    func testCompletionQuestionCountLabelUsesTutorialProgressCount() {
        let oneQuestionMission = makeCompletedMission(completedQuestionCount: 1)
        let threeQuestionMission = makeCompletedMission(completedQuestionCount: 3)
        let missingProgressMission = makeCompletedMission(completedQuestionCount: nil)

        XCTAssertEqual(oneQuestionMission.completionQuestionCountLabel, "질문 1개 완료")
        XCTAssertEqual(threeQuestionMission.completionQuestionCountLabel, "질문 3개 완료")
        XCTAssertNil(missingProgressMission.completionQuestionCountLabel)
    }

    func testFoundationCurriculumPresentationViewModelRoutesGraduatedProgressToGraduation() {
        let active = FoundationProgressSnapshot(
            workspaceRoot: "/tmp/project",
            startedAt: Date(timeIntervalSince1970: 1_777_000_000),
            selectedDay: 12,
            completedDays: Set(1...11)
        )
        let graduated = FoundationProgressSnapshot(
            workspaceRoot: "/tmp/project",
            startedAt: Date(timeIntervalSince1970: 1_777_000_000),
            selectedDay: 30,
            completedDays: Set(1...30)
        )
        let staleGraduated = FoundationProgressSnapshot(
            workspaceRoot: "/tmp/project",
            startedAt: Date(timeIntervalSince1970: 1_777_000_000),
            selectedDay: 7,
            completedDays: Set(1...30)
        )

        XCTAssertEqual(
            FoundationCurriculumPresentationViewModel(snapshot: active).destination,
            .curriculumDay(12)
        )
        XCTAssertEqual(
            FoundationCurriculumPresentationViewModel(snapshot: graduated).destination,
            .graduation
        )
        XCTAssertEqual(
            FoundationCurriculumPresentationViewModel(snapshot: staleGraduated).destination,
            .graduation
        )
    }

    @MainActor
    func testCompletingDayThirtyEntersGraduationWithoutHidingRunningAppOrMenubarSurface() {
        let previousAppSupportPath = ProcessInfo.processInfo.environment["AGENTIC30_APP_SUPPORT_PATH"]
        let appSupportURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("agentic30-graduation-lifecycle-support-\(UUID().uuidString)", isDirectory: true)
        let workspaceURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("agentic30-graduation-lifecycle-workspace-\(UUID().uuidString)", isDirectory: true)
        try? FileManager.default.createDirectory(at: appSupportURL, withIntermediateDirectories: true)
        try? FileManager.default.createDirectory(at: workspaceURL, withIntermediateDirectories: true)
        setenv("AGENTIC30_APP_SUPPORT_PATH", appSupportURL.path, 1)
        WorkspaceSettings.store(workspaceURL)
        addTeardownBlock {
            if let previousAppSupportPath {
                setenv("AGENTIC30_APP_SUPPORT_PATH", previousAppSupportPath, 1)
            } else {
                unsetenv("AGENTIC30_APP_SUPPORT_PATH")
            }
            try? FileManager.default.removeItem(at: appSupportURL)
            try? FileManager.default.removeItem(at: workspaceURL)
        }

        var terminationRequests = 0
        var quitRequests = 0
        var appHideRequests = 0
        var menubarSurfaceHideRequests = 0
        var menubarItemUnregisterRequests = 0
        let lifecycleController = FoundationCurriculumLifecycleController(
            terminateApplication: { terminationRequests += 1 },
            quitApplication: { quitRequests += 1 },
            surfaceVisibilityController: FoundationCurriculumSurfaceVisibilityController(
                applicationIsRunning: { true },
                activeMenubarSurfaceIsVisible: { true },
                hideApplication: { appHideRequests += 1 },
                hideActiveMenubarSurface: { menubarSurfaceHideRequests += 1 }
            ),
            menubarItemController: MacMenubarItemController(
                menuBarItemIsRegistered: { true },
                unregisterMenuBarItem: { menubarItemUnregisterRequests += 1 }
            )
        )
        let viewModel = AgenticViewModel(
            disablesSidecarStartForTesting: true,
            foundationCurriculumLifecycleController: lifecycleController
        )

        for day in 1...30 {
            _ = viewModel.markFoundationDayCompleted(day)
        }

        XCTAssertEqual(viewModel.foundationCurriculumPresentationDestination, .graduation)
        XCTAssertEqual(
            lifecycleController.enterCompletedState(viewModel.foundationProgressState),
            .graduation
        )
        let visibility = lifecycleController.surfaceVisibilityAfterEnteringCompletedState(
            viewModel.foundationProgressState
        )
        XCTAssertEqual(
            visibility,
            FoundationCurriculumSurfaceVisibilitySnapshot(
                applicationIsRunning: true,
                activeMenubarSurfaceIsVisible: true
            )
        )
        XCTAssertEqual(
            lifecycleController.menubarItemRegistrationAfterEnteringCompletedState(
                viewModel.foundationProgressState
            ),
            MacMenubarItemRegistrationSnapshot(isRegistered: true)
        )
        XCTAssertEqual(terminationRequests, 0)
        XCTAssertEqual(quitRequests, 0)
        XCTAssertEqual(appHideRequests, 0)
        XCTAssertEqual(menubarSurfaceHideRequests, 0)
        XCTAssertEqual(menubarItemUnregisterRequests, 0)
    }

    @MainActor
    func testMacMenubarItemControllerKeepsItemRegisteredWhenCurriculumGraduates() {
        var unregisterRequests = 0
        let menubarItemController = MacMenubarItemController(
            menuBarItemIsRegistered: { true },
            unregisterMenuBarItem: { unregisterRequests += 1 }
        )

        let snapshot = menubarItemController.enterCompletedOrGraduatedState()

        XCTAssertEqual(snapshot, MacMenubarItemRegistrationSnapshot(isRegistered: true))
        XCTAssertEqual(unregisterRequests, 0)
    }

    func testWorkspaceScanResultStorePersistsDay1PlanByWorkspace() {
        let appSupport = FileManager.default.temporaryDirectory
            .appendingPathComponent("agentic30-scan-support-\(UUID().uuidString)", isDirectory: true)
        let workspace = FileManager.default.temporaryDirectory
            .appendingPathComponent("agentic30-scan-workspace-\(UUID().uuidString)", isDirectory: true)
        try? FileManager.default.createDirectory(at: workspace, withIntermediateDirectories: true)
        addTeardownBlock {
            try? FileManager.default.removeItem(at: appSupport)
            try? FileManager.default.removeItem(at: workspace)
        }

        let store = WorkspaceScanResultStore(workspaceRoot: workspace.path, appSupportURL: appSupport)
        store.save(makeWorkspaceScanResult(), now: Date(timeIntervalSince1970: 1_777_000_000))

        let loaded = store.load()
        XCTAssertEqual(loaded?.icp, "docs/ICP.md")
        XCTAssertEqual(loaded?.day1IcpPlan?.schemaVersion, 1)
        XCTAssertEqual(loaded?.day1IcpPlan?.questions.count, 3)
        XCTAssertTrue(FileManager.default.fileExists(atPath: store.fileURL.path))
    }

    func testWorkspaceScanResultStoreDoesNotInheritAcrossWorkspaces() {
        let appSupport = FileManager.default.temporaryDirectory
            .appendingPathComponent("agentic30-scan-isolation-\(UUID().uuidString)", isDirectory: true)
        let workspaceA = FileManager.default.temporaryDirectory
            .appendingPathComponent("agentic30-scan-a-\(UUID().uuidString)", isDirectory: true)
        let workspaceB = FileManager.default.temporaryDirectory
            .appendingPathComponent("agentic30-scan-b-\(UUID().uuidString)", isDirectory: true)
        try? FileManager.default.createDirectory(at: workspaceA, withIntermediateDirectories: true)
        try? FileManager.default.createDirectory(at: workspaceB, withIntermediateDirectories: true)
        addTeardownBlock {
            try? FileManager.default.removeItem(at: appSupport)
            try? FileManager.default.removeItem(at: workspaceA)
            try? FileManager.default.removeItem(at: workspaceB)
        }

        let storeA = WorkspaceScanResultStore(workspaceRoot: workspaceA.path, appSupportURL: appSupport)
        let storeB = WorkspaceScanResultStore(workspaceRoot: workspaceB.path, appSupportURL: appSupport)
        storeA.save(makeWorkspaceScanResult())

        XCTAssertNotEqual(storeA.fileURL, storeB.fileURL)
        XCTAssertNotNil(storeA.load())
        XCTAssertNil(storeB.load())
    }

    func testWorkspaceScanResultStoreIgnoresCorruptCache() {
        let appSupport = FileManager.default.temporaryDirectory
            .appendingPathComponent("agentic30-scan-corrupt-\(UUID().uuidString)", isDirectory: true)
        let workspace = FileManager.default.temporaryDirectory
            .appendingPathComponent("agentic30-scan-corrupt-workspace-\(UUID().uuidString)", isDirectory: true)
        try? FileManager.default.createDirectory(at: workspace, withIntermediateDirectories: true)
        addTeardownBlock {
            try? FileManager.default.removeItem(at: appSupport)
            try? FileManager.default.removeItem(at: workspace)
        }

        let store = WorkspaceScanResultStore(workspaceRoot: workspace.path, appSupportURL: appSupport)
        try? FileManager.default.createDirectory(
            at: store.fileURL.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        try? Data("{not-json".utf8).write(to: store.fileURL)

        XCTAssertNil(store.load())
    }

    private func makeCompletedMission(completedQuestionCount: Int?) -> BipCoachMission {
        BipCoachMission(
            id: "mission-\(completedQuestionCount.map(String.init) ?? "none")",
            date: "2026-05-14",
            provider: AgentProvider.codex.rawValue,
            status: "completed",
            compact: false,
            title: "Day 1 완료",
            angle: "ICP 질문 제출",
            mission: "Day 1 ICP 질문 제출과 게이트 확인을 완료합니다.",
            curriculumDay: BipCoachCurriculumDay(day: 1),
            drafts: [],
            eveningChecklist: [],
            evidenceRefs: [],
            generatedAt: nil,
            completedAt: nil,
            completedQuestionCount: completedQuestionCount,
            threadsUrl: nil,
            sheetRowNote: nil
        )
    }

    private func makeWorkspaceScanResult() -> AgenticViewModel.WorkspaceScanResult {
        AgenticViewModel.WorkspaceScanResult(
            icp: "docs/ICP.md",
            spec: "docs/SPEC.md",
            values: "docs/VALUES.md",
            designSystem: nil,
            adr: nil,
            goal: "docs/GOAL.md",
            docs: "README.md",
            sheet: nil,
            onboardingHypothesis: WorkspaceOnboardingHypothesis(
                productName: "SupportLens",
                projectKind: "saas",
                targetUser: "B2B SaaS support lead",
                problem: "Slack escalation을 놓침",
                purpose: "Escalation triage",
                goal: "유료 후보 1명 검증",
                values: nil,
                likelyUsers: ["support lead"],
                stage: "first_users",
                evidence: ["README.md"],
                confidence: "high",
                suggestedFirstQuestion: nil
            ),
            day1AlignmentPlan: nil,
            day1IcpPlan: makeDay1IcpPlan(),
            error: nil
        )
    }

    private func makeDay1IcpPlan() -> Day1IcpPlan {
        let options = [
            Day1IcpQuestionOption(
                id: "support-lead",
                label: "support lead",
                description: "Slack escalation을 매일 처리합니다.",
                preview: "ICP",
                antiSignal: false
            ),
            Day1IcpQuestionOption(
                id: "curious-only",
                label: "관심만 있음",
                description: "최근 사건이 없습니다.",
                preview: "Anti",
                antiSignal: true
            ),
        ]
        let questions = ["icp", "pain_point", "outcome"].map { dimension in
            Day1IcpQuestion(
                id: dimension,
                dimension: dimension,
                title: dimension,
                prompt: "\(dimension) 질문",
                helperText: nil,
                options: options,
                allowFreeText: true,
                freeTextPlaceholder: "직접 입력"
            )
        }
        return Day1IcpPlan(
            schemaVersion: 1,
            source: "test",
            generatedAt: "2026-05-22T00:00:00.000Z",
            confidence: 0.8,
            fellBackToDeterministic: false,
            mission: "Day 1 ICP를 좁힙니다.",
            signals: Day1IcpSignals(
                productName: "SupportLens",
                currentIcpGuess: "B2B SaaS support lead",
                likelyUsers: ["support lead"],
                problem: "Slack escalation을 놓침",
                currentAlternatives: ["수동 Slack 확인"],
                evidenceRefs: [
                    Day1IcpEvidenceRef(path: "README.md", reason: "README", quote: "# SupportLens"),
                ],
                missingAssumptions: [],
                confidence: "high"
            ),
            questions: questions,
            icpDraft: IcpDraft(
                description: "B2B SaaS support lead",
                criteria: ["Slack escalation을 다룸"],
                whyTheyMatter: ["매일 반복되는 통증"],
                needs: ["빠른 triage"],
                haves: ["Slack"],
                dontNeeds: ["관심만 있음"],
                evidence: ["README.md"],
                referenceCustomersToFind: ["support lead 1명"]
            ),
            antiIcp: Day1AntiIcp(
                summary: "관심만 있고 최근 사건이 없는 후보는 제외합니다.",
                rules: [
                    AntiIcpRule(
                        id: "curious-only",
                        label: "관심만 있음",
                        reason: "최근 행동 신호가 없습니다.",
                        evidenceRef: nil
                    ),
                ],
                politeInterestGuardrails: ["좋네요만 말하면 제외"]
            ),
            firstInterviewMessage: FirstInterviewMessage(
                channel: "DM",
                recipientPlaceholder: "{name}",
                subject: nil,
                bodyTemplate: "최근 Slack escalation을 놓친 적이 있나요?",
                questions: ["최근 사건은?", "현재 대안은?"]
            )
        )
    }
}

final class WorkspaceInitialWindowSizingTests: XCTestCase {
    private var defaults: UserDefaults!
    private var suiteName: String!

    override func setUp() {
        super.setUp()
        suiteName = "agentic30.workspace.initialSizing.\(UUID().uuidString)"
        defaults = UserDefaults(suiteName: suiteName)
        defaults.removePersistentDomain(forName: suiteName)
    }

    override func tearDown() {
        defaults.removePersistentDomain(forName: suiteName)
        defaults = nil
        suiteName = nil
        super.tearDown()
    }

    func testFirstLaunchMaximizesWorkspaceWindowOnce() {
        XCTAssertTrue(AppDelegate.shouldMaximizeWorkspaceWindowOnLaunch(
            isFirstLaunchEver: true,
            isUITesting: false,
            defaults: defaults
        ))

        defaults.set(true, forKey: AppDelegate.initialWorkspaceMaximizeDefaultsKey)

        XCTAssertFalse(AppDelegate.shouldMaximizeWorkspaceWindowOnLaunch(
            isFirstLaunchEver: true,
            isUITesting: false,
            defaults: defaults
        ))
    }

    func testUpgradeLaunchDoesNotMaximizeWorkspaceWindow() {
        XCTAssertFalse(AppDelegate.shouldMaximizeWorkspaceWindowOnLaunch(
            isFirstLaunchEver: false,
            isUITesting: false,
            defaults: defaults
        ))
    }

    func testUITestingLaunchDoesNotMaximizeWorkspaceWindow() {
        XCTAssertFalse(AppDelegate.shouldMaximizeWorkspaceWindowOnLaunch(
            isFirstLaunchEver: true,
            isUITesting: true,
            defaults: defaults
        ))
    }
}
