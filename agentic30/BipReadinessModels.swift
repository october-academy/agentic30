import Foundation

// MARK: - Row IDs (canonical, matches BIP-READINESS-IPC.md)

enum BipReadinessRowId: String, Codable, CaseIterable {
    case localIcp = "localIcp"
    case localSpec = "localSpec"
    case localDesignSystem = "localDesignSystem"
    case localAdr = "localAdr"
    case localGoal = "localGoal"
    case localDocs = "localDocs"
    case localSheet = "localSheet"
    case googleSignIn = "googleSignIn"
    case workspace = "workspace"
    case gwsInstall = "gwsInstall"
    case gwsAuth = "gwsAuth"
    case docUrl = "docUrl"
    case sheetUrl = "sheetUrl"

    /// User-facing public execution setup steps.
    ///
    /// `googleSignIn` and `workspace` are still accepted from the sidecar as
    /// internal diagnostics, but the app login and project folder are owned by
    /// the welcome/onboarding flow and should not appear in the setup card.
    static let bipCoachSetupCases: [BipReadinessRowId] = [
        .localIcp,
        .localSpec,
        .localDesignSystem,
        .localAdr,
        .localGoal,
        .localDocs,
        .localSheet,
        .gwsInstall,
        .gwsAuth,
        .docUrl,
        .sheetUrl,
    ]
}

// MARK: - Row status

enum BipReadinessStatus: String, Codable {
    case pending = "pending"
    case inProgress = "in-progress"
    case done = "done"
    case blocked = "blocked"
}

// MARK: - Per-row error

struct BipReadinessError: Codable, Hashable {
    let userMessage: String
    let raw: String?
    let kind: BipReadinessErrorKind?

    enum CodingKeys: String, CodingKey {
        case userMessage = "user_message"
        case raw
        case kind
    }
}

enum BipReadinessErrorKind: String, Codable {
    case authExpired = "auth_expired"
    case permissionDenied = "permission_denied"
    case notFound = "not_found"
    case network = "network"
    case unknown = "unknown"
}

// MARK: - Per-row state

struct BipReadinessRow: Identifiable, Codable, Hashable {
    let id: BipReadinessRowId
    let status: BipReadinessStatus
    let detail: String?
    let log: String?
    let error: BipReadinessError?
    let resourceName: String?
    let resourceUrl: String?

    enum CodingKeys: String, CodingKey {
        case id
        case status
        case detail
        case log
        case error
        case resourceName
        case resourceUrl
    }

    init(
        id: BipReadinessRowId,
        status: BipReadinessStatus,
        detail: String?,
        log: String?,
        error: BipReadinessError?,
        resourceName: String? = nil,
        resourceUrl: String? = nil
    ) {
        self.id = id
        self.status = status
        self.detail = detail
        self.log = log
        self.error = error
        self.resourceName = resourceName
        self.resourceUrl = resourceUrl
    }
}

// MARK: - Full readiness state

struct BipReadinessState: Hashable {
    var rows: [BipReadinessRowId: BipReadinessRow]

    var allComplete: Bool {
        BipReadinessRowId.allCases.allSatisfy { rows[$0]?.status == .done }
    }

    var bipCoachSetupComplete: Bool {
        BipReadinessRowId.bipCoachSetupCases.allSatisfy { row($0).status == .done }
    }

    var hasBlockingBipCoachSetupIssue: Bool {
        BipReadinessRowId.bipCoachSetupCases.contains { row($0).status == .blocked }
    }

    func row(_ id: BipReadinessRowId) -> BipReadinessRow {
        rows[id] ?? BipReadinessRow(id: id, status: .pending, detail: nil, log: nil, error: nil)
    }

    static var loading: BipReadinessState {
        let pendingRows = BipReadinessRowId.allCases.map { rowId in
            BipReadinessRow(id: rowId, status: .pending, detail: nil, log: nil, error: nil)
        }
        return BipReadinessState(rows: Dictionary(uniqueKeysWithValues: pendingRows.map { ($0.id, $0) }))
    }
}

// MARK: - bip_token_expired event payload

struct BipTokenExpiredPayload: Decodable {
    let message: String
}
