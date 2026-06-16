import XCTest
@testable import agentic30

final class IntakeV2DecisionEngineTests: XCTestCase {

    private let engine = IntakeV2DecisionEngine()

    private func makeIntake(
        bottleneck: OnboardingProductBottleneck,
        workmode: OnboardingWorkMode = .fullTimeSolo,
        focusArea: OnboardingFocusArea = .development,
        evidenceLevels: [OnboardingIsolationLevel] = []
    ) -> IntakeSnapshot {
        IntakeSnapshot(
            workmode: workmode,
            focusArea: focusArea,
            bottleneck: bottleneck,
            evidenceLevels: evidenceLevels,
            folderURL: URL(fileURLWithPath: "/tmp/proj")
        )
    }

    // MARK: - Rule mapping

    func test_problemDefinition_routesToInterviewRequest() {
        let d = engine.generate(intake: makeIntake(bottleneck: .problemDefinition), scan: .empty)
        XCTAssertEqual(d.category, .interviewRequest)
        XCTAssertEqual(d.priority, .critical)
        XCTAssertTrue(d.body.contains("인터뷰"), "interview body expected, got: \(d.body)")
    }

    func test_pricingOfferWithoutPaymentEvidence_routesToPricing() {
        let d = engine.generate(intake: makeIntake(bottleneck: .pricingOffer), scan: .empty)
        XCTAssertEqual(d.category, .pricing)
        XCTAssertEqual(d.priority, .high)
    }

    func test_problemDefinitionWithInterviewEvidence_reusesExistingInterviewRecords() {
        let d = engine.generate(
            intake: makeIntake(bottleneck: .problemDefinition, evidenceLevels: [.occasional]),
            scan: .empty
        )
        XCTAssertEqual(d.category, .interviewRequest)
        XCTAssertEqual(d.priority, .critical)
        XCTAssertTrue(d.body.contains("기존 인터뷰 기록"), "expected existing-interview route, got: \(d.body)")
    }

    func test_pricingOfferWithPaymentEvidence_routesToPaymentEvidenceReview() {
        let d = engine.generate(
            intake: makeIntake(bottleneck: .pricingOffer, evidenceLevels: [.paymentResponses]),
            scan: .empty
        )
        XCTAssertEqual(d.category, .paymentResponse)
        XCTAssertEqual(d.priority, .high)
        XCTAssertTrue(d.body.contains("가격·결제 반응"), "expected payment evidence route, got: \(d.body)")
    }

    func test_pricingOffer_routesToPricing() {
        let d = engine.generate(intake: makeIntake(bottleneck: .pricingOffer), scan: .empty)
        XCTAssertEqual(d.category, .pricing)
        XCTAssertEqual(d.priority, .high)
    }

    func test_firstActiveUsers_routesToAcquisition() {
        let d = engine.generate(intake: makeIntake(bottleneck: .firstActiveUsers), scan: .empty)
        XCTAssertEqual(d.category, .acquisition)
        XCTAssertEqual(d.priority, .high)
    }

    func test_repeatUsage_routesToChurn() {
        let d = engine.generate(intake: makeIntake(bottleneck: .repeatUsage), scan: .empty)
        XCTAssertEqual(d.category, .churnSignal)
        XCTAssertEqual(d.priority, .medium)
    }

    // MARK: - Scan-pattern precedence

    func test_staleTodoOverridesBottleneckMapping_exceptPricingOffer() {
        var scan = LocalScanResult.empty
        scan.staleTodoDays = 14
        let d = engine.generate(intake: makeIntake(bottleneck: .problemDefinition), scan: scan)
        XCTAssertEqual(d.category, .docChange, "stale TODO should outrank problem definition mapping")
        XCTAssertTrue(d.body.contains("14일"))
    }

    func test_staleTodoDoesNotOverridePricingOffer() {
        var scan = LocalScanResult.empty
        scan.staleTodoDays = 30
        let d = engine.generate(intake: makeIntake(bottleneck: .pricingOffer), scan: scan)
        XCTAssertEqual(d.category, .pricing)
    }

    // MARK: - Fallback

    func test_emptyIntakeAndScan_fallback() {
        let intake = IntakeSnapshot(workmode: nil, focusArea: nil, bottleneck: nil, evidenceLevels: [], folderURL: nil)
        let d = engine.generate(intake: intake, scan: .empty)
        XCTAssertEqual(d.category, .fallback)
        XCTAssertEqual(d.priority, .low)
        XCTAssertTrue(d.body.contains("5분"))
    }

    func test_fallbackTemplate_matchesEmptyScanRoute() {
        let intake = makeIntake(bottleneck: .problemDefinition)
        let regular = engine.generate(intake: intake, scan: .empty)
        let fallback = engine.fallbackTemplate(intake: intake)
        // Same rule path, only the task ID differs (random suffix)
        XCTAssertEqual(regular.category, fallback.category)
        XCTAssertEqual(regular.priority, fallback.priority)
        XCTAssertEqual(regular.body, fallback.body)
    }

    // MARK: - Task ID + source attribution

    func test_taskIDFormat_prefixedAndStable() {
        let d = engine.generate(intake: makeIntake(bottleneck: .problemDefinition), scan: .empty)
        XCTAssertTrue(d.taskID.hasPrefix("task_intvw_"), "got: \(d.taskID)")
    }

    func test_attributedSources_alwaysIncludeLocalFolder() {
        for bottleneck in OnboardingProductBottleneck.allCases {
            let d = engine.generate(intake: makeIntake(bottleneck: bottleneck), scan: .empty)
            if d.category == .fallback { continue }
            XCTAssertTrue(
                d.attributedSources.contains(.localFolder),
                "\(bottleneck) decision should attribute local folder, got: \(d.attributedSources)"
            )
        }
    }
}
