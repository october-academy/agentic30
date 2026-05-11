import SwiftUI
import AppKit

enum SettingsSection: CaseIterable, Identifiable {
    case account
    case adAnalytics
    case buildInPublic
    case notion
    case developerTools
    case diagnostics
    case quarantineRecovery

    var id: Self { self }

    var title: String {
        switch self {
        case .account: "Account"
        case .adAnalytics: "Ad Analytics"
        case .buildInPublic: "Build In Public"
        case .notion: "Notion"
        case .developerTools: "Developer"
        case .diagnostics: "Diagnostics"
        case .quarantineRecovery: "Quarantine Recovery"
        }
    }

    var sidebarTitle: String {
        switch self {
        case .account: "일반"
        case .adAnalytics: "광고 분석"
        case .buildInPublic: "Build In Public"
        case .notion: "Notion"
        case .developerTools: "개발자 도구"
        case .diagnostics: "진단"
        case .quarantineRecovery: "정직 모드 복구"
        }
    }

    var systemImage: String {
        switch self {
        case .account: "person.crop.circle"
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
        case .account: "account"
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

    // MARK: - Ad Analytics State

    @State private var posthogApiKey = ""
    @State private var posthogProjectAPIKey = ""
    @State private var posthogHost = ""
    @State private var metaAccessToken = ""
    @State private var metaAdAccountId = ""
    @State private var adSaveMessage = ""

    // MARK: - Model State

    @State private var claudeModelID = AgentModelCatalog.defaultClaudeModelID
    @State private var codexModelID = AgentModelCatalog.defaultCodexModelID
    @State private var modelSaveMessage = ""

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
    @State private var localSelectedSection: SettingsSection = .account
    @State private var isBackButtonHovered = false

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
        VStack(spacing: 0) {
            settingsSectionBar
            selectedSettingsSection
        }
        .background(settingsBackground)
        .frame(width: 560, height: 720)
    }

    private var workspaceSettingsPage: some View {
        Group {
            if showsWorkspaceSettingsSidebar {
                HStack(spacing: 0) {
                    workspaceSettingsSidebar

                    selectedSettingsSection
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            } else {
                selectedSettingsSection
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(settingsBackground)
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
                .foregroundStyle(.white.opacity(isBackButtonHovered ? 0.90 : 0.58))
                .padding(.horizontal, 10)
                .frame(height: 40)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .fill(Color.white.opacity(isBackButtonHovered ? 0.075 : 0.0))
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .stroke(Color.white.opacity(isBackButtonHovered ? 0.12 : 0.0), lineWidth: 1)
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
        .background(Color.white.opacity(0.025))
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
            .foregroundStyle(section == selectedSection.wrappedValue ? .white.opacity(0.88) : .white.opacity(0.58))
            .padding(.horizontal, 12)
            .frame(height: 36)
            .background(
                RoundedRectangle(cornerRadius: 9, style: .continuous)
                    .fill(section == selectedSection.wrappedValue ? Color.white.opacity(0.10) : Color.clear)
            )
            .contentShape(RoundedRectangle(cornerRadius: 9, style: .continuous))
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("settings.section.\(section.accessibilityIdentifier)")
    }

    private var settingsBackground: Color {
        embeddedInWorkspace
            ? Color(red: 0.105, green: 0.123, blue: 0.134).opacity(0.98)
            : Color(red: 0.14, green: 0.16, blue: 0.19)
    }

    private var settingsSectionBar: some View {
        HStack(spacing: 8) {
            ForEach(SettingsSection.allCases) { section in
                Button {
                    selectedSection.wrappedValue = section
                } label: {
                    Label(section.title, systemImage: section.systemImage)
                        .font(.system(size: 12, weight: .bold, design: .rounded))
                        .foregroundStyle(section == selectedSection.wrappedValue ? .white.opacity(0.92) : .white.opacity(0.5))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 10)
                        .background(
                            RoundedRectangle(cornerRadius: 8, style: .continuous)
                                .fill(section == selectedSection.wrappedValue ? Color.white.opacity(0.14) : Color.white.opacity(0.04))
                        )
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("settings.section.\(section.accessibilityIdentifier)")
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 16)
        .padding(.bottom, 12)
        .background(Color(red: 0.14, green: 0.16, blue: 0.14))
    }

    @ViewBuilder
    private var selectedSettingsSection: some View {
        switch selectedSection.wrappedValue {
        case .account:
            accountTab
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

    // MARK: - Account Tab

    private var accountTab: some View {
        settingsTabScaffold(
            title: "Account",
            subtitle: "The macOS app runs in local mode. No web account is required."
        ) {
            accountConnectionSection
            appUpdatesSection
            agentModelsSection
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
                        .foregroundStyle(.white.opacity(0.9))
                    Text("Sign-in is no longer required. You can clear this stored session and keep using the app locally.")
                        .font(.system(size: 12, weight: .medium, design: .rounded))
                        .foregroundStyle(.white.opacity(0.45))
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
                        .foregroundStyle(.white.opacity(0.9))
                    Text("Choose a project folder and continue without Google sign-in. Workspace integrations remain separate.")
                        .font(.system(size: 12, weight: .medium, design: .rounded))
                        .foregroundStyle(.white.opacity(0.45))
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
        let color = destructive ? Color.red : Color.white
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

    private var appUpdatesSection: some View {
        VStack(alignment: .leading, spacing: 16) {
            sectionHeader(title: "Updates", configured: true)

            Text("Agentic30 checks the signed update feed in the background. You can also check manually.")
                .font(.system(size: 13, weight: .medium, design: .rounded))
                .foregroundStyle(.white.opacity(0.48))

            Button {
                NotificationCenter.default.post(name: .agenticCheckForUpdatesRequested, object: nil)
            } label: {
                HStack(spacing: 8) {
                    Image(systemName: "arrow.triangle.2.circlepath")
                        .font(.system(size: 13, weight: .semibold))
                    Text("Check for Updates...")
                        .font(.system(size: 14, weight: .bold, design: .rounded))
                }
                .foregroundStyle(.white.opacity(0.9))
                .padding(.horizontal, 18)
                .padding(.vertical, 10)
                .background(Capsule().fill(Color.white.opacity(0.16)))
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("settings.updates.checkForUpdates")
        }
        .padding(20)
        .background(cardBackground)
    }

    private var agentModelsSection: some View {
        VStack(alignment: .leading, spacing: 16) {
            sectionHeader(title: "Agent Models", configured: true)

            Text("Choose the default model used when a new Claude Agent SDK or Codex SDK chat starts.")
                .font(.system(size: 13, weight: .medium, design: .rounded))
                .foregroundStyle(.white.opacity(0.48))

            modelPickerRow(
                provider: .claude,
                selection: $claudeModelID
            )

            modelPickerRow(
                provider: .codex,
                selection: $codexModelID
            )

            #if DEBUG
            if Self.isUITesting {
                modelUITestingShortcuts(provider: .claude, selection: $claudeModelID)
                modelUITestingShortcuts(provider: .codex, selection: $codexModelID)
            }
            #endif

            HStack(spacing: 14) {
                Button(action: saveModelValues) {
                    Text("Save Models")
                        .font(.system(size: 14, weight: .bold, design: .rounded))
                        .foregroundStyle(.white.opacity(0.9))
                        .padding(.horizontal, 24)
                        .padding(.vertical, 10)
                        .background(Capsule().fill(Color.white.opacity(0.18)))
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("settings.models.saveButton")

                if !modelSaveMessage.isEmpty {
                    Text(modelSaveMessage)
                        .font(.system(size: 13, weight: .medium, design: .rounded))
                        .foregroundStyle(.green.opacity(0.8))
                        .transition(.opacity)
                        .accessibilityIdentifier("settings.models.saveMessage")
                }

                Spacer()
            }
        }
        .padding(20)
        .background(cardBackground)
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
                        .foregroundStyle(.white.opacity(0.72))
                    Text(provider == .claude ? "ANTHROPIC" : "OPENAI")
                        .font(.system(size: 10, weight: .bold, design: .rounded))
                        .foregroundStyle(.white.opacity(0.34))
                }

                Spacer(minLength: 12)

                Menu {
                    Section(provider == .claude ? "ANTHROPIC" : "OPENAI") {
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
                            .foregroundStyle(.white.opacity(0.9))
                            .lineLimit(1)
                            .truncationMode(.tail)

                        Image(systemName: "chevron.up.chevron.down")
                            .font(.system(size: 10, weight: .bold))
                            .foregroundStyle(.white.opacity(0.42))
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
                .foregroundStyle(.white.opacity(0.36))
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
                .foregroundStyle(.white.opacity(0.62))
                .frame(width: 230, height: 22, alignment: .leading)
        }
        .accessibilityIdentifier(identifier)
        .accessibilityLabel(option.label)
        .buttonStyle(.borderless)
        .padding(.horizontal, 6)
        .padding(.vertical, 4)
        .background(
            RoundedRectangle(cornerRadius: 6, style: .continuous)
                .fill(Color.white.opacity(isSelected ? 0.16 : 0.06))
        )
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
                        .fill(.green.opacity(0.8))
                        .frame(width: 8, height: 8)
                    Text("Connected to Notion")
                        .font(.system(size: 14, weight: .semibold, design: .rounded))
                        .foregroundStyle(.white.opacity(0.9))
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
                    .foregroundStyle(.white.opacity(0.45))

            } else if viewModel.notionOAuthInProgress {
                // OAuth in progress
                HStack(spacing: 12) {
                    ProgressView()
                        .controlSize(.small)
                        .tint(.white.opacity(0.6))
                    Text("Waiting for authorization...")
                        .font(.system(size: 14, weight: .medium, design: .rounded))
                        .foregroundStyle(.white.opacity(0.7))
                }

            } else {
                // Disconnected state
                VStack(alignment: .leading, spacing: 12) {
                    Text("Not connected")
                        .font(.system(size: 14, weight: .medium, design: .rounded))
                        .foregroundStyle(.white.opacity(0.5))

                    Button(action: {
                        viewModel.startNotionOAuth()
                    }) {
                        HStack(spacing: 8) {
                            Image(systemName: "link.badge.plus")
                            Text("Connect to Notion")
                        }
                        .font(.system(size: 14, weight: .bold, design: .rounded))
                        .foregroundStyle(.white.opacity(0.9))
                        .padding(.horizontal, 24)
                        .padding(.vertical, 10)
                        .background(Capsule().fill(Color.white.opacity(0.18)))
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
                .foregroundStyle(.white.opacity(0.35))
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
        }
    }

    private var notificationTestSection: some View {
        VStack(alignment: .leading, spacing: 16) {
            sectionHeader(title: "BIP Notifications", configured: true)

            Text("테스트 알림은 실제 macOS 알림 센터 경로를 사용합니다. 배너를 누르면 Agentic30이 열리고 BIP 알림 task surface로 이동합니다.")
                .font(.system(size: 13, weight: .medium, design: .rounded))
                .foregroundStyle(.white.opacity(0.50))
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
                    .foregroundStyle(.green.opacity(0.82))
                    .fixedSize(horizontal: false, vertical: true)
                    .transition(.opacity)
                    .accessibilityIdentifier("settings.developerTools.message")
            }
        }
        .padding(20)
        .background(cardBackground)
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
            .foregroundStyle(.white.opacity(0.9))
            .padding(.horizontal, 18)
            .padding(.vertical, 10)
            .background(Capsule().fill(Color.white.opacity(0.16)))
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
                                        .foregroundStyle(.white.opacity(0.45))
                                        .lineLimit(2)
                                }
                                if let recovery = check.recovery {
                                    Text(recovery)
                                        .font(.system(size: 11, weight: .medium, design: .rounded))
                                        .foregroundStyle(.white.opacity(0.5))
                                }
                            }
                            .padding(10)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(Color.white.opacity(0.04))
                            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                        }
                    }
                }
            } else {
                Text("Diagnostics are not available until the sidecar connects.")
                    .font(.system(size: 13, weight: .medium, design: .rounded))
                    .foregroundStyle(.white.opacity(0.5))
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
                    .foregroundStyle(.white.opacity(0.9))
                    .padding(.horizontal, 24)
                    .padding(.vertical, 10)
                    .background(Capsule().fill(Color.white.opacity(0.18)))
            }
            .buttonStyle(.plain)

            Button(action: copyDiagnostics) {
                Text("Copy Diagnostics")
                    .font(.system(size: 14, weight: .bold, design: .rounded))
                    .foregroundStyle(.white.opacity(0.75))
                    .padding(.horizontal, 24)
                    .padding(.vertical, 10)
                    .background(Capsule().fill(Color.white.opacity(0.08)))
            }
            .buttonStyle(.plain)

            if !diagnosticsMessage.isEmpty {
                Text(diagnosticsMessage)
                    .font(.system(size: 13, weight: .medium, design: .rounded))
                    .foregroundStyle(.green.opacity(0.8))
                    .transition(.opacity)
            }

            Spacer()
        }
    }

    private var diagnosticsReportSection: some View {
        ScrollView {
            Text(viewModel.diagnosticsReport)
                .font(.system(size: 11, weight: .medium, design: .monospaced))
                .foregroundStyle(.white.opacity(0.58))
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
                .foregroundStyle(.white.opacity(0.5))
                .frame(width: 96, alignment: .leading)
            Text(value)
                .font(.system(size: 12, weight: .medium, design: .monospaced))
                .foregroundStyle(.white.opacity(0.74))
                .lineLimit(2)
            Spacer(minLength: 0)
        }
    }

    private func notionInfoRow(icon: String, text: String) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: icon)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(.white.opacity(0.5))
                .frame(width: 22)
            Text(text)
                .font(.system(size: 13, weight: .medium, design: .rounded))
                .foregroundStyle(.white.opacity(0.7))
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
                    .foregroundStyle(.white.opacity(0.6))
                SecureField("phx_...", text: $posthogApiKey)
                    .textFieldStyle(.plain)
                    .font(.system(size: 14, weight: .medium, design: .monospaced))
                    .foregroundStyle(.white.opacity(0.9))
                    .padding(12)
                    .background(fieldBackground)
            }

            VStack(alignment: .leading, spacing: 6) {
                Text("Project API Key")
                    .font(.system(size: 13, weight: .semibold, design: .rounded))
                    .foregroundStyle(.white.opacity(0.6))
                SecureField("phc_...", text: $posthogProjectAPIKey)
                    .textFieldStyle(.plain)
                    .font(.system(size: 14, weight: .medium, design: .monospaced))
                    .foregroundStyle(.white.opacity(0.9))
                    .padding(12)
                    .background(fieldBackground)
            }

            VStack(alignment: .leading, spacing: 6) {
                Text("Host")
                    .font(.system(size: 13, weight: .semibold, design: .rounded))
                    .foregroundStyle(.white.opacity(0.6))
                TextField("https://us.posthog.com", text: $posthogHost)
                    .textFieldStyle(.plain)
                    .font(.system(size: 14, weight: .medium, design: .monospaced))
                    .foregroundStyle(.white.opacity(0.9))
                    .padding(12)
                    .background(fieldBackground)
            }

            Text("`phx_` key는 MCP/조회용이고, 앱/sidecar 이벤트 수집은 `phc_` project key를 사용합니다.")
                .font(.system(size: 12, weight: .medium, design: .rounded))
                .foregroundStyle(.white.opacity(0.44))

            if !posthogApiKey.isEmpty && posthogProjectAPIKey.isEmpty {
                Text("MCP/조회는 설정되었지만 앱 이벤트 수집은 아직 비활성 상태입니다. `phc_` project key를 추가해야 telemetry가 전송됩니다.")
                    .font(.system(size: 12, weight: .medium, design: .rounded))
                    .foregroundStyle(.orange.opacity(0.78))
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
                    .foregroundStyle(.white.opacity(0.6))
                SecureField("EAA...", text: $metaAccessToken)
                    .textFieldStyle(.plain)
                    .font(.system(size: 14, weight: .medium, design: .monospaced))
                    .foregroundStyle(.white.opacity(0.9))
                    .padding(12)
                    .background(fieldBackground)
            }

            VStack(alignment: .leading, spacing: 6) {
                Text("Ad Account ID")
                    .font(.system(size: 13, weight: .semibold, design: .rounded))
                    .foregroundStyle(.white.opacity(0.6))
                TextField("act_123456789", text: $metaAdAccountId)
                    .textFieldStyle(.plain)
                    .font(.system(size: 14, weight: .medium, design: .monospaced))
                    .foregroundStyle(.white.opacity(0.9))
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
                    .foregroundStyle(.white.opacity(0.6))
                HStack(spacing: 8) {
                    TextField("/Users/you/project", text: $bipWorkspaceRoot)
                        .textFieldStyle(.plain)
                        .font(.system(size: 14, weight: .medium, design: .monospaced))
                        .foregroundStyle(.white.opacity(0.9))
                        .padding(12)
                        .background(fieldBackground)

                    Button(action: pickFolder) {
                        Image(systemName: "folder")
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(.white.opacity(0.6))
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
                                .foregroundStyle(.white.opacity(0.6))
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
                                .foregroundStyle(.white.opacity(0.48))
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
                    .foregroundStyle(Color(red: 0.55, green: 0.90, blue: 0.66).opacity(0.9))
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
                .foregroundStyle(.white.opacity(0.35))
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
                .foregroundStyle(.white.opacity(0.58))
                .fixedSize(horizontal: false, vertical: true)

            settingsField(label: "Google Docs 수동 연결 URL", placeholder: "https://docs.google.com/... (comma-separated)", text: $bipGdocsUrls)
            settingsField(label: "Google Sheets 수동 연결 URL", placeholder: "https://docs.google.com/spreadsheets/... (comma-separated)", text: $bipGsheetsUrls)
            settingsField(label: "Notion Pages", placeholder: "https://notion.so/... (comma-separated)", text: $bipNotionUrls)

            Text("Chat Assistant 안의 오늘 실행 카드가 업무일지 Doc과 게시글 Sheet 템플릿을 내 Drive에 복사하고 자동 연결합니다. 수동 URL은 복구나 이전 연결 유지가 필요할 때만 사용하세요.")
                .font(.system(size: 12, weight: .medium, design: .rounded))
                .foregroundStyle(.white.opacity(0.42))
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
                    .foregroundStyle(.white.opacity(0.6))
                HStack(spacing: 0) {
                    Text("@")
                        .font(.system(size: 14, weight: .medium, design: .monospaced))
                        .foregroundStyle(.white.opacity(0.4))
                        .padding(.leading, 12)
                    TextField("handle", text: $bipThreadsHandle)
                        .textFieldStyle(.plain)
                        .font(.system(size: 14, weight: .medium, design: .monospaced))
                        .foregroundStyle(.white.opacity(0.9))
                        .padding(12)
                }
                .background(fieldBackground)
            }

            VStack(alignment: .leading, spacing: 6) {
                Text("X (Twitter)")
                    .font(.system(size: 13, weight: .semibold, design: .rounded))
                    .foregroundStyle(.white.opacity(0.6))
                HStack(spacing: 0) {
                    Text("@")
                        .font(.system(size: 14, weight: .medium, design: .monospaced))
                        .foregroundStyle(.white.opacity(0.4))
                        .padding(.leading, 12)
                    TextField("handle", text: $bipXHandle)
                        .textFieldStyle(.plain)
                        .font(.system(size: 14, weight: .medium, design: .monospaced))
                        .foregroundStyle(.white.opacity(0.9))
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
                    .foregroundStyle(.white.opacity(0.9))
                    .padding(.horizontal, 24)
                    .padding(.vertical, 10)
                    .background(Capsule().fill(Color.white.opacity(0.18)))
            }
            .buttonStyle(.plain)

            Button(action: clearAdValues) {
                Text("Clear All")
                    .font(.system(size: 14, weight: .bold, design: .rounded))
                    .foregroundStyle(.white.opacity(0.5))
                    .padding(.horizontal, 24)
                    .padding(.vertical, 10)
                    .background(Capsule().fill(Color.white.opacity(0.06)))
            }
            .buttonStyle(.plain)

            if !adSaveMessage.isEmpty {
                Text(adSaveMessage)
                    .font(.system(size: 13, weight: .medium, design: .rounded))
                    .foregroundStyle(.green.opacity(0.8))
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
                    .foregroundStyle(.white.opacity(0.9))
                    .padding(.horizontal, 24)
                    .padding(.vertical, 10)
                    .background(Capsule().fill(Color.white.opacity(0.18)))
            }
            .buttonStyle(.plain)

            Button(action: clearBipValues) {
                Text("Clear All")
                    .font(.system(size: 14, weight: .bold, design: .rounded))
                    .foregroundStyle(.white.opacity(0.5))
                    .padding(.horizontal, 24)
                    .padding(.vertical, 10)
                    .background(Capsule().fill(Color.white.opacity(0.06)))
            }
            .buttonStyle(.plain)

            if !bipSaveMessage.isEmpty {
                Text(bipSaveMessage)
                    .font(.system(size: 13, weight: .medium, design: .rounded))
                    .foregroundStyle(.green.opacity(0.8))
                    .transition(.opacity)
            }

            Spacer()
        }
    }

    // MARK: - Helpers

    private func settingsTabScaffold<Content: View>(
        title: String,
        subtitle: String,
        @ViewBuilder content: () -> Content
    ) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: settingsSectionSpacing) {
                settingsPageHeader(title: title, subtitle: subtitle)
                content()
            }
            .frame(maxWidth: embeddedInWorkspace ? 1180 : .infinity, alignment: .leading)
            .padding(.horizontal, embeddedInWorkspace ? 34 : 32)
            .padding(.vertical, embeddedInWorkspace ? 28 : 32)
        }
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
                        .foregroundStyle(.white.opacity(0.52))
                }
            }

            Text(title)
                .font(.system(size: embeddedInWorkspace ? 27 : 26, weight: .bold, design: .rounded))
                .foregroundStyle(.white.opacity(0.96))
                .fixedSize(horizontal: false, vertical: true)

            Text(subtitle)
                .font(.system(size: embeddedInWorkspace ? 14 : 14, weight: embeddedInWorkspace ? .semibold : .medium, design: .rounded))
                .foregroundStyle(.white.opacity(embeddedInWorkspace ? 0.58 : 0.50))
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
        Color(red: 0.64, green: 0.84, blue: 1.0)
    }

    private func settingsField(label: String, placeholder: String, text: Binding<String>) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label)
                .font(.system(size: 13, weight: .semibold, design: .rounded))
                .foregroundStyle(.white.opacity(0.6))
            TextField(placeholder, text: text)
                .textFieldStyle(.plain)
                .font(.system(size: 14, weight: .medium, design: .monospaced))
                .foregroundStyle(.white.opacity(0.9))
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
                    .foregroundStyle(.white.opacity(0.6))
                if detected {
                    Text("auto-detected")
                        .font(.system(size: 10, weight: .bold, design: .rounded))
                        .foregroundStyle(Color(red: 0.55, green: 0.90, blue: 0.66))
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(
                            Capsule()
                                .fill(Color(red: 0.55, green: 0.90, blue: 0.66).opacity(0.15))
                        )
                } else if exists {
                    Text("verified")
                        .font(.system(size: 10, weight: .bold, design: .rounded))
                        .foregroundStyle(Color(red: 0.55, green: 0.90, blue: 0.66))
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(
                            Capsule()
                                .fill(Color(red: 0.55, green: 0.90, blue: 0.66).opacity(0.15))
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
                            .foregroundStyle(.white.opacity(0.5))
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
                        .foregroundStyle(Color(red: 0.55, green: 0.90, blue: 0.66))
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .background(
                            Capsule()
                                .fill(Color(red: 0.55, green: 0.90, blue: 0.66).opacity(0.12))
                        )
                    }
                    .buttonStyle(.plain)
                    .disabled(viewModel.isCreatingDoc != nil)
                }
            }
            TextField(placeholder, text: text)
                .textFieldStyle(.plain)
                .font(.system(size: 14, weight: .medium, design: .monospaced))
                .foregroundStyle(.white.opacity(0.9))
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
                        .foregroundStyle(.white.opacity(0.4))
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(8)
                    }
                    .frame(maxHeight: 80)
                    .background(Color.white.opacity(0.03))
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
                .fill(configured ? Color(red: 0.55, green: 0.90, blue: 0.66) : Color.white.opacity(0.18))
                .frame(width: 9, height: 9)
            Text(title)
                .font(.system(size: 16, weight: .bold, design: .rounded))
                .foregroundStyle(.white.opacity(0.84))
        }
    }

    private func color(for status: String) -> Color {
        switch status {
        case "ok":
            return Color(red: 0.55, green: 0.90, blue: 0.66)
        case "warning":
            return Color(red: 0.96, green: 0.78, blue: 0.54)
        case "failed":
            return Color(red: 1.0, green: 0.45, blue: 0.42)
        default:
            return .white.opacity(0.5)
        }
    }

    private var fieldBackground: some View {
        let shape = RoundedRectangle(cornerRadius: embeddedInWorkspace ? 14 : 12, style: .continuous)
        return shape
            .fill(Color.white.opacity(embeddedInWorkspace ? 0.055 : 0.06))
            .overlay(shape.stroke(Color.white.opacity(embeddedInWorkspace ? 0.09 : 0.08), lineWidth: 1))
    }

    private var cardBackground: some View {
        let shape = RoundedRectangle(cornerRadius: embeddedInWorkspace ? 18 : 22, style: .continuous)
        return shape
            .fill(Color.white.opacity(embeddedInWorkspace ? 0.07 : 0.06))
            .overlay(shape.stroke(Color.white.opacity(embeddedInWorkspace ? 0.10 : 0.08), lineWidth: 1))
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
        s.posthogApiKey = posthogApiKey
        s.posthogProjectAPIKey = posthogProjectAPIKey
        s.posthogHost = posthogHost
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
        claudeModelID = AgentModelCatalog.normalizedModelID(
            preferredClaudeModel,
            provider: .claude
        )
        codexModelID = AgentModelCatalog.normalizedModelID(
            preferredCodexModel,
            provider: .codex
        )
        #if DEBUG
        if environment["AGENTIC30_UI_TEST_SETTINGS_CLAUDE_MODEL"] != nil
            || environment["AGENTIC30_UI_TEST_SETTINGS_CODEX_MODEL"] != nil {
            var seededSettings = s
            seededSettings.preferredClaudeModel = AgentModelCatalog.normalizedModelID(preferredClaudeModel, provider: .claude)
            seededSettings.preferredCodexModel = AgentModelCatalog.normalizedModelID(preferredCodexModel, provider: .codex)
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
    }

    private func saveModelValues() {
        let settings = currentSettings()
        try? KeychainHelper.saveSettings(settings)
        PostHogTelemetry.capture("mac_settings_models_saved", properties: [
            "claude_model": settings.preferredClaudeModel,
            "codex_model": settings.preferredCodexModel,
        ])
        showMessage($modelSaveMessage, text: "Saved")
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
        PostHogTelemetry.capture("mac_settings_ad_saved", properties: [
            "posthog_mcp_configured": !posthogApiKey.isEmpty,
            "posthog_project_configured": !posthogProjectAPIKey.isEmpty,
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
        metaAccessToken = ""
        metaAdAccountId = ""
        let settings = currentSettings()
        try? KeychainHelper.saveSettings(settings)
        KeychainHelper.syncAdConfigFile(from: settings)
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
