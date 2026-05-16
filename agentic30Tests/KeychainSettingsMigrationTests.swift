import Foundation
import Testing
@testable import agentic30

@MainActor
struct KeychainSettingsMigrationTests {
    @Test func geminiProviderAndModelCatalogAreNormalized() {
        #expect(AgentProvider(rawValue: "gemini") == .gemini)
        #expect(AgentModelCatalog.defaultModelID(for: .gemini) == AgentModelCatalog.defaultGeminiModelID)
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
        #expect(settings.notionEnabled == false)
    }

    @Test func encodesCurrentSchemaVersion() throws {
        var settings = KeychainHelper.Settings()
        settings.posthogApiKey = "ph-key"
        settings.posthogProjectAPIKey = "phc-project"
        settings.preferredClaudeModel = "claude-opus-4-7"
        settings.preferredCodexModel = "gpt-5.3-codex"
        settings.preferredGeminiModel = "gemini-2.5-flash"
        settings.geminiAuthMode = AgentAuthMode.apiKey.rawValue
        settings.geminiApiKey = "gemini-secret"

        let data = try JSONEncoder().encode(settings)
        let object = try #require(
            JSONSerialization.jsonObject(with: data) as? [String: Any]
        )

        #expect(object["schemaVersion"] as? Int == KeychainHelper.Settings.currentSchemaVersion)
        #expect(object["posthogApiKey"] as? String == "ph-key")
        #expect(object["posthogProjectAPIKey"] as? String == "phc-project")
        #expect(object["preferredClaudeModel"] as? String == "claude-opus-4-7")
        #expect(object["preferredCodexModel"] as? String == "gpt-5.3-codex")
        #expect(object["preferredGeminiModel"] as? String == "gemini-2.5-flash")
        #expect(object["geminiAuthMode"] as? String == AgentAuthMode.apiKey.rawValue)
        #expect(object["geminiApiKey"] as? String == "gemini-secret")
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
    }

    @Test func migrationMovesLegacyCodexDefaultToGPT55() {
        var oldSettings = KeychainHelper.Settings()
        oldSettings.schemaVersion = 3
        oldSettings.preferredCodexModel = KeychainHelper.Settings.legacyDefaultCodexModelID

        let migrated = KeychainHelper.Settings.migrate(oldSettings, from: 3)

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
