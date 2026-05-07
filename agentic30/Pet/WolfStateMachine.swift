import Foundation
import Combine

/// Translates sidecar `SidecarEvent`s into a single `WolfState` published to
/// the pet view. Owns idle→sleeping timing, transient state holdoffs, and
/// per-session subagent tallying. Pure logic — no UI imports — so unit tests
/// can drive it with a fake clock.
@MainActor
final class WolfStateMachine: ObservableObject {

    // MARK: - Published state

    @Published private(set) var state: WolfState = .idle

    // MARK: - Tunables

    /// No-event window before falling asleep.
    var sleepAfter: TimeInterval = 60

    /// `happy` and other one-shots auto-return to base after this long.
    var oneShotDuration: TimeInterval = 3

    /// `attention` (e.g. session created, user wake) auto-returns this fast.
    var attentionDuration: TimeInterval = 1.5

    /// `error` blocks lower-priority transitions for this long.
    var errorHoldoffDuration: TimeInterval = 3

    // MARK: - Internals

    /// Tracks active Task subagent runs by session ID. We can't tell apart
    /// individual concurrent Task tool calls inside the same session from
    /// `tool_event` payloads alone, so each session counts as at most one.
    private var sessionsWithActiveTask: Set<String> = []

    /// Sessions currently emitting tool_events. Used to decide between
    /// `working` and `typing` for non-Task tools (3+ → `working`).
    private var sessionsActivelyTooling: Set<String> = []

    /// When set, lower-priority transitions are ignored until this date.
    private var holdoffUntil: Date?

    /// Pending one-shot timer that resets transient states (`happy`,
    /// `attention`, `sweeping`, `carrying`) back to a base state.
    private var oneShotWorkItem: DispatchWorkItem?

    /// Idle→sleeping watchdog.
    private var sleepWorkItem: DispatchWorkItem?

    /// Last time any event was ingested. Used by sleep timer.
    private var lastEventAt: Date

    /// Injected for tests. Real instances use `Date()` and the main queue.
    private let nowProvider: () -> Date
    private let scheduler: WolfScheduler

    // MARK: - Init

    init(
        now: @escaping () -> Date = Date.init,
        scheduler: WolfScheduler? = nil
    ) {
        self.nowProvider = now
        self.scheduler = scheduler ?? .live
        self.lastEventAt = now()
        scheduleSleepCheck()
    }

    // MARK: - Public API

    /// Single entry point. Call this from `AgenticViewModel.handle(_:)`
    /// after the existing branch logic, with the same event and a snapshot
    /// of the sessions array.
    func ingest(_ event: SidecarEvent, sessions: [ChatSession]) {
        lastEventAt = nowProvider()
        scheduleSleepCheck()

        switch event.type {
        case "session_created":
            transientFlash(.attention, duration: attentionDuration, baseAfter: sessions)

        case "session_deleted":
            transientFlash(.sweeping, duration: oneShotDuration, baseAfter: sessions)

        case "session_updated":
            handleSessionUpdated(event: event, sessions: sessions)

        case "tool_event":
            handleToolEvent(event: event, sessions: sessions)

        case "agent_event", "message_delta":
            // Streaming activity: an agent is actively producing tokens.
            // Recompute so derive() can promote us out of `notification`
            // when a session has moved to `running`.
            recompute(from: sessions)

        case "pet_hook":
            // Lifecycle signal from a Claude Agent SDK in-process hook
            // (PreCompact, Stop, WorktreeCreate, etc.). The hook event
            // name rides on `event.message`.
            if let name = event.message {
                handleHook(name: name, sessions: sessions)
            }

        case "message_replaced":
            // A message just got finalized. If every session is now idle,
            // briefly celebrate.
            if sessions.allSatisfy({ $0.status == .idle }) {
                transientFlash(.happy, duration: oneShotDuration, baseAfter: sessions)
            } else {
                recompute(from: sessions)
            }

        case "workspace_scan_started", "doc_creation_started":
            transition(to: .carrying, sessions: sessions)

        case "workspace_scan_result", "doc_creation_result":
            transientFlash(.sweeping, duration: oneShotDuration, baseAfter: sessions)

        case "error":
            // Sidecar's generic error broadcast. Connection-level errors
            // (sessionId == nil) are noisy and not really pet-worthy;
            // only flash error for session-scoped failures.
            if event.sessionId != nil {
                holdoffUntil = nowProvider().addingTimeInterval(errorHoldoffDuration)
                transition(to: .error, sessions: sessions, force: true)
                scheduleHoldoffRelease(for: sessions)
            }

        default:
            break
        }
    }

    /// User-triggered double-click: lock into `happy` for `oneShotDuration`.
    func poke(sessions: [ChatSession]) {
        transientFlash(.happy, duration: oneShotDuration, baseAfter: sessions)
    }

    /// Force-evaluate state from current session list. Useful when sessions
    /// change without a discrete event (e.g., periodic snapshot).
    func recompute(from sessions: [ChatSession]) {
        // Ignore recomputes while a holdoff (e.g. `error`) is active.
        if let until = holdoffUntil, nowProvider() < until {
            return
        }
        let next = derive(from: sessions)
        transition(to: next, sessions: sessions, force: false)
    }

    // MARK: - Event handlers

    private func handleSessionUpdated(event: SidecarEvent, sessions: [ChatSession]) {
        if let session = event.session, session.status == .error {
            holdoffUntil = nowProvider().addingTimeInterval(errorHoldoffDuration)
            transition(to: .error, sessions: sessions, force: true)
            scheduleHoldoffRelease(for: sessions)
            return
        }
        // For all other status transitions (awaitingInput / running / idle),
        // let derive() decide based on the full sessions snapshot. This
        // prevents a single awaitingInput session from sticking us in
        // `notification` while another session is actively running.
        recompute(from: sessions)
    }

    /// Translates a Claude Agent SDK hook event name into a pet state
    /// transition. We intentionally do NOT handle PreToolUse / PostToolUse /
    /// SubagentStart / SubagentStop here — sidecar's existing `tool_event`
    /// broadcasts already drive those, and reacting to the hook too would
    /// double-count tool/subagent activity.
    private func handleHook(name: String, sessions: [ChatSession]) {
        switch name {
        case "PreCompact":
            transientFlash(.sweeping, duration: oneShotDuration, baseAfter: sessions)
        case "PostCompact":
            transientFlash(.attention, duration: attentionDuration, baseAfter: sessions)
        case "Stop":
            transientFlash(.happy, duration: oneShotDuration, baseAfter: sessions)
        case "StopFailure", "PostToolUseFailure":
            holdoffUntil = nowProvider().addingTimeInterval(errorHoldoffDuration)
            transition(to: .error, sessions: sessions, force: true)
            scheduleHoldoffRelease(for: sessions)
        case "Notification", "PermissionRequest":
            transientFlash(.notification, duration: oneShotDuration, baseAfter: sessions)
        case "WorktreeCreate":
            transientFlash(.carrying, duration: oneShotDuration, baseAfter: sessions)
        case "UserPromptSubmit":
            transition(to: .thinking, sessions: sessions)
        default:
            break
        }
    }

    private func handleToolEvent(event: SidecarEvent, sessions: [ChatSession]) {
        let phase = event.phase ?? ""
        let tool = event.toolName ?? ""
        let sessionID = event.sessionId ?? ""

        switch phase {
        case "thinking":
            transition(to: .thinking, sessions: sessions)
            return
        case "error":
            holdoffUntil = nowProvider().addingTimeInterval(errorHoldoffDuration)
            transition(to: .error, sessions: sessions, force: true)
            scheduleHoldoffRelease(for: sessions)
            return
        case "use":
            if tool == "Task" {
                if !sessionID.isEmpty { sessionsWithActiveTask.insert(sessionID) }
            } else if !sessionID.isEmpty {
                sessionsActivelyTooling.insert(sessionID)
            }
        case "result":
            if tool == "Task" {
                if !sessionID.isEmpty { sessionsWithActiveTask.remove(sessionID) }
            } else if !sessionID.isEmpty {
                sessionsActivelyTooling.remove(sessionID)
            }
        default:
            break
        }
        recompute(from: sessions)
    }

    // MARK: - Derivation

    private func derive(from sessions: [ChatSession]) -> WolfState {
        // Subagent precedence: 2+ active Task sessions → conducting,
        // exactly 1 → juggling.
        if sessionsWithActiveTask.count >= 2 {
            return .conducting
        }
        if sessionsWithActiveTask.count == 1 {
            return .juggling
        }

        let runningCount = sessions.filter { $0.status == .running }.count
        let awaitingCount = sessions.filter { $0.status == .awaitingInput }.count

        // Active work beats waiting-on-user. A 3+ pile-up reads as `working`,
        // anything ≥1 with tool activity reads as `typing`, and a running
        // session without observed tool activity reads as `thinking`
        // (LLM streaming tokens before/between tool calls).
        if sessionsActivelyTooling.count >= 3 || runningCount >= 3 {
            return .working
        }
        if !sessionsActivelyTooling.isEmpty {
            return .typing
        }
        if runningCount > 0 {
            return .thinking
        }

        // No active work. Awaiting_input now wins → notification.
        if awaitingCount > 0 {
            return .notification
        }

        return .idle
    }

    // MARK: - Transitions

    private func transition(to next: WolfState, sessions: [ChatSession], force: Bool = false) {
        // Holdoff: while in error window, ignore lower-priority transitions
        // unless force=true (e.g. another error event).
        if let until = holdoffUntil, nowProvider() < until, !force, next.priority < state.priority {
            return
        }
        // Don't reset GIF playhead by re-assigning the same value.
        guard next != state else { return }
        state = next
    }

    private func transientFlash(_ flash: WolfState, duration: TimeInterval, baseAfter sessions: [ChatSession]) {
        oneShotWorkItem?.cancel()
        transition(to: flash, sessions: sessions, force: true)
        let work = DispatchWorkItem { [weak self] in
            guard let self else { return }
            // After the flash, fall back to whatever the current sessions imply.
            self.recompute(from: sessions)
        }
        oneShotWorkItem = work
        scheduler.schedule(after: duration, work: work)
    }

    private func scheduleHoldoffRelease(for sessions: [ChatSession]) {
        let work = DispatchWorkItem { [weak self] in
            guard let self else { return }
            self.holdoffUntil = nil
            self.recompute(from: sessions)
        }
        scheduler.schedule(after: errorHoldoffDuration, work: work)
    }

    private func scheduleSleepCheck() {
        sleepWorkItem?.cancel()
        let work = DispatchWorkItem { [weak self] in
            guard let self else { return }
            let elapsed = self.nowProvider().timeIntervalSince(self.lastEventAt)
            if elapsed >= self.sleepAfter {
                self.transition(to: .sleeping, sessions: [], force: false)
            } else {
                self.scheduleSleepCheck()
            }
        }
        sleepWorkItem = work
        scheduler.schedule(after: sleepAfter, work: work)
    }
}

// MARK: - WolfScheduler abstraction (test seam)

/// Wraps `DispatchQueue.main.asyncAfter`. Tests pass a fake.
struct WolfScheduler: Sendable {
    let schedule: @Sendable (TimeInterval, DispatchWorkItem) -> Void

    static let live = WolfScheduler { delay, work in
        DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: work)
    }
}

extension WolfScheduler {
    /// Helper used from `WolfStateMachine` to keep call sites compact.
    func schedule(after delay: TimeInterval, work: DispatchWorkItem) {
        schedule(delay, work)
    }
}
