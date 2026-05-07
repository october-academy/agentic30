import Foundation
import SwiftUI
import Combine
import AuthenticationServices
import UserNotifications
import AppKit

enum BipNotificationIntent: String, Hashable, Sendable {
    case morning
    case evening

    static let userInfoKey = "agentic30.bip.intent"
    static let morningIdentifier = "agentic30.bip-coach.morning"
    static let eveningIdentifier = "agentic30.bip-coach.evening"

    var notificationIdentifier: String {
        switch self {
        case .morning:
            return Self.morningIdentifier
        case .evening:
            return Self.eveningIdentifier
        }
    }

    init?(notificationUserInfo userInfo: [AnyHashable: Any], identifier: String) {
        if let rawIntent = userInfo[Self.userInfoKey] as? String,
           let intent = BipNotificationIntent(rawValue: rawIntent) {
            self = intent
            return
        }

        switch identifier {
        case Self.morningIdentifier:
            self = .morning
        case Self.eveningIdentifier:
            self = .evening
        default:
            return nil
        }
    }

    static func uiTestingOpenArgument(in arguments: [String]) -> BipNotificationIntent? {
        guard let rawIntent = uiTestingArgumentValue("--ui-testing-open-bip-notification", arguments: arguments) else {
            return nil
        }
        return BipNotificationIntent(rawValue: rawIntent)
    }

    private static func uiTestingArgumentValue(_ name: String, arguments: [String]) -> String? {
        if let index = arguments.firstIndex(of: name), arguments.indices.contains(index + 1) {
            return arguments[index + 1]
        }
        let prefix = "\(name)="
        return arguments.first(where: { $0.hasPrefix(prefix) })?
            .dropFirst(prefix.count)
            .description
    }
}

struct BipNotificationOpenRequest: Identifiable, Equatable, Sendable {
    let id: UUID
    let intent: BipNotificationIntent
    let createdAt: Date

    init(
        id: UUID = UUID(),
        intent: BipNotificationIntent,
        createdAt: Date = Date()
    ) {
        self.id = id
        self.intent = intent
        self.createdAt = createdAt
    }
}

@MainActor
final class AgenticViewModel: ObservableObject {
    /// Fanout for the desktop pet (and any future state-driven UI). Fires
    /// after a sidecar event has been folded into ViewModel state, so the
    /// `sessions` snapshot reflects the post-event world.
    var onSidecarEvent: ((SidecarEvent, [ChatSession]) -> Void)?

    @Published private(set) var sessions: [ChatSession] = []
    @Published var selectedSessionID: String?
    @Published var selectedProvider: AgentProvider = .codex
    @Published var draft = ""
    @Published private(set) var environment = SidecarEnvironment.placeholder
    @Published private(set) var sidecarDiagnostics: SidecarDiagnostics?
    @Published private(set) var connectionLabel = "Starting sidecar..."
    @Published private(set) var isConnected = false
    @Published private(set) var workspaceRoot = ""
    @Published private(set) var lastError: String?
    @Published private(set) var presentationPhase: AssistantPresentationPhase = .compact
    @Published private(set) var activeSurface: AgenticSurface = .assistantBubble
    @Published private(set) var isScanning = false
    @Published private(set) var scanProgressMessage = ""
    @Published private(set) var scanProgressLogs: [String] = []
    @Published var scanResult: WorkspaceScanResult?
    @Published private(set) var isCreatingDoc: String?
    @Published private(set) var docCreationLogs: [String] = []
    @Published var lastDocCreated: (type: String, path: String)?
    @Published private(set) var macAuthSession: MacAuthSession?
    @Published private(set) var macOnboardingStatus: MacOnboardingStatus = .idle
    @Published private(set) var onboardingContext: OnboardingContext?
    @Published private(set) var onboardingContextStatus: OnboardingContextSubmissionStatus = .idle
    @Published private(set) var bipCoach: BipCoachState?
    @Published private(set) var isBipCoachRefreshing = false
    @Published private(set) var isBipCoachGenerating = false
    @Published private(set) var isBipCoachCompleting = false
    @Published private(set) var bipReadiness: BipReadinessState?
    @Published private(set) var bipSetupGateMessage: String?
    @Published private(set) var missingBipLocalDocs: [String] = []
    @Published private(set) var missingBipExternalRequirements: [String] = []
    @Published private(set) var bipTokenExpired: String?
    @Published private(set) var bipMissionProgress: BipMissionProgress?
    @Published private(set) var providerAuthInProgress: AgentProvider?
    @Published private(set) var providerAuthMessage: String?
    @Published private(set) var sentPromptPreviews: [String: [PendingPromptPreview]] = [:]
    @Published private(set) var sidecarOutputLogs: [String: [String]] = [:]
    @Published private(set) var workspaceSettingsOpenRequest = 0
    @Published private(set) var bipNotificationOpenRequest: BipNotificationOpenRequest?

    // Notion OAuth
    @Published private(set) var notionConnected = false
    @Published private(set) var notionOAuthInProgress = false
    @Published var notionOAuthError: String?
    private var authSession: ASWebAuthenticationSession?
    private let authPresentationContext = AuthPresentationContext()

    struct WorkspaceScanResult: Equatable {
        let icp: String?
        let spec: String?
        let values: String?
        let designSystem: String?
        let adr: String?
        let goal: String?
        let docs: String?
        let sheet: String?
        let onboardingHypothesis: WorkspaceOnboardingHypothesis?
        let error: String?
    }

    struct PendingPromptPreview: Identifiable, Hashable {
        let id: String
        let content: String
        let createdAt: Date
    }

    private var sidecar = SidecarBridge()
    private var started = false
    private var revealWorkItem: DispatchWorkItem?
    private var activePresentationSessionID: String?
    private var revealedAssistantMessageID: String?
    private var lastBipRequestedAction: BipRequestedAction?
    private var pendingBipAuthRetry: BipRequestedAction?
    private var pendingWorkspaceScanRoot: String?
    private var requestedWarmSessionIDs = Set<String>()
    private var requestedInitialBipGate = false
    private var requestedInitialBipMission = false

    private enum BipRequestedAction: Hashable {
        case refreshEvidence
        case generateMission(compact: Bool)
    }

    init() {
        let arguments = CommandLine.arguments

        #if DEBUG
        if Self.isUITesting(arguments: arguments) {
            if arguments.contains("--ui-testing-reset-onboarding") {
                WorkspaceSettings.clear()
            }
            Self.applyUITestingWorkspaceSeeds(arguments: arguments)
            macAuthSession = Self.makeUITestingMacAuthSession(arguments: arguments)
            onboardingContext = Self.makeUITestingOnboardingContext(arguments: arguments)
        } else if Self.isXCTestHost(arguments: arguments) {
            macAuthSession = nil
            onboardingContext = nil
        } else {
            if arguments.contains("--ui-testing-reset-onboarding") {
                KeychainHelper.deleteMacAuthSession()
                KeychainHelper.deleteOnboardingContext()
                WorkspaceSettings.clear()
            }
            macAuthSession = KeychainHelper.loadMacAuthSession()
            onboardingContext = KeychainHelper.loadOnboardingContext()
        }
        #else
        if arguments.contains("--ui-testing-reset-onboarding") {
            KeychainHelper.deleteMacAuthSession()
            KeychainHelper.deleteOnboardingContext()
            WorkspaceSettings.clear()
        }
        macAuthSession = KeychainHelper.loadMacAuthSession()
        onboardingContext = KeychainHelper.loadOnboardingContext()
        #endif

        if let session = macAuthSession, session.shouldRefreshSoon {
            macOnboardingStatus = .refreshing
        }
    }

    struct StructuredPromptSubmission: Hashable {
        let question: String
        let selectedOptions: [String]
        let freeText: String
    }

    var selectedSession: ChatSession? {
        sessions.first(where: { $0.id == selectedSessionID })
    }

    var pendingStructuredPrompt: StructuredPromptRequest? {
        selectedSession?.pendingUserInput
    }

    var sidecarFailureMessage: String? {
        guard !isConnected else { return nil }
        let message = connectionLabel.trimmingCharacters(in: .whitespacesAndNewlines)
        guard message.localizedCaseInsensitiveContains("sidecar failed")
            || message.localizedCaseInsensitiveContains("failed to start sidecar")
            || message.localizedCaseInsensitiveContains("sidecar is not connected") else {
            return nil
        }
        return message.nonEmpty
    }

    func requestWorkspaceSettingsOpen() {
        workspaceSettingsOpenRequest += 1
    }

    func requestBipNotificationOpen(
        intent: BipNotificationIntent,
        source: String = "notification_center"
    ) {
        PostHogTelemetry.capture("mac_bip_notification_opened", properties: [
            "intent": intent.rawValue,
            "source": source,
        ], authSession: macAuthSession)

        guard !requiresMacOnboarding else {
            bipNotificationOpenRequest = nil
            return
        }
        bipNotificationOpenRequest = BipNotificationOpenRequest(intent: intent)
    }

    func sentPromptPreview(for sessionID: String) -> String? {
        sentPromptPreviews[sessionID]?
            .last?
            .content
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .nonEmpty
    }

    func pendingPromptPreviews(for sessionID: String) -> [PendingPromptPreview] {
        sentPromptPreviews[sessionID]?
            .filter { $0.content.trimmingCharacters(in: .whitespacesAndNewlines).nonEmpty != nil } ?? []
    }

    func sidecarOutputPreview(for sessionID: String) -> [String] {
        sidecarOutputLogs[sessionID] ?? []
    }

    var visibleBipCoach: BipCoachState? {
        guard let coach = bipCoach,
              let session = selectedSession,
              coach.sessionId == session.id else {
            return nil
        }
        return coach
    }

    var requiresMacOnboarding: Bool {
        if usesInlineUITestStubResponses {
            return false
        }
        return !(macAuthSession?.isUsable ?? false)
            || !WorkspaceSettings.hasExplicitWorkspace
            || onboardingContext == nil
    }

    var needsProjectWorkspace: Bool {
        (macAuthSession?.isUsable ?? false) && !WorkspaceSettings.hasExplicitWorkspace
    }

    var needsOnboardingContext: Bool {
        (macAuthSession?.isUsable ?? false)
            && WorkspaceSettings.hasExplicitWorkspace
            && onboardingContext == nil
    }

    var signedInEmail: String? {
        macAuthSession?.email
    }

    var preferredPanelSize: CGSize {
        if requiresMacOnboarding {
            return CGSize(width: 760, height: 720)
        }

        return CGSize(width: 720, height: pendingStructuredPrompt == nil ? 660 : 600)
    }

    var canSend: Bool {
        selectedSession != nil && !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var isAnalyzeAdsCommand: Bool {
        draft.trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
            .hasPrefix("/analyze-ads")
    }

    var isBipDraftCommand: Bool {
        draft.trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
            .hasPrefix("/bip-draft")
    }

    func start() {
        guard !started else { return }
        guard !requiresMacOnboarding else {
            connectionLabel = needsProjectWorkspace ? "Choose a project workspace" : "Sign in to continue"
            isConnected = false
            return
        }
        started = true
        PostHogTelemetry.capture("mac_view_model_started", authSession: macAuthSession)

        if CommandLine.arguments.contains("--ui-testing-sidecar-failure") {
            workspaceRoot = WorkspaceSettings.resolvedURL().path
            connectionLabel = "Sidecar failed to start (signal 6). Check Node.js availability."
            isConnected = false
            ensureInlineUITestStubSession()
            PostHogTelemetry.capture("mac_sidecar_failure_stubbed_for_ui_tests", authSession: macAuthSession)
            return
        }

        if CommandLine.arguments.contains("--ui-testing-disable-sidecar") {
            if usesInlineUITestStubResponses {
                workspaceRoot = WorkspaceSettings.resolvedURL().path
                connectionLabel = "Connected (UI test stub)"
                isConnected = true
                ensureInlineUITestStubSession()
                appendInlineUITestDay1ICPConversationIfNeeded()
            } else {
                connectionLabel = "Sidecar disabled for UI tests"
                isConnected = false
            }
            PostHogTelemetry.capture("mac_sidecar_disabled_for_ui_tests", authSession: macAuthSession)
            return
        }

        sidecar.onEvent = { [weak self] event in
            Task { @MainActor in
                self?.handle(event)
            }
        }

        sidecar.start()
        if macOnboardingStatus == .refreshing {
            refreshMacAuthIfNeeded()
        }
    }

    func stop() {
        PostHogTelemetry.capture("mac_view_model_stopped", authSession: macAuthSession)
        authSession?.cancel()
        authSession = nil
        sidecar.stop()
        started = false
    }

    func reconnectSidecar() {
        guard !requiresMacOnboarding else { return }
        PostHogTelemetry.capture("mac_sidecar_reconnect_requested", authSession: macAuthSession)
        connectionLabel = "Reconnecting sidecar..."
        lastError = nil
        isConnected = false
        isBipCoachRefreshing = false
        isBipCoachGenerating = false
        isBipCoachCompleting = false
        bipMissionProgress = nil
        sidecar.stop()
        started = false
        requestedInitialBipGate = false
        requestedInitialBipMission = false
        start()
    }

    func showWorkspace() {
        guard !requiresMacOnboarding, selectedSession != nil else { return }
        PostHogTelemetry.capture("mac_workspace_surface_opened", authSession: macAuthSession)
    }

    func showAssistantBubble() {
        activeSurface = .assistantBubble
        PostHogTelemetry.capture("mac_assistant_surface_opened", authSession: macAuthSession)
    }

    func createSession(provider: AgentProvider? = nil) {
        let resolvedProvider = provider ?? selectedProvider
        let model = preferredModel(for: resolvedProvider)
        PostHogTelemetry.capture("mac_session_create_requested", properties: [
            "provider": resolvedProvider.rawValue,
            "model": model,
        ], authSession: macAuthSession)
        sidecar.send(
            payload: [
                "type": "create_session",
                "provider": resolvedProvider.rawValue,
                "model": model,
            ]
        )
    }

    func deleteSelectedSession() {
        guard let session = selectedSession else { return }
        PostHogTelemetry.capture("mac_session_delete_requested", properties: [
            "session_id": session.id,
            "provider": session.provider.rawValue,
        ], authSession: macAuthSession)
        sidecar.send(payload: [
            "type": "delete_session",
            "sessionId": session.id,
        ])
    }

    func stopSelectedSession() {
        guard let session = selectedSession else { return }
        PostHogTelemetry.capture("mac_session_stop_requested", properties: [
            "session_id": session.id,
            "provider": session.provider.rawValue,
        ], authSession: macAuthSession)
        sidecar.send(payload: [
            "type": "stop_session",
            "sessionId": session.id,
        ])
    }

    func sendPrompt() {
        guard let session = selectedSession else { return }
        let prompt = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !prompt.isEmpty else { return }
        if let pendingUserInput = session.pendingUserInput {
            let responses = pendingUserInput.questions.map { question in
                StructuredPromptSubmission(
                    question: question.question,
                    selectedOptions: [],
                    freeText: prompt
                )
            }
            draft = ""
            submitStructuredPrompt(requestId: pendingUserInput.requestId, responses: responses)
            return
        }

        // Validate /analyze-ads requires Claude provider
        if prompt.lowercased().hasPrefix("/analyze-ads") && session.provider != .claude {
            lastError = "/analyze-ads requires a Claude session"
            PostHogTelemetry.capture("mac_prompt_validation_failed", properties: [
                "session_id": session.id,
                "provider": session.provider.rawValue,
                "reason": "analyze_ads_requires_claude",
            ], authSession: macAuthSession)
            return
        }

        let commandKind: String = {
            let lower = prompt.lowercased()
            if lower.hasPrefix("/analyze-ads") { return "analyze_ads" }
            if lower.hasPrefix("/bip-draft") { return "bip_draft" }
            if lower.hasPrefix("/office-hours-docs") { return "office_hours_docs" }
            return "chat"
        }()
        PostHogTelemetry.capture("mac_prompt_send_requested", properties: [
            "session_id": session.id,
            "provider": session.provider.rawValue,
            "command_kind": commandKind,
            "prompt_length": prompt.count,
        ], authSession: macAuthSession)
        appendSentPromptPreview(sessionID: session.id, prompt: prompt)
        sidecarOutputLogs[session.id] = []
        draft = ""
        if usesInlineUITestStubResponses {
            appendInlineUITestStubResponse(prompt: prompt, sessionID: session.id)
            return
        }
        sidecar.send(payload: [
            "type": "send_prompt",
            "sessionId": session.id,
            "prompt": prompt,
        ])
    }

    func submitStructuredPrompt(
        requestId: String,
        responses: [StructuredPromptSubmission]
    ) {
        guard let session = selectedSession else { return }
        PostHogTelemetry.capture("mac_structured_input_submitted", properties: [
            "session_id": session.id,
            "request_id": requestId,
            "response_count": responses.count,
            "provider": session.provider.rawValue,
        ], authSession: macAuthSession)
        let payloadResponses = responses.map { response in
            [
                "question": response.question,
                "selectedOptions": response.selectedOptions,
                "freeText": response.freeText,
            ] as [String : Any]
        }

        sidecar.send(payload: [
            "type": "submit_user_input",
            "sessionId": session.id,
            "requestId": requestId,
            "responses": payloadResponses,
        ])
    }

    func selectSession(_ sessionID: String) {
        selectedSessionID = sessionID
        refreshPresentationState()
        requestCodexWarmupIfNeeded()
    }

    func scanWorkspace(root: String) {
        guard !root.isEmpty else { return }
        isScanning = true
        scanProgressMessage = isConnected ? "Preparing workspace scan..." : "Waiting for workspace connection..."
        scanProgressLogs = [scanProgressMessage]
        scanResult = nil
        PostHogTelemetry.capture("mac_workspace_scan_requested", properties: [
            "workspace_basename": (root as NSString).lastPathComponent,
        ], authSession: macAuthSession)
        guard isConnected else {
            pendingWorkspaceScanRoot = root
            return
        }
        sendWorkspaceScan(root: root)
    }

    private func sendWorkspaceScan(root: String) {
        sidecar.send(payload: [
            "type": "scan_workspace",
            "root": root,
        ])
    }

    private func persistWorkspaceScanResult(_ event: SidecarEvent) {
        guard event.error == nil else { return }
        let root = (event.scanRoot ?? workspaceRoot).trimmingCharacters(in: .whitespacesAndNewlines)
        guard !root.isEmpty else { return }

        var settings = KeychainHelper.loadSettings()
        let previousRoot = settings.bipWorkspaceRoot.trimmingCharacters(in: .whitespacesAndNewlines)
        settings.bipWorkspaceRoot = root
        if previousRoot != root {
            settings.bipIcpPath = ""
            settings.bipSpecPath = ""
            settings.bipValuesPath = ""
            settings.bipDesignSystemPath = ""
            settings.bipAdrPath = ""
            settings.bipGoalPath = ""
            settings.bipDocsPath = ""
            settings.bipSheetPath = ""
        }
        if let icp = event.icp { settings.bipIcpPath = icp }
        if let spec = event.spec { settings.bipSpecPath = spec }
        if let values = event.values { settings.bipValuesPath = values }
        if let designSystem = event.designSystem { settings.bipDesignSystemPath = designSystem }
        if let adr = event.adr { settings.bipAdrPath = adr }
        if let goal = event.goal { settings.bipGoalPath = goal }
        if let docs = event.docs { settings.bipDocsPath = docs }
        if let sheet = event.sheet { settings.bipSheetPath = sheet }
        try? KeychainHelper.saveSettings(settings)
        KeychainHelper.syncBipConfigFile(from: settings)
    }

    private func setScanProgress(_ text: String, reset: Bool = false) {
        let message = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !message.isEmpty else { return }
        scanProgressMessage = message
        if reset {
            scanProgressLogs = [message]
            return
        }
        if scanProgressLogs.last != message {
            scanProgressLogs.append(message)
        }
        if scanProgressLogs.count > 24 {
            scanProgressLogs = Array(scanProgressLogs.suffix(24))
        }
    }

    func startNotionOAuth() {
        notionOAuthInProgress = true
        notionOAuthError = nil
        PostHogTelemetry.capture("mac_notion_oauth_started", authSession: macAuthSession)
        sidecar.send(payload: ["type": "notion_start_oauth"])
    }

    func disconnectNotion() {
        PostHogTelemetry.capture("mac_notion_disconnected", authSession: macAuthSession)
        sidecar.send(payload: ["type": "notion_disconnect"])
    }

    func startProviderLogin(_ provider: AgentProvider) {
        guard isConnected else { return }
        providerAuthInProgress = provider
        providerAuthMessage = "\(provider.title) 로그인 시작 중..."
        lastError = nil
        PostHogTelemetry.capture("mac_provider_auth_login_started", properties: [
            "provider": provider.rawValue,
        ], authSession: macAuthSession)
        sidecar.send(payload: [
            "type": "provider_auth_login_start",
            "provider": provider.rawValue,
        ])
    }

    func requestDiagnostics() {
        PostHogTelemetry.capture("mac_diagnostics_requested", authSession: macAuthSession)
        sidecar.send(payload: ["type": "get_diagnostics"])
    }

    func configureBipCoach(
        threadsHandle: String,
        sheetUrl: String,
        docUrl: String,
        provider: AgentProvider? = nil
    ) {
        guard isConnected else { return }
        guard let sessionID = currentBipCoachSessionID() else { return }
        let resolvedProvider = provider ?? selectedSession?.provider ?? selectedProvider
        PostHogTelemetry.capture("mac_bip_coach_configure_requested", properties: [
            "session_id": sessionID,
            "provider": resolvedProvider.rawValue,
            "has_threads": !threadsHandle.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
            "has_sheet": !sheetUrl.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
            "has_doc": !docUrl.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
        ], authSession: macAuthSession)
        sidecar.send(payload: [
            "type": "bip_coach_configure",
            "sessionId": sessionID,
            "threadsHandle": threadsHandle,
            "sheetUrl": sheetUrl,
            "docUrl": docUrl,
            "provider": resolvedProvider.rawValue,
            "morningHour": 10,
            "eveningHour": 21,
        ])
    }

    func refreshBipCoachEvidence() {
        guard isConnected else { return }
        guard let sessionID = currentBipCoachSessionID() else { return }
        isBipCoachRefreshing = true
        lastBipRequestedAction = .refreshEvidence
        bipMissionProgress = BipMissionProgress(stage: "reading_sheet", detail: "Google Sheet 전체 기록을 읽는 중", provider: nil, sheetRowsRead: nil, docCharsRead: nil, elapsedMs: nil)
        lastError = nil
        PostHogTelemetry.capture("mac_bip_coach_refresh_requested", properties: [
            "session_id": sessionID,
        ], authSession: macAuthSession)
        sidecar.send(payload: [
            "type": "bip_coach_refresh_evidence",
            "sessionId": sessionID,
        ])
    }

    func generateBipMission(compact: Bool = false, curriculumDay: [String: Any]? = nil) {
        guard isConnected else { return }
        guard let sessionID = currentBipCoachSessionID() else { return }
        isBipCoachGenerating = true
        lastBipRequestedAction = .generateMission(compact: compact)
        lastError = nil
        let provider = selectedSession?.provider ?? visibleBipCoach?.config.provider ?? selectedProvider
        bipMissionProgress = BipMissionProgress(stage: "reading_sheet", detail: "Google Sheet와 업무일지 Doc을 확인하는 중", provider: provider.rawValue, sheetRowsRead: nil, docCharsRead: nil, elapsedMs: nil)
        PostHogTelemetry.capture("mac_bip_coach_generation_requested", properties: [
            "session_id": sessionID,
            "provider": provider.rawValue,
            "compact": compact,
        ], authSession: macAuthSession)
        var payload: [String: Any] = [
            "type": "bip_coach_generate_mission",
            "sessionId": sessionID,
            "provider": provider.rawValue,
            "compact": compact,
        ]
        if let curriculumDay {
            payload["curriculumDay"] = curriculumDay
        }
        sidecar.send(payload: payload)
    }

    func requestBipSetupGate(autoStart: Bool = false) {
        guard isConnected else { return }
        guard let sessionID = currentBipCoachSessionID() else { return }
        let provider = selectedSession?.provider ?? visibleBipCoach?.config.provider ?? selectedProvider
        sidecar.send(payload: [
            "type": "bip_setup_gate_check",
            "sessionId": sessionID,
            "provider": provider.rawValue,
            "autoStart": autoStart,
        ])
    }

    func startBipIddQueue(docType: String? = nil) {
        guard isConnected else { return }
        guard let sessionID = currentBipCoachSessionID() else { return }
        let provider = selectedSession?.provider ?? visibleBipCoach?.config.provider ?? selectedProvider
        var payload: [String: Any] = [
            "type": "bip_idd_start_queue",
            "sessionId": sessionID,
            "provider": provider.rawValue,
        ]
        if let docType, !docType.isEmpty {
            payload["docType"] = docType
        }
        sidecar.send(payload: payload)
    }

    func selectBipMission(_ mission: BipCoachMission) {
        guard isConnected else { return }
        guard let sessionID = currentBipCoachSessionID() else { return }
        lastError = nil
        PostHogTelemetry.capture("mac_bip_coach_mission_selected", properties: [
            "session_id": sessionID,
            "mission_id": mission.id,
        ], authSession: macAuthSession)
        sidecar.send(payload: [
            "type": "bip_coach_select_mission",
            "sessionId": sessionID,
            "missionId": mission.id,
        ])
    }

    func completeBipMission(threadsUrl: String, sheetRowNote: String) {
        guard isConnected else { return }
        guard let sessionID = currentBipCoachSessionID() else { return }
        let cleanedThreadsUrl = threadsUrl.trimmingCharacters(in: .whitespacesAndNewlines)
        let cleanedSheetRowNote = sheetRowNote.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !cleanedThreadsUrl.isEmpty, !cleanedSheetRowNote.isEmpty else {
            lastError = "Threads URL과 Sheet 행 기록을 모두 입력해야 완료 처리됩니다."
            return
        }
        isBipCoachCompleting = true
        lastError = nil
        PostHogTelemetry.capture("mac_bip_coach_completion_requested", properties: [
            "session_id": sessionID,
        ], authSession: macAuthSession)
        sidecar.send(payload: [
            "type": "bip_coach_complete_mission",
            "sessionId": sessionID,
            "threadsUrl": cleanedThreadsUrl,
            "sheetRowNote": cleanedSheetRowNote,
        ])
    }

    func requestBipReadinessCheck() {
        guard isConnected else { return }
        if bipReadiness == nil {
            bipReadiness = BipReadinessState.loading
        }
        sidecar.send(payload: [
            "type": "bip_readiness_action",
            "rowId": "*",
            "action": "recheck",
        ])
    }

    func sendBipReadinessAction(rowId: BipReadinessRowId, action: String, payload: [String: Any] = [:]) {
        guard isConnected else { return }
        var message: [String: Any] = [
            "type": "bip_readiness_action",
            "rowId": rowId.rawValue,
            "action": action,
        ]
        if let sessionID = currentBipCoachSessionID() {
            message["sessionId"] = sessionID
        }
        let provider = selectedSession?.provider ?? visibleBipCoach?.config.provider ?? selectedProvider
        message["provider"] = provider.rawValue
        for (key, value) in payload {
            message[key] = value
        }
        sidecar.send(payload: message)
    }

    func clearBipTokenExpired() {
        bipTokenExpired = nil
    }

    func startGwsAuth() {
        sendBipReadinessAction(rowId: .gwsAuth, action: "start")
    }

    func handleNotionOAuthCode(_ code: String) {
        authSession = nil
        sidecar.send(payload: [
            "type": "notion_oauth_callback",
            "code": code,
        ])
    }

    func handleNotionOAuthError(_ error: String) {
        authSession = nil
        notionOAuthInProgress = false
        notionOAuthError = error
        PostHogTelemetry.captureException(
            NSError(domain: "NotionOAuth", code: -1, userInfo: [NSLocalizedDescriptionKey: error]),
            properties: [
                "component": "agentic_view_model",
                "operation": "notion_oauth",
            ],
            authSession: macAuthSession
        )
    }

    func startMacGoogleSignIn() {
        macOnboardingStatus = .signingIn
        PostHogTelemetry.capture("mac_google_sign_in_started", authSession: macAuthSession)
        let url = MacOnboardingConstants.appBaseURL
            .appending(path: "auth/mac/start")
            .appending(queryItems: [
                URLQueryItem(name: "terms_version", value: MacOnboardingConstants.termsVersion),
                URLQueryItem(name: "privacy_version", value: MacOnboardingConstants.privacyVersion),
            ])
        presentAuthSession(url: url, flow: .macOnboarding)
    }

    func signOutMacAuth() {
        PostHogTelemetry.capture("mac_google_sign_out", authSession: macAuthSession)
        KeychainHelper.deleteMacAuthSession()
        macAuthSession = nil
        macOnboardingStatus = .idle
        sendAuthContextToSidecar()
    }

    func setProjectWorkspace(_ url: URL) {
        WorkspaceSettings.store(url)
        workspaceRoot = url.path
        PostHogTelemetry.capture("mac_project_workspace_selected", properties: [
            "workspace_basename": url.lastPathComponent,
        ], authSession: macAuthSession)
        if started {
            connectionLabel = "Switching workspace..."
            isConnected = false
            sidecar.stop()
            sidecar.start()
        } else {
            start()
        }
        scanWorkspace(root: url.path)
    }

    func resetMacOnboarding() {
        signOutMacAuth()
        KeychainHelper.deleteOnboardingContext()
        onboardingContext = nil
        onboardingContextStatus = .idle
    }

    func submitOnboardingContext(_ context: OnboardingContext) {
        onboardingContextStatus = .submitting
        do {
            try KeychainHelper.saveOnboardingContext(context)
            onboardingContext = context
            onboardingContextStatus = .idle
            PostHogTelemetry.capture("mac_onboarding_context_submitted", properties: [
                "role": context.role.rawValue,
                "project_stage": context.projectStage.rawValue,
                "isolation_level": context.isolationLevel.rawValue,
            ], authSession: macAuthSession)
            // Local persistence done. Server sync to /api/profile/onboarding-context is a follow-up.
            sendAuthContextToSidecar()
            if !started, !requiresMacOnboarding {
                start()
            }
        } catch {
            onboardingContextStatus = .failed(error.localizedDescription)
            PostHogTelemetry.captureException(error, properties: [
                "component": "agentic_view_model",
                "operation": "submit_onboarding_context",
            ], authSession: macAuthSession)
        }
    }

    private enum AuthFlow {
        case notion
        case macOnboarding
    }

    private func presentAuthSession(url: URL, flow: AuthFlow = .notion) {
        let session = ASWebAuthenticationSession(
            url: url,
            callbackURLScheme: "agentic30"
        ) { [weak self] callbackURL, error in
            Task { @MainActor in
                guard let self else { return }
                self.authSession = nil

                if let error = error as? ASWebAuthenticationSessionError,
                   error.code == .canceledLogin {
                    self.handleAuthSessionError("Cancelled", flow: flow)
                    return
                }
                if let error {
                    self.handleAuthSessionError(error.localizedDescription, flow: flow)
                    return
                }
                guard let callbackURL,
                      let components = URLComponents(url: callbackURL, resolvingAgainstBaseURL: false) else {
                    self.handleAuthSessionError("No callback URL received", flow: flow)
                    return
                }
                if let error = components.queryItems?.first(where: { $0.name == "error" })?.value {
                    self.handleAuthSessionError(error, flow: flow)
                    return
                }
                guard let code = components.queryItems?.first(where: { $0.name == "code" })?.value else {
                    self.handleAuthSessionError("No authorization code received", flow: flow)
                    return
                }

                switch flow {
                case .notion:
                    self.handleNotionOAuthCode(code)
                case .macOnboarding:
                    await self.exchangeMacAuthCode(code)
                }
            }
        }
        session.presentationContextProvider = authPresentationContext
        session.prefersEphemeralWebBrowserSession = true
        authSession = session
        session.start()
    }

    private func handleAuthSessionError(_ error: String, flow: AuthFlow) {
        PostHogTelemetry.captureException(
            NSError(domain: "AuthSession", code: -1, userInfo: [NSLocalizedDescriptionKey: error]),
            properties: [
                "component": "agentic_view_model",
                "operation": flow == .macOnboarding ? "mac_onboarding_auth" : "notion_auth",
            ],
            authSession: macAuthSession
        )
        switch flow {
        case .notion:
            handleNotionOAuthError(error)
        case .macOnboarding:
            macOnboardingStatus = .failed(error)
        }
    }

    private func exchangeMacAuthCode(_ code: String) async {
        macOnboardingStatus = .exchanging
        do {
            let response: MacAuthExchangeResponse = try await postJSON(
                path: "api/auth/mac/exchange",
                body: ["code": code]
            )
            let session = response.toSession()
            try KeychainHelper.saveMacAuthSession(session)
            macAuthSession = session
            macOnboardingStatus = .idle
            PostHogTelemetry.capture("mac_google_sign_in_completed", properties: [
                "user_id": session.userId,
                "email_domain": session.email.flatMap { PostHogTelemetrySanitizer.emailDomain($0) } ?? "",
            ], authSession: session)
            if WorkspaceSettings.hasExplicitWorkspace {
                start()
                sendAuthContextToSidecar()
            }
        } catch {
            KeychainHelper.deleteMacAuthSession()
            macAuthSession = nil
            macOnboardingStatus = .failed(error.localizedDescription)
            PostHogTelemetry.captureException(error, properties: [
                "component": "agentic_view_model",
                "operation": "exchange_mac_auth_code",
            ])
        }
    }

    private func refreshMacAuthIfNeeded() {
        guard let session = macAuthSession, session.shouldRefreshSoon else {
            if WorkspaceSettings.hasExplicitWorkspace {
                start()
                sendAuthContextToSidecar()
            }
            return
        }

        Task { @MainActor in
            macOnboardingStatus = .refreshing
            do {
                let response: MacAuthExchangeResponse = try await postJSON(
                    path: "api/auth/mac/refresh",
                    body: ["refreshToken": session.refreshToken]
                )
                let refreshed = response.toSession(
                    fallbackConsent: MacAuthConsent(
                        acceptedAt: session.termsAcceptedAt,
                        termsVersion: session.termsVersion,
                        privacyVersion: session.privacyVersion
                    )
                )
                try KeychainHelper.saveMacAuthSession(refreshed)
                macAuthSession = refreshed
                macOnboardingStatus = .idle
                PostHogTelemetry.capture("mac_google_session_refreshed", properties: [
                    "user_id": refreshed.userId,
                    "email_domain": refreshed.email.flatMap { PostHogTelemetrySanitizer.emailDomain($0) } ?? "",
                ], authSession: refreshed)
                if WorkspaceSettings.hasExplicitWorkspace {
                    start()
                    sendAuthContextToSidecar()
                }
            } catch {
                KeychainHelper.deleteMacAuthSession()
                macAuthSession = nil
                macOnboardingStatus = .failed("Your session expired. Sign in again.")
                PostHogTelemetry.captureException(error, properties: [
                    "component": "agentic_view_model",
                    "operation": "refresh_mac_auth",
                ])
            }
        }
    }

    private func sendAuthContextToSidecar() {
        guard isConnected else { return }
        guard let session = macAuthSession, session.isUsable else {
            sidecar.send(payload: ["type": "clear_auth_context"])
            return
        }

        var payload: [String: Any] = [
            "type": "set_auth_context",
            "accessToken": session.accessToken,
            "refreshToken": session.refreshToken,
            "userId": session.userId,
            "webBaseUrl": MacOnboardingConstants.appBaseURL.absoluteString,
        ]
        if let expiresAt = session.expiresAt {
            payload["expiresAt"] = expiresAt
        }
        if let email = session.email {
            payload["email"] = email
        }
        if let onboardingContext {
            payload["onboardingContext"] = [
                "role": onboardingContext.role.rawValue,
                "project_stage": onboardingContext.projectStage.rawValue,
                "isolation_level": onboardingContext.isolationLevel.rawValue,
                "completed_at": onboardingContext.completedAt,
            ]
        }
        sidecar.send(payload: payload)
    }

    private func requestAndScheduleBipNotificationsIfNeeded(for state: BipCoachState) {
        Task {
            let center = UNUserNotificationCenter.current()
            let settings = await withCheckedContinuation { continuation in
                center.getNotificationSettings { settings in
                    continuation.resume(returning: settings)
                }
            }

            var authorized = settings.authorizationStatus == .authorized
                || settings.authorizationStatus == .provisional
            if settings.authorizationStatus == .notDetermined {
                authorized = (try? await center.requestAuthorization(options: [.alert, .sound])) ?? false
            }
            guard authorized else { return }

            let morningHour = state.config.morningHour ?? 10
            let eveningHour = state.config.eveningHour ?? 21
            center.removePendingNotificationRequests(withIdentifiers: [
                BipNotificationIntent.morningIdentifier,
                BipNotificationIntent.eveningIdentifier,
            ])
            scheduleBipNotification(
                intent: .morning,
                hour: morningHour,
                title: "오늘의 BIP 미션",
                body: "Threads 글감과 3개 초안을 만들 시간입니다."
            )
            scheduleBipNotification(
                intent: .evening,
                hour: eveningHour,
                title: "BIP 마감 체크",
                body: "Threads URL과 Google Sheet 행을 남겼는지 확인하세요."
            )
        }
    }

    private func scheduleBipNotification(
        intent: BipNotificationIntent,
        hour: Int,
        title: String,
        body: String
    ) {
        var dateComponents = DateComponents()
        dateComponents.hour = hour
        dateComponents.minute = 0

        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        content.sound = .default
        content.userInfo = [
            BipNotificationIntent.userInfoKey: intent.rawValue,
        ]

        let trigger = UNCalendarNotificationTrigger(
            dateMatching: dateComponents,
            repeats: true
        )
        UNUserNotificationCenter.current().add(
            UNNotificationRequest(identifier: intent.notificationIdentifier, content: content, trigger: trigger)
        )
    }

    private func postJSON<T: Decodable>(
        path: String,
        body: [String: Any]
    ) async throws -> T {
        let url = MacOnboardingConstants.appBaseURL.appending(path: path)
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse,
              (200..<300).contains(httpResponse.statusCode) else {
            let message = String(data: data, encoding: .utf8) ?? "Request failed"
            throw NSError(
                domain: "MacAuth",
                code: (response as? HTTPURLResponse)?.statusCode ?? -1,
                userInfo: [NSLocalizedDescriptionKey: message]
            )
        }

        return try JSONDecoder().decode(T.self, from: data)
    }

    func createDocument(type: String, workspaceRoot: String) {
        guard !workspaceRoot.isEmpty else { return }
        isCreatingDoc = type
        docCreationLogs = []
        PostHogTelemetry.capture("mac_document_creation_requested", properties: [
            "doc_type": type,
            "workspace_basename": (workspaceRoot as NSString).lastPathComponent,
        ], authSession: macAuthSession)
        sidecar.send(payload: [
            "type": "create_doc",
            "docType": type,
            "root": workspaceRoot,
        ])
    }

    private func handle(_ event: SidecarEvent) {
        switch event.type {
        case "sidecar_status":
            connectionLabel = event.message ?? connectionLabel
            isConnected = false
            PostHogTelemetry.capture("mac_sidecar_status", properties: [
                "message": event.message ?? "",
            ], authSession: macAuthSession)
        case "ready":
            if let sessions = event.sessions {
                self.sessions = sessions.sorted(by: { $0.updatedAt > $1.updatedAt })
            }
            if let environment = event.environment {
                self.environment = environment
            }
            if let diagnostics = event.diagnostics {
                sidecarDiagnostics = diagnostics
            }
            if let bipCoach = event.bipCoach {
                self.bipCoach = bipCoach
            }
            workspaceRoot = event.workspaceRoot ?? workspaceRoot
            notionConnected = event.notionConnected ?? false
            connectionLabel = "Connected"
            isConnected = true
            PostHogTelemetry.capture("mac_sidecar_ready", properties: [
                "workspace_basename": ((event.workspaceRoot ?? workspaceRoot) as NSString).lastPathComponent,
                "session_count": sessions.count,
                "notion_connected": notionConnected,
            ], authSession: macAuthSession)
            sendAuthContextToSidecar()
            ensureSelection()
            refreshPresentationState()
            requestCodexWarmupIfNeeded()
            requestBipReadinessCheck()
            requestInitialBipGateIfNeeded()
            if let root = pendingWorkspaceScanRoot {
                pendingWorkspaceScanRoot = nil
                sendWorkspaceScan(root: root)
            }
        case "sessions_snapshot":
            if let sessions = event.sessions {
                self.sessions = sessions.sorted(by: { $0.updatedAt > $1.updatedAt })
                ensureSelection()
                refreshPresentationState()
                requestCodexWarmupIfNeeded()
            }
        case "session_created":
            if let session = event.session {
                upsert(session)
                selectedSessionID = session.id
                PostHogTelemetry.capture("mac_session_created", properties: [
                    "session_id": session.id,
                    "provider": session.provider.rawValue,
                ], authSession: macAuthSession)
                refreshPresentationState()
                requestCodexWarmupIfNeeded()
                requestInitialBipGateIfNeeded()
            }
        case "session_updated":
            if let session = event.session {
                upsert(session)
                pruneSentPromptPreviews(for: session)
                refreshPresentationState()
                requestCodexWarmupIfNeeded()
            }
        case "session_deleted":
            guard let sessionID = event.sessionId else { return }
            sessions.removeAll(where: { $0.id == sessionID })
            if selectedSessionID == sessionID {
                selectedSessionID = sessions.first?.id
            }
            if sessions.isEmpty {
                createSession(provider: selectedProvider)
            }
            refreshPresentationState()
        case "message_delta":
            guard let sessionID = event.sessionId,
                  let messageID = event.messageId,
                  let delta = event.delta else { return }
            updateMessage(sessionID: sessionID, messageID: messageID) { message in
                message.content += delta
                message.state = .streaming
            }
            refreshPresentationState()
        case "message_replaced":
            guard let sessionID = event.sessionId,
                  let messageID = event.messageId,
                  let content = event.content else { return }
            updateMessage(sessionID: sessionID, messageID: messageID) { message in
                message.content = content
                message.state = .final
            }
            refreshPresentationState()
        case "tool_event":
            guard let sessionID = event.sessionId else { return }
            appendSidecarOutput(sessionID: sessionID, event: event)
            refreshPresentationState()
        case "agent_event":
            guard let sessionID = event.sessionId else { return }
            appendSidecarOutput(sessionID: sessionID, event: event)
            refreshPresentationState()
        case "workspace_scan_started":
            isScanning = true
            setScanProgress(event.progressText ?? "Preparing workspace scan...", reset: true)
            scanResult = nil
        case "workspace_scan_progress":
            isScanning = true
            setScanProgress(event.progressText ?? scanProgressMessage)
        case "workspace_scan_result":
            isScanning = false
            setScanProgress(event.error == nil ? "Workspace scan complete." : "Workspace scan failed.")
            scanResult = WorkspaceScanResult(
                icp: event.icp,
                spec: event.spec,
                values: event.values,
                designSystem: event.designSystem,
                adr: event.adr,
                goal: event.goal,
                docs: event.docs,
                sheet: event.sheet,
                onboardingHypothesis: event.onboardingHypothesis,
                error: event.error
            )
            persistWorkspaceScanResult(event)
            if let error = event.error {
                PostHogTelemetry.captureException(
                    NSError(domain: "WorkspaceScan", code: -1, userInfo: [NSLocalizedDescriptionKey: error]),
                    properties: [
                        "component": "agentic_view_model",
                        "operation": "workspace_scan",
                        "scan_root": event.scanRoot ?? "",
                    ],
                    authSession: macAuthSession
                )
            } else {
                PostHogTelemetry.capture("mac_workspace_scan_completed", properties: [
                    "scan_root": event.scanRoot ?? "",
                    "found_icp": event.icp != nil,
                    "found_spec": event.spec != nil,
                    "found_values": event.values != nil,
                    "found_design_system": event.designSystem != nil,
                    "found_adr": event.adr != nil,
                    "found_goal": event.goal != nil,
                    "found_docs": event.docs != nil,
                    "found_sheet": event.sheet != nil,
                ], authSession: macAuthSession)
            }
        case "doc_creation_started":
            isCreatingDoc = event.docType
            docCreationLogs = []
        case "doc_creation_progress":
            if let text = event.progressText {
                docCreationLogs.append(text)
            }
        case "doc_creation_result":
            isCreatingDoc = nil
            docCreationLogs = []
            if let docPath = event.docPath, let docType = event.docType {
                lastDocCreated = (type: docType, path: docPath)
                PostHogTelemetry.capture("mac_document_creation_completed", properties: [
                    "doc_type": docType,
                    "doc_path": docPath,
                ], authSession: macAuthSession)
            }
            if let error = event.error {
                lastError = error
                PostHogTelemetry.captureException(
                    NSError(domain: "DocumentCreation", code: -1, userInfo: [NSLocalizedDescriptionKey: error]),
                    properties: [
                        "component": "agentic_view_model",
                        "operation": "document_creation",
                        "doc_type": event.docType ?? "",
                    ],
                    authSession: macAuthSession
                )
            }
        case "bip_coach_state":
            if let bipCoach = event.bipCoach {
                self.bipCoach = bipCoach
            }
        case "bip_setup_gate_state":
            updateBipSetupGate(from: event)
            if event.bipSetupReady == true,
               !requestedInitialBipMission,
               visibleBipCoach?.currentMission == nil,
               visibleBipCoach?.pendingMissionChoices.isEmpty != false {
                requestedInitialBipMission = true
                activeSurface = .assistantBubble
                generateBipMission(compact: true)
            }
        case "bip_idd_queue_started":
            updateBipSetupGate(from: event)
            isBipCoachGenerating = false
            bipMissionProgress = nil
            activeSurface = .assistantBubble
            lastError = event.bipSetupGateMessage ?? "BIP 미션 전에 IDD 문서 세팅이 필요해요."
        case "bip_idd_session_ready":
            updateBipSetupGate(from: event)
            if let sessionId = event.sessionId {
                selectedSessionID = sessionId
            }
            isBipCoachGenerating = false
            bipMissionProgress = nil
            activeSurface = .assistantBubble
        case "bip_coach_refresh_started":
            isBipCoachRefreshing = true
            if let bipCoach = event.bipCoach {
                self.bipCoach = bipCoach
            }
        case "bip_coach_refresh_completed":
            isBipCoachRefreshing = false
            bipMissionProgress = nil
            if let bipCoach = event.bipCoach {
                self.bipCoach = bipCoach
            }
        case "bip_coach_generation_started":
            isBipCoachGenerating = true
            if let bipCoach = event.bipCoach {
                self.bipCoach = bipCoach
            }
        case "bip_coach_generation_completed":
            isBipCoachGenerating = false
            bipMissionProgress = nil
            if let bipCoach = event.bipCoach {
                self.bipCoach = bipCoach
            }
        case "bip_coach_completion_completed":
            isBipCoachCompleting = false
            if let bipCoach = event.bipCoach {
                self.bipCoach = bipCoach
                requestAndScheduleBipNotificationsIfNeeded(for: bipCoach)
            }
        case "bip_coach_error":
            isBipCoachRefreshing = false
            isBipCoachGenerating = false
            isBipCoachCompleting = false
            bipMissionProgress = nil
            lastError = event.message ?? event.bipCoach?.lastError
            if let bipCoach = event.bipCoach {
                self.bipCoach = bipCoach
            }
        case "notion_oauth_started":
            notionOAuthInProgress = true
            notionOAuthError = nil
        case "notion_oauth_browser_opened":
            if let urlString = event.authUrl, let url = URL(string: urlString) {
                presentAuthSession(url: url)
            }
        case "notion_oauth_result":
            notionOAuthInProgress = false
            if event.success == true {
                notionConnected = true
                notionOAuthError = nil
                PostHogTelemetry.capture("mac_notion_oauth_completed", authSession: macAuthSession)
            } else {
                if event.disconnected == true {
                    notionConnected = false
                    notionOAuthError = nil
                    PostHogTelemetry.capture("mac_notion_disconnected", authSession: macAuthSession)
                } else {
                    notionConnected = false
                    notionOAuthError = event.error
                    PostHogTelemetry.captureException(
                        NSError(domain: "NotionOAuth", code: -1, userInfo: [NSLocalizedDescriptionKey: event.error ?? "Notion OAuth failed"]),
                        properties: [
                            "component": "agentic_view_model",
                            "operation": "notion_oauth_result",
                        ],
                        authSession: macAuthSession
                    )
                }
            }
        case "provider_auth_started":
            if let provider = event.provider.flatMap(AgentProvider.init(rawValue:)) {
                providerAuthInProgress = provider
                providerAuthMessage = event.detail ?? "\(provider.title) 로그인 진행 중..."
            }
        case "provider_auth_progress":
            if let provider = event.provider.flatMap(AgentProvider.init(rawValue:)) {
                providerAuthInProgress = provider
            }
            providerAuthMessage = event.detail ?? providerAuthMessage
        case "provider_auth_browser_opened":
            if let urlString = event.authUrl, let url = URL(string: urlString) {
                NSWorkspace.shared.open(url)
            }
        case "provider_auth_result":
            providerAuthInProgress = nil
            if event.success == true {
                providerAuthMessage = event.provider.flatMap { AgentProvider(rawValue: $0)?.title }.map { "\($0) 로그인 완료" }
                    ?? "로그인 완료"
                requestDiagnostics()
                retryPendingBipActionAfterAuth()
            } else {
                providerAuthMessage = event.error ?? "로그인에 실패했습니다."
                lastError = providerAuthMessage
            }
        case "diagnostics_snapshot":
            if let diagnostics = event.diagnostics {
                sidecarDiagnostics = diagnostics
            }
        case "bip_readiness_event":
            guard let rawRowId = event.rowId,
                  let rowId = BipReadinessRowId(rawValue: rawRowId),
                  let rawStatus = event.status,
                  let status = BipReadinessStatus(rawValue: rawStatus) else { break }
            var current = bipReadiness ?? BipReadinessState.loading
            let previousRow = current.row(rowId)
            let mergedLog: String? = {
                guard let incoming = event.log?.trimmingCharacters(in: .whitespacesAndNewlines),
                      !incoming.isEmpty else {
                    return status == .inProgress ? previousRow.log : nil
                }
                let previousLines = previousRow.log?
                    .split(separator: "\n", omittingEmptySubsequences: true)
                    .map(String.init) ?? []
                let nextLines = (previousLines + [incoming]).suffix(8)
                return nextLines.joined(separator: "\n")
            }()
            let row = BipReadinessRow(
                id: rowId,
                status: status,
                detail: event.detail,
                log: mergedLog,
                error: event.readinessError ?? event.error.map {
                    BipReadinessError(userMessage: $0, raw: $0, kind: .unknown)
                },
                resourceName: event.resourceName,
                resourceUrl: event.resourceUrl
            )
            current.rows[rowId] = row
            bipReadiness = current
            if rowId == .gwsAuth && status == .done {
                retryPendingBipActionAfterAuth()
            }
        case "bip_token_expired":
            bipTokenExpired = event.bipTokenExpiredMessage ?? event.message
            pendingBipAuthRetry = lastBipRequestedAction
        case "bip_coach_generation_progress":
            bipMissionProgress = event.bipMissionProgress
        case "error":
            lastError = event.message
            isBipCoachRefreshing = false
            isBipCoachGenerating = false
            isBipCoachCompleting = false
            bipMissionProgress = nil
            if event.sessionId == nil {
                connectionLabel = event.message ?? connectionLabel
                isConnected = false
            }
            PostHogTelemetry.captureException(
                NSError(domain: "SidecarEvent", code: -1, userInfo: [NSLocalizedDescriptionKey: event.message ?? "Unknown sidecar error"]),
                properties: [
                    "component": "agentic_view_model",
                    "operation": "sidecar_event_error",
                    "session_id": event.sessionId ?? "",
                ],
                authSession: macAuthSession
            )
            refreshPresentationState()
        default:
            break
        }
        onSidecarEvent?(event, sessions)
    }

    var diagnosticsReport: String {
        if let sidecarDiagnostics {
            return sidecarDiagnostics.reportText
        }

        return [
            "agentic30 diagnostics",
            "Sidecar diagnostics are not available yet.",
            "Connection: \(connectionLabel)",
            "Connected: \(isConnected)",
            "Workspace: \(workspaceRoot.isEmpty ? "unknown" : workspaceRoot)",
        ].joined(separator: "\n")
    }

    private func ensureSelection() {
        if selectedSessionID == nil {
            selectedSessionID = sessions.first?.id
        }
        if sessions.isEmpty {
            createSession(provider: selectedProvider)
        }
    }

    private func requestInitialBipGateIfNeeded() {
        guard isConnected, !requestedInitialBipGate else { return }
        guard currentBipCoachSessionID() != nil else { return }
        requestedInitialBipGate = true
        requestBipSetupGate(autoStart: true)
    }

    private func updateBipSetupGate(from event: SidecarEvent) {
        missingBipLocalDocs = event.missingLocalDocs ?? missingBipLocalDocs
        missingBipExternalRequirements = event.missingExternalRequirements ?? missingBipExternalRequirements
        bipSetupGateMessage = event.bipSetupGateMessage ?? bipSetupGateMessage
    }

    private var usesInlineUITestStubResponses: Bool {
        ProcessInfo.processInfo.environment["AGENTIC30_UI_TEST_INLINE_STUB_RESPONSES"] == "1"
    }

    private func ensureInlineUITestStubSession() {
        guard sessions.isEmpty else {
            ensureSelection()
            seedInlineUITestBipCoachIfNeeded()
            return
        }

        let now = Date()
        let pendingUserInput = Self.makeUITestingIcpStructuredPromptIfNeeded(sessionID: UUID().uuidString, createdAt: now)
        let session = ChatSession(
            id: pendingUserInput?.sessionId ?? UUID().uuidString,
            title: "Codex Assistant",
            provider: selectedProvider,
            model: preferredModel(for: selectedProvider),
            status: pendingUserInput == nil ? .idle : .awaitingInput,
            createdAt: now,
            updatedAt: now,
            error: nil,
            messages: [
                ChatMessage(
                    id: UUID().uuidString,
                    role: .assistant,
                    provider: selectedProvider,
                    content: "무엇부터 시작할까요? Day 1 커리큘럼을 진행할 수 있어요.",
                    state: .final,
                    createdAt: now,
                    error: nil,
                    bipMissionChoices: nil,
                    providerAuthActions: nil
                )
            ],
            pendingUserInput: pendingUserInput,
            runtime: nil
        )
        sessions = [session]
        selectedSessionID = session.id
        seedInlineUITestBipCoachIfNeeded()
        refreshPresentationState()
    }

    private static func makeUITestingIcpStructuredPromptIfNeeded(
        sessionID requestedSessionID: String,
        createdAt: Date
    ) -> StructuredPromptRequest? {
        #if DEBUG
        guard CommandLine.arguments.contains("--ui-testing-seed-icp-structured-prompt") else {
            return nil
        }
        return StructuredPromptRequest(
            requestId: "ui-test-icp-request",
            sessionId: requestedSessionID,
            toolName: "request_user_input",
            title: "첫 사용자 확인",
            createdAt: createdAt,
            questions: [
                StructuredPromptQuestion(
                    header: "프로젝트 이해",
                    question: "이걸 만들게 된 계기가 된 사람이나 상황이 있었나요?\n이번 주에 확인해볼 사람을 하나 골라주세요.",
                    helperText: "아직 단정할 근거가 부족해요. 오늘은 정답이 아니라 이번 주 확인할 사람 1명을 고릅니다.",
                    options: [
                        StructuredPromptOption(
                            label: "나 또는 우리 팀",
                            description: "내가 직접 겪는 문제라 바로 관찰하고 다시 써볼 수 있습니다.",
                            preview: nil,
                            nextIntent: "self_or_team_pain"
                        ),
                        StructuredPromptOption(
                            label: "이미 불편하게 해결하는 사람",
                            description: "스프레드시트, 수작업, 다른 툴로 이미 시간을 쓰고 있습니다.",
                            preview: nil,
                            nextIntent: "existing_alternative"
                        ),
                        StructuredPromptOption(
                            label: "이미 돈이나 시간을 쓰는 사람",
                            description: "예산, 일정, 팀 논의가 걸려 있어 검증 신호가 강합니다.",
                            preview: nil,
                            nextIntent: "budget_or_time_committed"
                        ),
                        StructuredPromptOption(
                            label: "아직 모르겠어요",
                            description: "괜찮아요. 오늘은 고객을 확정하지 않고 확인할 후보 3명을 찾습니다.",
                            preview: nil,
                            nextIntent: "unknown_find_candidates"
                        )
                    ],
                    multiSelect: false,
                    allowFreeText: true,
                    freeTextPlaceholder: "예: 우리 팀, 채용 담당자, 매일 Codex를 쓰는 개발자",
                    textMode: .short
                )
            ]
        )
        #else
        return nil
        #endif
    }

    private func seedInlineUITestBipCoachIfNeeded() {
        #if DEBUG
        guard CommandLine.arguments.contains("--ui-testing-seed-bip-current-mission"),
              let sessionID = selectedSessionID else {
            return
        }

        var readiness = BipReadinessState.loading
        for rowID in BipReadinessRowId.bipCoachSetupCases {
            readiness.rows[rowID] = BipReadinessRow(
                id: rowID,
                status: .done,
                detail: nil,
                log: nil,
                error: nil
            )
        }
        bipReadiness = readiness
        bipCoach = Self.makeUITestingBipCoachState(sessionID: sessionID)
        #endif
    }

    private static func makeUITestingBipCoachState(sessionID: String) -> BipCoachState {
        BipCoachState(
            schemaVersion: 1,
            updatedAt: Date(),
            sessionId: sessionID,
            config: BipCoachConfig(
                provider: .codex,
                threadsHandle: "october",
                sheetUrl: nil,
                sheetId: "sheet-1",
                sheetTabName: nil,
                docUrl: nil,
                docId: "doc-1",
                morningHour: 10,
                eveningHour: 21
            ),
            evidence: nil,
            missionChoices: [],
            currentMission: BipCoachMission(
                id: "ui-test-bip-mission",
                date: "2026-04-27",
                provider: .codex,
                status: "drafted",
                compact: false,
                title: "오늘 배운 점을 Threads에 공개하기",
                angle: "작게 배운 것을 공개 기록으로 바꾸기",
                mission: "오늘 작업에서 배운 점 1개와 다음 액션 1개를 Threads에 올리세요.",
                drafts: [],
                eveningChecklist: ["Threads URL 남기기", "Sheet 행 메모 남기기"],
                evidenceRefs: [],
                generatedAt: Date(),
                completedAt: nil,
                threadsUrl: nil,
                sheetRowNote: nil
            ),
            streak: BipCoachStreak(current: 1, longest: 2, lastCompletedDate: nil),
            lastError: nil
        )
    }

    private func appendInlineUITestStubResponse(prompt: String, sessionID: String) {
        guard let index = sessions.firstIndex(where: { $0.id == sessionID }) else { return }
        let now = Date()
        let provider = sessions[index].provider
        let userMessage = ChatMessage(
            id: UUID().uuidString,
            role: .user,
            provider: provider,
            content: prompt,
            state: .final,
            createdAt: now,
            error: nil,
            bipMissionChoices: nil,
            providerAuthActions: nil
        )
        let assistantMessage = ChatMessage(
            id: UUID().uuidString,
            role: .assistant,
            provider: provider,
            content: inlineUITestStubResponse(for: prompt),
            state: .final,
            createdAt: now,
            error: nil,
            bipMissionChoices: nil,
            providerAuthActions: nil
        )
        sessions[index].messages.append(contentsOf: [userMessage, assistantMessage])
        sessions[index].status = .idle
        sessions[index].error = nil
        sessions[index].updatedAt = now
        sessions = sessions
        refreshPresentationState()
    }

    private func appendInlineUITestDay1ICPConversationIfNeeded() {
        guard ProcessInfo.processInfo.environment["AGENTIC30_UI_TEST_AUTORUN_DAY1_ICP_CONVERSATION"] == "1" else {
            return
        }
        guard let sessionID = selectedSessionID else { return }
        guard let session = selectedSession else { return }
        guard !session.messages.contains(where: { $0.content.contains("DAY1_ICP_TURN_5") }) else { return }

        let turns = [
            "DAY1_ICP_TURN_1: Day 1 시작. docs/ICP.md 기준으로 내가 맞는 유저인지 먼저 진단해줘.",
            "DAY1_ICP_TURN_2: 나는 퇴사한 전업 1인 개발자이고 수익은 0원, macOS에서 Codex를 쓴다. Day 1 builder-state를 판정해줘.",
            "DAY1_ICP_TURN_3: 이미 랜딩 페이지와 작은 프로토타입은 있다. Day 1 blank-slate discovery가 아니라 fast path로 가야 하는지 확인해줘.",
            "DAY1_ICP_TURN_4: SPEC.md v0 proof baseline에는 어떤 현재 상태와 다음 proof target을 남겨야 해?",
            "DAY1_ICP_TURN_5: 5턴 대화의 결론으로 오늘 바로 실행할 우선순위 1개와 확인할 응답을 정리해줘.",
        ]
        for prompt in turns {
            appendInlineUITestStubResponse(prompt: prompt, sessionID: sessionID)
        }
    }

    private func inlineUITestStubResponse(for prompt: String) -> String {
        if prompt.contains("DAY1_ICP_TURN") {
            return [
                "ICP.md 확인: 전업 1인 개발자, 수익 0원, macOS, 고객 인터뷰 의향이 있는 사용자로 가정했습니다.",
                "Day 1 응답: builder-state 진단을 먼저 하고, 기존 자산이 있으면 blank-slate discovery 대신 fast path로 SPEC.md v0 proof baseline과 다음 proof target을 정합니다.",
            ].joined(separator: "\n")
        }
        return "테스트 응답: \(prompt)"
    }

    private func preferredModel(for provider: AgentProvider) -> String {
        let environment = ProcessInfo.processInfo.environment
        switch provider {
        case .claude:
            if let value = firstNonEmptyEnvironmentValue(
                ["AGENTIC30_CLAUDE_MODEL", "ANTHROPIC_MODEL"],
                in: environment
            ) {
                return value
            }
            return KeychainHelper.loadSettings().preferredClaudeModel
        case .codex:
            if let value = firstNonEmptyEnvironmentValue(
                ["AGENTIC30_CODEX_MODEL", "CODEX_MODEL", "OPENAI_MODEL"],
                in: environment
            ) {
                return value
            }
            return KeychainHelper.loadSettings().preferredCodexModel
        }
    }

    private func firstNonEmptyEnvironmentValue(
        _ keys: [String],
        in environment: [String: String]
    ) -> String? {
        for key in keys {
            if let rawValue = environment[key] {
                let value = rawValue.trimmingCharacters(in: .whitespacesAndNewlines)
                if !value.isEmpty {
                    return value
                }
            }
        }
        return nil
    }

    private func upsert(_ session: ChatSession) {
        if let index = sessions.firstIndex(where: { $0.id == session.id }) {
            sessions[index] = mergeSessionSnapshot(session, into: sessions[index])
        } else {
            sessions.append(session)
        }
        sessions.sort(by: { $0.updatedAt > $1.updatedAt })
        if selectedSessionID == nil {
            selectedSessionID = session.id
        }
    }

    private func mergeSessionSnapshot(_ incoming: ChatSession, into current: ChatSession) -> ChatSession {
        var merged = incoming
        let currentMessagesByID = Dictionary(uniqueKeysWithValues: current.messages.map { ($0.id, $0) })
        merged.messages = incoming.messages.map { incomingMessage in
            guard let currentMessage = currentMessagesByID[incomingMessage.id] else {
                return incomingMessage
            }
            return mergeMessageSnapshot(incomingMessage, into: currentMessage, sessionStatus: incoming.status)
        }
        return merged
    }

    private func mergeMessageSnapshot(
        _ incoming: ChatMessage,
        into current: ChatMessage,
        sessionStatus: SessionStatus
    ) -> ChatMessage {
        var merged = incoming
        let incomingContent = incoming.content.trimmingCharacters(in: .whitespacesAndNewlines)
        let currentContent = current.content.trimmingCharacters(in: .whitespacesAndNewlines)
        let incomingLooksStale = incoming.state == .streaming || sessionStatus == .running

        if incomingLooksStale && !currentContent.isEmpty {
            if incomingContent.isEmpty || incoming.content.count < current.content.count {
                merged.content = current.content
            }
            if current.state == .streaming && incoming.state == .streaming {
                merged.state = .streaming
            }
        }

        return merged
    }

    private func requestCodexWarmupIfNeeded() {
        guard isConnected else { return }
        guard ProcessInfo.processInfo.environment["AGENTIC30_DISABLE_CODEX_WARMUP"] != "1" else { return }
        guard let session = selectedSession else { return }
        guard session.provider == .codex else { return }
        guard !requestedWarmSessionIDs.contains(session.id) else { return }
        guard session.runtime?.codexWarm?.state != "ready" else { return }
        guard session.runtime?.codexWarm?.state != "warming" else { return }

        requestedWarmSessionIDs.insert(session.id)
        sidecar.send(payload: [
            "type": "warm_session",
            "sessionId": session.id,
        ])
    }

    private func appendSentPromptPreview(sessionID: String, prompt: String) {
        var nextPreviews = sentPromptPreviews
        var previews = nextPreviews[sessionID] ?? []
        previews.append(PendingPromptPreview(id: UUID().uuidString, content: prompt, createdAt: .now))
        nextPreviews[sessionID] = previews
        sentPromptPreviews = nextPreviews
    }

    private func pruneSentPromptPreviews(for session: ChatSession) {
        guard var previews = sentPromptPreviews[session.id], !previews.isEmpty else { return }
        var persistedCounts: [String: Int] = [:]
        for message in session.messages where message.role == .user {
            guard let content = message.content.trimmingCharacters(in: .whitespacesAndNewlines).nonEmpty else {
                continue
            }
            persistedCounts[content, default: 0] += 1
        }
        previews.removeAll { preview in
            let content = preview.content.trimmingCharacters(in: .whitespacesAndNewlines)
            let count = persistedCounts[content, default: 0]
            if count > 0 {
                persistedCounts[content] = count - 1
                return true
            }
            return false
        }
        if previews.isEmpty {
            sentPromptPreviews[session.id] = nil
        } else {
            sentPromptPreviews[session.id] = previews
        }
    }

    private func updateMessage(
        sessionID: String,
        messageID: String,
        mutate: (inout ChatMessage) -> Void
    ) {
        guard let sessionIndex = sessions.firstIndex(where: { $0.id == sessionID }),
              let messageIndex = sessions[sessionIndex].messages.firstIndex(where: { $0.id == messageID })
        else { return }

        mutate(&sessions[sessionIndex].messages[messageIndex])
        sessions[sessionIndex].updatedAt = .now
    }

    private func appendSidecarOutput(sessionID: String, event: SidecarEvent) {
        let summary = (event.summary ?? event.fallbackToolSummary)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard !summary.isEmpty else { return }

        var logs = sidecarOutputLogs[sessionID] ?? []
        if logs.last != summary {
            logs.append(summary)
        }
        if logs.count > 24 {
            logs.removeFirst(logs.count - 24)
        }
        sidecarOutputLogs[sessionID] = logs
    }

    private func refreshPresentationState() {
        guard let session = selectedSession else {
            cancelRevealTransition()
            activePresentationSessionID = nil
            revealedAssistantMessageID = nil
            presentationPhase = .compact
            return
        }

        let latestAssistant = latestRenderableAssistantMessage(in: session)
        let sessionChanged = activePresentationSessionID != session.id
        activePresentationSessionID = session.id

        if session.status == .awaitingInput || session.status == .error {
            cancelRevealTransition()
            revealedAssistantMessageID = nil
            presentationPhase = .compact
            return
        }

        if session.status == .running {
            cancelRevealTransition()
            revealedAssistantMessageID = latestAssistant?.id
            presentationPhase = latestAssistant == nil ? .compact : .expanded
            return
        }

        guard let latestAssistant else {
            cancelRevealTransition()
            revealedAssistantMessageID = nil
            presentationPhase = .compact
            return
        }

        if sessionChanged {
            cancelRevealTransition()
            revealedAssistantMessageID = latestAssistant.id
            presentationPhase = .expanded
            return
        }

        if presentationPhase == .expanded && revealedAssistantMessageID == latestAssistant.id {
            return
        }

        if presentationPhase == .expanding && revealedAssistantMessageID == latestAssistant.id {
            return
        }

        cancelRevealTransition()
        revealedAssistantMessageID = latestAssistant.id
        presentationPhase = .expanding

        let workItem = DispatchWorkItem { [weak self] in
            guard let self else { return }
            guard self.selectedSession?.id == session.id else { return }
            guard self.revealedAssistantMessageID == latestAssistant.id else { return }
            self.presentationPhase = .expanded
            self.revealWorkItem = nil
        }

        revealWorkItem = workItem
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.2, execute: workItem)
    }

    private func cancelRevealTransition() {
        revealWorkItem?.cancel()
        revealWorkItem = nil
    }

    private func latestRenderableAssistantMessage(in session: ChatSession) -> ChatMessage? {
        session.messages.last(where: { message in
            (message.role == .assistant || message.role == .system)
            && !message.content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        })
    }

    private func currentBipCoachSessionID() -> String? {
        if let selectedSessionID {
            return selectedSessionID
        }
        return bipCoach?.sessionId ?? sessions.first?.id
    }

    #if DEBUG
    private static func isUITesting(arguments: [String]) -> Bool {
        arguments.contains(where: { $0.hasPrefix("--ui-testing-") })
    }

    private static func isXCTestHost(arguments: [String]) -> Bool {
        ProcessInfo.processInfo.environment["XCTestConfigurationFilePath"] != nil
            || arguments.contains(where: { $0.contains(".xctest") })
    }

    private static func makeUITestingMacAuthSession(arguments: [String]) -> MacAuthSession? {
        if arguments.contains("--ui-testing-seed-auth") {
            let now = ISO8601DateFormatter().string(from: Date())
            return MacAuthSession(
                accessToken: "ui-test-access-token",
                refreshToken: "ui-test-refresh-token",
                expiresAt: Date().addingTimeInterval(3600).timeIntervalSince1970,
                tokenType: "bearer",
                userId: "ui-test-user",
                email: "ui-test@example.com",
                onboardingCompletedAt: now,
                termsAcceptedAt: now,
                termsVersion: MacOnboardingConstants.termsVersion,
                privacyVersion: MacOnboardingConstants.privacyVersion
            )
        }

        return nil
    }

    private static func makeUITestingOnboardingContext(arguments: [String]) -> OnboardingContext? {
        guard arguments.contains("--ui-testing-seed-onboarding-context") else { return nil }
        return OnboardingContext.make(
            role: .developer,
            projectStage: .firstUsers,
            isolationLevel: .soloAll
        )
    }

    private static func applyUITestingWorkspaceSeeds(arguments: [String]) {
        if let workspacePath = uiTestingArgumentValue("--ui-testing-seed-workspace", arguments: arguments) {
            let url = URL(fileURLWithPath: workspacePath, isDirectory: true)
            try? FileManager.default.createDirectory(
                at: url,
                withIntermediateDirectories: true,
                attributes: nil
            )
            WorkspaceSettings.store(url)
        }
    }

    private static func uiTestingArgumentValue(_ name: String, arguments: [String]) -> String? {
        if let inline = arguments.first(where: { $0.hasPrefix("\(name)=") }) {
            return String(inline.dropFirst(name.count + 1))
        }
        guard let index = arguments.firstIndex(of: name),
              arguments.indices.contains(index + 1)
        else {
            return nil
        }
        return arguments[index + 1]
    }

    #endif
}

// MARK: - ASWebAuthenticationPresentationContextProviding

private class AuthPresentationContext: NSObject, ASWebAuthenticationPresentationContextProviding {
    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        NSApplication.shared.keyWindow
        ?? NSApplication.shared.mainWindow
        ?? NSApplication.shared.windows.first(where: { $0.isVisible })
        ?? ASPresentationAnchor()
    }
}

struct SidecarEvent: Decodable {
    let type: String
    let message: String?
    let sessionId: String?
    let messageId: String?
    let delta: String?
    let content: String?
    let workspaceRoot: String?
    let session: ChatSession?
    let sessions: [ChatSession]?
    let environment: SidecarEnvironment?
    let diagnostics: SidecarDiagnostics?
    let bipCoach: BipCoachState?
    let bipSetupReady: Bool?
    let missingLocalDocs: [String]?
    let missingExternalRequirements: [String]?
    let nextIddDocumentType: String?
    let nextIddDocumentTitle: String?
    let bipSetupGateMessage: String?

    // Workspace scan result fields
    let scanRoot: String?
    let icp: String?
    let spec: String?
    let values: String?
    let designSystem: String?
    let adr: String?
    let goal: String?
    let docs: String?
    let sheet: String?
    let onboardingHypothesis: WorkspaceOnboardingHypothesis?
    let error: String?

    // Document creation fields
    let docType: String?
    let docPath: String?
    let progressText: String?

    // Notion OAuth fields
    let notionConnected: Bool?
    let success: Bool?
    let disconnected: Bool?
    let authUrl: String?

    // BIP Readiness fields (bip_readiness_event + bip_token_expired)
    let rowId: String?
    let status: String?
    let detail: String?
    let log: String?
    let readinessError: BipReadinessError?
    let bipTokenExpiredMessage: String?
    let resourceName: String?
    let resourceUrl: String?

    // BIP mission progress fields
    let stage: String?
    let provider: String?
    let sheetRowsRead: Int?
    let docCharsRead: Int?
    let elapsedMs: Int?
    let phase: String?
    let toolName: String?
    let summary: String?

    var bipMissionProgress: BipMissionProgress? {
        guard type == "bip_coach_generation_progress",
              let stage else { return nil }
        return BipMissionProgress(
            stage: stage,
            detail: detail,
            provider: provider,
            sheetRowsRead: sheetRowsRead,
            docCharsRead: docCharsRead,
            elapsedMs: elapsedMs
        )
    }
}

struct BipMissionProgress: Hashable {
    let stage: String
    let detail: String?
    let provider: String?
    let sheetRowsRead: Int?
    let docCharsRead: Int?
    let elapsedMs: Int?

    func isActive(_ step: BipMissionProgressStep) -> Bool {
        currentStep == step
    }

    func isComplete(_ step: BipMissionProgressStep) -> Bool {
        switch step {
        case .readingSheet:
            return sheetRowsRead != nil || isAfter(step)
        case .readingDoc:
            return docCharsRead != nil || isAfter(step)
        case .generating:
            return isAfter(step)
        case .finalizing:
            return false
        }
    }

    private var currentStep: BipMissionProgressStep? {
        BipMissionProgressStep(stage: stage)
    }

    private func isAfter(_ step: BipMissionProgressStep) -> Bool {
        guard let currentStep else { return false }
        return currentStep.order > step.order
    }
}

extension SidecarEvent {
    var fallbackToolSummary: String {
        if type == "agent_event" {
            return summary ?? ""
        }
        guard type == "tool_event" else { return "" }
        let name = toolName?.trimmingCharacters(in: .whitespacesAndNewlines)
        let resolvedName = name?.isEmpty == false ? name! : "tool"
        switch phase?.trimmingCharacters(in: .whitespacesAndNewlines) {
        case "use":
            return "using \(resolvedName)"
        case "result":
            return "\(resolvedName) finished"
        case "error":
            return "\(resolvedName) error"
        case "thinking":
            return "thinking"
        default:
            return name ?? ""
        }
    }
}

enum BipMissionProgressStep: String, CaseIterable {
    case readingSheet = "reading_sheet"
    case readingDoc = "reading_doc"
    case generating
    case finalizing

    init?(stage: String) {
        self.init(rawValue: stage)
    }

    var order: Int {
        switch self {
        case .readingSheet:
            return 0
        case .readingDoc:
            return 1
        case .generating:
            return 2
        case .finalizing:
            return 3
        }
    }
}

extension SidecarEvent {
    private enum CodingKeys: String, CodingKey {
        case type
        case message
        case sessionId
        case messageId
        case delta
        case content
        case workspaceRoot
        case session
        case sessions
        case environment
        case diagnostics
        case bipCoach
        case bipSetupReady
        case missingLocalDocs
        case missingExternalRequirements
        case nextIddDocumentType
        case nextIddDocumentTitle
        case bipSetupGateMessage
        case scanRoot
        case icp
        case spec
        case values
        case designSystem
        case adr
        case goal
        case docs
        case sheet
        case onboardingHypothesis
        case error
        case docType
        case docPath
        case progressText
        case notionConnected
        case success
        case disconnected
        case authUrl
        case rowId
        case status
        case detail
        case log
        case readinessError
        case bipTokenExpiredMessage
        case resourceName
        case resourceUrl
        case stage
        case provider
        case sheetRowsRead
        case docCharsRead
        case elapsedMs
        case phase
        case toolName
        case summary
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)

        type = try container.decode(String.self, forKey: .type)
        message = Self.decodeIfPresent(String.self, from: container, forKey: .message)
        sessionId = Self.decodeIfPresent(String.self, from: container, forKey: .sessionId)
        messageId = Self.decodeIfPresent(String.self, from: container, forKey: .messageId)
        delta = Self.decodeIfPresent(String.self, from: container, forKey: .delta)
        content = Self.decodeIfPresent(String.self, from: container, forKey: .content)
        workspaceRoot = Self.decodeIfPresent(String.self, from: container, forKey: .workspaceRoot)
        session = Self.decodeIfPresent(ChatSession.self, from: container, forKey: .session)
        sessions = Self.decodeIfPresent([ChatSession].self, from: container, forKey: .sessions)
        environment = Self.decodeIfPresent(SidecarEnvironment.self, from: container, forKey: .environment)
        diagnostics = Self.decodeIfPresent(SidecarDiagnostics.self, from: container, forKey: .diagnostics)
        bipCoach = Self.decodeIfPresent(BipCoachState.self, from: container, forKey: .bipCoach)
        bipSetupReady = Self.decodeIfPresent(Bool.self, from: container, forKey: .bipSetupReady)
        missingLocalDocs = Self.decodeIfPresent([String].self, from: container, forKey: .missingLocalDocs)
        missingExternalRequirements = Self.decodeIfPresent([String].self, from: container, forKey: .missingExternalRequirements)
        nextIddDocumentType = Self.decodeIfPresent(String.self, from: container, forKey: .nextIddDocumentType)
        nextIddDocumentTitle = Self.decodeIfPresent(String.self, from: container, forKey: .nextIddDocumentTitle)
        bipSetupGateMessage = Self.decodeIfPresent(String.self, from: container, forKey: .bipSetupGateMessage)
        scanRoot = Self.decodeIfPresent(String.self, from: container, forKey: .scanRoot)
        icp = Self.decodeIfPresent(String.self, from: container, forKey: .icp)
        spec = Self.decodeIfPresent(String.self, from: container, forKey: .spec)
        values = Self.decodeIfPresent(String.self, from: container, forKey: .values)
        designSystem = Self.decodeIfPresent(String.self, from: container, forKey: .designSystem)
        adr = Self.decodeIfPresent(String.self, from: container, forKey: .adr)
        goal = Self.decodeIfPresent(String.self, from: container, forKey: .goal)
        docs = Self.decodeIfPresent(String.self, from: container, forKey: .docs)
        sheet = Self.decodeIfPresent(String.self, from: container, forKey: .sheet)
        onboardingHypothesis = Self.decodeIfPresent(WorkspaceOnboardingHypothesis.self, from: container, forKey: .onboardingHypothesis)

        let stringError = Self.decodeIfPresent(String.self, from: container, forKey: .error)
        let structuredError = Self.decodeIfPresent(BipReadinessError.self, from: container, forKey: .error)
        error = stringError ?? structuredError?.userMessage

        docType = Self.decodeIfPresent(String.self, from: container, forKey: .docType)
        docPath = Self.decodeIfPresent(String.self, from: container, forKey: .docPath)
        progressText = Self.decodeIfPresent(String.self, from: container, forKey: .progressText)
        notionConnected = Self.decodeIfPresent(Bool.self, from: container, forKey: .notionConnected)
        success = Self.decodeIfPresent(Bool.self, from: container, forKey: .success)
        disconnected = Self.decodeIfPresent(Bool.self, from: container, forKey: .disconnected)
        authUrl = Self.decodeIfPresent(String.self, from: container, forKey: .authUrl)
        rowId = Self.decodeIfPresent(String.self, from: container, forKey: .rowId)
        status = Self.decodeIfPresent(String.self, from: container, forKey: .status)
        detail = Self.decodeIfPresent(String.self, from: container, forKey: .detail)
        log = Self.decodeIfPresent(String.self, from: container, forKey: .log)
        readinessError = Self.decodeIfPresent(BipReadinessError.self, from: container, forKey: .readinessError) ?? structuredError
        bipTokenExpiredMessage = Self.decodeIfPresent(String.self, from: container, forKey: .bipTokenExpiredMessage)
        resourceName = Self.decodeIfPresent(String.self, from: container, forKey: .resourceName)
        resourceUrl = Self.decodeIfPresent(String.self, from: container, forKey: .resourceUrl)
        stage = Self.decodeIfPresent(String.self, from: container, forKey: .stage)
        provider = Self.decodeIfPresent(String.self, from: container, forKey: .provider)
        sheetRowsRead = Self.decodeIfPresent(Int.self, from: container, forKey: .sheetRowsRead)
        docCharsRead = Self.decodeIfPresent(Int.self, from: container, forKey: .docCharsRead)
        elapsedMs = Self.decodeIfPresent(Int.self, from: container, forKey: .elapsedMs)
        phase = Self.decodeIfPresent(String.self, from: container, forKey: .phase)
        toolName = Self.decodeIfPresent(String.self, from: container, forKey: .toolName)
        summary = Self.decodeIfPresent(String.self, from: container, forKey: .summary)
    }

    private static func decodeIfPresent<T: Decodable>(
        _ type: T.Type,
        from container: KeyedDecodingContainer<CodingKeys>,
        forKey key: CodingKeys
    ) -> T? {
        try? container.decodeIfPresent(type, forKey: key)
    }
}

private extension AgenticViewModel {
    func retryPendingBipActionAfterAuth() {
        guard let action = pendingBipAuthRetry else { return }
        pendingBipAuthRetry = nil
        bipTokenExpired = nil
        switch action {
        case .refreshEvidence:
            refreshBipCoachEvidence()
        case .generateMission(let compact):
            generateBipMission(compact: compact)
        }
    }
}

private extension String {
    var nonEmpty: String? {
        trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : self
    }
}
