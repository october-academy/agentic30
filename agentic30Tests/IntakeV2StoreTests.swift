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
        suiteDefaults.set(Data([0xFF, 0xFE, 0xFD]), forKey: "IntakeV2.state.v1")
        let store = IntakeV2Store(defaults: suiteDefaults)
        XCTAssertTrue(store.restoreFailed, "corrupt UserDefaults should set restoreFailed=true (eng D6 critical gap)")
        XCTAssertNil(store.workmode)
        XCTAssertNil(store.role)
        XCTAssertNil(store.stuck)
    }

    func test_reset_clearsStateAndStorage() {
        let store = IntakeV2Store(defaults: suiteDefaults)
        store.workmode = .teamStartup
        store.persist()
        store.reset()
        XCTAssertNil(store.workmode)

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

        let mgr2 = IntakeV2SourceManager(defaults: suiteDefaults)
        XCTAssertEqual(mgr2.connectedCount, 2)
        XCTAssertEqual(mgr2.status(of: .github), .connected)
    }

    func test_remove_clearsEntry() {
        let mgr = IntakeV2SourceManager(defaults: suiteDefaults)
        mgr.toggle(.discord, to: .connected)
        mgr.remove(.discord)
        XCTAssertEqual(mgr.status(of: .discord), .notConnected)
    }
}
