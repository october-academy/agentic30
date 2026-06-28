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

    /// Backward compatibility: a chat message written before the emphasis
    /// channel existed decodes cleanly with `emphasis == nil`, so the bubble
    /// renders plain text exactly as before.
    @MainActor @Test func decodesLegacyMessageWithoutEmphasis() throws {
        let payload = """
        {
          "id": "msg-noemph",
          "role": "assistant",
          "provider": "claude",
          "content": "강조 없는 평범한 응답입니다.",
          "state": "final",
          "createdAt": "2026-06-07T10:00:00.000Z",
          "error": null
        }
        """.data(using: .utf8)!

        let message = try Self.makeDecoder().decode(ChatMessage.self, from: payload)
        #expect(message.emphasis == nil)
        #expect(message.content == "강조 없는 평범한 응답입니다.")

        // The transcript row factory carries an empty emphasis list, which the
        // bubble renderer treats as the plain-text path.
        let row = try #require(OfficeHoursTranscriptRow.rows(from: [message]).first)
        #expect(row.emphasis.isEmpty)
    }

    /// Forward path: when sidecar attaches free-response emphasis spans, the
    /// SwiftUI client decodes style-aware spans and forwards them to the
    /// transcript row for inline rendering.
    @MainActor @Test func decodesMessageWithChatEmphasis() throws {
        let payload = """
        {
          "id": "msg-emph",
          "role": "assistant",
          "provider": "codex",
          "content": "오늘 마감은 6월 4일까지입니다. config.json 파일을 확인하세요.",
          "state": "final",
          "createdAt": "2026-06-07T10:01:00.000Z",
          "error": null,
          "emphasis": [
            { "phrase": "6월 4일", "style": "mark" },
            { "phrase": "config.json", "style": "code" },
            { "phrase": "오늘 마감", "style": "strong" }
          ]
        }
        """.data(using: .utf8)!

        let message = try Self.makeDecoder().decode(ChatMessage.self, from: payload)
        let emphasis = try #require(message.emphasis)
        #expect(emphasis.count == 3)
        #expect(emphasis[0] == EmphasisSpan(phrase: "6월 4일", style: .mark))
        #expect(emphasis[1] == EmphasisSpan(phrase: "config.json", style: .code))
        #expect(emphasis[2] == EmphasisSpan(phrase: "오늘 마감", style: .strong))

        let row = try #require(OfficeHoursTranscriptRow.rows(from: [message]).first)
        #expect(row.emphasis.count == 3)
        #expect(row.emphasis[1].style == .code)
    }

    /// Forward path: the Day-1 interview resume seeds restored Q/A rows with
    /// `officeHoursSeededTurn: true` so the client can tell restored history
    /// from live rows (seeded rows have no submitted-card snapshot backing
    /// them). The flag must survive decoding and reach the transcript row.
    @MainActor @Test func decodesSeededOfficeHoursTurnFlag() throws {
        let payload = """
        {
          "id": "msg-seeded",
          "role": "assistant",
          "provider": "claude",
          "content": "지금까지 나온 가장 강한 실제 신호는 무엇인가요?",
          "state": "final",
          "createdAt": "2026-06-10T01:00:00.000Z",
          "error": null,
          "officeHoursSeededTurn": true
        }
        """.data(using: .utf8)!

        let message = try Self.makeDecoder().decode(ChatMessage.self, from: payload)
        #expect(message.officeHoursSeededTurn == true)

        let row = try #require(OfficeHoursTranscriptRow.rows(from: [message]).first)
        #expect(row.isSeededInterviewTurn)
    }

    /// Backward compatibility: messages without the seeded-turn key decode
    /// with `officeHoursSeededTurn == nil` and a non-seeded transcript row.
    @MainActor @Test func decodesLegacyMessageWithoutSeededTurnFlag() throws {
        let payload = """
        {
          "id": "msg-live",
          "role": "user",
          "provider": "claude",
          "content": "답장이 왔고 현재 대안/비용을 말했다",
          "state": "final",
          "createdAt": "2026-06-10T01:01:00.000Z",
          "error": null
        }
        """.data(using: .utf8)!

        let message = try Self.makeDecoder().decode(ChatMessage.self, from: payload)
        #expect(message.officeHoursSeededTurn == nil)

        let row = try #require(OfficeHoursTranscriptRow.rows(from: [message]).first)
        #expect(!row.isSeededInterviewTurn)
    }

    /// Unknown wire styles fall back to `.mark` so a future style never breaks
    /// chat decoding.
    @MainActor @Test func decodesChatEmphasisWithUnknownStyleFallback() throws {
        let payload = """
        {
          "id": "msg-emph-unknown",
          "role": "assistant",
          "provider": "codex",
          "content": "강조 스타일 폴백 확인 문장.",
          "state": "final",
          "createdAt": "2026-06-07T10:02:00.000Z",
          "error": null,
          "emphasis": [
            { "phrase": "강조 스타일", "style": "rainbow" }
          ]
        }
        """.data(using: .utf8)!

        let message = try Self.makeDecoder().decode(ChatMessage.self, from: payload)
        let emphasis = try #require(message.emphasis)
        #expect(emphasis[0].style == .mark)
    }

    /// Encode → decode round trip preserves the chat emphasis contract across
    /// the SSE boundary.
    @MainActor @Test func roundTripsChatEmphasis() throws {
        let original = ChatMessage(
            id: "msg-emph-rt",
            role: .assistant,
            provider: .codex,
            content: "round trip with config.json highlighted",
            state: .final,
            createdAt: Date(timeIntervalSince1970: 1_700_000_500),
            emphasis: [EmphasisSpan(phrase: "config.json", style: .code)]
        )

        let data = try Self.makeEncoder().encode(original)
        let decoded = try Self.makeDecoder().decode(ChatMessage.self, from: data)

        let emphasis = try #require(decoded.emphasis)
        #expect(emphasis == [EmphasisSpan(phrase: "config.json", style: .code)])
        #expect(decoded.inlineDecision == nil)
    }

    @MainActor @Test func decodesOfficeHoursOptionDecisionBriefMetadata() throws {
        let payload = """
        {
          "header": "Observation",
          "question_id": "office_hours_observation",
          "question": "도움 없이 막히는 모습을 본 적이 있나요?",
          "helperText": null,
          "options": [
            {
              "label": "직접 관찰함",
              "description": "가장 강한 사용 증거입니다.",
              "recommended": true,
              "risk": "관찰 대상이 ICP가 아니면 판단이 흐려집니다.",
              "evidence_target": "막힌 단계와 예상 밖 행동",
              "maps_to": "Q5 Observation",
              "failure_mode": "surprise가 없으면 데모였을 수 있습니다."
            }
          ],
          "multiSelect": false,
          "allowFreeText": true,
          "requiresFreeText": false,
          "freeTextPlaceholder": "직접 입력",
          "textMode": "short"
        }
        """.data(using: .utf8)!

        let question = try Self.makeDecoder().decode(StructuredPromptQuestion.self, from: payload)
        let option = try #require(question.options?.first)

        #expect(option.recommended == true)
        #expect(option.risk == "관찰 대상이 ICP가 아니면 판단이 흐려집니다.")
        #expect(option.evidenceTarget == "막힌 단계와 예상 밖 행동")
        #expect(option.mapsTo == "Q5 Observation")
        #expect(option.failureMode == "surprise가 없으면 데모였을 수 있습니다.")
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

    @MainActor @Test func structuredPromptQuestionWithOptionsIgnoresRequiresFreeTextGate() throws {
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
        #expect(question.isSatisfied(selectedOptions: ["리스크/실패 조건으로 보완"], freeText: "") == true)
        #expect(question.isSatisfied(selectedOptions: ["리스크/실패 조건으로 보완"], freeText: "5명 중 0명이 과거 행동을 말하지 못하면 ICP를 다시 좁힌다") == true)
    }

    @MainActor @Test func structuredPromptQuestionWithRequiredPrimaryTextNeedsSelectionAndText() throws {
        let payload = """
        {
          "header": "후보 확보",
          "question_id": "get_users_first_candidate_unblock",
          "question": "아직 후보가 없다면 오늘 30분 안에 어떤 한 줄 요청을 보낼 건가요?",
          "helperText": "범주가 아니라 실행 문장을 적습니다.",
          "options": [
            { "label": "스레드/커뮤니티에서 찾기", "description": "검색어, 게시 위치, 후보 조건, 보낼 요청을 한 줄로 적습니다." }
          ],
          "multiSelect": false,
          "allowFreeText": true,
          "requiresFreeText": false,
          "freeTextPlaceholder": "예: Threads에서 검색해 DM 보낸다",
          "primaryTextInput": {
            "label": "후보 확보 행동",
            "placeholder": "시간 + 채널 + 검색어/게시 위치 + 보낼 요청",
            "required": true,
            "submitLabel": "후보 찾기 행동 확정",
            "validationMessage": "시간, 채널, 찾는 방법, 보낼 요청을 적어야 합니다."
          },
          "textMode": "short"
        }
        """.data(using: .utf8)!

        let question = try Self.makeDecoder().decode(StructuredPromptQuestion.self, from: payload)

        #expect(question.primaryTextInput?.label == "후보 확보 행동")
        #expect(question.primaryTextInput?.required == true)
        #expect(question.isSatisfied(selectedOptions: [], freeText: "") == false)
        #expect(question.isSatisfied(selectedOptions: ["스레드/커뮤니티에서 찾기"], freeText: "") == false)
        #expect(question.isSatisfied(selectedOptions: [], freeText: "오늘 18:00까지 Threads에서 검색해 DM 보낸다") == false)
        #expect(question.isSatisfied(selectedOptions: ["스레드/커뮤니티에서 찾기"], freeText: "오늘 18:00까지 Threads에서 검색해 DM 보낸다") == true)
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

    @MainActor @Test func structuredPromptQuestionDecodesOpenDesignHighlightShapes() throws {
        let stringPayload = """
        {
          "header": "질문",
          "question": "가장 강한 수요 증거가 뭐야?",
          "highlight": "수요 증거",
          "helperText": null,
          "options": null,
          "multiSelect": false,
          "allowFreeText": true,
          "freeTextPlaceholder": null,
          "textMode": "short"
        }
        """.data(using: .utf8)!
        let arrayPayload = """
        {
          "header": "질문",
          "question": "더 필수적이 돼, 아니면 덜 필수적이 돼?",
          "highlight_phrases": ["더 필수적", "덜 필수적"],
          "helperText": null,
          "options": null,
          "multiSelect": false,
          "allowFreeText": true,
          "freeTextPlaceholder": null,
          "textMode": "short"
        }
        """.data(using: .utf8)!

        let stringQuestion = try Self.makeDecoder().decode(StructuredPromptQuestion.self, from: stringPayload)
        let arrayQuestion = try Self.makeDecoder().decode(StructuredPromptQuestion.self, from: arrayPayload)

        #expect(stringQuestion.highlightPhrases == ["수요 증거"])
        #expect(arrayQuestion.highlightPhrases == ["더 필수적", "덜 필수적"])
    }
}
