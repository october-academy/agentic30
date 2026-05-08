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

    func testCaptureOnceKeepsPendingUntilSendSucceeds() {
        let onceKey = "test.capture.once.pending.\(UUID().uuidString)"
        let defaultsKey = "agentic30.posthog.once.\(onceKey)"
        let pendingKey = "agentic30.posthog.once.pending.\(onceKey)"
        Self.clearCaptureOnceState(defaultsKey: defaultsKey, pendingKey: pendingKey)

        var sentPayloads: [[String: Any]] = []
        PostHogTelemetry.configurationProvider = {
            PostHogTelemetryConfig(projectAPIKey: "phc_test", host: "https://us.posthog.com")
        }
        PostHogTelemetry.sender = { url, payload, completion in
            XCTAssertEqual(url.absoluteString, "https://us.i.posthog.com/i/v0/e/")
            sentPayloads.append(payload)
            completion(false)
        }
        defer {
            PostHogTelemetry.resetTestingHooks()
            Self.clearCaptureOnceState(defaultsKey: defaultsKey, pendingKey: pendingKey)
        }

        XCTAssertTrue(PostHogTelemetry.captureOnce(
            "dmg_install_completed",
            onceKey: onceKey,
            properties: ["event_schema_version": 1]
        ))

        XCTAssertFalse(UserDefaults.standard.bool(forKey: defaultsKey))
        XCTAssertNotNil(UserDefaults.standard.data(forKey: pendingKey))

        PostHogTelemetry.sender = { _, payload, completion in
            sentPayloads.append(payload)
            completion(true)
        }
        PostHogTelemetry.flushPendingOnceCaptures()

        XCTAssertTrue(UserDefaults.standard.bool(forKey: defaultsKey))
        XCTAssertNil(UserDefaults.standard.data(forKey: pendingKey))
        XCTAssertEqual(sentPayloads.count, 2)
        XCTAssertEqual(sentPayloads[0]["uuid"] as? String, sentPayloads[1]["uuid"] as? String)
        XCTAssertEqual(sentPayloads[0]["timestamp"] as? String, sentPayloads[1]["timestamp"] as? String)
    }

    func testCaptureOnceDoesNotCompleteBeforeAsyncSenderCallback() {
        let onceKey = "test.capture.once.async.\(UUID().uuidString)"
        let defaultsKey = "agentic30.posthog.once.\(onceKey)"
        let pendingKey = "agentic30.posthog.once.pending.\(onceKey)"
        Self.clearCaptureOnceState(defaultsKey: defaultsKey, pendingKey: pendingKey)

        var sendCompletions: [(Bool) -> Void] = []
        var sentPayloads: [[String: Any]] = []
        PostHogTelemetry.configurationProvider = {
            PostHogTelemetryConfig(projectAPIKey: "phc_test", host: "https://us.posthog.com")
        }
        PostHogTelemetry.sender = { _, payload, completion in
            sentPayloads.append(payload)
            sendCompletions.append(completion)
        }
        defer {
            PostHogTelemetry.resetTestingHooks()
            Self.clearCaptureOnceState(defaultsKey: defaultsKey, pendingKey: pendingKey)
        }

        XCTAssertTrue(PostHogTelemetry.captureOnce(
            "dmg_install_completed",
            onceKey: onceKey,
            properties: ["event_schema_version": 1]
        ))
        XCTAssertFalse(UserDefaults.standard.bool(forKey: defaultsKey))
        XCTAssertNotNil(UserDefaults.standard.data(forKey: pendingKey))

        XCTAssertFalse(PostHogTelemetry.captureOnce(
            "dmg_install_completed",
            onceKey: onceKey,
            properties: ["event_schema_version": 1]
        ))
        XCTAssertEqual(sentPayloads.count, 1)

        sendCompletions.first?(true)

        XCTAssertTrue(UserDefaults.standard.bool(forKey: defaultsKey))
        XCTAssertNil(UserDefaults.standard.data(forKey: pendingKey))
    }

    func testCaptureOnceDoesNotPersistWhenNoSinkAndNoConfig() {
        let onceKey = "test.capture.once.no-config.\(UUID().uuidString)"
        let defaultsKey = "agentic30.posthog.once.\(onceKey)"
        let pendingKey = "agentic30.posthog.once.pending.\(onceKey)"
        let distinctIDKey = "agentic30.posthog.distinctId"
        Self.clearCaptureOnceState(defaultsKey: defaultsKey, pendingKey: pendingKey)

        // Capture distinct id BEFORE the call so we can assert no new id
        // gets generated for an unconfigured user.
        let distinctIDBefore = UserDefaults.standard.string(forKey: distinctIDKey)

        // No sink, configurationProvider returns nil — simulates the
        // common case of a user who never configured a PostHog key.
        PostHogTelemetry.captureSink = nil
        PostHogTelemetry.configurationProvider = { nil }
        defer {
            PostHogTelemetry.resetTestingHooks()
            Self.clearCaptureOnceState(defaultsKey: defaultsKey, pendingKey: pendingKey)
        }

        XCTAssertFalse(PostHogTelemetry.captureOnce(
            "dmg_install_completed",
            onceKey: onceKey,
            properties: ["event_schema_version": 1]
        ))

        XCTAssertFalse(UserDefaults.standard.bool(forKey: defaultsKey))
        XCTAssertNil(UserDefaults.standard.data(forKey: pendingKey))
        // No new distinct id minted for the unconfigured user.
        XCTAssertEqual(UserDefaults.standard.string(forKey: distinctIDKey), distinctIDBefore)
    }

    private static func clearCaptureOnceState(defaultsKey: String, pendingKey: String) {
        UserDefaults.standard.removeObject(forKey: defaultsKey)
        UserDefaults.standard.removeObject(forKey: pendingKey)
    }
}
