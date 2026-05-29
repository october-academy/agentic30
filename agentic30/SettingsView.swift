import SwiftUI
import AppKit

enum SettingsSection: CaseIterable, Identifiable {
    case appearance
    case account
    case agents
    case adAnalytics
    case buildInPublic
    case notion
    case developerTools
    case diagnostics
    case quarantineRecovery

    var id: Self { self }

    var title: String {
        switch self {
        case .appearance: "Appearance"
        case .account: "Workspace"
        case .agents: "AI Providers"
        case .adAnalytics: "Ad Analytics"
        case .buildInPublic: "Build In Public"
        case .notion: "Notion"
        case .developerTools: "Advanced"
        case .diagnostics: "Privacy & Diagnostics"
        case .quarantineRecovery: "Quarantine Recovery"
        }
    }

    var sidebarTitle: String {
        switch self {
        case .appearance: "테마"
        case .account: "워크스페이스"
        case .agents: "AI 프로바이더"
        case .adAnalytics: "광고 분석"
        case .buildInPublic: "Build In Public"
        case .notion: "Notion"
        case .developerTools: "고급 & Sidecar"
        case .diagnostics: "개인정보 & 진단"
        case .quarantineRecovery: "정직 모드 복구"
        }
    }

    var systemImage: String {
        switch self {
        case .appearance: "circle.lefthalf.filled"
        case .account: "person.crop.circle"
        case .agents: "pencil.and.outline"
        case .adAnalytics: "chart.bar.xaxis"
        case .buildInPublic: "hammer.fill"
        case .notion: "doc.text.fill"
        case .developerTools: "wrench.and.screwdriver.fill"
        case .diagnostics: "stethoscope"
        case .quarantineRecovery: "tray.and.arrow.up"
        }
    }

    var accessibilityIdentifier: String {
        switch self {
        case .appearance: "appearance"
        case .account: "account"
        case .agents: "agents"
        case .adAnalytics: "adAnalytics"
        case .buildInPublic: "buildInPublic"
        case .notion: "notion"
        case .developerTools: "developerTools"
        case .diagnostics: "diagnostics"
        case .quarantineRecovery: "quarantineRecovery"
        }
    }
}

struct SettingsView: View {
    @ObservedObject var viewModel: AgenticViewModel
    private let embeddedInWorkspace: Bool
    private let showsWorkspaceSettingsSidebar: Bool
    private let returnToWorkspace: (() -> Void)?
    private let selectedSectionOverride: Binding<SettingsSection>?

    @Environment(\.openWindow) private var openWindow

    // MARK: - Ad Analytics State

    @State private var posthogApiKey = ""
    @State private var posthogProjectAPIKey = ""
    @State private var posthogHost = ""
    @State private var posthogMcpURL = KeychainHelper.Settings.defaultPostHogMcpURL
    @State private var posthogMcpRegion = KeychainHelper.Settings.defaultPostHogMcpRegion
    @State private var posthogMcpReadonly = true
    @State private var posthogMcpFeatures = KeychainHelper.Settings.defaultPostHogMcpFeatures
    @State private var telemetryDisabled = PostHogTelemetry.isTelemetryDisabledByUser
    @State private var metaAccessToken = ""
    @State private var metaAdAccountId = ""
    @State private var adSaveMessage = ""

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
    @State private var agentSettingsSaveMessage = ""

    // MARK: - BIP State

    @State private var bipWorkspaceRoot = ""
    @State private var bipIcpPath = ""
    @State private var bipSpecPath = ""
    @State private var bipValuesPath = ""
    @State private var bipDesignSystemPath = ""
    @State private var bipAdrPath = ""
    @State private var bipGoalPath = ""
    @State private var bipDocsPath = ""
    @State private var bipSheetPath = ""
    @State private var bipGdocsUrls = ""
    @State private var bipGsheetsUrls = ""
    @State private var bipNotionUrls = ""
    @State private var bipThreadsHandle = ""
    @State private var bipXHandle = ""
    @State private var bipSaveMessage = ""
    @State private var scanMessage = ""
    @State private var diagnosticsMessage = ""
    @State private var developerToolsMessage = ""
    @State private var confettiTestRunID = 0
    @State private var confettiTestMessage = ""
    @State private var resetLocalDataMessage = ""
    @State private var localDataConfirmation: LocalDataConfirmation?
    @State private var localSelectedSection: SettingsSection = .account
    @State private var isBackButtonHovered = false
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
                return "This clears Agentic30 UserDefaults, Keychain entries, app support, local sessions, caches, Saved State, onboarding state, the Agentic30 QMD index, and .agentic30 folders in known workspaces. Other project files and global provider logins are not deleted."
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
        showsWorkspaceSettingsSidebar: Bool = true,
        returnToWorkspace: (() -> Void)? = nil
    ) {
        _viewModel = ObservedObject(wrappedValue: viewModel)
        self.embeddedInWorkspace = embeddedInWorkspace
        self.showsWorkspaceSettingsSidebar = showsWorkspaceSettingsSidebar
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
        return SettingsSection.allCases.first { section in
            section.accessibilityIdentifier == rawSection
        }
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
            .onChange(of: viewModel.bipCoach?.updatedAt) { _, _ in
                syncBipFieldsFromCoach(viewModel.bipCoach, persist: true)
            }
            .onChange(of: viewModel.scanResult) { _, _ in
                if let result = viewModel.scanResult {
                    applyScanResult(result)
                }
            }
            .onChange(of: viewModel.lastDocCreated?.type) { _, _ in
                if let created = viewModel.lastDocCreated {
                    applyDocCreated(type: created.type, path: created.path)
                }
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
                            .accessibilityIdentifier("settings.developerTools.confettiOverlay")
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
                        .frame(width: showsMeta ? 240 : 220)
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
                Text("\(SettingsSection.allCases.count)")
                    .font(.system(size: 10, weight: .medium, design: .monospaced))
                    .foregroundStyle(settingsText.opacity(0.44))
                    .padding(.horizontal, 6)
                    .frame(height: 18)
                    .background(Capsule().fill(settingsText.opacity(0.055)))
                Spacer(minLength: 0)
            }
            .padding(.top, 10)
            .padding(.horizontal, 12)
            .padding(.bottom, 8)

            Button(action: {}) {
                HStack(spacing: 8) {
                    Image(systemName: "magnifyingglass")
                        .font(.system(size: 10, weight: .medium))
                    Text("설정 검색")
                    Spacer()
                    Text("⌘ K")
                        .font(.system(size: 10, weight: .medium, design: .monospaced))
                        .foregroundStyle(settingsText.opacity(0.28))
                }
                .font(.system(size: 11.5, weight: .medium))
                .foregroundStyle(settingsText.opacity(0.72))
                .padding(.horizontal, 10)
                .frame(height: 30)
                .background(settingsRounded(fill: settingsText.opacity(0.045), stroke: settingsText.opacity(0.08), radius: 6))
            }
            .buttonStyle(.plain)
            .padding(.horizontal, 8)
            .padding(.bottom, 6)
            .help("검색은 워크스페이스 팔레트에서 제공됩니다")

            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    if returnToWorkspace != nil {
                        settingsDesignBackButton
                            .padding(.horizontal, 6)
                            .padding(.bottom, 8)
                    }

                    ForEach(settingsNavigationGroups.indices, id: \.self) { index in
                        let group = settingsNavigationGroups[index]
                        HStack {
                            Text(group.title)
                            Spacer()
                        }
                        .font(.system(size: 10, weight: .medium, design: .monospaced))
                        .textCase(.uppercase)
                        .foregroundStyle(settingsText.opacity(0.30))
                        .padding(.top, index == 0 && returnToWorkspace == nil ? 8 : 14)
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
        [
            ("General", [.appearance, .account, .buildInPublic]),
            ("Agent", [.agents, .adAnalytics, .notion]),
            ("Trust", [.diagnostics, .developerTools, .quarantineRecovery]),
        ]
    }

    private func settingsDesignSidebarRow(_ section: SettingsSection) -> some View {
        Button {
            selectedSection.wrappedValue = section
        } label: {
            HStack(spacing: 10) {
                Image(systemName: section.systemImage)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(section == selectedSection.wrappedValue ? settingsAccentColor : settingsText.opacity(0.42))
                    .frame(width: 24, height: 24)
                    .background(
                        RoundedRectangle(cornerRadius: 7, style: .continuous)
                            .fill(section == selectedSection.wrappedValue ? settingsAccentColor.opacity(0.16) : settingsSidebarTone(section).opacity(0.10))
                            .overlay(
                                RoundedRectangle(cornerRadius: 7, style: .continuous)
                                    .stroke(section == selectedSection.wrappedValue ? settingsAccentColor.opacity(0.36) : settingsSidebarTone(section).opacity(0.14), lineWidth: 1)
                            )
                    )

                Text(section.sidebarTitle)
                    .font(.system(size: 12.2, weight: .medium))
                    .foregroundStyle(section == selectedSection.wrappedValue ? settingsText.opacity(0.94) : settingsText.opacity(0.70))
                    .lineLimit(1)

                Spacer(minLength: 6)

                if let badge = settingsSidebarBadge(for: section) {
                    Text(badge)
                        .font(.system(size: 10, weight: .medium, design: .monospaced))
                        .foregroundStyle(section == selectedSection.wrappedValue ? settingsAccentColor : settingsText.opacity(0.42))
                        .lineLimit(1)
                }
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 7.5)
            .background(
                settingsRounded(
                    fill: section == selectedSection.wrappedValue ? settingsText.opacity(0.095) : Color.clear,
                    stroke: Color.clear,
                    radius: 7
                )
            )
            .contentShape(RoundedRectangle(cornerRadius: 7, style: .continuous))
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("settings.section.\(section.accessibilityIdentifier)")
    }

    private func settingsDesignHeader(showsCompactNavigation: Bool) -> some View {
        HStack(spacing: 12) {
            HStack(spacing: 14) {
                Image(systemName: selectedSection.wrappedValue.systemImage)
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(settingsAccentColor)
                    .frame(width: 44, height: 44)
                    .background(settingsRounded(fill: settingsAccentColor.opacity(0.14), stroke: settingsAccentColor.opacity(0.34), radius: 11))

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
                        Text(selectedSection.wrappedValue.sidebarTitle)
                        Text("·")
                            .foregroundStyle(settingsText.opacity(0.22))
                        Text("변경 사항은 Keychain/UserDefaults에 저장")
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
                Label("새로고침", systemImage: "arrow.clockwise")
                    .font(.system(size: 11.5, weight: .medium))
                    .foregroundStyle(settingsText.opacity(0.74))
                    .padding(.horizontal, 12)
                    .frame(height: 28)
                    .background(settingsRounded(fill: Color.clear, stroke: settingsText.opacity(0.08), radius: 8))
            }
            .buttonStyle(.plain)

            Button(action: saveCurrentSettingsForSelectedSection) {
                Label("저장", systemImage: "checkmark")
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

                settingsMetaCard(label: "Sidecar", isLive: viewModel.isConnected) {
                    settingsMetaRow("상태", viewModel.isConnected ? "실행 중" : "연결 대기")
                    settingsMetaRow("런타임", viewModel.sidecarDiagnostics?.runtime.node ?? "unknown")
                    settingsMetaRow("세션", "\(viewModel.sessions.count)건")
                    settingsMetaRow("Preflight", viewModel.sidecarDiagnostics?.preflight?.status ?? "unknown")
                }

                settingsMetaCard(label: "스토리지", isLive: false) {
                    settingsMetaRow("workspace", shortPath(bipWorkspaceRoot))
                    settingsMetaRow("ICP", bipIcpPath.isEmpty ? "미설정" : bipIcpPath)
                    settingsMetaRow("SPEC", bipSpecPath.isEmpty ? "미설정" : bipSpecPath)
                    settingsMetaRow("BIP", bipThreadsHandle.isEmpty ? "0 handles" : "@\(bipThreadsHandle)")
                }

                Text("빠른 작업")
                    .font(.system(size: 10.5, weight: .medium, design: .monospaced))
                    .textCase(.uppercase)
                    .foregroundStyle(settingsText.opacity(0.34))
                    .padding(.top, 2)

                settingsMetaAction(title: "진단 스냅샷 내보내기", subtitle: "sanitize · copy", systemImage: "square.and.arrow.down", action: copyDiagnostics)
                settingsMetaAction(title: "Sidecar 진단 새로고침", subtitle: "preflight · runtime", systemImage: "arrow.clockwise", action: refreshDiagnostics)
                settingsMetaAction(title: "워크스페이스 재스캔", subtitle: "docs · path", systemImage: "folder.badge.gearshape", action: triggerScan)

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

    private func settingsSidebarBadge(for section: SettingsSection) -> String? {
        switch section {
        case .appearance:
            return Agentic30Theme.normalized(appThemeRawValue).displayName
        case .account:
            return loginItemsManager.isEnabled ? "ON" : "Local"
        case .agents:
            if providerEnvironment(for: .claude)?.available == true { return "Claude" }
            if providerEnvironment(for: .codex)?.available == true { return "Codex" }
            return "setup"
        case .adAnalytics:
            return (!posthogApiKey.isEmpty || !metaAccessToken.isEmpty) ? "set" : "OFF"
        case .buildInPublic:
            return bipWorkspaceRoot.isEmpty ? "docs" : "root"
        case .notion:
            return viewModel.notionConnected ? "ON" : "OAuth"
        case .developerTools:
            return "PID"
        case .diagnostics:
            return viewModel.sidecarDiagnostics?.preflight?.status ?? "copy"
        case .quarantineRecovery:
            return "review"
        }
    }

    private func settingsSidebarTone(_ section: SettingsSection) -> Color {
        switch section {
        case .appearance, .account, .agents:
            return settingsAccentColor
        case .adAnalytics, .notion, .developerTools:
            return Color(red: 0.96, green: 0.78, blue: 0.54)
        case .buildInPublic:
            return Color(red: 0.42, green: 0.78, blue: 0.95)
        case .diagnostics, .quarantineRecovery:
            return Color(red: 1.0, green: 0.45, blue: 0.42)
        }
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
        sidecar · \(viewModel.sidecarDiagnostics?.preflight?.status ?? "unknown")
        node · \(viewModel.sidecarDiagnostics?.runtime.node ?? "unknown")
        """
    }

    private var workspaceSettingsSidebar: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button {
                returnToWorkspace?()
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
                .foregroundStyle(settingsText.opacity(isBackButtonHovered ? 0.90 : 0.58))
                .padding(.horizontal, 10)
                .frame(height: 40)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .fill(settingsText.opacity(isBackButtonHovered ? 0.075 : 0.0))
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .stroke(settingsText.opacity(isBackButtonHovered ? 0.12 : 0.0), lineWidth: 1)
                )
                .contentShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            }
            .buttonStyle(.plain)
            .disabled(returnToWorkspace == nil)
            .onHover { hovering in
                isBackButtonHovered = hovering
            }
            .animation(.easeOut(duration: 0.12), value: isBackButtonHovered)
            .padding(.horizontal, 8)

            VStack(alignment: .leading, spacing: 4) {
                ForEach(SettingsSection.allCases) { section in
                    workspaceSettingsSidebarRow(section)
                }
            }
            .padding(.horizontal, 8)
            .padding(.top, 6)

            Spacer(minLength: 0)
        }
        .frame(width: 236)
        .background(settingsText.opacity(0.025))
        .overlay(alignment: .trailing) {
            Divider().opacity(0.36)
        }
    }

    private func workspaceSettingsSidebarRow(_ section: SettingsSection) -> some View {
        Button {
            selectedSection.wrappedValue = section
        } label: {
            HStack(spacing: 10) {
                Image(systemName: section.systemImage)
                    .font(.system(size: 14, weight: .semibold))
                    .frame(width: 20)
                Text(section.sidebarTitle)
                    .font(.system(size: 13, weight: .bold, design: .rounded))
                    .lineLimit(1)
                Spacer(minLength: 0)
            }
            .foregroundStyle(section == selectedSection.wrappedValue ? settingsText.opacity(0.88) : settingsText.opacity(0.58))
            .padding(.horizontal, 12)
            .frame(height: 36)
            .background(
                RoundedRectangle(cornerRadius: 9, style: .continuous)
                    .fill(section == selectedSection.wrappedValue ? settingsText.opacity(0.10) : Color.clear)
            )
            .contentShape(RoundedRectangle(cornerRadius: 9, style: .continuous))
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("settings.section.\(section.accessibilityIdentifier)")
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

    private var settingsSectionBar: some View {
        HStack(spacing: 8) {
            ForEach(SettingsSection.allCases) { section in
                Button {
                    selectedSection.wrappedValue = section
                } label: {
                    Label(section.title, systemImage: section.systemImage)
                        .font(.system(size: 12, weight: .bold, design: .rounded))
                        .foregroundStyle(section == selectedSection.wrappedValue ? settingsText.opacity(0.92) : settingsText.opacity(0.5))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 10)
                        .background(
                            RoundedRectangle(cornerRadius: 8, style: .continuous)
                                .fill(section == selectedSection.wrappedValue ? settingsText.opacity(0.14) : settingsText.opacity(0.04))
                        )
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("settings.section.\(section.accessibilityIdentifier)")
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 16)
        .padding(.bottom, 12)
        .background(OpenDesignDayColor.bgDeep)
    }

    @ViewBuilder
    private var selectedSettingsSection: some View {
        switch selectedSection.wrappedValue {
        case .appearance:
            appearanceTab
        case .account:
            accountTab
        case .agents:
            agentsTab
        case .adAnalytics:
            adAnalyticsTab
        case .buildInPublic:
            bipTab
        case .notion:
            notionTab
        case .developerTools:
            developerToolsTab
        case .diagnostics:
            diagnosticsTab
        case .quarantineRecovery:
            RubricQuarantineView(viewModel: viewModel)
        }
    }

    // MARK: - Appearance Tab

    private var appearanceTab: some View {
        settingsTabScaffold(
            title: "Appearance",
            subtitle: "day-white.html 팔레트를 기본으로 사용하고, 기존 다크 테마도 보존합니다."
        ) {
            appearanceThemeSection
        }
    }

    private var appearanceThemeSection: some View {
        VStack(alignment: .leading, spacing: 16) {
            sectionHeader(title: "Theme", configured: true)

            Picker("Theme", selection: $appThemeRawValue) {
                ForEach(Agentic30Theme.allCases) { theme in
                    Text(theme.displayName)
                        .tag(theme.rawValue)
                }
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            .tint(settingsAccentColor)
            .accessibilityIdentifier("settings.appearance.themePicker")
            .onChange(of: appThemeRawValue) { _, newValue in
                let normalized = Agentic30Theme.normalized(newValue)
                if normalized.rawValue != newValue {
                    appThemeRawValue = normalized.rawValue
                }
                normalized.applyAppKitAppearance()
            }

            ForEach(Agentic30Theme.allCases) { theme in
                themePreviewRow(theme)
            }
        }
        .padding(20)
        .background(cardBackground)
    }

    private func themePreviewRow(_ theme: Agentic30Theme) -> some View {
        let isSelected = Agentic30Theme.normalized(appThemeRawValue) == theme
        return HStack(spacing: 12) {
            HStack(spacing: 0) {
                Circle().fill(themePreviewAccent(theme)).frame(width: 12, height: 12)
                Circle().fill(themePreviewSurface(theme)).frame(width: 12, height: 12)
                    .overlay(Circle().stroke(themePreviewBorder(theme), lineWidth: 1))
                Circle().fill(themePreviewText(theme)).frame(width: 12, height: 12)
            }
            .frame(width: 44, alignment: .leading)

            VStack(alignment: .leading, spacing: 3) {
                Text(theme.displayName)
                    .font(.system(size: 14, weight: .bold, design: .rounded))
                    .foregroundStyle(settingsText.opacity(0.88))
                Text(theme.detail)
                    .font(.system(size: 12, weight: .medium, design: .rounded))
                    .foregroundStyle(settingsText.opacity(0.50))
            }

            Spacer(minLength: 0)

            Image(systemName: isSelected ? "checkmark.circle.fill" : "circle")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(isSelected ? settingsAccentColor : settingsText.opacity(0.30))
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(settingsRounded(fill: isSelected ? settingsAccentColor.opacity(0.10) : settingsText.opacity(0.035), stroke: isSelected ? settingsAccentColor.opacity(0.22) : settingsText.opacity(0.08), radius: 8))
        .contentShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        .onTapGesture {
            appThemeRawValue = theme.rawValue
            theme.applyAppKitAppearance()
        }
        .accessibilityIdentifier("settings.appearance.theme.\(theme.rawValue)")
    }

    private func themePreviewAccent(_ theme: Agentic30Theme) -> Color {
        switch theme {
        case .white: Color(red: 0.0000, green: 0.5144, blue: 0.2936)
        case .dark: Color(red: 0.2165, green: 0.8352, blue: 0.6244)
        }
    }

    private func themePreviewSurface(_ theme: Agentic30Theme) -> Color {
        switch theme {
        case .white: Color.white
        case .dark: Color(red: 0.0544, green: 0.0614, blue: 0.0666)
        }
    }

    private func themePreviewText(_ theme: Agentic30Theme) -> Color {
        switch theme {
        case .white: Color(red: 0.0769, green: 0.1081, blue: 0.1353)
        case .dark: Color(red: 0.9410, green: 0.9490, blue: 0.9550)
        }
    }

    private func themePreviewBorder(_ theme: Agentic30Theme) -> Color {
        switch theme {
        case .white: Color(red: 0.7807, green: 0.8039, blue: 0.8214)
        case .dark: Color(red: 0.1501, green: 0.1619, blue: 0.1708)
        }
    }

    // MARK: - Account Tab

    private var accountTab: some View {
        settingsTabScaffold(
            title: "Account",
            subtitle: "The macOS app runs in local mode. No web account is required."
        ) {
            accountConnectionSection
            launchAtLoginSection
            appUpdatesSection
            localDataResetSection
        }
    }

    private var accountConnectionSection: some View {
        VStack(alignment: .leading, spacing: 16) {
            sectionHeader(
                title: "Local Mode",
                configured: true
            )

            if let email = viewModel.signedInEmail {
                VStack(alignment: .leading, spacing: 10) {
                    Text("Signed in: \(email)")
                        .font(.system(size: 16, weight: .bold, design: .rounded))
                        .foregroundStyle(settingsText.opacity(0.9))
                    Text("Sign-in is no longer required. You can clear this stored session and keep using the app locally.")
                        .font(.system(size: 12, weight: .medium, design: .rounded))
                        .foregroundStyle(settingsText.opacity(0.45))
                }

                HStack(spacing: 10) {
                    accountButton("Sign out", destructive: true) {
                        viewModel.signOutMacAuth()
                    }
                }
            } else {
                VStack(alignment: .leading, spacing: 12) {
                    Text("Using local mode")
                        .font(.system(size: 16, weight: .bold, design: .rounded))
                        .foregroundStyle(settingsText.opacity(0.9))
                    Text("Choose a project folder and continue without Google sign-in. Workspace integrations remain separate.")
                        .font(.system(size: 12, weight: .medium, design: .rounded))
                        .foregroundStyle(settingsText.opacity(0.45))
                }
            }
        }
        .padding(20)
        .background(cardBackground)
    }

    private func accountButton(
        _ title: String,
        destructive: Bool = false,
        action: @escaping () -> Void
    ) -> some View {
        let color = destructive ? Color.red : settingsText
        return Button(action: action) {
            Text(title)
                .font(.system(size: 13, weight: .bold, design: .rounded))
                .foregroundStyle(color.opacity(destructive ? 0.86 : 0.9))
                .padding(.horizontal, 16)
                .padding(.vertical, 8)
                .background(Capsule().fill(color.opacity(destructive ? 0.10 : 0.14)))
        }
        .buttonStyle(.plain)
    }

    private var launchAtLoginSection: some View {
        VStack(alignment: .leading, spacing: 16) {
            sectionHeader(title: "Launch at Login", configured: loginItemsManager.isEnabled)

            Text("Mac에 로그인하면 Agentic30 메뉴바 아이콘이 자동으로 활성화됩니다. 워크스페이스 윈도우는 메뉴바에서 직접 열 수 있습니다.")
                .font(.system(size: 13, weight: .medium, design: .rounded))
                .foregroundStyle(settingsText.opacity(0.48))

            Toggle(isOn: Binding(
                get: { loginItemsManager.isEnabled },
                set: { loginItemsManager.setEnabled($0) }
            )) {
                Text("로그인 시 자동 시작")
                    .font(.system(size: 13, weight: .bold, design: .rounded))
                    .foregroundStyle(settingsText.opacity(0.86))
            }
            .toggleStyle(.switch)
            .accessibilityIdentifier("settings.account.launchAtLogin.toggle")
        }
        .padding(20)
        .background(cardBackground)
    }

    private var appUpdatesSection: some View {
        VStack(alignment: .leading, spacing: 16) {
            sectionHeader(title: "Updates", configured: true)

            Text("Agentic30 checks the signed update feed in the background. You can also check manually.")
                .font(.system(size: 13, weight: .medium, design: .rounded))
                .foregroundStyle(settingsText.opacity(0.48))

            Button {
                NotificationCenter.default.post(name: .agenticCheckForUpdatesRequested, object: nil)
            } label: {
                HStack(spacing: 8) {
                    Image(systemName: "arrow.triangle.2.circlepath")
                        .font(.system(size: 13, weight: .semibold))
                    Text("Check for Updates...")
                        .font(.system(size: 14, weight: .bold, design: .rounded))
                }
                .foregroundStyle(settingsText.opacity(0.9))
                .padding(.horizontal, 18)
                .padding(.vertical, 10)
                .background(Capsule().fill(settingsText.opacity(0.16)))
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("settings.updates.checkForUpdates")
        }
        .padding(20)
        .background(cardBackground)
    }

    private var localDataResetSection: some View {
        VStack(alignment: .leading, spacing: 16) {
            sectionHeader(title: "Local Data", configured: true)

            VStack(alignment: .leading, spacing: 8) {
                Text("Reset Agentic30 on this Mac")
                    .font(.system(size: 15, weight: .bold, design: .rounded))
                    .foregroundStyle(settingsText.opacity(0.88))
                Text("Clears Agentic30 UserDefaults, Keychain entries, app support, local sessions, caches, Saved State, onboarding state, the Agentic30 QMD index, .agentic30 folders, and Agentic30-managed Day 1 handoff blocks in known workspaces. Other project files and global Claude/Codex/GWS logins are not deleted.")
                    .font(.system(size: 12, weight: .medium, design: .rounded))
                    .foregroundStyle(settingsText.opacity(0.48))
                    .fixedSize(horizontal: false, vertical: true)
            }

            HStack(spacing: 14) {
                accountButton("Reset Local Data...", destructive: true) {
                    localDataConfirmation = .reset
                }
                .accessibilityIdentifier("settings.account.resetLocalDataButton")

                accountButton("Uninstall Agentic30...", destructive: true) {
                    localDataConfirmation = .uninstall
                }
                .accessibilityIdentifier("settings.account.uninstallAgentic30Button")

                if !resetLocalDataMessage.isEmpty {
                    Text(resetLocalDataMessage)
                        .font(.system(size: 13, weight: .medium, design: .rounded))
                        .foregroundStyle(resetLocalDataMessage.hasPrefix("Reset failed") ? .red.opacity(0.82) : Agentic30BrandColor.green.opacity(0.8))
                        .transition(.opacity)
                        .accessibilityIdentifier("settings.account.resetLocalDataMessage")
                }

                Spacer()
            }
        }
        .padding(20)
        .background(cardBackground)
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
        .accessibilityIdentifier("settings.account.localDataConfirmation")
    }

    // MARK: - Agents Tab

    private var agentsTab: some View {
        settingsTabScaffold(
            title: "Agents",
            subtitle: "Configure Claude, Codex, and Gemini for Agentic30."
        ) {
            agentProviderSection(
                provider: .claude,
                authMode: $claudeAuthMode,
                apiKey: $claudeApiKey,
                environment: $claudeEnvironment,
                modelSelection: $claudeModelID
            )

            agentProviderSection(
                provider: .codex,
                authMode: $codexAuthMode,
                apiKey: $codexApiKey,
                environment: $codexEnvironment,
                modelSelection: $codexModelID
            )

            agentProviderSection(
                provider: .gemini,
                authMode: $geminiAuthMode,
                apiKey: $geminiApiKey,
                environment: $geminiEnvironment,
                modelSelection: $geminiModelID
            )

            exaResearchSection

            saveAgentSettingsSection
        }
    }

    private var exaResearchSection: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .center, spacing: 14) {
                Image(systemName: "newspaper.fill")
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(Agentic30BrandColor.green.opacity(0.92))
                    .frame(width: 34, height: 34)
                    .background(Circle().fill(Agentic30BrandColor.green.opacity(0.16)))
                    .overlay(Circle().stroke(Agentic30BrandColor.green.opacity(0.25), lineWidth: 1))

                VStack(alignment: .leading, spacing: 4) {
                    Text("Exa Market Research")
                        .font(.system(size: 18, weight: .bold, design: .rounded))
                        .foregroundStyle(settingsText.opacity(0.88))
                    Text(exaApiKey.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "Provider Exa MCP is used first. Add this only as a fallback." : "News Market Radar can fall back to this Exa API key.")
                        .font(.system(size: 12, weight: .semibold, design: .rounded))
                        .foregroundStyle(settingsText.opacity(0.52))
                }
                Spacer(minLength: 0)
            }

            secureAgentField(
                label: "EXA_API_KEY",
                placeholder: "exa_...",
                text: $exaApiKey,
                identifier: "settings.exa.apiKeyField"
            )

            Text("Fallback only for the News tab's Market Radar when Codex, Claude Code, or Gemini does not already expose Exa MCP. Queries may include the product name, public URL, and explicit competitors; raw Day answers and local excerpts stay on this Mac.")
                .font(.system(size: 12, weight: .medium, design: .rounded))
                .foregroundStyle(settingsText.opacity(0.44))
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(20)
        .background(cardBackground)
    }

    private func agentProviderSection(
        provider: AgentProvider,
        authMode: Binding<String>,
        apiKey: Binding<String>,
        environment: Binding<String>,
        modelSelection: Binding<String>
    ) -> some View {
        let mode = AgentAuthMode.normalized(authMode.wrappedValue, provider: provider)
        let status = providerEnvironment(for: provider)

        return VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .center, spacing: 14) {
                providerIcon(provider)

                VStack(alignment: .leading, spacing: 4) {
                    Text(providerSettingsTitle(provider))
                        .font(.system(size: 18, weight: .bold, design: .rounded))
                        .foregroundStyle(settingsText.opacity(0.88))

                    HStack(spacing: 8) {
                        Circle()
                            .fill((status?.available ?? false) ? Agentic30BrandColor.greenBright : Color(red: 0.96, green: 0.78, blue: 0.54))
                            .frame(width: 7, height: 7)
                        Text(providerStatusLabel(status))
                            .font(.system(size: 12, weight: .semibold, design: .rounded))
                            .foregroundStyle(settingsText.opacity(0.54))
                            .lineLimit(1)
                    }
                }

                Spacer(minLength: 0)
            }

            VStack(alignment: .leading, spacing: 8) {
                Text("Authenticate with")
                    .font(.system(size: 13, weight: .semibold, design: .rounded))
                    .foregroundStyle(settingsText.opacity(0.64))

                authModeMenu(provider: provider, selection: authMode)

                #if DEBUG
                if Self.isUITesting {
                    authModeUITestingShortcuts(provider: provider, selection: authMode)
                }
                #endif
            }

            agentAuthFields(
                provider: provider,
                mode: mode,
                apiKey: apiKey,
                environment: environment
            )

            modelPickerRow(
                provider: provider,
                selection: modelSelection
            )

            #if DEBUG
            if Self.isUITesting {
                modelUITestingShortcuts(provider: provider, selection: modelSelection)
            }
            #endif

            HStack(spacing: 10) {
                if let quickstartURL = providerQuickstartURL(provider) {
                    Link("Get started", destination: quickstartURL)
                        .font(.system(size: 12, weight: .bold, design: .rounded))
                        .foregroundStyle(settingsText.opacity(0.68))
                }
                if let configURL = providerConfigURL(provider) {
                    Link("Configure", destination: configURL)
                        .font(.system(size: 12, weight: .bold, design: .rounded))
                        .foregroundStyle(settingsText.opacity(0.68))
                }
            }
        }
        .padding(20)
        .background(cardBackground)
    }

    private var saveAgentSettingsSection: some View {
        HStack(spacing: 14) {
            Button(action: saveAgentSettingsValues) {
                Text("Save Agent Settings")
                    .font(.system(size: 14, weight: .bold, design: .rounded))
                    .foregroundStyle(settingsText.opacity(0.9))
                    .padding(.horizontal, 24)
                    .padding(.vertical, 10)
                    .background(Capsule().fill(settingsText.opacity(0.18)))
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("settings.agents.saveButton")

            if !agentSettingsSaveMessage.isEmpty {
                Text(agentSettingsSaveMessage)
                    .font(.system(size: 13, weight: .medium, design: .rounded))
                    .foregroundStyle(Agentic30BrandColor.green.opacity(0.8))
                    .transition(.opacity)
                    .accessibilityIdentifier("settings.agents.saveMessage")
            }

            Spacer()
        }
        .padding(.horizontal, 4)
    }

    private func providerIcon(_ provider: AgentProvider) -> some View {
        let symbol: String
        switch provider {
        case .claude:
            symbol = "sparkle"
        case .codex:
            symbol = "hexagon"
        case .gemini:
            symbol = "diamond"
        }

        return Image(systemName: symbol)
            .font(.system(size: 21, weight: .semibold))
            .foregroundStyle(settingsText.opacity(0.75))
            .frame(width: 44, height: 44)
            .background(settingsText.opacity(0.085), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
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

    private func providerStatusLabel(_ status: SidecarProviderEnvironment?) -> String {
        guard let status else { return "Checking local auth" }
        return "\(status.available ? "Ready" : "Not ready") · \(status.message)"
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
                    .font(.system(size: 14, weight: .bold, design: .rounded))
                    .foregroundStyle(settingsText.opacity(0.9))
                    .lineLimit(1)

                Spacer(minLength: 12)

                Image(systemName: "chevron.down")
                    .font(.system(size: 10, weight: .bold))
                    .foregroundStyle(settingsText.opacity(0.42))
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
            .frame(maxWidth: .infinity, alignment: .leading)
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

    @ViewBuilder
    private func agentAuthFields(
        provider: AgentProvider,
        mode: AgentAuthMode,
        apiKey: Binding<String>,
        environment: Binding<String>
    ) -> some View {
        switch mode {
        case .local:
            localAuthActions(provider)
        case .apiKey:
            secureAgentField(
                label: apiKeyLabel(provider),
                placeholder: apiKeyPlaceholder(provider),
                text: apiKey,
                identifier: "settings.\(provider.rawValue).apiKeyField"
            )
        case .bedrock, .vertex, .foundry, .custom:
            environmentEditor(
                label: environmentLabel(provider: provider, mode: mode),
                text: environment,
                identifier: "settings.\(provider.rawValue).environmentField"
            )
        }
    }

    @ViewBuilder
    private func localAuthActions(_ provider: AgentProvider) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(localAuthDescription(provider))
                .font(.system(size: 12, weight: .medium, design: .rounded))
                .foregroundStyle(settingsText.opacity(0.44))
                .fixedSize(horizontal: false, vertical: true)

            Button {
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
            } label: {
                HStack(spacing: 8) {
                    Image(systemName: provider == .gemini ? "terminal" : "person.crop.circle.badge.checkmark")
                        .font(.system(size: 12, weight: .bold))
                    Text(provider == .gemini ? "Run gcloud ADC login" : "Open \(provider.title) Auth")
                        .font(.system(size: 13, weight: .bold, design: .rounded))
                }
                .foregroundStyle(settingsText.opacity(0.86))
                .padding(.horizontal, 14)
                .padding(.vertical, 8)
                .background(Capsule().fill(settingsText.opacity(0.12)))
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("settings.\(provider.rawValue).openAuthButton")

            if provider == .gemini, let diagnostic = providerEnvironment(for: .gemini)?.geminiAdc, diagnostic.isGcloudMissing {
                Text("팁: Gemini API key를 쓰면 gcloud 설치 단계를 건너뛸 수 있습니다. (aistudio.google.com/apikey)")
                    .font(.system(size: 11, weight: .medium, design: .rounded))
                    .foregroundStyle(settingsText.opacity(0.6))
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("settings.gemini.byokHint")
            }

            if viewModel.providerAuthInProgress == provider {
                HStack(spacing: 8) {
                    ProgressView()
                        .controlSize(.small)
                    Text(viewModel.providerAuthMessage ?? "Authenticating...")
                        .font(.system(size: 12, weight: .semibold, design: .rounded))
                        .foregroundStyle(settingsText.opacity(0.55))
                }
            }
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

    private func localAuthDescription(_ provider: AgentProvider) -> String {
        switch provider {
        case .claude:
            return "Uses the local Claude Code login and settings.json on this Mac."
        case .codex:
            return "Uses the local Codex login and config.toml on this Mac."
        case .gemini:
            return "Uses Google Application Default Credentials (`gcloud auth application-default login`) on this Mac."
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
                .font(.system(size: 13, weight: .semibold, design: .rounded))
                .foregroundStyle(settingsText.opacity(0.6))
            SecureField(placeholder, text: text)
                .textFieldStyle(.plain)
                .font(.system(size: 14, weight: .medium, design: .monospaced))
                .foregroundStyle(settingsText.opacity(0.9))
                .padding(12)
                .background(fieldBackground)
                .accessibilityIdentifier(identifier)
        }
    }

    private func environmentEditor(
        label: String,
        text: Binding<String>,
        identifier: String
    ) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label)
                .font(.system(size: 13, weight: .semibold, design: .rounded))
                .foregroundStyle(settingsText.opacity(0.6))
            TextEditor(text: text)
                .font(.system(size: 12, weight: .medium, design: .monospaced))
                .foregroundStyle(settingsText.opacity(0.9))
                .scrollContentBackground(.hidden)
                .frame(minHeight: 86)
                .padding(8)
                .background(fieldBackground)
                .accessibilityIdentifier(identifier)
            Text("One KEY=VALUE pair per line.")
                .font(.system(size: 11, weight: .medium, design: .rounded))
                .foregroundStyle(settingsText.opacity(0.36))
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

    private func modelPickerRow(
        provider: AgentProvider,
        selection: Binding<String>
    ) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(provider.subtitle)
                        .font(.system(size: 13, weight: .bold, design: .rounded))
                        .foregroundStyle(settingsText.opacity(0.72))
                    Text(providerFamilyLabel(provider))
                        .font(.system(size: 10, weight: .bold, design: .rounded))
                        .foregroundStyle(settingsText.opacity(0.34))
                }

                Spacer(minLength: 12)

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
                            .font(.system(size: 14, weight: .bold, design: .rounded))
                            .foregroundStyle(settingsText.opacity(0.9))
                            .lineLimit(1)
                            .truncationMode(.tail)

                        Image(systemName: "chevron.up.chevron.down")
                            .font(.system(size: 10, weight: .bold))
                            .foregroundStyle(settingsText.opacity(0.42))
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 10)
                    .frame(width: 230, alignment: .leading)
                    .background(fieldBackground)
                }
                .menuStyle(.button)
                .buttonStyle(.plain)
                .accessibilityIdentifier("settings.\(provider.rawValue).modelPicker")
            }

            Text(selection.wrappedValue)
                .font(.system(size: 11, weight: .medium, design: .monospaced))
                .foregroundStyle(settingsText.opacity(0.36))
                .accessibilityIdentifier("settings.\(provider.rawValue).modelID")
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

    // MARK: - Ad Analytics Tab

    private var adAnalyticsTab: some View {
        settingsTabScaffold(
            title: "Ad Analytics Settings",
            subtitle: "Configure API keys for /analyze-ads command. Environment variables take priority over these values."
        ) {
            posthogSection
            metaSection
            adActionsSection
        }
    }

    // MARK: - BIP Tab

    private var bipTab: some View {
        settingsTabScaffold(
            title: "Build In Public",
            subtitle: "Configure project docs, Google Docs/Sheets evidence, and Threads for daily public execution."
        ) {
            workspaceSection
            externalDocsSection
            socialSection
            bipActionsSection
        }
    }

    // MARK: - Notion Tab

    private var notionTab: some View {
        settingsTabScaffold(
            title: "Notion",
            subtitle: "Connect your Notion workspace via the official Notion MCP server. Uses OAuth — no API key needed."
        ) {
            notionConnectionSection
            notionInfoSection
        }
    }

    // MARK: - Notion Section

    private var notionConnectionSection: some View {
        VStack(alignment: .leading, spacing: 16) {
            sectionHeader(title: "Connection", configured: viewModel.notionConnected)

            if viewModel.notionConnected {
                // Connected state
                HStack(spacing: 12) {
                    Circle()
                        .fill(Agentic30BrandColor.green.opacity(0.8))
                        .frame(width: 8, height: 8)
                    Text("Connected to Notion")
                        .font(.system(size: 14, weight: .semibold, design: .rounded))
                        .foregroundStyle(settingsText.opacity(0.9))
                    Spacer()
                    Button(action: {
                        viewModel.disconnectNotion()
                    }) {
                        Text("Disconnect")
                            .font(.system(size: 13, weight: .bold, design: .rounded))
                            .foregroundStyle(.red.opacity(0.8))
                            .padding(.horizontal, 16)
                            .padding(.vertical, 8)
                            .background(Capsule().fill(Color.red.opacity(0.1)))
                    }
                    .buttonStyle(.plain)
                }

                Text("Notion tools are available in all Claude and Codex sessions.")
                    .font(.system(size: 12, weight: .medium, design: .rounded))
                    .foregroundStyle(settingsText.opacity(0.45))

            } else if viewModel.notionOAuthInProgress {
                // OAuth in progress
                HStack(spacing: 12) {
                    ProgressView()
                        .controlSize(.small)
                        .tint(settingsText.opacity(0.6))
                    Text("Waiting for authorization...")
                        .font(.system(size: 14, weight: .medium, design: .rounded))
                        .foregroundStyle(settingsText.opacity(0.7))
                }

            } else {
                // Disconnected state
                VStack(alignment: .leading, spacing: 12) {
                    Text("Not connected")
                        .font(.system(size: 14, weight: .medium, design: .rounded))
                        .foregroundStyle(settingsText.opacity(0.5))

                    Button(action: {
                        viewModel.startNotionOAuth()
                    }) {
                        HStack(spacing: 8) {
                            Image(systemName: "link.badge.plus")
                            Text("Connect to Notion")
                        }
                        .font(.system(size: 14, weight: .bold, design: .rounded))
                        .foregroundStyle(settingsText.opacity(0.9))
                        .padding(.horizontal, 24)
                        .padding(.vertical, 10)
                        .background(Capsule().fill(settingsText.opacity(0.18)))
                    }
                    .buttonStyle(.plain)

                    if let error = viewModel.notionOAuthError {
                        Text(error)
                            .font(.system(size: 12, weight: .medium, design: .rounded))
                            .foregroundStyle(.red.opacity(0.8))
                    }
                }
            }
        }
        .padding(20)
        .background(cardBackground)
    }

    private var notionInfoSection: some View {
        VStack(alignment: .leading, spacing: 16) {
            sectionHeader(title: "How It Works", configured: false)

            VStack(alignment: .leading, spacing: 12) {
                notionInfoRow(
                    icon: "1.circle.fill",
                    text: "Click \"Connect to Notion\" — a sign-in window will appear"
                )
                notionInfoRow(
                    icon: "2.circle.fill",
                    text: "Sign in to Notion and grant workspace access"
                )
                notionInfoRow(
                    icon: "3.circle.fill",
                    text: "The window closes automatically — all sessions now have Notion read/write"
                )
            }

            Text("OAuth tokens are stored locally and refreshed automatically.")
                .font(.system(size: 12, weight: .medium, design: .rounded))
                .foregroundStyle(settingsText.opacity(0.35))
        }
        .padding(20)
        .background(cardBackground)
    }

    // MARK: - Developer Tools Tab

    private var developerToolsTab: some View {
        settingsTabScaffold(
            title: "Developer Tools",
            subtitle: "Trigger local app flows without waiting for scheduled automation."
        ) {
            notificationTestSection
            confettiTestSection
        }
    }

    private var notificationTestSection: some View {
        VStack(alignment: .leading, spacing: 16) {
            sectionHeader(title: "BIP Notifications", configured: true)

            Text("테스트 알림은 실제 macOS 알림 센터 경로를 사용합니다. 배너를 누르면 Agentic30이 열리고 BIP 알림 task surface로 이동합니다.")
                .font(.system(size: 13, weight: .medium, design: .rounded))
                .foregroundStyle(settingsText.opacity(0.50))
                .fixedSize(horizontal: false, vertical: true)

            HStack(spacing: 12) {
                developerToolButton(
                    title: "10시 알림 보내기",
                    systemImage: "sun.max.fill",
                    identifier: "settings.developerTools.sendMorningBipNotification"
                ) {
                    sendTestBipNotification(.morning)
                }

                developerToolButton(
                    title: "21시 알림 보내기",
                    systemImage: "moon.fill",
                    identifier: "settings.developerTools.sendEveningBipNotification"
                ) {
                    sendTestBipNotification(.evening)
                }
            }

            if !developerToolsMessage.isEmpty {
                Text(developerToolsMessage)
                    .font(.system(size: 12, weight: .semibold, design: .rounded))
                    .foregroundStyle(Agentic30BrandColor.green.opacity(0.82))
                    .fixedSize(horizontal: false, vertical: true)
                    .transition(.opacity)
                    .accessibilityIdentifier("settings.developerTools.message")
            }
        }
        .padding(20)
        .background(cardBackground)
    }

    private var confettiTestSection: some View {
        VStack(alignment: .leading, spacing: 16) {
            sectionHeader(title: "UI Motion Test", configured: confettiTestRunID > 0)
            confettiTestControls
        }
        .padding(20)
        .background(cardBackground)
    }

    private var confettiTestControls: some View {
        VStack(alignment: .leading, spacing: 7) {
            Text("앱 화면 전체에 realistic confetti burst를 재생합니다.")
                .font(.system(size: 13, weight: .medium, design: .rounded))
                .foregroundStyle(settingsText.opacity(0.50))
                .fixedSize(horizontal: false, vertical: true)

            developerToolButton(
                title: "Confetti 테스트",
                systemImage: "sparkles",
                identifier: "settings.developerTools.confettiTestButton"
            ) {
                playConfettiTest()
            }

            if !confettiTestMessage.isEmpty {
                Text(confettiTestMessage)
                    .font(.system(size: 12, weight: .semibold, design: .rounded))
                    .foregroundStyle(Agentic30BrandColor.green.opacity(0.82))
                    .fixedSize(horizontal: false, vertical: true)
                    .transition(.opacity)
                    .accessibilityIdentifier("settings.developerTools.confettiTestMessage")
            }
        }
    }

    private func developerToolButton(
        title: String,
        systemImage: String,
        identifier: String,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            HStack(spacing: 8) {
                Image(systemName: systemImage)
                    .font(.system(size: 13, weight: .semibold))
                Text(title)
                    .font(.system(size: 14, weight: .bold, design: .rounded))
            }
            .foregroundStyle(settingsText.opacity(0.9))
            .padding(.horizontal, 18)
            .padding(.vertical, 10)
            .background(Capsule().fill(settingsText.opacity(0.16)))
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier(identifier)
    }

    // MARK: - Diagnostics Tab

    private var diagnosticsTab: some View {
        settingsTabScaffold(
            title: "Diagnostics",
            subtitle: "Copy a redacted runtime snapshot for debugging sidecar, provider, storage, and preflight issues."
        ) {
            diagnosticsSummarySection
            diagnosticsActionsSection
            diagnosticsReportSection
        }
    }

    private var diagnosticsSummarySection: some View {
        VStack(alignment: .leading, spacing: 16) {
            sectionHeader(
                title: "Sidecar Health",
                configured: viewModel.sidecarDiagnostics?.preflight?.status == "ok"
            )

            if let diagnostics = viewModel.sidecarDiagnostics {
                diagnosticsRow(label: "Generated", value: diagnostics.generatedAt.description)
                diagnosticsRow(label: "Node", value: diagnostics.runtime.node ?? "unknown")
                diagnosticsRow(label: "Sessions", value: "\(diagnostics.sessions.total) total, \(diagnostics.sessions.activeRuns) active")
                diagnosticsRow(label: "Preflight", value: diagnostics.preflight?.status ?? "unknown")

                if let checks = diagnostics.preflight?.checks {
                    VStack(alignment: .leading, spacing: 8) {
                        ForEach(checks) { check in
                            VStack(alignment: .leading, spacing: 3) {
                                Text("[\(check.status)] \(check.title)")
                                    .font(.system(size: 12, weight: .bold, design: .rounded))
                                    .foregroundStyle(color(for: check.status).opacity(0.95))
                                if let message = check.message {
                                    Text(message)
                                        .font(.system(size: 11, weight: .medium, design: .monospaced))
                                        .foregroundStyle(settingsText.opacity(0.45))
                                        .lineLimit(2)
                                }
                                if let recovery = check.recovery {
                                    Text(recovery)
                                        .font(.system(size: 11, weight: .medium, design: .rounded))
                                        .foregroundStyle(settingsText.opacity(0.5))
                                }
                            }
                            .padding(10)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(settingsText.opacity(0.04))
                            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                        }
                    }
                }
            } else {
                Text("Diagnostics are not available until the sidecar connects.")
                    .font(.system(size: 13, weight: .medium, design: .rounded))
                    .foregroundStyle(settingsText.opacity(0.5))
            }
        }
        .padding(20)
        .background(cardBackground)
    }

    private var diagnosticsActionsSection: some View {
        HStack(spacing: 14) {
            Button(action: refreshDiagnostics) {
                Text("Refresh")
                    .font(.system(size: 14, weight: .bold, design: .rounded))
                    .foregroundStyle(settingsText.opacity(0.9))
                    .padding(.horizontal, 24)
                    .padding(.vertical, 10)
                    .background(Capsule().fill(settingsText.opacity(0.18)))
            }
            .buttonStyle(.plain)

            Button(action: copyDiagnostics) {
                Text("Copy Diagnostics")
                    .font(.system(size: 14, weight: .bold, design: .rounded))
                    .foregroundStyle(settingsText.opacity(0.75))
                    .padding(.horizontal, 24)
                    .padding(.vertical, 10)
                    .background(Capsule().fill(settingsText.opacity(0.08)))
            }
            .buttonStyle(.plain)

            if !diagnosticsMessage.isEmpty {
                Text(diagnosticsMessage)
                    .font(.system(size: 13, weight: .medium, design: .rounded))
                    .foregroundStyle(Agentic30BrandColor.green.opacity(0.8))
                    .transition(.opacity)
            }

            Spacer()
        }
    }

    private var diagnosticsReportSection: some View {
        ScrollView {
            Text(viewModel.diagnosticsReport)
                .font(.system(size: 11, weight: .medium, design: .monospaced))
                .foregroundStyle(settingsText.opacity(0.58))
                .frame(maxWidth: .infinity, alignment: .leading)
                .textSelection(.enabled)
                .padding(14)
        }
        .frame(minHeight: 220)
        .background(fieldBackground)
    }

    private func diagnosticsRow(label: String, value: String) -> some View {
        HStack(alignment: .top) {
            Text(label)
                .font(.system(size: 12, weight: .bold, design: .rounded))
                .foregroundStyle(settingsText.opacity(0.5))
                .frame(width: 96, alignment: .leading)
            Text(value)
                .font(.system(size: 12, weight: .medium, design: .monospaced))
                .foregroundStyle(settingsText.opacity(0.74))
                .lineLimit(2)
            Spacer(minLength: 0)
        }
    }

    private func notionInfoRow(icon: String, text: String) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: icon)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(settingsText.opacity(0.5))
                .frame(width: 22)
            Text(text)
                .font(.system(size: 13, weight: .medium, design: .rounded))
                .foregroundStyle(settingsText.opacity(0.7))
        }
    }

    // MARK: - PostHog Section

    private var posthogSection: some View {
        VStack(alignment: .leading, spacing: 16) {
            sectionHeader(
                title: "PostHog",
                configured: !posthogApiKey.isEmpty || !posthogProjectAPIKey.isEmpty
            )

            VStack(alignment: .leading, spacing: 6) {
                Text("MCP / Personal API Key")
                    .font(.system(size: 13, weight: .semibold, design: .rounded))
                    .foregroundStyle(settingsText.opacity(0.6))
                SecureField("phx_...", text: $posthogApiKey)
                    .textFieldStyle(.plain)
                    .font(.system(size: 14, weight: .medium, design: .monospaced))
                    .foregroundStyle(settingsText.opacity(0.9))
                    .padding(12)
                    .background(fieldBackground)
            }

            VStack(alignment: .leading, spacing: 6) {
                Text("Project API Key")
                    .font(.system(size: 13, weight: .semibold, design: .rounded))
                    .foregroundStyle(settingsText.opacity(0.6))
                SecureField("phc_...", text: $posthogProjectAPIKey)
                    .textFieldStyle(.plain)
                    .font(.system(size: 14, weight: .medium, design: .monospaced))
                    .foregroundStyle(settingsText.opacity(0.9))
                    .padding(12)
                    .background(fieldBackground)
            }

            VStack(alignment: .leading, spacing: 6) {
                Text("PostHog API Host")
                    .font(.system(size: 13, weight: .semibold, design: .rounded))
                    .foregroundStyle(settingsText.opacity(0.6))
                TextField("https://us.posthog.com", text: $posthogHost)
                    .textFieldStyle(.plain)
                    .font(.system(size: 14, weight: .medium, design: .monospaced))
                    .foregroundStyle(settingsText.opacity(0.9))
                    .padding(12)
                    .background(fieldBackground)
            }

            VStack(alignment: .leading, spacing: 10) {
                Text("MCP Endpoint")
                    .font(.system(size: 13, weight: .semibold, design: .rounded))
                    .foregroundStyle(settingsText.opacity(0.6))

                Picker("MCP Region", selection: $posthogMcpRegion) {
                    Text("US").tag("us")
                    Text("EU").tag("eu")
                }
                .pickerStyle(.segmented)
                .labelsHidden()
                .tint(settingsAccentColor)
                .onChange(of: posthogMcpRegion) { _, newValue in
                    if posthogMcpURL == KeychainHelper.Settings.defaultPostHogMcpURL
                        || posthogMcpURL == KeychainHelper.Settings.defaultPostHogEuMcpURL
                        || posthogMcpURL.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                        if newValue == "eu" {
                            posthogMcpURL = KeychainHelper.Settings.defaultPostHogEuMcpURL
                        } else {
                            posthogMcpURL = KeychainHelper.Settings.defaultPostHogMcpURL
                        }
                    }
                }

                TextField("https://mcp.posthog.com/mcp", text: $posthogMcpURL)
                    .textFieldStyle(.plain)
                    .font(.system(size: 14, weight: .medium, design: .monospaced))
                    .foregroundStyle(settingsText.opacity(0.9))
                    .padding(12)
                    .background(fieldBackground)

                Toggle(isOn: $posthogMcpReadonly) {
                    Text("Read-only MCP tools")
                        .font(.system(size: 13, weight: .semibold, design: .rounded))
                        .foregroundStyle(settingsText.opacity(0.86))
                }
                .toggleStyle(.switch)
                .tint(Agentic30BrandColor.green)

                TextField(KeychainHelper.Settings.defaultPostHogMcpFeatures, text: $posthogMcpFeatures)
                    .textFieldStyle(.plain)
                    .font(.system(size: 12, weight: .medium, design: .monospaced))
                    .foregroundStyle(settingsText.opacity(0.84))
                    .padding(12)
                    .background(fieldBackground)
            }

            Text("`phx_`/`pha_` key는 MCP 조회용이고, 앱/sidecar 이벤트 수집은 `phc_` project key를 사용합니다. Codex CLI 동기화는 토큰 원문 대신 `POSTHOG_MCP_API_KEY` env var를 참조합니다.")
                .font(.system(size: 12, weight: .medium, design: .rounded))
                .foregroundStyle(settingsText.opacity(0.44))

            if !posthogApiKey.isEmpty && posthogProjectAPIKey.isEmpty {
                Text("MCP/조회는 설정되었지만 앱 이벤트 수집은 아직 비활성 상태입니다. `phc_` project key를 추가하거나, 비워두면 빌드 기본값을 사용합니다.")
                    .font(.system(size: 12, weight: .medium, design: .rounded))
                    .foregroundStyle(.orange.opacity(0.78))
            }

            Divider().padding(.vertical, 4)

            Toggle(isOn: $telemetryDisabled) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("이 디바이스에서 telemetry 비활성화")
                        .font(.system(size: 13, weight: .semibold, design: .rounded))
                        .foregroundStyle(settingsText.opacity(0.86))
                    Text("켜면 PostHog 이벤트 전송이 즉시 중단됩니다. distinct_id는 보존되어 재활성화 시 동일 사용자로 묶입니다.")
                        .font(.system(size: 12, weight: .medium, design: .rounded))
                        .foregroundStyle(settingsText.opacity(0.5))
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .toggleStyle(.switch)
            .tint(Agentic30BrandColor.green)
            .onChange(of: telemetryDisabled) { _, newValue in
                // When user is DISABLING, fire the event first (and block briefly)
                // while telemetry is still enabled, otherwise loadConfig() returns
                // nil and we'd lose the opt-out signal entirely.
                if newValue {
                    PostHogTelemetry.captureBlocking(
                        "mac_settings_telemetry_pref_changed",
                        properties: ["disabled": true]
                    )
                    PostHogTelemetry.setTelemetryDisabledByUser(true)
                } else {
                    PostHogTelemetry.setTelemetryDisabledByUser(false)
                    PostHogTelemetry.capture(
                        "mac_settings_telemetry_pref_changed",
                        properties: ["disabled": false]
                    )
                }
            }
        }
        .padding(20)
        .background(cardBackground)
    }

    // MARK: - Meta Section

    private var metaSection: some View {
        VStack(alignment: .leading, spacing: 16) {
            sectionHeader(title: "Meta Ads", configured: !metaAccessToken.isEmpty && !metaAdAccountId.isEmpty)

            VStack(alignment: .leading, spacing: 6) {
                Text("Access Token")
                    .font(.system(size: 13, weight: .semibold, design: .rounded))
                    .foregroundStyle(settingsText.opacity(0.6))
                SecureField("EAA...", text: $metaAccessToken)
                    .textFieldStyle(.plain)
                    .font(.system(size: 14, weight: .medium, design: .monospaced))
                    .foregroundStyle(settingsText.opacity(0.9))
                    .padding(12)
                    .background(fieldBackground)
            }

            VStack(alignment: .leading, spacing: 6) {
                Text("Ad Account ID")
                    .font(.system(size: 13, weight: .semibold, design: .rounded))
                    .foregroundStyle(settingsText.opacity(0.6))
                TextField("act_123456789", text: $metaAdAccountId)
                    .textFieldStyle(.plain)
                    .font(.system(size: 14, weight: .medium, design: .monospaced))
                    .foregroundStyle(settingsText.opacity(0.9))
                    .padding(12)
                    .background(fieldBackground)
            }
        }
        .padding(20)
        .background(cardBackground)
    }

    // MARK: - Workspace Section

    private var workspaceSection: some View {
        VStack(alignment: .leading, spacing: 16) {
            sectionHeader(title: "Project Workspace", configured: !bipWorkspaceRoot.isEmpty)

            VStack(alignment: .leading, spacing: 6) {
                Text("Workspace Root")
                    .font(.system(size: 13, weight: .semibold, design: .rounded))
                    .foregroundStyle(settingsText.opacity(0.6))
                HStack(spacing: 8) {
                    TextField("/Users/you/project", text: $bipWorkspaceRoot)
                        .textFieldStyle(.plain)
                        .font(.system(size: 14, weight: .medium, design: .monospaced))
                        .foregroundStyle(settingsText.opacity(0.9))
                        .padding(12)
                        .background(fieldBackground)

                    Button(action: pickFolder) {
                        Image(systemName: "folder")
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(settingsText.opacity(0.6))
                            .padding(12)
                            .background(fieldBackground)
                    }
                    .buttonStyle(.plain)

                    Button(action: triggerScan) {
                        if viewModel.isScanning {
                            ProgressView()
                                .controlSize(.small)
                                .padding(8)
                                .background(fieldBackground)
                        } else {
                            Image(systemName: "sparkle.magnifyingglass")
                                .font(.system(size: 14, weight: .semibold))
                                .foregroundStyle(settingsText.opacity(0.6))
                                .padding(12)
                                .background(fieldBackground)
                        }
                    }
                    .buttonStyle(.plain)
                    .disabled(bipWorkspaceRoot.isEmpty || viewModel.isScanning)
                    .help("Agent scans workspace for docs")
                }
            }

        if viewModel.isScanning {
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 8) {
                    ProgressView()
                        .controlSize(.mini)
                    Text(scanProgressText)
                        .font(.system(size: 12, weight: .semibold, design: .rounded))
                        .foregroundStyle(Color(red: 0.96, green: 0.78, blue: 0.54).opacity(0.9))
                }

                if !scanProgressLogLines.isEmpty {
                    VStack(alignment: .leading, spacing: 4) {
                        ForEach(scanProgressLogLines, id: \.self) { line in
                            Text("• \(line)")
                                .font(.system(size: 11, weight: .medium, design: .monospaced))
                                .foregroundStyle(settingsText.opacity(0.48))
                                .lineLimit(2)
                                .textSelection(.enabled)
                        }
                    }
                    .padding(.horizontal, 10)
                    .padding(.vertical, 8)
                    .background(fieldBackground)
                }
            }
            .transition(.opacity)
        }

            if !scanMessage.isEmpty {
                Text(scanMessage)
                    .font(.system(size: 12, weight: .semibold, design: .rounded))
                    .foregroundStyle(Agentic30BrandColor.greenBright.opacity(0.9))
                    .transition(.opacity)
            }

            docField(label: "ICP", placeholder: "docs/ICP.md", text: $bipIcpPath, docType: "icp", detectedPath: viewModel.scanResult?.icp)
            docField(label: "SPEC", placeholder: "docs/SPEC.md", text: $bipSpecPath, docType: "spec", detectedPath: viewModel.scanResult?.spec)
            docField(label: "VALUES", placeholder: "docs/VALUES.md", text: $bipValuesPath, docType: "values", detectedPath: viewModel.scanResult?.values)
            docField(label: "Design System", placeholder: "docs/DESIGN_SYSTEM.md", text: $bipDesignSystemPath, docType: "designSystem", detectedPath: viewModel.scanResult?.designSystem)
            docField(label: "ADR", placeholder: "docs/ADR.md", text: $bipAdrPath, docType: "adr", detectedPath: viewModel.scanResult?.adr)
            docField(label: "Goal", placeholder: "docs/GOAL.md", text: $bipGoalPath, docType: "goal", detectedPath: viewModel.scanResult?.goal)
            docField(label: "Docs", placeholder: "docs/DOCS.md", text: $bipDocsPath, docType: "docs", detectedPath: viewModel.scanResult?.docs)
            docField(label: "Sheet", placeholder: "docs/SHEET.md", text: $bipSheetPath, docType: "sheet", detectedPath: viewModel.scanResult?.sheet)

            Text("Paths relative to workspace root. Agent auto-detects on scan.")
                .font(.system(size: 12, weight: .medium, design: .rounded))
                .foregroundStyle(settingsText.opacity(0.35))
        }
        .padding(20)
        .background(cardBackground)
    }

    // MARK: - External Docs Section

    private var externalDocsSection: some View {
        VStack(alignment: .leading, spacing: 16) {
            sectionHeader(
                title: "External Documents",
                configured: !bipGdocsUrls.isEmpty || !bipGsheetsUrls.isEmpty || !bipNotionUrls.isEmpty
            )

            Text("처음 설정은 Chat Assistant 안의 오늘 실행 카드에서 진행하세요. 이 영역은 고급 사용자용 수동 연결입니다.")
                .font(.system(size: 12, weight: .semibold, design: .rounded))
                .foregroundStyle(settingsText.opacity(0.58))
                .fixedSize(horizontal: false, vertical: true)

            settingsField(label: "Google Docs 수동 연결 URL", placeholder: "https://docs.google.com/... (comma-separated)", text: $bipGdocsUrls)
            settingsField(label: "Google Sheets 수동 연결 URL", placeholder: "https://docs.google.com/spreadsheets/... (comma-separated)", text: $bipGsheetsUrls)
            settingsField(label: "Notion Pages", placeholder: "https://notion.so/... (comma-separated)", text: $bipNotionUrls)

            Text("Chat Assistant 안의 오늘 실행 카드가 업무일지 Doc과 게시글 Sheet 템플릿을 내 Drive에 복사하고 자동 연결합니다. 수동 URL은 복구나 이전 연결 유지가 필요할 때만 사용하세요.")
                .font(.system(size: 12, weight: .medium, design: .rounded))
                .foregroundStyle(settingsText.opacity(0.42))
        }
        .padding(20)
        .background(cardBackground)
    }

    // MARK: - Social Section

    private var socialSection: some View {
        VStack(alignment: .leading, spacing: 16) {
            sectionHeader(
                title: "Social Media",
                configured: !bipThreadsHandle.isEmpty || !bipXHandle.isEmpty
            )

            VStack(alignment: .leading, spacing: 6) {
                Text("Threads")
                    .font(.system(size: 13, weight: .semibold, design: .rounded))
                    .foregroundStyle(settingsText.opacity(0.6))
                HStack(spacing: 0) {
                    Text("@")
                        .font(.system(size: 14, weight: .medium, design: .monospaced))
                        .foregroundStyle(settingsText.opacity(0.4))
                        .padding(.leading, 12)
                    TextField("handle", text: $bipThreadsHandle)
                        .textFieldStyle(.plain)
                        .font(.system(size: 14, weight: .medium, design: .monospaced))
                        .foregroundStyle(settingsText.opacity(0.9))
                        .padding(12)
                }
                .background(fieldBackground)
            }

            VStack(alignment: .leading, spacing: 6) {
                Text("X (Twitter)")
                    .font(.system(size: 13, weight: .semibold, design: .rounded))
                    .foregroundStyle(settingsText.opacity(0.6))
                HStack(spacing: 0) {
                    Text("@")
                        .font(.system(size: 14, weight: .medium, design: .monospaced))
                        .foregroundStyle(settingsText.opacity(0.4))
                        .padding(.leading, 12)
                    TextField("handle", text: $bipXHandle)
                        .textFieldStyle(.plain)
                        .font(.system(size: 14, weight: .medium, design: .monospaced))
                        .foregroundStyle(settingsText.opacity(0.9))
                        .padding(12)
                }
                .background(fieldBackground)
            }
        }
        .padding(20)
        .background(cardBackground)
    }

    // MARK: - Actions

    private var adActionsSection: some View {
        HStack(spacing: 14) {
            Button(action: saveAdValues) {
                Text("Save")
                    .font(.system(size: 14, weight: .bold, design: .rounded))
                    .foregroundStyle(settingsText.opacity(0.9))
                    .padding(.horizontal, 24)
                    .padding(.vertical, 10)
                    .background(Capsule().fill(settingsText.opacity(0.18)))
            }
            .buttonStyle(.plain)

            Button(action: clearAdValues) {
                Text("Clear All")
                    .font(.system(size: 14, weight: .bold, design: .rounded))
                    .foregroundStyle(settingsText.opacity(0.5))
                    .padding(.horizontal, 24)
                    .padding(.vertical, 10)
                    .background(Capsule().fill(settingsText.opacity(0.06)))
            }
            .buttonStyle(.plain)

            if !adSaveMessage.isEmpty {
                Text(adSaveMessage)
                    .font(.system(size: 13, weight: .medium, design: .rounded))
                    .foregroundStyle(Agentic30BrandColor.green.opacity(0.8))
                    .transition(.opacity)
            }

            Spacer()
        }
    }

    private var bipActionsSection: some View {
        HStack(spacing: 14) {
            Button(action: saveBipValues) {
                Text("Save")
                    .font(.system(size: 14, weight: .bold, design: .rounded))
                    .foregroundStyle(settingsText.opacity(0.9))
                    .padding(.horizontal, 24)
                    .padding(.vertical, 10)
                    .background(Capsule().fill(settingsText.opacity(0.18)))
            }
            .buttonStyle(.plain)

            Button(action: clearBipValues) {
                Text("Clear All")
                    .font(.system(size: 14, weight: .bold, design: .rounded))
                    .foregroundStyle(settingsText.opacity(0.5))
                    .padding(.horizontal, 24)
                    .padding(.vertical, 10)
                    .background(Capsule().fill(settingsText.opacity(0.06)))
            }
            .buttonStyle(.plain)

            if !bipSaveMessage.isEmpty {
                Text(bipSaveMessage)
                    .font(.system(size: 13, weight: .medium, design: .rounded))
                    .foregroundStyle(Agentic30BrandColor.green.opacity(0.8))
                    .transition(.opacity)
            }

            Spacer()
        }
    }

    // MARK: - Helpers

    private func saveCurrentSettingsForSelectedSection() {
        switch selectedSection.wrappedValue {
        case .agents:
            saveAgentSettingsValues()
        case .adAnalytics:
            saveAdValues()
        case .buildInPublic:
            saveBipValues()
        default:
            let settings = currentSettings()
            try? KeychainHelper.saveSettings(settings)
            KeychainHelper.syncAllConfigFiles(from: settings)
            viewModel.syncProviderSettingsToSidecar(settings)
        }
    }

    private func settingsTabScaffold<Content: View>(
        title: String,
        subtitle: String,
        @ViewBuilder content: () -> Content
    ) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: settingsSectionSpacing) {
                content()
            }
            .frame(maxWidth: 820, alignment: .leading)
            .padding(.horizontal, embeddedInWorkspace ? 28 : 28)
            .padding(.vertical, embeddedInWorkspace ? 22 : 22)
            .frame(maxWidth: .infinity)
        }
        .accessibilityIdentifier("settings.contentScroll")
        .background(settingsTabBackground)
    }

    private func settingsPageHeader(title: String, subtitle: String) -> some View {
        VStack(alignment: .leading, spacing: embeddedInWorkspace ? 10 : 8) {
            if embeddedInWorkspace {
                HStack(spacing: 8) {
                    Text("Settings")
                        .font(.system(size: 11, weight: .bold, design: .rounded))
                        .foregroundStyle(settingsAccentColor)
                        .padding(.horizontal, 9)
                        .padding(.vertical, 5)
                        .background(Capsule().fill(settingsAccentColor.opacity(0.13)))

                    Text(selectedSection.wrappedValue.sidebarTitle)
                        .font(.system(size: 11, weight: .bold, design: .rounded))
                        .foregroundStyle(settingsText.opacity(0.52))
                }
            }

            Text(title)
                .font(.system(size: embeddedInWorkspace ? 27 : 26, weight: .bold, design: .rounded))
                .foregroundStyle(settingsText.opacity(0.96))
                .fixedSize(horizontal: false, vertical: true)

            Text(subtitle)
                .font(.system(size: embeddedInWorkspace ? 14 : 14, weight: embeddedInWorkspace ? .semibold : .medium, design: .rounded))
                .foregroundStyle(settingsText.opacity(embeddedInWorkspace ? 0.58 : 0.50))
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(embeddedInWorkspace ? 18 : 0)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background {
            if embeddedInWorkspace {
                cardBackground
            }
        }
    }

    @ViewBuilder
    private var settingsTabBackground: some View {
        settingsBackground.ignoresSafeArea()
    }

    private var settingsSectionSpacing: CGFloat {
        embeddedInWorkspace ? 16 : 24
    }

    private var settingsAccentColor: Color {
        OpenDesignDayColor.accent
    }

    private func settingsField(label: String, placeholder: String, text: Binding<String>) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label)
                .font(.system(size: 13, weight: .semibold, design: .rounded))
                .foregroundStyle(settingsText.opacity(0.6))
            TextField(placeholder, text: text)
                .textFieldStyle(.plain)
                .font(.system(size: 14, weight: .medium, design: .monospaced))
                .foregroundStyle(settingsText.opacity(0.9))
                .padding(12)
                .background(fieldBackground)
        }
    }

    private var scanProgressText: String {
        let text = viewModel.scanProgressMessage.trimmingCharacters(in: .whitespacesAndNewlines)
        return text.isEmpty ? "Agent is exploring your workspace..." : text
    }

    private var scanProgressLogLines: [String] {
        Array(viewModel.scanProgressLogs.suffix(8))
    }

    private func localDocExists(_ relativePath: String) -> Bool {
        let trimmedRoot = bipWorkspaceRoot.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedPath = relativePath.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedRoot.isEmpty, !trimmedPath.isEmpty else { return false }

        let rootURL = URL(fileURLWithPath: trimmedRoot, isDirectory: true).standardizedFileURL
        let candidateURL = URL(fileURLWithPath: trimmedPath, relativeTo: rootURL).standardizedFileURL
        guard candidateURL.path == rootURL.path || candidateURL.path.hasPrefix(rootURL.path + "/") else {
            return false
        }

        var isDirectory: ObjCBool = false
        return FileManager.default.fileExists(atPath: candidateURL.path, isDirectory: &isDirectory)
            && !isDirectory.boolValue
    }

    private func docField(label: String, placeholder: String, text: Binding<String>, docType: String, detectedPath: String?) -> some View {
        let hasScanned = viewModel.scanResult != nil && viewModel.scanResult?.error == nil
        let configuredPath = text.wrappedValue.trimmingCharacters(in: .whitespacesAndNewlines)
        let detected = detectedPath != nil
        let exists = configuredPath.isEmpty ? false : localDocExists(configuredPath)
        let missing = hasScanned && !detected && !exists
        let creating = viewModel.isCreatingDoc == docType

        return VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                Text(label)
                    .font(.system(size: 13, weight: .semibold, design: .rounded))
                    .foregroundStyle(settingsText.opacity(0.6))
                if detected {
                    Text("auto-detected")
                        .font(.system(size: 10, weight: .bold, design: .rounded))
                        .foregroundStyle(Agentic30BrandColor.greenBright)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(
                            Capsule()
                                .fill(Agentic30BrandColor.greenBright.opacity(0.15))
                        )
                } else if exists {
                    Text("verified")
                        .font(.system(size: 10, weight: .bold, design: .rounded))
                        .foregroundStyle(Agentic30BrandColor.greenBright)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(
                            Capsule()
                                .fill(Agentic30BrandColor.greenBright.opacity(0.15))
                        )
                } else if missing {
                    Text("not found")
                        .font(.system(size: 10, weight: .bold, design: .rounded))
                        .foregroundStyle(Color(red: 0.96, green: 0.78, blue: 0.54))
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(
                            Capsule()
                                .fill(Color(red: 0.96, green: 0.78, blue: 0.54).opacity(0.15))
                        )
                }
                Spacer()
                if creating {
                    HStack(spacing: 4) {
                        ProgressView()
                            .controlSize(.mini)
                        Text(viewModel.docCreationLogs.last ?? "Starting agent...")
                            .font(.system(size: 10, weight: .medium, design: .monospaced))
                            .foregroundStyle(settingsText.opacity(0.5))
                            .lineLimit(1)
                            .truncationMode(.middle)
                    }
                } else if missing {
                    Button { createDoc(type: docType) } label: {
                        HStack(spacing: 4) {
                            Image(systemName: "sparkles")
                            Text("Create")
                        }
                        .font(.system(size: 10, weight: .bold, design: .rounded))
                        .foregroundStyle(Agentic30BrandColor.greenBright)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .background(
                            Capsule()
                                .fill(Agentic30BrandColor.greenBright.opacity(0.12))
                        )
                    }
                    .buttonStyle(.plain)
                    .disabled(viewModel.isCreatingDoc != nil)
                }
            }
            TextField(placeholder, text: text)
                .textFieldStyle(.plain)
                .font(.system(size: 14, weight: .medium, design: .monospaced))
                .foregroundStyle(settingsText.opacity(0.9))
                .padding(12)
                .background(fieldBackground)

            if !configuredPath.isEmpty && !exists {
                Text("Missing at \(configuredPath) relative to workspace root.")
                    .font(.system(size: 11, weight: .medium, design: .rounded))
                    .foregroundStyle(Color(red: 0.96, green: 0.78, blue: 0.54).opacity(0.84))
                    .fixedSize(horizontal: false, vertical: true)
            }

            if creating && !viewModel.docCreationLogs.isEmpty {
                ScrollViewReader { proxy in
                    ScrollView(.vertical, showsIndicators: true) {
                        VStack(alignment: .leading, spacing: 2) {
                            ForEach(Array(viewModel.docCreationLogs.enumerated()), id: \.offset) { idx, log in
                                Text(log)
                                    .id(idx)
                            }
                        }
                        .font(.system(size: 10, weight: .regular, design: .monospaced))
                        .foregroundStyle(settingsText.opacity(0.4))
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(8)
                    }
                    .frame(maxHeight: 80)
                    .background(settingsText.opacity(0.03))
                    .clipShape(RoundedRectangle(cornerRadius: 6))
                    .onChange(of: viewModel.docCreationLogs.count) {
                        withAnimation {
                            proxy.scrollTo(viewModel.docCreationLogs.count - 1, anchor: .bottom)
                        }
                    }
                }
            }
        }
    }

    private func sectionHeader(title: String, configured: Bool) -> some View {
        HStack(spacing: 10) {
            Circle()
                .fill(configured ? Agentic30BrandColor.greenBright : settingsText.opacity(0.18))
                .frame(width: 9, height: 9)
            Text(title)
                .font(.system(size: 16, weight: .bold, design: .rounded))
                .foregroundStyle(settingsText.opacity(0.84))
        }
    }

    private func color(for status: String) -> Color {
        switch status {
        case "ok":
            return Agentic30BrandColor.greenBright
        case "warning":
            return Color(red: 0.96, green: 0.78, blue: 0.54)
        case "failed":
            return Color(red: 1.0, green: 0.45, blue: 0.42)
        default:
            return settingsText.opacity(0.5)
        }
    }

    private var fieldBackground: some View {
        let shape = RoundedRectangle(cornerRadius: 8, style: .continuous)
        return shape
            .fill(OpenDesignDayColor.surface)
            .overlay(shape.stroke(settingsHairline, lineWidth: 1))
    }

    private var cardBackground: some View {
        let shape = RoundedRectangle(cornerRadius: 12, style: .continuous)
        return shape
            .fill(OpenDesignDayColor.surface)
            .overlay(shape.stroke(settingsHairline, lineWidth: 1))
    }

    private func pickFolder() {
        let panel = NSOpenPanel()
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.allowsMultipleSelection = false
        panel.message = "Select your project workspace root"
        if panel.runModal() == .OK, let url = panel.url {
            bipWorkspaceRoot = url.path
            viewModel.setProjectWorkspace(url)
        }
    }

    private func triggerScan() {
        guard !bipWorkspaceRoot.isEmpty else { return }
        viewModel.scanWorkspace(root: bipWorkspaceRoot)
    }

    private func createDoc(type: String) {
        guard !bipWorkspaceRoot.isEmpty else { return }
        viewModel.createDocument(type: type, workspaceRoot: bipWorkspaceRoot)
    }

    private func refreshDiagnostics() {
        viewModel.requestDiagnostics()
        showMessage($diagnosticsMessage, text: "Requested")
    }

    private func copyDiagnostics() {
        let pasteboard = NSPasteboard.general
        pasteboard.clearContents()
        pasteboard.setString(viewModel.diagnosticsReport, forType: .string)
        showMessage($diagnosticsMessage, text: "Copied")
    }

    private func sendTestBipNotification(_ intent: BipNotificationIntent) {
        Task {
            let message = await viewModel.sendTestBipNotification(intent: intent)
            showMessage($developerToolsMessage, text: message)
        }
    }

    private func playConfettiTest() {
        withAnimation(.easeOut(duration: 0.12)) {
            confettiTestRunID += 1
        }
        showMessage($confettiTestMessage, text: "Confetti 테스트를 재생했습니다.")
    }

    private func applyDocCreated(type: String, path: String) {
        switch type {
        case "icp": bipIcpPath = path
        case "spec": bipSpecPath = path
        case "values": bipValuesPath = path
        case "designSystem": bipDesignSystemPath = path
        case "adr": bipAdrPath = path
        case "goal": bipGoalPath = path
        case "docs": bipDocsPath = path
        case "sheet": bipSheetPath = path
        default: break
        }
        saveBipValues()
        showMessage($scanMessage, text: "\(type.uppercased()) document created")
    }

    private func applyScanResult(_ result: AgenticViewModel.WorkspaceScanResult) {
        if let error = result.error {
            showMessage($scanMessage, text: "Scan failed: \(error)")
            return
        }

        var found = 0
        if let path = result.icp, bipIcpPath != path {
            bipIcpPath = path
            found += 1
        }
        if let path = result.spec, bipSpecPath != path {
            bipSpecPath = path
            found += 1
        }
        if let path = result.values, bipValuesPath != path {
            bipValuesPath = path
            found += 1
        }
        if let path = result.designSystem, bipDesignSystemPath != path {
            bipDesignSystemPath = path
            found += 1
        }
        if let path = result.adr, bipAdrPath != path {
            bipAdrPath = path
            found += 1
        }
        if let path = result.goal, bipGoalPath != path {
            bipGoalPath = path
            found += 1
        }
        if let path = result.docs, bipDocsPath != path {
            bipDocsPath = path
            found += 1
        }
        if let path = result.sheet, bipSheetPath != path {
            bipSheetPath = path
            found += 1
        }

        let total = [result.icp, result.spec, result.values, result.designSystem, result.adr, result.goal, result.docs, result.sheet]
            .compactMap { $0 }.count

        if total > 0 {
            saveBipValues()
            showMessage($scanMessage, text: "\(total) doc(s) found, \(found) path(s) updated")
        } else {
            showMessage($scanMessage, text: "No docs detected — fill paths manually")
        }
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
        s.posthogApiKey = posthogApiKey
        s.posthogProjectAPIKey = posthogProjectAPIKey
        s.posthogHost = posthogHost
        s.posthogMcpURL = posthogMcpURL
        s.posthogMcpRegion = posthogMcpRegion
        s.posthogMcpReadonly = posthogMcpReadonly
        s.posthogMcpFeatures = posthogMcpFeatures
        s.metaAccessToken = metaAccessToken
        s.metaAdAccountId = metaAdAccountId
        s.bipWorkspaceRoot = bipWorkspaceRoot
        s.bipIcpPath = bipIcpPath
        s.bipSpecPath = bipSpecPath
        s.bipValuesPath = bipValuesPath
        s.bipDesignSystemPath = bipDesignSystemPath
        s.bipAdrPath = bipAdrPath
        s.bipGoalPath = bipGoalPath
        s.bipDocsPath = bipDocsPath
        s.bipSheetPath = bipSheetPath
        s.bipGdocsUrls = bipGdocsUrls
        s.bipGsheetsUrls = bipGsheetsUrls
        s.bipNotionUrls = bipNotionUrls
        s.bipThreadsHandle = bipThreadsHandle
        s.bipXHandle = bipXHandle
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
        posthogApiKey = s.posthogApiKey
        posthogProjectAPIKey = s.posthogProjectAPIKey
        posthogHost = s.posthogHost
        posthogMcpURL = s.posthogMcpURL
        posthogMcpRegion = s.posthogMcpRegion
        posthogMcpReadonly = s.posthogMcpReadonly
        posthogMcpFeatures = s.posthogMcpFeatures
        metaAccessToken = s.metaAccessToken
        metaAdAccountId = s.metaAdAccountId
        bipWorkspaceRoot = s.bipWorkspaceRoot
        bipIcpPath = s.bipIcpPath
        bipSpecPath = s.bipSpecPath
        bipValuesPath = s.bipValuesPath
        bipDesignSystemPath = s.bipDesignSystemPath
        bipAdrPath = s.bipAdrPath
        bipGoalPath = s.bipGoalPath
        bipDocsPath = s.bipDocsPath
        bipSheetPath = s.bipSheetPath
        bipGdocsUrls = s.bipGdocsUrls
        bipGsheetsUrls = s.bipGsheetsUrls
        bipNotionUrls = s.bipNotionUrls
        bipThreadsHandle = s.bipThreadsHandle
        bipXHandle = s.bipXHandle
    }

    private func loadAllValues() {
        let settings = KeychainHelper.loadSettings()
        applySettings(settings)
        bipWorkspaceRoot = WorkspaceSettings.displayPath(legacyFallback: settings.bipWorkspaceRoot)
        syncBipFieldsFromCoach(viewModel.bipCoach, persist: true)
        viewModel.syncProviderSettingsToSidecar(settings)
    }

    private func saveAgentSettingsValues() {
        let settings = currentSettings()
        try? KeychainHelper.saveSettings(settings)
        viewModel.syncProviderSettingsToSidecar(settings)
        PostHogTelemetry.capture("mac_settings_agents_saved", properties: [
            "claude_model": settings.preferredClaudeModel,
            "codex_model": settings.preferredCodexModel,
            "gemini_model": settings.preferredGeminiModel,
            "claude_auth_mode": settings.claudeAuthMode,
            "codex_auth_mode": settings.codexAuthMode,
            "gemini_auth_mode": settings.geminiAuthMode,
            "claude_api_key_configured": !settings.claudeApiKey.isEmpty,
            "codex_api_key_configured": !settings.codexApiKey.isEmpty,
            "gemini_api_key_configured": !settings.geminiApiKey.isEmpty,
            "exa_api_key_configured": !settings.exaApiKey.isEmpty,
        ])
        showMessage($agentSettingsSaveMessage, text: "Saved")
    }

    private func syncWorkspaceRoot(_ root: String) {
        guard WorkspaceSettings.hasExplicitWorkspace else { return }
        let explicitPath = WorkspaceSettings.resolvedURL().path
        let previousRoot = bipWorkspaceRoot
        if !root.isEmpty {
            bipWorkspaceRoot = root
        } else {
            bipWorkspaceRoot = explicitPath
        }
        if previousRoot != bipWorkspaceRoot {
            bipIcpPath = ""
            bipSpecPath = ""
            bipValuesPath = ""
            bipDesignSystemPath = ""
            bipAdrPath = ""
            bipGoalPath = ""
            bipDocsPath = ""
            bipSheetPath = ""
            scanMessage = "Workspace changed. Scanning for project docs..."
        }
    }

    private func syncBipFieldsFromCoach(_ coach: BipCoachState?, persist: Bool) {
        guard let coach else { return }

        var changed = false
        if nonEmpty(bipGdocsUrls) == nil, let docUrl = bipCoachDocUrl(from: coach.config) {
            bipGdocsUrls = docUrl
            changed = true
        }
        if nonEmpty(bipGsheetsUrls) == nil, let sheetUrl = bipCoachSheetUrl(from: coach.config) {
            bipGsheetsUrls = sheetUrl
            changed = true
        }
        if nonEmpty(bipThreadsHandle) == nil, let threadsHandle = nonEmpty(coach.config.threadsHandle) {
            bipThreadsHandle = threadsHandle
            changed = true
        }

        guard persist, changed else { return }

        var settings = KeychainHelper.loadSettings()
        settings.bipGdocsUrls = bipGdocsUrls
        settings.bipGsheetsUrls = bipGsheetsUrls
        settings.bipThreadsHandle = bipThreadsHandle
        try? KeychainHelper.saveSettings(settings)
        KeychainHelper.syncBipConfigFile(from: settings)
    }

    private func bipCoachDocUrl(from config: BipCoachConfig) -> String? {
        if let docUrl = nonEmpty(config.docUrl) {
            return docUrl
        }
        if let docId = nonEmpty(config.docId) {
            return "https://docs.google.com/document/d/\(docId)/edit"
        }
        return nil
    }

    private func bipCoachSheetUrl(from config: BipCoachConfig) -> String? {
        if let sheetUrl = nonEmpty(config.sheetUrl) {
            return sheetUrl
        }
        if let sheetId = nonEmpty(config.sheetId) {
            return "https://docs.google.com/spreadsheets/d/\(sheetId)/edit"
        }
        return nil
    }

    private func nonEmpty(_ value: String?) -> String? {
        guard let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines),
              !trimmed.isEmpty else {
            return nil
        }
        return trimmed
    }

    private func saveAdValues() {
        let settings = currentSettings()
        try? KeychainHelper.saveSettings(settings)
        KeychainHelper.syncAdConfigFile(from: settings)
        PostHogTelemetry.reloadConfiguration()
        PostHogTelemetry.capture("mac_settings_ad_saved", properties: [
            "posthog_mcp_configured": !posthogApiKey.isEmpty,
            "posthog_project_configured": !posthogProjectAPIKey.isEmpty,
            "posthog_mcp_region": posthogMcpRegion,
            "posthog_mcp_readonly": posthogMcpReadonly,
            "meta_configured": !metaAccessToken.isEmpty && !metaAdAccountId.isEmpty,
        ])
        showMessage($adSaveMessage, text: "Saved")
    }

    private func clearAdValues() {
        PostHogTelemetry.capture("mac_settings_ad_cleared", properties: [
            "had_posthog_mcp_key": !posthogApiKey.isEmpty,
            "had_posthog_project_key": !posthogProjectAPIKey.isEmpty,
            "had_meta_config": !metaAccessToken.isEmpty && !metaAdAccountId.isEmpty,
        ])
        posthogApiKey = ""
        posthogProjectAPIKey = ""
        posthogHost = ""
        posthogMcpURL = KeychainHelper.Settings.defaultPostHogMcpURL
        posthogMcpRegion = KeychainHelper.Settings.defaultPostHogMcpRegion
        posthogMcpReadonly = true
        posthogMcpFeatures = KeychainHelper.Settings.defaultPostHogMcpFeatures
        metaAccessToken = ""
        metaAdAccountId = ""
        let settings = currentSettings()
        try? KeychainHelper.saveSettings(settings)
        KeychainHelper.syncAdConfigFile(from: settings)
        PostHogTelemetry.reloadConfiguration()
        showMessage($adSaveMessage, text: "Cleared")
    }

    private func saveBipValues() {
        let settings = currentSettings()
        try? KeychainHelper.saveSettings(settings)
        KeychainHelper.syncBipConfigFile(from: settings)
        if bipWorkspaceRoot.isEmpty {
            WorkspaceSettings.clear()
        } else {
            WorkspaceSettings.store(URL(fileURLWithPath: bipWorkspaceRoot, isDirectory: true))
        }
        viewModel.configureBipCoach(
            threadsHandle: bipThreadsHandle,
            sheetUrl: firstCSV(bipGsheetsUrls),
            docUrl: firstCSV(bipGdocsUrls),
            provider: viewModel.selectedProvider
        )
        showMessage($bipSaveMessage, text: "Saved")
    }

    private func clearBipValues() {
        bipWorkspaceRoot = ""
        bipIcpPath = ""
        bipSpecPath = ""
        bipValuesPath = ""
        bipDesignSystemPath = ""
        bipAdrPath = ""
        bipGoalPath = ""
        bipDocsPath = ""
        bipSheetPath = ""
        bipGdocsUrls = ""
        bipGsheetsUrls = ""
        bipNotionUrls = ""
        bipThreadsHandle = ""
        bipXHandle = ""
        let settings = currentSettings()
        try? KeychainHelper.saveSettings(settings)
        KeychainHelper.syncBipConfigFile(from: settings)
        WorkspaceSettings.clear()
        viewModel.configureBipCoach(
            threadsHandle: "",
            sheetUrl: "",
            docUrl: "",
            provider: viewModel.selectedProvider
        )
        showMessage($bipSaveMessage, text: "Cleared")
    }

    private func resetAgentic30LocalData() {
        do {
            let report = try viewModel.resetAgentic30LocalUserData()
            loadAllValues()
            openWorkspaceAfterLocalDataReset()
            showMessage($resetLocalDataMessage, text: localDataResetSummary(report))
        } catch {
            showMessage($resetLocalDataMessage, text: "Reset failed: \(error.localizedDescription)")
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
            showMessage($resetLocalDataMessage, text: "Local data cleared.\(suffix)")
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) {
                NSApplication.shared.terminate(nil)
            }
        } catch {
            showMessage($resetLocalDataMessage, text: "Reset failed: \(error.localizedDescription)")
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

    private func firstCSV(_ value: String) -> String {
        value
            .split(separator: ",")
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .first(where: { !$0.isEmpty }) ?? ""
    }
}
