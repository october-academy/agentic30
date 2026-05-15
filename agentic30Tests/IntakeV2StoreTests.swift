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
        XCTAssertNil(store.folderURL)
        XCTAssertFalse(store.isFullyComplete)
        XCTAssertFalse(store.restoreFailed)
    }

    func test_setAnswers_persistsAcrossInstances() {
        let store1 = IntakeV2Store(defaults: suiteDefaults)
        store1.workmode = .fullTimeSolo
        store1.role = .developer
        store1.stuck = .ideaOnly
        store1.folderURL = URL(fileURLWithPath: "/Users/test/Projects")
        store1.persist()
        XCTAssertNotNil(suiteDefaults.data(forKey: IntakeV2Store.stateDefaultsKey))
        XCTAssertNil(suiteDefaults.data(forKey: IntakeV2Store.legacyStateDefaultsKey))

        let store2 = IntakeV2Store(defaults: suiteDefaults)
        XCTAssertEqual(store2.workmode, .fullTimeSolo)
        XCTAssertEqual(store2.role, .developer)
        XCTAssertEqual(store2.stuck, .ideaOnly)
        XCTAssertEqual(store2.folderURL?.path, "/Users/test/Projects")
    }

    func test_stepCompletion_flags() {
        let store = IntakeV2Store(defaults: suiteDefaults)
        XCTAssertFalse(store.isStep1Complete)
        store.workmode = .sideProject
        XCTAssertTrue(store.isStep1Complete)
        XCTAssertFalse(store.isFullyComplete)
        store.role = .designer
        store.stuck = .building
        store.folderURL = URL(fileURLWithPath: "/tmp/work")
        XCTAssertTrue(store.isFullyComplete)
    }

    func test_corruptStorage_surfacesRestoreFailedFlag() {
        // Inject garbage at the storage key
        suiteDefaults.set(Data([0xFF, 0xFE, 0xFD]), forKey: IntakeV2Store.stateDefaultsKey)
        let store = IntakeV2Store(defaults: suiteDefaults)
        XCTAssertTrue(store.restoreFailed, "corrupt UserDefaults should set restoreFailed=true (eng D6 critical gap)")
        XCTAssertNil(store.workmode)
        XCTAssertNil(store.role)
        XCTAssertNil(store.stuck)
    }

    func test_legacyStorage_migratesToAgentic30Namespace() throws {
        let data = try XCTUnwrap("""
        {"workmode":"full_time_solo","role":"developer","stuck":"idea_only","folderPath":"/tmp/legacy","firstDecisionShown":false}
        """.data(using: .utf8))
        suiteDefaults.set(data, forKey: IntakeV2Store.legacyStateDefaultsKey)

        let store = IntakeV2Store(defaults: suiteDefaults)

        XCTAssertEqual(store.workmode, .fullTimeSolo)
        XCTAssertEqual(store.role, .developer)
        XCTAssertEqual(store.stuck, .ideaOnly)
        XCTAssertEqual(store.folderURL?.path, "/tmp/legacy")
        XCTAssertNotNil(suiteDefaults.data(forKey: IntakeV2Store.stateDefaultsKey))
        XCTAssertNil(suiteDefaults.data(forKey: IntakeV2Store.legacyStateDefaultsKey))
    }

    func test_reset_clearsStateAndStorage() {
        let store = IntakeV2Store(defaults: suiteDefaults)
        store.workmode = .teamStartup
        store.persist()
        suiteDefaults.set(Data([0x01]), forKey: IntakeV2Store.legacyStateDefaultsKey)
        store.reset()
        XCTAssertNil(store.workmode)
        XCTAssertNil(suiteDefaults.data(forKey: IntakeV2Store.stateDefaultsKey))
        XCTAssertNil(suiteDefaults.data(forKey: IntakeV2Store.legacyStateDefaultsKey))

        let fresh = IntakeV2Store(defaults: suiteDefaults)
        XCTAssertNil(fresh.workmode)
    }

    func test_markCompleted_setsTimestamp() {
        let store = IntakeV2Store(defaults: suiteDefaults)
        XCTAssertNil(store.completedAt)
        store.markCompleted()
        XCTAssertNotNil(store.completedAt)
        XCTAssertLessThan(abs(store.completedAt!.timeIntervalSinceNow), 5)
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
