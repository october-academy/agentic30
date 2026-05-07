import Foundation
import Testing
@testable import agentic30

@MainActor
struct KeychainSettingsMigrationTests {
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
        #expect(settings.notionEnabled == false)
    }

    @Test func encodesCurrentSchemaVersion() throws {
        var settings = KeychainHelper.Settings()
        settings.posthogApiKey = "ph-key"
        settings.posthogProjectAPIKey = "phc-project"
        settings.preferredClaudeModel = "claude-opus-4-7"
        settings.preferredCodexModel = "gpt-5.3-codex"

        let data = try JSONEncoder().encode(settings)
        let object = try #require(
            JSONSerialization.jsonObject(with: data) as? [String: Any]
        )

        #expect(object["schemaVersion"] as? Int == KeychainHelper.Settings.currentSchemaVersion)
        #expect(object["posthogApiKey"] as? String == "ph-key")
        #expect(object["posthogProjectAPIKey"] as? String == "phc-project")
        #expect(object["preferredClaudeModel"] as? String == "claude-opus-4-7")
        #expect(object["preferredCodexModel"] as? String == "gpt-5.3-codex")
    }

    @Test func migrationRegistryAlwaysNormalizesToCurrentSchema() {
        var oldSettings = KeychainHelper.Settings()
        oldSettings.schemaVersion = 0
        oldSettings.bipSpecPath = "docs/SPEC.md"
        oldSettings.preferredClaudeModel = "unknown-claude"
        oldSettings.preferredCodexModel = "unknown-codex"

        let migrated = KeychainHelper.Settings.migrate(oldSettings, from: 0)

        #expect(migrated.schemaVersion == KeychainHelper.Settings.currentSchemaVersion)
        #expect(migrated.bipSpecPath == "docs/SPEC.md")
        #expect(migrated.preferredClaudeModel == AgentModelCatalog.defaultClaudeModelID)
        #expect(migrated.preferredCodexModel == AgentModelCatalog.defaultCodexModelID)
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
}
