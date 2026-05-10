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
        UserDefaults.standard.set(url.path, forKey: kWorkspaceRootKey)
    }

    static func clear() {
        UserDefaults.standard.removeObject(forKey: kWorkspaceRootKey)
    }

    private static func isExistingDirectory(_ url: URL) -> Bool {
        var isDirectory: ObjCBool = false
        return FileManager.default.fileExists(atPath: url.path, isDirectory: &isDirectory)
            && isDirectory.boolValue
    }
}
