import Foundation
import Security

enum KeychainHelper {

    private static let service = "com.agentic30"
    private static let settingsAccount = "com.agentic30.all-settings"
    private static let macAuthAccount = "com.agentic30.mac-auth"
    private static let onboardingContextAccount = "com.agentic30.onboarding-context"
    private static var cachedSettings: Settings?
    private static var cachedMacAuthSession: MacAuthSession?
    private static var didLoadMacAuthSession = false
    private static var cachedOnboardingContext: OnboardingContext?
    private static var didLoadOnboardingContext = false

    /// DEBUG builds bypass macOS Keychain entirely so that ad-hoc-signed dev runs
    /// stop prompting for a login password on every launch. RELEASE builds keep
    /// the Keychain path so signed/notarized builds retain Keychain protection.
    /// Set AGENTIC30_FORCE_KEYCHAIN=1 to override and use Keychain even in DEBUG
    /// (useful for verifying release behavior locally).
    static let isInsecureDevStorageEnabled: Bool = {
        if ProcessInfo.processInfo.environment["AGENTIC30_FORCE_KEYCHAIN"] == "1" {
            return false
        }
        #if DEBUG
        return true
        #else
        return false
        #endif
    }()

    private struct DevSecretsBlob: Codable {
        var settings: Settings?
        var macAuth: MacAuthSession?
        var onboarding: OnboardingContext?
    }

    private static var devSecretsURL: URL {
        appSupportURL.appendingPathComponent("dev-secrets.json")
    }

    static var applicationSupportURL: URL {
        appSupportURL
    }

    private static func readDevSecrets() -> DevSecretsBlob {
        guard let data = try? Data(contentsOf: devSecretsURL) else {
            return DevSecretsBlob()
        }
        return (try? JSONDecoder().decode(DevSecretsBlob.self, from: data)) ?? DevSecretsBlob()
    }

    private static func writeDevSecrets(_ blob: DevSecretsBlob) {
        ensureAppSupportDir()
        guard let data = try? JSONEncoder().encode(blob) else { return }
        try? data.write(to: devSecretsURL)
        try? FileManager.default.setAttributes(
            [.posixPermissions: 0o600],
            ofItemAtPath: devSecretsURL.path
        )
    }

    private static func mutateDevSecrets(_ mutate: (inout DevSecretsBlob) -> Void) {
        var blob = readDevSecrets()
        mutate(&blob)
        writeDevSecrets(blob)
    }

    // MARK: - Single-Blob Settings

    struct Settings: Codable {
        static let currentSchemaVersion = 4
        static let legacyDefaultCodexModelID = "gpt-5.4"

        var schemaVersion: Int = Settings.currentSchemaVersion

        // Agent Models
        var preferredClaudeModel: String = AgentModelCatalog.defaultClaudeModelID
        var preferredCodexModel: String = AgentModelCatalog.defaultCodexModelID

        // Ad Analytics
        var posthogApiKey: String = ""
        var posthogProjectAPIKey: String = ""
        var posthogHost: String = ""
        var metaAccessToken: String = ""
        var metaAdAccountId: String = ""

        // BIP
        var bipWorkspaceRoot: String = ""
        var bipIcpPath: String = ""
        var bipSpecPath: String = ""
        var bipValuesPath: String = ""
        var bipDesignSystemPath: String = ""
        var bipAdrPath: String = ""
        var bipGoalPath: String = ""
        var bipDocsPath: String = ""
        var bipSheetPath: String = ""
        var bipGdocsUrls: String = ""
        var bipGsheetsUrls: String = ""
        var bipNotionUrls: String = ""
        var bipThreadsHandle: String = ""
        var bipXHandle: String = ""

        // Notion
        var notionEnabled: Bool = false

        init() {}

        init(from decoder: Decoder) throws {
            let container = try decoder.container(keyedBy: CodingKeys.self)

            let persistedSchemaVersion = try container.decodeIfPresent(Int.self, forKey: .schemaVersion) ?? 0

            preferredClaudeModel = try container.decodeIfPresent(String.self, forKey: .preferredClaudeModel) ?? AgentModelCatalog.defaultClaudeModelID
            preferredCodexModel = try container.decodeIfPresent(String.self, forKey: .preferredCodexModel) ?? AgentModelCatalog.defaultCodexModelID

            posthogApiKey = try container.decodeIfPresent(String.self, forKey: .posthogApiKey) ?? ""
            posthogProjectAPIKey = try container.decodeIfPresent(String.self, forKey: .posthogProjectAPIKey) ?? ""
            posthogHost = try container.decodeIfPresent(String.self, forKey: .posthogHost) ?? ""
            metaAccessToken = try container.decodeIfPresent(String.self, forKey: .metaAccessToken) ?? ""
            metaAdAccountId = try container.decodeIfPresent(String.self, forKey: .metaAdAccountId) ?? ""

            bipWorkspaceRoot = try container.decodeIfPresent(String.self, forKey: .bipWorkspaceRoot) ?? ""
            bipIcpPath = try container.decodeIfPresent(String.self, forKey: .bipIcpPath) ?? ""
            bipSpecPath = try container.decodeIfPresent(String.self, forKey: .bipSpecPath) ?? ""
            bipValuesPath = try container.decodeIfPresent(String.self, forKey: .bipValuesPath) ?? ""
            bipDesignSystemPath = try container.decodeIfPresent(String.self, forKey: .bipDesignSystemPath) ?? ""
            bipAdrPath = try container.decodeIfPresent(String.self, forKey: .bipAdrPath) ?? ""
            bipGoalPath = try container.decodeIfPresent(String.self, forKey: .bipGoalPath) ?? ""
            bipDocsPath = try container.decodeIfPresent(String.self, forKey: .bipDocsPath) ?? ""
            bipSheetPath = try container.decodeIfPresent(String.self, forKey: .bipSheetPath) ?? ""
            bipGdocsUrls = try container.decodeIfPresent(String.self, forKey: .bipGdocsUrls) ?? ""
            bipGsheetsUrls = try container.decodeIfPresent(String.self, forKey: .bipGsheetsUrls) ?? ""
            bipNotionUrls = try container.decodeIfPresent(String.self, forKey: .bipNotionUrls) ?? ""
            bipThreadsHandle = try container.decodeIfPresent(String.self, forKey: .bipThreadsHandle) ?? ""
            bipXHandle = try container.decodeIfPresent(String.self, forKey: .bipXHandle) ?? ""

            notionEnabled = try container.decodeIfPresent(Bool.self, forKey: .notionEnabled) ?? false

            self = Settings.migrate(self, from: persistedSchemaVersion)
        }

        func encode(to encoder: Encoder) throws {
            var container = encoder.container(keyedBy: CodingKeys.self)

            try container.encode(Settings.currentSchemaVersion, forKey: .schemaVersion)
            try container.encode(preferredClaudeModel, forKey: .preferredClaudeModel)
            try container.encode(preferredCodexModel, forKey: .preferredCodexModel)

            try container.encode(posthogApiKey, forKey: .posthogApiKey)
            try container.encode(posthogProjectAPIKey, forKey: .posthogProjectAPIKey)
            try container.encode(posthogHost, forKey: .posthogHost)
            try container.encode(metaAccessToken, forKey: .metaAccessToken)
            try container.encode(metaAdAccountId, forKey: .metaAdAccountId)

            try container.encode(bipWorkspaceRoot, forKey: .bipWorkspaceRoot)
            try container.encode(bipIcpPath, forKey: .bipIcpPath)
            try container.encode(bipSpecPath, forKey: .bipSpecPath)
            try container.encode(bipValuesPath, forKey: .bipValuesPath)
            try container.encode(bipDesignSystemPath, forKey: .bipDesignSystemPath)
            try container.encode(bipAdrPath, forKey: .bipAdrPath)
            try container.encode(bipGoalPath, forKey: .bipGoalPath)
            try container.encode(bipDocsPath, forKey: .bipDocsPath)
            try container.encode(bipSheetPath, forKey: .bipSheetPath)
            try container.encode(bipGdocsUrls, forKey: .bipGdocsUrls)
            try container.encode(bipGsheetsUrls, forKey: .bipGsheetsUrls)
            try container.encode(bipNotionUrls, forKey: .bipNotionUrls)
            try container.encode(bipThreadsHandle, forKey: .bipThreadsHandle)
            try container.encode(bipXHandle, forKey: .bipXHandle)

            try container.encode(notionEnabled, forKey: .notionEnabled)
        }

        private enum CodingKeys: String, CodingKey {
            case schemaVersion
            case preferredClaudeModel
            case preferredCodexModel
            case posthogApiKey
            case posthogProjectAPIKey
            case posthogHost
            case metaAccessToken
            case metaAdAccountId
            case bipWorkspaceRoot
            case bipIcpPath
            case bipSpecPath
            case bipValuesPath
            case bipDesignSystemPath
            case bipAdrPath
            case bipGoalPath
            case bipDocsPath
            case bipSheetPath
            case bipGdocsUrls
            case bipGsheetsUrls
            case bipNotionUrls
            case bipThreadsHandle
            case bipXHandle
            case notionEnabled
        }

        static func migrate(_ settings: Settings, from schemaVersion: Int) -> Settings {
            var migrated = settings
            migrated.schemaVersion = currentSchemaVersion
            migrated.preferredClaudeModel = AgentModelCatalog.normalizedModelID(
                migrated.preferredClaudeModel,
                provider: .claude
            )
            migrated.preferredCodexModel = AgentModelCatalog.normalizedModelID(
                migrated.preferredCodexModel,
                provider: .codex
            )
            if schemaVersion < 4 && migrated.preferredCodexModel == legacyDefaultCodexModelID {
                migrated.preferredCodexModel = AgentModelCatalog.defaultCodexModelID
            }
            return migrated
        }
    }

    /// Loads all settings from a single keychain entry (one auth prompt).
    static func loadSettings() -> Settings {
        if let cachedSettings {
            return cachedSettings
        }

        if isInsecureDevStorageEnabled {
            let settings = readDevSecrets().settings ?? Settings()
            cachedSettings = settings
            return settings
        }

        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: settingsAccount,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]

        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        guard status == errSecSuccess,
              let data = result as? Data,
              let settings = try? JSONDecoder().decode(Settings.self, from: data)
        else {
            let settings = Settings()
            cachedSettings = settings
            return settings
        }
        cachedSettings = settings
        return settings
    }

    /// Saves all settings as a single keychain entry (one auth prompt).
    static func saveSettings(_ settings: Settings) throws {
        guard let data = try? JSONEncoder().encode(settings) else { return }
        cachedSettings = settings

        if isInsecureDevStorageEnabled {
            mutateDevSecrets { $0.settings = settings }
            return
        }

        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: settingsAccount,
        ]

        let update: [String: Any] = [
            kSecValueData as String: data,
        ]

        let updateStatus = SecItemUpdate(query as CFDictionary, update as CFDictionary)
        if updateStatus == errSecSuccess {
            return
        }
        guard updateStatus == errSecItemNotFound else {
            throw KeychainError.unhandledError(status: updateStatus)
        }

        let addQuery: [String: Any] = query.merging([
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
            kSecClass as String: kSecClassGenericPassword,
            kSecValueData as String: data,
        ]) { _, new in new }

        let status = SecItemAdd(addQuery as CFDictionary, nil)
        guard status == errSecSuccess else {
            throw KeychainError.unhandledError(status: status)
        }
    }

    /// Deletes the single settings entry from keychain.
    static func deleteSettings() {
        cachedSettings = nil
        if isInsecureDevStorageEnabled {
            mutateDevSecrets { $0.settings = nil }
            return
        }
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: settingsAccount,
        ]
        SecItemDelete(query as CFDictionary)
    }

    // MARK: - macOS App Auth

    static func loadMacAuthSession() -> MacAuthSession? {
        if didLoadMacAuthSession {
            return cachedMacAuthSession
        }
        if let cachedMacAuthSession {
            return cachedMacAuthSession
        }
        if isInsecureDevStorageEnabled {
            cachedMacAuthSession = readDevSecrets().macAuth
        } else {
            cachedMacAuthSession = loadCodable(account: macAuthAccount, as: MacAuthSession.self)
        }
        didLoadMacAuthSession = true
        return cachedMacAuthSession
    }

    static func saveMacAuthSession(_ session: MacAuthSession) throws {
        cachedMacAuthSession = session
        didLoadMacAuthSession = true
        if isInsecureDevStorageEnabled {
            mutateDevSecrets { $0.macAuth = session }
            return
        }
        try saveCodable(session, account: macAuthAccount)
    }

    static func deleteMacAuthSession() {
        cachedMacAuthSession = nil
        didLoadMacAuthSession = true
        if isInsecureDevStorageEnabled {
            mutateDevSecrets { $0.macAuth = nil }
            return
        }
        delete(account: macAuthAccount)
    }

    // MARK: - Mac Onboarding Context (tone personalization)

    static func loadOnboardingContext() -> OnboardingContext? {
        if didLoadOnboardingContext {
            return cachedOnboardingContext
        }
        if isInsecureDevStorageEnabled {
            cachedOnboardingContext = readDevSecrets().onboarding
            if cachedOnboardingContext == nil {
                pruneInvalidDevOnboardingContextIfNeeded()
            }
        } else {
            cachedOnboardingContext = loadOnboardingContextFromKeychain()
        }
        didLoadOnboardingContext = true
        return cachedOnboardingContext
    }

    static func saveOnboardingContext(_ context: OnboardingContext) throws {
        cachedOnboardingContext = context
        didLoadOnboardingContext = true
        if isInsecureDevStorageEnabled {
            mutateDevSecrets { $0.onboarding = context }
            return
        }
        try saveCodable(context, account: onboardingContextAccount)
    }

    static func deleteOnboardingContext() {
        cachedOnboardingContext = nil
        didLoadOnboardingContext = true
        if isInsecureDevStorageEnabled {
            mutateDevSecrets { $0.onboarding = nil }
            return
        }
        delete(account: onboardingContextAccount)
    }

    struct LocalDataResetReport: Equatable {
        let removedDefaultsCount: Int
        let removedAppSupport: Bool
        let removedWorkspaceAgentic30: Bool
    }

    static func resetAgentic30LocalData(
        defaults: UserDefaults = .standard,
        fileManager: FileManager = .default,
        removeAppSupport: Bool = true,
        workspaceURL: URL? = nil,
        removeWorkspaceAgentic30: Bool = true
    ) throws -> LocalDataResetReport {
        cachedSettings = nil
        cachedMacAuthSession = nil
        didLoadMacAuthSession = true
        cachedOnboardingContext = nil
        didLoadOnboardingContext = true

        deleteSettings()
        deleteMacAuthSession()
        deleteOnboardingContext()
        deleteAllServiceEntries()

        let removedDefaults = resetAgentic30Defaults(defaults)
        var removedAppSupport = false
        if removeAppSupport, fileManager.fileExists(atPath: appSupportURL.path) {
            try fileManager.removeItem(at: appSupportURL)
            removedAppSupport = true
        }
        let removedWorkspaceAgentic30 = try (removeWorkspaceAgentic30
            ? removeWorkspaceAgentic30Data(in: workspaceURL, fileManager: fileManager)
            : false)

        return LocalDataResetReport(
            removedDefaultsCount: removedDefaults,
            removedAppSupport: removedAppSupport,
            removedWorkspaceAgentic30: removedWorkspaceAgentic30
        )
    }

    @discardableResult
    static func removeWorkspaceAgentic30Data(
        in workspaceURL: URL?,
        fileManager: FileManager = .default
    ) throws -> Bool {
        guard let workspaceURL else { return false }
        let agentic30URL = workspaceURL
            .standardizedFileURL
            .appendingPathComponent(".agentic30", isDirectory: true)
        guard fileManager.fileExists(atPath: agentic30URL.path) else {
            return false
        }
        try fileManager.removeItem(at: agentic30URL)
        return true
    }

    @discardableResult
    static func resetAgentic30Defaults(_ defaults: UserDefaults = .standard) -> Int {
        let keys = defaults.dictionaryRepresentation().keys.filter { key in
            key.hasPrefix("agentic30.")
                || key.hasPrefix("com.agentic30.")
                || key.hasPrefix("IntakeV2.")
                || key.hasPrefix("pet.")
                || key == "bipWorkspaceRoot"
        }
        for key in keys {
            defaults.removeObject(forKey: key)
        }
        defaults.synchronize()
        return keys.count
    }

    private static func loadOnboardingContextFromKeychain() -> OnboardingContext? {
        guard let data = loadData(account: onboardingContextAccount) else {
            return nil
        }
        guard let context = try? JSONDecoder().decode(OnboardingContext.self, from: data) else {
            delete(account: onboardingContextAccount)
            return nil
        }
        return context
    }

    private static func pruneInvalidDevOnboardingContextIfNeeded() {
        guard let data = try? Data(contentsOf: devSecretsURL),
              var object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              object["onboarding"] != nil
        else { return }

        if let onboarding = object["onboarding"],
           let onboardingData = try? JSONSerialization.data(withJSONObject: onboarding),
           (try? JSONDecoder().decode(OnboardingContext.self, from: onboardingData)) != nil {
            return
        }

        object.removeValue(forKey: "onboarding")
        guard JSONSerialization.isValidJSONObject(object),
              let prunedData = try? JSONSerialization.data(withJSONObject: object, options: [.prettyPrinted, .sortedKeys])
        else { return }
        try? prunedData.write(to: devSecretsURL)
        try? FileManager.default.setAttributes(
            [.posixPermissions: 0o600],
            ofItemAtPath: devSecretsURL.path
        )
    }

    private static func loadCodable<T: Decodable>(account: String, as type: T.Type) -> T? {
        guard let data = loadData(account: account) else {
            return nil
        }
        return try? JSONDecoder().decode(type, from: data)
    }

    private static func loadData(account: String) -> Data? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]

        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        guard status == errSecSuccess else { return nil }
        return result as? Data
    }

    private static func saveCodable<T: Encodable>(_ value: T, account: String) throws {
        guard let data = try? JSONEncoder().encode(value) else { return }

        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]

        let update: [String: Any] = [
            kSecValueData as String: data,
        ]

        let updateStatus = SecItemUpdate(query as CFDictionary, update as CFDictionary)
        if updateStatus == errSecSuccess {
            return
        }
        guard updateStatus == errSecItemNotFound else {
            throw KeychainError.unhandledError(status: updateStatus)
        }

        let addQuery: [String: Any] = query.merging([
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
            kSecValueData as String: data,
        ]) { _, new in new }

        let status = SecItemAdd(addQuery as CFDictionary, nil)
        guard status == errSecSuccess else {
            throw KeychainError.unhandledError(status: status)
        }
    }

    private static func delete(account: String) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        SecItemDelete(query as CFDictionary)
    }

    private static func deleteAllServiceEntries() {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
        ]
        SecItemDelete(query as CFDictionary)
    }

    // MARK: - Config File Sync

    private static var appSupportURL: URL {
        if let override = ProcessInfo.processInfo.environment["AGENTIC30_APP_SUPPORT_PATH"] {
            let trimmed = override.trimmingCharacters(in: .whitespacesAndNewlines)
            if !trimmed.isEmpty {
                return URL(fileURLWithPath: trimmed, isDirectory: true)
            }
        }
        return FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support/agentic30")
    }

    private static func ensureAppSupportDir() {
        try? FileManager.default.createDirectory(at: appSupportURL, withIntermediateDirectories: true)
    }

    private static func writeJSON(_ object: [String: Any], to filename: String) {
        ensureAppSupportDir()
        let filePath = appSupportURL.appendingPathComponent(filename)
        if let data = try? JSONSerialization.data(withJSONObject: object, options: .prettyPrinted) {
            try? data.write(to: filePath)
            try? FileManager.default.setAttributes(
                [.posixPermissions: 0o600],
                ofItemAtPath: filePath.path
            )
        }
    }

    /// Writes all config files from the given settings (no extra keychain reads).
    static func syncAllConfigFiles(from settings: Settings) {
        syncAdConfigFile(from: settings)
        syncBipConfigFile(from: settings)
        syncNotionConfigFile(from: settings)
    }

    static func syncAdConfigFile(from settings: Settings) {
        let config: [String: Any] = [
            "posthog": [
                "apiKey": settings.posthogApiKey,
                "projectApiKey": settings.posthogProjectAPIKey,
                "host": settings.posthogHost.isEmpty ? "https://us.posthog.com" : settings.posthogHost,
            ],
            "meta": [
                "accessToken": settings.metaAccessToken,
                "adAccountId": settings.metaAdAccountId,
            ],
        ]
        writeJSON(config, to: "ad-config.json")
    }

    static func syncBipConfigFile(from settings: Settings) {
        let config: [String: Any] = [
            "workspace": [
                "root": settings.bipWorkspaceRoot,
                "icp": settings.bipIcpPath,
                "spec": settings.bipSpecPath,
                "values": settings.bipValuesPath,
                "designSystem": settings.bipDesignSystemPath,
                "adr": settings.bipAdrPath,
                "goal": settings.bipGoalPath,
                "docs": settings.bipDocsPath,
                "sheet": settings.bipSheetPath,
            ],
            "externalDocs": [
                "googleDocs": splitCSV(settings.bipGdocsUrls),
                "googleSheets": splitCSV(settings.bipGsheetsUrls),
                "notion": splitCSV(settings.bipNotionUrls),
            ],
            "social": [
                "threads": settings.bipThreadsHandle,
                "x": settings.bipXHandle,
            ],
        ]
        writeJSON(config, to: "bip-config.json")
    }

    static func syncNotionConfigFile(from settings: Settings) {
        let config: [String: Any] = [
            "enabled": settings.notionEnabled,
        ]
        writeJSON(config, to: "notion-config.json")
    }

    private static func splitCSV(_ value: String) -> [String] {
        value
            .split(separator: ",")
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
    }

    enum KeychainError: LocalizedError {
        case unhandledError(status: OSStatus)

        var errorDescription: String? {
            switch self {
            case .unhandledError(let status):
                return "Keychain error: \(status)"
            }
        }
    }
}
