import Foundation
import Testing
@testable import agentic30

@MainActor
struct KeychainSettingsMigrationTests {
    @Test func geminiProviderAndModelCatalogAreNormalized() {
        #expect(AgentProvider(rawValue: "gemini") == .gemini)
        #expect(AgentModelCatalog.defaultModelID(for: .gemini) == AgentModelCatalog.defaultGeminiModelID)
        #expect(AgentModelCatalog.defaultGeminiModelID == "gemini-3.5-flash")
        #expect(AgentModelCatalog.normalizedModelID("gemini-3.5-flash", provider: .gemini) == "gemini-3.5-flash")
        #expect(AgentModelCatalog.normalizedModelID("gemini-2.5-flash", provider: .gemini) == "gemini-2.5-flash")
        #expect(AgentModelCatalog.normalizedModelID("unknown", provider: .gemini) == AgentModelCatalog.defaultGeminiModelID)
        #expect(AgentModelCatalog.options(for: .gemini).contains { $0.id == AgentModelCatalog.defaultGeminiModelID })
    }

    @Test func decodesLegacySettingsWithoutSchemaVersion() throws {
        let legacyPayload = """
        {
          "posthogApiKey": "ph-key",
          "posthogHost": "https://eu.posthog.com",
          "metaAccessToken": "meta-token",
          "metaAdAccountId": "act_123",
          "bipWorkspaceRoot": "/tmp/app",
          "bipIcpPath": "docs/ICP.md"
        }
        """

        let settings = try JSONDecoder().decode(
            KeychainHelper.Settings.self,
            from: Data(legacyPayload.utf8)
        )

        #expect(settings.schemaVersion == KeychainHelper.Settings.currentSchemaVersion)
        #expect(settings.posthogApiKey == "ph-key")
        #expect(settings.posthogHost == "https://eu.posthog.com")
        #expect(settings.posthogMcpURL == KeychainHelper.Settings.defaultPostHogEuMcpURL)
        #expect(settings.posthogMcpRegion == "eu")
        #expect(settings.posthogMcpReadonly == true)
        #expect(settings.posthogMcpFeatures == KeychainHelper.Settings.defaultPostHogMcpFeatures)
        #expect(settings.metaAccessToken == "meta-token")
        #expect(settings.metaAdAccountId == "act_123")
        #expect(settings.bipWorkspaceRoot == "/tmp/app")
        #expect(settings.bipIcpPath == "docs/ICP.md")
        #expect(settings.bipSpecPath == "")
        #expect(settings.preferredClaudeModel == AgentModelCatalog.defaultClaudeModelID)
        #expect(settings.preferredCodexModel == AgentModelCatalog.defaultCodexModelID)
        #expect(settings.preferredGeminiModel == AgentModelCatalog.defaultGeminiModelID)
        #expect(settings.claudeAuthMode == AgentAuthMode.local.rawValue)
        #expect(settings.codexAuthMode == AgentAuthMode.local.rawValue)
        #expect(settings.geminiAuthMode == AgentAuthMode.local.rawValue)
        #expect(settings.geminiApiKey == "")
        #expect(settings.cloudflareApiToken == "")
        #expect(settings.cloudflareMcpURL == KeychainHelper.Settings.defaultCloudflareMcpURL)
        #expect(settings.cloudflareMcpCodemode == KeychainHelper.Settings.defaultCloudflareMcpCodemode)
        #expect(settings.notionEnabled == false)
    }

    @Test func encodesCurrentSchemaVersion() throws {
        var settings = KeychainHelper.Settings()
        settings.posthogApiKey = "ph-key"
        settings.posthogProjectAPIKey = "phc-project"
        settings.posthogMcpURL = "https://mcp-eu.posthog.com/mcp"
        settings.posthogMcpRegion = "eu"
        settings.posthogMcpReadonly = false
        settings.posthogMcpFeatures = "sql,docs"
        settings.preferredClaudeModel = "claude-opus-4-8"
        settings.preferredCodexModel = "gpt-5.5"
        settings.preferredGeminiModel = "gemini-2.5-flash"
        settings.geminiAuthMode = AgentAuthMode.apiKey.rawValue
        settings.geminiApiKey = "gemini-secret"
        settings.cloudflareApiToken = "cloudflare-secret"
        settings.cloudflareMcpURL = "https://mcp.cloudflare.com/mcp?codemode=false"
        settings.cloudflareMcpCodemode = false

        let data = try JSONEncoder().encode(settings)
        let object = try #require(
            JSONSerialization.jsonObject(with: data) as? [String: Any]
        )

        #expect(object["schemaVersion"] as? Int == KeychainHelper.Settings.currentSchemaVersion)
        #expect(object["posthogApiKey"] as? String == "ph-key")
        #expect(object["posthogProjectAPIKey"] as? String == "phc-project")
        #expect(object["posthogMcpURL"] as? String == "https://mcp-eu.posthog.com/mcp")
        #expect(object["posthogMcpRegion"] as? String == "eu")
        #expect(object["posthogMcpReadonly"] as? Bool == false)
        #expect(object["posthogMcpFeatures"] as? String == "sql,docs")
        #expect(object["preferredClaudeModel"] as? String == "claude-opus-4-8")
        #expect(object["preferredCodexModel"] as? String == "gpt-5.5")
        #expect(object["preferredGeminiModel"] as? String == "gemini-2.5-flash")
        #expect(object["geminiAuthMode"] as? String == AgentAuthMode.apiKey.rawValue)
        #expect(object["geminiApiKey"] as? String == "gemini-secret")
        #expect(object["cloudflareApiToken"] as? String == "cloudflare-secret")
        #expect(object["cloudflareMcpURL"] as? String == "https://mcp.cloudflare.com/mcp?codemode=false")
        #expect(object["cloudflareMcpCodemode"] as? Bool == false)
    }

    @Test func syncAllConfigFilesWritesMcpIntegrationConfigs() throws {
        let fileManager = FileManager.default
        let appSupport = fileManager.temporaryDirectory
            .appendingPathComponent("agentic30-config-sync-\(UUID().uuidString)", isDirectory: true)
        let previousAppSupportPath = ProcessInfo.processInfo.environment["AGENTIC30_APP_SUPPORT_PATH"]
        setenv("AGENTIC30_APP_SUPPORT_PATH", appSupport.path, 1)
        defer {
            if let previousAppSupportPath {
                setenv("AGENTIC30_APP_SUPPORT_PATH", previousAppSupportPath, 1)
            } else {
                unsetenv("AGENTIC30_APP_SUPPORT_PATH")
            }
            try? fileManager.removeItem(at: appSupport)
        }

        var settings = KeychainHelper.Settings()
        settings.cloudflareApiToken = "cf-token"
        settings.cloudflareMcpURL = "https://mcp.cloudflare.com/mcp"
        settings.cloudflareMcpCodemode = false
        settings.posthogApiKey = "phx-posthog"
        settings.posthogProjectAPIKey = "phc-project"
        settings.posthogMcpURL = KeychainHelper.Settings.defaultPostHogEuMcpURL
        settings.posthogMcpRegion = "eu"
        settings.posthogMcpReadonly = false
        settings.posthogMcpFeatures = "sql,insights"

        KeychainHelper.syncAllConfigFiles(from: settings)

        let cloudflareData = try Data(contentsOf: appSupport.appendingPathComponent("cloudflare-config.json"))
        let cloudflareRoot = try #require(JSONSerialization.jsonObject(with: cloudflareData) as? [String: Any])
        let cloudflare = try #require(cloudflareRoot["cloudflare"] as? [String: Any])
        #expect(cloudflare["apiToken"] as? String == "cf-token")
        #expect(cloudflare["mcpUrl"] as? String == "https://mcp.cloudflare.com/mcp")
        #expect(cloudflare["mcpCodemode"] as? Bool == false)

        let adData = try Data(contentsOf: appSupport.appendingPathComponent("ad-config.json"))
        let adRoot = try #require(JSONSerialization.jsonObject(with: adData) as? [String: Any])
        let posthog = try #require(adRoot["posthog"] as? [String: Any])
        #expect(posthog["apiKey"] as? String == "phx-posthog")
        #expect(posthog["projectApiKey"] as? String == "phc-project")
        #expect(posthog["mcpUrl"] as? String == KeychainHelper.Settings.defaultPostHogEuMcpURL)
        #expect(posthog["mcpRegion"] as? String == "eu")
        #expect(posthog["mcpReadonly"] as? Bool == false)
        #expect(posthog["mcpFeatures"] as? String == "sql,insights")
    }

    @Test func migrationRegistryAlwaysNormalizesToCurrentSchema() {
        var oldSettings = KeychainHelper.Settings()
        oldSettings.schemaVersion = 0
        oldSettings.bipSpecPath = "docs/SPEC.md"
        oldSettings.preferredClaudeModel = "unknown-claude"
        oldSettings.preferredCodexModel = "unknown-codex"
        oldSettings.preferredGeminiModel = "unknown-gemini"
        oldSettings.geminiAuthMode = "bedrock"

        let migrated = KeychainHelper.Settings.migrate(oldSettings, from: 0)

        #expect(migrated.schemaVersion == KeychainHelper.Settings.currentSchemaVersion)
        #expect(migrated.bipSpecPath == "docs/SPEC.md")
        #expect(migrated.preferredClaudeModel == AgentModelCatalog.defaultClaudeModelID)
        #expect(migrated.preferredCodexModel == AgentModelCatalog.defaultCodexModelID)
        #expect(migrated.preferredGeminiModel == AgentModelCatalog.defaultGeminiModelID)
        #expect(migrated.geminiAuthMode == AgentAuthMode.local.rawValue)
        #expect(migrated.cloudflareMcpURL == KeychainHelper.Settings.defaultCloudflareMcpURL)
        #expect(migrated.cloudflareMcpCodemode == KeychainHelper.Settings.defaultCloudflareMcpCodemode)
    }

    @Test func migrationMovesLegacyCodexDefaultToGPT55() {
        var oldSettings = KeychainHelper.Settings()
        oldSettings.schemaVersion = 3
        oldSettings.preferredCodexModel = KeychainHelper.Settings.legacyDefaultCodexModelID

        let migrated = KeychainHelper.Settings.migrate(oldSettings, from: 3)

        #expect(migrated.schemaVersion == KeychainHelper.Settings.currentSchemaVersion)
        #expect(migrated.preferredCodexModel == AgentModelCatalog.defaultCodexModelID)
    }

    @Test func migrationMovesPreviousCodexDefaultToGPT55() {
        var oldSettings = KeychainHelper.Settings()
        oldSettings.schemaVersion = 8
        oldSettings.preferredCodexModel = KeychainHelper.Settings.previousDefaultCodexModelID

        let migrated = KeychainHelper.Settings.migrate(oldSettings, from: 8)

        #expect(migrated.schemaVersion == KeychainHelper.Settings.currentSchemaVersion)
        #expect(migrated.preferredCodexModel == AgentModelCatalog.defaultCodexModelID)
    }

    @Test func migrationPreservesExplicitCodexMiniSelection() {
        var oldSettings = KeychainHelper.Settings()
        oldSettings.schemaVersion = 3
        oldSettings.preferredCodexModel = "gpt-5.4-mini"

        let migrated = KeychainHelper.Settings.migrate(oldSettings, from: 3)

        #expect(migrated.preferredCodexModel == "gpt-5.4-mini")
    }

    @Test func migrationMovesRetiredCodexModelToDefault() {
        // gpt-5.1-codex-mini는 ChatGPT 인증 Codex 카탈로그에서 제거된 모델 —
        // 카탈로그 밖 ID는 기본값으로 폴백해야 한다.
        var oldSettings = KeychainHelper.Settings()
        oldSettings.schemaVersion = 3
        oldSettings.preferredCodexModel = "gpt-5.1-codex-mini"

        let migrated = KeychainHelper.Settings.migrate(oldSettings, from: 3)

        #expect(migrated.preferredCodexModel == AgentModelCatalog.defaultCodexModelID)
    }

    @Test func migrationMovesLegacyGeminiDefaultToGemini35Flash() {
        var oldSettings = KeychainHelper.Settings()
        oldSettings.schemaVersion = 6
        oldSettings.preferredGeminiModel = KeychainHelper.Settings.legacyDefaultGeminiModelID

        let migrated = KeychainHelper.Settings.migrate(oldSettings, from: 6)

        #expect(migrated.schemaVersion == KeychainHelper.Settings.currentSchemaVersion)
        #expect(migrated.preferredGeminiModel == AgentModelCatalog.defaultGeminiModelID)
    }

    @Test func migrationMovesPreviousGeminiDefaultToGemini35Flash() {
        var oldSettings = KeychainHelper.Settings()
        oldSettings.schemaVersion = 8
        oldSettings.preferredGeminiModel = KeychainHelper.Settings.previousDefaultGeminiModelID

        let migrated = KeychainHelper.Settings.migrate(oldSettings, from: 8)

        #expect(migrated.schemaVersion == KeychainHelper.Settings.currentSchemaVersion)
        #expect(migrated.preferredGeminiModel == AgentModelCatalog.defaultGeminiModelID)
    }

    @Test func resetAgentic30DefaultsRemovesOnlyAppScopedKeys() throws {
        let suiteName = "agentic30.reset-defaults.\(UUID().uuidString)"
        let defaults = try #require(UserDefaults(suiteName: suiteName))
        defer {
            defaults.removePersistentDomain(forName: suiteName)
        }

        defaults.set("/tmp/workspace", forKey: "agentic30.workspaceRoot")
        defaults.set(true, forKey: "com.agentic30.didCompleteSetup")
        defaults.set(Data([0x01]), forKey: "agentic30.intakeV2.state.v1")
        defaults.set(Data([0x02]), forKey: "agentic30.intakeV2.sources.v1")
        defaults.set(Data([0x03]), forKey: "IntakeV2.state.v1")
        defaults.set(Data([0x04]), forKey: "IntakeV2.sources.v1")
        defaults.set("frame", forKey: "agentic30.pet.window.frame")
        defaults.set(false, forKey: "agentic30.pet.enabled")
        defaults.set("frame", forKey: "pet.window.frame")
        defaults.set(false, forKey: "pet.enabled")
        defaults.set("{880, 448}", forKey: "NSNavPanelExpandedSizeForOpenMode")
        defaults.set(Data([0x05]), forKey: "NSOSPLastRootDirectory")
        defaults.set("/tmp/legacy", forKey: "bipWorkspaceRoot")
        defaults.set("keep", forKey: "unrelated.app.key")

        let removedCount = KeychainHelper.resetAgentic30Defaults(defaults)

        #expect(removedCount >= 13)
        #expect(defaults.object(forKey: "agentic30.workspaceRoot") == nil)
        #expect(defaults.object(forKey: "com.agentic30.didCompleteSetup") == nil)
        #expect(defaults.object(forKey: "agentic30.intakeV2.state.v1") == nil)
        #expect(defaults.object(forKey: "agentic30.intakeV2.sources.v1") == nil)
        #expect(defaults.object(forKey: "IntakeV2.state.v1") == nil)
        #expect(defaults.object(forKey: "IntakeV2.sources.v1") == nil)
        #expect(defaults.object(forKey: "agentic30.pet.window.frame") == nil)
        #expect(defaults.object(forKey: "agentic30.pet.enabled") == nil)
        #expect(defaults.object(forKey: "pet.window.frame") == nil)
        #expect(defaults.object(forKey: "pet.enabled") == nil)
        #expect(defaults.object(forKey: "NSNavPanelExpandedSizeForOpenMode") == nil)
        #expect(defaults.object(forKey: "NSOSPLastRootDirectory") == nil)
        #expect(defaults.object(forKey: "bipWorkspaceRoot") == nil)
        #expect(defaults.string(forKey: "unrelated.app.key") == "keep")
    }

    @Test func localDataResetterRemovesOnlyAgentic30OwnedLocalData() throws {
        let fileManager = FileManager.default
        let tempRoot = fileManager.temporaryDirectory
            .appendingPathComponent("agentic30-local-reset-\(UUID().uuidString)", isDirectory: true)
        let home = tempRoot.appendingPathComponent("home", isDirectory: true)
        let appSupport = home.appendingPathComponent("Library/Application Support/agentic30", isDirectory: true)
        let legacyAppSupport = home.appendingPathComponent("Library/Application Support/Agentic30", isDirectory: true)
        let bundleCache = home.appendingPathComponent("Library/Caches/october-academy.agentic30", isDirectory: true)
        let genericCache = home.appendingPathComponent("Library/Caches/agentic30", isDirectory: true)
        let preferences = home.appendingPathComponent("Library/Preferences/october-academy.agentic30.plist")
        let savedState = home.appendingPathComponent("Library/Saved Application State/october-academy.agentic30.savedState", isDirectory: true)
        let xdgCache = tempRoot.appendingPathComponent("xdg-cache", isDirectory: true)
        let xdgConfig = tempRoot.appendingPathComponent("xdg-config", isDirectory: true)
        let workspaceA = tempRoot.appendingPathComponent("workspace-a", isDirectory: true)
        let workspaceB = tempRoot.appendingPathComponent("workspace-b", isDirectory: true)
        let currentWorkspace = tempRoot.appendingPathComponent("workspace-current", isDirectory: true)
        let suiteName = "agentic30.local-resetter.\(UUID().uuidString)"
        let defaults = try #require(UserDefaults(suiteName: suiteName))
        let productionLegacyProvider = WorkspaceSettings.legacyWorkspaceProvider
        WorkspaceSettings.legacyWorkspaceProvider = { "" }
        defer {
            WorkspaceSettings.legacyWorkspaceProvider = productionLegacyProvider
            defaults.removePersistentDomain(forName: suiteName)
            try? fileManager.removeItem(at: tempRoot)
        }

        for directory in [
            appSupport.appendingPathComponent("sessions", isDirectory: true),
            legacyAppSupport,
            bundleCache,
            genericCache,
            savedState,
            xdgCache.appendingPathComponent("qmd", isDirectory: true),
            xdgConfig.appendingPathComponent("qmd", isDirectory: true),
            workspaceA.appendingPathComponent(".agentic30", isDirectory: true),
            workspaceB.appendingPathComponent(".agentic30", isDirectory: true),
            currentWorkspace.appendingPathComponent(".agentic30", isDirectory: true),
        ] {
            try fileManager.createDirectory(at: directory, withIntermediateDirectories: true)
        }
        try "session".write(to: appSupport.appendingPathComponent("sessions/session.json"), atomically: true, encoding: .utf8)
        try "legacy".write(to: legacyAppSupport.appendingPathComponent("legacy.json"), atomically: true, encoding: .utf8)
        try "cache".write(to: bundleCache.appendingPathComponent("cache.json"), atomically: true, encoding: .utf8)
        try "cache".write(to: genericCache.appendingPathComponent("cache.json"), atomically: true, encoding: .utf8)
        try fileManager.createDirectory(at: preferences.deletingLastPathComponent(), withIntermediateDirectories: true)
        try "plist".write(to: preferences, atomically: true, encoding: .utf8)
        try "state".write(to: savedState.appendingPathComponent("windows.plist"), atomically: true, encoding: .utf8)
        try "default-index".write(
            to: xdgCache.appendingPathComponent("qmd/index.sqlite"),
            atomically: true,
            encoding: .utf8
        )
        try "agentic30-index".write(
            to: xdgCache.appendingPathComponent("qmd/agentic30.sqlite"),
            atomically: true,
            encoding: .utf8
        )
        try "default-config".write(
            to: xdgConfig.appendingPathComponent("qmd/index.yml"),
            atomically: true,
            encoding: .utf8
        )
        try "agentic30-config".write(
            to: xdgConfig.appendingPathComponent("qmd/agentic30.yml"),
            atomically: true,
            encoding: .utf8
        )
        for workspace in [workspaceA, workspaceB, currentWorkspace] {
            try "# Project".write(
                to: workspace.appendingPathComponent("README.md"),
                atomically: true,
                encoding: .utf8
            )
        }
        defaults.set([workspaceA.path, workspaceB.path], forKey: "agentic30.workspaceRoots.v1")
        defaults.set(currentWorkspace.path, forKey: "agentic30.workspaceRoot")
        defaults.set("reset-me", forKey: "agentic30.test")
        defaults.set("keep", forKey: "unrelated.test")

        let report = Agentic30LocalDataResetter.reset(
            defaults: defaults,
            fileManager: fileManager,
            environment: [
                "HOME": home.path,
                "XDG_CACHE_HOME": xdgCache.path,
                "XDG_CONFIG_HOME": xdgConfig.path,
            ],
            bundleIdentifier: "october-academy.agentic30",
            appSupportURLs: [appSupport, legacyAppSupport],
            devSecretsURLs: [],
            appBundleURL: nil,
            resetKeychainStorage: {}
        )

        #expect(report.failures.isEmpty)
        #expect(report.removedAppSupportPaths.count >= 1)
        #expect(report.removedQmdPaths.count == 2)
        #expect(report.removedWorkspaceAgentic30Paths.count == 3)
        #expect(fileManager.fileExists(atPath: appSupport.path) == false)
        #expect(fileManager.fileExists(atPath: legacyAppSupport.path) == false)
        #expect(fileManager.fileExists(atPath: bundleCache.path) == false)
        #expect(fileManager.fileExists(atPath: genericCache.path) == false)
        #expect(fileManager.fileExists(atPath: preferences.path) == false)
        #expect(fileManager.fileExists(atPath: savedState.path) == false)
        #expect(fileManager.fileExists(atPath: xdgCache.appendingPathComponent("qmd/agentic30.sqlite").path) == false)
        #expect(fileManager.fileExists(atPath: xdgConfig.appendingPathComponent("qmd/agentic30.yml").path) == false)
        #expect(fileManager.fileExists(atPath: xdgCache.appendingPathComponent("qmd/index.sqlite").path) == true)
        #expect(fileManager.fileExists(atPath: xdgConfig.appendingPathComponent("qmd/index.yml").path) == true)
        for workspace in [workspaceA, workspaceB, currentWorkspace] {
            #expect(fileManager.fileExists(atPath: workspace.appendingPathComponent(".agentic30").path) == false)
            #expect(fileManager.fileExists(atPath: workspace.appendingPathComponent("README.md").path) == true)
        }
        #expect(defaults.object(forKey: "agentic30.workspaceRoots.v1") == nil)
        #expect(defaults.object(forKey: "agentic30.workspaceRoot") == nil)
        #expect(defaults.string(forKey: "unrelated.test") == "keep")
    }

    @Test func localDataResetterRemovesOnlyManagedDay1HandoffBlocks() throws {
        let fileManager = FileManager.default
        let tempRoot = fileManager.temporaryDirectory
            .appendingPathComponent("agentic30-managed-content-reset-\(UUID().uuidString)", isDirectory: true)
        let workspace = tempRoot.appendingPathComponent("workspace", isDirectory: true)
        let docs = workspace.appendingPathComponent("docs", isDirectory: true)
        let goal = docs.appendingPathComponent("GOAL.md")
        let icp = docs.appendingPathComponent("ICP.md")
        let readme = workspace.appendingPathComponent("README.md")
        let suiteName = "agentic30.managed-content-reset.\(UUID().uuidString)"
        let defaults = try #require(UserDefaults(suiteName: suiteName))
        let productionLegacyProvider = WorkspaceSettings.legacyWorkspaceProvider
        WorkspaceSettings.legacyWorkspaceProvider = { "" }
        defer {
            WorkspaceSettings.legacyWorkspaceProvider = productionLegacyProvider
            defaults.removePersistentDomain(forName: suiteName)
            try? fileManager.removeItem(at: tempRoot)
        }

        try fileManager.createDirectory(at: docs, withIntermediateDirectories: true)
        try [
            "# GOAL",
            "",
            "User-authored goal stays.",
            "",
            "<!-- agentic30:day1-handoff:start -->",
            "generated interview content must reset",
            "<!-- agentic30:day1-handoff:end -->",
            "",
            "User appendix stays.",
            "",
        ].joined(separator: "\n").write(to: goal, atomically: true, encoding: .utf8)
        try "# ICP\n\nNo generated block here.\n".write(to: icp, atomically: true, encoding: .utf8)
        try [
            "# README",
            "",
            "<!-- agentic30:day1-handoff:start -->",
            "not a canonical managed doc",
            "<!-- agentic30:day1-handoff:end -->",
            "",
        ].joined(separator: "\n").write(to: readme, atomically: true, encoding: .utf8)
        defaults.set(workspace.path, forKey: "agentic30.workspaceRoot")

        let report = Agentic30LocalDataResetter.reset(
            defaults: defaults,
            fileManager: fileManager,
            appSupportURLs: [],
            devSecretsURLs: [],
            cacheURLs: [],
            preferenceURLs: [],
            savedStateURLs: [],
            qmdDataURLs: [],
            appBundleURL: nil,
            resetKeychainStorage: {}
        )

        let cleanedGoal = try String(contentsOf: goal, encoding: .utf8)
        let preservedIcp = try String(contentsOf: icp, encoding: .utf8)
        let preservedReadme = try String(contentsOf: readme, encoding: .utf8)

        #expect(report.failures.isEmpty)
        #expect(report.removedManagedWorkspaceContentPaths == [goal.path])
        #expect(cleanedGoal.contains("User-authored goal stays."))
        #expect(cleanedGoal.contains("User appendix stays."))
        #expect(!cleanedGoal.contains("agentic30:day1-handoff"))
        #expect(!cleanedGoal.contains("generated interview content must reset"))
        #expect(preservedIcp == "# ICP\n\nNo generated block here.\n")
        #expect(preservedReadme.contains("not a canonical managed doc"))
    }

    @Test func resetWorkspaceAgentic30DataRemovesOnlyManagedWorkspaceDirectory() throws {
        let workspace = FileManager.default.temporaryDirectory
            .appendingPathComponent("agentic30-reset-workspace-\(UUID().uuidString)", isDirectory: true)
        let managedDir = workspace.appendingPathComponent(".agentic30", isDirectory: true)
        let iddDir = managedDir.appendingPathComponent("idd", isDirectory: true)
        let projectFile = workspace.appendingPathComponent("README.md")
        defer {
            try? FileManager.default.removeItem(at: workspace)
        }

        try FileManager.default.createDirectory(at: iddDir, withIntermediateDirectories: true)
        try #"{"status":"error"}"#.write(
            to: iddDir.appendingPathComponent("setup-state.json"),
            atomically: true,
            encoding: .utf8
        )
        try "# Project".write(to: projectFile, atomically: true, encoding: .utf8)

        let removed = try KeychainHelper.removeWorkspaceAgentic30Data(in: workspace)

        #expect(removed == true)
        #expect(FileManager.default.fileExists(atPath: managedDir.path) == false)
        #expect(FileManager.default.fileExists(atPath: projectFile.path) == true)
    }
}
