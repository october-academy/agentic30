import Foundation

struct AgenticAppRoute: nonisolated Equatable {
    enum Destination: nonisolated Equatable {
        case settings(section: SettingsSection?)
        case officeHoursQuestion(sessionId: String, requestId: String?)
        case openDesign(route: LongRunningCompletionRoute, day: Int?, anchor: String?, placement: Placement)
        case document(path: String)
    }

    enum Placement: String, nonisolated Equatable {
        case section
        case action

        init(queryValue: String?) {
            switch queryValue?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() {
            case "action", "next", "next-action", "next_action":
                self = .action
            default:
                self = .section
            }
        }
    }

    static let routeURLUserInfoKey = "agentic30.route.url"

    let destination: Destination
    let telemetrySource: String

    init(destination: Destination, telemetrySource: String = "app_route") {
        self.destination = destination
        self.telemetrySource = telemetrySource
    }

    init?(url: URL, telemetrySource: String? = nil) {
        guard url.scheme?.lowercased() == Self.scheme else { return nil }

        let components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        let queryItems = components?.queryItems ?? []
        let segments = Self.routeSegments(from: url)
        guard let first = segments.first else { return nil }

        switch first.lowercased() {
        case "settings":
            let section = Self.settingsSection(
                from: Self.queryValue(named: "section", in: queryItems)
                    ?? segments.dropFirst().first
            )
            self.destination = .settings(section: section)
            self.telemetrySource = telemetrySource ?? "deep_link_settings"

        case "integrations", "integration":
            self.destination = .settings(section: .integrations)
            self.telemetrySource = telemetrySource ?? "deep_link_integrations"

        case "mcp-oauth", "mcp_oauth":
            guard Self.isMcpOauthCompletionPath(Array(segments.dropFirst())) else { return nil }
            self.destination = .settings(section: .integrations)
            self.telemetrySource = telemetrySource ?? "mcp_oauth_deep_link"

        case "office-hours", "office_hours":
            guard Self.isOfficeHoursQuestionPath(Array(segments.dropFirst())),
                  let sessionId = Self.queryValue(named: "sessionId", in: queryItems)
                    ?? Self.queryValue(named: "session_id", in: queryItems) else {
                return nil
            }
            let requestId = Self.queryValue(named: "requestId", in: queryItems)
                ?? Self.queryValue(named: "request_id", in: queryItems)
            self.destination = .officeHoursQuestion(sessionId: sessionId, requestId: requestId)
            self.telemetrySource = telemetrySource ?? "office_hours_deep_link"

        case "open-design", "open_design":
            guard let rawRoute = segments.dropFirst().first,
                  let route = Self.longRunningCompletionRoute(from: rawRoute) else {
                return nil
            }
            let day = Self.queryValue(named: "day", in: queryItems).flatMap(Int.init)
            let anchor = Self.queryValue(named: "anchor", in: queryItems)
            let placement = Placement(queryValue: Self.queryValue(named: "placement", in: queryItems))
            self.destination = .openDesign(route: route, day: day, anchor: anchor, placement: placement)
            self.telemetrySource = telemetrySource ?? "open_design_deep_link"

        case "document":
            guard let path = Self.queryValue(named: "path", in: queryItems) else { return nil }
            self.destination = .document(path: path)
            self.telemetrySource = telemetrySource ?? "document_deep_link"

        default:
            return nil
        }
    }

    init?(notificationUserInfo userInfo: [AnyHashable: Any], telemetrySource: String = "notification_route") {
        guard let rawURL = (userInfo[Self.routeURLUserInfoKey] as? String)?
            .trimmingCharacters(in: .whitespacesAndNewlines),
              !rawURL.isEmpty,
              let url = URL(string: rawURL),
              let route = AgenticAppRoute(url: url, telemetrySource: telemetrySource) else {
            return nil
        }
        self = route
    }

    var url: URL? {
        var components = URLComponents()
        components.scheme = Self.scheme

        switch destination {
        case .settings(let section):
            components.host = "settings"
            if let section {
                components.path = "/\(section.rawValue)"
            }

        case .officeHoursQuestion(let sessionId, let requestId):
            components.host = "office-hours"
            components.path = "/question"
            components.queryItems = [
                URLQueryItem(name: "sessionId", value: sessionId),
                URLQueryItem(name: "requestId", value: requestId),
            ].filter { $0.value != nil }

        case .openDesign(let route, let day, let anchor, let placement):
            components.host = "open-design"
            components.path = "/\(route.rawValue)"
            components.queryItems = [
                day.map { URLQueryItem(name: "day", value: String($0)) },
                anchor.map { URLQueryItem(name: "anchor", value: $0) },
                URLQueryItem(name: "placement", value: placement.rawValue),
            ].compactMap { $0 }

        case .document(let path):
            components.host = "document"
            components.queryItems = [URLQueryItem(name: "path", value: path)]
        }

        return components.url
    }

    var userInfoValue: String? {
        url?.absoluteString
    }

    var telemetryDestination: String {
        switch destination {
        case .settings(let section):
            return "settings.\(section?.rawValue ?? "default")"
        case .officeHoursQuestion:
            return "office_hours.question"
        case .openDesign(let route, _, let anchor, _):
            return anchor.map { "open_design.\(route.rawValue).\($0)" } ?? "open_design.\(route.rawValue)"
        case .document:
            return "document"
        }
    }

    static func routeURLUserInfo(_ route: AgenticAppRoute?) -> [AnyHashable: Any] {
        guard let routeURL = route?.userInfoValue else { return [:] }
        return [routeURLUserInfoKey: routeURL]
    }

    static func openDesignRoute(
        _ route: LongRunningCompletionRoute,
        day: Int? = nil,
        anchor: String? = nil,
        placement: Placement = .section,
        telemetrySource: String = "app_route"
    ) -> AgenticAppRoute {
        AgenticAppRoute(
            destination: .openDesign(route: route, day: day, anchor: anchor, placement: placement),
            telemetrySource: telemetrySource
        )
    }

    static func defaultRoute(for notification: LongRunningCompletionNotification) -> AgenticAppRoute {
        if notification.route == .document, let docPath = notification.docPath {
            return AgenticAppRoute(destination: .document(path: docPath), telemetrySource: "long_running_notification")
        }

        return openDesignRoute(
            notification.route,
            day: notification.kind.defaultRouteDay,
            anchor: notification.kind.defaultRouteAnchor,
            telemetrySource: "long_running_notification"
        )
    }

    private static let scheme = "agentic30"

    private static func routeSegments(from url: URL) -> [String] {
        var rawSegments: [String] = []
        if let host = url.host(percentEncoded: false), !host.isEmpty {
            rawSegments.append(host)
        }
        rawSegments.append(contentsOf: url.pathComponents.filter { $0 != "/" })
        return rawSegments.compactMap { segment in
            Self.nonEmpty(
                segment
                    .trimmingCharacters(in: CharacterSet(charactersIn: "/").union(.whitespacesAndNewlines))
            )
        }
    }

    private static func queryValue(named name: String, in queryItems: [URLQueryItem]) -> String? {
        guard let value = queryItems.first(where: { $0.name.lowercased() == name.lowercased() })?
            .value?
            .trimmingCharacters(in: .whitespacesAndNewlines) else {
            return nil
        }
        return nonEmpty(value)
    }

    private static func settingsSection(from rawValue: String?) -> SettingsSection? {
        guard let rawValue,
              let value = nonEmpty(rawValue.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()) else {
            return nil
        }
        switch value {
        case "integration", "integrations", "mcp", "mcp-oauth", "mcp_oauth":
            return .integrations
        default:
            return SettingsSection.fromIdentifier(value)
        }
    }

    private static func longRunningCompletionRoute(from rawValue: String) -> LongRunningCompletionRoute? {
        if let route = LongRunningCompletionRoute(rawValue: rawValue) {
            return route
        }
        let normalized = rawValue.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return [
            LongRunningCompletionRoute.morningBriefing,
            .day1,
            .document,
            .history,
            .bipResearch,
            .newsMarketRadar,
            .strategy,
            .bipMission,
        ].first { $0.rawValue.lowercased() == normalized }
    }

    private static func isMcpOauthCompletionPath(_ path: [String]) -> Bool {
        guard let first = path.first else { return true }
        return ["connected", "complete", "completed", "success", "callback"].contains(first)
    }

    private static func isOfficeHoursQuestionPath(_ path: [String]) -> Bool {
        guard let first = path.first else { return true }
        return ["question", "questions", "prompt", "ready"].contains(first)
    }

    private static func nonEmpty(_ value: String) -> String? {
        value.isEmpty ? nil : value
    }
}

typealias AgenticDeepLink = AgenticAppRoute
