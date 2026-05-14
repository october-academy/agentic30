import Foundation

// MARK: - Intake V2 Decision Engine — review decision D4 (eng)
// Rule-based hybrid first-Decide engine.
// Inputs: IntakeSnapshot (workmode/role/stuck/folderURL) + LocalScanResult
// Output: IntakeV2Decision (badge, body, rationale, source attribution)
// Future: LLM fallback path (out of scope for this PR — flagged in plan)

struct IntakeSnapshot: Equatable {
    let workmode: OnboardingWorkMode?
    let role: OnboardingRole?
    let stuck: OnboardingProjectStage?
    let folderURL: URL?

    static func from(store: IntakeV2Store) -> IntakeSnapshot {
        IntakeSnapshot(
            workmode: store.workmode,
            role: store.role,
            stuck: store.stuck,
            folderURL: store.folderURL
        )
    }
}

struct LocalScanResult: Equatable {
    var fileCount: Int
    var totalBytes: Int64
    var staleSpecDays: Int?       // days since SPEC.md / *.md last modified
    var staleTodoDays: Int?       // days since TODOS.md last modified
    var lastCommitDays: Int?      // days since last git commit (if git repo)
    var hasInterviewTranscripts: Bool
    var hasPaymentResponses: Bool

    static let empty = LocalScanResult(
        fileCount: 0,
        totalBytes: 0,
        staleSpecDays: nil,
        staleTodoDays: nil,
        lastCommitDays: nil,
        hasInterviewTranscripts: false,
        hasPaymentResponses: false
    )
}

struct IntakeV2Decision: Equatable {
    enum SignalCategory: String {
        case interviewRequest = "INTERVIEW_REQUEST"
        case paymentResponse = "PAYMENT_RESPONSE"
        case docChange = "DOC_CHANGE"
        case churnSignal = "CHURN_SIGNAL"
        case acquisition = "ACQUISITION"
        case pricing = "PRICING"
        case fallback = "FALLBACK"
    }

    enum Priority: String {
        case critical, high, medium, low
    }

    let category: SignalCategory
    let priority: Priority
    let taskID: String
    let body: String
    let rationale: String
    let metaLine: String         // e.g. "priority=critical · age=8w"
    let attributedSources: [IntakeSourceID]
}

// MARK: - DecisionEngine (D6: separated class)

struct IntakeV2DecisionEngine {

    /// Generate the first Decide card from intake answers + local scan.
    /// Pure function — no I/O, no side effects. Trivially testable.
    func generate(intake: IntakeSnapshot, scan: LocalScanResult) -> IntakeV2Decision {

        // Rule 1 — strong stale signal trumps stuck mapping
        if let staleDays = scan.staleTodoDays, staleDays >= 7, intake.stuck != .preRevenue {
            return IntakeV2Decision(
                category: .docChange,
                priority: .medium,
                taskID: makeID("docchg"),
                body: "TODOS.md가 \(staleDays)일째 변경 없음. 다음 한 가지를 정의해 업데이트.",
                rationale: "오래된 TODOS.md = 다음 단계가 불분명한 상태. 결정 정확도를 높이려면 우선 정리.",
                metaLine: "source=local · age=\(staleDays)d · priority=med",
                attributedSources: [.localFolder]
            )
        }

        // Rule 2 — stuck=ideaOnly + interview gap → demand interview
        if intake.stuck == .ideaOnly {
            let weeksGap = scan.lastCommitDays.map { Int(Double($0) / 7.0) } ?? 8
            return IntakeV2Decision(
                category: .interviewRequest,
                priority: .critical,
                taskID: makeID("intvw"),
                body: "이번 주 신규 가입자 3명에게 30분 인터뷰 요청 발송.",
                rationale: "stuck=problem_discovery. 누구의 어떤 문제인지부터 좁혀야 함. 인터뷰가 가장 시급한 input.",
                metaLine: "priority=critical · gap=\(weeksGap)w",
                attributedSources: attributedSourcesForInterview(intake: intake)
            )
        }

        // Rule 3 — stuck=firstUsers (payment) + hint of payment data → payment analysis
        if intake.stuck == .firstUsers {
            return IntakeV2Decision(
                category: .paymentResponse,
                priority: .high,
                taskID: makeID("pmt"),
                body: "지난 결제 거절·이탈 응답을 모아 공통 reason 3가지 정리.",
                rationale: "stuck=monetization. 결제 직전 이탈이 가장 비싼 신호. 패턴부터 봄.",
                metaLine: "priority=high · age=2d",
                attributedSources: scan.hasPaymentResponses
                    ? [.localFolder, .toss, .stripe]
                    : [.localFolder]
            )
        }

        // Rule 4 — stuck=preRevenue (pricing) → pricing experiment
        if intake.stuck == .preRevenue {
            return IntakeV2Decision(
                category: .pricing,
                priority: .high,
                taskID: makeID("price"),
                body: "가격 후보 2개를 정하고 다음 인터뷰에서 직접 제안 테스트.",
                rationale: "stuck=pricing. 가격은 물어봐야 알 수 있음. 다음 인터뷰가 실험장.",
                metaLine: "priority=high · gap=untested",
                attributedSources: [.localFolder]
            )
        }

        // Rule 5 — stuck=building (acquisition)
        if intake.stuck == .building {
            return IntakeV2Decision(
                category: .acquisition,
                priority: .high,
                taskID: makeID("acq"),
                body: "최근 가입자 5명의 가입 직후 첫 행동을 시간순으로 정리.",
                rationale: "stuck=acquisition. 들어온 사람이 무엇을 보고 떠나는지가 답.",
                metaLine: "priority=high · age=24h",
                attributedSources: [.localFolder, .posthog]
            )
        }

        // Rule 6 — stuck=postRevenue (retention/growth)
        if intake.stuck == .postRevenue {
            return IntakeV2Decision(
                category: .churnSignal,
                priority: .medium,
                taskID: makeID("churn"),
                body: "6개월 이상 사용자 중 최근 30일 미접속 명단을 정리.",
                rationale: "stuck=growth. 오래 쓴 사람의 이탈이 가장 비싼 신호.",
                metaLine: "priority=med · users=tbd",
                attributedSources: [.localFolder, .posthog]
            )
        }

        // Fallback — no rule matched (empty scan + no stuck answer)
        return IntakeV2Decision(
            category: .fallback,
            priority: .low,
            taskID: makeID("fb"),
            body: "오늘 5분 동안 어제 만든 것·막힌 것·배운 것을 한 문장씩 메모.",
            rationale: "기록이 부족합니다. 컨텍스트가 쌓이면 더 정확한 결정을 만들 수 있어요.",
            metaLine: "priority=low · corpus=empty",
            attributedSources: []
        )
    }

    /// Make decision when scan completely failed (D3 design — graceful fallback).
    /// Used by splash when scan errors or permission denied — template-only Decide.
    func fallbackTemplate(intake: IntakeSnapshot) -> IntakeV2Decision {
        // Force empty scan path through main generate() so the same rules cover stuck mapping.
        return generate(intake: intake, scan: .empty)
    }

    // MARK: - helpers

    private func makeID(_ prefix: String) -> String {
        let hex = String(format: "%04x", UInt16.random(in: 0..<UInt16.max))
        return "task_\(prefix)_\(hex)"
    }

    private func attributedSourcesForInterview(intake: IntakeSnapshot) -> [IntakeSourceID] {
        // Always start with local folder; cloud sources are post-onboarding (D1)
        var sources: [IntakeSourceID] = [.localFolder]
        if intake.role == .productManager {
            sources.append(.notion)
        }
        return sources
    }
}
