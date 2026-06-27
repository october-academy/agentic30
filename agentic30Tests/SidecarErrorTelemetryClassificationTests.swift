import XCTest
@testable import agentic30

@MainActor
final class SidecarErrorTelemetryClassificationTests: XCTestCase {
    private let decoder = JSONDecoder()

    func testOfficeHoursNoNextQuestionIsCapturedNotException() {
        XCTAssertEqual(
            AgenticViewModel.nonExceptionSidecarErrorTelemetryEvent(
                forErrorKind: "office_hours_no_next_question"
            ),
            "mac_office_hours_no_next_question"
        )
        XCTAssertEqual(
            AgenticViewModel.nonExceptionSidecarErrorTelemetryEvent(
                forErrorKind: "office_hours_pending_state_unrecoverable"
            ),
            "mac_office_hours_pending_state_unrecoverable"
        )
    }

    func testKnownRecoverableKindsStayNonException() {
        XCTAssertEqual(
            AgenticViewModel.nonExceptionSidecarErrorTelemetryEvent(forErrorKind: "provider_usage_limit"),
            "mac_provider_usage_limit"
        )
        XCTAssertEqual(
            AgenticViewModel.nonExceptionSidecarErrorTelemetryEvent(forErrorKind: "provider_auth_required"),
            "mac_provider_auth_required"
        )
        XCTAssertEqual(
            AgenticViewModel.nonExceptionSidecarErrorTelemetryEvent(forErrorKind: "provider_aborted"),
            "mac_provider_aborted"
        )
        XCTAssertEqual(
            AgenticViewModel.nonExceptionSidecarErrorTelemetryEvent(forErrorKind: "sidecar_connection_state"),
            "mac_sidecar_connection_state"
        )
    }

    func testUnknownAndNilKindsRemainExceptions() {
        XCTAssertNil(AgenticViewModel.nonExceptionSidecarErrorTelemetryEvent(forErrorKind: nil))
        XCTAssertNil(AgenticViewModel.nonExceptionSidecarErrorTelemetryEvent(forErrorKind: ""))
        XCTAssertNil(AgenticViewModel.nonExceptionSidecarErrorTelemetryEvent(forErrorKind: "some_unexpected_failure"))
    }

    func testRecoverableSidecarErrorsCaptureTelemetryEventsInsteadOfExceptions() throws {
        let viewModel = AgenticViewModel(disablesSidecarStartForTesting: true)
        var captures: [PostHogTelemetryCapture] = []
        PostHogTelemetry.captureSink = { captures.append($0) }
        defer { PostHogTelemetry.resetTestingHooks() }

        let cases = [
            ("provider_usage_limit", "mac_provider_usage_limit", "claude"),
            ("provider_auth_required", "mac_provider_auth_required", "codex"),
            ("provider_aborted", "mac_provider_aborted", "claude"),
            ("office_hours_no_next_question", "mac_office_hours_no_next_question", "codex"),
            (
                "office_hours_pending_state_unrecoverable",
                "mac_office_hours_pending_state_unrecoverable",
                "codex"
            ),
        ]

        for (errorKind, expectedTelemetryEvent, provider) in cases {
            let event = try decodeSidecarErrorEvent(
                errorKind: errorKind,
                provider: provider
            )

            viewModel.applySidecarEventForTesting(event)

            let capture = try XCTUnwrap(captures.last)
            XCTAssertEqual(capture.event, expectedTelemetryEvent)
            XCTAssertFalse(capture.isException)
            XCTAssertEqual(capture.properties["operation"] as? String, "sidecar_event_error")
            XCTAssertEqual(capture.properties["error_kind"] as? String, errorKind)
            XCTAssertEqual(capture.properties["provider"] as? String, provider)
        }

        XCTAssertEqual(captures.count, cases.count)
        XCTAssertTrue(captures.allSatisfy { !$0.isException })
    }

    func testRecoverableDocCreationResultCapturesTelemetryEventInsteadOfException() throws {
        let viewModel = AgenticViewModel(disablesSidecarStartForTesting: true)
        var captures: [PostHogTelemetryCapture] = []
        PostHogTelemetry.captureSink = { captures.append($0) }
        defer { PostHogTelemetry.resetTestingHooks() }

        let payload = """
        {
          "type": "doc_creation_result",
          "docType": "icp",
          "provider": "claude",
          "error": "Claude Code process aborted by user",
          "errorKind": "provider_aborted",
          "recoverable": true
        }
        """
        let event = try decoder.decode(SidecarEvent.self, from: Data(payload.utf8))

        viewModel.applySidecarEventForTesting(event)

        let capture = try XCTUnwrap(captures.last)
        XCTAssertEqual(capture.event, "mac_provider_aborted")
        XCTAssertFalse(capture.isException)
        XCTAssertEqual(capture.properties["operation"] as? String, "document_creation")
        XCTAssertEqual(capture.properties["doc_type"] as? String, "icp")
        XCTAssertEqual(capture.properties["error_kind"] as? String, "provider_aborted")
        XCTAssertEqual(capture.properties["provider"] as? String, "claude")
        XCTAssertTrue(captures.allSatisfy { !$0.isException })
    }

    func testUnknownSidecarErrorStillCapturesException() throws {
        let viewModel = AgenticViewModel(disablesSidecarStartForTesting: true)
        var captures: [PostHogTelemetryCapture] = []
        PostHogTelemetry.captureSink = { captures.append($0) }
        defer { PostHogTelemetry.resetTestingHooks() }

        let event = try decodeSidecarErrorEvent(
            errorKind: "unexpected_sidecar_failure",
            provider: "claude"
        )

        viewModel.applySidecarEventForTesting(event)

        let capture = try XCTUnwrap(captures.last)
        XCTAssertEqual(capture.event, "$exception")
        XCTAssertTrue(capture.isException)
        XCTAssertEqual(capture.properties["operation"] as? String, "sidecar_event_error")
    }

    private func decodeSidecarErrorEvent(
        errorKind: String,
        provider: String
    ) throws -> SidecarEvent {
        let payload = """
        {
          "type": "error",
          "message": "recoverable sidecar error",
          "sessionId": "session-\(errorKind)",
          "errorKind": "\(errorKind)",
          "provider": "\(provider)",
          "recoverable": true
        }
        """

        return try decoder.decode(SidecarEvent.self, from: Data(payload.utf8))
    }
}
