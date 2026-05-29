import AppKit
import Combine
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
        let isExpandedByDefault: Bool
        let isLocked: Bool
        let lockNote: String?

        init(
            id: String,
            title: String,
            meta: String,
            tasks: [TaskItem],
            isExpandedByDefault: Bool = true,
            isLocked: Bool = false,
            lockNote: String? = nil
        ) {
            self.id = id
            self.title = title
            self.meta = meta
            self.tasks = tasks
            self.isExpandedByDefault = isExpandedByDefault
            self.isLocked = isLocked
            self.lockNote = lockNote
        }
    }

    struct TaskItem: Identifiable, Hashable {
        let id: String
        let title: String
        let day: String
        let meta: String
        let state: State

        enum State: Hashable {
            case done
            case active
            case pending
            case locked
        }
    }

    struct InterviewStep: Identifiable, Hashable {
        let id: Int
        let dimension: String
        let title: String
        let meta: String
        let label: String
        let score: String
        let statementPrefix: String
        let markedStatement: String
        let statementSuffix: String
        let highlightPhrases: [String]
        let criteria: [String]
        let hintText: String?
        let prompt: String
        let progressLabel: String
        let submitLabel: String
        let options: [InterviewOption]
        let allowsFreeform: Bool
        let freeformLabel: String
        let freeformPlaceholder: String

        init(
            id: Int,
            dimension: String = "",
            title: String,
            meta: String,
            label: String,
            score: String,
            statementPrefix: String,
            markedStatement: String,
            statementSuffix: String,
            highlightPhrases: [String]? = nil,
            criteria: [String],
            hintText: String? = nil,
            prompt: String,
            progressLabel: String,
            submitLabel: String,
            options: [InterviewOption],
            allowsFreeform: Bool = false,
            freeformLabel: String = "직접 입력",
            freeformPlaceholder: String = "한 줄로 입력"
        ) {
            self.id = id
            self.dimension = dimension
            self.title = title
            self.meta = meta
            self.label = label
            self.score = score
            self.statementPrefix = statementPrefix
            self.markedStatement = markedStatement
            self.statementSuffix = statementSuffix
            self.highlightPhrases = Self.normalizedHighlightPhrases(highlightPhrases ?? [])
            self.criteria = criteria
            self.hintText = hintText
            self.prompt = prompt
            self.progressLabel = progressLabel
            self.submitLabel = submitLabel
            self.options = options
            self.allowsFreeform = allowsFreeform
            self.freeformLabel = freeformLabel
            self.freeformPlaceholder = freeformPlaceholder
        }

        static func normalizedHighlightPhrases(_ phrases: [String]) -> [String] {
            var seen: Set<String> = []
            return phrases
                .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
                .filter { !$0.isEmpty }
                .sorted { lhs, rhs in
                    if lhs.count == rhs.count { return lhs < rhs }
                    return lhs.count > rhs.count
                }
                .filter { phrase in
                    let normalized = phrase
                        .lowercased()
                        .replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
                    if seen.contains(normalized) { return false }
                    seen.insert(normalized)
                    return true
                }
        }
    }

    struct InterviewOption: Identifiable, Hashable {
        let id: Int
        let title: String
        let detail: String
        let tail: String
        let isAntiSignal: Bool
        let evidenceLabel: String?
        let evidenceLimited: Bool
        let highlightPhrases: [String]

        init(
            id: Int,
            title: String,
            detail: String,
            tail: String,
            isAntiSignal: Bool = false,
            evidenceLabel: String? = nil,
            evidenceLimited: Bool = false,
            highlightPhrases: [String]? = nil
        ) {
            self.id = id
            self.title = title
            self.detail = detail
            self.tail = tail
            self.isAntiSignal = isAntiSignal
            self.evidenceLabel = evidenceLabel
            self.evidenceLimited = evidenceLimited
            self.highlightPhrases = OpenDesignDayContent.InterviewStep.normalizedHighlightPhrases(highlightPhrases ?? [])
        }
    }

    struct Mission: Hashable {
        let markedTitle: String
        let titleSuffix: String
        let body: String
        let rules: [String]
        let footnote: String
        let acceptLabel: String
        let acceptedLabel: String
    }

    struct Market: Hashable {
        let dayNumber: Int
        let title: String
        let titlebarTitle: String
        let titlebarDetail: String
        let subtitleParts: [String]
        let primaryActionTitle: String
        let sourceTabs: [MarketSourceTab]
        let keywordMeta: String
        let keywords: [MarketKeyword]
        let signalCards: [MarketSignalCard]
        let alternatives: [MarketAlternative]
        let gapHypothesis: MarketGapHypothesis
        let posts: [MarketPost]
        let signalStrength: MarketSignalStrength
        let lockedKeywords: [MarketMiniMetric]
        let topAlternatives: [MarketMiniMetric]
        let nextDay: MarketNextDay
    }

    struct MarketSourceTab: Identifiable, Hashable {
        let id: String
        let title: String
        let count: String
    }

    struct MarketKeyword: Identifiable, Hashable {
        enum Heat: Hashable {
            case hot
            case warm
            case mid
            case cool
            case cold
        }

        let id: String
        let title: String
        let count: String
        let size: CGFloat
        let heat: Heat
    }

    struct MarketSignalCard: Identifiable, Hashable {
        let id: String
        let title: String
        let detail: String
        let value: String
        let unit: String
        let delta: String
        let deltaIsPositive: Bool
        let footerLeft: String
        let footerRight: String
        let sparkline: [CGFloat]
        let tone: OpenDesignReferenceTone
    }

    struct MarketAlternative: Identifiable, Hashable {
        let id: String
        let initials: String
        let name: String
        let kind: String
        let fit: Int
        let strengths: [String]
        let gaps: [String]
        let monthlyCost: String
    }

    struct MarketGapHypothesis: Hashable {
        let label: String
        let segments: [OpenDesignInlineSegment]
        let criteria: [MarketCriterion]
    }

    struct MarketCriterion: Identifiable, Hashable {
        let id: String
        let key: String
        let value: String
    }

    struct MarketPost: Identifiable, Hashable {
        let id: String
        let source: String
        let author: String
        let age: String
        let bodySegments: [OpenDesignInlineSegment]
        let engagement: String
        let comments: String
        let strength: String
        let initials: String
        let tone: OpenDesignReferenceTone
    }

    struct MarketSignalStrength: Hashable {
        let score: String
        let total: String
        let tag: String
        let rows: [MarketScoreRow]
    }

    struct MarketScoreRow: Identifiable, Hashable {
        let id: String
        let title: String
        let fraction: Double
        let value: String
    }

    struct MarketMiniMetric: Identifiable, Hashable {
        let id: String
        let label: String
        let value: String
        let isLeader: Bool
    }

    struct MarketNextDay: Hashable {
        let badge: String
        let title: String
        let subtitle: String
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
    let contextTitle: String
    let contextBody: String
    let mission: Mission
    let interviewSteps: [InterviewStep]
    let searchItems: [SearchItem]
    let plan: Day1IcpPlan?
    var alignmentPlan: Day1AlignmentPlan? = nil
    var market: Market? = nil

    private struct TaskCopy: Hashable {
        let title: String
        let meta: String
    }

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
            contextTitle: contextTitle,
            contextBody: contextBody,
            mission: mission,
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
            },
            plan: plan,
            alignmentPlan: alignmentPlan,
            market: market
        )
    }

    var lockingDaysAfterSecond: OpenDesignDayContent {
        OpenDesignDayContent(
            railItems: railItems,
            taskGroups: taskGroups.map { group in
                TaskGroup(
                    id: group.id,
                    title: group.title,
                    meta: group.meta,
                    tasks: group.tasks.map { task in
                        guard let dayNumber = openDesignFoundationDayNumber(taskID: task.id),
                              dayNumber > 2 else {
                            return task
                        }
                        return TaskItem(
                            id: task.id,
                            title: task.title,
                            day: task.day,
                            meta: task.meta,
                            state: .locked
                        )
                    },
                    isExpandedByDefault: group.isExpandedByDefault,
                    isLocked: group.isLocked,
                    lockNote: group.lockNote
                )
            },
            contextTitle: contextTitle,
            contextBody: contextBody,
            mission: mission,
            interviewSteps: interviewSteps,
            searchItems: searchItems.map { item in
                guard item.kind == .task,
                      let dayNumber = openDesignFoundationDayNumber(taskID: item.id),
                      dayNumber > 2 else {
                    return item
                }
                return SearchItem(
                    id: item.id,
                    kind: item.kind,
                    title: item.title,
                    subtitle: item.subtitle,
                    day: item.day,
                    systemImage: "lock",
                    isActive: false,
                    isLocked: true,
                    lockNote: item.lockNote ?? "준비 중",
                    targetSectionID: nil,
                    route: .inert
                )
            },
            plan: plan,
            alignmentPlan: alignmentPlan,
            market: market
        )
    }

    func applyingFoundationProgress(
        _ snapshot: FoundationProgressSnapshot,
        selectedDay: Int
    ) -> OpenDesignDayContent {
        let overrides = taskCopyOverrides()
        return OpenDesignDayContent(
            railItems: railItems,
            taskGroups: Self.weekTaskGroups(
                snapshot: snapshot,
                selectedDay: selectedDay,
                overrides: overrides
            ),
            contextTitle: contextTitle,
            contextBody: contextBody,
            mission: mission,
            interviewSteps: interviewSteps,
            searchItems: Self.weekSearchItems(
                baseItems: searchItems,
                snapshot: snapshot,
                selectedDay: selectedDay,
                overrides: overrides
            ),
            plan: plan,
            alignmentPlan: alignmentPlan,
            market: market
        )
    }

    private func taskCopyOverrides() -> [Int: TaskCopy] {
        var overrides: [Int: TaskCopy] = [:]
        for task in taskGroups.flatMap(\.tasks) {
            guard let day = openDesignFoundationDayNumber(taskID: task.id) else { continue }
            overrides[day] = TaskCopy(title: task.title, meta: task.meta)
        }
        return overrides
    }

    private struct WeekTaskSpec {
        let id: String
        let title: String
        let week: Int
        let days: ClosedRange<Int>
    }

    private static let taskWeekSpecs: [WeekTaskSpec] = [
        WeekTaskSpec(id: "week1", title: "Week 1 — Foundation", week: 1, days: 1...7),
        WeekTaskSpec(id: "week2", title: "Week 2 — Build", week: 2, days: 8...14),
        WeekTaskSpec(id: "week3", title: "Week 3 — Acquire", week: 3, days: 15...21),
        WeekTaskSpec(id: "week4", title: "Week 4 — Revenue", week: 4, days: 22...30),
    ]

    private static func weekTaskGroups(
        snapshot: FoundationProgressSnapshot,
        selectedDay: Int,
        overrides: [Int: TaskCopy]
    ) -> [TaskGroup] {
        taskWeekSpecs.map { spec in
            let isUnlocked = snapshot.isWeekUnlocked(spec.week)
            return TaskGroup(
                id: spec.id,
                title: spec.title,
                meta: weekMeta(spec: spec, snapshot: snapshot, selectedDay: selectedDay),
                tasks: spec.days.map { day in
                    taskItem(day: day, snapshot: snapshot, selectedDay: selectedDay, overrides: overrides)
                },
                isExpandedByDefault: isUnlocked,
                isLocked: !isUnlocked,
                lockNote: isUnlocked ? nil : unlockNote(forWeek: spec.week)
            )
        }
    }

    private static func weekSearchItems(
        baseItems: [SearchItem],
        snapshot: FoundationProgressSnapshot,
        selectedDay: Int,
        overrides: [Int: TaskCopy]
    ) -> [SearchItem] {
        let taskItems = (1...30).map { day -> SearchItem in
            let state = taskState(day: day, snapshot: snapshot, selectedDay: selectedDay)
            let copy = taskCopy(day: day, overrides: overrides)
            return SearchItem(
                id: "task-day\(day)",
                kind: .task,
                title: copy.title,
                subtitle: copy.meta,
                day: "Day \(day)",
                systemImage: taskSearchSystemImage(for: state),
                isActive: state == .active,
                isLocked: state == .locked,
                lockNote: state == .locked ? unlockNote(forDay: day) : nil,
                targetSectionID: state == .active ? "top" : nil,
                route: state == .active ? .today : .inert
            )
        }
        return taskItems + baseItems.filter { $0.kind != .task }
    }

    private static func weekMeta(
        spec: WeekTaskSpec,
        snapshot: FoundationProgressSnapshot,
        selectedDay: Int
    ) -> String {
        guard snapshot.isWeekUnlocked(spec.week) else {
            return unlockNote(forWeek: spec.week) ?? ""
        }
        let days = Array(spec.days)
        let completedCount = days.filter { snapshot.completedDays.contains($0) }.count
        let selectedOrdinal = days.firstIndex(of: selectedDay).map { $0 + 1 } ?? 0
        return "\(max(completedCount, selectedOrdinal)) / \(days.count)"
    }

    private static func taskItem(
        day: Int,
        snapshot: FoundationProgressSnapshot,
        selectedDay: Int,
        overrides: [Int: TaskCopy]
    ) -> TaskItem {
        let copy = taskCopy(day: day, overrides: overrides)
        return TaskItem(
            id: "day\(day)",
            title: copy.title,
            day: "Day \(day)",
            meta: copy.meta,
            state: taskState(day: day, snapshot: snapshot, selectedDay: selectedDay)
        )
    }

    private static func taskCopy(day: Int, overrides: [Int: TaskCopy]) -> TaskCopy {
        if let override = overrides[day] {
            return override
        }
        if let curriculumDay = AgenticCurriculumDay.days.first(where: { $0.day == day }) {
            return TaskCopy(title: curriculumDay.title, meta: curriculumDay.shortTitle)
        }
        return TaskCopy(title: "Day \(day)", meta: "Task")
    }

    private static func taskState(
        day: Int,
        snapshot: FoundationProgressSnapshot,
        selectedDay: Int
    ) -> TaskItem.State {
        guard snapshot.isUnlocked(day) else { return .locked }
        if snapshot.completedDays.contains(day) { return .done }
        if day == selectedDay { return .active }
        return .pending
    }

    private static func taskSearchSystemImage(for state: TaskItem.State) -> String {
        switch state {
        case .done:
            return "checkmark.circle"
        case .active:
            return "circle.dotted"
        case .pending:
            return "circle"
        case .locked:
            return "lock"
        }
    }

    private static func unlockNote(forDay day: Int) -> String? {
        switch day {
        case 8...14:
            return "D7 해제"
        case 15...21:
            return "D14 해제"
        case 22...30:
            return "D21 해제"
        default:
            return nil
        }
    }

    private static func unlockNote(forWeek week: Int) -> String? {
        switch week {
        case 2:
            return "잠금 해제 D7"
        case 3:
            return "잠금 해제 D14"
        case 4:
            return "잠금 해제 D21"
        default:
            return nil
        }
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
                meta: "잠금 해제 D21",
                tasks: [
                    TaskItem(id: "day22", title: "첫 매출 ask · Pricing", day: "Day 22", meta: "Revenue", state: .locked),
                ]
            ),
        ],
        contextTitle: "오늘은 첫 고객 1명을 정하는 게 목표예요.",
        contextBody: "30일 챌린지의 첫 결과는 \"유저 100명 + 첫 매출\"이지만, Day 1은 그보다 더 좁은 문제부터 풉니다. 이번 주에 진짜로 인터뷰 한 통을 할 만큼 가까운 1명이 누구인지 정하는 것. 이 한 명이 ICP의 후보가 되고, 이번 주 인터뷰·랜딩·웨지의 기준점이 됩니다.",
        mission: Mission(
            markedTitle: "한 명",
            titleSuffix: "만 골라요.",
            body: "다짜고짜 \"ICP가 누구냐\"고 묻는 건 어려우니, 4지선다 → 짧은 인터뷰 3번 → 한 명으로 좁히기 순서로 진행할게요. 다 끝나면 docs/ICP.md에 쓸 문서 초안을 먼저 보여줘요.",
            rules: [
                "이번 주 실제 대화로 이어질 수 있어야 해요.",
                "칭찬형 답이 아니라 진짜 시간을 쓰는 사람이어야 해요 — Mom Test 기준.",
                "한 줄로 묘사할 수 있어야 해요 — \"AI로 빌드하는 사람\"은 너무 넓어요.",
            ],
            footnote: "수락하면 4지선다 인터뷰가 열려요 · 약 3분",
            acceptLabel: "미션 수락하고 인터뷰 시작 ↵",
            acceptedLabel: "미션 수락됨 ✓"
        ),
        interviewSteps: [
            InterviewStep(
                id: 1,
                title: "인터뷰 1 — 거리",
                meta: "3분 · 직감 OK · 바꿀 수 있음",
                label: "질문 · 이 답이 다음 인터뷰 단계를 정합니다",
                score: "1 / 3",
                statementPrefix: "이번 주 안에 ",
                markedStatement: "실제 대화 1번",
                statementSuffix: "으로 이어질 수 있는 1인 개발자 유형은 누구인가요?",
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
                    InterviewOption(id: 4, title: "아무 행동도 안 했다", detail: "계획·고민만 7일을 보냈습니다. 솔직한 답 — Anti-ICP 게이트의 출발점이 됩니다.", tail: "Anti-ICP", isAntiSignal: true),
                ]
            ),
        ],
        searchItems: OpenDesignDayContent.makeSearchItems(),
        plan: nil
    )

    static let day2 = OpenDesignDayContent(
        railItems: [
            RailItem(id: "today", title: "오늘 · Day 2", systemImage: "calendar", isActive: true, hasNewDot: false, route: .today),
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
                meta: "2 / 7",
                tasks: [
                    TaskItem(id: "day1", title: "먼저 도울 사람을 정해요", day: "Day 1", meta: "ICP", state: .done),
                    TaskItem(id: "day2", title: "시장 신호 읽기", day: "Day 2", meta: "Market · +8", state: .active),
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
                meta: "잠금 해제 D21",
                tasks: [
                    TaskItem(id: "day22", title: "첫 매출 ask · Pricing", day: "Day 22", meta: "Revenue", state: .locked),
                ]
            ),
        ],
        contextTitle: "오늘은 Day 1 ICP 후보가 실제 시장 신호를 갖는지 확인합니다.",
        contextBody: "키워드 빈도, 대안 갭, 인용 가능한 게시물을 함께 보고 내일 Mom Test 인터뷰 질문으로 이어질 시장 빈 자리를 잠급니다.",
        mission: Mission(
            markedTitle: "키워드 3개",
            titleSuffix: "를 잠가요.",
            body: "Threads, Indie Hackers, X/Twitter, Reddit, 블로그 RSS에서 지난 30일의 신호를 훑고 \"이게 팔릴까\" 단계의 반복 표현과 현재 대안을 비교합니다.",
            rules: [
                "키워드 3개는 Day 3 질문의 기준으로 이어져야 합니다.",
                "대안은 무료/강의/커뮤니티/도구를 섞어 실제 선택지를 봅니다.",
                "강한 인용은 원문 뉘앙스를 보존해 인터뷰 질문으로 바꿉니다.",
            ],
            footnote: "Day 2 마무리 시 Day 3 Mom Test 인터뷰로 이동",
            acceptLabel: "시장 신호 보기",
            acceptedLabel: "시장 신호 확인됨"
        ),
        interviewSteps: [],
        searchItems: OpenDesignDayContent.makeMarketSearchItems(),
        plan: nil,
        market: Market(
            dayNumber: 2,
            title: "시장 신호 읽기",
            titlebarTitle: "Day 2 · Foundation",
            titlebarDetail: "Market Signals",
            subtitleParts: ["Market · Day 2", "키워드 3개 잠금", "크롤 12분 전 갱신"],
            primaryActionTitle: "Day 2 마무리",
            sourceTabs: [
                MarketSourceTab(id: "threads", title: "Threads", count: "142"),
                MarketSourceTab(id: "indie", title: "Indie Hackers", count: "31"),
                MarketSourceTab(id: "x", title: "X / Twitter", count: "88"),
                MarketSourceTab(id: "reddit", title: "Reddit", count: "17"),
                MarketSourceTab(id: "rss", title: "블로그·RSS", count: "9"),
            ],
            keywordMeta: "총 287 멘션 · 12회 / 시간",
            keywords: [
                MarketKeyword(id: "sell", title: "팔릴까", count: "68", size: 32, heat: .hot),
                MarketKeyword(id: "validate", title: "검증", count: "54", size: 28, heat: .hot),
                MarketKeyword(id: "drift", title: "표류", count: "42", size: 24, heat: .warm),
                MarketKeyword(id: "rewrite", title: "또 갈아엎음", count: "31", size: 22, heat: .warm),
                MarketKeyword(id: "agent-code", title: "에이전트 코딩", count: "26", size: 18, heat: .mid),
                MarketKeyword(id: "monetize", title: "수익화", count: "24", size: 18, heat: .mid),
                MarketKeyword(id: "landing-copy", title: "랜딩 카피", count: "19", size: 16, heat: .mid),
                MarketKeyword(id: "burnout", title: "번아웃", count: "18", size: 16, heat: .mid),
                MarketKeyword(id: "macos", title: "macOS · M3", count: "14", size: 15, heat: .cool),
                MarketKeyword(id: "claude", title: "Claude Code", count: "14", size: 15, heat: .cool),
                MarketKeyword(id: "pmf", title: "PMF", count: "12", size: 14, heat: .cool),
                MarketKeyword(id: "interview", title: "고객 인터뷰", count: "12", size: 14, heat: .cool),
                MarketKeyword(id: "funding", title: "투자", count: "9", size: 13, heat: .cold),
                MarketKeyword(id: "saas-template", title: "SaaS 템플릿", count: "7", size: 13, heat: .cold),
                MarketKeyword(id: "team", title: "팀빌딩", count: "5", size: 13, heat: .cold),
            ],
            signalCards: [
                MarketSignalCard(id: "threads", title: "Threads", detail: "/agent30", value: "142", unit: "/30일", delta: "▲ 2.3×", deltaIsPositive: true, footerLeft: "대화율 31%", footerRight: "+47 신규", sparkline: [0.88, 0.75, 0.68, 0.50, 0.56, 0.38, 0.31, 0.28, 0.19, 0.22, 0.10, 0.03], tone: .accent),
                MarketSignalCard(id: "indie", title: "Indie Hackers", detail: "#solo", value: "31", unit: "/30일", delta: "▲ 1.4×", deltaIsPositive: true, footerLeft: "업보트 92", footerRight: "장문 비율 64%", sparkline: [0.81, 0.69, 0.75, 0.63, 0.50, 0.56, 0.44, 0.38, 0.47, 0.34, 0.28, 0.22], tone: .violet),
                MarketSignalCard(id: "x", title: "X / Twitter", detail: "한국어", value: "88", unit: "/30일", delta: "▼ 0.8×", deltaIsPositive: false, footerLeft: "RT 비율 71%", footerRight: "독자형 ↓", sparkline: [0.16, 0.28, 0.22, 0.41, 0.34, 0.53, 0.47, 0.59, 0.56, 0.66, 0.59, 0.78], tone: .sky),
            ],
            alternatives: [
                MarketAlternative(id: "ph", initials: "PH", name: "Product Hunt 런칭", kind: "1회성", fit: 22, strengths: ["큰 노출", "PR"], gaps: ["검증 X", "1회성"], monthlyCost: "$0"),
                MarketAlternative(id: "lean", initials: "LE", name: "Lean Canvas + 멘토링", kind: "온라인 코스", fit: 48, strengths: ["프레임워크", "동료"], gaps: ["실행 미흡"], monthlyCost: "$49"),
                MarketAlternative(id: "mom", initials: "MT", name: "Mom Test 책 + 노션", kind: "스스로", fit: 54, strengths: ["질문 품질"], gaps: ["혼자 함", "강제 X"], monthlyCost: "$15"),
                MarketAlternative(id: "ih", initials: "IH", name: "Indie Hackers 그룹", kind: "커뮤니티", fit: 42, strengths: ["동료 압력"], gaps: ["한국 X", "시차"], monthlyCost: "$0"),
                MarketAlternative(id: "cc", initials: "CC", name: "Claude Code · Cursor", kind: "도구", fit: 18, strengths: ["빌드 속도"], gaps: ["고객 X", "검증 X"], monthlyCost: "$60"),
                MarketAlternative(id: "yc", initials: "YC", name: "YC Startup School", kind: "강의·과제", fit: 62, strengths: ["강제 과제"], gaps: ["영어", "팀 가정"], monthlyCost: "$0"),
                MarketAlternative(id: "dv", initials: "DV", name: "데브 유튜브 강의", kind: "구독", fit: 14, strengths: ["싸다"], gaps: ["시청만"], monthlyCost: "$10"),
            ],
            gapHypothesis: MarketGapHypothesis(
                label: "시장 빈 자리 — 가설",
                segments: [
                    .body("전업 1인 개발자에게는 "),
                    .strong("한국어 + 30일 강제 과제 + 매일 인터뷰 1건"),
                    .body("이 합쳐진 도구가 없다. 가장 가까운 대안 YC Startup School은 영어·팀 가정·일간 리듬 부재. "),
                    .mark("Mom Test 책 + 일일 캐리"),
                    .body("를 한 묶음으로 묶으면 1인 솔로 시장의 정중앙이 비어 있다."),
                ],
                criteria: [
                    MarketCriterion(id: "best", key: "최고 매칭률", value: "62% (YC)"),
                    MarketCriterion(id: "gap", key: "남은 갭", value: "38%p"),
                    MarketCriterion(id: "kr", key: "한국어 시장", value: "0개 대안"),
                    MarketCriterion(id: "arpu", key: "월 ARPU 추정", value: "$19-29"),
                ]
            ),
            posts: [
                MarketPost(id: "kn", source: "Threads", author: "@knot.indie", age: "3일 전", bodySegments: [.body("\"새 프로젝트만 4번째인데, 이번에도 "), .mark("'팔릴까?'"), .body(" 단계에서 또 닫음. 검증을 누가 시켜줬으면 좋겠다.\"")], engagement: "▲ 142", comments: "댓글 38", strength: "신호 강", initials: "@kn", tone: .accent),
                MarketPost(id: "jay", source: "Indie Hackers", author: "jay.solo", age: "1주 전", bodySegments: [.body("\"YC Startup School은 좋은데 팀 가정이 너무 강해서, "), .mark("전업 1인"), .body("한테는 안 맞음. 일간 과제만 똑같이 받고 싶다.\"")], engagement: "▲ 92", comments: "댓글 24", strength: "신호 강", initials: "jay", tone: .violet),
                MarketPost(id: "hy", source: "Threads", author: "@hyemin.dev", age: "5일 전", bodySegments: [.body("\"퇴사하고 5개월. "), .mark("수익 0원"), .body("인 동료 모아 인터뷰 강제 챌린지 같이 해보고 싶음. 한국어로.\"")], engagement: "▲ 78", comments: "댓글 31", strength: "신호 강", initials: "@hy", tone: .accent),
                MarketPost(id: "cm", source: "X / Twitter", author: "@cmoon.indie", age: "4일 전", bodySegments: [.body("\"Mom Test 책 5번 읽었는데 혼자 하면 결국 변명함. "), .mark("30분 매일 강제"), .body("되는 환경이 필요해.\"")], engagement: "▲ 64", comments: "댓글 18", strength: "신호 강", initials: "@cm", tone: .sky),
                MarketPost(id: "yj", source: "Threads", author: "@yujin.makes", age: "2일 전", bodySegments: [.body("\"AI 코딩으로 새 프로젝트 시작은 3시간이면 됨. 근데 거기서 끝남. 다음 단계 가는 동료가 필요함.\"")], engagement: "▲ 51", comments: "댓글 14", strength: "신호 중", initials: "@yj", tone: .accent),
            ],
            signalStrength: MarketSignalStrength(
                score: "7.4",
                total: "/ 10",
                tag: "PASS",
                rows: [
                    MarketScoreRow(id: "keyword", title: "키워드 빈도", fraction: 0.84, value: "8.4"),
                    MarketScoreRow(id: "gap", title: "대안 갭", fraction: 0.78, value: "7.8"),
                    MarketScoreRow(id: "korean", title: "한국어 시장", fraction: 0.92, value: "9.2"),
                    MarketScoreRow(id: "wedge", title: "웨지 신호", fraction: 0.54, value: "5.4"),
                    MarketScoreRow(id: "pricing", title: "가격대 명확", fraction: 0.62, value: "6.2"),
                ]
            ),
            lockedKeywords: [
                MarketMiniMetric(id: "sell", label: "팔릴까", value: "23.7%", isLeader: true),
                MarketMiniMetric(id: "validate", label: "검증", value: "18.8%", isLeader: false),
                MarketMiniMetric(id: "drift", label: "표류", value: "14.6%", isLeader: false),
            ],
            topAlternatives: [
                MarketMiniMetric(id: "yc", label: "YC Startup School", value: "62%", isLeader: true),
                MarketMiniMetric(id: "mom", label: "Mom Test 책", value: "54%", isLeader: false),
                MarketMiniMetric(id: "lean", label: "Lean Canvas 멘토링", value: "48%", isLeader: false),
                MarketMiniMetric(id: "ih", label: "IH 그룹", value: "42%", isLeader: false),
                MarketMiniMetric(id: "ph", label: "PH 런칭", value: "22%", isLeader: false),
            ],
            nextDay: MarketNextDay(badge: "03", title: "Mom Test 인터뷰 ×3", subtitle: "박주영 + 2명 후보 · 질문 5개")
        )
    )

    static func personalized(from plan: Day1IcpPlan?) -> OpenDesignDayContent {
        personalized(from: nil, fallback: plan)
    }

    static func personalizedIfAvailable(from plan: Day1IcpPlan?) -> OpenDesignDayContent? {
        personalizedIfAvailable(from: nil, fallback: plan)
    }

    static func personalizedIfAvailable(
        from alignmentPlan: Day1AlignmentPlan?,
        fallback fallbackPlan: Day1IcpPlan?
    ) -> OpenDesignDayContent? {
        personalizedContent(from: alignmentPlan, fallback: fallbackPlan)
    }

    static func personalized(
        from alignmentPlan: Day1AlignmentPlan?,
        fallback fallbackPlan: Day1IcpPlan?
    ) -> OpenDesignDayContent {
        personalizedContent(from: alignmentPlan, fallback: fallbackPlan) ?? .day1
    }

    private static func personalizedContent(
        from alignmentPlan: Day1AlignmentPlan?,
        fallback fallbackPlan: Day1IcpPlan?
    ) -> OpenDesignDayContent? {
        let plan: Day1IcpPlan?
        if let alignmentPlan {
            plan = compatibilityPlan(from: alignmentPlan)
        } else {
            plan = fallbackPlan
        }

        guard let plan,
              (3...5).contains(plan.questions.count)
        else {
            return nil
        }

        let steps = interviewSteps(from: plan)
        let productName = cleanNonEmpty(plan.signals.productName) ?? "이 프로젝트"
        let problem = cleanNonEmpty(plan.signals.problem) ?? "scan에서 보이는 핵심 문제"
        let target = cleanNonEmpty(plan.signals.currentIcpGuess) ?? "잠재 고객"
        let isAlignment = alignmentPlan != nil

        return OpenDesignDayContent(
            railItems: day1.railItems,
            taskGroups: day1.taskGroups.map { group in
                TaskGroup(
                    id: group.id,
                    title: group.title,
                    meta: group.meta,
                    tasks: group.tasks.map { task in
                        guard task.id == "day1" else { return task }
                        return TaskItem(
                            id: task.id,
                            title: isAlignment ? "30일 목표와 방향을 정해요" : "ICP v0 질문을 정해요",
                            day: task.day,
                            meta: isAlignment ? "가설 · 목표+3요소" : "ICP · adaptive \(steps.count)Q",
                            state: task.state
                        )
                    }
                )
            },
            contextTitle: isAlignment
                ? "\(productName)의 핵심 가설"
                : "\(productName)의 ICP v0",
            contextBody: isAlignment
                ? "목표·고객·문제·검증 행동을 한 문장으로 맞춥니다."
                : "\(target) 가설을 \(problem) 기준으로 좁힙니다.",
            mission: Mission(
                markedTitle: isAlignment ? "핵심 가설" : "ICP v0",
                titleSuffix: isAlignment ? "을 Day 2에 넘길 만큼 선명하게 만들어요." : "를 검증 가능하게 좁혀요.",
                body: alignmentPlan?.mission ?? plan.mission,
                rules: [
                    isAlignment ? "목표·고객·문제·행동을 분리합니다." : "need / have / don't need를 분리합니다.",
                    isAlignment ? "다음 검증 기준이 문장 안에 있어야 합니다." : "현재 대안, 반복 행동, 비용 신호를 우선합니다.",
                    isAlignment ? "마지막에 품질 점수를 확인합니다." : "마지막에 docs/ICP.md와 Anti-ICP를 확인합니다.",
                ],
                footnote: isAlignment
                    ? "질문 \(steps.count)개 · 약 3분"
                    : "수락하면 scan 기반 adaptive 질문 \(steps.count)개가 열려요 · 약 3분",
                acceptLabel: isAlignment ? "미션 수락하고 핵심 가설 시작 ↵" : "미션 수락하고 ICP 질문 시작 ↵",
                acceptedLabel: "미션 수락됨 ✓"
            ),
            interviewSteps: steps,
            searchItems: makePersonalizedSearchItems(plan: plan, steps: steps),
            plan: plan,
            alignmentPlan: alignmentPlan
        )
    }

    private static func compatibilityPlan(from alignmentPlan: Day1AlignmentPlan) -> Day1IcpPlan {
        let components = [
            alignmentPlan.components.icp,
            alignmentPlan.components.painPoint,
            alignmentPlan.components.outcome,
        ]
        let questions = components.map { component in
            Day1IcpQuestion(
                id: "alignment_\(component.id)",
                dimension: component.id,
                title: alignmentComponentDisplayTitle(component),
                prompt: alignmentQuestionPrompt(for: component),
                highlightPhrases: component.highlightPhrases,
                helperText: compactAlignmentHelperText(component),
                options: component.options.map(safeAlignmentQuestionOption),
                allowFreeText: true,
                freeTextPlaceholder: "직접 입력"
            )
        }

        return Day1IcpPlan(
            schemaVersion: alignmentPlan.schemaVersion,
            source: alignmentPlan.source,
            generatedAt: alignmentPlan.generatedAt,
            confidence: alignmentPlan.confidence,
            fellBackToDeterministic: alignmentPlan.fellBackToDeterministic,
            mission: alignmentPlan.mission,
            signals: alignmentPlan.signals,
            questions: questions,
            icpDraft: IcpDraft(
                description: alignmentPlan.alignmentStatement.icp,
                criteria: [
                    "목표: \(alignmentPlan.projectGoal)",
                    "문제: \(alignmentPlan.alignmentStatement.painPoint)",
                    "확인할 행동: \(alignmentPlan.alignmentStatement.outcome)",
                ],
                whyTheyMatter: [
                    "Day 2 시장 신호는 이 핵심 가설을 기준으로 검증합니다.",
                    "목표, 고객, 문제, 확인할 행동이 분리되어야 Day 3 질문이 흔들리지 않습니다.",
                ],
                needs: [alignmentPlan.alignmentStatement.painPoint],
                haves: alignmentPlan.signals.currentAlternatives,
                dontNeeds: alignmentPlan.components.icp.options.filter { $0.antiSignal == true }.map(\.label),
                evidence: alignmentPlan.signals.evidenceRefs.map { "\($0.path): \($0.reason ?? "workspace evidence")" },
                referenceCustomersToFind: alignmentPlan.components.icp.options.map(\.label).prefix(3).map { String($0) }
            ),
            antiIcp: Day1AntiIcp(
                summary: alignmentPlan.qualityGate.failGate,
                rules: alignmentAntiRules(from: alignmentPlan),
                politeInterestGuardrails: ["Day 2에서 유료 대체재, 반복 표현, 반증 신호를 확인합니다."]
            ),
            firstInterviewMessage: alignmentPlan.firstInterviewMessage
        )
    }

    nonisolated private static func alignmentQuestionPrompt(for component: Day1AlignmentComponent) -> String {
        switch component.id {
        case "icp":
            return "이번 주 실제로 연락해 확인할 첫 고객 후보는 누구인가요?"
        case "pain_point":
            return "선택한 고객이 지금 가장 비용을 치르는 문제는 무엇인가요?"
        case "outcome":
            return "선택한 문제가 진짜인지 이번 주 대화에서 어떤 행동 신호로 확인할까요?"
        default:
            return safeAlignmentQuestionCopy(component.prompt) ?? component.prompt
        }
    }

    nonisolated private static func alignmentComponentDisplayTitle(_ component: Day1AlignmentComponent) -> String {
        switch component.id {
        case "icp": return "고객"
        case "pain_point": return "문제"
        case "outcome": return "확인할 행동"
        default: return safeAlignmentQuestionCopy(component.title) ?? component.title
        }
    }

    nonisolated private static func compactAlignmentHelperText(_ component: Day1AlignmentComponent) -> String? {
        guard let helperText = safeAlignmentQuestionCopy(component.helperText) else { return nil }
        if helperText == alignmentComponentDisplayTitle(component) {
            return nil
        }

        switch component.id {
        case "icp", "pain_point", "outcome":
            return nil
        default:
            return helperText
        }
    }

    nonisolated private static func safeAlignmentQuestionOption(_ option: Day1IcpQuestionOption) -> Day1IcpQuestionOption {
        let preview = safeAlignmentQuestionCopy(option.preview)
        return Day1IcpQuestionOption(
            id: option.id,
            label: compactAlignmentOptionLabel(option.label),
            description: compactAlignmentOptionDescription(option, preview: preview),
            highlightPhrases: option.highlightPhrases,
            preview: preview,
            antiSignal: option.antiSignal,
            evidenceLabel: option.evidenceLabel,
            evidenceLimited: option.evidenceLimited
        )
    }

    nonisolated private static func compactAlignmentOptionLabel(_ value: String) -> String {
        let text = safeAlignmentQuestionCopy(value) ?? value
        if text.hasPrefix("직접 입력:") {
            return "직접 입력"
        }
        if text.hasPrefix("추가 scan 필요") {
            return "scan 필요"
        }
        return text
    }

    nonisolated private static func compactAlignmentOptionDescription(
        _ option: Day1IcpQuestionOption,
        preview: String?
    ) -> String {
        if option.evidenceLimited == true {
            if option.label.lowercased().contains("scan") {
                return "근거 부족. 직접 입력으로 보정하세요."
            }
            if option.antiSignal == true {
                return "최근 행동·비용 신호 없음."
            }
            return "근거 부족. 한 줄로 보정하세요."
        }

        return compactOptionDescription(
            option.description,
            optionLabel: option.label,
            preview: preview
        )
    }

    nonisolated private static func safeAlignmentQuestionCopy(_ value: String?) -> String? {
        guard var text = cleanNonEmpty(value) else { return nil }
        let replacements = [
            ("Project Goal", "목표"),
            ("Pain Point", "문제"),
            ("Outcome", "확인할 행동"),
            ("ICP", "고객"),
            ("Day 2에서 바로 검증할 수 있습니다.", "다음 시장 신호 확인에서 바로 검증할 수 있습니다."),
            ("Day 2 시장 신호가 확인해야 할", "다음 시장 신호 확인에서 볼"),
            ("Day 2가 확인할", "다음 검증에서 확인할"),
            ("Day 2 시장 신호", "다음 시장 신호"),
            ("Day 2 신호", "다음 시장 신호"),
            ("Day 2 기준", "다음 검증 기준"),
            ("Day 2에서", "다음 검증에서"),
            ("Day 2로", "다음 검증으로"),
            ("Day2에서", "다음 검증에서"),
            ("Day2로", "다음 검증으로"),
            ("Day2", "다음 검증"),
        ]
        for (old, new) in replacements {
            text = text.replacingOccurrences(of: old, with: new)
        }
        text = text.replacingOccurrences(
            of: #"Day\s*2"#,
            with: "다음 검증",
            options: [.regularExpression, .caseInsensitive]
        )
        return cleanNonEmpty(text)
    }

    nonisolated private static func stripEvidenceSuffix(_ value: String) -> String {
        value
            .replacingOccurrences(of: #"근거\s*부족[:：]?\s*"#, with: "", options: .regularExpression)
            .components(separatedBy: "· 근거:")
            .first?
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? value
    }

    nonisolated private static func compactOptionDescription(
        _ value: String,
        optionLabel: String? = nil,
        preview: String?
    ) -> String {
        let previewText = safeAlignmentQuestionCopy(preview)
        let text = compactOptionDescriptionText(value)
        guard !text.isEmpty else { return "" }
        guard !isGenericOptionDescription(text, optionLabel: optionLabel, preview: previewText) else { return "" }
        return compactDisplayText(text, max: 54)
    }

    nonisolated private static func compactOptionDescriptionText(_ value: String) -> String {
        let safeText = safeAlignmentQuestionCopy(value) ?? value
        let stripped = stripEvidenceSuffix(safeText)
        let rewritten = rewriteStageMetaOptionDescription(stripped)
        return rewritten
            .replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    nonisolated private static func rewriteStageMetaOptionDescription(_ value: String) -> String {
        let normalized = normalizedOptionDescription(value)
        if normalized.contains("다음시장신호") || normalized.contains("다음검증") {
            return ""
        }
        return value
    }

    nonisolated private static func isGenericOptionDescription(
        _ value: String,
        optionLabel: String?,
        preview: String?
    ) -> Bool {
        let normalized = normalizedOptionDescription(value)
        let genericValues: Set<String> = [
            "이번주대화가능",
            "이번주직접대화가능한사용자입니다",
            "바로대화가능한조건",
            "시간돈리스크비용",
            "사건대안지불의향확인",
            "이번주대화에서확인합니다",
        ]
        if genericValues.contains(normalized) { return true }

        let hasLabelPrefix: Bool
        if let optionLabel {
            let normalizedLabel = normalizedOptionDescription(optionLabel)
            hasLabelPrefix = !normalizedLabel.isEmpty && normalized.hasPrefix(normalizedLabel)
        } else {
            hasLabelPrefix = false
        }

        switch preview {
        case "고객", "ICP":
            return normalized.contains("이번주실제대화가능한고객인지확인")
                || normalized.contains("이번주대화가능한고객인지확인")
                || (hasLabelPrefix && normalized.contains("후보가이번주"))
        case "문제", "Pain":
            return normalized.contains("시간돈리스크비용으로반복되는지확인")
                || (hasLabelPrefix && normalized.contains("문제가시간돈리스크"))
        case "확인할 행동", "Outcome":
            return normalized.contains("최근사건현재대안지불의향같은행동으로확인")
                || (hasLabelPrefix && normalized.contains("신호를최근사건현재대안지불의향"))
        default:
            return false
        }
    }

    nonisolated private static func normalizedOptionDescription(_ value: String) -> String {
        value
            .lowercased()
            .replacingOccurrences(of: #"[\s·•.,!?'"“”‘’"()/\-_]+"#, with: "", options: .regularExpression)
    }

    nonisolated private static func compactDisplayText(_ value: String, max: Int) -> String {
        let text = value
            .replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard text.count > max else { return text }
        return String(text.prefix(max - 1)).trimmingCharacters(in: .whitespacesAndNewlines) + "…"
    }

    private static func alignmentAntiRules(from alignmentPlan: Day1AlignmentPlan) -> [AntiIcpRule] {
        let failedRules = alignmentPlan.qualityGate.criteria.filter { !$0.passed }.map {
            AntiIcpRule(id: $0.id, label: $0.label, reason: $0.detail, evidenceRef: nil)
        }
        if !failedRules.isEmpty {
            return failedRules
        }
        return [
            AntiIcpRule(
                id: "quality_gate",
                label: "품질 게이트 기준",
                reason: alignmentPlan.qualityGate.failGate,
                evidenceRef: nil
            )
        ]
    }

    private static func interviewSteps(from plan: Day1IcpPlan) -> [InterviewStep] {
        let total = min(max(plan.questions.count, 3), 5)
        return plan.questions.prefix(total).enumerated().map { index, question in
            let stepID = index + 1
            let dimensionTitle = dimensionDisplayName(question.dimension)
            let allowsFreeform = question.allowFreeText ?? true
            let visibleOptions = question.options.filter {
                !isDuplicateFreeformOption($0, allowsFreeform: allowsFreeform)
            }
            return InterviewStep(
                id: stepID,
                dimension: question.dimension,
                title: "질문 \(stepID) — \(dimensionTitle)",
                meta: "adaptive · \(dimensionTitle)",
                label: "질문 · 프로젝트 scan 기반",
                score: "\(stepID) / \(total)",
                statementPrefix: "",
                markedStatement: question.prompt,
                statementSuffix: "",
                highlightPhrases: question.highlightPhrases ?? [],
                criteria: [],
                hintText: question.helperText,
                prompt: question.title,
                progressLabel: dimensionTitle,
                submitLabel: "이 답으로 제출",
                options: visibleOptions.enumerated().map { optionIndex, option in
                    let evidenceLabel = cleanNonEmpty(option.evidenceLabel)
                    let tailText: String
                    if option.evidenceLimited == true {
                        tailText = "근거 부족"
                    } else if let evidenceLabel {
                        tailText = evidenceLabel.replacingOccurrences(of: "근거: ", with: "")
                    } else {
                        tailText = option.preview ?? dimensionTitle
                    }
                    return InterviewOption(
                        id: optionIndex + 1,
                        title: option.label,
                        detail: compactQuestionOptionDescription(
                            option.description,
                            optionLabel: option.label,
                            preview: option.preview,
                            evidenceLimited: option.evidenceLimited == true
                        ),
                        tail: shortTail(tailText),
                        isAntiSignal: option.antiSignal == true,
                        evidenceLabel: evidenceLabel,
                        evidenceLimited: option.evidenceLimited == true,
                        highlightPhrases: option.highlightPhrases ?? []
                    )
                },
                allowsFreeform: allowsFreeform,
                freeformLabel: "직접 입력",
                freeformPlaceholder: question.freeTextPlaceholder ?? "한 줄로 입력"
            )
        }
    }

    private static func isDuplicateFreeformOption(
        _ option: Day1IcpQuestionOption,
        allowsFreeform: Bool
    ) -> Bool {
        guard allowsFreeform else { return false }
        let label = option.label.trimmingCharacters(in: .whitespacesAndNewlines)
        return label == "직접 입력" || label.hasPrefix("직접 입력:")
    }

    private static func compactQuestionOptionDescription(
        _ value: String,
        optionLabel: String,
        preview: String?,
        evidenceLimited: Bool
    ) -> String {
        if evidenceLimited {
            return "근거 부족. 한 줄로 보정하세요."
        }
        return compactOptionDescription(value, optionLabel: optionLabel, preview: preview)
    }

    static func dimensionDisplayName(_ dimension: String) -> String {
        switch dimension {
        case "icp": return "고객"
        case "pain_point": return "문제"
        case "outcome": return "확인할 행동"
        case "must_have": return "Must-have"
        case "core_need": return "Core need"
        case "current_alternative": return "현재 대안"
        case "buyer_user": return "사용자/구매자"
        case "activation_or_success_signal": return "성공 신호"
        case "willingness_to_pay": return "지불 의향"
        case "bad_fit_boundary": return "Anti-ICP"
        case "reference_customer": return "Reference customer"
        default: return "ICP 조건"
        }
    }

    private static func shortTail(_ value: String) -> String {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.count > 14 else { return trimmed }
        return String(trimmed.prefix(13)) + "…"
    }

    nonisolated private static func cleanNonEmpty(_ value: String?) -> String? {
        let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return trimmed.isEmpty ? nil : trimmed
    }

    static func makeSearchItems() -> [SearchItem] {
        [
            SearchItem(id: "page-today", kind: .page, title: "오늘 · Day 1", subtitle: "ICP 좁히기", day: nil, systemImage: "scope", isActive: true, isLocked: false, lockNote: nil, targetSectionID: "top", route: .today),
            SearchItem(id: "page-search", kind: .page, title: "검색", subtitle: "전체 페이지 · 과제 찾기", day: nil, systemImage: "magnifyingglass", isActive: false, isLocked: false, lockNote: nil, targetSectionID: nil, route: .search),
            SearchItem(id: "page-projects", kind: .page, title: "프로젝트", subtitle: "활성 3개 · 소스 루트 여러 개 관리", day: nil, systemImage: "folder", isActive: false, isLocked: false, lockNote: nil, targetSectionID: nil, route: .inert),
            SearchItem(id: "page-settings", kind: .page, title: "설정", subtitle: "워크스페이스 · 프로바이더 · 권한", day: nil, systemImage: "gearshape", isActive: false, isLocked: false, lockNote: nil, targetSectionID: nil, route: .settings),
            SearchItem(id: "page-interviews", kind: .page, title: "인터뷰", subtitle: "Mom Test · 노트", day: nil, systemImage: "bubble.left.and.bubble.right", isActive: false, isLocked: false, lockNote: nil, targetSectionID: nil, route: .inert),
            SearchItem(id: "page-bip", kind: .page, title: "BIP 로그", subtitle: "Build in Public", day: nil, systemImage: "doc.text", isActive: false, isLocked: false, lockNote: nil, targetSectionID: nil, route: .inert),
            SearchItem(id: "page-news", kind: .page, title: "뉴스", subtitle: "안 읽음 17건 · 큐레이션", day: nil, systemImage: "newspaper", isActive: false, isLocked: false, lockNote: nil, targetSectionID: nil, route: .inert),
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
            SearchItem(id: "task-day22", kind: .task, title: "첫 매출 ask · Pricing", subtitle: "Revenue", day: "Day 22", systemImage: "lock", isActive: false, isLocked: true, lockNote: "D21 해제", targetSectionID: nil, route: .inert),
            SearchItem(id: "section-signals", kind: .section, title: "근거", subtitle: "workspace · interviews · BIP", day: nil, systemImage: "waveform.path.ecg", isActive: false, isLocked: false, lockNote: nil, targetSectionID: "signals", route: .today),
            SearchItem(id: "section-mission", kind: .section, title: "핵심 가설 확정", subtitle: "시작", day: nil, systemImage: "flag", isActive: false, isLocked: false, lockNote: nil, targetSectionID: "mission", route: .today),
            SearchItem(id: "section-interview1", kind: .section, title: "인터뷰 1 — 거리", subtitle: "3분 · 직감 OK · 바꿀 수 있음", day: nil, systemImage: "bubble.left", isActive: false, isLocked: false, lockNote: nil, targetSectionID: "interview1", route: .today),
            SearchItem(id: "section-picker", kind: .section, title: "ICP 4지선다", subtitle: "직접 만날 사람 후보", day: nil, systemImage: "scope", isActive: false, isLocked: false, lockNote: nil, targetSectionID: "interview1-options", route: .today),
            SearchItem(id: "section-final", kind: .section, title: "핵심 가설 확정", subtitle: "다음 검증 기준", day: nil, systemImage: "target", isActive: false, isLocked: false, lockNote: nil, targetSectionID: "final-icp", route: .today),
            SearchItem(id: "section-guide", kind: .section, title: "진행 가이드", subtitle: "Day 1 흐름 보기", day: nil, systemImage: "sparkles", isActive: false, isLocked: false, lockNote: nil, targetSectionID: "top", route: .today),
        ]
    }

    static func makeMarketSearchItems() -> [SearchItem] {
        var items = makeSearchItems()
            .filter { $0.kind != .section }
            .map { item -> SearchItem in
                switch item.id {
                case "page-today":
                    return SearchItem(id: item.id, kind: item.kind, title: "오늘 · Day 2", subtitle: "Market Signals", day: nil, systemImage: "scope", isActive: true, isLocked: false, lockNote: nil, targetSectionID: "top", route: .today)
                case "task-day1":
                    return SearchItem(id: item.id, kind: item.kind, title: item.title, subtitle: "ICP · 완료", day: item.day, systemImage: "checkmark.circle", isActive: false, isLocked: false, lockNote: nil, targetSectionID: nil, route: .inert)
                case "task-day2":
                    return SearchItem(id: item.id, kind: item.kind, title: item.title, subtitle: "Market · +8", day: item.day, systemImage: "circle.dotted", isActive: true, isLocked: false, lockNote: nil, targetSectionID: "top", route: .today)
                default:
                    return item
                }
            }

        items.append(contentsOf: [
            SearchItem(id: "section-market-keywords", kind: .section, title: "지난 30일 키워드", subtitle: "ICP 코호트 · 총 287 멘션", day: nil, systemImage: "text.magnifyingglass", isActive: false, isLocked: false, lockNote: nil, targetSectionID: "market-keywords", route: .today),
            SearchItem(id: "section-market-sources", kind: .section, title: "소스별 신호", subtitle: "Threads · IH · X", day: nil, systemImage: "chart.line.uptrend.xyaxis", isActive: false, isLocked: false, lockNote: nil, targetSectionID: "market-sources", route: .today),
            SearchItem(id: "section-market-alternatives", kind: .section, title: "대안 비교 매트릭스", subtitle: "7개 대안 · 갭 비교", day: nil, systemImage: "tablecells", isActive: false, isLocked: false, lockNote: nil, targetSectionID: "market-alternatives", route: .today),
            SearchItem(id: "section-market-gap", kind: .section, title: "시장 빈 자리", subtitle: "한국어 + 30일 강제 과제", day: nil, systemImage: "scope", isActive: false, isLocked: false, lockNote: nil, targetSectionID: "market-gap", route: .today),
            SearchItem(id: "section-market-posts", kind: .section, title: "인용 좋은 게시물", subtitle: "상위 5개", day: nil, systemImage: "quote.bubble", isActive: false, isLocked: false, lockNote: nil, targetSectionID: "market-posts", route: .today),
        ])

        return items
    }

    private static func makePersonalizedSearchItems(plan: Day1IcpPlan, steps: [InterviewStep]) -> [SearchItem] {
        let productName = cleanNonEmpty(plan.signals.productName) ?? "이 프로젝트"
        var items: [SearchItem] = []

        for item in makeSearchItems() {
            switch item.id {
            case "task-day1":
                items.append(SearchItem(
                    id: item.id,
                    kind: item.kind,
                    title: "ICP v0 질문을 정해요",
                    subtitle: "ICP · adaptive \(steps.count)Q",
                    day: item.day,
                    systemImage: item.systemImage,
                    isActive: item.isActive,
                    isLocked: item.isLocked,
                    lockNote: item.lockNote,
                    targetSectionID: item.targetSectionID,
                    route: item.route
                ))
            case "section-signals":
                items.append(SearchItem(
                    id: item.id,
                    kind: item.kind,
                    title: "scan 시그널",
                    subtitle: productName,
                    day: item.day,
                    systemImage: item.systemImage,
                    isActive: item.isActive,
                    isLocked: item.isLocked,
                    lockNote: item.lockNote,
                    targetSectionID: item.targetSectionID,
                    route: item.route
                ))
            case "section-interview1":
                for step in steps {
                    items.append(SearchItem(
                        id: "section-interview\(step.id)",
                        kind: .section,
                        title: step.title,
                        subtitle: step.meta,
                        day: nil,
                        systemImage: "questionmark.bubble",
                        isActive: false,
                        isLocked: false,
                        lockNote: nil,
                        targetSectionID: "interview\(step.id)",
                        route: .today
                    ))
                }
            case "section-picker":
                continue
            case "section-final":
                items.append(SearchItem(
                    id: item.id,
                    kind: item.kind,
                    title: "핵심 가설 확정",
                    subtitle: "다음 검증 기준",
                    day: item.day,
                    systemImage: item.systemImage,
                    isActive: item.isActive,
                    isLocked: item.isLocked,
                    lockNote: item.lockNote,
                    targetSectionID: item.targetSectionID,
                    route: item.route
                ))
            default:
                items.append(item)
            }
        }

        return items
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
        if item.id == "section-final", compactQ.contains("핵심가설") { score += 2 }
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
        guard let step = interviewSteps.first(where: { $0.id == stepID }),
              let title = step.selectedAnswerTitle(in: interaction) else {
            return fallback
        }
        return title
    }

    func draft(for interaction: OpenDesignDayInteractionState) -> OpenDesignDayDraft {
        let answers = interviewSteps.compactMap { step -> OpenDesignDaySelectedAnswer? in
            guard let value = step.selectedAnswerTitle(in: interaction) else {
                return nil
            }
            let selectedOption = step.selectedOption(in: interaction)
            let isFreeform = step.selectedAnswerIsFreeform(in: interaction)
            return OpenDesignDaySelectedAnswer(
                dimension: step.dimension.isEmpty ? step.title : step.dimension,
                title: step.title,
                value: value,
                isAntiSignal: step.selectedAnswerIsAntiSignal(in: interaction),
                evidenceLabel: evidenceLabel(for: step, selectedOption: selectedOption, isFreeform: isFreeform),
                evidenceLimited: selectedOption?.evidenceLimited == true || isFreeform,
                isFreeform: isFreeform
            )
        }
        return OpenDesignDayDraft(
            distance: selectedLabel(stepID: 1, in: interaction, fallback: "이번 주 바로 연락 가능한 1인 개발자"),
            tool: selectedLabel(stepID: 2, in: interaction),
            stuck: selectedLabel(stepID: 3, in: interaction),
            action: selectedLabel(stepID: 4, in: interaction),
            selectedAnswers: answers,
            plan: plan,
            alignmentPlan: alignmentPlan
        )
    }

    private func evidenceLabel(
        for step: InterviewStep,
        selectedOption: InterviewOption?,
        isFreeform: Bool
    ) -> String? {
        if isFreeform {
            return "직접 입력"
        }
        if let optionEvidence = Self.cleanNonEmpty(selectedOption?.evidenceLabel) {
            return optionEvidence
        }
        if selectedOption?.evidenceLimited == true {
            return "근거 부족"
        }
        let refs = alignmentEvidenceRefs(for: step.dimension)
        guard !refs.isEmpty else { return nil }
        return "근거: \(refs.prefix(2).joined(separator: ", "))"
    }

    private func alignmentEvidenceRefs(for dimension: String) -> [String] {
        guard let alignmentPlan else { return [] }
        let evidence: [String]
        switch dimension {
        case "icp":
            evidence = alignmentPlan.components.icp.evidence
        case "pain_point", "pain":
            evidence = alignmentPlan.components.painPoint.evidence
        case "outcome":
            evidence = alignmentPlan.components.outcome.evidence
        default:
            evidence = []
        }
        let componentRefs = evidence.compactMap(Self.compactEvidenceReference)
        if !componentRefs.isEmpty {
            return componentRefs
        }
        return alignmentPlan.signals.evidenceRefs.map(\.path).compactMap(Self.compactEvidenceReference)
    }

    nonisolated private static func compactEvidenceReference(_ value: String) -> String? {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        let beforeColon = trimmed.split(separator: ":", maxSplits: 1).first.map(String.init) ?? trimmed
        let firstToken = beforeColon.split(whereSeparator: \.isWhitespace).first.map(String.init) ?? beforeColon
        let cleaned = firstToken
            .trimmingCharacters(in: CharacterSet(charactersIn: "`[](),"))
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return cleaned.isEmpty ? nil : cleaned
    }
}

private extension OpenDesignDayContent.InterviewStep {
    func selectedOption(in interaction: OpenDesignDayInteractionState) -> OpenDesignDayContent.InterviewOption? {
        guard let selectedID = interaction.selectedChoices[id],
              selectedID != OpenDesignDayInteractionState.freeformChoiceID else {
            return nil
        }
        return options.first(where: { $0.id == selectedID })
    }

    func selectedAnswerIsFreeform(in interaction: OpenDesignDayInteractionState) -> Bool {
        interaction.selectedChoices[id] == OpenDesignDayInteractionState.freeformChoiceID
    }

    func selectedAnswerTitle(in interaction: OpenDesignDayInteractionState) -> String? {
        guard let selectedID = interaction.selectedChoices[id] else { return nil }
        if selectedID == OpenDesignDayInteractionState.freeformChoiceID {
            let freeform = interaction.trimmedFreeformAnswer(stepID: id)
            return freeform.isEmpty ? nil : freeform
        }
        return options.first(where: { $0.id == selectedID })?.title
    }

    func selectedAnswerDetail(in interaction: OpenDesignDayInteractionState) -> String? {
        guard let selectedID = interaction.selectedChoices[id] else { return nil }
        if selectedID == OpenDesignDayInteractionState.freeformChoiceID {
            return "직접 입력"
        }
        guard let option = options.first(where: { $0.id == selectedID }) else { return nil }
        let detail = option.detail.trimmingCharacters(in: .whitespacesAndNewlines)
        return detail.isEmpty ? option.title : detail
    }

    func selectedAnswerIsAntiSignal(in interaction: OpenDesignDayInteractionState) -> Bool {
        selectedOption(in: interaction)?.isAntiSignal == true
    }
}

func openDesignQuestionHintText(for step: OpenDesignDayContent.InterviewStep) -> String? {
    if let explicitHint = openDesignSanitizedQuestionHint(step.hintText, step: step) {
        return explicitHint
    }

    let prompt = step.prompt.trimmingCharacters(in: .whitespacesAndNewlines)
    let label = step.label.trimmingCharacters(in: .whitespacesAndNewlines)
    let statement = (step.statementPrefix + step.markedStatement + step.statementSuffix)
        .trimmingCharacters(in: .whitespacesAndNewlines)
    let questionStatement = statement.isEmpty ? step.prompt : statement
    let criteria = step.criteria
        .prefix(2)
        .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
        .filter { !$0.isEmpty }
        .joined(separator: " · ")
    let base = prompt.isEmpty || prompt == questionStatement ? label : prompt

    if base.isEmpty { return openDesignSanitizedQuestionHint(criteria, step: step) }
    if criteria.isEmpty { return openDesignSanitizedQuestionHint(base, step: step) }
    return openDesignSanitizedQuestionHint("\(base) · \(criteria)", step: step)
}

private func openDesignSanitizedQuestionHint(
    _ value: String?,
    step: OpenDesignDayContent.InterviewStep
) -> String? {
    guard let value else { return nil }
    let text = value.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !text.isEmpty else { return nil }

    let normalized = openDesignNormalizedQuestionHint(text)
    let meaningless = [
        step.dimension,
        step.title,
        step.prompt,
        step.progressLabel,
    ]
        .map(openDesignNormalizedQuestionHint)
        .filter { !$0.isEmpty }

    return meaningless.contains(normalized) ? nil : text
}

private func openDesignNormalizedQuestionHint(_ value: String) -> String {
    value
        .lowercased()
        .replacingOccurrences(of: #"[\s·/_-]+"#, with: "", options: .regularExpression)
}

struct OpenDesignAlignmentQuestionContextRow: Hashable, Identifiable {
    let id: String
    let label: String
    let value: String
    let accessibilityLabel: String

    init(id: String, label: String, value: String, accessibilityLabel: String? = nil) {
        self.id = id
        self.label = label
        self.value = value
        self.accessibilityLabel = accessibilityLabel ?? "\(label) \(value)"
    }
}

func openDesignAlignmentQuestionContextRows(
    for step: OpenDesignDayContent.InterviewStep,
    content: OpenDesignDayContent,
    interaction: OpenDesignDayInteractionState
) -> [OpenDesignAlignmentQuestionContextRow] {
    var rows: [OpenDesignAlignmentQuestionContextRow] = []

    if step.id >= 2,
       let customerRow = openDesignSelectedAnswerContextRow(
        stepID: 1,
        label: "고객",
        accessibilityPrefix: "선택한 고객",
        content: content,
        interaction: interaction
       ) {
        rows.append(customerRow)
    }

    if step.id >= 3,
       let painRow = openDesignSelectedAnswerContextRow(
        stepID: 2,
        label: "문제",
        accessibilityPrefix: "선택한 문제",
        content: content,
        interaction: interaction
       ) {
        rows.append(painRow)
    }

    return rows
}

private func openDesignSelectedAnswerContextRow(
    stepID: Int,
    label: String,
    accessibilityPrefix: String,
    content: OpenDesignDayContent,
    interaction: OpenDesignDayInteractionState
) -> OpenDesignAlignmentQuestionContextRow? {
    guard let step = content.interviewSteps.first(where: { $0.id == stepID }),
          let title = step.selectedAnswerTitle(in: interaction) else {
        return nil
    }

    let value = openDesignCompactDisplayText(title, max: 64)
    guard !value.isEmpty else { return nil }

    return OpenDesignAlignmentQuestionContextRow(
        id: step.dimension.isEmpty ? "step-\(stepID)" : step.dimension,
        label: label,
        value: value,
        accessibilityLabel: "\(accessibilityPrefix) \(value)"
    )
}

private func openDesignAlignmentQuestionContextValue(
    key: String,
    label: String,
    fallback: String,
    alignmentPlan: Day1AlignmentPlan
) -> String {
    let raw = fallback.trimmingCharacters(in: .whitespacesAndNewlines)
    let display = openDesignAlignmentDisplayValue(
        key: key,
        label: label,
        rawValue: raw,
        alignmentPlan: alignmentPlan
    ).trimmingCharacters(in: .whitespacesAndNewlines)

    guard !display.isEmpty,
          !openDesignLooksLikeSourcePathOnly(display),
          !openDesignLooksLikeUnitlessNumber(display)
    else {
        return openDesignAlignmentPlaceholder(key: key)
    }
    return openDesignCompactDisplayText(display, max: 64)
}

private func openDesignCompactDisplayText(_ value: String, max: Int) -> String {
    let text = value
        .replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
        .trimmingCharacters(in: .whitespacesAndNewlines)
    guard text.count > max else { return text }
    return String(text.prefix(max - 1)).trimmingCharacters(in: .whitespacesAndNewlines) + "…"
}

private extension OpenDesignDayContent.InterviewOption {
    var isScanWarningOnly: Bool {
        guard evidenceLimited else { return false }
        let title = title.lowercased()
        let detail = detail.lowercased()
        return title.contains("scan") && (title.contains("근거") || detail.contains("근거 부족"))
    }
}

typealias OpenDesignTaskItem = OpenDesignDayContent.TaskItem
typealias OpenDesignSearchItem = OpenDesignDayContent.SearchItem

private func openDesignFoundationDayNumber(taskID: String) -> Int? {
    let prefix: String
    if taskID.hasPrefix("task-day") {
        prefix = "task-day"
    } else if taskID.hasPrefix("day") {
        prefix = "day"
    } else {
        return nil
    }
    guard let day = Int(taskID.dropFirst(prefix.count)),
          (1...30).contains(day) else {
        return nil
    }
    return day
}

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
    case missionAction = "mission-action"
    case interview1
    case interview1Options = "interview1-options"
    case interview2
    case interview2Options = "interview2-options"
    case interview3
    case interview3Options = "interview3-options"
    case interview4
    case interview4Options = "interview4-options"
    case interview5
    case interview5Options = "interview5-options"
    case icpPreview = "icp-preview"
    case icpPreviewAction = "icp-preview-action"
    case finalIcp = "final-icp"
    case finalIcpAction = "final-icp-action"
    case candidate
    case candidateAction = "candidate-action"
    case gate
    case gateAction = "gate-action"
    case completion
    case marketKeywords = "market-keywords"
    case marketSources = "market-sources"
    case marketAlternatives = "market-alternatives"
    case marketGap = "market-gap"
    case marketPosts = "market-posts"

    static func interview(stepID: Int, placement: OpenDesignScrollPlacement = .sectionContext) -> OpenDesignSectionAnchor {
        let boundedStepID = min(max(stepID, 1), 5)
        let suffix = placement == .nextAction ? "-options" : ""
        return OpenDesignSectionAnchor(rawValue: "interview\(boundedStepID)\(suffix)") ?? .interview1
    }
}

enum OpenDesignScrollPlacement: Equatable {
    case sectionContext
    case nextAction

    var anchor: UnitPoint {
        switch self {
        case .sectionContext, .nextAction:
            return .top
        }
    }
}

struct OpenDesignScrollRequest: Equatable {
    let target: OpenDesignSectionAnchor
    let placement: OpenDesignScrollPlacement
    let token: UUID

    var resolvedTarget: OpenDesignSectionAnchor {
        switch (target, placement) {
        case (.mission, .nextAction):
            return .missionAction
        case (.icpPreview, .nextAction):
            return .icpPreviewAction
        case (.finalIcp, .nextAction):
            return .finalIcpAction
        case (.candidate, .nextAction):
            return .candidateAction
        case (.gate, .nextAction):
            return .gateAction
        default:
            return target
        }
    }

    var anchor: UnitPoint {
        return placement.anchor
    }

    init(
        target: OpenDesignSectionAnchor,
        placement: OpenDesignScrollPlacement = .sectionContext,
        token: UUID = UUID()
    ) {
        self.target = target
        self.placement = placement
        self.token = token
    }
}

enum OpenDesignIntroStage: Int, Comparable {
    case context
    case signals
    case mission

    static func < (lhs: OpenDesignIntroStage, rhs: OpenDesignIntroStage) -> Bool {
        lhs.rawValue < rhs.rawValue
    }

    var revealsSignals: Bool {
        self >= .signals
    }

    var revealsMission: Bool {
        self >= .mission
    }

    var nextButtonTitle: String? {
        switch self {
        case .context:
            return "시작"
        case .signals:
            return "시작"
        case .mission:
            return nil
        }
    }
}

enum OpenDesignWorkflowNavigationDirection: Equatable {
    case forward
    case backward
    case neutral

    static func direction(from currentStepID: Int, to targetStepID: Int) -> OpenDesignWorkflowNavigationDirection {
        if targetStepID > currentStepID { return .forward }
        if targetStepID < currentStepID { return .backward }
        return .neutral
    }
}

struct OpenDesignDayInteractionState: Equatable {
    static let freeformChoiceID = -1

    var totalInterviewSteps = 4
    var introStage: OpenDesignIntroStage = .context
    var missionAccepted = false
    var activeStepID = 0
    var maxUnlockedStepID = 0
    var workflowNavigationDirection: OpenDesignWorkflowNavigationDirection = .neutral
    var selectedChoices: [Int: Int] = [:]
    var submittedChoices: [Int: Int] = [:]
    var submittedSteps: Set<Int> = []
    var revisionSteps: Set<Int> = []
    var lockedPrefillStepIDs: Set<Int> = []
    var freeformAnswer = ""
    var freeformAnswers: [Int: String] = [:]
    var dayCompleted = false

    init(
        totalInterviewSteps: Int = 4
    ) {
        self.totalInterviewSteps = totalInterviewSteps
    }

    func synchronized(totalInterviewSteps newTotalInterviewSteps: Int) -> OpenDesignDayInteractionState {
        var copy = self
        copy.synchronize(totalInterviewSteps: newTotalInterviewSteps)
        return copy
    }

    mutating func synchronize(totalInterviewSteps newTotalInterviewSteps: Int) {
        let boundedTotal = max(1, newTotalInterviewSteps)
        totalInterviewSteps = boundedTotal

        let validStepIDs = Set(validInterviewStepIDs(for: boundedTotal))
        selectedChoices = selectedChoices.filter { validStepIDs.contains($0.key) }
        submittedChoices = submittedChoices.filter { validStepIDs.contains($0.key) }
        freeformAnswers = freeformAnswers.filter { validStepIDs.contains($0.key) }
        submittedSteps = submittedSteps.intersection(validStepIDs)
        revisionSteps = revisionSteps.intersection(validStepIDs)
        lockedPrefillStepIDs = lockedPrefillStepIDs.intersection(validStepIDs)

        activeStepID = min(max(activeStepID, 0), finalStepID)
        maxUnlockedStepID = min(max(maxUnlockedStepID, 0), finalStepID)
        if !validStepIDs.contains(1) {
            freeformAnswer = ""
        } else if let firstFreeformAnswer = freeformAnswers[1] {
            freeformAnswer = firstFreeformAnswer
        }
    }

    var finalStepID: Int {
        totalInterviewSteps + 1
    }

    var workflowStepCount: Int {
        totalInterviewSteps + 2
    }

    var normalizedActiveStepID: Int {
        if dayCompleted || allInterviewsSubmitted {
            return min(max(activeStepID, finalStepID), finalStepID)
        }
        if !missionAccepted { return 0 }
        if activeStepID <= 0 { return 0 }
        return min(max(activeStepID, 1), maxReachableStepID)
    }

    var maxReachableStepID: Int {
        if dayCompleted || allInterviewsSubmitted { return finalStepID }
        if !missionAccepted { return 0 }
        return min(max(maxUnlockedStepID, highestVisibleInterviewStep), totalInterviewSteps)
    }

    var activeInterviewStepID: Int? {
        let active = normalizedActiveStepID
        guard (1...totalInterviewSteps).contains(active) else { return nil }
        return active
    }

    var highestVisibleInterviewStep: Int {
        var highest = 1
        guard totalInterviewSteps > 1 else { return highest }
        for step in 1..<totalInterviewSteps where submittedSteps.contains(step) {
            highest = step + 1
        }
        return min(highest, totalInterviewSteps)
    }

    var allInterviewsSubmitted: Bool {
        guard totalInterviewSteps > 0 else { return true }
        return submittedSteps.isSuperset(of: Set(1...totalInterviewSteps))
    }

    var progressPercent: Int {
        if dayCompleted { return 100 }
        if allInterviewsSubmitted { return 90 }
        if !missionAccepted { return 0 }
        let completed = min(submittedSteps.count, max(totalInterviewSteps, 1))
        if completed > 0 {
            let span = 52.0 * Double(completed) / Double(max(totalInterviewSteps, 1))
            return min(86, 34 + Int(span.rounded()))
        }
        return 34
    }

    var progressStepCount: Int {
        if allInterviewsSubmitted || dayCompleted { return 3 }
        if missionAccepted { return 2 }
        return 1
    }

    var currentProgressScrollTarget: OpenDesignSectionAnchor {
        if dayCompleted { return .completion }
        if !introStage.revealsSignals { return .top }
        if !missionAccepted { return .mission }
        if normalizedActiveStepID == 0 { return .mission }
        if let activeInterviewStepID { return .interview(stepID: activeInterviewStepID) }
        if !allInterviewsSubmitted { return .interview(stepID: highestVisibleInterviewStep) }
        return .finalIcp
    }

    func stepperScrollTarget(for index: Int) -> OpenDesignSectionAnchor {
        switch index {
        case 0:
            return .top
        case 1:
            return missionAccepted ? .interview(stepID: highestVisibleInterviewStep) : .mission
        case 2:
            return allInterviewsSubmitted ? .finalIcp : (missionAccepted ? .interview(stepID: highestVisibleInterviewStep) : .mission)
        default:
            return .top
        }
    }

    func isSearchItemAvailable(_ item: OpenDesignDayContent.SearchItem) -> Bool {
        guard item.kind == .section,
              let targetSectionID = item.targetSectionID,
              let anchor = OpenDesignSectionAnchor(rawValue: targetSectionID) else {
            return true
        }

        switch anchor {
        case .top, .signals, .mission, .missionAction, .marketKeywords, .marketSources, .marketAlternatives, .marketGap, .marketPosts:
            return true
        case .interview1, .interview1Options:
            return missionAccepted
        case .interview2, .interview2Options:
            return highestVisibleInterviewStep >= 2
        case .interview3, .interview3Options:
            return highestVisibleInterviewStep >= 3
        case .interview4, .interview4Options:
            return highestVisibleInterviewStep >= 4
        case .interview5, .interview5Options:
            return highestVisibleInterviewStep >= 5
        case .icpPreview, .icpPreviewAction:
            return false
        case .finalIcp, .finalIcpAction:
            return allInterviewsSubmitted
        case .candidate, .candidateAction:
            return false
        case .gate, .gateAction:
            return false
        case .completion:
            return dayCompleted
        }
    }

    mutating func recordSubmittedChoice(stepID: Int, choiceID: Int) {
        guard !lockedPrefillStepIDs.contains(stepID) else { return }
        let currentStepID = normalizedActiveStepID
        selectedChoices[stepID] = choiceID
        _ = submittedSteps.insert(stepID)
        submittedChoices[stepID] = choiceID
        revisionSteps.remove(stepID)
        let nextStep = stepID < totalInterviewSteps ? stepID + 1 : finalStepID
        workflowNavigationDirection = OpenDesignWorkflowNavigationDirection.direction(from: currentStepID, to: nextStep)
        maxUnlockedStepID = max(maxUnlockedStepID, nextStep)
        if activeStepID == stepID || activeStepID == 0 {
            activeStepID = nextStep
        }
    }

    mutating func advancePastSubmittedChoice(stepID: Int) {
        guard submittedSteps.contains(stepID),
              submittedChoices[stepID] == selectedChoices[stepID] else {
            return
        }
        let currentStepID = normalizedActiveStepID
        let nextStep = stepID < totalInterviewSteps ? stepID + 1 : finalStepID
        workflowNavigationDirection = OpenDesignWorkflowNavigationDirection.direction(from: currentStepID, to: nextStep)
        maxUnlockedStepID = max(maxUnlockedStepID, nextStep)
        activeStepID = nextStep
    }

    mutating func selectChoice(stepID: Int, choiceID: Int?) {
        guard !lockedPrefillStepIDs.contains(stepID) else { return }
        guard (1...totalInterviewSteps).contains(stepID),
              selectedChoices[stepID] != choiceID else {
            if let choiceID, choiceID != Self.freeformChoiceID {
                clearFreeformAnswer(stepID: stepID)
            }
            return
        }

        let previousSubmittedChoice = submittedChoices[stepID]
        if let choiceID {
            selectedChoices[stepID] = choiceID
        } else {
            selectedChoices.removeValue(forKey: stepID)
        }

        if choiceID != Self.freeformChoiceID {
            clearFreeformAnswer(stepID: stepID)
        }

        if previousSubmittedChoice != nil || hasDownstreamState(after: stepID) || dayCompleted {
            invalidateStepAndFollowing(from: stepID)
            if previousSubmittedChoice != nil, previousSubmittedChoice != choiceID, choiceID != nil {
                revisionSteps.insert(stepID)
            }
        }
    }

    mutating func activateFreeformAnswer(stepID: Int) {
        guard !lockedPrefillStepIDs.contains(stepID) else { return }
        guard (1...totalInterviewSteps).contains(stepID) else { return }
        let currentChoice = selectedChoices[stepID]
        let hasNumberChoice = currentChoice != nil && currentChoice != Self.freeformChoiceID
        let hasSubmittedNumberChoice = submittedChoices[stepID].map { $0 != Self.freeformChoiceID } ?? false
        let shouldInvalidate = hasSubmittedNumberChoice
            || hasDownstreamState(after: stepID)
            || dayCompleted

        if hasNumberChoice {
            selectedChoices.removeValue(forKey: stepID)
        }

        if shouldInvalidate {
            invalidateStepAndFollowing(from: stepID)
        }
    }

    mutating func setFreeformAnswer(stepID: Int, value: String) {
        guard !lockedPrefillStepIDs.contains(stepID) else { return }
        guard (1...totalInterviewSteps).contains(stepID) else { return }
        let previousFreeform = trimmedFreeformAnswer(stepID: stepID)
        freeformAnswers[stepID] = value
        if stepID == 1 {
            freeformAnswer = value
        }

        let currentFreeform = trimmedFreeformAnswer(stepID: stepID)
        if currentFreeform.isEmpty {
            if selectedChoices[stepID] == Self.freeformChoiceID {
                selectChoice(stepID: stepID, choiceID: nil)
            }
        } else if selectedChoices[stepID] == Self.freeformChoiceID,
                  previousFreeform != currentFreeform,
                  submittedChoices[stepID] == Self.freeformChoiceID {
            invalidateStepAndFollowing(from: stepID)
            revisionSteps.insert(stepID)
        } else {
            selectChoice(stepID: stepID, choiceID: Self.freeformChoiceID)
        }
    }

    func trimmedFreeformAnswer(stepID: Int) -> String {
        let value = freeformAnswers[stepID] ?? (stepID == 1 ? freeformAnswer : "")
        return value.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    func isCurrentSelectionSubmitted(stepID: Int) -> Bool {
        guard let selectedChoice = selectedChoices[stepID] else { return false }
        return submittedChoices[stepID] == selectedChoice
    }

    mutating func acceptMissionForStepFlow() {
        let currentStepID = normalizedActiveStepID
        introStage = max(introStage, .mission)
        missionAccepted = true
        workflowNavigationDirection = OpenDesignWorkflowNavigationDirection.direction(from: currentStepID, to: 1)
        activeStepID = max(activeStepID, 1)
        maxUnlockedStepID = max(maxUnlockedStepID, 1)
    }

    mutating func focusWorkflowStep(_ stepID: Int) {
        let bounded = min(max(stepID, 0), finalStepID)
        guard isWorkflowStepUnlocked(bounded) else { return }
        workflowNavigationDirection = OpenDesignWorkflowNavigationDirection.direction(from: normalizedActiveStepID, to: bounded)
        activeStepID = bounded
    }

    mutating func resumeWorkflowFromStartPhase() {
        guard missionAccepted, !dayCompleted, !allInterviewsSubmitted else { return }
        let target = min(max(highestVisibleInterviewStep, 1), maxReachableStepID)
        focusWorkflowStep(target)
    }

    mutating func moveToPreviousWorkflowStep() {
        let current = normalizedActiveStepID
        guard current > 0 else { return }
        workflowNavigationDirection = .backward
        activeStepID = current - 1
    }

    mutating func resetStepFlow() {
        introStage = .context
        missionAccepted = false
        activeStepID = 0
        maxUnlockedStepID = 0
        selectedChoices = [:]
        submittedChoices = [:]
        submittedSteps = []
        revisionSteps = []
        freeformAnswer = ""
        freeformAnswers = [:]
        lockedPrefillStepIDs = []
        dayCompleted = false
        workflowNavigationDirection = .neutral
    }

    func isWorkflowStepUnlocked(_ stepID: Int) -> Bool {
        if stepID == 0 { return true }
        if stepID == finalStepID { return allInterviewsSubmitted || dayCompleted }
        guard (1...totalInterviewSteps).contains(stepID) else { return false }
        return missionAccepted && stepID <= maxReachableStepID
    }

    private func hasDownstreamState(after stepID: Int) -> Bool {
        guard stepID < totalInterviewSteps else { return false }
        return ((stepID + 1)...totalInterviewSteps).contains { id in
            selectedChoices[id] != nil
                || submittedChoices[id] != nil
                || submittedSteps.contains(id)
                || !trimmedFreeformAnswer(stepID: id).isEmpty
        }
    }

    private mutating func invalidateStepAndFollowing(from stepID: Int) {
        for id in stepID...totalInterviewSteps {
            if lockedPrefillStepIDs.contains(id) {
                continue
            }
            submittedChoices.removeValue(forKey: id)
            submittedSteps.remove(id)
            revisionSteps.remove(id)
            if id > stepID {
                selectedChoices.removeValue(forKey: id)
                clearFreeformAnswer(stepID: id)
            }
        }
        if dayCompleted {
            dayCompleted = false
        }
        activeStepID = stepID
        maxUnlockedStepID = missionAccepted ? max(1, stepID) : 0
        workflowNavigationDirection = .backward
    }

    private mutating func clearFreeformAnswer(stepID: Int) {
        freeformAnswers.removeValue(forKey: stepID)
        if stepID == 1 {
            freeformAnswer = ""
        }
    }

    private func validInterviewStepIDs(for total: Int) -> [Int] {
        guard total > 0 else { return [] }
        return Array(1...total)
    }
}

struct OpenDesignDayInteractionKey: Hashable {
    let workspaceRoot: String
    let dayNumber: Int
}

struct OpenDesignDayInteractionStateCache: Equatable {
    private var states: [OpenDesignDayInteractionKey: OpenDesignDayInteractionState] = [:]

    func state(
        for key: OpenDesignDayInteractionKey,
        totalInterviewSteps: Int
    ) -> OpenDesignDayInteractionState {
        let existing = states[key] ?? OpenDesignDayInteractionState(totalInterviewSteps: totalInterviewSteps)
        return existing.synchronized(totalInterviewSteps: totalInterviewSteps)
    }

    mutating func update(
        _ state: OpenDesignDayInteractionState,
        for key: OpenDesignDayInteractionKey,
        totalInterviewSteps: Int
    ) {
        states[key] = state.synchronized(totalInterviewSteps: totalInterviewSteps)
    }

    mutating func removeAll() {
        states.removeAll()
    }
}

struct OpenDesignDaySelectedAnswer: Equatable {
    let dimension: String
    let title: String
    let value: String
    let isAntiSignal: Bool
    let evidenceLabel: String?
    let evidenceLimited: Bool
    let isFreeform: Bool

    init(
        dimension: String,
        title: String,
        value: String,
        isAntiSignal: Bool,
        evidenceLabel: String? = nil,
        evidenceLimited: Bool = false,
        isFreeform: Bool = false
    ) {
        self.dimension = dimension
        self.title = title
        self.value = value
        self.isAntiSignal = isAntiSignal
        self.evidenceLabel = evidenceLabel
        self.evidenceLimited = evidenceLimited
        self.isFreeform = isFreeform
    }
}

private struct OpenDesignDayAlignmentSnapshot: Equatable {
    let goal: String
    let icp: String
    let pain: String
    let outcome: String
}

struct OpenDesignDayDraft: Equatable {
    let distance: String
    let tool: String
    let stuck: String
    let action: String
    var selectedAnswers: [OpenDesignDaySelectedAnswer] = []
    var plan: Day1IcpPlan? = nil
    var alignmentPlan: Day1AlignmentPlan? = nil

    var isAntiSignal: Bool {
        selectedAnswers.contains(where: \.isAntiSignal) || action.contains("아무 행동")
    }

    var recommendation: String {
        if let alignmentPlan {
            if alignmentPlan.qualityGate.passed {
                return alignmentDay2ValidationText(plan: alignmentPlan)
            }
            return alignmentPlan.qualityGate.failGate
        }
        if isAntiSignal {
            return "현재 후보는 Anti-ICP 경계에 걸립니다. Day 3 인터뷰 대상에 넣기 전 실제 행동 증거를 한 번 더 확인한다."
        }
        return "Day 3 Mom Test 인터뷰 첫 후보로 올리고, transcript와 업무 일지를 docs/ICP.md의 evidence 섹션에 연결한다."
    }

    var markdown: String {
        if let alignmentPlan {
            return alignmentMarkdown(plan: alignmentPlan)
        }
        if let plan {
            return personalizedMarkdown(plan: plan)
        }
        return """
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
        if let alignmentPlan {
            return alignmentDisplayStatement(for: alignmentPlan)
        }
        if let plan {
            let selected = selectedAnswers.map(\.value).prefix(3).joined(separator: " · ")
            if selected.isEmpty {
                return plan.icpDraft.description
            }
            return "\(plan.icpDraft.description) 선택된 Day 1 조건: \(selected)."
        }
        return "\(distance) 중, \(tool)를 매일 쓰고 \(stuck)에서 멈췄으며 지난 7일 행동이 \(action)으로 확인된 macOS 1인 개발자."
    }

    var antiIcpBody: String {
        if let alignmentPlan {
            let score = String(format: "%.1f", alignmentPlan.qualityGate.score)
            if isAntiSignal || !alignmentPlan.qualityGate.passed {
                return "\(alignmentPlan.qualityGate.failGate) 현재 품질 점수는 \(score)/10입니다."
            }
            return "\(alignmentPlan.qualityGate.passGate) 현재 품질 점수는 \(score)/10입니다."
        }
        if let plan {
            let firstRule = plan.antiIcp.rules.first?.label ?? "최근 사건과 현재 대안이 없는 후보"
            if isAntiSignal {
                return "선택한 답변이 Anti-ICP 경계에 걸립니다. \(plan.antiIcp.summary) \(firstRule)을 확인하고, 실제 need/have/behavior가 없으면 Day 3 인터뷰에서 제외하세요."
            }
            return "\(plan.antiIcp.summary) 첫 guardrail: \(firstRule)"
        }
        if isAntiSignal {
            return "지난 7일 행동 없음 신호가 있어 Day 3 인터뷰 전에 실제 사건을 한 번 더 확인하세요. 박주영이 \"언젠가 해볼게요\" 또는 \"좋은 아이디어네요\"로 답하면 후보 교체. Mom Test 기준 그대로."
        }
        return "좋은 신호는 지난주에 같은 문제로 시간을 쓴 사건입니다. 박주영이 \"언젠가 해볼게요\" 또는 \"좋은 아이디어네요\"로 답하면 후보 교체. Mom Test 기준 그대로."
    }

    private func alignmentMarkdown(plan: Day1AlignmentPlan) -> String {
        let snapshot = alignmentSnapshot(for: plan)
        let selectedLines = alignmentSelectionRecordLines(plan: plan)
        let assumptionLines = alignmentRemainingAssumptionLines(plan: plan)
        let criteria = plan.qualityGate.criteria.map {
            "- \($0.label): \(String(format: "%.1f", $0.score))/\(String(format: "%.1f", $0.maxScore)) — \($0.detail)"
        }
        return """
        # Day 1 핵심 가설

        > Source: Day 1 alignment flow
        > Based on: workspace scan + user selections
        > Write target: docs/GOAL.md, docs/ICP.md, docs/SPEC.md

        ## 확정
        - 목표: \(snapshot.goal)
        - 고객: \(snapshot.icp)
        - 문제: \(snapshot.pain)
        - 확인할 행동: \(snapshot.outcome)

        ## 핵심 가설 문장
        \(alignmentDisplayStatement(for: plan))

        ## 선택 기록
        \(selectedLines.joined(separator: "\n"))

        ## 남은 가정
        \(assumptionLines.joined(separator: "\n"))

        ## Quality Gate
        Score: \(String(format: "%.1f", plan.qualityGate.score))/10 · \(plan.qualityGate.label)
        \(criteria.joined(separator: "\n"))

        ## Day 2 검증 기준
        \(alignmentDay2ValidationText(plan: plan))
        """
    }

    private func alignmentDisplayStatement(for plan: Day1AlignmentPlan) -> String {
        let snapshot = alignmentSnapshot(for: plan)
        return [
            "목표: \(snapshot.goal)",
            "고객: \(snapshot.icp)",
            "문제: \(snapshot.pain)",
            "확인할 행동: \(snapshot.outcome)",
        ].joined(separator: " / ")
    }

    private func alignmentSnapshot(for plan: Day1AlignmentPlan) -> OpenDesignDayAlignmentSnapshot {
        OpenDesignDayAlignmentSnapshot(
            goal: plan.projectGoal,
            icp: selectedAlignmentValue(for: ["icp"], fallback: plan.alignmentStatement.icp),
            pain: selectedAlignmentValue(for: ["pain_point", "pain"], fallback: plan.alignmentStatement.painPoint),
            outcome: selectedAlignmentValue(for: ["outcome"], fallback: plan.alignmentStatement.outcome)
        )
    }

    private func selectedAlignmentValue(for dimensions: Set<String>, fallback: String) -> String {
        guard let selected = selectedAlignmentAnswer(for: dimensions)?.value.trimmingCharacters(in: .whitespacesAndNewlines),
              !selected.isEmpty else {
            return fallback
        }
        return selected
    }

    private func selectedAlignmentAnswer(for dimensions: Set<String>) -> OpenDesignDaySelectedAnswer? {
        selectedAnswers.first { answer in
            dimensions.contains(answer.dimension.trimmingCharacters(in: .whitespacesAndNewlines).lowercased())
        }
    }

    private func alignmentSelectionRecordLines(plan: Day1AlignmentPlan) -> [String] {
        let specs: [(label: String, dimensions: Set<String>, fallback: String, evidence: String)] = [
            ("고객", ["icp"], plan.alignmentStatement.icp, fallbackEvidenceLabel(plan: plan, dimension: "icp")),
            ("문제", ["pain_point", "pain"], plan.alignmentStatement.painPoint, fallbackEvidenceLabel(plan: plan, dimension: "pain_point")),
            ("확인할 행동", ["outcome"], plan.alignmentStatement.outcome, fallbackEvidenceLabel(plan: plan, dimension: "outcome")),
        ]
        return specs.map { spec in
            guard let answer = selectedAlignmentAnswer(for: spec.dimensions) else {
                return "- \(spec.label): \(spec.fallback) · \(spec.evidence) · scan 후보"
            }
            let evidence = displayEvidenceLabel(answer.evidenceLabel) ?? spec.evidence
            let freeform = answer.isFreeform ? " · 직접 입력" : ""
            let scanCandidate = answer.value == spec.fallback ? "" : " · scan 후보: \(spec.fallback)"
            return "- \(spec.label): \(answer.value) · \(evidence)\(freeform)\(scanCandidate)"
        }
    }

    private func alignmentRemainingAssumptionLines(plan: Day1AlignmentPlan) -> [String] {
        var assumptions = plan.signals.missingAssumptions
        assumptions.append(contentsOf: plan.components.icp.missingAssumptions)
        assumptions.append(contentsOf: plan.components.painPoint.missingAssumptions)
        assumptions.append(contentsOf: plan.components.outcome.missingAssumptions)
        let normalized = assumptions
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
        var seen = Set<String>()
        let unique = normalized.filter { assumption in
            let key = assumption.lowercased()
            guard !seen.contains(key) else { return false }
            seen.insert(key)
            return true
        }
        if unique.isEmpty {
            return ["- 현재 남은 가정 없음"]
        }
        return unique.map { "- \($0)" }
    }

    private func alignmentDay2ValidationText(plan: Day1AlignmentPlan) -> String {
        let snapshot = alignmentSnapshot(for: plan)
        return "\(plan.day2Handoff.nextDayPrompt) 기준: 고객 \"\(snapshot.icp)\"의 문제 \"\(snapshot.pain)\"를 \"\(snapshot.outcome)\"으로 확인한다."
    }

    private func fallbackEvidenceLabel(plan: Day1AlignmentPlan, dimension: String) -> String {
        let evidence: [String]
        switch dimension {
        case "icp":
            evidence = plan.components.icp.evidence
        case "pain_point", "pain":
            evidence = plan.components.painPoint.evidence
        case "outcome":
            evidence = plan.components.outcome.evidence
        default:
            evidence = []
        }
        let refs = evidence.compactMap(Self.compactEvidenceReference)
        if !refs.isEmpty {
            return "근거: \(refs.prefix(2).joined(separator: ", "))"
        }
        let signalRefs = plan.signals.evidenceRefs.map(\.path).compactMap(Self.compactEvidenceReference)
        if !signalRefs.isEmpty {
            return "근거: \(signalRefs.prefix(2).joined(separator: ", "))"
        }
        return "근거 부족"
    }

    private func displayEvidenceLabel(_ label: String?) -> String? {
        let trimmed = label?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard !trimmed.isEmpty else { return nil }
        if trimmed == "직접 입력" || trimmed == "근거 부족" || trimmed.hasPrefix("근거") {
            return trimmed
        }
        return "근거: \(trimmed)"
    }

    nonisolated private static func compactEvidenceReference(_ value: String) -> String? {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        let beforeColon = trimmed.split(separator: ":", maxSplits: 1).first.map(String.init) ?? trimmed
        let firstToken = beforeColon.split(whereSeparator: \.isWhitespace).first.map(String.init) ?? beforeColon
        let cleaned = firstToken
            .trimmingCharacters(in: CharacterSet(charactersIn: "`[](),"))
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return cleaned.isEmpty ? nil : cleaned
    }

    private func personalizedMarkdown(plan: Day1IcpPlan) -> String {
        let selectedLines = selectedAnswers.isEmpty
            ? ["- 아직 선택된 답변 없음"]
            : selectedAnswers.map { "- \($0.title): \($0.value)" }
        return """
        # Ideal Customer Profile

        > Write target: docs/ICP.md
        > Source: Day 1 adaptive scan plan

        ## Description
        \(plan.icpDraft.description)

        ## Criteria
        \(markdownList(plan.icpDraft.criteria))

        ## Why they matter
        \(markdownList(plan.icpDraft.whyTheyMatter))

        ## Needs
        \(markdownList(plan.icpDraft.needs))

        ## Haves
        \(markdownList(plan.icpDraft.haves))

        ## Don't needs
        \(markdownList(plan.icpDraft.dontNeeds))

        ## Day 1 selections
        \(selectedLines.joined(separator: "\n"))

        ## Evidence
        \(markdownList(plan.icpDraft.evidence))

        ## Reference customers to find
        \(markdownList(plan.icpDraft.referenceCustomersToFind))

        ## Anti-ICP guardrail
        \(plan.antiIcp.summary)
        \(markdownList(plan.antiIcp.rules.map { "\($0.label) — \($0.reason)" }))
        """
    }

    private func markdownList(_ values: [String]) -> String {
        let clean = values.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
        guard !clean.isEmpty else { return "- TBD" }
        return clean.map { "- \($0)" }.joined(separator: "\n")
    }
}

private struct OpenDesignDayPalette {
    let bg: Color
    let bgDeep: Color
    let bgDarker: Color
    let surface: Color
    let surface2: Color
    let elevated: Color
    let hover: Color
    let selected: Color
    let border: Color
    let borderSoft: Color
    let borderStrong: Color
    let fg: Color
    let fgSecondary: Color
    let muted: Color
    let mutedDeep: Color
    let accent: Color
    let accentStrong: Color
    let amber: Color
    let rose: Color
    let sky: Color
    let diffAdd: Color
    let diffDel: Color
}

enum OpenDesignDayColor {
    private static var palette: OpenDesignDayPalette {
        switch Agentic30Theme.current {
        case .white:
            // Converted from day-white.html OKLCH tokens to sRGB for native SwiftUI rendering.
            OpenDesignDayPalette(
                bg: Color(red: 0.9698, green: 0.9778, blue: 0.9838),
                bgDeep: Color(red: 0.9371, green: 0.9530, blue: 0.9651),
                bgDarker: Color(red: 0.9015, green: 0.9227, blue: 0.9387),
                surface: Color(red: 1.0000, green: 1.0000, blue: 1.0000),
                surface2: Color(red: 0.9571, green: 0.9678, blue: 0.9758),
                elevated: Color(red: 1.0000, green: 1.0000, blue: 1.0000),
                hover: Color(red: 0.9089, green: 0.9274, blue: 0.9414),
                selected: Color(red: 0.8692, green: 0.8982, blue: 0.9200),
                border: Color(red: 0.7807, green: 0.8039, blue: 0.8214),
                borderSoft: Color(red: 0.8625, green: 0.8808, blue: 0.8947),
                borderStrong: Color(red: 0.6280, green: 0.6630, blue: 0.6892),
                fg: Color(red: 0.0769, green: 0.1081, blue: 0.1353),
                fgSecondary: Color(red: 0.2265, green: 0.2536, blue: 0.2777),
                muted: Color(red: 0.4009, green: 0.4261, blue: 0.4487),
                mutedDeep: Color(red: 0.5778, green: 0.6001, blue: 0.6202),
                accent: Color(red: 0.0000, green: 0.5144, blue: 0.2936),
                accentStrong: Color(red: 0.0000, green: 0.4477, blue: 0.2202),
                amber: Color(red: 0.9364, green: 0.6955, blue: 0.2742),
                rose: Color(red: 0.7566, green: 0.2345, blue: 0.2311),
                sky: Color(red: 0.0000, green: 0.5040, blue: 0.6955),
                diffAdd: Color(red: 0.0000, green: 0.4778, blue: 0.2025),
                diffDel: Color(red: 0.7429, green: 0.2211, blue: 0.2199)
            )
        case .dark:
            OpenDesignDayPalette(
                bg: Color(red: 0.0801, green: 0.0874, blue: 0.0928),
                bgDeep: Color(red: 0.0379, green: 0.0446, blue: 0.0497),
                bgDarker: Color(red: 0.0252, green: 0.0291, blue: 0.0322),
                surface: Color(red: 0.0544, green: 0.0614, blue: 0.0666),
                surface2: Color(red: 0.0714, green: 0.0786, blue: 0.0839),
                elevated: Color(red: 0.1053, green: 0.1147, blue: 0.1217),
                hover: Color(red: 0.1407, green: 0.1524, blue: 0.1611),
                selected: Color(red: 0.1756, green: 0.1918, blue: 0.2039),
                border: Color(red: 0.1501, green: 0.1619, blue: 0.1708),
                borderSoft: Color(red: 0.1128, green: 0.1242, blue: 0.1327),
                borderStrong: Color(red: 0.2421, green: 0.2634, blue: 0.2793),
                fg: Color(red: 0.9410, green: 0.9490, blue: 0.9550),
                fgSecondary: Color(red: 0.7328, green: 0.7455, blue: 0.7551),
                muted: Color(red: 0.4865, green: 0.5055, blue: 0.5198),
                mutedDeep: Color(red: 0.3263, green: 0.3486, blue: 0.3652),
                accent: Color(red: 0.2165, green: 0.8352, blue: 0.6244),
                accentStrong: Color(red: 0.0000, green: 0.7754, blue: 0.5051),
                amber: Color(red: 0.9364, green: 0.6955, blue: 0.2742),
                rose: Color(red: 0.9751, green: 0.4673, blue: 0.4400),
                sky: Color(red: 0.3475, green: 0.7738, blue: 0.9615),
                diffAdd: Color(red: 0.2284, green: 0.7286, blue: 0.4173),
                diffDel: Color(red: 0.9473, green: 0.4424, blue: 0.4166)
            )
        }
    }

    static var bg: Color { palette.bg }
    static var bgDeep: Color { palette.bgDeep }
    static var bgDarker: Color { palette.bgDarker }
    static var surface: Color { palette.surface }
    static var surface2: Color { palette.surface2 }
    static var elevated: Color { palette.elevated }
    static var hover: Color { palette.hover }
    static var selected: Color { palette.selected }
    static var border: Color { palette.border }
    static var borderSoft: Color { palette.borderSoft }
    static var borderStrong: Color { palette.borderStrong }
    static var fg: Color { palette.fg }
    static var fgSecondary: Color { palette.fgSecondary }
    static var muted: Color { palette.muted }
    static var mutedDeep: Color { palette.mutedDeep }
    static var accent: Color { palette.accent }
    static var accentStrong: Color { palette.accentStrong }
    static var amber: Color { palette.amber }
    static var rose: Color { palette.rose }
    static var sky: Color { palette.sky }
    static var diffAdd: Color { palette.diffAdd }
    static var diffDel: Color { palette.diffDel }

    static var accentDim: Color { accent.opacity(Agentic30Theme.current == .white ? 0.12 : 0.14) }
    static var accentLine: Color { accent.opacity(Agentic30Theme.current == .white ? 0.34 : 0.40) }
    static var amberDim: Color { amber.opacity(0.14) }
    static var amberLine: Color { amber.opacity(0.36) }
    static var roseDim: Color { rose.opacity(0.14) }
}

enum OpenDesignAccessibilityMetrics {
    static func borderLineWidth(isIncreasedContrast: Bool) -> CGFloat {
        isIncreasedContrast ? 1.5 : 1
    }
}

struct OpenDesignDayLayoutMetrics: Equatable {
    let railWidth: CGFloat
    let taskSidebarWidth: CGFloat
    let metaPanelWidth: CGFloat
    let mainHorizontalPadding: CGFloat
    let showsTaskSidebar: Bool
    let supportsMetaPanel: Bool
    let showsMetaPanel: Bool

    init(width: CGFloat, isMetaPanelExpanded: Bool = true) {
        if width <= 860 {
            railWidth = 48
            taskSidebarWidth = 0
            metaPanelWidth = 0
            mainHorizontalPadding = 24
            showsTaskSidebar = false
            supportsMetaPanel = false
        } else if width <= 1100 {
            railWidth = 48
            taskSidebarWidth = 200
            metaPanelWidth = 0
            mainHorizontalPadding = 24
            showsTaskSidebar = true
            supportsMetaPanel = false
        } else if width <= 1280 {
            railWidth = 48
            taskSidebarWidth = 220
            metaPanelWidth = 252
            mainHorizontalPadding = 24
            showsTaskSidebar = true
            supportsMetaPanel = true
        } else {
            railWidth = 52
            taskSidebarWidth = 240
            metaPanelWidth = 280
            mainHorizontalPadding = 28
            showsTaskSidebar = true
            supportsMetaPanel = true
        }
        showsMetaPanel = supportsMetaPanel && isMetaPanelExpanded
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
    let submitStructuredPromptChoice: (OpenDesignDayAnswerSubmission) -> Void
    let newsMarketRadar: NewsMarketRadarSnapshot
    let refreshNewsMarketRadar: () -> Void
    let prepareNewsMarketRadar: () -> Void
    let bipResearch: BipResearchSnapshot
    let refreshBipResearch: () -> Void
    let prepareBipResearch: () -> Void
    let openNewsSettings: () -> Void
    let day1DocPreviews: [IddDocPreview]
    let day1HandoffPromptCard: AnyView?
    let activeDay1HandoffDocType: String?
    let pendingDay1HandoffDocType: String?
    let day1HandoffError: String?
    let day1SituationSummary: Day1SituationSummary?
    let onChooseDay1SituationGoal: (String) -> Void
    let startDay1DocHandoff: (String, [String: Any]) -> Void
    let completeDay: () -> Void
    let advanceToNextDay: () -> Void
    let selectDay: (Int) -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Binding private var interaction: OpenDesignDayInteractionState
    @Binding private var selectedReferencePage: OpenDesignReferencePageKind?
    @State private var isSearchPresented = false
    @State private var searchQuery = ""
    @State private var selectedSearchIndex = 0
    @State private var pendingScrollRequest: OpenDesignScrollRequest?
    @State private var searchPulseTarget: String?
    @State private var completionBurstID = 0
    @State private var requestedDayCompletionID: String?
    @State private var keyboardMonitor: Any?
    @State private var isRightSidebarExpanded = false

    init(
        content: OpenDesignDayContent = .day1,
        interaction: Binding<OpenDesignDayInteractionState>,
        selectedReferencePage: Binding<OpenDesignReferencePageKind?> = .constant(nil),
        openSettings: @escaping () -> Void,
        submitStructuredPromptChoice: @escaping (OpenDesignDayAnswerSubmission) -> Void = { _ in },
        newsMarketRadar: NewsMarketRadarSnapshot = .empty,
        refreshNewsMarketRadar: @escaping () -> Void = {},
        prepareNewsMarketRadar: @escaping () -> Void = {},
        bipResearch: BipResearchSnapshot = .empty,
        refreshBipResearch: @escaping () -> Void = {},
        prepareBipResearch: @escaping () -> Void = {},
        openNewsSettings: @escaping () -> Void = {},
        day1DocPreviews: [IddDocPreview] = [],
        day1HandoffPromptCard: AnyView? = nil,
        activeDay1HandoffDocType: String? = nil,
        pendingDay1HandoffDocType: String? = nil,
        day1HandoffError: String? = nil,
        day1SituationSummary: Day1SituationSummary? = nil,
        onChooseDay1SituationGoal: @escaping (String) -> Void = { _ in },
        startDay1DocHandoff: @escaping (String, [String: Any]) -> Void = { _, _ in },
        completeDay: @escaping () -> Void = {},
        advanceToNextDay: @escaping () -> Void = {},
        selectDay: @escaping (Int) -> Void = { _ in }
    ) {
        self.content = content
        _interaction = interaction
        _selectedReferencePage = selectedReferencePage
        self.openSettings = openSettings
        self.submitStructuredPromptChoice = submitStructuredPromptChoice
        self.newsMarketRadar = newsMarketRadar
        self.refreshNewsMarketRadar = refreshNewsMarketRadar
        self.prepareNewsMarketRadar = prepareNewsMarketRadar
        self.bipResearch = bipResearch
        self.refreshBipResearch = refreshBipResearch
        self.prepareBipResearch = prepareBipResearch
        self.openNewsSettings = openNewsSettings
        self.day1DocPreviews = day1DocPreviews
        self.day1HandoffPromptCard = day1HandoffPromptCard
        self.activeDay1HandoffDocType = activeDay1HandoffDocType
        self.pendingDay1HandoffDocType = pendingDay1HandoffDocType
        self.day1HandoffError = day1HandoffError
        self.day1SituationSummary = day1SituationSummary
        self.onChooseDay1SituationGoal = onChooseDay1SituationGoal
        self.startDay1DocHandoff = startDay1DocHandoff
        self.completeDay = completeDay
        self.advanceToNextDay = advanceToNextDay
        self.selectDay = selectDay
    }

    private var searchResults: [OpenDesignDayContent.SearchItem] {
        OpenDesignSearchPresentation.displayOrdered(
            content.rankedSearchItems(query: searchQuery)
                .filter(interaction.isSearchItemAvailable)
        )
    }

    var body: some View {
        GeometryReader { geometry in
            let layout = OpenDesignDayLayoutMetrics(
                width: geometry.size.width,
                isMetaPanelExpanded: isRightSidebarExpanded
            )

            ZStack {
                OpenDesignDayShell(
                    content: content,
                    interaction: $interaction,
                    selectedReferencePage: selectedReferencePage,
                    pendingScrollRequest: $pendingScrollRequest,
                    searchPulseTarget: $searchPulseTarget,
                    layout: layout,
                    openSearch: openSearch,
                    toggleSearch: toggleSearch,
                    activateRailItem: activateRailItem,
                    newsMarketRadar: newsMarketRadar,
                    refreshNewsMarketRadar: refreshNewsMarketRadar,
                    prepareNewsMarketRadar: prepareNewsMarketRadar,
                    bipResearch: bipResearch,
                    refreshBipResearch: refreshBipResearch,
                    prepareBipResearch: prepareBipResearch,
                    openNewsSettings: openNewsSettings,
                    day1DocPreviews: day1DocPreviews,
                    day1HandoffPromptCard: day1HandoffPromptCard,
                    activeDay1HandoffDocType: activeDay1HandoffDocType,
                    pendingDay1HandoffDocType: pendingDay1HandoffDocType,
                    day1HandoffError: day1HandoffError,
                    day1SituationSummary: day1SituationSummary,
                    onChooseDay1SituationGoal: onChooseDay1SituationGoal,
                    startDay1DocHandoff: startDay1DocHandoff,
                    submitStep: submitStep,
                    acceptMission: acceptMission,
                    completeDayAction: completeDayAction,
                    advanceToNextDay: advanceToNextDay,
                    selectDay: selectDay,
                    shareSummary: dayShareSummary,
                    toggleRightSidebar: toggleRightSidebar
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
                    RealisticConfettiBurst(trigger: completionBurstID)
                        .id(completionBurstID)
                        .accessibilityIdentifier("opendesign.day.confetti")
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
        if item.kind == .task,
           let dayNumber = openDesignFoundationDayNumber(taskID: item.id) {
            closeSearch()
            selectedReferencePage = nil
            selectDay(dayNumber)
            return
        }
        if let referencePage = OpenDesignReferencePageKind(searchItemID: item.id) {
            selectedReferencePage = referencePage
            closeSearch()
            return
        }

        switch item.route {
        case .settings:
            closeSearch()
            selectedReferencePage = nil
            openSettings()
        case .search:
            openSearch()
        case .today, .inert:
            closeSearch()
            selectedReferencePage = nil
            let target = OpenDesignSectionAnchor(rawValue: item.targetSectionID ?? "") ?? .top
            revealIntroIfNeeded(for: target)
            focusWorkflowStepIfNeeded(for: target)
            requestScroll(to: target == .top || target == .signals || target == .mission ? target : .top)
            pulseSearchTarget(target.rawValue)
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
            requestScroll(to: .top)
            return
        }

        if let referencePage = OpenDesignReferencePageKind(railItemID: item.id) {
            selectedReferencePage = referencePage
            return
        }

        switch item.route {
        case .settings:
            selectedReferencePage = nil
            openSettings()
        case .search:
            openSearch()
        case .today:
            selectedReferencePage = nil
            requestScroll(to: .top)
        case .inert:
            break
        }
    }

    private func acceptMission() {
        guard !interaction.missionAccepted else { return }
        withAnimation(.spring(response: reduceMotion ? 0 : 0.26, dampingFraction: 0.90)) {
            interaction.acceptMissionForStepFlow()
        }
        requestScroll(to: .top)
    }

    private func submitStep(_ step: OpenDesignDayContent.InterviewStep, selectedChoiceID: Int) {
        if selectedChoiceID == OpenDesignDayInteractionState.freeformChoiceID,
           interaction.trimmedFreeformAnswer(stepID: step.id).isEmpty {
            return
        }
        if interaction.submittedChoices[step.id] == selectedChoiceID {
            withAnimation(.spring(response: reduceMotion ? 0 : 0.28, dampingFraction: 0.90)) {
                interaction.advancePastSubmittedChoice(stepID: step.id)
            }
            requestScroll(to: .top)
            return
        }
        withAnimation(.spring(response: reduceMotion ? 0 : 0.28, dampingFraction: 0.90)) {
            interaction.selectChoice(stepID: step.id, choiceID: selectedChoiceID)
            interaction.recordSubmittedChoice(stepID: step.id, choiceID: selectedChoiceID)
        }
        if let submission = answerSubmission(for: step, selectedChoiceID: selectedChoiceID) {
            submitStructuredPromptChoice(submission)
        }
        requestScroll(to: .top)
    }

    private func submitActiveStep() {
        if advanceIntroIfNeeded() {
            return
        }
        if !interaction.missionAccepted {
            acceptMission()
            return
        }
        if let stepID = interaction.activeInterviewStepID,
           let step = content.interviewSteps.first(where: { $0.id == stepID }),
           let selectedChoice = interaction.selectedChoices[step.id] {
            submitStep(step, selectedChoiceID: selectedChoice)
            return
        }
        let visibleSteps = content.interviewSteps.filter { $0.id <= interaction.highestVisibleInterviewStep }
        if let step = visibleSteps.reversed().first(where: { step in
            guard let selectedChoice = interaction.selectedChoices[step.id] else { return false }
            return interaction.submittedChoices[step.id] != selectedChoice
        }) {
            if let selectedChoice = interaction.selectedChoices[step.id] {
                submitStep(step, selectedChoiceID: selectedChoice)
            }
            return
        }
        if interaction.allInterviewsSubmitted {
            if !interaction.dayCompleted {
                completeDayAction()
            } else {
                advanceToNextDay()
            }
        }
    }

    private func focusCurrentProgress() {
        if interaction.dayCompleted {
            advanceToNextDay()
            return
        }
        if !interaction.missionAccepted {
            acceptMission()
            return
        }
        withAnimation(.spring(response: reduceMotion ? 0 : 0.24, dampingFraction: 0.90)) {
            interaction.focusWorkflowStep(interaction.normalizedActiveStepID)
        }
        requestScroll(to: interaction.currentProgressScrollTarget)
    }

    private func toggleRightSidebar() {
        if reduceMotion {
            isRightSidebarExpanded.toggle()
        } else {
            withAnimation(.spring(response: 0.24, dampingFraction: 0.88)) {
                isRightSidebarExpanded.toggle()
            }
        }
    }

    private func advanceIntroIfNeeded() -> Bool {
        if !interaction.missionAccepted {
            acceptMission()
            return true
        }
        return false
    }

    private func revealIntroIfNeeded(for target: OpenDesignSectionAnchor) {
        switch target {
        case .top:
            break
        case .signals:
            revealIntroStage(.signals)
        default:
            revealIntroStage(.mission)
        }
    }

    private func focusWorkflowStepIfNeeded(for target: OpenDesignSectionAnchor) {
        let stepID: Int?
        switch target {
        case .mission, .missionAction:
            stepID = 0
        case .interview1, .interview1Options:
            stepID = 1
        case .interview2, .interview2Options:
            stepID = 2
        case .interview3, .interview3Options:
            stepID = 3
        case .interview4, .interview4Options:
            stepID = 4
        case .interview5, .interview5Options:
            stepID = 5
        case .finalIcp, .finalIcpAction:
            stepID = interaction.finalStepID
        default:
            stepID = nil
        }

        guard let stepID else { return }
        withAnimation(.spring(response: reduceMotion ? 0 : 0.24, dampingFraction: 0.90)) {
            interaction.focusWorkflowStep(stepID)
        }
    }

    private func requestScroll(
        to target: OpenDesignSectionAnchor,
        placement: OpenDesignScrollPlacement = .sectionContext
    ) {
        pendingScrollRequest = OpenDesignScrollRequest(target: target, placement: placement)
    }

    private func revealIntroStage(_ stage: OpenDesignIntroStage) {
        guard interaction.introStage < stage else { return }
        withAnimation(.spring(response: reduceMotion ? 0 : 0.24, dampingFraction: 0.92)) {
            interaction.introStage = stage
        }
    }

    private func completeDayAction() {
        completeDayLocally()
        requestDayCompletionOnce()
    }

    private func completeDayLocally() {
        let shouldRunBurst = !interaction.dayCompleted && !reduceMotion
        withAnimation(.spring(response: reduceMotion ? 0 : 0.30, dampingFraction: 0.88)) {
            interaction.dayCompleted = true
            interaction.activeStepID = interaction.finalStepID
            interaction.maxUnlockedStepID = interaction.finalStepID
        }
        if shouldRunBurst {
            runCompletionBurst()
        }
        requestScroll(to: .completion)
    }

    private func requestDayCompletionOnce() {
        let completionID = content.market.map { "day-\($0.dayNumber)" } ?? "day-1"
        guard requestedDayCompletionID != completionID else { return }
        requestedDayCompletionID = completionID
        completeDay()
    }

    private func runCompletionBurst() {
        completionBurstID += 1
        let currentID = completionBurstID
        DispatchQueue.main.asyncAfter(deadline: .now() + RealisticConfettiRecipe.cleanupDelay + 0.15) {
            if completionBurstID == currentID {
                withAnimation(.easeOut(duration: 0.16)) {
                    completionBurstID = 0
                }
            }
        }
    }

    private var dayShareSummary: String {
        if let market = content.market {
            let keywords = market.lockedKeywords.map { "- \($0.label): \($0.value)" }.joined(separator: "\n")
            let alternatives = market.topAlternatives.prefix(3).map { "- \($0.label): \($0.value)" }.joined(separator: "\n")
            return """
            Agentic30 Day \(market.dayNumber) · Foundation / Market Signals
            \(market.title)
            시장 신호 강도: \(market.signalStrength.score) \(market.signalStrength.total) · \(market.signalStrength.tag)

            잠긴 키워드
            \(keywords)

            상위 대안
            \(alternatives)
            """
        }

        let progress: String
        if interaction.dayCompleted {
            progress = "Day 1 완료"
        } else if interaction.allInterviewsSubmitted {
            progress = "STEP 3 / 3 · 핵심 가설 확정 대기"
        } else {
            progress = "STEP 2 / 3 · 질문 \(interaction.highestVisibleInterviewStep) / \(content.interviewSteps.count)"
        }

        let choiceLines = content.interviewSteps.map { step -> String in
            let value = selectedTitle(for: step.id) ?? "미선택"
            return "- \(step.title): \(value)"
        }.joined(separator: "\n")

        return """
        Agentic30 Day 1 · Foundation / ICP 좁히기
        먼저 도울 사람을 정해요
        진행: \(progress) · \(interaction.progressStepCount)/3 · \(interaction.progressPercent)%

        \(choiceLines)
        """
    }

    private func selectedTitle(for stepID: Int) -> String? {
        content.interviewSteps.first(where: { $0.id == stepID })?.selectedAnswerTitle(in: interaction)
    }

    private func answerSubmission(
        for step: OpenDesignDayContent.InterviewStep,
        selectedChoiceID: Int
    ) -> OpenDesignDayAnswerSubmission? {
        if selectedChoiceID == OpenDesignDayInteractionState.freeformChoiceID {
            let freeform = interaction.trimmedFreeformAnswer(stepID: step.id)
            guard !freeform.isEmpty else { return nil }
            return OpenDesignDayAnswerSubmission(
                questionId: "day-step-\(step.id)",
                dimension: step.dimension,
                questionTitle: step.title,
                questionPrompt: step.prompt,
                answerId: "freeform",
                answerTitle: freeform,
                answerDetail: "직접 입력",
                freeformAnswer: freeform,
                isAntiSignal: false
            )
        }
        guard let option = step.options.first(where: { $0.id == selectedChoiceID }) else {
            return nil
        }
        let freeform = interaction.freeformAnswers[step.id] ?? (step.id == 1 ? interaction.freeformAnswer : "")
        return OpenDesignDayAnswerSubmission(
            questionId: "day-step-\(step.id)",
            dimension: step.dimension,
            questionTitle: step.title,
            questionPrompt: step.prompt,
            answerId: "\(option.id)",
            answerTitle: option.title,
            answerDetail: option.detail,
            freeformAnswer: freeform,
            isAntiSignal: option.isAntiSignal
        )
    }
}

struct OpenDesignDayShell: View {
    let content: OpenDesignDayContent
    @Binding var interaction: OpenDesignDayInteractionState
    let selectedReferencePage: OpenDesignReferencePageKind?
    @Binding var pendingScrollRequest: OpenDesignScrollRequest?
    @Binding var searchPulseTarget: String?
    let layout: OpenDesignDayLayoutMetrics
    let openSearch: () -> Void
    let toggleSearch: () -> Void
    let activateRailItem: (OpenDesignDayContent.RailItem) -> Void
    let newsMarketRadar: NewsMarketRadarSnapshot
    let refreshNewsMarketRadar: () -> Void
    let prepareNewsMarketRadar: () -> Void
    let bipResearch: BipResearchSnapshot
    let refreshBipResearch: () -> Void
    let prepareBipResearch: () -> Void
    let openNewsSettings: () -> Void
    let day1DocPreviews: [IddDocPreview]
    let day1HandoffPromptCard: AnyView?
    let activeDay1HandoffDocType: String?
    let pendingDay1HandoffDocType: String?
    let day1HandoffError: String?
    let day1SituationSummary: Day1SituationSummary?
    let onChooseDay1SituationGoal: (String) -> Void
    let startDay1DocHandoff: (String, [String: Any]) -> Void
    let submitStep: (OpenDesignDayContent.InterviewStep, Int) -> Void
    let acceptMission: () -> Void
    let completeDayAction: () -> Void
    let advanceToNextDay: () -> Void
    let selectDay: (Int) -> Void
    let shareSummary: String
    let toggleRightSidebar: () -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        VStack(spacing: 0) {
            if let selectedReferencePage {
                OpenDesignReferenceTitlebar(
                    page: OpenDesignReferenceCatalog.page(selectedReferencePage),
                    openSearch: toggleSearch,
                    isRightSidebarVisible: layout.showsMetaPanel,
                    toggleRightSidebar: toggleRightSidebar,
                    refreshAction: selectedReferencePage == .news
                        ? refreshNewsMarketRadar
                        : selectedReferencePage == .bipLog ? refreshBipResearch : nil
                )
            } else if let market = content.market {
                OpenDesignMarketTitlebar(
                    market: market,
                    openSearch: toggleSearch,
                    shareSummary: shareSummary,
                    isRightSidebarVisible: layout.showsMetaPanel,
                    toggleRightSidebar: toggleRightSidebar
                )
            } else {
                OpenDesignDayTitlebar(
                    openSearch: toggleSearch,
                    shareSummary: shareSummary,
                    isRightSidebarVisible: layout.showsMetaPanel,
                    toggleRightSidebar: toggleRightSidebar
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
                        openSearch: openSearch,
                        newsMarketRadar: newsMarketRadar,
                        refreshNewsMarketRadar: refreshNewsMarketRadar,
                        prepareNewsMarketRadar: prepareNewsMarketRadar,
                        bipResearch: bipResearch,
                        refreshBipResearch: refreshBipResearch,
                        prepareBipResearch: prepareBipResearch,
                        openNewsSettings: openNewsSettings
                    )
                    .transition(reduceMotion ? .opacity : .opacity.combined(with: .scale(scale: 0.995)))
                } else {
                    if layout.showsTaskSidebar {
                        ZStack {
                            OpenDesignTaskSidebarView(
                                content: content,
                                openSearch: openSearch,
                                selectDay: selectDay
                            )
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

                    if let market = content.market {
                        OpenDesignMarketMainView(
                            market: market,
                            pendingScrollRequest: $pendingScrollRequest,
                            searchPulseTarget: $searchPulseTarget,
                            completeDay: completeDayAction,
                            layout: layout
                        )
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                    } else {
                        OpenDesignDayMainView(
                            content: content,
                            interaction: $interaction,
                            pendingScrollRequest: $pendingScrollRequest,
                            searchPulseTarget: $searchPulseTarget,
                            submitStep: submitStep,
                            acceptMission: acceptMission,
                            completeDayAction: completeDayAction,
                            advanceToNextDay: advanceToNextDay,
                            day1DocPreviews: day1DocPreviews,
                            day1HandoffPromptCard: day1HandoffPromptCard,
                            activeDay1HandoffDocType: activeDay1HandoffDocType,
                            pendingDay1HandoffDocType: pendingDay1HandoffDocType,
                            day1HandoffError: day1HandoffError,
                            day1SituationSummary: day1SituationSummary,
                            onChooseDay1SituationGoal: onChooseDay1SituationGoal,
                            startDay1DocHandoff: startDay1DocHandoff,
                            layout: layout
                        )
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                    }

                    if layout.showsMetaPanel {
                        ZStack {
                            if let market = content.market {
                                OpenDesignMarketMetaPanelView(market: market)
                            } else {
                                OpenDesignMetaPanelView(content: content, interaction: $interaction)
                            }
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

private struct OpenDesignMarketTitlebar: View {
    let market: OpenDesignDayContent.Market
    let openSearch: () -> Void
    let shareSummary: String
    let isRightSidebarVisible: Bool
    let toggleRightSidebar: () -> Void

    @State private var didCopyShare = false

    var body: some View {
        ZStack {
            HStack(spacing: 8) {
                Spacer(minLength: 82)
                Text(market.titlebarTitle)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(OpenDesignDayColor.fg)
                Text("/")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(OpenDesignDayColor.mutedDeep)
                Text(market.titlebarDetail)
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
                    accessibilityIdentifier: "opendesign.day2.search",
                    action: openSearch
                )
                OpenDesignToolbarButton(
                    systemImage: "square.and.arrow.up",
                    label: didCopyShare ? "공유 복사됨 ✓" : "공유 · ⌘ ⇧ S",
                    keyboardKey: "s",
                    keyboardModifiers: [.command, .shift],
                    accessibilityIdentifier: "opendesign.day2.share",
                    action: copyShareSummary
                )
                OpenDesignToolbarButton(
                    systemImage: "sidebar.right",
                    label: isRightSidebarVisible ? "우측 사이드바 닫기" : "우측 사이드바 열기",
                    isOn: isRightSidebarVisible,
                    accessibilityIdentifier: "opendesign.day2.meta.toggle",
                    action: toggleRightSidebar
                )
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

private struct OpenDesignDayTitlebar: View {
    let openSearch: () -> Void
    let shareSummary: String
    let isRightSidebarVisible: Bool
    let toggleRightSidebar: () -> Void

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
                OpenDesignToolbarButton(
                    systemImage: "sidebar.right",
                    label: isRightSidebarVisible ? "우측 사이드바 닫기" : "우측 사이드바 열기",
                    isOn: isRightSidebarVisible,
                    accessibilityIdentifier: "opendesign.day.meta.toggle",
                    action: toggleRightSidebar
                )
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
    let selectDay: (Int) -> Void

    @State private var expandedGroupIDs: Set<String> = []

    private var expansionSignature: String {
        content.taskGroups
            .map { "\($0.id):\($0.isExpandedByDefault):\($0.isLocked)" }
            .joined(separator: "|")
    }

    private var defaultExpandedGroupIDs: Set<String> {
        Set(content.taskGroups.filter(\.isExpandedByDefault).map(\.id))
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                HStack(spacing: 6) {
                    Text("30일 챌린지")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(OpenDesignDayColor.fg)
                    Text(content.market.map { "\($0.dayNumber) / 30" } ?? "1 / 30")
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
                        let isExpanded = expandedGroupIDs.contains(group.id)

                        OpenDesignTaskGroupHeader(
                            group: group,
                            isExpanded: isExpanded,
                            toggle: { toggleGroup(group) }
                        )
                        .padding(.top, group.id == "week1" ? 10 : 14)

                        if isExpanded {
                            ForEach(group.tasks) { task in
                                OpenDesignTaskRow(task: task, selectDay: selectDay)
                            }
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
        .onAppear {
            expandedGroupIDs = defaultExpandedGroupIDs
        }
        .onChange(of: expansionSignature) { _, _ in
            expandedGroupIDs = defaultExpandedGroupIDs
        }
    }

    private func toggleGroup(_ group: OpenDesignDayContent.TaskGroup) {
        if expandedGroupIDs.contains(group.id) {
            expandedGroupIDs.remove(group.id)
        } else {
            expandedGroupIDs.insert(group.id)
        }
    }
}

private struct OpenDesignTaskGroupHeader: View {
    let group: OpenDesignDayContent.TaskGroup
    let isExpanded: Bool
    let toggle: () -> Void

    @State private var isHovered = false

    var body: some View {
        Button(action: toggle) {
            HStack(spacing: 6) {
                Image(systemName: isExpanded ? "chevron.down" : "chevron.right")
                    .font(.system(size: 8, weight: .bold))
                    .foregroundStyle(isHovered ? OpenDesignDayColor.muted : OpenDesignDayColor.mutedDeep)
                    .frame(width: 10)

                Text(group.title)
                    .lineLimit(1)

                Spacer(minLength: 6)

                if group.isLocked {
                    Image(systemName: "lock.fill")
                        .font(.system(size: 8, weight: .bold))
                        .foregroundStyle(OpenDesignDayColor.mutedDeep)
                        .accessibilityHidden(true)
                }

                Text(group.meta)
                    .lineLimit(1)
            }
            .font(.system(size: 10, weight: .medium, design: .monospaced))
            .textCase(.uppercase)
            .foregroundStyle(isHovered ? OpenDesignDayColor.muted : OpenDesignDayColor.mutedDeep)
            .padding(.horizontal, 8)
            .padding(.vertical, 5)
            .openDesignHoverRow(
                isHovered: isHovered,
                cornerRadius: 6,
                fill: Color.clear,
                hoverFill: OpenDesignDayColor.hover,
                border: Color.clear,
                hoverBorder: Color.clear
            )
        }
        .buttonStyle(OpenDesignInteractiveButtonStyle())
        .onHover { isHovered = $0 }
        .accessibilityLabel(accessibilityLabel)
        .accessibilityValue(isExpanded ? "expanded" : "collapsed")
        .accessibilityIdentifier("opendesign.day.taskGroup.\(group.id)")
    }

    private var accessibilityLabel: String {
        if let lockNote = group.lockNote {
            return "\(group.title), \(lockNote)"
        }
        return group.title
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
    let selectDay: (Int) -> Void
    @State private var isHovered = false

    private var foreground: Color {
        switch task.state {
        case .done: return OpenDesignDayColor.muted
        case .active: return OpenDesignDayColor.fg
        case .pending: return OpenDesignDayColor.fgSecondary
        case .locked: return OpenDesignDayColor.fgSecondary.opacity(0.55)
        }
    }

    var body: some View {
        let isLocked = task.state == .locked
        let isActive = task.state == .active
        let isDone = task.state == .done
        let isInteractiveHover = isHovered && !isLocked
        let dayNumber = openDesignFoundationDayNumber(taskID: task.id)

        Button {
            guard let dayNumber, !isLocked else { return }
            selectDay(dayNumber)
        } label: {
            HStack(alignment: .top, spacing: 9) {
                statusIcon
                    .frame(width: 18, height: 18)
                    .padding(.top, 2)
                    .accessibilityHidden(true)

                VStack(alignment: .leading, spacing: 2) {
                    Text(task.title)
                        .font(.system(size: 12.5, weight: .medium))
                        .foregroundStyle(isDone ? OpenDesignDayColor.muted : isLocked ? foreground : isActive || isInteractiveHover ? OpenDesignDayColor.fg : OpenDesignDayColor.fgSecondary)
                        .lineLimit(1)
                    HStack(spacing: 6) {
                        Text(task.day)
                            .foregroundStyle(task.state == .locked ? OpenDesignDayColor.mutedDeep : isDone ? OpenDesignDayColor.muted : OpenDesignDayColor.accent)
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
        }
        .buttonStyle(OpenDesignInteractiveButtonStyle(isDisabled: isLocked || dayNumber == nil))
        .disabled(isLocked || dayNumber == nil)
        .opacity(isLocked ? 0.66 : 1)
        .onHover { isHovered = $0 }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(isLocked ? "\(task.day) \(task.title), 잠금" : isDone ? "\(task.day) \(task.title), 완료" : "\(task.day) \(task.title)")
        .accessibilityValue(isLocked ? "locked" : isDone ? "done" : isActive || isInteractiveHover ? "active" : "inactive")
        .accessibilityIdentifier("opendesign.day.task.\(task.id)")
    }

    @ViewBuilder
    private var statusIcon: some View {
        switch task.state {
        case .done:
            Text("✓")
                .font(.system(size: 9, weight: .bold, design: .monospaced))
                .foregroundStyle(OpenDesignDayColor.bgDeep)
                .frame(width: 14, height: 14)
                .background(Circle().fill(OpenDesignDayColor.accent))
        case .active:
            OpenDesignTaskProgressSpinner()
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

private struct OpenDesignTaskProgressSpinner: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var rotation: Double = 0

    var body: some View {
        ZStack {
            Circle()
                .stroke(OpenDesignDayColor.muted, lineWidth: 1.5)
            Circle()
                .trim(from: 0, to: 0.25)
                .stroke(
                    OpenDesignDayColor.accent,
                    style: StrokeStyle(lineWidth: 1.5, lineCap: .butt)
                )
                .rotationEffect(.degrees(rotation - 90))
        }
        .frame(width: 12, height: 12)
        .onAppear {
            updateAnimation(reduceMotion: reduceMotion)
        }
        .onChange(of: reduceMotion) { _, newValue in
            updateAnimation(reduceMotion: newValue)
        }
    }

    private func updateAnimation(reduceMotion: Bool) {
        rotation = 0
        guard !reduceMotion else { return }
        DispatchQueue.main.async {
            withAnimation(.linear(duration: 2).repeatForever(autoreverses: false)) {
                rotation = 360
            }
        }
    }
}

struct OpenDesignInlineSegment: Hashable {
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

struct OpenDesignInlineMarkdownEmphasisRun: Hashable {
    let text: String
    let isEmphasized: Bool
}

struct OpenDesignAlignmentDisplayRow: Hashable, Identifiable {
    let id: String
    let label: String
    let value: String
    let isAccent: Bool
}

func openDesignInlineMarkdownEmphasisRuns(in text: String) -> [OpenDesignInlineMarkdownEmphasisRun] {
    guard !text.isEmpty else { return [] }

    var runs: [OpenDesignInlineMarkdownEmphasisRun] = []
    var cursor = text.startIndex

    while cursor < text.endIndex {
        guard let opening = text[cursor...].range(of: "**") else {
            runs.append(OpenDesignInlineMarkdownEmphasisRun(text: String(text[cursor...]), isEmphasized: false))
            break
        }

        guard let closing = text[opening.upperBound...].range(of: "**") else {
            runs.append(OpenDesignInlineMarkdownEmphasisRun(text: String(text[cursor...]), isEmphasized: false))
            break
        }

        if opening.upperBound == closing.lowerBound {
            runs.append(OpenDesignInlineMarkdownEmphasisRun(text: String(text[cursor..<closing.upperBound]), isEmphasized: false))
            cursor = closing.upperBound
            continue
        }

        if cursor < opening.lowerBound {
            runs.append(OpenDesignInlineMarkdownEmphasisRun(text: String(text[cursor..<opening.lowerBound]), isEmphasized: false))
        }
        runs.append(OpenDesignInlineMarkdownEmphasisRun(text: String(text[opening.upperBound..<closing.lowerBound]), isEmphasized: true))
        cursor = closing.upperBound
    }

    return runs
}

func openDesignAlignmentDisplayRows(for alignmentPlan: Day1AlignmentPlan) -> [OpenDesignAlignmentDisplayRow] {
    [
        ("goal", openDesignAlignmentDisplayLabel(for: "goal"), alignmentPlan.projectGoal, false),
        ("icp", openDesignAlignmentDisplayLabel(for: "icp"), alignmentPlan.alignmentStatement.icp, false),
        ("pain", openDesignAlignmentDisplayLabel(for: "pain"), alignmentPlan.alignmentStatement.painPoint, false),
        ("outcome", openDesignAlignmentDisplayLabel(for: "outcome"), alignmentPlan.alignmentStatement.outcome, true),
    ].map { key, label, rawValue, isAccent in
        OpenDesignAlignmentDisplayRow(
            id: key,
            label: label,
            value: openDesignAlignmentDisplayValue(key: key, label: label, rawValue: rawValue, alignmentPlan: alignmentPlan),
            isAccent: isAccent
        )
    }
}

func openDesignAlignmentDisplayLabel(for key: String, fallback: String = "") -> String {
    switch key {
    case "project": return "프로젝트"
    case "goal": return "목표"
    case "icp": return "고객"
    case "pain", "pain_point": return "문제"
    case "outcome": return "확인할 행동"
    case "evidence": return "근거"
    default:
        let trimmed = fallback.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? "항목" : trimmed
    }
}

private func openDesignAlignmentDisplayValue(
    key: String,
    label: String,
    rawValue: String,
    alignmentPlan: Day1AlignmentPlan
) -> String {
    openDesignDisplaySignalDigestValue(
        for: Day1SignalDigestRow(key: key, label: label, value: rawValue, tone: nil),
        alignmentPlan: alignmentPlan
    )
}

func openDesignDisplaySignalDigestValue(
    for row: Day1SignalDigestRow,
    alignmentPlan: Day1AlignmentPlan
) -> String {
    let value = row.value.trimmingCharacters(in: .whitespacesAndNewlines)
    if row.key == "project" {
        return openDesignDisplayProjectDigestValue(value)
    }
    guard row.key != "evidence",
          openDesignLooksLikeMarkdownDocumentReference(value)
    else {
        return value
    }
    return openDesignSignalDigestFallbackValue(for: row.key, alignmentPlan: alignmentPlan)
}

func openDesignDisplayProjectDigestValue(_ value: String) -> String {
    let parts = value
        .components(separatedBy: "·")
        .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
        .filter { !$0.isEmpty }
    let product = parts.first { !$0.lowercased().hasPrefix("quality") } ?? parts.first ?? value
    return openDesignDisplayProductName(product) ?? "이 프로젝트"
}

func openDesignDisplayProductName(_ value: String?) -> String? {
    guard let value else { return nil }
    let display = value
        .replacingOccurrences(of: #"\*\*([^*]+)\*\*"#, with: "$1", options: .regularExpression)
        .replacingOccurrences(of: #"__([^_]+)__"#, with: "$1", options: .regularExpression)
        .replacingOccurrences(of: #"`([^`]+)`"#, with: "$1", options: .regularExpression)
        .replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
        .trimmingCharacters(in: .whitespacesAndNewlines)
        .replacingOccurrences(of: #"[.。．]+$"#, with: "", options: .regularExpression)
    guard !display.isEmpty else { return nil }
    if openDesignLooksLikeEphemeralWorkspaceName(display) {
        return nil
    }
    return display
}

func openDesignLooksLikeEphemeralWorkspaceName(_ value: String) -> Bool {
    let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else { return true }
    let comparable = trimmed
        .lowercased()
        .replacingOccurrences(of: #"[_\s]+"#, with: "-", options: .regularExpression)
    if comparable.range(
        of: #"[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}"#,
        options: [.regularExpression, .caseInsensitive]
    ) != nil {
        return true
    }
    if comparable.range(of: #"^workspace-[a-z0-9]+$"#, options: [.regularExpression, .caseInsensitive]) != nil {
        return true
    }
    if comparable.range(of: #"^(?:tmp|temp|test)(?:[-_.]|$)"#, options: [.regularExpression, .caseInsensitive]) != nil {
        return true
    }
    if comparable.range(of: #"(?:^|[-_.])(?:tmp|temp|test|ui-test|ui-testing)(?:[-_.]|$)"#, options: [.regularExpression, .caseInsensitive]) != nil {
        return true
    }
    if comparable.range(of: #"^agentic30-ui(?:[-_.]|$)"#, options: [.regularExpression, .caseInsensitive]) != nil {
        return true
    }
    return false
}

private func openDesignSignalDigestFallbackValue(
    for key: String,
    alignmentPlan: Day1AlignmentPlan
) -> String {
    switch key {
    case "icp":
        return openDesignUsableSignalText(alignmentPlan.signals.likelyUsers.first) ?? "첫 고객 후보 확인 필요"
    case "goal":
        return openDesignUsableSignalText(alignmentPlan.projectGoal) ?? "목표 확인 필요"
    case "pain":
        return openDesignUsableSignalText(alignmentPlan.signals.problem)
            ?? openDesignUsableSignalText(alignmentPlan.alignmentStatement.painPoint)
            ?? "핵심 문제 확인 필요"
    case "outcome":
        return openDesignUsableSignalText(alignmentPlan.alignmentStatement.outcome) ?? "확인할 행동 필요"
    default:
        return "확인 필요"
    }
}

private func openDesignUsableSignalText(_ value: String?) -> String? {
    guard let value else { return nil }
    let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty,
          !openDesignLooksLikeMarkdownDocumentReference(trimmed)
    else {
        return nil
    }
    return trimmed
}

private func openDesignLooksLikeMarkdownDocumentReference(_ value: String) -> Bool {
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

func openDesignOptionTitleHighlightPhrases(_ phrases: [String], for title: String) -> [String] {
    let cleanTitle = openDesignNormalizedOptionHighlightText(title)
    guard !cleanTitle.isEmpty else { return [] }

    var seen: Set<String> = []
    var result: [String] = []
    for phrase in OpenDesignDayContent.InterviewStep.normalizedHighlightPhrases(phrases) {
        guard let readablePhrase = openDesignReadableOptionHighlightPhrase(phrase, in: cleanTitle),
              openDesignIsUsableOptionTitleHighlightPhrase(readablePhrase, in: cleanTitle) else {
            continue
        }
        let key = openDesignNormalizedOptionHighlightText(readablePhrase).lowercased()
        if seen.insert(key).inserted {
            result.append(readablePhrase)
        }
    }
    return result
}

private func openDesignReadableOptionHighlightPhrase(_ phrase: String, in title: String) -> String? {
    let cleanPhrase = openDesignNormalizedOptionHighlightText(phrase)
    guard !cleanPhrase.isEmpty,
          let range = title.range(of: cleanPhrase, options: [.caseInsensitive, .diacriticInsensitive]) else {
        return nil
    }
    let readableRange = openDesignReadableOptionHighlightRange(range, in: title)
    return openDesignNormalizedOptionHighlightText(String(title[readableRange]))
}

private func openDesignReadableOptionHighlightRange(
    _ range: Range<String.Index>,
    in text: String
) -> Range<String.Index> {
    if let delimiterRange = openDesignBalancedDelimiterRange(containing: range, in: text) {
        return delimiterRange
    }

    var lower = range.lowerBound
    var upper = range.upperBound

    while lower > text.startIndex {
        let previous = text.index(before: lower)
        guard lower < text.endIndex,
              openDesignIsHighlightTokenCharacter(text[previous]),
              openDesignIsHighlightTokenCharacter(text[lower]) else {
            break
        }
        lower = previous
    }

    while upper < text.endIndex {
        let previous = text.index(before: upper)
        guard openDesignIsHighlightTokenCharacter(text[previous]),
              openDesignIsHighlightTokenCharacter(text[upper]) else {
            break
        }
        upper = text.index(after: upper)
    }

    return lower..<upper
}

private func openDesignBalancedDelimiterRange(
    containing range: Range<String.Index>,
    in text: String
) -> Range<String.Index>? {
    let pairs: [Character: Character] = [
        "(": ")",
        "[": "]",
        "{": "}",
        "（": "）",
        "［": "］",
        "｛": "｝",
    ]
    let openerForCloser = Dictionary(uniqueKeysWithValues: pairs.map { ($0.value, $0.key) })
    var stack: [(character: Character, index: String.Index)] = []
    var matches: [Range<String.Index>] = []

    for index in text.indices {
        let character = text[index]
        if pairs[character] != nil {
            stack.append((character, index))
            continue
        }
        guard let expectedOpen = openerForCloser[character],
              let last = stack.last,
              last.character == expectedOpen else {
            continue
        }
        _ = stack.popLast()
        let delimiterRange = last.index..<text.index(after: index)
        if delimiterRange.lowerBound <= range.lowerBound,
           delimiterRange.upperBound >= range.upperBound {
            matches.append(delimiterRange)
        }
    }

    return matches.min { lhs, rhs in
        text.distance(from: lhs.lowerBound, to: lhs.upperBound) < text.distance(from: rhs.lowerBound, to: rhs.upperBound)
    }
}

private func openDesignIsHighlightTokenCharacter(_ character: Character) -> Bool {
    guard !character.isWhitespace else { return false }
    return character.unicodeScalars.allSatisfy { scalar in
        CharacterSet.alphanumerics.contains(scalar)
            || scalar.value == 95
            || (0xAC00...0xD7A3).contains(scalar.value)
            || (0x1100...0x11FF).contains(scalar.value)
            || (0x3130...0x318F).contains(scalar.value)
    }
}

private func openDesignIsUsableOptionTitleHighlightPhrase(_ phrase: String, in title: String) -> Bool {
    let cleanTitle = openDesignNormalizedOptionHighlightText(title)
    let cleanPhrase = openDesignNormalizedOptionHighlightText(phrase)
    guard !cleanTitle.isEmpty,
          !cleanPhrase.isEmpty,
          cleanTitle.localizedCaseInsensitiveContains(cleanPhrase) else {
        return false
    }

    if cleanPhrase.caseInsensitiveCompare(cleanTitle) == .orderedSame {
        return cleanTitle.count <= 14 && openDesignOptionHighlightWordCount(cleanTitle) <= 3
    }

    guard cleanPhrase.count <= 18 else { return false }
    return Double(cleanPhrase.count) / Double(max(cleanTitle.count, 1)) <= 0.78
}

private func openDesignNormalizedOptionHighlightText(_ value: String) -> String {
    value
        .trimmingCharacters(in: .whitespacesAndNewlines)
        .replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
}

private func openDesignOptionHighlightWordCount(_ value: String) -> Int {
    openDesignNormalizedOptionHighlightText(value)
        .split(separator: " ")
        .count
}

func openDesignHighlightedAttributedText(
    _ text: String,
    phrases: [String],
    bodySize: CGFloat,
    bodyWeight: Font.Weight = .regular,
    bodyColor: Color = OpenDesignDayColor.fgSecondary,
    highlightWeight: Font.Weight = .semibold,
    highlightColor: Color = OpenDesignDayColor.amber,
    highlightBackground: Color = OpenDesignDayColor.amberDim
) -> AttributedString {
    let cleanPhrases = OpenDesignDayContent.InterviewStep.normalizedHighlightPhrases(phrases)
    guard !text.isEmpty, !cleanPhrases.isEmpty else {
        var value = AttributedString(text)
        value.font = .system(size: bodySize, weight: bodyWeight)
        value.foregroundColor = bodyColor
        return value
    }

    var highlightRanges: [Range<String.Index>] = []
    for phrase in cleanPhrases {
        var searchRange = text.startIndex..<text.endIndex
        while let range = text.range(
            of: phrase,
            options: [.caseInsensitive, .diacriticInsensitive],
            range: searchRange
        ) {
            if !highlightRanges.contains(where: { $0.overlaps(range) }) {
                highlightRanges.append(range)
            }
            searchRange = range.upperBound..<text.endIndex
        }
    }
    highlightRanges.sort { $0.lowerBound < $1.lowerBound }

    guard !highlightRanges.isEmpty else {
        var value = AttributedString(text)
        value.font = .system(size: bodySize, weight: bodyWeight)
        value.foregroundColor = bodyColor
        return value
    }

    var value = AttributedString()
    var cursor = text.startIndex
    for range in highlightRanges {
        if cursor < range.lowerBound {
            var body = AttributedString(String(text[cursor..<range.lowerBound]))
            body.font = .system(size: bodySize, weight: bodyWeight)
            body.foregroundColor = bodyColor
            value += body
        }

        var highlight = AttributedString(String(text[range]))
        highlight.font = .system(size: bodySize, weight: highlightWeight)
        highlight.foregroundColor = highlightColor
        highlight.backgroundColor = highlightBackground
        value += highlight
        cursor = range.upperBound
    }

    if cursor < text.endIndex {
        var body = AttributedString(String(text[cursor...]))
        body.font = .system(size: bodySize, weight: bodyWeight)
        body.foregroundColor = bodyColor
        value += body
    }
    return value
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
        let runs = segment.style == .code
            ? [OpenDesignInlineMarkdownEmphasisRun(text: segment.text, isEmphasized: false)]
            : openDesignInlineMarkdownEmphasisRuns(in: segment.text)

        for parsed in runs {
            var run = AttributedString(parsed.text)
            applyOpenDesignInlineStyle(
                to: &run,
                style: segment.style,
                isEmphasized: parsed.isEmphasized,
                bodySize: bodySize,
                bodyWeight: bodyWeight,
                strongWeight: strongWeight,
                bodyColor: bodyColor,
                markColor: markColor,
                markBackground: markBackground,
                codeColor: codeColor,
                codeBackground: codeBackground
            )
            value += run
        }
    }
    return value
}

private func applyOpenDesignInlineStyle(
    to run: inout AttributedString,
    style: OpenDesignInlineSegment.Style,
    isEmphasized: Bool,
    bodySize: CGFloat,
    bodyWeight: Font.Weight,
    strongWeight: Font.Weight,
    bodyColor: Color,
    markColor: Color,
    markBackground: Color,
    codeColor: Color,
    codeBackground: Color
) {
    if isEmphasized {
        run.font = .system(size: bodySize, weight: .bold)
        run.foregroundColor = OpenDesignDayColor.fg
        if style == .mark {
            run.backgroundColor = markBackground
        }
        return
    }

    switch style {
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
}

private func applyOpenDesignSignalStyle(
    to run: inout AttributedString,
    style: OpenDesignSignalSegment.Style,
    isEmphasized: Bool
) {
    if isEmphasized {
        run.font = .system(size: 13, weight: .bold)
        run.foregroundColor = OpenDesignDayColor.fg
        switch style {
        case .mark:
            run.backgroundColor = OpenDesignDayColor.amberDim
        default:
            break
        }
        return
    }

    switch style {
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

private struct OpenDesignMarketMainView: View {
    let market: OpenDesignDayContent.Market
    @Binding var pendingScrollRequest: OpenDesignScrollRequest?
    @Binding var searchPulseTarget: String?
    let completeDay: () -> Void
    let layout: OpenDesignDayLayoutMetrics

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var selectedSourceID = "threads"
    @State private var didRecrawl = false

    var body: some View {
        VStack(spacing: 0) {
            OpenDesignMarketHeader(
                market: market,
                didRecrawl: didRecrawl,
                recrawl: recrawl,
                completeDay: completeDay,
                horizontalPadding: layout.mainHorizontalPadding
            )

            OpenDesignMarketSourceTabs(
                tabs: market.sourceTabs,
                selectedID: $selectedSourceID,
                horizontalPadding: layout.mainHorizontalPadding
            )

            ScrollViewReader { proxy in
                ScrollView {
                    VStack(alignment: .leading, spacing: 0) {
                        OpenDesignSectionHeader(title: "지난 30일 키워드 — ICP \"전업 1인 개발자\" 코호트", meta: market.keywordMeta)
                            .openDesignSearchPulse(id: "market-keywords", isActive: isSearchPulseActive("market-keywords"))
                            .id("market-keywords")

                        OpenDesignMarketKeywordCloud(keywords: market.keywords)
                            .padding(.bottom, 18)

                        OpenDesignMarketSignalGrid(
                            cards: market.signalCards,
                            columns: layout.showsMetaPanel ? 3 : 1
                        )
                        .openDesignSearchPulse(id: "market-sources", isActive: isSearchPulseActive("market-sources"))
                        .id("market-sources")
                        .padding(.bottom, 20)

                        OpenDesignSectionHeader(title: "대안 비교 매트릭스", meta: "\"이게 팔릴까\" 단계에서 쓰는 7개")
                            .openDesignSearchPulse(id: "market-alternatives", isActive: isSearchPulseActive("market-alternatives"))
                            .id("market-alternatives")

                        OpenDesignMarketAlternativeMatrix(alternatives: market.alternatives)
                            .padding(.bottom, 18)

                        OpenDesignMarketGapCard(gap: market.gapHypothesis)
                            .openDesignSearchPulse(id: "market-gap", isActive: isSearchPulseActive("market-gap"))
                            .id("market-gap")
                            .padding(.bottom, 18)

                        OpenDesignSectionHeader(title: "인용 좋은 게시물 — 상위 5개")
                            .openDesignSearchPulse(id: "market-posts", isActive: isSearchPulseActive("market-posts"))
                            .id("market-posts")

                        OpenDesignMarketPostFeed(posts: market.posts)
                    }
                    .frame(maxWidth: 820, alignment: .leading)
                    .padding(.horizontal, layout.mainHorizontalPadding)
                    .padding(.top, 22)
                    .padding(.bottom, 32)
                    .frame(maxWidth: .infinity)
                }
                .background(OpenDesignDayColor.bg)
                .accessibilityIdentifier("opendesign.day2.main.scroll")
                .onChange(of: pendingScrollRequest) { _, request in
                    guard let request else { return }
                    let token = request.token
                    DispatchQueue.main.async {
                        guard pendingScrollRequest?.token == token else { return }
                        withAnimation(.easeInOut(duration: reduceMotion ? 0 : 0.22)) {
                            proxy.scrollTo(request.resolvedTarget.rawValue, anchor: request.anchor)
                        }
                        DispatchQueue.main.async {
                            if pendingScrollRequest?.token == token {
                                pendingScrollRequest = nil
                            }
                        }
                    }
                }
            }
        }
        .background(OpenDesignDayColor.bg)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("opendesign.day2.main")
    }

    private func recrawl() {
        didRecrawl = true
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.6) {
            didRecrawl = false
        }
    }

    private func isSearchPulseActive(_ id: String) -> Bool {
        searchPulseTarget == id
    }
}

private struct OpenDesignMarketHeader: View {
    let market: OpenDesignDayContent.Market
    let didRecrawl: Bool
    let recrawl: () -> Void
    let completeDay: () -> Void
    let horizontalPadding: CGFloat

    var body: some View {
        HStack(spacing: 12) {
            HStack(spacing: 14) {
                Text(String(format: "%02d", market.dayNumber))
                    .font(.system(size: 17, weight: .bold, design: .monospaced))
                    .foregroundStyle(OpenDesignDayColor.accent)
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
                    Text(market.title)
                        .font(.system(size: 17, weight: .semibold))
                        .foregroundStyle(OpenDesignDayColor.fg)
                        .lineLimit(1)

                    HStack(spacing: 8) {
                        Circle()
                            .fill(OpenDesignDayColor.accent)
                            .frame(width: 5, height: 5)
                            .shadow(color: OpenDesignDayColor.accentDim, radius: 3)

                        ForEach(Array(market.subtitleParts.enumerated()), id: \.offset) { index, part in
                            if index > 0 {
                                Text("·")
                                    .foregroundStyle(OpenDesignDayColor.mutedDeep)
                            }
                            Text(didRecrawl && index == market.subtitleParts.count - 1 ? "방금 갱신" : part)
                                .foregroundStyle(index == 1 ? OpenDesignDayColor.fgSecondary : OpenDesignDayColor.muted)
                        }
                    }
                    .font(.system(size: 11, weight: .medium, design: .monospaced))
                    .lineLimit(1)
                }
                .frame(minWidth: 0, alignment: .leading)
            }

            Spacer(minLength: 12)

            OpenDesignHeaderActionButton(
                title: didRecrawl ? "갱신됨" : "재크롤",
                systemImage: "arrow.clockwise",
                tone: .ghost,
                accessibilityIdentifier: "opendesign.day2.header.recrawl",
                action: recrawl
            )

            OpenDesignHeaderActionButton(
                title: market.primaryActionTitle,
                systemImage: nil,
                tone: .accent,
                accessibilityIdentifier: "opendesign.day2.header.primary",
                action: completeDay
            )
        }
        .padding(.horizontal, horizontalPadding)
        .frame(height: 70)
        .background(OpenDesignDayColor.bg)
        .overlay(Rectangle().fill(OpenDesignDayColor.borderSoft).frame(height: 1), alignment: .bottom)
    }
}

private struct OpenDesignMarketSourceTabs: View {
    let tabs: [OpenDesignDayContent.MarketSourceTab]
    @Binding var selectedID: String
    let horizontalPadding: CGFloat

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 2) {
                ForEach(tabs) { tab in
                    OpenDesignMarketSourceTab(tab: tab, isSelected: selectedID == tab.id) {
                        selectedID = tab.id
                    }
                }

                HStack(spacing: 6) {
                    Circle()
                        .fill(OpenDesignDayColor.accent)
                        .frame(width: 5, height: 5)
                        .shadow(color: OpenDesignDayColor.accentDim, radius: 3)
                    Text("실시간 · 다음 갱신 18분 후")
                }
                .font(.system(size: 10.5, weight: .medium, design: .monospaced))
                .foregroundStyle(OpenDesignDayColor.muted)
                .padding(.leading, 12)
            }
            .padding(.horizontal, horizontalPadding)
            .frame(height: 38)
        }
        .background(OpenDesignDayColor.bg)
        .overlay(Rectangle().fill(OpenDesignDayColor.borderSoft).frame(height: 1), alignment: .bottom)
    }
}

private struct OpenDesignMarketSourceTab: View {
    let tab: OpenDesignDayContent.MarketSourceTab
    let isSelected: Bool
    let select: () -> Void

    @State private var isHovered = false

    var body: some View {
        Button(action: select) {
            HStack(spacing: 8) {
                Text(tab.title)
                Text(tab.count)
                    .font(.system(size: 10, weight: .medium, design: .monospaced))
                    .foregroundStyle(isSelected ? OpenDesignDayColor.accent : OpenDesignDayColor.muted)
                    .padding(.horizontal, 5)
                    .frame(height: 18)
                    .background(Capsule().fill(isSelected ? OpenDesignDayColor.accentDim : OpenDesignDayColor.surface))
                    .overlay(Capsule().stroke(isSelected ? OpenDesignDayColor.accentLine : OpenDesignDayColor.borderSoft, lineWidth: 1))
            }
            .font(.system(size: 12, weight: .medium))
            .foregroundStyle(isSelected || isHovered ? OpenDesignDayColor.fg : OpenDesignDayColor.muted)
            .frame(height: 38)
            .padding(.horizontal, 12)
            .overlay(alignment: .bottom) {
                if isSelected {
                    RoundedRectangle(cornerRadius: 2, style: .continuous)
                        .fill(OpenDesignDayColor.accent)
                        .frame(height: 2)
                        .padding(.horizontal, 8)
                }
            }
        }
        .buttonStyle(OpenDesignInteractiveButtonStyle())
        .onHover { isHovered = $0 }
        .accessibilityValue(isSelected ? "active" : "inactive")
    }
}

private struct OpenDesignMarketKeywordCloud: View {
    let keywords: [OpenDesignDayContent.MarketKeyword]

    var body: some View {
        OpenDesignFlowLayout(spacing: 14, lineSpacing: 8) {
            ForEach(keywords) { keyword in
                HStack(alignment: .firstTextBaseline, spacing: 5) {
                    Text(keyword.title)
                        .font(.system(size: keyword.size, weight: .medium, design: .monospaced))
                    Text(keyword.count)
                        .font(.system(size: 10.5, weight: .medium, design: .monospaced))
                        .baselineOffset(keyword.size * 0.22)
                        .foregroundStyle(OpenDesignDayColor.mutedDeep)
                }
                .foregroundStyle(keyword.heat.color)
                .padding(.vertical, 4)
                .help("\(keyword.title) \(keyword.count) mentions")
            }
        }
        .padding(.horizontal, 24)
        .padding(.vertical, 20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(cardBackground(cornerRadius: 14, fill: OpenDesignDayColor.surface))
        .accessibilityIdentifier("opendesign.day2.keywordCloud")
    }
}

private struct OpenDesignMarketSignalGrid: View {
    let cards: [OpenDesignDayContent.MarketSignalCard]
    let columns: Int

    var body: some View {
        LazyVGrid(columns: openDesignGridColumns(columns, spacing: 12), spacing: 12) {
            ForEach(cards) { card in
                OpenDesignMarketSignalCardView(card: card)
            }
        }
    }
}

private struct OpenDesignMarketSignalCardView: View {
    let card: OpenDesignDayContent.MarketSignalCard

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(headerText)
                    .font(.system(size: 10.5, weight: .medium, design: .monospaced))
                    .textCase(.uppercase)
                    .foregroundStyle(OpenDesignDayColor.muted)
                Spacer(minLength: 8)
                Text(card.delta)
                    .font(.system(size: 10.5, weight: .medium, design: .monospaced))
                    .foregroundStyle(card.deltaIsPositive ? OpenDesignDayColor.diffAdd : OpenDesignDayColor.diffDel)
            }

            HStack(alignment: .firstTextBaseline, spacing: 4) {
                Text(card.value)
                    .font(.system(size: 28, weight: .semibold))
                    .foregroundStyle(OpenDesignDayColor.fg)
                Text(card.unit)
                    .font(.system(size: 11, weight: .regular, design: .monospaced))
                    .foregroundStyle(OpenDesignDayColor.muted)
            }

            OpenDesignMarketSparkline(points: card.sparkline, color: card.tone.color)
                .frame(height: 34)

            HStack {
                Text(card.footerLeft)
                Spacer(minLength: 8)
                Text(card.footerRight)
            }
            .font(.system(size: 10.5, weight: .medium, design: .monospaced))
            .foregroundStyle(OpenDesignDayColor.muted)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(OpenDesignDayColor.surface)
                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(OpenDesignDayColor.borderSoft, lineWidth: 1))
        )
        .overlay(Rectangle().fill(card.tone.color).frame(width: 2), alignment: .leading)
    }

    private var headerText: AttributedString {
        var text = AttributedString("\(card.title) · \(card.detail)")
        if let range = text.range(of: card.title) {
            text[range].foregroundColor = card.tone.color
        }
        return text
    }
}

private struct OpenDesignMarketSparkline: View {
    let points: [CGFloat]
    let color: Color

    var body: some View {
        GeometryReader { geometry in
            Path { path in
                guard let first = points.first else { return }
                let step = points.count > 1 ? geometry.size.width / CGFloat(points.count - 1) : 0
                path.move(to: CGPoint(x: 0, y: y(for: first, in: geometry.size.height)))
                for (index, point) in points.enumerated().dropFirst() {
                    path.addLine(to: CGPoint(x: CGFloat(index) * step, y: y(for: point, in: geometry.size.height)))
                }
            }
            .stroke(color, style: StrokeStyle(lineWidth: 1.7, lineCap: .round, lineJoin: .round))
        }
        .accessibilityHidden(true)
    }

    private func y(for value: CGFloat, in height: CGFloat) -> CGFloat {
        min(max(value, 0), 1) * height
    }
}

private struct OpenDesignMarketAlternativeMatrix: View {
    let alternatives: [OpenDesignDayContent.MarketAlternative]

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            VStack(spacing: 0) {
                OpenDesignMarketAlternativeHeader()
                ForEach(alternatives) { alternative in
                    OpenDesignMarketAlternativeRow(alternative: alternative)
                }
            }
            .frame(minWidth: 760)
        }
        .background(cardBackground(cornerRadius: 14, fill: OpenDesignDayColor.surface))
        .accessibilityIdentifier("opendesign.day2.alternatives")
    }
}

private struct OpenDesignMarketAlternativeHeader: View {
    var body: some View {
        HStack(spacing: 14) {
            Text("대안").frame(width: 250, alignment: .leading)
            Text("해결 정도").frame(width: 190, alignment: .leading)
            Text("강점").frame(width: 138, alignment: .leading)
            Text("빈 자리").frame(width: 138, alignment: .leading)
            Text("월비용").frame(width: 58, alignment: .trailing)
        }
        .font(.system(size: 10, weight: .semibold, design: .monospaced))
        .textCase(.uppercase)
        .foregroundStyle(OpenDesignDayColor.muted)
        .padding(.horizontal, 14)
        .frame(height: 40)
        .background(OpenDesignDayColor.surface2)
        .overlay(Rectangle().fill(OpenDesignDayColor.borderSoft).frame(height: 1), alignment: .bottom)
    }
}

private struct OpenDesignMarketAlternativeRow: View {
    let alternative: OpenDesignDayContent.MarketAlternative

    @State private var isHovered = false

    var body: some View {
        HStack(spacing: 14) {
            HStack(spacing: 10) {
                Text(alternative.initials)
                    .font(.system(size: 10, weight: .bold, design: .monospaced))
                    .foregroundStyle(OpenDesignDayColor.fgSecondary)
                    .frame(width: 28, height: 28)
                    .background(RoundedRectangle(cornerRadius: 7, style: .continuous).fill(OpenDesignDayColor.bgDarker))
                    .overlay(RoundedRectangle(cornerRadius: 7, style: .continuous).stroke(OpenDesignDayColor.borderSoft, lineWidth: 1))
                VStack(alignment: .leading, spacing: 1) {
                    Text(alternative.name)
                        .font(.system(size: 12.5, weight: .semibold))
                        .foregroundStyle(OpenDesignDayColor.fg)
                    Text(alternative.kind)
                        .font(.system(size: 10.5, weight: .medium, design: .monospaced))
                        .foregroundStyle(OpenDesignDayColor.mutedDeep)
                }
                Spacer(minLength: 0)
            }
            .frame(width: 250, alignment: .leading)

            OpenDesignMarketFitBar(value: alternative.fit)
                .frame(width: 190, alignment: .leading)

            OpenDesignMarketTagGroup(tags: alternative.strengths, isStrong: false)
                .frame(width: 138, alignment: .leading)
            OpenDesignMarketTagGroup(tags: alternative.gaps, isStrong: true)
                .frame(width: 138, alignment: .leading)

            Text(alternative.monthlyCost)
                .font(.system(size: 12.5, weight: .medium, design: .monospaced))
                .foregroundStyle(OpenDesignDayColor.fgSecondary)
                .frame(width: 58, alignment: .trailing)
        }
        .padding(.horizontal, 14)
        .frame(height: 60)
        .background(isHovered ? OpenDesignDayColor.hover : OpenDesignDayColor.surface)
        .overlay(Rectangle().fill(OpenDesignDayColor.borderSoft).frame(height: 1), alignment: .bottom)
        .onHover { isHovered = $0 }
        .accessibilityElement(children: .combine)
    }
}

private struct OpenDesignMarketFitBar: View {
    let value: Int

    var body: some View {
        HStack(spacing: 8) {
            GeometryReader { proxy in
                RoundedRectangle(cornerRadius: 99, style: .continuous)
                    .fill(OpenDesignDayColor.bgDarker)
                    .overlay(alignment: .leading) {
                        RoundedRectangle(cornerRadius: 99, style: .continuous)
                            .fill(fillColor)
                            .frame(width: proxy.size.width * CGFloat(value) / 100)
                    }
            }
            .frame(width: 80, height: 5)

            Text("\(value)%")
                .font(.system(size: 11, weight: .medium, design: .monospaced))
                .foregroundStyle(OpenDesignDayColor.fgSecondary)
        }
    }

    private var fillColor: Color {
        if value < 30 { return OpenDesignDayColor.rose }
        if value < 60 { return OpenDesignDayColor.amber }
        return OpenDesignDayColor.accent
    }
}

private struct OpenDesignMarketTagGroup: View {
    let tags: [String]
    let isStrong: Bool

    var body: some View {
        OpenDesignFlowLayout(spacing: 4, lineSpacing: 4) {
            ForEach(tags, id: \.self) { tag in
                Text(tag)
                    .font(.system(size: 10, weight: .medium, design: .monospaced))
                    .foregroundStyle(isStrong ? OpenDesignDayColor.accent : OpenDesignDayColor.muted)
                    .padding(.horizontal, 7)
                    .frame(height: 20)
                    .background(Capsule().fill(isStrong ? OpenDesignDayColor.accentDim : OpenDesignDayColor.bgDarker))
                    .overlay(Capsule().stroke(isStrong ? OpenDesignDayColor.accentLine : OpenDesignDayColor.borderSoft, lineWidth: 1))
            }
        }
    }
}

private struct OpenDesignMarketGapCard: View {
    let gap: OpenDesignDayContent.MarketGapHypothesis

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(gap.label)
                .font(.system(size: 10, weight: .semibold, design: .monospaced))
                .textCase(.uppercase)
                .foregroundStyle(OpenDesignDayColor.accent)

            Text(openDesignAttributedText(gap.segments, bodySize: 14, bodyColor: OpenDesignDayColor.fg))
                .lineSpacing(4)

            OpenDesignFlowLayout(spacing: 22, lineSpacing: 8) {
                ForEach(gap.criteria) { criterion in
                    HStack(spacing: 6) {
                        Text(criterion.key)
                            .foregroundStyle(OpenDesignDayColor.mutedDeep)
                        Text(criterion.value)
                            .foregroundStyle(OpenDesignDayColor.fg)
                    }
                    .font(.system(size: 11, weight: .medium, design: .monospaced))
                }
            }
            .padding(.top, 12)
            .overlay(Rectangle().fill(OpenDesignDayColor.borderSoft).frame(height: 1), alignment: .top)
        }
        .padding(.horizontal, 22)
        .padding(.vertical, 18)
        .background(gradientCardBackground(cornerRadius: 14, colors: [OpenDesignDayColor.surface, OpenDesignDayColor.surface2], stroke: OpenDesignDayColor.border, accent: OpenDesignDayColor.accent))
    }
}

private struct OpenDesignMarketPostFeed: View {
    let posts: [OpenDesignDayContent.MarketPost]

    var body: some View {
        VStack(spacing: 8) {
            ForEach(posts) { post in
                OpenDesignMarketPostRow(post: post)
            }
        }
    }
}

private struct OpenDesignMarketPostRow: View {
    let post: OpenDesignDayContent.MarketPost

    @State private var isHovered = false

    var body: some View {
        HStack(alignment: .top, spacing: 14) {
            Text(post.initials)
                .font(.system(size: 11, weight: .bold, design: .monospaced))
                .foregroundStyle(post.tone.color)
                .frame(width: 32, height: 32)
                .background(Circle().fill(post.tone.dim))
                .overlay(Circle().stroke(post.tone.line, lineWidth: 1))

            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 8) {
                    Text(post.source)
                        .font(.system(size: 10.5, weight: .medium, design: .monospaced))
                        .foregroundStyle(post.tone.color)
                        .padding(.horizontal, 6)
                        .frame(height: 18)
                        .background(Capsule().fill(post.tone.dim))
                        .overlay(Capsule().stroke(post.tone.line, lineWidth: 1))
                    Text(post.author)
                    Text("·").foregroundStyle(OpenDesignDayColor.mutedDeep)
                    Text(post.age)
                }
                .font(.system(size: 10.5, weight: .medium, design: .monospaced))
                .foregroundStyle(OpenDesignDayColor.muted)

                Text(openDesignAttributedText(post.bodySegments, bodySize: 13, bodyColor: OpenDesignDayColor.fg))
                    .lineSpacing(3)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Spacer(minLength: 8)

            VStack(alignment: .trailing, spacing: 3) {
                Text(post.engagement)
                    .foregroundStyle(OpenDesignDayColor.accent)
                Text(post.comments)
                Text(post.strength)
                    .foregroundStyle(OpenDesignDayColor.mutedDeep)
            }
            .font(.system(size: 11, weight: .medium, design: .monospaced))
            .foregroundStyle(OpenDesignDayColor.muted)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .background(cardBackground(cornerRadius: 12, fill: isHovered ? OpenDesignDayColor.surface2 : OpenDesignDayColor.surface))
        .onHover { isHovered = $0 }
        .accessibilityElement(children: .combine)
    }
}

private struct OpenDesignMarketMetaPanelView: View {
    let market: OpenDesignDayContent.Market

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                Text("Day 2 정보")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(OpenDesignDayColor.fg)

                signalStrength

                metaTitle("잠긴 키워드 3")
                VStack(spacing: 6) {
                    ForEach(Array(market.lockedKeywords.enumerated()), id: \.element.id) { index, metric in
                        OpenDesignMarketMiniMetricRow(metric: metric, index: "\(index + 1)")
                    }
                }

                metaTitle("상위 대안 5")
                VStack(spacing: 6) {
                    ForEach(Array(market.topAlternatives.enumerated()), id: \.element.id) { index, metric in
                        OpenDesignMarketMiniMetricRow(metric: metric, index: ["A", "B", "C", "D", "E"][safe: index] ?? "\(index + 1)")
                    }
                }

                metaTitle("내일 미리보기")
                nextDayCard
                    .padding(.bottom, 14)
            }
            .padding(16)
        }
        .background(OpenDesignDayColor.bg)
        .overlay(Rectangle().fill(OpenDesignDayColor.borderSoft).frame(width: 1), alignment: .leading)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("opendesign.day2.meta")
    }

    private var signalStrength: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("시장 신호 강도")
                .font(.system(size: 10.5, weight: .medium, design: .monospaced))
                .textCase(.uppercase)
                .foregroundStyle(OpenDesignDayColor.muted)

            HStack(alignment: .firstTextBaseline, spacing: 5) {
                Text(market.signalStrength.score)
                    .font(.system(size: 24, weight: .semibold, design: .monospaced))
                    .foregroundStyle(OpenDesignDayColor.fg)
                Text(market.signalStrength.total)
                    .font(.system(size: 13, weight: .medium, design: .monospaced))
                    .foregroundStyle(OpenDesignDayColor.muted)
                Spacer(minLength: 8)
                Text(market.signalStrength.tag)
                    .font(.system(size: 10, weight: .medium, design: .monospaced))
                    .foregroundStyle(OpenDesignDayColor.accent)
                    .padding(.horizontal, 8)
                    .frame(height: 20)
                    .background(Capsule().fill(OpenDesignDayColor.accentDim))
                    .overlay(Capsule().stroke(OpenDesignDayColor.accentLine, lineWidth: 1))
            }

            VStack(spacing: 5) {
                ForEach(market.signalStrength.rows) { row in
                    HStack(spacing: 8) {
                        Text(row.title)
                            .frame(width: 80, alignment: .leading)
                        GeometryReader { proxy in
                            RoundedRectangle(cornerRadius: 99, style: .continuous)
                                .fill(OpenDesignDayColor.bgDarker)
                                .overlay(alignment: .leading) {
                                    RoundedRectangle(cornerRadius: 99, style: .continuous)
                                        .fill(OpenDesignDayColor.accent)
                                        .frame(width: proxy.size.width * CGFloat(row.fraction))
                                }
                        }
                        .frame(height: 4)
                        Text(row.value)
                            .foregroundStyle(OpenDesignDayColor.fgSecondary)
                            .frame(width: 30, alignment: .trailing)
                    }
                    .font(.system(size: 10.5, weight: .medium, design: .monospaced))
                    .foregroundStyle(OpenDesignDayColor.muted)
                }
            }
            .padding(.top, 2)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 13)
        .background(cardBackground(cornerRadius: 10, fill: OpenDesignDayColor.surface))
    }

    private var nextDayCard: some View {
        HStack(spacing: 12) {
            Text(market.nextDay.badge)
                .font(.system(size: 12, weight: .bold, design: .monospaced))
                .foregroundStyle(OpenDesignDayColor.accent)
                .frame(width: 36, height: 36)
                .background(Circle().fill(OpenDesignDayColor.accentDim))
                .overlay(Circle().stroke(OpenDesignDayColor.accentLine, lineWidth: 1))

            VStack(alignment: .leading, spacing: 2) {
                Text(market.nextDay.title)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(OpenDesignDayColor.fg)
                Text(market.nextDay.subtitle)
                    .font(.system(size: 10.5, weight: .medium, design: .monospaced))
                    .foregroundStyle(OpenDesignDayColor.muted)
            }
            Spacer(minLength: 0)
            Image(systemName: "chevron.right")
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(OpenDesignDayColor.muted)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .background(cardBackground(cornerRadius: 10, fill: OpenDesignDayColor.surface))
    }

    private func metaTitle(_ text: String) -> some View {
        Text(text)
            .font(.system(size: 10, weight: .medium, design: .monospaced))
            .textCase(.uppercase)
            .foregroundStyle(OpenDesignDayColor.mutedDeep)
            .padding(.top, 4)
    }
}

private struct OpenDesignMarketMiniMetricRow: View {
    let metric: OpenDesignDayContent.MarketMiniMetric
    let index: String

    var body: some View {
        HStack(spacing: 10) {
            Text(index)
                .font(.system(size: 10, weight: .semibold, design: .monospaced))
                .foregroundStyle(metric.isLeader ? OpenDesignDayColor.accent : OpenDesignDayColor.muted)
                .frame(width: 24, height: 24)
                .background(Circle().fill(metric.isLeader ? OpenDesignDayColor.accentDim : OpenDesignDayColor.bgDarker))
                .overlay(Circle().stroke(metric.isLeader ? OpenDesignDayColor.accentLine : OpenDesignDayColor.borderSoft, lineWidth: 1))
            Text(metric.label)
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(OpenDesignDayColor.fgSecondary)
                .lineLimit(1)
            Spacer(minLength: 8)
            Text(metric.value)
                .font(.system(size: 10.5, weight: .medium, design: .monospaced))
                .foregroundStyle(metric.isLeader ? OpenDesignDayColor.accent : OpenDesignDayColor.muted)
        }
        .padding(.horizontal, 10)
        .frame(height: 34)
        .background(cardBackground(cornerRadius: 8, fill: metric.isLeader ? OpenDesignDayColor.accentDim : OpenDesignDayColor.surface))
    }
}

private extension OpenDesignDayContent.MarketKeyword.Heat {
    var color: Color {
        switch self {
        case .hot: return OpenDesignDayColor.accent
        case .warm: return OpenDesignDayColor.amber
        case .mid: return OpenDesignDayColor.fgSecondary
        case .cool: return OpenDesignDayColor.muted
        case .cold: return OpenDesignDayColor.mutedDeep
        }
    }
}

private struct OpenDesignFlowLayout: Layout {
    var spacing: CGFloat
    var lineSpacing: CGFloat

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? 0
        let rows = rows(for: subviews, proposalWidth: width)
        return CGSize(
            width: width,
            height: rows.reduce(CGFloat(0)) { $0 + $1.height } + CGFloat(max(0, rows.count - 1)) * lineSpacing
        )
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let rows = rows(for: subviews, proposalWidth: bounds.width)
        var y = bounds.minY
        for row in rows {
            var x = bounds.minX
            for item in row.items {
                item.subview.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(item.size))
                x += item.size.width + spacing
            }
            y += row.height + lineSpacing
        }
    }

    private func rows(for subviews: Subviews, proposalWidth: CGFloat) -> [FlowRow] {
        var rows: [FlowRow] = []
        var current: [FlowItem] = []
        var currentWidth: CGFloat = 0
        var currentHeight: CGFloat = 0
        let maxWidth = max(proposalWidth, 1)

        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            let nextWidth = current.isEmpty ? size.width : currentWidth + spacing + size.width
            if nextWidth > maxWidth, !current.isEmpty {
                rows.append(FlowRow(items: current, height: currentHeight))
                current = [FlowItem(subview: subview, size: size)]
                currentWidth = size.width
                currentHeight = size.height
            } else {
                current.append(FlowItem(subview: subview, size: size))
                currentWidth = nextWidth
                currentHeight = max(currentHeight, size.height)
            }
        }

        if !current.isEmpty {
            rows.append(FlowRow(items: current, height: currentHeight))
        }
        return rows
    }

    private struct FlowRow {
        let items: [FlowItem]
        let height: CGFloat
    }

    private struct FlowItem {
        let subview: LayoutSubview
        let size: CGSize
    }
}

private struct OpenDesignDayMainView: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    let content: OpenDesignDayContent
    @Binding var interaction: OpenDesignDayInteractionState
    @Binding var pendingScrollRequest: OpenDesignScrollRequest?
    @Binding var searchPulseTarget: String?
    let submitStep: (OpenDesignDayContent.InterviewStep, Int) -> Void
    let acceptMission: () -> Void
    let completeDayAction: () -> Void
    let advanceToNextDay: () -> Void
    let day1DocPreviews: [IddDocPreview]
    let day1HandoffPromptCard: AnyView?
    let activeDay1HandoffDocType: String?
    let pendingDay1HandoffDocType: String?
    let day1HandoffError: String?
    let day1SituationSummary: Day1SituationSummary?
    let onChooseDay1SituationGoal: (String) -> Void
    let startDay1DocHandoff: (String, [String: Any]) -> Void
    let layout: OpenDesignDayLayoutMetrics

    @State private var introRevealStage = 0
    @State private var showsEvidence = false
    @State private var hasAdvancedPastSituationSummary = false

    var body: some View {
        VStack(spacing: 0) {
            OpenDesignDayHeader(
                content: content,
                interaction: $interaction,
                horizontalPadding: layout.mainHorizontalPadding
            )
            OpenDesignStepper(
                content: content,
                interaction: interaction,
                horizontalPadding: layout.mainHorizontalPadding,
                focusStep: { stepID in
                    withAnimation(.spring(response: reduceMotion ? 0 : 0.24, dampingFraction: 0.90)) {
                        interaction.focusWorkflowStep(stepID)
                    }
                    pendingScrollRequest = OpenDesignScrollRequest(target: .top)
                }
            )

            ScrollViewReader { proxy in
                ScrollView {
                    VStack(alignment: .leading, spacing: 0) {
                        VStack(alignment: .leading, spacing: 14) {
                            if shouldShowSituationSummary, let day1SituationSummary {
                                Day1SituationSummaryCard(
                                    summary: day1SituationSummary,
                                    onChooseGoal: onChooseDay1SituationGoal,
                                    onContinue: advancePastSituationSummary
                                )
                            } else {
                                OpenDesignDayStepWorkspaceView(
                                    content: content,
                                    interaction: $interaction,
                                    activeInterviewStep: activeInterviewStep,
                                    actionSection: AnyView(actionSection),
                                    selectedChoice: selectedChoiceBinding(for: activeInterviewStep),
                                    freeformAnswer: freeformBinding(for: activeInterviewStep),
                                    completeDayAction: completeDayAction,
                                    advanceToNextDay: advanceToNextDay,
                                    day1DocPreviews: day1DocPreviews,
                                    day1HandoffPromptCard: day1HandoffPromptCard,
                                    activeDay1HandoffDocType: activeDay1HandoffDocType,
                                    pendingDay1HandoffDocType: pendingDay1HandoffDocType,
                                    day1HandoffError: day1HandoffError,
                                    startDay1DocHandoff: startDay1DocHandoff,
                                    activateFreeformAnswer: activateFreeformAnswer,
                                    previousAction: previousWorkflowStep,
                                    nextAction: advanceWorkflowStep
                                )
                            }
                        }
                        .openDesignStagedReveal(isVisible: introRevealStage >= 1)
                        .openDesignSearchPulse(id: "top", isActive: isSearchPulseActive("top"))
                        .id("top")
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
                .onChange(of: pendingScrollRequest) { _, request in
                    guard let request else { return }
                    performScroll(request, proxy: proxy)
                }
                .onChange(of: interaction.introStage) { _, stage in
                    guard stage == .mission,
                          let request = pendingScrollRequest,
                          request.target == .mission else {
                        return
                    }
                    performScroll(request, proxy: proxy)
                }
            }
        }
        .background(OpenDesignDayColor.bg)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("opendesign.day.main")
    }

    private var activeInterviewStep: OpenDesignDayContent.InterviewStep? {
        guard let stepID = interaction.activeInterviewStepID else { return nil }
        return content.interviewSteps.first(where: { $0.id == stepID })
    }

    private var shouldShowSituationSummary: Bool {
        day1SituationSummary != nil && !hasAdvancedPastSituationSummary && !interaction.missionAccepted
    }

    private var startPhaseResumeLabel: String {
        let target = min(max(interaction.highestVisibleInterviewStep, 1), interaction.maxReachableStepID)
        if target <= 1 {
            return "고객 질문으로 돌아가기"
        }
        return "진행 단계로 돌아가기"
    }

    private func selectedChoiceBinding(
        for step: OpenDesignDayContent.InterviewStep?
    ) -> Binding<Int?> {
        Binding(
            get: {
                guard let step else { return nil }
                return interaction.selectedChoices[step.id]
            },
            set: { value in
                guard let step else { return }
                guard !interaction.lockedPrefillStepIDs.contains(step.id) else { return }
                interaction.selectChoice(stepID: step.id, choiceID: value)
            }
        )
    }

    private func freeformBinding(
        for step: OpenDesignDayContent.InterviewStep?
    ) -> Binding<String> {
        Binding(
            get: {
                guard let step else { return "" }
                return interaction.freeformAnswers[step.id] ?? (step.id == 1 ? interaction.freeformAnswer : "")
            },
            set: { value in
                guard let step else { return }
                guard !interaction.lockedPrefillStepIDs.contains(step.id) else { return }
                interaction.setFreeformAnswer(stepID: step.id, value: value)
            }
        )
    }

    private func previousWorkflowStep() {
        withAnimation(.spring(response: reduceMotion ? 0 : 0.24, dampingFraction: 0.90)) {
            interaction.moveToPreviousWorkflowStep()
        }
        pendingScrollRequest = OpenDesignScrollRequest(target: .top)
    }

    private func resumeWorkflowFromStartPhase() {
        withAnimation(.spring(response: reduceMotion ? 0 : 0.24, dampingFraction: 0.90)) {
            interaction.resumeWorkflowFromStartPhase()
        }
        pendingScrollRequest = OpenDesignScrollRequest(target: .top)
    }

    private func advanceWorkflowStep() {
        if !interaction.missionAccepted {
            acceptMission()
            return
        }

        if let step = activeInterviewStep {
            guard let selectedChoice = interaction.selectedChoices[step.id] else { return }
            submitStep(step, selectedChoice)
            return
        }

        if interaction.allInterviewsSubmitted {
            if !interaction.dayCompleted {
                completeDayAction()
            } else {
                advanceToNextDay()
            }
        }
    }

    private func activateFreeformAnswer(stepID: Int) {
        interaction.activateFreeformAnswer(stepID: stepID)
    }

    private func advancePastSituationSummary() {
        withAnimation(.spring(response: reduceMotion ? 0 : 0.24, dampingFraction: 0.90)) {
            hasAdvancedPastSituationSummary = true
            interaction.focusWorkflowStep(0)
        }
        pendingScrollRequest = OpenDesignScrollRequest(target: .top)
    }

    private func startIntroReveal() {
        guard introRevealStage == 0 else { return }
        if reduceMotion {
            introRevealStage = 1
            return
        }

        let delays: [(stage: Int, delay: Double)] = [(1, 0.04)]
        for item in delays {
            DispatchQueue.main.asyncAfter(deadline: .now() + item.delay) {
                withAnimation(.easeOut(duration: 0.18)) {
                    introRevealStage = max(introRevealStage, item.stage)
                }
            }
        }
    }

    private func performScroll(_ request: OpenDesignScrollRequest, proxy: ScrollViewProxy) {
        let token = request.token
        DispatchQueue.main.asyncAfter(deadline: .now() + (reduceMotion ? 0 : 0.08)) {
            guard pendingScrollRequest?.token == token else { return }
            withAnimation(.easeInOut(duration: reduceMotion ? 0 : 0.22)) {
                proxy.scrollTo(request.resolvedTarget.rawValue, anchor: request.anchor)
            }
            DispatchQueue.main.async {
                if pendingScrollRequest?.token == token {
                    pendingScrollRequest = nil
                }
            }
        }
    }

    private var actionSection: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .top, spacing: 14) {
                Text("01")
                    .font(.system(size: 14, weight: .bold, design: .monospaced))
                    .foregroundStyle(OpenDesignDayColor.bgDeep)
                    .frame(width: 42, height: 42)
                    .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(OpenDesignDayColor.accent))

                VStack(alignment: .leading, spacing: 5) {
                    Text("Day 1 — 만들기 전에, 팔릴 문제를 고릅니다.")
                        .font(.system(size: 22, weight: .semibold))
                        .foregroundStyle(OpenDesignDayColor.fg)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityIdentifier("opendesign.day.start.title")
                    Text("3분 · \(content.interviewSteps.count)문항")
                        .font(.system(size: 11, weight: .medium, design: .monospaced))
                        .foregroundStyle(OpenDesignDayColor.muted)
                    Text(startDescriptionAttributedText)
                        .lineLimit(2)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityIdentifier("opendesign.day.start.description")
                }

                Spacer(minLength: 0)

                if !interaction.missionAccepted {
                    OpenDesignHandoffActionButton(
                        label: "시작",
                        accessibilityIdentifier: "opendesign.day.start",
                        showsReturnHint: false,
                        action: acceptMission
                    )
                } else if interaction.normalizedActiveStepID == 0 && !interaction.allInterviewsSubmitted {
                    OpenDesignHandoffActionButton(
                        label: startPhaseResumeLabel,
                        accessibilityIdentifier: "opendesign.day.start.resume",
                        showsReturnHint: false,
                        action: resumeWorkflowFromStartPhase
                    )
                } else {
                    Text(interaction.allInterviewsSubmitted ? "가설 준비됨" : "진행 중")
                        .font(.system(size: 10.5, weight: .semibold, design: .monospaced))
                        .foregroundStyle(OpenDesignDayColor.accent)
                        .padding(.horizontal, 9)
                        .frame(height: 24)
                        .background(Capsule().fill(OpenDesignDayColor.accentDim))
                        .overlay(Capsule().stroke(OpenDesignDayColor.accentLine, lineWidth: 1))
                }
            }

            DisclosureGroup(isExpanded: $showsEvidence) {
                VStack(alignment: .leading, spacing: 12) {
                    VStack(spacing: 1) {
                        ForEach(signalRows.indices, id: \.self) { index in
                            let item = signalRows[index]
                            signalRow(key: item.key, value: item.value)
                        }
                    }
                    .background(OpenDesignDayColor.borderSoft)
                    .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: 10, style: .continuous)
                            .stroke(OpenDesignDayColor.borderSoft, lineWidth: 1)
                    )
                }
                .padding(.top, 10)
                .id("signals")
            } label: {
                Text("근거")
                    .font(.system(size: 11.5, weight: .medium, design: .monospaced))
                    .foregroundStyle(OpenDesignDayColor.fgSecondary)
            }
            .accentColor(OpenDesignDayColor.accent)
            .accessibilityIdentifier("opendesign.day.evidence")
        }
        .padding(18)
        .background(gradientCardBackground(cornerRadius: 14, colors: [OpenDesignDayColor.surface, OpenDesignDayColor.surface2], stroke: OpenDesignDayColor.border, accent: OpenDesignDayColor.accent))
        .padding(.bottom, 8)
        .id("mission")
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("opendesign.day.start.phase")
    }

    private var startDescriptionAttributedText: AttributedString {
        var text = AttributedString("오늘은 코딩하지 않습니다.\n30일 동안 검증할 고객, 문제, 첫 결제 이유를 한 문장으로 정합니다.")
        text.font = .system(size: 12, weight: .regular)
        text.foregroundColor = OpenDesignDayColor.fgSecondary

        if let range = text.range(of: "한 문장으로 정합니다.") {
            text[range].font = .system(size: 12, weight: .semibold)
            text[range].foregroundColor = OpenDesignDayColor.amber
            text[range].backgroundColor = OpenDesignDayColor.amberDim
        }

        return text
    }

    private func revealIntroIfNeeded(for target: OpenDesignSectionAnchor) {
        switch target {
        case .top:
            break
        case .signals:
            revealIntroStage(.signals)
        default:
            revealIntroStage(.mission)
        }
    }

    private func revealIntroStage(_ stage: OpenDesignIntroStage) {
        guard interaction.introStage < stage else { return }
        withAnimation(.spring(response: reduceMotion ? 0 : 0.24, dampingFraction: 0.92)) {
            interaction.introStage = stage
        }
    }

    private func isSearchPulseActive(_ id: String) -> Bool {
        searchPulseTarget == id
    }

    private var signalRows: [(key: String, value: [OpenDesignSignalSegment])] {
        if let alignmentPlan = content.alignmentPlan {
            if let digestRows = alignmentPlan.signalDigest?.rows, !digestRows.isEmpty {
                return digestRows.filter { $0.key != "project" }.map { row in
                    (openDesignAlignmentDisplayLabel(for: row.key, fallback: row.label), signalSegments(for: row, alignmentPlan: alignmentPlan))
                }
            }
            let refs = alignmentPlan.signals.evidenceRefs.map(\.path).prefix(2).joined(separator: ", ")
            return [
                ("목표", [.body(alignmentPlan.projectGoal)]),
                ("고객", [.body(alignmentPlan.alignmentStatement.icp)]),
                ("문제", [.mark(alignmentPlan.alignmentStatement.painPoint)]),
                ("확인할 행동", [.strong(alignmentPlan.alignmentStatement.outcome)]),
                ("근거", [.code(refs.isEmpty ? "evidence 없음" : refs)]),
            ]
        }
        if let plan = content.plan {
            let refs = plan.signals.evidenceRefs.map(\.path).prefix(2).joined(separator: ", ")
            let missing = plan.signals.missingAssumptions.prefix(2).joined(separator: ", ")
            return [
                ("ICP 가설", [.body(plan.signals.currentIcpGuess ?? "아직 없음")]),
                ("핵심 문제", [.mark(plan.signals.problem ?? "가설 필요")]),
                ("근거/빈칸", [.code(refs.isEmpty ? "evidence 없음" : refs), .body(missing.isEmpty ? "" : " · missing \(missing)")]),
            ]
        }
        return [
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

    private func signalSegments(
        for row: Day1SignalDigestRow,
        alignmentPlan: Day1AlignmentPlan
    ) -> [OpenDesignSignalSegment] {
        let value = openDesignDisplaySignalDigestValue(for: row, alignmentPlan: alignmentPlan)
        switch row.tone?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() {
        case "strong", "accent":
            return [.strong(value)]
        case "mark":
            return [.mark(value)]
        case "code", "muted":
            return [.code(value)]
        default:
            switch row.key {
            case "project", "outcome":
                return [.strong(value)]
            case "pain":
                return [.mark(value)]
            case "evidence":
                return [.code(value)]
            default:
                return [.body(value)]
            }
        }
    }

    private static func displayProjectDigestValue(_ value: String) -> String {
        let parts = value
            .components(separatedBy: "·")
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
        let product = parts.first { !$0.lowercased().hasPrefix("quality") } ?? parts.first ?? value
        return displayProductName(product) ?? "이 프로젝트"
    }

    private static func displayProductName(_ value: String?) -> String? {
        openDesignDisplayProductName(value)
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
                .frame(maxWidth: .infinity, alignment: .leading)
                .layoutPriority(1)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .background(OpenDesignDayColor.surface)
    }

    private func signalAttributedValue(_ segments: [OpenDesignSignalSegment]) -> AttributedString {
        var value = AttributedString()
        for segment in segments {
            let runs = segment.style == .code
                ? [OpenDesignInlineMarkdownEmphasisRun(text: segment.text, isEmphasized: false)]
                : openDesignInlineMarkdownEmphasisRuns(in: segment.text)

            for parsed in runs {
                var run = AttributedString(parsed.text)
                applyOpenDesignSignalStyle(
                    to: &run,
                    style: segment.style,
                    isEmphasized: parsed.isEmphasized
                )
                value += run
            }
        }
        return value
    }
}

private struct OpenDesignDayStepWorkspaceView: View {
    let content: OpenDesignDayContent
    @Binding var interaction: OpenDesignDayInteractionState
    let activeInterviewStep: OpenDesignDayContent.InterviewStep?
    let actionSection: AnyView
    @Binding var selectedChoice: Int?
    @Binding var freeformAnswer: String
    let completeDayAction: () -> Void
    let advanceToNextDay: () -> Void
    let day1DocPreviews: [IddDocPreview]
    let day1HandoffPromptCard: AnyView?
    let activeDay1HandoffDocType: String?
    let pendingDay1HandoffDocType: String?
    let day1HandoffError: String?
    let startDay1DocHandoff: (String, [String: Any]) -> Void
    let activateFreeformAnswer: (Int) -> Void
    let previousAction: () -> Void
    let nextAction: () -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            if !interaction.missionAccepted || interaction.normalizedActiveStepID == 0 {
                actionSection
                    .transition(workflowPhaseTransition)
                    .overlay(alignment: .topLeading) {
                        activeStepAnchor
                    }
                    .id("active-step-start")
            } else if let activeInterviewStep {
                VStack(alignment: .leading, spacing: 0) {
                        OpenDesignInterviewStepView(
                            step: activeInterviewStep,
                            contextRows: openDesignAlignmentQuestionContextRows(
                                for: activeInterviewStep,
                                content: content,
                                interaction: interaction
                            ),
                            selectedChoice: $selectedChoice,
                            submittedChoice: interaction.submittedChoices[activeInterviewStep.id],
                            isLockedPrefill: interaction.lockedPrefillStepIDs.contains(activeInterviewStep.id),
                            freeformAnswer: $freeformAnswer,
                            activateFreeformAnswer: activateFreeformAnswer
                        )
                    OpenDesignStepFooter(
                        content: content,
                        interaction: interaction,
                        activeInterviewStep: activeInterviewStep,
                        selectedChoice: selectedChoice,
                        freeformAnswer: freeformAnswer,
                        isLockedPrefill: interaction.lockedPrefillStepIDs.contains(activeInterviewStep.id),
                        previousAction: previousAction,
                        nextAction: nextAction
                    )
                }
                .background(cardBackground(cornerRadius: 12, fill: OpenDesignDayColor.surface))
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                .transition(workflowPhaseTransition)
                .accessibilityElement(children: .contain)
                .overlay(alignment: .topLeading) {
                    activeStepAnchor
                }
                .id("active-step-\(activeInterviewStep.id)")
            } else if interaction.allInterviewsSubmitted {
                OpenDesignHypothesisConfirmationCard(
                    content: content,
                    interaction: $interaction,
                    completeDayAction: completeDayAction,
                    advanceToNextDay: advanceToNextDay,
                    day1DocPreviews: day1DocPreviews,
                    day1HandoffPromptCard: day1HandoffPromptCard,
                    activeDay1HandoffDocType: activeDay1HandoffDocType,
                    pendingDay1HandoffDocType: pendingDay1HandoffDocType,
                    day1HandoffError: day1HandoffError,
                    startDay1DocHandoff: startDay1DocHandoff
                )
                .transition(workflowPhaseTransition)
                .overlay(alignment: .topLeading) {
                    activeStepAnchor
                }
                .id("active-step-final")
            }
        }
        .animation(.spring(response: reduceMotion ? 0 : 0.28, dampingFraction: 0.90), value: interaction.normalizedActiveStepID)
    }

    private var workflowPhaseTransition: AnyTransition {
        AnyTransition.openDesignWorkflowPhase(
            direction: reduceMotion ? .neutral : interaction.workflowNavigationDirection
        )
    }

    private var activeStepAnchor: some View {
        openDesignAccessibilityAnchor("opendesign.day.activeStep.card", label: "OpenDesign Day Active Step")
    }
}

private extension AnyTransition {
    static func openDesignWorkflowPhase(direction: OpenDesignWorkflowNavigationDirection) -> AnyTransition {
        let offset: CGFloat = 24
        switch direction {
        case .forward:
            return .asymmetric(
                insertion: .offset(x: offset, y: 0).combined(with: .opacity),
                removal: .offset(x: -offset, y: 0).combined(with: .opacity)
            )
        case .backward:
            return .asymmetric(
                insertion: .offset(x: -offset, y: 0).combined(with: .opacity),
                removal: .offset(x: offset, y: 0).combined(with: .opacity)
            )
        case .neutral:
            return .opacity
        }
    }
}

private struct OpenDesignStepFooter: View {
    let content: OpenDesignDayContent
    let interaction: OpenDesignDayInteractionState
    let activeInterviewStep: OpenDesignDayContent.InterviewStep
    let selectedChoice: Int?
    let freeformAnswer: String
    let isLockedPrefill: Bool
    let previousAction: () -> Void
    let nextAction: () -> Void

    private var canAdvance: Bool {
        if selectedChoice == OpenDesignDayInteractionState.freeformChoiceID {
            return !freeformAnswer.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        }
        return selectedChoice != nil
    }

    private var canGoBack: Bool {
        interaction.normalizedActiveStepID > 0
    }

    private var nextLabel: String {
        guard canAdvance else { return "선택 필요" }
        return activeInterviewStep.id == content.interviewSteps.count ? "확정 보기" : "다음"
    }

    private var statusText: String? {
        if isLockedPrefill {
            let savedLabel = activeInterviewStep
                .selectedAnswerTitle(in: interaction)
                .map { openDesignCompactDisplayText($0, max: 28) }
                ?? "intake 답변"
            return "intake 답변 저장됨 · \(savedLabel)"
        }
        if let submitted = interaction.submittedChoices[activeInterviewStep.id],
           submitted == selectedChoice {
            let savedLabel = activeInterviewStep
                .selectedAnswerTitle(in: interaction)
                .map { openDesignCompactDisplayText($0, max: 28) }
                ?? (submitted == OpenDesignDayInteractionState.freeformChoiceID ? "직접 입력" : "\(submitted)번")
            return "저장 완료 · \(savedLabel)"
        }
        if selectedChoice != nil {
            return "선택 완료"
        }
        return nil
    }

    var body: some View {
        HStack(spacing: 12) {
            if let statusText {
                Text(statusText)
                    .font(.system(size: 10.5, weight: .medium, design: .monospaced))
                    .foregroundStyle(canAdvance ? OpenDesignDayColor.accent : OpenDesignDayColor.muted)
                    .lineLimit(1)
                    .accessibilityIdentifier("opendesign.day.step.footer.status")
            }

            Spacer(minLength: 0)

            OpenDesignGhostActionButton(
                label: "이전",
                systemImage: "chevron.left",
                accessibilityIdentifier: "opendesign.day.step.previous",
                isDisabled: !canGoBack,
                action: previousAction
            )

            OpenDesignHandoffActionButton(
                label: nextLabel,
                accessibilityIdentifier: "opendesign.day.step.next",
                isDisabled: !canAdvance,
                action: nextAction
            )
        }
        .padding(.horizontal, 14)
        .frame(height: 48)
        .background(OpenDesignDayColor.bgDeep)
        .overlay(Rectangle().fill(OpenDesignDayColor.borderSoft).frame(height: 1), alignment: .top)
    }
}

private struct OpenDesignDayHeader: View {
    let content: OpenDesignDayContent
    @Binding var interaction: OpenDesignDayInteractionState
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
                    Text("핵심 가설 확정")
                        .font(.system(size: 17, weight: .semibold))
                        .foregroundStyle(OpenDesignDayColor.fg)
                    HStack(spacing: 8) {
                        Circle()
                            .fill(OpenDesignDayColor.accent)
                            .frame(width: 5, height: 5)
                            .shadow(color: OpenDesignDayColor.accentDim, radius: 3)
                        Text("Day 1")
                        Text("·")
                            .foregroundStyle(OpenDesignDayColor.mutedDeep)
                        Text(progressStepLabel)
                            .foregroundStyle(OpenDesignDayColor.fgSecondary)
                    }
                    .font(.system(size: 11, weight: .medium, design: .monospaced))
                    .foregroundStyle(OpenDesignDayColor.muted)
                    .lineLimit(1)
                }
                .frame(minWidth: 0, alignment: .leading)
            }

            Spacer(minLength: 12)
        }
        .padding(.horizontal, horizontalPadding)
        .frame(height: 70)
        .background(OpenDesignDayColor.bg)
        .overlay(Rectangle().fill(OpenDesignDayColor.borderSoft).frame(height: 1), alignment: .bottom)
    }

    private var progressStepLabel: String {
        if interaction.dayCompleted || interaction.allInterviewsSubmitted {
            return "STEP \(interaction.workflowStepCount) / \(interaction.workflowStepCount)"
        }
        if interaction.missionAccepted {
            return "STEP \(interaction.normalizedActiveStepID + 1) / \(interaction.workflowStepCount)"
        }
        return "STEP 1 / \(interaction.workflowStepCount)"
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
    var isDisabled = false
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
                    isDisabled: isDisabled,
                    cornerRadius: 8,
                    fill: isDisabled ? OpenDesignDayColor.surface2 : tone == .accent ? OpenDesignDayColor.accent : Color.clear,
                    hoverFill: tone == .accent ? OpenDesignDayColor.accentStrong : OpenDesignDayColor.hover,
                    border: isDisabled ? OpenDesignDayColor.borderSoft : tone == .accent ? Color.clear : OpenDesignDayColor.borderSoft,
                    hoverBorder: tone == .accent ? Color.clear : OpenDesignDayColor.border
                )
        }
        .buttonStyle(OpenDesignInteractiveButtonStyle(isDisabled: isDisabled))
        .disabled(isDisabled)
        .onHover { isHovered = $0 }
        .accessibilityValue(isDisabled ? "locked" : isHovered ? "active" : "inactive")
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
        if isDisabled {
            return OpenDesignDayColor.mutedDeep
        }
        switch tone {
        case .ghost:
            return isHovered ? OpenDesignDayColor.fg : OpenDesignDayColor.fgSecondary
        case .accent:
            return OpenDesignDayColor.bgDeep
        }
    }
}

private struct OpenDesignStepper: View {
    let content: OpenDesignDayContent
    let interaction: OpenDesignDayInteractionState
    let horizontalPadding: CGFloat
    let focusStep: (Int) -> Void

    private struct StepItem: Identifiable {
        let id: Int
        let title: String
        let isDone: Bool
        let isCurrent: Bool
        let isUnlocked: Bool
    }

    private var steps: [StepItem] {
        let start = StepItem(
            id: 0,
            title: "시작",
            isDone: interaction.missionAccepted,
            isCurrent: interaction.normalizedActiveStepID == 0,
            isUnlocked: true
        )
        let questions = content.interviewSteps.map { step in
            StepItem(
                id: step.id,
                title: step.progressLabel,
                isDone: interaction.submittedSteps.contains(step.id),
                isCurrent: interaction.normalizedActiveStepID == step.id,
                isUnlocked: interaction.isWorkflowStepUnlocked(step.id)
            )
        }
        let final = StepItem(
            id: interaction.finalStepID,
            title: "확정",
            isDone: interaction.dayCompleted,
            isCurrent: interaction.normalizedActiveStepID == interaction.finalStepID,
            isUnlocked: interaction.isWorkflowStepUnlocked(interaction.finalStepID)
        )
        return [start] + questions + [final]
    }

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 0) {
                ForEach(Array(steps.enumerated()), id: \.element.id) { index, step in
                    OpenDesignStepperChip(
                        index: index,
                        title: step.title,
                        isDone: step.isDone,
                        isCurrent: step.isCurrent,
                        isUnlocked: step.isUnlocked,
                        action: { focusStep(step.id) }
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
    let isUnlocked: Bool
    let action: () -> Void

    @State private var isHovered = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                Text(isDone ? "✓" : "\(index + 1)")
                    .font(.system(size: 10, weight: .semibold, design: .monospaced))
                    .foregroundStyle(isDone ? OpenDesignDayColor.bgDeep : isCurrent || isHovered ? OpenDesignDayColor.accent : isUnlocked ? OpenDesignDayColor.muted : OpenDesignDayColor.mutedDeep)
                    .frame(width: 18, height: 18)
                    .background(Circle().fill(isDone ? OpenDesignDayColor.accent : Color.clear))
                    .overlay(Circle().stroke(isCurrent || isDone || isHovered ? OpenDesignDayColor.accent : OpenDesignDayColor.mutedDeep, lineWidth: 1.5))
                Text(title)
            }
            .font(.system(size: 10.5, weight: .medium, design: .monospaced))
            .foregroundStyle(isCurrent || isHovered ? OpenDesignDayColor.accent : isDone ? OpenDesignDayColor.fgSecondary : isUnlocked ? OpenDesignDayColor.muted : OpenDesignDayColor.mutedDeep)
            .padding(.horizontal, 12)
            .frame(height: 30)
            .openDesignHoverRow(
                isHovered: isHovered,
                isActive: isCurrent,
                isDisabled: !isUnlocked,
                cornerRadius: 15,
                hoverFill: OpenDesignDayColor.accentDim,
                activeFill: OpenDesignDayColor.accentDim,
                hoverBorder: OpenDesignDayColor.accentLine,
                activeBorder: OpenDesignDayColor.accentLine
            )
        }
        .buttonStyle(OpenDesignInteractiveButtonStyle(isDisabled: !isUnlocked))
        .disabled(!isUnlocked)
        .onHover { isHovered = $0 }
        .accessibilityValue(isUnlocked ? isCurrent ? "active" : "inactive" : "locked")
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

private struct OpenDesignQuestionContextRows: View {
    let rows: [OpenDesignAlignmentQuestionContextRow]

    var body: some View {
        VStack(spacing: 0) {
            ForEach(rows.indices, id: \.self) { index in
                let row = rows[index]
                HStack(alignment: .top, spacing: 10) {
                    Text(row.label)
                        .font(.system(size: 10.5, weight: .semibold, design: .monospaced))
                        .foregroundStyle(OpenDesignDayColor.accent)
                        .frame(width: 34, alignment: .leading)
                        .padding(.top, 1)

                    Text(row.value)
                        .font(.system(size: 11.5, weight: .medium))
                        .foregroundStyle(OpenDesignDayColor.fgSecondary)
                        .lineSpacing(2)
                        .lineLimit(1)
                        .truncationMode(.tail)

                    Spacer(minLength: 0)
                }
                .padding(.horizontal, 10)
                .padding(.vertical, 7)
                .background(OpenDesignDayColor.bgDeep)
                .accessibilityElement(children: .combine)
                .accessibilityLabel(row.accessibilityLabel)
                .accessibilityIdentifier("opendesign.day.question.context.\(row.id)")

                if index < rows.count - 1 {
                    Rectangle()
                        .fill(OpenDesignDayColor.borderSoft)
                        .frame(height: 1)
                }
            }
        }
        .background(OpenDesignDayColor.borderSoft)
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .stroke(OpenDesignDayColor.borderSoft, lineWidth: 1)
        )
        .accessibilityIdentifier("opendesign.day.question.context")
    }
}

private struct OpenDesignInterviewStepView: View {
    let step: OpenDesignDayContent.InterviewStep
    let contextRows: [OpenDesignAlignmentQuestionContextRow]
    @Binding var selectedChoice: Int?
    let submittedChoice: Int?
    let isLockedPrefill: Bool
    @Binding var freeformAnswer: String
    let activateFreeformAnswer: (Int) -> Void

    @FocusState private var isFreeformFocused: Bool
    @State private var isFreeformPresentationActive = false

    var body: some View {
        let hasSubmitted = submittedChoice != nil

        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: 11) {
                HStack {
                    HStack(spacing: 8) {
                        Circle()
                            .fill(OpenDesignDayColor.accent)
                            .frame(width: 6, height: 6)
                            .shadow(color: OpenDesignDayColor.accentDim, radius: 4)
                        Text("STEP \(step.id) · \(step.progressLabel)")
                    }
                    .font(.system(size: 10.5, weight: .semibold, design: .monospaced))
                    .textCase(.uppercase)
                    .foregroundStyle(OpenDesignDayColor.accent)

                    Spacer(minLength: 0)

                    Text(step.score)
                        .font(.system(size: 10.5, weight: .semibold, design: .monospaced))
                        .foregroundStyle(OpenDesignDayColor.accent)
                        .padding(.horizontal, 8)
                        .frame(height: 22)
                        .background(Capsule().fill(OpenDesignDayColor.accentDim))
                        .overlay(Capsule().stroke(OpenDesignDayColor.accentLine, lineWidth: 1))
                }

                Text(questionTitleText)
                    .font(.system(size: 22, weight: .semibold))
                    .lineSpacing(3)
                    .fixedSize(horizontal: false, vertical: true)

                if !contextRows.isEmpty {
                    OpenDesignQuestionContextRows(rows: contextRows)
                }

                if shouldShowQuestionHint, let questionHint {
                    Text(questionHint)
                        .font(.system(size: 12.5, weight: .regular))
                        .foregroundStyle(OpenDesignDayColor.fgSecondary)
                        .lineSpacing(3)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityIdentifier("opendesign.day.step.hint")
                }
            }
            .padding(.horizontal, 18)
            .padding(.top, 18)
            .padding(.bottom, 16)
            .background(
                LinearGradient(
                    colors: [OpenDesignDayColor.surface2, OpenDesignDayColor.surface],
                    startPoint: .top,
                    endPoint: .bottom
                )
            )
            .overlay(Rectangle().fill(OpenDesignDayColor.borderSoft).frame(height: 1), alignment: .bottom)

            HStack {
                HStack(spacing: 8) {
                    RoundedRectangle(cornerRadius: 2, style: .continuous)
                        .fill(OpenDesignDayColor.accent)
                        .frame(width: 4, height: 14)
                    Text(step.prompt)
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(OpenDesignDayColor.fg)
                        .lineLimit(1)
                }
                Spacer(minLength: 0)
                Text(stepStatusText)
                    .font(.system(size: 10.5, weight: .medium, design: .monospaced))
                    .foregroundStyle(OpenDesignDayColor.muted)
            }
            .padding(.horizontal, 14)
            .frame(height: 42)
            .background(OpenDesignDayColor.surface2)
            .overlay(Rectangle().fill(OpenDesignDayColor.borderSoft).frame(height: 1), alignment: .bottom)

            if !selectableOptions.isEmpty {
                OpenDesignQuestionOptionGrid(
                    stepID: step.id,
                    options: selectableOptions,
                    selectedChoice: $selectedChoice,
                    submittedChoice: submittedChoice,
                    hasSubmittedStep: hasSubmitted,
                    isLockedPrefill: isLockedPrefill
                )
                .id(step.id == 1 ? "interview1-options" : "interview\(step.id)-options")
            }

            if let scanWarningOption {
                OpenDesignScanWarningCard(
                    stepID: step.id,
                    option: scanWarningOption
                )
            }

            if step.allowsFreeform {
                freeformRow
            }
        }
        .onChange(of: step.id) { _, _ in
            isFreeformPresentationActive = false
        }
        .onChange(of: selectedChoice) { _, value in
            if let value, value != OpenDesignDayInteractionState.freeformChoiceID {
                isFreeformPresentationActive = false
                isFreeformFocused = false
            }
        }
    }

    private var selectableOptions: [OpenDesignDayContent.InterviewOption] {
        step.options.filter { !$0.isScanWarningOnly }
    }

    private var stepStatusText: String {
        if isLockedPrefill {
            return "intake 답변 저장됨 · \(step.progressLabel)"
        }
        return selectedChoice == nil ? "대기 · \(step.progressLabel)" : "선택됨 · \(step.progressLabel)"
    }

    private var scanWarningOption: OpenDesignDayContent.InterviewOption? {
        step.options.first(where: \.isScanWarningOnly)
    }

    private var questionStatement: String {
        let statement = step.statementPrefix + step.markedStatement + step.statementSuffix
        let trimmed = statement.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? step.prompt : trimmed
    }

    private var questionTitleText: AttributedString {
        openDesignHighlightedAttributedText(
            questionStatement,
            phrases: step.highlightPhrases,
            bodySize: 22,
            bodyWeight: .semibold,
            bodyColor: OpenDesignDayColor.fg,
            highlightWeight: .semibold
        )
    }

    private var questionHint: String? {
        openDesignQuestionHintText(for: step)
    }

    private var shouldShowQuestionHint: Bool {
        true
    }

    private var freeformRow: some View {
        let isPicked = selectedChoice == OpenDesignDayInteractionState.freeformChoiceID
        let isFieldFocused = isFreeformFocused || isFreeformPresentationActive
        let isFieldHighlighted = isPicked || isFieldFocused
        let isSubmitted = submittedChoice == OpenDesignDayInteractionState.freeformChoiceID && isPicked
        return HStack(alignment: .top, spacing: 11) {
            Text(isSubmitted ? "✓" : "›")
                .font(.system(size: 15, weight: .semibold, design: .monospaced))
                .foregroundStyle(isPicked ? OpenDesignDayColor.bgDeep : OpenDesignDayColor.accent)
                .frame(width: 24, height: 24)
                .background(Circle().fill(isPicked ? OpenDesignDayColor.accent : OpenDesignDayColor.bgDeep))
                .overlay(Circle().stroke(isPicked ? OpenDesignDayColor.accent : OpenDesignDayColor.border, lineWidth: 1))
                .padding(.top, 1)

            VStack(alignment: .leading, spacing: 8) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(step.freeformLabel)
                        .font(.system(size: 12.5, weight: .semibold))
                        .foregroundStyle(OpenDesignDayColor.fg)
                    if isSubmitted {
                        Text("확정됨")
                            .font(.system(size: 9.5, weight: .bold, design: .monospaced))
                            .foregroundStyle(OpenDesignDayColor.bgDeep)
                            .padding(.horizontal, 7)
                            .frame(height: 17)
                            .background(Capsule().fill(OpenDesignDayColor.accent))
                    }
                    Spacer(minLength: 0)
                }

                TextField(step.freeformPlaceholder, text: $freeformAnswer)
                    .textFieldStyle(.plain)
                    .font(.system(size: 12.5, weight: .medium))
                    .foregroundStyle(OpenDesignDayColor.fg)
                    .focused($isFreeformFocused)
                    .onChange(of: isFreeformFocused) { _, isFocused in
                        guard isFocused else { return }
                        guard !isLockedPrefill else { return }
                        focusFreeformPresentation()
                    }
                    .simultaneousGesture(TapGesture().onEnded {
                        guard !isLockedPrefill else { return }
                        focusFreeformPresentation()
                    })
                    .onChange(of: freeformAnswer) { _, value in
                        guard !isLockedPrefill else { return }
                        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
                        if trimmed.isEmpty {
                            if selectedChoice == OpenDesignDayInteractionState.freeformChoiceID {
                                selectedChoice = nil
                            }
                        } else {
                            activateFreeformAnswer(step.id)
                            selectedChoice = OpenDesignDayInteractionState.freeformChoiceID
                        }
                    }
                    .disabled(isLockedPrefill)
                    .accessibilityIdentifier(step.id == 1 ? "opendesign.day.icp.freeform" : "opendesign.day.interview.\(step.id).freeform")
                    .padding(.horizontal, 11)
                    .frame(height: 34)
                    .background(
                        RoundedRectangle(cornerRadius: 8, style: .continuous)
                            .fill(OpenDesignDayColor.bgDeep)
                            .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).stroke(isFieldHighlighted ? OpenDesignDayColor.accentLine : OpenDesignDayColor.borderSoft, lineWidth: 1))
                    )
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .background(isPicked ? OpenDesignDayColor.accent.opacity(0.08) : OpenDesignDayColor.surface)
        .overlay(Rectangle().stroke(isPicked ? OpenDesignDayColor.accentLine : Color.clear, lineWidth: 1))
        .accessibilityElement(children: .contain)
        .accessibilityLabel(isSubmitted || isPicked ? "active" : "inactive")
        .accessibilityValue(isSubmitted || isPicked ? "active" : "inactive")
        .accessibilityIdentifier(step.id == 1 ? "opendesign.day.icp.freeform.card" : "opendesign.day.interview.\(step.id).freeform.card")
    }

    private func focusFreeformPresentation() {
        isFreeformPresentationActive = true
        activateFreeformAnswer(step.id)
        let trimmed = freeformAnswer.trimmingCharacters(in: .whitespacesAndNewlines)
        selectedChoice = trimmed.isEmpty ? nil : OpenDesignDayInteractionState.freeformChoiceID
    }
}

private struct OpenDesignQuestionGridWidthPreferenceKey: PreferenceKey {
    static let defaultValue: CGFloat = 0

    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) {
        let next = nextValue()
        if next > 0 {
            value = next
        }
    }
}

private struct OpenDesignQuestionOptionGridLayout: Layout {
    let columnCount: Int
    var spacing: CGFloat = 1

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? 0
        let metrics = layoutMetrics(for: subviews, width: width)
        return CGSize(width: width, height: metrics.height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let metrics = layoutMetrics(for: subviews, width: bounds.width)
        var rowY = bounds.minY

        for rowIndex in 0..<metrics.rowHeights.count {
            let rowHeight = metrics.rowHeights[rowIndex]
            for columnIndex in 0..<metrics.columns {
                let subviewIndex = rowIndex * metrics.columns + columnIndex
                guard subviewIndex < subviews.count else { continue }

                let x = bounds.minX + CGFloat(columnIndex) * (metrics.columnWidth + spacing)
                subviews[subviewIndex].place(
                    at: CGPoint(x: x, y: rowY),
                    proposal: ProposedViewSize(width: metrics.columnWidth, height: rowHeight)
                )
            }
            rowY += rowHeight + spacing
        }
    }

    private func layoutMetrics(for subviews: Subviews, width: CGFloat) -> OpenDesignQuestionOptionGridMetrics {
        let columns = max(columnCount, 1)
        let columnWidth = max((width - CGFloat(columns - 1) * spacing) / CGFloat(columns), 0)
        let rowCount = Int(ceil(Double(subviews.count) / Double(columns)))
        let rowHeights = (0..<rowCount).map { rowIndex in
            let range = rowIndex * columns..<min((rowIndex + 1) * columns, subviews.count)
            return range.reduce(CGFloat(0)) { height, subviewIndex in
                let size = subviews[subviewIndex].sizeThatFits(
                    ProposedViewSize(width: columnWidth, height: nil)
                )
                return max(height, size.height)
            }
        }
        let height = rowHeights.reduce(CGFloat(0), +) + CGFloat(max(0, rowHeights.count - 1)) * spacing
        return OpenDesignQuestionOptionGridMetrics(
            columns: columns,
            columnWidth: columnWidth,
            rowHeights: rowHeights,
            height: height
        )
    }

    private struct OpenDesignQuestionOptionGridMetrics {
        let columns: Int
        let columnWidth: CGFloat
        let rowHeights: [CGFloat]
        let height: CGFloat
    }
}

private struct OpenDesignQuestionOptionGrid: View {
    let stepID: Int
    let options: [OpenDesignDayContent.InterviewOption]
    @Binding var selectedChoice: Int?
    let submittedChoice: Int?
    let hasSubmittedStep: Bool
    let isLockedPrefill: Bool

    @State private var availableWidth: CGFloat = 0

    private var usesTwoColumns: Bool {
        availableWidth >= 620
    }

    private var columnCount: Int {
        usesTwoColumns ? 2 : 1
    }

    var body: some View {
        OpenDesignQuestionOptionGridLayout(columnCount: columnCount, spacing: 1) {
            ForEach(options) { option in
                let isPicked = selectedChoice == option.id
                OpenDesignQuestionOptionTile(
                    option: option,
                    isPicked: isPicked,
                    isSubmitted: isPicked && submittedChoice == option.id,
                    hasSubmittedStep: hasSubmittedStep,
                    isLockedPrefill: isLockedPrefill,
                    select: { selectedChoice = option.id }
                )
                .accessibilityIdentifier(accessibilityIdentifier(for: option))
            }
        }
        .padding(1)
        .background(OpenDesignDayColor.borderSoft)
        .background(
            GeometryReader { proxy in
                Color.clear.preference(key: OpenDesignQuestionGridWidthPreferenceKey.self, value: proxy.size.width)
            }
        )
        .onPreferenceChange(OpenDesignQuestionGridWidthPreferenceKey.self) { width in
            availableWidth = width
        }
    }

    private func accessibilityIdentifier(for option: OpenDesignDayContent.InterviewOption) -> String {
        stepID == 1 ? "opendesign.day.icp.option.\(option.id)" : "opendesign.day.interview.\(stepID).option.\(option.id)"
    }
}

private struct OpenDesignScanWarningCard: View {
    let stepID: Int
    let option: OpenDesignDayContent.InterviewOption

    var body: some View {
        HStack(alignment: .top, spacing: 11) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(OpenDesignDayColor.bgDeep)
                .frame(width: 24, height: 24)
                .background(Circle().fill(OpenDesignDayColor.amber))
                .padding(.top, 1)

            VStack(alignment: .leading, spacing: 5) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(openDesignHighlightedAttributedText(
                        option.title,
                        phrases: titleHighlightPhrases,
                        bodySize: 12.8,
                        bodyWeight: .semibold,
                        bodyColor: OpenDesignDayColor.fg,
                        highlightWeight: .semibold,
                        highlightBackground: Color.clear
                    ))
                        .lineLimit(2)
                        .fixedSize(horizontal: false, vertical: true)
                    Text("scan 필요")
                        .font(.system(size: 9.8, weight: .bold, design: .monospaced))
                        .foregroundStyle(OpenDesignDayColor.bgDeep)
                        .padding(.horizontal, 7)
                        .frame(height: 18)
                        .background(Capsule().fill(OpenDesignDayColor.amber))
                }

                Text(option.detail)
                    .font(.system(size: 11.6, weight: .regular))
                    .foregroundStyle(OpenDesignDayColor.muted)
                    .lineSpacing(2)
                    .lineLimit(3)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .background(OpenDesignDayColor.amber.opacity(0.10))
        .overlay(Rectangle().stroke(OpenDesignDayColor.amber.opacity(0.46), lineWidth: 1))
        .accessibilityElement(children: .combine)
        .accessibilityValue("scan-needed")
        .accessibilityIdentifier(stepID == 1 ? "opendesign.day.icp.scanWarning" : "opendesign.day.interview.\(stepID).scanWarning")
    }

    private var titleHighlightPhrases: [String] {
        openDesignOptionTitleHighlightPhrases(option.highlightPhrases, for: option.title)
    }
}

private struct OpenDesignQuestionOptionTile: View {
    let option: OpenDesignDayContent.InterviewOption
    let isPicked: Bool
    let isSubmitted: Bool
    let hasSubmittedStep: Bool
    let isLockedPrefill: Bool
    let select: () -> Void

    @State private var isHovered = false

    private var isActive: Bool {
        isPicked || isSubmitted
    }

    private var tone: Color {
        if option.evidenceLimited {
            return OpenDesignDayColor.amber
        }
        if option.isAntiSignal {
            return OpenDesignDayColor.rose
        }
        return OpenDesignDayColor.accent
    }

    private var fill: Color {
        if isActive {
            return tone.opacity(0.10)
        }
        if isHovered {
            return OpenDesignDayColor.hover
        }
        return OpenDesignDayColor.surface
    }

    private var stroke: Color {
        if isActive {
            return tone.opacity(0.48)
        }
        if isHovered {
            return OpenDesignDayColor.borderStrong
        }
        return Color.clear
    }

    private var hasDetail: Bool {
        !option.detail.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var body: some View {
        Button(action: select) {
            HStack(alignment: .top, spacing: 11) {
                Text(isSubmitted ? "✓" : "\(option.id)")
                    .font(.system(size: 11, weight: .semibold, design: .monospaced))
                    .foregroundStyle(isActive ? OpenDesignDayColor.bgDeep : isHovered ? OpenDesignDayColor.fgSecondary : OpenDesignDayColor.muted)
                    .frame(width: 24, height: 24)
                    .background(Circle().fill(isActive ? tone : OpenDesignDayColor.bgDeep))
                    .overlay(Circle().stroke(isActive ? tone : isHovered ? OpenDesignDayColor.borderStrong : OpenDesignDayColor.border, lineWidth: 1))
                    .padding(.top, 1)

                VStack(alignment: .leading, spacing: 6) {
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Text(openDesignHighlightedAttributedText(
                            option.title,
                            phrases: titleHighlightPhrases,
                            bodySize: 13.5,
                            bodyWeight: .semibold,
                            bodyColor: OpenDesignDayColor.fg,
                            highlightWeight: .semibold,
                            highlightColor: tone,
                            highlightBackground: Color.clear
                        ))
                            .lineLimit(nil)
                            .fixedSize(horizontal: false, vertical: true)
                            .layoutPriority(1)

                        if let badgeText {
                            Text(badgeText)
                                .font(.system(size: 9.5, weight: .bold, design: .monospaced))
                                .foregroundStyle(OpenDesignDayColor.bgDeep)
                                .padding(.horizontal, 7)
                                .frame(height: 17)
                                .background(Capsule().fill(badgeFill))
                                .alignmentGuide(.firstTextBaseline) { dimension in
                                    dimension[VerticalAlignment.center] + 2
                                }
                        }
                    }

                    if hasDetail {
                        Text(option.detail)
                            .font(.system(size: 11.8, weight: .regular))
                            .foregroundStyle(OpenDesignDayColor.muted)
                            .lineSpacing(2)
                            .lineLimit(nil)
                            .fixedSize(horizontal: false, vertical: true)
                            .layoutPriority(1)
                    }

                    Text(optionTail)
                        .font(.system(size: 9.8, weight: .medium, design: .monospaced))
                        .foregroundStyle(isActive ? tone : isHovered ? OpenDesignDayColor.fgSecondary : OpenDesignDayColor.mutedDeep)
                        .lineLimit(1)
                        .padding(.horizontal, 7)
                        .frame(height: 18)
                        .background(Capsule().fill(isActive ? tone.opacity(0.12) : OpenDesignDayColor.bgDeep))
                        .overlay(Capsule().stroke(isActive ? tone.opacity(0.36) : OpenDesignDayColor.borderSoft, lineWidth: 1))
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .layoutPriority(1)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 12)
            .frame(maxWidth: .infinity, minHeight: hasDetail ? 86 : 70, maxHeight: .infinity, alignment: .topLeading)
            .background(fill)
            .overlay(Rectangle().stroke(stroke, lineWidth: 1))
            .contentShape(Rectangle())
        }
        .buttonStyle(OpenDesignInteractiveButtonStyle(isDisabled: isLockedPrefill))
        .disabled(isLockedPrefill)
        .onHover { isHovered = $0 }
        .accessibilityElement(children: .combine)
        .accessibilityValue(isLockedPrefill && isSubmitted ? "intake-saved" : isSubmitted || isPicked ? "active" : "inactive")
    }

    private var badgeText: String? {
        if isLockedPrefill && isSubmitted { return "intake 저장" }
        if isSubmitted { return "확정됨" }
        return nil
    }

    private var badgeFill: Color {
        isSubmitted ? OpenDesignDayColor.accent : OpenDesignDayColor.amber
    }

    private var optionTail: String {
        if isLockedPrefill && isSubmitted { return "intake 답변" }
        if isSubmitted { return "확정됨" }
        if hasSubmittedStep { return "변경" }
        return option.tail
    }

    private var titleHighlightPhrases: [String] {
        openDesignOptionTitleHighlightPhrases(option.highlightPhrases, for: option.title)
    }
}

private struct OpenDesignHypothesisSummaryRow: Identifiable {
    let id: String
    let label: String
    let value: String
    let highlightPhrases: [String]

    init(id: String, label: String, value: String, highlightPhrases: [String] = []) {
        self.id = id
        self.label = label
        self.value = value
        self.highlightPhrases = highlightPhrases
    }
}

private struct OpenDesignDayDocumentStep: Identifiable {
    let type: String
    let title: String
    let path: String
    let status: String
    let isUnlocked: Bool

    var id: String { type }

    var isWritten: Bool {
        ["written", "written_with_assumptions", "approved"].contains(status)
    }

    static func ordered(previews: [IddDocPreview]) -> [OpenDesignDayDocumentStep] {
        let order = [
            ("goal", "GOAL", "docs/GOAL.md"),
            ("icp", "ICP", "docs/ICP.md"),
            ("values", "VALUES", "docs/VALUES.md"),
            ("spec", "SPEC", "docs/SPEC.md"),
        ]
        var previousWritten = true
        return order.map { item in
            let preview = previews.first(where: { $0.type == item.0 })
            let status = preview?.status ?? "pending"
            let step = OpenDesignDayDocumentStep(
                type: item.0,
                title: item.1,
                path: preview?.path ?? item.2,
                status: status,
                isUnlocked: previousWritten
            )
            previousWritten = previousWritten && step.isWritten
            return step
        }
    }
}

private struct OpenDesignHypothesisConfirmationCard: View {
    let content: OpenDesignDayContent
    @Binding var interaction: OpenDesignDayInteractionState
    let completeDayAction: () -> Void
    let advanceToNextDay: () -> Void
    let day1DocPreviews: [IddDocPreview]
    let day1HandoffPromptCard: AnyView?
    let activeDay1HandoffDocType: String?
    let pendingDay1HandoffDocType: String?
    let day1HandoffError: String?
    let startDay1DocHandoff: (String, [String: Any]) -> Void

    @State private var showsDetails = false
    @State private var isConfirmHovered = false
    @State private var bulkSavingDocType: String?
    @State private var bulkSavePendingDocTypes: [String] = []
    @State private var bulkBackendWrittenDocTypes: Set<String> = []
    @State private var bulkDelayCompletedDocTypes: Set<String> = []
    @State private var bulkVisualCompletedDocTypes: Set<String> = []
    @State private var isBulkSaveVisualActive = false
    @State private var bulkSaveAnimationTask: Task<Void, Never>?

    private var draft: OpenDesignDayDraft {
        content.draft(for: interaction)
    }

    private var rows: [OpenDesignHypothesisSummaryRow] {
        if let alignmentPlan = content.alignmentPlan {
            let icpValue = selectedOptionTitle(stepID: 1)
                ?? alignmentDisplayValue(key: "icp", label: "고객", fallback: alignmentPlan.alignmentStatement.icp)
            let painValue = selectedOptionTitle(stepID: 2)
                ?? alignmentDisplayValue(key: "pain", label: "문제", fallback: alignmentPlan.alignmentStatement.painPoint)
            let outcomeValue = selectedOptionTitle(stepID: 3)
                ?? alignmentDisplayValue(key: "outcome", label: "확인할 행동", fallback: alignmentPlan.alignmentStatement.outcome)
            return [
                OpenDesignHypothesisSummaryRow(id: "goal", label: "목표", value: alignmentDisplayValue(key: "goal", label: "목표", fallback: alignmentPlan.projectGoal)),
                OpenDesignHypothesisSummaryRow(
                    id: "icp",
                    label: "고객",
                    value: icpValue,
                    highlightPhrases: selectedOptionHighlightPhrases(stepID: 1) ?? alignmentPlan.components.icp.highlightPhrases ?? []
                ),
                OpenDesignHypothesisSummaryRow(
                    id: "pain",
                    label: "문제",
                    value: painValue,
                    highlightPhrases: selectedOptionHighlightPhrases(stepID: 2) ?? alignmentPlan.components.painPoint.highlightPhrases ?? []
                ),
                OpenDesignHypothesisSummaryRow(
                    id: "outcome",
                    label: "확인할 행동",
                    value: outcomeValue,
                    highlightPhrases: selectedOptionHighlightPhrases(stepID: 3) ?? alignmentPlan.components.outcome.highlightPhrases ?? []
                ),
            ]
        }

        let goal = content.plan == nil
            ? "이번 주 바로 연락할 첫 고객 1명을 고정"
            : content.contextTitle
        let pain = content.plan?.signals.problem ?? draft.stuck
        return [
            OpenDesignHypothesisSummaryRow(id: "goal", label: "목표", value: goal),
            OpenDesignHypothesisSummaryRow(id: "icp", label: "고객", value: draft.finalIcpStatement),
            OpenDesignHypothesisSummaryRow(id: "pain", label: "문제", value: pain),
            OpenDesignHypothesisSummaryRow(id: "outcome", label: "확인할 행동", value: draft.recommendation),
        ]
    }

    private var documentSteps: [OpenDesignDayDocumentStep] {
        OpenDesignDayDocumentStep.ordered(previews: day1DocPreviews)
    }

    private var areDay1DocumentsWritten: Bool {
        documentSteps.allSatisfy(\.isWritten)
    }

    private var writtenDocumentCount: Int {
        documentSteps.filter(\.isWritten).count
    }

    private var displayedWrittenDocumentCount: Int {
        if isBulkSaveVisualActive {
            return documentSteps.filter { documentStepVisuallyWritten($0) }.count
        }
        return writtenDocumentCount
    }

    private var isBulkWritingDocuments: Bool {
        pendingDay1HandoffDocType == "all" || isBulkSaveVisualActive
    }

    private var isDocumentHandoffBusy: Bool {
        pendingDay1HandoffDocType != nil || activeDay1HandoffDocType != nil || isBulkSaveVisualActive
    }

    private var day1HandoffDocumentOrder: [String] {
        ["goal", "icp", "values", "spec"]
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            OpenDesignSectionHeader(title: "핵심 가설 확정")

            VStack(alignment: .leading, spacing: 14) {
                HStack(alignment: .firstTextBaseline, spacing: 10) {
                    Text("CONFIRM")
                        .font(.system(size: 10.5, weight: .semibold, design: .monospaced))
                        .foregroundStyle(OpenDesignDayColor.accent)
                        .padding(.horizontal, 8)
                        .frame(height: 22)
                        .background(Capsule().fill(OpenDesignDayColor.accentDim))
                        .overlay(Capsule().stroke(OpenDesignDayColor.accentLine, lineWidth: 1))
                    Text("이 가설로 내일 시장 신호를 검증합니다.")
                        .font(.system(size: 17, weight: .semibold))
                        .foregroundStyle(OpenDesignDayColor.fg)
                        .fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: 0)
                }

                VStack(spacing: 8) {
                    ForEach(rows) { row in
                        hypothesisRow(row)
                    }
                }

                DisclosureGroup(isExpanded: $showsDetails) {
                    VStack(alignment: .leading, spacing: 10) {
                        Text("문서/근거")
                            .font(.system(size: 10, weight: .semibold, design: .monospaced))
                            .foregroundStyle(OpenDesignDayColor.mutedDeep)
                        Text(draft.markdown)
                            .font(.system(size: 11, weight: .medium, design: .monospaced))
                            .foregroundStyle(OpenDesignDayColor.fgSecondary)
                            .lineSpacing(3)
                            .lineLimit(14)
                            .padding(12)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(
                                RoundedRectangle(cornerRadius: 9, style: .continuous)
                                    .fill(OpenDesignDayColor.bgDarker)
                                    .overlay(RoundedRectangle(cornerRadius: 9, style: .continuous).stroke(OpenDesignDayColor.borderSoft, lineWidth: 1))
                            )
                        Text(draft.antiIcpBody)
                            .font(.system(size: 12, weight: .regular))
                            .foregroundStyle(OpenDesignDayColor.muted)
                            .lineSpacing(2)
                    }
                    .padding(.top, 8)
                } label: {
                    Text("문서/근거 보기")
                        .font(.system(size: 11.5, weight: .medium, design: .monospaced))
                        .foregroundStyle(OpenDesignDayColor.fgSecondary)
                }
                .accentColor(OpenDesignDayColor.accent)
                .accessibilityIdentifier("opendesign.day.final.details")

                documentHandoff

                Button(action: confirmAndAdvance) {
                    Text(confirmButtonTitle)
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(confirmButtonDisabled ? OpenDesignDayColor.mutedDeep : OpenDesignDayColor.bgDeep)
                        .frame(maxWidth: .infinity)
                        .frame(height: 48)
                        .openDesignHoverRow(
                            isHovered: isConfirmHovered,
                            isDisabled: confirmButtonDisabled,
                            cornerRadius: 9,
                            fill: confirmButtonDisabled ? OpenDesignDayColor.surface2 : OpenDesignDayColor.accent,
                            hoverFill: confirmButtonDisabled ? OpenDesignDayColor.surface2 : OpenDesignDayColor.accentStrong,
                            border: confirmButtonDisabled ? OpenDesignDayColor.borderSoft : Color.clear,
                            hoverBorder: confirmButtonDisabled ? OpenDesignDayColor.borderSoft : Color.clear
                        )
                }
                .buttonStyle(OpenDesignInteractiveButtonStyle(isDisabled: confirmButtonDisabled))
                .modifier(OpenDesignReturnShortcutModifier(isEnabled: !confirmButtonDisabled))
                .onHover { isConfirmHovered = $0 }
                .accessibilityIdentifier("opendesign.day.final.confirm")
                .accessibilityValue(confirmButtonDisabled ? "locked" : isConfirmHovered ? "active" : "inactive")
                .id("final-icp-action")
            }
            .padding(18)
            .background(gradientCardBackground(cornerRadius: 14, colors: [OpenDesignDayColor.surface2, OpenDesignDayColor.surface], stroke: OpenDesignDayColor.accentLine))

            if interaction.dayCompleted {
                completion
                    .id("completion")
            }
        }
        .padding(.top, 6)
        .overlay(alignment: .topLeading) {
            openDesignAccessibilityAnchor("opendesign.day.final", label: "OpenDesign Day Final Hypothesis")
        }
        .onChange(of: writtenDocumentCount) {
            recordBulkBackendWrittenDocTypes()
            advanceBulkSaveAnimationIfReady()
        }
        .onReceive(Timer.publish(every: 0.2, on: .main, in: .common).autoconnect()) { _ in
            guard isBulkSaveVisualActive else { return }
            recordBulkBackendWrittenDocTypes()
            advanceBulkSaveAnimationIfReady()
        }
        .onChange(of: day1HandoffError ?? "") { _, error in
            if !error.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                cancelBulkSaveAnimation()
            }
        }
        .onDisappear {
            cancelBulkSaveAnimation()
        }
    }

    private func hypothesisRow(_ row: OpenDesignHypothesisSummaryRow) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            Text(row.label)
                .font(.system(size: 10.5, weight: .semibold, design: .monospaced))
                .foregroundStyle(OpenDesignDayColor.muted)
                .frame(width: 68, alignment: .leading)
            Text(openDesignHighlightedAttributedText(
                row.value,
                phrases: row.highlightPhrases,
                bodySize: 13.5,
                bodyWeight: row.id == "icp" ? .semibold : .regular,
                bodyColor: OpenDesignDayColor.fgSecondary,
                highlightWeight: .semibold,
                highlightColor: OpenDesignDayColor.amber,
                highlightBackground: OpenDesignDayColor.amberDim
            ))
                .lineSpacing(2)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
                .layoutPriority(1)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 9)
        .background(
            RoundedRectangle(cornerRadius: 9, style: .continuous)
                .fill(OpenDesignDayColor.bgDeep)
                .overlay(RoundedRectangle(cornerRadius: 9, style: .continuous).stroke(OpenDesignDayColor.borderSoft, lineWidth: 1))
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(row.label) \(row.value)")
        .accessibilityIdentifier("opendesign.day.final.row.\(row.id)")
    }

    private var documentHandoff: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("문서 작성")
                    .font(.system(size: 10, weight: .semibold, design: .monospaced))
                    .foregroundStyle(OpenDesignDayColor.mutedDeep)
                    .textCase(.uppercase)
                Spacer(minLength: 0)
                Text("\(displayedWrittenDocumentCount)/\(documentSteps.count)")
                    .font(.system(size: 10.5, weight: .semibold, design: .monospaced))
                    .foregroundStyle(areDay1DocumentsWritten ? OpenDesignDayColor.accent : OpenDesignDayColor.muted)
            }

            VStack(spacing: 7) {
                ForEach(documentSteps) { step in
                    VStack(alignment: .leading, spacing: 8) {
                        documentStepRow(step)
                        if activeDay1HandoffDocType == step.type, let day1HandoffPromptCard {
                            VStack(alignment: .leading, spacing: 0) {
                                day1HandoffPromptCard
                            }
                            .padding(.leading, 32)
                            .transition(.opacity.combined(with: .move(edge: .top)))
                            .accessibilityElement(children: .contain)
                            .accessibilityIdentifier("opendesign.day.final.doc.\(step.type).prompt")
                        }
                    }
                }
            }

            if let day1HandoffError, !day1HandoffError.isEmpty {
                Text(day1HandoffError)
                    .font(.system(size: 10.5, weight: .semibold, design: .monospaced))
                    .foregroundStyle(OpenDesignDayColor.amber)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 8)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(
                        RoundedRectangle(cornerRadius: 8, style: .continuous)
                            .fill(OpenDesignDayColor.surface2)
                            .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).stroke(OpenDesignDayColor.borderSoft, lineWidth: 1))
                    )
                    .accessibilityIdentifier("opendesign.day.final.doc.error")
            }
        }
        .padding(12)
        .background(
            RoundedRectangle(cornerRadius: 9, style: .continuous)
                .fill(OpenDesignDayColor.bgDeep)
                .overlay(RoundedRectangle(cornerRadius: 9, style: .continuous).stroke(OpenDesignDayColor.borderSoft, lineWidth: 1))
        )
        .overlay(alignment: .topLeading) {
            openDesignAccessibilityAnchor("opendesign.day.final.docs", label: "OpenDesign Day Final Documents")
        }
    }

    private func documentStepRow(_ step: OpenDesignDayDocumentStep) -> some View {
        let isPromptActive = activeDay1HandoffDocType == step.type
        let isPreparing = (pendingDay1HandoffDocType == step.type || isBulkWritingDocuments) && !isPromptActive && !documentStepVisuallyWritten(step)
        let accessibilityLabel = "\(step.title) \(documentStepDetail(step, isPreparing: isPreparing, isPromptActive: isPromptActive))"
        return HStack(spacing: 10) {
            documentStepStatusIcon(step)

            VStack(alignment: .leading, spacing: 2) {
                Text(step.title)
                    .font(.system(size: 12.5, weight: .semibold, design: .monospaced))
                    .foregroundStyle(documentStepVisuallyWritten(step) ? OpenDesignDayColor.accent : OpenDesignDayColor.fg)
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel(accessibilityLabel)
                    .accessibilityValue(documentStepAccessibilityValue(step))
                    .accessibilityIdentifier("opendesign.day.final.doc.\(step.type)")
                Text(documentStepDetail(step, isPreparing: isPreparing, isPromptActive: isPromptActive))
                    .font(.system(size: 10.5, weight: .medium, design: .monospaced))
                    .foregroundStyle(documentStepVisuallyWritten(step) ? OpenDesignDayColor.accent : OpenDesignDayColor.mutedDeep)
                    .lineLimit(1)
            }

            Spacer(minLength: 8)
        }
        .padding(.vertical, 1)
    }

    @ViewBuilder
    private func documentStepStatusIcon(_ step: OpenDesignDayDocumentStep) -> some View {
        if documentStepIsSaving(step) {
            ProgressView()
                .progressViewStyle(.circular)
                .controlSize(.mini)
                .tint(OpenDesignDayColor.accent)
                .frame(width: 22, height: 22)
                .background(Circle().fill(OpenDesignDayColor.surface2))
                .overlay(Circle().stroke(OpenDesignDayColor.accentLine, lineWidth: 1))
                .accessibilityHidden(true)
        } else {
            Text(documentStepVisuallyWritten(step) ? "✅" : "•")
                .font(.system(size: documentStepVisuallyWritten(step) ? 12 : 10.5, weight: .bold, design: .monospaced))
                .foregroundStyle(documentStepVisuallyWritten(step) ? OpenDesignDayColor.accent : OpenDesignDayColor.mutedDeep)
                .frame(width: 22, height: 22)
                .background(Circle().fill(OpenDesignDayColor.surface2))
                .overlay(Circle().stroke(documentStepVisuallyWritten(step) ? OpenDesignDayColor.accentLine : OpenDesignDayColor.borderSoft, lineWidth: 1))
                .accessibilityHidden(true)
        }
    }

    private func documentStepDetail(
        _ step: OpenDesignDayDocumentStep,
        isPreparing: Bool,
        isPromptActive: Bool
    ) -> String {
        if isPromptActive { return "\(step.path) 질문 카드 준비됨" }
        if documentStepVisuallyWritten(step) { return "\(step.path) 저장됨" }
        if documentStepIsSaving(step) { return "\(step.path) 저장 중" }
        if isBulkWritingDocuments { return "\(step.path) 저장 대기" }
        if isPreparing { return "\(step.path) 질문 준비 중" }
        return "\(step.path) 저장 대기"
    }

    private func documentStepIsSaving(_ step: OpenDesignDayDocumentStep) -> Bool {
        isBulkSaveVisualActive && bulkSavingDocType == step.type
    }

    private func documentStepVisuallyWritten(_ step: OpenDesignDayDocumentStep) -> Bool {
        if isBulkSaveVisualActive && bulkSavePendingDocTypes.contains(step.type) {
            return bulkVisualCompletedDocTypes.contains(step.type)
        }
        return step.isWritten
    }

    private func documentStepAccessibilityValue(_ step: OpenDesignDayDocumentStep) -> String {
        if documentStepVisuallyWritten(step) { return "written" }
        if documentStepIsSaving(step) { return "saving" }
        return "waiting"
    }

    private func isBackendDocumentWritten(_ type: String) -> Bool {
        documentSteps.first(where: { $0.type == type })?.isWritten == true
    }

    private var handoffPayload: [String: Any] {
        let value: (String) -> String = { id in
            rows.first(where: { $0.id == id })?.value ?? ""
        }
        var payload: [String: Any] = [
            "goal": value("goal"),
            "icp": value("icp"),
            "pain": value("pain"),
            "outcome": value("outcome"),
            "markdown": draft.markdown,
        ]
        if let score = content.alignmentPlan?.qualityGate.score {
            payload["qualityScore"] = String(format: "%.1f/10", score)
        }
        return payload
    }

    private func selectedOptionTitle(stepID: Int) -> String? {
        content.interviewSteps.first(where: { $0.id == stepID })?.selectedAnswerTitle(in: interaction)
    }

    private func selectedOptionHighlightPhrases(stepID: Int) -> [String]? {
        guard let step = content.interviewSteps.first(where: { $0.id == stepID }),
              let selectedID = interaction.selectedChoices[stepID],
              selectedID != OpenDesignDayInteractionState.freeformChoiceID,
              let option = step.options.first(where: { $0.id == selectedID }) else {
            return nil
        }
        return openDesignOptionTitleHighlightPhrases(option.highlightPhrases, for: option.title)
    }

    private var confirmButtonTitle: String {
        if isBulkSaveVisualActive {
            return "문서 저장 중"
        }
        if !areDay1DocumentsWritten {
            if isBulkWritingDocuments { return "문서 저장 중" }
            if activeDay1HandoffDocType != nil { return "문서 답변 대기 중" }
            if pendingDay1HandoffDocType != nil { return "문서 준비 중" }
            return "4개 문서 저장"
        }
        if interaction.dayCompleted {
            return "Day 2로 이동 ↵"
        }
        if let alignmentPlan = content.alignmentPlan {
            if alignmentPlan.signals.evidenceRefs.isEmpty {
                return "근거 연결하기"
            }
            if !alignmentPlan.qualityGate.passed {
                return "부족한 항목 다시 고르기"
            }
            return "Day 2 시장 신호로 넘기기 ↵"
        }
        return "가설 확정 → Day2로 이동 ↵"
    }

    private var confirmButtonDisabled: Bool {
        isBulkSaveVisualActive || (!areDay1DocumentsWritten && isDocumentHandoffBusy)
    }

    private func alignmentDisplayValue(key: String, label: String, fallback: String) -> String {
        guard let alignmentPlan = content.alignmentPlan else {
            return fallback
        }
        if let row = alignmentPlan.signalDigest?.rows.first(where: { $0.key == key }) {
            return openDesignDisplaySignalDigestValue(for: row, alignmentPlan: alignmentPlan)
        }
        let trimmed = fallback.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty,
              !openDesignLooksLikeMarkdownDocumentReference(trimmed),
              !openDesignLooksLikeSourcePathOnly(trimmed),
              !openDesignLooksLikeUnitlessNumber(trimmed)
        else {
            return openDesignAlignmentPlaceholder(key: key)
        }
        return trimmed
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
                Text("Day 2에서 이 가설의 시장 신호와 키워드를 확인합니다.")
                    .font(.system(size: 12.5, weight: .regular))
                    .foregroundStyle(OpenDesignDayColor.fgSecondary)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 18)
        .background(gradientCardBackground(cornerRadius: 14, colors: [OpenDesignDayColor.surface2, OpenDesignDayColor.surface], stroke: OpenDesignDayColor.accentLine))
    }

    private func confirmAndAdvance() {
        guard !confirmButtonDisabled else {
            return
        }
        guard areDay1DocumentsWritten else {
            beginBulkSaveAnimation()
            startDay1DocHandoff("all", handoffPayload)
            return
        }
        if let alignmentPlan = content.alignmentPlan,
           !interaction.dayCompleted,
           (alignmentPlan.signals.evidenceRefs.isEmpty || !alignmentPlan.qualityGate.passed) {
            showsDetails = true
            return
        }
        if !interaction.dayCompleted {
            completeDayAction()
        }
        advanceToNextDay()
    }

    private func beginBulkSaveAnimation() {
        guard !isBulkSaveVisualActive else { return }
        let pendingTypes = day1HandoffDocumentOrder.filter { !isBackendDocumentWritten($0) }
        guard !pendingTypes.isEmpty else { return }

        bulkSaveAnimationTask?.cancel()
        bulkSavePendingDocTypes = pendingTypes
        bulkBackendWrittenDocTypes = Set(day1HandoffDocumentOrder.filter { isBackendDocumentWritten($0) })
        bulkDelayCompletedDocTypes = []
        bulkVisualCompletedDocTypes = []
        isBulkSaveVisualActive = true
        beginBulkDelay(for: pendingTypes[0])
    }

    private func beginBulkDelay(for docType: String) {
        bulkSaveAnimationTask?.cancel()
        bulkSavingDocType = docType
        bulkSaveAnimationTask = Task { @MainActor in
            let seconds = Double.random(in: 1.0...2.0)
            let nanoseconds = UInt64(seconds * 1_000_000_000)
            do {
                try await Task.sleep(nanoseconds: nanoseconds)
            } catch {
                return
            }
            guard !Task.isCancelled else { return }
            bulkDelayCompletedDocTypes.insert(docType)
            advanceBulkSaveAnimationIfReady()
        }
    }

    private func advanceBulkSaveAnimationIfReady() {
        guard isBulkSaveVisualActive,
              let currentType = bulkSavingDocType,
              bulkDelayCompletedDocTypes.contains(currentType),
              bulkBackendWrittenDocTypes.contains(currentType)
        else {
            return
        }

        var completedDocTypes = bulkVisualCompletedDocTypes
        completedDocTypes.insert(currentType)
        bulkVisualCompletedDocTypes = completedDocTypes
        if let nextType = bulkSavePendingDocTypes.first(where: { !completedDocTypes.contains($0) }) {
            beginBulkDelay(for: nextType)
            return
        }
        bulkSavingDocType = nil
        isBulkSaveVisualActive = false
        bulkSavePendingDocTypes = []
        bulkBackendWrittenDocTypes = []
        bulkDelayCompletedDocTypes = []
        bulkVisualCompletedDocTypes = []
        bulkSaveAnimationTask = nil
    }

    private func recordBulkBackendWrittenDocTypes() {
        let writtenTypes = day1HandoffDocumentOrder.filter { isBackendDocumentWritten($0) }
        bulkBackendWrittenDocTypes.formUnion(writtenTypes)
    }

    private func cancelBulkSaveAnimation() {
        bulkSaveAnimationTask?.cancel()
        bulkSaveAnimationTask = nil
        bulkSavingDocType = nil
        isBulkSaveVisualActive = false
        bulkSavePendingDocTypes = []
        bulkBackendWrittenDocTypes = []
        bulkDelayCompletedDocTypes = []
        bulkVisualCompletedDocTypes = []
    }
}

private func openDesignAlignmentPlaceholder(key: String) -> String {
    switch key {
    case "goal": return "목표 확인 필요"
    case "icp": return "첫 고객 후보 확인 필요"
    case "pain": return "핵심 문제 확인 필요"
    case "outcome": return "확인할 행동 필요"
    default: return "확인 필요"
    }
}

private func openDesignLooksLikeSourcePathOnly(_ value: String) -> Bool {
    let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else { return false }
    return trimmed.range(
        of: #"^(?:\./)?[A-Za-z0-9_.@/-]+\.(?:swift|ts|tsx|js|mjs|jsx|py|rs|go|kt|kts|md|json|toml)(?::\d+)?$"#,
        options: [.regularExpression, .caseInsensitive]
    ) != nil
}

private func openDesignLooksLikeUnitlessNumber(_ value: String) -> Bool {
    let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else { return false }
    return trimmed.range(of: #"^[\d\s,./:;+-]+$"#, options: .regularExpression) != nil
}

private struct OpenDesignMetaPanelView: View {
    let content: OpenDesignDayContent
    @Binding var interaction: OpenDesignDayInteractionState

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                Text("내 선택")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(OpenDesignDayColor.fg)

                OpenDesignChoiceSummaryPanel(content: content, interaction: interaction)

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
                        Text("\(interaction.workflowStepCount) STEP")
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
                    Text("\(interaction.missionAccepted ? "●" : "○") 시작    \(interaction.missionAccepted ? "●" : "○") 질문    \(interaction.allInterviewsSubmitted ? "●" : "○") 확정")
                        .font(.system(size: 10.5, weight: .medium, design: .monospaced))
                        .foregroundStyle(OpenDesignDayColor.muted)
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 12)
                .background(cardBackground(cornerRadius: 10, fill: OpenDesignDayColor.surface))

                metaTitle("완료 조건")
                OpenDesignCompletionChecklist(content: content, interaction: interaction)

                metaTitle("단계별 선택")
                VStack(spacing: 0) {
                    ForEach(content.interviewSteps) { step in
                        choiceRow(step: step)
                    }
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

    private func followupRow(step: OpenDesignDayContent.InterviewStep) -> some View {
        let done = interaction.submittedSteps.contains(step.id)
        let active = step.id == interaction.activeInterviewStepID && !done
        let subtitle = done ? "완료 · 저장됨" : active ? "지금 진행 중 · 선택지에서 하나 선택" : "잠금 · \(step.options.prefix(3).map(\.title).joined(separator: " / "))"
        return followupStatic(
            done ? "checkmark.circle" : active ? "record.circle" : "lock",
            step.title,
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

    private func choiceRow(step: OpenDesignDayContent.InterviewStep) -> some View {
        let submitted = interaction.submittedSteps.contains(step.id)
        let selectedTitle = step.selectedAnswerTitle(in: interaction)
        let active = step.id == interaction.activeInterviewStepID && !submitted
        return followupStatic(
            submitted ? "checkmark.circle" : active ? "record.circle" : "circle",
            step.progressLabel,
            selectedTitle ?? (active ? "선택 대기" : "아직 비어 있음"),
            tint: submitted ? OpenDesignDayColor.accent : active ? OpenDesignDayColor.amber : OpenDesignDayColor.muted,
            usesAccentSubtitle: submitted || active
        )
    }
}

private struct OpenDesignChoiceSummaryPanel: View {
    let content: OpenDesignDayContent
    let interaction: OpenDesignDayInteractionState

    private var draft: OpenDesignDayDraft {
        content.draft(for: interaction)
    }

    private var filledCount: Int {
        content.interviewSteps.filter { interaction.selectedChoices[$0.id] != nil }.count
    }

    private var conclusion: String {
        if interaction.allInterviewsSubmitted {
            return draft.finalIcpStatement
        }
        if filledCount == 0 {
            return "아직 비어 있습니다. 현재 STEP에서 하나를 고르면 여기부터 쌓입니다."
        }
        return "현재 \(filledCount)/\(content.interviewSteps.count)개 선택됨 · 남은 질문을 고르면 Day 2 검증 기준으로 압축됩니다."
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 9) {
            Text("현재 결론")
                .font(.system(size: 10, weight: .medium, design: .monospaced))
                .textCase(.uppercase)
                .foregroundStyle(OpenDesignDayColor.accent)
            Text(conclusion)
                .font(.system(size: 12.5, weight: .medium))
                .foregroundStyle(interaction.allInterviewsSubmitted ? OpenDesignDayColor.fg : OpenDesignDayColor.fgSecondary)
                .lineSpacing(3)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("opendesign.day.meta.currentConclusion")
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .background(
            gradientCardBackground(
                cornerRadius: 10,
                colors: [OpenDesignDayColor.surface2, OpenDesignDayColor.surface],
                stroke: interaction.allInterviewsSubmitted ? OpenDesignDayColor.accentLine : OpenDesignDayColor.borderSoft
            )
        )
    }
}

private struct OpenDesignCompletionChecklist: View {
    let content: OpenDesignDayContent
    let interaction: OpenDesignDayInteractionState

    var body: some View {
        VStack(spacing: 0) {
            checklistRow(
                title: "시작",
                detail: "Day 1 핵심 가설 작업 시작",
                isDone: interaction.missionAccepted,
                isActive: !interaction.missionAccepted
            )
            ForEach(content.interviewSteps) { step in
                checklistRow(
                    title: step.progressLabel,
                    detail: selectedTitle(for: step) ?? "필수 선택",
                    isDone: interaction.submittedSteps.contains(step.id),
                    isActive: interaction.activeInterviewStepID == step.id
                )
            }
            checklistRow(
                title: "확정",
                detail: "Day 2 시장 신호 검증으로 넘김",
                isDone: interaction.dayCompleted,
                isActive: interaction.allInterviewsSubmitted && !interaction.dayCompleted
            )
        }
        .background(cardBackground(cornerRadius: 10, fill: OpenDesignDayColor.surface))
    }

    private func selectedTitle(for step: OpenDesignDayContent.InterviewStep) -> String? {
        step.selectedAnswerTitle(in: interaction)
    }

    private func checklistRow(
        title: String,
        detail: String,
        isDone: Bool,
        isActive: Bool
    ) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: isDone ? "checkmark.circle.fill" : isActive ? "record.circle" : "circle")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(isDone ? OpenDesignDayColor.accent : isActive ? OpenDesignDayColor.amber : OpenDesignDayColor.mutedDeep)
                .frame(width: 18)
                .padding(.top, 1)
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(OpenDesignDayColor.fg)
                    .lineLimit(1)
                Text(detail)
                    .font(.system(size: 10.5, weight: .medium, design: .monospaced))
                    .foregroundStyle(isDone || isActive ? OpenDesignDayColor.accent : OpenDesignDayColor.muted)
                    .lineLimit(2)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 9)
        .overlay(Rectangle().fill(OpenDesignDayColor.borderSoft).frame(height: 1), alignment: .bottom)
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
                .foregroundColor: Self.placeholderColor(),
                .font: Self.font,
            ]
        )
        field.font = Self.font
        field.textColor = Self.foregroundColor()
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
        nsView.textColor = Self.foregroundColor()
        nsView.placeholderAttributedString = NSAttributedString(
            string: placeholder,
            attributes: [
                .foregroundColor: Self.placeholderColor(),
                .font: Self.font,
            ]
        )
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

    private static func foregroundColor() -> NSColor {
        switch Agentic30Theme.current {
        case .white:
            NSColor(red: 0.0769, green: 0.1081, blue: 0.1353, alpha: 1)
        case .dark:
            NSColor(red: 0.9410, green: 0.9490, blue: 0.9550, alpha: 1)
        }
    }

    private static func placeholderColor() -> NSColor {
        switch Agentic30Theme.current {
        case .white:
            NSColor(red: 0.4009, green: 0.4261, blue: 0.4487, alpha: 1)
        case .dark:
            NSColor(red: 0.4865, green: 0.5055, blue: 0.5198, alpha: 1)
        }
    }
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
    var showsReturnHint = true
    let action: () -> Void

    @State private var isHovered = false

    var body: some View {
        Button(action: action) {
            Text(displayLabel)
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
        .accessibilityLabel(displayLabel)
        .accessibilityValue(isDisabled ? "locked" : isHovered ? "active" : "inactive")
        .accessibilityIdentifier(accessibilityIdentifier ?? "opendesign.day.handoff.next")
    }

    private var displayLabel: String {
        if isDisabled || !showsReturnHint {
            return label
        }
        return "\(label) ↵"
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
    var isDisabled = false
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
                .foregroundStyle(isDisabled ? OpenDesignDayColor.mutedDeep : isHovered ? OpenDesignDayColor.fg : OpenDesignDayColor.fgSecondary)
                .padding(.horizontal, isIconOnly ? 0 : 10)
                .frame(minWidth: 28, minHeight: 28)
                .openDesignHoverRow(
                    isHovered: isHovered,
                    isDisabled: isDisabled,
                    cornerRadius: 8,
                    fill: isDisabled ? OpenDesignDayColor.surface2 : Color.clear,
                    hoverFill: OpenDesignDayColor.hover,
                    border: OpenDesignDayColor.borderSoft,
                    hoverBorder: OpenDesignDayColor.border
                )
        }
        .buttonStyle(OpenDesignInteractiveButtonStyle(isDisabled: isDisabled))
        .disabled(isDisabled)
        .onHover { isHovered = $0 }
        .accessibilityLabel(label)
        .accessibilityValue(isDisabled ? "locked" : isHovered ? "active" : "inactive")
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
    let accent: Color?
    let edgeWidth: CGFloat
    let glowRadius: CGFloat
    let glowOpacity: Double

    var body: some View {
        let usesIncreasedContrast = contrast == .increased
        let lineWidth = OpenDesignAccessibilityMetrics.borderLineWidth(isIncreasedContrast: usesIncreasedContrast)
        let shape = RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)

        shape
            .fill(LinearGradient(colors: colors, startPoint: .top, endPoint: .bottom))
            .overlay(shape.stroke(stroke, lineWidth: lineWidth))
            .overlay(alignment: .leading) {
                if let accent {
                    Rectangle()
                        .fill(accent)
                        .shadow(color: accent.opacity(glowOpacity), radius: glowRadius)
                        .frame(width: edgeWidth)
                }
            }
            .clipShape(shape)
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

private func gradientCardBackground(
    cornerRadius: CGFloat,
    colors: [Color],
    stroke: Color,
    accent: Color? = nil,
    edgeWidth: CGFloat = 3,
    glowRadius: CGFloat = 14,
    glowOpacity: Double = 0.68
) -> some View {
    OpenDesignGradientCardBackground(
        cornerRadius: cornerRadius,
        colors: colors,
        stroke: stroke,
        accent: accent,
        edgeWidth: edgeWidth,
        glowRadius: glowRadius,
        glowOpacity: glowOpacity
    )
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
