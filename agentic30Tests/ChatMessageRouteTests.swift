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

    @MainActor @Test func bipDraftRequiresClaudeProvider() {
        #expect(ChatMessageRoute.SubWorkflow.bipDraft.requiresClaudeProvider == true)
    }
}

struct StructuredPromptSubmissionStateTests {
    private static func makeAssistantMessage(
        _ content: String = "",
        state: MessageState = .streaming,
        id: String = UUID().uuidString
    ) -> ChatMessage {
        ChatMessage(
            id: id,
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
        questionId: String? = nil,
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
                    questionId: questionId,
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

    private static func makeOfficeHoursDemandPrompt(
        sessionId: String = "office-hours-session",
        requestId: String = "office-hours-demand-request"
    ) -> StructuredPromptRequest {
        StructuredPromptRequest(
            requestId: requestId,
            sessionId: sessionId,
            toolName: "agentic30_request_user_input",
            title: "Office Hours",
            createdAt: Date(),
            questions: [
                StructuredPromptQuestion(
                    questionId: "office_hours_demand_evidence",
                    header: "수요 증거",
                    question: "Agentic30 수요를 실제 행동으로 확인한 가장 강한 증거는 무엇인가요?",
                    helperText: nil,
                    options: [
                        "실제 결제/계약이 있었다",
                        "구매 조건이 구체적으로 확인됐다",
                        "현재 대안에 돈/시간을 쓰고 있다",
                        "관심만 있거나 아직 증거가 없다",
                    ].map {
                        StructuredPromptOption(label: $0, description: "설명", preview: nil, nextIntent: nil)
                    },
                    multiSelect: false,
                    allowFreeText: false,
                    requiresFreeText: false,
                    freeTextPlaceholder: nil,
                    textMode: .short
                ),
            ],
            generation: StructuredPromptGeneration(mode: "office_hours", docType: "day1_step")
        )
    }

    private static func makeSession(
        id: String = "structured-session",
        pendingUserInput: StructuredPromptRequest? = nil,
        status: SessionStatus = .awaitingInput,
        runtime: ChatSessionRuntime? = nil,
        messages: [ChatMessage] = []
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
            messages: messages,
            pendingUserInput: pendingUserInput,
            runtime: runtime
        )
    }

    private static func makeIddPrompt(
        sessionId: String = "structured-session",
        docType: String,
        toolName: String = "agentic30_request_user_input",
        mode: String = "host_structured"
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
            generation: StructuredPromptGeneration(mode: mode, docType: docType)
        )
    }

    @MainActor @Test func messageReplacementCanRemainStreamingUntilSessionSnapshotFinalizes() throws {
        let viewModel = AgenticViewModel(activateAppForAuth: {})
        let messageID = "assistant-streaming-snapshot"
        var session = Self.makeSession(
            pendingUserInput: nil,
            status: .running,
            messages: [
                Self.makeAssistantMessage("", state: .streaming, id: messageID),
            ]
        )
        viewModel.replaceSessionsForTesting([session], selectedSessionID: session.id)

        let streamingEvent = try JSONDecoder().decode(SidecarEvent.self, from: Data("""
        {
          "type": "message_replaced",
          "sessionId": "\(session.id)",
          "messageId": "\(messageID)",
          "content": "부분 응답",
          "state": "streaming"
        }
        """.utf8))
        viewModel.applySidecarEventForTesting(streamingEvent)

        #expect(viewModel.selectedSession?.messages.first?.content == "부분 응답")
        #expect(viewModel.selectedSession?.messages.first?.state == .streaming)

        session.status = .idle
        session.messages[0].content = "최종 응답"
        session.messages[0].state = .final
        viewModel.applySessionUpdatedForTesting(session)

        #expect(viewModel.selectedSession?.messages.first?.content == "최종 응답")
        #expect(viewModel.selectedSession?.messages.first?.state == .final)
    }

    @MainActor @Test func sidecarUnexpectedExitMarksRunningSessionRecoverable() {
        let viewModel = AgenticViewModel(activateAppForAuth: {})
        let session = ChatSession(
            id: "running-session",
            title: "초기 설정: Ideal Customer Profile",
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
        #expect(recovered?.messages.last?.content.contains("응답이 끝나기 전에 실행 보조 앱이 중단됐습니다") == true)
    }

    @MainActor @Test func sidecarUnexpectedExitClearsMcpOauthConnectSpinner() throws {
        let viewModel = AgenticViewModel(activateAppForAuth: {})
        viewModel.markSidecarConnectedForTesting(workspaceRoot: "/tmp/workspace")
        viewModel.selectedProvider = .codex
        viewModel.connectMcpOauth(server: "posthog")

        #expect(viewModel.mcpOauthConnecting.contains("posthog"))
        #expect(viewModel.mcpOauthProgress["posthog"] != nil)

        let event = try JSONDecoder().decode(SidecarEvent.self, from: Data("""
        {
          "type": "sidecar_unexpected_exit",
          "message": "Sidecar stopped unexpectedly (exit 1)."
        }
        """.utf8))
        viewModel.applySidecarEventForTesting(event)

        #expect(viewModel.mcpOauthConnecting.isEmpty)
        #expect(viewModel.mcpOauthProgress.isEmpty)
        #expect(viewModel.mcpOauthResults["posthog"]?.state == "failed")
        #expect(viewModel.mcpOauthResults["posthog"]?.detail?.contains("실행 보조 앱이 중단") == true)
    }

    @MainActor @Test func globalErrorAndStopClearMcpOauthConnectSpinner() throws {
        let viewModel = AgenticViewModel(activateAppForAuth: {})
        viewModel.markSidecarConnectedForTesting(workspaceRoot: "/tmp/workspace")
        viewModel.connectMcpOauth(server: "posthog")

        let errorEvent = try JSONDecoder().decode(SidecarEvent.self, from: Data("""
        {
          "type": "error",
          "message": "sidecar connection closed"
        }
        """.utf8))
        viewModel.applySidecarEventForTesting(errorEvent)

        #expect(viewModel.mcpOauthConnecting.isEmpty)
        #expect(viewModel.mcpOauthProgress.isEmpty)
        #expect(viewModel.mcpOauthResults["posthog"]?.state == "failed")

        viewModel.markSidecarConnectedForTesting(workspaceRoot: "/tmp/workspace")
        viewModel.connectMcpOauth(server: "cloudflare")
        #expect(viewModel.mcpOauthConnecting.contains("cloudflare"))

        viewModel.stop()

        #expect(viewModel.mcpOauthConnecting.isEmpty)
        #expect(viewModel.mcpOauthProgress.isEmpty)
        #expect(viewModel.mcpOauthResults["cloudflare"] == nil)
    }

    @MainActor @Test func cancelledMcpOauthResultClearsSpinner() throws {
        let viewModel = AgenticViewModel(activateAppForAuth: {})
        viewModel.markSidecarConnectedForTesting(workspaceRoot: "/tmp/workspace")
        viewModel.connectMcpOauth(server: "vercel")
        #expect(viewModel.mcpOauthConnecting.contains("vercel"))

        let event = try JSONDecoder().decode(SidecarEvent.self, from: Data("""
        {
          "type": "mcp_oauth_connect_result",
          "mcpOauthConnect": {
            "server": "vercel",
            "provider": "claude",
            "state": "cancelled",
            "detail": "MCP 연결 확인을 중지했습니다. 다시 시도하세요.",
            "checkedAt": "2026-06-10T09:34:00.000Z"
          }
        }
        """.utf8))
        viewModel.applySidecarEventForTesting(event)

        #expect(viewModel.mcpOauthConnecting.isEmpty)
        #expect(viewModel.mcpOauthProgress.isEmpty)
        #expect(viewModel.mcpOauthResults["vercel"]?.state == "cancelled")
        #expect(viewModel.mcpOauthResults["vercel"]?.isCancelled == true)
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

    @MainActor @Test func interviewDayAnswerEntryCapturesAndPersistsDraftInUIState() {
        let viewModel = AgenticViewModel(activateAppForAuth: {})
        let prompt = Self.makePrompt()
        let question = prompt.questions[0]
        viewModel.replaceSessionsForTesting(
            [Self.makeSession(pendingUserInput: prompt)],
            selectedSessionID: prompt.sessionId
        )

        viewModel.synchronizeStructuredPromptDrafts(with: prompt)
        viewModel.toggleStructuredPromptOption("Provider", for: question, in: prompt)
        viewModel.activateStructuredPromptFreeText(for: question, in: prompt)

        let activated = viewModel.structuredPromptDraft(for: question, in: prompt)
        #expect(activated.selectedOptions == ["Provider"])
        #expect(activated.freeText.isEmpty)
        #expect(viewModel.canSubmitStructuredPrompt(prompt) == true)

        viewModel.updateStructuredPromptFreeText(
            "  macOS 메뉴바 앱을 쓰는 1인 개발자  ",
            for: question,
            in: prompt
        )
        viewModel.activateStructuredPromptFreeText(for: question, in: prompt)

        let captured = viewModel.structuredPromptDraft(for: question, in: prompt)
        #expect(captured.selectedOptions == ["Provider"])
        #expect(captured.freeText == "  macOS 메뉴바 앱을 쓰는 1인 개발자  ")
        #expect(viewModel.canSubmitStructuredPrompt(prompt) == true)

        viewModel.applySessionUpdatedForTesting(Self.makeSession(pendingUserInput: prompt))
        viewModel.synchronizeStructuredPromptDrafts(with: prompt)

        let persisted = viewModel.structuredPromptDraft(for: question, in: prompt)
        #expect(persisted == captured)

        let submissions = viewModel.structuredPromptSubmissions(for: prompt)
        #expect(submissions.count == 1)
        #expect(submissions[0].selectedOptions == ["Provider"])
        #expect(submissions[0].freeText == "macOS 메뉴바 앱을 쓰는 1인 개발자")
    }

    @MainActor @Test func selectingOptionAfterFreeTextKeepsOptionalFreeText() {
        let viewModel = AgenticViewModel(activateAppForAuth: {})
        let prompt = Self.makePrompt()
        let question = prompt.questions[0]
        viewModel.replaceSessionsForTesting(
            [Self.makeSession(pendingUserInput: prompt)],
            selectedSessionID: prompt.sessionId
        )

        viewModel.synchronizeStructuredPromptDrafts(with: prompt)
        viewModel.updateStructuredPromptFreeText("직접 입력한 답", for: question, in: prompt)
        viewModel.toggleStructuredPromptOption("Provider", for: question, in: prompt)

        let draft = viewModel.structuredPromptDraft(for: question, in: prompt)
        #expect(draft.selectedOptions == ["Provider"])
        #expect(draft.freeText == "직접 입력한 답")

        let submissions = viewModel.structuredPromptSubmissions(for: prompt)
        #expect(submissions.count == 1)
        #expect(submissions[0].selectedOptions == ["Provider"])
        #expect(submissions[0].freeText == "직접 입력한 답")
    }

    @MainActor @Test func optionQuestionWithRequiresFreeTextSubmitsOnSelectionOnly() {
        let viewModel = AgenticViewModel(activateAppForAuth: {})
        let prompt = Self.makeIddPrompt(docType: "icp")
        let question = prompt.questions[0]
        viewModel.replaceSessionsForTesting(
            [Self.makeSession(pendingUserInput: prompt)],
            selectedSessionID: prompt.sessionId
        )

        viewModel.synchronizeStructuredPromptDrafts(with: prompt)
        #expect(viewModel.canSubmitStructuredPrompt(prompt) == false)

        viewModel.toggleStructuredPromptOption("선택", for: question, in: prompt)
        #expect(viewModel.canSubmitStructuredPrompt(prompt) == true)

        let submissions = viewModel.structuredPromptSubmissions(for: prompt)
        #expect(submissions.count == 1)
        #expect(submissions[0].selectedOptions == ["선택"])
        #expect(submissions[0].freeText.isEmpty)
    }

    @MainActor @Test func officeHoursDemandEvidenceCardIsSingleClick() {
        let viewModel = AgenticViewModel(activateAppForAuth: {})
        let prompt = Self.makeOfficeHoursDemandPrompt()
        let demandQuestion = prompt.questions[0]

        viewModel.replaceSessionsForTesting(
            [Self.makeSession(pendingUserInput: prompt)],
            selectedSessionID: prompt.sessionId
        )
        viewModel.synchronizeStructuredPromptDrafts(with: prompt)

        #expect(prompt.questions.count == 1)
        #expect(demandQuestion.options?.count == 4)
        #expect(demandQuestion.allowFreeText == false)
        #expect(demandQuestion.requiresFreeText == false)
        #expect(viewModel.canSubmitStructuredPrompt(prompt) == false)

        viewModel.toggleStructuredPromptOption("실제 결제/계약이 있었다", for: demandQuestion, in: prompt)
        #expect(viewModel.canSubmitStructuredPrompt(prompt) == true)

        let submissions = viewModel.structuredPromptSubmissions(for: prompt)
        #expect(submissions.count == 1)
        #expect(submissions[0].selectedOptions == ["실제 결제/계약이 있었다"])
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

    @MainActor @Test func activeDay1HandoffPromptUsesSelectedMatchingDoc() {
        let viewModel = AgenticViewModel(activateAppForAuth: {})
        viewModel.setIddCurrentDocTypeForTesting("goal")
        let prompt = Self.makeIddPrompt(docType: "goal", mode: "day1_handoff")
        viewModel.replaceSessionsForTesting(
            [Self.makeSession(pendingUserInput: prompt)],
            selectedSessionID: prompt.sessionId
        )

        #expect(viewModel.activeDay1HandoffPrompt?.requestId == prompt.requestId)
    }

    @MainActor @Test func activeDay1HandoffPromptRejectsMismatchedDoc() {
        let viewModel = AgenticViewModel(activateAppForAuth: {})
        viewModel.setIddCurrentDocTypeForTesting("goal")
        let prompt = Self.makeIddPrompt(docType: "icp", mode: "day1_handoff")
        viewModel.replaceSessionsForTesting(
            [Self.makeSession(pendingUserInput: prompt)],
            selectedSessionID: prompt.sessionId
        )

        #expect(viewModel.activeDay1HandoffPrompt == nil)
    }

    @MainActor @Test func activeDay1DocumentReviewPromptFindsJudgePrompt() {
        let viewModel = AgenticViewModel(activateAppForAuth: {})
        let prompt = Self.makeIddPrompt(docType: "day1_doc_handoff_judge", mode: "office_hours")
        viewModel.replaceSessionsForTesting(
            [Self.makeSession(pendingUserInput: prompt)],
            selectedSessionID: prompt.sessionId
        )

        #expect(viewModel.activeDay1DocHandoffJudgePrompt?.requestId == prompt.requestId)
        #expect(viewModel.activeDay1DocumentReviewPrompt?.requestId == prompt.requestId)
    }

    @MainActor @Test func activeDay1DocumentReviewPromptFindsNewReviewSessionWhenNotSelected() {
        let viewModel = AgenticViewModel(activateAppForAuth: {})
        let prompt = Self.makeIddPrompt(
            sessionId: "day1-review-session",
            docType: "day1_doc_handoff_judge",
            mode: "office_hours"
        )
        viewModel.replaceSessionsForTesting(
            [
                Self.makeSession(id: "selected-session"),
                Self.makeSession(id: prompt.sessionId, pendingUserInput: prompt),
            ],
            selectedSessionID: "selected-session"
        )

        #expect(viewModel.activeDay1DocHandoffJudgePrompt?.requestId == prompt.requestId)
        #expect(viewModel.activeDay1DocumentReviewPrompt?.requestId == prompt.requestId)
    }

    @MainActor @Test func day1BulkHandoffJudgeBlockWaitsForStructuredPrompt() throws {
        let viewModel = AgenticViewModel(activateAppForAuth: {})
        viewModel.setDay1DocHandoffPendingDocTypeForTesting("all")

        viewModel.applyIddSetupProgressForTesting(
            sessionId: "day1-review-session",
            requestId: "day1-handoff-write-all",
            stage: "judge_blocked",
            progressText: "Office Hours 증거 judge가 문서 리뷰를 보류했습니다.",
            docType: "all",
            elapsedMs: 120
        )

        #expect(viewModel.day1DocHandoffPendingDocType == nil)
        #expect(viewModel.day1DocHandoffAwaitingFollowupPrompt == true)
        #expect(viewModel.activeDay1DocumentReviewPrompt == nil)

        let event = try JSONDecoder().decode(SidecarEvent.self, from: """
        {
          "type": "idd_setup_state",
          "iddSetupStatus": "error",
          "iddSetupError": {
            "provider": "codex",
            "docType": "goal",
            "message": "Office Hours 문서 judge가 5/10으로 문서 리뷰를 보류했습니다. 기준은 8/10입니다.",
            "recoverable": true
          }
        }
        """.data(using: .utf8)!)
        viewModel.applySidecarEventForTesting(event)

        #expect(viewModel.day1DocHandoffAwaitingFollowupPrompt == true)
        #expect(viewModel.day1DocHandoffError == "Office Hours 문서 judge가 5/10으로 문서 리뷰를 보류했습니다. 기준은 8/10입니다.")

        let prompt = Self.makeIddPrompt(
            sessionId: "day1-review-session",
            docType: "day1_doc_handoff_judge",
            mode: "office_hours"
        )
        viewModel.applySessionCreatedForTesting(Self.makeSession(id: prompt.sessionId, pendingUserInput: prompt))

        #expect(viewModel.day1DocHandoffAwaitingFollowupPrompt == false)
        #expect(viewModel.day1DocHandoffPendingDocType == nil)
        #expect(viewModel.activeDay1DocumentReviewPrompt?.requestId == prompt.requestId)
    }

    @MainActor @Test func day1BulkHandoffJudgePromptClearsBusyAndKeepsErrorSecondary() throws {
        let viewModel = AgenticViewModel(activateAppForAuth: {})
        viewModel.setDay1DocHandoffPendingDocTypeForTesting("all")
        let prompt = Self.makeIddPrompt(docType: "day1_doc_handoff_judge", mode: "office_hours")

        viewModel.applySessionUpdatedForTesting(Self.makeSession(pendingUserInput: prompt))

        #expect(viewModel.day1DocHandoffPendingDocType == nil)
        #expect(viewModel.day1DocHandoffAwaitingFollowupPrompt == false)
        #expect(viewModel.activeDay1DocumentReviewPrompt?.requestId == prompt.requestId)

        let event = try JSONDecoder().decode(SidecarEvent.self, from: """
        {
          "type": "idd_setup_state",
          "iddSetupStatus": "error",
          "iddSetupError": {
            "provider": "codex",
            "docType": "goal",
            "message": "Office Hours 증거 judge가 문서 리뷰를 보류했습니다.",
            "recoverable": true
          }
        }
        """.data(using: .utf8)!)
        viewModel.applySidecarEventForTesting(event)

        #expect(viewModel.day1DocHandoffPendingDocType == nil)
        #expect(viewModel.day1DocHandoffError == "Office Hours 증거 judge가 문서 리뷰를 보류했습니다.")
        #expect(viewModel.activeDay1DocumentReviewPrompt?.requestId == prompt.requestId)
    }

    @MainActor @Test func day1HandoffReviewRetryProgressRestoresBulkBusyState() {
        let viewModel = AgenticViewModel(activateAppForAuth: {})

        viewModel.applyIddSetupProgressForTesting(
            sessionId: "structured-session",
            requestId: "judge-request",
            stage: "review_retry",
            progressText: "보완 답변을 반영해 문서 리뷰를 다시 실행 중",
            docType: "all",
            elapsedMs: 20
        )

        #expect(viewModel.day1DocHandoffPendingDocType == "all")
        #expect(viewModel.day1DocHandoffError == nil)
    }

    @MainActor @Test func day1HandoffDisconnectedSurfacesVisibleError() {
        let viewModel = AgenticViewModel(activateAppForAuth: {})

        viewModel.startDay1DocHandoff(docType: "goal", day1Handoff: [:])

        #expect(viewModel.day1DocHandoffPendingDocType == nil)
        #expect(viewModel.day1DocHandoffError?.contains("실행 보조 앱 연결") == true)
    }

    @MainActor @Test func day1BulkHandoffJudgeErrorClearsAllPending() throws {
        let viewModel = AgenticViewModel(activateAppForAuth: {})
        viewModel.setDay1DocHandoffPendingDocTypeForTesting("all")

        let event = try JSONDecoder().decode(SidecarEvent.self, from: """
        {
          "type": "idd_setup_state",
          "iddSetupStatus": "error",
          "iddSetupError": {
            "provider": "codex",
            "docType": "goal",
            "message": "Office Hours 증거 judge가 문서 리뷰를 보류했습니다.",
            "recoverable": true
          }
        }
        """.data(using: .utf8)!)
        viewModel.applySidecarEventForTesting(event)

        #expect(viewModel.day1DocHandoffPendingDocType == nil)
        #expect(viewModel.day1DocHandoffError == "Office Hours 증거 judge가 문서 리뷰를 보류했습니다.")
    }

    @MainActor @Test func day1HandoffSessionReadyDoesNotLeaveWorkspaceSurface() throws {
        let viewModel = AgenticViewModel(
            onboardingContextOverride: OnboardingContext.make(
                workMode: .fullTimeSolo,
                focusArea: .development,
                productBottleneck: .firstActiveUsers,
                isolationLevel: .projectFolder
            ),
            disablesSidecarStartForTesting: true,
            activateAppForAuth: {}
        )
        let prompt = Self.makeIddPrompt(
            sessionId: "handoff-session",
            docType: "goal",
            mode: "day1_handoff"
        )
        let runtime = ChatSessionRuntime(
            codexThreadId: nil,
            codexThreadMeta: nil,
            codexWarm: nil,
            startupTiming: nil,
            iddDocumentType: "goal",
            iddMode: "day1_handoff"
        )
        viewModel.replaceSessionsForTesting(
            [Self.makeSession(id: prompt.sessionId, pendingUserInput: prompt, runtime: runtime)],
            selectedSessionID: prompt.sessionId
        )
        viewModel.showWorkspace()

        let event = try JSONDecoder().decode(SidecarEvent.self, from: """
        {
          "type": "bip_idd_session_ready",
          "sessionId": "\(prompt.sessionId)",
          "iddCurrentDocType": "goal"
        }
        """.data(using: .utf8)!)
        viewModel.applySidecarEventForTesting(event)

        #expect(viewModel.selectedSessionID == prompt.sessionId)
        #expect(viewModel.activeSurface == .workspace)
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
