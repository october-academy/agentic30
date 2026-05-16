import Foundation

enum AgentProvider: String, Codable, CaseIterable, Identifiable {
    case codex
    case claude
    case gemini

    var id: String { rawValue }

    var title: String {
        switch self {
        case .codex:
            return "Codex"
        case .claude:
            return "Claude"
        case .gemini:
            return "Gemini"
        }
    }

    var subtitle: String {
        switch self {
        case .codex:
            return "OpenAI Codex SDK"
        case .claude:
            return "Claude Agent SDK"
        case .gemini:
            return "Google Gen AI SDK"
        }
    }

    var accentHex: String {
        switch self {
        case .codex:
            return "#8AE6B0"
        case .claude:
            return "#F4C68A"
        case .gemini:
            return "#93C5FD"
        }
    }
}

enum AgentAuthMode: String, Codable, CaseIterable, Identifiable {
    case local
    case apiKey = "api_key"
    case bedrock
    case vertex
    case foundry
    case custom

    var id: String { rawValue }

    var title: String {
        switch self {
        case .local:
            return "Local CLI settings"
        case .apiKey:
            return "API key"
        case .bedrock:
            return "AWS Bedrock"
        case .vertex:
            return "Google Vertex"
        case .foundry:
            return "Microsoft Foundry"
        case .custom:
            return "Custom env"
        }
    }

    static func normalized(_ rawValue: String, provider: AgentProvider) -> AgentAuthMode {
        let value = rawValue.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let mode = AgentAuthMode(rawValue: value) ?? .local
        guard modes(for: provider).contains(mode) else { return .local }
        return mode
    }

    static func modes(for provider: AgentProvider) -> [AgentAuthMode] {
        switch provider {
        case .claude:
            return [.local, .apiKey, .bedrock, .vertex, .foundry, .custom]
        case .codex:
            return [.local, .apiKey]
        case .gemini:
            return [.local, .apiKey, .vertex]
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
        AgentModelOption(id: "claude-opus-4-7", label: "Claude Opus 4.7 (Best)", provider: .claude, isRecommended: true),
        AgentModelOption(id: "claude-opus-4-6", label: "Claude Opus 4.6", provider: .claude),
        AgentModelOption(id: "claude-opus-4-5", label: "Claude Opus 4.5", provider: .claude),
        AgentModelOption(id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", provider: .claude),
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

    static let gemini: [AgentModelOption] = [
        AgentModelOption(id: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro (Preview) (Best)", provider: .gemini, isRecommended: true),
        AgentModelOption(id: "gemini-3-flash-preview", label: "Gemini 3 Flash (Preview)", provider: .gemini),
        AgentModelOption(id: "gemini-3.1-flash-lite", label: "Gemini 3.1 Flash Lite", provider: .gemini),
        AgentModelOption(id: "gemini-2.5-pro", label: "Gemini 2.5 Pro", provider: .gemini),
        AgentModelOption(id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", provider: .gemini),
        AgentModelOption(id: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash Lite", provider: .gemini),
    ]

    static let defaultClaudeModelID = "claude-opus-4-7"
    static let defaultCodexModelID = "gpt-5.5"
    static let defaultGeminiModelID = "gemini-3.1-pro-preview"

    static func options(for provider: AgentProvider) -> [AgentModelOption] {
        switch provider {
        case .claude:
            return claude
        case .codex:
            return codex
        case .gemini:
            return gemini
        }
    }

    static func defaultModelID(for provider: AgentProvider) -> String {
        switch provider {
        case .claude:
            return defaultClaudeModelID
        case .codex:
            return defaultCodexModelID
        case .gemini:
            return defaultGeminiModelID
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
    var archivedAt: Date? = nil
}

struct ChatSessionRuntime: Codable, Hashable {
    var codexThreadId: String?
    var codexThreadMeta: CodexThreadMeta?
    var codexWarm: CodexWarmState?
    var startupTiming: StartupTimingState?
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

struct StartupTimingState: Codable, Hashable {
    var processStartedAt: String?
    var sidecarReadyAt: String?
    var clientAuthenticatedAt: String?
    var sessionCreatedAt: String?
    var processToSidecarReadyMs: Int?
    var processToClientAuthenticatedMs: Int?
    var processToCreateSessionReceivedMs: Int?
    var processToSessionCreatedMs: Int?
    var sidecarReadyToCreateSessionReceivedMs: Int?
    var clientAuthenticatedToCreateSessionReceivedMs: Int?
    var createSessionElapsedMs: Int?
    var bootstrapIntakeElapsedMs: Int?
    var persistElapsedMs: Int?
    var bipCoachSyncElapsedMs: Int?
    var clientCountAtCreate: Int?
}

struct StructuredPromptRequest: Identifiable, Codable, Hashable {
    let requestId: String
    let sessionId: String
    let toolName: String
    let title: String?
    let createdAt: Date
    let intro: StructuredPromptIntro?
    let resources: [StructuredPromptResource]?
    let questions: [StructuredPromptQuestion]
    let generation: StructuredPromptGeneration?

    init(
        requestId: String,
        sessionId: String,
        toolName: String,
        title: String?,
        createdAt: Date,
        intro: StructuredPromptIntro? = nil,
        resources: [StructuredPromptResource]? = nil,
        questions: [StructuredPromptQuestion],
        generation: StructuredPromptGeneration? = nil
    ) {
        self.requestId = requestId
        self.sessionId = sessionId
        self.toolName = toolName
        self.title = title
        self.createdAt = createdAt
        self.intro = intro
        self.resources = resources
        self.questions = questions
        self.generation = generation
    }

    var id: String { requestId }

    var uiBindingToken: String {
        let questionTokens = questions.map { question in
            [
                question.id,
                question.header,
                question.question,
                question.helperText ?? "",
                question.freeTextPlaceholder ?? "",
            ].joined(separator: "\u{1F}")
        }
        return ([requestId, sessionId, toolName] + questionTokens).joined(separator: "\u{1E}")
    }

    var isProviderAdaptiveIddQuestion: Bool {
        generation?.mode == "provider_adaptive"
            || generation?.mode == "host_structured"
            || generation?.mode == "sidecar_agent_synthesized"
    }

    var isAgentic30StructuredInput: Bool {
        toolName == "agentic30_request_user_input"
    }

    var isLegacyStaticIddQuestion: Bool {
        if isProviderAdaptiveIddQuestion {
            return false
        }
        var fields: [String] = []
        if let title {
            fields.append(title)
        }
        for question in questions {
            fields.append(question.header)
            fields.append(question.question)
            if let helperText = question.helperText {
                fields.append(helperText)
            }
            if let freeTextPlaceholder = question.freeTextPlaceholder {
                fields.append(freeTextPlaceholder)
            }
            for option in question.options ?? [] {
                fields.append(option.label)
                fields.append(option.description)
                if let preview = option.preview {
                    fields.append(preview)
                }
                if let nextIntent = option.nextIntent {
                    fields.append(nextIntent)
                }
            }
        }
        let haystack = fields.joined(separator: "\n")
        return haystack.contains("가장 절박한 하위 ICP")
            || haystack.contains("가장 절박한 사람")
    }
}

struct StructuredPromptIntro: Codable, Hashable {
    let title: String?
    let body: String?
    let bullets: [String]?
}

struct StructuredPromptResource: Identifiable, Codable, Hashable {
    let title: String
    let source: String?
    let url: String
    let description: String?

    var id: String { url }
}

struct StructuredPromptGeneration: Codable, Hashable {
    let mode: String?
    let docType: String?
    let signalId: String?
    let signalLabel: String?
    let isLastSignalForDoc: Bool?
    let dimensionTransitioned: Bool?
    let previousSignalLabel: String?
    let previousAnswerLabel: String?
    let dimensionStepIndex: Int?
    let dimensionTotal: Int?

    init(
        mode: String? = nil,
        docType: String? = nil,
        signalId: String? = nil,
        signalLabel: String? = nil,
        isLastSignalForDoc: Bool? = nil,
        dimensionTransitioned: Bool? = nil,
        previousSignalLabel: String? = nil,
        previousAnswerLabel: String? = nil,
        dimensionStepIndex: Int? = nil,
        dimensionTotal: Int? = nil
    ) {
        self.mode = mode
        self.docType = docType
        self.signalId = signalId
        self.signalLabel = signalLabel
        self.isLastSignalForDoc = isLastSignalForDoc
        self.dimensionTransitioned = dimensionTransitioned
        self.previousSignalLabel = previousSignalLabel
        self.previousAnswerLabel = previousAnswerLabel
        self.dimensionStepIndex = dimensionStepIndex
        self.dimensionTotal = dimensionTotal
    }
}

struct StructuredPromptQuestion: Identifiable, Codable, Hashable {
    let questionId: String?
    let header: String
    var question: String
    let helperText: String?
    let options: [StructuredPromptOption]?
    let multiSelect: Bool?
    let allowFreeText: Bool?
    let requiresFreeText: Bool?
    let freeTextPlaceholder: String?
    let textMode: StructuredPromptTextMode?

    init(
        questionId: String? = nil,
        header: String,
        question: String,
        helperText: String?,
        options: [StructuredPromptOption]?,
        multiSelect: Bool?,
        allowFreeText: Bool?,
        requiresFreeText: Bool?,
        freeTextPlaceholder: String?,
        textMode: StructuredPromptTextMode?
    ) {
        self.questionId = questionId
        self.header = header
        self.question = question
        self.helperText = helperText
        self.options = options
        self.multiSelect = multiSelect
        self.allowFreeText = allowFreeText
        self.requiresFreeText = requiresFreeText
        self.freeTextPlaceholder = freeTextPlaceholder
        self.textMode = textMode
    }

    var id: String { questionId ?? question }

    func replacingQuestionText(_ text: String, preservingIdentity identity: String? = nil) -> StructuredPromptQuestion {
        StructuredPromptQuestion(
            questionId: identity ?? id,
            header: header,
            question: text,
            helperText: helperText,
            options: options,
            multiSelect: multiSelect,
            allowFreeText: allowFreeText,
            requiresFreeText: requiresFreeText,
            freeTextPlaceholder: freeTextPlaceholder,
            textMode: textMode
        )
    }

    func isSatisfied(selectedOptions: Set<String>, freeText: String) -> Bool {
        let hasSelection = !selectedOptions.isEmpty
        let hasFreeText = !freeText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty

        if requiresFreeText == true {
            return hasFreeText
        }

        if allowFreeText == true {
            return hasSelection || hasFreeText
        }

        return hasSelection
    }

    private enum CodingKeys: String, CodingKey {
        case id
        case questionId
        case questionID = "question_id"
        case header
        case question
        case helperText
        case options
        case multiSelect
        case allowFreeText
        case requiresFreeText
        case freeTextPlaceholder
        case textMode
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        questionId = try container.decodeIfPresent(String.self, forKey: .questionId)
            ?? container.decodeIfPresent(String.self, forKey: .questionID)
            ?? container.decodeIfPresent(String.self, forKey: .id)
        header = try container.decode(String.self, forKey: .header)
        question = try container.decode(String.self, forKey: .question)
        helperText = try container.decodeIfPresent(String.self, forKey: .helperText)
        options = try container.decodeIfPresent([StructuredPromptOption].self, forKey: .options)
        multiSelect = try container.decodeIfPresent(Bool.self, forKey: .multiSelect)
        allowFreeText = try container.decodeIfPresent(Bool.self, forKey: .allowFreeText)
        requiresFreeText = try container.decodeIfPresent(Bool.self, forKey: .requiresFreeText)
        freeTextPlaceholder = try container.decodeIfPresent(String.self, forKey: .freeTextPlaceholder)
        textMode = try container.decodeIfPresent(StructuredPromptTextMode.self, forKey: .textMode)
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encodeIfPresent(questionId, forKey: .questionId)
        try container.encode(header, forKey: .header)
        try container.encode(question, forKey: .question)
        try container.encodeIfPresent(helperText, forKey: .helperText)
        try container.encodeIfPresent(options, forKey: .options)
        try container.encodeIfPresent(multiSelect, forKey: .multiSelect)
        try container.encodeIfPresent(allowFreeText, forKey: .allowFreeText)
        try container.encodeIfPresent(requiresFreeText, forKey: .requiresFreeText)
        try container.encodeIfPresent(freeTextPlaceholder, forKey: .freeTextPlaceholder)
        try container.encodeIfPresent(textMode, forKey: .textMode)
    }
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

/// Stage-2 payload bundled into every `workspace_scan_result` so Day 1's
/// first_prompt mapper can reach scan-derived signals without re-querying the
/// sidecar. Mirrors `buildWorkspaceDay1Context` in sidecar/index.mjs.
///
/// All fields are nullable: the sidecar omits them when the underlying scan
/// produced nothing, and forwards-compat lets us add fields later without a
/// schema bump on the wire (Mac just sees them as `nil`).
struct WorkspaceDay1Context: Codable, Hashable {
    let schemaVersion: Int
    let sourceScanRoot: String
    let confidence: String?
    let productName: String?
    let targetUser: String?
    let problem: String?
    let suggestedFirstQuestion: String?
    let foundDocCount: Int?
    let missingExpectedDocs: [String]?
    let localDiscovery: WorkspaceLocalDiscovery?
}

/// Stage-3 deterministic signals from the project folder. Mirrors the
/// `localDiscovery` block in sidecar/local-discovery.mjs. Pure data — used
/// by WorkspaceDay1Mapper to fill Day 1 first_prompt slots without an LLM.
struct WorkspaceLocalDiscovery: Codable, Hashable {
    let schemaVersion: Int
    let git: WorkspaceGitSummary
    let project: WorkspaceProjectShape
    let runway: WorkspaceRunwayHints
}

struct WorkspaceGitSummary: Codable, Hashable {
    let isGitRepo: Bool
    let head: String?
    let firstCommitAt: String?
    let last7DaysCommitCount: Int
    let dirty: Bool?
    let branch: String?

    // Hand-written init so test fixtures and forwards-compat sidecar payloads
    // can omit `head` (added in PR3). The Codable synthesised init/decoder
    // still gets a String? optional for the wire field.
    init(
        isGitRepo: Bool,
        head: String? = nil,
        firstCommitAt: String?,
        last7DaysCommitCount: Int,
        dirty: Bool?,
        branch: String?
    ) {
        self.isGitRepo = isGitRepo
        self.head = head
        self.firstCommitAt = firstCommitAt
        self.last7DaysCommitCount = last7DaysCommitCount
        self.dirty = dirty
        self.branch = branch
    }
}

struct WorkspaceProjectShape: Codable, Hashable {
    let stacks: [String]
    let hasReadme: Bool
    let manifestPaths: [String]
}

struct WorkspaceRunwayHints: Codable, Hashable {
    let projectAgeDays: Int?
    let recentlyActive: Bool?
}

/// Stage-4/5 LLM-composed Day 1 opener. Arrives via the
/// `workspace_day1_compose_result` event after the initial
/// `workspace_scan_result`, so the user's first message can refresh from
/// deterministic-only to LLM-quality once the composer returns.
struct ComposedDay1Opening: Codable, Hashable {
    let schemaVersion: Int
    let yesterday: String
    let today: String
    let question: String
    let confidence: Double
    let source: String
    let fellBackToDeterministic: Bool
    let webUsed: Bool
}

struct IddDocPreview: Identifiable, Codable, Hashable {
    let type: String
    let title: String
    let path: String
    let status: String
    let content: String

    var id: String { type }
}

struct IddProviderRecovery: Codable, Hashable {
    let provider: AgentProvider?
    let message: String?
    let actionId: String?
}

struct IddSetupError: Codable, Hashable {
    let provider: AgentProvider?
    let docType: String?
    let message: String?
    let recoverable: Bool?
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
    let geminiAdc: GeminiAuthDiagnostic?
}

struct GeminiAuthDiagnostic: Codable, Hashable {
    let status: String
    let gcloudInstalled: Bool
    let adcCredentialsPresent: Bool

    var isGcloudMissing: Bool { status == "gcloud-missing" }
    var needsAdcLogin: Bool { status == "gcloud-present-no-adc" }
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
    let gemini: SidecarProviderEnvironment?
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
    let provider: String?
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
    let provider: String?
    let status: String
    let compact: Bool?
    let title: String?
    let angle: String?
    let mission: String?
    let curriculumDay: BipCoachCurriculumDay?
    let drafts: [String]?
    let eveningChecklist: [String]?
    let evidenceRefs: [String]?
    let generatedAt: Date?
    let completedAt: Date?
    let completedQuestionCount: Int?
    let threadsUrl: String?
    let sheetRowNote: String?

    var completionQuestionCountLabel: String? {
        guard let completedQuestionCount, completedQuestionCount > 0 else { return nil }
        return "질문 \(completedQuestionCount)개 완료"
    }
}

struct BipCoachCurriculumDay: Codable, Hashable {
    let day: Int?

    var completionNextDayTeaser: String? {
        guard day == 1 else { return nil }
        return "다음: Day 2 Market - 돈이 흐르는 기준 시장을 가볍게 확인해보세요."
    }
}

struct ReviewDayDashboardViewModel: Codable, Hashable {
    let schemaVersion: Int
    let componentType: String
    let reviewDay: Int
    let dayRange: ReviewDayRange?
    let tone: String
    let curatedMetrics: [ReviewDayDashboardMetric]
    let insights: [String]
    let nextSteps: [String]
    let isEmpty: Bool
}

struct ReviewDayRange: Codable, Hashable {
    let start: Int
    let end: Int
}

struct ReviewDayDashboardMetric: Codable, Hashable, Identifiable {
    let label: String
    let value: String
    let trend: String
    let intent: String
    let status: String

    var id: String {
        [label, value, trend, intent, status].joined(separator: "|")
    }
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
            sdk: nil,
            geminiAdc: nil
        ),
        codex: SidecarProviderEnvironment(
            available: false,
            source: "unknown",
            message: "Checking Codex auth...",
            sdk: nil,
            geminiAdc: nil
        ),
        gemini: SidecarProviderEnvironment(
            available: false,
            source: "unknown",
            message: "Checking Gemini auth...",
            sdk: nil,
            geminiAdc: nil
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
            if let gemini = environment.gemini {
                lines.append("- Gemini: \(gemini.available ? "available" : "unavailable") (\(gemini.source)) - \(gemini.message)")
                if let sdk = gemini.sdk {
                    lines.append("  SDK: \(sdk.available ? "available" : "unavailable") \(sdk.packageName ?? "Google Gen AI SDK") \(sdk.version ?? "") - \(sdk.entrypointPath ?? "unknown")")
                }
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
