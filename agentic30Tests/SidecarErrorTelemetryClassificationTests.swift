import XCTest
@testable import agentic30

/// Pins which sidecar `error` events are captured as plain telemetry vs routed
/// through `captureException` as crash-style reports.
///
/// An office-hours interview that ends with no question card on deck
/// (`answered = 0` of an expected N) is an expected, recoverable provider-miss:
/// the user keeps the failure block + retry path. Before this fix the sidecar
/// broadcast carried no `errorKind`, so the host's `case "error"` handler fell
/// into the `else` branch and reported it via `captureException` — polluting
/// error tracking with what is not an app exception. The sidecar now tags it
/// `office_hours_incomplete_interview`; this test locks that the host classifies
/// that kind as a non-exception event.
@MainActor
final class SidecarErrorTelemetryClassificationTests: XCTestCase {

    func testIncompleteInterviewIsCapturedNotException() {
        XCTAssertEqual(
            AgenticViewModel.nonExceptionSidecarErrorTelemetryEvent(
                forErrorKind: "office_hours_incomplete_interview"
            ),
            "mac_office_hours_incomplete_interview"
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
        // nil errorKind (the common generic sidecar error) and any unrecognized
        // kind still route through captureException.
        XCTAssertNil(AgenticViewModel.nonExceptionSidecarErrorTelemetryEvent(forErrorKind: nil))
        XCTAssertNil(AgenticViewModel.nonExceptionSidecarErrorTelemetryEvent(forErrorKind: ""))
        XCTAssertNil(AgenticViewModel.nonExceptionSidecarErrorTelemetryEvent(forErrorKind: "some_unexpected_failure"))
    }
}
