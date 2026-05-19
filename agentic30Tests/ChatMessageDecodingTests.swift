import Foundation
import Testing
@testable import agentic30

struct ChatMessageDecodingTests {
    private static func makeDecoder() -> JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }

    private static func makeEncoder() -> JSONEncoder {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        return encoder
    }

    /// Backward compatibility: ChatMessage JSON written before the
    /// inlineDecision channel existed must decode cleanly with
    /// `inlineDecision == nil`. The default value on the struct field is what
    /// makes this work — it lets Swift's synthesized Codable treat the missing
    /// key as an absent optional rather than a decode error.
    @MainActor @Test func decodesLegacyMessageWithoutInlineDecision() throws {
        let payload = """
        {
          "id": "msg-1",
          "role": "assistant",
          "provider": "codex",
          "content": "OK",
          "state": "final",
          "createdAt": "2026-04-08T16:01:24.737Z",
          "error": null
        }
        """.data(using: .utf8)!

        let message = try Self.makeDecoder().decode(ChatMessage.self, from: payload)
        #expect(message.id == "msg-1")
        #expect(message.role == .assistant)
        #expect(message.inlineDecision == nil)
        #expect(message.bipMissionChoices == nil)
        #expect(message.providerAuthActions == nil)
    }

    /// Forward path: when sidecar emits an inlineDecision payload, the SwiftUI
    /// client surfaces it as a populated `StructuredPromptQuestion`.
    @MainActor @Test func decodesMessageWithInlineDecision() throws {
        let payload = """
        {
          "id": "msg-2",
          "role": "assistant",
          "provider": "codex",
          "content": "전략 문서의 용도는 무엇인가요?",
          "state": "final",
          "createdAt": "2026-04-29T01:30:00.000Z",
          "error": null,
          "inlineDecision": {
            "header": "전략 문서 용도",
            "question": "전략 문서의 용도는 무엇인가요?",
            "helperText": null,
            "options": [
              { "label": "내부 의사결정용 요약본", "description": "팀 내부 결정용", "preview": null, "nextIntent": null },
              { "label": "외부 공유/피칭용 전략 문서", "description": "투자자/파트너용", "preview": null, "nextIntent": null }
            ],
            "multiSelect": false,
            "allowFreeText": false,
            "freeTextPlaceholder": null,
            "textMode": "short"
          }
        }
        """.data(using: .utf8)!

        let message = try Self.makeDecoder().decode(ChatMessage.self, from: payload)
        let decision = try #require(message.inlineDecision)
        #expect(decision.header == "전략 문서 용도")
        #expect(decision.question == "전략 문서의 용도는 무엇인가요?")
        #expect(decision.options?.count == 2)
        #expect(decision.options?.first?.label == "내부 의사결정용 요약본")
        #expect(decision.multiSelect == false)
        #expect(decision.allowFreeText == false)
        #expect(decision.textMode == .short)
    }

    /// Free-text-only payload: a question with no options but allowFreeText=true.
    /// Verifies the SwiftUI side accepts the same shape sidecar's
    /// validateInlineDecision emits for open-ended questions.
    @MainActor @Test func decodesFreeTextOnlyInlineDecision() throws {
        let payload = """
        {
          "id": "msg-3",
          "role": "assistant",
          "provider": "claude",
          "content": "직접 입력해 주세요",
          "state": "final",
          "createdAt": "2026-04-29T01:30:00.000Z",
          "error": null,
          "inlineDecision": {
            "header": "",
            "question": "직접 입력해 주세요",
            "helperText": null,
            "options": null,
            "multiSelect": false,
            "allowFreeText": true,
            "freeTextPlaceholder": "여기에 입력",
            "textMode": "long"
          }
        }
        """.data(using: .utf8)!

        let message = try Self.makeDecoder().decode(ChatMessage.self, from: payload)
        let decision = try #require(message.inlineDecision)
        #expect(decision.options == nil)
        #expect(decision.allowFreeText == true)
        #expect(decision.freeTextPlaceholder == "여기에 입력")
        #expect(decision.textMode == .long)
    }

    /// Encode → decode round trip preserves the inlineDecision contract.
    /// This is the contract that lets the sidecar and the mac client agree on
    /// the JSON shape across the SSE boundary.
    @MainActor @Test func roundTripsInlineDecision() throws {
        let question = StructuredPromptQuestion(
            header: "Pick",
            question: "Which one?",
            helperText: nil,
            options: [
                StructuredPromptOption(label: "A", description: "alpha", preview: nil, nextIntent: nil),
                StructuredPromptOption(label: "B", description: "beta", preview: nil, nextIntent: nil),
            ],
            multiSelect: false,
            allowFreeText: false,
            requiresFreeText: nil,
            freeTextPlaceholder: nil,
            textMode: .short
        )
        let original = ChatMessage(
            id: "msg-rt",
            role: .assistant,
            provider: .codex,
            content: "Pick one",
            state: .final,
            createdAt: Date(timeIntervalSince1970: 1_700_000_000),
            inlineDecision: question
        )

        let data = try Self.makeEncoder().encode(original)
        let decoded = try Self.makeDecoder().decode(ChatMessage.self, from: data)

        let decision = try #require(decoded.inlineDecision)
        #expect(decision.question == "Which one?")
        #expect(decision.options?.count == 2)
        #expect(decision.options?[1].label == "B")
        #expect(decoded.id == original.id)
        #expect(decoded.bipMissionChoices == nil)
        #expect(decoded.providerAuthActions == nil)
    }

    /// Malformed inline decision (missing required `question` field) must
    /// surface as a decoding error so the SSE layer can decide how to recover.
    /// The sidecar already drops invalid payloads before they cross the wire,
    /// so this path only triggers on unexpected upstream changes.
    @MainActor @Test func malformedInlineDecisionThrows() throws {
        let payload = """
        {
          "id": "msg-bad",
          "role": "assistant",
          "provider": "codex",
          "content": "Hi",
          "state": "final",
          "createdAt": "2026-04-08T16:01:24.737Z",
          "error": null,
          "inlineDecision": {
            "header": "Missing question on purpose"
          }
        }
        """.data(using: .utf8)!

        let decoder = Self.makeDecoder()
        #expect(throws: DecodingError.self) {
            _ = try decoder.decode(ChatMessage.self, from: payload)
        }
    }

    @MainActor @Test func structuredPromptQuestionRequiresFreeTextEvenWithSelection() throws {
        let payload = """
        {
          "id": "msg-requires-free-text",
          "role": "assistant",
          "provider": "codex",
          "content": "한 줄 근거를 입력해 주세요",
          "state": "final",
          "createdAt": "2026-04-29T01:30:00.000Z",
          "error": null,
          "inlineDecision": {
            "header": "근거 보완",
            "question": "VALUES를 쓸 수 있게 이 빠진 근거를 한 줄로 보완해주세요.",
            "helperText": "Ambiguity 65% · 목표 20% 이하",
            "options": [
              { "label": "리스크/실패 조건으로 보완", "description": "틀렸을 때 무엇을 실패로 볼지 적습니다.", "preview": null, "nextIntent": "tradeoff" }
            ],
            "multiSelect": false,
            "allowFreeText": true,
            "requiresFreeText": true,
            "freeTextPlaceholder": "예: 이번 주 확인 가능한 실패 조건",
            "textMode": "short"
          }
        }
        """.data(using: .utf8)!

        let message = try Self.makeDecoder().decode(ChatMessage.self, from: payload)
        let question = try #require(message.inlineDecision)

        #expect(question.requiresFreeText == true)
        #expect(question.isSatisfied(selectedOptions: [], freeText: "") == false)
        #expect(question.isSatisfied(selectedOptions: ["리스크/실패 조건으로 보완"], freeText: "") == false)
        #expect(question.isSatisfied(selectedOptions: ["리스크/실패 조건으로 보완"], freeText: "5명 중 0명이 과거 행동을 말하지 못하면 ICP를 다시 좁힌다") == true)
    }

    @MainActor @Test func structuredPromptQuestionDecodesStableQuestionIdentity() throws {
        let payload = """
        {
          "header": "ICP",
          "question_id": "day1-question-1",
          "question": "누구를 인터뷰하나요?",
          "helperText": null,
          "options": null,
          "multiSelect": false,
          "allowFreeText": true,
          "freeTextPlaceholder": "직접 입력",
          "textMode": "short"
        }
        """.data(using: .utf8)!

        let question = try Self.makeDecoder().decode(StructuredPromptQuestion.self, from: payload)
        #expect(question.id == "day1-question-1")
        #expect(question.question == "누구를 인터뷰하나요?")
    }
}
