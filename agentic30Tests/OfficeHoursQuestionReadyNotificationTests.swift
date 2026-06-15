import Testing
import Foundation
@testable import agentic30

// MARK: - Question-ready notification gate tests

struct OfficeHoursQuestionReadyNotifierTests {

    private func shouldNotify(
        stage: String = "question_ready",
        requestId: String? = "req-1",
        title: String? = "다음 질문 준비 완료",
        alreadyNotified: Set<String> = [],
        isAppActive: Bool = false,
        isEnabled: Bool = true,
        isUITesting: Bool = false
    ) -> Bool {
        OfficeHoursQuestionReadyNotifier.shouldNotify(
            stage: stage,
            requestId: requestId,
            title: title,
            alreadyNotifiedRequestIds: alreadyNotified,
            isAppActive: isAppActive,
            isEnabled: isEnabled,
            isUITesting: isUITesting
        )
    }

    @Test func notifiesWhenQuestionReadyArrivesInBackground() {
        #expect(shouldNotify())
    }

    @Test func ignoresNonQuestionReadyStages() {
        #expect(!shouldNotify(stage: "provider_thinking"))
        #expect(!shouldNotify(stage: "structured_input_requested"))
        #expect(!shouldNotify(stage: "completed"))
        #expect(!shouldNotify(stage: "failed"))
    }

    @Test func requiresRequestIdAndSidecarTitle() {
        // No fallback copy: a question_ready without the sidecar-provided
        // title (or requestId) never becomes a notification.
        #expect(!shouldNotify(requestId: nil))
        #expect(!shouldNotify(requestId: ""))
        #expect(!shouldNotify(title: nil))
        #expect(!shouldNotify(title: ""))
    }

    @Test func skipsAlreadyNotifiedRequestIds() {
        #expect(!shouldNotify(alreadyNotified: ["req-1"]))
        #expect(shouldNotify(alreadyNotified: ["req-0", "req-2"]))
    }

    @Test func staysSilentWhileAppIsActive() {
        #expect(!shouldNotify(isAppActive: true))
    }

    @Test func respectsSettingsToggle() {
        #expect(!shouldNotify(isEnabled: false))
    }

    @Test func staysSilentUnderUITesting() {
        #expect(!shouldNotify(isUITesting: true))
    }
}

// MARK: - MCP connection notification gate tests

struct McpOauthConnectedNotifierTests {

    private func shouldNotify(
        server: String? = "posthog",
        state: String? = "ready",
        isUITesting: Bool = false
    ) -> Bool {
        McpOauthConnectedNotifier.shouldNotify(
            server: server,
            state: state,
            isUITesting: isUITesting
        )
    }

    @Test func notifiesForReadyPostHogAndCloudflareConnections() {
        #expect(shouldNotify(server: "posthog"))
        #expect(shouldNotify(server: "cloudflare"))
        #expect(shouldNotify(server: " PostHog "))
    }

    @Test func ignoresNonReadyStatesAndUnsupportedServers() {
        #expect(!shouldNotify(server: "posthog", state: "progress"))
        #expect(!shouldNotify(server: "cloudflare", state: "login_pending"))
        #expect(!shouldNotify(server: "vercel", state: "ready"))
        #expect(!shouldNotify(server: nil, state: "ready"))
    }

    @Test func staysSilentUnderUITesting() {
        #expect(!shouldNotify(server: "posthog", isUITesting: true))
    }
}

// MARK: - Long-running completion notification gate tests

struct LongRunningCompletionNotifierTests {

    private func shouldNotify(
        attemptId: String? = "attempt-1",
        alreadyNotified: Set<String> = [],
        isUserVisibleAttempt: Bool = true,
        elapsed: TimeInterval = 20,
        isAppActive: Bool = true,
        isEnabled: Bool = true,
        isUITesting: Bool = false
    ) -> Bool {
        LongRunningCompletionNotifier.shouldNotify(
            attemptId: attemptId,
            alreadyNotifiedAttemptIds: alreadyNotified,
            isUserVisibleAttempt: isUserVisibleAttempt,
            elapsed: elapsed,
            isAppActive: isAppActive,
            isEnabled: isEnabled,
            isUITesting: isUITesting
        )
    }

    @Test func notifiesForVisibleLongRunningActiveAttempt() {
        #expect(shouldNotify(elapsed: 15, isAppActive: true))
    }

    @Test func notifiesForVisibleBackgroundAttemptEvenWhenShort() {
        #expect(shouldNotify(elapsed: 1, isAppActive: false))
    }

    @Test func skipsShortActiveCompletions() {
        #expect(!shouldNotify(elapsed: 14.9, isAppActive: true))
    }

    @Test func skipsDuplicateBackgroundDisabledAndUITestingAttempts() {
        #expect(!shouldNotify(alreadyNotified: ["attempt-1"]))
        #expect(!shouldNotify(isUserVisibleAttempt: false))
        #expect(!shouldNotify(isEnabled: false))
        #expect(!shouldNotify(isUITesting: true))
    }

    @Test func requiresNonBlankAttemptId() {
        #expect(!shouldNotify(attemptId: nil))
        #expect(!shouldNotify(attemptId: " "))
    }
}

// MARK: - Notification payload routing tests

struct OfficeHoursQuestionReadyNotificationTests {

    @Test func parsesSessionIdFromUserInfo() {
        let parsed = OfficeHoursQuestionReadyNotification(
            notificationUserInfo: [
                OfficeHoursQuestionReadyNotification.sessionIdUserInfoKey: "session-7",
            ],
            identifier: OfficeHoursQuestionReadyNotification.notificationIdentifier(requestId: "req-7")
        )

        #expect(parsed?.sessionId == "session-7")
        #expect(parsed?.requestId == "req-7")
    }

    @Test func userInfoIncludesCommonRouteAndLegacyKeys() throws {
        let notification = OfficeHoursQuestionReadyNotification(
            sessionId: "session-7",
            requestId: "req-7"
        )

        #expect(notification.userInfo[OfficeHoursQuestionReadyNotification.sessionIdUserInfoKey] as? String == "session-7")
        #expect(notification.userInfo[OfficeHoursQuestionReadyNotification.requestIdUserInfoKey] as? String == "req-7")

        let route = try #require(AgenticAppRoute(notificationUserInfo: notification.userInfo))
        #expect(route.destination == .officeHoursQuestion(sessionId: "session-7", requestId: "req-7"))
    }

    @Test func rejectsForeignIdentifiers() {
        let parsed = OfficeHoursQuestionReadyNotification(
            notificationUserInfo: [
                OfficeHoursQuestionReadyNotification.sessionIdUserInfoKey: "session-7",
            ],
            identifier: "agentic30.other"
        )

        #expect(parsed == nil)
    }

    @Test func rejectsMissingOrBlankSessionId() {
        let identifier = OfficeHoursQuestionReadyNotification.notificationIdentifier(requestId: "req-7")

        #expect(OfficeHoursQuestionReadyNotification(
            notificationUserInfo: [:],
            identifier: identifier
        ) == nil)
        #expect(OfficeHoursQuestionReadyNotification(
            notificationUserInfo: [
                OfficeHoursQuestionReadyNotification.sessionIdUserInfoKey: "  ",
            ],
            identifier: identifier
        ) == nil)
    }

}

struct McpOauthConnectedNotificationTests {

    @Test func parsesServerFromUserInfo() {
        let parsed = McpOauthConnectedNotification(
            notificationUserInfo: [
                McpOauthConnectedNotification.serverUserInfoKey: "posthog",
            ],
            identifier: McpOauthConnectedNotification.notificationIdentifier(server: "posthog")
        )

        #expect(parsed?.server == "posthog")
        #expect(parsed?.notificationTitle == "PostHog MCP 연결 완료")
        #expect(parsed?.notificationBody == "AI 실행에서 바로 사용할 수 있어요.")
    }

    @Test func userInfoIncludesCommonSettingsRouteAndLegacyServer() throws {
        let notification = try #require(McpOauthConnectedNotification(server: "posthog"))

        #expect(notification.userInfo[McpOauthConnectedNotification.serverUserInfoKey] as? String == "posthog")

        let route = try #require(AgenticAppRoute(notificationUserInfo: notification.userInfo))
        #expect(route.destination == .settings(section: .integrations))
    }

    @Test func parsesServerFromIdentifierFallback() {
        let parsed = McpOauthConnectedNotification(
            notificationUserInfo: [:],
            identifier: McpOauthConnectedNotification.notificationIdentifier(server: "cloudflare")
        )

        #expect(parsed?.server == "cloudflare")
        #expect(parsed?.notificationTitle == "Cloudflare MCP 연결 완료")
    }

    @Test func rejectsForeignOrUnsupportedIdentifiers() {
        #expect(McpOauthConnectedNotification(
            notificationUserInfo: [
                McpOauthConnectedNotification.serverUserInfoKey: "posthog",
            ],
            identifier: OfficeHoursQuestionReadyNotification.notificationIdentifier(requestId: "req-7")
        ) == nil)

        #expect(McpOauthConnectedNotification(
            notificationUserInfo: [
                McpOauthConnectedNotification.serverUserInfoKey: "vercel",
            ],
            identifier: "\(McpOauthConnectedNotification.identifierPrefix)vercel"
        ) == nil)
    }

    @Test func otherNotificationParsersIgnoreMcpConnectionNotifications() {
        let identifier = McpOauthConnectedNotification.notificationIdentifier(server: "posthog")
        let userInfo = [
            McpOauthConnectedNotification.serverUserInfoKey: "posthog",
        ]

        #expect(OfficeHoursQuestionReadyNotification(notificationUserInfo: userInfo, identifier: identifier) == nil)
    }
}

struct LongRunningCompletionNotificationTests {

    @Test func parsesEveryCompletionKindAndRouteFromUserInfo() {
        let expectedRoutes: [LongRunningCompletionNotificationKind: LongRunningCompletionRoute] = [
            .morningBriefing: .morningBriefing,
            .workspaceScan: .day1,
            .documentCreation: .document,
            .workHistory: .history,
            .bipResearch: .bipResearch,
            .newsMarketRadar: .newsMarketRadar,
            .strategyReport: .strategy,
            .bipMission: .bipMission,
        ]

        for kind in LongRunningCompletionNotificationKind.allCases {
            let notification = LongRunningCompletionNotification(
                kind: kind,
                outcome: .success,
                docPath: kind == .documentCreation ? "/tmp/ICP.md" : nil,
                detail: "완료"
            )
            let parsed = LongRunningCompletionNotification(
                notificationUserInfo: notification.userInfo,
                identifier: notification.notificationIdentifier
            )

            #expect(parsed?.kind == kind)
            #expect(parsed?.outcome == .success)
            #expect(parsed?.route == expectedRoutes[kind])
            #expect(parsed?.notificationTitle.isEmpty == false)
            #expect(parsed?.notificationBody == "완료")
        }
    }

    @Test func userInfoIncludesCommonOpenDesignRouteAndLegacyKeys() throws {
        let notification = LongRunningCompletionNotification(kind: .morningBriefing, outcome: .success)

        #expect(notification.userInfo[LongRunningCompletionNotification.kindUserInfoKey] as? String == "morningBriefing")
        #expect(notification.userInfo[LongRunningCompletionNotification.routeUserInfoKey] as? String == "morningBriefing")

        let route = try #require(AgenticAppRoute(notificationUserInfo: notification.userInfo))
        #expect(route.destination == .openDesign(route: .morningBriefing, day: nil, anchor: "summary", placement: .section))
    }

    @Test func parsesKindAndOutcomeFromIdentifierFallback() {
        let identifier = LongRunningCompletionNotification.notificationIdentifier(
            kind: .workspaceScan,
            outcome: .blocked
        )
        let parsed = LongRunningCompletionNotification(
            notificationUserInfo: [:],
            identifier: identifier
        )

        #expect(parsed?.kind == .workspaceScan)
        #expect(parsed?.outcome == .blocked)
        #expect(parsed?.route == .day1)
        #expect(parsed?.notificationTitle == "워크스페이스 분석 확인 필요")
    }

    @Test func documentNotificationIncludesDocPathAndFileNameBody() throws {
        let notification = LongRunningCompletionNotification(
            kind: .documentCreation,
            outcome: .success,
            docPath: "/Users/october/project/ICP.md"
        )
        let parsed = LongRunningCompletionNotification(
            notificationUserInfo: notification.userInfo,
            identifier: notification.notificationIdentifier
        )

        #expect(parsed?.docPath == "/Users/october/project/ICP.md")
        #expect(parsed?.notificationTitle == "문서 생성 완료")
        #expect(parsed?.notificationBody == "ICP.md을 만들었어요.")

        let route = try #require(AgenticAppRoute(notificationUserInfo: notification.userInfo))
        #expect(route.destination == .document(path: "/Users/october/project/ICP.md"))
    }

    @Test func rejectsForeignIdentifiersAndBadPayloads() {
        #expect(LongRunningCompletionNotification(
            notificationUserInfo: [
                LongRunningCompletionNotification.kindUserInfoKey: "workHistory",
                LongRunningCompletionNotification.outcomeUserInfoKey: "success",
            ],
            identifier: OfficeHoursQuestionReadyNotification.notificationIdentifier(requestId: "req-7")
        ) == nil)

        #expect(LongRunningCompletionNotification(
            notificationUserInfo: [
                LongRunningCompletionNotification.kindUserInfoKey: "unknown",
                LongRunningCompletionNotification.outcomeUserInfoKey: "success",
            ],
            identifier: "\(LongRunningCompletionNotification.identifierPrefix)unknown.success"
        ) == nil)
    }

    @Test func otherNotificationParsersIgnoreLongRunningCompletionNotifications() {
        let notification = LongRunningCompletionNotification(kind: .workHistory, outcome: .success)

        #expect(OfficeHoursQuestionReadyNotification(
            notificationUserInfo: notification.userInfo,
            identifier: notification.notificationIdentifier
        ) == nil)
        #expect(McpOauthConnectedNotification(
            notificationUserInfo: notification.userInfo,
            identifier: notification.notificationIdentifier
        ) == nil)
    }

    @MainActor
    @Test func settingsDefaultForLongRunningCompletionNotificationsIsOn() {
        let defaults = UserDefaults.standard
        let key = AgenticViewModel.longRunningCompletionNotificationDefaultsKey
        let previous = defaults.object(forKey: key)
        defaults.removeObject(forKey: key)
        defer {
            if let previous {
                defaults.set(previous, forKey: key)
            } else {
                defaults.removeObject(forKey: key)
            }
        }

        let viewModel = AgenticViewModel(disablesSidecarStartForTesting: true)
        #expect(viewModel.isLongRunningCompletionNotificationEnabled)
    }
}
