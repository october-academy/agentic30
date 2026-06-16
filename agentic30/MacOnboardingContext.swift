import Foundation

enum OnboardingWorkMode: String, Codable, CaseIterable, Hashable {
    case fullTimeSolo = "full_time_solo"
    case sideProject = "side_project"
    case teamStartup = "team_startup"
    case exploring

    static let onboardingChoices: [OnboardingWorkMode] = [
        .fullTimeSolo,
        .sideProject,
        .teamStartup,
    ]

    var displayTitle: String {
        switch self {
        case .fullTimeSolo: return "전업으로 혼자 만들고 있음"
        case .sideProject: return "직장·학업과 병행하는 중"
        case .teamStartup: return "팀과 함께 만드는 중"
        case .exploring: return "아직 상황을 정리 중"
        }
    }

    var displayDescription: String {
        switch self {
        case .fullTimeSolo: return "하루 대부분을 제품에 쓰고 직접 결정합니다"
        case .sideProject: return "직장, 학업, 취업 준비 사이의 고정된 시간에 만듭니다"
        case .teamStartup: return "함께 정하는 사람이 있거나 작은 팀이 있습니다"
        case .exploring: return "아직 시간·역할·책임 범위를 정리하는 중입니다"
        }
    }
}

enum OnboardingFocusArea: String, Codable, CaseIterable, Hashable {
    case development
    case design
    case productPlanning = "product_planning"
    case customerAcquisition = "customer_acquisition"
    case salesMonetization = "sales_monetization"

    static let onboardingQuestion = "요즘 어디에 시간을 가장 많이 쓰고 있나요?"
    static let onboardingSubtitle = "어디에 집중하고 있는지에 따라, 지금 필요한 도움을 더 정확히 드립니다."

    static let onboardingChoices: [OnboardingFocusArea] = [
        .development,
        .design,
        .productPlanning,
        .customerAcquisition,
        .salesMonetization,
    ]

    var displayTitle: String {
        switch self {
        case .development: return "개발"
        case .design: return "디자인"
        case .productPlanning: return "제품 기획"
        case .customerAcquisition: return "고객 확보"
        case .salesMonetization: return "판매 / 수익화"
        }
    }

    var displayDescription: String {
        switch self {
        case .development: return "앱·웹 등 제품을 직접 구현하고 있습니다."
        case .design: return "화면, UX, 브랜드, 사용 흐름을 다듬고 있습니다."
        case .productPlanning: return "문제 정의, 기능 우선순위, 제품 방향을 정리하고 있습니다."
        case .customerAcquisition: return "사용자를 찾고, 홍보하고, 유입 채널을 실험하고 있습니다."
        case .salesMonetization: return "가격, 결제, 유료 제안, 매출 전환을 실험하고 있습니다."
        }
    }
}

enum OnboardingProductBottleneck: String, Codable, CaseIterable, Hashable {
    case problemDefinition = "problem_definition"
    case firstActiveUsers = "first_active_users"
    case repeatUsage = "repeat_usage"
    case pricingOffer = "pricing_offer"

    static let onboardingQuestion = "지금 제품을 만들거나 키우는 과정에서 가장 큰 병목은 어디인가요?"

    static let onboardingChoices: [OnboardingProductBottleneck] = [
        .problemDefinition,
        .firstActiveUsers,
        .repeatUsage,
        .pricingOffer,
    ]

    var displayTitle: String {
        switch self {
        case .problemDefinition: return "누구의 어떤 문제를 풀어야 할지 모르겠다."
        case .firstActiveUsers: return "제품은 있지만 첫 활성 사용자를 찾지 못하고 있다."
        case .repeatUsage: return "사용자는 있지만 반복 사용으로 이어지지 않는다."
        case .pricingOffer: return "쓰는 사람은 있지만 결제 제안·가격 설정이 막혀 있다."
        }
    }

    var displayDescription: String {
        switch self {
        case .problemDefinition: return "대상 사용자와 반복 통증을 좁히는 증거가 먼저 필요합니다"
        case .firstActiveUsers: return "처음 가치를 느끼는 사용자를 찾고 활성 행동을 만들어야 합니다"
        case .repeatUsage: return "다시 돌아오게 만드는 이유와 사용 리듬을 확인해야 합니다"
        case .pricingOffer: return "누구에게 얼마를 어떻게 제안할지 검증해야 합니다"
        }
    }
}

enum OnboardingIsolationLevel: String, Codable, CaseIterable, Hashable {
    case projectFolder = "project_folder"
    case workLog = "work_log"
    case occasional
    case weeklyLoop = "weekly_loop"
    case paymentResponses = "payment_responses"
    case community

    // UPDATE this list when adding new OnboardingIsolationLevel cases.
    static var allCases: [OnboardingIsolationLevel] {
        [
            .projectFolder,
            .workLog,
            .occasional,
            .weeklyLoop,
            .paymentResponses,
            .community,
        ]
    }

    var displayTitle: String {
        switch self {
        case .projectFolder: return "프로젝트 폴더"
        case .workLog: return "프로젝트 일지"
        case .occasional: return "고객 대화 기록"
        case .weeklyLoop: return "공개 기록·Threads·블로그"
        case .paymentResponses: return "가격·결제 반응"
        case .community: return "아직 기록은 없다"
        }
    }

    var displayDescription: String {
        switch self {
        case .projectFolder: return "코드, 문서, 설정 등 작업 중인 폴더를 읽을 수 있습니다"
        case .workLog: return "프로젝트에서 만든 것, 막힌 것, 배운 것을 읽을 수 있습니다"
        case .occasional: return "고객이 말한 내용이나 인터뷰 파일이 있습니다"
        case .weeklyLoop: return "공개 실행, 반응, 배움을 기록한 채널이 있습니다"
        case .paymentResponses: return "가격 제안, 결제 거절, 환불·이탈 응답이 있습니다"
        case .community: return "오늘부터 문제 메모와 실행 기록을 만들 수 있습니다"
        }
    }
}

struct OnboardingContext: Codable, Hashable {
    var businessDescription: String
    var currentStage: String
    var goal: String
    var customWorkMode: String
    var workMode: OnboardingWorkMode
    var focusArea: OnboardingFocusArea
    var productBottleneck: OnboardingProductBottleneck
    var isolationLevel: OnboardingIsolationLevel
    var isolationLevels: [OnboardingIsolationLevel]
    var completedAt: String

    private enum CodingKeys: String, CodingKey {
        case businessDescription = "business_description"
        case currentStage = "current_stage"
        case goal
        case customWorkMode = "custom_work_mode"
        case workMode = "work_mode"
        case focusArea = "focus_area"
        case productBottleneck = "product_bottleneck"
        case isolationLevel = "isolation_level"
        case isolationLevels = "isolation_levels"
        case completedAt = "completed_at"
    }

    init(
        businessDescription: String = "",
        currentStage: String = "",
        goal: String = "",
        customWorkMode: String = "",
        workMode: OnboardingWorkMode,
        focusArea: OnboardingFocusArea,
        productBottleneck: OnboardingProductBottleneck,
        isolationLevel: OnboardingIsolationLevel,
        isolationLevels: [OnboardingIsolationLevel]? = nil,
        completedAt: String
    ) {
        self.businessDescription = businessDescription.trimmedContextAnswer
        self.currentStage = currentStage.trimmedContextAnswer
        self.goal = goal.trimmedContextAnswer
        self.customWorkMode = customWorkMode.trimmedContextAnswer
        self.workMode = workMode
        self.focusArea = focusArea
        self.productBottleneck = productBottleneck
        self.isolationLevel = isolationLevel
        let levels: [OnboardingIsolationLevel]
        if let isolationLevels, !isolationLevels.isEmpty {
            levels = isolationLevels
        } else {
            levels = [isolationLevel]
        }
        self.isolationLevels = Array(Set(levels)).sorted { $0.rawValue < $1.rawValue }
        self.completedAt = completedAt
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        businessDescription = try container.decodeIfPresent(String.self, forKey: .businessDescription)?.trimmedContextAnswer ?? ""
        currentStage = try container.decodeIfPresent(String.self, forKey: .currentStage)?.trimmedContextAnswer ?? ""
        goal = try container.decodeIfPresent(String.self, forKey: .goal)?.trimmedContextAnswer ?? ""
        customWorkMode = try container.decodeIfPresent(String.self, forKey: .customWorkMode)?.trimmedContextAnswer ?? ""
        workMode = try container.decodeIfPresent(OnboardingWorkMode.self, forKey: .workMode) ?? .fullTimeSolo
        focusArea = try container.decode(OnboardingFocusArea.self, forKey: .focusArea)
        productBottleneck = try container.decode(OnboardingProductBottleneck.self, forKey: .productBottleneck)
        isolationLevel = try container.decode(OnboardingIsolationLevel.self, forKey: .isolationLevel)
        isolationLevels = try container.decodeIfPresent([OnboardingIsolationLevel].self, forKey: .isolationLevels) ?? [isolationLevel]
        if isolationLevels.isEmpty {
            isolationLevels = [isolationLevel]
        }
        completedAt = try container.decode(String.self, forKey: .completedAt)
    }

    static func make(
        businessDescription: String = "",
        currentStage: String = "",
        goal: String = "",
        customWorkMode: String = "",
        workMode: OnboardingWorkMode = .fullTimeSolo,
        focusArea: OnboardingFocusArea,
        productBottleneck: OnboardingProductBottleneck,
        isolationLevel: OnboardingIsolationLevel,
        isolationLevels: [OnboardingIsolationLevel]? = nil
    ) -> OnboardingContext {
        OnboardingContext(
            businessDescription: businessDescription,
            currentStage: currentStage,
            goal: goal,
            customWorkMode: customWorkMode,
            workMode: workMode,
            focusArea: focusArea,
            productBottleneck: productBottleneck,
            isolationLevel: isolationLevel,
            isolationLevels: isolationLevels,
            completedAt: ISO8601DateFormatter().string(from: Date())
        )
    }

    var bridgePayload: [String: Any] {
        [
            "business_description": businessDescription,
            "current_stage": currentStage,
            "goal": goal,
            "custom_work_mode": customWorkMode,
            "work_mode": workMode.rawValue,
            "focus_area": focusArea.rawValue,
            "product_bottleneck": productBottleneck.rawValue,
            "isolation_level": isolationLevel.rawValue,
            "isolation_levels": isolationLevels.map(\.rawValue),
            "completed_at": completedAt,
        ]
    }

    /// Builds Assistant system prompt fragment per design doc decision rules R1/R2/R3.
    /// Owner: ContentView Assistant call wrapper. Single source of truth for tone personalization.
    var assistantSystemPromptFragment: String {
        var lines: [String] = []
        if !businessDescription.isEmpty || !currentStage.isEmpty || !goal.isEmpty {
            lines.append(
                "온보딩 답변: 사업 설명=\(businessDescription); 현재 단계=\(currentStage); 30일 목표=\(goal)."
            )
        }
        let workModeContext = customWorkMode.isEmpty
            ? workMode.rawValue
            : "\(workMode.rawValue)(\(customWorkMode))"
        lines.append(
            "유저 컨텍스트: \(workModeContext) · \(focusArea.rawValue) · \(productBottleneck.rawValue) · \(isolationLevels.map(\.rawValue).joined(separator: ","))."
        )
        switch workMode {
        case .fullTimeSolo:
            lines.append("[R0] 전업 1인 개발자 기준으로 실행 강도를 높이고, 30일 안에 증거를 남기는 방향으로 답하세요.")
        case .sideProject:
            lines.append("[R0] 사이드프로젝트 제약을 고려하되, 전업자 기준의 우선순위와 trade-off를 명확히 알려주세요.")
        case .teamStartup:
            lines.append("[R0] 팀 매칭이나 공동창업 조언보다, 1인 실행 시스템과 기록 기반 검증 관점으로 답하세요.")
        case .exploring:
            if customWorkMode.isEmpty {
                lines.append("[R0] 아이디어 탐색을 빠르게 좁히고, 오늘 만들 기록/인터뷰 입력을 먼저 만들도록 안내하세요.")
            } else {
                lines.append("[R0] 사용자가 직접 입력한 빌드 상황을 기준으로 제약과 다음 실행을 구체화하세요.")
            }
        }

        switch productBottleneck {
        case .problemDefinition:
            lines.append("[R1] 문제 정의·인터뷰·타깃 세분화 조언 비중을 높여주세요.")
        case .firstActiveUsers:
            lines.append("[R1] 첫 활성 사용자 획득과 activation 증거 조언 비중을 높여주세요.")
        case .repeatUsage:
            lines.append("[R1] 반복 사용·리텐션·이탈 신호 조언 비중을 높여주세요.")
        case .pricingOffer:
            lines.append("[R1] 결제 제안·가격 설정·지불 의사 검증 조언 비중을 높여주세요.")
        }

        if isolationLevels.contains(.projectFolder) {
            lines.append("[R2] 프로젝트 폴더의 코드·문서·설정 상태를 근거로 오늘의 실행 과제를 구체화하세요.")
        }
        if isolationLevels.contains(.workLog) {
            lines.append("[R2] 프로젝트 일지에서 오늘 만든 것, 막힌 것, 배운 것을 근거로 다음 실행 과제를 구체화하세요.")
        }
        if isolationLevels.contains(.occasional) {
            lines.append("[R2] 고객 인터뷰 원문에서 과거 행동, 현재 대안, 비용 신호를 우선 추출하세요.")
        }
        if isolationLevels.contains(.weeklyLoop) {
            lines.append("[R2] BIP (Build In Public) 반응과 공개 실행 기록을 다음 proof 목표로 연결하세요.")
        }
        if isolationLevels.contains(.paymentResponses) {
            lines.append("[R2] 가격 제안, 결제 거절, 환불·이탈 응답에서 지불 의사와 막힌 이유를 우선 추출하세요.")
        }
        if isolationLevels.contains(.community) {
            lines.append("[R2] 기록이 없다는 전제로, 오늘 만들 첫 problem memo 또는 인터뷰 입력부터 요구하세요.")
        }

        switch focusArea {
        case .development:
            lines.append("[R3] 구현 흐름, 기술 trade-off, 다음 코드/배포 단계를 구체적으로 제안하세요.")
        case .design:
            lines.append("[R3] 화면, UX, 브랜드, 사용 흐름 관점의 판단 기준을 먼저 제안하세요.")
        case .productPlanning:
            lines.append("[R3] 문제 정의, 기능 우선순위, 제품 방향을 정리하는 방식으로 제안하세요.")
        case .customerAcquisition:
            lines.append("[R3] 사용자 탐색, 홍보, 유입 채널 실험 중심으로 제안하세요.")
        case .salesMonetization:
            lines.append("[R3] 가격, 결제, 유료 제안, 매출 전환 실험 중심으로 제안하세요.")
        }

        return lines.joined(separator: "\n")
    }
}

struct WorkspaceOnboardingMemory: Codable, Hashable {
    struct Answer: Codable, Hashable {
        var id: String
        var question: String
        var answer: String
        var detail: String
    }

    struct Answers: Codable, Hashable {
        var timeBudget: Answer
        var primaryFocus: Answer
        var primaryBottleneck: Answer
        var existingRecords: Answer
    }

    struct ReadSource: Codable, Hashable {
        var id: String
        var displayName: String
        var category: String
        var kind: String
        var status: String
        var path: String
        var detail: String
    }

    static let schema = "agentic30.memory.onboarding.v3"
    static let schemaVersion = 3

    var schemaVersion: Int
    var schema: String
    var workspaceRoot: String
    var projectPath: String
    var answers: Answers
    var onboardingContext: OnboardingContext
    var readSources: [ReadSource]
    var createdAt: String
    var updatedAt: String

    enum CodingKeys: String, CodingKey {
        case schemaVersion
        case schema
        case workspaceRoot
        case projectPath
        case answers
        case onboardingContext
        case readSources
        case createdAt
        case updatedAt
    }

    @MainActor
    static func make(
        context: OnboardingContext,
        workspaceRoot: String,
        intakeStore: IntakeV2Store? = nil,
        sources: [IntakeSourceState] = [],
        now: Date = Date()
    ) -> WorkspaceOnboardingMemory {
        let timestamp = ISO8601DateFormatter().string(from: now)
        let trimmedRoot = workspaceRoot.trimmingCharacters(in: .whitespacesAndNewlines)
        let sourceStates = normalizedReadSources(
            context: context,
            workspaceRoot: trimmedRoot,
            intakeStore: intakeStore,
            sources: sources
        )
        let timeAnswer = answer(
            id: "time_budget",
            question: "하루에 얼마나 시간을 쓸 수 있는지",
            answer: intakeStore?.commitmentLevel?.rawValue ?? context.customWorkMode.nonEmptyValue ?? context.workMode.rawValue,
            detail: intakeStore?.commitmentLevel?.displayTitle ?? context.customWorkMode.nonEmptyValue ?? context.workMode.displayTitle
        )
        let focusAnswer = answer(
            id: "primary_focus",
            question: OnboardingFocusArea.onboardingQuestion,
            answer: context.focusArea.rawValue,
            detail: context.focusArea.displayTitle
        )
        let blockerAnswer = answer(
            id: "primary_bottleneck",
            question: OnboardingProductBottleneck.onboardingQuestion,
            answer: context.productBottleneck.rawValue,
            detail: context.productBottleneck.displayTitle
        )
        let records = context.isolationLevels.map(\.rawValue).joined(separator: ",")
        let recordsDetail = context.isolationLevels.map(\.displayTitle).joined(separator: ", ")
        let recordAnswer = answer(
            id: "existing_records",
            question: "이미 가진 기록",
            answer: records,
            detail: recordsDetail
        )
        return WorkspaceOnboardingMemory(
            schemaVersion: Self.schemaVersion,
            schema: Self.schema,
            workspaceRoot: trimmedRoot,
            projectPath: trimmedRoot,
            answers: Answers(
                timeBudget: timeAnswer,
                primaryFocus: focusAnswer,
                primaryBottleneck: blockerAnswer,
                existingRecords: recordAnswer
            ),
            onboardingContext: context,
            readSources: sourceStates,
            createdAt: context.completedAt.isEmpty ? timestamp : context.completedAt,
            updatedAt: timestamp
        )
    }

    var sidecarPayload: [String: Any] {
        [
            "schemaVersion": schemaVersion,
            "schema": schema,
            "workspaceRoot": workspaceRoot,
            "projectPath": projectPath,
            "answers": [
                "timeBudget": answers.timeBudget.payload,
                "primaryFocus": answers.primaryFocus.payload,
                "primaryBottleneck": answers.primaryBottleneck.payload,
                "existingRecords": answers.existingRecords.payload,
            ],
            "onboardingContext": onboardingContext.bridgePayload,
            "readSources": readSources.map(\.payload),
            "createdAt": createdAt,
            "updatedAt": updatedAt,
        ]
    }

    private static func answer(id: String, question: String, answer: String, detail: String) -> Answer {
        Answer(
            id: id,
            question: question,
            answer: answer.trimmingCharacters(in: .whitespacesAndNewlines),
            detail: detail.trimmingCharacters(in: .whitespacesAndNewlines)
        )
    }

    @MainActor
    private static func normalizedReadSources(
        context: OnboardingContext,
        workspaceRoot: String,
        intakeStore: IntakeV2Store?,
        sources: [IntakeSourceState]
    ) -> [ReadSource] {
        var states = sources
        if states.isEmpty {
            states = context.isolationLevels.map { level in
                IntakeSourceState(
                    id: sourceID(for: level),
                    status: .disabled,
                    path: level == .projectFolder ? workspaceRoot.nonEmptyValue : nil,
                    detail: level.displayTitle
                )
            }
        }
        if let folderURL = intakeStore?.folderURL,
           !states.contains(where: { $0.id == .localFolder }) {
            states.insert(
                IntakeSourceState(id: .localFolder, status: .connected, path: folderURL.path, detail: "Project folder"),
                at: 0
            )
        } else if !workspaceRoot.isEmpty,
                  context.isolationLevels.contains(.projectFolder),
                  !states.contains(where: { $0.id == .localFolder }) {
            states.insert(
                IntakeSourceState(id: .localFolder, status: .connected, path: workspaceRoot, detail: "Project folder"),
                at: 0
            )
        }
        var seen = Set<IntakeSourceID>()
        return states.compactMap { state in
            guard !seen.contains(state.id) else { return nil }
            seen.insert(state.id)
            let item = IntakeSourceCatalog.item(for: state.id)
            return ReadSource(
                id: state.id.rawValue,
                displayName: state.id.displayName,
                category: item?.category.rawValue ?? "",
                kind: item?.kind ?? "",
                status: state.status.rawValue,
                path: state.path ?? "",
                detail: state.detail ?? item?.why ?? ""
            )
        }
    }

    private static func sourceID(for level: OnboardingIsolationLevel) -> IntakeSourceID {
        switch level {
        case .projectFolder: return .localFolder
        case .workLog: return .workLogFolder
        case .occasional: return .interviewTranscriptFolder
        case .weeklyLoop: return .threads
        case .paymentResponses: return .stripe
        case .community: return .customManualNote
        }
    }
}

private extension WorkspaceOnboardingMemory.Answer {
    var payload: [String: Any] {
        [
            "id": id,
            "question": question,
            "answer": answer,
            "detail": detail,
        ]
    }
}

private extension WorkspaceOnboardingMemory.ReadSource {
    var payload: [String: Any] {
        [
            "id": id,
            "displayName": displayName,
            "category": category,
            "kind": kind,
            "status": status,
            "path": path,
            "detail": detail,
        ]
    }
}

enum WorkspaceMemoryStore {
    static func onboardingMemoryURL(workspaceRoot: String) -> URL? {
        let root = workspaceRoot.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !root.isEmpty else { return nil }
        return URL(fileURLWithPath: root, isDirectory: true)
            .appendingPathComponent(".agentic30", isDirectory: true)
            .appendingPathComponent("memory", isDirectory: true)
            .appendingPathComponent("onboarding.json")
    }

    static func loadOnboardingMemory(workspaceRoot: String) -> WorkspaceOnboardingMemory? {
        guard let url = onboardingMemoryURL(workspaceRoot: workspaceRoot),
              let data = try? Data(contentsOf: url),
              let memory = try? JSONDecoder().decode(WorkspaceOnboardingMemory.self, from: data),
              memory.schema == WorkspaceOnboardingMemory.schema
        else { return nil }
        return memory
    }

    static func loadOnboardingContext(workspaceRoot: String) -> OnboardingContext? {
        loadOnboardingMemory(workspaceRoot: workspaceRoot)?.onboardingContext
    }

    static func saveOnboardingMemory(_ memory: WorkspaceOnboardingMemory) throws {
        guard let url = onboardingMemoryURL(workspaceRoot: memory.workspaceRoot) else {
            throw WorkspaceMemoryError.missingWorkspaceRoot
        }
        let directory = url.deletingLastPathComponent()
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        let data = try encoder.encode(memory)
        let temporaryURL = directory.appendingPathComponent(".onboarding.json.\(UUID().uuidString).tmp")
        try data.write(to: temporaryURL)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: temporaryURL.path)
        if FileManager.default.fileExists(atPath: url.path) {
            try FileManager.default.removeItem(at: url)
        }
        try FileManager.default.moveItem(at: temporaryURL, to: url)
        try? FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
    }

    enum WorkspaceMemoryError: LocalizedError {
        case missingWorkspaceRoot

        var errorDescription: String? {
            switch self {
            case .missingWorkspaceRoot:
                return "Workspace root is required to write .agentic30 memory."
            }
        }
    }
}

enum OnboardingContextSubmissionStatus: Hashable {
    case idle
    case submitting
    case failed(String)
}

private extension String {
    var nonEmptyValue: String? {
        let trimmed = trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}

struct OnboardingProgramIntro {
    static let requiredSceneIDs = [
        "intro_welcome",
        "intro_assistant",
    ]

    static let scenes: [Scene] = [
        Scene(
            id: "intro_welcome",
            title: "혼자, 30일, 100명, 첫 매출",
            subtitle: "1인 개발자가 출시부터 첫 결제까지 끝내는 30일 챌린지.",
            visual: .mark
        ),
        Scene(
            id: "intro_assistant",
            title: "혼자 만들지만, 혼자 막막하지 않게",
            subtitle: "프로젝트 문서, 인터뷰 기록, 결제 응답, 연결된 Google·Notion 문서를 읽고 오늘의 한 가지를 골라드립니다.",
            visual: .briefing
        ),
    ]

    struct Scene: Hashable {
        enum Visual: Hashable {
            case mark
            case briefing
            case launch
            case integrations
        }

        var id: String
        var title: String
        var subtitle: String
        var visual: Visual
    }
}

struct OnboardingCompletionTiming {
    static let maximumDurationSeconds: TimeInterval = 120
    static let programIntroSceneCount = 2
    static let requiredContextQuestionIDs = [
        "business_description",
        "current_stage",
        "goal",
    ]

    static let plannedSteps: [PlannedStep] = [
        PlannedStep(id: "intro_welcome", kind: .programIntro, estimatedSeconds: 8),
        PlannedStep(id: "intro_assistant", kind: .programIntro, estimatedSeconds: 8),
        PlannedStep(id: "business_description", kind: .contextQuestion, estimatedSeconds: 24),
        PlannedStep(id: "current_stage", kind: .contextQuestion, estimatedSeconds: 24),
        PlannedStep(id: "goal", kind: .contextQuestion, estimatedSeconds: 24),
        PlannedStep(id: "submit_context", kind: .completion, estimatedSeconds: 6),
    ]

    struct PlannedStep: Equatable {
        enum Kind: Equatable {
            case programIntro
            case contextQuestion
            case completion
        }

        var id: String
        var kind: Kind
        var estimatedSeconds: TimeInterval
    }

    struct PlannedFlowReport: Equatable {
        var introSceneCount: Int
        var contextQuestionIDs: [String]
        var estimatedSeconds: TimeInterval
        var maximumSeconds: TimeInterval

        var canCompleteWithinBudget: Bool {
            estimatedSeconds <= maximumSeconds
        }

        var remainingSeconds: TimeInterval {
            maximumSeconds - estimatedSeconds
        }
    }

    struct MeasuredFlowReport: Equatable {
        var introViewed: Bool
        var answeredQuestionIDs: [String]
        var missingQuestionIDs: [String]
        var elapsedSeconds: TimeInterval
        var maximumSeconds: TimeInterval

        var hasRequiredQuestions: Bool {
            missingQuestionIDs.isEmpty
        }

        var isWithinBudget: Bool {
            elapsedSeconds <= maximumSeconds
        }

        var isComplete: Bool {
            introViewed && hasRequiredQuestions && isWithinBudget
        }
    }

    static func plannedFlowReport(
        steps: [PlannedStep] = plannedSteps,
        maximumSeconds: TimeInterval = maximumDurationSeconds
    ) -> PlannedFlowReport {
        PlannedFlowReport(
            introSceneCount: steps.filter { $0.kind == .programIntro }.count,
            contextQuestionIDs: steps.filter { $0.kind == .contextQuestion }.map(\.id),
            estimatedSeconds: steps.reduce(0) { $0 + $1.estimatedSeconds },
            maximumSeconds: maximumSeconds
        )
    }

    static func measuredFlowReport(
        startedAt: Date,
        completedAt: Date,
        introViewed: Bool,
        answeredQuestionIDs: [String],
        maximumSeconds: TimeInterval = maximumDurationSeconds
    ) -> MeasuredFlowReport {
        let normalizedAnsweredIDs = Set(answeredQuestionIDs.map(normalizeQuestionID).filter { !$0.isEmpty })
        let missingQuestionIDs = requiredContextQuestionIDs.filter { !normalizedAnsweredIDs.contains($0) }
        return MeasuredFlowReport(
            introViewed: introViewed,
            answeredQuestionIDs: requiredContextQuestionIDs.filter { normalizedAnsweredIDs.contains($0) },
            missingQuestionIDs: missingQuestionIDs,
            elapsedSeconds: max(0, completedAt.timeIntervalSince(startedAt)),
            maximumSeconds: maximumSeconds
        )
    }

    nonisolated private static func normalizeQuestionID(_ value: String) -> String {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        switch trimmed {
        case "onboardingContext.businessDescription":
            return "business_description"
        case "onboardingContext.currentStage":
            return "current_stage"
        case "onboardingContext.goal":
            return "goal"
        default:
            return trimmed
        }
    }
}

enum OnboardingContextQuestionValidationError: Error, Equatable, LocalizedError {
    case missingBusinessDescription
    case missingCurrentStage
    case missingGoal
    case duplicateAnswers

    var errorDescription: String? {
        switch self {
        case .missingBusinessDescription:
            return "사업 설명을 입력해 주세요."
        case .missingCurrentStage:
            return "현재 단계를 입력해 주세요."
        case .missingGoal:
            return "30일 목표를 입력해 주세요."
        case .duplicateAnswers:
            return "세 질문에는 서로 다른 답변을 입력해 주세요."
        }
    }
}

struct OnboardingContextQuestionResponses: Codable, Hashable {
    var businessDescription: String
    var currentStage: String
    var goal: String

    init(
        businessDescription: String,
        currentStage: String,
        goal: String
    ) throws {
        let businessDescription = businessDescription.trimmedContextAnswer
        let currentStage = currentStage.trimmedContextAnswer
        let goal = goal.trimmedContextAnswer

        guard !businessDescription.isEmpty else {
            throw OnboardingContextQuestionValidationError.missingBusinessDescription
        }
        guard !currentStage.isEmpty else {
            throw OnboardingContextQuestionValidationError.missingCurrentStage
        }
        guard !goal.isEmpty else {
            throw OnboardingContextQuestionValidationError.missingGoal
        }

        let normalizedAnswers = Set([businessDescription, currentStage, goal].map {
            $0.lowercased().trimmingCharacters(in: .whitespacesAndNewlines)
        })
        guard normalizedAnswers.count == 3 else {
            throw OnboardingContextQuestionValidationError.duplicateAnswers
        }

        self.businessDescription = businessDescription
        self.currentStage = currentStage
        self.goal = goal
    }

    var inferredProductBottleneck: OnboardingProductBottleneck {
        let haystack = "\(businessDescription) \(currentStage) \(goal)".lowercased()
        if haystack.contains("repeat")
            || haystack.contains("retained")
            || haystack.contains("retention")
            || haystack.contains("churn")
            || haystack.contains("재방문")
            || haystack.contains("반복")
            || haystack.contains("리텐션")
            || haystack.contains("이탈") {
            return .repeatUsage
        }
        if haystack.contains("price")
            || haystack.contains("pricing")
            || haystack.contains("가격")
            || haystack.contains("결제")
            || haystack.contains("유료")
            || haystack.contains("제안")
            || haystack.contains("수익화") {
            return .pricingOffer
        }
        if haystack.contains("active")
            || haystack.contains("activation")
            || haystack.contains("first user")
            || haystack.contains("첫 사용자")
            || haystack.contains("활성")
            || haystack.contains("사용자")
            || haystack.contains("고객") {
            return .firstActiveUsers
        }
        return .problemDefinition
    }

    func makeContext(
        workMode: OnboardingWorkMode = .fullTimeSolo,
        focusArea: OnboardingFocusArea = .development,
        isolationLevel: OnboardingIsolationLevel = .projectFolder
    ) -> OnboardingContext {
        OnboardingContext.make(
            businessDescription: businessDescription,
            currentStage: currentStage,
            goal: goal,
            workMode: workMode,
            focusArea: focusArea,
            productBottleneck: inferredProductBottleneck,
            isolationLevel: isolationLevel
        )
    }
}

private extension String {
    var trimmedContextAnswer: String {
        components(separatedBy: .whitespacesAndNewlines)
            .filter { !$0.isEmpty }
            .joined(separator: " ")
    }
}
