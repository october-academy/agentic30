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
        AgentModelOption(id: "gemini-3.5-flash", label: "Gemini 3.5 Flash (Best)", provider: .gemini, isRecommended: true),
        AgentModelOption(id: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro (Preview)", provider: .gemini),
        AgentModelOption(id: "gemini-3-flash-preview", label: "Gemini 3 Flash (Preview)", provider: .gemini),
        AgentModelOption(id: "gemini-3.1-flash-lite", label: "Gemini 3.1 Flash Lite", provider: .gemini),
        AgentModelOption(id: "gemini-2.5-pro", label: "Gemini 2.5 Pro", provider: .gemini),
        AgentModelOption(id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", provider: .gemini),
        AgentModelOption(id: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash Lite", provider: .gemini),
    ]

    static let defaultClaudeModelID = "claude-opus-4-7"
    static let defaultCodexModelID = "gpt-5.5"
    static let defaultGeminiModelID = "gemini-3.5-flash"

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
    var iddMode: String?
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
    let goal: String?
    let values: String?
    let likelyUsers: [String]?
    let stage: String?
    let evidence: [String]?
    let confidence: String?
    let suggestedFirstQuestion: String?
}

/// Adaptive Day 1 ICP plan generated during onboarding workspace scan. This is
/// intentionally project-shaped rather than hardcoding the old
/// distance/tools/stuck/last-7-days axes.
struct Day1IcpPlan: Codable, Hashable {
    let schemaVersion: Int
    let source: String?
    let generatedAt: String?
    let confidence: Double?
    let fellBackToDeterministic: Bool?
    let mission: String
    let signals: Day1IcpSignals
    let questions: [Day1IcpQuestion]
    let icpDraft: IcpDraft
    let antiIcp: Day1AntiIcp
    let firstInterviewMessage: FirstInterviewMessage
}

struct Day1IcpSignals: Codable, Hashable {
    let productName: String?
    let currentIcpGuess: String?
    let likelyUsers: [String]
    let problem: String?
    let currentAlternatives: [String]
    let evidenceRefs: [Day1IcpEvidenceRef]
    let missingAssumptions: [String]
    let confidence: String?
}

struct Day1IcpEvidenceRef: Codable, Hashable {
    let path: String
    let reason: String?
    let quote: String?
}

struct Day1IcpQuestion: Codable, Hashable {
    let id: String
    let dimension: String
    let title: String
    let prompt: String
    let highlightPhrases: [String]?
    let helperText: String?
    let options: [Day1IcpQuestionOption]
    let allowFreeText: Bool?
    let freeTextPlaceholder: String?

    nonisolated init(
        id: String,
        dimension: String,
        title: String,
        prompt: String,
        highlightPhrases: [String]? = nil,
        helperText: String?,
        options: [Day1IcpQuestionOption],
        allowFreeText: Bool?,
        freeTextPlaceholder: String?
    ) {
        self.id = id
        self.dimension = dimension
        self.title = title
        self.prompt = prompt
        self.highlightPhrases = highlightPhrases
        self.helperText = helperText
        self.options = options
        self.allowFreeText = allowFreeText
        self.freeTextPlaceholder = freeTextPlaceholder
    }
}

struct Day1IcpQuestionOption: Codable, Hashable {
    let id: String
    let label: String
    let description: String
    let highlightPhrases: [String]?
    let preview: String?
    let antiSignal: Bool?
    let evidenceLabel: String?
    let evidenceLimited: Bool?

    nonisolated init(
        id: String,
        label: String,
        description: String,
        highlightPhrases: [String]? = nil,
        preview: String? = nil,
        antiSignal: Bool? = nil,
        evidenceLabel: String? = nil,
        evidenceLimited: Bool? = nil
    ) {
        self.id = id
        self.label = label
        self.description = description
        self.highlightPhrases = highlightPhrases
        self.preview = preview
        self.antiSignal = antiSignal
        self.evidenceLabel = evidenceLabel
        self.evidenceLimited = evidenceLimited
    }
}

struct IcpDraft: Codable, Hashable {
    let description: String
    let criteria: [String]
    let whyTheyMatter: [String]
    let needs: [String]
    let haves: [String]
    let dontNeeds: [String]
    let evidence: [String]
    let referenceCustomersToFind: [String]
}

struct Day1AntiIcp: Codable, Hashable {
    let summary: String
    let rules: [AntiIcpRule]
    let politeInterestGuardrails: [String]
}

struct AntiIcpRule: Codable, Hashable {
    let id: String
    let label: String
    let reason: String
    let evidenceRef: String?
}

struct FirstInterviewMessage: Codable, Hashable {
    let channel: String
    let recipientPlaceholder: String
    let subject: String?
    let bodyTemplate: String
    let questions: [String]
}

/// Primary Day 1 payload. The sidecar emits this next to the legacy
/// `day1IcpPlan`; hosts should prefer this shape and fall back to the legacy
/// payload for older cached scans.
struct Day1AlignmentPlan: Codable, Hashable {
    let schemaVersion: Int
    let source: String?
    let generatedAt: String?
    let confidence: Double?
    let fellBackToDeterministic: Bool?
    let projectGoal: String
    let mission: String
    let signals: Day1IcpSignals
    let components: Day1AlignmentComponents
    let alignmentStatement: Day1AlignmentStatement
    let qualityGate: Day1AlignmentQualityGate
    let firstInterviewMessage: FirstInterviewMessage
    let day2Handoff: Day1Day2Handoff
    let signalDigest: Day1SignalDigest?

    init(
        schemaVersion: Int,
        source: String? = nil,
        generatedAt: String? = nil,
        confidence: Double? = nil,
        fellBackToDeterministic: Bool? = nil,
        projectGoal: String,
        mission: String,
        signals: Day1IcpSignals,
        components: Day1AlignmentComponents,
        alignmentStatement: Day1AlignmentStatement,
        qualityGate: Day1AlignmentQualityGate,
        firstInterviewMessage: FirstInterviewMessage,
        day2Handoff: Day1Day2Handoff,
        signalDigest: Day1SignalDigest? = nil
    ) {
        self.schemaVersion = schemaVersion
        self.source = source
        self.generatedAt = generatedAt
        self.confidence = confidence
        self.fellBackToDeterministic = fellBackToDeterministic
        self.projectGoal = projectGoal
        self.mission = mission
        self.signals = signals
        self.components = components
        self.alignmentStatement = alignmentStatement
        self.qualityGate = qualityGate
        self.firstInterviewMessage = firstInterviewMessage
        self.day2Handoff = day2Handoff
        self.signalDigest = signalDigest
    }
}

/// Day-1 multi-angle "project situation" summary. Built by the sidecar from the
/// onboarding hypothesis + recent agent work (~/.claude / ~/.codex) + git +
/// README drift. `goalDecision` reuses StructuredPromptQuestion so the existing
/// decision-card renderer drives the button-first goal concretization.
struct Day1SituationSummary: Codable, Hashable {
    let schemaVersion: Int
    let source: String?
    let generatedAt: String?
    let angles: Angles
    let readmeUpdate: ReadmeUpdate
    let nextActions: [NextAction]
    let goalDecision: StructuredPromptQuestion
    let confidence: Double?

    struct Angles: Codable, Hashable {
        let product: String
        let engineering: String
        let recentFocus: String
    }

    struct ReadmeUpdate: Codable, Hashable {
        let hasDrift: Bool
        let suggestion: String
        let missing: [String]
        let stale: [String]
    }

    struct NextAction: Codable, Hashable, Identifiable {
        let label: String
        let rationale: String?
        var id: String { label }
    }
}

struct Day1SignalDigest: Codable, Hashable {
    let schemaVersion: Int
    let rows: [Day1SignalDigestRow]
    let summary: String
}

struct Day1SignalDigestRow: Codable, Hashable {
    let key: String
    let label: String
    let value: String
    let tone: String?
}

struct Day1AlignmentComponents: Codable, Hashable {
    let icp: Day1AlignmentComponent
    let painPoint: Day1AlignmentComponent
    let outcome: Day1AlignmentComponent
}

struct Day1AlignmentComponent: Codable, Hashable {
    let id: String
    let title: String
    let prompt: String
    let highlightPhrases: [String]?
    let helperText: String?
    let statement: String
    let evidence: [String]
    let missingAssumptions: [String]
    let options: [Day1IcpQuestionOption]

    nonisolated init(
        id: String,
        title: String,
        prompt: String,
        highlightPhrases: [String]? = nil,
        helperText: String?,
        statement: String,
        evidence: [String],
        missingAssumptions: [String],
        options: [Day1IcpQuestionOption]
    ) {
        self.id = id
        self.title = title
        self.prompt = prompt
        self.highlightPhrases = highlightPhrases
        self.helperText = helperText
        self.statement = statement
        self.evidence = evidence
        self.missingAssumptions = missingAssumptions
        self.options = options
    }
}

struct Day1AlignmentStatement: Codable, Hashable {
    let statement: String
    let projectGoal: String
    let icp: String
    let painPoint: String
    let outcome: String
}

struct Day1AlignmentQualityGate: Codable, Hashable {
    let score: Double
    let threshold: Double
    let passed: Bool
    let label: String
    let passGate: String
    let failGate: String
    let criteria: [Day1AlignmentQualityCriterion]
}

struct Day1AlignmentQualityCriterion: Codable, Hashable {
    let id: String
    let label: String
    let score: Double
    let maxScore: Double
    let passed: Bool
    let detail: String
}

struct Day1Day2Handoff: Codable, Hashable {
    let title: String
    let body: String
    let focus: String
    let nextDayPrompt: String
    let qualityGateLabel: String?
}

struct IddDocPreview: Identifiable, Codable, Hashable {
    let type: String
    let title: String
    let path: String
    let status: String
    let content: String

    var id: String { type }

    var isWritten: Bool {
        ["written", "written_with_assumptions", "approved"].contains(status)
    }
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

struct NewsMarketRadarSnapshot: Codable, Hashable {
    let schemaVersion: Int
    let generatedAt: Date?
    let nextRefreshAfter: Date?
    let status: NewsMarketRadarStatus
    let workspaceEvidenceRefs: [NewsMarketRadarSourceRef]?
    let lanes: [NewsMarketRadarLane]

    static let empty = NewsMarketRadarSnapshot(
        schemaVersion: 1,
        generatedAt: nil,
        nextRefreshAfter: nil,
        status: NewsMarketRadarStatus(
            state: "idle",
            lastSuccessAt: nil,
            stale: false,
            error: nil,
            reason: nil,
            researchSource: nil,
            stage: nil,
            progressText: nil,
            elapsedMs: nil,
            stepIndex: nil,
            stepCount: nil,
            partialFailures: nil
        ),
        workspaceEvidenceRefs: [],
        lanes: NewsMarketRadarLane.defaultLanes
    )

    var cardCount: Int {
        lanes.reduce(0) { $0 + $1.cards.count }
    }

    var statusLabel: String {
        switch status.state {
        case "refreshing": return "리서치 중"
        case "ready": return status.stale == true ? "캐시됨" : "최신"
        case "failed": return "설정 필요"
        case "stale": return "오래됨"
        default: return "대기"
        }
    }
}

struct NewsMarketRadarStatus: Codable, Hashable {
    let state: String
    let lastSuccessAt: Date?
    let stale: Bool?
    let error: String?
    let reason: String?
    let researchSource: String?
    let stage: String?
    let progressText: String?
    let elapsedMs: Int?
    let stepIndex: Int?
    let stepCount: Int?
    let partialFailures: [NewsMarketRadarPartialFailure]?
}

struct NewsMarketRadarPartialFailure: Codable, Hashable, Identifiable {
    let laneId: String
    let laneTitle: String
    let error: String

    var id: String {
        laneId
    }
}

struct NewsMarketRadarLane: Codable, Hashable, Identifiable {
    let id: String
    let title: String
    let hypothesis: String
    let impact: String
    let confidence: String
    let cards: [NewsMarketRadarCard]

    static let defaultLanes: [NewsMarketRadarLane] = [
        .empty(id: "icp", title: "ICP", hypothesis: "누가 가장 절박한 사용자인가"),
        .empty(id: "problem", title: "문제", hypothesis: "그들이 실제로 겪는 비용/마찰은 무엇인가"),
        .empty(id: "alternatives_pricing", title: "대안/가격", hypothesis: "이미 돈을 쓰는 대안과 가격 기준은 무엇인가"),
        .empty(id: "channel", title: "채널", hypothesis: "어디서 발견하고 설득할 수 있는가"),
        .empty(id: "platform", title: "플랫폼", hypothesis: "어떤 제품/스토어/배포 제약이 있는가"),
    ]

    private static func empty(id: String, title: String, hypothesis: String) -> NewsMarketRadarLane {
        NewsMarketRadarLane(
            id: id,
            title: title,
            hypothesis: hypothesis,
            impact: "unknown",
            confidence: "weak",
            cards: []
        )
    }
}

struct NewsMarketRadarCard: Codable, Hashable, Identifiable {
    let id: String
    let title: String
    let summary: String
    let impact: String
    let confidence: String
    let whyItMatters: String?
    let suggestedHypothesisUpdate: String?
    let suggestedDocTargets: [String]?
    let relatedDays: [Int]?
    let relatedAnswerIds: [String]?
    let sourceRefs: [NewsMarketRadarSourceRef]
    let evidenceStrength: String?
}

struct NewsMarketRadarSourceRef: Codable, Hashable, Identifiable {
    let id: String?
    let sourceType: String
    let title: String
    let url: String?
    let domain: String?
    let path: String?
    let publishedAt: String?
    let excerpt: String?

    var stableID: String {
        url ?? path ?? id ?? title
    }
}

struct BipResearchSnapshot: Codable, Hashable {
    let schemaVersion: Int
    let contentLocale: String?
    let promptProfile: String?
    let contextFingerprint: String?
    let generatedAt: Date?
    let nextRefreshAfter: Date?
    let dayNumber: Int
    let dayTitle: String?
    let dayPhase: String?
    let status: BipResearchStatus
    let briefTitle: String?
    let briefBody: String?
    let querySummary: String?
    let candidateTargetCount: Int?
    let workspaceEvidenceRefs: [BipResearchSourceRef]
    let signals: [BipResearchSignal]
    let candidates: [BipResearchCandidate]

    static let empty = BipResearchSnapshot(
        schemaVersion: 1,
        contentLocale: "ko-KR",
        promptProfile: nil,
        contextFingerprint: nil,
        generatedAt: nil,
        nextRefreshAfter: nil,
        dayNumber: 1,
        dayTitle: nil,
        dayPhase: nil,
        status: BipResearchStatus(
            state: "idle",
            lastSuccessAt: nil,
            stale: false,
            error: nil,
            reason: nil,
            researchSource: nil,
            stage: nil,
            progressText: nil,
            elapsedMs: nil,
            stepIndex: nil,
            stepCount: nil,
            partialFailures: nil
        ),
        briefTitle: nil,
        briefBody: nil,
        querySummary: nil,
        candidateTargetCount: 18,
        workspaceEvidenceRefs: [],
        signals: [],
        candidates: []
    )

    var candidateCount: Int {
        candidates.count
    }

    var statusLabel: String {
        switch status.state {
        case "refreshing": return "리서치 중"
        case "ready": return status.stale == true ? "캐시됨" : "최신"
        case "failed": return "설정 필요"
        case "stale": return "오래됨"
        default: return "대기"
        }
    }

    private enum CodingKeys: String, CodingKey {
        case schemaVersion
        case contentLocale
        case promptProfile
        case contextFingerprint
        case generatedAt
        case nextRefreshAfter
        case dayNumber
        case dayTitle
        case dayPhase
        case status
        case briefTitle
        case briefBody
        case querySummary
        case candidateTargetCount
        case workspaceEvidenceRefs
        case signals
        case candidates
    }

    init(
        schemaVersion: Int,
        contentLocale: String?,
        promptProfile: String?,
        contextFingerprint: String?,
        generatedAt: Date?,
        nextRefreshAfter: Date?,
        dayNumber: Int,
        dayTitle: String?,
        dayPhase: String?,
        status: BipResearchStatus,
        briefTitle: String?,
        briefBody: String?,
        querySummary: String?,
        candidateTargetCount: Int?,
        workspaceEvidenceRefs: [BipResearchSourceRef],
        signals: [BipResearchSignal],
        candidates: [BipResearchCandidate]
    ) {
        self.schemaVersion = schemaVersion
        self.contentLocale = contentLocale
        self.promptProfile = promptProfile
        self.contextFingerprint = contextFingerprint
        self.generatedAt = generatedAt
        self.nextRefreshAfter = nextRefreshAfter
        self.dayNumber = dayNumber
        self.dayTitle = dayTitle
        self.dayPhase = dayPhase
        self.status = status
        self.briefTitle = briefTitle
        self.briefBody = briefBody
        self.querySummary = querySummary
        self.candidateTargetCount = candidateTargetCount
        self.workspaceEvidenceRefs = workspaceEvidenceRefs
        self.signals = signals
        self.candidates = candidates
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        schemaVersion = try container.decodeIfPresent(Int.self, forKey: .schemaVersion) ?? 1
        contentLocale = try container.decodeIfPresent(String.self, forKey: .contentLocale)
        promptProfile = try container.decodeIfPresent(String.self, forKey: .promptProfile)
        contextFingerprint = try container.decodeIfPresent(String.self, forKey: .contextFingerprint)
        generatedAt = try container.decodeIfPresent(Date.self, forKey: .generatedAt)
        nextRefreshAfter = try container.decodeIfPresent(Date.self, forKey: .nextRefreshAfter)
        dayNumber = try container.decodeIfPresent(Int.self, forKey: .dayNumber) ?? 1
        dayTitle = try container.decodeIfPresent(String.self, forKey: .dayTitle)
        dayPhase = try container.decodeIfPresent(String.self, forKey: .dayPhase)
        status = try container.decodeIfPresent(BipResearchStatus.self, forKey: .status) ?? Self.empty.status
        briefTitle = try container.decodeIfPresent(String.self, forKey: .briefTitle)
        briefBody = try container.decodeIfPresent(String.self, forKey: .briefBody)
        querySummary = try container.decodeIfPresent(String.self, forKey: .querySummary)
        candidateTargetCount = try container.decodeIfPresent(Int.self, forKey: .candidateTargetCount)
        workspaceEvidenceRefs = try container.decodeIfPresent([BipResearchSourceRef].self, forKey: .workspaceEvidenceRefs) ?? []
        signals = try container.decodeIfPresent([BipResearchSignal].self, forKey: .signals) ?? []
        candidates = try container.decodeIfPresent([BipResearchCandidate].self, forKey: .candidates) ?? []
    }
}

struct BipResearchStatus: Codable, Hashable {
    let state: String
    let lastSuccessAt: Date?
    let stale: Bool?
    let error: String?
    let reason: String?
    let researchSource: String?
    let stage: String?
    let progressText: String?
    let elapsedMs: Int?
    let stepIndex: Int?
    let stepCount: Int?
    let partialFailures: [BipResearchPartialFailure]?
}

struct BipResearchPartialFailure: Codable, Hashable, Identifiable {
    let laneId: String
    let laneTitle: String
    let error: String

    var id: String {
        laneId
    }
}

struct BipResearchSignal: Codable, Hashable, Identifiable {
    let id: String
    let title: String
    let subtitle: String?
    let state: String?
    let tone: String?
}

struct BipResearchTag: Codable, Hashable, Identifiable {
    let title: String
    let tone: String?

    var id: String {
        title
    }
}

struct BipResearchCandidate: Codable, Hashable, Identifiable {
    let id: String
    let title: String
    let sourceLabel: String?
    let source: String?
    let sourceType: String?
    let medium: String?
    let date: String?
    let matchLabel: String?
    let matchCaption: String?
    let quote: String?
    let whyTitle: String?
    let whyBody: String?
    let usageTitle: String?
    let usageBody: String?
    let gap: String?
    let tags: [BipResearchTag]
    let sourceRefs: [BipResearchSourceRef]
    let draft: String?
    let evidenceStrength: String?

    private enum CodingKeys: String, CodingKey {
        case id
        case title
        case sourceLabel
        case source
        case sourceType
        case medium
        case date
        case matchLabel
        case matchCaption
        case quote
        case whyTitle
        case whyBody
        case usageTitle
        case usageBody
        case gap
        case tags
        case sourceRefs
        case draft
        case evidenceStrength
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decodeIfPresent(String.self, forKey: .id) ?? UUID().uuidString
        title = try container.decodeIfPresent(String.self, forKey: .title) ?? "BIP ICP 후보"
        sourceLabel = try container.decodeIfPresent(String.self, forKey: .sourceLabel)
        source = try container.decodeIfPresent(String.self, forKey: .source)
        sourceType = try container.decodeIfPresent(String.self, forKey: .sourceType)
        medium = try container.decodeIfPresent(String.self, forKey: .medium)
        date = try container.decodeIfPresent(String.self, forKey: .date)
        matchLabel = try container.decodeIfPresent(String.self, forKey: .matchLabel)
        matchCaption = try container.decodeIfPresent(String.self, forKey: .matchCaption)
        quote = try container.decodeIfPresent(String.self, forKey: .quote)
        whyTitle = try container.decodeIfPresent(String.self, forKey: .whyTitle)
        whyBody = try container.decodeIfPresent(String.self, forKey: .whyBody)
        usageTitle = try container.decodeIfPresent(String.self, forKey: .usageTitle)
        usageBody = try container.decodeIfPresent(String.self, forKey: .usageBody)
        gap = try container.decodeIfPresent(String.self, forKey: .gap)
        tags = try container.decodeIfPresent([BipResearchTag].self, forKey: .tags) ?? []
        sourceRefs = try container.decodeIfPresent([BipResearchSourceRef].self, forKey: .sourceRefs) ?? []
        draft = try container.decodeIfPresent(String.self, forKey: .draft)
        evidenceStrength = try container.decodeIfPresent(String.self, forKey: .evidenceStrength)
    }
}

struct BipResearchSourceRef: Codable, Hashable, Identifiable {
    let id: String?
    let sourceType: String
    let platform: String?
    let title: String
    let url: String?
    let domain: String?
    let path: String?
    let publishedAt: String?
    let fetchedAt: String?
    let excerpt: String?

    var stableID: String {
        url ?? path ?? id ?? title
    }
}

struct OpenDesignDayAnswerSubmission: Hashable {
    let questionId: String
    let dimension: String
    let questionTitle: String
    let questionPrompt: String
    let answerId: String
    let answerTitle: String
    let answerDetail: String
    let freeformAnswer: String
    let isAntiSignal: Bool
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
