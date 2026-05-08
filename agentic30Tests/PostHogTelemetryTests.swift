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

}
