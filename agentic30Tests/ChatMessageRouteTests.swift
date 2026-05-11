import Foundation
import Testing
@testable import agentic30

/// Sub-AC 2 (AC 3): unit coverage for `AgenticViewModel.classifyMessageRoute`.
///
/// Goal: lock in the routing contract so daily-task / sub-workflow /
/// free-chat all flow through one chat surface but get tagged with the
/// right `mode`, `commandKind`, `subWorkflowName`, and `foundationDay`.
/// These tests exercise the pure classifier — no sidecar, no telemetry —
/// so they remain fast and stable across UI refactors.
struct ChatMessageRouteTests {
    private static func makeSession(
        messages: [ChatMessage] = [],
        provider: AgentProvider = .codex
    ) -> ChatSession {
        ChatSession(
            id: "session-route-test",
            title: "Route Test",
            provider: provider,
            model: AgentModelCatalog.defaultModelID(for: provider),
            status: .idle,
            createdAt: Date(),
            updatedAt: Date(),
            error: nil,
            messages: messages,
            pendingUserInput: nil,
            runtime: nil
        )
    }

    private static func makeUserMessage(_ content: String) -> ChatMessage {
        ChatMessage(
            id: UUID().uuidString,
            role: .user,
            provider: .codex,
            content: content,
            state: .final,
            createdAt: Date(),
            error: nil,
            bipMissionChoices: nil,
            providerAuthActions: nil
        )
    }

    // MARK: - Sub-workflow detection (slash-commands always win)

    @MainActor @Test func slashOfficeHoursDocsRoutesToSubWorkflow() {
        let viewModel = AgenticViewModel(activateAppForAuth: {})
        let route = viewModel.classifyMessageRoute(
            prompt: "/office-hours-docs Day 1",
            in: Self.makeSession(),
            foundationDayOverride: 1
        )
        #expect(route == .subWorkflow(.officeHoursDocs))
        #expect(route.modeTag == "sub_workflow")
        #expect(route.commandKind == "office_hours_docs")
        #expect(route.subWorkflowName == "office_hours_docs")
        #expect(route.foundationDay == nil)
    }

    @MainActor @Test func slashAnalyzeAdsRoutesToSubWorkflow() {
        let viewModel = AgenticViewModel(activateAppForAuth: {})
        let route = viewModel.classifyMessageRoute(
            prompt: "/analyze-ads",
            in: Self.makeSession(),
            foundationDayOverride: 5
        )
        #expect(route == .subWorkflow(.analyzeAds))
        #expect(route.subWorkflowName == "analyze_ads")
    }

    @MainActor @Test func slashMonetizationAskRoutesToSubWorkflow() {
        let viewModel = AgenticViewModel(activateAppForAuth: {})
        let route = viewModel.classifyMessageRoute(
            prompt: "/monetization-ask",
            in: Self.makeSession(),
            foundationDayOverride: 6
        )
        #expect(route == .subWorkflow(.monetizationAsk))
        #expect(route.subWorkflowName == "monetization_ask")
    }

    @MainActor @Test func slashFoundationSummaryRoutesToSubWorkflow() {
        let viewModel = AgenticViewModel(activateAppForAuth: {})
        let route = viewModel.classifyMessageRoute(
            prompt: "/foundation-summary",
            in: Self.makeSession(),
            foundationDayOverride: 7
        )
        #expect(route == .subWorkflow(.foundationSummary))
        #expect(route.subWorkflowName == "foundation_summary")
    }

    @MainActor @Test func slashCommandWinsOverDailyTaskClassification() {
        // Empty session + foundation day 0-7 would normally classify as
        // daily-task — but the slash-command prefix always wins.
        let viewModel = AgenticViewModel(activateAppForAuth: {})
        let route = viewModel.classifyMessageRoute(
            prompt: "/bip-draft",
            in: Self.makeSession(messages: []),
            foundationDayOverride: 0
        )
        #expect(route == .subWorkflow(.bipDraft))
    }

    // MARK: - Daily-task detection (first message in Foundation Day 0-7)

    @MainActor @Test func firstUserMessageInFoundationDayRoutesToDailyTask() {
        let viewModel = AgenticViewModel(activateAppForAuth: {})
        let route = viewModel.classifyMessageRoute(
            prompt: "오늘 과제 응답입니다",
            in: Self.makeSession(messages: []),
            foundationDayOverride: 1
        )
        #expect(route == .dailyTask(foundationDay: 1))
        #expect(route.modeTag == "daily_task")
        #expect(route.commandKind == "daily_task")
        #expect(route.subWorkflowName == nil)
        #expect(route.foundationDay == 1)
    }

    @MainActor @Test func firstUserMessageOnFoundationDayZeroRoutesToDailyTask() {
        // Day 0 is the spec-defined entry point — must route to daily-task.
        let viewModel = AgenticViewModel(activateAppForAuth: {})
        let route = viewModel.classifyMessageRoute(
            prompt: "Day 0 시작",
            in: Self.makeSession(messages: []),
            foundationDayOverride: 0
        )
        #expect(route == .dailyTask(foundationDay: 0))
    }

    @MainActor @Test func firstUserMessageOnFoundationDay7RoutesToDailyTask() {
        let viewModel = AgenticViewModel(activateAppForAuth: {})
        let route = viewModel.classifyMessageRoute(
            prompt: "Day 7 마무리",
            in: Self.makeSession(messages: []),
            foundationDayOverride: 7
        )
        #expect(route == .dailyTask(foundationDay: 7))
    }

    @MainActor @Test func secondUserMessageDoesNotRouteToDailyTask() {
        // Once a user message exists, subsequent input is free-chat — the
        // daily-task is the *first* response to the AI's first prompt.
        let viewModel = AgenticViewModel(activateAppForAuth: {})
        let route = viewModel.classifyMessageRoute(
            prompt: "후속 질문입니다",
            in: Self.makeSession(messages: [Self.makeUserMessage("첫 응답")]),
            foundationDayOverride: 1
        )
        #expect(route == .freeChat)
        #expect(route.modeTag == "free_chat")
    }

    @MainActor @Test func dayOutsideFoundationRangeFallsThroughToFreeChat() {
        // Day 8+ is Build phase territory — out of Foundation scope.
        let viewModel = AgenticViewModel(activateAppForAuth: {})
        let route = viewModel.classifyMessageRoute(
            prompt: "Build phase 메시지",
            in: Self.makeSession(messages: []),
            foundationDayOverride: 8
        )
        #expect(route == .freeChat)
    }

    @MainActor @Test func nilFoundationDayFallsThroughToFreeChat() {
        // No anchor yet (foundationStartedAt == nil) and no override —
        // can't classify as daily-task without a day.
        let viewModel = AgenticViewModel(activateAppForAuth: {})
        viewModel.resetFoundationProgressForTesting()
        let route = viewModel.classifyMessageRoute(
            prompt: "아직 anchor 없음",
            in: Self.makeSession(messages: []),
            foundationDayOverride: nil
        )
        // Without an anchor, foundationDayNumber is nil → free-chat.
        #expect(route == .freeChat)
    }

    // MARK: - Free-chat default

    @MainActor @Test func plainPromptInOngoingSessionRoutesToFreeChat() {
        let viewModel = AgenticViewModel(activateAppForAuth: {})
        let history = [
            Self.makeUserMessage("첫 응답"),
            Self.makeUserMessage("두 번째"),
        ]
        let route = viewModel.classifyMessageRoute(
            prompt: "그냥 대화",
            in: Self.makeSession(messages: history),
            foundationDayOverride: 3
        )
        #expect(route == .freeChat)
        #expect(route.commandKind == "chat")
    }

    // MARK: - SubWorkflow metadata sanity

    @MainActor @Test func analyzeAdsRequiresClaudeProvider() {
        #expect(ChatMessageRoute.SubWorkflow.analyzeAds.requiresClaudeProvider == true)
    }

    @MainActor @Test func foundationSummaryRequiresClaudeProvider() {
        #expect(ChatMessageRoute.SubWorkflow.foundationSummary.requiresClaudeProvider == true)
    }

    @MainActor @Test func officeHoursDocsDoesNotRequireClaudeProvider() {
        #expect(ChatMessageRoute.SubWorkflow.officeHoursDocs.requiresClaudeProvider == false)
    }

    @MainActor @Test func monetizationAskDoesNotRequireClaudeProvider() {
        #expect(ChatMessageRoute.SubWorkflow.monetizationAsk.requiresClaudeProvider == false)
    }

    @MainActor @Test func bipDraftDoesNotRequireClaudeProvider() {
        #expect(ChatMessageRoute.SubWorkflow.bipDraft.requiresClaudeProvider == false)
    }
}

struct StructuredPromptSubmissionStateTests {
    private static func makeAssistantMessage(
        _ content: String = "",
        state: MessageState = .streaming
    ) -> ChatMessage {
        ChatMessage(
            id: UUID().uuidString,
            role: .assistant,
            provider: .codex,
            content: content,
            state: state,
            createdAt: Date(),
            error: nil,
            bipMissionChoices: nil,
            providerAuthActions: nil
        )
    }

    private static func makePrompt(
        sessionId: String = "structured-session",
        requestId: String = "request-1",
        question: String = "누구를 인터뷰하나요?"
    ) -> StructuredPromptRequest {
        StructuredPromptRequest(
            requestId: requestId,
            sessionId: sessionId,
            toolName: "request_user_input",
            title: "Foundation Setup",
            createdAt: Date(),
            questions: [
                StructuredPromptQuestion(
                    header: "ICP",
                    question: question,
                    helperText: "가장 가까운 유저 타입을 고르세요.",
                    options: [
                        StructuredPromptOption(
                            label: "Provider",
                            description: "서비스 제공자",
                            preview: nil,
                            nextIntent: nil
                        ),
                    ],
                    multiSelect: false,
                    allowFreeText: true,
                    requiresFreeText: nil,
                    freeTextPlaceholder: "직접 입력",
                    textMode: .short
                ),
            ]
        )
    }

    private static func makeSession(
        id: String = "structured-session",
        pendingUserInput: StructuredPromptRequest?,
        status: SessionStatus = .awaitingInput
    ) -> ChatSession {
        ChatSession(
            id: id,
            title: "Foundation Setup",
            provider: .codex,
            model: AgentModelCatalog.defaultModelID(for: .codex),
            status: status,
            createdAt: Date(),
            updatedAt: Date(),
            error: nil,
            messages: [],
            pendingUserInput: pendingUserInput,
            runtime: nil
        )
    }

    private static func makeLegacyStaticPrompt(sessionId: String = "structured-session") -> StructuredPromptRequest {
        StructuredPromptRequest(
            requestId: "legacy-static-request",
            sessionId: sessionId,
            toolName: "request_user_input",
            title: "ICP 1/4",
            createdAt: Date(),
            questions: [
                StructuredPromptQuestion(
                    header: "첫 고객",
                    question: "이번 주 바로 인터뷰할 첫 고객은 누구인가요?",
                    helperText: "먼저 첫 고객 후보 하나만 고릅니다.",
                    options: [
                        StructuredPromptOption(
                            label: "가장 절박한 하위 ICP",
                            description: "legacy static option",
                            preview: nil,
                            nextIntent: nil
                        ),
                    ],
                    multiSelect: false,
                    allowFreeText: true,
                    requiresFreeText: nil,
                    freeTextPlaceholder: "예: MVP는 있지만 유료 고객이 없는 macOS 1인 개발자",
                    textMode: .short
                ),
            ]
        )
    }

    private static func makeIddPrompt(
        sessionId: String = "structured-session",
        docType: String,
        toolName: String = "agentic30_request_user_input"
    ) -> StructuredPromptRequest {
        StructuredPromptRequest(
            requestId: "idd-\(docType)-request",
            sessionId: sessionId,
            toolName: toolName,
            title: "\(docType.uppercased()) 정하기",
            createdAt: Date(),
            questions: [
                StructuredPromptQuestion(
                    header: "Foundation",
                    question: "\(docType) 질문",
                    helperText: nil,
                    options: [
                        StructuredPromptOption(
                            label: "선택",
                            description: "설명",
                            preview: nil,
                            nextIntent: nil
                        ),
                    ],
                    multiSelect: false,
                    allowFreeText: true,
                    requiresFreeText: true,
                    freeTextPlaceholder: "직접 입력",
                    textMode: .short
                ),
            ],
            generation: StructuredPromptGeneration(mode: "host_structured", docType: docType)
        )
    }

    @MainActor @Test func sidecarUnexpectedExitMarksRunningSessionRecoverable() {
        let viewModel = AgenticViewModel(activateAppForAuth: {})
        let session = ChatSession(
            id: "running-session",
            title: "Foundation Setup: ICP",
            provider: .codex,
            model: AgentModelCatalog.defaultCodexModelID,
            status: .running,
            createdAt: Date(),
            updatedAt: Date(),
            error: nil,
            messages: [Self.makeAssistantMessage()],
            pendingUserInput: nil,
            runtime: nil
        )

        viewModel.replaceSessionsForTesting([session])
        viewModel.recoverRunningSessionsForTesting(message: "Sidecar stopped unexpectedly (exit 1).")

        let recovered = viewModel.sessions.first
        #expect(recovered?.status == .error)
        #expect(recovered?.error?.contains("Sidecar stopped unexpectedly") == true)
        #expect(recovered?.messages.last?.state == .error)
        #expect(recovered?.messages.last?.content.contains("Sidecar stopped before this response completed") == true)
    }

    @MainActor @Test func structuredPromptSubmissionKeepsPendingInputLocally() {
        let viewModel = AgenticViewModel(activateAppForAuth: {})
        let prompt = Self.makePrompt()
        viewModel.replaceSessionsForTesting(
            [Self.makeSession(pendingUserInput: prompt)],
            selectedSessionID: prompt.sessionId
        )

        viewModel.submitStructuredPrompt(
            sessionId: prompt.sessionId,
            requestId: prompt.requestId,
            responses: [
                AgenticViewModel.StructuredPromptSubmission(
                    question: prompt.questions[0].question,
                    selectedOptions: ["Provider"],
                    freeText: "B2B SaaS"
                ),
            ]
        )

        #expect(viewModel.selectedSession?.pendingUserInput?.requestId == prompt.requestId)
        #expect(viewModel.selectedSession?.status == .running)
        let state = viewModel.structuredPromptSubmissionState(for: prompt.sessionId)
        #expect(state?.requestId == prompt.requestId)
        #expect(state?.answerSummary.contains("Provider") == true)
        #expect(state?.answerSummary.contains("B2B SaaS") == true)
    }

    @MainActor @Test func legacyStaticIddPromptIsHiddenWhileRegenerationRuns() {
        let viewModel = AgenticViewModel(activateAppForAuth: {})
        let prompt = Self.makeLegacyStaticPrompt()

        viewModel.applySessionUpdatedForTesting(Self.makeSession(pendingUserInput: prompt))

        #expect(viewModel.selectedSession?.pendingUserInput == nil)
        #expect(viewModel.pendingStructuredPrompt == nil)
        #expect(viewModel.selectedSession?.status == .running)
    }

    @MainActor @Test func foundationPromptMatchesCurrentDocOnly() {
        let viewModel = AgenticViewModel(activateAppForAuth: {})
        viewModel.setIddCurrentDocTypeForTesting("goal")

        let matching = Self.makeIddPrompt(docType: "goal")
        let mismatched = Self.makeIddPrompt(docType: "icp")
        let generic = Self.makeIddPrompt(docType: "goal", toolName: "initial_intake")

        #expect(viewModel.isMatchingFoundationPrompt(matching) == true)
        #expect(viewModel.isMismatchedFoundationPrompt(matching) == false)
        #expect(viewModel.isMatchingFoundationPrompt(mismatched) == false)
        #expect(viewModel.isMismatchedFoundationPrompt(mismatched) == true)
        #expect(viewModel.isMatchingFoundationPrompt(generic) == false)
        #expect(viewModel.isMismatchedFoundationPrompt(generic) == true)
    }

    @MainActor @Test func matchingIddProgressUpdatesSubmittedState() {
        let viewModel = AgenticViewModel(activateAppForAuth: {})
        let prompt = Self.makePrompt()
        viewModel.replaceSessionsForTesting(
            [Self.makeSession(pendingUserInput: prompt)],
            selectedSessionID: prompt.sessionId
        )
        viewModel.submitStructuredPrompt(
            sessionId: prompt.sessionId,
            requestId: prompt.requestId,
            responses: [
                AgenticViewModel.StructuredPromptSubmission(
                    question: prompt.questions[0].question,
                    selectedOptions: ["Provider"],
                    freeText: ""
                ),
            ]
        )

        viewModel.applyIddSetupProgressForTesting(
            sessionId: prompt.sessionId,
            requestId: prompt.requestId,
            stage: "recording_response",
            progressText: "ICP 문서에 반영 중",
            elapsedMs: 120
        )

        let state = viewModel.structuredPromptSubmissionState(for: prompt.sessionId)
        #expect(state?.progressStage == "recording_response")
        #expect(state?.progressText == "ICP 문서에 반영 중")
        #expect(state?.elapsedMs == 120)
        #expect(state?.progressUpdatedAt != nil)
    }

    @MainActor @Test func staleIddProgressDoesNotUpdateSubmittedState() {
        let viewModel = AgenticViewModel(activateAppForAuth: {})
        let prompt = Self.makePrompt(requestId: "request-1")
        viewModel.replaceSessionsForTesting(
            [Self.makeSession(pendingUserInput: prompt)],
            selectedSessionID: prompt.sessionId
        )
        viewModel.submitStructuredPrompt(
            sessionId: prompt.sessionId,
            requestId: prompt.requestId,
            responses: [
                AgenticViewModel.StructuredPromptSubmission(
                    question: prompt.questions[0].question,
                    selectedOptions: ["Provider"],
                    freeText: ""
                ),
            ]
        )

        viewModel.applyIddSetupProgressForTesting(
            sessionId: prompt.sessionId,
            requestId: "request-2",
            stage: "recording_response",
            progressText: "ICP 문서에 반영 중"
        )

        let state = viewModel.structuredPromptSubmissionState(for: prompt.sessionId)
        #expect(state?.progressStage == nil)
        #expect(state?.progressText == nil)
    }

    @MainActor @Test func validationErrorClearsSubmittedStateForRetry() {
        let viewModel = AgenticViewModel(activateAppForAuth: {})
        let prompt = Self.makePrompt()
        viewModel.replaceSessionsForTesting(
            [Self.makeSession(pendingUserInput: prompt)],
            selectedSessionID: prompt.sessionId
        )
        viewModel.submitStructuredPrompt(
            sessionId: prompt.sessionId,
            requestId: prompt.requestId,
            responses: [
                AgenticViewModel.StructuredPromptSubmission(
                    question: prompt.questions[0].question,
                    selectedOptions: ["Provider"],
                    freeText: ""
                ),
            ]
        )

        viewModel.applyIddSetupProgressForTesting(
            sessionId: prompt.sessionId,
            requestId: prompt.requestId,
            stage: "validation_error",
            progressText: "한 줄 근거를 입력해야 다음 질문으로 넘어갑니다."
        )

        #expect(viewModel.structuredPromptSubmissionState(for: prompt.sessionId) == nil)
        #expect(viewModel.selectedSession?.pendingUserInput?.requestId == prompt.requestId)
    }

    @MainActor @Test func newPendingInputClearsSubmittedState() {
        let viewModel = AgenticViewModel(activateAppForAuth: {})
        let prompt = Self.makePrompt(requestId: "request-1")
        viewModel.replaceSessionsForTesting(
            [Self.makeSession(pendingUserInput: prompt)],
            selectedSessionID: prompt.sessionId
        )
        viewModel.submitStructuredPrompt(
            sessionId: prompt.sessionId,
            requestId: prompt.requestId,
            responses: [
                AgenticViewModel.StructuredPromptSubmission(
                    question: prompt.questions[0].question,
                    selectedOptions: ["Provider"],
                    freeText: ""
                ),
            ]
        )

        let nextPrompt = Self.makePrompt(
            requestId: "request-2",
            question: "어떤 문제를 검증하나요?"
        )
        viewModel.applySessionUpdatedForTesting(Self.makeSession(pendingUserInput: nextPrompt))

        #expect(viewModel.structuredPromptSubmissionState(for: prompt.sessionId) == nil)
        #expect(viewModel.selectedSession?.pendingUserInput?.requestId == "request-2")
    }

    @MainActor @Test func nilPendingInputClearsSubmittedState() {
        let viewModel = AgenticViewModel(activateAppForAuth: {})
        let prompt = Self.makePrompt()
        viewModel.replaceSessionsForTesting(
            [Self.makeSession(pendingUserInput: prompt)],
            selectedSessionID: prompt.sessionId
        )
        viewModel.submitStructuredPrompt(
            sessionId: prompt.sessionId,
            requestId: prompt.requestId,
            responses: [
                AgenticViewModel.StructuredPromptSubmission(
                    question: prompt.questions[0].question,
                    selectedOptions: ["Provider"],
                    freeText: ""
                ),
            ]
        )

        viewModel.applySessionUpdatedForTesting(
            Self.makeSession(pendingUserInput: nil, status: .idle)
        )

        #expect(viewModel.structuredPromptSubmissionState(for: prompt.sessionId) == nil)
        #expect(viewModel.selectedSession?.pendingUserInput == nil)
    }
}
