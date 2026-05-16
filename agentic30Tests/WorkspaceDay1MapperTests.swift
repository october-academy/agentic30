import Foundation
import Testing
@testable import agentic30

struct WorkspaceDay1MapperTests {
    private static func makeContext(
        scanRoot: String = "/tmp/x",
        confidence: String? = nil,
        productName: String? = nil,
        targetUser: String? = nil,
        problem: String? = nil,
        suggestedFirstQuestion: String? = nil,
        foundDocCount: Int? = 0,
        missingExpectedDocs: [String]? = ["icp", "spec", "goal", "values"],
        localDiscovery: WorkspaceLocalDiscovery? = nil
    ) -> WorkspaceDay1Context {
        WorkspaceDay1Context(
            schemaVersion: 1,
            sourceScanRoot: scanRoot,
            confidence: confidence,
            productName: productName,
            targetUser: targetUser,
            problem: problem,
            suggestedFirstQuestion: suggestedFirstQuestion,
            foundDocCount: foundDocCount,
            missingExpectedDocs: missingExpectedDocs,
            localDiscovery: localDiscovery
        )
    }

    private static func makeScanResult(_ context: WorkspaceDay1Context) -> AgenticViewModel.WorkspaceScanResult {
        AgenticViewModel.WorkspaceScanResult(
            icp: nil,
            spec: nil,
            values: nil,
            designSystem: nil,
            adr: nil,
            goal: nil,
            docs: nil,
            sheet: nil,
            onboardingHypothesis: nil,
            day1Context: context,
            error: nil
        )
    }

    private static func makeOnboarding(
        role: OnboardingRole = .developer,
        stage: OnboardingProjectStage = .building
    ) -> OnboardingContext {
        OnboardingContext(
            workMode: .fullTimeSolo,
            role: role,
            projectStage: stage,
            isolationLevel: .projectFolder,
            isolationLevels: nil,
            completedAt: "2026-05-15T00:00:00Z"
        )
    }

    @MainActor @Test func mapperReturnsEmptyWhenScanResultMissing() {
        let vars = WorkspaceDay1Mapper.dynamicVariables(scanResult: nil)
        #expect(vars.isEmpty)
    }

    @MainActor @Test func mapperReturnsEmptyWhenDay1ContextMissing() {
        let scan = AgenticViewModel.WorkspaceScanResult(
            icp: nil, spec: nil, values: nil, designSystem: nil, adr: nil,
            goal: nil, docs: nil, sheet: nil,
            onboardingHypothesis: nil, day1Context: nil, error: nil
        )
        let vars = WorkspaceDay1Mapper.dynamicVariables(scanResult: scan)
        #expect(vars.isEmpty)
    }

    @MainActor @Test func nonGitFolderReportsCleanSlateInYesterday() {
        let context = Self.makeContext(
            localDiscovery: WorkspaceLocalDiscovery(
                schemaVersion: 1,
                git: WorkspaceGitSummary(isGitRepo: false, firstCommitAt: nil, last7DaysCommitCount: 0, dirty: nil, branch: nil),
                project: WorkspaceProjectShape(stacks: [], hasReadme: false, manifestPaths: []),
                runway: WorkspaceRunwayHints(projectAgeDays: nil, recentlyActive: nil)
            )
        )
        let vars = WorkspaceDay1Mapper.dynamicVariables(scanResult: Self.makeScanResult(context))
        #expect(vars["day1_yesterday"]?.contains("git") == true)
    }

    @MainActor @Test func codingWithoutDocsCallsOutTheTrap() {
        let context = Self.makeContext(
            foundDocCount: 0,
            missingExpectedDocs: ["icp", "spec", "goal"],
            localDiscovery: WorkspaceLocalDiscovery(
                schemaVersion: 1,
                git: WorkspaceGitSummary(isGitRepo: true, firstCommitAt: "2026-04-01T00:00:00Z", last7DaysCommitCount: 12, dirty: false, branch: "main"),
                project: WorkspaceProjectShape(stacks: ["node"], hasReadme: true, manifestPaths: ["package.json"]),
                runway: WorkspaceRunwayHints(projectAgeDays: 45, recentlyActive: true)
            )
        )
        let vars = WorkspaceDay1Mapper.dynamicVariables(scanResult: Self.makeScanResult(context))
        let yesterday = vars["day1_yesterday"] ?? ""
        #expect(yesterday.contains("12커밋"))
        #expect(yesterday.contains("ICP·SPEC"))
    }

    @MainActor @Test func docsAndActivityShifts_to_painNarrowing() {
        let context = Self.makeContext(
            foundDocCount: 3,
            missingExpectedDocs: ["values"],
            localDiscovery: WorkspaceLocalDiscovery(
                schemaVersion: 1,
                git: WorkspaceGitSummary(isGitRepo: true, firstCommitAt: "2026-04-01T00:00:00Z", last7DaysCommitCount: 7, dirty: false, branch: "main"),
                project: WorkspaceProjectShape(stacks: ["node"], hasReadme: true, manifestPaths: ["package.json"]),
                runway: WorkspaceRunwayHints(projectAgeDays: 45, recentlyActive: true)
            )
        )
        let vars = WorkspaceDay1Mapper.dynamicVariables(scanResult: Self.makeScanResult(context))
        #expect(vars["day1_yesterday"]?.contains("통증 1개로 좁힐") == true)
    }

    @MainActor @Test func coldProjectGetsRekindleNudge() {
        let context = Self.makeContext(
            foundDocCount: 1,
            missingExpectedDocs: ["spec", "goal"],
            localDiscovery: WorkspaceLocalDiscovery(
                schemaVersion: 1,
                git: WorkspaceGitSummary(isGitRepo: true, firstCommitAt: "2026-03-01T00:00:00Z", last7DaysCommitCount: 0, dirty: false, branch: "main"),
                project: WorkspaceProjectShape(stacks: ["node"], hasReadme: true, manifestPaths: ["package.json"]),
                runway: WorkspaceRunwayHints(projectAgeDays: 75, recentlyActive: false)
            )
        )
        let vars = WorkspaceDay1Mapper.dynamicVariables(scanResult: Self.makeScanResult(context))
        #expect(vars["day1_yesterday"]?.contains("식어가는") == true)
    }

    @MainActor @Test func suggestedFirstQuestionWinsOverRoleDefault() {
        let suggestion = "이번 주 인터뷰할 첫 고객은 누구인가요?"
        let context = Self.makeContext(suggestedFirstQuestion: suggestion)
        let vars = WorkspaceDay1Mapper.dynamicVariables(
            scanResult: Self.makeScanResult(context),
            onboarding: Self.makeOnboarding(role: .developer)
        )
        #expect(vars["day1_question"] == suggestion)
    }

    @MainActor @Test func roleSteersTheQuestionWhenNoSuggestionExists() {
        let context = Self.makeContext()
        let dev = WorkspaceDay1Mapper.dynamicVariables(
            scanResult: Self.makeScanResult(context),
            onboarding: Self.makeOnboarding(role: .developer)
        )
        let pm = WorkspaceDay1Mapper.dynamicVariables(
            scanResult: Self.makeScanResult(context),
            onboarding: Self.makeOnboarding(role: .productManager)
        )
        #expect(dev["day1_question"]?.contains("개발자 시각 말고") == true)
        #expect(pm["day1_question"]?.contains("사용자 행동") == true)
    }

    // PR4: new edge-case branches.
    @MainActor @Test func dirtyWorktreeWithZeroCommitsTriggersChunkingNudge() {
        let context = Self.makeContext(
            localDiscovery: WorkspaceLocalDiscovery(
                schemaVersion: 1,
                git: WorkspaceGitSummary(
                    isGitRepo: true, head: "abcd", firstCommitAt: "2026-04-01T00:00:00Z",
                    last7DaysCommitCount: 0, dirty: true, branch: "main"
                ),
                project: WorkspaceProjectShape(stacks: ["node"], hasReadme: true, manifestPaths: ["package.json"]),
                runway: WorkspaceRunwayHints(projectAgeDays: 10, recentlyActive: false)
            )
        )
        let vars = WorkspaceDay1Mapper.dynamicVariables(scanResult: Self.makeScanResult(context))
        #expect(vars["day1_yesterday"]?.contains("쪼개서 올려") == true)
    }

    @MainActor @Test func vibeCodingFolderGetsStructureNudge() {
        let context = Self.makeContext(
            foundDocCount: 0,
            missingExpectedDocs: ["icp", "spec", "goal"],
            localDiscovery: WorkspaceLocalDiscovery(
                schemaVersion: 1,
                git: WorkspaceGitSummary(
                    isGitRepo: true, head: "abcd", firstCommitAt: "2026-04-01T00:00:00Z",
                    last7DaysCommitCount: 8, dirty: false, branch: "main"
                ),
                project: WorkspaceProjectShape(stacks: [], hasReadme: false, manifestPaths: []),
                runway: WorkspaceRunwayHints(projectAgeDays: 10, recentlyActive: true)
            )
        )
        let vars = WorkspaceDay1Mapper.dynamicVariables(scanResult: Self.makeScanResult(context))
        #expect(vars["day1_yesterday"]?.contains("README") == true)
    }

    @MainActor @Test func studentRoleGetsTimeOverMoneyQuestion() {
        let context = Self.makeContext()
        let vars = WorkspaceDay1Mapper.dynamicVariables(
            scanResult: Self.makeScanResult(context),
            onboarding: Self.makeOnboarding(role: .student)
        )
        #expect(vars["day1_question"]?.contains("시간을 써서") == true)
    }

    @MainActor @Test func todayMessageBranchesOnSpecPresence() {
        let missingSpec = Self.makeContext(missingExpectedDocs: ["spec"])
        let withSpec = Self.makeContext(missingExpectedDocs: [])
        let v1 = WorkspaceDay1Mapper.dynamicVariables(scanResult: Self.makeScanResult(missingSpec))
        let v2 = WorkspaceDay1Mapper.dynamicVariables(scanResult: Self.makeScanResult(withSpec))
        #expect(v1["day1_today"]?.contains("v0를 박아") == true)
        #expect(v2["day1_today"]?.contains("기존 SPEC.md를") == true)
    }
}
