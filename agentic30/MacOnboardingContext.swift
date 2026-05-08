import Foundation

enum OnboardingWorkMode: String, Codable, CaseIterable, Hashable {
    case fullTimeSolo = "full_time_solo"
    case sideProject = "side_project"
    case teamStartup = "team_startup"
    case exploring

    var displayTitle: String {
        switch self {
        case .fullTimeSolo: return "전업 1인 개발자"
        case .sideProject: return "일·학업과 병행"
        case .teamStartup: return "팀과 함께 만드는 중"
        case .exploring: return "아직 탐색 중"
        }
    }

    var displayDescription: String {
        switch self {
        case .fullTimeSolo: return "퇴사했고 혼자 제품을 만들고 있습니다"
        case .sideProject: return "직장이나 학업을 하면서 틈틈이 만들고 있습니다"
        case .teamStartup: return "함께 정하는 사람이 있거나 작은 팀이 있습니다"
        case .exploring: return "아이디어와 방향을 아직 고르는 중입니다"
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
    case soloAll = "solo_all"
    case occasional
    case weeklyLoop = "weekly_loop"
    case community

    var displayTitle: String {
        switch self {
        case .soloAll: return "프로젝트 폴더 + 업무 일지"
        case .occasional: return "고객 대화 기록"
        case .weeklyLoop: return "공개 기록·Threads·블로그"
        case .community: return "아직 기록은 없다"
        }
    }

    var displayDescription: String {
        switch self {
        case .soloAll: return "오늘 만든 것, 막힌 것, 배운 것을 읽을 수 있습니다"
        case .occasional: return "고객이 말한 내용이나 인터뷰 파일이 있습니다"
        case .weeklyLoop: return "공개 실행, 반응, 배움을 기록한 채널이 있습니다"
        case .community: return "오늘부터 문제 메모와 실행 기록을 만들 수 있습니다"
        }
    }
}

struct OnboardingContext: Codable, Hashable {
    var workMode: OnboardingWorkMode
    var role: OnboardingRole
    var projectStage: OnboardingProjectStage
    var isolationLevel: OnboardingIsolationLevel
    var completedAt: String

    private enum CodingKeys: String, CodingKey {
        case workMode = "work_mode"
        case role
        case projectStage = "project_stage"
        case isolationLevel = "isolation_level"
        case completedAt = "completed_at"
    }

    init(
        workMode: OnboardingWorkMode,
        role: OnboardingRole,
        projectStage: OnboardingProjectStage,
        isolationLevel: OnboardingIsolationLevel,
        completedAt: String
    ) {
        self.workMode = workMode
        self.role = role
        self.projectStage = projectStage
        self.isolationLevel = isolationLevel
        self.completedAt = completedAt
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        workMode = try container.decodeIfPresent(OnboardingWorkMode.self, forKey: .workMode) ?? .fullTimeSolo
        role = try container.decode(OnboardingRole.self, forKey: .role)
        projectStage = try container.decode(OnboardingProjectStage.self, forKey: .projectStage)
        isolationLevel = try container.decode(OnboardingIsolationLevel.self, forKey: .isolationLevel)
        completedAt = try container.decode(String.self, forKey: .completedAt)
    }

    static func make(
        workMode: OnboardingWorkMode = .fullTimeSolo,
        role: OnboardingRole,
        projectStage: OnboardingProjectStage,
        isolationLevel: OnboardingIsolationLevel
    ) -> OnboardingContext {
        OnboardingContext(
            workMode: workMode,
            role: role,
            projectStage: projectStage,
            isolationLevel: isolationLevel,
            completedAt: ISO8601DateFormatter().string(from: Date())
        )
    }

    /// Builds Assistant system prompt fragment per design doc decision rules R1/R2/R3.
    /// Owner: ContentView Assistant call wrapper. Single source of truth for tone personalization.
    var assistantSystemPromptFragment: String {
        var lines: [String] = []
        lines.append(
            "유저 컨텍스트: \(workMode.rawValue) · \(role.rawValue) · \(projectStage.rawValue) · \(isolationLevel.rawValue)."
        )

        switch workMode {
        case .fullTimeSolo:
            lines.append("[R0] 전업 1인 개발자 기준으로 실행 강도를 높이고, 30일 안에 증거를 남기는 방향으로 답하세요.")
        case .sideProject:
            lines.append("[R0] 사이드프로젝트 제약을 고려하되, 전업자 기준의 우선순위와 trade-off를 명확히 알려주세요.")
        case .teamStartup:
            lines.append("[R0] 팀 매칭이나 공동창업 조언보다, 1인 실행 시스템과 기록 기반 검증 관점으로 답하세요.")
        case .exploring:
            lines.append("[R0] 아이디어 탐색을 빠르게 좁히고, 오늘 만들 기록/인터뷰 입력을 먼저 만들도록 안내하세요.")
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

        switch isolationLevel {
        case .soloAll:
            lines.append("[R2] 프로젝트 폴더와 업무 일지를 근거로 오늘의 실행 과제를 구체화하세요.")
        case .occasional:
            lines.append("[R2] 고객 인터뷰 원문에서 과거 행동, 현재 대안, 비용 신호를 우선 추출하세요.")
        case .weeklyLoop:
            lines.append("[R2] BIP (Build In Public) 반응과 공개 실행 기록을 다음 proof 목표로 연결하세요.")
        case .community:
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
