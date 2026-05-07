import Foundation

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
        case .ideaOnly: return "아이디어만"
        case .building: return "개발 중"
        case .firstUsers: return "첫 유저 5+"
        case .preRevenue: return "매출 직전"
        case .postRevenue: return "첫 매출 후"
        }
    }

    var displayDescription: String {
        switch self {
        case .ideaOnly: return "아직 코드 한 줄 없음"
        case .building: return "MVP 만드는 중, 아직 유저 없음"
        case .firstUsers: return "사람들이 써보는 중, 결제는 아직"
        case .preRevenue: return "결제 준비 중, 첫 매출 전"
        case .postRevenue: return "1원이라도 벌었음"
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
        case .soloAll: return "다 혼자 한다"
        case .occasional: return "가끔 친구에게 물어본다"
        case .weeklyLoop: return "주간 피드백 루프가 있다"
        case .community: return "커뮤니티·팀에서 활동 중"
        }
    }

    var displayDescription: String {
        switch self {
        case .soloAll: return "물어볼 사람이 없고 모든 판단을 혼자 내림"
        case .occasional: return "비공식적으로 단발성 대화 · 정규 루프 없음"
        case .weeklyLoop: return "멘토 · 스탠드업 · 정기 체크인 중 하나 이상"
        case .community: return "Discord · Slack · 파트너와 상시 대화"
        }
    }
}

struct OnboardingContext: Codable, Hashable {
    var role: OnboardingRole
    var projectStage: OnboardingProjectStage
    var isolationLevel: OnboardingIsolationLevel
    var completedAt: String

    private enum CodingKeys: String, CodingKey {
        case role
        case projectStage = "project_stage"
        case isolationLevel = "isolation_level"
        case completedAt = "completed_at"
    }

    static func make(
        role: OnboardingRole,
        projectStage: OnboardingProjectStage,
        isolationLevel: OnboardingIsolationLevel
    ) -> OnboardingContext {
        OnboardingContext(
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
            "유저 컨텍스트: \(role.rawValue) · \(projectStage.rawValue) · \(isolationLevel.rawValue)."
        )

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

        if isolationLevel == .soloAll {
            lines.append(
                "[R2] 첫 답변에 고립감 해소 멘트 한 줄을 포함하세요. 예: \"혼자 푸는 건 3배 오래 걸립니다. 동료 한 명만 만들어도 속도가 달라집니다.\""
            )
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
