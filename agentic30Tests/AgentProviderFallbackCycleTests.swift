import XCTest
@testable import agentic30

final class AgentProviderFallbackCycleTests: XCTestCase {
    func testCycleOrderIsCodexClaudeGemini() {
        XCTAssertEqual(AgentProvider.fallbackCycle, [.codex, .claude, .gemini])
    }

    func testNextProviderFollowsCycleWhenAllAvailable() {
        XCTAssertEqual(AgentProvider.codex.nextFallbackProvider { _ in true }, .claude)
        XCTAssertEqual(AgentProvider.claude.nextFallbackProvider { _ in true }, .gemini)
        XCTAssertEqual(AgentProvider.gemini.nextFallbackProvider { _ in true }, .codex)
    }

    func testSkipsUnavailableProvider() {
        // Codex fails, Claude not connected → lands on Gemini.
        let next = AgentProvider.codex.nextFallbackProvider { $0 != .claude }
        XCTAssertEqual(next, .gemini)
    }

    func testReturnsNilWhenNoOtherProviderAvailable() {
        XCTAssertNil(AgentProvider.codex.nextFallbackProvider { _ in false })
        // Only the failed provider itself is "available" — self is never offered.
        XCTAssertNil(AgentProvider.codex.nextFallbackProvider { $0 == .codex })
    }
}
