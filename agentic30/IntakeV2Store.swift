import Foundation
import Combine

// MARK: - Intake V2 — review decisions 2026-05-14
// Implements:
//   D3 (eng): @StateObject IntakeStore (ObservableObject + UserDefaults)
//   D6 (eng): 3-class split — IntakeStore / SourceManager / DecisionEngine (engine in IntakeV2DecisionEngine.swift)
//   D1 (eng): Records → post-onboarding (corpus is filled AFTER first Decide, not during 4-step intake)
// Reuses existing enums from MacOnboardingContext.swift:
//   OnboardingWorkMode (workmode)
//   OnboardingRole (role)
//   OnboardingProjectStage (stuck)

// MARK: - Source identifiers (D6 — owned by SourceManager)

enum IntakeSourceID: String, Codable, CaseIterable, Hashable {
    case localFolder = "local_folder"
    case github
    case googleDocs = "google_docs"
    case googleSheets = "google_sheets"
    case notion
    case discord
    case posthog
    case toss
    case stripe
    case threads
    case interviewTxt = "interview_txt"
    case workLogFolder = "work_log_folder"
    case interviewTranscriptFolder = "interview_transcript_folder"
    case linear = "github_issues_linear"
    case jira
    case confluence
    case figma
    case cursor
    case claudeCode = "claude_code"
    case codex
    case nativeNotes = "native_notes"
    case slack
    case sentry
    case vercel
    case cloudflare
    case neon
    case aws
    case gmailEmail = "gmail_email"
    case calendarCalls = "calendar_calls"
    case formsSurvey = "forms_survey"
    case blogRss = "blog_rss"
    case xTwitter = "x_twitter"
    case instagram
    case youtubeLoomDemo = "youtube_loom_demo"
    case metaAds = "meta_ads"
    case googleSearchConsole = "google_search_console"
    case googleAnalyticsPlausible = "google_analytics_plausible"
    case appStoreGooglePlay = "app_store_google_play"
    case reddit
    case revenueCat = "revenue_cat"
    case lemonSqueezy = "lemon_squeezy"
    case paddle
    case gumroad
    case lemonSqueezyPaddleGumroad = "lemon_squeezy_paddle_gumroad"
    case customUrl = "custom_url"
    case customLocalFileFolder = "custom_local_file_folder"
    case customManualNote = "custom_manual_note"
    case customCsvImport = "custom_csv_import"

    var displayName: String {
        switch self {
        case .localFolder: return "Local folder"
        case .github: return "GitHub"
        case .googleDocs: return "Google Docs"
        case .googleSheets: return "Google Sheets"
        case .notion: return "Notion"
        case .discord: return "Discord"
        case .posthog: return "PostHog"
        case .toss: return "Toss"
        case .stripe: return "Stripe"
        case .threads: return "Threads"
        case .interviewTxt: return "Interview TXT"
        case .workLogFolder: return "Work Log Folder"
        case .interviewTranscriptFolder: return "Interview Transcript Folder"
        case .linear: return "Linear"
        case .jira: return "Jira"
        case .confluence: return "Confluence"
        case .figma: return "Figma"
        case .cursor: return "Cursor"
        case .claudeCode: return "Claude Code"
        case .codex: return "Codex"
        case .nativeNotes: return "iOS/macOS Native / Notes"
        case .slack: return "Slack"
        case .sentry: return "Sentry"
        case .vercel: return "Vercel"
        case .cloudflare: return "Cloudflare"
        case .neon: return "Neon"
        case .aws: return "AWS"
        case .gmailEmail: return "Gmail / Email"
        case .calendarCalls: return "Calendar / Calls"
        case .formsSurvey: return "Forms / Survey"
        case .blogRss: return "Blog / RSS"
        case .xTwitter: return "X / Twitter"
        case .instagram: return "Instagram"
        case .youtubeLoomDemo: return "YouTube"
        case .metaAds: return "Meta Ads"
        case .googleSearchConsole: return "Google Search Console"
        case .googleAnalyticsPlausible: return "Google Analytics / Plausible"
        case .appStoreGooglePlay: return "App Store Connect / Google Play"
        case .reddit: return "Reddit"
        case .revenueCat: return "RevenueCat"
        case .lemonSqueezy: return "Lemon Squeezy"
        case .paddle: return "Paddle"
        case .gumroad: return "Gumroad"
        case .lemonSqueezyPaddleGumroad: return "Lemon Squeezy / Paddle / Gumroad"
        case .customUrl: return "Custom URL"
        case .customLocalFileFolder: return "Local file/folder"
        case .customManualNote: return "Manual note"
        case .customCsvImport: return "CSV import"
        }
    }
}

enum IntakeSourceCatalogCategory: String, CaseIterable, Hashable {
    case core = "Core"
    case voc = "VOC"
    case `public` = "Public"
    case analytics = "Analytics"
    case infra = "Infra"
    case revenue = "Revenue"
    case custom = "Custom"
}

struct SourceCatalogItem: Identifiable, Hashable {
    let id: IntakeSourceID
    let category: IntakeSourceCatalogCategory
    let kind: String
    let why: String
    let systemImage: String

    init(
        id: IntakeSourceID,
        category: IntakeSourceCatalogCategory,
        kind: String,
        why: String,
        systemImage: String
    ) {
        self.id = id
        self.category = category
        self.kind = kind
        self.why = why
        self.systemImage = systemImage
    }
}

nonisolated enum IntakeSourceIconKind: Hashable {
    case asset(String)
    case composite([String])
    case symbol(String)

    var isBrandBacked: Bool {
        switch self {
        case .asset, .composite:
            return true
        case .symbol:
            return false
        }
    }
}

enum IntakeSourceCatalog {
    static let mainGridIDs: [IntakeSourceID] = [
        .localFolder,
        .github,
        .figma,
        .cursor,
        .claudeCode,
        .codex,
        .nativeNotes,
        .googleDocs,
        .googleSheets,
        .notion,
        .discord,
        .posthog,
        .toss,
        .stripe,
        .threads,
        .xTwitter,
        .instagram,
        .googleSearchConsole,
        .aws,
        .interviewTxt,
    ]

    static let builtInMainGridIDs = Set(mainGridIDs)

    static var addableItems: [SourceCatalogItem] {
        items.filter { !builtInMainGridIDs.contains($0.id) }
    }

    static let items: [SourceCatalogItem] = [
        .init(id: .localFolder, category: .core, kind: "FILES", why: "코드, 문서, 설정을 읽어 프로젝트 맥락을 잡습니다.", systemImage: "folder.fill"),
        .init(id: .workLogFolder, category: .core, kind: "FILES · WORK LOG", why: "오늘 만든 것, 막힌 것, 배운 점을 다음 결정에 씁니다.", systemImage: "calendar.badge.clock"),
        .init(id: .interviewTranscriptFolder, category: .core, kind: "FILES · VOC", why: "txt, md, vtt, srt 인터뷰 기록에서 고객 발화를 뽑습니다.", systemImage: "text.quote"),
        .init(id: .linear, category: .core, kind: "WORK · ROADMAP", why: "Linear 이슈와 로드맵에서 실제 우선순위 변화를 읽습니다.", systemImage: "checklist"),
        .init(id: .jira, category: .core, kind: "WORK · ROADMAP", why: "이슈, 스프린트, 우선순위 변화, blocker를 실행 맥락으로 읽습니다.", systemImage: "checklist"),
        .init(id: .github, category: .core, kind: "REPO · CODE", why: "커밋과 코드 구조로 현재 제품 상태를 봅니다.", systemImage: "chevron.left.forwardslash.chevron.right"),
        .init(id: .confluence, category: .core, kind: "DOCS · KNOWLEDGE", why: "PRD, 회의록, 결정 문서, 팀 지식을 문서 맥락으로 읽습니다.", systemImage: "doc.text.fill"),
        .init(id: .figma, category: .core, kind: "DESIGN · SPEC", why: "디자인 스펙, Dev Mode, 구현-ready 변경점을 제품 맥락으로 읽습니다.", systemImage: "paintpalette.fill"),
        .init(id: .cursor, category: .core, kind: "AI · EDITOR", why: "Cursor 에디터 작업 흐름, composer 변경, 코드 맥락을 실행 기록으로 둡니다.", systemImage: "cursorarrow.click.2"),
        .init(id: .claudeCode, category: .core, kind: "AI · CODE", why: "Claude Code 세션과 터미널 중심 변경 흐름을 구현 맥락으로 읽습니다.", systemImage: "terminal.fill"),
        .init(id: .codex, category: .core, kind: "AI · CODE", why: "Codex 작업, 리뷰, 에이전트 실행 기록을 코드 결정 맥락으로 둡니다.", systemImage: "curlybraces.square.fill"),
        .init(id: .nativeNotes, category: .core, kind: "NATIVE · NOTES", why: "iOS/macOS 기본 메모 앱에 남긴 아이디어, 고객 메모, 실행 기록을 표시합니다.", systemImage: "apple.logo"),
        .init(id: .interviewTxt, category: .voc, kind: "FILES · VOC", why: "단일 인터뷰 텍스트를 Foundation 질문 생성에 씁니다.", systemImage: "doc.plaintext.fill"),
        .init(id: .gmailEmail, category: .voc, kind: "COMM · VOC", why: "고객 답장, 가격 ask, waitlist 대화를 증거로 남깁니다.", systemImage: "envelope.fill"),
        .init(id: .calendarCalls, category: .voc, kind: "COMM · INTERVIEWS", why: "고객 미팅 일정과 콜 기록으로 실행 여부를 확인합니다.", systemImage: "calendar"),
        .init(id: .formsSurvey, category: .voc, kind: "VOC · DATA", why: "설문, 폼, CSV 응답에서 수요 신호를 정리합니다.", systemImage: "list.bullet.rectangle"),
        .init(id: .discord, category: .voc, kind: "COMM · VOC", why: "커뮤니티 대화에서 고객 언어와 반응을 찾습니다.", systemImage: "bubble.left.and.bubble.right.fill"),
        .init(id: .slack, category: .voc, kind: "COMM · TEAM", why: "팀 대화, 결정, 파일, 고객 신호를 협업 맥락으로 읽습니다.", systemImage: "bubble.left.and.bubble.right.fill"),
        .init(id: .threads, category: .public, kind: "PUBLIC · VOC", why: "BIP 게시와 반응을 공개 실행 증거로 씁니다.", systemImage: "at"),
        .init(id: .blogRss, category: .public, kind: "PUBLIC · BIP", why: "블로그와 RSS 기록으로 공개 학습 흐름을 읽습니다.", systemImage: "dot.radiowaves.left.and.right"),
        .init(id: .xTwitter, category: .public, kind: "PUBLIC · VOC", why: "X/Twitter 반응과 공개 질문을 Launch 증거로 씁니다.", systemImage: "text.bubble.fill"),
        .init(id: .instagram, category: .public, kind: "PUBLIC · VOC", why: "Instagram 게시, 댓글, DM 반응을 공개 실행 증거와 고객 언어로 둡니다.", systemImage: "camera.fill"),
        .init(id: .reddit, category: .public, kind: "PUBLIC · COMMUNITY", why: "Reddit 토론, 추천, 비교 글에서 제3자 언급과 고객 언어를 찾습니다.", systemImage: "bubble.left.and.bubble.right.fill"),
        .init(id: .youtubeLoomDemo, category: .public, kind: "PUBLIC · VIDEO", why: "데모와 튜토리얼 transcript를 AI citation과 첫 가치 경험 증거로 둡니다.", systemImage: "play.rectangle.fill"),
        .init(id: .posthog, category: .analytics, kind: "ANALYTICS", why: "사용, 전환, 퍼널 데이터를 Grow 판단에 씁니다.", systemImage: "chart.xyaxis.line"),
        .init(id: .metaAds, category: .analytics, kind: "ADS · DEMAND", why: "광고 지표로 메시지와 수요 검증을 분리합니다.", systemImage: "megaphone.fill"),
        .init(id: .googleSearchConsole, category: .analytics, kind: "SEARCH · AEO", why: "검색 query, page, click, impression을 AEO 기준선으로 봅니다.", systemImage: "magnifyingglass.circle.fill"),
        .init(id: .googleAnalyticsPlausible, category: .analytics, kind: "ANALYTICS", why: "랜딩 유입과 첫 행동을 PostHog 외 경로로 봅니다.", systemImage: "chart.bar.xaxis"),
        .init(id: .appStoreGooglePlay, category: .analytics, kind: "STORE · LAUNCH", why: "스토어 노출, 설치, ASO 신호를 출시 증거로 씁니다.", systemImage: "square.grid.2x2.fill"),
        .init(id: .sentry, category: .infra, kind: "OBSERVABILITY", why: "에러, 성능, 릴리즈, 장애 신호를 런타임 맥락으로 읽습니다.", systemImage: "exclamationmark.triangle.fill"),
        .init(id: .vercel, category: .infra, kind: "DEPLOY · WEB", why: "배포, 함수, edge request, AI Gateway/observability 신호를 웹 런타임 맥락으로 읽습니다.", systemImage: "triangle.fill"),
        .init(id: .cloudflare, category: .infra, kind: "EDGE · PLATFORM", why: "Workers, edge, AI/agent 배포, 네트워크/보안 신호를 플랫폼 맥락으로 읽습니다.", systemImage: "cloud.fill"),
        .init(id: .neon, category: .infra, kind: "DATABASE · POSTGRES", why: "Postgres schema, branches, migration, database state를 데이터 맥락으로 읽습니다.", systemImage: "cylinder.fill"),
        .init(id: .aws, category: .infra, kind: "CLOUD · AWS", why: "AWS 배포, 인프라, 로그, 비용 신호를 런타임 맥락으로 읽습니다.", systemImage: "cloud.fill"),
        .init(id: .googleDocs, category: .core, kind: "CLOUD · DOCS", why: "업무일지와 프로젝트 문서를 코치 문맥에 넣습니다.", systemImage: "doc.text.fill"),
        .init(id: .googleSheets, category: .analytics, kind: "CLOUD · DATA", why: "일별 공개 기록과 지표를 표 형태로 누적합니다.", systemImage: "tablecells.fill"),
        .init(id: .notion, category: .core, kind: "CLOUD · NOTES", why: "노트와 문서 데이터베이스를 프로젝트 맥락으로 씁니다.", systemImage: "doc.richtext.fill"),
        .init(id: .stripe, category: .revenue, kind: "PAYMENT", why: "결제와 가격 ask 결과를 수익 증거로 봅니다.", systemImage: "creditcard.fill"),
        .init(id: .toss, category: .revenue, kind: "PAYMENT", why: "한국 결제 경로의 실제 구매 신호를 기록합니다.", systemImage: "wonsign.circle.fill"),
        .init(id: .revenueCat, category: .revenue, kind: "PAYMENT · MOBILE", why: "모바일 구독 전환과 paywall 실험을 추적합니다.", systemImage: "crown.fill"),
        .init(id: .lemonSqueezy, category: .revenue, kind: "PAYMENT", why: "Lemon Squeezy 결제와 첫 매출 신호를 둡니다.", systemImage: "cart.fill"),
        .init(id: .paddle, category: .revenue, kind: "PAYMENT", why: "Paddle 결제와 구독 매출 신호를 둡니다.", systemImage: "cart.fill"),
        .init(id: .gumroad, category: .revenue, kind: "PAYMENT", why: "Gumroad 판매와 첫 매출 신호를 둡니다.", systemImage: "cart.fill"),
        .init(id: .customUrl, category: .custom, kind: "CUSTOM · URL", why: "아직 catalog에 없는 웹 기록 위치를 직접 남깁니다.", systemImage: "link"),
        .init(id: .customLocalFileFolder, category: .custom, kind: "CUSTOM · FILES", why: "특정 파일이나 폴더를 source 후보로 표시합니다.", systemImage: "folder.badge.plus"),
        .init(id: .customManualNote, category: .custom, kind: "CUSTOM · NOTE", why: "수동으로 남긴 기록 위치나 설명을 추가합니다.", systemImage: "note.text"),
        .init(id: .customCsvImport, category: .custom, kind: "CUSTOM · CSV", why: "폼, 매출, 지표 CSV를 나중에 연결할 후보로 둡니다.", systemImage: "tablecells.badge.ellipsis"),
    ]

    static func item(for id: IntakeSourceID) -> SourceCatalogItem? {
        items.first { $0.id == id }
    }
}

enum IntakeSourceIconCatalog {
    static func iconKind(for id: IntakeSourceID, fallbackSystemImage: String = "questionmark") -> IntakeSourceIconKind {
        switch id {
        case .github:
            return .asset("BrandGitHub")
        case .googleDocs:
            return .asset("BrandGoogleDocs")
        case .googleSheets:
            return .asset("BrandGoogleSheets")
        case .notion:
            return .asset("BrandNotion")
        case .discord:
            return .asset("BrandDiscord")
        case .posthog:
            return .asset("BrandPostHog")
        case .toss:
            return .asset("BrandToss")
        case .stripe:
            return .asset("BrandStripe")
        case .threads:
            return .asset("BrandThreads")
        case .linear:
            return .asset("BrandLinear")
        case .jira:
            return .asset("BrandJira")
        case .confluence:
            return .asset("BrandConfluence")
        case .figma:
            return .asset("BrandFigma")
        case .cursor:
            return .asset("BrandCursor")
        case .claudeCode:
            return .asset("BrandClaude")
        case .codex:
            return .asset("BrandOpenAI")
        case .gmailEmail:
            return .asset("BrandGmail")
        case .calendarCalls:
            return .asset("BrandGoogleCalendar")
        case .formsSurvey:
            return .asset("BrandGoogleForms")
        case .slack:
            return .asset("BrandSlack")
        case .xTwitter:
            return .asset("BrandX")
        case .instagram:
            return .asset("BrandInstagram")
        case .youtubeLoomDemo:
            return .composite(["BrandYouTube", "BrandLoom"])
        case .metaAds:
            return .asset("BrandMeta")
        case .googleSearchConsole:
            return .asset("BrandGoogleSearchConsole")
        case .googleAnalyticsPlausible:
            return .composite(["BrandGoogleAnalytics", "BrandPlausible"])
        case .appStoreGooglePlay:
            return .composite(["BrandAppStoreConnect", "BrandGooglePlay"])
        case .reddit:
            return .asset("BrandReddit")
        case .sentry:
            return .asset("BrandSentry")
        case .vercel:
            return .asset("BrandVercel")
        case .cloudflare:
            return .asset("BrandCloudflare")
        case .neon:
            return .asset("BrandNeon")
        case .aws:
            return .asset("BrandAWS")
        case .revenueCat:
            return .asset("BrandRevenueCat")
        case .lemonSqueezy:
            return .asset("BrandLemonSqueezy")
        case .paddle:
            return .asset("BrandPaddle")
        case .gumroad:
            return .asset("BrandGumroad")
        case .lemonSqueezyPaddleGumroad:
            return .composite(["BrandLemonSqueezy", "BrandPaddle", "BrandGumroad"])
        case .localFolder,
             .nativeNotes,
             .interviewTxt,
             .workLogFolder,
             .interviewTranscriptFolder,
             .blogRss,
             .customUrl,
             .customLocalFileFolder,
             .customManualNote,
             .customCsvImport:
            return .symbol(fallbackSystemImage)
        }
    }
}

enum IntakeSourceStatus: String, Codable {
    case connected
    case connecting
    case disabled
    case error
    case notConnected = "not_connected"
}

struct IntakeSourceState: Codable, Hashable {
    var id: IntakeSourceID
    var status: IntakeSourceStatus
    var path: String?      // Local folder url, optional
    var detail: String?    // user-visible status detail
}

enum IntakeV2CommitmentLevel: String, Codable, CaseIterable, Hashable {
    case fullTimeSixHours = "full_time_6h"
    case dailyTwoToFour = "daily_2_4h"
    case dailyOneToTwo = "daily_1_2h"
    case weekendFocused = "weekend_focused"
    case irregular

    var displayTitle: String {
        switch self {
        case .fullTimeSixHours: return "전업으로 6시간 이상"
        case .dailyTwoToFour: return "매일 2~4시간"
        case .dailyOneToTwo: return "하루 1~2시간"
        case .weekendFocused: return "주말 위주"
        case .irregular: return "아직 불규칙해서 정리 중"
        }
    }

    var displayDescription: String {
        switch self {
        case .fullTimeSixHours: return "평일 대부분을 제품과 고객 검증에 씁니다"
        case .dailyTwoToFour: return "매일 고정된 깊은 작업 시간을 확보할 수 있습니다"
        case .dailyOneToTwo: return "작게 쪼갠 과제를 꾸준히 처리해야 합니다"
        case .weekendFocused: return "평일에는 기록만 남기고 주말에 실행을 몰아야 합니다"
        case .irregular: return "먼저 반복 가능한 시간표와 기록 루프를 잡아야 합니다"
        }
    }

    var workMode: OnboardingWorkMode {
        switch self {
        case .fullTimeSixHours: return .fullTimeSolo
        case .dailyTwoToFour, .dailyOneToTwo, .weekendFocused: return .sideProject
        case .irregular: return .exploring
        }
    }

    var customWorkMode: String {
        displayTitle
    }
}

extension OnboardingIsolationLevel {
    static let intakeV2EvidenceChoices: [OnboardingIsolationLevel] = [
        .workLog,
        .occasional,
        .weeklyLoop,
        .paymentResponses,
        .community,
    ]
}

// MARK: - IntakeStore (D3, D6)
// Owns the intake answers. Records (source list) lives in SourceManager.
// Records (source list) lives in SourceManager — see D1: Records is post-onboarding.

@MainActor
final class IntakeV2Store: ObservableObject {
    @Published var workmode: OnboardingWorkMode?
    @Published var role: OnboardingRole?
    @Published var stuck: OnboardingProjectStage?
    @Published var commitmentLevel: IntakeV2CommitmentLevel?
    @Published var evidenceLevels: [OnboardingIsolationLevel] = []
    @Published var folderURL: URL?
    @Published var completedAt: Date?

    static let stateDefaultsKey = "agentic30.intakeV2.state.v1"
    static let legacyStateDefaultsKey = "IntakeV2.state.v1"

    private let defaults: UserDefaults

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        restore()
    }

    // MARK: - Persistence (D6 critical gap: corruption recovery)
    // If decode fails, fall back to fresh state. Surface a flag so UI can prompt re-answer.

    @Published var restoreFailed: Bool = false

    private struct Snapshot: Codable {
        var workmode: OnboardingWorkMode?
        var role: OnboardingRole?
        var stuck: OnboardingProjectStage?
        var commitmentLevel: IntakeV2CommitmentLevel?
        var evidenceLevels: [OnboardingIsolationLevel]?
        var folderPath: String?
        var completedAt: Date?
    }

    private func restore() {
        var foundCorruptStorage = false
        for key in [Self.stateDefaultsKey, Self.legacyStateDefaultsKey] {
            guard let data = defaults.data(forKey: key) else { continue }
            do {
                let snap = try JSONDecoder().decode(Snapshot.self, from: data)
                self.workmode = snap.workmode
                self.role = snap.role
                self.stuck = snap.stuck
                self.commitmentLevel = snap.commitmentLevel
                if self.workmode == nil {
                    self.workmode = snap.commitmentLevel?.workMode
                }
                self.evidenceLevels = Self.normalizedEvidenceLevels(snap.evidenceLevels ?? [])
                if let path = snap.folderPath {
                    self.folderURL = URL(fileURLWithPath: path)
                }
                self.completedAt = snap.completedAt
                if key != Self.stateDefaultsKey {
                    defaults.set(data, forKey: Self.stateDefaultsKey)
                    defaults.removeObject(forKey: key)
                }
                return
            } catch {
                // Corrupt — wipe and surface the failure (eng D6 critical gap)
                defaults.removeObject(forKey: key)
                foundCorruptStorage = true
            }
        }
        self.restoreFailed = foundCorruptStorage
    }

    func persist() {
        let snap = Snapshot(
            workmode: workmode,
            role: role,
            stuck: stuck,
            commitmentLevel: commitmentLevel,
            evidenceLevels: evidenceLevels,
            folderPath: folderURL?.path,
            completedAt: completedAt
        )
        do {
            let data = try JSONEncoder().encode(snap)
            defaults.set(data, forKey: Self.stateDefaultsKey)
            defaults.removeObject(forKey: Self.legacyStateDefaultsKey)
        } catch {
            // Encoding should never fail for these primitives — log via PostHog elsewhere
        }
    }

    func reset() {
        workmode = nil
        role = nil
        stuck = nil
        commitmentLevel = nil
        evidenceLevels = []
        folderURL = nil
        completedAt = nil
        restoreFailed = false
        Self.clearPersistedDraft(defaults: defaults)
    }

    static func clearPersistedDraft(defaults: UserDefaults = .standard) {
        defaults.removeObject(forKey: stateDefaultsKey)
        defaults.removeObject(forKey: legacyStateDefaultsKey)
    }

    // MARK: - Step completion

    var isRoleComplete: Bool { role != nil }
    var isBlockerComplete: Bool { stuck != nil }
    var isCommitmentComplete: Bool { commitmentLevel != nil }
    var isEvidenceComplete: Bool { !evidenceLevels.isEmpty }
    var isFolderComplete: Bool { folderURL != nil }

    var isStep1Complete: Bool { isCommitmentComplete }
    var isStep2Complete: Bool { isRoleComplete }
    var isStep3Complete: Bool { isBlockerComplete }
    var isStep4Complete: Bool { isFolderComplete }

    var isFullyComplete: Bool {
        isRoleComplete && isBlockerComplete && isCommitmentComplete && isEvidenceComplete
    }

    func selectCommitmentLevel(_ level: IntakeV2CommitmentLevel) {
        commitmentLevel = level
        workmode = level.workMode
        persist()
    }

    func toggleEvidenceLevel(_ level: OnboardingIsolationLevel) {
        if level == .community {
            evidenceLevels = [.community]
            persist()
            return
        }

        var selected = Set(evidenceLevels)
        selected.remove(.community)
        if selected.contains(level) {
            selected.remove(level)
        } else {
            selected.insert(level)
        }
        evidenceLevels = Self.normalizedEvidenceLevels(Array(selected))
        persist()
    }

    func markCompleted() {
        completedAt = Date()
        persist()
    }

    static func normalizedEvidenceLevels(_ levels: [OnboardingIsolationLevel]) -> [OnboardingIsolationLevel] {
        let selected = Set(levels)
        if selected.contains(.community) {
            return [.community]
        }
        return OnboardingIsolationLevel.intakeV2EvidenceChoices.filter { selected.contains($0) }
    }
}

enum IntakeV2OnboardingContextMapper {
    @MainActor
    static func makeContext(from store: IntakeV2Store) -> OnboardingContext? {
        guard let role = store.role,
              let stuck = store.stuck,
              let commitmentLevel = store.commitmentLevel,
              !store.evidenceLevels.isEmpty else { return nil }

        let workMode = store.workmode ?? commitmentLevel.workMode
        let levels = isolationLevels(evidenceLevels: store.evidenceLevels, folderURL: store.folderURL)
        guard let primaryLevel = primaryIsolationLevel(from: levels, folderURL: store.folderURL) else {
            return nil
        }

        return OnboardingContext.make(
            customWorkMode: commitmentLevel.customWorkMode,
            workMode: workMode,
            role: role,
            projectStage: stuck,
            isolationLevel: primaryLevel,
            isolationLevels: levels
        )
    }

    static func isolationLevels(
        evidenceLevels: [OnboardingIsolationLevel],
        folderURL: URL?
    ) -> [OnboardingIsolationLevel] {
        var levels = IntakeV2Store.normalizedEvidenceLevels(evidenceLevels)
        if folderURL != nil {
            levels.append(.projectFolder)
        }
        return OnboardingIsolationLevel.allCases.filter { Set(levels).contains($0) }
    }

    private static func primaryIsolationLevel(
        from levels: [OnboardingIsolationLevel],
        folderURL: URL?
    ) -> OnboardingIsolationLevel? {
        if folderURL != nil, levels.contains(.projectFolder) {
            return .projectFolder
        }
        return levels.first
    }
}

// MARK: - SourceManager (D6, D1)
// Lives separately from IntakeStore. Records selection happens AFTER first Decide.
// Step 4 (folder pick) writes folderURL into IntakeStore; SourceManager auto-creates
// a local-folder source from it. Cloud sources are added via post-onboarding banner.

@MainActor
final class IntakeV2SourceManager: ObservableObject {
    @Published private(set) var sources: [IntakeSourceState] = []

    static let sourcesDefaultsKey = "agentic30.intakeV2.sources.v1"
    static let legacySourcesDefaultsKey = "IntakeV2.sources.v1"

    private let defaults: UserDefaults

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        restore()
    }

    private func restore() {
        for key in [Self.sourcesDefaultsKey, Self.legacySourcesDefaultsKey] {
            guard let data = defaults.data(forKey: key) else { continue }
            if let decoded = try? JSONDecoder().decode([IntakeSourceState].self, from: data) {
                let migrated = Self.migrateLegacyPaymentBundle(in: decoded)
                self.sources = migrated.sources
                if key != Self.sourcesDefaultsKey || migrated.didMigrate {
                    persist()
                }
                return
            } else {
                defaults.removeObject(forKey: key)
            }
        }
    }

    private static func migrateLegacyPaymentBundle(
        in decoded: [IntakeSourceState]
    ) -> (sources: [IntakeSourceState], didMigrate: Bool) {
        let replacementIDs: [IntakeSourceID] = [.lemonSqueezy, .paddle, .gumroad]
        var didMigrate = false
        var seen = Set<IntakeSourceID>()
        var migrated: [IntakeSourceState] = []

        for source in decoded {
            if source.id == .lemonSqueezyPaddleGumroad {
                didMigrate = true
                for id in replacementIDs where !seen.contains(id) {
                    migrated.append(
                        IntakeSourceState(
                            id: id,
                            status: source.status,
                            path: source.path,
                            detail: source.detail
                        )
                    )
                    seen.insert(id)
                }
            } else if !seen.contains(source.id) {
                migrated.append(source)
                seen.insert(source.id)
            }
        }

        return (migrated, didMigrate)
    }

    @discardableResult
    private func persist() -> Bool {
        if let data = try? JSONEncoder().encode(sources) {
            defaults.set(data, forKey: Self.sourcesDefaultsKey)
            defaults.removeObject(forKey: Self.legacySourcesDefaultsKey)
            return true
        }
        return false
    }

    // MARK: - Mutations

    func registerLocalFolder(_ url: URL, fileCount: Int? = nil) {
        let detail: String? = fileCount.map { "\($0) docs" }
        let state = IntakeSourceState(
            id: .localFolder,
            status: .connected,
            path: url.path,
            detail: detail
        )
        upsert(state)
    }

    func toggle(_ id: IntakeSourceID, to status: IntakeSourceStatus) {
        if let idx = sources.firstIndex(where: { $0.id == id }) {
            sources[idx].status = status
        } else {
            sources.append(IntakeSourceState(id: id, status: status, path: nil, detail: nil))
        }
        persist()
    }

    @discardableResult
    func addCatalogSources(_ ids: Set<IntakeSourceID>) -> Bool {
        for id in ids.sorted(by: { $0.rawValue < $1.rawValue }) {
            if let idx = sources.firstIndex(where: { $0.id == id }) {
                if sources[idx].status == .notConnected {
                    sources[idx].status = .disabled
                }
            } else {
                sources.append(IntakeSourceState(id: id, status: .disabled, path: nil, detail: nil))
            }
        }
        return persist()
    }

    func upsert(_ state: IntakeSourceState) {
        if let idx = sources.firstIndex(where: { $0.id == state.id }) {
            sources[idx] = state
            if state.id == .localFolder, idx != sources.startIndex {
                let local = sources.remove(at: idx)
                sources.insert(local, at: sources.startIndex)
            }
        } else {
            if state.id == .localFolder {
                sources.insert(state, at: sources.startIndex)
            } else {
                sources.append(state)
            }
        }
        persist()
    }

    func remove(_ id: IntakeSourceID) {
        sources.removeAll { $0.id == id }
        persist()
    }

    func status(of id: IntakeSourceID) -> IntakeSourceStatus {
        sources.first(where: { $0.id == id })?.status ?? .notConnected
    }

    var connectedCount: Int {
        sources.filter { $0.status == .connected }.count
    }

    var connectedSources: [IntakeSourceState] {
        sources.filter { $0.status == .connected }
    }
}
