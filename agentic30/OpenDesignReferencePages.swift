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
        case .bipLog: return "BIP 로그"
        case .news: return "뉴스"
        case .history: return "히스토리"
        }
    }

    var titlebarDetail: String {
        switch self {
        case .projects: return "포트폴리오 + 소스 루트"
        case .settings: return "워크스페이스"
        case .interviews: return "장지창 · Mom Test 1"
        case .bipLog: return "Exa ICP 리서치 · 후보 5명 · Day 1"
        case .news: return "안 읽음 14건"
        case .history: return "Evidence 타임라인"
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
    case muted

    var color: Color {
        switch self {
        case .accent: return OpenDesignDayColor.accent
        case .amber: return OpenDesignDayColor.amber
        case .rose: return OpenDesignDayColor.rose
        case .sky: return OpenDesignDayColor.sky
        case .violet: return Color(red: 0.690, green: 0.520, blue: 0.980)
        case .teal: return Color(red: 0.230, green: 0.780, blue: 0.760)
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
            .init(id: "a3", title: "Agentic30 (creator dogfood)", subtitle: "Foundation · macOS · 소스 3", badge: "D1/30", leading: "A3", tone: .accent, isActive: true),
            .init(id: "loop", title: "LoopJournal", subtitle: "Foundation · Web + macOS · 소스 2", badge: "D4/30", leading: "LJ", tone: .amber, isActive: false),
            .init(id: "devtrace", title: "DevTrace", subtitle: "Build · Desktop app · 소스 4", badge: "D9/30", leading: "DT", tone: .sky, isActive: false),
        ]),
        OpenDesignReferenceSideGroup(title: "보관함", count: "2", rows: [
            .init(id: "qmd", title: "qmd-support · iOS 학습", subtitle: "완주 · 2026-03 · 28/30", badge: "완주", leading: "QMD", tone: .violet, isActive: false),
            .init(id: "meal", title: "MealMate · 식단 코치", subtitle: "중단 · 2026-01 · Day 9", badge: "중단", leading: "MM", tone: .sky, isActive: false),
        ]),
        OpenDesignReferenceSideGroup(title: "후보 · 아직 시작 안 함", count: "2", rows: [
            .init(id: "clipper", title: "ClipperOps (가제)", subtitle: "Problem memo · 인터뷰 0", badge: "D0", leading: "C?", tone: .amber, isActive: false),
            .init(id: "deck", title: "DeckTrace (가제)", subtitle: "아이디어만 있음", badge: "D0", leading: "D?", tone: .amber, isActive: false),
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
            title: "Agentic30 (creator dogfood)",
            subtitleParts: ["Foundation", "Day 1 / 30", "macOS 메뉴바 앱", "소스 코드 3개", "마지막 활동 4분 전"],
            actions: [
                .init(id: "switch", title: "프로젝트 전환", systemImage: "sidebar.left", tone: .ghost),
                .init(id: "today", title: "오늘 화면 열기", systemImage: "chevron.right", tone: .accent),
            ]
        ),
        filters: [],
        sections: [
            .init(id: "overview", title: "개요", meta: "Day 1 of 30 · Foundation 진행 중", markerTone: .accent, blocks: [
                .init("overview-banner", style: .banner, title: "오늘은 Day 1 · ICP 좁히기예요.", subtitle: "다음 게이트는 Day 3 인터뷰 5건까지 6일.", body: "Foundation phase는 아직 3%입니다. 지금 중요한 건 완성된 제품보다 이번 주 실제로 인터뷰할 수 있는 한 명을 고정하는 것입니다.", chips: [.init("완료 0", tone: .accent), .init("진행 중 1", tone: .amber), .init("인터뷰 0 / 5", tone: .sky), .init("BIP 0 / 14", tone: .muted)]),
                .init("calendar", style: .calendar, title: "30일 캘린더", subtitle: "Foundation · Build · Launch · Grow"),
                .init("stats", style: .metrics, rows: [
                    .init("days", title: "0 / 30", subtitle: "완료한 Day", trailing: "Day 1 진행 중", tone: .amber),
                    .init("interviews", title: "1 / 5", subtitle: "인터뷰 transcript", trailing: "+1 어제", tone: .accent),
                    .init("bip", title: "0 / 14", subtitle: "BIP 게시글", trailing: "미시작", tone: .muted),
                    .init("roots", title: "3", subtitle: "소스 코드 루트", trailing: "watch 활성", tone: .sky),
                ]),
            ]),
            .init(id: "gates", title: "Phase 게이트", meta: "진행 통과 조건 · Q2 wedge는 Foundation", markerTone: .accent, blocks: [
                .init("phase-gates", style: .rows, rows: [
                    .init("f", leading: "F", title: "Foundation 게이트", subtitle: "D7 · 인터뷰 5건 · 통증 가설 1 · ICP 1줄 정의", trailing: "진행 중", tone: .accent),
                    .init("b", leading: "B", title: "Build 게이트", subtitle: "D17 · 핵심 기능 1개 · 30초 첫 가치 경험", trailing: "대기", tone: .sky),
                    .init("l", leading: "L", title: "Launch 게이트", subtitle: "D24 · 60초 데모 · 강한 의도 신호 1", trailing: "대기", tone: .amber),
                    .init("g", leading: "G", title: "Grow 게이트", subtitle: "D30 · continue / pivot / kill 판정", trailing: "대기", tone: .violet),
                ]),
            ]),
            .init(id: "basics", title: "프로젝트 기본 정보", meta: "사용자 입력 · 언제든 수정 가능", markerTone: .accent, blocks: [
                .init("project-basics", style: .settings, rows: [
                    .init("one-line", title: "한 문장 요약", subtitle: "전업 1인 개발자가 자기 프로젝트와 실행 기록을 근거로 30일 안에 PMF 검증 방향을 좁히도록 돕는다", trailing: "필수", tone: .accent),
                    .init("icp", title: "타깃 사용자 (ICP)", subtitle: "전업 1인 개발자 · macOS 사용 · 수익 0원 · 30일 스프린트 실행 의향", trailing: "정의됨", tone: .accent),
                    .init("platform", title: "제품 플랫폼", subtitle: "macOS 메뉴바 앱 · 커리큘럼 대상 제품 플랫폼은 iOS/Android/Web/Mac 자유", trailing: "macOS", tone: .sky),
                    .init("hypothesis", title: "현재 가설", subtitle: "실제 기록을 분석한 adaptive 과제가 generic 강의보다 다음 행동을 더 잘 만든다", trailing: "검증 중", tone: .amber),
                    .init("evidence", title: "증거 채널", subtitle: "고객 인터뷰 · BIP · 업무 일지 · creator dogfood", trailing: "4채널", tone: .accent),
                ]),
            ]),
            .init(id: "paths", title: "프로젝트 경로", meta: "소스 코드 3개 + 자료 폴더 2개 · 이 프로젝트에서만 watch", markerTone: .accent, blocks: [
                .init("paths-list", style: .rows, rows: [
                    .init("app", leading: "⌘", title: "소스 코드 경로 1 · 제품 앱", subtitle: "~/code/agentic30-desktop · SwiftUI 메뉴바 앱 · 마지막 커밋 4분 전", trailing: "워치 활성", tone: .accent),
                    .init("sidecar", leading: "</>", title: "소스 코드 경로 2 · Agent sidecar", subtitle: "~/code/agentic30-sidecar · provider adapters / local index", trailing: "+2 unstaged", tone: .accent),
                    .init("public", leading: "WEB", title: "소스 코드 경로 3 · 공개 웹/문서", subtitle: "~/code/agentic30-public · landing / docs / preview fixtures", trailing: "클린", tone: .sky),
                    .init("interviews", leading: "IV", title: "인터뷰 transcript 폴더", subtitle: "~/Documents/Agentic30/agentic30/interviews · .txt / .md / .vtt / .srt", trailing: "1 / 5", tone: .amber),
                    .init("journal", leading: "MD", title: "업무 일지 / BIP 폴더", subtitle: "~/Documents/Agentic30/agentic30/journal · 오늘 만든 것 / 막힌 것 / 배운 것", trailing: "3 파일", tone: .teal),
                ]),
            ]),
            .init(id: "activity", title: "최근 활동", meta: "이 프로젝트만 · 12개 항목 · 자동 기록", markerTone: .accent, blocks: [
                .init("project-timeline", style: .timeline, rows: [
                    .init("task", leading: "4분 전", title: "Day 1 과제 생성", subtitle: "ICP 좁히기 (3개 변형) · Claude Sonnet 4.6 · 312ms", tone: .accent),
                    .init("interview", leading: "어제", title: "인터뷰 1건 추가 — 장지창 (29분)", subtitle: "자동 분석 · 통증 후보 3개 추출", tone: .sky),
                    .init("spec", leading: "7일 전", title: "SPEC.md 갱신 — Q2 wedge를 Day 0-3로 좁힘", subtitle: "+14 / -8 · 한 문장 요약 변경 없음", tone: .violet),
                    .init("journal", leading: "어제", title: "업무 일지 작성 — 오늘 막힌 것 1건", subtitle: "provider 응답 latency, sub-workflow 라우팅", tone: .amber),
                ]),
            ]),
        ],
        meta: .init(title: "프로젝트 포트폴리오", cards: [
            .init("portfolio-health", style: .banner, title: "30일 진행률 · 모든 활성", subtitle: "14 / 90 day · 3 projects", body: "Foundation 2개, Build 1개가 활성입니다. Launch/Grow 프로젝트는 아직 없습니다.", chips: [.init("F · 2", tone: .accent), .init("B · 1", tone: .sky), .init("인터뷰 5 / 15", tone: .amber)]),
            .init("portfolio-actions", style: .rows, rows: [
                .init("today", title: "오늘 화면으로", subtitle: "Day 1 · ICP 좁히기", trailing: "↵", tone: .accent),
                .init("new", title: "새 30일 프로젝트", subtitle: "템플릿 또는 백지에서 시작", trailing: "⌘N", tone: .sky),
                .init("interview", title: "인터뷰 추가", subtitle: "다음 게이트까지 4건", trailing: "⌘I", tone: .amber),
            ]),
        ])
    )

    static let settings = OpenDesignReferencePageModel(
        kind: .settings,
        sideTitle: "설정",
        sideBadge: "10",
        sideSearchPlaceholder: "설정 검색",
        sideGroups: [
            .init(title: "General", count: nil, rows: [
                .init(id: "workspace", title: "워크스페이스", subtitle: nil, badge: "3", leading: "⌂", tone: .accent, isActive: true),
                .init(id: "appearance", title: "외관 & 액센트", subtitle: nil, badge: "시스템", leading: "◐", tone: .sky, isActive: false),
                .init(id: "menubar", title: "메뉴바 & 알림", subtitle: nil, badge: nil, leading: "!", tone: .amber, isActive: false),
                .init(id: "shortcuts", title: "단축키", subtitle: nil, badge: nil, leading: "⌘", tone: .violet, isActive: false),
            ]),
            .init(title: "Agent", count: nil, rows: [
                .init(id: "providers", title: "AI 프로바이더", subtitle: nil, badge: "Claude", leading: "</>", tone: .accent, isActive: false),
                .init(id: "records", title: "기록 자동 수집", subtitle: nil, badge: "2 / 6", leading: "◎", tone: .teal, isActive: false),
                .init(id: "integrations", title: "연동", subtitle: nil, badge: "0 / 3", leading: "∞", tone: .amber, isActive: false),
            ]),
            .init(title: "Trust", count: nil, rows: [
                .init(id: "privacy", title: "개인정보 & 진단", subtitle: nil, badge: nil, leading: "◇", tone: .rose, isActive: false),
                .init(id: "updates", title: "업데이트", subtitle: nil, badge: "0.4.2", leading: "↻", tone: .sky, isActive: false),
                .init(id: "advanced", title: "고급 & Sidecar", subtitle: nil, badge: "PID", leading: "$", tone: .muted, isActive: false),
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
            .init(id: "banner", title: "상태", meta: nil, markerTone: .amber, blocks: [
                .init("predogfood", style: .banner, title: "pre-dogfood 상태입니다.", subtitle: nil, body: "외부 텔레메트리·연동·자동 업로드는 기본적으로 모두 꺼져 있어요. 모든 데이터는 ~/Library/Application Support/Agentic30 안에만 머무릅니다.", chips: [.init("local-first", tone: .accent), .init("sanitize", tone: .amber)]),
            ]),
            .init(id: "workspace", title: "워크스페이스", meta: "Day 1 · 메인 프로젝트 + 기록 폴더 3개", markerTone: .accent, blocks: [
                .init("workspace-settings", style: .settings, rows: [
                    .init("main", title: "메인 프로젝트", subtitle: "~/code/agentic30-public · SPEC.md / ICP.md / VALUES.md와 업무 일지가 누적됩니다.", trailing: "변경…", tone: .accent),
                    .init("iv", title: "인터뷰 transcript 폴더", subtitle: "~/Documents/agentic30/interviews · .txt · .md · .vtt · .srt", trailing: "변경…", tone: .sky),
                    .init("log", title: "업무 일지 폴더", subtitle: "~/Documents/agentic30/log · 오늘 만든 것 · 막힌 것 · 배운 것", trailing: "변경…", tone: .teal),
                    .init("bip", title: "BIP 폴더", subtitle: "~/Documents/agentic30/bip · 비어 있음", trailing: "변경…", tone: .amber),
                    .init("watch", title: "파일 변경 감시", subtitle: "위 4개 경로를 FSEvents로 추적합니다.", trailing: "ON", tone: .accent),
                    .init("ignore", title: "무시 패턴", subtitle: "node_modules · .git · dist · .next", trailing: "패턴 추가", tone: .muted),
                ]),
            ]),
            .init(id: "appearance", title: "외관 & 액센트", meta: "시스템 따름 · Emerald", markerTone: .sky, blocks: [
                .init("appearance-settings", style: .settings, rows: [
                    .init("theme", title: "테마", subtitle: "시스템을 따르면 macOS 야간 모드 전환 시 자동으로 바뀝니다.", trailing: "System", tone: .sky),
                    .init("accent", title: "액센트 색", subtitle: "today, progress, picker 강조색", trailing: "Emerald", tone: .accent),
                    .init("scale", title: "글자 크기", subtitle: "메뉴바 패널 + 메인 윈도우 둘 다 같이 움직입니다.", trailing: "100%", tone: .muted),
                    .init("motion", title: "모션 줄이기", subtitle: "prefers-reduced-motion이 켜져 있으면 강제 적용.", trailing: "OFF", tone: .amber),
                    .init("sidebar", title: "사이드바 너비", subtitle: "30일 챌린지 리스트가 들어가는 가운데 열의 폭.", trailing: "표준 240px", tone: .muted),
                ]),
            ]),
            .init(id: "providers", title: "AI 프로바이더", meta: "Claude 1순위 · Codex 폴백", markerTone: .accent, blocks: [
                .init("provider-order", style: .settings, rows: [
                    .init("order", title: "실행 순서", subtitle: "첫 번째 프로바이더가 실패하거나 인증이 끊기면 자동 폴백합니다.", trailing: "Claude → Codex", tone: .accent),
                ]),
                .init("providers", style: .cards, rows: [
                    .init("claude", leading: "A", title: "Claude", subtitle: "Adaptive 엔진 · day-task 생성 · transcript 분석", body: "로컬 Claude Code 세션 연결됨 · claude-opus-4-7 (1M) · 월 42 호출", trailing: "연결됨", tone: .accent),
                    .init("codex", leading: "⌥", title: "Codex", subtitle: "대체 엔진 · /analyze-ads · 비싼 모델 회피 시 사용", body: "로컬 Codex 세션 발견 안 됨 · OPENAI_API_KEY / CODEX_API_KEY 없음", trailing: "로그인", tone: .amber),
                    .init("node", leading: "20", title: "Node 런타임", subtitle: "/usr/local/bin/node — v20.11.1", body: "NODE_BINARY → 일반 설치 → mise/asdf/Volta → 로그인 셸 PATH 순 탐색", trailing: "20+", tone: .sky),
                ]),
            ]),
            .init(id: "records", title: "기록 자동 수집", meta: "기본은 폴더 watch만 — API 연동은 명시적 opt-in", markerTone: .teal, blocks: [
                .init("records", style: .rows, rows: [
                    .init("git", leading: "⌥", title: "Git 커밋 로그", subtitle: "최근 커밋을 5분마다 읽어 업무 일지 초안으로 보냅니다.", trailing: "활성", tone: .accent),
                    .init("rss", leading: "RSS", title: "블로그 RSS", subtitle: "발행한 글을 BIP 일지에 자동 append.", trailing: "활성", tone: .sky),
                    .init("caret", leading: "C", title: "caret.so transcripts", subtitle: "로컬 transcript 폴더 watch.", trailing: "꺼짐", tone: .muted),
                    .init("zoom", leading: "Z", title: "Zoom 로컬 녹화", subtitle: "~/Documents/Zoom .vtt 파일을 인터뷰 폴더로 이동.", trailing: "꺼짐", tone: .muted),
                    .init("threads", leading: "@", title: "Threads 본인 게시글 RSS", subtitle: "공개 게시글과 반응 수치를 BIP 일지에 누적.", trailing: "꺼짐", tone: .muted),
                ]),
            ]),
            .init(id: "privacy", title: "개인정보 & 진단", meta: "로컬 우선 · sanitized snapshot only", markerTone: .rose, blocks: [
                .init("privacy", style: .settings, rows: [
                    .init("posthog", title: "사용량 텔레메트리 (PostHog)", subtitle: "익명 이벤트. opt-in이며 KR1.1~KR4.3 측정에만 쓰입니다.", trailing: "OFF", tone: .muted),
                    .init("crash", title: "크래시 리포트", subtitle: "stack trace만 전송. transcript / token 미포함.", trailing: "ON", tone: .accent),
                    .init("sanitize", title: "진단 스냅샷 sanitize", subtitle: "token · path · email · 인터뷰 내용을 자동 마스킹합니다.", trailing: "강제 켜짐", tone: .amber),
                    .init("retention", title: "세션 보관 기간", subtitle: "로컬 sessions / day-task 히스토리.", trailing: "90일", tone: .muted),
                    .init("reset", title: "모든 로컬 데이터 삭제", subtitle: "기록 폴더 자체는 건드리지 않습니다.", trailing: "데이터 초기화…", tone: .rose),
                ]),
            ]),
            .init(id: "advanced", title: "고급 & Sidecar", meta: "stdio · local HTTP · MCP", markerTone: .muted, blocks: [
                .init("advanced", style: .settings, rows: [
                    .init("state", title: "Sidecar 상태", subtitle: "Node sidecar가 stdio + 로컬 HTTP 둘 다 응답 중입니다.", trailing: "실행 중", tone: .accent),
                    .init("transport", title: "통신 채널", subtitle: "기본은 stdio. HTTP는 디버깅 용도.", trailing: "stdio", tone: .sky),
                    .init("mcp", title: "MCP 도구 서버", subtitle: "sidecar/mcp-server.mjs · 내부 도구 28개.", trailing: "ON", tone: .accent),
                    .init("logs", title: "상세 로그", subtitle: "평시엔 info. trace는 1일에 ~80MB까지 늘어납니다.", trailing: "info", tone: .muted),
                ]),
            ]),
        ],
        meta: .init(title: "시스템 상태", cards: [
            .init("sidecar", style: .rows, rows: [
                .init("status", title: "Sidecar", subtitle: "PID 47281 · 2d 14h · 86 MB", trailing: "실행 중", tone: .accent),
                .init("storage", title: "스토리지", subtitle: "sessions 312KB · transcripts 6.7KB · 업무 일지 11KB", trailing: "328 KB", tone: .sky),
                .init("version", title: "버전", subtitle: "app 0.4.2 · sidecar 0.4.2 · node v20.11.1", trailing: "arm64", tone: .muted),
            ]),
            .init("system-actions", style: .rows, rows: [
                .init("diagnostics", title: "진단 스냅샷 내보내기", subtitle: "sanitize · ZIP", trailing: nil, tone: .amber),
                .init("restart", title: "Sidecar 재시작", subtitle: "다운타임 ~1초", trailing: nil, tone: .accent),
                .init("reindex", title: "워크스페이스 재인덱스", subtitle: "모든 path 재스캔", trailing: nil, tone: .sky),
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
            subtitleParts: ["2026-04-22 19:30", "Zoom · 45분", "Day 1 · 1 / 3"],
            actions: [
                .init(id: "followups", title: "후속 질문 생성", systemImage: nil, tone: .ghost),
                .init(id: "spec", title: "SPEC.md에 반영", systemImage: nil, tone: .accent),
            ]
        ),
        filters: [.init("요약"), .init("인용 12", tone: .sky), .init("후속 7", tone: .amber), .init("Transcript", tone: .muted)],
        sections: [
            .init(id: "summary", title: "요약", meta: nil, markerTone: .accent, blocks: [
                .init("summary-card", style: .banner, title: "5번 빌드 → 0매출", subtitle: "강한 신호 · Mom Test 4/5 통과", body: "패턴을 본인이 자각했지만, \"검증 없이 또 만들 것 같다\"는 회피 신호가 강합니다. 핵심 통증은 \"누가 쓸지를 모른다\"로 압축됩니다.", chips: [.init("신호 8/10"), .init("ICP 적합 매우 높음"), .init("주의 1", tone: .amber)]),
            ]),
            .init(id: "signals", title: "추출 신호", meta: "Mom Test · 4 카테고리", markerTone: .accent, blocks: [
                .init("signal-grid", style: .cards, rows: [
                    .init("pain", title: "통증", subtitle: "\"뭘 만들지 보다 누가 쓸지를 모른다.\"", body: "5건 인용 · 하루 3시간 검증 회피", tone: .rose),
                    .init("alt", title: "현재 대안", subtitle: "YouTube 인디해커 · Threads · ChatGPT", body: "3건 언급 · 구조 없음", tone: .sky),
                    .init("past", title: "과거 행동", subtitle: "6개월 · 5개 출시 · 가입 11명 · 매출 0원", body: "2건 인용 · 강력한 신호", tone: .accent),
                    .init("pay", title: "지불 의사", subtitle: "Cursor $20/mo · Claude Code $200/mo", body: "툴은 결제 · 결과는 0원", tone: .amber),
                ]),
            ]),
            .init(id: "mom", title: "Mom Test 점검", meta: nil, markerTone: .amber, blocks: [
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
                    .init("q3", leading: "12:55", title: "\"만들기 전에, 누가 쓸 사람인지를 모르겠다\"는 거예요.", subtitle: "Wedge", trailing: "핵심 통증", tone: .rose),
                    .init("q4", leading: "28:34", title: "오 그거 좋은데요? 저 해볼래요.", subtitle: "Anti-pattern", trailing: "Mom Test 위반", tone: .amber),
                ]),
            ]),
            .init(id: "followups", title: "Day 3 후속 질문", meta: "3 필수", markerTone: .accent, blocks: [
                .init("followups", style: .rows, rows: [
                    .init("f1", leading: "1", title: "지난 6개월에 마지막으로 출시한 프로덕트는 언제, 어떤 거였어요?", subtitle: "5번 빌드 → 0매출 패턴 확인", tone: .accent),
                    .init("f2", leading: "2", title: "가입자 0명일 때 본인은 그 다음 주에 뭘 했어요?", subtitle: "실패 후 실제 행동 데이터", tone: .accent),
                    .init("f3", leading: "3", title: "\"오늘 뭘 해야 다음 주가 좋아질지\" 막힐 때 마지막으로 어디서 답을 찾았어요?", subtitle: "현재 대안의 구체적 행동", tone: .accent),
                ]),
            ]),
            .init(id: "diff", title: "SPEC · ICP 갱신 제안", meta: nil, markerTone: .teal, blocks: [
                .init("diff", style: .diff, title: "ICP.md · SPEC.md §2", rows: [
                    .init("d1", leading: "5", title: "## Our ICP: 전업 1인 개발자 (수익 0원)", tone: .muted),
                    .init("d2", leading: "7", title: "- 에이전트 코딩 도구로 만들 수 있는, 이미 전업한 1인 개발자.", tone: .rose),
                    .init("d3", leading: "7", title: "+ 특히 \"AI로 계속 새로 만드는데 한 번도 안 팔린\" 서브세그.", tone: .accent),
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
                .init("t3", title: "Adaptive 핏", trailing: "2 / 3", tone: .amber),
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
            .init(title: "소스", count: "4", rows: [
                .init(id: "all", title: "전체", subtitle: nil, badge: "5", leading: "▣", tone: .accent, isActive: true),
                .init(id: "strong", title: "강한 적합", subtitle: nil, badge: "3", leading: "✓", tone: .accent, isActive: false),
                .init(id: "indie", title: "Indie Hackers", subtitle: nil, badge: "3", leading: "IH", tone: .sky, isActive: false),
                .init(id: "needs", title: "워치리스트", subtitle: nil, badge: "2", leading: "!", tone: .amber, isActive: false),
            ]),
            .init(title: "ICP 신호", count: "8", rows: [
                .init(id: "quit", title: "전업 / 퇴사 / 런웨이", subtitle: "긴급성 · 저축 소진", badge: "seen", leading: "01", tone: .accent, isActive: false),
                .init(id: "tools", title: "Claude Code / Cursor", subtitle: "agentic coding", badge: "seen", leading: "02", tone: .accent, isActive: false),
                .init(id: "revenue", title: "수익 0원 / 첫 매출 전", subtitle: "PMF 미확정", badge: "gap", leading: "03", tone: .amber, isActive: false),
                .init(id: "mac", title: "macOS 증거", subtitle: "Mac · M-series · native", badge: "gap", leading: "04", tone: .amber, isActive: false),
            ]),
        ],
        header: .init(
            badge: "BIP",
            systemImage: "doc.text",
            title: "BIP 로그 · ICP 리서치",
            subtitleParts: ["Exa 검색 · 5명 후보", "상위 3명은 인터뷰/DM 후보"],
            actions: [
                .init(id: "draft", title: "초안", systemImage: "doc.text", tone: .ghost),
                .init(id: "research", title: "다시 리서치", systemImage: "plus", tone: .accent),
            ]
        ),
        filters: [.init("전체 5"), .init("강한 적합 3", tone: .accent), .init("Indie Hackers 3", tone: .sky), .init("블로그 2", tone: .violet), .init("워치리스트 2", tone: .amber)],
        sections: [
            .init(id: "brief", title: "ICP 리서치 큐", meta: "Exa Search · 자동 후보 발굴 · 2026-05-17", markerTone: .accent, blocks: [
                .init("research-brief", style: .banner, title: "전업 1인 개발자 후보를 공개 게시글에서 찾았어요.", subtitle: "auto research run", body: "검색 기준은 ICP 문서의 퇴사/전업, 에이전트 코딩 도구, 수익 전 또는 초기, macOS 증거, BIP 기록 의향입니다.", chips: [.init("후보 5"), .init("강한 적합 3", tone: .accent), .init("macOS 확인 필요 3", tone: .amber)]),
            ]),
            .init(id: "research", title: "리서치된 게시글", meta: "원문 하이라이트 + ICP 근거", markerTone: .sky, blocks: [
                .init("research-list", style: .articles, rows: [
                    .init("speakmac", leading: "강", title: "Speakmac founder — macOS 네이티브 앱을 Claude Code로 밀어붙이는 1인 개발자", subtitle: "Speakmac Lab · 2024-09-24 · blog", body: "원문 증거: recent layoff, six-month runway, M3 MacBook. 퇴사/런웨이 + Mac 사용이 직접 드러납니다.", trailing: "BIP 초안에 반영", tone: .accent, chips: [.init("macOS 증거"), .init("Claude Code"), .init("매출 확인 필요", tone: .amber)]),
                    .init("kun", leading: "강", title: "Kun Chen — Big Tech 퇴사 후 솔로 빌더 여정을 공개", subtitle: "Kun Chen · 2026-05-04 · Substack", body: "퇴사, 솔로 전환, 무수익 상태가 모두 보입니다. macOS 로컬 앱 설치 허들을 확인해야 합니다.", trailing: "BIP 초안에 반영", tone: .accent, chips: [.init("퇴사 완료"), .init("solo builder"), .init("macOS 확인 필요", tone: .amber)]),
                    .init("quiq", leading: "강", title: "Quiqlog builder — Claude Code와 Cursor를 배워 혼자 SaaS 출시", subtitle: "Indie Hackers · 2026-03-02 · post", body: "만들기는 되지만 검증/방향/계속할지 판단이 막힌 전형입니다.", trailing: "BIP 초안에 반영", tone: .accent, chips: [.init("퇴사"), .init("Claude Code"), .init("Cursor")]),
                    .init("clirank", leading: "보류", title: "CLIRank builder — 나 + Claude Code로 다시 빌드", subtitle: "Indie Hackers · 2026-04-07 · post", body: "agentic coding 신호는 강하지만 이전 창업 경험이 높아 Foundation ICP와 다를 수 있습니다.", trailing: "워치", tone: .amber, chips: [.init("solo"), .init("Claude Code"), .init("매출 확인", tone: .amber)]),
                ]),
            ]),
            .init(id: "draft", title: "BIP 초안", meta: "선택 후보를 기반으로 자동 생성", markerTone: .amber, blocks: [
                .init("draft", style: .draft, title: "선택 후보 없음", body: "후보 카드에서 “BIP 초안에 반영”을 누르면, ICP 리서치 결과를 오늘의 공개 기록으로 바꿉니다.\n\n형식:\n1. 원문에서 잡은 ICP 증거\n2. 왜 인터뷰 후보인지\n3. DM에서 확인할 공백 1개"),
            ]),
        ],
        meta: .init(title: "ICP 후보", cards: [
            .init("candidate-progress", style: .banner, title: "5 / 18 후보", subtitle: "다음 액션 · 상위 3명 DM 후보화", body: "수익 0원, macOS, 인터뷰 의향 공백을 확인하면 Day 3 인터뷰 큐로 승격합니다.", chips: [.init("seen 4", tone: .accent), .init("gap 3", tone: .amber), .init("ask 3", tone: .sky)]),
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
                .init(id: "adaptive", title: "Adaptive over Static", subtitle: nil, badge: "3", leading: "●", tone: .teal, isActive: false),
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
        filters: [.init("전체 14"), .init("제약 4", tone: .amber), .init("고객 6", tone: .accent), .init("공개 3", tone: .sky), .init("숫자 4", tone: .rose), .init("Adaptive 3", tone: .teal)],
        sections: [
            .init(id: "takeaway", title: "오늘의 한 줄", meta: "Day 1 — ICP · 첫 인터뷰를 정하는 중", markerTone: .amber, blocks: [
                .init("takeaway", style: .banner, title: "아이디어를 묻지 마세요.", subtitle: "Rob Fitzpatrick · The Mom Test, Ch. 1 · 22분 읽기", body: "지난주에 이 문제 때문에 실제로 뭘 했는지 물으세요. 칭찬은 데이터가 아닙니다.", chips: [.init("오늘 인터뷰 질문에 반영"), .init("VALUES.md에 인용 저장", tone: .amber)]),
            ]),
            .init(id: "customer", title: "고객이 먼저다", meta: "Value 2 · 6건 · ICP가 첫 매출 0원일 때 가장 자주 비는 자료", markerTone: .accent, blocks: [
                .init("customer-articles", style: .articles, rows: [
                    .init("mom", leading: "MT", title: "The Mom Test — 엄마도 거짓말한다", subtitle: "momtestbook.com · 책 · Ch. 1-3 · 22분", body: "Day 1 적용: \"지난주에 이 문제 때문에 뭘 시도했나요?\" 칭찬형 답이 사라지고, 진짜 시간을 쓴 사람만 남습니다.", trailing: "오늘 고정", tone: .accent, chips: [.init("고객"), .init("숫자", tone: .rose)]),
                    .init("ph", leading: "PH", title: "Your entire strategy is downstream of your ICP", subtitle: "posthog.com/handbook · 8분", body: "ICP가 가격, 기능, 마케팅 채널, 콘텐츠 톤, UI 스타일을 결정합니다. 모르는 사람을 위해 만들면 모든 결정이 흐릿해집니다.", tone: .teal, chips: [.init("고객"), .init("Adaptive", tone: .teal)]),
                    .init("pg", leading: "PG", title: "Do Things That Don't Scale", subtitle: "paulgraham.com · 에세이 · 15분", body: "첫 30일은 자동화보다 1대1 손작업이 빠릅니다. 첫 5명에게 메뉴바 앱을 직접 설치해 주세요.", tone: .amber, chips: [.init("고객"), .init("제약", tone: .amber)]),
                    .init("yc", leading: "YC", title: "How to Talk to Users", subtitle: "Startup School · 강연 · 32분", body: "지금 가장 큰 문제 1개, 마지막 발생 시점, 그때 어떻게 해결했는가. 이 3개로 시작하세요.", tone: .sky, chips: [.init("고객"), .init("숫자", tone: .rose)]),
                ]),
            ]),
            .init(id: "constraint", title: "제약이 실력이다", meta: "Value 1 · 4건 · 30일 안에 끝나려면 뭘 빼야 하는가", markerTone: .amber, blocks: [
                .init("constraint-articles", style: .articles, rows: [
                    .init("calm", leading: "CC", title: "Calm Company — VC 없이도 충분하다", subtitle: "calmcompany.fund · 매니페스토 · 7분", body: "30일 목표를 투자 유치가 아니라 첫 매출 1원으로 잡으세요.", tone: .amber, chips: [.init("제약", tone: .amber), .init("Adaptive", tone: .teal)]),
                    .init("levels", leading: "LV", title: "Nomad List — 한 명, 단일 SQLite, $1.5M ARR", subtitle: "levels.io · 실전 케이스", body: "스택은 모트가 아닙니다. 모트는 고객과의 거리입니다.", tone: .amber, chips: [.init("제약", tone: .amber), .init("고객")]),
                ]),
            ]),
        ],
        meta: .init(title: "뉴스 요약", cards: [
            .init("coverage", style: .rows, title: "Value 커버리지", rows: [
                .init("customer", title: "고객이 먼저다", trailing: "6 / 14", tone: .accent),
                .init("constraint", title: "제약이 실력이다", trailing: "4 / 14", tone: .amber),
                .init("numbers", title: "숫자로 결정", trailing: "4 / 14", tone: .rose),
                .init("adaptive", title: "Adaptive over Static", trailing: "3 / 14", tone: .teal),
            ]),
            .init("recommend", style: .rows, title: "오늘 추천 3건", rows: [
                .init("r1", leading: "01", title: "The Mom Test — 엄마도 거짓말한다", subtitle: "고객 · 22분 · 인터뷰 직전", tone: .accent),
                .init("r2", leading: "02", title: "YC — How to Talk to Users", subtitle: "고객 · 32분 · 3개 질문 템플릿", tone: .sky),
                .init("r3", leading: "03", title: "PostHog — Downstream of ICP", subtitle: "Adaptive · 8분 · ICP 정의 직전", tone: .teal),
            ]),
        ])
    )

    static let history = OpenDesignReferencePageModel(
        kind: .history,
        sideTitle: "30일 챌린지",
        sideBadge: "1 / 30",
        sideSearchPlaceholder: "과제 검색",
        sideGroups: [
            .init(title: "Week 1 — Foundation", count: "1 / 7", rows: [
                .init(id: "day1", title: "먼저 도울 사람을 정해요", subtitle: "Day 1 · ICP · 인터뷰 1/3", badge: nil, leading: "◌", tone: .accent, isActive: false),
                .init(id: "day2", title: "시장 신호 읽기", subtitle: "Day 2 · Market", badge: nil, leading: "○", tone: .muted, isActive: false),
                .init(id: "day3", title: "Mom Test 인터뷰 ×3", subtitle: "Day 3 · Interview", badge: nil, leading: "○", tone: .muted, isActive: false),
                .init(id: "day4", title: "10× 웨지 찾기", subtitle: "Day 4 · Wedge", badge: nil, leading: "○", tone: .muted, isActive: false),
            ]),
            .init(title: "Week 2 — Build", count: "잠금 해제 D7", rows: [
                .init(id: "day8", title: "MVP 코어 4시간 빌드", subtitle: "Day 8 · Build", badge: "잠금", leading: "⌧", tone: .muted, isActive: false),
                .init(id: "day9", title: "첫 5명 초대 초안", subtitle: "Day 9 · Outreach", badge: "잠금", leading: "⌧", tone: .muted, isActive: false),
            ]),
        ],
        header: .init(
            badge: "H",
            systemImage: "clock.arrow.circlepath",
            title: "Evidence 타임라인",
            subtitleParts: ["14 events", "2026-05-02 → 오늘", "agentic30-public"],
            actions: [.init(id: "today", title: "오늘로 이동", systemImage: "forward", tone: .accent)]
        ),
        filters: [.init("전체 14"), .init("인터뷰 6", tone: .sky), .init("BIP 로그 0", tone: .amber), .init("코드 · GitHub 4", tone: .accent), .init("과제 1", tone: .violet), .init("커리큘럼 3", tone: .teal)],
        sections: [
            .init(id: "summary", title: "요약", meta: nil, markerTone: .accent, blocks: [
                .init("banner", style: .banner, title: "Foundation Loop이 처음으로 닫혔어요 · Day 1 완료", subtitle: "2026-05-16 14:48", body: "ICP 후보 1명이 SPEC.md에 자동 저장됨 · Day 2가 곧 열립니다.", chips: [.init("완료 Day 1 / 30"), .init("Evidence 14", tone: .sky), .init("활동일 5 / 15d", tone: .amber)]),
            ]),
            .init(id: "today", title: "오늘", meta: "2026-05-16 · 금 · 6 events", markerTone: .accent, blocks: [
                .init("today-events", style: .timeline, rows: [
                    .init("code", leading: "14:48:02", title: "후보 1명 자동 저장", subtitle: "SPEC.md · candidate.icp 블록 갱신 · +18 / -3", body: "channel=ex-colleague, tools=cursor, stuck=build-loop, last7d=restart", tone: .accent),
                    .init("iv4", leading: "14:45:21", title: "\"또 새로 시작\"", subtitle: "INTERVIEW 4/4 · 지난 7일", body: "Mom Test 통과. 빌드 루프 가설이 실제 행동으로 확정됐어요.", tone: .sky),
                    .init("iv3", leading: "14:42:09", title: "\"빌드 단계\" · \"검증 없이 5번 빌드\"", subtitle: "INTERVIEW 3/4 · 막힌 단계", body: "wedge 후보가 빌드를 끝까지 끌고 가는 보조로 좁혀집니다.", tone: .sky),
                    .init("iv2", leading: "14:38:33", title: "\"Cursor 메인\"", subtitle: "INTERVIEW 2/4 · 도구", body: "결제 의향이 안정적인 풀이고 Day 3 인터뷰 모수도 충분합니다.", tone: .sky),
                    .init("mission", leading: "14:32:50", title: "첫 인터뷰 1통 할 사람을 한 명 고르기", subtitle: "MISSION · Day 1 수락", body: "예상 3분 → 실제 16분.", tone: .violet),
                ]),
            ]),
            .init(id: "yesterday", title: "어제", meta: "2026-05-15 · 목 · 3 events", markerTone: .sky, blocks: [
                .init("yesterday-events", style: .timeline, rows: [
                    .init("spec", leading: "22:14:08", title: "SPEC.md · ALIGNMENT.md 정리", subtitle: "제품 한 줄 확정 · +142 / -87", tone: .accent),
                    .init("zoom", leading: "21:30:00", title: "장지창 · 45분", subtitle: "Zoom transcript · 검증 없이 5번 빌드", tone: .sky),
                    .init("scope", leading: "17:42:03", title: "Q2 wedge: Foundation Day 0-3 먼저 닫기", subtitle: "Day 4-7 / Day 8-30은 dogfood 이후 확장", tone: .teal),
                ]),
            ]),
            .init(id: "future", title: "내일 — 잠금 해제 예정", meta: "2026-05-17 → Day 2 · Day 30", markerTone: .muted, blocks: [
                .init("future-events", style: .timeline, rows: [
                    .init("day2", leading: "LOCKED", title: "시장 신호 읽기", subtitle: "Day 1 ICP 후보 1명을 기준으로 Threads/IH 키워드 3개 추출", tone: .muted),
                    .init("day3", leading: "ETA 5/18", title: "Mom Test 인터뷰 ×3", subtitle: "전 직장 출신 + Cursor + 빌드 단계에서 멈춤 풀 5명", tone: .muted),
                ]),
            ]),
        ],
        meta: .init(title: "요약", cards: [
            .init("heatmap", style: .heatmap, title: "활동 · 30일", subtitle: "14 events"),
            .init("sources", style: .rows, title: "Evidence 소스 · 합 14", rows: [
                .init("iv", title: "인터뷰 · transcript", trailing: "6", tone: .sky),
                .init("bip", title: "BIP 로그 · 게시", trailing: "0", tone: .amber),
                .init("code", title: "코드 · GitHub commit", trailing: "4", tone: .accent),
                .init("mission", title: "과제 · Day 미션", trailing: "1", tone: .violet),
                .init("curriculum", title: "커리큘럼 · 결정", trailing: "3", tone: .teal),
            ]),
        ])
    )
}

struct OpenDesignReferenceTitlebar: View {
    let page: OpenDesignReferencePageModel
    let openSearch: () -> Void

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
                if page.kind == .news || page.kind == .bipLog {
                    OpenDesignReferenceToolbarButton(systemImage: "arrow.clockwise", label: "새로고침", action: {})
                }
                if page.kind == .projects || page.kind == .settings || page.kind == .interviews || page.kind == .history || page.kind == .news {
                    OpenDesignReferenceToolbarButton(systemImage: "sidebar.right", label: "우측 패널", isOn: true, action: {})
                }
            }
            .padding(.trailing, 12)
        }
        .frame(height: 36)
        .background(OpenDesignDayColor.bg)
        .overlay(Rectangle().fill(OpenDesignDayColor.borderSoft).frame(height: 1), alignment: .bottom)
    }
}

struct OpenDesignReferenceShell: View {
    let kind: OpenDesignReferencePageKind
    let layout: OpenDesignDayLayoutMetrics
    let openSearch: () -> Void

    private var page: OpenDesignReferencePageModel {
        OpenDesignReferenceCatalog.page(kind)
    }

    var body: some View {
        Group {
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

private struct OpenDesignReferenceToolbarButton: View {
    let systemImage: String
    let label: String
    var isOn = false
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
        .background(referenceGradientCard(stroke: OpenDesignDayColor.border))
        .overlay(alignment: .leading) {
            RoundedRectangle(cornerRadius: 2, style: .continuous)
                .fill(OpenDesignDayColor.accent)
                .frame(width: 3)
        }
    }

    private var calendar: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text(block.title ?? "30일 캘린더")
                    .font(.system(size: 10.5, weight: .medium, design: .monospaced))
                    .textCase(.uppercase)
                    .foregroundStyle(OpenDesignDayColor.muted)
                Spacer()
                Text("Foundation · Build · Launch · Grow")
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

private func smallPill(_ text: String, tone: OpenDesignReferenceTone) -> some View {
    Text(text)
        .font(.system(size: 10.5, weight: .medium, design: .monospaced))
        .foregroundStyle(tone.color)
        .padding(.horizontal, 8)
        .frame(height: 22)
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
