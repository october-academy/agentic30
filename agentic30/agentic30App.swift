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
    static let agenticOpenDesignSettingsRequested = Notification.Name("agenticOpenDesignSettingsRequested")
    static let agenticOpenDesignRouteRequested = Notification.Name("agenticOpenDesignRouteRequested")
    static let agenticAppRouteRequested = Notification.Name("agenticAppRouteRequested")
    static let agenticShowAppUpdateStatusPanelRequested = Notification.Name("agenticShowAppUpdateStatusPanelRequested")
}

enum AgenticSettingsRouteNotification {
    static let sectionUserInfoKey = "section"
}

@main
struct agentic30App: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate

    init() {
        #if DEBUG
        if CommandLine.arguments.contains(where: { $0.hasPrefix("--ui-testing") })
            || ProcessInfo.processInfo.environment["AGENTIC30_UI_TESTING"] == "1" {
            NSApplication.shared.setActivationPolicy(.regular)
        }
        #endif
    }

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
        .defaultLaunchBehavior(
            (CommandLine.arguments.contains { $0.hasPrefix("--ui-testing") }
                || ProcessInfo.processInfo.environment["AGENTIC30_UI_TESTING"] == "1")
            ? .presented
            : .automatic
        )
        .commands {
            CommandGroup(replacing: .appSettings) {
                Button("Settings…") {
                    appDelegate.openSettingsInWorkspace(source: "app_menu")
                }
                .keyboardShortcut(",", modifiers: .command)

                Button("Check for Updates...") {
                    appDelegate.checkForUpdates(nil)
                }

                Button("Search") {
                    NotificationCenter.default.post(name: .agenticOpenDesignSearchRequested, object: nil)
                }
                .keyboardShortcut("k", modifiers: .command)
            }
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

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    let viewModel = AgenticViewModel()

    private let workspaceWindowTitle = "Agentic30"
    private static let updateBlockedErrorDomain = "Agentic30SparkleUpdateCheck"
    private static let sparkleNoUpdateErrorCode = 1001
    private var openWorkspaceHandler: (() -> Void)?
    private var pendingWorkspaceOpen = false
    #if DEBUG || AGENTIC30_LIVE_SIGNED_UI_E2E
    private var uiTestingMenuFixtureWindow: NSWindow?
    private var uiTestingWorkspaceWindow: NSWindow?
    private weak var uiTestingUpdateInvokedLabel: NSTextField?
    private var didRequestUITestingWorkspaceAfterActivation = false
    #endif
    private(set) var shouldMaximizeWorkspaceWindowOnFirstAppear = AppDelegate.shouldMaximizeWorkspaceWindowOnLaunch(
        isFirstLaunchEver: !PostHogTelemetry.hasPreviouslyGeneratedDistinctID,
        isUITesting: AppDelegate.isUITestingLaunch()
    )
    private lazy var updaterController: SPUStandardUpdaterController? = makeUpdaterController()

    private(set) var wasLaunchedAtLogin = false

    nonisolated static let initialWorkspaceMaximizeDefaultsKey = "agentic30.workspaceWindow.initialInstallMaximizeApplied.v1"

    func applicationWillFinishLaunching(_ notification: Notification) {
        Agentic30Theme.current.applyAppKitAppearance()
        wasLaunchedAtLogin = LoginItemsManager.wasLaunchedAtLogin()
        #if DEBUG || AGENTIC30_LIVE_SIGNED_UI_E2E
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

        #if DEBUG || AGENTIC30_LIVE_SIGNED_UI_E2E
        presentUITestingMenuFixtureWindowIfNeeded()
        if CommandLine.arguments.contains("--ui-testing-open-settings") {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { [weak self] in
                self?.openSettingsInWorkspace(source: "ui_test_launch_argument")
            }
        } else if Self.uiTestingFlag("--ui-testing-open-workspace") {
            scheduleUITestingWorkspaceOpen()
        }
        #endif

        if wasLaunchedAtLogin {
            DispatchQueue.main.async { [weak self] in
                self?.closeWorkspaceWindows()
            }
        }
    }

    #if DEBUG || AGENTIC30_LIVE_SIGNED_UI_E2E
    private func presentUITestingMenuFixtureWindowIfNeeded() {
        let showsAppCommandFixture = CommandLine.arguments.contains("--ui-testing-show-app-command-fixture")
        let showsStatusMenuFixture = CommandLine.arguments.contains("--ui-testing-show-status-menu-fixture")
        guard showsAppCommandFixture || showsStatusMenuFixture else { return }

        if let uiTestingMenuFixtureWindow {
            uiTestingMenuFixtureWindow.orderFront(nil)
            return
        }

        let stackView = NSStackView()
        stackView.orientation = .vertical
        stackView.alignment = .leading
        stackView.spacing = 8
        stackView.edgeInsets = NSEdgeInsets(top: 12, left: 12, bottom: 12, right: 12)
        stackView.translatesAutoresizingMaskIntoConstraints = false

        if showsAppCommandFixture {
            let title = NSTextField(labelWithString: "App Commands")
            title.font = .boldSystemFont(ofSize: NSFont.smallSystemFontSize)
            stackView.addArrangedSubview(title)
            stackView.addArrangedSubview(makeUITestingFixtureButton(
                title: "Settings…",
                identifier: "uiTesting.appCommands.settingsButton",
                action: #selector(uiTestingOpenSettingsFromAppCommandsFixture)
            ))
            stackView.addArrangedSubview(makeUITestingFixtureButton(
                title: "Check for Updates...",
                identifier: "uiTesting.appCommands.checkUpdatesButton",
                action: #selector(uiTestingCheckForUpdatesFromAppCommandsFixture)
            ))
            stackView.addArrangedSubview(makeUITestingFixtureButton(
                title: "Search",
                identifier: "uiTesting.appCommands.searchButton",
                action: #selector(uiTestingOpenSearchFromAppCommandsFixture)
            ))

            let updateInvokedLabel = NSTextField(labelWithString: "Update command invoked")
            updateInvokedLabel.identifier = NSUserInterfaceItemIdentifier("uiTesting.appCommands.updateInvoked")
            updateInvokedLabel.isHidden = true
            uiTestingUpdateInvokedLabel = updateInvokedLabel
            stackView.addArrangedSubview(updateInvokedLabel)
        }

        if showsStatusMenuFixture {
            if showsAppCommandFixture {
                let separator = NSBox()
                separator.boxType = .separator
                stackView.addArrangedSubview(separator)
            }
            let title = NSTextField(labelWithString: "Status Menu")
            title.font = .boldSystemFont(ofSize: NSFont.smallSystemFontSize)
            stackView.addArrangedSubview(title)
            stackView.addArrangedSubview(makeUITestingFixtureButton(
                title: "Open Workspace",
                identifier: "statusMenu.openWorkspaceButton",
                action: #selector(uiTestingOpenWorkspaceFromStatusMenuFixture)
            ))
            stackView.addArrangedSubview(makeUITestingFixtureButton(
                title: "New Codex Chat",
                identifier: "statusMenu.newCodexChatButton",
                action: #selector(uiTestingNewCodexChatFromStatusMenuFixture)
            ))
            stackView.addArrangedSubview(makeUITestingFixtureButton(
                title: "New Claude Chat",
                identifier: "statusMenu.newClaudeChatButton",
                action: #selector(uiTestingNewClaudeChatFromStatusMenuFixture)
            ))
            stackView.addArrangedSubview(makeUITestingFixtureButton(
                title: "Settings…",
                identifier: "statusMenu.settingsButton",
                action: #selector(uiTestingOpenSettingsFromStatusMenuFixture)
            ))
            stackView.addArrangedSubview(makeUITestingFixtureButton(
                title: "Quit",
                identifier: "statusMenu.quitButton",
                action: #selector(uiTestingQuitFromStatusMenuFixture)
            ))
        }

        let container = NSView()
        container.addSubview(stackView)
        NSLayoutConstraint.activate([
            stackView.leadingAnchor.constraint(equalTo: container.leadingAnchor),
            stackView.trailingAnchor.constraint(equalTo: container.trailingAnchor),
            stackView.topAnchor.constraint(equalTo: container.topAnchor),
            stackView.bottomAnchor.constraint(equalTo: container.bottomAnchor),
        ])

        let fixtureWindow = NSWindow(
            contentRect: NSRect(x: 80, y: 80, width: 260, height: showsAppCommandFixture && showsStatusMenuFixture ? 330 : 200),
            styleMask: [.titled, .utilityWindow],
            backing: .buffered,
            defer: false
        )
        fixtureWindow.title = "Agentic30 UI Test Commands"
        fixtureWindow.identifier = NSUserInterfaceItemIdentifier("uiTesting.menuFixtures")
        fixtureWindow.contentView = container
        fixtureWindow.isReleasedWhenClosed = false
        fixtureWindow.level = .floating
        uiTestingMenuFixtureWindow = fixtureWindow
        fixtureWindow.orderFront(nil)
    }

    private func makeUITestingFixtureButton(title: String, identifier: String, action: Selector) -> NSButton {
        let button = NSButton(title: title, target: self, action: action)
        button.identifier = NSUserInterfaceItemIdentifier(identifier)
        button.setButtonType(.momentaryPushIn)
        button.bezelStyle = .rounded
        return button
    }

    @objc private func uiTestingOpenSettingsFromAppCommandsFixture() {
        openSettingsInWorkspace(source: "ui_test_app_command_fixture")
    }

    @objc private func uiTestingCheckForUpdatesFromAppCommandsFixture() {
        uiTestingUpdateInvokedLabel?.isHidden = false
        checkForUpdates(nil)
    }

    @objc private func uiTestingOpenSearchFromAppCommandsFixture() {
        NotificationCenter.default.post(name: .agenticOpenDesignSearchRequested, object: nil)
    }

    @objc private func uiTestingOpenWorkspaceFromStatusMenuFixture() {
        PostHogTelemetry.capture(
            "mac_menu_bar_action",
            properties: ["action": "open_workspace"],
            authSession: viewModel.macAuthSession
        )
        openWorkspaceWindow()
    }

    @objc private func uiTestingNewCodexChatFromStatusMenuFixture() {
        viewModel.createSession(provider: .codex, source: "menu_bar")
        openWorkspaceWindow()
    }

    @objc private func uiTestingNewClaudeChatFromStatusMenuFixture() {
        viewModel.createSession(provider: .claude, source: "menu_bar")
        openWorkspaceWindow()
    }

    @objc private func uiTestingOpenSettingsFromStatusMenuFixture() {
        PostHogTelemetry.capture(
            "mac_menu_bar_action",
            properties: ["action": "open_settings"],
            authSession: viewModel.macAuthSession
        )
        openSettingsInWorkspace(source: "menu_bar")
    }

    @objc private func uiTestingQuitFromStatusMenuFixture() {
        PostHogTelemetry.captureBlocking(
            "mac_menu_bar_action",
            properties: ["action": "quit"],
            authSession: viewModel.macAuthSession
        )
        NSApplication.shared.terminate(nil)
    }
    #endif

    private func installOnboardingHelper() {
        do {
            _ = try OnboardingHelperInstaller().installOrRefresh()
        } catch {
            NSLog("Agentic30 onboarding helper install failed: \(error.localizedDescription)")
        }
    }

    nonisolated static func shouldMaximizeWorkspaceWindowOnLaunch(
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
            || ProcessInfo.processInfo.environment["AGENTIC30_UI_TESTING"] == "1"
    }

    private static func uiTestingFlag(_ argument: String) -> Bool {
        if CommandLine.arguments.contains(argument) { return true }
        let key = uiTestingEnvironmentKey(for: argument)
        guard let value = ProcessInfo.processInfo.environment[key] else { return false }
        return ["1", "true", "yes", "on"].contains(value.lowercased())
    }

    private static func uiTestingEnvironmentKey(for argument: String) -> String {
        let trimmed = argument.hasPrefix("--") ? String(argument.dropFirst(2)) : argument
        let normalized = trimmed
            .replacingOccurrences(of: "-", with: "_")
            .uppercased()
        return "AGENTIC30_\(normalized)"
    }

    func applicationDidBecomeActive(_ notification: Notification) {
        // The user is back in the app; question-ready banners in Notification
        // Center are stale from here on.
        OfficeHoursQuestionReadyNotification.removeDelivered()
        #if DEBUG || AGENTIC30_LIVE_SIGNED_UI_E2E
        guard Self.isUITestingLaunch(),
              Self.uiTestingFlag("--ui-testing-open-workspace"),
              !didRequestUITestingWorkspaceAfterActivation else {
            return
        }
        didRequestUITestingWorkspaceAfterActivation = true
        DispatchQueue.main.async { [weak self] in
            if Self.uiTestingFlag("--ui-testing-direct-workspace-window") {
                self?.presentUITestingWorkspaceWindow()
                self?.requestUITestingOfficeHoursRouteIfNeeded()
            } else {
                self?.openWorkspaceWindow()
            }
        }
        #endif
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
            if Self.isUITestingLaunch() {
                openWorkspaceWindow()
                requestAppUpdateStatusPanel()
                if !viewModel.requiresMacOnboarding {
                    requestOpenDesignSettingsRoute(section: .updates)
                }
                return
            }
            let alert = NSAlert()
            alert.messageText = "Updates are not configured for this build."
            alert.informativeText = "Release builds must include a Sparkle public EdDSA key."
            alert.alertStyle = .informational
            alert.runModal()
            return
        }
        guard updaterController.updater.canCheckForUpdates else {
            PostHogTelemetry.capture(
                "mac_update_check_busy",
                properties: [
                    "requires_onboarding": viewModel.requiresMacOnboarding,
                    "last_result": viewModel.appUpdateState.lastResult.statusText,
                ],
                authSession: viewModel.macAuthSession
            )
            openWorkspaceWindow()
            // Always surface the transient status panel: while a background
            // download is in flight the Settings row only offers a disabled
            // button, which reads as a dead end after the pill promised action.
            requestAppUpdateStatusPanel()
            if !viewModel.requiresMacOnboarding {
                requestOpenDesignSettingsRoute(section: .updates)
            }
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

    func application(_ application: NSApplication, open urls: [URL]) {
        for url in urls {
            handleAppRouteURL(url)
        }
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
            #if DEBUG || AGENTIC30_LIVE_SIGNED_UI_E2E
            if Self.isUITestingLaunch() {
                presentUITestingWorkspaceWindow()
                return
            }
            #endif
            pendingWorkspaceOpen = true
            PostHogTelemetry.capture("mac_workspace_open_handler_missing", authSession: viewModel.macAuthSession)
        }
    }

    @MainActor
    func openSettingsInWorkspace(source: String, section: SettingsSection? = nil) {
        PostHogTelemetry.capture(
            "mac_settings_open_requested",
            properties: [
                "source": source,
                "section": section?.rawValue ?? "default",
            ],
            authSession: viewModel.macAuthSession
        )
        openWorkspaceWindow()
        requestAgenticAppRoute(AgenticAppRoute(
            destination: .settings(section: section),
            telemetrySource: source
        ))
    }

    @MainActor
    func handleAppRouteURL(_ url: URL) {
        guard let route = AgenticAppRoute(url: url) else {
            PostHogTelemetry.capture(
                "mac_deep_link_ignored",
                properties: [
                    "scheme": url.scheme ?? "",
                    "host": url.host(percentEncoded: false) ?? "",
                    "path": url.path,
                ],
                authSession: viewModel.macAuthSession
            )
            return
        }

        handleAppRoute(route)
    }

    @MainActor
    func handleAppRoute(_ route: AgenticAppRoute) {
        PostHogTelemetry.capture(
            "mac_app_route_requested",
            properties: [
                "source": route.telemetrySource,
                "destination": route.telemetryDestination,
            ],
            authSession: viewModel.macAuthSession
        )

        openWorkspaceWindow()
        if case .officeHoursQuestion(let sessionId, let requestId) = route.destination {
            viewModel.requestOfficeHoursQuestionReadyOpen(
                sessionId: sessionId,
                requestId: requestId,
                source: route.telemetrySource
            )
        }
        if case .document(let path) = route.destination {
            NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: path)])
            return
        }
        requestAgenticAppRoute(route)
    }

    private func requestOpenDesignSettingsRoute(section: SettingsSection? = nil) {
        let userInfo = Self.settingsRouteUserInfo(section: section)
        NotificationCenter.default.post(name: .agenticOpenDesignSettingsRequested, object: nil, userInfo: userInfo)
        DispatchQueue.main.async {
            NotificationCenter.default.post(name: .agenticOpenDesignSettingsRequested, object: nil, userInfo: userInfo)
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) {
            NotificationCenter.default.post(name: .agenticOpenDesignSettingsRequested, object: nil, userInfo: userInfo)
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) {
            NotificationCenter.default.post(name: .agenticOpenDesignSettingsRequested, object: nil, userInfo: userInfo)
        }
    }

    private func requestOpenDesignRoute(_ route: LongRunningCompletionRoute) {
        let userInfo: [AnyHashable: Any] = [
            LongRunningCompletionNotification.routeUserInfoKey: route.rawValue,
        ]
        NotificationCenter.default.post(name: .agenticOpenDesignRouteRequested, object: nil, userInfo: userInfo)
        DispatchQueue.main.async {
            NotificationCenter.default.post(name: .agenticOpenDesignRouteRequested, object: nil, userInfo: userInfo)
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) {
            NotificationCenter.default.post(name: .agenticOpenDesignRouteRequested, object: nil, userInfo: userInfo)
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) {
            NotificationCenter.default.post(name: .agenticOpenDesignRouteRequested, object: nil, userInfo: userInfo)
        }
    }

    private func requestAgenticAppRoute(_ route: AgenticAppRoute) {
        let userInfo = AgenticAppRoute.routeURLUserInfo(route)
        NotificationCenter.default.post(name: .agenticAppRouteRequested, object: nil, userInfo: userInfo)
        DispatchQueue.main.async {
            NotificationCenter.default.post(name: .agenticAppRouteRequested, object: nil, userInfo: userInfo)
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) {
            NotificationCenter.default.post(name: .agenticAppRouteRequested, object: nil, userInfo: userInfo)
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) {
            NotificationCenter.default.post(name: .agenticAppRouteRequested, object: nil, userInfo: userInfo)
        }
    }

    private static func settingsRouteUserInfo(section: SettingsSection?) -> [AnyHashable: Any]? {
        guard let section else { return nil }
        return [AgenticSettingsRouteNotification.sectionUserInfoKey: section.rawValue]
    }

    private func requestAppUpdateStatusPanel() {
        NotificationCenter.default.post(name: .agenticShowAppUpdateStatusPanelRequested, object: nil)
        DispatchQueue.main.async {
            NotificationCenter.default.post(name: .agenticShowAppUpdateStatusPanelRequested, object: nil)
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) {
            NotificationCenter.default.post(name: .agenticShowAppUpdateStatusPanelRequested, object: nil)
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) {
            NotificationCenter.default.post(name: .agenticShowAppUpdateStatusPanelRequested, object: nil)
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
    private func openOfficeHoursQuestionReady(sessionId: String, source: String) {
        openWorkspaceWindow()
        viewModel.requestOfficeHoursQuestionReadyOpen(sessionId: sessionId, source: source)
    }

    @MainActor
    private func openLongRunningCompletionNotification(_ notification: LongRunningCompletionNotification) {
        openWorkspaceWindow()
        if notification.route == .document {
            if let docPath = notification.docPath {
                NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: docPath)])
            }
            return
        }
        requestOpenDesignRoute(notification.route)
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

    static func isSparkleNoUpdateCycleError(_ error: Error) -> Bool {
        let nsError = error as NSError
        if nsError.domain == SUSparkleErrorDomain && nsError.code == Self.sparkleNoUpdateErrorCode {
            return true
        }

        let normalizedDescription = error.localizedDescription
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: "’", with: "'")
            .lowercased()
        return normalizedDescription == "you're up to date!"
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
            userDriverDelegate: self
        )
        viewModel.configureAppUpdates(
            configured: true,
            feedURL: configuration.feedURL,
            automaticChecksEnabled: controller.updater.automaticallyChecksForUpdates,
            automaticDownloadsEnabled: controller.updater.automaticallyDownloadsUpdates
        )
        return controller
    }

    #if DEBUG || AGENTIC30_LIVE_SIGNED_UI_E2E
    private func presentUITestingWorkspaceWindow() {
        NSApp.setActivationPolicy(.regular)
        if let uiTestingWorkspaceWindow {
            uiTestingWorkspaceWindow.makeKeyAndOrderFront(nil)
            uiTestingWorkspaceWindow.orderFrontRegardless()
            NSApp.activate(ignoringOtherApps: true)
            return
        }

        let hostingView = NSHostingView(rootView: ContentView(
            viewModel: viewModel,
            surfaceOverride: .workspace,
            maximizeWorkspaceOnFirstAppear: false,
            markWorkspaceInitialMaximizeApplied: {}
        ))
        let window = NSWindow(
            contentRect: NSRect(x: 120, y: 120, width: 1360, height: 820),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = workspaceWindowTitle
        window.contentView = hostingView
        window.isReleasedWhenClosed = false
        uiTestingWorkspaceWindow = window
        window.center()
        window.makeKeyAndOrderFront(nil)
        window.orderFrontRegardless()
        NSApp.activate(ignoringOtherApps: true)
    }

    private func scheduleUITestingWorkspaceOpen() {
        let useDirectWorkspaceWindow = Self.uiTestingFlag("--ui-testing-direct-workspace-window")
        for delay in [0.0, 0.2, 0.6, 1.0] {
            DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self] in
                if useDirectWorkspaceWindow {
                    self?.presentUITestingWorkspaceWindow()
                    self?.requestUITestingOfficeHoursRouteIfNeeded()
                } else {
                    self?.openWorkspaceWindow()
                }
            }
        }
    }

    private func requestUITestingOfficeHoursRouteIfNeeded() {
        guard CommandLine.arguments.contains("--ui-testing-seed-office-hours-structured-prompt") else { return }
        _ = viewModel.ensureOfficeHoursSession(forDay: 1)
        guard let session = viewModel.selectedSession,
              session.runtime?.officeHours?.active == true else { return }
        requestAgenticAppRoute(AgenticAppRoute(
            destination: .officeHoursQuestion(
                sessionId: session.id,
                requestId: session.pendingUserInput?.requestId
            ),
            telemetrySource: "ui_test_launch_argument"
        ))
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

    func updater(
        _ updater: SPUUpdater,
        userDidMake choice: SPUUserUpdateChoice,
        forUpdate updateItem: SUAppcastItem,
        state: SPUUserUpdateState
    ) {
        // Only .skip clears the gentle pill — Sparkle persists the skipped
        // version and future scheduled checks report "no update" for it, so
        // keeping the pill would nag about a build the user declined.
        // .dismiss ("Remind Me Later") keeping the pill is the gentle-reminder
        // feature working as intended.
        guard choice == .skip else { return }
        viewModel.recordAppUpdateSkipped()
        PostHogTelemetry.capture(
            "mac_update_skipped",
            properties: updateTelemetryProperties(for: updateItem),
            authSession: viewModel.macAuthSession
        )
    }

    func updater(_ updater: SPUUpdater, didFinishUpdateCycleFor updateCheck: SPUUpdateCheck, error: Error?) {
        let hadRealError: Bool
        if let error, !Self.isSparkleNoUpdateCycleError(error) {
            hadRealError = true
            viewModel.recordAppUpdateError(error.localizedDescription)
            PostHogTelemetry.capture(
                "mac_update_error",
                properties: [
                    "error_description": error.localizedDescription,
                    "feed_url": viewModel.appUpdateState.feedURL,
                ],
                authSession: viewModel.macAuthSession
            )
        } else {
            hadRealError = false
            viewModel.recordAppUpdateCycleFinished()
        }

        PostHogTelemetry.capture(
            "mac_update_cycle_finished",
            properties: [
                "had_error": hadRealError,
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

extension AppDelegate: SPUStandardUserDriverDelegate {
    /// Sparkle gentle reminders: scheduled background checks surface an in-app
    /// pill (workspace window, top-trailing) instead of stealing focus with a
    /// modal alert. https://sparkle-project.org/documentation/gentle-reminders/
    var supportsGentleScheduledUpdateReminders: Bool {
        true
    }

    func standardUserDriverShouldHandleShowingScheduledUpdate(
        _ update: SUAppcastItem,
        andInImmediateFocus immediateFocus: Bool
    ) -> Bool {
        // App frontmost and recently launched → Sparkle's standard UI is fine.
        // Otherwise defer to the gentle in-app pill driven by appUpdateState.
        immediateFocus
    }

    func standardUserDriverWillHandleShowingUpdate(
        _ handleShowingUpdate: Bool,
        forUpdate update: SUAppcastItem,
        state: SPUUserUpdateState
    ) {
        guard !handleShowingUpdate else { return }
        viewModel.recordAppUpdateAvailable(
            version: update.versionString,
            displayVersion: update.displayVersionString
        )
        PostHogTelemetry.capture(
            "mac_update_gentle_reminder_shown",
            properties: updateTelemetryProperties(for: update),
            authSession: viewModel.macAuthSession
        )
    }

    func standardUserDriverWillFinishUpdateSession() {
        viewModel.recordAppUpdateCycleFinished()
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
        if let route = AgenticAppRoute(
            notificationUserInfo: request.content.userInfo,
            telemetrySource: "notification_center"
        ) {
            await MainActor.run {
                handleAppRoute(route)
            }
            return
        }

        if let questionReady = OfficeHoursQuestionReadyNotification(
            notificationUserInfo: request.content.userInfo,
            identifier: request.identifier
        ) {
            await MainActor.run {
                handleAppRoute(questionReady.appRoute)
            }
            return
        }

        if let notification = McpOauthConnectedNotification(
            notificationUserInfo: request.content.userInfo,
            identifier: request.identifier
        ) {
            await MainActor.run {
                handleAppRoute(notification.appRoute)
            }
            return
        }

        if let completion = LongRunningCompletionNotification(
            notificationUserInfo: request.content.userInfo,
            identifier: request.identifier
        ) {
            await MainActor.run {
                handleAppRoute(AgenticAppRoute.defaultRoute(for: completion))
            }
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
            .accessibilityIdentifier("statusMenu.openWorkspaceButton")

            Button("New Codex Chat") {
                viewModel.createSession(provider: .codex, source: "menu_bar")
                openWorkspaceWindow()
            }
            .accessibilityIdentifier("statusMenu.newCodexChatButton")

            Button("New Claude Chat") {
                viewModel.createSession(provider: .claude, source: "menu_bar")
                openWorkspaceWindow()
            }
            .accessibilityIdentifier("statusMenu.newClaudeChatButton")

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
                .accessibilityIdentifier("statusMenu.stopCurrentSessionButton")
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

            if let pendingUpdateVersion = viewModel.appUpdateState.lastResult.pendingUpdateVersionLabel {
                Button {
                    PostHogTelemetry.capture(
                        "mac_menu_bar_action",
                        properties: [
                            "action": "install_update",
                            "version": pendingUpdateVersion,
                        ],
                        authSession: viewModel.macAuthSession
                    )
                    NotificationCenter.default.post(name: .agenticCheckForUpdatesRequested, object: nil)
                } label: {
                    Label("업데이트 \(pendingUpdateVersion) 설치…", systemImage: "arrow.down.circle.fill")
                        .foregroundStyle(Agentic30BrandColor.green)
                }
                .accessibilityIdentifier("statusMenu.installUpdateButton")
            }

            Button {
                PostHogTelemetry.capture(
                    "mac_menu_bar_action",
                    properties: ["action": "open_settings"],
                    authSession: viewModel.macAuthSession
                )
                appDelegate.openSettingsInWorkspace(source: "menu_bar")
            } label: {
                Text("Settings…")
            }
            .accessibilityIdentifier("statusMenu.settingsButton")

            Button("Quit") {
                PostHogTelemetry.captureBlocking(
                    "mac_menu_bar_action",
                    properties: ["action": "quit"],
                    authSession: viewModel.macAuthSession
                )
                NSApplication.shared.terminate(nil)
            }
            .accessibilityIdentifier("statusMenu.quitButton")
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
            .accessibilityLabel("Agentic30")
            .accessibilityIdentifier("agentic30.menuBarExtra")
            .onAppear {
                appDelegate.installWorkspaceOpenHandler {
                    openWindow(id: "workspace")
                }
            }
    }
}
