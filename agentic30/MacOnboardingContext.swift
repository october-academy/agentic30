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
        case .fullTimeSolo: return "전업 1인 개발자"
        case .sideProject: return "일·학업과 병행"
        case .teamStartup: return "팀과 함께 만드는 중"
        case .exploring: return "기타"
        }
    }

    var displayDescription: String {
        switch self {
        case .fullTimeSolo: return "퇴사했고 혼자 제품을 만들고 있습니다"
        case .sideProject: return "직장이나 학업을 하면서 틈틈이 만들고 있습니다"
        case .teamStartup: return "함께 정하는 사람이 있거나 작은 팀이 있습니다"
        case .exploring: return "내 상황을 직접 입력합니다"
        }
    }
}

enum OnboardingRole: String, Codable, CaseIterable, Hashable {
    case developer
    case designer
    case productManager = "product_manager"
    case student

    var displayTitle: String {
        switch self {
        case .developer: return "개발자"
        case .designer: return "디자이너"
        case .productManager: return "PM"
        case .student: return "학생"
        }
    }

    var displayDescription: String {
        switch self {
        case .developer: return "앱·웹·제품을 직접 구현합니다"
        case .designer: return "브랜드, 시각, 프로덕트 디자인을 다룹니다"
        case .productManager: return "제품·서비스 기획과 운영을 리드합니다"
        case .student: return "학업과 병행하며 제품을 만듭니다"
        }
    }
}

enum OnboardingProjectStage: String, Codable, CaseIterable, Hashable {
    case ideaOnly = "idea_only"
    case building
    case firstUsers = "first_users_5"
    case preRevenue = "pre_revenue"
    case postRevenue = "post_revenue"

    static let onboardingChoices: [OnboardingProjectStage] = [
        .ideaOnly,
        .building,
        .firstUsers,
        .preRevenue,
    ]

    var displayTitle: String {
        switch self {
        case .ideaOnly: return "무엇을 만들어야 할지 모르겠다"
        case .building: return "제품은 있는데 사용자가 오지 않는다"
        case .firstUsers: return "쓰는 사람은 있는데 돈을 못 받고 있다"
        case .preRevenue: return "가격이나 결제 제안이 막혀 있다"
        case .postRevenue: return "이미 매출이 있고 더 키우고 싶다"
        }
    }

    var displayDescription: String {
        switch self {
        case .ideaOnly: return "누구의 어떤 문제를 풀지부터 좁혀야 합니다"
        case .building: return "처음 써보는 사람을 찾거나 붙잡는 일이 막혀 있습니다"
        case .firstUsers: return "사용은 있지만 가격을 물어보거나 결제까지 가지 못했습니다"
        case .preRevenue: return "얼마를 받을지, 누구에게 어떻게 제안할지 정해야 합니다"
        case .postRevenue: return "다시 쓰게 만들고 더 많은 사람에게 알리는 일이 중요합니다"
        }
    }
}

enum OnboardingIsolationLevel: String, Codable, CaseIterable, Hashable {
    case projectFolder = "project_folder"
    case workLog = "work_log"
    case occasional
    case weeklyLoop = "weekly_loop"
    case community

    private static let legacySoloAllRawValue = "solo_all"

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        let rawValue = try container.decode(String.self)
        if rawValue == Self.legacySoloAllRawValue {
            self = .projectFolder
            return
        }
        guard let value = Self(rawValue: rawValue) else {
            throw DecodingError.dataCorruptedError(
                in: container,
                debugDescription: "Invalid onboarding isolation level: \(rawValue)"
            )
        }
        self = value
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(rawValue)
    }

    // UPDATE this list when adding new OnboardingIsolationLevel cases.
    static var allCases: [OnboardingIsolationLevel] {
        [
            .projectFolder,
            .workLog,
            .occasional,
            .weeklyLoop,
            .community,
        ]
    }

    var displayTitle: String {
        switch self {
        case .projectFolder: return "프로젝트 폴더"
        case .workLog: return "업무 일지"
        case .occasional: return "고객 대화 기록"
        case .weeklyLoop: return "공개 기록·Threads·블로그"
        case .community: return "아직 기록은 없다"
        }
    }

    var displayDescription: String {
        switch self {
        case .projectFolder: return "코드, 문서, 설정 등 작업 중인 폴더를 읽을 수 있습니다"
        case .workLog: return "오늘 만든 것, 막힌 것, 배운 것을 읽을 수 있습니다"
        case .occasional: return "고객이 말한 내용이나 인터뷰 파일이 있습니다"
        case .weeklyLoop: return "공개 실행, 반응, 배움을 기록한 채널이 있습니다"
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
    var role: OnboardingRole
    var projectStage: OnboardingProjectStage
    var isolationLevel: OnboardingIsolationLevel
    var isolationLevels: [OnboardingIsolationLevel]
    var completedAt: String

    private enum CodingKeys: String, CodingKey {
        case businessDescription = "business_description"
        case currentStage = "current_stage"
        case goal
        case customWorkMode = "custom_work_mode"
        case workMode = "work_mode"
        case role
        case projectStage = "project_stage"
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
        role: OnboardingRole,
        projectStage: OnboardingProjectStage,
        isolationLevel: OnboardingIsolationLevel,
        isolationLevels: [OnboardingIsolationLevel]? = nil,
        completedAt: String
    ) {
        self.businessDescription = businessDescription.trimmedContextAnswer
        self.currentStage = currentStage.trimmedContextAnswer
        self.goal = goal.trimmedContextAnswer
        self.customWorkMode = customWorkMode.trimmedContextAnswer
        self.workMode = workMode
        self.role = role
        self.projectStage = projectStage
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
        role = try container.decode(OnboardingRole.self, forKey: .role)
        projectStage = try container.decode(OnboardingProjectStage.self, forKey: .projectStage)
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
        role: OnboardingRole,
        projectStage: OnboardingProjectStage,
        isolationLevel: OnboardingIsolationLevel,
        isolationLevels: [OnboardingIsolationLevel]? = nil
    ) -> OnboardingContext {
        OnboardingContext(
            businessDescription: businessDescription,
            currentStage: currentStage,
            goal: goal,
            customWorkMode: customWorkMode,
            workMode: workMode,
            role: role,
            projectStage: projectStage,
            isolationLevel: isolationLevel,
            isolationLevels: isolationLevels,
            completedAt: ISO8601DateFormatter().string(from: Date())
        )
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
            "유저 컨텍스트: \(workModeContext) · \(role.rawValue) · \(projectStage.rawValue) · \(isolationLevels.map(\.rawValue).joined(separator: ","))."
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

        switch projectStage {
        case .firstUsers, .preRevenue, .postRevenue:
            lines.append(
                "[R1] 수익화·마케팅·리텐션 조언 비중을 높여주세요. Foundation 단계 제안은 피하세요."
            )
        case .ideaOnly, .building:
            lines.append(
                "[R1] Foundation 단계(문제 정의·인터뷰·랜딩 검증) 조언 비중을 높여주세요."
            )
        }

        if isolationLevels.contains(.projectFolder) {
            lines.append("[R2] 프로젝트 폴더의 코드·문서·설정 상태를 근거로 오늘의 실행 과제를 구체화하세요.")
        }
        if isolationLevels.contains(.workLog) {
            lines.append("[R2] 업무 일지에서 오늘 만든 것, 막힌 것, 배운 것을 근거로 다음 실행 과제를 구체화하세요.")
        }
        if isolationLevels.contains(.occasional) {
            lines.append("[R2] 고객 인터뷰 원문에서 과거 행동, 현재 대안, 비용 신호를 우선 추출하세요.")
        }
        if isolationLevels.contains(.weeklyLoop) {
            lines.append("[R2] BIP (Build In Public) 반응과 공개 실행 기록을 다음 proof 목표로 연결하세요.")
        }
        if isolationLevels.contains(.community) {
            lines.append("[R2] 기록이 없다는 전제로, 오늘 만들 첫 problem memo 또는 인터뷰 입력부터 요구하세요.")
        }

        if role != .developer {
            lines.append(
                "[R3] 기술 용어 비중을 30% 줄이세요. 코드 스니펫 대신 자연어 설명을 우선하세요."
            )
        }

        return lines.joined(separator: "\n")
    }
}

enum OnboardingContextSubmissionStatus: Hashable {
    case idle
    case submitting
    case failed(String)
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

    var inferredProjectStage: OnboardingProjectStage {
        let haystack = "\(businessDescription) \(currentStage) \(goal)".lowercased()
        // Specific pre-revenue / pricing terms first so they don't get swallowed
        // by the broader "revenue" match below ("pre-revenue", "수익화" before "revenue").
        if haystack.contains("pre-revenue")
            || haystack.contains("prerevenue")
            || haystack.contains("price")
            || haystack.contains("pricing")
            || haystack.contains("가격")
            || haystack.contains("수익화") {
            return .preRevenue
        }
        if haystack.contains("revenue")
            || haystack.contains("매출")
            || haystack.contains("결제")
            || haystack.contains("유료") {
            return .postRevenue
        }
        if haystack.contains("user")
            || haystack.contains("customer")
            || haystack.contains("사용자")
            || haystack.contains("고객") {
            return .firstUsers
        }
        if haystack.contains("build")
            || haystack.contains("mvp")
            || haystack.contains("만드는")
            || haystack.contains("개발") {
            return .building
        }
        return .ideaOnly
    }

    func makeContext(
        workMode: OnboardingWorkMode = .fullTimeSolo,
        role: OnboardingRole = .developer,
        isolationLevel: OnboardingIsolationLevel = .projectFolder
    ) -> OnboardingContext {
        OnboardingContext.make(
            businessDescription: businessDescription,
            currentStage: currentStage,
            goal: goal,
            workMode: workMode,
            role: role,
            projectStage: inferredProjectStage,
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
