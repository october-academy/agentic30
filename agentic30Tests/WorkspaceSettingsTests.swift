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
}
