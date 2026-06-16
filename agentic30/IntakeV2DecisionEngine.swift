import Foundation

// MARK: - Intake V2 Decision Engine — review decision D4 (eng)
// Rule-based hybrid first-Decide engine.
// Output: IntakeV2Decision (badge, body, rationale, source attribution)
// Future: LLM fallback path (out of scope for this PR — flagged in plan)

struct IntakeSnapshot: Equatable {
    let workmode: OnboardingWorkMode?
    let focusArea: OnboardingFocusArea?
    let bottleneck: OnboardingProductBottleneck?
    let evidenceLevels: [OnboardingIsolationLevel]
    let folderURL: URL?

    @MainActor
    static func from(store: IntakeV2Store) -> IntakeSnapshot {
        IntakeSnapshot(
            workmode: store.workmode,
            focusArea: store.focusArea,
            bottleneck: store.bottleneck,
            evidenceLevels: store.evidenceLevels,
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

        var displayName: String {
            switch self {
            case .interviewRequest:
                return "인터뷰 요청"
            case .paymentResponse:
                return "결제 응답"
            case .docChange:
                return "문서 변경"
            case .churnSignal:
                return "이탈 신호"
            case .acquisition:
                return "가입 행동"
            case .pricing:
                return "가격 검증"
            case .fallback:
                return "기록 시작"
            }
        }
    }

    enum Priority: String {
        case critical, high, medium, low
    }

    let category: SignalCategory
    let priority: Priority
    let taskID: String
    let body: String
    let rationale: String
    let metaLine: String         // e.g. "8주 공백"
    let attributedSources: [IntakeSourceID]
}

// MARK: - DecisionEngine (D6: separated class)

struct IntakeV2DecisionEngine {

    /// Generate the first Decide card from intake answers + local scan.
    /// Pure function — no I/O, no side effects. Trivially testable.
    func generate(intake: IntakeSnapshot, scan: LocalScanResult) -> IntakeV2Decision {

        // Rule 1 — strong stale signal trumps bottleneck mapping
        if let staleDays = scan.staleTodoDays, staleDays >= 7, intake.bottleneck != .pricingOffer {
            return IntakeV2Decision(
                category: .docChange,
                priority: .medium,
                taskID: makeID("docchg"),
                body: "TODOS.md가 \(staleDays)일째 변경 없음. 다음 한 가지를 정의해 업데이트.",
                rationale: "오래된 TODOS.md = 다음 단계가 불분명한 상태. 결정 정확도를 높이려면 우선 정리.",
                metaLine: "\(staleDays)일 경과",
                attributedSources: [.localFolder]
            )
        }

        if intake.bottleneck == .problemDefinition {
            let weeksGap = scan.lastCommitDays.map { Int(Double($0) / 7.0) } ?? 8
            if intake.evidenceLevels.contains(.occasional) || scan.hasInterviewTranscripts {
                return IntakeV2Decision(
                    category: .interviewRequest,
                    priority: .critical,
                    taskID: makeID("intvw"),
                    body: "기존 인터뷰 기록 3건에서 반복 통증 1개와 현재 대안 1개 추출.",
                    rationale: "이미 고객 발화가 있습니다. 새 인터뷰를 잡기 전에 과거 행동과 반복 통증을 압축해야 다음 질문이 날카로워집니다.",
                    metaLine: "인터뷰 기록 있음",
                    attributedSources: attributedSourcesForInterview(intake: intake)
                )
            }
            return IntakeV2Decision(
                category: .interviewRequest,
                priority: .critical,
                taskID: makeID("intvw"),
                body: "이번 주 신규 가입자 3명에게 30분 인터뷰 요청 발송.",
                rationale: "문제 발견 단계입니다. 누구의 어떤 문제인지부터 좁혀야 하므로 인터뷰가 가장 시급한 입력입니다.",
                metaLine: "\(weeksGap)주 공백",
                attributedSources: attributedSourcesForInterview(intake: intake)
            )
        }

        if intake.bottleneck == .pricingOffer {
            if intake.evidenceLevels.contains(.paymentResponses) {
                return IntakeV2Decision(
                    category: .paymentResponse,
                    priority: .high,
                    taskID: makeID("pmt"),
                    body: "이미 받은 가격·결제 반응을 모아 거절 사유와 지불 신호를 분리.",
                    rationale: "유료 전환 전 단계입니다. 가격 반응이 있다면 더 많은 기능보다 결제 직전의 막힌 이유를 먼저 정리해야 합니다.",
                    metaLine: "가격·결제 반응 있음",
                    attributedSources: scan.hasPaymentResponses
                        ? [.localFolder, .toss, .stripe]
                        : [.localFolder]
                )
            }
            return IntakeV2Decision(
                category: .pricing,
                priority: .high,
                taskID: makeID("price"),
                body: "가격 후보 2개를 정하고 다음 인터뷰에서 직접 제안 테스트.",
                rationale: "결제 제안과 가격 설정이 막혀 있습니다. 가격은 직접 제안해 봐야 알 수 있으므로 다음 인터뷰가 실험장입니다.",
                metaLine: "미검증",
                attributedSources: [.localFolder]
            )
        }

        if intake.bottleneck == .firstActiveUsers {
            return IntakeV2Decision(
                category: .acquisition,
                priority: .high,
                taskID: makeID("acq"),
                body: "최근 가입자 5명의 가입 직후 첫 행동을 시간순으로 정리.",
                rationale: "가입 이후 행동이 불명확합니다. 들어온 사람이 무엇을 보고 떠나는지가 답입니다.",
                metaLine: "24시간 경과",
                attributedSources: [.localFolder, .posthog]
            )
        }

        if intake.bottleneck == .repeatUsage {
            return IntakeV2Decision(
                category: .churnSignal,
                priority: .medium,
                taskID: makeID("churn"),
                body: "최근 사용자 중 두 번째 사용으로 이어지지 않은 흐름 3개를 정리.",
                rationale: "반복 사용이 막혀 있습니다. 새 유입보다 다시 돌아오지 않는 이유를 먼저 봐야 합니다.",
                metaLine: "사용자 확인 필요",
                attributedSources: [.localFolder, .posthog]
            )
        }

        // Fallback — no rule matched (empty scan + no bottleneck answer)
        return IntakeV2Decision(
            category: .fallback,
            priority: .low,
            taskID: makeID("fb"),
            body: "오늘 5분 동안 어제 만든 것·막힌 것·배운 것을 한 문장씩 메모.",
            rationale: "기록이 부족합니다. 컨텍스트가 쌓이면 더 정확한 결정을 만들 수 있어요.",
            metaLine: "코퍼스 없음",
            attributedSources: []
        )
    }

    /// Make decision when scan completely failed (D3 design — graceful fallback).
    /// Used by readyAnalyze when sidecar scan errors or permission denied — template-only Decide.
    func fallbackTemplate(intake: IntakeSnapshot) -> IntakeV2Decision {
        // Force empty scan path through main generate() so the same rules cover bottleneck mapping.
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
        if intake.focusArea == .productPlanning {
            sources.append(.notion)
        }
        return sources
    }
}
