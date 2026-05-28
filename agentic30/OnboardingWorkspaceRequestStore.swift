import Foundation

struct OnboardingWorkspaceRequest: Codable, Equatable, Identifiable {
    let id: String
    let path: String
    let basename: String
    let source: String
    let claimedSource: String?
    let createdAt: Date
    let expiresAt: Date
    let usedCwd: Bool
    let status: String?

    var url: URL {
        URL(fileURLWithPath: path, isDirectory: true)
    }

    var displaySource: String {
        switch source {
        case "cursor": return "Cursor"
        case "codex": return "Codex"
        case "claude_code": return "Claude Code"
        default: return "AI tool"
        }
    }
}

struct OnboardingWorkspaceRequestStore {
    static let requestsDirectoryName = "onboarding-workspace-requests"

    let appSupportURL: URL
    var fileManager: FileManager = .default
    var now: () -> Date = Date.init

    init(appSupportURL: URL = KeychainHelper.applicationSupportURL) {
        self.appSupportURL = appSupportURL
    }

    var requestsDirectoryURL: URL {
        appSupportURL.appendingPathComponent(Self.requestsDirectoryName, isDirectory: true)
    }

    func latestPendingRequest(ignoring ignoredIDs: Set<String> = []) -> OnboardingWorkspaceRequest? {
        let directory = requestsDirectoryURL
        guard let files = try? fileManager.contentsOfDirectory(
            at: directory,
            includingPropertiesForKeys: [.contentModificationDateKey],
            options: [.skipsHiddenFiles]
        ) else {
            return nil
        }

        let decoder = Self.decoder()
        return files
            .filter { $0.pathExtension == "json" }
            .compactMap { url -> OnboardingWorkspaceRequest? in
                guard let data = try? Data(contentsOf: url),
                      let request = try? decoder.decode(OnboardingWorkspaceRequest.self, from: data),
                      request.status == nil || request.status == "pending",
                      !ignoredIDs.contains(request.id),
                      request.expiresAt > now(),
                      isExistingDirectory(request.url)
                else {
                    return nil
                }
                return request
            }
            .sorted { $0.createdAt > $1.createdAt }
            .first
    }

    func removeRequest(id: String) {
        guard !id.isEmpty else { return }
        let url = requestsDirectoryURL.appendingPathComponent("\(id).json", isDirectory: false)
        try? fileManager.removeItem(at: url)
    }

    private func isExistingDirectory(_ url: URL) -> Bool {
        var isDirectory: ObjCBool = false
        return fileManager.fileExists(atPath: url.path, isDirectory: &isDirectory)
            && isDirectory.boolValue
    }

    private static func decoder() -> JSONDecoder {
        let decoder = JSONDecoder()
        let formatterWithFractions = ISO8601DateFormatter()
        formatterWithFractions.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        decoder.dateDecodingStrategy = .custom { decoder in
            let container = try decoder.singleValueContainer()
            let value = try container.decode(String.self)
            if let date = formatterWithFractions.date(from: value) ?? formatter.date(from: value) {
                return date
            }
            throw DecodingError.dataCorruptedError(
                in: container,
                debugDescription: "Invalid ISO8601 date: \(value)"
            )
        }
        return decoder
    }
}

struct OnboardingNonceStore {
    static let fileName = "onboarding-nonce.json"
    static let tokenTTL: TimeInterval = 30 * 60

    let storeURL: URL
    var fileManager: FileManager = .default
    var now: () -> Date = Date.init
    var tokenFactory: () -> String = { UUID().uuidString }

    init(appSupportURL: URL = KeychainHelper.applicationSupportURL) {
        self.storeURL = appSupportURL.appendingPathComponent(Self.fileName, isDirectory: false)
    }

    @discardableResult
    func rotateAndIssue() throws -> String {
        let token = tokenFactory()
        let createdAt = now()
        let expiresAt = createdAt.addingTimeInterval(Self.tokenTTL)
        try fileManager.createDirectory(
            at: storeURL.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        let payload: [String: String] = [
            "token": token,
            "createdAt": Self.iso8601().string(from: createdAt),
            "expiresAt": Self.iso8601().string(from: expiresAt),
        ]
        let data = try JSONSerialization.data(
            withJSONObject: payload,
            options: [.sortedKeys]
        )
        try data.write(to: storeURL, options: [.atomic])
        try? fileManager.setAttributes([.posixPermissions: 0o600], ofItemAtPath: storeURL.path)
        return token
    }

    func currentToken() -> String? {
        guard let data = try? Data(contentsOf: storeURL),
              let payload = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let token = payload["token"] as? String,
              let expiresAtString = payload["expiresAt"] as? String,
              let expiresAt = Self.iso8601().date(from: expiresAtString) ?? Self.iso8601WithFractions().date(from: expiresAtString),
              expiresAt > now()
        else {
            return nil
        }
        return token
    }

    func invalidate() {
        try? fileManager.removeItem(at: storeURL)
    }

    private static func iso8601() -> ISO8601DateFormatter {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter
    }

    private static func iso8601WithFractions() -> ISO8601DateFormatter {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }
}

struct OnboardingHelperInstaller {
    static let helperFileName = "agentic30-onboarding"

    let appSupportURL: URL
    let fileManager: FileManager
    let nodeResolver: NodeExecutableResolver
    let bundle: Bundle

    init(
        appSupportURL: URL = KeychainHelper.applicationSupportURL,
        fileManager: FileManager = .default,
        nodeResolver: NodeExecutableResolver = .live(),
        bundle: Bundle = .main
    ) {
        self.appSupportURL = appSupportURL
        self.fileManager = fileManager
        self.nodeResolver = nodeResolver
        self.bundle = bundle
    }

    var helperURL: URL {
        appSupportURL
            .appendingPathComponent("bin", isDirectory: true)
            .appendingPathComponent(Self.helperFileName, isDirectory: false)
    }

    func installOrRefresh() throws -> URL {
        let nodeURL = try nodeResolver.resolve()
        let sidecarRootURL = try resolveSidecarRootURL()
        let entrypointURL = sidecarRootURL.appendingPathComponent("onboarding-helper.mjs")
        guard fileManager.fileExists(atPath: entrypointURL.path) else {
            throw NSError(
                domain: "OnboardingHelperInstaller",
                code: 2,
                userInfo: [NSLocalizedDescriptionKey: "Missing onboarding helper entrypoint at \(entrypointURL.path)."]
            )
        }

        try fileManager.createDirectory(
            at: helperURL.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        let noncePath = appSupportURL.appendingPathComponent(OnboardingNonceStore.fileName).path
        let script = """
        #!/bin/zsh
        set -euo pipefail
        export AGENTIC30_APP_SUPPORT_PATH=\(Self.shellQuote(appSupportURL.path))
        export AGENTIC30_ONBOARDING_NONCE_PATH=\(Self.shellQuote(noncePath))
        exec \(Self.shellQuote(nodeURL.path)) \(Self.shellQuote(entrypointURL.path)) "$@"
        """
        try script.write(to: helperURL, atomically: true, encoding: .utf8)
        try fileManager.setAttributes([.posixPermissions: 0o755], ofItemAtPath: helperURL.path)
        return helperURL
    }

    private func resolveSidecarRootURL() throws -> URL {
        if let bundled = bundle.resourceURL?.appendingPathComponent("sidecar", isDirectory: true),
           fileManager.fileExists(atPath: bundled.path) {
            return bundled
        }
        let developmentRoot = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .appendingPathComponent("sidecar", isDirectory: true)
        if fileManager.fileExists(atPath: developmentRoot.path) {
            return developmentRoot
        }
        throw NSError(
            domain: "OnboardingHelperInstaller",
            code: 1,
            userInfo: [NSLocalizedDescriptionKey: "Could not locate the Agentic30 sidecar directory."]
        )
    }

    static func shellQuote(_ value: String) -> String {
        "'\(value.replacingOccurrences(of: "'", with: "'\\''"))'"
    }
}
