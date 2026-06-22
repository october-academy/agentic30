import XCTest
@testable import agentic30

@MainActor
final class SidecarErrorTelemetryClassificationTests: XCTestCase {

    func testOfficeHoursNoNextQuestionIsCapturedNotException() {
        XCTAssertEqual(
            AgenticViewModel.nonExceptionSidecarErrorTelemetryEvent(
                forErrorKind: "office_hours_no_next_question"
            ),
            "mac_office_hours_no_next_question"
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
}
