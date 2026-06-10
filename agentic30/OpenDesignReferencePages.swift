import SwiftUI

enum OpenDesignReferencePageKind: String, CaseIterable, Hashable, Identifiable {
    case projects
    case settings
    case interviews
    case bipLog
    case news
    case history

    var id: String { rawValue }

    init?(railItemID: String) {
        switch railItemID {
        case "projects": self = .projects
        case "settings": self = .settings
        case "interviews": self = .interviews
        case "bip": self = .bipLog
        case "news": self = .news
        case "history": self = .history
        default: return nil
        }
    }

    init?(searchItemID: String) {
        switch searchItemID {
        case "page-projects": self = .projects
        case "page-settings": self = .settings
        case "page-interviews": self = .interviews
        case "page-bip": self = .bipLog
        case "page-news": self = .news
        case "page-history": self = .history
        default: return nil
        }
    }

    var railItemID: String {
        switch self {
        case .projects: return "projects"
        case .settings: return "settings"
        case .interviews: return "interviews"
        case .bipLog: return "bip"
        case .news: return "news"
        case .history: return "history"
        }
    }

    var title: String {
        switch self {
        case .projects: return "프로젝트"
        case .settings: return "설정"
        case .interviews: return "인터뷰"
        case .bipLog: return "공개 기록"
        case .news: return "뉴스"
        case .history: return "히스토리"
        }
    }

    var titlebarDetail: String {
        switch self {
        case .projects: return "포트폴리오 + 소스 루트"
        case .settings: return "워크스페이스"
        case .interviews: return "장지창 · 실제 행동 인터뷰 1"
        case .bipLog: return "웹 자료 검색 · X/Twitter · Threads(Meta)"
        case .news: return "안 읽음 17건"
        case .history: return "회고 인사이트"
        }
    }
}

struct OpenDesignReferencePageModel {
    let kind: OpenDesignReferencePageKind
    let sideTitle: String
    let sideBadge: String?
    let sideSearchPlaceholder: String?
    let sideGroups: [OpenDesignReferenceSideGroup]
    let header: OpenDesignReferenceHeaderModel
    let filters: [OpenDesignReferenceChip]
    let sections: [OpenDesignReferenceSectionModel]
    let meta: OpenDesignReferenceMetaModel

    var titlebarTitle: String { kind.title }
    var titlebarDetail: String { kind.titlebarDetail }
}

struct OpenDesignReferenceSideGroup {
    let title: String
    let count: String?
    let rows: [OpenDesignReferenceSideRow]
}

struct OpenDesignReferenceSideRow: Identifiable {
    let id: String
    let title: String
    let subtitle: String?
    let badge: String?
    let leading: String
    let tone: OpenDesignReferenceTone
    let isActive: Bool
}

struct OpenDesignReferenceHeaderModel {
    let badge: String
    let systemImage: String?
    let title: String
    let subtitleParts: [String]
    let actions: [OpenDesignReferenceAction]
}

struct OpenDesignReferenceAction: Identifiable {
    enum Tone: Equatable { case ghost, accent }

    let id: String
    let title: String
    let systemImage: String?
    let tone: Tone
}

struct OpenDesignReferenceSectionModel: Identifiable {
    let id: String
    let title: String
    let meta: String?
    let markerTone: OpenDesignReferenceTone
    let blocks: [OpenDesignReferenceBlock]
}

struct OpenDesignReferenceBlock: Identifiable {
    enum Style {
        case banner
        case calendar
        case metrics
        case rows
        case cards
        case timeline
        case articles
        case quotes
        case diff
        case settings
        case draft
        case heatmap
    }

    let id: String
    let style: Style
    let title: String?
    let subtitle: String?
    let body: String?
    let rows: [OpenDesignReferenceRow]
    let chips: [OpenDesignReferenceChip]

    init(
        _ id: String,
        style: Style,
        title: String? = nil,
        subtitle: String? = nil,
        body: String? = nil,
        rows: [OpenDesignReferenceRow] = [],
        chips: [OpenDesignReferenceChip] = []
    ) {
        self.id = id
        self.style = style
        self.title = title
        self.subtitle = subtitle
        self.body = body
        self.rows = rows
        self.chips = chips
    }
}

struct OpenDesignReferenceRow: Identifiable {
    let id: String
    let leading: String?
    let title: String
    let subtitle: String?
    let body: String?
    let trailing: String?
    let tone: OpenDesignReferenceTone
    let chips: [OpenDesignReferenceChip]

    init(
        _ id: String,
        leading: String? = nil,
        title: String,
        subtitle: String? = nil,
        body: String? = nil,
        trailing: String? = nil,
        tone: OpenDesignReferenceTone = .accent,
        chips: [OpenDesignReferenceChip] = []
    ) {
        self.id = id
        self.leading = leading
        self.title = title
        self.subtitle = subtitle
        self.body = body
        self.trailing = trailing
        self.tone = tone
        self.chips = chips
    }
}

struct OpenDesignReferenceChip: Identifiable {
    let id: String
    let title: String
    let tone: OpenDesignReferenceTone

    init(_ title: String, tone: OpenDesignReferenceTone = .accent, id: String? = nil) {
        self.id = id ?? title
        self.title = title
        self.tone = tone
    }
}

struct OpenDesignReferenceMetaModel {
    let title: String
    let cards: [OpenDesignReferenceBlock]
}

enum OpenDesignReferenceTone: String {
    case accent
    case amber
    case rose
    case sky
    case violet
    case teal
    case pink
    case muted

    var color: Color {
        switch self {
        case .accent: return OpenDesignDayColor.accent
        case .amber: return OpenDesignDayColor.amber
        case .rose: return OpenDesignDayColor.rose
        case .sky: return OpenDesignDayColor.sky
        case .violet: return Color(red: 0.690, green: 0.520, blue: 0.980)
        case .teal: return Color(red: 0.230, green: 0.780, blue: 0.760)
        case .pink: return Color(red: 0.960, green: 0.500, blue: 0.760)
        case .muted: return OpenDesignDayColor.muted
        }
    }

    var dim: Color { color.opacity(0.14) }
    var line: Color { color.opacity(0.38) }
}

enum OpenDesignReferenceCatalog {
    static func page(_ kind: OpenDesignReferencePageKind) -> OpenDesignReferencePageModel {
        switch kind {
        case .projects: return projects
        case .settings: return settings
        case .interviews: return interviews
        case .bipLog: return bipLog
        case .news: return news
        case .history: return history
        }
    }

    private static let projectSidebar = [
        OpenDesignReferenceSideGroup(title: "활성", count: "3", rows: [
            .init(id: "a3", title: "Agentic30 (직접 사용 중)", subtitle: "초기 검증 · macOS · 소스 3", badge: "D1/30", leading: "A3", tone: .accent, isActive: true),
            .init(id: "loop", title: "LoopJournal", subtitle: "초기 검증 · Web + macOS · 소스 2", badge: "D4/30", leading: "LJ", tone: .amber, isActive: false),
            .init(id: "devtrace", title: "DevTrace", subtitle: "만들기 · Desktop app · 소스 4", badge: "D9/30", leading: "DT", tone: .sky, isActive: false),
        ]),
        OpenDesignReferenceSideGroup(title: "보관함", count: "2", rows: [
            .init(id: "qmd", title: "qmd-support · iOS 학습", subtitle: "완주 · 2026-03 · 28/30", badge: "완주", leading: "QMD", tone: .violet, isActive: false),
            .init(id: "meal", title: "MealMate · 식단 코치", subtitle: "중단 · 2026-01 · Day 9", badge: "중단", leading: "MM", tone: .sky, isActive: false),
        ]),
        OpenDesignReferenceSideGroup(title: "후보 · 아직 시작 안 함", count: "2", rows: [
            .init(id: "clipper", title: "ClipperOps (가제)", subtitle: "Problem memo · 인터뷰 0", badge: "D0", leading: "C?", tone: .amber, isActive: false),
            .init(id: "deck", title: "DeckTrace (가제)", subtitle: "아이디어만 있음", badge: "D0", leading: "D?", tone: .amber, isActive: false),
        ]),
        OpenDesignReferenceSideGroup(title: "템플릿", count: "3", rows: [
            .init(id: "tpl-ios", title: "iOS 구독앱 30일", subtitle: "ASO · 페이월 · paid learning", badge: "템플릿", leading: "iOS", tone: .sky, isActive: false),
            .init(id: "tpl-android", title: "Android 광고앱 30일", subtitle: "CPI · AdMob · Play Console", badge: "템플릿", leading: "AD", tone: .violet, isActive: false),
            .init(id: "tpl-web", title: "구독형 웹 도구 30일", subtitle: "소개 페이지 · 대기 신청자 · 결제", badge: "템플릿", leading: "Web", tone: .muted, isActive: false),
        ]),
    ]

    static let projects = OpenDesignReferencePageModel(
        kind: .projects,
        sideTitle: "프로젝트",
        sideBadge: "활성 3",
        sideSearchPlaceholder: "프로젝트 검색",
        sideGroups: projectSidebar,
        header: .init(
            badge: "A3",
            systemImage: nil,
            title: "Agentic30 (직접 사용 중)",
            subtitleParts: ["초기 검증", "Day 1 / 30", "macOS 메뉴바 앱", "소스 코드 3개", "마지막 활동 4분 전"],
            actions: [
                .init(id: "switch", title: "프로젝트 전환", systemImage: "sidebar.left", tone: .ghost),
                .init(id: "today", title: "오늘 화면 열기", systemImage: "chevron.right", tone: .accent),
            ]
        ),
        filters: [],
        sections: [
            .init(id: "overview", title: "개요", meta: "Day 1 of 30 · 초기 검증 진행 중", markerTone: .accent, blocks: [
                .init("overview-banner", style: .banner, title: "오늘은 Day 1 · 고객 후보를 좁히는 날이에요.", subtitle: "다음 기준은 Day 3 인터뷰 5건까지 6일.", body: "초기 검증 단계는 아직 3%입니다. 지금 중요한 건 완성된 제품보다 이번 주 실제로 인터뷰할 수 있는 한 명을 고정하는 것입니다.", chips: [.init("완료 0", tone: .accent), .init("진행 중 1", tone: .amber), .init("인터뷰 0 / 5", tone: .sky), .init("공개 기록 0 / 14", tone: .muted)]),
                .init("calendar", style: .calendar, title: "30일 캘린더", subtitle: "초기 검증 · 만들기 · 공개 · 성장"),
                .init("stats", style: .metrics, rows: [
                    .init("days", title: "0 / 30", subtitle: "완료한 Day", trailing: "Day 1 진행 중", tone: .amber),
                    .init("interviews", title: "1 / 5", subtitle: "인터뷰 원문", trailing: "+1 어제", tone: .accent),
                    .init("bip", title: "0 / 14", subtitle: "공개 기록 글", trailing: "미시작", tone: .muted),
                    .init("roots", title: "3", subtitle: "소스 코드 루트", trailing: "watch 활성", tone: .sky),
                ]),
            ]),
            .init(id: "gates", title: "단계 기준", meta: "진행 통과 조건 · Q2 진입점은 초기 검증", markerTone: .accent, blocks: [
                .init("phase-gates", style: .rows, rows: [
                    .init("f", leading: "F", title: "초기 검증 기준", subtitle: "D7 · 인터뷰 5건 · 통증 가설 1 · 고객 후보 1줄 정의", trailing: "진행 중", tone: .accent),
                    .init("b", leading: "B", title: "만들기 기준", subtitle: "D17 · 핵심 기능 1개 · 30초 첫 가치 경험", trailing: "대기", tone: .sky),
                    .init("l", leading: "L", title: "공개 기준", subtitle: "D24 · 60초 시연 · 강한 의도 신호 1", trailing: "대기", tone: .amber),
                    .init("g", leading: "G", title: "성장 기준", subtitle: "D30 · 계속 / 전환 / 중단 판정", trailing: "대기", tone: .violet),
                ]),
            ]),
            .init(id: "basics", title: "프로젝트 기본 정보", meta: "사용자 입력 · 언제든 수정 가능", markerTone: .accent, blocks: [
                .init("project-basics", style: .settings, rows: [
                    .init("one-line", title: "한 문장 요약", subtitle: "전업 1인 개발자가 자기 프로젝트와 실행 기록을 근거로 30일 안에 시장 적합 방향을 좁히도록 돕는다", trailing: "필수", tone: .accent),
                    .init("icp", title: "고객 후보", subtitle: "전업 1인 개발자 · macOS 사용 · 수익 0원 · 30일 스프린트 실행 의향", trailing: "정의됨", tone: .accent),
                    .init("platform", title: "제품 플랫폼", subtitle: "macOS 메뉴바 앱 · 커리큘럼 대상 제품 플랫폼은 iOS/Android/Web/Mac 자유", trailing: "macOS", tone: .sky),
                    .init("hypothesis", title: "현재 가설", subtitle: "실제 기록을 분석한 맞춤 과제가 일반 강의보다 다음 행동을 더 잘 만든다", trailing: "검증 중", tone: .amber),
                    .init("evidence", title: "증거 채널", subtitle: "고객 인터뷰 · 공개 기록 · 업무 일지 · 직접 사용 기록", trailing: "4채널", tone: .accent),
                ]),
            ]),
            .init(id: "paths", title: "프로젝트 경로", meta: "소스 코드 3개 + 자료 폴더 2개 · 이 프로젝트에서만 watch", markerTone: .accent, blocks: [
                .init("paths-list", style: .rows, rows: [
                    .init("app", leading: "⌘", title: "소스 코드 경로 1 · 제품 앱", subtitle: "~/code/agentic30-desktop · SwiftUI 메뉴바 앱 · 마지막 커밋 4분 전", trailing: "워치 활성", tone: .accent),
                    .init("sidecar", leading: "</>", title: "소스 코드 경로 2 · 실행 보조 앱", subtitle: "~/code/agentic30-sidecar · AI 연결 / 로컬 색인", trailing: "+2 unstaged", tone: .accent),
                    .init("public", leading: "WEB", title: "소스 코드 경로 3 · 공개 웹/문서", subtitle: "~/code/agentic30-public · 소개 페이지 / 문서 / 미리보기 자료", trailing: "클린", tone: .sky),
                    .init("interviews", leading: "IV", title: "인터뷰 원문 폴더", subtitle: "~/Documents/Agentic30/agentic30/interviews · .txt / .md / .vtt / .srt", trailing: "1 / 5", tone: .amber),
                    .init("journal", leading: "MD", title: "업무 일지 / 공개 기록 폴더", subtitle: "~/Documents/Agentic30/agentic30/journal · 오늘 만든 것 / 막힌 것 / 배운 것", trailing: "3 파일", tone: .teal),
                ]),
            ]),
            .init(id: "activity", title: "최근 활동", meta: "이 프로젝트만 · 12개 항목 · 자동 기록", markerTone: .accent, blocks: [
                .init("project-timeline", style: .timeline, rows: [
                    .init("task", leading: "4분 전", title: "Day 1 과제 생성", subtitle: "고객 후보 좁히기 (3개 변형) · Claude Sonnet 4.6 · 312ms", tone: .accent),
                    .init("interview", leading: "어제", title: "인터뷰 1건 추가 — 장지창 (29분)", subtitle: "자동 분석 · 통증 후보 3개 추출", tone: .sky),
                    .init("spec", leading: "7일 전", title: "SPEC.md 갱신 — Q2 진입점을 Day 0-3로 좁힘", subtitle: "+14 / -8 · 한 문장 요약 변경 없음", tone: .violet),
                    .init("journal", leading: "어제", title: "업무 일지 작성 — 오늘 막힌 것 1건", subtitle: "AI 연결 응답 지연, 보조 작업 라우팅", tone: .amber),
                ]),
            ]),
        ],
        meta: .init(title: "프로젝트 포트폴리오", cards: [
            .init("portfolio-health", style: .banner, title: "30일 진행률 · 모든 활성", subtitle: "14 / 90 day · 3 projects", body: "초기 검증 2개, 만들기 1개가 활성입니다. 공개/성장 프로젝트는 아직 없습니다.", chips: [.init("초기 검증 · 2", tone: .accent), .init("만들기 · 1", tone: .sky), .init("인터뷰 5 / 15", tone: .amber)]),
            .init("portfolio-actions", style: .rows, rows: [
                .init("today", title: "오늘 화면으로", subtitle: "Day 1 · 고객 후보 좁히기", trailing: "↵", tone: .accent),
                .init("new", title: "새 30일 프로젝트", subtitle: "템플릿 또는 백지에서 시작", trailing: "⌘N", tone: .sky),
                .init("interview", title: "인터뷰 추가", subtitle: "다음 게이트까지 4건", trailing: "⌘I", tone: .amber),
            ]),
        ])
    )

    static let settings = OpenDesignReferencePageModel(
        kind: .settings,
        sideTitle: "설정",
        sideBadge: nil,
        sideSearchPlaceholder: "설정 검색",
        sideGroups: [
            .init(title: "General", count: nil, rows: [
                .init(id: "workspace", title: "워크스페이스", subtitle: nil, badge: nil, leading: "⌂", tone: .accent, isActive: true),
                .init(id: "appearance", title: "외관", subtitle: nil, badge: nil, leading: "◐", tone: .sky, isActive: false),
                .init(id: "menubar", title: "메뉴바 & 알림", subtitle: nil, badge: nil, leading: "!", tone: .amber, isActive: false),
            ]),
            .init(title: "Agent", count: nil, rows: [
                .init(id: "providers", title: "AI 연결", subtitle: nil, badge: nil, leading: "</>", tone: .accent, isActive: false),
                .init(id: "integrations", title: "연동", subtitle: nil, badge: nil, leading: "∞", tone: .amber, isActive: false),
            ]),
            .init(title: "Trust", count: nil, rows: [
                .init(id: "privacy", title: "개인정보 & 진단", subtitle: nil, badge: nil, leading: "◇", tone: .rose, isActive: false),
                .init(id: "updates", title: "업데이트", subtitle: nil, badge: nil, leading: "↻", tone: .sky, isActive: false),
                .init(id: "advanced", title: "고급 & 실행 보조 앱", subtitle: nil, badge: nil, leading: "$", tone: .muted, isActive: false),
            ]),
        ],
        header: .init(
            badge: "⚙",
            systemImage: "gearshape",
            title: "설정",
            subtitleParts: ["Agentic30 · 로컬 우선", "zettalyst@gmail.com", "변경 사항 자동 저장"],
            actions: [
                .init(id: "reset", title: "기본값으로", systemImage: "trash", tone: .ghost),
                .init(id: "saved", title: "모두 저장됨", systemImage: "checkmark", tone: .accent),
            ]
        ),
        filters: [],
        sections: [
            .init(id: "workspace", title: "워크스페이스", meta: "메인 프로젝트", markerTone: .accent, blocks: [
                .init("workspace-settings", style: .settings, rows: [
                    .init("main", title: "메인 프로젝트", subtitle: "맞춤형 엔진이 가장 먼저 읽는 폴더. SPEC.md / ICP.md / VALUES.md와 업무 일지가 여기에 누적됩니다.", trailing: "~/code/agentic30-public", tone: .accent),
                ]),
            ]),
            .init(id: "appearance", title: "외관", meta: "Dark · Light", markerTone: .sky, blocks: [
                .init("appearance-settings", style: .settings, rows: [
                    .init("theme", title: "테마", subtitle: "Dark 또는 Light 테마를 즉시 적용합니다.", trailing: "Dark", tone: .sky),
                ]),
            ]),
            .init(id: "menubar", title: "메뉴바 & 알림", meta: "로그인 항목", markerTone: .amber, blocks: [
                .init("menubar-settings", style: .settings, rows: [
                    .init("login", title: "로그인 시 자동 실행", subtitle: "macOS 로그인 항목에 추가합니다. Launch Agent — com.octobacademy.agentic30.plist.", trailing: "ON", tone: .accent),
                ]),
            ]),
            .init(id: "providers", title: "AI 연결", meta: "Claude 1순위 · Codex 예비 연결", markerTone: .accent, blocks: [
                .init("providers", style: .cards, rows: [
                    .init("claude", leading: "A", title: "Claude", subtitle: "로컬 인증 또는 API 키 · 모델 선택", body: "에이전트 설정은 Keychain 저장값과 실행 보조 앱의 AI 연결 설정에 동기화됩니다.", trailing: "설정됨", tone: .accent),
                    .init("codex", leading: "C", title: "Codex", subtitle: "로컬 인증 또는 API 키 · 모델 선택", body: "OpenAI/Codex 인증 방식과 모델 ID를 저장합니다.", trailing: "설정됨", tone: .accent),
                    .init("gemini", leading: "G", title: "Gemini", subtitle: "API 키 · 모델 선택", body: "Gemini API 키와 모델 ID를 Keychain에 저장합니다.", trailing: "선택", tone: .sky),
                    .init("node", leading: "20", title: "Node 런타임", subtitle: "/usr/local/bin/node — v20.11.1", body: "실행 보조 앱이 사용하는 Node 바이너리. 20+ 필요. NODE_BINARY → 일반 설치 → mise/asdf/Volta → 로그인 셸 PATH 순으로 탐색합니다.", trailing: "20+", tone: .sky),
                ]),
            ]),
            .init(id: "integrations", title: "연동", meta: "OAuth · API 키 — Keychain 보관", markerTone: .amber, blocks: [
                .init("integrations", style: .rows, rows: [
                    .init("exa", leading: "E", title: "Exa Research", subtitle: "뉴스 시장 리서치 예비 키. AI 프로바이더의 웹 검색 도구가 없을 때만 사용합니다.", trailing: "Keychain", tone: .amber),
                    .init("github", leading: "GH", title: "GitHub", subtitle: "gh CLI 인증으로 PR / 이슈 / 릴리즈 활동을 읽어 History에 반영합니다.", trailing: "gh 로그인", tone: .amber),
                    .init("cloudflare", leading: "CF", title: "Cloudflare", subtitle: "Cloudflare MCP 토큰과 endpoint를 저장해 Workers, R2, DNS 도구를 AI 실행에 연결합니다.", trailing: "MCP", tone: .amber),
                    .init("posthog-mcp", leading: "PH", title: "PostHog", subtitle: "phx_ / pha_ personal API key로 HogQL, insights, web analytics MCP 도구를 연결합니다.", trailing: "MCP", tone: .amber),
                    .init("notion", leading: "N", title: "Notion", subtitle: "SPEC.md / ICP.md / VALUES.md 변경분을 지정한 페이지로 양방향 동기화.", trailing: "연결 안 됨", tone: .muted),
                ]),
            ]),
            .init(id: "privacy", title: "개인정보 & 진단", meta: "로컬 우선 · sanitized snapshot only", markerTone: .rose, blocks: [
                .init("privacy", style: .settings, rows: [
                    .init("posthog", title: "사용량 텔레메트리 (PostHog)", subtitle: "앱 열기 횟수, Day 도달 일자, 작업 완료/포기 같은 익명 이벤트. opt-in이며 KR1.1 ~ KR4.3 측정에만 쓰입니다.", trailing: "OFF", tone: .muted),
                    .init("snapshot", title: "진단 스냅샷 내보내기", subtitle: "제출 전 미리보기 — 민감 정보가 제거된 실행 상태를 클립보드로 복사합니다.", trailing: "내보내기...", tone: .amber),
                    .init("reset", title: "모든 로컬 데이터 삭제", subtitle: "sessions, day-task 히스토리, 캐시. 기록 폴더 자체는 건드리지 않습니다.", trailing: "데이터 초기화…", tone: .rose),
                ]),
            ]),
            .init(id: "updates", title: "업데이트", meta: "Sparkle appcast · Developer ID 서명", markerTone: .sky, blocks: [
                .init("updates", style: .settings, rows: [
                    .init("version", title: "현재 버전", subtitle: "초기 검증 미리보기 — Day 0-3 흐름 한정. Day 4-7은 다음 점 릴리즈 예정.", trailing: "0.4.2 · build 1042", tone: .accent),
                    .init("auto", title: "자동 업데이트", subtitle: "Sparkle이 백그라운드에서 appcast를 확인하고 새 버전을 받아옵니다. 설치는 다음 실행 때.", trailing: "ON", tone: .accent),
                    .init("checked", title: "마지막 확인", subtitle: "appcast.xml을 마지막으로 조회한 시각. 최신 — 0.4.2.", trailing: "5분 전", tone: .muted),
                    .init("signing", title: "서명 확인", subtitle: "notarization · Hardened Runtime · Developer ID · 모두 통과.", trailing: "검증됨", tone: .accent),
                ]),
            ]),
            .init(id: "advanced", title: "고급 & 실행 보조 앱", meta: "실행 보조 앱 · 진단 · 로그", markerTone: .muted, blocks: [
                .init("advanced", style: .settings, rows: [
                    .init("state", title: "실행 보조 앱 상태", subtitle: "Node 실행 보조 앱이 살아 있고 stdio + 로컬 HTTP 둘 다 응답 중입니다.", trailing: "실행 중 · PID 47281", tone: .accent),
                    .init("log-folder", title: "로그 폴더", subtitle: "~/Library/Logs/Agentic30 — 회전 7개 보관.", trailing: "Finder에서 열기", tone: .muted),
                    .init("bip-notifications", title: "공개 기록 알림", subtitle: "테스트 알림은 실제 macOS 알림 센터 경로를 사용합니다.", trailing: "테스트", tone: .amber),
                    .init("confetti", title: "Confetti 테스트", subtitle: "완료 축하 confetti 렌더링 경로를 즉시 재생합니다.", trailing: "재생", tone: .sky),
                ]),
            ]),
        ],
        meta: .init(title: "시스템 상태", cards: [
            .init("sidecar", style: .rows, rows: [
                .init("status", title: "상태", subtitle: "PID 47281 · 업타임 2d 14h · 메모리 86 MB · CPU 0.4%", trailing: "실행 중", tone: .accent),
                .init("workspace", title: "워크스페이스", subtitle: "~/code/agentic30-public", trailing: "명시됨", tone: .sky),
                .init("version", title: "버전", subtitle: "app 0.4.2 (1042) · 실행 보조 앱 0.4.2 · node v20.11.1 · swift 5.10 · macOS 14.5", trailing: "arm64", tone: .muted),
            ]),
            .init("system-actions", style: .rows, rows: [
                .init("diagnostics", title: "진단 스냅샷 내보내기", subtitle: "sanitize · ZIP", trailing: nil, tone: .amber),
                .init("restart", title: "실행 보조 앱 재시작", subtitle: "다운타임 ~1초", trailing: nil, tone: .accent),
            ]),
            .init("reference-docs", style: .rows, rows: [
                .init("release", title: "release-checklist.md", subtitle: "배포 전 점검 항목", trailing: nil, tone: .muted),
                .init("limitations", title: "known-limitations.md", subtitle: "알려진 제한사항", trailing: nil, tone: .muted),
                .init("diagnostics-guide", title: "diagnostics-guide.md", subtitle: "진단 가이드", trailing: nil, tone: .muted),
            ]),
        ])
    )

    static let interviews = OpenDesignReferencePageModel(
        kind: .interviews,
        sideTitle: "인터뷰",
        sideBadge: "8",
        sideSearchPlaceholder: nil,
        sideGroups: [
            .init(title: "분석 완료", count: nil, rows: [
                .init(id: "jc", title: "장지창", subtitle: "분석 · 45m", badge: "8 / 10", leading: "JC", tone: .accent, isActive: true),
                .init(id: "pk", title: "박노훈", subtitle: "분석 · 38m", badge: "7 / 10", leading: "PK", tone: .accent, isActive: false),
                .init(id: "sh", title: "정세훈", subtitle: "분석 · 32m", badge: "5 / 10", leading: "SH", tone: .sky, isActive: false),
            ]),
            .init(title: "대기 중", count: nil, rows: [
                .init(id: "kp", title: "K. Park", subtitle: "transcribe 중", badge: "대기", leading: "KP", tone: .amber, isActive: false),
            ]),
            .init(title: "예정", count: nil, rows: [
                .init(id: "cy", title: "최예린", subtitle: "슬롯 확정 · 45m", badge: "D-3", leading: "CY", tone: .muted, isActive: false),
                .init(id: "sj", title: "신지호", subtitle: "DM 발송", badge: "D-5", leading: "SJ", tone: .muted, isActive: false),
                .init(id: "yj", title: "윤재희", subtitle: "슬롯 후보 · 30m", badge: "D-7", leading: "YJ", tone: .muted, isActive: false),
            ]),
        ],
        header: .init(
            badge: "JC",
            systemImage: nil,
            title: "장지창",
            subtitleParts: ["2026-04-22 19:30", "Zoom · 45분", "Day 1 · 1 / 4"],
            actions: [
                .init(id: "followups", title: "후속 질문 생성", systemImage: nil, tone: .ghost),
                .init(id: "spec", title: "SPEC.md에 반영", systemImage: nil, tone: .accent),
            ]
        ),
        filters: [.init("요약"), .init("인용 12", tone: .sky), .init("후속 7", tone: .amber), .init("대화 기록", tone: .muted)],
        sections: [
            .init(id: "summary", title: "요약", meta: nil, markerTone: .accent, blocks: [
                .init("summary-card", style: .banner, title: "5번 빌드 → 0매출", subtitle: "강한 신호 · 실제 행동 질문 4/5 통과", body: "패턴을 본인이 자각했지만 \"검증 없이 또 만들 것 같다\"는 회피 신호가 강합니다. 핵심 통증은 \"누가 쓸지를 모른다\"로 압축됩니다.", chips: [.init("신호 8/10"), .init("고객 후보 적합 매우 높음"), .init("주의 1", tone: .amber)]),
            ]),
            .init(id: "signals", title: "추출 신호", meta: "실제 행동 질문 · 4 카테고리", markerTone: .accent, blocks: [
                .init("signal-grid", style: .cards, rows: [
                    .init("pain", title: "통증", subtitle: "\"뭘 만들지 보다 누가 쓸지를 모른다.\"", body: "5건 인용 · 하루 3시간 검증 회피", tone: .rose),
                    .init("alt", title: "현재 대안", subtitle: "YouTube 인디해커 · Threads · ChatGPT", body: "3건 언급 · 구조 없음", tone: .sky),
                    .init("past", title: "과거 행동", subtitle: "6개월 · 5개 출시 · 가입 11명 · 매출 0원", body: "2건 인용 · 강력한 신호", tone: .accent),
                    .init("pay", title: "지불 의사", subtitle: "Cursor $20/mo · Claude Code $200/mo", body: "툴은 결제 · 결과는 0원", tone: .amber),
                ]),
            ]),
            .init(id: "mom", title: "실제 행동 질문 점검", meta: nil, markerTone: .amber, blocks: [
                .init("mom-rules", style: .rows, title: "품질 양호 — 한 가지 주의 항목", rows: [
                    .init("r1", leading: "✓", title: "의견이 아니라 행동을 물었다", trailing: "7회", tone: .accent),
                    .init("r2", leading: "✓", title: "미래 약속이 아니라 과거 사실을 받았다", trailing: "4회", tone: .accent),
                    .init("r3", leading: "✓", title: "구체 수치·날짜·금액으로 답을 받아냈다", trailing: "12회", tone: .accent),
                    .init("r4", leading: "!", title: "솔루션을 미리 설명하지 않았다", subtitle: "06:14 · 1회", trailing: "주의", tone: .amber),
                ]),
            ]),
            .init(id: "quotes", title: "핵심 인용", meta: "4 / 12", markerTone: .accent, blocks: [
                .init("quote-list", style: .quotes, rows: [
                    .init("q1", leading: "02:18", title: "AI로 다섯 번 만들었어요. 한 번도 안 팔렸어요.", subtitle: "Pain", trailing: "강한 통증", tone: .rose),
                    .init("q2", leading: "07:42", title: "지난 6개월에 다섯 개 출시. 가입 누계 11명, 매출은 0원.", subtitle: "Past", trailing: "과거 행동", tone: .accent),
                    .init("q3", leading: "12:55", title: "\"만들기 전에, 누가 쓸 사람인지를 모르겠다\"는 거예요.", subtitle: "첫 진입점", trailing: "핵심 통증", tone: .rose),
                    .init("q4", leading: "28:34", title: "오 그거 좋은데요? 저 해볼래요.", subtitle: "피해야 할 답변", trailing: "실제 행동 질문 위반", tone: .amber),
                ]),
            ]),
            .init(id: "followups", title: "Day 3 후속 질문", meta: "3 필수", markerTone: .accent, blocks: [
                .init("followups", style: .rows, rows: [
                    .init("f1", leading: "1", title: "지난 6개월에 마지막으로 출시한 프로덕트는 언제, 어떤 거였어요?", subtitle: "5번 빌드 → 0매출 패턴 확인", tone: .accent),
                    .init("f2", leading: "2", title: "가입자 0명일 때 본인은 그 다음 주에 뭘 했어요?", subtitle: "실패 후 실제 행동 데이터", tone: .accent),
                    .init("f3", leading: "3", title: "\"오늘 뭘 해야 다음 주가 좋아질지\" 막힐 때 마지막으로 어디서 답을 찾았어요?", subtitle: "현재 대안의 구체적 행동", tone: .accent),
                ]),
            ]),
            .init(id: "diff", title: "SPEC · 고객 후보 문서 갱신 제안", meta: nil, markerTone: .teal, blocks: [
                .init("diff", style: .diff, title: "ICP.md · SPEC.md §2", rows: [
                    .init("d1", leading: "5", title: "## Our ICP: 전업 1인 개발자 (수익 0원)", tone: .muted),
                    .init("d2", leading: "7", title: "- 에이전트 코딩 도구로 만들 수 있는, 이미 전업한 1인 개발자.", tone: .rose),
                    .init("d3", leading: "7", title: "+ 특히 \"AI로 계속 새로 만드는데 한 번도 안 팔린\" 좁은 고객군.", tone: .accent),
                    .init("d4", leading: "10", title: "+ 6개월에 3개+ 출시, 가입 20명 미만, 매출 0원", tone: .accent),
                ]),
            ]),
        ],
        meta: .init(title: "요약", cards: [
            .init("interview-stats", style: .metrics, rows: [
                .init("done", title: "3", subtitle: "분석", tone: .accent),
                .init("wait", title: "2", subtitle: "대기", tone: .amber),
                .init("todo", title: "3", subtitle: "예정", tone: .muted),
            ]),
            .init("themes", style: .rows, title: "반복 테마", rows: [
                .init("t1", title: "\"누가 쓸지를 모른다\"", trailing: "3 / 3", tone: .accent),
                .init("t2", title: "N번 빌드 → 0매출", trailing: "3 / 3", tone: .accent),
                .init("t3", title: "맞춤 과제 적합", trailing: "2 / 3", tone: .amber),
                .init("t4", title: "툴 자비 결제", trailing: "2 / 3", tone: .amber),
            ]),
            .init("upcoming", style: .rows, title: "예정 인터뷰", rows: [
                .init("cy", leading: "02", title: "최예린", subtitle: "14:00 · 45m", trailing: "5월", tone: .sky),
                .init("sj", leading: "04", title: "신지호", subtitle: "10:00 · DM 대기", trailing: "5월", tone: .amber),
                .init("yj", leading: "06", title: "윤재희", subtitle: "16:00 · 커피챗", trailing: "5월", tone: .muted),
            ]),
        ])
    )

    static let bipLog = OpenDesignReferencePageModel(
        kind: .bipLog,
        sideTitle: "리서치 필터",
        sideBadge: nil,
        sideSearchPlaceholder: nil,
        sideGroups: [
            .init(title: "소스", count: "5", rows: [
                .init(id: "all", title: "전체", subtitle: nil, badge: "0", leading: "▣", tone: .accent, isActive: true),
                .init(id: "strong", title: "강한 적합", subtitle: nil, badge: "0", leading: "✓", tone: .accent, isActive: false),
                .init(id: "x", title: "X / Twitter", subtitle: nil, badge: "0", leading: "X", tone: .sky, isActive: false),
                .init(id: "threads", title: "Threads (Meta)", subtitle: nil, badge: "0", leading: "@", tone: .violet, isActive: false),
                .init(id: "needs", title: "워치리스트", subtitle: nil, badge: "0", leading: "!", tone: .amber, isActive: false),
            ]),
            .init(title: "고객 후보 신호", count: "3", rows: [
                .init(id: "social", title: "X/Threads 공개 기록", subtitle: "fetch 기반", badge: "live", leading: "01", tone: .accent, isActive: false),
                .init(id: "day", title: "오늘 Day 커리큘럼", subtitle: "Day 1-30", badge: "live", leading: "02", tone: .sky, isActive: false),
                .init(id: "gap", title: "확인할 공백", subtitle: "전업 · 매출 · 인터뷰", badge: "ask", leading: "03", tone: .amber, isActive: false),
            ]),
        ],
        header: .init(
            badge: "공개 기록",
            systemImage: "doc.text",
            title: "공개 기록 · 고객 후보 리서치",
            subtitleParts: ["웹 자료 검색 + 원문 확인", "오늘 Day와 프로젝트 설정 기준"],
            actions: [
                .init(id: "draft", title: "초안", systemImage: "doc.text", tone: .ghost),
                .init(id: "research", title: "다시 리서치", systemImage: "arrow.clockwise", tone: .accent),
            ]
        ),
        filters: [.init("전체 0"), .init("강한 적합 0", tone: .accent), .init("X 0", tone: .sky), .init("Threads(Meta) 0", tone: .violet), .init("관심 후보 0", tone: .amber)],
        sections: [
            .init(id: "brief", title: "고객 후보 리서치 큐", meta: "웹 자료 검색 + 원문 확인 · X/Threads", markerTone: .accent, blocks: [
                .init("research-brief", style: .banner, title: "X와 Threads 공개 게시글에서 고객 후보 신호를 찾습니다.", subtitle: "자동 리서치", body: "검색 기준은 사용자가 설정한 프로젝트 문서와 오늘 진행 Day입니다.", chips: [.init("리서치 대기"), .init("실제 URL 필요", tone: .accent), .init("설정 필요", tone: .amber)]),
            ]),
            .init(id: "research", title: "리서치된 게시글", meta: "원문 하이라이트 + 고객 후보 근거", markerTone: .sky, blocks: [
                .init("research-list", style: .articles, rows: []),
            ]),
            .init(id: "draft", title: "공개 기록 초안", meta: "선택 후보를 기반으로 자동 생성", markerTone: .amber, blocks: [
                .init("draft", style: .draft, title: "선택 후보 없음", body: "후보 카드에서 “공개 기록 초안에 반영”을 누르면, 실제 X/Threads 리서치 결과를 오늘의 공개 기록으로 바꿉니다.\n\n형식:\n1. 원문에서 잡은 고객 후보 증거\n2. 왜 인터뷰 후보인지\n3. DM에서 확인할 공백 1개"),
            ]),
        ],
        meta: .init(title: "고객 후보", cards: [
            .init("candidate-progress", style: .banner, title: "0 / 18 후보", subtitle: "다음 액션 · Exa 리서치 실행", body: "수익 상태, 전업 여부, 인터뷰 의향 공백을 확인하면 인터뷰 큐로 승격합니다.", chips: [.init("live", tone: .accent), .init("gap", tone: .amber), .init("ask", tone: .sky)]),
        ])
    )

    static let news = OpenDesignReferencePageModel(
        kind: .news,
        sideTitle: "받은함",
        sideBadge: "14",
        sideSearchPlaceholder: "뉴스 검색",
        sideGroups: [
            .init(title: "받은함", count: nil, rows: [
                .init(id: "all", title: "이번 주 큐레이션", subtitle: nil, badge: "14", leading: "●", tone: .accent, isActive: true),
            ]),
            .init(title: "Value별", count: nil, rows: [
                .init(id: "constraint", title: "제약이 실력이다", subtitle: nil, badge: "4", leading: "●", tone: .amber, isActive: false),
                .init(id: "customer", title: "고객이 먼저다", subtitle: nil, badge: "6", leading: "●", tone: .accent, isActive: false),
                .init(id: "ship", title: "불완전해도 공개", subtitle: nil, badge: "3", leading: "●", tone: .sky, isActive: false),
                .init(id: "numbers", title: "숫자로 결정", subtitle: nil, badge: "4", leading: "●", tone: .rose, isActive: false),
                .init(id: "adaptive", title: "맞춤형이 일반형보다 낫다", subtitle: nil, badge: "3", leading: "●", tone: .teal, isActive: false),
            ]),
            .init(title: "출처", count: nil, rows: [
                .init(id: "essay", title: "에세이 · 핸드북", subtitle: nil, badge: "7", leading: "PH", tone: .teal, isActive: false),
                .init(id: "book", title: "책 · 챕터", subtitle: nil, badge: "3", leading: "BK", tone: .amber, isActive: false),
                .init(id: "talk", title: "강연 · 팟캐스트", subtitle: nil, badge: "2", leading: "YC", tone: .rose, isActive: false),
            ]),
        ],
        header: .init(
            badge: "N",
            systemImage: "newspaper",
            title: "뉴스",
            subtitleParts: ["안 읽음 14건", "전체 14건", "마지막 동기화 오늘 06:12", "출처 12개 채널"],
            actions: [
                .init(id: "group", title: "그룹: Value별", systemImage: "line.3.horizontal", tone: .ghost),
                .init(id: "sort", title: "최신순", systemImage: "clock", tone: .ghost),
                .init(id: "read", title: "모두 읽음 처리", systemImage: "checkmark", tone: .accent),
            ]
        ),
        filters: [.init("전체 14"), .init("제약 4", tone: .amber), .init("고객 6", tone: .accent), .init("공개 3", tone: .sky), .init("숫자 4", tone: .rose), .init("맞춤 3", tone: .teal)],
        sections: [
            .init(id: "takeaway", title: "오늘의 한 줄", meta: "Day 1 — 고객 후보 · 첫 인터뷰를 정하는 중", markerTone: .amber, blocks: [
                .init("takeaway", style: .banner, title: "아이디어를 묻지 마세요.", subtitle: "Rob Fitzpatrick · The Mom Test, Ch. 1 · 22분 읽기", body: "지난주에 이 문제 때문에 실제로 뭘 했는지 물으세요. 칭찬은 데이터가 아닙니다.", chips: [.init("오늘 인터뷰 질문에 반영"), .init("VALUES.md에 인용 저장", tone: .amber)]),
            ]),
            .init(id: "customer", title: "고객이 먼저다", meta: "Value 2 · 6건 · 첫 매출 0원일 때 고객 후보가 가장 자주 비는 자료", markerTone: .accent, blocks: [
                .init("customer-articles", style: .articles, rows: [
                    .init("mom", leading: "MT", title: "The Mom Test — 엄마도 거짓말한다", subtitle: "momtestbook.com · 책 · Ch. 1-3 · 22분", body: "Day 1 적용: \"지난주에 이 문제 때문에 뭘 시도했나요?\" 칭찬형 답이 사라지고 진짜 시간을 쓴 사람만 남습니다.", trailing: "오늘 고정", tone: .accent, chips: [.init("고객"), .init("숫자", tone: .rose)]),
                    .init("ph", leading: "PH", title: "Your entire strategy is downstream of your ICP", subtitle: "posthog.com/handbook · 8분", body: "고객 후보가 가격, 기능, 마케팅 채널, 콘텐츠 톤, UI 스타일을 결정합니다. 모르는 사람을 위해 만들면 모든 결정이 흐릿해집니다.", tone: .teal, chips: [.init("고객"), .init("맞춤", tone: .teal)]),
                    .init("pg", leading: "PG", title: "Do Things That Don't Scale", subtitle: "paulgraham.com · 에세이 · 15분", body: "첫 30일은 자동화보다 1대1 손작업이 빠릅니다. 첫 5명에게 메뉴바 앱을 직접 설치해 주세요.", tone: .amber, chips: [.init("고객"), .init("제약", tone: .amber)]),
                    .init("yc", leading: "YC", title: "How to Talk to Users", subtitle: "Startup School · 강연 · 32분", body: "지금 가장 큰 문제 1개, 마지막 발생 시점, 그때 어떻게 해결했는가. 이 3개로 시작하세요.", tone: .sky, chips: [.init("고객"), .init("숫자", tone: .rose)]),
                ]),
            ]),
            .init(id: "constraint", title: "제약이 실력이다", meta: "Value 1 · 4건 · 30일 안에 끝나려면 뭘 빼야 하는가", markerTone: .amber, blocks: [
                .init("constraint-articles", style: .articles, rows: [
                    .init("calm", leading: "CC", title: "Calm Company — VC 없이도 충분하다", subtitle: "calmcompany.fund · 매니페스토 · 7분", body: "30일 목표를 투자 유치가 아니라 첫 매출 1원으로 잡으세요.", tone: .amber, chips: [.init("제약", tone: .amber), .init("맞춤", tone: .teal)]),
                    .init("levels", leading: "LV", title: "Nomad List — 한 명, 단일 SQLite, 연간 반복 매출 $1.5M", subtitle: "levels.io · 실전 케이스", body: "스택은 방어력이 아닙니다. 방어력은 고객과의 거리입니다.", tone: .amber, chips: [.init("제약", tone: .amber), .init("고객")]),
                ]),
            ]),
        ],
        meta: .init(title: "뉴스 요약", cards: [
            .init("coverage", style: .rows, title: "Value 커버리지", rows: [
                .init("customer", title: "고객이 먼저다", trailing: "6 / 14", tone: .accent),
                .init("constraint", title: "제약이 실력이다", trailing: "4 / 14", tone: .amber),
                .init("numbers", title: "숫자로 결정", trailing: "4 / 14", tone: .rose),
                .init("adaptive", title: "맞춤형이 일반형보다 낫다", trailing: "3 / 14", tone: .teal),
            ]),
            .init("recommend", style: .rows, title: "오늘 추천 3건", rows: [
                .init("r1", leading: "01", title: "The Mom Test — 엄마도 거짓말한다", subtitle: "고객 · 22분 · 인터뷰 직전", tone: .accent),
                .init("r2", leading: "02", title: "YC — How to Talk to Users", subtitle: "고객 · 32분 · 3개 질문 템플릿", tone: .sky),
                .init("r3", leading: "03", title: "PostHog — Downstream of ICP", subtitle: "맞춤 · 8분 · 고객 후보 정의 직전", tone: .teal),
            ]),
        ])
    )

    static let history = OpenDesignReferencePageModel(
        kind: .history,
        sideTitle: "30일 챌린지",
        sideBadge: "1 / 30",
        sideSearchPlaceholder: "과제 검색",
        sideGroups: [
            .init(title: "Week 1 — 초기 검증", count: "1 / 7", rows: [
                .init(id: "day1", title: "먼저 도울 사람을 정해요", subtitle: "Day 1 · 고객 후보 · 인터뷰 4문항", badge: nil, leading: "◌", tone: .accent, isActive: false),
                .init(id: "day2", title: "시장 신호 읽기", subtitle: "Day 2 · 시장", badge: nil, leading: "○", tone: .muted, isActive: false),
                .init(id: "day3", title: "실제 행동 인터뷰 ×3", subtitle: "Day 3 · 인터뷰", badge: nil, leading: "○", tone: .muted, isActive: false),
                .init(id: "day4", title: "10× 진입점 찾기", subtitle: "Day 4 · 진입점", badge: nil, leading: "○", tone: .muted, isActive: false),
            ]),
            .init(title: "Week 2 — 만들기", count: "잠금 해제 D7", rows: [
                .init(id: "day8", title: "첫 버전 핵심 4시간 빌드", subtitle: "Day 8 · 만들기", badge: "잠금", leading: "⌧", tone: .muted, isActive: false),
                .init(id: "day9", title: "첫 5명 초대 초안", subtitle: "Day 9 · 연락", badge: "잠금", leading: "⌧", tone: .muted, isActive: false),
            ]),
        ],
        header: .init(
            badge: "H",
            systemImage: "clock.arrow.circlepath",
            title: "회고 인사이트",
            subtitleParts: ["14 events", "2026-05-02 → 오늘", "agentic30-public"],
            actions: [.init(id: "today", title: "오늘로 이동", systemImage: "forward", tone: .accent)]
        ),
        filters: [.init("전체 14"), .init("인터뷰 6", tone: .sky), .init("공개 기록 0", tone: .amber), .init("코드 · GitHub 4", tone: .accent), .init("과제 1", tone: .violet), .init("커리큘럼 3", tone: .teal)],
        sections: [
            .init(id: "summary", title: "요약", meta: nil, markerTone: .accent, blocks: [
                .init("banner", style: .banner, title: "초기 검증 흐름이 처음으로 닫혔어요 · Day 1 완료", subtitle: "2026-05-16 14:48", body: "고객 후보 1명이 SPEC.md에 자동 저장됨 · Day 2가 곧 열립니다.", chips: [.init("완료 Day 1 / 30"), .init("증거 14", tone: .sky), .init("활동일 5 / 15d", tone: .amber)]),
            ]),
            .init(id: "today", title: "오늘", meta: "2026-05-16 · 금 · 6 events", markerTone: .accent, blocks: [
                .init("today-events", style: .timeline, rows: [
                    .init("code", leading: "14:48:02", title: "후보 1명 자동 저장", subtitle: "SPEC.md · candidate.icp 블록 갱신 · +18 / -3", body: "channel=ex-colleague, tools=cursor, stuck=build-loop, last7d=restart", tone: .accent),
                    .init("iv4", leading: "14:45:21", title: "\"또 새로 시작\"", subtitle: "INTERVIEW 4/4 · 지난 7일", body: "실제 행동 질문 통과. 빌드 루프 가설이 실제 행동으로 확정됐어요.", tone: .sky),
                    .init("iv3", leading: "14:42:09", title: "\"빌드 단계\" · \"검증 없이 5번 빌드\"", subtitle: "INTERVIEW 3/4 · 막힌 단계", body: "막힌 지점 후보가 빌드를 끝까지 끌고 가는 보조로 좁혀집니다.", tone: .sky),
                    .init("iv2", leading: "14:38:33", title: "\"Cursor 메인\"", subtitle: "INTERVIEW 2/4 · 도구", body: "결제 의향이 안정적인 풀이고 Day 3 인터뷰 모수도 충분합니다.", tone: .sky),
                    .init("mission", leading: "14:32:50", title: "첫 인터뷰 1통 할 사람을 한 명 고르기", subtitle: "MISSION · Day 1 수락", body: "예상 3분 → 실제 16분.", tone: .violet),
                ]),
            ]),
            .init(id: "yesterday", title: "어제", meta: "2026-05-15 · 목 · 3 events", markerTone: .sky, blocks: [
                .init("yesterday-events", style: .timeline, rows: [
                    .init("spec", leading: "22:14:08", title: "SPEC.md · ICP.md 정리", subtitle: "제품 한 줄 확정 · +142 / -87", tone: .accent),
                    .init("zoom", leading: "21:30:00", title: "장지창 · 45분", subtitle: "Zoom 대화 기록 · 검증 없이 5번 빌드", tone: .sky),
                    .init("scope", leading: "17:42:03", title: "Q2 진입점: 초기 검증 Day 0-3 먼저 닫기", subtitle: "Day 4-7 / Day 8-30은 직접 사용해본 뒤 확장", tone: .teal),
                ]),
            ]),
            .init(id: "future", title: "내일 — 잠금 해제 예정", meta: "2026-05-17 → Day 2 · Day 30", markerTone: .muted, blocks: [
                .init("future-events", style: .timeline, rows: [
                    .init("day2", leading: "LOCKED", title: "시장 신호 읽기", subtitle: "Day 1 고객 후보 1명을 기준으로 Threads/IH 키워드 3개 추출", tone: .muted),
                    .init("day3", leading: "ETA 5/18", title: "실제 행동 인터뷰 ×3", subtitle: "전 직장 출신 + Cursor + 빌드 단계에서 멈춤 풀 5명", tone: .muted),
                ]),
            ]),
        ],
        meta: .init(title: "요약", cards: [
            .init("heatmap", style: .heatmap, title: "활동 · 30일", subtitle: "14 events"),
            .init("sources", style: .rows, title: "증거 소스 · 합 14", rows: [
                .init("iv", title: "인터뷰 · 원문", trailing: "6", tone: .sky),
                .init("bip", title: "공개 기록 · 게시", trailing: "0", tone: .amber),
                .init("code", title: "코드 · GitHub commit", trailing: "4", tone: .accent),
                .init("mission", title: "과제 · Day 미션", trailing: "1", tone: .violet),
                .init("curriculum", title: "커리큘럼 · 결정", trailing: "3", tone: .teal),
            ]),
        ])
    )
}

private enum OpenDesignNewsFilter: String, CaseIterable, Identifiable {
    case all
    case constraint
    case customer
    case ship
    case numbers
    case alone
    case adaptive
    case sourceEssay
    case sourceBook
    case sourceTalk
    case sourceCase
    case saved
    case applied

    var id: String { rawValue }
}

private struct OpenDesignNewsFilterDescriptor: Identifiable {
    let id: OpenDesignNewsFilter
    let title: String
    let tone: OpenDesignReferenceTone
    let showsDot: Bool
}

private struct OpenDesignNewsStreamGroup: Identifiable {
    let id: String
    let title: String
    let dynamicBadge: Bool
    let rows: [OpenDesignNewsStreamRow]
}

private struct OpenDesignNewsStreamRow: Identifiable {
    let id: OpenDesignNewsFilter
    let title: String
    let tone: OpenDesignReferenceTone
}

private struct OpenDesignNewsSection: Identifiable {
    let id: String
    let title: String
    let meta: String
    let tone: OpenDesignReferenceTone
}

private struct OpenDesignNewsArticle: Identifiable {
    let id: String
    let sectionID: String
    let sourceMark: String
    let source: String
    let typeLabel: String
    let time: String
    let title: String
    let original: String?
    let quote: String?
    let takeLead: String
    let takeBody: String
    let applyWhen: String
    let values: Set<OpenDesignNewsFilter>
    let type: OpenDesignNewsFilter
    let sourceTone: OpenDesignReferenceTone
    let isPinned: Bool
    let isDefaultSaved: Bool
    let isApplied: Bool
}

private struct OpenDesignNewsCoverage: Identifiable {
    let id: OpenDesignNewsFilter
    let title: String
    let count: String
    let progress: CGFloat
    let tone: OpenDesignReferenceTone
}

private struct OpenDesignNewsRecommendation: Identifiable {
    let id: String
    let rank: String
    let title: String
    let meta: String
    let tone: OpenDesignReferenceTone
}

private struct OpenDesignNewsSource: Identifiable {
    let id: String
    let mark: String
    let title: String
    let count: String?
    let isSubscribed: Bool
    let tone: OpenDesignReferenceTone
}

private enum OpenDesignBipFilter: String, CaseIterable, Identifiable {
    case all
    case strong
    case x
    case threads
    case instagram
    case needs

    var id: String { rawValue }

    var title: String {
        switch self {
        case .all: return "전체"
        case .strong: return "강한 적합"
        case .x: return "X"
        case .threads: return "Threads(Meta)"
        case .instagram: return "Instagram"
        case .needs: return "워치리스트"
        }
    }

    var tone: OpenDesignReferenceTone {
        switch self {
        case .all, .strong: return .accent
        case .x: return .sky
        case .threads: return .violet
        case .instagram: return .pink
        case .needs: return .amber
        }
    }
}

private struct OpenDesignBipSignal: Identifiable {
    let id: String
    let title: String
    let subtitle: String
    let state: String
    let tone: OpenDesignReferenceTone
}

private struct OpenDesignBipCandidate: Identifiable {
    let id: String
    let matchLabel: String
    let matchCaption: String
    let sourceLabel: String
    let title: String
    let source: String
    let date: String
    let medium: String
    let quote: AttributedString
    let whyTitle: String
    let whyBody: AttributedString
    let usageTitle: String
    let usageBody: String
    let gap: AttributedString
    let filters: Set<OpenDesignBipFilter>
    let tags: [OpenDesignReferenceChip]
    let sourceURL: URL?
    let draft: String
    let tone: OpenDesignReferenceTone
}

private extension OpenDesignBipSignal {
    init(researchSignal: BipResearchSignal) {
        self.init(
            id: researchSignal.id,
            title: researchSignal.title,
            subtitle: researchSignal.subtitle ?? "",
            state: researchSignal.state ?? "seen",
            tone: OpenDesignReferenceTone(bipTone: researchSignal.tone ?? researchSignal.state)
        )
    }
}

private extension OpenDesignBipCandidate {
    init(researchCandidate: BipResearchCandidate) {
        let sourceType = (researchCandidate.sourceType ?? "").lowercased()
        let sourceTone = OpenDesignReferenceTone.bipSourceTone(sourceType)
        let evidenceTone = OpenDesignReferenceTone.bipEvidenceTone(researchCandidate.evidenceStrength)
        let filters = OpenDesignBipFilter.filters(
            sourceType: sourceType,
            evidenceStrength: researchCandidate.evidenceStrength
        )
        let tags = researchCandidate.tags.isEmpty
            ? [OpenDesignReferenceChip(researchCandidate.sourceLabel ?? "공개 기록", tone: sourceTone)]
            : researchCandidate.tags.map { tag in
                OpenDesignReferenceChip(
                    tag.title,
                    tone: OpenDesignReferenceTone(bipTone: tag.tone),
                    id: "\(researchCandidate.id)-\(tag.title)"
                )
            }
        let sourceURL = researchCandidate.sourceRefs.compactMap { source -> URL? in
            guard let url = source.url else { return nil }
            return URL(string: url)
        }.first
        self.init(
            id: researchCandidate.id,
            matchLabel: researchCandidate.matchLabel ?? OpenDesignBipFilter.matchLabel(for: researchCandidate.evidenceStrength),
            matchCaption: researchCandidate.matchCaption ?? "적합",
            sourceLabel: researchCandidate.sourceLabel ?? sourceType.uppercased(),
            title: researchCandidate.title,
            source: researchCandidate.source ?? researchCandidate.sourceRefs.first?.title ?? "공개 게시글",
            date: researchCandidate.date ?? researchCandidate.sourceRefs.first?.publishedAt ?? "날짜 미상",
            medium: researchCandidate.medium ?? OpenDesignBipFilter.defaultMedium(for: sourceType),
            quote: openDesignBipAttributed(researchCandidate.quote ?? researchCandidate.sourceRefs.first?.excerpt ?? "원문 excerpt가 비어 있습니다."),
            whyTitle: researchCandidate.whyTitle ?? "왜 고객 후보 증거인가",
            whyBody: openDesignBipAttributed(researchCandidate.whyBody ?? "프로젝트 기준과 오늘 Day에 맞는 공개 신호입니다."),
            usageTitle: researchCandidate.usageTitle ?? "공개 기록 활용",
            usageBody: researchCandidate.usageBody ?? "오늘의 공개 기록 또는 DM 후보로 전환합니다.",
            gap: openDesignBipAttributed(researchCandidate.gap ?? "확인 필요: 전업 여부, 수익 상태, 인터뷰 의향."),
            filters: filters,
            tags: tags,
            sourceURL: sourceURL,
            draft: researchCandidate.draft ?? "",
            tone: evidenceTone
        )
    }
}

private extension OpenDesignBipFilter {
    static func filters(sourceType: String, evidenceStrength: String?) -> Set<OpenDesignBipFilter> {
        var filters: Set<OpenDesignBipFilter> = [.all]
        let normalizedStrength = (evidenceStrength ?? "").lowercased()
        if normalizedStrength == "strong" {
            filters.insert(.strong)
        } else {
            filters.insert(.needs)
        }
        if sourceType == "threads" {
            filters.insert(.threads)
        } else if sourceType == "instagram" {
            filters.insert(.instagram)
        } else {
            filters.insert(.x)
        }
        return filters
    }

    static func defaultMedium(for sourceType: String) -> String {
        switch sourceType {
        case "threads": return "Threads post"
        case "instagram": return "Instagram post"
        default: return "X/Twitter post"
        }
    }

    static func matchLabel(for evidenceStrength: String?) -> String {
        switch (evidenceStrength ?? "").lowercased() {
        case "strong": return "강"
        case "weak": return "보류"
        default: return "중"
        }
    }
}

private extension OpenDesignReferenceTone {
    init(bipTone: String?) {
        self = OpenDesignReferenceTone(rawValue: (bipTone ?? "").lowercased()) ?? .accent
    }

    static func bipSourceTone(_ sourceType: String) -> OpenDesignReferenceTone {
        switch sourceType {
        case "threads": return .violet
        case "instagram": return .pink
        default: return .sky
        }
    }

    static func bipEvidenceTone(_ evidenceStrength: String?) -> OpenDesignReferenceTone {
        switch (evidenceStrength ?? "").lowercased() {
        case "strong": return .accent
        case "weak": return .amber
        default: return .sky
        }
    }
}

private func openDesignBipAttributed(_ text: String) -> AttributedString {
    var result = AttributedString(text)
    result.foregroundColor = OpenDesignDayColor.fgSecondary
    return result
}

private enum OpenDesignNewsCatalog {
    static let filterDescriptors: [OpenDesignNewsFilterDescriptor] = [
        .init(id: .all, title: "전체", tone: .accent, showsDot: false),
        .init(id: .constraint, title: "제약", tone: .amber, showsDot: true),
        .init(id: .customer, title: "고객", tone: .accent, showsDot: true),
        .init(id: .ship, title: "공개", tone: .sky, showsDot: true),
        .init(id: .numbers, title: "숫자", tone: .rose, showsDot: true),
        .init(id: .alone, title: "고립", tone: .violet, showsDot: true),
        .init(id: .adaptive, title: "Adaptive", tone: .teal, showsDot: true),
    ]

    static let streamGroups: [OpenDesignNewsStreamGroup] = [
        .init(id: "inbox", title: "받은함", dynamicBadge: true, rows: [
            .init(id: .all, title: "이번 주 큐레이션", tone: .accent),
        ]),
        .init(id: "values", title: "Value별", dynamicBadge: false, rows: [
            .init(id: .constraint, title: "제약이 실력이다", tone: .amber),
            .init(id: .customer, title: "고객이 먼저다", tone: .accent),
            .init(id: .ship, title: "불완전해도 공개", tone: .sky),
            .init(id: .numbers, title: "숫자로 결정", tone: .rose),
            .init(id: .alone, title: "고립되지 마라", tone: .violet),
            .init(id: .adaptive, title: "Adaptive over Static", tone: .teal),
        ]),
        .init(id: "sources", title: "출처", dynamicBadge: false, rows: [
            .init(id: .sourceEssay, title: "에세이 · 핸드북", tone: .teal),
            .init(id: .sourceBook, title: "책 · 챕터", tone: .amber),
            .init(id: .sourceTalk, title: "강연 · 팟캐스트", tone: .pink),
            .init(id: .sourceCase, title: "실전 케이스", tone: .violet),
        ]),
        .init(id: "collections", title: "내 컬렉션", dynamicBadge: false, rows: [
            .init(id: .saved, title: "저장한 자료", tone: .accent),
            .init(id: .applied, title: "프로젝트에 적용", tone: .sky),
        ]),
    ]

    static let sections: [OpenDesignNewsSection] = [
        .init(id: "customer", title: "고객이 먼저다", meta: "Value 2 · 6건 · 첫 매출 0원일 때 고객 후보가 가장 자주 비는 자료", tone: .accent),
        .init(id: "constraint", title: "제약이 실력이다", meta: "Value 1 · 4건 · 30일 안에 끝나려면 뭘 빼야 하는가", tone: .amber),
        .init(id: "ship", title: "불완전해도 공개하라", meta: "Value 3 · 3건 · 첫 공개 기록 전에 읽을 자료", tone: .sky),
        .init(id: "numbers", title: "숫자로 결정하라", meta: "Value 4 · 4건 · Day 7 계속/중단 결정에 쓸 기준", tone: .rose),
        .init(id: "alone", title: "혼자지만 고립되지 마라", meta: "Value 5 · 2건 · 외부 교정 장치", tone: .violet),
    ]

    static var defaultSavedArticleIDs: Set<String> {
        Set(articles.filter(\.isDefaultSaved).map(\.id))
    }

    static let articles: [OpenDesignNewsArticle] = [
        .init(
            id: "mom",
            sectionID: "customer",
            sourceMark: "MT",
            source: "momtestbook.com",
            typeLabel: "책 · Ch. 1-3",
            time: "22분 핵심 발췌",
            title: "The Mom Test — 엄마도 거짓말한다",
            original: "Rob Fitzpatrick · 2013 · \"How to talk to customers when everyone is lying to you\"",
            quote: "\"Would you buy this?\"는 최악의 질문입니다. 중요한 데이터는 그들이 문제에 대해 실제로 무엇을 했는가입니다.",
            takeLead: "Day 1 적용",
            takeBody: "오늘 인터뷰 4지선다 마지막에 한 번만 더 물으세요. \"지난주에 이 문제 때문에 뭘 시도했나요?\" 칭찬형 답이 사라지고 진짜 시간을 쓴 사람만 남습니다.",
            applyWhen: "Day 1 · Day 2 · Day 3",
            values: [.customer, .numbers],
            type: .sourceBook,
            sourceTone: .accent,
            isPinned: true,
            isDefaultSaved: true,
            isApplied: true
        ),
        .init(
            id: "posthog-icp",
            sectionID: "customer",
            sourceMark: "PH",
            source: "posthog.com/handbook",
            typeLabel: "핸드북",
            time: "8분",
            title: "Your entire strategy is downstream of your ICP",
            original: "PostHog Handbook · \"Who we build for\"",
            quote: nil,
            takeLead: "왜 보세요",
            takeBody: "VALUES.md 5번 항목의 외부 교정 장치 정의가 여기서 출발합니다. 고객 후보가 가격, 기능, 마케팅 채널, 콘텐츠 톤, UI 스타일을 결정합니다.",
            applyWhen: "Day 1 · Day 2",
            values: [.customer, .adaptive],
            type: .sourceEssay,
            sourceTone: .teal,
            isPinned: false,
            isDefaultSaved: false,
            isApplied: false
        ),
        .init(
            id: "pg-scale",
            sectionID: "customer",
            sourceMark: "PG",
            source: "paulgraham.com",
            typeLabel: "에세이",
            time: "15분",
            title: "Do Things That Don't Scale",
            original: "Paul Graham · 2013-07 · Y Combinator",
            quote: "Stripe의 창업자들은 한 명씩 노트북을 들고 가서 직접 설치해 줬다. 사인업 후 그 자리에서 키 발급과 API 연결을 끝냈다.",
            takeLead: "고객 후보가 자주 빼먹는 것",
            takeBody: "전업 1인 개발자는 자동화부터 만듭니다. 처음 30일은 자동화보다 1대1 손작업이 빠릅니다. 첫 5명에게 메뉴바 앱을 직접 설치해 주세요.",
            applyWhen: "Day 8 · Day 18+",
            values: [.customer, .constraint],
            type: .sourceEssay,
            sourceTone: .amber,
            isPinned: false,
            isDefaultSaved: false,
            isApplied: false
        ),
        .init(
            id: "yc-talk",
            sectionID: "customer",
            sourceMark: "YC",
            source: "ycombinator.com · Startup School",
            typeLabel: "강연",
            time: "32분 · 자막",
            title: "How to Talk to Users",
            original: "Eric Migicovsky · Pebble 창업자 · YC Lecture #4",
            quote: nil,
            takeLead: "3개 질문 템플릿",
            takeBody: "지금 가장 큰 문제 1개, 마지막 발생 시점, 그때 어떻게 해결했는가. 이 3개로 시작하면 \"아이디어 좋네요\"가 사라지고 행동 데이터만 남습니다.",
            applyWhen: "Day 2 · Day 3",
            values: [.customer, .numbers],
            type: .sourceTalk,
            sourceTone: .sky,
            isPinned: false,
            isDefaultSaved: true,
            isApplied: false
        ),
        .init(
            id: "ih-first-100",
            sectionID: "customer",
            sourceMark: "IH",
            source: "indiehackers.com",
            typeLabel: "케이스 · 12건",
            time: "25분",
            title: "How I got my first 100 customers — 12 indie hackers",
            original: "Indie Hackers Roundup · 2024 · Courtland Allen 편",
            quote: nil,
            takeLead: "패턴 1개",
            takeBody: "12명 중 11명이 인맥과 커뮤니티에서 시작했습니다. 바이럴은 거짓말이고 Product Hunt 1위도 첫 100명을 보장하지 않습니다.",
            applyWhen: "Day 18-21",
            values: [.customer, .ship],
            type: .sourceCase,
            sourceTone: .accent,
            isPinned: false,
            isDefaultSaved: false,
            isApplied: false
        ),
        .init(
            id: "minimalist",
            sectionID: "customer",
            sourceMark: "SL",
            source: "minimalistentrepreneur.com",
            typeLabel: "책 · Ch. 4",
            time: "18분",
            title: "The Minimalist Entrepreneur — 100명이 사랑하는 제품",
            original: "Sahil Lavingia · Gumroad 창업자 · 2021",
            quote: "100명의 사랑하는 고객은 10,000명의 가벼운 호감보다 더 가치 있습니다. 첫 사용자 묶음을 잡아야 다음 사용자 묶음이 옵니다.",
            takeLead: "시장 적합 기준",
            takeBody: "VALUES.md 4번의 시장 적합 기준이 사용자 100명과 첫 매출인 이유입니다. Day 7 계속/중단 결정에서 이 숫자를 떠올리세요.",
            applyWhen: "Day 7 · Day 22+",
            values: [.customer, .constraint],
            type: .sourceBook,
            sourceTone: .pink,
            isPinned: false,
            isDefaultSaved: false,
            isApplied: false
        ),
        .init(
            id: "calm-company",
            sectionID: "constraint",
            sourceMark: "CC",
            source: "calmcompany.fund",
            typeLabel: "매니페스토",
            time: "7분",
            title: "Calm Company — VC 없이도 충분하다",
            original: "Tyler Tringas · MicroAcquire · Earnest Capital",
            quote: nil,
            takeLead: "고객 후보에게 직접",
            takeBody: "전업 1인 개발자는 투자 받아야 진짜라는 환각에 빠집니다. 30일 목표를 투자가 아니라 첫 매출 1원으로 잡으세요.",
            applyWhen: "Day 22+",
            values: [.constraint, .adaptive],
            type: .sourceEssay,
            sourceTone: .teal,
            isPinned: false,
            isDefaultSaved: false,
            isApplied: false
        ),
        .init(
            id: "product-not-plan",
            sectionID: "constraint",
            sourceMark: "AW",
            source: "adamwiggins.com",
            typeLabel: "에세이",
            time: "9분",
            title: "Build a Product, Not a Plan",
            original: "Adam Wiggins · Heroku 공동창업자 · 12-factor 저자",
            quote: nil,
            takeLead: "30일짜리 사이즈",
            takeBody: "6개월 로드맵이 거의 다 틀리는 이유는 그동안 시장도, 본인도 바뀌기 때문입니다. 당신의 한 줄은 무엇인가요?",
            applyWhen: "Day 1 · Day 7",
            values: [.constraint, .adaptive],
            type: .sourceEssay,
            sourceTone: .violet,
            isPinned: false,
            isDefaultSaved: false,
            isApplied: false
        ),
        .init(
            id: "levels-sqlite",
            sectionID: "constraint",
            sourceMark: "LV",
            source: "levels.io/buy/",
            typeLabel: "실전 케이스",
            time: "5분 · 데이터",
            title: "Nomad List — 한 명, 단일 SQLite, 연간 반복 매출 $1.5M",
            original: "Pieter Levels (@levelsio) · 2014-현재 · public revenue dashboard",
            quote: "React, Postgres, Redis, Kubernetes 없이 PHP 파일 하나와 SQLite로 혼자 $1.5M/year를 만든다는 사례입니다.",
            takeLead: "스택은 방어력이 아니다",
            takeBody: "인프라 집착을 버리세요. 고객 후보인 1인 개발자가 가장 자주 잃는 시간은 올바른 스택 고민입니다. 방어력은 고객과의 거리입니다.",
            applyWhen: "Day 8-17",
            values: [.constraint, .adaptive],
            type: .sourceCase,
            sourceTone: .sky,
            isPinned: false,
            isDefaultSaved: false,
            isApplied: false
        ),
        .init(
            id: "small-bets",
            sectionID: "constraint",
            sourceMark: "DV",
            source: "dvassallo.com",
            typeLabel: "에세이",
            time: "11분",
            title: "Small Bets — 큰 한 방 대신 10개의 작은 베팅",
            original: "Daniel Vassallo · ex-AWS · Small Bets 커뮤니티",
            quote: nil,
            takeLead: "번호 게임",
            takeBody: "첫 3개 프로덕트를 다 실패하는 건 정상입니다. 10개를 30일 단위로 시도하면 1개는 의외로 되는 신호가 나옵니다.",
            applyWhen: "Day 7",
            values: [.constraint, .adaptive, .numbers],
            type: .sourceEssay,
            sourceTone: .amber,
            isPinned: false,
            isDefaultSaved: false,
            isApplied: false
        ),
        .init(
            id: "levels-bip",
            sectionID: "ship",
            sourceMark: "LV",
            source: "levels.io",
            typeLabel: "에세이 + 강연",
            time: "12분",
            title: "Build in Public — 부끄러운 첫 버전이 정상이다",
            original: "Pieter Levels · @levelsio · 2017 · \"Make the book\"",
            quote: nil,
            takeLead: "왜 공개하는가",
            takeBody: "공개하면 예상치 못한 잠재 고객이 알아서 찾아옵니다. Threads 첫 포스트, 부끄러워도 오늘 올리세요.",
            applyWhen: "Day 6 · Day 15 · Day 18+",
            values: [.ship, .alone],
            type: .sourceEssay,
            sourceTone: .sky,
            isPinned: false,
            isDefaultSaved: false,
            isApplied: false
        ),
        .init(
            id: "naval",
            sectionID: "ship",
            sourceMark: "NR",
            source: "nav.al",
            typeLabel: "트위터 스레드 + 팟캐스트",
            time: "30분",
            title: "How to Get Rich (without getting lucky) — 레버리지 4가지",
            original: "Naval Ravikant · AngelList · 2018-05-31 thread",
            quote: nil,
            takeLead: "1인 개발자의 레버리지",
            takeBody: "코드와 미디어는 0의 한계비용이고 1인 개발자가 동시에 굴릴 수 있는 유일한 두 가지입니다. 공개 기록은 부가가 아니라 필수 지렛대입니다.",
            applyWhen: "Day 18-30",
            values: [.ship, .constraint],
            type: .sourceEssay,
            sourceTone: .muted,
            isPinned: false,
            isDefaultSaved: false,
            isApplied: false
        ),
        .init(
            id: "threads-challenge",
            sectionID: "ship",
            sourceMark: "IH",
            source: "indiehackers.com/post",
            typeLabel: "실전 케이스",
            time: "9분",
            title: "Threads 공개 기록 30일 챌린지 — 0 follower → 첫 사용자 12명",
            original: "Indie Hackers community submission · 2025-Q1",
            quote: nil,
            takeLead: "참고 곡선",
            takeBody: "Day 1-10은 반응 0. Day 18 임팩트 포스트 1개로 첫 사용자 12명. 10일간 반응 없어도 정상이라는 외부 증거입니다.",
            applyWhen: "Day 15 · Day 18+",
            values: [.ship, .customer],
            type: .sourceCase,
            sourceTone: .accent,
            isPinned: false,
            isDefaultSaved: false,
            isApplied: false
        ),
        .init(
            id: "pmf-survey",
            sectionID: "numbers",
            sourceMark: "LR",
            source: "lennysnewsletter.com",
            typeLabel: "리서치",
            time: "10분",
            title: "Sean Ellis 시장 적합 설문 — 40% 룰의 실제 데이터",
            original: "Lenny Rachitsky · 2022 · 230개 스타트업 분석",
            quote: "제품을 더 이상 쓸 수 없으면 매우 실망할 사용자가 40% 이상이면 시장 적합 신호가 있다는 단일 질문 프레임입니다.",
            takeLead: "측정 가능한 시장 적합 기준",
            takeBody: "시장 적합 기준이 막연하다면 이 질문 하나로 측정하세요. Day 30 사용자 100명이면 50명에게 보내고 40% 이상이 매우 실망이면 계속 진행입니다.",
            applyWhen: "Day 25-30",
            values: [.numbers],
            type: .sourceEssay,
            sourceTone: .violet,
            isPinned: false,
            isDefaultSaved: false,
            isApplied: false
        ),
        .init(
            id: "patio11",
            sectionID: "numbers",
            sourceMark: "P11",
            source: "kalzumeus.com",
            typeLabel: "에세이",
            time: "18분",
            title: "Don't Call Yourself a Programmer (가격을 5x로 부르는 법)",
            original: "Patrick McKenzie (patio11) · Stripe Atlas",
            quote: nil,
            takeLead: "가격은 정체성",
            takeBody: "같은 코드를 비즈니스 결과물로 포지셔닝하면 가격 기준이 달라집니다. 고객 후보가 저축 소진 중이라면 가격이 모든 결정의 시작입니다.",
            applyWhen: "Day 22-24",
            values: [.numbers, .adaptive],
            type: .sourceEssay,
            sourceTone: .rose,
            isPinned: false,
            isDefaultSaved: false,
            isApplied: false
        ),
        .init(
            id: "async-feedback",
            sectionID: "alone",
            sourceMark: "PH",
            source: "posthog.com/handbook",
            typeLabel: "핸드북",
            time: "14분",
            title: "How we run async feedback loops at PostHog",
            original: "PostHog Handbook · Engineering values",
            quote: nil,
            takeLead: "1인이라도 가능한 교정",
            takeBody: "팀이 없어도 내 결정을 7일 뒤에 다시 보는 의식을 만들 수 있습니다. What did I assume? What evidence did I get? What changed?",
            applyWhen: "매주",
            values: [.alone, .customer],
            type: .sourceEssay,
            sourceTone: .teal,
            isPinned: false,
            isDefaultSaved: false,
            isApplied: false
        ),
        .init(
            id: "founder-bias",
            sectionID: "alone",
            sourceMark: "YC",
            source: "ycombinator.com",
            typeLabel: "강연",
            time: "22분",
            title: "The Founder's Bias — 왜 본인 제품은 항상 좋아 보이는가",
            original: "Michael Seibel · YC Group Partner · Startup School 2023",
            quote: nil,
            takeLead: "자기 진단 체크",
            takeBody: "마지막으로 틀렸다고 인정한 때가 언제인지, 나와 다르게 생각하는 사람과 30분 통화한 게 최근 7일 안에 있었는지 확인하세요.",
            applyWhen: "매주 회고",
            values: [.alone, .ship],
            type: .sourceTalk,
            sourceTone: .sky,
            isPinned: false,
            isDefaultSaved: false,
            isApplied: false
        ),
    ]

    static let coverage: [OpenDesignNewsCoverage] = [
        .init(id: .constraint, title: "제약이 실력이다", count: "4 / 14", progress: 0.50, tone: .amber),
        .init(id: .customer, title: "고객이 먼저다", count: "6 / 14", progress: 0.75, tone: .accent),
        .init(id: .ship, title: "불완전해도 공개", count: "3 / 14", progress: 0.38, tone: .sky),
        .init(id: .numbers, title: "숫자로 결정", count: "4 / 14", progress: 0.50, tone: .rose),
        .init(id: .alone, title: "고립되지 마라", count: "2 / 14", progress: 0.25, tone: .violet),
        .init(id: .adaptive, title: "맞춤형이 일반형보다 낫다", count: "3 / 14", progress: 0.38, tone: .teal),
    ]

    static let recommendations: [OpenDesignNewsRecommendation] = [
        .init(id: "r1", rank: "01", title: "The Mom Test — 엄마도 거짓말한다", meta: "고객 · 22분 · 인터뷰 직전", tone: .accent),
        .init(id: "r2", rank: "02", title: "YC — How to Talk to Users", meta: "고객 · 32분 · 3개 질문 템플릿", tone: .sky),
        .init(id: "r3", rank: "03", title: "PostHog — Downstream of ICP", meta: "맞춤 · 8분 · 고객 후보 정의 직전", tone: .teal),
    ]

    static let sources: [OpenDesignNewsSource] = [
        .init(id: "ph", mark: "PH", title: "posthog.com / handbook", count: "3", isSubscribed: false, tone: .teal),
        .init(id: "pg", mark: "PG", title: "paulgraham.com", count: "2", isSubscribed: false, tone: .amber),
        .init(id: "yc", mark: "YC", title: "ycombinator.com / library", count: "2", isSubscribed: false, tone: .sky),
        .init(id: "lr", mark: "LR", title: "lennysnewsletter.com", count: "1", isSubscribed: true, tone: .violet),
        .init(id: "ih", mark: "IH", title: "indiehackers.com", count: "2", isSubscribed: false, tone: .accent),
        .init(id: "lv", mark: "LV", title: "levels.io", count: "2", isSubscribed: false, tone: .sky),
        .init(id: "add", mark: "+", title: "출처 추가 (RSS · OPML)", count: nil, isSubscribed: false, tone: .accent),
    ]
}

private struct OpenDesignBipLogShell: View {
    let layout: OpenDesignDayLayoutMetrics
    let openSearch: () -> Void
    let snapshot: BipResearchSnapshot
    let refresh: () -> Void
    let prepare: () -> Void
    let openSettings: () -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var selectedFilter: OpenDesignBipFilter = .all
    @State private var searchQuery = ""
    @State private var selectedCandidateID: String?

    private var candidates: [OpenDesignBipCandidate] {
        snapshot.candidates.map { OpenDesignBipCandidate(researchCandidate: $0) }
    }

    private var visibleCandidates: [OpenDesignBipCandidate] {
        let query = searchQuery.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return candidates.filter { candidate in
            let filterMatch = selectedFilter == .all || candidate.filters.contains(selectedFilter)
            guard filterMatch else { return false }
            guard !query.isEmpty else { return true }
            return candidate.title.lowercased().contains(query)
                || candidate.source.lowercased().contains(query)
                || candidate.medium.lowercased().contains(query)
                || candidate.tags.contains { $0.title.lowercased().contains(query) }
        }
    }

    private var selectedCandidate: OpenDesignBipCandidate? {
        guard let selectedCandidateID else { return nil }
        return candidates.first { $0.id == selectedCandidateID }
    }

    var body: some View {
        Group {
            if layout.showsTaskSidebar {
                ZStack {
                    OpenDesignBipSidebarView(
                        snapshot: snapshot,
                        candidates: candidates,
                        selectedFilter: selectedFilter,
                        count: count(for:),
                        selectFilter: selectFilter(_:)
                    )
                    Color.clear
                        .accessibilityElement(children: .ignore)
                    .accessibilityLabel("OpenDesign 공개 기록 사이드")
                        .accessibilityIdentifier("opendesign.reference.bipLog.side")
                        .allowsHitTesting(false)
                }
                .frame(width: layout.taskSidebarWidth)
                .frame(maxHeight: .infinity)
                .background(OpenDesignDayColor.bg)
                .transition(.opacity)
            }

            ZStack {
                OpenDesignBipMainView(
                    layout: layout,
                    snapshot: snapshot,
                    selectedFilter: selectedFilter,
                    searchQuery: $searchQuery,
                    selectedCandidateID: $selectedCandidateID,
                    selectedCandidate: selectedCandidate,
                    visibleCandidates: visibleCandidates,
                    count: count(for:),
                    selectFilter: selectFilter(_:),
                    openSearch: openSearch,
                    refresh: refresh,
                    openSettings: openSettings
                )
                Color.clear
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel("OpenDesign 공개 기록 메인")
                    .accessibilityIdentifier("opendesign.reference.bipLog.main")
                    .allowsHitTesting(false)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .background(OpenDesignDayColor.bg)
        .onAppear(perform: prepare)
        .onChange(of: snapshot.candidates.map(\.id)) { _, ids in
            if let selectedCandidateID,
               ids.contains(selectedCandidateID) {
                return
            }
            selectedCandidateID = ids.first
        }
    }

    private func selectFilter(_ filter: OpenDesignBipFilter) {
        withAnimation(.easeOut(duration: reduceMotion ? 0 : 0.12)) {
            selectedFilter = filter
        }
    }

    private func count(for filter: OpenDesignBipFilter) -> Int {
        candidates.filter { candidate in
            filter == .all || candidate.filters.contains(filter)
        }.count
    }
}

struct OpenDesignBipVisibility: Equatable {
    let isLoadingEmpty: Bool
    let showsFilterBar: Bool
    let showsResearchSection: Bool
    let showsDraftSection: Bool
    let showsSidebarSourceFilters: Bool
    let showsFallbackSignals: Bool
    let showsSidebarSignalSection: Bool
}

func openDesignBipVisibility(for snapshot: BipResearchSnapshot) -> OpenDesignBipVisibility {
    let isLoadingEmpty = snapshot.status.isRefreshing && snapshot.candidates.isEmpty
    let hasActualSignals = !snapshot.signals.isEmpty
    let showsFallbackSignals = !hasActualSignals && !isLoadingEmpty

    return OpenDesignBipVisibility(
        isLoadingEmpty: isLoadingEmpty,
        showsFilterBar: !isLoadingEmpty,
        showsResearchSection: !isLoadingEmpty,
        showsDraftSection: !isLoadingEmpty,
        showsSidebarSourceFilters: !isLoadingEmpty,
        showsFallbackSignals: showsFallbackSignals,
        showsSidebarSignalSection: hasActualSignals || showsFallbackSignals
    )
}

private struct OpenDesignBipSidebarView: View {
    let snapshot: BipResearchSnapshot
    let candidates: [OpenDesignBipCandidate]
    let selectedFilter: OpenDesignBipFilter
    let count: (OpenDesignBipFilter) -> Int
    let selectFilter: (OpenDesignBipFilter) -> Void

    private var visibility: OpenDesignBipVisibility {
        openDesignBipVisibility(for: snapshot)
    }

    private var sourceRows: [(filter: OpenDesignBipFilter, title: String, count: String, systemImage: String)] {
        [
            (.all, "전체", "\(count(.all))", "square.grid.2x2"),
            (.strong, "강한 적합", "\(count(.strong))", "checkmark.circle"),
            (.x, "X / Twitter", "\(count(.x))", "xmark"),
            (.threads, "Threads (Meta)", "\(count(.threads))", "at"),
            (.instagram, "Instagram", "\(count(.instagram))", "camera"),
            (.needs, "워치리스트", "\(count(.needs))", "exclamationmark.triangle"),
        ]
    }

    private var signals: [OpenDesignBipSignal] {
        if !snapshot.signals.isEmpty {
            return snapshot.signals.map { OpenDesignBipSignal(researchSignal: $0) }
        }
        guard visibility.showsFallbackSignals else { return [] }
        return [
            .init(id: "social", title: "공개 소셜 기록", subtitle: "리서치 대기", state: "idle", tone: .muted),
            .init(id: "gap", title: "확인할 공백", subtitle: "전업 · 매출 · 인터뷰", state: "ask", tone: .amber),
        ]
    }

    var body: some View {
        VStack(spacing: 0) {
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    if visibility.showsSidebarSourceFilters {
                        OpenDesignBipSidebarSection(title: "소스", count: "\(sourceRows.count)") {
                            ForEach(sourceRows, id: \.filter) { row in
                                OpenDesignBipSourceRow(
                                    title: row.title,
                                    count: row.count,
                                    systemImage: row.systemImage,
                                    tone: row.filter.tone,
                                    isActive: selectedFilter == row.filter,
                                    action: { selectFilter(row.filter) }
                                )
                            }
                        }
                    }

                    if visibility.showsSidebarSignalSection {
                        OpenDesignBipSidebarSection(title: "고객 후보 신호", count: "\(signals.count)") {
                            ForEach(signals) { signal in
                                OpenDesignBipSignalRow(signal: signal)
                            }
                        }
                    }
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 12)
            }

            OpenDesignBipSidebarProgress(
                candidateCount: candidates.count,
                targetCount: snapshot.candidateTargetCount ?? 18
            )
        }
        .background(OpenDesignDayColor.bg)
        .overlay(Rectangle().fill(OpenDesignDayColor.borderSoft).frame(width: 1), alignment: .trailing)
    }
}

private struct OpenDesignBipSidebarSection<Content: View>: View {
    let title: String
    let count: String
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text(title)
                Spacer()
                Text(count)
            }
            .font(.system(size: 10, weight: .medium, design: .monospaced))
            .textCase(.uppercase)
            .foregroundStyle(OpenDesignDayColor.mutedDeep)
            .padding(.horizontal, 4)
            .padding(.top, 8)
            .padding(.bottom, 7)

            content
        }
        .padding(.bottom, 8)
    }
}

private struct OpenDesignBipSourceRow: View {
    let title: String
    let count: String
    let systemImage: String
    let tone: OpenDesignReferenceTone
    let isActive: Bool
    let action: () -> Void

    @State private var isHovered = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: 10) {
                Image(systemName: systemImage)
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(isActive ? tone.color : OpenDesignDayColor.muted)
                    .frame(width: 22, height: 22)
                    .background(referenceRounded(fill: isActive ? tone.dim : OpenDesignDayColor.surface, stroke: isActive ? tone.line : OpenDesignDayColor.borderSoft, radius: 6))
                Text(title)
                    .font(.system(size: 12.5, weight: .medium))
                    .foregroundStyle(isActive || isHovered ? OpenDesignDayColor.fg : OpenDesignDayColor.fgSecondary)
                    .lineLimit(1)
                Spacer(minLength: 6)
                Text(count)
                    .font(.system(size: 11, weight: .medium, design: .monospaced))
                    .foregroundStyle(isActive ? tone.color : OpenDesignDayColor.muted)
            }
            .padding(.horizontal, 10)
            .frame(height: 36)
            .background(referenceRounded(fill: isActive ? OpenDesignDayColor.selected : isHovered ? OpenDesignDayColor.surface2 : Color.clear, stroke: Color.clear, radius: 6))
        }
        .buttonStyle(.plain)
        .onHover { isHovered = $0 }
        .accessibilityLabel(title)
        .accessibilityValue(isActive ? "active" : "\(count)건")
    }
}

private struct OpenDesignBipSignalRow: View {
    let signal: OpenDesignBipSignal
    @State private var isHovered = false

    var body: some View {
        HStack(alignment: .center, spacing: 8) {
            VStack(alignment: .leading, spacing: 3) {
                Text(signal.title)
                    .font(.system(size: 12.5, weight: .medium))
                    .foregroundStyle(OpenDesignDayColor.fg)
                    .lineLimit(1)
                Text(signal.subtitle)
                    .font(.system(size: 10.5, weight: .medium, design: .monospaced))
                    .foregroundStyle(OpenDesignDayColor.muted)
                    .lineLimit(1)
            }
            Spacer(minLength: 8)
            Text(signal.state)
                .font(.system(size: 9.5, weight: .medium, design: .monospaced))
                .textCase(.uppercase)
                .foregroundStyle(signal.tone.color)
                .padding(.horizontal, 7)
                .frame(height: 19)
                .background(Capsule().fill(signal.tone.dim).overlay(Capsule().stroke(signal.tone.line, lineWidth: 1)))
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .background(referenceRounded(fill: isHovered ? OpenDesignDayColor.surface2 : Color.clear, stroke: Color.clear, radius: 6))
        .onHover { isHovered = $0 }
        .accessibilityElement(children: .combine)
    }
}

private struct OpenDesignBipSidebarProgress: View {
    let candidateCount: Int
    let targetCount: Int

    private var progress: CGFloat {
        guard targetCount > 0 else { return 0 }
        return min(1, CGFloat(candidateCount) / CGFloat(targetCount))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 9) {
            HStack(alignment: .firstTextBaseline) {
                Text("고객 후보")
                    .font(.system(size: 10, weight: .medium, design: .monospaced))
                    .textCase(.uppercase)
                    .foregroundStyle(OpenDesignDayColor.muted)
                Spacer()
                HStack(alignment: .firstTextBaseline, spacing: 2) {
                    Text("\(candidateCount)")
                        .font(.system(size: 17, weight: .semibold, design: .monospaced))
                        .foregroundStyle(OpenDesignDayColor.fg)
                    Text("/ \(max(targetCount, 1))")
                        .font(.system(size: 11, weight: .regular, design: .monospaced))
                        .foregroundStyle(OpenDesignDayColor.mutedDeep)
                }
            }

            GeometryReader { proxy in
                ZStack(alignment: .leading) {
                    Capsule()
                        .fill(OpenDesignDayColor.bgDeep)
                        .overlay(Capsule().stroke(OpenDesignDayColor.borderSoft, lineWidth: 1))
                    Capsule()
                        .fill(OpenDesignDayColor.accent)
                        .frame(width: max(0, proxy.size.width * progress))
                }
            }
            .frame(height: 5)

            HStack(spacing: 6) {
                Circle()
                    .fill(OpenDesignDayColor.amber)
                    .frame(width: 5, height: 5)
                Text("다음 액션")
                    .foregroundStyle(OpenDesignDayColor.muted)
                Text(candidateCount > 0 ? "상위 후보" : "리서치 대기")
                    .foregroundStyle(OpenDesignDayColor.fgSecondary)
                Text(candidateCount > 0 ? "· DM 후보화" : "· 웹 검색 설정 필요")
                    .foregroundStyle(OpenDesignDayColor.muted)
            }
            .font(.system(size: 10.5, weight: .medium, design: .monospaced))
        }
        .padding(.horizontal, 16)
        .padding(.top, 12)
        .padding(.bottom, 14)
        .background(OpenDesignDayColor.bg)
        .overlay(Rectangle().fill(OpenDesignDayColor.borderSoft).frame(height: 1), alignment: .top)
    }
}

private struct OpenDesignBipMainView: View {
    let layout: OpenDesignDayLayoutMetrics
    let snapshot: BipResearchSnapshot
    let selectedFilter: OpenDesignBipFilter
    @Binding var searchQuery: String
    @Binding var selectedCandidateID: String?
    let selectedCandidate: OpenDesignBipCandidate?
    let visibleCandidates: [OpenDesignBipCandidate]
    let count: (OpenDesignBipFilter) -> Int
    let selectFilter: (OpenDesignBipFilter) -> Void
    let openSearch: () -> Void
    let refresh: () -> Void
    let openSettings: () -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var visibility: OpenDesignBipVisibility {
        openDesignBipVisibility(for: snapshot)
    }

    var body: some View {
        VStack(spacing: 0) {
            OpenDesignBipHeaderView(
                horizontalPadding: layout.mainHorizontalPadding,
                snapshot: snapshot,
                openSearch: openSearch,
                refresh: refresh
            )

            if visibility.showsFilterBar {
                OpenDesignBipFilterBar(
                    selectedFilter: selectedFilter,
                    searchQuery: $searchQuery,
                    horizontalPadding: layout.mainHorizontalPadding,
                    count: count,
                    selectFilter: selectFilter
                )
            }

            ScrollViewReader { proxy in
                ScrollView {
                    VStack(alignment: .leading, spacing: 0) {
                        OpenDesignBipSectionHeader(
                            title: "고객 후보 리서치 큐",
                            meta: "Day \(snapshot.dayNumber) · \(snapshot.statusLabel)",
                            tone: .accent
                        )
                        .padding(.top, 4)
                        .padding(.bottom, 14)

                        OpenDesignBipBriefCard(snapshot: snapshot)
                            .padding(.bottom, 14)
                            .accessibilityIdentifier("opendesign.reference.bipLog.brief")

                        if snapshot.status.isRefreshing {
                            OpenDesignBipProgressState(status: snapshot.status)
                                .padding(.bottom, 14)
                        }

                        if snapshot.status.needsExaConfiguration,
                           snapshot.candidates.isEmpty {
                            OpenDesignBipNoExaRouteState(openSettings: openSettings)
                                .padding(.bottom, 14)
                        }

                        if visibility.showsResearchSection {
                            HStack(alignment: .center, spacing: 10) {
                                OpenDesignBipSectionHeader(
                                    title: "리서치된 게시글",
                                    meta: "원문 하이라이트 + 고객 후보 근거",
                                    tone: .sky
                                )
                                Spacer(minLength: 10)
                                HStack(spacing: 2) {
                                    Text("정렬")
                                        .foregroundStyle(OpenDesignDayColor.muted)
                                    Text("고객 후보 적합도순")
                                        .fontWeight(.semibold)
                                        .foregroundStyle(OpenDesignDayColor.fgSecondary)
                                }
                                .font(.system(size: 10.5, weight: .medium, design: .monospaced))
                            }
                            .padding(.bottom, 12)

                            VStack(spacing: 12) {
                                ForEach(visibleCandidates) { candidate in
                                    OpenDesignBipCandidateCard(
                                        candidate: candidate,
                                        isSelected: selectedCandidateID == candidate.id,
                                        select: {
                                            withAnimation(.easeOut(duration: reduceMotion ? 0 : 0.16)) {
                                                selectedCandidateID = candidate.id
                                                proxy.scrollTo("bip-draft", anchor: .top)
                                            }
                                        }
                                    )
                                    .accessibilityIdentifier("opendesign.reference.bipLog.candidate.\(candidate.id)")
                                }
                            }

                            if visibleCandidates.isEmpty,
                               !snapshot.status.isRefreshing,
                               !snapshot.status.needsExaConfiguration {
                                OpenDesignBipEmptyState(refresh: refresh)
                            }
                        }

                        if visibility.showsDraftSection {
                            OpenDesignBipSectionHeader(
                                title: "공개 기록 초안",
                                meta: "선택 후보를 기반으로 자동 생성",
                                tone: .amber
                            )
                            .padding(.top, 28)
                            .padding(.bottom, 14)
                            .id("bip-draft")

                            OpenDesignBipDraftPanel(
                                selectedCandidate: selectedCandidate,
                                clearSelection: { selectedCandidateID = nil }
                            )
                            .accessibilityIdentifier("opendesign.reference.bipLog.draft")
                        }
                    }
                    .frame(maxWidth: 980, alignment: .leading)
                    .padding(.horizontal, layout.mainHorizontalPadding)
                    .padding(.top, 24)
                    .padding(.bottom, 40)
                    .frame(maxWidth: .infinity)
                }
                .background(OpenDesignDayColor.bg)
                .accessibilityIdentifier("opendesign.reference.bipLog.main.scroll")
            }
        }
        .background(OpenDesignDayColor.bg)
    }
}

private struct OpenDesignBipHeaderView: View {
    let horizontalPadding: CGFloat
    let snapshot: BipResearchSnapshot
    let openSearch: () -> Void
    let refresh: () -> Void

    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 12) {
                identity
                Spacer(minLength: 12)
                actions
            }

            VStack(alignment: .leading, spacing: 10) {
                identity
                actions
            }
        }
        .padding(.horizontal, horizontalPadding)
        .padding(.vertical, 12)
        .frame(minHeight: 70)
        .background(OpenDesignDayColor.bg)
        .overlay(Rectangle().fill(OpenDesignDayColor.borderSoft).frame(height: 1), alignment: .bottom)
    }

    private var identity: some View {
        HStack(spacing: 14) {
            Image(systemName: "doc.text")
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(OpenDesignDayColor.accent)
                .frame(width: 44, height: 44)
                .background(referenceRounded(fill: OpenDesignDayColor.accentDim, stroke: OpenDesignDayColor.accentLine, radius: 11))

            VStack(alignment: .leading, spacing: 3) {
                Text("공개 기록 · 고객 후보 리서치")
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(OpenDesignDayColor.fg)
                    .lineLimit(1)
                FlowLayout(spacing: 8, lineSpacing: 3) {
                    Circle()
                        .fill(OpenDesignDayColor.accent)
                        .frame(width: 5, height: 5)
                    headerMeta("웹 자료 검색 + 원문 확인 · 후보 \(snapshot.candidateCount)명")
                    headerSeparator
                    headerMeta("Day \(snapshot.dayNumber) · \(snapshot.status.researchSource ?? snapshot.statusLabel)")
                }
            }
        }
    }

    private var actions: some View {
        HStack(spacing: 6) {
            OpenDesignBipHeaderButton(title: "초안", systemImage: "doc.text", tone: .ghost, action: openSearch)
            OpenDesignBipHeaderButton(title: "다시 리서치", systemImage: "arrow.clockwise", tone: .accent, action: refresh)
        }
    }

    private func headerMeta(_ text: String) -> some View {
        Text(text)
            .font(.system(size: 11, weight: .medium, design: .monospaced))
            .foregroundStyle(OpenDesignDayColor.muted)
            .lineLimit(1)
    }

    private var headerSeparator: some View {
        Circle()
            .fill(OpenDesignDayColor.mutedDeep)
            .frame(width: 4, height: 4)
    }
}

private struct OpenDesignBipHeaderButton: View {
    enum Tone { case ghost, accent }

    let title: String
    let systemImage: String
    let tone: Tone
    let action: () -> Void

    @State private var isHovered = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                Image(systemName: systemImage)
                    .font(.system(size: 11, weight: .semibold))
                Text(title)
            }
            .font(.system(size: 12, weight: tone == .accent ? .semibold : .medium))
            .foregroundStyle(tone == .accent ? OpenDesignDayColor.bgDeep : isHovered ? OpenDesignDayColor.fg : OpenDesignDayColor.fgSecondary)
            .padding(.horizontal, tone == .accent ? 14 : 12)
            .frame(height: 30)
            .background(
                referenceRounded(
                    fill: tone == .accent ? (isHovered ? OpenDesignDayColor.accentStrong : OpenDesignDayColor.accent) : (isHovered ? OpenDesignDayColor.surface2 : Color.clear),
                    stroke: tone == .accent ? OpenDesignDayColor.accent : OpenDesignDayColor.borderSoft,
                    radius: 8
                )
            )
        }
        .buttonStyle(.plain)
        .onHover { isHovered = $0 }
        .accessibilityLabel(title)
    }
}

private struct OpenDesignBipFilterBar: View {
    let selectedFilter: OpenDesignBipFilter
    @Binding var searchQuery: String
    let horizontalPadding: CGFloat
    let count: (OpenDesignBipFilter) -> Int
    let selectFilter: (OpenDesignBipFilter) -> Void

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                ForEach(OpenDesignBipFilter.allCases) { filter in
                    OpenDesignBipFilterButton(
                        filter: filter,
                        count: count(filter),
                        isActive: selectedFilter == filter,
                        action: { selectFilter(filter) }
                    )
                }

                Spacer(minLength: 16)

                HStack(spacing: 8) {
                    Image(systemName: "magnifyingglass")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(OpenDesignDayColor.muted)
                    TextField("고객 후보 증거 검색", text: $searchQuery)
                        .textFieldStyle(.plain)
                        .font(.system(size: 11.5, weight: .medium))
                        .foregroundStyle(OpenDesignDayColor.fg)
                        .frame(width: 150)
                        .accessibilityIdentifier("opendesign.reference.bipLog.search")
                }
                .padding(.horizontal, 10)
                .frame(height: 30)
                .background(referenceRounded(fill: OpenDesignDayColor.surface, stroke: OpenDesignDayColor.borderSoft, radius: 6))
            }
            .padding(.horizontal, horizontalPadding)
            .frame(minHeight: 52)
        }
        .background(OpenDesignDayColor.bg)
        .overlay(Rectangle().fill(OpenDesignDayColor.borderSoft).frame(height: 1), alignment: .bottom)
    }
}

private struct OpenDesignBipFilterButton: View {
    let filter: OpenDesignBipFilter
    let count: Int
    let isActive: Bool
    let action: () -> Void

    @State private var isHovered = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                Text(filter.title)
                Text("\(count)")
                    .foregroundStyle(isActive ? filter.tone.color : OpenDesignDayColor.mutedDeep)
            }
            .font(.system(size: 11, weight: .medium, design: .monospaced))
            .foregroundStyle(isActive ? filter.tone.color : isHovered ? OpenDesignDayColor.fg : OpenDesignDayColor.muted)
            .padding(.horizontal, 12)
            .frame(height: 28)
            .background(Capsule().fill(isActive ? filter.tone.dim : isHovered ? OpenDesignDayColor.surface2 : Color.clear))
            .overlay(Capsule().stroke(isActive ? filter.tone.line : Color.clear, lineWidth: 1))
        }
        .buttonStyle(.plain)
        .onHover { isHovered = $0 }
        .accessibilityLabel(filter.title)
        .accessibilityValue(isActive ? "active" : "\(count)건")
    }
}

private struct OpenDesignBipSectionHeader: View {
    let title: String
    let meta: String
    let tone: OpenDesignReferenceTone

    var body: some View {
        HStack(spacing: 10) {
            RoundedRectangle(cornerRadius: 2, style: .continuous)
                .fill(tone.color)
                .frame(width: 4, height: 12)
            Text(title)
                .font(.system(size: 11, weight: .medium, design: .monospaced))
                .textCase(.uppercase)
                .foregroundStyle(OpenDesignDayColor.muted)
            Text(meta)
                .font(.system(size: 10.5, weight: .medium, design: .monospaced))
                .foregroundStyle(OpenDesignDayColor.mutedDeep)
                .lineLimit(1)
            Rectangle()
                .fill(OpenDesignDayColor.borderSoft)
                .frame(height: 1)
        }
    }
}

private struct OpenDesignBipBriefCard: View {
    let snapshot: BipResearchSnapshot

    private var strongCount: Int {
        snapshot.candidates.filter { $0.evidenceStrength == "strong" }.count
    }

    private var watchCount: Int {
        max(0, snapshot.candidates.count - strongCount)
    }

    private var xCount: Int {
        snapshot.candidates.filter { ["x", "twitter"].contains(($0.sourceType ?? "").lowercased()) }.count
    }

    private var threadsCount: Int {
        snapshot.candidates.filter { ($0.sourceType ?? "").lowercased() == "threads" }.count
    }

    private var instagramCount: Int {
        snapshot.candidates.filter { ($0.sourceType ?? "").lowercased() == "instagram" }.count
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 13) {
            HStack(alignment: .top, spacing: 18) {
                VStack(alignment: .leading, spacing: 7) {
                    Text("자동 리서치")
                        .font(.system(size: 10, weight: .medium, design: .monospaced))
                        .textCase(.uppercase)
                        .foregroundStyle(OpenDesignDayColor.accent)
                    Text(snapshot.briefTitle ?? "공개 소셜 게시글에서 고객 후보 신호를 찾습니다.")
                        .font(.system(size: 20, weight: .regular))
                        .foregroundStyle(OpenDesignDayColor.fg)
                        .lineSpacing(2)
                        .fixedSize(horizontal: false, vertical: true)
                    Text(snapshot.briefBody ?? "웹 자료 검색 결과를 원문 확인으로 다시 읽고 실제 원문 URL이 있는 후보만 표시합니다.")
                        .font(.system(size: 13, weight: .regular))
                        .foregroundStyle(OpenDesignDayColor.fgSecondary)
                        .lineSpacing(4)
                        .fixedSize(horizontal: false, vertical: true)
                }

                VStack(alignment: .trailing, spacing: 5) {
                    Text("후보")
                    Text("\(snapshot.candidateCount)")
                        .font(.system(size: 18, weight: .semibold))
                        .foregroundStyle(OpenDesignDayColor.fg)
                    Text("강한 적합 \(strongCount) · 관심 후보 \(watchCount)")
                }
                .font(.system(size: 10.5, weight: .medium, design: .monospaced))
                .foregroundStyle(OpenDesignDayColor.muted)
                .frame(minWidth: 170, alignment: .trailing)
            }

            HStack(alignment: .top, spacing: 9) {
                Text("exa>")
                    .foregroundStyle(OpenDesignDayColor.accent)
                Text(snapshot.querySummary?.isEmpty == false ? snapshot.querySummary! : "상황 맞춤 소셜 리서치 검색어")
                    .foregroundStyle(OpenDesignDayColor.fgSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .font(.system(size: 11, weight: .medium, design: .monospaced))
            .lineSpacing(4)
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(referenceRounded(fill: OpenDesignDayColor.bgDeep, stroke: OpenDesignDayColor.borderSoft, radius: 8))

            FlowLayout(spacing: 7, lineSpacing: 7) {
                OpenDesignBipMetricPill(title: "X 원문", count: "\(xCount)", tone: .sky)
                OpenDesignBipMetricPill(title: "Threads(Meta) 원문", count: "\(threadsCount)", tone: .violet)
                OpenDesignBipMetricPill(title: "Instagram 원문", count: "\(instagramCount)", tone: .pink)
                OpenDesignBipMetricPill(title: "강한 적합", count: "\(strongCount)", tone: .accent)
                OpenDesignBipMetricPill(title: "확인 필요", count: "\(watchCount)", tone: .amber)
                OpenDesignBipMetricPill(title: "Day", count: "\(snapshot.dayNumber)", tone: .muted)
            }
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(OpenDesignDayColor.surface)
                .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(OpenDesignDayColor.border, lineWidth: 1))
                .overlay(alignment: .top) {
                    LinearGradient(
                        colors: [Color.clear, OpenDesignDayColor.accentLine, Color.clear],
                        startPoint: .leading,
                        endPoint: .trailing
                    )
                    .frame(height: 1)
                }
        )
    }
}

private struct OpenDesignBipMetricPill: View {
    let title: String
    let count: String
    let tone: OpenDesignReferenceTone

    var body: some View {
        HStack(spacing: 6) {
            Text(title)
            Text(count)
                .fontWeight(.semibold)
                .foregroundStyle(tone == .muted ? OpenDesignDayColor.fg : tone.color)
        }
        .font(.system(size: 10.5, weight: .medium, design: .monospaced))
        .foregroundStyle(tone == .muted ? OpenDesignDayColor.fgSecondary : tone.color)
        .padding(.horizontal, 10)
        .frame(height: 25)
        .background(Capsule().fill(tone == .muted ? OpenDesignDayColor.bgDeep : tone.dim))
        .overlay(Capsule().stroke(tone == .muted ? OpenDesignDayColor.borderSoft : tone.line, lineWidth: 1))
    }
}

private struct OpenDesignBipProgressState: View {
    let status: BipResearchStatus

    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            ProgressView()
                .controlSize(.small)
                .tint(OpenDesignDayColor.accent)
            VStack(alignment: .leading, spacing: 4) {
                Text(status.progressText ?? "X/Threads 공개 게시글을 검색하는 중")
                    .font(.system(size: 12.5, weight: .semibold))
                    .foregroundStyle(OpenDesignDayColor.fg)
                Text(progressMeta)
                    .font(.system(size: 10.5, weight: .medium, design: .monospaced))
                    .foregroundStyle(OpenDesignDayColor.muted)
            }
            Spacer(minLength: 0)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(referenceRounded(fill: OpenDesignDayColor.accentDim, stroke: OpenDesignDayColor.accentLine, radius: 10))
    }

    private var progressMeta: String {
        let step = status.stepIndex.map { "\($0)" } ?? "?"
        let count = status.stepCount.map { "\($0)" } ?? "?"
        return "\(status.researchSource ?? "웹 검색 도구") · \(step)/\(count)"
    }
}

private struct OpenDesignBipNoExaRouteState: View {
    let openSettings: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("웹 검색 도구 설정이 필요합니다.")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(OpenDesignDayColor.fg)
            Text("공개 기록 리서치는 실제 X/Threads 검색과 원문 확인 결과만 표시합니다. Codex/Claude/Gemini의 웹 검색 도구 또는 Settings의 Exa 예비 키를 설정하세요.")
                .font(.system(size: 12.5, weight: .regular))
                .foregroundStyle(OpenDesignDayColor.fgSecondary)
                .lineSpacing(4)
            Button(action: openSettings) {
                Text("설정 열기")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(OpenDesignDayColor.bgDeep)
                    .padding(.horizontal, 12)
                    .frame(height: 30)
                    .background(referenceRounded(fill: OpenDesignDayColor.accent, stroke: OpenDesignDayColor.accent, radius: 8))
            }
            .buttonStyle(.plain)
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(referenceRounded(fill: OpenDesignDayColor.surface, stroke: OpenDesignDayColor.border, radius: 12))
    }
}

private struct OpenDesignBipEmptyState: View {
    let refresh: () -> Void

    var body: some View {
        VStack(spacing: 10) {
            Text("아직 표시할 공개 기록 후보가 없습니다.")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(OpenDesignDayColor.fg)
            Text("다시 리서치를 실행하면 오늘 Day와 프로젝트 문서 기준으로 X/Threads 후보를 새로 찾습니다.")
                .font(.system(size: 11.5, weight: .medium, design: .monospaced))
                .foregroundStyle(OpenDesignDayColor.muted)
                .multilineTextAlignment(.center)
            Button(action: refresh) {
                Text("다시 리서치")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(OpenDesignDayColor.accent)
                    .padding(.horizontal, 12)
                    .frame(height: 30)
                    .background(referenceRounded(fill: OpenDesignDayColor.accentDim, stroke: OpenDesignDayColor.accentLine, radius: 8))
            }
            .buttonStyle(.plain)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 26)
    }
}

private struct OpenDesignBipCandidateCard: View {
    let candidate: OpenDesignBipCandidate
    let isSelected: Bool
    let select: () -> Void

    @State private var isHovered = false

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            ViewThatFits(in: .horizontal) {
                HStack(alignment: .top, spacing: 14) {
                    score
                    titleBlock
                    Spacer(minLength: 12)
                    sourceBadge
                }

                VStack(alignment: .leading, spacing: 10) {
                    HStack(alignment: .top, spacing: 14) {
                        score
                        titleBlock
                    }
                    sourceBadge
                }
            }

            FlowLayout(spacing: 6, lineSpacing: 6) {
                ForEach(candidate.tags) { tag in
                    OpenDesignReferenceChipView(chip: tag, isActive: tag.tone == .accent)
                }
            }

            Text(candidate.quote)
                .font(.system(size: 13, weight: .regular))
                .lineSpacing(5)
                .padding(.horizontal, 14)
                .padding(.vertical, 13)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(
                    RoundedRectangle(cornerRadius: 9, style: .continuous)
                        .fill(OpenDesignDayColor.bgDeep)
                        .overlay(RoundedRectangle(cornerRadius: 9, style: .continuous).stroke(OpenDesignDayColor.borderSoft, lineWidth: 1))
                        .overlay(Rectangle().fill(candidate.tone.line).frame(width: 1), alignment: .leading)
                )

            ViewThatFits(in: .horizontal) {
                HStack(alignment: .top, spacing: 10) {
                    evidence(title: candidate.whyTitle, body: candidate.whyBody)
                    evidence(title: candidate.usageTitle, body: AttributedString(candidate.usageBody))
                }
                VStack(alignment: .leading, spacing: 10) {
                    evidence(title: candidate.whyTitle, body: candidate.whyBody)
                    evidence(title: candidate.usageTitle, body: AttributedString(candidate.usageBody))
                }
            }

            Text(candidate.gap)
                .font(.system(size: 12, weight: .regular))
                .lineSpacing(3)
                .padding(.horizontal, 11)
                .padding(.vertical, 9)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(referenceRounded(fill: OpenDesignDayColor.amberDim, stroke: OpenDesignDayColor.amberLine, radius: 8))

            HStack(spacing: 8) {
                Button(action: select) {
                    Text(isSelected ? "초안 반영됨" : "공개 기록 초안에 반영")
                        .font(.system(size: 11.5, weight: .medium))
                        .foregroundStyle(isSelected ? OpenDesignDayColor.bgDeep : OpenDesignDayColor.accent)
                        .padding(.horizontal, 11)
                        .frame(height: 28)
                        .background(referenceRounded(fill: isSelected ? OpenDesignDayColor.accent : OpenDesignDayColor.accentDim, stroke: OpenDesignDayColor.accentLine, radius: 8))
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("opendesign.reference.bipLog.candidate.\(candidate.id).select")

                if let sourceURL = candidate.sourceURL {
                    Link(destination: sourceURL) {
                        Text("원문 열기")
                            .font(.system(size: 11.5, weight: .medium))
                            .foregroundStyle(OpenDesignDayColor.fgSecondary)
                            .padding(.horizontal, 11)
                            .frame(height: 28)
                            .background(referenceRounded(fill: Color.clear, stroke: OpenDesignDayColor.borderSoft, radius: 8))
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("opendesign.reference.bipLog.candidate.\(candidate.id).source")
                }

                Spacer(minLength: 0)
            }
        }
        .padding(16)
        .background(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(isHovered ? OpenDesignDayColor.surface2 : OpenDesignDayColor.surface)
                .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(isHovered ? OpenDesignDayColor.borderStrong : OpenDesignDayColor.border, lineWidth: 1))
        )
        .offset(y: isHovered ? -1 : 0)
        .onHover { isHovered = $0 }
        .accessibilityElement(children: .contain)
    }

    private var score: some View {
        VStack(spacing: 2) {
            Text(candidate.matchLabel)
                .font(.system(size: candidate.matchLabel.count > 1 ? 14 : 18, weight: .semibold, design: .monospaced))
                .lineLimit(1)
                .minimumScaleFactor(0.75)
            Text(candidate.matchCaption)
                .font(.system(size: 9, weight: .medium, design: .monospaced))
                .textCase(.uppercase)
                .foregroundStyle(OpenDesignDayColor.muted)
        }
        .foregroundStyle(candidate.tone.color)
        .frame(width: 54, height: 54)
        .background(referenceRounded(fill: candidate.tone.dim, stroke: candidate.tone.line, radius: 14))
    }

    private var titleBlock: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(candidate.title)
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(OpenDesignDayColor.fg)
                .lineSpacing(2)
                .fixedSize(horizontal: false, vertical: true)
            FlowLayout(spacing: 7, lineSpacing: 3) {
                Text(candidate.source)
                    .fontWeight(.semibold)
                    .foregroundStyle(OpenDesignDayColor.fgSecondary)
                Text("·")
                Text(candidate.date)
                Text("·")
                Text(candidate.medium)
            }
            .font(.system(size: 10.5, weight: .medium, design: .monospaced))
            .foregroundStyle(OpenDesignDayColor.muted)
        }
    }

    private var sourceBadge: some View {
        Text(candidate.sourceLabel)
            .font(.system(size: 10, weight: .medium, design: .monospaced))
            .textCase(.uppercase)
            .foregroundStyle(OpenDesignDayColor.muted)
            .padding(.horizontal, 9)
            .frame(height: 24)
            .background(Capsule().stroke(OpenDesignDayColor.borderSoft, lineWidth: 1))
    }

    private func evidence(title: String, body: AttributedString) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(title)
                .font(.system(size: 10, weight: .medium, design: .monospaced))
                .textCase(.uppercase)
                .foregroundStyle(OpenDesignDayColor.muted)
            Text(body)
                .font(.system(size: 12.5, weight: .regular))
                .foregroundStyle(OpenDesignDayColor.fgSecondary)
                .lineSpacing(3)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.top, 10)
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .overlay(Rectangle().fill(OpenDesignDayColor.borderSoft).frame(height: 1), alignment: .top)
    }
}

private struct OpenDesignBipDraftPanel: View {
    let selectedCandidate: OpenDesignBipCandidate?
    let clearSelection: () -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var copied = false

    private var draftText: String {
        selectedCandidate?.draft ?? """
        후보 카드에서 “공개 기록 초안에 반영”을 누르면, 실제 X/Threads 리서치 결과를 오늘의 공개 기록으로 바꿉니다.

        형식:
        1. 원문에서 잡은 고객 후보 증거
        2. 왜 인터뷰 후보인지
        3. DM에서 확인할 공백 1개
        """
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(selectedCandidate.map { "\($0.source) · 공개 기록 초안" } ?? "선택 후보 없음")
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(OpenDesignDayColor.fg)

            Text(draftText)
                .font(.system(size: 12, weight: .medium, design: .monospaced))
                .foregroundStyle(OpenDesignDayColor.fgSecondary)
                .lineSpacing(5)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.horizontal, 14)
                .padding(.vertical, 13)
                .frame(maxWidth: .infinity, minHeight: 98, alignment: .topLeading)
                .background(
                    RoundedRectangle(cornerRadius: 9, style: .continuous)
                        .fill(OpenDesignDayColor.bgDeep)
                        .overlay(RoundedRectangle(cornerRadius: 9, style: .continuous).stroke(OpenDesignDayColor.border, style: StrokeStyle(lineWidth: 1, dash: [4, 3])))
                )

            HStack(spacing: 8) {
                Button(action: copyDraft) {
                    HStack(spacing: 7) {
                        Text(copied ? "복사됨" : "초안 복사")
                        Text("⌘ C")
                            .font(.system(size: 10, weight: .semibold, design: .monospaced))
                            .foregroundStyle(OpenDesignDayColor.bgDeep.opacity(0.75))
                            .padding(.horizontal, 5)
                            .frame(height: 16)
                            .background(Capsule().fill(OpenDesignDayColor.bgDeep.opacity(0.22)))
                    }
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(OpenDesignDayColor.bgDeep)
                    .padding(.horizontal, 14)
                    .frame(height: 30)
                    .background(referenceRounded(fill: OpenDesignDayColor.amber, stroke: OpenDesignDayColor.amber, radius: 8))
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("opendesign.reference.bipLog.draft.copy")

                Button(action: clearDraft) {
                    Text("초기화")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(OpenDesignDayColor.fgSecondary)
                        .padding(.horizontal, 12)
                        .frame(height: 30)
                        .background(referenceRounded(fill: Color.clear, stroke: OpenDesignDayColor.borderSoft, radius: 8))
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("opendesign.reference.bipLog.draft.clear")

                Spacer(minLength: 0)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(referenceGradientCard(stroke: OpenDesignDayColor.border))
    }

    private func copyDraft() {
        let pasteboard = NSPasteboard.general
        pasteboard.clearContents()
        pasteboard.setString(draftText, forType: .string)
        withAnimation(.easeOut(duration: reduceMotion ? 0 : 0.12)) {
            copied = true
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.4) {
            withAnimation(.easeOut(duration: reduceMotion ? 0 : 0.12)) {
                copied = false
            }
        }
    }

    private func clearDraft() {
        clearSelection()
        copied = false
    }
}

private struct OpenDesignNewsShell: View {
    let layout: OpenDesignDayLayoutMetrics
    let openSearch: () -> Void
    let snapshot: NewsMarketRadarSnapshot
    let refresh: () -> Void
    let prepare: () -> Void
    let openSettings: () -> Void

    @State private var selectedLaneID = "alternatives_pricing"

    private var selectedLane: NewsMarketRadarLane {
        snapshot.lanes.first(where: { $0.id == selectedLaneID })
            ?? snapshot.lanes.first
            ?? NewsMarketRadarLane.defaultLanes[0]
    }

    var body: some View {
        Group {
            if layout.showsTaskSidebar {
                ZStack {
                    NewsMarketRadarSidebarView(
                        snapshot: snapshot,
                        selectedLaneID: selectedLaneID,
                        openSearch: openSearch,
                        selectLane: { selectedLaneID = $0 }
                    )
                    Color.clear
                        .accessibilityElement(children: .ignore)
                        .accessibilityLabel("OpenDesign News Side")
                        .accessibilityIdentifier("opendesign.reference.news.side")
                        .allowsHitTesting(false)
                }
                .frame(width: layout.taskSidebarWidth)
                .frame(maxHeight: .infinity)
                .background(OpenDesignDayColor.bg)
                .transition(.opacity)
            }

            ZStack {
                NewsMarketRadarMainView(
                    layout: layout,
                    snapshot: snapshot,
                    selectedLane: selectedLane,
                    selectedLaneID: $selectedLaneID,
                    refresh: refresh,
                    openSettings: openSettings
                )
                Color.clear
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel("OpenDesign News Main")
                    .accessibilityIdentifier("opendesign.reference.news.main")
                    .allowsHitTesting(false)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)

            if layout.showsMetaPanel {
                ZStack {
                    NewsMarketRadarMetaPanelView(snapshot: snapshot)
                    Color.clear
                        .accessibilityElement(children: .ignore)
                        .accessibilityLabel("OpenDesign News Meta")
                        .accessibilityIdentifier("opendesign.reference.news.meta")
                        .allowsHitTesting(false)
                }
                .frame(width: layout.metaPanelWidth)
                .frame(maxHeight: .infinity)
                .background(OpenDesignDayColor.bg)
            }
        }
        .onAppear(perform: prepare)
        .onChange(of: snapshot.lanes.map(\.id)) { _, laneIDs in
            if !laneIDs.contains(selectedLaneID) {
                selectedLaneID = laneIDs.first ?? "icp"
            }
        }
    }
}

private struct NewsMarketRadarSidebarView: View {
    let snapshot: NewsMarketRadarSnapshot
    let selectedLaneID: String
    let openSearch: () -> Void
    let selectLane: (String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 8) {
                Image(systemName: "newspaper")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(OpenDesignDayColor.accent)
                Text("Market Radar")
                    .font(.system(size: 12, weight: .bold, design: .monospaced))
                    .foregroundStyle(OpenDesignDayColor.fg)
                Spacer(minLength: 0)
                Text(newsStatusDisplayLabel(snapshot))
                    .font(.system(size: 10, weight: .bold, design: .monospaced))
                    .foregroundStyle(newsStatusTone(snapshot.status).color)
                    .lineLimit(1)
                    .minimumScaleFactor(0.75)
            }

            Button(action: openSearch) {
                HStack(spacing: 8) {
                    Image(systemName: "magnifyingglass")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(OpenDesignDayColor.muted)
                    Text("뉴스·가정 검색")
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(OpenDesignDayColor.muted)
                    Spacer(minLength: 0)
                }
                .padding(.horizontal, 10)
                .frame(height: 32)
                .background(referenceRounded(fill: OpenDesignDayColor.bgDeep, stroke: OpenDesignDayColor.borderSoft, radius: 8))
            }
            .buttonStyle(.plain)

            VStack(alignment: .leading, spacing: 6) {
                ForEach(snapshot.lanes) { lane in
                    NewsMarketRadarLaneButton(
                        lane: lane,
                        isSelected: lane.id == selectedLaneID,
                        action: { selectLane(lane.id) }
                    )
                }
            }

            Spacer(minLength: 0)

            VStack(alignment: .leading, spacing: 5) {
                Text("로컬 보관")
                    .font(.system(size: 10, weight: .bold, design: .monospaced))
                    .foregroundStyle(OpenDesignDayColor.mutedDeep)
                Text("Day 답변과 snippets는 workspace의 .agentic30/news에 30일 동안만 남습니다.")
                    .font(.system(size: 10.5, weight: .medium))
                    .foregroundStyle(OpenDesignDayColor.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(10)
            .background(referenceRounded(fill: OpenDesignDayColor.surface, stroke: OpenDesignDayColor.borderSoft, radius: 8))
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 14)
    }
}

private struct NewsMarketRadarLaneButton: View {
    let lane: NewsMarketRadarLane
    let isSelected: Bool
    let action: () -> Void

    @State private var isHovered = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: 9) {
                Circle()
                    .fill(newsImpactTone(lane.impact).color)
                    .frame(width: 7, height: 7)
                VStack(alignment: .leading, spacing: 2) {
                    Text(lane.title)
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(OpenDesignDayColor.fg)
                        .lineLimit(1)
                    Text(lane.hypothesis)
                        .font(.system(size: 10.5, weight: .medium))
                        .foregroundStyle(OpenDesignDayColor.muted)
                        .lineLimit(2)
                }
                Spacer(minLength: 6)
                Text("\(lane.cards.count)")
                    .font(.system(size: 10, weight: .bold, design: .monospaced))
                    .foregroundStyle(isSelected ? OpenDesignDayColor.accent : OpenDesignDayColor.muted)
                    .frame(minWidth: 18)
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 9)
            .background(referenceRounded(fill: isSelected || isHovered ? OpenDesignDayColor.hover : Color.clear, stroke: isSelected ? OpenDesignDayColor.accentLine : Color.clear, radius: 8))
        }
        .buttonStyle(.plain)
        .onHover { isHovered = $0 }
    }
}

private struct NewsMarketRadarMainView: View {
    let layout: OpenDesignDayLayoutMetrics
    let snapshot: NewsMarketRadarSnapshot
    let selectedLane: NewsMarketRadarLane
    @Binding var selectedLaneID: String
    let refresh: () -> Void
    let openSettings: () -> Void

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                NewsMarketRadarHeader(snapshot: snapshot, refresh: refresh, openSettings: openSettings)

                if snapshot.status.state == "failed",
                   snapshot.status.needsExaConfiguration,
                   snapshot.cardCount == 0 {
                    NewsMarketRadarNoExaRouteState(openSettings: openSettings)
                } else {
                    if snapshot.status.isRefreshing {
                        NewsMarketRadarProgressState(snapshot: snapshot)
                    }

                    if !snapshot.status.isRefreshing, selectedLane.cards.isEmpty {
                        NewsMarketRadarEmptyLane(lane: selectedLane, refresh: refresh)
                    } else if !selectedLane.cards.isEmpty {
                        VStack(alignment: .leading, spacing: 12) {
                            HStack(spacing: 8) {
                                Text(selectedLane.title)
                                    .font(.system(size: 18, weight: .bold, design: .rounded))
                                    .foregroundStyle(OpenDesignDayColor.fg)
                                Text(newsConfidenceLabel(selectedLane.confidence))
                                    .font(.system(size: 10, weight: .bold, design: .monospaced))
                                    .foregroundStyle(newsConfidenceTone(selectedLane.confidence).color)
                                    .padding(.horizontal, 7)
                                    .frame(height: 20)
                                    .background(Capsule().fill(newsConfidenceTone(selectedLane.confidence).dim))
                                Spacer(minLength: 0)
                            }
                            Text(selectedLane.hypothesis)
                                .font(.system(size: 12.5, weight: .medium))
                                .foregroundStyle(OpenDesignDayColor.muted)
                                .fixedSize(horizontal: false, vertical: true)

                            ForEach(selectedLane.cards) { card in
                                NewsMarketRadarCardView(card: card)
                            }
                        }
                    }
                }
            }
            .frame(maxWidth: 820, alignment: .leading)
            .padding(.horizontal, layout.mainHorizontalPadding)
            .padding(.top, 24)
            .padding(.bottom, 42)
        }
    }
}

private struct NewsMarketRadarHeader: View {
    let snapshot: NewsMarketRadarSnapshot
    let refresh: () -> Void
    let openSettings: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 12) {
                VStack(alignment: .leading, spacing: 6) {
                    Text("시장 리서치 레이더")
                        .font(.system(size: 26, weight: .bold, design: .rounded))
                        .foregroundStyle(OpenDesignDayColor.fg)
                    Text("워크스페이스 근거와 일차 답변을 기준으로 공개 시장 근거를 묶어 보여줍니다.")
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(OpenDesignDayColor.muted)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 0)
                VStack(alignment: .trailing, spacing: 8) {
                    newsPill(newsStatusDisplayLabel(snapshot), tone: newsStatusTone(snapshot.status))
                    HStack(spacing: 8) {
                        if snapshot.status.isRefreshing {
                            NewsMarketRadarRunningIndicator(status: snapshot.status)
                        } else {
                            OpenDesignNewsActionButton(
                                icon: "arrow.clockwise",
                                title: "새로고침",
                                tone: .ghost,
                                action: refresh
                            )
                        }
                        if snapshot.status.needsExaConfiguration {
                            OpenDesignNewsActionButton(icon: "key.fill", title: "Exa 설정", tone: .accent, action: openSettings)
                        }
                    }
                }
            }

            HStack(spacing: 10) {
                newsMetric("\(snapshot.cardCount)", "카드", tone: .accent)
                newsMetric("\(snapshot.lanes.filter { !$0.cards.isEmpty }.count)", "가정", tone: .sky)
                newsMetric(snapshot.generatedAt.map(relativeNewsDate(_:)) ?? "없음", "갱신", tone: .muted)
            }
        }
        .padding(18)
        .background(referenceRounded(fill: OpenDesignDayColor.surface, stroke: OpenDesignDayColor.borderSoft, radius: 10))
    }
}

private struct NewsMarketRadarRunningIndicator: View {
    let status: NewsMarketRadarStatus

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: "play.circle.fill")
                .font(.system(size: 11, weight: .bold))
            Text("리서치 진행 중")
            if let ordinal = status.progressOrdinal {
                Text(ordinal)
                    .font(.system(size: 10.5, weight: .bold, design: .monospaced))
            }
        }
        .font(.system(size: 11.5, weight: .bold))
        .foregroundStyle(OpenDesignDayColor.sky)
        .padding(.horizontal, 10)
        .frame(height: 28)
        .background(referenceRounded(fill: OpenDesignReferenceTone.sky.dim, stroke: OpenDesignReferenceTone.sky.line, radius: 8))
        .accessibilityLabel("리서치 진행 중")
    }
}

private struct NewsMarketRadarNoExaRouteState: View {
    let openSettings: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Image(systemName: "key.slash")
                .font(.system(size: 20, weight: .bold))
                .foregroundStyle(OpenDesignDayColor.amber)
            Text("웹 검색 도구 연결이 필요합니다")
                .font(.system(size: 18, weight: .bold, design: .rounded))
                .foregroundStyle(OpenDesignDayColor.fg)
            Text("리서치 레이더는 Codex, Claude Code, Gemini에 연결된 웹 검색 도구를 우선 사용합니다. 없을 때만 설정의 EXA_API_KEY 대체 경로를 사용합니다.")
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(OpenDesignDayColor.muted)
                .fixedSize(horizontal: false, vertical: true)
            OpenDesignNewsActionButton(icon: "key.fill", title: "Exa 설정 열기", tone: .accent, action: openSettings)
        }
        .padding(18)
        .background(referenceRounded(fill: OpenDesignDayColor.surface, stroke: OpenDesignDayColor.amberLine, radius: 10))
    }
}

private struct NewsMarketRadarEmptyLane: View {
    let lane: NewsMarketRadarLane
    let refresh: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(lane.title)
                .font(.system(size: 18, weight: .bold, design: .rounded))
                .foregroundStyle(OpenDesignDayColor.fg)
            Text("아직 이 가정에 연결된 카드가 없습니다. 새로고침하면 워크스페이스 근거와 일차 답변을 기준으로 Exa 리서치를 다시 실행합니다.")
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(OpenDesignDayColor.muted)
                .fixedSize(horizontal: false, vertical: true)
            OpenDesignNewsActionButton(icon: "play.fill", title: "리서치 실행", tone: .ghost, action: refresh)
        }
        .padding(18)
        .background(referenceRounded(fill: OpenDesignDayColor.surface, stroke: OpenDesignDayColor.borderSoft, radius: 10))
    }
}

private struct NewsMarketRadarProgressState: View {
    let snapshot: NewsMarketRadarSnapshot

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: "play.circle.fill")
                    .font(.system(size: 20, weight: .bold))
                    .foregroundStyle(OpenDesignDayColor.sky)
                VStack(alignment: .leading, spacing: 5) {
                    HStack(spacing: 8) {
                        Text(snapshot.status.progressTitle)
                            .font(.system(size: 17, weight: .bold, design: .rounded))
                            .foregroundStyle(OpenDesignDayColor.fg)
                        if let ordinal = snapshot.status.progressOrdinal {
                            newsPill(ordinal, tone: .sky)
                        }
                    }
                    Text(snapshot.status.progressDetail)
                        .font(.system(size: 12.5, weight: .medium))
                        .foregroundStyle(OpenDesignDayColor.muted)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 0)
                VStack(alignment: .trailing, spacing: 5) {
                    if let elapsed = snapshot.status.elapsedLabel {
                        newsPill(elapsed, tone: .muted)
                    }
                    if let researchSource = snapshot.status.researchSource?.nonEmpty {
                        Text(researchSource)
                            .font(.system(size: 10.5, weight: .bold, design: .monospaced))
                            .foregroundStyle(OpenDesignDayColor.sky)
                            .lineLimit(1)
                    }
                }
            }

            NewsMarketRadarProgressChecklist(status: snapshot.status)
        }
        .padding(18)
        .background(referenceRounded(fill: OpenDesignDayColor.surface, stroke: OpenDesignDayColor.sky.opacity(0.36), radius: 10))
    }
}

private struct NewsMarketRadarProgressChecklist: View {
    let status: NewsMarketRadarStatus

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            ForEach(newsMarketRadarProgressSteps) { step in
                HStack(spacing: 8) {
                    Image(systemName: icon(for: step))
                        .font(.system(size: 11, weight: .bold))
                        .foregroundStyle(tone(for: step).color)
                        .frame(width: 16)
                    Text(step.title)
                        .font(.system(size: 11.5, weight: step.isCurrent(status) ? .bold : .medium))
                        .foregroundStyle(step.isPending(status) ? OpenDesignDayColor.muted : OpenDesignDayColor.fgSecondary)
                    Spacer(minLength: 0)
                }
                .frame(height: 22)
            }
        }
        .padding(10)
        .background(referenceRounded(fill: OpenDesignDayColor.bgDeep, stroke: OpenDesignDayColor.borderSoft, radius: 8))
    }

    private func icon(for step: NewsMarketRadarProgressStep) -> String {
        if step.isComplete(status) { return "checkmark.circle.fill" }
        if step.isCurrent(status) { return "play.circle.fill" }
        return "circle"
    }

    private func tone(for step: NewsMarketRadarProgressStep) -> OpenDesignReferenceTone {
        if step.isComplete(status) { return .accent }
        if step.isCurrent(status) { return .sky }
        return .muted
    }
}

private struct NewsMarketRadarCardView: View {
    let card: NewsMarketRadarCard
    @State private var showsUpdate = false

    private var visibleSourceRefs: [NewsMarketRadarSourceDisplayRef] {
        card.sourceRefs.prefix(4).enumerated().map { index, source in
            NewsMarketRadarSourceDisplayRef(index: index, source: source)
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 10) {
                VStack(alignment: .leading, spacing: 6) {
                    Text(card.title)
                        .font(.system(size: 16, weight: .bold, design: .rounded))
                        .foregroundStyle(OpenDesignDayColor.fg)
                        .fixedSize(horizontal: false, vertical: true)
                    Text(card.summary)
                        .font(.system(size: 13, weight: .medium))
                        .lineSpacing(3)
                        .foregroundStyle(OpenDesignDayColor.fgSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 10)
                VStack(alignment: .trailing, spacing: 6) {
                    newsPill(newsImpactLabel(card.impact), tone: newsImpactTone(card.impact))
                    newsPill(newsConfidenceLabel(card.confidence), tone: newsConfidenceTone(card.confidence))
                }
            }

            if let why = card.whyItMatters?.nonEmpty {
                Text(why)
                    .font(.system(size: 12.5, weight: .medium))
                    .foregroundStyle(OpenDesignDayColor.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }

            HStack(spacing: 6) {
                ForEach((card.relatedDays ?? []).prefix(5), id: \.self) { day in
                    newsPill("\(day)일차", tone: .sky)
                }
                newsPill("출처 \(card.sourceRefs.count)", tone: .muted)
                Spacer(minLength: 0)
            }

            if let update = card.suggestedHypothesisUpdate?.nonEmpty {
                Button {
                    withAnimation(.easeOut(duration: 0.12)) {
                        showsUpdate.toggle()
                    }
                } label: {
                    HStack(spacing: 7) {
                        Image(systemName: showsUpdate ? "chevron.down" : "chevron.right")
                            .font(.system(size: 10, weight: .bold))
                        Text("가설 갱신 제안")
                            .font(.system(size: 12, weight: .bold, design: .rounded))
                        Spacer(minLength: 0)
                    }
                    .foregroundStyle(OpenDesignDayColor.accent)
                }
                .buttonStyle(.plain)

                if showsUpdate {
                    Text(update)
                        .font(.system(size: 12.5, weight: .medium))
                        .foregroundStyle(OpenDesignDayColor.fgSecondary)
                        .lineSpacing(3)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(12)
                        .background(referenceRounded(fill: OpenDesignDayColor.bgDeep, stroke: OpenDesignDayColor.accentLine, radius: 8))
                }
            }

            VStack(alignment: .leading, spacing: 8) {
                ForEach(visibleSourceRefs) { sourceRef in
                    NewsMarketRadarSourceRow(source: sourceRef.source)
                }
            }
        }
        .padding(16)
        .background(referenceRounded(fill: OpenDesignDayColor.surface, stroke: OpenDesignDayColor.borderSoft, radius: 10))
    }
}

private struct NewsMarketRadarSourceDisplayRef: Identifiable {
    let id: String
    let source: NewsMarketRadarSourceRef

    init(index: Int, source: NewsMarketRadarSourceRef) {
        self.id = "\(index)-\(source.stableID)"
        self.source = source
    }
}

private struct NewsMarketRadarSourceRow: View {
    let source: NewsMarketRadarSourceRef

    var body: some View {
        HStack(alignment: .top, spacing: 9) {
            Image(systemName: source.url == nil ? "doc.text" : "link")
                .font(.system(size: 11, weight: .bold))
                .foregroundStyle(OpenDesignDayColor.muted)
                .frame(width: 18)
            VStack(alignment: .leading, spacing: 3) {
                Text(source.title)
                    .font(.system(size: 11.5, weight: .semibold))
                    .foregroundStyle(OpenDesignDayColor.fgSecondary)
                    .lineLimit(1)
                Text(source.domain ?? source.path ?? source.sourceType)
                    .font(.system(size: 10.5, weight: .medium, design: .monospaced))
                    .foregroundStyle(OpenDesignDayColor.mutedDeep)
                    .lineLimit(1)
                if let excerpt = source.excerpt?.nonEmpty {
                    Text(excerpt)
                        .font(.system(size: 11.5, weight: .medium))
                        .foregroundStyle(OpenDesignDayColor.muted)
                        .lineLimit(2)
                }
            }
            Spacer(minLength: 0)
            if let url = source.url, let destination = URL(string: url) {
                Link(destination: destination) {
                    Image(systemName: "arrow.up.right")
                        .font(.system(size: 10, weight: .bold))
                        .foregroundStyle(OpenDesignDayColor.muted)
                }
            }
        }
        .padding(10)
        .background(referenceRounded(fill: OpenDesignDayColor.bgDeep, stroke: OpenDesignDayColor.borderSoft, radius: 8))
    }
}

private struct NewsMarketRadarMetaPanelView: View {
    let snapshot: NewsMarketRadarSnapshot

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                newsMetaTitle("Radar 상태")
                VStack(alignment: .leading, spacing: 8) {
                    newsMetaRow("상태", newsStatusDisplayLabel(snapshot), tone: newsStatusTone(snapshot.status))
                    if snapshot.status.isRefreshing {
                        NewsMarketRadarMetaProgress(status: snapshot.status)
                    }
                    newsMetaRow("카드", "\(snapshot.cardCount)", tone: .accent)
                    newsMetaRow("마지막 성공", snapshot.status.lastSuccessAt.map(relativeNewsDate(_:)) ?? "없음", tone: .muted)
                    if let researchSource = snapshot.status.researchSource?.nonEmpty {
                        newsMetaRow("소스", researchSource, tone: .sky)
                    }
                    if let error = snapshot.status.error?.nonEmpty {
                        Text(error)
                            .font(.system(size: 11.5, weight: .medium))
                            .foregroundStyle(OpenDesignDayColor.amber)
                            .fixedSize(horizontal: false, vertical: true)
                            .padding(10)
                            .background(referenceRounded(fill: OpenDesignDayColor.amberDim, stroke: OpenDesignDayColor.amberLine, radius: 8))
                    }
                    if let partialFailures = snapshot.status.partialFailures,
                       partialFailures.isEmpty == false {
                        Text("일부 가정 리서치 실패: \(partialFailures.map(\.laneTitle).joined(separator: ", "))")
                            .font(.system(size: 11.5, weight: .medium))
                            .foregroundStyle(OpenDesignDayColor.amber)
                            .fixedSize(horizontal: false, vertical: true)
                            .padding(10)
                            .background(referenceRounded(fill: OpenDesignDayColor.amberDim, stroke: OpenDesignDayColor.amberLine, radius: 8))
                    }
                }

                newsMetaTitle("가정 커버리지")
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(snapshot.lanes) { lane in
                        HStack(spacing: 8) {
                            Text(lane.title)
                                .font(.system(size: 11.5, weight: .semibold))
                                .foregroundStyle(OpenDesignDayColor.fgSecondary)
                            Spacer(minLength: 0)
                            Text("\(lane.cards.count)")
                                .font(.system(size: 11, weight: .bold, design: .monospaced))
                                .foregroundStyle(newsImpactTone(lane.impact).color)
                        }
                        .padding(10)
                        .background(referenceRounded(fill: OpenDesignDayColor.surface, stroke: OpenDesignDayColor.borderSoft, radius: 8))
                    }
                }
            }
            .padding(14)
        }
    }
}

private struct NewsMarketRadarMetaProgress: View {
    let status: NewsMarketRadarStatus

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Text(status.progressTitle)
                    .font(.system(size: 11.5, weight: .bold, design: .rounded))
                    .foregroundStyle(OpenDesignDayColor.fgSecondary)
                    .lineLimit(1)
                Spacer(minLength: 0)
                Text(status.progressOrdinal ?? "진행 중")
                    .font(.system(size: 10.5, weight: .bold, design: .monospaced))
                    .foregroundStyle(OpenDesignDayColor.sky)
            }
            Text(status.progressDetail)
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(OpenDesignDayColor.muted)
                .fixedSize(horizontal: false, vertical: true)
            if let elapsed = status.elapsedLabel {
                Text(elapsed)
                    .font(.system(size: 10.5, weight: .bold, design: .monospaced))
                    .foregroundStyle(OpenDesignDayColor.mutedDeep)
            }
            NewsMarketRadarProgressChecklist(status: status)
        }
        .padding(10)
        .background(referenceRounded(fill: OpenDesignDayColor.surface, stroke: OpenDesignDayColor.sky.opacity(0.36), radius: 8))
    }
}

private func newsMetaTitle(_ title: String) -> some View {
    Text(title)
        .font(.system(size: 10, weight: .medium, design: .monospaced))
        .textCase(.uppercase)
        .foregroundStyle(OpenDesignDayColor.muted)
}

private func newsMetric(_ value: String, _ label: String, tone: OpenDesignReferenceTone) -> some View {
    VStack(alignment: .leading, spacing: 2) {
        Text(value)
            .font(.system(size: 15, weight: .bold, design: .monospaced))
            .foregroundStyle(tone.color)
        Text(label)
            .font(.system(size: 10, weight: .medium, design: .monospaced))
            .foregroundStyle(OpenDesignDayColor.muted)
    }
    .padding(.horizontal, 10)
    .padding(.vertical, 8)
    .background(referenceRounded(fill: tone.dim, stroke: tone.line, radius: 8))
}

private func newsMetaRow(_ label: String, _ value: String, tone: OpenDesignReferenceTone) -> some View {
    HStack(spacing: 8) {
        Text(label)
            .font(.system(size: 11, weight: .medium, design: .monospaced))
            .foregroundStyle(OpenDesignDayColor.muted)
        Spacer(minLength: 0)
        Text(value)
            .font(.system(size: 11.5, weight: .bold, design: .monospaced))
            .foregroundStyle(tone.color)
            .lineLimit(1)
    }
    .padding(10)
    .background(referenceRounded(fill: OpenDesignDayColor.surface, stroke: OpenDesignDayColor.borderSoft, radius: 8))
}

private func newsPill(_ text: String, tone: OpenDesignReferenceTone) -> some View {
    Text(text)
        .font(.system(size: 10, weight: .bold, design: .monospaced))
        .foregroundStyle(tone.color)
        .padding(.horizontal, 7)
        .frame(height: 20)
        .background(Capsule().fill(tone.dim).overlay(Capsule().stroke(tone.line, lineWidth: 1)))
}

private struct NewsMarketRadarProgressStep: Identifiable {
    let id: String
    let order: Int
    let title: String
    let fallbackDetail: String

    func isCurrent(_ status: NewsMarketRadarStatus) -> Bool {
        status.resolvedProgressStepIndex == order
    }

    func isComplete(_ status: NewsMarketRadarStatus) -> Bool {
        guard let current = status.resolvedProgressStepIndex else { return false }
        return order < current
    }

    func isPending(_ status: NewsMarketRadarStatus) -> Bool {
        guard let current = status.resolvedProgressStepIndex else { return true }
        return order > current
    }
}

private let newsMarketRadarProgressSteps: [NewsMarketRadarProgressStep] = [
    .init(id: "checking_exa_route", order: 1, title: "연결 확인", fallbackDetail: "웹 검색 도구 연결을 확인하는 중"),
    .init(id: "loading_workspace_evidence", order: 2, title: "근거 수집", fallbackDetail: "워크스페이스 근거와 일차 답변을 읽는 중"),
    .init(id: "building_research_prompt", order: 3, title: "질문 구성", fallbackDetail: "리서치 질문을 구성하는 중"),
    .init(id: "running_provider_research", order: 4, title: "웹 검색", fallbackDetail: "웹 검색 도구로 공개 근거를 검색하는 중"),
    .init(id: "normalizing_cards", order: 5, title: "카드 정리", fallbackDetail: "근거를 가정별 카드로 정리하는 중"),
    .init(id: "saving_results", order: 6, title: "저장", fallbackDetail: "리서치 결과를 로컬 캐시에 저장하는 중"),
]

private func newsStatusDisplayLabel(_ snapshot: NewsMarketRadarSnapshot) -> String {
    guard snapshot.status.isRefreshing else { return snapshot.statusLabel }
    if let ordinal = snapshot.status.progressOrdinal {
        return "\(ordinal) \(snapshot.status.progressTitle)"
    }
    return "리서치 중"
}

private func newsImpactLabel(_ impact: String) -> String {
    switch impact {
    case "strengthens": return "강화"
    case "weakens": return "약화"
    case "mixed": return "상충"
    default: return "불확실"
    }
}

private func newsImpactTone(_ impact: String) -> OpenDesignReferenceTone {
    switch impact {
    case "strengthens": return .accent
    case "weakens": return .rose
    case "mixed": return .amber
    default: return .muted
    }
}

private func newsConfidenceLabel(_ confidence: String) -> String {
    switch confidence {
    case "strong": return "강함"
    case "medium": return "보통"
    default: return "약함"
    }
}

private func newsConfidenceTone(_ confidence: String) -> OpenDesignReferenceTone {
    switch confidence {
    case "strong": return .accent
    case "medium": return .sky
    default: return .muted
    }
}

private func newsStatusTone(_ status: NewsMarketRadarStatus) -> OpenDesignReferenceTone {
    switch status.state {
    case "ready": return status.stale == true ? .amber : .accent
    case "refreshing": return .sky
    case "failed": return .amber
    case "stale": return .amber
    default: return .muted
    }
}

private func relativeNewsDate(_ date: Date) -> String {
    let elapsed = max(0, Date().timeIntervalSince(date))
    if elapsed < 60 { return "방금" }
    if elapsed < 3600 { return "\(Int(elapsed / 60))m" }
    if elapsed < 86_400 { return "\(Int(elapsed / 3600))h" }
    return "\(Int(elapsed / 86_400))d"
}

private func newsElapsedLabel(_ elapsedMs: Int) -> String {
    let seconds = max(0, elapsedMs / 1000)
    if seconds < 60 { return "\(seconds)초 경과" }
    let minutes = seconds / 60
    let remainder = seconds % 60
    if minutes < 60 {
        return remainder == 0 ? "\(minutes)분 경과" : "\(minutes)분 \(remainder)초 경과"
    }
    return "\(minutes / 60)시간 경과"
}

private extension String {
    var nonEmpty: String? {
        trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : self
    }
}

private extension NewsMarketRadarStatus {
    var isRefreshing: Bool {
        state == "refreshing"
    }

    var needsExaConfiguration: Bool {
        ["exa_api_key_missing", "exa_mcp_missing"].contains(reason ?? "")
    }

    var resolvedProgressStep: NewsMarketRadarProgressStep? {
        if let stage = stage?.nonEmpty,
           let step = newsMarketRadarProgressSteps.first(where: { $0.id == stage }) {
            return step
        }
        guard let index = resolvedProgressStepIndex else { return nil }
        return newsMarketRadarProgressSteps.first(where: { $0.order == index })
    }

    var resolvedProgressStepIndex: Int? {
        if let stepIndex,
           stepIndex > 0 {
            return stepIndex
        }
        guard let stage = stage?.nonEmpty else { return nil }
        return newsMarketRadarProgressSteps.first(where: { $0.id == stage })?.order
    }

    var progressOrdinal: String? {
        guard isRefreshing else { return nil }
        let count = stepCount ?? newsMarketRadarProgressSteps.count
        guard let index = resolvedProgressStepIndex,
              count > 0
        else { return nil }
        return "\(index)/\(count)"
    }

    var progressTitle: String {
        resolvedProgressStep?.title ?? "리서치 준비"
    }

    var progressDetail: String {
        progressText?.nonEmpty ?? resolvedProgressStep?.fallbackDetail ?? "Market Radar 리서치를 준비하는 중"
    }

    var elapsedLabel: String? {
        guard let elapsedMs else { return nil }
        return newsElapsedLabel(elapsedMs)
    }
}

private extension BipResearchStatus {
    var isRefreshing: Bool {
        state == "refreshing"
    }

    var needsExaConfiguration: Bool {
        ["exa_api_key_missing", "exa_mcp_missing"].contains(reason ?? "")
    }
}

private struct OpenDesignNewsSidebarView: View {
    let selectedFilter: OpenDesignNewsFilter
    let unreadCount: Int
    let displayCount: (OpenDesignNewsFilter) -> String
    let openSearch: () -> Void
    let select: (OpenDesignNewsFilter) -> Void

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 6) {
                Text("받은함")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(OpenDesignDayColor.fg)
                Text("\(unreadCount)")
                    .font(.system(size: 10, weight: .medium, design: .monospaced))
                    .foregroundStyle(OpenDesignDayColor.muted)
                    .padding(.horizontal, 6)
                    .frame(height: 18)
                    .background(Capsule().fill(OpenDesignDayColor.surface))
                Spacer(minLength: 0)
            }
            .padding(.top, 10)
            .padding(.horizontal, 12)
            .padding(.bottom, 8)

            Button(action: openSearch) {
                HStack(spacing: 8) {
                    Image(systemName: "magnifyingglass")
                        .font(.system(size: 10, weight: .medium))
                    Text("뉴스 검색")
                    Spacer()
                    Text("⌘ K")
                        .font(.system(size: 10, weight: .medium, design: .monospaced))
                        .foregroundStyle(OpenDesignDayColor.mutedDeep)
                }
                .font(.system(size: 11.5, weight: .medium))
                .foregroundStyle(OpenDesignDayColor.fgSecondary)
                .padding(.horizontal, 10)
                .frame(height: 30)
                .background(referenceRounded(fill: OpenDesignDayColor.surface, stroke: OpenDesignDayColor.borderSoft, radius: 6))
            }
            .buttonStyle(.plain)
            .padding(.horizontal, 8)
            .padding(.bottom, 6)

            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0) {
                    ForEach(OpenDesignNewsCatalog.streamGroups) { group in
                        HStack {
                            Text(group.title)
                            Spacer()
                            if group.dynamicBadge {
                                Text(unreadCount == 0 ? "모두 읽음" : "\(unreadCount)건 안 읽음")
                                    .foregroundStyle(OpenDesignDayColor.accent)
                            }
                        }
                        .font(.system(size: 10, weight: .medium, design: .monospaced))
                        .textCase(.uppercase)
                        .foregroundStyle(OpenDesignDayColor.mutedDeep)
                        .padding(.top, group.id == "inbox" ? 8 : 14)
                        .padding(.horizontal, 8)
                        .padding(.bottom, 6)

                        ForEach(group.rows) { row in
                            OpenDesignNewsStreamRowView(
                                row: row,
                                isActive: selectedFilter == row.id,
                                count: displayCount(row.id),
                                select: { select(row.id) }
                            )
                        }
                    }
                }
                .padding(.horizontal, 6)
                .padding(.bottom, 14)
            }
        }
        .background(OpenDesignDayColor.bg)
        .overlay(Rectangle().fill(OpenDesignDayColor.borderSoft).frame(width: 1), alignment: .trailing)
    }
}

private struct OpenDesignNewsStreamRowView: View {
    let row: OpenDesignNewsStreamRow
    let isActive: Bool
    let count: String
    let select: () -> Void
    @State private var isHovered = false

    var body: some View {
        Button(action: select) {
            HStack(spacing: 9) {
                Circle()
                    .fill(row.tone.color)
                    .frame(width: 10, height: 10)
                    .frame(width: 18)
                Text(row.title)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(isActive || isHovered ? OpenDesignDayColor.fg : OpenDesignDayColor.fgSecondary)
                    .lineLimit(1)
                Spacer(minLength: 6)
                Text(count)
                    .font(.system(size: 10.5, weight: .medium, design: .monospaced))
                    .foregroundStyle(isActive ? OpenDesignDayColor.accent : OpenDesignDayColor.muted)
                    .padding(.horizontal, 6)
                    .frame(height: 18)
                    .background(Capsule().fill(isActive ? OpenDesignDayColor.accentDim : OpenDesignDayColor.surface))
                    .overlay(Capsule().stroke(isActive ? OpenDesignDayColor.accentLine : OpenDesignDayColor.borderSoft, lineWidth: 1))
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 7)
            .background(referenceRounded(fill: isActive ? OpenDesignDayColor.selected : isHovered ? OpenDesignDayColor.hover : Color.clear, stroke: Color.clear, radius: 7))
        }
        .buttonStyle(.plain)
        .onHover { isHovered = $0 }
        .accessibilityLabel(row.title)
        .accessibilityValue("\(count)건")
    }
}

private struct OpenDesignNewsMainView: View {
    let layout: OpenDesignDayLayoutMetrics
    let selectedFilter: OpenDesignNewsFilter
    let unreadCount: Int
    let readArticleIDs: Set<String>
    let savedArticleIDs: Set<String>
    let visibleArticles: [OpenDesignNewsArticle]
    let displayCount: (OpenDesignNewsFilter) -> String
    let selectFilter: (OpenDesignNewsFilter) -> Void
    let markAll: () -> Void
    let markRead: (String) -> Void
    let toggleRead: (String) -> Void
    let toggleSaved: (String) -> Void

    var body: some View {
        VStack(spacing: 0) {
            OpenDesignNewsHeaderView(
                unreadCount: unreadCount,
                totalCount: OpenDesignNewsCatalog.articles.count,
                horizontalPadding: layout.mainHorizontalPadding,
                markAll: markAll
            )

            OpenDesignNewsFilterBar(
                selectedFilter: selectedFilter,
                horizontalPadding: layout.mainHorizontalPadding,
                displayCount: displayCount,
                select: selectFilter
            )

            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    OpenDesignNewsTakeawayHero()
                        .padding(.bottom, 18)

                    ForEach(OpenDesignNewsCatalog.sections) { section in
                        let articles = visibleArticles.filter { $0.sectionID == section.id }
                        if !articles.isEmpty {
                            OpenDesignNewsSectionHeader(section: section)
                                .padding(.top, 4)
                                .padding(.bottom, 12)

                            VStack(spacing: 12) {
                                ForEach(articles) { article in
                                    OpenDesignNewsArticleCard(
                                        article: article,
                                        isRead: readArticleIDs.contains(article.id),
                                        isSaved: savedArticleIDs.contains(article.id),
                                        markRead: { markRead(article.id) },
                                        toggleRead: { toggleRead(article.id) },
                                        toggleSaved: { toggleSaved(article.id) }
                                    )
                                }
                            }
                            .padding(.bottom, 10)
                        }
                    }

                    if visibleArticles.isEmpty {
                        Text("이 필터에 해당하는 리서치가 없어요 — 다른 Value를 골라보세요.")
                            .font(.system(size: 11, weight: .medium, design: .monospaced))
                            .foregroundStyle(OpenDesignDayColor.mutedDeep)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 24)
                    }
                }
                .frame(maxWidth: 880, alignment: .leading)
                .padding(.horizontal, layout.mainHorizontalPadding)
                .padding(.top, 22)
                .padding(.bottom, 34)
                .frame(maxWidth: .infinity)
            }
            .background(OpenDesignDayColor.bg)
        }
        .background(OpenDesignDayColor.bg)
    }
}

private struct OpenDesignNewsHeaderView: View {
    let unreadCount: Int
    let totalCount: Int
    let horizontalPadding: CGFloat
    let markAll: () -> Void

    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 12) {
                headerIdentity
                Spacer(minLength: 12)
                headerActions
            }

            VStack(alignment: .leading, spacing: 10) {
                headerIdentity
                headerActions
            }
        }
        .padding(.horizontal, horizontalPadding)
        .padding(.vertical, 12)
        .frame(minHeight: 70)
        .background(OpenDesignDayColor.bg)
        .overlay(Rectangle().fill(OpenDesignDayColor.borderSoft).frame(height: 1), alignment: .bottom)
    }

    private var headerIdentity: some View {
        HStack(spacing: 14) {
            Image(systemName: "newspaper")
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(OpenDesignDayColor.accent)
                .frame(width: 44, height: 44)
                .background(referenceRounded(fill: OpenDesignDayColor.accentDim, stroke: OpenDesignDayColor.accentLine, radius: 11))

            VStack(alignment: .leading, spacing: 3) {
                Text("뉴스")
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(OpenDesignDayColor.fg)
                    .lineLimit(1)
                FlowLayout(spacing: 8, lineSpacing: 3) {
                    Circle()
                        .fill(OpenDesignDayColor.accent)
                        .frame(width: 5, height: 5)
                    headerMeta("안 읽음 \(unreadCount)건", emphasized: true)
                    headerSeparator
                    headerMeta("전체 \(totalCount)건", emphasized: true)
                    headerSeparator
                    headerMeta("마지막 동기화 오늘 06:12", emphasized: false)
                    headerSeparator
                    headerMeta("출처 12개 채널", emphasized: false)
                }
            }
            .frame(minWidth: 0, alignment: .leading)
        }
    }

    private var headerActions: some View {
        HStack(spacing: 6) {
            OpenDesignNewsActionButton(icon: "line.3.horizontal", title: "그룹: Value별", tone: .ghost, action: {})
            OpenDesignNewsActionButton(icon: "clock", title: "최신순", tone: .ghost, action: {})
            OpenDesignNewsActionButton(
                icon: unreadCount == 0 ? "arrow.counterclockwise" : "checkmark",
                title: unreadCount == 0 ? "안 읽음으로 되돌리기" : "모두 읽음 처리",
                tone: .accent,
                action: markAll
            )
        }
        .fixedSize(horizontal: true, vertical: false)
    }

    private func headerMeta(_ text: String, emphasized: Bool) -> some View {
        Text(text)
            .font(.system(size: 11, weight: .medium, design: .monospaced))
            .foregroundStyle(emphasized ? OpenDesignDayColor.fgSecondary : OpenDesignDayColor.muted)
            .lineLimit(1)
    }

    private var headerSeparator: some View {
        Text("·")
            .font(.system(size: 11, weight: .medium, design: .monospaced))
            .foregroundStyle(OpenDesignDayColor.mutedDeep)
    }
}

private struct OpenDesignNewsFilterBar: View {
    let selectedFilter: OpenDesignNewsFilter
    let horizontalPadding: CGFloat
    let displayCount: (OpenDesignNewsFilter) -> String
    let select: (OpenDesignNewsFilter) -> Void

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                ForEach(OpenDesignNewsCatalog.filterDescriptors) { descriptor in
                    OpenDesignNewsFilterChip(
                        descriptor: descriptor,
                        count: displayCount(descriptor.id),
                        isActive: selectedFilter == descriptor.id,
                        select: { select(descriptor.id) }
                    )
                }
            }
            .padding(.horizontal, horizontalPadding)
            .frame(height: 48)
        }
        .background(OpenDesignDayColor.bg)
        .overlay(Rectangle().fill(OpenDesignDayColor.borderSoft).frame(height: 1), alignment: .bottom)
    }
}

private struct OpenDesignNewsFilterChip: View {
    let descriptor: OpenDesignNewsFilterDescriptor
    let count: String
    let isActive: Bool
    let select: () -> Void
    @State private var isHovered = false

    var body: some View {
        Button(action: select) {
            HStack(spacing: 7) {
                if descriptor.showsDot {
                    Circle()
                        .fill(descriptor.tone.color)
                        .frame(width: 8, height: 8)
                }
                if descriptor.id == .all {
                    countPill
                    Text(descriptor.title)
                } else {
                    Text(descriptor.title)
                    countPill
                }
            }
            .font(.system(size: 11.5, weight: .medium))
            .foregroundStyle(isActive ? descriptor.tone.color : isHovered ? OpenDesignDayColor.fg : OpenDesignDayColor.fgSecondary)
            .padding(.horizontal, 11)
            .frame(height: 28)
            .background(
                Capsule()
                    .fill(isActive ? descriptor.tone.dim : isHovered ? OpenDesignDayColor.hover : Color.clear)
                    .overlay(Capsule().stroke(isActive ? descriptor.tone.line : OpenDesignDayColor.borderSoft, lineWidth: 1))
            )
        }
        .buttonStyle(.plain)
        .onHover { isHovered = $0 }
    }

    private var countPill: some View {
        Text(count)
            .font(.system(size: 10, weight: .medium, design: .monospaced))
            .foregroundStyle(isActive ? descriptor.tone.color : OpenDesignDayColor.muted)
            .padding(.horizontal, 5)
            .frame(height: 17)
            .background(Capsule().fill(OpenDesignDayColor.bgDarker))
    }
}

private struct OpenDesignNewsTakeawayHero: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            FlowLayout(spacing: 8, lineSpacing: 6) {
                Text("오늘의 한 줄")
                    .font(.system(size: 10, weight: .semibold, design: .monospaced))
                    .foregroundStyle(OpenDesignDayColor.amber)
                    .tracking(1.2)
                    .padding(.horizontal, 8)
                    .frame(height: 20)
                    .background(Capsule().fill(OpenDesignDayColor.amberDim).overlay(Capsule().stroke(OpenDesignDayColor.amberLine, lineWidth: 1)))
                Text("DAY 1 — 고객 후보 · 첫 인터뷰를 정하는 중")
                    .font(.system(size: 10, weight: .medium, design: .monospaced))
                    .foregroundStyle(OpenDesignDayColor.amber)
                    .tracking(1.2)
            }
            .padding(.bottom, 8)

            Text(quote)
                .lineSpacing(7)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.bottom, 10)

            FlowLayout(spacing: 8, lineSpacing: 4) {
                metaText("— Rob Fitzpatrick")
                metaSeparator
                metaText("실제 행동 질문 · Ch. 1", emphasized: true)
                metaSeparator
                metaText("22분 읽기")
                metaSeparator
                metaText("2026-05-13 큐레이션")
            }

            actionButtons
                .padding(.top, 12)
                .overlay(Rectangle().fill(OpenDesignDayColor.borderSoft).frame(height: 1), alignment: .top)
        }
        .padding(EdgeInsets(top: 18, leading: 20, bottom: 16, trailing: 20))
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(referenceAccentEdgeCard(stroke: OpenDesignDayColor.border, accent: OpenDesignDayColor.amber))
        .accessibilityIdentifier("opendesign.reference.news.takeaway")
    }

    private var quote: AttributedString {
        var value = AttributedString()
        appendQuoteRun("\"", to: &value, color: OpenDesignDayColor.fg)
        appendQuoteRun("아이디어를 묻지 마세요.", to: &value, color: OpenDesignDayColor.amber, background: OpenDesignDayColor.amberDim)
        appendQuoteRun(" 지난주에 이 문제 때문에 실제로 뭘 했는지 물으세요. ", to: &value, color: OpenDesignDayColor.fg)
        appendQuoteRun("칭찬은 데이터가 아닙니다.", to: &value, color: OpenDesignDayColor.amber, background: OpenDesignDayColor.amberDim)
        appendQuoteRun("\"", to: &value, color: OpenDesignDayColor.fg)
        return value
    }

    private func appendQuoteRun(_ text: String, to value: inout AttributedString, color: Color, background: Color? = nil) {
        var run = AttributedString(text)
        run.font = .system(size: 18, weight: .medium)
        run.foregroundColor = color
        if let background {
            run.backgroundColor = background
        }
        value += run
    }

    private var actionButtons: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 6) {
                takeawayActions
            }

            VStack(alignment: .leading, spacing: 6) {
                takeawayActions
            }
        }
    }

    @ViewBuilder private var takeawayActions: some View {
        OpenDesignNewsActionButton(icon: "checkmark", title: "오늘 인터뷰 질문에 반영", tone: .accent, action: {})
        OpenDesignNewsActionButton(icon: "bookmark", title: "VALUES.md에 인용 저장", tone: .ghost, action: {})
        OpenDesignNewsActionButton(icon: "info.circle", title: "출처 보기", tone: .ghost, action: {})
    }

    private func metaText(_ text: String, emphasized: Bool = false) -> some View {
        Text(text)
            .font(.system(size: 11, weight: .medium, design: .monospaced))
            .foregroundStyle(emphasized ? OpenDesignDayColor.fgSecondary : OpenDesignDayColor.muted)
    }

    private var metaSeparator: some View {
        Text("·")
            .font(.system(size: 11, weight: .medium, design: .monospaced))
            .foregroundStyle(OpenDesignDayColor.mutedDeep)
    }
}

private struct OpenDesignNewsSectionHeader: View {
    let section: OpenDesignNewsSection

    var body: some View {
        HStack(spacing: 10) {
            RoundedRectangle(cornerRadius: 2, style: .continuous)
                .fill(section.tone.color)
                .frame(width: 4, height: 12)
            Text(section.title)
                .font(.system(size: 11, weight: .medium, design: .monospaced))
                .textCase(.uppercase)
                .foregroundStyle(OpenDesignDayColor.muted)
            Text(section.meta)
                .font(.system(size: 10.5, weight: .medium, design: .monospaced))
                .foregroundStyle(OpenDesignDayColor.mutedDeep)
                .lineLimit(1)
            Rectangle()
                .fill(OpenDesignDayColor.borderSoft)
                .frame(height: 1)
        }
    }
}

private struct OpenDesignNewsArticleCard: View {
    let article: OpenDesignNewsArticle
    let isRead: Bool
    let isSaved: Bool
    let markRead: () -> Void
    let toggleRead: () -> Void
    let toggleSaved: () -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var isHovered = false

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top, spacing: 14) {
                Text(article.sourceMark)
                    .font(.system(size: article.sourceMark.count > 2 ? 9.5 : 12, weight: .bold, design: .monospaced))
                    .foregroundStyle(article.sourceTone.color)
                    .frame(width: 36, height: 36)
                    .background(newsSourceMarkBackground(tone: article.sourceTone))
                    .padding(.top, 1)

                VStack(alignment: .leading, spacing: 0) {
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Text(article.source)
                            .foregroundStyle(OpenDesignDayColor.fgSecondary)
                        Text("·")
                            .foregroundStyle(OpenDesignDayColor.mutedDeep)
                        Text(article.typeLabel)
                            .foregroundStyle(OpenDesignDayColor.accent)
                        Text("·")
                            .foregroundStyle(OpenDesignDayColor.mutedDeep)
                        Text(article.time)
                            .foregroundStyle(OpenDesignDayColor.muted)
                        Spacer(minLength: 8)
                        if article.isPinned {
                            HStack(spacing: 4) {
                                Image(systemName: "pin")
                                Text("오늘 고정")
                            }
                            .foregroundStyle(OpenDesignDayColor.accent)
                        }
                    }
                    .font(.system(size: 10.5, weight: .medium, design: .monospaced))
                    .lineLimit(1)

                    Text(article.title)
                        .font(.system(size: 15, weight: isRead ? .regular : .medium))
                        .foregroundStyle(isRead ? OpenDesignDayColor.fgSecondary : OpenDesignDayColor.fg)
                        .lineSpacing(2)
                        .padding(.top, 6)
                        .fixedSize(horizontal: false, vertical: true)

                    if let original = article.original {
                        Text(original)
                            .font(.system(size: 11, weight: .medium, design: .monospaced))
                            .foregroundStyle(OpenDesignDayColor.mutedDeep)
                            .lineLimit(2)
                            .padding(.top, 4)
                    }

                    if let quote = article.quote {
                        Text(quote)
                            .font(.system(size: 12.5, weight: .regular))
                            .foregroundStyle(OpenDesignDayColor.fgSecondary)
                            .lineSpacing(4)
                            .fixedSize(horizontal: false, vertical: true)
                            .padding(.vertical, 9)
                            .padding(.horizontal, 12)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(OpenDesignDayColor.bgDeep)
                            .overlay(alignment: .leading) {
                                Rectangle()
                                    .fill(OpenDesignDayColor.borderStrong)
                                    .frame(width: 2)
                            }
                            .clipShape(UnevenRoundedRectangle(topLeadingRadius: 0, bottomLeadingRadius: 0, bottomTrailingRadius: 6, topTrailingRadius: 6, style: .continuous))
                            .padding(.top, 8)
                    }

                    VStack(alignment: .leading, spacing: 3) {
                        Text(article.takeLead.uppercased())
                            .font(.system(size: 10, weight: .semibold, design: .monospaced))
                            .foregroundStyle(OpenDesignDayColor.accent)
                        Text(article.takeBody)
                            .font(.system(size: 12.5, weight: .regular))
                            .foregroundStyle(OpenDesignDayColor.fgSecondary)
                            .lineSpacing(4)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .padding(.top, 8)

                    OpenDesignNewsArticleFooter(
                        article: article,
                        isRead: isRead,
                        isSaved: isSaved,
                        toggleRead: toggleRead,
                        toggleSaved: toggleSaved
                    )
                    .padding(.top, 10)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .padding(EdgeInsets(top: 16, leading: 22, bottom: 16, trailing: 18))
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(referenceRounded(fill: isHovered ? OpenDesignDayColor.surface2 : OpenDesignDayColor.surface, stroke: article.isPinned ? OpenDesignDayColor.accentLine : isHovered ? OpenDesignDayColor.border : OpenDesignDayColor.borderSoft, radius: 12))
        .opacity(isRead ? (isHovered ? 0.82 : 0.55) : 1)
        .overlay(alignment: .topLeading) {
            if !isRead {
                Circle()
                    .fill(OpenDesignDayColor.accent)
                    .shadow(color: OpenDesignDayColor.accent.opacity(0.75), radius: 4)
                    .frame(width: 7, height: 7)
                    .padding(.leading, 8)
                    .padding(.top, 24)
                    .transition(reduceMotion ? .opacity : .scale.combined(with: .opacity))
            }
        }
        .contentShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .onTapGesture(perform: markRead)
        .onHover { isHovered = $0 }
        .animation(.easeOut(duration: reduceMotion ? 0 : 0.14), value: isRead)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(article.title)
        .accessibilityValue(isRead ? "읽음" : "안 읽음")
    }
}

private struct OpenDesignNewsArticleFooter: View {
    let article: OpenDesignNewsArticle
    let isRead: Bool
    let isSaved: Bool
    let toggleRead: () -> Void
    let toggleSaved: () -> Void

    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 8) {
                tags
                Spacer(minLength: 8)
                applyLabel
                footerButtons
            }

            VStack(alignment: .leading, spacing: 9) {
                tags
                HStack(spacing: 8) {
                    applyLabel
                    Spacer(minLength: 8)
                    footerButtons
                }
            }
        }
        .padding(.top, 10)
        .overlay(Rectangle().fill(OpenDesignDayColor.borderSoft).frame(height: 1), alignment: .top)
    }

    private var tags: some View {
        FlowLayout(spacing: 6, lineSpacing: 6) {
            ForEach(OpenDesignNewsCatalog.filterDescriptors.filter { descriptor in
                descriptor.id != .all && article.values.contains(descriptor.id)
            }) { descriptor in
                OpenDesignNewsValueTag(descriptor: descriptor)
            }
        }
    }

    private var applyLabel: some View {
        Text("적용 시점 · \(article.applyWhen)")
            .font(.system(size: 10.5, weight: .medium, design: .monospaced))
            .foregroundStyle(OpenDesignDayColor.muted)
            .lineLimit(1)
    }

    private var footerButtons: some View {
        HStack(spacing: 6) {
            OpenDesignNewsIconButton(icon: isRead ? "checkmark" : "circle.fill", title: isRead ? "안 읽음으로 표시" : "읽음으로 표시", isOn: isRead, action: toggleRead)
            OpenDesignNewsIconButton(icon: isSaved ? "bookmark.fill" : "bookmark", title: isSaved ? "저장됨" : "저장", isOn: isSaved, action: toggleSaved)
            OpenDesignNewsIconButton(icon: "square.and.arrow.up", title: "공유", isOn: false, action: {})
            OpenDesignNewsIconButton(icon: "arrow.up.right", title: "원문", isOn: false, action: {})
        }
    }
}

private struct OpenDesignNewsValueTag: View {
    let descriptor: OpenDesignNewsFilterDescriptor

    var body: some View {
        HStack(spacing: 5) {
            Circle()
                .fill(descriptor.tone.color)
                .frame(width: 6, height: 6)
            Text(descriptor.title)
        }
        .font(.system(size: 10.5, weight: .medium, design: .monospaced))
        .foregroundStyle(descriptor.tone.color)
        .padding(.horizontal, 8)
        .frame(height: 22)
        .background(Capsule().fill(descriptor.tone.dim).overlay(Capsule().stroke(descriptor.tone.line, lineWidth: 1)))
    }
}

private struct OpenDesignNewsMetaPanelView: View {
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                Text("왜 이 리서치인가")
                    .font(.system(size: 10, weight: .medium, design: .monospaced))
                    .textCase(.uppercase)
                    .foregroundStyle(OpenDesignDayColor.muted)

                VStack(alignment: .leading, spacing: 8) {
                    Text("VALUES.md의 6개 원칙을 외부 1차 자료로 보강했습니다. 이번 주는 고객 후보가 Day 1-7 초기 검증 단계라, 고객 인터뷰 · 첫 매출 · 공개 기록 첫 글에 직접 쓸 수 있는 자료를 우선 큐레이션했습니다.")
                        .font(.system(size: 12, weight: .regular))
                        .foregroundStyle(OpenDesignDayColor.fgSecondary)
                        .lineSpacing(4)
                        .fixedSize(horizontal: false, vertical: true)
                    Rectangle()
                        .fill(OpenDesignDayColor.borderSoft)
                        .frame(height: 1)
                    Text(whyCardFooterText)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .padding(14)
                .background(referenceRounded(fill: OpenDesignDayColor.surface, stroke: OpenDesignDayColor.borderSoft, radius: 10))

                sideHeader("VALUES 커버리지")
                VStack(spacing: 6) {
                    ForEach(OpenDesignNewsCatalog.coverage) { row in
                        OpenDesignNewsCoverageRow(row: row)
                    }
                }

                sideHeader("오늘 (Day 1) 추천 3건")
                VStack(spacing: 0) {
                    ForEach(Array(OpenDesignNewsCatalog.recommendations.enumerated()), id: \.element.id) { index, recommendation in
                        OpenDesignNewsRecommendationRow(recommendation: recommendation, showsTopBorder: index > 0)
                    }
                }

                sideHeader("구독 중인 출처")
                VStack(spacing: 6) {
                    ForEach(OpenDesignNewsCatalog.sources) { source in
                        OpenDesignNewsSourcePill(source: source)
                    }
                }

                sideHeader("VALUES.md 동기화")
                Text("저장한 리서치 인용은 VALUES.md 하단 \"참고 자료\" 섹션에 자동으로 누적됩니다. 마지막 동기화 2026-05-16 23:41 · 7건 인용.")
                    .font(.system(size: 12, weight: .regular))
                    .foregroundStyle(OpenDesignDayColor.fgSecondary)
                    .lineSpacing(4)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(14)
                    .background(referenceRounded(fill: OpenDesignDayColor.surface, stroke: OpenDesignDayColor.borderSoft, radius: 10))
            }
            .padding(EdgeInsets(top: 16, leading: 18, bottom: 24, trailing: 18))
        }
        .background(OpenDesignDayColor.bg)
        .overlay(Rectangle().fill(OpenDesignDayColor.borderSoft).frame(width: 1), alignment: .leading)
    }

    private func sideHeader(_ text: String) -> some View {
        Text(text)
            .font(.system(size: 10, weight: .medium, design: .monospaced))
            .textCase(.uppercase)
            .foregroundStyle(OpenDesignDayColor.muted)
            .padding(.top, 4)
    }

    private var whyCardFooterText: AttributedString {
        var text = AttributedString()
        var prefix = AttributedString("큐레이션 기준 · ")
        var emphasis = AttributedString("VALUES.md + 현재 Day")
        var suffix = AttributedString(" · 6 source × 14 items")
        let footerFont = Font.system(size: 10.5, weight: .medium, design: .monospaced)

        prefix.font = footerFont
        prefix.foregroundColor = OpenDesignDayColor.mutedDeep
        emphasis.font = footerFont
        emphasis.foregroundColor = OpenDesignDayColor.accent
        suffix.font = footerFont
        suffix.foregroundColor = OpenDesignDayColor.mutedDeep

        text.append(prefix)
        text.append(emphasis)
        text.append(suffix)
        return text
    }
}

private struct OpenDesignNewsCoverageRow: View {
    let row: OpenDesignNewsCoverage

    var body: some View {
        VStack(spacing: 4) {
            HStack(spacing: 8) {
                Circle()
                    .fill(row.tone.color)
                    .frame(width: 8, height: 8)
                    .frame(width: 14)
                Text(row.title)
                    .font(.system(size: 11.5, weight: .medium))
                    .foregroundStyle(OpenDesignDayColor.fgSecondary)
                    .lineLimit(1)
                Spacer(minLength: 4)
                Text(row.count)
                    .font(.system(size: 10.5, weight: .medium, design: .monospaced))
                    .foregroundStyle(OpenDesignDayColor.muted)
            }

            GeometryReader { geometry in
                ZStack(alignment: .leading) {
                    RoundedRectangle(cornerRadius: 2, style: .continuous)
                        .fill(OpenDesignDayColor.bgDarker)
                        .overlay(RoundedRectangle(cornerRadius: 2, style: .continuous).stroke(OpenDesignDayColor.borderSoft, lineWidth: 1))
                    RoundedRectangle(cornerRadius: 2, style: .continuous)
                        .fill(row.tone.color)
                        .frame(width: geometry.size.width * row.progress)
                }
            }
            .frame(height: 4)
        }
        .padding(.bottom, 4)
    }
}

private struct OpenDesignNewsRecommendationRow: View {
    let recommendation: OpenDesignNewsRecommendation
    let showsTopBorder: Bool
    @State private var isHovered = false

    var body: some View {
        HStack(alignment: .top, spacing: 9) {
            Text(recommendation.rank)
                .font(.system(size: 11, weight: .medium, design: .monospaced))
                .foregroundStyle(OpenDesignDayColor.accent)
                .frame(width: 22, alignment: .leading)
                .padding(.top, 1)
            VStack(alignment: .leading, spacing: 2) {
                Text(recommendation.title)
                    .font(.system(size: 12, weight: .regular))
                    .foregroundStyle(isHovered ? OpenDesignDayColor.fg : OpenDesignDayColor.fgSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                Text(recommendation.meta)
                    .font(.system(size: 10, weight: .medium, design: .monospaced))
                    .foregroundStyle(OpenDesignDayColor.muted)
            }
        }
        .padding(.vertical, 8)
        .overlay(alignment: .top) {
            if showsTopBorder {
                Rectangle()
                    .fill(OpenDesignDayColor.borderSoft)
                    .frame(height: 1)
            }
        }
        .onHover { isHovered = $0 }
    }
}

private struct OpenDesignNewsSourcePill: View {
    let source: OpenDesignNewsSource
    @State private var isHovered = false

    var body: some View {
        HStack(spacing: 8) {
            Text(source.mark)
                .font(.system(size: 8, weight: .medium, design: .monospaced))
                .foregroundStyle(source.tone.color)
                .frame(width: 14, height: 14)
                .background(referenceRounded(fill: OpenDesignDayColor.bgDeep, stroke: OpenDesignDayColor.border, radius: 4))
            Text(source.title)
                .font(.system(size: 11.5, weight: .regular))
                .foregroundStyle(isHovered ? OpenDesignDayColor.fg : OpenDesignDayColor.fgSecondary)
                .lineLimit(1)
            if source.isSubscribed {
                Text("SUB")
                    .font(.system(size: 9, weight: .semibold, design: .monospaced))
                    .foregroundStyle(OpenDesignDayColor.accent)
                    .padding(.horizontal, 5)
                    .frame(height: 16)
                    .background(Capsule().fill(OpenDesignDayColor.accentDim).overlay(Capsule().stroke(OpenDesignDayColor.accentLine, lineWidth: 1)))
                    .padding(.leading, 4)
            }
            Spacer(minLength: 4)
            if let count = source.count {
                Text(count)
                    .font(.system(size: 10, weight: .medium, design: .monospaced))
                    .foregroundStyle(OpenDesignDayColor.muted)
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 7)
        .background(referenceRounded(fill: isHovered ? OpenDesignDayColor.hover : OpenDesignDayColor.surface, stroke: OpenDesignDayColor.borderSoft, radius: 8))
        .onHover { isHovered = $0 }
    }
}

private struct OpenDesignNewsActionButton: View {
    enum Tone {
        case ghost
        case accent
    }

    let icon: String
    let title: String
    let tone: Tone
    let isDisabled: Bool
    let action: () -> Void
    @State private var isHovered = false

    init(icon: String, title: String, tone: Tone, isDisabled: Bool = false, action: @escaping () -> Void) {
        self.icon = icon
        self.title = title
        self.tone = tone
        self.isDisabled = isDisabled
        self.action = action
    }

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                Image(systemName: icon)
                    .font(.system(size: 11, weight: .semibold))
                Text(title)
            }
            .font(.system(size: 11.5, weight: tone == .accent ? .semibold : .medium))
            .foregroundStyle(foreground)
            .padding(.horizontal, tone == .accent ? 14 : 12)
            .frame(height: 28)
            .background(
                referenceRounded(
                    fill: fill,
                    stroke: tone == .accent ? Color.clear : OpenDesignDayColor.borderSoft,
                    radius: 8
                )
            )
        }
        .buttonStyle(.plain)
        .disabled(isDisabled)
        .onHover { isHovered = $0 }
        .accessibilityLabel(title)
    }

    private var foreground: Color {
        if isDisabled { return OpenDesignDayColor.mutedDeep }
        if tone == .accent { return OpenDesignDayColor.bgDeep }
        return isHovered ? OpenDesignDayColor.fg : OpenDesignDayColor.fgSecondary
    }

    private var fill: Color {
        if isDisabled { return OpenDesignDayColor.bgDeep }
        if tone == .accent {
            return isHovered ? OpenDesignDayColor.accentStrong : OpenDesignDayColor.accent
        }
        return isHovered ? OpenDesignDayColor.hover : Color.clear
    }
}

private struct OpenDesignNewsIconButton: View {
    let icon: String
    let title: String
    let isOn: Bool
    let action: () -> Void
    @State private var isHovered = false

    var body: some View {
        Button(action: action) {
            Image(systemName: icon)
                .font(.system(size: 10.5, weight: .semibold))
                .foregroundStyle(isOn ? OpenDesignDayColor.accent : isHovered ? OpenDesignDayColor.fg : OpenDesignDayColor.muted)
                .frame(width: 24, height: 24)
                .background(referenceRounded(fill: isOn ? OpenDesignDayColor.accentDim : isHovered ? OpenDesignDayColor.hover : Color.clear, stroke: isOn ? OpenDesignDayColor.accentLine : OpenDesignDayColor.borderSoft, radius: 6))
        }
        .buttonStyle(.plain)
        .help(title)
        .onHover { isHovered = $0 }
        .accessibilityLabel(title)
    }
}

private func newsSourceMarkBackground(tone: OpenDesignReferenceTone) -> some View {
    RoundedRectangle(cornerRadius: 9, style: .continuous)
        .fill(
            LinearGradient(
                colors: [tone.dim.opacity(1.0), OpenDesignDayColor.bgDeep],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        )
        .overlay(RoundedRectangle(cornerRadius: 9, style: .continuous).stroke(tone.line, lineWidth: 1))
}

struct OpenDesignReferenceTitlebar: View {
    let page: OpenDesignReferencePageModel
    let openSearch: () -> Void
    let isRightSidebarVisible: Bool
    let toggleRightSidebar: () -> Void
    var refreshAction: (() -> Void)? = nil

    var body: some View {
        ZStack {
            HStack(spacing: 8) {
                Spacer(minLength: 82)
                Text(page.titlebarTitle)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(OpenDesignDayColor.fg)
                Text("/")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(OpenDesignDayColor.mutedDeep)
                Text(page.titlebarDetail)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(OpenDesignDayColor.fgSecondary)
                    .lineLimit(1)
                Spacer(minLength: 0)
            }

            HStack(spacing: 4) {
                Spacer()
                OpenDesignReferenceToolbarButton(systemImage: "magnifyingglass", label: "검색 · ⌘ K", action: openSearch)
                if page.kind == .projects {
                    OpenDesignReferenceToolbarButton(systemImage: "square.and.arrow.up", label: "공유", action: {})
                }
                if page.kind == .news || page.kind == .bipLog {
                    OpenDesignReferenceToolbarButton(systemImage: "arrow.clockwise", label: "새로고침", action: refreshAction ?? {})
                }
                if page.kind == .projects || page.kind == .settings || page.kind == .interviews || page.kind == .history || page.kind == .news {
                    OpenDesignReferenceToolbarButton(
                        systemImage: "sidebar.right",
                        label: isRightSidebarVisible ? "우측 사이드바 닫기" : "우측 사이드바 열기",
                        isOn: isRightSidebarVisible,
                        accessibilityIdentifier: "opendesign.reference.meta.toggle",
                        action: toggleRightSidebar
                    )
                }
            }
            .padding(.trailing, 12)
        }
        .frame(height: 36)
        .background(OpenDesignDayColor.bg)
        .overlay(Rectangle().fill(OpenDesignDayColor.borderSoft).frame(height: 1), alignment: .bottom)
        .openDesignWindowTitlebarAccessibility()
    }
}

struct OpenDesignReferenceShell: View {
    let kind: OpenDesignReferencePageKind
    let layout: OpenDesignDayLayoutMetrics
    let openSearch: () -> Void
    var newsMarketRadar: NewsMarketRadarSnapshot = .empty
    var refreshNewsMarketRadar: () -> Void = {}
    var prepareNewsMarketRadar: () -> Void = {}
    var bipResearch: BipResearchSnapshot = .empty
    var refreshBipResearch: () -> Void = {}
    var prepareBipResearch: () -> Void = {}
    var openNewsSettings: () -> Void = {}
    var workHistory: WorkHistorySnapshot = .empty
    var refreshWorkHistory: () -> Void = {}
    var prepareWorkHistory: () -> Void = {}

    private var page: OpenDesignReferencePageModel {
        OpenDesignReferenceCatalog.page(kind)
    }

    var body: some View {
        if kind == .interviews {
            OpenDesignInterviewsShell(layout: layout)
        } else if kind == .news {
            OpenDesignNewsShell(
                layout: layout,
                openSearch: openSearch,
                snapshot: newsMarketRadar,
                refresh: refreshNewsMarketRadar,
                prepare: prepareNewsMarketRadar,
                openSettings: openNewsSettings
            )
        } else if kind == .bipLog {
            OpenDesignBipLogShell(
                layout: layout,
                openSearch: openSearch,
                snapshot: bipResearch,
                refresh: refreshBipResearch,
                prepare: prepareBipResearch,
                openSettings: openNewsSettings
            )
        } else if kind == .history {
            OpenDesignHistoryShell(
                layout: layout,
                openSearch: openSearch,
                snapshot: workHistory,
                refresh: refreshWorkHistory,
                prepare: prepareWorkHistory
            )
        } else if kind == .projects {
            OpenDesignProjectsShell(layout: layout, openSearch: openSearch)
        } else if kind == .settings {
            OpenDesignSettingsReferenceShell(page: page, layout: layout, openSearch: openSearch)
        } else {
            if layout.showsTaskSidebar {
                OpenDesignReferenceSidebarView(page: page, openSearch: openSearch)
                    .frame(width: layout.taskSidebarWidth)
                    .frame(maxHeight: .infinity)
                    .background(OpenDesignDayColor.bg)
                    .transition(.opacity)
                    .accessibilityIdentifier("opendesign.reference.\(kind.rawValue).side")
            }

            OpenDesignReferenceMainView(page: page, layout: layout)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .accessibilityIdentifier("opendesign.reference.\(kind.rawValue).main")

            if layout.showsMetaPanel {
                OpenDesignReferenceMetaPanelView(page: page)
                    .frame(width: layout.metaPanelWidth)
                    .frame(maxHeight: .infinity)
                    .background(OpenDesignDayColor.bg)
                    .accessibilityIdentifier("opendesign.reference.\(kind.rawValue).meta")
            }
        }
    }
}

private struct OpenDesignSettingsReferenceShell: View {
    let page: OpenDesignReferencePageModel
    let layout: OpenDesignDayLayoutMetrics
    let openSearch: () -> Void

    var body: some View {
        Group {
            if layout.showsTaskSidebar {
                OpenDesignSettingsSidebarView(page: page, openSearch: openSearch)
                    .frame(width: layout.taskSidebarWidth)
                    .frame(maxHeight: .infinity)
                    .background(OpenDesignDayColor.bg)
                    .transition(.opacity)
                    .accessibilityIdentifier("opendesign.reference.settings.side")
            }

            OpenDesignSettingsMainView(page: page, layout: layout)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .accessibilityIdentifier("opendesign.reference.settings.main")

            if layout.showsMetaPanel {
                OpenDesignSettingsMetaPanelView()
                    .frame(width: layout.metaPanelWidth)
                    .frame(maxHeight: .infinity)
                    .background(OpenDesignDayColor.bg)
                    .accessibilityIdentifier("opendesign.reference.settings.meta")
            }
        }
    }
}

private struct OpenDesignSettingsSidebarView: View {
    let page: OpenDesignReferencePageModel
    let openSearch: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 6) {
                Text(page.sideTitle)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(OpenDesignDayColor.fg)
                Spacer(minLength: 0)
            }
            .padding(.top, 10)
            .padding(.horizontal, 12)
            .padding(.bottom, 8)

            Button(action: openSearch) {
                HStack(spacing: 8) {
                    Image(systemName: "magnifyingglass")
                        .font(.system(size: 10, weight: .medium))
                    Text(page.sideSearchPlaceholder ?? "설정 검색")
                    Spacer(minLength: 6)
                    Text("⌘ K")
                        .font(.system(size: 10, weight: .medium, design: .monospaced))
                        .foregroundStyle(OpenDesignDayColor.mutedDeep)
                }
                .font(.system(size: 11.5, weight: .medium))
                .foregroundStyle(OpenDesignDayColor.fgSecondary)
                .padding(.horizontal, 10)
                .frame(height: 30)
                .background(referenceRounded(fill: OpenDesignDayColor.surface, stroke: OpenDesignDayColor.borderSoft, radius: 6))
            }
            .buttonStyle(.plain)
            .padding(.horizontal, 8)
            .padding(.bottom, 6)

            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0) {
                    ForEach(page.sideGroups.indices, id: \.self) { groupIndex in
                        let group = page.sideGroups[groupIndex]
                        Text(group.title)
                            .font(.system(size: 10, weight: .medium, design: .monospaced))
                            .textCase(.uppercase)
                            .tracking(1)
                            .foregroundStyle(OpenDesignDayColor.mutedDeep)
                            .padding(.top, groupIndex == 0 ? 8 : 14)
                            .padding(.horizontal, 8)
                            .padding(.bottom, 6)

                        ForEach(group.rows) { row in
                            OpenDesignSettingsSideRowView(row: row)
                        }
                    }
                }
                .padding(.horizontal, 6)
                .padding(.bottom, 14)
            }
        }
        .background(OpenDesignDayColor.bg)
        .overlay(Rectangle().fill(OpenDesignDayColor.borderSoft).frame(width: 1), alignment: .trailing)
    }
}

private struct OpenDesignSettingsSideRowView: View {
    let row: OpenDesignReferenceSideRow
    @State private var isHovered = false

    private var systemImage: String {
        switch row.id {
        case "workspace": return "folder"
        case "appearance": return "circle.lefthalf.filled"
        case "menubar": return "bell"
        case "providers": return "chevron.left.forwardslash.chevron.right"
        case "integrations": return "link"
        case "privacy": return "shield"
        case "updates": return "arrow.triangle.2.circlepath"
        case "advanced": return "terminal"
        default: return "circle"
        }
    }

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: systemImage)
                .font(.system(size: 12.2, weight: .medium))
                .symbolRenderingMode(.monochrome)
                .foregroundStyle(row.isActive ? row.tone.color : OpenDesignDayColor.muted)
                .frame(width: 22, height: 22)

            Text(row.title)
                .font(.system(size: 12.5, weight: .medium))
                .foregroundStyle(row.isActive || isHovered ? OpenDesignDayColor.fg : OpenDesignDayColor.fgSecondary)
                .lineLimit(1)

            Spacer(minLength: 6)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 7)
        .background(referenceRounded(fill: row.isActive ? OpenDesignDayColor.selected : isHovered ? OpenDesignDayColor.hover : Color.clear, stroke: Color.clear, radius: 6))
        .contentShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
        .onHover { isHovered = $0 }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(row.title)
        .accessibilityValue(row.isActive ? "active" : "inactive")
    }
}

private struct OpenDesignSettingsMainView: View {
    let page: OpenDesignReferencePageModel
    let layout: OpenDesignDayLayoutMetrics

    var body: some View {
        VStack(spacing: 0) {
            OpenDesignSettingsHeaderView(header: page.header, horizontalPadding: layout.mainHorizontalPadding)

            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(page.sections.indices, id: \.self) { index in
                        OpenDesignSettingsSectionView(section: page.sections[index], isFirstContentSection: index == 0)
                    }
                }
                .frame(maxWidth: 820, alignment: .leading)
                .padding(.horizontal, layout.mainHorizontalPadding)
                .padding(.top, 22)
                .padding(.bottom, 60)
                .frame(maxWidth: .infinity)
            }
            .background(OpenDesignDayColor.bg)
        }
        .background(OpenDesignDayColor.bg)
    }
}

private struct OpenDesignSettingsHeaderView: View {
    let header: OpenDesignReferenceHeaderModel
    let horizontalPadding: CGFloat

    var body: some View {
        HStack(spacing: 12) {
            HStack(spacing: 14) {
                Image(systemName: "gearshape")
                    .font(.system(size: 20, weight: .medium))
                    .foregroundStyle(OpenDesignDayColor.fgSecondary)
                    .frame(width: 44, height: 44)
                    .background(referenceRounded(fill: OpenDesignDayColor.surface, stroke: OpenDesignDayColor.border, radius: 11))

                VStack(alignment: .leading, spacing: 3) {
                    Text(header.title)
                        .font(.system(size: 17, weight: .semibold))
                        .foregroundStyle(OpenDesignDayColor.fg)
                        .lineLimit(1)

                    HStack(spacing: 8) {
                        Circle()
                            .fill(OpenDesignDayColor.accent)
                            .frame(width: 5, height: 5)
                            .shadow(color: OpenDesignDayColor.accentDim, radius: 3)
                        ForEach(Array(header.subtitleParts.enumerated()), id: \.offset) { index, part in
                            if index > 0 {
                                Text("·")
                                    .foregroundStyle(OpenDesignDayColor.mutedDeep)
                            }
                            Text(part)
                                .lineLimit(1)
                        }
                    }
                    .font(.system(size: 11, weight: .medium, design: .monospaced))
                    .foregroundStyle(OpenDesignDayColor.muted)
                }
                .frame(minWidth: 0, alignment: .leading)
            }

            Spacer(minLength: 12)

            ForEach(header.actions) { action in
                OpenDesignReferenceActionButton(action: action)
            }
        }
        .padding(.horizontal, horizontalPadding)
        .frame(height: 70)
        .background(OpenDesignDayColor.bg)
        .overlay(Rectangle().fill(OpenDesignDayColor.borderSoft).frame(height: 1), alignment: .bottom)
    }
}

private struct OpenDesignSettingsSectionView: View {
    let section: OpenDesignReferenceSectionModel
    let isFirstContentSection: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 10) {
                RoundedRectangle(cornerRadius: 2, style: .continuous)
                    .fill(section.markerTone.color)
                    .frame(width: 4, height: 12)
                Text(section.title)
                    .font(.system(size: 11, weight: .medium, design: .monospaced))
                    .textCase(.uppercase)
                    .foregroundStyle(OpenDesignDayColor.muted)
                if let meta = section.meta {
                    Text(meta)
                        .font(.system(size: 10.5, weight: .medium, design: .monospaced))
                        .foregroundStyle(OpenDesignDayColor.mutedDeep)
                        .lineLimit(1)
                }
                Rectangle()
                    .fill(OpenDesignDayColor.borderSoft)
                    .frame(height: 1)
            }
            .padding(.top, isFirstContentSection ? 10 : 26)

            ForEach(section.blocks) { block in
                OpenDesignSettingsBlockView(sectionID: section.id, block: block)
            }
        }
    }
}

private struct OpenDesignSettingsBlockView: View {
    let sectionID: String
    let block: OpenDesignReferenceBlock

    var body: some View {
        switch block.style {
        case .settings:
            OpenDesignSettingsRowsCard(sectionID: sectionID, rows: block.rows)
        case .cards where sectionID == "providers":
            OpenDesignSettingsProviderList(rows: block.rows)
        case .rows where sectionID == "integrations":
            OpenDesignSettingsIntegrationCard(rows: block.rows)
        default:
            OpenDesignReferenceBlockView(block: block, layout: OpenDesignDayLayoutMetrics(width: 1180))
        }
    }
}

private struct OpenDesignSettingsRowsCard: View {
    let sectionID: String
    let rows: [OpenDesignReferenceRow]

    var body: some View {
        VStack(spacing: 0) {
            ForEach(rows) { row in
                OpenDesignSettingsRowView(sectionID: sectionID, row: row)
                if row.id != rows.last?.id {
                    Rectangle().fill(OpenDesignDayColor.borderSoft).frame(height: 1)
                }
            }
        }
        .background(referenceRounded(fill: OpenDesignDayColor.surface, stroke: OpenDesignDayColor.borderSoft, radius: 12))
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
    }
}

private struct OpenDesignSettingsRowView: View {
    let sectionID: String
    let row: OpenDesignReferenceRow

    var body: some View {
        HStack(alignment: .center, spacing: 16) {
            VStack(alignment: .leading, spacing: 3) {
                Text(row.title)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(OpenDesignDayColor.fg)
                if let subtitle = row.subtitle {
                    Text(settingsInlineText(subtitle))
                        .font(.system(size: 12, weight: .regular))
                        .foregroundStyle(OpenDesignDayColor.muted)
                        .lineSpacing(2.5)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .frame(minWidth: 0, alignment: .leading)

            Spacer(minLength: 12)

            trailingControl
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
    }

    @ViewBuilder
    private var trailingControl: some View {
        if sectionID == "workspace" {
            workspaceControl
        } else if sectionID == "appearance" {
            appearanceControl
        } else if sectionID == "menubar" {
            menubarControl
        } else if sectionID == "privacy" {
            privacyControl
        } else if sectionID == "updates" {
            updatesControl
        } else if sectionID == "advanced" {
            advancedControl
        } else if let trailing = row.trailing {
            settingsStatusPill(trailing, tone: row.tone)
        }
    }

    @ViewBuilder
    private var workspaceControl: some View {
        switch row.id {
        case "main":
            HStack(spacing: 8) {
                OpenDesignSettingsPathPill(
                    text: row.trailing ?? "비어 있음",
                    tone: row.tone,
                    isStale: false
                )
                settingsGhostButton("변경...", width: 70)
            }
        default:
            if let trailing = row.trailing {
                settingsStatusPill(trailing, tone: row.tone)
            }
        }
    }

    @ViewBuilder
    private var appearanceControl: some View {
        switch row.id {
        case "theme":
            OpenDesignSettingsSegmented(values: ["Dark", "Light"], active: row.trailing ?? "Dark", tone: .sky)
        default:
            settingsNeutralPill(row.trailing ?? "")
        }
    }

    @ViewBuilder
    private var menubarControl: some View {
        switch row.id {
        case "login":
            OpenDesignSettingsToggle(isOn: true)
        default:
            settingsNeutralPill(row.trailing ?? "")
        }
    }

    @ViewBuilder
    private var privacyControl: some View {
        switch row.id {
        case "posthog":
            OpenDesignSettingsToggle(isOn: false)
        case "reset":
            settingsGhostButton(row.trailing ?? "데이터 초기화...", width: 118, tone: .rose)
        default:
            settingsGhostButton(row.trailing ?? "내보내기...", width: 104)
        }
    }

    @ViewBuilder
    private var updatesControl: some View {
        switch row.id {
        case "version":
            HStack(spacing: 8) {
                settingsStatusPill("0.4.2", tone: .accent)
                Text("build 1042 · arm64")
                    .font(.system(size: 10.5, weight: .medium, design: .monospaced))
                    .foregroundStyle(OpenDesignDayColor.muted)
            }
        case "auto":
            OpenDesignSettingsToggle(isOn: true)
        case "checked":
            HStack(spacing: 8) {
                Text("5분 전")
                    .font(.system(size: 11.5, weight: .medium, design: .monospaced))
                    .foregroundStyle(OpenDesignDayColor.muted)
                settingsGhostButton("지금 확인", systemImage: "arrow.clockwise", width: 88)
            }
        default:
            settingsStatusPill(row.trailing ?? "검증됨", tone: .accent)
        }
    }

    @ViewBuilder
    private var advancedControl: some View {
        switch row.id {
        case "state":
            HStack(spacing: 8) {
                settingsStatusPill("실행 중", tone: .accent)
                Text("PID 47281 · 86 MB · v0.4.2")
                    .font(.system(size: 11, weight: .medium, design: .monospaced))
                    .foregroundStyle(OpenDesignDayColor.muted)
                settingsGhostButton("재시작", width: 64)
            }
        case "log-folder":
            settingsGhostButton("Finder에서 열기", systemImage: "arrow.up.right.square", width: 124)
        case "bip-notifications":
            HStack(spacing: 8) {
                settingsGhostButton("Snooze", systemImage: "moon", width: 78)
                settingsGhostButton("Open", systemImage: "arrow.up.forward.app", width: 72)
            }
        case "confetti":
            settingsGhostButton("재생", systemImage: "sparkles", width: 72)
        default:
            if let trailing = row.trailing {
                settingsStatusPill(trailing, tone: row.tone)
            }
        }
    }
}

private struct OpenDesignSettingsProviderList: View {
    let rows: [OpenDesignReferenceRow]

    var body: some View {
        VStack(spacing: 8) {
            ForEach(rows) { row in
                VStack(spacing: 0) {
                    HStack(spacing: 10) {
                        if let brandImage = providerBrandImageName(forRowID: row.id) {
                            let fullBleed = providerBrandLogoIsFullBleed(forRowID: row.id)
                            Image(brandImage)
                                .resizable()
                                .interpolation(.high)
                                .scaledToFit()
                                .padding(fullBleed ? 0 : 4)
                                .frame(width: 26, height: 26)
                                .background(referenceRounded(
                                    fill: fullBleed ? Color.clear : OpenDesignDayColor.surface2,
                                    stroke: fullBleed ? Color.clear : OpenDesignDayColor.borderSoft,
                                    radius: 6))
                                .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
                                .accessibilityLabel(Text(row.title))
                        } else {
                            Text(row.leading ?? providerInitial(row.title))
                                .font(.system(size: 12, weight: .bold, design: .monospaced))
                                .foregroundStyle(providerLogoForeground(row))
                                .frame(width: 26, height: 26)
                                .background(providerLogoBackground(row))
                                .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
                        }

                        VStack(alignment: .leading, spacing: 2) {
                            Text(row.title)
                                .font(.system(size: 13, weight: .semibold))
                                .foregroundStyle(OpenDesignDayColor.fg)
                            if let subtitle = row.subtitle {
                                Text(subtitle)
                                    .font(.system(size: 10.5, weight: .medium, design: .monospaced))
                                    .foregroundStyle(OpenDesignDayColor.muted)
                                    .lineLimit(1)
                            }
                        }

                        Spacer(minLength: 10)

                        if let trailing = row.trailing {
                            settingsStatusPill(trailing, tone: row.tone)
                        }

                        if row.id == "codex" {
                            settingsGhostButton("로그인", width: 62)
                        }
                    }
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    .background(OpenDesignDayColor.surface)
                    .overlay(Rectangle().fill(OpenDesignDayColor.borderSoft).frame(height: 1), alignment: .bottom)

                    VStack(spacing: 0) {
                        providerDetailRow(label: "상태", value: row.body ?? row.subtitle ?? "확인 중")
                        providerDetailRow(label: "정책", value: providerPolicy(for: row.id))
                    }
                    .padding(.horizontal, 6)
                    .padding(.vertical, 4)
                }
                .background(referenceRounded(fill: OpenDesignDayColor.bgDarker, stroke: OpenDesignDayColor.borderSoft, radius: 10))
            }
        }
    }

    private func providerDetailRow(label: String, value: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 14) {
            Text(label)
                .font(.system(size: 10.5, weight: .medium, design: .monospaced))
                .textCase(.uppercase)
                .tracking(0.6)
                .foregroundStyle(OpenDesignDayColor.muted)
                .frame(width: 58, alignment: .leading)
            Text(value)
                .font(.system(size: 12, weight: .regular))
                .foregroundStyle(OpenDesignDayColor.fgSecondary)
                .lineLimit(2)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 7)
    }

    private func providerPolicy(for id: String) -> String {
        switch id {
        case "claude":
            return "로컬 인증 또는 API 키"
        case "codex":
            return "로컬 인증 또는 API 키"
        case "gemini":
            return "API 키"
        case "exa":
            return "fallback API key"
        default:
            return "로컬 런타임"
        }
    }
}

private struct OpenDesignSettingsIntegrationCard: View {
    let rows: [OpenDesignReferenceRow]

    var body: some View {
        VStack(spacing: 0) {
            ForEach(rows) { row in
                HStack(spacing: 12) {
                    Text(row.leading ?? "")
                        .font(.system(size: (row.leading ?? "").count > 2 ? 9.5 : 11, weight: .bold, design: .monospaced))
                        .foregroundStyle(row.tone == .muted ? OpenDesignDayColor.fgSecondary : row.tone.color)
                        .frame(width: 28, height: 28)
                        .background(referenceRounded(fill: integrationLogoFill(row), stroke: integrationLogoStroke(row), radius: 7))

                    VStack(alignment: .leading, spacing: 3) {
                        Text(row.title)
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(OpenDesignDayColor.fg)
                        if let subtitle = row.subtitle {
                            Text(subtitle)
                                .font(.system(size: 10.5, weight: .medium, design: .monospaced))
                                .foregroundStyle(OpenDesignDayColor.muted)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                    Spacer(minLength: 12)

                    settingsStatusPill(row.trailing ?? "연결 안 됨", tone: .muted)
                    settingsGhostButton("연결", width: 54)
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 12)

                if row.id != rows.last?.id {
                    Rectangle().fill(OpenDesignDayColor.borderSoft).frame(height: 1)
                }
            }
        }
        .background(referenceRounded(fill: OpenDesignDayColor.surface, stroke: OpenDesignDayColor.borderSoft, radius: 12))
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
    }
}

private struct OpenDesignSettingsPathPill: View {
    let text: String
    let tone: OpenDesignReferenceTone
    let isStale: Bool

    var body: some View {
        HStack(spacing: 7) {
            Image(systemName: isStale ? "exclamationmark.circle" : "folder")
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(isStale ? OpenDesignDayColor.amber : OpenDesignDayColor.muted)
            Text(text)
                .font(.system(size: 11.5, weight: .medium, design: .monospaced))
                .foregroundStyle(isStale ? OpenDesignDayColor.amber : OpenDesignDayColor.fgSecondary)
                .lineLimit(1)
                .truncationMode(.middle)
        }
        .padding(.horizontal, 9)
        .frame(width: 280, height: 30, alignment: .leading)
        .background(referenceRounded(fill: isStale ? OpenDesignDayColor.amberDim : OpenDesignDayColor.bgDarker, stroke: isStale ? OpenDesignDayColor.amberLine : OpenDesignDayColor.borderSoft, radius: 7))
    }
}

private struct OpenDesignSettingsToggle: View {
    let isOn: Bool
    var tone: OpenDesignReferenceTone = .accent
    var locked: Bool = false

    var body: some View {
        ZStack(alignment: isOn ? .trailing : .leading) {
            Capsule()
                .fill(isOn ? tone.color : OpenDesignDayColor.surface2)
                .overlay(Capsule().stroke(isOn ? tone.color : OpenDesignDayColor.border, lineWidth: 1))
                .frame(width: 32, height: 18)
            Circle()
                .fill(isOn ? OpenDesignDayColor.bgDeep : OpenDesignDayColor.muted)
                .frame(width: 12, height: 12)
                .padding(.horizontal, 3)
        }
        .opacity(locked ? 0.6 : 1)
        .accessibilityLabel(isOn ? "켜짐" : "꺼짐")
    }
}

private struct OpenDesignSettingsSegmented: View {
    let values: [String]
    let active: String
    var tone: OpenDesignReferenceTone = .accent

    var body: some View {
        HStack(spacing: 2) {
            ForEach(values, id: \.self) { value in
                Text(value)
                    .font(.system(size: 11.5, weight: .medium, design: .monospaced))
                    .foregroundStyle(value == active ? tone.color : OpenDesignDayColor.muted)
                    .padding(.horizontal, 11)
                    .frame(height: 24)
                    .background(RoundedRectangle(cornerRadius: 6, style: .continuous).fill(value == active ? tone.dim : Color.clear))
            }
        }
        .padding(2)
        .background(referenceRounded(fill: OpenDesignDayColor.bgDarker, stroke: OpenDesignDayColor.borderSoft, radius: 8))
    }
}

private struct OpenDesignSettingsMetaPanelView: View {
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                Text("시스템 상태")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(OpenDesignDayColor.fg)
                    .padding(.bottom, 10)

                OpenDesignSettingsMetaCard(label: "실행 보조 앱", isLive: true) {
                    settingsMetaKeyValue("상태", "실행 중", strong: true)
                    settingsMetaKeyValue("PID", "47281")
                    settingsMetaKeyValue("업타임", "2d 14h")
                    settingsMetaKeyValue("메모리", "86 MB")
                    settingsMetaKeyValue("CPU (5m avg)", "0.4%")
                    HStack {
                        Text("최근 5분 CPU")
                            .font(.system(size: 10, weight: .medium, design: .monospaced))
                            .foregroundStyle(OpenDesignDayColor.muted)
                        Spacer()
                        OpenDesignSettingsSparkline()
                            .frame(width: 64, height: 16)
                    }
                    .padding(.top, 4)
                }
                .padding(.bottom, 12)

                OpenDesignSettingsMetaCard(label: "워크스페이스", isLive: false) {
                    settingsMetaKeyValue("경로", "~/code/agentic30-public", strong: true)
                    settingsMetaKeyValue("상태", "명시됨")
                }
                .padding(.bottom, 26)

                settingsMetaHeading("빠른 작업")
                settingsMetaAction("진단 스냅샷 내보내기", subtitle: "sanitize · ZIP", systemImage: "square.and.arrow.down")
                settingsMetaAction("실행 보조 앱 재시작", subtitle: "다운타임 ~ 1초", systemImage: "arrow.clockwise")

                settingsMetaHeading("참고 문서")
                    .padding(.top, 18)
                settingsMetaAction("release-checklist.md", subtitle: "배포 전 점검 항목", systemImage: "doc")
                settingsMetaAction("known-limitations.md", subtitle: "알려진 제한사항", systemImage: "doc")
                settingsMetaAction("diagnostics-guide.md", subtitle: "진단 가이드", systemImage: "doc")

                settingsMetaHeading("버전")
                    .padding(.top, 18)
                Text("""
                app · 0.4.2 (1042) · arm64
                실행 보조 앱 · 0.4.2
                node · v20.11.1
                swift · 5.10
                macOS · 14.5
                """)
                .font(.system(size: 11, weight: .medium, design: .monospaced))
                .foregroundStyle(OpenDesignDayColor.muted)
                .lineSpacing(4)
                .padding(.horizontal, 6)
            }
            .padding(16)
        }
        .background(OpenDesignDayColor.bg)
        .overlay(Rectangle().fill(OpenDesignDayColor.borderSoft).frame(width: 1), alignment: .leading)
    }
}

private struct OpenDesignSettingsMetaCard<Content: View>: View {
    let label: String
    let isLive: Bool
    @ViewBuilder let content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                Circle()
                    .fill(isLive ? OpenDesignDayColor.accent : OpenDesignDayColor.mutedDeep)
                    .frame(width: 6, height: 6)
                    .shadow(color: isLive ? OpenDesignDayColor.accentDim : .clear, radius: 3)
                Text(label)
                    .font(.system(size: 10.5, weight: .medium, design: .monospaced))
                    .textCase(.uppercase)
                    .foregroundStyle(OpenDesignDayColor.muted)
            }
            content()
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(referenceRounded(fill: OpenDesignDayColor.surface, stroke: OpenDesignDayColor.borderSoft, radius: 10))
    }
}

private struct OpenDesignSettingsSparkline: View {
    private let values: [CGFloat] = [12, 11, 12, 10, 11, 8, 9, 6, 7, 4, 5, 3]

    var body: some View {
        GeometryReader { proxy in
            Path { path in
                guard let first = values.first else { return }
                let step = proxy.size.width / CGFloat(max(values.count - 1, 1))
                path.move(to: CGPoint(x: 0, y: first / 16 * proxy.size.height))
                for (index, value) in values.enumerated().dropFirst() {
                    path.addLine(to: CGPoint(x: CGFloat(index) * step, y: value / 16 * proxy.size.height))
                }
            }
            .stroke(OpenDesignDayColor.accent, style: StrokeStyle(lineWidth: 1.2, lineJoin: .round))
        }
    }
}

private struct OpenDesignInterviewsShell: View {
    let layout: OpenDesignDayLayoutMetrics

    var body: some View {
        Group {
            if layout.showsTaskSidebar {
                ZStack {
                    OpenDesignInterviewsSidebar()
                    Color.clear
                        .accessibilityElement(children: .ignore)
                        .accessibilityLabel("OpenDesign Interviews Side")
                        .accessibilityIdentifier("opendesign.reference.interviews.side")
                        .allowsHitTesting(false)
                }
                .frame(width: layout.taskSidebarWidth)
                .frame(maxHeight: .infinity)
                .background(OpenDesignDayColor.bg)
                .transition(.opacity)
                .accessibilityElement(children: .contain)
                .accessibilityLabel("OpenDesign Interviews Side")
                .accessibilityIdentifier("opendesign.reference.interviews.side")
            }

            ZStack {
                OpenDesignInterviewsMain(layout: layout)
                Color.clear
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel("OpenDesign Interviews Main")
                    .accessibilityIdentifier("opendesign.reference.interviews.main")
                    .allowsHitTesting(false)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .accessibilityElement(children: .contain)
            .accessibilityLabel("OpenDesign Interviews Main")
            .accessibilityIdentifier("opendesign.reference.interviews.main")

            if layout.showsMetaPanel {
                ZStack {
                    OpenDesignInterviewsMetaPanel()
                    Color.clear
                        .accessibilityElement(children: .ignore)
                        .accessibilityLabel("OpenDesign Interviews Meta")
                        .accessibilityIdentifier("opendesign.reference.interviews.meta")
                        .allowsHitTesting(false)
                }
                .frame(width: layout.metaPanelWidth)
                .frame(maxHeight: .infinity)
                .background(OpenDesignDayColor.bg)
                .accessibilityElement(children: .contain)
                .accessibilityLabel("OpenDesign Interviews Meta")
                .accessibilityIdentifier("opendesign.reference.interviews.meta")
            }
        }
    }
}

private struct OpenDesignInterviewsSidebar: View {
    @State private var selectedFilter = "전체"

    private let filters: [(title: String, count: String)] = [
        ("전체", "8"),
        ("분석", "3"),
        ("예정", "3"),
    ]

    private let groups: [OpenDesignInterviewGroup] = [
        .init(id: "done", title: "분석 완료", rows: [
            .init(id: "jc", initials: "JC", name: "장지창", status: "분석", duration: "45m", date: "04-22", badge: "8 / 10", tone: .accent, badgeTone: .accent, isActive: true),
            .init(id: "pk", initials: "PK", name: "박노훈", status: "분석", duration: "38m", date: "04-19", badge: "7 / 10", tone: .accent, badgeTone: .accent, isActive: false),
            .init(id: "sh", initials: "SH", name: "정세훈", status: "분석", duration: "32m", date: "04-16", badge: "5 / 10", tone: .sky, badgeTone: .amber, isActive: false),
        ]),
        .init(id: "waiting", title: "대기 중", rows: [
            .init(id: "kp", initials: "KP", name: "K. Park", status: "transcribe 중", duration: nil, date: "04-26", badge: "대기", tone: .amber, badgeTone: .muted, isActive: false),
        ]),
        .init(id: "scheduled", title: "예정", rows: [
            .init(id: "cy", initials: "CY", name: "최예린", status: "슬롯 확정", duration: "45m", date: "05-02", badge: "D-3", tone: .muted, badgeTone: .muted, isActive: false),
            .init(id: "sj", initials: "SJ", name: "신지호", status: "DM 발송", duration: nil, date: "05-04", badge: "D-5", tone: .muted, badgeTone: .muted, isActive: false),
            .init(id: "yj", initials: "YJ", name: "윤재희", status: "슬롯 후보", duration: "30m", date: "05-06", badge: "D-7", tone: .muted, badgeTone: .muted, isActive: false),
        ]),
    ]

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                HStack(spacing: 6) {
                    Text("인터뷰")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(OpenDesignDayColor.fg)
                    Text("8")
                        .font(.system(size: 10, weight: .medium, design: .monospaced))
                        .foregroundStyle(OpenDesignDayColor.muted)
                        .padding(.horizontal, 6)
                        .frame(height: 18)
                        .background(Capsule().fill(OpenDesignDayColor.surface))
                }

                Spacer(minLength: 0)

                OpenDesignInterviewIconButton(systemImage: "plus", label: "새 인터뷰 추가", isAccent: true)
            }
            .padding(.top, 12)
            .padding(.horizontal, 14)
            .padding(.bottom, 8)

            HStack(spacing: 4) {
                ForEach(filters, id: \.title) { filter in
                    Button {
                        selectedFilter = filter.title
                    } label: {
                        HStack(spacing: 5) {
                            Text(filter.title)
                                .lineLimit(1)
                            Text(filter.count)
                                .font(.system(size: 10, weight: .medium, design: .monospaced))
                                .foregroundStyle(selectedFilter == filter.title ? OpenDesignDayColor.accent : OpenDesignDayColor.mutedDeep)
                                .frame(minWidth: 16, minHeight: 16)
                                .padding(.horizontal, 4)
                                .background(
                                    Capsule()
                                        .fill(selectedFilter == filter.title ? OpenDesignDayColor.accentDim : OpenDesignDayColor.bgDarker)
                                        .overlay(Capsule().stroke(selectedFilter == filter.title ? OpenDesignDayColor.accentLine : Color.clear, lineWidth: 1))
                                )
                        }
                        .font(.system(size: 11, weight: .medium, design: .monospaced))
                        .foregroundStyle(selectedFilter == filter.title ? OpenDesignDayColor.fg : OpenDesignDayColor.muted)
                        .frame(maxWidth: .infinity)
                        .frame(height: 26)
                        .background(
                            RoundedRectangle(cornerRadius: 6, style: .continuous)
                                .fill(selectedFilter == filter.title ? OpenDesignDayColor.elevated : Color.clear)
                        )
                    }
                    .buttonStyle(.plain)
                    .help("\(filter.title) 인터뷰 \(filter.count)개")
                }
            }
            .padding(3)
            .background(referenceRounded(fill: OpenDesignDayColor.surface, stroke: OpenDesignDayColor.borderSoft, radius: 8))
            .padding(.horizontal, 10)
            .padding(.bottom, 10)

            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0) {
                    ForEach(groups) { group in
                        Text(group.title)
                            .font(.system(size: 10, weight: .medium, design: .monospaced))
                            .textCase(.uppercase)
                            .tracking(1)
                            .foregroundStyle(OpenDesignDayColor.mutedDeep)
                            .padding(.top, 14)
                            .padding(.horizontal, 8)
                            .padding(.bottom, 6)

                        ForEach(group.rows) { row in
                            OpenDesignInterviewSidebarRowView(row: row)
                        }
                    }
                }
                .padding(.horizontal, 8)
                .padding(.bottom, 12)
            }
        }
        .background(OpenDesignDayColor.bg)
        .overlay(Rectangle().fill(OpenDesignDayColor.borderSoft).frame(width: 1), alignment: .trailing)
    }
}

private struct OpenDesignInterviewSidebarRowView: View {
    let row: OpenDesignInterviewRow
    @State private var isHovered = false

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Text(row.initials)
                .font(.system(size: 11, weight: .semibold, design: .monospaced))
                .foregroundStyle(row.tone == .muted ? OpenDesignDayColor.muted : row.tone.color)
                .frame(width: 28, height: 28)
                .background(Circle().fill(row.tone == .muted ? OpenDesignDayColor.surface2 : row.tone.dim))
                .overlay(Circle().stroke(row.tone == .muted ? OpenDesignDayColor.borderSoft : row.tone.line, lineWidth: 1))
                .padding(.top, 1)

            VStack(alignment: .leading, spacing: 3) {
                Text(row.name)
                    .font(.system(size: 12.5, weight: .medium))
                    .foregroundStyle(row.isActive || isHovered ? OpenDesignDayColor.fg : OpenDesignDayColor.fgSecondary)
                    .lineLimit(1)

                HStack(spacing: 7) {
                    Text("● \(row.status)")
                        .foregroundStyle(statusColor)
                    if let duration = row.duration {
                        Circle()
                            .fill(OpenDesignDayColor.mutedDeep)
                            .frame(width: 3, height: 3)
                        Text(duration)
                    }
                }
                .font(.system(size: 10.5, weight: .medium, design: .monospaced))
                .foregroundStyle(OpenDesignDayColor.muted)
                .lineLimit(1)
            }
            .frame(minWidth: 0, alignment: .leading)

            Spacer(minLength: 6)

            VStack(alignment: .trailing, spacing: 4) {
                Text(row.date)
                    .font(.system(size: 10, weight: .medium, design: .monospaced))
                    .foregroundStyle(OpenDesignDayColor.muted)
                Text(row.badge)
                    .font(.system(size: 10, weight: .medium, design: .monospaced))
                    .foregroundStyle(row.badgeTone == .muted ? OpenDesignDayColor.muted : row.badgeTone.color)
                    .padding(.horizontal, 5)
                    .frame(height: 16)
                    .background(referenceRounded(fill: badgeFill, stroke: badgeStroke, radius: 4))
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 9)
        .background(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .fill(row.isActive ? OpenDesignDayColor.selected : isHovered ? OpenDesignDayColor.hover : Color.clear)
        )
        .contentShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        .onHover { isHovered = $0 }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(row.name)
        .accessibilityValue(row.isActive ? "active" : row.status)
    }

    private var statusColor: Color {
        switch row.status {
        case "분석": return OpenDesignDayColor.accent
        case "transcribe 중": return OpenDesignDayColor.amber
        default: return OpenDesignDayColor.muted
        }
    }

    private var badgeFill: Color {
        row.badgeTone == .muted ? OpenDesignDayColor.bgDarker : row.badgeTone.dim
    }

    private var badgeStroke: Color {
        row.badgeTone == .muted ? OpenDesignDayColor.borderSoft : row.badgeTone.line
    }
}

private struct OpenDesignInterviewsMain: View {
    let layout: OpenDesignDayLayoutMetrics

    @State private var selectedTab = "요약"
    @State private var selectedFollowups: Set<Int> = [1, 2, 3]

    private let tabs: [(title: String, count: String?)] = [
        ("요약", nil),
        ("인용", "12"),
        ("후속", "7"),
        ("Transcript", nil),
    ]

    var body: some View {
        VStack(spacing: 0) {
            header
            tabStrip

            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    OpenDesignInterviewSectionHeader(title: "요약")
                    summaryCard

                    OpenDesignInterviewSectionHeader(title: "추출 신호", meta: "실제 행동 질문 · 4 카테고리")
                    signalGrid

                    OpenDesignInterviewSectionHeader(title: "실제 행동 질문 점검")
                    momTestCard

                    OpenDesignInterviewSectionHeader(title: "핵심 인용", meta: "4 / 12")
                    quoteList

                    quoteFoot

                    OpenDesignInterviewSectionHeader(title: "Day 3 후속 질문", meta: "3 필수")
                    followupCard

                    OpenDesignInterviewSectionHeader(title: "SPEC · 고객 후보 문서 갱신 제안")
                    diffCard
                }
                .frame(maxWidth: 820, alignment: .leading)
                .padding(.horizontal, layout.mainHorizontalPadding)
                .padding(.top, 22)
                .padding(.bottom, 32)
                .frame(maxWidth: .infinity)
            }
            .background(OpenDesignDayColor.bg)
        }
        .background(OpenDesignDayColor.bg)
    }

    private var header: some View {
        HStack(spacing: 16) {
            HStack(spacing: 14) {
                Text("JC")
                    .font(.system(size: 14, weight: .bold, design: .monospaced))
                    .foregroundStyle(OpenDesignDayColor.accent)
                    .frame(width: 40, height: 40)
                    .background(Circle().fill(OpenDesignDayColor.accentDim))
                    .overlay(Circle().stroke(OpenDesignDayColor.accentLine, lineWidth: 1))

                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 8) {
                        Text("장지창")
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundStyle(OpenDesignDayColor.fg)
                            .lineLimit(1)
                        Text("전 직장 동료")
                            .font(.system(size: 10, weight: .medium, design: .monospaced))
                            .tracking(0.4)
                            .foregroundStyle(OpenDesignDayColor.accent)
                            .padding(.horizontal, 7)
                            .frame(height: 18)
                            .background(Capsule().fill(OpenDesignDayColor.accentDim).overlay(Capsule().stroke(OpenDesignDayColor.accentLine, lineWidth: 1)))
                    }

                    HStack(spacing: 8) {
                        Text("2026-04-22 19:30")
                            .foregroundStyle(OpenDesignDayColor.fgSecondary)
                        Text("·")
                            .foregroundStyle(OpenDesignDayColor.mutedDeep)
                        Text("Zoom · 45분")
                        Text("·")
                            .foregroundStyle(OpenDesignDayColor.mutedDeep)
                        Text("Day 1 · 1 / 4")
                    }
                    .font(.system(size: 11, weight: .medium, design: .monospaced))
                    .foregroundStyle(OpenDesignDayColor.muted)
                    .lineLimit(1)
                }
                .frame(minWidth: 0, alignment: .leading)
            }

            Spacer(minLength: 12)

            ViewThatFits(in: .horizontal) {
                HStack(spacing: 6) {
                    OpenDesignInterviewActionButton(title: "후속 질문 생성", tone: .ghost)
                    OpenDesignInterviewActionButton(title: "SPEC.md에 반영", tone: .accent)
                }

                OpenDesignInterviewActionButton(title: "SPEC.md에 반영", tone: .accent)
            }
        }
        .padding(.horizontal, layout.mainHorizontalPadding)
        .frame(minHeight: 68)
        .background(OpenDesignDayColor.bg)
        .overlay(Rectangle().fill(OpenDesignDayColor.borderSoft).frame(height: 1), alignment: .bottom)
    }

    private var tabStrip: some View {
        HStack(spacing: 0) {
            ForEach(tabs, id: \.title) { tab in
                Button {
                    selectedTab = tab.title
                } label: {
                    HStack(spacing: 8) {
                        Text(tab.title)
                        if let count = tab.count {
                            Text(count)
                                .font(.system(size: 10, weight: .medium, design: .monospaced))
                                .foregroundStyle(selectedTab == tab.title ? OpenDesignDayColor.accent : OpenDesignDayColor.mutedDeep)
                                .padding(.horizontal, 5)
                                .frame(height: 16)
                                .background(Capsule().fill(selectedTab == tab.title ? OpenDesignDayColor.accentDim : OpenDesignDayColor.surface))
                        }
                    }
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(selectedTab == tab.title ? OpenDesignDayColor.fg : OpenDesignDayColor.muted)
                    .padding(.horizontal, 14)
                    .frame(height: 40)
                    .overlay(alignment: .bottom) {
                        Rectangle()
                            .fill(selectedTab == tab.title ? OpenDesignDayColor.accent : Color.clear)
                            .frame(height: 2)
                    }
                }
                .buttonStyle(.plain)
            }

            Spacer(minLength: 12)

            if layout.showsTaskSidebar {
                Text("● 분석 완료 · 04-22 21:14")
                    .font(.system(size: 10.5, weight: .medium, design: .monospaced))
                    .foregroundStyle(OpenDesignDayColor.accent)
                    .lineLimit(1)
            }
        }
        .padding(.horizontal, layout.mainHorizontalPadding)
        .background(OpenDesignDayColor.bg)
        .overlay(Rectangle().fill(OpenDesignDayColor.borderSoft).frame(height: 1), alignment: .bottom)
    }

    private var summaryCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(openDesignInterviewSummaryText())
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(OpenDesignDayColor.fg)
                .lineSpacing(5)
                .fixedSize(horizontal: false, vertical: true)

            HStack(spacing: 18) {
                summaryMetric("신호", "강 · 8/10")
                summaryMetric("실제 행동 질문", "4/5 통과")
                summaryMetric("고객 후보 적합", "매우 높음")
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.top, 12)
            .overlay(Rectangle().fill(OpenDesignDayColor.borderSoft).frame(height: 1), alignment: .top)
        }
        .padding(.horizontal, 18)
        .padding(.vertical, 16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(referenceAccentEdgeCard(stroke: OpenDesignDayColor.border, accent: OpenDesignDayColor.accent, cornerRadius: 12, glowOpacity: 0))
        .padding(.bottom, 14)
    }

    private func summaryMetric(_ key: String, _ value: String) -> some View {
        HStack(spacing: 6) {
            Text(key)
                .foregroundStyle(OpenDesignDayColor.mutedDeep)
            Text(value)
                .foregroundStyle(OpenDesignDayColor.fgSecondary)
        }
        .font(.system(size: 11, weight: .medium, design: .monospaced))
        .lineLimit(1)
    }

    private var signalGrid: some View {
        LazyVGrid(columns: signalColumns, alignment: .leading, spacing: 8) {
            OpenDesignInterviewSignalCard(title: "통증", value: "\"뭘 만들지 보다 누가 쓸지를 모른다.\"", meta: "5건 인용 · 하루 3시간 검증 회피", tone: .rose)
            OpenDesignInterviewSignalCard(title: "현재 대안", value: "YouTube 인디해커 · Threads · ChatGPT", meta: "3건 언급 · 구조 없음", tone: .amber)
            OpenDesignInterviewSignalCard(title: "과거 행동", value: "6개월 · 5개 출시 · 가입 11명 · 매출 0원", meta: "2건 인용 · 강력한 신호", tone: .sky)
            OpenDesignInterviewSignalCard(title: "지불 의사", value: "Cursor $20/mo · Claude Code $200/mo", meta: "툴은 결제 · 결과는 0원", tone: .accent)
        }
        .padding(.bottom, 14)
    }

    private var signalColumns: [GridItem] {
        let count = layout.showsMetaPanel ? 3 : 2
        return Array(repeating: GridItem(.flexible(), spacing: 8), count: count)
    }

    private var momTestCard: some View {
        VStack(spacing: 12) {
            HStack(spacing: 14) {
                VStack(spacing: 2) {
                    Text("4/5")
                        .font(.system(size: 17, weight: .bold, design: .monospaced))
                        .foregroundStyle(OpenDesignDayColor.accent)
                    Text("통과")
                        .font(.system(size: 9, weight: .medium, design: .monospaced))
                        .foregroundStyle(OpenDesignDayColor.muted)
                }
                .frame(width: 48, height: 48)
                .background(Circle().fill(OpenDesignDayColor.accentDim))
                .overlay(Circle().stroke(OpenDesignDayColor.accentLine, lineWidth: 1.5))

                VStack(alignment: .leading, spacing: 3) {
                    Text("품질 양호 — 한 가지 주의 항목")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(OpenDesignDayColor.fg)
                    Text("본인 솔루션을 미리 설명하는 실수 1건. 다음 인터뷰엔 가설 설명을 빼세요.")
                        .font(.system(size: 11.5, weight: .regular))
                        .foregroundStyle(OpenDesignDayColor.muted)
                        .fixedSize(horizontal: false, vertical: true)
                }

                Spacer(minLength: 0)

                Text("1 주의")
                    .font(.system(size: 10, weight: .medium, design: .monospaced))
                    .foregroundStyle(OpenDesignDayColor.amber)
                    .padding(.horizontal, 8)
                    .frame(height: 20)
                    .background(Capsule().fill(OpenDesignDayColor.amberDim).overlay(Capsule().stroke(OpenDesignDayColor.amberLine, lineWidth: 1)))
            }

            VStack(spacing: 4) {
                momRule("✓", "의견이 아니라 행동을 물었다", "7회", tone: .accent)
                momRule("✓", "미래 약속이 아니라 과거 사실을 받았다", "4회", tone: .accent)
                momRule("✓", "구체 수치·날짜·금액으로 답을 받아냈다", "12회", tone: .accent)
                momRule("✓", "본인 이야기를 너무 많이 하지 않았다", "34% / 66%", tone: .accent)
                momRule("!", "솔루션을 미리 설명하지 않았다", "06:14 · 1회", tone: .amber)
            }
            .padding(.top, 12)
            .overlay(Rectangle().fill(OpenDesignDayColor.borderSoft).frame(height: 1), alignment: .top)
        }
        .padding(16)
        .background(referenceCard())
        .padding(.bottom, 14)
    }

    private func momRule(_ mark: String, _ title: String, _ tail: String, tone: OpenDesignReferenceTone) -> some View {
        HStack(spacing: 10) {
            Text(mark)
                .font(.system(size: 9, weight: .bold))
                .foregroundStyle(tone == .accent ? OpenDesignDayColor.bgDeep : tone.color)
                .frame(width: 14, height: 14)
                .background(Circle().fill(tone == .accent ? tone.color : tone.dim))
                .overlay(Circle().stroke(tone == .accent ? Color.clear : tone.line, lineWidth: 1))
            Text(title)
                .font(.system(size: 12, weight: .regular))
                .foregroundStyle(OpenDesignDayColor.fgSecondary)
                .lineLimit(1)
            Spacer(minLength: 8)
            Text(tail)
                .font(.system(size: 10.5, weight: .medium, design: .monospaced))
                .foregroundStyle(tone.color)
                .lineLimit(1)
        }
        .padding(.vertical, 4)
    }

    private var quoteList: some View {
        VStack(spacing: 8) {
            OpenDesignInterviewQuoteRow(time: "02:18", kind: "Pain", quote: "AI로 다섯 번 만들었어요. 한 번도 안 팔렸어요. 다음엔 안 만들고 싶은데, 안 만들면 또 불안하더라구요. 그래서 그냥 또 만들어요.", speaker: "장지창", chip: "강한 통증", tone: .rose)
            OpenDesignInterviewQuoteRow(time: "07:42", kind: "Past", quote: "지난 6개월에 다섯 개 출시. 가입 누계 11명, 매출은 다 합쳐서 0원.", speaker: "장지창", chip: "과거 행동", tone: .sky)
            OpenDesignInterviewQuoteRow(time: "12:55", kind: "Wedge", quote: "뭘 만들지가 어려운 게 아니에요. 진짜 어려운 건 \"만들기 전에, 누가 쓸 사람인지를 모르겠다\"는 거예요.", speaker: "장지창", chip: "핵심 통증", tone: .rose)
            OpenDesignInterviewQuoteRow(time: "28:34", kind: "피해야 할 답변", quote: "Agentic30라는 30일 챌린지를 만들려고...\n오 그거 좋은데요? 저 해볼래요.", speaker: "나 / 장지창", chip: "실제 행동 질문 위반", tone: .amber)
        }
        .padding(.bottom, 8)
    }

    private var quoteFoot: some View {
        HStack(spacing: 8) {
            Text("나머지 8개 인용 ·")
            Text("인터뷰 원문 전체 보기 (6.7KB)")
                .foregroundStyle(OpenDesignDayColor.accent)
        }
        .font(.system(size: 11, weight: .medium, design: .monospaced))
        .foregroundStyle(OpenDesignDayColor.muted)
        .padding(.horizontal, 4)
        .padding(.bottom, 14)
    }

    private var followupCard: some View {
        VStack(spacing: 0) {
            VStack(spacing: 2) {
                followupRow(1, title: "지난 6개월에 마지막으로 출시한 프로덕트는 언제, 어떤 거였어요?", detail: "\"5번 빌드 → 0매출\" 패턴이 다른 후보에게도 나오는지 확인")
                followupRow(2, title: "가입자 0명일 때 본인은 그 다음 주에 뭘 했어요?", detail: "실패 후 실제 행동 데이터 — 의견 아님")
                followupRow(3, title: "\"오늘 뭘 해야 다음 주가 좋아질지\" 막힐 때 마지막으로 어디서 답을 찾았어요?", detail: "현재 대안의 구체적 행동")
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 4)

            HStack(spacing: 10) {
                Text("\(selectedFollowups.count)")
                    .foregroundStyle(OpenDesignDayColor.fgSecondary)
                Text("필수 · 선택 4개 보기")
                Spacer(minLength: 0)
                OpenDesignInterviewMiniButton(title: "Day 3 질문지에 추가 →", tone: .accent)
            }
            .font(.system(size: 10.5, weight: .medium, design: .monospaced))
            .foregroundStyle(OpenDesignDayColor.muted)
            .padding(.horizontal, 14)
            .frame(height: 44)
            .background(OpenDesignDayColor.bgDarker)
            .overlay(Rectangle().fill(OpenDesignDayColor.borderSoft).frame(height: 1), alignment: .top)
        }
        .background(referenceRounded(fill: OpenDesignDayColor.surface, stroke: OpenDesignDayColor.borderSoft, radius: 12))
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .padding(.bottom, 14)
    }

    private func followupRow(_ index: Int, title: String, detail: String) -> some View {
        Button {
            if selectedFollowups.contains(index) {
                selectedFollowups.remove(index)
            } else {
                selectedFollowups.insert(index)
            }
        } label: {
            HStack(alignment: .top, spacing: 10) {
                Text("\(index)")
                    .font(.system(size: 10, weight: .semibold, design: .monospaced))
                    .foregroundStyle(selectedFollowups.contains(index) ? OpenDesignDayColor.bgDeep : OpenDesignDayColor.muted)
                    .frame(width: 16, height: 16)
                    .background(Circle().fill(selectedFollowups.contains(index) ? OpenDesignDayColor.amber : Color.clear))
                    .overlay(Circle().stroke(selectedFollowups.contains(index) ? OpenDesignDayColor.amber : OpenDesignDayColor.border, lineWidth: 1))
                    .padding(.top, 1)

                VStack(alignment: .leading, spacing: 3) {
                    Text(title)
                        .font(.system(size: 12.5, weight: .medium))
                        .foregroundStyle(OpenDesignDayColor.fg)
                        .fixedSize(horizontal: false, vertical: true)
                    Text(detail)
                        .font(.system(size: 10.5, weight: .medium, design: .monospaced))
                        .foregroundStyle(OpenDesignDayColor.muted)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 9)
            .contentShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
        }
        .buttonStyle(OpenDesignInterviewHoverButtonStyle())
    }

    private var diffCard: some View {
        VStack(spacing: 0) {
            HStack(spacing: 10) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("ICP.md · SPEC.md §2")
                        .font(.system(size: 12.5, weight: .semibold))
                        .foregroundStyle(OpenDesignDayColor.fg)
                    Text("이 인터뷰가 만든 변경 — 적용 전 미리보기")
                        .font(.system(size: 10.5, weight: .medium, design: .monospaced))
                        .foregroundStyle(OpenDesignDayColor.muted)
                }
                Spacer(minLength: 0)
                HStack(spacing: 8) {
                    Text("+4")
                        .foregroundStyle(OpenDesignDayColor.diffAdd)
                    Text("−1")
                        .foregroundStyle(OpenDesignDayColor.diffDel)
                }
                .font(.system(size: 11, weight: .medium, design: .monospaced))
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .overlay(Rectangle().fill(OpenDesignDayColor.borderSoft).frame(height: 1), alignment: .bottom)

            VStack(spacing: 0) {
                diffLine("5", " ", "## Our ICP: 전업 1인 개발자 (수익 0원)", tone: .muted)
                diffLine("7", "−", "에이전트 코딩 도구로 만들 수 있는, 이미 전업한 1인 개발자.", tone: .rose)
                diffLine("7", "+", "에이전트 코딩 도구로 만들 수 있는 전업 1인 개발자. 특히 \"AI로 계속 새로 만드는데 한 번도 안 팔린\" 서브세그.", tone: .accent)
                diffLine("8", " ", "", tone: .muted)
                diffLine("9", "+", "### Trigger (장지창 04-22 기반)", tone: .accent)
                diffLine("10", "+", "- 6개월에 3개+ 출시, 가입 20명 미만, 매출 0원", tone: .accent)
                diffLine("11", "+", "- \"누가 쓸지를 모른다\" 표현을 자발적으로 사용", tone: .accent)
            }
            .padding(.vertical, 8)
            .background(OpenDesignDayColor.bgDarker)

            HStack(spacing: 8) {
                Text("2 파일 · +4 / −1")
                Spacer(minLength: 0)
                OpenDesignInterviewMiniButton(title: "취소", tone: .ghost)
                OpenDesignInterviewMiniButton(title: "적용 ↵", tone: .accent)
            }
            .font(.system(size: 11, weight: .medium, design: .monospaced))
            .foregroundStyle(OpenDesignDayColor.muted)
            .padding(.horizontal, 14)
            .frame(height: 44)
            .overlay(Rectangle().fill(OpenDesignDayColor.borderSoft).frame(height: 1), alignment: .top)
        }
        .background(referenceAccentEdgeCard(stroke: OpenDesignDayColor.border, accent: OpenDesignDayColor.amber, cornerRadius: 12, glowOpacity: 0))
    }

    private func diffLine(_ line: String, _ symbol: String, _ title: String, tone: OpenDesignReferenceTone) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Text(line)
                .foregroundStyle(tone == .muted ? OpenDesignDayColor.mutedDeep : tone.color)
                .frame(width: 32, alignment: .trailing)
            Text(symbol)
                .foregroundStyle(tone == .muted ? OpenDesignDayColor.mutedDeep : tone.color)
                .frame(width: 14)
            Text(title)
                .foregroundStyle(tone == .muted ? OpenDesignDayColor.fgSecondary : (tone == .rose ? OpenDesignDayColor.diffDel : OpenDesignDayColor.diffAdd))
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
        .font(.system(size: 11.5, weight: .medium, design: .monospaced))
        .padding(.horizontal, 14)
        .padding(.vertical, 2)
        .background(tone == .accent ? OpenDesignDayColor.accentDim.opacity(0.45) : tone == .rose ? OpenDesignDayColor.roseDim.opacity(0.45) : Color.clear)
    }
}

private struct OpenDesignInterviewsMetaPanel: View {
    private let themes: [OpenDesignInterviewTheme] = [
        .init(id: "who", title: "\"누가 쓸지를 모른다\"", count: "3/3", progress: 1, tone: .accent),
        .init(id: "zero", title: "N번 빌드 → 0매출", count: "3/3", progress: 1, tone: .accent),
        .init(id: "fit", title: "Adaptive 핏", count: "2/3", progress: 0.66, tone: .amber),
        .init(id: "pay", title: "툴 자비 결제", count: "2/3", progress: 0.66, tone: .amber),
    ]

    private let upcoming: [OpenDesignInterviewUpcoming] = [
        .init(id: "cy", day: "02", month: "5월", name: "최예린", meta: "14:00 · 45m", tone: .sky),
        .init(id: "sj", day: "04", month: "5월", name: "신지호", meta: "10:00 · DM 대기", tone: .amber),
        .init(id: "yj", day: "06", month: "5월", name: "윤재희", meta: "16:00 · 커피챗", tone: .muted),
    ]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                Text("요약")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(OpenDesignDayColor.fg)

                progressCard

                Text("반복 테마")
                    .font(.system(size: 10.5, weight: .medium, design: .monospaced))
                    .tracking(1)
                    .textCase(.uppercase)
                    .foregroundStyle(OpenDesignDayColor.mutedDeep)
                    .padding(.horizontal, 4)
                    .padding(.top, 2)

                VStack(spacing: 6) {
                    ForEach(themes) { theme in
                        OpenDesignInterviewThemeRow(theme: theme)
                    }
                }

                Text("예정 인터뷰")
                    .font(.system(size: 10.5, weight: .medium, design: .monospaced))
                    .tracking(1)
                    .textCase(.uppercase)
                    .foregroundStyle(OpenDesignDayColor.mutedDeep)
                    .padding(.horizontal, 4)
                    .padding(.top, 2)

                VStack(spacing: 6) {
                    ForEach(upcoming) { item in
                        OpenDesignInterviewUpcomingRow(item: item)
                    }
                }
            }
            .padding(16)
        }
        .background(OpenDesignDayColor.bg)
        .overlay(Rectangle().fill(OpenDesignDayColor.borderSoft).frame(width: 1), alignment: .leading)
    }

    private var progressCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 6) {
                Circle()
                    .fill(OpenDesignDayColor.accent)
                    .frame(width: 6, height: 6)
                    .shadow(color: OpenDesignDayColor.accent.opacity(0.45), radius: 5)
                Text("진행 상황")
            }
            .font(.system(size: 10.5, weight: .medium, design: .monospaced))
            .tracking(0.4)
            .textCase(.uppercase)
            .foregroundStyle(OpenDesignDayColor.muted)

            HStack(spacing: 8) {
                metaStat("3", "분석", .accent)
                metaStat("2", "대기", .amber)
                metaStat("3", "예정", .muted)
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .background(referenceRounded(fill: OpenDesignDayColor.surface, stroke: OpenDesignDayColor.borderSoft, radius: 10))
    }

    private func metaStat(_ value: String, _ key: String, _ tone: OpenDesignReferenceTone) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(value)
                .font(.system(size: 18, weight: .semibold, design: .monospaced))
                .foregroundStyle(tone == .muted ? OpenDesignDayColor.fg : tone.color)
            Text(key)
                .font(.system(size: 10.5, weight: .medium, design: .monospaced))
                .foregroundStyle(OpenDesignDayColor.muted)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct OpenDesignInterviewSectionHeader: View {
    let title: String
    var meta: String?

    var body: some View {
        HStack(spacing: 10) {
            RoundedRectangle(cornerRadius: 2, style: .continuous)
                .fill(OpenDesignDayColor.accent)
                .frame(width: 3, height: 12)
            Text(title)
                .font(.system(size: 11, weight: .medium, design: .monospaced))
                .tracking(1)
                .textCase(.uppercase)
                .foregroundStyle(OpenDesignDayColor.muted)
            if let meta {
                Text(meta)
                    .font(.system(size: 10.5, weight: .medium, design: .monospaced))
                    .foregroundStyle(OpenDesignDayColor.mutedDeep)
                    .lineLimit(1)
            }
            Rectangle()
                .fill(OpenDesignDayColor.borderSoft)
                .frame(height: 1)
        }
        .padding(.top, 22)
        .padding(.bottom, 10)
    }
}

private struct OpenDesignInterviewSignalCard: View {
    let title: String
    let value: String
    let meta: String
    let tone: OpenDesignReferenceTone

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(.system(size: 10, weight: .medium, design: .monospaced))
                .tracking(0.8)
                .textCase(.uppercase)
                .foregroundStyle(tone.color)
            Text(value)
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(OpenDesignDayColor.fg)
                .lineSpacing(2)
                .fixedSize(horizontal: false, vertical: true)
            Text(meta)
                .font(.system(size: 10.5, weight: .medium, design: .monospaced))
                .foregroundStyle(OpenDesignDayColor.muted)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .frame(maxWidth: .infinity, minHeight: 104, alignment: .topLeading)
        .background(referenceRounded(fill: OpenDesignDayColor.surface, stroke: OpenDesignDayColor.borderSoft, radius: 10))
    }
}

private struct OpenDesignInterviewQuoteRow: View {
    let time: String
    let kind: String
    let quote: String
    let speaker: String
    let chip: String
    let tone: OpenDesignReferenceTone

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text(time)
                    .font(.system(size: 11, weight: .semibold, design: .monospaced))
                    .foregroundStyle(OpenDesignDayColor.accent)
                Text(kind)
                    .font(.system(size: 9.5, weight: .medium, design: .monospaced))
                    .tracking(0.6)
                    .textCase(.uppercase)
                    .foregroundStyle(OpenDesignDayColor.mutedDeep)
            }
            .frame(width: 52, alignment: .leading)

            VStack(alignment: .leading, spacing: 4) {
                Text(speaker)
                    .font(.system(size: 10, weight: .medium, design: .monospaced))
                    .tracking(0.4)
                    .textCase(.uppercase)
                    .foregroundStyle(speaker.contains("나") ? OpenDesignDayColor.sky : OpenDesignDayColor.mutedDeep)
                Text(quote)
                    .font(.system(size: 12.5, weight: .regular))
                    .foregroundStyle(OpenDesignDayColor.fg)
                    .lineSpacing(4)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Spacer(minLength: 8)

            Text(chip)
                .font(.system(size: 10, weight: .medium, design: .monospaced))
                .tracking(0.4)
                .foregroundStyle(tone == .muted ? OpenDesignDayColor.muted : tone.color)
                .padding(.horizontal, 7)
                .frame(height: 18)
                .background(Capsule().fill(tone == .muted ? OpenDesignDayColor.bgDarker : tone.dim).overlay(Capsule().stroke(tone == .muted ? OpenDesignDayColor.borderSoft : tone.line, lineWidth: 1)))
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .background(referenceRounded(fill: OpenDesignDayColor.surface, stroke: OpenDesignDayColor.borderSoft, radius: 10))
    }
}

private struct OpenDesignInterviewThemeRow: View {
    let theme: OpenDesignInterviewTheme
    @State private var isHovered = false

    var body: some View {
        HStack(spacing: 12) {
            Text(theme.title)
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(OpenDesignDayColor.fg)
                .lineLimit(1)
                .layoutPriority(1)

            Spacer(minLength: 10)

            GeometryReader { proxy in
                ZStack(alignment: .leading) {
                    Capsule().fill(OpenDesignDayColor.bgDeep)
                    Capsule()
                        .fill(theme.tone.color)
                        .frame(width: max(0, proxy.size.width * theme.progress))
                }
            }
            .frame(width: 68, height: 4)

            Text(theme.count)
                .font(.system(size: 10.5, weight: .medium, design: .monospaced))
                .foregroundStyle(OpenDesignDayColor.muted)
                .frame(width: 28, alignment: .trailing)
                .lineLimit(1)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 9)
        .frame(maxWidth: .infinity, minHeight: 36, alignment: .center)
        .background(referenceRounded(fill: OpenDesignDayColor.surface, stroke: isHovered ? OpenDesignDayColor.border : OpenDesignDayColor.borderSoft, radius: 8))
        .onHover { isHovered = $0 }
    }
}

private struct OpenDesignInterviewUpcomingRow: View {
    let item: OpenDesignInterviewUpcoming
    @State private var isHovered = false

    var body: some View {
        HStack(spacing: 10) {
            VStack(spacing: 1) {
                Text(item.day)
                    .font(.system(size: 13, weight: .bold, design: .monospaced))
                    .foregroundStyle(OpenDesignDayColor.fg)
                Text(item.month)
                    .font(.system(size: 9, weight: .medium, design: .monospaced))
                    .tracking(0.6)
                    .textCase(.uppercase)
                    .foregroundStyle(OpenDesignDayColor.muted)
            }
            .frame(width: 36, height: 36)
            .background(referenceRounded(fill: OpenDesignDayColor.bgDeep, stroke: OpenDesignDayColor.borderSoft, radius: 6))

            VStack(alignment: .leading, spacing: 2) {
                Text(item.name)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(OpenDesignDayColor.fg)
                    .lineLimit(1)
                Text(item.meta)
                    .font(.system(size: 10.5, weight: .medium, design: .monospaced))
                    .foregroundStyle(item.tone == .amber ? OpenDesignDayColor.amber : OpenDesignDayColor.muted)
                    .lineLimit(1)
            }

            Spacer(minLength: 0)

            Image(systemName: "chevron.right")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(isHovered ? OpenDesignDayColor.muted : OpenDesignDayColor.mutedDeep)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 9)
        .background(referenceRounded(fill: OpenDesignDayColor.surface, stroke: isHovered ? OpenDesignDayColor.border : OpenDesignDayColor.borderSoft, radius: 8))
        .onHover { isHovered = $0 }
    }
}

private struct OpenDesignInterviewActionButton: View {
    enum Tone { case ghost, accent }

    let title: String
    let tone: Tone
    @State private var isHovered = false

    var body: some View {
        Button(action: {}) {
            Text(title)
                .font(.system(size: 11.5, weight: tone == .accent ? .semibold : .medium))
                .foregroundStyle(tone == .accent ? OpenDesignDayColor.bgDeep : (isHovered ? OpenDesignDayColor.fg : OpenDesignDayColor.fgSecondary))
                .padding(.horizontal, tone == .accent ? 14 : 12)
                .frame(height: 28)
                .background(
                    referenceRounded(
                        fill: tone == .accent ? (isHovered ? OpenDesignDayColor.accentStrong : OpenDesignDayColor.accent) : (isHovered ? OpenDesignDayColor.hover : Color.clear),
                        stroke: tone == .accent ? Color.clear : OpenDesignDayColor.borderSoft,
                        radius: 8
                    )
                )
        }
        .buttonStyle(.plain)
        .onHover { isHovered = $0 }
        .accessibilityLabel(title)
    }
}

private struct OpenDesignInterviewMiniButton: View {
    enum Tone { case ghost, accent }

    let title: String
    let tone: Tone
    @State private var isHovered = false

    var body: some View {
        Button(action: {}) {
            Text(title)
                .font(.system(size: 11, weight: .semibold, design: .monospaced))
                .foregroundStyle(tone == .accent ? OpenDesignDayColor.bgDeep : (isHovered ? OpenDesignDayColor.fg : OpenDesignDayColor.fgSecondary))
                .padding(.horizontal, 10)
                .frame(height: 24)
                .background(
                    referenceRounded(
                        fill: tone == .accent ? OpenDesignDayColor.accent : (isHovered ? OpenDesignDayColor.hover : Color.clear),
                        stroke: tone == .accent ? Color.clear : OpenDesignDayColor.borderSoft,
                        radius: 6
                    )
                )
        }
        .buttonStyle(.plain)
        .onHover { isHovered = $0 }
    }
}

private struct OpenDesignInterviewIconButton: View {
    let systemImage: String
    let label: String
    var isAccent = false
    @State private var isHovered = false

    var body: some View {
        Button(action: {}) {
            Image(systemName: systemImage)
                .font(.system(size: 11, weight: .bold))
                .foregroundStyle(isAccent ? (isHovered ? OpenDesignDayColor.bgDeep : OpenDesignDayColor.accent) : OpenDesignDayColor.muted)
                .frame(width: 22, height: 22)
                .background(
                    referenceRounded(
                        fill: isAccent ? (isHovered ? OpenDesignDayColor.accent : OpenDesignDayColor.accentDim) : Color.clear,
                        stroke: isAccent ? OpenDesignDayColor.accentLine : Color.clear,
                        radius: 6
                    )
                )
        }
        .buttonStyle(.plain)
        .help(label)
        .onHover { isHovered = $0 }
        .accessibilityLabel(label)
    }
}

private struct OpenDesignInterviewHoverButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .background(
                RoundedRectangle(cornerRadius: 6, style: .continuous)
                    .fill(configuration.isPressed && isEnabled ? OpenDesignDayColor.hover : Color.clear)
            )
    }
}

private struct OpenDesignInterviewGroup: Identifiable {
    let id: String
    let title: String
    let rows: [OpenDesignInterviewRow]
}

private struct OpenDesignInterviewRow: Identifiable {
    let id: String
    let initials: String
    let name: String
    let status: String
    let duration: String?
    let date: String
    let badge: String
    let tone: OpenDesignReferenceTone
    let badgeTone: OpenDesignReferenceTone
    let isActive: Bool
}

private struct OpenDesignInterviewTheme: Identifiable {
    let id: String
    let title: String
    let count: String
    let progress: CGFloat
    let tone: OpenDesignReferenceTone
}

private struct OpenDesignInterviewUpcoming: Identifiable {
    let id: String
    let day: String
    let month: String
    let name: String
    let meta: String
    let tone: OpenDesignReferenceTone
}

private func openDesignInterviewSummaryText() -> AttributedString {
    var text = AttributedString("5번 빌드 → 0매출 패턴을 본인이 자각했지만 \"검증 없이 또 만들 것 같다\"는 회피 신호가 강하다. 핵심 통증은 \"누가 쓸지를 모른다\"로 압축된다.")
    text.foregroundColor = OpenDesignDayColor.fg

    func apply(_ needle: String, color: Color, background: Color) {
        var searchStart = text.startIndex
        while searchStart < text.endIndex,
              let range = text[searchStart...].range(of: needle) {
            text[range].foregroundColor = color
            text[range].backgroundColor = background
            text[range].font = .system(size: 15, weight: .medium)
            searchStart = range.upperBound
        }
    }

    apply("5번 빌드 → 0매출", color: OpenDesignDayColor.accent, background: OpenDesignDayColor.accentDim)
    apply("\"검증 없이 또 만들 것 같다\"", color: OpenDesignDayColor.amber, background: OpenDesignDayColor.amberDim)
    apply("\"누가 쓸지를 모른다\"", color: OpenDesignDayColor.accent, background: OpenDesignDayColor.accentDim)

    return text
}

// MARK: - History (이번 주 회고 · sidecar/work-history.mjs 실데이터)
// 인터뷰 계약: 요일별(월~일) 타임라인 + 기능 영역별 하루 요약(코치 문체,
// 다음 액션 포함). 시간은 AI 세션 wall-clock만, 커밋은 활동량/근거.
// 레퍼런스는 변경 파일·디렉토리 + AI 세션 시간대 + 신뢰도만 노출(커밋 SHA 숨김).
// 미분류/진행 중 세션은 별도 표시, GitHub 미연결 시 연결 요구.

private enum OpenDesignHistoryFormat {
    static func minutes(_ minutes: Int) -> String {
        let m = max(0, minutes)
        if m < 60 { return "\(m)분" }
        let h = m / 60
        let rest = m % 60
        return rest == 0 ? "\(h)시간" : "\(h)시간 \(rest)분"
    }

    private static let isoParser: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    private static let isoParserNoFraction: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter
    }()

    private static let timeFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "HH:mm"
        return formatter
    }()

    static func localTime(_ iso: String?) -> String? {
        guard let iso, !iso.isEmpty else { return nil }
        guard let date = isoParser.date(from: iso) ?? isoParserNoFraction.date(from: iso) else {
            return nil
        }
        return timeFormatter.string(from: date)
    }

    static func sessionRange(_ range: WorkHistorySessionRange) -> String {
        let start = localTime(range.start) ?? "—"
        let end = localTime(range.end) ?? "—"
        return "\(start)–\(end)"
    }

    static func providerLabel(_ provider: String) -> String {
        switch provider {
        case "claude": return "Claude"
        case "codex": return "Codex"
        case "gemini": return "Gemini"
        default: return provider
        }
    }

    static func confidenceLabel(_ confidence: String) -> String {
        switch confidence {
        case "high": return "신뢰도 높음"
        case "medium": return "신뢰도 중간"
        default: return "추정"
        }
    }

    static func confidenceTone(_ confidence: String) -> Color {
        switch confidence {
        case "high": return OpenDesignDayColor.accent
        case "medium": return OpenDesignDayColor.amber
        default: return OpenDesignDayColor.muted
        }
    }

    static func verdictLabel(_ verdict: String) -> String {
        switch verdict {
        case "continue": return "계속"
        case "rebalance": return "균형 조정"
        case "close_loop": return "루프 닫기"
        case "pivot": return "전환 검토"
        case "stop": return "중단 검토"
        default: return "판단 대기"
        }
    }

    static func verdictTone(_ verdict: String) -> Color {
        switch verdict {
        case "continue": return OpenDesignDayColor.accent
        case "rebalance": return OpenDesignDayColor.sky
        case "close_loop": return OpenDesignDayColor.amber
        case "pivot", "stop": return OpenDesignDayColor.rose
        default: return OpenDesignDayColor.muted
        }
    }

    static func riskTone(_ severity: String) -> Color {
        switch severity {
        case "blocker": return OpenDesignDayColor.rose
        case "info": return OpenDesignDayColor.sky
        default: return OpenDesignDayColor.amber
        }
    }

    static func evidenceStatusLabel(_ status: String) -> String {
        switch status {
        case "connected": return "연결"
        case "github_required": return "연결 필요"
        default: return "없음"
        }
    }

    static func evidenceStatusTone(_ status: String) -> Color {
        switch status {
        case "connected": return OpenDesignDayColor.accent
        case "github_required": return OpenDesignDayColor.amber
        default: return OpenDesignDayColor.mutedDeep
        }
    }
}

private struct OpenDesignHistoryShell: View {
    let layout: OpenDesignDayLayoutMetrics
    let openSearch: () -> Void
    var snapshot: WorkHistorySnapshot = .empty
    var refresh: () -> Void = {}
    var prepare: () -> Void = {}

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        if layout.showsTaskSidebar {
            OpenDesignHistorySidebarView(snapshot: snapshot)
                .frame(width: layout.taskSidebarWidth)
                .frame(maxHeight: .infinity)
                .background(OpenDesignDayColor.bg)
                .transition(reduceMotion ? .opacity : .opacity.combined(with: .move(edge: .leading)))
                .accessibilityIdentifier("opendesign.reference.history.side")
        }

        OpenDesignHistoryMainView(
            layout: layout,
            snapshot: snapshot,
            refresh: refresh
        )
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityIdentifier("opendesign.reference.history.main")
        .onAppear { prepare() }

        if layout.showsMetaPanel {
            OpenDesignHistoryMetaPanelView(snapshot: snapshot)
                .frame(width: layout.metaPanelWidth)
                .frame(maxHeight: .infinity)
                .background(OpenDesignDayColor.bg)
                .accessibilityIdentifier("opendesign.reference.history.meta")
        }
    }
}

// MARK: 좌측 — "어디에 시간을 썼나" 주간 합계 + 기능 영역 순위

private struct OpenDesignHistorySidebarView: View {
    let snapshot: WorkHistorySnapshot

    var body: some View {
        VStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 4) {
                Text("이번 주")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(OpenDesignDayColor.fg)
                Text(snapshot.hasData ? "\(snapshot.weekStart) → \(snapshot.weekEnd)" : "월–일 · 로컬 시간대")
                    .font(.system(size: 10.5, weight: .medium, design: .monospaced))
                    .foregroundStyle(OpenDesignDayColor.muted)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 18)
            .frame(height: 64)
            .overlay(Rectangle().fill(OpenDesignDayColor.borderSoft).frame(height: 1), alignment: .bottom)

            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    VStack(alignment: .leading, spacing: 10) {
                        OpenDesignHistoryStatRow(
                            label: "AI 세션",
                            value: OpenDesignHistoryFormat.minutes(snapshot.totals.aiMinutes),
                            isAccent: true
                        )
                        OpenDesignHistoryStatRow(
                            label: "내 커밋",
                            value: "\(snapshot.totals.myCommitCount)건",
                            isAccent: false
                        )
                        OpenDesignHistoryStatRow(
                            label: "활동일",
                            value: "\(snapshot.totals.activeDays) / 7일",
                            isAccent: false
                        )
                        if snapshot.totals.unclassifiedMinutes > 0 {
                            OpenDesignHistoryStatRow(
                                label: "미분류",
                                value: OpenDesignHistoryFormat.minutes(snapshot.totals.unclassifiedMinutes),
                                isAccent: false
                            )
                        }
                    }
                    .padding(14)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(referenceRounded(fill: OpenDesignDayColor.surface, stroke: OpenDesignDayColor.borderSoft, radius: 12))

                    if snapshot.retrospective.hasContent {
                        Text("집중 / 불균형 / 미분류")
                            .font(.system(size: 10.5, weight: .medium, design: .monospaced))
                            .textCase(.uppercase)
                            .foregroundStyle(OpenDesignDayColor.mutedDeep)
                            .padding(.horizontal, 4)

                        VStack(spacing: 6) {
                            if let topArea = snapshot.areas.first {
                                OpenDesignHistoryFocusRow(
                                    label: "집중",
                                    value: topArea.name,
                                    detail: "\(OpenDesignHistoryFormat.minutes(topArea.aiMinutes)) · 커밋 \(topArea.commitCount)건",
                                    tone: OpenDesignDayColor.accent
                                )
                            }
                            OpenDesignHistoryFocusRow(
                                label: "판단",
                                value: OpenDesignHistoryFormat.verdictLabel(snapshot.retrospective.verdict),
                                detail: snapshot.retrospective.riskFlags.isEmpty ? "리스크 없음" : "리스크 \(snapshot.retrospective.riskFlags.count)건",
                                tone: OpenDesignHistoryFormat.verdictTone(snapshot.retrospective.verdict)
                            )
                            if snapshot.totals.unclassifiedMinutes > 0 {
                                OpenDesignHistoryFocusRow(
                                    label: "미분류",
                                    value: OpenDesignHistoryFormat.minutes(snapshot.totals.unclassifiedMinutes),
                                    detail: "\(snapshot.unclassified.count)개 세션",
                                    tone: OpenDesignDayColor.amber
                                )
                            }
                        }
                    }

                    if !snapshot.areas.isEmpty {
                        Text("집중 영역")
                            .font(.system(size: 10.5, weight: .medium, design: .monospaced))
                            .textCase(.uppercase)
                            .foregroundStyle(OpenDesignDayColor.mutedDeep)
                            .padding(.horizontal, 4)

                        VStack(spacing: 6) {
                            ForEach(snapshot.areas) { area in
                                OpenDesignHistoryAreaRankRow(
                                    area: area,
                                    maxMinutes: snapshot.areas.map(\.aiMinutes).max() ?? 0
                                )
                            }
                        }
                    }
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 16)
            }
        }
    }
}

private struct OpenDesignHistoryStatRow: View {
    let label: String
    let value: String
    let isAccent: Bool

    var body: some View {
        HStack {
            Text(label)
                .font(.system(size: 11.5, weight: .medium))
                .foregroundStyle(OpenDesignDayColor.muted)
            Spacer(minLength: 8)
            Text(value)
                .font(.system(size: 12.5, weight: .semibold, design: .monospaced))
                .foregroundStyle(isAccent ? OpenDesignDayColor.accent : OpenDesignDayColor.fg)
        }
    }
}

private struct OpenDesignHistoryFocusRow: View {
    let label: String
    let value: String
    let detail: String
    let tone: Color

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack(spacing: 8) {
                Text(label)
                    .font(.system(size: 10, weight: .medium, design: .monospaced))
                    .foregroundStyle(tone)
                    .textCase(.uppercase)
                Spacer(minLength: 8)
                Circle()
                    .fill(tone)
                    .frame(width: 5, height: 5)
            }
            Text(value)
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(OpenDesignDayColor.fg)
                .lineLimit(1)
            Text(detail)
                .font(.system(size: 10.5, weight: .medium, design: .monospaced))
                .foregroundStyle(OpenDesignDayColor.muted)
                .lineLimit(1)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(referenceRounded(fill: OpenDesignDayColor.surface, stroke: tone.opacity(0.25), radius: 10))
    }
}

private struct OpenDesignHistoryAreaRankRow: View {
    let area: WorkHistoryArea
    let maxMinutes: Int

    private var ratio: CGFloat {
        guard maxMinutes > 0 else { return 0 }
        return CGFloat(area.aiMinutes) / CGFloat(maxMinutes)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                Text(area.name)
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(OpenDesignDayColor.fg)
                    .lineLimit(1)
                Spacer(minLength: 8)
                Text(OpenDesignHistoryFormat.minutes(area.aiMinutes))
                    .font(.system(size: 11, weight: .semibold, design: .monospaced))
                    .foregroundStyle(OpenDesignDayColor.fgSecondary)
            }
            GeometryReader { geometry in
                ZStack(alignment: .leading) {
                    Capsule().fill(OpenDesignDayColor.borderSoft)
                    Capsule()
                        .fill(OpenDesignDayColor.accent)
                        .frame(width: max(3, geometry.size.width * ratio))
                }
            }
            .frame(height: 4)
            HStack(spacing: 6) {
                Text("커밋 \(area.commitCount)건")
                Text("·").foregroundStyle(OpenDesignDayColor.mutedDeep)
                Text(OpenDesignHistoryFormat.confidenceLabel(area.confidence))
                    .foregroundStyle(OpenDesignHistoryFormat.confidenceTone(area.confidence))
            }
            .font(.system(size: 10, weight: .medium, design: .monospaced))
            .foregroundStyle(OpenDesignDayColor.muted)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(referenceRounded(fill: OpenDesignDayColor.surface, stroke: OpenDesignDayColor.borderSoft, radius: 10))
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(area.name), \(OpenDesignHistoryFormat.minutes(area.aiMinutes)), 커밋 \(area.commitCount)건")
    }
}

// MARK: 중앙 — 요일별 타임라인

private struct OpenDesignHistoryMainView: View {
    let layout: OpenDesignDayLayoutMetrics
    let snapshot: WorkHistorySnapshot
    let refresh: () -> Void
    @State private var isEvidenceExpanded = false

    var body: some View {
        VStack(spacing: 0) {
            OpenDesignHistoryHeaderView(
                horizontalPadding: layout.mainHorizontalPadding,
                snapshot: snapshot,
                refresh: refresh
            )

            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    if snapshot.requiresGitHub {
                        OpenDesignHistoryGitHubRequiredView(refresh: refresh)
                            .padding(.top, 24)
                    } else if !snapshot.hasData {
                        OpenDesignHistoryEmptyStateView(snapshot: snapshot, refresh: refresh)
                            .padding(.top, 24)
                    } else {
                        OpenDesignHistoryRetrospectiveCard(retrospective: snapshot.retrospective, weekly: snapshot.weekly)
                            .padding(.bottom, 20)

                        OpenDesignHistoryEvidenceTimelineSection(
                            isExpanded: $isEvidenceExpanded,
                            snapshot: snapshot
                        )
                    }
                }
                .frame(maxWidth: 880, alignment: .leading)
                .padding(.horizontal, layout.mainHorizontalPadding)
                .padding(.top, 22)
                .padding(.bottom, 40)
                .frame(maxWidth: .infinity)
            }
            .background(OpenDesignDayColor.bg)
        }
        .background(OpenDesignDayColor.bg)
    }
}

private struct OpenDesignHistoryHeaderView: View {
    let horizontalPadding: CGFloat
    let snapshot: WorkHistorySnapshot
    let refresh: () -> Void
    @State private var isHovered = false

    var body: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                Text("이번 주 회고")
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(OpenDesignDayColor.fg)
                    .lineLimit(1)

                HStack(spacing: 8) {
                    Circle()
                        .fill(snapshot.isRefreshing ? OpenDesignDayColor.amber : OpenDesignDayColor.accent)
                        .frame(width: 5, height: 5)
                        .shadow(color: OpenDesignDayColor.accent.opacity(0.5), radius: 4)
                    Text(snapshot.statusLabel).foregroundStyle(OpenDesignDayColor.fgSecondary)
                    if snapshot.hasData {
                        Text("·").foregroundStyle(OpenDesignDayColor.mutedDeep)
                        Text("\(snapshot.weekStart) → \(snapshot.weekEnd)")
                    }
                    if snapshot.isRefreshing, let progressText = snapshot.status.progressText {
                        Text("·").foregroundStyle(OpenDesignDayColor.mutedDeep)
                        Text(progressText).lineLimit(1)
                    }
                }
                .font(.system(size: 11, weight: .medium, design: .monospaced))
                .foregroundStyle(OpenDesignDayColor.muted)
                .lineLimit(1)
            }

            Spacer(minLength: 10)

            Button(action: refresh) {
                HStack(spacing: 6) {
                    Image(systemName: snapshot.isRefreshing ? "arrow.triangle.2.circlepath" : "arrow.clockwise")
                        .font(.system(size: 11, weight: .semibold))
                    Text(snapshot.isRefreshing ? "인덱싱 중…" : "다시 인덱싱")
                        .lineLimit(1)
                }
                .font(.system(size: 11.5, weight: .semibold))
                .foregroundStyle(OpenDesignDayColor.bgDeep)
                .padding(.horizontal, 14)
                .frame(height: 28)
                .background(referenceRounded(fill: isHovered ? OpenDesignDayColor.accentStrong : OpenDesignDayColor.accent, stroke: Color.clear, radius: 8))
            }
            .buttonStyle(.plain)
            .disabled(snapshot.isRefreshing)
            .onHover { isHovered = $0 }
            .accessibilityLabel("다시 인덱싱")
            .accessibilityIdentifier("opendesign.reference.history.refresh")
        }
        .padding(.horizontal, horizontalPadding)
        .frame(height: 70)
        .background(OpenDesignDayColor.bg)
        .overlay(Rectangle().fill(OpenDesignDayColor.borderSoft).frame(height: 1), alignment: .bottom)
    }
}

private struct OpenDesignHistoryRetrospectiveCard: View {
    let retrospective: WorkHistoryRetrospective
    let weekly: WorkHistoryWeekly

    private var headline: String {
        if !retrospective.headline.isEmpty { return retrospective.headline }
        if !weekly.headline.isEmpty { return weekly.headline }
        return "이번 주 회고를 만들 근거를 모으는 중입니다."
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("이번 주 판단")
                        .font(.system(size: 10.5, weight: .medium, design: .monospaced))
                        .textCase(.uppercase)
                        .foregroundStyle(OpenDesignDayColor.mutedDeep)
                    Text(headline)
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(OpenDesignDayColor.fg)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 12)
                Text(OpenDesignHistoryFormat.verdictLabel(retrospective.verdict))
                    .font(.system(size: 10.5, weight: .semibold, design: .monospaced))
                    .foregroundStyle(OpenDesignHistoryFormat.verdictTone(retrospective.verdict))
                    .padding(.horizontal, 9)
                    .padding(.vertical, 4)
                    .background(Capsule().fill(OpenDesignHistoryFormat.verdictTone(retrospective.verdict).opacity(0.14)))
            }

            if !retrospective.insights.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    Text("핵심 인사이트")
                        .font(.system(size: 10.5, weight: .medium, design: .monospaced))
                        .textCase(.uppercase)
                        .foregroundStyle(OpenDesignDayColor.mutedDeep)
                    ForEach(retrospective.insights) { insight in
                        OpenDesignHistoryInsightCard(insight: insight)
                    }
                }
            } else if !weekly.coachNotes.isEmpty {
                VStack(alignment: .leading, spacing: 7) {
                    ForEach(weekly.coachNotes, id: \.self) { note in
                        OpenDesignHistoryBullet(text: note, tone: OpenDesignDayColor.accent)
                    }
                }
            }

            if !retrospective.riskFlags.isEmpty {
                VStack(alignment: .leading, spacing: 7) {
                    Text("리스크")
                        .font(.system(size: 10.5, weight: .medium, design: .monospaced))
                        .textCase(.uppercase)
                        .foregroundStyle(OpenDesignDayColor.mutedDeep)
                    ForEach(retrospective.riskFlags) { risk in
                        OpenDesignHistoryRiskRow(risk: risk)
                    }
                }
            }

            let actions = retrospective.nextActions
            if !actions.isEmpty {
                VStack(alignment: .leading, spacing: 7) {
                    Text("다음 행동")
                        .font(.system(size: 10.5, weight: .medium, design: .monospaced))
                        .textCase(.uppercase)
                        .foregroundStyle(OpenDesignDayColor.mutedDeep)
                    ForEach(actions) { action in
                        OpenDesignHistoryRetrospectiveActionRow(action: action)
                    }
                }
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(referenceRounded(fill: OpenDesignDayColor.surface, stroke: OpenDesignDayColor.borderSoft, radius: 14))
        .accessibilityIdentifier("opendesign.reference.history.retrospective")
    }
}

private struct OpenDesignHistoryBullet: View {
    let text: String
    let tone: Color

    var body: some View {
        HStack(alignment: .top, spacing: 7) {
            Circle()
                .fill(tone)
                .frame(width: 4, height: 4)
                .padding(.top, 6)
            Text(text)
                .font(.system(size: 12, weight: .regular))
                .foregroundStyle(OpenDesignDayColor.fgSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}

private struct OpenDesignHistoryInsightCard: View {
    let insight: WorkHistoryInsight

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(insight.claim)
                    .font(.system(size: 12.5, weight: .semibold))
                    .foregroundStyle(OpenDesignDayColor.fg)
                    .fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 8)
                Text(OpenDesignHistoryFormat.confidenceLabel(insight.confidence))
                    .font(.system(size: 9.5, weight: .semibold, design: .monospaced))
                    .foregroundStyle(OpenDesignHistoryFormat.confidenceTone(insight.confidence))
                    .lineLimit(1)
            }
            if !insight.whyItMatters.isEmpty {
                Text(insight.whyItMatters)
                    .font(.system(size: 11.5, weight: .regular))
                    .foregroundStyle(OpenDesignDayColor.fgSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if !insight.evidenceRefs.isEmpty {
                Text("근거 · \(insight.evidenceRefs.joined(separator: " · "))")
                    .font(.system(size: 10.5, weight: .medium, design: .monospaced))
                    .foregroundStyle(OpenDesignDayColor.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(12)
        .background(referenceRounded(fill: OpenDesignDayColor.bg.opacity(0.45), stroke: OpenDesignDayColor.borderSoft, radius: 10))
    }
}

private struct OpenDesignHistoryRiskRow: View {
    let risk: WorkHistoryRiskFlag

    var body: some View {
        let tone = OpenDesignHistoryFormat.riskTone(risk.severity)
        HStack(alignment: .top, spacing: 8) {
            Text(risk.label)
                .font(.system(size: 9.5, weight: .semibold, design: .monospaced))
                .foregroundStyle(tone)
                .padding(.horizontal, 7)
                .padding(.vertical, 2)
                .background(Capsule().fill(tone.opacity(0.14)))
                .lineLimit(1)
            VStack(alignment: .leading, spacing: 2) {
                Text(risk.reason)
                    .font(.system(size: 11.5, weight: .medium))
                    .foregroundStyle(OpenDesignDayColor.fgSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                if !risk.evidenceRefs.isEmpty {
                    Text(risk.evidenceRefs.joined(separator: " · "))
                        .font(.system(size: 10, weight: .medium, design: .monospaced))
                        .foregroundStyle(OpenDesignDayColor.muted)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            Spacer(minLength: 0)
        }
    }
}

private struct OpenDesignHistoryRetrospectiveActionRow: View {
    let action: WorkHistoryRetrospectiveNextAction

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: "arrow.turn.down.right")
                .font(.system(size: 10, weight: .semibold))
                .foregroundStyle(OpenDesignDayColor.amber)
                .padding(.top, 2)
            VStack(alignment: .leading, spacing: 2) {
                Text(action.text)
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(OpenDesignDayColor.fg)
                    .fixedSize(horizontal: false, vertical: true)
                Text("필요한 근거 · \(action.evidence)")
                    .font(.system(size: 10.5, weight: .medium, design: .monospaced))
                    .foregroundStyle(OpenDesignDayColor.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}

private struct OpenDesignHistoryEvidenceTimelineSection: View {
    @Binding var isExpanded: Bool
    let snapshot: WorkHistorySnapshot

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button {
                withAnimation(.easeInOut(duration: 0.16)) {
                    isExpanded.toggle()
                }
            } label: {
                HStack(spacing: 8) {
                    Image(systemName: isExpanded ? "chevron.down" : "chevron.right")
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundStyle(OpenDesignDayColor.muted)
                        .frame(width: 12)
                    Image(systemName: "timeline.selection")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(OpenDesignDayColor.muted)
                    Text("Evidence 타임라인")
                        .font(.system(size: 12.5, weight: .semibold))
                        .foregroundStyle(OpenDesignDayColor.fg)
                    Text("세션 · 파일 · PR 근거")
                        .font(.system(size: 10.5, weight: .medium, design: .monospaced))
                        .foregroundStyle(OpenDesignDayColor.muted)
                    Spacer(minLength: 0)
                }
                .padding(12)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(referenceRounded(fill: OpenDesignDayColor.surface.opacity(0.7), stroke: OpenDesignDayColor.borderSoft, radius: 12))
            }
            .buttonStyle(.plain)
            .accessibilityLabel(isExpanded ? "Evidence 타임라인 접기" : "Evidence 타임라인 펼치기")
            .accessibilityIdentifier("opendesign.reference.history.evidenceTimeline")

            if isExpanded {
                VStack(alignment: .leading, spacing: 0) {
                    if !snapshot.weekly.headline.isEmpty || !snapshot.weekly.coachNotes.isEmpty {
                        OpenDesignHistoryWeeklyBanner(weekly: snapshot.weekly, status: snapshot.status)
                            .padding(.bottom, 18)
                    }
                    ForEach(snapshot.days) { day in
                        OpenDesignHistoryDayGroupView(
                            day: day,
                            unclassified: snapshot.unclassified.filter { $0.date == day.date }
                        )
                        .id("history.day.\(day.date)")
                    }
                }
                .padding(.top, 12)
                .transition(.opacity)
            }
        }
    }
}

private struct OpenDesignHistoryWeeklyBanner: View {
    let weekly: WorkHistoryWeekly
    let status: WorkHistoryStatus

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if !weekly.headline.isEmpty {
                Text(weekly.headline)
                    .font(.system(size: 13.5, weight: .semibold))
                    .foregroundStyle(OpenDesignDayColor.fg)
                    .fixedSize(horizontal: false, vertical: true)
            }
            ForEach(weekly.coachNotes, id: \.self) { note in
                HStack(alignment: .top, spacing: 7) {
                    Circle()
                        .fill(OpenDesignDayColor.accent)
                        .frame(width: 4, height: 4)
                        .padding(.top, 6)
                    Text(note)
                        .font(.system(size: 12, weight: .regular))
                        .foregroundStyle(OpenDesignDayColor.fgSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            if !weekly.nextActions.isEmpty {
                VStack(alignment: .leading, spacing: 6) {
                    Text("다음 액션")
                        .font(.system(size: 10.5, weight: .medium, design: .monospaced))
                        .textCase(.uppercase)
                        .foregroundStyle(OpenDesignDayColor.mutedDeep)
                    ForEach(weekly.nextActions, id: \.self) { action in
                        OpenDesignHistoryNextActionRow(action: action)
                    }
                }
                .padding(.top, 2)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(referenceRounded(fill: OpenDesignDayColor.surface, stroke: OpenDesignDayColor.borderSoft, radius: 14))
        .accessibilityIdentifier("opendesign.reference.history.weekly")
    }
}

private struct OpenDesignHistoryNextActionRow: View {
    let action: WorkHistoryNextAction

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: "arrow.turn.down.right")
                .font(.system(size: 10, weight: .semibold))
                .foregroundStyle(OpenDesignDayColor.amber)
                .padding(.top, 2)
            VStack(alignment: .leading, spacing: 2) {
                Text(action.text)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(OpenDesignDayColor.fg)
                    .fixedSize(horizontal: false, vertical: true)
                Text("근거 · \(action.evidence)")
                    .font(.system(size: 10.5, weight: .medium, design: .monospaced))
                    .foregroundStyle(OpenDesignDayColor.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}

private struct OpenDesignHistoryDayGroupView: View {
    let day: WorkHistoryDay
    let unclassified: [WorkHistoryUnclassifiedSession]

    private var isEmptyDay: Bool {
        day.areas.isEmpty && day.referenceEvents.isEmpty && unclassified.isEmpty
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Text(day.weekday)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(day.aiMinutes > 0 ? OpenDesignDayColor.accent : OpenDesignDayColor.fgSecondary)
                Text(day.date)
                    .font(.system(size: 11, weight: .medium, design: .monospaced))
                    .foregroundStyle(OpenDesignDayColor.muted)
                if day.aiMinutes > 0 {
                    Text("AI \(OpenDesignHistoryFormat.minutes(day.aiMinutes))")
                        .font(.system(size: 10.5, weight: .semibold, design: .monospaced))
                        .foregroundStyle(OpenDesignDayColor.accent)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 2)
                        .background(Capsule().fill(OpenDesignDayColor.accentDim))
                }
                Spacer(minLength: 0)
            }

            if isEmptyDay {
                Text("기록 없음")
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(OpenDesignDayColor.mutedDeep)
                    .padding(.leading, 2)
            } else {
                ForEach(day.areas) { area in
                    OpenDesignHistoryAreaCardView(area: area)
                }
                ForEach(unclassified, id: \.self) { session in
                    OpenDesignHistoryUnclassifiedRow(session: session)
                }
                if !day.referenceEvents.isEmpty {
                    OpenDesignHistoryReferenceEventsView(events: day.referenceEvents)
                }
            }
        }
        .padding(.bottom, 22)
    }
}

private struct OpenDesignHistoryAreaCardView: View {
    let area: WorkHistoryDayArea

    var body: some View {
        VStack(alignment: .leading, spacing: 9) {
            HStack(spacing: 8) {
                Text(area.name)
                    .font(.system(size: 12.5, weight: .semibold))
                    .foregroundStyle(OpenDesignDayColor.fg)
                    .lineLimit(1)
                Text(OpenDesignHistoryFormat.confidenceLabel(area.confidence))
                    .font(.system(size: 9.5, weight: .semibold, design: .monospaced))
                    .foregroundStyle(OpenDesignHistoryFormat.confidenceTone(area.confidence))
                    .padding(.horizontal, 7)
                    .padding(.vertical, 2)
                    .background(Capsule().stroke(OpenDesignHistoryFormat.confidenceTone(area.confidence).opacity(0.45), lineWidth: 1))
                Spacer(minLength: 8)
                if area.aiMinutes > 0 {
                    Text(OpenDesignHistoryFormat.minutes(area.aiMinutes))
                        .font(.system(size: 11, weight: .semibold, design: .monospaced))
                        .foregroundStyle(OpenDesignDayColor.fgSecondary)
                }
                if area.commitCount > 0 {
                    Text("커밋 \(area.commitCount)")
                        .font(.system(size: 10.5, weight: .medium, design: .monospaced))
                        .foregroundStyle(OpenDesignDayColor.muted)
                }
            }

            if !area.summary.isEmpty {
                Text(area.summary)
                    .font(.system(size: 12, weight: .regular))
                    .foregroundStyle(OpenDesignDayColor.fgSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            ForEach(area.nextActions, id: \.self) { action in
                OpenDesignHistoryNextActionRow(action: action)
            }

            // 레퍼런스: 변경 파일·디렉토리 + AI 세션 시간대 (커밋 SHA는 표기하지 않음)
            VStack(alignment: .leading, spacing: 4) {
                if !area.paths.isEmpty {
                    HStack(alignment: .top, spacing: 6) {
                        Image(systemName: "folder")
                            .font(.system(size: 9, weight: .medium))
                            .foregroundStyle(OpenDesignDayColor.mutedDeep)
                            .padding(.top, 2)
                        Text(area.paths.joined(separator: " · "))
                            .font(.system(size: 10.5, weight: .medium, design: .monospaced))
                            .foregroundStyle(OpenDesignDayColor.muted)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                if !area.sessionRanges.isEmpty {
                    HStack(alignment: .top, spacing: 6) {
                        Image(systemName: "clock")
                            .font(.system(size: 9, weight: .medium))
                            .foregroundStyle(OpenDesignDayColor.mutedDeep)
                            .padding(.top, 2)
                        Text(
                            area.sessionRanges
                                .map { "\(OpenDesignHistoryFormat.providerLabel($0.provider)) \(OpenDesignHistoryFormat.sessionRange($0))" }
                                .joined(separator: " · ")
                        )
                        .font(.system(size: 10.5, weight: .medium, design: .monospaced))
                        .foregroundStyle(OpenDesignDayColor.muted)
                        .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(referenceRounded(fill: OpenDesignDayColor.surface, stroke: OpenDesignDayColor.borderSoft, radius: 12))
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(area.name), \(OpenDesignHistoryFormat.minutes(area.aiMinutes))")
    }
}

private struct OpenDesignHistoryUnclassifiedRow: View {
    let session: WorkHistoryUnclassifiedSession

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            Text("미분류 · 진행 중")
                .font(.system(size: 9.5, weight: .semibold, design: .monospaced))
                .foregroundStyle(OpenDesignDayColor.amber)
                .padding(.horizontal, 7)
                .padding(.vertical, 2)
                .background(Capsule().fill(OpenDesignDayColor.amberDim))
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(OpenDesignHistoryFormat.providerLabel(session.provider))
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(OpenDesignDayColor.fgSecondary)
                    Text("\(OpenDesignHistoryFormat.localTime(session.start) ?? "—")–\(OpenDesignHistoryFormat.localTime(session.end) ?? "—")")
                        .font(.system(size: 10.5, weight: .medium, design: .monospaced))
                        .foregroundStyle(OpenDesignDayColor.muted)
                    Text(OpenDesignHistoryFormat.minutes(session.minutes))
                        .font(.system(size: 10.5, weight: .semibold, design: .monospaced))
                        .foregroundStyle(OpenDesignDayColor.fgSecondary)
                }
                if !session.paths.isEmpty {
                    Text(session.paths.joined(separator: " · "))
                        .font(.system(size: 10, weight: .medium, design: .monospaced))
                        .foregroundStyle(OpenDesignDayColor.muted)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(referenceRounded(fill: OpenDesignDayColor.surface.opacity(0.6), stroke: OpenDesignDayColor.amber.opacity(0.25), radius: 12))
    }
}

private struct OpenDesignHistoryReferenceEventsView: View {
    let events: [WorkHistoryReferenceEvent]

    private func icon(_ kind: String) -> String {
        switch kind {
        case "pr": return "arrow.triangle.pull"
        case "issue": return "exclamationmark.circle"
        case "release": return "shippingbox"
        default: return "person.2"
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("참고 이벤트")
                .font(.system(size: 10, weight: .medium, design: .monospaced))
                .textCase(.uppercase)
                .foregroundStyle(OpenDesignDayColor.mutedDeep)
            ForEach(events, id: \.self) { event in
                HStack(spacing: 6) {
                    Image(systemName: icon(event.kind))
                        .font(.system(size: 9.5, weight: .medium))
                        .foregroundStyle(OpenDesignDayColor.mutedDeep)
                    Text(event.title)
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(OpenDesignDayColor.muted)
                        .lineLimit(1)
                    if let actor = event.actor, !actor.isEmpty {
                        Text(actor)
                            .font(.system(size: 10, weight: .medium, design: .monospaced))
                            .foregroundStyle(OpenDesignDayColor.mutedDeep)
                    }
                    Spacer(minLength: 0)
                }
            }
        }
        .padding(.horizontal, 4)
        .padding(.top, 2)
    }
}

// MARK: 상태 화면 — GitHub 연결 요구 / 빈 상태

private struct OpenDesignHistoryGitHubRequiredView: View {
    let refresh: () -> Void
    @State private var isHovered = false

    var body: some View {
        VStack(spacing: 14) {
            Image(systemName: "link.badge.plus")
                .font(.system(size: 30, weight: .medium))
                .foregroundStyle(OpenDesignDayColor.muted)
            Text("GitHub 연결이 필요해요")
                .font(.system(size: 14.5, weight: .semibold))
                .foregroundStyle(OpenDesignDayColor.fg)
            Text("이번 주 회고는 GitHub의 브랜치·PR·이슈·릴리즈까지 함께 봅니다.\n터미널에서 `gh auth login`으로 GitHub CLI를 연결한 뒤 다시 시도하세요.")
                .font(.system(size: 12, weight: .regular))
                .foregroundStyle(OpenDesignDayColor.fgSecondary)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
            Button(action: refresh) {
                Text("연결 확인 후 다시 인덱싱")
                    .font(.system(size: 11.5, weight: .semibold))
                    .foregroundStyle(OpenDesignDayColor.bgDeep)
                    .padding(.horizontal, 14)
                    .frame(height: 28)
                    .background(referenceRounded(fill: isHovered ? OpenDesignDayColor.accentStrong : OpenDesignDayColor.accent, stroke: Color.clear, radius: 8))
            }
            .buttonStyle(.plain)
            .onHover { isHovered = $0 }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 56)
        .background(referenceRounded(fill: OpenDesignDayColor.surface, stroke: OpenDesignDayColor.borderSoft, radius: 14))
        .accessibilityIdentifier("opendesign.reference.history.githubRequired")
    }
}

private struct OpenDesignHistoryEmptyStateView: View {
    let snapshot: WorkHistorySnapshot
    let refresh: () -> Void
    @State private var isHovered = false

    var body: some View {
        VStack(spacing: 14) {
            if snapshot.isRefreshing {
                ProgressView()
                    .controlSize(.small)
                Text(snapshot.status.progressText ?? "이번 주 작업 기록을 인덱싱하는 중")
                    .font(.system(size: 12.5, weight: .medium))
                    .foregroundStyle(OpenDesignDayColor.fgSecondary)
            } else {
                Image(systemName: "calendar.badge.clock")
                    .font(.system(size: 30, weight: .medium))
                    .foregroundStyle(OpenDesignDayColor.muted)
                Text("아직 이번 주 기록이 없어요")
                    .font(.system(size: 14.5, weight: .semibold))
                    .foregroundStyle(OpenDesignDayColor.fg)
                Text("AI 세션 로그(Claude·Codex·Gemini)와 git·GitHub 활동을 모아\n기능 영역별 주간 회고를 만들어 드립니다.")
                    .font(.system(size: 12, weight: .regular))
                    .foregroundStyle(OpenDesignDayColor.fgSecondary)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
                Button(action: refresh) {
                    Text("지금 인덱싱")
                        .font(.system(size: 11.5, weight: .semibold))
                        .foregroundStyle(OpenDesignDayColor.bgDeep)
                        .padding(.horizontal, 14)
                        .frame(height: 28)
                        .background(referenceRounded(fill: isHovered ? OpenDesignDayColor.accentStrong : OpenDesignDayColor.accent, stroke: Color.clear, radius: 8))
                }
                .buttonStyle(.plain)
                .onHover { isHovered = $0 }
                if let error = snapshot.status.error, !error.isEmpty {
                    Text(error)
                        .font(.system(size: 10.5, weight: .medium, design: .monospaced))
                        .foregroundStyle(OpenDesignDayColor.rose)
                        .lineLimit(2)
                }
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 56)
        .background(referenceRounded(fill: OpenDesignDayColor.surface, stroke: OpenDesignDayColor.borderSoft, radius: 14))
        .accessibilityIdentifier("opendesign.reference.history.empty")
    }
}

// MARK: 우측 — 미분류 전체 + GitHub 연결 현황

private struct OpenDesignHistoryMetaPanelView: View {
    let snapshot: WorkHistorySnapshot

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                Text("요약")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(OpenDesignDayColor.fg)

                VStack(alignment: .leading, spacing: 8) {
                    if snapshot.retrospective.hasContent {
                        OpenDesignHistoryStatRow(
                            label: "판단",
                            value: OpenDesignHistoryFormat.verdictLabel(snapshot.retrospective.verdict),
                            isAccent: true
                        )
                        OpenDesignHistoryStatRow(
                            label: "인사이트",
                            value: "\(snapshot.retrospective.insights.count)건",
                            isAccent: false
                        )
                        OpenDesignHistoryStatRow(
                            label: "리스크",
                            value: "\(snapshot.retrospective.riskFlags.count)건",
                            isAccent: false
                        )
                    }
                    OpenDesignHistoryStatRow(
                        label: "GitHub",
                        value: snapshot.github.connected ? "연결됨" : "연결 필요",
                        isAccent: snapshot.github.connected
                    )
                    if snapshot.github.connected {
                        OpenDesignHistoryStatRow(label: "PR", value: "\(snapshot.github.prCount)건", isAccent: false)
                        OpenDesignHistoryStatRow(label: "이슈", value: "\(snapshot.github.issueCount)건", isAccent: false)
                        OpenDesignHistoryStatRow(label: "릴리즈", value: "\(snapshot.github.releaseCount)건", isAccent: false)
                    }
                    OpenDesignHistoryStatRow(
                        label: "타인/봇 커밋",
                        value: "\(snapshot.totals.otherCommitCount)건",
                        isAccent: false
                    )
                }
                .padding(13)
                .background(referenceRounded(fill: OpenDesignDayColor.surface, stroke: OpenDesignDayColor.borderSoft, radius: 12))

                if !snapshot.retrospective.evidenceMix.isEmpty {
                    Text("근거 커버리지")
                        .font(.system(size: 10.5, weight: .medium, design: .monospaced))
                        .textCase(.uppercase)
                        .foregroundStyle(OpenDesignDayColor.mutedDeep)
                        .padding(.top, 2)
                        .padding(.horizontal, 4)

                    VStack(spacing: 6) {
                        ForEach(snapshot.retrospective.evidenceMix) { item in
                            OpenDesignHistoryEvidenceMixRow(item: item)
                        }
                    }
                }

                if !snapshot.unclassified.isEmpty {
                    Text("미분류 · 진행 중 \(snapshot.unclassified.count)건")
                        .font(.system(size: 10.5, weight: .medium, design: .monospaced))
                        .textCase(.uppercase)
                        .foregroundStyle(OpenDesignDayColor.mutedDeep)
                        .padding(.top, 2)
                        .padding(.horizontal, 4)

                    VStack(spacing: 6) {
                        ForEach(snapshot.unclassified, id: \.self) { session in
                            OpenDesignHistoryUnclassifiedRow(session: session)
                        }
                    }
                }

                Text("프롬프트 원문은 연결 근거로만 사용하고 화면·저장본에는 남기지 않아요.")
                    .font(.system(size: 10, weight: .medium))
                    .foregroundStyle(OpenDesignDayColor.mutedDeep)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.horizontal, 4)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 16)
        }
    }
}

private struct OpenDesignHistoryEvidenceMixRow: View {
    let item: WorkHistoryEvidenceMix

    var body: some View {
        let tone = OpenDesignHistoryFormat.evidenceStatusTone(item.status)
        HStack(spacing: 8) {
            Circle()
                .fill(tone)
                .frame(width: 6, height: 6)
            Text(item.label)
                .font(.system(size: 11.5, weight: .medium))
                .foregroundStyle(OpenDesignDayColor.fgSecondary)
                .lineLimit(1)
            Spacer(minLength: 8)
            Text("\(item.count)")
                .font(.system(size: 10.5, weight: .semibold, design: .monospaced))
                .foregroundStyle(item.count > 0 ? OpenDesignDayColor.fg : OpenDesignDayColor.mutedDeep)
            Text(OpenDesignHistoryFormat.evidenceStatusLabel(item.status))
                .font(.system(size: 9.5, weight: .medium, design: .monospaced))
                .foregroundStyle(tone)
                .lineLimit(1)
        }
        .padding(.horizontal, 10)
        .frame(height: 30)
        .background(referenceRounded(fill: OpenDesignDayColor.surface, stroke: OpenDesignDayColor.borderSoft, radius: 8))
    }
}

private struct OpenDesignProjectStat: Identifiable {
    let id: String
    let label: String
    let value: String
    let suffix: String
    let delta: String
    let tone: OpenDesignReferenceTone
    let isFlat: Bool
}

private struct OpenDesignProjectKV: Identifiable {
    let id: String
    let key: String
    let value: String
    let status: String
    let tone: OpenDesignReferenceTone
}

private struct OpenDesignProjectPath: Identifiable {
    let id: String
    let systemImage: String
    let name: String
    let requirement: String
    let path: String
    let hint: String?
    let statusParts: [String]
    let isSource: Bool
    let tone: OpenDesignReferenceTone
}

private struct OpenDesignProjectDoc: Identifiable {
    let id: String
    let mark: String
    let name: String
    let location: String
    let subtitle: String
    let age: String
    let pin: String
    let isPinned: Bool
    let tone: OpenDesignReferenceTone
}

private struct OpenDesignProjectTimelineEvent: Identifiable {
    let id: String
    let title: String
    let emphasis: String?
    let subtitle: String
    let time: String
    let tone: OpenDesignReferenceTone
}

private struct OpenDesignProjectMetaRow: Identifiable {
    let id: String
    let systemImage: String
    let key: String
    let value: String
    let tone: OpenDesignReferenceTone
}

private enum OpenDesignProjectsCatalog {
    static let stats: [OpenDesignProjectStat] = [
        .init(id: "days", label: "완료한 Day", value: "0", suffix: "/ 30", delta: "→ Day 1 진행 중", tone: .muted, isFlat: true),
        .init(id: "interviews", label: "인터뷰 원문", value: "1", suffix: "/ 5 기준", delta: "+ 1 어제", tone: .accent, isFlat: false),
        .init(id: "bip", label: "공개 기록 글", value: "0", suffix: "/ 14 권장", delta: "— 미시작", tone: .muted, isFlat: true),
        .init(id: "roots", label: "소스 코드 루트", value: "3", suffix: "/ watch 활성", delta: "+ 2 보조 레포", tone: .accent, isFlat: false),
    ]

    static let basics: [OpenDesignProjectKV] = [
        .init(id: "summary", key: "한 문장 요약", value: "전업 1인 개발자가 자기 프로젝트와 실행 기록을 근거로 30일 안에 시장 적합 검증 방향을 좁히도록 돕는다", status: "필수", tone: .muted),
        .init(id: "icp", key: "고객 후보", value: "전업 1인 개발자 · macOS 사용 · 수익 0원 · 30일 스프린트 실행 의향 (상세는 ICP.md)", status: "정의됨", tone: .accent),
        .init(id: "platform", key: "제품 플랫폼", value: "macOS 메뉴바 앱 · 커리큘럼 대상 제품 플랫폼은 iOS/Android/Web/Mac 자유", status: "macOS", tone: .accent),
        .init(id: "hypothesis", key: "현재 가설", value: "\"만들 줄은 알지만 무엇을 만들어야 팔리는지 모르는\" 1인 개발자가, 실제 기록을 분석한 맞춤 과제가 일반 강의보다 다음 행동을 더 잘 만든다 — Day 0-3에서 검증", status: "검증 중", tone: .amber),
        .init(id: "model", key: "수익 모델 가설", value: "— 미설정 — 초기 검증 통과 후 Day 8+ 만들기 단계에서 결정", status: "대기", tone: .muted),
        .init(id: "evidence", key: "증거 채널", value: "고객 인터뷰 · 공개 기록 (Threads) · 업무 일지 · 직접 사용 패턴", status: "4채널", tone: .accent),
    ]

    static let paths: [OpenDesignProjectPath] = [
        .init(id: "app", systemImage: "folder", name: "소스 코드 경로 1 · 제품 앱", requirement: "필수", path: "~/code/agentic30-desktop", hint: "SwiftUI 메뉴바 앱 · 마지막 커밋 4분 전", statusParts: ["● 워치 활성", "312 파일", "git: main · 클린"], isSource: true, tone: .accent),
        .init(id: "sidecar", systemImage: "chevron.left.forwardslash.chevron.right", name: "소스 코드 경로 2 · 실행 보조 앱", requirement: "필수", path: "~/code/agentic30-sidecar", hint: "파일 감시 / AI 연결 / 로컬 색인", statusParts: ["● 워치 활성", "148 파일", "git: main · +2 unstaged"], isSource: true, tone: .accent),
        .init(id: "public", systemImage: "globe", name: "소스 코드 경로 3 · 공개 웹/문서", requirement: "선택", path: "~/code/agentic30-public", hint: "소개 페이지 / 문서 / 미리보기 자료", statusParts: ["● 워치 활성", "152 파일", "git: main · 클린"], isSource: true, tone: .sky),
        .init(id: "interviews", systemImage: "bubble.left.and.bubble.right", name: "인터뷰 원문 폴더", requirement: "필수", path: "~/Documents/Agentic30/agentic30/interviews", hint: ".txt / .md / .vtt / .srt", statusParts: ["● 워치 활성", "1 / 5 기준", "최근 어제"], isSource: false, tone: .accent),
        .init(id: "journal", systemImage: "doc.text", name: "업무 일지 / 공개 기록 폴더", requirement: "선택", path: "~/Documents/Agentic30/agentic30/journal", hint: nil, statusParts: ["● 워치 활성", "3 파일", "오늘 만든 것 / 막힌 것 / 배운 것"], isSource: false, tone: .accent),
    ]

    static let docs: [OpenDesignProjectDoc] = [
        .init(id: "spec", mark: "MD", name: "SPEC.md", location: "~/code/agentic30-public/docs", subtitle: "제품 한 문장 · 고객 후보 · 핵심 반복 흐름 · 첫 버전 범위 · 열린 질문 · v2026-05-07", age: "방금 동기화", pin: "핀 · 컨텍스트", isPinned: true, tone: .accent),
        .init(id: "icp", mark: "MD", name: "ICP.md", location: "~/code/agentic30-public/docs", subtitle: "타깃 고객 정의 · 전업 1인 개발자 · macOS · 수익 0원", age: "2일 전", pin: "핀 · 컨텍스트", isPinned: true, tone: .accent),
        .init(id: "goal", mark: "MD", name: "GOAL.md", location: "~/code/agentic30-public/docs", subtitle: "2026 Q2 제품 집중 목표 · 초기 검증 흐름 동작 · 4개 목표", age: "7일 전", pin: "핀 · 컨텍스트", isPinned: true, tone: .accent),
        .init(id: "interview", mark: "VTT", name: "2026-05-15 장지창 인터뷰", location: "~/Documents/Agentic30/agentic30/interviews", subtitle: "29분 · 한국어 · 분석 완료 · Day 1 고객 후보 좁히기에 반영됨", age: "어제", pin: "핀 · 컨텍스트", isPinned: true, tone: .violet),
        .init(id: "values", mark: "MD", name: "VALUES.md", location: "~/code/agentic30-public/docs", subtitle: "행동 원칙 · 맞춤 출력의 톤을 결정", age: "7일 전", pin: "핀 안 됨", isPinned: false, tone: .sky),
    ]

    static let timeline: [OpenDesignProjectTimelineEvent] = [
        .init(id: "task", title: "Day 1 과제 생성", emphasis: "고객 후보 좁히기 (3개 변형)", subtitle: "Claude Sonnet 4.6 · 312ms · 입력 2.1KB · 결과 도구로 전달됨", time: "4분 전", tone: .accent),
        .init(id: "interview", title: "인터뷰 1건 추가", emphasis: "장지창 (29분)", subtitle: "파일 2026-05-15-jangjichang.vtt · 자동 분석 · 통증 후보 3개 추출", time: "어제 19:42", tone: .sky),
        .init(id: "spec", title: "SPEC.md 갱신", emphasis: "Q2 진입점을 Day 0-3로 좁힘", subtitle: "변경 +14 / -8 · 한 문장 요약 변경 없음 · 고객 후보 추가", time: "7일 전", tone: .violet),
        .init(id: "journal", title: "업무 일지 작성", emphasis: "오늘 막힌 것 1건", subtitle: "~/journal/2026-05-15.md · 응답 지연, 보조 작업 라우팅", time: "어제 22:10", tone: .amber),
        .init(id: "created", title: "프로젝트 생성", emphasis: nil, subtitle: "소스 코드 / 인터뷰 / 일지 경로 지정 · 초기 검증 Day 0 시작", time: "2026-05-16 09:00", tone: .accent),
        .init(id: "more", title: "10개 더 보기 …", emphasis: nil, subtitle: "", time: "", tone: .muted),
    ]

    static let workflows: [OpenDesignProjectKV] = [
        .init(id: "office", key: "/office-hours-docs", value: "Day 1, 3에서 사용 · 문제 정의 / spec 작성 보조", status: "활성", tone: .accent),
        .init(id: "bip", key: "/bip-draft", value: "Day 18-24에서 사용 · 오늘 한 일을 공개 기록 글로 변환 — 초기 검증에서는 회귀만 방지", status: "대기", tone: .muted),
        .init(id: "ads", key: "/analyze-ads", value: "Day 5 + Day 25+에서 사용 · Meta Ads 캠페인/소재 분석 — Codex 미연결로 일부 비활성", status: "조건부", tone: .amber),
        .init(id: "qmd", key: "/qmd-support", value: "QuickMemoDeck 학습 회상용 · 이 프로젝트와는 무관해서 오프", status: "꺼짐", tone: .muted),
    ]

    static let metaRows: [OpenDesignProjectMetaRow] = [
        .init(id: "active", systemImage: "clock", key: "활성 프로젝트", value: "3개", tone: .accent),
        .init(id: "phase", systemImage: "waveform.path.ecg", key: "진행 phase", value: "F2 · B1", tone: .violet),
        .init(id: "interviews", systemImage: "bubble.left.and.bubble.right", key: "인터뷰", value: "5 / 15 게이트", tone: .amber),
        .init(id: "roots", systemImage: "doc.text", key: "소스 루트", value: "9개 watch", tone: .accent),
        .init(id: "calls", systemImage: "chart.line.uptrend.xyaxis", key: "오늘 호출", value: "3 · $0.04", tone: .accent),
        .init(id: "target", systemImage: "trash", key: "D-30 목표일", value: "2026-06-15", tone: .muted),
    ]

    static let archiveRows: [OpenDesignProjectMetaRow] = [
        .init(id: "qmd", systemImage: "checkmark", key: "qmd-support", value: "완주 28/30", tone: .accent),
        .init(id: "meal", systemImage: "minus.circle", key: "MealMate", value: "중단 D9", tone: .muted),
        .init(id: "avg", systemImage: "chart.line.uptrend.xyaxis", key: "평균 완주율", value: "62% (2건)", tone: .sky),
    ]
}

private struct OpenDesignProjectsShell: View {
    let layout: OpenDesignDayLayoutMetrics
    let openSearch: () -> Void

    var body: some View {
        if layout.showsTaskSidebar {
            ZStack {
                OpenDesignProjectsSidebarView(openSearch: openSearch)
                Color.clear
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel("OpenDesign Projects Sidebar")
                    .accessibilityIdentifier("opendesign.reference.projects.side")
                    .allowsHitTesting(false)
            }
            .frame(width: layout.taskSidebarWidth)
            .frame(maxHeight: .infinity)
            .background(OpenDesignDayColor.bg)
        }

        ZStack {
            OpenDesignProjectsMainView(layout: layout)
            Color.clear
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("OpenDesign Projects Main")
                .accessibilityIdentifier("opendesign.reference.projects.main")
                .allowsHitTesting(false)
        }
            .frame(maxWidth: .infinity, maxHeight: .infinity)

        if layout.showsMetaPanel {
            ZStack {
                OpenDesignProjectsMetaPanelView()
                Color.clear
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel("OpenDesign Projects Meta")
                    .accessibilityIdentifier("opendesign.reference.projects.meta")
                    .allowsHitTesting(false)
            }
            .frame(width: layout.metaPanelWidth)
            .frame(maxHeight: .infinity)
            .background(OpenDesignDayColor.bg)
        }
    }
}

private struct OpenDesignProjectsSidebarView: View {
    let openSearch: () -> Void
    private let page = OpenDesignReferenceCatalog.page(.projects)

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 6) {
                Text(page.sideTitle)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(OpenDesignDayColor.fg)
                Text(page.sideBadge ?? "활성 3")
                    .font(.system(size: 10, weight: .medium, design: .monospaced))
                    .foregroundStyle(OpenDesignDayColor.accent)
                    .padding(.horizontal, 7)
                    .frame(height: 18)
                    .background(Capsule().fill(OpenDesignDayColor.accentDim))
                    .overlay(Capsule().stroke(OpenDesignDayColor.accentLine, lineWidth: 1))
                Spacer(minLength: 0)
            }
            .padding(.top, 10)
            .padding(.horizontal, 12)
            .padding(.bottom, 8)

            Button(action: openSearch) {
                HStack(spacing: 8) {
                    Image(systemName: "magnifyingglass")
                        .font(.system(size: 10, weight: .semibold))
                    Text(page.sideSearchPlaceholder ?? "프로젝트 검색")
                        .lineLimit(1)
                    Spacer(minLength: 6)
                    Text("⌘ P")
                        .font(.system(size: 10, weight: .medium, design: .monospaced))
                        .foregroundStyle(OpenDesignDayColor.mutedDeep)
                }
                .font(.system(size: 11.5, weight: .medium))
                .foregroundStyle(OpenDesignDayColor.fgSecondary)
                .padding(.horizontal, 10)
                .frame(height: 32)
                .background(referenceRounded(fill: OpenDesignDayColor.surface, stroke: OpenDesignDayColor.borderSoft, radius: 6))
            }
            .buttonStyle(.plain)
            .padding(.horizontal, 8)
            .padding(.bottom, 6)

            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0) {
                    ForEach(page.sideGroups.indices, id: \.self) { groupIndex in
                        let group = page.sideGroups[groupIndex]
                        HStack {
                            Text(group.title)
                            Spacer()
                            if let count = group.count {
                                Text(count)
                            }
                        }
                        .font(.system(size: 10, weight: .medium, design: .monospaced))
                        .textCase(.uppercase)
                        .foregroundStyle(OpenDesignDayColor.mutedDeep)
                        .padding(.top, groupIndex == 0 ? 8 : 14)
                        .padding(.horizontal, 8)
                        .padding(.bottom, 6)

                        ForEach(group.rows) { row in
                            OpenDesignProjectsSideRowView(row: row)
                        }
                    }
                }
                .padding(.horizontal, 6)
                .padding(.bottom, 14)
            }

            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 6) {
                    Circle()
                        .fill(OpenDesignDayColor.accent)
                        .frame(width: 5, height: 5)
                        .shadow(color: OpenDesignDayColor.accent.opacity(0.45), radius: 4)
                    Text("마지막 활동")
                        .foregroundStyle(OpenDesignDayColor.mutedDeep)
                    Text("4분 전")
                        .foregroundStyle(OpenDesignDayColor.fgSecondary)
                    Text("· Day 1")
                        .foregroundStyle(OpenDesignDayColor.mutedDeep)
                }
                .font(.system(size: 10.5, weight: .medium, design: .monospaced))

                Button(action: {}) {
                    HStack(spacing: 8) {
                        Image(systemName: "plus")
                            .font(.system(size: 12, weight: .bold))
                        Text("새 30일 프로젝트")
                        Spacer(minLength: 4)
                        Text("⌘ N")
                            .font(.system(size: 10, weight: .medium, design: .monospaced))
                            .padding(.horizontal, 5)
                            .frame(height: 18)
                            .background(Capsule().fill(OpenDesignDayColor.bgDeep.opacity(0.36)))
                    }
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(OpenDesignDayColor.bgDeep)
                    .padding(.horizontal, 10)
                    .frame(height: 30)
                    .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(OpenDesignDayColor.accent))
                }
                .buttonStyle(.plain)
            }
            .padding(12)
            .background(OpenDesignDayColor.bg)
            .overlay(Rectangle().fill(OpenDesignDayColor.borderSoft).frame(height: 1), alignment: .top)
        }
        .background(OpenDesignDayColor.bg)
        .overlay(Rectangle().fill(OpenDesignDayColor.borderSoft).frame(width: 1), alignment: .trailing)
    }
}

private struct OpenDesignProjectsSideRowView: View {
    let row: OpenDesignReferenceSideRow
    @State private var isHovered = false

    var body: some View {
        HStack(spacing: 10) {
            Text(row.leading)
                .font(.system(size: row.leading.count > 2 ? 9 : 11, weight: .semibold, design: .monospaced))
                .foregroundStyle(row.isActive ? row.tone.color : row.tone == .muted ? OpenDesignDayColor.muted : row.tone.color)
                .frame(width: 26, height: 26)
                .background(referenceRounded(fill: row.isActive ? row.tone.dim : row.tone == .muted ? OpenDesignDayColor.bgDeep : row.tone.dim, stroke: row.isActive ? row.tone.line : row.tone == .muted ? OpenDesignDayColor.border : row.tone.line, radius: 7))

            VStack(alignment: .leading, spacing: 2) {
                Text(row.title)
                    .font(.system(size: 12.5, weight: .medium))
                    .foregroundStyle(row.isActive || isHovered ? OpenDesignDayColor.fg : OpenDesignDayColor.fgSecondary)
                    .lineLimit(1)
                if let subtitle = row.subtitle {
                    HStack(spacing: 5) {
                        Circle()
                            .fill(row.tone == .amber ? OpenDesignDayColor.amber : row.tone == .muted ? OpenDesignDayColor.mutedDeep : OpenDesignDayColor.accent)
                            .frame(width: 4, height: 4)
                        Text(subtitle)
                            .lineLimit(1)
                    }
                    .font(.system(size: 10, weight: .medium, design: .monospaced))
                    .foregroundStyle(OpenDesignDayColor.muted)
                }
            }

            Spacer(minLength: 6)

            if let badge = row.badge {
                Text(badge)
                    .font(.system(size: 10, weight: .medium, design: .monospaced))
                    .foregroundStyle(row.isActive ? row.tone.color : OpenDesignDayColor.muted)
                    .padding(.horizontal, 6)
                    .frame(height: 18)
                    .background(Capsule().fill(row.isActive ? row.tone.dim : OpenDesignDayColor.bgDeep))
                    .overlay(Capsule().stroke(row.isActive ? row.tone.line : OpenDesignDayColor.borderSoft, lineWidth: 1))
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .background(referenceRounded(fill: row.isActive ? OpenDesignDayColor.selected : isHovered ? OpenDesignDayColor.hover : Color.clear, stroke: row.isActive ? OpenDesignDayColor.borderSoft : Color.clear, radius: 7))
        .contentShape(RoundedRectangle(cornerRadius: 7, style: .continuous))
        .onHover { isHovered = $0 }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(row.title)
    }
}

private struct OpenDesignProjectsMainView: View {
    let layout: OpenDesignDayLayoutMetrics

    var body: some View {
        VStack(spacing: 0) {
            OpenDesignProjectsHeaderView(horizontalPadding: layout.mainHorizontalPadding)

            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    OpenDesignProjectsSectionHeader(
                        title: "개요",
                        meta: "Day 1 of 30 · 초기 검증 진행 중",
                        tone: .accent
                    )
                    .accessibilityIdentifier("opendesign.reference.projects.overview")

                    OpenDesignProjectsOverviewCard()

                    OpenDesignProjectsStatsView(stats: OpenDesignProjectsCatalog.stats)
                        .padding(.top, 12)

                    OpenDesignProjectsSectionHeader(
                        title: "Phase 게이트",
                        meta: "진행 통과 조건 · Q2 진입점은 초기 검증",
                        tone: .accent
                    )
                    OpenDesignProjectsGateList()

                    OpenDesignProjectsSectionHeader(
                        title: "프로젝트 기본 정보",
                        meta: "사용자 입력 · 언제든 수정 가능",
                        tone: .accent
                    )
                    OpenDesignProjectsBasicsCard()

                    OpenDesignProjectsSectionHeader(
                        title: "프로젝트 경로",
                        meta: "소스 코드 3개 + 자료 폴더 2개 · 이 프로젝트에서만 watch",
                        tone: .accent
                    )
                    ForEach(OpenDesignProjectsCatalog.paths) { path in
                        OpenDesignProjectPathCard(path: path)
                    }
                    OpenDesignProjectPathFooter()

                    OpenDesignProjectsSectionHeader(
                        title: "핀 고정된 문서",
                        meta: "5 / 612 파일 · 여러 소스 루트에서 컨텍스트로 자동 전달",
                        tone: .accent
                    )
                    OpenDesignProjectDocList()

                    OpenDesignProjectsSectionHeader(
                        title: "최근 활동",
                        meta: "이 프로젝트만 · 12개 항목 · 자동 기록",
                        tone: .accent
                    )
                    OpenDesignProjectTimeline()

                    OpenDesignProjectsSectionHeader(
                        title: "연결된 보조 작업",
                        meta: "Phase별 자동 활성 / 비활성",
                        tone: .accent
                    )
                    OpenDesignProjectWorkflowCard()

                    OpenDesignProjectsSectionHeader(title: "위험 구역", meta: nil, tone: .rose)
                    OpenDesignProjectDangerZone()
                }
                .frame(maxWidth: 860, alignment: .leading)
                .padding(.horizontal, layout.mainHorizontalPadding)
                .padding(.top, 22)
                .padding(.bottom, 34)
                .frame(maxWidth: .infinity)
            }
            .background(OpenDesignDayColor.bg)
        }
        .background(OpenDesignDayColor.bg)
    }
}

private struct OpenDesignProjectsHeaderView: View {
    let horizontalPadding: CGFloat

    var body: some View {
        HStack(spacing: 12) {
            HStack(spacing: 14) {
                Text("A3")
                    .font(.system(size: 14, weight: .bold, design: .monospaced))
                    .foregroundStyle(OpenDesignDayColor.accent)
                    .frame(width: 44, height: 44)
                    .background(referenceRounded(fill: OpenDesignDayColor.accentDim, stroke: OpenDesignDayColor.accentLine, radius: 11))

                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 10) {
                        Text("Agentic30 (직접 사용 중)")
                            .font(.system(size: 17, weight: .semibold))
                            .foregroundStyle(OpenDesignDayColor.fg)
                            .lineLimit(1)
                        Text("활성")
                            .font(.system(size: 10, weight: .medium, design: .monospaced))
                            .foregroundStyle(OpenDesignDayColor.accent)
                            .padding(.horizontal, 8)
                            .frame(height: 20)
                            .background(Capsule().fill(OpenDesignDayColor.accentDim))
                            .overlay(Capsule().stroke(OpenDesignDayColor.accentLine, lineWidth: 1))
                    }

                    HStack(spacing: 8) {
                        Circle()
                            .fill(OpenDesignDayColor.accent)
                            .frame(width: 5, height: 5)
                        Text("초기 검증 ·")
                        Text("Day 1 / 30")
                            .foregroundStyle(OpenDesignDayColor.fgSecondary)
                        Text("·")
                            .foregroundStyle(OpenDesignDayColor.mutedDeep)
                        Text("macOS 메뉴바 앱")
                        Text("·")
                            .foregroundStyle(OpenDesignDayColor.mutedDeep)
                        Text("소스 코드")
                        Text("3")
                            .foregroundStyle(OpenDesignDayColor.fgSecondary)
                        Text("개 · 마지막 활동 4분 전")
                    }
                    .font(.system(size: 11, weight: .medium, design: .monospaced))
                    .foregroundStyle(OpenDesignDayColor.muted)
                    .lineLimit(1)
                }
                .frame(minWidth: 0, alignment: .leading)
            }

            Spacer(minLength: 10)

            HStack(spacing: 6) {
                OpenDesignProjectHeaderButton(title: "프로젝트 전환", systemImage: "sidebar.left", isPrimary: false)
                OpenDesignProjectHeaderButton(title: "오늘 화면 열기", systemImage: "chevron.right", isPrimary: true)
            }
        }
        .padding(.horizontal, horizontalPadding)
        .frame(height: 70)
        .background(OpenDesignDayColor.bg)
        .overlay(Rectangle().fill(OpenDesignDayColor.borderSoft).frame(height: 1), alignment: .bottom)
    }
}

private struct OpenDesignProjectHeaderButton: View {
    let title: String
    let systemImage: String
    let isPrimary: Bool
    @State private var isHovered = false

    var body: some View {
        Button(action: {}) {
            HStack(spacing: 6) {
                Image(systemName: systemImage)
                    .font(.system(size: 11, weight: .semibold))
                Text(title)
                    .lineLimit(1)
            }
            .font(.system(size: 11.5, weight: isPrimary ? .semibold : .medium))
            .foregroundStyle(isPrimary ? OpenDesignDayColor.bgDeep : isHovered ? OpenDesignDayColor.fg : OpenDesignDayColor.fgSecondary)
            .padding(.horizontal, isPrimary ? 14 : 12)
            .frame(height: 28)
            .background(
                referenceRounded(
                    fill: isPrimary ? (isHovered ? OpenDesignDayColor.accentStrong : OpenDesignDayColor.accent) : (isHovered ? OpenDesignDayColor.hover : Color.clear),
                    stroke: isPrimary ? Color.clear : OpenDesignDayColor.borderSoft,
                    radius: 8
                )
            )
        }
        .buttonStyle(.plain)
        .onHover { isHovered = $0 }
        .accessibilityLabel(title)
    }
}

private struct OpenDesignProjectsSectionHeader: View {
    let title: String
    let meta: String?
    let tone: OpenDesignReferenceTone

    var body: some View {
        HStack(spacing: 10) {
            RoundedRectangle(cornerRadius: 2, style: .continuous)
                .fill(tone.color)
                .frame(width: 4, height: 12)
            Text(title)
                .font(.system(size: 11, weight: .medium, design: .monospaced))
                .textCase(.uppercase)
                .foregroundStyle(OpenDesignDayColor.muted)
            if let meta {
                Text(meta)
                    .font(.system(size: 10.5, weight: .medium, design: .monospaced))
                    .foregroundStyle(OpenDesignDayColor.mutedDeep)
                    .lineLimit(1)
            }
            Rectangle()
                .fill(OpenDesignDayColor.borderSoft)
                .frame(height: 1)
        }
        .padding(.top, 20)
        .padding(.bottom, 12)
    }
}

private struct OpenDesignProjectsOverviewCard: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .center, spacing: 16) {
                OpenDesignProjectsProgressRing(progress: 0.033, label: "3%")

                VStack(alignment: .leading, spacing: 5) {
                    Text("초기 검증 · Day 0-7")
                        .font(.system(size: 10.5, weight: .medium, design: .monospaced))
                        .foregroundStyle(OpenDesignDayColor.accent)
                        .textCase(.uppercase)
                    Text("오늘은 Day 1 · 고객 후보 좁히기예요. 다음 기준은 Day 3 인터뷰 5건까지 6일.")
                        .font(.system(size: 16, weight: .medium))
                        .foregroundStyle(OpenDesignDayColor.fg)
                        .lineSpacing(2.5)
                        .fixedSize(horizontal: false, vertical: true)

                    FlowLayout(spacing: 10, lineSpacing: 6) {
                        OpenDesignProjectsMetaToken("● 완료 0", tone: .accent)
                        OpenDesignProjectsMetaToken("● 진행 중 1", tone: .amber)
                        OpenDesignProjectsMetaToken("남은 일수 29", tone: .muted)
                        OpenDesignProjectsMetaToken("인터뷰 0 / 5", tone: .muted)
                        OpenDesignProjectsMetaToken("공개 기록 0 / 14", tone: .muted)
                    }
                }

                Spacer(minLength: 10)

                VStack(alignment: .trailing, spacing: 6) {
                    Text("시작 2026-05-16 · D-30: 2026-06-15")
                        .font(.system(size: 10.5, weight: .medium, design: .monospaced))
                        .foregroundStyle(OpenDesignDayColor.mutedDeep)
                        .lineLimit(1)
                    OpenDesignProjectMiniButton(title: "플랜 편집", systemImage: "trash", tone: .muted)
                }
                .frame(maxWidth: 208, alignment: .trailing)
            }

            OpenDesignProjectsDayStrip()
                .padding(.top, 14)
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 18)
        .background(referenceAccentEdgeCard(stroke: OpenDesignDayColor.border, accent: OpenDesignDayColor.accent))
        .accessibilityIdentifier("opendesign.reference.projects.overview.card")
    }
}

private struct OpenDesignProjectsProgressRing: View {
    let progress: CGFloat
    let label: String

    var body: some View {
        ZStack {
            Circle()
                .stroke(OpenDesignDayColor.surface, lineWidth: 6)
            Circle()
                .trim(from: 0, to: progress)
                .stroke(OpenDesignDayColor.accent, style: StrokeStyle(lineWidth: 6, lineCap: .round))
                .rotationEffect(.degrees(-90))
            Circle()
                .fill(OpenDesignDayColor.bgDeep)
                .padding(5)
            Text(label)
                .font(.system(size: 14, weight: .semibold, design: .monospaced))
                .foregroundStyle(OpenDesignDayColor.fg)
        }
        .frame(width: 56, height: 56)
        .accessibilityLabel("진행률 \(label)")
    }
}

private struct OpenDesignProjectsMetaToken: View {
    let text: String
    let tone: OpenDesignReferenceTone

    init(_ text: String, tone: OpenDesignReferenceTone) {
        self.text = text
        self.tone = tone
    }

    var body: some View {
        Text(text)
            .font(.system(size: 11, weight: .medium, design: .monospaced))
            .foregroundStyle(tone == .muted ? OpenDesignDayColor.muted : tone.color)
    }
}

private struct OpenDesignProjectsDayStrip: View {
    private let gateDays: Set<Int> = [3, 7, 17, 24, 30]

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Rectangle()
                .fill(OpenDesignDayColor.borderSoft)
                .frame(height: 1)
                .padding(.bottom, 5)

            HStack {
                Text("30일 캘린더")
                    .font(.system(size: 10.5, weight: .medium, design: .monospaced))
                    .textCase(.uppercase)
                    .foregroundStyle(OpenDesignDayColor.muted)
                Spacer()
                HStack(spacing: 10) {
                    OpenDesignProjectsLegendSwatch(color: OpenDesignDayColor.accent, label: "완료")
                    OpenDesignProjectsLegendSwatch(color: OpenDesignDayColor.accentStrong, label: "오늘")
                    OpenDesignProjectsLegendSwatch(color: OpenDesignDayColor.amber, label: "게이트")
                }
            }

            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 4), count: 30), spacing: 4) {
                ForEach(1...30, id: \.self) { day in
                    OpenDesignProjectsDayCell(day: day, phase: phase(for: day), isToday: day == 1, isGate: gateDays.contains(day))
                }
            }

            OpenDesignProjectsPhaseBar()

            FlowLayout(spacing: 14, lineSpacing: 7) {
                OpenDesignProjectsPhaseLegend(title: "초기 검증", detail: "D0-7", tone: .accent)
                OpenDesignProjectsPhaseLegend(title: "만들기", detail: "D8-17", tone: .violet)
                OpenDesignProjectsPhaseLegend(title: "공개", detail: "D18-24", tone: .sky)
                OpenDesignProjectsPhaseLegend(title: "성장", detail: "D25-30", tone: .amber)
            }
            .padding(.top, 2)
        }
    }

    private func phase(for day: Int) -> OpenDesignReferenceTone {
        switch day {
        case 1...7: return .accent
        case 8...17: return .violet
        case 18...24: return .sky
        default: return .amber
        }
    }
}

private struct OpenDesignProjectsLegendSwatch: View {
    let color: Color
    let label: String

    var body: some View {
        HStack(spacing: 4) {
            RoundedRectangle(cornerRadius: 2, style: .continuous)
                .fill(color)
                .frame(width: 8, height: 8)
            Text(label)
        }
        .font(.system(size: 10.5, weight: .medium, design: .monospaced))
        .foregroundStyle(OpenDesignDayColor.mutedDeep)
    }
}

private struct OpenDesignProjectsDayCell: View {
    let day: Int
    let phase: OpenDesignReferenceTone
    let isToday: Bool
    let isGate: Bool
    @State private var isHovered = false

    var body: some View {
        Text("\(day)")
            .font(.system(size: 9, weight: isToday ? .bold : .medium, design: .monospaced))
            .foregroundStyle(isToday ? OpenDesignDayColor.bgDeep : isGate ? OpenDesignDayColor.amber : OpenDesignDayColor.muted)
            .frame(maxWidth: .infinity)
            .aspectRatio(1, contentMode: .fit)
            .background(
                RoundedRectangle(cornerRadius: 4, style: .continuous)
                    .fill(isToday ? OpenDesignDayColor.accent : phase.dim.opacity(0.44))
                    .overlay(
                        RoundedRectangle(cornerRadius: 4, style: .continuous)
                            .stroke(isToday ? OpenDesignDayColor.accentStrong : isGate ? OpenDesignDayColor.amberLine : phase.line, lineWidth: 1)
                    )
            )
            .shadow(color: isToday ? OpenDesignDayColor.accent.opacity(0.22) : .clear, radius: 5)
            .offset(y: isHovered ? -1 : 0)
            .onHover { isHovered = $0 }
            .accessibilityLabel("Day \(day)")
    }
}

private struct OpenDesignProjectsPhaseBar: View {
    private let segments: [(tone: OpenDesignReferenceTone, span: CGFloat)] = [
        (.accent, 7), (.violet, 10), (.sky, 7), (.amber, 6)
    ]

    var body: some View {
        GeometryReader { geometry in
            let gap: CGFloat = 4
            let cell = max(1, (geometry.size.width - (29 * gap)) / 30)
            HStack(spacing: gap) {
                ForEach(Array(segments.enumerated()), id: \.offset) { _, segment in
                    RoundedRectangle(cornerRadius: 2, style: .continuous)
                        .fill(segment.tone.color)
                        .frame(width: cell * segment.span + gap * (segment.span - 1), height: 4)
                }
            }
        }
        .frame(height: 4)
        .padding(.top, 2)
    }
}

private struct OpenDesignProjectsPhaseLegend: View {
    let title: String
    let detail: String
    let tone: OpenDesignReferenceTone

    var body: some View {
        HStack(spacing: 6) {
            RoundedRectangle(cornerRadius: 2, style: .continuous)
                .fill(tone.color)
                .frame(width: 8, height: 8)
            Text("\(title) ·")
            Text(detail)
                .foregroundStyle(OpenDesignDayColor.fgSecondary)
        }
        .font(.system(size: 10.5, weight: .medium, design: .monospaced))
        .foregroundStyle(OpenDesignDayColor.muted)
    }
}

private struct OpenDesignProjectsStatsView: View {
    let stats: [OpenDesignProjectStat]

    var body: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 168), spacing: 8)], spacing: 8) {
            ForEach(stats) { stat in
                OpenDesignProjectStatCard(stat: stat)
            }
        }
    }
}

private struct OpenDesignProjectStatCard: View {
    let stat: OpenDesignProjectStat

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(stat.label)
                .font(.system(size: 10, weight: .medium, design: .monospaced))
                .textCase(.uppercase)
                .foregroundStyle(OpenDesignDayColor.muted)
            HStack(alignment: .firstTextBaseline, spacing: 4) {
                Text(stat.value)
                    .font(.system(size: 22, weight: .semibold))
                    .foregroundStyle(OpenDesignDayColor.fg)
                Text(stat.suffix)
                    .font(.system(size: 11, weight: .regular, design: .monospaced))
                    .foregroundStyle(OpenDesignDayColor.muted)
            }
            Text(stat.delta)
                .font(.system(size: 10.5, weight: .medium, design: .monospaced))
                .foregroundStyle(stat.isFlat ? OpenDesignDayColor.muted : stat.tone.color)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .frame(maxWidth: .infinity, minHeight: 92, alignment: .leading)
        .background(referenceRounded(fill: OpenDesignDayColor.surface, stroke: OpenDesignDayColor.borderSoft, radius: 10))
    }
}

private struct OpenDesignProjectsGateList: View {
    private let rows: [(mark: String, title: String, day: String, subtitle: String, progress: CGFloat, status: String, tone: OpenDesignReferenceTone, isCurrent: Bool)] = [
        ("F", "초기 검증 기준", "D7", "인터뷰 5건 · 통증 가설 1 · 고객 후보 1줄 정의", 0.14, "진행 중", .accent, true),
        ("B", "만들기 기준", "D17", "핵심 기능 1개 · 30초 첫 가치 경험 · 결제/스토어 사전 점검", 0, "대기", .violet, false),
        ("L", "공개 기준", "D24", "60초 시연 · 첫 유료 또는 강한 의도 신호 1 · 공개 기록 14편", 0, "대기", .sky, false),
        ("G", "성장 기준", "D30", "유입/스토어 지표 · ASO/소재 1회 반복 · 계속/전환/중단 판정", 0, "대기", .amber, false),
    ]

    var body: some View {
        VStack(spacing: 0) {
            ForEach(rows.indices, id: \.self) { index in
                let row = rows[index]
                HStack(spacing: 12) {
                    Text(row.mark)
                        .font(.system(size: 11, weight: .semibold, design: .monospaced))
                        .foregroundStyle(row.tone.color)
                        .frame(width: 32, height: 32)
                        .background(referenceRounded(fill: row.tone.dim, stroke: row.tone.line, radius: 8))

                    VStack(alignment: .leading, spacing: 3) {
                        HStack(spacing: 8) {
                            Text(row.title)
                                .font(.system(size: 12.5, weight: .medium))
                                .foregroundStyle(OpenDesignDayColor.fg)
                            Text(row.day)
                                .font(.system(size: 9.5, weight: .medium, design: .monospaced))
                                .foregroundStyle(OpenDesignDayColor.muted)
                                .padding(.horizontal, 6)
                                .frame(height: 18)
                                .background(Capsule().fill(OpenDesignDayColor.bgDeep))
                                .overlay(Capsule().stroke(OpenDesignDayColor.borderSoft, lineWidth: 1))
                        }
                        Text(row.subtitle)
                            .font(.system(size: 10.5, weight: .medium, design: .monospaced))
                            .foregroundStyle(OpenDesignDayColor.muted)
                            .lineLimit(1)
                    }

                    Spacer(minLength: 8)

                    OpenDesignProjectsProgressBar(progress: row.progress, tone: row.tone)
                        .frame(width: 96)

                    smallPill(row.status, tone: row.isCurrent ? .accent : .muted)
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 12)
                .background(OpenDesignDayColor.surface)
                if index != rows.indices.last {
                    Rectangle().fill(OpenDesignDayColor.borderSoft).frame(height: 1)
                }
            }
        }
        .background(referenceRounded(fill: OpenDesignDayColor.surface, stroke: OpenDesignDayColor.borderSoft, radius: 12))
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
    }
}

private struct OpenDesignProjectsProgressBar: View {
    let progress: CGFloat
    let tone: OpenDesignReferenceTone

    var body: some View {
        GeometryReader { geometry in
            ZStack(alignment: .leading) {
                Capsule()
                    .fill(OpenDesignDayColor.bgDeep)
                Capsule()
                    .fill(tone.color)
                    .frame(width: max(0, geometry.size.width * progress))
            }
        }
        .frame(height: 4)
    }
}

private struct OpenDesignProjectsBasicsCard: View {
    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 12) {
                Image(systemName: "exclamationmark.circle")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(OpenDesignDayColor.accent)
                    .frame(width: 24, height: 24)
                    .background(referenceRounded(fill: OpenDesignDayColor.accentDim, stroke: OpenDesignDayColor.accentLine, radius: 7))

                VStack(alignment: .leading, spacing: 2) {
                    Text("Agentic30 (직접 사용 중)")
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(OpenDesignDayColor.fg)
                    Text("로컬 우선 macOS 메뉴바 AI 도우미 · SwiftUI + Node 실행 보조 앱")
                        .font(.system(size: 10.5, weight: .medium, design: .monospaced))
                        .foregroundStyle(OpenDesignDayColor.muted)
                        .lineLimit(1)
                }

                Spacer(minLength: 8)
                smallPill("설정 완료", tone: .accent)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 11)
            .background(OpenDesignDayColor.surface2)
            .overlay(Rectangle().fill(OpenDesignDayColor.borderSoft).frame(height: 1), alignment: .bottom)

            OpenDesignProjectKVList(rows: OpenDesignProjectsCatalog.basics)

            HStack(spacing: 8) {
                Text("한 문장과 고객 후보는 매주 다시 봅니다. Day 7 기준에서 의무 갱신.")
                    .font(.system(size: 10.5, weight: .medium, design: .monospaced))
                    .foregroundStyle(OpenDesignDayColor.muted)
                    .lineLimit(2)
                Spacer(minLength: 8)
                OpenDesignProjectMiniButton(title: "SPEC.md 열기", systemImage: nil, tone: .muted)
                OpenDesignProjectMiniButton(title: "ICP.md 열기", systemImage: nil, tone: .muted)
                OpenDesignProjectMiniButton(title: "편집", systemImage: nil, tone: .accent)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .background(OpenDesignDayColor.bgDeep)
            .overlay(Rectangle().fill(OpenDesignDayColor.borderSoft).frame(height: 1), alignment: .top)
        }
        .background(referenceRounded(fill: OpenDesignDayColor.surface, stroke: OpenDesignDayColor.borderSoft, radius: 12))
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
    }
}

private struct OpenDesignProjectKVList: View {
    let rows: [OpenDesignProjectKV]

    var body: some View {
        VStack(spacing: 0) {
            ForEach(rows) { row in
                HStack(alignment: .center, spacing: 14) {
                    Text(row.key)
                        .font(.system(size: 10.5, weight: .medium, design: .monospaced))
                        .textCase(.uppercase)
                        .foregroundStyle(OpenDesignDayColor.muted)
                        .frame(width: 132, alignment: .leading)
                    Text(row.value)
                        .font(.system(size: 12.5, weight: .regular))
                        .foregroundStyle(OpenDesignDayColor.fgSecondary)
                        .lineSpacing(2)
                        .fixedSize(horizontal: false, vertical: true)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    smallPill(row.status, tone: row.tone)
                }
                .padding(.vertical, 9)
                if row.id != rows.last?.id {
                    Rectangle().fill(OpenDesignDayColor.borderSoft).frame(height: 1).opacity(0.72)
                }
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 4)
    }
}

private struct OpenDesignProjectPathCard: View {
    let path: OpenDesignProjectPath

    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            Image(systemName: path.systemImage)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(path.tone.color)
                .frame(width: 28, height: 28)
                .background(referenceRounded(fill: path.tone.dim, stroke: path.tone.line, radius: 7))

            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 7) {
                    Text(path.name)
                        .font(.system(size: 12.5, weight: .medium))
                        .foregroundStyle(OpenDesignDayColor.fg)
                    Text(path.requirement)
                        .font(.system(size: 9.5, weight: .medium, design: .monospaced))
                        .foregroundStyle(path.requirement == "필수" ? OpenDesignDayColor.rose : OpenDesignDayColor.muted)
                        .padding(.horizontal, 6)
                        .frame(height: 18)
                        .background(Capsule().fill(path.requirement == "필수" ? OpenDesignDayColor.roseDim : OpenDesignDayColor.bgDeep))
                        .overlay(Capsule().stroke(path.requirement == "필수" ? OpenDesignDayColor.rose.opacity(0.36) : OpenDesignDayColor.borderSoft, lineWidth: 1))
                }
                HStack(spacing: 6) {
                    Text(path.path)
                        .font(.system(size: 11, weight: .medium, design: .monospaced))
                        .foregroundStyle(path.isSource ? OpenDesignDayColor.fg : OpenDesignDayColor.fgSecondary)
                        .lineLimit(1)
                        .truncationMode(.middle)
                    if let hint = path.hint {
                        Text("· \(hint)")
                            .font(.system(size: 11, weight: .medium, design: .monospaced))
                            .foregroundStyle(OpenDesignDayColor.mutedDeep)
                            .lineLimit(1)
                    }
                }
                FlowLayout(spacing: 10, lineSpacing: 4) {
                    ForEach(path.statusParts, id: \.self) { part in
                        Text(part)
                            .font(.system(size: 10.5, weight: .medium, design: .monospaced))
                            .foregroundStyle(part.contains("워치") ? OpenDesignDayColor.accent : part.contains("unstaged") ? OpenDesignDayColor.amber : OpenDesignDayColor.muted)
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            VStack(alignment: .trailing, spacing: 4) {
                OpenDesignProjectMiniButton(title: "변경", systemImage: nil, tone: .muted)
                OpenDesignProjectMiniButton(title: "Finder", systemImage: nil, tone: .muted)
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .background(referenceRounded(fill: OpenDesignDayColor.surface, stroke: path.isSource ? OpenDesignDayColor.accent.opacity(0.18) : OpenDesignDayColor.borderSoft, radius: 12))
        .padding(.bottom, 8)
    }
}

private struct OpenDesignProjectMiniButton: View {
    let title: String
    let systemImage: String?
    let tone: OpenDesignReferenceTone
    @State private var isHovered = false

    var body: some View {
        Button(action: {}) {
            HStack(spacing: 5) {
                if let systemImage {
                    Image(systemName: systemImage)
                        .font(.system(size: 10, weight: .semibold))
                }
                Text(title)
                    .lineLimit(1)
            }
            .font(.system(size: 11, weight: .medium))
            .foregroundStyle(tone == .accent ? OpenDesignDayColor.accent : tone == .amber ? OpenDesignDayColor.amber : tone == .rose ? OpenDesignDayColor.rose : isHovered ? OpenDesignDayColor.fg : OpenDesignDayColor.fgSecondary)
            .padding(.horizontal, 10)
            .frame(height: 24)
            .background(referenceRounded(fill: tone == .accent ? OpenDesignDayColor.accentDim : tone == .amber ? OpenDesignDayColor.amberDim : tone == .rose ? OpenDesignDayColor.roseDim : isHovered ? OpenDesignDayColor.hover : Color.clear, stroke: tone == .accent ? OpenDesignDayColor.accentLine : tone == .amber ? OpenDesignDayColor.amberLine : tone == .rose ? OpenDesignDayColor.rose.opacity(0.36) : OpenDesignDayColor.borderSoft, radius: 6))
        }
        .buttonStyle(.plain)
        .onHover { isHovered = $0 }
    }
}

private struct OpenDesignProjectPathFooter: View {
    var body: some View {
        HStack(spacing: 8) {
            Text("코드 루트는 여러 개를 붙일 수 있고 각 루트별로 git 상태와 변경 이벤트를 분리해서 기록합니다.")
                .font(.system(size: 10.5, weight: .medium, design: .monospaced))
                .foregroundStyle(OpenDesignDayColor.muted)
                .lineLimit(2)
            Spacer(minLength: 8)
            OpenDesignProjectMiniButton(title: "소스 경로 추가", systemImage: nil, tone: .accent)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .background(referenceRounded(fill: OpenDesignDayColor.bgDeep, stroke: OpenDesignDayColor.borderSoft, radius: 10))
        .padding(.bottom, 12)
    }
}

private struct OpenDesignProjectDocList: View {
    var body: some View {
        VStack(spacing: 8) {
            ForEach(OpenDesignProjectsCatalog.docs) { doc in
                OpenDesignProjectDocRow(doc: doc)
            }
        }
        .padding(.bottom, 12)
    }
}

private struct OpenDesignProjectDocRow: View {
    let doc: OpenDesignProjectDoc

    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            Text(doc.mark)
                .font(.system(size: 10.5, weight: .semibold, design: .monospaced))
                .foregroundStyle(doc.tone.color)
                .frame(width: 30, height: 30)
                .background(referenceRounded(fill: doc.tone.dim, stroke: doc.tone.line, radius: 8))

            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 7) {
                    Text(doc.name)
                        .font(.system(size: 12.5, weight: .medium))
                        .foregroundStyle(OpenDesignDayColor.fg)
                    Text(doc.location)
                        .font(.system(size: 11, weight: .medium, design: .monospaced))
                        .foregroundStyle(OpenDesignDayColor.accent)
                        .lineLimit(1)
                        .truncationMode(.middle)
                        .padding(.horizontal, 6)
                        .frame(height: 18)
                        .background(referenceRounded(fill: OpenDesignDayColor.bgDarker, stroke: OpenDesignDayColor.borderSoft, radius: 4))
                }
                Text(doc.subtitle)
                    .font(.system(size: 10.5, weight: .medium, design: .monospaced))
                    .foregroundStyle(OpenDesignDayColor.muted)
                    .lineLimit(1)
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            Text(doc.age)
                .font(.system(size: 10.5, weight: .medium, design: .monospaced))
                .foregroundStyle(OpenDesignDayColor.mutedDeep)
                .lineLimit(1)
            smallPill(doc.pin, tone: doc.isPinned ? .accent : .muted)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 11)
        .background(referenceRounded(fill: OpenDesignDayColor.surface, stroke: OpenDesignDayColor.borderSoft, radius: 10))
    }
}

private struct OpenDesignProjectTimeline: View {
    var body: some View {
        VStack(spacing: 0) {
            ForEach(OpenDesignProjectsCatalog.timeline.indices, id: \.self) { index in
                let event = OpenDesignProjectsCatalog.timeline[index]
                HStack(alignment: .top, spacing: 12) {
                    VStack(spacing: 0) {
                        Circle()
                            .fill(event.tone == .muted ? Color.clear : OpenDesignDayColor.bgDeep)
                            .overlay(Circle().stroke(event.tone.color, lineWidth: 2))
                            .frame(width: 12, height: 12)
                            .padding(.top, 4)
                        if index != OpenDesignProjectsCatalog.timeline.indices.last {
                            Rectangle()
                                .fill(OpenDesignDayColor.borderSoft)
                                .frame(width: 1)
                                .frame(maxHeight: .infinity)
                        }
                    }
                    .frame(width: 14)

                    VStack(alignment: .leading, spacing: 2) {
                        HStack(spacing: 4) {
                            Text(event.title)
                                .font(.system(size: 12.5, weight: event.emphasis == nil ? .regular : .medium))
                                .foregroundStyle(event.tone == .muted ? OpenDesignDayColor.muted : OpenDesignDayColor.fg)
                            if let emphasis = event.emphasis {
                                Text("— \(emphasis)")
                                    .font(.system(size: 12.5, weight: .medium))
                                    .foregroundStyle(OpenDesignDayColor.fg)
                                    .lineLimit(1)
                            }
                        }
                        if !event.subtitle.isEmpty {
                            Text(event.subtitle)
                                .font(.system(size: 10.5, weight: .medium, design: .monospaced))
                                .foregroundStyle(OpenDesignDayColor.muted)
                                .lineLimit(2)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)

                    Text(event.time)
                        .font(.system(size: 10.5, weight: .medium, design: .monospaced))
                        .foregroundStyle(OpenDesignDayColor.mutedDeep)
                        .lineLimit(1)
                        .padding(.top, 3)
                }
                .padding(.vertical, 8)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .background(referenceRounded(fill: OpenDesignDayColor.bgDarker, stroke: OpenDesignDayColor.borderSoft, radius: 12))
        .padding(.bottom, 12)
    }
}

private struct OpenDesignProjectWorkflowCard: View {
    var body: some View {
        VStack(spacing: 0) {
            OpenDesignProjectKVList(rows: OpenDesignProjectsCatalog.workflows)
                .padding(.vertical, 4)

            HStack(spacing: 8) {
                Text("활성 보조 작업은 단계 전환 시 자동 갱신.")
                    .font(.system(size: 10.5, weight: .medium, design: .monospaced))
                    .foregroundStyle(OpenDesignDayColor.muted)
                Spacer(minLength: 8)
                OpenDesignProjectMiniButton(title: "전체 설정", systemImage: nil, tone: .muted)
                OpenDesignProjectMiniButton(title: "테스트 호출", systemImage: nil, tone: .accent)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .background(OpenDesignDayColor.bgDeep)
            .overlay(Rectangle().fill(OpenDesignDayColor.borderSoft).frame(height: 1), alignment: .top)
        }
        .background(referenceRounded(fill: OpenDesignDayColor.surface, stroke: OpenDesignDayColor.borderSoft, radius: 12))
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .padding(.bottom, 12)
    }
}

private struct OpenDesignProjectDangerZone: View {
    private let rows: [(title: String, subtitle: String, action: String, tone: OpenDesignReferenceTone)] = [
        ("프로젝트 일시 중지", "메뉴바 watch 중지 · 과제 생성 중단 · 기록은 보존 · 언제든 재개 가능", "일시 중지", .amber),
        ("보관함으로 이동", "활성 프로젝트에서 제외 · 보관함에서 읽기 전용으로 조회 가능 · Day 진행 시계 멈춤", "보관함으로", .amber),
        ("프로젝트 삭제", "앱 내 메타데이터/세션/로그만 삭제 — 소스/인터뷰/일지 파일은 보존 · 삭제 후 복원 불가", "삭제", .rose),
    ]

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 8) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.system(size: 9, weight: .semibold))
                Text("되돌릴 수 없는 작업")
            }
            .font(.system(size: 10.5, weight: .medium, design: .monospaced))
            .textCase(.uppercase)
            .foregroundStyle(OpenDesignDayColor.rose)
            .padding(.bottom, 10)

            ForEach(rows.indices, id: \.self) { index in
                let row = rows[index]
                HStack(spacing: 12) {
                    VStack(alignment: .leading, spacing: 3) {
                        Text(row.title)
                            .font(.system(size: 12.5, weight: .medium))
                            .foregroundStyle(OpenDesignDayColor.fg)
                        Text(row.subtitle)
                            .font(.system(size: 10.5, weight: .medium, design: .monospaced))
                            .foregroundStyle(OpenDesignDayColor.muted)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    Spacer(minLength: 12)
                    OpenDesignProjectMiniButton(title: row.action, systemImage: nil, tone: row.tone)
                }
                .padding(.vertical, 9)

                if index != rows.indices.last {
                    Rectangle()
                        .fill(OpenDesignDayColor.rose.opacity(0.16))
                        .frame(height: 1)
                }
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
        .background(referenceRounded(fill: OpenDesignDayColor.roseDim.opacity(0.42), stroke: OpenDesignDayColor.rose.opacity(0.36), radius: 12))
    }
}

private struct OpenDesignProjectsMetaPanelView: View {
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                Text("프로젝트 포트폴리오")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(OpenDesignDayColor.fg)
                    .padding(.bottom, 10)

                OpenDesignProjectsHealthCard()
                    .padding(.bottom, 14)

                OpenDesignProjectsMetaSection(title: "활성 프로젝트", rows: OpenDesignProjectsCatalog.metaRows)
                OpenDesignProjectsMetaSection(title: "보관함 요약", rows: OpenDesignProjectsCatalog.archiveRows)

                Text("빠른 액션")
                    .font(.system(size: 10.5, weight: .medium, design: .monospaced))
                    .textCase(.uppercase)
                    .foregroundStyle(OpenDesignDayColor.mutedDeep)
                    .padding(.top, 14)
                    .padding(.horizontal, 4)
                    .padding(.bottom, 8)

                OpenDesignProjectsQuickAction(systemImage: "chevron.right", title: "오늘 화면으로", subtitle: "Day 1 · 고객 후보 좁히기", shortcut: "↵", tone: .accent)
                OpenDesignProjectsQuickAction(systemImage: "plus", title: "새 30일 프로젝트", subtitle: "템플릿 또는 백지에서 시작", shortcut: "⌘N", tone: .sky)
                OpenDesignProjectsQuickAction(systemImage: "sidebar.left", title: "프로젝트 전환", subtitle: "활성/보관함 가로질러 검색", shortcut: "⌘P", tone: .muted)
                OpenDesignProjectsQuickAction(systemImage: "bubble.left.and.bubble.right", title: "인터뷰 추가", subtitle: ".vtt / .txt drop · 다음 게이트까지 4건", shortcut: "⌘I", tone: .amber)
                OpenDesignProjectsQuickAction(systemImage: "gearshape", title: "설정 열기", subtitle: "워크스페이스 · AI 연결 · 권한", shortcut: "⌘E", tone: .muted)
            }
            .padding(16)
        }
        .background(OpenDesignDayColor.bg)
        .overlay(Rectangle().fill(OpenDesignDayColor.borderSoft).frame(width: 1), alignment: .leading)
    }
}

private struct OpenDesignProjectsHealthCard: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                Circle()
                    .fill(OpenDesignDayColor.accent)
                    .frame(width: 6, height: 6)
                    .shadow(color: OpenDesignDayColor.accent.opacity(0.5), radius: 4)
                Text("30일 진행률 · 모든 활성")
            }
            .font(.system(size: 10.5, weight: .medium, design: .monospaced))
            .textCase(.uppercase)
            .foregroundStyle(OpenDesignDayColor.muted)

            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text("14")
                    .font(.system(size: 18, weight: .semibold, design: .monospaced))
                    .foregroundStyle(OpenDesignDayColor.fg)
                Text("/")
                    .font(.system(size: 13, weight: .medium, design: .monospaced))
                    .foregroundStyle(OpenDesignDayColor.mutedDeep)
                Text("90 day")
                    .font(.system(size: 13, weight: .medium, design: .monospaced))
                    .foregroundStyle(OpenDesignDayColor.muted)
                Spacer()
                Text("3 projects")
                    .font(.system(size: 10.5, weight: .medium, design: .monospaced))
                    .foregroundStyle(OpenDesignDayColor.accent)
            }

            HStack(spacing: 0) {
                Rectangle().fill(OpenDesignDayColor.accent).frame(width: 46)
                Rectangle().fill(OpenDesignReferenceTone.violet.color).frame(width: 28)
                Rectangle().fill(OpenDesignDayColor.sky.opacity(0.16)).frame(width: 52)
                Rectangle().fill(OpenDesignDayColor.amber.opacity(0.16)).frame(maxWidth: .infinity)
            }
            .frame(height: 3)
            .clipShape(Capsule())
            .background(Capsule().fill(OpenDesignDayColor.bgDeep))

            HStack {
                OpenDesignProjectsMetaToken("● F · 2", tone: .accent)
                Spacer()
                OpenDesignProjectsMetaToken("● B · 1", tone: .violet)
                Spacer()
                OpenDesignProjectsMetaToken("● L+G · 0", tone: .muted)
            }
            .font(.system(size: 10.5, weight: .medium, design: .monospaced))
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .background(referenceRounded(fill: OpenDesignDayColor.surface, stroke: OpenDesignDayColor.borderSoft, radius: 10))
    }
}

private struct OpenDesignProjectsMetaSection: View {
    let title: String
    let rows: [OpenDesignProjectMetaRow]

    var body: some View {
        Text(title)
            .font(.system(size: 10.5, weight: .medium, design: .monospaced))
            .textCase(.uppercase)
            .foregroundStyle(OpenDesignDayColor.mutedDeep)
            .padding(.top, 14)
            .padding(.horizontal, 4)
            .padding(.bottom, 8)

        VStack(spacing: 1) {
            ForEach(rows) { row in
                OpenDesignProjectsMetaRowView(row: row)
            }
        }
        .padding(.bottom, 8)
    }
}

private struct OpenDesignProjectsMetaRowView: View {
    let row: OpenDesignProjectMetaRow
    @State private var isHovered = false

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: row.systemImage)
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(isHovered ? OpenDesignDayColor.fgSecondary : OpenDesignDayColor.muted)
                .frame(width: 22)
            Text(row.key)
                .font(.system(size: 12, weight: .regular))
                .foregroundStyle(isHovered ? OpenDesignDayColor.fg : OpenDesignDayColor.fgSecondary)
                .lineLimit(1)
            Spacer(minLength: 6)
            HStack(spacing: 6) {
                if row.id == "active" {
                    Circle()
                        .fill(row.tone.color)
                        .frame(width: 9, height: 9)
                }
                Text(row.value)
                    .font(.system(size: 11, weight: .medium, design: .monospaced))
                    .foregroundStyle(OpenDesignDayColor.muted)
                    .lineLimit(1)
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .background(referenceRounded(fill: isHovered ? OpenDesignDayColor.hover : Color.clear, stroke: Color.clear, radius: 6))
        .contentShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
        .onHover { isHovered = $0 }
    }
}

private struct OpenDesignProjectsQuickAction: View {
    let systemImage: String
    let title: String
    let subtitle: String
    let shortcut: String
    let tone: OpenDesignReferenceTone
    @State private var isHovered = false

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: systemImage)
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(tone == .muted ? OpenDesignDayColor.muted : tone.color)
                .frame(width: 22)
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(OpenDesignDayColor.fg)
                Text(subtitle)
                    .font(.system(size: 11, weight: .medium, design: .monospaced))
                    .foregroundStyle(OpenDesignDayColor.muted)
                    .lineLimit(1)
            }
            Spacer(minLength: 8)
            Text(shortcut)
                .font(.system(size: 10, weight: .medium, design: .monospaced))
                .foregroundStyle(OpenDesignDayColor.mutedDeep)
                .padding(.horizontal, 5)
                .frame(height: 18)
                .background(referenceRounded(fill: Color.clear, stroke: OpenDesignDayColor.borderSoft, radius: 4))
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 9)
        .background(referenceRounded(fill: isHovered ? OpenDesignDayColor.hover : Color.clear, stroke: Color.clear, radius: 6))
        .contentShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
        .onHover { isHovered = $0 }
    }
}

private struct OpenDesignReferenceToolbarButton: View {
    let systemImage: String
    let label: String
    var isOn = false
    var accessibilityIdentifier: String? = nil
    let action: () -> Void
    @State private var isHovered = false

    var body: some View {
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
        .buttonStyle(.plain)
        .help(label)
        .onHover { isHovered = $0 }
        .accessibilityLabel(label)
        .accessibilityValue(isOn ? "active" : "inactive")
        .accessibilityIdentifier(accessibilityIdentifier ?? label)
    }
}

private struct OpenDesignReferenceSidebarView: View {
    let page: OpenDesignReferencePageModel
    let openSearch: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 6) {
                Text(page.sideTitle)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(OpenDesignDayColor.fg)
                if let sideBadge = page.sideBadge {
                    Text(sideBadge)
                        .font(.system(size: 10, weight: .medium, design: .monospaced))
                        .foregroundStyle(OpenDesignDayColor.muted)
                        .padding(.horizontal, 6)
                        .frame(height: 18)
                        .background(Capsule().fill(OpenDesignDayColor.surface))
                }
                Spacer(minLength: 0)
            }
            .padding(.top, 10)
            .padding(.horizontal, 12)
            .padding(.bottom, 8)

            if let placeholder = page.sideSearchPlaceholder {
                Button(action: openSearch) {
                    HStack(spacing: 8) {
                        Image(systemName: "magnifyingglass")
                            .font(.system(size: 10, weight: .medium))
                        Text(placeholder)
                        Spacer()
                        Text(page.kind == .projects ? "⌘ P" : "⌘ K")
                            .font(.system(size: 10, weight: .medium, design: .monospaced))
                            .foregroundStyle(OpenDesignDayColor.mutedDeep)
                    }
                    .font(.system(size: 11.5, weight: .medium))
                    .foregroundStyle(OpenDesignDayColor.fgSecondary)
                    .padding(.horizontal, 10)
                    .frame(height: 30)
                    .background(referenceRounded(fill: OpenDesignDayColor.surface, stroke: OpenDesignDayColor.borderSoft, radius: 6))
                }
                .buttonStyle(.plain)
                .padding(.horizontal, 8)
                .padding(.bottom, 6)
            }

            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0) {
                    ForEach(page.sideGroups.indices, id: \.self) { groupIndex in
                        let group = page.sideGroups[groupIndex]
                        HStack {
                            Text(group.title)
                            Spacer()
                            if let count = group.count {
                                Text(count)
                            }
                        }
                        .font(.system(size: 10, weight: .medium, design: .monospaced))
                        .textCase(.uppercase)
                        .foregroundStyle(OpenDesignDayColor.mutedDeep)
                        .padding(.top, groupIndex == 0 ? 8 : 14)
                        .padding(.horizontal, 8)
                        .padding(.bottom, 6)

                        ForEach(group.rows) { row in
                            OpenDesignReferenceSideRowView(row: row)
                        }
                    }
                }
                .padding(.horizontal, 6)
                .padding(.bottom, 14)
            }
        }
        .background(OpenDesignDayColor.bg)
        .overlay(Rectangle().fill(OpenDesignDayColor.borderSoft).frame(width: 1), alignment: .trailing)
    }
}

private struct OpenDesignReferenceSideRowView: View {
    let row: OpenDesignReferenceSideRow
    @State private var isHovered = false

    var body: some View {
        HStack(spacing: 10) {
            Text(row.leading)
                .font(.system(size: row.leading.count > 2 ? 9 : 10.5, weight: .semibold, design: .monospaced))
                .foregroundStyle(row.isActive ? OpenDesignDayColor.bgDeep : row.tone.color)
                .frame(width: 25, height: 25)
                .background(
                    RoundedRectangle(cornerRadius: 7, style: .continuous)
                        .fill(row.isActive ? row.tone.color : row.tone.dim)
                        .overlay(RoundedRectangle(cornerRadius: 7, style: .continuous).stroke(row.tone.line, lineWidth: 1))
                )
            VStack(alignment: .leading, spacing: 2) {
                Text(row.title)
                    .font(.system(size: 12.2, weight: .medium))
                    .foregroundStyle(row.isActive || isHovered ? OpenDesignDayColor.fg : OpenDesignDayColor.fgSecondary)
                    .lineLimit(1)
                if let subtitle = row.subtitle {
                    Text(subtitle)
                        .font(.system(size: 10.3, weight: .medium, design: .monospaced))
                        .foregroundStyle(OpenDesignDayColor.muted)
                        .lineLimit(1)
                }
            }
            Spacer(minLength: 6)
            if let badge = row.badge {
                Text(badge)
                    .font(.system(size: 10, weight: .medium, design: .monospaced))
                    .foregroundStyle(row.isActive ? row.tone.color : OpenDesignDayColor.muted)
                    .lineLimit(1)
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 7.5)
        .background(referenceRounded(fill: row.isActive ? OpenDesignDayColor.selected : isHovered ? OpenDesignDayColor.hover : Color.clear, stroke: Color.clear, radius: 7))
        .contentShape(RoundedRectangle(cornerRadius: 7, style: .continuous))
        .onHover { isHovered = $0 }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(row.title)
        .accessibilityValue(row.isActive ? "active" : "inactive")
    }
}

private struct OpenDesignReferenceMainView: View {
    let page: OpenDesignReferencePageModel
    let layout: OpenDesignDayLayoutMetrics

    var body: some View {
        VStack(spacing: 0) {
            OpenDesignReferenceHeaderView(header: page.header, horizontalPadding: layout.mainHorizontalPadding)

            if !page.filters.isEmpty {
                OpenDesignReferenceFilterBar(chips: page.filters, horizontalPadding: layout.mainHorizontalPadding)
            }

            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(page.sections) { section in
                        OpenDesignReferenceSectionView(section: section, layout: layout)
                    }
                }
                .frame(maxWidth: 820, alignment: .leading)
                .padding(.horizontal, layout.mainHorizontalPadding)
                .padding(.top, 22)
                .padding(.bottom, 34)
                .frame(maxWidth: .infinity)
            }
            .background(OpenDesignDayColor.bg)
        }
        .background(OpenDesignDayColor.bg)
    }
}

private struct OpenDesignReferenceHeaderView: View {
    let header: OpenDesignReferenceHeaderModel
    let horizontalPadding: CGFloat

    var body: some View {
        HStack(spacing: 12) {
            HStack(spacing: 14) {
                ZStack {
                    if let systemImage = header.systemImage {
                        Image(systemName: systemImage)
                            .font(.system(size: 18, weight: .semibold))
                    } else {
                        Text(header.badge)
                            .font(.system(size: header.badge.count > 2 ? 11 : 17, weight: .bold, design: .monospaced))
                    }
                }
                .foregroundStyle(OpenDesignDayColor.accent)
                .frame(width: 44, height: 44)
                .background(referenceRounded(fill: OpenDesignDayColor.accentDim, stroke: OpenDesignDayColor.accentLine, radius: 11))

                VStack(alignment: .leading, spacing: 3) {
                    Text(header.title)
                        .font(.system(size: 17, weight: .semibold))
                        .foregroundStyle(OpenDesignDayColor.fg)
                        .lineLimit(1)
                    HStack(spacing: 8) {
                        Circle()
                            .fill(OpenDesignDayColor.accent)
                            .frame(width: 5, height: 5)
                        ForEach(Array(header.subtitleParts.enumerated()), id: \.offset) { index, part in
                            if index > 0 {
                                Text("·")
                                    .foregroundStyle(OpenDesignDayColor.mutedDeep)
                            }
                            Text(part)
                                .lineLimit(1)
                        }
                    }
                    .font(.system(size: 11, weight: .medium, design: .monospaced))
                    .foregroundStyle(OpenDesignDayColor.muted)
                }
                .frame(minWidth: 0, alignment: .leading)
            }

            Spacer(minLength: 12)

            ForEach(header.actions) { action in
                OpenDesignReferenceActionButton(action: action)
            }
        }
        .padding(.horizontal, horizontalPadding)
        .frame(height: 70)
        .background(OpenDesignDayColor.bg)
        .overlay(Rectangle().fill(OpenDesignDayColor.borderSoft).frame(height: 1), alignment: .bottom)
    }
}

private struct OpenDesignReferenceActionButton: View {
    let action: OpenDesignReferenceAction
    @State private var isHovered = false

    var body: some View {
        Button(action: {}) {
            HStack(spacing: 6) {
                if let image = action.systemImage {
                    Image(systemName: image)
                        .font(.system(size: 11, weight: .semibold))
                }
                Text(action.title)
            }
            .font(.system(size: 11.5, weight: action.tone == .accent ? .semibold : .medium))
            .foregroundStyle(action.tone == .accent ? OpenDesignDayColor.bgDeep : (isHovered ? OpenDesignDayColor.fg : OpenDesignDayColor.fgSecondary))
            .padding(.horizontal, action.tone == .accent ? 14 : 12)
            .frame(height: 28)
            .background(
                referenceRounded(
                    fill: action.tone == .accent ? (isHovered ? OpenDesignDayColor.accentStrong : OpenDesignDayColor.accent) : (isHovered ? OpenDesignDayColor.hover : Color.clear),
                    stroke: action.tone == .accent ? Color.clear : OpenDesignDayColor.borderSoft,
                    radius: 8
                )
            )
        }
        .buttonStyle(.plain)
        .onHover { isHovered = $0 }
        .accessibilityLabel(action.title)
    }
}

private struct OpenDesignReferenceFilterBar: View {
    let chips: [OpenDesignReferenceChip]
    let horizontalPadding: CGFloat

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(chips) { chip in
                    OpenDesignReferenceChipView(chip: chip, isActive: chip.id == chips.first?.id)
                }
            }
            .padding(.horizontal, horizontalPadding)
            .frame(height: 48)
        }
        .background(OpenDesignDayColor.bg)
        .overlay(Rectangle().fill(OpenDesignDayColor.borderSoft).frame(height: 1), alignment: .bottom)
    }
}

private struct OpenDesignReferenceSectionView: View {
    let section: OpenDesignReferenceSectionModel
    let layout: OpenDesignDayLayoutMetrics

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 10) {
                RoundedRectangle(cornerRadius: 2, style: .continuous)
                    .fill(section.markerTone.color)
                    .frame(width: 4, height: 12)
                Text(section.title)
                    .font(.system(size: 11, weight: .medium, design: .monospaced))
                    .textCase(.uppercase)
                    .foregroundStyle(OpenDesignDayColor.muted)
                if let meta = section.meta {
                    Text(meta)
                        .font(.system(size: 10.5, weight: .medium, design: .monospaced))
                        .foregroundStyle(OpenDesignDayColor.mutedDeep)
                        .lineLimit(1)
                }
                Rectangle()
                    .fill(OpenDesignDayColor.borderSoft)
                    .frame(height: 1)
            }
            .padding(.top, 20)

            ForEach(section.blocks) { block in
                OpenDesignReferenceBlockView(block: block, layout: layout)
            }
        }
    }
}

private struct OpenDesignReferenceBlockView: View {
    let block: OpenDesignReferenceBlock
    let layout: OpenDesignDayLayoutMetrics

    var body: some View {
        switch block.style {
        case .banner:
            banner
        case .calendar:
            calendar
        case .metrics:
            metrics
        case .rows:
            rowList
        case .cards:
            cardGrid
        case .timeline:
            timeline
        case .articles:
            articles
        case .quotes:
            quotes
        case .diff:
            diff
        case .settings:
            settings
        case .draft:
            draft
        case .heatmap:
            heatmap
        }
    }

    private var gridColumns: [GridItem] {
        let count = layout.openDesignGridColumnCount == 4 ? 2 : 1
        return Array(repeating: GridItem(.flexible(), spacing: 10), count: count)
    }

    private var banner: some View {
        VStack(alignment: .leading, spacing: 10) {
            if let subtitle = block.subtitle {
                Text(subtitle)
                    .font(.system(size: 10.5, weight: .medium, design: .monospaced))
                    .foregroundStyle(OpenDesignDayColor.accent)
                    .textCase(.uppercase)
            }
            if let title = block.title {
                Text(title)
                    .font(.system(size: 20, weight: .semibold))
                    .foregroundStyle(OpenDesignDayColor.fg)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if let body = block.body {
                Text(body)
                    .font(.system(size: 13.2, weight: .regular))
                    .foregroundStyle(OpenDesignDayColor.fgSecondary)
                    .lineSpacing(3)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if !block.chips.isEmpty {
                FlowLayout(spacing: 8, lineSpacing: 8) {
                    ForEach(block.chips) { chip in
                        OpenDesignReferenceChipView(chip: chip, isActive: true)
                    }
                }
                .padding(.top, 2)
            }
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(referenceAccentEdgeCard(stroke: OpenDesignDayColor.border, accent: OpenDesignDayColor.accent))
    }

    private var calendar: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text(block.title ?? "30일 캘린더")
                    .font(.system(size: 10.5, weight: .medium, design: .monospaced))
                    .textCase(.uppercase)
                    .foregroundStyle(OpenDesignDayColor.muted)
                Spacer()
                Text("초기 검증 · 만들기 · 공개 · 성장")
                    .font(.system(size: 10.5, weight: .medium, design: .monospaced))
                    .foregroundStyle(OpenDesignDayColor.mutedDeep)
            }

            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 5), count: 10), spacing: 5) {
                ForEach(1...30, id: \.self) { day in
                    Text("\(day)")
                        .font(.system(size: 10, weight: .semibold, design: .monospaced))
                        .foregroundStyle(day == 1 ? OpenDesignDayColor.bgDeep : day <= 7 ? OpenDesignDayColor.accent : OpenDesignDayColor.muted)
                        .frame(height: 26)
                        .frame(maxWidth: .infinity)
                        .background(
                            RoundedRectangle(cornerRadius: 6, style: .continuous)
                                .fill(day == 1 ? OpenDesignDayColor.accent : OpenDesignDayColor.bgDarker)
                                .overlay(
                                    RoundedRectangle(cornerRadius: 6, style: .continuous)
                                        .stroke(day == 3 || day == 7 || day == 17 || day == 24 || day == 30 ? OpenDesignDayColor.amberLine : OpenDesignDayColor.borderSoft, lineWidth: 1)
                                )
                        )
                }
            }
        }
        .padding(14)
        .background(referenceCard())
    }

    private var metrics: some View {
        LazyVGrid(columns: gridColumns, spacing: 10) {
            ForEach(block.rows) { row in
                VStack(alignment: .leading, spacing: 7) {
                    Text(row.subtitle ?? row.title)
                        .font(.system(size: 10.5, weight: .medium, design: .monospaced))
                        .textCase(.uppercase)
                        .foregroundStyle(OpenDesignDayColor.muted)
                    Text(row.title)
                        .font(.system(size: 28, weight: .semibold))
                        .foregroundStyle(OpenDesignDayColor.fg)
                    if let trailing = row.trailing {
                        Text(trailing)
                            .font(.system(size: 11, weight: .medium, design: .monospaced))
                            .foregroundStyle(row.tone.color)
                    }
                }
                .padding(14)
                .frame(maxWidth: .infinity, minHeight: 104, alignment: .leading)
                .background(referenceCard())
            }
        }
    }

    private var rowList: some View {
        VStack(alignment: .leading, spacing: 0) {
            if let title = block.title {
                blockHeader(title: title, subtitle: block.subtitle)
            }
            ForEach(block.rows) { row in
                OpenDesignReferenceGenericRow(row: row, compact: false)
                if row.id != block.rows.last?.id {
                    Rectangle().fill(OpenDesignDayColor.borderSoft).frame(height: 1)
                }
            }
        }
        .background(referenceCard())
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    private var cardGrid: some View {
        LazyVGrid(columns: gridColumns, alignment: .leading, spacing: 10) {
            ForEach(block.rows) { row in
                VStack(alignment: .leading, spacing: 8) {
                    HStack(spacing: 8) {
                        if let leading = row.leading {
                            Text(leading)
                                .font(.system(size: 10.5, weight: .bold, design: .monospaced))
                                .foregroundStyle(row.tone.color)
                                .frame(width: 30, height: 30)
                                .background(referenceRounded(fill: row.tone.dim, stroke: row.tone.line, radius: 8))
                        }
                        VStack(alignment: .leading, spacing: 2) {
                            Text(row.title)
                                .font(.system(size: 13.2, weight: .semibold))
                                .foregroundStyle(OpenDesignDayColor.fg)
                                .fixedSize(horizontal: false, vertical: true)
                            if let subtitle = row.subtitle {
                                Text(subtitle)
                                    .font(.system(size: 10.5, weight: .medium, design: .monospaced))
                                    .foregroundStyle(OpenDesignDayColor.muted)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                        }
                        Spacer(minLength: 0)
                        if let trailing = row.trailing {
                            smallPill(trailing, tone: row.tone)
                        }
                    }
                    if let body = row.body {
                        Text(body)
                            .font(.system(size: 12, weight: .regular))
                            .foregroundStyle(OpenDesignDayColor.fgSecondary)
                            .lineSpacing(2.5)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                .padding(14)
                .frame(maxWidth: .infinity, alignment: .topLeading)
                .background(referenceCard())
            }
        }
    }

    private var timeline: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(block.rows) { row in
                HStack(alignment: .top, spacing: 12) {
                    VStack(spacing: 0) {
                        Circle()
                            .fill(row.tone.color)
                            .frame(width: 10, height: 10)
                            .padding(.top, 15)
                        Rectangle()
                            .fill(OpenDesignDayColor.borderSoft)
                            .frame(width: 1)
                            .frame(maxHeight: .infinity)
                    }
                    .frame(width: 18)

                    VStack(alignment: .leading, spacing: 7) {
                        HStack {
                            Text(row.subtitle ?? "")
                                .font(.system(size: 10, weight: .medium, design: .monospaced))
                                .textCase(.uppercase)
                                .foregroundStyle(row.tone.color)
                            Spacer()
                            if let leading = row.leading {
                                Text(leading)
                                    .font(.system(size: 10.5, weight: .medium, design: .monospaced))
                                    .foregroundStyle(OpenDesignDayColor.muted)
                            }
                        }
                        Text(row.title)
                            .font(.system(size: 13.2, weight: .semibold))
                            .foregroundStyle(OpenDesignDayColor.fg)
                            .fixedSize(horizontal: false, vertical: true)
                        if let body = row.body {
                            Text(body)
                                .font(.system(size: 12, weight: .regular))
                                .foregroundStyle(OpenDesignDayColor.fgSecondary)
                                .lineSpacing(2.5)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                    .padding(13)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(referenceCard())
                    .padding(.bottom, 8)
                }
            }
        }
    }

    private var articles: some View {
        VStack(spacing: 10) {
            ForEach(block.rows) { row in
                VStack(alignment: .leading, spacing: 10) {
                    HStack(alignment: .top, spacing: 12) {
                        Text(row.leading ?? "")
                            .font(.system(size: 11, weight: .bold, design: .monospaced))
                            .foregroundStyle(row.tone.color)
                            .frame(width: 34, height: 34)
                            .background(referenceRounded(fill: row.tone.dim, stroke: row.tone.line, radius: 9))
                        VStack(alignment: .leading, spacing: 3) {
                            Text(row.subtitle ?? "")
                                .font(.system(size: 10.5, weight: .medium, design: .monospaced))
                                .foregroundStyle(OpenDesignDayColor.muted)
                            Text(row.title)
                                .font(.system(size: 14.5, weight: .semibold))
                                .foregroundStyle(OpenDesignDayColor.fg)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        Spacer(minLength: 0)
                        if let trailing = row.trailing {
                            smallPill(trailing, tone: row.tone)
                        }
                    }
                    if let body = row.body {
                        Text(body)
                            .font(.system(size: 12.4, weight: .regular))
                            .foregroundStyle(OpenDesignDayColor.fgSecondary)
                            .lineSpacing(3)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    if !row.chips.isEmpty {
                        FlowLayout(spacing: 6, lineSpacing: 6) {
                            ForEach(row.chips) { chip in
                                OpenDesignReferenceChipView(chip: chip, isActive: false)
                            }
                        }
                    }
                }
                .padding(14)
                .background(referenceCard())
            }
        }
    }

    private var quotes: some View {
        VStack(spacing: 8) {
            ForEach(block.rows) { row in
                HStack(alignment: .top, spacing: 12) {
                    VStack(spacing: 2) {
                        Text(row.leading ?? "")
                            .font(.system(size: 11, weight: .semibold, design: .monospaced))
                            .foregroundStyle(row.tone.color)
                        Text(row.subtitle ?? "")
                            .font(.system(size: 9.5, weight: .medium, design: .monospaced))
                            .foregroundStyle(OpenDesignDayColor.mutedDeep)
                    }
                    .frame(width: 54, alignment: .leading)
                    Text(row.title)
                        .font(.system(size: 13, weight: .regular))
                        .foregroundStyle(OpenDesignDayColor.fgSecondary)
                        .lineSpacing(3)
                        .fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: 8)
                    if let trailing = row.trailing {
                        smallPill(trailing, tone: row.tone)
                    }
                }
                .padding(13)
                .background(referenceCard())
            }
        }
    }

    private var diff: some View {
        VStack(alignment: .leading, spacing: 0) {
            blockHeader(title: block.title ?? "Diff", subtitle: block.subtitle)
            ForEach(block.rows) { row in
                HStack(alignment: .top, spacing: 10) {
                    Text(row.leading ?? "")
                        .font(.system(size: 10.5, weight: .medium, design: .monospaced))
                        .foregroundStyle(OpenDesignDayColor.mutedDeep)
                        .frame(width: 28, alignment: .trailing)
                    Text(row.tone == .rose ? "−" : row.tone == .accent ? "+" : " ")
                        .font(.system(size: 11.5, weight: .bold, design: .monospaced))
                        .foregroundStyle(row.tone.color)
                        .frame(width: 12)
                    Text(row.title)
                        .font(.system(size: 11.5, weight: .medium, design: .monospaced))
                        .foregroundStyle(row.tone == .muted ? OpenDesignDayColor.fgSecondary : row.tone.color)
                        .fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: 0)
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 7)
                .background(row.tone == .rose ? OpenDesignDayColor.roseDim : row.tone == .accent ? OpenDesignDayColor.accentDim : Color.clear)
            }
        }
        .background(referenceRounded(fill: OpenDesignDayColor.bgDarker, stroke: OpenDesignDayColor.borderSoft, radius: 12))
    }

    private var settings: some View {
        VStack(spacing: 0) {
            ForEach(block.rows) { row in
                HStack(alignment: .center, spacing: 18) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(row.title)
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(OpenDesignDayColor.fg)
                        if let subtitle = row.subtitle {
                            Text(subtitle)
                                .font(.system(size: 12, weight: .regular))
                                .foregroundStyle(OpenDesignDayColor.muted)
                                .lineSpacing(2.5)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                    Spacer(minLength: 12)
                    if let trailing = row.trailing {
                        smallPill(trailing, tone: row.tone)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 13)
                if row.id != block.rows.last?.id {
                    Rectangle().fill(OpenDesignDayColor.borderSoft).frame(height: 1)
                }
            }
        }
        .background(referenceCard())
    }

    private var draft: some View {
        VStack(alignment: .leading, spacing: 10) {
            if let title = block.title {
                Text(title)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(OpenDesignDayColor.fg)
            }
            Text(block.body ?? "")
                .font(.system(size: 12, weight: .medium, design: .monospaced))
                .foregroundStyle(OpenDesignDayColor.fgSecondary)
                .lineSpacing(4)
                .fixedSize(horizontal: false, vertical: true)
                .padding(14)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(referenceRounded(fill: OpenDesignDayColor.bgDarker, stroke: OpenDesignDayColor.borderSoft, radius: 10))
        }
        .padding(16)
        .background(referenceGradientCard(stroke: OpenDesignDayColor.amberLine))
    }

    private var heatmap: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text(block.title ?? "활동")
                    .font(.system(size: 10.5, weight: .medium, design: .monospaced))
                    .textCase(.uppercase)
                    .foregroundStyle(OpenDesignDayColor.muted)
                Spacer()
                Text(block.subtitle ?? "")
                    .font(.system(size: 10.5, weight: .semibold, design: .monospaced))
                    .foregroundStyle(OpenDesignDayColor.accent)
            }
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 4), count: 5), spacing: 4) {
                ForEach(0..<30, id: \.self) { index in
                    let level = heatmapLevel(at: index)
                    RoundedRectangle(cornerRadius: 3, style: .continuous)
                        .fill(level == 0 ? OpenDesignDayColor.bgDarker : OpenDesignDayColor.accent.opacity(0.18 + Double(level) * 0.16))
                        .frame(height: 14)
                        .overlay(
                            RoundedRectangle(cornerRadius: 3, style: .continuous)
                                .stroke(index == 14 ? OpenDesignDayColor.accent : OpenDesignDayColor.borderSoft, lineWidth: 1)
                        )
                }
            }
        }
        .padding(14)
        .background(referenceCard())
    }

    private func heatmapLevel(at index: Int) -> Int {
        let levels = [2, 0, 1, 0, 0, 1, 0, 0, 0, 2, 1, 1, 0, 3, 4]
        guard levels.indices.contains(index) else { return 0 }
        return levels[index]
    }

    private func blockHeader(title: String, subtitle: String?) -> some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(OpenDesignDayColor.fg)
                if let subtitle {
                    Text(subtitle)
                        .font(.system(size: 10.5, weight: .medium, design: .monospaced))
                        .foregroundStyle(OpenDesignDayColor.muted)
                }
            }
            Spacer()
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .background(OpenDesignDayColor.surface2)
        .overlay(Rectangle().fill(OpenDesignDayColor.borderSoft).frame(height: 1), alignment: .bottom)
    }
}

private struct OpenDesignReferenceGenericRow: View {
    let row: OpenDesignReferenceRow
    let compact: Bool

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            if let leading = row.leading {
                Text(leading)
                    .font(.system(size: leading.count > 2 ? 9.5 : 11, weight: .bold, design: .monospaced))
                    .foregroundStyle(row.tone.color)
                    .frame(width: 30, height: 30)
                    .background(referenceRounded(fill: row.tone.dim, stroke: row.tone.line, radius: 8))
            }
            VStack(alignment: .leading, spacing: 3) {
                Text(row.title)
                    .font(.system(size: compact ? 12 : 13, weight: .semibold))
                    .foregroundStyle(OpenDesignDayColor.fgSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                if let subtitle = row.subtitle {
                    Text(subtitle)
                        .font(.system(size: compact ? 10.5 : 11.5, weight: .regular))
                        .foregroundStyle(OpenDesignDayColor.muted)
                        .lineSpacing(2)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            Spacer(minLength: 8)
            if let trailing = row.trailing {
                smallPill(trailing, tone: row.tone)
            }
        }
        .padding(.horizontal, compact ? 10 : 14)
        .padding(.vertical, compact ? 9 : 12)
    }
}

private struct OpenDesignReferenceMetaPanelView: View {
    let page: OpenDesignReferencePageModel

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                Text(page.meta.title)
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(OpenDesignDayColor.fg)

                ForEach(page.meta.cards) { block in
                    OpenDesignReferenceBlockView(block: block, layout: OpenDesignDayLayoutMetrics(width: 900))
                }
            }
            .padding(16)
        }
        .background(OpenDesignDayColor.bg)
        .overlay(Rectangle().fill(OpenDesignDayColor.borderSoft).frame(width: 1), alignment: .leading)
    }
}

private struct OpenDesignReferenceChipView: View {
    let chip: OpenDesignReferenceChip
    let isActive: Bool

    var body: some View {
        Text(chip.title)
            .font(.system(size: 10.5, weight: .medium, design: .monospaced))
            .foregroundStyle(isActive ? chip.tone.color : OpenDesignDayColor.fgSecondary)
            .padding(.horizontal, 9)
            .frame(height: 24)
            .background(
                Capsule()
                    .fill(isActive ? chip.tone.dim : OpenDesignDayColor.bgDarker)
                    .overlay(Capsule().stroke(isActive ? chip.tone.line : OpenDesignDayColor.borderSoft, lineWidth: 1))
            )
    }
}

private func settingsInlineText(_ text: String) -> String {
    text
}

private func settingsStatusPill(_ text: String, tone: OpenDesignReferenceTone) -> some View {
    HStack(spacing: 5) {
        Circle()
            .fill(tone == .muted ? OpenDesignDayColor.mutedDeep : tone.color)
            .frame(width: 6, height: 6)
        Text(text)
            .lineLimit(1)
            .truncationMode(.middle)
    }
    .font(.system(size: 10, weight: .medium, design: .monospaced))
    .foregroundStyle(tone == .muted ? OpenDesignDayColor.muted : tone.color)
    .padding(.horizontal, 8)
    .frame(height: 22)
    .background(Capsule().fill(tone == .muted ? OpenDesignDayColor.bgDarker : tone.dim))
    .overlay(Capsule().stroke(tone == .muted ? OpenDesignDayColor.borderSoft : tone.line, lineWidth: 1))
}

private func settingsNeutralPill(_ text: String) -> some View {
    Text(text)
        .font(.system(size: 11.5, weight: .medium, design: .monospaced))
        .foregroundStyle(OpenDesignDayColor.muted)
        .lineLimit(1)
        .padding(.horizontal, 12)
        .frame(minWidth: 118, minHeight: 26)
        .background(Capsule().fill(OpenDesignDayColor.surface2))
        .overlay(Capsule().stroke(OpenDesignDayColor.borderSoft, lineWidth: 1))
}

private func settingsGhostButton(
    _ title: String,
    systemImage: String? = nil,
    width: CGFloat? = nil,
    tone: OpenDesignReferenceTone = .muted
) -> some View {
    HStack(spacing: 6) {
        if let systemImage {
            Image(systemName: systemImage)
                .font(.system(size: 11, weight: .semibold))
        }
        Text(title)
            .lineLimit(1)
    }
    .font(.system(size: 11.5, weight: .medium))
    .foregroundStyle(tone == .rose ? OpenDesignDayColor.rose : OpenDesignDayColor.fgSecondary)
    .padding(.horizontal, 12)
    .frame(width: width, height: 28)
    .background(referenceRounded(fill: tone == .rose ? OpenDesignDayColor.roseDim : Color.clear, stroke: tone == .rose ? OpenDesignDayColor.rose.opacity(0.36) : OpenDesignDayColor.borderSoft, radius: 8))
}

private func providerInitial(_ title: String) -> String {
    title.first.map(String.init) ?? "A"
}

/// Brand-logo asset for a provider/runtime reference row; nil for rows without a
/// brand mark (e.g. Exa), which render the initial-letter glyph instead.
private func providerBrandImageName(forRowID id: String) -> String? {
    switch id {
    case "claude": return "BrandClaude"
    case "codex": return "BrandCodex"
    case "gemini": return "BrandGemini"
    case "node": return "BrandNodejs"
    default: return nil
    }
}

/// Brand assets that ship their own opaque background (render full-bleed).
private func providerBrandLogoIsFullBleed(forRowID id: String) -> Bool {
    id == "claude" || id == "codex"
}

private func providerLogoForeground(_ row: OpenDesignReferenceRow) -> Color {
    switch row.id {
    case "claude", "codex", "node":
        return OpenDesignDayColor.bgDeep
    default:
        return row.tone.color
    }
}

private func providerLogoBackground(_ row: OpenDesignReferenceRow) -> Color {
    switch row.id {
    case "claude":
        return OpenDesignDayColor.amber
    case "codex":
        return OpenDesignDayColor.fgSecondary
    case "node":
        return OpenDesignDayColor.sky
    default:
        return row.tone.dim
    }
}

private func integrationLogoFill(_ row: OpenDesignReferenceRow) -> Color {
    row.tone == .muted ? OpenDesignDayColor.bgDarker : row.tone.dim
}

private func integrationLogoStroke(_ row: OpenDesignReferenceRow) -> Color {
    row.tone == .muted ? OpenDesignDayColor.border : row.tone.line
}

private func settingsMetaKeyValue(_ key: String, _ value: String, strong: Bool = false) -> some View {
    HStack(alignment: .firstTextBaseline, spacing: 8) {
        Text(key)
            .font(.system(size: 11, weight: .medium, design: .monospaced))
            .foregroundStyle(OpenDesignDayColor.muted)
        Spacer(minLength: 8)
        Text(value)
            .font(.system(size: 11, weight: strong ? .semibold : .medium, design: .monospaced))
            .foregroundStyle(strong ? OpenDesignDayColor.fg : OpenDesignDayColor.fgSecondary)
            .lineLimit(1)
            .truncationMode(.middle)
    }
    .padding(.vertical, 1)
}

private func settingsMetaHeading(_ title: String) -> some View {
    Text(title)
        .font(.system(size: 10.5, weight: .medium, design: .monospaced))
        .textCase(.uppercase)
        .tracking(1)
        .foregroundStyle(OpenDesignDayColor.mutedDeep)
        .padding(.horizontal, 4)
        .padding(.bottom, 8)
}

private func settingsMetaAction(_ title: String, subtitle: String, systemImage: String) -> some View {
    HStack(alignment: .top, spacing: 12) {
        Image(systemName: systemImage)
            .font(.system(size: 13, weight: .medium))
            .foregroundStyle(OpenDesignDayColor.muted)
            .frame(width: 22, height: 22)

        VStack(alignment: .leading, spacing: 3) {
            Text(title)
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(OpenDesignDayColor.fgSecondary)
                .underline()
                .lineLimit(1)
            Text(subtitle)
                .font(.system(size: 10.5, weight: .medium, design: .monospaced))
                .foregroundStyle(OpenDesignDayColor.muted)
                .lineLimit(1)
        }
        Spacer(minLength: 0)
    }
    .padding(.horizontal, 6)
    .padding(.vertical, 9)
    .contentShape(Rectangle())
}

private func smallPill(_ text: String, tone: OpenDesignReferenceTone) -> some View {
    Text(text)
        .font(.system(size: 10.5, weight: .medium, design: .monospaced))
        .foregroundStyle(tone.color)
        .lineLimit(1)
        .truncationMode(.middle)
        .padding(.horizontal, 8)
        .frame(height: 22)
        .frame(maxWidth: 190)
        .background(Capsule().fill(tone.dim).overlay(Capsule().stroke(tone.line, lineWidth: 1)))
}

private func referenceCard() -> some View {
    RoundedRectangle(cornerRadius: 12, style: .continuous)
        .fill(OpenDesignDayColor.surface)
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(OpenDesignDayColor.borderSoft, lineWidth: 1))
}

private func referenceGradientCard(stroke: Color) -> some View {
    RoundedRectangle(cornerRadius: 14, style: .continuous)
        .fill(LinearGradient(colors: [OpenDesignDayColor.surface, OpenDesignDayColor.surface2], startPoint: .top, endPoint: .bottom))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(stroke, lineWidth: 1))
}

private struct OpenDesignReferenceAccentEdgeCard: View {
    @Environment(\.colorSchemeContrast) private var contrast

    let stroke: Color
    let accent: Color
    let cornerRadius: CGFloat
    let edgeWidth: CGFloat
    let glowRadius: CGFloat
    let glowOpacity: Double

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
        let lineWidth = OpenDesignAccessibilityMetrics.borderLineWidth(isIncreasedContrast: contrast == .increased)

        shape
            .fill(LinearGradient(colors: [OpenDesignDayColor.surface, OpenDesignDayColor.surface2], startPoint: .top, endPoint: .bottom))
            .overlay(shape.stroke(stroke, lineWidth: lineWidth))
            .overlay(alignment: .leading) {
                Rectangle()
                    .fill(accent)
                    .shadow(color: accent.opacity(glowOpacity), radius: glowRadius)
                    .frame(width: edgeWidth)
            }
            .clipShape(shape)
    }
}

private func referenceAccentEdgeCard(
    stroke: Color,
    accent: Color,
    cornerRadius: CGFloat = 14,
    edgeWidth: CGFloat = 3,
    glowRadius: CGFloat = 14,
    glowOpacity: Double = 0.68
) -> some View {
    OpenDesignReferenceAccentEdgeCard(
        stroke: stroke,
        accent: accent,
        cornerRadius: cornerRadius,
        edgeWidth: edgeWidth,
        glowRadius: glowRadius,
        glowOpacity: glowOpacity
    )
}

private func referenceRounded(fill: Color, stroke: Color, radius: CGFloat) -> some View {
    RoundedRectangle(cornerRadius: radius, style: .continuous)
        .fill(fill)
        .overlay(RoundedRectangle(cornerRadius: radius, style: .continuous).stroke(stroke, lineWidth: 1))
}

private struct FlowLayout: Layout {
    var spacing: CGFloat
    var lineSpacing: CGFloat

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? 0
        let rows = rows(for: subviews, proposalWidth: width)
        return CGSize(width: width, height: rows.reduce(CGFloat(0)) { $0 + $1.height } + CGFloat(max(0, rows.count - 1)) * lineSpacing)
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
