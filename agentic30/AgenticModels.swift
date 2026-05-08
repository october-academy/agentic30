import Foundation

enum AgentProvider: String, Codable, CaseIterable, Identifiable {
    case codex
    case claude

    var id: String { rawValue }

    var title: String {
        switch self {
        case .codex:
            return "Codex"
        case .claude:
            return "Claude"
        }
    }

    var subtitle: String {
        switch self {
        case .codex:
            return "OpenAI Codex SDK"
        case .claude:
            return "Claude Agent SDK"
        }
    }

    var accentHex: String {
        switch self {
        case .codex:
            return "#8AE6B0"
        case .claude:
            return "#F4C68A"
        }
    }
}

struct AgentModelOption: Identifiable, Hashable {
    let id: String
    let label: String
    let provider: AgentProvider
    let isRecommended: Bool

    init(
        id: String,
        label: String,
        provider: AgentProvider,
        isRecommended: Bool = false
    ) {
        self.id = id
        self.label = label
        self.provider = provider
        self.isRecommended = isRecommended
    }
}

enum AgentModelCatalog {
    static let claude: [AgentModelOption] = [
        AgentModelOption(id: "claude-opus-4-7", label: "Claude Opus 4.7", provider: .claude),
        AgentModelOption(id: "claude-opus-4-6", label: "Claude Opus 4.6", provider: .claude),
        AgentModelOption(id: "claude-opus-4-5", label: "Claude Opus 4.5", provider: .claude),
        AgentModelOption(id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", provider: .claude, isRecommended: true),
        AgentModelOption(id: "claude-haiku-4-5", label: "Claude Haiku 4.5", provider: .claude),
    ]

    static let codex: [AgentModelOption] = [
        AgentModelOption(id: "gpt-5.5", label: "GPT 5.5 (Best)", provider: .codex, isRecommended: true),
        AgentModelOption(id: "gpt-5.3-codex", label: "GPT 5.3 Codex", provider: .codex),
        AgentModelOption(id: "gpt-5.4", label: "GPT 5.4", provider: .codex),
        AgentModelOption(id: "gpt-5.4-mini", label: "GPT 5.4 Mini", provider: .codex),
        AgentModelOption(id: "gpt-5.2-codex", label: "GPT 5.2 Codex", provider: .codex),
        AgentModelOption(id: "gpt-5.2", label: "GPT 5.2", provider: .codex),
        AgentModelOption(id: "gpt-5.1-codex-max", label: "GPT 5.1 Codex Max", provider: .codex),
        AgentModelOption(id: "gpt-5.1-codex-mini", label: "GPT 5.1 Codex Mini", provider: .codex),
    ]

    static let defaultClaudeModelID = "claude-sonnet-4-6"
    static let defaultCodexModelID = "gpt-5.5"

    static func options(for provider: AgentProvider) -> [AgentModelOption] {
        switch provider {
        case .claude:
            return claude
        case .codex:
            return codex
        }
    }

    static func defaultModelID(for provider: AgentProvider) -> String {
        switch provider {
        case .claude:
            return defaultClaudeModelID
        case .codex:
            return defaultCodexModelID
        }
    }

    static func label(for id: String, provider: AgentProvider) -> String {
        let normalized = normalizedModelID(id, provider: provider)
        return options(for: provider).first(where: { $0.id == normalized })?.label ?? normalized
    }

    static func normalizedModelID(_ id: String, provider: AgentProvider) -> String {
        let trimmed = id.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            return defaultModelID(for: provider)
        }
        guard options(for: provider).contains(where: { $0.id == trimmed }) else {
            return defaultModelID(for: provider)
        }
        return trimmed
    }
}

enum SessionStatus: String, Codable {
    case idle
    case running
    case awaitingInput = "awaiting_input"
    case error
}

enum MessageRole: String, Codable {
    case user
    case assistant
    case system
}

enum MessageState: String, Codable {
    case streaming
    case final
    case error
}

struct ChatMessage: Identifiable, Codable, Hashable {
    let id: String
    let role: MessageRole
    let provider: AgentProvider
    var content: String
    var state: MessageState
    let createdAt: Date
    var error: String? = nil
    var bipMissionChoices: [BipCoachMission]? = nil
    var providerAuthActions: [ProviderAuthAction]? = nil
    /// Single inline decision card for assistant messages. When non-nil and the
    /// message is from the assistant, ContentView renders a Decision Card Stack
    /// (sage accent) instead of plain text in the bubble. Channel is mutually
    /// exclusive with `ChatSession.pendingUserInput` (form intake) at the
    /// producer (sidecar). Backward compatible: messages without this field
    /// decode with `inlineDecision: nil`.
    var inlineDecision: StructuredPromptQuestion? = nil
}

struct ProviderAuthAction: Identifiable, Codable, Hashable {
    let id: String
    let provider: AgentProvider
    let title: String
    let detail: String?
}

struct ChatSession: Identifiable, Codable, Hashable {
    let id: String
    var title: String
    let provider: AgentProvider
    let model: String
    var status: SessionStatus
    let createdAt: Date
    var updatedAt: Date
    var error: String?
    var messages: [ChatMessage]
    var pendingUserInput: StructuredPromptRequest?
    var runtime: ChatSessionRuntime?
}

struct ChatSessionRuntime: Codable, Hashable {
    var codexThreadId: String?
    var codexThreadMeta: CodexThreadMeta?
    var codexWarm: CodexWarmState?
    var iddDocumentType: String?
}

struct CodexThreadMeta: Codable, Hashable {
    var codexHome: String?
    var workspaceRoot: String?
    var model: String?
    var executionMode: String?
    var createdAt: String?
    var lastValidatedAt: String?
}

struct CodexWarmState: Codable, Hashable {
    var state: String?
    var model: String?
    var workspaceRoot: String?
    var executionMode: String?
    var startedAt: String?
    var completedAt: String?
    var failedAt: String?
    var elapsedMs: Int?
    var error: String?
}

struct StructuredPromptRequest: Identifiable, Codable, Hashable {
    let requestId: String
    let sessionId: String
    let toolName: String
    let title: String?
    let createdAt: Date
    let questions: [StructuredPromptQuestion]

    var id: String { requestId }
}

struct StructuredPromptQuestion: Identifiable, Codable, Hashable {
    let header: String
    let question: String
    let helperText: String?
    let options: [StructuredPromptOption]?
    let multiSelect: Bool?
    let allowFreeText: Bool?
    let freeTextPlaceholder: String?
    let textMode: StructuredPromptTextMode?

    var id: String { question }
}

struct StructuredPromptOption: Codable, Hashable {
    let label: String
    let description: String
    let preview: String?
    let nextIntent: String?
}

enum StructuredPromptTextMode: String, Codable {
    case short
    case long
}

struct WorkspaceOnboardingHypothesis: Codable, Hashable {
    let productName: String?
    let projectKind: String?
    let targetUser: String?
    let problem: String?
    let purpose: String?
    let likelyUsers: [String]?
    let stage: String?
    let evidence: [String]?
    let confidence: String?
    let suggestedFirstQuestion: String?
}

enum AssistantPresentationPhase: String, Codable {
    case compact
    case expanding
    case expanded
}

enum AgenticSurface: String, Codable {
    case assistantBubble
    case workspace
}

struct SidecarProviderEnvironment: Codable, Hashable {
    let available: Bool
    let source: String
    let message: String
    let sdk: SidecarProviderSDKEnvironment?
}

struct SidecarProviderSDKEnvironment: Codable, Hashable {
    let available: Bool
    let packageName: String?
    let version: String?
    let packageRoot: String?
    let entrypointPath: String?
    let message: String?
}

struct SidecarACPEnvironment: Codable, Hashable {
    let available: Bool
    let message: String
    let adapterPath: String?
    let command: String?
}

struct SidecarEnvironment: Codable, Hashable {
    let claude: SidecarProviderEnvironment
    let codex: SidecarProviderEnvironment
    let acp: SidecarACPEnvironment?
}

struct SidecarDiagnostics: Codable, Hashable {
    let generatedAt: Date
    let appSupportPath: String?
    let workspaceRoot: String?
    let runtime: SidecarRuntimeDiagnostics
    let storage: SidecarStorageDiagnostics
    let sessions: SidecarSessionDiagnostics
    let environment: SidecarEnvironment?
    let preflight: SidecarPreflightReport?
}

struct SidecarRuntimeDiagnostics: Codable, Hashable {
    let pid: Int?
    let platform: String?
    let arch: String?
    let node: String?
}

struct SidecarStorageDiagnostics: Codable, Hashable {
    let sessionsSchemaVersion: Int?
    let sessionStoreWarnings: [SidecarStorageWarning]?
}

struct SidecarStorageWarning: Codable, Hashable {
    let type: String?
    let message: String?
    let quarantinePath: String?
    let occurredAt: Date?
}

struct SidecarSessionDiagnostics: Codable, Hashable {
    let total: Int
    let activeRuns: Int
    let statuses: [String: Int]
}

struct SidecarPreflightReport: Codable, Hashable {
    let status: String
    let checks: [SidecarPreflightCheck]
}

struct SidecarPreflightCheck: Codable, Hashable, Identifiable {
    let id: String
    let title: String
    let status: String
    let message: String?
    let recovery: String?
}

struct BipCoachState: Codable, Hashable {
    let schemaVersion: Int?
    let updatedAt: Date?
    let sessionId: String?
    let config: BipCoachConfig
    let evidence: BipCoachEvidence?
    let missionChoices: [BipCoachMission]?
    let currentMission: BipCoachMission?
    let streak: BipCoachStreak
    let lastError: String?

    var isConfigured: Bool {
        config.sheetId?.nonEmpty != nil && config.docId?.nonEmpty != nil
    }

    var hasCompletedMission: Bool {
        currentMission?.status == "completed"
    }

    var pendingMissionChoices: [BipCoachMission] {
        (missionChoices ?? []).filter { mission in
            mission.title?.nonEmpty != nil || mission.mission?.nonEmpty != nil || mission.angle?.nonEmpty != nil
        }
    }

    func displayState(hasSidecarFailure: Bool = false, hasMissionProgress: Bool) -> BipCoachDisplayState {
        if hasSidecarFailure {
            return .sidecarFailure
        }
        if hasMissionProgress {
            return .generating
        }
        if currentMission != nil {
            return .selectedMission
        }
        if !pendingMissionChoices.isEmpty {
            return .choicesReady
        }
        return .empty
    }
}

enum BipCoachDisplayState {
    case sidecarFailure
    case generating
    case selectedMission
    case choicesReady
    case empty
}

struct BipCoachConfig: Codable, Hashable {
    let provider: AgentProvider?
    let threadsHandle: String?
    let sheetUrl: String?
    let sheetId: String?
    let sheetTabName: String?
    let docUrl: String?
    let docId: String?
    let morningHour: Int?
    let eveningHour: Int?
}

struct BipCoachEvidence: Codable, Hashable {
    let fullRead: Bool?
    let source: String?
    let refreshedAt: Date?
    let sheetTitle: String?
    let sheetTabName: String?
    let allRows: [BipCoachSheetRow]?
    let recentRows: [BipCoachSheetRow]?
    let docTitle: String?
    let docText: String?
    let docExcerpt: String?
    let summary: String?
    let error: String?
    let sheetRowsRead: Int?
    let sheetRowsTotal: Int?
    let docCharsRead: Int?
    let docCharsTotal: Int?
    let docWasTruncated: Bool?
    let provider: AgentProvider?
    let fallbackUsed: Bool?
    let elapsedMs: Int?
}

struct BipCoachSheetRow: Codable, Hashable, Identifiable {
    let rowNumber: Int?
    let date: String?
    let followers: String?
    let posts: [String]?
    let notes: String?
    let insights: String?
    let writingTime: String?

    var id: Int { rowNumber ?? 0 }
}

struct BipCoachMission: Codable, Hashable {
    let id: String
    let date: String?
    let provider: AgentProvider?
    let status: String
    let compact: Bool?
    let title: String?
    let angle: String?
    let mission: String?
    let drafts: [String]?
    let eveningChecklist: [String]?
    let evidenceRefs: [String]?
    let generatedAt: Date?
    let completedAt: Date?
    let threadsUrl: String?
    let sheetRowNote: String?
}

struct BipCoachStreak: Codable, Hashable {
    let current: Int
    let longest: Int
    let lastCompletedDate: String?
}

extension SidecarEnvironment {
    static let placeholder = SidecarEnvironment(
        claude: SidecarProviderEnvironment(
            available: false,
            source: "unknown",
            message: "Checking Claude auth...",
            sdk: nil
        ),
        codex: SidecarProviderEnvironment(
            available: false,
            source: "unknown",
            message: "Checking Codex auth...",
            sdk: nil
        ),
        acp: SidecarACPEnvironment(
            available: false,
            message: "Checking ACP adapter...",
            adapterPath: nil,
            command: nil
        )
    )
}

extension ChatSession {
    var lastMessagePreview: String {
        messages.last?.content.trimmingCharacters(in: .whitespacesAndNewlines).nonEmpty
            ?? "Start a new conversation"
    }
}

extension SidecarDiagnostics {
    var reportText: String {
        var lines = [
            "agentic30 diagnostics",
            "Generated: \(generatedAt)",
            "Workspace: \(workspaceRoot ?? "unknown")",
            "Application Support: \(appSupportPath ?? "unknown")",
            "",
            "Runtime",
            "- PID: \(runtime.pid.map(String.init) ?? "unknown")",
            "- Platform: \(runtime.platform ?? "unknown")",
            "- Arch: \(runtime.arch ?? "unknown")",
            "- Node: \(runtime.node ?? "unknown")",
            "",
            "Storage",
            "- Sessions schema: \(storage.sessionsSchemaVersion.map(String.init) ?? "unknown")",
        ]

        if let warnings = storage.sessionStoreWarnings, !warnings.isEmpty {
            lines.append("- Session store warnings: \(warnings.count)")
            for warning in warnings {
                lines.append("  - \(warning.type ?? "warning"): \(warning.message ?? "")")
                if let quarantinePath = warning.quarantinePath {
                    lines.append("    Quarantine: \(quarantinePath)")
                }
            }
        }

        lines.append(contentsOf: [
            "",
            "Sessions",
            "- Total: \(sessions.total)",
            "- Active runs: \(sessions.activeRuns)",
        ])

        for key in sessions.statuses.keys.sorted() {
            lines.append("- \(key): \(sessions.statuses[key] ?? 0)")
        }

        if let environment {
            lines.append("")
            lines.append("Environment")
            lines.append("- Claude: \(environment.claude.available ? "available" : "unavailable") (\(environment.claude.source)) - \(environment.claude.message)")
            if let sdk = environment.claude.sdk {
                lines.append("  SDK: \(sdk.available ? "available" : "unavailable") \(sdk.packageName ?? "Claude Agent SDK") \(sdk.version ?? "") - \(sdk.entrypointPath ?? "unknown")")
            }
            lines.append("- Codex: \(environment.codex.available ? "available" : "unavailable") (\(environment.codex.source)) - \(environment.codex.message)")
            if let sdk = environment.codex.sdk {
                lines.append("  SDK: \(sdk.available ? "available" : "unavailable") \(sdk.packageName ?? "Codex SDK") \(sdk.version ?? "") - \(sdk.entrypointPath ?? "unknown")")
            }
            if let acp = environment.acp {
                lines.append("- ACP: \(acp.available ? "available" : "unavailable") - \(acp.message)")
                if let command = acp.command {
                    lines.append("  Command: \(command)")
                }
            }
        }

        if let preflight {
            lines.append("")
            lines.append("Preflight: \(preflight.status)")
            for check in preflight.checks {
                lines.append("- [\(check.status)] \(check.title): \(check.message ?? "")")
                if let recovery = check.recovery {
                    lines.append("  Recovery: \(recovery)")
                }
            }
        }

        return lines.joined(separator: "\n")
    }
}

private extension String {
    var nonEmpty: String? {
        trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : self
    }
}
