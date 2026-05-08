import XCTest
import Combine
@testable import agentic30

@MainActor
final class WolfStateMachineTests: XCTestCase {

    /// In-memory scheduler that lets tests trigger pending work items
    /// deterministically rather than waiting on the real run loop.
    final class TestWolfScheduler {
        var pending: [(TimeInterval, DispatchWorkItem)] = []

        func scheduler() -> WolfScheduler {
            WolfScheduler { [weak self] delay, work in
                self?.pending.append((delay, work))
            }
        }

        /// Run every work item whose deadline has elapsed, in order.
        func advance(by seconds: TimeInterval) {
            // Snapshot then mutate so newly-scheduled items end up in the
            // next pass (matches DispatchQueue semantics).
            let due = pending.filter { $0.0 <= seconds }
            pending = pending.filter { $0.0 > seconds }
                .map { ($0.0 - seconds, $0.1) }
            for (_, work) in due {
                work.perform()
            }
        }

        /// Fire whatever's pending regardless of delay.
        func drain() {
            let snapshot = pending
            pending.removeAll()
            for (_, work) in snapshot {
                work.perform()
            }
        }
    }

    private func makeSession(
        id: String = "s1",
        status: SessionStatus = .running,
        provider: AgentProvider = .claude
    ) -> ChatSession {
        ChatSession(
            id: id,
            title: id,
            provider: provider,
            model: "test-model",
            status: status,
            createdAt: Date(),
            updatedAt: Date(),
            error: nil,
            messages: [],
            pendingUserInput: nil,
            runtime: nil
        )
    }

    private func makeToolEvent(
        phase: String,
        toolName: String,
        sessionID: String = "s1"
    ) -> SidecarEvent {
        SidecarEvent.testStub(
            type: "tool_event",
            sessionId: sessionID,
            phase: phase,
            toolName: toolName
        )
    }

    func test_toolEventBashUse_setsTyping() {
        let scheduler = TestWolfScheduler()
        let machine = WolfStateMachine(now: { Date() }, scheduler: scheduler.scheduler())
        machine.ingest(
            makeToolEvent(phase: "use", toolName: "Bash"),
            sessions: [makeSession()]
        )
        XCTAssertEqual(machine.state, .typing)
    }

    func test_twoConcurrentTaskUses_setsConducting_thenJuggling_thenIdle() {
        let scheduler = TestWolfScheduler()
        let machine = WolfStateMachine(now: { Date() }, scheduler: scheduler.scheduler())
        let running = [makeSession(id: "s1"), makeSession(id: "s2")]

        machine.ingest(makeToolEvent(phase: "use", toolName: "Task", sessionID: "s1"), sessions: running)
        machine.ingest(makeToolEvent(phase: "use", toolName: "Task", sessionID: "s2"), sessions: running)
        XCTAssertEqual(machine.state, .conducting)

        machine.ingest(makeToolEvent(phase: "result", toolName: "Task", sessionID: "s2"), sessions: running)
        XCTAssertEqual(machine.state, .juggling)

        // Both Task subagents finished and the underlying sessions reported
        // back to idle — pet should fall back to `.idle`.
        let idleSessions = [
            makeSession(id: "s1", status: .idle),
            makeSession(id: "s2", status: .idle),
        ]
        machine.ingest(makeToolEvent(phase: "result", toolName: "Task", sessionID: "s1"), sessions: idleSessions)
        XCTAssertEqual(machine.state, .idle)
    }

    func test_petHook_preCompact_flashesSweeping() {
        let scheduler = TestWolfScheduler()
        let machine = WolfStateMachine(now: { Date() }, scheduler: scheduler.scheduler())
        machine.ingest(
            SidecarEvent.testStub(type: "pet_hook", message: "PreCompact"),
            sessions: [makeSession()]
        )
        XCTAssertEqual(machine.state, .sweeping)
    }

    func test_petHook_stop_flashesHappy_thenIdleAfterTimer() {
        let scheduler = TestWolfScheduler()
        let machine = WolfStateMachine(now: { Date() }, scheduler: scheduler.scheduler())
        let idleSessions = [makeSession(status: .idle)]
        machine.ingest(
            SidecarEvent.testStub(type: "pet_hook", message: "Stop"),
            sessions: idleSessions
        )
        XCTAssertEqual(machine.state, .happy)

        // Drain pending one-shot timers — happy should auto-revert to idle
        // because all sessions are idle.
        scheduler.drain()
        XCTAssertEqual(machine.state, .idle)
    }

    func test_petHook_worktreeCreate_flashesCarrying() {
        let scheduler = TestWolfScheduler()
        let machine = WolfStateMachine(now: { Date() }, scheduler: scheduler.scheduler())
        machine.ingest(
            SidecarEvent.testStub(type: "pet_hook", message: "WorktreeCreate"),
            sessions: [makeSession()]
        )
        XCTAssertEqual(machine.state, .carrying)
    }

    func test_sidecarErrorBroadcast_withSessionId_setsError() {
        let scheduler = TestWolfScheduler()
        let machine = WolfStateMachine(now: { Date() }, scheduler: scheduler.scheduler())
        machine.ingest(
            SidecarEvent.testStub(type: "error", sessionId: "s1"),
            sessions: [makeSession()]
        )
        XCTAssertEqual(machine.state, .error)
    }

    func test_sidecarErrorBroadcast_connectionLevel_doesNotSetError() {
        let scheduler = TestWolfScheduler()
        let machine = WolfStateMachine(now: { Date() }, scheduler: scheduler.scheduler())
        // Connection-level error has no sessionId — must not flash the pet.
        machine.ingest(
            SidecarEvent.testStub(type: "error"),
            sessions: [makeSession()]
        )
        XCTAssertNotEqual(machine.state, .error)
    }

    func test_petHook_postToolUseFailure_setsError() {
        let scheduler = TestWolfScheduler()
        let machine = WolfStateMachine(now: { Date() }, scheduler: scheduler.scheduler())
        machine.ingest(
            SidecarEvent.testStub(type: "pet_hook", message: "PostToolUseFailure"),
            sessions: [makeSession()]
        )
        XCTAssertEqual(machine.state, .error)
    }

    func test_petHook_stopFailure_setsErrorWithHoldoff() {
        let scheduler = TestWolfScheduler()
        let machine = WolfStateMachine(now: { Date() }, scheduler: scheduler.scheduler())
        machine.ingest(
            SidecarEvent.testStub(type: "pet_hook", message: "StopFailure"),
            sessions: [makeSession()]
        )
        XCTAssertEqual(machine.state, .error)

        // Lower-priority typing must not break the error holdoff.
        machine.ingest(
            makeToolEvent(phase: "use", toolName: "Bash"),
            sessions: [makeSession()]
        )
        XCTAssertEqual(machine.state, .error)
    }

    func test_awaitingInputAndRunning_promotesRunningOverNotification() {
        let scheduler = TestWolfScheduler()
        let machine = WolfStateMachine(now: { Date() }, scheduler: scheduler.scheduler())
        let mixed = [
            makeSession(id: "s1", status: .awaitingInput),
            makeSession(id: "s2", status: .running),
        ]
        // running session present → derive() should pick `.thinking`,
        // not `.notification`.
        machine.ingest(SidecarEvent.testStub(type: "session_updated", session: mixed[1]), sessions: mixed)
        XCTAssertEqual(machine.state, .thinking)

        // Now the running session also picks up tool activity → typing.
        machine.ingest(makeToolEvent(phase: "use", toolName: "Edit", sessionID: "s2"), sessions: mixed)
        XCTAssertEqual(machine.state, .typing)
    }

    func test_sessionUpdatedError_setsError_andHoldsOffLowerPriority() {
        let scheduler = TestWolfScheduler()
        let machine = WolfStateMachine(now: { Date() }, scheduler: scheduler.scheduler())

        let erroredSession = makeSession(status: .error)
        let event = SidecarEvent.testStub(type: "session_updated", session: erroredSession)
        machine.ingest(event, sessions: [erroredSession])
        XCTAssertEqual(machine.state, .error)

        // While in error holdoff, a `typing` (priority 4) request must not
        // pull state away from `error` (priority 8).
        machine.ingest(
            makeToolEvent(phase: "use", toolName: "Bash"),
            sessions: [erroredSession]
        )
        XCTAssertEqual(machine.state, .error, "error must hold against lower priority")
    }

    // MARK: - Coverage matrix lock-downs

    func test_sessionCreated_flashesAttention() {
        let scheduler = TestWolfScheduler()
        let machine = WolfStateMachine(now: { Date() }, scheduler: scheduler.scheduler())
        let session = makeSession()
        machine.ingest(
            SidecarEvent.testStub(type: "session_created", session: session),
            sessions: [session]
        )
        XCTAssertEqual(machine.state, .attention)
    }

    func test_sessionDeleted_flashesSweeping() {
        let scheduler = TestWolfScheduler()
        let machine = WolfStateMachine(now: { Date() }, scheduler: scheduler.scheduler())
        machine.ingest(
            SidecarEvent.testStub(type: "session_deleted", sessionId: "s1"),
            sessions: []
        )
        XCTAssertEqual(machine.state, .sweeping)
    }

    func test_awaitingInputOnly_setsNotification() {
        let scheduler = TestWolfScheduler()
        let machine = WolfStateMachine(now: { Date() }, scheduler: scheduler.scheduler())
        let waiting = [makeSession(id: "s1", status: .awaitingInput)]
        // No tool/running activity, only awaitingInput → notification.
        machine.ingest(
            SidecarEvent.testStub(type: "session_updated", session: waiting[0]),
            sessions: waiting
        )
        XCTAssertEqual(machine.state, .notification)
    }

    func test_threeToolingSessions_setsWorking() {
        let scheduler = TestWolfScheduler()
        let machine = WolfStateMachine(now: { Date() }, scheduler: scheduler.scheduler())
        let three = [
            makeSession(id: "s1"),
            makeSession(id: "s2"),
            makeSession(id: "s3"),
        ]
        machine.ingest(makeToolEvent(phase: "use", toolName: "Bash", sessionID: "s1"), sessions: three)
        machine.ingest(makeToolEvent(phase: "use", toolName: "Bash", sessionID: "s2"), sessions: three)
        machine.ingest(makeToolEvent(phase: "use", toolName: "Bash", sessionID: "s3"), sessions: three)
        XCTAssertEqual(machine.state, .working)
    }

    func test_toolEvent_phaseError_setsError() {
        let scheduler = TestWolfScheduler()
        let machine = WolfStateMachine(now: { Date() }, scheduler: scheduler.scheduler())
        machine.ingest(
            makeToolEvent(phase: "error", toolName: "Bash"),
            sessions: [makeSession()]
        )
        XCTAssertEqual(machine.state, .error)
    }

    func test_toolEvent_phaseThinking_setsThinking() {
        let scheduler = TestWolfScheduler()
        let machine = WolfStateMachine(now: { Date() }, scheduler: scheduler.scheduler())
        machine.ingest(
            makeToolEvent(phase: "thinking", toolName: "reasoning"),
            sessions: [makeSession()]
        )
        XCTAssertEqual(machine.state, .thinking)
    }

    func test_messageDelta_runningSession_promotesToThinking() {
        let scheduler = TestWolfScheduler()
        let machine = WolfStateMachine(now: { Date() }, scheduler: scheduler.scheduler())
        let running = [makeSession(status: .running)]
        machine.ingest(SidecarEvent.testStub(type: "message_delta", sessionId: "s1"), sessions: running)
        XCTAssertEqual(machine.state, .thinking)
    }

    func test_agentEvent_runningSession_promotesToThinking() {
        let scheduler = TestWolfScheduler()
        let machine = WolfStateMachine(now: { Date() }, scheduler: scheduler.scheduler())
        let running = [makeSession(status: .running)]
        machine.ingest(SidecarEvent.testStub(type: "agent_event", sessionId: "s1"), sessions: running)
        XCTAssertEqual(machine.state, .thinking)
    }

    func test_messageReplaced_allIdle_flashesHappy() {
        let scheduler = TestWolfScheduler()
        let machine = WolfStateMachine(now: { Date() }, scheduler: scheduler.scheduler())
        let idleSessions = [makeSession(status: .idle)]
        machine.ingest(SidecarEvent.testStub(type: "message_replaced"), sessions: idleSessions)
        XCTAssertEqual(machine.state, .happy)
    }

    func test_workspaceScanStarted_setsCarrying() {
        let scheduler = TestWolfScheduler()
        let machine = WolfStateMachine(now: { Date() }, scheduler: scheduler.scheduler())
        machine.ingest(
            SidecarEvent.testStub(type: "workspace_scan_started"),
            sessions: [makeSession()]
        )
        XCTAssertEqual(machine.state, .carrying)
    }

    func test_workspaceScanResult_flashesSweeping() {
        let scheduler = TestWolfScheduler()
        let machine = WolfStateMachine(now: { Date() }, scheduler: scheduler.scheduler())
        machine.ingest(
            SidecarEvent.testStub(type: "workspace_scan_result"),
            sessions: [makeSession()]
        )
        XCTAssertEqual(machine.state, .sweeping)
    }

    func test_docCreationStarted_setsCarrying() {
        let scheduler = TestWolfScheduler()
        let machine = WolfStateMachine(now: { Date() }, scheduler: scheduler.scheduler())
        machine.ingest(
            SidecarEvent.testStub(type: "doc_creation_started"),
            sessions: [makeSession()]
        )
        XCTAssertEqual(machine.state, .carrying)
    }

    func test_petHook_postCompact_flashesAttention() {
        let scheduler = TestWolfScheduler()
        let machine = WolfStateMachine(now: { Date() }, scheduler: scheduler.scheduler())
        machine.ingest(
            SidecarEvent.testStub(type: "pet_hook", message: "PostCompact"),
            sessions: [makeSession()]
        )
        XCTAssertEqual(machine.state, .attention)
    }

    func test_petHook_notification_flashesNotification() {
        let scheduler = TestWolfScheduler()
        let machine = WolfStateMachine(now: { Date() }, scheduler: scheduler.scheduler())
        machine.ingest(
            SidecarEvent.testStub(type: "pet_hook", message: "Notification"),
            sessions: [makeSession()]
        )
        XCTAssertEqual(machine.state, .notification)
    }

    func test_petHook_permissionRequest_flashesNotification() {
        let scheduler = TestWolfScheduler()
        let machine = WolfStateMachine(now: { Date() }, scheduler: scheduler.scheduler())
        machine.ingest(
            SidecarEvent.testStub(type: "pet_hook", message: "PermissionRequest"),
            sessions: [makeSession()]
        )
        XCTAssertEqual(machine.state, .notification)
    }

    func test_petHook_userPromptSubmit_setsThinking() {
        let scheduler = TestWolfScheduler()
        let machine = WolfStateMachine(now: { Date() }, scheduler: scheduler.scheduler())
        machine.ingest(
            SidecarEvent.testStub(type: "pet_hook", message: "UserPromptSubmit"),
            sessions: [makeSession(status: .running)]
        )
        XCTAssertEqual(machine.state, .thinking)
    }

    // MARK: - Existing coverage

    func test_idleEvents_thenSleepTimer_movesToSleeping() {
        var fakeNow = Date(timeIntervalSince1970: 1000)
        let scheduler = TestWolfScheduler()
        let machine = WolfStateMachine(now: { fakeNow }, scheduler: scheduler.scheduler())
        machine.sleepAfter = 60

        // No events. Advance the fake clock past the threshold and run the
        // pending sleep watchdog.
        fakeNow = fakeNow.addingTimeInterval(61)
        scheduler.drain()
        XCTAssertEqual(machine.state, .sleeping)
    }

    func test_sameStateRedundantIngest_doesNotEmitChange() {
        let scheduler = TestWolfScheduler()
        let machine = WolfStateMachine(now: { Date() }, scheduler: scheduler.scheduler())
        machine.ingest(
            makeToolEvent(phase: "use", toolName: "Bash"),
            sessions: [makeSession()]
        )
        XCTAssertEqual(machine.state, .typing)

        var changeCount = 0
        let cancel = machine.objectWillChange.sink { _ in changeCount += 1 }
        defer { cancel.cancel() }

        // Re-ingest the same `use Bash` — should NOT publish.
        machine.ingest(
            makeToolEvent(phase: "use", toolName: "Bash"),
            sessions: [makeSession()]
        )
        XCTAssertEqual(changeCount, 0)
    }
}

// MARK: - SidecarEvent test helper

private extension SidecarEvent {
    /// All-nil constructor for tests. Mirrors the `SidecarBridge.emit` shape
    /// but only requires the fields a test cares about.
    static func testStub(
        type: String,
        message: String? = nil,
        sessionId: String? = nil,
        session: ChatSession? = nil,
        phase: String? = nil,
        toolName: String? = nil
    ) -> SidecarEvent {
        SidecarEvent(
            type: type,
            message: message,
            sessionId: sessionId,
            messageId: nil,
            delta: nil,
            content: nil,
            workspaceRoot: nil,
            session: session,
            sessions: nil,
            environment: nil,
            diagnostics: nil,
            bipCoach: nil,
            bipSetupReady: nil,
            day: nil,
            firstPrompt: nil,
            missingLocalDocs: nil,
            missingExternalRequirements: nil,
            nextIddDocumentType: nil,
            nextIddDocumentTitle: nil,
            bipSetupGateMessage: nil,
            scanRoot: nil,
            icp: nil,
            spec: nil,
            values: nil,
            designSystem: nil,
            adr: nil,
            goal: nil,
            docs: nil,
            sheet: nil,
            onboardingHypothesis: nil,
            error: nil,
            docType: nil,
            docPath: nil,
            progressText: nil,
            notionConnected: nil,
            success: nil,
            disconnected: nil,
            authUrl: nil,
            rowId: nil,
            status: nil,
            detail: nil,
            log: nil,
            readinessError: nil,
            bipTokenExpiredMessage: nil,
            resourceName: nil,
            resourceUrl: nil,
            stage: nil,
            provider: nil,
            sheetRowsRead: nil,
            docCharsRead: nil,
            elapsedMs: nil,
            phase: phase,
            toolName: toolName,
            summary: nil,
            items: nil,
            result: nil,
            weeklyRitualPrompt: nil,
            requestEmit: nil
        )
    }
}
