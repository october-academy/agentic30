import XCTest
@testable import agentic30

final class PostHogTelemetryTests: XCTestCase {
    func testUSHostResolvesToUSIngest() {
        let resolved = PostHogHostResolver.ingestBaseURL(for: "https://us.posthog.com")
        XCTAssertEqual(resolved?.absoluteString, "https://us.i.posthog.com")
    }

    func testEUHostResolvesToEUIngest() {
        let resolved = PostHogHostResolver.ingestBaseURL(for: "eu.posthog.com")
        XCTAssertEqual(resolved?.absoluteString, "https://eu.i.posthog.com")
    }

    func testCustomHostPreservesHost() {
        let resolved = PostHogHostResolver.ingestBaseURL(for: "https://analytics.example.com")
        XCTAssertEqual(resolved?.absoluteString, "https://analytics.example.com")
    }

    func testSanitizerMasksSensitiveFieldsAndLocalPaths() {
        let sanitized = PostHogTelemetrySanitizer.sanitize([
            "payment_key": "payment-fixture-1234567890",
            "workspace_root": "/Users/october/prj/agentic30",
            "doc_path": "docs/ICP.md",
            "auth_email": "founder@example.com",
        ])

        XCTAssertEqual(sanitized["payment_key_suffix"] as? String, "567890")
        XCTAssertEqual(sanitized["workspace_basename"] as? String, "agentic30")
        XCTAssertEqual(sanitized["doc_path"] as? String, "docs/ICP.md")
        XCTAssertEqual(sanitized["auth_email_domain"] as? String, "example.com")
        XCTAssertNil(sanitized["payment_key"])
        XCTAssertNil(sanitized["workspace_root"])
        XCTAssertNil(sanitized["auth_email"])
    }

    func testCaptureOnceDedupesByOnceKey() {
        let defaultsKey = "agentic30.posthog.once.test.capture.once.\(UUID().uuidString)"
        let onceKey = defaultsKey.replacingOccurrences(of: "agentic30.posthog.once.", with: "")
        UserDefaults.standard.removeObject(forKey: defaultsKey)

        var captures: [PostHogTelemetryCapture] = []
        PostHogTelemetry.captureSink = { captures.append($0) }
        defer {
            PostHogTelemetry.captureSink = nil
            UserDefaults.standard.removeObject(forKey: defaultsKey)
        }

        XCTAssertTrue(PostHogTelemetry.captureOnce(
            "dmg_install_completed",
            onceKey: onceKey,
            properties: ["event_schema_version": 1]
        ))
        XCTAssertFalse(PostHogTelemetry.captureOnce(
            "dmg_install_completed",
            onceKey: onceKey,
            properties: ["event_schema_version": 1]
        ))

        XCTAssertEqual(captures.map(\.event), ["dmg_install_completed"])
        XCTAssertEqual(captures.first?.properties["event_schema_version"] as? Int, 1)
    }

    func testSidecarBridgeDedupesMissingScriptBootFailureTelemetry() {
        var captures: [PostHogTelemetryCapture] = []
        PostHogTelemetry.captureSink = { captures.append($0) }
        defer { PostHogTelemetry.captureSink = nil }

        let missingScript = FileManager.default.temporaryDirectory
            .appendingPathComponent("missing-sidecar-\(UUID().uuidString).mjs")
        let bridge = SidecarBridge(
            nodeResolver: Self.neverResolvingNodeResolver(),
            sidecarScriptURL: missingScript
        )

        bridge.start()
        bridge.start()

        let failures = captures.filter { $0.event == "sidecar_boot_failed" }
        XCTAssertEqual(failures.count, 1)
        XCTAssertEqual(failures.first?.properties["reason"] as? String, "missing_script")
    }

    func testSidecarBridgeEmitsMissingNodeBootFailureTelemetry() throws {
        var captures: [PostHogTelemetryCapture] = []
        PostHogTelemetry.captureSink = { captures.append($0) }
        defer { PostHogTelemetry.captureSink = nil }

        let script = try Self.makeTemporaryScript()
        defer { try? FileManager.default.removeItem(at: script) }
        let bridge = SidecarBridge(
            nodeResolver: Self.neverResolvingNodeResolver(),
            sidecarScriptURL: script
        )

        bridge.start()

        let failures = captures.filter { $0.event == "sidecar_boot_failed" }
        XCTAssertEqual(failures.count, 1)
        XCTAssertEqual(failures.first?.properties["reason"] as? String, "missing_node")
    }

    func testSidecarBridgeEmitsEarlyExitBootFailureTelemetryOnce() throws {
        let lock = NSLock()
        var captures: [PostHogTelemetryCapture] = []
        let emitted = expectation(description: "early process exit telemetry")
        PostHogTelemetry.captureSink = { capture in
            lock.lock()
            captures.append(capture)
            lock.unlock()
            if capture.event == "sidecar_boot_failed",
               capture.properties["reason"] as? String == "early_process_exit" {
                emitted.fulfill()
            }
        }
        defer { PostHogTelemetry.captureSink = nil }

        let script = try Self.makeTemporaryScript()
        defer { try? FileManager.default.removeItem(at: script) }
        let falseBinary = try XCTUnwrap(
            ["/usr/bin/false", "/bin/false"].first(where: {
                FileManager.default.isExecutableFile(atPath: $0)
            })
        )
        let bridge = SidecarBridge(
            nodeResolver: NodeExecutableResolver(
                environment: ["NODE_BINARY": falseBinary],
                homeDirectory: "/tmp",
                shellLookup: { nil },
                isExecutable: { $0 == falseBinary },
                directoryContentsProvider: { _ in [] }
            ),
            sidecarScriptURL: script
        )

        bridge.start()
        wait(for: [emitted], timeout: 3)
        bridge.stop()

        lock.lock()
        let failures = captures.filter { $0.event == "sidecar_boot_failed" }
        lock.unlock()
        XCTAssertEqual(failures.count, 1)
        XCTAssertEqual(failures.first?.properties["termination_status"] as? Int, 1)
    }

    func testWorkspaceSetupCompletionWaitsForScanSuccessAndFirstInput() throws {
        let completed = try SidecarRequestEmit(
            event: .workspaceSetupCompleted,
            properties: ["workspace_basename": .string("agentic30-public")]
        )
        var gate = WorkspaceSetupTelemetryGate()

        XCTAssertTrue(gate.requestsToCapture(afterReceiving: completed).isEmpty)
        XCTAssertTrue(gate.requestsToCaptureAfterWorkspaceScanSuccess().isEmpty)

        let flushed = gate.requestsToCaptureAfterFirstRealInput()
        XCTAssertEqual(flushed.count, 1)
        XCTAssertEqual(flushed.first?.event, .workspaceSetupCompleted)
        XCTAssertTrue(gate.requestsToCapture(afterReceiving: completed).isEmpty)
    }

    private static func neverResolvingNodeResolver() -> NodeExecutableResolver {
        NodeExecutableResolver(
            environment: [:],
            homeDirectory: "/tmp",
            shellLookup: { nil },
            isExecutable: { _ in false },
            directoryContentsProvider: { _ in [] }
        )
    }

    private static func makeTemporaryScript() throws -> URL {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("sidecar-\(UUID().uuidString).mjs")
        try "console.log('unused')\n".data(using: .utf8)?.write(to: url)
        return url
    }
}
