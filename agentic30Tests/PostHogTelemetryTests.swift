import XCTest
@testable import agentic30

final class PostHogTelemetryTests: XCTestCase {
    func testPublicProjectTokenIsCaptureOnlyTokenShape() {
        XCTAssertTrue(PostHogTelemetryConfig.publicProjectAPIKey.hasPrefix("phc_"))
        XCTAssertEqual(PostHogTelemetryConfig.defaultHost, "https://us.i.posthog.com")
    }

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

    func testLoadConfigNormalizesHostToSDKIngestHost() {
        PostHogTelemetry.configurationProvider = {
            PostHogTelemetryConfig(projectAPIKey: "phc_test", host: "https://us.posthog.com")
        }
        defer { PostHogTelemetry.resetTestingHooks() }

        XCTAssertEqual(PostHogTelemetry.loadConfigForTesting()?.host, "https://us.i.posthog.com")
    }

    func testRuntimePolicySuppressesDebugTelemetryUnlessEnabled() {
        let suppressed = PostHogTelemetryRuntimePolicy.resolve(
            isDebugBuild: true,
            environment: [:],
            arguments: []
        )

        XCTAssertEqual(suppressed.telemetryEnvironment, "development")
        XCTAssertEqual(suppressed.buildConfiguration, "debug")
        XCTAssertTrue(suppressed.isInternalTraffic)
        XCTAssertFalse(suppressed.isDevelopmentTelemetryEnabled)
        XCTAssertTrue(suppressed.isSuppressed)

        let enabled = PostHogTelemetryRuntimePolicy.resolve(
            isDebugBuild: true,
            environment: [
                PostHogTelemetryRuntimePolicy.enableDevelopmentTelemetryEnvironmentKey: "1",
            ],
            arguments: []
        )

        XCTAssertEqual(enabled.telemetryEnvironment, "development")
        XCTAssertEqual(enabled.buildConfiguration, "debug")
        XCTAssertTrue(enabled.isInternalTraffic)
        XCTAssertTrue(enabled.isDevelopmentTelemetryEnabled)
        XCTAssertFalse(enabled.isSuppressed)
        XCTAssertEqual(
            enabled.environmentVariables[PostHogTelemetryRuntimePolicy.internalTrafficEnvironmentKey],
            "1"
        )
    }

    func testRuntimePolicyAllowsReleaseProductionTelemetry() {
        let policy = PostHogTelemetryRuntimePolicy.resolve(
            isDebugBuild: false,
            environment: [:],
            arguments: []
        )

        XCTAssertEqual(policy.telemetryEnvironment, "production")
        XCTAssertEqual(policy.buildConfiguration, "release")
        XCTAssertFalse(policy.isInternalTraffic)
        XCTAssertFalse(policy.isDevelopmentTelemetryEnabled)
        XCTAssertFalse(policy.isSuppressed)
        XCTAssertEqual(
            policy.environmentVariables[PostHogTelemetryRuntimePolicy.internalTrafficEnvironmentKey],
            "0"
        )
    }

    func testSanitizerMasksSensitiveFieldsLocalPathsAndContent() {
        let sanitized = PostHogTelemetrySanitizer.sanitize([
            "payment_key": "payment-fixture-1234567890",
            "workspace_root": "/Users/october/prj/agentic30",
            "doc_path": "docs/ICP.md",
            "auth_email": "founder@example.com",
            "prompt_text": "ship my private prompt",
            "tool_output": "private tool output",
            "nested": [
                "message": "chat transcript",
                "api_key": "secret",
            ],
        ])

        XCTAssertEqual(sanitized["payment_key_suffix"] as? String, "567890")
        XCTAssertEqual(sanitized["workspace_basename"] as? String, "agentic30")
        XCTAssertEqual(sanitized["doc_path"] as? String, "docs/ICP.md")
        XCTAssertEqual(sanitized["auth_email_domain"] as? String, "example.com")
        XCTAssertEqual(sanitized["prompt_text"] as? String, "[redacted]")
        XCTAssertEqual(sanitized["tool_output"] as? String, "[redacted]")
        XCTAssertEqual((sanitized["nested"] as? [String: Any])?["message"] as? String, "[redacted]")
        XCTAssertEqual((sanitized["nested"] as? [String: Any])?["api_key"] as? String, "[redacted]")
        XCTAssertNil(sanitized["payment_key"])
        XCTAssertNil(sanitized["workspace_root"])
        XCTAssertNil(sanitized["auth_email"])
    }

    func testCaptureUsesSDKClient() {
        let client = CapturingPostHogClient()
        PostHogTelemetry.sdkClient = client
        PostHogTelemetry.configurationProvider = {
            PostHogTelemetryConfig(projectAPIKey: "phc_test", host: "https://us.posthog.com")
        }
        defer { PostHogTelemetry.resetTestingHooks() }

        XCTAssertTrue(PostHogTelemetry.capture(
            "mac_probe",
            properties: ["workspace_root": "/tmp/agentic30", "prompt": "secret"]
        ))

        XCTAssertEqual(client.setupConfigs.first?.host, "https://us.i.posthog.com")
        XCTAssertEqual(client.captures.map(\.event), ["mac_probe"])
        XCTAssertEqual(client.captures.first?.properties["workspace_basename"] as? String, "agentic30")
        XCTAssertEqual(client.captures.first?.properties["prompt"] as? String, "[redacted]")
        XCTAssertEqual(client.captures.first?.properties["platform"] as? String, "macos")
        XCTAssertEqual(client.captures.first?.properties["telemetry_source"] as? String, "mac_app")
        #if DEBUG
            XCTAssertEqual(client.captures.first?.properties["telemetry_environment"] as? String, "development")
            XCTAssertEqual(client.captures.first?.properties["build_configuration"] as? String, "debug")
            XCTAssertEqual(client.captures.first?.properties["is_internal_traffic"] as? Bool, true)
        #else
            XCTAssertEqual(client.captures.first?.properties["telemetry_environment"] as? String, "production")
            XCTAssertEqual(client.captures.first?.properties["build_configuration"] as? String, "release")
            XCTAssertEqual(client.captures.first?.properties["is_internal_traffic"] as? Bool, false)
        #endif
    }

    func testSetupAllowsReentrantCaptureWithoutDeadlock() {
        let client = CapturingPostHogClient()
        let setupFinished = expectation(description: "PostHog setup finishes")
        PostHogTelemetry.sdkClient = client
        PostHogTelemetry.configurationProvider = {
            PostHogTelemetryConfig(projectAPIKey: "phc_test", host: "https://us.posthog.com")
        }
        client.onSetup = { _, _ in
            _ = PostHogTelemetry.capture("mac_reentrant_probe")
        }
        defer { PostHogTelemetry.resetTestingHooks() }

        DispatchQueue.global(qos: .userInitiated).async {
            PostHogTelemetry.setup()
            setupFinished.fulfill()
        }

        wait(for: [setupFinished], timeout: 1.0)
        XCTAssertEqual(client.setupConfigs.count, 1)
        XCTAssertEqual(client.captures.map(\.event), ["mac_reentrant_probe"])

        XCTAssertTrue(PostHogTelemetry.capture("mac_after_setup_probe"))
        XCTAssertEqual(client.setupConfigs.count, 1)
        XCTAssertEqual(client.captures.map(\.event), [
            "mac_reentrant_probe",
            "mac_after_setup_probe",
        ])
    }

    func testUserOptOutTogglesWithoutSetupRecursion() {
        let client = CapturingPostHogClient()
        let originalDisabled = PostHogTelemetry.isTelemetryDisabledByUser
        UserDefaults.standard.set(false, forKey: PostHogTelemetry.telemetryDisabledDefaultsKey)
        PostHogTelemetry.sdkClient = client
        PostHogTelemetry.configurationProvider = {
            PostHogTelemetryConfig(projectAPIKey: "phc_test", host: "https://us.posthog.com")
        }
        defer {
            UserDefaults.standard.set(originalDisabled, forKey: PostHogTelemetry.telemetryDisabledDefaultsKey)
            PostHogTelemetry.resetTestingHooks()
        }

        PostHogTelemetry.setup()
        PostHogTelemetry.setTelemetryDisabledByUser(true)
        PostHogTelemetry.setTelemetryDisabledByUser(false)

        XCTAssertEqual(client.setupConfigs.count, 1)
        XCTAssertEqual(client.setupDisabledFlags, [false])
        XCTAssertEqual(client.optOutCount, 1)
        XCTAssertEqual(client.optInCount, 1)
    }

    func testCaptureOnceDedupesByOnceKeyAndLeavesQueueToSDK() {
        let client = CapturingPostHogClient()
        let onceKey = "test.capture.once.\(UUID().uuidString)"
        let defaultsKey = "agentic30.posthog.once.\(onceKey)"
        let pendingKey = "agentic30.posthog.once.pending.\(onceKey)"
        Self.clearCaptureOnceState(defaultsKey: defaultsKey, pendingKey: pendingKey)

        PostHogTelemetry.sdkClient = client
        PostHogTelemetry.configurationProvider = {
            PostHogTelemetryConfig(projectAPIKey: "phc_test", host: "https://us.posthog.com")
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
        XCTAssertFalse(PostHogTelemetry.captureOnce(
            "dmg_install_completed",
            onceKey: onceKey,
            properties: ["event_schema_version": 1]
        ))

        XCTAssertTrue(UserDefaults.standard.bool(forKey: defaultsKey))
        XCTAssertNil(UserDefaults.standard.data(forKey: pendingKey))
        XCTAssertEqual(client.captures.map(\.event), ["dmg_install_completed"])
        XCTAssertEqual(client.captures.first?.properties["event_schema_version"] as? Int, 1)
    }

    func testCaptureOnceDoesNotPersistWhenNoSinkAndNoConfig() {
        let onceKey = "test.capture.once.no-config.\(UUID().uuidString)"
        let defaultsKey = "agentic30.posthog.once.\(onceKey)"
        let pendingKey = "agentic30.posthog.once.pending.\(onceKey)"
        let distinctIDKey = "agentic30.posthog.distinctId"
        Self.clearCaptureOnceState(defaultsKey: defaultsKey, pendingKey: pendingKey)

        let distinctIDBefore = UserDefaults.standard.string(forKey: distinctIDKey)
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
        XCTAssertEqual(UserDefaults.standard.string(forKey: distinctIDKey), distinctIDBefore)
    }

    func testCaptureBlockingFlushesSDKClient() {
        let client = CapturingPostHogClient()
        PostHogTelemetry.sdkClient = client
        PostHogTelemetry.configurationProvider = {
            PostHogTelemetryConfig(projectAPIKey: "phc_test", host: "https://us.posthog.com")
        }
        defer { PostHogTelemetry.resetTestingHooks() }

        let success = PostHogTelemetry.captureBlocking(
            "mac_app_terminating",
            timeout: 0.5
        )

        XCTAssertTrue(success)
        XCTAssertEqual(client.captures.map(\.event), ["mac_app_terminating"])
        XCTAssertEqual(client.flushCount, 1)
    }

    func testExceptionLogIdentifyResetAndOptOutUseSDKClient() {
        let client = CapturingPostHogClient()
        let originalDisabled = PostHogTelemetry.isTelemetryDisabledByUser
        let session = MacAuthSession(
            accessToken: "access",
            refreshToken: "refresh",
            expiresAt: nil,
            tokenType: "bearer",
            userId: "user_123",
            email: "founder@example.com",
            onboardingCompletedAt: "2026-05-01T00:00:00Z",
            termsAcceptedAt: "2026-05-01T00:00:00Z",
            termsVersion: "2026-04-15",
            privacyVersion: "2026-04-15"
        )

        PostHogTelemetry.sdkClient = client
        PostHogTelemetry.configurationProvider = {
            PostHogTelemetryConfig(projectAPIKey: "phc_test", host: "https://us.posthog.com")
        }
        defer {
            PostHogTelemetry.setTelemetryDisabledByUser(originalDisabled)
            PostHogTelemetry.resetTestingHooks()
        }

        PostHogTelemetry.captureException(
            NSError(domain: "Test", code: 1, userInfo: [NSLocalizedDescriptionKey: "Boom"]),
            properties: ["component": "unit_test"],
            authSession: session
        )
        PostHogTelemetry.captureLog(
            "sidecar failed",
            level: .error,
            properties: ["message": "private details"],
            authSession: session
        )
        PostHogTelemetry.identify(authSession: session)
        PostHogTelemetry.resetIdentity()
        PostHogTelemetry.setTelemetryDisabledByUser(true)
        PostHogTelemetry.setTelemetryDisabledByUser(false)

        XCTAssertEqual(client.exceptions.count, 1)
        XCTAssertEqual(client.exceptions.first?.properties["component"] as? String, "unit_test")
        XCTAssertEqual(client.logs.count, 1)
        XCTAssertEqual(client.logs.first?.level, .error)
        XCTAssertEqual(client.logs.first?.attributes["message"] as? String, "[redacted]")
        XCTAssertEqual(client.identifies.first?.distinctId, "user_123")
        XCTAssertEqual(client.identifies.first?.userProperties["email_domain"] as? String, "example.com")
        XCTAssertEqual(client.resetCount, 1)
        XCTAssertGreaterThanOrEqual(client.optOutCount, 1)
        XCTAssertGreaterThanOrEqual(client.optInCount, 1)
    }

    private static func clearCaptureOnceState(defaultsKey: String, pendingKey: String) {
        UserDefaults.standard.removeObject(forKey: defaultsKey)
        UserDefaults.standard.removeObject(forKey: pendingKey)
    }
}

private final class CapturingPostHogClient: PostHogTelemetrySDKClient {
    struct CapturedEvent {
        let event: String
        let distinctId: String
        let properties: [String: Any]
    }

    struct CapturedException {
        let error: Error
        let properties: [String: Any]
    }

    struct CapturedLog {
        let message: String
        let level: PostHogTelemetryLogLevel
        let attributes: [String: Any]
    }

    struct Identify {
        let distinctId: String
        let userProperties: [String: Any]
    }

    private(set) var configuredConfig: PostHogTelemetryConfig?
    private(set) var setupConfigs: [PostHogTelemetryConfig] = []
    private(set) var setupDisabledFlags: [Bool] = []
    private(set) var captures: [CapturedEvent] = []
    private(set) var exceptions: [CapturedException] = []
    private(set) var logs: [CapturedLog] = []
    private(set) var identifies: [Identify] = []
    private(set) var resetCount = 0
    private(set) var optOutCount = 0
    private(set) var optInCount = 0
    private(set) var flushCount = 0
    var onSetup: ((PostHogTelemetryConfig, Bool) -> Void)?

    func setup(config: PostHogTelemetryConfig, disabled: Bool) {
        configuredConfig = config
        setupConfigs.append(config)
        setupDisabledFlags.append(disabled)
        onSetup?(config, disabled)
    }

    func capture(_ event: String, distinctId: String, properties: [String: Any]) {
        captures.append(CapturedEvent(event: event, distinctId: distinctId, properties: properties))
    }

    func captureException(_ error: Error, properties: [String: Any]) {
        exceptions.append(CapturedException(error: error, properties: properties))
    }

    func captureLog(_ message: String, level: PostHogTelemetryLogLevel, attributes: [String: Any]) {
        logs.append(CapturedLog(message: message, level: level, attributes: attributes))
    }

    func identify(_ distinctId: String, userProperties: [String: Any]) {
        identifies.append(Identify(distinctId: distinctId, userProperties: userProperties))
    }

    func reset() {
        resetCount += 1
    }

    func optOut() {
        optOutCount += 1
    }

    func optIn() {
        optInCount += 1
    }

    func flush() {
        flushCount += 1
    }
}
