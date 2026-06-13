import Foundation
import Testing
@testable import agentic30

struct AgenticDeepLinkTests {

    @Test func parsesSettingsIntegrationsHostPath() throws {
        let link = try #require(AgenticDeepLink(url: URL(string: "agentic30://settings/integrations")!))

        #expect(link.destination == .settings(section: .integrations))
        #expect(link.telemetrySource == "deep_link_settings")
    }

    @Test func parsesSettingsSectionQuery() throws {
        let link = try #require(AgenticDeepLink(url: URL(string: "agentic30://settings?section=integrations")!))

        #expect(link.destination == .settings(section: .integrations))
        #expect(link.telemetrySource == "deep_link_settings")
    }

    @Test func parsesSlashStyleSettingsURL() throws {
        let link = try #require(AgenticDeepLink(url: URL(string: "agentic30:///settings/integrations")!))

        #expect(link.destination == .settings(section: .integrations))
    }

    @Test func parsesMcpOauthCompletionAsIntegrationsRoute() throws {
        let link = try #require(AgenticDeepLink(url: URL(string: "agentic30://mcp-oauth/connected?server=posthog")!))

        #expect(link.destination == .settings(section: .integrations))
        #expect(link.telemetrySource == "mcp_oauth_deep_link")
    }

    @Test func parsesOfficeHoursQuestionRoute() throws {
        let link = try #require(AgenticDeepLink(url: URL(string: "agentic30://office-hours/question?sessionId=session-7&requestId=req-7")!))

        #expect(link.destination == .officeHoursQuestion(sessionId: "session-7", requestId: "req-7"))
        #expect(link.telemetrySource == "office_hours_deep_link")
    }

    @Test func parsesOpenDesignRouteWithAnchor() throws {
        let link = try #require(AgenticDeepLink(url: URL(string: "agentic30://open-design/morningBriefing?day=3&anchor=summary&placement=action")!))

        #expect(link.destination == .openDesign(route: .morningBriefing, day: 3, anchor: "summary", placement: .action))
        #expect(link.telemetrySource == "open_design_deep_link")
    }

    @Test func parsesDocumentRoute() throws {
        let link = try #require(AgenticDeepLink(url: URL(string: "agentic30://document?path=/tmp/ICP.md")!))

        #expect(link.destination == .document(path: "/tmp/ICP.md"))
        #expect(link.telemetrySource == "document_deep_link")
    }

    @Test func parsesCommonRouteFromNotificationUserInfo() throws {
        let route = AgenticAppRoute(
            destination: .officeHoursQuestion(sessionId: "session-7", requestId: "req-7")
        )
        let parsed = try #require(AgenticAppRoute(
            notificationUserInfo: AgenticAppRoute.routeURLUserInfo(route),
            telemetrySource: "notification_center"
        ))

        #expect(parsed.destination == .officeHoursQuestion(sessionId: "session-7", requestId: "req-7"))
        #expect(parsed.telemetrySource == "notification_center")
    }

    @Test func rejectsNotionOAuthCallbackRoute() {
        #expect(AgenticDeepLink(url: URL(string: "agentic30://oauth/callback?code=abc")!) == nil)
    }

    @Test func rejectsUnknownSchemesAndRoutes() {
        #expect(AgenticDeepLink(url: URL(string: "https://agentic30.app/settings/integrations")!) == nil)
        #expect(AgenticDeepLink(url: URL(string: "agentic30://unknown")!) == nil)
    }
}
