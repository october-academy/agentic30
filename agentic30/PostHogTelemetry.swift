import Foundation
import PostHog

nonisolated struct PostHogTelemetryConfig: Equatable {
    /// Public PostHog project token for the Agentic30 project. This is safe to
    /// ship in client apps because it can only write capture events to public
    /// ingest endpoints; never replace it with a personal API key.
    static let publicProjectAPIKey = "phc_IXc1t2XtX4u1lOK8XHuiuE7Z0IwjiQSMxmG1rDWgMgA"
    static let defaultHost = "https://us.i.posthog.com"

    /// Environment variable names the Node sidecar reads to resolve its own
    /// PostHog capture config (`sidecar/telemetry.mjs`). The Swift shell must
    /// forward the resolved values via `PostHogTelemetry.sidecarEnvironmentOverrides()`:
    /// the sidecar has no embedded fallback key, so without this it silently
    /// drops every event.
    static let projectTokenEnvironmentKey = "POSTHOG_PROJECT_TOKEN"
    static let projectAPIKeyEnvironmentKey = "POSTHOG_PROJECT_API_KEY"
    static let hostEnvironmentKey = "POSTHOG_HOST"

    let projectAPIKey: String
    let host: String
}

struct PostHogTelemetryRuntimePolicy: Equatable {
    static let disableTelemetryEnvironmentKey = "AGENTIC30_DISABLE_TELEMETRY"
    static let enableDevelopmentTelemetryEnvironmentKey = "AGENTIC30_ENABLE_DEV_TELEMETRY"
    static let telemetryEnvironmentEnvironmentKey = "AGENTIC30_TELEMETRY_ENVIRONMENT"
    static let buildConfigurationEnvironmentKey = "AGENTIC30_BUILD_CONFIGURATION"
    static let internalTrafficEnvironmentKey = "AGENTIC30_INTERNAL_TRAFFIC"

    let telemetryEnvironment: String
    let buildConfiguration: String
    let isInternalTraffic: Bool
    let isDevelopmentTelemetryEnabled: Bool
    let isSuppressed: Bool

    var environmentVariables: [String: String] {
        [
            Self.telemetryEnvironmentEnvironmentKey: telemetryEnvironment,
            Self.buildConfigurationEnvironmentKey: buildConfiguration,
            Self.internalTrafficEnvironmentKey: isInternalTraffic ? "1" : "0",
        ]
    }

    static func resolve(
        isDebugBuild: Bool,
        environment: [String: String],
        arguments: [String]
    ) -> PostHogTelemetryRuntimePolicy {
        let telemetryEnvironment = isDebugBuild ? "development" : "production"
        let buildConfiguration = isDebugBuild ? "debug" : "release"
        let isDevelopmentTelemetryEnabled = isTruthy(environment[enableDevelopmentTelemetryEnvironmentKey])
        let isSuppressed = isTruthy(environment[disableTelemetryEnvironmentKey])
            || arguments.contains(where: { $0.hasPrefix("--ui-testing-") })
            || environment["XCTestConfigurationFilePath"] != nil
            || arguments.contains(where: { $0.contains(".xctest") })
            || (isDebugBuild && !isDevelopmentTelemetryEnabled)

        return PostHogTelemetryRuntimePolicy(
            telemetryEnvironment: telemetryEnvironment,
            buildConfiguration: buildConfiguration,
            isInternalTraffic: isDebugBuild || isTruthy(environment[internalTrafficEnvironmentKey]),
            isDevelopmentTelemetryEnabled: isDevelopmentTelemetryEnabled,
            isSuppressed: isSuppressed
        )
    }

    static func isTruthy(_ value: String?) -> Bool {
        guard let value else { return false }
        switch value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() {
        case "1", "true", "yes", "on":
            return true
        default:
            return false
        }
    }
}

struct PostHogTelemetryCapture {
    let event: String
    let properties: [String: Any]
    let timestamp: Date
    let isException: Bool
}

enum PostHogTelemetryLogLevel: Equatable {
    case trace
    case debug
    case info
    case warn
    case error
    case fatal
}

protocol PostHogTelemetrySDKClient: AnyObject {
    var configuredConfig: PostHogTelemetryConfig? { get }

    func setup(config: PostHogTelemetryConfig, disabled: Bool)
    func capture(_ event: String, distinctId: String, properties: [String: Any])
    func captureException(_ error: Error, properties: [String: Any])
    func captureLog(_ message: String, level: PostHogTelemetryLogLevel, attributes: [String: Any])
    func identify(_ distinctId: String, userProperties: [String: Any])
    func reset()
    func optOut()
    func optIn()
    func flush()
}

final class PostHogSDKTelemetryClient: PostHogTelemetrySDKClient {
    private(set) var configuredConfig: PostHogTelemetryConfig?

    func setup(config: PostHogTelemetryConfig, disabled: Bool) {
        let wasConfigured = configuredConfig != nil
        configuredConfig = config

        if wasConfigured {
            PostHogSDK.shared.close()
        }

        let sdkConfig = PostHogConfig(projectToken: config.projectAPIKey, host: config.host)
        sdkConfig.captureApplicationLifecycleEvents = true
        sdkConfig.captureScreenViews = true
        sdkConfig.enableSwizzling = true
        sdkConfig.preloadFeatureFlags = true
        sdkConfig.sendFeatureFlagEvent = true
        sdkConfig.setDefaultPersonProperties = true
        sdkConfig.personProfiles = .identifiedOnly
        sdkConfig.optOut = disabled
        sdkConfig.errorTrackingConfig.autoCapture = true
        sdkConfig.logs.serviceName = "agentic30-mac"
        sdkConfig.logs.serviceVersion = PostHogTelemetry.appVersionDescription()
        sdkConfig.logs.environment = PostHogTelemetry.currentTelemetryEnvironment
        sdkConfig.setBeforeSend { event in
            event.properties = PostHogTelemetry.sanitizeAndAttachRuntimeProperties(event.properties)
            return event
        }
        sdkConfig.logs.setBeforeSend { record in
            record.attributes = PostHogTelemetry.sanitizeAndAttachRuntimeProperties(record.attributes)
            return record
        }

        PostHogSDK.shared.setup(sdkConfig)

        if disabled {
            PostHogSDK.shared.optOut()
        } else {
            PostHogSDK.shared.optIn()
        }
    }

    func capture(_ event: String, distinctId: String, properties: [String: Any]) {
        PostHogSDK.shared.capture(event, distinctId: distinctId, properties: properties)
    }

    func captureException(_ error: Error, properties: [String: Any]) {
        PostHogSDK.shared.captureException(error, properties: properties)
    }

    func captureLog(_ message: String, level: PostHogTelemetryLogLevel, attributes: [String: Any]) {
        PostHogSDK.shared.captureLog(message, level: level.sdkLevel, attributes: attributes)
    }

    func identify(_ distinctId: String, userProperties: [String: Any]) {
        PostHogSDK.shared.identify(distinctId, userProperties: userProperties)
    }

    func reset() {
        PostHogSDK.shared.reset()
    }

    func optOut() {
        PostHogSDK.shared.optOut()
    }

    func optIn() {
        PostHogSDK.shared.optIn()
    }

    func flush() {
        PostHogSDK.shared.flush()
    }
}

private extension PostHogTelemetryLogLevel {
    var sdkLevel: PostHogLogSeverity {
        switch self {
        case .trace: .trace
        case .debug: .debug
        case .info: .info
        case .warn: .warn
        case .error: .error
        case .fatal: .fatal
        }
    }
}

enum PostHogTelemetrySanitizer {
    nonisolated private static let suffixOnlyKeys: Set<String> = [
        "payment_key",
        "billing_key",
        "customer_key",
        "event_key",
    ]

    nonisolated private static let redactedKeyPatterns = [
        "token",
        "secret",
        "authorization",
        "password",
        "signature",
        "api_key",
        "prompt",
        "transcript",
        "tool_output",
        "file_content",
    ]

    nonisolated private static let redactedExactKeys: Set<String> = [
        "content",
        "message",
        "prompt_body",
        "prompt_text",
        "raw_prompt",
        "tool_result",
        "tool_response",
    ]

    nonisolated static func sanitize(_ properties: [String: Any]) -> [String: Any] {
        var sanitized: [String: Any] = [:]
        for (key, value) in properties {
            merge(sanitizeEntry(key: key, value: value), into: &sanitized)
        }
        return sanitized
    }

    nonisolated static func emailDomain(_ value: String?) -> String? {
        guard let value,
              let atIndex = value.lastIndex(of: "@")
        else { return nil }

        let domain = value[value.index(after: atIndex)...]
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
        return domain.isEmpty ? nil : domain
    }

    nonisolated static func maskedSuffix(_ value: String?) -> String? {
        guard let value else { return nil }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        return String(trimmed.suffix(6))
    }

    nonisolated private static func sanitizeEntry(key: String, value: Any) -> [String: Any] {
        let normalizedKey = key.lowercased()

        if normalizedKey == "email" || normalizedKey == "auth_email" {
            guard let domain = emailDomain(String(describing: value)) else { return [:] }
            return ["\(key)_domain": domain]
        }

        if suffixOnlyKeys.contains(normalizedKey) {
            if let suffix = maskedSuffix(String(describing: value)) {
                return ["\(key)_suffix": suffix]
            }
            return ["has_\(key)": false]
        }

        if redactedExactKeys.contains(normalizedKey)
            || redactedKeyPatterns.contains(where: { normalizedKey.contains($0) }) {
            return [key: "[redacted]"]
        }

        if (normalizedKey.hasSuffix("root") || normalizedKey.hasSuffix("path")),
           let stringValue = value as? String,
           isAbsoluteLocalPath(stringValue) {
            let basename = URL(fileURLWithPath: stringValue).lastPathComponent
            return [basenameKey(for: key): basename.isEmpty ? stringValue : basename]
        }

        switch value {
        case let string as String:
            return [key: string]
        case let bool as Bool:
            return [key: bool]
        case let int as Int:
            return [key: int]
        case let double as Double:
            return [key: double]
        case let number as NSNumber:
            return [key: number]
        case let date as Date:
            return [key: ISO8601DateFormatter().string(from: date)]
        case let url as URL:
            return [key: url.absoluteString]
        case let strings as [String]:
            return [key: strings]
        case let bools as [Bool]:
            return [key: bools]
        case let ints as [Int]:
            return [key: ints]
        case let dictionaries as [[String: Any]]:
            return [key: dictionaries.map(sanitize)]
        case let dictionary as [String: Any]:
            return [key: sanitize(dictionary)]
        default:
            return [key: String(describing: value)]
        }
    }

    nonisolated private static func isAbsoluteLocalPath(_ value: String) -> Bool {
        value.hasPrefix("/") || value.range(of: #"^[A-Za-z]:[\\/]"#, options: .regularExpression) != nil
    }

    nonisolated private static func basenameKey(for key: String) -> String {
        if key.hasSuffix("_root") {
            return String(key.dropLast(5)) + "_basename"
        }
        if key.hasSuffix("_path") {
            return String(key.dropLast(5)) + "_basename"
        }
        if key.hasSuffix("Root") {
            return String(key.dropLast(4)) + "Basename"
        }
        if key.hasSuffix("Path") {
            return String(key.dropLast(4)) + "Basename"
        }
        return key + "_basename"
    }

    nonisolated private static func merge(_ source: [String: Any], into target: inout [String: Any]) {
        for (key, value) in source {
            target[key] = value
        }
    }
}

enum PostHogHostResolver {
    nonisolated static func ingestBaseURL(for rawHost: String) -> URL? {
        let trimmed = rawHost.trimmingCharacters(in: .whitespacesAndNewlines)
        let candidate = trimmed.isEmpty ? PostHogTelemetryConfig.defaultHost : trimmed
        let normalized = candidate.contains("://") ? candidate : "https://\(candidate)"

        guard let url = URL(string: normalized),
              let host = url.host?.lowercased()
        else { return nil }

        let scheme = url.scheme ?? "https"

        if host == "us.posthog.com" {
            return URL(string: "\(scheme)://us.i.posthog.com")
        }

        if host == "eu.posthog.com" {
            return URL(string: "\(scheme)://eu.i.posthog.com")
        }

        if host == "us.i.posthog.com" || host == "eu.i.posthog.com" {
            return URL(string: "\(scheme)://\(host)")
        }

        return URL(string: "\(scheme)://\(host)")
    }
}

enum PostHogTelemetry {
    static let telemetryDisabledDefaultsKey = "agentic30.posthog.telemetryDisabled"
    static let internalTrafficDefaultsKey = "agentic30.posthog.internalTraffic"
    static let bundleProjectAPIKeyInfoPlistKey = "Agentic30PostHogProjectAPIKey"
    static let bundleHostInfoPlistKey = "Agentic30PostHogHost"
    private static let distinctIDDefaultsKey = "agentic30.posthog.distinctId"
    private static let internalTesterIdentifiedDefaultsPrefix = "agentic30.posthog.internalTesterIdentified."
    private static let captureOnceDefaultsPrefix = "agentic30.posthog.once."
    private static let stalePendingOnceDefaultsPrefix = "agentic30.posthog.once.pending."
    private static let captureFileEnvironmentKey = "AGENTIC30_TELEMETRY_CAPTURE_FILE"
    private static let captureFileLock = NSLock()
    private static let captureOnceLock = NSLock()
    private static let clientLock = NSLock()
    private static let defaultClient = PostHogSDKTelemetryClient()
    private static let internalEmailDomain = "october-academy.com"
    private static var activeConfig: PostHogTelemetryConfig?
    private static var activeDisabled: Bool?
    private static var isConfiguring = false
    private static var configurationGeneration = 0

    private enum ClientConfigurationAction {
        case setup(config: PostHogTelemetryConfig, disabled: Bool, generation: Int)
        case optOut
        case optIn
        case none
    }

    static var captureSink: ((PostHogTelemetryCapture) -> Void)?
    static var configurationProvider: (() -> PostHogTelemetryConfig?)?
    static var sdkClient: PostHogTelemetrySDKClient = defaultClient

    /// True if any prior launch that ran `capture(...)` already persisted the
    /// anonymous distinct ID. Used by the app delegate to suppress
    /// `dmg_install_completed` for users upgrading from a prior build.
    /// Edge case: users who only ran prior builds with telemetry fully
    /// disabled (no distinct ID generated) will register as first-install
    /// here. That subset is small, and if telemetry stays disabled the gated
    /// `captureOnce` is a no-op anyway.
    static var hasPreviouslyGeneratedDistinctID: Bool {
        UserDefaults.standard.string(forKey: distinctIDDefaultsKey) != nil
    }

    /// Persistent anonymous distinct ID shared with the Node sidecar so events
    /// captured by either process before sign-in resolve to the same PostHog
    /// person. Sign-in flips both sides to `auth.userId` via `distinctID(for:)`.
    static func anonymousDistinctID() -> String {
        if let existing = UserDefaults.standard.string(forKey: distinctIDDefaultsKey),
           !existing.isEmpty {
            return existing
        }
        let generated = UUID().uuidString
        UserDefaults.standard.set(generated, forKey: distinctIDDefaultsKey)
        return generated
    }

    static func resetTestingHooks() {
        captureSink = nil
        configurationProvider = nil
        sdkClient = defaultClient
        clientLock.lock()
        activeConfig = nil
        activeDisabled = nil
        isConfiguring = false
        configurationGeneration = 0
        clientLock.unlock()
    }

    static var currentTelemetryEnvironment: String {
        currentRuntimePolicy.telemetryEnvironment
    }

    static func sidecarEnvironmentOverrides() -> [String: String] {
        var overrides = currentRuntimePolicy.environmentVariables
        let disabledByUserOrEnv = isTelemetryDisabledByUser
            || ProcessInfo.processInfo.environment[PostHogTelemetryRuntimePolicy.disableTelemetryEnvironmentKey] == "1"
        if disabledByUserOrEnv {
            overrides[PostHogTelemetryRuntimePolicy.disableTelemetryEnvironmentKey] = "1"
        }
        // Forward the same capture key/host the Swift SDK resolved (including the
        // public build fallback) so the sidecar can emit too. Without this the
        // sidecar's loadConfig() finds no phc_ key and drops every event.
        // loadConfig() already returns nil when telemetry is suppressed for this
        // process, so dev/test builds stay silent automatically.
        if !disabledByUserOrEnv, let config = loadConfig() {
            overrides[PostHogTelemetryConfig.projectAPIKeyEnvironmentKey] = config.projectAPIKey
            overrides[PostHogTelemetryConfig.hostEnvironmentKey] = config.host
        }
        return overrides
    }

    static func sanitizeAndAttachRuntimeProperties(_ properties: [String: Any]) -> [String: Any] {
        var sanitized = PostHogTelemetrySanitizer.sanitize(properties)
        for (key, value) in runtimeProperties() {
            sanitized[key] = value
        }
        if sanitized["platform"] == nil {
            sanitized["platform"] = "macos"
        }
        return sanitized
    }

    static func setup(force: Bool = false) {
        _ = ensureConfigured(force: force)
    }

    static func reloadConfiguration() {
        setup(force: true)
    }

    /// Fires an event and flushes the SDK queue immediately. The SDK owns
    /// durable queueing/retry semantics; this only asks it to flush before
    /// returning for terminate-time captures.
    @discardableResult
    static func captureBlocking(
        _ event: String,
        properties: [String: Any] = [:],
        authSession: MacAuthSession? = nil,
        timeout: TimeInterval = 1.5
    ) -> Bool {
        _ = timeout
        let extra = eventProperties(properties)

        if emitToConfiguredSink(
            event: event,
            extra: extra,
            authSession: authSession,
            isException: false
        ) {
            return true
        }

        guard ensureConfigured() else { return false }
        let resolvedDistinctID = distinctID(for: authSession)
        sdkClient.capture(
            event,
            distinctId: resolvedDistinctID,
            properties: baseProperties(extra: extra, authSession: authSession, distinctID: resolvedDistinctID)
        )
        sdkClient.flush()
        return true
    }

    @discardableResult
    static func capture(
        _ event: String,
        properties: [String: Any] = [:],
        authSession: MacAuthSession? = nil
    ) -> Bool {
        let extra = eventProperties(properties)

        if emitToConfiguredSink(
            event: event,
            extra: extra,
            authSession: authSession,
            isException: false
        ) {
            return true
        }

        guard ensureConfigured() else { return false }
        let resolvedDistinctID = distinctID(for: authSession)
        sdkClient.capture(
            event,
            distinctId: resolvedDistinctID,
            properties: baseProperties(extra: extra, authSession: authSession, distinctID: resolvedDistinctID)
        )
        return true
    }

    @discardableResult
    static func captureOnce(
        _ event: String,
        onceKey: String,
        properties: [String: Any] = [:],
        authSession: MacAuthSession? = nil
    ) -> Bool {
        let defaultsKey = captureOnceDefaultsPrefix + onceKey
        let extra = eventProperties(properties)

        guard !isDisabledForCurrentProcess
                || configurationProvider != nil
                || hasConfiguredCaptureSink
        else { return false }

        captureOnceLock.lock()
        if UserDefaults.standard.bool(forKey: defaultsKey) {
            captureOnceLock.unlock()
            return false
        }
        UserDefaults.standard.set(true, forKey: defaultsKey)
        captureOnceLock.unlock()

        let didCapture: Bool
        if hasConfiguredCaptureSink {
            didCapture = emitToConfiguredSink(
                event: event,
                extra: extra,
                authSession: authSession,
                isException: false
            )
        } else {
            didCapture = capture(event, properties: properties, authSession: authSession)
        }

        if !didCapture {
            captureOnceLock.lock()
            UserDefaults.standard.removeObject(forKey: defaultsKey)
            captureOnceLock.unlock()
        }

        return didCapture
    }

    static func flushPendingOnceCaptures() {
        clearStalePendingOnceCaptures()
        guard ensureConfigured() else { return }
        sdkClient.flush()
    }

    static func captureException(
        _ error: Any,
        properties: [String: Any] = [:],
        handled: Bool = true,
        authSession: MacAuthSession? = nil
    ) {
        let wrappedError: Error
        if let err = error as? Error {
            wrappedError = err
        } else {
            wrappedError = NSError(
                domain: "Agentic30Telemetry",
                code: -1,
                userInfo: [NSLocalizedDescriptionKey: String(describing: error)]
            )
        }

        let extra = eventProperties(properties.merging([
            "platform": "macos",
            "handled": handled,
        ]) { _, new in new })

        if emitToConfiguredSink(
            event: "$exception",
            extra: extra,
            authSession: authSession,
            isException: true
        ) {
            return
        }

        guard ensureConfigured() else { return }
        sdkClient.captureException(wrappedError, properties: baseProperties(extra: extra, authSession: authSession))
    }

    static func captureLog(
        _ message: String,
        level: PostHogTelemetryLogLevel = .info,
        properties: [String: Any] = [:],
        authSession: MacAuthSession? = nil
    ) {
        guard ensureConfigured() else { return }
        sdkClient.captureLog(
            message,
            level: level,
            attributes: baseProperties(extra: eventProperties(properties), authSession: authSession)
        )
    }

    static func identify(authSession: MacAuthSession) {
        guard authSession.isUsable, ensureConfigured() else { return }

        var userProperties: [String: Any] = [
            "platform": "macos",
        ]
        if let emailDomain = PostHogTelemetrySanitizer.emailDomain(authSession.email) {
            userProperties["email_domain"] = emailDomain
            if emailDomain == internalEmailDomain {
                userProperties["is_internal_tester"] = true
            }
        }

        sdkClient.identify(
            authSession.userId,
            userProperties: PostHogTelemetrySanitizer.sanitize(userProperties)
        )
    }

    static func resetIdentity() {
        guard ensureConfigured() else { return }
        sdkClient.reset()
    }

    static var isTelemetryDisabledByUser: Bool {
        UserDefaults.standard.bool(forKey: telemetryDisabledDefaultsKey)
    }

    static func setTelemetryDisabledByUser(_ disabled: Bool) {
        UserDefaults.standard.set(disabled, forKey: telemetryDisabledDefaultsKey)
        _ = ensureConfigured()
    }

    static func loadConfigForTesting() -> PostHogTelemetryConfig? {
        loadConfig()
    }

    private static func ensureConfigured(force: Bool = false) -> Bool {
        guard let config = loadConfig() else { return false }
        let disabled = sdkDisabledState

        let action: ClientConfigurationAction
        clientLock.lock()
        if !force,
           isConfiguring,
           activeConfig == config,
           activeDisabled == disabled {
            clientLock.unlock()
            return !disabled || configurationProvider != nil
        }

        if force || activeConfig != config || sdkClient.configuredConfig != config {
            activeConfig = config
            activeDisabled = disabled
            isConfiguring = true
            configurationGeneration += 1
            action = .setup(config: config, disabled: disabled, generation: configurationGeneration)
        } else if activeDisabled != disabled {
            activeDisabled = disabled
            action = disabled ? .optOut : .optIn
        } else {
            action = .none
        }
        clientLock.unlock()

        switch action {
        case .setup(let config, let disabled, let generation):
            sdkClient.setup(config: config, disabled: disabled)
            clientLock.lock()
            if activeConfig == config, configurationGeneration == generation {
                isConfiguring = false
            }
            clientLock.unlock()
        case .optOut:
            sdkClient.optOut()
        case .optIn:
            sdkClient.optIn()
        case .none:
            break
        }
        if !disabled {
            identifyInternalTesterIfNeeded()
        }
        return !disabled || configurationProvider != nil
    }

    private static func loadConfig() -> PostHogTelemetryConfig? {
        if let configurationProvider {
            return configurationProvider().flatMap(normalizedConfig)
        }

        guard !isTelemetrySuppressedForCurrentProcess else { return nil }

        let environment = ProcessInfo.processInfo.environment
        let settings = KeychainHelper.loadSettings()
        let resolvedProjectKey = projectAPIKey(from: settings.posthogProjectAPIKey)
            ?? projectAPIKey(from: settings.posthogApiKey)
            ?? projectAPIKey(fromEnvironment: environment)
            ?? bundleProjectAPIKey
            ?? PostHogTelemetryConfig.publicProjectAPIKey

        let rawHost = configurationValue(settings.posthogHost)
            ?? configurationValue(environment[PostHogTelemetryConfig.hostEnvironmentKey])
            ?? bundleHost
            ?? PostHogTelemetryConfig.defaultHost

        return normalizedConfig(PostHogTelemetryConfig(projectAPIKey: resolvedProjectKey, host: rawHost))
    }

    nonisolated static func projectAPIKey(fromEnvironment environment: [String: String]) -> String? {
        projectAPIKey(from: environment[PostHogTelemetryConfig.projectAPIKeyEnvironmentKey])
            ?? projectAPIKey(from: environment[PostHogTelemetryConfig.projectTokenEnvironmentKey])
    }

    nonisolated static func projectAPIKey(from rawValue: String?) -> String? {
        guard let value = configurationValue(rawValue),
              value.hasPrefix("phc_")
        else { return nil }
        return value
    }

    nonisolated private static func configurationValue(_ rawValue: String?) -> String? {
        guard let value = rawValue?.trimmingCharacters(in: .whitespacesAndNewlines),
              !value.isEmpty,
              !value.contains("$(")
        else { return nil }
        return value
    }

    nonisolated private static func normalizedConfig(_ config: PostHogTelemetryConfig) -> PostHogTelemetryConfig? {
        guard let ingestBaseURL = PostHogHostResolver.ingestBaseURL(for: config.host) else { return nil }
        return PostHogTelemetryConfig(projectAPIKey: config.projectAPIKey, host: ingestBaseURL.absoluteString)
    }

    /// Build-time embedded fallbacks. Distribution builds inject
    /// `Agentic30PostHogProjectAPIKey` / `Agentic30PostHogHost` into Info.plist
    /// via xcconfig so every install reports telemetry by default. The user can
    /// override per-install via Settings (Keychain) or disable globally via the
    /// Settings opt-out toggle. Builds without the xcconfig values leave the
    /// raw `$(...)` placeholder in Info.plist — guarded here.
    private static var bundleProjectAPIKey: String? {
        projectAPIKey(from: Bundle.main.object(forInfoDictionaryKey: bundleProjectAPIKeyInfoPlistKey) as? String)
    }

    private static var bundleHost: String? {
        configurationValue(Bundle.main.object(forInfoDictionaryKey: bundleHostInfoPlistKey) as? String)
    }

    private static var isDisabledForCurrentProcess: Bool {
        isTelemetrySuppressedForCurrentProcess
            || isTelemetryDisabledByUser
    }

    private static var currentRuntimePolicy: PostHogTelemetryRuntimePolicy {
        runtimePolicy(
            isDebugBuild: isDebugBuild,
            environment: ProcessInfo.processInfo.environment,
            arguments: CommandLine.arguments
        )
    }

    static func runtimePolicyForTesting(
        isDebugBuild: Bool,
        environment: [String: String],
        arguments: [String]
    ) -> PostHogTelemetryRuntimePolicy {
        runtimePolicy(isDebugBuild: isDebugBuild, environment: environment, arguments: arguments)
    }

    private static func runtimePolicy(
        isDebugBuild: Bool,
        environment: [String: String],
        arguments: [String]
    ) -> PostHogTelemetryRuntimePolicy {
        PostHogTelemetryRuntimePolicy.resolve(
            isDebugBuild: isDebugBuild,
            environment: environmentByApplyingLocalInternalTrafficOverride(to: environment),
            arguments: arguments
        )
    }

    private static func environmentByApplyingLocalInternalTrafficOverride(
        to environment: [String: String]
    ) -> [String: String] {
        guard UserDefaults.standard.bool(forKey: internalTrafficDefaultsKey) else {
            return environment
        }
        var resolved = environment
        resolved[PostHogTelemetryRuntimePolicy.internalTrafficEnvironmentKey] = "1"
        return resolved
    }

    private static var isDebugBuild: Bool {
        #if DEBUG
            return true
        #else
            return false
        #endif
    }

    private static var isTelemetrySuppressedForCurrentProcess: Bool {
        currentRuntimePolicy.isSuppressed
    }

    private static var sdkDisabledState: Bool {
        isTelemetryDisabledByUser
            || (configurationProvider == nil && isTelemetrySuppressedForCurrentProcess)
    }

    private static var isExplicitInternalTrafficOverrideEnabled: Bool {
        UserDefaults.standard.bool(forKey: internalTrafficDefaultsKey)
            || PostHogTelemetryRuntimePolicy.isTruthy(
                ProcessInfo.processInfo.environment[PostHogTelemetryRuntimePolicy.internalTrafficEnvironmentKey]
            )
    }

    private static func identifyInternalTesterIfNeeded() {
        guard isExplicitInternalTrafficOverrideEnabled else { return }
        let distinctID = anonymousDistinctID()
        let defaultsKey = internalTesterIdentifiedDefaultsPrefix + distinctID
        guard !UserDefaults.standard.bool(forKey: defaultsKey) else { return }

        sdkClient.identify(
            distinctID,
            userProperties: PostHogTelemetrySanitizer.sanitize([
                "platform": "macos",
                "is_internal_tester": true,
            ])
        )
        UserDefaults.standard.set(true, forKey: defaultsKey)
    }

    private static var hasConfiguredCaptureSink: Bool {
        captureSink != nil
            || ProcessInfo.processInfo.environment[captureFileEnvironmentKey]?.nonEmpty != nil
    }

    private static func emitToConfiguredSink(
        event: String,
        extra: [String: Any],
        authSession: MacAuthSession?,
        isException: Bool
    ) -> Bool {
        let capture = PostHogTelemetryCapture(
            event: event,
            properties: baseProperties(extra: extra, authSession: authSession),
            timestamp: Date(),
            isException: isException
        )

        var handled = false
        if let captureSink {
            captureSink(capture)
            handled = true
        }
        if let path = ProcessInfo.processInfo.environment[captureFileEnvironmentKey]?.nonEmpty {
            appendCapture(capture, to: path)
            handled = true
        }
        return handled
    }

    private static func appendCapture(_ capture: PostHogTelemetryCapture, to path: String) {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let record: [String: Any] = [
            "event": capture.event,
            "properties": capture.properties,
            "timestamp": formatter.string(from: capture.timestamp),
            "is_exception": capture.isException,
        ]
        guard JSONSerialization.isValidJSONObject(record),
              let data = try? JSONSerialization.data(withJSONObject: record, options: [.sortedKeys]),
              let newline = "\n".data(using: .utf8)
        else { return }

        let url = URL(fileURLWithPath: path)
        captureFileLock.lock()
        defer { captureFileLock.unlock() }

        try? FileManager.default.createDirectory(
            at: url.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        if !FileManager.default.fileExists(atPath: url.path) {
            FileManager.default.createFile(atPath: url.path, contents: nil)
        }
        guard let handle = try? FileHandle(forWritingTo: url) else { return }
        handle.seekToEndOfFile()
        handle.write(data)
        handle.write(newline)
        try? handle.close()
    }

    private static func clearStalePendingOnceCaptures() {
        let pendingKeys = UserDefaults.standard.dictionaryRepresentation().keys
            .filter { $0.hasPrefix(stalePendingOnceDefaultsPrefix) }
        for pendingKey in pendingKeys {
            UserDefaults.standard.removeObject(forKey: pendingKey)
        }
    }

    private static func baseProperties(
        extra: [String: Any],
        authSession: MacAuthSession?,
        distinctID: String? = nil
    ) -> [String: Any] {
        var properties = PostHogTelemetrySanitizer.sanitize(extra)
        properties["distinct_id"] = distinctID ?? Self.distinctID(for: authSession)

        if let session = authSession {
            properties["auth_user_id"] = session.userId
            if let emailDomain = PostHogTelemetrySanitizer.emailDomain(session.email) {
                properties["auth_email_domain"] = emailDomain
            }
        }

        return properties
    }

    private static func eventProperties(_ properties: [String: Any]) -> [String: Any] {
        let defaults: [String: Any] = [
            "$lib": "mac",
            "$lib_version": appVersionDescription(),
            "platform": "macos",
        ].merging(runtimeProperties()) { _, new in new }

        return properties.merging(defaults) { _, new in new }
    }

    private static func runtimeProperties() -> [String: Any] {
        let policy = currentRuntimePolicy
        return [
            "telemetry_environment": policy.telemetryEnvironment,
            "build_configuration": policy.buildConfiguration,
            "is_internal_traffic": policy.isInternalTraffic,
            "telemetry_source": "mac_app",
        ]
    }

    private static func distinctID(for authSession: MacAuthSession?) -> String {
        if let userID = authSession?.userId.nonEmpty {
            return userID
        }
        return anonymousDistinctID()
    }

    nonisolated static func appVersionDescription() -> String {
        let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String
        let build = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String

        switch (version?.nonEmpty, build?.nonEmpty) {
        case let (version?, build?):
            return "\(version) (\(build))"
        case let (version?, nil):
            return version
        case let (nil, build?):
            return build
        default:
            return "unknown"
        }
    }
}

private extension String {
    nonisolated var nonEmpty: String? {
        trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : self
    }
}
