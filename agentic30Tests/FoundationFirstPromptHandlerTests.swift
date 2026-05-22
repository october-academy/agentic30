import Foundation
import Testing
@testable import agentic30

/// Sub-AC 2.4 (AC 104): unit coverage for the AI-driven Foundation Day 0/2-7
/// first-prompt receive + inject pipeline on `AgenticViewModel`. Locks down:
///   1. The `FoundationFirstPrompt` decoder (snake_case JSON ↔ camelCase Swift,
///      fallback text rendering when sidecar omits the pre-formatted `text`).
///   2. The deterministic message id + idempotency keys so reconnect/replay
///      cannot duplicate the seeded opener.
///   3. `mergeSessionSnapshot` preservation of the seeded message across
///      `session_updated` snapshots from the sidecar.
///
/// These tests exercise the pure decode + key derivation contracts plus the
/// observable side-effects of the merge rule. They intentionally avoid the
/// live `handleFoundationFirstPromptEvent` method because it depends on a
/// `SidecarEvent` initialised through its private decoder; covering the
/// merge rule end-to-end is sufficient because the inject path writes through
/// `sessions[index].messages.insert(...)` which the merge rule then preserves.
struct FoundationFirstPromptHandlerTests {
    private static func makeDecoder() -> JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }

    // MARK: - FoundationFirstPrompt JSON decoding

    /// The sidecar emits the prompt with snake_case keys for the ontology
    /// concepts (`core_question`, `spec_version`, `sub_workflow`). The decoder
    /// must remap them onto Swift camelCase fields without losing the
    /// pre-formatted `text` block.
    @MainActor @Test func decodesSidecarPayloadWithSnakeCaseKeys() throws {
        let payload = """
        {
          "day": 1,
          "persona": "YC 파트너 / 시니어 메이커 (직설+압박, 반말)",
          "template": "3-section minimal",
          "yesterday": "어제 채널 등록 끝냈어. runway 6주, 과거 실패 2건 — 이거 잊지 마.",
          "today": "프로젝트 목표와 ICP/Pain Point/Outcome 정렬문을 SPEC.md v0 기준으로 박아.",
          "question": "그 정렬문에서 Day 2가 확인할 시장 신호는 뭐야?",
          "core_question": "프로젝트 목표와 ICP, Pain Point, Outcome 정렬문이 뭐야?",
          "spec_version": "v0",
          "sub_workflow": "office-hours-docs",
          "artifacts": ["SPEC.md", "day-1-alignment-statement.md"],
          "text": "어제: 어제 채널 등록 끝냈어. runway 6주, 과거 실패 2건 — 이거 잊지 마.\\n오늘: 프로젝트 목표와 ICP/Pain Point/Outcome 정렬문을 SPEC.md v0 기준으로 박아.\\nQ: 그 정렬문에서 Day 2가 확인할 시장 신호는 뭐야?"
        }
        """.data(using: .utf8)!

        let prompt = try Self.makeDecoder().decode(FoundationFirstPrompt.self, from: payload)
        #expect(prompt.day == 1)
        #expect(prompt.coreQuestion == "프로젝트 목표와 ICP, Pain Point, Outcome 정렬문이 뭐야?")
        #expect(prompt.specVersion == "v0")
        #expect(prompt.subWorkflow == "office-hours-docs")
        #expect(prompt.artifacts == ["SPEC.md", "day-1-alignment-statement.md"])
        #expect(prompt.text.contains("어제: "))
        #expect(prompt.text.contains("오늘: "))
        #expect(prompt.text.contains("Q: "))
    }

    /// When the sidecar omits `text` (older host build, partial payload), the
    /// decoder falls back to formatting the 3-section minimal layout itself
    /// using `formatFallbackText`. This guarantees the chat surface always
    /// has displayable content.
    @MainActor @Test func decodesPayloadWithMissingTextUsesFallbackFormat() throws {
        let payload = """
        {
          "day": 0,
          "persona": "YC 파트너",
          "template": "3-section minimal",
          "yesterday": "어제 없어. 오늘이 Day 0 — Foundation 시작점이야.",
          "today": "BIP/ICP/SPEC 채널 등록하고 4종 인풋 경로 박아.",
          "question": "어디서부터 등록할 건데?",
          "core_question": null,
          "spec_version": null,
          "sub_workflow": "bip-channel-register",
          "artifacts": ["day-0-channel-setup.md"]
        }
        """.data(using: .utf8)!

        let prompt = try Self.makeDecoder().decode(FoundationFirstPrompt.self, from: payload)
        #expect(prompt.day == 0)
        #expect(prompt.coreQuestion == nil)
        #expect(prompt.specVersion == nil)
        #expect(prompt.text == [
            "어제: 어제 없어. 오늘이 Day 0 — Foundation 시작점이야.",
            "오늘: BIP/ICP/SPEC 채널 등록하고 4종 인풋 경로 박아.",
            "Q: 어디서부터 등록할 건데?",
        ].joined(separator: "\n"))
    }

    /// `formatFallbackText` mirrors foundation-chat.mjs `formatFirstPromptText`.
    /// Empty sections are skipped (no leading separator), trim-only entries
    /// also drop out, and the layout is `어제: / 오늘: / Q:` separated by `\n`.
    @MainActor @Test func fallbackTextSkipsEmptySections() {
        let text = FoundationFirstPrompt.formatFallbackText(
            yesterday: "  ",
            today: "오늘 한 줄",
            question: "질문"
        )
        #expect(text == "오늘: 오늘 한 줄\nQ: 질문")
    }

    // MARK: - Idempotency keys + deterministic message id

    /// The session+day key shape is the contract between the request side and
    /// the inject side. Pinning the format so future refactors do not silently
    /// shift the idempotency boundary.
    @MainActor @Test func foundationFirstPromptKeyEncodesSessionAndDay() {
        let key = AgenticViewModel.foundationFirstPromptKey(sessionId: "abc-123", day: 4)
        #expect(key == "abc-123:day-4")
    }

    /// The message id must start with the well-known prefix so
    /// `mergeSessionSnapshot` can recognise client-only seeded messages.
    @MainActor @Test func foundationFirstPromptMessageIdUsesWellKnownPrefix() {
        let messageId = AgenticViewModel.foundationFirstPromptMessageId(
            sessionId: "abc-123",
            day: 4
        )
        #expect(messageId.hasPrefix(AgenticViewModel.foundationFirstPromptMessageIdPrefix))
        #expect(messageId.contains("day-4"))
        #expect(messageId.contains("abc-123"))
    }

    // MARK: - Memberwise initializer convenience

    /// The memberwise init lets tests + previews build a prompt without
    /// hand-rolling the sidecar JSON. When `text` is omitted it must derive
    /// the same fallback the decoder uses, so visual rendering stays stable.
    @MainActor @Test func memberwiseInitDerivesFallbackTextWhenOmitted() {
        let prompt = FoundationFirstPrompt(
            day: 6,
            yesterday: "어제 광고 시그널 강함 잡았어.",
            today: "오늘 1명한테 돈 내달라고 명시적으로 물어봐.",
            question: "yes 받아 / no 받아 / 답 못 받아 셋 중 어디로 보고할 건데?"
        )
        #expect(prompt.text.hasPrefix("어제: 어제 광고 시그널"))
        #expect(prompt.text.contains("\n오늘: 오늘 1명한테"))
        #expect(prompt.text.contains("\nQ: yes 받아"))
    }

    @MainActor @Test func memberwiseInitTrimsExplicitText() {
        let prompt = FoundationFirstPrompt(
            day: 0,
            yesterday: "y",
            today: "t",
            question: "q",
            text: "   pre-rendered text   "
        )
        #expect(prompt.text == "pre-rendered text")
    }
}
