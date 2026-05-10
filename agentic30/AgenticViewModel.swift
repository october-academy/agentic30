import Foundation
import SwiftUI
import Combine
import AuthenticationServices
import UserNotifications
import AppKit

typealias WebAuthenticationSessionCompletion = (URL?, Error?) -> Void
typealias WebAuthenticationSessionFactory = (
    URL,
    String,
    ASWebAuthenticationPresentationContextProviding,
    Bool,
    @escaping WebAuthenticationSessionCompletion
) -> WebAuthenticationSessionHandle

protocol WebAuthenticationSessionHandle: AnyObject {
    func start() -> Bool
    func cancel()
}

final class SystemWebAuthenticationSessionHandle: WebAuthenticationSessionHandle {
    private let session: ASWebAuthenticationSession

    init(
        url: URL,
        callbackURLScheme: String,
        presentationContextProvider: ASWebAuthenticationPresentationContextProviding,
        prefersEphemeral: Bool,
        completion: @escaping WebAuthenticationSessionCompletion
    ) {
        session = ASWebAuthenticationSession(
            url: url,
            callbackURLScheme: callbackURLScheme,
            completionHandler: completion
        )
        session.presentationContextProvider = presentationContextProvider
        session.prefersEphemeralWebBrowserSession = prefersEphemeral
    }

    func start() -> Bool {
        session.start()
    }

    func cancel() {
        session.cancel()
    }
}

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

/// Routing classification for chat input. All three branches funnel into the
/// same `send_prompt` sidecar message — Sub-AC 2's contract is that the
/// chat is a *single* AI interaction surface, so daily-task, sub-workflow,
/// and free-chat must share one stream rather than fork the transport.
///
/// The classifier inspects the draft prefix and the selected session's
/// conversation state; consumers tag telemetry, drive provider validation,
/// and attach `mode` + `foundationDay` metadata so the sidecar runner can
/// dispatch to the correct sub-workflow prompt without a second channel.
enum ChatMessageRoute: Equatable {
    /// First user response in a Foundation Day 0-7 session — the AI-driven
    /// daily first prompt has been answered. Carries the 1-based foundation
    /// day so the sidecar can pick the matching `daily-task-{day}` prompt.
    case dailyTask(foundationDay: Int)

    /// Slash-command sub-workflow (`/office-hours-docs`, `/analyze-ads`,
    /// `/bip-draft`, `/monetization-ask`, `/foundation-summary`).
    case subWorkflow(SubWorkflow)

    /// Default conversational chat — no special routing.
    case freeChat

    enum SubWorkflow: String, Equatable {
        case analyzeAds = "analyze_ads"
        case bipDraft = "bip_draft"
        case officeHoursDocs = "office_hours_docs"
        case monetizationAsk = "monetization_ask"
        case foundationSummary = "foundation_summary"

        /// Slash-command prefix used in chat input. Lowercased, single token.
        var commandPrefix: String {
            switch self {
            case .analyzeAds: return "/analyze-ads"
            case .bipDraft: return "/bip-draft"
            case .officeHoursDocs: return "/office-hours-docs"
            case .monetizationAsk: return "/monetization-ask"
            case .foundationSummary: return "/foundation-summary"
            }
        }

        /// Does this sub-workflow require the Claude provider? `/analyze-ads`
        /// and `/foundation-summary` both lean on Claude Agent SDK
        /// (Read/Glob/Grep tooling) for evidence-grounded outputs; the
        /// others run on whichever provider the session is using.
        var requiresClaudeProvider: Bool {
            switch self {
            case .analyzeAds, .foundationSummary: return true
            case .bipDraft, .officeHoursDocs, .monetizationAsk: return false
            }
        }
    }

    /// Telemetry-friendly mode tag. Stable strings so PostHog dashboards
    /// don't break when new sub-workflows are added.
    var modeTag: String {
        switch self {
        case .dailyTask: return "daily_task"
        case .subWorkflow: return "sub_workflow"
        case .freeChat: return "free_chat"
        }
    }

    /// Backwards-compatible `command_kind` used by the existing
    /// `mac_prompt_send_requested` event. `dailyTask` reports as the literal
    /// `daily_task`; sub-workflows keep their snake-case identifier; free
    /// chat stays as `chat` so historical filters keep working.
    var commandKind: String {
        switch self {
        case .dailyTask: return "daily_task"
        case .subWorkflow(let workflow): return workflow.rawValue
        case .freeChat: return "chat"
        }
    }

    /// Sub-workflow name, when applicable. Used by the sidecar payload to
    /// dispatch to the right `*-prompt.mjs` module.
    var subWorkflowName: String? {
        if case .subWorkflow(let workflow) = self { return workflow.rawValue }
        return nil
    }

    /// 1-based Foundation day, when applicable. Lets the sidecar pick the
    /// matching daily first-prompt template.
    var foundationDay: Int? {
        if case .dailyTask(let day) = self { return day }
        return nil
    }
}

struct StartupQueuedAction: Identifiable {
    enum Kind {
        case prompt(String)
        case mission(compact: Bool, curriculumDay: [String: Any]?)
    }

    enum State: Equatable {
        case waiting
        case sending
        case failed(String)
    }

    let id = UUID()
    let kind: Kind
    var state: State = .waiting

    var title: String {
        switch kind {
        case .prompt:
            return "첫 메시지 대기 중"
        case .mission:
            return "오늘 실행 생성 대기 중"
        }
    }

    var summary: String {
        switch kind {
        case .prompt(let prompt):
            return prompt
        case .mission:
            return "세션이 연결되면 Day 1 기준으로 오늘 실행 후보를 만듭니다."
        }
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
    // R4 — Day 30 schema-invalid records that the sidecar quarantined. Empty
    // until `requestQuarantineList()` resolves; refreshed on each restore.
    @Published private(set) var quarantineFiles: [QuarantineFileWithDump] = []
    @Published private(set) var quarantineRefreshError: String?
    // R6 / CCG-Codex weekly ritual broadcast. The Mac surface for the actual
    // banner/modal is wired in a follow-up round; for now we receive the
    // prompt and expose it as @Published state so SwiftUI views can opt in.
    @Published private(set) var pendingWeeklyRitual: WeeklyRitualPrompt?
    @Published private(set) var providerAuthInProgress: AgentProvider?
    @Published private(set) var providerAuthMessage: String?
    @Published private(set) var sentPromptPreviews: [String: [PendingPromptPreview]] = [:]
    @Published private(set) var sidecarOutputLogs: [String: [String]] = [:]
    @Published private(set) var workspaceSettingsOpenRequest = 0
    @Published private(set) var bipNotificationOpenRequest: BipNotificationOpenRequest?
    @Published private(set) var startupQueuedAction: StartupQueuedAction?
    @Published private(set) var startupSessionAppearElapsedMs: Int?
    /// First-launch wall-clock timestamp that anchors the Foundation phase
    /// Day N/30 counter. The value is mirrored from `foundationProgressState`,
    /// which is persisted per workspace/app-support rather than globally.
    @Published private(set) var foundationStartedAt: Date?
    @Published private(set) var foundationProgressState = FoundationProgressSnapshot()

    // Notion OAuth
    @Published private(set) var notionConnected = false
    @Published private(set) var notionOAuthInProgress = false
    @Published var notionOAuthError: String?
    private var authSession: WebAuthenticationSessionHandle?
    private let authPresentationContext = AuthPresentationContext()
    private let authSessionFactory: WebAuthenticationSessionFactory
    private let activateAppForAuth: @MainActor () -> Void
    private var startupSessionAppearStartedAt: Date?
    private var didRecordStartupSessionAppear = false

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
    private var workspaceSetupTelemetryGate = WorkspaceSetupTelemetryGate()
    private var requestedWarmSessionIDs = Set<String>()
    private var requestedInitialBipGate = false
    private var requestedInitialBipMission = false
    /// Idempotency guard for the AI-driven Foundation Day 0-7 first prompt.
    /// Keyed by `"<sessionId>:day-<day>"` so the same opener is never injected
    /// twice for the same (session, day) pair, even if the sidecar replays
    /// `foundation_first_prompt` after a reconnect or queued send.
    /// Distinct from the message-id collision check inside the session because
    /// callers may legitimately re-request the prompt for a different day in
    /// the same session (e.g. UI navigation across Foundation days).
    private var injectedFoundationFirstPromptKeys = Set<String>()
    /// Tracks in-flight `foundation_first_prompt` requests so retries from the
    /// same surface (e.g. a tap on "오늘 과제" twice) do not flood the sidecar.
    /// Keys mirror `injectedFoundationFirstPromptKeys` so the request side and
    /// the inject side share a single naming convention.
    private var pendingFoundationFirstPromptKeys = Set<String>()

    private enum BipRequestedAction: Hashable {
        case refreshEvidence
        case generateMission(compact: Bool)
    }

    /// Legacy global key used before the progress state became workspace-scoped.
    /// Only migrate it when the current workspace is explicit; never read it as
    /// active state for a fresh workspace.
    private static let kFoundationStartedAtKey = "agentic30.foundation.startedAt"
    private var foundationProgressStore: FoundationProgressStore?

    /// Lazy initializer for the Foundation phase counter. Idempotent per
    /// workspace so isolated projects do not inherit stale global progress.
    func ensureFoundationStarted(now: Date = Date()) {
        ensureFoundationProgressStore()
        guard foundationProgressState.startedAt == nil else { return }
        updateFoundationProgress { snapshot in
            snapshot.startedAt = now
            snapshot.selectedDay = max(1, snapshot.selectedDay)
        }
        PostHogTelemetry.capture(
            "mac_foundation_phase_started",
            properties: ["started_at": ISO8601DateFormatter().string(from: now)],
            authSession: macAuthSession
        )
    }

    /// 1-based Day index for the Foundation phase counter (`Day N/30`).
    /// `nil` when the user has not yet reached the onboarding gate. Floors
    /// to whole 24-hour spans relative to `foundationStartedAt`, mirroring
    /// the agnt navigator engine: `D = floor((now - started_at)/86400000)+1`.
    /// Capped at 30 for display so the badge stops counting past the
    /// program length, while the underlying anchor remains untouched.
    var foundationDayNumber: Int? {
        guard foundationProgressState.startedAt != nil else { return nil }
        return max(foundationProgressState.currentDayNumber() ?? 1, foundationProgressState.selectedDay)
    }

    /// 0…1 progress for the sidebar bar. Falls back to 0 before the anchor
    /// is set so the UI shows an empty rail rather than collapsing.
    var foundationProgress: Double {
        guard let day = foundationDayNumber else { return 0 }
        return min(1.0, Double(day) / 30.0)
    }

    /// User-facing label. Uses an em-dash placeholder when the anchor is
    /// missing so the slot is reserved without claiming a Day yet.
    var foundationDayLabel: String {
        if let day = foundationDayNumber {
            return "Day \(day)/30"
        }
        return "Day —/30"
    }

    var selectedFoundationDay: Int {
        foundationProgressState.selectedDay
    }

    func selectFoundationDay(_ day: Int) {
        let clamped = max(1, min(day, 30))
        guard isFoundationDayUnlocked(clamped) else { return }
        updateFoundationProgress { snapshot in
            snapshot.selectedDay = clamped
        }
    }

    func isFoundationDayUnlocked(_ day: Int) -> Bool {
        foundationProgressState.isUnlocked(day)
    }

    func markFoundationDayCompleted(_ day: Int) {
        let clamped = max(1, min(day, 30))
        updateFoundationProgress { snapshot in
            snapshot.completedDays.insert(clamped)
            snapshot.selectedDay = min(max(snapshot.selectedDay, clamped + 1), 30)
        }
    }

    init(
        authSessionFactory: WebAuthenticationSessionFactory? = nil,
        onboardingContextOverride: OnboardingContext? = nil,
        activateAppForAuth: @escaping @MainActor () -> Void = {
            NSApplication.shared.activate(ignoringOtherApps: true)
        }
    ) {
        self.authSessionFactory = authSessionFactory ?? { url, callbackURLScheme, presentationContextProvider, prefersEphemeral, completion in
            Self.makeSystemAuthSession(
                url: url,
                callbackURLScheme: callbackURLScheme,
                presentationContextProvider: presentationContextProvider,
                prefersEphemeral: prefersEphemeral,
                completion: completion
            )
        }
        self.activateAppForAuth = activateAppForAuth

        let arguments = CommandLine.arguments

        #if DEBUG
        if Self.isUITesting(arguments: arguments) {
            if arguments.contains("--ui-testing-reset-onboarding") {
                KeychainHelper.deleteMacAuthSession()
                KeychainHelper.deleteOnboardingContext()
                WorkspaceSettings.clear()
            }
            Self.applyUITestingWorkspaceSeeds(arguments: arguments)
            macAuthSession = Self.makeUITestingMacAuthSession(arguments: arguments)
            onboardingContext = Self.makeUITestingOnboardingContext(arguments: arguments)
            if let seededDraft = Self.uiTestingArgumentValue("--ui-testing-seed-draft", arguments: arguments) {
                draft = seededDraft
            }
            // R6-P3F: load quarantine fixture during init so the surface is
            // ready before SwiftUI subscribes — start() may not run when the
            // hermetic test only opens the Settings scene (MenuBarExtra
            // onAppear fires lazily on user interaction).
            let fixtureResult = Self.applyUITestingQuarantineFixture(arguments: arguments)
            switch fixtureResult {
            case .loaded(let items):
                quarantineFiles = items
            case .failed(let reason):
                quarantineRefreshError = reason
            case .notRequested:
                break
            }
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
        if let onboardingContextOverride {
            onboardingContext = onboardingContextOverride
        }

        restoreFoundationProgress(arguments: arguments)
    }

    struct StructuredPromptSubmission: Hashable {
        let question: String
        let selectedOptions: [String]
        let freeText: String
    }

    var selectedSession: ChatSession? {
        sessions.first(where: { $0.id == selectedSessionID && $0.archivedAt == nil })
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

    static func isRawNullDayError(_ message: String) -> Bool {
        let normalized = message.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return normalized.contains("cannot read properties of null")
            && normalized.contains("day")
    }

    static func userFacingMissionErrorMessage(_ message: String?) -> String {
        guard let message = message?.trimmingCharacters(in: .whitespacesAndNewlines).nonEmpty else {
            return "다시 시도하면 미션 후보를 새로 만들게요."
        }
        if isRawNullDayError(message) {
            return "다시 시도하면 미션 후보를 새로 만들게요."
        }
        if message.localizedCaseInsensitiveContains("sidecar") {
            return "Codex 연결을 다시 시작하면 오늘 실행을 새로 불러옵니다."
        }
        return message
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
        if let sessionId = bipCoach?.sessionId,
           sessions.contains(where: { $0.id == sessionId }) {
            selectedSessionID = sessionId
        }
        bipNotificationOpenRequest = BipNotificationOpenRequest(intent: intent)
    }

    func recordBipNotificationPrimaryAction(intent: BipNotificationIntent, action: String) {
        PostHogTelemetry.capture("mac_bip_notification_primary_action_clicked", properties: [
            "intent": intent.rawValue,
            "action": action,
        ], authSession: macAuthSession)
    }

    func sendTestBipNotification(intent: BipNotificationIntent) async -> String {
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
        guard authorized else {
            return "macOS 알림 권한이 꺼져 있어요. 시스템 설정에서 알림을 허용해 주세요."
        }

        let content = UNMutableNotificationContent()
        content.title = bipTestNotificationTitle(intent)
        content.body = bipTestNotificationBody(intent)
        content.sound = .default
        content.userInfo = [
            BipNotificationIntent.userInfoKey: intent.rawValue,
        ]

        let request = UNNotificationRequest(
            identifier: "\(intent.notificationIdentifier).test.\(UUID().uuidString)",
            content: content,
            trigger: UNTimeIntervalNotificationTrigger(timeInterval: 1, repeats: false)
        )
        let error = await withCheckedContinuation { continuation in
            center.add(request) { error in
                continuation.resume(returning: error)
            }
        }
        if let error {
            return "테스트 알림 예약 실패: \(error.localizedDescription)"
        }

        PostHogTelemetry.capture("mac_bip_test_notification_scheduled", properties: [
            "intent": intent.rawValue,
        ], authSession: macAuthSession)
        return "1초 뒤 테스트 알림을 보냅니다. 배너를 누르면 알림 진입 화면으로 이동해요."
    }

    private func bipTestNotificationTitle(_ intent: BipNotificationIntent) -> String {
        switch intent {
        case .morning:
            return "10시 오늘 실행"
        case .evening:
            return "21시 마감 체크"
        }
    }

    private func bipTestNotificationBody(_ intent: BipNotificationIntent) -> String {
        switch intent {
        case .morning:
            return "작게 하나 공개할 미션을 정하세요."
        case .evening:
            return "게시 기록을 남기면 오늘 루프가 닫힙니다."
        }
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
        return !WorkspaceSettings.hasExplicitWorkspace
            || onboardingContext == nil
    }

    var needsProjectWorkspace: Bool {
        !WorkspaceSettings.hasExplicitWorkspace
    }

    var needsOnboardingContext: Bool {
        onboardingContext == nil
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
        (selectedSession != nil || canQueueStartupAction)
            && !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var canQueueStartupAction: Bool {
        !requiresMacOnboarding && selectedSession == nil
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
            connectionLabel = needsOnboardingContext ? "Complete local setup" : "Choose a project workspace"
            isConnected = false
            return
        }
        started = true
        PostHogTelemetry.capture("mac_view_model_started", authSession: macAuthSession)

        // First successful start past the onboarding gate anchors Day 1 of
        // the Foundation phase. Subsequent calls are no-ops, keeping the
        // counter monotonic across reconnects, sidecar restarts, and app
        // relaunches.
        ensureFoundationStarted()

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
            // R6-P3F: optional quarantine fixture for hermetic restore-flow
            // tests. The flag points to a JSON file matching the
            // `rubric_quarantine_list` event payload — when present we hydrate
            // `quarantineFiles` directly so SwiftUI can render the surface
            // without the sidecar bridge.
            loadQuarantineFixtureIfRequested()
            PostHogTelemetry.capture("mac_sidecar_disabled_for_ui_tests", authSession: macAuthSession)
            return
        }

        sidecar.onEvent = { [weak self] event in
            Task { @MainActor in
                self?.handle(event)
            }
        }

        startupSessionAppearStartedAt = Date()
        startupSessionAppearElapsedMs = nil
        didRecordStartupSessionAppear = false
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

    func createSession(provider: AgentProvider? = nil, source: String? = nil) {
        let resolvedProvider = provider ?? selectedProvider
        let model = preferredModel(for: resolvedProvider)
        var properties: [String: Any] = [
            "provider": resolvedProvider.rawValue,
            "model": model,
        ]
        if let source = source?.trimmingCharacters(in: .whitespacesAndNewlines),
           !source.isEmpty {
            properties["source"] = source
        }
        PostHogTelemetry.capture(
            "mac_session_create_requested",
            properties: properties,
            authSession: macAuthSession
        )
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

    func archiveSession(_ session: ChatSession, source: String? = nil) {
        var properties: [String: Any] = [
            "session_id": session.id,
            "provider": session.provider.rawValue,
        ]
        if let source = source?.trimmingCharacters(in: .whitespacesAndNewlines),
           !source.isEmpty {
            properties["source"] = source
        }
        PostHogTelemetry.capture(
            "mac_session_archive_requested",
            properties: properties,
            authSession: macAuthSession
        )

        let archivedAt = Date()
        if let index = sessions.firstIndex(where: { $0.id == session.id }) {
            sessions[index].archivedAt = archivedAt
        }
        if selectedSessionID == session.id {
            selectedSessionID = sessions.first(where: { $0.id != session.id && $0.archivedAt == nil })?.id
        }
        refreshPresentationState()

        sidecar.send(payload: [
            "type": "archive_session",
            "sessionId": session.id,
            "archivedAt": ISO8601DateFormatter().string(from: archivedAt),
        ])
        if sessions.allSatisfy({ $0.archivedAt != nil }) {
            createSession(provider: selectedProvider, source: "archive_last_visible_session")
        }
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

    func retryLastFailedChatTurn() {
        guard let session = selectedSession else { return }
        guard let failedIndex = session.messages.lastIndex(where: { $0.role == .assistant && $0.state == .error }) else {
            return
        }
        let previousMessages = session.messages[..<failedIndex]
        guard let userMessage = previousMessages.last(where: { $0.role == .user }),
              let prompt = userMessage.content.trimmingCharacters(in: .whitespacesAndNewlines).nonEmpty else {
            return
        }
        draft = prompt
        sendPrompt()
    }

    /// Classify a draft prompt into one of the three routing modes. Pure
    /// function — exposed for tests, UI affordances (e.g., the chip that
    /// shows *"오늘 과제"* vs. *"sub-workflow"*), and to keep `sendPrompt`
    /// declarative. The order of checks is significant:
    ///   1. Slash-commands always win (sub-workflow tag).
    ///   2. The first user message inside a Foundation Day 0-7 session is
    ///      the daily-task response.
    ///   3. Everything else is free-chat.
    ///
    /// `foundationDayOverride` lets unit tests pin a specific day without
    /// rewinding `foundationStartedAt`.
    func classifyMessageRoute(
        prompt: String,
        in session: ChatSession,
        foundationDayOverride: Int? = nil
    ) -> ChatMessageRoute {
        let trimmed = prompt.trimmingCharacters(in: .whitespacesAndNewlines)
        let lower = trimmed.lowercased()

        for workflow in [
            ChatMessageRoute.SubWorkflow.analyzeAds,
            .bipDraft,
            .officeHoursDocs,
            .monetizationAsk,
            .foundationSummary,
        ] {
            if lower.hasPrefix(workflow.commandPrefix) {
                return .subWorkflow(workflow)
            }
        }

        let day = foundationDayOverride ?? foundationDayNumber
        let userMessageCount = session.messages.filter { $0.role == .user }.count
        if userMessageCount == 0,
           let day,
           (0...7).contains(day) {
            return .dailyTask(foundationDay: day)
        }

        return .freeChat
    }

    /// Live route classification for the current draft against the selected
    /// session. Returns `nil` when there is no draft or no session — UI
    /// chips can use this to hide themselves cleanly.
    var currentMessageRoute: ChatMessageRoute? {
        let trimmed = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, let session = selectedSession else { return nil }
        return classifyMessageRoute(prompt: trimmed, in: session)
    }

    func sendPrompt() {
        let prompt = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !prompt.isEmpty else { return }
        guard let session = selectedSession else {
            markWorkspaceSetupFirstRealInput()
            queueStartupAction(.prompt(prompt))
            draft = ""
            return
        }
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

        // Sub-AC 2: classify once, then route. Daily-task, sub-workflow, and
        // free-chat all share the same `send_prompt` transport — only the
        // metadata differs, so the chat surface stays a single message
        // stream with no fork.
        let route = classifyMessageRoute(prompt: prompt, in: session)

        // Provider validation. Sub-workflows that require Claude (currently
        // /analyze-ads and /foundation-summary) fail-closed before we hit
        // the sidecar — no half-routed sends, no stale telemetry.
        if case .subWorkflow(let workflow) = route,
           workflow.requiresClaudeProvider,
           session.provider != .claude {
            lastError = "\(workflow.commandPrefix) requires a Claude session"
            PostHogTelemetry.capture("mac_prompt_validation_failed", properties: [
                "session_id": session.id,
                "provider": session.provider.rawValue,
                "reason": "\(workflow.rawValue)_requires_claude",
                "mode": route.modeTag,
            ], authSession: macAuthSession)
            return
        }

        markWorkspaceSetupFirstRealInput()
        PostHogTelemetry.capture("mac_prompt_send_requested", properties: [
            "session_id": session.id,
            "provider": session.provider.rawValue,
            "command_kind": route.commandKind,
            "mode": route.modeTag,
            "sub_workflow": route.subWorkflowName ?? "",
            "foundation_day": route.foundationDay ?? -1,
            "prompt_length": prompt.count,
        ], authSession: macAuthSession)
        appendSentPromptPreview(sessionID: session.id, prompt: prompt)
        sidecarOutputLogs[session.id] = []
        draft = ""
        if usesInlineUITestStubResponses {
            appendInlineUITestStubResponse(prompt: prompt, sessionID: session.id)
            return
        }

        // Single transport, three modes. Sidecar inspects `mode` to decide
        // whether to load the matching sub-workflow prompt module
        // (`*-prompt.mjs`) or fall through to the default chat loop.
        var payload: [String: Any] = [
            "type": "send_prompt",
            "sessionId": session.id,
            "prompt": prompt,
            "mode": route.modeTag,
        ]
        if let subWorkflowName = route.subWorkflowName {
            payload["subWorkflow"] = subWorkflowName
        }
        if let foundationDay = route.foundationDay {
            payload["foundationDay"] = foundationDay
        }
        sidecar.send(payload: payload)
    }

    /// Stable key used by both the request side and the inject side so the
    /// idempotency invariant ("one first-prompt per session-day pair") is
    /// expressed in one place. Pure function, exposed `internal` for tests.
    static func foundationFirstPromptKey(sessionId: String, day: Int) -> String {
        "\(sessionId):day-\(day)"
    }

    /// Deterministic chat message ID used when injecting the AI-driven
    /// Foundation first prompt into the chat surface. Encodes the day so the
    /// merge logic in `mergeSessionSnapshot` can recognise client-only seeded
    /// messages and preserve them across `session_updated` snapshots from the
    /// sidecar (which would otherwise wipe the seed because the sidecar does
    /// not persist the first prompt itself — it is regenerated on demand by
    /// `buildFirstPromptForDay`).
    static func foundationFirstPromptMessageId(sessionId: String, day: Int) -> String {
        "foundation-first-prompt-day-\(day)-\(sessionId)"
    }

    /// Prefix that flags a chat message as a host-side Foundation first
    /// prompt seed. `mergeSessionSnapshot` keys off this prefix to preserve
    /// the seed when the sidecar pushes a session snapshot that does not
    /// include it (the sidecar only persists user/assistant turns produced by
    /// the provider stream, not the deterministic opener).
    static let foundationFirstPromptMessageIdPrefix = "foundation-first-prompt-"

    /// Sub-AC 2.4 — request the AI-driven Foundation Day 0-7 first prompt
    /// from the sidecar and inject it into the chat surface as the seeded
    /// assistant opener. The unified single AI interaction surface contract:
    /// one channel, day-aware, no second transport.
    ///
    /// Idempotency is two-layered:
    ///   1. `pendingFoundationFirstPromptKeys` short-circuits duplicate sends
    ///      while the sidecar is still computing (covers double-taps).
    ///   2. `injectedFoundationFirstPromptKeys` short-circuits re-injection
    ///      after the sidecar has already replied (covers reconnect replays).
    ///
    /// The sidecar's response is dispatched in `handle(_:)` via
    /// `case "foundation_first_prompt"` → `handleFoundationFirstPromptEvent`.
    func requestFoundationFirstPrompt(
        day: Int,
        sessionId: String? = nil,
        dynamicVariables: [String: Any]? = nil
    ) {
        let resolvedSessionId = sessionId ?? selectedSessionID
        guard let resolvedSessionId, !resolvedSessionId.isEmpty else { return }
        guard (0...7).contains(day) else {
            PostHogTelemetry.capture(
                "mac_foundation_first_prompt_request_rejected",
                properties: [
                    "session_id": resolvedSessionId,
                    "day": day,
                    "reason": "day_out_of_range",
                ],
                authSession: macAuthSession
            )
            return
        }

        let key = Self.foundationFirstPromptKey(sessionId: resolvedSessionId, day: day)
        if injectedFoundationFirstPromptKeys.contains(key) { return }
        if pendingFoundationFirstPromptKeys.contains(key) { return }

        pendingFoundationFirstPromptKeys.insert(key)

        var payload: [String: Any] = [
            "type": "foundation_first_prompt",
            "sessionId": resolvedSessionId,
            "day": day,
        ]
        if let dynamicVariables, !dynamicVariables.isEmpty {
            payload["dynamicVariables"] = dynamicVariables
        }

        PostHogTelemetry.capture(
            "mac_foundation_first_prompt_requested",
            properties: [
                "session_id": resolvedSessionId,
                "day": day,
                "has_dynamic_variables": (dynamicVariables?.isEmpty == false),
            ],
            authSession: macAuthSession
        )

        sidecar.send(payload: payload)
    }

    /// Sub-AC 2.4 — handler for `foundation_first_prompt` sidecar events.
    /// Injects the rendered 3-section minimal opener into the target session
    /// as a seeded assistant message with a deterministic ID so subsequent
    /// `session_updated` merges keep it intact (see
    /// `mergeSessionSnapshot`'s preservation rule for the
    /// `foundation-first-prompt-` prefix).
    ///
    /// Visibility: `internal` so unit tests can exercise the inject path
    /// without spinning up a real sidecar bridge.
    func handleFoundationFirstPromptEvent(_ event: SidecarEvent) {
        guard let sessionId = event.sessionId, !sessionId.isEmpty else { return }
        guard let day = event.day, (0...7).contains(day) else { return }
        guard let firstPrompt = event.firstPrompt else { return }

        let key = Self.foundationFirstPromptKey(sessionId: sessionId, day: day)
        pendingFoundationFirstPromptKeys.remove(key)

        guard let sessionIndex = sessions.firstIndex(where: { $0.id == sessionId }) else {
            // Session not yet present in the local snapshot — drop, the next
            // `session_created` / `sessions_snapshot` will retrigger the
            // request flow from the surface that owns it.
            return
        }

        let messageId = Self.foundationFirstPromptMessageId(sessionId: sessionId, day: day)
        if sessions[sessionIndex].messages.contains(where: { $0.id == messageId }) {
            // Already injected (e.g. re-entry after reconnect). Lock the
            // idempotency guard and bail without emitting telemetry noise.
            injectedFoundationFirstPromptKeys.insert(key)
            return
        }

        let displayText = firstPrompt.text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !displayText.isEmpty else { return }

        let provider = sessions[sessionIndex].provider
        let now = Date()
        let seededMessage = ChatMessage(
            id: messageId,
            role: .assistant,
            provider: provider,
            content: displayText,
            state: .final,
            createdAt: now,
            error: nil,
            bipMissionChoices: nil,
            providerAuthActions: nil
        )

        // Insert at the head of the conversation so the opener anchors the
        // chat surface — Foundation Day 0-7 contract: the AI speaks first.
        // If user/assistant messages already exist (e.g. session was selected
        // mid-conversation), still seed at index 0 to preserve the opener as
        // the conversation root.
        sessions[sessionIndex].messages.insert(seededMessage, at: 0)
        sessions[sessionIndex].updatedAt = now
        injectedFoundationFirstPromptKeys.insert(key)

        PostHogTelemetry.capture(
            "mac_foundation_first_prompt_injected",
            properties: [
                "session_id": sessionId,
                "day": day,
                "spec_version": firstPrompt.specVersion ?? "",
                "sub_workflow": firstPrompt.subWorkflow ?? "",
                "artifact_count": firstPrompt.artifacts.count,
                "text_length": displayText.count,
            ],
            authSession: macAuthSession
        )

        refreshPresentationState()
    }

    func submitStructuredPrompt(
        requestId: String,
        responses: [StructuredPromptSubmission]
    ) {
        guard let session = selectedSession else { return }
        if responses.contains(where: { response in
            !response.selectedOptions.isEmpty
                || response.freeText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false
        }) {
            markWorkspaceSetupFirstRealInput()
        }
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
        markWorkspaceSetupStarted(root: root)
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

    private func handleRequestEmit(_ request: SidecarRequestEmit) {
        captureWorkspaceSetupTelemetry(
            workspaceSetupTelemetryGate.requestsToCapture(afterReceiving: request)
        )
    }

    private func markWorkspaceSetupStarted(root: String) {
        let request = try? SidecarRequestEmit(
            event: .workspaceSetupStarted,
            properties: [
                "workspace_basename": .string((root as NSString).lastPathComponent),
                "has_explicit_workspace": .bool(WorkspaceSettings.hasExplicitWorkspace),
            ]
        )
        if let request {
            captureWorkspaceSetupTelemetry(
                workspaceSetupTelemetryGate.requestsToCapture(afterReceiving: request)
            )
        }
    }

    private func markWorkspaceSetupScanSucceeded() {
        captureWorkspaceSetupTelemetry(
            workspaceSetupTelemetryGate.requestsToCaptureAfterWorkspaceScanSuccess()
        )
    }

    private func markWorkspaceSetupFirstRealInput() {
        captureWorkspaceSetupTelemetry(
            workspaceSetupTelemetryGate.requestsToCaptureAfterFirstRealInput()
        )
    }

    private func captureWorkspaceSetupTelemetry(_ requests: [SidecarRequestEmit]) {
        for request in requests {
            PostHogTelemetry.capture(
                request.event.rawValue,
                properties: request.telemetryProperties,
                authSession: macAuthSession
            )
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

    // R4 — quarantine surface. Both methods are no-ops when offline; the
    // sidecar replies asynchronously with `rubric_quarantine_list` /
    // `rubric_quarantine_restored` events that the event router below maps
    // back into `quarantineFiles`.
    func requestQuarantineList() {
        guard isConnected else { return }
        sidecar.send(payload: ["type": "rubric_quarantine_list_request"])
    }

    func restoreQuarantinedRecord(
        bundle: QuarantineFileWithDump,
        entry: QuarantineEntry,
        honestModeReason: String
    ) async {
        guard isConnected else { return }
        // Round 6 / CCG-UX: send only the user's one-line reason. The sidecar
        // reads the raw quarantine entry, preserves original axis scores via
        // `proposeFixForEntry`, and re-validates the resulting record. The Mac
        // client no longer owns schema-shape decisions (Round 4 composeFixedRecord
        // built fresh score=1 stubs that overwrote user progress).
        let trimmedReason = String(honestModeReason.prefix(500))
        let payload: [String: Any] = [
            "type": "rubric_quarantine_restore_with_reason",
            "quarantinePath": bundle.file.path,
            "recordIndex": entry.index,
            "expectedMtimeMs": bundle.dump.mtimeMs,
            "honestModeReason": trimmedReason,
        ]
        sidecar.send(payload: payload)
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
        guard isConnected, let sessionID = currentBipCoachSessionID() else {
            queueStartupAction(.mission(compact: compact, curriculumDay: curriculumDay))
            return
        }
        isBipCoachGenerating = true
        lastBipRequestedAction = .generateMission(compact: compact)
        lastError = nil
        let provider = selectedSession?.provider ?? visibleBipCoach?.config.provider ?? selectedProvider
        bipMissionProgress = BipMissionProgress(stage: "reading_sheet", detail: "프로젝트 기준과 오늘 커리큘럼을 확인하는 중", provider: provider.rawValue, sheetRowsRead: nil, docCharsRead: nil, elapsedMs: nil)
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
            "localEvidence": localEvidenceBundle(),
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
            "localEvidence": localEvidenceBundle(),
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

    func completeBipMission(threadsUrl: String = "", sheetRowNote: String = "") {
        guard isConnected else { return }
        guard let sessionID = currentBipCoachSessionID() else { return }
        let cleanedThreadsUrl = threadsUrl.trimmingCharacters(in: .whitespacesAndNewlines)
        let cleanedSheetRowNote = sheetRowNote.trimmingCharacters(in: .whitespacesAndNewlines)
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

    private func localEvidenceBundle() -> [String: Any] {
        var bundle: [String: Any] = [
            "workspaceRoot": WorkspaceSettings.resolvedURL().path,
        ]
        if let onboardingContext {
            bundle["onboardingContext"] = [
                "work_mode": onboardingContext.workMode.rawValue,
                "role": onboardingContext.role.rawValue,
                "project_stage": onboardingContext.projectStage.rawValue,
                "isolation_level": onboardingContext.isolationLevel.rawValue,
                "isolation_levels": onboardingContext.isolationLevels.map(\.rawValue),
            ]
        }
        if let scanResult {
            var scan: [String: Any] = [:]
            if let icp = scanResult.icp { scan["icp"] = icp }
            if let spec = scanResult.spec { scan["spec"] = spec }
            if let values = scanResult.values { scan["values"] = values }
            if let designSystem = scanResult.designSystem { scan["designSystem"] = designSystem }
            if let adr = scanResult.adr { scan["adr"] = adr }
            if let goal = scanResult.goal { scan["goal"] = goal }
            if let docs = scanResult.docs { scan["docs"] = docs }
            if let sheet = scanResult.sheet { scan["sheet"] = sheet }
            if let hypothesis = scanResult.onboardingHypothesis {
                scan["onboardingHypothesis"] = [
                    "productName": hypothesis.productName ?? "",
                    "targetUser": hypothesis.targetUser ?? "",
                    "likelyUsers": hypothesis.likelyUsers ?? [],
                    "confidence": hypothesis.confidence ?? "",
                ]
            }
            bundle["workspaceScan"] = scan
        }
        return bundle
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
        clearStartupQueuedAction()
        WorkspaceSettings.store(url)
        foundationProgressStore = nil
        restoreFoundationProgress(arguments: CommandLine.arguments)
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
                "work_mode": context.workMode.rawValue,
                "role": context.role.rawValue,
                "project_stage": context.projectStage.rawValue,
                "isolation_level": context.isolationLevel.rawValue,
                "isolation_levels": context.isolationLevels.map(\.rawValue).joined(separator: ","),
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

    private static func makeSystemAuthSession(
        url: URL,
        callbackURLScheme: String,
        presentationContextProvider: ASWebAuthenticationPresentationContextProviding,
        prefersEphemeral: Bool,
        completion: @escaping WebAuthenticationSessionCompletion
    ) -> WebAuthenticationSessionHandle {
        SystemWebAuthenticationSessionHandle(
            url: url,
            callbackURLScheme: callbackURLScheme,
            presentationContextProvider: presentationContextProvider,
            prefersEphemeral: prefersEphemeral,
            completion: completion
        )
    }

    private func presentAuthSession(url: URL, flow: AuthFlow = .notion) {
        let session = authSessionFactory(
            url,
            "agentic30",
            authPresentationContext,
            true
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
        authSession = session
        activateAppForAuth()
        if !session.start() {
            authSession = nil
            handleAuthSessionError("Could not open Google sign-in. Open the workspace window and try again.", flow: flow)
        }
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
                "work_mode": onboardingContext.workMode.rawValue,
                "role": onboardingContext.role.rawValue,
                "project_stage": onboardingContext.projectStage.rawValue,
                "isolation_level": onboardingContext.isolationLevel.rawValue,
                "isolation_levels": onboardingContext.isolationLevels.map(\.rawValue),
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
                title: "오늘 실행",
                body: "Threads 글감과 3개 초안을 만들 시간입니다."
            )
            scheduleBipNotification(
                intent: .evening,
                hour: eveningHour,
                title: "공개 실행 마감 체크",
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
        case "request_emit":
            if let request = event.requestEmit {
                handleRequestEmit(request)
            }
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
            ensureSelection()
            recordStartupSessionAppearIfNeeded(source: "ready")
            sendAuthContextToSidecar()
            refreshPresentationState()
            requestCodexWarmupIfNeeded()
            requestBipReadinessCheck()
            requestInitialBipGateIfNeeded()
            flushStartupQueuedActionIfPossible()
            if let root = pendingWorkspaceScanRoot {
                pendingWorkspaceScanRoot = nil
                sendWorkspaceScan(root: root)
            }
        case "sessions_snapshot":
            if let sessions = event.sessions {
                self.sessions = sessions.sorted(by: { $0.updatedAt > $1.updatedAt })
                ensureSelection()
                recordStartupSessionAppearIfNeeded(source: "sessions_snapshot")
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
                recordStartupSessionAppearIfNeeded(source: "session_created")
                refreshPresentationState()
                requestCodexWarmupIfNeeded()
                requestInitialBipGateIfNeeded()
                flushStartupQueuedActionIfPossible()
            }
        case "session_updated":
            if let session = event.session {
                upsert(session)
                pruneSentPromptPreviews(for: session)
                refreshPresentationState()
                requestCodexWarmupIfNeeded()
                flushStartupQueuedActionIfPossible()
            }
        case "session_deleted":
            guard let sessionID = event.sessionId else { return }
            sessions.removeAll(where: { $0.id == sessionID })
            // Drop Foundation first-prompt idempotency markers tied to the
            // deleted session so a future re-create with the same id (or any
            // id at all) does not silently suppress re-injection.
            let prefix = "\(sessionID):day-"
            injectedFoundationFirstPromptKeys = injectedFoundationFirstPromptKeys.filter { !$0.hasPrefix(prefix) }
            pendingFoundationFirstPromptKeys = pendingFoundationFirstPromptKeys.filter { !$0.hasPrefix(prefix) }
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
        case "foundation_first_prompt":
            // Sub-AC 2.4: AI-driven Foundation Day 0-7 first prompt arrives
            // here; inject as the seeded assistant opener for the matching
            // session. Idempotent + persistence-safe via deterministic ID.
            handleFoundationFirstPromptEvent(event)
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
                markWorkspaceSetupScanSucceeded()
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
            lastError = event.bipSetupGateMessage ?? "오늘 미션은 바로 만들 수 있고, 부족한 기준은 추천 정확도를 높이는 데 사용됩니다."
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
            markFoundationDayCompleted(selectedFoundationDay)
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
        case "rubric_quarantine_list":
            quarantineFiles = event.items ?? []
            quarantineRefreshError = nil
        case "rubric_quarantine_restored":
            // Sidecar will emit a fresh list immediately after, so we just
            // clear any pending error here. Toast/UX state lives in the view.
            quarantineRefreshError = nil
        case "rubric_quarantine_error":
            quarantineRefreshError = event.message ?? "Quarantine \(event.stage ?? "operation") failed."
        case "weekly_ritual_prompt":
            if let prompt = event.weeklyRitualPrompt {
                pendingWeeklyRitual = prompt
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
                markStartupQueuedActionFailed(event.message ?? "Sidecar 연결이 끊겼습니다.")
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
        if selectedSessionID == nil ||
            !sessions.contains(where: { $0.id == selectedSessionID && $0.archivedAt == nil }) {
            selectedSessionID = sessions.first(where: { $0.archivedAt == nil })?.id
        }
        if sessions.allSatisfy({ $0.archivedAt != nil }) {
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

    #if DEBUG
    enum UITestingFixtureResult {
        case notRequested
        case failed(String)
        case loaded([QuarantineFileWithDump])
    }

    private static func applyUITestingQuarantineFixture(
        arguments: [String]
    ) -> UITestingFixtureResult {
        let key = "--ui-testing-stub-quarantine-fixture"
        var path: String? = nil
        for (idx, arg) in arguments.enumerated() {
            if arg == key, idx + 1 < arguments.count {
                path = arguments[idx + 1]; break
            }
            if arg.hasPrefix(key + "=") {
                path = String(arg.dropFirst(key.count + 1)); break
            }
        }
        guard let resolvedPath = path else {
            return .notRequested
        }
        do {
            let data = try Data(contentsOf: URL(fileURLWithPath: resolvedPath))
            let event = try JSONDecoder().decode(SidecarEvent.self, from: data)
            if let items = event.items {
                return .loaded(items)
            }
            return .failed("fixture decoded but items=nil")
        } catch {
            return .failed("fixture load failed at \(resolvedPath): \(error)")
        }
    }
    #endif

    private func loadQuarantineFixtureIfRequested() {
        // R6-P3F: read a SidecarEvent-shaped fixture (rubric_quarantine_list)
        // from disk and hydrate `quarantineFiles` directly. Used by hermetic
        // UI tests to drive the restore-flow surface without a live sidecar.
        let arguments = CommandLine.arguments
        // Manual scan covers both `--flag=value` and `--flag value` forms,
        // sidestepping any ambiguity in the helper-resolution path between
        // the two `uiTestingArgumentValue` definitions in this file.
        var path: String? = nil
        let key = "--ui-testing-stub-quarantine-fixture"
        for (idx, arg) in arguments.enumerated() {
            if arg == key, idx + 1 < arguments.count {
                path = arguments[idx + 1]
                break
            }
            if arg.hasPrefix(key + "=") {
                path = String(arg.dropFirst(key.count + 1))
                break
            }
        }
        guard let resolvedPath = path else {
            return
        }
        let url = URL(fileURLWithPath: resolvedPath)
        do {
            let data = try Data(contentsOf: url)
            let event = try JSONDecoder().decode(SidecarEvent.self, from: data)
            if let items = event.items {
                quarantineFiles = items
                quarantineRefreshError = nil
            } else {
                quarantineRefreshError = "fixture decoded but items=nil"
            }
        } catch {
            quarantineRefreshError = "fixture load failed: \(error)"
        }
    }

    private func ensureInlineUITestStubSession() {
        guard sessions.isEmpty else {
            ensureSelection()
            seedInlineUITestBipCoachIfNeeded()
            return
        }

        let now = Date()
        if CommandLine.arguments.contains("--ui-testing-seed-running-idd-session") {
            let session = ChatSession(
                id: UUID().uuidString,
                title: "기준 정리: 누구를 위한 제품인지",
                provider: selectedProvider,
                model: preferredModel(for: selectedProvider),
                status: .running,
                createdAt: now,
                updatedAt: now,
                error: nil,
                messages: [
                    ChatMessage(
                        id: UUID().uuidString,
                        role: .user,
                        provider: selectedProvider,
                        content: "지금 하는 방식부터 정리",
                        state: .final,
                        createdAt: now,
                        error: nil,
                        bipMissionChoices: nil,
                        providerAuthActions: nil
                    )
                ],
                pendingUserInput: nil,
                runtime: ChatSessionRuntime(
                    codexThreadId: nil,
                    codexThreadMeta: nil,
                    codexWarm: nil,
                    iddDocumentType: "icp"
                )
            )
            sessions = [session]
            selectedSessionID = session.id
            seedInlineUITestBipCoachIfNeeded()
            refreshPresentationState()
            return
        }

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
            messages: pendingUserInput == nil ? [
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
            ] : [],
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
            title: "첫 ICP 구체화",
            createdAt: createdAt,
            questions: [
                StructuredPromptQuestion(
                    header: "ICP 좁히기",
                    question: "첫 ICP를 전업 1인 개발자 전체로 두면 너무 넓습니다.\n이번 주에 실제로 검증할 가장 좁은 하위 ICP는 누구인가요?",
                    helperText: "진단: Agentic30은 전업 1인 개발자가 무엇을 만들어야 팔리는지 모르는 문제를 30일 실행 기록 기반 커리큘럼으로 좁히는 macOS assistant입니다.",
                    options: [
                        StructuredPromptOption(
                            label: "퇴사 후 수익 0원 1인 개발자",
                            description: "저축 소진 압박이 있어 30일 안에 사용자 증거와 첫 매출 신호를 원합니다.",
                            preview: nil,
                            nextIntent: "full_time_zero_revenue_indie"
                        ),
                        StructuredPromptOption(
                            label: "에이전트로 MVP 만든 개발자",
                            description: "Claude/Codex로 만들 수 있지만 무엇을 팔지, 누구에게 물을지 막혀 있습니다.",
                            preview: nil,
                            nextIntent: "agent_built_mvp_no_customers"
                        ),
                        StructuredPromptOption(
                            label: "인터뷰/BIP (Build In Public) 기록 의향 있음",
                            description: "프로젝트 path, 업무 일지, 고객 인터뷰, 공개 기록을 매일 입력할 수 있습니다.",
                            preview: nil,
                            nextIntent: "records_ready_builder"
                        ),
                        StructuredPromptOption(
                            label: "다른 하위 ICP",
                            description: "역할, 상황, 현재 대안, 연락 가능성을 함께 적습니다.",
                            preview: nil,
                            nextIntent: "other_specific_icp"
                        )
                    ],
                    multiSelect: false,
                    allowFreeText: true,
                    freeTextPlaceholder: "예: 현재 Claude Code로 MVP는 만들었지만 유료 고객이 없는 macOS 1인 개발자",
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
        let seedCurrentMission = CommandLine.arguments.contains("--ui-testing-seed-bip-current-mission")
        let seedLocalMissionChoices = CommandLine.arguments.contains("--ui-testing-seed-bip-local-mission-choices")
        guard (seedCurrentMission || seedLocalMissionChoices),
              let sessionID = selectedSessionID else {
            return
        }

        if seedCurrentMission {
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
        }
        bipCoach = seedLocalMissionChoices
            ? Self.makeUITestingLocalBipCoachState(sessionID: sessionID)
            : Self.makeUITestingBipCoachState(sessionID: sessionID)
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
                provider: AgentProvider.codex.rawValue,
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

    private static func makeUITestingLocalBipCoachState(sessionID: String) -> BipCoachState {
        let now = Date()
        let choices = [
            BipCoachMission(
                id: "ui-test-local-mission-1",
                date: "2026-04-30",
                provider: AgentProvider.codex.rawValue,
                status: "drafted",
                compact: true,
                title: "첫 고객 후보 3명 정하기",
                angle: "Google 설정 전에도 프로젝트 기준으로 오늘 실행을 시작하기",
                mission: "현재 프로젝트를 가장 자주 겪을 사람 3명을 적고 첫 질문 하나를 보냅니다.",
                drafts: [],
                eveningChecklist: ["후보 3명 적기", "첫 질문 1개 보내기"],
                evidenceRefs: [],
                generatedAt: now,
                completedAt: nil,
                threadsUrl: nil,
                sheetRowNote: nil
            )
        ]

        return BipCoachState(
            schemaVersion: 1,
            updatedAt: now,
            sessionId: sessionID,
            config: BipCoachConfig(
                provider: .codex,
                threadsHandle: nil,
                sheetUrl: nil,
                sheetId: nil,
                sheetTabName: nil,
                docUrl: nil,
                docId: nil,
                morningHour: 10,
                eveningHour: 21
            ),
            evidence: nil,
            missionChoices: choices,
            currentMission: nil,
            streak: BipCoachStreak(current: 0, longest: 0, lastCompletedDate: nil),
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
        let incomingMessageIDs = Set(incoming.messages.map { $0.id })
        // Preserve client-only seeded messages (currently the Foundation
        // Day 0-7 first prompt opener — see Sub-AC 2.4) when the sidecar
        // pushes a `session_updated` snapshot that does not include them.
        // The sidecar deliberately does NOT persist the AI-driven first
        // prompt because `buildFirstPromptForDay` is deterministic; without
        // this preservation rule the seeded opener would vanish the moment
        // the user sends their first reply (because the sidecar then emits
        // a session snapshot containing only the user/assistant turns).
        let preservedSeeds = current.messages.filter { message in
            message.id.hasPrefix(Self.foundationFirstPromptMessageIdPrefix)
                && !incomingMessageIDs.contains(message.id)
        }
        let mappedIncoming = incoming.messages.map { incomingMessage in
            guard let currentMessage = currentMessagesByID[incomingMessage.id] else {
                return incomingMessage
            }
            return mergeMessageSnapshot(incomingMessage, into: currentMessage, sessionStatus: incoming.status)
        }
        // Seeded openers always anchor the conversation root.
        merged.messages = preservedSeeds + mappedIncoming
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

    private func recordStartupSessionAppearIfNeeded(source: String) {
        guard !didRecordStartupSessionAppear,
              let session = selectedSession,
              let startedAt = startupSessionAppearStartedAt
        else { return }

        let elapsedMs = max(0, Int((Date().timeIntervalSince(startedAt) * 1000).rounded()))
        startupSessionAppearElapsedMs = elapsedMs
        didRecordStartupSessionAppear = true

        var properties: [String: Any] = [
            "source": source,
            "elapsed_ms": elapsedMs,
            "session_id": session.id,
            "provider": session.provider.rawValue,
            "restored_session": source != "session_created",
        ]
        if let sidecarElapsed = session.runtime?.startupTiming?.processToSessionCreatedMs {
            properties["sidecar_process_to_session_created_ms"] = sidecarElapsed
        }
        if let readyElapsed = session.runtime?.startupTiming?.processToSidecarReadyMs {
            properties["sidecar_process_to_ready_ms"] = readyElapsed
        }
        if let readyToCreateElapsed = session.runtime?.startupTiming?.sidecarReadyToCreateSessionReceivedMs {
            properties["sidecar_ready_to_create_session_received_ms"] = readyToCreateElapsed
        }
        if let authToCreateElapsed = session.runtime?.startupTiming?.clientAuthenticatedToCreateSessionReceivedMs {
            properties["sidecar_auth_to_create_session_received_ms"] = authToCreateElapsed
        }
        if let createElapsed = session.runtime?.startupTiming?.createSessionElapsedMs {
            properties["sidecar_create_session_elapsed_ms"] = createElapsed
        }
        PostHogTelemetry.capture(
            "mac_startup_session_visible",
            properties: properties,
            authSession: macAuthSession
        )
    }

    func clearStartupQueuedAction() {
        startupQueuedAction = nil
    }

    func retryStartupQueuedAction() {
        guard var action = startupQueuedAction else { return }
        action.state = .waiting
        startupQueuedAction = action
        flushStartupQueuedActionIfPossible()
    }

    private func queueStartupAction(_ kind: StartupQueuedAction.Kind) {
        guard canQueueStartupAction else { return }
        startupQueuedAction = StartupQueuedAction(kind: kind)
        PostHogTelemetry.capture("mac_startup_action_queued", properties: [
            "kind": startupQueuedActionKindName(kind),
        ], authSession: macAuthSession)
    }

    private func flushStartupQueuedActionIfPossible() {
        guard var action = startupQueuedAction,
              isConnected,
              selectedSession != nil else {
            return
        }

        switch action.state {
        case .sending:
            return
        case .failed, .waiting:
            break
        }

        action.state = .sending
        startupQueuedAction = action

        switch action.kind {
        case .prompt(let prompt):
            draft = prompt
            startupQueuedAction = nil
            sendPrompt()
        case .mission(let compact, let curriculumDay):
            startupQueuedAction = nil
            generateBipMission(compact: compact, curriculumDay: curriculumDay)
        }
    }

    private func markStartupQueuedActionFailed(_ message: String) {
        guard var action = startupQueuedAction else { return }
        action.state = .failed(message)
        startupQueuedAction = action
    }

    private func startupQueuedActionKindName(_ kind: StartupQueuedAction.Kind) -> String {
        switch kind {
        case .prompt:
            return "prompt"
        case .mission:
            return "mission"
        }
    }

    private func currentBipCoachSessionID() -> String? {
        if let selectedSessionID {
            return selectedSessionID
        }
        return bipCoach?.sessionId ?? sessions.first?.id
    }

    // Test-host detection is referenced from non-DEBUG init paths (line ~489),
    // so it must compile in Release. The function body is harmless in Release
    // (returns false when no XCTest env / .xctest argv is present).
    private static func isXCTestHost(arguments: [String]) -> Bool {
        ProcessInfo.processInfo.environment["XCTestConfigurationFilePath"] != nil
            || arguments.contains(where: { $0.contains(".xctest") })
    }

    #if DEBUG
    private static func isUITesting(arguments: [String]) -> Bool {
        arguments.contains(where: { $0.hasPrefix("--ui-testing-") })
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
            isolationLevel: .projectFolder
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

struct FoundationProgressSnapshot: Codable, Hashable {
    var schemaVersion = 1
    var workspaceRoot = ""
    var startedAt: Date?
    var selectedDay = 1
    var completedDays: Set<Int> = []

    private enum CodingKeys: String, CodingKey {
        case schemaVersion
        case workspaceRoot
        case startedAt
        case selectedDay
        case completedDays
    }

    func currentDayNumber(now: Date = Date()) -> Int? {
        guard let startedAt else { return nil }
        let elapsed = now.timeIntervalSince(startedAt)
        let day = Int(floor(elapsed / 86_400)) + 1
        return max(1, min(day, 30))
    }

    func isUnlocked(_ day: Int) -> Bool {
        if day <= 1 { return true }
        return completedDays.contains(day - 1)
    }
}

struct FoundationProgressStore {
    let workspaceRoot: String
    let appSupportURL: URL

    init(
        workspaceRoot: String,
        appSupportURL: URL = FoundationProgressStore.defaultAppSupportURL()
    ) {
        self.workspaceRoot = workspaceRoot
        self.appSupportURL = appSupportURL
    }

    var fileURL: URL {
        appSupportURL
            .appendingPathComponent("foundation-progress", isDirectory: true)
            .appendingPathComponent("\(Self.stableWorkspaceID(workspaceRoot)).json")
    }

    func load() -> FoundationProgressSnapshot? {
        guard let data = try? Data(contentsOf: fileURL) else { return nil }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        guard var snapshot = try? decoder.decode(FoundationProgressSnapshot.self, from: data) else {
            return nil
        }
        guard snapshot.workspaceRoot == workspaceRoot else { return nil }
        snapshot.selectedDay = max(1, min(snapshot.selectedDay, 30))
        snapshot.completedDays = Set(snapshot.completedDays.map { max(1, min($0, 30)) })
        return snapshot
    }

    func save(_ snapshot: FoundationProgressSnapshot) {
        var next = snapshot
        next.workspaceRoot = workspaceRoot
        next.selectedDay = max(1, min(next.selectedDay, 30))
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        guard let data = try? encoder.encode(next) else { return }
        try? FileManager.default.createDirectory(
            at: fileURL.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        try? data.write(to: fileURL)
        try? FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: fileURL.path)
    }

    func clear() {
        try? FileManager.default.removeItem(at: fileURL)
    }

    static func defaultAppSupportURL() -> URL {
        if let override = ProcessInfo.processInfo.environment["AGENTIC30_APP_SUPPORT_PATH"]?
            .trimmingCharacters(in: .whitespacesAndNewlines),
           !override.isEmpty {
            return URL(fileURLWithPath: override, isDirectory: true)
        }
        return FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support/agentic30", isDirectory: true)
    }

    static func stableWorkspaceID(_ workspaceRoot: String) -> String {
        let normalized = URL(fileURLWithPath: workspaceRoot, isDirectory: true).standardizedFileURL.path
        var hash: UInt64 = 14_695_981_039_346_656_037
        for byte in normalized.utf8 {
            hash ^= UInt64(byte)
            hash &*= 1_099_511_628_211
        }
        return String(format: "%016llx", hash)
    }
}

private extension AgenticViewModel {
    func restoreFoundationProgress(arguments: [String]) {
        ensureFoundationProgressStore()
        guard let store = foundationProgressStore else { return }
        if arguments.contains("--ui-testing-reset-onboarding") {
            store.clear()
        }

        if var stored = store.load() {
            stored.selectedDay = stored.isUnlocked(stored.selectedDay) ? stored.selectedDay : 1
            foundationProgressState = stored
            foundationStartedAt = stored.startedAt
            return
        }

        let snapshot = FoundationProgressSnapshot(workspaceRoot: WorkspaceSettings.resolvedURL().path)
        foundationProgressState = snapshot
        foundationStartedAt = snapshot.startedAt
    }

    func ensureFoundationProgressStore() {
        let root = WorkspaceSettings.resolvedURL().path
        if foundationProgressStore?.workspaceRoot != root {
            foundationProgressStore = FoundationProgressStore(workspaceRoot: root)
        }
    }

    func updateFoundationProgress(_ mutate: (inout FoundationProgressSnapshot) -> Void) {
        ensureFoundationProgressStore()
        var snapshot = foundationProgressState
        snapshot.workspaceRoot = WorkspaceSettings.resolvedURL().path
        mutate(&snapshot)
        if !snapshot.isUnlocked(snapshot.selectedDay) {
            snapshot.selectedDay = 1
        }
        foundationProgressState = snapshot
        foundationStartedAt = snapshot.startedAt
        foundationProgressStore?.save(snapshot)
    }
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

/// Decoded shape of the AI-driven Foundation Day 0-7 first prompt that the
/// sidecar emits in response to a `foundation_first_prompt` request. Mirrors
/// the JS-side `buildFirstPromptForDay()` return value documented in
/// `packages/mac/agentic30/sidecar/foundation-chat.mjs` (3-section minimal:
/// Yesterday 1줄 / Today 1줄 / Q 1줄). The persona is fixed to YC 파트너 /
/// 시니어 메이커 (직설+압박, 반말 ~어/야); the host trusts that contract and
/// only displays the rendered text.
///
/// Field names use Swift camelCase; CodingKeys remap snake_case JSON keys
/// (`core_question`, `spec_version`, `sub_workflow`) to match the ontology
/// concept names from `Agentic30FoundationPhase` while keeping Swift
/// idiomatic.
struct FoundationFirstPrompt: Decodable, Hashable {
    let day: Int
    let persona: String
    let template: String
    let yesterday: String
    let today: String
    let question: String
    let coreQuestion: String?
    let specVersion: String?
    let subWorkflow: String?
    let artifacts: [String]
    /// Pre-formatted display text from the sidecar
    /// (`어제: ...\n오늘: ...\nQ: ...`). The host renders this verbatim so
    /// the YC-partner tone and line layout stay locked at the producer.
    let text: String

    private enum CodingKeys: String, CodingKey {
        case day
        case persona
        case template
        case yesterday
        case today
        case question
        case coreQuestion = "core_question"
        case specVersion = "spec_version"
        case subWorkflow = "sub_workflow"
        case artifacts
        case text
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        day = try container.decode(Int.self, forKey: .day)
        persona = (try? container.decode(String.self, forKey: .persona)) ?? ""
        template = (try? container.decode(String.self, forKey: .template)) ?? ""
        yesterday = (try? container.decode(String.self, forKey: .yesterday)) ?? ""
        today = (try? container.decode(String.self, forKey: .today)) ?? ""
        question = (try? container.decode(String.self, forKey: .question)) ?? ""
        coreQuestion = try? container.decode(String.self, forKey: .coreQuestion)
        specVersion = try? container.decode(String.self, forKey: .specVersion)
        subWorkflow = try? container.decode(String.self, forKey: .subWorkflow)
        artifacts = (try? container.decode([String].self, forKey: .artifacts)) ?? []
        let suppliedText = (try? container.decode(String.self, forKey: .text))?
            .trimmingCharacters(in: .whitespacesAndNewlines)
        if let suppliedText, !suppliedText.isEmpty {
            text = suppliedText
        } else {
            text = Self.formatFallbackText(yesterday: yesterday, today: today, question: question)
        }
    }

    /// Memberwise initializer for tests + locally-constructed previews.
    init(
        day: Int,
        persona: String = "YC 파트너 / 시니어 메이커 (직설+압박, 반말)",
        template: String = "3-section minimal",
        yesterday: String,
        today: String,
        question: String,
        coreQuestion: String? = nil,
        specVersion: String? = nil,
        subWorkflow: String? = nil,
        artifacts: [String] = [],
        text: String? = nil
    ) {
        self.day = day
        self.persona = persona
        self.template = template
        self.yesterday = yesterday
        self.today = today
        self.question = question
        self.coreQuestion = coreQuestion
        self.specVersion = specVersion
        self.subWorkflow = subWorkflow
        self.artifacts = artifacts
        let trimmed = text?.trimmingCharacters(in: .whitespacesAndNewlines)
        if let trimmed, !trimmed.isEmpty {
            self.text = trimmed
        } else {
            self.text = Self.formatFallbackText(yesterday: yesterday, today: today, question: question)
        }
    }

    /// Mirror `formatFirstPromptText()` from foundation-chat.mjs: stable
    /// layout — Yesterday / Today / Q on three separate lines, no fluff,
    /// no emoji. Used as the deterministic display fallback when the sidecar
    /// omits or empties `firstPrompt.text`.
    static func formatFallbackText(
        yesterday: String,
        today: String,
        question: String
    ) -> String {
        var lines: [String] = []
        let trimmedYesterday = yesterday.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedToday = today.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedQuestion = question.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmedYesterday.isEmpty { lines.append("어제: \(trimmedYesterday)") }
        if !trimmedToday.isEmpty { lines.append("오늘: \(trimmedToday)") }
        if !trimmedQuestion.isEmpty { lines.append("Q: \(trimmedQuestion)") }
        return lines.joined(separator: "\n")
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
    /// Foundation Day index (0-7). Carried by `foundation_first_prompt`
    /// responses so the host knows which day's opener was rendered.
    let day: Int?
    /// AI-driven daily first prompt payload. Non-nil only on
    /// `foundation_first_prompt` events.
    let firstPrompt: FoundationFirstPrompt?
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

    // R4 quarantine recovery payloads. `stage` (already declared above for
    // bip_coach_generation_progress) is reused by quarantine error events
    // ("list" | "restore"); the quarantine result/items are new.
    let items: [QuarantineFileWithDump]?
    let result: QuarantineRestoreResult?
    // R6 weekly ritual prompt payload (`weekly_ritual_prompt` event).
    let weeklyRitualPrompt: WeeklyRitualPrompt?
    let requestEmit: SidecarRequestEmit?

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

enum SidecarRequestEmitEvent: String, Codable, CaseIterable {
    case workspaceSetupStarted = "workspace_setup_started"
    case workspaceSetupFailed = "workspace_setup_failed"
    case workspaceSetupCompleted = "workspace_setup_completed"
}

struct SidecarRequestEmit: Decodable, Hashable {
    static let supportedSchemaVersion = 1

    let event: SidecarRequestEmitEvent
    let eventSchemaVersion: Int
    let properties: [String: SidecarRequestEmitJSONValue]

    init(
        event: SidecarRequestEmitEvent,
        eventSchemaVersion: Int = Self.supportedSchemaVersion,
        properties: [String: SidecarRequestEmitJSONValue] = [:]
    ) throws {
        guard eventSchemaVersion == Self.supportedSchemaVersion else {
            throw DecodingError.dataCorrupted(
                DecodingError.Context(
                    codingPath: [],
                    debugDescription: "Unsupported request_emit event_schema_version: \(eventSchemaVersion)"
                )
            )
        }
        self.event = event
        self.eventSchemaVersion = eventSchemaVersion
        self.properties = properties
    }

    var telemetryProperties: [String: Any] {
        var output = properties.mapValues { $0.anyValue }
        output["event_schema_version"] = eventSchemaVersion
        return output
    }

    private enum CodingKeys: String, CodingKey {
        case event
        case eventSchemaVersion = "event_schema_version"
        case properties
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        event = try container.decode(SidecarRequestEmitEvent.self, forKey: .event)
        eventSchemaVersion = try container.decode(Int.self, forKey: .eventSchemaVersion)
        guard eventSchemaVersion == Self.supportedSchemaVersion else {
            throw DecodingError.dataCorruptedError(
                forKey: .eventSchemaVersion,
                in: container,
                debugDescription: "Unsupported request_emit event_schema_version: \(eventSchemaVersion)"
            )
        }
        properties = try container.decodeIfPresent(
            [String: SidecarRequestEmitJSONValue].self,
            forKey: .properties
        ) ?? [:]
    }
}

enum SidecarRequestEmitJSONValue: Decodable, Hashable {
    case string(String)
    case int(Int)
    case double(Double)
    case bool(Bool)
    case object([String: SidecarRequestEmitJSONValue])
    case array([SidecarRequestEmitJSONValue])
    case null

    var anyValue: Any {
        switch self {
        case .string(let value):
            return value
        case .int(let value):
            return value
        case .double(let value):
            return value
        case .bool(let value):
            return value
        case .object(let value):
            return value.mapValues { $0.anyValue }
        case .array(let value):
            return value.map { $0.anyValue }
        case .null:
            return NSNull()
        }
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            self = .null
        } else if let value = try? container.decode(Bool.self) {
            self = .bool(value)
        } else if let value = try? container.decode(Int.self) {
            self = .int(value)
        } else if let value = try? container.decode(Double.self) {
            self = .double(value)
        } else if let value = try? container.decode(String.self) {
            self = .string(value)
        } else if let value = try? container.decode([String: SidecarRequestEmitJSONValue].self) {
            self = .object(value)
        } else if let value = try? container.decode([SidecarRequestEmitJSONValue].self) {
            self = .array(value)
        } else {
            throw DecodingError.dataCorruptedError(
                in: container,
                debugDescription: "Unsupported request_emit property value"
            )
        }
    }
}

struct WorkspaceSetupTelemetryGate {
    private var capturedStartedRequests = Set<SidecarRequestEmit>()
    private var didScanSucceed = false
    private var didReceiveFirstRealInput = false
    private var didEmitCompleted = false
    private var pendingCompleted: SidecarRequestEmit?

    mutating func requestsToCapture(afterReceiving request: SidecarRequestEmit) -> [SidecarRequestEmit] {
        switch request.event {
        case .workspaceSetupStarted:
            guard capturedStartedRequests.insert(request).inserted else { return [] }
            return [request]
        case .workspaceSetupFailed:
            return [request]
        case .workspaceSetupCompleted:
            guard !didEmitCompleted else { return [] }
            guard didScanSucceed && didReceiveFirstRealInput else {
                pendingCompleted = request
                return []
            }
            didEmitCompleted = true
            pendingCompleted = nil
            return [request]
        }
    }

    mutating func requestsToCaptureAfterWorkspaceScanSuccess() -> [SidecarRequestEmit] {
        didScanSucceed = true
        return flushCompletedIfReady()
    }

    mutating func requestsToCaptureAfterFirstRealInput() -> [SidecarRequestEmit] {
        didReceiveFirstRealInput = true
        return flushCompletedIfReady()
    }

    private mutating func flushCompletedIfReady() -> [SidecarRequestEmit] {
        guard !didEmitCompleted,
              didScanSucceed,
              didReceiveFirstRealInput,
              let request = pendingCompleted
        else { return [] }
        didEmitCompleted = true
        pendingCompleted = nil
        return [request]
    }
}

struct QuarantineRestoreResult: Decodable, Hashable {
    let restoredSessionId: String?
    let remainingInvalidCount: Int?
    let quarantinePath: String?
}

struct WeeklyRitualPrompt: Codable, Hashable {
    // R6 / CCG: surface payload for Day 7/14/21 ritual.
    let ritualKey: String
    let title: String
    let body: String
    let axes: [String]
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
        case day
        case firstPrompt
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
        // R4 quarantine recovery
        case items
        case result
        // R6 weekly ritual broadcast
        case weeklyRitualPrompt = "prompt"
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
        day = Self.decodeIfPresent(Int.self, from: container, forKey: .day)
        firstPrompt = Self.decodeIfPresent(FoundationFirstPrompt.self, from: container, forKey: .firstPrompt)
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
        items = Self.decodeIfPresent([QuarantineFileWithDump].self, from: container, forKey: .items)
        result = Self.decodeIfPresent(QuarantineRestoreResult.self, from: container, forKey: .result)
        weeklyRitualPrompt = Self.decodeIfPresent(WeeklyRitualPrompt.self, from: container, forKey: .weeklyRitualPrompt)
        requestEmit = type == "request_emit" ? try SidecarRequestEmit(from: decoder) : nil
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
