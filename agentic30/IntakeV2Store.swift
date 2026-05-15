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
    case githubIssuesLinear = "github_issues_linear"
    case gmailEmail = "gmail_email"
    case calendarCalls = "calendar_calls"
    case formsSurvey = "forms_survey"
    case blogRss = "blog_rss"
    case xTwitter = "x_twitter"
    case youtubeLoomDemo = "youtube_loom_demo"
    case metaAds = "meta_ads"
    case googleAnalyticsPlausible = "google_analytics_plausible"
    case appStoreGooglePlay = "app_store_google_play"
    case revenueCat = "revenue_cat"
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
        case .githubIssuesLinear: return "GitHub Issues / Linear"
        case .gmailEmail: return "Gmail / Email"
        case .calendarCalls: return "Calendar / Calls"
        case .formsSurvey: return "Forms / Survey"
        case .blogRss: return "Blog / RSS"
        case .xTwitter: return "X / Twitter"
        case .youtubeLoomDemo: return "YouTube / Loom Demo"
        case .metaAds: return "Meta Ads"
        case .googleAnalyticsPlausible: return "Google Analytics / Plausible"
        case .appStoreGooglePlay: return "App Store Connect / Google Play"
        case .revenueCat: return "RevenueCat"
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
    case revenue = "Revenue"
    case custom = "Custom"
}

struct SourceCatalogItem: Identifiable, Hashable {
    let id: IntakeSourceID
    let category: IntakeSourceCatalogCategory
    let kind: String
    let why: String
    let systemImage: String
    let alreadyShownInMainGrid: Bool

    init(
        id: IntakeSourceID,
        category: IntakeSourceCatalogCategory,
        kind: String,
        why: String,
        systemImage: String,
        alreadyShownInMainGrid: Bool = false
    ) {
        self.id = id
        self.category = category
        self.kind = kind
        self.why = why
        self.systemImage = systemImage
        self.alreadyShownInMainGrid = alreadyShownInMainGrid
    }
}

enum IntakeSourceCatalog {
    static let builtInMainGridIDs: Set<IntakeSourceID> = [
        .localFolder,
        .github,
        .googleDocs,
        .googleSheets,
        .notion,
        .discord,
        .posthog,
        .toss,
        .stripe,
        .threads,
        .interviewTxt,
    ]

    static let items: [SourceCatalogItem] = [
        .init(id: .localFolder, category: .core, kind: "FILES", why: "코드, 문서, 설정을 읽어 프로젝트 맥락을 잡습니다.", systemImage: "folder.fill", alreadyShownInMainGrid: true),
        .init(id: .workLogFolder, category: .core, kind: "FILES · WORK LOG", why: "오늘 만든 것, 막힌 것, 배운 점을 다음 결정에 씁니다.", systemImage: "calendar.badge.clock"),
        .init(id: .interviewTranscriptFolder, category: .core, kind: "FILES · VOC", why: "txt, md, vtt, srt 인터뷰 기록에서 고객 발화를 뽑습니다.", systemImage: "text.quote"),
        .init(id: .githubIssuesLinear, category: .core, kind: "WORK · DECISIONS", why: "이슈와 로드맵에서 실제 우선순위 변화를 읽습니다.", systemImage: "checklist"),
        .init(id: .github, category: .core, kind: "REPO · CODE", why: "커밋과 코드 구조로 현재 제품 상태를 봅니다.", systemImage: "chevron.left.forwardslash.chevron.right", alreadyShownInMainGrid: true),
        .init(id: .interviewTxt, category: .voc, kind: "FILES · VOC", why: "단일 인터뷰 텍스트를 Foundation 질문 생성에 씁니다.", systemImage: "doc.plaintext.fill", alreadyShownInMainGrid: true),
        .init(id: .gmailEmail, category: .voc, kind: "COMM · VOC", why: "고객 답장, 가격 ask, waitlist 대화를 증거로 남깁니다.", systemImage: "envelope.fill"),
        .init(id: .calendarCalls, category: .voc, kind: "COMM · INTERVIEWS", why: "고객 미팅 일정과 콜 기록으로 실행 여부를 확인합니다.", systemImage: "calendar"),
        .init(id: .formsSurvey, category: .voc, kind: "VOC · DATA", why: "설문, 폼, CSV 응답에서 수요 신호를 정리합니다.", systemImage: "list.bullet.rectangle"),
        .init(id: .discord, category: .voc, kind: "COMM · VOC", why: "커뮤니티 대화에서 고객 언어와 반응을 찾습니다.", systemImage: "bubble.left.and.bubble.right.fill", alreadyShownInMainGrid: true),
        .init(id: .threads, category: .public, kind: "PUBLIC · VOC", why: "BIP 게시와 반응을 공개 실행 증거로 씁니다.", systemImage: "at", alreadyShownInMainGrid: true),
        .init(id: .blogRss, category: .public, kind: "PUBLIC · BIP", why: "블로그와 RSS 기록으로 공개 학습 흐름을 읽습니다.", systemImage: "dot.radiowaves.left.and.right"),
        .init(id: .xTwitter, category: .public, kind: "PUBLIC · VOC", why: "X/Twitter 반응과 공개 질문을 Launch 증거로 씁니다.", systemImage: "text.bubble.fill"),
        .init(id: .youtubeLoomDemo, category: .public, kind: "PUBLIC · DEMO", why: "데모 영상과 설명 링크를 첫 가치 경험 증거로 둡니다.", systemImage: "play.rectangle.fill"),
        .init(id: .posthog, category: .analytics, kind: "ANALYTICS", why: "사용, 전환, 퍼널 데이터를 Grow 판단에 씁니다.", systemImage: "chart.xyaxis.line", alreadyShownInMainGrid: true),
        .init(id: .metaAds, category: .analytics, kind: "ADS · DEMAND", why: "광고 지표로 메시지와 수요 검증을 분리합니다.", systemImage: "megaphone.fill"),
        .init(id: .googleAnalyticsPlausible, category: .analytics, kind: "ANALYTICS", why: "랜딩 유입과 첫 행동을 PostHog 외 경로로 봅니다.", systemImage: "chart.bar.xaxis"),
        .init(id: .appStoreGooglePlay, category: .analytics, kind: "STORE · LAUNCH", why: "스토어 노출, 설치, ASO 신호를 출시 증거로 씁니다.", systemImage: "square.grid.2x2.fill"),
        .init(id: .googleDocs, category: .core, kind: "CLOUD · DOCS", why: "업무일지와 프로젝트 문서를 코치 문맥에 넣습니다.", systemImage: "doc.text.fill", alreadyShownInMainGrid: true),
        .init(id: .googleSheets, category: .analytics, kind: "CLOUD · DATA", why: "일별 공개 기록과 지표를 표 형태로 누적합니다.", systemImage: "tablecells.fill", alreadyShownInMainGrid: true),
        .init(id: .notion, category: .core, kind: "CLOUD · NOTES", why: "노트와 문서 데이터베이스를 프로젝트 맥락으로 씁니다.", systemImage: "doc.richtext.fill", alreadyShownInMainGrid: true),
        .init(id: .stripe, category: .revenue, kind: "PAYMENT", why: "결제와 가격 ask 결과를 수익 증거로 봅니다.", systemImage: "creditcard.fill", alreadyShownInMainGrid: true),
        .init(id: .toss, category: .revenue, kind: "PAYMENT", why: "한국 결제 경로의 실제 구매 신호를 기록합니다.", systemImage: "wonsign.circle.fill", alreadyShownInMainGrid: true),
        .init(id: .revenueCat, category: .revenue, kind: "PAYMENT · MOBILE", why: "모바일 구독 전환과 paywall 실험을 추적합니다.", systemImage: "crown.fill"),
        .init(id: .lemonSqueezyPaddleGumroad, category: .revenue, kind: "PAYMENT", why: "1인 개발자 결제 채널의 첫 매출 신호를 둡니다.", systemImage: "cart.fill"),
        .init(id: .customUrl, category: .custom, kind: "CUSTOM · URL", why: "아직 catalog에 없는 웹 기록 위치를 직접 남깁니다.", systemImage: "link"),
        .init(id: .customLocalFileFolder, category: .custom, kind: "CUSTOM · FILES", why: "특정 파일이나 폴더를 source 후보로 표시합니다.", systemImage: "folder.badge.plus"),
        .init(id: .customManualNote, category: .custom, kind: "CUSTOM · NOTE", why: "수동으로 남긴 기록 위치나 설명을 추가합니다.", systemImage: "note.text"),
        .init(id: .customCsvImport, category: .custom, kind: "CUSTOM · CSV", why: "폼, 매출, 지표 CSV를 나중에 연결할 후보로 둡니다.", systemImage: "tablecells.badge.ellipsis"),
    ]

    static func item(for id: IntakeSourceID) -> SourceCatalogItem? {
        items.first { $0.id == id }
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

// MARK: - IntakeStore (D3, D6)
// Owns the 4 intake answers (workmode / role / stuck / folderURL).
// Records (source list) lives in SourceManager — see D1: Records is post-onboarding.

@MainActor
final class IntakeV2Store: ObservableObject {
    @Published var workmode: OnboardingWorkMode?
    @Published var role: OnboardingRole?
    @Published var stuck: OnboardingProjectStage?
    @Published var folderURL: URL?
    @Published var completedAt: Date?
    @Published var firstDecisionShown: Bool = false

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
        var folderPath: String?
        var completedAt: Date?
        var firstDecisionShown: Bool
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
                if let path = snap.folderPath {
                    self.folderURL = URL(fileURLWithPath: path)
                }
                self.completedAt = snap.completedAt
                self.firstDecisionShown = snap.firstDecisionShown
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
            folderPath: folderURL?.path,
            completedAt: completedAt,
            firstDecisionShown: firstDecisionShown
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
        folderURL = nil
        completedAt = nil
        firstDecisionShown = false
        restoreFailed = false
        defaults.removeObject(forKey: Self.stateDefaultsKey)
        defaults.removeObject(forKey: Self.legacyStateDefaultsKey)
    }

    // MARK: - Step completion

    var isStep1Complete: Bool { workmode != nil }
    var isStep2Complete: Bool { role != nil }
    var isStep3Complete: Bool { stuck != nil }
    var isStep4Complete: Bool { folderURL != nil }

    var isFullyComplete: Bool {
        isStep1Complete && isStep2Complete && isStep3Complete && isStep4Complete
    }

    func markCompleted() {
        completedAt = Date()
        persist()
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
                self.sources = decoded
                if key != Self.sourcesDefaultsKey {
                    defaults.set(data, forKey: Self.sourcesDefaultsKey)
                    defaults.removeObject(forKey: key)
                }
                return
            } else {
                defaults.removeObject(forKey: key)
            }
        }
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
