import XCTest
@testable import agentic30

/// Regression coverage for the host-side `workspace_setup_completed` gate.
///
/// Activation read 0 completed events in production not because users never
/// finished setup, but because the host gate's scan-success signal
/// (`markWorkspaceSetupScanSucceeded()`) was defined yet never wired into the
/// `workspace_scan_result` handler. `didScanSucceed` therefore stayed false
/// forever and every completed envelope the sidecar emitted was held in
/// `pendingCompleted` and silently dropped.
///
/// Two layers are pinned here:
///   1. `gateLogic*` — the AND-gate flush semantics in isolation.
///   2. `successfulScanResult*` — the wiring: a successful scan result MUST
///      drive the scan-success signal so a held completed envelope flushes.
///      This is the test that would have caught the orphaned-call bug.
@MainActor
final class WorkspaceSetupTelemetryGateTests: XCTestCase {

    // MARK: - Gate logic

    func testGateLogicHoldsCompletedUntilScanSuccessAndFirstInput() throws {
        var gate = WorkspaceSetupTelemetryGate()
        let completed = try SidecarRequestEmit(
            event: .workspaceSetupCompleted,
            properties: ["workspace_basename": .string("ws")]
        )

        // Completed arriving before both signals is held, never captured.
        XCTAssertTrue(gate.requestsToCapture(afterReceiving: completed).isEmpty)
        // First input alone is insufficient — scan success is still missing.
        XCTAssertTrue(gate.requestsToCaptureAfterFirstRealInput().isEmpty)
        // Scan success closes the AND-gate → the held completed flushes once.
        XCTAssertEqual(gate.requestsToCaptureAfterWorkspaceScanSuccess().count, 1)
        // Idempotent: it never emits a second completed.
        XCTAssertTrue(gate.requestsToCaptureAfterWorkspaceScanSuccess().isEmpty)
        XCTAssertTrue(gate.requestsToCapture(afterReceiving: completed).isEmpty)
    }

    func testGateLogicCapturesCompletedImmediatelyWhenSignalsAlreadyMet() throws {
        var gate = WorkspaceSetupTelemetryGate()
        // Both prerequisites observed before the envelope arrives.
        XCTAssertTrue(gate.requestsToCaptureAfterWorkspaceScanSuccess().isEmpty)
        XCTAssertTrue(gate.requestsToCaptureAfterFirstRealInput().isEmpty)

        let completed = try SidecarRequestEmit(
            event: .workspaceSetupCompleted,
            properties: ["workspace_basename": .string("ws")]
        )
        XCTAssertEqual(gate.requestsToCapture(afterReceiving: completed).count, 1)
    }

    // MARK: - Wiring regression

    func testSuccessfulScanResultFlushesPendingCompletedTelemetry() throws {
        let appSupport = FileManager.default.temporaryDirectory
            .appendingPathComponent("agentic30-gate-\(UUID().uuidString)", isDirectory: true)
        let previousAppSupportPath = ProcessInfo.processInfo.environment["AGENTIC30_APP_SUPPORT_PATH"]
        setenv("AGENTIC30_APP_SUPPORT_PATH", appSupport.path, 1)
        KeychainHelper.deleteSettings()
        AgenticViewModel.workspaceScanResultAppSupportURLOverrideForTesting = appSupport

        var captured: [String] = []
        PostHogTelemetry.captureSink = { captured.append($0.event) }

        defer {
            PostHogTelemetry.resetTestingHooks()
            AgenticViewModel.workspaceScanResultAppSupportURLOverrideForTesting = nil
            KeychainHelper.deleteSettings()
            if let previousAppSupportPath {
                setenv("AGENTIC30_APP_SUPPORT_PATH", previousAppSupportPath, 1)
            } else {
                unsetenv("AGENTIC30_APP_SUPPORT_PATH")
            }
            try? FileManager.default.removeItem(at: appSupport)
        }

        let scanRoot = appSupport.appendingPathComponent("workspace", isDirectory: true).path
        let viewModel = AgenticViewModel(activateAppForAuth: {})

        // 1) First real input (no session → queued) flips didReceiveFirstRealInput.
        viewModel.draft = "첫 구조화 입력"
        viewModel.sendPrompt()

        // 2) The sidecar's completed envelope can arrive before the scan-success
        //    signal (the gate is order-independent by design). With scan success
        //    not yet observed it must be held, never captured.
        let completedEvent = try Self.decodeEvent(#"""
        {
          "type": "request_emit",
          "event": "workspace_setup_completed",
          "event_schema_version": 1,
          "properties": {
            "workspace_basename": "workspace",
            "found_count": 3,
            "elapsed_ms": 1200,
            "input_source": "structured_input"
          }
        }
        """#)
        viewModel.applySidecarEventForTesting(completedEvent)
        XCTAssertFalse(
            captured.contains("workspace_setup_completed"),
            "completed must stay held until a successful scan flips the gate"
        )

        // 3) A successful workspace_scan_result MUST wire the scan-success signal,
        //    flushing the held completed envelope to PostHog. Without the wiring
        //    fix this assertion fails — exactly the production bug.
        let scanResultEvent = try Self.decodeEvent(#"""
        {
          "type": "workspace_scan_result",
          "scanRoot": "\#(scanRoot)",
          "icp": ".agentic30/docs/ICP.md"
        }
        """#)
        viewModel.applySidecarEventForTesting(scanResultEvent)

        XCTAssertTrue(
            captured.contains("workspace_setup_completed"),
            "a successful workspace scan must flush workspace_setup_completed (wiring regression)"
        )
    }

    private static func decodeEvent(_ json: String) throws -> SidecarEvent {
        try JSONDecoder().decode(SidecarEvent.self, from: Data(json.utf8))
    }
}
