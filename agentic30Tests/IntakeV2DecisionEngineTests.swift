import XCTest
@testable import agentic30

final class IntakeV2DecisionEngineTests: XCTestCase {

    private let engine = IntakeV2DecisionEngine()

    private func makeIntake(
        stuck: OnboardingProjectStage,
        workmode: OnboardingWorkMode = .fullTimeSolo,
        role: OnboardingRole = .developer,
        evidenceLevels: [OnboardingIsolationLevel] = []
    ) -> IntakeSnapshot {
        IntakeSnapshot(
            workmode: workmode,
            role: role,
            stuck: stuck,
            evidenceLevels: evidenceLevels,
            folderURL: URL(fileURLWithPath: "/tmp/proj")
        )
    }

    // MARK: - Rule mapping

    func test_stuckIdeaOnly_routesToInterviewRequest() {
        let d = engine.generate(intake: makeIntake(stuck: .ideaOnly), scan: .empty)
        XCTAssertEqual(d.category, .interviewRequest)
        XCTAssertEqual(d.priority, .critical)
        XCTAssertTrue(d.body.contains("인터뷰"), "interview body expected, got: \(d.body)")
    }

    func test_stuckFirstUsers_routesToPaymentResponse() {
        let d = engine.generate(intake: makeIntake(stuck: .firstUsers), scan: .empty)
        XCTAssertEqual(d.category, .paymentResponse)
        XCTAssertEqual(d.priority, .high)
    }

    func test_ideaOnlyWithInterviewEvidence_reusesExistingInterviewRecords() {
        let d = engine.generate(
            intake: makeIntake(stuck: .ideaOnly, evidenceLevels: [.occasional]),
            scan: .empty
        )
        XCTAssertEqual(d.category, .interviewRequest)
        XCTAssertEqual(d.priority, .critical)
        XCTAssertTrue(d.body.contains("기존 인터뷰 기록"), "expected existing-interview route, got: \(d.body)")
    }

    func test_firstUsersWithPaymentEvidence_routesToPaymentEvidenceReview() {
        let d = engine.generate(
            intake: makeIntake(stuck: .firstUsers, evidenceLevels: [.paymentResponses]),
            scan: .empty
        )
        XCTAssertEqual(d.category, .paymentResponse)
        XCTAssertEqual(d.priority, .high)
        XCTAssertTrue(d.body.contains("가격·결제 반응"), "expected payment evidence route, got: \(d.body)")
    }

    func test_stuckPreRevenue_routesToPricing() {
        let d = engine.generate(intake: makeIntake(stuck: .preRevenue), scan: .empty)
        XCTAssertEqual(d.category, .pricing)
        XCTAssertEqual(d.priority, .high)
    }

    func test_stuckBuilding_routesToAcquisition() {
        let d = engine.generate(intake: makeIntake(stuck: .building), scan: .empty)
        XCTAssertEqual(d.category, .acquisition)
        XCTAssertEqual(d.priority, .high)
    }

    func test_stuckPostRevenue_routesToChurn() {
        let d = engine.generate(intake: makeIntake(stuck: .postRevenue), scan: .empty)
        XCTAssertEqual(d.category, .churnSignal)
        XCTAssertEqual(d.priority, .medium)
    }

    // MARK: - Scan-pattern precedence

    func test_staleTodoOverridesStuckMapping_exceptPreRevenue() {
        var scan = LocalScanResult.empty
        scan.staleTodoDays = 14
        // stuck=ideaOnly would normally → interviewRequest
        let d = engine.generate(intake: makeIntake(stuck: .ideaOnly), scan: scan)
        XCTAssertEqual(d.category, .docChange, "stale TODO should outrank ideaOnly mapping")
        XCTAssertTrue(d.body.contains("14일"))
    }

    func test_staleTodoDoesNotOverridePreRevenue() {
        // pricing decisions should win even if TODOS.md is stale — they're more action-bearing
        var scan = LocalScanResult.empty
        scan.staleTodoDays = 30
        let d = engine.generate(intake: makeIntake(stuck: .preRevenue), scan: scan)
        XCTAssertEqual(d.category, .pricing)
    }

    // MARK: - Fallback

    func test_emptyIntakeAndScan_fallback() {
        let intake = IntakeSnapshot(workmode: nil, role: nil, stuck: nil, evidenceLevels: [], folderURL: nil)
        let d = engine.generate(intake: intake, scan: .empty)
        XCTAssertEqual(d.category, .fallback)
        XCTAssertEqual(d.priority, .low)
        XCTAssertTrue(d.body.contains("5분"))
    }

    func test_fallbackTemplate_matchesEmptyScanRoute() {
        let intake = makeIntake(stuck: .ideaOnly)
        let regular = engine.generate(intake: intake, scan: .empty)
        let fallback = engine.fallbackTemplate(intake: intake)
        // Same rule path, only the task ID differs (random suffix)
        XCTAssertEqual(regular.category, fallback.category)
        XCTAssertEqual(regular.priority, fallback.priority)
        XCTAssertEqual(regular.body, fallback.body)
    }

    // MARK: - Task ID + source attribution

    func test_taskIDFormat_prefixedAndStable() {
        let d = engine.generate(intake: makeIntake(stuck: .ideaOnly), scan: .empty)
        XCTAssertTrue(d.taskID.hasPrefix("task_intvw_"), "got: \(d.taskID)")
    }

    func test_attributedSources_alwaysIncludeLocalFolder() {
        for stuck in OnboardingProjectStage.allCases {
            let d = engine.generate(intake: makeIntake(stuck: stuck), scan: .empty)
            if d.category == .fallback { continue }
            XCTAssertTrue(
                d.attributedSources.contains(.localFolder),
                "\(stuck) decision should attribute local folder, got: \(d.attributedSources)"
            )
        }
    }
}
