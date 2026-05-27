import Foundation

/// Single source of truth for the user's workspace root.
///
/// The sidecar is launched with `--workspace <url>` and `process.currentDirectoryURL = <url>`,
/// so this value determines where agents, scans, and MCP boundary checks operate. It is
/// intentionally decoupled from the sidecar script's on-disk location: in a bundled build
/// the script lives inside the read-only `.app`, which must not be used as a workspace.
///
/// Persisted in `UserDefaults` under `kWorkspaceRootKey`. The picker UI in `SettingsView`
/// writes through `store(_:)`; the sidecar reads via `resolvedURL()`.
///
/// When sandbox is enabled later, swap the plain-path storage for a security-scoped
/// bookmark — `resolvedURL()` becomes the resolve-and-start-access site, and callers
/// stay identical.
enum WorkspaceSettings {
    private static let kWorkspaceRootKey = "agentic30.workspaceRoot"
    private static let kLegacyBipKey = "bipWorkspaceRoot"
    private static let kKnownWorkspaceRootsKey = "agentic30.workspaceRoots.v1"

    /// Test seam for the legacy Keychain fallback. Production reads
    /// `KeychainHelper.loadSettings().bipWorkspaceRoot`; tests override this so they
    /// stay hermetic against whatever the dev box's login keychain happens to hold.
    static var legacyWorkspaceProvider: () -> String = {
        KeychainHelper.loadSettings().bipWorkspaceRoot
    }

    /// Resolves the current workspace, applying a one-shot migration from the legacy
    /// Keychain field the first time a user upgrades. Falls back to `~/` when unset
    /// so early adopters are not blocked; first-run UX should surface a picker.
    static func resolvedURL() -> URL {
        if let path = UserDefaults.standard.string(forKey: kWorkspaceRootKey),
           !path.isEmpty {
            let url = URL(fileURLWithPath: path, isDirectory: true)
            if isExistingDirectory(url) {
                return url
            }
            UserDefaults.standard.removeObject(forKey: kWorkspaceRootKey)
        }

        let legacy = legacyWorkspaceProvider()
        if !legacy.isEmpty {
            let url = URL(fileURLWithPath: legacy, isDirectory: true)
            if isExistingDirectory(url) {
                store(url)
                return url
            }
        }

        return FileManager.default.homeDirectoryForCurrentUser
    }

    /// `true` when the user has explicitly chosen a workspace (ignoring the home-dir default).
    static var hasExplicitWorkspace: Bool {
        if let path = UserDefaults.standard.string(forKey: kWorkspaceRootKey), !path.isEmpty {
            return isExistingDirectory(URL(fileURLWithPath: path, isDirectory: true))
        }
        let legacy = legacyWorkspaceProvider()
            .trimmingCharacters(in: .whitespacesAndNewlines)
        if !legacy.isEmpty {
            let url = URL(fileURLWithPath: legacy, isDirectory: true)
            if isExistingDirectory(url) {
                store(url)
                return true
            }
        }
        return false
    }

    /// UI surfaces should display the explicit workspace when one exists, even if
    /// legacy settings still hold an older or empty BIP root.
    static func displayPath(legacyFallback: String) -> String {
        if hasExplicitWorkspace {
            return resolvedURL().path
        }
        return legacyFallback
    }

    static func store(_ url: URL) {
        store(url, defaults: .standard)
    }

    static func clear() {
        UserDefaults.standard.removeObject(forKey: kWorkspaceRootKey)
    }

    static func knownWorkspaceURLs(
        defaults: UserDefaults = .standard,
        includeLegacy: Bool = true
    ) -> [URL] {
        var paths: [String] = []
        if let stored = defaults.array(forKey: kKnownWorkspaceRootsKey) as? [String] {
            paths.append(contentsOf: stored)
        }
        if let current = defaults.string(forKey: kWorkspaceRootKey), !current.isEmpty {
            paths.append(current)
        }
        if includeLegacy {
            let legacy = legacyWorkspaceProvider().trimmingCharacters(in: .whitespacesAndNewlines)
            if !legacy.isEmpty {
                paths.append(legacy)
            }
        }

        var seen = Set<String>()
        return paths.compactMap { rawPath in
            let trimmed = rawPath.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmed.isEmpty else { return nil }
            let url = URL(fileURLWithPath: trimmed, isDirectory: true).standardizedFileURL
            guard seen.insert(url.path).inserted else { return nil }
            return url
        }
    }

    static func clearKnownWorkspaceRoots(defaults: UserDefaults = .standard) {
        defaults.removeObject(forKey: kKnownWorkspaceRootsKey)
    }

    private static func store(_ url: URL, defaults: UserDefaults) {
        defaults.set(url.path, forKey: kWorkspaceRootKey)
        rememberWorkspace(url, defaults: defaults)
    }

    private static func rememberWorkspace(_ url: URL, defaults: UserDefaults) {
        let path = url.standardizedFileURL.path
        var paths = defaults.array(forKey: kKnownWorkspaceRootsKey) as? [String] ?? []
        paths.removeAll { existing in
            URL(fileURLWithPath: existing, isDirectory: true).standardizedFileURL.path == path
        }
        paths.append(path)
        defaults.set(paths, forKey: kKnownWorkspaceRootsKey)
    }

    private static func isExistingDirectory(_ url: URL) -> Bool {
        var isDirectory: ObjCBool = false
        return FileManager.default.fileExists(atPath: url.path, isDirectory: &isDirectory)
            && isDirectory.boolValue
    }
}
