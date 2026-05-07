//
//  agentic30App.swift
//  agentic30
//
//  Created by october on 4/8/26.
//

import SwiftUI
import AppKit
import UserNotifications

@main
struct agentic30App: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate

    var body: some Scene {
        Window("Agentic30 Workspace", id: "workspace") {
            ContentView(
                viewModel: appDelegate.viewModel,
                surfaceOverride: .workspace
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

    private let workspaceWindowTitle = "Agentic30 Workspace"
    private var openWorkspaceHandler: (() -> Void)?
    private var pendingWorkspaceOpen = false

    func applicationDidFinishLaunching(_ notification: Notification) {
        UNUserNotificationCenter.current().delegate = self
        PostHogTelemetry.capture("mac_app_launched")

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
        } else if CommandLine.arguments.contains("--ui-testing-open-workspace-settings") {
            scheduleUITestingWorkspaceOpen(openSettings: true)
        } else if CommandLine.arguments.contains("--ui-testing-open-workspace") {
            scheduleUITestingWorkspaceOpen(openSettings: false)
        }
        #endif
    }

    func applicationWillTerminate(_ notification: Notification) {
        PostHogTelemetry.capture("mac_app_terminating")
        viewModel.stop()
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
            Text("agentic30")
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

            if !viewModel.sessions.isEmpty {
                Divider()

                Text("Sessions")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)

                ForEach(viewModel.sessions.prefix(6)) { session in
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
                set: { appDelegate.petWindowController.isEnabled = $0 }
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
