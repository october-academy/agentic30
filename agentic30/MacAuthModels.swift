import Foundation

struct MacAuthSession: Codable, Hashable {
    var accessToken: String
    var refreshToken: String
    var expiresAt: TimeInterval?
    var tokenType: String
    var userId: String
    var email: String?
    var onboardingCompletedAt: String
    var termsAcceptedAt: String
    var termsVersion: String
    var privacyVersion: String

    var isUsable: Bool {
        !accessToken.isEmpty && !refreshToken.isEmpty && !userId.isEmpty
    }

    var shouldRefreshSoon: Bool {
        guard let expiresAt else { return false }
        return Date(timeIntervalSince1970: expiresAt).timeIntervalSinceNow < 120
    }
}

struct MacAuthExchangeResponse: Decodable {
    let accessToken: String
    let refreshToken: String
    let expiresAt: TimeInterval?
    let expiresIn: TimeInterval?
    let tokenType: String?
    let user: MacAuthUser
    let consent: MacAuthConsent?

    func toSession(fallbackConsent: MacAuthConsent? = nil) -> MacAuthSession {
        let resolvedConsent = consent ?? fallbackConsent
        let now = ISO8601DateFormatter().string(from: Date())
        return MacAuthSession(
            accessToken: accessToken,
            refreshToken: refreshToken,
            expiresAt: expiresAt,
            tokenType: tokenType ?? "bearer",
            userId: user.id,
            email: user.email,
            onboardingCompletedAt: resolvedConsent?.acceptedAt ?? now,
            termsAcceptedAt: resolvedConsent?.acceptedAt ?? now,
            termsVersion: resolvedConsent?.termsVersion ?? MacOnboardingConstants.termsVersion,
            privacyVersion: resolvedConsent?.privacyVersion ?? MacOnboardingConstants.privacyVersion
        )
    }
}

struct MacAuthUser: Decodable, Hashable {
    let id: String
    let email: String?
}

struct MacAuthConsent: Codable, Hashable {
    let acceptedAt: String
    let termsVersion: String
    let privacyVersion: String
}

enum MacOnboardingStatus: Hashable {
    case idle
    case signingIn
    case exchanging
    case refreshing
    case failed(String)
}

enum MacOnboardingConstants {
    static var appBaseURL: URL {
        let environment = ProcessInfo.processInfo.environment
        let arguments = CommandLine.arguments
        let candidate = environment["AGENTIC30_MAC_AUTH_BASE_URL"]
            ?? argumentValue("--ui-testing-web-base-url", arguments: arguments)
            ?? argumentValue("--mac-auth-base-url", arguments: arguments)

        guard
            let candidate,
            let url = URL(string: candidate.trimmingCharacters(in: .whitespacesAndNewlines)),
            let scheme = url.scheme?.lowercased(),
            ["http", "https"].contains(scheme),
            url.host?.isEmpty == false
        else {
            return URL(string: "https://agentic30.app")!
        }
        return url
    }

    static let termsVersion = "2026-04-15"
    static let privacyVersion = "2026-04-15"

    // Cached result from the first successful login-shell PATH resolution.
    private static var cachedLoginShellPath: String?

    /// Returns the user's full login-shell PATH.
    ///
    /// launchd-launched apps inherit a minimal PATH (`/usr/bin:/bin`), which
    /// omits mise, Homebrew, and npm global bin dirs. This runs a login shell
    /// via osascript once and caches the result. If extraction fails, a
    /// hardcoded fallback covering the most common tool locations is returned.
    static func resolveLoginShellPath() -> String {
        if let cached = cachedLoginShellPath {
            return cached
        }

        let home = NSHomeDirectory()
        let fallback = [
            "\(home)/.local/bin",
            "\(home)/.local/share/mise/installs/node/22.22.2/bin",
            "/opt/homebrew/bin",
            "/usr/local/bin",
            "/usr/bin",
            "/bin",
        ].joined(separator: ":")

        let process = Process()
        let output = Pipe()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
        process.arguments = ["-e", "do shell script \"echo $PATH\" with login user"]
        process.standardOutput = output
        process.standardError = Pipe()

        do {
            try process.run()
            process.waitUntilExit()
            guard process.terminationStatus == 0 else {
                cachedLoginShellPath = fallback
                return fallback
            }
            let data = output.fileHandleForReading.readDataToEndOfFile()
            let raw = String(data: data, encoding: .utf8)?
                .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            let resolved = raw.isEmpty ? fallback : raw
            cachedLoginShellPath = resolved
            return resolved
        } catch {
            cachedLoginShellPath = fallback
            return fallback
        }
    }

    private static func argumentValue(_ name: String, arguments: [String]) -> String? {
        if let inline = arguments.first(where: { $0.hasPrefix("\(name)=") }) {
            return String(inline.dropFirst(name.count + 1))
        }
        guard let index = arguments.firstIndex(of: name),
              arguments.indices.contains(index + 1)
        else {
            return nil
        }
        return arguments[index + 1]
    }
}
