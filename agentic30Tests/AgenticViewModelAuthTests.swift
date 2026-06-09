import AuthenticationServices
import Foundation
import Testing
@testable import agentic30

private final class FakeWebAuthenticationSessionHandle: WebAuthenticationSessionHandle {
    private let startResult: Bool
    private(set) var startCallCount = 0

    init(startResult: Bool) {
        self.startResult = startResult
    }

    func start() -> Bool {
        startCallCount += 1
        return startResult
    }

    func cancel() {}
}

private final class FakeSidecarTransport: SidecarTransport {
    var onEvent: ((SidecarEvent) -> Void)?
    private(set) var startCallCount = 0
    private(set) var stopCallCount = 0
    private(set) var sentPayloads: [[String: Any]] = []

    private let workspaceRoot: String
    private static let decoder: JSONDecoder = {
        let decoder = JSONDecoder()
        let fractionalFormatter = ISO8601DateFormatter()
        fractionalFormatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        decoder.dateDecodingStrategy = .custom { decoder in
            let container = try decoder.singleValueContainer()
            if let timestamp = try? container.decode(Double.self) {
                return Date(timeIntervalSinceReferenceDate: timestamp)
            }
            let value = try container.decode(String.self)
            if let date = fractionalFormatter.date(from: value) ?? formatter.date(from: value) {
                return date
            }
            throw DecodingError.dataCorruptedError(
                in: container,
                debugDescription: "Invalid ISO8601 date: \(value)"
            )
        }
        return decoder
    }()

    init(workspaceRoot: String) {
        self.workspaceRoot = workspaceRoot
    }

    func start() {
        startCallCount += 1
    }

    func stop() {
        stopCallCount += 1
    }

    @discardableResult
    func send(payload: [String: Any]) -> Bool {
        sentPayloads.append(payload)
        return true
    }

    func resetSentPayloads() {
        sentPayloads.removeAll()
    }

    @MainActor
    func emit(_ json: String) throws {
        let data = try #require(json.data(using: .utf8))
        let event = try Self.decoder.decode(SidecarEvent.self, from: data)
        onEvent?(event)
    }
}

@Suite(.serialized)
struct AgenticViewModelAuthTests {
    @Test @MainActor func onboardingContextDecodesCurrentPayloadWithoutWorkMode() throws {
        let payload = """
        {
          "role": "developer",
          "project_stage": "building",
          "isolation_level": "project_folder",
          "completed_at": "2026-05-08T00:00:00Z"
        }
        """.data(using: .utf8)!

        let context = try JSONDecoder().decode(OnboardingContext.self, from: payload)

        #expect(context.workMode == .fullTimeSolo)
        #expect(context.role == .developer)
        #expect(context.projectStage == .building)
        #expect(context.isolationLevel == .projectFolder)
        #expect(context.isolationLevels == [.projectFolder])
        #expect(context.completedAt == "2026-05-08T00:00:00Z")
    }

    @Test @MainActor func onboardingContextEncodesWorkModeForSidecarContract() throws {
        let context = OnboardingContext(
            businessDescription: "AI assistant for solo founders",
            currentStage: "First users are active",
            goal: "Validate one paid user",
            customWorkMode: "주말마다 고객 인터뷰를 돌리는 중",
            workMode: .sideProject,
            role: .designer,
            projectStage: .preRevenue,
            isolationLevel: .weeklyLoop,
            isolationLevels: [.weeklyLoop, .paymentResponses],
            completedAt: "2026-05-08T00:00:00Z"
        )

        let data = try JSONEncoder().encode(context)
        let object = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        let bridgePayload = context.bridgePayload

        #expect(object?["business_description"] as? String == "AI assistant for solo founders")
        #expect(object?["current_stage"] as? String == "First users are active")
        #expect(object?["goal"] as? String == "Validate one paid user")
        #expect(object?["work_mode"] as? String == "side_project")
        #expect(object?["custom_work_mode"] as? String == "주말마다 고객 인터뷰를 돌리는 중")
        #expect(object?["role"] as? String == "designer")
        #expect(object?["project_stage"] as? String == "pre_revenue")
        #expect(object?["isolation_level"] as? String == "weekly_loop")
        #expect(object?["isolation_levels"] as? [String] == ["payment_responses", "weekly_loop"])
        #expect(object?["completed_at"] as? String == "2026-05-08T00:00:00Z")
        #expect((bridgePayload["business_description"] as? String) == (object?["business_description"] as? String))
        #expect((bridgePayload["current_stage"] as? String) == (object?["current_stage"] as? String))
        #expect((bridgePayload["goal"] as? String) == (object?["goal"] as? String))
        #expect((bridgePayload["custom_work_mode"] as? String) == (object?["custom_work_mode"] as? String))
        #expect((bridgePayload["work_mode"] as? String) == (object?["work_mode"] as? String))
        #expect((bridgePayload["role"] as? String) == (object?["role"] as? String))
        #expect((bridgePayload["project_stage"] as? String) == (object?["project_stage"] as? String))
        #expect((bridgePayload["isolation_level"] as? String) == (object?["isolation_level"] as? String))
        #expect((bridgePayload["isolation_levels"] as? [String]) == (object?["isolation_levels"] as? [String]))
        #expect((bridgePayload["completed_at"] as? String) == (object?["completed_at"] as? String))
    }

    @Test @MainActor func submitOnboardingContextPersistsCanonicalContextAndClearsDraftOnly() throws {
        let productionLegacyProvider = WorkspaceSettings.legacyWorkspaceProvider
        WorkspaceSettings.legacyWorkspaceProvider = { "" }
        UserDefaults.standard.removeObject(forKey: IntakeV2Store.stateDefaultsKey)
        UserDefaults.standard.removeObject(forKey: IntakeV2SourceManager.sourcesDefaultsKey)
        WorkspaceSettings.clear()

        let workspace = FileManager.default.temporaryDirectory
            .appendingPathComponent("agentic30-submit-context-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: workspace, withIntermediateDirectories: true)
        defer {
            UserDefaults.standard.removeObject(forKey: IntakeV2Store.stateDefaultsKey)
            UserDefaults.standard.removeObject(forKey: IntakeV2SourceManager.sourcesDefaultsKey)
            WorkspaceSettings.clear()
            WorkspaceSettings.legacyWorkspaceProvider = productionLegacyProvider
            try? FileManager.default.removeItem(at: workspace)
        }

        UserDefaults.standard.set(Data([0x01]), forKey: IntakeV2Store.stateDefaultsKey)
        UserDefaults.standard.set(Data([0x03]), forKey: IntakeV2SourceManager.sourcesDefaultsKey)
        WorkspaceSettings.store(workspace)

        let viewModel = AgenticViewModel(disablesSidecarStartForTesting: true, activateAppForAuth: {})
        let context = OnboardingContext(
            businessDescription: "Agentic30",
            currentStage: "first users",
            goal: "validate paid demand",
            customWorkMode: "하루 1~2시간",
            workMode: .sideProject,
            role: .productManager,
            projectStage: .firstUsers,
            isolationLevel: .projectFolder,
            isolationLevels: [.projectFolder, .paymentResponses],
            completedAt: "2026-05-08T00:00:00Z"
        )

        viewModel.submitOnboardingContext(context)

        let persisted = try #require(WorkspaceMemoryStore.loadOnboardingMemory(workspaceRoot: workspace.path))
        #expect(persisted.onboardingContext == context)
        #expect(persisted.projectPath == workspace.path)
        #expect(persisted.answers.primaryRole.answer == "product_manager")
        #expect(persisted.answers.timeBudget.answer == "하루 1~2시간")
        #expect(persisted.readSources.contains(where: { $0.id == "local_folder" }))
        #expect(UserDefaults.standard.data(forKey: IntakeV2Store.stateDefaultsKey) == nil)
        #expect(UserDefaults.standard.data(forKey: IntakeV2SourceManager.sourcesDefaultsKey) == Data([0x03]))
        #expect(WorkspaceSettings.resolvedURL().path == workspace.path)
    }

    @Test @MainActor func onboardingContextPersistsMultipleRecordSources() throws {
        let context = OnboardingContext(
            workMode: .fullTimeSolo,
            role: .developer,
            projectStage: .building,
            isolationLevel: .projectFolder,
            isolationLevels: [.workLog, .projectFolder, .workLog],
            completedAt: "2026-05-08T00:00:00Z"
        )

        let data = try JSONEncoder().encode(context)
        let decoded = try JSONDecoder().decode(OnboardingContext.self, from: data)

        #expect(decoded.isolationLevel == .projectFolder)
        #expect(decoded.isolationLevels == [.projectFolder, .workLog])
        #expect(decoded.assistantSystemPromptFragment.contains("project_folder,work_log"))
        #expect(decoded.assistantSystemPromptFragment.contains("프로젝트 폴더"))
        #expect(decoded.assistantSystemPromptFragment.contains("프로젝트 일지"))
    }

    @Test @MainActor func onboardingContextPersistsPaymentResponsesSource() throws {
        let context = OnboardingContext(
            workMode: .sideProject,
            role: .marketerBusiness,
            projectStage: .firstUsers,
            isolationLevel: .paymentResponses,
            completedAt: "2026-05-08T00:00:00Z"
        )

        let data = try JSONEncoder().encode(context)
        let object = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        let decoded = try JSONDecoder().decode(OnboardingContext.self, from: data)

        #expect(object?["isolation_level"] as? String == "payment_responses")
        #expect(object?["isolation_levels"] as? [String] == ["payment_responses"])
        #expect(decoded.isolationLevel == .paymentResponses)
        #expect(decoded.assistantSystemPromptFragment.contains("가격 제안"))
    }

    @Test @MainActor func onboardingContextQuestionResponsesRequireThreeDistinctAnswers() throws {
        do {
            _ = try OnboardingContextQuestionResponses(
                businessDescription: "AI menubar coach for indie builders",
                currentStage: "  ",
                goal: "Finish one verified customer interview loop"
            )
            Issue.record("Expected current stage validation to fail")
        } catch let error as OnboardingContextQuestionValidationError {
            #expect(error == .missingCurrentStage)
        }

        do {
            _ = try OnboardingContextQuestionResponses(
                businessDescription: "Same answer",
                currentStage: "same answer",
                goal: "Ship day 1"
            )
            Issue.record("Expected duplicate answer validation to fail")
        } catch let error as OnboardingContextQuestionValidationError {
            #expect(error == .duplicateAnswers)
        }
    }

    @Test @MainActor func onboardingContextQuestionResponsesBuildPersistedContext() throws {
        let responses = try OnboardingContextQuestionResponses(
            businessDescription: "A Mac menubar AI assistant for solo founders",
            currentStage: "MVP is built and first users are trying it",
            goal: "Reach 10 retained users in 30 days"
        )

        let context = responses.makeContext()
        let data = try JSONEncoder().encode(context)
        let object = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        let decoded = try JSONDecoder().decode(OnboardingContext.self, from: data)

        #expect(object?["business_description"] as? String == "A Mac menubar AI assistant for solo founders")
        #expect(object?["current_stage"] as? String == "MVP is built and first users are trying it")
        #expect(object?["goal"] as? String == "Reach 10 retained users in 30 days")
        #expect(decoded.businessDescription == responses.businessDescription)
        #expect(decoded.currentStage == responses.currentStage)
        #expect(decoded.goal == responses.goal)
        #expect(decoded.projectStage == .firstUsers)
        #expect(decoded.assistantSystemPromptFragment.contains("온보딩 답변"))
    }

    @Test @MainActor func onboardingCompletionTimingPlanCoversIntroAndThreeQuestionsUnderTwoMinutes() {
        let report = OnboardingCompletionTiming.plannedFlowReport()

        #expect(report.introSceneCount == OnboardingCompletionTiming.programIntroSceneCount)
        #expect(report.contextQuestionIDs == [
            "business_description",
            "current_stage",
            "goal",
        ])
        #expect(report.contextQuestionIDs.count == 3)
        #expect(report.estimatedSeconds == 94)
        #expect(report.canCompleteWithinBudget)
        #expect(report.remainingSeconds == 26)
    }

    @Test @MainActor func onboardingIntroContentIsRequiredBeforeContextQuestionsBegin() {
        let scenes = OnboardingProgramIntro.scenes
        let plannedSteps = OnboardingCompletionTiming.plannedSteps
        let introStepIDs = plannedSteps
            .prefix(OnboardingProgramIntro.requiredSceneIDs.count)
            .map(\.id)
        let firstContextQuestionIndex = plannedSteps.firstIndex { $0.kind == .contextQuestion }

        #expect(scenes.map(\.id) == OnboardingProgramIntro.requiredSceneIDs)
        #expect(scenes.map(\.id) == Array(introStepIDs))
        #expect(firstContextQuestionIndex == OnboardingProgramIntro.requiredSceneIDs.count)
        if let firstContextQuestionIndex {
            #expect(plannedSteps[..<firstContextQuestionIndex].allSatisfy { $0.kind == .programIntro })
        }
        #expect(Set(scenes.map(\.visual)).count == scenes.count)
        #expect(scenes.map(\.title) == [
            "혼자, 30일, 100명, 첫 매출",
            "혼자 만들지만, 혼자 막막하지 않게",
        ])
        #expect(scenes[0].subtitle.contains("30일 챌린지"))
        #expect(scenes[1].subtitle.contains("프로젝트 문서"))
    }

    @Test @MainActor func onboardingCompletionTimingValidatesMeasuredFullFlow() {
        let startedAt = Date(timeIntervalSince1970: 1_778_000_000)
        let completedAt = startedAt.addingTimeInterval(119)

        let report = OnboardingCompletionTiming.measuredFlowReport(
            startedAt: startedAt,
            completedAt: completedAt,
            introViewed: true,
            answeredQuestionIDs: [
                "onboardingContext.goal",
                "onboardingContext.businessDescription",
                "onboardingContext.currentStage",
            ]
        )

        #expect(report.isComplete)
        #expect(report.isWithinBudget)
        #expect(report.hasRequiredQuestions)
        #expect(report.missingQuestionIDs.isEmpty)
        #expect(report.answeredQuestionIDs == [
            "business_description",
            "current_stage",
            "goal",
        ])
    }

    @Test @MainActor func onboardingCompletionTimingRejectsOverBudgetOrIncompleteFlow() {
        let startedAt = Date(timeIntervalSince1970: 1_778_000_000)

        let overBudget = OnboardingCompletionTiming.measuredFlowReport(
            startedAt: startedAt,
            completedAt: startedAt.addingTimeInterval(121),
            introViewed: true,
            answeredQuestionIDs: [
                "business_description",
                "current_stage",
                "goal",
            ]
        )
        #expect(!overBudget.isComplete)
        #expect(!overBudget.isWithinBudget)

        let missingGoal = OnboardingCompletionTiming.measuredFlowReport(
            startedAt: startedAt,
            completedAt: startedAt.addingTimeInterval(90),
            introViewed: true,
            answeredQuestionIDs: [
                "business_description",
                "current_stage",
            ]
        )
        #expect(!missingGoal.isComplete)
        #expect(missingGoal.missingQuestionIDs == ["goal"])
    }

    @Test @MainActor func missingGoogleAuthDoesNotBlockLocalWorkspaceSelection() {
        WorkspaceSettings.clear()
        let productionLegacyProvider = WorkspaceSettings.legacyWorkspaceProvider
        WorkspaceSettings.legacyWorkspaceProvider = { "" }
        defer { WorkspaceSettings.clear() }
        defer { WorkspaceSettings.legacyWorkspaceProvider = productionLegacyProvider }

        let viewModel = AgenticViewModel(activateAppForAuth: {})

        #expect(viewModel.macAuthSession == nil)
        #expect(viewModel.needsProjectWorkspace == true)
        #expect(viewModel.needsOnboardingContext == true)

        viewModel.start()

        #expect(viewModel.connectionLabel == "Complete local setup")
        #expect(viewModel.isConnected == false)
    }

    @Test func selectedProviderPersistRoundTripsAndDefaultsToCodex() {
        let suiteName = "agentic30.tests.selectedProvider.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suiteName)!
        defer { defaults.removePersistentDomain(forName: suiteName) }

        // No stored value → default is Codex (matches the product default).
        #expect(AgenticViewModel.loadSelectedProvider(defaults: defaults) == .codex)

        // Every provider round-trips through save/load.
        for provider in AgentProvider.allCases {
            AgenticViewModel.saveSelectedProvider(provider, defaults: defaults)
            #expect(AgenticViewModel.loadSelectedProvider(defaults: defaults) == provider)
        }

        // A corrupted/unknown stored value falls back to Codex.
        defaults.set("not-a-real-provider", forKey: AgenticViewModel.selectedProviderDefaultsKey)
        #expect(AgenticViewModel.loadSelectedProvider(defaults: defaults) == .codex)
    }

    @Test @MainActor func bipResearchPrepareRequestsCacheThenDailyRefreshWhenStale() throws {
        let (workspace, cleanup) = try Self.installTemporaryWorkspace()
        defer { cleanup() }
        let sidecar = FakeSidecarTransport(workspaceRoot: workspace.path)
        let viewModel = Self.makeStartedViewModel(
            sidecar: sidecar,
            workspace: workspace,
            currentDay: 2
        )

        try sidecar.emit("""
        {
          "type": "bip_research_result",
          "bipResearch": {
            "schemaVersion": 1,
            "dayNumber": 2,
            "status": {
              "state": "stale",
              "stale": true
            },
            "candidates": []
          }
        }
        """)
        sidecar.resetSentPayloads()

        viewModel.prepareBipResearchForDisplay(curriculumDay: [
            "day": 2,
            "title": "시장 신호 읽기",
        ])

        let bipPayloads = sidecar.sentPayloads.filter {
            ($0["type"] as? String)?.hasPrefix("bip_research_") == true
        }
        try #require(bipPayloads.count == 2)
        #expect(bipPayloads[0]["type"] as? String == "bip_research_get")
        #expect(bipPayloads[0]["dayNumber"] as? Int == 2)
        #expect((bipPayloads[0]["curriculumDay"] as? [String: Any])?["title"] as? String == "시장 신호 읽기")
        #expect(bipPayloads[1]["type"] as? String == "bip_research_refresh")
        #expect(bipPayloads[1]["reason"] as? String == "daily")
        #expect(bipPayloads[1]["force"] as? Bool == false)
        #expect(bipPayloads[1]["dayNumber"] as? Int == 2)
    }

    @Test @MainActor func bipResearchManualRefreshSendsForceManualPayload() throws {
        let (workspace, cleanup) = try Self.installTemporaryWorkspace()
        defer { cleanup() }
        let sidecar = FakeSidecarTransport(workspaceRoot: workspace.path)
        let viewModel = Self.makeStartedViewModel(
            sidecar: sidecar,
            workspace: workspace,
            currentDay: 3
        )
        sidecar.resetSentPayloads()

        viewModel.refreshBipResearch(reason: "manual", force: true, curriculumDay: [
            "day": 3,
            "title": "고객 후보 좁히기",
        ])

        let payload = try #require(sidecar.sentPayloads.first)
        #expect(payload["type"] as? String == "bip_research_refresh")
        #expect(payload["reason"] as? String == "manual")
        #expect(payload["force"] as? Bool == true)
        #expect(payload["dayNumber"] as? Int == 3)
        #expect(payload["preferredProvider"] as? String == "codex")
        #expect((payload["curriculumDay"] as? [String: Any])?["title"] as? String == "고객 후보 좁히기")
    }

    @Test @MainActor func bipResearchUsesCurrentFoundationDayInsteadOfSelectedDay() throws {
        let (workspace, cleanup) = try Self.installTemporaryWorkspace()
        defer { cleanup() }
        let sidecar = FakeSidecarTransport(workspaceRoot: workspace.path)
        let viewModel = Self.makeStartedViewModel(
            sidecar: sidecar,
            workspace: workspace,
            currentDay: 4,
            selectedDay: 9
        )
        sidecar.resetSentPayloads()

        #expect(viewModel.selectedFoundationDay == 9)
        viewModel.prepareBipResearchForDisplay()

        let bipPayloads = sidecar.sentPayloads.filter {
            ($0["type"] as? String)?.hasPrefix("bip_research_") == true
        }
        try #require(bipPayloads.count == 2)
        #expect(bipPayloads.map { $0["dayNumber"] as? Int } == [4, 4])
    }

    @Test @MainActor func markFoundationDayCompletedEmitsProjectContextRefresh() throws {
        let (workspace, cleanup) = try Self.installTemporaryWorkspace()
        defer { cleanup() }
        let sidecar = FakeSidecarTransport(workspaceRoot: workspace.path)
        let viewModel = Self.makeStartedViewModel(
            sidecar: sidecar,
            workspace: workspace,
            currentDay: 1
        )

        let result = viewModel.markFoundationDayCompleted(1)
        let refreshPayloads = sidecar.sentPayloads.filter { $0["type"] as? String == "project_context_refresh" }

        try #require(refreshPayloads.count == 1)
        #expect(result.completedDay == 1)
        #expect(refreshPayloads[0]["reason"] as? String == "day_completed")
        #expect(refreshPayloads[0]["completedDay"] as? Int == 1)
        #expect(refreshPayloads[0]["unlockedDay"] as? Int == 2)
        #expect(refreshPayloads[0]["workspaceRoot"] as? String == workspace.path)
    }

    @Test @MainActor func workspaceScanResultPersistsAndHydratesDay1PlanAcrossLaunches() async throws {
        let (workspace, cleanupWorkspace) = try Self.installTemporaryWorkspace()
        let appSupport = FileManager.default.temporaryDirectory
            .appendingPathComponent("agentic30-viewmodel-scan-cache-\(UUID().uuidString)", isDirectory: true)
        let previousAppSupportPath = ProcessInfo.processInfo.environment["AGENTIC30_APP_SUPPORT_PATH"]
        setenv("AGENTIC30_APP_SUPPORT_PATH", appSupport.path, 1)
        KeychainHelper.deleteSettings()
        AgenticViewModel.workspaceScanResultAppSupportURLOverrideForTesting = appSupport
        defer {
            KeychainHelper.deleteSettings()
            if let previousAppSupportPath {
                setenv("AGENTIC30_APP_SUPPORT_PATH", previousAppSupportPath, 1)
            } else {
                unsetenv("AGENTIC30_APP_SUPPORT_PATH")
            }
            AgenticViewModel.workspaceScanResultAppSupportURLOverrideForTesting = nil
            cleanupWorkspace()
            try? FileManager.default.removeItem(at: appSupport)
        }

        let sidecar = FakeSidecarTransport(workspaceRoot: workspace.path)
        let firstLaunch = AgenticViewModel(
            onboardingContextOverride: Self.makeOnboardingContext(),
            sidecar: sidecar,
            activateAppForAuth: {}
        )
        firstLaunch.start()
        firstLaunch.markSidecarConnectedForTesting(workspaceRoot: workspace.path)
        try sidecar.emit(Self.workspaceScanResultPayload(workspaceRoot: workspace.path))
        try await Task.sleep(nanoseconds: 10_000_000)

        #expect(firstLaunch.scanResult?.day1IcpPlan?.questions.count == 3)

        let restored = AgenticViewModel(
            onboardingContextOverride: Self.makeOnboardingContext(),
            sidecar: FakeSidecarTransport(workspaceRoot: workspace.path),
            activateAppForAuth: {}
        )

        #expect(restored.workspaceRoot == workspace.path)
        #expect(restored.scanResult?.icp == "docs/ICP.md")
        #expect(restored.scanResult?.day1IcpPlan?.questions.count == 3)
    }

    @Test @MainActor func readyRequestsStartupWorkspaceScanOnceWhenCachedDay1PlanIsMissing() async throws {
        let (workspace, cleanupWorkspace) = try Self.installTemporaryWorkspace()
        let appSupport = FileManager.default.temporaryDirectory
            .appendingPathComponent("agentic30-viewmodel-scan-recovery-\(UUID().uuidString)", isDirectory: true)
        let previousAppSupportPath = ProcessInfo.processInfo.environment["AGENTIC30_APP_SUPPORT_PATH"]
        setenv("AGENTIC30_APP_SUPPORT_PATH", appSupport.path, 1)
        KeychainHelper.deleteSettings()
        AgenticViewModel.workspaceScanResultAppSupportURLOverrideForTesting = appSupport
        defer {
            KeychainHelper.deleteSettings()
            if let previousAppSupportPath {
                setenv("AGENTIC30_APP_SUPPORT_PATH", previousAppSupportPath, 1)
            } else {
                unsetenv("AGENTIC30_APP_SUPPORT_PATH")
            }
            AgenticViewModel.workspaceScanResultAppSupportURLOverrideForTesting = nil
            cleanupWorkspace()
            try? FileManager.default.removeItem(at: appSupport)
        }

        let sidecar = FakeSidecarTransport(workspaceRoot: workspace.path)
        let viewModel = AgenticViewModel(
            onboardingContextOverride: Self.makeOnboardingContext(),
            sidecar: sidecar,
            activateAppForAuth: {}
        )
        viewModel.start()

        let readyPayload = """
        {
          "type": "ready",
          "sessions": [],
          "workspaceRoot": "\(workspace.path)",
          "notionConnected": false
        }
        """
        try sidecar.emit(readyPayload)
        try sidecar.emit(readyPayload)
        try await Task.sleep(nanoseconds: 10_000_000)

        let scanPayloads = sidecar.sentPayloads.filter { $0["type"] as? String == "scan_workspace" }
        try #require(scanPayloads.count == 1)
        #expect(scanPayloads[0]["root"] as? String == workspace.path)
    }

    @Test @MainActor func bipMissionCompletionDoesNotEmitDuplicateProjectContextRefresh() throws {
        let (workspace, cleanup) = try Self.installTemporaryWorkspace()
        defer { cleanup() }
        let sidecar = FakeSidecarTransport(workspaceRoot: workspace.path)
        let viewModel = Self.makeStartedViewModel(
            sidecar: sidecar,
            workspace: workspace,
            currentDay: 1
        )
        viewModel.resetFoundationProgressForTesting()
        sidecar.resetSentPayloads()

        let mission = BipCoachMission(
            id: "mission-day-1",
            date: nil,
            provider: "codex",
            status: "completed",
            compact: nil,
            title: "Day 1 mission",
            angle: nil,
            mission: nil,
            curriculumDay: BipCoachCurriculumDay(day: 1),
            drafts: nil,
            eveningChecklist: nil,
            evidenceRefs: nil,
            generatedAt: nil,
            completedAt: nil,
            completedQuestionCount: nil,
            threadsUrl: nil,
            sheetRowNote: nil
        )
        _ = viewModel.advanceFromCompletedMission(mission)
        _ = viewModel.advanceFromCompletedMission(mission)

        let refreshPayloads = sidecar.sentPayloads.filter { $0["type"] as? String == "project_context_refresh" }
        try #require(refreshPayloads.count == 1)
        #expect(refreshPayloads[0]["completedDay"] as? Int == 1)
    }

    @Test @MainActor func volatileLocalDataResetRestoresFirstRunIntroGate() {
        KeychainHelper.resetAgentic30Defaults()
        defer { KeychainHelper.resetAgentic30Defaults() }

        let viewModel = AgenticViewModel(disablesSidecarStartForTesting: true, activateAppForAuth: {})
        viewModel.completeMacOnboardingIntro()
        let prompt = StructuredPromptRequest(
            requestId: "reset-draft",
            sessionId: "reset-session",
            toolName: "agentic30_request_user_input",
            title: "Reset draft",
            createdAt: Date(timeIntervalSince1970: 0),
            questions: [
                StructuredPromptQuestion(
                    questionId: "q1",
                    header: "Question",
                    question: "What should reset?",
                    helperText: nil,
                    options: nil,
                    multiSelect: nil,
                    allowFreeText: true,
                    requiresFreeText: true,
                    freeTextPlaceholder: nil,
                    textMode: nil
                ),
            ]
        )
        viewModel.updateStructuredPromptFreeText("draft that must reset", for: prompt.questions[0], in: prompt)

        #expect(viewModel.needsOnboardingIntro == false)
        #expect(viewModel.structuredPromptDraftBySession.isEmpty == false)

        viewModel.resetVolatileLocalUserDataStateForTesting()

        #expect(viewModel.needsOnboardingIntro == true)
        #expect(viewModel.structuredPromptDraftBySession.isEmpty)
    }

    @Test @MainActor func localDataResetClearsVolatileStateAndBumpsOnboardingGeneration() throws {
        KeychainHelper.resetAgentic30Defaults()
        let workspaceURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("agentic30-viewmodel-reset-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: workspaceURL, withIntermediateDirectories: true)
        WorkspaceSettings.store(workspaceURL)
        defer {
            KeychainHelper.resetAgentic30Defaults()
            try? FileManager.default.removeItem(at: workspaceURL)
        }

        var capturedOptions: Agentic30LocalDataResetOptions?
        var capturedWorkspaceURLs: [URL] = []
        let viewModel = AgenticViewModel(
            onboardingContextOverride: OnboardingContext.make(
                businessDescription: "Reset test",
                currentStage: "Testing",
                goal: "Verify reset",
                role: .developer,
                projectStage: .building,
                isolationLevel: .projectFolder
            ),
            disablesSidecarStartForTesting: true,
            localDataResetter: { options, workspaceURLs in
                capturedOptions = options
                capturedWorkspaceURLs = workspaceURLs
                KeychainHelper.resetAgentic30Defaults()
                return Agentic30LocalDataResetReport(
                    removedDefaultsCount: 1,
                    removedKeychainServiceEntries: true,
                    removedAppSupportPaths: ["/tmp/app-support"],
                    removedCachePaths: ["/tmp/cache"],
                    removedPreferencePaths: [],
                    removedSavedStatePaths: [],
                    removedQmdPaths: ["/tmp/qmd/agentic30.sqlite"],
                    removedWorkspaceAgentic30Paths: [workspaceURL.appendingPathComponent(".agentic30").path],
                    removedManagedWorkspaceContentPaths: [],
                    removedAppBundlePaths: [],
                    skippedPaths: [],
                    failures: []
                )
            },
            activateAppForAuth: {}
        )
        viewModel.completeMacOnboardingIntro()
        let beforeGeneration = viewModel.localDataResetGeneration

        let report = try viewModel.resetAgentic30LocalUserData()

        #expect(capturedOptions == Agentic30LocalDataResetOptions())
        #expect(capturedWorkspaceURLs.map(\.path).contains(workspaceURL.standardizedFileURL.path))
        #expect(report.removedQmdIndex)
        #expect(viewModel.localDataResetGeneration == beforeGeneration + 1)
        #expect(viewModel.requiresMacOnboarding == true)
        #expect(viewModel.needsOnboardingIntro == true)
        #expect(viewModel.needsOnboardingContext == true)
        #expect(viewModel.sessions.isEmpty)
        #expect(viewModel.selectedSessionID == nil)
    }

    @Test @MainActor func explicitWorkspaceAndLocalContextCanStartWithoutGoogleAuth() throws {
        let workspaceURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("agentic30-loginless-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: workspaceURL, withIntermediateDirectories: true)
        WorkspaceSettings.store(workspaceURL)
        defer {
            WorkspaceSettings.clear()
            try? FileManager.default.removeItem(at: workspaceURL)
        }

        let viewModel = AgenticViewModel(
            onboardingContextOverride: OnboardingContext.make(
                role: .developer,
                projectStage: .building,
                isolationLevel: .projectFolder
            ),
            activateAppForAuth: {}
        )

        #expect(viewModel.macAuthSession == nil)
        #expect(viewModel.requiresMacOnboarding == false)
        #expect(viewModel.needsProjectWorkspace == false)
        #expect(viewModel.needsOnboardingContext == false)
    }

    @Test @MainActor func onboardingWorkspacePrefetchStartsBeforeIntroCompletionWithoutAnchoringFoundation() throws {
        let workspaceURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("agentic30-prefetch-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: workspaceURL, withIntermediateDirectories: true)
        defer {
            WorkspaceSettings.clear()
            try? FileManager.default.removeItem(at: workspaceURL)
        }

        let viewModel = AgenticViewModel(disablesSidecarStartForTesting: true, activateAppForAuth: {})
        viewModel.resetFoundationProgressForTesting()
        let context = OnboardingContext.make(
            workMode: .teamStartup,
            role: .designer,
            projectStage: .firstUsers,
            isolationLevel: .projectFolder
        )

        viewModel.prefetchOnboardingWorkspace(url: workspaceURL, context: context)

        #expect(viewModel.requiresMacOnboarding == true)
        #expect(viewModel.needsOnboardingIntro == true)
        #expect(viewModel.needsOnboardingContext == false)
        #expect(viewModel.workspaceRoot == workspaceURL.path)
        #expect(viewModel.onboardingContext?.role == .designer)
        #expect(viewModel.foundationStartedAt == nil)
        #expect(viewModel.isScanning == true)
        #expect(viewModel.scanProgressMessage == "Waiting for workspace connection...")
    }

    @Test @MainActor func onboardingWorkspacePrefetchFingerprintChangeDropsStaleSessionSelection() throws {
        let firstWorkspaceURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("agentic30-prefetch-a-\(UUID().uuidString)", isDirectory: true)
        let secondWorkspaceURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("agentic30-prefetch-b-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: firstWorkspaceURL, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: secondWorkspaceURL, withIntermediateDirectories: true)
        defer {
            WorkspaceSettings.clear()
            try? FileManager.default.removeItem(at: firstWorkspaceURL)
            try? FileManager.default.removeItem(at: secondWorkspaceURL)
        }

        let viewModel = AgenticViewModel(disablesSidecarStartForTesting: true, activateAppForAuth: {})
        viewModel.resetFoundationProgressForTesting()
        let firstContext = OnboardingContext.make(
            workMode: .fullTimeSolo,
            role: .developer,
            projectStage: .building,
            isolationLevel: .projectFolder
        )
        let secondContext = OnboardingContext.make(
            workMode: .sideProject,
            role: .productManager,
            projectStage: .preRevenue,
            isolationLevel: .projectFolder
        )

        viewModel.prefetchOnboardingWorkspace(url: firstWorkspaceURL, context: firstContext)
        viewModel.selectedSessionID = "stale-foundation-session"

        viewModel.prefetchOnboardingWorkspace(url: secondWorkspaceURL, context: secondContext)

        #expect(viewModel.selectedSessionID == nil)
        #expect(viewModel.workspaceRoot == secondWorkspaceURL.path)
        #expect(viewModel.onboardingContext?.workMode == .sideProject)
        #expect(viewModel.foundationStartedAt == nil)
        #expect(viewModel.isScanning == true)
    }

    @Test @MainActor func intakeOnlyPreparationClearsPrefetchedWorkspaceScanState() throws {
        let productionLegacyProvider = WorkspaceSettings.legacyWorkspaceProvider
        WorkspaceSettings.legacyWorkspaceProvider = { "" }
        WorkspaceSettings.clear()
        let workspaceURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("agentic30-prefetch-clear-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: workspaceURL, withIntermediateDirectories: true)
        defer {
            WorkspaceSettings.clear()
            WorkspaceSettings.legacyWorkspaceProvider = productionLegacyProvider
            try? FileManager.default.removeItem(at: workspaceURL)
        }

        let viewModel = AgenticViewModel(disablesSidecarStartForTesting: true, activateAppForAuth: {})
        viewModel.resetFoundationProgressForTesting()
        viewModel.prefetchOnboardingWorkspace(
            url: workspaceURL,
            context: OnboardingContext.make(
                workMode: .fullTimeSolo,
                role: .developer,
                projectStage: .building,
                isolationLevel: .projectFolder
            )
        )

        #expect(viewModel.workspaceRoot == workspaceURL.path)
        #expect(viewModel.scanProgressLogs == ["Waiting for workspace connection..."])
        #expect(WorkspaceSettings.hasExplicitWorkspace)

        viewModel.prepareIntakeOnlyOnboarding(
            context: OnboardingContext.make(
                workMode: .sideProject,
                role: .productManager,
                projectStage: .ideaOnly,
                isolationLevel: .projectFolder
            )
        )

        #expect(viewModel.workspaceRoot.isEmpty)
        #expect(viewModel.scanProgressLogs.isEmpty)
        #expect(viewModel.scanResult == nil)
        #expect(!WorkspaceSettings.hasExplicitWorkspace)
        #expect(viewModel.onboardingContext?.workMode == .sideProject)
    }

    @Test @MainActor func completingIntakeOnlyOnboardingOpensStaticWorkspaceWithoutStartingSidecar() throws {
        let productionLegacyProvider = WorkspaceSettings.legacyWorkspaceProvider
        WorkspaceSettings.legacyWorkspaceProvider = { "" }
        WorkspaceSettings.clear()
        defer {
            WorkspaceSettings.clear()
            WorkspaceSettings.legacyWorkspaceProvider = productionLegacyProvider
        }

        let sidecar = FakeSidecarTransport(workspaceRoot: "")
        let viewModel = AgenticViewModel(sidecar: sidecar, activateAppForAuth: {})
        viewModel.resetFoundationProgressForTesting()
        let context = OnboardingContext.make(
            workMode: .sideProject,
            role: .productManager,
            projectStage: .ideaOnly,
            isolationLevel: .projectFolder
        )

        viewModel.prepareIntakeOnlyOnboarding(context: context)
        viewModel.submitOnboardingContext(context)
        viewModel.completeIntakeOnlyOnboarding(openWorkspace: true)

        #expect(viewModel.requiresMacOnboarding == false)
        #expect(viewModel.needsProjectWorkspace == true)
        #expect(viewModel.canStartSidecar == true)
        #expect(!WorkspaceSettings.hasExplicitWorkspace)
        #expect(viewModel.workspaceRoot.isEmpty)
        #expect(viewModel.isConnected == false)
        #expect(viewModel.activeSurface == .workspace)
        #expect(viewModel.foundationStartedAt != nil)
        #expect(sidecar.startCallCount == 1)
    }

    @Test @MainActor func selectingWorkspaceAfterIntakeOnlyCompletionEnablesSidecarStart() throws {
        let productionLegacyProvider = WorkspaceSettings.legacyWorkspaceProvider
        WorkspaceSettings.legacyWorkspaceProvider = { "" }
        WorkspaceSettings.clear()
        let workspaceURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("agentic30-intake-only-upgrade-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: workspaceURL, withIntermediateDirectories: true)
        defer {
            WorkspaceSettings.clear()
            WorkspaceSettings.legacyWorkspaceProvider = productionLegacyProvider
            try? FileManager.default.removeItem(at: workspaceURL)
        }

        let sidecar = FakeSidecarTransport(workspaceRoot: workspaceURL.path)
        let viewModel = AgenticViewModel(sidecar: sidecar, activateAppForAuth: {})
        viewModel.resetFoundationProgressForTesting()
        let context = OnboardingContext.make(
            workMode: .sideProject,
            role: .developer,
            projectStage: .building,
            isolationLevel: .projectFolder
        )

        viewModel.prepareIntakeOnlyOnboarding(context: context)
        viewModel.submitOnboardingContext(context)
        viewModel.completeIntakeOnlyOnboarding(openWorkspace: true)
        #expect(viewModel.canStartSidecar == true)
        #expect(sidecar.startCallCount == 1)

        viewModel.setProjectWorkspace(workspaceURL)

        #expect(viewModel.requiresMacOnboarding == false)
        #expect(viewModel.needsProjectWorkspace == false)
        #expect(viewModel.canStartSidecar == true)
        #expect(WorkspaceSettings.hasExplicitWorkspace)
        #expect(viewModel.workspaceRoot == workspaceURL.path)
        #expect(sidecar.stopCallCount == 1)
        #expect(sidecar.startCallCount == 2)
        #expect(viewModel.isScanning == true)
    }

    @Test @MainActor func completingPrefetchedOnboardingOpensWorkspaceSurfaceAndAnchorsFoundation() throws {
        let workspaceURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("agentic30-prefetch-complete-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: workspaceURL, withIntermediateDirectories: true)
        defer {
            WorkspaceSettings.clear()
            try? FileManager.default.removeItem(at: workspaceURL)
        }

        let viewModel = AgenticViewModel(disablesSidecarStartForTesting: true, activateAppForAuth: {})
        viewModel.resetFoundationProgressForTesting()
        viewModel.prefetchOnboardingWorkspace(
            url: workspaceURL,
            context: OnboardingContext.make(
                workMode: .fullTimeSolo,
                role: .developer,
                projectStage: .building,
                isolationLevel: .projectFolder
            )
        )

        #expect(viewModel.requiresMacOnboarding == true)
        #expect(viewModel.foundationStartedAt == nil)

        viewModel.completeMacOnboardingIntro(openWorkspace: true)

        #expect(viewModel.requiresMacOnboarding == false)
        #expect(viewModel.activeSurface == .workspace)
        #expect(viewModel.foundationStartedAt != nil)
    }

    @Test @MainActor func intakeV2BootLogStateUsesOnlySidecarProgressEvents() {
        let diagnostics = SidecarDiagnostics(
            generatedAt: Date(timeIntervalSince1970: 0),
            appSupportPath: "/tmp/app-support",
            workspaceRoot: "/tmp/agentic30-public",
            runtime: SidecarRuntimeDiagnostics(
                pid: 4242,
                platform: "darwin",
                arch: "arm64",
                node: "v22.0.0"
            ),
            storage: SidecarStorageDiagnostics(
                sessionsSchemaVersion: 1,
                sessionStoreWarnings: []
            ),
            sessions: SidecarSessionDiagnostics(
                total: 0,
                activeRuns: 0,
                statuses: [:]
            ),
            environment: nil,
            preflight: nil
        )

        let state = IntakeV2BootLogState(
            isConnected: true,
            workspaceRoot: "/tmp/agentic30-public",
            diagnostics: diagnostics,
            scanProgressLogs: [
                "Preparing workspace scan...",
                "Starting workspace scan...",
                "Starting workspace scan...",
                "Found 3 local candidate(s). Asking agents to verify context...",
                "Claude Sonnet 4.6 (claude-sonnet-4-6): using Read: docs/ICP.md docs/SPEC.md docs/GOAL.md",
                "GPT 5.1 Codex Mini (gpt-5.1-codex-mini): this is a long provider summary that should not leak raw debug text into onboarding"
            ],
            scanDidComplete: true,
            scanError: nil,
            foundArtifactCount: 3,
            isScanning: false
        )

        #expect(state.lines.map(\.command) == [
            "sidecar.ready",
            "scan.local",
            "scan.verify",
            "scan.agent",
            "scan.result",
        ])
        #expect(state.lines[0].status == "✓ · v22.0.0 · pid 4242 · agentic30-public")
        #expect(state.lines[1].status == "checking workspace files")
        #expect(state.lines[2].status == "3 local candidates found")
        #expect(state.lines[3].status == "verifying context")
        #expect(state.lines[4].status == "✓ 3 artifacts verified")
        #expect(!state.lines.contains { $0.status == "Preparing workspace scan..." })
        #expect(!state.lines.contains { $0.status?.contains("Claude Sonnet") == true })
        #expect(!state.lines.contains { $0.status?.contains("gpt-5.1-codex-mini") == true })
        #expect(state.scanDidComplete)
        #expect(!state.scanDidFail)
    }

    @Test @MainActor func intakeV2BootLogStateKeepsPendingStateSidecarOnly() {
        let empty = IntakeV2BootLogState.empty
        #expect(empty.lines.isEmpty)
        #expect(!empty.scanDidComplete)
        #expect(!empty.scanDidFail)
        #expect(empty.foundArtifactCount == nil)
        #expect(empty.scanElapsed == nil)

        let pending = IntakeV2BootLogState(
            isConnected: false,
            workspaceRoot: "",
            diagnostics: nil,
            scanProgressLogs: [
                "Waiting for workspace connection...",
                "Starting workspace scan..."
            ],
            scanDidComplete: false,
            scanError: nil,
            foundArtifactCount: nil,
            isScanning: true
        )

        #expect(pending.lines.count == 1)
        #expect(pending.lines[0].command == "scan.local")
        #expect(pending.lines[0].status == "checking workspace files")
        #expect(pending.lines[0].isActive)
        #expect(!pending.scanDidComplete)
        #expect(!pending.scanDidFail)
        #expect(pending.scanElapsed == nil)
    }

    @Test @MainActor func intakeV2BootLogStateSurfacesScanFailures() {
        let state = IntakeV2BootLogState(
            isConnected: false,
            workspaceRoot: "",
            diagnostics: nil,
            scanProgressLogs: [
                "Waiting for workspace connection...",
                "Starting workspace scan..."
            ],
            scanDidComplete: true,
            scanError: "Workspace root is not a directory.",
            foundArtifactCount: nil,
            isScanning: false
        )

        #expect(state.lines.map(\.command) == [
            "scan.local",
            "scan.failed",
        ])
        #expect(state.lines.first?.status == "checking workspace files")
        #expect(state.lines.last?.status == "✗ Workspace root is not a directory.")
        #expect(state.scanDidComplete)
        #expect(state.scanDidFail)
    }

    @Test @MainActor func intakeV2BootLogElapsedFormatsRunningAndCompletedDurations() {
        let start = Date(timeIntervalSince1970: 1_000)
        let running = IntakeV2BootLogElapsed(
            status: .running,
            startedAt: start,
            completedAt: nil
        )
        #expect(running.chipText(at: start.addingTimeInterval(9)) == "진행 00:09")
        #expect(running.chipText(at: start.addingTimeInterval(65)) == "진행 01:05")
        #expect(running.chipText(at: start.addingTimeInterval(3_723)) == "진행 1:02:03")
        #expect(running.accessibilityLabel(at: start.addingTimeInterval(3_723)) == "스캔 진행 시간 1시간 2분 3초")

        let succeeded = IntakeV2BootLogElapsed(
            status: .succeeded,
            startedAt: start,
            completedAt: start.addingTimeInterval(127)
        )
        #expect(succeeded.chipText(at: start.addingTimeInterval(999)) == "완료 02:07")
        #expect(succeeded.accessibilityLabel(at: start.addingTimeInterval(999)) == "스캔 완료 시간 2분 7초")

        let failed = IntakeV2BootLogElapsed(
            status: .failed,
            startedAt: start,
            completedAt: start.addingTimeInterval(127)
        )
        #expect(failed.chipText(at: start.addingTimeInterval(999)) == "중단 02:07")
        #expect(failed.accessibilityLabel(at: start.addingTimeInterval(999)) == "스캔 중단 시간 2분 7초")
    }

    @Test @MainActor func intakeV2BootLogStateDerivesElapsedChipState() {
        let start = Date(timeIntervalSince1970: 1_000)
        let completed = start.addingTimeInterval(127)
        let running = IntakeV2BootLogState(
            isConnected: false,
            workspaceRoot: "",
            diagnostics: nil,
            scanProgressLogs: ["Starting workspace scan..."],
            scanDidComplete: false,
            scanError: nil,
            foundArtifactCount: nil,
            isScanning: true,
            scanStartedAt: start
        )
        #expect(running.scanElapsed?.chipText(at: start.addingTimeInterval(65)) == "진행 01:05")

        let succeeded = IntakeV2BootLogState(
            isConnected: false,
            workspaceRoot: "",
            diagnostics: nil,
            scanProgressLogs: ["Starting workspace scan..."],
            scanDidComplete: true,
            scanError: nil,
            foundArtifactCount: 3,
            isScanning: false,
            scanStartedAt: start,
            scanCompletedAt: completed
        )
        #expect(succeeded.scanElapsed?.chipText(at: start.addingTimeInterval(999)) == "완료 02:07")

        let failed = IntakeV2BootLogState(
            isConnected: false,
            workspaceRoot: "",
            diagnostics: nil,
            scanProgressLogs: ["Starting workspace scan..."],
            scanDidComplete: true,
            scanError: "Workspace root is not a directory.",
            foundArtifactCount: nil,
            isScanning: false,
            scanStartedAt: start,
            scanCompletedAt: completed
        )
        #expect(failed.scanElapsed?.chipText(at: start.addingTimeInterval(999)) == "중단 02:07")
    }

    @Test @MainActor func intakeV2BootLogStateMapsStructuredScanPhase() {
        let state = IntakeV2BootLogState(
            isConnected: false,
            workspaceRoot: "",
            diagnostics: nil,
            scanProgressLogs: ["scan.compose · Day 1 질문 세트를 구성 중"],
            scanProgressSnapshots: [
                WorkspaceScanProgressSnapshot(
                    progressText: "scan.compose · Day 1 질문 세트를 구성 중",
                    stage: "composing",
                    stepIndex: 3,
                    totalSteps: 3,
                    etaSeconds: 10,
                    foundCount: 4
                ),
            ],
            scanDidComplete: false,
            scanError: nil,
            foundArtifactCount: nil,
            isScanning: true
        )

        #expect(state.scanPhase.stage == .composing)
        #expect(state.scanPhase.stepIndex == 3)
        #expect(state.scanPhase.totalSteps == 3)
        #expect(state.scanPhase.etaSeconds == 10)
        #expect(state.scanPhase.foundCount == 4)
        #expect(state.scanPhase.label == "3/3")
    }

    @Test @MainActor func intakeV2BootLogStateMapsSequentialStructuredScanPhases() {
        let cases: [(stage: String, stepIndex: Int, expectedStage: IntakeV2BootLogState.ScanStage, expectedLabel: String)] = [
            ("local", 1, .local, "1/3"),
            ("verifying", 2, .verifying, "2/3"),
            ("composing", 3, .composing, "3/3"),
            ("merged", 3, .merged, "3/3"),
        ]

        for item in cases {
            let progressText = "scan.\(item.stage) · Day 1 scan progress"
            let state = IntakeV2BootLogState(
                isConnected: false,
                workspaceRoot: "",
                diagnostics: nil,
                scanProgressLogs: [progressText],
                scanProgressSnapshots: [
                    WorkspaceScanProgressSnapshot(
                        progressText: progressText,
                        stage: item.stage,
                        stepIndex: item.stepIndex,
                        totalSteps: 3
                    ),
                ],
                scanDidComplete: false,
                scanError: nil,
                foundArtifactCount: nil,
                isScanning: true
            )

            #expect(state.scanPhase.stage == item.expectedStage)
            #expect(state.scanPhase.stepIndex == item.stepIndex)
            #expect(state.scanPhase.totalSteps == 3)
            #expect(state.scanPhase.label == item.expectedLabel)
        }
    }

    @Test @MainActor func day1ScanWaitPresentationMapsScanStates() {
        let start = Date(timeIntervalSince1970: 1_000)
        let running = IntakeV2BootLogState(
            isConnected: false,
            workspaceRoot: "",
            diagnostics: nil,
            scanProgressLogs: ["scan.local · 로컬 문서 후보를 읽는 중"],
            scanProgressSnapshots: [
                WorkspaceScanProgressSnapshot(
                    progressText: "scan.local · 로컬 문서 후보를 읽는 중",
                    stage: "local",
                    stepIndex: 1,
                    totalSteps: 3
                ),
            ],
            scanDidComplete: false,
            scanError: nil,
            foundArtifactCount: nil,
            isScanning: true,
            scanStartedAt: start
        )

        let missingElapsed = IntakeV2BootLogState(
            isConnected: false,
            workspaceRoot: "",
            diagnostics: nil,
            scanProgressLogs: ["scan.local · 로컬 문서 후보를 읽는 중"],
            scanDidComplete: false,
            scanError: nil,
            foundArtifactCount: nil,
            isScanning: true
        )
        let missingElapsedPresentation = Day1ScanWaitPresentation(
            bootLogState: missingElapsed,
            hasFolder: true,
            hasWorkspaceScanResult: false,
            now: start
        )
        #expect(missingElapsedPresentation.primaryCTATitle(questionCount: 3) == "45초 남음 (예상)")
        #expect(missingElapsedPresentation.primaryCTAAccessibilityLabel(questionCount: 3) == "질문 3개 준비 중, 45초 남음 예상")

        let startingPresentation = Day1ScanWaitPresentation(
            bootLogState: running,
            hasFolder: true,
            hasWorkspaceScanResult: false,
            now: start
        )
        #expect(startingPresentation.primaryCTATitle(questionCount: 3) == "45초 남음 (예상)")

        let fiveSecondPresentation = Day1ScanWaitPresentation(
            bootLogState: running,
            hasFolder: true,
            hasWorkspaceScanResult: false,
            now: start.addingTimeInterval(5)
        )
        #expect(fiveSecondPresentation.primaryCTATitle(questionCount: 3) == "40초 남음 (예상)")
        #expect(fiveSecondPresentation.primaryCTAAccessibilityLabel(questionCount: 3) == "질문 3개 준비 중, 40초 남음 예상")

        #expect(Day1ScanWaitPresentation(
            bootLogState: running,
            hasFolder: true,
            hasWorkspaceScanResult: false,
            now: start.addingTimeInterval(5)
        ).state == .scanningNormal)

        #expect(Day1ScanWaitPresentation(
            bootLogState: running,
            hasFolder: true,
            hasWorkspaceScanResult: false,
            now: start.addingTimeInterval(13)
        ).state == .scanningNormal)

        #expect(Day1ScanWaitPresentation(
            bootLogState: running,
            hasFolder: true,
            hasWorkspaceScanResult: false,
            now: start.addingTimeInterval(44)
        ).primaryCTATitle(questionCount: 3) == "1초 남음 (예상)")

        let exceededPresentation = Day1ScanWaitPresentation(
            bootLogState: running,
            hasFolder: true,
            hasWorkspaceScanResult: false,
            now: start.addingTimeInterval(45)
        )
        #expect(exceededPresentation.primaryCTATitle(questionCount: 3) == "마무리 중…")
        #expect(exceededPresentation.primaryCTAAccessibilityLabel(questionCount: 3) == "질문 3개 준비 중, 마무리 중")

        #expect(Day1ScanWaitPresentation(
            bootLogState: running,
            hasFolder: true,
            hasWorkspaceScanResult: false,
            now: start.addingTimeInterval(50)
        ).state == .scanningSlow)
        #expect(Day1ScanWaitPresentation(
            bootLogState: running,
            hasFolder: true,
            hasWorkspaceScanResult: false,
            now: start.addingTimeInterval(50)
        ).primaryCTATitle(questionCount: 3) == "마무리 중…")
    }

    @Test @MainActor func scanResultOrFailureEnablesDay1Ready() {
        let start = Date(timeIntervalSince1970: 1_000)
        let running = IntakeV2BootLogState(
            isConnected: false,
            workspaceRoot: "",
            diagnostics: nil,
            scanProgressLogs: ["scan.verify · 로컬 후보 2개를 Day 1 ICP 근거로 검증 중"],
            scanDidComplete: false,
            scanError: nil,
            foundArtifactCount: nil,
            isScanning: true,
            scanStartedAt: start
        )

        let ready = Day1ScanWaitPresentation(
            bootLogState: running,
            hasFolder: true,
            hasWorkspaceScanResult: true,
            now: start.addingTimeInterval(31)
        )
        #expect(ready.state == .scanMergedReady)
        #expect(ready.canOpenDay1)
        #expect(ready.headerTitle(questionCount: 3) == "Day 1 질문 3개가 준비됐어요")
        #expect(ready.primaryCTATitle(questionCount: 3) == "질문 3개 시작하기 →")
        #expect(ready.primaryCTAAccessibilityLabel(questionCount: 3) == "질문 3개 시작하기")

        let failed = IntakeV2BootLogState(
            isConnected: false,
            workspaceRoot: "",
            diagnostics: nil,
            scanProgressLogs: ["Workspace scan failed."],
            scanDidComplete: true,
            scanError: "Workspace root is not a directory.",
            foundArtifactCount: nil,
            isScanning: false,
            scanStartedAt: start,
            scanCompletedAt: start.addingTimeInterval(32)
        )
        #expect(failed.scanPhase.stage == .failed)
        let failedPresentation = Day1ScanWaitPresentation(
            bootLogState: failed,
            hasFolder: true,
            hasWorkspaceScanResult: false,
            now: start.addingTimeInterval(32)
        )
        #expect(failedPresentation.state == .scanFailed)
        #expect(failedPresentation.headerTitle(questionCount: 3) == "Day 1 질문 3개가 준비됐어요")
        #expect(failedPresentation.primaryCTATitle(questionCount: 3) == "질문 3개 시작하기 →")
        #expect(failedPresentation.primaryCTAAccessibilityLabel(questionCount: 3) == "질문 3개 시작하기")
    }

    @Test @MainActor func startHydratesExplicitWorkspaceBeforeSidecarReady() throws {
        let workspaceURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("agentic30-start-hydrates-workspace-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: workspaceURL, withIntermediateDirectories: true)
        WorkspaceSettings.store(workspaceURL)
        defer {
            WorkspaceSettings.clear()
            try? FileManager.default.removeItem(at: workspaceURL)
        }

        let viewModel = AgenticViewModel(
            onboardingContextOverride: OnboardingContext.make(
                role: .developer,
                projectStage: .building,
                isolationLevel: .projectFolder
            ),
            disablesSidecarStartForTesting: true,
            activateAppForAuth: {}
        )

        #expect(viewModel.workspaceRoot.isEmpty)

        viewModel.start()

        #expect(viewModel.workspaceRoot == workspaceURL.path)
        #expect(viewModel.isConnected == false)
    }

    @Test @MainActor func promptBeforeSessionQueuesStartupAction() throws {
        let workspaceURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("agentic30-startup-queue-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: workspaceURL, withIntermediateDirectories: true)
        WorkspaceSettings.store(workspaceURL)
        defer {
            WorkspaceSettings.clear()
            try? FileManager.default.removeItem(at: workspaceURL)
        }

        let viewModel = AgenticViewModel(
            onboardingContextOverride: OnboardingContext.make(
                role: .developer,
                projectStage: .building,
                isolationLevel: .projectFolder
            ),
            activateAppForAuth: {}
        )
        viewModel.draft = "Day 1에서 먼저 볼 고객 증거를 정리해줘"

        viewModel.sendPrompt()

        #expect(viewModel.draft.isEmpty)
        #expect(viewModel.startupQueuedAction?.title == "첫 메시지 대기 중")
        #expect(viewModel.startupQueuedAction?.summary == "Day 1에서 먼저 볼 고객 증거를 정리해줘")
    }

    @Test @MainActor func bipDraftInCodexSessionFailsBeforeSidecarSend() throws {
        let (workspace, cleanup) = try Self.installTemporaryWorkspace()
        defer { cleanup() }
        let sidecar = FakeSidecarTransport(workspaceRoot: workspace.path)
        let viewModel = Self.makeStartedViewModel(
            sidecar: sidecar,
            workspace: workspace,
            currentDay: 1
        )
        let session = ChatSession(
            id: "codex-session",
            title: "Codex Assistant",
            provider: .codex,
            model: AgentModelCatalog.defaultModelID(for: .codex),
            status: .idle,
            createdAt: Date(),
            updatedAt: Date(),
            error: nil,
            messages: [],
            pendingUserInput: nil,
            runtime: nil
        )
        viewModel.replaceSessionsForTesting([session], selectedSessionID: session.id)
        sidecar.resetSentPayloads()
        viewModel.draft = "/bip-draft 오늘 배운 점"

        viewModel.sendPrompt()

        #expect(viewModel.lastError == "/bip-draft requires a Claude session")
        #expect(viewModel.draft == "/bip-draft 오늘 배운 점")
        #expect(sidecar.sentPayloads.isEmpty)
    }

    @Test @MainActor func officeHoursStepStartSendsContextPayload() throws {
        let (workspace, cleanup) = try Self.installTemporaryWorkspace()
        defer { cleanup() }
        let sidecar = FakeSidecarTransport(workspaceRoot: workspace.path)
        let viewModel = Self.makeStartedViewModel(
            sidecar: sidecar,
            workspace: workspace,
            currentDay: 1
        )
        sidecar.resetSentPayloads()

        let sent = viewModel.startOfficeHours(
            sessionID: "session-1",
            context: "project + Day 1 answers"
        )

        #expect(sent)
        let payload = try #require(sidecar.sentPayloads.first)
        #expect(payload["type"] as? String == "office_hours_start")
        #expect(payload["sessionId"] as? String == "session-1")
        #expect(payload["source"] as? String == "office_hours_screen")
        #expect(payload["visiblePrompt"] as? String == "Office Hours")
        #expect(payload["context"] as? String == "project + Day 1 answers")
    }

    @Test @MainActor func officeHoursRealProjectTestStartSendsSourcePayload() throws {
        let (workspace, cleanup) = try Self.installTemporaryWorkspace()
        defer { cleanup() }
        let sidecar = FakeSidecarTransport(workspaceRoot: workspace.path)
        let viewModel = Self.makeStartedViewModel(
            sidecar: sidecar,
            workspace: workspace,
            currentDay: 1
        )
        sidecar.resetSentPayloads()

        let sent = viewModel.startOfficeHours(
            sessionID: "session-1",
            context: "real project context",
            source: "office_hours_screen_real_project_test"
        )

        #expect(sent)
        let payload = try #require(sidecar.sentPayloads.first)
        #expect(payload["type"] as? String == "office_hours_start")
        #expect(payload["source"] as? String == "office_hours_screen_real_project_test")
        #expect(payload["context"] as? String == "real project context")
    }

    @Test @MainActor func officeHoursStartSendsDayScopedPayload() throws {
        let (workspace, cleanup) = try Self.installTemporaryWorkspace()
        defer { cleanup() }
        let sidecar = FakeSidecarTransport(workspaceRoot: workspace.path)
        let viewModel = Self.makeStartedViewModel(
            sidecar: sidecar,
            workspace: workspace,
            currentDay: 2
        )
        sidecar.resetSentPayloads()

        let sent = viewModel.startOfficeHours(
            sessionID: "session-day-2",
            context: "Day 2 context",
            source: "office_hours_day_2",
            day: 2
        )

        #expect(sent)
        let payload = try #require(sidecar.sentPayloads.first)
        #expect(payload["type"] as? String == "office_hours_start")
        #expect(payload["sessionId"] as? String == "session-day-2")
        #expect(payload["source"] as? String == "office_hours_day_2")
        #expect(payload["day"] as? Int == 2)
        #expect(payload["context"] as? String == "Day 2 context")
    }

    @Test @MainActor func officeHoursStartSendsSelectedSourcesPayload() throws {
        let (workspace, cleanup) = try Self.installTemporaryWorkspace()
        defer { cleanup() }
        let sidecar = FakeSidecarTransport(workspaceRoot: workspace.path)
        let viewModel = Self.makeStartedViewModel(
            sidecar: sidecar,
            workspace: workspace,
            currentDay: 2
        )
        sidecar.resetSentPayloads()

        let sent = viewModel.startOfficeHours(
            sessionID: "session-day-2",
            context: "Day 2 context",
            source: "office_hours_day_2",
            day: 2,
            selectedSources: ["posthog", "github", "cloudflare"]
        )

        #expect(sent)
        let payload = try #require(sidecar.sentPayloads.first)
        #expect(payload["type"] as? String == "office_hours_start")
        #expect(payload["day"] as? Int == 2)
        #expect(payload["selectedSources"] as? [String] == ["cloudflare", "github", "posthog"])
    }

    @Test @MainActor func day1GoalDraftsSaveThroughSidecarPayload() async throws {
        let (workspace, cleanup) = try Self.installTemporaryWorkspace()
        defer { cleanup() }
        let sidecar = FakeSidecarTransport(workspaceRoot: workspace.path)
        let viewModel = Self.makeStartedViewModel(
            sidecar: sidecar,
            workspace: workspace,
            currentDay: 1
        )
        sidecar.resetSentPayloads()

        try sidecar.emit(Self.workspaceScanResultPayload(workspaceRoot: workspace.path))
        try await Task.sleep(nanoseconds: 10_000_000)

        #expect(viewModel.day1GoalDrafts.map(\.goalType) == [.buildProduct, .getUsers, .makeMoney])
        let draft = try #require(viewModel.day1GoalDrafts.first(where: { $0.goalType == .makeMoney }))
        #expect(draft.customer == "B2B SaaS support lead")
        #expect(draft.problem == "Slack escalation을 놓침")
        #expect(draft.evidenceRefs.contains("README.md"))

        sidecar.resetSentPayloads()
        let sent = viewModel.saveDay1GoalDraft(draft, workspaceRoot: workspace.path)

        #expect(sent)
        #expect(viewModel.day1GoalSelection?.goalType == .makeMoney)
        #expect(viewModel.scanResult?.day1GoalSelection?.goalType == .makeMoney)
        let payload = try #require(sidecar.sentPayloads.first)
        #expect(payload["type"] as? String == "day1_goal_save")
        #expect(payload["workspaceRoot"] as? String == workspace.path)
        let selection = try #require(payload["selection"] as? [String: Any])
        #expect(selection["goalType"] as? String == "make_money")
        #expect(selection["proofSink"] as? String == "local")
        #expect(selection["customer"] as? String == "B2B SaaS support lead")
    }

    @Test @MainActor func day1GoalDraftsPreferConciseAlignmentCustomerSignal() async throws {
        let (workspace, cleanup) = try Self.installTemporaryWorkspace()
        defer { cleanup() }
        let sidecar = FakeSidecarTransport(workspaceRoot: workspace.path)
        let viewModel = Self.makeStartedViewModel(
            sidecar: sidecar,
            workspace: workspace,
            currentDay: 1
        )

        try sidecar.emit(Self.workspaceScanResultWithLongAlignmentCustomerPayload(workspaceRoot: workspace.path))
        try await Task.sleep(nanoseconds: 10_000_000)

        let draft = try #require(viewModel.day1GoalDrafts.first)
        #expect(draft.customer == "전업 1인 개발자 (수익 0원, macOS)")
        #expect(draft.problem == "만들 줄은 알지만 무엇을 팔아야 하는지 모른다")
        #expect(draft.goalText.contains("중 \"만들 줄은") == false)
        #expect(draft.goalText.contains("모른다…") == false)
    }

    @Test func day1GoalSelectionOfficeHoursContextCopyIsConcise() {
        let selection = Day1GoalSelection(
            goalType: .getUsers,
            goalText: "전업 1인 개발자 (수익 0원, macOS)를 실제 유입/가입 행동으로 모아 만들 줄은 알지만 무엇을 팔아야 하는지, 어떻게 사람을 데려와야 하는지, 오늘 무엇을 검증해야 하는지 모른다 반복 여부를 확인한다.",
            customer: "전업 1인 개발자 (수익 0원, macOS) 중 \"만들 줄은 알지만 무엇을 팔아야 하는지 모른다\"…",
            problem: "만들 줄은 알지만 무엇을 팔아야 하는지, 어떻게 사람을 데려와야 하는지, 오늘 무엇을 검증해야 하는지 모른다",
            validationAction: "지불 의향과 현재 대안을 첫 고객 대화에서 묻는다.",
            evidenceRefs: ["docs/ICP.md", "docs/SPEC.md"],
            proofSink: .local,
            sourcePlanFingerprint: "fixture",
            selectedAt: "2026-06-07T00:00:00.000Z"
        )

        #expect(selection.officeHoursPurposeLine == "첫 100명 사용자 모으기 · 유입/가입 행동 검증")
        #expect(selection.officeHoursProgressLine == "전업 1인 개발자 (수익 0원, macOS) · 팔 대상·유입·검증 기준 불명확")
        #expect(selection.officeHoursOutputLine == "로컬 증거만 유지 · 승인 전 게시/문서 없음")
    }

    @Test @MainActor func lateFrontierWorkspaceScanProgressDoesNotReopenOfficeHoursScanGate() async throws {
        let (workspace, cleanup) = try Self.installTemporaryWorkspace()
        defer { cleanup() }
        let sidecar = FakeSidecarTransport(workspaceRoot: workspace.path)
        let viewModel = AgenticViewModel(
            onboardingContextOverride: Self.makeOnboardingContext(),
            sidecar: sidecar,
            activateAppForAuth: {}
        )
        viewModel.start()
        viewModel.markSidecarConnectedForTesting(workspaceRoot: workspace.path)
        sidecar.resetSentPayloads()

        try sidecar.emit(Self.workspaceScanResultPayload(workspaceRoot: workspace.path))
        try await Task.sleep(nanoseconds: 10_000_000)
        #expect(viewModel.isScanning == false)
        #expect(viewModel.scanResult != nil)

        try sidecar.emit("""
        {
          "type": "workspace_scan_progress",
          "scanRoot": "\(workspace.path)",
          "progressText": "frontier 선택지 생성 중"
        }
        """)
        try await Task.sleep(nanoseconds: 10_000_000)

        #expect(viewModel.isScanning == false)
        #expect(viewModel.scanResult != nil)
        #expect(viewModel.scanProgressMessage == "frontier 선택지 생성 중")

        sidecar.resetSentPayloads()
        let sent = viewModel.startOfficeHours(
            sessionID: "session-1",
            context: "real project context",
            source: "office_hours_screen_real_project_test"
        )

        #expect(sent)
        let payload = try #require(sidecar.sentPayloads.first)
        #expect(payload["type"] as? String == "office_hours_start")
        #expect(payload["source"] as? String == "office_hours_screen_real_project_test")
    }

    @Test @MainActor func officeHoursStepEnsureSessionCreatesSessionWhenConnected() throws {
        let (workspace, cleanup) = try Self.installTemporaryWorkspace()
        defer { cleanup() }
        let sidecar = FakeSidecarTransport(workspaceRoot: workspace.path)
        let viewModel = Self.makeStartedViewModel(
            sidecar: sidecar,
            workspace: workspace,
            currentDay: 1
        )

        let hasSession = viewModel.ensureOfficeHoursSession()

        #expect(!hasSession)
        let payload = try #require(sidecar.sentPayloads.first)
        #expect(payload["type"] as? String == "create_session")
        #expect(payload["provider"] as? String == AgentProvider.codex.rawValue)
        #expect(payload["model"] as? String == AgentModelCatalog.defaultModelID(for: .codex))
        #expect(payload["source"] as? String == "office_hours_screen")
        #expect(payload["suppressBootstrapIntake"] as? Bool == true)
    }

    @Test @MainActor func officeHoursStepEnsureSessionCreatesDayScopedSession() throws {
        let (workspace, cleanup) = try Self.installTemporaryWorkspace()
        defer { cleanup() }
        let sidecar = FakeSidecarTransport(workspaceRoot: workspace.path)
        let viewModel = Self.makeStartedViewModel(
            sidecar: sidecar,
            workspace: workspace,
            currentDay: 2
        )

        let hasSession = viewModel.ensureOfficeHoursSession(forDay: 2)

        #expect(!hasSession)
        let payload = try #require(sidecar.sentPayloads.first)
        #expect(payload["type"] as? String == "create_session")
        #expect(payload["source"] as? String == "office_hours_screen_day_2")
        #expect(payload["officeHoursDay"] as? Int == 2)
        #expect(payload["suppressBootstrapIntake"] as? Bool == true)
    }

    @Test @MainActor func officeHoursStepRejectsBootstrapIntakeSession() throws {
        let (workspace, cleanup) = try Self.installTemporaryWorkspace()
        defer { cleanup() }
        let viewModel = Self.makeStartedViewModel(
            sidecar: FakeSidecarTransport(workspaceRoot: workspace.path),
            workspace: workspace,
            currentDay: 1
        )
        let bootstrapPrompt = StructuredPromptRequest(
            requestId: "bootstrap-request",
            sessionId: "bootstrap-session",
            toolName: "initial_intake",
            title: "시작하기",
            createdAt: Date(),
            questions: [
                StructuredPromptQuestion(
                    questionId: "start",
                    header: "시작",
                    question: "무엇부터 시작할까요?",
                    helperText: nil,
                    options: nil,
                    multiSelect: false,
                    allowFreeText: false,
                    requiresFreeText: false,
                    freeTextPlaceholder: nil,
                    textMode: .short
                ),
            ]
        )
        let session = ChatSession(
            id: "bootstrap-session",
            title: "Codex Assistant",
            provider: .codex,
            model: AgentModelCatalog.defaultModelID(for: .codex),
            status: .awaitingInput,
            createdAt: Date(),
            updatedAt: Date(),
            error: nil,
            messages: [],
            pendingUserInput: bootstrapPrompt,
            runtime: nil
        )

        #expect(!viewModel.canUseSessionForOfficeHours(session))
    }

    @Test @MainActor func officeHoursStepEnsureSessionDoesNotDuplicateCreateWhileInFlight() throws {
        let (workspace, cleanup) = try Self.installTemporaryWorkspace()
        defer { cleanup() }
        let sidecar = FakeSidecarTransport(workspaceRoot: workspace.path)
        let viewModel = Self.makeStartedViewModel(
            sidecar: sidecar,
            workspace: workspace,
            currentDay: 1
        )

        _ = viewModel.ensureOfficeHoursSession()
        _ = viewModel.ensureOfficeHoursSession()

        let createPayloads = sidecar.sentPayloads.filter { $0["type"] as? String == "create_session" }
        #expect(createPayloads.count == 1)
    }

    @Test @MainActor func officeHoursStepEnsureSessionUsesCreatedSession() throws {
        let (workspace, cleanup) = try Self.installTemporaryWorkspace()
        defer { cleanup() }
        let sidecar = FakeSidecarTransport(workspaceRoot: workspace.path)
        let viewModel = Self.makeStartedViewModel(
            sidecar: sidecar,
            workspace: workspace,
            currentDay: 1
        )
        _ = viewModel.ensureOfficeHoursSession()

        viewModel.applySessionCreatedForTesting(
            ChatSession(
                id: "office-hours-session",
                title: "Office Hours",
                provider: .codex,
                model: AgentModelCatalog.defaultModelID(for: .codex),
                status: .idle,
                createdAt: Date(),
                updatedAt: Date(),
                error: nil,
                messages: [],
                pendingUserInput: nil,
                runtime: nil
            )
        )
        sidecar.resetSentPayloads()

        #expect(viewModel.selectedSession?.id == "office-hours-session")
        #expect(viewModel.ensureOfficeHoursSession())
        #expect(sidecar.sentPayloads.isEmpty)
    }

    @Test @MainActor func officeHoursLiveStatusUpdatesPreviewAndClearsWhenQuestionArrives() throws {
        let (workspace, cleanup) = try Self.installTemporaryWorkspace()
        defer { cleanup() }
        let viewModel = Self.makeStartedViewModel(
            sidecar: FakeSidecarTransport(workspaceRoot: workspace.path),
            workspace: workspace,
            currentDay: 1
        )
        var session = ChatSession(
            id: "office-hours-session",
            title: "Office Hours",
            provider: .codex,
            model: AgentModelCatalog.defaultModelID(for: .codex),
            status: .running,
            createdAt: Date(),
            updatedAt: Date(),
            error: nil,
            messages: [],
            pendingUserInput: nil,
            runtime: ChatSessionRuntime(
                codexThreadId: nil,
                codexThreadMeta: nil,
                codexWarm: nil,
                startupTiming: nil,
                iddDocumentType: nil,
                iddMode: nil,
                officeHours: OfficeHoursRuntime(
                    active: true,
                    source: "office_hours_screen",
                    startedAt: "2026-06-03T00:00:00.000Z",
                    context: "real context",
                    day: 1
                )
            )
        )
        viewModel.applySessionUpdatedForTesting(session)

        viewModel.applyOfficeHoursLiveStatusForTesting(
            sessionId: session.id,
            stage: "provider_starting",
            title: "다음 질문 준비 중",
            detail: "프로젝트 맥락에 맞는 질문을 준비하고 있습니다.",
            progressText: "프로젝트 맥락에 맞는 질문 준비 중",
            elapsedMs: 42
        )

        let status = try #require(viewModel.officeHoursLiveStatus(for: session.id))
        #expect(status.stage == "provider_starting")
        #expect(status.title == "다음 질문 준비 중")
        #expect(status.detail == "프로젝트 맥락에 맞는 질문을 준비하고 있습니다.")
        #expect(status.elapsedMs == 42)
        #expect(viewModel.sidecarOutputPreview(for: session.id).last == "프로젝트 맥락에 맞는 질문 준비 중")

        session.status = .awaitingInput
        session.pendingUserInput = StructuredPromptRequest(
            requestId: "request-1",
            sessionId: session.id,
            toolName: "agentic30_request_user_input",
            title: "Office Hours",
            createdAt: Date(),
            questions: [
                StructuredPromptQuestion(
                    questionId: "office_hours_demand_evidence",
                    header: "수요 증거",
                    question: "가장 강한 증거는 무엇인가요?",
                    helperText: nil,
                    options: [
                        StructuredPromptOption(
                            label: "실제 결제/계약이 있었다",
                            description: "돈이 이미 움직였습니다.",
                            preview: nil
                        ),
                        StructuredPromptOption(
                            label: "관심만 있거나 아직 증거가 없다",
                            description: "첫 행동 증거가 필요합니다.",
                            preview: nil
                        ),
                    ],
                    multiSelect: false,
                    allowFreeText: false,
                    requiresFreeText: false,
                    freeTextPlaceholder: nil,
                    textMode: .short
                ),
            ],
            generation: StructuredPromptGeneration(mode: "office_hours", docType: "day1_step")
        )
        viewModel.applySessionUpdatedForTesting(session)

        #expect(viewModel.officeHoursLiveStatus(for: session.id) == nil)
    }

    @Test @MainActor func missionBeforeSessionQueuesStartupAction() throws {
        let workspaceURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("agentic30-startup-mission-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: workspaceURL, withIntermediateDirectories: true)
        WorkspaceSettings.store(workspaceURL)
        defer {
            WorkspaceSettings.clear()
            try? FileManager.default.removeItem(at: workspaceURL)
        }

        let viewModel = AgenticViewModel(
            onboardingContextOverride: OnboardingContext.make(
                role: .developer,
                projectStage: .building,
                isolationLevel: .projectFolder
            ),
            activateAppForAuth: {}
        )

        viewModel.generateBipMission(compact: true, curriculumDay: ["day": 1])

        #expect(viewModel.startupQueuedAction?.title == "오늘 실행 생성 대기 중")
        #expect(viewModel.startupQueuedAction?.summary == "세션이 연결되면 Day 1 기준으로 오늘 실행 후보를 만듭니다.")
    }

    @Test @MainActor func missionFirstErrorCopyHidesRawNullDayFailures() {
        let rawMessage = "TypeError: Cannot read properties of null (reading 'day')"

        #expect(AgenticViewModel.isRawNullDayError(rawMessage))
        #expect(AgenticViewModel.userFacingMissionErrorMessage(rawMessage) == "다시 시도하면 미션 후보를 새로 만들게요.")
        #expect(!AgenticViewModel.userFacingMissionErrorMessage(rawMessage).contains("Cannot read properties"))
    }

    @Test @MainActor func bipCoachStateDecodesLocalEvidenceProvider() throws {
        let payload = """
        {
          "config": { "provider": "codex" },
          "evidence": { "provider": "local", "fallbackUsed": true },
          "missionChoices": [],
          "currentMission": null,
          "streak": { "current": 0, "longest": 0, "lastCompletedDate": null },
          "lastError": null
        }
        """.data(using: .utf8)!

        let state = try JSONDecoder().decode(BipCoachState.self, from: payload)

        #expect(state.config.provider == .codex)
        #expect(state.evidence?.provider == "local")
        #expect(state.evidence?.fallbackUsed == true)
    }

    @Test @MainActor func googleSignInReportsFailureWhenSystemAuthSessionCannotStart() {
        let fakeSession = FakeWebAuthenticationSessionHandle(startResult: false)
        var activationCount = 0
        var requestedURL: URL?
        var requestedCallbackScheme: String?
        var requestedEphemeralPreference: Bool?

        let viewModel = AgenticViewModel(
            authSessionFactory: { url, callbackScheme, _, prefersEphemeral, _ in
                requestedURL = url
                requestedCallbackScheme = callbackScheme
                requestedEphemeralPreference = prefersEphemeral
                return fakeSession
            },
            activateAppForAuth: {
                activationCount += 1
            }
        )

        viewModel.startMacGoogleSignIn()

        #expect(fakeSession.startCallCount == 1)
        #expect(activationCount == 1)
        #expect(requestedURL?.path == "/auth/mac/start")
        #expect(requestedCallbackScheme == "agentic30")
        #expect(requestedEphemeralPreference == true)

        guard case .failed(let message) = viewModel.macOnboardingStatus else {
            Issue.record("Expected failed onboarding status, got \(viewModel.macOnboardingStatus)")
            return
        }
        #expect(message == "Could not open Google sign-in. Open the workspace window and try again.")
    }

    @Test @MainActor func googleSignInWaitsForCallbackWhenSystemAuthSessionStarts() {
        let fakeSession = FakeWebAuthenticationSessionHandle(startResult: true)

        let viewModel = AgenticViewModel(
            authSessionFactory: { _, _, _, _, _ in
                fakeSession
            },
            activateAppForAuth: {}
        )

        viewModel.startMacGoogleSignIn()

        #expect(fakeSession.startCallCount == 1)
        #expect(viewModel.macOnboardingStatus == .signingIn)
    }

    private static func makeOnboardingContext() -> OnboardingContext {
        OnboardingContext(
            businessDescription: "Agentic30",
            currentStage: "building",
            goal: "Find ICP",
            workMode: .fullTimeSolo,
            role: .developer,
            projectStage: .building,
            isolationLevel: .projectFolder,
            completedAt: "2026-05-08T00:00:00Z"
        )
    }

    private static func workspaceScanResultPayload(workspaceRoot: String) throws -> String {
        let encoder = JSONEncoder()
        let planData = try encoder.encode(makeDay1IcpPlan())
        let planJSON = try #require(String(data: planData, encoding: .utf8))
        return """
        {
          "type": "workspace_scan_result",
          "scanRoot": "\(workspaceRoot)",
          "icp": "docs/ICP.md",
          "spec": "docs/SPEC.md",
          "values": "docs/VALUES.md",
          "goal": "docs/GOAL.md",
          "docs": "README.md",
          "onboardingHypothesis": {
            "productName": "SupportLens",
            "projectKind": "saas",
            "targetUser": "B2B SaaS support lead",
            "problem": "Slack escalation을 놓침",
            "purpose": "Escalation triage",
            "goal": "유료 후보 1명 검증",
            "likelyUsers": ["support lead"],
            "stage": "first_users",
            "evidence": ["README.md"],
            "confidence": "high"
          },
          "day1IcpPlan": \(planJSON)
        }
        """
    }

    private static func workspaceScanResultWithLongAlignmentCustomerPayload(workspaceRoot: String) -> String {
        """
        {
          "type": "workspace_scan_result",
          "scanRoot": "\(workspaceRoot)",
          "icp": "docs/ICP.md",
          "spec": "docs/SPEC.md",
          "goal": "docs/GOAL.md",
          "day1AlignmentPlan": {
            "schemaVersion": 1,
            "source": "deterministic",
            "generatedAt": "2026-06-07T00:00:00.000Z",
            "confidence": 0.88,
            "fellBackToDeterministic": false,
            "projectGoal": "Agentic30은 전업 1인 개발자의 첫 매출 가능성을 검증한다.",
            "mission": "Day 1 goal test",
            "signals": {
              "productName": "Agentic30",
              "currentIcpGuess": "전업 1인 개발자 (수익 0원, macOS)",
              "likelyUsers": ["AI 코딩 도구를 쓰는 개발자"],
              "problem": "만들 줄은 알지만 무엇을 팔아야 하는지 모른다",
              "currentAlternatives": ["수동 노트"],
              "evidenceRefs": [
                { "path": "docs/ICP.md", "reason": "icp", "quote": "전업 1인 개발자 (수익 0원, macOS)" },
                { "path": "docs/SPEC.md", "reason": "spec", "quote": "만들 줄은 알지만 무엇을 팔아야 하는지 모른다" }
              ],
              "missingAssumptions": [],
              "confidence": "high"
            },
            "components": {
              "icp": {
                "id": "icp",
                "title": "고객",
                "prompt": "고객 후보는 누구인가요?",
                "helperText": "고객 조건을 고릅니다.",
                "statement": "전업 1인 개발자 (수익 0원, macOS) 중 \\"만들 줄은 알지만 무엇을 팔아야 하는지 모른다\\" 상황을 지금 해결하려는 고객.",
                "evidence": ["docs/ICP.md"],
                "missingAssumptions": [],
                "options": [
                  { "id": "solo", "label": "전업 1인 개발자 (수익 0원, macOS)", "description": "첫 고객 후보입니다.", "preview": "고객", "antiSignal": false }
                ]
              },
              "painPoint": {
                "id": "pain_point",
                "title": "문제",
                "prompt": "문제는 무엇인가요?",
                "helperText": "핵심 문제를 고릅니다.",
                "statement": "만들 줄은 알지만 무엇을 팔아야 하는지 모른다",
                "evidence": ["docs/SPEC.md"],
                "missingAssumptions": [],
                "options": [
                  { "id": "pain", "label": "만들 줄은 알지만 무엇을 팔아야 하는지 모른다", "description": "핵심 문제입니다.", "preview": "문제", "antiSignal": false }
                ]
              },
              "outcome": {
                "id": "outcome",
                "title": "확인할 행동",
                "prompt": "확인할 행동은 무엇인가요?",
                "helperText": "관찰 가능한 행동을 고릅니다.",
                "statement": "지불 의향과 현재 대안을 첫 고객 대화에서 묻는다.",
                "evidence": ["docs/GOAL.md"],
                "missingAssumptions": [],
                "options": [
                  { "id": "outcome", "label": "지불 의향과 현재 대안을 첫 고객 대화에서 묻는다.", "description": "행동 신호입니다.", "preview": "확인", "antiSignal": false }
                ]
              }
            },
            "alignmentStatement": {
              "statement": "목표: Agentic30은 전업 1인 개발자의 첫 매출 가능성을 검증한다. / 고객: 전업 1인 개발자 (수익 0원, macOS) 중 \\"만들 줄은 알지만 무엇을 팔아야 하는지 모른다\\" 상황을 지금 해결하려는 고객. / 문제: 만들 줄은 알지만 무엇을 팔아야 하는지 모른다 / 확인할 행동: 지불 의향과 현재 대안을 첫 고객 대화에서 묻는다.",
              "projectGoal": "Agentic30은 전업 1인 개발자의 첫 매출 가능성을 검증한다.",
              "icp": "전업 1인 개발자 (수익 0원, macOS) 중 \\"만들 줄은 알지만 무엇을 팔아야 하는지 모른다\\" 상황을 지금 해결하려는 고객.",
              "painPoint": "만들 줄은 알지만 무엇을 팔아야 하는지 모른다",
              "outcome": "지불 의향과 현재 대안을 첫 고객 대화에서 묻는다."
            },
            "qualityGate": {
              "score": 8.8,
              "threshold": 7.0,
              "passed": true,
              "label": "PASS",
              "passGate": "specific",
              "failGate": "missing",
              "criteria": [
                { "id": "icp", "label": "고객", "score": 2.0, "maxScore": 2.0, "passed": true, "detail": "specific" }
              ]
            },
            "firstInterviewMessage": {
              "channel": "DM",
              "recipientPlaceholder": "{name}",
              "subject": "Day 1",
              "bodyTemplate": "최근 무엇을 팔아야 할지 막힌 적이 있나요?",
              "questions": ["최근 사건은?", "현재 대안은?"]
            },
            "day2Handoff": {
              "title": "Day 2",
              "body": "시장 신호 확인",
              "focus": "첫 고객",
              "nextDayPrompt": "지불 의향 확인",
              "qualityGateLabel": "PASS 8.8/10"
            },
            "signalDigest": {
              "schemaVersion": 1,
              "rows": [
                { "key": "project", "label": "프로젝트", "value": "Agentic30", "tone": "strong" },
                { "key": "goal", "label": "목표", "value": "첫 매출 가능성 검증", "tone": "body" },
                { "key": "icp", "label": "고객", "value": "전업 1인 개발자 (수익 0원, macOS)", "tone": "body" },
                { "key": "pain", "label": "문제", "value": "만들 줄은 알지만 무엇을 팔아야 하는지 모른다", "tone": "mark" },
                { "key": "outcome", "label": "확인할 행동", "value": "지불 의향과 현재 대안을 첫 고객 대화에서 묻는다.", "tone": "strong" },
                { "key": "evidence", "label": "근거", "value": "docs/ICP.md, docs/SPEC.md", "tone": "code" }
              ],
              "summary": "Day 1 고객 신호"
            }
          }
        }
        """
    }

    private static func makeDay1IcpPlan() -> Day1IcpPlan {
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

    private static func installTemporaryWorkspace() throws -> (URL, () -> Void) {
        let productionLegacyProvider = WorkspaceSettings.legacyWorkspaceProvider
        WorkspaceSettings.legacyWorkspaceProvider = { "" }
        let workspace = FileManager.default.temporaryDirectory.appendingPathComponent(
            "agentic30-bip-research-viewmodel-\(UUID().uuidString)",
            isDirectory: true
        )
        try FileManager.default.createDirectory(at: workspace, withIntermediateDirectories: true)
        WorkspaceSettings.store(workspace)
        return (workspace, {
            WorkspaceSettings.clear()
            WorkspaceSettings.legacyWorkspaceProvider = productionLegacyProvider
            try? FileManager.default.removeItem(at: workspace)
        })
    }

    @MainActor
    private static func makeStartedViewModel(
        sidecar: FakeSidecarTransport,
        workspace: URL,
        currentDay: Int,
        selectedDay: Int? = nil
    ) -> AgenticViewModel {
        let viewModel = AgenticViewModel(
            onboardingContextOverride: OnboardingContext(
                businessDescription: "Agentic30",
                currentStage: "building",
                goal: "Find ICP",
                workMode: .fullTimeSolo,
                role: .developer,
                projectStage: .building,
                isolationLevel: .projectFolder,
                completedAt: "2026-05-08T00:00:00Z"
            ),
            sidecar: sidecar,
            activateAppForAuth: {}
        )
        let dayOffset = max(0, currentDay - 1)
        viewModel.ensureFoundationStarted(
            now: Date().addingTimeInterval(-Double(dayOffset) * 86_400 - 60)
        )
        if let selectedDay, selectedDay > 1 {
            for day in 1..<selectedDay {
                _ = viewModel.markFoundationDayCompleted(day)
            }
            viewModel.selectFoundationDay(selectedDay)
        }
        viewModel.start()
        viewModel.markSidecarConnectedForTesting(workspaceRoot: workspace.path)
        sidecar.resetSentPayloads()
        #expect(viewModel.workspaceRoot == workspace.path)
        return viewModel
    }
}
