import Foundation
import Testing
@testable import agentic30

/// Stage-5 state-machine trigger covers two surfaces:
///   1. `AgenticViewModel.foundationFirstPromptKey(...)` — richness suffix
///      lets a richer payload bypass the pending/injected guard.
///   2. `WorkspaceDay1Mapper.richnessScore(...)` — strictly monotonic in the
///      signals the trigger reads, so a Day-1 refresh truly reflects "more
///      data arrived" rather than just "another event fired".
struct Day1TriggerStateMachineTests {
    @MainActor @Test func keyWithoutRichnessMatchesLegacyShape() {
        let key = AgenticViewModel.foundationFirstPromptKey(sessionId: "s1", day: 1)
        #expect(key == "s1:day-1")
    }

    @MainActor @Test func keyWithRichnessGetsBucketSuffix() {
        let key = AgenticViewModel.foundationFirstPromptKey(sessionId: "s1", day: 1, richnessBucket: 50)
        #expect(key == "s1:day-1:rich-50")
    }

    @MainActor @Test func differentRichnessBucketsProduceDistinctKeys() {
        let lo = AgenticViewModel.foundationFirstPromptKey(sessionId: "s1", day: 1, richnessBucket: 25)
        let hi = AgenticViewModel.foundationFirstPromptKey(sessionId: "s1", day: 1, richnessBucket: 100)
        #expect(lo != hi)
    }

    @MainActor @Test func richnessScoreIsZeroForEmptyInputs() {
        let score = WorkspaceDay1Mapper.richnessScore(scanResult: nil, composedOpening: nil)
        #expect(score == 0)
    }

    @MainActor @Test func composedOpeningOutweighsContext() {
        let context = makeContext(
            foundDocCount: 3,
            localDiscovery: makeLocalDiscovery(commits: 7)
        )
        let scan = makeScanResult(context)
        let withoutComposed = WorkspaceDay1Mapper.richnessScore(scanResult: scan, composedOpening: nil)
        let composed = ComposedDay1Opening(
            schemaVersion: 1, yesterday: "y", today: "t", question: "q",
            confidence: 0.8, source: "llm", fellBackToDeterministic: false, webUsed: false
        )
        let withComposed = WorkspaceDay1Mapper.richnessScore(scanResult: scan, composedOpening: composed)
        #expect(withComposed > withoutComposed + 50)
    }

    @MainActor @Test func deterministicFallbackComposedDoesNotInflateScore() {
        let scan = makeScanResult(makeContext(foundDocCount: 0))
        let baseline = WorkspaceDay1Mapper.richnessScore(scanResult: scan, composedOpening: nil)
        let fallbackComposed = ComposedDay1Opening(
            schemaVersion: 1, yesterday: "y", today: "t", question: "q",
            confidence: 0.0, source: "deterministic", fellBackToDeterministic: true, webUsed: false
        )
        let withFallback = WorkspaceDay1Mapper.richnessScore(scanResult: scan, composedOpening: fallbackComposed)
        #expect(withFallback == baseline)
    }

    @MainActor @Test func mapperPicksComposedOpenerWhenItIsHonestLLM() {
        let context = makeContext(foundDocCount: 1)
        let scan = makeScanResult(context)
        let composed = ComposedDay1Opening(
            schemaVersion: 1,
            yesterday: "agent says yesterday",
            today: "agent says today",
            question: "agent says question",
            confidence: 0.7, source: "llm",
            fellBackToDeterministic: false, webUsed: false
        )
        let vars = WorkspaceDay1Mapper.dynamicVariables(
            scanResult: scan,
            composedOpening: composed,
            onboarding: nil
        )
        #expect(vars["day1_yesterday"] == "agent says yesterday")
        #expect(vars["day1_today"] == "agent says today")
        #expect(vars["day1_question"] == "agent says question")
    }

    // PR2 (P1a): integration tests on handleFoundationFirstPromptEvent — a
    // richer Day 1 payload must replace an already-injected deterministic
    // opener (same messageId), while same/lower richness is a no-op.

    private func decodeFoundationFirstPromptEvent(text: String, richnessBucket: Int) throws -> SidecarEvent {
        let payload = """
        {
          "type": "foundation_first_prompt",
          "sessionId": "s-day1-richness",
          "day": 1,
          "richnessBucket": \(richnessBucket),
          "firstPrompt": {
            "day": 1,
            "persona": "test",
            "template": "3-section minimal",
            "yesterday": "\(text)-y",
            "today": "\(text)-t",
            "question": "\(text)-q",
            "core_question": "k",
            "spec_version": "v0",
            "sub_workflow": "office-hours-docs",
            "artifacts": [],
            "value_contract": null,
            "text": "어제: \(text)-y\\n오늘: \(text)-t\\nQ: \(text)-q"
          }
        }
        """
        let decoder = JSONDecoder()
        return try decoder.decode(SidecarEvent.self, from: Data(payload.utf8))
    }

    private func makeDay1Session() -> ChatSession {
        ChatSession(
            id: "s-day1-richness", title: "Day1 test", provider: .codex,
            model: AgentModelCatalog.defaultModelID(for: .codex),
            status: .idle, createdAt: Date(), updatedAt: Date(),
            error: nil, messages: [], pendingUserInput: nil, runtime: nil
        )
    }

    @MainActor @Test func higherRichnessBucketReplacesEarlierInject() throws {
        let vm = AgenticViewModel(activateAppForAuth: {})
        vm.replaceSessionsForTesting([makeDay1Session()])
        let bucket50 = try decodeFoundationFirstPromptEvent(text: "first", richnessBucket: 50)
        vm.handleFoundationFirstPromptEvent(bucket50)
        let firstCount = vm.sessions.first?.messages.count ?? 0
        let firstText = vm.sessions.first?.messages.first?.content ?? ""
        #expect(firstCount == 1)
        #expect(firstText.contains("first-y"))

        let bucket100 = try decodeFoundationFirstPromptEvent(text: "richer", richnessBucket: 100)
        vm.handleFoundationFirstPromptEvent(bucket100)
        let afterCount = vm.sessions.first?.messages.count ?? 0
        let afterText = vm.sessions.first?.messages.first?.content ?? ""
        // Same messageId reused (no duplicate) but content swapped.
        #expect(afterCount == 1)
        #expect(afterText.contains("richer-y"))
    }

    @MainActor @Test func sameOrLowerBucketDoesNotReplace() throws {
        let vm = AgenticViewModel(activateAppForAuth: {})
        vm.replaceSessionsForTesting([makeDay1Session()])
        let bucket75 = try decodeFoundationFirstPromptEvent(text: "first", richnessBucket: 75)
        vm.handleFoundationFirstPromptEvent(bucket75)
        #expect(vm.sessions.first?.messages.first?.content.contains("first-y") == true)

        // Same bucket: ignored.
        let bucket75Again = try decodeFoundationFirstPromptEvent(text: "same", richnessBucket: 75)
        vm.handleFoundationFirstPromptEvent(bucket75Again)
        #expect(vm.sessions.first?.messages.first?.content.contains("first-y") == true)

        // Lower bucket: ignored.
        let bucket50 = try decodeFoundationFirstPromptEvent(text: "lower", richnessBucket: 50)
        vm.handleFoundationFirstPromptEvent(bucket50)
        #expect(vm.sessions.first?.messages.first?.content.contains("first-y") == true)
        #expect(vm.sessions.first?.messages.count == 1)
    }

    @MainActor @Test func richnessBucketDecodesFromSidecarPayload() throws {
        let payload = """
        {
          "type": "foundation_first_prompt",
          "sessionId": "s",
          "day": 1,
          "richnessBucket": 125
        }
        """
        let event = try JSONDecoder().decode(SidecarEvent.self, from: Data(payload.utf8))
        #expect(event.richnessBucket == 125)
    }

    @MainActor @Test func mapperIgnoresComposedFallbackInFavorOfDeterministicMapper() {
        let context = makeContext(
            foundDocCount: 0,
            localDiscovery: makeLocalDiscovery(commits: 12)
        )
        let scan = makeScanResult(context)
        let composedFallback = ComposedDay1Opening(
            schemaVersion: 1,
            yesterday: "stale fallback yesterday",
            today: "stale fallback today",
            question: "stale fallback question",
            confidence: 0.0, source: "deterministic",
            fellBackToDeterministic: true, webUsed: false
        )
        let vars = WorkspaceDay1Mapper.dynamicVariables(
            scanResult: scan,
            composedOpening: composedFallback,
            onboarding: nil
        )
        // Falls through to the deterministic mapper, which produces the
        // "12커밋 / ICP·SPEC 비어 있어" message — not the composer's stale fallback.
        #expect(vars["day1_yesterday"]?.contains("12커밋") == true)
        #expect(vars["day1_yesterday"] != "stale fallback yesterday")
    }

    // MARK: - fixtures

    private func makeContext(
        foundDocCount: Int = 0,
        missingExpectedDocs: [String]? = ["icp", "spec"],
        suggestedFirstQuestion: String? = nil,
        localDiscovery: WorkspaceLocalDiscovery? = nil
    ) -> WorkspaceDay1Context {
        WorkspaceDay1Context(
            schemaVersion: 1,
            sourceScanRoot: "/tmp/x",
            confidence: nil, productName: nil, targetUser: nil, problem: nil,
            suggestedFirstQuestion: suggestedFirstQuestion,
            foundDocCount: foundDocCount,
            missingExpectedDocs: missingExpectedDocs,
            localDiscovery: localDiscovery
        )
    }

    private func makeLocalDiscovery(commits: Int) -> WorkspaceLocalDiscovery {
        WorkspaceLocalDiscovery(
            schemaVersion: 1,
            git: WorkspaceGitSummary(
                isGitRepo: true, firstCommitAt: "2026-04-01T00:00:00Z",
                last7DaysCommitCount: commits, dirty: false, branch: "main"
            ),
            project: WorkspaceProjectShape(stacks: ["node"], hasReadme: true, manifestPaths: ["package.json"]),
            runway: WorkspaceRunwayHints(projectAgeDays: 45, recentlyActive: commits > 0)
        )
    }

    private func makeScanResult(_ context: WorkspaceDay1Context) -> AgenticViewModel.WorkspaceScanResult {
        AgenticViewModel.WorkspaceScanResult(
            icp: nil, spec: nil, values: nil, designSystem: nil, adr: nil,
            goal: nil, docs: nil, sheet: nil,
            onboardingHypothesis: nil, day1Context: context, error: nil
        )
    }
}
