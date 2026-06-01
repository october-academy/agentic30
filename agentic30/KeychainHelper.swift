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
        static let currentSchemaVersion = 8
        static let legacyDefaultCodexModelID = "gpt-5.4"
        static let legacyDefaultGeminiModelID = "gemini-3.1-pro-preview"
        static let defaultPostHogMcpURL = "https://mcp.posthog.com/mcp"
        static let defaultPostHogEuMcpURL = "https://mcp-eu.posthog.com/mcp"
        static let defaultPostHogMcpRegion = "us"
        static let defaultPostHogMcpFeatures = "sql,data_schema,insights,web_analytics,search,docs"

        var schemaVersion: Int = Settings.currentSchemaVersion

        // Agent Settings
        var preferredClaudeModel: String = AgentModelCatalog.defaultClaudeModelID
        var preferredCodexModel: String = AgentModelCatalog.defaultCodexModelID
        var preferredGeminiModel: String = AgentModelCatalog.defaultGeminiModelID
        var claudeAuthMode: String = AgentAuthMode.local.rawValue
        var codexAuthMode: String = AgentAuthMode.local.rawValue
        var geminiAuthMode: String = AgentAuthMode.local.rawValue
        var claudeApiKey: String = ""
        var codexApiKey: String = ""
        var geminiApiKey: String = ""
        var claudeEnvironment: String = ""
        var codexEnvironment: String = ""
        var geminiEnvironment: String = ""
        var exaApiKey: String = ""

        // Ad Analytics
        var posthogApiKey: String = ""
        var posthogProjectAPIKey: String = ""
        var posthogHost: String = ""
        var posthogMcpURL: String = Settings.defaultPostHogMcpURL
        var posthogMcpRegion: String = Settings.defaultPostHogMcpRegion
        var posthogMcpReadonly: Bool = true
        var posthogMcpFeatures: String = Settings.defaultPostHogMcpFeatures
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
            preferredGeminiModel = try container.decodeIfPresent(String.self, forKey: .preferredGeminiModel) ?? AgentModelCatalog.defaultGeminiModelID
            claudeAuthMode = try container.decodeIfPresent(String.self, forKey: .claudeAuthMode) ?? AgentAuthMode.local.rawValue
            codexAuthMode = try container.decodeIfPresent(String.self, forKey: .codexAuthMode) ?? AgentAuthMode.local.rawValue
            geminiAuthMode = try container.decodeIfPresent(String.self, forKey: .geminiAuthMode) ?? AgentAuthMode.local.rawValue
            claudeApiKey = try container.decodeIfPresent(String.self, forKey: .claudeApiKey) ?? ""
            codexApiKey = try container.decodeIfPresent(String.self, forKey: .codexApiKey) ?? ""
            geminiApiKey = try container.decodeIfPresent(String.self, forKey: .geminiApiKey) ?? ""
            claudeEnvironment = try container.decodeIfPresent(String.self, forKey: .claudeEnvironment) ?? ""
            codexEnvironment = try container.decodeIfPresent(String.self, forKey: .codexEnvironment) ?? ""
            geminiEnvironment = try container.decodeIfPresent(String.self, forKey: .geminiEnvironment) ?? ""
            exaApiKey = try container.decodeIfPresent(String.self, forKey: .exaApiKey) ?? ""

            posthogApiKey = try container.decodeIfPresent(String.self, forKey: .posthogApiKey) ?? ""
            posthogProjectAPIKey = try container.decodeIfPresent(String.self, forKey: .posthogProjectAPIKey) ?? ""
            posthogHost = try container.decodeIfPresent(String.self, forKey: .posthogHost) ?? ""
            posthogMcpURL = try container.decodeIfPresent(String.self, forKey: .posthogMcpURL) ?? Settings.defaultPostHogMcpURL
            posthogMcpRegion = try container.decodeIfPresent(String.self, forKey: .posthogMcpRegion) ?? Settings.defaultPostHogMcpRegion
            posthogMcpReadonly = try container.decodeIfPresent(Bool.self, forKey: .posthogMcpReadonly) ?? true
            posthogMcpFeatures = try container.decodeIfPresent(String.self, forKey: .posthogMcpFeatures) ?? Settings.defaultPostHogMcpFeatures
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
            try container.encode(preferredGeminiModel, forKey: .preferredGeminiModel)
            try container.encode(claudeAuthMode, forKey: .claudeAuthMode)
            try container.encode(codexAuthMode, forKey: .codexAuthMode)
            try container.encode(geminiAuthMode, forKey: .geminiAuthMode)
            try container.encode(claudeApiKey, forKey: .claudeApiKey)
            try container.encode(codexApiKey, forKey: .codexApiKey)
            try container.encode(geminiApiKey, forKey: .geminiApiKey)
            try container.encode(claudeEnvironment, forKey: .claudeEnvironment)
            try container.encode(codexEnvironment, forKey: .codexEnvironment)
            try container.encode(geminiEnvironment, forKey: .geminiEnvironment)
            try container.encode(exaApiKey, forKey: .exaApiKey)

            try container.encode(posthogApiKey, forKey: .posthogApiKey)
            try container.encode(posthogProjectAPIKey, forKey: .posthogProjectAPIKey)
            try container.encode(posthogHost, forKey: .posthogHost)
            try container.encode(posthogMcpURL, forKey: .posthogMcpURL)
            try container.encode(posthogMcpRegion, forKey: .posthogMcpRegion)
            try container.encode(posthogMcpReadonly, forKey: .posthogMcpReadonly)
            try container.encode(posthogMcpFeatures, forKey: .posthogMcpFeatures)
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
            case preferredGeminiModel
            case claudeAuthMode
            case codexAuthMode
            case geminiAuthMode
            case claudeApiKey
            case codexApiKey
            case geminiApiKey
            case claudeEnvironment
            case codexEnvironment
            case geminiEnvironment
            case exaApiKey
            case posthogApiKey
            case posthogProjectAPIKey
            case posthogHost
            case posthogMcpURL
            case posthogMcpRegion
            case posthogMcpReadonly
            case posthogMcpFeatures
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
            migrated.preferredGeminiModel = AgentModelCatalog.normalizedModelID(
                migrated.preferredGeminiModel,
                provider: .gemini
            )
            migrated.claudeAuthMode = AgentAuthMode.normalized(migrated.claudeAuthMode, provider: .claude).rawValue
            migrated.codexAuthMode = AgentAuthMode.normalized(migrated.codexAuthMode, provider: .codex).rawValue
            migrated.geminiAuthMode = AgentAuthMode.normalized(migrated.geminiAuthMode, provider: .gemini).rawValue
            if schemaVersion < 4 && migrated.preferredCodexModel == legacyDefaultCodexModelID {
                migrated.preferredCodexModel = AgentModelCatalog.defaultCodexModelID
            }
            if schemaVersion < 7 && migrated.preferredGeminiModel == legacyDefaultGeminiModelID {
                migrated.preferredGeminiModel = AgentModelCatalog.defaultGeminiModelID
            }
            if schemaVersion < 8 {
                migrated.posthogMcpRegion = normalizedPostHogMcpRegion(migrated.posthogMcpRegion, host: migrated.posthogHost)
                if migrated.posthogMcpURL.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                    || migrated.posthogMcpURL == defaultPostHogMcpURL {
                    if migrated.posthogMcpRegion == "eu" {
                        migrated.posthogMcpURL = defaultPostHogEuMcpURL
                    } else {
                        migrated.posthogMcpURL = defaultPostHogMcpURL
                    }
                }
                if migrated.posthogMcpFeatures.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    migrated.posthogMcpFeatures = defaultPostHogMcpFeatures
                }
            }
            return migrated
        }

        private static func normalizedPostHogMcpRegion(_ value: String, host: String) -> String {
            let region = value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            if region == "eu" { return "eu" }
            let normalizedHost = host.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            if normalizedHost.contains("eu.posthog.com") || normalizedHost.contains("eu.i.posthog.com") {
                return "eu"
            }
            return defaultPostHogMcpRegion
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

    typealias LocalDataResetReport = Agentic30LocalDataResetReport

    static func resetAgentic30LocalData(
        defaults: UserDefaults = .standard,
        fileManager: FileManager = .default,
        removeAppSupport: Bool = true,
        workspaceURL: URL? = nil,
        removeWorkspaceAgentic30: Bool = true
    ) throws -> LocalDataResetReport {
        var options = Agentic30LocalDataResetOptions()
        options.includeKnownWorkspaces = removeWorkspaceAgentic30

        let additionalWorkspaceURLs = workspaceURL.map { [$0] } ?? []
        return Agentic30LocalDataResetter.reset(
            options: options,
            defaults: defaults,
            fileManager: fileManager,
            appSupportURLs: removeAppSupport ? nil : [],
            devSecretsURLs: removeAppSupport ? nil : [],
            additionalWorkspaceURLs: additionalWorkspaceURLs
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
    static func resetAgentic30Defaults(
        _ defaults: UserDefaults = .standard,
        bundleIdentifier: String? = Bundle.main.bundleIdentifier
    ) -> Int {
        var removed = 0
        let domainNames = Agentic30LocalDataResetter.agentic30BundleIdentifiers(bundleIdentifier)
        for domainName in domainNames {
            if let domain = defaults.persistentDomain(forName: domainName), !domain.isEmpty {
                removed += domain.count
                defaults.removePersistentDomain(forName: domainName)
            }
        }

        let keys = defaults.dictionaryRepresentation().keys.filter { key in
            key.hasPrefix("agentic30.")
                || key.hasPrefix("com.agentic30.")
                || key.hasPrefix("IntakeV2.")
                || key.hasPrefix("pet.")
                || key.hasPrefix("NSNavPanel")
                || key == "NSOSPLastRootDirectory"
                || key == "bipWorkspaceRoot"
        }
        for key in keys {
            defaults.removeObject(forKey: key)
        }
        removed += keys.count
        defaults.synchronize()
        return removed
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

    static func resetKeychainStorageForLocalDataReset() {
        cachedSettings = nil
        cachedMacAuthSession = nil
        didLoadMacAuthSession = true
        cachedOnboardingContext = nil
        didLoadOnboardingContext = true

        deleteSettings()
        deleteMacAuthSession()
        deleteOnboardingContext()
        deleteAllServiceEntries()
    }

    static var devSecretsURLForReset: URL {
        devSecretsURL
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
                "mcpUrl": settings.posthogMcpURL.isEmpty ? Settings.defaultPostHogMcpURL : settings.posthogMcpURL,
                "mcpRegion": settings.posthogMcpRegion.isEmpty ? Settings.defaultPostHogMcpRegion : settings.posthogMcpRegion,
                "mcpReadonly": settings.posthogMcpReadonly,
                "mcpFeatures": settings.posthogMcpFeatures.isEmpty ? Settings.defaultPostHogMcpFeatures : settings.posthogMcpFeatures,
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

nonisolated struct Agentic30LocalDataResetOptions: Equatable {
    var includeKnownWorkspaces: Bool = true
    var includeAgentic30QmdIndex: Bool = true
    var removeManagedWorkspaceContent: Bool = true
    var removeAppBundle: Bool = false
}

nonisolated struct Agentic30LocalDataResetFailure: Equatable {
    let path: String
    let reason: String
}

nonisolated struct Agentic30LocalDataResetReport: Equatable {
    let removedDefaultsCount: Int
    let removedKeychainServiceEntries: Bool
    let removedAppSupportPaths: [String]
    let removedCachePaths: [String]
    let removedPreferencePaths: [String]
    let removedSavedStatePaths: [String]
    let removedQmdPaths: [String]
    let removedWorkspaceAgentic30Paths: [String]
    let removedManagedWorkspaceContentPaths: [String]
    let removedAppBundlePaths: [String]
    let skippedPaths: [String]
    let failures: [Agentic30LocalDataResetFailure]

    var removedAppSupport: Bool { !removedAppSupportPaths.isEmpty }
    var removedWorkspaceAgentic30: Bool { !removedWorkspaceAgentic30Paths.isEmpty }
    var removedQmdIndex: Bool { !removedQmdPaths.isEmpty }

    var removedPathCount: Int {
        removedAppSupportPaths.count
            + removedCachePaths.count
            + removedPreferencePaths.count
            + removedSavedStatePaths.count
            + removedQmdPaths.count
            + removedWorkspaceAgentic30Paths.count
            + removedManagedWorkspaceContentPaths.count
            + removedAppBundlePaths.count
    }
}

enum Agentic30LocalDataResetter {
    static let qmdIndexName = "agentic30"
    private static let day1HandoffMarkerStart = "<!-- agentic30:day1-handoff:start -->"
    private static let day1HandoffMarkerEnd = "<!-- agentic30:day1-handoff:end -->"
    private static let managedDay1HandoffRelativePaths = [
        "docs/GOAL.md",
        "docs/ICP.md",
        "docs/VALUES.md",
        "docs/SPEC.md",
    ]

    static func reset(
        options: Agentic30LocalDataResetOptions = Agentic30LocalDataResetOptions(),
        defaults: UserDefaults = .standard,
        fileManager: FileManager = .default,
        environment: [String: String] = ProcessInfo.processInfo.environment,
        bundleIdentifier: String? = Bundle.main.bundleIdentifier,
        appSupportURLs: [URL]? = nil,
        devSecretsURLs: [URL]? = nil,
        cacheURLs: [URL]? = nil,
        preferenceURLs: [URL]? = nil,
        savedStateURLs: [URL]? = nil,
        qmdDataURLs: [URL]? = nil,
        appBundleURL: URL? = Bundle.main.bundleURL,
        additionalWorkspaceURLs: [URL] = [],
        resetKeychainStorage: (() -> Void)? = nil
    ) -> Agentic30LocalDataResetReport {
        let workspaceURLs = uniqueURLs(
            (options.includeKnownWorkspaces ? WorkspaceSettings.knownWorkspaceURLs(defaults: defaults) : [])
                + additionalWorkspaceURLs
        )

        if let resetKeychainStorage {
            resetKeychainStorage()
        } else {
            KeychainHelper.resetKeychainStorageForLocalDataReset()
        }
        let removedDefaultsCount = KeychainHelper.resetAgentic30Defaults(
            defaults,
            bundleIdentifier: bundleIdentifier
        )

        var removedAppSupportPaths: [String] = []
        var removedCachePaths: [String] = []
        var removedPreferencePaths: [String] = []
        var removedSavedStatePaths: [String] = []
        var removedQmdPaths: [String] = []
        var removedWorkspaceAgentic30Paths: [String] = []
        var removedManagedWorkspaceContentPaths: [String] = []
        var removedAppBundlePaths: [String] = []
        var skippedPaths: [String] = []
        var failures: [Agentic30LocalDataResetFailure] = []

        func remove(_ url: URL, into removed: inout [String]) {
            removeIfPresent(
                url,
                fileManager: fileManager,
                removedPaths: &removed,
                skippedPaths: &skippedPaths,
                failures: &failures
            )
        }

        for url in appSupportURLs ?? defaultApplicationSupportURLs(environment: environment) {
            remove(url, into: &removedAppSupportPaths)
        }

        for url in devSecretsURLs ?? defaultDevSecretsURLs(environment: environment) {
            remove(url, into: &removedAppSupportPaths)
        }

        for url in cacheURLs ?? defaultCacheURLs(environment: environment, bundleIdentifier: bundleIdentifier) {
            remove(url, into: &removedCachePaths)
        }

        for url in preferenceURLs ?? defaultPreferenceURLs(environment: environment, bundleIdentifier: bundleIdentifier) {
            remove(url, into: &removedPreferencePaths)
        }

        for url in savedStateURLs ?? defaultSavedStateURLs(environment: environment, bundleIdentifier: bundleIdentifier) {
            remove(url, into: &removedSavedStatePaths)
        }

        if options.includeAgentic30QmdIndex {
            for url in qmdDataURLs ?? defaultQmdDataURLs(environment: environment) {
                remove(url, into: &removedQmdPaths)
            }
        }

        if options.includeKnownWorkspaces {
            for workspaceURL in workspaceURLs {
                let agentic30URL = workspaceURL
                    .standardizedFileURL
                    .appendingPathComponent(".agentic30", isDirectory: true)
                remove(agentic30URL, into: &removedWorkspaceAgentic30Paths)
            }
        }

        if options.removeManagedWorkspaceContent {
            for workspaceURL in workspaceURLs {
                removeManagedWorkspaceContent(
                    in: workspaceURL,
                    fileManager: fileManager,
                    removedPaths: &removedManagedWorkspaceContentPaths,
                    failures: &failures
                )
            }
        }

        if options.removeAppBundle, let appBundleURL {
            remove(appBundleURL, into: &removedAppBundlePaths)
        }

        return Agentic30LocalDataResetReport(
            removedDefaultsCount: removedDefaultsCount,
            removedKeychainServiceEntries: true,
            removedAppSupportPaths: removedAppSupportPaths,
            removedCachePaths: removedCachePaths,
            removedPreferencePaths: removedPreferencePaths,
            removedSavedStatePaths: removedSavedStatePaths,
            removedQmdPaths: removedQmdPaths,
            removedWorkspaceAgentic30Paths: removedWorkspaceAgentic30Paths,
            removedManagedWorkspaceContentPaths: removedManagedWorkspaceContentPaths,
            removedAppBundlePaths: removedAppBundlePaths,
            skippedPaths: skippedPaths,
            failures: failures
        )
    }

    private static func removeIfPresent(
        _ url: URL,
        fileManager: FileManager,
        removedPaths: inout [String],
        skippedPaths: inout [String],
        failures: inout [Agentic30LocalDataResetFailure]
    ) {
        let path = url.standardizedFileURL.path
        guard fileManager.fileExists(atPath: path) else {
            appendUnique(path, to: &skippedPaths)
            return
        }
        do {
            try fileManager.removeItem(atPath: path)
            appendUnique(path, to: &removedPaths)
        } catch {
            failures.append(Agentic30LocalDataResetFailure(path: path, reason: error.localizedDescription))
        }
    }

    private static func removeManagedWorkspaceContent(
        in workspaceURL: URL,
        fileManager: FileManager,
        removedPaths: inout [String],
        failures: inout [Agentic30LocalDataResetFailure]
    ) {
        let workspaceRoot = workspaceURL.standardizedFileURL
        for relativePath in managedDay1HandoffRelativePaths {
            let url = workspaceRoot.appendingPathComponent(relativePath, isDirectory: false)
            let path = url.standardizedFileURL.path
            guard fileManager.fileExists(atPath: path) else { continue }
            do {
                let existing = try String(contentsOf: url, encoding: .utf8)
                let cleaned = removingDay1HandoffBlocks(from: existing)
                guard cleaned != existing else { continue }
                try cleaned.write(to: url, atomically: true, encoding: .utf8)
                appendUnique(path, to: &removedPaths)
            } catch {
                failures.append(Agentic30LocalDataResetFailure(path: path, reason: error.localizedDescription))
            }
        }
    }

    private static func removingDay1HandoffBlocks(from content: String) -> String {
        var result = content
        while let start = result.range(of: day1HandoffMarkerStart),
              let end = result.range(of: day1HandoffMarkerEnd, range: start.upperBound..<result.endIndex) {
            var removalRange = start.lowerBound..<end.upperBound
            if removalRange.upperBound < result.endIndex,
               result[removalRange.upperBound] == "\r" {
                removalRange = removalRange.lowerBound..<result.index(after: removalRange.upperBound)
            }
            if removalRange.upperBound < result.endIndex,
               result[removalRange.upperBound] == "\n" {
                removalRange = removalRange.lowerBound..<result.index(after: removalRange.upperBound)
            }
            while removalRange.lowerBound > result.startIndex {
                let previous = result.index(before: removalRange.lowerBound)
                guard result[previous] == "\n" else { break }
                removalRange = previous..<removalRange.upperBound
            }
            result.removeSubrange(removalRange)
        }
        return result
    }

    private static func defaultApplicationSupportURLs(environment: [String: String]) -> [URL] {
        var urls = [KeychainHelper.applicationSupportURL]
        if environment["AGENTIC30_APP_SUPPORT_PATH"]?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ?? true {
            let appSupportRoot = homeDirectory(environment: environment)
                .appendingPathComponent("Library/Application Support", isDirectory: true)
            urls.append(appSupportRoot.appendingPathComponent("Agentic30", isDirectory: true))
        }
        return uniqueURLs(urls)
    }

    private static func defaultDevSecretsURLs(environment: [String: String]) -> [URL] {
        uniqueURLs(defaultApplicationSupportURLs(environment: environment).map {
            $0.appendingPathComponent("dev-secrets.json", isDirectory: false)
        } + [KeychainHelper.devSecretsURLForReset])
    }

    private static func defaultCacheURLs(
        environment: [String: String],
        bundleIdentifier: String?
    ) -> [URL] {
        let cacheRoot = homeDirectory(environment: environment)
            .appendingPathComponent("Library/Caches", isDirectory: true)
        return uniqueURLs(agentic30BundleIdentifiers(bundleIdentifier).map {
            cacheRoot.appendingPathComponent($0, isDirectory: true)
        } + [
            cacheRoot.appendingPathComponent("agentic30", isDirectory: true),
            cacheRoot.appendingPathComponent("Agentic30", isDirectory: true),
        ])
    }

    private static func defaultPreferenceURLs(
        environment: [String: String],
        bundleIdentifier: String?
    ) -> [URL] {
        let preferencesRoot = homeDirectory(environment: environment)
            .appendingPathComponent("Library/Preferences", isDirectory: true)
        return uniqueURLs(agentic30BundleIdentifiers(bundleIdentifier).map {
            preferencesRoot.appendingPathComponent("\($0).plist", isDirectory: false)
        })
    }

    private static func defaultSavedStateURLs(
        environment: [String: String],
        bundleIdentifier: String?
    ) -> [URL] {
        let savedStateRoot = homeDirectory(environment: environment)
            .appendingPathComponent("Library/Saved Application State", isDirectory: true)
        return uniqueURLs(agentic30BundleIdentifiers(bundleIdentifier).map {
            savedStateRoot.appendingPathComponent("\($0).savedState", isDirectory: true)
        })
    }

    private static func defaultQmdDataURLs(environment: [String: String]) -> [URL] {
        let home = homeDirectory(environment: environment)
        let cacheRoot = environment["XDG_CACHE_HOME"].flatMap(nonEmptyPathURL)
            ?? home.appendingPathComponent(".cache", isDirectory: true)
        let configRoot = environment["XDG_CONFIG_HOME"].flatMap(nonEmptyPathURL)
            ?? home.appendingPathComponent(".config", isDirectory: true)
        return [
            cacheRoot
                .appendingPathComponent("qmd", isDirectory: true)
                .appendingPathComponent("\(qmdIndexName).sqlite", isDirectory: false),
            configRoot
                .appendingPathComponent("qmd", isDirectory: true)
                .appendingPathComponent("\(qmdIndexName).yml", isDirectory: false),
        ]
    }

    static func agentic30BundleIdentifiers(_ bundleIdentifier: String?) -> [String] {
        uniqueStrings([
            bundleIdentifier,
            "october-academy.agentic30",
            "com.agentic30",
        ].compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty })
    }

    private static func homeDirectory(environment: [String: String]) -> URL {
        environment["HOME"].flatMap(nonEmptyPathURL) ?? FileManager.default.homeDirectoryForCurrentUser
    }

    nonisolated private static func nonEmptyPathURL(_ value: String) -> URL? {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        return URL(fileURLWithPath: trimmed, isDirectory: true)
    }

    private static func uniqueURLs(_ urls: [URL]) -> [URL] {
        var seen = Set<String>()
        var result: [URL] = []
        for url in urls {
            let standardized = url.standardizedFileURL
            guard seen.insert(standardized.path).inserted else { continue }
            result.append(standardized)
        }
        return result
    }

    private static func uniqueStrings(_ strings: [String]) -> [String] {
        var seen = Set<String>()
        return strings.filter { seen.insert($0).inserted }
    }

    private static func appendUnique(_ path: String, to paths: inout [String]) {
        guard !paths.contains(path) else { return }
        paths.append(path)
    }
}
