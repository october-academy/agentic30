import SwiftUI
import AppKit

enum SettingsSection: String, CaseIterable, Identifiable {
    case appearance
    case workspace
    case menubar
    case providers
    case integrations
    case privacy
    case updates
    case advanced

    var id: String { rawValue }

    static func fromIdentifier(_ identifier: String) -> SettingsSection? {
        SettingsSection(rawValue: identifier)
    }

    var title: String {
        switch self {
        case .workspace: "Workspace"
        case .appearance: "Appearance"
        case .menubar: "Menu Bar & Notifications"
        case .providers: "AI 연결"
        case .integrations: "Integrations"
        case .privacy: "Privacy & Diagnostics"
        case .updates: "Updates"
        case .advanced: "Advanced"
        }
    }

    var sidebarTitle: String {
        switch self {
        case .workspace: "워크스페이스"
        case .appearance: "외관"
        case .menubar: "메뉴바 & 알림"
        case .providers: "AI 프로바이더"
        case .integrations: "연동"
        case .privacy: "개인정보 & 진단"
        case .updates: "업데이트"
        case .advanced: "고급 & 실행 보조 앱"
        }
    }

    var systemImage: String {
        switch self {
        case .workspace: "folder"
        case .appearance: "globe"
        case .menubar: "bell"
        case .providers: "chevron.left.forwardslash.chevron.right"
        case .integrations: "link"
        case .privacy: "shield"
        case .updates: "arrow.triangle.2.circlepath"
        case .advanced: "terminal"
        }
    }

    var accessibilityIdentifier: String {
        rawValue
    }
}

struct SettingsView: View {
    @ObservedObject var viewModel: AgenticViewModel
    private let embeddedInWorkspace: Bool
    private let returnToWorkspace: (() -> Void)?
    private let selectedSectionOverride: Binding<SettingsSection>?

    @Environment(\.openWindow) private var openWindow

    // MARK: - Privacy State

    @State private var telemetryDisabled = PostHogTelemetry.isTelemetryDisabledByUser

    // MARK: - Agent Settings State

    @State private var claudeModelID = AgentModelCatalog.defaultClaudeModelID
    @State private var codexModelID = AgentModelCatalog.defaultCodexModelID
    @State private var geminiModelID = AgentModelCatalog.defaultGeminiModelID
    @State private var claudeAuthMode = AgentAuthMode.local.rawValue
    @State private var codexAuthMode = AgentAuthMode.local.rawValue
    @State private var geminiAuthMode = AgentAuthMode.local.rawValue
    @State private var claudeApiKey = ""
    @State private var codexApiKey = ""
    @State private var geminiApiKey = ""
    @State private var claudeEnvironment = ""
    @State private var codexEnvironment = ""
    @State private var geminiEnvironment = ""
    @State private var exaApiKey = ""
    @State private var cloudflareApiToken = ""
    @State private var cloudflareMcpURL = KeychainHelper.Settings.defaultCloudflareMcpURL
    @State private var cloudflareMcpCodemode = KeychainHelper.Settings.defaultCloudflareMcpCodemode
    @State private var posthogApiKey = ""
    @State private var posthogProjectAPIKey = ""
    @State private var posthogHost = ""
    @State private var posthogMcpURL = KeychainHelper.Settings.defaultPostHogMcpURL
    @State private var posthogMcpRegion = KeychainHelper.Settings.defaultPostHogMcpRegion
    @State private var posthogMcpReadonly = true
    @State private var posthogMcpFeatures = KeychainHelper.Settings.defaultPostHogMcpFeatures

    // MARK: - Workspace State

    @State private var workspaceRootPath = ""
    @State private var advancedToolsMessage = ""
    @State private var confettiTestRunID = 0
    @State private var localDataConfirmation: LocalDataConfirmation?
    @State private var localSelectedSection: SettingsSection = .workspace
    @State private var hoveredSettingsSection: SettingsSection?
    @State private var hoveredWorkspacePathChangeButton = false
    @State private var settingsSearchQuery = ""
    @State private var settingsSaveMessage = ""
    @State private var settingsThemeChoice = Agentic30Theme.current == .dark ? "dark" : "light"
    @AppStorage(Agentic30Theme.storageKey) private var appThemeRawValue = Agentic30Theme.defaultTheme.rawValue

    private enum LocalDataConfirmation: Identifiable {
        case reset
        case uninstall

        var id: String {
            switch self {
            case .reset: return "reset"
            case .uninstall: return "uninstall"
            }
        }

        var title: String {
            switch self {
            case .reset:
                return "Reset local Agentic30 data?"
            case .uninstall:
                return "Uninstall Agentic30?"
            }
        }

        var message: String {
            switch self {
            case .reset:
                return "Agentic30 UserDefaults, Keychain 항목, 앱 지원 파일, 로컬 세션, 캐시, 저장 상태, 온보딩 상태, Agentic30 QMD 색인, 알려진 워크스페이스의 .agentic30 폴더를 삭제합니다. 다른 프로젝트 파일과 전역 AI 연결 로그인은 삭제하지 않습니다."
            case .uninstall:
                return "This runs the same local data reset, then selects the Agentic30 app in Finder so you can quit the app and move it to Trash. macOS does not run cleanup when an app is deleted directly from Finder."
            }
        }

        var actionTitle: String {
            switch self {
            case .reset:
                return "Reset Local Data"
            case .uninstall:
                return "Clear Data & Show App"
            }
        }
    }

    // MARK: - Launch at Login

    @ObservedObject private var loginItemsManager = LoginItemsManager.shared

    init(
        viewModel: AgenticViewModel,
        embeddedInWorkspace: Bool = false,
        selectedSection: Binding<SettingsSection>? = nil,
        returnToWorkspace: (() -> Void)? = nil
    ) {
        _viewModel = ObservedObject(wrappedValue: viewModel)
        self.embeddedInWorkspace = embeddedInWorkspace
        self.returnToWorkspace = returnToWorkspace
        self.selectedSectionOverride = selectedSection
        #if DEBUG
        if selectedSection == nil, let initialSection = Self.uiTestingInitialSection() {
            _localSelectedSection = State(initialValue: initialSection)
        }
        #endif
    }

    private var selectedSection: Binding<SettingsSection> {
        selectedSectionOverride ?? $localSelectedSection
    }

    #if DEBUG
    private static func uiTestingInitialSection() -> SettingsSection? {
        guard let rawSection = uiTestingArgumentValue("--ui-testing-open-settings-section") else {
            return nil
        }
        return SettingsSection.fromIdentifier(rawSection)
    }

    private static func uiTestingArgumentValue(_ name: String) -> String? {
        let arguments = CommandLine.arguments
        if let index = arguments.firstIndex(of: name), arguments.indices.contains(index + 1) {
            return arguments[index + 1]
        }
        let prefix = "\(name)="
        return arguments.first(where: { $0.hasPrefix(prefix) })?
            .dropFirst(prefix.count)
            .description
    }
    #endif

    var body: some View {
        settingsContent
            .agentic30Themed()
            .onAppear(perform: loadAllValues)
            .onChange(of: viewModel.workspaceRoot) { _, root in
                syncWorkspaceRoot(root)
            }
            .overlay {
                ZStack {
                    if let localDataConfirmation {
                        localDataConfirmationDialog(localDataConfirmation)
                            .transition(.opacity.combined(with: .scale(scale: 0.98)))
                    }

                    if confettiTestRunID > 0 {
                        RealisticConfettiBurst(trigger: confettiTestRunID)
                            .id(confettiTestRunID)
                            .allowsHitTesting(false)
                            .accessibilityIdentifier("settings.advanced.confettiOverlay")
                    }
                }
            }
    }

    @ViewBuilder
    private var settingsContent: some View {
        if embeddedInWorkspace {
            workspaceSettingsPage
        } else {
            settingsWindowContent
        }
    }

    private var settingsWindowContent: some View {
        settingsDesignShell
            .frame(width: 1080, height: 720)
    }

    private var workspaceSettingsPage: some View {
        settingsDesignShell
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(settingsBackground)
    }

    private var settingsDesignShell: some View {
        GeometryReader { geometry in
            let showsNavigation = geometry.size.width >= 740
            let showsMeta = geometry.size.width >= 1040

            HStack(spacing: 0) {
                if showsNavigation {
                    settingsDesignSidebar
                        .frame(width: 240)
                        .transition(.opacity)
                }

                VStack(spacing: 0) {
                    settingsDesignHeader(showsCompactNavigation: !showsNavigation)

                    selectedSettingsSection
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(settingsBackground)

                if showsMeta {
                    settingsMetaPanel
                        .frame(width: 280)
                        .transition(.opacity)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .background(settingsBackground)
    }

    private var settingsDesignSidebar: some View {
        VStack(spacing: 0) {
            HStack(spacing: 6) {
                Text("설정")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(settingsText.opacity(0.94))
                Spacer(minLength: 0)
            }
            .padding(.top, 10)
            .padding(.horizontal, 12)
            .padding(.bottom, 8)

            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass")
                    .font(.system(size: 11, weight: .regular))
                    .foregroundStyle(OpenDesignDayColor.fgSecondary)
                TextField("설정 검색", text: $settingsSearchQuery)
                    .textFieldStyle(.plain)
                    .font(.system(size: 11.5, weight: .light))
                    .foregroundStyle(settingsText)
                Text("⌘ K")
                    .font(.system(size: 10, weight: .medium, design: .monospaced))
                    .foregroundStyle(OpenDesignDayColor.mutedDeep)
            }
            .padding(.horizontal, 10)
            .frame(height: 42)
            .background(settingsRounded(fill: OpenDesignDayColor.surface, stroke: settingsHairline, radius: 6))
            .padding(.horizontal, 8)
            .padding(.bottom, 6)

            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    if returnToWorkspace != nil {
                        settingsDesignBackButton
                            .padding(.horizontal, 6)
                            .padding(.bottom, 8)
                    }

                    let groups = settingsNavigationGroups
                    ForEach(groups.indices, id: \.self) { index in
                        let group = groups[index]
                        HStack {
                            Text(group.title)
                            Spacer()
                        }
                        .font(.system(size: 10, weight: .medium, design: .monospaced))
                        .textCase(.uppercase)
                        .tracking(1)
                        .foregroundStyle(OpenDesignDayColor.mutedDeep)
                        .padding(.top, index == 0 && returnToWorkspace == nil ? 13 : 14)
                        .padding(.horizontal, 8)
                        .padding(.bottom, 6)

                        ForEach(group.sections) { section in
                            settingsDesignSidebarRow(section)
                        }
                    }
                }
                .padding(.horizontal, 6)
                .padding(.bottom, 14)
            }
        }
        .background(settingsBackground)
        .overlay(Rectangle().fill(settingsText.opacity(0.08)).frame(width: 1), alignment: .trailing)
        .accessibilityIdentifier("settings.designSidebar")
    }

    private var settingsDesignBackButton: some View {
        Button {
            returnToWorkspace?()
        } label: {
            HStack(spacing: 10) {
                Image(systemName: "arrow.left")
                    .font(.system(size: 13, weight: .semibold))
                    .frame(width: 22)
                Text("앱으로 돌아가기")
                    .font(.system(size: 12.2, weight: .medium))
                    .lineLimit(1)
                Spacer(minLength: 0)
            }
            .foregroundStyle(settingsText.opacity(0.66))
            .padding(.horizontal, 10)
            .frame(height: 34)
            .background(settingsRounded(fill: settingsText.opacity(0.0), stroke: Color.clear, radius: 7))
            .contentShape(RoundedRectangle(cornerRadius: 7, style: .continuous))
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("workspace.settingsBackButton")
    }

    private var settingsNavigationGroups: [(title: String, sections: [SettingsSection])] {
        let query = settingsSearchQuery.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty else { return settingsAllNavigationGroups }
        return settingsAllNavigationGroups.compactMap { group in
            let sections = group.sections.filter { section in
                section.sidebarTitle.localizedCaseInsensitiveContains(query)
                    || section.title.localizedCaseInsensitiveContains(query)
                    || section.accessibilityIdentifier.localizedCaseInsensitiveContains(query)
            }
            guard !sections.isEmpty else { return nil }
            return (group.title, sections)
        }
    }

    private var settingsAllNavigationGroups: [(title: String, sections: [SettingsSection])] {
        [
            ("General", [.appearance, .workspace, .menubar]),
            ("Agent", [.providers, .integrations]),
            ("Trust", [.privacy, .updates, .advanced]),
        ]
    }

    private func settingsDesignSidebarRow(_ section: SettingsSection) -> some View {
        let isActive = section == selectedSection.wrappedValue
        let isHovered = hoveredSettingsSection == section
        return Button {
            selectedSection.wrappedValue = section
        } label: {
            HStack(spacing: 10) {
                Image(systemName: section.systemImage)
                    .font(.system(size: 12.2, weight: .regular))
                    .symbolRenderingMode(.monochrome)
                    .foregroundStyle(isActive ? settingsSidebarTone(section) : OpenDesignDayColor.muted)
                    .frame(width: 22, height: 22)

                Text(section.sidebarTitle)
                    .font(.system(size: 12.5, weight: .light))
                    .foregroundStyle(isActive || isHovered ? OpenDesignDayColor.fg : OpenDesignDayColor.fgSecondary)
                    .lineLimit(1)
                    .layoutPriority(1)
                    .fixedSize(horizontal: true, vertical: false)

                Spacer(minLength: 6)
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 5.5)
            .background(
                settingsRounded(
                    fill: isActive ? OpenDesignDayColor.selected : isHovered ? OpenDesignDayColor.hover : Color.clear,
                    stroke: Color.clear,
                    radius: 6
                )
            )
            .contentShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
        }
        .buttonStyle(.plain)
        .onHover { hovering in
            hoveredSettingsSection = hovering ? section : (hoveredSettingsSection == section ? nil : hoveredSettingsSection)
        }
        .accessibilityIdentifier("settings.section.\(section.accessibilityIdentifier)")
    }

    private func settingsDesignHeader(showsCompactNavigation: Bool) -> some View {
        HStack(spacing: 12) {
            HStack(spacing: 14) {
                Image(systemName: "gearshape")
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(settingsAccentColor)
                    .frame(width: 44, height: 44)
                    .background(settingsRounded(fill: OpenDesignDayColor.accentDim, stroke: OpenDesignDayColor.accentLine, radius: 11))

                VStack(alignment: .leading, spacing: 3) {
                    Text("설정")
                        .font(.system(size: 17, weight: .semibold))
                        .foregroundStyle(settingsText.opacity(0.96))
                        .lineLimit(1)

                    HStack(spacing: 8) {
                        Circle()
                            .fill(settingsAccentColor)
                            .frame(width: 5, height: 5)
                            .shadow(color: settingsAccentColor.opacity(0.24), radius: 3)
                        Text("Agentic30 · 로컬 우선")
                        Text("·")
                            .foregroundStyle(settingsText.opacity(0.22))
                        Text(settingsUserLabel)
                        Text("·")
                            .foregroundStyle(settingsText.opacity(0.22))
                        Text(settingsSaveMessage.isEmpty ? "변경 사항 자동 저장" : settingsSaveMessage)
                    }
                    .font(.system(size: 11, weight: .medium, design: .monospaced))
                    .foregroundStyle(settingsText.opacity(0.44))
                    .lineLimit(1)
                }
                .frame(minWidth: 0, alignment: .leading)
            }

            Spacer(minLength: 12)

            if showsCompactNavigation {
                Menu {
                    ForEach(SettingsSection.allCases) { section in
                        Button(section.sidebarTitle) {
                            selectedSection.wrappedValue = section
                        }
                    }
                } label: {
                    Image(systemName: "sidebar.left")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(settingsText.opacity(0.74))
                        .frame(width: 28, height: 28)
                        .background(settingsRounded(fill: settingsText.opacity(0.055), stroke: settingsText.opacity(0.08), radius: 7))
                }
                .menuStyle(.button)
                .buttonStyle(.plain)
                .help("설정 섹션")
            }

            Button(action: loadAllValues) {
                Label("기본값으로", systemImage: "trash")
                    .font(.system(size: 11.5, weight: .medium))
                    .foregroundStyle(settingsText.opacity(0.74))
                    .padding(.horizontal, 12)
                    .frame(height: 28)
                    .background(settingsRounded(fill: Color.clear, stroke: settingsText.opacity(0.08), radius: 8))
            }
            .buttonStyle(.plain)

            Button(action: saveAllSettingsValues) {
                Label(settingsSaveMessage.isEmpty ? "모두 저장됨" : settingsSaveMessage, systemImage: "checkmark")
                    .font(.system(size: 11.5, weight: .semibold))
                    .foregroundStyle(Color(red: 0.08, green: 0.12, blue: 0.11))
                    .padding(.horizontal, 14)
                    .frame(height: 28)
                    .background(
                        RoundedRectangle(cornerRadius: 8, style: .continuous)
                            .fill(settingsAccentColor)
                    )
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("settings.saveButton")
        }
        .padding(.horizontal, 28)
        .frame(height: 70)
        .background(settingsBackground)
        .overlay(Rectangle().fill(settingsText.opacity(0.08)).frame(height: 1), alignment: .bottom)
    }

    private var settingsMetaPanel: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                Text("시스템 상태")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(settingsText.opacity(0.94))

                settingsMetaCard(label: "실행 보조 앱", isLive: viewModel.isConnected) {
                    settingsMetaRow("상태", viewModel.isConnected ? "실행 중" : "연결 대기")
                    settingsMetaRow("런타임", viewModel.sidecarDiagnostics?.runtime.node ?? "unknown")
                    settingsMetaRow("세션", "\(viewModel.sessions.count)건")
                    settingsMetaRow("Preflight", viewModel.sidecarDiagnostics?.preflight?.status ?? "unknown")
                }

                settingsMetaCard(label: "워크스페이스", isLive: WorkspaceSettings.hasExplicitWorkspace) {
                    settingsMetaRow("workspace", shortPath(workspaceRootPath))
                }

                Text("빠른 작업")
                    .font(.system(size: 10.5, weight: .medium, design: .monospaced))
                    .textCase(.uppercase)
                    .foregroundStyle(settingsText.opacity(0.34))
                    .padding(.top, 2)

                settingsMetaAction(title: "진단 스냅샷 내보내기", subtitle: "sanitize · copy", systemImage: "square.and.arrow.down", action: copyDiagnostics)
                settingsMetaAction(title: "실행 보조 앱 진단 새로고침", subtitle: "사전 점검 · 런타임", systemImage: "arrow.clockwise", action: refreshDiagnostics)

                Text("버전")
                    .font(.system(size: 10.5, weight: .medium, design: .monospaced))
                    .textCase(.uppercase)
                    .foregroundStyle(settingsText.opacity(0.34))
                    .padding(.top, 2)

                Text(settingsVersionSummary)
                    .font(.system(size: 11, weight: .medium, design: .monospaced))
                    .foregroundStyle(settingsText.opacity(0.46))
                    .lineSpacing(4)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 6)
                    .padding(.bottom, 4)
            }
            .padding(16)
        }
        .background(settingsBackground)
        .overlay(Rectangle().fill(settingsText.opacity(0.08)).frame(width: 1), alignment: .leading)
        .accessibilityIdentifier("settings.metaPanel")
    }

    private func settingsMetaCard<Content: View>(
        label: String,
        isLive: Bool,
        @ViewBuilder content: () -> Content
    ) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                Circle()
                    .fill(isLive ? settingsAccentColor : settingsText.opacity(0.28))
                    .frame(width: 6, height: 6)
                    .shadow(color: isLive ? settingsAccentColor.opacity(0.24) : .clear, radius: 3)
                Text(label)
                    .font(.system(size: 10.5, weight: .medium, design: .monospaced))
                    .textCase(.uppercase)
                    .foregroundStyle(settingsText.opacity(0.42))
            }
            content()
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(settingsRounded(fill: settingsText.opacity(0.055), stroke: settingsText.opacity(0.08), radius: 10))
    }

    private func settingsMetaRow(_ key: String, _ value: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Text(key)
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(settingsText.opacity(0.42))
            Spacer(minLength: 0)
            Text(value)
                .font(.system(size: 11, weight: .medium, design: .monospaced))
                .foregroundStyle(settingsText.opacity(0.74))
                .lineLimit(1)
                .truncationMode(.middle)
        }
    }

    private func settingsMetaAction(
        title: String,
        subtitle: String,
        systemImage: String,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            HStack(spacing: 10) {
                Image(systemName: systemImage)
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(settingsAccentColor)
                    .frame(width: 26, height: 26)
                    .background(settingsRounded(fill: settingsAccentColor.opacity(0.10), stroke: settingsAccentColor.opacity(0.18), radius: 7))

                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(settingsText.opacity(0.84))
                        .lineLimit(1)
                    Text(subtitle)
                        .font(.system(size: 10.5, weight: .medium, design: .monospaced))
                        .foregroundStyle(settingsText.opacity(0.38))
                        .lineLimit(1)
                }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 8)
            .background(settingsRounded(fill: settingsText.opacity(0.035), stroke: Color.clear, radius: 8))
        }
        .buttonStyle(.plain)
    }

    private func settingsSidebarTone(_ section: SettingsSection) -> Color {
        settingsAccentColor
    }

    private func settingsRounded(fill: Color, stroke: Color, radius: CGFloat) -> some View {
        RoundedRectangle(cornerRadius: radius, style: .continuous)
            .fill(fill)
            .overlay(
                RoundedRectangle(cornerRadius: radius, style: .continuous)
                    .stroke(stroke, lineWidth: 1)
            )
    }

    private func shortPath(_ path: String) -> String {
        let trimmed = path.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return "미설정" }
        return (trimmed as NSString).abbreviatingWithTildeInPath
    }

    private var settingsVersionSummary: String {
        let info = Bundle.main.infoDictionary
        let version = info?["CFBundleShortVersionString"] as? String ?? "dev"
        let build = info?["CFBundleVersion"] as? String ?? "local"
        return """
        app · \(version) (\(build))
        helper · \(viewModel.sidecarDiagnostics?.preflight?.status ?? "unknown")
        node · \(viewModel.sidecarDiagnostics?.runtime.node ?? "unknown")
        """
    }

    private var settingsUserLabel: String {
        let email = viewModel.signedInEmail?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return email.isEmpty ? selectedSection.wrappedValue.sidebarTitle : email
    }

    private var settingsBackground: Color {
        OpenDesignDayColor.bg
    }

    private var settingsText: Color {
        OpenDesignDayColor.fg
    }

    private var settingsSecondaryText: Color {
        OpenDesignDayColor.fgSecondary
    }

    private var settingsSubtleText: Color {
        OpenDesignDayColor.muted
    }

    private var settingsHairline: Color {
        OpenDesignDayColor.borderSoft
    }

    @ViewBuilder
    private var selectedSettingsSection: some View {
        openDesignSettingsMain
    }

    private var openDesignSettingsMain: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    odAppearanceSection
                    odWorkspaceSection
                    odMenuBarSection
                    odProvidersSection
                    odIntegrationsSection
                    odPrivacySection
                    odUpdatesSection
                    odAdvancedSection

                    Color.clear.frame(height: 40)
                }
                .frame(maxWidth: 820, alignment: .leading)
                .padding(.horizontal, 28)
                .padding(.top, 22)
                .padding(.bottom, 60)
                .frame(maxWidth: .infinity)
            }
            .accessibilityIdentifier("settings.contentScroll")
            .accessibilityLabel("OpenDesign Settings Main")
            .background(settingsTabBackground)
            .onAppear {
                scrollToSelectedSettingsSection(proxy, animated: false)
            }
            .onChange(of: selectedSection.wrappedValue) { _, _ in
                scrollToSelectedSettingsSection(proxy, animated: true)
            }
        }
        .accessibilityIdentifier("opendesign.reference.settings.main")
    }

    private func scrollToSelectedSettingsSection(_ proxy: ScrollViewProxy, animated: Bool) {
        let action = {
            proxy.scrollTo(openDesignAnchor(for: selectedSection.wrappedValue), anchor: .top)
        }
        if animated {
            withAnimation(.easeInOut(duration: 0.22), action)
        } else {
            action()
        }
    }

    private func openDesignAnchor(for section: SettingsSection) -> String {
        switch section {
        case .workspace:
            return "workspace"
        case .appearance:
            return "appearance"
        case .menubar:
            return "menubar"
        case .providers:
            return "providers"
        case .integrations:
            return "integrations"
        case .updates:
            return "updates"
        case .privacy:
            return "privacy"
        case .advanced:
            return "advanced"
        }
    }

    private var odWorkspaceSection: some View {
        odSettingsSection(id: "workspace", title: "워크스페이스") {
            odSettingsRowsCard {
                odSettingsRow(title: "메인 프로젝트", detail: "맞춤형 엔진이 가장 먼저 읽는 폴더. SPEC.md / ICP.md / VALUES.md와 업무 일지가 여기에 누적됩니다.", stacked: true) {
                    odSettingsPathRow(text: workspacePathDisplay, systemImage: "folder", prefix: workspacePathPrefix, emphasizedTail: workspacePathTail, isStale: false) {
                        pickFolder()
                    }
                }
            }
        }
    }

    private var odAppearanceSection: some View {
        odSettingsSection(id: "appearance", title: "외관", isFirst: true) {
            odSettingsRowsCard {
                odSettingsRow(title: "테마", detail: "Dark 또는 Light 테마를 즉시 적용합니다.") {
                    odSettingsSegmented(values: ["Dark", "Light"], selection: $settingsThemeChoice) { value in
                        let normalized = value.lowercased()
                        settingsThemeChoice = normalized
                        appThemeRawValue = normalized == "dark" ? Agentic30Theme.dark.rawValue : Agentic30Theme.white.rawValue
                        Agentic30Theme.normalized(appThemeRawValue).applyAppKitAppearance()
                    }
                }
            }
        }
    }

    private var odMenuBarSection: some View {
        odSettingsSection(id: "menubar", title: "메뉴바 & 알림") {
            odSettingsRowsCard {
                odSettingsRow(title: "로그인 시 자동 실행", detail: "macOS 로그인 항목에 추가합니다. Launch Agent — com.octobacademy.agentic30.plist.") {
                    odSettingsToggle(isOn: Binding(get: { loginItemsManager.isEnabled }, set: { loginItemsManager.setEnabled($0) }))
                        .accessibilityIdentifier("settings.menubar.launchAtLogin.toggle")
                }
            }
        }
    }

    private var odProvidersSection: some View {
            odSettingsSection(id: "providers", title: "AI 연결") {
            odProviderCard(provider: .claude, authMode: $claudeAuthMode, apiKey: $claudeApiKey, environment: $claudeEnvironment, modelSelection: $claudeModelID)
            odProviderCard(provider: .codex, authMode: $codexAuthMode, apiKey: $codexApiKey, environment: $codexEnvironment, modelSelection: $codexModelID)
            odProviderCard(provider: .gemini, authMode: $geminiAuthMode, apiKey: $geminiApiKey, environment: $geminiEnvironment, modelSelection: $geminiModelID)

            odNodeRuntimeCard
        }
    }

    private var odNodeRuntimeCard: some View {
        let runtime = viewModel.sidecarDiagnostics?.runtime
        let node = runtime?.node?.trimmingCharacters(in: .whitespacesAndNewlines)
        let nodeText = (node?.isEmpty == false ? node : nil) ?? "unknown"
        let badge = nodeMajorVersion(nodeText).map { $0 >= 20 ? "20+" : "확인 필요" } ?? "unknown"
        let badgeColor = nodeMajorVersion(nodeText).map { $0 >= 20 ? settingsAccentColor : OpenDesignDayColor.amber } ?? settingsSubtleText

        return VStack(spacing: 0) {
            HStack(alignment: .center, spacing: 14) {
                Image("BrandNodejs")
                    .resizable()
                    .interpolation(.high)
                    .scaledToFit()
                    .padding(7)
                    .frame(width: 36, height: 36)
                    .background(settingsRounded(fill: OpenDesignDayColor.surface2, stroke: settingsHairline, radius: 8))
                    .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                    .accessibilityLabel(Text("Node.js"))

                VStack(alignment: .leading, spacing: 2) {
                    Text("Node 런타임")
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(settingsText)
                    Text("실행 보조 앱 바이너리 · NODE_BINARY → 일반 설치 → mise/asdf/Volta → 로그인 셸 PATH")
                        .font(.system(size: 12, weight: .medium, design: .monospaced))
                        .foregroundStyle(settingsSubtleText)
                        .lineLimit(1)
                }

                Spacer(minLength: 10)

                odSettingsStatus(badge, color: badgeColor)
            }
            .padding(.horizontal, 18)
            .padding(.vertical, 16)
            .background(OpenDesignDayColor.surface)
            .overlay(Rectangle().fill(settingsHairline).frame(height: 1), alignment: .bottom)

            odProviderGridRow(label: "바이너리") {
                Text(nodeText)
                    .font(.system(size: 14, weight: .medium, design: .monospaced))
                    .foregroundStyle(settingsText)
                    .lineLimit(1)
                    .truncationMode(.middle)
                    .textSelection(.enabled)
            }

            odProviderGridRow(label: "프로세스") {
                Text("PID \(runtime?.pid.map(String.init) ?? "--") · \(runtime?.platform ?? "unknown") · \(runtime?.arch ?? "unknown")")
                    .font(.system(size: 12, weight: .regular, design: .monospaced))
                    .foregroundStyle(settingsSubtleText)
                    .lineLimit(1)
            }
        }
        .background(settingsRounded(fill: OpenDesignDayColor.bgDarker, stroke: settingsHairline, radius: 12))
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .accessibilityIdentifier("settings.nodeRuntime.card")
    }

    private func nodeMajorVersion(_ node: String) -> Int? {
        let digits = node
            .drop(while: { !$0.isNumber })
            .prefix(while: { $0.isNumber })
        return Int(digits)
    }

    private var odIntegrationsSection: some View {
        odSettingsSection(id: "integrations", title: "연동") {
            odSettingsRowsCard {
                odSettingsRow(title: "GitHub", detail: githubCliDetailText, iconName: "BrandGitHub") {
                    HStack(spacing: 8) {
                        odSettingsStatus(githubCliStatusLabel, color: githubCliStatusColor)
                        odSettingsGhostButton(
                            title: "상태 확인",
                            systemImage: "arrow.clockwise",
                            width: 88,
                            identifier: "settings.github.refreshStatusButton",
                            isDisabled: viewModel.githubCliAuthStatus.state == .checking
                        ) {
                            viewModel.refreshGitHubCliStatus()
                        }
                        odSettingsGhostButton(
                            title: githubCliActionTitle,
                            systemImage: "terminal",
                            width: 92,
                            identifier: "settings.github.openAuthButton"
                        ) {
                            beginGitHubCliAuth()
                        }
                    }
                }
                odSettingsRow(title: "Notion", detail: "SPEC.md / ICP.md / VALUES.md 변경분을 지정한 페이지로 양방향 동기화.", iconName: "BrandNotion") {
                    HStack(spacing: 8) {
                        odSettingsStatus(viewModel.notionConnected ? "연결됨" : "연결 안 됨", color: viewModel.notionConnected ? settingsAccentColor : settingsSubtleText)
                        odSettingsGhostButton(title: viewModel.notionConnected ? "해제" : "OAuth 연결", width: 96) {
                            if viewModel.notionConnected {
                                viewModel.disconnectNotion()
                            } else {
                                viewModel.startNotionOAuth()
                            }
                        }
                    }
                }
                odSettingsRow(title: "Cloudflare", detail: "Cloudflare MCP 연동입니다. Workers, R2, DNS 같은 Cloudflare API 도구를 AI 실행에서 사용할 때 씁니다.", iconName: "BrandCloudflare", stacked: true) {
                    VStack(alignment: .leading, spacing: 10) {
                        HStack(spacing: 8) {
                            odSettingsStatus(cloudflareMcpStatusLabel, color: cloudflareMcpStatusColor)
                            Text("Codemode")
                                .font(.system(size: 11.5, weight: .medium))
                                .foregroundStyle(settingsSubtleText)
                            odSettingsToggle(isOn: $cloudflareMcpCodemode)
                        }
                        secureAgentField(label: "CLOUDFLARE_API_TOKEN", placeholder: "Cloudflare API token", text: $cloudflareApiToken, identifier: "settings.cloudflare.apiTokenField")
                        plainAgentField(label: "CLOUDFLARE_MCP_URL", placeholder: KeychainHelper.Settings.defaultCloudflareMcpURL, text: $cloudflareMcpURL, identifier: "settings.cloudflare.mcpUrlField")
                    }
                }
                odSettingsRow(title: "Exa Research", detail: "뉴스·시장 리서치 예비 키입니다. AI 프로바이더의 웹 검색 도구가 없을 때만 사용합니다.", iconName: "BrandExa", stacked: true) {
                    secureAgentField(label: "EXA_API_KEY", placeholder: "exa_...", text: $exaApiKey, identifier: "settings.exa.apiKeyField")
                }
                odSettingsRow(title: "PostHog", detail: "PostHog MCP 연동입니다. phx_ 또는 pha_ personal API key로 HogQL, insights, web analytics 도구를 읽습니다.", iconName: "BrandPostHog", stacked: true) {
                    VStack(alignment: .leading, spacing: 10) {
                        HStack(spacing: 8) {
                            odSettingsStatus(posthogMcpStatusLabel, color: posthogMcpStatusColor)
                            odSettingsSegmented(values: ["US", "EU"], selection: posthogMcpRegionSelection)
                            Text("Readonly")
                                .font(.system(size: 11.5, weight: .medium))
                                .foregroundStyle(settingsSubtleText)
                            odSettingsToggle(isOn: $posthogMcpReadonly)
                        }
                        secureAgentField(label: "POSTHOG_MCP_API_KEY", placeholder: "phx_... 또는 pha_...", text: $posthogApiKey, identifier: "settings.posthog.apiKeyField")
                        plainAgentField(label: "POSTHOG_PROJECT_API_KEY", placeholder: "phc_... (선택)", text: $posthogProjectAPIKey, identifier: "settings.posthog.projectApiKeyField")
                        plainAgentField(label: "POSTHOG_HOST", placeholder: "https://us.posthog.com", text: $posthogHost, identifier: "settings.posthog.hostField")
                        plainAgentField(label: "POSTHOG_MCP_URL", placeholder: KeychainHelper.Settings.defaultPostHogMcpURL, text: $posthogMcpURL, identifier: "settings.posthog.mcpUrlField")
                        plainAgentField(label: "POSTHOG_MCP_FEATURES", placeholder: KeychainHelper.Settings.defaultPostHogMcpFeatures, text: $posthogMcpFeatures, identifier: "settings.posthog.mcpFeaturesField")
                    }
                }
            }
        }
    }

    private var githubCliStatusLabel: String {
        switch viewModel.githubCliAuthStatus.state {
        case .unknown:
            return "확인 전"
        case .checking:
            return "확인 중"
        case .connected:
            return "연결됨"
        case .disconnected:
            return "로그인 필요"
        case .missing:
            return "gh 없음"
        }
    }

    private var githubCliStatusColor: Color {
        switch viewModel.githubCliAuthStatus.state {
        case .connected:
            return settingsAccentColor
        case .disconnected, .missing:
            return OpenDesignDayColor.amber
        case .unknown, .checking:
            return settingsSubtleText
        }
    }

    private var githubCliActionTitle: String {
        switch viewModel.githubCliAuthStatus.state {
        case .connected:
            return "다시 로그인"
        case .missing:
            return "설치"
        default:
            return "gh 로그인"
        }
    }

    private var githubCliDetailText: String {
        let detail = viewModel.githubCliAuthStatus.detail.trimmingCharacters(in: .whitespacesAndNewlines)
        return detail.isEmpty
            ? "gh CLI 인증으로 PR / 이슈 / 릴리즈 활동을 읽어 History에 반영합니다."
            : detail
    }

    private var cloudflareMcpStatusLabel: String {
        cloudflareApiToken.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            ? "토큰 없음"
            : "토큰 설정됨"
    }

    private var cloudflareMcpStatusColor: Color {
        cloudflareApiToken.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            ? settingsSubtleText
            : settingsAccentColor
    }

    private var posthogMcpStatusLabel: String {
        let apiKey = posthogApiKey.trimmingCharacters(in: .whitespacesAndNewlines)
        if isValidPostHogMcpAPIKey(apiKey) {
            return "MCP 설정됨"
        }
        if apiKey.hasPrefix("phc_") {
            return "Personal key 필요"
        }
        let projectKey = posthogProjectAPIKey.trimmingCharacters(in: .whitespacesAndNewlines)
        if projectKey.hasPrefix("phc_") {
            return "Project key만"
        }
        return "미설정"
    }

    private var posthogMcpStatusColor: Color {
        let apiKey = posthogApiKey.trimmingCharacters(in: .whitespacesAndNewlines)
        if isValidPostHogMcpAPIKey(apiKey) {
            return settingsAccentColor
        }
        if apiKey.hasPrefix("phc_")
            || posthogProjectAPIKey.trimmingCharacters(in: .whitespacesAndNewlines).hasPrefix("phc_") {
            return OpenDesignDayColor.amber
        }
        return settingsSubtleText
    }

    private var posthogMcpRegionSelection: Binding<String> {
        Binding(
            get: { posthogMcpRegion == "eu" ? "EU" : "US" },
            set: { updatePostHogMcpRegion($0) }
        )
    }

    private func updatePostHogMcpRegion(_ value: String) {
        let previousRegion = posthogMcpRegion
        let previousDefaultURL = posthogDefaultMcpURL(for: previousRegion)
        let nextRegion = value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() == "eu" ? "eu" : "us"
        posthogMcpRegion = nextRegion
        let currentURL = posthogMcpURL.trimmingCharacters(in: .whitespacesAndNewlines)
        if currentURL.isEmpty
            || currentURL == previousDefaultURL
            || currentURL == KeychainHelper.Settings.defaultPostHogMcpURL
            || currentURL == KeychainHelper.Settings.defaultPostHogEuMcpURL {
            posthogMcpURL = posthogDefaultMcpURL(for: nextRegion)
        }
    }

    private func posthogDefaultMcpURL(for region: String) -> String {
        region.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() == "eu"
            ? KeychainHelper.Settings.defaultPostHogEuMcpURL
            : KeychainHelper.Settings.defaultPostHogMcpURL
    }

    private func isValidPostHogMcpAPIKey(_ value: String) -> Bool {
        value.hasPrefix("phx_") || value.hasPrefix("pha_")
    }

    private func beginGitHubCliAuth() {
        if viewModel.githubCliAuthStatus.state == .missing {
            Task { @MainActor in
                let brewAvailable = await Task.detached(priority: .userInitiated) {
                    AgenticViewModel.detectBrewAvailable()
                }.value
                presentGitHubCliMissingAlert(brewAvailable: brewAvailable)
            }
            return
        }
        viewModel.openGitHubCliLoginInTerminal()
    }

    private var odPrivacySection: some View {
        odSettingsSection(id: "privacy", title: "개인정보 & 진단") {
            odSettingsRowsCard {
                odSettingsRow(title: "사용량 텔레메트리 (PostHog)", detail: "앱 열기 횟수, Day 도달 일자, 작업 완료/포기 같은 익명 이벤트. opt-in이며 KR1.1 ~ KR4.3 측정에만 쓰입니다.") {
                    odSettingsToggle(isOn: telemetryEnabledBinding)
                }
                odSettingsRow(title: "진단 스냅샷 내보내기", detail: "제출 전 미리보기 — sanitized runtime snapshot을 클립보드로 복사합니다.") {
                    odSettingsGhostButton(title: "내보내기…", systemImage: "square.and.arrow.down", width: 112, action: copyDiagnostics)
                }
                odSettingsRow(title: "모든 로컬 데이터 삭제", detail: "sessions, day-task 히스토리, 캐시. 기록 폴더 자체는 건드리지 않습니다.") {
                    Button("데이터 초기화…") {
                        localDataConfirmation = .reset
                    }
                    .buttonStyle(.plain)
                    .font(.system(size: 11.5, weight: .medium))
                    .foregroundStyle(OpenDesignDayColor.rose)
                    .padding(.horizontal, 12)
                    .frame(height: 28)
                    .background(settingsRounded(fill: OpenDesignDayColor.roseDim, stroke: OpenDesignDayColor.rose.opacity(0.35), radius: 8))
                    .accessibilityIdentifier("settings.privacy.resetLocalDataButton")
                }
            }
        }
    }

    private var odUpdatesSection: some View {
        let updateState = viewModel.appUpdateState
        return odSettingsSection(id: "updates", title: "업데이트") {
            odSettingsRowsCard {
                odSettingsRow(title: "현재 버전", detail: "Foundation preview — Day 0-3 loop 한정. Day 4-7은 다음 점 릴리즈 예정.") {
                    HStack(spacing: 8) {
                        odSettingsStatus(updateState.currentVersionSummary, color: settingsAccentColor)
                    }
                }
                odSettingsRow(title: "자동 업데이트", detail: "Sparkle이 백그라운드에서 appcast를 확인하고 새 버전을 받아옵니다. 설치는 다음 실행 때.") {
                    odSettingsToggle(isOn: .constant(updateState.automaticChecksEnabled), locked: true)
                }
                odSettingsRow(title: "마지막 확인", detail: "appcast.xml을 마지막으로 조회한 시각. \(updateState.lastResult.statusText). \(updateState.lastResult.detailText)") {
                    HStack(spacing: 8) {
                        Text(updateState.lastCheckSummary)
                            .font(.system(size: 11.5, weight: .medium, design: .monospaced))
                            .foregroundStyle(settingsSubtleText)
                        odSettingsGhostButton(
                            title: updateState.isSessionActive ? "진행 중" : "지금 확인",
                            systemImage: "arrow.clockwise",
                            width: 96,
                            identifier: "settings.updates.checkNowButton",
                            isDisabled: updateState.isSessionActive
                        ) {
                            NotificationCenter.default.post(name: .agenticCheckForUpdatesRequested, object: nil)
                        }
                    }
                }
                odSettingsRow(title: "서명 확인", detail: "notarization · Hardened Runtime · Developer ID · 모두 통과.") {
                    odSettingsStatus(updateState.configured ? "검증됨" : "대기", color: updateState.configured ? settingsAccentColor : OpenDesignDayColor.amber)
                }
            }
        }
    }

    private var odAdvancedSection: some View {
        odSettingsSection(id: "advanced", title: "고급 & 실행 보조 앱") {
            odSettingsRowsCard {
                odSettingsRow(title: "실행 보조 앱 상태", detail: viewModel.isConnected ? "Node 실행 보조 앱이 살아 있고 stdio + 로컬 HTTP 둘 다 응답 중입니다." : "Node 실행 보조 앱 연결을 기다리는 중입니다.") {
                    HStack(spacing: 8) {
                        odSettingsStatus(viewModel.isConnected ? "실행 중" : "연결 대기", color: viewModel.isConnected ? settingsAccentColor : OpenDesignDayColor.amber)
                        Text(sidecarRuntimeSummary)
                            .font(.system(size: 11, weight: .medium, design: .monospaced))
                            .foregroundStyle(settingsSubtleText)
                            .lineLimit(1)
                        odSettingsGhostButton(title: "새로고침", width: 72, action: refreshDiagnostics)
                    }
                }
                odSettingsRow(title: "로그 폴더", detail: "~/Library/Logs/Agentic30 — 회전 7개 보관.") {
                    odSettingsGhostButton(title: "Finder에서 열기", systemImage: "arrow.up.right.square", width: 126) {
                        let path = ("~/Library/Logs/Agentic30" as NSString).expandingTildeInPath
                        NSWorkspace.shared.open(URL(fileURLWithPath: path, isDirectory: true))
                    }
                }
            }

            odSettingsRowsCard {
                odSettingsRow(title: "공개 기록 알림", detail: "테스트 알림은 실제 macOS 알림 센터 경로를 사용합니다. 배너를 누르면 Agentic30이 열리고 공개 기록 알림 작업 화면으로 이동합니다.", stacked: true) {
                    HStack(spacing: 12) {
                        odSettingsGhostButton(title: "10시 알림 보내기", systemImage: "sun.max.fill", width: 128, identifier: "settings.advanced.sendMorningBipNotification") {
                            sendTestBipNotification(.morning)
                        }
                        odSettingsGhostButton(title: "21시 알림 보내기", systemImage: "moon.fill", width: 128, identifier: "settings.advanced.sendEveningBipNotification") {
                            sendTestBipNotification(.evening)
                        }
                    }
                    if !advancedToolsMessage.isEmpty {
                        Text(advancedToolsMessage)
                            .font(.system(size: 12, weight: .semibold, design: .rounded))
                            .foregroundStyle(Agentic30BrandColor.green.opacity(0.82))
                            .accessibilityIdentifier("settings.advanced.message")
                    }
                }
                odSettingsRow(title: "UI Motion Test", detail: "앱 화면 전체에 realistic confetti burst를 재생합니다.") {
                    odSettingsGhostButton(title: "Confetti 테스트", systemImage: "sparkles", width: 120, identifier: "settings.advanced.confettiTestButton") {
                        playConfettiTest()
                    }
                }
            }
        }
    }

    private func odSettingsSection<Content: View>(
        id: String,
        title: String,
        isFirst: Bool = false,
        @ViewBuilder content: () -> Content
    ) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 10) {
                RoundedRectangle(cornerRadius: 2, style: .continuous)
                    .fill(settingsAccentColor)
                    .frame(width: 4, height: 12)
                Text(title)
                    .font(.system(size: 11, weight: .medium, design: .monospaced))
                    .textCase(.uppercase)
                    .foregroundStyle(settingsSubtleText)
                Rectangle()
                    .fill(settingsHairline)
                    .frame(height: 1)
            }
            .padding(.top, isFirst ? 10 : 26)

            content()
        }
        .id(id)
    }

    private func odSettingsRowsCard<Content: View>(
        @ViewBuilder content: () -> Content
    ) -> some View {
        VStack(spacing: 0) {
            content()
        }
        .background(settingsRounded(fill: OpenDesignDayColor.surface, stroke: settingsHairline, radius: 12))
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    @ViewBuilder
    private func odSettingsRow<Trailing: View>(
        title: String,
        detail: String,
        iconName: String? = nil,
        stacked: Bool = false,
        @ViewBuilder trailing: () -> Trailing
    ) -> some View {
        if stacked {
            VStack(alignment: .leading, spacing: 10) {
                odSettingsRowHeader(title: title, detail: detail, iconName: iconName)
                trailing()
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .overlay(Rectangle().fill(settingsHairline).frame(height: 1), alignment: .bottom)
        } else {
            HStack(alignment: .center, spacing: 16) {
                odSettingsRowHeader(title: title, detail: detail, iconName: iconName)
                    .layoutPriority(1)

                Spacer(minLength: 12)

                trailing()
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .overlay(Rectangle().fill(settingsHairline).frame(height: 1), alignment: .bottom)
        }
    }

    private func odSettingsRowHeader(title: String, detail: String, iconName: String?) -> some View {
        HStack(alignment: .top, spacing: 10) {
            if let iconName {
                odSettingsBrandIcon(iconName, accessibilityLabel: title)
                    .padding(.top, 1)
            }

            odSettingsRowCopy(title: title, detail: detail)
        }
        .frame(minWidth: 0, alignment: .leading)
    }

    private func odSettingsBrandIcon(_ imageName: String, accessibilityLabel: String) -> some View {
        // Integration brand marks (BrandGitHub/Notion/Cloudflare/Exa/PostHog) ship as
        // transparent, dark-surface logomarks normalized to a uniform fill by
        // scripts/generate-provider-logos.sh. They render with the same inset as the
        // provider auth-card logos (odProviderLogo), so every chip sits identically in
        // its 36pt surface2 tile — no per-icon size table, no baked-in white plate.
        Image(imageName)
            .resizable()
            .interpolation(.high)
            .scaledToFit()
            .padding(7)
            .frame(width: 36, height: 36)
            .background(settingsRounded(fill: OpenDesignDayColor.surface2, stroke: settingsHairline, radius: 8))
            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
            .accessibilityLabel(Text(accessibilityLabel))
    }

    private func odSettingsRowCopy(title: String, detail: String) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(title)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(settingsText)
                .fixedSize(horizontal: false, vertical: true)
            Text(detail)
                .font(.system(size: 12, weight: .regular))
                .foregroundStyle(settingsSubtleText)
                .lineSpacing(2.5)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(minWidth: 0, alignment: .leading)
    }

    private var workspacePathDisplay: String {
        let root = workspaceRootPath.trimmingCharacters(in: .whitespacesAndNewlines)
        let fallback = viewModel.workspaceRoot.trimmingCharacters(in: .whitespacesAndNewlines)
        let path = root.isEmpty ? fallback : root
        return path.isEmpty ? "비어 있음" : (path as NSString).abbreviatingWithTildeInPath
    }

    private var workspacePathTail: String {
        let display = workspacePathDisplay
        guard display != "비어 있음" else { return display }
        return (display as NSString).lastPathComponent
    }

    private var workspacePathPrefix: String {
        let display = workspacePathDisplay
        guard display != "비어 있음" else { return "" }

        let directory = (display as NSString).deletingLastPathComponent
        guard directory != ".", directory != display else { return "" }
        return directory == "/" ? directory : "\(directory)/"
    }

    private func odSettingsPathRow(
        text: String,
        systemImage: String,
        prefix: String,
        emphasizedTail: String,
        isStale: Bool,
        action: @escaping () -> Void
    ) -> some View {
        HStack(spacing: 8) {
            odSettingsPathPill(text: text, systemImage: systemImage, prefix: prefix, emphasizedTail: emphasizedTail, isStale: isStale)
                .frame(maxWidth: .infinity, alignment: .leading)
                .layoutPriority(1)

            odSettingsPathChangeButton(action: action)
                .layoutPriority(0)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("settings.workspace.mainProject.pathRow")
    }

    private func odSettingsPathPill(
        text: String,
        systemImage: String,
        prefix: String,
        emphasizedTail: String,
        isStale: Bool
    ) -> some View {
        HStack(spacing: 7) {
            Image(systemName: systemImage)
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(isStale ? OpenDesignDayColor.amber : settingsSubtleText)
                .frame(width: 14)

            HStack(spacing: 0) {
                if !prefix.isEmpty {
                    Text(prefix)
                        .foregroundStyle(isStale ? OpenDesignDayColor.amber : settingsSecondaryText)
                        .lineLimit(1)
                        .truncationMode(.middle)
                        .layoutPriority(0)
                }

                Text(emphasizedTail)
                    .foregroundStyle(isStale ? OpenDesignDayColor.amber : settingsAccentColor)
                    .lineLimit(1)
                    .layoutPriority(1)
            }
            .font(.system(size: 11.5, weight: .medium, design: .monospaced))
            .frame(minWidth: 0, maxWidth: .infinity, alignment: .leading)
        }
        .padding(.horizontal, 10)
        .frame(minWidth: 0, maxWidth: .infinity, minHeight: 28, alignment: .leading)
        .background(settingsRounded(
            fill: isStale ? OpenDesignDayColor.amberDim : OpenDesignDayColor.bgDarker,
            stroke: isStale ? OpenDesignDayColor.amberLine : settingsHairline,
            radius: 7
        ))
        .contentShape(RoundedRectangle(cornerRadius: 7, style: .continuous))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(text)
        .accessibilityIdentifier("settings.workspace.mainProject.pathPill")
    }

    private func odSettingsPathChangeButton(action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text("변경…")
                .font(.system(size: 11.5, weight: .medium))
                .foregroundStyle(hoveredWorkspacePathChangeButton ? settingsText : settingsSecondaryText)
                .lineLimit(1)
                .padding(.horizontal, 12)
                .frame(height: 28)
                .background(settingsRounded(
                    fill: hoveredWorkspacePathChangeButton ? OpenDesignDayColor.hover : Color.clear,
                    stroke: hoveredWorkspacePathChangeButton ? OpenDesignDayColor.border : settingsHairline,
                    radius: 8
                ))
        }
        .buttonStyle(.plain)
        .fixedSize(horizontal: true, vertical: false)
        .onHover { hoveredWorkspacePathChangeButton = $0 }
        .accessibilityIdentifier("settings.workspace.mainProject.changeButton")
    }

    private func odSettingsToggle(
        isOn: Binding<Bool>,
        tone: Color? = nil,
        locked: Bool = false
    ) -> some View {
        let activeTone = tone ?? settingsAccentColor
        return Button {
            guard !locked else { return }
            withAnimation(.easeOut(duration: 0.14)) {
                isOn.wrappedValue.toggle()
            }
        } label: {
            ZStack(alignment: isOn.wrappedValue ? .trailing : .leading) {
                Capsule()
                    .fill(isOn.wrappedValue ? activeTone.opacity(0.24) : OpenDesignDayColor.bgDarker)
                    .overlay(Capsule().stroke(isOn.wrappedValue ? activeTone.opacity(0.46) : settingsHairline, lineWidth: 1))
                Circle()
                    .fill(isOn.wrappedValue ? activeTone : OpenDesignDayColor.mutedDeep)
                    .frame(width: 18, height: 18)
                    .padding(3)
                    .shadow(color: isOn.wrappedValue ? activeTone.opacity(0.24) : .clear, radius: 4)
                if locked {
                    Image(systemName: "lock.fill")
                        .font(.system(size: 7, weight: .bold))
                        .foregroundStyle(OpenDesignDayColor.bgDarker)
                        .frame(width: 18, height: 18)
                        .padding(3)
                        .frame(maxWidth: .infinity, alignment: isOn.wrappedValue ? .trailing : .leading)
                }
            }
            .frame(width: 42, height: 24)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(isOn.wrappedValue ? "켜짐" : "꺼짐")
    }

    private func odSettingsGhostButton(
        title: String,
        systemImage: String? = nil,
        width: CGFloat? = nil,
        identifier: String? = nil,
        isDisabled: Bool = false,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            HStack(spacing: 6) {
                if let systemImage {
                    Image(systemName: systemImage)
                        .font(.system(size: 10, weight: .semibold))
                }
                Text(title)
                    .lineLimit(1)
                    .minimumScaleFactor(0.82)
            }
            .font(.system(size: 11.5, weight: .medium))
            .foregroundStyle(settingsText.opacity(isDisabled ? 0.38 : 0.72))
            .padding(.horizontal, 10)
            .frame(width: width, height: 28)
            .background(settingsRounded(fill: Color.clear, stroke: settingsHairline.opacity(isDisabled ? 0.55 : 1), radius: 8))
        }
        .buttonStyle(.plain)
        .disabled(isDisabled)
        .accessibilityIdentifier(identifier ?? "")
    }

    private func odSettingsSegmented(
        values: [String],
        selection: Binding<String>,
        onSelect: ((String) -> Void)? = nil
    ) -> some View {
        HStack(spacing: 3) {
            ForEach(values, id: \.self) { value in
                let isActive = odSegment(value, matches: selection.wrappedValue)
                Button {
                    if let onSelect {
                        onSelect(value)
                    } else {
                        selection.wrappedValue = value
                    }
                } label: {
                    Text(value)
                        .font(.system(size: 11, weight: .medium, design: .monospaced))
                        .foregroundStyle(isActive ? settingsText : settingsSubtleText)
                        .lineLimit(1)
                        .minimumScaleFactor(0.78)
                        .padding(.horizontal, 9)
                        .frame(minHeight: 26)
                        .background(
                            RoundedRectangle(cornerRadius: 6, style: .continuous)
                                .fill(isActive ? OpenDesignDayColor.selected : Color.clear)
                        )
                }
                .buttonStyle(.plain)
            }
        }
        .padding(3)
        .background(settingsRounded(fill: OpenDesignDayColor.bgDarker, stroke: settingsHairline, radius: 8))
    }

    private func odSegment(_ value: String, matches selection: String) -> Bool {
        value.caseInsensitiveCompare(selection) == .orderedSame
            || value.lowercased() == selection.lowercased()
    }

    private func odSettingsNeutralPill(_ text: String, minWidth: CGFloat = 64) -> some View {
        Text(text)
            .font(.system(size: 11.5, weight: .medium, design: .monospaced))
            .foregroundStyle(settingsSubtleText)
            .lineLimit(1)
            .padding(.horizontal, 10)
            .frame(minWidth: minWidth, minHeight: 26)
            .background(Capsule().fill(OpenDesignDayColor.surface2))
            .overlay(Capsule().stroke(settingsHairline, lineWidth: 1))
    }

    private func odProviderCard(
        provider: AgentProvider,
        authMode: Binding<String>,
        apiKey: Binding<String>,
        environment: Binding<String>,
        modelSelection: Binding<String>
    ) -> some View {
        let mode = AgentAuthMode.normalized(authMode.wrappedValue, provider: provider)
        let status = providerEnvironment(for: provider)
        let statusStyle = providerStatusBadgeStyle(status)

        return VStack(spacing: 0) {
            HStack(alignment: .center, spacing: 14) {
                odProviderLogo(provider)

                VStack(alignment: .leading, spacing: 2) {
                    Text(odProviderDisplayTitle(provider))
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(settingsText)
                    Text(odProviderSubtitle(provider))
                        .font(.system(size: 12, weight: .medium, design: .monospaced))
                        .foregroundStyle(settingsSubtleText)
                        .lineLimit(1)
                    Text(providerSettingsTitle(provider))
                        .font(.system(size: 10.5, weight: .medium, design: .monospaced))
                        .foregroundStyle(settingsSubtleText.opacity(0.78))
                        .lineLimit(1)
                    Button {
                        authMode.wrappedValue = AgentAuthMode.apiKey.rawValue
                    } label: {
                        Text(apiKey.wrappedValue.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "\(apiKeyLabel(provider)) · 없음" : "\(apiKeyLabel(provider)) · Keychain")
                            .font(.system(size: 10.5, weight: .medium, design: .monospaced))
                            .foregroundStyle(settingsSubtleText.opacity(0.68))
                            .lineLimit(1)
                    }
                    .buttonStyle(.plain)
                }

                Spacer(minLength: 10)

                odSettingsStatus(statusStyle.label, color: statusStyle.dot)
            }
            .padding(.horizontal, 18)
            .padding(.vertical, 16)
            .background(OpenDesignDayColor.surface)
            .overlay(Rectangle().fill(settingsHairline).frame(height: 1), alignment: .bottom)

            VStack(spacing: 0) {
                odProviderGridRow(label: "인증") {
                    odProviderAuthRow(provider: provider, mode: mode, status: status)
                }

                odProviderGridRow(label: "선택") {
                    odProviderAuthSelectionRow(provider: provider, authMode: authMode)
                }

                if mode == .apiKey {
                    odProviderGridRow(label: "API 키 폴백", identifier: "settings.\(provider.rawValue).apiKeyField") {
                        odProviderApiFallbackRow(provider: provider, apiKey: apiKey)
                    }
                }

                if mode != .local && mode != .apiKey {
                    odProviderGridRow(label: "환경") {
                        environmentEditor(
                            label: environmentLabel(provider: provider, mode: mode),
                            text: environment,
                            identifier: "settings.\(provider.rawValue).environmentField"
                        )
                    }
                }

                odProviderGridRow(label: "모델") {
                    odProviderModelPicker(provider: provider, selection: modelSelection)
                }

                #if DEBUG
                if Self.isUITesting {
                    odProviderGridRow(label: "UI TEST") {
                        VStack(alignment: .leading, spacing: 8) {
                            authModeUITestingShortcuts(provider: provider, selection: authMode)
                            modelUITestingShortcuts(provider: provider, selection: modelSelection)
                        }
                    }
                }
                #endif

                HStack(spacing: 10) {
                    providerHelpLinks(provider)
                    Spacer(minLength: 0)
                }
                .padding(.horizontal, 18)
                .padding(.vertical, 12)
            }
        }
        .background(settingsRounded(fill: OpenDesignDayColor.bgDarker, stroke: settingsHairline, radius: 12))
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    private func odProviderLogo(_ provider: AgentProvider) -> some View {
        let fullBleed = provider.brandLogoIsFullBleed
        return Image(provider.brandImageName)
            .resizable()
            .interpolation(.high)
            .scaledToFit()
            .padding(fullBleed ? 0 : 7)
            .frame(width: 36, height: 36)
            .background(settingsRounded(
                fill: fullBleed ? Color.clear : OpenDesignDayColor.surface2,
                stroke: fullBleed ? Color.clear : settingsHairline,
                radius: 8))
            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
            .accessibilityLabel(Text(provider.title))
    }

    @ViewBuilder
    private func odProviderGridRow<Content: View>(
        label: String,
        identifier: String? = nil,
        @ViewBuilder content: () -> Content
    ) -> some View {
        let row = HStack(alignment: .top, spacing: 18) {
            Text(label)
                .font(.system(size: 12, weight: .medium, design: .monospaced))
                .foregroundStyle(settingsSubtleText)
                .frame(width: 88, alignment: .leading)
                .padding(.top, 3)

            content()
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.horizontal, 18)
        .padding(.vertical, 14)
        .overlay(Rectangle().fill(settingsHairline).frame(height: 1), alignment: .bottom)

        if let identifier {
            row.accessibilityIdentifier(identifier)
        } else {
            row
        }
    }

    private func odProviderDisplayTitle(_ provider: AgentProvider) -> String {
        provider.title
    }

    private func odProviderSubtitle(_ provider: AgentProvider) -> String {
        switch provider {
        case .claude:
            return "맞춤형 엔진 · 오늘 할 일 생성 · 대화 기록 분석"
        case .codex:
            return "대체 엔진 · /analyze-ads · 비싼 모델 회피 시 사용"
        case .gemini:
            return "장문 컨텍스트 · 리서치/멀티모달 폴백 · 도구 실행 검증"
        }
    }

    private func odProviderAuthRow(
        provider: AgentProvider,
        mode: AgentAuthMode,
        status: SidecarProviderEnvironment?
    ) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .center, spacing: 12) {
                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 8) {
                        Text(providerStatusDetail(status) ?? providerAuthFallbackText(provider, status: status))
                            .font(.system(size: 14, weight: .medium))
                            .foregroundStyle(settingsText)
                            .lineLimit(1)
                            .truncationMode(.tail)
                            .accessibilityIdentifier("settings.\(provider.rawValue).statusDetail")

                        if let source = status?.source, !source.isEmpty {
                            odSettingsNeutralPill(source, minWidth: 0)
                        }
                    }

                    Text(providerPolicyDescription(provider))
                        .font(.system(size: 11.5, weight: .regular))
                        .foregroundStyle(settingsSubtleText)
                        .lineLimit(1)
                }
                .frame(maxWidth: .infinity, alignment: .leading)

                Spacer(minLength: 12)

                if mode == .local {
                    odProviderAuthActionButton(provider: provider, connected: status?.available == true)
                }
            }

            if provider == .gemini, let diagnostic = providerEnvironment(for: .gemini)?.geminiAdc, diagnostic.isGcloudMissing {
                Text("Gemini API key를 쓰면 gcloud 설치 단계를 건너뛸 수 있습니다. aistudio.google.com/apikey")
                    .font(.system(size: 11.5, weight: .regular))
                    .foregroundStyle(OpenDesignDayColor.amber)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("settings.gemini.byokHint")
            }

            if viewModel.providerAuthInProgress == provider {
                HStack(spacing: 8) {
                    ProgressView()
                        .controlSize(.small)
                    Text(viewModel.providerAuthMessage ?? "Authenticating...")
                        .font(.system(size: 11.5, weight: .medium))
                        .foregroundStyle(settingsSubtleText)
                }
            }
        }
    }

    private func odProviderAuthSelectionRow(
        provider: AgentProvider,
        authMode: Binding<String>
    ) -> some View {
        HStack(alignment: .center, spacing: 10) {
            authModeMenu(provider: provider, selection: authMode)
                .frame(minWidth: 260, idealWidth: 360, maxWidth: 420, alignment: .leading)

            Spacer(minLength: 0)
        }
    }

    private func odProviderApiFallbackRow(
        provider: AgentProvider,
        apiKey: Binding<String>
    ) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .center, spacing: 10) {
                ForEach(odProviderApiKeyTokens(provider), id: \.self) { token in
                    odEnvironmentToken(token)
                }

                Text(apiKey.wrappedValue.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? providerApiKeyMissingText(provider) : "Keychain 설정됨")
                    .font(.system(size: 12, weight: .regular))
                    .foregroundStyle(settingsSubtleText)
                    .lineLimit(1)

                Spacer(minLength: 0)
            }

            secureAgentField(
                label: apiKeyLabel(provider),
                placeholder: apiKeyPlaceholder(provider),
                text: apiKey,
                identifier: "settings.\(provider.rawValue).apiKeyField"
            )
        }
    }

    private func odProviderModelPicker(
        provider: AgentProvider,
        selection: Binding<String>
    ) -> some View {
        HStack(alignment: .center, spacing: 10) {
            Menu {
                Section(providerFamilyLabel(provider)) {
                    ForEach(AgentModelCatalog.options(for: provider)) { option in
                        Button {
                            selection.wrappedValue = option.id
                        } label: {
                            HStack {
                                Text(option.label)
                                if option.id == selection.wrappedValue {
                                    Image(systemName: "checkmark")
                                }
                            }
                        }
                    }
                }
            } label: {
                HStack(spacing: 10) {
                    Text(AgentModelCatalog.label(for: selection.wrappedValue, provider: provider))
                        .font(.system(size: 14, weight: .medium, design: .monospaced))
                        .foregroundStyle(settingsText)
                        .lineLimit(1)
                        .truncationMode(.tail)

                    Spacer(minLength: 8)

                    Image(systemName: "chevron.down")
                        .font(.system(size: 10, weight: .bold))
                        .foregroundStyle(settingsSubtleText)
                }
                .padding(.horizontal, 14)
                .frame(width: 270, height: 34)
                .background(fieldBackground)
            }
            .menuStyle(.button)
            .buttonStyle(.plain)
            .accessibilityIdentifier("settings.\(provider.rawValue).modelPicker")

            Text("· \(providerModelHint(provider))")
                .font(.system(size: 12, weight: .regular))
                .foregroundStyle(settingsSubtleText)
                .lineLimit(1)

            Text(selection.wrappedValue)
                .font(.system(size: 11, weight: .medium, design: .monospaced))
                .foregroundStyle(OpenDesignDayColor.mutedDeep)
                .lineLimit(1)
                .accessibilityIdentifier("settings.\(provider.rawValue).modelID")
        }
    }

    private func odProviderAuthActionButton(provider: AgentProvider, connected: Bool) -> some View {
        Button {
            beginLocalProviderAuth(provider)
        } label: {
            Text(providerAuthActionTitle(provider, connected: connected))
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(connected ? settingsText.opacity(0.78) : OpenDesignDayColor.bgDeep)
                .padding(.horizontal, 14)
                .frame(height: 32)
                .background(
                    settingsRounded(
                        fill: connected ? Color.clear : settingsAccentColor,
                        stroke: connected ? settingsHairline : Color.clear,
                        radius: 9
                    )
                )
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("settings.\(provider.rawValue).openAuthButton")
    }

    private func beginLocalProviderAuth(_ provider: AgentProvider) {
        if provider == .gemini {
            Task { @MainActor in
                let opened = await viewModel.attemptOpenGeminiAdcLogin()
                if !opened {
                    let brewAvailable = await Task.detached(priority: .userInitiated) {
                        AgenticViewModel.detectBrewAvailable()
                    }.value
                    presentGcloudMissingAlert(brewAvailable: brewAvailable)
                }
            }
        } else {
            viewModel.startProviderLogin(provider)
        }
    }

    private func providerAuthActionTitle(_ provider: AgentProvider, connected: Bool) -> String {
        if provider == .gemini {
            return connected ? "ADC 다시 로그인" : "ADC 로그인"
        }
        return connected ? "다시 로그인" : "로그인"
    }

    private func providerAuthFallbackText(_ provider: AgentProvider, status: SidecarProviderEnvironment?) -> String {
        if status?.available == true {
            return "\(provider.title) 런타임 준비됨"
        }
        switch provider {
        case .claude:
            return "로컬 Claude Code 세션 · 발견 안 됨"
        case .codex:
            return "로컬 Codex 세션 · 발견 안 됨"
        case .gemini:
            return "Google AI Studio API 키 · 발견 안 됨"
        }
    }

    private func providerPolicyDescription(_ provider: AgentProvider) -> String {
        switch provider {
        case .claude:
            return "1순위 · 실패 시 Codex 예비 연결"
        case .codex:
            return "예비 연결 · 코드/분석 전용"
        case .gemini:
            return "대체 모델 · ADC 또는 API 키"
        }
    }

    private func odProviderApiKeyTokens(_ provider: AgentProvider) -> [String] {
        switch provider {
        case .claude:
            return ["ANTHROPIC_API_KEY"]
        case .codex:
            return ["OPENAI_API_KEY", "CODEX_API_KEY"]
        case .gemini:
            return ["GEMINI_API_KEY", "GOOGLE_API_KEY"]
        }
    }

    private func providerApiKeyMissingText(_ provider: AgentProvider) -> String {
        provider == .claude ? "환경변수 없음" : "둘 다 없음"
    }

    private func providerModelHint(_ provider: AgentProvider) -> String {
        switch provider {
        case .claude:
            return "adaptive thinking"
        case .codex:
            return "인증 후 선택 가능"
        case .gemini:
            return "인증 후 선택 가능"
        }
    }

    private func odEnvironmentToken(_ token: String) -> some View {
        Text(token)
            .font(.system(size: 12, weight: .medium, design: .monospaced))
            .foregroundStyle(settingsAccentColor)
            .lineLimit(1)
            .padding(.horizontal, 8)
            .frame(height: 24)
            .background(settingsRounded(fill: OpenDesignDayColor.surface2, stroke: settingsHairline, radius: 5))
    }

    @ViewBuilder
    private func providerHelpLinks(_ provider: AgentProvider) -> some View {
        if let quickstartURL = providerQuickstartURL(provider) {
            Link("Get started", destination: quickstartURL)
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(providerAccentColor(provider))
        }
        if let configURL = providerConfigURL(provider) {
            Link("Configure", destination: configURL)
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(settingsText.opacity(0.62))
        }
    }

    private func odSettingsStatus(_ text: String, color: Color) -> some View {
        HStack(spacing: 5) {
            Circle()
                .fill(color)
                .frame(width: 6, height: 6)
            Text(text)
                .lineLimit(1)
                .truncationMode(.middle)
        }
        .font(.system(size: 10, weight: .medium, design: .monospaced))
        .foregroundStyle(color)
        .padding(.horizontal, 8)
        .frame(height: 22)
        .background(Capsule().fill(color.opacity(0.12)))
        .overlay(Capsule().stroke(color.opacity(0.28), lineWidth: 1))
    }

    private var telemetryEnabledBinding: Binding<Bool> {
        Binding(
            get: { !telemetryDisabled },
            set: { setTelemetryEnabled($0) }
        )
    }

    private func setTelemetryEnabled(_ enabled: Bool) {
        let disabled = !enabled
        guard telemetryDisabled != disabled else { return }
        if disabled {
            PostHogTelemetry.captureBlocking(
                "mac_settings_telemetry_pref_changed",
                properties: ["disabled": true]
            )
            PostHogTelemetry.setTelemetryDisabledByUser(true)
            telemetryDisabled = true
        } else {
            PostHogTelemetry.setTelemetryDisabledByUser(false)
            telemetryDisabled = false
            PostHogTelemetry.capture(
                "mac_settings_telemetry_pref_changed",
                properties: ["disabled": false]
            )
        }
    }

    private var sidecarRuntimeSummary: String {
        guard let runtime = viewModel.sidecarDiagnostics?.runtime else {
            return "PID -- · node unknown"
        }
        let pid = runtime.pid.map(String.init) ?? "--"
        let arch = runtime.arch ?? "unknown"
        return "PID \(pid) · \(arch)"
    }

    private func localDataConfirmationDialog(_ confirmation: LocalDataConfirmation) -> some View {
        ZStack {
            Color.black.opacity(0.58)
                .ignoresSafeArea()
                .onTapGesture {
                    localDataConfirmation = nil
                }

            VStack(alignment: .leading, spacing: 16) {
                VStack(alignment: .leading, spacing: 8) {
                    Text(confirmation.title)
                        .font(.system(size: 18, weight: .bold, design: .rounded))
                        .foregroundStyle(settingsText.opacity(0.94))
                    Text(confirmation.message)
                        .font(.system(size: 12.5, weight: .medium, design: .rounded))
                        .foregroundStyle(settingsText.opacity(0.62))
                        .fixedSize(horizontal: false, vertical: true)
                }

                HStack(spacing: 10) {
                    Spacer(minLength: 0)
                    Button("Cancel") {
                        localDataConfirmation = nil
                    }
                    .buttonStyle(.plain)
                    .font(.system(size: 13, weight: .bold, design: .rounded))
                    .foregroundStyle(settingsText.opacity(0.84))
                    .padding(.horizontal, 14)
                    .frame(height: 34)
                    .background(Capsule().fill(settingsText.opacity(0.12)))

                    Button(confirmation.actionTitle) {
                        localDataConfirmation = nil
                        switch confirmation {
                        case .reset:
                            resetAgentic30LocalData()
                        case .uninstall:
                            uninstallAgentic30()
                        }
                    }
                    .buttonStyle(.plain)
                    .font(.system(size: 13, weight: .bold, design: .rounded))
                    .foregroundStyle(settingsText.opacity(0.92))
                    .padding(.horizontal, 14)
                    .frame(height: 34)
                    .background(Capsule().fill(Color.red.opacity(0.68)))
                }
            }
            .padding(20)
            .frame(width: 430)
            .background(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .fill(OpenDesignDayColor.elevated)
                    .overlay(
                        RoundedRectangle(cornerRadius: 14, style: .continuous)
                            .stroke(settingsHairline, lineWidth: 1)
                    )
            )
            .shadow(color: .black.opacity(0.42), radius: 22, x: 0, y: 14)
        }
        .zIndex(20)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("settings.privacy.localDataConfirmation")
    }

    private func providerAccentColor(_ provider: AgentProvider) -> Color {
        switch provider {
        case .claude:
            return OpenDesignDayColor.amber
        case .codex:
            return OpenDesignDayColor.accent
        case .gemini:
            return OpenDesignDayColor.sky
        }
    }

    private func providerSettingsTitle(_ provider: AgentProvider) -> String {
        switch provider {
        case .claude:
            return "Anthropic Claude Code"
        case .codex:
            return "OpenAI GPT Codex"
        case .gemini:
            return "Google Gemini"
        }
    }

    private func providerFamilyLabel(_ provider: AgentProvider) -> String {
        switch provider {
        case .claude:
            return "ANTHROPIC"
        case .codex:
            return "OPENAI"
        case .gemini:
            return "GOOGLE"
        }
    }

    private func providerEnvironment(for provider: AgentProvider) -> SidecarProviderEnvironment? {
        let diagnosticEnvironment = viewModel.sidecarDiagnostics?.environment
        switch provider {
        case .claude:
            return diagnosticEnvironment?.claude ?? viewModel.environment.claude
        case .codex:
            return diagnosticEnvironment?.codex ?? viewModel.environment.codex
        case .gemini:
            return diagnosticEnvironment?.gemini ?? viewModel.environment.gemini
        }
    }

    private struct ProviderStatusBadgeStyle {
        let label: String
        let dot: Color
        let text: Color
    }

    private func providerStatusBadgeStyle(_ status: SidecarProviderEnvironment?) -> ProviderStatusBadgeStyle {
        guard let status else {
            let muted = OpenDesignDayColor.muted
            return ProviderStatusBadgeStyle(label: "확인 중", dot: muted, text: muted)
        }
        if status.available {
            let green = Agentic30BrandColor.greenBright
            return ProviderStatusBadgeStyle(label: "연결됨", dot: green, text: green)
        }
        let amber = OpenDesignDayColor.amber
        // White-theme amber is too light to read as text, so deepen it for the label.
        let amberText = Agentic30Theme.current == .white
            ? Color(red: 0.66, green: 0.46, blue: 0.09)
            : amber
        return ProviderStatusBadgeStyle(label: "로그인 안 됨", dot: amber, text: amberText)
    }

    private func providerStatusDetail(_ status: SidecarProviderEnvironment?) -> String? {
        guard let status else { return nil }
        let message = status.message.trimmingCharacters(in: .whitespacesAndNewlines)
        return message.isEmpty ? nil : message
    }

    private func authModeMenu(provider: AgentProvider, selection: Binding<String>) -> some View {
        let selectedMode = AgentAuthMode.normalized(selection.wrappedValue, provider: provider)

        return Menu {
            ForEach(AgentAuthMode.modes(for: provider)) { mode in
                Button {
                    selection.wrappedValue = mode.rawValue
                } label: {
                    HStack {
                        Text(authModeLabel(mode, provider: provider))
                        if mode == selectedMode {
                            Image(systemName: "checkmark")
                        }
                    }
                }
            }
        } label: {
            HStack(spacing: 10) {
                Text(authModeLabel(selectedMode, provider: provider))
                    .font(.system(size: 12.5, weight: .medium, design: .monospaced))
                    .foregroundStyle(settingsText)
                    .lineLimit(1)
                    .truncationMode(.tail)

                Spacer(minLength: 12)

                Image(systemName: "chevron.down")
                    .font(.system(size: 10, weight: .bold))
                    .foregroundStyle(settingsSubtleText)
            }
            .padding(.horizontal, 12)
            .frame(height: 34)
            .background(fieldBackground)
        }
        .menuStyle(.button)
        .buttonStyle(.plain)
        .accessibilityIdentifier("settings.\(provider.rawValue).authModePicker")
    }

    private func authModeLabel(_ mode: AgentAuthMode, provider: AgentProvider) -> String {
        switch (provider, mode) {
        case (.claude, .local):
            return "Your Claude Code settings (e.g. subscription)"
        case (.codex, .local):
            return "Your Codex settings (e.g. subscription)"
        case (.gemini, .local):
            return "Your local Google credentials (gcloud ADC)"
        default:
            return mode.title
        }
    }

    @MainActor
    private func presentGcloudMissingAlert(brewAvailable: Bool) {
        let alert = NSAlert()
        alert.messageText = "Google Cloud SDK가 설치되어 있지 않습니다"
        alert.informativeText = """
        대부분의 경우 Gemini API key가 가장 빠릅니다 (30초·1,000 req/day 무료, aistudio.google.com/apikey).

        Google Cloud SDK를 쓰려면 설치 + `gcloud auth application-default login`까지 마쳐야 ADC 로그인이 동작합니다.
        설치 명령 예시: brew install --cask google-cloud-sdk
        """
        alert.alertStyle = .informational
        alert.addButton(withTitle: "Gemini API key 사용 (권장)")
        if brewAvailable {
            alert.addButton(withTitle: "Terminal에서 brew로 설치")
        }
        alert.addButton(withTitle: "Google Cloud SDK 설치 페이지 열기")
        alert.addButton(withTitle: "취소")

        let response = alert.runModal()
        let openInstallPageURL: () -> Void = {
            if let url = URL(string: "https://cloud.google.com/sdk/docs/install-sdk") {
                NSWorkspace.shared.open(url)
            }
        }
        let logCancelled: () -> Void = {
            PostHogTelemetry.capture("mac_gemini_gcloud_alert_cancelled", properties: [
                "brew_available": brewAvailable,
            ], authSession: viewModel.macAuthSession)
        }

        if brewAvailable {
            switch response {
            case .alertFirstButtonReturn:
                geminiAuthMode = AgentAuthMode.apiKey.rawValue
            case .alertSecondButtonReturn:
                viewModel.openGcloudBrewInstallInTerminal()
            case .alertThirdButtonReturn:
                openInstallPageURL()
            default:
                logCancelled()
            }
        } else {
            switch response {
            case .alertFirstButtonReturn:
                geminiAuthMode = AgentAuthMode.apiKey.rawValue
            case .alertSecondButtonReturn:
                openInstallPageURL()
            default:
                logCancelled()
            }
        }
    }

    @MainActor
    private func presentGitHubCliMissingAlert(brewAvailable: Bool) {
        let alert = NSAlert()
        alert.messageText = "GitHub CLI가 설치되어 있지 않습니다"
        alert.informativeText = """
        Agentic30의 GitHub 연동은 별도 토큰을 저장하지 않고 로컬 gh CLI 인증을 사용합니다.

        설치 후 `gh auth login`을 완료하면 History에서 PR, 이슈, 릴리즈 활동을 읽을 수 있습니다.
        """
        alert.alertStyle = .informational
        if brewAvailable {
            alert.addButton(withTitle: "Terminal에서 brew로 설치")
        }
        alert.addButton(withTitle: "GitHub CLI 설치 페이지 열기")
        alert.addButton(withTitle: "취소")

        let response = alert.runModal()
        let openInstallPageURL: () -> Void = {
            if let url = URL(string: "https://cli.github.com/") {
                NSWorkspace.shared.open(url)
            }
        }

        if brewAvailable {
            switch response {
            case .alertFirstButtonReturn:
                viewModel.openGitHubCliInstallInTerminal()
            case .alertSecondButtonReturn:
                openInstallPageURL()
            default:
                break
            }
        } else {
            switch response {
            case .alertFirstButtonReturn:
                openInstallPageURL()
            default:
                break
            }
        }
    }

    private func apiKeyLabel(_ provider: AgentProvider) -> String {
        switch provider {
        case .claude:
            return "ANTHROPIC_API_KEY"
        case .codex:
            return "CODEX_API_KEY / OPENAI_API_KEY"
        case .gemini:
            return "GEMINI_API_KEY"
        }
    }

    private func apiKeyPlaceholder(_ provider: AgentProvider) -> String {
        switch provider {
        case .claude:
            return "sk-ant-..."
        case .codex:
            return "sk-..."
        case .gemini:
            return "AIza..."
        }
    }

    private func environmentLabel(provider: AgentProvider, mode: AgentAuthMode) -> String {
        switch (provider, mode) {
        case (.claude, .bedrock):
            return "AWS Bedrock environment"
        case (.claude, .vertex), (.gemini, .vertex):
            return "Vertex AI environment"
        case (.claude, .foundry):
            return "Microsoft Foundry environment"
        default:
            return "Custom environment"
        }
    }

    private func secureAgentField(
        label: String,
        placeholder: String,
        text: Binding<String>,
        identifier: String
    ) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label)
                .font(.system(size: 10.5, weight: .medium, design: .monospaced))
                .textCase(.uppercase)
                .foregroundStyle(settingsSubtleText)
            SecureField(placeholder, text: text)
                .textFieldStyle(.plain)
                .font(.system(size: 13.5, weight: .medium, design: .monospaced))
                .foregroundStyle(settingsText)
                .padding(.horizontal, 12)
                .frame(height: 34)
                .background(fieldBackground)
                .accessibilityIdentifier(identifier)
        }
        .accessibilityIdentifier(identifier)
    }

    private func plainAgentField(
        label: String,
        placeholder: String,
        text: Binding<String>,
        identifier: String
    ) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label)
                .font(.system(size: 10.5, weight: .medium, design: .monospaced))
                .textCase(.uppercase)
                .foregroundStyle(settingsSubtleText)
            TextField(placeholder, text: text)
                .textFieldStyle(.plain)
                .font(.system(size: 13.5, weight: .medium, design: .monospaced))
                .foregroundStyle(settingsText)
                .padding(.horizontal, 12)
                .frame(height: 34)
                .background(fieldBackground)
                .accessibilityIdentifier(identifier)
        }
        .accessibilityIdentifier(identifier)
    }

    private func environmentEditor(
        label: String,
        text: Binding<String>,
        identifier: String
    ) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label)
                .font(.system(size: 10.5, weight: .medium, design: .monospaced))
                .textCase(.uppercase)
                .foregroundStyle(settingsSubtleText)
            TextEditor(text: text)
                .font(.system(size: 12, weight: .medium, design: .monospaced))
                .foregroundStyle(settingsText)
                .scrollContentBackground(.hidden)
                .frame(minHeight: 86)
                .padding(8)
                .background(fieldBackground)
                .accessibilityIdentifier(identifier)
            Text("One KEY=VALUE pair per line.")
                .font(.system(size: 11, weight: .regular))
                .foregroundStyle(settingsSubtleText)
        }
    }

    private func providerQuickstartURL(_ provider: AgentProvider) -> URL? {
        switch provider {
        case .claude:
            return URL(string: "https://code.claude.com/docs/en/quickstart")
        case .codex:
            return URL(string: "https://developers.openai.com/codex/quickstart")
        case .gemini:
            return URL(string: "https://ai.google.dev/gemini-api/docs/quickstart")
        }
    }

    private func providerConfigURL(_ provider: AgentProvider) -> URL? {
        switch provider {
        case .claude:
            return URL(string: "https://code.claude.com/docs/en/settings")
        case .codex:
            return URL(string: "https://developers.openai.com/codex/config-basic")
        case .gemini:
            return URL(string: "https://github.com/googleapis/js-genai")
        }
    }

    #if DEBUG
    private static var isUITesting: Bool {
        ProcessInfo.processInfo.arguments.contains(where: { $0.hasPrefix("--ui-testing-") })
    }

    private func modelUITestingShortcuts(
        provider: AgentProvider,
        selection: Binding<String>
    ) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            ForEach(AgentModelCatalog.options(for: provider)) { option in
                modelUITestingShortcutButton(option, selection: selection)
            }
        }
    }

    private func modelUITestingShortcutButton(
        _ option: AgentModelOption,
        selection: Binding<String>
    ) -> some View {
        let isSelected = option.id == selection.wrappedValue
        let identifier = "settings.\(option.provider.rawValue).modelOption.\(option.id)"

        return Button {
            selection.wrappedValue = option.id
        } label: {
            Text(option.label)
                .font(.system(size: 10, weight: .semibold, design: .rounded))
                .foregroundStyle(settingsText.opacity(0.62))
                .frame(width: 230, height: 22, alignment: .leading)
        }
        .accessibilityIdentifier(identifier)
        .accessibilityLabel(option.label)
        .buttonStyle(.borderless)
        .padding(.horizontal, 6)
        .padding(.vertical, 4)
        .background(
            RoundedRectangle(cornerRadius: 6, style: .continuous)
                .fill(settingsText.opacity(isSelected ? 0.16 : 0.06))
            )
    }

    private func authModeUITestingShortcuts(
        provider: AgentProvider,
        selection: Binding<String>
    ) -> some View {
        HStack(spacing: 6) {
            ForEach(AgentAuthMode.modes(for: provider)) { mode in
                Button {
                    selection.wrappedValue = mode.rawValue
                } label: {
                    Text(mode.title)
                        .font(.system(size: 10, weight: .semibold, design: .rounded))
                        .foregroundStyle(settingsText.opacity(0.62))
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .background(
                            Capsule()
                                .fill(settingsText.opacity(selection.wrappedValue == mode.rawValue ? 0.16 : 0.06))
                        )
                }
                .buttonStyle(.borderless)
                .accessibilityIdentifier("settings.\(provider.rawValue).authModeOption.\(mode.rawValue)")
            }
        }
    }
    #endif

    // MARK: - Helpers

    private func saveAllSettingsValues() {
        let settings = currentSettings()
        try? KeychainHelper.saveSettings(settings)
        KeychainHelper.syncAllConfigFiles(from: settings)
        PostHogTelemetry.reloadConfiguration()
        viewModel.syncProviderSettingsToSidecar(settings)
        showMessage($settingsSaveMessage, text: "저장됨")
    }

    @ViewBuilder
    private var settingsTabBackground: some View {
        settingsBackground.ignoresSafeArea()
    }

    private var settingsAccentColor: Color {
        OpenDesignDayColor.accent
    }

    private var fieldBackground: some View {
        let shape = RoundedRectangle(cornerRadius: 7, style: .continuous)
        return shape
            .fill(OpenDesignDayColor.bgDarker)
            .overlay(shape.stroke(settingsHairline, lineWidth: 1))
    }

    private func pickFolder() {
        let panel = NSOpenPanel()
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.allowsMultipleSelection = false
        panel.message = "Select your project workspace root"
        if panel.runModal() == .OK, let url = panel.url {
            workspaceRootPath = url.path
            viewModel.setProjectWorkspace(url)
        }
    }

    private func refreshDiagnostics() {
        viewModel.requestDiagnostics()
        showMessage($settingsSaveMessage, text: "진단 요청됨")
    }

    private func copyDiagnostics() {
        let pasteboard = NSPasteboard.general
        pasteboard.clearContents()
        pasteboard.setString(viewModel.diagnosticsReport, forType: .string)
        showMessage($settingsSaveMessage, text: "진단 복사됨")
    }

    private func sendTestBipNotification(_ intent: BipNotificationIntent) {
        Task {
            let message = await viewModel.sendTestBipNotification(intent: intent)
            showMessage($advancedToolsMessage, text: message)
        }
    }

    private func playConfettiTest() {
        withAnimation(.easeOut(duration: 0.12)) {
            confettiTestRunID += 1
        }
        showMessage($settingsSaveMessage, text: "Confetti 재생됨")
    }

    // MARK: - Load / Save / Clear

    /// Builds a Settings struct from current @State values.
    private func currentSettings() -> KeychainHelper.Settings {
        var s = KeychainHelper.loadSettings()
        s.preferredClaudeModel = AgentModelCatalog.normalizedModelID(
            claudeModelID,
            provider: .claude
        )
        s.preferredCodexModel = AgentModelCatalog.normalizedModelID(
            codexModelID,
            provider: .codex
        )
        s.preferredGeminiModel = AgentModelCatalog.normalizedModelID(
            geminiModelID,
            provider: .gemini
        )
        s.claudeAuthMode = AgentAuthMode.normalized(claudeAuthMode, provider: .claude).rawValue
        s.codexAuthMode = AgentAuthMode.normalized(codexAuthMode, provider: .codex).rawValue
        s.geminiAuthMode = AgentAuthMode.normalized(geminiAuthMode, provider: .gemini).rawValue
        s.claudeApiKey = claudeApiKey
        s.codexApiKey = codexApiKey
        s.geminiApiKey = geminiApiKey
        s.claudeEnvironment = claudeEnvironment
        s.codexEnvironment = codexEnvironment
        s.geminiEnvironment = geminiEnvironment
        s.exaApiKey = exaApiKey
        s.cloudflareApiToken = cloudflareApiToken
        s.cloudflareMcpURL = cloudflareMcpURL
        s.cloudflareMcpCodemode = cloudflareMcpCodemode
        s.posthogApiKey = posthogApiKey
        s.posthogProjectAPIKey = posthogProjectAPIKey
        s.posthogHost = posthogHost
        s.posthogMcpURL = posthogMcpURL
        s.posthogMcpRegion = posthogMcpRegion
        s.posthogMcpReadonly = posthogMcpReadonly
        s.posthogMcpFeatures = posthogMcpFeatures
        s.bipWorkspaceRoot = workspaceRootPath
        return s
    }

    /// Applies a Settings struct to all @State values.
    private func applySettings(_ s: KeychainHelper.Settings) {
        let environment = ProcessInfo.processInfo.environment
        let preferredClaudeModel = environment["AGENTIC30_UI_TEST_SETTINGS_CLAUDE_MODEL"] ?? s.preferredClaudeModel
        let preferredCodexModel = environment["AGENTIC30_UI_TEST_SETTINGS_CODEX_MODEL"] ?? s.preferredCodexModel
        let preferredGeminiModel = environment["AGENTIC30_UI_TEST_SETTINGS_GEMINI_MODEL"] ?? s.preferredGeminiModel
        let preferredClaudeAuthMode = environment["AGENTIC30_UI_TEST_SETTINGS_CLAUDE_AUTH_MODE"] ?? s.claudeAuthMode
        let preferredCodexAuthMode = environment["AGENTIC30_UI_TEST_SETTINGS_CODEX_AUTH_MODE"] ?? s.codexAuthMode
        let preferredGeminiAuthMode = environment["AGENTIC30_UI_TEST_SETTINGS_GEMINI_AUTH_MODE"] ?? s.geminiAuthMode
        claudeModelID = AgentModelCatalog.normalizedModelID(
            preferredClaudeModel,
            provider: .claude
        )
        codexModelID = AgentModelCatalog.normalizedModelID(
            preferredCodexModel,
            provider: .codex
        )
        geminiModelID = AgentModelCatalog.normalizedModelID(
            preferredGeminiModel,
            provider: .gemini
        )
        claudeAuthMode = AgentAuthMode.normalized(preferredClaudeAuthMode, provider: .claude).rawValue
        codexAuthMode = AgentAuthMode.normalized(preferredCodexAuthMode, provider: .codex).rawValue
        geminiAuthMode = AgentAuthMode.normalized(preferredGeminiAuthMode, provider: .gemini).rawValue
        claudeApiKey = s.claudeApiKey
        codexApiKey = s.codexApiKey
        geminiApiKey = s.geminiApiKey
        claudeEnvironment = s.claudeEnvironment
        codexEnvironment = s.codexEnvironment
        geminiEnvironment = s.geminiEnvironment
        exaApiKey = s.exaApiKey
        cloudflareApiToken = s.cloudflareApiToken
        cloudflareMcpURL = s.cloudflareMcpURL
        cloudflareMcpCodemode = s.cloudflareMcpCodemode
        posthogApiKey = s.posthogApiKey
        posthogProjectAPIKey = s.posthogProjectAPIKey
        posthogHost = s.posthogHost
        posthogMcpURL = s.posthogMcpURL
        posthogMcpRegion = s.posthogMcpRegion
        posthogMcpReadonly = s.posthogMcpReadonly
        posthogMcpFeatures = s.posthogMcpFeatures
        #if DEBUG
        if environment["AGENTIC30_UI_TEST_SETTINGS_CLAUDE_MODEL"] != nil
            || environment["AGENTIC30_UI_TEST_SETTINGS_CODEX_MODEL"] != nil
            || environment["AGENTIC30_UI_TEST_SETTINGS_GEMINI_MODEL"] != nil
            || environment["AGENTIC30_UI_TEST_SETTINGS_CLAUDE_AUTH_MODE"] != nil
            || environment["AGENTIC30_UI_TEST_SETTINGS_CODEX_AUTH_MODE"] != nil
            || environment["AGENTIC30_UI_TEST_SETTINGS_GEMINI_AUTH_MODE"] != nil {
            var seededSettings = s
            seededSettings.preferredClaudeModel = AgentModelCatalog.normalizedModelID(preferredClaudeModel, provider: .claude)
            seededSettings.preferredCodexModel = AgentModelCatalog.normalizedModelID(preferredCodexModel, provider: .codex)
            seededSettings.preferredGeminiModel = AgentModelCatalog.normalizedModelID(preferredGeminiModel, provider: .gemini)
            seededSettings.claudeAuthMode = AgentAuthMode.normalized(preferredClaudeAuthMode, provider: .claude).rawValue
            seededSettings.codexAuthMode = AgentAuthMode.normalized(preferredCodexAuthMode, provider: .codex).rawValue
            seededSettings.geminiAuthMode = AgentAuthMode.normalized(preferredGeminiAuthMode, provider: .gemini).rawValue
            do {
                try KeychainHelper.saveSettings(seededSettings)
            } catch {
                assertionFailure("Failed to seed UI test model settings: \(error.localizedDescription)")
            }
        }
        #endif
        workspaceRootPath = s.bipWorkspaceRoot
    }

    private func loadAllValues() {
        let settings = KeychainHelper.loadSettings()
        applySettings(settings)
        workspaceRootPath = WorkspaceSettings.displayPath(legacyFallback: settings.bipWorkspaceRoot)
        viewModel.syncProviderSettingsToSidecar(settings)
        viewModel.refreshGitHubCliStatus()
    }

    private func syncWorkspaceRoot(_ root: String) {
        guard WorkspaceSettings.hasExplicitWorkspace else { return }
        let explicitPath = WorkspaceSettings.resolvedURL().path
        if !root.isEmpty {
            workspaceRootPath = root
        } else {
            workspaceRootPath = explicitPath
        }
    }

    private func resetAgentic30LocalData() {
        do {
            let report = try viewModel.resetAgentic30LocalUserData()
            loadAllValues()
            openWorkspaceAfterLocalDataReset()
            showMessage($settingsSaveMessage, text: localDataResetSummary(report))
        } catch {
            showMessage($settingsSaveMessage, text: "Reset failed: \(error.localizedDescription)")
        }
    }

    private func openWorkspaceAfterLocalDataReset() {
        if let appDelegate = NSApp.delegate as? AppDelegate {
            appDelegate.openWorkspaceWindow()
        } else {
            openWindow(id: "workspace")
            NSApp.activate(ignoringOtherApps: true)
        }
    }

    private func uninstallAgentic30() {
        do {
            let report = try viewModel.resetAgentic30LocalUserData()
            loadAllValues()
            NSWorkspace.shared.activateFileViewerSelecting([Bundle.main.bundleURL])
            let suffix = report.failures.isEmpty
                ? " Agentic30 will quit; move the selected app to Trash."
                : " Cleanup had \(report.failures.count) warning(s). Agentic30 will quit; move the selected app to Trash."
            showMessage($settingsSaveMessage, text: "Local data cleared.\(suffix)")
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) {
                NSApplication.shared.terminate(nil)
            }
        } catch {
            showMessage($settingsSaveMessage, text: "Reset failed: \(error.localizedDescription)")
        }
    }

    private func localDataResetSummary(_ report: KeychainHelper.LocalDataResetReport) -> String {
        let pathCount = report.removedPathCount
        if report.failures.isEmpty {
            return pathCount > 0
                ? "Reset local data (\(pathCount) path(s) removed)"
                : "Reset local settings"
        }
        return "Reset with \(report.failures.count) cleanup warning(s)"
    }

    private func showMessage(_ binding: Binding<String>, text: String) {
        withAnimation { binding.wrappedValue = text }
        Task {
            try? await Task.sleep(for: .seconds(2))
            withAnimation { binding.wrappedValue = "" }
        }
    }

}
