import XCTest
@testable import agentic30

final class WorkspaceSettingsTests: XCTestCase {
    private let defaultsKey = "agentic30.workspaceRoot"
    private let productionLegacyProvider: () -> String = {
        KeychainHelper.loadSettings().bipWorkspaceRoot
    }

    override func setUp() {
        super.setUp()
        // Hermetic: stub the legacy keychain fallback so tests don't depend on
        // (or mutate) whatever the dev box's login keychain happens to hold.
        WorkspaceSettings.legacyWorkspaceProvider = { "" }
        UserDefaults.standard.removeObject(forKey: defaultsKey)
    }

    override func tearDown() {
        UserDefaults.standard.removeObject(forKey: defaultsKey)
        WorkspaceSettings.legacyWorkspaceProvider = productionLegacyProvider
        super.tearDown()
    }

    func testResolvedURLFallsBackToHomeWhenUnset() {
        let resolved = WorkspaceSettings.resolvedURL()
        XCTAssertEqual(resolved.standardized, FileManager.default.homeDirectoryForCurrentUser.standardized)
        XCTAssertFalse(WorkspaceSettings.hasExplicitWorkspace)
    }

    func testStorePersistsAndResolves() {
        let tmp = FileManager.default.temporaryDirectory.appendingPathComponent(
            "agentic30-workspace-\(UUID().uuidString)",
            isDirectory: true
        )
        try? FileManager.default.createDirectory(at: tmp, withIntermediateDirectories: true)
        addTeardownBlock {
            try? FileManager.default.removeItem(at: tmp)
        }
        WorkspaceSettings.store(tmp)

        XCTAssertTrue(WorkspaceSettings.hasExplicitWorkspace)
        XCTAssertEqual(WorkspaceSettings.resolvedURL().path, tmp.path)
    }

    func testClearRemovesStoredPath() {
        let tmp = FileManager.default.temporaryDirectory
            .appendingPathComponent("agentic30-clear-\(UUID().uuidString)", isDirectory: true)
        try? FileManager.default.createDirectory(at: tmp, withIntermediateDirectories: true)
        addTeardownBlock {
            try? FileManager.default.removeItem(at: tmp)
        }
        WorkspaceSettings.store(tmp)
        XCTAssertTrue(WorkspaceSettings.hasExplicitWorkspace)

        WorkspaceSettings.clear()
        XCTAssertFalse(WorkspaceSettings.hasExplicitWorkspace)
    }

    func testHasExplicitWorkspaceMigratesLegacyWorkspaceRoot() {
        let legacy = FileManager.default.temporaryDirectory
            .appendingPathComponent("agentic30-legacy-\(UUID().uuidString)", isDirectory: true)
        try? FileManager.default.createDirectory(at: legacy, withIntermediateDirectories: true)
        addTeardownBlock {
            try? FileManager.default.removeItem(at: legacy)
        }
        WorkspaceSettings.legacyWorkspaceProvider = { legacy.path }

        XCTAssertTrue(WorkspaceSettings.hasExplicitWorkspace)
        XCTAssertEqual(UserDefaults.standard.string(forKey: defaultsKey), legacy.path)
        XCTAssertEqual(WorkspaceSettings.resolvedURL().path, legacy.path)
    }

    func testDisplayPathPrefersExplicitWorkspaceOverLegacyFallback() {
        let explicit = FileManager.default.temporaryDirectory
            .appendingPathComponent("agentic30-display-\(UUID().uuidString)", isDirectory: true)
        try? FileManager.default.createDirectory(at: explicit, withIntermediateDirectories: true)
        addTeardownBlock {
            try? FileManager.default.removeItem(at: explicit)
        }
        WorkspaceSettings.store(explicit)

        let displayed = WorkspaceSettings.displayPath(legacyFallback: "/tmp/legacy-bip-root")

        XCTAssertEqual(displayed, explicit.path)
    }

    func testMissingStoredWorkspaceIsClearedAndFallsBackHome() {
        let missing = FileManager.default.temporaryDirectory
            .appendingPathComponent("agentic30-missing-\(UUID().uuidString)", isDirectory: true)
        WorkspaceSettings.store(missing)

        XCTAssertFalse(WorkspaceSettings.hasExplicitWorkspace)
        XCTAssertEqual(WorkspaceSettings.resolvedURL().standardized, FileManager.default.homeDirectoryForCurrentUser.standardized)
        XCTAssertNil(UserDefaults.standard.string(forKey: defaultsKey))
    }

    func testDisplayPathFallsBackToLegacyWhenExplicitWorkspaceIsUnset() {
        let displayed = WorkspaceSettings.displayPath(legacyFallback: "/tmp/legacy-bip-root")

        XCTAssertEqual(displayed, "/tmp/legacy-bip-root")
    }

    func testFoundationProgressStorePersistsByWorkspaceAndAppSupport() {
        let appSupport = FileManager.default.temporaryDirectory
            .appendingPathComponent("agentic30-progress-support-\(UUID().uuidString)", isDirectory: true)
        let workspace = FileManager.default.temporaryDirectory
            .appendingPathComponent("agentic30-progress-workspace-\(UUID().uuidString)", isDirectory: true)
        try? FileManager.default.createDirectory(at: workspace, withIntermediateDirectories: true)
        addTeardownBlock {
            try? FileManager.default.removeItem(at: appSupport)
            try? FileManager.default.removeItem(at: workspace)
        }

        let store = FoundationProgressStore(workspaceRoot: workspace.path, appSupportURL: appSupport)
        let startedAt = Date(timeIntervalSince1970: 1_777_000_000)
        store.save(
            FoundationProgressSnapshot(
                workspaceRoot: workspace.path,
                startedAt: startedAt,
                selectedDay: 2,
                completedDays: [1]
            )
        )

        let loaded = store.load()
        XCTAssertEqual(loaded?.workspaceRoot, workspace.path)
        XCTAssertEqual(loaded?.startedAt, startedAt)
        XCTAssertEqual(loaded?.selectedDay, 2)
        XCTAssertEqual(loaded?.completedDays, Set([1]))
        XCTAssertTrue(FileManager.default.fileExists(atPath: store.fileURL.path))
    }

    func testFoundationProgressStoreDoesNotInheritAcrossWorkspaces() {
        let appSupport = FileManager.default.temporaryDirectory
            .appendingPathComponent("agentic30-progress-isolation-\(UUID().uuidString)", isDirectory: true)
        let workspaceA = FileManager.default.temporaryDirectory
            .appendingPathComponent("agentic30-progress-a-\(UUID().uuidString)", isDirectory: true)
        let workspaceB = FileManager.default.temporaryDirectory
            .appendingPathComponent("agentic30-progress-b-\(UUID().uuidString)", isDirectory: true)
        try? FileManager.default.createDirectory(at: workspaceA, withIntermediateDirectories: true)
        try? FileManager.default.createDirectory(at: workspaceB, withIntermediateDirectories: true)
        addTeardownBlock {
            try? FileManager.default.removeItem(at: appSupport)
            try? FileManager.default.removeItem(at: workspaceA)
            try? FileManager.default.removeItem(at: workspaceB)
        }

        let storeA = FoundationProgressStore(workspaceRoot: workspaceA.path, appSupportURL: appSupport)
        let storeB = FoundationProgressStore(workspaceRoot: workspaceB.path, appSupportURL: appSupport)
        storeA.save(
            FoundationProgressSnapshot(
                workspaceRoot: workspaceA.path,
                startedAt: Date(timeIntervalSince1970: 1_777_000_000),
                selectedDay: 2,
                completedDays: [1]
            )
        )

        XCTAssertNotEqual(storeA.fileURL, storeB.fileURL)
        XCTAssertNotNil(storeA.load())
        XCTAssertNil(storeB.load())
    }

    func testFoundationProgressSnapshotUnlocksNextDayAfterCompletion() {
        let startedAt = Date(timeIntervalSince1970: 1_777_000_000)
        var snapshot = FoundationProgressSnapshot(
            workspaceRoot: "/tmp/project",
            startedAt: startedAt,
            selectedDay: 1,
            completedDays: []
        )

        XCTAssertEqual(snapshot.currentDayNumber(now: startedAt.addingTimeInterval(25 * 60 * 60)), 2)
        XCTAssertTrue(snapshot.isUnlocked(1))
        XCTAssertFalse(snapshot.isUnlocked(2))

        snapshot.completedDays.insert(1)

        XCTAssertTrue(snapshot.isUnlocked(2))
        XCTAssertFalse(snapshot.isUnlocked(3))
    }
}
