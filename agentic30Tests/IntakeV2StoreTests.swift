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
            (.figma, .core, "DESIGN · SPEC"),
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

    func test_geoAeoCatalogSources_areAddableSearchableAndNotBuiltIn() throws {
        let expectedItems: [
            (id: IntakeSourceID, displayName: String, category: IntakeSourceCatalogCategory, kind: String, searchTerms: [String])
        ] = [
            (
                .googleSearchConsole,
                "Google Search Console",
                .analytics,
                "SEARCH · AEO",
                ["Google Search Console", "AEO", "Analytics"]
            ),
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

    func test_sourceIconCatalog_mapsBrandBackedSourcesToOfficialAssets() {
        let expected: [IntakeSourceID: IntakeSourceIconKind] = [
            .linear: .asset("BrandLinear"),
            .jira: .asset("BrandJira"),
            .confluence: .asset("BrandConfluence"),
            .figma: .asset("BrandFigma"),
            .gmailEmail: .asset("BrandGmail"),
            .calendarCalls: .asset("BrandGoogleCalendar"),
            .formsSurvey: .asset("BrandGoogleForms"),
            .slack: .asset("BrandSlack"),
            .xTwitter: .asset("BrandX"),
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
            .revenueCat: .asset("BrandRevenueCat"),
            .lemonSqueezyPaddleGumroad: .composite(["BrandLemonSqueezy", "BrandPaddle", "BrandGumroad"]),
        ]
        let addableIDs = Set(IntakeSourceCatalog.addableItems.map(\.id))

        for (id, expectedIcon) in expected {
            XCTAssertTrue(addableIDs.contains(id), "\(id.rawValue) should stay available in the Add Source catalog.")
            XCTAssertEqual(IntakeSourceIconCatalog.iconKind(for: id, fallbackSystemImage: "fallback"), expectedIcon)
            XCTAssertTrue(IntakeSourceIconCatalog.iconKind(for: id, fallbackSystemImage: "fallback").isBrandBacked)
        }
    }

    func test_sourceIconCatalog_keepsGenericSourcesOnSymbolFallbacks() throws {
        let genericSourceIDs: [IntakeSourceID] = [
            .localFolder,
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

    func test_remove_clearsEntry() {
        let mgr = IntakeV2SourceManager(defaults: suiteDefaults)
        mgr.toggle(.discord, to: .connected)
        mgr.remove(.discord)
        XCTAssertEqual(mgr.status(of: .discord), .notConnected)
    }
}
