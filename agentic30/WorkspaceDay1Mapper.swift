import Foundation

/// Stage-3 deterministic Day 1 first_prompt mapper.
///
/// Translates the sidecar's `WorkspaceDay1Context` (scan + onboarding hypothesis
/// + local-discovery git/project signals) plus the user's onboarding selections
/// into the three first_prompt body slots Day 1's template now consumes:
///   {day1_yesterday}, {day1_today}, {day1_question}
///
/// No LLM call. No I/O. Pure data → strings, so the same input always maps to
/// the same output. Stage 4 will layer an LLM composer on top that uses these
/// strings as ground truth and falls back to them on parse failure / low
/// confidence.
///
/// Tone: YC 파트너 / 시니어 메이커 (직설+압박, 반말 ~어/야).
/// Length: each line stays well under the foundation-chat sanitizer caps
/// (240/240/200) so renderTemplate never has to truncate.
enum WorkspaceDay1Mapper {
    static let dynamicVariableKeys: [String] = [
        "day1_yesterday",
        "day1_today",
        "day1_question",
    ]

    /// Compose Day 1 dynamic variables from a workspace scan result and the
    /// optional onboarding context. Returns an empty dictionary when the scan
    /// has not yet produced a `day1Context` — `buildFirstPromptForDay` then
    /// falls back to the per-day defaults already pinned in DAY_DEFAULTS.
    static func dynamicVariables(
        scanResult: AgenticViewModel.WorkspaceScanResult?,
        composedOpening: ComposedDay1Opening? = nil,
        onboarding: OnboardingContext? = nil
    ) -> [String: String] {
        // Prefer the LLM-composed opener when present and not a deterministic
        // fallback (the composer marks fellBackToDeterministic when its own
        // pipeline failed; in that case we want our own deterministic mapper
        // output, which is at least typed and onboarding-aware).
        if let composed = composedOpening,
           !composed.fellBackToDeterministic,
           composed.confidence > 0,
           !composed.yesterday.isEmpty,
           !composed.today.isEmpty,
           !composed.question.isEmpty {
            return [
                "day1_yesterday": composed.yesterday,
                "day1_today": composed.today,
                "day1_question": composed.question,
            ]
        }
        guard let context = scanResult?.day1Context else { return [:] }
        var out: [String: String] = [:]
        out["day1_yesterday"] = composeYesterday(context: context, onboarding: onboarding)
        out["day1_today"] = composeToday(context: context)
        out["day1_question"] = composeQuestion(context: context, onboarding: onboarding)
        return out
    }

    /// Stage-5 richness signal used by the trigger gate. Higher score = more
    /// reason to (re-)broadcast Day 1's first prompt because the upstream
    /// payload now carries more substance than what was sent before.
    static func richnessScore(
        scanResult: AgenticViewModel.WorkspaceScanResult?,
        composedOpening: ComposedDay1Opening?
    ) -> Int {
        var score = 0
        if let composed = composedOpening, !composed.fellBackToDeterministic, composed.confidence > 0 {
            score += 100 + Int((composed.confidence * 50).rounded())
        }
        if let context = scanResult?.day1Context {
            score += min(20, (context.foundDocCount ?? 0) * 5)
            if let local = context.localDiscovery {
                if local.git.isGitRepo { score += 5 }
                score += min(15, local.git.last7DaysCommitCount)
                if local.project.hasReadme { score += 3 }
                score += min(5, local.project.stacks.count)
            }
            if context.suggestedFirstQuestion != nil { score += 4 }
        }
        return score
    }

    // MARK: - private composers

    private static func composeYesterday(
        context: WorkspaceDay1Context,
        onboarding: OnboardingContext?
    ) -> String {
        let git = context.localDiscovery?.git
        let project = context.localDiscovery?.project
        let runway = context.localDiscovery?.runway
        let missingCore = (context.missingExpectedDocs ?? []).contains(where: { ["icp", "spec"].contains($0.lowercased()) })
        let foundCount = context.foundDocCount ?? 0
        let last7 = git?.last7DaysCommitCount ?? 0

        // 1) git not initialized → fresh slate
        if let git, !git.isGitRepo {
            return "git도 안 깔린 폴더야. 더 잃을 게 없는 게 강점이야."
        }

        // 2) PR4: dirty worktree + zero commits → maker's "messy immersion"
        //    state. Trigger before "cold project" because that branch only
        //    sees commit count and misses the dirty file pile.
        if last7 == 0, git?.dirty == true {
            return "커밋은 없는데 수정 중인 파일만 가득해. 완벽주의 버리고 일단 쪼개서 올려."
        }

        // 3) cold project — old enough but no recent commits
        if let projectAge = runway?.projectAgeDays, projectAge >= 7, last7 == 0 {
            return "최근 7일 commit 0건. 식어가는 중이야 — 다시 불 붙일 1명 찾자."
        }

        // 4) PR4: "vibe coding" — actively committing without any structure
        //    (no manifest, no README). Must trigger before the broader
        //    "building trap" branch so the message stays specific.
        if last7 > 0,
           let project,
           !project.hasReadme,
           project.manifestPaths.isEmpty {
            return "구조 없이 계속 짜고 있어. 한 줄짜리 README라도 박아 — 방향이 거기서 나와."
        }

        // 5) actively coding but no docs → classic "build first, sell later" trap
        if last7 > 0 && missingCore {
            return "최근 7일 코드 \(last7)커밋, 정작 ICP·SPEC는 비어 있어. 누구 위해 만드는지부터 적어."
        }

        // 4) docs exist + active → ready to narrow pain
        if foundCount >= 2 && last7 > 0 {
            return "ICP·SPEC 있고 최근 7일 \(last7)커밋. 이제 통증 1개로 좁힐 차례야."
        }

        // 5) only README so far — intent captured, customer not
        if (project?.hasReadme ?? false) && foundCount == 0 {
            return "README는 있는데 ICP·SPEC는 비었어. 시작 의도는 적었으면, 이제 고객을 적자."
        }

        // 6) onboarding gives stage hint when scan is silent
        if foundCount == 0 && last7 == 0, let stage = onboarding?.projectStage {
            switch stage {
            case .ideaOnly:
                return "막 시작했네. 코드 한 줄 짜기 전에 돈 낼 사람 1명부터 찾자."
            case .building:
                return "빌드 중이라 했지. 사용자 0명에서 1명으로 가는 게 가장 어려워."
            case .firstUsers:
                return "사용자는 있고 결제는 없어. 가격 묻는 걸로 이번 주 시작하자."
            case .preRevenue:
                return "가격·제안이 막혔어. 통증 1개로 좁혀야 결제 흐름이 풀려."
            case .postRevenue:
                return "이미 매출 있어. 오늘은 가장 약한 통증 1개에 집중."
            }
        }

        // 7) default — keep it honest, not invented
        return "폴더 신호가 모호해. 일단 통증 1개부터 좁히자."
    }

    private static func composeToday(context: WorkspaceDay1Context) -> String {
        let missingSpec = (context.missingExpectedDocs ?? []).map { $0.lowercased() }.contains("spec")
        if missingSpec {
            return "통증 1개로 SPEC.md v0를 박아. 통증 2개 이상이면 실패야."
        }
        return "기존 SPEC.md를 통증 1개 기준으로 다듬어. 흩어져 있으면 실패야."
    }

    private static func composeQuestion(
        context: WorkspaceDay1Context,
        onboarding: OnboardingContext?
    ) -> String {
        if let suggested = context.suggestedFirstQuestion?.trimmingCharacters(in: .whitespacesAndNewlines),
           !suggested.isEmpty {
            return suggested
        }
        switch onboarding?.role {
        case .developer:
            return "개발자 시각 말고 결제할 사람 시각으로 묻자. 어제 결제까지 갔던 사람이 누구야?"
        case .designer:
            return "디자인 통하면 누가 가장 먼저 지갑을 열어? 어제 그 사람의 행동 1개만 적어."
        case .productManager:
            return "지난 24시간 사용자 행동 중 통증을 보여준 1개만 적어. 가정 말고 행동으로."
        case .marketerBusiness:
            return "어제 응답한 사람 중 돈 낼 가능성이 가장 큰 1명 누구야? 근거 1줄."
        case .student:
            return "돈 대신 시간을 써서 이 문제를 풀려던 사람이 주변에 있어? 그 사람의 가장 처절한 행동 1개만 적어."
        default:
            return "그 통증, 어제 누가 어떤 행동으로 보여줬어? 가정 말고 행동으로."
        }
    }
}
