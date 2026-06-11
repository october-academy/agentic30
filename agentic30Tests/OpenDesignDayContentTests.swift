import CoreFoundation
import Foundation
import Testing
@testable import agentic30

struct OpenDesignDayContentTests {
    @Test func workspaceChromeStyleUsesDay1ChromeForOfficeHoursAndSettingsOnly() {
        #expect(WorkspaceChromeStyle.resolve(
            isWorkspaceWindow: true,
            dayNumber: 1,
            selectedReferencePage: nil,
            isOfficeHoursPresented: false
        ) == .day1OfficeHours)
        #expect(WorkspaceChromeStyle.resolve(
            isWorkspaceWindow: true,
            dayNumber: 1,
            selectedReferencePage: .settings,
            isOfficeHoursPresented: false
        ) == .day1OfficeHours)
        #expect(WorkspaceChromeStyle.resolve(
            isWorkspaceWindow: true,
            dayNumber: 1,
            selectedReferencePage: .projects,
            isOfficeHoursPresented: false
        ) == .standard)
        #expect(WorkspaceChromeStyle.resolve(
            isWorkspaceWindow: true,
            dayNumber: 2,
            selectedReferencePage: .settings,
            isOfficeHoursPresented: true
        ) == .standard)
        #expect(WorkspaceChromeStyle.resolve(
            isWorkspaceWindow: false,
            dayNumber: 1,
            selectedReferencePage: .settings,
            isOfficeHoursPresented: true
        ) == .standard)
    }

    @Test func officeHoursTranscriptRowsHideSyntheticStartPrompt() {
        let rows = OfficeHoursTranscriptRow.rows(from: [
            makeChatMessage(id: "start", role: .user, content: "Office Hours"),
            makeChatMessage(id: "answer", role: .assistant, content: "현재 강한 가설은 이렇습니다."),
        ])

        #expect(rows.count == 1)
        #expect(rows[0].kind == .assistant)
        #expect(rows[0].content == "현재 강한 가설은 이렇습니다.")
    }

    @Test func officeHoursTranscriptRowsHideLegacySyntheticStartPrompt() {
        let rows = OfficeHoursTranscriptRow.rows(from: [
            makeChatMessage(id: "legacy-start", role: .user, content: "Day999 Office Hours"),
        ])

        #expect(rows.isEmpty)
    }

    @Test func officeHoursTranscriptRowsKeepLongUserAndAssistantTextUntruncated() {
        let longQuestion = String(repeating: "고객에게 무엇을 물어봐야 하는지 더 구체적으로 알고 싶습니다. ", count: 18)
        let longAnswer = String(repeating: "먼저 결제 이유를 만든 사건과 지금 대안을 분리해서 물어보세요. ", count: 22)
        let rows = OfficeHoursTranscriptRow.rows(from: [
            makeChatMessage(id: "question", role: .user, content: longQuestion),
            makeChatMessage(id: "answer", role: .assistant, content: longAnswer),
        ])

        #expect(rows.count == 2)
        #expect(rows[0].kind == .user)
        #expect(rows[0].content == longQuestion.trimmingCharacters(in: .whitespacesAndNewlines))
        #expect(rows[0].lineLimit == nil)
        #expect(rows[1].kind == .assistant)
        #expect(rows[1].content == longAnswer.trimmingCharacters(in: .whitespacesAndNewlines))
        #expect(rows[1].lineLimit == nil)
    }

    @Test func officeHoursTranscriptRowsKeepEmptyStreamingAssistantForLiveStatus() {
        let rows = OfficeHoursTranscriptRow.rows(from: [
            makeChatMessage(id: "streaming", role: .assistant, content: "", state: .streaming),
        ])

        #expect(rows.count == 1)
        #expect(rows[0].isStreamingPlaceholder)
        #expect(rows[0].lineLimit == nil)
    }

    @Test func officeHoursVisibleRowsDropStreamingPlaceholderWhileQuestionLoads() {
        let session = makeChatSession(
            status: .running,
            messages: [
                makeChatMessage(id: "streaming", role: .assistant, content: "", state: .streaming),
            ]
        )

        let rows = OfficeHoursLiveStatusPolicy.visibleRows(in: session)

        #expect(rows.isEmpty)
    }

    @Test func officeHoursVisibleRowsDropStreamingAssistantRowsWhenQuestionExists() {
        let session = makeChatSession(
            status: .awaitingInput,
            messages: [
                makeChatMessage(id: "start", role: .user, content: OfficeHoursTranscriptRow.syntheticStartPrompt),
                makeChatMessage(id: "answer", role: .user, content: "실제 한 사람의 시간 손실"),
                makeChatMessage(id: "streaming", role: .assistant, content: "", state: .streaming),
                makeChatMessage(id: "assistant", role: .assistant, content: "이미 받은 답변 요약", state: .streaming),
            ],
            pendingUserInput: makeOfficeHoursPrompt(sessionID: "session")
        )

        let rows = OfficeHoursLiveStatusPolicy.visibleRows(in: session)

        #expect(rows.map(\.id) == ["answer"])
        #expect(rows.map(\.kind) == [.user])
        #expect(rows.contains(where: \.isStreamingPlaceholder) == false)
        #expect(rows.last?.content == "실제 한 사람의 시간 손실")
    }

    @Test func officeHoursVisibleRowsHideFinalizedNarrationWhilePendingForProviderParity() {
        // Gemini (inline channel) finalizes a fresh narration message per answer,
        // whereas the tool channels (Claude/Codex) keep narration in one streaming
        // message hidden for the whole interview. While a question card is pending,
        // the finalized narration must be hidden too so every provider shows the
        // same clean card stack (the matched answer still rebuilds its card).
        let withPending = makeChatSession(
            status: .awaitingInput,
            messages: [
                makeChatMessage(id: "start", role: .user, content: OfficeHoursTranscriptRow.syntheticStartPrompt),
                makeChatMessage(id: "answer", role: .user, content: "실제 결제 대화로 이어짐"),
                makeChatMessage(id: "narration", role: .assistant, content: "좋습니다. 다음 질문을 준비했습니다.", state: .final),
            ],
            pendingUserInput: makeOfficeHoursPrompt(sessionID: "session")
        )
        let pendingRows = OfficeHoursLiveStatusPolicy.visibleRows(in: withPending)
        #expect(pendingRows.map(\.id) == ["answer"])
        #expect(!pendingRows.contains { $0.id == "narration" })

        // Interview concluded (no pending question): the final message still shows.
        let concluded = makeChatSession(
            status: .idle,
            messages: [
                makeChatMessage(id: "answer", role: .user, content: "실제 결제 대화로 이어짐"),
                makeChatMessage(id: "conclusion", role: .assistant, content: "정리하면 다음 단계는 결제 확인입니다.", state: .final),
            ]
        )
        let concludedRows = OfficeHoursLiveStatusPolicy.visibleRows(in: concluded)
        #expect(concludedRows.contains { $0.id == "conclusion" })
    }

    @Test func officeHoursVisibleRowsKeepSeededResumeRowsWhileInterviewActive() {
        // Day-1 resume seeds prior Q/A from the turn log; their submitted-card
        // snapshots died with the prior session, so the provider-parity hide
        // must not orphan the restored answers below questionless bubbles
        // while the resumed run is producing the next question.
        let session = makeChatSession(
            status: .running,
            messages: [
                makeChatMessage(id: "seed-q1", role: .assistant, content: "가장 강한 실제 신호는 무엇인가요?", seededTurn: true),
                makeChatMessage(id: "seed-a1", role: .user, content: "답장이 왔고 현재 대안/비용을 말했다", seededTurn: true),
                makeChatMessage(id: "start", role: .user, content: OfficeHoursTranscriptRow.syntheticStartPrompt),
                makeChatMessage(id: "narration", role: .assistant, content: "이어서 다음 질문을 준비합니다.", state: .final),
                makeChatMessage(id: "streaming", role: .assistant, content: "", state: .streaming),
            ]
        )

        let rows = OfficeHoursLiveStatusPolicy.visibleRows(in: session)

        #expect(rows.map(\.id) == ["seed-q1", "seed-a1"])
    }

    @Test func officeHoursTimelineBuilderNeverCollapsesSeededRowsIntoNewSnapshots() {
        // A NEW submitted card whose short option label is contained in a
        // seeded answer must not swallow the seeded row — that would misplace
        // the card at the seeded position and drop a restored answer. Seeded
        // rows always render as plain rows.
        let prompt = makeOfficeHoursPrompt(sessionID: "session", requestId: "request-new")
        let submission = AgenticViewModel.StructuredPromptSubmission(
            question: prompt.questions[0].question,
            selectedOptions: ["대안"],
            freeText: ""
        )
        let snapshot = OfficeHoursSubmittedPromptSnapshot(
            sessionId: "session",
            requestId: prompt.requestId,
            prompt: prompt,
            submissions: [submission],
            submittedAt: Date(timeIntervalSince1970: 10)
        )
        let rows = OfficeHoursTranscriptRow.rows(from: [
            makeChatMessage(id: "seed-a1", role: .user, content: "현재 대안에 돈/시간을 쓰고 있다", seededTurn: true),
        ])

        let items = OfficeHoursTimelineBuilder.items(
            rows: rows,
            submittedSnapshots: [snapshot],
            activeLoading: nil,
            fallbackTotal: 6
        )

        #expect(items.count == 2)
        if case .row(let row)? = items.first {
            #expect(row.id == "seed-a1")
            #expect(row.isSeededInterviewTurn)
        } else {
            #expect(Bool(false))
        }
        if case .submittedPrompt(let card)? = items.dropFirst().first {
            #expect(card.snapshot == snapshot)
        } else {
            #expect(Bool(false))
        }
    }

    @Test func officeHoursPendingPromptPresentationSuppressesCompletedOverflow() {
        let completed = OfficeHoursPendingPromptPresentation.resolve(
            answerCount: 7,
            fallbackTotal: 6,
            generationTotal: nil,
            interviewComplete: true
        )

        #expect(!completed.shouldRender)
        #expect(completed.questionNumber == 8)
        #expect(completed.total == 8)

        let stillActive = OfficeHoursPendingPromptPresentation.resolve(
            answerCount: 7,
            fallbackTotal: 6,
            generationTotal: nil,
            interviewComplete: false
        )

        #expect(stillActive.shouldRender)
        #expect(stillActive.questionNumber == 8)
        #expect(stillActive.total == 8)
    }

    @Test func officeHoursLiveStatusPolicyShowsDetachedPanelOnlyWithoutStreamingAssistantRow() {
        let runningWithoutAssistant = makeChatSession(
            status: .running,
            messages: [
                makeChatMessage(id: "answer", role: .user, content: "시간을 반복 낭비함"),
            ]
        )
        let rowsWithoutAssistant = OfficeHoursTranscriptRow.rows(from: runningWithoutAssistant.messages)
        #expect(OfficeHoursLiveStatusPolicy.shouldShowDetachedLiveStatus(
            in: runningWithoutAssistant,
            rows: rowsWithoutAssistant
        ))

        let runningWithStreamingAssistant = makeChatSession(
            status: .running,
            messages: [
                makeChatMessage(id: "answer", role: .user, content: "시간을 반복 낭비함"),
                makeChatMessage(id: "assistant", role: .assistant, content: "다음 질문은", state: .streaming),
            ]
        )
        let rowsWithAssistant = OfficeHoursLiveStatusPolicy.visibleRows(in: runningWithStreamingAssistant)
        #expect(OfficeHoursLiveStatusPolicy.shouldShowDetachedLiveStatus(
            in: runningWithStreamingAssistant,
            rows: rowsWithAssistant
        ))
        #expect(rowsWithAssistant.map(\.id) == ["answer"])

        let awaitingInput = makeChatSession(status: .awaitingInput)
        #expect(!OfficeHoursLiveStatusPolicy.shouldShowDetachedLiveStatus(in: awaitingInput, rows: []))
    }

    @Test func officeHoursLoaderCopyOnlyUsesLiveStatus() {
        let status = OfficeHoursLiveStatus(
            sessionId: "session",
            stage: "provider_starting",
            title: "다음 질문 준비 중",
            detail: "프로젝트 맥락에 맞는 질문을 준비하고 있습니다.",
            progressText: "프로젝트 맥락에 맞는 질문 준비 중",
            messageId: nil,
            requestId: nil,
            elapsedMs: 42,
            updatedAt: Date(timeIntervalSince1970: 1)
        )

        let live = OfficeHoursLoaderCopy.resolve(status: status)
        let empty = OfficeHoursLoaderCopy.resolve(status: nil)

        #expect(live?.title == "다음 질문 준비 중")
        #expect(live?.detail == "프로젝트 맥락에 맞는 질문을 준비하고 있습니다.")
        #expect(empty == nil)
    }

    @Test func officeHoursTimelineBuilderShowsSubmittedCardBeforeActiveLoader() {
        let prompt = makeOfficeHoursPrompt(sessionID: "session", requestId: "request-1")
        let submission = AgenticViewModel.StructuredPromptSubmission(
            question: prompt.questions[0].question,
            selectedOptions: ["돈을 내겠다고 했다"],
            freeText: "실제 결제 대화로 이어짐"
        )
        let snapshot = OfficeHoursSubmittedPromptSnapshot(
            sessionId: "session",
            requestId: prompt.requestId,
            prompt: prompt,
            submissions: [submission],
            submittedAt: Date(timeIntervalSince1970: 1)
        )
        let loading = OfficeHoursLoadingSnapshot(
            sessionId: "session",
            requestId: prompt.requestId,
            startedAt: Date(timeIntervalSince1970: 2)
        )
        let rows = OfficeHoursTranscriptRow.rows(from: [
            makeChatMessage(id: "question", role: .assistant, content: prompt.questions[0].question),
            makeChatMessage(id: "answer", role: .user, content: "돈을 내겠다고 했다 — 실제 결제 대화로 이어짐"),
        ])

        let items = OfficeHoursTimelineBuilder.items(
            rows: rows,
            submittedSnapshots: [snapshot],
            activeLoading: loading,
            fallbackTotal: 6
        )

        #expect(items.count == 2)
        if case .submittedPrompt(let card)? = items.first {
            #expect(card.snapshot == snapshot)
            #expect(card.index == 1)
            #expect(card.total == 6)
        } else {
            #expect(Bool(false))
        }
        if case .loading(let itemLoading)? = items.dropFirst().first {
            #expect(itemLoading == loading)
        } else {
            #expect(Bool(false))
        }
        #expect(items.filter {
            if case .row = $0 { return true }
            return false
        }.isEmpty)
    }

    @Test func officeHoursTimelineBuilderKeepsAssistantOutputThatMentionsSubmittedAnswer() {
        let prompt = makeOfficeHoursPrompt(sessionID: "session", requestId: "request-1")
        let submission = AgenticViewModel.StructuredPromptSubmission(
            question: prompt.questions[0].question,
            selectedOptions: ["돈을 내겠다고 했다"],
            freeText: ""
        )
        let snapshot = OfficeHoursSubmittedPromptSnapshot(
            sessionId: "session",
            requestId: prompt.requestId,
            prompt: prompt,
            submissions: [submission],
            submittedAt: Date(timeIntervalSince1970: 1)
        )
        let rows = OfficeHoursTranscriptRow.rows(from: [
            makeChatMessage(id: "answer", role: .user, content: "돈을 내겠다고 했다"),
            makeChatMessage(
                id: "provider-output",
                role: .assistant,
                content: "돈을 내겠다고 했다라는 답을 기준으로 다음 검증 단계를 좁힙니다."
            ),
        ])

        let items = OfficeHoursTimelineBuilder.items(
            rows: rows,
            submittedSnapshots: [snapshot],
            activeLoading: nil,
            fallbackTotal: 6
        )

        #expect(items.count == 2)
        if case .submittedPrompt(let card)? = items.first {
            #expect(card.snapshot == snapshot)
        } else {
            #expect(Bool(false))
        }
        if case .row(let row)? = items.dropFirst().first {
            #expect(row.id == "provider-output")
            #expect(row.kind == .assistant)
        } else {
            #expect(Bool(false))
        }
    }

    @Test func officeHoursLoadingPolicyKeepsSubmittedCardWhenNextPromptArrives() {
        let firstPrompt = makeOfficeHoursPrompt(sessionID: "session", requestId: "request-1")
        let nextPrompt = makeOfficeHoursPrompt(sessionID: "session", requestId: "request-2")
        let submission = AgenticViewModel.StructuredPromptSubmission(
            question: firstPrompt.questions[0].question,
            selectedOptions: ["돈을 내겠다고 했다"],
            freeText: ""
        )
        let snapshot = OfficeHoursSubmittedPromptSnapshot(
            sessionId: "session",
            requestId: firstPrompt.requestId,
            prompt: firstPrompt,
            submissions: [submission],
            submittedAt: Date(timeIntervalSince1970: 1)
        )
        let loading = OfficeHoursLoadingSnapshot(
            sessionId: "session",
            requestId: firstPrompt.requestId,
            startedAt: Date(timeIntervalSince1970: 2)
        )
        let session = makeChatSession(status: .awaitingInput, pendingUserInput: nextPrompt)
        let visibleLoading = OfficeHoursLoadingPolicy.visibleLoading(for: session, loading: loading)

        let items = OfficeHoursTimelineBuilder.items(
            rows: [],
            submittedSnapshots: [snapshot],
            activeLoading: visibleLoading,
            fallbackTotal: 6
        )

        #expect(visibleLoading == nil)
        #expect(items.count == 1)
        if case .submittedPrompt(let card)? = items.first {
            #expect(card.snapshot == snapshot)
            #expect(card.index == 1)
            #expect(card.total == 6)
        } else {
            #expect(Bool(false))
        }
    }

    @Test func officeHoursInitialSyntheticLoaderIsSingleTimelineItemForRunningEmptyTranscript() {
        let session = makeChatSession(
            status: .running,
            messages: [
                makeChatMessage(id: "start", role: .user, content: OfficeHoursTranscriptRow.syntheticStartPrompt),
                makeChatMessage(id: "assistant", role: .assistant, content: "", state: .streaming),
            ]
        )
        let loading = OfficeHoursLoadingSnapshot(
            sessionId: "session",
            requestId: "office-hours-start-session",
            startedAt: Date(timeIntervalSince1970: 2)
        )
        let rows = OfficeHoursLiveStatusPolicy.visibleRows(in: session)
        let visibleLoading = OfficeHoursLoadingPolicy.visibleLoading(for: session, loading: loading)

        let items = OfficeHoursTimelineBuilder.items(
            rows: rows,
            submittedSnapshots: [],
            activeLoading: visibleLoading
        )

        #expect(rows.isEmpty)
        #expect(items.count == 1)
        if case .loading(let itemLoading)? = items.first {
            #expect(itemLoading == loading)
        } else {
            #expect(Bool(false))
        }
        #expect(items.filter {
            if case .loading = $0 { return true }
            return false
        }.count == 1)
    }

    @Test func officeHoursInitialSyntheticLoaderHidesWhenPendingPromptArrives() {
        let prompt = makeOfficeHoursPrompt(sessionID: "session", requestId: "request-2")
        let session = makeChatSession(status: .awaitingInput, pendingUserInput: prompt)
        let loading = OfficeHoursLoadingSnapshot(
            sessionId: "session",
            requestId: "office-hours-start-session",
            startedAt: Date(timeIntervalSince1970: 2)
        )
        let visibleLoading = OfficeHoursLoadingPolicy.visibleLoading(for: session, loading: loading)

        let items = OfficeHoursTimelineBuilder.items(
            rows: OfficeHoursLiveStatusPolicy.visibleRows(in: session),
            submittedSnapshots: [],
            activeLoading: visibleLoading
        )

        #expect(visibleLoading == nil)
        #expect(items.isEmpty)
    }

    private func makeChatMessage(
        id: String,
        role: MessageRole,
        content: String,
        state: MessageState = .final,
        seededTurn: Bool = false
    ) -> ChatMessage {
        ChatMessage(
            id: id,
            role: role,
            provider: .codex,
            content: content,
            state: state,
            createdAt: Date(),
            error: nil,
            bipMissionChoices: nil,
            providerAuthActions: nil,
            inlineDecision: nil,
            officeHoursSeededTurn: seededTurn ? true : nil
        )
    }

    private func makeChatSession(
        id: String = "session",
        provider: AgentProvider = .codex,
        status: SessionStatus = .idle,
        messages: [ChatMessage] = [],
        pendingUserInput: StructuredPromptRequest? = nil
    ) -> ChatSession {
        ChatSession(
            id: id,
            title: "Office Hours",
            provider: provider,
            model: AgentModelCatalog.defaultModelID(for: provider),
            status: status,
            createdAt: Date(),
            updatedAt: Date(),
            error: nil,
            messages: messages,
            pendingUserInput: pendingUserInput,
            runtime: nil
        )
    }

    private func makeOfficeHoursPrompt(
        sessionID: String,
        requestId: String = "office-hours-prompt"
    ) -> StructuredPromptRequest {
        StructuredPromptRequest(
            requestId: requestId,
            sessionId: sessionID,
            toolName: "agentic30_request_user_input",
            title: "Office Hours",
            createdAt: Date(),
            questions: [
                StructuredPromptQuestion(
                    questionId: "office_hours_forcing_question",
                    header: "질문",
                    question: "가장 먼저 검증할 고객 신호는 무엇인가요?",
                    helperText: nil,
                    options: nil,
                    multiSelect: false,
                    allowFreeText: true,
                    requiresFreeText: false,
                    freeTextPlaceholder: nil,
                    textMode: .short
                ),
            ],
            generation: StructuredPromptGeneration(mode: "office_hours", docType: "day1_step")
        )
    }

    @Test func officeHoursRealProjectTestRequiresFreshIdleSession() {
        let fresh = makeChatSession()
        #expect(OfficeHoursRealProjectTestSessionPolicy.canStartTest(in: fresh, provider: .codex))
        #expect(!OfficeHoursRealProjectTestSessionPolicy.canStartTest(in: nil, provider: .codex))

        let pending = makeChatSession(
            status: .awaitingInput,
            pendingUserInput: makeOfficeHoursPrompt(sessionID: "session")
        )
        #expect(!OfficeHoursRealProjectTestSessionPolicy.canStartTest(in: pending, provider: .codex))

        let previousConversation = makeChatSession(messages: [
            makeChatMessage(id: "assistant-1", role: .assistant, content: "첫 질문입니다."),
        ])
        #expect(!OfficeHoursRealProjectTestSessionPolicy.canStartTest(in: previousConversation, provider: .codex))

        let running = makeChatSession(status: .running)
        #expect(!OfficeHoursRealProjectTestSessionPolicy.canStartTest(in: running, provider: .codex))

        let wrongProvider = makeChatSession(provider: .claude)
        #expect(!OfficeHoursRealProjectTestSessionPolicy.canStartTest(in: wrongProvider, provider: .codex))
    }

    @Test func officeHoursAutoStartPolicyBlocksWhileRealProjectTestOwnsSession() {
        let fresh = makeChatSession(id: "office-hours-session")

        #expect(OfficeHoursAutoStartPolicy.canAutoStart(
            in: fresh,
            startedSessionIDs: [],
            realProjectTestBusy: false,
            realProjectSessionCreateRequested: false
        ))
        #expect(!OfficeHoursAutoStartPolicy.canAutoStart(
            in: fresh,
            startedSessionIDs: [],
            realProjectTestBusy: true,
            realProjectSessionCreateRequested: false
        ))
        #expect(!OfficeHoursAutoStartPolicy.canAutoStart(
            in: fresh,
            startedSessionIDs: [],
            realProjectTestBusy: false,
            realProjectSessionCreateRequested: true
        ))
        #expect(!OfficeHoursAutoStartPolicy.canAutoStart(
            in: fresh,
            startedSessionIDs: ["office-hours-session"],
            realProjectTestBusy: false,
            realProjectSessionCreateRequested: false
        ))
    }

    @Test func officeHoursProviderSwitchReArmsAutoStartForStuckSession() {
        // Repro of the stuck Day-1 session: the first interview question failed to
        // generate (the prior provider hit its usage limit), so the session is idle with
        // no pending input. It is already recorded in startedSessionIDs, so it cannot
        // auto-restart on its own — and after a provider switch the sidecar clears the
        // error, removing the only "다시 시도" affordance.
        let stuck = makeChatSession(id: "office-hours-session", provider: .claude, status: .idle)
        #expect(!OfficeHoursAutoStartPolicy.canAutoStart(
            in: stuck,
            startedSessionIDs: ["office-hours-session"],
            realProjectTestBusy: false,
            realProjectSessionCreateRequested: false
        ))

        // Switching the active engine in place (same session id, codex → claude) is a
        // genuine provider switch, so the view re-arms auto-start.
        let inPlaceSwitch = OfficeHoursAutoStartPolicy.shouldRestartAfterProviderChange(
            from: OfficeHoursAutoStartPolicy.SessionProviderSnapshot(sessionID: "office-hours-session", provider: .codex),
            to: OfficeHoursAutoStartPolicy.SessionProviderSnapshot(sessionID: "office-hours-session", provider: .claude)
        )
        #expect(inPlaceSwitch)

        // After re-arming (eviction from startedSessionIDs), the session becomes
        // restart-eligible and the Day question regenerates on the new engine.
        #expect(OfficeHoursAutoStartPolicy.canAutoStart(
            in: stuck,
            startedSessionIDs: [],
            realProjectTestBusy: false,
            realProjectSessionCreateRequested: false
        ))
    }

    @Test func officeHoursProviderSwitchPolicyIgnoresNonSwitches() {
        typealias Snapshot = OfficeHoursAutoStartPolicy.SessionProviderSnapshot

        // Same provider is not a switch.
        let sameProvider = OfficeHoursAutoStartPolicy.shouldRestartAfterProviderChange(
            from: Snapshot(sessionID: "s", provider: .codex),
            to: Snapshot(sessionID: "s", provider: .codex)
        )
        #expect(sameProvider == false)

        // Selecting a *different* session (different id) is not an in-place switch, so an
        // unrelated session is never restarted.
        let sessionSwap = OfficeHoursAutoStartPolicy.shouldRestartAfterProviderChange(
            from: Snapshot(sessionID: "a", provider: .codex),
            to: Snapshot(sessionID: "b", provider: .claude)
        )
        #expect(sessionSwap == false)

        // No prior snapshot (initial assignment / no session) → no restart.
        let nilFrom = OfficeHoursAutoStartPolicy.shouldRestartAfterProviderChange(
            from: nil,
            to: Snapshot(sessionID: "s", provider: .claude)
        )
        #expect(nilFrom == false)

        let nilTo = OfficeHoursAutoStartPolicy.shouldRestartAfterProviderChange(
            from: Snapshot(sessionID: "s", provider: .codex),
            to: nil
        )
        #expect(nilTo == false)
    }

    @Test func officeHoursProviderSwitchLeavesValidPendingQuestionUntouched() {
        // If a valid question is already in flight, switching providers must NOT discard
        // it: canAutoStart stays false even after eviction, so the next answer is simply
        // handled by the newly selected engine instead of regenerating the question.
        let awaiting = makeChatSession(
            id: "office-hours-session",
            provider: .claude,
            status: .awaitingInput,
            pendingUserInput: makeOfficeHoursPrompt(sessionID: "office-hours-session")
        )
        #expect(!OfficeHoursAutoStartPolicy.canAutoStart(
            in: awaiting,
            startedSessionIDs: [],
            realProjectTestBusy: false,
            realProjectSessionCreateRequested: false
        ))
    }

    @Test func inlineMarkdownEmphasisParserSplitsSingleRun() {
        #expect(openDesignInlineMarkdownEmphasisRuns(in: "a **b** c") == [
            OpenDesignInlineMarkdownEmphasisRun(text: "a ", isEmphasized: false),
            OpenDesignInlineMarkdownEmphasisRun(text: "b", isEmphasized: true),
            OpenDesignInlineMarkdownEmphasisRun(text: " c", isEmphasized: false),
        ])
    }

    @Test func inlineMarkdownEmphasisParserSupportsMultipleRuns() {
        #expect(openDesignInlineMarkdownEmphasisRuns(in: "**first** and **second**") == [
            OpenDesignInlineMarkdownEmphasisRun(text: "first", isEmphasized: true),
            OpenDesignInlineMarkdownEmphasisRun(text: " and ", isEmphasized: false),
            OpenDesignInlineMarkdownEmphasisRun(text: "second", isEmphasized: true),
        ])
    }

    @Test func inlineMarkdownEmphasisParserSupportsKoreanAndEnglishText() {
        #expect(openDesignInlineMarkdownEmphasisRuns(in: "돕는 **local-first macOS 메뉴바 AI assistant** 입니다") == [
            OpenDesignInlineMarkdownEmphasisRun(text: "돕는 ", isEmphasized: false),
            OpenDesignInlineMarkdownEmphasisRun(text: "local-first macOS 메뉴바 AI assistant", isEmphasized: true),
            OpenDesignInlineMarkdownEmphasisRun(text: " 입니다", isEmphasized: false),
        ])
    }

    @Test func inlineMarkdownEmphasisParserKeepsUnmatchedDelimiterLiteral() {
        #expect(openDesignInlineMarkdownEmphasisRuns(in: "a **b c") == [
            OpenDesignInlineMarkdownEmphasisRun(text: "a **b c", isEmphasized: false),
        ])
    }

    @Test func inlineMarkdownEmphasisParserKeepsEmptyDelimiterPairLiteral() {
        #expect(openDesignInlineMarkdownEmphasisRuns(in: "a **** c") == [
            OpenDesignInlineMarkdownEmphasisRun(text: "a ****", isEmphasized: false),
            OpenDesignInlineMarkdownEmphasisRun(text: " c", isEmphasized: false),
        ])
    }

    @Test func displayProjectDigestHidesEphemeralWorkspaceSlugs() {
        let slug = "agentic30-ui-opendesign-day-handoff-7BC22624-F1F9-4569-B4EB-884798290B65"

        #expect(openDesignDisplayProjectDigestValue(slug) == "이 프로젝트")
        #expect(openDesignDisplayProductName(slug) == nil)
        #expect(openDesignDisplayProductName("agentic30-public") == "agentic30-public")
        #expect(openDesignDisplayProductName("**agentic30 Mac**") == "agentic30 Mac")
    }

    @Test func layoutMetricsFollowOpenDesignBreakpointsAndNativeCompactCollapse() {
        let wide = OpenDesignDayLayoutMetrics(width: 1360)
        #expect(wide.railWidth == 52)
        #expect(wide.taskSidebarWidth == 240)
        #expect(wide.metaPanelWidth == 280)
        #expect(wide.mainHorizontalPadding == 28)
        #expect(wide.showsTaskSidebar)
        #expect(wide.showsMetaPanel)
        #expect(wide.openDesignGridColumnCount == 4)

        let primary = OpenDesignDayLayoutMetrics(width: 1136)
        #expect(primary.railWidth == 48)
        #expect(primary.taskSidebarWidth == 220)
        #expect(primary.metaPanelWidth == 252)
        #expect(primary.mainHorizontalPadding == 24)
        #expect(primary.showsTaskSidebar)
        #expect(primary.showsMetaPanel)
        #expect(primary.openDesignGridColumnCount == 4)

        let medium = OpenDesignDayLayoutMetrics(width: 900)
        #expect(medium.railWidth == 48)
        #expect(medium.taskSidebarWidth == 200)
        #expect(medium.mainHorizontalPadding == 24)
        #expect(medium.showsTaskSidebar)
        #expect(!medium.showsMetaPanel)
        #expect(medium.openDesignGridColumnCount == 2)

        let narrow = OpenDesignDayLayoutMetrics(width: 820)
        #expect(narrow.railWidth == 48)
        #expect(!narrow.showsTaskSidebar)
        #expect(!narrow.showsMetaPanel)
        #expect(narrow.openDesignGridColumnCount == 2)
    }

    @Test func officeHoursScreenLayoutMatchesHtmlBreakpoints() {
        let wide = OfficeHoursScreenLayout(width: 1360)
        #expect(wide.showsSessions)
        #expect(wide.showsMeta)
        #expect(wide.sessionsWidth == 240)
        #expect(wide.metaWidth == 280)
        #expect(wide.mainPadding == 28)

        let noMeta = OfficeHoursScreenLayout(width: 1180)
        #expect(noMeta.showsSessions)
        #expect(!noMeta.showsMeta)
        #expect(noMeta.sessionsWidth == 240)
        #expect(noMeta.mainPadding == 28)

        let noSessions = OfficeHoursScreenLayout(width: 900)
        #expect(!noSessions.showsSessions)
        #expect(!noSessions.showsMeta)
        #expect(noSessions.mainPadding == 28)

        let mobile = OfficeHoursScreenLayout(width: 640)
        #expect(!mobile.showsSessions)
        #expect(!mobile.showsMeta)
        #expect(mobile.mainPadding == 16)
    }

    @Test func increasedContrastStrengthensOpenDesignChrome() {
        #expect(OpenDesignAccessibilityMetrics.borderLineWidth(isIncreasedContrast: false) == 1)
        #expect(OpenDesignAccessibilityMetrics.borderLineWidth(isIncreasedContrast: true) == 1.5)
    }

    @Test func dayFixtureContainsOpenDesignNavigationAndTasks() {
        let content = OpenDesignDayContent.day1
        let firstTask: OpenDesignTaskItem? = content.taskGroups.first?.tasks.first

        #expect(content.railItems.map(\.title) == [
            "오늘 · Day 1",
            "아침 브리핑",
            "설정",
        ])
        #expect(content.taskGroups.count == 4)
        #expect(content.taskGroups.first?.tasks.count == 7)
        #expect(firstTask?.title == "먼저 도울 사람을 정해요")
        #expect(firstTask?.meta == "고객 후보 · 인터뷰 4문항")
        #expect(content.railItems.first(where: { $0.id == "today" })?.route == .officeHours)
        #expect(content.searchItems.first(where: { $0.id == "page-today" })?.route == .officeHours)
        #expect(content.searchItems.first(where: { $0.id == "task-day1" })?.route == .officeHours)
        #expect(content.interviewSteps.count == 4)
        #expect(content.interviewSteps.first?.score == "1 / 4")
        #expect(content.interviewSteps.first?.options.count == 4)
    }

    @Test func day1GoalProductNameUsesProjectSourceOrderAndFallback() {
        #expect(openDesignDay1GoalProductName(
            situationSummaryName: " Agentic30 ",
            alignmentProductName: "SupportLens",
            icpProductName: "PhotoVault"
        ) == "Agentic30")
        #expect(openDesignDay1GoalProductName(
            situationSummaryName: nil,
            alignmentProductName: " SupportLens ",
            icpProductName: "PhotoVault"
        ) == "SupportLens")
        #expect(openDesignDay1GoalProductName(
            situationSummaryName: nil,
            alignmentProductName: nil,
            icpProductName: " PhotoVault "
        ) == "PhotoVault")
        #expect(openDesignDay1GoalProductName(
            situationSummaryName: " ",
            alignmentProductName: nil,
            icpProductName: nil
        ) == "이 프로젝트")
        #expect(openDesignDay1GoalSubject("Agentic30") == "Agentic30이")
        #expect(openDesignDay1GoalSubject("이 프로젝트") == "이 프로젝트가")
    }

    @Test func developmentVisibilityKeepsReferencePagesSearchableWhileRailStaysFocused() {
        let railIDs = OpenDesignDayContent.makeRailItems(
            todayTitle: "오늘 · Day 1",
            showsDevelopmentOnlyReferencePages: true
        ).map(\.id)
        let pageIDs = OpenDesignDayContent.makeSearchItems(
            showsDevelopmentOnlyReferencePages: true
        )
        .filter { $0.kind == .page }
        .map(\.id)

        #expect(railIDs == [
            "today",
            "briefing",
            "settings",
        ])
        #expect(pageIDs == [
            "page-today",
            "page-search",
            "page-projects",
            "page-settings",
            "page-interviews",
            "page-bip",
            "page-news",
            "page-history",
        ])
    }

    @Test func productionVisibilityFiltersUnfinishedReferencePages() {
        let allRailIDs = Set(OpenDesignDayContent.makeRailItems(
            todayTitle: "오늘 · Day 1",
            showsDevelopmentOnlyReferencePages: true
        ).map(\.id))
        let productionRailIDs = OpenDesignDayContent.makeRailItems(
            todayTitle: "오늘 · Day 1",
            showsDevelopmentOnlyReferencePages: false
        ).map(\.id)
        let allPageIDs = Set(OpenDesignDayContent.makeSearchItems(
            showsDevelopmentOnlyReferencePages: true
        )
        .filter { $0.kind == .page }
        .map(\.id))
        let productionPageIDs = OpenDesignDayContent.makeSearchItems(
            showsDevelopmentOnlyReferencePages: false
        )
        .filter { $0.kind == .page }
        .map(\.id)

        #expect(productionRailIDs == [
            "today",
            "briefing",
            "settings",
        ])
        #expect(allRailIDs == Set(productionRailIDs))

        #expect(productionPageIDs == [
            "page-today",
            "page-search",
            "page-settings",
        ])
        #expect(allPageIDs.subtracting(Set(productionPageIDs)) == OpenDesignDayContent.developmentOnlyReferenceSearchItemIDs)
    }

    @Test func day2MarketFixtureMatchesOpenDesignDashboard() {
        let content = OpenDesignDayContent.day2
        let market = content.market
        let week1Tasks = content.taskGroups.first?.tasks ?? []

        let day1IsDone: Bool
        if case .done? = week1Tasks.first(where: { $0.id == "day1" })?.state {
            day1IsDone = true
        } else {
            day1IsDone = false
        }

        let day2IsActive: Bool
        if case .active? = week1Tasks.first(where: { $0.id == "day2" })?.state {
            day2IsActive = true
        } else {
            day2IsActive = false
        }

        #expect(day1IsDone)
        #expect(day2IsActive)
        #expect(market?.dayNumber == 2)
        #expect(market?.title == "시장 신호 읽기")
        #expect(market?.sourceTabs.map(\.title) == ["Threads", "Indie Hackers", "X / Twitter", "Reddit", "블로그·RSS"])
        #expect(market?.keywords.first?.title == "팔릴까")
        #expect(market?.signalCards.count == 3)
        #expect(market?.alternatives.count == 7)
        #expect(market?.posts.count == 5)
        #expect(content.rankedSearchItems(query: "시장 빈 자리").first?.targetSectionID == "market-gap")
    }

    @Test func dayInteractionStartsWithContextOnlyBeforeProgressiveReveal() {
        let state = OpenDesignDayInteractionState()

        #expect(state.introStage == .context)
        #expect(!state.introStage.revealsSignals)
        #expect(!state.introStage.revealsMission)
        #expect(state.currentProgressScrollTarget == .top)
        #expect(state.stepperScrollTarget(for: 1) == .mission)
    }

    @Test func dayInteractionProgressTargetFollowsIntroRevealStage() {
        var state = OpenDesignDayInteractionState()

        state.introStage = .signals
        #expect(state.currentProgressScrollTarget == .mission)

        state.introStage = .mission
        #expect(state.currentProgressScrollTarget == .mission)

        state.acceptMissionForStepFlow()
        #expect(state.currentProgressScrollTarget == .interview1)
    }

    @Test func dayInteractionStartsUnfilledForAlignmentQuestions() throws {
        let content = OpenDesignDayContent.personalized(
            from: makeAlignmentPlan(),
            fallback: nil
        )

        var state = OpenDesignDayInteractionState(
            totalInterviewSteps: content.interviewSteps.count
        )

        #expect(state.selectedChoices.isEmpty)
        #expect(state.submittedChoices.isEmpty)
        #expect(state.submittedSteps.isEmpty)
        #expect(state.lockedPrefillStepIDs.isEmpty)
        #expect(state.trimmedFreeformAnswer(stepID: 2).isEmpty)

        state.selectChoice(stepID: 1, choiceID: 2)
        state.setFreeformAnswer(stepID: 2, value: "덮어쓰기")

        #expect(state.selectedChoices[1] == 2)
        #expect(state.trimmedFreeformAnswer(stepID: 2) == "덮어쓰기")
    }

    @Test func dayInteractionStartsUnfilledForStaticFallback() {
        let content = OpenDesignDayContent.day1

        let state = OpenDesignDayInteractionState(
            totalInterviewSteps: content.interviewSteps.count
        )

        #expect(state.selectedChoices[1] == nil)
        #expect(state.selectedChoices[2] == nil)
        #expect(state.selectedChoices[4] == nil)
        #expect(state.submittedSteps.isEmpty)
        #expect(state.lockedPrefillStepIDs.isEmpty)
        #expect(!state.allInterviewsSubmitted)
    }

    @Test func personalizedDay1RendersAdaptiveQuestionCounts() {
        for count in [3, 4, 5] {
            let content = OpenDesignDayContent.personalized(from: makePlan(questionCount: count))

            #expect(content.interviewSteps.count == count)
            #expect(content.interviewSteps.first?.title.contains("필수 조건") == true)
            #expect(content.taskGroups.first?.tasks.first?.meta == "고객 후보 · 맞춤 \(count)Q")
            #expect(content.plan?.signals.productName == "SupportLens")
            #expect(!content.searchItems.contains { $0.title.contains("거리") || $0.subtitle.contains("1/3") })
        }
    }

    @Test func personalizedDay1HidesDirectInputFallbackOptionWhenFreeformExists() throws {
        let directFallbackOptions = [
            Day1IcpQuestionOption(id: "o1", label: "이번 주 연락 가능한 support lead", description: "현재 행동이 있음", preview: "Have", antiSignal: false),
            Day1IcpQuestionOption(id: "o2", label: "직접 입력: scan보다 더 정확한 고객 후보", description: "고객 후보 근거가 부족하면 한 줄로 보정합니다.", preview: "직접 입력", antiSignal: false, evidenceLabel: "근거 부족", evidenceLimited: true),
        ]
        let content = OpenDesignDayContent.personalized(from: makePlan(
            questionCount: 3,
            firstQuestionOptions: directFallbackOptions,
            firstQuestionAllowFreeText: true
        ))
        let noFreeformContent = OpenDesignDayContent.personalized(from: makePlan(
            questionCount: 3,
            firstQuestionOptions: directFallbackOptions,
            firstQuestionAllowFreeText: false
        ))

        let firstStep = try #require(content.interviewSteps.first)
        let noFreeformFirstStep = try #require(noFreeformContent.interviewSteps.first)

        #expect(firstStep.allowsFreeform)
        #expect(firstStep.freeformLabel == "직접 입력")
        #expect(firstStep.options.map(\.id) == [1])
        #expect(firstStep.options.map(\.title) == ["이번 주 연락 가능한 support lead"])
        #expect(!noFreeformFirstStep.allowsFreeform)
        #expect(noFreeformFirstStep.options.map(\.id) == [1, 2])
        #expect(noFreeformFirstStep.options[1].title.hasPrefix("직접 입력:"))
    }

    @Test func personalizedDay1PrefersAlignmentPlanAndBuildsGoalComponents() {
        let content = OpenDesignDayContent.personalized(
            from: makeAlignmentPlan(),
            fallback: makePlan(questionCount: 4)
        )

        #expect(content.alignmentPlan?.projectGoal.contains("SupportLens") == true)
        #expect(content.interviewSteps.map(\.dimension) == ["icp", "pain_point", "outcome"])
        #expect(content.interviewSteps.map(\.title) == ["질문 1 — 고객", "질문 2 — 문제", "질문 3 — 확인할 행동"])
        #expect(content.interviewSteps.allSatisfy { $0.criteria.isEmpty })
        #expect(content.interviewSteps[0].markedStatement == "이번 주 실제로 연락해 확인할 첫 고객 후보는 누구인가요?")
        #expect(content.interviewSteps[1].markedStatement == "선택한 고객이 지금 가장 비용을 치르는 문제는 무엇인가요?")
        #expect(content.interviewSteps[2].markedStatement == "선택한 문제가 진짜인지 이번 주 대화에서 어떤 행동 신호로 확인할까요?")
        #expect(content.interviewSteps.map(\.hintText) == [nil, nil, nil])
        #expect(content.interviewSteps.allSatisfy { openDesignQuestionHintText(for: $0) == nil })
        #expect(content.taskGroups.first?.tasks.first?.title == "30일 목표와 방향을 정해요")
        #expect(content.taskGroups.first?.tasks.first?.meta == "가설 · 목표+3요소")
        #expect(content.contextTitle.contains("핵심 가설"))
    }

    @Test func personalizedAlignmentUsesPayloadQuestionAndOptionHighlightPhrases() throws {
        let content = OpenDesignDayContent.personalized(
            from: makeAlignmentPlan(),
            fallback: makePlan(questionCount: 4)
        )

        #expect(content.interviewSteps[0].highlightPhrases == ["첫 고객 후보", "고객 후보"])
        #expect(content.interviewSteps[1].highlightPhrases == ["비용을 치르는 문제", "문제"])
        #expect(Set(content.interviewSteps[2].highlightPhrases) == Set(["행동 신호", "확인할 행동", "검증 행동"]))

        let customerOption = try #require(content.interviewSteps[0].options.first)
        let painOption = try #require(content.interviewSteps[1].options.first)
        let outcomeOption = try #require(content.interviewSteps[2].options.first)

        #expect(customerOption.highlightPhrases == ["support lead"])
        #expect(painOption.highlightPhrases == ["Slack 누락"])
        #expect(outcomeOption.highlightPhrases == ["빠른 판단"])
    }

    @Test func highlightPhrasesDeduplicateAndIgnoreEmptyCopy() {
        let phrases = OpenDesignDayContent.InterviewStep.normalizedHighlightPhrases([
            "문제",
            " ",
            "비용을 치르는 문제",
            "문제",
            "  비용을 치르는 문제  ",
        ])
        let rendered = openDesignHighlightedAttributedText(
            "강조할 문구가 없는 질문입니다.",
            phrases: ["첫 고객 후보"],
            bodySize: 13
        )

        #expect(phrases == ["비용을 치르는 문제", "문제"])
        #expect(String(rendered.characters) == "강조할 문구가 없는 질문입니다.")
    }

    @Test func optionTitleHighlightPhrasesDropFullLongLabels() {
        let longCustomer = "전업 1인 개발자 (수익 0원, macOS)"
        let longToolUser = "AI 코딩 도구를 쓰는 개발자"

        #expect(openDesignOptionTitleHighlightPhrases([longCustomer], for: longCustomer).isEmpty)
        #expect(openDesignOptionTitleHighlightPhrases([longToolUser], for: longToolUser).isEmpty)
    }

    @Test func optionTitleHighlightPhrasesKeepShortDecisionPhrases() {
        #expect(openDesignOptionTitleHighlightPhrases(["Slack 누락"], for: "Slack 누락") == ["Slack 누락"])
        #expect(openDesignOptionTitleHighlightPhrases(["support lead"], for: "support lead") == ["support lead"])
        #expect(openDesignOptionTitleHighlightPhrases(["AI 코딩 도구"], for: "AI 코딩 도구를 쓰는 개발자") == ["AI 코딩 도구를"])
    }

    @Test func optionTitleHighlightPhrasesExpandReadableRanges() {
        #expect(openDesignOptionTitleHighlightPhrases(
            ["수익 0원, macOS"],
            for: "전업 1인 개발자 (수익 0원, macOS)"
        ) == ["(수익 0원, macOS)"])
        #expect(openDesignOptionTitleHighlightPhrases(
            ["AI 코딩 도구를 쓰"],
            for: "AI 코딩 도구를 쓰는 개발자"
        ) == ["AI 코딩 도구를 쓰는"])
    }

    @Test func personalizedDay1KeepsFiveFrontierOptionsAndSelectionFlow() {
        let content = OpenDesignDayContent.personalized(
            from: makeFiveOptionAlignmentPlan(),
            fallback: makePlan(questionCount: 4)
        )
        var state = OpenDesignDayInteractionState(totalInterviewSteps: content.interviewSteps.count)

        #expect(content.interviewSteps.map(\.options.count) == [5, 5, 5])
        #expect(content.interviewSteps[0].options[4].title == "구매권한 없는 조언자")
        #expect(state.selectedChoices[1] == nil)

        state.acceptMissionForStepFlow()
        state.selectChoice(stepID: 1, choiceID: 5)
        #expect(state.selectedChoices[1] == 5)
        state.recordSubmittedChoice(stepID: 1, choiceID: 5)
        state.selectChoice(stepID: 2, choiceID: 4)
        state.recordSubmittedChoice(stepID: 2, choiceID: 4)
        state.selectChoice(stepID: 3, choiceID: 3)
        state.recordSubmittedChoice(stepID: 3, choiceID: 3)

        #expect(state.allInterviewsSubmitted)
    }

    @Test func personalizedAlignmentOptionLabelsKeepFullKoreanCopy() throws {
        let longPainLabel = "만들 줄은 알지만 무엇을 팔아야 하는지, 어떻게 사람을 데려와야 하는지, 오늘 무엇을 검증해야 하는지 모른다"
        let base = makeAlignmentPlan()
        let pain = Day1AlignmentComponent(
            id: base.components.painPoint.id,
            title: base.components.painPoint.title,
            prompt: base.components.painPoint.prompt,
            helperText: base.components.painPoint.helperText,
            statement: base.components.painPoint.statement,
            evidence: base.components.painPoint.evidence,
            missingAssumptions: base.components.painPoint.missingAssumptions,
            options: [
                Day1IcpQuestionOption(id: "pain-long", label: longPainLabel, description: "반복 비용이 큽니다. · 근거: docs/SPEC.md", preview: "Pain", antiSignal: false, evidenceLabel: "근거: docs/SPEC.md", evidenceLimited: false),
                Day1IcpQuestionOption(id: "pain-weak", label: "불편만 있음", description: "행동 없음", preview: "Weak", antiSignal: true),
            ]
        )
        let plan = Day1AlignmentPlan(
            schemaVersion: base.schemaVersion,
            source: base.source,
            generatedAt: base.generatedAt,
            confidence: base.confidence,
            fellBackToDeterministic: base.fellBackToDeterministic,
            projectGoal: base.projectGoal,
            mission: base.mission,
            signals: base.signals,
            components: Day1AlignmentComponents(icp: base.components.icp, painPoint: pain, outcome: base.components.outcome),
            alignmentStatement: base.alignmentStatement,
            qualityGate: base.qualityGate,
            firstInterviewMessage: base.firstInterviewMessage,
            day2Handoff: base.day2Handoff,
            signalDigest: base.signalDigest
        )

        let content = OpenDesignDayContent.personalized(
            from: plan,
            fallback: makePlan(questionCount: 4)
        )
        let firstPainOption = try #require(content.interviewSteps.first(where: { $0.dimension == "pain_point" })?.options.first)

        #expect(firstPainOption.title == longPainLabel)
        #expect(!firstPainOption.title.contains("…"))
    }

    @Test func alignmentQuestionContextRowsShowRealPriorAnswersDuringQuestionFlow() throws {
        let content = OpenDesignDayContent.personalized(
            from: makeAlignmentPlan(),
            fallback: makePlan(questionCount: 4)
        )
        var state = OpenDesignDayInteractionState(totalInterviewSteps: content.interviewSteps.count)
        let step1 = try #require(content.interviewSteps.first(where: { $0.id == 1 }))
        let step2 = try #require(content.interviewSteps.first(where: { $0.id == 2 }))
        let step3 = try #require(content.interviewSteps.first(where: { $0.id == 3 }))

        let step1Rows = openDesignAlignmentQuestionContextRows(for: step1, content: content, interaction: state)
        #expect(step1Rows.isEmpty)
        #expect(openDesignAlignmentQuestionContextRows(for: step2, content: content, interaction: state).isEmpty)

        state.selectChoice(stepID: 1, choiceID: 1)
        let step2Rows = openDesignAlignmentQuestionContextRows(for: step2, content: content, interaction: state)
        #expect(step2Rows.map(\.id) == ["icp"])
        #expect(step2Rows.map(\.label) == ["고객"])
        #expect(step2Rows.map(\.value) == ["support lead"])
        #expect(step2Rows.map(\.accessibilityLabel) == ["선택한 고객 support lead"])

        state.selectChoice(stepID: 2, choiceID: 1)
        let step3Rows = openDesignAlignmentQuestionContextRows(for: step3, content: content, interaction: state)
        #expect(step3Rows.map(\.id) == ["icp", "pain_point"])
        #expect(step3Rows.map(\.label) == ["고객", "문제"])
        #expect(step3Rows.map(\.value) == ["support lead", "Slack 누락"])
        #expect(step3Rows.map(\.accessibilityLabel) == ["선택한 고객 support lead", "선택한 문제 Slack 누락"])
    }

    @Test func alignmentQuestionContextRowsUseFreeformPriorAnswers() throws {
        let content = OpenDesignDayContent.personalized(
            from: makeAlignmentPlan(),
            fallback: makePlan(questionCount: 4)
        )
        var state = OpenDesignDayInteractionState(totalInterviewSteps: content.interviewSteps.count)
        let step2 = try #require(content.interviewSteps.first(where: { $0.id == 2 }))
        let step3 = try #require(content.interviewSteps.first(where: { $0.id == 3 }))

        state.setFreeformAnswer(stepID: 1, value: "  이번 주 연락할 macOS 개발자  ")
        let step2Rows = openDesignAlignmentQuestionContextRows(for: step2, content: content, interaction: state)
        #expect(step2Rows.map(\.value) == ["이번 주 연락할 macOS 개발자"])

        state.setFreeformAnswer(stepID: 2, value: "  유료 전환 전 Slack escalation 확인  ")
        let step3Rows = openDesignAlignmentQuestionContextRows(for: step3, content: content, interaction: state)
        #expect(step3Rows.map(\.label) == ["고객", "문제"])
        #expect(step3Rows.map(\.value) == ["이번 주 연락할 macOS 개발자", "유료 전환 전 Slack escalation 확인"])
    }

    @Test func questionContextRowsStayEmptyWithoutPriorSelection() throws {
        let content = OpenDesignDayContent.personalized(
            from: nil,
            fallback: makePlan(questionCount: 4)
        )
        let state = OpenDesignDayInteractionState(totalInterviewSteps: content.interviewSteps.count)
        let step1 = try #require(content.interviewSteps.first)

        #expect(openDesignAlignmentQuestionContextRows(for: step1, content: content, interaction: state).isEmpty)
    }

    @Test func alignmentDraftCarriesQualityGateAndDay2Handoff() {
        let content = OpenDesignDayContent.personalized(from: makeAlignmentPlan(), fallback: nil)
        var state = OpenDesignDayInteractionState(totalInterviewSteps: content.interviewSteps.count)
        state.selectedChoices = [1: 1, 2: 1, 3: 1]
        for step in content.interviewSteps {
            state.recordSubmittedChoice(stepID: step.id, choiceID: 1)
        }

        let draft = content.draft(for: state)

        #expect(draft.markdown.contains("Day 1 핵심 가설"))
        #expect(draft.markdown.contains("기준: 워크스페이스 확인 + 사용자 선택"))
        #expect(draft.markdown.contains("## 확정"))
        #expect(draft.markdown.contains("## 선택 기록"))
        #expect(draft.markdown.contains("품질 점수"))
        #expect(draft.markdown.contains("목표:"))
        #expect(draft.markdown.contains("고객:"))
        #expect(draft.markdown.contains("문제:"))
        #expect(draft.markdown.contains("확인할 행동:"))
        #expect(draft.finalIcpStatement.contains("문제"))
        #expect(draft.finalIcpStatement.contains("확인할 행동"))
        #expect(draft.antiIcpBody.contains("8.4/10"))
        #expect(draft.recommendation.contains("유료 대체재"))
    }

    @Test func alignmentDraftUsesSelectedValuesAsCanonicalMarkdown() {
        let content = OpenDesignDayContent.personalized(from: makeFiveOptionAlignmentPlan(), fallback: nil)
        var state = OpenDesignDayInteractionState(totalInterviewSteps: content.interviewSteps.count)
        state.selectedChoices = [1: 2, 2: 2, 3: 3]
        state.recordSubmittedChoice(stepID: 1, choiceID: 2)
        state.recordSubmittedChoice(stepID: 2, choiceID: 2)
        state.recordSubmittedChoice(stepID: 3, choiceID: 3)

        let draft = content.draft(for: state)
        let expectedStatement = "목표: SupportLens가 유료 support lead 후보 1명을 검증한다 / 고객: customer success lead / 문제: SLA 리스크 발견 지연 / 확인할 행동: 현재 대안 확인"

        #expect(draft.finalIcpStatement == expectedStatement)
        #expect(draft.markdown.contains("## 확정"))
        #expect(draft.markdown.contains("- 고객: customer success lead"))
        #expect(draft.markdown.contains("- 문제: SLA 리스크 발견 지연"))
        #expect(draft.markdown.contains("- 확인할 행동: 현재 대안 확인"))
        #expect(draft.markdown.contains(expectedStatement))
        #expect(draft.markdown.contains("근거: docs/ICP.md"))
        #expect(draft.markdown.contains("근거: docs/SPEC.md"))
        #expect(draft.markdown.contains("근거: docs/GOAL.md"))
        #expect(draft.markdown.contains("scan 후보: B2B SaaS support lead"))
        #expect(!draft.markdown.contains("## Day 1 selections"))
    }

    @Test func alignmentDraftUsesFreeformAsCanonicalSelection() {
        let content = OpenDesignDayContent.personalized(from: makeAlignmentPlan(), fallback: nil)
        var state = OpenDesignDayInteractionState(totalInterviewSteps: content.interviewSteps.count)
        state.setFreeformAnswer(stepID: 1, value: "  자체 입력 고객  ")
        state.recordSubmittedChoice(stepID: 1, choiceID: OpenDesignDayInteractionState.freeformChoiceID)
        state.recordSubmittedChoice(stepID: 2, choiceID: 1)
        state.recordSubmittedChoice(stepID: 3, choiceID: 1)

        let draft = content.draft(for: state)

        #expect(draft.finalIcpStatement.contains("고객: 자체 입력 고객"))
        #expect(draft.markdown.contains("- 고객: 자체 입력 고객"))
        #expect(draft.markdown.contains("직접 입력"))
        #expect(draft.markdown.contains("scan 후보: B2B SaaS support lead"))
    }

    @Test func alignmentQuestionCopyKeepsIcpTitleAndSanitizesOutcomeCopy() {
        let content = OpenDesignDayContent.personalized(
            from: makeAlignmentPlan(
                icpPrompt: "이 목표를 위해 Day 2에서 먼저 검증할 고객은 누구인가요?",
                outcomePrompt: "Day 2 시장 신호가 확인해야 할 고객 결과는 무엇인가요?",
                outcomeOptionDescription: "Day 2에서 바로 검증할 수 있습니다. · 근거: docs/GOAL.md"
            ),
            fallback: nil
        )
        var state = OpenDesignDayInteractionState(totalInterviewSteps: content.interviewSteps.count)
        state.selectedChoices = [1: 1, 2: 1, 3: 1]
        for step in content.interviewSteps {
            state.recordSubmittedChoice(stepID: step.id, choiceID: 1)
        }

        #expect(content.interviewSteps[0].markedStatement == "이번 주 실제로 연락해 확인할 첫 고객 후보는 누구인가요?")
        #expect(content.interviewSteps[2].markedStatement == "선택한 문제가 진짜인지 이번 주 대화에서 어떤 행동 신호로 확인할까요?")
        #expect(!content.interviewSteps[2].markedStatement.contains("Day 2"))
        #expect(content.interviewSteps[2].options[0].detail == "")
        #expect(!content.interviewSteps[2].options[0].detail.contains("Day 2"))
        #expect(!content.interviewSteps[2].options[0].detail.contains("다음 시장 신호"))
        #expect(content.alignmentPlan?.day2Handoff.title.contains("Day 2") == true)
        #expect(content.draft(for: state).recommendation.contains("유료 대체재"))
    }

    @Test func alignmentOptionDescriptionsKeepMeaningfulCopyWithoutGenericOverwrites() throws {
        let content = OpenDesignDayContent.personalized(
            from: makeAlignmentPlan(),
            fallback: nil
        )

        #expect(content.interviewSteps[0].options[0].detail == "현재 고객")
        #expect(content.interviewSteps[1].options[0].detail == "반복됨")
        #expect(content.interviewSteps[2].options[0].detail == "결과")

        let details = content.interviewSteps.flatMap { step in step.options.map(\.detail) }
        #expect(!details.contains("이번 주 대화 가능."))
        #expect(!details.contains("시간·돈·리스크 비용."))
        #expect(!details.contains("사건·대안·지불 의향 확인."))
    }

    @Test func questionHintHidesEmptyOrDuplicateDimensionCopy() throws {
        let noHelperContent = OpenDesignDayContent.personalized(
            from: makeAlignmentPlan(icpHelperText: nil),
            fallback: nil
        )
        let duplicateHelperContent = OpenDesignDayContent.personalized(
            from: makeAlignmentPlan(icpHelperText: "ICP"),
            fallback: nil
        )
        let noHelperStep = try #require(noHelperContent.interviewSteps.first)
        let duplicateHelperStep = try #require(duplicateHelperContent.interviewSteps.first)

        #expect(noHelperStep.hintText == nil)
        #expect(openDesignQuestionHintText(for: noHelperStep) == nil)
        #expect(duplicateHelperStep.hintText == nil)
        #expect(openDesignQuestionHintText(for: duplicateHelperStep) == nil)
    }

    @Test func personalizedDay1FallsBackToLegacyIcpPlanWhenAlignmentPlanIsMissing() {
        let content = OpenDesignDayContent.personalized(
            from: nil,
            fallback: makePlan(questionCount: 4)
        )

        #expect(content.alignmentPlan == nil)
        #expect(content.plan?.signals.productName == "SupportLens")
        #expect(content.interviewSteps.count == 4)
        #expect(content.interviewSteps.allSatisfy { $0.criteria.isEmpty })
        #expect(content.taskGroups.first?.tasks.first?.title == "고객 후보 질문을 정해요")
    }

    @Test func personalizedIfAvailableReturnsNilWithoutRuntimePlan() {
        let content = OpenDesignDayContent.personalizedIfAvailable(
            from: nil,
            fallback: nil
        )

        #expect(content?.contextTitle == nil)
    }

    @Test func personalizedIfAvailableRejectsInvalidQuestionCountsWithoutFixtureFallback() {
        let tooShort = OpenDesignDayContent.personalizedIfAvailable(from: makePlan(questionCount: 2))
        let tooLong = OpenDesignDayContent.personalizedIfAvailable(from: makePlan(questionCount: 6))

        #expect(tooShort?.contextTitle == nil)
        #expect(tooLong?.contextTitle == nil)
    }

    @Test func personalizedIfAvailableReturnsPersonalizedContentForValidAlignmentPlan() {
        let content = OpenDesignDayContent.personalizedIfAvailable(
            from: makeAlignmentPlan(),
            fallback: makePlan(questionCount: 4)
        )

        #expect(content?.alignmentPlan?.projectGoal.contains("SupportLens") == true)
        #expect(content?.interviewSteps.map(\.dimension) == ["icp", "pain_point", "outcome"])
        #expect(content?.contextTitle.contains("핵심 가설") == true)
    }

    @Test func personalizedAlignmentOptionsExposeEvidenceMetadata() throws {
        let content = try #require(OpenDesignDayContent.personalizedIfAvailable(
            from: makeAlignmentPlan(),
            fallback: makePlan(questionCount: 4)
        ))

        let firstOption = try #require(content.interviewSteps.first?.options.first)
        let weakOption = try #require(content.interviewSteps.first?.options.last)

        #expect(firstOption.evidenceLabel == "근거: README.md")
        #expect(firstOption.tail == "README.md")
        #expect(weakOption.evidenceLimited == true)
        #expect(weakOption.tail == "근거 부족")
    }

    @Test func signalDigestDisplayFallsBackFromMarkdownDocumentLinkForIcp() throws {
        let digest = Day1SignalDigest(
            schemaVersion: 1,
            rows: [
                Day1SignalDigestRow(key: "project", label: "프로젝트", value: "SupportLens", tone: "strong"),
                Day1SignalDigestRow(key: "goal", label: "목표", value: "유료 후보 1명 검증", tone: "body"),
                Day1SignalDigestRow(key: "icp", label: "ICP", value: "[VALUES.md](./VALUES.md) — 제품 가치", tone: "body"),
                Day1SignalDigestRow(key: "pain", label: "Pain", value: "Slack escalation 누락", tone: "mark"),
                Day1SignalDigestRow(key: "outcome", label: "Outcome", value: "계정 리스크를 더 빨리 판단", tone: "strong"),
                Day1SignalDigestRow(key: "evidence", label: "근거", value: "docs/GOAL.md, docs/ICP.md", tone: "code"),
            ],
            summary: "SupportLens는 Slack escalation 누락을 검증한다."
        )
        let plan = makeAlignmentPlan(signalDigest: digest)
        let icpRow = try #require(plan.signalDigest?.rows.first { $0.key == "icp" })
        let evidenceRow = try #require(plan.signalDigest?.rows.first { $0.key == "evidence" })

        #expect(openDesignDisplaySignalDigestValue(for: icpRow, alignmentPlan: plan) == "support lead")
        #expect(openDesignDisplaySignalDigestValue(for: evidenceRow, alignmentPlan: plan) == "docs/GOAL.md, docs/ICP.md")
        #expect(openDesignAlignmentDisplayLabel(for: "icp", fallback: icpRow.label) == "고객")
        #expect(openDesignAlignmentDisplayLabel(for: "pain", fallback: "Pain") == "문제")
        #expect(openDesignAlignmentDisplayLabel(for: "outcome", fallback: "Outcome") == "확인할 행동")
    }

    @Test func signalDigestDisplayKeepsLongPainValueUntruncated() throws {
        let longPain = "Google Photos와 iCloud 같은 클라우드 서비스에 개인 사진과 동영상을 맡기고 싶지 않은 사용자가 자체 호스팅 대안 없이 데이터 주권을 잃는 문제"
        let digest = Day1SignalDigest(
            schemaVersion: 1,
            rows: [
                Day1SignalDigestRow(key: "project", label: "프로젝트", value: "PhotoVault", tone: "strong"),
                Day1SignalDigestRow(key: "goal", label: "목표", value: "개인 사진 보관 대안을 검증한다", tone: "body"),
                Day1SignalDigestRow(key: "icp", label: "고객", value: "개인 사용자 및 소규모 팀", tone: "body"),
                Day1SignalDigestRow(key: "pain", label: "문제", value: longPain, tone: "mark"),
                Day1SignalDigestRow(key: "outcome", label: "확인할 행동", value: "첫 고객 대화에서 지불 의향과 현재 대안을 묻는다", tone: "strong"),
                Day1SignalDigestRow(key: "evidence", label: "근거", value: "docs/GOAL.md, docs/ICP.md", tone: "code"),
            ],
            summary: "PhotoVault는 개인 사진 보관 대안을 검증한다."
        )
        let plan = makeAlignmentPlan(signalDigest: digest)
        let painRow = try #require(plan.signalDigest?.rows.first { $0.key == "pain" })

        #expect(openDesignDisplaySignalDigestValue(for: painRow, alignmentPlan: plan) == longPain)
        #expect(!openDesignDisplaySignalDigestValue(for: painRow, alignmentPlan: plan).contains("…"))
    }

    @Test func alignmentDisplayRowsUseStructuredSanitizedValues() throws {
        let documentPointer = "[VALUES.md](./VALUES.md) — 제품 가치"
        let plan = makeAlignmentPlan(
            alignmentIcp: documentPointer,
            alignmentStatementText: "목표: SupportLens가 유료 support lead 후보 1명을 검증한다 / ICP: \(documentPointer) / Pain Point: urgent Slack escalation을 놓침 / Outcome: 계정 리스크 escalation을 더 빨리 판단한다"
        )

        let rows = openDesignAlignmentDisplayRows(for: plan)
        let joinedValues = rows.map(\.value).joined(separator: " ")

        #expect(rows.map(\.id) == ["goal", "icp", "pain", "outcome"])
        #expect(rows.map(\.label) == ["목표", "고객", "문제", "확인할 행동"])
        #expect(rows.first { $0.id == "icp" }?.value == "support lead")
        #expect(rows.first { $0.id == "outcome" }?.isAccent == true)
        #expect(!joinedValues.contains("VALUES.md"))
        #expect(!joinedValues.contains("[VALUES.md]"))
        #expect(!joinedValues.contains(" / ICP:"))
    }

    @Test func personalizedKeepsFixtureFallbackForPreviewsAndReferenceTests() {
        let content = OpenDesignDayContent.personalized(
            from: nil,
            fallback: nil
        )

        #expect(content.contextTitle == "오늘은 첫 고객 1명을 정하는 게 목표예요.")
    }

    @Test func personalizedDraftReflectsSelectionsInIcpAndAntiIcp() throws {
        let content = OpenDesignDayContent.personalized(from: makePlan(questionCount: 4))
        var state = OpenDesignDayInteractionState(totalInterviewSteps: content.interviewSteps.count)
        state.selectedChoices = [1: 1, 2: 1, 3: 1, 4: 2]
        for step in content.interviewSteps {
            state.recordSubmittedChoice(stepID: step.id, choiceID: state.selectedChoices[step.id] ?? 1)
        }

        let draft = content.draft(for: state)

        #expect(draft.markdown.contains("Day 1 selections"))
        #expect(draft.markdown.contains("Slack 수동 확인"))
        #expect(draft.antiIcpBody.contains("최근 사건이 없으면 제외"))
        #expect(!draft.finalIcpStatement.contains("macOS 1인 개발자"))
    }

    @Test func searchTargetsUseDeclaredSectionAnchors() {
        let content = OpenDesignDayContent.day1
        let knownAnchors = Set(OpenDesignSectionAnchor.allCases.map(\.rawValue))
        let searchItems: [OpenDesignSearchItem] = content.searchItems

        #expect(searchItems.compactMap(\.targetSectionID).allSatisfy { knownAnchors.contains($0) })
        #expect(knownAnchors.contains(OpenDesignSectionAnchor.finalIcp.rawValue))
        #expect(!searchItems.contains { $0.id == "section-preview" })
        #expect(!searchItems.contains { $0.id == "section-gate" })
    }

    @Test func searchRankingMatchesDayAliasesAndSections() {
        let content = OpenDesignDayContent.day1

        #expect(content.rankedSearchItems(query: "day3").first?.title == "실제 행동 인터뷰 ×3")
        #expect(content.rankedSearchItems(query: "3").first?.title == "실제 행동 인터뷰 ×3")
        #expect(content.rankedSearchItems(query: "핵심 가설").first?.id == "section-final")
        #expect(content.rankedSearchItems(query: "settings").first?.id == "page-settings")
        #expect(content.rankedSearchItems(query: "설정").first?.title == "설정")
        #expect(content.rankedSearchItems(query: "day8").first?.id == "task-day8")
        #expect(content.rankedSearchItems(query: "day8").first?.isLocked == true)
    }

    @Test func searchKeyboardSelectionDoesNotSkipLockedRowsLikeDayHtml() throws {
        let results = OpenDesignSearchPresentation.displayOrdered(
            OpenDesignDayContent.day1.rankedSearchItems(query: "day")
        )
        let day7Index = try #require(results.firstIndex { $0.id == "task-day7" })
        let day8Index = try #require(results.firstIndex { $0.id == "task-day8" })

        #expect(results[day8Index].isLocked)
        #expect(OpenDesignSearchSelection.movedIndex(from: day7Index, delta: 1, resultCount: results.count) == day8Index)
        #expect(OpenDesignSearchSelection.movedIndex(from: 0, delta: -1, resultCount: results.count) == results.count - 1)
    }

    @Test func searchPresentationOrderMatchesGroupedPaletteRows() throws {
        let results = OpenDesignSearchPresentation.displayOrdered(
            OpenDesignDayContent.day1.rankedSearchItems(query: "")
        )
        let firstPageIndex = try #require(results.firstIndex { $0.kind == .page })
        let lastTaskIndex = try #require(results.lastIndex { $0.kind == .task })

        #expect(results.first?.id == "task-day1")
        #expect(lastTaskIndex < firstPageIndex)
        #expect(results.dropFirst(firstPageIndex).allSatisfy { $0.kind == .page })
    }

    @Test func initialSearchAvailabilityMatchesMountedDaySections() {
        let content = OpenDesignDayContent.day1
        let state = OpenDesignDayInteractionState()
        let availableIDs = Set(content.searchItems.filter(state.isSearchItemAvailable).map(\.id))

        #expect(availableIDs.contains("section-signals"))
        #expect(availableIDs.contains("section-mission"))
        #expect(availableIDs.contains("section-guide"))
        #expect(availableIDs.contains("task-day3"))
        #expect(!content.searchItems.contains { $0.id == "section-slot" })
        #expect(!content.searchItems.contains { $0.id == "section-message" })
        #expect(!content.searchItems.contains { $0.id == "section-preview" })
        #expect(!content.searchItems.contains { $0.id == "section-candidate" })
        #expect(!content.searchItems.contains { $0.id == "section-gate" })
        #expect(!availableIDs.contains("section-interview1"))
        #expect(!availableIDs.contains("section-picker"))
        #expect(!availableIDs.contains("section-final"))
    }

    @Test func searchAvailabilityAdvancesWithOpenDesignDayFlow() {
        let content = OpenDesignDayContent.day1
        var state = OpenDesignDayInteractionState()
        state.missionAccepted = true
        var availableIDs = Set(content.searchItems.filter(state.isSearchItemAvailable).map(\.id))

        #expect(availableIDs.contains("section-interview1"))
        #expect(availableIDs.contains("section-picker"))
        #expect(!availableIDs.contains("section-final"))

        state.submittedSteps.formUnion([1, 2, 3, 4])
        availableIDs = Set(content.searchItems.filter(state.isSearchItemAvailable).map(\.id))
        #expect(availableIDs.contains("section-final"))
    }

    @Test func realisticConfettiRecipeMatchesCanvasRealisticReference() {
        let recipes = RealisticConfettiRecipe.realistic

        #expect(RealisticConfettiRecipe.origin == CGPoint(x: 0.5, y: 0.70))
        #expect(RealisticConfettiRecipe.cleanupDelay == 2.20)
        #expect(recipes.count == 5)
        #expect(RealisticConfettiRecipe.totalParticleCount == 200)
        #expect(recipes.map(\.particleCount) == [50, 40, 70, 20, 20])
        #expect(recipes.map(\.spreadDegrees) == [26, 60, 100, 120, 120])
        #expect(recipes.map(\.startVelocity) == [55, 45, 45, 25, 45])
        #expect(recipes.map(\.decay) == [0.90, 0.90, 0.91, 0.92, 0.90])
        #expect(recipes.map(\.scalar).contains(0.8))
        #expect(recipes.map(\.scalar).contains(1.2))
        #expect(recipes.allSatisfy { $0.drift == 0 })
        #expect(RealisticConfettiRecipe.demoPaletteHexes == [
            "#26CCFF",
            "#A25AFD",
            "#FF5E7E",
            "#88FF5A",
            "#FCFF42",
            "#FFA62D",
            "#FF36FF",
            "#4BDE80"
        ])
    }

    @Test func lockedFutureVariantKeepsDay1OpenAndLocksLaterDays() {
        let content = OpenDesignDayContent.day1.lockingFutureDays
        let week1Tasks = content.taskGroups.first?.tasks ?? []

        let day1IsActive: Bool
        if case .active? = week1Tasks.first(where: { $0.id == "day1" })?.state {
            day1IsActive = true
        } else {
            day1IsActive = false
        }

        let day2IsLocked: Bool
        if case .locked? = week1Tasks.first(where: { $0.id == "day2" })?.state {
            day2IsLocked = true
        } else {
            day2IsLocked = false
        }

        #expect(day1IsActive)
        #expect(day2IsLocked)
        #expect(content.rankedSearchItems(query: "day2").first?.isLocked == true)
    }

    @Test func postDay2LockingKeepsDay1AndDay2OpenThenLocksLaterDays() {
        let content = OpenDesignDayContent.day1.lockingDaysAfterSecond
        let week1Tasks = content.taskGroups.first?.tasks ?? []

        let day1IsActive: Bool
        if case .active? = week1Tasks.first(where: { $0.id == "day1" })?.state {
            day1IsActive = true
        } else {
            day1IsActive = false
        }

        let day2IsPending: Bool
        if case .pending? = week1Tasks.first(where: { $0.id == "day2" })?.state {
            day2IsPending = true
        } else {
            day2IsPending = false
        }

        let lockedFutureIDs = ["day3", "day4", "day5", "day6", "day7"].filter { id in
            if case .locked? = week1Tasks.first(where: { $0.id == id })?.state {
                return true
            }
            return false
        }

        #expect(day1IsActive)
        #expect(day2IsPending)
        #expect(lockedFutureIDs == ["day3", "day4", "day5", "day6", "day7"])
        #expect(content.rankedSearchItems(query: "day2").first?.isLocked == false)
        #expect(content.rankedSearchItems(query: "day3").first?.isLocked == true)
        #expect(content.rankedSearchItems(query: "day7").first?.isLocked == true)
    }

    @Test func postDay2LockingAppliesAfterProgressProjection() {
        let snapshot = FoundationProgressSnapshot(
            workspaceRoot: "/tmp/project",
            startedAt: Date(timeIntervalSince1970: 1_777_000_000),
            selectedDay: 2,
            completedDays: [1]
        )
        let content = OpenDesignDayContent.day2
            .applyingFoundationProgress(snapshot, selectedDay: 2)
            .lockingDaysAfterSecond
        let week1Tasks = content.taskGroups.first?.tasks ?? []

        let day2IsActive: Bool
        if case .active? = week1Tasks.first(where: { $0.id == "day2" })?.state {
            day2IsActive = true
        } else {
            day2IsActive = false
        }

        let day3IsLocked: Bool
        if case .locked? = week1Tasks.first(where: { $0.id == "day3" })?.state {
            day3IsLocked = true
        } else {
            day3IsLocked = false
        }
        let day3Search = content.rankedSearchItems(query: "day3").first

        #expect(day2IsActive)
        #expect(day3IsLocked)
        #expect(day3Search?.isActive == false)
        #expect(day3Search?.isLocked == true)
        #expect(day3Search?.targetSectionID == nil)
        #expect(day3Search?.route == .inert)
    }

    @Test func openDesignRoutePolicySupportsOnlyFirstTwoDays() {
        #expect(OpenDesignReferenceRoutePolicy.supportsOpenDesignDay(dayNumber: 1))
        #expect(OpenDesignReferenceRoutePolicy.supportsOpenDesignDay(dayNumber: 2))
        #expect(!OpenDesignReferenceRoutePolicy.supportsOpenDesignDay(dayNumber: 3))
        #expect(!OpenDesignReferenceRoutePolicy.supportsOpenDesignDay(dayNumber: 8))
        #expect(!OpenDesignReferenceRoutePolicy.supportsOpenDesignDay(dayNumber: 30))
    }

    @Test func weekProgressLocksFutureWeeksCollapsedByDefault() {
        let snapshot = FoundationProgressSnapshot(
            workspaceRoot: "/tmp/project",
            startedAt: Date(timeIntervalSince1970: 1_777_000_000),
            selectedDay: 1,
            completedDays: []
        )
        let content = OpenDesignDayContent.day1.applyingFoundationProgress(snapshot, selectedDay: 1)
        let week1 = content.taskGroups.first(where: { $0.id == "week1" })
        let week2 = content.taskGroups.first(where: { $0.id == "week2" })
        let week3 = content.taskGroups.first(where: { $0.id == "week3" })
        let week4 = content.taskGroups.first(where: { $0.id == "week4" })

        #expect(week1?.isExpandedByDefault == true)
        #expect(week2?.isExpandedByDefault == false)
        #expect(week2?.isLocked == true)
        #expect(week2?.tasks.count == 7)
        #expect(week3?.isLocked == true)
        #expect(week4?.isLocked == true)
        #expect(content.rankedSearchItems(query: "day30").first?.isLocked == true)

        let day8IsLocked: Bool
        if case .locked? = week2?.tasks.first(where: { $0.id == "day8" })?.state {
            day8IsLocked = true
        } else {
            day8IsLocked = false
        }
        #expect(day8IsLocked)
    }

    @Test func weekProgressUnlocksOnlyAfterPreviousWeeksAreComplete() {
        let partialWeek1 = FoundationProgressSnapshot(
            workspaceRoot: "/tmp/project",
            startedAt: Date(timeIntervalSince1970: 1_777_000_000),
            selectedDay: 7,
            completedDays: Set(1...6)
        )
        let partialContent = OpenDesignDayContent.day1.applyingFoundationProgress(partialWeek1, selectedDay: 7)
        #expect(partialContent.taskGroups.first(where: { $0.id == "week2" })?.isLocked == true)

        let week2Snapshot = FoundationProgressSnapshot(
            workspaceRoot: "/tmp/project",
            startedAt: Date(timeIntervalSince1970: 1_777_000_000),
            selectedDay: 8,
            completedDays: Set(1...7)
        )
        let week2Content = OpenDesignDayContent.day1.applyingFoundationProgress(week2Snapshot, selectedDay: 8)
        let week2 = week2Content.taskGroups.first(where: { $0.id == "week2" })

        #expect(week2?.isLocked == false)
        #expect(week2?.isExpandedByDefault == true)
        #expect(week2?.tasks.count == 7)
        let day8IsActive: Bool
        if case .active? = week2?.tasks.first(where: { $0.id == "day8" })?.state {
            day8IsActive = true
        } else {
            day8IsActive = false
        }
        #expect(day8IsActive)
        #expect(week2Content.taskGroups.first(where: { $0.id == "week3" })?.isLocked == true)

        let week3Snapshot = FoundationProgressSnapshot(
            workspaceRoot: "/tmp/project",
            startedAt: Date(timeIntervalSince1970: 1_777_000_000),
            selectedDay: 15,
            completedDays: Set(1...14)
        )
        let week3Content = OpenDesignDayContent.day1.applyingFoundationProgress(week3Snapshot, selectedDay: 15)
        #expect(week3Content.taskGroups.first(where: { $0.id == "week3" })?.isLocked == false)
        #expect(week3Content.taskGroups.first(where: { $0.id == "week4" })?.isLocked == true)

        let week4Snapshot = FoundationProgressSnapshot(
            workspaceRoot: "/tmp/project",
            startedAt: Date(timeIntervalSince1970: 1_777_000_000),
            selectedDay: 22,
            completedDays: Set(1...21)
        )
        let week4Content = OpenDesignDayContent.day1.applyingFoundationProgress(week4Snapshot, selectedDay: 22)
        #expect(week4Content.taskGroups.first(where: { $0.id == "week4" })?.isLocked == false)
        #expect(week4Content.taskGroups.first(where: { $0.id == "week4" })?.tasks.count == 9)
    }

    @Test func interactionProgressFollowsOpenDesignDayFlow() {
        var state = OpenDesignDayInteractionState()

        #expect(!state.missionAccepted)
        #expect(state.normalizedActiveStepID == 0)
        #expect(state.maxReachableStepID == 0)
        #expect(state.highestVisibleInterviewStep == 1)
        #expect(state.progressStepCount == 1)
        #expect(state.progressPercent == 0)

        state.acceptMissionForStepFlow()
        #expect(state.normalizedActiveStepID == 1)
        #expect(state.maxReachableStepID == 1)
        state.selectChoice(stepID: 1, choiceID: 3)
        state.recordSubmittedChoice(stepID: 1, choiceID: 3)
        #expect(state.normalizedActiveStepID == 2)
        #expect(state.maxReachableStepID == 2)
        #expect(state.highestVisibleInterviewStep == 2)
        #expect(state.progressPercent == 47)
        #expect(state.submittedChoices[1] == 3)
        #expect(state.isCurrentSelectionSubmitted(stepID: 1))

        state.selectChoice(stepID: 1, choiceID: 2)
        #expect(!state.isCurrentSelectionSubmitted(stepID: 1))
        #expect(state.submittedChoices[1] == nil)
        #expect(state.revisionSteps.contains(1))
        state.recordSubmittedChoice(stepID: 1, choiceID: 2)
        #expect(state.submittedChoices[1] == 2)
        #expect(state.isCurrentSelectionSubmitted(stepID: 1))

        state.submittedSteps.formUnion([2, 3, 4])
        #expect(state.allInterviewsSubmitted)
        #expect(state.progressStepCount == state.finalStepID + 1)
        #expect(state.progressPercent == 90)

        state.dayCompleted = true
        state.activeStepID = state.finalStepID
        state.maxUnlockedStepID = state.finalStepID
        #expect(state.normalizedActiveStepID == state.finalStepID)
        #expect(state.isWorkflowStepUnlocked(state.finalStepID))
        #expect(state.progressStepCount == state.workflowStepCount)
        #expect(state.progressPercent == 100)
    }

    @Test func stepWorkflowSupportsFocusBackAdvanceAndReset() {
        var state = OpenDesignDayInteractionState(totalInterviewSteps: 3)

        #expect(state.workflowStepCount == 5)
        #expect(state.workflowNavigationDirection == .neutral)
        #expect(state.isWorkflowStepUnlocked(0))
        #expect(!state.isWorkflowStepUnlocked(1))

        state.acceptMissionForStepFlow()
        #expect(state.workflowNavigationDirection == .forward)
        #expect(state.activeInterviewStepID == 1)
        #expect(state.isWorkflowStepUnlocked(1))
        #expect(!state.isWorkflowStepUnlocked(2))

        state.selectChoice(stepID: 1, choiceID: 2)
        state.recordSubmittedChoice(stepID: 1, choiceID: 2)
        #expect(state.workflowNavigationDirection == .forward)
        #expect(state.activeInterviewStepID == 2)
        #expect(state.isWorkflowStepUnlocked(2))

        state.moveToPreviousWorkflowStep()
        #expect(state.workflowNavigationDirection == .backward)
        #expect(state.activeInterviewStepID == 1)

        state.focusWorkflowStep(2)
        #expect(state.workflowNavigationDirection == .forward)
        #expect(state.activeInterviewStepID == 2)
        state.focusWorkflowStep(3)
        #expect(state.activeInterviewStepID == 2)

        state.recordSubmittedChoice(stepID: 2, choiceID: 1)
        state.recordSubmittedChoice(stepID: 3, choiceID: 1)
        #expect(state.workflowNavigationDirection == .forward)
        #expect(state.normalizedActiveStepID == state.finalStepID)
        #expect(state.isWorkflowStepUnlocked(state.finalStepID))

        state.dayCompleted = true
        state.maxUnlockedStepID = state.finalStepID
        state.focusWorkflowStep(state.finalStepID)
        #expect(state.normalizedActiveStepID == state.finalStepID)
        #expect(state.isWorkflowStepUnlocked(state.finalStepID))

        state.moveToPreviousWorkflowStep()
        #expect(state.normalizedActiveStepID == state.finalStepID)
        #expect(state.workflowNavigationDirection == .backward)

        state.resetStepFlow()
        #expect(!state.missionAccepted)
        #expect(state.normalizedActiveStepID == 0)
        #expect(state.selectedChoices.isEmpty)
        #expect(state.submittedChoices.isEmpty)
        #expect(state.progressPercent == 0)
        #expect(state.workflowNavigationDirection == .neutral)
    }

    @Test func interactionCacheRestoresFinalConfirmationStateForSameWorkspaceDay() {
        let key = OpenDesignDayInteractionKey(workspaceRoot: "/tmp/project-a", dayNumber: 1)
        var cache = OpenDesignDayInteractionStateCache()
        var state = OpenDesignDayInteractionState(totalInterviewSteps: 4)
        state.acceptMissionForStepFlow()
        for stepID in 1...4 {
            state.selectChoice(stepID: stepID, choiceID: 1)
            state.recordSubmittedChoice(stepID: stepID, choiceID: 1)
        }

        cache.update(state, for: key, totalInterviewSteps: 4)
        let restored = cache.state(for: key, totalInterviewSteps: 4)

        #expect(restored.submittedSteps == [1, 2, 3, 4])
        #expect(restored.activeStepID == restored.finalStepID)
        #expect(restored.allInterviewsSubmitted)
        #expect(restored.normalizedActiveStepID == restored.finalStepID)
    }

    @Test func interactionCacheSeparatesWorkspaceAndDayKeys() {
        let day1Key = OpenDesignDayInteractionKey(workspaceRoot: "/tmp/project-a", dayNumber: 1)
        let day2Key = OpenDesignDayInteractionKey(workspaceRoot: "/tmp/project-a", dayNumber: 2)
        let otherWorkspaceKey = OpenDesignDayInteractionKey(workspaceRoot: "/tmp/project-b", dayNumber: 1)
        var cache = OpenDesignDayInteractionStateCache()
        var day1State = OpenDesignDayInteractionState(totalInterviewSteps: 4)
        day1State.acceptMissionForStepFlow()
        day1State.recordSubmittedChoice(stepID: 1, choiceID: 1)
        cache.update(day1State, for: day1Key, totalInterviewSteps: 4)

        #expect(cache.state(for: day1Key, totalInterviewSteps: 4).submittedSteps == [1])
        #expect(cache.state(for: day2Key, totalInterviewSteps: 4).submittedSteps.isEmpty)
        #expect(cache.state(for: otherWorkspaceKey, totalInterviewSteps: 4).submittedSteps.isEmpty)
    }

    @Test func interactionCacheRemoveAllClearsPersistedDayProgress() {
        let key = OpenDesignDayInteractionKey(workspaceRoot: "/tmp/project-a", dayNumber: 1)
        var cache = OpenDesignDayInteractionStateCache()
        var state = OpenDesignDayInteractionState(totalInterviewSteps: 4)
        state.acceptMissionForStepFlow()
        state.recordSubmittedChoice(stepID: 1, choiceID: 1)
        cache.update(state, for: key, totalInterviewSteps: 4)

        cache.removeAll()

        let restored = cache.state(for: key, totalInterviewSteps: 4)
        #expect(!restored.missionAccepted)
        #expect(restored.submittedSteps.isEmpty)
        #expect(restored.normalizedActiveStepID == 0)
    }

    @Test func interactionStateSynchronizationDropsOutOfRangeStepData() {
        var state = OpenDesignDayInteractionState(totalInterviewSteps: 4)
        state.acceptMissionForStepFlow()
        for stepID in 1...4 {
            state.selectChoice(stepID: stepID, choiceID: stepID)
            state.recordSubmittedChoice(stepID: stepID, choiceID: stepID)
        }
        state.freeformAnswers = [1: "freeform 1", 4: "freeform 4"]
        state.freeformAnswer = "freeform 1"
        state.lockedPrefillStepIDs = [2, 4]
        state.revisionSteps = [3, 4]

        let synchronized = state.synchronized(totalInterviewSteps: 3)

        #expect(synchronized.totalInterviewSteps == 3)
        #expect(synchronized.submittedSteps == [1, 2, 3])
        #expect(synchronized.selectedChoices[4] == nil)
        #expect(synchronized.submittedChoices[4] == nil)
        #expect(synchronized.freeformAnswers[4] == nil)
        #expect(synchronized.lockedPrefillStepIDs == [2])
        #expect(synchronized.revisionSteps == [3])
        #expect(synchronized.activeStepID == synchronized.finalStepID)
        #expect(synchronized.allInterviewsSubmitted)
    }

    @Test func previousFromFirstQuestionReturnsToStartPhaseWithoutResettingFlow() {
        var state = OpenDesignDayInteractionState(totalInterviewSteps: 3)

        state.acceptMissionForStepFlow()
        state.selectChoice(stepID: 1, choiceID: 2)
        state.recordSubmittedChoice(stepID: 1, choiceID: 2)
        state.focusWorkflowStep(1)

        state.moveToPreviousWorkflowStep()

        #expect(state.workflowNavigationDirection == .backward)
        #expect(state.normalizedActiveStepID == 0)
        #expect(state.activeInterviewStepID == nil)
        #expect(state.missionAccepted)
        #expect(state.selectedChoices[1] == 2)
        #expect(state.submittedChoices[1] == 2)
        #expect(state.isWorkflowStepUnlocked(1))
        #expect(state.isWorkflowStepUnlocked(2))
    }

    @Test func resumeFromStartPhaseReturnsToCurrentInterviewWithoutResettingFlow() {
        var state = OpenDesignDayInteractionState(totalInterviewSteps: 3)

        state.acceptMissionForStepFlow()
        state.selectChoice(stepID: 1, choiceID: 2)
        state.moveToPreviousWorkflowStep()

        #expect(state.normalizedActiveStepID == 0)
        #expect(state.activeInterviewStepID == nil)

        state.resumeWorkflowFromStartPhase()

        #expect(state.normalizedActiveStepID == 1)
        #expect(state.activeInterviewStepID == 1)
        #expect(state.missionAccepted)
        #expect(state.selectedChoices[1] == 2)
        #expect(state.submittedChoices.isEmpty)
        #expect(state.isWorkflowStepUnlocked(1))
    }

    @Test func workflowNavigationDirectionTracksStepperMovement() {
        var state = OpenDesignDayInteractionState(totalInterviewSteps: 3)
        state.acceptMissionForStepFlow()
        state.recordSubmittedChoice(stepID: 1, choiceID: 1)
        state.recordSubmittedChoice(stepID: 2, choiceID: 1)
        #expect(state.normalizedActiveStepID == 3)

        state.focusWorkflowStep(1)
        #expect(state.normalizedActiveStepID == 1)
        #expect(state.workflowNavigationDirection == .backward)

        state.focusWorkflowStep(3)
        #expect(state.normalizedActiveStepID == 3)
        #expect(state.workflowNavigationDirection == .forward)

        state.focusWorkflowStep(3)
        #expect(state.workflowNavigationDirection == .neutral)
    }

    @Test func changingSubmittedChoiceClearsCurrentAndDownstreamSubmissions() {
        var state = OpenDesignDayInteractionState(totalInterviewSteps: 3)
        state.acceptMissionForStepFlow()
        state.selectChoice(stepID: 1, choiceID: 1)
        state.recordSubmittedChoice(stepID: 1, choiceID: 1)
        state.selectChoice(stepID: 2, choiceID: 2)
        state.recordSubmittedChoice(stepID: 2, choiceID: 2)

        state.focusWorkflowStep(1)
        state.selectChoice(stepID: 1, choiceID: 3)

        #expect(state.selectedChoices[1] == 3)
        #expect(state.submittedChoices[1] == nil)
        #expect(state.submittedChoices[2] == nil)
        #expect(state.selectedChoices[2] == nil)
        #expect(state.submittedSteps.isEmpty)
        #expect(state.revisionSteps == [1])
        #expect(state.activeInterviewStepID == 1)
        #expect(!state.isWorkflowStepUnlocked(2))
    }

    @Test func alreadySubmittedChoiceCanAdvanceWithoutResubmitting() {
        var state = OpenDesignDayInteractionState(totalInterviewSteps: 3)
        state.acceptMissionForStepFlow()
        state.selectChoice(stepID: 1, choiceID: 2)
        state.recordSubmittedChoice(stepID: 1, choiceID: 2)
        state.focusWorkflowStep(1)

        state.advancePastSubmittedChoice(stepID: 1)

        #expect(state.activeInterviewStepID == 2)
        #expect(state.submittedChoices[1] == 2)
        #expect(state.selectedChoices[1] == 2)
    }

    @Test func freeformAnswerActsAsSingleManualChoice() {
        var state = OpenDesignDayInteractionState()

        state.setFreeformAnswer(stepID: 1, value: "former teammate shipping weekly Cursor projects")

        #expect(state.selectedChoices[1] == OpenDesignDayInteractionState.freeformChoiceID)
        #expect(state.submittedChoices[1] == nil)
        #expect(!state.freeformAnswer.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)

        state.selectChoice(stepID: 1, choiceID: 2)
        #expect(state.selectedChoices[1] == 2)
        #expect(state.freeformAnswer.isEmpty)

        state.setFreeformAnswer(stepID: 1, value: "123 macOS solo builders")

        #expect(state.selectedChoices[1] == OpenDesignDayInteractionState.freeformChoiceID)
        #expect(state.trimmedFreeformAnswer(stepID: 1) == "123 macOS solo builders")
    }

    @Test func activatingFreeformClearsSubmittedNumberChoiceUntilTextIsProvided() {
        var state = OpenDesignDayInteractionState(totalInterviewSteps: 3)
        state.acceptMissionForStepFlow()
        state.selectChoice(stepID: 1, choiceID: 2)
        state.recordSubmittedChoice(stepID: 1, choiceID: 2)
        state.focusWorkflowStep(1)

        state.activateFreeformAnswer(stepID: 1)

        #expect(state.selectedChoices[1] == nil)
        #expect(state.submittedChoices[1] == nil)
        #expect(!state.submittedSteps.contains(1))
        #expect(state.trimmedFreeformAnswer(stepID: 1).isEmpty)
        #expect(!state.isCurrentSelectionSubmitted(stepID: 1))

        state.setFreeformAnswer(stepID: 1, value: "macOS solo developer with a live onboarding bug")

        #expect(state.selectedChoices[1] == OpenDesignDayInteractionState.freeformChoiceID)
        #expect(state.submittedChoices[1] == nil)

        state.selectChoice(stepID: 1, choiceID: 3)

        #expect(state.selectedChoices[1] == 3)
        #expect(state.trimmedFreeformAnswer(stepID: 1).isEmpty)
    }

    @Test func dayDraftMatchesOpenDesignPreviewCopy() {
        let content = OpenDesignDayContent.day1
        var state = OpenDesignDayInteractionState()
        state.selectedChoices = [1: 1, 2: 1, 3: 2, 4: 1]

        let draft = content.draft(for: state)

        #expect(draft.markdown.contains("- 필수 입력: 프로젝트 path, 업무 일지, 인터뷰 원문, 공개 기록"))
        #expect(draft.recommendation == "Day 3 실제 행동 인터뷰 첫 후보로 올리고 인터뷰 원문과 업무 일지를 docs/ICP.md의 증거 섹션에 연결한다.")
        #expect(!draft.isAntiSignal)
    }

    @Test func antiSignalChoiceUpdatesDraftBoundaryCopy() {
        let content = OpenDesignDayContent.day1
        var state = OpenDesignDayInteractionState()
        state.selectedChoices = [1: 1, 2: 1, 3: 2, 4: 4]
        state.recordSubmittedChoice(stepID: 4, choiceID: 4)

        let draft = content.draft(for: state)

        #expect(draft.isAntiSignal)
        #expect(draft.antiIcpBody.contains("지난 7일 행동 없음"))
    }

    @Test func stepperScrollTargetsFollowCurrentDayState() {
        var state = OpenDesignDayInteractionState()

        #expect(state.stepperScrollTarget(for: 0) == .top)
        #expect(state.stepperScrollTarget(for: 1) == .mission)
        #expect(state.stepperScrollTarget(for: 2) == .mission)

        state.introStage = .mission
        state.missionAccepted = true
        state.submittedSteps.insert(1)
        #expect(state.stepperScrollTarget(for: 1) == .interview2)

        state.submittedSteps.formUnion([2, 3, 4])
        #expect(state.currentProgressScrollTarget == .finalIcp)
        #expect(state.stepperScrollTarget(for: 2) == .finalIcp)
    }

    @Test func interviewScrollRequestsPreferNextActionAnchors() {
        #expect(OpenDesignSectionAnchor.interview(stepID: 1, placement: .sectionContext) == .interview1)
        #expect(OpenDesignSectionAnchor.interview(stepID: 1, placement: .nextAction) == .interview1Options)
        #expect(OpenDesignSectionAnchor.interview(stepID: 4, placement: .nextAction) == .interview4Options)

        let request = OpenDesignScrollRequest(
            target: .interview(stepID: 2, placement: .nextAction),
            placement: .nextAction
        )

        #expect(request.target == .interview2Options)
        #expect(request.target.rawValue == "interview2-options")
        #expect(request.placement == .nextAction)

        let previewRequest = OpenDesignScrollRequest(target: .icpPreview, placement: .nextAction)
        #expect(previewRequest.resolvedTarget == .icpPreviewAction)
        #expect(previewRequest.resolvedTarget.rawValue == "icp-preview-action")

        let finalRequest = OpenDesignScrollRequest(target: .finalIcp, placement: .nextAction)
        #expect(finalRequest.resolvedTarget == .finalIcpAction)

        let candidateRequest = OpenDesignScrollRequest(target: .candidate, placement: .nextAction)
        #expect(candidateRequest.resolvedTarget == .candidateAction)

        let gateRequest = OpenDesignScrollRequest(target: .gate, placement: .nextAction)
        #expect(gateRequest.resolvedTarget == .gateAction)
    }

    @Test func referencePagesCoverOpenDesignTargetScreens() {
        let targetKinds: [OpenDesignReferencePageKind] = [.news, .projects, .settings, .interviews, .bipLog, .history]
        let pageIDs = Set(OpenDesignDayContent.day1.searchItems.map(\.id))
        let railIDs = Set(OpenDesignDayContent.day1.railItems.map(\.id))

        #expect(targetKinds.count == OpenDesignReferencePageKind.allCases.count)
        #expect(Set(targetKinds).count == 6)

        for kind in targetKinds {
            let page = OpenDesignReferenceCatalog.page(kind)
            let searchID = kind == .bipLog ? "page-bip" : "page-\(kind.rawValue)"

            #expect(OpenDesignReferencePageKind(railItemID: kind.railItemID) == kind)
            #expect(OpenDesignReferencePageKind(searchItemID: searchID) == kind)
            if kind == .settings {
                #expect(railIDs.contains(kind.railItemID))
            } else {
                #expect(!railIDs.contains(kind.railItemID))
            }
            #expect(pageIDs.contains(searchID))
            #expect(!page.sideGroups.isEmpty)
            #expect(!page.sections.isEmpty)
            #expect(!page.meta.cards.isEmpty)
        }
    }

    @Test func referenceCatalogCarriesDistinctNativePageContent() {
        #expect(OpenDesignReferenceCatalog.page(.projects).header.title.contains("Agentic30"))
        #expect(OpenDesignReferenceCatalog.page(.settings).sections.contains { $0.id == "providers" })
        #expect(OpenDesignReferenceCatalog.page(.interviews).sections.contains { $0.id == "mom" })
        #expect(OpenDesignReferenceCatalog.page(.bipLog).sections.contains { $0.id == "draft" })
        #expect(OpenDesignReferenceCatalog.page(.news).sections.contains { $0.id == "customer" })
        #expect(OpenDesignReferenceCatalog.page(.history).sections.contains { $0.id == "today" })
    }

    @Test func bipResearchLoadingEmptyHidesResultLikeSections() {
        let snapshot = bipResearchSnapshot(state: "refreshing")
        let visibility = openDesignBipVisibility(for: snapshot)
        let mainLabels = bipMainLabels(for: visibility)
        let sidebarFallbackLabels = bipSidebarFallbackLabels(for: visibility)

        #expect(visibility.isLoadingEmpty)
        #expect(!visibility.showsFilterBar)
        #expect(!visibility.showsResearchSection)
        #expect(!visibility.showsDraftSection)
        #expect(!visibility.showsSidebarSourceFilters)
        #expect(!visibility.showsFallbackSignals)
        #expect(!visibility.showsSidebarSignalSection)
        #expect(!mainLabels.contains("리서치된 게시글"))
        #expect(!mainLabels.contains("BIP 초안"))
        #expect(!mainLabels.contains("선택 후보 없음"))
        #expect(!sidebarFallbackLabels.contains("X/Threads 공개 기록"))
        #expect(!sidebarFallbackLabels.contains("확인할 공백"))
    }

    @Test func bipResearchRefreshingWithCachedCandidatesKeepsResultSections() throws {
        let snapshot = bipResearchSnapshot(
            state: "refreshing",
            candidates: [try bipResearchCandidateFixture()]
        )
        let visibility = openDesignBipVisibility(for: snapshot)

        #expect(!visibility.isLoadingEmpty)
        #expect(visibility.showsFilterBar)
        #expect(visibility.showsResearchSection)
        #expect(visibility.showsDraftSection)
        #expect(visibility.showsSidebarSourceFilters)
    }

    private func bipResearchSnapshot(
        state: String,
        candidates: [BipResearchCandidate] = [],
        signals: [BipResearchSignal] = []
    ) -> BipResearchSnapshot {
        BipResearchSnapshot(
            schemaVersion: 1,
            contentLocale: "ko-KR",
            promptProfile: "test",
            contextFingerprint: "test",
            generatedAt: nil,
            nextRefreshAfter: nil,
            dayNumber: 1,
            dayTitle: "Day 1",
            dayPhase: "foundation",
            status: bipResearchStatus(state: state),
            briefTitle: "Day 1 기준 X/Threads 공개 게시글에서 고객 후보 신호를 찾습니다.",
            briefBody: "웹 검색 결과를 원문 확인으로 다시 읽습니다.",
            querySummary: "site:x.com OR site:threads.net 고객 후보",
            candidateTargetCount: 18,
            workspaceEvidenceRefs: [],
            signals: signals,
            candidates: candidates
        )
    }

    private func bipResearchStatus(state: String) -> BipResearchStatus {
        BipResearchStatus(
            state: state,
            lastSuccessAt: nil,
            stale: false,
            error: nil,
            reason: "daily",
            researchSource: "Codex 웹 검색 도구",
            stage: "running_provider_research",
            progressText: "Codex 웹 검색 도구로 공개 근거를 검색하는 중",
            elapsedMs: nil,
            stepIndex: 4,
            stepCount: 6,
            partialFailures: nil
        )
    }

    private func bipResearchCandidateFixture() throws -> BipResearchCandidate {
        let payload = """
        {
          "id": "candidate-1",
          "title": "Builder — Claude Code BIP 후보",
          "sourceLabel": "x",
          "source": "@builder",
          "sourceType": "x",
          "medium": "X thread",
          "date": "2026-05-21",
          "matchLabel": "강",
          "matchCaption": "match",
          "quote": "Claude Code로 빌드 과정을 공개합니다.",
          "whyTitle": "왜 ICP 증거인가",
          "whyBody": "macOS agentic coding 워크플로와 맞습니다.",
          "usageTitle": "BIP 활용",
          "usageBody": "DM 후보로 저장합니다.",
          "gap": "전업 여부 확인",
          "tags": [
            { "title": "X", "tone": "sky" }
          ],
          "sourceRefs": [
            {
              "id": "src-1",
              "sourceType": "x",
              "platform": "x",
              "title": "Fetched post",
              "url": "https://x.com/builder/status/1",
              "domain": "x.com",
              "publishedAt": "2026-05-21",
              "fetchedAt": "2026-05-21T00:00:00.000Z",
              "excerpt": "Fetched excerpt"
            }
          ],
          "draft": "오늘 BIP 초안",
          "evidenceStrength": "strong"
        }
        """

        return try JSONDecoder().decode(BipResearchCandidate.self, from: Data(payload.utf8))
    }

    private func bipMainLabels(for visibility: OpenDesignBipVisibility) -> Set<String> {
        var labels: Set<String> = ["ICP 리서치 큐"]
        if visibility.showsResearchSection {
            labels.insert("리서치된 게시글")
        }
        if visibility.showsDraftSection {
            labels.insert("BIP 초안")
            labels.insert("선택 후보 없음")
        }
        return labels
    }

    private func bipSidebarFallbackLabels(for visibility: OpenDesignBipVisibility) -> Set<String> {
        guard visibility.showsFallbackSignals else { return [] }
        return ["X/Threads 공개 기록", "확인할 공백"]
    }

    private func makeAlignmentPlan(
        signalDigest: Day1SignalDigest? = nil,
        alignmentIcp: String = "B2B SaaS support lead",
        alignmentStatementText: String? = nil,
        icpPrompt: String = "먼저 검증할 고객은?",
        icpHelperText: String? = "직함보다 지금 같은 문제를 겪고 이번 주 실제로 물어볼 수 있는 고객 조건을 고릅니다.",
        outcomePrompt: String = "고객 결과는?",
        outcomeOptionDescription: String = "결과"
    ) -> Day1AlignmentPlan {
        let signals = Day1IcpSignals(
            productName: "SupportLens",
            currentIcpGuess: "B2B SaaS support lead",
            likelyUsers: ["support lead"],
            problem: "urgent Slack escalation을 놓침",
            currentAlternatives: ["Slack 수동 확인"],
            evidenceRefs: [Day1IcpEvidenceRef(path: "README.md", reason: "README", quote: "# SupportLens")],
            missingAssumptions: [],
            confidence: "high"
        )
        let icp = Day1AlignmentComponent(
            id: "icp",
            title: "ICP",
            prompt: icpPrompt,
            highlightPhrases: ["첫 고객 후보", "고객 후보"],
            helperText: icpHelperText,
            statement: "B2B SaaS support lead",
            evidence: ["README.md: README"],
            missingAssumptions: [],
            options: [
                Day1IcpQuestionOption(id: "o1", label: "support lead", description: "현재 고객 · 근거: README.md", highlightPhrases: ["support lead"], preview: "ICP", antiSignal: false, evidenceLabel: "근거: README.md", evidenceLimited: false),
                Day1IcpQuestionOption(id: "o2", label: "관심만 있음", description: "근거 부족: 최근 사건 없음", highlightPhrases: ["관심만 있음"], preview: "Weak", antiSignal: true, evidenceLabel: "근거 부족", evidenceLimited: true),
            ]
        )
        let pain = Day1AlignmentComponent(
            id: "pain_point",
            title: "Pain Point",
            prompt: "압축된 통증은?",
            highlightPhrases: ["비용을 치르는 문제", "문제"],
            helperText: "비용 신호",
            statement: "urgent Slack escalation을 놓침",
            evidence: ["docs/SPEC.md"],
            missingAssumptions: [],
            options: [
                Day1IcpQuestionOption(id: "o1", label: "Slack 누락", description: "반복됨", highlightPhrases: ["Slack 누락"], preview: "Pain", antiSignal: false),
                Day1IcpQuestionOption(id: "o2", label: "불편만 있음", description: "행동 없음", highlightPhrases: ["불편만 있음"], preview: "Weak", antiSignal: true),
            ]
        )
        let outcome = Day1AlignmentComponent(
            id: "outcome",
            title: "Outcome",
            prompt: outcomePrompt,
            highlightPhrases: ["행동 신호", "확인할 행동", "검증 행동"],
            helperText: "Day 2 기준",
            statement: "계정 리스크 escalation을 더 빨리 판단한다",
            evidence: ["docs/GOAL.md"],
            missingAssumptions: [],
            options: [
                Day1IcpQuestionOption(id: "o1", label: "빠른 판단", description: outcomeOptionDescription, highlightPhrases: ["빠른 판단"], preview: "Outcome", antiSignal: false),
                Day1IcpQuestionOption(id: "o2", label: "기능 추가", description: "고객 검증 없이 빌드", highlightPhrases: ["기능 추가"], preview: "Anti", antiSignal: true),
            ]
        )
        return Day1AlignmentPlan(
            schemaVersion: 1,
            source: "deterministic",
            generatedAt: "2026-05-20T00:00:00.000Z",
            confidence: 0.82,
            fellBackToDeterministic: false,
            projectGoal: "SupportLens가 유료 support lead 후보 1명을 검증한다",
            mission: "Goal, ICP, Pain Point, Outcome을 정렬합니다.",
            signals: signals,
            components: Day1AlignmentComponents(icp: icp, painPoint: pain, outcome: outcome),
            alignmentStatement: Day1AlignmentStatement(
                statement: alignmentStatementText ?? "목표: SupportLens가 유료 support lead 후보 1명을 검증한다 / ICP: B2B SaaS support lead / Pain Point: urgent Slack escalation을 놓침 / Outcome: 계정 리스크 escalation을 더 빨리 판단한다",
                projectGoal: "SupportLens가 유료 support lead 후보 1명을 검증한다",
                icp: alignmentIcp,
                painPoint: "urgent Slack escalation을 놓침",
                outcome: "계정 리스크 escalation을 더 빨리 판단한다"
            ),
            qualityGate: Day1AlignmentQualityGate(
                score: 8.4,
                threshold: 7.0,
                passed: true,
                label: "PASS",
                passGate: "핵심 가설이 7.0/10 이상",
                failGate: "목표, 고객, 통증, 결과 중 하나가 비어 있음",
                criteria: [
                    Day1AlignmentQualityCriterion(id: "project_goal", label: "Project goal", score: 2.0, maxScore: 2.0, passed: true, detail: "명확함")
                ]
            ),
            firstInterviewMessage: FirstInterviewMessage(
                channel: "DM/email/Slack",
                recipientPlaceholder: "{name}",
                subject: "핵심 가설 인터뷰",
                bodyTemplate: "안녕하세요 {name}님, SupportLens 핵심 가설을 확인하고 있습니다.",
                questions: ["최근 사건?"]
            ),
            day2Handoff: Day1Day2Handoff(
                title: "Day 2 시장 신호로 넘길 핵심 가설",
                body: "Day 2에서 유료 대체재를 확인합니다.",
                focus: "목표: SupportLens...",
                nextDayPrompt: "유료 대체재 5개를 찾는다.",
                qualityGateLabel: "PASS 8.4/10"
            ),
            signalDigest: signalDigest
        )
    }

    private func makeFiveOptionAlignmentPlan() -> Day1AlignmentPlan {
        let base = makeAlignmentPlan()
        let icp = Day1AlignmentComponent(
            id: base.components.icp.id,
            title: base.components.icp.title,
            prompt: base.components.icp.prompt,
            helperText: base.components.icp.helperText,
            statement: base.components.icp.statement,
            evidence: base.components.icp.evidence,
            missingAssumptions: base.components.icp.missingAssumptions,
            options: [
                Day1IcpQuestionOption(id: "icp1", label: "support lead", description: "현재 고객 · 근거: README.md", preview: "ICP", antiSignal: false, evidenceLabel: "근거: README.md", evidenceLimited: false),
                Day1IcpQuestionOption(id: "icp2", label: "customer success lead", description: "SLA 리스크를 직접 관리합니다. · 근거: docs/ICP.md", preview: "ICP", antiSignal: false, evidenceLabel: "근거: docs/ICP.md", evidenceLimited: false),
                Day1IcpQuestionOption(id: "icp3", label: "온콜 운영 담당자", description: "반복 알림 누락 비용을 압니다. · 근거: docs/SPEC.md", preview: "ICP", antiSignal: false, evidenceLabel: "근거: docs/SPEC.md", evidenceLimited: false),
                Day1IcpQuestionOption(id: "icp4", label: "B2B SaaS 운영자", description: "작은 팀에서 지원 흐름을 직접 고칩니다. · 근거: docs/GOAL.md", preview: "ICP", antiSignal: false, evidenceLabel: "근거: docs/GOAL.md", evidenceLimited: false),
                Day1IcpQuestionOption(id: "icp5", label: "구매권한 없는 조언자", description: "최근 사건과 예산 신호가 없어 제외 후보입니다.", preview: "Weak", antiSignal: true, evidenceLabel: "근거 부족", evidenceLimited: true),
            ]
        )
        let pain = Day1AlignmentComponent(
            id: base.components.painPoint.id,
            title: base.components.painPoint.title,
            prompt: base.components.painPoint.prompt,
            helperText: base.components.painPoint.helperText,
            statement: base.components.painPoint.statement,
            evidence: base.components.painPoint.evidence,
            missingAssumptions: base.components.painPoint.missingAssumptions,
            options: [
                Day1IcpQuestionOption(id: "pain1", label: "Slack 누락", description: "반복됨", preview: "Pain", antiSignal: false),
                Day1IcpQuestionOption(id: "pain2", label: "SLA 리스크 발견 지연", description: "계정 위험 판단이 늦어집니다.", preview: "Pain", antiSignal: false),
                Day1IcpQuestionOption(id: "pain3", label: "수동 확인 시간 낭비", description: "현재 대안의 시간 비용입니다.", preview: "Pain", antiSignal: false),
                Day1IcpQuestionOption(id: "pain4", label: "우선순위 흔들림", description: "요청을 매번 사람이 재분류합니다.", preview: "Pain", antiSignal: false),
                Day1IcpQuestionOption(id: "pain5", label: "불편하지만 비용 없음", description: "돈이나 시간이 이미 쓰이지 않습니다.", preview: "Weak", antiSignal: true),
            ]
        )
        let outcome = Day1AlignmentComponent(
            id: base.components.outcome.id,
            title: base.components.outcome.title,
            prompt: base.components.outcome.prompt,
            helperText: base.components.outcome.helperText,
            statement: base.components.outcome.statement,
            evidence: base.components.outcome.evidence,
            missingAssumptions: base.components.outcome.missingAssumptions,
            options: [
                Day1IcpQuestionOption(id: "outcome1", label: "빠른 판단", description: "결과", preview: "Outcome", antiSignal: false),
                Day1IcpQuestionOption(id: "outcome2", label: "지불 의향 확인", description: "돈을 낼 문제인지 봅니다.", preview: "Outcome", antiSignal: false),
                Day1IcpQuestionOption(id: "outcome3", label: "현재 대안 확인", description: "수동 workflow를 보여달라고 요청합니다.", preview: "Outcome", antiSignal: false),
                Day1IcpQuestionOption(id: "outcome4", label: "도입 결정권자 확인", description: "구매자와 사용자를 분리합니다.", preview: "Outcome", antiSignal: false),
                Day1IcpQuestionOption(id: "outcome5", label: "최근 사건 없음", description: "시장 신호가 약한 경우 보류합니다.", preview: "Weak", antiSignal: true),
            ]
        )
        return Day1AlignmentPlan(
            schemaVersion: base.schemaVersion,
            source: "frontier_ensemble",
            generatedAt: base.generatedAt,
            confidence: base.confidence,
            fellBackToDeterministic: false,
            projectGoal: base.projectGoal,
            mission: base.mission,
            signals: base.signals,
            components: Day1AlignmentComponents(icp: icp, painPoint: pain, outcome: outcome),
            alignmentStatement: base.alignmentStatement,
            qualityGate: base.qualityGate,
            firstInterviewMessage: base.firstInterviewMessage,
            day2Handoff: base.day2Handoff,
            signalDigest: base.signalDigest
        )
    }

    private func makePlan(
        questionCount: Int,
        firstQuestionOptions: [Day1IcpQuestionOption]? = nil,
        firstQuestionAllowFreeText: Bool? = nil
    ) -> Day1IcpPlan {
        let dimensions = ["must_have", "core_need", "current_alternative", "bad_fit_boundary", "reference_customer", "overflow"]
        let questions = dimensions.prefix(questionCount).enumerated().map { index, dimension in
            let defaultOptions = [
                Day1IcpQuestionOption(id: "o1", label: index == 2 ? "Slack 수동 확인" : "좋은 조건 \(index + 1)", description: "현재 행동이 있음", preview: "Have", antiSignal: false),
                Day1IcpQuestionOption(id: "o2", label: "관심만 있음", description: "최근 사건 없음", preview: "Weak", antiSignal: dimension == "bad_fit_boundary"),
            ]
            return Day1IcpQuestion(
                id: "q\(index + 1)_\(dimension)",
                dimension: dimension,
                title: "질문 \(index + 1)",
                prompt: "\(dimension) prompt?",
                helperText: "scan 기반 질문",
                options: index == 0 ? firstQuestionOptions ?? defaultOptions : defaultOptions,
                allowFreeText: index == 0 ? firstQuestionAllowFreeText ?? true : true,
                freeTextPlaceholder: "직접 입력"
            )
        }

        return Day1IcpPlan(
            schemaVersion: 1,
            source: "deterministic",
            generatedAt: "2026-05-20T00:00:00.000Z",
            confidence: 0.66,
            fellBackToDeterministic: false,
            mission: "SupportLens의 ICP v0를 좁힙니다.",
            signals: Day1IcpSignals(
                productName: "SupportLens",
                currentIcpGuess: "B2B SaaS support lead",
                likelyUsers: ["support lead"],
                problem: "urgent Slack escalation을 놓침",
                currentAlternatives: ["Slack 수동 확인"],
                evidenceRefs: [Day1IcpEvidenceRef(path: "README.md", reason: "README", quote: "# SupportLens")],
                missingAssumptions: ["reference_customer"],
                confidence: "medium"
            ),
            questions: Array(questions),
            icpDraft: IcpDraft(
                description: "B2B SaaS support lead 중 urgent Slack escalation을 놓치는 팀.",
                criteria: ["현재 대안이 있다"],
                whyTheyMatter: ["짧은 sales cycle"],
                needs: ["누락 방지"],
                haves: ["Slack"],
                dontNeeds: ["관심만 있음"],
                evidence: ["README.md: README"],
                referenceCustomersToFind: ["support lead 1명"]
            ),
            antiIcp: Day1AntiIcp(
                summary: "최근 사건이 없으면 제외",
                rules: [AntiIcpRule(id: "polite", label: "흥미롭네요만 말함", reason: "polite interest", evidenceRef: nil)],
                politeInterestGuardrails: ["최근 7일 사건 묻기"]
            ),
            firstInterviewMessage: FirstInterviewMessage(
                channel: "DM/email/Slack",
                recipientPlaceholder: "{name}",
                subject: "ICP 인터뷰",
                bodyTemplate: "안녕하세요 {name}님, SupportLens ICP 인터뷰를 부탁드려요.",
                questions: ["최근 사건?"]
            )
        )
    }

    @Test func transcriptScrollPolicySupersedesStaleGenerations() {
        #expect(OfficeHoursTranscriptScrollPolicy.shouldPerform(requestGeneration: 3, currentGeneration: 3))
        #expect(!OfficeHoursTranscriptScrollPolicy.shouldPerform(requestGeneration: 2, currentGeneration: 3))
        #expect(!OfficeHoursTranscriptScrollPolicy.shouldPerform(requestGeneration: 4, currentGeneration: 3))
    }

    @Test func transcriptScrollRepinTailStaysShort() {
        // 긴 블라인드 재시도 꼬리(과거 3.4~5.9초)가 되돌아오면 인터뷰 중 스크롤이
        // 사용자 스크롤·새 타깃과 싸우며 왔다갔다 흔들린다. 타깃을 움직이는 상태
        // 변화는 각자 새 스크롤 요청을 쏘므로 재핀은 짧은 정착용 꼬리면 충분하다.
        #expect(!OfficeHoursTranscriptScrollPolicy.repinDelays.isEmpty)
        #expect(OfficeHoursTranscriptScrollPolicy.repinDelays == OfficeHoursTranscriptScrollPolicy.repinDelays.sorted())
        #expect(OfficeHoursTranscriptScrollPolicy.repinDelays.allSatisfy { $0 > 0 && $0 <= 1.5 })
    }

}
