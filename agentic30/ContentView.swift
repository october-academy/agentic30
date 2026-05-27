//
//  ContentView.swift
//  agentic30
//
//  Created by october on 4/8/26.
//

import AppKit
import SwiftUI

struct ContentView: View {
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @ObservedObject var viewModel: AgenticViewModel
    private let surfaceOverride: AgenticSurface?
    private let openWorkspaceAction: (() -> Void)?
    private let closeWorkspaceAction: (() -> Void)?
    private let zoomWorkspaceAction: (() -> Void)?
    private let maximizeWorkspaceOnFirstAppear: Bool
    private let markWorkspaceInitialMaximizeApplied: (() -> Void)?

    @State private var currentPromptBindingToken: String?
    @State private var showsBipMissionEvidence = false
    @State private var showsBipCompletionFields = false
    @State private var showsBipReadinessPreview = false
    @State private var showsBipReadinessAdvanced = false
    @State private var showsInlineBipReadinessSetup = false
    @State private var selectedOpenDesignReferencePage: OpenDesignReferencePageKind?
    @State private var openDesignDayInteractionStateCache = OpenDesignDayInteractionStateCache()

    @MainActor
    init(
        viewModel: AgenticViewModel,
        surfaceOverride: AgenticSurface? = nil,
        openWorkspaceAction: (() -> Void)? = nil,
        closeWorkspaceAction: (() -> Void)? = nil,
        zoomWorkspaceAction: (() -> Void)? = nil,
        maximizeWorkspaceOnFirstAppear: Bool = false,
        markWorkspaceInitialMaximizeApplied: (() -> Void)? = nil
    ) {
        _viewModel = ObservedObject(wrappedValue: viewModel)
        self.surfaceOverride = surfaceOverride
        self.openWorkspaceAction = openWorkspaceAction
        self.closeWorkspaceAction = closeWorkspaceAction
        self.zoomWorkspaceAction = zoomWorkspaceAction
        self.maximizeWorkspaceOnFirstAppear = maximizeWorkspaceOnFirstAppear
        self.markWorkspaceInitialMaximizeApplied = markWorkspaceInitialMaximizeApplied
    }

    @ViewBuilder
    var body: some View {
        let content = rootContent
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .padding(isWorkspaceWindow ? 0 : 22)
            .background {
                if isWorkspaceWindow {
                    WorkspaceWindowChrome(
                        maximizeOnInitialInstall: maximizeWorkspaceOnFirstAppear,
                        markInitialInstallMaximizeApplied: markWorkspaceInitialMaximizeApplied
                    )
                } else {
                    WindowChrome()
                }
            }
            .onAppear {
                viewModel.start()
                syncPromptDrafts(bindingToken: viewModel.pendingStructuredPrompt?.uiBindingToken)
            }
            .onDisappear {
                if !isWorkspaceWindow {
                    viewModel.stop()
                }
            }
            .onChange(of: viewModel.pendingStructuredPrompt?.uiBindingToken) { _, bindingToken in
                syncPromptDrafts(bindingToken: bindingToken)
            }
            .onChange(of: viewModel.visibleBipCoach?.currentMission?.status) { _, status in
                if status == "completed" {
                    showsBipCompletionFields = false
                }
            }
            .onChange(of: viewModel.selectedFoundationDay) { _, day in
                clearOpenDesignReferenceRouteIfUnsupported(dayNumber: day)
            }
            .onChange(of: viewModel.foundationCurriculumPresentationDestination) { _, destination in
                if destination == .graduation {
                    clearOpenDesignReferenceRoute()
                }
            }
            .onChange(of: viewModel.localDataResetGeneration) { _, _ in
                resetLocalSwiftUIStateAfterLocalDataReset()
            }

        if isWorkspaceWindow {
            content
        } else {
            content
                .containerBackground(.clear, for: .window)
        }
    }

    private var isWorkspaceWindow: Bool {
        surfaceOverride == .workspace
    }

    private var activeSurface: AgenticSurface {
        surfaceOverride ?? viewModel.activeSurface
    }

    private var rootContent: some View {
        ZStack {
            Color.clear.ignoresSafeArea()
            if viewModel.requiresMacOnboarding {
                IntakeV2FlowView(
                    bootLogState: viewModel.intakeV2BootLogState,
                    workspaceScanResult: viewModel.scanResult,
                    onWorkspacePrefetchRequested: { store, _ in
                        guard let context = intakeV2OnboardingContext(from: store) else { return }
                        guard let url = store.folderURL else {
                            viewModel.prepareIntakeOnlyOnboarding(context: context)
                            return
                        }
                        viewModel.prefetchOnboardingWorkspace(url: url, context: context)
                    },
                    onComplete: { store, _ in
                        // V2 onboarding completion — review-driven redesign 2026-05-14.
                        // Maps V2 store answers into the legacy OnboardingContext schema
                        // so the rest of the routing (needsOnboardingContext, needsProjectWorkspace)
                        // settles in one shot.
                        if let context = intakeV2OnboardingContext(from: store) {
                            viewModel.submitOnboardingContext(context)
                        }
                        if let url = store.folderURL {
                            WorkspaceSettings.store(url)
                        }
                        viewModel.completeMacOnboardingIntro(openWorkspace: true)
                    }
                )
                .id(viewModel.localDataResetGeneration)
            } else if let session = viewModel.selectedSession {
                switch activeSurface {
                case .assistantBubble:
                    assistantPresentation(for: session)
                case .workspace:
                    agenticWorkspace(for: session)
                }
            } else if activeSurface == .workspace {
                workspacePreparingSurface()
            } else {
                compactPlaceholder(
                    title: "Preparing assistant",
                    subtitle: "Starting a new session"
                )
            }
        }
    }

    private func intakeV2OnboardingContext(from store: IntakeV2Store) -> OnboardingContext? {
        IntakeV2OnboardingContextMapper.makeContext(from: store)
    }

    @ViewBuilder
    private func workspacePreparingSurface() -> some View {
        openDesignDaySurface(day: workspaceOpenDesignDay, session: nil)
    }

    private func assistantPresentation(for session: ChatSession) -> some View {
        HStack(alignment: .top, spacing: 14) {
            assistantAvatarButton(size: 42)
                .padding(.top, 8)

            assistantBubbleShell(for: session)
        }
        .animation(.spring(response: 0.32, dampingFraction: 0.86), value: viewModel.presentationPhase)
    }

    private var workspaceOpenDesignDay: AgenticCurriculumDay {
        let dayNumber = OpenDesignWorkspaceDayResolver.dayNumber(
            selectedDay: viewModel.selectedFoundationDay,
            completedDays: viewModel.foundationProgressState.completedDays
        )
        return AgenticCurriculumDay.days.first(where: { $0.day == dayNumber }) ?? AgenticCurriculumDay.days[0]
    }

    private func curriculumPayload(for day: AgenticCurriculumDay) -> [String: Any] {
        [
            "day": day.day,
            "phase": day.phase.rawValue,
            "phaseTitle": day.phase.title,
            "title": day.title,
            "shortTitle": day.shortTitle,
            "summary": day.summary,
            "tasks": day.tasks,
            "output": day.output,
        ]
    }

    @ViewBuilder
    private func openDesignDaySurface(day: AgenticCurriculumDay, session: ChatSession?) -> some View {
        let personalizedDay1Content = OpenDesignDayContent.personalizedIfAvailable(
            from: viewModel.scanResult?.day1AlignmentPlan,
            fallback: viewModel.scanResult?.day1IcpPlan
        )
        let shouldUseIntakeOnlyDay1 = day.day == 1
            && !viewModel.isScanning
            && (viewModel.workspaceRoot.isEmpty || viewModel.scanResult?.error?.nonEmpty != nil)
        let day1Content = personalizedDay1Content ?? (shouldUseIntakeOnlyDay1 ? OpenDesignDayContent.day1 : nil)
        let resolvedContent: OpenDesignDayContent? = (day.day == 2 ? OpenDesignDayContent.day2 : day1Content)?
            .applyingFoundationProgress(viewModel.foundationProgressState, selectedDay: day.day)
            .lockingDaysAfterSecond
        let bipResearchDayNumber = viewModel.foundationProgressState.currentDayNumber() ?? 1
        let bipResearchDay = AgenticCurriculumDay.days.first(where: { $0.day == bipResearchDayNumber })
            ?? AgenticCurriculumDay.days[0]
        let bipResearchCurriculum = curriculumPayload(for: bipResearchDay)
        let day1HandoffPrompt = viewModel.activeDay1HandoffPrompt
        let day1HandoffPromptCard = day1HandoffPrompt.map { prompt in
            AnyView(inlineStructuredPrompt(prompt, submissionState: submissionState(for: prompt)))
        }
        let content = ZStack {
            if let resolvedContent {
                OpenDesignDayPageView(
                    content: resolvedContent,
                    interaction: openDesignDayInteractionBinding(for: day, content: resolvedContent),
                    selectedReferencePage: $selectedOpenDesignReferencePage,
                    openSettings: {
                        withAnimation(.spring(response: 0.24, dampingFraction: 0.88)) {
                            selectedOpenDesignReferencePage = .settings
                        }
                    },
                    submitStructuredPromptChoice: { choice in
                        submitOpenDesignDayChoice(choice, day: day, session: session)
                    },
                    newsMarketRadar: viewModel.newsMarketRadar,
                    refreshNewsMarketRadar: {
                        viewModel.refreshNewsMarketRadar(reason: "manual", force: true)
                    },
                    prepareNewsMarketRadar: {
                        viewModel.prepareNewsMarketRadarForDisplay()
                    },
                    bipResearch: viewModel.bipResearch,
                    refreshBipResearch: {
                        viewModel.refreshBipResearch(
                            reason: "manual",
                            force: true,
                            dayNumber: bipResearchDay.day,
                            curriculumDay: bipResearchCurriculum
                        )
                    },
                    prepareBipResearch: {
                        viewModel.prepareBipResearchForDisplay(curriculumDay: bipResearchCurriculum)
                    },
                    openNewsSettings: {
                        withAnimation(.spring(response: 0.24, dampingFraction: 0.88)) {
                            selectedOpenDesignReferencePage = .settings
                        }
                    },
                    day1DocPreviews: viewModel.iddDocPreviews,
                    day1HandoffPromptCard: day1HandoffPromptCard,
                    activeDay1HandoffDocType: day1HandoffPrompt?.generation?.docType?.lowercased(),
                    pendingDay1HandoffDocType: viewModel.day1DocHandoffPendingDocType,
                    day1HandoffError: viewModel.day1DocHandoffError,
                    startDay1DocHandoff: { docType, handoff in
                        viewModel.startDay1DocHandoff(docType: docType, day1Handoff: handoff)
                    },
                    completeDay: {
                        _ = viewModel.markFoundationDayCompleted(day.day)
                    },
                    advanceToNextDay: {
                        let nextDay = min(day.day + 1, 30)
                        guard OpenDesignReferenceRoutePolicy.supportsOpenDesignDay(dayNumber: nextDay),
                              viewModel.isFoundationDayUnlocked(nextDay) else { return }
                        withAnimation(.spring(response: 0.24, dampingFraction: 0.88)) {
                            viewModel.selectFoundationDay(nextDay)
                        }
                    },
                    selectDay: { selectedDay in
                        guard OpenDesignReferenceRoutePolicy.supportsOpenDesignDay(dayNumber: selectedDay),
                              viewModel.isFoundationDayUnlocked(selectedDay) else { return }
                        withAnimation(.spring(response: 0.24, dampingFraction: 0.88)) {
                            clearOpenDesignReferenceRoute()
                            viewModel.selectFoundationDay(selectedDay)
                        }
                    }
                )
            } else {
                OpenDesignDayPlanPreparingView(
                    isScanning: viewModel.isScanning,
                    progressMessage: viewModel.scanProgressMessage.nonEmpty,
                    scanError: viewModel.scanResult?.error?.nonEmpty,
                    sidecarFailureMessage: viewModel.sidecarFailureMessage?.nonEmpty
                )
            }
        }

        if isWorkspaceWindow {
            content
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(OpenDesignDayColor.bg)
                .accessibilityIdentifier("workspace.surface")
        } else {
            content
                .frame(width: 1136, height: 716)
                .background(OpenDesignDayColor.bg)
                .clipShape(RoundedRectangle(cornerRadius: 28, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 28, style: .continuous)
                        .stroke(Color.white.opacity(0.12), lineWidth: 1)
                )
                .accessibilityIdentifier("workspace.surface")
        }
    }

    private struct OpenDesignDayPlanPreparingView: View {
        let isScanning: Bool
        let progressMessage: String?
        let scanError: String?
        let sidecarFailureMessage: String?

        private var statusText: String? {
            sidecarFailureMessage ?? scanError ?? progressMessage
        }

        var body: some View {
            ZStack {
                OpenDesignDayColor.bg.ignoresSafeArea()

                VStack(alignment: .leading, spacing: 18) {
                    HStack(spacing: 10) {
                        Circle()
                            .fill(isScanning ? OpenDesignDayColor.accent : OpenDesignDayColor.muted.opacity(0.55))
                            .frame(width: 9, height: 9)
                        Text(isScanning ? "workspace scan" : "workspace")
                            .font(.system(size: 12, weight: .semibold, design: .monospaced))
                            .foregroundStyle(OpenDesignDayColor.muted)
                    }

                    VStack(alignment: .leading, spacing: 10) {
                        Text("Day 1 계획을 준비 중입니다.")
                            .font(.system(size: 28, weight: .bold))
                            .foregroundStyle(OpenDesignDayColor.fg)

                        Text("워크스페이스 scan 결과가 준비되면 목표, 고객, 문제, 확인할 행동이 담긴 핵심 가설을 보여줍니다.")
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundStyle(OpenDesignDayColor.fgSecondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }

                    if let statusText {
                        Text(statusText)
                            .font(.system(size: 12, weight: .semibold, design: .monospaced))
                            .foregroundStyle(sidecarFailureMessage == nil ? OpenDesignDayColor.muted : OpenDesignDayColor.amber)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 8)
                            .background(OpenDesignDayColor.surface.opacity(0.72), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                            .overlay(
                                RoundedRectangle(cornerRadius: 8, style: .continuous)
                                    .stroke(OpenDesignDayColor.borderSoft.opacity(0.8), lineWidth: 1)
                            )
                    }
                }
                .frame(maxWidth: 680, alignment: .leading)
                .padding(28)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)
            }
            .accessibilityIdentifier("opendesign.day.planPreparing")
        }
    }

    private func clearOpenDesignReferenceRoute() {
        selectedOpenDesignReferencePage = nil
    }

    private func clearOpenDesignReferenceRouteIfUnsupported(dayNumber: Int) {
        if !OpenDesignReferenceRoutePolicy.supportsOpenDesignDay(dayNumber: dayNumber) {
            clearOpenDesignReferenceRoute()
        }
    }

    private func resetLocalSwiftUIStateAfterLocalDataReset() {
        currentPromptBindingToken = nil
        showsBipMissionEvidence = false
        showsBipCompletionFields = false
        showsBipReadinessPreview = false
        showsBipReadinessAdvanced = false
        showsInlineBipReadinessSetup = false
        selectedOpenDesignReferencePage = nil
        openDesignDayInteractionStateCache.removeAll()
    }

    private var openDesignInteractionWorkspaceRoot: String {
        let root = viewModel.workspaceRoot.trimmingCharacters(in: .whitespacesAndNewlines)
        if !root.isEmpty {
            return root
        }
        return WorkspaceSettings.resolvedURL().path
    }

    private func openDesignDayInteractionBinding(
        for day: AgenticCurriculumDay,
        content: OpenDesignDayContent
    ) -> Binding<OpenDesignDayInteractionState> {
        let key = OpenDesignDayInteractionKey(
            workspaceRoot: openDesignInteractionWorkspaceRoot,
            dayNumber: day.day
        )
        let totalInterviewSteps = content.interviewSteps.count
        return Binding(
            get: {
                openDesignDayInteractionStateCache.state(
                    for: key,
                    totalInterviewSteps: totalInterviewSteps
                )
            },
            set: { state in
                openDesignDayInteractionStateCache.update(
                    state,
                    for: key,
                    totalInterviewSteps: totalInterviewSteps
                )
            }
        )
    }

    private func submitOpenDesignDayChoice(
        _ choice: OpenDesignDayAnswerSubmission,
        day: AgenticCurriculumDay,
        session: ChatSession?
    ) {
        viewModel.recordOpenDesignDayAnswer(
            choice,
            day: day.day,
            dayType: day.phase.rawValue
        )
    }

    @ViewBuilder
    private func agenticWorkspace(for session: ChatSession) -> some View {
        openDesignDaySurface(day: workspaceOpenDesignDay, session: session)
    }

    private func compactPlaceholder(title: String, subtitle: String) -> some View {
        HStack(alignment: .top, spacing: 14) {
            assistantAvatar(size: 42)
                .padding(.top, 8)

            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .font(.system(size: 17, weight: .bold, design: .rounded))
                    .foregroundStyle(.white.opacity(0.96))
                Text(subtitle)
                    .font(.system(size: 13, weight: .medium, design: .rounded))
                    .foregroundStyle(.white.opacity(0.56))
            }
            .padding(.horizontal, 18)
            .padding(.vertical, 12)
            .frame(width: 420, alignment: .leading)
            .background(pillMaterial)
        }
    }

    private func assistantBubbleShell(for session: ChatSession) -> some View {
        let lastAssistant = lastAssistantMessage(in: session)
        let latestPrompt = viewModel.sentPromptPreview(for: session.id) ?? lastUserPrompt(in: session)
        let pendingPrompt = session.pendingUserInput
        let isExpanding = viewModel.presentationPhase == .expanding
        let isAwaitingInlineInput = pendingPrompt != nil
        let showsComposer = pendingPrompt == nil && session.status != .running
        let visibleCoach = viewModel.visibleBipCoach
        let rawLatestAnswerText = lastAssistant?.content.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let latestAnswerText = rawLatestAnswerText.nonEmpty ?? (session.status == .running ? "" : "대기 중")
        let isWaitingForAnswer = latestAnswerText.isEmpty && session.status == .running
        let latestAssistantIsBipMission = lastAssistant?.bipMissionChoices?.isEmpty == false
        let answerMaxHeight: CGFloat = visibleCoach == nil ? (showsComposer ? 324 : 430) : 180
        let width: CGFloat = 620
        let fixedHeight: CGFloat? = isAwaitingInlineInput ? nil : 576

        return VStack(alignment: .leading, spacing: 14) {
            if isAwaitingInlineInput {
                inlineStructuredPromptIntro(for: session)
            } else if let latestPrompt, !latestPrompt.isEmpty {
                Text("Q. \(latestPrompt)")
                    .font(.system(size: 14, weight: .bold, design: .rounded))
                    .foregroundStyle(.white.opacity(0.9))
                    .lineLimit(2)
                    .id(latestPrompt)
                    .accessibilityIdentifier("assistant.latestPrompt")
                    .accessibilityLabel("Q. \(latestPrompt)")
                    .transition(.opacity)
            }

            if let pendingPrompt {
                inlineStructuredPrompt(pendingPrompt, submissionState: submissionState(for: pendingPrompt))
                    .transition(.opacity)
            } else if visibleCoach != nil && latestAssistantIsBipMission {
                Text("오늘 실행")
                    .font(.system(size: 13, weight: .medium, design: .rounded))
                    .foregroundStyle(.white.opacity(0.56))
                    .transition(.opacity)

                bipCoachPanel()
                    .transition(.opacity)
            } else {
                Text("Assistant")
                    .font(.system(size: 13, weight: .medium, design: .rounded))
                    .foregroundStyle(.white.opacity(0.56))
                    .transition(.opacity)

                ZStack(alignment: .topLeading) {
                    if isExpanding {
                        VStack(alignment: .leading, spacing: 10) {
                            skeletonLine(width: 0.88)
                            skeletonLine(width: 0.94)
                            skeletonLine(width: 0.71)
                        }
                        .transition(.opacity)
                    } else {
                        Group {
                            if isWaitingForAnswer {
                                assistantLiveStatusPanel(session, isLarge: true)
                                    .accessibilityIdentifier("assistant.latestAnswer")
                                    .accessibilityLabel("\(session.provider.title)가 응답을 준비하고 있습니다.")
                            } else if visibleCoach == nil {
                                VStack(alignment: .leading, spacing: 10) {
                                    ScrollView {
                                        Text(latestAnswerText)
                                            .font(.system(size: 18, weight: .semibold, design: .rounded))
                                            .foregroundStyle(.white.opacity(0.97))
                                            .textSelection(.enabled)
                                            .frame(maxWidth: .infinity, alignment: .topLeading)
                                            .fixedSize(horizontal: false, vertical: true)
                                            .padding(.trailing, 4)
                                            .accessibilityIdentifier("assistant.latestAnswer")
                                            .accessibilityLabel(latestAnswerText)
                                    }
                                    .frame(maxHeight: answerMaxHeight)

                                    if lastAssistant?.state == .error {
                                        assistantSecondaryButton(
                                            title: "채팅 다시 시도",
                                            systemImage: "arrow.clockwise",
                                            accessibilityIdentifier: "assistant.retryFailedChat"
                                        ) {
                                            viewModel.retryLastFailedChatTurn()
                                        }
                                    }
                                }
                            } else {
                                Text(latestAnswerText)
                                    .font(.system(size: 18, weight: .semibold, design: .rounded))
                                    .foregroundStyle(.white.opacity(0.97))
                                    .textSelection(.enabled)
                                    .frame(maxWidth: .infinity, alignment: .topLeading)
                                    .fixedSize(horizontal: false, vertical: true)
                                    .padding(.trailing, 4)
                                    .lineLimit(3)
                                    .accessibilityIdentifier("assistant.latestAnswer")
                                    .accessibilityLabel(latestAnswerText)
                            }
                        }
                        .transition(.opacity)
                    }
                }
                bipCoachPanel()
                    .transition(.opacity)

                if isExpanding {
                    HStack(spacing: 10) {
                        skeletonChip(width: 168)
                        skeletonChip(width: 112)
                    }
                    .transition(.opacity)
                }
            }

            if showsComposer {
                Spacer(minLength: 0)
                VStack(alignment: .leading, spacing: 10) {
                    promptComposer()
                }
                .transition(.opacity)
            }
        }
        .padding(.horizontal, 22)
        .padding(.vertical, 18)
        .frame(width: width, height: fixedHeight, alignment: .topLeading)
        .background(bubbleBackground(isCompact: false))
    }

    private func assistantSecondaryButton(
        title: String,
        systemImage: String,
        accessibilityIdentifier: String,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            HStack(spacing: 7) {
                Image(systemName: systemImage)
                    .font(.system(size: 12, weight: .bold))
                Text(title)
                    .font(.system(size: 13, weight: .bold, design: .rounded))
            }
            .foregroundStyle(.white.opacity(0.82))
            .padding(.horizontal, 13)
            .frame(height: 36)
            .background(Capsule().fill(Color.white.opacity(0.09)))
            .overlay(Capsule().stroke(Color.white.opacity(0.09), lineWidth: 1))
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier(accessibilityIdentifier)
        .accessibilityLabel(title)
    }

    private func assistantLiveStatusPanel(_ session: ChatSession, isLarge: Bool = false) -> some View {
        assistantLiveStatusPanel(
            provider: session.provider,
            outputLines: viewModel.sidecarOutputPreview(for: session.id),
            isLarge: isLarge
        )
    }

    private func assistantLiveStatusPanel(
        provider: AgentProvider,
        outputLines: [String] = [],
        isLarge: Bool = false
    ) -> some View {
        let visibleOutput = Array(outputLines.suffix(isLarge ? 10 : 6))
        return VStack(alignment: .leading, spacing: isLarge ? 14 : 10) {
            HStack(spacing: 9) {
                ProgressView()
                    .controlSize(isLarge ? .regular : .small)
                    .frame(width: isLarge ? 18 : 14, height: isLarge ? 18 : 14)
                VStack(alignment: .leading, spacing: 3) {
                    Text("\(provider.title)가 응답을 준비 중")
                        .font(.system(size: isLarge ? 16 : 13, weight: .bold, design: .rounded))
                        .foregroundStyle(.white.opacity(0.92))
                    Text(visibleOutput.isEmpty ? "실행 이벤트를 기다리는 중입니다." : "실행 타임라인 스트리밍")
                        .font(.system(size: isLarge ? 12 : 11, weight: .medium, design: .rounded))
                        .foregroundStyle(.white.opacity(0.52))
                }
            }

            if visibleOutput.isEmpty {
                Text("첫 응답 이벤트나 토큰이 도착하면 이 영역이 실제 진행상황으로 바뀝니다.")
                    .font(.system(size: isLarge ? 12 : 11, weight: .medium, design: .rounded))
                    .foregroundStyle(.white.opacity(0.48))
                    .fixedSize(horizontal: false, vertical: true)
            } else {
                VStack(alignment: .leading, spacing: 7) {
                    ForEach(Array(visibleOutput.enumerated()), id: \.offset) { index, line in
                        HStack(alignment: .top, spacing: 8) {
                            Image(systemName: index == visibleOutput.count - 1 ? "dot.radiowaves.left.and.right" : "terminal")
                                .font(.system(size: 10, weight: .bold))
                                .foregroundStyle(.white.opacity(index == visibleOutput.count - 1 ? 0.78 : 0.48))
                                .frame(width: 14, alignment: .center)
                            Text(line)
                                .font(.system(size: isLarge ? 12 : 11, weight: .medium, design: .monospaced))
                                .foregroundStyle(.white.opacity(index == visibleOutput.count - 1 ? 0.82 : 0.58))
                                .lineLimit(isLarge ? 4 : 3)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                }
                .padding(.leading, 1)
            }
        }
        .padding(isLarge ? 16 : 13)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .fill(Color.white.opacity(0.055))
                .overlay(
                    RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .stroke(Color.white.opacity(0.09), lineWidth: 1)
                )
        )
    }

    private func assistantActivityRow(icon: String, title: String, detail: String, isActive: Bool) -> some View {
        HStack(alignment: .top, spacing: 9) {
            ZStack {
                Circle()
                    .fill(isActive ? Color.white.opacity(0.16) : Color.white.opacity(0.08))
                    .frame(width: 22, height: 22)
                if isActive {
                    ProgressView()
                        .controlSize(.mini)
                        .frame(width: 12, height: 12)
                } else {
                    Image(systemName: icon)
                        .font(.system(size: 11, weight: .bold))
                        .foregroundStyle(Color.white.opacity(0.62))
                }
            }

            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.system(size: 12, weight: .bold, design: .rounded))
                    .foregroundStyle(.white.opacity(isActive ? 0.84 : 0.62))
                Text(detail)
                    .font(.system(size: 11, weight: .medium, design: .rounded))
                    .foregroundStyle(.white.opacity(0.44))
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    @ViewBuilder
    private func bipCoachPanel() -> some View {
        if let coach = viewModel.visibleBipCoach {
            let readiness = viewModel.bipReadiness ?? BipReadinessState.loading
            if viewModel.sidecarFailureMessage != nil {
                bipCoachSidecarFailurePanel()
            } else if viewModel.bipMissionProgress != nil
                        || coach.currentMission != nil
                        || !coach.pendingMissionChoices.isEmpty
                        || fullCoachReady(coach: coach, readiness: readiness) {
                VStack(alignment: .leading, spacing: 10) {
                    if let expiredMsg = viewModel.bipTokenExpired {
                        tokenExpiredBanner(message: expiredMsg)
                    }

                    switch coach.displayState(
                        hasSidecarFailure: viewModel.sidecarFailureMessage != nil,
                        hasMissionProgress: viewModel.bipMissionProgress != nil
                    ) {
                    case .sidecarFailure:
                        bipCoachSidecarFailurePanel()
                    case .generating:
                        if let progress = viewModel.bipMissionProgress {
                            bipMissionProgressPanel(progress, coach: coach)
                        }
                    case .selectedMission:
                        configuredBipCoachPanel(coach)
                    case .choicesReady:
                        bipMissionChoicesPanel(coach.pendingMissionChoices, coach: coach)
                    case .empty:
                        configuredBipCoachPanel(coach)
                    }

                    if let error = coach.lastError?.nonEmpty {
                        bipCoachErrorBanner(error)
                    }
                }
            } else {
                bipReadinessCard(readiness)
            }
        }
    }

    private func fullCoachReady(coach: BipCoachState, readiness: BipReadinessState) -> Bool {
        coach.isConfigured && readiness.bipCoachSetupComplete && !readiness.hasBlockingBipCoachSetupIssue
    }

    private var bipMissionAccent: Color {
        Agentic30BrandColor.greenBright
    }

    private func missionChoiceAccent(_ index: Int) -> Color {
        switch index {
        case 0:
            return Agentic30BrandColor.greenBright
        case 1:
            return Color(red: 0.54, green: 0.70, blue: 1.0)
        default:
            return Color(red: 0.92, green: 0.76, blue: 0.44)
        }
    }

    private func openMacSettingsWindow() {
        NSApp.activate(ignoringOtherApps: true)
        if !NSApp.sendAction(Selector(("showSettingsWindow:")), to: nil, from: nil) {
            NSApp.sendAction(Selector(("showPreferencesWindow:")), to: nil, from: nil)
        }
    }

    // MARK: - BIP Readiness Card (T8)

    private var bipReadinessPrimaryRowIds: [BipReadinessRowId] {
        BipReadinessRowId.bipCoachSetupCases
    }

    private func bipReadinessPrimaryStepNumber(for id: BipReadinessRowId) -> Int? {
        bipReadinessPrimaryRowIds.firstIndex(of: id).map { $0 + 1 }
    }

    private func bipReadinessCard(_ state: BipReadinessState) -> some View {
        let visibleIds = bipReadinessPrimaryRowIds
        let completedIds = visibleIds.filter { state.row($0).status == .done }
        let currentId = visibleIds.first { state.row($0).status != .done }
        let readinessGroups = bipReadinessGroups

        return VStack(alignment: .leading, spacing: 10) {
            Text("추천 정확도 높이기")
                .font(.system(size: 13, weight: .bold, design: .rounded))
                .foregroundStyle(.white.opacity(0.86))

            Text("오늘 미션은 바로 만들 수 있어요. 아래 기준을 저장하면 문서와 기록을 근거로 더 정확한 후보를 만들 수 있습니다.")
                .font(.system(size: 11, weight: .medium, design: .rounded))
                .foregroundStyle(.white.opacity(0.52))
                .fixedSize(horizontal: false, vertical: true)

            Text(bipReadinessProgressCopy(completedCount: completedIds.count, totalCount: visibleIds.count))
                .font(.system(size: 11, weight: .medium, design: .rounded))
                .foregroundStyle(.white.opacity(0.52))
                .fixedSize(horizontal: false, vertical: true)

            if let currentId {
                bipReadinessCurrentStepView(row: state.row(currentId))
            } else {
                bipReadinessCompleteView()
            }

            bipReadinessResourceReceipts(state)

            if !completedIds.isEmpty {
                bipReadinessCompletedSummary(completedIds)
            }

            bipReadinessGroupSummary(readinessGroups, state: state)

            bipReadinessAdvancedToggle(state)

            Text("전체 준비가 끝나면 Google Doc/Sheet 기록까지 읽는 근거 기반 추천으로 전환됩니다.")
                .font(.system(size: 11, weight: .medium, design: .rounded))
                .foregroundStyle(.white.opacity(0.44))
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(12)
        .background(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .fill(Color.black.opacity(0.11))
                .overlay(
                    RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .stroke(Color.white.opacity(0.09), lineWidth: 1)
                )
        )
    }

    private func bipReadinessProgressCopy(completedCount: Int, totalCount: Int) -> String {
        if completedCount == totalCount {
            return "\(totalCount)/\(totalCount) 완료 · 근거 기반 추천 준비 완료"
        }
        if completedCount == totalCount - 1 {
            return "\(completedCount)/\(totalCount) 완료 · 마지막 한 가지가 추천 정확도를 높여요"
        }
        return "\(completedCount)/\(totalCount) 완료 · 다음 한 가지를 저장하면 추천이 더 좋아져요"
    }

    private func bipReadinessCompleteView() -> some View {
        HStack(alignment: .top, spacing: 9) {
            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(Agentic30BrandColor.greenBright)
                .padding(.top, 1)

            VStack(alignment: .leading, spacing: 4) {
                Text("준비 완료")
                    .font(.system(size: 13, weight: .bold, design: .rounded))
                    .foregroundStyle(.white.opacity(0.90))
                Text("이제 공개 실행 코치가 문서와 Google Doc/Sheet를 읽고 근거 기반 실행 후보를 만들 수 있어요.")
                    .font(.system(size: 11, weight: .medium, design: .rounded))
                    .foregroundStyle(.white.opacity(0.54))
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 13, style: .continuous)
                .fill(Color.white.opacity(0.055))
                .overlay(
                    RoundedRectangle(cornerRadius: 13, style: .continuous)
                        .stroke(Color.white.opacity(0.08), lineWidth: 1)
                )
        )
    }

    private func bipReadinessCurrentStepView(row: BipReadinessRow) -> some View {
        let rowIndex = bipReadinessPrimaryStepNumber(for: row.id)
            ?? ((BipReadinessRowId.allCases.firstIndex(of: row.id) ?? 0) + 1)
        let rowTitle = bipReadinessRowTitle(row.id)
        let isBlocked = row.status == .blocked

        return HStack(alignment: .top, spacing: 9) {
            bipReadinessStatusIcon(for: row.status)
                .padding(.top, 2)

            VStack(alignment: .leading, spacing: 6) {
                Text(isBlocked ? "확인 필요" : "다음 단계")
                    .font(.system(size: 10, weight: .bold, design: .rounded))
                    .foregroundStyle((isBlocked ? Color(red: 1.0, green: 0.67, blue: 0.42) : .white).opacity(0.58))
                    .textCase(.uppercase)

                Text("\(rowIndex). \(rowTitle)")
                    .font(.system(size: 13, weight: .bold, design: .rounded))
                    .foregroundStyle(.white.opacity(0.90))
                    .accessibilityLabel("\(rowIndex)단계, \(rowTitle), \(bipReadinessStatusLabel(row.status))")

                if let detail = row.detail?.nonEmpty {
                    Text(detail)
                        .font(.system(size: 11, weight: .medium, design: .rounded))
                        .foregroundStyle(.white.opacity(0.56))
                        .fixedSize(horizontal: false, vertical: true)
                } else {
                    Text(bipReadinessDefaultDetail(for: row.id))
                        .font(.system(size: 11, weight: .medium, design: .rounded))
                        .foregroundStyle(.white.opacity(0.50))
                        .fixedSize(horizontal: false, vertical: true)
                }

                if let error = row.error, row.status == .blocked {
                    Text(error.userMessage)
                        .font(.system(size: 11, weight: .medium, design: .rounded))
                        .foregroundStyle(Color(red: 1.0, green: 0.67, blue: 0.42).opacity(0.84))
                        .fixedSize(horizontal: false, vertical: true)
                }

                if row.status == .pending || row.status == .blocked {
                    bipReadinessActionButton(row: row)
                }
            }
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 13, style: .continuous)
                .fill(Color.white.opacity(isBlocked ? 0.075 : 0.055))
                .overlay(
                    RoundedRectangle(cornerRadius: 13, style: .continuous)
                        .stroke((isBlocked ? Color(red: 1.0, green: 0.67, blue: 0.42) : .white).opacity(isBlocked ? 0.18 : 0.08), lineWidth: 1)
                )
        )
        .accessibilityIdentifier("bip.readiness.current.\(row.id.rawValue)")
    }

    @ViewBuilder
    private func bipReadinessStatusIcon(for status: BipReadinessStatus) -> some View {
        switch status {
        case .done:
            Image(systemName: "checkmark.circle.fill")
                .foregroundStyle(Agentic30BrandColor.greenBright)
        case .inProgress:
            ProgressView().controlSize(.mini).frame(width: 16, height: 16)
        case .blocked:
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(Color(red: 1.0, green: 0.67, blue: 0.42))
        case .pending:
            Image(systemName: "circle")
                .foregroundStyle(.white.opacity(0.34))
        }
    }

    private func bipReadinessDefaultDetail(for id: BipReadinessRowId) -> String {
        switch id {
        case .localIcp:
            return "오늘 미션의 첫 사용자를 더 정확히 고릅니다. 저장 위치: docs/ICP.md"
        case .localSpec:
            return "오늘 산출물이 어떤 문제를 검증하는지 고정합니다. 저장 위치: docs/SPEC.md"
        case .localDesignSystem:
            return "Mac 작업 화면의 신뢰감과 접근성 기준을 남깁니다. 저장 위치: docs/DESIGN_SYSTEM.md"
        case .localAdr:
            return "중요한 보류/선택 이유를 남겨 같은 논쟁을 줄입니다. 저장 위치: docs/ADR.md"
        case .localGoal:
            return "오늘 미션이 어떤 주간 목표에 기여하는지 연결합니다. 저장 위치: docs/GOAL.md"
        case .localDocs:
            return "Agentic30이 어떤 문서를 근거로 읽을지 알려줍니다. 저장 위치: docs/DOCS.md"
        case .localSheet:
            return "Threads 반응과 배운 점을 다음 추천에 재사용할 표 기준입니다. 저장 위치: docs/SHEET.md"
        case .googleSignIn:
            return "앱 계정 상태예요. Google 문서 연결은 별도 인증으로 확인해요."
        case .workspace:
            return "미션과 설정을 저장할 프로젝트 폴더를 정해요."
        case .gwsInstall:
            return "먼저 이 Mac에 gws CLI가 있는지 확인해요. 이미 있으면 바로 넘어가고, 없을 때만 npm으로 설치해요."
        case .gwsAuth:
            return "저장된 gws 인증을 먼저 확인해요. 아직 유효하면 바로 넘어가고, 필요할 때만 브라우저 로그인을 엽니다."
        case .docUrl:
            return "앱이 업무일지 템플릿을 내 Drive에 복사하고 자동으로 연결해요."
        case .sheetUrl:
            return "앱이 게시글 기록 Sheet를 내 Drive에 복사하고 자동으로 연결해요."
        }
    }

    private func bipReadinessCompletedSummary(_ rowIds: [BipReadinessRowId]) -> some View {
        let titles = rowIds.map(bipReadinessRowTitle).joined(separator: " · ")
        return HStack(spacing: 6) {
            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(Agentic30BrandColor.greenBright.opacity(0.78))
            Text("완료된 준비 \(rowIds.count)개 · \(titles)")
                .font(.system(size: 10, weight: .medium, design: .rounded))
                .foregroundStyle(.white.opacity(0.42))
                .lineLimit(1)
                .truncationMode(.tail)
        }
        .accessibilityLabel("완료된 준비 \(rowIds.count)개")
    }

    @ViewBuilder
    private func bipReadinessResourceReceipts(_ state: BipReadinessState) -> some View {
        let resourceRows = [state.row(.docUrl), state.row(.sheetUrl)].filter {
            $0.status == .done && ($0.resourceName?.nonEmpty != nil || $0.resourceUrl?.nonEmpty != nil)
        }
        if !resourceRows.isEmpty {
            VStack(alignment: .leading, spacing: 6) {
                ForEach(resourceRows, id: \.id) { row in
                    bipReadinessResourceReceipt(row)
                }
            }
            .accessibilityIdentifier("bip.readiness.resourceReceipts")
        }
    }

    private func bipReadinessResourceReceipt(_ row: BipReadinessRow) -> some View {
        let title = row.resourceName?.nonEmpty ?? (row.id == .docUrl ? "Agentic30 업무일지" : "Agentic30 게시글 일지")
        let kind = row.id == .docUrl ? "Doc" : "Sheet"
        return VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Image(systemName: "doc.badge.checkmark")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Agentic30BrandColor.greenBright)
                Text("\(title) 복사 완료")
                    .font(.system(size: 11, weight: .bold, design: .rounded))
                    .foregroundStyle(.white.opacity(0.82))
            }
            Text("내 Google Drive · 공개 실행 코치에 연결됨")
                .font(.system(size: 10, weight: .medium, design: .rounded))
                .foregroundStyle(.white.opacity(0.48))
            HStack(spacing: 8) {
                if let urlString = row.resourceUrl?.nonEmpty, let url = URL(string: urlString) {
                    Button("\(kind) 열기") {
                        NSWorkspace.shared.open(url)
                    }
                    .buttonStyle(.plain)
                    .font(.system(size: 10, weight: .bold, design: .rounded))
                    .foregroundStyle(.white.opacity(0.72))

                    Button("링크 복사") {
                        NSPasteboard.general.clearContents()
                        NSPasteboard.general.setString(urlString, forType: .string)
                    }
                    .buttonStyle(.plain)
                    .font(.system(size: 10, weight: .bold, design: .rounded))
                    .foregroundStyle(.white.opacity(0.56))
                }
            }
        }
        .padding(8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .fill(Color.white.opacity(0.045))
                .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(Color.white.opacity(0.07), lineWidth: 1))
        )
    }

    private var bipReadinessGroups: [BipReadinessGroup] {
        [
            BipReadinessGroup(
                title: "프로젝트 기준",
                ids: [.localIcp, .localSpec, .localGoal, .localAdr]
            ),
            BipReadinessGroup(
                title: "실행 기록",
                ids: [.localDocs, .localSheet, .docUrl, .sheetUrl]
            ),
            BipReadinessGroup(
                title: "신뢰도 강화",
                ids: [.localDesignSystem, .gwsInstall, .gwsAuth]
            ),
        ]
    }

    private func bipReadinessGroupSummary(_ groups: [BipReadinessGroup], state: BipReadinessState) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            ForEach(groups) { group in
                let done = group.ids.filter { state.row($0).status == .done }.count
                HStack(spacing: 7) {
                    Image(systemName: done == group.ids.count ? "checkmark.circle.fill" : "circle.dotted")
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundStyle(done == group.ids.count ? Agentic30BrandColor.greenBright.opacity(0.80) : .white.opacity(0.34))
                    Text(group.title)
                        .font(.system(size: 10, weight: .bold, design: .rounded))
                        .foregroundStyle(.white.opacity(0.54))
                    Text("\(done)/\(group.ids.count)")
                        .font(.system(size: 10, weight: .medium, design: .rounded))
                        .foregroundStyle(.white.opacity(0.36))
                }
            }
        }
        .accessibilityIdentifier("bip.readiness.groupSummary")
    }

    private func bipReadinessPreviewToggle(_ rowIds: [BipReadinessRowId], state: BipReadinessState) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Button {
                withAnimation(.spring(response: 0.26, dampingFraction: 0.86)) {
                    showsBipReadinessPreview.toggle()
                }
            } label: {
                HStack(spacing: 5) {
                    Image(systemName: showsBipReadinessPreview ? "chevron.down" : "chevron.right")
                        .font(.system(size: 9, weight: .bold))
                    Text("다음 단계 미리보기")
                        .font(.system(size: 10, weight: .semibold, design: .rounded))
                    Text("\(rowIds.count)개")
                        .font(.system(size: 10, weight: .medium, design: .rounded))
                        .foregroundStyle(.white.opacity(0.34))
                }
                .foregroundStyle(.white.opacity(0.46))
            }
            .buttonStyle(.plain)
            .accessibilityLabel(showsBipReadinessPreview ? "다음 단계 미리보기 접기" : "다음 단계 미리보기 펼치기")

            if showsBipReadinessPreview {
                VStack(alignment: .leading, spacing: 4) {
                    ForEach(rowIds, id: \.self) { rowId in
                        let rowIndex = bipReadinessPrimaryStepNumber(for: rowId)
                            ?? ((BipReadinessRowId.allCases.firstIndex(of: rowId) ?? 0) + 1)
                        HStack(spacing: 6) {
                            bipReadinessStatusIcon(for: state.row(rowId).status)
                                .font(.system(size: 11))
                                .frame(width: 13, height: 13)
                            Text("\(rowIndex). \(bipReadinessRowTitle(rowId))")
                                .font(.system(size: 10, weight: .medium, design: .rounded))
                                .foregroundStyle(.white.opacity(0.38))
                        }
                    }
                }
                .padding(.leading, 2)
            }
        }
    }

    private func bipReadinessAdvancedToggle(_ state: BipReadinessState) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Button {
                withAnimation(.spring(response: 0.26, dampingFraction: 0.86)) {
                    showsBipReadinessAdvanced.toggle()
                }
            } label: {
                HStack(spacing: 5) {
                    Image(systemName: showsBipReadinessAdvanced ? "chevron.down" : "chevron.right")
                        .font(.system(size: 9, weight: .bold))
                    Text("전체 상태 보기")
                        .font(.system(size: 10, weight: .semibold, design: .rounded))
                }
                .foregroundStyle(.white.opacity(0.32))
            }
            .buttonStyle(.plain)
            .accessibilityLabel(showsBipReadinessAdvanced ? "전체 상태 접기" : "전체 상태 보기")

            if showsBipReadinessAdvanced {
                VStack(alignment: .leading, spacing: 6) {
                    ForEach(bipReadinessPrimaryRowIds, id: \.self) { rowId in
                        bipReadinessRowView(row: state.row(rowId))
                    }
                }
                .padding(.top, 2)
            }
        }
    }

    @ViewBuilder
    private func bipReadinessRowView(row: BipReadinessRow) -> some View {
        let rowIndex = bipReadinessPrimaryStepNumber(for: row.id)
            ?? ((BipReadinessRowId.allCases.firstIndex(of: row.id) ?? 0) + 1)
        let rowTitle = bipReadinessRowTitle(row.id)

        HStack(alignment: .top, spacing: 8) {
            // Status icon
            Group {
                switch row.status {
                case .done:
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundStyle(Agentic30BrandColor.greenBright)
                case .inProgress:
                    ProgressView().controlSize(.mini).frame(width: 16, height: 16)
                case .blocked:
                    Image(systemName: "exclamationmark.triangle.fill")
                        .foregroundStyle(Color(red: 1.0, green: 0.67, blue: 0.42))
                case .pending:
                    Image(systemName: "circle")
                        .foregroundStyle(.white.opacity(0.30))
                }
            }
            .font(.system(size: 14))
            .frame(width: 16, height: 16)
            .padding(.top, 1)

            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    Text("\(rowIndex). \(rowTitle)")
                        .font(.system(size: 12, weight: row.status == .done ? .medium : .semibold, design: .rounded))
                        .foregroundStyle(row.status == .done ? .white.opacity(0.52) : .white.opacity(0.88))
                        .accessibilityLabel("\(rowIndex)단계, \(rowTitle), \(bipReadinessStatusLabel(row.status))")

                    Spacer(minLength: 0)

                    if row.status == .done {
                        Button("수정") {
                            viewModel.sendBipReadinessAction(rowId: row.id, action: "recheck")
                        }
                        .font(.system(size: 10, weight: .medium, design: .rounded))
                        .foregroundStyle(.white.opacity(0.36))
                        .buttonStyle(.plain)
                    }
                }

                if let detail = row.detail?.nonEmpty, row.status != .done {
                    Text(detail)
                        .font(.system(size: 11, weight: .medium, design: .rounded))
                        .foregroundStyle(.white.opacity(0.52))
                }

                if let logLine = row.log?.nonEmpty, row.status == .inProgress {
                    Text(logLine)
                        .font(.system(size: 10, design: .monospaced))
                        .foregroundStyle(.white.opacity(0.38))
                        .lineLimit(2)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }

                if let error = row.error, row.status == .blocked {
                    Text(error.userMessage)
                        .font(.system(size: 11, weight: .medium, design: .rounded))
                        .foregroundStyle(Color(red: 1.0, green: 0.67, blue: 0.42).opacity(0.82))
                        .fixedSize(horizontal: false, vertical: true)
                }

                if row.status == .pending || row.status == .blocked {
                    bipReadinessActionButton(row: row)
                }
            }
        }
        .padding(.vertical, 4)
        .accessibilityIdentifier("bip.readiness.row.\(row.id.rawValue)")
    }

    @ViewBuilder
    private func bipReadinessActionButton(row: BipReadinessRow) -> some View {
        switch row.id {
        case .localIcp, .localSpec, .localDesignSystem, .localAdr, .localGoal, .localDocs, .localSheet:
            bipCoachButton("오늘 미션에 필요한 기준 정하기") {
                viewModel.sendBipReadinessAction(
                    rowId: row.id,
                    action: "start_idd",
                    payload: [:]
                )
            }

        case .googleSignIn, .workspace:
            EmptyView()

        case .gwsInstall:
            bipCoachButton("gws CLI 확인") {
                viewModel.sendBipReadinessAction(
                    rowId: .gwsInstall,
                    action: "install",
                    payload: ["method": "npm"]
                )
            }

        case .gwsAuth:
            bipCoachButton(row.status == .blocked ? "Google 연결 다시 확인" : "Google 연결 확인") {
                viewModel.startGwsAuth()
            }

        case .docUrl:
            bipCoachButton("내 Drive에 복사하고 연결") {
                viewModel.sendBipReadinessAction(
                    rowId: .docUrl,
                    action: "copy_template",
                    payload: [:]
                )
            }

        case .sheetUrl:
            bipCoachButton("내 Drive에 복사하고 연결") {
                viewModel.sendBipReadinessAction(
                    rowId: .sheetUrl,
                    action: "copy_template",
                    payload: [:]
                )
            }
        }
    }

    private func bipReadinessRowTitle(_ id: BipReadinessRowId) -> String {
        switch id {
        case .localIcp: return "누구를 위한 제품인지"
        case .localSpec: return "이번 주 무엇을 만들지"
        case .localDesignSystem: return "화면 원칙"
        case .localAdr: return "기술 결정"
        case .localGoal: return "목표와 지표"
        case .localDocs: return "문서 지도"
        case .localSheet: return "공개 기록 표"
        case .googleSignIn: return "앱 로그인"
        case .workspace: return "프로젝트 폴더"
        case .gwsInstall: return "gws CLI 확인"
        case .gwsAuth: return "Google 연결 확인"
        case .docUrl: return "업무일지 Doc 연결"
        case .sheetUrl: return "SNS(Threads) 게시글 Sheet 연결"
        }
    }

    private func bipReadinessStatusLabel(_ status: BipReadinessStatus) -> String {
        switch status {
        case .pending: return "대기 중"
        case .inProgress: return "진행 중"
        case .done: return "완료됨"
        case .blocked: return "확인 필요"
        }
    }

    // MARK: - Token Expiry Banner (T9)

    private func tokenExpiredBanner(message: String) -> some View {
        HStack(spacing: 10) {
            Image(systemName: "lock.fill")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(Color(red: 1.0, green: 0.67, blue: 0.42))

            VStack(alignment: .leading, spacing: 2) {
                Text("gws 인증이 만료됐어요")
                    .font(.system(size: 12, weight: .bold, design: .rounded))
                    .foregroundStyle(.white.opacity(0.88))
                Text(message)
                    .font(.system(size: 11, weight: .medium, design: .rounded))
                    .foregroundStyle(.white.opacity(0.56))
                    .lineLimit(2)
            }

            Spacer(minLength: 0)

            Button("gws 다시 인증") {
                viewModel.clearBipTokenExpired()
                viewModel.startGwsAuth()
            }
            .font(.system(size: 11, weight: .bold, design: .rounded))
            .foregroundStyle(Color(red: 1.0, green: 0.67, blue: 0.42))
            .buttonStyle(.plain)
            .accessibilityLabel("Google Workspace 재인증하기")
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(Color(red: 1.0, green: 0.67, blue: 0.42).opacity(0.10))
                .overlay(
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .stroke(Color(red: 1.0, green: 0.67, blue: 0.42).opacity(0.22), lineWidth: 1)
                )
        )
        .accessibilityIdentifier("bip.tokenExpiredBanner")
    }

    private func bipCoachSidecarFailurePanel() -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(Color(red: 1.0, green: 0.67, blue: 0.42).opacity(0.92))
                    .frame(width: 24, height: 24)
                    .background(Circle().fill(Color(red: 1.0, green: 0.67, blue: 0.42).opacity(0.12)))

                VStack(alignment: .leading, spacing: 4) {
                    Text("미션 생성 준비가 멈췄어요")
                        .font(.system(size: 15, weight: .bold, design: .rounded))
                        .foregroundStyle(.white.opacity(0.92))
                    Text(sidecarFailureDetailText())
                        .font(.system(size: 12, weight: .medium, design: .rounded))
                        .foregroundStyle(.white.opacity(0.56))
                        .lineLimit(2)
                        .fixedSize(horizontal: false, vertical: true)
                }

                Spacer(minLength: 0)
            }

            HStack(spacing: 8) {
                Button {
                    viewModel.reconnectSidecar()
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "arrow.clockwise")
                            .font(.system(size: 11, weight: .bold))
                        Text("다시 연결")
                            .font(.system(size: 12, weight: .bold, design: .rounded))
                    }
                    .foregroundStyle(Color.black.opacity(0.76))
                    .padding(.horizontal, 12)
                    .frame(height: 30)
                    .background(Capsule().fill(Color(red: 1.0, green: 0.67, blue: 0.42).opacity(0.92)))
                    .accessibilityIdentifier("workspace.bipCoach.retrySidecar")
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("workspace.bipCoach.retrySidecar")
                .accessibilityLabel("Sidecar 다시 연결")

                bipCoachButton("설정 열기") {
                    openMacSettingsWindow()
                }
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(Color(red: 1.0, green: 0.67, blue: 0.42).opacity(0.08))
                .overlay(
                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .stroke(Color(red: 1.0, green: 0.67, blue: 0.42).opacity(0.18), lineWidth: 1)
                )
        )
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("workspace.bipCoach.sidecarFailure")
        .accessibilityLabel("미션 생성 준비가 멈췄어요")
    }

    private func sidecarFailureDetailText() -> String {
        if let message = viewModel.sidecarFailureMessage?.nonEmpty {
            return message
        }
        return "Sidecar 연결이 끊겨 오늘 미션과 근거를 불러올 수 없습니다."
    }

    private func bipCoachErrorBanner(_ error: String) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(Color(red: 1.0, green: 0.67, blue: 0.42).opacity(0.90))
                .padding(.top, 1)

            VStack(alignment: .leading, spacing: 2) {
                Text("연결 확인 필요")
                    .font(.system(size: 11, weight: .bold, design: .rounded))
                    .foregroundStyle(.white.opacity(0.82))
                Text(error)
                    .font(.system(size: 11, weight: .medium, design: .rounded))
                    .foregroundStyle(.white.opacity(0.56))
                    .lineLimit(3)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(Color(red: 1.0, green: 0.67, blue: 0.42).opacity(0.08))
                .overlay(
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .stroke(Color(red: 1.0, green: 0.67, blue: 0.42).opacity(0.16), lineWidth: 1)
                )
        )
        .accessibilityIdentifier("bip.coachError")
    }

    private func bipMissionChoicesPanel(_ choices: [BipCoachMission], coach: BipCoachState) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top, spacing: 10) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("오늘 미션 후보 3개가 준비됐어요")
                        .font(.system(size: 15, weight: .bold, design: .rounded))
                        .foregroundStyle(.white.opacity(0.94))
                    Text("하나만 고르면 실행 코치 모드로 이어집니다.")
                        .font(.system(size: 12, weight: .semibold, design: .rounded))
                        .foregroundStyle(.white.opacity(0.58))
                        .fixedSize(horizontal: false, vertical: true)
                }

                Spacer(minLength: 0)

                Text("\(min(choices.count, 3))개 후보")
                    .font(.system(size: 11, weight: .bold, design: .rounded))
                    .foregroundStyle(Agentic30BrandColor.greenBright.opacity(0.92))
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(Capsule().fill(Agentic30BrandColor.greenBright.opacity(0.12)))
            }

            Text("근거: \(bipMissionChoicesEvidenceSummary(coach))")
                .font(.system(size: 11, weight: .medium, design: .rounded))
                .foregroundStyle(.white.opacity(0.52))
                .lineLimit(2)
                .fixedSize(horizontal: false, vertical: true)

            VStack(alignment: .leading, spacing: 8) {
                ForEach(Array(choices.prefix(3).enumerated()), id: \.element.id) { index, mission in
                    bipCoachMissionChoiceCard(mission, index: index)
                }
            }

            HStack(spacing: 8) {
                bipCoachButton("다시 만들기") {
                    viewModel.generateBipMission(curriculumDay: curriculumPayload(for: workspaceOpenDesignDay))
                }
                .disabled(viewModel.isBipCoachRefreshing || viewModel.isBipCoachGenerating)

                bipCoachButton("15분 미션으로 줄이기") {
                    viewModel.generateBipMission(compact: true, curriculumDay: curriculumPayload(for: workspaceOpenDesignDay))
                }
                .disabled(viewModel.isBipCoachRefreshing || viewModel.isBipCoachGenerating)
            }
        }
        .padding(12)
        .background(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .fill(Color.black.opacity(0.11))
                .overlay(
                    RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .stroke(Color.white.opacity(0.09), lineWidth: 1)
                )
        )
        .accessibilityIdentifier("workspace.bipCoach.missionChoices")
    }

    private func bipCoachMissionChoiceCard(_ mission: BipCoachMission, index: Int) -> some View {
        Button {
            viewModel.selectBipMission(mission)
        } label: {
            HStack(alignment: .top, spacing: 10) {
                Text(index == 0 ? "추천" : "\(index + 1)")
                    .font(.system(size: 10, weight: .heavy, design: .rounded))
                    .foregroundStyle(Color.black.opacity(0.70))
                    .padding(.horizontal, index == 0 ? 8 : 0)
                    .frame(minWidth: 24, minHeight: 24)
                    .background(Capsule().fill(missionChoiceAccent(index).opacity(0.92)))

                VStack(alignment: .leading, spacing: 6) {
                    Text(mission.title?.nonEmpty ?? "오늘 미션")
                        .font(.system(size: 13, weight: .heavy, design: .rounded))
                        .foregroundStyle(.white.opacity(0.94))
                        .lineLimit(2)

                    Text(missionRecommendationReason(mission, index: index))
                        .font(.system(size: 11, weight: .bold, design: .rounded))
                        .foregroundStyle(.white.opacity(0.68))
                        .lineLimit(2)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityIdentifier("bip.missionChoice.recommendationReason")

                    if let missionText = mission.mission?.nonEmpty {
                        Text(missionText)
                            .font(.system(size: 11, weight: .medium, design: .rounded))
                            .foregroundStyle(.white.opacity(0.50))
                            .lineLimit(1)
                    }

                    bipMissionChoiceMetaRow(
                        text: missionEvidencePreview(mission),
                        systemImage: "quote.bubble.fill",
                        identifier: "bip.missionChoice.evidence"
                    )

                    bipMissionChoiceMetaRow(
                        text: "결과물: \(missionOutcomePreview(mission))",
                        systemImage: "checkmark.circle.fill",
                        identifier: "bip.missionChoice.outcome"
                    )

                    HStack(spacing: 8) {
                        Label("15분", systemImage: "timer")
                        Label("선택 후 초안 요청 가능", systemImage: "text.bubble")
                    }
                    .font(.system(size: 10, weight: .bold, design: .rounded))
                    .foregroundStyle(.white.opacity(0.46))
                    .lineLimit(1)
                }

                Spacer(minLength: 0)

                HStack(spacing: 5) {
                    Text("이 미션으로 시작")
                        .font(.system(size: 11, weight: .bold, design: .rounded))
                    Image(systemName: "arrow.right")
                        .font(.system(size: 10, weight: .heavy))
                }
                .foregroundStyle(.white.opacity(0.86))
                .padding(.horizontal, 10)
                .frame(height: 28)
                .background(Capsule().fill(Color.white.opacity(0.11)))
                .accessibilityIdentifier("bip.missionChoice.primaryAction")
            }
            .padding(12)
            .background(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .fill(Color.white.opacity(index == 0 ? 0.075 : 0.055))
                    .overlay(
                        RoundedRectangle(cornerRadius: 12, style: .continuous)
                            .stroke(index == 0 ? bipMissionAccent.opacity(0.18) : Color.white.opacity(0.09), lineWidth: 1)
                    )
            )
            .contentShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("workspace.bipCoach.missionChoice.\(index + 1)")
        .accessibilityLabel("\(mission.title?.nonEmpty ?? "오늘 실행 \(index + 1)") 이 미션으로 시작")
    }

    private func bipMissionChoiceMetaRow(text: String, systemImage: String, identifier: String) -> some View {
        HStack(alignment: .top, spacing: 6) {
            Image(systemName: systemImage)
                .font(.system(size: 9, weight: .bold))
                .foregroundStyle(bipMissionAccent.opacity(0.72))
                .frame(width: 12)
                .padding(.top, 1)
            Text(text)
                .font(.system(size: 10, weight: .semibold, design: .rounded))
                .foregroundStyle(.white.opacity(0.48))
                .lineLimit(1)
        }
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier(identifier)
    }

    private func missionRecommendationReason(_ mission: BipCoachMission, index: Int) -> String {
        if let angle = mission.angle?.nonEmpty {
            return "추천 이유: \(angle)"
        }
        if index == 0 {
            return "추천 이유: 지금 가장 작게 실행하고 바로 배울 수 있습니다."
        }
        return "추천 이유: 프로젝트와 오늘 커리큘럼에 맞춘 실행입니다."
    }

    private func missionEvidencePreview(_ mission: BipCoachMission) -> String {
        if let firstEvidence = mission.evidenceRefs?.compactMap(\.nonEmpty).first {
            return "근거: \(firstEvidence)"
        }
        if let day = mission.curriculumDay?.day {
            return "근거: 프로젝트 폴더와 Day \(day) 커리큘럼"
        }
        return "근거: 프로젝트 폴더와 오늘 커리큘럼"
    }

    private func missionOutcomePreview(_ mission: BipCoachMission) -> String {
        if let firstChecklist = mission.eveningChecklist?.compactMap(\.nonEmpty).first {
            return firstChecklist
        }
        if mission.drafts?.isEmpty == false {
            return "초안 하나를 만들고 바로 실행"
        }
        return "배움 하나와 다음 액션 하나 기록"
    }

    private func bipMissionChoicesEvidenceSummary(_ coach: BipCoachState) -> String {
        if let evidence = coach.evidence {
            return evidenceReceiptSummary(evidence)
        }
        return "연결된 Sheet와 업무일지 Doc"
    }

    private func configuredBipCoachPanel(_ coach: BipCoachState) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(coach.currentMission?.status == "completed" ? "오늘 미션이 완료됐어요." : "오늘은 이 흐름으로 진행하면 됩니다.")
                .font(.system(size: 13, weight: .semibold, design: .rounded))
                .foregroundStyle(.white.opacity(0.76))

            if let mission = coach.currentMission {
                missionSuggestionCard(mission, coach: coach)
            } else {
                Text("아직 오늘 미션이 없습니다. Assistant가 Docs와 Sheet 기록을 보고 하나로 정리할 수 있어요.")
                    .font(.system(size: 14, weight: .semibold, design: .rounded))
                    .foregroundStyle(.white.opacity(0.86))
            }

            if coach.currentMission == nil {
                bipCoachButton(bipMissionButtonTitle()) {
                    viewModel.generateBipMission(curriculumDay: curriculumPayload(for: workspaceOpenDesignDay))
                }
                .disabled(viewModel.isBipCoachRefreshing || viewModel.isBipCoachGenerating)
            }
        }
    }

    private func bipMissionButtonTitle() -> String {
        guard let progress = viewModel.bipMissionProgress else {
            return "오늘 미션 만들기"
        }
        switch progress.stage {
        case "reading_sheet", "reading_doc":
            return "근거 읽는 중..."
        case "generating":
            return "미션 생성 중..."
        case "finalizing":
            return "근거 정리 중..."
        default:
            return "진행 중..."
        }
    }

    private func bipMissionProgressPanel(_ progress: BipMissionProgress, coach: BipCoachState) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                ProgressView().controlSize(.mini)
                Text("오늘 미션을 만드는 중")
                    .font(.system(size: 12, weight: .bold, design: .rounded))
                    .foregroundStyle(.white.opacity(0.86))
                Spacer(minLength: 0)
                if let status = bipMissionProgressStatusLabel(progress) {
                    Text(status)
                        .font(.system(size: 10, weight: .medium, design: .rounded))
                        .foregroundStyle(.white.opacity(0.42))
                }
            }

            VStack(alignment: .leading, spacing: 5) {
                progressLine("Google Sheet 전체 확인 중", step: .readingSheet, progress: progress, suffix: progress.sheetRowsRead.map { "완료, 전체 \($0)개 행" })
                progressLine("업무일지 Doc 확인 중", step: .readingDoc, progress: progress, suffix: progress.docCharsRead.map { "완료, \($0)자 사용" })
                progressLine("미션 후보 생성 중", step: .generating, progress: progress, suffix: progress.provider?.nonEmpty)
                progressLine("근거 정리 중", step: .finalizing, progress: progress, suffix: nil)
            }

            if let evidence = coach.evidence {
                Text("읽은 근거: \(evidenceReceiptSummary(evidence))")
                    .font(.system(size: 10, weight: .medium, design: .rounded))
                    .foregroundStyle(.white.opacity(0.48))
                    .fixedSize(horizontal: false, vertical: true)
            } else if let detail = progress.detail?.nonEmpty {
                Text(detail)
                    .font(.system(size: 10, weight: .medium, design: .rounded))
                    .foregroundStyle(.white.opacity(0.48))
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(10)
        .background(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(Color.black.opacity(0.12))
                .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(Color.white.opacity(0.08), lineWidth: 1))
        )
        .accessibilityIdentifier("bip.missionProgress")
    }

    private func bipMissionProgressStatusLabel(_ progress: BipMissionProgress) -> String? {
        if progress.stage == "generating" {
            let provider = progress.provider.flatMap(AgentProvider.init(rawValue:))?.title
                ?? progress.provider?.nonEmpty
                ?? "Agent"
            return "\(provider) 응답 대기 중"
        }
        guard let elapsed = progress.elapsedMs, elapsed >= 5_000 else {
            return nil
        }
        return "약 \(max(1, elapsed / 1000))초 진행 중"
    }

    private func progressLine(_ title: String, step: BipMissionProgressStep, progress: BipMissionProgress, suffix: String?) -> some View {
        let isActive = progress.isActive(step)
        let isComplete = progress.isComplete(step)

        return HStack(spacing: 7) {
            Image(systemName: isComplete ? "checkmark.circle.fill" : (isActive ? "circle.dotted" : "circle"))
                .font(.system(size: 10, weight: .semibold))
                .foregroundStyle(isComplete ? Agentic30BrandColor.greenBright.opacity(0.82) : .white.opacity(isActive ? 0.64 : 0.28))
            Text(title)
                .font(.system(size: 10, weight: .medium, design: .rounded))
                .foregroundStyle(.white.opacity(isActive ? 0.68 : (isComplete ? 0.58 : 0.42)))
            Spacer(minLength: 0)
            if let suffix {
                Text(suffix)
                    .font(.system(size: 10, weight: .medium, design: .rounded))
                    .foregroundStyle(.white.opacity(0.42))
                    .lineLimit(1)
            }
        }
    }

    private func bipCompletionCard(mission: BipCoachMission, isCompact: Bool = false) -> some View {
        VStack(alignment: .leading, spacing: isCompact ? 6 : 9) {
            HStack(alignment: .center, spacing: 8) {
                Image(systemName: "sparkles")
                    .font(.system(size: isCompact ? 12 : 14, weight: .heavy))
                    .foregroundStyle(Color.black.opacity(0.72))
                    .frame(width: isCompact ? 24 : 28, height: isCompact ? 24 : 28)
                    .background(Circle().fill(Agentic30BrandColor.greenBright.opacity(0.94)))

                Text(bipCompletionTitle(for: mission))
                    .font(.system(size: isCompact ? 14 : 17, weight: .heavy, design: .rounded))
                    .foregroundStyle(Agentic30BrandColor.greenBright.opacity(0.96))
                    .accessibilityIdentifier("bip.completionCard.title")
            }

            Text(bipCompletionEncouragement(for: mission))
                .font(.system(size: isCompact ? 12 : 13, weight: .semibold, design: .rounded))
                .foregroundStyle(.white.opacity(0.72))
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("bip.completionCard.encouragement")

            if let questionCountLabel = mission.completionQuestionCountLabel {
                Text(questionCountLabel)
                    .font(.system(size: isCompact ? 12 : 11, weight: .bold, design: .rounded))
                    .foregroundStyle(.white.opacity(0.64))
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("bip.completionCard.questionCount")
            }

            if let teaser = mission.curriculumDay?.completionNextDayTeaser,
               OpenDesignReferenceRoutePolicy.supportsOpenDesignDay(dayNumber: mission.curriculumDay?.day ?? 0) {
                Text(teaser)
                    .font(.system(size: isCompact ? 11 : 10, weight: .semibold, design: .rounded))
                    .foregroundStyle(.white.opacity(0.46))
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("bip.completionCard.nextDayTeaser")
            }

            Text([mission.threadsUrl?.nonEmpty, mission.sheetRowNote?.nonEmpty].compactMap { $0 }.joined(separator: " · ").nonEmpty ?? "기록이 저장됐습니다.")
                .font(.system(size: isCompact ? 12 : 11, weight: .semibold, design: .rounded))
                .foregroundStyle(.white.opacity(0.58))
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(isCompact ? 0 : 12)
        .background {
            if !isCompact {
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .fill(Agentic30BrandColor.greenBright.opacity(0.10))
                    .overlay(
                        RoundedRectangle(cornerRadius: 14, style: .continuous)
                            .stroke(Agentic30BrandColor.greenBright.opacity(0.16), lineWidth: 1)
                    )
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(isCompact ? "bip.completionSummary" : "bip.completionCard")
    }

    private func bipCompletionTitle(for mission: BipCoachMission) -> String {
        if let day = mission.curriculumDay?.day {
            return "Day \(day) 완료"
        }
        return "오늘 실행 완료"
    }

    private func bipCompletionEncouragement(for mission: BipCoachMission) -> String {
        if mission.curriculumDay?.day != nil {
            return "이 근거로 다음 실행을 더 정확히 이어갈게요."
        }
        return "오늘 기록이 다음 실행의 근거가 됩니다."
    }

    private func missionSuggestionCard(_ mission: BipCoachMission, coach: BipCoachState) -> some View {
        VStack(alignment: .leading, spacing: 9) {
            if mission.status == "completed" {
                bipCompletionCard(mission: mission)
            }

            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(coach.currentMission?.status == "completed" ? "완료된 미션" : "오늘 미션")
                    .font(.system(size: 15, weight: .bold, design: .rounded))
                    .foregroundStyle(.white.opacity(0.94))
                Spacer(minLength: 0)
                Text("연속 \(coach.streak.current)일")
                    .font(.system(size: 11, weight: .bold, design: .rounded))
                    .foregroundStyle(Agentic30BrandColor.greenBright.opacity(0.92))
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(Capsule().fill(Agentic30BrandColor.greenBright.opacity(0.12)))
            }

            Text(mission.title?.nonEmpty ?? "오늘 실행")
                .font(.system(size: 16, weight: .bold, design: .rounded))
                .foregroundStyle(.white.opacity(0.96))
                .lineLimit(2)

            if let missionText = mission.mission?.nonEmpty {
                Text(missionText)
                    .font(.system(size: 13, weight: .semibold, design: .rounded))
                    .foregroundStyle(.white.opacity(0.78))
                    .lineLimit(2)
            } else if let angle = mission.angle?.nonEmpty {
                Text(angle)
                    .font(.system(size: 12, weight: .medium, design: .rounded))
                    .foregroundStyle(.white.opacity(0.58))
                    .lineLimit(2)
            }

            Text(evidenceSummaryText(for: mission, coach: coach))
                .font(.system(size: 11, weight: .medium, design: .rounded))
                .foregroundStyle(.white.opacity(0.54))
                .lineLimit(showsBipMissionEvidence ? nil : 1)
                .fixedSize(horizontal: false, vertical: showsBipMissionEvidence)

            if showsBipMissionEvidence {
                missionEvidenceDetails(mission, coach: coach)
            }

            HStack(spacing: 8) {
                if mission.status == "completed" {
                    bipCoachButton("완료됨") {}
                        .disabled(true)
                } else {
                    bipCoachButton(showsBipCompletionFields ? "입력 닫기" : "Threads 반응 입력") {
                        withAnimation(.spring(response: 0.26, dampingFraction: 0.86)) {
                            showsBipCompletionFields.toggle()
                        }
                    }
                    .disabled(viewModel.isBipCoachCompleting)
                }

                Menu {
                    Button(showsBipMissionEvidence ? "근거 접기" : "근거 보기") {
                        withAnimation(.spring(response: 0.26, dampingFraction: 0.86)) {
                            showsBipMissionEvidence.toggle()
                        }
                    }
                    Button("근거 새로고침") {
                        viewModel.refreshBipCoachEvidence()
                    }
                    Button("다른 미션 만들기") {
                        viewModel.generateBipMission(curriculumDay: curriculumPayload(for: workspaceOpenDesignDay))
                    }
                    Button("15분 관찰글로 줄이기") {
                        viewModel.generateBipMission(compact: true, curriculumDay: curriculumPayload(for: workspaceOpenDesignDay))
                    }
                    Button("초안 작성하기") {
                        beginBipMission(mission)
                    }
                } label: {
                    Image(systemName: "ellipsis")
                        .font(.system(size: 13, weight: .bold))
                        .foregroundStyle(.white.opacity(0.7))
                        .frame(width: 30, height: 30)
                        .background(
                            Circle()
                                .fill(Color.white.opacity(0.08))
                                .overlay(Circle().stroke(Color.white.opacity(0.08), lineWidth: 1))
                        )
                }
                .menuStyle(.button)
                .buttonStyle(.plain)
                .disabled(viewModel.isBipCoachRefreshing || viewModel.isBipCoachGenerating)
                .accessibilityLabel("Mission options")
            }

            if showsBipCompletionFields && mission.status != "completed" {
                bipCompletionFields()
            }
        }
        .padding(12)
        .background(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .fill(Color.black.opacity(0.11))
                .overlay(
                    RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .stroke(Color.white.opacity(0.09), lineWidth: 1)
                )
        )
    }

    private func bipCompletionFields() -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("게시 기록 자동 확인")
                .font(.system(size: 12, weight: .bold, design: .rounded))
                .foregroundStyle(.white.opacity(0.72))

            HStack(alignment: .center, spacing: 8) {
                Image(systemName: "checkmark.seal.fill")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Agentic30BrandColor.greenBright.opacity(0.92))
                Text("연결된 Google Sheet 기록을 다시 읽고, 확인된 최신 행으로 오늘 미션을 닫습니다.")
                    .font(.system(size: 11, weight: .semibold, design: .rounded))
                    .foregroundStyle(.white.opacity(0.58))
                    .fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 0)
                bipCompletionSubmitButton()
            }

            if let error = viewModel.visibleBipCoach?.lastError?.nonEmpty {
                Text(error)
                    .font(.system(size: 11, weight: .semibold, design: .rounded))
                    .foregroundStyle(Color(red: 1.0, green: 0.67, blue: 0.42).opacity(0.90))
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("assistant.bipCompletionError")
            }
        }
        .padding(10)
        .background(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(Color.black.opacity(0.12))
        )
    }

    private func bipCompletionSubmitButton() -> some View {
        Button {
            submitBipCompletion()
        } label: {
            HStack(spacing: 6) {
                if viewModel.isBipCoachCompleting {
                    ProgressView()
                        .controlSize(.mini)
                        .frame(width: 12, height: 12)
                }
                Text(viewModel.isBipCoachCompleting ? "저장 중..." : "기록 완료")
                    .font(.system(size: 12, weight: .bold, design: .rounded))
            }
            .foregroundStyle(.white.opacity(bipCompletionSubmitDisabled ? 0.44 : 0.9))
            .padding(.horizontal, 12)
            .frame(height: 36)
            .background(Capsule().fill(Color.white.opacity(bipCompletionSubmitDisabled ? 0.07 : 0.14)))
        }
        .buttonStyle(.plain)
        .disabled(bipCompletionSubmitDisabled)
        .accessibilityIdentifier("assistant.completeBipMission")
        .accessibilityLabel("기록 완료")
    }

    private var bipCompletionSubmitDisabled: Bool {
        viewModel.isBipCoachCompleting
    }

    private func submitBipCompletion() {
        viewModel.completeBipMission()
    }

    private func missionEvidenceDetails(_ mission: BipCoachMission, coach: BipCoachState) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            ForEach(Array(evidenceLines(for: mission, coach: coach).prefix(4).enumerated()), id: \.offset) { _, line in
                Text("- \(line)")
                    .font(.system(size: 11, weight: .medium, design: .rounded))
                    .foregroundStyle(.white.opacity(0.58))
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private func evidenceSummaryText(for mission: BipCoachMission, coach: BipCoachState) -> String {
        if let evidence = coach.evidence {
            return "읽은 근거: \(evidenceReceiptSummary(evidence))"
        }
        if let refs = mission.evidenceRefs, !refs.isEmpty {
            return "근거: \(refs.prefix(3).joined(separator: " · "))"
        }
        return "근거: Threads 반응 · 팔로워 변화 · 공개 기록"
    }

    private func evidenceReceiptSummary(_ evidence: BipCoachEvidence) -> String {
        var parts: [String] = []
        if evidence.source == "agent_gws" {
            parts.append("Agent가 gws로 전체 확인")
        }
        if let rows = evidence.sheetRowsRead ?? evidence.allRows?.count ?? evidence.recentRows?.count {
            let title = evidence.sheetTitle?.nonEmpty ?? "Sheet"
            parts.append("\(title) 전체 \(rows)개 행")
        }
        if let chars = evidence.docCharsRead {
            let title = evidence.docTitle?.nonEmpty ?? "Doc"
            parts.append("\(title) \(chars)자")
        }
        if evidence.docWasTruncated == true {
            parts.append("불완전한 이전 근거")
        }
        if let provider = evidence.provider?.nonEmpty {
            parts.append(AgentProvider(rawValue: provider)?.title ?? provider)
        }
        if evidence.fallbackUsed == true {
            parts.append("fallback 사용")
        }
        if parts.isEmpty, let summary = evidence.summary?.nonEmpty {
            parts.append(summary)
        }
        return parts.isEmpty ? "연결된 Docs/Sheets 기록" : parts.joined(separator: " · ")
    }

    private func evidenceLines(for mission: BipCoachMission, coach: BipCoachState) -> [String] {
        var lines: [String] = []
        if let refs = mission.evidenceRefs {
            lines.append(contentsOf: refs)
        }
        if let summary = coach.evidence?.summary?.nonEmpty {
            lines.append(summary)
        }
        if let evidence = coach.evidence {
            lines.append(evidenceReceiptSummary(evidence))
            if evidence.docWasTruncated == true {
                lines.append("이전 버전에서 만든 불완전한 근거입니다. 전체 근거로 미션을 다시 생성해야 합니다.")
            }
        }
        if let rows = coach.evidence?.allRows ?? coach.evidence?.recentRows, let latest = rows.last {
            let date = latest.date?.nonEmpty ?? "최근 기록"
            let followers = latest.followers?.nonEmpty.map { "팔로워 \($0)" }
            lines.append([date, followers].compactMap { $0 }.joined(separator: ", "))
        }
        if let excerpt = coach.evidence?.docExcerpt?.nonEmpty {
            lines.append(excerpt)
        }
        return lines.isEmpty ? ["연결된 Docs/Sheets 기록을 기준으로 미션을 만들었습니다."] : lines
    }

    private func beginBipMission(_ mission: BipCoachMission) {
        let title = mission.title?.nonEmpty ?? "오늘 실행"
        viewModel.draft = "/bip-draft \(title)"
        if viewModel.canSend {
            viewModel.sendPrompt()
        }
    }

    private func bipCoachButton(_ title: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .font(.system(size: 11, weight: .bold, design: .rounded))
                .foregroundStyle(.white.opacity(0.78))
                .padding(.horizontal, 10)
                .frame(height: 30)
                .background(
                    Capsule()
                        .fill(Color.white.opacity(0.08))
                        .overlay(
                            Capsule()
                                .stroke(Color.white.opacity(0.08), lineWidth: 1)
                        )
                )
        }
        .buttonStyle(.plain)
    }

    private func inlineStructuredPromptIntro(for session: ChatSession) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("다음 작업을 선택하세요")
                .font(.system(size: 17, weight: .bold, design: .rounded))
                .foregroundStyle(.white.opacity(0.96))
        }
    }

    private func inlineStructuredPrompt(
        _ prompt: StructuredPromptRequest,
        compact: Bool = false,
        submissionState: AgenticViewModel.StructuredPromptSubmissionState? = nil
    ) -> some View {
        let isSubmitting = submissionState?.requestId == prompt.requestId
        let canSubmitPrompt = canSubmit(prompt) && !isSubmitting
        let submitTitle = isSubmitting
            ? (compact ? "저장 중" : "저장 중...")
            : (compact ? "답하기" : structuredPromptSubmitTitle(prompt))

        return VStack(alignment: .leading, spacing: compact ? 10 : 14) {
            if !compact {
                Text(prompt.title?.nonEmpty ?? "Office Hours intake")
                    .font(.system(size: 15, weight: .bold, design: .rounded))
                    .foregroundStyle(.white.opacity(0.9))
                    .accessibilityIdentifier("assistant.structuredPromptTitle")
            }

            if !compact {
                structuredPromptContext(prompt)
            }

            VStack(alignment: .leading, spacing: compact ? 8 : 12) {
                ForEach(prompt.questions) { question in
                    questionCard(question, prompt: prompt, compact: compact, isSubmitting: isSubmitting)
                        .transition(.opacity)
                }
            }
            .padding(.vertical, 2)
            .animation(.easeInOut(duration: 0.16), value: prompt.requestId)

            if let submissionState, isSubmitting, !compact {
                structuredPromptSubmissionReceipt(submissionState, compact: compact)
            }

            HStack(spacing: 12) {
                Spacer(minLength: 0)

                Button {
                    if !isSubmitting {
                        submitPrompt(prompt)
                    }
                } label: {
                    HStack(spacing: 7) {
                        if isSubmitting {
                            ProgressView()
                                .controlSize(.mini)
                                .scaleEffect(0.72)
                        }
                        Text(submitTitle)
                    }
                    .font(.system(size: 14, weight: .bold, design: .rounded))
                    .foregroundStyle(.white.opacity(canSubmitPrompt ? 0.96 : 0.42))
                    .padding(.horizontal, 18)
                    .padding(.vertical, 10)
                    .background(
                        Capsule()
                            .fill(Color.white.opacity(canSubmitPrompt ? 0.18 : 0.07))
                    )
                }
                .buttonStyle(.plain)
                .disabled(!canSubmitPrompt)
                .accessibilityIdentifier("assistant.structuredContinueButton")
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("assistant.structuredPrompt")
    }

    @ViewBuilder
    private func structuredPromptContext(_ prompt: StructuredPromptRequest) -> some View {
        let introTitle = prompt.intro?.title?.trimmingCharacters(in: .whitespacesAndNewlines)
        let introBody = prompt.intro?.body?.trimmingCharacters(in: .whitespacesAndNewlines)
        let bullets = (prompt.intro?.bullets ?? [])
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
        let resources = (prompt.resources ?? []).filter { !$0.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

        if introTitle?.isEmpty == false || introBody?.isEmpty == false || !bullets.isEmpty || !resources.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                if let introTitle, !introTitle.isEmpty {
                    Text(introTitle)
                        .font(.system(size: 13, weight: .bold, design: .rounded))
                        .foregroundStyle(Color(red: 0.82, green: 0.89, blue: 1.0).opacity(0.94))
                }

                if let introBody, !introBody.isEmpty {
                    Text(introBody)
                        .font(.system(size: 12, weight: .medium, design: .rounded))
                        .foregroundStyle(.white.opacity(0.66))
                        .fixedSize(horizontal: false, vertical: true)
                }

                if !bullets.isEmpty {
                    VStack(alignment: .leading, spacing: 4) {
                        ForEach(bullets, id: \.self) { bullet in
                            HStack(alignment: .top, spacing: 7) {
                                Text("•")
                                    .font(.system(size: 12, weight: .bold, design: .rounded))
                                    .foregroundStyle(.white.opacity(0.42))
                                Text(bullet)
                                    .font(.system(size: 11, weight: .medium, design: .rounded))
                                    .foregroundStyle(.white.opacity(0.58))
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                        }
                    }
                }

                if !resources.isEmpty {
                    VStack(alignment: .leading, spacing: 5) {
                        Text("추천 리소스")
                            .font(.system(size: 11, weight: .bold, design: .rounded))
                            .foregroundStyle(.white.opacity(0.58))

                        ForEach(resources) { resource in
                            if let url = URL(string: resource.url) {
                                Link(destination: url) {
                                    HStack(spacing: 6) {
                                        Image(systemName: "link")
                                            .font(.system(size: 10, weight: .bold))
                                        Text(resource.title)
                                            .font(.system(size: 11, weight: .semibold, design: .rounded))
                                            .lineLimit(1)
                                        if let source = resource.source?.nonEmpty {
                                            Text(source)
                                                .font(.system(size: 10, weight: .medium, design: .rounded))
                                                .foregroundStyle(.white.opacity(0.42))
                                                .lineLimit(1)
                                        }
                                    }
                                    .foregroundStyle(.white.opacity(0.74))
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }
                    .padding(.top, 2)
                }
            }
            .padding(.vertical, 3)
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityIdentifier("assistant.structuredPromptContext")
        }
    }

    private func structuredPromptSubmitTitle(_ prompt: StructuredPromptRequest) -> String {
        if prompt.title?.contains("첫") == true {
            return "이걸로 시작"
        }
        return "다음 질문"
    }

    private func submissionState(for prompt: StructuredPromptRequest) -> AgenticViewModel.StructuredPromptSubmissionState? {
        guard let state = viewModel.structuredPromptSubmissionState(for: prompt.sessionId),
              state.requestId == prompt.requestId else { return nil }
        return state
    }

    private func structuredPromptSubmissionReceipt(
        _ state: AgenticViewModel.StructuredPromptSubmissionState,
        compact: Bool
    ) -> some View {
        VStack(alignment: .leading, spacing: compact ? 3 : 5) {
            Text(state.progressText?.nonEmpty ?? "답변 저장 중: \(state.answerSummary)")
                .font(.system(size: compact ? 11 : 12, weight: .semibold, design: .rounded))
                .foregroundStyle(.white.opacity(0.66))
                .lineLimit(2)
                .fixedSize(horizontal: false, vertical: true)

            if !compact, state.progressText?.nonEmpty != nil {
                Text("답변: \(state.answerSummary)")
                    .font(.system(size: 10, weight: .medium, design: .rounded))
                    .foregroundStyle(.white.opacity(0.42))
                    .lineLimit(1)
            }
        }
        .padding(.horizontal, compact ? 10 : 12)
        .padding(.vertical, compact ? 7 : 8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: compact ? 10 : 12, style: .continuous)
                .fill(Color.white.opacity(0.055))
        )
        .accessibilityIdentifier("assistant.structuredSubmissionReceipt")
    }

    private func questionCard(
        _ question: StructuredPromptQuestion,
        prompt: StructuredPromptRequest,
        compact: Bool = false,
        isSubmitting: Bool = false
    ) -> some View {
        let draft = viewModel.structuredPromptDraft(for: question, in: prompt)

        return VStack(alignment: .leading, spacing: compact ? 9 : 12) {
            Text(question.question)
                .font(.system(size: compact ? 15 : 14, weight: .semibold, design: .rounded))
                .foregroundStyle(.white.opacity(0.92))
                .fixedSize(horizontal: false, vertical: true)

            if let helperText = question.helperText?.trimmingCharacters(in: .whitespacesAndNewlines), !helperText.isEmpty {
                if compact {
                    Text(helperText)
                        .font(.system(size: 11, weight: .medium, design: .rounded))
                        .foregroundStyle(.white.opacity(0.54))
                        .lineLimit(2)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityLabel(helperText)
                } else {
                    VStack(alignment: .leading, spacing: 5) {
                        Text(question.header)
                            .font(.system(size: 11, weight: .bold, design: .rounded))
                            .foregroundStyle(Color(red: 0.82, green: 0.89, blue: 1.0).opacity(0.92))
                        Text(helperText)
                            .font(.system(size: 12, weight: .medium, design: .rounded))
                            .foregroundStyle(.white.opacity(0.62))
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .padding(12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(
                        RoundedRectangle(cornerRadius: 14, style: .continuous)
                            .fill(Color.white.opacity(0.055))
                            .overlay(
                                RoundedRectangle(cornerRadius: 14, style: .continuous)
                                    .stroke(Color.white.opacity(0.08), lineWidth: 1)
                            )
                    )
                }
            }

            if let options = question.options, !options.isEmpty {
                VStack(spacing: compact ? 6 : 8) {
                    ForEach(options, id: \.label) { option in
                        choiceRow(
                            option,
                            question: question,
                            prompt: prompt,
                            selected: draft.selectedOptions.contains(option.label),
                            showDescription: !compact,
                            disabled: isSubmitting
                        )
                    }
                }
            }

            if question.allowFreeText == true || question.options?.isEmpty != false {
                VStack(alignment: .leading, spacing: 6) {
                    Text(freeTextLabel(for: question, compact: compact))
                        .font(.system(size: 11, weight: .bold, design: .rounded))
                        .foregroundStyle(.white.opacity(0.52))
                    freeTextField(question: question, prompt: prompt, isDisabled: isSubmitting)
                }
            }
        }
        .padding(compact ? 12 : 14)
        .opacity(isSubmitting ? 0.72 : 1)
        .background(
            RoundedRectangle(cornerRadius: compact ? 14 : 16, style: .continuous)
                .fill(Color.black.opacity(0.18))
                .overlay(
                    RoundedRectangle(cornerRadius: compact ? 14 : 16, style: .continuous)
                        .stroke(Color.white.opacity(0.08), lineWidth: 1)
                )
        )
    }

    private func freeTextLabel(for question: StructuredPromptQuestion, compact: Bool) -> String {
        if question.options?.isEmpty == false {
            return "기타"
        }
        return compact ? "직접 입력" : "자유 입력"
    }

    /// Default accent for the form-style structured prompt (office-hours intake).
    /// Inline decision cards override this with `inlineDecisionAccent`.
    private static let structuredChoiceAccent = Color(red: 0.82, green: 0.89, blue: 1.0)
    /// Sage-cyan accent for inline decision cards (Decision Card Stack variant).
    /// Stays off-token from the rest of the chat surface so the card reads as a
    /// distinct decision moment without competing with provider-auth or BIP
    /// mission cards. Source: design-shotgun approved.json (#7BA890).
    static let inlineDecisionAccent = Color(red: 0.482, green: 0.659, blue: 0.565)

    private func choiceRow(
        _ option: StructuredPromptOption,
        question: StructuredPromptQuestion,
        prompt: StructuredPromptRequest,
        selected: Bool,
        accent: Color = ContentView.structuredChoiceAccent,
        showDescription: Bool = true,
        disabled: Bool = false
    ) -> some View {
        Button {
            guard !disabled else { return }
            viewModel.toggleStructuredPromptOption(option.label, for: question, in: prompt)
        } label: {
            HStack(alignment: .top, spacing: 12) {
                ZStack {
                    Circle()
                        .stroke(selected ? accent : Color.white.opacity(0.30), lineWidth: 1.4)
                    if selected {
                        Circle()
                            .fill(accent)
                            .frame(width: 8, height: 8)
                    }
                }
                .frame(width: 16, height: 16)
                .padding(.top, 2)

                VStack(alignment: .leading, spacing: 3) {
                    Text(option.label)
                        .font(.system(size: 13, weight: .semibold, design: .rounded))
                        .foregroundStyle(.white.opacity(0.94))
                    if showDescription {
                        Text(option.description)
                            .font(.system(size: 12, weight: .medium, design: .rounded))
                            .foregroundStyle(.white.opacity(0.54))
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }

                Spacer(minLength: 0)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 11)
            .background(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .fill(selected ? Color.white.opacity(0.18) : Color.black.opacity(0.16))
                    .overlay(
                        RoundedRectangle(cornerRadius: 16, style: .continuous)
                            .stroke(selected ? accent.opacity(0.72) : Color.white.opacity(0.0), lineWidth: 1)
                    )
            )
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(disabled)
        .accessibilityElement(children: .ignore)
        .accessibilityIdentifier("assistant.structuredChoice.\(question.id).\(option.label)")
        .accessibilityLabel(option.label)
        .accessibilityHint(option.description)
        .accessibilityValue(selected ? "Selected" : "Not selected")
        .accessibilityAddTraits(.isButton)
    }

    private func freeTextField(
        question: StructuredPromptQuestion,
        prompt: StructuredPromptRequest,
        isDisabled: Bool = false
    ) -> some View {
        if question.textMode == .long {
            return AnyView(
                TextEditor(
                    text: Binding(
                        get: { viewModel.structuredPromptDraft(for: question, in: prompt).freeText },
                        set: { viewModel.updateStructuredPromptFreeText($0, for: question, in: prompt) }
                    )
                )
                .font(.system(size: 13, weight: .medium, design: .rounded))
                .foregroundStyle(.white.opacity(0.94))
                .scrollContentBackground(.hidden)
                .frame(height: 88)
                .padding(10)
                .background(
                    RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .fill(Color.black.opacity(0.16))
                )
                .disabled(isDisabled)
                .accessibilityIdentifier("assistant.structuredFreeText.\(question.id)")
                .accessibilityLabel(question.freeTextPlaceholder?.nonEmpty ?? "Type your answer")
            )
        }

        return AnyView(
            TextField(
                question.freeTextPlaceholder?.nonEmpty ?? "Type your answer",
                text: Binding(
                    get: { viewModel.structuredPromptDraft(for: question, in: prompt).freeText },
                    set: { viewModel.updateStructuredPromptFreeText($0, for: question, in: prompt) }
                )
            )
            .textFieldStyle(.plain)
            .font(.system(size: 13, weight: .medium, design: .rounded))
            .foregroundStyle(.white.opacity(0.94))
            .padding(.horizontal, 12)
            .padding(.vertical, 11)
            .background(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .fill(Color.black.opacity(0.16))
            )
            .disabled(isDisabled)
            .accessibilityIdentifier("assistant.structuredFreeText.\(question.id)")
            .accessibilityLabel(question.freeTextPlaceholder?.nonEmpty ?? "Type your answer")
        )
    }

    private var pillMaterial: some View {
        RoundedRectangle(cornerRadius: 22, style: .continuous)
            .fill(
                LinearGradient(
                    colors: [
                        Color(red: 0.64, green: 0.58, blue: 0.42).opacity(0.96),
                        Color(red: 0.53, green: 0.48, blue: 0.35).opacity(0.98)
                    ],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
            )
            .overlay(
                RoundedRectangle(cornerRadius: 22, style: .continuous)
                    .stroke(Color.white.opacity(0.14), lineWidth: 1)
            )
    }

    private var expandedBubbleMaterial: some View {
        RoundedRectangle(cornerRadius: 30, style: .continuous)
            .fill(
                LinearGradient(
                    colors: [
                        Color(red: 0.63, green: 0.57, blue: 0.42).opacity(0.97),
                        Color(red: 0.50, green: 0.46, blue: 0.34).opacity(0.98)
                    ],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
            )
            .overlay(
                RoundedRectangle(cornerRadius: 30, style: .continuous)
                    .stroke(Color.white.opacity(0.12), lineWidth: 1)
            )
    }

    private func assistantAvatar(size: CGFloat) -> some View {
        Image("profile")
            .resizable()
            .scaledToFill()
            .frame(width: size, height: size)
            .clipShape(Circle())
            .overlay(
                Circle()
                    .stroke(Color.white.opacity(0.14), lineWidth: 1)
        )
    }

    private func assistantAvatarButton(size: CGFloat) -> some View {
        Button {
            withAnimation(.spring(response: 0.32, dampingFraction: 0.88)) {
                if let openWorkspaceAction {
                    openWorkspaceAction()
                } else {
                    viewModel.showWorkspace()
                }
            }
        } label: {
            assistantAvatar(size: size)
        }
        .buttonStyle(.plain)
        .help("Agentic30 열기")
        .accessibilityIdentifier("assistant.openWorkspaceButton")
        .accessibilityLabel("Agentic30 열기")
    }

    private func quickStartRow() -> some View {
        HStack(spacing: 8) {
            quickStartButton(title: "문서 인터뷰", prompt: "/office-hours-docs")
        }
    }

    private func quickStartButton(title: String, prompt: String) -> some View {
        Button {
            viewModel.draft = prompt
        } label: {
            Text(title)
                .font(.system(size: 11, weight: .bold, design: .rounded))
                .foregroundStyle(.white.opacity(0.72))
                .lineLimit(1)
                .padding(.horizontal, 10)
                .padding(.vertical, 7)
                .background(
                    Capsule()
                        .fill(Color.black.opacity(0.14))
                        .overlay(
                            Capsule()
                                .stroke(Color.white.opacity(0.08), lineWidth: 1)
                        )
                )
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("assistant.quickStart.\(title)")
        .accessibilityLabel(title)
    }

    private func promptComposer() -> some View {
        let placeholder = workspacePromptPlaceholder()
        return HStack(spacing: 10) {
            TextField(
                placeholder,
                text: $viewModel.draft
            )
            .textFieldStyle(.plain)
            .font(.system(size: 13, weight: .semibold, design: .rounded))
            .foregroundStyle(.white.opacity(0.94))
            .accessibilityIdentifier("assistant.promptComposer")
            .accessibilityLabel(placeholder)
            .onSubmit {
                if viewModel.canSend {
                    viewModel.sendPrompt()
                }
            }

            Button {
                viewModel.sendPrompt()
            } label: {
                Image(systemName: "arrow.up.circle.fill")
                    .font(.system(size: 22, weight: .semibold))
                    .foregroundStyle(.white.opacity(viewModel.canSend ? 0.92 : 0.32))
                    .frame(width: 34, height: 34)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(!viewModel.canSend)
            .accessibilityIdentifier("assistant.sendPromptButton")
            .accessibilityLabel("Send prompt")
            .accessibilityAction {
                if viewModel.canSend {
                    viewModel.sendPrompt()
                }
            }
        }
        .padding(.horizontal, 13)
        .frame(height: 50)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("assistant.promptComposerContainer")
        .background(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .fill(Color.black.opacity(0.18))
                .overlay(
                    RoundedRectangle(cornerRadius: 18, style: .continuous)
                        .stroke(Color.white.opacity(0.1), lineWidth: 1)
                )
        )
    }

    private func workspacePromptPlaceholder() -> String {
        if viewModel.selectedSession == nil {
            return "첫 메시지 미리 적기"
        }
        if viewModel.visibleBipCoach?.currentMission != nil {
            return "예: 초안 써줘 / 완료 기준을 더 작게 줄여줘"
        }
        if viewModel.visibleBipCoach?.pendingMissionChoices.isEmpty == false {
            return "예: 왜 1번이 추천인가요? / 더 작은 미션으로 줄여줘"
        }
        return "메시지 보내기"
    }

    @ViewBuilder
    private func bubbleBackground(isCompact: Bool) -> some View {
        if isCompact {
            pillMaterial
        } else {
            expandedBubbleMaterial
        }
    }

    private func skeletonLine(width: CGFloat) -> some View {
        RoundedRectangle(cornerRadius: 10, style: .continuous)
            .fill(Color.white.opacity(0.16))
            .frame(width: 620 * width - 44, height: 18)
            .overlay(
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .fill(
                        LinearGradient(
                            colors: [
                                Color.white.opacity(0.03),
                                Color.white.opacity(0.12),
                                Color.white.opacity(0.03)
                            ],
                            startPoint: .leading,
                            endPoint: .trailing
                        )
                    )
                    .opacity(0.7)
            )
    }

    private func skeletonChip(width: CGFloat) -> some View {
        RoundedRectangle(cornerRadius: 18, style: .continuous)
            .fill(Color.black.opacity(0.12))
            .frame(width: width, height: 42)
            .overlay(
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .stroke(Color.white.opacity(0.06), lineWidth: 1)
            )
    }

    private func statusIcon(for session: ChatSession) -> some View {
        Group {
            switch session.status {
            case .running:
                Image(systemName: "pause.circle.fill")
            case .awaitingInput:
                Image(systemName: "questionmark.circle.fill")
            case .error:
                Image(systemName: "exclamationmark.triangle.fill")
            case .idle:
                Image(systemName: "waveform")
            }
        }
        .font(.system(size: 15, weight: .semibold))
        .foregroundStyle(.white.opacity(0.68))
    }

    private func compactTitle(for session: ChatSession) -> String {
        switch session.status {
        case .running:
            return session.title.nonEmpty ?? "답변을 작성하고 있어요"
        case .awaitingInput:
            return "다음 작업을 선택하세요"
        case .error:
            return "Assistant가 오류로 멈췄습니다"
        case .idle:
            return session.title.nonEmpty ?? "Assistant가 준비됐습니다"
        }
    }

    private func compactSubtitle(for session: ChatSession) -> String {
        switch session.status {
        case .running:
            return "최신 답변을 받아오는 중입니다"
        case .awaitingInput:
            return "선택하거나 직접 입력하면 이어서 진행합니다"
        case .error:
            return session.error?.nonEmpty ?? "설정이나 메뉴 막대에서 최신 메시지를 확인하세요"
        case .idle:
            return lastAssistantMessage(in: session)?.content.nonEmpty ?? "대기 중"
        }
    }

    private func compactAccessoryLabel(for session: ChatSession) -> String {
        switch session.status {
        case .running:
            return "작업 중"
        case .awaitingInput:
            return "입력 대기"
        case .error:
            return "오류"
        case .idle:
            return "현재"
        }
    }

    private func expandedSubtitle(for session: ChatSession, hasMissionSuggestion: Bool = false) -> String {
        if hasMissionSuggestion {
            return "Assistant"
        }
        switch session.provider {
        case .codex:
            return "현재 Codex 세션의 최신 답변"
        case .claude:
            return "현재 Claude 세션의 최신 답변"
        case .gemini:
            return "현재 Gemini 세션의 최신 답변"
        }
    }

    private func providerAuthActionIcon(_ provider: AgentProvider) -> String {
        switch provider {
        case .claude:
            return "person.crop.circle.badge.checkmark"
        case .codex:
            return "sparkles"
        case .gemini:
            return "terminal"
        }
    }

    private func workspaceShouldRenderMessage(_ message: ChatMessage) -> Bool {
        switch message.role {
        case .user:
            return message.content.trimmingCharacters(in: .whitespacesAndNewlines).nonEmpty != nil
        case .assistant, .system:
            return message.content.trimmingCharacters(in: .whitespacesAndNewlines).nonEmpty != nil
                || message.error?.trimmingCharacters(in: .whitespacesAndNewlines).nonEmpty != nil
                || message.bipMissionChoices?.isEmpty == false
                || message.providerAuthActions?.isEmpty == false
                || message.state == .streaming
        }
    }

    private func lastAssistantMessage(in session: ChatSession) -> ChatMessage? {
        session.messages.last(where: { message in
            (message.role == .assistant || message.role == .system)
                && workspaceShouldRenderMessage(message)
        })
    }

    private func workspaceLatestAssistantEvidence(in session: ChatSession) -> String? {
        guard let content = lastAssistantMessage(in: session)?.content.nonEmpty else {
            return nil
        }

        let maxEvidenceCharacters = 900
        guard content.count > maxEvidenceCharacters else {
            return content
        }

        let endIndex = content.index(content.startIndex, offsetBy: maxEvidenceCharacters)
        return String(content[..<endIndex]) + "..."
    }

    private func lastUserPrompt(in session: ChatSession) -> String? {
        session.messages.last(where: { $0.role == .user })?.content.nonEmpty
    }

    private func canSubmit(_ prompt: StructuredPromptRequest) -> Bool {
        viewModel.canSubmitStructuredPrompt(prompt)
    }

    private func submitPrompt(_ prompt: StructuredPromptRequest) {
        guard submissionState(for: prompt) == nil else { return }

        let submissions = viewModel.structuredPromptSubmissions(for: prompt)

        viewModel.submitStructuredPrompt(
            sessionId: prompt.sessionId,
            requestId: prompt.requestId,
            responses: submissions
        )
    }

    private func syncPromptDrafts(bindingToken: String?) {
        guard let request = viewModel.pendingStructuredPrompt else {
            currentPromptBindingToken = nil
            viewModel.synchronizeStructuredPromptDrafts(with: nil)
            return
        }
        let resolvedBindingToken = bindingToken ?? request.uiBindingToken
        guard currentPromptBindingToken != resolvedBindingToken else { return }

        currentPromptBindingToken = resolvedBindingToken
        viewModel.synchronizeStructuredPromptDrafts(with: request)
    }
}

enum AgenticCurriculumPhase: String, CaseIterable, Identifiable, Hashable {
    case foundation
    case build
    case launch
    case grow

    var id: String { rawValue }

    var title: String {
        switch self {
        case .foundation: return "Foundation"
        case .build: return "Build"
        case .launch: return "Launch"
        case .grow: return "Grow"
        }
    }
}

struct AgenticCurriculumDay: Identifiable, Hashable {
    let day: Int
    let phase: AgenticCurriculumPhase
    let title: String
    let shortTitle: String
    let summary: String
    let tasks: [String]
    let output: String

    var id: Int { day }

    static let days: [AgenticCurriculumDay] = [
        .init(day: 1, phase: .foundation, title: "목표와 고객 핵심 가설을 만든다", shortTitle: "가설", summary: "프로젝트 목표를 고객, 문제, 확인할 행동과 한 문장으로 맞추고 Day 2 시장 신호 검증 기준으로 둡니다.", tasks: ["프로젝트 목표 한 문장 고정하기", "고객 / 문제 / 확인할 행동 세 요소 작성하기", "품질 게이트 7.0/10 이상인지 확인하고 다음 검증 기준 기록"], output: "day-1-alignment-statement.md, docs/GOAL.md, docs/ICP.md, docs/SPEC.md v0"),
        .init(day: 2, phase: .foundation, title: "돈이 흐르는 기준 시장을 고른다", shortTitle: "Market", summary: "어제 통증과 가까운 iOS/Android/Web/Mac 앱·도구 시장에서 이미 지불 행동이 있는지 확인합니다.", tasks: ["카테고리 1-2개 고르기", "작은 팀/개인이 만든 유료 앱·광고 앱 5개 찾기", "가격·리뷰·ASO·광고/콘텐츠 흔적을 day-2-evidence-log.md에 기록"], output: "day-2-evidence-log.md"),
        .init(day: 3, phase: .foundation, title: "Mom Test 인터뷰 질문을 만든다", shortTitle: "Mom Test", summary: "약한 가설을 검증/반증할 5문장 인터뷰 질문을 만들고 미래 의향 질문을 제거합니다.", tasks: ["과거 행동 질문 3개 이상 쓰기", "미래 의향/칭찬 유도 질문 제거", "다음 인터뷰 대상 1명과 질문 5개 확정"], output: "day-3-interview-script.md"),
        .init(day: 4, phase: .foundation, title: "10배 wedge로 약한 섹션을 다시 쓴다", shortTitle: "10x Wedge", summary: "경쟁 앱을 베끼지 않고 더 좁은 페르소나나 더 빠른 결과로 SPEC.md의 약한 섹션을 다시 씁니다.", tasks: ["원조/대체재의 핵심 흐름 1개 고르기", "가격·속도·UX·페르소나 중 10배 wedge 1개 선택", "SPEC.md 같은 파일에서 약한 섹션 다시 쓰기"], output: "day-4-rewrite-decision.md"),
        .init(day: 5, phase: .foundation, title: "수요 시그널을 숫자로 평가한다", shortTitle: "Demand Signal", summary: "경쟁앱/광고/노출/스토어/랜딩/DM 데이터를 진짜 수요 신호와 허수로 분리합니다.", tasks: ["impressions/clicks/signups/replies/CPI/store conversion 중 있는 숫자 정리", "waitlist/CTR이 아닌 돈 낼 후보 1명 고르기", "SPEC.md v2에 demand signal 판단 기록"], output: "SPEC.md v2, day-5-demand-signal.md"),
        .init(day: 6, phase: .foundation, title: "돈/시간 ask를 실행한다", shortTitle: "Ask", summary: "칭찬이 아니라 특정 1명에게 가격, 받을 약속, 응답 기한이 있는 ask를 보냅니다.", tasks: ["ask 대상 1명 선택", "가격·받을 약속·응답 기한이 있는 문장 작성", "yes/no/no-reply를 원문으로 기록"], output: "monetization-ask-result.md"),
        .init(day: 7, phase: .foundation, title: "Foundation Go/No-Go를 결정한다", shortTitle: "Go/No-Go", summary: "7일 기록으로 계속/재시작/피벗 중 하나를 고릅니다.", tasks: ["인터뷰/일지/BIP 수량 세기", "가장 강한 증거와 반증 쓰기", "다음 7일 결론 선택"], output: "go-no-go.md, foundation-summary"),
        .init(day: 8, phase: .build, title: "MVP를 핵심 기능 1개로 자른다", shortTitle: "Core Action", summary: "기능 목록이 아니라 사용자가 30초 안에 첫 가치를 보는 핵심 행동 1개를 완성 대상으로 고정합니다.", tasks: ["핵심 행동 1개와 성공 화면 정의", "로그인/동기화/자동화/설정 확장은 deferred 표시", "첫 happy path 테스트 작성"], output: "core action spec + deferred list"),
        .init(day: 9, phase: .build, title: "입력→처리→출력 흐름을 고정한다", shortTitle: "Input Flow", summary: "사용자가 바로 써볼 수 있게 입력, 처리, 결과 화면을 한 번에 지나가게 만듭니다.", tasks: ["첫 입력 포맷 1개만 선택", "처리 실패와 빈 입력 폴백 작성", "결과 화면까지 30초 이내인지 재기"], output: "input-process-output flow"),
        .init(day: 10, phase: .build, title: "핵심 결과의 10배 품질을 만든다", shortTitle: "10x Result", summary: "기능 수가 아니라 같은 문제를 더 빠르게, 적은 클릭으로, 더 좁은 페르소나에 맞게 해결합니다.", tasks: ["경쟁/대체재 대비 10배 기준 1개 선택", "핵심 결과 화면에만 품질 투자", "부차 기능 추가 요청은 다음 폴더로 이동"], output: "10x core result note"),
        .init(day: 11, phase: .build, title: "마찰 없는 첫 사용을 만든다", shortTitle: "No Login", summary: "검증 전 로그인, 계정, 복잡한 온보딩으로 이탈을 만들지 않습니다.", tasks: ["설치 후 첫 가치까지 클릭 수 세기", "필수 설명 5줄 이하로 줄이기", "로그인/회원가입 없이 가능한 경로 확인"], output: "time-to-first-value note"),
        .init(day: 12, phase: .build, title: "첫 end-to-end dogfood를 돈다", shortTitle: "E2E", summary: "실제 입력에서 핵심 기능 1개와 결과 기록까지 한 번 지나갑니다.", tasks: ["실제 인터뷰/일지 파일 넣기", "핵심 결과 생성 실행", "추천 행동 수행 여부 기록"], output: "dogfood E2E log"),
        .init(day: 13, phase: .build, title: "스토어/랜딩 약속을 미리 쓴다", shortTitle: "Promise", summary: "제품 설명을 나중에 붙이지 말고 iOS/Android/Web/Mac 어디서 팔든 통하는 약속 한 문장으로 범위를 제한합니다.", tasks: ["타겟 페르소나 한 줄 작성", "결과 약속 한 문장 작성", "스크린샷/데모/스토어 첫 화면에 보여야 할 장면 1개 선택"], output: "store or landing promise draft"),
        .init(day: 14, phase: .build, title: "측정을 심는다", shortTitle: "Measurement", summary: "설치보다 첫 가치 경험과 이탈 지점을 알 수 있게 이벤트를 남깁니다.", tasks: ["first_value 이벤트 정의", "개인정보 없는 payload 확인", "activation baseline 기록 위치 만들기"], output: "event list + activation check"),
        .init(day: 15, phase: .build, title: "수익모델 dry run을 한다", shortTitle: "Revenue Dry Run", summary: "광고든 구독이든 결제를 나중 문제로 밀지 말고 가격, 노출 위치, 받을 약속의 막힘을 확인합니다.", tasks: ["광고/구독/일회성 결제 중 현재 실험 모델 1개 선택", "페이월/결제 mock 또는 광고 노출 sandbox 경로 확인", "waitlist와 무료 가입은 proof가 아님을 기록"], output: "revenue dry-run note"),
        .init(day: 16, phase: .build, title: "출시 체크리스트를 닫는다", shortTitle: "Release Gate", summary: "출시를 미루는 플랫폼 계정, 권한, 세금/정산, 빌드 리스크를 확인 목록으로 줄입니다.", tasks: ["App Store/Google Play/Web/Mac 중 현재 채널 계정 상태 확인", "정산·세금·회사 사규 리스크 체크", "첫 테스터에게 보낼 설치/접속 안내 5줄 작성"], output: "release readiness checklist"),
        .init(day: 17, phase: .build, title: "Build phase를 줄일지 결정한다", shortTitle: "Build Retro", summary: "기능 추가가 아니라 첫 가치 경험과 유료 ask 가능 여부로 남길 것을 고릅니다.", tasks: ["7일 사용 로그 확인", "첫 가치까지 막힌 단계 확인", "삭제/유지/다음 phase 결정"], output: "build decision memo"),
        .init(day: 18, phase: .launch, title: "고객 언어로 launch story를 쓴다", shortTitle: "Story", summary: "제품 설명보다 반복된 L2 표현과 10배 wedge로 공개합니다.", tasks: ["반복 인용 3개 선택", "hook-demo-CTA 구조로 launch hook 3개 작성", "가장 강한 status quo로 시작"], output: "launch story draft"),
        .init(day: 19, phase: .launch, title: "첫 공개 proof를 만든다", shortTitle: "Public Proof", summary: "불완전한 앱 상태보다 배운 고객 증거와 핵심 결과 장면을 공개합니다.", tasks: ["핵심 결과 스크린샷/요약 선택", "실행 결과 1개 쓰기", "Threads/BIP 게시"], output: "public proof post"),
        .init(day: 20, phase: .launch, title: "Warm outreach를 보낸다", shortTitle: "Warm outreach", summary: "가장 절박한 사람에게 직접 확인하고 응답/무응답을 숫자로 남깁니다.", tasks: ["20명 후보 목록", "개인화 DM 10개", "응답/무응답 Sheet 기록"], output: "outreach tracker"),
        .init(day: 21, phase: .launch, title: "첫 설치/사용 관찰을 한다", shortTitle: "Observe", summary: "시연이 아니라 사용자가 iOS/Android/Web/Mac 실제 환경에서 막히는 장면과 첫 가치 도달 시간을 봅니다.", tasks: ["테스터 1명 설치/접속 관찰", "막힌 단계와 first_value 도달 여부 기록", "수정 3개 이하 선택"], output: "observation note"),
        .init(day: 22, phase: .launch, title: "60초 demo를 만든다", shortTitle: "Demo", summary: "핵심 기능 1개와 10배 결과가 60초 안에 보이게 합니다.", tasks: ["한 입력에서 결과까지 녹화", "hook-demo-CTA 캡션 작성", "BIP/랜딩/광고 소재로 재사용"], output: "60s demo asset"),
        .init(day: 23, phase: .launch, title: "paid learning 실험을 설계한다", shortTitle: "Paid Learning", summary: "광고비를 성장 욕심이 아니라 iOS/Android/Web/Mac 시장/메시지 학습 비용으로 작게 씁니다.", tasks: ["테스트 예산과 중단 기준 정하기", "소재 hook 3개와 타겟 1개 선택", "CPI/CTR/store conversion/first_value 측정 준비"], output: "paid learning plan"),
        .init(day: 24, phase: .launch, title: "Launch 결정을 숫자로 한다", shortTitle: "Launch Decision", summary: "조회수가 아니라 DM/설치/first_value/ask 결과로 다음 7일을 고릅니다.", tasks: ["유입/설치/첫 가치/ask 숫자 정리", "가장 강한 채널 선택", "다음 실험 1개 결정"], output: "launch decision"),
        .init(day: 25, phase: .grow, title: "Activation을 정의한다", shortTitle: "Activation", summary: "가입이 아니라 설치 후 30초 이내 첫 가치 경험에 도달했는지를 측정합니다.", tasks: ["첫 가치 행동 정의", "도달/이탈 수 계산", "가장 큰 이탈 지점 선택"], output: "activation baseline"),
        .init(day: 26, phase: .grow, title: "Retention 신호를 본다", shortTitle: "Retention", summary: "다시 돌아와 핵심 기능을 반복하는 사람이 있는지 확인합니다.", tasks: ["재방문 기준 정하기", "반복 사용 발화 찾기", "돌아온 이유 한 문장 작성"], output: "retention note"),
        .init(day: 27, phase: .grow, title: "가격 ask와 페이월을 반복한다", shortTitle: "Pricing", summary: "첫 매출은 큰 금액보다 지불 행동 또는 명시적 가격 거절의 증명입니다.", tasks: ["유료 제안 1개 작성", "관심 사용자에게 가격·약속·기한 포함 제안", "가격 반응과 결제/거절 원문 기록"], output: "pricing ask result"),
        .init(day: 28, phase: .grow, title: "ASO/소재 loop를 만든다", shortTitle: "Acquisition Loop", summary: "앱스토어 검색 키워드, 상세 페이지, 랜딩, 광고 소재를 감이 아니라 전환 데이터로 고칩니다.", tasks: ["App Store/Google Play/랜딩의 hook 점검", "키워드·스크린샷·소재 1개 수정", "CPI/설치/store conversion/first_value 변화 기록"], output: "acquisition loop log"),
        .init(day: 29, phase: .grow, title: "PMF evidence memo를 쓴다", shortTitle: "PMF Memo", summary: "실제 사용자 증거, 유입 지표, ask 결과, 반증을 같은 문서에 둡니다.", tasks: ["사용자 증거와 ask 결과 정리", "CPI/activation/retention/가격 반응 요약", "계속/전환/중단 판단 기준 쓰기"], output: "PMF evidence memo"),
        .init(day: 30, phase: .grow, title: "계속/전환/중단을 결정한다", shortTitle: "Final Decision", summary: "완주가 아니라 첫 가치, 유입, 지불 행동 근거로 다음 선택을 공개합니다.", tasks: ["30일 숫자 요약", "가장 큰 배움 3개", "continue/pivot/stop 결정"], output: "Day 30 public retro")
    ]
}

private struct BipReadinessGroup: Identifiable, Hashable {
    let title: String
    let ids: [BipReadinessRowId]

    var id: String { title }
}

struct OpenDesignReferenceRoutePolicy {
    static func supportsOpenDesignDay(dayNumber: Int) -> Bool {
        dayNumber == 1 || dayNumber == 2
    }
}

enum OpenDesignWorkspaceDayResolver {
    static func dayNumber(selectedDay: Int, completedDays: Set<Int>) -> Int {
        if OpenDesignReferenceRoutePolicy.supportsOpenDesignDay(dayNumber: selectedDay) {
            return selectedDay
        }
        return completedDays.contains(1) ? 2 : 1
    }
}

#Preview {
    ContentView(viewModel: AgenticViewModel())
}

struct RealisticConfettiBurst: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let trigger: Int

    init(trigger: Int) {
        self.trigger = trigger
    }

    var body: some View {
        Group {
            if isDisabled {
                Color.clear
            } else {
                RealisticConfettiHost(trigger: trigger)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }

    static var isProcessDisabled: Bool {
        ProcessInfo.processInfo.environment["AGENTIC30_TEST_STUB_PROVIDER"] == "1"
    }

    private var isDisabled: Bool {
        reduceMotion || Self.isProcessDisabled
    }
}

struct RealisticConfettiRecipe: Equatable, Identifiable {
    static let origin = CGPoint(x: 0.5, y: 0.70)
    static let cleanupDelay: TimeInterval = 2.20
    static let ticksPerSecond: Double = 60
    static let canvasGravity: Double = 3
    static let demoPaletteHexes = RealisticConfettiPaletteColor.demoLike.map(\.hex)
    static let realistic: [RealisticConfettiRecipe] = [
        .init(name: "core", particleCount: 50, spreadDegrees: 26, startVelocity: 55, decay: 0.90, scalar: 1.0),
        .init(name: "body", particleCount: 40, spreadDegrees: 60, startVelocity: 45, decay: 0.90, scalar: 1.0),
        .init(name: "dust", particleCount: 70, spreadDegrees: 100, startVelocity: 45, decay: 0.91, scalar: 0.8),
        .init(name: "slowRibbon", particleCount: 20, spreadDegrees: 120, startVelocity: 25, decay: 0.92, scalar: 1.2),
        .init(name: "outer", particleCount: 20, spreadDegrees: 120, startVelocity: 45, decay: 0.90, scalar: 1.0)
    ]

    let name: String
    let particleCount: Int
    let spreadDegrees: Double
    let startVelocity: Double
    let decay: Double
    let scalar: Double
    let drift: Double = 0

    var id: String { name }

    static var totalParticleCount: Int {
        realistic.reduce(0) { $0 + $1.particleCount }
    }

    static var totalTicks: Double {
        cleanupDelay * ticksPerSecond
    }

    static func pointScale(for size: CGSize) -> CGFloat {
        let heightScale = size.height / 720
        return min(max(heightScale, 0.72), 1.18)
    }
}

private struct RealisticConfettiHost: View {
    let trigger: Int
    @State private var particles: [RealisticConfettiParticle] = []
    @State private var startedAt = Date()

    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / RealisticConfettiRecipe.ticksPerSecond)) { timeline in
            Canvas(opaque: false, colorMode: .linear, rendersAsynchronously: true) { context, size in
                let elapsed = timeline.date.timeIntervalSince(startedAt)
                guard elapsed >= 0,
                      elapsed <= RealisticConfettiRecipe.cleanupDelay else {
                    return
                }

                let tick = elapsed * RealisticConfettiRecipe.ticksPerSecond
                for particle in particles {
                    particle.draw(in: &context, size: size, tick: tick)
                }
            }
        }
        .onAppear {
            restart()
        }
        .onChange(of: trigger) { _, _ in
            restart()
        }
    }

    private func restart() {
        startedAt = Date()
        particles = RealisticConfettiParticle.makeParticles(trigger: trigger)
    }
}

private struct RealisticConfettiParticle: Identifiable {
    let id: Int
    let angle2D: Double
    let startVelocity: Double
    let decay: Double
    let drift: Double
    let wobble: Double
    let wobbleSpeed: Double
    let tiltAngle: Double
    let scalar: Double
    let random: Double
    let shape: RealisticConfettiParticleShape
    let color: RealisticConfettiPaletteColor

    static func makeParticles(trigger: Int) -> [RealisticConfettiParticle] {
        var generator = RealisticConfettiRandomGenerator(seed: UInt64(max(trigger, 1)))
        var particles: [RealisticConfettiParticle] = []
        particles.reserveCapacity(RealisticConfettiRecipe.totalParticleCount)

        for recipe in RealisticConfettiRecipe.realistic {
            let radAngle = Double.pi / 2
            let radSpread = recipe.spreadDegrees * Double.pi / 180

            for _ in 0..<recipe.particleCount {
                let angle2D = -radAngle + ((0.5 * radSpread) - (generator.nextUnit() * radSpread))
                let velocity = (recipe.startVelocity * 0.5) + (generator.nextUnit() * recipe.startVelocity)
                let wobbleSpeed = min(0.11, generator.nextUnit() * 0.1 + 0.05)
                let tiltAngle = (generator.nextUnit() * 0.5 + 0.25) * Double.pi

                particles.append(
                    RealisticConfettiParticle(
                        id: particles.count,
                        angle2D: angle2D,
                        startVelocity: velocity,
                        decay: recipe.decay,
                        drift: recipe.drift,
                        wobble: generator.nextUnit() * 10,
                        wobbleSpeed: wobbleSpeed,
                        tiltAngle: tiltAngle,
                        scalar: recipe.scalar,
                        random: generator.nextUnit() + 2,
                        shape: RealisticConfettiParticleShape.random(using: &generator),
                        color: RealisticConfettiPaletteColor.random(using: &generator)
                    )
                )
            }
        }

        return particles
    }

    func draw(in context: inout GraphicsContext, size: CGSize, tick: Double) {
        guard let frame = frame(in: size, tick: tick) else { return }
        context.fill(
            shape.path(
                center: frame.center,
                scalar: CGFloat(scalar),
                tilt: frame.tilt,
                random: random,
                pointScale: frame.pointScale
            ),
            with: .color(color.color.opacity(frame.opacity))
        )
    }

    private func frame(in size: CGSize, tick: Double) -> RealisticConfettiParticleFrame? {
        guard tick < RealisticConfettiRecipe.totalTicks else { return nil }

        let pointScale = RealisticConfettiRecipe.pointScale(for: size)
        let scaledDistance = geometricDistance(at: tick) * Double(pointScale)
        let origin = CGPoint(
            x: size.width * RealisticConfettiRecipe.origin.x,
            y: size.height * RealisticConfettiRecipe.origin.y
        )
        let wobblePhase = wobble + wobbleSpeed * tick
        let wobbleRadius = 10 * scalar * Double(pointScale)
        let x = origin.x
            + CGFloat((cos(angle2D) * scaledDistance) + (drift * tick * Double(pointScale)))
            + CGFloat(wobbleRadius * cos(wobblePhase))
        let y = origin.y
            + CGFloat((sin(angle2D) * scaledDistance) + (RealisticConfettiRecipe.canvasGravity * tick * Double(pointScale)))
            + CGFloat(wobbleRadius * sin(wobblePhase))
        let progress = min(max(tick / RealisticConfettiRecipe.totalTicks, 0), 1)
        let opacity = pow(1 - progress, 1.1)

        return RealisticConfettiParticleFrame(
            center: CGPoint(x: x, y: y),
            opacity: opacity,
            tilt: tiltAngle + (0.1 * tick),
            pointScale: pointScale
        )
    }

    private func geometricDistance(at tick: Double) -> Double {
        guard decay != 1 else {
            return startVelocity * tick
        }
        return startVelocity * (1 - pow(decay, tick)) / (1 - decay)
    }
}

private struct RealisticConfettiParticleFrame {
    let center: CGPoint
    let opacity: Double
    let tilt: Double
    let pointScale: CGFloat
}

private enum RealisticConfettiParticleShape {
    case square
    case rectangle
    case circle

    static func random(using generator: inout RealisticConfettiRandomGenerator) -> RealisticConfettiParticleShape {
        let roll = generator.nextUnit()
        if roll < 0.58 {
            return .square
        }
        if roll < 0.82 {
            return .circle
        }
        return .rectangle
    }

    func path(
        center: CGPoint,
        scalar: CGFloat,
        tilt: Double,
        random: Double,
        pointScale: CGFloat
    ) -> Path {
        switch self {
        case .square:
            return quadPath(
                center: center,
                width: 8 * scalar * pointScale,
                height: 8 * scalar * pointScale,
                tilt: tilt,
                random: random
            )
        case .rectangle:
            return quadPath(
                center: center,
                width: 13 * scalar * pointScale,
                height: 5 * scalar * pointScale,
                tilt: tilt,
                random: random
            )
        case .circle:
            let width = 8 * scalar * pointScale
            let height = width * CGFloat(0.64 + 0.24 * abs(sin(tilt)))
            return Path(
                ellipseIn: CGRect(
                    x: center.x - width / 2,
                    y: center.y - height / 2,
                    width: width,
                    height: height
                )
            )
        }
    }

    private func quadPath(center: CGPoint, width: CGFloat, height: CGFloat, tilt: Double, random: Double) -> Path {
        let rotation = tilt + (random * 0.18)
        let cosRotation = CGFloat(cos(rotation))
        let sinRotation = CGFloat(sin(rotation))
        let halfWidth = width / 2
        let halfHeight = height / 2
        let corners = [
            CGPoint(x: -halfWidth, y: -halfHeight),
            CGPoint(x: halfWidth, y: -halfHeight),
            CGPoint(x: halfWidth, y: halfHeight),
            CGPoint(x: -halfWidth, y: halfHeight)
        ].map { point in
            CGPoint(
                x: center.x + point.x * cosRotation - point.y * sinRotation,
                y: center.y + point.x * sinRotation + point.y * cosRotation
            )
        }

        var path = Path()
        path.move(to: corners[0])
        path.addLine(to: corners[1])
        path.addLine(to: corners[2])
        path.addLine(to: corners[3])
        path.closeSubpath()
        return path
    }
}

private enum RealisticConfettiPaletteColor {
    case cyan
    case purple
    case pink
    case lime
    case yellow
    case orange
    case magenta
    case brandGreen

    static let demoLike: [RealisticConfettiPaletteColor] = [
        .cyan,
        .purple,
        .pink,
        .lime,
        .yellow,
        .orange,
        .magenta,
        .brandGreen
    ]

    static func random(using generator: inout RealisticConfettiRandomGenerator) -> RealisticConfettiPaletteColor {
        demoLike[generator.nextInt(upperBound: demoLike.count)]
    }

    var hex: String {
        switch self {
        case .cyan:
            return "#26CCFF"
        case .purple:
            return "#A25AFD"
        case .pink:
            return "#FF5E7E"
        case .lime:
            return "#88FF5A"
        case .yellow:
            return "#FCFF42"
        case .orange:
            return "#FFA62D"
        case .magenta:
            return "#FF36FF"
        case .brandGreen:
            return "#4BDE80"
        }
    }

    var color: Color {
        switch self {
        case .cyan:
            return Color(red: 0.149, green: 0.800, blue: 1.000)
        case .purple:
            return Color(red: 0.635, green: 0.353, blue: 0.992)
        case .pink:
            return Color(red: 1.000, green: 0.369, blue: 0.494)
        case .lime:
            return Color(red: 0.533, green: 1.000, blue: 0.353)
        case .yellow:
            return Color(red: 0.988, green: 1.000, blue: 0.259)
        case .orange:
            return Color(red: 1.000, green: 0.651, blue: 0.176)
        case .magenta:
            return Color(red: 1.000, green: 0.212, blue: 1.000)
        case .brandGreen:
            return Color(red: 0.294, green: 0.871, blue: 0.502)
        }
    }
}

private struct RealisticConfettiRandomGenerator: RandomNumberGenerator {
    private var state: UInt64

    init(seed: UInt64) {
        state = seed ^ 0x9E3779B97F4A7C15
    }

    mutating func next() -> UInt64 {
        state = state &* 6364136223846793005 &+ 1442695040888963407
        return state
    }

    mutating func nextUnit() -> Double {
        Double(next() >> 11) / Double(UInt64(1) << 53)
    }

    mutating func nextInt(upperBound: Int) -> Int {
        guard upperBound > 0 else { return 0 }
        return Int(next() % UInt64(upperBound))
    }
}

private struct WindowChrome: NSViewRepresentable {
    func makeNSView(context: Context) -> NSView {
        let view = NSView()

        DispatchQueue.main.async {
            guard let window = view.window else { return }

            window.titleVisibility = .hidden
            window.titlebarAppearsTransparent = true
            window.isOpaque = false
            window.backgroundColor = .clear
            window.isMovableByWindowBackground = true
            if CommandLine.arguments.contains("--ui-testing-opaque-window") {
                window.level = .screenSaver
                window.collectionBehavior.insert(.canJoinAllSpaces)
                window.makeKeyAndOrderFront(nil)
                NSApp.activate(ignoringOtherApps: true)
            }
        }

        return view
    }

    func updateNSView(_ nsView: NSView, context: Context) {}
}

private struct WorkspaceWindowChrome: NSViewRepresentable {
    let maximizeOnInitialInstall: Bool
    let markInitialInstallMaximizeApplied: (() -> Void)?

    final class Coordinator {
        var didApplyInitialInstallMaximize = false
        var didApplyUITestingWindowSize = false
    }

    func makeCoordinator() -> Coordinator {
        Coordinator()
    }

    func makeNSView(context: Context) -> NSView {
        let view = NSView()
        configureWindow(for: view, context: context)
        return view
    }

    func updateNSView(_ nsView: NSView, context: Context) {
        configureWindow(for: nsView, context: context)
    }

    private func configureWindow(for view: NSView, context: Context) {
        DispatchQueue.main.async {
            guard let window = view.window else { return }

            window.title = "Agentic30"
            window.titleVisibility = .hidden
            window.titlebarAppearsTransparent = true
            window.toolbarStyle = .unifiedCompact
            window.styleMask.insert(.fullSizeContentView)
            window.appearance = NSAppearance(named: .darkAqua)
            window.isOpaque = true
            window.backgroundColor = NSColor(red: 0.125, green: 0.137, blue: 0.153, alpha: 1.0)
            window.isMovableByWindowBackground = true
            if CommandLine.arguments.contains("--ui-testing-opaque-window") {
                window.level = .screenSaver
                window.collectionBehavior.insert(.canJoinAllSpaces)
                window.makeKeyAndOrderFront(nil)
                NSApp.activate(ignoringOtherApps: true)
            }

            if let testingWindowSize = Self.uiTestingWorkspaceWindowSize() {
                if !context.coordinator.didApplyUITestingWindowSize {
                    context.coordinator.didApplyUITestingWindowSize = true
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) {
                        Self.resize(window, to: testingWindowSize)
                    }
                }
            } else if maximizeOnInitialInstall,
               !context.coordinator.didApplyInitialInstallMaximize {
                context.coordinator.didApplyInitialInstallMaximize = true
                Self.maximizeToVisibleFrame(window)
                markInitialInstallMaximizeApplied?()
            }
        }
    }

    private static func maximizeToVisibleFrame(_ window: NSWindow) {
        guard let visibleFrame = (window.screen ?? NSScreen.main)?.visibleFrame else { return }
        window.setFrame(visibleFrame, display: true, animate: false)
    }

    private static func uiTestingWorkspaceWindowSize() -> CGSize? {
        guard let rawValue = CommandLine.arguments
            .first(where: { $0.hasPrefix("--ui-testing-workspace-window-size=") })?
            .split(separator: "=", maxSplits: 1)
            .last
        else {
            return nil
        }

        let parts = rawValue
            .lowercased()
            .split(separator: "x", maxSplits: 1)
            .compactMap { Double(String($0).trimmingCharacters(in: .whitespacesAndNewlines)) }
        guard parts.count == 2,
              parts[0] >= 900,
              parts[1] >= 720
        else {
            return nil
        }
        return CGSize(width: CGFloat(parts[0]), height: CGFloat(parts[1]))
    }

    private static func resize(_ window: NSWindow, to size: CGSize) {
        let visibleFrame = (window.screen ?? NSScreen.main)?.visibleFrame ?? window.frame
        let requestedContentSize = CGSize(
            width: min(size.width, visibleFrame.width),
            height: min(size.height, visibleFrame.height)
        )
        let frameSize = window.frameRect(forContentRect: CGRect(origin: .zero, size: requestedContentSize)).size
        let origin = CGPoint(
            x: visibleFrame.midX - frameSize.width / 2,
            y: visibleFrame.midY - frameSize.height / 2
        )
        window.setFrame(CGRect(origin: origin, size: frameSize), display: true, animate: false)
    }
}

private extension String {
    var nonEmpty: String? {
        trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : self
    }
}
