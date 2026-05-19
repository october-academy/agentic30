import AppKit
import SwiftUI

struct OpenDesignDayContent {
    struct RailItem: Identifiable, Hashable {
        let id: String
        let title: String
        let systemImage: String
        let isActive: Bool
        let hasNewDot: Bool
        let route: Route

        enum Route: Hashable {
            case today
            case search
            case settings
            case inert
        }
    }

    struct TaskGroup: Identifiable, Hashable {
        let id: String
        let title: String
        let meta: String
        let tasks: [TaskItem]
    }

    struct TaskItem: Identifiable, Hashable {
        let id: String
        let title: String
        let day: String
        let meta: String
        let state: State

        enum State: Hashable {
            case active
            case pending
            case locked
        }
    }

    struct InterviewStep: Identifiable, Hashable {
        let id: Int
        let title: String
        let meta: String
        let label: String
        let score: String
        let statementPrefix: String
        let markedStatement: String
        let statementSuffix: String
        let criteria: [String]
        let prompt: String
        let progressLabel: String
        let submitLabel: String
        let options: [InterviewOption]
    }

    struct InterviewOption: Identifiable, Hashable {
        let id: Int
        let title: String
        let detail: String
        let tail: String
    }

    struct SearchItem: Identifiable, Hashable {
        enum Kind: String, CaseIterable, Hashable {
            case task
            case section
            case page

            var title: String {
                switch self {
                case .task: return "과제"
                case .section: return "본문 섹션"
                case .page: return "페이지"
                }
            }

            static let displayOrder: [Kind] = [.task, .section, .page]
        }

        let id: String
        let kind: Kind
        let title: String
        let subtitle: String
        let day: String?
        let systemImage: String
        let isActive: Bool
        let isLocked: Bool
        let lockNote: String?
        let targetSectionID: String?
        let route: RailItem.Route
    }

    let railItems: [RailItem]
    let taskGroups: [TaskGroup]
    let interviewSteps: [InterviewStep]
    let searchItems: [SearchItem]

    var lockingFutureDays: OpenDesignDayContent {
        OpenDesignDayContent(
            railItems: railItems,
            taskGroups: taskGroups.map { group in
                TaskGroup(
                    id: group.id,
                    title: group.title,
                    meta: group.meta,
                    tasks: group.tasks.map { task in
                        guard task.id != "day1" else { return task }
                        return TaskItem(
                            id: task.id,
                            title: task.title,
                            day: task.day,
                            meta: task.meta,
                            state: .locked
                        )
                    }
                )
            },
            interviewSteps: interviewSteps,
            searchItems: searchItems.map { item in
                guard item.kind == .task, item.id != "task-day1" else { return item }
                return SearchItem(
                    id: item.id,
                    kind: item.kind,
                    title: item.title,
                    subtitle: item.subtitle,
                    day: item.day,
                    systemImage: "lock",
                    isActive: item.isActive,
                    isLocked: true,
                    lockNote: item.lockNote ?? "Foundation Setup",
                    targetSectionID: item.targetSectionID,
                    route: item.route
                )
            }
        )
    }

    static let day1 = OpenDesignDayContent(
        railItems: [
            RailItem(id: "today", title: "오늘 · Day 1", systemImage: "calendar", isActive: true, hasNewDot: false, route: .today),
            RailItem(id: "search", title: "검색", systemImage: "magnifyingglass", isActive: false, hasNewDot: false, route: .search),
            RailItem(id: "projects", title: "프로젝트", systemImage: "folder", isActive: false, hasNewDot: false, route: .inert),
            RailItem(id: "settings", title: "설정", systemImage: "gearshape", isActive: false, hasNewDot: false, route: .settings),
            RailItem(id: "interviews", title: "인터뷰", systemImage: "bubble.left.and.bubble.right", isActive: false, hasNewDot: false, route: .inert),
            RailItem(id: "bip", title: "BIP 로그", systemImage: "doc.text", isActive: false, hasNewDot: false, route: .inert),
            RailItem(id: "news", title: "뉴스", systemImage: "newspaper", isActive: false, hasNewDot: true, route: .inert),
            RailItem(id: "history", title: "히스토리", systemImage: "clock.arrow.circlepath", isActive: false, hasNewDot: false, route: .inert),
        ],
        taskGroups: [
            TaskGroup(
                id: "week1",
                title: "Week 1 — Foundation",
                meta: "1 / 7",
                tasks: [
                    TaskItem(id: "day1", title: "먼저 도울 사람을 정해요", day: "Day 1", meta: "ICP · 인터뷰 1/3", state: .active),
                    TaskItem(id: "day2", title: "시장 신호 읽기", day: "Day 2", meta: "Market", state: .pending),
                    TaskItem(id: "day3", title: "Mom Test 인터뷰 ×3", day: "Day 3", meta: "Interview", state: .pending),
                    TaskItem(id: "day4", title: "10× 웨지 찾기", day: "Day 4", meta: "Wedge", state: .pending),
                    TaskItem(id: "day5", title: "수요 신호 측정", day: "Day 5", meta: "Demand", state: .pending),
                    TaskItem(id: "day6", title: "Ask 한 줄로 압축", day: "Day 6", meta: "Ask", state: .pending),
                    TaskItem(id: "day7", title: "Go / No-Go 결정 게이트", day: "Day 7", meta: "Gate", state: .pending),
                ]
            ),
            TaskGroup(
                id: "week2",
                title: "Week 2 — Build",
                meta: "잠금 해제 D7",
                tasks: [
                    TaskItem(id: "day8", title: "MVP 코어 4시간 빌드", day: "Day 8", meta: "Build", state: .locked),
                    TaskItem(id: "day9", title: "첫 5명 초대 초안", day: "Day 9", meta: "Outreach", state: .locked),
                    TaskItem(id: "day10", title: "랜딩 카피 & Above-fold", day: "Day 10", meta: "Landing", state: .locked),
                ]
            ),
            TaskGroup(
                id: "week3",
                title: "Week 3 — Acquire",
                meta: "잠금 해제 D14",
                tasks: [
                    TaskItem(id: "day15", title: "BIP 채널 첫 포스트", day: "Day 15", meta: "BIP", state: .locked),
                ]
            ),
            TaskGroup(
                id: "week4",
                title: "Week 4 — Revenue",
                meta: "잠금 해제 D22",
                tasks: [
                    TaskItem(id: "day22", title: "첫 매출 ask · Pricing", day: "Day 22", meta: "Revenue", state: .locked),
                ]
            ),
        ],
        interviewSteps: [
            InterviewStep(
                id: 1,
                title: "인터뷰 1 — 거리",
                meta: "3분 · 직감 OK · 바꿀 수 있음",
                label: "질문 · 이 답이 다음 인터뷰 단계를 정합니다",
                score: "1 / 3",
                statementPrefix: "이번 주 안에 ",
                markedStatement: "DM·메시지·통화 1통",
                statementSuffix: "을 실제로 요청할 수 있는 1인 개발자 유형은 누구인가요?",
                criteria: ["가까울수록 답변 ↑ 객관성 ↓", "멀수록 객관성 ↑ 응답률 ↓", "정답 없음 — 직감으로"],
                prompt: "이 중에서 한 명만 골라요",
                progressLabel: "직접 만날 사람",
                submitLabel: "이 후보로 제출",
                options: [
                    InterviewOption(id: 1, title: "내 Threads 글에 답한 개발자", detail: "이미 문제 맥락에 반응했기 때문에 1대1 대화 시작이 가장 가볍습니다. 모수는 작아도 첫 인터뷰가 빠릅니다.", tail: "+2명 / 7일"),
                    InterviewOption(id: 2, title: "내 글을 저장한 전업 개발자", detail: "공개 반응은 적어도 관심 신호가 있고, 후속 질문으로 실제 시간을 쓰는지 확인하기 좋습니다.", tail: "+9명 / 7일"),
                    InterviewOption(id: 3, title: "전 직장 출신 1인 개발자", detail: "관계 기반이라 답변 가능성이 높고, 퇴사 후 첫 매출 압박을 직접 물어볼 수 있습니다. 그 중에서도 \"AI로 계속 새로 만드는 동료\"가 유력 후보입니다.", tail: "+5명 / 즉시"),
                    InterviewOption(id: 4, title: "이미 아는 사람", detail: "친밀해서 빠르게 만날 수 있지만, 거리가 가까울수록 칭찬형 답변이 늘어 객관적 신호가 약합니다.", tail: "언제든"),
                ]
            ),
            InterviewStep(
                id: 2,
                title: "인터뷰 2 — 도구",
                meta: "3분 · 매일 쓰는 AI 코딩 도구",
                label: "질문 · 도구 사용 패턴이 ICP의 두 번째 축",
                score: "2 / 4",
                statementPrefix: "이 1인 개발자가 ",
                markedStatement: "매일 무엇으로 코드를 쓰는지",
                statementSuffix: "가 도구 적합도와 가격 민감도를 함께 결정합니다.",
                criteria: ["\"둘 다 쓴다\"는 가장 흔한 거짓말", "매일 빈도 = 진실", "정답 없음 — 가장 자주 쓰는 쪽"],
                prompt: "가장 자주 쓰는 도구 하나",
                progressLabel: "매일 쓰는 도구",
                submitLabel: "이 도구로 제출",
                options: [
                    InterviewOption(id: 1, title: "Cursor — 메인 에디터", detail: "VS Code 기반 + 채팅. 자동완성과 Composer가 주력. 결제 의향이 가장 안정적인 풀.", tail: "대세 · 유료"),
                    InterviewOption(id: 2, title: "Claude Code — 터미널 중심", detail: "장기 작업·멀티파일 리팩터링에 강함. 사용량이 늘수록 토큰 비용이 핵심 고통이 됩니다.", tail: "신규 · 폭증"),
                    InterviewOption(id: 3, title: "둘 다 — 작업 분리", detail: "편집은 Cursor, 큰 변경은 Claude Code. 비용 추적과 컨텍스트 동기화가 가장 큰 마찰점.", tail: "실사용 ↑"),
                    InterviewOption(id: 4, title: "비코딩 — PM / 디자인 / 마케팅", detail: "코드는 거의 안 쓰고 AI 에이전트만 굴립니다. 모수는 작지만 도구 의존도가 가장 높은 엣지 ICP.", tail: "엣지 ICP"),
                ]
            ),
            InterviewStep(
                id: 3,
                title: "인터뷰 3 — 막힌 단계",
                meta: "3분 · 지난 7일 멈춘 지점",
                label: "질문 · 어디서 멈추는지가 wedge를 결정합니다",
                score: "3 / 4",
                statementPrefix: "지난 7일에 이 사람이 ",
                markedStatement: "가장 오래 멈췄던 한 단계",
                statementSuffix: "가 우리가 풀 wedge를 결정합니다.",
                criteria: ["\"전반적으로 막힌다\" 답변은 거름", "7일 안에 일어난 한 사건", "단계 이름이 명확해야 진짜"],
                prompt: "지난 7일에 가장 오래 멈춘 단계",
                progressLabel: "7일 안의 한 사건",
                submitLabel: "이 단계로 제출",
                options: [
                    InterviewOption(id: 1, title: "아이디어 — 뭘 만들지", detail: "도구는 준비됐는데 다음에 뭘 빌드할지가 정해지지 않아 시작 자체를 못 합니다.", tail: "가장 흔함"),
                    InterviewOption(id: 2, title: "빌드 — 코드/디자인 끝까지", detail: "시작은 했지만 절반쯤에서 멈추고 새 프로젝트로 옮겨갑니다. AI로 무한 빌드의 함정.", tail: "핵심 통증"),
                    InterviewOption(id: 3, title: "검증 — 사람한테 보여주기", detail: "코드는 끝났지만 누군가에게 보여주는 단계로 넘어가지 못합니다. 인터뷰 자체를 회피.", tail: "wedge 후보"),
                    InterviewOption(id: 4, title: "출시·매출 — 결제 받기", detail: "출시는 했는데 첫 결제까지 가지 못합니다. 가격·체크아웃·신뢰 중 하나에서 막힙니다.", tail: "돈 직결"),
                ]
            ),
            InterviewStep(
                id: 4,
                title: "인터뷰 4 — 지난 7일 행동",
                meta: "3분 · Mom Test · 칭찬형 답변 거르기",
                label: "질문 · 말 대신 실제 한 행동만",
                score: "4 / 4",
                statementPrefix: "지난 7일에 ",
                markedStatement: "실제로 한 행동",
                statementSuffix: " 하나만 골라 주세요. \"할 거예요\" / \"좋네요\"는 빼고요.",
                criteria: ["\"언젠가\" / \"곧\" → 자동 Anti-ICP", "진짜 시간을 쓴 행동만", "없으면 4번을 고르세요"],
                prompt: "지난 7일에 실제로 한 행동",
                progressLabel: "한 사건",
                submitLabel: "이 행동으로 제출",
                options: [
                    InterviewOption(id: 1, title: "새 프로젝트를 또 시작했다", detail: "지난 프로젝트는 절반쯤에서 멈췄고, 새 레포·새 디자인·새 아이디어로 또 한 번 출발했습니다.", tail: "빌드 루프"),
                    InterviewOption(id: 2, title: "실사용자 1명을 만났다", detail: "인터뷰·콜·DM 등으로 실제 사람의 답을 들었습니다. 가장 강한 신호.", tail: "진짜 신호 ↑"),
                    InterviewOption(id: 3, title: "출시를 시도했다", detail: "포스트·결제 링크·랜딩 등 사람들에게 보여지는 행동을 1건 이상 했습니다.", tail: "wedge 검증"),
                    InterviewOption(id: 4, title: "아무 행동도 안 했다", detail: "계획·고민만 7일을 보냈습니다. 솔직한 답 — Anti-ICP 게이트의 출발점이 됩니다.", tail: "Anti-ICP"),
                ]
            ),
        ],
        searchItems: OpenDesignDayContent.makeSearchItems()
    )

    static func makeSearchItems() -> [SearchItem] {
        [
            SearchItem(id: "page-today", kind: .page, title: "오늘 · Day 1", subtitle: "ICP 좁히기", day: nil, systemImage: "scope", isActive: true, isLocked: false, lockNote: nil, targetSectionID: "top", route: .today),
            SearchItem(id: "page-search", kind: .page, title: "검색", subtitle: "전체 페이지 · 과제 찾기", day: nil, systemImage: "magnifyingglass", isActive: false, isLocked: false, lockNote: nil, targetSectionID: nil, route: .search),
            SearchItem(id: "page-projects", kind: .page, title: "프로젝트", subtitle: "활성 3개 · 소스 루트 여러 개 관리", day: nil, systemImage: "folder", isActive: false, isLocked: false, lockNote: nil, targetSectionID: nil, route: .inert),
            SearchItem(id: "page-settings", kind: .page, title: "설정", subtitle: "워크스페이스 · 프로바이더 · 권한", day: nil, systemImage: "gearshape", isActive: false, isLocked: false, lockNote: nil, targetSectionID: nil, route: .settings),
            SearchItem(id: "page-interviews", kind: .page, title: "인터뷰", subtitle: "Mom Test · 노트", day: nil, systemImage: "bubble.left.and.bubble.right", isActive: false, isLocked: false, lockNote: nil, targetSectionID: nil, route: .inert),
            SearchItem(id: "page-bip", kind: .page, title: "BIP 로그", subtitle: "Build in Public", day: nil, systemImage: "doc.text", isActive: false, isLocked: false, lockNote: nil, targetSectionID: nil, route: .inert),
            SearchItem(id: "page-news", kind: .page, title: "뉴스", subtitle: "안 읽음 14건 · 큐레이션", day: nil, systemImage: "newspaper", isActive: false, isLocked: false, lockNote: nil, targetSectionID: nil, route: .inert),
            SearchItem(id: "page-history", kind: .page, title: "히스토리 · 타임라인", subtitle: "변경 · 결정 흐름", day: nil, systemImage: "clock.arrow.circlepath", isActive: false, isLocked: false, lockNote: nil, targetSectionID: nil, route: .inert),
            SearchItem(id: "task-day1", kind: .task, title: "먼저 도울 사람을 정해요", subtitle: "ICP · 인터뷰 1/3", day: "Day 1", systemImage: "circle.dotted", isActive: true, isLocked: false, lockNote: nil, targetSectionID: "top", route: .today),
            SearchItem(id: "task-day2", kind: .task, title: "시장 신호 읽기", subtitle: "Market", day: "Day 2", systemImage: "circle", isActive: false, isLocked: false, lockNote: nil, targetSectionID: nil, route: .inert),
            SearchItem(id: "task-day3", kind: .task, title: "Mom Test 인터뷰 ×3", subtitle: "Interview", day: "Day 3", systemImage: "circle", isActive: false, isLocked: false, lockNote: nil, targetSectionID: nil, route: .inert),
            SearchItem(id: "task-day4", kind: .task, title: "10× 웨지 찾기", subtitle: "Wedge", day: "Day 4", systemImage: "circle", isActive: false, isLocked: false, lockNote: nil, targetSectionID: nil, route: .inert),
            SearchItem(id: "task-day5", kind: .task, title: "수요 신호 측정", subtitle: "Demand", day: "Day 5", systemImage: "circle", isActive: false, isLocked: false, lockNote: nil, targetSectionID: nil, route: .inert),
            SearchItem(id: "task-day6", kind: .task, title: "Ask 한 줄로 압축", subtitle: "Ask", day: "Day 6", systemImage: "circle", isActive: false, isLocked: false, lockNote: nil, targetSectionID: nil, route: .inert),
            SearchItem(id: "task-day7", kind: .task, title: "Go / No-Go 결정 게이트", subtitle: "Gate", day: "Day 7", systemImage: "circle", isActive: false, isLocked: false, lockNote: nil, targetSectionID: nil, route: .inert),
            SearchItem(id: "task-day8", kind: .task, title: "MVP 코어 4시간 빌드", subtitle: "Build", day: "Day 8", systemImage: "lock", isActive: false, isLocked: true, lockNote: "D7 해제", targetSectionID: nil, route: .inert),
            SearchItem(id: "task-day9", kind: .task, title: "첫 5명 초대 초안", subtitle: "Outreach", day: "Day 9", systemImage: "lock", isActive: false, isLocked: true, lockNote: "D7 해제", targetSectionID: nil, route: .inert),
            SearchItem(id: "task-day10", kind: .task, title: "랜딩 카피 & Above-fold", subtitle: "Landing", day: "Day 10", systemImage: "lock", isActive: false, isLocked: true, lockNote: "D7 해제", targetSectionID: nil, route: .inert),
            SearchItem(id: "task-day15", kind: .task, title: "BIP 채널 첫 포스트", subtitle: "BIP", day: "Day 15", systemImage: "lock", isActive: false, isLocked: true, lockNote: "D14 해제", targetSectionID: nil, route: .inert),
            SearchItem(id: "task-day22", kind: .task, title: "첫 매출 ask · Pricing", subtitle: "Revenue", day: "Day 22", systemImage: "lock", isActive: false, isLocked: true, lockNote: "D22 해제", targetSectionID: nil, route: .inert),
            SearchItem(id: "section-signals", kind: .section, title: "지금까지 시그널", subtitle: "workspace · interviews · BIP", day: nil, systemImage: "waveform.path.ecg", isActive: false, isLocked: false, lockNote: nil, targetSectionID: "signals", route: .today),
            SearchItem(id: "section-mission", kind: .section, title: "오늘의 미션", subtitle: "Mission · 1 of 1", day: nil, systemImage: "flag", isActive: false, isLocked: false, lockNote: nil, targetSectionID: "mission", route: .today),
            SearchItem(id: "section-interview1", kind: .section, title: "인터뷰 1 — 거리", subtitle: "3분 · 직감 OK · 바꿀 수 있음", day: nil, systemImage: "bubble.left", isActive: false, isLocked: false, lockNote: nil, targetSectionID: "interview1", route: .today),
            SearchItem(id: "section-picker", kind: .section, title: "ICP 4지선다", subtitle: "직접 만날 사람 후보", day: nil, systemImage: "scope", isActive: false, isLocked: false, lockNote: nil, targetSectionID: "interview1-options", route: .today),
            SearchItem(id: "section-preview", kind: .section, title: "문서 미리보기", subtitle: "docs/ICP.md draft", day: nil, systemImage: "doc.text", isActive: false, isLocked: false, lockNote: nil, targetSectionID: "icp-preview", route: .today),
            SearchItem(id: "section-final", kind: .section, title: "ICP 한 문장", subtitle: "Day 1 최종 후보 문장", day: nil, systemImage: "target", isActive: false, isLocked: false, lockNote: nil, targetSectionID: "final-icp", route: .today),
            SearchItem(id: "section-candidate", kind: .section, title: "후보 1명", subtitle: "SPEC 입력용 후보 카드", day: nil, systemImage: "person.crop.circle", isActive: false, isLocked: false, lockNote: nil, targetSectionID: "candidate", route: .today),
            SearchItem(id: "section-slot", kind: .section, title: "인터뷰 약속 슬롯", subtitle: "Mon-Wed 중 1건", day: nil, systemImage: "clock", isActive: false, isLocked: false, lockNote: nil, targetSectionID: "slot", route: .today),
            SearchItem(id: "section-message", kind: .section, title: "첫 메시지 초안", subtitle: "Twitter DM 검토", day: nil, systemImage: "paperplane", isActive: false, isLocked: false, lockNote: nil, targetSectionID: "message", route: .today),
            SearchItem(id: "section-gate", kind: .section, title: "Day 1 게이트 조건", subtitle: "완료 전 체크리스트", day: nil, systemImage: "checkmark.seal", isActive: false, isLocked: false, lockNote: nil, targetSectionID: "gate", route: .today),
            SearchItem(id: "section-tutor", kind: .section, title: "tutor 명령 · docH1", subtitle: "튜토리얼 시작", day: nil, systemImage: "sparkles", isActive: false, isLocked: false, lockNote: nil, targetSectionID: "top", route: .today),
        ]
    }

    func rankedSearchItems(query rawQuery: String) -> [SearchItem] {
        let query = rawQuery.trimmingCharacters(in: .whitespacesAndNewlines)
        let ranked = searchItems
            .map { item in (item, searchScore(for: item, query: query)) }
            .filter { $0.1 > 0 }
            .sorted {
                if $0.1 == $1.1 {
                    return (searchItems.firstIndex(of: $0.0) ?? 0) < (searchItems.firstIndex(of: $1.0) ?? 0)
                }
                return $0.1 > $1.1
            }
            .map(\.0)
        return ranked
    }

    private func searchScore(for item: SearchItem, query: String) -> Int {
        guard !query.isEmpty else { return 1 }
        let q = query.lowercased()
        let compactQ = q.replacingOccurrences(of: " ", with: "")
        let title = item.title.lowercased()
        let subtitle = item.subtitle.lowercased()
        let day = (item.day ?? "").lowercased().replacingOccurrences(of: " ", with: "")
        var score = 0
        if title.contains(q) { score += 3 }
        if title.hasPrefix(q) { score += 4 }
        if subtitle.contains(q) { score += 1 }
        if day == compactQ { score += 8 }
        if day.hasPrefix(compactQ) { score += 3 }
        if let number = dayQuickMatchNumber(from: compactQ), day == "day\(number)" { score += 6 }
        return score
    }

    private func dayQuickMatchNumber(from query: String) -> String? {
        let prefixes = ["day", "d"]
        if query.allSatisfy(\.isNumber) { return query }
        for prefix in prefixes where query.hasPrefix(prefix) {
            let suffix = String(query.dropFirst(prefix.count))
            if !suffix.isEmpty, suffix.allSatisfy(\.isNumber) {
                return suffix
            }
        }
        return nil
    }

    func selectedLabel(stepID: Int, in interaction: OpenDesignDayInteractionState, fallback: String = "미선택") -> String {
        guard let selectedID = interaction.selectedChoices[stepID],
              let step = interviewSteps.first(where: { $0.id == stepID }),
              let option = step.options.first(where: { $0.id == selectedID }) else {
            return fallback
        }
        return option.title
    }

    func draft(for interaction: OpenDesignDayInteractionState) -> OpenDesignDayDraft {
        OpenDesignDayDraft(
            distance: selectedLabel(stepID: 1, in: interaction, fallback: "이번 주 바로 연락 가능한 1인 개발자"),
            tool: selectedLabel(stepID: 2, in: interaction),
            stuck: selectedLabel(stepID: 3, in: interaction),
            action: selectedLabel(stepID: 4, in: interaction)
        )
    }
}

typealias OpenDesignTaskItem = OpenDesignDayContent.TaskItem
typealias OpenDesignSearchItem = OpenDesignDayContent.SearchItem

enum OpenDesignSearchSelection {
    static func movedIndex(from selectedIndex: Int, delta: Int, resultCount: Int) -> Int {
        guard resultCount > 0 else { return 0 }
        return (selectedIndex + delta + resultCount) % resultCount
    }
}

enum OpenDesignSearchPresentation {
    static func displayOrdered(_ items: [OpenDesignDayContent.SearchItem]) -> [OpenDesignDayContent.SearchItem] {
        OpenDesignDayContent.SearchItem.Kind.displayOrder.flatMap { kind in
            items.filter { $0.kind == kind }
        }
    }
}

enum OpenDesignSectionAnchor: String, CaseIterable, Hashable {
    case top
    case signals
    case mission
    case interview1
    case interview1Options = "interview1-options"
    case icpPreview = "icp-preview"
    case finalIcp = "final-icp"
    case candidate
    case slot
    case message
    case gate
    case completion
}

struct OpenDesignDayInteractionState: Equatable {
    var missionAccepted = false
    var selectedChoices: [Int: Int] = [:]
    var submittedChoices: [Int: Int] = [:]
    var submittedSteps: Set<Int> = []
    var freeformAnswer = ""
    var handoffIndex = 0
    var selectedSlot = 2
    var completedGateRows: Set<Int> = [1, 2, 4]
    var touchedGateRows: Set<Int> = []
    var dayCompleted = false

    var highestVisibleInterviewStep: Int {
        var highest = 1
        for step in 1...3 where submittedSteps.contains(step) {
            highest = step + 1
        }
        return highest
    }

    var allInterviewsSubmitted: Bool {
        submittedSteps.isSuperset(of: Set(1...4))
    }

    var progressPercent: Int {
        if dayCompleted { return 100 }
        if allInterviewsSubmitted { return 75 }
        if submittedSteps.contains(3) { return 70 }
        if submittedSteps.contains(2) { return 64 }
        if submittedSteps.contains(1) { return 58 }
        return 50
    }

    var progressStepCount: Int {
        if allInterviewsSubmitted { return 4 }
        return 2
    }

    var currentProgressScrollTarget: String {
        if !missionAccepted { return "mission" }
        if !allInterviewsSubmitted { return "interview\(highestVisibleInterviewStep)" }
        if handoffIndex == 0 { return "icp-preview" }
        return handoffScrollTarget ?? "icp-preview"
    }

    func stepperScrollTarget(for index: Int) -> String {
        switch index {
        case 0:
            return "top"
        case 1:
            return "mission"
        case 2:
            return missionAccepted ? "interview\(highestVisibleInterviewStep)" : "mission"
        case 3:
            return allInterviewsSubmitted ? currentProgressScrollTarget : "interview\(highestVisibleInterviewStep)"
        default:
            return "top"
        }
    }

    func isSearchItemAvailable(_ item: OpenDesignDayContent.SearchItem) -> Bool {
        guard item.kind == .section,
              let targetSectionID = item.targetSectionID,
              let anchor = OpenDesignSectionAnchor(rawValue: targetSectionID) else {
            return true
        }

        switch anchor {
        case .top, .signals, .mission:
            return true
        case .interview1, .interview1Options:
            // `day.html` keeps the first interview block mounted behind the
            // mission-accept gate, so its search entries are indexed before it
            // is visible. Later handoff sections are injected only after their
            // preceding state exists.
            return true
        case .icpPreview:
            return allInterviewsSubmitted
        case .finalIcp:
            return allInterviewsSubmitted && handoffIndex >= 1
        case .candidate:
            return allInterviewsSubmitted && handoffIndex >= 2
        case .slot:
            return allInterviewsSubmitted && handoffIndex >= 3
        case .message:
            return allInterviewsSubmitted && handoffIndex >= 4
        case .gate:
            return allInterviewsSubmitted && handoffIndex >= 5
        case .completion:
            return dayCompleted
        }
    }

    var handoffScrollTarget: String? {
        ["", "final-icp", "candidate", "slot", "message", "gate"][safe: handoffIndex]
    }

    mutating func recordSubmittedChoice(stepID: Int, choiceID: Int) {
        _ = submittedSteps.insert(stepID)
        submittedChoices[stepID] = choiceID
        if stepID == 4 {
            if choiceID == 4 {
                completedGateRows.remove(4)
            } else {
                completedGateRows.insert(4)
            }
        }
    }

    func isCurrentSelectionSubmitted(stepID: Int) -> Bool {
        guard let selectedChoice = selectedChoices[stepID] else { return false }
        return submittedChoices[stepID] == selectedChoice
    }

    mutating func toggleGateRow(_ id: Int) {
        touchedGateRows.insert(id)
        if completedGateRows.contains(id) {
            completedGateRows.remove(id)
        } else {
            completedGateRows.insert(id)
        }
    }

    func gateTag(id: Int, completedTag: String, initialPendingTag: String) -> String {
        if completedGateRows.contains(id) {
            return touchedGateRows.contains(id) ? "완료" : completedTag
        }
        return touchedGateRows.contains(id) ? "대기" : initialPendingTag
    }
}

struct OpenDesignDayDraft: Equatable {
    let distance: String
    let tool: String
    let stuck: String
    let action: String

    var isAntiSignal: Bool {
        action.contains("아무 행동")
    }

    var recommendation: String {
        if isAntiSignal {
            return "현재 후보는 Anti-ICP 경계에 걸립니다. Day 3 인터뷰 대상에 넣기 전 실제 행동 증거를 한 번 더 확인한다."
        }
        return "Day 3 Mom Test 인터뷰 첫 후보로 올리고, transcript와 업무 일지를 docs/ICP.md의 evidence 섹션에 연결한다."
    }

    var markdown: String {
        """
        # Ideal Customer Profile

        > Write target: docs/ICP.md
        > Source: Day 1 interview flow

        ## Our ICP
        이번 주 바로 연락할 수 있는 "\(distance)" 중, "\(tool)"를 매일 쓰고 "\(stuck)"에서 멈춘 macOS 1인 개발자.

        ## Evidence from Day 1
        - 거리: \(distance)
        - 도구: \(tool)
        - 막힌 단계: \(stuck)
        - 지난 7일 행동: \(action)
        - 필수 입력: 프로젝트 path, 업무 일지, 인터뷰 transcript, BIP 기록

        ## Anti-ICP guardrail
        "언젠가", "좋네요"만 말하고 지난 7일 실제 행동이 없으면 Day 3 인터뷰 대상에서 제외한다.

        ## Next action
        \(recommendation)
        """
    }

    var finalIcpStatement: String {
        "\(distance) 중, \(tool)를 매일 쓰고 \(stuck)에서 멈췄으며 지난 7일 행동이 \(action)으로 확인된 macOS 1인 개발자."
    }

    var antiIcpBody: String {
        if isAntiSignal {
            return "지난 7일 행동 없음 신호가 있어 Day 3 인터뷰 전에 실제 사건을 한 번 더 확인하세요. 박주영이 \"언젠가 해볼게요\" 또는 \"좋은 아이디어네요\"로 답하면 후보 교체. Mom Test 기준 그대로."
        }
        return "좋은 신호는 지난주에 같은 문제로 시간을 쓴 사건입니다. 박주영이 \"언젠가 해볼게요\" 또는 \"좋은 아이디어네요\"로 답하면 후보 교체. Mom Test 기준 그대로."
    }
}

enum OpenDesignDayColor {
    static let bg = Color(red: 0.0801, green: 0.0874, blue: 0.0928)
    static let bgDeep = Color(red: 0.0379, green: 0.0446, blue: 0.0497)
    static let bgDarker = Color(red: 0.0252, green: 0.0291, blue: 0.0322)
    static let surface = Color(red: 0.0544, green: 0.0614, blue: 0.0666)
    static let surface2 = Color(red: 0.0714, green: 0.0786, blue: 0.0839)
    static let elevated = Color(red: 0.1053, green: 0.1147, blue: 0.1217)
    static let hover = Color(red: 0.1407, green: 0.1524, blue: 0.1611)
    static let selected = Color(red: 0.1756, green: 0.1918, blue: 0.2039)
    static let border = Color(red: 0.1501, green: 0.1619, blue: 0.1708)
    static let borderSoft = Color(red: 0.1128, green: 0.1242, blue: 0.1327)
    static let borderStrong = Color(red: 0.2421, green: 0.2634, blue: 0.2793)
    static let fg = Color(red: 0.9410, green: 0.9490, blue: 0.9550)
    static let fgSecondary = Color(red: 0.7328, green: 0.7455, blue: 0.7551)
    static let muted = Color(red: 0.4865, green: 0.5055, blue: 0.5198)
    static let mutedDeep = Color(red: 0.3263, green: 0.3486, blue: 0.3652)
    static let accent = Color(red: 0.2165, green: 0.8352, blue: 0.6244)
    static let accentStrong = Color(red: 0.0000, green: 0.7754, blue: 0.5051)
    static let amber = Color(red: 0.9364, green: 0.6955, blue: 0.2742)
    static let rose = Color(red: 0.9751, green: 0.4673, blue: 0.4400)
    static let sky = Color(red: 0.3475, green: 0.7738, blue: 0.9615)
    static let diffAdd = Color(red: 0.2284, green: 0.7286, blue: 0.4173)
    static let diffDel = Color(red: 0.9473, green: 0.4424, blue: 0.4166)

    static var accentDim: Color { accent.opacity(0.14) }
    static var accentLine: Color { accent.opacity(0.40) }
    static var amberDim: Color { amber.opacity(0.14) }
    static var amberLine: Color { amber.opacity(0.36) }
    static var roseDim: Color { rose.opacity(0.14) }
}

enum OpenDesignAccessibilityMetrics {
    static func borderLineWidth(isIncreasedContrast: Bool) -> CGFloat {
        isIncreasedContrast ? 1.5 : 1
    }
}

struct OpenDesignCompletionBurstParticle: Identifiable, Equatable {
    static let originYRatio: CGFloat = 0.72
    static let duration: TimeInterval = 1.50
    static let reference: [OpenDesignCompletionBurstParticle] = makeReferenceParticles()

    let id: Int
    let x: CGFloat
    let y: CGFloat
    let width: CGFloat
    let height: CGFloat
    let startRotation: Double
    let endRotation: Double
    let delay: TimeInterval
    let paletteIndex: Int

    var color: Color {
        switch paletteIndex % 5 {
        case 0: return OpenDesignDayColor.accent
        case 1: return OpenDesignDayColor.accentStrong
        case 2: return OpenDesignDayColor.amber
        case 3: return OpenDesignDayColor.sky
        default: return OpenDesignDayColor.fg
        }
    }

    private static func makeReferenceParticles() -> [OpenDesignCompletionBurstParticle] {
        (0..<100).map { index in
            let cluster = index % 5
            let lane = index / 5
            let spread: Double = [26, 60, 100, 120, 120][cluster]
            let velocity: Double = [55, 45, 36, 25, 45][cluster]
            let scalar: CGFloat = [1.0, 1.0, 0.8, 1.2, 1.0][cluster]
            let normalizedLane = Double(lane % 20) / 19.0
            let jitter = Double((index * 37) % 17) / 16.0 - 0.5
            let angle = (-90 + (normalizedLane - 0.5) * spread + jitter * 8) * .pi / 180
            let distance = velocity * (2.1 + Double((index * 11) % 9) * 0.12)
            let x = cos(angle) * distance
            let lift = sin(angle) * distance
            let fall = Double((index * 7) % 11) * 5.5

            return OpenDesignCompletionBurstParticle(
                id: index,
                x: CGFloat(x),
                y: CGFloat(lift + fall),
                width: (5 + CGFloat((index * 3) % 7)) * scalar,
                height: (8 + CGFloat((index * 5) % 10)) * scalar,
                startRotation: Double((index * 29) % 180),
                endRotation: Double((index * 29) % 180) + 220 + Double((index * 13) % 160),
                delay: Double(index % 12) * 0.006,
                paletteIndex: index + cluster
            )
        }
    }
}

struct OpenDesignDayLayoutMetrics: Equatable {
    let railWidth: CGFloat
    let taskSidebarWidth: CGFloat
    let metaPanelWidth: CGFloat
    let mainHorizontalPadding: CGFloat
    let showsTaskSidebar: Bool
    let showsMetaPanel: Bool

    init(width: CGFloat) {
        if width <= 860 {
            railWidth = 48
            taskSidebarWidth = 0
            metaPanelWidth = 0
            mainHorizontalPadding = 24
            showsTaskSidebar = false
            showsMetaPanel = false
        } else if width <= 1100 {
            railWidth = 48
            taskSidebarWidth = 200
            metaPanelWidth = 0
            mainHorizontalPadding = 24
            showsTaskSidebar = true
            showsMetaPanel = false
        } else if width <= 1280 {
            railWidth = 48
            taskSidebarWidth = 220
            metaPanelWidth = 252
            mainHorizontalPadding = 24
            showsTaskSidebar = true
            showsMetaPanel = true
        } else {
            railWidth = 52
            taskSidebarWidth = 240
            metaPanelWidth = 280
            mainHorizontalPadding = 28
            showsTaskSidebar = true
            showsMetaPanel = true
        }
    }

    var openDesignGridColumnCount: Int {
        showsMetaPanel ? 4 : 2
    }
}

private struct OpenDesignInteractiveButtonStyle: ButtonStyle {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var isDisabled = false
    var pressedScale: CGFloat = 0.985
    var pressedOffset: CGFloat = 1

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed && !isDisabled ? pressedScale : 1)
            .offset(y: configuration.isPressed && !isDisabled ? pressedOffset : 0)
            .animation(.easeOut(duration: reduceMotion ? 0 : 0.10), value: configuration.isPressed)
    }
}

private struct OpenDesignHoverRowModifier: ViewModifier {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.colorSchemeContrast) private var contrast

    let isHovered: Bool
    let isActive: Bool
    let isDisabled: Bool
    let cornerRadius: CGFloat
    let fill: Color
    let hoverFill: Color
    let activeFill: Color
    let border: Color
    let hoverBorder: Color
    let activeBorder: Color

    func body(content: Content) -> some View {
        let canHover = isHovered && !isDisabled
        let resolvedFill = isActive ? activeFill : canHover ? hoverFill : fill
        let baseBorder = isActive ? activeBorder : canHover ? hoverBorder : border
        let usesIncreasedContrast = contrast == .increased
        let resolvedBorder = usesIncreasedContrast && (isActive || canHover) ? OpenDesignDayColor.borderStrong : baseBorder
        let lineWidth = OpenDesignAccessibilityMetrics.borderLineWidth(isIncreasedContrast: usesIncreasedContrast)

        content
            .background(
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .fill(resolvedFill)
            )
            .overlay(
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .stroke(resolvedBorder, lineWidth: lineWidth)
            )
            .contentShape(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
            .animation(.easeOut(duration: reduceMotion ? 0 : 0.12), value: isHovered)
            .animation(.easeOut(duration: reduceMotion ? 0 : 0.12), value: isActive)
    }
}

private struct OpenDesignStagedRevealModifier: ViewModifier {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    let isVisible: Bool
    let offset: CGFloat

    func body(content: Content) -> some View {
        content
            .opacity(isVisible ? 1 : 0)
            .offset(y: isVisible || reduceMotion ? 0 : offset)
            .allowsHitTesting(isVisible)
            .accessibilityHidden(!isVisible)
            .animation(.easeOut(duration: reduceMotion ? 0 : 0.18), value: isVisible)
    }
}

private struct OpenDesignCompletionBurstView: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    let trigger: Int
    @State private var isExpanded = false

    var body: some View {
        GeometryReader { geometry in
            ZStack {
                ForEach(OpenDesignCompletionBurstParticle.reference) { particle in
                    RoundedRectangle(cornerRadius: 1.6, style: .continuous)
                        .fill(particle.color)
                        .frame(width: particle.width, height: particle.height)
                        .rotationEffect(.degrees(isExpanded ? particle.endRotation : particle.startRotation))
                        .offset(
                            x: isExpanded ? particle.x : 0,
                            y: isExpanded ? particle.y : 0
                        )
                        .opacity(isExpanded ? 0 : 1)
                        .animation(
                            .easeOut(duration: OpenDesignCompletionBurstParticle.duration)
                                .delay(particle.delay),
                            value: isExpanded
                        )
                }
            }
            .position(
                x: geometry.size.width * 0.5,
                y: geometry.size.height * OpenDesignCompletionBurstParticle.originYRatio
            )
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
        .accessibilityIdentifier("opendesign.day.confetti")
        .onAppear {
            guard !reduceMotion else { return }
            isExpanded = false
            DispatchQueue.main.async {
                isExpanded = true
            }
        }
        .onChange(of: trigger) { _, _ in
            guard !reduceMotion else { return }
            isExpanded = false
            DispatchQueue.main.async {
                isExpanded = true
            }
        }
    }
}

private extension View {
    func openDesignHoverRow(
        isHovered: Bool,
        isActive: Bool = false,
        isDisabled: Bool = false,
        cornerRadius: CGFloat = 8,
        fill: Color = .clear,
        hoverFill: Color = OpenDesignDayColor.hover,
        activeFill: Color = OpenDesignDayColor.selected,
        border: Color = .clear,
        hoverBorder: Color = OpenDesignDayColor.borderSoft,
        activeBorder: Color = OpenDesignDayColor.borderSoft
    ) -> some View {
        modifier(
            OpenDesignHoverRowModifier(
                isHovered: isHovered,
                isActive: isActive,
                isDisabled: isDisabled,
                cornerRadius: cornerRadius,
                fill: fill,
                hoverFill: hoverFill,
                activeFill: activeFill,
                border: border,
                hoverBorder: hoverBorder,
                activeBorder: activeBorder
            )
        )
    }

    func openDesignStagedReveal(isVisible: Bool, offset: CGFloat = 8) -> some View {
        modifier(OpenDesignStagedRevealModifier(isVisible: isVisible, offset: offset))
    }
}

struct OpenDesignDayPageView: View {
    let content: OpenDesignDayContent
    let openSettings: () -> Void
    let submitStructuredPromptChoice: (String) -> Void
    let completeDay: () -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var interaction = OpenDesignDayInteractionState()
    @State private var selectedReferencePage: OpenDesignReferencePageKind?
    @State private var isSearchPresented = false
    @State private var searchQuery = ""
    @State private var selectedSearchIndex = 0
    @State private var pendingScrollTarget: String?
    @State private var searchPulseTarget: String?
    @State private var completionBurstID = 0
    @State private var keyboardMonitor: Any?

    init(
        content: OpenDesignDayContent = .day1,
        openSettings: @escaping () -> Void,
        submitStructuredPromptChoice: @escaping (String) -> Void = { _ in },
        completeDay: @escaping () -> Void = {}
    ) {
        self.content = content
        self.openSettings = openSettings
        self.submitStructuredPromptChoice = submitStructuredPromptChoice
        self.completeDay = completeDay
    }

    private var searchResults: [OpenDesignDayContent.SearchItem] {
        OpenDesignSearchPresentation.displayOrdered(
            content.rankedSearchItems(query: searchQuery)
                .filter(interaction.isSearchItemAvailable)
        )
    }

    var body: some View {
        GeometryReader { geometry in
            let layout = OpenDesignDayLayoutMetrics(width: geometry.size.width)

            ZStack {
                OpenDesignDayShell(
                    content: content,
                    interaction: $interaction,
                    selectedReferencePage: selectedReferencePage,
                    pendingScrollTarget: $pendingScrollTarget,
                    searchPulseTarget: $searchPulseTarget,
                    layout: layout,
                    openSearch: openSearch,
                    toggleSearch: toggleSearch,
                    activateRailItem: activateRailItem,
                    submitStep: submitStep,
                    acceptMission: acceptMission,
                    advanceHandoff: advanceHandoff,
                    completeDayAction: completeDayAction,
                    advanceToNextDay: completeDay,
                    shareSummary: dayShareSummary,
                    focusContextOverview: focusContextOverview,
                    focusCurrentProgress: focusCurrentProgress
                )

                Color.clear
                    .frame(width: 1, height: 1)
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel("OpenDesign Day Shell")
                    .accessibilityIdentifier("opendesign.day.shell")
                    .allowsHitTesting(false)

                if isSearchPresented {
                    OpenDesignSearchPaletteView(
                        query: $searchQuery,
                        selectedIndex: $selectedSearchIndex,
                        items: searchResults,
                        activate: activateSearchItem,
                        close: closeSearch
                    )
                    .transition(reduceMotion ? .opacity : .scale(scale: 0.98).combined(with: .opacity))
                    .zIndex(20)
                }

                if completionBurstID > 0 {
                    OpenDesignCompletionBurstView(trigger: completionBurstID)
                        .id(completionBurstID)
                        .transition(.opacity)
                        .zIndex(15)
                }
            }
            .environment(\.colorScheme, .dark)
            .onAppear(perform: installKeyboardMonitor)
            .onDisappear(perform: removeKeyboardMonitor)
            .onReceive(NotificationCenter.default.publisher(for: .agenticOpenDesignSearchRequested)) { _ in
                toggleSearch()
            }
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("opendesign.day.shell")
        }
    }

    private func installKeyboardMonitor() {
        guard keyboardMonitor == nil else { return }
        keyboardMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { event in
            handleKeyboardEvent(event)
        }
    }

    private func removeKeyboardMonitor() {
        if let keyboardMonitor {
            NSEvent.removeMonitor(keyboardMonitor)
        }
        keyboardMonitor = nil
    }

    private func handleKeyboardEvent(_ event: NSEvent) -> NSEvent? {
        let key = event.charactersIgnoringModifiers ?? ""
        let lowerKey = key.lowercased()
        let command = event.modifierFlags.contains(.command)
        if command && (lowerKey == "k" || event.keyCode == 40) {
            toggleSearch()
            return nil
        }

        if isSearchPresented {
            switch event.keyCode {
            case 53:
                closeSearch()
                return nil
            case 125:
                moveSearchSelection(delta: 1)
                return nil
            case 126:
                moveSearchSelection(delta: -1)
                return nil
            case 115:
                selectFirstSearchItem()
                return nil
            case 119:
                selectLastSearchItem()
                return nil
            case 36, 76:
                activateSelectedSearchItem()
                return nil
            default:
                return event
            }
        }

        if (lowerKey == "/" || event.keyCode == 44), !firstResponderIsEditableText {
            openSearch()
            return nil
        }
        if (event.keyCode == 36 || event.keyCode == 76), !firstResponderIsEditableText {
            submitActiveStep()
            return nil
        }
        return event
    }

    private var firstResponderIsEditableText: Bool {
        guard let responder = NSApp.keyWindow?.firstResponder else { return false }
        if responder is NSTextView { return true }
        if responder is NSTextField { return true }
        return false
    }

    private func openSearch() {
        searchQuery = ""
        selectedSearchIndex = 0
        withAnimation(.easeOut(duration: reduceMotion ? 0 : 0.12)) {
            isSearchPresented = true
        }
    }

    private func closeSearch() {
        withAnimation(.easeOut(duration: reduceMotion ? 0 : 0.12)) {
            isSearchPresented = false
        }
        clearSearchFocus()
    }

    private func toggleSearch() {
        if isSearchPresented {
            closeSearch()
        } else {
            openSearch()
        }
    }

    private func moveSearchSelection(delta: Int) {
        guard !searchResults.isEmpty else { return }
        selectedSearchIndex = OpenDesignSearchSelection.movedIndex(
            from: selectedSearchIndex,
            delta: delta,
            resultCount: searchResults.count
        )
    }

    private func selectFirstSearchItem() {
        guard !searchResults.isEmpty else { return }
        selectedSearchIndex = 0
    }

    private func selectLastSearchItem() {
        guard !searchResults.isEmpty else { return }
        selectedSearchIndex = searchResults.count - 1
    }

    private func activateSelectedSearchItem() {
        guard searchResults.indices.contains(selectedSearchIndex) else { return }
        activateSearchItem(searchResults[selectedSearchIndex])
    }

    private func activateSearchItem(_ item: OpenDesignDayContent.SearchItem) {
        guard !item.isLocked else { return }
        if let referencePage = OpenDesignReferencePageKind(searchItemID: item.id) {
            selectedReferencePage = referencePage
            closeSearch()
            return
        }

        switch item.route {
        case .settings:
            closeSearch()
            openSettings()
        case .search:
            openSearch()
        case .today, .inert:
            closeSearch()
            selectedReferencePage = nil
            let target = item.targetSectionID ?? "top"
            pendingScrollTarget = target
            pulseSearchTarget(target)
        }
    }

    private func clearSearchFocus() {
        for delay in [0, 0.03, 0.12] {
            DispatchQueue.main.asyncAfter(deadline: .now() + delay) {
                guard let window = NSApp.keyWindow,
                      (window.firstResponder is NSTextView || window.firstResponder is NSTextField) else {
                    return
                }
                window.makeFirstResponder(nil)
            }
        }
    }

    private func pulseSearchTarget(_ target: String) {
        searchPulseTarget = target
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.4) {
            if searchPulseTarget == target {
                searchPulseTarget = nil
            }
        }
    }

    private func activateRailItem(_ item: OpenDesignDayContent.RailItem) {
        if item.id == "today" {
            selectedReferencePage = nil
            pendingScrollTarget = "top"
            return
        }

        if let referencePage = OpenDesignReferencePageKind(railItemID: item.id) {
            selectedReferencePage = referencePage
            return
        }

        switch item.route {
        case .settings:
            openSettings()
        case .search:
            openSearch()
        case .today:
            pendingScrollTarget = "top"
        case .inert:
            break
        }
    }

    private func acceptMission() {
        guard !interaction.missionAccepted else { return }
        withAnimation(.spring(response: reduceMotion ? 0 : 0.26, dampingFraction: 0.90)) {
            interaction.missionAccepted = true
        }
        pendingScrollTarget = "interview1"
    }

    private func submitStep(_ step: OpenDesignDayContent.InterviewStep) {
        guard let selectedChoiceID = interaction.selectedChoices[step.id] else { return }
        guard interaction.submittedChoices[step.id] != selectedChoiceID else { return }
        withAnimation(.spring(response: reduceMotion ? 0 : 0.28, dampingFraction: 0.90)) {
            interaction.recordSubmittedChoice(stepID: step.id, choiceID: selectedChoiceID)
        }
        if let selectedTitle = selectedTitle(for: step.id) {
            submitStructuredPromptChoice(selectedTitle)
        }
        pendingScrollTarget = step.id < 4 ? "interview\(step.id + 1)" : "icp-preview"
    }

    private func submitActiveStep() {
        if !interaction.missionAccepted {
            acceptMission()
            return
        }
        let visibleSteps = content.interviewSteps.filter { $0.id <= interaction.highestVisibleInterviewStep }
        if let step = visibleSteps.reversed().first(where: { step in
            guard let selectedChoice = interaction.selectedChoices[step.id] else { return false }
            return interaction.submittedChoices[step.id] != selectedChoice
        }) {
            submitStep(step)
            return
        }
        if interaction.allInterviewsSubmitted {
            if interaction.handoffIndex < 5 {
                advanceHandoff()
            } else if !interaction.dayCompleted {
                completeDayAction()
            } else {
                completeDay()
            }
        }
    }

    private func focusCurrentProgress() {
        pendingScrollTarget = interaction.currentProgressScrollTarget
    }

    private func focusContextOverview() {
        pendingScrollTarget = "top"
    }

    private func advanceHandoff() {
        guard interaction.allInterviewsSubmitted, interaction.handoffIndex < 5 else { return }
        withAnimation(.spring(response: reduceMotion ? 0 : 0.28, dampingFraction: 0.88)) {
            interaction.handoffIndex += 1
        }
        pendingScrollTarget = interaction.handoffScrollTarget
    }

    private func completeDayAction() {
        let shouldRunBurst = !interaction.dayCompleted && !reduceMotion
        withAnimation(.spring(response: reduceMotion ? 0 : 0.30, dampingFraction: 0.88)) {
            interaction.dayCompleted = true
            interaction.handoffIndex = 5
        }
        if shouldRunBurst {
            runCompletionBurst()
        }
        pendingScrollTarget = "completion"
    }

    private func runCompletionBurst() {
        completionBurstID += 1
        let currentID = completionBurstID
        DispatchQueue.main.asyncAfter(deadline: .now() + OpenDesignCompletionBurstParticle.duration + 0.25) {
            if completionBurstID == currentID {
                withAnimation(.easeOut(duration: 0.16)) {
                    completionBurstID = 0
                }
            }
        }
    }

    private var dayShareSummary: String {
        let progress: String
        if interaction.dayCompleted {
            progress = "Day 1 완료"
        } else if interaction.allInterviewsSubmitted {
            progress = "STEP 4 / 4 · docs/ICP.md 초안"
        } else {
            progress = "STEP 3 / 4 · 인터뷰 \(interaction.highestVisibleInterviewStep) / 4"
        }

        let choiceLines = content.interviewSteps.map { step -> String in
            let value = selectedTitle(for: step.id) ?? "미선택"
            return "- \(step.title): \(value)"
        }.joined(separator: "\n")

        return """
        Agentic30 Day 1 · Foundation / ICP 좁히기
        먼저 도울 사람을 정해요
        진행: \(progress) · \(interaction.progressStepCount)/4 · \(interaction.progressPercent)%

        \(choiceLines)
        """
    }

    private func selectedTitle(for stepID: Int) -> String? {
        guard let selectedID = interaction.selectedChoices[stepID],
              let step = content.interviewSteps.first(where: { $0.id == stepID }),
              let option = step.options.first(where: { $0.id == selectedID }) else {
            return nil
        }
        return option.title
    }
}

struct OpenDesignDayShell: View {
    let content: OpenDesignDayContent
    @Binding var interaction: OpenDesignDayInteractionState
    let selectedReferencePage: OpenDesignReferencePageKind?
    @Binding var pendingScrollTarget: String?
    @Binding var searchPulseTarget: String?
    let layout: OpenDesignDayLayoutMetrics
    let openSearch: () -> Void
    let toggleSearch: () -> Void
    let activateRailItem: (OpenDesignDayContent.RailItem) -> Void
    let submitStep: (OpenDesignDayContent.InterviewStep) -> Void
    let acceptMission: () -> Void
    let advanceHandoff: () -> Void
    let completeDayAction: () -> Void
    let advanceToNextDay: () -> Void
    let shareSummary: String
    let focusContextOverview: () -> Void
    let focusCurrentProgress: () -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        VStack(spacing: 0) {
            if let selectedReferencePage {
                OpenDesignReferenceTitlebar(
                    page: OpenDesignReferenceCatalog.page(selectedReferencePage),
                    openSearch: toggleSearch
                )
            } else {
                OpenDesignDayTitlebar(
                    openSearch: toggleSearch,
                    shareSummary: shareSummary,
                    focusCurrentProgress: focusCurrentProgress
                )
            }

            HStack(spacing: 0) {
                ZStack {
                    OpenDesignRailView(
                        content: content,
                        railWidth: layout.railWidth,
                        selectedReferencePage: selectedReferencePage,
                        activate: activateRailItem
                    )
                }
                .frame(width: layout.railWidth)
                .frame(maxHeight: .infinity)
                .background(OpenDesignDayColor.bg)
                .zIndex(20)
                .accessibilityElement(children: .contain)
                .accessibilityIdentifier("opendesign.day.rail")

                if let selectedReferencePage {
                    OpenDesignReferenceShell(
                        kind: selectedReferencePage,
                        layout: layout,
                        openSearch: openSearch
                    )
                    .transition(reduceMotion ? .opacity : .opacity.combined(with: .scale(scale: 0.995)))
                } else {
                    if layout.showsTaskSidebar {
                        ZStack {
                            OpenDesignTaskSidebarView(content: content, openSearch: openSearch)
                            Color.clear
                                .accessibilityElement(children: .ignore)
                                .accessibilityLabel("OpenDesign Day Tasks")
                                .accessibilityIdentifier("opendesign.day.tasks")
                                .allowsHitTesting(false)
                        }
                        .frame(width: layout.taskSidebarWidth)
                        .frame(maxHeight: .infinity)
                        .background(OpenDesignDayColor.bg)
                        .transition(reduceMotion ? .opacity : .move(edge: .leading).combined(with: .opacity))
                    }

                    OpenDesignDayMainView(
                        content: content,
                        interaction: $interaction,
                        pendingScrollTarget: $pendingScrollTarget,
                        searchPulseTarget: $searchPulseTarget,
                        submitStep: submitStep,
                        acceptMission: acceptMission,
                        advanceHandoff: advanceHandoff,
                        completeDayAction: completeDayAction,
                        advanceToNextDay: advanceToNextDay,
                        focusContextOverview: focusContextOverview,
                        focusCurrentProgress: focusCurrentProgress,
                        layout: layout
                    )
                    .frame(maxWidth: .infinity, maxHeight: .infinity)

                    if layout.showsMetaPanel {
                        ZStack {
                            OpenDesignMetaPanelView(content: content, interaction: $interaction)
                            Color.clear
                                .accessibilityElement(children: .ignore)
                                .accessibilityLabel("OpenDesign Day Meta")
                                .accessibilityIdentifier("opendesign.day.meta")
                                .allowsHitTesting(false)
                        }
                        .frame(width: layout.metaPanelWidth)
                        .frame(maxHeight: .infinity)
                        .background(OpenDesignDayColor.bg)
                        .transition(reduceMotion ? .opacity : .move(edge: .trailing).combined(with: .opacity))
                    }
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .background(OpenDesignDayColor.bg)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("opendesign.day.shell")
    }
}

private struct OpenDesignDayTitlebar: View {
    let openSearch: () -> Void
    let shareSummary: String
    let focusCurrentProgress: () -> Void

    @State private var didCopyShare = false

    var body: some View {
        ZStack {
            HStack(spacing: 8) {
                Spacer(minLength: 82)
                Text("Day 1 · Foundation")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(OpenDesignDayColor.fg)
                Text("/")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(OpenDesignDayColor.mutedDeep)
                Text("ICP 좁히기")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(OpenDesignDayColor.fgSecondary)
                Spacer(minLength: 0)
            }

            HStack(spacing: 4) {
                Spacer()
                OpenDesignToolbarButton(
                    systemImage: "magnifyingglass",
                    label: "검색 · ⌘ K",
                    keyboardKey: "k",
                    accessibilityIdentifier: "opendesign.day.search",
                    action: openSearch
                )
                OpenDesignToolbarButton(
                    systemImage: "square.and.arrow.up",
                    label: didCopyShare ? "공유 복사됨 ✓" : "공유 · ⌘ ⇧ S",
                    keyboardKey: "s",
                    keyboardModifiers: [.command, .shift],
                    accessibilityIdentifier: "opendesign.day.share",
                    action: copyShareSummary
                )
                OpenDesignToolbarButton(systemImage: "sidebar.right", label: "현재 진행 위치", isOn: true, action: focusCurrentProgress)
            }
            .padding(.trailing, 12)
        }
        .frame(height: 36)
        .background(OpenDesignDayColor.bg)
        .overlay(Rectangle().fill(OpenDesignDayColor.borderSoft).frame(height: 1), alignment: .bottom)
    }

    private func copyShareSummary() {
        copyToPasteboard(shareSummary)
        didCopyShare = true
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.4) {
            didCopyShare = false
        }
    }
}

private struct OpenDesignToolbarButton: View {
    let systemImage: String
    let label: String
    var isOn = false
    var keyboardKey: KeyEquivalent?
    var keyboardModifiers: EventModifiers = .command
    var accessibilityIdentifier: String? = nil
    let action: () -> Void

    @State private var isHovered = false

    var body: some View {
        Group {
            if let keyboardKey {
                baseButton.keyboardShortcut(keyboardKey, modifiers: keyboardModifiers)
            } else {
                baseButton
            }
        }
        .help(label)
        .accessibilityLabel(label)
    }

    private var baseButton: some View {
        Button(action: action) {
            Image(systemName: systemImage)
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(isOn || isHovered ? OpenDesignDayColor.fg : OpenDesignDayColor.muted)
                .frame(width: 26, height: 24)
                .background(
                    RoundedRectangle(cornerRadius: 6, style: .continuous)
                        .fill(isOn || isHovered ? OpenDesignDayColor.hover : Color.clear)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 6, style: .continuous)
                        .stroke(isOn || isHovered ? OpenDesignDayColor.borderSoft : Color.clear, lineWidth: 1)
                )
        }
        .buttonStyle(OpenDesignInteractiveButtonStyle())
        .onHover { isHovered = $0 }
        .accessibilityValue(isOn ? "active" : "inactive")
        .accessibilityIdentifier(accessibilityIdentifier ?? label)
    }
}

private struct OpenDesignRailView: View {
    let content: OpenDesignDayContent
    let railWidth: CGFloat
    let selectedReferencePage: OpenDesignReferencePageKind?
    let activate: (OpenDesignDayContent.RailItem) -> Void

    var body: some View {
        VStack(spacing: 2) {
            ForEach(content.railItems) { item in
                OpenDesignRailButton(
                    item: item,
                    railWidth: railWidth,
                    isActive: selectedReferencePage.map { item.id == $0.railItemID } ?? (item.id == "today")
                ) {
                    activate(item)
                }
            }

            Spacer(minLength: 0)

            Text("Z")
                .font(.system(size: 11, weight: .semibold, design: .monospaced))
                .foregroundStyle(OpenDesignDayColor.accent)
                .frame(width: 30, height: 30)
                .background(Circle().fill(OpenDesignDayColor.accentDim))
                .overlay(Circle().stroke(OpenDesignDayColor.accentLine, lineWidth: 1))
                .help("zettalyst")
        }
        .padding(.vertical, 10)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(OpenDesignDayColor.bg)
        .overlay(Rectangle().fill(OpenDesignDayColor.borderSoft).frame(width: 1), alignment: .trailing)
        .accessibilityElement(children: .contain)
    }
}

private struct OpenDesignRailButton: View {
    let item: OpenDesignDayContent.RailItem
    let railWidth: CGFloat
    let isActive: Bool
    let action: () -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var isHovered = false

    private var railGutter: CGFloat {
        max(0, (railWidth - 36) / 2)
    }

    var body: some View {
        ZStack(alignment: .leading) {
            Button(action: action) {
                ZStack(alignment: .topTrailing) {
                    Image(systemName: item.systemImage)
                        .font(.system(size: 15, weight: .medium))
                        .foregroundStyle(isActive || isHovered ? OpenDesignDayColor.fg : OpenDesignDayColor.muted)
                        .frame(width: 36, height: 36)
                        .openDesignHoverRow(
                            isHovered: isHovered,
                            isActive: isActive,
                            cornerRadius: 8,
                            activeFill: OpenDesignDayColor.selected,
                            hoverBorder: Color.clear,
                            activeBorder: Color.clear
                        )
                        .overlay(alignment: .leading) {
                            if isActive {
                                RoundedRectangle(cornerRadius: 2, style: .continuous)
                                    .fill(OpenDesignDayColor.accent)
                                    .frame(width: 2, height: 20)
                                    .offset(x: -railGutter)
                            }
                        }

                    if item.hasNewDot {
                        Circle()
                            .fill(OpenDesignDayColor.accent)
                            .frame(width: 6, height: 6)
                            .overlay(Circle().stroke(OpenDesignDayColor.bg, lineWidth: 2))
                            .offset(x: -4, y: 5)
                    }
                }
            }
            .buttonStyle(OpenDesignInteractiveButtonStyle())
            .onHover { isHovered = $0 }
            .help(item.title)
            .accessibilityLabel(item.title)
            .accessibilityIdentifier("opendesign.day.rail.item.\(item.id)")
            .accessibilityValue(isActive ? "active" : "inactive")

            if isHovered {
                OpenDesignRailTooltip(title: item.title, id: item.id)
                    .offset(x: 44)
                    .transition(.opacity)
                    .zIndex(10)
            }
        }
        .frame(width: 36, height: 36, alignment: .leading)
        .zIndex(isHovered ? 10 : 0)
        .animation(.easeOut(duration: reduceMotion ? 0 : 0.08), value: isHovered)
    }
}

private struct OpenDesignRailTooltip: View {
    let title: String
    let id: String

    var body: some View {
        Text(title)
            .font(.system(size: 11, weight: .medium))
            .foregroundStyle(OpenDesignDayColor.fg)
            .lineLimit(1)
            .fixedSize(horizontal: true, vertical: false)
            .padding(.horizontal, 8)
            .frame(height: 24)
            .background(
                RoundedRectangle(cornerRadius: 6, style: .continuous)
                    .fill(OpenDesignDayColor.elevated)
                    .overlay(
                        RoundedRectangle(cornerRadius: 6, style: .continuous)
                            .stroke(OpenDesignDayColor.border, lineWidth: 1)
                    )
            )
            .allowsHitTesting(false)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(title)
            .accessibilityIdentifier("opendesign.day.rail.tooltip.\(id)")
    }
}

private struct OpenDesignTaskSidebarView: View {
    let content: OpenDesignDayContent
    let openSearch: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                HStack(spacing: 6) {
                    Text("30일 챌린지")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(OpenDesignDayColor.fg)
                    Text("1 / 30")
                        .font(.system(size: 10, weight: .medium, design: .monospaced))
                        .foregroundStyle(OpenDesignDayColor.muted)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 1)
                        .background(Capsule().fill(OpenDesignDayColor.surface))
                }
                Spacer(minLength: 0)
            }
            .padding(.top, 10)
            .padding(.horizontal, 12)
            .padding(.bottom, 8)

            OpenDesignTaskSearchButton(openSearch: openSearch)
            .padding(.horizontal, 8)
            .padding(.bottom, 6)
            .accessibilityIdentifier("opendesign.day.tasks.search")

            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0) {
                    ForEach(content.taskGroups) { group in
                        HStack {
                            Text(group.title)
                            Spacer(minLength: 6)
                            Text(group.meta)
                        }
                        .font(.system(size: 10, weight: .medium, design: .monospaced))
                        .textCase(.uppercase)
                        .foregroundStyle(OpenDesignDayColor.mutedDeep)
                        .padding(.top, 14)
                        .padding(.horizontal, 8)
                        .padding(.bottom, 6)

                        ForEach(group.tasks) { task in
                            OpenDesignTaskRow(task: task)
                        }
                    }
                }
                .padding(.horizontal, 6)
                .padding(.bottom, 12)
            }
        }
        .background(OpenDesignDayColor.bg)
        .overlay(Rectangle().fill(OpenDesignDayColor.borderSoft).frame(width: 1), alignment: .trailing)
        .accessibilityElement(children: .contain)
    }
}

private struct OpenDesignTaskSearchButton: View {
    let openSearch: () -> Void

    @State private var isHovered = false

    var body: some View {
        Button(action: openSearch) {
            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass")
                    .font(.system(size: 10, weight: .medium))
                Text("과제 검색")
                Spacer(minLength: 0)
                Text("⌘ K")
                    .font(.system(size: 10, weight: .medium, design: .monospaced))
                    .foregroundStyle(isHovered ? OpenDesignDayColor.muted : OpenDesignDayColor.mutedDeep)
            }
            .font(.system(size: 11.5, weight: .medium))
            .foregroundStyle(isHovered ? OpenDesignDayColor.fg : OpenDesignDayColor.fgSecondary)
            .padding(.horizontal, 10)
            .frame(height: 30)
            .openDesignHoverRow(
                isHovered: isHovered,
                cornerRadius: 6,
                fill: OpenDesignDayColor.surface,
                hoverFill: OpenDesignDayColor.surface2,
                border: OpenDesignDayColor.borderSoft,
                hoverBorder: OpenDesignDayColor.border
            )
        }
        .buttonStyle(OpenDesignInteractiveButtonStyle())
        .onHover { isHovered = $0 }
        .accessibilityValue(isHovered ? "active" : "inactive")
    }
}

private struct OpenDesignTaskRow: View {
    let task: OpenDesignDayContent.TaskItem
    @State private var isHovered = false

    private var foreground: Color {
        switch task.state {
        case .active: return OpenDesignDayColor.fg
        case .pending: return OpenDesignDayColor.fgSecondary
        case .locked: return OpenDesignDayColor.fgSecondary.opacity(0.55)
        }
    }

    var body: some View {
        let isLocked = task.state == .locked
        let isActive = task.state == .active
        let isInteractiveHover = isHovered && !isLocked

        HStack(alignment: .top, spacing: 9) {
            statusIcon
                .frame(width: 18, height: 18)
                .padding(.top, 2)

            VStack(alignment: .leading, spacing: 2) {
                Text(task.title)
                    .font(.system(size: 12.5, weight: .medium))
                    .foregroundStyle(isLocked ? foreground : isActive || isInteractiveHover ? OpenDesignDayColor.fg : OpenDesignDayColor.fgSecondary)
                    .lineLimit(1)
                HStack(spacing: 6) {
                    Text(task.day)
                        .foregroundStyle(task.state == .locked ? OpenDesignDayColor.mutedDeep : OpenDesignDayColor.accent)
                    Text("·")
                        .foregroundStyle(OpenDesignDayColor.mutedDeep)
                    Text(task.meta)
                }
                .font(.system(size: 10.5, weight: .medium, design: .monospaced))
                .foregroundStyle(OpenDesignDayColor.muted)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .openDesignHoverRow(
            isHovered: isHovered,
            isActive: isActive,
            isDisabled: isLocked,
            cornerRadius: 6,
            activeFill: OpenDesignDayColor.selected,
            hoverBorder: Color.clear,
            activeBorder: Color.clear
        )
        .opacity(isLocked ? 0.66 : 1)
        .onHover { isHovered = $0 }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(isLocked ? "\(task.day) \(task.title), 잠금" : "\(task.day) \(task.title)")
        .accessibilityValue(isLocked ? "locked" : isActive || isInteractiveHover ? "active" : "inactive")
        .accessibilityIdentifier("opendesign.day.task.\(task.id)")
    }

    @ViewBuilder
    private var statusIcon: some View {
        switch task.state {
        case .active:
            ProgressView()
                .controlSize(.small)
                .tint(OpenDesignDayColor.accent)
        case .pending:
            Circle()
                .stroke(OpenDesignDayColor.mutedDeep, lineWidth: 1.5)
                .frame(width: 10, height: 10)
        case .locked:
            Image(systemName: "lock.fill")
                .font(.system(size: 9, weight: .bold))
                .foregroundStyle(OpenDesignDayColor.mutedDeep)
        }
    }
}

private struct OpenDesignInlineSegment: Hashable {
    enum Style: Hashable {
        case body
        case strong
        case mark
        case code
    }

    let text: String
    let style: Style

    static func body(_ text: String) -> Self {
        Self(text: text, style: .body)
    }

    static func strong(_ text: String) -> Self {
        Self(text: text, style: .strong)
    }

    static func mark(_ text: String) -> Self {
        Self(text: text, style: .mark)
    }

    static func code(_ text: String) -> Self {
        Self(text: text, style: .code)
    }
}

private func openDesignAttributedText(
    _ segments: [OpenDesignInlineSegment],
    bodySize: CGFloat,
    bodyWeight: Font.Weight = .regular,
    strongWeight: Font.Weight = .medium,
    bodyColor: Color = OpenDesignDayColor.fgSecondary,
    markColor: Color = OpenDesignDayColor.accent,
    markBackground: Color = OpenDesignDayColor.accentDim,
    codeColor: Color = OpenDesignDayColor.accent,
    codeBackground: Color = OpenDesignDayColor.bgDarker
) -> AttributedString {
    var value = AttributedString()
    for segment in segments {
        var run = AttributedString(segment.text)
        switch segment.style {
        case .body:
            run.font = .system(size: bodySize, weight: bodyWeight)
            run.foregroundColor = bodyColor
        case .strong:
            run.font = .system(size: bodySize, weight: strongWeight)
            run.foregroundColor = OpenDesignDayColor.fg
        case .mark:
            run.font = .system(size: bodySize, weight: .medium)
            run.foregroundColor = markColor
            run.backgroundColor = markBackground
        case .code:
            run.font = .system(size: max(10, bodySize - 1.5), weight: .medium, design: .monospaced)
            run.foregroundColor = codeColor
            run.backgroundColor = codeBackground
        }
        value += run
    }
    return value
}

private struct OpenDesignSignalSegment: Hashable {
    enum Style: Hashable {
        case body
        case strong
        case mark
        case code
    }

    let text: String
    let style: Style

    static func body(_ text: String) -> Self {
        Self(text: text, style: .body)
    }

    static func strong(_ text: String) -> Self {
        Self(text: text, style: .strong)
    }

    static func mark(_ text: String) -> Self {
        Self(text: text, style: .mark)
    }

    static func code(_ text: String) -> Self {
        Self(text: text, style: .code)
    }
}

private struct OpenDesignDayMainView: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    let content: OpenDesignDayContent
    @Binding var interaction: OpenDesignDayInteractionState
    @Binding var pendingScrollTarget: String?
    @Binding var searchPulseTarget: String?
    let submitStep: (OpenDesignDayContent.InterviewStep) -> Void
    let acceptMission: () -> Void
    let advanceHandoff: () -> Void
    let completeDayAction: () -> Void
    let advanceToNextDay: () -> Void
    let focusContextOverview: () -> Void
    let focusCurrentProgress: () -> Void
    let layout: OpenDesignDayLayoutMetrics

    @State private var introRevealStage = 0

    var body: some View {
        VStack(spacing: 0) {
            OpenDesignDayHeader(
                interaction: $interaction,
                focusContextOverview: focusContextOverview,
                focusCurrentProgress: focusCurrentProgress,
                horizontalPadding: layout.mainHorizontalPadding
            )
            OpenDesignStepper(
                interaction: interaction,
                horizontalPadding: layout.mainHorizontalPadding,
                focusStep: { index in
                    pendingScrollTarget = interaction.stepperScrollTarget(for: index)
                }
            )

            ScrollViewReader { proxy in
                ScrollView {
                    VStack(alignment: .leading, spacing: 0) {
                        OpenDesignTutorHead()
                            .openDesignStagedReveal(isVisible: introRevealStage >= 1)
                            .openDesignSearchPulse(id: "top", isActive: isSearchPulseActive("top"))
                            .id("top")

                        contextSection

                        OpenDesignMissionCard(
                            accepted: interaction.missionAccepted,
                            acceptMission: acceptMission
                        )
                        .openDesignStagedReveal(isVisible: introRevealStage >= 3)
                        .openDesignSearchPulse(id: "mission", isActive: isSearchPulseActive("mission"))
                        .id("mission")

                        if interaction.missionAccepted {
                            ForEach(content.interviewSteps.filter { $0.id <= interaction.highestVisibleInterviewStep }) { step in
                                OpenDesignInterviewStepView(
                                    step: step,
                                    selectedChoice: Binding(
                                        get: { interaction.selectedChoices[step.id] },
                                        set: { interaction.selectedChoices[step.id] = $0 }
                                    ),
                                    submittedChoice: interaction.submittedChoices[step.id],
                                    freeformAnswer: $interaction.freeformAnswer,
                                    submit: { submitStep(step) }
                                )
                                .transition(reduceMotion ? .opacity : .move(edge: .bottom).combined(with: .opacity))
                                .openDesignSearchPulse(
                                    id: "interview\(step.id)",
                                    isActive: isSearchPulseActive("interview\(step.id)") || isSearchPulseActive("interview\(step.id)-options")
                                )
                                .id("interview\(step.id)")
                            }
                        }

                        if interaction.allInterviewsSubmitted {
                            OpenDesignIcpPreview(
                                content: content,
                                interaction: interaction,
                                layout: layout,
                                advanceHandoff: advanceHandoff
                            )
                                .openDesignSearchPulse(id: "icp-preview", isActive: isSearchPulseActive("icp-preview"))
                                .id("icp-preview")

                            OpenDesignFinalHandoff(
                                content: content,
                                interaction: $interaction,
                                layout: layout,
                                advanceHandoff: advanceHandoff,
                                completeDayAction: completeDayAction,
                                advanceToNextDay: advanceToNextDay
                            )
                        }
                    }
                    .frame(maxWidth: 820, alignment: .leading)
                    .padding(.horizontal, layout.mainHorizontalPadding)
                    .padding(.top, 22)
                    .padding(.bottom, 32)
                    .frame(maxWidth: .infinity)
                }
                .background(OpenDesignDayColor.bg)
                .accessibilityIdentifier("opendesign.day.main.scroll")
                .onAppear(perform: startIntroReveal)
                .onChange(of: pendingScrollTarget) { _, target in
                    guard let target else { return }
                    withAnimation(.easeInOut(duration: 0.22)) {
                        proxy.scrollTo(target, anchor: .top)
                    }
                    DispatchQueue.main.async {
                        pendingScrollTarget = nil
                    }
                }
            }
        }
        .background(OpenDesignDayColor.bg)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("opendesign.day.main")
    }

    private func startIntroReveal() {
        guard introRevealStage == 0 else { return }
        if reduceMotion {
            introRevealStage = 3
            return
        }

        let delays: [(stage: Int, delay: Double)] = [
            (1, 0.04),
            (2, 0.18),
            (3, 0.34),
        ]
        for item in delays {
            DispatchQueue.main.asyncAfter(deadline: .now() + item.delay) {
                withAnimation(.easeOut(duration: 0.18)) {
                    introRevealStage = max(introRevealStage, item.stage)
                }
            }
        }
    }

    private var contextSection: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("오늘은 첫 고객 1명을 정하는 게 목표예요.")
                .font(.system(size: 20, weight: .semibold))
                .foregroundStyle(OpenDesignDayColor.fg)
                .padding(.bottom, 6)

            Text(
                openDesignAttributedText(
                    [
                        .body("30일 챌린지의 첫 결과는 "),
                        .strong("\"유저 100명 + 첫 매출\""),
                        .body("이지만, Day 1은 그보다 더 좁은 문제부터 풉니다. "),
                        .strong("이번 주에 진짜로 인터뷰 한 통을 할 만큼 가까운 1명"),
                        .body("이 누구인지 정하는 것. 이 한 명이 ICP의 후보가 되고, 이번 주 인터뷰·랜딩·웨지의 기준점이 됩니다."),
                    ],
                    bodySize: 13.5
                )
            )
                .lineSpacing(3)
                .padding(.bottom, 22)

            OpenDesignSectionHeader(title: "지금까지 시그널", meta: "workspace + interviews + BIP")
                .openDesignSearchPulse(id: "signals", isActive: isSearchPulseActive("signals"))
                .id("signals")

            VStack(spacing: 1) {
                ForEach(signalRows.indices, id: \.self) { index in
                    let item = signalRows[index]
                    signalRow(key: item.key, value: item.value)
                }
            }
            .background(OpenDesignDayColor.borderSoft)
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .stroke(OpenDesignDayColor.borderSoft, lineWidth: 1)
            )
            .openDesignStagedReveal(isVisible: introRevealStage >= 2)
            .padding(.bottom, 16)

            Text(
                openDesignAttributedText(
                    [
                        .body("어제 정리한 SPEC을 보면 "),
                        .strong("\"AI로 빌드하는 사람\""),
                        .body("이라는 큰 범주는 있는데, 그 안에서 누구를 먼저 도울지가 비어 있어요. 큰 범주에 메시지를 던지면 누구도 안 답합니다. 그래서 오늘은 ICP 한 명 — 이번 주 안에 진짜로 한 통 연락할 수 있는 1명을 같이 정해봅시다."),
                    ],
                    bodySize: 13
                )
            )
                .lineSpacing(3)
                .padding(.bottom, 8)
        }
    }

    private func isSearchPulseActive(_ id: String) -> Bool {
        searchPulseTarget == id
    }

    private var signalRows: [(key: String, value: [OpenDesignSignalSegment])] {
        [
            (
                "프로젝트",
                [
                    .code("~/code/agentic30-public"),
                    .body("에서 어제 "),
                    .code("SPEC.md"),
                    .body("와 "),
                    .code("ALIGNMENT.md"),
                    .body("를 정리했어요."),
                ]
            ),
            (
                "업무 일지",
                [
                    .body("오늘 만든 것 "),
                    .strong("0건"),
                    .body(", 막힌 것 "),
                    .mark("\"ICP가 너무 넓다\""),
                    .body(", 배운 것 "),
                    .strong("\"강의만 보는 동료 ≠ AI로 무한 빌드하는 동료\""),
                    .body("."),
                ]
            ),
            (
                "인터뷰",
                [
                    .body("Zoom "),
                    .strong("1건"),
                    .body(" (45분, transcript 6.7KB). 답변자 본인이 "),
                    .strong("\"검증 없이 5번 빌드\""),
                    .body("한 사례."),
                ]
            ),
            (
                "BIP",
                [
                    .strong("Threads 0건"),
                    .body(", "),
                    .strong("Reddit 0건"),
                    .body(", "),
                    .strong("블로그 0건"),
                    .body(". 첫 포스트는 "),
                    .strong("Day 3 인터뷰 직후"),
                    .body("로 비워둠."),
                ]
            ),
        ]
    }

    private func signalRow(key: String, value: [OpenDesignSignalSegment]) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 16) {
            Text(key)
                .font(.system(size: 10.5, weight: .semibold, design: .monospaced))
                .foregroundStyle(OpenDesignDayColor.muted)
                .tracking(0.6)
                .textCase(.uppercase)
                .frame(width: 132, alignment: .leading)
            Text(signalAttributedValue(value))
                .lineSpacing(2.5)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .background(OpenDesignDayColor.surface)
    }

    private func signalAttributedValue(_ segments: [OpenDesignSignalSegment]) -> AttributedString {
        var value = AttributedString()
        for segment in segments {
            var run = AttributedString(segment.text)
            switch segment.style {
            case .body:
                run.font = .system(size: 13)
                run.foregroundColor = OpenDesignDayColor.fgSecondary
            case .strong:
                run.font = .system(size: 13, weight: .semibold)
                run.foregroundColor = OpenDesignDayColor.fg
            case .mark:
                run.font = .system(size: 13, weight: .semibold)
                run.foregroundColor = OpenDesignDayColor.amber
                run.backgroundColor = OpenDesignDayColor.amberDim
            case .code:
                run.font = .system(size: 11.5, weight: .medium, design: .monospaced)
                run.foregroundColor = OpenDesignDayColor.accent
                run.backgroundColor = OpenDesignDayColor.bgDarker
            }
            value += run
        }
        return value
    }
}

private struct OpenDesignDayHeader: View {
    @Binding var interaction: OpenDesignDayInteractionState
    let focusContextOverview: () -> Void
    let focusCurrentProgress: () -> Void
    let horizontalPadding: CGFloat

    var body: some View {
        HStack(spacing: 12) {
            HStack(spacing: 14) {
                VStack(spacing: 0) {
                    Text("01")
                        .font(.system(size: 17, weight: .bold, design: .monospaced))
                        .foregroundStyle(OpenDesignDayColor.accent)
                }
                .frame(width: 44, height: 44)
                .background(
                    RoundedRectangle(cornerRadius: 11, style: .continuous)
                        .fill(OpenDesignDayColor.accentDim)
                        .overlay(
                            RoundedRectangle(cornerRadius: 11, style: .continuous)
                                .stroke(OpenDesignDayColor.accentLine, lineWidth: 1)
                        )
                )

                VStack(alignment: .leading, spacing: 2) {
                    Text("먼저 도울 사람을 정해요")
                        .font(.system(size: 17, weight: .semibold))
                        .foregroundStyle(OpenDesignDayColor.fg)
                    HStack(spacing: 8) {
                        Circle()
                            .fill(OpenDesignDayColor.accent)
                            .frame(width: 5, height: 5)
                            .shadow(color: OpenDesignDayColor.accentDim, radius: 3)
                        Text("Day 1 · 오리엔테이션 → 인터뷰")
                        Text("·")
                            .foregroundStyle(OpenDesignDayColor.mutedDeep)
                        Text(interaction.allInterviewsSubmitted ? "STEP 4 / 4" : "STEP 3 / 4")
                            .foregroundStyle(OpenDesignDayColor.fgSecondary)
                        Text("·")
                            .foregroundStyle(OpenDesignDayColor.mutedDeep)
                        Text(interaction.allInterviewsSubmitted ? "docs/ICP.md 초안" : "인터뷰 1 / 3")
                        Text("·")
                            .foregroundStyle(OpenDesignDayColor.mutedDeep)
                        Text("남은 시간 29d 14h")
                    }
                    .font(.system(size: 11, weight: .medium, design: .monospaced))
                    .foregroundStyle(OpenDesignDayColor.muted)
                    .lineLimit(1)
                }
                .frame(minWidth: 0, alignment: .leading)
            }

            Spacer(minLength: 12)

            OpenDesignHeaderActionButton(
                title: "맥락 다시 보기",
                systemImage: "tray.and.arrow.down",
                tone: .ghost,
                accessibilityIdentifier: "opendesign.day.header.context",
                action: focusContextOverview
            )

            OpenDesignHeaderActionButton(
                title: primaryActionTitle,
                systemImage: nil,
                tone: .accent,
                accessibilityIdentifier: "opendesign.day.header.primary",
                action: focusCurrentProgress
            )
        }
        .padding(.horizontal, horizontalPadding)
        .frame(height: 70)
        .background(OpenDesignDayColor.bg)
        .overlay(Rectangle().fill(OpenDesignDayColor.borderSoft).frame(height: 1), alignment: .bottom)
    }

    private var primaryActionTitle: String {
        if interaction.dayCompleted {
            return "Day 1 완료"
        }
        if interaction.allInterviewsSubmitted {
            if interaction.handoffIndex >= 5 {
                return "완료 버튼으로 이동"
            }
            if interaction.handoffIndex > 0 {
                return "현재 진행 위치"
            }
            return "ICP 초안 확인"
        }
        return "인터뷰 계속"
    }
}

private struct OpenDesignHeaderActionButton: View {
    enum Tone: Equatable {
        case ghost
        case accent
    }

    let title: String
    let systemImage: String?
    let tone: Tone
    var accessibilityIdentifier: String?
    let action: () -> Void

    @State private var isHovered = false

    var body: some View {
        Button(action: action) {
            label
                .font(.system(size: 11.5, weight: tone == .accent ? .semibold : .medium))
                .foregroundStyle(foreground)
                .padding(.horizontal, tone == .accent ? 14 : 12)
                .frame(height: 28)
                .openDesignHoverRow(
                    isHovered: isHovered,
                    cornerRadius: 8,
                    fill: tone == .accent ? OpenDesignDayColor.accent : Color.clear,
                    hoverFill: tone == .accent ? OpenDesignDayColor.accentStrong : OpenDesignDayColor.hover,
                    border: tone == .accent ? Color.clear : OpenDesignDayColor.borderSoft,
                    hoverBorder: tone == .accent ? Color.clear : OpenDesignDayColor.border
                )
        }
        .buttonStyle(OpenDesignInteractiveButtonStyle())
        .onHover { isHovered = $0 }
        .accessibilityValue(isHovered ? "active" : "inactive")
        .accessibilityIdentifier(accessibilityIdentifier ?? title)
    }

    @ViewBuilder
    private var label: some View {
        if let systemImage {
            Label(title, systemImage: systemImage)
        } else {
            Text(title)
        }
    }

    private var foreground: Color {
        switch tone {
        case .ghost:
            return isHovered ? OpenDesignDayColor.fg : OpenDesignDayColor.fgSecondary
        case .accent:
            return OpenDesignDayColor.bgDeep
        }
    }
}

private struct OpenDesignStepper: View {
    let interaction: OpenDesignDayInteractionState
    let horizontalPadding: CGFloat
    let focusStep: (Int) -> Void

    private var steps: [(String, Bool, Bool)] {
        [
            ("맥락 · 오늘의 목표", true, false),
            ("미션 · 한 명 정하기", true, false),
            (interaction.allInterviewsSubmitted ? "인터뷰 · ICP 좁히기 완료" : "인터뷰 · ICP 좁히기 (1 / 3)", interaction.allInterviewsSubmitted, !interaction.allInterviewsSubmitted),
            ("ICP · docs/ICP.md 미리보기", false, interaction.allInterviewsSubmitted),
        ]
    }

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 0) {
                ForEach(Array(steps.enumerated()), id: \.offset) { index, step in
                    OpenDesignStepperChip(
                        index: index,
                        title: step.0,
                        isDone: step.1,
                        isCurrent: step.2,
                        action: { focusStep(index) }
                    )

                    if index < steps.count - 1 {
                        Rectangle()
                            .fill(OpenDesignDayColor.borderSoft)
                            .frame(width: 24, height: 1)
                            .padding(.horizontal, 4)
                    }
                }
            }
            .padding(.horizontal, horizontalPadding)
            .frame(height: 56)
        }
        .background(OpenDesignDayColor.bg)
        .overlay(Rectangle().fill(OpenDesignDayColor.borderSoft).frame(height: 1), alignment: .bottom)
    }
}

private struct OpenDesignStepperChip: View {
    let index: Int
    let title: String
    let isDone: Bool
    let isCurrent: Bool
    let action: () -> Void

    @State private var isHovered = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                Text(isDone ? "✓" : "\(index + 1)")
                    .font(.system(size: 10, weight: .semibold, design: .monospaced))
                    .foregroundStyle(isDone ? OpenDesignDayColor.bgDeep : isCurrent || isHovered ? OpenDesignDayColor.accent : OpenDesignDayColor.muted)
                    .frame(width: 18, height: 18)
                    .background(Circle().fill(isDone ? OpenDesignDayColor.accent : Color.clear))
                    .overlay(Circle().stroke(isCurrent || isDone || isHovered ? OpenDesignDayColor.accent : OpenDesignDayColor.mutedDeep, lineWidth: 1.5))
                Text(title)
            }
            .font(.system(size: 10.5, weight: .medium, design: .monospaced))
            .foregroundStyle(isCurrent || isHovered ? OpenDesignDayColor.accent : isDone ? OpenDesignDayColor.fgSecondary : OpenDesignDayColor.muted)
            .padding(.horizontal, 12)
            .frame(height: 30)
            .openDesignHoverRow(
                isHovered: isHovered,
                isActive: isCurrent,
                cornerRadius: 15,
                hoverFill: OpenDesignDayColor.accentDim,
                activeFill: OpenDesignDayColor.accentDim,
                hoverBorder: OpenDesignDayColor.accentLine,
                activeBorder: OpenDesignDayColor.accentLine
            )
        }
        .buttonStyle(OpenDesignInteractiveButtonStyle())
        .onHover { isHovered = $0 }
        .accessibilityValue(isCurrent ? "active" : "inactive")
    }
}

private struct OpenDesignTutorHead: View {
    var body: some View {
        HStack(spacing: 6) {
            Text("tutor@day")
                .foregroundStyle(OpenDesignDayColor.accent)
            Text("~/code/agentic30")
                .foregroundStyle(OpenDesignDayColor.sky)
            Text("$")
                .foregroundStyle(OpenDesignDayColor.mutedDeep)
            Text("open day --mode=tutoring")
                .foregroundStyle(OpenDesignDayColor.fgSecondary)
        }
        .font(.system(size: 11, weight: .medium, design: .monospaced))
        .padding(.horizontal, 12)
        .frame(height: 32)
        .background(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .fill(OpenDesignDayColor.bgDarker)
                .overlay(
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .stroke(OpenDesignDayColor.borderSoft, lineWidth: 1)
                )
        )
        .padding(.bottom, 16)
    }
}

private struct OpenDesignSectionHeader: View {
    let title: String
    var meta: String?

    var body: some View {
        HStack(spacing: 10) {
            RoundedRectangle(cornerRadius: 2, style: .continuous)
                .fill(OpenDesignDayColor.accent)
                .frame(width: 4, height: 12)
            Text(title)
                .font(.system(size: 11, weight: .medium, design: .monospaced))
                .textCase(.uppercase)
                .foregroundStyle(OpenDesignDayColor.muted)
            if let meta {
                Text(meta)
                    .font(.system(size: 10.5, weight: .medium, design: .monospaced))
                    .foregroundStyle(OpenDesignDayColor.mutedDeep)
            }
            Rectangle()
                .fill(OpenDesignDayColor.borderSoft)
                .frame(height: 1)
        }
        .padding(.top, 22)
        .padding(.bottom, 12)
    }
}

private struct OpenDesignMissionCard: View {
    let accepted: Bool
    let acceptMission: () -> Void

    @State private var isAcceptHovered = false

    var body: some View {
        VStack(alignment: .leading, spacing: 13) {
            OpenDesignSectionHeader(title: "오늘의 미션", meta: "Mission · 1 of 1")

            VStack(alignment: .leading, spacing: 12) {
                HStack(alignment: .top, spacing: 11) {
                    Text("Mission")
                        .font(.system(size: 10, weight: .semibold, design: .monospaced))
                        .foregroundStyle(OpenDesignDayColor.amber)
                        .padding(.horizontal, 8)
                        .frame(height: 24)
                        .background(Capsule().fill(OpenDesignDayColor.amberDim))
                        .overlay(Capsule().stroke(OpenDesignDayColor.amberLine, lineWidth: 1))
                    Text(
                        openDesignAttributedText(
                            [
                                .body("첫 인터뷰 1통을 할 사람을 "),
                                .mark("한 명"),
                                .body("만 골라요."),
                            ],
                            bodySize: 17,
                            bodyWeight: .medium,
                            bodyColor: OpenDesignDayColor.fg,
                            markColor: OpenDesignDayColor.amber,
                            markBackground: OpenDesignDayColor.amberDim
                        )
                    )
                    .lineSpacing(3)
                }

                Text(
                    openDesignAttributedText(
                        [
                            .body("다짜고짜 \"ICP가 누구냐\"고 묻는 건 어려우니, "),
                            .strong("4지선다 → 짧은 인터뷰 3번 → 한 명으로 좁히기"),
                            .body(" 순서로 진행할게요. 다 끝나면 "),
                            .code("docs/ICP.md"),
                            .body("에 쓸 문서 초안을 먼저 보여줘요."),
                        ],
                        bodySize: 13
                    )
                )
                    .lineSpacing(3)

                VStack(alignment: .leading, spacing: 8) {
                    missionRule("1", [
                        .strong("만나러 갈 수 있어야"),
                        .body(" 해요 — 이번 주 안에 메시지 1통."),
                    ])
                    missionRule("2", [
                        .strong("칭찬형 답이 아니라"),
                        .body(" 진짜 시간을 쓰는 사람이어야 해요 — Mom Test 기준."),
                    ])
                    missionRule("3", [
                        .strong("한 줄로 묘사"),
                        .body("할 수 있어야 해요 — \"AI로 빌드하는 사람\"은 너무 넓어요."),
                    ])
                }
                .padding(.top, 12)
                .overlay(Rectangle().fill(OpenDesignDayColor.borderSoft).frame(height: 1), alignment: .top)

                HStack(spacing: 12) {
                    Circle()
                        .fill(OpenDesignDayColor.amber)
                        .frame(width: 6, height: 6)
                        .shadow(color: OpenDesignDayColor.amberDim, radius: 3)
                    Text("수락하면 4지선다 인터뷰가 열려요 · 약 3분")
                        .font(.system(size: 10.5, weight: .medium, design: .monospaced))
                        .foregroundStyle(OpenDesignDayColor.muted)
                    Spacer(minLength: 0)
                    Button(action: acceptMission) {
                        Text(accepted ? "미션 수락됨 ✓" : "미션 수락하고 인터뷰 시작 ↵")
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(accepted ? OpenDesignDayColor.amber : OpenDesignDayColor.bgDeep)
                            .padding(.horizontal, 16)
                            .frame(height: 30)
                            .openDesignHoverRow(
                                isHovered: isAcceptHovered,
                                isDisabled: accepted,
                                cornerRadius: 8,
                                fill: accepted ? OpenDesignDayColor.amberDim : OpenDesignDayColor.amber,
                                hoverFill: OpenDesignDayColor.amber.opacity(0.92),
                                border: accepted ? OpenDesignDayColor.amberLine : Color.clear,
                                hoverBorder: accepted ? OpenDesignDayColor.amberLine : Color.clear
                            )
                    }
                    .buttonStyle(OpenDesignInteractiveButtonStyle(isDisabled: accepted))
                    .disabled(accepted)
                    .onHover { isAcceptHovered = $0 }
                    .accessibilityIdentifier("opendesign.day.mission.accept")
                    .accessibilityValue(accepted ? "locked" : isAcceptHovered ? "active" : "inactive")
                }
                .padding(.top, 12)
                .overlay(Rectangle().fill(OpenDesignDayColor.borderSoft).frame(height: 1), alignment: .top)
            }
            .padding(.horizontal, 20)
            .padding(.top, 18)
            .padding(.bottom, 16)
            .background(gradientCardBackground(cornerRadius: 14, colors: [OpenDesignDayColor.surface, OpenDesignDayColor.surface2], stroke: OpenDesignDayColor.border))
            .overlay(alignment: .leading) {
                RoundedRectangle(cornerRadius: 2, style: .continuous)
                    .fill(OpenDesignDayColor.amber)
                    .frame(width: 3)
                    .shadow(color: OpenDesignDayColor.amber.opacity(0.45), radius: 7)
            }
        }
    }

    private func missionRule(_ index: String, _ text: [OpenDesignInlineSegment]) -> some View {
        HStack(alignment: .top, spacing: 9) {
            Text(index)
                .font(.system(size: 10, weight: .semibold, design: .monospaced))
                .foregroundStyle(OpenDesignDayColor.muted)
                .frame(width: 20, height: 20)
                .background(Circle().fill(OpenDesignDayColor.bgDeep))
                .overlay(Circle().stroke(OpenDesignDayColor.borderSoft, lineWidth: 1))
            Text(openDesignAttributedText(text, bodySize: 12.5))
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}

private struct OpenDesignInterviewStepView: View {
    let step: OpenDesignDayContent.InterviewStep
    @Binding var selectedChoice: Int?
    let submittedChoice: Int?
    @Binding var freeformAnswer: String
    let submit: () -> Void

    @State private var isSubmitHovered = false
    @State private var hidesTip = false

    var body: some View {
        let hasFreeformAnswer = step.id == 1 && !freeformAnswer.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        let hasSubmitted = submittedChoice != nil
        let selectedIsSubmitted = selectedChoice != nil && selectedChoice == submittedChoice
        let submitDisabled = selectedChoice == nil || selectedIsSubmitted

        VStack(alignment: .leading, spacing: 0) {
            OpenDesignSectionHeader(title: step.title, meta: step.meta)

            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    Text(step.label)
                        .font(.system(size: 10, weight: .medium, design: .monospaced))
                        .textCase(.uppercase)
                        .foregroundStyle(OpenDesignDayColor.accent)
                    Spacer(minLength: 0)
                    Text(step.score)
                        .font(.system(size: 10.5, weight: .semibold, design: .monospaced))
                        .foregroundStyle(OpenDesignDayColor.accent)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 1)
                        .background(Capsule().fill(OpenDesignDayColor.accentDim))
                        .overlay(Capsule().stroke(OpenDesignDayColor.accentLine, lineWidth: 1))
                }

                highlightedStatementText
                    .font(.system(size: 17, weight: .medium))
                    .lineSpacing(4)
                    .fixedSize(horizontal: false, vertical: true)

                HStack(spacing: 14) {
                    ForEach(step.criteria, id: \.self) { criterion in
                        Label(criterion, systemImage: "checkmark")
                            .font(.system(size: 11, weight: .medium, design: .monospaced))
                            .foregroundStyle(OpenDesignDayColor.muted)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.top, 2)
            }
            .padding(18)
            .background(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .fill(
                        LinearGradient(
                            colors: [OpenDesignDayColor.surface, OpenDesignDayColor.surface2],
                            startPoint: .top,
                            endPoint: .bottom
                        )
                    )
                    .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(OpenDesignDayColor.border, lineWidth: 1))
            )
            .overlay(alignment: .leading) {
                RoundedRectangle(cornerRadius: 2, style: .continuous)
                    .fill(OpenDesignDayColor.accent)
                    .frame(width: 3)
                    .shadow(color: OpenDesignDayColor.accent.opacity(0.6), radius: 7)
            }
            .padding(.bottom, 14)

            VStack(spacing: 0) {
                HStack {
                    HStack(spacing: 8) {
                        RoundedRectangle(cornerRadius: 2, style: .continuous)
                            .fill(OpenDesignDayColor.accent)
                            .frame(width: 4, height: 14)
                        Text(step.prompt)
                            .font(.system(size: 12, weight: .medium))
                            .foregroundStyle(OpenDesignDayColor.fg)
                    }
                    Spacer(minLength: 0)
                    Text("\(selectedChoice == nil ? 0 : 1) / 1 · \(step.progressLabel)")
                        .font(.system(size: 10.5, weight: .medium, design: .monospaced))
                        .foregroundStyle(OpenDesignDayColor.muted)
                }
                .padding(.horizontal, 14)
                .frame(height: 42)
                .background(OpenDesignDayColor.surface2)
                .overlay(Rectangle().fill(OpenDesignDayColor.borderSoft).frame(height: 1), alignment: .bottom)

                VStack(spacing: 2) {
                    ForEach(step.options) { option in
                        OpenDesignOptionRow(
                            option: option,
                            isPicked: selectedChoice == option.id,
                            isSubmitted: submittedChoice == option.id,
                            select: { selectedChoice = option.id }
                        )
                        .accessibilityIdentifier(step.id == 1 ? "opendesign.day.icp.option.\(option.id)" : "opendesign.day.interview.\(step.id).option.\(option.id)")
                    }
                }
                .padding(6)

                if step.id == 1 && !hasSubmitted {
                    VStack(alignment: .leading, spacing: 8) {
                        HStack {
                            Text("직접 답하기 — 위 4개에 없으면 한 줄로 묘사해도 돼요")
                            Spacer(minLength: 0)
                            Text("Enter 로 전송")
                                .foregroundStyle(OpenDesignDayColor.mutedDeep)
                        }
                        .font(.system(size: 10.5, weight: .medium, design: .monospaced))
                        .foregroundStyle(OpenDesignDayColor.muted)

                        TextField("예: \"전 동료 중 Cursor로 매주 새 프로젝트 만드는 사람\"", text: $freeformAnswer)
                            .textFieldStyle(.plain)
                            .font(.system(size: 12.5, weight: .medium))
                            .foregroundStyle(OpenDesignDayColor.fg)
                            .onSubmit {
                                hidesTip = true
                                freeformAnswer = ""
                            }
                            .onChange(of: freeformAnswer) { _, value in
                                if step.id == 1, !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                                    hidesTip = true
                                }
                            }
                            .accessibilityIdentifier("opendesign.day.icp.freeform")
                            .padding(.leading, 2)
                            .overlay(alignment: .leading) {
                                Text("›")
                                    .font(.system(size: 16, weight: .semibold, design: .monospaced))
                                    .foregroundStyle(OpenDesignDayColor.accent)
                                    .offset(x: -14)
                                    .accessibilityHidden(true)
                            }
                            .padding(.leading, 20)
                            .padding(.trailing, 12)
                            .frame(height: 34)
                            .background(
                                RoundedRectangle(cornerRadius: 8, style: .continuous)
                                    .fill(OpenDesignDayColor.surface)
                                    .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).stroke(OpenDesignDayColor.borderSoft, lineWidth: 1))
                            )
                    }
                    .padding(.horizontal, 14)
                    .padding(.vertical, 11)
                    .background(OpenDesignDayColor.bgDeep)
                    .overlay(Rectangle().fill(OpenDesignDayColor.borderSoft).frame(height: 1), alignment: .top)
                }

                HStack(spacing: 12) {
                    if let selectedChoice {
                        Text(selectedIsSubmitted ? "제출 완료 · \(selectedChoice)번" : "선택됨 · \(selectedChoice)번")
                            .foregroundStyle(selectedIsSubmitted ? OpenDesignDayColor.accent : OpenDesignDayColor.muted)
                            .accessibilityIdentifier(step.id == 1 ? "opendesign.day.icp.footer.status" : "opendesign.day.interview.\(step.id).footer.status")
                        if let title = step.options.first(where: { $0.id == selectedChoice })?.title {
                            Text("— \(title)")
                                .foregroundStyle(OpenDesignDayColor.accent)
                        }
                    } else if hasFreeformAnswer {
                        Text("직접 입력 중")
                            .foregroundStyle(OpenDesignDayColor.muted)
                            .accessibilityIdentifier(step.id == 1 ? "opendesign.day.icp.footer.status" : "opendesign.day.interview.\(step.id).footer.status")
                    } else {
                        Text("선택 안 됨")
                            .foregroundStyle(OpenDesignDayColor.mutedDeep)
                            .accessibilityIdentifier(step.id == 1 ? "opendesign.day.icp.footer.status" : "opendesign.day.interview.\(step.id).footer.status")
                    }

                    Spacer(minLength: 0)

                    Button(action: submit) {
                        Text(submitButtonTitle)
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(submitDisabled ? OpenDesignDayColor.mutedDeep : OpenDesignDayColor.bgDeep)
                            .padding(.horizontal, 16)
                            .frame(height: 30)
                            .openDesignHoverRow(
                                isHovered: isSubmitHovered,
                                isDisabled: submitDisabled,
                                cornerRadius: 8,
                                fill: submitDisabled ? OpenDesignDayColor.surface2 : OpenDesignDayColor.accent,
                                hoverFill: OpenDesignDayColor.accentStrong,
                                border: submitDisabled ? OpenDesignDayColor.borderSoft : Color.clear,
                                hoverBorder: Color.clear
                            )
                    }
                    .buttonStyle(OpenDesignInteractiveButtonStyle(isDisabled: submitDisabled))
                    .disabled(submitDisabled)
                    .onHover { isSubmitHovered = $0 }
                    .accessibilityIdentifier(step.id == 1 ? "opendesign.day.icp.submit" : "opendesign.day.interview.\(step.id).submit")
                    .accessibilityValue(submitDisabled ? "locked" : isSubmitHovered ? "active" : "inactive")
                }
                .font(.system(size: 10.5, weight: .medium, design: .monospaced))
                .padding(.horizontal, 14)
                .frame(height: 52)
                .background(OpenDesignDayColor.bgDeep)
                .overlay(Rectangle().fill(OpenDesignDayColor.borderSoft).frame(height: 1), alignment: .top)
            }
            .background(cardBackground(cornerRadius: 12, fill: OpenDesignDayColor.surface))
            .padding(.bottom, 14)
            .id(step.id == 1 ? "interview1-options" : "interview\(step.id)-options")

            if step.id == 1 && selectedChoice == nil && !hasSubmitted && !hidesTip {
                Text(tipText)
                    .font(.system(size: 13, weight: .regular))
                    .lineSpacing(3)
                    .foregroundStyle(OpenDesignDayColor.muted)
                    .padding(.bottom, 14)
                    .accessibilityIdentifier("opendesign.day.icp.tip")
            }
        }
    }

    private var tipText: AttributedString {
        var text = AttributedString("팁 · 정답을 고르는 게 아니라, 이번 주에 진짜로 메시지 보낼 수 있는 쪽을 직감으로 골라주세요. 고르면 인터뷰 2 — 도구와 인터뷰 3 — 막힌 단계로 더 좁혀갑니다.")
        text.foregroundColor = OpenDesignDayColor.muted
        for marker in ["팁", "인터뷰 2 — 도구", "인터뷰 3 — 막힌 단계"] {
            if let range = text.range(of: marker) {
                text[range].foregroundColor = OpenDesignDayColor.fgSecondary
            }
        }
        return text
    }

    private var submitButtonTitle: String {
        guard selectedChoice != nil else { return "\(step.submitLabel) ↵" }
        if selectedChoice == submittedChoice { return "제출됨 ✓" }
        if submittedChoice != nil { return "이 후보로 다시 제출 ↵" }
        return "\(step.submitLabel) ↵"
    }

    private var highlightedStatementText: Text {
        var statement = AttributedString(step.statementPrefix + step.markedStatement + step.statementSuffix)
        statement.foregroundColor = OpenDesignDayColor.fg
        if let range = statement.range(of: step.markedStatement) {
            statement[range].foregroundColor = OpenDesignDayColor.accent
        }
        return Text(statement)
    }
}

private struct OpenDesignOptionRow: View {
    let option: OpenDesignDayContent.InterviewOption
    let isPicked: Bool
    let isSubmitted: Bool
    let select: () -> Void

    @State private var isHovered = false

    private var isActive: Bool {
        isPicked || isHovered
    }

    var body: some View {
        Button(action: select) {
            HStack(alignment: .top, spacing: 12) {
                Text(isSubmitted ? "✓" : "\(option.id)")
                    .font(.system(size: 11.5, weight: .semibold, design: .monospaced))
                    .foregroundStyle(isPicked || isSubmitted ? OpenDesignDayColor.bgDeep : isHovered ? OpenDesignDayColor.fgSecondary : OpenDesignDayColor.muted)
                    .frame(width: 24, height: 24)
                    .background(Circle().fill(isPicked || isSubmitted ? OpenDesignDayColor.accent : OpenDesignDayColor.bgDeep))
                    .overlay(Circle().stroke(isPicked || isSubmitted ? OpenDesignDayColor.accent : isHovered ? OpenDesignDayColor.borderStrong : OpenDesignDayColor.border, lineWidth: 1))
                    .padding(.top, 1)

                VStack(alignment: .leading, spacing: 3) {
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Text(option.title)
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(OpenDesignDayColor.fg)
                            .fixedSize(horizontal: false, vertical: true)

                        if isSubmitted {
                            Text("제출됨")
                                .font(.system(size: 9.5, weight: .bold, design: .monospaced))
                                .foregroundStyle(OpenDesignDayColor.bgDeep)
                                .padding(.horizontal, 7)
                                .frame(height: 17)
                                .background(Capsule().fill(OpenDesignDayColor.accent))
                                .alignmentGuide(.firstTextBaseline) { dimension in
                                    dimension[VerticalAlignment.center] + 2
                                }
                        }
                    }
                    Text(option.detail)
                        .font(.system(size: 11.5, weight: .regular))
                        .foregroundStyle(isPicked ? OpenDesignDayColor.fgSecondary : OpenDesignDayColor.muted)
                        .lineSpacing(2)
                        .fixedSize(horizontal: false, vertical: true)
                }

                Spacer(minLength: 8)

                Text(isPicked && !isSubmitted ? "선택됨" : option.tail)
                    .font(.system(size: 10, weight: .medium, design: .monospaced))
                    .frame(minWidth: 76, alignment: .trailing)
                    .padding(.top, 4)
                    .foregroundStyle(isPicked || isSubmitted ? OpenDesignDayColor.accent : isHovered ? OpenDesignDayColor.fgSecondary : OpenDesignDayColor.mutedDeep)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 11)
            .openDesignHoverRow(
                isHovered: isHovered,
                isActive: isPicked,
                cornerRadius: 8,
                activeFill: OpenDesignDayColor.accentDim,
                hoverBorder: OpenDesignDayColor.borderSoft,
                activeBorder: OpenDesignDayColor.accentLine
            )
            .contentShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        }
        .buttonStyle(OpenDesignInteractiveButtonStyle())
        .simultaneousGesture(TapGesture().onEnded(select))
        .onHover { isHovered = $0 }
        .accessibilityElement(children: .combine)
        .accessibilityValue(isSubmitted ? "locked" : isPicked || isHovered ? "active" : "inactive")
    }
}

private struct OpenDesignIcpPreview: View {
    let content: OpenDesignDayContent
    let interaction: OpenDesignDayInteractionState
    let layout: OpenDesignDayLayoutMetrics
    let advanceHandoff: () -> Void

    @State private var didCopyPreview = false

    private var draft: OpenDesignDayDraft {
        content.draft(for: interaction)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            guide(
                title: "문서 초안을 먼저 확인해요.",
                body: "인터뷰 네 개가 끝났습니다. 바로 결론을 쌓지 않고, 먼저 docs/ICP.md에 들어갈 초안을 보여드릴게요. 이 문서는 다음 단계의 ICP 한 문장과 후보 1명을 판단하는 기준점입니다."
            )

            OpenDesignSectionHeader(title: "문서 미리보기", meta: "docs/ICP.md · draft")

            VStack(spacing: 0) {
                HStack(spacing: 12) {
                    Text("MD")
                        .font(.system(size: 11, weight: .bold, design: .monospaced))
                        .foregroundStyle(OpenDesignDayColor.accent)
                        .frame(width: 26, height: 26)
                        .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(OpenDesignDayColor.accentDim))
                        .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).stroke(OpenDesignDayColor.accentLine, lineWidth: 1))

                    VStack(alignment: .leading, spacing: 2) {
                        Text("마지막 인터뷰 결과로 쓸 ICP 문서 초안")
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(OpenDesignDayColor.fg)
                        Text("write target · docs/ICP.md")
                            .font(.system(size: 10.5, weight: .medium, design: .monospaced))
                            .foregroundStyle(OpenDesignDayColor.muted)
                    }
                    Spacer(minLength: 0)
                    OpenDesignGhostActionButton(
                        label: didCopyPreview ? "복사됨 ✓" : "초안 복사",
                        accessibilityIdentifier: "opendesign.day.icpPreview.copy",
                        action: copyPreview
                    )
                    .help("ICP 문서 초안을 클립보드에 복사")
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 13)
                .background(OpenDesignDayColor.surface2)
                .overlay(Rectangle().fill(OpenDesignDayColor.borderSoft).frame(height: 1), alignment: .bottom)

                VStack(alignment: .leading, spacing: 12) {
                    LazyVGrid(columns: openDesignGridColumns(layout.openDesignGridColumnCount), alignment: .leading, spacing: 8) {
                        chip("Distance", draft.distance)
                        chip("Tool", draft.tool)
                        chip("Stuck", draft.stuck)
                        chip("Last 7d", draft.action)
                    }

                    Text(previewMarkdownAttributed)
                        .font(.system(size: 11.5, weight: .medium, design: .monospaced))
                        .lineSpacing(3)
                        .padding(14)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(
                            RoundedRectangle(cornerRadius: 10, style: .continuous)
                                .fill(OpenDesignDayColor.bgDarker)
                                .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(OpenDesignDayColor.borderSoft, lineWidth: 1))
                        )
                }
                .padding(.horizontal, 16)
                .padding(.top, 14)
                .padding(.bottom, 16)
            }
            .background(gradientCardBackground(cornerRadius: 14, colors: [OpenDesignDayColor.surface2, OpenDesignDayColor.surface], stroke: OpenDesignDayColor.accentLine))

            handoffButton(
                label: "문서 확인 → ICP 한 문장 보기",
                hint: "문서 초안이 맞으면 ICP를 한 문장으로 고정합니다.",
                targetIndex: 1,
                currentIndex: interaction.handoffIndex,
                accessibilityIdentifier: "opendesign.day.preview.next",
                action: advanceHandoff
            )
        }
        .padding(.top, 6)
    }

    private var previewMarkdown: String {
        draft.markdown
    }

    private var previewMarkdownAttributed: AttributedString {
        var text = AttributedString(previewMarkdown)
        text.foregroundColor = OpenDesignDayColor.fgSecondary
        for header in ["# Ideal Customer Profile"] {
            if let range = text.range(of: header) {
                text[range].foregroundColor = OpenDesignDayColor.fg
            }
        }
        for key in ["## Our ICP", "## Evidence from Day 1", "## Anti-ICP guardrail", "## Next action"] {
            if let range = text.range(of: key) {
                text[range].foregroundColor = OpenDesignDayColor.amber
            }
        }
        for muted in ["> Write target: docs/ICP.md", "> Source: Day 1 interview flow"] {
            if let range = text.range(of: muted) {
                text[range].foregroundColor = OpenDesignDayColor.mutedDeep
            }
        }
        if let range = text.range(of: "docs/ICP.md") {
            text[range].foregroundColor = OpenDesignDayColor.accent
        }
        return text
    }

    private func copyPreview() {
        copyToPasteboard(previewMarkdown)
        didCopyPreview = true
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.4) {
            didCopyPreview = false
        }
    }

}

private struct OpenDesignFinalHandoff: View {
    let content: OpenDesignDayContent
    @Binding var interaction: OpenDesignDayInteractionState
    let layout: OpenDesignDayLayoutMetrics
    let advanceHandoff: () -> Void
    let completeDayAction: () -> Void
    let advanceToNextDay: () -> Void

    @State private var isCompleteHovered = false
    @State private var isDay2Hovered = false
    @State private var didCopyMessage = false

    private var draft: OpenDesignDayDraft {
        content.draft(for: interaction)
    }

    private var finalIcpStatementText: Text {
        var text = AttributedString(draft.finalIcpStatement)
        text.foregroundColor = OpenDesignDayColor.fg
        for marked in [draft.distance, draft.tool, draft.stuck, draft.action] where !marked.isEmpty {
            if let range = text.range(of: marked) {
                text[range].foregroundColor = OpenDesignDayColor.accent
            }
        }
        return Text(text)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if interaction.handoffIndex >= 1 {
                finalIcp
                    .id("final-icp")
            }
            if interaction.handoffIndex >= 2 {
                candidate
                    .id("candidate")
            }
            if interaction.handoffIndex >= 3 {
                slots
                    .id("slot")
            }
            if interaction.handoffIndex >= 4 {
                message
                    .id("message")
            }
            if interaction.handoffIndex >= 5 {
                gate
                    .id("gate")
            }
            if interaction.dayCompleted {
                completion
                    .id("completion")
            }
        }
    }

    private var finalIcp: some View {
        VStack(alignment: .leading, spacing: 12) {
            guide(title: "ICP 한 문장으로 좁혀요.", body: "좋아요. 이제 네 번의 선택을 한 문장으로 압축합니다. 이 문장은 Day 3 인터뷰 대상을 고르는 기준선이고, 이후 랜딩·웨지·첫 메시지가 흔들리지 않게 잡아주는 작은 계약입니다.")
            OpenDesignSectionHeader(title: "ICP 한 문장", meta: "인터뷰 4개 답변 기준 · 좁힘 점수 8.2")
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    Text("ICP · 최종 후보 문장")
                        .font(.system(size: 10, weight: .medium, design: .monospaced))
                        .textCase(.uppercase)
                        .foregroundStyle(OpenDesignDayColor.accent)
                    Spacer()
                    Text("8.2 / 10")
                        .font(.system(size: 10.5, weight: .semibold, design: .monospaced))
                        .foregroundStyle(OpenDesignDayColor.accent)
                        .padding(.horizontal, 8)
                        .background(Capsule().fill(OpenDesignDayColor.accentDim))
                }
                finalIcpStatementText
                    .font(.system(size: 17, weight: .medium))
                    .lineSpacing(4)
                HStack(spacing: 14) {
                    ForEach(["이번 주 연락 가능", "도구 사용 빈도 확인", "막힌 단계 명확", "최근 행동 기준"], id: \.self) { text in
                        Label(text, systemImage: "checkmark")
                            .font(.system(size: 11, weight: .medium, design: .monospaced))
                            .foregroundStyle(OpenDesignDayColor.muted)
                    }
                }
            }
            .padding(18)
            .background(gradientCardBackground(cornerRadius: 14, colors: [OpenDesignDayColor.surface, OpenDesignDayColor.surface2], stroke: OpenDesignDayColor.border))
            .overlay(alignment: .leading) {
                RoundedRectangle(cornerRadius: 2, style: .continuous)
                    .fill(OpenDesignDayColor.accent)
                    .frame(width: 3)
                    .shadow(color: OpenDesignDayColor.accent.opacity(0.6), radius: 7)
            }
            handoffButton(
                label: "ICP 확인 → 후보/Anti-ICP 보기",
                hint: "이 문장으로 후보 1명과 Anti-ICP 신호를 같이 확인합니다.",
                targetIndex: 2,
                currentIndex: interaction.handoffIndex,
                accessibilityIdentifier: "opendesign.day.final.next",
                action: advanceHandoff
            )
        }
        .overlay(alignment: .topLeading) {
            openDesignAccessibilityAnchor("opendesign.day.final", label: "OpenDesign Day Final ICP")
        }
    }

    private var candidate: some View {
        VStack(alignment: .leading, spacing: 12) {
            guide(title: "후보와 Anti-ICP를 함께 봐요.", body: "문장이 정해졌으니 추상적인 ICP를 실제 연락 가능한 한 사람으로 바꿉니다. 동시에 \"좋네요\"만 말하고 최근 행동이 없는 사람은 제외하도록 Anti-ICP 신호도 같이 잠급니다.")
            OpenDesignSectionHeader(title: "후보 1명", meta: "SPEC 입력용 · Day 3 첫 인터뷰 대상")
            HStack(alignment: .top, spacing: 16) {
                Text("박")
                    .font(.system(size: 19, weight: .bold, design: .monospaced))
                    .foregroundStyle(OpenDesignDayColor.accent)
                    .frame(width: 56, height: 56)
                    .background(Circle().fill(OpenDesignDayColor.accentDim))
                    .overlay(Circle().stroke(OpenDesignDayColor.accentLine, lineWidth: 1))

                VStack(alignment: .leading, spacing: 10) {
                    HStack(spacing: 8) {
                        Text("박주영")
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundStyle(OpenDesignDayColor.fg)
                        Text("CANDIDATE 01")
                            .font(.system(size: 10, weight: .medium, design: .monospaced))
                            .foregroundStyle(OpenDesignDayColor.accent)
                            .padding(.horizontal, 7)
                            .background(Capsule().fill(OpenDesignDayColor.accentDim))
                    }
                    Text("@joopark.dev · 서울 · 퇴사 5개월차 · 가까움 0.82")
                        .font(.system(size: 11, weight: .medium, design: .monospaced))
                        .foregroundStyle(OpenDesignDayColor.muted)
                    LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], alignment: .leading, spacing: 10) {
                        personFact("거리", label(1))
                        personFact("도구", label(2))
                        personFact("막힌 곳", label(3))
                        personFact("지난 7일", label(4))
                    }
                }
                Spacer(minLength: 0)
                VStack(spacing: 4) {
                    OpenDesignGhostActionButton(
                        label: "교체",
                        systemImage: "arrow.triangle.2.circlepath",
                        accessibilityIdentifier: "opendesign.day.candidate.replace",
                        action: {}
                    )
                    .help("후보 교체")
                    OpenDesignGhostActionButton(
                        label: "후보 옵션",
                        systemImage: "ellipsis",
                        isIconOnly: true,
                        accessibilityIdentifier: "opendesign.day.candidate.more",
                        action: {}
                    )
                    .help("후보 옵션")
                }
            }
            .padding(16)
            .background(cardBackground(cornerRadius: 12, fill: OpenDesignDayColor.surface))

            HStack(alignment: .top, spacing: 10) {
                Image(systemName: "exclamationmark.circle")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(OpenDesignDayColor.rose)
                VStack(alignment: .leading, spacing: 4) {
                    Text("Anti-ICP 체크")
                        .font(.system(size: 10, weight: .medium, design: .monospaced))
                        .foregroundStyle(OpenDesignDayColor.rose)
                    Text(antiIcpAttributedBody)
                        .lineSpacing(2)
                }
            }
            .padding(12)
            .background(
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .fill(OpenDesignDayColor.surface)
                    .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(OpenDesignDayColor.borderSoft, lineWidth: 1))
            )
            .overlay(Rectangle().fill(OpenDesignDayColor.rose).frame(width: 2), alignment: .leading)

            handoffButton(
                label: "후보 확인 → 약속 슬롯 보기",
                hint: "후보가 살아 있으면 이번 주 실제로 잡을 수 있는 시간대를 고릅니다.",
                targetIndex: 3,
                currentIndex: interaction.handoffIndex,
                accessibilityIdentifier: "opendesign.day.candidate.next",
                action: advanceHandoff
            )
        }
        .overlay(alignment: .topLeading) {
            openDesignAccessibilityAnchor("opendesign.day.candidate", label: "OpenDesign Day Candidate")
        }
    }

    private var slots: some View {
        VStack(alignment: .leading, spacing: 12) {
            guide(title: "일정 선택지를 하나로 줄여요.", body: "후보가 살아 있으면 다음 병목은 일정입니다. 많은 선택지를 열지 말고 Mon-Wed 중 실제로 보낼 수 있는 30분 슬롯 하나만 고릅니다. 오늘의 결과는 문서가 아니라 잡을 수 있는 인터뷰예요.")
            OpenDesignSectionHeader(title: "인터뷰 약속 슬롯", meta: "Mon-Wed 중 1건만 잡기")
            LazyVGrid(columns: openDesignGridColumns(layout.openDesignGridColumnCount), spacing: 8) {
                ForEach(Array(slotData.enumerated()), id: \.offset) { index, slot in
                    OpenDesignSlotButton(
                        id: index,
                        slot: slot,
                        isSelected: interaction.selectedSlot == index,
                        select: { interaction.selectedSlot = index }
                    )
                }
            }
            handoffButton(
                label: "슬롯 선택 → 첫 메시지 보기",
                hint: "선택한 슬롯을 기준으로 부담 없는 첫 메시지를 만듭니다.",
                targetIndex: 4,
                currentIndex: interaction.handoffIndex,
                accessibilityIdentifier: "opendesign.day.slot.next",
                action: advanceHandoff
            )
        }
        .overlay(alignment: .topLeading) {
            openDesignAccessibilityAnchor("opendesign.day.slot", label: "OpenDesign Day Slot")
        }
    }

    private var message: some View {
        VStack(alignment: .leading, spacing: 12) {
            guide(title: "첫 메시지는 짧게 갑니다.", body: "슬롯이 정해졌으니 메시지는 설명보다 맥락, 시간 제안, 질문 3개만 남깁니다. 길게 설득하려고 하면 답장이 늦어져요. 지금 필요한 건 관심이 아니라 한 통의 인터뷰 약속입니다.")
            OpenDesignSectionHeader(title: "첫 메시지 초안", meta: "Twitter DM · 보내기 전 검토")
            Text(messageDraftAttributed)
            .font(.system(size: 12, weight: .medium, design: .monospaced))
            .lineSpacing(4)
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(cardBackground(cornerRadius: 12, fill: OpenDesignDayColor.bgDarker))

            HStack(spacing: 10) {
                Spacer(minLength: 0)
                OpenDesignGhostActionButton(
                    label: didCopyMessage ? "복사됨 ✓" : "DM 복사 ⌘ C",
                    accessibilityIdentifier: "opendesign.day.dm.copy",
                    action: copyMessage
                )
                .help("첫 메시지 초안을 클립보드에 복사")
                OpenDesignHandoffActionButton(
                    label: interaction.handoffIndex >= 5 ? "확인 완료 ✓" : "Day 1 게이트 보기",
                    accessibilityIdentifier: "opendesign.day.message.next",
                    isDisabled: interaction.handoffIndex >= 5,
                    action: advanceHandoff
                )
            }
        }
        .overlay(alignment: .topLeading) {
            openDesignAccessibilityAnchor("opendesign.day.message", label: "OpenDesign Day Message")
        }
    }

    private var gate: some View {
        VStack(alignment: .leading, spacing: 12) {
            guide(title: "Day 1 게이트를 닫아요.", body: "마지막으로 게이트를 확인합니다. Day 1은 문서가 예쁜지가 아니라, 내일 실제 인터뷰로 이어질 조건이 채워졌는지로 끝납니다. 체크가 남아 있으면 다음 날로 넘기지 말고 여기서 닫습니다.")
            OpenDesignSectionHeader(title: "Day 1 게이트 조건", meta: nil)
            VStack(spacing: 8) {
                gateRow(1, "ICP 한 문장 (좁힘 점수 ≥ 7)", completedTag: "완료 · 8.2")
                gateRow(2, "후보 1명 — distance · tools · stuck · last7d 모두 채움", completedTag: "완료")
                gateRow(3, "인터뷰 약속 1건 — 슬롯 확정 + DM 보냄", completedTag: "완료", pendingTag: "슬롯 선택됨")
                gateRow(4, "Anti-ICP 체크리스트 동의", completedTag: "완료", pendingTag: draft.isAntiSignal ? "재확인" : "대기")
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 14)
            .background(cardBackground(cornerRadius: 12, fill: OpenDesignDayColor.surface))

            VStack(alignment: .center, spacing: 12) {
                Text("후보, Anti-ICP, 약속 슬롯, 첫 메시지, 게이트 조건까지 모두 확인했다면 Day 1을 닫습니다.")
                    .font(.system(size: 12.5, weight: .medium, design: .monospaced))
                    .foregroundStyle(OpenDesignDayColor.fgSecondary)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
                Button(action: completeDayAction) {
                    Text(interaction.dayCompleted ? "Day 1 완료됨 ✓" : "Day 1 확인 완료 ↵")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(OpenDesignDayColor.bgDeep)
                        .padding(.horizontal, 18)
                        .frame(maxWidth: 430)
                        .frame(height: 48)
                        .openDesignHoverRow(
                            isHovered: isCompleteHovered,
                            isDisabled: interaction.dayCompleted,
                            cornerRadius: 9,
                            fill: OpenDesignDayColor.accent,
                            hoverFill: OpenDesignDayColor.accentStrong,
                            hoverBorder: Color.clear
                        )
                }
                .buttonStyle(OpenDesignInteractiveButtonStyle(isDisabled: interaction.dayCompleted))
                .disabled(interaction.dayCompleted)
                .onHover { isCompleteHovered = $0 }
                .accessibilityValue(interaction.dayCompleted ? "locked" : isCompleteHovered ? "active" : "inactive")
                .accessibilityIdentifier("opendesign.day.complete")
            }
            .frame(maxWidth: .infinity)
            .padding(.horizontal, 18)
            .padding(.vertical, 16)
            .background(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .fill(OpenDesignDayColor.accentDim)
                    .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(OpenDesignDayColor.accentLine, lineWidth: 1))
            )
        }
        .overlay(alignment: .topLeading) {
            openDesignAccessibilityAnchor("opendesign.day.gate", label: "OpenDesign Day Gate")
        }
    }

    private var completion: some View {
        HStack(alignment: .center, spacing: 14) {
            Text("✓")
                .font(.system(size: 18, weight: .bold))
                .foregroundStyle(OpenDesignDayColor.bgDeep)
                .frame(width: 44, height: 44)
                .background(RoundedRectangle(cornerRadius: 13, style: .continuous).fill(OpenDesignDayColor.accent))
            VStack(alignment: .leading, spacing: 4) {
                Text("Day 1이 완료됐습니다.")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(OpenDesignDayColor.fg)
                Text("이제 Day 2에서 오늘 정한 ICP를 기준으로 시장 신호와 키워드 3개를 잠급니다.")
                    .font(.system(size: 12.5, weight: .regular))
                    .foregroundStyle(OpenDesignDayColor.fgSecondary)
            }
            Spacer(minLength: 0)
            Button(action: advanceToNextDay) {
                Text("Day 2로 이동 →")
                    .font(.system(size: 12.5, weight: .semibold))
                    .foregroundStyle(isDay2Hovered ? OpenDesignDayColor.accent : OpenDesignDayColor.fg)
                    .padding(.horizontal, 16)
                    .frame(height: 36)
                    .openDesignHoverRow(
                        isHovered: isDay2Hovered,
                        cornerRadius: 10,
                        fill: OpenDesignDayColor.bgDarker,
                        hoverFill: OpenDesignDayColor.bgDarker,
                        border: OpenDesignDayColor.accentLine,
                        hoverBorder: OpenDesignDayColor.accent
                    )
            }
            .buttonStyle(OpenDesignInteractiveButtonStyle())
            .onHover { isDay2Hovered = $0 }
            .accessibilityIdentifier("opendesign.day.day2")
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 18)
        .background(gradientCardBackground(cornerRadius: 14, colors: [OpenDesignDayColor.surface2, OpenDesignDayColor.surface], stroke: OpenDesignDayColor.accentLine))
        .overlay(alignment: .topLeading) {
            Color.clear
                .frame(width: 1, height: 1)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("OpenDesign Day Completion")
                .accessibilityIdentifier("opendesign.day.completion")
                .allowsHitTesting(false)
        }
    }

    private var messageDraft: String {
        """
        # to: @joopark.dev — Twitter DM
        안녕하세요 주영님, 코워킹에서 몇 번 뵈었어요.
        요즘 "\(label(3))" 쪽에서 또 멈추셨다는 얘기를 봤는데,
        제가 지금 "\(label(2))"를 매일 쓰는 1인 개발자분들의 첫 고객 검증 과정을 정리하고 있어요.

        이번 화요일 11시에 30분 Zoom 가능하세요?
        질문은 3개만 드릴게요:
          1) 지난 7일에 실제로 한 행동이 무엇이었는지
          2) 그때 막힌 정확한 지점은 뭐였는지
          3) 지금 그 문제 해결에 시간이나 돈을 얼마나 쓰고 있는지

        답이 어려우시면 "패스"만 답주셔도 괜찮습니다. — Z
        """
    }

    private var antiIcpAttributedBody: AttributedString {
        let segments: [OpenDesignInlineSegment]
        if draft.isAntiSignal {
            segments = [
                .strong("지난 7일 행동 없음"),
                .body(" 신호가 있어 Day 3 인터뷰 전에 실제 사건을 한 번 더 확인하세요. 박주영이 "),
                .strong("\"언젠가 해볼게요\""),
                .body(" 또는 "),
                .strong("\"좋은 아이디어네요\""),
                .body("로 답하면 후보 교체. "),
                .code("Mom Test"),
                .body(" 기준 그대로."),
            ]
        } else {
            segments = [
                .body("좋은 신호는 "),
                .strong("지난주에 같은 문제로 시간을 쓴 사건"),
                .body("입니다. 박주영이 "),
                .strong("\"언젠가 해볼게요\""),
                .body(" 또는 "),
                .strong("\"좋은 아이디어네요\""),
                .body("로 답하면 후보 교체. "),
                .code("Mom Test"),
                .body(" 기준 그대로."),
            ]
        }
        return openDesignAttributedText(
            segments,
            bodySize: 12.5,
            markColor: OpenDesignDayColor.rose,
            markBackground: OpenDesignDayColor.roseDim,
            codeColor: OpenDesignDayColor.rose
        )
    }

    private var messageDraftAttributed: AttributedString {
        var text = AttributedString(messageDraft)
        text.foregroundColor = OpenDesignDayColor.fgSecondary

        func apply(_ needle: String, color: Color) {
            if let range = text.range(of: needle) {
                text[range].foregroundColor = color
            }
        }

        apply("# to: @joopark.dev — Twitter DM", color: OpenDesignDayColor.mutedDeep)
        apply("안녕하세요 주영님", color: OpenDesignDayColor.accent)
        apply("\"\(label(3))\"", color: OpenDesignDayColor.fg)
        apply("\"\(label(2))\"", color: OpenDesignDayColor.amber)
        apply("30분 Zoom", color: OpenDesignDayColor.amber)
        apply("질문은 3개만", color: OpenDesignDayColor.fg)
        apply("\"패스\"", color: OpenDesignDayColor.mutedDeep)
        return text
    }

    private func copyMessage() {
        copyToPasteboard(messageDraft)
        didCopyMessage = true
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.4) {
            didCopyMessage = false
        }
    }

    private func gateRow(_ id: Int, _ text: String, completedTag: String, pendingTag: String = "대기") -> some View {
        OpenDesignGateRow(
            id: id,
            text: text,
            completedTag: completedTag,
            pendingTag: pendingTag,
            interaction: $interaction
        )
    }

    private func label(_ step: Int) -> String {
        content.selectedLabel(stepID: step, in: interaction)
    }

    private func personFact(_ key: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(key)
                .font(.system(size: 10, weight: .medium, design: .monospaced))
                .textCase(.uppercase)
                .foregroundStyle(OpenDesignDayColor.muted)
            Text(value)
                .font(.system(size: 12, weight: .regular))
                .foregroundStyle(OpenDesignDayColor.fg)
        }
    }

    private var slotData: [(day: String, time: String, duration: String, busy: Bool)] {
        [
            ("Mon 05/18", "10:00", "- 다른 일정", true),
            ("Mon 05/18", "14:00", "30분 · Zoom", false),
            ("Tue 05/19", "11:00", "30분 · Zoom", false),
            ("Tue 05/19", "16:30", "30분 · Zoom", false),
            ("Wed 05/20", "10:00", "30분 · 카페", false),
            ("Wed 05/20", "15:00", "30분 · Zoom", false),
            ("Thu 05/21", "-", "Day 4", true),
            ("Fri 05/22", "-", "Day 5", true),
        ]
    }
}

private struct OpenDesignSlotButton: View {
    let id: Int
    let slot: (day: String, time: String, duration: String, busy: Bool)
    let isSelected: Bool
    let select: () -> Void

    @State private var isHovered = false

    var body: some View {
        Button {
            guard !slot.busy else { return }
            select()
        } label: {
            VStack(alignment: .leading, spacing: 3) {
                Text(slot.day)
                    .font(.system(size: 10, weight: .medium, design: .monospaced))
                    .textCase(.uppercase)
                    .foregroundStyle(isSelected || isHovered ? OpenDesignDayColor.accent : OpenDesignDayColor.muted)
                Text(slot.time)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(OpenDesignDayColor.fg)
                Text(slot.duration)
                    .font(.system(size: 10, weight: .medium, design: .monospaced))
                    .foregroundStyle(isSelected || isHovered ? OpenDesignDayColor.accent : OpenDesignDayColor.mutedDeep)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(10)
            .openDesignHoverRow(
                isHovered: isHovered,
                isActive: isSelected,
                isDisabled: slot.busy,
                cornerRadius: 10,
                fill: OpenDesignDayColor.surface,
                hoverFill: OpenDesignDayColor.hover,
                activeFill: OpenDesignDayColor.accentDim,
                border: OpenDesignDayColor.borderSoft,
                hoverBorder: OpenDesignDayColor.border,
                activeBorder: OpenDesignDayColor.accentLine
            )
            .opacity(slot.busy ? 0.42 : 1)
        }
        .buttonStyle(OpenDesignInteractiveButtonStyle(isDisabled: slot.busy))
        .disabled(slot.busy)
        .onHover { isHovered = $0 }
        .accessibilityValue(slot.busy ? "locked" : isSelected || isHovered ? "active" : "inactive")
        .accessibilityIdentifier("opendesign.day.slot.\(id)")
    }
}

private struct OpenDesignGateRow: View {
    let id: Int
    let text: String
    let completedTag: String
    let pendingTag: String
    @Binding var interaction: OpenDesignDayInteractionState

    @State private var isHovered = false

    private var isDone: Bool {
        interaction.completedGateRows.contains(id)
    }

    private var tag: String {
        interaction.gateTag(id: id, completedTag: completedTag, initialPendingTag: pendingTag)
    }

    var body: some View {
        Button {
            interaction.toggleGateRow(id)
        } label: {
            HStack(spacing: 10) {
                Text(isDone ? "✓" : "")
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(OpenDesignDayColor.bgDeep)
                    .frame(width: 16, height: 16)
                    .background(Circle().fill(isDone ? OpenDesignDayColor.accent : OpenDesignDayColor.bgDeep))
                    .overlay(Circle().stroke(isHovered ? OpenDesignDayColor.borderStrong : OpenDesignDayColor.border, lineWidth: 1))
                Text(text)
                    .font(.system(size: 12.5, weight: .medium))
                    .foregroundStyle(isHovered ? OpenDesignDayColor.fg : OpenDesignDayColor.fgSecondary)
                Spacer(minLength: 0)
                Text(tag)
                    .font(.system(size: 10, weight: .medium, design: .monospaced))
                    .foregroundStyle(isDone ? OpenDesignDayColor.accent : OpenDesignDayColor.muted)
                    .padding(.horizontal, 7)
                    .frame(height: 20)
                    .background(
                        Capsule()
                            .fill(isDone ? OpenDesignDayColor.accentDim : OpenDesignDayColor.bgDarker)
                            .overlay(
                                Capsule()
                                    .stroke(isDone ? OpenDesignDayColor.accentLine : OpenDesignDayColor.borderSoft, lineWidth: 1)
                            )
                    )
            }
            .padding(.vertical, 1)
            .openDesignHoverRow(
                isHovered: isHovered,
                cornerRadius: 6,
                hoverFill: OpenDesignDayColor.hover,
                hoverBorder: Color.clear
            )
        }
        .buttonStyle(OpenDesignInteractiveButtonStyle())
        .onHover { isHovered = $0 }
        .accessibilityValue(isDone || isHovered ? "active" : "inactive")
        .accessibilityIdentifier("opendesign.day.gate.row.\(id)")
    }
}

private struct OpenDesignMetaPanelView: View {
    let content: OpenDesignDayContent
    @Binding var interaction: OpenDesignDayInteractionState

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                Text("Day 1 정보")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(OpenDesignDayColor.fg)

                VStack(alignment: .leading, spacing: 8) {
                    HStack(spacing: 6) {
                        Circle()
                            .fill(OpenDesignDayColor.accent)
                            .frame(width: 6, height: 6)
                        Text("오늘 진척도")
                            .font(.system(size: 10.5, weight: .medium, design: .monospaced))
                            .textCase(.uppercase)
                            .foregroundStyle(OpenDesignDayColor.muted)
                    }
                    HStack(alignment: .firstTextBaseline, spacing: 4) {
                        Text("\(interaction.progressStepCount)")
                            .font(.system(size: 18, weight: .semibold, design: .monospaced))
                            .foregroundStyle(OpenDesignDayColor.fg)
                        Text("/")
                            .font(.system(size: 13, weight: .medium, design: .monospaced))
                            .foregroundStyle(OpenDesignDayColor.mutedDeep)
                        Text("4 STEP")
                            .font(.system(size: 13, weight: .medium, design: .monospaced))
                            .foregroundStyle(OpenDesignDayColor.muted)
                        Spacer()
                        Text("\(interaction.progressPercent)%")
                            .font(.system(size: 10.5, weight: .medium))
                            .foregroundStyle(OpenDesignDayColor.accent)
                    }
                    GeometryReader { proxy in
                        RoundedRectangle(cornerRadius: 2, style: .continuous)
                            .fill(OpenDesignDayColor.bgDeep)
                            .overlay(alignment: .leading) {
                                RoundedRectangle(cornerRadius: 2, style: .continuous)
                                    .fill(OpenDesignDayColor.accent)
                                    .frame(width: proxy.size.width * CGFloat(interaction.progressPercent) / 100)
                            }
                    }
                    .frame(height: 3)
                    Text("● 맥락    ● 미션    \(interaction.allInterviewsSubmitted ? "●" : "○") 인터뷰    \(interaction.allInterviewsSubmitted ? "●" : "○") ICP")
                        .font(.system(size: 10.5, weight: .medium, design: .monospaced))
                        .foregroundStyle(OpenDesignDayColor.muted)
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 12)
                .background(cardBackground(cornerRadius: 10, fill: OpenDesignDayColor.surface))

                VStack(spacing: 1) {
                    metaRow("cube.box", "프로젝트", "agentic30-public")
                    metaRow("point.topleft.down.curvedto.point.bottomright.up", "브랜치", "main", swatch: OpenDesignDayColor.accent)
                    metaRow("person.crop.circle", "사용자", "zettalyst", swatch: OpenDesignDayColor.accent)
                    metaRow("clock", "남은 시간", "29d 14h", swatch: OpenDesignDayColor.amber)
                    metaRow("chart.line.uptrend.xyaxis", "현재 신호", "유저 0 · 매출 0")
                    metaRow("book.closed", "참고 자료", "SPEC.md, ICP.md")
                }
                .padding(.horizontal, -4)
                .padding(.bottom, 8)

                metaTitle("이번 단계")
                VStack(spacing: 0) {
                    ForEach(1...4, id: \.self) { step in
                        followupRow(step: step)
                    }
                }

                metaTitle("참고")
                VStack(spacing: 0) {
                    followupStatic("doc.text", "어제의 인터뷰 transcript", "2026-05-15-zoom.md · 6.7KB · \"검증 없이 5번 빌드\"")
                    followupStatic("exclamationmark.circle", "Anti-ICP 체크리스트", "\"언젠가\" / \"좋네요\" 신호 — 인터뷰 끝나면 발동")
                }

                metaTitle("내일 미리보기")
                HStack(spacing: 12) {
                    Text("02")
                        .font(.system(size: 12, weight: .bold, design: .monospaced))
                        .foregroundStyle(OpenDesignDayColor.muted)
                        .frame(width: 36, height: 36)
                        .background(
                            Circle()
                                .fill(OpenDesignDayColor.bgDarker)
                                .overlay(
                                    Circle()
                                        .stroke(OpenDesignDayColor.borderStrong, style: StrokeStyle(lineWidth: 1, dash: [3, 3]))
                                )
                        )
                    VStack(alignment: .leading, spacing: 2) {
                        Text("시장 신호 읽기")
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(OpenDesignDayColor.fg)
                        Text("Threads + IH 키워드 3개 · 30분")
                            .font(.system(size: 10.5, weight: .medium, design: .monospaced))
                            .foregroundStyle(OpenDesignDayColor.muted)
                    }
                    Spacer()
                    Image(systemName: "chevron.right")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(OpenDesignDayColor.muted)
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 12)
                .background(cardBackground(cornerRadius: 10, fill: OpenDesignDayColor.surface))
                .padding(.bottom, 14)
            }
            .padding(16)
        }
        .background(OpenDesignDayColor.bg)
        .overlay(Rectangle().fill(OpenDesignDayColor.borderSoft).frame(width: 1), alignment: .leading)
        .accessibilityElement(children: .contain)
    }

    private func metaRow(_ systemImage: String, _ key: String, _ value: String, swatch: Color? = nil) -> some View {
        OpenDesignMetaInfoRow(systemImage: systemImage, key: key, value: value, swatch: swatch)
    }

    private func metaTitle(_ text: String) -> some View {
        Text(text)
            .font(.system(size: 10, weight: .medium, design: .monospaced))
            .textCase(.uppercase)
            .foregroundStyle(OpenDesignDayColor.mutedDeep)
            .padding(.top, 4)
    }

    private func followupRow(step: Int) -> some View {
        let titles = [
            1: "인터뷰 1 — 거리",
            2: "인터뷰 2 — 도구",
            3: "인터뷰 3 — 막힌 단계",
            4: "인터뷰 4 — 지난 7일 행동",
        ]
        let locked = [
            2: "잠금 · Cursor / Claude Code / 둘 다 / 비코딩",
            3: "잠금 · 아이디어 / 빌드 / 검증 / 출시",
            4: "잠금 · 새 시작 / 사용자 만남 / 출시 / 멈춤",
        ]
        let done = interaction.submittedSteps.contains(step)
        let active = step == interaction.highestVisibleInterviewStep && !done
        let subtitle = done ? "완료 · 제출됨" : active ? "지금 진행 중 · 4지선다에서 한 명 선택" : locked[step] ?? "지금 진행 중 · 4지선다에서 한 명 선택"
        return followupStatic(
            done ? "checkmark.circle" : active ? "record.circle" : "lock",
            titles[step] ?? "인터뷰",
            subtitle,
            tint: done ? OpenDesignDayColor.accent : active ? OpenDesignDayColor.amber : OpenDesignDayColor.muted,
            usesAccentSubtitle: done
        )
    }

    private func followupStatic(
        _ systemImage: String,
        _ title: String,
        _ subtitle: String,
        tint: Color = OpenDesignDayColor.muted,
        usesAccentSubtitle: Bool = false
    ) -> some View {
        OpenDesignMetaFollowupRow(
            systemImage: systemImage,
            title: title,
            subtitle: subtitle,
            tint: tint,
            usesAccentSubtitle: usesAccentSubtitle
        )
    }
}

private struct OpenDesignMetaInfoRow: View {
    let systemImage: String
    let key: String
    let value: String
    let swatch: Color?

    @State private var isHovered = false

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: systemImage)
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(isHovered ? OpenDesignDayColor.fgSecondary : OpenDesignDayColor.muted)
                .frame(width: 22)
            Text(key)
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(OpenDesignDayColor.muted)
            Spacer(minLength: 8)
            HStack(spacing: 6) {
                if let swatch {
                    Circle()
                        .fill(swatch)
                        .frame(width: 9, height: 9)
                        .overlay(Circle().stroke(swatch, lineWidth: 1))
                }
                Text(value)
                    .lineLimit(1)
            }
            .font(.system(size: 11, weight: .medium, design: .monospaced))
            .foregroundStyle(OpenDesignDayColor.muted)
        }
        .padding(.horizontal, 10)
        .frame(height: 34)
        .openDesignHoverRow(
            isHovered: isHovered,
            cornerRadius: 6,
            hoverFill: OpenDesignDayColor.hover,
            hoverBorder: Color.clear
        )
        .onHover { isHovered = $0 }
        .accessibilityElement(children: .combine)
    }
}

private struct OpenDesignMetaFollowupRow: View {
    let systemImage: String
    let title: String
    let subtitle: String
    let tint: Color
    let usesAccentSubtitle: Bool

    @State private var isHovered = false

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: systemImage)
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(tint)
                .frame(width: 22)
                .padding(.top, 2)
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.system(size: 12.5, weight: .semibold))
                    .foregroundStyle(OpenDesignDayColor.fgSecondary)
                Text(subtitle)
                    .font(.system(size: 10.5, weight: .medium))
                    .foregroundStyle(usesAccentSubtitle ? OpenDesignDayColor.accent : OpenDesignDayColor.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 9)
        .frame(maxWidth: .infinity, alignment: .leading)
        .openDesignHoverRow(
            isHovered: isHovered,
            cornerRadius: 6,
            hoverFill: OpenDesignDayColor.hover,
            hoverBorder: Color.clear
        )
        .onHover { isHovered = $0 }
        .accessibilityElement(children: .combine)
    }
}

private struct OpenDesignSearchTextField: NSViewRepresentable {
    @Binding var text: String
    let placeholder: String
    let focusRequestID: Int

    func makeCoordinator() -> Coordinator {
        Coordinator(parent: self)
    }

    func makeNSView(context: Context) -> OpenDesignNativeSearchField {
        let field = OpenDesignNativeSearchField()
        field.delegate = context.coordinator
        field.stringValue = text
        field.placeholderAttributedString = NSAttributedString(
            string: placeholder,
            attributes: [
                .foregroundColor: Self.placeholderColor,
                .font: Self.font,
            ]
        )
        field.font = Self.font
        field.textColor = Self.foregroundColor
        field.backgroundColor = .clear
        field.drawsBackground = false
        field.isBordered = false
        field.isBezeled = false
        field.focusRingType = .none
        field.lineBreakMode = .byTruncatingTail
        field.cell?.usesSingleLineMode = true
        field.cell?.wraps = false
        field.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        field.setAccessibilityIdentifier("opendesign.day.searchField")
        return field
    }

    func updateNSView(_ nsView: OpenDesignNativeSearchField, context: Context) {
        context.coordinator.parent = self
        if nsView.stringValue != text {
            nsView.stringValue = text
        }
        nsView.wantsPaletteFocus = focusRequestID > 0
        if focusRequestID > 0 {
            nsView.requestPaletteFocus()
        }
    }

    static func dismantleNSView(_ nsView: OpenDesignNativeSearchField, coordinator: Coordinator) {
        nsView.wantsPaletteFocus = false
        nsView.clearPaletteFocusIfNeeded()
    }

    final class Coordinator: NSObject, NSTextFieldDelegate {
        var parent: OpenDesignSearchTextField

        init(parent: OpenDesignSearchTextField) {
            self.parent = parent
        }

        func controlTextDidChange(_ obj: Notification) {
            guard let field = obj.object as? NSTextField else { return }
            parent.text = field.stringValue
        }
    }

    private static let font = NSFont.systemFont(ofSize: 14, weight: .medium)
    private static let foregroundColor = NSColor(red: 0.9410, green: 0.9490, blue: 0.9550, alpha: 1)
    private static let placeholderColor = NSColor(red: 0.4865, green: 0.5055, blue: 0.5198, alpha: 1)
}

private final class OpenDesignNativeSearchField: NSTextField {
    var wantsPaletteFocus = false
    private var focusGeneration = 0

    override var acceptsFirstResponder: Bool {
        true
    }

    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        requestPaletteFocus()
    }

    func requestPaletteFocus() {
        guard wantsPaletteFocus else { return }
        focusGeneration += 1
        let generation = focusGeneration
        let delays: [TimeInterval] = [0, 0.03, 0.12]
        for delay in delays {
            DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self] in
                guard let self,
                      self.focusGeneration == generation,
                      self.wantsPaletteFocus,
                      let window = self.window else {
                    return
                }
                if window.firstResponder !== self.currentEditor() {
                    window.makeFirstResponder(self)
                }
                self.currentEditor()?.selectedRange = NSRange(location: self.stringValue.count, length: 0)
            }
        }
    }

    func clearPaletteFocusIfNeeded() {
        wantsPaletteFocus = false
        focusGeneration += 1
        guard let window,
              window.firstResponder === self || window.firstResponder === currentEditor() else {
            return
        }
        window.makeFirstResponder(nil)
    }
}

private struct OpenDesignSearchPaletteView: View {
    @Binding var query: String
    @Binding var selectedIndex: Int
    let items: [OpenDesignDayContent.SearchItem]
    let activate: (OpenDesignDayContent.SearchItem) -> Void
    let close: () -> Void
    @State private var focusRequestID = 0

    var body: some View {
        ZStack {
            OpenDesignDayColor.bgDarker.opacity(0.68)
                .ignoresSafeArea()
                .background(.ultraThinMaterial)
                .onTapGesture(perform: close)

            VStack(spacing: 0) {
                HStack(spacing: 10) {
                    Image(systemName: "magnifyingglass")
                        .font(.system(size: 14, weight: .medium))
                        .foregroundStyle(OpenDesignDayColor.muted)
                    OpenDesignSearchTextField(
                        text: $query,
                        placeholder: "과제 · 페이지 · 본문 섹션 검색…",
                        focusRequestID: focusRequestID
                    )
                    .frame(height: 24)
                    .onChange(of: query) { _, _ in selectedIndex = firstSelectableIndex }
                    Text("esc")
                        .font(.system(size: 10, weight: .medium, design: .monospaced))
                        .foregroundStyle(OpenDesignDayColor.mutedDeep)
                        .padding(.horizontal, 7)
                        .frame(height: 22)
                        .background(Capsule().fill(OpenDesignDayColor.bgDeep))
                }
                .padding(.horizontal, 14)
                .frame(height: 48)
                .background(OpenDesignDayColor.elevated)
                .overlay(Rectangle().fill(OpenDesignDayColor.borderSoft).frame(height: 1), alignment: .bottom)

                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(alignment: .leading, spacing: 0) {
                            if items.isEmpty {
                                VStack(spacing: 4) {
                                    Text("결과 없음")
                                        .font(.system(size: 13, weight: .medium))
                                        .foregroundStyle(OpenDesignDayColor.fg)
                                    Text("“day 3”, “인터뷰”, “BIP” 같은 키워드를 시도해보세요.")
                                        .font(.system(size: 12.5, weight: .regular))
                                        .foregroundStyle(OpenDesignDayColor.muted)
                                }
                                .frame(maxWidth: .infinity)
                                .padding(.top, 36)
                                .padding(.bottom, 32)
                                .padding(.horizontal, 16)
                            } else {
                                ForEach(OpenDesignDayContent.SearchItem.Kind.displayOrder, id: \.self) { kind in
                                    let grouped = Array(items.enumerated()).filter { $0.element.kind == kind }
                                    if !grouped.isEmpty {
                                        HStack {
                                            Text(kind.title)
                                            Spacer()
                                            Text("\(grouped.count)")
                                        }
                                        .font(.system(size: 10, weight: .medium, design: .monospaced))
                                        .textCase(.uppercase)
                                        .foregroundStyle(OpenDesignDayColor.mutedDeep)
                                        .padding(.horizontal, 12)
                                        .padding(.top, 12)
                                        .padding(.bottom, 5)

                                        ForEach(grouped, id: \.element.id) { indexedItem in
                                            OpenDesignSearchRow(
                                                item: indexedItem.element,
                                                query: query,
                                                isActive: selectedIndex == indexedItem.offset,
                                                activate: { activate(indexedItem.element) },
                                                setActive: { selectedIndex = indexedItem.offset }
                                            )
                                            .id(indexedItem.element.id)
                                        }
                                    }
                                }
                            }
                        }
                        .padding(8)
                    }
                    .frame(maxHeight: 430)
                    .onChange(of: selectedIndex) { _, index in
                        guard items.indices.contains(index) else { return }
                        withAnimation(.easeOut(duration: 0.10)) {
                            proxy.scrollTo(items[index].id, anchor: .center)
                        }
                    }
                }

                HStack(spacing: 14) {
                    HStack(spacing: 5) {
                        searchKeycap("↑")
                        searchKeycap("↓")
                        Text("이동")
                    }
                    HStack(spacing: 5) {
                        searchKeycap("↵")
                        Text("열기")
                    }
                    HStack(spacing: 5) {
                        searchKeycap("esc")
                        Text("닫기")
                    }
                    Spacer()
                    Text("30일 챌린지 인덱스")
                }
                .font(.system(size: 10, weight: .medium, design: .monospaced))
                .foregroundStyle(OpenDesignDayColor.muted)
                .padding(.horizontal, 12)
                .frame(height: 34)
                .background(OpenDesignDayColor.bg)
                .overlay(Rectangle().fill(OpenDesignDayColor.borderSoft).frame(height: 1), alignment: .top)
            }
            .frame(maxWidth: 640)
            .background(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .fill(OpenDesignDayColor.elevated)
                    .shadow(color: .black.opacity(0.42), radius: 24, y: 18)
            )
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(OpenDesignDayColor.borderStrong, lineWidth: 1))
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("opendesign.day.searchPalette")
            .padding(.horizontal, 16)
        }
        .onAppear {
            focusRequestID += 1
            DispatchQueue.main.async {
                focusRequestID += 1
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) {
                focusRequestID += 1
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.18) {
                focusRequestID += 1
            }
        }
    }

    private func searchKeycap(_ text: String) -> some View {
        Text(text)
            .font(.system(size: 9.5, weight: .medium, design: .monospaced))
            .foregroundStyle(OpenDesignDayColor.fgSecondary)
            .padding(.horizontal, 4)
            .frame(minWidth: 16)
            .frame(height: 16)
            .background(
                RoundedRectangle(cornerRadius: 4, style: .continuous)
                    .fill(OpenDesignDayColor.surface)
                    .overlay(RoundedRectangle(cornerRadius: 4, style: .continuous).stroke(OpenDesignDayColor.borderSoft, lineWidth: 1))
            )
    }

    private var firstSelectableIndex: Int {
        0
    }
}

private struct OpenDesignSearchRow: View {
    let item: OpenDesignDayContent.SearchItem
    let query: String
    let isActive: Bool
    let activate: () -> Void
    let setActive: () -> Void

    var body: some View {
        Button(action: activate) {
            HStack(spacing: 12) {
                Image(systemName: item.isLocked ? "lock" : item.systemImage)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(item.isActive || isActive ? OpenDesignDayColor.accent : OpenDesignDayColor.muted)
                    .frame(width: 24, height: 24)
                    .background(RoundedRectangle(cornerRadius: 6, style: .continuous).fill(OpenDesignDayColor.surface))
                    .overlay(RoundedRectangle(cornerRadius: 6, style: .continuous).stroke(OpenDesignDayColor.borderSoft, lineWidth: 1))

                HStack(alignment: .firstTextBaseline, spacing: 9) {
                    highlightedText(item.title, baseColor: OpenDesignDayColor.fg)
                        .font(.system(size: 13, weight: .medium))
                        .lineLimit(1)
                        .accessibilityIdentifier("opendesign.day.search.result.\(item.id)")
                    highlightedText(item.subtitle, baseColor: OpenDesignDayColor.muted)
                        .font(.system(size: 10.5, weight: .medium, design: .monospaced))
                        .lineLimit(1)
                }
                .frame(minWidth: 0, maxWidth: .infinity, alignment: .leading)

                Spacer(minLength: 8)
                if let day = item.day {
                    Text(item.isLocked ? "\(day) · \(item.lockNote ?? "잠금")" : day)
                        .font(.system(size: 10.5, weight: .medium, design: .monospaced))
                        .foregroundStyle(item.isLocked ? OpenDesignDayColor.mutedDeep : OpenDesignDayColor.accent)
                        .lineLimit(1)
                }
            }
            .padding(.horizontal, 10)
            .frame(height: 40)
            .openDesignHoverRow(
                isHovered: isActive,
                isActive: isActive,
                isDisabled: false,
                cornerRadius: 6,
                hoverFill: OpenDesignDayColor.selected,
                activeFill: OpenDesignDayColor.selected,
                hoverBorder: Color.clear,
                activeBorder: Color.clear
            )
            .opacity(item.isLocked ? 0.55 : 1)
            .accessibilityElement(children: .combine)
            .accessibilityLabel("\(item.title) \(item.subtitle) \(item.day ?? "")")
            .accessibilityValue(item.isLocked ? "locked" : isActive ? "active" : "inactive")
            .accessibilityIdentifier("opendesign.day.search.result.\(item.id)")
        }
        .buttonStyle(OpenDesignInteractiveButtonStyle(isDisabled: item.isLocked))
        .onHover { hovering in
            if hovering {
                setActive()
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(item.title) \(item.subtitle) \(item.day ?? "")")
        .accessibilityValue(item.isLocked ? "locked" : isActive ? "active" : "inactive")
        .accessibilityIdentifier("opendesign.day.search.result.\(item.id)")
    }

    private func highlightedText(_ text: String, baseColor: Color) -> Text {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        var highlighted = AttributedString(text)
        highlighted.foregroundColor = baseColor
        if !trimmed.isEmpty,
           let range = highlighted.range(of: trimmed, options: [.caseInsensitive, .diacriticInsensitive]) {
            highlighted[range].foregroundColor = OpenDesignDayColor.accent
        }
        return Text(highlighted)
    }
}

private func guide(title: String, body: String) -> some View {
    VStack(alignment: .leading, spacing: 6) {
        HStack(alignment: .firstTextBaseline, spacing: 7) {
            Text("##")
                .font(.system(size: 17, weight: .medium, design: .monospaced))
                .foregroundStyle(OpenDesignDayColor.accent)
            Text(title)
                .font(.system(size: 22, weight: .semibold))
                .foregroundStyle(OpenDesignDayColor.fg)
        }
        Text(openDesignGuideAttributedText(body))
            .lineSpacing(4)
    }
    .padding(.horizontal, 20)
    .padding(.top, 18)
    .padding(.bottom, 19)
    .background(gradientCardBackground(cornerRadius: 14, colors: [OpenDesignDayColor.surface2, OpenDesignDayColor.surface], stroke: OpenDesignDayColor.borderSoft))
}

private func openDesignGuideAttributedText(_ body: String) -> AttributedString {
    var text = AttributedString(body)
    text.font = .system(size: 14)
    text.foregroundColor = OpenDesignDayColor.fgSecondary

    func apply(_ needle: String, font: Font, color: Color, background: Color? = nil) {
        var searchStart = text.startIndex
        while searchStart < text.endIndex,
              let range = text[searchStart...].range(of: needle) {
            text[range].font = font
            text[range].foregroundColor = color
            if let background {
                text[range].backgroundColor = background
            }
            searchStart = range.upperBound
        }
    }

    for needle in [
        "결론을 쌓지 않고",
        "한 문장으로",
        "실제 연락 가능한 한 사람",
        "30분 슬롯 하나",
        "맥락, 시간 제안, 질문 3개",
        "문서가 예쁜지",
    ] {
        apply(
            needle,
            font: .system(size: 14, weight: .medium),
            color: OpenDesignDayColor.accent,
            background: OpenDesignDayColor.accentDim
        )
    }

    for needle in [
        "docs/ICP.md",
    ] {
        apply(
            needle,
            font: .system(size: 11.5, weight: .medium, design: .monospaced),
            color: OpenDesignDayColor.accent,
            background: OpenDesignDayColor.bgDarker
        )
    }

    for needle in [
        "ICP 한 문장",
        "후보 1명",
        "작은 계약",
        "\"좋네요\"",
        "잡을 수 있는 인터뷰",
        "한 통의 인터뷰 약속",
    ] {
        apply(needle, font: .system(size: 14, weight: .medium), color: OpenDesignDayColor.fg)
    }

    return text
}

private func chip(_ key: String, _ value: String) -> some View {
    VStack(alignment: .leading, spacing: 3) {
        Text(key)
            .font(.system(size: 10, weight: .medium, design: .monospaced))
            .textCase(.uppercase)
            .foregroundStyle(OpenDesignDayColor.muted)
        Text(value)
            .font(.system(size: 11.5, weight: .medium))
            .foregroundStyle(OpenDesignDayColor.fgSecondary)
            .lineLimit(2)
    }
    .padding(10)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(
        RoundedRectangle(cornerRadius: 9, style: .continuous)
            .fill(OpenDesignDayColor.bgDeep)
            .overlay(RoundedRectangle(cornerRadius: 9, style: .continuous).stroke(OpenDesignDayColor.borderSoft, lineWidth: 1))
    )
}

private func openDesignGridColumns(_ count: Int, spacing: CGFloat = 8) -> [GridItem] {
    Array(repeating: GridItem(.flexible(), spacing: spacing), count: count)
}

private func openDesignAccessibilityAnchor(_ identifier: String, label: String) -> some View {
    Color.clear
        .frame(width: 1, height: 1)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(label)
        .accessibilityIdentifier(identifier)
        .allowsHitTesting(false)
}

private func handoffButton(
    label: String,
    hint: String,
    targetIndex: Int,
    currentIndex: Int,
    accessibilityIdentifier: String? = nil,
    action: @escaping () -> Void
) -> some View {
    let isDone = currentIndex >= targetIndex
    return HStack(spacing: 12) {
        Text("다음")
            .font(.system(size: 10.5, weight: .medium, design: .monospaced))
            .foregroundStyle(OpenDesignDayColor.mutedDeep)
        Text(hint)
            .font(.system(size: 12, weight: .regular))
            .foregroundStyle(OpenDesignDayColor.fgSecondary)
        Spacer(minLength: 0)
        OpenDesignHandoffActionButton(
            label: isDone ? "확인 완료 ✓" : label,
            accessibilityIdentifier: accessibilityIdentifier,
            isDisabled: isDone,
            action: action
        )
    }
    .padding(14)
    .background(cardBackground(cornerRadius: 12, fill: OpenDesignDayColor.surface))
}

private struct OpenDesignHandoffActionButton: View {
    let label: String
    var accessibilityIdentifier: String? = nil
    var isDisabled = false
    let action: () -> Void

    @State private var isHovered = false

    var body: some View {
        Button(action: action) {
            Text(isDisabled ? label : "\(label) ↵")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(isDisabled ? OpenDesignDayColor.mutedDeep : OpenDesignDayColor.bgDeep)
                .padding(.horizontal, 16)
                .frame(height: 30)
                .openDesignHoverRow(
                    isHovered: isHovered,
                    isDisabled: isDisabled,
                    cornerRadius: 8,
                    fill: isDisabled ? OpenDesignDayColor.surface2 : OpenDesignDayColor.accent,
                    hoverFill: OpenDesignDayColor.accentStrong,
                    border: isDisabled ? OpenDesignDayColor.borderSoft : Color.clear,
                    hoverBorder: Color.clear
                )
        }
        .buttonStyle(OpenDesignInteractiveButtonStyle(isDisabled: isDisabled))
        .disabled(isDisabled)
        .modifier(OpenDesignReturnShortcutModifier(isEnabled: !isDisabled))
        .onHover { isHovered = $0 }
        .accessibilityLabel(isDisabled ? label : "\(label) ↵")
        .accessibilityValue(isDisabled ? "locked" : isHovered ? "active" : "inactive")
        .accessibilityIdentifier(accessibilityIdentifier ?? "opendesign.day.handoff.next")
    }
}

private struct OpenDesignReturnShortcutModifier: ViewModifier {
    let isEnabled: Bool

    @ViewBuilder
    func body(content: Content) -> some View {
        if isEnabled {
            content.keyboardShortcut(.return, modifiers: [])
        } else {
            content
        }
    }
}

private struct OpenDesignGhostActionButton: View {
    let label: String
    var systemImage: String? = nil
    var isIconOnly = false
    var accessibilityIdentifier: String? = nil
    let action: () -> Void

    @State private var isHovered = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: 5) {
                if let systemImage {
                    Image(systemName: systemImage)
                        .font(.system(size: 11, weight: .semibold))
                }
                if !isIconOnly {
                    Text(label)
                }
            }
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(isHovered ? OpenDesignDayColor.fg : OpenDesignDayColor.fgSecondary)
                .padding(.horizontal, isIconOnly ? 0 : 10)
                .frame(minWidth: 28, minHeight: 28)
                .openDesignHoverRow(
                    isHovered: isHovered,
                    cornerRadius: 8,
                    fill: Color.clear,
                    hoverFill: OpenDesignDayColor.hover,
                    border: OpenDesignDayColor.borderSoft,
                    hoverBorder: OpenDesignDayColor.border
                )
        }
        .buttonStyle(OpenDesignInteractiveButtonStyle())
        .onHover { isHovered = $0 }
        .accessibilityLabel(label)
        .accessibilityValue(isHovered ? "active" : "inactive")
        .accessibilityIdentifier(accessibilityIdentifier ?? label)
    }
}

private struct OpenDesignSearchPulseModifier: ViewModifier {
    let id: String
    let isActive: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func body(content: Content) -> some View {
        content
            .overlay {
                if isActive {
                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .stroke(OpenDesignDayColor.accent.opacity(0.72), lineWidth: 2)
                        .shadow(color: OpenDesignDayColor.accent.opacity(reduceMotion ? 0.18 : 0.36), radius: reduceMotion ? 4 : 10)
                        .padding(-4)
                        .transition(.opacity)
                }
            }
            .overlay(alignment: .topLeading) {
                if isActive {
                    Color.clear
                        .frame(width: 1, height: 1)
                        .accessibilityElement(children: .ignore)
                        .accessibilityLabel("OpenDesign Search Pulse \(id)")
                        .accessibilityIdentifier("opendesign.day.searchPulse.\(id)")
                        .allowsHitTesting(false)
                }
            }
            .animation(.easeOut(duration: reduceMotion ? 0 : 0.16), value: isActive)
    }
}

private extension View {
    func openDesignSearchPulse(id: String, isActive: Bool) -> some View {
        modifier(OpenDesignSearchPulseModifier(id: id, isActive: isActive))
    }
}

private struct OpenDesignCardBackground: View {
    @Environment(\.colorSchemeContrast) private var contrast

    let cornerRadius: CGFloat
    let fill: Color

    var body: some View {
        let usesIncreasedContrast = contrast == .increased
        let stroke = usesIncreasedContrast ? OpenDesignDayColor.border : OpenDesignDayColor.borderSoft
        let lineWidth = OpenDesignAccessibilityMetrics.borderLineWidth(isIncreasedContrast: usesIncreasedContrast)

        RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
            .fill(fill)
            .overlay(
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .stroke(stroke, lineWidth: lineWidth)
            )
    }
}

private struct OpenDesignGradientCardBackground: View {
    @Environment(\.colorSchemeContrast) private var contrast

    let cornerRadius: CGFloat
    let colors: [Color]
    let stroke: Color

    var body: some View {
        let usesIncreasedContrast = contrast == .increased
        let lineWidth = OpenDesignAccessibilityMetrics.borderLineWidth(isIncreasedContrast: usesIncreasedContrast)

        RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
            .fill(LinearGradient(colors: colors, startPoint: .top, endPoint: .bottom))
            .overlay(
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .stroke(stroke, lineWidth: lineWidth)
            )
    }
}

private struct OpenDesignButtonBackground: View {
    @Environment(\.colorSchemeContrast) private var contrast

    let fill: Color

    var body: some View {
        let usesIncreasedContrast = contrast == .increased
        let lineWidth = OpenDesignAccessibilityMetrics.borderLineWidth(isIncreasedContrast: usesIncreasedContrast)
        let stroke = usesIncreasedContrast ? OpenDesignDayColor.border : OpenDesignDayColor.borderSoft

        RoundedRectangle(cornerRadius: 8, style: .continuous)
            .fill(fill)
            .overlay(
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .stroke(stroke, lineWidth: lineWidth)
            )
    }
}

private func cardBackground(cornerRadius: CGFloat, fill: Color) -> some View {
    OpenDesignCardBackground(cornerRadius: cornerRadius, fill: fill)
}

private func gradientCardBackground(cornerRadius: CGFloat, colors: [Color], stroke: Color) -> some View {
    OpenDesignGradientCardBackground(cornerRadius: cornerRadius, colors: colors, stroke: stroke)
}

private func buttonBackground(fill: Color) -> some View {
    OpenDesignButtonBackground(fill: fill)
}

private func copyToPasteboard(_ string: String) {
    let pasteboard = NSPasteboard.general
    pasteboard.clearContents()
    pasteboard.setString(string, forType: .string)
}

private extension Array {
    subscript(safe index: Int) -> Element? {
        indices.contains(index) ? self[index] : nil
    }
}
