import XCTest
@testable import agentic30

/// Pins the reason-aware recovery plan for a blocked workspace scan. The raw
/// notice alone doesn't distinguish an aborted (timeout) run — where the failed
/// provider is still scan-ready and should simply be retried — from a usage
/// limit, an auth gap, or a fully empty environment. This presenter makes those
/// calls; the tests lock the copy framing and the primary action per reason.
///
/// `@MainActor` because the recovery type inherits the module's main-actor
/// default isolation (like its sibling model structs), so its Equatable
/// conformance must be compared from a main-actor context.
@MainActor
final class WorkspaceScanBlockedRecoveryTests: XCTestCase {

    private func readiness(
        _ provider: AgentProvider,
        scanReady: Bool,
        sdkInstalled: Bool = true,
        authenticated: Bool? = nil,
        authAction: String? = nil
    ) -> WorkspaceScanProviderReadiness {
        WorkspaceScanProviderReadiness(
            provider: provider,
            sdkInstalled: sdkInstalled,
            authenticated: authenticated ?? scanReady,
            scanReady: scanReady,
            source: "",
            message: "",
            sdkMessage: "",
            authAction: authAction
        )
    }

    private func notice(
        reason: String,
        errorKind: String?,
        provider: AgentProvider,
        message: String = "",
        nextProvider: AgentProvider? = nil,
        abortCause: String? = nil,
        retryAttempt: Int? = nil,
        readiness list: [WorkspaceScanProviderReadiness]
    ) -> WorkspaceScanBlockedNotice {
        WorkspaceScanBlockedNotice(
            scanRoot: "/tmp/ws",
            provider: provider,
            model: "",
            reason: reason,
            message: message,
            nextProvider: nextProvider,
            availableProviders: list.filter(\.scanReady).map(\.provider),
            providerReadiness: list,
            errorKind: errorKind,
            abortCause: abortCause,
            retryAttempt: retryAttempt
        )
    }

    func testTimeoutAbortRetriesSameStillReadyProvider() {
        // claude timed out on our wall-clock budget (soft_timeout) but is still
        // authed + scan-ready → retry it once with the extended budget; do NOT
        // switch to the nextProvider rotation, and frame it as a timeout.
        let recovery = WorkspaceScanBlockedRecovery(notice: notice(
            reason: "aborted",
            errorKind: "provider_aborted",
            provider: .claude,
            nextProvider: .codex,
            abortCause: "soft_timeout",
            readiness: [readiness(.claude, scanReady: true), readiness(.codex, scanReady: true)]
        ))
        XCTAssertEqual(recovery.primaryAction, .retry(.claude))
        XCTAssertEqual(recovery.alternateProviders, [.codex])
        XCTAssertTrue(recovery.title.contains("시간"))
        XCTAssertTrue(recovery.body.contains("다시 시도"))
    }

    func testTimeoutAbortAfterRetrySwitchesProvider() {
        // The extended-budget retry (retryAttempt 1) still timed out → stop
        // looping on the same provider and steer to a switch.
        let recovery = WorkspaceScanBlockedRecovery(notice: notice(
            reason: "aborted",
            errorKind: "provider_aborted",
            provider: .claude,
            nextProvider: .codex,
            abortCause: "hard_deadline",
            retryAttempt: 1,
            readiness: [readiness(.claude, scanReady: true), readiness(.codex, scanReady: true)]
        ))
        XCTAssertEqual(recovery.primaryAction, .switchProvider(.codex))
        XCTAssertTrue(recovery.title.contains("시간"))
    }

    func testExternalAbortSteersToSwitchNotTimeoutRetry() {
        // External/SDK abort (no soft/hard timer fired) → switch, NOT a
        // same-provider retry, and the copy must not claim a timeout.
        let recovery = WorkspaceScanBlockedRecovery(notice: notice(
            reason: "aborted",
            errorKind: "provider_aborted",
            provider: .claude,
            nextProvider: .codex,
            abortCause: "external",
            readiness: [readiness(.claude, scanReady: true), readiness(.codex, scanReady: true)]
        ))
        XCTAssertEqual(recovery.primaryAction, .switchProvider(.codex))
        XCTAssertFalse(recovery.body.contains("시간 예산"))
    }

    func testUsageLimitSwitchesToFallbackWithCapCopy() {
        let recovery = WorkspaceScanBlockedRecovery(notice: notice(
            reason: "usage_limit",
            errorKind: "provider_usage_limit",
            provider: .codex,
            nextProvider: .claude,
            readiness: [readiness(.claude, scanReady: true)]
        ))
        XCTAssertEqual(recovery.primaryAction, .switchProvider(.claude))
        XCTAssertTrue(recovery.title.contains("사용 한도"))
    }

    func testGenericErrorKeepsSwitchFraming() {
        let recovery = WorkspaceScanBlockedRecovery(notice: notice(
            reason: "error",
            errorKind: nil,
            provider: .codex,
            nextProvider: .claude,
            readiness: [readiness(.claude, scanReady: true)]
        ))
        XCTAssertEqual(recovery.primaryAction, .switchProvider(.claude))
        XCTAssertTrue(recovery.body.contains("로컬 신호"))
    }

    func testAuthRequiredRoutesToConnect() {
        let recovery = WorkspaceScanBlockedRecovery(notice: notice(
            reason: "unavailable",
            errorKind: "provider_auth_required",
            provider: .codex,
            readiness: [
                readiness(.codex, scanReady: false, authenticated: false, authAction: "codex_login"),
                readiness(.claude, scanReady: false, authenticated: false, authAction: "claude_login"),
            ]
        ))
        guard case .connect(let list) = recovery.primaryAction else {
            return XCTFail("expected .connect, got \(recovery.primaryAction)")
        }
        XCTAssertEqual(list.map(\.provider), [.codex, .claude])
    }

    func testInsufficientEvidenceKeepsProviderSettingsOutOfRecovery() {
        let recovery = WorkspaceScanBlockedRecovery(notice: notice(
            reason: "insufficient_evidence",
            errorKind: "workspace_scan_insufficient_evidence",
            provider: .codex,
            message: "고객, 문제, 활성/검증 행동 근거는 Day 1 질문에서 먼저 확인합니다.",
            readiness: []
        ))
        XCTAssertEqual(recovery.primaryAction, .reviewEvidence)
        XCTAssertEqual(recovery.alternateProviders, [])
        XCTAssertEqual(recovery.title, "처음 기준을 정합니다")
        XCTAssertTrue(recovery.body.contains("첫 질문"))
    }

    func testNothingInstalledRoutesToSettings() {
        let recovery = WorkspaceScanBlockedRecovery(notice: notice(
            reason: "error",
            errorKind: nil,
            provider: .codex,
            readiness: [readiness(.codex, scanReady: false, sdkInstalled: false, authenticated: false)]
        ))
        XCTAssertEqual(recovery.primaryAction, .openSettings)
    }

    func testAbortedButFailedProviderNoLongerReadyFallsBackToSwitch() {
        // Aborted, but the failed provider lost readiness; a different provider
        // is ready → switch rather than retry a dead provider.
        let recovery = WorkspaceScanBlockedRecovery(notice: notice(
            reason: "aborted",
            errorKind: "provider_aborted",
            provider: .claude,
            nextProvider: .codex,
            readiness: [
                readiness(.claude, scanReady: false, authenticated: false),
                readiness(.codex, scanReady: true),
            ]
        ))
        XCTAssertEqual(recovery.primaryAction, .switchProvider(.codex))
    }
}
