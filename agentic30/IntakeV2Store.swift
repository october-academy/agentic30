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

    private let defaults: UserDefaults
    private let key = "IntakeV2.state.v1"

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
        guard let data = defaults.data(forKey: key) else { return }
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
        } catch {
            // Corrupt — wipe and surface the failure (eng D6 critical gap)
            defaults.removeObject(forKey: key)
            self.restoreFailed = true
        }
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
            defaults.set(data, forKey: key)
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
        defaults.removeObject(forKey: key)
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

    private let defaults: UserDefaults
    private let key = "IntakeV2.sources.v1"

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        restore()
    }

    private func restore() {
        guard let data = defaults.data(forKey: key) else { return }
        if let decoded = try? JSONDecoder().decode([IntakeSourceState].self, from: data) {
            self.sources = decoded
        } else {
            defaults.removeObject(forKey: key)
        }
    }

    private func persist() {
        if let data = try? JSONEncoder().encode(sources) {
            defaults.set(data, forKey: key)
        }
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
