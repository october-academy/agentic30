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
    @ObservedObject var viewModel: AgenticViewModel
    private let surfaceOverride: AgenticSurface?
    private let openWorkspaceAction: (() -> Void)?
    private let closeWorkspaceAction: (() -> Void)?
    private let zoomWorkspaceAction: (() -> Void)?

    @State private var currentPromptID: String?
    @State private var promptDrafts: [String: StructuredAnswerDraft] = [:]
    @State private var showsBipMissionEvidence = false
    @State private var showsBipCompletionFields = false
    @State private var bipThreadsURL = ""
    @State private var bipSheetRowNote = ""
    @State private var showsBipReadinessPreview = false
    @State private var showsBipReadinessAdvanced = false
    @State private var showsInlineBipReadinessSetup = false
    @State private var showsWorkspaceEvidenceDetails = false
    @State private var selectedWorkspaceDay: Int? = 1
    @State private var selectedWorkspaceSection: WorkspaceSection = .curriculum
    @State private var selectedCurriculumDetail: WorkspaceCurriculumDetail = .tasks
    @State private var selectedSettingsSection: SettingsSection = .account
    @State private var handledWorkspaceSettingsOpenRequest = 0
    @State private var handledBipNotificationOpenRequestID: UUID?
    @State private var pendingBipNotificationScrollRequestID: UUID?
    @State private var bipNotificationHintIntent: BipNotificationIntent?
    @State private var isWorkspaceSidebarPresented = true
    @State private var isWorkspaceSidebarToggleHovered = false
    @State private var isWorkspaceMissionButtonHovered = false
    @State private var hoveredWorkspaceNavTitle: String?
    @State private var hoveredWorkspaceDay: Int?
    @State private var hoveredWorkspaceFooterItem: WorkspaceFooterItem?

    @MainActor
    init(
        viewModel: AgenticViewModel,
        surfaceOverride: AgenticSurface? = nil,
        openWorkspaceAction: (() -> Void)? = nil,
        closeWorkspaceAction: (() -> Void)? = nil,
        zoomWorkspaceAction: (() -> Void)? = nil
    ) {
        _viewModel = ObservedObject(wrappedValue: viewModel)
        self.surfaceOverride = surfaceOverride
        self.openWorkspaceAction = openWorkspaceAction
        self.closeWorkspaceAction = closeWorkspaceAction
        self.zoomWorkspaceAction = zoomWorkspaceAction
    }

    @ViewBuilder
    var body: some View {
        let content = rootContent
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .padding(isWorkspaceWindow ? 0 : 22)
            .background {
                if isWorkspaceWindow {
                    WorkspaceWindowChrome()
                } else {
                    WindowChrome()
                }
            }
            .onAppear {
                viewModel.start()
                handleWorkspaceSettingsOpenRequest()
                handleBipNotificationOpenRequest()
            }
            .onDisappear {
                if !isWorkspaceWindow {
                    viewModel.stop()
                }
            }
            .onChange(of: viewModel.pendingStructuredPrompt?.requestId) { _, requestID in
                syncPromptDrafts(requestID: requestID)
            }
            .onChange(of: viewModel.workspaceSettingsOpenRequest) { _, _ in
                handleWorkspaceSettingsOpenRequest()
            }
            .onChange(of: viewModel.bipNotificationOpenRequest?.id) { _, _ in
                handleBipNotificationOpenRequest()
            }
            .onChange(of: viewModel.visibleBipCoach?.currentMission?.id) { _, _ in
                applyBipNotificationIntentToCurrentState()
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
                MacOnboardingView(viewModel: viewModel)
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

    @ViewBuilder
    private func workspacePreparingSurface() -> some View {
        let day = workspaceSelectedDay

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
                .accessibilityIdentifier("workspace.surface")
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
        AgenticCurriculumDay.days.first(where: { $0.day == (selectedWorkspaceDay ?? 1) })
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

    @ViewBuilder
    private func agenticWorkspace(for session: ChatSession) -> some View {
        let day = workspaceSelectedDay

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
                .accessibilityIdentifier("workspace.surface")
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

                if selectedWorkspaceSection != .settings {
                    Button {
                        withAnimation(.spring(response: 0.24, dampingFraction: 0.88)) {
                            showsInlineBipReadinessSetup = true
                            showsBipReadinessPreview = true
                            showsBipReadinessAdvanced = true
                        }
                        viewModel.generateBipMission(compact: true, curriculumDay: curriculumPayload(for: day))
                    } label: {
                        HStack(spacing: 7) {
                            if viewModel.isBipCoachGenerating {
                                ProgressView()
                                    .controlSize(.mini)
                                    .frame(width: 12, height: 12)
                                Text("생성 중...")
                            } else {
                                Image(systemName: "sparkles")
                                    .font(.system(size: 12, weight: .bold))
                                Text("미션 생성")
                            }
                        }
                        .font(.system(size: 12, weight: .bold, design: .rounded))
                        .frame(minWidth: 78)
                        .foregroundStyle(.white.opacity(workspaceMissionButtonForegroundOpacity))
                        .padding(.horizontal, 13)
                        .frame(height: 32)
                        .background(Capsule().fill(Color.white.opacity(workspaceMissionButtonFillOpacity)))
                        .overlay(
                            Capsule()
                                .stroke(Color.white.opacity(isWorkspaceMissionButtonHovered ? 0.13 : 0.0), lineWidth: 1)
                        )
                        .contentShape(Capsule())
                    }
                    .buttonStyle(.plain)
                    .disabled(viewModel.isBipCoachGenerating)
                    .onHover { hovering in
                        withAnimation(.easeOut(duration: 0.12)) {
                            isWorkspaceMissionButtonHovered = hovering
                        }
                    }
                    .accessibilityIdentifier("workspace.generateBipMission")
                    .accessibilityLabel("BIP 미션 생성")
                }
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

                if selectedWorkspaceSection != .settings {
                    workspacePreparingStatusPill()
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)

            workspaceSidebarToggleTooltip()
                .padding(.top, 52)
                .zIndex(100)
        }
    }

    private func workspaceToolbarTitle(_ day: AgenticCurriculumDay) -> String {
        selectedWorkspaceSection == .settings
            ? "설정"
            : "\(selectedWorkspaceSection.title) / Day \(day.day)"
    }

    private func workspaceToolbarSubtitle(day: AgenticCurriculumDay, session: ChatSession) -> String {
        selectedWorkspaceSection == .settings
            ? "Workspace 환경 설정"
            : "Day \(day.day) · \(day.phase.title) · \(session.provider.title)"
    }

    private func workspacePreparingStatusPill() -> some View {
        let hasFailure = viewModel.sidecarFailureMessage != nil

        return HStack(spacing: 7) {
            if hasFailure {
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.system(size: 11, weight: .semibold))
            } else {
                ProgressView()
                    .controlSize(.mini)
                    .frame(width: 14, height: 14)
            }
            Text(hasFailure ? "연결 필요" : "세션 준비 중")
                .font(.system(size: 12, weight: .bold, design: .rounded))
        }
        .foregroundStyle(.white.opacity(hasFailure ? 0.72 : 0.52))
        .padding(.horizontal, 13)
        .frame(height: 32)
        .background(Capsule().fill(Color.white.opacity(hasFailure ? 0.11 : 0.08)))
        .overlay(
            Capsule()
                .stroke(Color.white.opacity(hasFailure ? 0.10 : 0.0), lineWidth: 1)
        )
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

                Text("단계")
                    .font(.system(size: 10, weight: .bold, design: .rounded))
                    .foregroundStyle(.white.opacity(0.36))
                    .textCase(.uppercase)
                    .padding(.horizontal, 18)
                    .padding(.bottom, 7)

                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 11) {
                        ForEach(AgenticCurriculumPhase.allCases) { phase in
                            workspaceSidebarPhaseSection(phase)
                        }
                    }
                    .padding(.horizontal, 10)
                    .padding(.bottom, 12)
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

    private func workspaceSidebarPhaseSection(_ phase: AgenticCurriculumPhase) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack(spacing: 6) {
                Circle()
                    .fill(workspaceAccentColor(for: phase).opacity(0.72))
                    .frame(width: 6, height: 6)

                Text(phase.title)
                    .font(.system(size: 10, weight: .bold, design: .rounded))
                    .foregroundStyle(.white.opacity(0.42))
                    .textCase(.uppercase)

                Spacer(minLength: 0)
            }
            .padding(.horizontal, 8)

            ForEach(AgenticCurriculumDay.days.filter { $0.phase == phase }) { day in
                workspaceSidebarRow(day)
            }
        }
    }

    private func workspaceSidebarRow(_ day: AgenticCurriculumDay) -> some View {
        let selected = selectedWorkspaceDay == day.day
        let isHovered = hoveredWorkspaceDay == day.day

        return Button {
            withAnimation(.spring(response: 0.24, dampingFraction: 0.88)) {
                selectedWorkspaceDay = day.day
                selectedWorkspaceSection = .curriculum
            }
        } label: {
            HStack(spacing: 0) {
                VStack(alignment: .leading, spacing: 1) {
                    Text("Day \(day.day)")
                        .font(.system(size: 12, weight: .bold, design: .rounded))
                        .foregroundStyle(.white.opacity(selected || isHovered ? 0.96 : 0.68))
                    Text(day.shortTitle)
                        .font(.system(size: 11, weight: .medium, design: .rounded))
                        .foregroundStyle(.white.opacity(selected || isHovered ? 0.70 : 0.42))
                        .lineLimit(1)
                }

                Spacer(minLength: 0)
            }
            .padding(.horizontal, 9)
            .padding(.vertical, 7)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .fill(Color.white.opacity(workspaceSidebarRowFillOpacity(isSelected: selected, isHovered: isHovered)))
            )
            .overlay(
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .stroke(workspaceAccentColor(for: day.phase).opacity(selected ? 0.20 : (isHovered ? 0.16 : 0.0)), lineWidth: 1)
            )
            .contentShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        }
        .buttonStyle(.plain)
        .onHover { hovering in
            hoveredWorkspaceDay = hovering ? day.day : nil
        }
        .animation(
            .easeOut(duration: 0.12),
            value: isHovered
        )
        .accessibilityIdentifier("workspace.day.\(day.day)")
        .accessibilityLabel("Day \(day.day), \(day.title)")
    }

    private func workspaceSidebarRowFillOpacity(isSelected: Bool, isHovered: Bool) -> Double {
        if isSelected {
            return isHovered ? 0.145 : 0.105
        }

        return isHovered ? 0.075 : 0.0
    }

    private func workspaceSidebarFooter() -> some View {
        ZStack(alignment: .topTrailing) {
            HStack(spacing: 8) {
                workspaceProjectFolderButton()

                workspaceFooterIconButton(item: .settings, systemName: "gearshape.fill") {
                    openWorkspaceSettings()
                }

                workspaceFooterIconButton(item: .help, systemName: "questionmark.circle.fill") {
                    NSWorkspace.shared.open(MacOnboardingConstants.appBaseURL)
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
            showsInlineBipReadinessSetup = true
            showsBipReadinessPreview = true
            showsBipReadinessAdvanced = true
        }
        applyBipNotificationIntentToCurrentState()
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
                            workspaceHeroCard(day, session: session)
                            workspaceChatThread(session, day: day)
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
                }

                VStack(spacing: 10) {
                    promptComposer()
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
                proxy.scrollTo("workspace.bipMissionCard.scrollTarget", anchor: .center)
            }
            pendingBipNotificationScrollRequestID = nil
        }
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
                if session.pendingUserInput == nil {
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

    private func workspaceBipMissionAssistantCard() -> some View {
        HStack(alignment: .bottom, spacing: 10) {
            VStack(alignment: .leading, spacing: 5) {
                Text("Assistant")
                    .font(.system(size: 10, weight: .bold, design: .rounded))
                    .foregroundStyle(.white.opacity(0.42))

                VStack(alignment: .leading, spacing: 10) {
                    workspaceBipMissionCardMarker()

                    if let hint = workspaceBipNotificationHintText {
                        Text(hint)
                            .font(.system(size: 11, weight: .bold, design: .rounded))
                            .foregroundStyle(Color(red: 0.55, green: 0.90, blue: 0.66).opacity(0.94))
                            .padding(.horizontal, 9)
                            .padding(.vertical, 6)
                            .background(Capsule().fill(Color(red: 0.55, green: 0.90, blue: 0.66).opacity(0.13)))
                            .accessibilityIdentifier("workspace.bipNotificationHint")
                    }

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
            return "BIP 미션 준비"
        }

        let readiness = viewModel.bipReadiness ?? BipReadinessState.loading
        if viewModel.sidecarFailureMessage != nil || !coach.isConfigured || readiness.hasBlockingBipCoachSetupIssue {
            return "BIP 미션 준비"
        }

        return "오늘 BIP 미션"
    }

    private var workspaceBipNotificationHintText: String? {
        switch bipNotificationHintIntent {
        case .morning:
            return "10시 알림에서 열었어요. 오늘 미션을 만들거나 하나 선택하세요."
        case .evening:
            return "21시 마감 체크에서 열었어요. 게시 URL과 Sheet 기록을 남기면 오늘 미션이 끝나요."
        case .none:
            return nil
        }
    }

    private func workspaceBipMissionCardMarker() -> some View {
        Text("BIP mission card")
            .font(.system(size: 1))
            .foregroundStyle(.clear)
            .frame(width: 1, height: 1)
            .accessibilityIdentifier("workspace.chat.bipMissionCard")
            .accessibilityLabel("BIP mission card")
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
                } else {
                    Text(text)
                        .font(.system(size: 13, weight: .semibold, design: .rounded))
                        .foregroundStyle(.white.opacity(0.90))
                        .textSelection(.enabled)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.horizontal, 13)
                        .padding(.vertical, 10)
                        .background(workspaceBubbleBackground(isUser: isUser, isError: message.state == .error))
                }
            }
            .frame(maxWidth: 720, alignment: isUser ? .trailing : .leading)

            if !isUser {
                Spacer(minLength: 90)
            }
        }
        .frame(maxWidth: .infinity, alignment: isUser ? .trailing : .leading)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier(isUser ? "workspace.chat.user" : "workspace.chat.assistant")
        .accessibilityLabel(text)
    }

    private func workspaceStructuredPrompt(_ prompt: StructuredPromptRequest) -> some View {
        HStack(alignment: .bottom, spacing: 10) {
            VStack(alignment: .leading, spacing: 5) {
                Text("Assistant")
                    .font(.system(size: 10, weight: .bold, design: .rounded))
                    .foregroundStyle(.white.opacity(0.42))

                inlineStructuredPrompt(prompt)
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
                    .foregroundStyle(Color(red: 0.55, green: 0.90, blue: 0.66).opacity(0.80))
                Text("오늘 BIP 미션 카드에서 후보를 선택하세요.")
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
                    viewModel.startProviderLogin(action.provider)
                } label: {
                    HStack(spacing: 8) {
                        Image(systemName: action.provider == .claude ? "person.crop.circle.badge.checkmark" : "sparkles")
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
                Text("\(index + 1)")
                    .font(.system(size: 11, weight: .heavy, design: .rounded))
                    .foregroundStyle(Color.black.opacity(0.70))
                    .frame(width: 24, height: 24)
                    .background(Circle().fill(missionChoiceAccent(index).opacity(0.92)))

                VStack(alignment: .leading, spacing: 5) {
                    Text(mission.title?.nonEmpty ?? "오늘 미션")
                        .font(.system(size: 13, weight: .heavy, design: .rounded))
                        .foregroundStyle(.white.opacity(0.94))
                        .lineLimit(2)
                    Text(mission.angle?.nonEmpty ?? mission.mission?.nonEmpty ?? "BIP 기록과 오늘 커리큘럼을 반영한 실행 미션")
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

                Image(systemName: "chevron.right")
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(.white.opacity(0.44))
                    .padding(.top, 5)
            }
            .padding(10)
            .background(
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .fill(Color.white.opacity(0.055))
                    .overlay(
                        RoundedRectangle(cornerRadius: 10, style: .continuous)
                            .stroke(Color.white.opacity(0.09), lineWidth: 1)
                    )
            )
            .contentShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("workspace.chat.bipMissionChoice.\(index + 1)")
        .accessibilityLabel(mission.title?.nonEmpty ?? "BIP 미션 \(index + 1)")
    }

    private func missionChoiceAccent(_ index: Int) -> Color {
        switch index {
        case 0:
            return Color(red: 0.55, green: 0.90, blue: 0.66)
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
	            ScrollView {
	                VStack(alignment: .leading, spacing: 16) {
	                    workspacePreparingHeroCard(day)
	                    workspacePreparingChatAssistant()
	                }
	                .frame(maxWidth: 1180, alignment: .leading)
	                .padding(.horizontal, 34)
                .padding(.vertical, 28)
            }
            .accessibilityIdentifier("workspace.dayDetail")
        }
    }

    private var shouldShowWorkspaceCurriculumFocus: Bool {
        guard let coach = viewModel.visibleBipCoach else {
            return false
        }
        let readiness = viewModel.bipReadiness ?? .loading
        return coach.isConfigured && !readiness.hasBlockingBipCoachSetupIssue
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

            HStack(spacing: 8) {
                ProgressView()
                    .controlSize(.small)
                Text("새 세션을 준비하는 중입니다.")
                    .font(.system(size: 12, weight: .medium, design: .rounded))
                    .foregroundStyle(.white.opacity(0.54))
            }
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(workspacePaneBackground(cornerRadius: 20))
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
            if coach.isConfigured && readiness.bipCoachSetupComplete {
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
                Text("오늘 BIP 미션 준비 상태가 여기에 표시됩니다.")
                    .font(.system(size: 13, weight: .semibold, design: .rounded))
                    .foregroundStyle(.white.opacity(0.78))
                Text("Google Doc 업무일지와 Google Sheet 게시글 일지를 연결하면 오늘 미션과 근거를 Chat Assistant에서 확인할 수 있어요.")
                    .font(.system(size: 12, weight: .medium, design: .rounded))
                    .foregroundStyle(.white.opacity(0.50))
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private func workspaceBipCoachInlineMarker() -> some View {
        Text("BIP Coach inline module")
            .font(.system(size: 1))
            .foregroundStyle(.clear)
            .frame(width: 1, height: 1)
            .accessibilityIdentifier("workspace.bipCoach.inlineModule")
            .accessibilityLabel("BIP Coach inline module")
    }

    @ViewBuilder
    private func workspacePreparingBipCoachContent() -> some View {
        if viewModel.sidecarFailureMessage != nil {
            bipCoachSidecarFailurePanel()
        } else {
            VStack(alignment: .leading, spacing: 10) {
                Text("세션을 준비하고 있습니다.")
                    .font(.system(size: 13, weight: .semibold, design: .rounded))
                    .foregroundStyle(.white.opacity(0.78))
                Text("Sidecar가 연결되면 오늘 미션과 근거를 이 영역에서 확인할 수 있습니다.")
                    .font(.system(size: 12, weight: .medium, design: .rounded))
                    .foregroundStyle(.white.opacity(0.50))
                    .fixedSize(horizontal: false, vertical: true)
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

                        Text("BIP 미션 준비")
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
    private func workspaceBipReadinessCompactCard() -> some View {
        if let coach = viewModel.visibleBipCoach {
            let readiness = viewModel.bipReadiness ?? BipReadinessState.loading
            if !coach.isConfigured || !readiness.bipCoachSetupComplete || readiness.hasBlockingBipCoachSetupIssue {
                let visibleIds = bipReadinessPrimaryRowIds
                let completedIds = visibleIds.filter { readiness.row($0).status == .done }
                let currentId = visibleIds.first { readiness.row($0).status != .done }

                VStack(alignment: .leading, spacing: 12) {
                    workspaceBipCoachInlineMarker()

                    HStack(alignment: .firstTextBaseline, spacing: 10) {
                        Text("오늘 미션을 만들기 위해 gws 연결을 확인합니다.")
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
                                Text("전체 설정")
                                Image(systemName: "arrow.right")
                                    .font(.system(size: 9, weight: .bold))
                            }
                            .font(.system(size: 10, weight: .bold, design: .rounded))
                            .foregroundStyle(.white.opacity(0.56))
                        }
                        .buttonStyle(.plain)
                        .accessibilityIdentifier("workspace.bipReadinessOpenFullSetup")
                    }
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
            workspaceEvidenceGroup(title: "BIP Coach") {
                if let mission = coach.currentMission {
                    workspaceEvidenceLine(mission.title?.nonEmpty ?? "오늘의 BIP 미션")
                    ForEach(Array(evidenceLines(for: mission, coach: coach).prefix(5).enumerated()), id: \.offset) { _, line in
                        workspaceEvidenceLine(line)
                    }
                } else if let evidence = coach.evidence {
                    workspaceEvidenceLine(evidenceReceiptSummary(evidence))
                } else {
                    workspaceEvidenceLine("BIP Coach가 아직 오늘 근거를 읽지 않았습니다.")
                }
            }
        } else {
            workspaceEvidenceGroup(title: "BIP Coach") {
                workspaceEvidenceLine("BIP 미션 설정과 오늘 미션 근거가 준비되면 여기에 연결됩니다.")
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
        let height: CGFloat = isAwaitingInlineInput ? 538 : 576

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
                inlineStructuredPrompt(pendingPrompt)
                    .transition(.opacity)
            } else if visibleCoach != nil && latestAssistantIsBipMission {
                Text("오늘 BIP 미션")
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
        .frame(width: width, height: height, alignment: .topLeading)
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
            } else if coach.isConfigured && !readiness.hasBlockingBipCoachSetupIssue {
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
            Text("오늘의 BIP 미션을 시작하려면 Google Doc 업무일지와 Google Sheet 게시글 일지를 연결하세요.")
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
        let upcomingIds = currentId.map { current in
            visibleIds.filter { $0 != current && state.row($0).status != .done }
        } ?? []

        return VStack(alignment: .leading, spacing: 10) {
            Text("BIP 미션 준비")
                .font(.system(size: 13, weight: .bold, design: .rounded))
                .foregroundStyle(.white.opacity(0.86))

            Text("IDD 문서 7종과 Google Docs/Sheets 연결이 모두 준비되어야 BIP 미션을 만들 수 있어요.")
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

            if !upcomingIds.isEmpty {
                bipReadinessPreviewToggle(upcomingIds, state: state)
            }

            bipReadinessAdvancedToggle(state)

            Text("준비가 끝나면 오늘 BIP 미션 카드가 여기 표시됩니다.")
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
            return "\(totalCount)/\(totalCount) 완료 · 준비가 끝났어요"
        }
        if completedCount == totalCount - 1 {
            return "\(completedCount)/\(totalCount) 완료 · 마지막 한 가지만 하면 돼요"
        }
        return "\(completedCount)/\(totalCount) 완료 · 다음 한 가지만 하면 돼요"
    }

    private func bipReadinessCompleteView() -> some View {
        HStack(alignment: .top, spacing: 9) {
            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(Color(red: 0.55, green: 0.90, blue: 0.66))
                .padding(.top, 1)

            VStack(alignment: .leading, spacing: 4) {
                Text("준비 완료")
                    .font(.system(size: 13, weight: .bold, design: .rounded))
                    .foregroundStyle(.white.opacity(0.90))
                Text("이제 BIP Coach가 문서와 Google Doc/Sheet를 읽고 매일 미션을 만들 수 있어요.")
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
                .foregroundStyle(Color(red: 0.55, green: 0.90, blue: 0.66))
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
            return "docs/ICP.md를 IDD 인터뷰로 고정해 이상 고객과 반-ICP를 명확히 해요."
        case .localSpec:
            return "docs/SPEC.md를 IDD 인터뷰로 고정해 문제, 가치, MVP, 성공 기준을 정해요."
        case .localDesignSystem:
            return "docs/DESIGN_SYSTEM.md를 IDD 인터뷰로 고정해 UI/UX 원칙과 컴포넌트를 정해요."
        case .localAdr:
            return "docs/ADR.md를 IDD 인터뷰로 고정해 주요 기술 결정과 트레이드오프를 남겨요."
        case .localGoal:
            return "docs/GOAL.md를 IDD 인터뷰로 고정해 목표, 지표, 운영 리듬을 정해요."
        case .localDocs:
            return "docs/DOCS.md를 IDD 인터뷰로 고정해 문서 지도와 유지 규칙을 정해요."
        case .localSheet:
            return "docs/SHEET.md를 IDD 인터뷰로 고정해 게시글 기록 Sheet 스키마를 정해요."
        case .googleSignIn:
            return "앱 계정 상태예요. BIP 설정에서는 gws 로그인 흐름을 사용해요."
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
                .foregroundStyle(Color(red: 0.55, green: 0.90, blue: 0.66).opacity(0.78))
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
                    .foregroundStyle(Color(red: 0.55, green: 0.90, blue: 0.66))
                Text("\(title) 복사 완료")
                    .font(.system(size: 11, weight: .bold, design: .rounded))
                    .foregroundStyle(.white.opacity(0.82))
            }
            Text("내 Google Drive · BIP Coach에 연결됨")
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
                        .foregroundStyle(Color(red: 0.55, green: 0.90, blue: 0.66))
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
            bipCoachButton("IDD 인터뷰 시작") {
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
        case .localIcp: return "ICP 문서"
        case .localSpec: return "SPEC 문서"
        case .localDesignSystem: return "Design System 문서"
        case .localAdr: return "ADR 문서"
        case .localGoal: return "GOAL 문서"
        case .localDocs: return "Docs 문서"
        case .localSheet: return "Sheet 문서"
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
                    .foregroundStyle(Color(red: 0.55, green: 0.90, blue: 0.66).opacity(0.92))
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(Capsule().fill(Color(red: 0.55, green: 0.90, blue: 0.66).opacity(0.12)))
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
                Text("\(index + 1)")
                    .font(.system(size: 11, weight: .heavy, design: .rounded))
                    .foregroundStyle(Color.black.opacity(0.70))
                    .frame(width: 24, height: 24)
                    .background(Circle().fill(missionChoiceAccent(index).opacity(0.92)))

                VStack(alignment: .leading, spacing: 4) {
                    Text(mission.title?.nonEmpty ?? "오늘 미션")
                        .font(.system(size: 13, weight: .heavy, design: .rounded))
                        .foregroundStyle(.white.opacity(0.94))
                        .lineLimit(1)
                    Text(mission.angle?.nonEmpty ?? "BIP 기록과 오늘 커리큘럼을 반영한 실행 미션")
                        .font(.system(size: 11, weight: .semibold, design: .rounded))
                        .foregroundStyle(.white.opacity(0.62))
                        .lineLimit(1)
                    if let missionText = mission.mission?.nonEmpty {
                        Text(missionText)
                            .font(.system(size: 11, weight: .medium, design: .rounded))
                            .foregroundStyle(.white.opacity(0.50))
                            .lineLimit(1)
                    }
                }

                Spacer(minLength: 0)

                Text("선택")
                    .font(.system(size: 11, weight: .bold, design: .rounded))
                    .foregroundStyle(.white.opacity(0.82))
                    .padding(.horizontal, 9)
                    .frame(height: 26)
                    .background(Capsule().fill(Color.white.opacity(0.10)))
            }
            .padding(10)
            .background(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .fill(Color.white.opacity(0.055))
                    .overlay(
                        RoundedRectangle(cornerRadius: 12, style: .continuous)
                            .stroke(Color.white.opacity(0.09), lineWidth: 1)
                    )
            )
            .contentShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("workspace.bipCoach.missionChoice.\(index + 1)")
        .accessibilityLabel("\(mission.title?.nonEmpty ?? "BIP 미션 \(index + 1)") 선택")
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
                .foregroundStyle(isComplete ? Color(red: 0.55, green: 0.90, blue: 0.66).opacity(0.82) : .white.opacity(isActive ? 0.64 : 0.28))
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
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(coach.currentMission?.status == "completed" ? "완료된 미션" : "오늘 미션")
                    .font(.system(size: 15, weight: .bold, design: .rounded))
                    .foregroundStyle(.white.opacity(0.94))
                Spacer(minLength: 0)
                Text("연속 \(coach.streak.current)일")
                    .font(.system(size: 11, weight: .bold, design: .rounded))
                    .foregroundStyle(Color(red: 0.55, green: 0.90, blue: 0.66).opacity(0.92))
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(Capsule().fill(Color(red: 0.55, green: 0.90, blue: 0.66).opacity(0.12)))
            }

            Text(mission.title?.nonEmpty ?? "오늘의 BIP 미션")
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
            Text("게시 후 남길 기록")
                .font(.system(size: 12, weight: .bold, design: .rounded))
                .foregroundStyle(.white.opacity(0.72))

            HStack(spacing: 8) {
                TextField("Threads URL", text: $bipThreadsURL)
                    .textFieldStyle(.plain)
                    .font(.system(size: 12, weight: .semibold, design: .rounded))
                    .foregroundStyle(.white.opacity(0.92))
                    .padding(.horizontal, 11)
                    .frame(height: 36)
                    .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.black.opacity(0.16)))
                    .accessibilityIdentifier("assistant.bipThreadsURL")

                TextField("Sheet 행 메모", text: $bipSheetRowNote)
                    .textFieldStyle(.plain)
                    .font(.system(size: 12, weight: .semibold, design: .rounded))
                    .foregroundStyle(.white.opacity(0.92))
                    .padding(.horizontal, 11)
                    .frame(height: 36)
                    .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.black.opacity(0.16)))
                    .accessibilityIdentifier("assistant.bipSheetRowNote")

                Button {
                    viewModel.completeBipMission(threadsUrl: bipThreadsURL, sheetRowNote: bipSheetRowNote)
                    withAnimation(.spring(response: 0.26, dampingFraction: 0.86)) {
                        showsBipCompletionFields = false
                    }
                    bipThreadsURL = ""
                    bipSheetRowNote = ""
                } label: {
                    Text("기록 완료")
                        .font(.system(size: 12, weight: .bold, design: .rounded))
                        .foregroundStyle(.white.opacity(0.9))
                        .padding(.horizontal, 12)
                        .frame(height: 36)
                        .background(Capsule().fill(Color.white.opacity(0.14)))
                }
                .buttonStyle(.plain)
                .disabled(bipThreadsURL.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || bipSheetRowNote.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || viewModel.isBipCoachCompleting)
                .accessibilityIdentifier("assistant.completeBipMission")
            }
        }
        .padding(10)
        .background(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(Color.black.opacity(0.12))
        )
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
        return "근거: Threads 반응 · 팔로워 변화 · BIP 기록"
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
        if let provider = evidence.provider {
            parts.append(provider.title)
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
        let title = mission.title?.nonEmpty ?? "오늘의 BIP 미션"
        viewModel.draft = "/bip-draft \(title)"
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

    private func inlineStructuredPrompt(_ prompt: StructuredPromptRequest) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(prompt.title?.nonEmpty ?? "Office Hours intake")
                .font(.system(size: 15, weight: .bold, design: .rounded))
                .foregroundStyle(.white.opacity(0.9))
                .accessibilityIdentifier("assistant.structuredPromptTitle")

            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    ForEach(prompt.questions) { question in
                        questionCard(question)
                    }
                }
                .padding(.vertical, 2)
            }
            .frame(maxHeight: 372)

            HStack(spacing: 12) {
                Spacer(minLength: 0)

                Button {
                    submitPrompt(prompt)
                } label: {
                    Text(structuredPromptSubmitTitle(prompt))
                        .font(.system(size: 14, weight: .bold, design: .rounded))
                        .foregroundStyle(.white.opacity(canSubmit(prompt) ? 0.96 : 0.42))
                        .padding(.horizontal, 18)
                        .padding(.vertical, 10)
                        .background(
                            Capsule()
                                .fill(Color.white.opacity(canSubmit(prompt) ? 0.18 : 0.07))
                        )
                }
                .buttonStyle(.plain)
                .disabled(!canSubmit(prompt))
                .accessibilityIdentifier("assistant.structuredContinueButton")
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("assistant.structuredPrompt")
    }

    private func structuredPromptSubmitTitle(_ prompt: StructuredPromptRequest) -> String {
        if prompt.title?.contains("첫") == true {
            return "이걸로 시작"
        }
        return "다음 질문"
    }

    private func questionCard(_ question: StructuredPromptQuestion) -> some View {
        let draft = promptDrafts[question.id] ?? StructuredAnswerDraft()

        return VStack(alignment: .leading, spacing: 12) {
            if let helperText = question.helperText?.trimmingCharacters(in: .whitespacesAndNewlines), !helperText.isEmpty {
                VStack(alignment: .leading, spacing: 5) {
                    Text("프로젝트를 훑어봤어요")
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

            Text(question.question)
                .font(.system(size: 14, weight: .semibold, design: .rounded))
                .foregroundStyle(.white.opacity(0.92))
                .fixedSize(horizontal: false, vertical: true)

            if let options = question.options, !options.isEmpty {
                VStack(spacing: 8) {
                    ForEach(options, id: \.label) { option in
                        choiceRow(option, question: question, selected: draft.selectedOptions.contains(option.label))
                    }
                }
            }

            if question.allowFreeText == true || question.options?.isEmpty != false {
                VStack(alignment: .leading, spacing: 6) {
                    Text("직접 입력")
                        .font(.system(size: 11, weight: .bold, design: .rounded))
                        .foregroundStyle(.white.opacity(0.52))
                    freeTextField(question: question)
                }
            }
        }
        .padding(14)
        .background(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .fill(Color.black.opacity(0.18))
                .overlay(
                    RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .stroke(Color.white.opacity(0.08), lineWidth: 1)
                )
        )
    }

    private func choiceRow(
        _ option: StructuredPromptOption,
        question: StructuredPromptQuestion,
        selected: Bool
    ) -> some View {
        Button {
            toggleOption(option.label, for: question)
        } label: {
            HStack(alignment: .top, spacing: 12) {
                ZStack {
                    Circle()
                        .stroke(selected ? Color(red: 0.82, green: 0.89, blue: 1.0) : Color.white.opacity(0.30), lineWidth: 1.4)
                    if selected {
                        Circle()
                            .fill(Color(red: 0.82, green: 0.89, blue: 1.0))
                            .frame(width: 8, height: 8)
                    }
                }
                .frame(width: 16, height: 16)
                .padding(.top, 2)

                VStack(alignment: .leading, spacing: 3) {
                    Text(option.label)
                        .font(.system(size: 13, weight: .semibold, design: .rounded))
                        .foregroundStyle(.white.opacity(0.94))
                    Text(option.description)
                        .font(.system(size: 12, weight: .medium, design: .rounded))
                        .foregroundStyle(.white.opacity(0.54))
                        .fixedSize(horizontal: false, vertical: true)
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
                            .stroke(selected ? Color(red: 0.82, green: 0.89, blue: 1.0).opacity(0.72) : Color.white.opacity(0.0), lineWidth: 1)
                    )
            )
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .ignore)
        .accessibilityIdentifier("assistant.structuredChoice.\(question.id).\(option.label)")
        .accessibilityLabel(option.label)
        .accessibilityHint(option.description)
        .accessibilityValue(selected ? "Selected" : "Not selected")
        .accessibilityAddTraits(.isButton)
    }

    private func freeTextField(question: StructuredPromptQuestion) -> some View {
        if question.textMode == .long {
            return AnyView(
                TextEditor(
                    text: Binding(
                        get: { promptDrafts[question.id]?.freeText ?? "" },
                        set: { updateFreeText($0, for: question) }
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
                .accessibilityIdentifier("assistant.structuredFreeText.\(question.id)")
                .accessibilityLabel(question.freeTextPlaceholder?.nonEmpty ?? "Type your answer")
            )
        }

        return AnyView(
            TextField(
                question.freeTextPlaceholder?.nonEmpty ?? "Type your answer",
                text: Binding(
                    get: { promptDrafts[question.id]?.freeText ?? "" },
                    set: { updateFreeText($0, for: question) }
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
        .help("Agentic30 Workspace 열기")
        .accessibilityIdentifier("assistant.openWorkspaceButton")
        .accessibilityLabel("Agentic30 Workspace 열기")
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
        HStack(spacing: 10) {
            TextField(
                "메시지 보내기",
                text: $viewModel.draft
            )
            .textFieldStyle(.plain)
            .font(.system(size: 13, weight: .semibold, design: .rounded))
            .foregroundStyle(.white.opacity(0.94))
            .accessibilityIdentifier("assistant.promptComposer")
            .accessibilityLabel("메시지 보내기")
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

    private func toggleOption(_ label: String, for question: StructuredPromptQuestion) {
        var draft = promptDrafts[question.id] ?? StructuredAnswerDraft()

        if question.multiSelect == true {
            if draft.selectedOptions.contains(label) {
                draft.selectedOptions.remove(label)
            } else {
                draft.selectedOptions.insert(label)
            }
        } else {
            draft.selectedOptions = [label]
        }

        promptDrafts[question.id] = draft
    }

    private func updateFreeText(_ text: String, for question: StructuredPromptQuestion) {
        var draft = promptDrafts[question.id] ?? StructuredAnswerDraft()
        draft.freeText = text
        promptDrafts[question.id] = draft
    }

    private func canSubmit(_ prompt: StructuredPromptRequest) -> Bool {
        prompt.questions.allSatisfy { question in
            let draft = promptDrafts[question.id] ?? StructuredAnswerDraft()
            let hasSelection = !draft.selectedOptions.isEmpty
            let hasFreeText = !draft.freeText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty

            if question.allowFreeText == true {
                return hasSelection || hasFreeText
            }

            return hasSelection
        }
    }

    private func submitPrompt(_ prompt: StructuredPromptRequest) {
        let submissions = prompt.questions.map { question in
            let draft = promptDrafts[question.id] ?? StructuredAnswerDraft()
            return AgenticViewModel.StructuredPromptSubmission(
                question: question.question,
                selectedOptions: Array(draft.selectedOptions),
                freeText: draft.freeText.trimmingCharacters(in: .whitespacesAndNewlines)
            )
        }

        viewModel.submitStructuredPrompt(
            requestId: prompt.requestId,
            responses: submissions
        )
    }

    private func syncPromptDrafts(requestID: String?) {
        guard let request = viewModel.pendingStructuredPrompt else {
            currentPromptID = nil
            promptDrafts = [:]
            return
        }
        guard currentPromptID != request.requestId else { return }

        currentPromptID = request.requestId
        promptDrafts = Dictionary(
            uniqueKeysWithValues: request.questions.map { question in
                (question.id, StructuredAnswerDraft())
            }
        )
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
        .init(day: 1, phase: .foundation, title: "문제 지도를 만든다", shortTitle: "문제 지도", summary: "내가 풀고 싶은 문제가 아니라, 실제 사람이 반복해서 겪는 문제를 모읍니다.", tasks: ["최근 인터뷰/메모에서 반복 문제 10개를 뽑기", "각 문제마다 과거 행동 증거를 붙이기", "가장 절박한 문제 3개만 남기기"], output: "고객 문제 후보 3개와 증거 문장"),
        .init(day: 2, phase: .foundation, title: "Mom Test 인터뷰를 준비한다", shortTitle: "Mom Test", summary: "아이디어 칭찬을 피하고 과거 행동을 묻는 질문지로 바꿉니다.", tasks: ["문제 후보별 과거 행동 질문 작성", "인터뷰 대상 5명 리스트업", "오늘 보낼 DM 초안 작성"], output: "검증 질문지와 인터뷰 요청 DM"),
        .init(day: 3, phase: .foundation, title: "ICP를 좁힌다", shortTitle: "ICP 좁히기", summary: "넓은 시장 대신 30일 안에 만날 수 있는 구체 고객으로 줄입니다.", tasks: ["응답한 사람의 공통 조건 찾기", "Anti-ICP를 명시하기", "첫 고객 한 문장으로 쓰기"], output: "1문장 ICP와 제외 기준"),
        .init(day: 4, phase: .foundation, title: "Pain Evidence를 정리한다", shortTitle: "Pain Evidence", summary: "느낌이 아니라 실제 발화와 행동으로 고통 강도를 판단합니다.", tasks: ["인터뷰 발화에서 고통 표현 표시", "대체재와 지불 행동 확인", "강한 증거/약한 증거 분리"], output: "문제별 증거 점수표"),
        .init(day: 5, phase: .foundation, title: "지불 의향을 확인한다", shortTitle: "지불 의향", summary: "좋다는 말이 아니라 돈, 시간, 전환 의지를 확인합니다.", tasks: ["가격/대체재 질문 준비", "2명에게 구체 제안 보내기", "거절 사유를 그대로 기록"], output: "지불 신호와 거절 사유"),
        .init(day: 6, phase: .foundation, title: "포지셔닝을 쓴다", shortTitle: "포지셔닝", summary: "누구에게 무엇을 약속하는지 한 화면에서 이해되게 만듭니다.", tasks: ["타깃/문제/결과를 한 문장으로 압축", "경쟁 대안 3개와 다른 점 쓰기", "랜딩 첫 문단 초안 작성"], output: "랜딩 첫 화면 메시지"),
        .init(day: 7, phase: .foundation, title: "Go / No-Go를 결정한다", shortTitle: "Go / No-Go", summary: "7일간 모은 숫자와 발화로 계속할지 바꿀지 정합니다.", tasks: ["가장 강한 증거 5개 고르기", "가장 위험한 반증 3개 고르기", "계속/전환/중단 결정 쓰기"], output: "Foundation 결정 메모"),
        .init(day: 8, phase: .build, title: "MVP 범위를 3개 기능으로 자른다", shortTitle: "MVP 3기능", summary: "첫 사용자가 결과를 보는 데 필요한 기능만 남깁니다.", tasks: ["핵심 결과까지의 사용자 흐름 그리기", "필수 기능 3개만 선택", "나머지는 의도적으로 미루기"], output: "MVP 기능 3개와 제외 목록"),
        .init(day: 9, phase: .build, title: "데이터 흐름을 고정한다", shortTitle: "데이터 흐름", summary: "사용자의 입력, AI 처리, 결과 저장 흐름을 한 번에 이해되게 만듭니다.", tasks: ["입력 데이터와 저장 위치 정하기", "실패 시 복구 흐름 쓰기", "첫 번째 테스트 케이스 만들기"], output: "데이터 흐름 다이어그램"),
        .init(day: 10, phase: .build, title: "핵심 플로우를 프로토타입한다", shortTitle: "핵심 플로우", summary: "완성도가 아니라 끝까지 한 번 지나가는 흐름을 만듭니다.", tasks: ["가짜 데이터로 happy path 연결", "첫 결과 화면 만들기", "막히는 지점 기록"], output: "End-to-end prototype"),
        .init(day: 11, phase: .build, title: "Transcript ingest를 붙인다", shortTitle: "Transcript", summary: "고객 목소리가 앱 안으로 들어오는 첫 관문을 안정화합니다.", tasks: ["txt/md/vtt/srt 입력 케이스 확인", "빈 파일/긴 파일 오류 처리", "분석 요청까지 연결"], output: "Transcript 입력 QA 기록"),
        .init(day: 12, phase: .build, title: "Daily Mission loop를 만든다", shortTitle: "Daily Mission", summary: "오늘 할 일을 앱이 개인화해서 제안하고 다시 기록하게 만듭니다.", tasks: ["Day context를 prompt에 넣기", "미션 카드 출력 확인", "완료 기록 저장 흐름 연결"], output: "오늘 미션 생성/완료 흐름"),
        .init(day: 13, phase: .build, title: "온보딩을 드라이런한다", shortTitle: "온보딩", summary: "처음 설치한 사람이 첫 미션까지 도달하는지 확인합니다.", tasks: ["새 workspace로 첫 실행", "막히는 문구/권한 기록", "불필요한 설명 삭제"], output: "Time-to-first-mission 메모"),
        .init(day: 14, phase: .build, title: "측정을 심는다", shortTitle: "측정", summary: "사용자가 어디서 멈추는지 알 수 있게 이벤트를 남깁니다.", tasks: ["핵심 이벤트 5개 정의", "개인정보 없는 payload 확인", "dogfood 대시보드 메모 작성"], output: "이벤트 목록과 확인 로그"),
        .init(day: 15, phase: .build, title: "릴리즈 체크리스트를 닫는다", shortTitle: "체크리스트", summary: "빌드, 권한, 실패 메시지를 출시 전 한 번에 점검합니다.", tasks: ["Xcode build와 테스트 실행", "권한/Keychain 실패 케이스 확인", "릴리즈 노트 초안 작성"], output: "릴리즈 준비 체크리스트"),
        .init(day: 16, phase: .build, title: "Private DMG를 만든다", shortTitle: "Private DMG", summary: "완벽한 공개가 아니라 실제 설치 파일을 가까운 사용자에게 보냅니다.", tasks: ["DMG 빌드", "설치 안내 5줄 작성", "첫 테스터 3명에게 공유"], output: "Private build 공유 기록"),
        .init(day: 17, phase: .build, title: "Build phase를 회고한다", shortTitle: "Build 회고", summary: "기능이 아니라 사용자가 결과를 봤는지 기준으로 판단합니다.", tasks: ["완성/미완성 기능 분리", "사용자 가치까지 연결된 흐름 표시", "Launch 전에 자를 것 결정"], output: "Build retro와 Launch 준비 목록"),
        .init(day: 18, phase: .launch, title: "Launch story를 쓴다", shortTitle: "Launch story", summary: "무엇을 만들었는지가 아니라 왜 지금 써야 하는지를 씁니다.", tasks: ["ICP의 기존 고통으로 시작하기", "결과 화면 한 장 고르기", "첫 공개 글 초안 작성"], output: "Launch post 초안"),
        .init(day: 19, phase: .launch, title: "BIP 포스트를 공개한다", shortTitle: "BIP 공개", summary: "불완전한 현재 상태를 숨기지 않고 진행 증거로 공개합니다.", tasks: ["오늘 배운 점 1개 쓰기", "스크린샷/숫자 1개 붙이기", "Threads에 게시 후 반응 기록"], output: "게시 URL과 반응 기록"),
        .init(day: 20, phase: .launch, title: "Warm outreach를 보낸다", shortTitle: "Warm outreach", summary: "아는 사람부터 작은 약속을 받아냅니다.", tasks: ["관심 가능성이 높은 20명 리스트", "개인화 DM 10개 발송", "응답/무응답을 Sheet에 기록"], output: "Outreach tracker"),
        .init(day: 21, phase: .launch, title: "첫 피드백을 받는다", shortTitle: "첫 피드백", summary: "사용자가 실제로 어디서 이해하고 어디서 멈추는지 봅니다.", tasks: ["설치/첫 실행 관찰 2회", "말이 막힌 문구 표시", "수정 3개만 반영"], output: "피드백 기반 수정 목록"),
        .init(day: 22, phase: .launch, title: "데모를 녹화한다", shortTitle: "데모", summary: "설명 글보다 60초 데모가 더 빨리 이해시킵니다.", tasks: ["핵심 결과만 보이는 흐름 선택", "60초 이하 녹화", "게시글에 붙일 캡션 작성"], output: "60초 demo asset"),
        .init(day: 23, phase: .launch, title: "반대 의견을 정리한다", shortTitle: "Objections", summary: "안 쓴 이유가 다음 개선의 우선순위입니다.", tasks: ["거절/무응답 사유 분류", "가격/신뢰/설치/가치 문제 분리", "가장 큰 blocker 하나 선택"], output: "Objection map"),
        .init(day: 24, phase: .launch, title: "Launch 결정을 내린다", shortTitle: "Launch 결정", summary: "더 공개할지, 좁힐지, 메시지를 바꿀지 숫자로 정합니다.", tasks: ["방문/설치/응답 숫자 정리", "가장 강한 유입 채널 선택", "다음 7일 실험 하나 정하기"], output: "Launch decision memo"),
        .init(day: 25, phase: .grow, title: "Activation 숫자를 본다", shortTitle: "Activation", summary: "가입보다 첫 가치 경험에 도달했는지를 봅니다.", tasks: ["첫 가치 행동 정의", "도달/이탈 숫자 계산", "가장 큰 이탈 지점 하나 고르기"], output: "Activation baseline"),
        .init(day: 26, phase: .grow, title: "Retention 신호를 확인한다", shortTitle: "Retention", summary: "다시 돌아오는 사람이 있는지 확인합니다.", tasks: ["재방문/재실행 기준 정하기", "돌아온 사용자 발화 확인", "반복 사용 이유 한 문장으로 쓰기"], output: "Retention note"),
        .init(day: 27, phase: .grow, title: "가격 실험을 한다", shortTitle: "가격", summary: "첫 매출은 큰 금액보다 지불 행동 증명이 중요합니다.", tasks: ["가장 작은 유료 제안 작성", "관심 사용자에게 제안", "가격 반응과 질문 기록"], output: "가격 제안 결과"),
        .init(day: 28, phase: .grow, title: "Support loop를 만든다", shortTitle: "Support", summary: "사용자 질문이 제품 개선으로 돌아오게 만듭니다.", tasks: ["반복 질문 5개 모으기", "앱/문서/온보딩 중 어디서 풀지 결정", "한 가지를 바로 고치기"], output: "Support insight log"),
        .init(day: 29, phase: .grow, title: "PMF memo를 쓴다", shortTitle: "PMF memo", summary: "성공/실패를 감이 아니라 근거로 기록합니다.", tasks: ["유저 100명/첫 매출 진행률 쓰기", "가장 강한 PMF 신호와 반증 쓰기", "다음 분기 선택지 작성"], output: "PMF evidence memo"),
        .init(day: 30, phase: .grow, title: "30일 회고와 다음 결정을 한다", shortTitle: "Final retro", summary: "완주 자체보다 다음에 무엇을 계속할지 결정하는 날입니다.", tasks: ["30일 숫자 요약", "가장 큰 배움 3개 쓰기", "계속/전환/중단 결정 공개"], output: "Day 30 public retro")
    ]
}

private struct StructuredAnswerDraft: Hashable {
    var selectedOptions: Set<String> = []
    var freeText = ""
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

#Preview {
    ContentView(viewModel: AgenticViewModel())
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
    func makeNSView(context: Context) -> NSView {
        let view = NSView()
        configureWindow(for: view)
        return view
    }

    func updateNSView(_ nsView: NSView, context: Context) {
        configureWindow(for: nsView)
    }

    private func configureWindow(for view: NSView) {
        DispatchQueue.main.async {
            guard let window = view.window else { return }

            window.title = "Agentic30 Workspace"
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
        }
    }
}

private extension String {
    var nonEmpty: String? {
        trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : self
    }
}
