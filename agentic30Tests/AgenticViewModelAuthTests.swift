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

@Suite(.serialized)
struct AgenticViewModelAuthTests {
    @Test @MainActor func onboardingContextMigratesLegacySoloAllValue() throws {
        let payload = """
        {
          "role": "developer",
          "project_stage": "building",
          "isolation_level": "solo_all",
          "completed_at": "2026-05-08T00:00:00Z"
        }
        """.data(using: .utf8)!

        let context = try JSONDecoder().decode(OnboardingContext.self, from: payload)

        #expect(context.workMode == .fullTimeSolo)
        #expect(context.role == .developer)
        #expect(context.projectStage == .building)
        #expect(context.isolationLevel == .projectFolder)
        #expect(context.isolationLevels == [.projectFolder])
    }

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
            customWorkMode: "주말마다 고객 인터뷰를 돌리는 중",
            workMode: .sideProject,
            role: .designer,
            projectStage: .preRevenue,
            isolationLevel: .weeklyLoop,
            completedAt: "2026-05-08T00:00:00Z"
        )

        let data = try JSONEncoder().encode(context)
        let object = try JSONSerialization.jsonObject(with: data) as? [String: Any]

        #expect(object?["work_mode"] as? String == "side_project")
        #expect(object?["custom_work_mode"] as? String == "주말마다 고객 인터뷰를 돌리는 중")
        #expect(object?["role"] as? String == "designer")
        #expect(object?["project_stage"] as? String == "pre_revenue")
        #expect(object?["isolation_level"] as? String == "weekly_loop")
        #expect(object?["isolation_levels"] as? [String] == ["weekly_loop"])
        #expect(object?["completed_at"] as? String == "2026-05-08T00:00:00Z")
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
                "Claude Haiku 4.5 (claude-haiku-4-5): using Read: docs/ICP.md docs/SPEC.md docs/GOAL.md",
                "GPT 5.4 Mini (gpt-5.4-mini): this is a long provider summary that should not leak raw debug text into onboarding"
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
        #expect(!state.lines.contains { $0.status?.contains("Claude Haiku") == true })
        #expect(!state.lines.contains { $0.status?.contains("gpt-5.4-mini") == true })
        #expect(state.scanDidComplete)
        #expect(!state.scanDidFail)
    }

    @Test @MainActor func intakeV2BootLogStateKeepsPendingStateSidecarOnly() {
        let empty = IntakeV2BootLogState.empty
        #expect(empty.lines.isEmpty)
        #expect(!empty.scanDidComplete)
        #expect(!empty.scanDidFail)
        #expect(empty.foundArtifactCount == nil)

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
}
