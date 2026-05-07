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
