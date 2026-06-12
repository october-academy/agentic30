import Testing
import Foundation
@testable import agentic30

// MARK: - BipReadinessState model tests

struct BipReadinessStateTests {

    // MARK: allComplete

    @Test func allCompleteWhenAllRowsDone() {
        var state = BipReadinessState.loading
        for id in BipReadinessRowId.allCases {
            state.rows[id] = BipReadinessRow(id: id, status: .done, detail: nil, log: nil, error: nil)
        }
        #expect(state.allComplete == true)
    }

    @Test func allCompleteFalseWhenOnePending() {
        var state = BipReadinessState.loading
        for id in BipReadinessRowId.allCases {
            state.rows[id] = BipReadinessRow(id: id, status: .done, detail: nil, log: nil, error: nil)
        }
        state.rows[.gwsAuth] = BipReadinessRow(id: .gwsAuth, status: .pending, detail: nil, log: nil, error: nil)
        #expect(state.allComplete == false)
    }

    @Test func bipCoachSetupCompleteOnlyRequiresUserFacingSetupRows() {
        var state = BipReadinessState.loading
        for id in BipReadinessRowId.bipCoachSetupCases {
            state.rows[id] = BipReadinessRow(id: id, status: .done, detail: nil, log: nil, error: nil)
        }

        #expect(state.bipCoachSetupComplete == true)
        #expect(state.allComplete == false)
    }

    @Test func bipCoachSetupCompleteFalseWhenOneSetupRowPending() {
        var state = BipReadinessState.loading
        for id in BipReadinessRowId.bipCoachSetupCases {
            state.rows[id] = BipReadinessRow(id: id, status: .done, detail: nil, log: nil, error: nil)
        }
        state.rows[.gwsAuth] = BipReadinessRow(id: .gwsAuth, status: .pending, detail: nil, log: nil, error: nil)

        #expect(state.bipCoachSetupComplete == false)
    }

    @Test func blockingSetupIssueOnlyTracksBlockedUserFacingRows() {
        var state = BipReadinessState.loading
        for id in BipReadinessRowId.bipCoachSetupCases {
            state.rows[id] = BipReadinessRow(id: id, status: .done, detail: nil, log: nil, error: nil)
        }

        state.rows[.googleSignIn] = BipReadinessRow(id: .googleSignIn, status: .blocked, detail: nil, log: nil, error: nil)
        #expect(state.hasBlockingBipCoachSetupIssue == false)

        state.rows[.sheetUrl] = BipReadinessRow(id: .sheetUrl, status: .blocked, detail: nil, log: nil, error: nil)
        #expect(state.hasBlockingBipCoachSetupIssue == true)
    }

    @Test func loadingStateHasAllPendingRows() {
        let state = BipReadinessState.loading
        #expect(state.rows.count == BipReadinessRowId.allCases.count)
        for id in BipReadinessRowId.allCases {
            #expect(state.rows[id]?.status == .pending)
        }
    }

    @Test func rowHelperReturnsPendingForMissingRow() {
        let state = BipReadinessState.loading
        let row = state.row(.docUrl)
        #expect(row.id == .docUrl)
        #expect(row.status == .pending)
    }

    // MARK: Row ordering (canonical order from IPC doc)

    @Test func rowIdCaseOrderMatchesIpcContract() {
        let expected: [BipReadinessRowId] = [
            .localIcp, .localSpec, .localDesignSystem, .localAdr, .localGoal, .localDocs, .localSheet,
            .googleSignIn, .workspace, .gwsInstall, .gwsAuth, .docUrl, .sheetUrl
        ]
        #expect(BipReadinessRowId.allCases == expected)
    }

    @Test func bipCoachSetupRowsExcludeWelcomeOwnedRows() {
        #expect(BipReadinessRowId.bipCoachSetupCases == [
            .localIcp,
            .localSpec,
            .localDesignSystem,
            .localAdr,
            .localGoal,
            .localDocs,
            .localSheet,
            .gwsInstall, .gwsAuth, .docUrl, .sheetUrl,
        ])
        #expect(!BipReadinessRowId.bipCoachSetupCases.contains(.googleSignIn))
        #expect(!BipReadinessRowId.bipCoachSetupCases.contains(.workspace))
    }
}

// MARK: - BIP mission progress model tests

struct BipMissionProgressTests {

    @Test func generatingStepIsActiveButNotCompleteWhenProviderSuffixExists() {
        let progress = BipMissionProgress(
            stage: "generating",
            detail: nil,
            provider: "codex",
            sheetRowsRead: 12,
            docCharsRead: 200,
            elapsedMs: nil
        )

        #expect(progress.isActive(.generating) == true)
        #expect(progress.isComplete(.generating) == false)
        #expect(progress.isComplete(.readingSheet) == true)
        #expect(progress.isComplete(.readingDoc) == true)
    }

    @Test func finalizingMarksGenerationCompleteWhileFinalizingStaysActive() {
        let progress = BipMissionProgress(
            stage: "finalizing",
            detail: nil,
            provider: "codex",
            sheetRowsRead: nil,
            docCharsRead: nil,
            elapsedMs: nil
        )

        #expect(progress.isActive(.finalizing) == true)
        #expect(progress.isComplete(.readingSheet) == true)
        #expect(progress.isComplete(.readingDoc) == true)
        #expect(progress.isComplete(.generating) == true)
        #expect(progress.isComplete(.finalizing) == false)
    }
}

// MARK: - BIP Coach display state tests

struct BipCoachDisplayStateTests {

    @Test func sidecarFailureWinsOverMissionProgress() {
        let state = makeCoachState(
            missionChoices: [makeMission(id: "choice-1")]
        )

        #expect(state.displayState(hasSidecarFailure: true, hasMissionProgress: true).testName == "sidecarFailure")
    }

    @Test func progressStateWinsOverMissionChoices() {
        let state = makeCoachState(
            missionChoices: [makeMission(id: "choice-1")]
        )

        #expect(state.displayState(hasMissionProgress: true).testName == "generating")
    }

    @Test func currentMissionWinsOverGeneratedChoices() {
        let state = makeCoachState(
            missionChoices: [makeMission(id: "choice-1")],
            currentMission: makeMission(id: "selected")
        )

        #expect(state.displayState(hasMissionProgress: false).testName == "selectedMission")
    }

    @Test func missionChoicesRenderAsChoicesReadyWhenNoMissionSelected() {
        let state = makeCoachState(
            missionChoices: [
                makeMission(id: "choice-1", title: "고객 증거 공개"),
                makeMission(id: "choice-2", title: "제품 진행 공개"),
            ]
        )

        #expect(state.displayState(hasMissionProgress: false).testName == "choicesReady")
        #expect(state.pendingMissionChoices.count == 2)
    }

    @Test func emptyStateWhenNoProgressMissionOrChoicesExist() {
        let state = makeCoachState()

        #expect(state.displayState(hasMissionProgress: false).testName == "empty")
    }

    private func makeCoachState(
        missionChoices: [BipCoachMission]? = nil,
        currentMission: BipCoachMission? = nil
    ) -> BipCoachState {
        BipCoachState(
            schemaVersion: 1,
            updatedAt: nil,
            sessionId: "session-1",
            config: BipCoachConfig(
                provider: .codex,
                threadsHandle: "october",
                sheetUrl: nil,
                sheetId: "sheet-1",
                sheetTabName: nil,
                docUrl: nil,
                docId: "doc-1",
                morningHour: nil,
                eveningHour: nil
            ),
            evidence: nil,
            missionChoices: missionChoices,
            currentMission: currentMission,
            streak: BipCoachStreak(current: 0, longest: 0, lastCompletedDate: nil),
            lastError: nil
        )
    }

    private func makeMission(
        id: String,
        title: String = "오늘 미션"
    ) -> BipCoachMission {
        BipCoachMission(
            id: id,
            date: "2026-04-27",
            provider: AgentProvider.codex.rawValue,
            status: "drafted",
            compact: false,
            title: title,
            angle: "한 줄 관점",
            mission: "한 줄 수행",
            curriculumDay: nil,
            drafts: [],
            eveningChecklist: [],
            evidenceRefs: [],
            generatedAt: nil,
            completedAt: nil,
            completedQuestionCount: nil,
            threadsUrl: nil,
            sheetRowNote: nil
        )
    }
}

private extension BipCoachDisplayState {
    var testName: String {
        switch self {
        case .sidecarFailure:
            "sidecarFailure"
        case .generating:
            "generating"
        case .selectedMission:
            "selectedMission"
        case .choicesReady:
            "choicesReady"
        case .empty:
            "empty"
        }
    }
}

// MARK: - SidecarEvent decoding tests for BIP readiness fields

@MainActor
struct BipReadinessSidecarEventDecodingTests {

    // MARK: bip_readiness_event decoding

    @Test func decodesReadinessEventDoneRow() throws {
        let json = """
        {
          "type": "bip_readiness_event",
          "rowId": "gwsInstall",
          "status": "done",
          "detail": "gws 1.2.3"
        }
        """
        let event = try decoder.decode(SidecarEvent.self, from: Data(json.utf8))
        #expect(event.type == "bip_readiness_event")
        #expect(event.rowId == "gwsInstall")
        #expect(event.status == "done")
        #expect(event.detail == "gws 1.2.3")
        #expect(event.log == nil)
    }

    @Test func decodesReadinessEventWithLog() throws {
        let json = """
        {
          "type": "bip_readiness_event",
          "rowId": "gwsInstall",
          "status": "in-progress",
          "log": "added 42 packages"
        }
        """
        let event = try decoder.decode(SidecarEvent.self, from: Data(json.utf8))
        #expect(event.rowId == "gwsInstall")
        #expect(event.status == "in-progress")
        #expect(event.log == "added 42 packages")
    }

    @Test func decodesReadinessEventBlockedRow() throws {
        let json = """
        {
          "type": "bip_readiness_event",
          "rowId": "gwsAuth",
          "status": "blocked",
          "detail": "gwsInstall 미완료"
        }
        """
        let event = try decoder.decode(SidecarEvent.self, from: Data(json.utf8))
        #expect(event.rowId == "gwsAuth")
        #expect(event.status == "blocked")
    }

    @Test func decodesReadinessEventWithStructuredError() throws {
        let json = """
        {
          "type": "bip_readiness_event",
          "rowId": "gwsAuth",
          "status": "blocked",
          "error": {
            "user_message": "브라우저 로그인을 다시 시도해주세요.",
            "kind": "auth_expired",
            "raw": "invalid_rapt"
          }
        }
        """
        let event = try decoder.decode(SidecarEvent.self, from: Data(json.utf8))
        #expect(event.error == "브라우저 로그인을 다시 시도해주세요.")
        #expect(event.readinessError?.userMessage == "브라우저 로그인을 다시 시도해주세요.")
        #expect(event.readinessError?.kind == .authExpired)
        #expect(event.readinessError?.raw == "invalid_rapt")
    }

    // MARK: bip_token_expired decoding

    @Test func decodesTokenExpiredEvent() throws {
        let json = """
        {
          "type": "bip_token_expired",
          "message": "Google 연결이 만료됐어요"
        }
        """
        let event = try decoder.decode(SidecarEvent.self, from: Data(json.utf8))
        #expect(event.type == "bip_token_expired")
        #expect(event.message == "Google 연결이 만료됐어요")
    }

    // MARK: BipReadinessState mutation from decoded event

    @Test func applyingReadinessEventUpdatesRow() throws {
        let json = """
        {
          "type": "bip_readiness_event",
          "rowId": "workspace",
          "status": "done",
          "detail": "/Users/october/prj/myapp"
        }
        """
        let event = try decoder.decode(SidecarEvent.self, from: Data(json.utf8))

        guard let rawRowId = event.rowId,
              let rowId = BipReadinessRowId(rawValue: rawRowId),
              let rawStatus = event.status,
              let status = BipReadinessStatus(rawValue: rawStatus) else {
            Issue.record("Failed to parse rowId/status from event")
            return
        }

        var state = BipReadinessState.loading
        state.rows[rowId] = BipReadinessRow(
            id: rowId,
            status: status,
            detail: event.detail,
            log: event.log,
            error: nil
        )

        #expect(state.row(.workspace).status == .done)
        #expect(state.row(.workspace).detail == "/Users/october/prj/myapp")
        #expect(state.allComplete == false)
    }

    @Test func allRowsDoneYieldAllComplete() throws {
        var state = BipReadinessState.loading
        let rows = BipReadinessRowId.allCases.map { ($0.rawValue, "done") }
        for (rawId, rawStatus) in rows {
            guard let rowId = BipReadinessRowId(rawValue: rawId),
                  let status = BipReadinessStatus(rawValue: rawStatus) else { continue }
            state.rows[rowId] = BipReadinessRow(id: rowId, status: status, detail: nil, log: nil, error: nil)
        }
        #expect(state.allComplete == true)
    }

    // MARK: BipReadinessStatus raw values

    @Test func statusRawValuesMatchIpcContract() {
        #expect(BipReadinessStatus.pending.rawValue == "pending")
        #expect(BipReadinessStatus.inProgress.rawValue == "in-progress")
        #expect(BipReadinessStatus.done.rawValue == "done")
        #expect(BipReadinessStatus.blocked.rawValue == "blocked")
    }

    // MARK: BipReadinessRowId raw values

    @Test func rowIdRawValuesMatchIpcContract() {
        #expect(BipReadinessRowId.googleSignIn.rawValue == "googleSignIn")
        #expect(BipReadinessRowId.workspace.rawValue == "workspace")
        #expect(BipReadinessRowId.gwsInstall.rawValue == "gwsInstall")
        #expect(BipReadinessRowId.gwsAuth.rawValue == "gwsAuth")
        #expect(BipReadinessRowId.docUrl.rawValue == "docUrl")
        #expect(BipReadinessRowId.sheetUrl.rawValue == "sheetUrl")
    }

    // MARK: Helpers

    private var decoder: JSONDecoder {
        let d = JSONDecoder()
        d.dateDecodingStrategy = .custom { dec in
            let container = try dec.singleValueContainer()
            let value = try container.decode(String.self)
            let formatter = ISO8601DateFormatter()
            formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            guard let date = formatter.date(from: value) else {
                throw DecodingError.dataCorruptedError(
                    in: container,
                    debugDescription: "Invalid ISO8601 date: \(value)"
                )
            }
            return date
        }
        return d
    }
}
