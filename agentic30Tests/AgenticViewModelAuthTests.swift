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
        #expect(decoded.assistantSystemPromptFragment.contains("업무 일지"))
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
        #expect(report.estimatedSeconds == 110)
        #expect(report.canCompleteWithinBudget)
        #expect(report.remainingSeconds == 10)
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
            "Welcome to Agentic30",
            "We’re always by your side",
            "Build, launch, earn in 30 days",
            "Ship faster, learn faster",
        ])
        #expect(scenes[0].subtitle.contains("Mac assistant"))
        #expect(scenes[1].subtitle.contains("오늘 가장 중요한 한 가지 행동"))
        #expect(scenes[2].subtitle.contains("첫 결제 가능성"))
        #expect(scenes[3].subtitle.contains("고객 반응"))
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
        viewModel.setGuidedDay1OverlayActive(true)
        viewModel.skipGuidedDay1Overlay()
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
        #expect(viewModel.day1InterviewTutorialMode == .unguided)
        #expect(viewModel.structuredPromptDraftBySession.isEmpty == false)

        viewModel.resetVolatileLocalUserDataStateForTesting()

        #expect(viewModel.needsOnboardingIntro == true)
        #expect(viewModel.guidedDay1OverlayActive == false)
        #expect(viewModel.day1InterviewTutorialMode == .guided)
        #expect(viewModel.structuredPromptDraftBySession.isEmpty)
    }

    @Test @MainActor func day1OverlaySkipSwitchesToUnguidedInterviewMode() {
        let viewModel = AgenticViewModel(disablesSidecarStartForTesting: true, activateAppForAuth: {})

        viewModel.setGuidedDay1OverlayActive(true)
        #expect(viewModel.guidedDay1OverlayActive == true)
        #expect(viewModel.day1InterviewTutorialMode == .guided)

        viewModel.skipGuidedDay1Overlay()

        #expect(viewModel.guidedDay1OverlayActive == false)
        #expect(viewModel.day1InterviewTutorialMode == .unguided)
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
