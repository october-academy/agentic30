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
            "payment_key": "dummy-payment-token-abcdef",
            "workspace_root": "/Users/october/prj/agentic30",
            "doc_path": "docs/ICP.md",
            "auth_email": "founder@example.com",
        ])

        XCTAssertEqual(sanitized["payment_key_suffix"] as? String, "abcdef")
        XCTAssertEqual(sanitized["workspace_basename"] as? String, "agentic30")
        XCTAssertEqual(sanitized["doc_path"] as? String, "docs/ICP.md")
        XCTAssertEqual(sanitized["auth_email_domain"] as? String, "example.com")
        XCTAssertNil(sanitized["payment_key"])
        XCTAssertNil(sanitized["workspace_root"])
        XCTAssertNil(sanitized["auth_email"])
    }
}
