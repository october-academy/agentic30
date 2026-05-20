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
    private let workspaceSupportThreadBottomID = "workspace.supportThread.bottom"
    private let workspaceAssistantReadableWidth: CGFloat = 760
    private let workspaceUserReadableWidth: CGFloat = 560

    @State private var currentPromptBindingToken: String?
    @State private var showsBipMissionEvidence = false
    @State private var showsBipCompletionFields = false
    @State private var showsBipReadinessPreview = false
    @State private var showsBipReadinessAdvanced = false
    @State private var showsInlineBipReadinessSetup = false
    @State private var showsWorkspaceEvidenceDetails = false
    @State private var selectedWorkspaceSection: WorkspaceSection = .curriculum
    @State private var selectedCurriculumDetail: WorkspaceCurriculumDetail = .tasks
    @State private var selectedSettingsSection: SettingsSection = .account
    @State private var handledWorkspaceSettingsOpenRequest = 0
    @State private var handledWorkspaceSwitcherTourOpenRequest = 0
    @State private var handledWorkspaceCurriculumNavigatorTourOpenRequest = 0
    @State private var handledWorkspaceSettingsTourOpenRequest = 0
    @State private var handledWorkspaceHelpTourOpenRequest = 0
    @State private var handledWorkspaceRecentConversationsTourOpenRequest = 0
    @State private var isWorkspaceSwitcherTourPresented = false
    @State private var isWorkspaceCurriculumNavigatorTourPresented = false
    @State private var isWorkspaceSettingsTourPresented = false
    @State private var isWorkspaceHelpPresented = false
    @State private var isWorkspaceHelpTourPresented = false
    @State private var isWorkspaceRecentConversationsTourPresented = false
    @State private var workspaceRecentConversationsTourReturnState: WorkspaceTourReturnState?
    @State private var workspaceRecentConversationsScrollRequest = 0
    @State private var handledBipNotificationOpenRequestID: UUID?
    @State private var pendingBipNotificationScrollRequestID: UUID?
    @State private var bipNotificationHintIntent: BipNotificationIntent?
    @State private var isWorkspaceMissionIntroExpanded = false
    @State private var isWorkspaceMissionIntroDismissed = false
    @State private var isWorkspaceSidebarPresented = true
    @State private var isWorkspaceSidebarToggleHovered = false
    @State private var isWorkspaceMissionButtonHovered = false
    @State private var hoveredWorkspaceNavTitle: String?
    @State private var hoveredWorkspaceDay: Int?
    @State private var hoveredWorkspaceFooterItem: WorkspaceFooterItem?
    @State private var hoveredWorkspaceHistorySessionID: String?
    @State private var isWorkspaceNewSessionButtonHovered = false
    // Foundation phase Sub-AC 3: 사이드바 하단 통합 설정 메뉴(프로필/알림/계정/로그아웃/
    // 전체 설정)를 popover로 노출하기 위한 토글 + hover 상태. 기존 gear 아이콘을 직접
    // 풀페이지 Settings로 라우팅하는 대신 popover 안의 항목을 통해 SettingsView의
    // 해당 섹션이나 signOutMacAuth() 같은 액션으로 분기시킨다.
    @State private var showsSidebarSettingsMenu = false
    @State private var hoveredSidebarSettingsMenuItem: SidebarSettingsMenuItem?
    @State private var workspaceCompletionConfettiTrigger = 0
    @State private var lastWorkspaceCompletionConfettiMissionID: String?

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
                handleWorkspaceSettingsOpenRequest()
                handleWorkspaceSwitcherTourOpenRequest()
                handleWorkspaceCurriculumNavigatorTourOpenRequest()
                handleWorkspaceSettingsTourOpenRequest()
                handleWorkspaceHelpTourOpenRequest()
                handleWorkspaceRecentConversationsTourOpenRequest()
                handleBipNotificationOpenRequest()
            }
            .onDisappear {
                if !isWorkspaceWindow {
                    viewModel.stop()
                }
            }
            .onChange(of: viewModel.pendingStructuredPrompt?.uiBindingToken) { _, bindingToken in
                syncPromptDrafts(bindingToken: bindingToken)
            }
            .onChange(of: viewModel.workspaceSettingsOpenRequest) { _, _ in
                handleWorkspaceSettingsOpenRequest()
            }
            .onChange(of: viewModel.workspaceSwitcherTourOpenRequest) { _, _ in
                handleWorkspaceSwitcherTourOpenRequest()
            }
            .onChange(of: viewModel.workspaceCurriculumNavigatorTourOpenRequest) { _, _ in
                handleWorkspaceCurriculumNavigatorTourOpenRequest()
            }
            .onChange(of: viewModel.workspaceSettingsTourOpenRequest) { _, _ in
                handleWorkspaceSettingsTourOpenRequest()
            }
            .onChange(of: viewModel.workspaceHelpTourOpenRequest) { _, _ in
                handleWorkspaceHelpTourOpenRequest()
            }
            .onChange(of: viewModel.workspaceRecentConversationsTourOpenRequest) { _, _ in
                handleWorkspaceRecentConversationsTourOpenRequest()
            }
            .onChange(of: viewModel.bipNotificationOpenRequest?.id) { _, _ in
                handleBipNotificationOpenRequest()
            }
            .onChange(of: viewModel.visibleBipCoach?.currentMission?.id) { _, _ in
                applyBipNotificationIntentToCurrentState()
            }
            .onChange(of: viewModel.visibleBipCoach?.currentMission?.status) { _, status in
                if status == "completed" {
                    showsBipCompletionFields = false
                }
            }
            .onChange(of: currentBipCompletionConfettiMissionID) { _, _ in
                triggerWorkspaceCompletionConfettiIfNeeded()
            }
            .overlay {
                if workspaceCompletionConfettiTrigger > 0 {
                    RealisticConfettiBurst(trigger: workspaceCompletionConfettiTrigger)
                        .id(workspaceCompletionConfettiTrigger)
                        .allowsHitTesting(false)
                        .accessibilityIdentifier("workspace.realisticConfetti")
                }
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

    private var currentBipCompletionConfettiMissionID: String? {
        guard let mission = viewModel.visibleBipCoach?.currentMission,
              mission.status == "completed" else {
            return nil
        }
        return mission.id
    }

    private enum WorkspaceMissionFirstPhase: Equatable {
        case sidecarStarting
        case creatingSession
        case generatingMission
        case ready
        case failed
    }

    private var isIddSetupLocked: Bool {
        viewModel.isIddSetupBlockingWorkspace
    }

    private func workspaceMissionFirstPhase(session: ChatSession?) -> WorkspaceMissionFirstPhase {
        if workspaceMissionFirstErrorMessage(session: session) != nil {
            return .failed
        }
        if session == nil {
            return viewModel.isConnected ? .creatingSession : .sidecarStarting
        }
        if viewModel.isBipCoachGenerating || viewModel.bipMissionProgress != nil {
            return .generatingMission
        }
        return .ready
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
        let day = workspaceSelectedDay

        if shouldUseOpenDesignDayPage(day: day) {
            openDesignDaySurface(day: day, session: nil)
        } else {
            let content = HStack(spacing: 0) {
                workspaceSidebarSlot()

                VStack(spacing: 0) {
                    workspacePreparingToolbar(day: day)
                        .padding(.horizontal, 18)
                        .frame(height: isWorkspaceWindow ? 64 : 54)
                        .background(workspaceTopBarBackground)
                        .zIndex(10)

                    Divider().opacity(0.36)

                    workspacePreparingMainRail(day)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            }

            if isWorkspaceWindow {
                content
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(workspaceShellBackground)
                    .overlay(alignment: .topLeading) {
                        workspaceTourOverlay()
                    }
                    .accessibilityIdentifier("workspace.surface")
            } else {
                content
                    .frame(width: 1136, height: 716)
                    .background(workspaceShellBackground)
                    .clipShape(RoundedRectangle(cornerRadius: 28, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: 28, style: .continuous)
                            .stroke(Color.white.opacity(0.12), lineWidth: 1)
                    )
                    .overlay(alignment: .topLeading) {
                        workspaceTourOverlay()
                    }
                    .accessibilityIdentifier("workspace.surface")
            }
        }
    }

    private func assistantPresentation(for session: ChatSession) -> some View {
        HStack(alignment: .top, spacing: 14) {
            assistantAvatarButton(size: 42)
                .padding(.top, 8)

            assistantBubbleShell(for: session)
        }
        .animation(.spring(response: 0.32, dampingFraction: 0.86), value: viewModel.presentationPhase)
    }

    private var workspaceSelectedDay: AgenticCurriculumDay {
        AgenticCurriculumDay.days.first(where: { $0.day == viewModel.selectedFoundationDay })
            ?? AgenticCurriculumDay.days[0]
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

    private func shouldUseOpenDesignDayPage(day: AgenticCurriculumDay) -> Bool {
        guard selectedWorkspaceSection == .curriculum,
              (day.day == 1 || day.day == 2),
              viewModel.foundationCurriculumPresentationDestination != .graduation else {
            return false
        }
        if let reviewDashboard = viewModel.reviewDayDashboardViewModel,
           reviewDashboard.reviewDay == day.day {
            return false
        }
        if isIddSetupLocked {
            return true
        }
        if bipNotificationHintIntent != nil
            || viewModel.sidecarFailureMessage != nil
            || viewModel.bipTokenExpired != nil
            || viewModel.isBipCoachGenerating
            || viewModel.bipMissionProgress != nil {
            return false
        }
        if let coach = viewModel.visibleBipCoach,
           coach.currentMission != nil || !coach.pendingMissionChoices.isEmpty || coach.lastError?.nonEmpty != nil {
            return false
        }
        return true
    }

    @ViewBuilder
    private func openDesignDaySurface(day: AgenticCurriculumDay, session: ChatSession?) -> some View {
        let day1Content = OpenDesignDayContent.personalized(from: viewModel.scanResult?.day1IcpPlan)
        let resolvedContent = day.day == 2 ? OpenDesignDayContent.day2 : day1Content
        let content = ZStack {
            OpenDesignDayPageView(
                content: viewModel.iddSetupComplete ? resolvedContent : day1Content.lockingFutureDays,
                openSettings: {
                    withAnimation(.spring(response: 0.24, dampingFraction: 0.88)) {
                        selectedWorkspaceSection = .settings
                    }
                },
                submitStructuredPromptChoice: { choice in
                    submitOpenDesignDayChoice(choice, day: day, session: session)
                },
                completeDay: {
                    if viewModel.iddSetupComplete {
                        _ = viewModel.markFoundationDayCompleted(day.day)
                    } else {
                        viewModel.startBipIddQueue(docType: viewModel.iddCurrentDocType)
                    }
                }
            )
        }

        if isWorkspaceWindow {
            content
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(OpenDesignDayColor.bg)
                .overlay(alignment: .topLeading) {
                    workspaceTourOverlay()
                }
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
                .overlay(alignment: .topLeading) {
                    workspaceTourOverlay()
                }
                .accessibilityIdentifier("workspace.surface")
        }
    }

    private func submitOpenDesignDayChoice(
        _ choice: String,
        day: AgenticCurriculumDay,
        session: ChatSession?
    ) {
        if !viewModel.iddSetupComplete {
            viewModel.startBipIddQueue(docType: viewModel.iddCurrentDocType)
        }
    }

    @ViewBuilder
    private func agenticWorkspace(for session: ChatSession) -> some View {
        let day = workspaceSelectedDay

        if shouldUseOpenDesignDayPage(day: day) {
            openDesignDaySurface(day: day, session: session)
        } else {
            let content = HStack(spacing: 0) {
                workspaceSidebarSlot()

                VStack(spacing: 0) {
                    workspaceToolbar(for: session, day: day)
                        .padding(.horizontal, 18)
                        .frame(height: isWorkspaceWindow ? 64 : 54)
                        .background(workspaceTopBarBackground)
                        .zIndex(10)

                    Divider().opacity(0.36)

                    workspaceMainRail(day, session: session)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            }

            if isWorkspaceWindow {
                content
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(workspaceShellBackground)
                    .overlay(alignment: .topLeading) {
                        workspaceTourOverlay()
                    }
                    .accessibilityIdentifier("workspace.surface")
            } else {
                content
                    .frame(width: 1136, height: 716)
                    .background(workspaceShellBackground)
                    .clipShape(RoundedRectangle(cornerRadius: 28, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: 28, style: .continuous)
                            .stroke(Color.white.opacity(0.12), lineWidth: 1)
                    )
                    .overlay(alignment: .topLeading) {
                        workspaceTourOverlay()
                    }
                    .accessibilityIdentifier("workspace.surface")
            }
        }
    }

    private func workspaceToolbar(for session: ChatSession, day: AgenticCurriculumDay) -> some View {
        ZStack(alignment: .topLeading) {
            HStack(spacing: 12) {
                if !isWorkspaceWindow {
                    Button {
                        withAnimation(.spring(response: 0.32, dampingFraction: 0.88)) {
                            viewModel.showAssistantBubble()
                        }
                    } label: {
                        Image(systemName: "chevron.left")
                            .font(.system(size: 14, weight: .bold))
                            .frame(width: 30, height: 30)
                            .background(Circle().fill(Color.white.opacity(0.10)))
                    }
                    .buttonStyle(.plain)
                    .help("Assistant Bubble로 돌아가기")
                    .accessibilityIdentifier("workspace.backToAssistant")
                    .accessibilityLabel("Assistant Bubble로 돌아가기")
                }

                workspaceSidebarToggleButton()

                VStack(alignment: .leading, spacing: 1) {
                    Text(workspaceToolbarTitle(day))
                        .font(.system(size: 15, weight: .bold, design: .rounded))
                        .foregroundStyle(.white.opacity(0.94))
                        .accessibilityIdentifier("workspace.toolbarTitle")
                    Text(workspaceToolbarSubtitle(day: day, session: session))
                        .font(.system(size: 11, weight: .medium, design: .rounded))
                        .foregroundStyle(.white.opacity(0.46))
                }

                Spacer(minLength: 0)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)

            workspaceSidebarToggleTooltip()
                .padding(.leading, isWorkspaceWindow ? 0 : 42)
                .padding(.top, 52)
                .zIndex(100)
        }
    }

    private func workspacePreparingToolbar(day: AgenticCurriculumDay) -> some View {
        ZStack(alignment: .topLeading) {
            HStack(spacing: 12) {
                workspaceSidebarToggleButton()

                VStack(alignment: .leading, spacing: 1) {
                    Text(workspaceToolbarTitle(day))
                        .font(.system(size: 15, weight: .bold, design: .rounded))
                        .foregroundStyle(.white.opacity(0.94))
                        .accessibilityIdentifier("workspace.toolbarTitle")
                    Text(selectedWorkspaceSection == .settings ? "Workspace 환경 설정" : viewModel.connectionLabel)
                        .font(.system(size: 11, weight: .medium, design: .rounded))
                        .foregroundStyle(.white.opacity(0.46))
                }

                Spacer(minLength: 0)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)

            workspaceSidebarToggleTooltip()
                .padding(.top, 52)
                .zIndex(100)
        }
    }

    private func workspaceToolbarTitle(_ day: AgenticCurriculumDay) -> String {
        if selectedWorkspaceSection == .settings {
            return "설정"
        }
        if viewModel.foundationCurriculumPresentationDestination == .graduation {
            return "\(selectedWorkspaceSection.title) / Graduation"
        }
        return "\(selectedWorkspaceSection.title) / Day \(day.day)"
    }

    private func workspaceToolbarSubtitle(day: AgenticCurriculumDay, session: ChatSession) -> String {
        if selectedWorkspaceSection == .settings {
            return "Workspace 환경 설정"
        }
        if viewModel.foundationCurriculumPresentationDestination == .graduation {
            return "30일 커리큘럼 완료 · \(session.provider.title)"
        }
        return "Day \(day.day) · \(day.phase.title) · \(session.provider.title)"
    }

    private func workspaceSidebarToggleButton() -> some View {
        Button {
            withAnimation(.spring(response: 0.22, dampingFraction: 0.92)) {
                isWorkspaceSidebarPresented.toggle()
            }
        } label: {
            Image(systemName: "sidebar.left")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(.white.opacity(isWorkspaceSidebarToggleHovered ? 0.92 : 0.72))
                .frame(width: 34, height: 34)
                .background(
                    Circle()
                        .fill(Color.white.opacity(sidebarToggleFillOpacity))
                )
                .overlay(
                    Circle()
                        .stroke(Color.white.opacity(isWorkspaceSidebarToggleHovered ? 0.14 : 0.0), lineWidth: 1)
                )
        }
        .buttonStyle(.plain)
        .keyboardShortcut("b", modifiers: .command)
        .help("사이드바 토글")
        .accessibilityIdentifier("workspace.toggleCurriculumSidebar")
        .accessibilityLabel(isWorkspaceSidebarPresented ? "커리큘럼 접기" : "커리큘럼 펼치기")
        .onHover { hovering in
            withAnimation(.easeOut(duration: 0.12)) {
                isWorkspaceSidebarToggleHovered = hovering
            }
        }
    }

    private func workspaceSidebarToggleTooltip() -> some View {
        HStack(spacing: 7) {
            Text("사이드바 토글")
                .font(.system(size: 11, weight: .semibold, design: .rounded))
                .lineLimit(1)
            Text("⌘B")
                .font(.system(size: 10, weight: .bold, design: .rounded))
                .lineLimit(1)
                .padding(.horizontal, 6)
                .padding(.vertical, 2)
                .background(Capsule().fill(Color.white.opacity(0.10)))
        }
        .foregroundStyle(.white.opacity(0.82))
        .padding(.horizontal, 10)
        .frame(height: 30)
        .fixedSize(horizontal: true, vertical: false)
        .background(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(Color(red: 0.18, green: 0.20, blue: 0.23).opacity(0.98))
                .overlay(
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .stroke(Color.white.opacity(0.10), lineWidth: 1)
                )
        )
        .shadow(color: Color.black.opacity(0.22), radius: 12, x: 0, y: 8)
        .opacity(isWorkspaceSidebarToggleHovered ? 1 : 0)
        .animation(.easeOut(duration: 0.12), value: isWorkspaceSidebarToggleHovered)
        .allowsHitTesting(false)
    }

    private var sidebarToggleFillOpacity: Double {
        if isWorkspaceSidebarToggleHovered {
            return 0.18
        }
        return isWorkspaceSidebarPresented ? 0.12 : 0.07
    }

    private var workspaceMissionButtonForegroundOpacity: Double {
        if viewModel.isBipCoachGenerating {
            return 0.40
        }

        return isWorkspaceMissionButtonHovered ? 0.96 : 0.88
    }

    private var workspaceMissionButtonFillOpacity: Double {
        if viewModel.isBipCoachGenerating {
            return 0.08
        }

        return isWorkspaceMissionButtonHovered ? 0.18 : 0.13
    }

    @ViewBuilder
    private func workspaceSidebar() -> some View {
        let content = VStack(alignment: .leading, spacing: 0) {
            workspaceSidebarBrand()
                .padding(.horizontal, 14)
                .padding(.top, 16)
                .padding(.bottom, 10)

            // Foundation phase Day N/30 counter — sits between the brand
            // and the section navigation so the user sees their position in
            // the 30-day program before any other workspace chrome. Always
            // visible (curriculum + settings) to anchor the timeline.
            workspaceSidebarFoundationCounter()
                .padding(.horizontal, 14)
                .padding(.bottom, 14)

            if selectedWorkspaceSection == .settings {
                workspaceSettingsSidebarMenu()
                    .padding(.horizontal, 12)

                Spacer(minLength: 0)
            } else {
                VStack(alignment: .leading, spacing: 6) {
                    workspaceSidebarNavRow(
                        title: "30일 커리큘럼",
                        subtitle: "30일 실행 플랜",
                        isSelected: selectedWorkspaceSection == .curriculum
                    ) {
                        selectedWorkspaceSection = .curriculum
                    }
                }
                .padding(.horizontal, 12)
                .padding(.bottom, 12)

                ScrollViewReader { proxy in
                    ScrollView {
                        VStack(alignment: .leading, spacing: 0) {
                            workspaceCurriculumPathSection()
                                .padding(.horizontal, 10)
                                .padding(.bottom, 12)

                            // Foundation phase Sub-AC 2: 사이드바 중단에 누적
                            // 기록(과거 채팅 세션 / 일자별 요약)을 노출한다.
                            // AgenticViewModel.sessions에서 history를 로드해 일자별로
                            // 그룹화하고, 클릭하면 해당 세션을 활성화한다. 빈 상태에서는
                            // EmptyView로 접혀 사이드바 레이아웃이 흐트러지지 않는다.
                            workspaceSidebarHistorySection()
                                .id("workspace.sidebar.historySection.scrollTarget")
                        }
                    }
                    .onChange(of: workspaceRecentConversationsScrollRequest) { _, _ in
                        withAnimation(.spring(response: 0.24, dampingFraction: 0.9)) {
                            proxy.scrollTo("workspace.sidebar.historySection.scrollTarget", anchor: .top)
                        }
                    }
                    .onAppear {
                        if isWorkspaceRecentConversationsTourPresented {
                            proxy.scrollTo("workspace.sidebar.historySection.scrollTarget", anchor: .top)
                        }
                    }
                }
                .accessibilityIdentifier("workspace.curriculumSidebar")

                Spacer(minLength: 0)
            }

            workspaceSidebarFooter()
                .padding(12)
                .zIndex(20)
        }

        if isWorkspaceWindow {
            content
                .background(workspaceSidebarBackground)
                .overlay(alignment: .trailing) {
                    Divider().opacity(0.38)
                }
        } else {
            content
                .background(workspaceSidebarBackground)
                .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 24, style: .continuous)
                        .stroke(Color.white.opacity(0.13), lineWidth: 1)
                )
                .shadow(color: Color.black.opacity(reduceTransparency ? 0.0 : 0.20), radius: 24, x: 0, y: 14)
        }
    }

    private func workspaceSettingsSidebarMenu() -> some View {
        VStack(alignment: .leading, spacing: 14) {
            Button {
                withAnimation(.spring(response: 0.24, dampingFraction: 0.88)) {
                    selectedWorkspaceSection = .curriculum
                }
            } label: {
                HStack(spacing: 10) {
                    Image(systemName: "arrow.left")
                        .font(.system(size: 14, weight: .regular))
                        .frame(width: 20, alignment: .center)
                    Text("앱으로 돌아가기")
                        .font(.system(size: 13, weight: .semibold, design: .rounded))
                        .lineLimit(1)
                    Spacer(minLength: 0)
                }
                .foregroundStyle(.white.opacity(hoveredWorkspaceNavTitle == "settings.back" ? 0.90 : 0.58))
                .padding(.horizontal, 10)
                .frame(height: 40)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .fill(Color.white.opacity(workspaceSidebarRowFillOpacity(
                            isSelected: false,
                            isHovered: hoveredWorkspaceNavTitle == "settings.back"
                        )))
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .stroke(Color.white.opacity(hoveredWorkspaceNavTitle == "settings.back" ? 0.12 : 0.0), lineWidth: 1)
                )
                .contentShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            }
            .buttonStyle(.plain)
            .onHover { hovering in
                hoveredWorkspaceNavTitle = hovering ? "settings.back" : nil
            }
            .animation(.easeOut(duration: 0.12), value: hoveredWorkspaceNavTitle == "settings.back")
            .padding(.bottom, 2)
            .accessibilityIdentifier("workspace.settingsBackButton")

            VStack(alignment: .leading, spacing: 4) {
                ForEach(SettingsSection.allCases) { section in
                    workspaceSettingsSidebarRow(section)
                }
            }
        }
        .accessibilityIdentifier("workspace.settingsSidebar")
    }

    private func workspaceSettingsSidebarRow(_ section: SettingsSection) -> some View {
        let hoverKey = "settings.\(section.sidebarTitle)"
        let isHovered = hoveredWorkspaceNavTitle == hoverKey
        let isSelected = selectedSettingsSection == section

        return Button {
            withAnimation(.spring(response: 0.22, dampingFraction: 0.90)) {
                selectedSettingsSection = section
            }
        } label: {
            HStack(spacing: 10) {
                Image(systemName: section.systemImage)
                    .font(.system(size: 13, weight: .semibold))
                    .frame(width: 20)
                Text(section.sidebarTitle)
                    .font(.system(size: 13, weight: .bold, design: .rounded))
                    .lineLimit(1)
                Spacer(minLength: 0)
            }
            .foregroundStyle(.white.opacity(isSelected || isHovered ? 0.90 : 0.58))
            .padding(.horizontal, 10)
            .frame(height: 36)
            .background(
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .fill(Color.white.opacity(workspaceSidebarRowFillOpacity(isSelected: isSelected, isHovered: isHovered)))
            )
            .overlay(
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .stroke(Color.white.opacity(isHovered ? 0.12 : 0.0), lineWidth: 1)
            )
            .contentShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        }
        .buttonStyle(.plain)
        .onHover { hovering in
            hoveredWorkspaceNavTitle = hovering ? hoverKey : nil
        }
        .animation(.easeOut(duration: 0.12), value: isHovered)
        .accessibilityIdentifier("workspace.settingsSection.\(section.sidebarTitle)")
    }

    private func workspaceSidebarSlot() -> some View {
        workspaceSidebar()
            .frame(width: isWorkspaceWindow ? 320 : 278)
            .padding(.leading, isWorkspaceWindow ? 0 : 12)
            .padding(.vertical, isWorkspaceWindow ? 0 : 12)
            .frame(width: isWorkspaceSidebarPresented ? (isWorkspaceWindow ? 320 : 290) : 0, alignment: .leading)
            .opacity(isWorkspaceSidebarPresented ? 1 : 0)
            .clipped()
            .allowsHitTesting(isWorkspaceSidebarPresented)
            .accessibilityHidden(!isWorkspaceSidebarPresented)
            .animation(.spring(response: 0.22, dampingFraction: 0.92), value: isWorkspaceSidebarPresented)
    }

    private func workspaceSidebarBrand() -> some View {
        HStack(spacing: 10) {
            Image("StatusBarIcon")
                .renderingMode(.template)
                .resizable()
                .scaledToFit()
                .foregroundStyle(.white.opacity(0.94))
                .frame(width: 26, height: 26)

            Text("Agentic30")
                .font(.system(size: 22, weight: .bold, design: .rounded))
                .foregroundStyle(.white.opacity(0.94))
                .lineLimit(1)

            Spacer(minLength: 0)
        }
    }

    /// Day N/30 counter rendered at the top of the workspace sidebar. The
    /// label is driven by `viewModel.foundationStartedAt` (an em-dash slot
    /// is shown until the anchor is set), and the rail tracks
    /// `viewModel.foundationProgress` (0…1). The Foundation phase only
    /// covers Day 0–7, but we display the full 30-day denominator so the
    /// user sees the program shape from day one — Foundation is the first
    /// segment of a longer arc, not a standalone milestone.
    @ViewBuilder
    private func workspaceSidebarFoundationCounter() -> some View {
        let dayLabel = viewModel.foundationDayLabel
        let progress = viewModel.foundationProgress
        let percentLabel = "\(Int(round(progress * 100)))%"

        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                Text(dayLabel)
                    .font(.system(size: 13, weight: .bold, design: .rounded))
                    .foregroundStyle(.white.opacity(0.92))
                    .accessibilityIdentifier("workspace.sidebar.dayCounter.label")

                Spacer(minLength: 0)
            }

            GeometryReader { proxy in
                ZStack(alignment: .leading) {
                    Capsule()
                        .fill(Color.white.opacity(0.08))
                    Capsule()
                        .fill(Color.white.opacity(0.78))
                        .frame(width: max(2, proxy.size.width * progress))
                        .animation(.easeOut(duration: 0.18), value: progress)
                }
            }
            .frame(height: 4)
            .accessibilityIdentifier("workspace.sidebar.dayCounter.progress")
        }
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("workspace.sidebar.dayCounter")
        .accessibilityLabel("\(dayLabel), Foundation 진행률 \(percentLabel)")
    }

    private func workspaceSidebarNavRow(
        title: String,
        subtitle: String,
        isSelected: Bool,
        action: @escaping () -> Void
    ) -> some View {
        let isHovered = hoveredWorkspaceNavTitle == title

        return Button(action: action) {
            HStack(spacing: 0) {
                VStack(alignment: .leading, spacing: 1) {
                    Text(title)
                        .font(.system(size: 13, weight: .bold, design: .rounded))
                        .foregroundStyle(.white.opacity(isSelected || isHovered ? 0.94 : 0.62))
                        .lineLimit(1)
                    Text(subtitle)
                        .font(.system(size: 10, weight: .medium, design: .rounded))
                        .foregroundStyle(.white.opacity(isSelected || isHovered ? 0.50 : 0.34))
                        .lineLimit(1)
                }

                Spacer(minLength: 0)
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 9)
            .background(
                RoundedRectangle(cornerRadius: 11, style: .continuous)
                    .fill(Color.white.opacity(workspaceSidebarRowFillOpacity(isSelected: isSelected, isHovered: isHovered)))
            )
            .overlay(
                RoundedRectangle(cornerRadius: 11, style: .continuous)
                    .stroke(Color.white.opacity(isHovered ? 0.12 : 0.0), lineWidth: 1)
            )
            .contentShape(RoundedRectangle(cornerRadius: 11, style: .continuous))
        }
        .buttonStyle(.plain)
        .onHover { hovering in
            hoveredWorkspaceNavTitle = hovering ? title : nil
        }
        .animation(
            .easeOut(duration: 0.12),
            value: isHovered
        )
    }

    private func workspaceCurriculumPathSection() -> some View {
        LazyVStack(alignment: .leading, spacing: 5) {
            ForEach(AgenticCurriculumDay.days.prefix(7)) { day in
                workspaceSidebarRow(day, state: workspaceSidebarState(for: day))
            }

            workspaceSidebarFutureModule()
                .padding(.top, 7)
        }
    }

    private enum WorkspaceSidebarDayState: Equatable {
        case active
        case available
        case locked(requiredDay: Int)
    }

    private func workspaceSidebarState(for day: AgenticCurriculumDay) -> WorkspaceSidebarDayState {
        if isIddSetupLocked {
            return viewModel.selectedFoundationDay == day.day ? .active : .locked(requiredDay: 0)
        }
        if viewModel.selectedFoundationDay == day.day {
            return .active
        }
        if viewModel.isFoundationDayUnlocked(day.day) {
            return .available
        }
        return .locked(requiredDay: day.day - 1)
    }

    private func workspaceSidebarRow(_ day: AgenticCurriculumDay, state: WorkspaceSidebarDayState) -> some View {
        let selected = viewModel.selectedFoundationDay == day.day
        let isHovered = hoveredWorkspaceDay == day.day
        let isLocked: Bool = {
            if case .locked = state {
                return true
            }
            return false
        }()

        return Button {
            guard !isLocked else { return }
            withAnimation(.spring(response: 0.24, dampingFraction: 0.88)) {
                viewModel.selectFoundationDay(day.day)
                selectedWorkspaceSection = .curriculum
            }
        } label: {
            HStack(spacing: 0) {
                VStack(alignment: .leading, spacing: 1) {
                    Text("Day \(day.day)")
                        .font(.system(size: 12, weight: .bold, design: .rounded))
                        .foregroundStyle(workspaceSidebarDayTextColor(state: state, isHovered: isHovered))
                    Text(day.shortTitle)
                        .font(.system(size: 11, weight: .medium, design: .rounded))
                        .foregroundStyle(workspaceSidebarDaySubtitleColor(state: state, isHovered: isHovered))
                        .lineLimit(1)
                }

                Spacer(minLength: 0)

                if isLocked {
                    if isHovered, let lockedHelp = workspaceSidebarLockedHelp(for: state) {
                        workspaceSidebarLockedHoverTooltip(lockedHelp)
                            .transition(.opacity)
                            .padding(.trailing, 7)
                    }
                }
            }
            .padding(.horizontal, 9)
            .padding(.vertical, 7)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .fill(Color.white.opacity(workspaceSidebarRowFillOpacity(
                        isSelected: selected,
                        isHovered: isHovered,
                        isLocked: isLocked
                    )))
            )
            .overlay(
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .stroke(workspaceSidebarDayBorderColor(day: day, state: state, isHovered: isHovered), lineWidth: 1)
            )
            .contentShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        }
        .buttonStyle(.plain)
        .workspaceSidebarLockedTooltip(workspaceSidebarLockedHelp(for: state))
        .onHover { hovering in
            hoveredWorkspaceDay = hovering ? day.day : nil
        }
        .animation(
            .easeInOut(duration: 0.16),
            value: isHovered
        )
        .accessibilityIdentifier("workspace.day.\(day.day)")
        .accessibilityLabel(workspaceSidebarAccessibilityLabel(day: day, state: state))
    }

    private func workspaceSidebarLockedHoverTooltip(_ text: String) -> some View {
        Text(text)
            .font(.system(size: 10, weight: .bold, design: .rounded))
            .foregroundStyle(.white.opacity(0.88))
            .lineLimit(1)
            .padding(.horizontal, 8)
            .padding(.vertical, 5)
            .background(
                Capsule()
                    .fill(Color(red: 0.06, green: 0.07, blue: 0.08).opacity(0.94))
            )
            .overlay(
                Capsule()
                    .stroke(Color.white.opacity(0.12), lineWidth: 1)
            )
            .shadow(color: .black.opacity(0.24), radius: 8, y: 3)
            .allowsHitTesting(false)
            .accessibilityHidden(true)
    }

    private func workspaceSidebarLockedHelp(for state: WorkspaceSidebarDayState) -> String? {
        if case .locked(let requiredDay) = state {
            if requiredDay == 0 {
                return "Foundation Setup을 승인해야 이동할 수 있어요."
            }
            return "Day \(requiredDay)을 마쳐야 접근할 수 있어요."
        }
        return nil
    }

    private func workspaceSidebarAccessibilityLabel(day: AgenticCurriculumDay, state: WorkspaceSidebarDayState) -> String {
        if let lockedHelp = workspaceSidebarLockedHelp(for: state) {
            return "Day \(day.day), \(day.title), 잠김, \(lockedHelp)"
        }
        return "Day \(day.day), \(day.title)"
    }

    private func workspaceSidebarDayTextColor(state: WorkspaceSidebarDayState, isHovered: Bool) -> Color {
        switch state {
        case .active:
            return .white.opacity(0.96)
        case .available:
            return .white.opacity(isHovered ? 0.90 : 0.68)
        case .locked:
            return .white.opacity(isHovered ? 0.46 : 0.30)
        }
    }

    private func workspaceSidebarDaySubtitleColor(state: WorkspaceSidebarDayState, isHovered: Bool) -> Color {
        switch state {
        case .active:
            return .white.opacity(0.70)
        case .available:
            return .white.opacity(isHovered ? 0.62 : 0.42)
        case .locked:
            return .white.opacity(isHovered ? 0.34 : 0.24)
        }
    }

    private func workspaceSidebarDayBorderColor(day: AgenticCurriculumDay, state: WorkspaceSidebarDayState, isHovered: Bool) -> Color {
        switch state {
        case .active:
            return workspaceAccentColor(for: day.phase).opacity(0.20)
        case .available:
            return workspaceAccentColor(for: day.phase).opacity(isHovered ? 0.16 : 0.0)
        case .locked:
            return Color.white.opacity(isHovered ? 0.07 : 0.0)
        }
    }

    private func workspaceSidebarFutureModule() -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Text("이어지는 빌드 여정")
                    .font(.system(size: 12, weight: .bold, design: .rounded))
                    .foregroundStyle(.white.opacity(0.72))
                    .lineLimit(1)

                Spacer(minLength: 0)
            }

            Text("Day 7을 마치면 Day 8부터 이어집니다")
                .font(.system(size: 10, weight: .semibold, design: .rounded))
                .foregroundStyle(.white.opacity(0.36))
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 11)
        .background(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(Color.white.opacity(0.035))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(Color.white.opacity(0.075), lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("workspace.curriculumFutureModule")
        .accessibilityLabel("이어지는 빌드 여정, Pro, Day 7을 마치면 Day 8부터 이어집니다")
    }

    private func workspaceSidebarRowFillOpacity(isSelected: Bool, isHovered: Bool, isLocked: Bool = false) -> Double {
        if isLocked {
            return isHovered ? 0.04 : 0.0
        }
        if isSelected {
            return isHovered ? 0.145 : 0.105
        }

        return isHovered ? 0.075 : 0.0
    }

    /// Foundation phase Sub-AC 2: 사이드바 중단(curriculum 스크롤 하단)에 누적
    /// 채팅 기록을 일자별로 묶어 노출한다. `AgenticViewModel.sessions`는 이미
    /// `updatedAt` desc로 정렬되어 publish되므로 별도 정렬을 추가하지 않는다.
    /// 빈 상태에서도 새 대화 시작점을 유지해 첫 사용자가 메뉴바로 돌아가지
    /// 않고 바로 Codex 세션을 열 수 있게 한다.
    @ViewBuilder
    private func workspaceSidebarHistorySection() -> some View {
        let sessions = viewModel.sessions.filter { $0.archivedAt == nil }
        let groups = workspaceSidebarHistoryGroups(from: sessions)
        VStack(alignment: .leading, spacing: 10) {
            workspaceSidebarHistoryHeader()

            if sessions.isEmpty {
                workspaceSidebarHistoryEmptyState()
            } else {
                VStack(alignment: .leading, spacing: 12) {
                    ForEach(groups) { group in
                        VStack(alignment: .leading, spacing: 4) {
                            Text(group.label)
                                .font(.system(size: 10, weight: .bold, design: .rounded))
                                .foregroundStyle(.white.opacity(0.34))
                                .padding(.horizontal, 4)
                                .accessibilityIdentifier("workspace.sidebar.historyGroup.\(group.id).label")

                            ForEach(group.sessions) { session in
                                workspaceSidebarHistoryRow(session)
                            }
                        }
                        .accessibilityIdentifier("workspace.sidebar.historyGroup.\(group.id)")
                    }
                }
            }
        }
        .padding(.horizontal, 10)
        .padding(.top, 14)
        .padding(.bottom, 12)
        .accessibilityIdentifier("workspace.sidebar.historySection")
    }

    private func workspaceSidebarHistoryHeader() -> some View {
        HStack(spacing: 8) {
            Text("최근 대화")
                .font(.system(size: 11, weight: .heavy, design: .rounded))
                .tracking(0.5)
                .textCase(.uppercase)
                .foregroundStyle(.white.opacity(0.52))
                .lineLimit(1)
                .accessibilityIdentifier("workspace.sidebar.historyTitle")

            Spacer(minLength: 0)

            workspaceSidebarNewCodexSessionButton()
        }
        .padding(.horizontal, 4)
    }

    private func workspaceSidebarNewCodexSessionButton() -> some View {
        let canCreateSession = viewModel.isConnected && !isIddSetupLocked
        return Button {
            startNewCodexSessionFromSidebar()
        } label: {
            Image(systemName: "plus")
                .font(.system(size: 11, weight: .heavy))
                .foregroundStyle(.white.opacity(
                    canCreateSession ? (isWorkspaceNewSessionButtonHovered ? 0.94 : 0.70) : 0.28
                ))
                .frame(width: 24, height: 24)
                .background(
                    Circle()
                        .fill(Color.white.opacity(
                            canCreateSession ? (isWorkspaceNewSessionButtonHovered ? 0.115 : 0.065) : 0.03
                        ))
                )
                .overlay(
                    Circle()
                        .stroke(
                            Color.white.opacity(canCreateSession && isWorkspaceNewSessionButtonHovered ? 0.14 : 0.0),
                            lineWidth: 1
                        )
                )
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .disabled(!canCreateSession)
        .help(canCreateSession ? "새 Codex 대화 시작" : (isIddSetupLocked ? "Foundation Setup 승인 후 새 대화를 시작할 수 있어요" : "사이드카 연결 후 새 대화를 시작할 수 있어요"))
        .onHover { hovering in
            isWorkspaceNewSessionButtonHovered = hovering
        }
        .animation(.easeOut(duration: 0.12), value: isWorkspaceNewSessionButtonHovered)
        .accessibilityIdentifier("workspace.sidebar.newCodexSessionButton")
        .accessibilityLabel("새 Codex 대화 시작")
        .accessibilityHint(canCreateSession ? "새 Codex 세션을 만들고 바로 선택합니다." : (isIddSetupLocked ? "Foundation Setup 승인 후 새 대화를 시작할 수 있어요." : "사이드카 연결 후 새 대화를 시작할 수 있어요."))
    }

    private func workspaceSidebarHistoryEmptyState() -> some View {
        let isPreparingFoundationSession = !viewModel.requiresMacOnboarding
            && isIddSetupLocked
            && viewModel.sidecarFailureMessage == nil
            && viewModel.iddSetupStatus != "error"
            && viewModel.iddSetupStatus != "preview_ready"
        let title = workspaceSidebarHistoryEmptyTitle(isPreparingFoundationSession: isPreparingFoundationSession)
        let subtitle = workspaceSidebarHistoryEmptySubtitle(isPreparingFoundationSession: isPreparingFoundationSession)

        return VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .center, spacing: 7) {
                if isPreparingFoundationSession {
                    ProgressView()
                        .controlSize(.mini)
                        .scaleEffect(0.56)
                        .frame(width: 14, height: 14)
                        .tint(.white.opacity(0.62))
                }

                Text(title)
                    .font(.system(size: 12, weight: .bold, design: .rounded))
                    .foregroundStyle(.white.opacity(0.66))
                    .lineLimit(1)
            }

            Text(subtitle)
                .font(.system(size: 10, weight: .semibold, design: .rounded))
                .foregroundStyle(.white.opacity(0.38))
                .fixedSize(horizontal: false, vertical: true)

            if !isPreparingFoundationSession {
                Button {
                    startNewCodexSessionFromSidebar()
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "plus")
                            .font(.system(size: 10, weight: .heavy))
                        Text("새 대화 시작")
                            .font(.system(size: 10, weight: .heavy, design: .rounded))
                    }
                    .foregroundStyle(.white.opacity(viewModel.isConnected ? 0.80 : 0.30))
                    .padding(.horizontal, 9)
                    .frame(height: 26)
                    .background(Capsule().fill(Color.white.opacity(viewModel.isConnected ? 0.07 : 0.03)))
                }
                .buttonStyle(.plain)
                .disabled(!viewModel.isConnected)
                .accessibilityIdentifier("workspace.sidebar.emptyNewCodexSessionButton")
                .accessibilityLabel("새 Codex 대화 시작")
                .accessibilityHint(
                    viewModel.isConnected ? "새 Codex 세션을 만들고 바로 선택합니다." : "사이드카 연결 후 새 대화를 시작할 수 있어요."
                )
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 11)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 11, style: .continuous)
                .fill(Color.white.opacity(0.035))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 11, style: .continuous)
                .stroke(Color.white.opacity(0.065), lineWidth: 1)
        )
        .accessibilityIdentifier("workspace.sidebar.historyEmptyState")
    }

    private func workspaceSidebarHistoryEmptyTitle(isPreparingFoundationSession: Bool) -> String {
        if viewModel.iddSetupStatus == "preview_ready" {
            return "확인 대기 중"
        }
        if viewModel.iddSetupStatus == "error" {
            return "질문 준비 실패"
        }
        if isPreparingFoundationSession {
            return "세션 준비 중"
        }
        return viewModel.isConnected ? "아직 대화가 없어요" : "사이드카 연결 중"
    }

    private func workspaceSidebarHistoryEmptySubtitle(isPreparingFoundationSession: Bool) -> String {
        switch viewModel.iddSetupStatus {
        case "preview_ready":
            return "확인하면 바로 오늘 할 일을 만들 수 있어요."
        case "error":
            return "Foundation Setup 질문 준비가 멈췄습니다."
        default:
            break
        }

        guard isPreparingFoundationSession else {
            return viewModel.isConnected
                ? "새 Codex 대화로 바로 시작하세요."
                : "연결되면 새 대화를 시작할 수 있어요."
        }

        switch viewModel.iddSetupStatus {
        case "provider_recovery":
            return "Provider 인증을 확인하면 질문 준비를 이어갑니다."
        default:
            let doc = viewModel.iddCurrentDocType?.uppercased() ?? "ICP"
            return "\(doc) 인터뷰 질문 카드를 준비하고 있어요."
        }
    }

    private func startNewCodexSessionFromSidebar() {
        guard viewModel.isConnected else { return }
        viewModel.createSession(provider: .codex, source: "workspace_sidebar_history_header")
        withAnimation(.spring(response: 0.22, dampingFraction: 0.92)) {
            selectedWorkspaceSection = .curriculum
        }
    }

    private func workspaceSidebarHistoryRow(_ session: ChatSession) -> some View {
        let isSelected = session.id == viewModel.selectedSessionID
        let isHovered = hoveredWorkspaceHistorySessionID == session.id
        let title = workspaceSidebarHistoryTitle(for: session)
        let preview = workspaceSidebarHistoryPreview(for: session)
        let timeLabel = workspaceSidebarHistoryTimeLabel(for: session)

        return HStack(alignment: .top, spacing: 10) {
            Circle()
                .fill(workspaceSidebarHistoryStatusColor(for: session))
                .frame(width: 6, height: 6)
                .padding(.top, 7)

            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(title)
                        .font(.system(size: 12, weight: .bold, design: .rounded))
                        .foregroundStyle(.white.opacity(isSelected || isHovered ? 0.94 : 0.72))
                        .lineLimit(1)

                    Spacer(minLength: 0)

                    if isHovered {
                        workspaceSidebarHistoryArchiveButton(session)
                    } else {
                        Text(timeLabel)
                            .font(.system(size: 9, weight: .semibold, design: .rounded))
                            .foregroundStyle(.white.opacity(isSelected ? 0.52 : 0.36))
                            .lineLimit(1)
                    }
                }

                if let preview {
                    Text(preview)
                        .font(.system(size: 10, weight: .medium, design: .rounded))
                        .foregroundStyle(.white.opacity(isSelected || isHovered ? 0.62 : 0.42))
                        .lineLimit(1)
                }
            }
        }
        .padding(.horizontal, 9)
        .padding(.vertical, 7)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .fill(Color.white.opacity(workspaceSidebarRowFillOpacity(
                    isSelected: isSelected,
                    isHovered: isHovered
                )))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .stroke(Color.white.opacity(isHovered ? 0.10 : 0.0), lineWidth: 1)
        )
        .contentShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        .onTapGesture {
            openWorkspaceHistorySession(session)
        }
        .onHover { hovering in
            hoveredWorkspaceHistorySessionID = hovering ? session.id : nil
        }
        .animation(.easeOut(duration: 0.12), value: isHovered)
        .accessibilityIdentifier("workspace.sidebar.historyRow.\(session.id)")
        .accessibilityLabel("\(title), \(timeLabel), \(preview ?? "기록 없음")")
        .accessibilityAddTraits(.isButton)
    }

    private func workspaceSidebarHistoryArchiveButton(_ session: ChatSession) -> some View {
        Button {
            viewModel.archiveSession(session, source: "workspace_sidebar_history")
        } label: {
            Image(systemName: "archivebox")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(.white.opacity(0.58))
                .frame(width: 22, height: 22)
                .contentShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
        }
        .buttonStyle(.plain)
        .help("대화 아카이브")
        .accessibilityIdentifier("workspace.sidebar.archiveSessionButton.\(session.id)")
        .accessibilityLabel("대화 아카이브")
    }

    private func openWorkspaceHistorySession(_ session: ChatSession) {
        guard !isIddSetupLocked else { return }
        // Sub-AC 2 contract: 클릭 시 해당 세션을 활성화한다. 이미 settings 섹션에
        // 진입한 상태일 수도 있으므로 .curriculum으로 되돌리고, 이력 진입을
        // PostHog에 기록해 KR4.1 측정 인프라가 클릭률을 추적할 수 있게 한다.
        viewModel.selectSession(session.id)
        withAnimation(.spring(response: 0.22, dampingFraction: 0.92)) {
            selectedWorkspaceSection = .curriculum
        }
        PostHogTelemetry.capture(
            "mac_history_session_opened",
            properties: [
                "session_id": session.id,
                "provider": session.provider.rawValue,
                "source": "workspace_sidebar_history",
            ],
            authSession: viewModel.macAuthSession
        )
    }

    private func workspaceSidebarHistoryTitle(for session: ChatSession) -> String {
        if let trimmed = session.title.trimmingCharacters(in: .whitespacesAndNewlines).nonEmpty {
            return trimmed
        }
        return "새 대화"
    }

    private func workspaceSidebarHistoryPreview(for session: ChatSession) -> String? {
        // 마지막 메시지가 의미있는 텍스트일 때만 미리보기를 보여 준다. session-store가
        // 시작 시 streaming 메시지를 final로 클램핑하므로 여기서는 단순 trim만 한다.
        let preview = session.lastMessagePreview
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return preview.nonEmpty
    }

    private func workspaceSidebarHistoryTimeLabel(for session: ChatSession) -> String {
        let calendar = Calendar.current
        let now = Date()
        let updatedAt = session.updatedAt
        if calendar.isDateInToday(updatedAt) {
            let formatter = DateFormatter()
            formatter.locale = Locale(identifier: "ko_KR")
            formatter.dateFormat = "a h:mm"
            return formatter.string(from: updatedAt)
        }
        if calendar.isDateInYesterday(updatedAt) {
            return "어제"
        }
        let components = calendar.dateComponents([.day], from: updatedAt, to: now)
        if let days = components.day, days < 7 {
            let formatter = DateFormatter()
            formatter.locale = Locale(identifier: "ko_KR")
            formatter.dateFormat = "EEE"
            return formatter.string(from: updatedAt)
        }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "ko_KR")
        formatter.dateFormat = "M/d"
        return formatter.string(from: updatedAt)
    }

    private func workspaceSidebarHistoryStatusColor(for session: ChatSession) -> Color {
        switch session.status {
        case .running:
            return Agentic30BrandColor.greenBright.opacity(0.85)
        case .awaitingInput:
            return Color(red: 1.0, green: 0.78, blue: 0.36).opacity(0.85)
        case .error:
            return Color(red: 1.0, green: 0.45, blue: 0.42).opacity(0.85)
        case .idle:
            return Color.white.opacity(0.30)
        }
    }

    private func workspaceSidebarHistoryGroups(
        from sessions: [ChatSession]
    ) -> [WorkspaceSidebarHistoryGroup] {
        let calendar = Calendar.current
        let now = Date()
        let today = calendar.startOfDay(for: now)
        let yesterday = calendar.date(byAdding: .day, value: -1, to: today) ?? today

        var ordered: [(label: String, sessions: [ChatSession])] = []
        var indexByLabel: [String: Int] = [:]

        for session in sessions {
            let day = calendar.startOfDay(for: session.updatedAt)
            let label: String
            if day == today {
                label = "오늘"
            } else if day == yesterday {
                label = "어제"
            } else {
                let formatter = DateFormatter()
                formatter.locale = Locale(identifier: "ko_KR")
                let components = calendar.dateComponents([.day], from: day, to: today)
                if let days = components.day, days < 7 {
                    formatter.dateFormat = "EEEE"
                } else if calendar.component(.year, from: day) == calendar.component(.year, from: now) {
                    formatter.dateFormat = "M월 d일 (E)"
                } else {
                    formatter.dateFormat = "y년 M월 d일"
                }
                label = formatter.string(from: day)
            }

            if let idx = indexByLabel[label] {
                ordered[idx].sessions.append(session)
            } else {
                indexByLabel[label] = ordered.count
                ordered.append((label: label, sessions: [session]))
            }
        }

        return ordered.map {
            WorkspaceSidebarHistoryGroup(label: $0.label, sessions: $0.sessions)
        }
    }

    private func workspaceSidebarFooter() -> some View {
        ZStack(alignment: .topTrailing) {
            HStack(spacing: 8) {
                workspaceProjectFolderButton()

                // Foundation phase Sub-AC 3: gear 아이콘은 더 이상 풀페이지 설정으로
                // 직접 진입하지 않고, 프로필/알림/계정/로그아웃/전체 설정을 한 곳에 모은
                // 통합 메뉴 popover를 토글한다. popover 내부 항목이 각자 적절한
                // SettingsSection으로 라우팅하거나(전체 설정 보기) 즉시 액션을
                // 실행한다(로그아웃).
                workspaceFooterIconButton(item: .settings, systemName: "gearshape.fill") {
                    showsSidebarSettingsMenu.toggle()
                }
                .popover(
                    isPresented: $showsSidebarSettingsMenu,
                    arrowEdge: .top
                ) {
                    sidebarSettingsMenu()
                        .accessibilityIdentifier("workspace.sidebarSettingsMenu")
                }

                workspaceFooterIconButton(item: .help, systemName: "questionmark.circle.fill") {
                    withAnimation(.spring(response: 0.22, dampingFraction: 0.9)) {
                        isWorkspaceHelpPresented = true
                    }
                }
            }
            .padding(8)
            .background(
                RoundedRectangle(cornerRadius: 13, style: .continuous)
                    .fill(Color.white.opacity(0.055))
                    .overlay(
                        RoundedRectangle(cornerRadius: 13, style: .continuous)
                            .stroke(Color.white.opacity(0.08), lineWidth: 1)
                    )
            )

            workspaceFooterIconTooltip()
                .padding(.trailing, 38)
                .offset(y: -34)
                .zIndex(50)
        }
    }

    private func workspaceProjectFolderButton() -> some View {
        let isHovered = hoveredWorkspaceFooterItem == .projectFolder

        return Button {
            chooseWorkspaceFromSidebar()
        } label: {
            HStack(spacing: 9) {
                Image(systemName: "folder.fill")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(.white.opacity(isHovered ? 0.86 : 0.62))
                    .frame(width: 24, height: 24)
                    .background(Circle().fill(Color.white.opacity(isHovered ? 0.14 : 0.08)))

                VStack(alignment: .leading, spacing: 1) {
                    Text(viewModel.workspaceRoot.nonEmpty.map { ($0 as NSString).lastPathComponent } ?? "Workspace")
                        .font(.system(size: 11, weight: .bold, design: .rounded))
                        .foregroundStyle(.white.opacity(isHovered ? 0.92 : 0.74))
                        .lineLimit(1)
                        .accessibilityIdentifier("workspace.sidebar.projectFolderName")
                    Text("프로젝트 폴더")
                        .font(.system(size: 10, weight: .medium, design: .rounded))
                        .foregroundStyle(.white.opacity(isHovered ? 0.56 : 0.38))
                        .lineLimit(1)
                }

                Spacer(minLength: 0)
            }
            .padding(.horizontal, 7)
            .padding(.vertical, 6)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .fill(Color.white.opacity(isHovered ? 0.085 : 0.0))
            )
            .overlay(
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .stroke(Color.white.opacity(isHovered ? 0.11 : 0.0), lineWidth: 1)
            )
            .contentShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("workspace.sidebar.projectFolderButton")
        .onHover { hovering in
            if hovering {
                hoveredWorkspaceFooterItem = .projectFolder
            } else if hoveredWorkspaceFooterItem == .projectFolder {
                hoveredWorkspaceFooterItem = nil
            }
        }
        .animation(.easeOut(duration: 0.12), value: isHovered)
        .help("프로젝트 디렉토리 설정")
        .accessibilityIdentifier("workspace.projectFolderButton")
    }

    private func workspaceFooterIconButton(
        item: WorkspaceFooterItem,
        systemName: String,
        action: @escaping () -> Void
    ) -> some View {
        let isHovered = hoveredWorkspaceFooterItem == item
        let isSelected = item == .settings && selectedWorkspaceSection == .settings

        return Button(action: action) {
            Image(systemName: systemName)
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(.white.opacity(isSelected || isHovered ? 0.88 : 0.50))
                .frame(width: 30, height: 30)
                .background(
                    Circle()
                        .fill(Color.white.opacity(isSelected ? 0.16 : (isHovered ? 0.13 : 0.06)))
                )
                .overlay(
                    Circle()
                        .stroke(Color.white.opacity(isSelected || isHovered ? 0.13 : 0.0), lineWidth: 1)
                )
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .onHover { hovering in
            if hovering {
                hoveredWorkspaceFooterItem = item
            } else if hoveredWorkspaceFooterItem == item {
                hoveredWorkspaceFooterItem = nil
            }
        }
        .animation(.easeOut(duration: 0.12), value: isHovered)
        .animation(.easeOut(duration: 0.12), value: isSelected)
        .accessibilityLabel(item.helpText)
        .accessibilityIdentifier(item.accessibilityIdentifier)
    }

    private func workspaceFooterIconTooltip() -> some View {
        let text: String? = hoveredWorkspaceFooterItem == .settings ? WorkspaceFooterItem.settings.helpText : nil

        return Text(text ?? "")
            .font(.system(size: 11, weight: .semibold, design: .rounded))
            .foregroundStyle(.white.opacity(0.82))
            .lineLimit(1)
            .padding(.horizontal, 10)
            .frame(height: 30)
            .fixedSize(horizontal: true, vertical: false)
            .background(
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .fill(Color(red: 0.18, green: 0.20, blue: 0.23).opacity(0.98))
                    .overlay(
                        RoundedRectangle(cornerRadius: 10, style: .continuous)
                            .stroke(Color.white.opacity(0.10), lineWidth: 1)
                    )
            )
            .shadow(color: Color.black.opacity(0.22), radius: 12, x: 0, y: 8)
            .opacity(text == nil ? 0 : 1)
            .animation(.easeOut(duration: 0.12), value: text != nil)
            .allowsHitTesting(false)
    }

    private func chooseWorkspaceFromSidebar() {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.allowsMultipleSelection = false
        panel.message = "Select your project workspace root"
        panel.directoryURL = viewModel.workspaceRoot.nonEmpty.map {
            URL(fileURLWithPath: $0, isDirectory: true)
        }

        if panel.runModal() == .OK, let url = panel.url {
            viewModel.setProjectWorkspace(url)
        }
    }

    private func handleWorkspaceSettingsOpenRequest() {
        guard viewModel.workspaceSettingsOpenRequest != handledWorkspaceSettingsOpenRequest else {
            return
        }

        handledWorkspaceSettingsOpenRequest = viewModel.workspaceSettingsOpenRequest
        openWorkspaceSettings()
    }

    private func handleWorkspaceSwitcherTourOpenRequest() {
        guard viewModel.workspaceSwitcherTourOpenRequest != handledWorkspaceSwitcherTourOpenRequest else {
            return
        }

        handledWorkspaceSwitcherTourOpenRequest = viewModel.workspaceSwitcherTourOpenRequest
        withAnimation(.spring(response: 0.24, dampingFraction: 0.88)) {
            selectedWorkspaceSection = .curriculum
            isWorkspaceSidebarPresented = true
            showsSidebarSettingsMenu = false
            isWorkspaceCurriculumNavigatorTourPresented = false
            isWorkspaceSettingsTourPresented = false
            isWorkspaceHelpTourPresented = false
            isWorkspaceHelpPresented = false
            isWorkspaceRecentConversationsTourPresented = false
            isWorkspaceSwitcherTourPresented = true
        }
    }

    private func handleWorkspaceCurriculumNavigatorTourOpenRequest() {
        guard viewModel.workspaceCurriculumNavigatorTourOpenRequest != handledWorkspaceCurriculumNavigatorTourOpenRequest else {
            return
        }

        handledWorkspaceCurriculumNavigatorTourOpenRequest = viewModel.workspaceCurriculumNavigatorTourOpenRequest
        withAnimation(.spring(response: 0.24, dampingFraction: 0.88)) {
            selectedWorkspaceSection = .curriculum
            isWorkspaceSidebarPresented = true
            showsSidebarSettingsMenu = false
            isWorkspaceSwitcherTourPresented = false
            isWorkspaceCurriculumNavigatorTourPresented = true
            isWorkspaceSettingsTourPresented = false
            isWorkspaceHelpTourPresented = false
            isWorkspaceHelpPresented = false
            isWorkspaceRecentConversationsTourPresented = false
        }
    }

    private func handleWorkspaceSettingsTourOpenRequest() {
        guard viewModel.workspaceSettingsTourOpenRequest != handledWorkspaceSettingsTourOpenRequest else {
            return
        }

        handledWorkspaceSettingsTourOpenRequest = viewModel.workspaceSettingsTourOpenRequest
        withAnimation(.spring(response: 0.24, dampingFraction: 0.88)) {
            selectedWorkspaceSection = .settings
            selectedSettingsSection = .account
            isWorkspaceSidebarPresented = true
            showsSidebarSettingsMenu = false
            isWorkspaceSwitcherTourPresented = false
            isWorkspaceCurriculumNavigatorTourPresented = false
            isWorkspaceSettingsTourPresented = true
        }
    }

    private func handleWorkspaceHelpTourOpenRequest() {
        guard viewModel.workspaceHelpTourOpenRequest != handledWorkspaceHelpTourOpenRequest else {
            return
        }

        handledWorkspaceHelpTourOpenRequest = viewModel.workspaceHelpTourOpenRequest
        withAnimation(.spring(response: 0.24, dampingFraction: 0.88)) {
            selectedWorkspaceSection = .curriculum
            isWorkspaceSidebarPresented = true
            showsSidebarSettingsMenu = false
            isWorkspaceSwitcherTourPresented = false
            isWorkspaceCurriculumNavigatorTourPresented = false
            isWorkspaceSettingsTourPresented = false
            isWorkspaceHelpPresented = true
            isWorkspaceHelpTourPresented = true
        }
    }

    private func handleWorkspaceRecentConversationsTourOpenRequest() {
        guard viewModel.workspaceRecentConversationsTourOpenRequest != handledWorkspaceRecentConversationsTourOpenRequest else {
            return
        }

        handledWorkspaceRecentConversationsTourOpenRequest = viewModel.workspaceRecentConversationsTourOpenRequest
        workspaceRecentConversationsTourReturnState = WorkspaceTourReturnState(
            section: selectedWorkspaceSection,
            settingsSection: selectedSettingsSection,
            sidebarPresented: isWorkspaceSidebarPresented,
            helpPresented: isWorkspaceHelpPresented,
            sidebarSettingsMenuPresented: showsSidebarSettingsMenu
        )
        withAnimation(.spring(response: 0.24, dampingFraction: 0.88)) {
            selectedWorkspaceSection = .curriculum
            isWorkspaceSidebarPresented = true
            showsSidebarSettingsMenu = false
            isWorkspaceSwitcherTourPresented = false
            isWorkspaceCurriculumNavigatorTourPresented = false
            isWorkspaceSettingsTourPresented = false
            isWorkspaceHelpTourPresented = false
            isWorkspaceHelpPresented = false
            isWorkspaceRecentConversationsTourPresented = true
            workspaceRecentConversationsScrollRequest += 1
        }
    }

    private func closeWorkspaceRecentConversationsTour() {
        let returnState = workspaceRecentConversationsTourReturnState
        workspaceRecentConversationsTourReturnState = nil

        withAnimation(.spring(response: 0.22, dampingFraction: 0.92)) {
            isWorkspaceRecentConversationsTourPresented = false

            if let returnState {
                selectedWorkspaceSection = returnState.section
                selectedSettingsSection = returnState.settingsSection
                isWorkspaceSidebarPresented = returnState.sidebarPresented
                isWorkspaceHelpPresented = returnState.helpPresented
                showsSidebarSettingsMenu = returnState.sidebarSettingsMenuPresented
            }
        }
    }

    @ViewBuilder
    private func workspaceTourOverlay() -> some View {
        workspaceHelpPanelOverlay()
        workspaceSwitcherTourOverlay()
        workspaceCurriculumNavigatorTourOverlay()
        workspaceSettingsTourOverlay()
        workspaceHelpTourOverlay()
        workspaceRecentConversationsTourOverlay()
    }

    @ViewBuilder
    private func workspaceHelpPanelOverlay() -> some View {
        if isWorkspaceHelpPresented {
            ZStack(alignment: .topLeading) {
                Color.black.opacity(0.26)
                    .ignoresSafeArea()

                VStack(alignment: .leading, spacing: 14) {
                    HStack(spacing: 10) {
                        Image(systemName: "questionmark.circle.fill")
                            .font(.system(size: 17, weight: .bold))
                            .foregroundStyle(Color.white.opacity(0.92))

                        Text("Help")
                            .font(.system(size: 18, weight: .heavy, design: .rounded))
                            .foregroundStyle(.white.opacity(0.96))
                            .accessibilityIdentifier("workspace.helpPanel.title")

                        Spacer(minLength: 0)

                        Button {
                            withAnimation(.spring(response: 0.22, dampingFraction: 0.92)) {
                                isWorkspaceHelpPresented = false
                            }
                        } label: {
                            Image(systemName: "xmark")
                                .font(.system(size: 11, weight: .heavy))
                                .foregroundStyle(.white.opacity(0.72))
                                .frame(width: 28, height: 28)
                                .background(Circle().fill(Color.white.opacity(0.08)))
                        }
                        .buttonStyle(.plain)
                        .accessibilityIdentifier("workspace.helpPanel.close")
                        .accessibilityLabel("Close Help")
                    }

                    Text("Use Help when you want setup guidance, curriculum context, or a path back to the docs. For now, just know this button exists.")
                        .font(.system(size: 13, weight: .semibold, design: .rounded))
                        .foregroundStyle(.white.opacity(0.72))
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityIdentifier("workspace.helpPanel.body")

                    Button {
                        NSWorkspace.shared.open(MacOnboardingConstants.appBaseURL)
                    } label: {
                        Label("Open Help Center", systemImage: "safari")
                            .font(.system(size: 13, weight: .heavy, design: .rounded))
                            .foregroundStyle(Color.black.opacity(0.84))
                            .frame(height: 36)
                            .frame(maxWidth: .infinity)
                            .background(
                                RoundedRectangle(cornerRadius: 8, style: .continuous)
                                    .fill(Color.white.opacity(0.94))
                            )
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("workspace.helpPanel.openDocs")
                }
                .padding(18)
                .frame(width: 360, alignment: .leading)
                .background(
                    RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .fill(Color(red: 0.12, green: 0.13, blue: 0.15).opacity(0.98))
                        .overlay(
                            RoundedRectangle(cornerRadius: 16, style: .continuous)
                                .stroke(Color.white.opacity(0.12), lineWidth: 1)
                        )
                )
                .shadow(color: .black.opacity(0.36), radius: 24, x: 0, y: 14)
                .padding(.leading, isWorkspaceWindow ? 342 : 330)
                .padding(.top, isWorkspaceWindow ? 164 : 150)
            }
            .transition(.opacity)
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("workspace.helpPanel")
        }
    }

    @ViewBuilder
    private func workspaceSwitcherTourOverlay() -> some View {
        if isWorkspaceSwitcherTourPresented {
            ZStack(alignment: .topLeading) {
                Color.black.opacity(0.48)
                    .ignoresSafeArea()

                RoundedRectangle(cornerRadius: isWorkspaceWindow ? 0 : 24, style: .continuous)
                    .stroke(Color.white.opacity(0.84), lineWidth: 2)
                    .frame(width: isWorkspaceWindow ? 320 : 278, height: isWorkspaceWindow ? nil : 692)
                    .padding(.leading, isWorkspaceWindow ? 0 : 12)
                    .padding(.top, isWorkspaceWindow ? 0 : 12)
                    .shadow(color: Color.white.opacity(0.16), radius: 18)
                    .allowsHitTesting(false)

                VStack(alignment: .leading, spacing: 13) {
                    HStack(spacing: 9) {
                        Image(systemName: "sidebar.left")
                            .font(.system(size: 14, weight: .bold))
                            .foregroundStyle(Color.black.opacity(0.78))
                            .frame(width: 28, height: 28)
                            .background(Circle().fill(Color.white.opacity(0.96)))

                        Text("Workspace switcher")
                            .font(.system(size: 17, weight: .heavy, design: .rounded))
                            .foregroundStyle(.white.opacity(0.96))
                            .accessibilityIdentifier("workspace.switcherTour.title")
                    }

                    Text("This left switcher is where you jump between the 30-day path, recent sessions, and workspace settings. You only need to know it exists for now.")
                        .font(.system(size: 13, weight: .semibold, design: .rounded))
                        .foregroundStyle(.white.opacity(0.74))
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityIdentifier("workspace.switcherTour.body")

                    Button {
                        withAnimation(.spring(response: 0.22, dampingFraction: 0.92)) {
                            isWorkspaceSwitcherTourPresented = false
                            isWorkspaceSidebarPresented = false
                        }
                    } label: {
                        Text("Got it")
                            .font(.system(size: 13, weight: .heavy, design: .rounded))
                            .foregroundStyle(Color.black.opacity(0.84))
                            .frame(height: 34)
                            .frame(maxWidth: .infinity)
                            .background(
                                RoundedRectangle(cornerRadius: 8, style: .continuous)
                                    .fill(Color.white.opacity(0.94))
                            )
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("workspace.switcherTour.close")
                }
                .padding(16)
                .frame(width: 316, alignment: .leading)
                .background(
                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .fill(Color(red: 0.12, green: 0.13, blue: 0.15).opacity(0.98))
                        .overlay(
                            RoundedRectangle(cornerRadius: 14, style: .continuous)
                                .stroke(Color.white.opacity(0.12), lineWidth: 1)
                        )
                )
                .shadow(color: .black.opacity(0.34), radius: 22, x: 0, y: 12)
                .padding(.leading, isWorkspaceWindow ? 342 : 318)
                .padding(.top, isWorkspaceWindow ? 78 : 70)
            }
            .transition(.opacity)
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("workspace.switcherTour.overlay")
        }
    }

    @ViewBuilder
    private func workspaceCurriculumNavigatorTourOverlay() -> some View {
        if isWorkspaceCurriculumNavigatorTourPresented {
            ZStack(alignment: .topLeading) {
                Color.black.opacity(0.46)
                    .ignoresSafeArea()

                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .stroke(Color.white.opacity(0.84), lineWidth: 2)
                    .frame(width: isWorkspaceWindow ? 292 : 252, height: 282)
                    .padding(.leading, isWorkspaceWindow ? 14 : 24)
                    .padding(.top, isWorkspaceWindow ? 128 : 134)
                    .shadow(color: Color.white.opacity(0.16), radius: 18)
                    .allowsHitTesting(false)

                VStack(alignment: .leading, spacing: 13) {
                    HStack(spacing: 9) {
                        Image(systemName: "calendar")
                            .font(.system(size: 14, weight: .bold))
                            .foregroundStyle(Color.black.opacity(0.78))
                            .frame(width: 28, height: 28)
                            .background(Circle().fill(Color.white.opacity(0.96)))

                        Text("30-day curriculum navigator")
                            .font(.system(size: 17, weight: .heavy, design: .rounded))
                            .foregroundStyle(.white.opacity(0.96))
                            .accessibilityIdentifier("workspace.curriculumNavigatorTour.title")
                    }

                    Text("The menubar curriculum button opens this 30-day curriculum navigator. It shows the Day path, the current Day, and where upcoming Days will unlock. For now, just know this place exists.")
                        .font(.system(size: 13, weight: .semibold, design: .rounded))
                        .foregroundStyle(.white.opacity(0.74))
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityIdentifier("workspace.curriculumNavigatorTour.body")

                    Button {
                        withAnimation(.spring(response: 0.22, dampingFraction: 0.92)) {
                            isWorkspaceCurriculumNavigatorTourPresented = false
                            isWorkspaceSidebarPresented = false
                        }
                    } label: {
                        Text("Got it")
                            .font(.system(size: 13, weight: .heavy, design: .rounded))
                            .foregroundStyle(Color.black.opacity(0.84))
                            .frame(height: 34)
                            .frame(maxWidth: .infinity)
                            .background(
                                RoundedRectangle(cornerRadius: 8, style: .continuous)
                                    .fill(Color.white.opacity(0.94))
                            )
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("workspace.curriculumNavigatorTour.close")
                }
                .padding(16)
                .frame(width: 346, alignment: .leading)
                .background(
                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .fill(Color(red: 0.12, green: 0.13, blue: 0.15).opacity(0.98))
                        .overlay(
                            RoundedRectangle(cornerRadius: 14, style: .continuous)
                                .stroke(Color.white.opacity(0.12), lineWidth: 1)
                        )
                )
                .shadow(color: .black.opacity(0.34), radius: 22, x: 0, y: 12)
                .padding(.leading, isWorkspaceWindow ? 342 : 318)
                .padding(.top, isWorkspaceWindow ? 132 : 124)
            }
            .transition(.opacity)
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("workspace.curriculumNavigatorTour.overlay")
        }
    }

    @ViewBuilder
    private func workspaceSettingsTourOverlay() -> some View {
        if isWorkspaceSettingsTourPresented {
            ZStack(alignment: .topLeading) {
                Color.black.opacity(0.48)
                    .ignoresSafeArea()

                RoundedRectangle(cornerRadius: isWorkspaceWindow ? 0 : 24, style: .continuous)
                    .stroke(Color.white.opacity(0.84), lineWidth: 2)
                    .frame(width: isWorkspaceWindow ? nil : 818, height: isWorkspaceWindow ? nil : 692)
                    .padding(.leading, isWorkspaceWindow ? 320 : 306)
                    .padding(.top, isWorkspaceWindow ? 0 : 12)
                    .shadow(color: Color.white.opacity(0.16), radius: 18)
                    .allowsHitTesting(false)

                VStack(alignment: .leading, spacing: 13) {
                    HStack(spacing: 9) {
                        Image(systemName: "gearshape.fill")
                            .font(.system(size: 14, weight: .bold))
                            .foregroundStyle(Color.black.opacity(0.78))
                            .frame(width: 28, height: 28)
                            .background(Circle().fill(Color.white.opacity(0.96)))

                        Text("Settings")
                            .font(.system(size: 17, weight: .heavy, design: .rounded))
                            .foregroundStyle(.white.opacity(0.96))
                            .accessibilityIdentifier("workspace.settingsTour.title")
                    }

                    Text("The Settings button opens this panel for account, model, notification, and workspace preferences. You only need to know where it is for now.")
                        .font(.system(size: 13, weight: .semibold, design: .rounded))
                        .foregroundStyle(.white.opacity(0.74))
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityIdentifier("workspace.settingsTour.body")

                    Button {
                        withAnimation(.spring(response: 0.22, dampingFraction: 0.92)) {
                            isWorkspaceSettingsTourPresented = false
                            selectedWorkspaceSection = .curriculum
                            isWorkspaceSidebarPresented = false
                        }
                    } label: {
                        Text("Got it")
                            .font(.system(size: 13, weight: .heavy, design: .rounded))
                            .foregroundStyle(Color.black.opacity(0.84))
                            .frame(height: 34)
                            .frame(maxWidth: .infinity)
                            .background(
                                RoundedRectangle(cornerRadius: 8, style: .continuous)
                                    .fill(Color.white.opacity(0.94))
                            )
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("workspace.settingsTour.close")
                }
                .padding(16)
                .frame(width: 330, alignment: .leading)
                .background(
                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .fill(Color(red: 0.12, green: 0.13, blue: 0.15).opacity(0.98))
                        .overlay(
                            RoundedRectangle(cornerRadius: 14, style: .continuous)
                                .stroke(Color.white.opacity(0.12), lineWidth: 1)
                        )
                )
                .shadow(color: .black.opacity(0.34), radius: 22, x: 0, y: 12)
                .padding(.leading, isWorkspaceWindow ? 342 : 330)
                .padding(.top, isWorkspaceWindow ? 78 : 70)
            }
            .transition(.opacity)
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("workspace.settingsTour.overlay")
        }
    }

    @ViewBuilder
    private func workspaceHelpTourOverlay() -> some View {
        if isWorkspaceHelpTourPresented {
            ZStack(alignment: .topLeading) {
                Color.black.opacity(0.42)
                    .ignoresSafeArea()

                RoundedRectangle(cornerRadius: 17, style: .continuous)
                    .stroke(Color.white.opacity(0.84), lineWidth: 2)
                    .frame(width: 370, height: 202)
                    .padding(.leading, isWorkspaceWindow ? 336 : 324)
                    .padding(.top, isWorkspaceWindow ? 158 : 144)
                    .shadow(color: Color.white.opacity(0.16), radius: 18)
                    .allowsHitTesting(false)

                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .stroke(Color.white.opacity(0.86), lineWidth: 2)
                    .frame(width: 46, height: 46)
                    .padding(.leading, isWorkspaceWindow ? 260 : 248)
                    .padding(.top, isWorkspaceWindow ? 682 : 666)
                    .shadow(color: Color.white.opacity(0.18), radius: 16)
                    .allowsHitTesting(false)

                VStack(alignment: .leading, spacing: 13) {
                    HStack(spacing: 9) {
                        Image(systemName: "questionmark.circle.fill")
                            .font(.system(size: 14, weight: .bold))
                            .foregroundStyle(Color.black.opacity(0.78))
                            .frame(width: 28, height: 28)
                            .background(Circle().fill(Color.white.opacity(0.96)))

                        Text("Help")
                            .font(.system(size: 17, weight: .heavy, design: .rounded))
                            .foregroundStyle(.white.opacity(0.96))
                            .accessibilityIdentifier("workspace.helpTour.title")
                    }

                    Text("The Help button opens this panel for setup guidance and curriculum context. You only need to know where it is for now.")
                        .font(.system(size: 13, weight: .semibold, design: .rounded))
                        .foregroundStyle(.white.opacity(0.74))
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityIdentifier("workspace.helpTour.body")

                    Button {
                        withAnimation(.spring(response: 0.22, dampingFraction: 0.92)) {
                            isWorkspaceHelpTourPresented = false
                            isWorkspaceHelpPresented = false
                            isWorkspaceSidebarPresented = false
                        }
                    } label: {
                        Text("Got it")
                            .font(.system(size: 13, weight: .heavy, design: .rounded))
                            .foregroundStyle(Color.black.opacity(0.84))
                            .frame(height: 34)
                            .frame(maxWidth: .infinity)
                            .background(
                                RoundedRectangle(cornerRadius: 8, style: .continuous)
                                    .fill(Color.white.opacity(0.94))
                            )
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("workspace.helpTour.close")
                }
                .padding(16)
                .frame(width: 330, alignment: .leading)
                .background(
                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .fill(Color(red: 0.12, green: 0.13, blue: 0.15).opacity(0.98))
                        .overlay(
                            RoundedRectangle(cornerRadius: 14, style: .continuous)
                                .stroke(Color.white.opacity(0.12), lineWidth: 1)
                        )
                )
                .shadow(color: .black.opacity(0.34), radius: 22, x: 0, y: 12)
                .padding(.leading, isWorkspaceWindow ? 730 : 700)
                .padding(.top, isWorkspaceWindow ? 172 : 158)
            }
            .transition(.opacity)
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("workspace.helpTour.overlay")
        }
    }

    @ViewBuilder
    private func workspaceRecentConversationsTourOverlay() -> some View {
        if isWorkspaceRecentConversationsTourPresented {
            ZStack(alignment: .topLeading) {
                Color.black.opacity(0.46)
                    .ignoresSafeArea()

                RoundedRectangle(cornerRadius: 15, style: .continuous)
                    .stroke(Color.white.opacity(0.84), lineWidth: 2)
                    .frame(width: isWorkspaceWindow ? 292 : 252, height: 230)
                    .padding(.leading, isWorkspaceWindow ? 14 : 24)
                    .padding(.top, isWorkspaceWindow ? 420 : 392)
                    .shadow(color: Color.white.opacity(0.16), radius: 18)
                    .allowsHitTesting(false)

                VStack(alignment: .leading, spacing: 13) {
                    HStack(spacing: 9) {
                        Image(systemName: "clock.arrow.circlepath")
                            .font(.system(size: 14, weight: .bold))
                            .foregroundStyle(Color.black.opacity(0.78))
                            .frame(width: 28, height: 28)
                            .background(Circle().fill(Color.white.opacity(0.96)))

                        Text("Recent conversations")
                            .font(.system(size: 17, weight: .heavy, design: .rounded))
                            .foregroundStyle(.white.opacity(0.96))
                            .accessibilityIdentifier("workspace.recentConversationsTour.title")
                    }

                    Text("The menubar recent conversations button opens this sidebar history surface. Conversations will appear here after you use Agentic30; for now, just know this place exists for returning to prior threads or starting a fresh Codex thread.")
                        .font(.system(size: 13, weight: .semibold, design: .rounded))
                        .foregroundStyle(.white.opacity(0.74))
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityIdentifier("workspace.recentConversationsTour.body")

                    Button {
                        closeWorkspaceRecentConversationsTour()
                    } label: {
                        Text("Got it")
                            .font(.system(size: 13, weight: .heavy, design: .rounded))
                            .foregroundStyle(Color.black.opacity(0.84))
                            .frame(height: 34)
                            .frame(maxWidth: .infinity)
                            .background(
                                RoundedRectangle(cornerRadius: 8, style: .continuous)
                                    .fill(Color.white.opacity(0.94))
                            )
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("workspace.recentConversationsTour.close")
                }
                .padding(16)
                .frame(width: 336, alignment: .leading)
                .background(
                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .fill(Color(red: 0.12, green: 0.13, blue: 0.15).opacity(0.98))
                        .overlay(
                            RoundedRectangle(cornerRadius: 14, style: .continuous)
                                .stroke(Color.white.opacity(0.12), lineWidth: 1)
                        )
                )
                .shadow(color: .black.opacity(0.34), radius: 22, x: 0, y: 12)
                .padding(.leading, isWorkspaceWindow ? 342 : 318)
                .padding(.top, isWorkspaceWindow ? 390 : 364)
            }
            .transition(.opacity)
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("workspace.recentConversationsTour.overlay")
        }
    }

    private func handleBipNotificationOpenRequest() {
        guard isWorkspaceWindow,
              let request = viewModel.bipNotificationOpenRequest,
              handledBipNotificationOpenRequestID != request.id else {
            return
        }

        handledBipNotificationOpenRequestID = request.id
        pendingBipNotificationScrollRequestID = request.id
        bipNotificationHintIntent = request.intent

        withAnimation(.spring(response: 0.24, dampingFraction: 0.88)) {
            selectedWorkspaceSection = .curriculum
            showsInlineBipReadinessSetup = false
            showsBipReadinessPreview = false
            showsBipReadinessAdvanced = false
        }
        applyBipNotificationIntentToCurrentState()
        NSAccessibility.post(
            element: NSApp.mainWindow as Any,
            notification: .announcementRequested,
            userInfo: [
                .announcement: request.intent == .morning
                    ? "10시 오늘 실행 화면으로 이동했습니다"
                    : "21시 마감 체크 화면으로 이동했습니다",
            ]
        )
    }

    private func applyBipNotificationIntentToCurrentState() {
        guard isWorkspaceWindow,
              bipNotificationHintIntent == .evening,
              let mission = viewModel.visibleBipCoach?.currentMission,
              mission.status != "completed" else {
            return
        }

        withAnimation(.spring(response: 0.24, dampingFraction: 0.88)) {
            showsBipCompletionFields = true
        }
    }

    private func openWorkspaceSettings() {
        withAnimation(.spring(response: 0.24, dampingFraction: 0.88)) {
            selectedWorkspaceSection = .settings
        }
    }

    /// Foundation phase Sub-AC 3: 사이드바 하단 통합 설정 메뉴.
    ///
    /// 가장 자주 쓰는 정체성 관련 액션(프로필 / 알림 / 계정 / 로그아웃)을
    /// 한 popover에 모으고, 마지막에 SettingsView 풀페이지로 진입할 수 있는
    /// "설정 전체 보기" shortcut을 둔다. 각 항목은 popover를 닫은 뒤
    /// `routeSidebarSettingsMenu(_:)`로 라우팅되며, 해당 함수가 SettingsView의
    /// 어떤 SettingsSection을 선택할지 / 즉시 액션(signOut)을 실행할지
    /// 결정한다.
    @ViewBuilder
    private func sidebarSettingsMenu() -> some View {
        let isSignedIn = viewModel.macAuthSession?.isUsable == true
        let primaryEmail: String? = viewModel.macAuthSession?.email?.nonEmpty
        let identityLabel: String = primaryEmail
            ?? (isSignedIn ? "계정 연결됨" : "로그인 필요")
        let identitySubtitle: String? = sidebarSettingsMenuIdentitySubtitle()

        VStack(alignment: .leading, spacing: 0) {
            // Identity header — popover 최상단에서 현재 누가 로그인되어 있는지 즉시
            // 보이도록 이메일 + 온보딩 컨텍스트(역할/단계)를 한 줄로 요약한다.
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: isSignedIn ? "person.crop.circle.fill" : "person.crop.circle.badge.questionmark")
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(.white.opacity(isSignedIn ? 0.92 : 0.55))
                    .frame(width: 28, height: 28)

                VStack(alignment: .leading, spacing: 2) {
                    Text(identityLabel)
                        .font(.system(size: 13, weight: .bold, design: .rounded))
                        .foregroundStyle(.white.opacity(0.92))
                        .lineLimit(1)

                    if let identitySubtitle {
                        Text(identitySubtitle)
                            .font(.system(size: 11, weight: .medium, design: .rounded))
                            .foregroundStyle(.white.opacity(0.55))
                            .lineLimit(1)
                    }
                }

                Spacer(minLength: 0)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .accessibilityIdentifier("workspace.sidebarSettingsMenu.header")

            Divider()
                .background(Color.white.opacity(0.08))
                .padding(.horizontal, 4)

            // Identity-related quick links — Settings 풀페이지의 적절한 섹션으로 라우팅.
            VStack(alignment: .leading, spacing: 2) {
                sidebarSettingsMenuRow(.profile)
                sidebarSettingsMenuRow(.notifications)
                sidebarSettingsMenuRow(.account)
            }
            .padding(.vertical, 4)

            Divider()
                .background(Color.white.opacity(0.08))
                .padding(.horizontal, 4)

            // Destructive action — 로그아웃은 별도 그룹으로 분리해서 실수 클릭을 줄인다.
            VStack(alignment: .leading, spacing: 2) {
                sidebarSettingsMenuRow(.logout, isEnabled: isSignedIn)
            }
            .padding(.vertical, 4)

            Divider()
                .background(Color.white.opacity(0.08))
                .padding(.horizontal, 4)

            // Footer escape hatch — 통합 메뉴에 없는 옵션을 찾는 사용자를 위한
            // 풀페이지 SettingsView 진입점.
            VStack(alignment: .leading, spacing: 2) {
                sidebarSettingsMenuRow(.fullSettings)
            }
            .padding(.vertical, 4)
        }
        .frame(width: 248)
        .padding(.vertical, 6)
        .background(Color(red: 0.13, green: 0.14, blue: 0.16))
    }

    /// popover 내부 단일 행. 비활성(예: 로그인되지 않은 상태에서 "로그아웃") 시
    /// 클릭이 차단되고 톤다운된다.
    private func sidebarSettingsMenuRow(
        _ item: SidebarSettingsMenuItem,
        isEnabled: Bool = true
    ) -> some View {
        let isHovered = hoveredSidebarSettingsMenuItem == item && isEnabled
        let baseOpacity: Double = isEnabled ? 0.86 : 0.32
        let foreground: Color = item.isDestructive
            ? Color(red: 1.0, green: 0.46, blue: 0.42).opacity(isEnabled ? (isHovered ? 1.0 : 0.86) : 0.4)
            : Color.white.opacity(isHovered ? 1.0 : baseOpacity)

        return Button {
            showsSidebarSettingsMenu = false
            routeSidebarSettingsMenu(item)
        } label: {
            HStack(spacing: 10) {
                Image(systemName: item.systemImage)
                    .font(.system(size: 13, weight: .semibold))
                    .frame(width: 18, alignment: .center)
                Text(item.title)
                    .font(.system(size: 13, weight: .semibold, design: .rounded))
                    .lineLimit(1)
                Spacer(minLength: 0)
            }
            .foregroundStyle(foreground)
            .padding(.horizontal, 12)
            .frame(height: 32)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .fill(Color.white.opacity(isHovered ? 0.085 : 0.0))
            )
            .contentShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        }
        .buttonStyle(.plain)
        .disabled(!isEnabled)
        .onHover { hovering in
            if hovering, isEnabled {
                hoveredSidebarSettingsMenuItem = item
            } else if hoveredSidebarSettingsMenuItem == item {
                hoveredSidebarSettingsMenuItem = nil
            }
        }
        .padding(.horizontal, 6)
        .accessibilityIdentifier(item.accessibilityIdentifier)
    }

    /// 항목 → 라우팅 규칙. 알림은 BIP 데일리 알림 환경설정이 모여 있는
    /// `buildInPublic` 섹션으로, 프로필/계정은 일반 계정 섹션으로 보낸다.
    private func routeSidebarSettingsMenu(_ item: SidebarSettingsMenuItem) {
        switch item {
        case .profile:
            selectedSettingsSection = .account
            openWorkspaceSettings()
        case .notifications:
            selectedSettingsSection = .buildInPublic
            openWorkspaceSettings()
        case .account:
            selectedSettingsSection = .account
            openWorkspaceSettings()
        case .logout:
            viewModel.signOutMacAuth()
        case .fullSettings:
            openWorkspaceSettings()
        }
    }

    /// 헤더에 표시할 보조 라인. 온보딩 컨텍스트(역할/단계)가 있으면 우선 노출,
    /// 없으면 macAuthSession 만료/리프레시 상태를 안내한다.
    private func sidebarSettingsMenuIdentitySubtitle() -> String? {
        if let context = viewModel.onboardingContext {
            return "\(context.role.displayTitle) · \(context.projectStage.displayTitle)"
        }
        switch viewModel.macOnboardingStatus {
        case .signingIn:
            return "로그인 진행 중"
        case .exchanging:
            return "토큰 교환 중"
        case .refreshing:
            return "세션 갱신 중"
        case .failed(let message):
            return message
        case .idle:
            return viewModel.macAuthSession == nil ? "Google로 로그인" : nil
        }
    }

    @ViewBuilder
    private func workspaceMainRail(_ day: AgenticCurriculumDay, session: ChatSession) -> some View {
        if selectedWorkspaceSection == .settings {
            SettingsView(
                viewModel: viewModel,
                embeddedInWorkspace: true,
                selectedSection: $selectedSettingsSection,
                showsWorkspaceSettingsSidebar: false,
                returnToWorkspace: {
                    withAnimation(.spring(response: 0.24, dampingFraction: 0.88)) {
                        selectedWorkspaceSection = .curriculum
                    }
                }
            )
                .accessibilityIdentifier("workspace.settingsPage")
        } else {
            VStack(alignment: .leading, spacing: 16) {
                ScrollViewReader { proxy in
                    ScrollView {
                        VStack(alignment: .leading, spacing: 16) {
                            if isIddSetupLocked {
                                foundationSetupFallbackSurface(session: session)
                            } else if viewModel.foundationCurriculumPresentationDestination == .graduation {
                                workspaceGraduationSurface()
                            } else if let reviewDashboard = viewModel.reviewDayDashboardViewModel,
                                      reviewDashboard.reviewDay == day.day {
                                workspaceReviewDayDashboardSurface(reviewDashboard)
                            } else {
                                if !shouldResumeDirectlyToQuestion(day: day, session: session) {
                                    workspaceMissionFirstSurface(day: day, session: session)
                                    workspaceBipNotificationTaskSurface()
                                }
                                workspaceMissionSupportThread(session)
                            }
                            Color.clear
                                .frame(height: 1)
                                .id(workspaceSupportThreadBottomID)
                                .accessibilityHidden(true)
                        }
                        .frame(maxWidth: 1180, alignment: .leading)
                        .padding(.horizontal, 34)
                        .padding(.vertical, 28)
                    }
                    .onAppear {
                        scrollToBipNotificationTargetIfNeeded(proxy)
                    }
                    .onChange(of: pendingBipNotificationScrollRequestID) { _, _ in
                        scrollToBipNotificationTargetIfNeeded(proxy)
                    }
                    .onChange(of: workspaceMissionSupportScrollFingerprint(session)) { _, _ in
                        scrollToWorkspaceSupportBottomIfNeeded(proxy, session: session)
                    }
                }

                VStack(spacing: 10) {
                    if !isIddSetupLocked && viewModel.foundationCurriculumPresentationDestination != .graduation {
                        promptComposer()
                    }
                }
                .frame(maxWidth: 1180)
                .padding(.horizontal, 34)
                .padding(.bottom, 18)
            }
            .accessibilityIdentifier("workspace.dayDetail")
        }
    }

    private func scrollToBipNotificationTargetIfNeeded(_ proxy: ScrollViewProxy) {
        guard pendingBipNotificationScrollRequestID != nil else { return }
        DispatchQueue.main.async {
            withAnimation(.spring(response: 0.32, dampingFraction: 0.88)) {
                proxy.scrollTo("workspace.bipNotificationTaskSurface.scrollTarget", anchor: .center)
            }
            pendingBipNotificationScrollRequestID = nil
        }
    }

    private func scrollToWorkspaceSupportBottomIfNeeded(_ proxy: ScrollViewProxy, session: ChatSession) {
        let visibleMessages = workspaceVisibleMessages(for: session)
        let pendingPrompts = workspacePendingPrompts(for: session)
        let supportMessages = workspaceMissionSupportMessages(
            visibleMessages,
            session: session,
            pendingPrompts: pendingPrompts
        )
        let hasSupportContent = !supportMessages.isEmpty
            || session.pendingUserInput != nil
            || !pendingPrompts.isEmpty
            || session.status == .running
        guard hasSupportContent else { return }

        DispatchQueue.main.async {
            withAnimation(.spring(response: 0.28, dampingFraction: 0.90)) {
                proxy.scrollTo(workspaceSupportThreadBottomID, anchor: .bottom)
            }
        }
    }

    private func workspaceMissionSupportScrollFingerprint(_ session: ChatSession) -> String {
        let messageState = workspaceVisibleMessages(for: session)
            .map { message in
                "\(message.id):\(message.role.rawValue):\(message.state.rawValue):\(message.content.count)"
            }
            .joined(separator: "|")
        let pendingPromptCount = workspacePendingPrompts(for: session).count
        return [
            session.id,
            session.status.rawValue,
            session.pendingUserInput?.requestId ?? "",
            "pending:\(pendingPromptCount)",
            messageState,
        ].joined(separator: "#")
    }

    @ViewBuilder
    private func workspaceBipNotificationTaskSurface() -> some View {
        if let intent = bipNotificationHintIntent {
            VStack(alignment: .leading, spacing: 14) {
                HStack(alignment: .top, spacing: 12) {
                    Image(systemName: intent == .morning ? "sun.max.fill" : "moon.stars.fill")
                        .font(.system(size: 16, weight: .bold))
                        .foregroundStyle(Agentic30BrandColor.greenBright.opacity(0.92))
                        .frame(width: 28, height: 28)
                        .background(Circle().fill(Agentic30BrandColor.greenBright.opacity(0.12)))

                    VStack(alignment: .leading, spacing: 4) {
                        Text(bipNotificationTaskTitle(intent))
                            .font(.system(size: 18, weight: .heavy, design: .rounded))
                            .foregroundStyle(.white.opacity(0.96))
                            .accessibilityIdentifier("workspace.bipNotificationTaskTitle")
                        Text(bipNotificationTaskSubtitle(intent))
                            .font(.system(size: 13, weight: .semibold, design: .rounded))
                            .foregroundStyle(.white.opacity(0.60))
                            .fixedSize(horizontal: false, vertical: true)
                    }

                    Spacer(minLength: 12)

                    bipNotificationPrimaryAction(intent)
                }

                bipNotificationStateContent(intent)
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .fill(Color.white.opacity(0.075))
                    .overlay(
                        RoundedRectangle(cornerRadius: 18, style: .continuous)
                            .stroke(Agentic30BrandColor.greenBright.opacity(0.16), lineWidth: 1)
                    )
            )
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("workspace.bipNotificationTaskSurface")
            .accessibilityLabel(bipNotificationTaskTitle(intent))
            .id("workspace.bipNotificationTaskSurface.scrollTarget")
        }
    }

    private func workspaceReviewDayDashboardSurface(_ dashboard: ReviewDayDashboardViewModel) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .top, spacing: 13) {
                Image(systemName: "chart.line.uptrend.xyaxis")
                    .font(.system(size: 17, weight: .heavy))
                    .foregroundStyle(Color.black.opacity(0.76))
                    .frame(width: 34, height: 34)
                    .background(Circle().fill(workspaceMissionFirstAccent.opacity(0.94)))

                VStack(alignment: .leading, spacing: 7) {
                    Text("Day \(dashboard.reviewDay) · Review")
                        .font(.system(size: 11, weight: .heavy, design: .rounded))
                        .foregroundStyle(workspaceMissionFirstAccent.opacity(0.94))
                        .textCase(.uppercase)

                    Text("Review Day dashboard")
                        .font(.system(size: 25, weight: .heavy, design: .rounded))
                        .foregroundStyle(.white.opacity(0.97))
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityIdentifier("workspace.reviewDashboard.title")

                    Text(workspaceReviewDaySubtitle(dashboard))
                        .font(.system(size: 14, weight: .semibold, design: .rounded))
                        .foregroundStyle(.white.opacity(0.62))
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityIdentifier("workspace.reviewDashboard.dayRange")
                }

                Spacer(minLength: 16)
            }

            LazyVGrid(columns: [
                GridItem(.adaptive(minimum: 170, maximum: 230), spacing: 10, alignment: .topLeading),
            ], alignment: .leading, spacing: 10) {
                ForEach(Array(dashboard.curatedMetrics.enumerated()), id: \.element.id) { index, metric in
                    workspaceReviewMetricCard(metric, index: index)
                }
            }
            .accessibilityIdentifier("workspace.reviewDashboard.metrics")

            workspaceReviewDashboardList(
                title: "Agent insights",
                systemImage: "sparkles",
                items: dashboard.insights,
                identifier: "workspace.reviewDashboard.insights"
            )

            workspaceReviewDashboardList(
                title: "Next actions",
                systemImage: "checklist",
                items: dashboard.nextSteps,
                identifier: "workspace.reviewDashboard.nextSteps"
            )
        }
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .fill(Color.white.opacity(0.075))
                .overlay(
                    RoundedRectangle(cornerRadius: 22, style: .continuous)
                        .stroke(workspaceMissionFirstAccent.opacity(0.18), lineWidth: 1)
                )
        )
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("workspace.reviewDashboardSurface")
    }

    private func workspaceReviewDaySubtitle(_ dashboard: ReviewDayDashboardViewModel) -> String {
        if let range = dashboard.dayRange {
            return "Day \(range.start)-\(range.end)에서 고른 핵심 지표만 봅니다."
        }
        return "이번 Review에서 고른 핵심 지표만 봅니다."
    }

    private func workspaceReviewMetricCard(_ metric: ReviewDayDashboardMetric, index: Int) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(metric.label)
                .font(.system(size: 12, weight: .heavy, design: .rounded))
                .foregroundStyle(.white.opacity(0.78))
                .lineLimit(2)
                .fixedSize(horizontal: false, vertical: true)

            Text(metric.value)
                .font(.system(size: 25, weight: .heavy, design: .rounded))
                .foregroundStyle(.white.opacity(0.97))
                .lineLimit(1)

            if let trend = metric.trend.nonEmpty {
                Text(trend)
                    .font(.system(size: 11, weight: .bold, design: .rounded))
                    .foregroundStyle(workspaceMissionFirstAccent.opacity(0.90))
                    .lineLimit(1)
            }
        }
        .padding(13)
        .frame(maxWidth: .infinity, minHeight: 118, alignment: .topLeading)
        .background(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(Color.black.opacity(0.13))
                .overlay(
                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .stroke(Color.white.opacity(0.08), lineWidth: 1)
                )
        )
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("workspace.reviewDashboard.metric.\(index + 1)")
    }

    @ViewBuilder
    private func workspaceReviewDashboardList(
        title: String,
        systemImage: String,
        items: [String],
        identifier: String
    ) -> some View {
        if !items.isEmpty {
            VStack(alignment: .leading, spacing: 9) {
                Label(title, systemImage: systemImage)
                    .font(.system(size: 13, weight: .heavy, design: .rounded))
                    .foregroundStyle(.white.opacity(0.88))

                ForEach(Array(items.enumerated()), id: \.offset) { _, item in
                    HStack(alignment: .top, spacing: 8) {
                        Circle()
                            .fill(workspaceMissionFirstAccent.opacity(0.86))
                            .frame(width: 5, height: 5)
                            .padding(.top, 7)
                        Text(item)
                            .font(.system(size: 12, weight: .semibold, design: .rounded))
                            .foregroundStyle(.white.opacity(0.62))
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
            .padding(13)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .fill(Color.black.opacity(0.10))
                    .overlay(
                        RoundedRectangle(cornerRadius: 14, style: .continuous)
                            .stroke(Color.white.opacity(0.07), lineWidth: 1)
                    )
            )
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier(identifier)
        }
    }

    private func bipNotificationTaskTitle(_ intent: BipNotificationIntent) -> String {
        switch intent {
        case .morning:
            return "10시 오늘 실행"
        case .evening:
            return "21시 마감 체크"
        }
    }

    private func bipNotificationTaskSubtitle(_ intent: BipNotificationIntent) -> String {
        switch intent {
        case .morning:
            return "작게 하나 공개할 미션을 정하세요."
        case .evening:
            return "게시 기록을 남기면 오늘 루프가 닫힙니다."
        }
    }

    @ViewBuilder
    private func bipNotificationPrimaryAction(_ intent: BipNotificationIntent) -> some View {
        if let action = bipNotificationPrimaryActionModel(intent) {
            Button {
                viewModel.recordBipNotificationPrimaryAction(intent: intent, action: action.telemetryName)
                action.perform()
            } label: {
                HStack(spacing: 7) {
                    if action.showsProgress {
                        ProgressView()
                            .controlSize(.mini)
                            .frame(width: 12, height: 12)
                    }
                    Text(action.title)
                        .font(.system(size: 12, weight: .heavy, design: .rounded))
                }
                .foregroundStyle(Color.black.opacity(action.isDisabled ? 0.40 : 0.78))
                .padding(.horizontal, 14)
                .frame(height: 34)
                .background(Capsule().fill(Agentic30BrandColor.greenBright.opacity(action.isDisabled ? 0.34 : 0.92)))
            }
            .buttonStyle(.plain)
            .disabled(action.isDisabled)
            .accessibilityIdentifier("workspace.bipNotificationPrimaryAction")
            .accessibilityLabel(action.title)
        }
    }

    private struct BipNotificationPrimaryAction {
        let title: String
        let telemetryName: String
        let showsProgress: Bool
        let isDisabled: Bool
        let perform: () -> Void
    }

    private func bipNotificationPrimaryActionModel(_ intent: BipNotificationIntent) -> BipNotificationPrimaryAction? {
        if viewModel.sidecarFailureMessage != nil {
            return BipNotificationPrimaryAction(
                title: "연결 문제 해결",
                telemetryName: "reconnect_sidecar",
                showsProgress: false,
                isDisabled: false,
                perform: { viewModel.reconnectSidecar() }
            )
        }
        if viewModel.bipTokenExpired != nil {
            return BipNotificationPrimaryAction(
                title: "연결 문제 해결",
                telemetryName: "open_settings_token_expired",
                showsProgress: false,
                isDisabled: false,
                perform: { openWorkspaceSettings() }
            )
        }
        if viewModel.isBipCoachGenerating {
            return BipNotificationPrimaryAction(
                title: "오늘 실행 상태 확인 중",
                telemetryName: "generation_in_progress",
                showsProgress: true,
                isDisabled: true,
                perform: {}
            )
        }

        let coach = viewModel.visibleBipCoach
        if let mission = coach?.currentMission, mission.status == "completed" {
            return BipNotificationPrimaryAction(
                title: "오늘 완료됨",
                telemetryName: "completed",
                showsProgress: false,
                isDisabled: true,
                perform: {}
            )
        }

        switch intent {
        case .morning:
            if let mission = coach?.currentMission {
                return BipNotificationPrimaryAction(
                    title: "이어서 초안 작성",
                    telemetryName: "continue_draft",
                    showsProgress: false,
                    isDisabled: false,
                    perform: { beginBipMission(mission) }
                )
            }
            if let firstChoice = coach?.pendingMissionChoices.first {
                return BipNotificationPrimaryAction(
                    title: "이 미션으로 시작",
                    telemetryName: "select_first_choice",
                    showsProgress: false,
                    isDisabled: false,
                    perform: { viewModel.selectBipMission(firstChoice) }
                )
            }
            return BipNotificationPrimaryAction(
                title: "오늘 미션 만들기",
                telemetryName: "generate_mission",
                showsProgress: false,
                isDisabled: viewModel.isBipCoachGenerating,
                perform: { viewModel.generateBipMission(compact: true, curriculumDay: curriculumPayload(for: workspaceSelectedDay)) }
            )
        case .evening:
            if coach?.currentMission != nil {
                return BipNotificationPrimaryAction(
                    title: "기록 완료",
                    telemetryName: "complete_mission",
                    showsProgress: viewModel.isBipCoachCompleting,
                    isDisabled: bipCompletionSubmitDisabled,
                    perform: { submitBipCompletion() }
                )
            }
            return BipNotificationPrimaryAction(
                title: "오늘 미션 먼저 만들기",
                telemetryName: "generate_mission_from_evening_empty",
                showsProgress: false,
                isDisabled: viewModel.isBipCoachGenerating,
                perform: { viewModel.generateBipMission(compact: true, curriculumDay: curriculumPayload(for: workspaceSelectedDay)) }
            )
        }
    }

    @ViewBuilder
    private func bipNotificationStateContent(_ intent: BipNotificationIntent) -> some View {
        if let message = viewModel.sidecarFailureMessage ?? viewModel.bipTokenExpired {
            bipNotificationBlockingRow(message)
        } else if viewModel.isBipCoachGenerating || viewModel.bipMissionProgress != nil {
            bipNotificationStatusRow("오늘 실행 상태 확인 중")
        } else if let coach = viewModel.visibleBipCoach {
            if let mission = coach.currentMission {
                if mission.status == "completed" {
                    bipNotificationCompletionSummary(mission)
                } else if intent == .evening {
                    bipCompletionFields()
                } else {
                    bipNotificationMissionSummary(mission)
                }
            } else if let firstChoice = coach.pendingMissionChoices.first {
                bipNotificationMissionSummary(firstChoice)
            } else if intent == .evening {
                if showsBipCompletionFields {
                    bipCompletionFields()
                } else {
                    Text("아직 오늘 미션이 없습니다. 지금 하나 만들거나, 오늘은 기록만 남길 수 있어요.")
                        .font(.system(size: 12, weight: .semibold, design: .rounded))
                        .foregroundStyle(.white.opacity(0.58))
                        .fixedSize(horizontal: false, vertical: true)
                    bipCoachButton("오늘은 기록만 남기기") {
                        showsBipCompletionFields = true
                    }
                }
            } else {
                Text("아직 오늘 미션이 없습니다. Docs와 Sheet 기록을 보고 15분짜리 공개 실행을 하나로 좁힙니다.")
                    .font(.system(size: 12, weight: .semibold, design: .rounded))
                    .foregroundStyle(.white.opacity(0.58))
                    .fixedSize(horizontal: false, vertical: true)
            }
        } else {
            bipNotificationStatusRow("오늘 실행 상태 확인 중")
        }
    }

    private func bipNotificationStatusRow(_ text: String) -> some View {
        HStack(spacing: 8) {
            ProgressView()
                .controlSize(.mini)
            Text(text)
                .font(.system(size: 12, weight: .semibold, design: .rounded))
                .foregroundStyle(.white.opacity(0.62))
        }
        .accessibilityIdentifier("workspace.bipNotificationStatus")
    }

    private func bipNotificationBlockingRow(_ message: String) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(Color(red: 1.0, green: 0.67, blue: 0.42).opacity(0.92))
            Text(message)
                .font(.system(size: 12, weight: .semibold, design: .rounded))
                .foregroundStyle(.white.opacity(0.62))
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(Color(red: 1.0, green: 0.67, blue: 0.42).opacity(0.08))
        )
        .accessibilityIdentifier("workspace.bipNotificationBlockingRow")
    }

    private func bipNotificationMissionSummary(_ mission: BipCoachMission) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(mission.title?.nonEmpty ?? "오늘 미션")
                .font(.system(size: 14, weight: .heavy, design: .rounded))
                .foregroundStyle(.white.opacity(0.92))
            Text(mission.mission?.nonEmpty ?? mission.angle?.nonEmpty ?? "오늘 공개 실행을 하나로 좁혀 진행합니다.")
                .font(.system(size: 12, weight: .semibold, design: .rounded))
                .foregroundStyle(.white.opacity(0.60))
                .fixedSize(horizontal: false, vertical: true)
        }
        .accessibilityIdentifier("workspace.bipNotificationMissionSummary")
    }

    private func bipNotificationCompletionSummary(_ mission: BipCoachMission) -> some View {
        bipCompletionCard(mission: mission, isCompact: true)
    }

    private func bipCompletionCelebrationTitle(for mission: BipCoachMission) -> String {
        if let day = mission.curriculumDay?.day {
            return "Day \(day) 완료!"
        }
        return "오늘 실행 완료!"
    }

    private func bipCompletionEncouragementText(for mission: BipCoachMission) -> String {
        if mission.curriculumDay?.day != nil {
            return "좋아요, 이 근거로 다음 Day를 더 정확히 이어갈게요."
        }
        return "좋아요, 오늘 기록이 다음 실행의 근거가 됩니다."
    }

    private func bipMissionMatchesDay(_ mission: BipCoachMission, day: AgenticCurriculumDay) -> Bool {
        guard let missionDay = mission.curriculumDay?.day else { return true }
        return missionDay == day.day
    }

    private func bipCompletionCTALabel(for mission: BipCoachMission) -> String? {
        guard let completedDay = mission.curriculumDay?.day,
              completedDay < 30 else {
            return nil
        }
        return "Day \(completedDay + 1) 시작하기"
    }

    private func advanceFromCompletedMission(_ mission: BipCoachMission) {
        guard let completedDay = mission.curriculumDay?.day,
              completedDay < 30 else {
            return
        }
        viewModel.advanceFromCompletedMission(mission)
        selectedWorkspaceSection = .curriculum
    }

    private func triggerWorkspaceCompletionConfettiIfNeeded() {
        guard let missionID = currentBipCompletionConfettiMissionID,
              lastWorkspaceCompletionConfettiMissionID != missionID else {
            return
        }

        lastWorkspaceCompletionConfettiMissionID = missionID
        guard !reduceMotion,
              !RealisticConfettiBurst.isProcessDisabled else {
            return
        }

        workspaceCompletionConfettiTrigger += 1
        let currentTrigger = workspaceCompletionConfettiTrigger
        DispatchQueue.main.asyncAfter(deadline: .now() + RealisticConfettiRecipe.cleanupDelay + 0.15) {
            if workspaceCompletionConfettiTrigger == currentTrigger {
                workspaceCompletionConfettiTrigger = 0
            }
        }
    }

    private func bipCompletionCard(mission: BipCoachMission, isCompact: Bool = false) -> some View {
        return ZStack(alignment: .topTrailing) {
            VStack(alignment: .leading, spacing: isCompact ? 6 : 9) {
                HStack(alignment: .center, spacing: 8) {
                    Image(systemName: "sparkles")
                        .font(.system(size: isCompact ? 12 : 14, weight: .heavy))
                        .foregroundStyle(Color.black.opacity(0.72))
                        .frame(width: isCompact ? 24 : 28, height: isCompact ? 24 : 28)
                        .background(Circle().fill(Agentic30BrandColor.greenBright.opacity(0.94)))

                    Text(bipCompletionCelebrationTitle(for: mission))
                        .font(.system(size: isCompact ? 14 : 17, weight: .heavy, design: .rounded))
                        .foregroundStyle(Agentic30BrandColor.greenBright.opacity(0.96))
                        .accessibilityIdentifier("workspace.completionCard.title")
                }

                Text(bipCompletionEncouragementText(for: mission))
                    .font(.system(size: isCompact ? 12 : 13, weight: .semibold, design: .rounded))
                    .foregroundStyle(.white.opacity(0.72))
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("workspace.completionCard.encouragement")

                if let questionCountLabel = mission.completionQuestionCountLabel {
                    Text(questionCountLabel)
                        .font(.system(size: isCompact ? 12 : 11, weight: .bold, design: .rounded))
                        .foregroundStyle(.white.opacity(0.64))
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityIdentifier("workspace.completionCard.questionCount")
                }

                if let teaser = mission.curriculumDay?.completionNextDayTeaser {
                    Text(teaser)
                        .font(.system(size: isCompact ? 11 : 10, weight: .semibold, design: .rounded))
                        .foregroundStyle(.white.opacity(0.46))
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityIdentifier("workspace.completionCard.nextDayTeaser")
                }

                Text([mission.threadsUrl?.nonEmpty, mission.sheetRowNote?.nonEmpty].compactMap { $0 }.joined(separator: " · ").nonEmpty ?? "기록이 저장됐습니다.")
                    .font(.system(size: isCompact ? 12 : 11, weight: .semibold, design: .rounded))
                    .foregroundStyle(.white.opacity(0.58))
                    .fixedSize(horizontal: false, vertical: true)

                if let ctaLabel = bipCompletionCTALabel(for: mission) {
                    Button {
                        advanceFromCompletedMission(mission)
                    } label: {
                        Text(ctaLabel)
                            .font(.system(size: isCompact ? 12 : 13, weight: .heavy, design: .rounded))
                            .foregroundStyle(Color.black.opacity(0.78))
                            .frame(maxWidth: .infinity)
                            .frame(height: isCompact ? 30 : 34)
                            .background(
                                Capsule()
                                    .fill(Agentic30BrandColor.greenBright.opacity(0.94))
                            )
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("workspace.completionCard.cta")
                }
            }

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
        .accessibilityIdentifier(isCompact ? "workspace.bipNotificationCompletionSummary" : "workspace.completionCard")
    }

    private func workspaceChatThread(_ session: ChatSession, day: AgenticCurriculumDay) -> some View {
        let visibleMessages = workspaceVisibleMessages(for: session)
        let pendingPrompts = workspacePendingPrompts(for: session)
        let showsRunningBubble = session.status == .running && workspaceNeedsRunningBubble(messages: visibleMessages)

        return VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .center, spacing: 8) {
                Text("Chat Assistant")
                    .font(.system(size: 11, weight: .bold, design: .rounded))
                    .foregroundStyle(.white.opacity(0.44))
                    .textCase(.uppercase)

                if session.status == .running {
                    HStack(spacing: 6) {
                        ProgressView()
                            .controlSize(.mini)
                            .frame(width: 12, height: 12)
                        Text("응답 스트리밍")
                            .font(.system(size: 10, weight: .bold, design: .rounded))
                    }
                    .foregroundStyle(.white.opacity(0.58))
                    .padding(.horizontal, 8)
                    .frame(height: 24)
                    .background(Capsule().fill(Color.white.opacity(0.07)))
                }

                Spacer(minLength: 0)
            }

            VStack(alignment: .leading, spacing: 10) {
                workspaceChatAssistantMarker(day: day)
                // Sub-AC 1: 오늘 과제 / sub-workflow / 자유 대화 모두를 단일
                // 채팅 surface 안에서 렌더한다. 오늘 과제는 항상 chat의 첫 어시
                // 스턴트 카드로 등장해 컨텍스트를 고정하고, 그 다음에 sub-workflow
                // (BIP mission), 자유 대화 (visible messages) 순으로 이어진다.
                workspaceTodayTasksAssistantCard(day: day)
                if workspaceShouldShowPublicExecutionCard(for: session) {
                    workspaceBipMissionAssistantCard()
                }

                if visibleMessages.isEmpty && session.pendingUserInput == nil && pendingPrompts.isEmpty && !showsRunningBubble {
                    Text("메시지를 보내면 여기에 대화가 쌓입니다.")
                        .font(.system(size: 12, weight: .medium, design: .rounded))
                        .foregroundStyle(.white.opacity(0.42))
                        .frame(maxWidth: .infinity, alignment: .leading)
                } else {
                    ForEach(visibleMessages) { message in
                        workspaceChatBubble(message, session: session)
                    }

                    if let pendingPrompt = session.pendingUserInput {
                        workspaceStructuredPrompt(pendingPrompt)
                    }

                    ForEach(pendingPrompts) { pendingPrompt in
                        workspacePendingUserBubble(pendingPrompt.content)
                    }

                    if showsRunningBubble {
                        workspaceAssistantProgressBubble(session)
                    }
                }
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(workspacePaneBackground(cornerRadius: 18))
        .accessibilityIdentifier("workspace.chatThread")
    }

    private func workspaceChatAssistantMarker(day: AgenticCurriculumDay) -> some View {
        Text("Chat Assistant Day \(day.day)")
            .font(.system(size: 1))
            .foregroundStyle(.clear)
            .frame(width: 1, height: 1)
            .accessibilityIdentifier("workspace.chatAssistant")
            .accessibilityLabel("Chat Assistant")
    }

    private func workspaceShouldShowPublicExecutionCard(for session: ChatSession) -> Bool {
        guard session.pendingUserInput == nil else { return false }
        if workspaceIsBasisSession(session) && session.status == .running {
            return false
        }
        return true
    }

    private func workspaceIsBasisSession(_ session: ChatSession) -> Bool {
        if session.runtime?.iddDocumentType?.nonEmpty != nil {
            return true
        }
        return session.title.hasPrefix("기준 정리:")
    }

    private func workspaceTodayTasksAssistantCard(day: AgenticCurriculumDay) -> some View {
        HStack(alignment: .bottom, spacing: 10) {
            VStack(alignment: .leading, spacing: 5) {
                Text("Assistant")
                    .font(.system(size: 10, weight: .bold, design: .rounded))
                    .foregroundStyle(.white.opacity(0.42))

                VStack(alignment: .leading, spacing: 10) {
                    workspaceTodayTasksAssistantMarker()

                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Text("오늘 과제")
                            .font(.system(size: 12, weight: .bold, design: .rounded))
                            .foregroundStyle(.white.opacity(0.78))
                            .textCase(.uppercase)

                        Text("Day \(day.day)")
                            .font(.system(size: 11, weight: .bold, design: .rounded))
                            .foregroundStyle(.white.opacity(0.42))

                        Spacer(minLength: 0)
                    }

                    Text(day.title)
                        .font(.system(size: 15, weight: .bold, design: .rounded))
                        .foregroundStyle(.white.opacity(0.9))
                        .fixedSize(horizontal: false, vertical: true)

                    Text(day.summary)
                        .font(.system(size: 12, weight: .medium, design: .rounded))
                        .foregroundStyle(.white.opacity(0.62))
                        .fixedSize(horizontal: false, vertical: true)

                    VStack(alignment: .leading, spacing: 8) {
                        ForEach(Array(day.tasks.enumerated()), id: \.offset) { index, task in
                            workspaceTaskRow(index: index + 1, task: task)
                        }
                    }

                    VStack(alignment: .leading, spacing: 4) {
                        Text("오늘 산출물")
                            .font(.system(size: 10, weight: .bold, design: .rounded))
                            .foregroundStyle(.white.opacity(0.42))
                            .textCase(.uppercase)

                        Text(day.output)
                            .font(.system(size: 12, weight: .semibold, design: .rounded))
                            .foregroundStyle(.white.opacity(0.72))
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                .padding(12)
                .background(workspaceBubbleBackground(isUser: false, isError: false))
                .accessibilityElement(children: .contain)
            }
            .frame(maxWidth: 860, alignment: .leading)

            Spacer(minLength: 90)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .id("workspace.todayTasksCard.scrollTarget")
    }

    private func workspaceTodayTasksAssistantMarker() -> some View {
        Text("today tasks card")
            .font(.system(size: 1))
            .foregroundStyle(.clear)
            .frame(width: 1, height: 1)
            .accessibilityIdentifier("workspace.chat.todayTasksCard")
            .accessibilityLabel("오늘 과제 카드")
    }

    private func workspaceBipMissionAssistantCard() -> some View {
        HStack(alignment: .bottom, spacing: 10) {
            VStack(alignment: .leading, spacing: 5) {
                Text("Assistant")
                    .font(.system(size: 10, weight: .bold, design: .rounded))
                    .foregroundStyle(.white.opacity(0.42))

                VStack(alignment: .leading, spacing: 10) {
                    workspaceBipMissionCardMarker()

                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Text(workspaceBipMissionAssistantTitle)
                            .font(.system(size: 12, weight: .bold, design: .rounded))
                            .foregroundStyle(.white.opacity(0.78))
                            .textCase(.uppercase)

                        Spacer(minLength: 0)
                    }

                    workspaceBipCoachModule()
                }
                .padding(12)
                .background(workspaceBubbleBackground(isUser: false, isError: viewModel.sidecarFailureMessage != nil))
                .accessibilityElement(children: .contain)
            }
            .frame(maxWidth: 860, alignment: .leading)

            Spacer(minLength: 90)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .id("workspace.bipMissionCard.scrollTarget")
    }

    private var workspaceBipMissionAssistantTitle: String {
        guard let coach = viewModel.visibleBipCoach else {
            return "오늘 실행"
        }

        let readiness = viewModel.bipReadiness ?? BipReadinessState.loading
        if viewModel.sidecarFailureMessage != nil {
            return "오늘 실행"
        }
        if fullCoachReady(coach: coach, readiness: readiness) {
            return "근거 기반 오늘 실행"
        }

        return "오늘 실행"
    }

    private func workspaceBipMissionCardMarker() -> some View {
        Text("public execution card")
            .font(.system(size: 1))
            .foregroundStyle(.clear)
            .frame(width: 1, height: 1)
            .accessibilityIdentifier("workspace.chat.bipMissionCard")
            .accessibilityLabel("오늘 실행 카드")
    }

    private func workspaceVisibleMessages(for session: ChatSession) -> [ChatMessage] {
        session.messages
            .filter { $0.role == .user || $0.role == .assistant || $0.role == .system }
            .filter(workspaceShouldRenderMessage)
            .suffix(8)
            .map { $0 }
    }

    private func workspaceShouldRenderMessage(_ message: ChatMessage) -> Bool {
        switch message.role {
        case .user:
            return message.content.trimmingCharacters(in: .whitespacesAndNewlines).nonEmpty != nil
        case .assistant, .system:
            return workspaceAssistantMessagePayload(message).nonEmpty != nil
                || message.bipMissionChoices?.isEmpty == false
                || message.providerAuthActions?.isEmpty == false
                || message.state == .streaming
        }
    }

    private func workspaceAssistantMessagePayload(_ message: ChatMessage) -> String {
        message.content.trimmingCharacters(in: .whitespacesAndNewlines).nonEmpty
            ?? message.error?.trimmingCharacters(in: .whitespacesAndNewlines).nonEmpty
            ?? ""
    }

    private func workspacePendingPrompts(for session: ChatSession) -> [AgenticViewModel.PendingPromptPreview] {
        var persistedCounts: [String: Int] = [:]
        for message in session.messages where message.role == .user {
            guard let content = message.content.trimmingCharacters(in: .whitespacesAndNewlines).nonEmpty else {
                continue
            }
            persistedCounts[content, default: 0] += 1
        }
        return viewModel.pendingPromptPreviews(for: session.id).filter { preview in
            let content = preview.content.trimmingCharacters(in: .whitespacesAndNewlines)
            let count = persistedCounts[content, default: 0]
            if count > 0 {
                persistedCounts[content] = count - 1
                return false
            }
            return true
        }
    }

    private func workspaceNeedsRunningBubble(messages: [ChatMessage]) -> Bool {
        guard let latest = messages.last else {
            return true
        }
        guard latest.role == .assistant || latest.role == .system else {
            return true
        }
        return false
    }

    private func workspaceChatBubble(_ message: ChatMessage, session: ChatSession) -> some View {
        let isUser = message.role == .user
        let text = isUser
            ? message.content.trimmingCharacters(in: .whitespacesAndNewlines)
            : workspaceAssistantMessagePayload(message)
        let isStreamingPlaceholder = !isUser && text.isEmpty && message.state == .streaming

        return HStack(alignment: .bottom, spacing: 10) {
            if isUser {
                Spacer(minLength: 90)
            }

            VStack(alignment: isUser ? .trailing : .leading, spacing: 5) {
                Text(isUser ? "You" : "Assistant")
                    .font(.system(size: 10, weight: .bold, design: .rounded))
                    .foregroundStyle(.white.opacity(0.42))

                if isStreamingPlaceholder {
                    assistantLiveStatusPanel(session)
                    .background(workspaceBubbleBackground(isUser: false, isError: false))
                    .accessibilityIdentifier("workspace.chat.assistantStreaming")
                } else if !isUser,
                          let actions = message.providerAuthActions,
                          !actions.isEmpty,
                          message.bipMissionChoices?.isEmpty != false {
                    workspaceProviderAuthBubble(text: text, actions: actions)
                } else if !isUser, let choices = message.bipMissionChoices, !choices.isEmpty {
                    workspaceBipMissionChoiceBubble(
                        text: text,
                        choices: choices,
                        authActions: message.providerAuthActions ?? []
                    )
                } else if !isUser, let decision = message.inlineDecision {
                    // The card is "active" only while no later user message
                    // has been sent. After the user answers, this card stays
                    // in history as the rationale (D3=C) but its rows become
                    // non-interactive so stale prompts can't be re-submitted
                    // and so keyboard shortcuts on older cards don't collide
                    // with the latest active card (codex P1 #6 + #8).
                    let messageIndex = session.messages.firstIndex { $0.id == message.id }
                    let isCardActive = messageIndex.map { idx in
                        idx + 1 >= session.messages.count
                            || !session.messages[(idx + 1)...].contains { $0.role == .user }
                    } ?? true
                    workspaceInlineDecisionCard(decision, text: text, isActive: isCardActive)
                } else {
                    workspaceMessageBody(text: text, isUser: isUser, isError: message.state == .error)
                }
            }
            .frame(maxWidth: isUser ? workspaceUserReadableWidth : workspaceAssistantReadableWidth, alignment: isUser ? .trailing : .leading)

            if !isUser {
                Spacer(minLength: 90)
            }
        }
        .frame(maxWidth: .infinity, alignment: isUser ? .trailing : .leading)
        // Use `.contain` instead of `.combine` so interactive elements inside
        // the bubble (decision card buttons, provider auth buttons, BIP
        // mission choice cards) remain individually reachable by VoiceOver.
        // `.combine` flattens children into a single element labeled by the
        // outer text, which would hide the buttons entirely.
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(isUser ? "workspace.chat.user" : "workspace.chat.assistant")
        .accessibilityLabel(text)
    }

    private struct WorkspaceReadableMessageBlock: Identifiable {
        enum Kind {
            case paragraph(String)
            case section(String)
            case labeled(label: String, body: String)
            case numbered(Int, String)
            case bullet(String)
            case command(String)
            case link(String)
        }

        let id: Int
        let kind: Kind
    }

    private func workspaceMessageBody(text: String, isUser: Bool, isError: Bool) -> some View {
        Group {
            if isUser {
                Text(text)
                    .font(.system(size: 13, weight: .semibold, design: .rounded))
                    .foregroundStyle(.white.opacity(0.90))
                    .textSelection(.enabled)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.horizontal, 13)
                    .padding(.vertical, 10)
            } else {
                VStack(alignment: .leading, spacing: 9) {
                    ForEach(workspaceReadableBlocks(from: text)) { block in
                        workspaceReadableBlock(block)
                    }
                }
                .textSelection(.enabled)
                .padding(.horizontal, 16)
                .padding(.vertical, 14)
            }
        }
        .background(workspaceBubbleBackground(isUser: isUser, isError: isError))
    }

    private func workspaceReadableBlocks(from text: String) -> [WorkspaceReadableMessageBlock] {
        var blocks: [WorkspaceReadableMessageBlock] = []
        var paragraphLines: [String] = []

        func append(_ kind: WorkspaceReadableMessageBlock.Kind) {
            blocks.append(WorkspaceReadableMessageBlock(id: blocks.count, kind: kind))
        }

        func flushParagraph() {
            let paragraph = paragraphLines
                .joined(separator: " ")
                .trimmingCharacters(in: .whitespacesAndNewlines)
            if !paragraph.isEmpty {
                append(.paragraph(paragraph))
            }
            paragraphLines = []
        }

        for rawLine in text.components(separatedBy: .newlines) {
            let line = rawLine.trimmingCharacters(in: .whitespacesAndNewlines)
            if line.isEmpty {
                flushParagraph()
                continue
            }

            if let numbered = workspaceNumberedLine(line) {
                flushParagraph()
                append(.numbered(numbered.number, numbered.text))
            } else if let bullet = workspaceBulletLine(line) {
                flushParagraph()
                append(.bullet(bullet))
            } else if workspaceLooksLikeStandaloneCommand(line) {
                flushParagraph()
                append(.command(line))
            } else if workspaceLooksLikeLinkLine(line) {
                flushParagraph()
                append(.link(line))
            } else if let labeled = workspaceLabeledLine(line) {
                flushParagraph()
                append(.labeled(label: labeled.label, body: labeled.body))
            } else if workspaceLooksLikeSectionHeading(line) {
                flushParagraph()
                append(.section(String(line.dropLast()).trimmingCharacters(in: .whitespacesAndNewlines)))
            } else {
                paragraphLines.append(line)
            }
        }

        flushParagraph()
        return blocks.isEmpty ? [WorkspaceReadableMessageBlock(id: 0, kind: .paragraph(text))] : blocks
    }

    private func workspaceNumberedLine(_ line: String) -> (number: Int, text: String)? {
        guard let dotIndex = line.firstIndex(of: ".") else { return nil }
        let prefix = line[..<dotIndex]
        guard let number = Int(prefix), number > 0, number < 100 else { return nil }
        let rest = line[line.index(after: dotIndex)...].trimmingCharacters(in: .whitespacesAndNewlines)
        return rest.isEmpty ? nil : (number, rest)
    }

    private func workspaceBulletLine(_ line: String) -> String? {
        for prefix in ["- ", "• ", "* "] where line.hasPrefix(prefix) {
            let rest = line.dropFirst(prefix.count).trimmingCharacters(in: .whitespacesAndNewlines)
            return rest.isEmpty ? nil : rest
        }
        return nil
    }

    private func workspaceLabeledLine(_ line: String) -> (label: String, body: String)? {
        let separators = [":", "："]
        guard let separatorIndex = line.firstIndex(where: { separators.contains(String($0)) }) else {
            return nil
        }
        let label = line[..<separatorIndex].trimmingCharacters(in: .whitespacesAndNewlines)
        let body = line[line.index(after: separatorIndex)...].trimmingCharacters(in: .whitespacesAndNewlines)
        guard !label.isEmpty, !body.isEmpty, label.count <= 16 else { return nil }
        return (label, body)
    }

    private func workspaceLooksLikeSectionHeading(_ line: String) -> Bool {
        guard line.hasSuffix(":") || line.hasSuffix("：") else { return false }
        let heading = String(line.dropLast()).trimmingCharacters(in: .whitespacesAndNewlines)
        return !heading.isEmpty && heading.count <= 22
    }

    private func workspaceLooksLikeStandaloneCommand(_ line: String) -> Bool {
        line.hasPrefix("/")
    }

    private func workspaceLooksLikeLinkLine(_ line: String) -> Bool {
        line.localizedCaseInsensitiveContains("http://")
            || line.localizedCaseInsensitiveContains("https://")
            || line.localizedCaseInsensitiveContains("threads.net")
    }

    @ViewBuilder
    private func workspaceReadableBlock(_ block: WorkspaceReadableMessageBlock) -> some View {
        switch block.kind {
        case .paragraph(let text):
            Text(text)
                .font(.system(size: 14, weight: .regular))
                .foregroundStyle(.white.opacity(0.88))
                .lineSpacing(4)
                .fixedSize(horizontal: false, vertical: true)
        case .section(let title):
            Text(title)
                .font(.system(size: 11, weight: .heavy, design: .rounded))
                .foregroundStyle(workspaceMissionFirstAccent.opacity(0.86))
                .padding(.top, 2)
        case .labeled(let label, let body):
            HStack(alignment: .top, spacing: 9) {
                Text(label)
                    .font(.system(size: 10, weight: .heavy, design: .rounded))
                    .foregroundStyle(workspaceMissionFirstAccent.opacity(0.88))
                    .padding(.horizontal, 7)
                    .frame(minHeight: 21)
                    .background(Capsule().fill(workspaceMissionFirstAccent.opacity(0.10)))
                Text(body)
                    .font(.system(size: 13, weight: .regular))
                    .foregroundStyle(.white.opacity(0.82))
                    .lineSpacing(3)
                    .fixedSize(horizontal: false, vertical: true)
            }
        case .numbered(let number, let text):
            HStack(alignment: .top, spacing: 9) {
                Text("\(number)")
                    .font(.system(size: 10, weight: .heavy, design: .rounded))
                    .foregroundStyle(Color.black.opacity(0.70))
                    .frame(width: 21, height: 21)
                    .background(Circle().fill(workspaceMissionFirstAccent.opacity(0.88)))
                Text(text)
                    .font(.system(size: 13, weight: .regular))
                    .foregroundStyle(.white.opacity(0.84))
                    .lineSpacing(3)
                    .fixedSize(horizontal: false, vertical: true)
            }
        case .bullet(let text):
            HStack(alignment: .top, spacing: 9) {
                Circle()
                    .fill(workspaceMissionFirstAccent.opacity(0.78))
                    .frame(width: 5, height: 5)
                    .padding(.top, 8)
                    .frame(width: 21)
                Text(text)
                    .font(.system(size: 13, weight: .regular))
                    .foregroundStyle(.white.opacity(0.82))
                    .lineSpacing(3)
                    .fixedSize(horizontal: false, vertical: true)
            }
        case .command(let text):
            workspaceReadableUtilityRow(text, systemImage: "terminal.fill")
        case .link(let text):
            workspaceReadableUtilityRow(text, systemImage: "link")
        }
    }

    private func workspaceReadableUtilityRow(_ text: String, systemImage: String) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: systemImage)
                .font(.system(size: 11, weight: .bold))
                .foregroundStyle(workspaceMissionFirstAccent.opacity(0.82))
                .frame(width: 15)
                .padding(.top, 2)
            Text(text)
                .font(.system(size: 12, weight: .medium, design: .monospaced))
                .foregroundStyle(.white.opacity(0.78))
                .lineLimit(3)
                .truncationMode(.middle)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .background(
            RoundedRectangle(cornerRadius: 9, style: .continuous)
                .fill(Color.white.opacity(0.055))
                .overlay(
                    RoundedRectangle(cornerRadius: 9, style: .continuous)
                        .stroke(Color.white.opacity(0.08), lineWidth: 1)
                )
        )
    }

    private func workspaceStructuredPrompt(_ prompt: StructuredPromptRequest) -> some View {
        HStack(alignment: .bottom, spacing: 10) {
            VStack(alignment: .leading, spacing: 5) {
                Text("Assistant")
                    .font(.system(size: 10, weight: .bold, design: .rounded))
                    .foregroundStyle(.white.opacity(0.42))

                inlineStructuredPrompt(prompt, submissionState: submissionState(for: prompt))
                    .padding(.horizontal, 13)
                    .padding(.vertical, 12)
                    .background(workspaceBubbleBackground(isUser: false, isError: false))
            }
            .frame(maxWidth: 720, alignment: .leading)

            Spacer(minLength: 90)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityIdentifier("workspace.chat.structuredPrompt")
    }

    private func workspaceBipMissionChoiceBubble(
        text: String,
        choices: [BipCoachMission],
        authActions: [ProviderAuthAction] = []
    ) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            if !text.isEmpty {
                Text(text)
                    .font(.system(size: 12, weight: .semibold, design: .rounded))
                    .foregroundStyle(.white.opacity(0.64))
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)
            }

            HStack(spacing: 6) {
                Image(systemName: "arrow.down.forward.circle.fill")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Agentic30BrandColor.greenBright.opacity(0.80))
                Text("오늘 실행 카드에서 후보를 선택하세요.")
                    .font(.system(size: 12, weight: .bold, design: .rounded))
                    .foregroundStyle(.white.opacity(0.86))
            }

            VStack(alignment: .leading, spacing: 4) {
                ForEach(Array(choices.prefix(3).enumerated()), id: \.element.id) { index, mission in
                    HStack(spacing: 7) {
                        Text("\(index + 1)")
                            .font(.system(size: 9, weight: .heavy, design: .rounded))
                            .foregroundStyle(Color.black.opacity(0.68))
                            .frame(width: 17, height: 17)
                            .background(Circle().fill(missionChoiceAccent(index).opacity(0.88)))
                        Text(mission.title?.nonEmpty ?? "오늘 미션")
                            .font(.system(size: 11, weight: .semibold, design: .rounded))
                            .foregroundStyle(.white.opacity(0.58))
                            .lineLimit(1)
                        Spacer(minLength: 0)
                    }
                }
            }

            if !authActions.isEmpty {
                workspaceProviderAuthActions(actions: authActions)
            }
        }
        .padding(.horizontal, 13)
        .padding(.vertical, 10)
        .background(workspaceBubbleBackground(isUser: false, isError: false))
        .accessibilityIdentifier("workspace.chat.bipMissionChoices")
    }

    // MARK: - Inline Decision Card (Decision Card Stack variant)
    //
    // Renders an assistant message whose `inlineDecision` payload is non-nil as
    // a separate sage-accented card stack beneath the bubble. The data model
    // is `StructuredPromptQuestion` (same shape as the form-style intake), but
    // the presentation is a single inline card rather than a multi-question
    // form. Mutual exclusion with `ChatSession.pendingUserInput` is enforced
    // at the producer (sidecar): when a form intake is active, the LLM does
    // not emit an inline_decision payload.
    //
    // Selection behavior: clicking an option pipes the option's label into
    // the chat draft and submits as a normal user turn, so the assistant
    // card stays in history as the rationale for the user's reply (D3=C —
    // history preserves the question, You bubble shows the answer).

    @ViewBuilder
    private func workspaceInlineDecisionCard(
        _ decision: StructuredPromptQuestion,
        text: String,
        isActive: Bool
    ) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            if !text.isEmpty {
                Text(text)
                    .font(.system(size: 13, weight: .semibold, design: .rounded))
                    .foregroundStyle(.white.opacity(0.90))
                    .textSelection(.enabled)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.horizontal, 13)
                    .padding(.vertical, 10)
                    .background(workspaceBubbleBackground(isUser: false, isError: false))
            }

            VStack(alignment: .leading, spacing: 0) {
                if let options = decision.options, !options.isEmpty {
                    ForEach(Array(options.enumerated()), id: \.element.label) { pair in
                        let index = pair.offset
                        let option = pair.element
                        inlineDecisionRow(
                            index: index,
                            option: option,
                            decision: decision,
                            isActive: isActive
                        )
                        if index < options.count - 1 {
                            Rectangle()
                                .fill(Color.white.opacity(0.05))
                                .frame(height: 1)
                        }
                    }
                }

                if decision.allowFreeText == true {
                    inlineDecisionFreeTextHint(for: decision)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 12)
                }
            }
            .frame(maxWidth: 560, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .fill(Color(red: 0.039, green: 0.039, blue: 0.043))
                    .overlay(
                        RoundedRectangle(cornerRadius: 14, style: .continuous)
                            .stroke(Color.white.opacity(0.08), lineWidth: 1)
                    )
            )
            .shadow(color: Color.black.opacity(0.35), radius: 18, x: 0, y: 4)
            // Dim the entire card once it's no longer the active decision so
            // the user reads it as historical context, not a live action.
            .opacity(isActive ? 1.0 : 0.55)
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("workspace.chat.inlineDecision")
    }

    @ViewBuilder
    private func inlineDecisionRow(
        index: Int,
        option: StructuredPromptOption,
        decision: StructuredPromptQuestion,
        isActive: Bool
    ) -> some View {
        let multi = decision.multiSelect ?? false
        let baseRow = Button {
            // Single-select: pipe the label into the draft and submit as a
            // normal user turn. The assistant card stays in history so the
            // user can see what they were answering (D3=C).
            viewModel.draft = option.label
            viewModel.sendPrompt()
        } label: {
            HStack(alignment: .top, spacing: 12) {
                Circle()
                    .stroke(Color.white.opacity(0.40), lineWidth: 1.5)
                    .frame(width: 10, height: 10)
                    .padding(.top, 5)

                VStack(alignment: .leading, spacing: 4) {
                    Text(option.label)
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(.white.opacity(0.92))
                    if !option.description.isEmpty {
                        Text(option.description)
                            .font(.system(size: 12, weight: .regular))
                            .foregroundStyle(.white.opacity(0.58))
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }

                Spacer(minLength: 0)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 14)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(!isActive)
        .accessibilityIdentifier("workspace.chat.inlineDecisionRow.\(index + 1).\(option.label)")
        .accessibilityLabel(option.label)
        .accessibilityHint(option.description)
        .accessibilityAddTraits(.isButton)

        // D4=C: 1/2/3 keyboard shortcut for single-select rows up to 9
        // options. Codex P1 #8: only the latest active card binds shortcuts
        // so old cards can't capture keystrokes after the user has answered.
        // Multi-select skips the shortcut to avoid ambiguous "select but
        // don't submit" semantics. Q2=A: chat draft TextField focus captures
        // keystrokes via SwiftUI focus precedence so the shortcut doesn't
        // fire while the user is typing free text.
        if isActive && !multi && index < 9 {
            baseRow.keyboardShortcut(KeyEquivalent(Character("\(index + 1)")), modifiers: [])
        } else {
            baseRow
        }
    }

    @ViewBuilder
    private func inlineDecisionFreeTextHint(for decision: StructuredPromptQuestion) -> some View {
        // D2=B: only rendered when `allowFreeText == true`. The actual text
        // input lives on the existing chat draft TextField — clicking this hint
        // is informational; the user types into the chat input bar as usual.
        HStack(spacing: 6) {
            Text("또는")
                .font(.system(size: 11, weight: .regular))
                .foregroundStyle(.white.opacity(0.42))
            Text(decision.freeTextPlaceholder?.nonEmpty ?? "직접 입력하기")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(.white.opacity(0.55))
                .underline(true, color: Color.white.opacity(0.30))
        }
        .accessibilityIdentifier("workspace.chat.inlineDecisionFreeText")
    }

    private func workspaceProviderAuthBubble(text: String, actions: [ProviderAuthAction]) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(text.isEmpty ? "Provider 로그인이 필요합니다." : text)
                .font(.system(size: 13, weight: .semibold, design: .rounded))
                .foregroundStyle(.white.opacity(0.90))
                .textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true)

            workspaceProviderAuthActions(actions: actions)
        }
        .padding(.horizontal, 13)
        .padding(.vertical, 10)
        .background(workspaceBubbleBackground(isUser: false, isError: true))
        .accessibilityIdentifier("workspace.chat.providerAuth")
    }

    private func workspaceProviderAuthActions(actions: [ProviderAuthAction]) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            ForEach(actions) { action in
                Button {
                    if action.provider == .gemini {
                        viewModel.openGeminiAdcLoginInTerminal()
                    } else {
                        viewModel.startProviderLogin(action.provider)
                    }
                } label: {
                    HStack(spacing: 8) {
                        Image(systemName: providerAuthActionIcon(action.provider))
                            .font(.system(size: 12, weight: .bold))
                        VStack(alignment: .leading, spacing: 2) {
                            Text(action.title)
                                .font(.system(size: 12, weight: .bold, design: .rounded))
                            if let detail = action.detail?.nonEmpty {
                                Text(detail)
                                    .font(.system(size: 10, weight: .semibold, design: .rounded))
                                    .foregroundStyle(.white.opacity(0.52))
                            }
                        }
                        Spacer(minLength: 8)
                        if viewModel.providerAuthInProgress == action.provider {
                            ProgressView()
                                .controlSize(.small)
                                .scaleEffect(0.7)
                        }
                    }
                    .foregroundStyle(.white.opacity(0.92))
                    .padding(.horizontal, 11)
                    .padding(.vertical, 9)
                    .background(Color.white.opacity(0.075), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: 8, style: .continuous)
                            .stroke(Color.white.opacity(0.10), lineWidth: 1)
                    )
                }
                .buttonStyle(.plain)
                .disabled(viewModel.providerAuthInProgress == action.provider)
            }

            if let message = viewModel.providerAuthMessage?.nonEmpty {
                Text(message)
                    .font(.system(size: 10, weight: .semibold, design: .rounded))
                    .foregroundStyle(.white.opacity(0.48))
                    .lineLimit(2)
            }
        }
    }

    private func workspaceBipMissionChoiceCard(_ mission: BipCoachMission, index: Int) -> some View {
        Button {
            viewModel.selectBipMission(mission)
        } label: {
            HStack(alignment: .top, spacing: 10) {
                Text("추천 \(index + 1)")
                    .font(.system(size: 10, weight: .heavy, design: .rounded))
                    .foregroundStyle(Color.black.opacity(0.70))
                    .padding(.horizontal, 8)
                    .frame(height: 24)
                    .background(Capsule().fill(missionChoiceAccent(index).opacity(0.92)))

                VStack(alignment: .leading, spacing: 5) {
                    Text(mission.title?.nonEmpty ?? "오늘 미션")
                        .font(.system(size: 13, weight: .heavy, design: .rounded))
                        .foregroundStyle(.white.opacity(0.94))
                        .lineLimit(2)
                    Text(mission.angle?.nonEmpty ?? mission.mission?.nonEmpty ?? "공개 기록과 오늘 커리큘럼을 반영한 실행")
                        .font(.system(size: 11, weight: .semibold, design: .rounded))
                        .foregroundStyle(.white.opacity(0.62))
                        .lineLimit(2)
                    if let missionText = mission.mission?.nonEmpty {
                        Text(missionText)
                            .font(.system(size: 11, weight: .medium, design: .rounded))
                            .foregroundStyle(.white.opacity(0.50))
                            .lineLimit(2)
                    }
                }

                Spacer(minLength: 0)

                VStack(alignment: .trailing, spacing: 5) {
                    Text("15분")
                        .font(.system(size: 10, weight: .heavy, design: .rounded))
                        .foregroundStyle(workspaceMissionFirstAccent.opacity(0.88))
                    Image(systemName: "chevron.right.circle.fill")
                        .font(.system(size: 15, weight: .bold))
                        .foregroundStyle(.white.opacity(0.48))
                }
                .padding(.top, 2)
            }
            .padding(12)
            .background(
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .fill(Color.white.opacity(index == 0 ? 0.075 : 0.055))
                    .overlay(
                        RoundedRectangle(cornerRadius: 10, style: .continuous)
                            .stroke(index == 0 ? workspaceMissionFirstAccent.opacity(0.18) : Color.white.opacity(0.09), lineWidth: 1)
                    )
            )
            .contentShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("workspace.chat.bipMissionChoice.\(index + 1)")
        .accessibilityLabel(mission.title?.nonEmpty ?? "오늘 실행 \(index + 1)")
    }

    private func missionChoiceAccent(_ index: Int) -> Color {
        switch index {
        case 0:
            return Agentic30BrandColor.greenBright
        case 1:
            return Color(red: 0.96, green: 0.73, blue: 0.42)
        default:
            return Color(red: 0.54, green: 0.78, blue: 0.96)
        }
    }

    private func workspacePendingUserBubble(_ prompt: String) -> some View {
        HStack(alignment: .bottom, spacing: 10) {
            Spacer(minLength: 90)
            VStack(alignment: .trailing, spacing: 5) {
                Text("You")
                    .font(.system(size: 10, weight: .bold, design: .rounded))
                    .foregroundStyle(.white.opacity(0.42))
                Text(prompt)
                    .font(.system(size: 13, weight: .semibold, design: .rounded))
                    .foregroundStyle(.white.opacity(0.90))
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.horizontal, 13)
                    .padding(.vertical, 10)
                    .background(workspaceBubbleBackground(isUser: true, isError: false))
            }
            .frame(maxWidth: 720, alignment: .trailing)
        }
        .frame(maxWidth: .infinity, alignment: .trailing)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("workspace.chat.pendingUser")
        .accessibilityLabel(prompt)
    }

    private func workspaceAssistantProgressBubble(_ session: ChatSession) -> some View {
        HStack(alignment: .bottom, spacing: 10) {
            VStack(alignment: .leading, spacing: 5) {
                Text("Assistant")
                    .font(.system(size: 10, weight: .bold, design: .rounded))
                    .foregroundStyle(.white.opacity(0.42))
                assistantLiveStatusPanel(session)
                .background(workspaceBubbleBackground(isUser: false, isError: false))
                .accessibilityIdentifier("workspace.chat.assistantProgress")
            }
            .frame(maxWidth: 720, alignment: .leading)
            Spacer(minLength: 90)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder
    private func workspaceBubbleBackground(isUser: Bool, isError: Bool) -> some View {
        let shape = RoundedRectangle(cornerRadius: 14, style: .continuous)
        if isError {
            shape
                .fill(Color(red: 0.55, green: 0.18, blue: 0.15).opacity(0.30))
                .overlay(shape.stroke(Color(red: 1.0, green: 0.45, blue: 0.38).opacity(0.22), lineWidth: 1))
        } else if isUser {
            shape
                .fill(Color(red: 0.32, green: 0.43, blue: 0.52).opacity(0.34))
                .overlay(shape.stroke(Color.white.opacity(0.10), lineWidth: 1))
        } else {
            shape
                .fill(Color.black.opacity(0.18))
                .overlay(shape.stroke(Color.white.opacity(0.08), lineWidth: 1))
        }
    }

    @ViewBuilder
    private func workspacePreparingMainRail(_ day: AgenticCurriculumDay) -> some View {
        if selectedWorkspaceSection == .settings {
            SettingsView(
                viewModel: viewModel,
                embeddedInWorkspace: true,
                selectedSection: $selectedSettingsSection,
                showsWorkspaceSettingsSidebar: false,
                returnToWorkspace: {
                    withAnimation(.spring(response: 0.24, dampingFraction: 0.88)) {
                        selectedWorkspaceSection = .curriculum
                    }
                }
            )
                .accessibilityIdentifier("workspace.settingsPage")
        } else {
            VStack(alignment: .leading, spacing: 16) {
                ScrollView {
                    VStack(alignment: .leading, spacing: 16) {
                        if isIddSetupLocked {
                            foundationSetupFallbackSurface(session: nil)
                        } else {
                            workspaceMissionFirstSurface(day: day, session: nil)
                        }
                    }
                    .frame(maxWidth: 1180, alignment: .leading)
                    .padding(.horizontal, 34)
                    .padding(.vertical, 28)
                }

                VStack(spacing: 8) {
                    if !isIddSetupLocked {
                        workspaceStartupQueueStatus()
                        promptComposer()
                    }
                }
                .frame(maxWidth: 1180)
                .padding(.horizontal, 34)
                .padding(.bottom, 18)
            }
            .accessibilityIdentifier("workspace.dayDetail")
        }
    }

    private func basicMissionAvailable(coach: BipCoachState?) -> Bool {
        viewModel.selectedSession != nil || coach?.sessionId?.nonEmpty != nil
    }

    private func fullCoachReady(coach: BipCoachState, readiness: BipReadinessState) -> Bool {
        coach.isConfigured && readiness.bipCoachSetupComplete && !readiness.hasBlockingBipCoachSetupIssue
    }

    /// Defensive/debug Foundation Setup fallback outside the normal OpenDesign Day 1 route.
    /// Do not add Day 1 ICP cards here; `OpenDesignDayPageView` owns that flow.
    private func foundationSetupFallbackSurface(session: ChatSession?) -> some View {
        let previews = viewModel.iddDocPreviews
        let draftedCount = previews.filter { $0.status == "drafted" || !$0.content.isEmpty }.count
        let totalCount = max(viewModel.iddDocOrder.count, 4)
        let isPreviewReady = viewModel.iddSetupStatus == "preview_ready"
        let isSetupError = viewModel.iddSetupStatus == "error"
        let setupTitle = isPreviewReady ? "시작 기준을 확인하세요" : legacyFoundationSetupTitle(for: viewModel.iddCurrentDocType)
        let setupSubtitle = isPreviewReady
            ? "확인하면 바로 오늘 할 일을 만들 수 있어요."
            : "오늘 할 일을 만들기 전에, 누구를 위해 무엇을 검증할지 먼저 정해요."

        return VStack(alignment: .leading, spacing: 16) {
            if let toast = viewModel.dimensionTransitionToast {
                legacyFoundationDimensionTransitionToast(toast)
            }
            HStack(alignment: .top, spacing: 13) {
                Image(systemName: "doc.text.magnifyingglass")
                    .font(.system(size: 17, weight: .heavy))
                    .foregroundStyle(Color.black.opacity(0.76))
                    .frame(width: 34, height: 34)
                    .background(Circle().fill(Agentic30BrandColor.greenBright.opacity(0.94)))

                VStack(alignment: .leading, spacing: 7) {
                    Text(setupTitle)
                        .font(.system(size: 25, weight: .heavy, design: .rounded))
                        .foregroundStyle(.white.opacity(0.97))
                        .fixedSize(horizontal: false, vertical: true)

                    Text(setupSubtitle)
                        .font(.system(size: 14, weight: .semibold, design: .rounded))
                        .foregroundStyle(.white.opacity(0.62))
                        .fixedSize(horizontal: false, vertical: true)
                }

                Spacer(minLength: 16)

                Text("\(draftedCount)/\(totalCount)")
                    .font(.system(size: 12, weight: .heavy, design: .rounded))
                    .foregroundStyle(.white.opacity(0.78))
                    .padding(.horizontal, 10)
                    .frame(height: 28)
                    .background(Capsule().fill(Color.white.opacity(0.09)))
            }

            HStack(spacing: 8) {
                ForEach(["icp", "goal", "values", "spec"], id: \.self) { docType in
                    legacyFoundationDocChip(docType)
                }
                Spacer(minLength: 0)
            }
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("workspace.iddSetup.progress")

            if let recovery = viewModel.iddProviderRecovery,
               let provider = recovery.provider {
                legacyFoundationProviderRecovery(recovery, provider: provider)
            } else if let prompt = session?.pendingUserInput,
                      viewModel.isMatchingFoundationPrompt(prompt) {
                inlineStructuredPrompt(
                    prompt,
                    compact: true,
                    submissionState: submissionState(for: prompt)
                )
                    .accessibilityIdentifier("workspace.iddSetup.question")
            } else if viewModel.isMismatchedFoundationPrompt(session?.pendingUserInput) {
                legacyFoundationPromptMismatch(session?.pendingUserInput)
                    .onAppear {
                        viewModel.retryCurrentIddQuestion()
                    }
            } else if isPreviewReady {
                legacyFoundationPreview(previews)
            } else if isSetupError {
                legacyFoundationSetupError(viewModel.iddSetupError)
            } else {
                legacyFoundationWaitingState()
            }

            if isPreviewReady {
                HStack(spacing: 10) {
                    Spacer(minLength: 0)
                    Button {
                        viewModel.approveIddSetup()
                    } label: {
                        Label("확인하고 오늘 할 일 만들기", systemImage: "checkmark.seal.fill")
                            .font(.system(size: 13, weight: .heavy, design: .rounded))
                            .foregroundStyle(Color.black.opacity(0.76))
                            .padding(.horizontal, 14)
                            .frame(height: 36)
                            .background(Capsule().fill(Agentic30BrandColor.greenBright.opacity(0.94)))
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("workspace.iddSetup.approve")
                }
            }

        }
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .fill(Color.white.opacity(0.075))
                .overlay(
                    RoundedRectangle(cornerRadius: 22, style: .continuous)
                        .stroke(Agentic30BrandColor.greenBright.opacity(0.18), lineWidth: 1)
                )
        )
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("workspace.iddSetupSurface")
    }

    @ViewBuilder
    private func legacyFoundationDimensionTransitionToast(
        _ toast: AgenticViewModel.DimensionTransitionToast
    ) -> some View {
        HStack(spacing: 10) {
            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 13, weight: .heavy))
                .foregroundStyle(Agentic30BrandColor.greenBright.opacity(0.94))
            Text("좋아요. \(toast.from) 완료 → \(toast.to)로 넘어갑니다.")
                .font(.system(size: 13, weight: .heavy, design: .rounded))
                .foregroundStyle(.white.opacity(0.92))
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .background(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(Agentic30BrandColor.greenBright.opacity(0.10))
                .overlay(
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .stroke(Agentic30BrandColor.greenBright.opacity(0.30), lineWidth: 1)
                )
        )
        .transition(
            reduceMotion
                ? .opacity
                : .asymmetric(
                    insertion: .offset(y: -6).combined(with: .opacity),
                    removal: .opacity
                )
        )
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("workspace.iddSetup.dimensionTransitionToast")
    }

    private func legacyFoundationSetupTitle(for docType: String?) -> String {
        switch docType?.lowercased() {
        case "goal":
            return "이번 주 확인할 목표를 정해요"
        case "values":
            return "중요한 판단 기준을 정해요"
        case "spec":
            return "첫 버전의 범위를 정해요"
        default:
            return "먼저 도울 사람을 정해요"
        }
    }

    private func legacyFoundationDocChip(_ docType: String) -> some View {
        let preview = viewModel.iddDocPreviews.first { $0.type == docType }
        let isDrafted = preview?.status == "drafted" || preview?.content.isEmpty == false
        let isCurrent = viewModel.iddCurrentDocType == docType && !isDrafted
        let accessibilityState = isDrafted ? "완료" : (isCurrent ? "현재 단계" : "대기")
        return Label(docType.uppercased(), systemImage: isDrafted ? "checkmark.circle.fill" : (isCurrent ? "circle.dotted" : "circle"))
            .font(.system(size: 11, weight: .heavy, design: .rounded))
            .foregroundStyle(.white.opacity(isDrafted || isCurrent ? 0.82 : 0.42))
            .padding(.horizontal, 9)
            .frame(height: 28)
            .background(Capsule().fill(Color.white.opacity(isDrafted ? 0.12 : 0.06)))
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("\(docType.uppercased()), \(accessibilityState)")
            .accessibilityIdentifier("workspace.iddSetup.doc.\(docType)")
    }

    private func legacyFoundationProviderRecovery(_ recovery: IddProviderRecovery, provider: AgentProvider) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(recovery.message?.nonEmpty ?? "\(provider.title) 로그인이 필요합니다.")
                .font(.system(size: 13, weight: .semibold, design: .rounded))
                .foregroundStyle(.white.opacity(0.72))
                .fixedSize(horizontal: false, vertical: true)

            workspaceProviderAuthActions(actions: [
                ProviderAuthAction(
                    id: recovery.actionId ?? "\(provider.rawValue)_login",
                    provider: provider,
                    title: "\(provider.title) 로그인",
                    detail: "Foundation Setup 인터뷰를 계속하려면 provider 인증이 필요합니다."
                )
            ])
        }
        .padding(14)
        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Color.black.opacity(0.16)))
        .accessibilityIdentifier("workspace.iddSetup.providerRecovery")
    }

    private func legacyFoundationSetupError(_ error: IddSetupError?) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Label("인터뷰 질문을 만들지 못했습니다.", systemImage: "exclamationmark.triangle.fill")
                .font(.system(size: 13, weight: .heavy, design: .rounded))
                .foregroundStyle(Color(red: 1.0, green: 0.75, blue: 0.35))

            Text(error?.message?.nonEmpty ?? "질문 카드 준비가 중단됐습니다. 다시 시도해 주세요.")
                .font(.system(size: 12, weight: .semibold, design: .rounded))
                .foregroundStyle(.white.opacity(0.68))
                .lineLimit(4)
                .fixedSize(horizontal: false, vertical: true)

            Button {
                viewModel.startBipIddQueue(docType: error?.docType ?? viewModel.iddCurrentDocType)
            } label: {
                Label("다시 시도", systemImage: "arrow.clockwise")
                    .font(.system(size: 12, weight: .heavy, design: .rounded))
                    .foregroundStyle(.white.opacity(0.88))
                    .padding(.horizontal, 12)
                    .frame(height: 32)
                    .background(Capsule().fill(Color.white.opacity(0.10)))
            }
            .buttonStyle(.plain)
            .disabled(!viewModel.isConnected)
        }
        .padding(14)
        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Color.black.opacity(0.16)))
        .accessibilityIdentifier("workspace.iddSetup.error")
    }

    private func legacyFoundationPromptMismatch(_ prompt: StructuredPromptRequest?) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Label("현재 단계와 질문이 맞지 않습니다.", systemImage: "arrow.triangle.2.circlepath.circle.fill")
                .font(.system(size: 13, weight: .heavy, design: .rounded))
                .foregroundStyle(Color(red: 1.0, green: 0.75, blue: 0.35))

            Text("현재 Foundation 단계에 맞는 질문을 다시 준비하고 있습니다. 잠시 후에도 바뀌지 않으면 다시 시도해 주세요.")
                .font(.system(size: 12, weight: .semibold, design: .rounded))
                .foregroundStyle(.white.opacity(0.68))
                .fixedSize(horizontal: false, vertical: true)

            if let prompt {
                Text("받은 질문: \(prompt.toolName)")
                    .font(.system(size: 10, weight: .bold, design: .rounded))
                    .foregroundStyle(.white.opacity(0.42))
                    .lineLimit(1)
            }

            Button {
                viewModel.retryCurrentIddQuestion()
            } label: {
                Label("다시 시도", systemImage: "arrow.clockwise")
                    .font(.system(size: 12, weight: .heavy, design: .rounded))
                    .foregroundStyle(.white.opacity(0.88))
                    .padding(.horizontal, 12)
                    .frame(height: 32)
                    .background(Capsule().fill(Color.white.opacity(0.10)))
            }
            .buttonStyle(.plain)
            .disabled(!viewModel.isConnected)
        }
        .padding(14)
        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Color.black.opacity(0.16)))
        .accessibilityIdentifier("workspace.iddSetup.promptMismatch")
    }

    private func legacyFoundationPreview(_ previews: [IddDocPreview]) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(Array(previews.enumerated()), id: \.element.id) { index, preview in
                VStack(alignment: .leading, spacing: 6) {
                    HStack {
                        Text(preview.path)
                            .font(.system(size: 12, weight: .heavy, design: .rounded))
                            .foregroundStyle(.white.opacity(0.84))
                        Spacer(minLength: 0)
                        Text(preview.status)
                            .font(.system(size: 10, weight: .bold, design: .rounded))
                            .foregroundStyle(.white.opacity(0.42))
                    }
                    Text(preview.content.nonEmpty ?? "아직 초안이 없습니다.")
                        .font(.system(size: 11, weight: .medium, design: .monospaced))
                        .foregroundStyle(.white.opacity(0.58))
                        .lineLimit(6)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .padding(.vertical, 11)
                if index < previews.count - 1 {
                    Rectangle()
                        .fill(Color.white.opacity(0.08))
                        .frame(height: 1)
                }
            }
        }
        .accessibilityIdentifier("workspace.iddSetup.preview")
    }

    private func legacyFoundationWaitingState() -> some View {
        HStack(spacing: 9) {
            ProgressView()
                .controlSize(.small)
            Text("인터뷰 질문 카드를 준비하고 있어요.")
                .font(.system(size: 13, weight: .bold, design: .rounded))
                .foregroundStyle(.white.opacity(0.62))
        }
        .accessibilityIdentifier("workspace.iddSetup.waiting")
    }

    private func workspaceGraduationSurface() -> some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack(alignment: .top, spacing: 13) {
                Image(systemName: "checkmark.seal.fill")
                    .font(.system(size: 18, weight: .heavy))
                    .foregroundStyle(Color.black.opacity(0.76))
                    .frame(width: 36, height: 36)
                    .background(Circle().fill(Agentic30BrandColor.greenBright.opacity(0.94)))

                VStack(alignment: .leading, spacing: 7) {
                    Text("Graduation")
                        .font(.system(size: 11, weight: .heavy, design: .rounded))
                        .foregroundStyle(Agentic30BrandColor.greenBright.opacity(0.94))
                        .textCase(.uppercase)

                    Text("30일 커리큘럼을 완료했어요")
                        .font(.system(size: 26, weight: .heavy, design: .rounded))
                        .foregroundStyle(.white.opacity(0.97))
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityIdentifier("workspace.graduation.title")

                    Text("이제 첫 가치, 유입, 지불 행동의 근거를 기준으로 continue, pivot, stop 중 하나를 선택해보세요.")
                        .font(.system(size: 14, weight: .semibold, design: .rounded))
                        .foregroundStyle(.white.opacity(0.62))
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityIdentifier("workspace.graduation.body")
                }

                Spacer(minLength: 16)
            }

            Text("Agentic30은 여기서 단순하게 끝납니다. 남은 일은 새 모드가 아니라, Day 30 회고를 바탕으로 다음 제품 결정을 실행하는 것입니다.")
                .font(.system(size: 13, weight: .semibold, design: .rounded))
                .foregroundStyle(.white.opacity(0.58))
                .fixedSize(horizontal: false, vertical: true)

            Label("Graduation reached", systemImage: "flag.checkered")
                .font(.system(size: 13, weight: .heavy, design: .rounded))
                .foregroundStyle(Agentic30BrandColor.greenBright.opacity(0.92))
                .accessibilityIdentifier("workspace.graduation.status")
        }
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .fill(Color.white.opacity(0.075))
                .overlay(
                    RoundedRectangle(cornerRadius: 22, style: .continuous)
                        .stroke(Agentic30BrandColor.greenBright.opacity(0.18), lineWidth: 1)
                )
        )
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("workspace.graduationSurface")
    }

    private func workspaceMissionFirstSurface(day: AgenticCurriculumDay, session: ChatSession?) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .top, spacing: 13) {
                Image(systemName: workspaceMissionFirstIcon(session: session))
                    .font(.system(size: 17, weight: .heavy))
                    .foregroundStyle(Color.black.opacity(0.76))
                    .frame(width: 34, height: 34)
                    .background(Circle().fill(workspaceMissionFirstAccent.opacity(0.94)))

                VStack(alignment: .leading, spacing: 7) {
                    Text(workspaceMissionFirstKicker(day: day))
                        .font(.system(size: 11, weight: .heavy, design: .rounded))
                        .foregroundStyle(workspaceMissionFirstAccent.opacity(0.94))
                        .textCase(.uppercase)

                    Text(workspaceMissionFirstTitle(day: day, session: session))
                        .font(.system(size: 25, weight: .heavy, design: .rounded))
                        .foregroundStyle(.white.opacity(0.97))
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityIdentifier("workspace.missionFirst.title")

                    Text(workspaceMissionFirstSubtitle(day: day, session: session))
                        .font(.system(size: 14, weight: .semibold, design: .rounded))
                        .foregroundStyle(.white.opacity(0.62))
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityIdentifier("workspace.missionFirst.dayContext")
                }

                Spacer(minLength: 16)
            }

            workspaceMissionFirstPath(session: session)
            workspaceMissionFirstIntroCard()
            workspaceBipCoachInlineMarker()
            workspaceMissionFirstBody(day: day, session: session)
        }
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .fill(Color.white.opacity(0.075))
                .overlay(
                    RoundedRectangle(cornerRadius: 22, style: .continuous)
                        .stroke(workspaceMissionFirstAccent.opacity(0.18), lineWidth: 1)
                )
        )
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("workspace.missionFirstSurface")
    }

    private enum WorkspaceMissionFirstStep: Int, CaseIterable {
        case enter
        case context
        case choose
        case answer

        var title: String {
            switch self {
            case .enter:
                return "연결됨"
            case .context:
                return "맥락 확인"
            case .choose:
                return "미션 선택"
            case .answer:
                return "초안/도움"
            }
        }

        var icon: String {
            switch self {
            case .enter:
                return "macwindow"
            case .context:
                return "doc.text.magnifyingglass"
            case .choose:
                return "list.bullet.clipboard.fill"
            case .answer:
                return "text.bubble.fill"
            }
        }
    }

    private func workspaceMissionFirstPath(session: ChatSession?) -> some View {
        HStack(spacing: 8) {
            ForEach(WorkspaceMissionFirstStep.allCases, id: \.self) { step in
                workspaceMissionFirstStepChip(step, session: session)
                if step != .answer {
                    Rectangle()
                        .fill(Color.white.opacity(0.10))
                        .frame(width: 18, height: 1)
                }
            }
            Spacer(minLength: 0)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("진행 단계: \(workspaceMissionFirstAccessibleStep(session: session))")
    }

    @ViewBuilder
    private func workspaceMissionFirstIntroCard() -> some View {
        if !isWorkspaceMissionIntroDismissed {
            VStack(alignment: .leading, spacing: 10) {
                Button {
                    withAnimation(.spring(response: 0.28, dampingFraction: 0.88)) {
                        isWorkspaceMissionIntroExpanded.toggle()
                    }
                } label: {
                    HStack(spacing: 10) {
                        Image(systemName: "play.circle.fill")
                            .font(.system(size: 20, weight: .heavy))
                            .foregroundStyle(workspaceMissionFirstAccent.opacity(0.92))
                            .frame(width: 24)

                        VStack(alignment: .leading, spacing: 3) {
                            Text("처음이신가요? 60초 보기")
                                .font(.system(size: 12, weight: .heavy, design: .rounded))
                                .foregroundStyle(.white.opacity(0.90))
                            Text("프로젝트 읽기 → 후보 선택 → 초안 요청 → 완료 기록")
                                .font(.system(size: 11, weight: .semibold, design: .rounded))
                                .foregroundStyle(.white.opacity(0.54))
                                .lineLimit(1)
                        }

                        Spacer(minLength: 0)

                        Image(systemName: isWorkspaceMissionIntroExpanded ? "chevron.up" : "chevron.down")
                            .font(.system(size: 11, weight: .heavy))
                            .foregroundStyle(.white.opacity(0.48))
                    }
                    .padding(.horizontal, 12)
                    .frame(height: 50)
                    .contentShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("workspace.missionFirst.introToggle")
                .accessibilityLabel("처음이신가요? 60초 보기")

                if isWorkspaceMissionIntroExpanded {
                    VStack(alignment: .leading, spacing: 11) {
                        HStack(alignment: .top, spacing: 8) {
                            workspaceMissionIntroStep(
                                icon: "folder.badge.gearshape",
                                title: "읽기",
                                detail: "선택한 프로젝트와 Day 맥락을 봅니다."
                            )
                            workspaceMissionIntroStep(
                                icon: "list.bullet.clipboard.fill",
                                title: "고르기",
                                detail: "지금 끝낼 수 있는 후보 하나를 선택합니다."
                            )
                            workspaceMissionIntroStep(
                                icon: "text.bubble.fill",
                                title: "받기",
                                detail: "필요한 질문, 초안, 다음 액션을 요청합니다."
                            )
                            workspaceMissionIntroStep(
                                icon: "checkmark.seal.fill",
                                title: "남기기",
                                detail: "URL이나 배움을 기록하고 Day를 닫습니다."
                            )
                        }

                        HStack(spacing: 8) {
                            Button {
                                withAnimation(.spring(response: 0.24, dampingFraction: 0.88)) {
                                    isWorkspaceMissionIntroExpanded = false
                                }
                            } label: {
                                Text("접기")
                                    .font(.system(size: 11, weight: .bold, design: .rounded))
                                    .foregroundStyle(.white.opacity(0.72))
                                    .padding(.horizontal, 10)
                                    .frame(height: 26)
                                    .background(Capsule().fill(Color.white.opacity(0.08)))
                            }
                            .buttonStyle(.plain)
                            .accessibilityIdentifier("workspace.missionFirst.introCollapse")

                            Button {
                                withAnimation(.spring(response: 0.24, dampingFraction: 0.88)) {
                                    isWorkspaceMissionIntroDismissed = true
                                    isWorkspaceMissionIntroExpanded = false
                                }
                            } label: {
                                Text("다시 보지 않기")
                                    .font(.system(size: 11, weight: .bold, design: .rounded))
                                    .foregroundStyle(.white.opacity(0.50))
                                    .padding(.horizontal, 10)
                                    .frame(height: 26)
                                    .background(Capsule().fill(Color.white.opacity(0.045)))
                            }
                            .buttonStyle(.plain)
                            .accessibilityIdentifier("workspace.missionFirst.introDismiss")
                        }
                    }
                    .padding(.horizontal, 12)
                    .padding(.bottom, 12)
                    .accessibilityIdentifier("workspace.missionFirst.introDemo")
                }
            }
            .background(
                RoundedRectangle(cornerRadius: 15, style: .continuous)
                    .fill(Color.black.opacity(0.12))
                    .overlay(
                        RoundedRectangle(cornerRadius: 15, style: .continuous)
                            .stroke(Color.white.opacity(0.08), lineWidth: 1)
                    )
            )
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("workspace.missionFirst.introCard")
        }
    }

    private func workspaceMissionIntroStep(icon: String, title: String, detail: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Image(systemName: icon)
                .font(.system(size: 13, weight: .heavy))
                .foregroundStyle(workspaceMissionFirstAccent.opacity(0.86))
                .frame(width: 24, height: 24)
                .background(Circle().fill(workspaceMissionFirstAccent.opacity(0.10)))

            Text(title)
                .font(.system(size: 11, weight: .heavy, design: .rounded))
                .foregroundStyle(.white.opacity(0.88))

            Text(detail)
                .font(.system(size: 10, weight: .medium, design: .rounded))
                .foregroundStyle(.white.opacity(0.50))
                .lineLimit(3)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(title): \(detail)")
    }

    private func workspaceMissionFirstStepChip(_ step: WorkspaceMissionFirstStep, session: ChatSession?) -> some View {
        let state = workspaceMissionFirstStepState(step, session: session)
        return HStack(spacing: 6) {
            Image(systemName: state.iconName(for: step))
                .font(.system(size: 10, weight: .heavy))
            Text(step.title)
                .font(.system(size: 11, weight: .heavy, design: .rounded))
        }
        .foregroundStyle(workspaceMissionFirstStepForeground(state))
        .padding(.horizontal, 9)
        .frame(height: 28)
        .background(Capsule().fill(workspaceMissionFirstStepBackground(state)))
        .overlay(Capsule().stroke(workspaceMissionFirstStepStroke(state), lineWidth: 1))
    }

    private enum WorkspaceMissionFirstStepState {
        case done
        case active
        case waiting

        func iconName(for step: WorkspaceMissionFirstStep) -> String {
            switch self {
            case .done:
                return "checkmark.circle.fill"
            case .active, .waiting:
                return step.icon
            }
        }
    }

    private func workspaceMissionFirstStepForeground(_ state: WorkspaceMissionFirstStepState) -> Color {
        switch state {
        case .done:
            return workspaceMissionFirstAccent.opacity(0.92)
        case .active:
            return .white.opacity(0.88)
        case .waiting:
            return .white.opacity(0.42)
        }
    }

    private func workspaceMissionFirstStepBackground(_ state: WorkspaceMissionFirstStepState) -> Color {
        switch state {
        case .done:
            return workspaceMissionFirstAccent.opacity(0.12)
        case .active:
            return Color.white.opacity(0.10)
        case .waiting:
            return Color.white.opacity(0.045)
        }
    }

    private func workspaceMissionFirstStepStroke(_ state: WorkspaceMissionFirstStepState) -> Color {
        switch state {
        case .done:
            return workspaceMissionFirstAccent.opacity(0.18)
        case .active:
            return Color.white.opacity(0.13)
        case .waiting:
            return Color.white.opacity(0.06)
        }
    }

    private func workspaceMissionFirstStepState(_ step: WorkspaceMissionFirstStep, session: ChatSession?) -> WorkspaceMissionFirstStepState {
        if session == nil || workspaceMissionFirstErrorMessage(session: session) != nil {
            return step == .enter ? .active : .waiting
        }
        if viewModel.isBipCoachGenerating || viewModel.bipMissionProgress != nil {
            switch step {
            case .enter:
                return .done
            case .context:
                return .active
            case .choose:
                return .waiting
            case .answer:
                return .waiting
            }
        }
        if viewModel.visibleBipCoach?.currentMission != nil {
            switch step {
            case .enter, .context, .choose:
                return .done
            case .answer:
                return .active
            }
        }
        if viewModel.visibleBipCoach?.pendingMissionChoices.isEmpty == false {
            switch step {
            case .enter, .context:
                return .done
            case .choose:
                return .active
            case .answer:
                return .waiting
            }
        }
        return step == .enter ? .done : (step == .context ? .active : .waiting)
    }

    private func workspaceMissionFirstAccessibleStep(session: ChatSession?) -> String {
        if session == nil {
            return "진입 준비 중"
        }
        if viewModel.visibleBipCoach?.currentMission != nil {
            return "미션 선택 완료, 답변 받기 단계"
        }
        if viewModel.visibleBipCoach?.pendingMissionChoices.isEmpty == false {
            return "미션 선택 단계"
        }
        return "프로젝트 맥락 확인 단계"
    }

    private var workspaceMissionFirstAccent: Color {
        Agentic30BrandColor.greenBright
    }

    private func workspaceMissionFirstIcon(session: ChatSession?) -> String {
        if workspaceMissionFirstErrorMessage(session: session) != nil {
            return "exclamationmark.triangle.fill"
        }
        if session == nil || viewModel.isBipCoachGenerating || viewModel.bipMissionProgress != nil {
            return "sparkles"
        }
        if viewModel.visibleBipCoach?.currentMission != nil {
            return "paperplane.fill"
        }
        if viewModel.visibleBipCoach?.pendingMissionChoices.isEmpty == false {
            return "list.bullet.clipboard.fill"
        }
        return "target"
    }

    private func workspaceMissionFirstKicker(day: AgenticCurriculumDay) -> String {
        "Day \(day.day) · \(day.phase.title)"
    }

    private func workspaceMissionFirstTitle(day: AgenticCurriculumDay, session: ChatSession?) -> String {
        if workspaceMissionFirstErrorMessage(session: session) != nil {
            return "오늘 실행을 불러오지 못했어요"
        }
        if session == nil {
            return "Day \(day.day) · \(day.title)"
        }
        if viewModel.isBipCoachGenerating || viewModel.bipMissionProgress != nil {
            return "프로젝트와 Day 맥락 확인 중"
        }
        if let coach = viewModel.visibleBipCoach {
            if let mission = coach.currentMission, bipMissionMatchesDay(mission, day: day) {
                return "오늘 실행"
            }
            if !coach.pendingMissionChoices.isEmpty {
                return "프로젝트를 읽고 오늘 검증할 행동 하나를 고르세요"
            }
        }
        return "오늘 실행을 먼저 만들까요"
    }

    private func workspaceMissionFirstSubtitle(day: AgenticCurriculumDay, session: ChatSession?) -> String {
        if workspaceMissionFirstErrorMessage(session: session) != nil {
            return "다시 시도하면 미션 후보를 새로 만들게요."
        }
        if session == nil {
            return "오늘 실행을 준비하고 있어요."
        }
        if viewModel.isBipCoachGenerating || viewModel.bipMissionProgress != nil {
            return "프로젝트 기준과 Day \(day.day) 맥락을 보고 실행 하나로 좁히는 중입니다."
        }
        if let coach = viewModel.visibleBipCoach {
            if let mission = coach.currentMission, bipMissionMatchesDay(mission, day: day) {
                return mission.mission?.nonEmpty ?? mission.angle?.nonEmpty ?? "15분 안에 끝낼 공개 실행을 진행합니다."
            }
            if !coach.pendingMissionChoices.isEmpty {
                return "프로젝트를 읽고 지금 바로 실행할 수 있는 15분 미션으로 좁혀드릴게요."
            }
        }
        return "프로젝트 기준으로 지금 할 수 있는 15분 실행 후보를 추천합니다."
    }

    @ViewBuilder
    private func workspaceMissionFirstBody(day: AgenticCurriculumDay, session: ChatSession?) -> some View {
        if let errorMessage = workspaceMissionFirstErrorMessage(session: session) {
            workspaceMissionFirstErrorBody(errorMessage, day: day)
        } else if session == nil {
            workspaceMissionFirstPreparingBody(session: session)
        } else if viewModel.isBipCoachGenerating || viewModel.bipMissionProgress != nil {
            workspaceMissionFirstGeneratingBody()
        } else if let coach = viewModel.visibleBipCoach,
                  let mission = coach.currentMission,
                  bipMissionMatchesDay(mission, day: day) {
            workspaceMissionFirstSelectedMission(mission, coach: coach)
        } else if let coach = viewModel.visibleBipCoach, !coach.pendingMissionChoices.isEmpty {
            workspaceMissionFirstChoices(coach.pendingMissionChoices)
        } else {
            workspaceMissionFirstReadyBody(day: day)
        }
    }

    private func workspaceMissionFirstPreparingBody(session: ChatSession?) -> some View {
        HStack(spacing: 8) {
            ProgressView()
                .controlSize(.small)
            Text(workspaceMissionFirstPreparingText(session: session))
                .font(.system(size: 13, weight: .bold, design: .rounded))
                .foregroundStyle(.white.opacity(0.72))
        }
        .accessibilityIdentifier("workspace.missionFirst.preparing")
    }

    private func workspaceMissionFirstPreparingText(session: ChatSession?) -> String {
        switch workspaceMissionFirstPhase(session: session) {
        case .sidecarStarting:
            return "로컬 실행 환경을 여는 중"
        case .creatingSession:
            return "Codex 세션을 여는 중"
        default:
            return "프로젝트와 Day 맥락을 보고 있어요."
        }
    }

    private func workspaceMissionFirstGeneratingBody() -> some View {
        HStack(spacing: 8) {
            ProgressView()
                .controlSize(.small)
            Text(viewModel.bipMissionProgress?.detail?.nonEmpty ?? "프로젝트와 Day 맥락을 보고 있어요.")
                .font(.system(size: 13, weight: .bold, design: .rounded))
                .foregroundStyle(.white.opacity(0.72))
                .lineLimit(2)
                .fixedSize(horizontal: false, vertical: true)
        }
        .accessibilityIdentifier("workspace.missionFirst.generating")
    }

    private func workspaceMissionFirstReadyBody(day: AgenticCurriculumDay) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            workspaceMissionFirstGuide()

            Text("버튼을 누르면 프로젝트와 Day \(day.day) 기준으로 바로 시작할 수 있는 미션을 추천합니다.")
                .font(.system(size: 12, weight: .semibold, design: .rounded))
                .foregroundStyle(.white.opacity(0.58))
                .fixedSize(horizontal: false, vertical: true)

            workspaceMissionPrimaryButton(
                title: "오늘 실행 생성",
                systemImage: "sparkles",
                accessibilityIdentifier: "workspace.generateBipMission"
            ) {
                viewModel.generateBipMission(compact: true, curriculumDay: curriculumPayload(for: day))
            }
            .disabled(viewModel.isBipCoachGenerating)
        }
    }

    private func workspaceMissionFirstErrorBody(_ message: String, day: AgenticCurriculumDay) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(message)
                .font(.system(size: 13, weight: .semibold, design: .rounded))
                .foregroundStyle(.white.opacity(0.70))
                .lineLimit(2)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("workspace.missionFirst.errorMessage")

            workspaceMissionPrimaryButton(
                title: viewModel.sidecarFailureMessage != nil ? "다시 연결" : "미션 다시 생성",
                systemImage: "arrow.clockwise",
                accessibilityIdentifier: "workspace.missionFirst.retry"
            ) {
                if viewModel.sidecarFailureMessage != nil {
                    viewModel.reconnectSidecar()
                } else {
                    viewModel.generateBipMission(compact: true, curriculumDay: curriculumPayload(for: day))
                }
            }
        }
    }

    private func workspaceMissionFirstChoices(_ choices: [BipCoachMission]) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            workspaceMissionFirstGuide()

            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text("추천된 오늘 실행")
                    .font(.system(size: 13, weight: .heavy, design: .rounded))
                    .foregroundStyle(.white.opacity(0.90))
                Spacer(minLength: 0)
                Text("\(min(choices.count, 3))개 중 하나")
                    .font(.system(size: 11, weight: .bold, design: .rounded))
                    .foregroundStyle(workspaceMissionFirstAccent.opacity(0.88))
                    .padding(.horizontal, 8)
                    .frame(height: 24)
                    .background(Capsule().fill(workspaceMissionFirstAccent.opacity(0.10)))
            }

            ForEach(Array(choices.prefix(3).enumerated()), id: \.element.id) { index, mission in
                bipCoachMissionChoiceCard(mission, index: index)
            }

            HStack(spacing: 8) {
                workspaceMissionSecondaryButton(
                    title: "다시 추천받기",
                    systemImage: "arrow.clockwise",
                    accessibilityIdentifier: "workspace.missionFirst.regenerate"
                ) {
                    viewModel.generateBipMission(curriculumDay: curriculumPayload(for: workspaceSelectedDay))
                }
                .disabled(viewModel.isBipCoachGenerating)

                workspaceMissionSecondaryButton(
                    title: "15분 미션으로 줄이기",
                    systemImage: "timer",
                    accessibilityIdentifier: "workspace.missionFirst.compact"
                ) {
                    viewModel.generateBipMission(compact: true, curriculumDay: curriculumPayload(for: workspaceSelectedDay))
                }
                .disabled(viewModel.isBipCoachGenerating)
            }
        }
        .accessibilityIdentifier("workspace.missionFirst.choices")
    }

    private func workspaceMissionFirstGuide() -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Agentic30가 하는 일")
                .font(.system(size: 12, weight: .heavy, design: .rounded))
                .foregroundStyle(.white.opacity(0.82))

            VStack(alignment: .leading, spacing: 7) {
                workspaceMissionFirstGuideRow(
                    index: 1,
                    title: "프로젝트 기준 확인",
                    detail: "선택한 워크스페이스와 Day 맥락을 먼저 봅니다."
                )
                workspaceMissionFirstGuideRow(
                    index: 2,
                    title: "오늘 실행 하나 선택",
                    detail: "추천 카드 중 하나만 고르면 실행 모드로 들어갑니다."
                )
                workspaceMissionFirstGuideRow(
                    index: 3,
                    title: "필요한 초안 요청",
                    detail: "선택한 미션 기준으로 바로 답변과 초안을 받을 수 있습니다."
                )
            }
        }
        .padding(12)
        .background(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(Color.black.opacity(0.13))
                .overlay(
                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .stroke(Color.white.opacity(0.08), lineWidth: 1)
                )
        )
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("workspace.missionFirst.guide")
    }

    private func workspaceMissionFirstGuideRow(index: Int, title: String, detail: String) -> some View {
        HStack(alignment: .top, spacing: 9) {
            Text("\(index)")
                .font(.system(size: 10, weight: .heavy, design: .rounded))
                .foregroundStyle(Color.black.opacity(0.72))
                .frame(width: 20, height: 20)
                .background(Circle().fill(workspaceMissionFirstAccent.opacity(0.90)))

            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.system(size: 12, weight: .bold, design: .rounded))
                    .foregroundStyle(.white.opacity(0.88))
                Text(detail)
                    .font(.system(size: 11, weight: .medium, design: .rounded))
                    .foregroundStyle(.white.opacity(0.52))
                    .fixedSize(horizontal: false, vertical: true)
            }

            Spacer(minLength: 0)
        }
        .accessibilityIdentifier("workspace.missionFirst.guideStep.\(index)")
    }

    private func workspaceMissionFirstSelectedMission(_ mission: BipCoachMission, coach: BipCoachState) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            if mission.status == "completed" {
                bipCompletionCard(mission: mission)
            }

            if let title = mission.title?.nonEmpty {
                Text(title)
                    .font(.system(size: 17, weight: .heavy, design: .rounded))
                    .foregroundStyle(.white.opacity(0.96))
                    .fixedSize(horizontal: false, vertical: true)
            }

            if mission.status != "completed" {
                Text("이제 초안 요청을 누르면 선택한 미션 기준으로 바로 답변을 시작합니다.")
                    .font(.system(size: 12, weight: .semibold, design: .rounded))
                    .foregroundStyle(.white.opacity(0.58))
                    .fixedSize(horizontal: false, vertical: true)
            }

            HStack(spacing: 8) {
                workspaceMissionPrimaryButton(
                    title: mission.status == "completed" ? "완료됨" : "완료 확인",
                    systemImage: "checkmark.circle.fill",
                    accessibilityIdentifier: "workspace.missionFirst.completeMission"
                ) {
                    submitBipCompletion()
                }
                .disabled(mission.status == "completed" || viewModel.isBipCoachCompleting)

                workspaceMissionSecondaryButton(
                    title: "초안 요청",
                    systemImage: "text.bubble.fill",
                    accessibilityIdentifier: "workspace.missionFirst.askForHelp"
                ) {
                    beginBipMission(mission)
                }

                Spacer(minLength: 0)

                Text("연속 \(coach.streak.current)일")
                    .font(.system(size: 11, weight: .bold, design: .rounded))
                    .foregroundStyle(workspaceMissionFirstAccent.opacity(0.88))
                    .padding(.horizontal, 8)
                    .frame(height: 26)
                    .background(Capsule().fill(workspaceMissionFirstAccent.opacity(0.10)))
            }

            if showsBipCompletionFields && mission.status != "completed" {
                bipCompletionFields()
            }
        }
        .accessibilityIdentifier("workspace.missionFirst.selectedMission")
    }

    private func workspaceMissionPrimaryButton(
        title: String,
        systemImage: String,
        accessibilityIdentifier: String,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            HStack(spacing: 7) {
                Image(systemName: systemImage)
                    .font(.system(size: 12, weight: .heavy))
                Text(title)
                    .font(.system(size: 13, weight: .heavy, design: .rounded))
            }
            .foregroundStyle(Color.black.opacity(0.78))
            .padding(.horizontal, 15)
            .frame(height: 36)
            .background(Capsule().fill(workspaceMissionFirstAccent.opacity(0.94)))
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier(accessibilityIdentifier)
        .accessibilityLabel(title)
    }

    private func workspaceMissionSecondaryButton(
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

    private func workspaceMissionFirstErrorMessage(session: ChatSession?) -> String? {
        if viewModel.sidecarFailureMessage != nil {
            return AgenticViewModel.userFacingMissionErrorMessage(viewModel.sidecarFailureMessage)
        }
        if let error = viewModel.visibleBipCoach?.lastError?.nonEmpty {
            return AgenticViewModel.userFacingMissionErrorMessage(error)
        }
        if let error = viewModel.lastError?.nonEmpty,
           AgenticViewModel.isRawNullDayError(error) {
            return AgenticViewModel.userFacingMissionErrorMessage(error)
        }
        return nil
    }

    @ViewBuilder
    private func workspaceMissionSupportThread(_ session: ChatSession) -> some View {
        let visibleMessages = workspaceVisibleMessages(for: session)
        let pendingPrompts = workspacePendingPrompts(for: session)
        let supportMessages = workspaceMissionSupportMessages(
            visibleMessages,
            session: session,
            pendingPrompts: pendingPrompts
        )
        let showsRunningBubble = session.status == .running && workspaceNeedsRunningBubble(messages: visibleMessages)

        if !supportMessages.isEmpty || session.pendingUserInput != nil || !pendingPrompts.isEmpty || showsRunningBubble {
            VStack(alignment: .leading, spacing: 10) {
                ForEach(supportMessages) { message in
                    workspaceChatBubble(message, session: session)
                }

                if let pendingPrompt = session.pendingUserInput {
                    workspaceStructuredPrompt(pendingPrompt)
                }

                ForEach(pendingPrompts) { pendingPrompt in
                    workspacePendingUserBubble(pendingPrompt.content)
                }

                if showsRunningBubble {
                    workspaceAssistantProgressBubble(session)
                }
            }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(workspacePaneBackground(cornerRadius: 18))
            .accessibilityIdentifier("workspace.supportThread")
        }
    }

    private func workspaceMissionSupportMessages(
        _ messages: [ChatMessage],
        session: ChatSession,
        pendingPrompts: [AgenticViewModel.PendingPromptPreview]
    ) -> [ChatMessage] {
        let hasUserTurn = messages.contains { $0.role == .user }
        let hasActiveSupport = session.pendingUserInput != nil
            || !pendingPrompts.isEmpty
            || session.status == .running
        return (hasUserTurn || hasActiveSupport) ? messages : []
    }

    private func shouldResumeDirectlyToQuestion(day: AgenticCurriculumDay, session: ChatSession) -> Bool {
        day.day >= 2 && session.pendingUserInput != nil
    }

    private func workspaceHeroCard(_ day: AgenticCurriculumDay, session: ChatSession) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .top, spacing: 14) {
                workspaceDayHeader(day)

                Spacer(minLength: 0)

                VStack(alignment: .trailing, spacing: 4) {
                    Text(session.status.rawValue.uppercased())
                        .font(.system(size: 10, weight: .bold, design: .rounded))
                        .foregroundStyle(.white.opacity(0.46))
                    Text(session.provider.title)
                        .font(.system(size: 12, weight: .bold, design: .rounded))
                        .foregroundStyle(.white.opacity(0.72))
                }
            }
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(workspacePaneBackground(cornerRadius: 20))
    }

    private func workspacePreparingHeroCard(_ day: AgenticCurriculumDay) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .top, spacing: 14) {
                workspaceDayHeader(day)

                Spacer(minLength: 0)

                VStack(alignment: .trailing, spacing: 4) {
                    Text("PREPARING")
                        .font(.system(size: 10, weight: .bold, design: .rounded))
                        .foregroundStyle(.white.opacity(0.46))
                    Text(viewModel.connectionLabel)
                        .font(.system(size: 12, weight: .bold, design: .rounded))
                        .foregroundStyle(.white.opacity(0.72))
                }
            }

            workspaceStartupStatusRail()
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(workspacePaneBackground(cornerRadius: 20))
    }

    private func workspaceStartupStatusRail() -> some View {
        let hasFailure = viewModel.sidecarFailureMessage != nil
        return HStack(spacing: 8) {
            workspaceStartupStatusStep(
                title: "Launching sidecar",
                systemImage: hasFailure ? "exclamationmark.triangle.fill" : "bolt.horizontal.circle.fill",
                isCurrent: !viewModel.isConnected && !hasFailure,
                isComplete: viewModel.isConnected,
                isFailed: hasFailure
            )
            workspaceStartupStatusStep(
                title: "Creating session",
                systemImage: "bubble.left.and.bubble.right.fill",
                isCurrent: viewModel.isConnected && viewModel.selectedSession == nil,
                isComplete: viewModel.selectedSession != nil,
                isFailed: false
            )
            workspaceStartupStatusStep(
                title: "Ready",
                systemImage: "checkmark.circle.fill",
                isCurrent: false,
                isComplete: viewModel.selectedSession != nil,
                isFailed: false
            )
        }
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("workspace.startupStatusRail")
    }

    private func workspaceStartupStatusStep(
        title: String,
        systemImage: String,
        isCurrent: Bool,
        isComplete: Bool,
        isFailed: Bool
    ) -> some View {
        HStack(spacing: 6) {
            Image(systemName: systemImage)
                .font(.system(size: 11, weight: .bold))
                .frame(width: 12, height: 12)
            Text(title)
                .font(.system(size: 11, weight: .bold, design: .rounded))
                .lineLimit(1)
        }
        .foregroundStyle(workspaceStartupStatusColor(isComplete: isComplete, isCurrent: isCurrent, isFailed: isFailed))
        .padding(.horizontal, 9)
        .frame(height: 26)
        .background(Capsule().fill(workspaceStartupStatusColor(isComplete: isComplete, isCurrent: isCurrent, isFailed: isFailed).opacity(0.12)))
        .overlay(
            Capsule()
                .stroke(workspaceStartupStatusColor(isComplete: isComplete, isCurrent: isCurrent, isFailed: isFailed).opacity(0.16), lineWidth: 1)
        )
    }

    private func workspaceStartupStatusColor(isComplete: Bool, isCurrent: Bool, isFailed: Bool) -> Color {
        if isFailed {
            return Color(red: 1.0, green: 0.45, blue: 0.38).opacity(0.86)
        }
        if isComplete {
            return Agentic30BrandColor.greenBright.opacity(0.84)
        }
        if isCurrent {
            return Color.white.opacity(0.70)
        }
        return Color.white.opacity(0.38)
    }

    private func workspaceDayHeader(_ day: AgenticCurriculumDay) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Text(day.phase.title)
                    .font(.system(size: 11, weight: .bold, design: .rounded))
                    .foregroundStyle(workspaceAccentColor(for: day.phase))
                    .padding(.horizontal, 9)
                    .padding(.vertical, 5)
                    .background(Capsule().fill(workspaceAccentColor(for: day.phase).opacity(0.13)))

                Text("Day \(day.day)")
                    .font(.system(size: 11, weight: .bold, design: .rounded))
                    .foregroundStyle(.white.opacity(0.52))
            }

            Text(day.title)
                .font(.system(size: 27, weight: .bold, design: .rounded))
                .foregroundStyle(.white.opacity(0.96))
                .fixedSize(horizontal: false, vertical: true)

            Text(day.summary)
                .font(.system(size: 14, weight: .semibold, design: .rounded))
                .foregroundStyle(.white.opacity(0.58))
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func workspacePanel<Content: View>(
        title: String,
        @ViewBuilder content: () -> Content
    ) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(title)
                .font(.system(size: 13, weight: .bold, design: .rounded))
                .foregroundStyle(.white.opacity(0.72))
            content()
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(workspacePaneBackground(cornerRadius: 18))
    }

    private func workspaceTaskRow(index: Int, task: String) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Text("\(index)")
                .font(.system(size: 11, weight: .bold, design: .rounded))
                .foregroundStyle(.white.opacity(0.62))
                .frame(width: 22, height: 22)
                .background(Circle().fill(Color.white.opacity(0.08)))

            Text(task)
                .font(.system(size: 13, weight: .medium, design: .rounded))
                .foregroundStyle(.white.opacity(0.78))
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private func workspaceCurriculumFocusPanel(day: AgenticCurriculumDay, session: ChatSession?) -> some View {
        workspacePanel(title: "오늘의 미션") {
            VStack(alignment: .leading, spacing: 14) {
                workspaceCurriculumDetailSwitcher()

                Group {
                    switch selectedCurriculumDetail {
                    case .tasks:
                        workspaceCurriculumTasks(day)
                    case .output:
                        workspaceCurriculumOutput(day)
                    case .diagnostics:
                        if let session {
                            workspaceEvidenceContent(day: day, session: session)
                        } else {
                            workspaceDiagnosticsPreparingContent()
                        }
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .accessibilityIdentifier("workspace.curriculumFocus")
    }

    private func workspaceCurriculumDetailSwitcher() -> some View {
        HStack(spacing: 6) {
            ForEach(WorkspaceCurriculumDetail.allCases) { detail in
                Button {
                    withAnimation(.spring(response: 0.22, dampingFraction: 0.88)) {
                        selectedCurriculumDetail = detail
                    }
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: detail.systemImage)
                            .font(.system(size: 11, weight: .bold))
                        Text(detail.title)
                            .font(.system(size: 11, weight: .bold, design: .rounded))
                    }
                    .foregroundStyle(.white.opacity(selectedCurriculumDetail == detail ? 0.92 : 0.48))
                    .padding(.horizontal, 10)
                    .frame(height: 30)
                    .background(
                        Capsule()
                            .fill(Color.white.opacity(selectedCurriculumDetail == detail ? 0.12 : 0.04))
                    )
                    .overlay(
                        Capsule()
                            .stroke(Color.white.opacity(selectedCurriculumDetail == detail ? 0.10 : 0.0), lineWidth: 1)
                    )
                    .contentShape(Capsule())
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("workspace.curriculumDetail.\(detail.rawValue)")
                .accessibilityLabel(detail.accessibilityLabel)
            }
        }
    }

    private func workspaceCurriculumTasks(_ day: AgenticCurriculumDay) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            ForEach(Array(day.tasks.enumerated()), id: \.offset) { index, task in
                workspaceTaskRow(index: index + 1, task: task)
            }
        }
    }

    private func workspaceCurriculumOutput(_ day: AgenticCurriculumDay) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("오늘 끝나면 남아야 하는 것")
                .font(.system(size: 11, weight: .bold, design: .rounded))
                .foregroundStyle(.white.opacity(0.44))
            Text(day.output)
                .font(.system(size: 15, weight: .bold, design: .rounded))
                .foregroundStyle(.white.opacity(0.86))
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private func workspaceDiagnosticsPreparingContent() -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("세션 준비 후 진단이 표시됩니다.")
                .font(.system(size: 13, weight: .semibold, design: .rounded))
                .foregroundStyle(.white.opacity(0.72))
            Text("Evidence, Workspace, Latest Assistant 정보를 한 곳에서 확인합니다.")
                .font(.system(size: 12, weight: .medium, design: .rounded))
                .foregroundStyle(.white.opacity(0.48))
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    @ViewBuilder
    private func workspaceBipCoachModule() -> some View {
        if viewModel.sidecarFailureMessage != nil {
            workspaceBipCoachInlineMarker()
            bipCoachSidecarFailurePanel()
        } else if let coach = viewModel.visibleBipCoach {
            let readiness = viewModel.bipReadiness ?? BipReadinessState.loading
            if viewModel.bipMissionProgress != nil || coach.currentMission != nil || !coach.pendingMissionChoices.isEmpty {
                workspaceBipCoachInlineMarker()
                bipCoachPanel()
            } else if fullCoachReady(coach: coach, readiness: readiness) {
                workspaceBipCoachInlineMarker()
                bipCoachPanel()
            } else if showsInlineBipReadinessSetup {
                workspaceBipCoachInlineMarker()
                bipReadinessCard(readiness)
            } else {
                workspaceBipReadinessCompactCard()
            }
        } else {
            workspaceBipCoachInlineMarker()
            VStack(alignment: .leading, spacing: 10) {
                Text("오늘 미션은 바로 만들 수 있어요.")
                    .font(.system(size: 13, weight: .semibold, design: .rounded))
                    .foregroundStyle(.white.opacity(0.78))
                Text("프로젝트 기준과 기록 장소를 연결하면 추천 정확도와 근거 품질이 올라갑니다.")
                    .font(.system(size: 12, weight: .medium, design: .rounded))
                    .foregroundStyle(.white.opacity(0.50))
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private func workspaceBipCoachInlineMarker() -> some View {
        Text("public execution coach inline module")
            .font(.system(size: 1))
            .foregroundStyle(.clear)
            .frame(width: 1, height: 1)
            .accessibilityIdentifier("workspace.bipCoach.inlineModule")
            .accessibilityLabel("공개 실행 코치 inline module")
    }

    @ViewBuilder
    private func workspacePreparingBipCoachContent() -> some View {
        if viewModel.sidecarFailureMessage != nil {
            bipCoachSidecarFailurePanel()
        } else {
            VStack(alignment: .leading, spacing: 12) {
                Text("오늘 실행을 미리 준비할 수 있어요.")
                    .font(.system(size: 13, weight: .semibold, design: .rounded))
                    .foregroundStyle(.white.opacity(0.78))
                Text("첫 메시지를 아래에 적어두거나, Day 1 기준으로 미션 생성을 예약하세요. 세션이 연결되면 자동으로 이어집니다.")
                    .font(.system(size: 12, weight: .medium, design: .rounded))
                    .foregroundStyle(.white.opacity(0.50))
                    .fixedSize(horizontal: false, vertical: true)

                Button {
                    viewModel.generateBipMission(compact: true, curriculumDay: curriculumPayload(for: workspaceSelectedDay))
                } label: {
                    HStack(spacing: 7) {
                        Image(systemName: "sparkles")
                            .font(.system(size: 12, weight: .bold))
                        Text("오늘 실행 생성 예약")
                            .font(.system(size: 12, weight: .bold, design: .rounded))
                    }
                    .foregroundStyle(.white.opacity(0.88))
                    .padding(.horizontal, 12)
                    .frame(height: 30)
                    .background(Capsule().fill(Color.white.opacity(0.10)))
                    .overlay(Capsule().stroke(Color.white.opacity(0.10), lineWidth: 1))
                }
                .buttonStyle(.plain)
                .disabled(viewModel.startupQueuedAction != nil)
                .accessibilityIdentifier("workspace.queueBipMission")
            }
        }
    }

    private func workspacePreparingChatAssistant() -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .center, spacing: 8) {
                Text("Chat Assistant")
                    .font(.system(size: 11, weight: .bold, design: .rounded))
                    .foregroundStyle(.white.opacity(0.44))
                    .textCase(.uppercase)

                Spacer(minLength: 0)
            }

            Text("Chat Assistant")
                .font(.system(size: 1))
                .foregroundStyle(.clear)
                .frame(width: 1, height: 1)
                .accessibilityIdentifier("workspace.chatAssistant")
                .accessibilityLabel("Chat Assistant")

            HStack(alignment: .bottom, spacing: 10) {
                VStack(alignment: .leading, spacing: 5) {
                    Text("Assistant")
                        .font(.system(size: 10, weight: .bold, design: .rounded))
                        .foregroundStyle(.white.opacity(0.42))

                    VStack(alignment: .leading, spacing: 10) {
                        workspaceBipMissionCardMarker()

                        Text("오늘 실행")
                            .font(.system(size: 12, weight: .bold, design: .rounded))
                            .foregroundStyle(.white.opacity(0.78))
                            .textCase(.uppercase)

                        workspaceBipCoachInlineMarker()
                        workspacePreparingBipCoachContent()
                    }
                    .padding(12)
                    .background(workspaceBubbleBackground(isUser: false, isError: viewModel.sidecarFailureMessage != nil))
                    .accessibilityElement(children: .contain)
                }
                .frame(maxWidth: 860, alignment: .leading)

                Spacer(minLength: 90)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(workspacePaneBackground(cornerRadius: 18))
        .accessibilityIdentifier("workspace.chatThread")
    }

    @ViewBuilder
    private func workspaceStartupQueueStatus() -> some View {
        if let action = viewModel.startupQueuedAction {
            HStack(alignment: .center, spacing: 10) {
                Image(systemName: workspaceStartupQueueIcon(for: action))
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(workspaceStartupQueueTint(for: action))
                    .frame(width: 18)

                VStack(alignment: .leading, spacing: 2) {
                    Text(workspaceStartupQueueTitle(for: action))
                        .font(.system(size: 11, weight: .bold, design: .rounded))
                        .foregroundStyle(.white.opacity(0.82))
                    Text(action.summary)
                        .font(.system(size: 10, weight: .semibold, design: .rounded))
                        .foregroundStyle(.white.opacity(0.48))
                        .lineLimit(1)
                }

                Spacer(minLength: 0)

                if case .failed = action.state {
                    Button("다시 시도") {
                        viewModel.retryStartupQueuedAction()
                    }
                    .buttonStyle(.plain)
                    .font(.system(size: 11, weight: .bold, design: .rounded))
                    .foregroundStyle(Agentic30BrandColor.greenBright.opacity(0.92))
                    .accessibilityIdentifier("workspace.startupQueue.retry")
                }

                Button("취소") {
                    viewModel.clearStartupQueuedAction()
                }
                .buttonStyle(.plain)
                .font(.system(size: 11, weight: .bold, design: .rounded))
                .foregroundStyle(.white.opacity(0.48))
                .accessibilityIdentifier("workspace.startupQueue.cancel")
            }
            .padding(.horizontal, 12)
            .frame(height: 42)
            .background(
                RoundedRectangle(cornerRadius: 13, style: .continuous)
                    .fill(Color.black.opacity(0.18))
                    .overlay(
                        RoundedRectangle(cornerRadius: 13, style: .continuous)
                            .stroke(workspaceStartupQueueTint(for: action).opacity(0.16), lineWidth: 1)
                    )
            )
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("workspace.startupQueue")
        }
    }

    private func workspaceStartupQueueTitle(for action: StartupQueuedAction) -> String {
        switch action.state {
        case .waiting:
            return "\(action.title) · 세션 연결 후 자동 실행"
        case .sending:
            return "\(action.title) · 보내는 중"
        case .failed:
            return "\(action.title) · 다시 시도 필요"
        }
    }

    private func workspaceStartupQueueIcon(for action: StartupQueuedAction) -> String {
        switch action.state {
        case .failed:
            return "exclamationmark.triangle.fill"
        case .sending:
            return "paperplane.circle.fill"
        case .waiting:
            return "clock.fill"
        }
    }

    private func workspaceStartupQueueTint(for action: StartupQueuedAction) -> Color {
        switch action.state {
        case .failed:
            return Color(red: 1.0, green: 0.45, blue: 0.38)
        case .sending:
            return Color(red: 0.54, green: 0.78, blue: 0.96)
        case .waiting:
            return Agentic30BrandColor.greenBright
        }
    }

    @ViewBuilder
    private func workspaceBipReadinessCompactCard() -> some View {
        if let coach = viewModel.visibleBipCoach {
            let readiness = viewModel.bipReadiness ?? BipReadinessState.loading
            if !fullCoachReady(coach: coach, readiness: readiness) {
                let visibleIds = bipReadinessPrimaryRowIds
                let completedIds = visibleIds.filter { readiness.row($0).status == .done }
                let currentId = visibleIds.first { readiness.row($0).status != .done }

                VStack(alignment: .leading, spacing: 12) {
                    workspaceBipCoachInlineMarker()

                    HStack(alignment: .firstTextBaseline, spacing: 10) {
                        Text(basicMissionAvailable(coach: coach) ? "오늘 미션은 바로 만들 수 있어요." : "세션이 연결되면 오늘 미션을 만들 수 있어요.")
                            .font(.system(size: 13, weight: .semibold, design: .rounded))
                            .foregroundStyle(.white.opacity(0.78))
                            .fixedSize(horizontal: false, vertical: true)

                        Spacer(minLength: 0)

                        Text("\(completedIds.count)/\(visibleIds.count) 완료")
                            .font(.system(size: 11, weight: .bold, design: .rounded))
                            .foregroundStyle(.white.opacity(0.74))
                            .padding(.horizontal, 9)
                            .padding(.vertical, 5)
                            .background(Capsule().fill(Color.white.opacity(0.08)))
                    }

                    if let currentId {
                        bipReadinessCurrentStepView(row: readiness.row(currentId))
                    } else {
                        bipReadinessCompleteView()
                    }

                    HStack(spacing: 8) {
                        if !completedIds.isEmpty {
                            bipReadinessCompletedSummary(completedIds)
                        }

                        Spacer(minLength: 0)

                        Button {
                            withAnimation(.spring(response: 0.24, dampingFraction: 0.88)) {
                                showsInlineBipReadinessSetup = true
                                showsBipReadinessPreview = true
                                showsBipReadinessAdvanced = true
                            }
                        } label: {
                            HStack(spacing: 5) {
                                Text("추천 정확도 높이기")
                                Image(systemName: "arrow.right")
                                    .font(.system(size: 9, weight: .bold))
                            }
                            .font(.system(size: 10, weight: .bold, design: .rounded))
                            .foregroundStyle(.white.opacity(0.56))
                        }
                        .buttonStyle(.plain)
                        .accessibilityIdentifier("workspace.bipReadinessOpenFullSetup")
                    }

                    Text("부족한 기준은 오늘 실행을 막지 않고, 다음 추천을 더 정확하게 만드는 보조 단계입니다.")
                        .font(.system(size: 11, weight: .medium, design: .rounded))
                        .foregroundStyle(.white.opacity(0.46))
                        .fixedSize(horizontal: false, vertical: true)
                }
                .accessibilityIdentifier("workspace.bipReadinessCompact")
            }
        }
    }

    private func workspaceEvidenceDisclosure(day: AgenticCurriculumDay, session: ChatSession) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Button {
                withAnimation(.spring(response: 0.24, dampingFraction: 0.88)) {
                    showsWorkspaceEvidenceDetails.toggle()
                }
            } label: {
                HStack(spacing: 7) {
                    Image(systemName: showsWorkspaceEvidenceDetails ? "chevron.down" : "chevron.right")
                        .font(.system(size: 9, weight: .bold))
                    Text("세부 진단 보기")
                        .font(.system(size: 11, weight: .bold, design: .rounded))
                    Text("Evidence · Workspace · Latest Assistant")
                        .font(.system(size: 10, weight: .medium, design: .rounded))
                        .foregroundStyle(.white.opacity(0.34))
                    Spacer(minLength: 0)
                }
                .foregroundStyle(.white.opacity(0.48))
                .padding(.horizontal, 12)
                .frame(height: 34)
                .background(workspacePaneBackground(cornerRadius: 12))
                .contentShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("workspace.evidenceDisclosure")
            .accessibilityLabel(showsWorkspaceEvidenceDetails ? "세부 진단 접기" : "세부 진단 보기")

            if showsWorkspaceEvidenceDetails {
                workspaceInlineEvidence(day: day, session: session)
                    .transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
    }

    private func workspaceInlineEvidence(day: AgenticCurriculumDay, session: ChatSession) -> some View {
        workspacePanel(title: "Evidence") {
            workspaceEvidenceContent(day: day, session: session)
        }
    }

    private func workspaceEvidenceContent(day: AgenticCurriculumDay, session: ChatSession) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            workspaceEvidenceGroup(title: "Curriculum") {
                workspaceEvidenceLine(day.summary)
                workspaceEvidenceLine(day.output)
            }

            workspaceBipEvidenceGroup()

            if let latest = workspaceLatestAssistantEvidence(in: session) {
                workspaceEvidenceGroup(title: "Latest Assistant") {
                    workspaceEvidenceLine(latest)
                }
            }

            workspaceEvidenceGroup(title: "Workspace") {
                workspaceEvidenceLine(viewModel.workspaceRoot.nonEmpty ?? "프로젝트 폴더 확인 전")
            }
        }
    }

    @ViewBuilder
    private func workspaceBipEvidenceGroup() -> some View {
        if let coach = viewModel.visibleBipCoach {
            workspaceEvidenceGroup(title: "공개 실행 코치") {
                if let mission = coach.currentMission {
                    workspaceEvidenceLine(mission.title?.nonEmpty ?? "오늘 실행")
                    ForEach(Array(evidenceLines(for: mission, coach: coach).prefix(5).enumerated()), id: \.offset) { _, line in
                        workspaceEvidenceLine(line)
                    }
                } else if let evidence = coach.evidence {
                    workspaceEvidenceLine(evidenceReceiptSummary(evidence))
                } else {
                    workspaceEvidenceLine("공개 실행 코치가 아직 오늘 근거를 읽지 않았습니다.")
                }
            }
        } else {
            workspaceEvidenceGroup(title: "공개 실행 코치") {
                workspaceEvidenceLine("공개 실행 설정과 오늘 근거가 준비되면 여기에 연결됩니다.")
            }
        }
    }

    private func workspaceEvidenceGroup<Content: View>(
        title: String,
        @ViewBuilder content: () -> Content
    ) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(.system(size: 11, weight: .bold, design: .rounded))
                .foregroundStyle(.white.opacity(0.46))
                .textCase(.uppercase)
            content()
        }
        .padding(11)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(workspacePaneBackground(cornerRadius: 14))
    }

    private func workspaceEvidenceLine(_ text: String) -> some View {
        Text(text)
            .font(.system(size: 11, weight: .medium, design: .rounded))
            .foregroundStyle(.white.opacity(0.68))
            .lineLimit(5)
            .fixedSize(horizontal: false, vertical: true)
    }

    private func workspaceAccentColor(for phase: AgenticCurriculumPhase) -> Color {
        switch phase {
        case .foundation:
            return Color(red: 0.64, green: 0.84, blue: 1.0)
        case .build:
            return Color(red: 0.66, green: 0.90, blue: 0.70)
        case .launch:
            return Color(red: 1.0, green: 0.78, blue: 0.48)
        case .grow:
            return Color(red: 0.93, green: 0.72, blue: 1.0)
        }
    }

    @ViewBuilder
    private var workspaceSidebarBackground: some View {
        if isWorkspaceWindow {
            Color(red: 0.145, green: 0.158, blue: 0.174).opacity(reduceTransparency ? 1.0 : 0.96)
        } else if reduceTransparency {
            Color(red: 0.085, green: 0.088, blue: 0.096).opacity(0.98)
        } else {
            LinearGradient(
                colors: [
                    Color.white.opacity(0.105),
                    Color.black.opacity(0.10)
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        }
    }

    @ViewBuilder
    private var workspaceTopBarBackground: some View {
        if isWorkspaceWindow {
            Color(red: 0.120, green: 0.133, blue: 0.148).opacity(0.98)
        } else {
            Color.clear
        }
    }

    @ViewBuilder
    private var workspaceShellBackground: some View {
        if isWorkspaceWindow {
            Color(red: 0.105, green: 0.123, blue: 0.134).opacity(0.98)
        } else if reduceTransparency {
            let shape = RoundedRectangle(cornerRadius: 28, style: .continuous)
            shape.fill(Color(red: 0.10, green: 0.105, blue: 0.115).opacity(0.98))
        } else {
            let shape = RoundedRectangle(cornerRadius: 28, style: .continuous)
            shape.fill(.regularMaterial)
        }
    }

    @ViewBuilder
    private func workspacePaneBackground(cornerRadius: CGFloat) -> some View {
        let shape = RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
        if reduceTransparency {
            shape
                .fill(Color.white.opacity(0.07))
                .overlay(shape.stroke(Color.white.opacity(0.08), lineWidth: 1))
        } else {
            shape
                .fill(.thinMaterial)
                .overlay(shape.stroke(Color.white.opacity(0.10), lineWidth: 1))
        }
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
                                        workspaceMissionSecondaryButton(
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

    // Dead code — kept for one PR, delete in follow-up
    private func unconfiguredBipCoachPanel() -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("오늘 공개 실행을 시작하려면 Google Doc 업무일지와 Google Sheet 게시글 일지를 연결하세요.")
                .font(.system(size: 13, weight: .semibold, design: .rounded))
                .foregroundStyle(.white.opacity(0.86))
                .fixedSize(horizontal: false, vertical: true)
            Text("Settings > Build In Public에서 Docs URL, Sheets URL, Threads handle을 저장하면 이 카드가 매일 미션을 만듭니다.")
                .font(.system(size: 12, weight: .medium, design: .rounded))
                .foregroundStyle(.white.opacity(0.52))
                .fixedSize(horizontal: false, vertical: true)
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
                    withAnimation(.spring(response: 0.24, dampingFraction: 0.88)) {
                        selectedWorkspaceSection = .settings
                    }
                }

                bipCoachButton("진단 보기") {
                    withAnimation(.spring(response: 0.24, dampingFraction: 0.88)) {
                        selectedWorkspaceSection = .curriculum
                        selectedCurriculumDetail = .diagnostics
                        showsWorkspaceEvidenceDetails = true
                    }
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
                    viewModel.generateBipMission(curriculumDay: curriculumPayload(for: workspaceSelectedDay))
                }
                .disabled(viewModel.isBipCoachRefreshing || viewModel.isBipCoachGenerating)

                bipCoachButton("15분 미션으로 줄이기") {
                    viewModel.generateBipMission(compact: true, curriculumDay: curriculumPayload(for: workspaceSelectedDay))
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
                        .accessibilityIdentifier("workspace.missionFirst.recommendationReason")

                    if let missionText = mission.mission?.nonEmpty {
                        Text(missionText)
                            .font(.system(size: 11, weight: .medium, design: .rounded))
                            .foregroundStyle(.white.opacity(0.50))
                            .lineLimit(1)
                    }

                    workspaceMissionChoiceMetaRow(
                        text: missionEvidencePreview(mission),
                        systemImage: "quote.bubble.fill",
                        identifier: "workspace.missionFirst.choiceEvidence"
                    )

                    workspaceMissionChoiceMetaRow(
                        text: "결과물: \(missionOutcomePreview(mission))",
                        systemImage: "checkmark.circle.fill",
                        identifier: "workspace.missionFirst.choiceOutcome"
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
                .accessibilityIdentifier("workspace.missionFirst.choicePrimaryAction")
            }
            .padding(12)
            .background(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .fill(Color.white.opacity(index == 0 ? 0.075 : 0.055))
                    .overlay(
                        RoundedRectangle(cornerRadius: 12, style: .continuous)
                            .stroke(index == 0 ? workspaceMissionFirstAccent.opacity(0.18) : Color.white.opacity(0.09), lineWidth: 1)
                    )
            )
            .contentShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("workspace.bipCoach.missionChoice.\(index + 1)")
        .accessibilityLabel("\(mission.title?.nonEmpty ?? "오늘 실행 \(index + 1)") 이 미션으로 시작")
    }

    private func workspaceMissionChoiceMetaRow(text: String, systemImage: String, identifier: String) -> some View {
        HStack(alignment: .top, spacing: 6) {
            Image(systemName: systemImage)
                .font(.system(size: 9, weight: .bold))
                .foregroundStyle(workspaceMissionFirstAccent.opacity(0.72))
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
                    viewModel.generateBipMission(curriculumDay: curriculumPayload(for: workspaceSelectedDay))
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
                        viewModel.generateBipMission(curriculumDay: curriculumPayload(for: workspaceSelectedDay))
                    }
                    Button("15분 관찰글로 줄이기") {
                        viewModel.generateBipMission(compact: true, curriculumDay: curriculumPayload(for: workspaceSelectedDay))
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

private enum AgenticCurriculumPhase: String, CaseIterable, Identifiable, Hashable {
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

private struct AgenticCurriculumDay: Identifiable, Hashable {
    let day: Int
    let phase: AgenticCurriculumPhase
    let title: String
    let shortTitle: String
    let summary: String
    let tasks: [String]
    let output: String

    var id: Int { day }

    static let days: [AgenticCurriculumDay] = [
        .init(day: 1, phase: .foundation, title: "고객의 어제 행동에서 통증 1개를 압축한다", shortTitle: "Pain", summary: "4종 인풋에서 가장 압축된 고객 통증 1개를 뽑고 SPEC.md v0의 기준으로 둡니다.", tasks: ["고객 발화 또는 문제 메모에서 과거 행동 1개 고르기", "status quo와 비용/시간/실수 단위로 적기", "SPEC.md v0에 통증 1개와 근거 1개 기록"], output: "SPEC.md v0, pain quote, status quo"),
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

/// Foundation phase Sub-AC 2: 사이드바 누적 기록을 일자별로 묶어 노출하기 위한
/// 뷰 모델. 그룹은 `label`(예: "오늘", "어제", "5월 1일 (목)")로 식별되며 동일
/// 라벨에 묶인 세션들은 `AgenticViewModel.sessions`의 정렬 순서를 그대로 보존한다.
private struct WorkspaceSidebarHistoryGroup: Identifiable {
    let label: String
    let sessions: [ChatSession]

    var id: String { label }
}

private struct BipReadinessGroup: Identifiable, Hashable {
    let title: String
    let ids: [BipReadinessRowId]

    var id: String { title }
}

private enum DisplayMode {
    case compact
    case expanded
}

private enum WorkspaceSection {
    case curriculum
    case settings

    var title: String {
        switch self {
        case .curriculum:
            return "30일 커리큘럼"
        case .settings:
            return "설정"
        }
    }
}

private struct WorkspaceTourReturnState {
    let section: WorkspaceSection
    let settingsSection: SettingsSection
    let sidebarPresented: Bool
    let helpPresented: Bool
    let sidebarSettingsMenuPresented: Bool
}

private enum WorkspaceCurriculumDetail: String, CaseIterable, Identifiable {
    case tasks
    case output
    case diagnostics

    var id: String { rawValue }

    var title: String {
        switch self {
        case .tasks:
            return "작업"
        case .output:
            return "산출물"
        case .diagnostics:
            return "진단"
        }
    }

    var systemImage: String {
        switch self {
        case .tasks:
            return "checklist"
        case .output:
            return "target"
        case .diagnostics:
            return "waveform.path.ecg"
        }
    }

    var accessibilityLabel: String {
        switch self {
        case .tasks:
            return "오늘의 작업 보기"
        case .output:
            return "오늘 산출물 보기"
        case .diagnostics:
            return "세부 진단 보기"
        }
    }
}

private enum WorkspaceFooterItem {
    case projectFolder
    case settings
    case help

    var helpText: String {
        switch self {
        case .projectFolder:
            return "프로젝트 디렉토리 설정"
        case .settings:
            return "설정"
        case .help:
            return "도움말"
        }
    }

    var accessibilityIdentifier: String {
        switch self {
        case .projectFolder:
            return "workspace.projectFolderButton"
        case .settings:
            return "workspace.settingsButton"
        case .help:
            return "workspace.helpButton"
        }
    }
}

/// Foundation phase Sub-AC 3: 사이드바 하단 통합 설정 메뉴 항목 정의.
///
/// 각 항목은 (1) popover 내부에서 hover 강조용 키, (2) 시스템 아이콘,
/// (3) 표시 라벨, (4) accessibilityIdentifier를 제공한다. 항목별 라우팅
/// 규칙(예: 알림 → buildInPublic, 프로필 → account)은 호출 측에서 결정한다.
private enum SidebarSettingsMenuItem: Hashable {
    case profile
    case notifications
    case account
    case logout
    case fullSettings

    var systemImage: String {
        switch self {
        case .profile:
            return "person.crop.circle"
        case .notifications:
            return "bell.fill"
        case .account:
            return "key.fill"
        case .logout:
            return "rectangle.portrait.and.arrow.right"
        case .fullSettings:
            return "gearshape.2.fill"
        }
    }

    var title: String {
        switch self {
        case .profile:
            return "프로필"
        case .notifications:
            return "알림"
        case .account:
            return "계정"
        case .logout:
            return "로그아웃"
        case .fullSettings:
            return "설정 전체 보기"
        }
    }

    var accessibilityIdentifier: String {
        switch self {
        case .profile:
            return "workspace.sidebarSettingsMenu.profile"
        case .notifications:
            return "workspace.sidebarSettingsMenu.notifications"
        case .account:
            return "workspace.sidebarSettingsMenu.account"
        case .logout:
            return "workspace.sidebarSettingsMenu.logout"
        case .fullSettings:
            return "workspace.sidebarSettingsMenu.fullSettings"
        }
    }

    /// 항목이 destructive(로그아웃)인지 표시. 색상 강조에 사용된다.
    var isDestructive: Bool {
        self == .logout
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

private extension View {
    @ViewBuilder
    func workspaceSidebarLockedTooltip(_ tooltip: String?) -> some View {
        if let tooltip {
            self.help(tooltip)
        } else {
            self
        }
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
