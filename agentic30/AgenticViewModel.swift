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

nonisolated struct GitHubCLIAuthStatus: Hashable, Sendable {
    enum State: String, Hashable, Sendable {
        case unknown
        case checking
        case connected
        case disconnected
        case missing
    }

    let state: State
    let detail: String
    let checkedAt: Date?

    static let unknown = GitHubCLIAuthStatus(
        state: .unknown,
        detail: "gh CLI 상태를 아직 확인하지 않았습니다.",
        checkedAt: nil
    )

    static func checking() -> GitHubCLIAuthStatus {
        GitHubCLIAuthStatus(
            state: .checking,
            detail: "gh auth status 확인 중...",
            checkedAt: Date()
        )
    }
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

/// Routing payload for the "office-hours question ready" local notification.
/// Identifier carries the structured-prompt requestId; userInfo carries the
/// session to reselect when the user clicks the banner.
struct OfficeHoursQuestionReadyNotification: Hashable, Sendable {
    static let sessionIdUserInfoKey = "agentic30.officeHours.questionReady.sessionId"
    static let identifierPrefix = "agentic30.office-hours.question-ready."

    let sessionId: String

    init(sessionId: String) {
        self.sessionId = sessionId
    }

    init?(notificationUserInfo userInfo: [AnyHashable: Any], identifier: String) {
        guard identifier.hasPrefix(Self.identifierPrefix),
              let sessionId = (userInfo[Self.sessionIdUserInfoKey] as? String)?
                  .trimmingCharacters(in: .whitespacesAndNewlines)
                  .nonEmpty else {
            return nil
        }
        self.sessionId = sessionId
    }

    static func notificationIdentifier(requestId: String) -> String {
        "\(identifierPrefix)\(requestId)"
    }

    static func removeDelivered(center: UNUserNotificationCenter = .current()) {
        let prefix = identifierPrefix
        center.getDeliveredNotifications { delivered in
            let identifiers = delivered
                .map(\.request.identifier)
                .filter { $0.hasPrefix(prefix) }
            guard !identifiers.isEmpty else { return }
            center.removeDeliveredNotifications(withIdentifiers: identifiers)
        }
    }
}

/// Pure decision authority for posting the question-ready notification, kept
/// free of UNUserNotificationCenter so the gate matrix is unit-testable.
enum OfficeHoursQuestionReadyNotifier {
    static func shouldNotify(
        stage: String,
        requestId: String?,
        title: String?,
        alreadyNotifiedRequestIds: Set<String>,
        isAppActive: Bool,
        isEnabled: Bool,
        isUITesting: Bool
    ) -> Bool {
        guard stage == "question_ready",
              let requestId, !requestId.isEmpty,
              let title, !title.isEmpty,
              !alreadyNotifiedRequestIds.contains(requestId),
              !isAppActive,
              isEnabled,
              !isUITesting else {
            return false
        }
        return true
    }
}

struct WorkspaceScanProgressSnapshot: Equatable {
    let progressText: String
    let stage: String?
    let stepIndex: Int?
    let totalSteps: Int?
    let etaSeconds: Int?
    let foundCount: Int?

    init(
        progressText: String,
        stage: String? = nil,
        stepIndex: Int? = nil,
        totalSteps: Int? = nil,
        etaSeconds: Int? = nil,
        foundCount: Int? = nil
    ) {
        self.progressText = progressText
        self.stage = stage
        self.stepIndex = stepIndex
        self.totalSteps = totalSteps
        self.etaSeconds = etaSeconds
        self.foundCount = foundCount
    }
}

enum AppUpdateResult: Equatable {
    case neverChecked
    case checking
    case latest
    case updateAvailable(version: String, displayVersion: String?)
    case downloaded(version: String, displayVersion: String?)
    case installing(version: String, displayVersion: String?)
    case blocked(String)
    case error(String)

    var statusText: String {
        switch self {
        case .neverChecked:
            return "Never checked"
        case .checking:
            return "Checking"
        case .latest:
            return "Latest"
        case .updateAvailable(let version, let displayVersion):
            return "Available \(Self.versionLabel(version: version, displayVersion: displayVersion))"
        case .downloaded(let version, let displayVersion):
            return "Downloaded \(Self.versionLabel(version: version, displayVersion: displayVersion))"
        case .installing(let version, let displayVersion):
            return "Installing \(Self.versionLabel(version: version, displayVersion: displayVersion))"
        case .blocked:
            return "Blocked"
        case .error:
            return "Error"
        }
    }

    var detailText: String {
        switch self {
        case .neverChecked:
            return "Sparkle has not completed an update check yet."
        case .checking:
            return "Checking the signed appcast feed."
        case .latest:
            return "The installed build is current."
        case .updateAvailable(let version, let displayVersion):
            return "A newer build is available: \(Self.versionLabel(version: version, displayVersion: displayVersion))."
        case .downloaded(let version, let displayVersion):
            return "Update \(Self.versionLabel(version: version, displayVersion: displayVersion)) is downloaded and ready for Sparkle's install flow."
        case .installing(let version, let displayVersion):
            return "Sparkle is preparing to install \(Self.versionLabel(version: version, displayVersion: displayVersion))."
        case .blocked(let reason):
            return reason
        case .error(let message):
            return message
        }
    }

    private static func versionLabel(version: String, displayVersion: String?) -> String {
        guard let displayVersion, !displayVersion.isEmpty, displayVersion != version else {
            return version
        }
        return "\(displayVersion) (\(version))"
    }
}

struct AppUpdateState: Equatable {
    var configured: Bool
    var feedURL: String
    var automaticChecksEnabled: Bool
    var automaticDownloadsEnabled: Bool
    var isSessionActive: Bool
    var lastCheckAt: Date?
    var lastResult: AppUpdateResult
    var latestVersion: String?
    var latestDisplayVersion: String?
    var lastError: String?

    static let defaultFeedURL = "https://updates.agentic30.app/appcast.xml"

    static let unavailable = AppUpdateState(
        configured: false,
        feedURL: defaultFeedURL,
        automaticChecksEnabled: false,
        automaticDownloadsEnabled: false,
        isSessionActive: false,
        lastCheckAt: nil,
        lastResult: .blocked("Release builds must include a Sparkle public EdDSA key."),
        latestVersion: nil,
        latestDisplayVersion: nil,
        lastError: nil
    )

    var currentVersionSummary: String {
        let info = Bundle.main.infoDictionary
        let version = info?["CFBundleShortVersionString"] as? String ?? "dev"
        let build = info?["CFBundleVersion"] as? String ?? "local"
        return "\(version) (\(build))"
    }

    var lastCheckSummary: String {
        guard let lastCheckAt else { return "Never" }
        return Self.dateFormatter.string(from: lastCheckAt)
    }

    private static let dateFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        formatter.timeStyle = .short
        return formatter
    }()
}

struct IntakeV2BootLogState: Equatable {
    struct Line: Identifiable, Equatable {
        let id: String
        let command: String
        let status: String?
        let isActive: Bool
    }

    enum ScanStage: String, Equatable {
        case local
        case verifying
        case composing
        case merged
        case failed

        nonisolated var title: String {
            switch self {
            case .local:
                return "폴더 신호 읽기"
            case .verifying:
                return "질문 근거 검증"
            case .composing:
                return "질문 세트 구성"
            case .merged:
                return "Day 1 준비 완료"
            case .failed:
                return "scan 중단"
            }
        }

        nonisolated var fallbackStepIndex: Int {
            switch self {
            case .local:
                return 1
            case .verifying:
                return 2
            case .composing, .merged, .failed:
                return 3
            }
        }

        nonisolated init?(rawStage: String?) {
            guard let value = rawStage?
                .trimmingCharacters(in: .whitespacesAndNewlines)
                .lowercased(),
                  !value.isEmpty else {
                return nil
            }
            self.init(rawValue: value)
        }
    }

    struct ScanPhase: Equatable {
        let stage: ScanStage
        let stepIndex: Int
        let totalSteps: Int
        let etaSeconds: Int?
        let foundCount: Int?

        var label: String {
            "\(stepIndex)/\(totalSteps)"
        }
    }

    let lines: [Line]
    let scanDidComplete: Bool
    let scanDidFail: Bool
    let foundArtifactCount: Int?
    let scanElapsed: IntakeV2BootLogElapsed?
    let scanPhase: ScanPhase

    static let empty = IntakeV2BootLogState(
        isConnected: false,
        workspaceRoot: "",
        diagnostics: nil,
        scanProgressLogs: [],
        scanDidComplete: false,
        scanError: nil,
        foundArtifactCount: nil,
        isScanning: false
    )

    init(
        isConnected: Bool,
        workspaceRoot: String,
        diagnostics: SidecarDiagnostics?,
        scanProgressLogs: [String],
        scanProgressSnapshots: [WorkspaceScanProgressSnapshot] = [],
        scanDidComplete: Bool,
        scanError: String?,
        foundArtifactCount: Int?,
        isScanning: Bool,
        scanStartedAt: Date? = nil,
        scanCompletedAt: Date? = nil
    ) {
        var nextLines: [Line] = []
        let didFail = scanError?.trimmingCharacters(in: .whitespacesAndNewlines).nonEmpty != nil

        if isConnected, diagnostics != nil {
            nextLines.append(Line(
                id: "sidecar.ready",
                command: "sidecar.ready",
                status: Self.readyStatus(workspaceRoot: workspaceRoot, diagnostics: diagnostics),
                isActive: false
            ))
        }

        nextLines.append(contentsOf: Self.displayProgressLines(
            scanProgressLogs,
            isActive: isScanning && !scanDidComplete
        ))

        if scanDidComplete {
            let trimmedError = scanError?.trimmingCharacters(in: .whitespacesAndNewlines).nonEmpty
            let command = trimmedError == nil ? "scan.result" : "scan.failed"
            let status = trimmedError
                .map { "✗ \($0)" }
                ?? "✓ \(foundArtifactCount ?? 0) artifacts verified"
            nextLines.append(Line(
                id: command,
                command: command,
                status: status,
                isActive: false
            ))
        }

        lines = Array(nextLines.suffix(6))
        self.scanDidComplete = scanDidComplete
        self.scanDidFail = didFail
        self.foundArtifactCount = foundArtifactCount
        self.scanPhase = Self.scanPhase(
            snapshots: scanProgressSnapshots,
            messages: scanProgressLogs,
            scanDidComplete: scanDidComplete,
            scanDidFail: didFail,
            foundArtifactCount: foundArtifactCount
        )
        if let scanStartedAt, !scanDidComplete {
            self.scanElapsed = IntakeV2BootLogElapsed(
                status: .running,
                startedAt: scanStartedAt,
                completedAt: nil
            )
        } else if let scanStartedAt, let scanCompletedAt {
            self.scanElapsed = IntakeV2BootLogElapsed(
                status: didFail ? .failed : .succeeded,
                startedAt: scanStartedAt,
                completedAt: scanCompletedAt
            )
        } else {
            self.scanElapsed = nil
        }
    }

    private nonisolated static func readyStatus(workspaceRoot: String, diagnostics: SidecarDiagnostics?) -> String {
        var parts: [String] = ["✓"]
        if let node = diagnostics?.runtime.node?.trimmingCharacters(in: .whitespacesAndNewlines),
           !node.isEmpty {
            parts.append(node)
        }
        if let pid = diagnostics?.runtime.pid {
            parts.append("pid \(pid)")
        }
        let workspaceName = (workspaceRoot as NSString).lastPathComponent
            .trimmingCharacters(in: .whitespacesAndNewlines)
        if !workspaceName.isEmpty {
            parts.append(workspaceName)
        }
        if parts.count == 1 {
            parts.append("connected")
        }
        return parts.joined(separator: " · ")
    }

    private struct DisplayProgressLine: Equatable {
        let command: String
        let status: String
    }

    private nonisolated static func displayProgressLines(_ messages: [String], isActive: Bool) -> [Line] {
        let normalized = messages.compactMap(displayProgressLine)
        guard !normalized.isEmpty else { return [] }

        var output: [Line] = []
        var indexByCommand: [String: Int] = [:]
        let activeNormalizedIndex = normalized.indices.last

        for (index, displayLine) in normalized.enumerated() {
            let lineIsActive = isActive && index == activeNormalizedIndex
            if lineIsActive {
                output = output.map {
                    Line(id: $0.id, command: $0.command, status: $0.status, isActive: false)
                }
            }
            let line = Line(
                id: displayLine.command,
                command: displayLine.command,
                status: displayLine.status,
                isActive: lineIsActive
            )
            if let existingIndex = indexByCommand[displayLine.command] {
                output[existingIndex] = line
            } else {
                indexByCommand[displayLine.command] = output.count
                output.append(line)
            }
        }

        return Array(output.suffix(4))
    }

    private nonisolated static func displayProgressLine(for rawMessage: String) -> DisplayProgressLine? {
        let message = rawMessage.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !message.isEmpty else { return nil }
        let lowercased = message.lowercased()

        if [
            "preparing workspace scan...",
            "waiting for workspace connection...",
            "workspace scan complete.",
            "workspace scan failed.",
        ].contains(lowercased) {
            return nil
        }

        if lowercased.contains("starting workspace scan")
            || lowercased.contains("checking common doc filenames locally") {
            return DisplayProgressLine(command: "scan.local", status: "checking workspace files")
        }

        if lowercased.contains("local candidate") {
            return DisplayProgressLine(command: "scan.verify", status: localCandidateStatus(from: message))
        }

        if lowercased.contains("no exact local matches")
            || lowercased.contains("asking agents") {
            return DisplayProgressLine(command: "scan.verify", status: "verifying context with agents")
        }

        if lowercased.contains("using read")
            || lowercased.contains("using grep")
            || lowercased.contains("using glob")
            || lowercased.contains("using ls") {
            return DisplayProgressLine(command: "scan.agent", status: "reading files")
        }

        if lowercased.contains(" finished (") {
            return DisplayProgressLine(command: "scan.agent", status: "agent check complete")
        }

        if lowercased.contains("scanning with")
            || lowercased.contains("claude")
            || lowercased.contains("codex")
            || lowercased.contains("gpt")
            || lowercased.contains("haiku") {
            return DisplayProgressLine(command: "scan.agent", status: "verifying context")
        }

        return DisplayProgressLine(
            command: "scan.verify",
            status: truncateDisplayStatus(message)
        )
    }

    private nonisolated static func localCandidateStatus(from message: String) -> String {
        let pattern = #"Found\s+(\d+)\s+local candidate"#
        if let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) {
            let range = NSRange(message.startIndex..<message.endIndex, in: message)
            if let match = regex.firstMatch(in: message, range: range),
               let countRange = Range(match.range(at: 1), in: message) {
                return "\(message[countRange]) local candidates found"
            }
        }
        return "local candidates found"
    }

    private nonisolated static func scanPhase(
        snapshots: [WorkspaceScanProgressSnapshot],
        messages: [String],
        scanDidComplete: Bool,
        scanDidFail: Bool,
        foundArtifactCount: Int?
    ) -> ScanPhase {
        if scanDidFail {
            let lastSnapshot = snapshots.last
            return scanPhase(
                stage: .failed,
                stepIndex: lastSnapshot?.stepIndex,
                totalSteps: lastSnapshot?.totalSteps,
                etaSeconds: nil,
                foundCount: lastSnapshot?.foundCount ?? foundArtifactCount
            )
        }

        if scanDidComplete {
            return ScanPhase(
                stage: .merged,
                stepIndex: 3,
                totalSteps: 3,
                etaSeconds: nil,
                foundCount: foundArtifactCount
            )
        }

        if let snapshot = snapshots.last {
            return scanPhase(
                stage: ScanStage(rawStage: snapshot.stage) ?? inferredStage(from: snapshot.progressText),
                stepIndex: snapshot.stepIndex,
                totalSteps: snapshot.totalSteps,
                etaSeconds: snapshot.etaSeconds,
                foundCount: snapshot.foundCount ?? foundArtifactCount
            )
        }

        return scanPhase(
            stage: messages.last.map(inferredStage(from:)) ?? .local,
            stepIndex: nil,
            totalSteps: nil,
            etaSeconds: nil,
            foundCount: foundArtifactCount
        )
    }

    private nonisolated static func scanPhase(
        stage: ScanStage,
        stepIndex: Int?,
        totalSteps: Int?,
        etaSeconds: Int?,
        foundCount: Int?
    ) -> ScanPhase {
        let total = max(1, totalSteps ?? 3)
        let step = min(max(1, stepIndex ?? stage.fallbackStepIndex), total)
        return ScanPhase(
            stage: stage,
            stepIndex: step,
            totalSteps: total,
            etaSeconds: etaSeconds,
            foundCount: foundCount
        )
    }

    private nonisolated static func inferredStage(from message: String) -> ScanStage {
        let lowercased = message.lowercased()
        if lowercased.contains("merged")
            || lowercased.contains("complete")
            || lowercased.contains("완료")
            || lowercased.contains("result") {
            return .merged
        }
        if lowercased.contains("fail")
            || lowercased.contains("error")
            || lowercased.contains("중단")
            || lowercased.contains("실패") {
            return .failed
        }
        if lowercased.contains("compos")
            || lowercased.contains("질문 세트")
            || lowercased.contains("선택지")
            || lowercased.contains("구성") {
            return .composing
        }
        if lowercased.contains("verify")
            || lowercased.contains("agent")
            || lowercased.contains("claude")
            || lowercased.contains("codex")
            || lowercased.contains("gemini")
            || lowercased.contains("검증") {
            return .verifying
        }
        return .local
    }

    private nonisolated static func truncateDisplayStatus(_ value: String, maxLength: Int = 44) -> String {
        let cleaned = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard cleaned.count > maxLength else { return cleaned }
        let endIndex = cleaned.index(cleaned.startIndex, offsetBy: maxLength - 1)
        return "\(cleaned[..<endIndex])…"
    }
}

struct Day1ScanWaitPresentation: Equatable {
    enum State: Equatable {
        case scanningNormal
        case scanningSlow
        case scanMergedReady
        case scanFailed
    }

    static let slowScanSeconds = 45

    let state: State
    let phase: IntakeV2BootLogState.ScanPhase
    let elapsedSeconds: Int?

    func headerTitle(questionCount: Int = 3) -> String {
        if canOpenDay1 {
            return "Day 1 질문 \(questionCount)개가 준비됐어요"
        }
        return "Day 1 질문 \(questionCount)개를 만드는 중"
    }

    func primaryCTATitle(questionCount: Int = 3) -> String {
        if canOpenDay1 {
            return "질문 \(questionCount)개 시작하기 →"
        }
        if let remainingSeconds = estimatedRemainingSeconds, remainingSeconds > 0 {
            return "\(remainingSeconds)초 남음 (예상)"
        }
        return "마무리 중…"
    }

    func primaryCTAAccessibilityLabel(questionCount: Int = 3) -> String {
        if canOpenDay1 {
            return primaryCTATitle(questionCount: questionCount).replacingOccurrences(of: " →", with: "")
        }
        if let remainingSeconds = estimatedRemainingSeconds, remainingSeconds > 0 {
            return "질문 \(questionCount)개 준비 중, \(remainingSeconds)초 남음 예상"
        }
        return "질문 \(questionCount)개 준비 중, 마무리 중"
    }

    var canOpenDay1: Bool {
        state == .scanMergedReady || state == .scanFailed
    }

    var showsSlowCopy: Bool {
        state == .scanningSlow
    }

    var estimatedRemainingSeconds: Int? {
        guard !canOpenDay1 else { return nil }
        return max(0, Self.slowScanSeconds - (elapsedSeconds ?? 0))
    }

    init(
        bootLogState: IntakeV2BootLogState,
        hasFolder: Bool,
        hasWorkspaceScanResult: Bool,
        now: Date
    ) {
        phase = bootLogState.scanPhase
        elapsedSeconds = bootLogState.scanElapsed?.elapsedSeconds(at: now)

        if !hasFolder {
            state = .scanMergedReady
            return
        }

        if bootLogState.scanDidFail {
            state = .scanFailed
            return
        }

        if hasWorkspaceScanResult || bootLogState.scanDidComplete {
            state = .scanMergedReady
            return
        }

        let elapsed = elapsedSeconds ?? 0
        if elapsed >= Self.slowScanSeconds {
            state = .scanningSlow
        } else {
            state = .scanningNormal
        }
    }
}

struct IntakeV2BootLogElapsed: Equatable {
    enum Status: Equatable {
        case running
        case succeeded
        case failed

        var chipPrefix: String {
            switch self {
            case .running: return "진행"
            case .succeeded: return "완료"
            case .failed: return "중단"
            }
        }

        var accessibilityPrefix: String {
            switch self {
            case .running: return "스캔 진행 시간"
            case .succeeded: return "스캔 완료 시간"
            case .failed: return "스캔 중단 시간"
            }
        }
    }

    let status: Status
    let startedAt: Date
    let completedAt: Date?

    var isRunning: Bool {
        status == .running
    }

    func chipText(at now: Date) -> String {
        "\(status.chipPrefix) \(Self.compactDurationText(seconds: elapsedSeconds(at: now)))"
    }

    func accessibilityLabel(at now: Date) -> String {
        "\(status.accessibilityPrefix) \(Self.spokenDurationText(seconds: elapsedSeconds(at: now)))"
    }

    func elapsedSeconds(at now: Date) -> Int {
        let end = completedAt ?? now
        return max(0, Int(end.timeIntervalSince(startedAt)))
    }

    static func compactDurationText(seconds: Int) -> String {
        let clamped = max(0, seconds)
        let hours = clamped / 3_600
        let minutes = (clamped % 3_600) / 60
        let remainingSeconds = clamped % 60
        if hours > 0 {
            return String(format: "%d:%02d:%02d", hours, minutes, remainingSeconds)
        }
        return String(format: "%02d:%02d", minutes, remainingSeconds)
    }

    static func spokenDurationText(seconds: Int) -> String {
        let clamped = max(0, seconds)
        let hours = clamped / 3_600
        let minutes = (clamped % 3_600) / 60
        let remainingSeconds = clamped % 60
        var parts: [String] = []
        if hours > 0 {
            parts.append("\(hours)시간")
        }
        if minutes > 0 {
            parts.append("\(minutes)분")
        }
        if remainingSeconds > 0 || parts.isEmpty {
            parts.append("\(remainingSeconds)초")
        }
        return parts.joined(separator: " ")
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
    /// First user response in a Foundation Day 0/2-7 session — the AI-driven
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

        /// Does this sub-workflow require the Claude provider? These routes
        /// lean on Claude Agent SDK tooling or Claude-specific prompt runners;
        /// the others run on whichever provider the session is using.
        var requiresClaudeProvider: Bool {
            switch self {
            case .analyzeAds, .bipDraft, .foundationSummary: return true
            case .officeHoursDocs, .monetizationAsk: return false
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

// MARK: - Day macro-loop progress (mirrors sidecar/day-progress-state.mjs)

enum DayStepStatus: String, Codable, Hashable {
    case done
    case active
    case pending
}

enum DayKind: String, Codable, Hashable {
    case day1
    case standard
}

/// Macro loop stages, gated by Day kind (IA: Day1=4 steps, Day2+=5 steps).
/// Mirrors DAY1_STEPS / STANDARD_STEPS in day-progress-state.mjs.
enum DayLoopSteps {
    static let day1: [String] = ["onboarding", "scan", "goal", "first_interview"]
    static let standard: [String] = ["scan", "retro", "goal", "interview", "execution"]

    // Day-1 intro stages auto-complete before Office Hours opens, so the macro
    // stepper + progress badges hide them — Day 1 surfaces only the stages the
    // user actively works (목표 → 첫 인터뷰). Day 2+ keeps the full loop visible.
    static let day1HiddenFromDisplay: Set<String> = ["onboarding", "scan"]

    static func kind(forDay day: Int) -> DayKind { day == 1 ? .day1 : .standard }

    static func ids(forDay day: Int, kind: DayKind) -> [String] {
        kind == .day1 ? day1 : standard
    }

    /// Stepper/progress-visible step ids — drops the Day-1 intro stages. Day 2+
    /// mirrors `ids` exactly.
    static func displayIds(forDay day: Int, kind: DayKind) -> [String] {
        let all = ids(forDay: day, kind: kind)
        guard kind == .day1 else { return all }
        return all.filter { !day1HiddenFromDisplay.contains($0) }
    }

    static func label(for stepId: String) -> String {
        switch stepId {
        case "onboarding": return "온보딩"
        case "scan": return "scan"
        case "retro": return "회고"
        case "goal": return "목표"
        case "interview": return "인터뷰"
        case "first_interview": return "첫 인터뷰"
        case "execution": return "실행"
        default: return stepId
        }
    }
}

struct DayRecord: Codable, Equatable, Hashable {
    let day: Int
    let kind: DayKind
    let steps: [String: DayStepStatus]
    let goalText: String
    let updatedAt: String

    init(
        day: Int,
        kind: DayKind,
        steps: [String: DayStepStatus],
        goalText: String = "",
        updatedAt: String = ""
    ) {
        self.day = day
        self.kind = kind
        self.steps = steps
        self.goalText = goalText
        self.updatedAt = updatedAt
    }

    /// Steps in canonical stepper order with resolved labels and statuses.
    /// Full data axis — keeps every stage (Day 1 = 4) for state + decoding parity.
    var orderedSteps: [(id: String, label: String, status: DayStepStatus)] {
        DayLoopSteps.ids(forDay: day, kind: kind).map { id in
            (id, DayLoopSteps.label(for: id), steps[id] ?? .pending)
        }
    }

    /// Stepper/progress-visible steps — hides the Day-1 intro stages (onboarding,
    /// scan) so Day 1 shows only 목표 → 첫 인터뷰. Day 2+ mirrors `orderedSteps`.
    var displaySteps: [(id: String, label: String, status: DayStepStatus)] {
        DayLoopSteps.displayIds(forDay: day, kind: kind).map { id in
            (id, DayLoopSteps.label(for: id), steps[id] ?? .pending)
        }
    }

    var totalCount: Int { DayLoopSteps.ids(forDay: day, kind: kind).count }
    var completedCount: Int { orderedSteps.filter { $0.status == .done }.count }
    var isComplete: Bool { completedCount == totalCount }

    /// Display-scoped counts (Day-1 intro stages excluded) for the stepper + sidebar badges.
    var displayTotalCount: Int { DayLoopSteps.displayIds(forDay: day, kind: kind).count }
    var displayCompletedCount: Int { displaySteps.filter { $0.status == .done }.count }
    var isDisplayComplete: Bool { displayCompletedCount == displayTotalCount }
}

/// Cycle#N office-hours memory summary — attached additively to `day_progress_state`.
/// Mirrors the sidecar `summarizeOfficeHoursMemory` payload (compiledTruth + open threads
/// + the abandoned-thread / costume lines). Tolerant decode: any missing field defaults.
struct OfficeHoursMemorySummary: Codable, Equatable, Hashable {
    let compiledTruth: String?
    let openThreads: [String]
    let abandonedThreads: [String]
    /// calibration-lite read-back ("예측 적중 N/M"); empty until a forecast is graded.
    let calibrationLine: String?
    /// The still-open forecast the commitment bar offers to grade at the next cycle close;
    /// empty when there's nothing pending.
    let pendingPrediction: String?
    /// "N일째 미룸" streak — trailing gate-held deferrals; 0 when the last close was a commit.
    let consecutiveDeferrals: Int

    init(
        compiledTruth: String? = nil,
        openThreads: [String] = [],
        abandonedThreads: [String] = [],
        calibrationLine: String? = nil,
        pendingPrediction: String? = nil,
        consecutiveDeferrals: Int = 0
    ) {
        self.compiledTruth = compiledTruth
        self.openThreads = openThreads
        self.abandonedThreads = abandonedThreads
        self.calibrationLine = calibrationLine
        self.pendingPrediction = pendingPrediction
        self.consecutiveDeferrals = consecutiveDeferrals
    }

    /// Whether there's anything worth surfacing in the retro banner — cold/stub brains
    /// return an empty summary, so the banner stays hidden and screenshots stay pixel-stable.
    /// pendingPrediction is intentionally excluded: it drives the commitment bar, not the banner.
    var hasContent: Bool {
        (compiledTruth.map { !$0.isEmpty } ?? false)
            || !openThreads.isEmpty
            || !abandonedThreads.isEmpty
            || (calibrationLine.map { !$0.isEmpty } ?? false)
    }

    /// Whether there's a still-open forecast to offer for grading at cycle close.
    var hasPendingPrediction: Bool { pendingPrediction.map { !$0.isEmpty } ?? false }

    enum CodingKeys: String, CodingKey {
        case compiledTruth, openThreads, abandonedThreads, calibrationLine, pendingPrediction, consecutiveDeferrals
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        compiledTruth = try c.decodeIfPresent(String.self, forKey: .compiledTruth)
        openThreads = (try c.decodeIfPresent([String].self, forKey: .openThreads)) ?? []
        abandonedThreads = (try c.decodeIfPresent([String].self, forKey: .abandonedThreads)) ?? []
        calibrationLine = try c.decodeIfPresent(String.self, forKey: .calibrationLine)
        pendingPrediction = try c.decodeIfPresent(String.self, forKey: .pendingPrediction)
        consecutiveDeferrals = (try c.decodeIfPresent(Int.self, forKey: .consecutiveDeferrals)) ?? 0
    }
}

struct OfficeHoursHistorySummary: Codable, Equatable, Hashable {
    struct Onboarding: Codable, Equatable, Hashable {
        let role: String?
        let timeBudget: String?
        let blocker: String?
        let records: String?
        let projectPath: String?
        let readSources: [String]
        let summary: String?

        enum CodingKeys: String, CodingKey {
            case role, timeBudget, blocker, records, projectPath, readSources, summary
        }

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            role = try c.decodeIfPresent(String.self, forKey: .role)
            timeBudget = try c.decodeIfPresent(String.self, forKey: .timeBudget)
            blocker = try c.decodeIfPresent(String.self, forKey: .blocker)
            records = try c.decodeIfPresent(String.self, forKey: .records)
            projectPath = try c.decodeIfPresent(String.self, forKey: .projectPath)
            readSources = try c.decodeIfPresent([String].self, forKey: .readSources) ?? []
            summary = try c.decodeIfPresent(String.self, forKey: .summary)
        }
    }

    struct DayRollup: Codable, Equatable, Hashable, Identifiable {
        var id: Int { day }
        let day: Int
        let summary: String
        let curriculumAnswerCount: Int
        let officeHoursTurnCount: Int
        let openCommitments: Int
        let metCommitments: Int
        let detailPath: String?
    }

    let schemaVersion: Int
    let day: Int?
    let onboarding: Onboarding?
    let dayRollup: [DayRollup]
    let curriculumAnswers: [String]
    let officeHoursTurns: [String]
    let openCommitments: [String]
    let metCommitments: [String]

    enum CodingKeys: String, CodingKey {
        case schemaVersion, day, onboarding, dayRollup
        case curriculumAnswers, officeHoursTurns, openCommitments, metCommitments
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        schemaVersion = try c.decodeIfPresent(Int.self, forKey: .schemaVersion) ?? 1
        day = try c.decodeIfPresent(Int.self, forKey: .day)
        onboarding = try c.decodeIfPresent(Onboarding.self, forKey: .onboarding)
        dayRollup = try c.decodeIfPresent([DayRollup].self, forKey: .dayRollup) ?? []
        curriculumAnswers = try c.decodeIfPresent([String].self, forKey: .curriculumAnswers) ?? []
        officeHoursTurns = try c.decodeIfPresent([String].self, forKey: .officeHoursTurns) ?? []
        openCommitments = try c.decodeIfPresent([String].self, forKey: .openCommitments) ?? []
        metCommitments = try c.decodeIfPresent([String].self, forKey: .metCommitments) ?? []
    }
}

struct CommitmentDraft: Codable, Equatable, Hashable {
    let customer: String
    let channel: String
    let message: String
    let expectedEvidenceKind: String
    let dueDay: Int?
    let confirmedByUser: Bool

    init(
        customer: String,
        channel: String,
        message: String,
        expectedEvidenceKind: String,
        dueDay: Int? = nil,
        confirmedByUser: Bool = true
    ) {
        self.customer = customer
        self.channel = channel
        self.message = message
        self.expectedEvidenceKind = expectedEvidenceKind
        self.dueDay = dueDay
        self.confirmedByUser = confirmedByUser
    }

    var payload: [String: Any] {
        var output: [String: Any] = [
            "customer": customer,
            "channel": channel,
            "message": message,
            "expectedEvidenceKind": expectedEvidenceKind,
            "confirmedByUser": confirmedByUser,
        ]
        if let dueDay { output["dueDay"] = dueDay }
        return output
    }
}

struct CommitmentEvidence: Codable, Equatable, Hashable {
    let kind: String
    let url: String
    let note: String
    let gradedCycle: Int?
    let gradedAt: String?
}

struct CommitmentRecord: Codable, Equatable, Hashable, Identifiable {
    let id: String
    let cycle: Int
    let day: Int
    let createdAt: String
    let text: String
    let customer: String
    let channel: String
    let message: String
    let expectedEvidenceKind: String
    let dueDay: Int?
    let confirmedByUser: Bool
    let status: String
    let evidence: CommitmentEvidence?
}

typealias CustomerEvidenceItem = CommitmentRecord

struct DayGoalSnapshot: Codable, Equatable, Hashable {
    let summary: String
    let customer: String
    let problem: String
    let validationAction: String
    let source: String

    init(
        summary: String = "",
        customer: String = "",
        problem: String = "",
        validationAction: String = "",
        source: String = ""
    ) {
        self.summary = summary
        self.customer = customer
        self.problem = problem
        self.validationAction = validationAction
        self.source = source
    }
}

struct EvidenceOSDayState: Codable, Equatable, Hashable {
    let day: Int
    let state: String
    let label: String
    let tone: String
    let openDebtCount: Int
    let provenEvidenceCount: Int
    let carryForwardAction: String?

    init(
        day: Int = 0,
        state: String = "not_started",
        label: String = "시작 안 함",
        tone: String = "muted",
        openDebtCount: Int = 0,
        provenEvidenceCount: Int = 0,
        carryForwardAction: String? = nil
    ) {
        self.day = day
        self.state = state
        self.label = label
        self.tone = tone
        self.openDebtCount = openDebtCount
        self.provenEvidenceCount = provenEvidenceCount
        self.carryForwardAction = carryForwardAction
    }
}

struct EvidenceOSSummary: Codable, Equatable, Hashable {
    let schemaVersion: Int
    let currentDay: Int?
    let openDebts: [CommitmentRecord]
    let overdueDebts: [CommitmentRecord]
    let provenEvidence: [CommitmentRecord]
    let dayStates: [String: EvidenceOSDayState]

    init(
        schemaVersion: Int = 1,
        currentDay: Int? = nil,
        openDebts: [CommitmentRecord] = [],
        overdueDebts: [CommitmentRecord] = [],
        provenEvidence: [CommitmentRecord] = [],
        dayStates: [String: EvidenceOSDayState] = [:]
    ) {
        self.schemaVersion = schemaVersion
        self.currentDay = currentDay
        self.openDebts = openDebts
        self.overdueDebts = overdueDebts
        self.provenEvidence = provenEvidence
        self.dayStates = dayStates
    }

    var hasOpenDebt: Bool { !openDebts.isEmpty || !overdueDebts.isEmpty }

    enum CodingKeys: String, CodingKey {
        case schemaVersion, currentDay, openDebts, overdueDebts, provenEvidence, dayStates
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        schemaVersion = try c.decodeIfPresent(Int.self, forKey: .schemaVersion) ?? 1
        currentDay = try c.decodeIfPresent(Int.self, forKey: .currentDay)
        openDebts = try c.decodeIfPresent([CommitmentRecord].self, forKey: .openDebts) ?? []
        overdueDebts = try c.decodeIfPresent([CommitmentRecord].self, forKey: .overdueDebts) ?? []
        provenEvidence = try c.decodeIfPresent([CommitmentRecord].self, forKey: .provenEvidence) ?? []
        dayStates = try c.decodeIfPresent([String: EvidenceOSDayState].self, forKey: .dayStates) ?? [:]
    }
}

struct DayReviewWorkArea: Codable, Equatable, Hashable, Identifiable {
    var id: String { name }
    let name: String
    let aiMinutes: Int
    let commitCount: Int
    let paths: [String]
}

struct DayReviewWorkSummary: Codable, Equatable, Hashable {
    let available: Bool
    let date: String
    let aiMinutes: Int
    let commitCount: Int
    let referenceEventCount: Int
    let hasWork: Bool
    let areas: [DayReviewWorkArea]
}

struct DayReview: Codable, Equatable, Hashable {
    let schemaVersion: Int
    let day: Int
    let status: String
    let verdictLabel: String
    let verdictTone: String
    let summary: String
    let customerEvidence: [CustomerEvidenceItem]
    let commitments: [CommitmentRecord]
    let nextCommitment: CommitmentRecord?
    let missing: [String]
    let goalSnapshot: DayGoalSnapshot?
    let missingReasons: [String]
    let carryForwardAction: String?
    let evidenceDebts: [CommitmentRecord]
    let work: DayReviewWorkSummary?

    enum CodingKeys: String, CodingKey {
        case schemaVersion, day, status, verdictLabel, verdictTone, summary
        case customerEvidence, commitments, nextCommitment, missing
        case goalSnapshot, missingReasons, carryForwardAction, evidenceDebts
        case work
    }

    init(
        schemaVersion: Int = 1,
        day: Int,
        status: String,
        verdictLabel: String,
        verdictTone: String,
        summary: String,
        customerEvidence: [CustomerEvidenceItem] = [],
        commitments: [CommitmentRecord] = [],
        nextCommitment: CommitmentRecord? = nil,
        missing: [String] = [],
        goalSnapshot: DayGoalSnapshot? = nil,
        missingReasons: [String] = [],
        carryForwardAction: String? = nil,
        evidenceDebts: [CommitmentRecord] = [],
        work: DayReviewWorkSummary? = nil
    ) {
        self.schemaVersion = schemaVersion
        self.day = day
        self.status = status
        self.verdictLabel = verdictLabel
        self.verdictTone = verdictTone
        self.summary = summary
        self.customerEvidence = customerEvidence
        self.commitments = commitments
        self.nextCommitment = nextCommitment
        self.missing = missing
        self.goalSnapshot = goalSnapshot
        self.missingReasons = missingReasons
        self.carryForwardAction = carryForwardAction
        self.evidenceDebts = evidenceDebts
        self.work = work
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        schemaVersion = try c.decodeIfPresent(Int.self, forKey: .schemaVersion) ?? 1
        day = try c.decodeIfPresent(Int.self, forKey: .day) ?? 0
        status = try c.decodeIfPresent(String.self, forKey: .status) ?? "customer_evidence_missing"
        verdictLabel = try c.decodeIfPresent(String.self, forKey: .verdictLabel) ?? "고객 증거 미기록"
        verdictTone = try c.decodeIfPresent(String.self, forKey: .verdictTone) ?? "muted"
        summary = try c.decodeIfPresent(String.self, forKey: .summary) ?? ""
        customerEvidence = try c.decodeIfPresent([CustomerEvidenceItem].self, forKey: .customerEvidence) ?? []
        commitments = try c.decodeIfPresent([CommitmentRecord].self, forKey: .commitments) ?? []
        nextCommitment = try c.decodeIfPresent(CommitmentRecord.self, forKey: .nextCommitment)
        missing = try c.decodeIfPresent([String].self, forKey: .missing) ?? []
        goalSnapshot = try c.decodeIfPresent(DayGoalSnapshot.self, forKey: .goalSnapshot)
        missingReasons = try c.decodeIfPresent([String].self, forKey: .missingReasons) ?? []
        carryForwardAction = try c.decodeIfPresent(String.self, forKey: .carryForwardAction)
        evidenceDebts = try c.decodeIfPresent([CommitmentRecord].self, forKey: .evidenceDebts) ?? []
        work = try c.decodeIfPresent(DayReviewWorkSummary.self, forKey: .work)
    }
}

struct DayProgress: Codable, Equatable, Hashable {
    let schemaVersion: Int
    let schema: String?
    let challengeStartedAt: String?
    let days: [String: DayRecord]

    init(
        schemaVersion: Int = 1,
        schema: String? = "agentic30.day_progress.v1",
        challengeStartedAt: String? = nil,
        days: [String: DayRecord] = [:]
    ) {
        self.schemaVersion = schemaVersion
        self.schema = schema
        self.challengeStartedAt = challengeStartedAt
        self.days = days
    }

    func record(forDay day: Int) -> DayRecord? { days[String(day)] }

    /// Today's record, or a synthesized all-pending default so the macro stepper and
    /// Day breadcrumb stay consistent with the sidebar's tolerant rendering before any
    /// activity exists for the day (sidecar only writes a record on scan/goal patch).
    func recordOrDefault(forDay day: Int) -> DayRecord {
        if let record = record(forDay: day) { return record }
        let kind = DayLoopSteps.kind(forDay: day)
        var steps: [String: DayStepStatus] = [:]
        for id in DayLoopSteps.ids(forDay: day, kind: kind) { steps[id] = .pending }
        return DayRecord(day: day, kind: kind, steps: steps)
    }

    /// Recorded days, newest first (past + today). Skipped days have no record.
    var recordedDaysDescending: [DayRecord] {
        days.values.sorted { $0.day > $1.day }
    }

    /// Elapsed-days-from-start + 1, on local calendar dates.
    /// Mirrors computeDayNumber() in day-progress-state.mjs.
    func currentDayNumber(now: Date = Date()) -> Int? {
        guard let start = Self.parseLocalDate(challengeStartedAt) else { return nil }
        let cal = Calendar.current
        let startDay = cal.startOfDay(for: start)
        let today = cal.startOfDay(for: now)
        let diff = cal.dateComponents([.day], from: startDay, to: today).day ?? 0
        return diff >= 0 ? diff + 1 : 1
    }

    private static func parseLocalDate(_ value: String?) -> Date? {
        guard let value, value.count >= 10 else { return nil }
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone.current
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.date(from: String(value.prefix(10)))
    }
}

enum Day1GoalType: String, Codable, CaseIterable, Hashable {
    // Declaration order drives the goal-card order (drafts = allCases.map),
    // arranged easy → hard.
    case buildProduct = "build_product"
    case getUsers = "get_users"
    case makeMoney = "make_money"

    var title: String {
        switch self {
        case .makeMoney: return "첫 매출 달성"
        case .getUsers: return "첫 100명 사용자 모으기"
        case .buildProduct: return "작동하는 첫 버전 출시"
        }
    }

    var promptHint: String {
        switch self {
        case .makeMoney:
            return "**돈이 실제로 움직일 조건**을 확인합니다."
        case .getUsers:
            return "가입, 추천, 출시 전 신청 등 **실제 유입 행동**을 확인합니다."
        case .buildProduct:
            return "사용자가 **핵심 흐름을 끝까지 완료하는지** 확인합니다."
        }
    }
}

enum Day1ProofSink: String, Codable, Hashable {
    case local
    case bipOptional = "bip_optional"
}

struct Day1GoalSelection: Codable, Equatable, Hashable {
    let schemaVersion: Int
    let schema: String?
    let goalType: Day1GoalType
    let goalText: String
    let customer: String
    let problem: String
    let validationAction: String
    let evidenceRefs: [String]
    let proofSink: Day1ProofSink
    let sourcePlanFingerprint: String
    let selectedAt: String

    init(
        schemaVersion: Int = 1,
        schema: String? = "agentic30.day1_goal.v1",
        goalType: Day1GoalType,
        goalText: String,
        customer: String,
        problem: String,
        validationAction: String,
        evidenceRefs: [String],
        proofSink: Day1ProofSink,
        sourcePlanFingerprint: String,
        selectedAt: String
    ) {
        self.schemaVersion = schemaVersion
        self.schema = schema
        self.goalType = goalType
        self.goalText = goalText.trimmingCharacters(in: .whitespacesAndNewlines)
        self.customer = customer.trimmingCharacters(in: .whitespacesAndNewlines)
        self.problem = problem.trimmingCharacters(in: .whitespacesAndNewlines)
        self.validationAction = validationAction.trimmingCharacters(in: .whitespacesAndNewlines)
        self.evidenceRefs = evidenceRefs
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
        self.proofSink = proofSink
        self.sourcePlanFingerprint = sourcePlanFingerprint
        self.selectedAt = selectedAt
    }

    var bridgePayload: [String: Any] {
        [
            "schemaVersion": schemaVersion,
            "schema": schema ?? "agentic30.day1_goal.v1",
            "goalType": goalType.rawValue,
            "goalText": goalText,
            "customer": customer,
            "problem": problem,
            "validationAction": validationAction,
            "evidenceRefs": evidenceRefs,
            "proofSink": proofSink.rawValue,
            "sourcePlanFingerprint": sourcePlanFingerprint,
            "selectedAt": selectedAt,
        ]
    }

    var officeHoursPurposeLine: String {
        "\(goalType.title) · \(Self.goalTypeSummary(goalType))"
    }

    var officeHoursProgressLine: String {
        "\(Self.customerSummary(customer)) · \(Self.problemSummary(problem))"
    }

    var officeHoursOutputLine: String {
        switch proofSink {
        case .bipOptional:
            return "공개 기록 저장 선택 가능 · 승인 전 게시/문서 없음"
        case .local:
            return "로컬 증거만 유지 · 승인 전 게시/문서 없음"
        }
    }

    private static func goalTypeSummary(_ goalType: Day1GoalType) -> String {
        switch goalType {
        case .makeMoney:
            return "지불 의향 검증"
        case .getUsers:
            return "유입/가입 행동 검증"
        case .buildProduct:
            return "제품 흐름 검증"
        }
    }

    private static func customerSummary(_ value: String) -> String {
        let text = normalizedDisplayText(value)
        let separators = [" 중 \"", " 중 “"]
        let withoutProblemClause = separators.reduce(text) { current, separator in
            guard let range = current.range(of: separator) else { return current }
            return String(current[..<range.lowerBound])
        }
        return conciseDisplayText(withoutProblemClause.trimmingCharacters(in: .whitespacesAndNewlines), maxLength: 48)
    }

    private static func problemSummary(_ value: String) -> String {
        let text = normalizedDisplayText(value)
        let lower = text.lowercased()
        if lower.contains("무엇을 팔아야")
            || lower.contains("누구에게 팔아야")
            || lower.contains("사람을 데려와야")
            || lower.contains("오늘 무엇을 검증") {
            return "팔 대상·유입·검증 기준 불명확"
        }
        return conciseDisplayText(text, maxLength: 56)
    }

    private static func normalizedDisplayText(_ value: String) -> String {
        value
            .replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: #"[.。．]+$"#, with: "", options: .regularExpression)
    }

    private static func conciseDisplayText(_ value: String, maxLength: Int) -> String {
        let text = normalizedDisplayText(value)
        guard text.count > maxLength else { return text }
        let cutIndex = text.index(text.startIndex, offsetBy: max(0, maxLength - 1))
        let truncated = String(text[..<cutIndex]).trimmingCharacters(in: .whitespacesAndNewlines)
        return "\(truncated)…"
    }
}

struct Day1GoalDraft: Identifiable, Hashable {
    let goalType: Day1GoalType
    let goalText: String
    let customer: String
    let problem: String
    let validationAction: String
    let evidenceRefs: [String]
    let proofSink: Day1ProofSink
    let sourcePlanFingerprint: String
    let isRecommended: Bool
    /// Style-aware dynamic emphasis spans for the detail rows (Stage 2). When
    /// empty, the rows render with the legacy static styling (plain row, or
    /// `strong` for the goal row), preserving the historical look.
    var customerEmphasis: [EmphasisSpan] = []
    var problemEmphasis: [EmphasisSpan] = []

    var id: String { goalType.rawValue }

    var proofSinkLabel: String {
        switch proofSink {
        case .local:
            return "로컬 저장"
        case .bipOptional:
            return "증거 저장 가능"
        }
    }

    func makeSelection(selectedAt: Date = Date()) -> Day1GoalSelection {
        Day1GoalSelection(
            goalType: goalType,
            goalText: goalText,
            customer: customer,
            problem: problem,
            validationAction: validationAction,
            evidenceRefs: evidenceRefs,
            proofSink: proofSink,
            sourcePlanFingerprint: sourcePlanFingerprint,
            selectedAt: ISO8601DateFormatter().string(from: selectedAt)
        )
    }
}

@MainActor
final class AgenticViewModel: ObservableObject {
    private static let macOnboardingIntroCompletedDefaultsKey = "agentic30.macOnboardingIntroCompleted"
    private static let macOnboardingIntakeOnlyCompletedDefaultsKey = "agentic30.macOnboardingIntakeOnlyCompleted"
    nonisolated static let selectedProviderDefaultsKey = "agentic30.selectedProvider"

    @Published private(set) var sessions: [ChatSession] = []
    @Published var selectedSessionID: String?
    @Published var selectedProvider: AgentProvider = AgenticViewModel.loadSelectedProvider() {
        didSet { Self.saveSelectedProvider(selectedProvider) }
    }
    @Published var draft = ""
    @Published private(set) var environment = SidecarEnvironment.placeholder
    @Published private(set) var sidecarDiagnostics: SidecarDiagnostics?
    @Published private(set) var appUpdateState: AppUpdateState = .unavailable
    @Published private(set) var connectionLabel = "실행 보조 앱 시작 중..."
    @Published private(set) var isConnected = false
    @Published private(set) var workspaceRoot = ""
    @Published private(set) var lastError: String?
    @Published private(set) var presentationPhase: AssistantPresentationPhase = .compact
    @Published private(set) var activeSurface: AgenticSurface = .assistantBubble
    @Published private(set) var isScanning = false
    @Published private(set) var scanProgressMessage = ""
    @Published private(set) var scanProgressLogs: [String] = []
    @Published private(set) var scanProgressSnapshots: [WorkspaceScanProgressSnapshot] = []
    @Published private(set) var scanStartedAt: Date?
    @Published private(set) var scanCompletedAt: Date?
    @Published var scanResult: WorkspaceScanResult?
    @Published private(set) var isCreatingDoc: String?
    @Published private(set) var docCreationLogs: [String] = []
    @Published var lastDocCreated: (type: String, path: String)?
    @Published private(set) var macAuthSession: MacAuthSession?
    @Published private(set) var macOnboardingStatus: MacOnboardingStatus = .idle
    @Published private(set) var macOnboardingIntroCompleted: Bool = false
    @Published private(set) var macOnboardingIntakeOnlyCompleted: Bool = false
    @Published private(set) var localDataResetGeneration: Int = 0
    @Published private(set) var onboardingContext: OnboardingContext?
    @Published private(set) var onboardingContextStatus: OnboardingContextSubmissionStatus = .idle
    @Published private(set) var bipCoach: BipCoachState?
    @Published private(set) var day1GoalSelection: Day1GoalSelection?
    @Published private(set) var day1GoalError: String?
    @Published private(set) var dayProgress: DayProgress?
    @Published private(set) var dayReviews: [String: DayReview] = [:]
    /// Cycle#N office-hours memory summary (compiled truth + open/abandoned threads),
    /// delivered additively on `day_progress_state`. Drives the retro read-back surface.
    @Published private(set) var officeHoursMemory: OfficeHoursMemorySummary?
    @Published private(set) var officeHoursHistory: OfficeHoursHistorySummary?
    @Published private(set) var evidenceOS: EvidenceOSSummary?
    @Published private(set) var officeHoursSourceGate: OfficeHoursSourceGate?
    /// Day 2+ daily digest briefing (`office_hours_daily_digest_result`): the sidecar
    /// broadcasts `status: "collecting"` before the (potentially slow) gh CLI + external
    /// MCP collection, then `status: "ready"` with the full digest payload.
    @Published private(set) var officeHoursDailyDigest: OfficeHoursDailyDigest?
    @Published private(set) var officeHoursDailyDigestCollecting = false
    /// Morning briefing (`morning_briefing_result`): session-less reuse of the Day 2+
    /// digest collectors, shaped by sidecar/morning-briefing.mjs for the briefing screen.
    @Published private(set) var morningBriefing: MorningBriefing?
    @Published private(set) var morningBriefingPrevious: MorningBriefing?
    @Published private(set) var morningBriefingCollecting = false
    /// Soft guidance from the interview gate: set when the sidecar withholds an interview
    /// close (needsCommitment) and asks for one next customer action; cleared on the next
    /// successful (non-blocked) day_progress_state so the nudge never lingers.
    @Published private(set) var commitmentGateMessage: String?
    /// The step the gate held (event.gatedStep), so the nudge is scoped to the matching
    /// commitment bar and never bleeds onto a different step's surface.
    @Published private(set) var commitmentGateStep: String?
    @Published private(set) var isBipCoachRefreshing = false
    @Published private(set) var isBipCoachGenerating = false
    @Published private(set) var isBipCoachCompleting = false
    @Published private(set) var bipReadiness: BipReadinessState?
    @Published private(set) var bipSetupGateMessage: String?
    @Published private(set) var missingBipLocalDocs: [String] = []
    @Published private(set) var missingBipExternalRequirements: [String] = []
    @Published private(set) var iddSetupStatus: String = "not_started"
    @Published private(set) var iddSetupComplete = false
    @Published private(set) var iddCurrentDocType: String?
    @Published private(set) var iddAmbiguityScore: Int?
    @Published private(set) var iddUnresolvedAssumptions: [String] = []
    @Published private(set) var iddDocOrder: [String] = []
    @Published private(set) var iddDocPreviews: [IddDocPreview] = []
    @Published private(set) var iddProviderRecovery: IddProviderRecovery?
    @Published private(set) var iddSetupError: IddSetupError?
    @Published private(set) var day1DocHandoffPendingDocType: String?
    @Published private(set) var day1DocHandoffError: String?
    @Published private(set) var bipTokenExpired: String?
    @Published private(set) var bipMissionProgress: BipMissionProgress?
    // F6: transient banner displayed in the Foundation surface when the IDD
    // rubric advances from one signal (e.g. 좁히기) to the next (e.g. 직접 만날
    // 사람). The sidecar stamps `generation.dimensionTransitioned` on follow-up
    // cards; on receipt the ViewModel sets the toast and a background task
    // clears it 3 seconds later.
    @Published private(set) var dimensionTransitionToast: DimensionTransitionToast?
    // R6 / CCG-Codex weekly ritual broadcast. The Mac surface for the actual
    // banner/modal is wired in a follow-up round; for now we receive the
    // prompt and expose it as @Published state so SwiftUI views can opt in.
    @Published private(set) var pendingWeeklyRitual: WeeklyRitualPrompt?
    @Published private(set) var providerAuthInProgress: AgentProvider?
    @Published private(set) var providerAuthMessage: String?
    @Published private(set) var sentPromptPreviews: [String: [PendingPromptPreview]] = [:]
    @Published private(set) var submittedStructuredPromptBySession: [String: StructuredPromptSubmissionState] = [:]
    @Published private(set) var structuredPromptDraftBySession: [String: StructuredPromptDraftState] = [:]
    @Published private(set) var sidecarOutputLogs: [String: [String]] = [:]
    @Published private(set) var officeHoursLiveStatusBySession: [String: OfficeHoursLiveStatus] = [:]
    @Published private(set) var bipNotificationOpenRequest: BipNotificationOpenRequest?
    @Published private(set) var startupQueuedAction: StartupQueuedAction?
    @Published private(set) var startupSessionAppearElapsedMs: Int?
    @Published private(set) var reviewDayDashboardViewModel: ReviewDayDashboardViewModel?
    @Published private(set) var newsMarketRadar: NewsMarketRadarSnapshot = .empty
    @Published private(set) var bipResearch: BipResearchSnapshot = .empty
    @Published private(set) var workHistory: WorkHistorySnapshot = .empty
    @Published private(set) var githubCliAuthStatus: GitHubCLIAuthStatus = .unknown
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
    private let disablesSidecarStartForTesting: Bool
    private let localDataResetter: @MainActor (Agentic30LocalDataResetOptions, [URL]) -> KeychainHelper.LocalDataResetReport
    private var startupSessionAppearStartedAt: Date?
    private var didRecordStartupSessionAppear = false

    struct WorkspaceScanResult: Codable, Equatable {
        let icp: String?
        let spec: String?
        let values: String?
        let designSystem: String?
        let adr: String?
        let goal: String?
        let docs: String?
        let sheet: String?
        let onboardingHypothesis: WorkspaceOnboardingHypothesis?
        let day1AlignmentPlan: Day1AlignmentPlan?
        let day1IcpPlan: Day1IcpPlan?
        let day1SituationSummary: Day1SituationSummary?
        let day1GoalSelection: Day1GoalSelection?
        let error: String?

        var foundArtifactPaths: [String] {
            [icp, spec, values, designSystem, adr, goal, docs, sheet]
                .compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines).nonEmpty }
        }

        var foundArtifactCount: Int {
            foundArtifactPaths.count
        }

        func replacing(
            day1AlignmentPlan: Day1AlignmentPlan? = nil,
            day1IcpPlan: Day1IcpPlan? = nil,
            day1SituationSummary: Day1SituationSummary? = nil,
            day1GoalSelection: Day1GoalSelection? = nil
        ) -> WorkspaceScanResult {
            WorkspaceScanResult(
                icp: icp,
                spec: spec,
                values: values,
                designSystem: designSystem,
                adr: adr,
                goal: goal,
                docs: docs,
                sheet: sheet,
                onboardingHypothesis: onboardingHypothesis,
                day1AlignmentPlan: day1AlignmentPlan ?? self.day1AlignmentPlan,
                day1IcpPlan: day1IcpPlan ?? self.day1IcpPlan,
                day1SituationSummary: day1SituationSummary ?? self.day1SituationSummary,
                day1GoalSelection: day1GoalSelection ?? self.day1GoalSelection,
                error: error
            )
        }

        func withDay1GoalSelection(_ selection: Day1GoalSelection?) -> WorkspaceScanResult {
            WorkspaceScanResult(
                icp: icp,
                spec: spec,
                values: values,
                designSystem: designSystem,
                adr: adr,
                goal: goal,
                docs: docs,
                sheet: sheet,
                onboardingHypothesis: onboardingHypothesis,
                day1AlignmentPlan: day1AlignmentPlan,
                day1IcpPlan: day1IcpPlan,
                day1SituationSummary: day1SituationSummary,
                day1GoalSelection: selection,
                error: error
            )
        }
    }

    struct PendingPromptPreview: Identifiable, Hashable {
        let id: String
        let content: String
        let createdAt: Date
    }

    private let sidecar: any SidecarTransport
    private var started = false
    private var revealWorkItem: DispatchWorkItem?
    private var activePresentationSessionID: String?
    private var revealedAssistantMessageID: String?
    private var lastBipRequestedAction: BipRequestedAction?
    private var pendingBipAuthRetry: BipRequestedAction?
    private var pendingWorkspaceScanRoot: String?
    private var pendingProjectContextRefresh: PendingProjectContextRefresh?
    private var attemptedStartupWorkspaceScanRecoveryRoots = Set<String>()
    #if DEBUG
    static var workspaceScanResultAppSupportURLOverrideForTesting: URL?
    #endif
    private var workspaceSetupTelemetryGate = WorkspaceSetupTelemetryGate()
    private var requestedWarmSessionIDs = Set<String>()
    private var requestedInitialBipGate = false
    private var requestedInitialBipMission = false
    private var activeOnboardingWorkspacePrefetchFingerprint: String?
    private var replacementSessionCreateInFlight = false
    private var officeHoursSessionCreateInFlight = false
    private var latestCurriculumQuestionReframesByKey: [String: CurriculumQuestionReframeRecord] = [:]
    private var lastNewsMarketRadarViewedAt: Date?
    private var lastBipResearchViewedAt: Date?
    #if DEBUG
    private var didEmitUITestingNewsMarketRadarEvents = false
    private var didEmitUITestingWorkHistoryEvents = false
    private var didEmitUITestingMorningBriefingEvents = false
    #endif
    /// Idempotency guard for the AI-driven Foundation Day 0/2-7 first prompt.
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

    private struct PendingProjectContextRefresh: Hashable {
        let completedDay: Int
        let unlockedDay: Int
        let workspaceRoot: String
    }

    /// Legacy global key used before the progress state became workspace-scoped.
    /// Only migrate it when the current workspace is explicit; never read it as
    /// active state for a fresh workspace.
    private static let kFoundationStartedAtKey = "agentic30.foundation.startedAt"
    private var foundationProgressStore: FoundationProgressStore?
    private let foundationCurriculumLifecycleController: FoundationCurriculumLifecycleController

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

    var foundationCurriculumPresentation: FoundationCurriculumPresentationViewModel {
        FoundationCurriculumPresentationViewModel(snapshot: foundationProgressState)
    }

    var foundationCurriculumPresentationDestination: FoundationCurriculumPresentationDestination {
        foundationCurriculumPresentation.destination
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

    @discardableResult
    func markFoundationDayCompleted(_ day: Int) -> FoundationDayCompletionSaveResult {
        ensureFoundationProgressStore()
        let normalizedDay = max(1, min(day, 30))
        let wasAlreadyCompleted = foundationProgressState.completedDays.contains(normalizedDay)
        let handler = FoundationDayCompletionSaveHandler(store: foundationProgressStore)
        let result = handler.saveDayCompletion(
            day,
            snapshot: foundationProgressState,
            workspaceRoot: WorkspaceSettings.resolvedURL().path
        )
        foundationProgressState = result.snapshot
        foundationStartedAt = result.snapshot.startedAt
        _ = foundationCurriculumLifecycleController.enterCompletedState(result.snapshot)
        recordNewsMarketRadarDayCompletionHelpIfNeeded(normalizedDay)
        if !wasAlreadyCompleted {
            enqueueProjectContextRefreshForCompletedDay(result)
        }
        return result
    }

    @discardableResult
    func advanceFromCompletedMission(_ mission: BipCoachMission) -> FoundationDayCompletionSaveResult? {
        guard let completedDay = mission.curriculumDay?.day,
              completedDay < 30 else {
            return nil
        }
        let result = markFoundationDayCompleted(completedDay)
        if result.unlockedDay == 2 {
            requestFoundationFirstPrompt(day: 2)
        }
        return result
    }

    private func enqueueProjectContextRefreshForCompletedDay(_ result: FoundationDayCompletionSaveResult) {
        let root = WorkspaceSettings.resolvedURL().path
        let refresh = PendingProjectContextRefresh(
            completedDay: result.completedDay,
            unlockedDay: result.unlockedDay,
            workspaceRoot: root
        )
        if !sendProjectContextRefresh(refresh) {
            pendingProjectContextRefresh = refresh
        }
    }

    @discardableResult
    private func sendProjectContextRefresh(_ refresh: PendingProjectContextRefresh) -> Bool {
        guard isConnected else { return false }
        return sidecar.send(payload: [
            "type": "project_context_refresh",
            "reason": "day_completed",
            "completedDay": refresh.completedDay,
            "unlockedDay": refresh.unlockedDay,
            "workspaceRoot": refresh.workspaceRoot,
            "preferredProvider": selectedProvider.rawValue,
        ])
    }

    private func flushPendingProjectContextRefreshIfNeeded() {
        guard let refresh = pendingProjectContextRefresh else { return }
        if sendProjectContextRefresh(refresh) {
            pendingProjectContextRefresh = nil
        }
    }

    func configureAppUpdates(
        configured: Bool,
        feedURL: String,
        automaticChecksEnabled: Bool,
        automaticDownloadsEnabled: Bool
    ) {
        appUpdateState.configured = configured
        appUpdateState.feedURL = feedURL
        appUpdateState.automaticChecksEnabled = automaticChecksEnabled
        appUpdateState.automaticDownloadsEnabled = automaticDownloadsEnabled
        if !configured {
            appUpdateState.isSessionActive = false
            appUpdateState.lastResult = .blocked("Release builds must include a Sparkle public EdDSA key.")
        }
    }

    func recordAppUpdateCheckStarted() {
        appUpdateState.lastCheckAt = Date()
        appUpdateState.isSessionActive = true
        appUpdateState.lastResult = .checking
        appUpdateState.lastError = nil
    }

    func recordAppUpdateAppcastLoaded(itemCount: Int) {
        appUpdateState.lastCheckAt = Date()
        appUpdateState.isSessionActive = true
        if appUpdateState.lastResult == .neverChecked {
            appUpdateState.lastResult = .checking
        }
    }

    func recordAppUpdateAvailable(version: String, displayVersion: String?) {
        appUpdateState.lastCheckAt = Date()
        appUpdateState.isSessionActive = true
        appUpdateState.latestVersion = version
        appUpdateState.latestDisplayVersion = displayVersion
        appUpdateState.lastError = nil
        appUpdateState.lastResult = .updateAvailable(version: version, displayVersion: displayVersion)
    }

    func recordAppUpdateDownloaded(version: String, displayVersion: String?) {
        appUpdateState.lastCheckAt = Date()
        appUpdateState.isSessionActive = true
        appUpdateState.latestVersion = version
        appUpdateState.latestDisplayVersion = displayVersion
        appUpdateState.lastError = nil
        appUpdateState.lastResult = .downloaded(version: version, displayVersion: displayVersion)
    }

    func recordAppUpdateInstalling(version: String, displayVersion: String?) {
        appUpdateState.lastCheckAt = Date()
        appUpdateState.isSessionActive = true
        appUpdateState.latestVersion = version
        appUpdateState.latestDisplayVersion = displayVersion
        appUpdateState.lastError = nil
        appUpdateState.lastResult = .installing(version: version, displayVersion: displayVersion)
    }

    func recordAppUpdateLatest() {
        appUpdateState.lastCheckAt = Date()
        appUpdateState.isSessionActive = false
        appUpdateState.lastError = nil
        appUpdateState.lastResult = .latest
    }

    func recordAppUpdateBlocked(_ reason: String) {
        appUpdateState.lastCheckAt = Date()
        appUpdateState.isSessionActive = false
        appUpdateState.lastError = reason
        appUpdateState.lastResult = .blocked(reason)
    }

    func recordAppUpdateError(_ message: String) {
        appUpdateState.lastCheckAt = Date()
        appUpdateState.isSessionActive = false
        appUpdateState.lastError = message
        appUpdateState.lastResult = .error(message)
    }

    func recordAppUpdateCycleFinished() {
        appUpdateState.isSessionActive = false
    }

    init(
        authSessionFactory: WebAuthenticationSessionFactory? = nil,
        onboardingContextOverride: OnboardingContext? = nil,
        disablesSidecarStartForTesting: Bool = false,
        foundationCurriculumLifecycleController: FoundationCurriculumLifecycleController? = nil,
        sidecar: (any SidecarTransport)? = nil,
        localDataResetter: @escaping @MainActor (Agentic30LocalDataResetOptions, [URL]) -> KeychainHelper.LocalDataResetReport = { options, workspaceURLs in
            let resetKeychainStorage: (() -> Void)? = CommandLine.arguments.contains("--ui-testing-skip-keychain-reset")
                ? {}
                : nil
            return Agentic30LocalDataResetter.reset(
                options: options,
                additionalWorkspaceURLs: workspaceURLs,
                resetKeychainStorage: resetKeychainStorage
            )
        },
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
        self.disablesSidecarStartForTesting = disablesSidecarStartForTesting
        self.foundationCurriculumLifecycleController = foundationCurriculumLifecycleController ?? FoundationCurriculumLifecycleController()
        self.sidecar = sidecar ?? SidecarBridge()
        self.localDataResetter = localDataResetter

        let arguments = CommandLine.arguments

        #if DEBUG
        if Self.isUITesting(arguments: arguments) {
            if arguments.contains("--ui-testing-reset-onboarding") {
                KeychainHelper.deleteMacAuthSession()
                Self.resetMacOnboardingState()
                WorkspaceSettings.clear()
            }
            Self.applyUITestingWorkspaceSeeds(arguments: arguments)
            macAuthSession = Self.makeUITestingMacAuthSession(arguments: arguments)
            onboardingContext = Self.makeUITestingOnboardingContext(arguments: arguments)
            macOnboardingIntroCompleted = onboardingContext != nil || Self.loadMacOnboardingIntroCompleted()
            macOnboardingIntakeOnlyCompleted = Self.loadMacOnboardingIntakeOnlyCompleted()
            applyUITestingIddSetupSeeds(arguments: arguments)
            if let seededDraft = Self.uiTestingArgumentValue("--ui-testing-seed-draft", arguments: arguments) {
                draft = seededDraft
            }
        } else if Self.isXCTestHost(arguments: arguments) {
            macAuthSession = nil
            onboardingContext = nil
            macOnboardingIntroCompleted = false
            macOnboardingIntakeOnlyCompleted = false
        } else {
            if arguments.contains("--ui-testing-reset-onboarding") {
                KeychainHelper.deleteMacAuthSession()
                Self.resetMacOnboardingState()
                WorkspaceSettings.clear()
            }
            macAuthSession = KeychainHelper.loadMacAuthSession()
            onboardingContext = Self.loadWorkspaceOnboardingContext()
            macOnboardingIntroCompleted = onboardingContext != nil || Self.loadMacOnboardingIntroCompleted()
            macOnboardingIntakeOnlyCompleted = Self.loadMacOnboardingIntakeOnlyCompleted()
        }
        #else
        if arguments.contains("--ui-testing-reset-onboarding") {
            KeychainHelper.deleteMacAuthSession()
            Self.resetMacOnboardingState()
            WorkspaceSettings.clear()
        }
        macAuthSession = KeychainHelper.loadMacAuthSession()
        onboardingContext = Self.loadWorkspaceOnboardingContext()
        macOnboardingIntroCompleted = onboardingContext != nil || Self.loadMacOnboardingIntroCompleted()
        macOnboardingIntakeOnlyCompleted = Self.loadMacOnboardingIntakeOnlyCompleted()
        #endif

        if let session = macAuthSession, session.shouldRefreshSoon {
            macOnboardingStatus = .refreshing
        }
        if let onboardingContextOverride {
            onboardingContext = onboardingContextOverride
            macOnboardingIntroCompleted = true
            macOnboardingIntakeOnlyCompleted = !WorkspaceSettings.hasExplicitWorkspace
        }

        restoreFoundationProgress(arguments: arguments)
        hydrateWorkspaceScanResultFromCacheIfAvailable()
    }

    struct StructuredPromptSubmission: Hashable {
        let question: String
        let selectedOptions: [String]
        let freeText: String
    }

    struct StructuredPromptSubmissionState: Hashable {
        let sessionId: String
        let requestId: String
        let responses: [StructuredPromptSubmission]
        let submittedAt: Date
        var progressStage: String? = nil
        var progressText: String? = nil
        var progressUpdatedAt: Date? = nil
        var elapsedMs: Int? = nil

        var answerSummary: String {
            let parts = responses.flatMap { response -> [String] in
                let selected = response.selectedOptions.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
                let freeText = response.freeText.trimmingCharacters(in: .whitespacesAndNewlines)
                return selected + (freeText.isEmpty ? [] : [freeText])
            }
            let summary = parts.filter { !$0.isEmpty }.joined(separator: ", ")
            guard !summary.isEmpty else { return "응답" }
            guard summary.count > 96 else { return summary }
            return String(summary.prefix(96)) + "..."
        }
    }

    struct StructuredPromptAnswerDraft: Hashable {
        var selectedOptions: Set<String> = []
        var freeText = ""
    }

    struct StructuredPromptDraftState: Hashable {
        let sessionId: String
        let requestId: String
        var answersByQuestionID: [String: StructuredPromptAnswerDraft]
    }

    private struct CurriculumQuestionReframeRecord: Hashable {
        let sessionId: String
        let requestId: String
        let questionId: String
        let reframedQuestion: String
    }

    var selectedSession: ChatSession? {
        sessions.first(where: { $0.id == selectedSessionID && $0.archivedAt == nil })
    }

    var pendingStructuredPrompt: StructuredPromptRequest? {
        selectedSession?.pendingUserInput?.isLegacyStaticIddQuestion == true
            ? nil
            : selectedSession?.pendingUserInput
    }

    var activeDay1HandoffPrompt: StructuredPromptRequest? {
        guard let prompt = pendingStructuredPrompt,
              prompt.generation?.mode == "day1_handoff",
              prompt.isAgentic30StructuredInput,
              let promptDocType = prompt.generation?.docType?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased(),
              !promptDocType.isEmpty else {
            return nil
        }
        if let pendingDocType = day1DocHandoffPendingDocType?.lowercased(), pendingDocType == promptDocType {
            return prompt
        }
        let expectedDocType = iddCurrentDocType?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard expectedDocType == nil || expectedDocType == promptDocType else {
            return nil
        }
        return prompt
    }

    private func isDay1HandoffSession(_ session: ChatSession?) -> Bool {
        guard let session else { return false }
        if session.runtime?.iddMode?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() == "day1_handoff" {
            return true
        }
        return session.pendingUserInput?.generation?.mode == "day1_handoff"
    }

    private func isDay1HandoffSession(id sessionID: String?) -> Bool {
        guard let sessionID else { return false }
        return isDay1HandoffSession(sessions.first(where: { $0.id == sessionID }))
    }

    func structuredPromptSubmissionState(for sessionId: String?) -> StructuredPromptSubmissionState? {
        guard let sessionId else { return nil }
        return submittedStructuredPromptBySession[sessionId]
    }

    func synchronizeStructuredPromptDrafts(with prompt: StructuredPromptRequest?) {
        guard let prompt else {
            structuredPromptDraftBySession = structuredPromptDraftBySession.filter { entry in
                sessions.contains { $0.id == entry.key && $0.pendingUserInput != nil }
            }
            return
        }

        if var existing = structuredPromptDraftBySession[prompt.sessionId],
           existing.requestId == prompt.requestId {
            for question in prompt.questions where existing.answersByQuestionID[question.id] == nil {
                existing.answersByQuestionID[question.id] = StructuredPromptAnswerDraft()
            }
            structuredPromptDraftBySession[prompt.sessionId] = existing
            return
        }

        structuredPromptDraftBySession[prompt.sessionId] = StructuredPromptDraftState(
            sessionId: prompt.sessionId,
            requestId: prompt.requestId,
            answersByQuestionID: Dictionary(
                uniqueKeysWithValues: prompt.questions.map { question in
                    (question.id, StructuredPromptAnswerDraft())
                }
            )
        )
    }

    func structuredPromptDraft(
        for question: StructuredPromptQuestion,
        in prompt: StructuredPromptRequest
    ) -> StructuredPromptAnswerDraft {
        return structuredPromptDraftBySession[prompt.sessionId]?.answersByQuestionID[question.id]
            ?? StructuredPromptAnswerDraft()
    }

    func updateStructuredPromptFreeText(
        _ text: String,
        for question: StructuredPromptQuestion,
        in prompt: StructuredPromptRequest
    ) {
        synchronizeStructuredPromptDrafts(with: prompt)
        var state = structuredPromptDraftBySession[prompt.sessionId] ?? StructuredPromptDraftState(
            sessionId: prompt.sessionId,
            requestId: prompt.requestId,
            answersByQuestionID: [:]
        )
        var draft = state.answersByQuestionID[question.id] ?? StructuredPromptAnswerDraft()
        draft.freeText = text
        state.answersByQuestionID[question.id] = draft
        structuredPromptDraftBySession[prompt.sessionId] = state
    }

    func toggleStructuredPromptOption(
        _ label: String,
        for question: StructuredPromptQuestion,
        in prompt: StructuredPromptRequest
    ) {
        synchronizeStructuredPromptDrafts(with: prompt)
        var state = structuredPromptDraftBySession[prompt.sessionId] ?? StructuredPromptDraftState(
            sessionId: prompt.sessionId,
            requestId: prompt.requestId,
            answersByQuestionID: [:]
        )
        var draft = state.answersByQuestionID[question.id] ?? StructuredPromptAnswerDraft()

        if question.multiSelect == true {
            if draft.selectedOptions.contains(label) {
                draft.selectedOptions.remove(label)
            } else {
                draft.selectedOptions.insert(label)
            }
        } else {
            draft.selectedOptions = [label]
        }

        state.answersByQuestionID[question.id] = draft
        structuredPromptDraftBySession[prompt.sessionId] = state
    }

    func canSubmitStructuredPrompt(_ prompt: StructuredPromptRequest) -> Bool {
        return prompt.questions.allSatisfy { question in
            let draft = structuredPromptDraft(for: question, in: prompt)
            return question.isSatisfied(
                selectedOptions: draft.selectedOptions,
                freeText: draft.freeText
            )
        }
    }

    func structuredPromptSubmissions(for prompt: StructuredPromptRequest) -> [StructuredPromptSubmission] {
        synchronizeStructuredPromptDrafts(with: prompt)
        return prompt.questions.map { question in
            let draft = structuredPromptDraft(for: question, in: prompt)
            let optionOrder = (question.options ?? []).map(\.label)
            let orderedSelections = optionOrder.filter { draft.selectedOptions.contains($0) }
            let customSelections = draft.selectedOptions
                .filter { !optionOrder.contains($0) }
                .sorted()
            return StructuredPromptSubmission(
                question: question.question,
                selectedOptions: orderedSelections + customSelections,
                freeText: draft.freeText.trimmingCharacters(in: .whitespacesAndNewlines)
            )
        }
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

    nonisolated static func loadSelectedProvider(defaults: UserDefaults = .standard) -> AgentProvider {
        guard let raw = defaults.string(forKey: selectedProviderDefaultsKey),
              let provider = AgentProvider(rawValue: raw) else {
            return .codex
        }
        return provider
    }

    nonisolated static func saveSelectedProvider(_ provider: AgentProvider, defaults: UserDefaults = .standard) {
        defaults.set(provider.rawValue, forKey: selectedProviderDefaultsKey)
    }

    private static func loadMacOnboardingIntroCompleted(defaults: UserDefaults = .standard) -> Bool {
        defaults.bool(forKey: macOnboardingIntroCompletedDefaultsKey)
    }

    private static func loadMacOnboardingIntakeOnlyCompleted(defaults: UserDefaults = .standard) -> Bool {
        defaults.bool(forKey: macOnboardingIntakeOnlyCompletedDefaultsKey)
    }

    private static func saveMacOnboardingIntroCompleted(defaults: UserDefaults = .standard) {
        defaults.set(true, forKey: macOnboardingIntroCompletedDefaultsKey)
    }

    private static func saveMacOnboardingIntakeOnlyCompleted(defaults: UserDefaults = .standard) {
        defaults.set(true, forKey: macOnboardingIntakeOnlyCompletedDefaultsKey)
    }

    private static func resetMacOnboardingIntroCompleted(defaults: UserDefaults = .standard) {
        defaults.removeObject(forKey: macOnboardingIntroCompletedDefaultsKey)
    }

    private static func resetMacOnboardingIntakeOnlyCompleted(defaults: UserDefaults = .standard) {
        defaults.removeObject(forKey: macOnboardingIntakeOnlyCompletedDefaultsKey)
    }

    private static func resetMacOnboardingState(defaults: UserDefaults = .standard) {
        resetMacOnboardingIntroCompleted(defaults: defaults)
        resetMacOnboardingIntakeOnlyCompleted(defaults: defaults)
        defaults.removeObject(forKey: IntakeV2Store.stateDefaultsKey)
        defaults.removeObject(forKey: IntakeV2SourceManager.sourcesDefaultsKey)
        defaults.synchronize()
    }

    private static func loadWorkspaceOnboardingContext() -> OnboardingContext? {
        guard WorkspaceSettings.hasExplicitWorkspace else { return nil }
        return WorkspaceMemoryStore.loadOnboardingContext(workspaceRoot: WorkspaceSettings.resolvedURL().path)
    }

    func requestBipNotificationOpen(
        intent: BipNotificationIntent,
        source: String = "notification_center"
    ) {
        PostHogTelemetry.capture("mac_bip_notification_opened", properties: [
            "intent": intent.rawValue,
            "source": source,
        ], authSession: macAuthSession)

        guard canStartSidecar else {
            bipNotificationOpenRequest = nil
            return
        }
        if let sessionId = bipCoach?.sessionId,
           sessions.contains(where: { $0.id == sessionId }) {
            selectedSessionID = sessionId
        }
        bipNotificationOpenRequest = BipNotificationOpenRequest(intent: intent)
    }

    nonisolated static let questionReadyNotificationDefaultsKey = "agentic30.officeHours.questionReadyNotification"

    /// Default-on toggle; absent key means enabled.
    var isQuestionReadyNotificationEnabled: Bool {
        UserDefaults.standard.object(forKey: Self.questionReadyNotificationDefaultsKey) as? Bool ?? true
    }

    func requestOfficeHoursQuestionReadyOpen(
        sessionId: String,
        source: String = "notification_center"
    ) {
        PostHogTelemetry.capture("mac_office_hours_question_ready_notification_opened", properties: [
            "source": source,
        ], authSession: macAuthSession)

        guard sessions.contains(where: { $0.id == sessionId }) else { return }
        selectedSessionID = sessionId
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

    func officeHoursLiveStatus(for sessionID: String?) -> OfficeHoursLiveStatus? {
        guard let sessionID else { return nil }
        return officeHoursLiveStatusBySession[sessionID]
    }

    var intakeV2BootLogState: IntakeV2BootLogState {
        IntakeV2BootLogState(
            isConnected: isConnected,
            workspaceRoot: workspaceRoot,
            diagnostics: sidecarDiagnostics,
            scanProgressLogs: scanProgressLogs,
            scanProgressSnapshots: scanProgressSnapshots,
            scanDidComplete: scanResult != nil,
            scanError: scanResult?.error,
            foundArtifactCount: scanResult?.foundArtifactCount,
            isScanning: isScanning,
            scanStartedAt: scanStartedAt,
            scanCompletedAt: scanCompletedAt
        )
    }

    var visibleBipCoach: BipCoachState? {
        guard let coach = bipCoach,
              let session = selectedSession,
              coach.sessionId == session.id else {
            return nil
        }
        return coach
    }

    var isDay1BipProofSinkAvailable: Bool {
        bipCoach?.isConfigured == true
    }

    var day1GoalDrafts: [Day1GoalDraft] {
        makeDay1GoalDrafts()
    }

    var isIddSetupBlockingWorkspace: Bool {
        !iddSetupComplete
    }

    func isMatchingFoundationPrompt(_ prompt: StructuredPromptRequest?) -> Bool {
        guard let prompt,
              prompt.isAgentic30StructuredInput,
              let promptDocType = prompt.generation?.docType?.lowercased(),
              !promptDocType.isEmpty else { return false }
        let expectedDocType = iddCurrentDocType?.lowercased()
        return expectedDocType == nil || expectedDocType == promptDocType
    }

    func isMismatchedFoundationPrompt(_ prompt: StructuredPromptRequest?) -> Bool {
        guard let prompt else { return false }
        return !isMatchingFoundationPrompt(prompt)
    }

    var requiresMacOnboarding: Bool {
        if usesInlineUITestStubResponses {
            return false
        }
        return !(WorkspaceSettings.hasExplicitWorkspace || macOnboardingIntakeOnlyCompleted)
            || onboardingContext == nil
            || !macOnboardingIntroCompleted
    }

    var canStartSidecar: Bool {
        !requiresMacOnboarding
    }

    var needsProjectWorkspace: Bool {
        !WorkspaceSettings.hasExplicitWorkspace
    }

    var needsOnboardingIntro: Bool {
        !macOnboardingIntroCompleted
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
        canStartSidecar && selectedSession == nil
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
        start(allowOnboardingPrefetch: false, anchorFoundation: true)
    }

    private func start(allowOnboardingPrefetch: Bool, anchorFoundation: Bool) {
        guard !started else { return }
        let canStartForOnboardingPrefetch = allowOnboardingPrefetch
            && WorkspaceSettings.hasExplicitWorkspace
            && onboardingContext != nil
        guard !requiresMacOnboarding || canStartForOnboardingPrefetch else {
            connectionLabel = needsOnboardingContext ? "Complete local setup" : "Choose a project workspace"
            isConnected = false
            return
        }
        hydrateWorkspaceRootFromSettingsIfAvailable()
        hydrateWorkspaceScanResultFromCacheIfAvailable()
        started = true
        PostHogTelemetry.capture("mac_view_model_started", authSession: macAuthSession)

        // First successful start past the onboarding gate anchors Day 1 of
        // the Foundation phase. Subsequent calls are no-ops, keeping the
        // counter monotonic across reconnects, sidecar restarts, and app
        // relaunches.
        if anchorFoundation {
            ensureFoundationStarted()
        }

        if disablesSidecarStartForTesting {
            connectionLabel = "실행 보조 앱이 단위 테스트에서 비활성화됨"
            isConnected = false
            return
        }

        if CommandLine.arguments.contains("--ui-testing-sidecar-failure") {
            workspaceRoot = WorkspaceSettings.resolvedURL().path
            connectionLabel = "실행 보조 앱 시작 실패(signal 6). Node.js 상태를 확인하세요."
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
                connectionLabel = "실행 보조 앱이 UI 테스트에서 비활성화됨"
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
        officeHoursSessionCreateInFlight = false
    }

    func reconnectSidecar() {
        guard canStartSidecar else { return }
        PostHogTelemetry.capture("mac_sidecar_reconnect_requested", authSession: macAuthSession)
        connectionLabel = "실행 보조 앱 다시 연결 중..."
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
        officeHoursSessionCreateInFlight = false
        start()
    }

    func showWorkspace() {
        guard !requiresMacOnboarding, selectedSession != nil else { return }
        activeSurface = .workspace
        PostHogTelemetry.capture("mac_workspace_surface_opened", authSession: macAuthSession)
    }

    func showAssistantBubble() {
        activeSurface = .assistantBubble
        PostHogTelemetry.capture("mac_assistant_surface_opened", authSession: macAuthSession)
    }

    @discardableResult
    func createSession(
        provider: AgentProvider? = nil,
        source: String? = nil,
        suppressBootstrapIntake: Bool = false,
        officeHoursDay: Int? = nil
    ) -> Bool {
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
        var payload: [String: Any] = [
            "type": "create_session",
            "provider": resolvedProvider.rawValue,
            "model": model,
        ]
        if let source = source?.trimmingCharacters(in: .whitespacesAndNewlines),
           !source.isEmpty {
            payload["source"] = source
        }
        if suppressBootstrapIntake || !iddSetupComplete {
            payload["suppressBootstrapIntake"] = true
        }
        if let officeHoursDay, officeHoursDay > 0 {
            payload["officeHoursDay"] = officeHoursDay
        }
        return sidecar.send(payload: payload)
    }

    @discardableResult
    func ensureOfficeHoursSession(forDay day: Int? = nil) -> Bool {
        let scopedDay = normalizedOfficeHoursDay(day)
        #if DEBUG
        // UI-testing seed installers are gated solely by their own CommandLine
        // arg (and are idempotent). They must run regardless of the requested
        // day: the day-scoped Office Hours screen always calls this with a
        // concrete `activeDay` (>= 1, see `activeOfficeHoursDay`), so a
        // `scopedDay == nil` precondition would orphan the seeds entirely.
        if installUITestingOfficeHoursCommitmentGateSessionIfNeeded() {
            return true
        }
        if installUITestingOfficeHoursRunningSessionIfNeeded() {
            return true
        }
        if installUITestingOfficeHoursStructuredPromptSessionIfNeeded() {
            return true
        }
        #endif
        if let scopedDay,
           let session = officeHoursSession(forDay: scopedDay) {
            selectedSessionID = session.id
            officeHoursSessionCreateInFlight = false
            return true
        }
        if let selectedSession, canUseSessionForOfficeHours(selectedSession, day: scopedDay) {
            officeHoursSessionCreateInFlight = false
            return true
        }
        guard isConnected else { return false }
        guard !officeHoursSessionCreateInFlight else { return false }

        officeHoursSessionCreateInFlight = true
        if createSession(
            provider: selectedProvider,
            source: scopedDay.map { "office_hours_screen_day_\($0)" } ?? "office_hours_screen",
            suppressBootstrapIntake: true,
            officeHoursDay: scopedDay
        ) {
            return false
        }
        officeHoursSessionCreateInFlight = false
        return false
    }

    func officeHoursSession(forDay day: Int) -> ChatSession? {
        let scopedDay = normalizedOfficeHoursDay(day)
        return sessions.first { session in
            guard session.archivedAt == nil else { return false }
            return canUseSessionForOfficeHours(session, day: scopedDay)
        }
    }

    func canUseSessionForOfficeHours(_ session: ChatSession, day: Int? = nil) -> Bool {
        let requestedDay = normalizedOfficeHoursDay(day)
        if let officeHours = session.runtime?.officeHours {
            if let requestedDay {
                if let runtimeDay = normalizedOfficeHoursDay(officeHours.day) {
                    guard runtimeDay == requestedDay else { return false }
                } else {
                    guard requestedDay == 1 else { return false }
                }
            }
            return true
        }
        if session.runtime?.officeHours?.active == true {
            return true
        }
        if let pendingUserInput = session.pendingUserInput {
            let looksLikeOfficeHours = pendingUserInput.title?.caseInsensitiveCompare("Office Hours") == .orderedSame
                || pendingUserInput.generation?.mode?.hasPrefix("office_hours") == true
            guard looksLikeOfficeHours else { return false }
            return requestedDay == nil || requestedDay == 1
        }
        if session.title.range(of: "Office Hours", options: [.caseInsensitive, .diacriticInsensitive]) != nil {
            if let requestedDay {
                if let titleDay = Self.officeHoursDay(fromTitle: session.title) {
                    return titleDay == requestedDay
                }
                return requestedDay == 1
            }
            return true
        }
        if requestedDay != nil { return false }
        if session.messages.isEmpty {
            return true
        }
        return session.messages.allSatisfy { message in
            guard message.role == .user else { return false }
            let content = message.content.trimmingCharacters(in: .whitespacesAndNewlines)
            return content.caseInsensitiveCompare(OfficeHoursTranscriptRow.syntheticStartPrompt) == .orderedSame
                || content.caseInsensitiveCompare(OfficeHoursTranscriptRow.legacySyntheticStartPrompt) == .orderedSame
        }
    }

    private func normalizedOfficeHoursDay(_ day: Int?) -> Int? {
        guard let day, day > 0 else { return nil }
        return day
    }

    private static func officeHoursDay(fromTitle title: String) -> Int? {
        guard let range = title.range(
            of: #"Day\s+(\d+)"#,
            options: [.regularExpression, .caseInsensitive]
        ) else { return nil }
        let match = String(title[range])
        guard let numberRange = match.range(of: #"\d+"#, options: .regularExpression) else { return nil }
        return Int(match[numberRange])
    }

    @discardableResult
    func ensureDay999OfficeHoursSession() -> Bool {
        ensureOfficeHoursSession(forDay: 999)
    }

    private func createReplacementSessionIfNeeded(source: String) {
        guard iddSetupComplete,
              sessions.allSatisfy({ $0.archivedAt != nil }),
              !replacementSessionCreateInFlight else { return }
        replacementSessionCreateInFlight = true
        if !createSession(provider: selectedProvider, source: source) {
            replacementSessionCreateInFlight = false
        }
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
        guard isConnected else {
            lastError = "실행 보조 앱이 연결되지 않았습니다."
            PostHogTelemetry.capture(
                "mac_session_archive_failed",
                properties: properties.merging(["reason": "sidecar_disconnected"]) { current, _ in current },
                authSession: macAuthSession
            )
            return
        }
        guard sidecar.send(payload: [
            "type": "archive_session",
            "sessionId": session.id,
            "archivedAt": Self.sidecarDateString(from: archivedAt),
        ]) else {
            lastError = "실행 보조 앱이 연결되지 않았습니다."
            PostHogTelemetry.capture(
                "mac_session_archive_failed",
                properties: properties.merging(["reason": "send_failed"]) { current, _ in current },
                authSession: macAuthSession
            )
            return
        }

        if let index = sessions.firstIndex(where: { $0.id == session.id }) {
            sessions[index].archivedAt = archivedAt
        }
        if selectedSessionID == session.id {
            selectedSessionID = sessions.first(where: { $0.id != session.id && $0.archivedAt == nil })?.id
        }
        refreshPresentationState()

        createReplacementSessionIfNeeded(source: "archive_last_visible_session")
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

    /// Switches the active AI provider used for new sessions, persists it, and
    /// immediately re-points the currently selected session at the new provider
    /// so a blocked session (e.g. office-hours after a usage limit) can retry on
    /// it without starting a new chat.
    func setActiveProvider(_ provider: AgentProvider) {
        guard provider != selectedProvider else { return }
        selectedProvider = provider // didSet persists the choice
        PostHogTelemetry.capture("mac_active_provider_changed", properties: [
            "provider": provider.rawValue,
        ], authSession: macAuthSession)
        guard let session = selectedSession, session.provider != provider else { return }
        sidecar.send(payload: [
            "type": "update_session_provider",
            "sessionId": session.id,
            "provider": provider.rawValue,
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
    ///   2. The first user message inside a Foundation Day 0/2-7 session is
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

    /// Day-1 situation card → goal concretization. Sends the chosen goal as a
    /// normal chat prompt through the existing pipeline (draft + sendPrompt).
    func submitDay1SituationGoal(_ text: String) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        draft = "Day 1에서 \"\(trimmed)\"을(를) 오늘 실행할 검증 행동으로 고르고 싶어. 한 문장 실행 계획으로 구체화해줘."
        sendPrompt()
    }

    @discardableResult
    func requestDay1GoalState(workspaceRoot explicitRoot: String? = nil) -> Bool {
        guard isConnected else { return false }
        let root = (explicitRoot ?? workspaceRoot).trimmingCharacters(in: .whitespacesAndNewlines)
        guard !root.isEmpty else { return false }
        return sidecar.send(payload: [
            "type": "day1_goal_get",
            "workspaceRoot": root,
        ])
    }

    @discardableResult
    func saveDay1GoalSelection(_ selection: Day1GoalSelection, workspaceRoot explicitRoot: String? = nil) -> Bool {
        let root = (explicitRoot ?? workspaceRoot).trimmingCharacters(in: .whitespacesAndNewlines)
        guard !root.isEmpty else {
            day1GoalError = "Workspace 경로가 비어 있습니다."
            return false
        }
        guard isConnected else {
            #if DEBUG
            if Self.isUITesting(arguments: CommandLine.arguments)
                && CommandLine.arguments.contains("--ui-testing-disable-sidecar") {
                applyDay1GoalSelectionLocally(selection, root: root)
                return true
            }
            #endif
            day1GoalError = "실행 보조 앱 연결 후 목표를 저장할 수 있습니다."
            return false
        }
        applyDay1GoalSelectionLocally(selection, root: root)
        let sent = sidecar.send(payload: [
            "type": "day1_goal_save",
            "workspaceRoot": root,
            "selection": selection.bridgePayload,
        ])
        if !sent {
            day1GoalError = "목표 저장 요청을 실행 보조 앱으로 보내지 못했습니다."
        }
        return sent
    }

    private func applyDay1GoalSelectionLocally(_ selection: Day1GoalSelection, root: String) {
        day1GoalError = nil
        day1GoalSelection = selection
        if let current = scanResult {
            let updated = current.withDay1GoalSelection(selection)
            scanResult = updated
            persistWorkspaceScanResultCache(updated, root: root)
        }
    }

    @discardableResult
    func saveDay1GoalDraft(_ draft: Day1GoalDraft, workspaceRoot explicitRoot: String? = nil) -> Bool {
        saveDay1GoalSelection(draft.makeSelection(), workspaceRoot: explicitRoot)
    }

    @discardableResult
    func requestDayProgress(workspaceRoot explicitRoot: String? = nil) -> Bool {
        guard isConnected else { return false }
        let root = (explicitRoot ?? workspaceRoot).trimmingCharacters(in: .whitespacesAndNewlines)
        guard !root.isEmpty else { return false }
        return sidecar.send(payload: [
            "type": "day_progress_get",
            "workspaceRoot": root,
        ])
    }

    @discardableResult
    func markDayStep(
        day: Int,
        stepId: String,
        status: DayStepStatus,
        goalText: String? = nil,
        commitmentText: String? = nil,
        commitment: CommitmentDraft? = nil,
        confession: String? = nil,
        predictionText: String? = nil,
        predictionVerdict: String? = nil,
        workspaceRoot explicitRoot: String? = nil
    ) -> Bool {
        guard isConnected else { return false }
        let root = (explicitRoot ?? workspaceRoot).trimmingCharacters(in: .whitespacesAndNewlines)
        guard !root.isEmpty else { return false }
        var payload: [String: Any] = [
            "type": "day_progress_patch",
            "workspaceRoot": root,
            "day": day,
            "stepId": stepId,
            "status": status.rawValue,
        ]
        if let goalText { payload["goalText"] = goalText }
        // Interview/first_interview completion gate (block-once-then-confession): the
        // sidecar requires one of these to mark an interview step done. The founder's
        // typed next customer action (user-origin), or the reason they're holding the gate.
        if let commitmentText, !commitmentText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            payload["commitmentText"] = commitmentText
        }
        if let commitment {
            payload["commitment"] = commitment.payload
        }
        if let confession, !confession.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            payload["confession"] = confession
        }
        // calibration-lite (additive): a forecast for this cycle, and/or a verdict on the
        // prior cycle's forecast. The sidecar grades-then-captures so the order is safe.
        if let predictionText, !predictionText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            payload["predictionText"] = predictionText
        }
        if let predictionVerdict, !predictionVerdict.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            payload["predictionVerdict"] = predictionVerdict
        }
        return sidecar.send(payload: payload)
    }

    @discardableResult
    func submitOfficeHoursCommitmentEvidence(
        commitmentId: String,
        kind: String,
        url: String,
        note: String,
        workspaceRoot explicitRoot: String? = nil
    ) -> Bool {
        guard isConnected else { return false }
        let root = (explicitRoot ?? workspaceRoot).trimmingCharacters(in: .whitespacesAndNewlines)
        let id = commitmentId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !root.isEmpty, !id.isEmpty else { return false }
        return sidecar.send(payload: [
            "type": "office_hours_commitment_evidence",
            "workspaceRoot": root,
            "commitmentId": id,
            "evidence": [
                "kind": kind.trimmingCharacters(in: .whitespacesAndNewlines),
                "url": url.trimmingCharacters(in: .whitespacesAndNewlines),
                "note": note.trimmingCharacters(in: .whitespacesAndNewlines),
            ],
        ])
    }

    @discardableResult
    func carryForwardOfficeHoursCommitment(
        commitmentId: String,
        workspaceRoot explicitRoot: String? = nil
    ) -> Bool {
        guard isConnected else { return false }
        let root = (explicitRoot ?? workspaceRoot).trimmingCharacters(in: .whitespacesAndNewlines)
        let id = commitmentId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !root.isEmpty, !id.isEmpty else { return false }
        var payload: [String: Any] = [
            "type": "office_hours_commitment_carry_forward",
            "workspaceRoot": root,
            "commitmentId": id,
        ]
        if let currentDay = dayProgress?.currentDayNumber() {
            payload["day"] = currentDay
        }
        return sidecar.send(payload: payload)
    }

    @discardableResult
    func abandonOfficeHoursCommitment(
        commitmentId: String,
        reason: String,
        workspaceRoot explicitRoot: String? = nil
    ) -> Bool {
        guard isConnected else { return false }
        let root = (explicitRoot ?? workspaceRoot).trimmingCharacters(in: .whitespacesAndNewlines)
        let id = commitmentId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !root.isEmpty, !id.isEmpty else { return false }
        return sidecar.send(payload: [
            "type": "office_hours_commitment_abandon",
            "workspaceRoot": root,
            "commitmentId": id,
            "reason": reason.trimmingCharacters(in: .whitespacesAndNewlines),
        ])
    }

    @discardableResult
    func startOfficeHours(
        sessionID: String,
        context: String,
        source: String = "office_hours_screen",
        day: Int? = nil,
        selectedSources: [String] = []
    ) -> Bool {
        let trimmedSessionID = sessionID.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedSessionID.isEmpty else { return false }
        guard isConnected else {
            lastError = "실행 보조 앱 연결 후 Office Hours를 시작할 수 있습니다."
            return false
        }

        let trimmedContext = context.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedSource = source.trimmingCharacters(in: .whitespacesAndNewlines).nonEmpty ?? "office_hours_screen"
        let scopedDay = normalizedOfficeHoursDay(day)
        let normalizedSelectedSources = selectedSources
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
            .sorted()
        PostHogTelemetry.capture(
            "mac_office_hours_start_requested",
            properties: [
                "session_id": trimmedSessionID,
                "context_length": trimmedContext.count,
                "source": trimmedSource,
                "day": scopedDay ?? 0,
                "selected_source_count": normalizedSelectedSources.count,
            ],
            authSession: macAuthSession
        )

        var payload: [String: Any] = [
            "type": "office_hours_start",
            "sessionId": trimmedSessionID,
            "source": trimmedSource,
            "visiblePrompt": "Office Hours",
            "context": trimmedContext,
        ]
        if let scopedDay {
            payload["day"] = scopedDay
        }
        if !normalizedSelectedSources.isEmpty {
            payload["selectedSources"] = normalizedSelectedSources
        }
        return sidecar.send(payload: payload)
    }

    @discardableResult
    func startDay999OfficeHours(sessionID: String, context: String) -> Bool {
        startOfficeHours(sessionID: sessionID, context: context, day: 999)
    }

    func refreshOfficeHoursSourceGate(
        sessionID: String? = nil,
        day: Int,
        selectedSources: [String] = []
    ) {
        guard isConnected else { return }
        guard let scopedDay = normalizedOfficeHoursDay(day), scopedDay >= 2 else { return }
        var payload: [String: Any] = [
            "type": "office_hours_source_gate_get",
            "day": scopedDay,
            "provider": selectedProvider.rawValue,
        ]
        let normalizedSessionID = sessionID?.trimmingCharacters(in: .whitespacesAndNewlines).nonEmpty
        if let normalizedSessionID {
            payload["sessionId"] = normalizedSessionID
        }
        let normalizedSelectedSources = selectedSources
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
            .sorted()
        if !normalizedSelectedSources.isEmpty {
            payload["selectedSources"] = normalizedSelectedSources
        }
        _ = sidecar.send(payload: payload)
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
            submitStructuredPrompt(sessionId: session.id, requestId: pendingUserInput.requestId, responses: responses)
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
    ///
    static func foundationFirstPromptKey(sessionId: String, day: Int) -> String {
        return "\(sessionId):day-\(day)"
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

    /// Sub-AC 2.4 — request the AI-driven Foundation Day 0/2-7 first prompt
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
        let resolvedSessionId = sessionId ?? currentBipCoachSessionID()
        guard let resolvedSessionId, !resolvedSessionId.isEmpty else { return }
        guard isConnected else { return }
        guard (0...7).contains(day), day != 1 else {
            PostHogTelemetry.capture(
                "mac_foundation_first_prompt_request_rejected",
                properties: [
                    "session_id": resolvedSessionId,
                    "day": day,
                    "reason": day == 1 ? "day1_opendesign_surface" : "day_out_of_range",
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
        let existingIndex = sessions[sessionIndex].messages.firstIndex(where: { $0.id == messageId })

        if existingIndex != nil {
            // Already injected and not a richer payload — keep guard, bail
            // without telemetry noise.
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

        // Insert at the head so the opener anchors the chat surface.
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
                "replaced_existing": false,
            ],
            authSession: macAuthSession
        )

        refreshPresentationState()
    }

    func submitStructuredPrompt(
        sessionId explicitSessionId: String? = nil,
        requestId: String,
        responses: [StructuredPromptSubmission]
    ) {
        let targetSessionId = explicitSessionId ?? selectedSessionID
        guard let targetSessionId,
              let session = sessions.first(where: { $0.id == targetSessionId && $0.archivedAt == nil }) else { return }
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
        #if DEBUG
        let promptBeforeLocalSubmission = session.pendingUserInput
        if completeUITestingOfficeHoursStructuredSubmissionIfNeeded(
            sessionId: session.id,
            requestId: requestId,
            promptBeforeLocalSubmission: promptBeforeLocalSubmission
        ) {
            return
        }
        #endif
        let payloadResponses = responses.map { response in
            [
                "question": response.question,
                "selectedOptions": response.selectedOptions,
                "freeText": response.freeText,
            ] as [String : Any]
        }
        markStructuredPromptSubmittedLocally(
            sessionId: session.id,
            requestId: requestId,
            responses: responses
        )
        #if DEBUG
        if completeUITestingDay1DocHandoffSubmissionIfNeeded(
            sessionId: session.id,
            requestId: requestId,
            promptBeforeLocalSubmission: promptBeforeLocalSubmission
        ) {
            return
        }
        #endif

        sidecar.send(payload: [
            "type": "submit_user_input",
            "sessionId": session.id,
            "requestId": requestId,
            "responses": payloadResponses,
        ])
    }

    private func markStructuredPromptSubmittedLocally(
        sessionId: String,
        requestId: String,
        responses: [StructuredPromptSubmission]
    ) {
        guard let index = sessions.firstIndex(where: { $0.id == sessionId }) else { return }
        guard sessions[index].pendingUserInput?.requestId == requestId else { return }

        submittedStructuredPromptBySession[sessionId] = StructuredPromptSubmissionState(
            sessionId: sessionId,
            requestId: requestId,
            responses: responses,
            submittedAt: .now
        )
        sessions[index].status = .running
        sessions[index].error = nil
        sessions[index].updatedAt = .now
    }

    func selectSession(_ sessionID: String) {
        selectedSessionID = sessionID
        refreshPresentationState()
        requestCodexWarmupIfNeeded()
    }

    func scanWorkspace(root: String) {
        guard !root.isEmpty else { return }
        beginWorkspaceScanTiming(reset: true)
        isScanning = true
        scanProgressMessage = isConnected ? "Preparing workspace scan..." : "Waiting for workspace connection..."
        scanProgressLogs = [scanProgressMessage]
        scanProgressSnapshots = [WorkspaceScanProgressSnapshot(progressText: scanProgressMessage)]
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
            "preferredProvider": selectedProvider.rawValue,
        ])
    }

    private func beginWorkspaceScanTiming(reset: Bool = false) {
        if reset || scanStartedAt == nil || scanCompletedAt != nil {
            scanStartedAt = .now
        }
        scanCompletedAt = nil
    }

    private func finishWorkspaceScanTiming() {
        guard scanStartedAt != nil else { return }
        scanCompletedAt = .now
    }

    private func clearWorkspaceScanTiming() {
        scanStartedAt = nil
        scanCompletedAt = nil
    }

    private var scanResultHasDay1Plan: Bool {
        scanResult?.day1AlignmentPlan != nil || scanResult?.day1IcpPlan != nil
    }

    private func makeDay1GoalDrafts() -> [Day1GoalDraft] {
        guard scanResult?.day1AlignmentPlan != nil
            || scanResult?.day1IcpPlan != nil
            || scanResult?.day1SituationSummary != nil
            || onboardingContext != nil else {
            return []
        }

        let customer = firstNonEmpty([
            day1GoalCustomerValue(from: scanResult?.day1AlignmentPlan),
            scanResult?.day1SituationSummary?.project.customer,
            scanResult?.day1IcpPlan?.signals.currentIcpGuess,
            scanResult?.onboardingHypothesis?.targetUser,
            onboardingContext?.businessDescription,
        ], fallback: "첫 고객 후보")
        let problem = firstNonEmpty([
            scanResult?.day1AlignmentPlan?.components.painPoint.statement,
            scanResult?.day1AlignmentPlan?.alignmentStatement.painPoint,
            scanResult?.day1SituationSummary?.project.problem,
            scanResult?.day1IcpPlan?.signals.problem,
            scanResult?.onboardingHypothesis?.problem,
            onboardingContext?.currentStage,
        ], fallback: "검증할 문제")
        let validationAction = firstNonEmpty([
            scanResult?.day1AlignmentPlan?.components.outcome.statement,
            scanResult?.day1AlignmentPlan?.alignmentStatement.outcome,
            scanResult?.day1SituationSummary?.actions.first?.label,
            scanResult?.onboardingHypothesis?.purpose,
            scanResult?.onboardingHypothesis?.goal,
            onboardingContext?.goal,
        ], fallback: "이번 주 확인할 행동")
        let evidenceRefs = day1GoalEvidenceRefs()
        let proofSink: Day1ProofSink = isDay1BipProofSinkAvailable ? .bipOptional : .local
        let recommended = recommendedDay1GoalType(
            customer: customer,
            problem: problem,
            validationAction: validationAction
        )
        let fingerprint = stableDay1GoalFingerprint(parts: [
            scanResult?.day1AlignmentPlan?.projectGoal,
            customer,
            problem,
            validationAction,
            evidenceRefs.joined(separator: "|"),
            onboardingContext?.goal,
        ])

        // Only attach emphasis when the displayed value is the exact alignment
        // component statement the sidecar generated spans for; otherwise the
        // value came from a fallback source with no matching spans and we keep
        // the legacy plain-row look (Stage 2 back-compat).
        let customerEmphasis = day1GoalRowEmphasis(
            component: scanResult?.day1AlignmentPlan?.components.icp,
            displayValue: customer
        )
        let problemEmphasis = day1GoalRowEmphasis(
            component: scanResult?.day1AlignmentPlan?.components.painPoint,
            displayValue: problem
        )

        return Day1GoalType.allCases.map { goalType in
            Day1GoalDraft(
                goalType: goalType,
                goalText: day1GoalText(goalType: goalType),
                customer: customer,
                problem: problem,
                validationAction: validationAction,
                evidenceRefs: evidenceRefs,
                proofSink: proofSink,
                sourcePlanFingerprint: fingerprint,
                isRecommended: goalType == recommended,
                customerEmphasis: customerEmphasis,
                problemEmphasis: problemEmphasis
            )
        }
    }

    /// Pull the sidecar-generated emphasis spans for a goal detail row, but only
    /// when the rendered value equals the component statement those spans were
    /// produced against (each span phrase is a substring of that statement). Any
    /// mismatch returns [] so the row keeps its legacy static styling.
    private func day1GoalRowEmphasis(
        component: Day1AlignmentComponent?,
        displayValue: String
    ) -> [EmphasisSpan] {
        guard let component,
              let emphasis = component.emphasis,
              !emphasis.isEmpty,
              component.statement.trimmingCharacters(in: .whitespacesAndNewlines)
                == displayValue.trimmingCharacters(in: .whitespacesAndNewlines)
        else {
            return []
        }
        return emphasis
    }

    private func day1GoalEvidenceRefs() -> [String] {
        var refs: [String] = []
        if let plan = scanResult?.day1AlignmentPlan {
            refs.append(contentsOf: plan.signals.evidenceRefs.map(\.path))
            refs.append(contentsOf: plan.components.icp.evidence)
            refs.append(contentsOf: plan.components.painPoint.evidence)
            refs.append(contentsOf: plan.components.outcome.evidence)
        }
        if let plan = scanResult?.day1IcpPlan {
            refs.append(contentsOf: plan.signals.evidenceRefs.map(\.path))
        }
        if let summary = scanResult?.day1SituationSummary {
            refs.append(contentsOf: summary.project.evidenceRefs)
            refs.append(contentsOf: summary.diagnosis.evidenceRefs)
            refs.append(contentsOf: summary.actions.flatMap(\.evidenceRefs))
        }
        if let hypothesis = scanResult?.onboardingHypothesis {
            refs.append(contentsOf: hypothesis.evidence ?? [])
        }
        let artifactRefs = scanResult?.foundArtifactPaths ?? []
        refs.append(contentsOf: artifactRefs)

        var seen = Set<String>()
        let uniqueRefs: [String] = refs
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
            .filter { ref in
                let key = ref.lowercased()
                if seen.contains(key) { return false }
                seen.insert(key)
                return true
            }
        return Array(uniqueRefs.prefix(12))
    }

    private func recommendedDay1GoalType(
        customer: String,
        problem: String,
        validationAction: String
    ) -> Day1GoalType {
        let haystack = [
            onboardingContext?.goal,
            onboardingContext?.currentStage,
            onboardingContext?.businessDescription,
            scanResult?.day1AlignmentPlan?.projectGoal,
            scanResult?.day1AlignmentPlan?.alignmentStatement.statement,
            customer,
            problem,
            validationAction,
        ]
            .compactMap { $0 }
            .joined(separator: " ")
            .lowercased()

        if haystack.range(of: #"매출|수익|유료|돈|결제|구매|계약|가격|revenue|paid|pay|purchase|sales|contract"#, options: .regularExpression) != nil {
            return .makeMoney
        }
        if haystack.range(of: #"유저|사용자|가입|마케팅|채널|유입|트래픽|waitlist|signup|acquisition|growth|marketing|users"#, options: .regularExpression) != nil {
            return .getUsers
        }
        return .buildProduct
    }

    private func day1GoalCustomerValue(from plan: Day1AlignmentPlan?) -> String? {
        guard let plan else { return nil }
        return [
            plan.signalDigest?.rows.first(where: { $0.key == "icp" })?.value,
            plan.signals.currentIcpGuess,
            plan.signals.likelyUsers.first,
            plan.alignmentStatement.icp,
            plan.components.icp.statement,
        ]
            .compactMap(day1GoalCustomerCandidate)
            .first
    }

    private func day1GoalCustomerCandidate(_ value: String?) -> String? {
        guard let value else { return nil }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty,
              !day1GoalCustomerLooksLikeDocumentReference(trimmed)
        else {
            return nil
        }
        return trimmed
    }

    private func day1GoalCustomerLooksLikeDocumentReference(_ value: String) -> Bool {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return false }
        if trimmed.range(
            of: #"\[[^\]]*\.md[^\]]*\]\([^)]+\)"#,
            options: [.regularExpression, .caseInsensitive]
        ) != nil {
            return true
        }
        if trimmed.range(
            of: #"^(?:\./)?(?:docs/)?[a-z0-9._/-]+\.md(?:#[a-z0-9._-]+)?$"#,
            options: [.regularExpression, .caseInsensitive]
        ) != nil {
            return true
        }
        return trimmed.range(
            of: #"\.md\b"#,
            options: [.regularExpression, .caseInsensitive]
        ) != nil && trimmed.range(
            of: #"(문서|매핑|루브릭|reference|참고|company|회사|source|docs?|alignment)"#,
            options: [.regularExpression, .caseInsensitive]
        ) != nil
    }

    /// 목표 행은 30일 안에 달성할 정량 타깃 한 문장만 보여준다. 고객·문제는 같은
    /// 테이블의 별도 행에 이미 있으므로 반복하지 않는다 — sidecar의
    /// `DAY1_GOAL_TEXTS`(day1-goal-state.mjs)와 동일한 문구를 유지해야 한다.
    private func day1GoalText(goalType: Day1GoalType) -> String {
        switch goalType {
        case .makeMoney:
            return "30일 안에 첫 유료 결제 1건을 만든다."
        case .getUsers:
            return "30일 안에 가입자 100명을 모은다."
        case .buildProduct:
            return "30일 안에 핵심 흐름 완주율 10%를 달성한다."
        }
    }

    private func firstNonEmpty(_ values: [String?], fallback: String) -> String {
        firstNonEmptyCandidate(values) ?? fallback
    }

    private func firstNonEmptyCandidate(_ values: [String?]) -> String? {
        values
            .compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines) }
            .first(where: { !$0.isEmpty })
    }

    private func stableDay1GoalFingerprint(parts: [String?]) -> String {
        var hash: UInt64 = 14_695_981_039_346_656_037
        let text = parts
            .compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines) }
            .joined(separator: "\u{1f}")
        for byte in text.utf8 {
            hash ^= UInt64(byte)
            hash &*= 1_099_511_628_211
        }
        return String(format: "%016llx", hash)
    }

    private func workspaceScanResultStore(for root: String) -> WorkspaceScanResultStore {
        #if DEBUG
        if let appSupportURL = Self.workspaceScanResultAppSupportURLOverrideForTesting {
            return WorkspaceScanResultStore(workspaceRoot: root, appSupportURL: appSupportURL)
        }
        #endif
        return WorkspaceScanResultStore(workspaceRoot: root)
    }

    private func hydrateWorkspaceScanResultFromCacheIfAvailable() {
        guard !requiresMacOnboarding, WorkspaceSettings.hasExplicitWorkspace else { return }
        let root = WorkspaceSettings.resolvedURL().path.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !root.isEmpty else { return }
        guard let cached = workspaceScanResultStore(for: root).load() else { return }
        workspaceRoot = root
        clearWorkspaceScanTiming()
        scanResult = cached
        day1GoalSelection = cached.day1GoalSelection
    }

    private func persistWorkspaceScanResultCache(_ result: WorkspaceScanResult, root explicitRoot: String? = nil) {
        guard result.error == nil else { return }
        let root = (explicitRoot ?? workspaceRoot).trimmingCharacters(in: .whitespacesAndNewlines)
        guard !root.isEmpty else { return }
        workspaceScanResultStore(for: root).save(result)
    }

    private func requestWorkspaceScanRecoveryIfNeeded() {
        guard !requiresMacOnboarding,
              WorkspaceSettings.hasExplicitWorkspace,
              selectedFoundationDay == 1,
              !isScanning,
              !scanResultHasDay1Plan else {
            return
        }
        let root = WorkspaceSettings.resolvedURL().path.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !root.isEmpty, !attemptedStartupWorkspaceScanRecoveryRoots.contains(root) else { return }
        attemptedStartupWorkspaceScanRecoveryRoots.insert(root)
        scanWorkspace(root: root)
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

    private func setScanProgress(
        _ text: String,
        reset: Bool = false,
        stage: String? = nil,
        stepIndex: Int? = nil,
        totalSteps: Int? = nil,
        etaSeconds: Int? = nil,
        foundCount: Int? = nil
    ) {
        let message = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !message.isEmpty else { return }
        scanProgressMessage = message
        let snapshot = WorkspaceScanProgressSnapshot(
            progressText: message,
            stage: stage,
            stepIndex: stepIndex,
            totalSteps: totalSteps,
            etaSeconds: etaSeconds,
            foundCount: foundCount
        )
        if reset {
            scanProgressLogs = [message]
            scanProgressSnapshots = [snapshot]
            return
        }
        if scanProgressLogs.last != message {
            scanProgressLogs.append(message)
        }
        if scanProgressSnapshots.last != snapshot {
            scanProgressSnapshots.append(snapshot)
        }
        if scanProgressLogs.count > 24 {
            scanProgressLogs = Array(scanProgressLogs.suffix(24))
        }
        if scanProgressSnapshots.count > 24 {
            scanProgressSnapshots = Array(scanProgressSnapshots.suffix(24))
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

    func refreshGitHubCliStatus() {
        githubCliAuthStatus = .checking()
        let root = workspaceRoot.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            ? WorkspaceSettings.resolvedURL().path
            : workspaceRoot
        Task { [weak self, root] in
            let status = await Task.detached(priority: .userInitiated) {
                Self.detectGitHubCliAuthStatus(workspaceRoot: root)
            }.value
            await MainActor.run {
                self?.githubCliAuthStatus = status
            }
        }
    }

    func openGitHubCliLoginInTerminal() {
        githubCliAuthStatus = GitHubCLIAuthStatus(
            state: .disconnected,
            detail: "Terminal에서 gh auth login을 시작했습니다. 완료 후 상태 확인을 눌러주세요.",
            checkedAt: Date()
        )
        lastError = nil

        let root = workspaceRoot.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            ? WorkspaceSettings.resolvedURL().path
            : workspaceRoot
        let resolvedRoot = root.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? NSHomeDirectory() : root
        let command = "cd \(Self.shellQuoted(resolvedRoot)); gh auth login"
        let script = """
        tell application "Terminal"
            activate
            do script \(Self.appleScriptLiteral(command))
        end tell
        """

        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
        process.arguments = ["-e", script]

        do {
            try process.run()
            PostHogTelemetry.capture("mac_github_cli_auth_terminal_opened", authSession: macAuthSession)
        } catch {
            githubCliAuthStatus = GitHubCLIAuthStatus(
                state: .disconnected,
                detail: "gh auth login을 열 수 없습니다: \(error.localizedDescription)",
                checkedAt: Date()
            )
            lastError = githubCliAuthStatus.detail
            PostHogTelemetry.captureException(error, properties: [
                "component": "agentic_view_model",
                "operation": "open_github_cli_auth_terminal",
            ], authSession: macAuthSession)
        }
    }

    func openGitHubCliInstallInTerminal() {
        githubCliAuthStatus = GitHubCLIAuthStatus(
            state: .missing,
            detail: "Terminal에서 GitHub CLI 설치 후 gh auth login을 이어서 실행합니다.",
            checkedAt: Date()
        )
        lastError = nil

        let command = "brew install gh && gh auth login"
        let script = """
        tell application "Terminal"
            activate
            do script \(Self.appleScriptLiteral(command))
        end tell
        """

        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
        process.arguments = ["-e", script]

        do {
            try process.run()
            PostHogTelemetry.capture("mac_github_cli_brew_install_started", authSession: macAuthSession)
        } catch {
            githubCliAuthStatus = GitHubCLIAuthStatus(
                state: .missing,
                detail: "GitHub CLI 설치 명령을 열 수 없습니다: \(error.localizedDescription)",
                checkedAt: Date()
            )
            lastError = githubCliAuthStatus.detail
            PostHogTelemetry.captureException(error, properties: [
                "component": "agentic_view_model",
                "operation": "open_github_cli_brew_install_terminal",
            ], authSession: macAuthSession)
        }
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

    func openGeminiAdcLoginInTerminal() {
        providerAuthInProgress = .gemini
        providerAuthMessage = "Google ADC 로그인을 Terminal에서 시작했습니다 (gcloud auth application-default login)."
        lastError = nil

        let root = workspaceRoot.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            ? NSHomeDirectory()
            : workspaceRoot
        let command = "cd \(Self.shellQuoted(root)); gcloud auth application-default login"
        let script = """
        tell application "Terminal"
            activate
            do script \(Self.appleScriptLiteral(command))
        end tell
        """

        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
        process.arguments = ["-e", script]

        do {
            try process.run()
            PostHogTelemetry.capture("mac_provider_auth_terminal_opened", properties: [
                "provider": AgentProvider.gemini.rawValue,
            ], authSession: macAuthSession)
        } catch {
            providerAuthInProgress = nil
            providerAuthMessage = "Gemini auth를 열 수 없습니다: \(error.localizedDescription)"
            lastError = providerAuthMessage
            PostHogTelemetry.captureException(error, properties: [
                "component": "agentic_view_model",
                "operation": "open_gemini_auth_terminal",
            ], authSession: macAuthSession)
        }
    }

    /// Returns true if Terminal was launched, false if gcloud is missing on PATH (caller should
    /// surface a recovery affordance such as switching to BYOK).
    @MainActor
    func attemptOpenGeminiAdcLogin() async -> Bool {
        providerAuthInProgress = .gemini
        providerAuthMessage = "gcloud SDK 확인 중..."
        let installed = await Task.detached(priority: .userInitiated) {
            AgenticViewModel.detectGcloudAvailable()
        }.value
        if installed {
            openGeminiAdcLoginInTerminal()
            return true
        }
        providerAuthInProgress = nil
        providerAuthMessage = nil
        PostHogTelemetry.capture("mac_provider_auth_gcloud_missing", properties: [
            "provider": AgentProvider.gemini.rawValue,
        ], authSession: macAuthSession)
        return false
    }

    nonisolated static func detectGcloudAvailable() -> Bool {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/zsh")
        process.arguments = ["-lc", "command -v gcloud"]
        process.standardOutput = Pipe()
        process.standardError = Pipe()
        do {
            try process.run()
            process.waitUntilExit()
            return process.terminationStatus == 0
        } catch {
            return false
        }
    }

    nonisolated static func detectGitHubCliAuthStatus(workspaceRoot: String) -> GitHubCLIAuthStatus {
        let root = workspaceRoot.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            ? NSHomeDirectory()
            : workspaceRoot
        let result = runLoginShellCommand("cd \(shellQuoted(root)); gh auth status")
        if result.exitCode == 0 {
            return GitHubCLIAuthStatus(
                state: .connected,
                detail: "gh auth status 통과. History에서 PR/이슈/릴리즈 신호를 읽을 수 있습니다.",
                checkedAt: Date()
            )
        }
        if result.exitCode == 127 || result.output.localizedCaseInsensitiveContains("command not found") {
            return GitHubCLIAuthStatus(
                state: .missing,
                detail: "gh CLI가 설치되어 있지 않습니다. brew install gh 후 gh auth login을 실행하세요.",
                checkedAt: Date()
            )
        }
        return GitHubCLIAuthStatus(
            state: .disconnected,
            detail: "gh auth login이 필요합니다. 인증 후 History에서 GitHub 활동을 반영합니다.",
            checkedAt: Date()
        )
    }

    nonisolated private static func runLoginShellCommand(_ command: String) -> (exitCode: Int32, output: String) {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/zsh")
        process.arguments = ["-lc", command]
        let stdout = Pipe()
        let stderr = Pipe()
        process.standardOutput = stdout
        process.standardError = stderr
        do {
            try process.run()
            process.waitUntilExit()
            let stdoutData = stdout.fileHandleForReading.readDataToEndOfFile()
            let stderrData = stderr.fileHandleForReading.readDataToEndOfFile()
            let output = [
                String(data: stdoutData, encoding: .utf8),
                String(data: stderrData, encoding: .utf8),
            ]
                .compactMap { $0 }
                .joined(separator: "\n")
            return (process.terminationStatus, output)
        } catch {
            return (-1, error.localizedDescription)
        }
    }

    nonisolated static func detectBrewAvailable() -> Bool {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/zsh")
        process.arguments = ["-lc", "command -v brew"]
        process.standardOutput = Pipe()
        process.standardError = Pipe()
        do {
            try process.run()
            process.waitUntilExit()
            return process.terminationStatus == 0
        } catch {
            return false
        }
    }

    func openGcloudBrewInstallInTerminal() {
        providerAuthInProgress = .gemini
        providerAuthMessage = "gcloud 설치 명령을 Terminal에서 시작했습니다. 설치 완료 후 자동으로 ADC 로그인이 이어집니다."
        lastError = nil

        let command = "brew install --cask google-cloud-sdk && gcloud auth application-default login"
        let script = """
        tell application "Terminal"
            activate
            do script \(Self.appleScriptLiteral(command))
        end tell
        """

        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
        process.arguments = ["-e", script]

        do {
            try process.run()
            PostHogTelemetry.capture("mac_gemini_gcloud_brew_install_started", properties: [
                "provider": AgentProvider.gemini.rawValue,
            ], authSession: macAuthSession)
        } catch {
            providerAuthInProgress = nil
            providerAuthMessage = "brew 설치 명령을 열 수 없습니다: \(error.localizedDescription)"
            lastError = providerAuthMessage
            PostHogTelemetry.captureException(error, properties: [
                "component": "agentic_view_model",
                "operation": "open_gcloud_brew_install_terminal",
            ], authSession: macAuthSession)
        }
    }

    func syncProviderSettingsToSidecar(_ settings: KeychainHelper.Settings? = nil) {
        guard isConnected else { return }
        let resolvedSettings = settings ?? KeychainHelper.loadSettings()
        sidecar.send(payload: [
            "type": "provider_settings_update",
            "providers": providerSettingsPayload(from: resolvedSettings),
            "integrations": [
                "exa": [
                    "apiKey": resolvedSettings.exaApiKey,
                ],
            ],
        ])
    }

    func requestDiagnostics() {
        PostHogTelemetry.capture("mac_diagnostics_requested", authSession: macAuthSession)
        sidecar.send(payload: ["type": "get_diagnostics"])
    }

    func requestNewsMarketRadar() {
        guard isConnected else { return }
        sidecar.send(payload: [
            "type": "news_market_radar_get",
            "preferredProvider": selectedProvider.rawValue,
        ])
    }

    func refreshNewsMarketRadar(reason: String = "manual", force: Bool = false) {
        guard isConnected else { return }
        PostHogTelemetry.capture("mac_news_market_radar_refresh_requested", properties: [
            "reason": reason,
            "force": force,
        ], authSession: macAuthSession)
        sidecar.send(payload: [
            "type": "news_market_radar_refresh",
            "reason": reason,
            "force": force,
            "preferredProvider": selectedProvider.rawValue,
        ])
    }

    func prepareNewsMarketRadarForDisplay() {
        lastNewsMarketRadarViewedAt = Date()
        #if DEBUG
        if emitUITestingNewsMarketRadarEventsIfRequested() { return }
        #endif
        requestNewsMarketRadar()
        guard shouldRefreshNewsMarketRadarForDisplay else { return }
        refreshNewsMarketRadar(reason: "daily", force: false)
    }

    func requestWorkHistory() {
        guard isConnected else { return }
        sidecar.send(payload: [
            "type": "work_history_get",
            "preferredProvider": selectedProvider.rawValue,
        ])
    }

    func refreshWorkHistory(reason: String = "manual") {
        guard isConnected else { return }
        PostHogTelemetry.capture("mac_work_history_refresh_requested", properties: [
            "reason": reason,
        ], authSession: macAuthSession)
        sidecar.send(payload: [
            "type": "work_history_refresh",
            "reason": reason,
            "preferredProvider": selectedProvider.rawValue,
        ])
    }

    /// History 탭 진입 시 호출. 사이드카가 캐시 스냅샷을 즉시 돌려주고,
    /// 주가 바뀌었거나 1시간이 지났거나 새 커밋이 감지되면 재인덱싱한다.
    func prepareWorkHistoryForDisplay() {
        #if DEBUG
        if emitUITestingWorkHistoryEventsIfRequested() { return }
        #endif
        requestWorkHistory()
    }

    /// 아침 브리핑 탭 진입 시 호출. 사이드카가 캐시된 브리핑을 즉시 돌려주고,
    /// 로컬 날짜가 바뀌었으면 소스 수집을 다시 돈다.
    func prepareMorningBriefingForDisplay() {
        #if DEBUG
        if emitUITestingMorningBriefingEventsIfRequested() { return }
        #endif
        guard isConnected else { return }
        sidecar.send(payload: [
            "type": "morning_briefing_get",
            "preferredProvider": selectedProvider.rawValue,
        ])
    }

    func refreshMorningBriefing(reason: String = "manual", force: Bool = true) {
        guard isConnected else { return }
        PostHogTelemetry.capture("mac_morning_briefing_refresh_requested", properties: [
            "reason": reason,
        ], authSession: macAuthSession)
        morningBriefingCollecting = true
        sidecar.send(payload: [
            "type": "morning_briefing_refresh",
            "reason": reason,
            "force": force,
            "preferredProvider": selectedProvider.rawValue,
        ])
    }

    func submitMorningBriefingAnomalyLabel(_ label: String) {
        let trimmed = label.trimmingCharacters(in: .whitespacesAndNewlines)
        guard isConnected, !trimmed.isEmpty else { return }
        PostHogTelemetry.capture("mac_morning_briefing_anomaly_labeled", properties: [
            "anomaly": morningBriefing?.anomaly?.id ?? "",
        ], authSession: macAuthSession)
        sidecar.send(payload: [
            "type": "morning_briefing_anomaly_label",
            "label": trimmed,
        ])
    }

    #if DEBUG
    private func emitUITestingMorningBriefingEventsIfRequested() -> Bool {
        guard CommandLine.arguments.contains("--ui-testing-stub-morning-briefing-events") else {
            return false
        }
        guard !didEmitUITestingMorningBriefingEvents else {
            return true
        }
        didEmitUITestingMorningBriefingEvents = true
        morningBriefing = .uiTestingSample
        morningBriefingCollecting = false
        return true
    }
    #endif

    #if DEBUG
    private func emitUITestingWorkHistoryEventsIfRequested() -> Bool {
        guard CommandLine.arguments.contains("--ui-testing-stub-work-history-events") else {
            return false
        }
        guard !didEmitUITestingWorkHistoryEvents else {
            return true
        }
        didEmitUITestingWorkHistoryEvents = true
        let snapshot = WorkHistorySnapshot(
            schemaVersion: 2,
            generatedAt: Date(timeIntervalSince1970: 1_780_000_000),
            weekStart: "2026-06-01",
            weekEnd: "2026-06-07",
            status: WorkHistoryStatus(
                state: "ready",
                lastSuccessAt: Date(timeIntervalSince1970: 1_780_000_000),
                stale: false,
                error: nil,
                reason: "manual",
                stage: nil,
                progressText: nil,
                elapsedMs: nil
            ),
            github: WorkHistoryGitHub(connected: true, prCount: 1, issueCount: 0, releaseCount: 0),
            totals: WorkHistoryTotals(
                aiMinutes: 135,
                unclassifiedMinutes: 30,
                myCommitCount: 3,
                otherCommitCount: 1,
                sessionCount: 3,
                activeDays: 2
            ),
            areas: [
                WorkHistoryArea(
                    id: "sidecar",
                    name: "사이드카 라우팅",
                    aiMinutes: 105,
                    commitCount: 3,
                    sessionCount: 2,
                    paths: ["sidecar/index.mjs", "sidecar/work-history.mjs"],
                    confidence: "high",
                    inference: "agent"
                ),
            ],
            days: [
                WorkHistoryDay(
                    date: "2026-06-01",
                    weekday: "월",
                    aiMinutes: 105,
                    areas: [
                        WorkHistoryDayArea(
                            areaId: "sidecar",
                            name: "사이드카 라우팅",
                            summary: "사이드카 라우팅에 AI 세션 1시간 45분을 투입해 커밋 3건으로 마무리했어요.",
                            nextActions: [
                                WorkHistoryNextAction(
                                    text: "라우트 테스트를 보강하세요.",
                                    evidence: "sidecar/index.mjs 변경",
                                    areaName: "사이드카 라우팅"
                                ),
                            ],
                            aiMinutes: 105,
                            sessionRanges: [
                                WorkHistorySessionRange(
                                    start: "2026-06-01T10:00:00.000Z",
                                    end: "2026-06-01T11:45:00.000Z",
                                    provider: "claude"
                                ),
                            ],
                            paths: ["sidecar/index.mjs", "sidecar/work-history.mjs"],
                            commitCount: 3,
                            confidence: "high"
                        ),
                    ],
                    referenceEvents: [
                        WorkHistoryReferenceEvent(
                            kind: "pr",
                            title: "PR #7 History tab",
                            actor: "zettalyst",
                            at: "2026-06-01T12:00:00.000Z"
                        ),
                    ]
                ),
                WorkHistoryDay(date: "2026-06-02", weekday: "화", aiMinutes: 30, areas: [], referenceEvents: []),
                WorkHistoryDay(date: "2026-06-03", weekday: "수", aiMinutes: 0, areas: [], referenceEvents: []),
                WorkHistoryDay(date: "2026-06-04", weekday: "목", aiMinutes: 0, areas: [], referenceEvents: []),
                WorkHistoryDay(date: "2026-06-05", weekday: "금", aiMinutes: 0, areas: [], referenceEvents: []),
                WorkHistoryDay(date: "2026-06-06", weekday: "토", aiMinutes: 0, areas: [], referenceEvents: []),
                WorkHistoryDay(date: "2026-06-07", weekday: "일", aiMinutes: 0, areas: [], referenceEvents: []),
            ],
            unclassified: [
                WorkHistoryUnclassifiedSession(
                    provider: "codex",
                    date: "2026-06-02",
                    start: "2026-06-02T13:00:00.000Z",
                    end: "2026-06-02T13:30:00.000Z",
                    minutes: 30,
                    paths: ["scripts/spike.mjs"]
                ),
            ],
            weekly: WorkHistoryWeekly(
                headline: "이번 주 AI 세션 2시간 15분 · 커밋 3건 · 가장 많은 시간: 사이드카 라우팅 (1시간 45분)",
                coachNotes: ["커밋으로 이어지지 않은 세션이 1개(30분) 있어요 — 진행 중이라면 마무리 지점을 정해두세요."],
                nextActions: [
                    WorkHistoryNextAction(
                        text: "커밋으로 이어지지 않은 codex 세션 작업(scripts/spike.mjs)을 마무리하거나 정리하세요.",
                        evidence: "세션 2026-06-02T13:00:00.000Z–2026-06-02T13:30:00.000Z · 수정 파일 1개",
                        areaName: nil
                    ),
                ]
            ),
            retrospective: WorkHistoryRetrospective(
                headline: "사이드카 라우팅은 닫을 수 있지만 미분류 세션 정리가 필요합니다.",
                verdict: "close_loop",
                insights: [
                    WorkHistoryInsight(
                        id: "sidecar-focus",
                        claim: "사이드카 라우팅 집중은 실제 커밋으로 이어졌습니다.",
                        whyItMatters: "집중 시간이 산출물로 이어진 영역이라 다음 주에는 테스트로 루프를 닫을 수 있습니다.",
                        confidence: "high",
                        evidenceRefs: ["사이드카 라우팅 1시간 45분", "커밋 3건"]
                    ),
                    WorkHistoryInsight(
                        id: "unclassified-loop",
                        claim: "미분류 Codex 세션은 아직 결정으로 연결되지 않았습니다.",
                        whyItMatters: "진행 중 작업인지 폐기할 탐색인지 표시하지 않으면 회고가 시간 기록에 머뭅니다.",
                        confidence: "medium",
                        evidenceRefs: ["미분류 30분", "scripts/spike.mjs"]
                    ),
                ],
                riskFlags: [
                    WorkHistoryRiskFlag(
                        id: "unclassified-session",
                        label: "미분류 세션",
                        severity: "medium",
                        reason: "Codex 세션 30분이 커밋이나 PR 근거와 연결되지 않았습니다.",
                        evidenceRefs: ["2026-06-02 13:00-13:30", "scripts/spike.mjs"]
                    ),
                ],
                nextActions: [
                    WorkHistoryRetrospectiveNextAction(
                        text: "미분류 세션을 마무리하고 라우트 테스트를 추가하세요.",
                        evidence: "scripts/spike.mjs 상태와 sidecar 라우팅 테스트 결과",
                        insightId: "unclassified-loop"
                    ),
                ],
                evidenceMix: [
                    WorkHistoryEvidenceMix(source: "ai_session", label: "AI 세션", count: 3, status: "covered"),
                    WorkHistoryEvidenceMix(source: "git_github", label: "git/GitHub", count: 4, status: "covered"),
                    WorkHistoryEvidenceMix(source: "workspace_docs", label: "워크스페이스 문서", count: 1, status: "partial"),
                    WorkHistoryEvidenceMix(source: "interview", label: "인터뷰", count: 0, status: "missing"),
                    WorkHistoryEvidenceMix(source: "bip", label: "공개 기록", count: 0, status: "missing"),
                    WorkHistoryEvidenceMix(source: "mission", label: "미션", count: 0, status: "missing"),
                    WorkHistoryEvidenceMix(source: "curriculum", label: "커리큘럼", count: 0, status: "missing"),
                ]
            )
        )
        handle(SidecarEvent(
            type: "work_history_result",
            message: nil,
            sessionId: nil,
            messageId: nil,
            delta: nil,
            content: nil,
            workspaceRoot: nil,
            session: nil,
            sessions: nil,
            environment: nil,
            diagnostics: nil,
            bipCoach: nil,
            bipSetupReady: nil,
            day: nil,
            firstPrompt: nil,
            missingLocalDocs: nil,
            missingExternalRequirements: nil,
            nextIddDocumentType: nil,
            nextIddDocumentTitle: nil,
            bipSetupGateMessage: nil,
            scanRoot: nil,
            icp: nil,
            spec: nil,
            values: nil,
            designSystem: nil,
            adr: nil,
            goal: nil,
            docs: nil,
            sheet: nil,
            onboardingHypothesis: nil,
            error: nil,
            docType: nil,
            docPath: nil,
            progressText: nil,
            notionConnected: nil,
            success: nil,
            disconnected: nil,
            authUrl: nil,
            rowId: nil,
            status: nil,
            detail: nil,
            log: nil,
            readinessError: nil,
            bipTokenExpiredMessage: nil,
            resourceName: nil,
            resourceUrl: nil,
            stage: nil,
            provider: nil,
            sheetRowsRead: nil,
            docCharsRead: nil,
            elapsedMs: nil,
            phase: nil,
            toolName: nil,
            summary: nil,
            weeklyRitualPrompt: nil,
            requestEmit: nil,
            workHistory: snapshot
        ))
        return true
    }
    #endif

    func requestBipResearch(dayNumber: Int? = nil, curriculumDay: [String: Any]? = nil) {
        guard isConnected else { return }
        var payload: [String: Any] = [
            "type": "bip_research_get",
            "preferredProvider": selectedProvider.rawValue,
            "dayNumber": resolvedBipResearchDayNumber(dayNumber),
        ]
        if let curriculumDay {
            payload["curriculumDay"] = curriculumDay
        }
        sidecar.send(payload: payload)
    }

    func refreshBipResearch(
        reason: String = "manual",
        force: Bool = false,
        dayNumber: Int? = nil,
        curriculumDay: [String: Any]? = nil
    ) {
        guard isConnected else { return }
        let resolvedDayNumber = resolvedBipResearchDayNumber(dayNumber)
        PostHogTelemetry.capture("mac_bip_research_refresh_requested", properties: [
            "reason": reason,
            "force": force,
            "day_number": resolvedDayNumber,
        ], authSession: macAuthSession)
        var payload: [String: Any] = [
            "type": "bip_research_refresh",
            "reason": reason,
            "force": force,
            "preferredProvider": selectedProvider.rawValue,
            "dayNumber": resolvedDayNumber,
        ]
        if let curriculumDay {
            payload["curriculumDay"] = curriculumDay
        }
        sidecar.send(payload: payload)
    }

    func prepareBipResearchForDisplay(curriculumDay: [String: Any]? = nil) {
        lastBipResearchViewedAt = Date()
        let dayNumber = resolvedBipResearchDayNumber(nil)
        requestBipResearch(dayNumber: dayNumber, curriculumDay: curriculumDay)
        guard shouldRefreshBipResearchForDisplay else { return }
        refreshBipResearch(reason: "daily", force: false, dayNumber: dayNumber, curriculumDay: curriculumDay)
    }

    #if DEBUG
    private func emitUITestingNewsMarketRadarEventsIfRequested() -> Bool {
        guard CommandLine.arguments.contains("--ui-testing-stub-news-market-radar-events") else {
            return false
        }
        guard !didEmitUITestingNewsMarketRadarEvents else {
            return true
        }
        didEmitUITestingNewsMarketRadarEvents = true
        let now = Date(timeIntervalSince1970: 1_779_238_800)
        let later = now.addingTimeInterval(24 * 60 * 60)
        let status = NewsMarketRadarStatus(
            state: "refreshing",
            lastSuccessAt: nil,
            stale: false,
            error: nil,
            reason: "daily",
            researchSource: "Codex 웹 검색 도구",
            stage: "running_provider_research",
            progressText: "UI 테스트 리서치 갱신 중",
            elapsedMs: 120,
            stepIndex: 4,
            stepCount: 6,
            partialFailures: nil
        )
        handle(SidecarEvent(
            type: "news_market_radar_status",
            message: nil,
            sessionId: nil,
            messageId: nil,
            delta: nil,
            content: nil,
            workspaceRoot: nil,
            session: nil,
            sessions: nil,
            environment: nil,
            diagnostics: nil,
            bipCoach: nil,
            bipSetupReady: nil,
            day: nil,
            firstPrompt: nil,
            missingLocalDocs: nil,
            missingExternalRequirements: nil,
            nextIddDocumentType: nil,
            nextIddDocumentTitle: nil,
            bipSetupGateMessage: nil,
            scanRoot: nil,
            icp: nil,
            spec: nil,
            values: nil,
            designSystem: nil,
            adr: nil,
            goal: nil,
            docs: nil,
            sheet: nil,
            onboardingHypothesis: nil,
            error: nil,
            docType: nil,
            docPath: nil,
            progressText: nil,
            notionConnected: nil,
            success: nil,
            disconnected: nil,
            authUrl: nil,
            rowId: nil,
            status: nil,
            detail: nil,
            log: nil,
            readinessError: nil,
            bipTokenExpiredMessage: nil,
            resourceName: nil,
            resourceUrl: nil,
            stage: nil,
            provider: nil,
            sheetRowsRead: nil,
            docCharsRead: nil,
            elapsedMs: nil,
            phase: nil,
            toolName: nil,
            summary: nil,
            weeklyRitualPrompt: nil,
            requestEmit: nil,
            newsMarketRadarStatus: status
        ))
        Task { @MainActor in
            try? await Task.sleep(nanoseconds: 150_000_000)
            self.handle(SidecarEvent(
                type: "news_market_radar_result",
                message: nil,
                sessionId: nil,
                messageId: nil,
                delta: nil,
                content: nil,
                workspaceRoot: nil,
                session: nil,
                sessions: nil,
                environment: nil,
                diagnostics: nil,
                bipCoach: nil,
                bipSetupReady: nil,
                day: nil,
                firstPrompt: nil,
                missingLocalDocs: nil,
                missingExternalRequirements: nil,
                nextIddDocumentType: nil,
                nextIddDocumentTitle: nil,
                bipSetupGateMessage: nil,
                scanRoot: nil,
                icp: nil,
                spec: nil,
                values: nil,
                designSystem: nil,
                adr: nil,
                goal: nil,
                docs: nil,
                sheet: nil,
                onboardingHypothesis: nil,
                error: nil,
                docType: nil,
                docPath: nil,
                progressText: nil,
                notionConnected: nil,
                success: nil,
                disconnected: nil,
                authUrl: nil,
                rowId: nil,
                status: nil,
                detail: nil,
                log: nil,
                readinessError: nil,
                bipTokenExpiredMessage: nil,
                resourceName: nil,
                resourceUrl: nil,
                stage: nil,
                provider: nil,
                sheetRowsRead: nil,
                docCharsRead: nil,
                elapsedMs: nil,
                phase: nil,
                toolName: nil,
                summary: nil,
                weeklyRitualPrompt: nil,
                requestEmit: nil,
                newsMarketRadar: NewsMarketRadarSnapshot(
                    schemaVersion: 1,
                    generatedAt: now,
                    nextRefreshAfter: later,
                    status: NewsMarketRadarStatus(
                        state: "ready",
                        lastSuccessAt: now,
                        stale: false,
                        error: nil,
                        reason: "daily",
                        researchSource: "Codex 웹 검색 도구",
                        stage: "saving_results",
                        progressText: "UI 테스트 리서치 준비 완료",
                        elapsedMs: 240,
                        stepIndex: 6,
                        stepCount: 6,
                        partialFailures: [
                            NewsMarketRadarPartialFailure(
                                laneId: "problem",
                                laneTitle: "문제",
                                error: "UI 테스트 부분 실패"
                            )
                        ]
                    ),
                    workspaceEvidenceRefs: [],
                    lanes: [
                        NewsMarketRadarLane(
                            id: "alternatives_pricing",
                            title: "대안/가격",
                            hypothesis: "이미 돈을 쓰는 대안과 가격 기준은 무엇인가",
                            impact: "strengthens",
                            confidence: "strong",
                            cards: [
                                NewsMarketRadarCard(
                                    id: "ui-test-card",
                                    title: "UI 테스트 리서치 결과",
                                    summary: "뉴스 레퍼런스 화면이 열린 상태에서도 리서치 결과가 유지됩니다.",
                                    impact: "strengthens",
                                    confidence: "strong",
                                    whyItMatters: "리서치 갱신 후에도 선택한 뉴스 라우트가 유지되는지 확인합니다.",
                                    suggestedHypothesisUpdate: nil,
                                    suggestedDocTargets: ["ICP.md"],
                                    relatedDays: [2, 5],
                                    relatedAnswerIds: ["ui-test-answer"],
                                    sourceRefs: [
                                        NewsMarketRadarSourceRef(
                                            id: "ui-test-source",
                                            sourceType: "web",
                                            title: "Codex 웹 검색 도구",
                                            url: "https://example.com/radar",
                                            domain: "example.com",
                                            path: nil,
                                            publishedAt: nil,
                                            excerpt: "UI 테스트 출처"
                                        ),
                                    ],
                                    evidenceStrength: "strong"
                                ),
                            ]
                        ),
                    ]
                )
            ))
        }
        return true
    }
    #endif

    private var shouldRefreshNewsMarketRadarForDisplay: Bool {
        if newsMarketRadar.status.state == "refreshing" { return false }
        if newsMarketRadar.status.state == "stale" { return true }
        if newsMarketRadar.status.state == "failed" { return true }
        guard let generatedAt = newsMarketRadar.generatedAt else { return true }
        return Date().timeIntervalSince(generatedAt) >= 24 * 60 * 60
    }

    private func resolvedBipResearchDayNumber(_ explicitDayNumber: Int?) -> Int {
        let day = explicitDayNumber ?? foundationProgressState.currentDayNumber() ?? 1
        return max(1, min(day, 30))
    }

    private var shouldRefreshBipResearchForDisplay: Bool {
        if bipResearch.status.state == "refreshing" { return false }
        if bipResearch.status.state == "stale" { return true }
        if bipResearch.status.state == "failed" { return true }
        if bipResearch.dayNumber != resolvedBipResearchDayNumber(nil) { return true }
        guard let generatedAt = bipResearch.generatedAt else { return true }
        return Date().timeIntervalSince(generatedAt) >= 24 * 60 * 60
    }

    func recordOpenDesignDayAnswer(
        _ answer: OpenDesignDayAnswerSubmission,
        day: Int,
        dayType: String
    ) {
        guard isConnected else { return }
        let occurredAt = Self.sidecarDateString(from: Date())
        sidecar.send(payload: [
            "type": "curriculum_answer_saved",
            "day": day,
            "dayType": dayType,
            "questionId": answer.questionId,
            "question": [
                "id": answer.questionId,
                "dimension": answer.dimension,
                "title": answer.questionTitle,
                "prompt": answer.questionPrompt,
            ],
            "dimension": answer.dimension,
            "answerId": answer.answerId,
            "answer": [
                "id": answer.answerId,
                "title": answer.answerTitle,
                "detail": answer.answerDetail,
                "freeform": answer.freeformAnswer,
                "isAntiSignal": answer.isAntiSignal,
            ],
            "answerTitle": answer.answerTitle,
            "answerDetail": answer.answerDetail,
            "freeformAnswer": answer.freeformAnswer,
            "isAntiSignal": answer.isAntiSignal,
            "occurredAt": occurredAt,
        ])
    }

    private func recordNewsMarketRadarDayCompletionHelpIfNeeded(_ day: Int) {
        guard [2, 5, 27].contains(day),
              let viewedAt = lastNewsMarketRadarViewedAt,
              Date().timeIntervalSince(viewedAt) <= 24 * 60 * 60 else {
            return
        }
        PostHogTelemetry.capture("mac_news_market_radar_day_completion_helped", properties: [
            "day": day,
            "card_count": newsMarketRadar.cardCount,
            "lane_count": newsMarketRadar.lanes.count,
        ], authSession: macAuthSession)
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
        if !iddSetupComplete {
            startBipIddQueue(docType: iddCurrentDocType)
            lastError = "초기 설정을 먼저 승인해야 Day 1 미션을 만들 수 있습니다."
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

    func approveIddSetup() {
        guard isConnected, let sessionID = currentBipCoachSessionID() else { return }
        sidecar.send(payload: [
            "type": "idd_setup_approve",
            "sessionId": sessionID,
        ])
    }

    func requestBipSetupGate(autoStart: Bool = false) {
        guard isConnected else { return }
        let provider = selectedSession?.provider ?? visibleBipCoach?.config.provider ?? selectedProvider
        var payload: [String: Any] = [
            "type": "bip_setup_gate_check",
            "provider": provider.rawValue,
            "autoStart": autoStart,
            "localEvidence": localEvidenceBundle(),
        ]
        if let sessionID = currentBipCoachSessionID() {
            payload["sessionId"] = sessionID
        }
        sidecar.send(payload: payload)
    }

    func startBipIddQueue(docType: String? = nil) {
        guard isConnected else { return }
        let provider = selectedSession?.provider ?? visibleBipCoach?.config.provider ?? selectedProvider
        var payload: [String: Any] = [
            "type": "bip_idd_start_queue",
            "provider": provider.rawValue,
        ]
        if let sessionID = currentBipCoachSessionID() {
            payload["sessionId"] = sessionID
        }
        if let docType, !docType.isEmpty {
            payload["docType"] = docType
        }
        sidecar.send(payload: payload)
    }

    func startDay1DocHandoff(docType: String, day1Handoff: [String: Any]) {
        let normalizedDocType = docType.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !normalizedDocType.isEmpty else { return }
        day1DocHandoffPendingDocType = normalizedDocType
        day1DocHandoffError = nil
        #if DEBUG
        if seedUITestingDay1BulkDocHandoffIfNeeded(docType: normalizedDocType) {
            return
        }
        #endif
        guard isConnected else {
            let docLabel = normalizedDocType == "all" ? "foundation" : normalizedDocType.uppercased()
            let message = "실행 보조 앱 연결 후 \(docLabel) 문서를 작성할 수 있습니다."
            day1DocHandoffPendingDocType = nil
            day1DocHandoffError = message
            lastError = message
            PostHogTelemetry.capture("mac_day1_doc_handoff_rejected", properties: [
                "doc_type": normalizedDocType,
                "reason": "sidecar_disconnected",
            ], authSession: macAuthSession)
            return
        }
        #if DEBUG
        if seedUITestingDay1DocHandoffPromptIfNeeded(docType: normalizedDocType) {
            return
        }
        #endif
        let provider = selectedSession?.provider ?? visibleBipCoach?.config.provider ?? selectedProvider
        let isBulkWrite = normalizedDocType == "all"
        var payload: [String: Any] = isBulkWrite
            ? [
                "type": "day1_doc_handoff_write_all",
                "provider": provider.rawValue,
                "day1Handoff": day1Handoff,
            ]
            : [
                "type": "day1_doc_handoff_start",
                "provider": provider.rawValue,
                "docType": normalizedDocType,
                "localEvidence": localEvidenceBundle(),
                "day1Handoff": day1Handoff,
            ]
        if let sessionID = currentBipCoachSessionID() {
            payload["sessionId"] = sessionID
        }
        PostHogTelemetry.capture("mac_day1_doc_handoff_requested", properties: [
            "doc_type": normalizedDocType,
            "provider": provider.rawValue,
            "bulk": isBulkWrite,
        ], authSession: macAuthSession)
        if !sidecar.send(payload: payload) {
            let message = isBulkWrite
                ? "초기 검증 문서 저장을 요청하지 못했습니다. 실행 보조 앱 연결을 확인해 주세요."
                : "\(normalizedDocType.uppercased()) 문서 질문 카드를 요청하지 못했습니다. 실행 보조 앱 연결을 확인해 주세요."
            day1DocHandoffPendingDocType = nil
            day1DocHandoffError = message
            lastError = message
            PostHogTelemetry.capture("mac_day1_doc_handoff_rejected", properties: [
                "doc_type": normalizedDocType,
                "reason": "sidecar_send_failed",
            ], authSession: macAuthSession)
        }
    }

    func retryCurrentIddQuestion() {
        startBipIddQueue(docType: iddCurrentDocType ?? selectedSession?.pendingUserInput?.generation?.docType)
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
            bundle["onboardingContext"] = onboardingContext.bridgePayload
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
        PostHogTelemetry.resetIdentity()
        KeychainHelper.deleteMacAuthSession()
        macAuthSession = nil
        macOnboardingStatus = .idle
        sendAuthContextToSidecar()
    }

    func resetAgentic30LocalUserData(
        options: Agentic30LocalDataResetOptions = Agentic30LocalDataResetOptions()
    ) throws -> KeychainHelper.LocalDataResetReport {
        let hadAppSupport = FileManager.default.fileExists(atPath: KeychainHelper.applicationSupportURL.path)
        let workspaceURLsForReset = options.includeKnownWorkspaces
            ? WorkspaceSettings.knownWorkspaceURLs()
            : []
        let workspaceAgentic30Count = workspaceURLsForReset.filter {
            FileManager.default.fileExists(
                atPath: $0.appendingPathComponent(".agentic30", isDirectory: true).path
            )
        }.count
        PostHogTelemetry.capture(
            "mac_local_data_reset_requested",
            properties: [
                "had_app_support": hadAppSupport,
                "known_workspace_count": workspaceURLsForReset.count,
                "workspace_agentic30_count": workspaceAgentic30Count,
                "include_qmd_index": options.includeAgentic30QmdIndex,
                "remove_app_bundle": options.removeAppBundle,
            ],
            authSession: macAuthSession
        )
        PostHogTelemetry.resetIdentity()

        authSession?.cancel()
        authSession = nil
        sidecar.stop()
        started = false

        defer {
            resetVolatileLocalUserDataState()
            localDataResetGeneration += 1
        }
        return localDataResetter(options, workspaceURLsForReset)
    }

    func setProjectWorkspace(_ url: URL) {
        clearStartupQueuedAction()
        WorkspaceSettings.store(url)
        Self.resetMacOnboardingIntakeOnlyCompleted()
        macOnboardingIntakeOnlyCompleted = false
        foundationProgressStore = nil
        restoreFoundationProgress(arguments: CommandLine.arguments)
        workspaceRoot = url.path
        if let onboardingContext,
           let memory = try? persistOnboardingMemoryIfPossible(
            context: onboardingContext,
            workspaceRoot: url.path,
            intakeStore: nil,
            sources: []
           ) {
            sendOnboardingMemoryToSidecar(memory)
        }
        attemptedStartupWorkspaceScanRecoveryRoots.removeAll()
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

    func prefetchOnboardingWorkspace(url: URL, context: OnboardingContext) {
        let fingerprint = Self.onboardingWorkspacePrefetchFingerprint(url: url, context: context)
        guard activeOnboardingWorkspacePrefetchFingerprint != fingerprint else { return }

        let isChangingPrefetchTarget = activeOnboardingWorkspacePrefetchFingerprint != nil
        activeOnboardingWorkspacePrefetchFingerprint = fingerprint
        onboardingContext = context
        onboardingContextStatus = .idle
        WorkspaceSettings.store(url)
        Self.resetMacOnboardingIntakeOnlyCompleted()
        macOnboardingIntakeOnlyCompleted = false
        workspaceRoot = url.path
        requestedInitialBipGate = false
        requestedInitialBipMission = false
        pendingWorkspaceScanRoot = nil
        attemptedStartupWorkspaceScanRecoveryRoots.removeAll()
        scanResult = nil
        clearWorkspaceScanTiming()
        lastError = nil

        if isChangingPrefetchTarget, started {
            connectionLabel = "Switching workspace..."
            isConnected = false
            selectedSessionID = nil
            sidecar.stop()
            started = false
        }

        PostHogTelemetry.capture("mac_onboarding_workspace_prefetch_requested", properties: [
            "workspace_basename": url.lastPathComponent,
            "work_mode": context.workMode.rawValue,
            "role": context.role.rawValue,
            "project_stage": context.projectStage.rawValue,
        ], authSession: macAuthSession)

        start(allowOnboardingPrefetch: true, anchorFoundation: false)
        scanWorkspace(root: url.path)
    }

    func prepareIntakeOnlyOnboarding(context: OnboardingContext) {
        activeOnboardingWorkspacePrefetchFingerprint = nil
        onboardingContext = context
        onboardingContextStatus = .idle
        WorkspaceSettings.clear()
        Self.resetMacOnboardingIntakeOnlyCompleted()
        macOnboardingIntakeOnlyCompleted = false
        workspaceRoot = ""
        requestedInitialBipGate = false
        requestedInitialBipMission = false
        pendingWorkspaceScanRoot = nil
        attemptedStartupWorkspaceScanRecoveryRoots.removeAll()
        scanResult = nil
        scanProgressMessage = ""
        scanProgressLogs = []
        scanProgressSnapshots = []
        clearWorkspaceScanTiming()
        lastError = nil

        if started {
            connectionLabel = "Choose a project workspace"
            isConnected = false
            selectedSessionID = nil
            sidecar.stop()
            started = false
        }

        PostHogTelemetry.capture("mac_onboarding_intake_only_prepared", properties: [
            "work_mode": context.workMode.rawValue,
            "role": context.role.rawValue,
            "project_stage": context.projectStage.rawValue,
        ], authSession: macAuthSession)
    }

    private static func onboardingWorkspacePrefetchFingerprint(
        url: URL,
        context: OnboardingContext
    ) -> String {
        [
            url.standardizedFileURL.path,
            context.workMode.rawValue,
            context.role.rawValue,
            context.projectStage.rawValue,
            context.isolationLevel.rawValue,
            context.isolationLevels.map(\.rawValue).joined(separator: ","),
        ].joined(separator: "|")
    }

    func resetMacOnboarding() {
        signOutMacAuth()
        Self.resetMacOnboardingIntroCompleted()
        Self.resetMacOnboardingIntakeOnlyCompleted()
        macOnboardingIntroCompleted = false
        macOnboardingIntakeOnlyCompleted = false
        onboardingContext = nil
        onboardingContextStatus = .idle
        activeOnboardingWorkspacePrefetchFingerprint = nil
    }

    func completeIntakeOnlyOnboarding(openWorkspace: Bool = false) {
        Self.saveMacOnboardingIntakeOnlyCompleted()
        macOnboardingIntakeOnlyCompleted = true
        connectionLabel = "Choose a project workspace"
        isConnected = false
        if started {
            selectedSessionID = nil
            sidecar.stop()
            started = false
        }
        completeMacOnboardingIntro(openWorkspace: openWorkspace)
        PostHogTelemetry.capture("mac_onboarding_intake_only_completed", authSession: macAuthSession)
    }

    func completeMacOnboardingIntro(openWorkspace: Bool = false) {
        Self.saveMacOnboardingIntroCompleted()
        macOnboardingIntroCompleted = true
        activeOnboardingWorkspacePrefetchFingerprint = nil
        PostHogTelemetry.capture("mac_onboarding_intro_completed", properties: [
            "total_scenes": OnboardingCompletionTiming.programIntroSceneCount,
        ], authSession: macAuthSession)
        if !requiresMacOnboarding {
            ensureFoundationStarted()
        }
        if !started, canStartSidecar {
            hydrateWorkspaceRootFromSettingsIfAvailable()
            start()
        }
        if openWorkspace {
            activeSurface = .workspace
        }
    }

    func submitOnboardingContext(
        _ context: OnboardingContext,
        workspaceRoot explicitWorkspaceRoot: String? = nil,
        intakeStore: IntakeV2Store? = nil,
        sources: [IntakeSourceState] = []
    ) {
        onboardingContextStatus = .submitting
        do {
            let onboardingMemory = try persistOnboardingMemoryIfPossible(
                context: context,
                workspaceRoot: explicitWorkspaceRoot,
                intakeStore: intakeStore,
                sources: sources
            )
            IntakeV2Store.clearPersistedDraft()
            onboardingContext = context
            onboardingContextStatus = .idle
            PostHogTelemetry.capture("mac_onboarding_context_submitted", properties: [
                "has_business_description": !context.businessDescription.isEmpty,
                "has_current_stage": !context.currentStage.isEmpty,
                "has_goal": !context.goal.isEmpty,
                "work_mode": context.workMode.rawValue,
                "has_custom_work_mode": !context.customWorkMode.isEmpty,
                "role": context.role.rawValue,
                "project_stage": context.projectStage.rawValue,
                "isolation_level": context.isolationLevel.rawValue,
                "isolation_levels": context.isolationLevels.map(\.rawValue).joined(separator: ","),
            ], authSession: macAuthSession)
            sendAuthContextToSidecar()
            if let onboardingMemory {
                sendOnboardingMemoryToSidecar(onboardingMemory)
            }
            if !started, canStartSidecar {
                hydrateWorkspaceRootFromSettingsIfAvailable()
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

    private func persistOnboardingMemoryIfPossible(
        context: OnboardingContext,
        workspaceRoot explicitWorkspaceRoot: String?,
        intakeStore: IntakeV2Store?,
        sources: [IntakeSourceState]
    ) throws -> WorkspaceOnboardingMemory? {
        let explicit = explicitWorkspaceRoot?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let active = workspaceRoot.trimmingCharacters(in: .whitespacesAndNewlines)
        let stored = WorkspaceSettings.hasExplicitWorkspace ? WorkspaceSettings.resolvedURL().path : ""
        let root = [explicit, active, stored].first { !$0.isEmpty } ?? ""
        guard !root.isEmpty else { return nil }
        let memory = WorkspaceOnboardingMemory.make(
            context: context,
            workspaceRoot: root,
            intakeStore: intakeStore,
            sources: sources
        )
        try WorkspaceMemoryStore.saveOnboardingMemory(memory)
        return memory
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
            PostHogTelemetry.identify(authSession: session)
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
                PostHogTelemetry.identify(authSession: refreshed)
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
                PostHogTelemetry.resetIdentity()
                PostHogTelemetry.captureException(error, properties: [
                    "component": "agentic_view_model",
                    "operation": "refresh_mac_auth",
                ])
            }
        }
    }

    private func sendAuthContextToSidecar() {
        guard isConnected else { return }
        let anonymousDistinctId = PostHogTelemetry.anonymousDistinctID()
        guard let session = macAuthSession, session.isUsable else {
            sidecar.send(payload: [
                "type": "clear_auth_context",
                "anonymousDistinctId": anonymousDistinctId,
            ])
            return
        }

        var payload: [String: Any] = [
            "type": "set_auth_context",
            "accessToken": session.accessToken,
            "refreshToken": session.refreshToken,
            "userId": session.userId,
            "webBaseUrl": MacOnboardingConstants.appBaseURL.absoluteString,
            "anonymousDistinctId": anonymousDistinctId,
        ]
        if let expiresAt = session.expiresAt {
            payload["expiresAt"] = expiresAt
        }
        if let email = session.email {
            payload["email"] = email
        }
        sidecar.send(payload: payload)
    }

    private func sendOnboardingMemoryToSidecarIfAvailable() {
        let root = workspaceRoot.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            ? (WorkspaceSettings.hasExplicitWorkspace ? WorkspaceSettings.resolvedURL().path : "")
            : workspaceRoot
        guard let memory = WorkspaceMemoryStore.loadOnboardingMemory(workspaceRoot: root) else { return }
        sendOnboardingMemoryToSidecar(memory)
    }

    private func sendOnboardingMemoryToSidecar(_ memory: WorkspaceOnboardingMemory) {
        guard isConnected else { return }
        sidecar.send(payload: [
            "type": "onboarding_memory_save",
            "workspaceRoot": memory.workspaceRoot,
            "memory": memory.sidecarPayload,
        ])
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
            "preferredProvider": selectedProvider.rawValue,
        ])
    }

    private func handle(_ event: SidecarEvent) {
        switch event.type {
        case "sidecar_status":
            connectionLabel = event.message ?? connectionLabel
            isConnected = false
            officeHoursSessionCreateInFlight = false
            PostHogTelemetry.capture("mac_sidecar_status", properties: [
                "message": event.message ?? "",
            ], authSession: macAuthSession)
        case "sidecar_unexpected_exit":
            let message = event.message ?? "실행 보조 앱이 예기치 않게 중단됐습니다."
            connectionLabel = message
            isConnected = false
            officeHoursSessionCreateInFlight = false
            markRunningSessionsRecoverableAfterSidecarExit(message: message)
            markStartupQueuedActionFailed(message)
            refreshPresentationState()
        case "request_emit":
            if let request = event.requestEmit {
                handleRequestEmit(request)
            }
        case "ready":
            if let sessions = event.sessions {
                self.sessions = sessions.sorted(by: { $0.updatedAt > $1.updatedAt })
                reconcileOfficeHoursLiveStatuses(with: self.sessions)
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
            day1GoalSelection = event.day1GoalSelection
            if let dp = event.dayProgress { dayProgress = dp }
            if let reviews = event.dayReviews { dayReviews = reviews }
            if let evidence = event.evidenceOS { evidenceOS = evidence }
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
            if selectedSession != nil {
                officeHoursSessionCreateInFlight = false
            }
            recordStartupSessionAppearIfNeeded(source: "ready")
            sendAuthContextToSidecar()
            sendOnboardingMemoryToSidecarIfAvailable()
            syncProviderSettingsToSidecar()
            flushPendingProjectContextRefreshIfNeeded()
            prepareNewsMarketRadarForDisplay()
            refreshPresentationState()
            requestCodexWarmupIfNeeded()
            requestBipReadinessCheck()
            requestInitialBipGateIfNeeded()
            flushStartupQueuedActionIfPossible()
            if let root = pendingWorkspaceScanRoot {
                pendingWorkspaceScanRoot = nil
                sendWorkspaceScan(root: root)
            } else {
                requestWorkspaceScanRecoveryIfNeeded()
            }
        case "sessions_snapshot":
            if let sessions = event.sessions {
                self.sessions = sessions.sorted(by: { $0.updatedAt > $1.updatedAt })
                reconcileOfficeHoursLiveStatuses(with: self.sessions)
                ensureSelection()
                if selectedSession != nil {
                    officeHoursSessionCreateInFlight = false
                }
                recordStartupSessionAppearIfNeeded(source: "sessions_snapshot")
                refreshPresentationState()
                requestCodexWarmupIfNeeded()
            }
        case "session_created":
            if let session = event.session {
                handleSessionCreated(session)
            }
        case "session_updated":
            if let session = event.session {
                upsert(session)
                pruneSentPromptPreviews(for: session)
                detectDimensionTransitionToast(in: session)
                refreshPresentationState()
                requestCodexWarmupIfNeeded()
                flushStartupQueuedActionIfPossible()
            }
        case "curriculum_original_question_reframed":
            applyCurriculumQuestionReframe(event)
            refreshPresentationState()
        case "idd_setup_progress":
            updateStructuredPromptSubmissionProgress(from: event)
            refreshPresentationState()
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
                selectedSessionID = sessions.first(where: { $0.archivedAt == nil })?.id
            }
            createReplacementSessionIfNeeded(source: "delete_last_visible_session")
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
                message.state = event.state ?? .final
            }
            refreshPresentationState()
        case "foundation_first_prompt":
            // Sub-AC 2.4: AI-driven Foundation Day 0/2-7 first prompt arrives
            // here; inject as the seeded assistant opener for the matching
            // session. Idempotent + persistence-safe via deterministic ID.
            handleFoundationFirstPromptEvent(event)
        case "office_hours_source_gate":
            if let gate = event.officeHoursSourceGate {
                officeHoursSourceGate = gate
                if gate.blocking {
                    lastError = gate.message
                    officeHoursDailyDigestCollecting = false
                }
            }
        case "office_hours_daily_digest_result":
            if let digest = event.officeHoursDailyDigest {
                officeHoursDailyDigest = digest
                officeHoursDailyDigestCollecting = false
            } else if event.status == "collecting" {
                officeHoursDailyDigestCollecting = true
            } else {
                // Fail-soft decode: a result event whose digest payload didn't
                // decode still ends the collecting state.
                officeHoursDailyDigestCollecting = false
            }
        case "office_hours_status":
            applyOfficeHoursLiveStatus(from: event)
            // Any run-terminal stage also ends digest collection — covers failure
            // paths that never deliver a "ready" digest.
            if let stage = event.stage,
               ["question_ready", "completed", "failed", "aborted"].contains(stage) {
                officeHoursDailyDigestCollecting = false
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
            beginWorkspaceScanTiming()
            isScanning = true
            setScanProgress(
                event.progressText ?? "Preparing workspace scan...",
                reset: true,
                stage: event.stage,
                stepIndex: event.stepIndex,
                totalSteps: event.totalSteps,
                etaSeconds: event.etaSeconds,
                foundCount: event.foundCount
            )
            scanResult = nil
        case "workspace_scan_progress":
            // Background Day 1 enrichment can report late progress after the
            // foreground scan result. Do not reopen the scan gate unless a new
            // workspace_scan_started event has reset the result first.
            if scanResult == nil {
                isScanning = true
            }
            setScanProgress(
                event.progressText ?? scanProgressMessage,
                stage: event.stage,
                stepIndex: event.stepIndex,
                totalSteps: event.totalSteps,
                etaSeconds: event.etaSeconds,
                foundCount: event.foundCount
            )
        case "workspace_scan_result":
            finishWorkspaceScanTiming()
            isScanning = false
            setScanProgress(
                event.error == nil ? "Workspace scan complete." : "Workspace scan failed.",
                stage: event.stage ?? (event.error == nil ? "merged" : "failed"),
                stepIndex: event.stepIndex ?? 3,
                totalSteps: event.totalSteps ?? 3,
                etaSeconds: event.etaSeconds,
                foundCount: event.foundCount
            )
            let result = WorkspaceScanResult(
                icp: event.icp,
                spec: event.spec,
                values: event.values,
                designSystem: event.designSystem,
                adr: event.adr,
                goal: event.goal,
                docs: event.docs,
                sheet: event.sheet,
                onboardingHypothesis: event.onboardingHypothesis,
                day1AlignmentPlan: event.day1AlignmentPlan,
                day1IcpPlan: event.day1IcpPlan,
                day1SituationSummary: event.day1SituationSummary,
                day1GoalSelection: event.day1GoalSelection,
                error: event.error
            )
            scanResult = result
            day1GoalSelection = event.day1GoalSelection
            if let dp = event.dayProgress { dayProgress = dp }
            if let reviews = event.dayReviews { dayReviews = reviews }
            if let evidence = event.evidenceOS { evidenceOS = evidence }
            persistWorkspaceScanResult(event)
            persistWorkspaceScanResultCache(result, root: event.scanRoot)
        case "day1_goal_state":
            if event.success == false {
                day1GoalError = event.error ?? event.message ?? "Day 1 목표를 저장하지 못했습니다."
                return
            }
            day1GoalError = nil
            day1GoalSelection = event.day1GoalSelection
            if let current = scanResult {
                let updated = current.withDay1GoalSelection(event.day1GoalSelection)
                scanResult = updated
                persistWorkspaceScanResultCache(updated, root: event.workspaceRoot ?? event.scanRoot)
            }
        case "day_progress_state":
            if event.success == false { return }
            if let dp = event.dayProgress { dayProgress = dp }
            if let reviews = event.dayReviews { dayReviews = reviews }
            if let memory = event.officeHoursMemory { officeHoursMemory = memory }
            if let history = event.officeHoursHistory { officeHoursHistory = history }
            if let evidence = event.evidenceOS { evidenceOS = evidence }
            // Interview gate: surface the soft nudge when a close was withheld; clear it on
            // any non-blocked update so it disappears once the founder commits or confesses.
            if event.needsCommitment == true {
                commitmentGateMessage = event.message
                    ?? "이 인터뷰를 닫기 전에 다음 한 가지 고객 행동을 약속해줘. 정 못 하면 그 이유를 남겨도 통과돼."
                commitmentGateStep = event.gatedStep
            } else {
                commitmentGateMessage = nil
                commitmentGateStep = nil
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
        case "workspace_day1_alignment_plan_result", "workspace_day1_icp_plan_result":
            if event.day1AlignmentPlan != nil || event.day1IcpPlan != nil {
                isScanning = false
                if event.day1AlignmentPlan?.source == "frontier_ensemble"
                    || event.day1AlignmentPlan?.source == "frontier_single" {
                    setScanProgress(
                        "frontier 선택지 생성 완료",
                        stage: "merged",
                        stepIndex: 3,
                        totalSteps: 3,
                        foundCount: event.foundCount
                    )
                }
                let result: WorkspaceScanResult
                if let current = scanResult {
                    result = current.replacing(
                        day1AlignmentPlan: event.day1AlignmentPlan,
                        day1IcpPlan: event.day1IcpPlan
                    )
                } else {
                    result = WorkspaceScanResult(
                        icp: nil,
                        spec: nil,
                        values: nil,
                        designSystem: nil,
                        adr: nil,
                        goal: nil,
                        docs: nil,
                        sheet: nil,
                        onboardingHypothesis: nil,
                        day1AlignmentPlan: event.day1AlignmentPlan,
                        day1IcpPlan: event.day1IcpPlan,
                        day1SituationSummary: event.day1SituationSummary,
                        day1GoalSelection: event.day1GoalSelection,
                        error: nil
                    )
                }
                scanResult = result
                persistWorkspaceScanResultCache(result, root: event.scanRoot)
            }
        case "news_market_radar_result":
            if let snapshot = event.newsMarketRadar {
                newsMarketRadar = snapshot
            }
        case "news_market_radar_status":
            if let status = event.newsMarketRadarStatus {
                newsMarketRadar = NewsMarketRadarSnapshot(
                    schemaVersion: newsMarketRadar.schemaVersion,
                    generatedAt: newsMarketRadar.generatedAt,
                    nextRefreshAfter: newsMarketRadar.nextRefreshAfter,
                    status: NewsMarketRadarStatus(
                        state: status.state,
                        lastSuccessAt: status.lastSuccessAt ?? newsMarketRadar.status.lastSuccessAt,
                        stale: status.stale ?? newsMarketRadar.status.stale,
                        error: status.error ?? newsMarketRadar.status.error,
                        reason: status.reason,
                        researchSource: status.researchSource ?? newsMarketRadar.status.researchSource,
                        stage: status.stage ?? newsMarketRadar.status.stage,
                        progressText: status.progressText ?? newsMarketRadar.status.progressText,
                        elapsedMs: status.elapsedMs ?? newsMarketRadar.status.elapsedMs,
                        stepIndex: status.stepIndex ?? newsMarketRadar.status.stepIndex,
                        stepCount: status.stepCount ?? newsMarketRadar.status.stepCount,
                        partialFailures: status.partialFailures ?? newsMarketRadar.status.partialFailures
                    ),
                    workspaceEvidenceRefs: newsMarketRadar.workspaceEvidenceRefs,
                    lanes: newsMarketRadar.lanes
                )
            }
        case "work_history_result":
            if let snapshot = event.workHistory {
                workHistory = snapshot
            }
        case "work_history_status":
            if let status = event.workHistoryStatus {
                workHistory = workHistory.applying(status: status)
            }
        case "morning_briefing_result":
            if let briefing = event.morningBriefing {
                morningBriefing = briefing
            }
            if let previous = event.morningBriefingPrevious {
                morningBriefingPrevious = previous
            }
            morningBriefingCollecting = false
        case "morning_briefing_status":
            morningBriefingCollecting = event.morningBriefingStatus?.state == "collecting"
        case "bip_research_result":
            if let snapshot = event.bipResearch {
                bipResearch = snapshot
            }
        case "bip_research_status":
            if let status = event.bipResearchStatus {
                bipResearch = BipResearchSnapshot(
                    schemaVersion: bipResearch.schemaVersion,
                    contentLocale: bipResearch.contentLocale,
                    promptProfile: bipResearch.promptProfile,
                    contextFingerprint: bipResearch.contextFingerprint,
                    generatedAt: bipResearch.generatedAt,
                    nextRefreshAfter: bipResearch.nextRefreshAfter,
                    dayNumber: bipResearch.dayNumber,
                    dayTitle: bipResearch.dayTitle,
                    dayPhase: bipResearch.dayPhase,
                    status: BipResearchStatus(
                        state: status.state,
                        lastSuccessAt: status.lastSuccessAt ?? bipResearch.status.lastSuccessAt,
                        stale: status.stale ?? bipResearch.status.stale,
                        error: status.error ?? bipResearch.status.error,
                        reason: status.reason,
                        researchSource: status.researchSource ?? bipResearch.status.researchSource,
                        stage: status.stage ?? bipResearch.status.stage,
                        progressText: status.progressText ?? bipResearch.status.progressText,
                        elapsedMs: status.elapsedMs ?? bipResearch.status.elapsedMs,
                        stepIndex: status.stepIndex ?? bipResearch.status.stepIndex,
                        stepCount: status.stepCount ?? bipResearch.status.stepCount,
                        partialFailures: status.partialFailures ?? bipResearch.status.partialFailures
                    ),
                    briefTitle: bipResearch.briefTitle,
                    briefBody: bipResearch.briefBody,
                    querySummary: bipResearch.querySummary,
                    candidateTargetCount: bipResearch.candidateTargetCount,
                    workspaceEvidenceRefs: bipResearch.workspaceEvidenceRefs,
                    signals: bipResearch.signals,
                    candidates: bipResearch.candidates
                )
            }
        case "bip_coach_state":
            if let bipCoach = event.bipCoach {
                self.bipCoach = bipCoach
            }
        case "bip_setup_gate_state":
            updateBipSetupGate(from: event)
            if event.iddSetupComplete == true,
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
            let isDay1HandoffReady = isDay1HandoffSession(id: event.sessionId)
            if let sessionId = event.sessionId {
                selectedSessionID = sessionId
            }
            isBipCoachGenerating = false
            bipMissionProgress = nil
            if !isDay1HandoffReady {
                activeSurface = .assistantBubble
            }
        case "idd_setup_state", "idd_provider_recovery":
            updateBipSetupGate(from: event)
            isBipCoachGenerating = false
            bipMissionProgress = nil
        case "idd_setup_approved":
            updateBipSetupGate(from: event)
            isBipCoachGenerating = false
            bipMissionProgress = nil
            lastError = nil
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
            let completedDay = event.bipCoach?.currentMission?.curriculumDay?.day
                ?? bipCoach?.currentMission?.curriculumDay?.day
                ?? selectedFoundationDay
            if let bipCoach = event.bipCoach {
                self.bipCoach = bipCoach
                requestAndScheduleBipNotificationsIfNeeded(for: bipCoach)
            }
            markFoundationDayCompleted(completedDay)
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
                syncProviderSettingsToSidecar()
                requestDiagnostics()
                retryPendingBipActionAfterAuth()
            } else {
                providerAuthMessage = event.error ?? "로그인에 실패했습니다."
                lastError = providerAuthMessage
            }
        case "diagnostics_snapshot":
            if let diagnostics = event.diagnostics {
                sidecarDiagnostics = diagnostics
                if let environment = diagnostics.environment {
                    self.environment = environment
                }
            }
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
            if day1DocHandoffPendingDocType != nil {
                day1DocHandoffPendingDocType = nil
                day1DocHandoffError = event.message ?? "문서 질문 카드를 준비하지 못했습니다."
            }
            isBipCoachRefreshing = false
            isBipCoachGenerating = false
            isBipCoachCompleting = false
            bipMissionProgress = nil
            if event.sessionId == nil {
                connectionLabel = event.message ?? connectionLabel
                isConnected = false
                officeHoursSessionCreateInFlight = false
                if shouldRecoverRunningSessions(forGlobalSidecarError: event.message) {
                    markRunningSessionsRecoverableAfterSidecarExit(
                        message: event.message ?? "실행 보조 앱 연결이 끊겼습니다."
                    )
                }
                markStartupQueuedActionFailed(event.message ?? "실행 보조 앱 연결이 끊겼습니다.")
            }
            if event.errorKind == "provider_usage_limit" {
                // Expected upstream provider quota cap (e.g. Codex/ChatGPT usage
                // limit). The sidecar already surfaced it as the session error
                // (a "retry later / switch provider" message); track it as a
                // benign event instead of a captured exception so the bridge
                // does not double-report it as an error-tracking issue.
                PostHogTelemetry.capture(
                    "mac_provider_usage_limit",
                    properties: [
                        "component": "agentic_view_model",
                        "operation": "sidecar_event_error",
                        "session_id": event.sessionId ?? "",
                    ],
                    authSession: macAuthSession
                )
            } else {
                PostHogTelemetry.captureException(
                    NSError(domain: "SidecarEvent", code: -1, userInfo: [NSLocalizedDescriptionKey: event.message ?? "알 수 없는 실행 보조 앱 오류"]),
                    properties: [
                        "component": "agentic_view_model",
                        "operation": "sidecar_event_error",
                        "session_id": event.sessionId ?? "",
                    ],
                    authSession: macAuthSession
                )
            }
            refreshPresentationState()
        default:
            break
        }
    }

    var diagnosticsReport: String {
        if let sidecarDiagnostics {
            return sidecarDiagnostics.reportText
        }

        return [
            "agentic30 diagnostics",
            "실행 보조 앱 진단 정보를 아직 불러오지 못했습니다.",
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
        createReplacementSessionIfNeeded(source: "ensure_visible_session")
    }

    private func requestInitialBipGateIfNeeded() {
        guard isConnected, !requestedInitialBipGate else { return }
        requestedInitialBipGate = true
        let shouldAutoStartProjectlessInterview = macOnboardingIntakeOnlyCompleted
            && !WorkspaceSettings.hasExplicitWorkspace
        requestBipSetupGate(autoStart: shouldAutoStartProjectlessInterview)
    }

    private func updateBipSetupGate(from event: SidecarEvent) {
        iddSetupComplete = event.iddSetupComplete ?? iddSetupComplete
        iddSetupStatus = event.iddSetupStatus ?? iddSetupStatus
        iddCurrentDocType = event.iddCurrentDocType ?? iddCurrentDocType
        iddAmbiguityScore = event.iddAmbiguityScore ?? iddAmbiguityScore
        iddUnresolvedAssumptions = event.iddUnresolvedAssumptions ?? iddUnresolvedAssumptions
        iddDocOrder = event.iddDocOrder ?? iddDocOrder
        iddDocPreviews = event.iddDocPreviews ?? iddDocPreviews
        iddProviderRecovery = event.iddProviderRecovery ?? iddProviderRecovery
        iddSetupError = event.iddSetupError ?? iddSetupError
        if let status = event.iddSetupStatus {
            if status != "provider_recovery" {
                iddProviderRecovery = nil
            }
            if status != "error" {
                iddSetupError = nil
            }
        }
        missingBipLocalDocs = event.missingLocalDocs ?? missingBipLocalDocs
        missingBipExternalRequirements = event.missingExternalRequirements ?? missingBipExternalRequirements
        bipSetupGateMessage = event.bipSetupGateMessage ?? bipSetupGateMessage
        reconcileDay1DocHandoffState(from: event)
    }

    private func reconcileDay1DocHandoffState(from event: SidecarEvent) {
        if let setupError = event.iddSetupError,
           setupError.docType == day1DocHandoffPendingDocType {
            day1DocHandoffPendingDocType = nil
            day1DocHandoffError = setupError.message
            return
        }

        guard let pendingDocType = day1DocHandoffPendingDocType else { return }
        if pendingDocType == "all" {
            let previews = event.iddDocPreviews ?? iddDocPreviews
            let requiredDocTypes = ["goal", "icp", "values", "spec"]
            if requiredDocTypes.allSatisfy({ docType in
                previews.first(where: { $0.type == docType })?.isWritten == true
            }) {
                day1DocHandoffPendingDocType = nil
                day1DocHandoffError = nil
            }
            return
        }
        if event.iddDocPreviews?.first(where: { $0.type == pendingDocType })?.isWritten == true {
            day1DocHandoffPendingDocType = nil
            day1DocHandoffError = nil
        }
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

        let stubSessionID = UUID().uuidString
        let pendingUserInput = Self.makeUITestingFoundationDay2QuestionIfNeeded(sessionID: stubSessionID, createdAt: now)
            ?? Self.makeUITestingOfficeHoursStructuredPromptIfNeeded(sessionID: stubSessionID, createdAt: now)
            ?? Self.makeUITestingIcpStructuredPromptIfNeeded(sessionID: stubSessionID, createdAt: now)
        let session = ChatSession(
            id: pendingUserInput?.sessionId ?? stubSessionID,
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
                    content: "일반 채팅을 시작할 수 있어요.",
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

    private static func makeUITestingFoundationDay2QuestionIfNeeded(
        sessionID: String,
        createdAt: Date
    ) -> StructuredPromptRequest? {
        #if DEBUG
        guard CommandLine.arguments.contains("--ui-testing-seed-foundation-day2-question") else {
            return nil
        }
        return StructuredPromptRequest(
            requestId: "ui-test-foundation-day2-question",
            sessionId: sessionID,
            toolName: "foundation_day_2_resume_question",
            title: "Day 2 Market 질문",
            createdAt: createdAt,
            intro: StructuredPromptIntro(
                title: "Day 2 기준",
                body: "이어지는 질문부터 바로 답하면 됩니다.",
                bullets: []
            ),
            resources: [],
            questions: [
                StructuredPromptQuestion(
                    questionId: "day2_market_reference",
                    header: "기준 시장",
                    question: "이미 돈을 내는 기준 시장은 어디인가요?",
                    helperText: "카테고리 1개와 유료 대체재 1개만 먼저 적어보세요.",
                    options: [
                        StructuredPromptOption(
                            label: "Mac 앱",
                            description: "메뉴바, 생산성, 개발자 도구처럼 이미 결제 중인 Mac 앱 시장입니다.",
                            preview: nil,
                            nextIntent: "mac_app_market"
                        ),
                        StructuredPromptOption(
                            label: "구독형 웹 도구",
                            description: "팀이나 개인이 반복 업무 해결에 돈을 내는 웹 도구 시장입니다.",
                            preview: nil,
                            nextIntent: "web_saas_market"
                        ),
                    ],
                    multiSelect: false,
                    allowFreeText: true,
                    requiresFreeText: true,
                    freeTextPlaceholder: "예: 회의 요약 웹 도구, 월 $15 도구",
                    textMode: .short
                )
            ],
            generation: StructuredPromptGeneration(mode: "host_structured", docType: "day2_market")
        )
        #else
        return nil
        #endif
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
            toolName: "agentic30_request_user_input",
            title: "고객 후보 1/4",
            createdAt: createdAt,
            questions: [
                StructuredPromptQuestion(
                    header: "첫 고객",
                    question: "agentic30-public의 SwiftUI macOS 앱과 Node 실행 보조 앱 흐름에서 Day 1에 먼저 검증할 사용자는 누구인가요?",
                    helperText: "UI testing seed도 host structured payload와 같은 형태만 사용합니다.",
                    options: [
                        StructuredPromptOption(
                            label: "Codex/Claude 전환 사용자",
                            description: "AI 연결 인증과 실행 전환에서 막히는 실제 사용자입니다.",
                            preview: nil,
                            nextIntent: "provider_switch_user"
                        ),
                        StructuredPromptOption(
                            label: "30일 커리큘럼 참가자",
                            description: "초기 설정 문서를 통과해야 다음 회차로 넘어갑니다.",
                            preview: nil,
                            nextIntent: "curriculum_day1_user"
                        ),
                        StructuredPromptOption(
                            label: "macOS 메뉴바 앱 사용자",
                            description: "SwiftUI 패널에서 질문/응답 정체를 직접 겪습니다.",
                            preview: nil,
                            nextIntent: "macos_panel_user"
                        )
                    ],
                    multiSelect: false,
                    allowFreeText: true,
                    requiresFreeText: false,
                    freeTextPlaceholder: "예: Day 1 참가자가 AI 연결 인증 실패 후 고정된 고객 후보 질문에 갇힌다",
                    textMode: .short
                )
            ],
            generation: StructuredPromptGeneration(mode: "host_structured", docType: "icp")
        )
        #else
        return nil
        #endif
    }

    private static func makeUITestingOfficeHoursStructuredPromptIfNeeded(
        sessionID requestedSessionID: String,
        createdAt: Date
    ) -> StructuredPromptRequest? {
        #if DEBUG
        guard CommandLine.arguments.contains("--ui-testing-seed-office-hours-structured-prompt") else {
            return nil
        }
        return Self.makeUITestingOfficeHoursStructuredPrompt(
            sessionID: requestedSessionID,
            requestId: "ui-test-office-hours-request",
            createdAt: createdAt,
            step: 1
        )
        #else
        return nil
        #endif
    }

    private static func makeUITestingOfficeHoursStructuredPrompt(
        sessionID requestedSessionID: String,
        requestId: String,
        createdAt: Date,
        step: Int
    ) -> StructuredPromptRequest {
        let prompt: StructuredPromptQuestion
        let signalId: String
        let signalLabel: String

        switch step {
        case 2:
            signalId = "status_quo"
            signalLabel = "현재 대안"
            prompt = StructuredPromptQuestion(
                questionId: "office_hours_status_quo",
                header: "현재 대안",
                question: "사용자는 지금 이 문제를 어떻게 해결하고 있어? 도구, 사람, 시간, 비용까지 지금 쓰는 우회 방식을 써줘.",
                helperText: nil,
                options: [
                    StructuredPromptOption(
                        label: "스프레드시트와 메신저",
                        description: "시트, Notion, Slack, 카톡처럼 흩어진 수동 조합.",
                        preview: "수동 조합",
                        nextIntent: "spreadsheet_slack"
                    ),
                    StructuredPromptOption(
                        label: "사람이 직접 처리",
                        description: "운영자, PM, 인턴, 외주가 반복 업무를 사람 손으로 처리.",
                        preview: "사람 손",
                        nextIntent: "manual_labor"
                    ),
                    StructuredPromptOption(
                        label: "기존 웹 도구 우회 사용",
                        description: "목적이 다른 도구를 억지로 맞춰 쓰는 상태.",
                        preview: "도구 공백",
                        nextIntent: "misfit_saas"
                    ),
                    StructuredPromptOption(
                        label: "아무것도 안 함",
                        description: "실제로는 안 풀고 지나간다. 통증이 약할 수 있는 위험 신호.",
                        preview: "위험 신호",
                        nextIntent: "no_status_quo"
                    ),
                ],
                multiSelect: false,
                allowFreeText: true,
                requiresFreeText: false,
                freeTextPlaceholder: "예: Notion 표, Slack DM, 주 3시간 수동 리포트로 버티고 있어요.",
                textMode: .short,
                highlightPhrases: ["도구, 사람, 시간, 비용"]
            )
        case 3:
            signalId = "human"
            signalLabel = "HUMAN"
            prompt = StructuredPromptQuestion(
                questionId: "office_hours_human",
                header: "HUMAN",
                question: "이번 주 안에 DM·메시지·통화 1통을 실제로 요청할 수 있는 사람은 누구야? 이름, 역할, 실패 비용을 적어줘.",
                helperText: nil,
                options: [
                    StructuredPromptOption(
                        label: "이름과 회사까지 안다",
                        description: "이번 주 바로 연락할 수 있는 실제 후보가 있다.",
                        preview: "구체적",
                        nextIntent: "named_person"
                    ),
                    StructuredPromptOption(
                        label: "역할과 상황은 안다",
                        description: "직함, 팀, 실패 비용은 있지만 아직 특정 이름은 없다.",
                        preview: "가까움",
                        nextIntent: "role_known"
                    ),
                    StructuredPromptOption(
                        label: "고객군만 안다",
                        description: "소규모 회사, 개발자, 마케터처럼 아직 너무 넓다.",
                        preview: "넓음",
                        nextIntent: "category_only"
                    ),
                    StructuredPromptOption(
                        label: "아직 모른다",
                        description: "문제보다 솔루션에서 출발했을 가능성이 크다.",
                        preview: "재설정",
                        nextIntent: "unknown_user"
                    ),
                ],
                multiSelect: false,
                allowFreeText: true,
                requiresFreeText: false,
                freeTextPlaceholder: "예: 50명 규모 물류 스타트업의 Ops Lead, 매주 고객 리포트 때문에 야근합니다.",
                textMode: .short,
                highlightPhrases: ["DM·메시지·통화 1통"]
            )
        case 4:
            signalId = "wedge"
            signalLabel = "첫 진입점"
            prompt = StructuredPromptQuestion(
                questionId: "office_hours_wedge",
                header: "첫 진입점",
                question: "이번 주에 돈을 받을 수 있는 가장 작은 버전은 뭐야? 플랫폼 말고 하나의 작업 흐름으로 말해줘.",
                helperText: nil,
                options: [
                    StructuredPromptOption(
                        label: "유료 첫 테스트 1건",
                        description: "한 고객에게 직접 돈을 받고 결과물을 제공한다.",
                        preview: "paid",
                        nextIntent: "paid_pilot"
                    ),
                    StructuredPromptOption(
                        label: "주간 리포트",
                        description: "설정 없는 결과물로 가치부터 보여준다.",
                        preview: "concierge",
                        nextIntent: "weekly_report"
                    ),
                    StructuredPromptOption(
                        label: "단일 자동화",
                        description: "전체 플랫폼이 아니라 한 반복 작업만 자동화한다.",
                        preview: "작업 흐름",
                        nextIntent: "single_automation"
                    ),
                    StructuredPromptOption(
                        label: "클릭 데모 먼저",
                        description: "돈보다 승인, 이해, 사용 의향을 먼저 검증해야 한다.",
                        preview: "demo",
                        nextIntent: "demo_first"
                    ),
                ],
                multiSelect: false,
                allowFreeText: true,
                requiresFreeText: false,
                freeTextPlaceholder: "예: 매주 월요일 경쟁사 변화 리포트 1장을 대신 만들어주는 유료 첫 테스트.",
                textMode: .short,
                highlightPhrases: ["돈을 받을 수 있는 가장 작은 버전"]
            )
        case 5:
            signalId = "observation"
            signalLabel = "OBSERVATION"
            prompt = StructuredPromptQuestion(
                questionId: "office_hours_observation",
                header: "OBSERVATION",
                question: "누군가가 말없이 쓰는 걸 본 적 있어? 예상과 달랐던 행동이 하나라도 있었는지 적어줘.",
                helperText: nil,
                options: [
                    StructuredPromptOption(
                        label: "직접 관찰했다",
                        description: "옆에서 지켜봤고 예상과 다른 행동을 봤다.",
                        preview: "best",
                        nextIntent: "watched_user"
                    ),
                    StructuredPromptOption(
                        label: "녹화나 로그만 봤다",
                        description: "행동 데이터는 있으나 맥락 질문은 아직 못 했다.",
                        preview: "partial",
                        nextIntent: "reviewed_logs"
                    ),
                    StructuredPromptOption(
                        label: "데모 콜만 했다",
                        description: "사용자가 실제로 쓰는 장면은 아직 못 봤다.",
                        preview: "weak",
                        nextIntent: "demo_only"
                    ),
                    StructuredPromptOption(
                        label: "아직 없다",
                        description: "다음 과제는 만들기가 아니라 관찰일 가능성이 높다.",
                        preview: "assignment",
                        nextIntent: "no_observation"
                    ),
                ],
                multiSelect: false,
                allowFreeText: true,
                requiresFreeText: false,
                freeTextPlaceholder: "예: 사용자가 설정을 안 보고 바로 export부터 찾았어요.",
                textMode: .short,
                highlightPhrases: ["말없이 쓰는 걸 본 적"]
            )
        case 6:
            signalId = "future_fit"
            signalLabel = "FUTURE FIT"
            prompt = StructuredPromptQuestion(
                questionId: "office_hours_future_fit",
                header: "FUTURE FIT",
                question: "3년 뒤 세상이 달라졌을 때 이 제품은 더 필수적이 돼, 아니면 덜 필수적이 돼? 왜 그런지 한 문장으로.",
                helperText: nil,
                options: [
                    StructuredPromptOption(
                        label: "더 필수적이다",
                        description: "사용자의 세계 변화가 제품 의존도를 키운다.",
                        preview: "thesis",
                        nextIntent: "more_essential"
                    ),
                    StructuredPromptOption(
                        label: "덜 필수적일 수 있다",
                        description: "범용 AI나 기존 강자가 같은 문제를 흡수할 위험이 있다.",
                        preview: "risk",
                        nextIntent: "less_essential"
                    ),
                    StructuredPromptOption(
                        label: "방향이 아직 불명확",
                        description: "가설은 있지만 어떤 변화가 이기는지 더 봐야 한다.",
                        preview: "open",
                        nextIntent: "future_unclear"
                    ),
                ],
                multiSelect: false,
                allowFreeText: true,
                requiresFreeText: false,
                freeTextPlaceholder: "예: 팀이 작아질수록 리서치와 실행을 한 사람이 같이 해야 해서 더 필수적입니다.",
                textMode: .short,
                highlightPhrases: ["더 필수적", "덜 필수적"]
            )
        default:
            signalId = "demand"
            signalLabel = "DEMAND"
            prompt = StructuredPromptQuestion(
                questionId: "office_hours_demand_evidence",
                header: "DEMAND",
                question: "가장 강한 수요 증거가 뭐야? 관심 말고, 없어지면 실제로 곤란해지는 행동이나 돈의 증거.",
                helperText: nil,
                options: [
                    StructuredPromptOption(
                        label: "돈을 냈거나 제안함",
                        description: "유료 파일럿, 선결제, 예산 배정처럼 비용이 걸린 신호.",
                        preview: "strong",
                        nextIntent: "paid_demand"
                    ),
                    StructuredPromptOption(
                        label: "업무에 이미 의존함",
                        description: "프로토타입, 수작업 결과물, 리포트를 반복해서 쓰는 상태.",
                        preview: "behavior",
                        nextIntent: "workflow_dependency"
                    ),
                    StructuredPromptOption(
                        label: "강한 workaround 있음",
                        description: "Excel, Slack, 사람, 외주로 억지로 해결하는 현재 대안.",
                        preview: "현재 대안",
                        nextIntent: "workaround_cost"
                    ),
                    StructuredPromptOption(
                        label: "아직 실제 증거 없음",
                        description: "아이디어나 대기 신청자 수준이라 첫 검증 과제가 필요한 상태.",
                        preview: "honest",
                        nextIntent: "no_evidence_yet"
                    ),
                ],
                multiSelect: false,
                allowFreeText: true,
                requiresFreeText: false,
                freeTextPlaceholder: "예: 3명이 매주 같은 수작업을 하고 있고 1명은 유료 파일럿을 물어봤어요.",
                textMode: .short,
                highlightPhrases: ["행동이나 돈의 증거"]
            )
        }

        return StructuredPromptRequest(
            requestId: requestId,
            sessionId: requestedSessionID,
            toolName: "agentic30_request_user_input",
            title: "Office Hours",
            createdAt: createdAt,
            questions: [prompt],
            generation: StructuredPromptGeneration(
                mode: "office_hours",
                docType: "day1_step",
                signalId: signalId,
                signalLabel: signalLabel,
                dimensionStepIndex: step,
                dimensionTotal: 6
            )
        )
    }

    // Seeds a two-day DayProgress (Day 2 today, Day 1 incomplete past record) so the
    // Office Hours timeline sidebar renders the cumulative Day list for screenshots.
    // challengeStartedAt is yesterday-local so currentDayNumber() resolves to Day 2
    // on any run date. Gated on its own flag; no-op otherwise.
    private func seedUITestingTimelineFixtureIfNeeded() {
        #if !DEBUG
        return
        #else
        guard CommandLine.arguments.contains("--ui-testing-seed-office-hours-timeline-fixture") else { return }
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone.current
        formatter.dateFormat = "yyyy-MM-dd"
        let now = Date()
        let yesterday = Calendar.current.date(byAdding: .day, value: -1, to: now) ?? now
        let startedAt = formatter.string(from: yesterday)
        let day1 = DayRecord(
            day: 1,
            kind: .day1,
            steps: ["onboarding": .done, "scan": .done, "goal": .active, "first_interview": .pending],
            goalText: "목표와 고객 핵심 가설을 만든다",
            updatedAt: startedAt
        )
        let day2 = DayRecord(
            day: 2,
            kind: .standard,
            steps: ["scan": .done, "retro": .done, "goal": .done, "interview": .active, "execution": .pending],
            goalText: "전업 1인 개발자 (수익 0원, macOS 메뉴바 AI 비서)",
            updatedAt: formatter.string(from: now)
        )
        dayProgress = DayProgress(
            challengeStartedAt: startedAt,
            days: ["1": day1, "2": day2]
        )
        let commitment = CommitmentRecord(
            id: "ui-test-commitment-day-1",
            cycle: 1,
            day: 1,
            createdAt: "\(startedAt)T09:00:00.000Z",
            text: "장지창에게 DM로 결제 의향 묻기 · 증거: screenshot",
            customer: "장지창",
            channel: "DM",
            message: "결제 의향 묻기",
            expectedEvidenceKind: "screenshot",
            dueDay: 2,
            confirmedByUser: true,
            status: "open",
            evidence: nil
        )
        dayReviews = [
            "1": DayReview(
                schemaVersion: 2,
                day: 1,
                status: "build_escape",
                verdictLabel: "고객 증거 없이 빌드함",
                verdictTone: "danger",
                summary: "AI 작업 75분이 있었지만 확인 가능한 고객 증거가 없습니다. 다음 고객 접촉으로 닫아야 합니다.",
                customerEvidence: [commitment],
                commitments: [commitment],
                nextCommitment: commitment,
                missing: ["hard_evidence"],
                goalSnapshot: DayGoalSnapshot(
                    summary: "전업 1인 개발자에게 macOS 메뉴바 AI 비서의 결제 의향을 검증한다",
                    customer: "전업 1인 개발자",
                    problem: "AI 코딩은 많이 하지만 고객 검증과 매출 약속이 사라진다",
                    validationAction: "장지창에게 결제 의향 DM을 보내고 스크린샷을 붙인다",
                    source: "day1-goal"
                ),
                missingReasons: [
                    "고객 반응 URL/스크린샷/결제 같은 확인 가능한 증거가 없습니다.",
                    "Day 1 약속이 Day 2 기준으로 기한을 넘겼습니다."
                ],
                carryForwardAction: "오늘 장지창에게 결제 의향 DM을 보내고 screenshot 증거를 붙이기",
                evidenceDebts: [commitment],
                work: DayReviewWorkSummary(
                    available: true,
                    date: startedAt,
                    aiMinutes: 75,
                    commitCount: 3,
                    referenceEventCount: 1,
                    hasWork: true,
                    areas: [
                        DayReviewWorkArea(
                            name: "제품 빌드",
                            aiMinutes: 75,
                            commitCount: 3,
                            paths: ["agentic30/ContentView.swift"]
                        )
                    ]
                )
            )
        ]
        evidenceOS = EvidenceOSSummary(
            schemaVersion: 1,
            currentDay: 2,
            openDebts: [commitment],
            overdueDebts: [commitment],
            provenEvidence: [],
            dayStates: [
                "1": EvidenceOSDayState(
                    day: 1,
                    state: "build_escape",
                    label: "빌드만 진행",
                    tone: "danger",
                    openDebtCount: 1,
                    provenEvidenceCount: 0,
                    carryForwardAction: "오늘 장지창에게 결제 의향 DM을 보내고 screenshot 증거를 붙이기"
                ),
                "2": EvidenceOSDayState(
                    day: 2,
                    state: "in_progress",
                    label: "진행 중",
                    tone: "warning",
                    openDebtCount: 1,
                    provenEvidenceCount: 0,
                    carryForwardAction: "Day 1 고객 증거를 먼저 닫기"
                )
            ]
        )
        #endif
    }

    @discardableResult
    private func installUITestingOfficeHoursCommitmentGateSessionIfNeeded() -> Bool {
        #if DEBUG
        guard CommandLine.arguments.contains("--ui-testing-seed-office-hours-commitment-gate") else {
            return false
        }
        if let selectedSession,
           selectedSession.title.range(of: "Office Hours", options: [.caseInsensitive, .diacriticInsensitive]) != nil,
           selectedSession.pendingUserInput == nil,
           selectedSession.status == .idle {
            return true
        }

        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone.current
        formatter.dateFormat = "yyyy-MM-dd"
        let today = formatter.string(from: Date())
        dayProgress = DayProgress(
            challengeStartedAt: today,
            days: [
                "1": DayRecord(
                    day: 1,
                    kind: .day1,
                    steps: ["onboarding": .done, "scan": .done, "goal": .done, "first_interview": .active],
                    goalText: "전업 1인 개발자에게 고객 증거를 만들게 한다",
                    updatedAt: today
                )
            ]
        )

        let now = Date()
        let sessionID = "ui-test-office-hours-commitment-\(UUID().uuidString)"
        func answer(_ index: Int, _ content: String) -> ChatMessage {
            ChatMessage(
                id: "ui-test-office-hours-answer-\(index)",
                role: .user,
                provider: selectedProvider,
                content: content,
                state: .final,
                createdAt: now.addingTimeInterval(TimeInterval(index)),
                error: nil,
                bipMissionChoices: nil,
                providerAuthActions: nil
            )
        }
        let session = ChatSession(
            id: sessionID,
            title: "Office Hours",
            provider: selectedProvider,
            model: preferredModel(for: selectedProvider),
            status: .idle,
            createdAt: now,
            updatedAt: now,
            error: nil,
            messages: [
                answer(1, "돈을 냈거나 제안함"),
                answer(2, "스프레드시트와 메신저"),
                answer(3, "장지창, 전업 1인 개발자, 수익 전환이 막혀 있음"),
                answer(4, "유료 파일럿 1건"),
                answer(5, "직접 관찰했다"),
                answer(6, "더 필수적이다"),
            ],
            pendingUserInput: nil,
            runtime: ChatSessionRuntime(
                codexThreadId: nil,
                codexThreadMeta: nil,
                codexWarm: nil,
                startupTiming: nil,
                iddDocumentType: "day1_step",
                iddMode: "office_hours"
            )
        )
        sessions = [session]
        selectedSessionID = sessionID
        officeHoursSessionCreateInFlight = false
        refreshPresentationState()
        return true
        #else
        return false
        #endif
    }

    @discardableResult
    private func installUITestingOfficeHoursStructuredPromptSessionIfNeeded() -> Bool {
        #if DEBUG
        guard CommandLine.arguments.contains("--ui-testing-seed-office-hours-structured-prompt") else {
            return false
        }
        // Day timeline fixture: seed a cumulative Day list (Day 2 today + a past
        // Day 1 record) so the sidebar focus-highlight can be screenshotted. Runs
        // before the goal guard so the timeline renders even pre-goal-confirm.
        seedUITestingTimelineFixtureIfNeeded()
        guard day1GoalSelection != nil else {
            return false
        }
        if let selectedSession,
           selectedSession.pendingUserInput?.title?.caseInsensitiveCompare("Office Hours") == .orderedSame
            || selectedSession.pendingUserInput?.generation?.mode?.hasPrefix("office_hours") == true {
            return true
        }

        let now = Date()
        let sessionID = "ui-test-office-hours-\(UUID().uuidString)"
        guard let prompt = Self.makeUITestingOfficeHoursStructuredPromptIfNeeded(
            sessionID: sessionID,
            createdAt: now
        ) else {
            return false
        }

        let session = ChatSession(
            id: sessionID,
            title: "Office Hours",
            provider: selectedProvider,
            model: preferredModel(for: selectedProvider),
            status: .awaitingInput,
            createdAt: now,
            updatedAt: now,
            error: nil,
            messages: [],
            pendingUserInput: prompt,
            runtime: ChatSessionRuntime(
                codexThreadId: nil,
                codexThreadMeta: nil,
                codexWarm: nil,
                startupTiming: nil,
                iddDocumentType: "day1_step",
                iddMode: "office_hours"
            )
        )
        sessions = [session]
        selectedSessionID = sessionID
        officeHoursSessionCreateInFlight = false
        refreshPresentationState()
        return true
        #else
        return false
        #endif
    }

    @discardableResult
    private func installUITestingOfficeHoursRunningSessionIfNeeded() -> Bool {
        #if DEBUG
        guard CommandLine.arguments.contains("--ui-testing-seed-office-hours-running") else {
            return false
        }
        if let selectedSession,
           selectedSession.title.range(of: "Office Hours", options: [.caseInsensitive, .diacriticInsensitive]) != nil,
           selectedSession.status == .running {
            return true
        }

        let now = Date()
        let startedAt = ISO8601DateFormatter().string(from: now)
        let sessionID = "ui-test-office-hours-running-\(UUID().uuidString)"
        let session = ChatSession(
            id: sessionID,
            title: "Office Hours",
            provider: selectedProvider,
            model: preferredModel(for: selectedProvider),
            status: .running,
            createdAt: now,
            updatedAt: now,
            error: nil,
            messages: [
                ChatMessage(
                    id: "ui-test-office-hours-context",
                    role: .user,
                    provider: selectedProvider,
                    content: OfficeHoursTranscriptRow.syntheticStartPrompt,
                    state: .final,
                    createdAt: now,
                    error: nil,
                    bipMissionChoices: nil,
                    providerAuthActions: nil
                ),
                ChatMessage(
                    id: "ui-test-office-hours-answer",
                    role: .user,
                    provider: selectedProvider,
                    content: "시간을 반복 낭비함",
                    state: .final,
                    createdAt: now,
                    error: nil,
                    bipMissionChoices: nil,
                    providerAuthActions: nil
                ),
            ],
            pendingUserInput: nil,
            runtime: ChatSessionRuntime(
                codexThreadId: nil,
                codexThreadMeta: nil,
                codexWarm: nil,
                startupTiming: nil,
                iddDocumentType: "day1_step",
                iddMode: "office_hours",
                officeHours: OfficeHoursRuntime(
                    active: true,
                    source: "ui_testing_running",
                    startedAt: startedAt,
                    context: "UI test Office Hours running state",
                    day: 1
                )
            )
        )
        sessions = [session]
        selectedSessionID = sessionID
        officeHoursSessionCreateInFlight = false
        refreshPresentationState()
        return true
        #else
        return false
        #endif
    }

    private static func makeUITestingDay1HandoffGoalPromptIfNeeded(
        sessionID requestedSessionID: String,
        createdAt: Date
    ) -> StructuredPromptRequest? {
        #if DEBUG
        let arguments = CommandLine.arguments
        guard arguments.contains("--ui-testing-seed-day1-handoff-goal-prompt")
            || arguments.contains("--ui-testing-seed-day1-handoff-goal-prompt-delayed") else {
            return nil
        }
        return StructuredPromptRequest(
            requestId: "ui-test-day1-handoff-goal-request",
            sessionId: requestedSessionID,
            toolName: "agentic30_request_user_input",
            title: "목표 정하기",
            createdAt: createdAt,
            questions: [
                StructuredPromptQuestion(
                    header: "이번 주 목표",
                    question: "이번 주에 가장 먼저 검증하거나 달성하려는 목표는 무엇인가요?",
                    helperText: "먼저 검증할 목표를 정합니다. 저장: docs/GOAL.md",
                    options: [
                        StructuredPromptOption(
                            label: "첫 고객 반응 확인",
                            description: "고객 후보가 답변, 미팅, 사용 시도 같은 실제 반응을 보이는지 봅니다.",
                            preview: nil,
                            nextIntent: "goal_customer_response"
                        ),
                        StructuredPromptOption(
                            label: "문제 강도 확인",
                            description: "현재 대안의 시간, 돈, 평판 비용을 실제로 겪는지 봅니다.",
                            preview: nil,
                            nextIntent: "goal_problem_intensity"
                        ),
                    ],
                    multiSelect: false,
                    allowFreeText: true,
                    requiresFreeText: false,
                    freeTextPlaceholder: "예: 이번 주 5명에게 요청하고 3명 이상 답하면 통과",
                    textMode: .short
                )
            ],
            generation: StructuredPromptGeneration(mode: "day1_handoff", docType: "goal")
        )
        #else
        return nil
        #endif
    }

    #if DEBUG
    private func seedUITestingDay1BulkDocHandoffIfNeeded(docType: String) -> Bool {
        let arguments = CommandLine.arguments
        guard docType == "all",
              arguments.contains("--ui-testing-disable-sidecar"),
              ProcessInfo.processInfo.environment["AGENTIC30_TEST_STUB_PROVIDER"] == "1" else {
            return false
        }

        DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { [weak self] in
            self?.installUITestingDay1BulkDocPreviews()
        }
        return true
    }

    private func installUITestingDay1BulkDocPreviews() {
        let order = ["goal", "icp", "values", "spec"]
        let seededPreviews = [
            IddDocPreview(type: "goal", title: "GOAL", path: "docs/GOAL.md", status: "written", content: "UI test GOAL handoff response"),
            IddDocPreview(type: "icp", title: "고객 후보", path: "docs/ICP.md", status: "written", content: "UI test customer candidate handoff response"),
            IddDocPreview(type: "values", title: "VALUES", path: "docs/VALUES.md", status: "written", content: "UI test VALUES handoff response"),
            IddDocPreview(type: "spec", title: "SPEC", path: "docs/SPEC.md", status: "written", content: "UI test SPEC handoff response"),
        ]
        var mergedPreviews = iddDocPreviews.filter { !order.contains($0.type) }
        mergedPreviews.append(contentsOf: seededPreviews)
        mergedPreviews.sort {
            (order.firstIndex(of: $0.type) ?? Int.max) < (order.firstIndex(of: $1.type) ?? Int.max)
        }
        iddDocPreviews = mergedPreviews
        iddSetupComplete = true
        iddSetupStatus = "approved"
        iddCurrentDocType = nil
        day1DocHandoffPendingDocType = nil
        day1DocHandoffError = nil
        refreshPresentationState()
    }

    private func seedUITestingDay1DocHandoffPromptIfNeeded(docType: String) -> Bool {
        let arguments = CommandLine.arguments
        let shouldSeedImmediately = arguments.contains("--ui-testing-seed-day1-handoff-goal-prompt")
        let shouldSeedAfterDelay = arguments.contains("--ui-testing-seed-day1-handoff-goal-prompt-delayed")
        guard (shouldSeedImmediately || shouldSeedAfterDelay),
              docType == "goal" else {
            return false
        }

        if shouldSeedAfterDelay {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { [weak self] in
                self?.installUITestingDay1DocHandoffPrompt(docType: docType, forceNewSession: true)
            }
            return true
        }

        installUITestingDay1DocHandoffPrompt(docType: docType, forceNewSession: false)
        return true
    }

    @discardableResult
    private func installUITestingDay1DocHandoffPrompt(docType: String, forceNewSession: Bool) -> Bool {
        let now = Date()
        let sessionID = forceNewSession
            ? "ui-test-day1-handoff-\(docType)-\(UUID().uuidString)"
            : selectedSessionID ?? sessions.first?.id ?? UUID().uuidString
        guard let prompt = Self.makeUITestingDay1HandoffGoalPromptIfNeeded(
            sessionID: sessionID,
            createdAt: now
        ) else {
            return false
        }

        if var session = sessions.first(where: { $0.id == sessionID }) {
            session.title = "Day 1 Handoff: GOAL"
            session.status = .awaitingInput
            session.updatedAt = now
            session.error = nil
            session.pendingUserInput = prompt
            if session.runtime == nil {
                session.runtime = ChatSessionRuntime(
                    codexThreadId: nil,
                    codexThreadMeta: nil,
                    codexWarm: nil,
                    startupTiming: nil,
                    iddDocumentType: docType,
                    iddMode: "day1_handoff"
                )
            } else {
                session.runtime?.iddDocumentType = docType
                session.runtime?.iddMode = "day1_handoff"
            }
            upsert(session)
        } else {
            let provider = selectedProvider
            upsert(ChatSession(
                id: sessionID,
                title: "Day 1 Handoff: GOAL",
                provider: provider,
                model: preferredModel(for: provider),
                status: .awaitingInput,
                createdAt: now,
                updatedAt: now,
                error: nil,
                messages: [],
                pendingUserInput: prompt,
                runtime: ChatSessionRuntime(
                    codexThreadId: nil,
                    codexThreadMeta: nil,
                    codexWarm: nil,
                    startupTiming: nil,
                    iddDocumentType: docType,
                    iddMode: "day1_handoff"
                )
            ))
        }

        selectedSessionID = sessionID
        iddSetupStatus = "interviewing"
        iddCurrentDocType = docType
        day1DocHandoffPendingDocType = docType
        day1DocHandoffError = nil
        refreshPresentationState()
        return true
    }

    private func completeUITestingDay1DocHandoffSubmissionIfNeeded(
        sessionId: String,
        requestId: String,
        promptBeforeLocalSubmission: StructuredPromptRequest?
    ) -> Bool {
        let arguments = CommandLine.arguments
        guard (arguments.contains("--ui-testing-seed-day1-handoff-goal-prompt")
                || arguments.contains("--ui-testing-seed-day1-handoff-goal-prompt-delayed")),
              let sessionIndex = sessions.firstIndex(where: { $0.id == sessionId }),
              let prompt = promptBeforeLocalSubmission ?? sessions[sessionIndex].pendingUserInput,
              prompt.requestId == requestId,
              prompt.generation?.mode == "day1_handoff",
              let docType = prompt.generation?.docType?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased(),
              !docType.isEmpty else {
            return false
        }

        let docMeta: (title: String, path: String)
        switch docType {
        case "goal":
            docMeta = ("GOAL", "docs/GOAL.md")
        case "icp":
            docMeta = ("고객 후보", "docs/ICP.md")
        case "values":
            docMeta = ("VALUES", "docs/VALUES.md")
        case "spec":
            docMeta = ("SPEC", "docs/SPEC.md")
        default:
            docMeta = (docType.uppercased(), "docs/\(docType.uppercased()).md")
        }

        let writtenPreview = IddDocPreview(
            type: docType,
            title: docMeta.title,
            path: docMeta.path,
            status: "written",
            content: "UI test handoff response"
        )
        if let previewIndex = iddDocPreviews.firstIndex(where: { $0.type == docType }) {
            iddDocPreviews[previewIndex] = writtenPreview
        } else {
            iddDocPreviews.append(writtenPreview)
        }
        let order = ["goal", "icp", "values", "spec"]
        iddDocPreviews.sort {
            (order.firstIndex(of: $0.type) ?? Int.max) < (order.firstIndex(of: $1.type) ?? Int.max)
        }

        sessions[sessionIndex].pendingUserInput = nil
        sessions[sessionIndex].status = .idle
        sessions[sessionIndex].error = nil
        sessions[sessionIndex].updatedAt = .now
        submittedStructuredPromptBySession.removeValue(forKey: sessionId)
        structuredPromptDraftBySession.removeValue(forKey: sessionId)
        day1DocHandoffPendingDocType = nil
        day1DocHandoffError = nil
        iddCurrentDocType = order.drop(while: { $0 != docType }).dropFirst().first
        refreshPresentationState()
        return true
    }

    private func completeUITestingOfficeHoursStructuredSubmissionIfNeeded(
        sessionId: String,
        requestId: String,
        promptBeforeLocalSubmission: StructuredPromptRequest?
    ) -> Bool {
        let arguments = CommandLine.arguments
        guard arguments.contains("--ui-testing-seed-office-hours-structured-prompt"),
              let sessionIndex = sessions.firstIndex(where: { $0.id == sessionId }) else {
            return false
        }
        guard sessions[sessionIndex].pendingUserInput?.requestId == requestId else {
            return true
        }
        guard
              let prompt = promptBeforeLocalSubmission ?? sessions[sessionIndex].pendingUserInput,
              prompt.requestId == requestId else {
            return false
        }

        let currentStep = prompt.generation?.dimensionStepIndex ?? (requestId == "ui-test-office-hours-request" ? 1 : 6)
        let totalSteps = prompt.generation?.dimensionTotal ?? 6
        if currentStep < totalSteps {
            let nextStep = currentStep + 1
            sessions[sessionIndex].pendingUserInput = Self.makeUITestingOfficeHoursStructuredPrompt(
                sessionID: sessionId,
                requestId: "ui-test-office-hours-request-\(nextStep)",
                createdAt: .now,
                step: nextStep
            )
            sessions[sessionIndex].status = .awaitingInput
        } else {
            sessions[sessionIndex].pendingUserInput = nil
            sessions[sessionIndex].status = .idle
            sessions[sessionIndex].messages.append(ChatMessage(
                id: UUID().uuidString,
                role: .assistant,
                provider: sessions[sessionIndex].provider,
                content: "선택지를 확인했어요. 답변이 모두 기록됐습니다.",
                state: .final,
                createdAt: .now,
                error: nil,
                bipMissionChoices: nil,
                providerAuthActions: nil
            ))
        }
        sessions[sessionIndex].error = nil
        sessions[sessionIndex].updatedAt = .now
        submittedStructuredPromptBySession.removeValue(forKey: sessionId)
        structuredPromptDraftBySession.removeValue(forKey: sessionId)
        refreshPresentationState()
        return true
    }

    func completeUITestingOfficeHoursStructuredPromptIfNeeded(_ prompt: StructuredPromptRequest) -> Bool {
        completeUITestingOfficeHoursStructuredSubmissionIfNeeded(
            sessionId: prompt.sessionId,
            requestId: prompt.requestId,
            promptBeforeLocalSubmission: prompt
        )
    }
    #endif

    private func seedInlineUITestBipCoachIfNeeded() {
        #if DEBUG
        let seedCurrentMission = CommandLine.arguments.contains("--ui-testing-seed-bip-current-mission")
        let seedCompletedMission = CommandLine.arguments.contains("--ui-testing-seed-bip-completed-mission")
        let seedLocalMissionChoices = CommandLine.arguments.contains("--ui-testing-seed-bip-local-mission-choices")
        guard (seedCurrentMission || seedCompletedMission || seedLocalMissionChoices),
              let sessionID = selectedSessionID else {
            return
        }

        if seedCurrentMission || seedCompletedMission {
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
            : Self.makeUITestingBipCoachState(sessionID: sessionID, isCompleted: seedCompletedMission)
        #endif
    }

    private func applyUITestingIddSetupSeeds(arguments: [String]) {
        #if DEBUG
        guard arguments.contains("--ui-testing-seed-idd-complete") else { return }
        iddSetupComplete = true
        iddSetupStatus = "approved"
        iddCurrentDocType = nil
        iddAmbiguityScore = 12
        iddUnresolvedAssumptions = []
        iddDocOrder = ["icp", "goal", "values", "spec"]
        iddDocPreviews = [
            IddDocPreview(type: "icp", title: "고객 후보", path: "docs/ICP.md", status: "approved", content: "Seed customer candidate"),
            IddDocPreview(type: "goal", title: "GOAL", path: "docs/GOAL.md", status: "approved", content: "Seed GOAL"),
            IddDocPreview(type: "values", title: "VALUES", path: "docs/VALUES.md", status: "approved", content: "Seed VALUES"),
            IddDocPreview(type: "spec", title: "SPEC", path: "docs/SPEC.md", status: "approved", content: "Seed SPEC"),
        ]
        iddProviderRecovery = nil
        iddSetupError = nil
        #endif
    }

    private static func makeUITestingBipCoachState(sessionID: String, isCompleted: Bool = false) -> BipCoachState {
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
                status: isCompleted ? "completed" : "drafted",
                compact: false,
                title: "오늘 배운 점을 Threads에 공개하기",
                angle: "작게 배운 것을 공개 기록으로 바꾸기",
                mission: "오늘 작업에서 배운 점 1개와 다음 액션 1개를 Threads에 올리세요.",
                curriculumDay: isCompleted ? BipCoachCurriculumDay(day: 1) : nil,
                drafts: [],
                eveningChecklist: ["Threads URL 남기기", "Sheet 행 메모 남기기"],
                evidenceRefs: [],
                generatedAt: Date(),
                completedAt: isCompleted ? Date() : nil,
                completedQuestionCount: isCompleted ? 3 : nil,
                threadsUrl: isCompleted ? "https://threads.net/@october/post/proof" : nil,
                sheetRowNote: isCompleted ? "오늘 배운 점과 다음 액션 기록" : nil
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
                curriculumDay: nil,
                drafts: [],
                eveningChecklist: ["후보 3명 적기", "첫 질문 1개 보내기"],
                evidenceRefs: [],
                generatedAt: now,
                completedAt: nil,
                completedQuestionCount: nil,
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
            "DAY1_ICP_TURN_1: Day 1 시작. docs/ICP.md 기준으로 내가 맞는 고객 후보인지 먼저 진단해줘.",
            "DAY1_ICP_TURN_2: 나는 퇴사한 전업 1인 개발자이고 수익은 0원, macOS에서 Codex를 쓴다. Day 1 현재 상태를 판정해줘.",
            "DAY1_ICP_TURN_3: 이미 소개 페이지와 작은 프로토타입은 있다. Day 1 백지 상태의 고객 탐색이 아니라 빠른 경로로 가야 하는지 확인해줘.",
            "DAY1_ICP_TURN_4: SPEC.md v0 현재 기준에는 어떤 현재 상태와 다음 검증 기준을 남겨야 해?",
            "DAY1_ICP_TURN_5: 5턴 대화의 결론으로 오늘 바로 실행할 우선순위 1개와 확인할 응답을 정리해줘.",
        ]
        for prompt in turns {
            appendInlineUITestStubResponse(prompt: prompt, sessionID: sessionID)
        }
    }

    private func inlineUITestStubResponse(for prompt: String) -> String {
        if prompt.contains("DAY1_ICP_TURN") {
            return [
                "고객 후보 문서 확인: 전업 1인 개발자, 수익 0원, macOS, 고객 인터뷰 의향이 있는 사용자로 가정했습니다.",
                "Day 1 응답: 현재 상태 진단을 먼저 하고, 기존 자산이 있으면 백지 상태의 고객 탐색 대신 빠른 경로로 SPEC.md v0 현재 기준과 다음 검증 기준을 정합니다.",
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
        case .gemini:
            if let value = firstNonEmptyEnvironmentValue(
                ["AGENTIC30_GEMINI_MODEL", "GEMINI_MODEL", "GOOGLE_GENAI_MODEL"],
                in: environment
            ) {
                return value
            }
            return KeychainHelper.loadSettings().preferredGeminiModel
        }
    }

    private func providerSettingsPayload(from settings: KeychainHelper.Settings) -> [String: Any] {
        [
            AgentProvider.claude.rawValue: [
                "authMode": AgentAuthMode.normalized(settings.claudeAuthMode, provider: .claude).rawValue,
                "apiKey": settings.claudeApiKey,
                "environment": settings.claudeEnvironment,
                "model": settings.preferredClaudeModel,
            ],
            AgentProvider.codex.rawValue: [
                "authMode": AgentAuthMode.normalized(settings.codexAuthMode, provider: .codex).rawValue,
                "apiKey": settings.codexApiKey,
                "environment": settings.codexEnvironment,
                "model": settings.preferredCodexModel,
            ],
            AgentProvider.gemini.rawValue: [
                "authMode": AgentAuthMode.normalized(settings.geminiAuthMode, provider: .gemini).rawValue,
                "apiKey": settings.geminiApiKey,
                "environment": settings.geminiEnvironment,
                "model": settings.preferredGeminiModel,
            ],
        ]
    }

    nonisolated private static func shellQuoted(_ value: String) -> String {
        "'\(value.replacingOccurrences(of: "'", with: "'\\''"))'"
    }

    nonisolated private static func appleScriptLiteral(_ value: String) -> String {
        "\"\(value.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "\"", with: "\\\""))\""
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

    #if DEBUG
    func replaceSessionsForTesting(_ sessions: [ChatSession], selectedSessionID: String? = nil) {
        self.sessions = sessions
        self.selectedSessionID = selectedSessionID ?? sessions.first?.id
    }

    func markSidecarConnectedForTesting(workspaceRoot: String) {
        self.workspaceRoot = workspaceRoot
        connectionLabel = "Connected"
        isConnected = true
        flushPendingProjectContextRefreshIfNeeded()
    }

    func applySessionUpdatedForTesting(_ session: ChatSession) {
        upsert(session)
    }

    func applySessionCreatedForTesting(_ session: ChatSession) {
        handleSessionCreated(session)
    }

    func applySidecarEventForTesting(_ event: SidecarEvent) {
        handle(event)
    }

    func applyCurriculumQuestionReframeForTesting(
        sessionId: String,
        questionId: String?,
        originalQuestion: String? = nil,
        reframedQuestion: String
    ) {
        let event = SidecarEvent(
            type: "curriculum_original_question_reframed",
            message: nil,
            sessionId: sessionId,
            messageId: nil,
            delta: nil,
            content: nil,
            workspaceRoot: nil,
            session: nil,
            sessions: nil,
            environment: nil,
            diagnostics: nil,
            bipCoach: nil,
            bipSetupReady: nil,
            day: nil,
            firstPrompt: nil,
            missingLocalDocs: nil,
            missingExternalRequirements: nil,
            nextIddDocumentType: nil,
            nextIddDocumentTitle: nil,
            bipSetupGateMessage: nil,
            scanRoot: nil,
            icp: nil,
            spec: nil,
            values: nil,
            designSystem: nil,
            adr: nil,
            goal: nil,
            docs: nil,
            sheet: nil,
            onboardingHypothesis: nil,
            error: nil,
            docType: nil,
            docPath: nil,
            progressText: nil,
            notionConnected: nil,
            success: nil,
            disconnected: nil,
            authUrl: nil,
            rowId: nil,
            status: nil,
            detail: nil,
            log: nil,
            readinessError: nil,
            bipTokenExpiredMessage: nil,
            resourceName: nil,
            resourceUrl: nil,
            stage: nil,
            provider: nil,
            sheetRowsRead: nil,
            docCharsRead: nil,
            elapsedMs: nil,
            phase: nil,
            toolName: nil,
            summary: nil,
            weeklyRitualPrompt: nil,
            requestEmit: nil,
            questionId: questionId,
            originalQuestion: originalQuestion,
            reframedQuestion: reframedQuestion
        )
        applyCurriculumQuestionReframe(event)
    }

    func setIddCurrentDocTypeForTesting(_ docType: String?) {
        iddCurrentDocType = docType
    }

    func recoverRunningSessionsForTesting(message: String) {
        markRunningSessionsRecoverableAfterSidecarExit(message: message)
    }

    func resetFoundationProgressForTesting() {
        foundationProgressState = FoundationProgressSnapshot(
            workspaceRoot: WorkspaceSettings.resolvedURL().path,
            startedAt: nil,
            selectedDay: 1,
            completedDays: []
        )
        foundationStartedAt = nil
    }

    func applyIddSetupProgressForTesting(
        sessionId: String,
        requestId: String,
        stage: String,
        progressText: String,
        elapsedMs: Int? = nil
    ) {
        let event = SidecarEvent(
            type: "idd_setup_progress",
            message: nil,
            sessionId: sessionId,
            requestId: requestId,
            messageId: nil,
            delta: nil,
            content: nil,
            workspaceRoot: nil,
            session: nil,
            sessions: nil,
            environment: nil,
            diagnostics: nil,
            bipCoach: nil,
            bipSetupReady: nil,
            day: nil,
            firstPrompt: nil,
            missingLocalDocs: nil,
            missingExternalRequirements: nil,
            nextIddDocumentType: nil,
            nextIddDocumentTitle: nil,
            bipSetupGateMessage: nil,
            scanRoot: nil,
            icp: nil,
            spec: nil,
            values: nil,
            designSystem: nil,
            adr: nil,
            goal: nil,
            docs: nil,
            sheet: nil,
            onboardingHypothesis: nil,
            error: nil,
            docType: nil,
            docPath: nil,
            progressText: progressText,
            notionConnected: nil,
            success: nil,
            disconnected: nil,
            authUrl: nil,
            rowId: nil,
            status: nil,
            detail: nil,
            log: nil,
            readinessError: nil,
            bipTokenExpiredMessage: nil,
            resourceName: nil,
            resourceUrl: nil,
            stage: stage,
            provider: nil,
            sheetRowsRead: nil,
            docCharsRead: nil,
            elapsedMs: elapsedMs,
            phase: nil,
            toolName: nil,
            summary: nil,
            weeklyRitualPrompt: nil,
            requestEmit: nil
        )
        updateStructuredPromptSubmissionProgress(from: event)
    }

    func applyOfficeHoursLiveStatusForTesting(
        sessionId: String,
        stage: String,
        title: String? = nil,
        detail: String? = nil,
        progressText: String? = nil,
        requestId: String? = nil,
        elapsedMs: Int? = nil
    ) {
        let status = OfficeHoursLiveStatus(
            sessionId: sessionId,
            stage: stage,
            title: title,
            detail: detail,
            progressText: progressText,
            messageId: nil,
            requestId: requestId,
            elapsedMs: elapsedMs,
            updatedAt: .now
        )
        officeHoursLiveStatusBySession[sessionId] = status
        if let progressText {
            appendSidecarOutput(sessionID: sessionId, summary: progressText)
        }
    }
    #endif

    private func upsert(_ session: ChatSession) {
        let session = sessionByApplyingCurriculumQuestionReframeGuards(to: sanitizedSessionSnapshot(session))
        reconcileStructuredPromptSubmissionState(with: session)
        reconcileStructuredPromptDraftState(with: session)
        reconcileOfficeHoursLiveStatus(with: session)
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

    private func handleSessionCreated(_ session: ChatSession) {
        replacementSessionCreateInFlight = false
        officeHoursSessionCreateInFlight = false
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

    private func sanitizedSessionSnapshot(_ session: ChatSession) -> ChatSession {
        guard session.pendingUserInput?.isLegacyStaticIddQuestion == true else {
            return session
        }
        var sanitized = session
        sanitized.pendingUserInput = nil
        if sanitized.status == .awaitingInput {
            sanitized.status = .running
        }
        return sanitized
    }

    private func reconcileStructuredPromptSubmissionState(with incoming: ChatSession) {
        guard let submitted = submittedStructuredPromptBySession[incoming.id] else { return }
        guard incoming.pendingUserInput?.requestId == submitted.requestId else {
            submittedStructuredPromptBySession.removeValue(forKey: incoming.id)
            return
        }
    }

    private func reconcileStructuredPromptDraftState(with incoming: ChatSession) {
        guard let prompt = incoming.pendingUserInput else {
            structuredPromptDraftBySession.removeValue(forKey: incoming.id)
            pruneCurriculumQuestionReframeRecords(sessionId: incoming.id)
            return
        }
        pruneCurriculumQuestionReframeRecords(sessionId: incoming.id, activePrompt: prompt)
        synchronizeStructuredPromptDrafts(with: prompt)
    }

    private func updateStructuredPromptSubmissionProgress(from event: SidecarEvent) {
        guard let sessionId = event.sessionId,
              let requestId = event.requestId,
              var submitted = submittedStructuredPromptBySession[sessionId],
              submitted.requestId == requestId else { return }

        if event.stage == "validation_error" {
            submittedStructuredPromptBySession.removeValue(forKey: sessionId)
            return
        }

        submitted.progressStage = event.stage
        submitted.progressText = event.progressText?.trimmingCharacters(in: .whitespacesAndNewlines).nonEmpty
        submitted.progressUpdatedAt = .now
        submitted.elapsedMs = event.elapsedMs
        submittedStructuredPromptBySession[sessionId] = submitted
    }

    // F6: when the sidecar advances the IDD rubric to a new signal, the
    // follow-up card arrives with generation.dimensionTransitioned=true and a
    // previousSignalLabel describing the dimension just completed. Show a
    // 3-second toast in the Foundation surface so the user perceives forward
    // motion ("좋아요. 좁히기 완료 → 직접 만날 사람으로 넘어갑니다.") instead of
    // feeling stuck on yet another card.
    struct DimensionTransitionToast: Identifiable, Equatable {
        let id = UUID()
        let from: String
        let to: String
    }

    private func detectDimensionTransitionToast(in session: ChatSession) {
        guard let prompt = session.pendingUserInput else { return }
        guard prompt.generation?.dimensionTransitioned == true else { return }
        guard let from = prompt.generation?.previousSignalLabel?.trimmingCharacters(in: .whitespacesAndNewlines), !from.isEmpty,
              let to = prompt.generation?.signalLabel?.trimmingCharacters(in: .whitespacesAndNewlines), !to.isEmpty else {
            return
        }
        let toast = DimensionTransitionToast(from: from, to: to)
        dimensionTransitionToast = toast
        Task { [weak self] in
            try? await Task.sleep(nanoseconds: 3_000_000_000)
            await MainActor.run {
                guard let self else { return }
                if self.dimensionTransitionToast?.id == toast.id {
                    self.dimensionTransitionToast = nil
                }
            }
        }
    }

    private func applyCurriculumQuestionReframe(_ event: SidecarEvent) {
        guard let sessionId = event.sessionId,
              let reframedQuestion = event.reframedQuestion?.trimmingCharacters(in: .whitespacesAndNewlines).nonEmpty,
              let index = sessions.firstIndex(where: { $0.id == sessionId }) else { return }

        var session = sessions[index]
        let targetQuestionId = event.questionId?.trimmingCharacters(in: .whitespacesAndNewlines).nonEmpty
        var didApply = false

        if let pendingUserInput = session.pendingUserInput,
           let questionIndex = indexOfQuestionToReframe(
                in: pendingUserInput.questions,
                targetQuestionId: targetQuestionId,
                originalQuestion: event.originalQuestion
           ) {
            var questions = pendingUserInput.questions
            let existing = questions[questionIndex]
            questions[questionIndex] = existing.replacingQuestionText(
                reframedQuestion,
                preservingIdentity: existing.id
            )
            session.pendingUserInput = StructuredPromptRequest(
                requestId: pendingUserInput.requestId,
                sessionId: pendingUserInput.sessionId,
                toolName: pendingUserInput.toolName,
                title: pendingUserInput.title,
                createdAt: pendingUserInput.createdAt,
                intro: pendingUserInput.intro,
                resources: pendingUserInput.resources,
                questions: questions,
                generation: pendingUserInput.generation
            )
            recordCurriculumQuestionReframe(
                sessionId: session.id,
                requestId: pendingUserInput.requestId,
                questionId: existing.id,
                reframedQuestion: reframedQuestion
            )
            didApply = true
        }

        session = sessionByApplyingCurriculumQuestionReframeGuards(to: session)

        session.messages = session.messages.map { message in
            guard let inlineDecision = message.inlineDecision,
                  shouldReframeQuestion(
                    inlineDecision,
                    targetQuestionId: targetQuestionId,
                    originalQuestion: event.originalQuestion
                  ) else {
                return message
            }
            var updated = message
            updated.inlineDecision = inlineDecision.replacingQuestionText(
                reframedQuestion,
                preservingIdentity: inlineDecision.id
            )
            if updated.content == inlineDecision.question {
                updated.content = reframedQuestion
            }
            didApply = true
            return updated
        }

        guard didApply else { return }
        var updatedSessions = sessions
        updatedSessions[index] = session
        sessions = updatedSessions
        reconcileStructuredPromptDraftState(with: session)
    }

    private func indexOfQuestionToReframe(
        in questions: [StructuredPromptQuestion],
        targetQuestionId: String?,
        originalQuestion: String?
    ) -> Int? {
        if let targetQuestionId {
            return questions.firstIndex { $0.id == targetQuestionId || $0.questionId == targetQuestionId }
        }
        if let originalQuestion = originalQuestion?.trimmingCharacters(in: .whitespacesAndNewlines).nonEmpty {
            return questions.firstIndex { $0.question == originalQuestion }
        }
        return questions.count == 1 ? questions.startIndex : nil
    }

    private func shouldReframeQuestion(
        _ question: StructuredPromptQuestion,
        targetQuestionId: String?,
        originalQuestion: String?
    ) -> Bool {
        if let targetQuestionId {
            return question.id == targetQuestionId || question.questionId == targetQuestionId
        }
        if let originalQuestion = originalQuestion?.trimmingCharacters(in: .whitespacesAndNewlines).nonEmpty {
            return question.question == originalQuestion
        }
        return false
    }

    private func sessionByApplyingCurriculumQuestionReframeGuards(to session: ChatSession) -> ChatSession {
        guard let prompt = session.pendingUserInput else { return session }
        var seenQuestionIds = Set<String>()
        var questions: [StructuredPromptQuestion] = []
        var didChange = false

        for question in prompt.questions {
            let questionId = question.id
            guard seenQuestionIds.insert(questionId).inserted else {
                didChange = true
                continue
            }

            guard let record = latestCurriculumQuestionReframesByKey[curriculumQuestionReframeKey(
                sessionId: session.id,
                requestId: prompt.requestId,
                questionId: questionId
            )] else {
                questions.append(question)
                continue
            }

            if question.question == record.reframedQuestion {
                questions.append(question)
            } else {
                questions.append(question.replacingQuestionText(
                    record.reframedQuestion,
                    preservingIdentity: questionId
                ))
                didChange = true
            }
        }

        guard didChange else { return session }
        var updated = session
        updated.pendingUserInput = StructuredPromptRequest(
            requestId: prompt.requestId,
            sessionId: prompt.sessionId,
            toolName: prompt.toolName,
            title: prompt.title,
            createdAt: prompt.createdAt,
            intro: prompt.intro,
            resources: prompt.resources,
            questions: questions,
            generation: prompt.generation
        )
        return updated
    }

    private func recordCurriculumQuestionReframe(
        sessionId: String,
        requestId: String,
        questionId: String,
        reframedQuestion: String
    ) {
        latestCurriculumQuestionReframesByKey[curriculumQuestionReframeKey(
            sessionId: sessionId,
            requestId: requestId,
            questionId: questionId
        )] = CurriculumQuestionReframeRecord(
            sessionId: sessionId,
            requestId: requestId,
            questionId: questionId,
            reframedQuestion: reframedQuestion
        )
    }

    private func pruneCurriculumQuestionReframeRecords(
        sessionId: String,
        activePrompt: StructuredPromptRequest? = nil
    ) {
        latestCurriculumQuestionReframesByKey = latestCurriculumQuestionReframesByKey.filter { _, record in
            guard record.sessionId == sessionId else { return true }
            guard let activePrompt else { return false }
            guard record.requestId == activePrompt.requestId else { return false }
            return activePrompt.questions.contains { $0.id == record.questionId }
        }
    }

    private func curriculumQuestionReframeKey(
        sessionId: String,
        requestId: String,
        questionId: String
    ) -> String {
        [sessionId, requestId, questionId].joined(separator: "\u{1F}")
    }

    private func mergeSessionSnapshot(_ incoming: ChatSession, into current: ChatSession) -> ChatSession {
        var merged = incoming
        let currentMessagesByID = Dictionary(uniqueKeysWithValues: current.messages.map { ($0.id, $0) })
        let incomingMessageIDs = Set(incoming.messages.map { $0.id })
        // Preserve client-only seeded messages (currently the Foundation
        // Day 0/2-7 first prompt opener — see Sub-AC 2.4) when the sidecar
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
            // Preserve a freshly-applied inlineDecision (reframe/structured prompt)
            // when the incoming snapshot is stale and would otherwise null it out.
            if incoming.inlineDecision == nil, current.inlineDecision != nil {
                merged.inlineDecision = current.inlineDecision
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

    private func shouldRecoverRunningSessions(forGlobalSidecarError message: String?) -> Bool {
        let value = (message ?? "").lowercased()
        return value.contains("sidecar connection closed")
            || value.contains("sidecar stopped")
            || value.contains("sidecar is not connected")
            || value.contains("failed to start sidecar")
    }

    private func markRunningSessionsRecoverableAfterSidecarExit(message: String) {
        let recoveryText = "응답이 끝나기 전에 실행 보조 앱이 중단됐습니다. 실행 보조 앱을 다시 시작합니다. 이어지지 않으면 이 요청을 다시 시도하세요."
        var changed = false
        var recoveredCount = 0
        for index in sessions.indices {
            let hasStreamingMessage = sessions[index].messages.contains(where: { $0.state == .streaming })
            guard sessions[index].status == .running || hasStreamingMessage else { continue }

            if let messageIndex = sessions[index].messages.lastIndex(where: { $0.role == .assistant && $0.state == .streaming }) {
                if sessions[index].messages[messageIndex].content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    sessions[index].messages[messageIndex].content = recoveryText
                }
                sessions[index].messages[messageIndex].state = .error
                sessions[index].messages[messageIndex].error = message
            } else {
                sessions[index].messages.append(ChatMessage(
                    id: UUID().uuidString,
                    role: .assistant,
                    provider: sessions[index].provider,
                    content: recoveryText,
                    state: .error,
                    createdAt: Date(),
                    error: message,
                    bipMissionChoices: nil,
                    providerAuthActions: nil
                ))
            }
            sessions[index].status = .error
            sessions[index].error = message
            sessions[index].updatedAt = .now
            changed = true
            recoveredCount += 1
        }

        if changed {
            isBipCoachRefreshing = false
            isBipCoachGenerating = false
            isBipCoachCompleting = false
            bipMissionProgress = nil
            PostHogTelemetry.capture("mac_sidecar_running_sessions_recovered", properties: [
                "session_count": recoveredCount,
            ], authSession: macAuthSession)
        }
    }

    private func appendSidecarOutput(sessionID: String, event: SidecarEvent) {
        let summary = (event.summary ?? event.fallbackToolSummary)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        appendSidecarOutput(sessionID: sessionID, summary: summary)
    }

    private func appendSidecarOutput(sessionID: String, summary: String) {
        let summary = summary.trimmingCharacters(in: .whitespacesAndNewlines)
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

    private func applyOfficeHoursLiveStatus(from event: SidecarEvent) {
        guard let status = event.officeHoursLiveStatus else { return }
        officeHoursLiveStatusBySession[status.sessionId] = status
        if let progressText = status.progressText {
            appendSidecarOutput(sessionID: status.sessionId, summary: progressText)
        }
        maybePostQuestionReadyNotification(for: status)
    }

    /// requestIds already turned into a local notification this app run; the
    /// sidecar re-broadcasts `question_ready` (250ms poller + end-of-run emit)
    /// for the same request, so dedupe must outlive the live-status entry.
    private var notifiedQuestionReadyRequestIds: Set<String> = []

    private func maybePostQuestionReadyNotification(for status: OfficeHoursLiveStatus) {
        guard OfficeHoursQuestionReadyNotifier.shouldNotify(
            stage: status.stage,
            requestId: status.requestId,
            title: status.title,
            alreadyNotifiedRequestIds: notifiedQuestionReadyRequestIds,
            isAppActive: NSApp.isActive,
            isEnabled: isQuestionReadyNotificationEnabled,
            isUITesting: Self.isUITestingOrStubProviderLaunch()
        ), let requestId = status.requestId, let title = status.title else { return }

        notifiedQuestionReadyRequestIds.insert(requestId)
        Task {
            await postQuestionReadyNotification(
                sessionId: status.sessionId,
                requestId: requestId,
                title: title,
                body: status.detail
            )
        }
    }

    private nonisolated static func isUITestingOrStubProviderLaunch() -> Bool {
        CommandLine.arguments.contains { $0.hasPrefix("--ui-testing") }
            || ProcessInfo.processInfo.environment["AGENTIC30_TEST_STUB_PROVIDER"] == "1"
    }

    private func postQuestionReadyNotification(
        sessionId: String,
        requestId: String,
        title: String,
        body: String?
    ) async {
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

        let content = UNMutableNotificationContent()
        content.title = title
        if let body {
            content.body = body
        }
        content.sound = .default
        content.userInfo = [
            OfficeHoursQuestionReadyNotification.sessionIdUserInfoKey: sessionId,
        ]

        try? await center.add(UNNotificationRequest(
            identifier: OfficeHoursQuestionReadyNotification.notificationIdentifier(requestId: requestId),
            content: content,
            trigger: nil
        ))
        PostHogTelemetry.capture(
            "mac_office_hours_question_ready_notification_posted",
            authSession: macAuthSession
        )
    }

    private func reconcileOfficeHoursLiveStatus(with session: ChatSession) {
        guard officeHoursLiveStatusBySession[session.id] != nil else { return }
        if session.pendingUserInput != nil || session.status == .idle || session.status == .error {
            officeHoursLiveStatusBySession.removeValue(forKey: session.id)
        }
    }

    private func reconcileOfficeHoursLiveStatuses(with sessions: [ChatSession]) {
        guard !officeHoursLiveStatusBySession.isEmpty else { return }
        let sessionsByID = Dictionary(uniqueKeysWithValues: sessions.map { ($0.id, $0) })
        officeHoursLiveStatusBySession = officeHoursLiveStatusBySession.filter { sessionID, _ in
            guard let session = sessionsByID[sessionID] else { return false }
            return session.pendingUserInput == nil && session.status == .running
        }
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

    private func hydrateWorkspaceRootFromSettingsIfAvailable() {
        guard WorkspaceSettings.hasExplicitWorkspace else { return }
        workspaceRoot = WorkspaceSettings.resolvedURL().path
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
            businessDescription: "Agentic30 직접 사용 워크스페이스",
            currentStage: "First users and onboarding validation",
            goal: "Complete Day 1 and verify curriculum setup",
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
            if arguments.contains("--ui-testing-disable-sidecar") || arguments.contains("--ui-testing-seed-workspace-scan-cache") {
                WorkspaceScanResultStore(workspaceRoot: workspacePath).save(makeUITestingWorkspaceScanResult(arguments: arguments))
            }
        }
    }

    private static func makeUITestingWorkspaceScanResult(arguments: [String]) -> WorkspaceScanResult {
        let usesAlignmentPlan = arguments.contains("--ui-testing-seed-day1-alignment-plan")
        let usesSituationSummary = arguments.contains("--ui-testing-seed-day1-situation-summary")
        return WorkspaceScanResult(
            icp: "docs/ICP.md",
            spec: "docs/SPEC.md",
            values: "docs/VALUES.md",
            designSystem: nil,
            adr: nil,
            goal: "docs/GOAL.md",
            docs: "README.md",
            sheet: nil,
            onboardingHypothesis: WorkspaceOnboardingHypothesis(
                productName: "Agentic30",
                projectKind: "mac_app",
                targetUser: "1인 빌더",
                problem: "첫 고객 기준이 흔들림",
                purpose: "Day 1 고객 후보 검증",
                goal: "인터뷰할 고객 후보 1명을 고정",
                values: nil,
                likelyUsers: ["1인 빌더", "macOS AI 도구 사용자"],
                stage: "first_users",
                evidence: ["README.md", "docs/ICP.md"],
                confidence: "high",
                suggestedFirstQuestion: nil
            ),
            day1AlignmentPlan: usesAlignmentPlan ? makeUITestingDay1AlignmentPlan() : nil,
            day1IcpPlan: makeUITestingDay1IcpPlan(),
            day1SituationSummary: usesSituationSummary ? makeUITestingDay1SituationSummary() : nil,
            day1GoalSelection: nil,
            error: nil
        )
    }

    private static func makeUITestingDay1SituationSummary() -> Day1SituationSummary {
        Day1SituationSummary(
            schemaVersion: 3,
            source: "local_evidence",
            generatedAt: nil,
            project: Day1SituationSummary.Project(
                name: "Agentic30",
                oneLine: "Agentic30: Day 1 고객 검증을 돕는 macOS 앱입니다.",
                customer: "1인 빌더",
                problem: "첫 고객 기준이 흔들림",
                evidenceRefs: ["README.md (README)", "docs/ICP.md (고객 후보)"]
            ),
            diagnosis: Day1SituationSummary.Diagnosis(
                stage: "초기 사용자 검증",
                bottleneck: "측정 기준 근거가 부족함",
                whyNow: "첫 가치 이벤트와 유입 기준을 정해야 합니다.",
                missingSignal: "측정 기준",
                confidence: 0.82,
                evidenceRefs: ["README.md", "docs/ICP.md"]
            ),
            realityGap: Day1SituationSummary.RealityGap(
                docClaim: "README는 초기 가설 중심입니다.",
                observedReality: "Day 1 검증, 온보딩, 계측",
                recommendation: "검증 행동과 계측 기준을 문서에 반영해야 다음 판단이 맞아집니다.",
                evidenceRefs: ["README.md", "git/agent recent work"]
            ),
            baseline: Day1SituationSummary.Baseline(
                target: "인터뷰 5명과 첫 유료 신호",
                current: "초기 사용자 검증: 측정 기준 근거가 부족함",
                day30Question: "30일 뒤 인터뷰 5명, 첫 유료 신호 근거가 실제로 남았나요?",
                metrics: ["인터뷰 5명", "첫 유료 신호"]
            ),
            path: [
                Day1SituationSummary.PathNode(label: "고객 인터뷰", kind: "customer_action", status: "found", why: "docs/ICP.md에 고객 인터뷰 검증 흐름이 있습니다.", evidenceRefs: ["docs/ICP.md"]),
                Day1SituationSummary.PathNode(label: "첫 유료 신호", kind: "conversion", status: "found", why: "docs/GOAL.md에 첫 유료 신호 목표가 있습니다.", evidenceRefs: ["docs/GOAL.md"])
            ],
            actions: [
                Day1SituationSummary.Action(id: "customer-interview", label: "고객 인터뷰", rationale: "첫 고객 기준을 실제 대화로 확인합니다.", kind: "customer_action", promptSeed: "이번 주 고객 인터뷰로 무엇을 확인할까요?", evidenceRefs: ["docs/ICP.md"], evidenceLimited: false),
                Day1SituationSummary.Action(id: "paid-signal", label: "유료 신호", rationale: "돈이나 시간을 쓰는 반응을 오늘 남깁니다.", kind: "conversion", promptSeed: "첫 유료 신호를 어떤 행동으로 확인할까요?", evidenceRefs: ["docs/GOAL.md"], evidenceLimited: false)
            ],
            qualityGate: Day1SituationSummary.QualityGate(
                score: 8.2,
                passed: true,
                reasons: ["고객과 문제가 근거에서 확인됨", "관찰할 행동 신호 후보가 있음"]
            ),
            trust: Day1SituationSummary.Trust(
                readOnly: true,
                secretsExcluded: true,
                sourcesUsed: ["onboarding hypothesis", "docs/source"]
            )
        )
    }

    private static func makeUITestingDay1AlignmentPlan() -> Day1AlignmentPlan {
        let documentPointer = "[ALIGNMENT.md](./ALIGNMENT.md) — 회사 미션 ↔ 제품 매핑, 5축 루브릭"
        let signals = Day1IcpSignals(
            productName: "Agentic30",
            currentIcpGuess: "AI 코딩 도구를 쓰는 개발자",
            likelyUsers: ["AI 코딩 도구를 쓰는 개발자", "macOS AI 도구 사용자"],
            problem: "무엇을 팔아야 할지 모른다",
            currentAlternatives: ["수동 문서 정리", "임시 스크립트"],
            evidenceRefs: [
                Day1IcpEvidenceRef(path: "README.md", reason: "앱 목적", quote: "Native macOS menu bar assistant"),
                Day1IcpEvidenceRef(path: "docs/ICP.md", reason: "고객 가설", quote: "AI 코딩 도구를 쓰는 개발자"),
            ],
            missingAssumptions: ["지불 의향", "첫 사용자 획득 채널"],
            confidence: "high"
        )
        let icp = Day1AlignmentComponent(
            id: "icp",
            title: "고객",
            prompt: "이 목표를 검증하려면 이번 주 가장 먼저 확인할 고객은 누구인가요?",
            helperText: "직함보다 지금 같은 문제를 겪고, 이번 주 실제로 물어볼 수 있는 고객 조건을 고릅니다.",
            statement: documentPointer,
            evidence: ["docs/ICP.md"],
            missingAssumptions: [],
            options: [
                Day1IcpQuestionOption(id: "dev-tool-user", label: "AI 코딩 도구를 쓰는 개발자", description: "이번 주 직접 대화 가능한 사용자입니다. · 근거: docs/ICP.md", preview: "고객", antiSignal: false, evidenceLabel: "근거: docs/ICP.md", evidenceLimited: false),
                Day1IcpQuestionOption(id: "solo-builder", label: "1인 빌더", description: "구매자와 사용자가 같은 후보입니다. · 근거: README.md", preview: "고객", antiSignal: false, evidenceLabel: "근거: README.md", evidenceLimited: false),
                Day1IcpQuestionOption(id: "curious-only", label: "관심만 있음", description: "최근 행동이 없어 다음 시장 신호로 약합니다.", preview: "Weak", antiSignal: true, evidenceLabel: "근거 부족", evidenceLimited: true),
            ]
        )
        let pain = Day1AlignmentComponent(
            id: "pain_point",
            title: "문제",
            prompt: "이 고객이 지금 겪는 가장 압축된 문제는 무엇인가요?",
            helperText: "시간, 돈, 리스크, 반복 행동으로 이미 비용이 나는 문제를 고릅니다.",
            statement: "무엇을 팔아야 할지 모른다",
            evidence: ["docs/SPEC.md"],
            missingAssumptions: [],
            options: [
                Day1IcpQuestionOption(id: "what-to-sell", label: "무엇을 팔아야 할지 모름", description: "검증 없이 빌드가 반복됩니다. · 근거: docs/SPEC.md", preview: "문제", antiSignal: false, evidenceLabel: "근거: docs/SPEC.md", evidenceLimited: false),
                Day1IcpQuestionOption(id: "first-user", label: "첫 사용자를 어디서 데려올지 모름", description: "다음 시장 신호 확인으로 이어집니다. · 근거: docs/GOAL.md", preview: "문제", antiSignal: false, evidenceLabel: "근거: docs/GOAL.md", evidenceLimited: false),
                Day1IcpQuestionOption(id: "nice-to-have", label: "있으면 좋음", description: "오늘 비용이 확인되지 않습니다.", preview: "Weak", antiSignal: true, evidenceLabel: "근거 부족", evidenceLimited: true),
            ]
        )
        let outcome = Day1AlignmentComponent(
            id: "outcome",
            title: "확인할 행동",
            prompt: "그 고객에게서 어떤 행동 신호를 확인해야 하나요?",
            helperText: "제품 기능이 아니라 지불 의향, 현재 대안, 최근 사건처럼 관찰 가능한 행동을 씁니다.",
            statement: "첫 대화에서 지불 의향과 현재 대안을 확인한다",
            evidence: ["docs/GOAL.md"],
            missingAssumptions: [],
            options: [
                Day1IcpQuestionOption(id: "paid-alternative", label: "첫 대화에서 지불 의향과 대안을 확인한다", description: "다음 시장 신호 확인에서 바로 검증할 수 있습니다. · 근거: docs/GOAL.md", preview: "확인할 행동", antiSignal: false, evidenceLabel: "근거: docs/GOAL.md", evidenceLimited: false),
                Day1IcpQuestionOption(id: "market-signal", label: "시장 신호로 첫 사용자 획득 행동을 확인한다", description: "채널과 행동이 함께 남습니다. · 근거: docs/SPEC.md", preview: "확인할 행동", antiSignal: false, evidenceLabel: "근거: docs/SPEC.md", evidenceLimited: false),
                Day1IcpQuestionOption(id: "ship-feature", label: "기능을 더 만든다", description: "고객 검증 없이 빌드하는 선택입니다.", preview: "Anti", antiSignal: true, evidenceLabel: "근거 부족", evidenceLimited: true),
            ]
        )
        let projectGoal = "30일 안에 사용자 100명과 첫 매출 가능성을 검증한다"
        return Day1AlignmentPlan(
            schemaVersion: 1,
            source: "ui-test",
            generatedAt: "2026-05-22T00:00:00.000Z",
            confidence: 0.86,
            fellBackToDeterministic: false,
            projectGoal: projectGoal,
            mission: "Day 1 — 만들기 전에, 팔릴 문제를 고릅니다.\n오늘은 코딩하지 않습니다.\n30일 동안 검증할 고객, 문제, 첫 결제 이유를 한 문장으로 정합니다.",
            signals: signals,
            components: Day1AlignmentComponents(icp: icp, painPoint: pain, outcome: outcome),
            alignmentStatement: Day1AlignmentStatement(
                statement: "목표: \(projectGoal) / 고객: \(documentPointer) / 문제: 무엇을 팔아야 할지 모른다 / 확인할 행동: 첫 대화에서 지불 의향과 현재 대안을 확인한다",
                projectGoal: projectGoal,
                icp: documentPointer,
                painPoint: "무엇을 팔아야 할지 모른다",
                outcome: "첫 대화에서 지불 의향과 현재 대안을 확인한다"
            ),
            qualityGate: Day1AlignmentQualityGate(
                score: 8.6,
                threshold: 7.0,
                passed: true,
                label: "PASS",
                passGate: "목표, 고객, 문제, 확인할 행동이 담긴 핵심 가설이 7.0/10 이상입니다.",
                failGate: "목표, 고객, 문제, 확인할 행동 중 하나가 비어 있습니다.",
                criteria: [
                    Day1AlignmentQualityCriterion(id: "project_goal", label: "목표", score: 2.0, maxScore: 2.0, passed: true, detail: "명확함"),
                    Day1AlignmentQualityCriterion(id: "icp", label: "고객", score: 2.2, maxScore: 2.5, passed: true, detail: documentPointer),
                ]
            ),
            firstInterviewMessage: FirstInterviewMessage(
                channel: "DM",
                recipientPlaceholder: "{name}",
                subject: "핵심 가설 인터뷰",
                bodyTemplate: "안녕하세요 {name}님, AI 코딩 도구로 첫 고객 검증을 확인하고 있습니다.",
                questions: ["최근 사건은 무엇이었나요?", "현재 대안은 무엇인가요?"]
            ),
            day2Handoff: Day1Day2Handoff(
                title: "Day 2 시장 신호로 넘길 핵심 가설",
                body: "유료 대체재와 첫 사용자 획득 행동을 확인합니다.",
                focus: "지불 의향과 현재 대안",
                nextDayPrompt: "유료 대체재 5개와 실제 대화 후보를 확인한다.",
                qualityGateLabel: "PASS 8.6/10"
            ),
            signalDigest: nil
        )
    }

    private static func makeUITestingDay1IcpPlan() -> Day1IcpPlan {
        let optionSets: [[Day1IcpQuestionOption]] = [
            [
                Day1IcpQuestionOption(id: "solo-builder", label: "전업 1인 빌더", description: "이번 주 실제 고객 인터뷰를 잡아야 합니다. · 근거: docs/ICP.md", preview: "고객 후보", antiSignal: false, evidenceLabel: "근거: docs/ICP.md", evidenceLimited: false),
                Day1IcpQuestionOption(id: "tool-switcher", label: "AI 도구 전환 사용자", description: "Codex와 Claude 전환에서 인증/실행 마찰을 겪습니다. · 근거: README.md", preview: "Have", antiSignal: false, evidenceLabel: "근거: README.md", evidenceLimited: false),
                Day1IcpQuestionOption(id: "curious-only", label: "관심만 있음", description: "최근 7일 안에 직접 시도한 사건이 없습니다.", preview: "Anti", antiSignal: true, evidenceLabel: "근거 부족", evidenceLimited: true),
            ],
            [
                Day1IcpQuestionOption(id: "stuck-loop", label: "빌드 루프에 막힘", description: "검증 없이 새 기능을 반복해서 만들고 있습니다. · 근거: docs/GOAL.md", preview: "Pain", antiSignal: false, evidenceLabel: "근거: docs/GOAL.md", evidenceLimited: false),
                Day1IcpQuestionOption(id: "auth-friction", label: "AI 연결 인증 실패", description: "로컬 실행 보조 앱과 AI 연결 인증 사이에서 진행이 멈춥니다. · 근거: README.md", preview: "문제", antiSignal: false, evidenceLabel: "근거: README.md", evidenceLimited: false),
                Day1IcpQuestionOption(id: "nice-to-have", label: "있으면 좋음", description: "돈이나 시간을 이미 쓰는 대안이 없습니다.", preview: "Weak", antiSignal: true, evidenceLabel: "근거 부족", evidenceLimited: true),
            ],
            [
                Day1IcpQuestionOption(id: "manual-notes", label: "수동 노트/스크립트", description: "현재는 문서와 임시 스크립트로 Day 진행을 관리합니다. · 근거: docs/SPEC.md", preview: "Have", antiSignal: false, evidenceLabel: "근거: docs/SPEC.md", evidenceLimited: false),
                Day1IcpQuestionOption(id: "codex-menu-bar", label: "macOS 메뉴바 앱", description: "반복 실행과 재시작 복원이 필요한 작업 흐름입니다. · 근거: README.md", preview: "Have", antiSignal: false, evidenceLabel: "근거: README.md", evidenceLimited: false),
                Day1IcpQuestionOption(id: "blank-slate", label: "아직 프로젝트 없음", description: "선택한 workspace에 실제 검증 대상이 없습니다.", preview: "Anti", antiSignal: true, evidenceLabel: "근거 부족", evidenceLimited: true),
            ],
            [
                Day1IcpQuestionOption(id: "schedule-call", label: "24시간 안에 인터뷰 요청", description: "오늘 바로 연락 가능한 후보가 있습니다. · 근거: docs/ICP.md", preview: "결과", antiSignal: false, evidenceLabel: "근거: docs/ICP.md", evidenceLimited: false),
                Day1IcpQuestionOption(id: "capture-proof", label: "첫 반응 캡처", description: "대화 결과를 SPEC/고객 후보 문서에 바로 남길 수 있습니다. · 근거: docs/SPEC.md", preview: "결과", antiSignal: false, evidenceLabel: "근거: docs/SPEC.md", evidenceLimited: false),
                Day1IcpQuestionOption(id: "wait-for-launch", label: "출시 후에 보기", description: "오늘 검증할 행동이 없어 Day 1 게이트를 닫을 수 없습니다.", preview: "Anti", antiSignal: true, evidenceLabel: "근거 부족", evidenceLimited: true),
            ],
        ]
        let dimensions = [
            ("icp", "먼저 도울 사람", "이번 주 인터뷰할 고객 후보는 누구인가요?"),
            ("pain_point", "반복되는 막힘", "최근 실제로 멈춘 문제는 무엇인가요?"),
            ("current_alternative", "현재 대안", "지금은 어떤 방식으로 버티고 있나요?"),
            ("outcome", "다음 검증 결과", "다음 검증으로 넘길 확인 가능한 결과는 무엇인가요?"),
        ]
        let questions = dimensions.enumerated().map { index, item in
            Day1IcpQuestion(
                id: "ui_test_\(item.0)",
                dimension: item.0,
                title: item.1,
                prompt: item.2,
                helperText: "UI test scan cache fixture",
                options: optionSets[index],
                allowFreeText: true,
                freeTextPlaceholder: "직접 입력"
            )
        }
        return Day1IcpPlan(
            schemaVersion: 1,
            source: "ui-test",
            generatedAt: "2026-05-22T00:00:00.000Z",
            confidence: 0.87,
            fellBackToDeterministic: false,
            mission: "Day 1에서 실제 인터뷰로 이어질 고객 후보 v0를 고정합니다.",
            signals: Day1IcpSignals(
                productName: "Agentic30",
                currentIcpGuess: "첫 고객을 정해야 하는 1인 빌더",
                likelyUsers: ["1인 빌더", "macOS AI 도구 사용자"],
                problem: "첫 고객 기준이 재시작 후 사라짐",
                currentAlternatives: ["수동 문서 정리", "임시 스크립트"],
                evidenceRefs: [
                    Day1IcpEvidenceRef(path: "README.md", reason: "앱 목적", quote: "Native macOS menu bar assistant"),
                    Day1IcpEvidenceRef(path: "docs/ICP.md", reason: "고객 가설", quote: "1인 빌더"),
                ],
                missingAssumptions: ["유료 의향", "반복 빈도"],
                confidence: "high"
            ),
            questions: questions,
            icpDraft: IcpDraft(
                description: "첫 고객을 정해야 하는 1인 빌더",
                criteria: ["이번 주 인터뷰 가능", "이미 대안을 쓰고 있음", "최근 막힌 사건이 있음"],
                whyTheyMatter: ["Day 2 시장 신호와 Day 3 실제 행동 질문으로 이어집니다."],
                needs: ["재시작 후에도 Day 1 계획이 유지되어야 함"],
                haves: ["macOS workspace", "AI coding assistant 사용 경험"],
                dontNeeds: ["관심만 있음", "출시 후 검증하겠다는 후보"],
                evidence: ["README.md", "docs/ICP.md"],
                referenceCustomersToFind: ["전업 1인 빌더 1명"]
            ),
            antiIcp: Day1AntiIcp(
                summary: "최근 사건과 현재 대안이 없는 후보는 Day 1에서 제외합니다.",
                rules: [
                    AntiIcpRule(id: "curious-only", label: "관심만 있음", reason: "최근 7일 행동 신호가 없습니다.", evidenceRef: nil),
                    AntiIcpRule(id: "wait-for-launch", label: "출시 후에 보기", reason: "오늘 인터뷰로 검증할 수 없습니다.", evidenceRef: nil),
                ],
                politeInterestGuardrails: ["좋네요만 말하면 고객 후보로 보지 않습니다."]
            ),
            firstInterviewMessage: FirstInterviewMessage(
                channel: "DM",
                recipientPlaceholder: "{name}",
                subject: nil,
                bodyTemplate: "최근 AI 도구로 프로젝트를 진행하다가 멈춘 순간이 있었나요?",
                questions: ["최근 사건은 무엇이었나요?", "지금은 무엇으로 대체하고 있나요?"]
            )
        )
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
        let clamped = max(1, min(day, 30))
        return hasCompletedDays(through: Self.requiredCompletionDayForUnlocking(day: clamped))
    }

    func isWeekUnlocked(_ week: Int) -> Bool {
        hasCompletedDays(through: Self.requiredCompletionDayForWeek(week))
    }

    func unlockRequirementLabel(forWeek week: Int) -> String? {
        let requiredDay = Self.requiredCompletionDayForWeek(week)
        guard requiredDay > 0 else { return nil }
        return "D\(requiredDay)"
    }

    func nextUnlockedIncompleteDay(after day: Int) -> Int? {
        let clamped = max(1, min(day, 30))
        let laterDays = clamped < 30 ? Array((clamped + 1)...30) : []
        let earlierDays = Array(1...clamped)
        return (laterDays + earlierDays).first { candidate in
            isUnlocked(candidate) && !completedDays.contains(candidate)
        }
    }

    private func hasCompletedDays(through requiredDay: Int) -> Bool {
        guard requiredDay > 0 else { return true }
        return (1...requiredDay).allSatisfy { completedDays.contains($0) }
    }

    private static func requiredCompletionDayForUnlocking(day: Int) -> Int {
        switch day {
        case 1...7:
            return 0
        case 8...14:
            return 7
        case 15...21:
            return 14
        default:
            return 21
        }
    }

    private static func requiredCompletionDayForWeek(_ week: Int) -> Int {
        switch week {
        case ...1:
            return 0
        case 2:
            return 7
        case 3:
            return 14
        default:
            return 21
        }
    }

    var presentationDestination: FoundationCurriculumPresentationDestination {
        if completedDays.contains(30) {
            return .graduation
        }
        return .curriculumDay(max(1, min(selectedDay, 30)))
    }
}

nonisolated enum FoundationCurriculumPresentationDestination: Hashable {
    case curriculumDay(Int)
    case graduation
}

enum FoundationCurriculumLifecycleTransition: Hashable {
    case curriculumDay(Int)
    case graduation
}

struct FoundationCurriculumSurfaceVisibilitySnapshot: Hashable {
    let applicationIsRunning: Bool
    let activeMenubarSurfaceIsVisible: Bool
}

struct MacMenubarItemRegistrationSnapshot: Hashable {
    let isRegistered: Bool
}

struct MacMenubarItemController {
    private let menuBarItemIsRegistered: @MainActor () -> Bool
    private let unregisterMenuBarItem: @MainActor () -> Void

    init(
        menuBarItemIsRegistered: @escaping @MainActor () -> Bool = { true },
        unregisterMenuBarItem: @escaping @MainActor () -> Void = {}
    ) {
        self.menuBarItemIsRegistered = menuBarItemIsRegistered
        self.unregisterMenuBarItem = unregisterMenuBarItem
    }

    @MainActor
    func enterCompletedOrGraduatedState() -> MacMenubarItemRegistrationSnapshot {
        MacMenubarItemRegistrationSnapshot(isRegistered: menuBarItemIsRegistered())
    }

    @MainActor
    func unregisterFromExplicitApplicationTeardown() {
        unregisterMenuBarItem()
    }
}

struct FoundationCurriculumSurfaceVisibilityController {
    private let applicationIsRunning: @MainActor () -> Bool
    private let activeMenubarSurfaceIsVisible: @MainActor () -> Bool
    private let hideApplication: @MainActor () -> Void
    private let hideActiveMenubarSurface: @MainActor () -> Void

    init(
        applicationIsRunning: @escaping @MainActor () -> Bool = { true },
        activeMenubarSurfaceIsVisible: @escaping @MainActor () -> Bool = { true },
        hideApplication: @escaping @MainActor () -> Void = {},
        hideActiveMenubarSurface: @escaping @MainActor () -> Void = {}
    ) {
        self.applicationIsRunning = applicationIsRunning
        self.activeMenubarSurfaceIsVisible = activeMenubarSurfaceIsVisible
        self.hideApplication = hideApplication
        self.hideActiveMenubarSurface = hideActiveMenubarSurface
    }

    @MainActor
    func enterCompletedOrGraduatedState() -> FoundationCurriculumSurfaceVisibilitySnapshot {
        FoundationCurriculumSurfaceVisibilitySnapshot(
            applicationIsRunning: applicationIsRunning(),
            activeMenubarSurfaceIsVisible: activeMenubarSurfaceIsVisible()
        )
    }

    @MainActor
    func hideApplicationFromExplicitUserRequest() {
        hideApplication()
    }

    @MainActor
    func hideActiveMenubarSurfaceFromExplicitUserRequest() {
        hideActiveMenubarSurface()
    }
}

struct FoundationCurriculumLifecycleController {
    private let terminateApplication: @MainActor () -> Void
    private let quitApplication: @MainActor () -> Void
    private let surfaceVisibilityController: FoundationCurriculumSurfaceVisibilityController
    private let menubarItemController: MacMenubarItemController

    init(
        terminateApplication: @escaping @MainActor () -> Void = {},
        quitApplication: @escaping @MainActor () -> Void = {},
        surfaceVisibilityController: FoundationCurriculumSurfaceVisibilityController = FoundationCurriculumSurfaceVisibilityController(),
        menubarItemController: MacMenubarItemController = MacMenubarItemController()
    ) {
        self.terminateApplication = terminateApplication
        self.quitApplication = quitApplication
        self.surfaceVisibilityController = surfaceVisibilityController
        self.menubarItemController = menubarItemController
    }

    @MainActor
    func enterCompletedState(_ snapshot: FoundationProgressSnapshot) -> FoundationCurriculumLifecycleTransition {
        switch snapshot.presentationDestination {
        case .curriculumDay(let day):
            return .curriculumDay(day)
        case .graduation:
            _ = surfaceVisibilityController.enterCompletedOrGraduatedState()
            _ = menubarItemController.enterCompletedOrGraduatedState()
            return .graduation
        }
    }

    @MainActor
    func surfaceVisibilityAfterEnteringCompletedState(
        _ snapshot: FoundationProgressSnapshot
    ) -> FoundationCurriculumSurfaceVisibilitySnapshot? {
        guard snapshot.presentationDestination == .graduation else {
            return nil
        }
        return surfaceVisibilityController.enterCompletedOrGraduatedState()
    }

    @MainActor
    func menubarItemRegistrationAfterEnteringCompletedState(
        _ snapshot: FoundationProgressSnapshot
    ) -> MacMenubarItemRegistrationSnapshot? {
        guard snapshot.presentationDestination == .graduation else {
            return nil
        }
        return menubarItemController.enterCompletedOrGraduatedState()
    }

    @MainActor
    func terminateFromExplicitUserRequest() {
        terminateApplication()
    }

    @MainActor
    func quitFromExplicitUserRequest() {
        quitApplication()
    }

    @MainActor
    func hideApplicationFromExplicitUserRequest() {
        surfaceVisibilityController.hideApplicationFromExplicitUserRequest()
    }

    @MainActor
    func hideActiveMenubarSurfaceFromExplicitUserRequest() {
        surfaceVisibilityController.hideActiveMenubarSurfaceFromExplicitUserRequest()
    }
}

struct FoundationCurriculumPresentationViewModel: Hashable {
    let destination: FoundationCurriculumPresentationDestination

    init(snapshot: FoundationProgressSnapshot) {
        destination = snapshot.presentationDestination
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

struct WorkspaceScanResultStore {
    let workspaceRoot: String
    let appSupportURL: URL

    init(
        workspaceRoot: String,
        appSupportURL: URL = FoundationProgressStore.defaultAppSupportURL()
    ) {
        self.workspaceRoot = Self.normalizeWorkspaceRoot(workspaceRoot)
        self.appSupportURL = appSupportURL
    }

    var fileURL: URL {
        appSupportURL
            .appendingPathComponent("workspace-scan-results", isDirectory: true)
            .appendingPathComponent("\(FoundationProgressStore.stableWorkspaceID(workspaceRoot)).json")
    }

    func load() -> AgenticViewModel.WorkspaceScanResult? {
        guard let data = try? Data(contentsOf: fileURL) else { return nil }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        guard let payload = try? decoder.decode(Payload.self, from: data),
              payload.schemaVersion == Self.schemaVersion,
              Self.normalizeWorkspaceRoot(payload.workspaceRoot) == workspaceRoot,
              payload.scanResult.error == nil else {
            return nil
        }
        return payload.scanResult
    }

    func save(_ scanResult: AgenticViewModel.WorkspaceScanResult, now: Date = Date()) {
        guard scanResult.error == nil else { return }
        let payload = Payload(
            schemaVersion: Self.schemaVersion,
            workspaceRoot: workspaceRoot,
            savedAt: now,
            scanResult: scanResult
        )
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        guard let data = try? encoder.encode(payload) else { return }
        try? FileManager.default.createDirectory(
            at: fileURL.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        try? data.write(to: fileURL, options: [.atomic])
        try? FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: fileURL.path)
    }

    func clear() {
        try? FileManager.default.removeItem(at: fileURL)
    }

    private static let schemaVersion = 4

    private struct Payload: Codable {
        let schemaVersion: Int
        let workspaceRoot: String
        let savedAt: Date
        let scanResult: AgenticViewModel.WorkspaceScanResult
    }

    private static func normalizeWorkspaceRoot(_ root: String) -> String {
        URL(fileURLWithPath: root, isDirectory: true).standardizedFileURL.path
    }
}

struct FoundationDayCompletionSaveResult: Hashable {
    let completedDay: Int
    let unlockedDay: Int
    let snapshot: FoundationProgressSnapshot
}

struct FoundationDayCompletionSaveHandler {
    let store: FoundationProgressStore?

    func saveDayCompletion(
        _ day: Int,
        snapshot: FoundationProgressSnapshot,
        workspaceRoot: String
    ) -> FoundationDayCompletionSaveResult {
        let completedDay = max(1, min(day, 30))
        var next = snapshot
        next.workspaceRoot = workspaceRoot
        next.completedDays.insert(completedDay)
        next.selectedDay = next.nextUnlockedIncompleteDay(after: completedDay) ?? completedDay
        store?.save(next)
        return FoundationDayCompletionSaveResult(
            completedDay: completedDay,
            unlockedDay: next.selectedDay,
            snapshot: next
        )
    }
}

#if DEBUG
extension AgenticViewModel {
    func resetVolatileLocalUserDataStateForTesting() {
        resetVolatileLocalUserDataState()
    }
}
#endif

private extension AgenticViewModel {
    static func sidecarDateString(from date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: date)
    }

    func resetVolatileLocalUserDataState() {
        sessions = []
        selectedSessionID = nil
        selectedProvider = .codex
        draft = ""
        environment = .placeholder
        sidecarDiagnostics = nil
        connectionLabel = "Choose a project workspace"
        isConnected = false
        workspaceRoot = WorkspaceSettings.resolvedURL().path
        lastError = nil
        presentationPhase = .compact
        activeSurface = .assistantBubble
        isScanning = false
        scanProgressMessage = ""
        scanProgressLogs = []
        scanProgressSnapshots = []
        clearWorkspaceScanTiming()
        scanResult = nil
        attemptedStartupWorkspaceScanRecoveryRoots = []
        isCreatingDoc = nil
        docCreationLogs = []
        lastDocCreated = nil
        macAuthSession = nil
        macOnboardingStatus = .idle
        macOnboardingIntroCompleted = false
        macOnboardingIntakeOnlyCompleted = false
        onboardingContext = nil
        onboardingContextStatus = .idle
        bipCoach = nil
        bipResearch = .empty
        isBipCoachRefreshing = false
        isBipCoachGenerating = false
        isBipCoachCompleting = false
        bipReadiness = nil
        bipSetupGateMessage = nil
        missingBipLocalDocs = []
        missingBipExternalRequirements = []
        iddSetupStatus = "not_started"
        iddSetupComplete = false
        iddCurrentDocType = nil
        iddAmbiguityScore = nil
        iddUnresolvedAssumptions = []
        iddDocOrder = []
        iddDocPreviews = []
        iddProviderRecovery = nil
        iddSetupError = nil
        bipTokenExpired = nil
        bipMissionProgress = nil
        pendingWeeklyRitual = nil
        providerAuthInProgress = nil
        providerAuthMessage = nil
        sentPromptPreviews = [:]
        submittedStructuredPromptBySession = [:]
        structuredPromptDraftBySession = [:]
        sidecarOutputLogs = [:]
        bipNotificationOpenRequest = nil
        startupQueuedAction = nil
        startupSessionAppearElapsedMs = nil
        reviewDayDashboardViewModel = nil
        newsMarketRadar = .empty
        githubCliAuthStatus = .unknown
        foundationStartedAt = nil
        foundationProgressState = FoundationProgressSnapshot(workspaceRoot: WorkspaceSettings.resolvedURL().path)
        notionConnected = false
        notionOAuthInProgress = false
        notionOAuthError = nil

        revealWorkItem?.cancel()
        revealWorkItem = nil
        activePresentationSessionID = nil
        revealedAssistantMessageID = nil
        lastBipRequestedAction = nil
        pendingBipAuthRetry = nil
        pendingWorkspaceScanRoot = nil
        workspaceSetupTelemetryGate = WorkspaceSetupTelemetryGate()
        requestedWarmSessionIDs = []
        requestedInitialBipGate = false
        requestedInitialBipMission = false
        activeOnboardingWorkspacePrefetchFingerprint = nil
        replacementSessionCreateInFlight = false
        officeHoursSessionCreateInFlight = false
        latestCurriculumQuestionReframesByKey = [:]
        lastNewsMarketRadarViewedAt = nil
        injectedFoundationFirstPromptKeys = []
        pendingFoundationFirstPromptKeys = []
        startupSessionAppearStartedAt = nil
        didRecordStartupSessionAppear = false
        foundationProgressStore = nil
    }

    func restoreFoundationProgress(arguments: [String]) {
        ensureFoundationProgressStore()
        guard let store = foundationProgressStore else { return }
        if arguments.contains("--ui-testing-reset-onboarding") {
            store.clear()
            UserDefaults.standard.removeObject(forKey: Self.kFoundationStartedAtKey)
        }

        #if DEBUG
        if arguments.contains("--ui-testing-seed-review-day-dashboard") {
            let snapshot = FoundationProgressSnapshot(
                workspaceRoot: WorkspaceSettings.resolvedURL().path,
                startedAt: Date(timeIntervalSince1970: 0),
                selectedDay: 7,
                completedDays: Set(1...6)
            )
            store.save(snapshot)
            foundationProgressState = snapshot
            foundationStartedAt = snapshot.startedAt
            reviewDayDashboardViewModel = Self.makeUITestingReviewDayDashboardViewModel()
            return
        }

        if arguments.contains("--ui-testing-seed-foundation-graduation") {
            let snapshot = FoundationProgressSnapshot(
                workspaceRoot: WorkspaceSettings.resolvedURL().path,
                startedAt: Date(timeIntervalSince1970: 0),
                selectedDay: 30,
                completedDays: Set(1...30)
            )
            store.save(snapshot)
            foundationProgressState = snapshot
            foundationStartedAt = snapshot.startedAt
            return
        }
        #endif

        if var stored = store.load() {
            stored.selectedDay = stored.isUnlocked(stored.selectedDay) ? stored.selectedDay : 1
            foundationProgressState = stored
            foundationStartedAt = stored.startedAt
            return
        }

        var snapshot = FoundationProgressSnapshot(workspaceRoot: WorkspaceSettings.resolvedURL().path)
        if WorkspaceSettings.hasExplicitWorkspace,
           let legacyStartedAt = UserDefaults.standard.object(forKey: Self.kFoundationStartedAtKey) as? Date {
            snapshot.startedAt = legacyStartedAt
            store.save(snapshot)
            UserDefaults.standard.removeObject(forKey: Self.kFoundationStartedAtKey)
        }
        foundationProgressState = snapshot
        foundationStartedAt = snapshot.startedAt
    }

    #if DEBUG
    private static func makeUITestingReviewDayDashboardViewModel() -> ReviewDayDashboardViewModel {
        ReviewDayDashboardViewModel(
            schemaVersion: 1,
            componentType: "curriculum_review_day_view_model",
            reviewDay: 7,
            dayRange: ReviewDayRange(start: 1, end: 7),
            tone: "deceleration_coaching",
            curatedMetrics: [
                ReviewDayDashboardMetric(
                    label: "완료 Days",
                    value: "6/7",
                    trend: "steady",
                    intent: "Review Day에 표시할 진행 범위",
                    status: "watch"
                ),
                ReviewDayDashboardMetric(
                    label: "검증된 Actions",
                    value: "3",
                    trend: "evidence-backed",
                    intent: "자동 검증 또는 증거가 있는 실행 수",
                    status: "healthy"
                ),
            ],
            insights: [
                "완료 속도는 좋지만 Day 8 전에는 미완료 Action 1개를 작게 닫아보세요.",
            ],
            nextSteps: [
                "가격 ask 링크 1개를 남기고 다음 Action Day에서 자동 검증해보세요.",
            ],
            isEmpty: false
        )
    }
    #endif

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

/// Decoded shape of the AI-driven Foundation Day 0/2-7 first prompt that the
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
    let title: String?
    let message: String?
    let sessionId: String?
    let requestId: String?
    let messageId: String?
    let delta: String?
    let content: String?
    let state: MessageState?
    let workspaceRoot: String?
    let session: ChatSession?
    let sessions: [ChatSession]?
    let environment: SidecarEnvironment?
    let diagnostics: SidecarDiagnostics?
    let bipCoach: BipCoachState?
    let bipSetupReady: Bool?
    let iddSetupComplete: Bool?
    let iddSetupStatus: String?
    let iddCurrentDocType: String?
    let iddAmbiguityScore: Int?
    let iddUnresolvedAssumptions: [String]?
    let iddDocOrder: [String]?
    let iddDocPreviews: [IddDocPreview]?
    let iddProviderRecovery: IddProviderRecovery?
    let iddSetupError: IddSetupError?
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
    let day1AlignmentPlan: Day1AlignmentPlan?
    let day1IcpPlan: Day1IcpPlan?
    let day1SituationSummary: Day1SituationSummary?
    let day1GoalSelection: Day1GoalSelection?
    let dayProgress: DayProgress?
    let dayReviews: [String: DayReview]?
    let officeHoursMemory: OfficeHoursMemorySummary?
    let officeHoursHistory: OfficeHoursHistorySummary?
    let evidenceOS: EvidenceOSSummary?
    // Interview-gate block fields (day_progress_state): when the founder tries to close a
    // gated interview step without naming a next customer action, the sidecar withholds the
    // patch and sends needsCommitment=true + a soft `message`. `message` is shared (declared
    // below); gatedStep names the step that was held.
    let needsCommitment: Bool?
    let gatedStep: String?
    let error: String?
    /// Set by the sidecar on `type: "error"` envelopes that represent an
    /// expected, recoverable upstream provider condition (today,
    /// `"provider_usage_limit"` for a Codex/ChatGPT quota cap) rather than a
    /// real fault. The host uses it to surface a "retry later / switch provider"
    /// message instead of capturing a generic exception.
    let errorKind: String?

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
    let stepIndex: Int?
    let totalSteps: Int?
    let etaSeconds: Int?
    let foundCount: Int?
    let phase: String?
    let toolName: String?
    let summary: String?
    // R6 weekly ritual prompt payload (`weekly_ritual_prompt` event).
    let weeklyRitualPrompt: WeeklyRitualPrompt?
    let requestEmit: SidecarRequestEmit?
    let questionId: String?
    let originalQuestion: String?
    let reframedQuestion: String?
    let newsMarketRadar: NewsMarketRadarSnapshot?
    let newsMarketRadarStatus: NewsMarketRadarStatus?
    let bipResearch: BipResearchSnapshot?
    let bipResearchStatus: BipResearchStatus?
    let workHistory: WorkHistorySnapshot?
    let workHistoryStatus: WorkHistoryStatus?
    let officeHoursSourceGate: OfficeHoursSourceGate?
    let officeHoursDailyDigest: OfficeHoursDailyDigest?
    let morningBriefing: MorningBriefing?
    let morningBriefingPrevious: MorningBriefing?
    let morningBriefingStatus: MorningBriefingStatus?

    init(
        type: String,
        title: String? = nil,
        message: String?,
        sessionId: String?,
        requestId: String? = nil,
        messageId: String?,
        delta: String?,
        content: String?,
        state: MessageState? = nil,
        workspaceRoot: String?,
        session: ChatSession?,
        sessions: [ChatSession]?,
        environment: SidecarEnvironment?,
        diagnostics: SidecarDiagnostics?,
        bipCoach: BipCoachState?,
        bipSetupReady: Bool?,
        iddSetupComplete: Bool? = nil,
        iddSetupStatus: String? = nil,
        iddCurrentDocType: String? = nil,
        iddAmbiguityScore: Int? = nil,
        iddUnresolvedAssumptions: [String]? = nil,
        iddDocOrder: [String]? = nil,
        iddDocPreviews: [IddDocPreview]? = nil,
        iddProviderRecovery: IddProviderRecovery? = nil,
        iddSetupError: IddSetupError? = nil,
        day: Int?,
        firstPrompt: FoundationFirstPrompt?,
        missingLocalDocs: [String]?,
        missingExternalRequirements: [String]?,
        nextIddDocumentType: String?,
        nextIddDocumentTitle: String?,
        bipSetupGateMessage: String?,
        scanRoot: String?,
        icp: String?,
        spec: String?,
        values: String?,
        designSystem: String?,
        adr: String?,
        goal: String?,
        docs: String?,
        sheet: String?,
        onboardingHypothesis: WorkspaceOnboardingHypothesis?,
        day1AlignmentPlan: Day1AlignmentPlan? = nil,
        day1IcpPlan: Day1IcpPlan? = nil,
        day1SituationSummary: Day1SituationSummary? = nil,
        day1GoalSelection: Day1GoalSelection? = nil,
        dayProgress: DayProgress? = nil,
        dayReviews: [String: DayReview]? = nil,
        officeHoursMemory: OfficeHoursMemorySummary? = nil,
        officeHoursHistory: OfficeHoursHistorySummary? = nil,
        evidenceOS: EvidenceOSSummary? = nil,
        needsCommitment: Bool? = nil,
        gatedStep: String? = nil,
        error: String?,
        errorKind: String? = nil,
        docType: String?,
        docPath: String?,
        progressText: String?,
        notionConnected: Bool?,
        success: Bool?,
        disconnected: Bool?,
        authUrl: String?,
        rowId: String?,
        status: String?,
        detail: String?,
        log: String?,
        readinessError: BipReadinessError?,
        bipTokenExpiredMessage: String?,
        resourceName: String?,
        resourceUrl: String?,
        stage: String?,
        provider: String?,
        sheetRowsRead: Int?,
        docCharsRead: Int?,
        elapsedMs: Int?,
        stepIndex: Int? = nil,
        totalSteps: Int? = nil,
        etaSeconds: Int? = nil,
        foundCount: Int? = nil,
        phase: String?,
        toolName: String?,
        summary: String?,
        weeklyRitualPrompt: WeeklyRitualPrompt?,
        requestEmit: SidecarRequestEmit?,
        questionId: String? = nil,
        originalQuestion: String? = nil,
        reframedQuestion: String? = nil,
        newsMarketRadar: NewsMarketRadarSnapshot? = nil,
        newsMarketRadarStatus: NewsMarketRadarStatus? = nil,
        bipResearch: BipResearchSnapshot? = nil,
        bipResearchStatus: BipResearchStatus? = nil,
        workHistory: WorkHistorySnapshot? = nil,
        workHistoryStatus: WorkHistoryStatus? = nil,
        officeHoursSourceGate: OfficeHoursSourceGate? = nil,
        officeHoursDailyDigest: OfficeHoursDailyDigest? = nil,
        morningBriefing: MorningBriefing? = nil,
        morningBriefingPrevious: MorningBriefing? = nil,
        morningBriefingStatus: MorningBriefingStatus? = nil
    ) {
        self.type = type
        self.title = title
        self.message = message
        self.sessionId = sessionId
        self.requestId = requestId
        self.messageId = messageId
        self.delta = delta
        self.content = content
        self.state = state
        self.workspaceRoot = workspaceRoot
        self.session = session
        self.sessions = sessions
        self.environment = environment
        self.diagnostics = diagnostics
        self.bipCoach = bipCoach
        self.bipSetupReady = bipSetupReady
        self.iddSetupComplete = iddSetupComplete
        self.iddSetupStatus = iddSetupStatus
        self.iddCurrentDocType = iddCurrentDocType
        self.iddAmbiguityScore = iddAmbiguityScore
        self.iddUnresolvedAssumptions = iddUnresolvedAssumptions
        self.iddDocOrder = iddDocOrder
        self.iddDocPreviews = iddDocPreviews
        self.iddProviderRecovery = iddProviderRecovery
        self.iddSetupError = iddSetupError
        self.day = day
        self.firstPrompt = firstPrompt
        self.missingLocalDocs = missingLocalDocs
        self.missingExternalRequirements = missingExternalRequirements
        self.nextIddDocumentType = nextIddDocumentType
        self.nextIddDocumentTitle = nextIddDocumentTitle
        self.bipSetupGateMessage = bipSetupGateMessage
        self.scanRoot = scanRoot
        self.icp = icp
        self.spec = spec
        self.values = values
        self.designSystem = designSystem
        self.adr = adr
        self.goal = goal
        self.docs = docs
        self.sheet = sheet
        self.onboardingHypothesis = onboardingHypothesis
        self.day1AlignmentPlan = day1AlignmentPlan
        self.day1IcpPlan = day1IcpPlan
        self.day1SituationSummary = day1SituationSummary
        self.day1GoalSelection = day1GoalSelection
        self.dayProgress = dayProgress
        self.dayReviews = dayReviews
        self.officeHoursMemory = officeHoursMemory
        self.officeHoursHistory = officeHoursHistory
        self.evidenceOS = evidenceOS
        self.needsCommitment = needsCommitment
        self.gatedStep = gatedStep
        self.error = error
        self.errorKind = errorKind
        self.docType = docType
        self.docPath = docPath
        self.progressText = progressText
        self.notionConnected = notionConnected
        self.success = success
        self.disconnected = disconnected
        self.authUrl = authUrl
        self.rowId = rowId
        self.status = status
        self.detail = detail
        self.log = log
        self.readinessError = readinessError
        self.bipTokenExpiredMessage = bipTokenExpiredMessage
        self.resourceName = resourceName
        self.resourceUrl = resourceUrl
        self.stage = stage
        self.provider = provider
        self.sheetRowsRead = sheetRowsRead
        self.docCharsRead = docCharsRead
        self.elapsedMs = elapsedMs
        self.stepIndex = stepIndex
        self.totalSteps = totalSteps
        self.etaSeconds = etaSeconds
        self.foundCount = foundCount
        self.phase = phase
        self.toolName = toolName
        self.summary = summary
        self.weeklyRitualPrompt = weeklyRitualPrompt
        self.requestEmit = requestEmit
        self.questionId = questionId
        self.originalQuestion = originalQuestion
        self.reframedQuestion = reframedQuestion
        self.newsMarketRadar = newsMarketRadar
        self.newsMarketRadarStatus = newsMarketRadarStatus
        self.bipResearch = bipResearch
        self.bipResearchStatus = bipResearchStatus
        self.workHistory = workHistory
        self.workHistoryStatus = workHistoryStatus
        self.officeHoursSourceGate = officeHoursSourceGate
        self.officeHoursDailyDigest = officeHoursDailyDigest
        self.morningBriefing = morningBriefing
        self.morningBriefingPrevious = morningBriefingPrevious
        self.morningBriefingStatus = morningBriefingStatus
    }

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
    var officeHoursLiveStatus: OfficeHoursLiveStatus? {
        guard type == "office_hours_status",
              let sessionId = sessionId?.trimmingCharacters(in: .whitespacesAndNewlines).nonEmpty,
              let stage = stage?.trimmingCharacters(in: .whitespacesAndNewlines).nonEmpty else {
            return nil
        }
        return OfficeHoursLiveStatus(
            sessionId: sessionId,
            stage: stage,
            title: title?.trimmingCharacters(in: .whitespacesAndNewlines).nonEmpty,
            detail: detail?.trimmingCharacters(in: .whitespacesAndNewlines).nonEmpty,
            progressText: progressText?.trimmingCharacters(in: .whitespacesAndNewlines).nonEmpty,
            messageId: messageId?.trimmingCharacters(in: .whitespacesAndNewlines).nonEmpty,
            requestId: requestId?.trimmingCharacters(in: .whitespacesAndNewlines).nonEmpty,
            elapsedMs: elapsedMs,
            updatedAt: .now
        )
    }

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
        case title
        case message
        case sessionId
        case requestId
        case messageId
        case state
        case delta
        case content
        case workspaceRoot
        case session
        case sessions
        case environment
        case diagnostics
        case bipCoach
        case bipSetupReady
        case iddSetupComplete
        case iddSetupStatus
        case iddCurrentDocType
        case iddAmbiguityScore
        case iddUnresolvedAssumptions
        case iddDocOrder
        case iddDocPreviews
        case iddProviderRecovery
        case iddSetupError
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
        case day1AlignmentPlan
        case day1IcpPlan
        case day1SituationSummary
        case day1GoalSelection
        case dayProgress
        case dayReviews
        case officeHoursMemory
        case officeHoursHistory
        case evidenceOS
        case needsCommitment
        case gatedStep
        case error
        case errorKind
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
        case stepIndex
        case totalSteps
        case etaSeconds
        case foundCount
        case phase
        case toolName
        case summary
        // R6 weekly ritual broadcast
        case weeklyRitualPrompt = "prompt"
        case questionId
        case questionID = "question_id"
        case activeQuestionId
        case activeQuestionID = "active_question_id"
        case currentQuestionId
        case currentQuestionID = "current_question_id"
        case originalQuestion
        case originalQuestionID = "original_question"
        case reframedQuestion
        case reframedQuestionID = "reframed_question"
        case reframedVariant
        case reframedVariantID = "reframed_variant"
        case newsMarketRadar
        case bipResearch
        case workHistory
        case officeHoursSourceGate
        case officeHoursDailyDigest
        case morningBriefing
        case morningBriefingPrevious
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)

        type = try container.decode(String.self, forKey: .type)
        title = Self.decodeIfPresent(String.self, from: container, forKey: .title)
        message = Self.decodeIfPresent(String.self, from: container, forKey: .message)
        sessionId = Self.decodeIfPresent(String.self, from: container, forKey: .sessionId)
        requestId = Self.decodeIfPresent(String.self, from: container, forKey: .requestId)
        messageId = Self.decodeIfPresent(String.self, from: container, forKey: .messageId)
        state = Self.decodeIfPresent(MessageState.self, from: container, forKey: .state)
        delta = Self.decodeIfPresent(String.self, from: container, forKey: .delta)
        content = Self.decodeIfPresent(String.self, from: container, forKey: .content)
        workspaceRoot = Self.decodeIfPresent(String.self, from: container, forKey: .workspaceRoot)
        session = Self.decodeIfPresent(ChatSession.self, from: container, forKey: .session)
        sessions = Self.decodeIfPresent([ChatSession].self, from: container, forKey: .sessions)
        environment = Self.decodeIfPresent(SidecarEnvironment.self, from: container, forKey: .environment)
        diagnostics = Self.decodeIfPresent(SidecarDiagnostics.self, from: container, forKey: .diagnostics)
        bipCoach = Self.decodeIfPresent(BipCoachState.self, from: container, forKey: .bipCoach)
        bipSetupReady = Self.decodeIfPresent(Bool.self, from: container, forKey: .bipSetupReady)
        iddSetupComplete = Self.decodeIfPresent(Bool.self, from: container, forKey: .iddSetupComplete)
        iddSetupStatus = Self.decodeIfPresent(String.self, from: container, forKey: .iddSetupStatus)
        iddCurrentDocType = Self.decodeIfPresent(String.self, from: container, forKey: .iddCurrentDocType)
        iddAmbiguityScore = Self.decodeIfPresent(Int.self, from: container, forKey: .iddAmbiguityScore)
        iddUnresolvedAssumptions = Self.decodeIfPresent([String].self, from: container, forKey: .iddUnresolvedAssumptions)
        iddDocOrder = Self.decodeIfPresent([String].self, from: container, forKey: .iddDocOrder)
        iddDocPreviews = Self.decodeIfPresent([IddDocPreview].self, from: container, forKey: .iddDocPreviews)
        iddProviderRecovery = Self.decodeIfPresent(IddProviderRecovery.self, from: container, forKey: .iddProviderRecovery)
        iddSetupError = Self.decodeIfPresent(IddSetupError.self, from: container, forKey: .iddSetupError)
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
        day1AlignmentPlan = Self.decodeIfPresent(Day1AlignmentPlan.self, from: container, forKey: .day1AlignmentPlan)
        day1IcpPlan = Self.decodeIfPresent(Day1IcpPlan.self, from: container, forKey: .day1IcpPlan)
        day1SituationSummary = Self.decodeIfPresent(Day1SituationSummary.self, from: container, forKey: .day1SituationSummary)
        day1GoalSelection = Self.decodeIfPresent(Day1GoalSelection.self, from: container, forKey: .day1GoalSelection)
        dayProgress = Self.decodeIfPresent(DayProgress.self, from: container, forKey: .dayProgress)
        dayReviews = Self.decodeIfPresent([String: DayReview].self, from: container, forKey: .dayReviews)
        officeHoursMemory = Self.decodeIfPresent(OfficeHoursMemorySummary.self, from: container, forKey: .officeHoursMemory)
        officeHoursHistory = Self.decodeIfPresent(OfficeHoursHistorySummary.self, from: container, forKey: .officeHoursHistory)
        evidenceOS = Self.decodeIfPresent(EvidenceOSSummary.self, from: container, forKey: .evidenceOS)
        needsCommitment = Self.decodeIfPresent(Bool.self, from: container, forKey: .needsCommitment)
        gatedStep = Self.decodeIfPresent(String.self, from: container, forKey: .gatedStep)

        let stringError = Self.decodeIfPresent(String.self, from: container, forKey: .error)
        let structuredError = Self.decodeIfPresent(BipReadinessError.self, from: container, forKey: .error)
        error = stringError ?? structuredError?.userMessage
        errorKind = Self.decodeIfPresent(String.self, from: container, forKey: .errorKind)

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
        stepIndex = Self.decodeIfPresent(Int.self, from: container, forKey: .stepIndex)
        totalSteps = Self.decodeIfPresent(Int.self, from: container, forKey: .totalSteps)
        etaSeconds = Self.decodeIfPresent(Int.self, from: container, forKey: .etaSeconds)
        foundCount = Self.decodeIfPresent(Int.self, from: container, forKey: .foundCount)
        phase = Self.decodeIfPresent(String.self, from: container, forKey: .phase)
        toolName = Self.decodeIfPresent(String.self, from: container, forKey: .toolName)
        summary = Self.decodeIfPresent(String.self, from: container, forKey: .summary)
        weeklyRitualPrompt = Self.decodeIfPresent(WeeklyRitualPrompt.self, from: container, forKey: .weeklyRitualPrompt)
        requestEmit = type == "request_emit" ? try SidecarRequestEmit(from: decoder) : nil
        questionId = Self.decodeIfPresent(String.self, from: container, forKey: .questionId)
            ?? Self.decodeIfPresent(String.self, from: container, forKey: .questionID)
            ?? Self.decodeIfPresent(String.self, from: container, forKey: .activeQuestionId)
            ?? Self.decodeIfPresent(String.self, from: container, forKey: .activeQuestionID)
            ?? Self.decodeIfPresent(String.self, from: container, forKey: .currentQuestionId)
            ?? Self.decodeIfPresent(String.self, from: container, forKey: .currentQuestionID)
        originalQuestion = Self.decodeIfPresent(String.self, from: container, forKey: .originalQuestion)
            ?? Self.decodeIfPresent(String.self, from: container, forKey: .originalQuestionID)
        reframedQuestion = Self.decodeIfPresent(String.self, from: container, forKey: .reframedQuestion)
            ?? Self.decodeIfPresent(String.self, from: container, forKey: .reframedQuestionID)
            ?? Self.decodeIfPresent(String.self, from: container, forKey: .reframedVariant)
            ?? Self.decodeIfPresent(String.self, from: container, forKey: .reframedVariantID)
        newsMarketRadar = Self.decodeIfPresent(NewsMarketRadarSnapshot.self, from: container, forKey: .newsMarketRadar)
        newsMarketRadarStatus = Self.decodeIfPresent(NewsMarketRadarStatus.self, from: container, forKey: .status)
        bipResearch = Self.decodeIfPresent(BipResearchSnapshot.self, from: container, forKey: .bipResearch)
        bipResearchStatus = Self.decodeIfPresent(BipResearchStatus.self, from: container, forKey: .status)
        workHistory = Self.decodeIfPresent(WorkHistorySnapshot.self, from: container, forKey: .workHistory)
        workHistoryStatus = Self.decodeIfPresent(WorkHistoryStatus.self, from: container, forKey: .status)
        officeHoursSourceGate = Self.decodeIfPresent(OfficeHoursSourceGate.self, from: container, forKey: .officeHoursSourceGate)
        officeHoursDailyDigest = Self.decodeIfPresent(OfficeHoursDailyDigest.self, from: container, forKey: .officeHoursDailyDigest)
        morningBriefing = Self.decodeIfPresent(MorningBriefing.self, from: container, forKey: .morningBriefing)
        morningBriefingPrevious = Self.decodeIfPresent(MorningBriefing.self, from: container, forKey: .morningBriefingPrevious)
        morningBriefingStatus = Self.decodeIfPresent(MorningBriefingStatus.self, from: container, forKey: .status)
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
