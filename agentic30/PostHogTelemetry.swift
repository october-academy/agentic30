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
    typealias Sender = (URL, [String: Any], @escaping (Bool) -> Void) -> Void

    static let telemetryDisabledDefaultsKey = "agentic30.posthog.telemetryDisabled"
    static let bundleProjectAPIKeyInfoPlistKey = "Agentic30PostHogProjectAPIKey"
    static let bundleHostInfoPlistKey = "Agentic30PostHogHost"
    private static let distinctIDDefaultsKey = "agentic30.posthog.distinctId"
    private static let captureOnceDefaultsPrefix = "agentic30.posthog.once."
    private static let pendingOnceDefaultsPrefix = "agentic30.posthog.once.pending."
    private static let captureFileEnvironmentKey = "AGENTIC30_TELEMETRY_CAPTURE_FILE"
    private static let captureFileLock = NSLock()
    private static let captureOnceLock = NSLock()
    private static var pendingOnceInFlight: Set<String> = []

    static var captureSink: ((PostHogTelemetryCapture) -> Void)?
    static var configurationProvider: (() -> PostHogTelemetryConfig?)?
    static var sender: Sender = { url, payload, completion in
        PostHogTelemetry.defaultSend(url: url, payload: payload, completion: completion)
    }

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

    static func resetTestingHooks() {
        captureSink = nil
        configurationProvider = nil
        sender = { url, payload, completion in
            PostHogTelemetry.defaultSend(url: url, payload: payload, completion: completion)
        }
        captureOnceLock.lock()
        pendingOnceInFlight.removeAll()
        captureOnceLock.unlock()
    }

    /// Fires an event and blocks the caller until the HTTP send completes or
    /// `timeout` elapses. Use for terminate-time captures (e.g.
    /// `mac_app_terminating`) — the default async path uses
    /// `URLSession.shared.dataTask`, which the OS cancels on process exit and
    /// would otherwise lose the event.
    @discardableResult
    static func captureBlocking(
        _ event: String,
        properties: [String: Any] = [:],
        authSession: MacAuthSession? = nil,
        timeout: TimeInterval = 1.5
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

        guard let config = loadConfig(),
              let ingestBaseURL = PostHogHostResolver.ingestBaseURL(for: config.host),
              let url = URL(string: "i/v0/e/", relativeTo: ingestBaseURL)
        else { return false }

        let resolvedDistinctID = distinctID(for: authSession)
        let payload: [String: Any] = [
            "api_key": config.projectAPIKey,
            "event": event,
            "distinct_id": resolvedDistinctID,
            "uuid": UUID().uuidString,
            "properties": baseProperties(
                extra: extra,
                authSession: authSession,
                distinctID: resolvedDistinctID
            ),
            "timestamp": ISO8601DateFormatter().string(from: Date()),
        ]

        guard JSONSerialization.isValidJSONObject(payload) else { return false }

        let semaphore = DispatchSemaphore(value: 0)
        var didSucceed = false
        sender(url, payload) { success in
            didSucceed = success
            semaphore.signal()
        }
        _ = semaphore.wait(timeout: .now() + timeout)
        return didSucceed
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

        guard let config = loadConfig(),
              let ingestBaseURL = PostHogHostResolver.ingestBaseURL(for: config.host),
              let url = URL(string: "i/v0/e/", relativeTo: ingestBaseURL)
        else { return false }

        let resolvedDistinctID = distinctID(for: authSession)
        let payload: [String: Any] = [
            "api_key": config.projectAPIKey,
            "event": event,
            "distinct_id": resolvedDistinctID,
            "uuid": UUID().uuidString,
            "properties": baseProperties(
                extra: extra,
                authSession: authSession,
                distinctID: resolvedDistinctID
            ),
            "timestamp": ISO8601DateFormatter().string(from: Date()),
        ]

        return send(url: url, payload: payload)
    }

    @discardableResult
    static func captureOnce(
        _ event: String,
        onceKey: String,
        properties: [String: Any] = [:],
        authSession: MacAuthSession? = nil
    ) -> Bool {
        let defaultsKey = captureOnceDefaultsPrefix + onceKey
        let pendingKey = pendingOnceDefaultsPrefix + onceKey
        let extra = eventProperties(properties)

        guard !isDisabledForCurrentProcess
                || configurationProvider != nil
                || hasConfiguredCaptureSink
        else { return false }

        captureOnceLock.lock()
        if UserDefaults.standard.bool(forKey: defaultsKey)
            || UserDefaults.standard.data(forKey: pendingKey) != nil
            || pendingOnceInFlight.contains(pendingKey) {
            captureOnceLock.unlock()
            return false
        }

        if hasConfiguredCaptureSink {
            UserDefaults.standard.set(true, forKey: defaultsKey)
            captureOnceLock.unlock()

            let didCapture = emitToConfiguredSink(
                event: event,
                extra: extra,
                authSession: authSession,
                isException: false
            )
            if !didCapture {
                captureOnceLock.lock()
                UserDefaults.standard.removeObject(forKey: defaultsKey)
                captureOnceLock.unlock()
            }
            return didCapture
        }

        // No sink and no PostHog config: refuse to persist any tracking
        // state. Without this guard, users who never configured a key would
        // get a distinct id and a serialized pending payload written to
        // their prefs plist (via pendingOnceCaptureData -> baseProperties),
        // sitting orphaned until they later configure a key — at which
        // point the queued event would fire with a stale install-time
        // timestamp. capture() already gates on loadConfig(); captureOnce
        // must do the same.
        guard loadConfig() != nil else {
            captureOnceLock.unlock()
            return false
        }

        guard let pendingData = pendingOnceCaptureData(
            event: event,
            onceKey: onceKey,
            extra: extra,
            authSession: authSession
        ) else {
            captureOnceLock.unlock()
            return false
        }

        UserDefaults.standard.set(pendingData, forKey: pendingKey)
        captureOnceLock.unlock()

        _ = flushPendingOnceCapture(pendingKey: pendingKey)
        return true
    }

    static func flushPendingOnceCaptures() {
        let pendingKeys = UserDefaults.standard.dictionaryRepresentation().keys
            .filter { $0.hasPrefix(pendingOnceDefaultsPrefix) }

        for pendingKey in pendingKeys {
            _ = flushPendingOnceCapture(pendingKey: pendingKey)
        }
    }

    @discardableResult
    private static func flushPendingOnceCapture(pendingKey: String) -> Bool {
        captureOnceLock.lock()
        if pendingOnceInFlight.contains(pendingKey) {
            captureOnceLock.unlock()
            return false
        }
        guard let pendingData = UserDefaults.standard.data(forKey: pendingKey) else {
            captureOnceLock.unlock()
            return false
        }
        pendingOnceInFlight.insert(pendingKey)
        captureOnceLock.unlock()

        guard let record = pendingOnceCaptureRecord(from: pendingData) else {
            captureOnceLock.lock()
            pendingOnceInFlight.remove(pendingKey)
            UserDefaults.standard.removeObject(forKey: pendingKey)
            captureOnceLock.unlock()
            return false
        }

        let defaultsKey = captureOnceDefaultsPrefix + record.onceKey
        captureOnceLock.lock()
        if UserDefaults.standard.bool(forKey: defaultsKey) {
            pendingOnceInFlight.remove(pendingKey)
            UserDefaults.standard.removeObject(forKey: pendingKey)
            captureOnceLock.unlock()
            return false
        }
        captureOnceLock.unlock()

        guard let config = loadConfig(),
              let ingestBaseURL = PostHogHostResolver.ingestBaseURL(for: config.host),
              let url = URL(string: "i/v0/e/", relativeTo: ingestBaseURL)
        else {
            captureOnceLock.lock()
            pendingOnceInFlight.remove(pendingKey)
            captureOnceLock.unlock()
            return false
        }

        let payload: [String: Any] = [
            "api_key": config.projectAPIKey,
            "event": record.event,
            "distinct_id": record.distinctID,
            "uuid": record.uuid,
            "properties": record.properties,
            "timestamp": record.timestamp,
        ]

        let didStart = send(url: url, payload: payload) { success in
            captureOnceLock.lock()
            pendingOnceInFlight.remove(pendingKey)
            if success {
                UserDefaults.standard.set(true, forKey: defaultsKey)
                UserDefaults.standard.removeObject(forKey: pendingKey)
            }
            captureOnceLock.unlock()
        }

        if !didStart {
            captureOnceLock.lock()
            pendingOnceInFlight.remove(pendingKey)
            captureOnceLock.unlock()
        }

        return didStart
    }

    private static var hasConfiguredCaptureSink: Bool {
        captureSink != nil
            || ProcessInfo.processInfo.environment[captureFileEnvironmentKey]?.nonEmpty != nil
    }

    private static func pendingOnceCaptureData(
        event: String,
        onceKey: String,
        extra: [String: Any],
        authSession: MacAuthSession?
    ) -> Data? {
        let resolvedDistinctID = distinctID(for: authSession)
        let record: [String: Any] = [
            "event": event,
            "once_key": onceKey,
            "distinct_id": resolvedDistinctID,
            "uuid": UUID().uuidString,
            "properties": baseProperties(
                extra: extra,
                authSession: authSession,
                distinctID: resolvedDistinctID
            ),
            "timestamp": ISO8601DateFormatter().string(from: Date()),
        ]

        guard JSONSerialization.isValidJSONObject(record) else { return nil }
        return try? JSONSerialization.data(withJSONObject: record, options: [.sortedKeys])
    }

    private struct PendingOnceCaptureRecord {
        let event: String
        let onceKey: String
        let distinctID: String
        let uuid: String
        let properties: [String: Any]
        let timestamp: String
    }

    private static func pendingOnceCaptureRecord(from data: Data) -> PendingOnceCaptureRecord? {
        guard let object = try? JSONSerialization.jsonObject(with: data),
              let dictionary = object as? [String: Any],
              let event = dictionary["event"] as? String,
              let onceKey = dictionary["once_key"] as? String,
              let distinctID = dictionary["distinct_id"] as? String,
              let uuid = dictionary["uuid"] as? String,
              let properties = dictionary["properties"] as? [String: Any],
              let timestamp = dictionary["timestamp"] as? String
        else { return nil }

        return PendingOnceCaptureRecord(
            event: event,
            onceKey: onceKey,
            distinctID: distinctID,
            uuid: uuid,
            properties: properties,
            timestamp: timestamp
        )
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

    static var isTelemetryDisabledByUser: Bool {
        UserDefaults.standard.bool(forKey: telemetryDisabledDefaultsKey)
    }

    static func setTelemetryDisabledByUser(_ disabled: Bool) {
        UserDefaults.standard.set(disabled, forKey: telemetryDisabledDefaultsKey)
    }

    private static func loadConfig() -> PostHogTelemetryConfig? {
        if let configurationProvider {
            return configurationProvider()
        }

        guard !isDisabledForCurrentProcess else { return nil }

        let settings = KeychainHelper.loadSettings()
        let resolvedProjectKey = settings.posthogProjectAPIKey.nonEmpty
            ?? (settings.posthogApiKey.hasPrefix("phc_") ? settings.posthogApiKey : nil)
            ?? ProcessInfo.processInfo.environment["POSTHOG_PROJECT_TOKEN"]?
                .trimmingCharacters(in: .whitespacesAndNewlines)
                .nonEmpty
            ?? bundleProjectAPIKey

        guard let projectAPIKey = resolvedProjectKey, !projectAPIKey.isEmpty else {
            return nil
        }

        let host = settings.posthogHost.nonEmpty
            ?? ProcessInfo.processInfo.environment["POSTHOG_HOST"]?
                .trimmingCharacters(in: .whitespacesAndNewlines)
                .nonEmpty
            ?? bundleHost
            ?? "https://us.posthog.com"
        return PostHogTelemetryConfig(projectAPIKey: projectAPIKey, host: host)
    }

    /// Build-time embedded fallbacks. Distribution builds inject
    /// `Agentic30PostHogProjectAPIKey` / `Agentic30PostHogHost` into Info.plist
    /// via xcconfig so every install reports telemetry by default. The user can
    /// override per-install via Settings (Keychain) or disable globally via the
    /// Settings opt-out toggle. Builds without the xcconfig values leave the
    /// raw `$(...)` placeholder in Info.plist — guarded here.
    private static var bundleProjectAPIKey: String? {
        guard let raw = (Bundle.main.object(forInfoDictionaryKey: bundleProjectAPIKeyInfoPlistKey) as? String)?.nonEmpty,
              !raw.contains("$("),
              raw.hasPrefix("phc_")
        else { return nil }
        return raw
    }

    private static var bundleHost: String? {
        guard let raw = (Bundle.main.object(forInfoDictionaryKey: bundleHostInfoPlistKey) as? String)?.nonEmpty,
              !raw.contains("$(")
        else { return nil }
        return raw
    }

    private static var isDisabledForCurrentProcess: Bool {
        ProcessInfo.processInfo.environment["AGENTIC30_DISABLE_TELEMETRY"] == "1"
            || isTelemetryDisabledByUser
            || CommandLine.arguments.contains(where: { $0.hasPrefix("--ui-testing-") })
            || ProcessInfo.processInfo.environment["XCTestConfigurationFilePath"] != nil
            || CommandLine.arguments.contains(where: { $0.contains(".xctest") })
    }

    @discardableResult
    private static func send(
        url: URL,
        payload: [String: Any],
        completion: ((Bool) -> Void)? = nil
    ) -> Bool {
        guard JSONSerialization.isValidJSONObject(payload) else {
            completion?(false)
            return false
        }

        sender(url, payload) { success in
            completion?(success)
        }
        return true
    }

    private static func defaultSend(
        url: URL,
        payload: [String: Any],
        completion: @escaping (Bool) -> Void
    ) {
        guard let body = try? JSONSerialization.data(withJSONObject: payload, options: []) else {
            completion(false)
            return
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = body

        URLSession.shared.dataTask(with: request) { _, response, error in
            guard error == nil,
                  let httpResponse = response as? HTTPURLResponse
            else {
                completion(false)
                return
            }

            completion((200..<300).contains(httpResponse.statusCode))
        }.resume()
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
        properties.merging([
            "$lib": "mac",
            "$lib_version": appVersionDescription(),
            "platform": "macos",
        ]) { _, new in new }
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
