import Foundation

struct PostHogTelemetryConfig {
    let projectAPIKey: String
    let host: String
}

struct PostHogTelemetryCapture {
    let event: String
    let properties: [String: Any]
    let timestamp: Date
    let isException: Bool
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

        if redactedKeyPatterns.contains(where: { normalizedKey.contains($0) }) {
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
    static func ingestBaseURL(for rawHost: String) -> URL? {
        let trimmed = rawHost.trimmingCharacters(in: .whitespacesAndNewlines)
        let candidate = trimmed.isEmpty ? "https://us.posthog.com" : trimmed
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
    private static let distinctIDDefaultsKey = "agentic30.posthog.distinctId"
    private static let captureOnceDefaultsPrefix = "agentic30.posthog.once."
    private static let captureFileEnvironmentKey = "AGENTIC30_TELEMETRY_CAPTURE_FILE"
    private static let captureFileLock = NSLock()
    private static let captureOnceLock = NSLock()

    static var captureSink: ((PostHogTelemetryCapture) -> Void)?

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

    @discardableResult
    static func capture(
        _ event: String,
        properties: [String: Any] = [:],
        authSession: MacAuthSession? = nil
    ) -> Bool {
        let extra = properties.merging([
            "$lib": "mac",
            "$lib_version": appVersionDescription(),
            "platform": "macos",
        ]) { _, new in new }

        if emitToConfiguredSink(
            event: event,
            extra: extra,
            authSession: authSession,
            isException: false
        ) {
            return true
        }

        guard let config = loadConfig(),
              let ingestBaseURL = PostHogHostResolver.ingestBaseURL(for: config.host),
              let url = URL(string: "capture/", relativeTo: ingestBaseURL)
        else { return false }

        let payload: [String: Any] = [
            "api_key": config.projectAPIKey,
            "event": event,
            "distinct_id": distinctID(for: authSession),
            "properties": baseProperties(
                extra: extra,
                authSession: authSession
            ),
            "timestamp": ISO8601DateFormatter().string(from: Date()),
        ]

        send(url: url, payload: payload)
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

        captureOnceLock.lock()
        if UserDefaults.standard.bool(forKey: defaultsKey) {
            captureOnceLock.unlock()
            return false
        }
        UserDefaults.standard.set(true, forKey: defaultsKey)
        captureOnceLock.unlock()

        let didCapture = capture(event, properties: properties, authSession: authSession)
        if !didCapture {
            captureOnceLock.lock()
            UserDefaults.standard.removeObject(forKey: defaultsKey)
            captureOnceLock.unlock()
        }
        return didCapture
    }

    static func captureException(
        _ error: Any,
        properties: [String: Any] = [:],
        handled: Bool = true,
        authSession: MacAuthSession? = nil
    ) {
        let exceptionType = String(describing: type(of: error))
        let exceptionValue: String
        if let err = error as? Error {
            exceptionValue = err.localizedDescription
        } else {
            exceptionValue = String(describing: error)
        }

        let exceptionPayload: [String: Any] = [
            "type": exceptionType,
            "value": exceptionValue,
            "mechanism": [
                "handled": handled,
                "synthetic": false,
            ],
            "stacktrace": [
                "type": "raw",
                "frames": callStackFrames(),
            ],
        ]

        let extra = properties.merging([
            "$exception_list": [exceptionPayload],
            "$exception_level": "error",
            "$lib": "mac",
            "$lib_version": appVersionDescription(),
            "platform": "macos",
            "handled": handled,
        ]) { _, new in new }

        if emitToConfiguredSink(
            event: "$exception",
            extra: extra,
            authSession: authSession,
            isException: true
        ) {
            return
        }

        guard let config = loadConfig(),
              let ingestBaseURL = PostHogHostResolver.ingestBaseURL(for: config.host),
              let url = URL(string: "i/v0/e/", relativeTo: ingestBaseURL)
        else { return }

        let payload: [String: Any] = [
            "token": config.projectAPIKey,
            "event": "$exception",
            "properties": baseProperties(
                extra: extra,
                authSession: authSession
            ),
            "timestamp": ISO8601DateFormatter().string(from: Date()),
        ]

        send(url: url, payload: payload)
    }

    private static func loadConfig() -> PostHogTelemetryConfig? {
        guard !isDisabledForCurrentProcess else { return nil }

        let settings = KeychainHelper.loadSettings()
        let resolvedProjectKey = settings.posthogProjectAPIKey.nonEmpty
            ?? (settings.posthogApiKey.hasPrefix("phc_") ? settings.posthogApiKey : nil)
            ?? ProcessInfo.processInfo.environment["POSTHOG_PROJECT_TOKEN"]?
                .trimmingCharacters(in: .whitespacesAndNewlines)
                .nonEmpty

        guard let projectAPIKey = resolvedProjectKey, !projectAPIKey.isEmpty else {
            return nil
        }

        let host = settings.posthogHost.nonEmpty
            ?? ProcessInfo.processInfo.environment["POSTHOG_HOST"]?
                .trimmingCharacters(in: .whitespacesAndNewlines)
                .nonEmpty
            ?? "https://us.posthog.com"
        return PostHogTelemetryConfig(projectAPIKey: projectAPIKey, host: host)
    }

    private static var isDisabledForCurrentProcess: Bool {
        ProcessInfo.processInfo.environment["AGENTIC30_DISABLE_TELEMETRY"] == "1"
            || CommandLine.arguments.contains(where: { $0.hasPrefix("--ui-testing-") })
            || ProcessInfo.processInfo.environment["XCTestConfigurationFilePath"] != nil
            || CommandLine.arguments.contains(where: { $0.contains(".xctest") })
    }

    private static func send(url: URL, payload: [String: Any]) {
        guard JSONSerialization.isValidJSONObject(payload),
              let body = try? JSONSerialization.data(withJSONObject: payload, options: [])
        else { return }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = body

        URLSession.shared.dataTask(with: request).resume()
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

    private static func baseProperties(
        extra: [String: Any],
        authSession: MacAuthSession?
    ) -> [String: Any] {
        var properties = PostHogTelemetrySanitizer.sanitize(extra)
        properties["distinct_id"] = distinctID(for: authSession)

        if let session = authSession {
            properties["auth_user_id"] = session.userId
            if let emailDomain = PostHogTelemetrySanitizer.emailDomain(session.email) {
                properties["auth_email_domain"] = emailDomain
            }
        }

        return properties
    }

    private static func distinctID(for authSession: MacAuthSession?) -> String {
        if let userID = authSession?.userId.nonEmpty {
            return userID
        }

        if let existing = UserDefaults.standard.string(forKey: distinctIDDefaultsKey),
           !existing.isEmpty {
            return existing
        }

        let generated = UUID().uuidString
        UserDefaults.standard.set(generated, forKey: distinctIDDefaultsKey)
        return generated
    }
    private static func callStackFrames() -> [[String: Any]] {
        Thread.callStackSymbols
            .prefix(8)
            .enumerated()
            .map { index, symbol in
                [
                    "platform": "custom",
                    "lang": "swift",
                    "function": symbol,
                    "filename": "agentic30",
                    "lineno": index + 1,
                    "colno": 0,
                ] as [String : Any]
            }
    }

    private static func appVersionDescription() -> String {
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
    var nonEmpty: String? {
        trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : self
    }
}
