import XCTest
@testable import agentic30

final class WolfStateSequencePackageTests: XCTestCase {
    private let tinyPNG = Data(base64Encoded:
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lmIxGQAAAABJRU5ErkJggg=="
    )!

    func testDefaultRootURLUsesHomeDirectory() {
        let url = WolfStateSequencePackage.defaultRootURL(
            homeDirectory: URL(fileURLWithPath: "/Users/tester", isDirectory: true)
        )

        XCTAssertEqual(url.path, "/Users/tester/.codex/pets/wolf-state-sequences")
    }

    func testWolfStateMapsToPackageStates() {
        XCTAssertEqual(WolfState.idle.stateSequencePackageState, "idle")
        XCTAssertEqual(WolfState.sleeping.stateSequencePackageState, "waiting")
        XCTAssertEqual(WolfState.attention.stateSequencePackageState, "waving")
        XCTAssertEqual(WolfState.notification.stateSequencePackageState, "waving")
        XCTAssertEqual(WolfState.happy.stateSequencePackageState, "jumping")
        XCTAssertEqual(WolfState.thinking.stateSequencePackageState, "review")
        XCTAssertEqual(WolfState.typing.stateSequencePackageState, "review")
        XCTAssertEqual(WolfState.juggling.stateSequencePackageState, "review")
        XCTAssertEqual(WolfState.conducting.stateSequencePackageState, "review")
        XCTAssertEqual(WolfState.working.stateSequencePackageState, "running")
        XCTAssertEqual(WolfState.carrying.stateSequencePackageState, "running")
        XCTAssertEqual(WolfState.sweeping.stateSequencePackageState, "running")
        XCTAssertEqual(WolfState.error.stateSequencePackageState, "failed")
    }

    func testLoadsStateSequenceManifestAndIdleFrameURLs() throws {
        let root = try makePackage(states: ["idle"], frameCounts: ["idle": 60])
        defer { try? FileManager.default.removeItem(at: root) }

        let package = try XCTUnwrap(WolfStateSequencePackage.load(from: root))
        let urls = try XCTUnwrap(package.frameURLs(for: .idle))

        XCTAssertEqual(urls.count, 60)
        XCTAssertEqual(urls.first?.lastPathComponent, "000.png")
        XCTAssertEqual(urls.last?.lastPathComponent, "059.png")
    }

    func testSpritesheetPackageIsUnsupported() throws {
        let root = try makeTemporaryDirectory()
        defer { try? FileManager.default.removeItem(at: root) }

        let json = #"{"id":"router-wolf","spritesheetPath":"spritesheet.webp"}"#
        try json.write(
            to: root.appendingPathComponent("pet.json"),
            atomically: true,
            encoding: .utf8
        )

        XCTAssertNil(WolfStateSequencePackage.load(from: root))
    }

    func testMissingStateReturnsNilSoCallerCanFallback() throws {
        let root = try makePackage(states: ["idle"], frameCounts: ["idle": 60])
        defer { try? FileManager.default.removeItem(at: root) }

        let package = try XCTUnwrap(WolfStateSequencePackage.load(from: root))

        XCTAssertNil(package.frameURLs(for: .thinking))
    }

    func testShortFrameSequenceReturnsNilSoCallerCanFallback() throws {
        let root = try makePackage(states: ["idle"], frameCounts: ["idle": 59])
        defer { try? FileManager.default.removeItem(at: root) }

        let package = try XCTUnwrap(WolfStateSequencePackage.load(from: root))

        XCTAssertNil(package.frameURLs(for: .idle))
    }

    func testUnsupportedFrameCountManifestIsRejected() throws {
        let root = try makePackage(states: ["idle"], frameCounts: ["idle": 30], framesPerState: 30)
        defer { try? FileManager.default.removeItem(at: root) }

        XCTAssertNil(WolfStateSequencePackage.load(from: root))
    }

    private func makePackage(
        states: [String],
        frameCounts: [String: Int],
        framesPerState: Int = 60
    ) throws -> URL {
        let root = try makeTemporaryDirectory()
        let sequences = root.appendingPathComponent("state-sequences", isDirectory: true)
        try FileManager.default.createDirectory(at: sequences, withIntermediateDirectories: true)

        for state in states {
            let stateDirectory = sequences.appendingPathComponent(state, isDirectory: true)
            try FileManager.default.createDirectory(at: stateDirectory, withIntermediateDirectories: true)
            for index in 0..<(frameCounts[state] ?? 0) {
                let frameURL = stateDirectory.appendingPathComponent(
                    String(format: "%03d.png", index),
                    isDirectory: false
                )
                try tinyPNG.write(to: frameURL)
            }
        }

        let manifest = """
        {
          "format": "state-sequences-v1",
          "framesPerState": \(framesPerState),
          "stateSequencesPath": "state-sequences",
          "states": \(try jsonArray(states))
        }
        """
        try manifest.write(
            to: root.appendingPathComponent("pet.json"),
            atomically: true,
            encoding: .utf8
        )
        return root
    }

    private func makeTemporaryDirectory() throws -> URL {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }

    private func jsonArray(_ strings: [String]) throws -> String {
        let data = try JSONSerialization.data(withJSONObject: strings)
        return String(data: data, encoding: .utf8) ?? "[]"
    }
}
