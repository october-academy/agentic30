import Foundation
@testable import agentic30

/// Hosted unit tests share `UserDefaults.standard` with the developer's real
/// app domain (`october-academy.agentic30`), so tests that exercise the
/// production reset/persistence paths would otherwise wipe or overwrite the
/// host app's saved settings (selected provider, workspace root, onboarding
/// gates, pet prefs, …). Snapshot the Agentic30-owned domains before a test
/// mutates them and restore the snapshot once the test is done.
enum HostAppDefaultsGuard {
    /// Returns a restore closure; call it from a `defer`, `tearDown`, or
    /// suite `deinit`. Restoring replaces each domain wholesale, so any keys
    /// a test added or removed in between are rolled back too.
    static func snapshotAgentic30Domains() -> () -> Void {
        let defaults = UserDefaults.standard
        let domainNames = Agentic30LocalDataResetter.agentic30BundleIdentifiers(Bundle.main.bundleIdentifier)
        let snapshots = domainNames.map { ($0, defaults.persistentDomain(forName: $0)) }
        return {
            for (name, snapshot) in snapshots {
                if let snapshot {
                    defaults.setPersistentDomain(snapshot, forName: name)
                } else {
                    defaults.removePersistentDomain(forName: name)
                }
            }
        }
    }
}
