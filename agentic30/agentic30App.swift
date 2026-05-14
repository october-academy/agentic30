//
//  agentic30App.swift
//  agentic30
//
//  Created by october on 4/8/26.
//

import SwiftUI
import AppKit
import Sparkle
import UserNotifications

extension Notification.Name {
    static let agenticCheckForUpdatesRequested = Notification.Name("agenticCheckForUpdatesRequested")
}

@main
struct agentic30App: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate

    var body: some Scene {
        Window("Agentic30", id: "workspace") {
            ContentView(
                viewModel: appDelegate.viewModel,
                surfaceOverride: .workspace,
                maximizeWorkspaceOnFirstAppear: appDelegate.shouldMaximizeWorkspaceWindowOnFirstAppear,
                markWorkspaceInitialMaximizeApplied: {
                    appDelegate.markInitialWorkspaceWindowMaximizeApplied()
                }
            )
            .frame(minWidth: 1180, minHeight: 740)
            .onAppear {
                PostHogTelemetry.capture(
                    "mac_workspace_surface_opened",
                    authSession: appDelegate.viewModel.macAuthSession
                )
            }
        }
        .defaultSize(width: 1180, height: 760)
        .windowResizability(.contentMinSize)
        .commands {
            CommandGroup(after: .appSettings) {
                Button("Check for Updates...") {
                    appDelegate.checkForUpdates(nil)
                }
            }
        }

        Settings {
            SettingsView(viewModel: appDelegate.viewModel)
        }

        MenuBarExtra {
            StatusMenuContent(
                viewModel: appDelegate.viewModel,
                appDelegate: appDelegate
            )
        } label: {
            StatusMenuLabel(appDelegate: appDelegate)
        }
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    let viewModel = AgenticViewModel()
    let petStateMachine = WolfStateMachine()
    let petWindowController = PetWindowController()

    private let workspaceWindowTitle = "Agentic30"
    private var openWorkspaceHandler: (() -> Void)?
    private var pendingWorkspaceOpen = false
    private(set) var shouldMaximizeWorkspaceWindowOnFirstAppear = AppDelegate.shouldMaximizeWorkspaceWindowOnLaunch(
        isFirstLaunchEver: !PostHogTelemetry.hasPreviouslyGeneratedDistinctID,
        isUITesting: AppDelegate.isUITestingLaunch()
    )
    private lazy var updaterController: SPUStandardUpdaterController? = Self.makeUpdaterController()

    private(set) var wasLaunchedAtLogin = false

    static let initialWorkspaceMaximizeDefaultsKey = "agentic30.workspaceWindow.initialInstallMaximizeApplied.v1"

    func applicationWillFinishLaunching(_ notification: Notification) {
        wasLaunchedAtLogin = LoginItemsManager.wasLaunchedAtLogin()
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        UNUserNotificationCenter.current().delegate = self
        _ = updaterController
        // Snapshot before capture(), which lazy-generates the distinct id.
        // Pending captures from a prior failed first-launch still flush; this
        // gate only suppresses NEW captureOnce attempts for upgraders.
        let isFirstLaunchEver = !PostHogTelemetry.hasPreviouslyGeneratedDistinctID
        shouldMaximizeWorkspaceWindowOnFirstAppear = Self.shouldMaximizeWorkspaceWindowOnLaunch(
            isFirstLaunchEver: isFirstLaunchEver,
            isUITesting: Self.isUITestingLaunch()
        )
        PostHogTelemetry.capture("mac_app_launched")
        PostHogTelemetry.flushPendingOnceCaptures()
        if isFirstLaunchEver {
            PostHogTelemetry.captureOnce(
                "mac_install_completed",
                onceKey: "mac_install_completed.v1",
                properties: [
                    "event_schema_version": 1,
                    "distribution_channel": "github_pkg",
                    "source": "mac_first_launch",
                ],
                authSession: viewModel.macAuthSession
            )
            PostHogTelemetry.captureOnce(
                "dmg_install_completed",
                onceKey: "dmg_install_completed.v1",
                properties: [
                    "event_schema_version": 1,
                    "distribution_channel": "github_pkg_or_dmg",
                    "source": "mac_first_launch",
                ],
                authSession: viewModel.macAuthSession
            )
        }

        if !Self.isUITestingLaunch() {
            LoginItemsManager.shared.autoEnrollIfFirstLaunch(isFirstLaunchEver: isFirstLaunchEver)
        }

        // Wire sidecar events into the desktop-pet state machine.
        viewModel.onSidecarEvent = { [weak self] event, sessions in
            self?.petStateMachine.ingest(event, sessions: sessions)
        }
        petWindowController.attach(stateMachine: petStateMachine)
        if petWindowController.isEnabled {
            petWindowController.show()
        }

        // Pet right-click menu -> AppDelegate handlers (decoupled via
        // NotificationCenter so PetView doesn't import AppDelegate).
        NotificationCenter.default.addObserver(
            forName: .agenticPetHideRequested,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            MainActor.assumeIsolated {
                self?.petWindowController.hide()
            }
        }
        NotificationCenter.default.addObserver(
            forName: .agenticPetOpenWorkspaceRequested,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            self?.openWorkspaceWindow()
        }
        NotificationCenter.default.addObserver(
            forName: .agenticCheckForUpdatesRequested,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            MainActor.assumeIsolated {
                self?.checkForUpdates(nil)
            }
        }

        #if DEBUG
        if let intent = BipNotificationIntent.uiTestingOpenArgument(in: CommandLine.arguments) {
            DispatchQueue.main.async { [weak self] in
                self?.openBipNotification(intent: intent, source: "ui_test_launch_argument")
            }
        }
        if CommandLine.arguments.contains("--ui-testing-open-settings") {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { [weak self] in
                self?.closeWorkspaceWindows()
                NSApp.activate(ignoringOtherApps: true)
                if !NSApp.sendAction(Selector(("showSettingsWindow:")), to: nil, from: nil) {
                    NSApp.sendAction(Selector(("showPreferencesWindow:")), to: nil, from: nil)
                }
            }
        } else if CommandLine.arguments.contains("--ui-testing-open-workspace-switcher-tour") {
            scheduleUITestingWorkspaceOpen(openSettings: false)
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.45) { [weak self] in
                self?.viewModel.requestWorkspaceSwitcherTourOpen()
            }
        } else if CommandLine.arguments.contains("--ui-testing-open-workspace-curriculum-navigator-tour") {
            scheduleUITestingWorkspaceOpen(openSettings: false)
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.45) { [weak self] in
                self?.viewModel.requestWorkspaceCurriculumNavigatorTourOpen()
            }
        } else if CommandLine.arguments.contains("--ui-testing-open-workspace-settings-tour") {
            scheduleUITestingWorkspaceOpen(openSettings: false)
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.45) { [weak self] in
                self?.viewModel.requestWorkspaceSettingsTourOpen()
            }
        } else if CommandLine.arguments.contains("--ui-testing-open-workspace-help-tour") {
            scheduleUITestingWorkspaceOpen(openSettings: false)
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.45) { [weak self] in
                self?.viewModel.requestWorkspaceHelpTourOpen()
            }
        } else if CommandLine.arguments.contains("--ui-testing-open-workspace-recent-conversations-tour") {
            scheduleUITestingWorkspaceOpen(openSettings: false)
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.45) { [weak self] in
                self?.viewModel.requestWorkspaceRecentConversationsTourOpen()
            }
        } else if CommandLine.arguments.contains("--ui-testing-open-workspace-settings") {
            scheduleUITestingWorkspaceOpen(openSettings: true)
        } else if CommandLine.arguments.contains("--ui-testing-open-workspace") {
            scheduleUITestingWorkspaceOpen(openSettings: false)
        }
        #endif

        if wasLaunchedAtLogin {
            DispatchQueue.main.async { [weak self] in
                self?.closeWorkspaceWindows()
            }
        }
    }

    static func shouldMaximizeWorkspaceWindowOnLaunch(
        isFirstLaunchEver: Bool,
        isUITesting: Bool,
        defaults: UserDefaults = .standard
    ) -> Bool {
        isFirstLaunchEver
            && !isUITesting
            && !defaults.bool(forKey: initialWorkspaceMaximizeDefaultsKey)
    }

    func markInitialWorkspaceWindowMaximizeApplied() {
        shouldMaximizeWorkspaceWindowOnFirstAppear = false
        UserDefaults.standard.set(true, forKey: Self.initialWorkspaceMaximizeDefaultsKey)
    }

    private static func isUITestingLaunch() -> Bool {
        CommandLine.arguments.contains { $0.hasPrefix("--ui-testing") }
    }

    func applicationWillTerminate(_ notification: Notification) {
        PostHogTelemetry.capture("mac_app_terminating")
        viewModel.stop()
    }

    @objc func checkForUpdates(_ sender: Any?) {
        guard let updaterController else {
            let alert = NSAlert()
            alert.messageText = "Updates are not configured for this build."
            alert.informativeText = "Release builds must include a Sparkle public EdDSA key."
            alert.alertStyle = .informational
            alert.runModal()
            return
        }
        updaterController.checkForUpdates(sender)
    }

    func applicationShouldSaveApplicationState(_ sender: NSApplication) -> Bool {
        false
    }

    func applicationShouldRestoreApplicationState(_ sender: NSApplication) -> Bool {
        false
    }

    func openWorkspaceWindow() {
        if makeWorkspaceWindowKey() {
            NSApp.activate(ignoringOtherApps: true)
            return
        }

        if let openWorkspaceHandler {
            openWorkspaceHandler()
            focusWorkspaceWindow()
        } else {
            pendingWorkspaceOpen = true
            PostHogTelemetry.capture("mac_workspace_open_handler_missing", authSession: viewModel.macAuthSession)
        }
    }

    func installWorkspaceOpenHandler(_ handler: @escaping () -> Void) {
        openWorkspaceHandler = handler
        guard pendingWorkspaceOpen else { return }
        pendingWorkspaceOpen = false
        handler()
        focusWorkspaceWindow()
    }

    private func openBipNotification(intent: BipNotificationIntent, source: String) {
        openWorkspaceWindow()
        viewModel.requestBipNotificationOpen(intent: intent, source: source)
    }

    private func focusWorkspaceWindow() {
        NSApp.activate(ignoringOtherApps: true)
        _ = makeWorkspaceWindowKey()

        // `openWindow(id:)` creates/restores the SwiftUI window asynchronously.
        // Retry after the current run loop so pet clicks and notification opens
        // focus a newly-created workspace instead of only requesting it.
        DispatchQueue.main.async { [weak self] in
            _ = self?.makeWorkspaceWindowKey()
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) { [weak self] in
            _ = self?.makeWorkspaceWindowKey()
        }
    }

    @discardableResult
    private func makeWorkspaceWindowKey() -> Bool {
        guard let window = NSApp.windows.first(where: { window in
            window.title == workspaceWindowTitle && !window.isMiniaturized
        }) else {
            return false
        }
        window.makeKeyAndOrderFront(nil)
        return true
    }

    private func closeWorkspaceWindows() {
        for window in NSApp.windows where window.title == workspaceWindowTitle {
            window.close()
        }
    }

    private static func makeUpdaterController() -> SPUStandardUpdaterController? {
        guard let publicKey = Bundle.main.object(forInfoDictionaryKey: "SUPublicEDKey") as? String else {
            return nil
        }
        let trimmedPublicKey = publicKey.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedPublicKey.isEmpty, !trimmedPublicKey.contains("$(") else {
            return nil
        }
        return SPUStandardUpdaterController(
            startingUpdater: true,
            updaterDelegate: nil,
            userDriverDelegate: nil
        )
    }

    #if DEBUG
    private func scheduleUITestingWorkspaceOpen(openSettings: Bool) {
        for delay in [0.0, 0.2, 0.6, 1.0] {
            DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self] in
                if openSettings {
                    self?.viewModel.requestWorkspaceSettingsOpen()
                }
                self?.openWorkspaceWindow()
            }
        }
    }
    #endif
}

extension AppDelegate: UNUserNotificationCenterDelegate {
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification
    ) async -> UNNotificationPresentationOptions {
        [.banner, .list, .sound]
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse
    ) async {
        let request = response.notification.request
        guard let intent = BipNotificationIntent(
            notificationUserInfo: request.content.userInfo,
            identifier: request.identifier
        ) else {
            return
        }

        await MainActor.run {
            openBipNotification(intent: intent, source: "notification_center")
        }
    }
}

private struct StatusMenuContent: View {
    @Environment(\.openWindow) private var openWindow

    @ObservedObject var viewModel: AgenticViewModel
    let appDelegate: AppDelegate

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Agentic30")
                .font(.headline)

            Label(
                viewModel.connectionLabel,
                systemImage: viewModel.isConnected
                ? "checkmark.circle.fill"
                : "antenna.radiowaves.left.and.right.slash"
            )
            .foregroundStyle(viewModel.isConnected ? .green : .secondary)

            if let session = viewModel.selectedSession {
                VStack(alignment: .leading, spacing: 4) {
                    Text(session.title)
                        .font(.subheadline.weight(.semibold))
                    Text(session.lastMessagePreview)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                }
            } else {
                Text("No active session")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Divider()

            Button("Open Workspace") {
                openWorkspaceWindow()
            }

            Button("Workspace Switcher Tour") {
                viewModel.requestWorkspaceSwitcherTourOpen()
                openWorkspaceWindow()
            }

            Button("Curriculum Navigator Tour") {
                viewModel.requestWorkspaceCurriculumNavigatorTourOpen()
                openWorkspaceWindow()
            }

            Button("Settings Tour") {
                viewModel.requestWorkspaceSettingsTourOpen()
                openWorkspaceWindow()
            }

            Button("Help Tour") {
                viewModel.requestWorkspaceHelpTourOpen()
                openWorkspaceWindow()
            }

            Button("Recent Conversations Tour") {
                viewModel.requestWorkspaceRecentConversationsTourOpen()
                openWorkspaceWindow()
            }

            Button("New Codex Chat") {
                viewModel.createSession(provider: .codex)
                openWorkspaceWindow()
            }

            Button("New Claude Chat") {
                viewModel.createSession(provider: .claude)
                openWorkspaceWindow()
            }

            if let selectedSession = viewModel.selectedSession,
               selectedSession.status == .running || selectedSession.status == .awaitingInput {
                Button("Stop Current Session") {
                    viewModel.stopSelectedSession()
                }
            }

            let visibleSessions = viewModel.sessions.filter { $0.archivedAt == nil }
            if !visibleSessions.isEmpty {
                Divider()

                Text("Sessions")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)

                ForEach(visibleSessions.prefix(6)) { session in
                    Button {
                        viewModel.selectSession(session.id)
                        openWorkspaceWindow()
                    } label: {
                        HStack(spacing: 8) {
                            Circle()
                                .fill(statusColor(for: session))
                                .frame(width: 7, height: 7)

                            VStack(alignment: .leading, spacing: 2) {
                                Text(session.title)
                                    .font(.subheadline.weight(.semibold))
                                    .lineLimit(1)
                                Text(session.lastMessagePreview)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                    .lineLimit(1)
                            }

                            Spacer(minLength: 0)
                        }
                    }
                    .buttonStyle(.plain)
                }
            }

            Divider()

            Toggle("Show Wolf Pet", isOn: Binding(
                get: { appDelegate.petWindowController.isEnabled },
                set: { newValue in
                    appDelegate.petWindowController.isEnabled = newValue
                    PostHogTelemetry.capture(
                        newValue ? "mac_pet_shown" : "mac_pet_hidden",
                        authSession: viewModel.macAuthSession
                    )
                }
            ))

            Button {
                viewModel.requestWorkspaceSettingsOpen()
                openWorkspaceWindow()
            } label: {
                Text("Settings…")
            }

            Button("Quit") {
                NSApplication.shared.terminate(nil)
            }
        }
        .padding(.vertical, 4)
        .onAppear {
            installWorkspaceOpenHandler()
            viewModel.start()
        }
    }

    private func openWorkspaceWindow() {
        installWorkspaceOpenHandler()
        appDelegate.openWorkspaceWindow()
    }

    private func installWorkspaceOpenHandler() {
        appDelegate.installWorkspaceOpenHandler {
            openWindow(id: "workspace")
        }
    }

    private func statusColor(for session: ChatSession) -> Color {
        switch session.status {
        case .idle:
            return .white.opacity(0.32)
        case .running:
            return .green
        case .awaitingInput:
            return .blue
        case .error:
            return .red
        }
    }
}

private struct StatusMenuLabel: View {
    @Environment(\.openWindow) private var openWindow

    let appDelegate: AppDelegate

    var body: some View {
        Image("StatusBarIcon")
            .renderingMode(.template)
            .onAppear {
                appDelegate.installWorkspaceOpenHandler {
                    openWindow(id: "workspace")
                }
            }
    }
}
