import XCTest
@testable import agentic30

final class AgentProviderFallbackCycleTests: XCTestCase {
    func testCycleOrderIsCodexClaudeGeminiCursor() {
        XCTAssertEqual(AgentProvider.fallbackCycle, [.codex, .claude, .gemini, .cursor])
    }

    func testNextProviderFollowsCycleWhenAllAvailable() {
        XCTAssertEqual(AgentProvider.codex.nextFallbackProvider { _ in true }, .claude)
        XCTAssertEqual(AgentProvider.claude.nextFallbackProvider { _ in true }, .gemini)
        XCTAssertEqual(AgentProvider.gemini.nextFallbackProvider { _ in true }, .cursor)
        XCTAssertEqual(AgentProvider.cursor.nextFallbackProvider { _ in true }, .codex)
    }

    func testSkipsUnavailableProvider() {
        // Codex fails, Claude not connected → lands on Gemini.
        let next = AgentProvider.codex.nextFallbackProvider { $0 != .claude }
        XCTAssertEqual(next, .gemini)

        // Gemini fails, Cursor not connected → wraps to Codex.
        let wrapped = AgentProvider.gemini.nextFallbackProvider { $0 != .cursor }
        XCTAssertEqual(wrapped, .codex)
    }

    func testReturnsNilWhenNoOtherProviderAvailable() {
        XCTAssertNil(AgentProvider.codex.nextFallbackProvider { _ in false })
        // Only the failed provider itself is "available" — self is never offered.
        XCTAssertNil(AgentProvider.codex.nextFallbackProvider { $0 == .codex })
    }
}
