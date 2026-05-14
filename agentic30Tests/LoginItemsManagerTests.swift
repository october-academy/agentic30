import XCTest
@testable import agentic30

@MainActor
final class LoginItemsManagerTests: XCTestCase {
    private var defaults: UserDefaults!
    private var suiteName: String!

    override func setUp() async throws {
        try await super.setUp()
        suiteName = "LoginItemsManagerTests.\(UUID().uuidString)"
        defaults = UserDefaults(suiteName: suiteName)
    }

    override func tearDown() async throws {
        defaults.removePersistentDomain(forName: suiteName)
        defaults = nil
        suiteName = nil
        try await super.tearDown()
    }

    func testAutoEnrollOnFirstLaunchRegistersOnce() {
        let registrar = FakeRegistrar()
        let manager = LoginItemsManager(registrar: registrar, defaults: defaults)

        manager.autoEnrollIfFirstLaunch(isFirstLaunchEver: true)

        XCTAssertEqual(registrar.registerCount, 1)
        XCTAssertEqual(registrar.unregisterCount, 0)
        XCTAssertTrue(defaults.bool(forKey: LoginItemsManager.autoEnrollAttemptedKey))
        XCTAssertTrue(manager.isEnabled)
    }

    func testAutoEnrollIsIdempotentWithinSameInstance() {
        let registrar = FakeRegistrar()
        let manager = LoginItemsManager(registrar: registrar, defaults: defaults)

        manager.autoEnrollIfFirstLaunch(isFirstLaunchEver: true)
        manager.autoEnrollIfFirstLaunch(isFirstLaunchEver: true)

        XCTAssertEqual(registrar.registerCount, 1, "Second call must be a no-op once defaults key is set")
    }

    func testAutoEnrollSkipsAcrossNewInstancesWhenAlreadyAttempted() {
        let firstRegistrar = FakeRegistrar()
        let first = LoginItemsManager(registrar: firstRegistrar, defaults: defaults)
        first.autoEnrollIfFirstLaunch(isFirstLaunchEver: true)
        XCTAssertEqual(firstRegistrar.registerCount, 1)

        let secondRegistrar = FakeRegistrar()
        let second = LoginItemsManager(registrar: secondRegistrar, defaults: defaults)
        second.autoEnrollIfFirstLaunch(isFirstLaunchEver: true)

        XCTAssertEqual(secondRegistrar.registerCount, 0, "Persisted defaults key must block re-enrollment by future instances")
    }

    func testAutoEnrollSkipsWhenNotFirstLaunch() {
        let registrar = FakeRegistrar()
        let manager = LoginItemsManager(registrar: registrar, defaults: defaults)

        manager.autoEnrollIfFirstLaunch(isFirstLaunchEver: false)

        XCTAssertEqual(registrar.registerCount, 0)
        XCTAssertFalse(defaults.bool(forKey: LoginItemsManager.autoEnrollAttemptedKey))
    }

    func testSetEnabledTogglesThroughRegistrar() {
        let registrar = FakeRegistrar()
        let manager = LoginItemsManager(registrar: registrar, defaults: defaults)

        manager.setEnabled(true)
        XCTAssertEqual(registrar.registerCount, 1)
        XCTAssertTrue(manager.isEnabled)

        manager.setEnabled(false)
        XCTAssertEqual(registrar.unregisterCount, 1)
        XCTAssertFalse(manager.isEnabled)
    }

    func testSetEnabledSurvivesRegistrarThrow() {
        let registrar = FakeRegistrar()
        registrar.shouldThrow = true
        let manager = LoginItemsManager(registrar: registrar, defaults: defaults)

        manager.setEnabled(true)

        XCTAssertEqual(registrar.registerCount, 1)
        XCTAssertFalse(manager.isEnabled, "isEnabled must reflect the system's actual state after a failed register")
    }
}

private final class FakeRegistrar: LoginItemRegistering {
    var registerCount = 0
    var unregisterCount = 0
    var shouldThrow = false
    private var registered = false

    func register() throws {
        registerCount += 1
        if shouldThrow {
            throw NSError(domain: "FakeRegistrar", code: 1)
        }
        registered = true
    }

    func unregister() throws {
        unregisterCount += 1
        if shouldThrow {
            throw NSError(domain: "FakeRegistrar", code: 2)
        }
        registered = false
    }

    var isRegistered: Bool { registered }
}
