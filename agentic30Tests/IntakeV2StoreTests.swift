import XCTest
@testable import agentic30

@MainActor
final class IntakeV2StoreTests: XCTestCase {

    private var suiteDefaults: UserDefaults!
    private let suiteName = "IntakeV2StoreTests.\(UUID().uuidString)"

    override func setUp() {
        super.setUp()
        suiteDefaults = UserDefaults(suiteName: suiteName)
        suiteDefaults.removePersistentDomain(forName: suiteName)
    }

    override func tearDown() {
        suiteDefaults.removePersistentDomain(forName: suiteName)
        suiteDefaults = nil
        super.tearDown()
    }

    func test_initialState_isEmpty() {
        let store = IntakeV2Store(defaults: suiteDefaults)
        XCTAssertNil(store.workmode)
        XCTAssertNil(store.role)
        XCTAssertNil(store.stuck)
        XCTAssertNil(store.commitmentLevel)
        XCTAssertEqual(store.evidenceLevels, [])
        XCTAssertNil(store.folderURL)
        XCTAssertFalse(store.isFullyComplete)
        XCTAssertFalse(store.restoreFailed)
    }

    func test_setAnswers_persistsAcrossInstances() {
        let store1 = IntakeV2Store(defaults: suiteDefaults)
        store1.selectCommitmentLevel(.fullTimeSixHours)
        store1.role = .marketerBusiness
        store1.stuck = .ideaOnly
        store1.toggleEvidenceLevel(.workLog)
        store1.toggleEvidenceLevel(.paymentResponses)
        store1.folderURL = URL(fileURLWithPath: "/Users/test/Projects")
        store1.persist()
        XCTAssertNotNil(suiteDefaults.data(forKey: IntakeV2Store.stateDefaultsKey))
        XCTAssertNil(suiteDefaults.data(forKey: IntakeV2Store.legacyStateDefaultsKey))

        let store2 = IntakeV2Store(defaults: suiteDefaults)
        XCTAssertEqual(store2.workmode, .fullTimeSolo)
        XCTAssertEqual(store2.commitmentLevel, .fullTimeSixHours)
        XCTAssertEqual(store2.role, .marketerBusiness)
        XCTAssertEqual(store2.stuck, .ideaOnly)
        XCTAssertEqual(store2.evidenceLevels, [.workLog, .paymentResponses])
        XCTAssertEqual(store2.folderURL?.path, "/Users/test/Projects")
    }

    func test_onboardingRoleChoices_excludeLegacyStudentStatus() {
        XCTAssertEqual(
            OnboardingRole.onboardingChoices,
            [.developer, .designer, .productManager, .marketerBusiness, .generalist]
        )
        XCTAssertFalse(OnboardingRole.onboardingChoices.contains(.student))
        XCTAssertTrue(OnboardingRole.allCases.contains(.student))
    }

    func test_stepCompletion_flags() {
        let store = IntakeV2Store(defaults: suiteDefaults)
        XCTAssertFalse(store.isRoleComplete)
        store.role = .designer
        XCTAssertTrue(store.isRoleComplete)
        XCTAssertFalse(store.isFullyComplete)
        store.stuck = .building
        store.selectCommitmentLevel(.dailyTwoToFour)
        store.toggleEvidenceLevel(.community)
        XCTAssertTrue(store.isFullyComplete)
        store.folderURL = URL(fileURLWithPath: "/tmp/work")
        XCTAssertTrue(store.isFolderComplete)
        XCTAssertTrue(store.isFullyComplete)
    }

    func test_evidenceCommunity_isExclusive() {
        let store = IntakeV2Store(defaults: suiteDefaults)
        store.toggleEvidenceLevel(.workLog)
        store.toggleEvidenceLevel(.paymentResponses)
        XCTAssertEqual(store.evidenceLevels, [.workLog, .paymentResponses])

        store.toggleEvidenceLevel(.community)
        XCTAssertEqual(store.evidenceLevels, [.community])

        store.toggleEvidenceLevel(.occasional)
        XCTAssertEqual(store.evidenceLevels, [.occasional])
    }

    func test_onboardingContextMapper_combinesEvidenceAndFolder() {
        let store = IntakeV2Store(defaults: suiteDefaults)
        store.role = .developer
        store.stuck = .firstUsers
        store.selectCommitmentLevel(.dailyOneToTwo)
        store.toggleEvidenceLevel(.workLog)
        store.toggleEvidenceLevel(.paymentResponses)
        store.folderURL = URL(fileURLWithPath: "/tmp/work")

        let context = IntakeV2OnboardingContextMapper.makeContext(from: store)

        XCTAssertEqual(context?.workMode, .sideProject)
        XCTAssertEqual(context?.customWorkMode, "하루 1~2시간")
        XCTAssertEqual(context?.isolationLevel, .projectFolder)
        XCTAssertEqual(Set(context?.isolationLevels ?? []), Set([.projectFolder, .workLog, .paymentResponses]))
    }

    func test_onboardingContextMapper_requiresEvidenceButNotFolder() {
        let store = IntakeV2Store(defaults: suiteDefaults)
        store.role = .developer
        store.stuck = .ideaOnly
        store.selectCommitmentLevel(.irregular)
        XCTAssertNil(IntakeV2OnboardingContextMapper.makeContext(from: store))

        store.toggleEvidenceLevel(.community)
        let context = IntakeV2OnboardingContextMapper.makeContext(from: store)

        XCTAssertEqual(context?.workMode, .exploring)
        XCTAssertEqual(context?.isolationLevel, .community)
        XCTAssertEqual(context?.isolationLevels, [.community])
    }

    func test_corruptStorage_surfacesRestoreFailedFlag() {
        // Inject garbage at the storage key
        suiteDefaults.set(Data([0xFF, 0xFE, 0xFD]), forKey: IntakeV2Store.stateDefaultsKey)
        let store = IntakeV2Store(defaults: suiteDefaults)
        XCTAssertTrue(store.restoreFailed, "corrupt UserDefaults should set restoreFailed=true (eng D6 critical gap)")
        XCTAssertNil(store.workmode)
        XCTAssertNil(store.role)
        XCTAssertNil(store.stuck)
        XCTAssertNil(store.commitmentLevel)
        XCTAssertEqual(store.evidenceLevels, [])
    }

    func test_legacyStorage_migratesToAgentic30Namespace() throws {
        let data = try XCTUnwrap("""
        {"workmode":"full_time_solo","role":"developer","stuck":"idea_only","folderPath":"/tmp/legacy","firstDecisionShown":false}
        """.data(using: .utf8))
        suiteDefaults.set(data, forKey: IntakeV2Store.legacyStateDefaultsKey)

        let store = IntakeV2Store(defaults: suiteDefaults)

        XCTAssertEqual(store.workmode, .fullTimeSolo)
        XCTAssertNil(store.commitmentLevel)
        XCTAssertEqual(store.evidenceLevels, [])
        XCTAssertEqual(store.role, .developer)
        XCTAssertEqual(store.stuck, .ideaOnly)
        XCTAssertEqual(store.folderURL?.path, "/tmp/legacy")
        XCTAssertNotNil(suiteDefaults.data(forKey: IntakeV2Store.stateDefaultsKey))
        XCTAssertNil(suiteDefaults.data(forKey: IntakeV2Store.legacyStateDefaultsKey))
    }

    func test_reset_clearsStateAndStorage() {
        let store = IntakeV2Store(defaults: suiteDefaults)
        store.selectCommitmentLevel(.weekendFocused)
        store.toggleEvidenceLevel(.weeklyLoop)
        store.persist()
        suiteDefaults.set(Data([0x01]), forKey: IntakeV2Store.legacyStateDefaultsKey)
        store.reset()
        XCTAssertNil(store.workmode)
        XCTAssertNil(store.commitmentLevel)
        XCTAssertEqual(store.evidenceLevels, [])
        XCTAssertNil(suiteDefaults.data(forKey: IntakeV2Store.stateDefaultsKey))
        XCTAssertNil(suiteDefaults.data(forKey: IntakeV2Store.legacyStateDefaultsKey))

        let fresh = IntakeV2Store(defaults: suiteDefaults)
        XCTAssertNil(fresh.workmode)
        XCTAssertNil(fresh.commitmentLevel)
        XCTAssertEqual(fresh.evidenceLevels, [])
    }

    func test_clearPersistedDraft_removesOnlyIntakeDraftKeys() {
        suiteDefaults.set(Data([0x01]), forKey: IntakeV2Store.stateDefaultsKey)
        suiteDefaults.set(Data([0x02]), forKey: IntakeV2Store.legacyStateDefaultsKey)
        suiteDefaults.set(Data([0x03]), forKey: IntakeV2SourceManager.sourcesDefaultsKey)
        suiteDefaults.set("/tmp/workspace", forKey: "agentic30.workspaceRoot")

        IntakeV2Store.clearPersistedDraft(defaults: suiteDefaults)

        XCTAssertNil(suiteDefaults.data(forKey: IntakeV2Store.stateDefaultsKey))
        XCTAssertNil(suiteDefaults.data(forKey: IntakeV2Store.legacyStateDefaultsKey))
        XCTAssertEqual(suiteDefaults.data(forKey: IntakeV2SourceManager.sourcesDefaultsKey), Data([0x03]))
        XCTAssertEqual(suiteDefaults.string(forKey: "agentic30.workspaceRoot"), "/tmp/workspace")
    }

    func test_markCompleted_setsTimestamp() {
        let store = IntakeV2Store(defaults: suiteDefaults)
        XCTAssertNil(store.completedAt)
        store.markCompleted()
        XCTAssertNotNil(store.completedAt)
        XCTAssertLessThan(abs(store.completedAt!.timeIntervalSinceNow), 5)
    }
}

final class IntakeSourceCatalogTests: XCTestCase {

    func test_addableItems_excludesBuiltInMainGridSources() {
        let addableIDs = Set(IntakeSourceCatalog.addableItems.map(\.id))

        XCTAssertEqual(
            Set(IntakeSourceCatalog.mainGridIDs),
            IntakeSourceCatalog.builtInMainGridIDs,
            "The built-in set should be derived from the ordered main grid source list."
        )
        XCTAssertEqual(
            IntakeSourceCatalog.mainGridIDs.count,
            IntakeSourceCatalog.builtInMainGridIDs.count,
            "Main grid source order should not contain duplicates."
        )
        XCTAssertTrue(
            addableIDs.isDisjoint(with: IntakeSourceCatalog.builtInMainGridIDs),
            "Add Source catalog candidates should not include sources already shown in the main grid."
        )
    }

    func test_linearSource_keepsLegacyRawValueWithoutGitHubCopy() throws {
        let data = try XCTUnwrap("\"github_issues_linear\"".data(using: .utf8))
        let decoded = try JSONDecoder().decode(IntakeSourceID.self, from: data)
        let item = try XCTUnwrap(IntakeSourceCatalog.item(for: .linear))
        let searchableCopy = [
            item.id.displayName,
            item.kind,
            item.why,
            item.category.rawValue,
        ].joined(separator: " ")

        XCTAssertEqual(decoded, .linear)
        XCTAssertEqual(IntakeSourceID.linear.rawValue, "github_issues_linear")
        XCTAssertEqual(IntakeSourceID.linear.displayName, "Linear")
        XCTAssertTrue(searchableCopy.localizedCaseInsensitiveContains("Linear"))
        XCTAssertFalse(searchableCopy.localizedCaseInsensitiveContains("GitHub"))
    }

    func test_aiInfraCatalogSources_areAddableSearchableAndNotBuiltIn() throws {
        let expectedItems: [(id: IntakeSourceID, category: IntakeSourceCatalogCategory, kind: String)] = [
            (.jira, .core, "WORK · ROADMAP"),
            (.confluence, .core, "DOCS · KNOWLEDGE"),
            (.slack, .voc, "COMM · TEAM"),
            (.sentry, .infra, "OBSERVABILITY"),
            (.vercel, .infra, "DEPLOY · WEB"),
            (.cloudflare, .infra, "EDGE · PLATFORM"),
            (.neon, .infra, "DATABASE · POSTGRES"),
        ]
        let addableIDs = Set(IntakeSourceCatalog.addableItems.map(\.id))

        for expected in expectedItems {
            let item = try XCTUnwrap(IntakeSourceCatalog.item(for: expected.id))
            let searchCopy = [
                item.id.displayName,
                item.kind,
                item.why,
                item.category.rawValue,
            ].joined(separator: " ")

            XCTAssertTrue(addableIDs.contains(expected.id))
            XCTAssertFalse(IntakeSourceCatalog.builtInMainGridIDs.contains(expected.id))
            XCTAssertEqual(item.category, expected.category)
            XCTAssertEqual(item.kind, expected.kind)
            XCTAssertTrue(searchCopy.localizedCaseInsensitiveContains(expected.id.displayName))
        }
    }

    func test_mainGridToolSources_areSearchableAndExcludedFromAddSourceCatalog() throws {
        let expectedItems: [
            (id: IntakeSourceID, displayName: String, category: IntakeSourceCatalogCategory, kind: String, searchTerms: [String])
        ] = [
            (.figma, "Figma", .core, "DESIGN · SPEC", ["Figma", "DESIGN", "Dev Mode"]),
            (.cursor, "Cursor", .core, "AI · EDITOR", ["Cursor", "AI", "EDITOR"]),
            (.claudeCode, "Claude Code", .core, "AI · CODE", ["Claude Code", "AI", "CODE"]),
            (.codex, "Codex", .core, "AI · CODE", ["Codex", "AI", "CODE"]),
            (.nativeNotes, "iOS/macOS Native / Notes", .core, "NATIVE · NOTES", ["iOS", "macOS", "Notes"]),
            (.xTwitter, "X / Twitter", .public, "PUBLIC · VOC", ["X/Twitter", "PUBLIC", "Launch"]),
            (.instagram, "Instagram", .public, "PUBLIC · VOC", ["Instagram", "PUBLIC", "VOC"]),
            (.googleSearchConsole, "Google Search Console", .analytics, "SEARCH · AEO", ["Google Search Console", "AEO", "Analytics"]),
            (.aws, "AWS", .infra, "CLOUD · AWS", ["AWS", "CLOUD", "Infra"]),
        ]
        let addableIDs = Set(IntakeSourceCatalog.addableItems.map(\.id))
        let mainGridIDs = Set(IntakeSourceCatalog.mainGridIDs)

        for expected in expectedItems {
            let item = try XCTUnwrap(IntakeSourceCatalog.item(for: expected.id))
            let searchCopy = [
                item.id.displayName,
                item.kind,
                item.why,
                item.category.rawValue,
            ].joined(separator: " ")

            XCTAssertTrue(mainGridIDs.contains(expected.id))
            XCTAssertFalse(addableIDs.contains(expected.id))
            XCTAssertEqual(item.id.displayName, expected.displayName)
            XCTAssertEqual(item.category, expected.category)
            XCTAssertEqual(item.kind, expected.kind)
            for term in expected.searchTerms {
                XCTAssertTrue(
                    searchCopy.localizedCaseInsensitiveContains(term),
                    "\(expected.displayName) should be searchable by \(term)"
                )
            }
        }
    }

    func test_geoAeoCatalogSources_areAddableSearchableAndNotBuiltIn() throws {
        let expectedItems: [
            (id: IntakeSourceID, displayName: String, category: IntakeSourceCatalogCategory, kind: String, searchTerms: [String])
        ] = [
            (
                .reddit,
                "Reddit",
                .public,
                "PUBLIC · COMMUNITY",
                ["Reddit", "PUBLIC", "Community"]
            ),
            (
                .youtubeLoomDemo,
                "YouTube",
                .public,
                "PUBLIC · VIDEO",
                ["YouTube", "PUBLIC", "AI citation"]
            ),
        ]
        let addableIDs = Set(IntakeSourceCatalog.addableItems.map(\.id))

        for expected in expectedItems {
            let item = try XCTUnwrap(IntakeSourceCatalog.item(for: expected.id))
            let searchCopy = [
                item.id.displayName,
                item.kind,
                item.why,
                item.category.rawValue,
            ].joined(separator: " ")

            XCTAssertTrue(addableIDs.contains(expected.id))
            XCTAssertFalse(IntakeSourceCatalog.builtInMainGridIDs.contains(expected.id))
            XCTAssertEqual(item.id.displayName, expected.displayName)
            XCTAssertEqual(item.category, expected.category)
            XCTAssertEqual(item.kind, expected.kind)
            for term in expected.searchTerms {
                XCTAssertTrue(
                    searchCopy.localizedCaseInsensitiveContains(term),
                    "\(expected.displayName) should be searchable by \(term)"
                )
            }
        }
    }

    func test_revenuePaymentCatalogSources_areSeparatedAddableAndSearchable() throws {
        let expectedItems: [
            (id: IntakeSourceID, displayName: String, category: IntakeSourceCatalogCategory, kind: String, searchTerms: [String])
        ] = [
            (.lemonSqueezy, "Lemon Squeezy", .revenue, "PAYMENT", ["Lemon Squeezy", "Revenue", "PAYMENT"]),
            (.paddle, "Paddle", .revenue, "PAYMENT", ["Paddle", "Revenue", "PAYMENT"]),
            (.gumroad, "Gumroad", .revenue, "PAYMENT", ["Gumroad", "Revenue", "PAYMENT"]),
        ]
        let addableIDs = Set(IntakeSourceCatalog.addableItems.map(\.id))

        XCTAssertNil(
            IntakeSourceCatalog.item(for: .lemonSqueezyPaddleGumroad),
            "The legacy bundled payment source should not be shown in the catalog."
        )

        for expected in expectedItems {
            let item = try XCTUnwrap(IntakeSourceCatalog.item(for: expected.id))
            let searchCopy = [
                item.id.displayName,
                item.kind,
                item.why,
                item.category.rawValue,
            ].joined(separator: " ")

            XCTAssertTrue(addableIDs.contains(expected.id))
            XCTAssertFalse(IntakeSourceCatalog.builtInMainGridIDs.contains(expected.id))
            XCTAssertEqual(item.id.displayName, expected.displayName)
            XCTAssertEqual(item.category, expected.category)
            XCTAssertEqual(item.kind, expected.kind)
            for term in expected.searchTerms {
                XCTAssertTrue(
                    searchCopy.localizedCaseInsensitiveContains(term),
                    "\(expected.displayName) should be searchable by \(term)"
                )
            }
        }
    }

    func test_sourceIconCatalog_mapsBrandBackedSourcesToOfficialAssets() {
        let expected: [IntakeSourceID: IntakeSourceIconKind] = [
            .linear: .asset("BrandLinear"),
            .jira: .asset("BrandJira"),
            .confluence: .asset("BrandConfluence"),
            .figma: .asset("BrandFigma"),
            .cursor: .asset("BrandCursor"),
            .claudeCode: .asset("BrandClaude"),
            .codex: .asset("BrandOpenAI"),
            .gmailEmail: .asset("BrandGmail"),
            .calendarCalls: .asset("BrandGoogleCalendar"),
            .formsSurvey: .asset("BrandGoogleForms"),
            .slack: .asset("BrandSlack"),
            .xTwitter: .asset("BrandX"),
            .instagram: .asset("BrandInstagram"),
            .reddit: .asset("BrandReddit"),
            .youtubeLoomDemo: .composite(["BrandYouTube", "BrandLoom"]),
            .metaAds: .asset("BrandMeta"),
            .googleSearchConsole: .asset("BrandGoogleSearchConsole"),
            .googleAnalyticsPlausible: .composite(["BrandGoogleAnalytics", "BrandPlausible"]),
            .appStoreGooglePlay: .composite(["BrandAppStoreConnect", "BrandGooglePlay"]),
            .sentry: .asset("BrandSentry"),
            .vercel: .asset("BrandVercel"),
            .cloudflare: .asset("BrandCloudflare"),
            .neon: .asset("BrandNeon"),
            .aws: .asset("BrandAWS"),
            .revenueCat: .asset("BrandRevenueCat"),
            .lemonSqueezy: .asset("BrandLemonSqueezy"),
            .paddle: .asset("BrandPaddle"),
            .gumroad: .asset("BrandGumroad"),
        ]
        let catalogIDs = Set(IntakeSourceCatalog.items.map(\.id))

        for (id, expectedIcon) in expected {
            XCTAssertTrue(catalogIDs.contains(id), "\(id.rawValue) should stay in the source catalog.")
            XCTAssertEqual(IntakeSourceIconCatalog.iconKind(for: id, fallbackSystemImage: "fallback"), expectedIcon)
            XCTAssertTrue(IntakeSourceIconCatalog.iconKind(for: id, fallbackSystemImage: "fallback").isBrandBacked)
        }
    }

    func test_sourceIconCatalog_keepsGenericSourcesOnSymbolFallbacks() throws {
        let genericSourceIDs: [IntakeSourceID] = [
            .localFolder,
            .nativeNotes,
            .interviewTxt,
            .workLogFolder,
            .interviewTranscriptFolder,
            .blogRss,
            .customUrl,
            .customLocalFileFolder,
            .customManualNote,
            .customCsvImport,
        ]

        for id in genericSourceIDs {
            let item = try XCTUnwrap(IntakeSourceCatalog.item(for: id))
            XCTAssertEqual(
                IntakeSourceIconCatalog.iconKind(for: id, fallbackSystemImage: item.systemImage),
                .symbol(item.systemImage)
            )
        }
    }
}

@MainActor
final class IntakeV2SourceManagerTests: XCTestCase {

    private var suiteDefaults: UserDefaults!
    private let suiteName = "IntakeV2SourceManagerTests.\(UUID().uuidString)"

    override func setUp() {
        super.setUp()
        suiteDefaults = UserDefaults(suiteName: suiteName)
        suiteDefaults.removePersistentDomain(forName: suiteName)
    }

    override func tearDown() {
        suiteDefaults.removePersistentDomain(forName: suiteName)
        suiteDefaults = nil
        super.tearDown()
    }

    func test_registerLocalFolder_addsConnectedSource() {
        let mgr = IntakeV2SourceManager(defaults: suiteDefaults)
        XCTAssertEqual(mgr.sources.count, 0)
        mgr.registerLocalFolder(URL(fileURLWithPath: "/tmp/x"), fileCount: 42)
        XCTAssertEqual(mgr.connectedCount, 1)
        XCTAssertEqual(mgr.status(of: .localFolder), .connected)
    }

    func test_onboardingWorkspaceRequestStore_loadsLatestValidPendingRequest() throws {
        let appSupport = FileManager.default.temporaryDirectory
            .appendingPathComponent("agentic30-request-store-\(UUID().uuidString)", isDirectory: true)
        let workspace = FileManager.default.temporaryDirectory
            .appendingPathComponent("agentic30-workspace-\(UUID().uuidString)", isDirectory: true)
        let requestsDir = appSupport
            .appendingPathComponent(OnboardingWorkspaceRequestStore.requestsDirectoryName, isDirectory: true)
        try FileManager.default.createDirectory(at: workspace, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: requestsDir, withIntermediateDirectories: true)
        defer {
            try? FileManager.default.removeItem(at: appSupport)
            try? FileManager.default.removeItem(at: workspace)
        }

        let older = """
        {
          "id": "req_old",
          "path": "\(workspace.path)",
          "basename": "\(workspace.lastPathComponent)",
          "source": "cursor",
          "createdAt": "2026-05-28T00:00:00.000Z",
          "expiresAt": "2026-05-28T00:30:00.000Z",
          "usedCwd": true,
          "status": "pending"
        }
        """
        let newer = """
        {
          "id": "req_new",
          "path": "\(workspace.path)",
          "basename": "\(workspace.lastPathComponent)",
          "source": "codex",
          "createdAt": "2026-05-28T00:10:00.000Z",
          "expiresAt": "2026-05-28T00:40:00.000Z",
          "usedCwd": false,
          "status": "pending"
        }
        """
        try older.data(using: .utf8)?.write(to: requestsDir.appendingPathComponent("old.json"))
        try newer.data(using: .utf8)?.write(to: requestsDir.appendingPathComponent("new.json"))

        var store = OnboardingWorkspaceRequestStore(appSupportURL: appSupport)
        store.now = { ISO8601DateFormatter().date(from: "2026-05-28T00:20:00Z")! }

        let request = store.latestPendingRequest()

        XCTAssertEqual(request?.id, "req_new")
        XCTAssertEqual(request?.source, "codex")
        XCTAssertEqual(request?.url.path, workspace.path)
    }

    func test_onboardingWorkspaceRequestStore_ignoresExpiredMissingAndRejectedRequests() throws {
        let appSupport = FileManager.default.temporaryDirectory
            .appendingPathComponent("agentic30-request-store-\(UUID().uuidString)", isDirectory: true)
        let requestsDir = appSupport
            .appendingPathComponent(OnboardingWorkspaceRequestStore.requestsDirectoryName, isDirectory: true)
        try FileManager.default.createDirectory(at: requestsDir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: appSupport) }

        let expired = """
        {
          "id": "req_expired",
          "path": "/tmp/missing-agentic30-workspace",
          "basename": "missing-agentic30-workspace",
          "source": "unknown",
          "createdAt": "2026-05-28T00:00:00.000Z",
          "expiresAt": "2026-05-28T00:01:00.000Z",
          "usedCwd": true,
          "status": "pending"
        }
        """
        let rejected = """
        {
          "id": "req_rejected",
          "path": "/tmp",
          "basename": "tmp",
          "source": "unknown",
          "createdAt": "2026-05-28T00:02:00.000Z",
          "expiresAt": "2026-05-28T00:40:00.000Z",
          "usedCwd": true,
          "status": "rejected"
        }
        """
        try expired.data(using: .utf8)?.write(to: requestsDir.appendingPathComponent("expired.json"))
        try rejected.data(using: .utf8)?.write(to: requestsDir.appendingPathComponent("rejected.json"))

        var store = OnboardingWorkspaceRequestStore(appSupportURL: appSupport)
        store.now = { ISO8601DateFormatter().date(from: "2026-05-28T00:20:00Z")! }

        XCTAssertNil(store.latestPendingRequest())
    }

    func test_onboardingWorkspaceRequestStore_removesConsumedRequest() throws {
        let appSupport = FileManager.default.temporaryDirectory
            .appendingPathComponent("agentic30-request-store-\(UUID().uuidString)", isDirectory: true)
        let requestsDir = appSupport
            .appendingPathComponent(OnboardingWorkspaceRequestStore.requestsDirectoryName, isDirectory: true)
        try FileManager.default.createDirectory(at: requestsDir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: appSupport) }

        let requestURL = requestsDir.appendingPathComponent("req_done.json")
        try Data("{}".utf8).write(to: requestURL)

        OnboardingWorkspaceRequestStore(appSupportURL: appSupport).removeRequest(id: "req_done")

        XCTAssertFalse(FileManager.default.fileExists(atPath: requestURL.path))
    }

    func test_onboardingPromptIncludesHelperAndCliInstructions() {
        let prompt = IntakeV2FolderPickView.agentWorkspaceRegistrationPrompt(token: "test-token-123")
        let helperPath = OnboardingHelperInstaller().helperURL.path

        XCTAssertTrue(prompt.contains(helperPath))
        XCTAssertTrue(prompt.contains("--register"))
        XCTAssertTrue(prompt.contains("--path"))
        XCTAssertTrue(prompt.contains("--token"))
        XCTAssertTrue(prompt.contains("프로젝트 파일은 수정되지 않습니다"))
        XCTAssertTrue(prompt.contains("프로젝트 파일을 읽거나, 스캔하거나, 수정하지 마"))

        // Negative: 잔존 MCP 표현이 prompt 본문에서 사라졌어야 함
        XCTAssertFalse(prompt.contains("claude mcp add"))
        XCTAssertFalse(prompt.contains(".cursor/mcp.json"))
        XCTAssertFalse(prompt.contains("codex mcp add"))
        XCTAssertFalse(prompt.contains("full Agentic30 MCP"))
        XCTAssertFalse(prompt.contains("jsonrpc"))
        XCTAssertFalse(prompt.contains("register_current_project_workspace"))
    }

    func test_agentWorkspaceRegistrationPromptInjectsOnboardingToken() {
        let token = "nonce-\(UUID().uuidString)"
        let prompt = IntakeV2FolderPickView.agentWorkspaceRegistrationPrompt(token: token)
        XCTAssertTrue(prompt.contains(token), "Issued onboarding token should be embedded in the prompt for the AI agent")
    }

    func test_onboardingNonceStore_rotateAndCurrentTokenRoundTrip() throws {
        let appSupport = FileManager.default.temporaryDirectory
            .appendingPathComponent("agentic30-nonce-store-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: appSupport, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: appSupport) }

        var store = OnboardingNonceStore(appSupportURL: appSupport)
        let issued = try store.rotateAndIssue()
        XCTAssertFalse(issued.isEmpty)
        XCTAssertEqual(store.currentToken(), issued)

        let rotated = try store.rotateAndIssue()
        XCTAssertNotEqual(rotated, issued, "Rotation should yield a new token")
        XCTAssertEqual(store.currentToken(), rotated)
    }

    func test_onboardingNonceStore_currentTokenReturnsNilAfterExpiry() throws {
        let appSupport = FileManager.default.temporaryDirectory
            .appendingPathComponent("agentic30-nonce-store-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: appSupport, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: appSupport) }

        var store = OnboardingNonceStore(appSupportURL: appSupport)
        let issuedAt = Date(timeIntervalSince1970: 1_700_000_000)
        store.now = { issuedAt }
        _ = try store.rotateAndIssue()

        store.now = { issuedAt.addingTimeInterval(OnboardingNonceStore.tokenTTL + 1) }
        XCTAssertNil(store.currentToken(), "Expired token must not be returned")
    }

    func test_onboardingNonceStore_invalidateRemovesFile() throws {
        let appSupport = FileManager.default.temporaryDirectory
            .appendingPathComponent("agentic30-nonce-store-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: appSupport, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: appSupport) }

        let store = OnboardingNonceStore(appSupportURL: appSupport)
        _ = try store.rotateAndIssue()
        XCTAssertNotNil(store.currentToken())

        store.invalidate()
        XCTAssertNil(store.currentToken())
        XCTAssertFalse(
            FileManager.default.fileExists(atPath: appSupport.appendingPathComponent(OnboardingNonceStore.fileName).path)
        )
    }

    func test_onboardingHelperShellQuoteEscapesSingleQuotes() {
        XCTAssertEqual(
            OnboardingHelperInstaller.shellQuote("/tmp/Agentic30's Helper"),
            "'/tmp/Agentic30'\\''s Helper'"
        )
    }

    private func makeStubNodeResolver(nodePath: String) -> NodeExecutableResolver {
        NodeExecutableResolver(
            environment: ["NODE_BINARY": nodePath],
            homeDirectory: "/tmp",
            shellLookup: { nil },
            isExecutable: { $0 == nodePath },
            directoryContentsProvider: { _ in [] }
        )
    }

    func test_onboardingHelperInstaller_writesExecutableWrapper() throws {
        let appSupport = FileManager.default.temporaryDirectory
            .appendingPathComponent("agentic30-helper-installer-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: appSupport, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: appSupport) }

        let nodePath = "/tmp/stub/node-\(UUID().uuidString)"
        let installer = OnboardingHelperInstaller(
            appSupportURL: appSupport,
            nodeResolver: makeStubNodeResolver(nodePath: nodePath)
        )

        let helperURL = try installer.installOrRefresh()
        XCTAssertEqual(helperURL, installer.helperURL)
        XCTAssertTrue(FileManager.default.fileExists(atPath: helperURL.path))

        let attrs = try FileManager.default.attributesOfItem(atPath: helperURL.path)
        XCTAssertEqual(attrs[.posixPermissions] as? NSNumber, NSNumber(value: 0o755))
    }

    func test_onboardingHelperInstaller_wrapperReferencesNonceAndSidecarPaths() throws {
        let appSupport = FileManager.default.temporaryDirectory
            .appendingPathComponent("agentic30-helper-installer-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: appSupport, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: appSupport) }

        let nodePath = "/tmp/stub/node-\(UUID().uuidString)"
        let installer = OnboardingHelperInstaller(
            appSupportURL: appSupport,
            nodeResolver: makeStubNodeResolver(nodePath: nodePath)
        )

        let helperURL = try installer.installOrRefresh()
        let content = try String(contentsOf: helperURL, encoding: .utf8)
        let noncePath = appSupport.appendingPathComponent(OnboardingNonceStore.fileName).path

        XCTAssertTrue(content.contains("AGENTIC30_APP_SUPPORT_PATH=\(OnboardingHelperInstaller.shellQuote(appSupport.path))"))
        XCTAssertTrue(content.contains("AGENTIC30_ONBOARDING_NONCE_PATH=\(OnboardingHelperInstaller.shellQuote(noncePath))"))
        XCTAssertTrue(content.contains(nodePath))
        XCTAssertTrue(content.contains("onboarding-helper.mjs"))
    }

    func test_onboardingHelperInstaller_isIdempotent() throws {
        let appSupport = FileManager.default.temporaryDirectory
            .appendingPathComponent("agentic30-helper-installer-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: appSupport, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: appSupport) }

        let nodePath = "/tmp/stub/node-\(UUID().uuidString)"
        let installer = OnboardingHelperInstaller(
            appSupportURL: appSupport,
            nodeResolver: makeStubNodeResolver(nodePath: nodePath)
        )

        let firstURL = try installer.installOrRefresh()
        let firstContent = try String(contentsOf: firstURL, encoding: .utf8)
        let secondURL = try installer.installOrRefresh()
        let secondContent = try String(contentsOf: secondURL, encoding: .utf8)

        XCTAssertEqual(firstURL, secondURL)
        XCTAssertEqual(firstContent, secondContent)
    }

    func test_localFolderStatusText_prefersFolderNameOverDetail() {
        let source = IntakeSourceState(
            id: .localFolder,
            status: .connected,
            path: "/tmp/agentic-30",
            detail: "42 docs"
        )

        XCTAssertEqual(
            IntakeV2LocalFolderStatusFormatter.statusText(for: source),
            "Connected · agentic-30"
        )
    }

    func test_registerLocalFolder_keepsLocalFolderFirst() {
        let mgr = IntakeV2SourceManager(defaults: suiteDefaults)
        mgr.toggle(.github, to: .connected)
        mgr.toggle(.notion, to: .connected)
        mgr.registerLocalFolder(URL(fileURLWithPath: "/tmp/x"), fileCount: nil)

        XCTAssertEqual(mgr.sources.first?.id, .localFolder)
    }

    func test_addCatalogSources_persistsDisabledPlaceholders() {
        let mgr = IntakeV2SourceManager(defaults: suiteDefaults)

        mgr.addCatalogSources([.workLogFolder, .gmailEmail])

        XCTAssertEqual(mgr.status(of: .workLogFolder), .disabled)
        XCTAssertEqual(mgr.status(of: .gmailEmail), .disabled)
        XCTAssertEqual(mgr.connectedCount, 0)
    }

    func test_addCatalogSources_roundTripsThroughPersistence() {
        let mgr1 = IntakeV2SourceManager(defaults: suiteDefaults)
        mgr1.addCatalogSources([.blogRss, .revenueCat])

        let mgr2 = IntakeV2SourceManager(defaults: suiteDefaults)

        XCTAssertEqual(mgr2.status(of: .blogRss), .disabled)
        XCTAssertEqual(mgr2.status(of: .revenueCat), .disabled)
    }

    func test_addCatalogSources_keepsLocalFolderFirst() {
        let mgr = IntakeV2SourceManager(defaults: suiteDefaults)
        mgr.addCatalogSources([.workLogFolder])
        mgr.registerLocalFolder(URL(fileURLWithPath: "/tmp/x"), fileCount: nil)

        XCTAssertEqual(mgr.sources.first?.id, .localFolder)
        XCTAssertEqual(mgr.status(of: .workLogFolder), .disabled)
    }

    func test_toggle_setsStatus() {
        let mgr = IntakeV2SourceManager(defaults: suiteDefaults)
        mgr.toggle(.notion, to: .connecting)
        XCTAssertEqual(mgr.status(of: .notion), .connecting)
        mgr.toggle(.notion, to: .connected)
        XCTAssertEqual(mgr.status(of: .notion), .connected)
        XCTAssertEqual(mgr.connectedCount, 1)
    }

    func test_persistence_roundTrips() {
        let mgr1 = IntakeV2SourceManager(defaults: suiteDefaults)
        mgr1.registerLocalFolder(URL(fileURLWithPath: "/x"), fileCount: 1)
        mgr1.toggle(.github, to: .connected)
        XCTAssertNotNil(suiteDefaults.data(forKey: IntakeV2SourceManager.sourcesDefaultsKey))
        XCTAssertNil(suiteDefaults.data(forKey: IntakeV2SourceManager.legacySourcesDefaultsKey))

        let mgr2 = IntakeV2SourceManager(defaults: suiteDefaults)
        XCTAssertEqual(mgr2.connectedCount, 2)
        XCTAssertEqual(mgr2.status(of: .github), .connected)
    }

    func test_legacySources_migrateToAgentic30Namespace() throws {
        let data = try XCTUnwrap("""
        [{"id":"local_folder","status":"connected","path":"/tmp/legacy","detail":"1 docs"}]
        """.data(using: .utf8))
        suiteDefaults.set(data, forKey: IntakeV2SourceManager.legacySourcesDefaultsKey)

        let mgr = IntakeV2SourceManager(defaults: suiteDefaults)

        XCTAssertEqual(mgr.connectedCount, 1)
        XCTAssertEqual(mgr.sources.first?.path, "/tmp/legacy")
        XCTAssertNotNil(suiteDefaults.data(forKey: IntakeV2SourceManager.sourcesDefaultsKey))
        XCTAssertNil(suiteDefaults.data(forKey: IntakeV2SourceManager.legacySourcesDefaultsKey))
    }

    func test_legacyBundledPaymentSource_migratesToSeparatedPaymentSources() throws {
        let data = try XCTUnwrap("""
        [{"id":"lemon_squeezy_paddle_gumroad","status":"disabled","path":"/tmp/payments","detail":"old bundle"}]
        """.data(using: .utf8))
        suiteDefaults.set(data, forKey: IntakeV2SourceManager.sourcesDefaultsKey)

        let mgr = IntakeV2SourceManager(defaults: suiteDefaults)

        XCTAssertEqual(mgr.status(of: .lemonSqueezy), .disabled)
        XCTAssertEqual(mgr.status(of: .paddle), .disabled)
        XCTAssertEqual(mgr.status(of: .gumroad), .disabled)
        XCTAssertEqual(mgr.status(of: .lemonSqueezyPaddleGumroad), .notConnected)
        XCTAssertEqual(
            mgr.sources.filter { [.lemonSqueezy, .paddle, .gumroad].contains($0.id) }.map(\.path),
            ["/tmp/payments", "/tmp/payments", "/tmp/payments"]
        )
        XCTAssertNotNil(suiteDefaults.data(forKey: IntakeV2SourceManager.sourcesDefaultsKey))
    }

    func test_remove_clearsEntry() {
        let mgr = IntakeV2SourceManager(defaults: suiteDefaults)
        mgr.toggle(.discord, to: .connected)
        mgr.remove(.discord)
        XCTAssertEqual(mgr.status(of: .discord), .notConnected)
    }
}
