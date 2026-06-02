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
    static let agenticOpenDesignSearchRequested = Notification.Name("agenticOpenDesignSearchRequested")
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
            .frame(minWidth: 900, minHeight: 720)
            .tint(Agentic30BrandColor.green)
            .onAppear {
                PostHogTelemetry.capture(
                    "mac_workspace_surface_opened",
                    authSession: appDelegate.viewModel.macAuthSession
                )
            }
        }
        .defaultSize(width: 1360, height: 820)
        .windowResizability(.contentMinSize)
        .defaultLaunchBehavior(CommandLine.arguments.contains { $0.hasPrefix("--ui-testing") } ? .presented : .automatic)
        .commands {
            CommandGroup(after: .appSettings) {
                Button("Check for Updates...") {
                    appDelegate.checkForUpdates(nil)
                }
                Button("Search") {
                    NotificationCenter.default.post(name: .agenticOpenDesignSearchRequested, object: nil)
                }
                .keyboardShortcut("k", modifiers: .command)
            }
        }

        Settings {
            SettingsView(viewModel: appDelegate.viewModel)
                .tint(Agentic30BrandColor.green)
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

    private let workspaceWindowTitle = "Agentic30"
    private static let updateBlockedErrorDomain = "Agentic30SparkleUpdateCheck"
    private var openWorkspaceHandler: (() -> Void)?
    private var pendingWorkspaceOpen = false
    private(set) var shouldMaximizeWorkspaceWindowOnFirstAppear = AppDelegate.shouldMaximizeWorkspaceWindowOnLaunch(
        isFirstLaunchEver: !PostHogTelemetry.hasPreviouslyGeneratedDistinctID,
        isUITesting: AppDelegate.isUITestingLaunch()
    )
    private lazy var updaterController: SPUStandardUpdaterController? = makeUpdaterController()

    private(set) var wasLaunchedAtLogin = false

    static let initialWorkspaceMaximizeDefaultsKey = "agentic30.workspaceWindow.initialInstallMaximizeApplied.v1"

    func applicationWillFinishLaunching(_ notification: Notification) {
        Agentic30Theme.current.applyAppKitAppearance()
        wasLaunchedAtLogin = LoginItemsManager.wasLaunchedAtLogin()
        #if DEBUG
        if Self.isUITestingLaunch() {
            NSApp.setActivationPolicy(.regular)
        }
        #endif
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        UNUserNotificationCenter.current().delegate = self
        _ = updaterController
        PostHogTelemetry.setup()
        // Snapshot before capture(), which lazy-generates the distinct id.
        // Pending captures from a prior failed first-launch still flush; this
        // gate only suppresses NEW captureOnce attempts for upgraders.
        let isFirstLaunchEver = !PostHogTelemetry.hasPreviouslyGeneratedDistinctID
        shouldMaximizeWorkspaceWindowOnFirstAppear = Self.shouldMaximizeWorkspaceWindowOnLaunch(
            isFirstLaunchEver: isFirstLaunchEver,
            isUITesting: Self.isUITestingLaunch()
        )
        PostHogTelemetry.capture("mac_app_launched")
        installOnboardingHelper()
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
        } else {
            NSApp.activate(ignoringOtherApps: true)
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
        } else if CommandLine.arguments.contains("--ui-testing-open-workspace") {
            scheduleUITestingWorkspaceOpen()
        }
        #endif

        if wasLaunchedAtLogin {
            DispatchQueue.main.async { [weak self] in
                self?.closeWorkspaceWindows()
            }
        }
    }

    private func installOnboardingHelper() {
        do {
            _ = try OnboardingHelperInstaller().installOrRefresh()
        } catch {
            NSLog("Agentic30 onboarding helper install failed: \(error.localizedDescription)")
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
        // Block briefly so the terminate event actually reaches PostHog. The
        // default async sender uses URLSession.shared, which the OS cancels on
        // process exit and would otherwise drop the event.
        PostHogTelemetry.captureBlocking(
            "mac_app_terminating",
            authSession: viewModel.macAuthSession
        )
        viewModel.stop()
    }

    @objc func checkForUpdates(_ sender: Any?) {
        let updaterAvailable = updaterController != nil
        PostHogTelemetry.capture(
            "mac_update_check_requested",
            properties: [
                "updater_available": updaterAvailable,
                "source": sender is NSMenuItem ? "menu" : "programmatic",
            ],
            authSession: viewModel.macAuthSession
        )
        guard let updaterController else {
            let alert = NSAlert()
            alert.messageText = "Updates are not configured for this build."
            alert.informativeText = "Release builds must include a Sparkle public EdDSA key."
            alert.alertStyle = .informational
            alert.runModal()
            return
        }
        guard updaterController.updater.canCheckForUpdates else {
            let alert = NSAlert()
            alert.messageText = "An update check is already in progress."
            alert.informativeText = "Sparkle is already checking, downloading, or preparing an update. Try again after the current update session finishes."
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

    @MainActor
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

    @MainActor
    private func openBipNotification(intent: BipNotificationIntent, source: String) {
        openWorkspaceWindow()
        viewModel.requestBipNotificationOpen(intent: intent, source: source)
    }

    private func focusWorkspaceWindow() {
        NSApp.activate(ignoringOtherApps: true)
        _ = makeWorkspaceWindowKey()

        // `openWindow(id:)` creates/restores the SwiftUI window asynchronously.
        // Retry after the current run loop so notification opens focus a
        // newly-created workspace instead of only requesting it.
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

    private struct SparkleConfiguration {
        var configured: Bool
        var feedURL: String
        var publicKey: String
        var automaticChecksEnabled: Bool
        var automaticDownloadsEnabled: Bool
    }

    static func hasUsableSparklePublicKey(_ publicKey: String?) -> Bool {
        guard let publicKey else { return false }
        let trimmedPublicKey = publicKey.trimmingCharacters(in: .whitespacesAndNewlines)
        return !trimmedPublicKey.isEmpty && !trimmedPublicKey.contains("$(")
    }

    static func updateCheckBlockReason(isUITestingLaunch: Bool, hasUsablePublicKey: Bool) -> String? {
        #if DEBUG
        if isUITestingLaunch {
            return "Update checks are disabled during UI tests."
        }
        #endif
        if !hasUsablePublicKey {
            return "Release builds must include a Sparkle public EdDSA key."
        }
        return nil
    }

    private static func sparkleConfiguration(bundle: Bundle = .main) -> SparkleConfiguration {
        let publicKey = bundle.object(forInfoDictionaryKey: "SUPublicEDKey") as? String
        let feedURL = bundle.object(forInfoDictionaryKey: "SUFeedURL") as? String
            ?? AppUpdateState.defaultFeedURL
        let automaticChecksEnabled = (bundle.object(forInfoDictionaryKey: "SUEnableAutomaticChecks") as? Bool) ?? false
        let automaticDownloadsEnabled = (bundle.object(forInfoDictionaryKey: "SUAutomaticallyUpdate") as? Bool) ?? false
        return SparkleConfiguration(
            configured: hasUsableSparklePublicKey(publicKey),
            feedURL: feedURL,
            publicKey: publicKey?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "",
            automaticChecksEnabled: automaticChecksEnabled,
            automaticDownloadsEnabled: automaticDownloadsEnabled
        )
    }

    @MainActor
    private func makeUpdaterController() -> SPUStandardUpdaterController? {
        let configuration = Self.sparkleConfiguration()
        viewModel.configureAppUpdates(
            configured: configuration.configured,
            feedURL: configuration.feedURL,
            automaticChecksEnabled: configuration.automaticChecksEnabled,
            automaticDownloadsEnabled: configuration.automaticDownloadsEnabled
        )
        guard configuration.configured else {
            return nil
        }
        let controller = SPUStandardUpdaterController(
            startingUpdater: true,
            updaterDelegate: self,
            userDriverDelegate: nil
        )
        viewModel.configureAppUpdates(
            configured: true,
            feedURL: configuration.feedURL,
            automaticChecksEnabled: controller.updater.automaticallyChecksForUpdates,
            automaticDownloadsEnabled: controller.updater.automaticallyDownloadsUpdates
        )
        return controller
    }

    #if DEBUG
    private func scheduleUITestingWorkspaceOpen() {
        for delay in [0.0, 0.2, 0.6, 1.0] {
            DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self] in
                self?.openWorkspaceWindow()
            }
        }
    }
    #endif
}

extension AppDelegate: SPUUpdaterDelegate {
    func updater(_ updater: SPUUpdater, mayPerform updateCheck: SPUUpdateCheck) throws {
        let configuration = Self.sparkleConfiguration()
        if let reason = Self.updateCheckBlockReason(
            isUITestingLaunch: Self.isUITestingLaunch(),
            hasUsablePublicKey: configuration.configured
        ) {
            viewModel.recordAppUpdateBlocked(reason)
            throw NSError(
                domain: Self.updateBlockedErrorDomain,
                code: configuration.configured ? 1 : 2,
                userInfo: [NSLocalizedDescriptionKey: reason]
            )
        }

        viewModel.recordAppUpdateCheckStarted()
    }

    func updater(_ updater: SPUUpdater, didFinishLoading appcast: SUAppcast) {
        viewModel.recordAppUpdateAppcastLoaded(itemCount: appcast.items.count)
        PostHogTelemetry.capture(
            "mac_update_appcast_loaded",
            properties: [
                "item_count": appcast.items.count,
                "feed_url": viewModel.appUpdateState.feedURL,
            ],
            authSession: viewModel.macAuthSession
        )
    }

    func updater(_ updater: SPUUpdater, didFindValidUpdate item: SUAppcastItem) {
        viewModel.recordAppUpdateAvailable(
            version: item.versionString,
            displayVersion: item.displayVersionString
        )
        PostHogTelemetry.capture(
            "mac_update_available",
            properties: updateTelemetryProperties(for: item),
            authSession: viewModel.macAuthSession
        )
    }

    func updaterDidNotFindUpdate(_ updater: SPUUpdater, error: Error) {
        viewModel.recordAppUpdateLatest()
        PostHogTelemetry.capture(
            "mac_update_not_found",
            properties: [
                "error_description": error.localizedDescription,
                "feed_url": viewModel.appUpdateState.feedURL,
            ],
            authSession: viewModel.macAuthSession
        )
    }

    func updater(_ updater: SPUUpdater, didDownloadUpdate item: SUAppcastItem) {
        viewModel.recordAppUpdateDownloaded(
            version: item.versionString,
            displayVersion: item.displayVersionString
        )
    }

    func updater(_ updater: SPUUpdater, willInstallUpdate item: SUAppcastItem) {
        viewModel.recordAppUpdateInstalling(
            version: item.versionString,
            displayVersion: item.displayVersionString
        )
    }

    func updater(_ updater: SPUUpdater, didFinishUpdateCycleFor updateCheck: SPUUpdateCheck, error: Error?) {
        if let error {
            viewModel.recordAppUpdateError(error.localizedDescription)
            PostHogTelemetry.capture(
                "mac_update_error",
                properties: [
                    "error_description": error.localizedDescription,
                    "feed_url": viewModel.appUpdateState.feedURL,
                ],
                authSession: viewModel.macAuthSession
            )
        }

        PostHogTelemetry.capture(
            "mac_update_cycle_finished",
            properties: [
                "had_error": error != nil,
                "feed_url": viewModel.appUpdateState.feedURL,
                "last_result": viewModel.appUpdateState.lastResult.statusText,
            ],
            authSession: viewModel.macAuthSession
        )
    }

    @MainActor
    private func updateTelemetryProperties(for item: SUAppcastItem) -> [String: Any] {
        [
            "version": item.versionString,
            "display_version": item.displayVersionString,
            "title": item.title ?? "",
            "download_url": item.fileURL?.absoluteString ?? "",
            "feed_url": viewModel.appUpdateState.feedURL,
        ]
    }
}

extension AppDelegate: UNUserNotificationCenterDelegate {
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification
    ) async -> UNNotificationPresentationOptions {
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains(where: { $0.hasPrefix("--ui-testing") }) {
            return []
        }
        #endif
        return [.banner, .list, .sound]
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
            .foregroundStyle(viewModel.isConnected ? Agentic30BrandColor.green : .secondary)

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
                PostHogTelemetry.capture(
                    "mac_menu_bar_action",
                    properties: ["action": "open_workspace"],
                    authSession: viewModel.macAuthSession
                )
                openWorkspaceWindow()
            }

            Button("New Codex Chat") {
                viewModel.createSession(provider: .codex, source: "menu_bar")
                openWorkspaceWindow()
            }

            Button("New Claude Chat") {
                viewModel.createSession(provider: .claude, source: "menu_bar")
                openWorkspaceWindow()
            }

            if let selectedSession = viewModel.selectedSession,
               selectedSession.status == .running || selectedSession.status == .awaitingInput {
                Button("Stop Current Session") {
                    PostHogTelemetry.capture(
                        "mac_menu_bar_action",
                        properties: [
                            "action": "stop_session",
                            "session_id": selectedSession.id,
                        ],
                        authSession: viewModel.macAuthSession
                    )
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
                        PostHogTelemetry.capture(
                            "mac_menu_bar_action",
                            properties: [
                                "action": "select_session",
                                "session_id": session.id,
                                "provider": session.provider.rawValue,
                            ],
                            authSession: viewModel.macAuthSession
                        )
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

            Button {
                PostHogTelemetry.capture(
                    "mac_menu_bar_action",
                    properties: ["action": "open_settings"],
                    authSession: viewModel.macAuthSession
                )
                NSApp.activate(ignoringOtherApps: true)
                if !NSApp.sendAction(Selector(("showSettingsWindow:")), to: nil, from: nil) {
                    NSApp.sendAction(Selector(("showPreferencesWindow:")), to: nil, from: nil)
                }
            } label: {
                Text("Settings…")
            }

            Button("Quit") {
                PostHogTelemetry.captureBlocking(
                    "mac_menu_bar_action",
                    properties: ["action": "quit"],
                    authSession: viewModel.macAuthSession
                )
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
            return Agentic30BrandColor.green
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
