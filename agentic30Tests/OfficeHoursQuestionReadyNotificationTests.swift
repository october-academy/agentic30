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
    }

    @Test func rejectsForeignIdentifiers() {
        let parsed = OfficeHoursQuestionReadyNotification(
            notificationUserInfo: [
                OfficeHoursQuestionReadyNotification.sessionIdUserInfoKey: "session-7",
            ],
            identifier: BipNotificationIntent.morningIdentifier
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

    @Test func bipIntentParserIgnoresQuestionReadyNotifications() {
        // didReceive routing order: the BIP parser must not capture
        // question-ready notifications, and vice versa.
        let intent = BipNotificationIntent(
            notificationUserInfo: [
                OfficeHoursQuestionReadyNotification.sessionIdUserInfoKey: "session-7",
            ],
            identifier: OfficeHoursQuestionReadyNotification.notificationIdentifier(requestId: "req-7")
        )

        #expect(intent == nil)
    }
}
