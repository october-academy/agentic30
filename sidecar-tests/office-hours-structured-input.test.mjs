import test from "node:test";
import assert from "node:assert/strict";
import {
  OFFICE_HOURS_INLINE_MODE,
  buildContextualOfficeHoursQuestion,
  buildOfficeHoursInlineStructuredPromptPayload,
  buildOfficeHoursStructuredQuestionTranscriptText,
  buildOfficeHoursStructuredInputContinuationPrompt,
  isOfficeHoursStructuredInputMode,
  isOfficeHoursStructuredInputToolEvent,
  normalizeOfficeHoursStructuredPromptRequest,
  shouldAppendOfficeHoursStructuredQuestionMessage,
  stripTrailingRubricFocusMetadata,
} from "../sidecar/office-hours-structured-input.mjs";

test("Office Hours does not synthesize a card from a plain provider question", () => {
  const payload = buildOfficeHoursInlineStructuredPromptPayload({
    sessionId: "session-1",
    provider: "codex",
    assistantMessage: {
      content: "칭찬 말고, 가장 강한 수요 증거는 무엇인가요?",
      inlineDecision: null,
    },
  });

  assert.equal(payload, null);
});

test("Office Hours inline decision payload is promoted into host structured input shape", () => {
  const payload = buildOfficeHoursInlineStructuredPromptPayload({
    sessionId: "session-2",
    provider: "claude",
    assistantMessage: {
      content: "어떤 증거부터 확인할까요?",
      inlineDecision: {
        header: "수요 증거",
        intent: "demand",
        question: "Agentic30 수요를 실제 행동으로 확인한 가장 강한 증거는 무엇인가요?",
        helperText: "가격 질문은 관심으로 낮춥니다.",
        options: [
          {
            label: "실제 결제/계약이 있었다",
            description: "돈이 이미 움직였습니다.",
            recommended: true,
            risk: "결제 주체가 ICP가 아닐 수 있습니다.",
            evidenceTarget: "실명, 날짜, 결제 절차",
            mapsTo: "Q1 Demand Reality",
            failureMode: "돈이 움직이지 않았으면 구매 조건 이하로 낮춥니다.",
          },
          {
            label: "관심만 있거나 아직 증거가 없다",
            description: "칭찬이나 가격 질문은 수요가 아닙니다.",
            risk: "실제 행동 검증이 남습니다.",
          },
        ],
        allowFreeText: false,
      },
    },
  });

  assert.equal(payload.toolName, "AskUserQuestion");
  assert.equal(payload.title, "Office Hours");
  assert.equal(payload.generation.mode, OFFICE_HOURS_INLINE_MODE);
  assert.equal(payload.generation.signalId, "office_hours_demand_evidence");
  assert.equal(payload.questions.length, 1);
  assert.equal(payload.questions[0].header, "수요 증거");
  assert.equal(payload.questions[0].questionId, "office_hours_demand_evidence");
  assert.equal(payload.questions[0].options.length, 4);
  assert.equal(payload.questions[0].options[0].recommended, true);
  assert.equal(payload.questions[0].options[0].risk, "결제 주체와 날짜가 없으면 말뿐인 관심으로 낮춰 봐야 합니다.");
  assert.equal(payload.questions[0].options[0].evidenceTarget, "실명, 날짜, 결제 또는 계약 절차");
  assert.equal(payload.questions[0].options[3].label, "관심만 있거나 아직 증거가 없다");
  assert.equal(payload.questions[0].allowFreeText, false);
});

test("Office Hours demand evidence question is canonicalized to four choices", () => {
  const request = normalizeOfficeHoursStructuredPromptRequest({
    title: "Office Hours",
    questions: [
      {
        questionId: "office_hours_demand_evidence",
        header: "수요 증거",
        question: "Agentic30 수요를 실제 행동으로 확인한 가장 강한 증거는 무엇인가요?",
        options: [
          { label: "old option 1", description: "돈" },
          { label: "old option 2", description: "조건" },
          { label: "old option 3", description: "비용" },
          { label: "old option 4", description: "시간" },
          { label: "old option 5", description: "관심" },
          { label: "old option 6", description: "없음" },
        ],
        allowFreeText: true,
        requiresFreeText: true,
      },
    ],
  });

  assert.deepEqual(
    request.questions[0].options.map((option) => option.label),
    [
      "실제 결제/계약이 있었다",
      "구매 조건이 구체적으로 확인됐다",
      "현재 대안에 돈/시간을 쓰고 있다",
      "관심만 있거나 아직 증거가 없다",
    ],
  );
  assert.equal(request.questions[0].allowFreeText, false);
  assert.equal(request.questions[0].requiresFreeText, false);
});

test("Office Hours inline decision without choices is rejected unless free text is explicit", () => {
  const rejected = buildOfficeHoursInlineStructuredPromptPayload({
    sessionId: "session-3",
    assistantMessage: {
      inlineDecision: {
        question: "무엇을 확인했나요?",
        options: [],
        allowFreeText: false,
      },
    },
  });
  assert.equal(rejected, null);

  const accepted = buildOfficeHoursInlineStructuredPromptPayload({
    sessionId: "session-3",
    assistantMessage: {
      inlineDecision: {
        header: "근거",
        question: "무엇을 확인했나요?",
        options: [],
        allowFreeText: true,
        requiresFreeText: true,
        freeTextPlaceholder: "예: 6/2 A가 결제 링크를 요청했다.",
      },
    },
  });
  assert.equal(accepted.questions[0].allowFreeText, true);
  assert.equal(accepted.questions[0].requiresFreeText, true);
  assert.equal(accepted.questions[0].freeTextPlaceholder, "예: 6/2 A가 결제 링크를 요청했다.");
});

test("Office Hours contextual question supports explicit inline question text", () => {
  assert.equal(
    buildContextualOfficeHoursQuestion("Project: agentic30 Mac\nCustomer: solo founder"),
    "agentic30 Mac의 첫 고객 가정인 solo founder가 지금 이 문제를 직접 해결하려는 가장 강한 증거는 무엇인가요?",
  );
});

test("Office Hours inline decision preserves Open Design question highlights", () => {
  const payload = buildOfficeHoursInlineStructuredPromptPayload({
    sessionId: "session-4",
    provider: "codex",
    assistantMessage: {
      content: "3년 뒤 세상이 달라지면 어떻게 되나요?",
      inlineDecision: {
        header: "미래 적합성",
        question: "3년 뒤 세상이 달라졌을 때 이 제품은 더 필수적이 돼, 아니면 덜 필수적이 돼?",
        options: [
          { label: "더 필수적이다", description: "세계 변화가 제품 의존도를 키웁니다." },
          { label: "덜 필수적일 수 있다", description: "범용 AI가 흡수할 수 있습니다." },
        ],
      },
    },
  });

  assert.deepEqual(payload.questions[0].highlightPhrases, ["더 필수적", "덜 필수적"]);
});

test("Office Hours inline decision accepts explicit highlight string", () => {
  const payload = buildOfficeHoursInlineStructuredPromptPayload({
    sessionId: "session-5",
    provider: "codex",
    assistantMessage: {
      content: "어떤 증거부터 확인할까요?",
      inlineDecision: {
        header: "직접 관찰",
        intent: "observation",
        question: "관심 말고 직접 관찰한 행동의 증거는 무엇인가요?",
        highlight: "행동이나 돈의 증거",
        options: [
          { label: "직접 관찰함", description: "사용 장면을 봅니다." },
          { label: "아직 못 봄", description: "관찰이 없습니다." },
        ],
      },
    },
  });

  assert.deepEqual(payload.questions[0].highlightPhrases, ["행동이나 돈의 증거"]);
});

test("Office Hours metadata cleanup strips trailing rubric_focus lines only", () => {
  const cleaned = stripTrailingRubricFocusMetadata(
    '본문 질문입니다?\nrubric_focus: ["clout"]\nrubric_focus: ["command"]',
  );

  assert.equal(cleaned, "본문 질문입니다?");
  assert.equal(
    stripTrailingRubricFocusMetadata('본문 안의 rubric_focus: ["clout"] 설명은 유지'),
    '본문 안의 rubric_focus: ["clout"] 설명은 유지',
  );
});

test("Office Hours helpers detect structured tool events and continuation modes", () => {
  assert.equal(isOfficeHoursStructuredInputMode("office_hours_inline"), true);
  assert.equal(isOfficeHoursStructuredInputMode("office_hours"), true);
  assert.equal(isOfficeHoursStructuredInputMode("provider_adaptive"), false);
  assert.equal(
    isOfficeHoursStructuredInputToolEvent({
      toolName: "function_call",
      payload: { requestedToolName: "agentic30_request_user_input" },
    }),
    true,
  );
});

test("Office Hours transcript helpers preserve structured question once", () => {
  const request = {
    questions: [
      { question: " 지금 사용자는 무엇으로 이 문제를 버티고 있나요? " },
      { question: " 이번 주에 돈을 받을 수 있는 가장 작은 버전은 무엇인가요? " },
      { question: " 직접 관찰한 막힘은 무엇인가요? " },
    ],
  };
  const questionText = buildOfficeHoursStructuredQuestionTranscriptText(request);

  assert.equal(
    questionText,
    [
      "지금 사용자는 무엇으로 이 문제를 버티고 있나요?",
      "이번 주에 돈을 받을 수 있는 가장 작은 버전은 무엇인가요?",
      "직접 관찰한 막힘은 무엇인가요?",
    ].join("\n\n"),
  );
  assert.equal(shouldAppendOfficeHoursStructuredQuestionMessage([], questionText), true);
  assert.equal(
    shouldAppendOfficeHoursStructuredQuestionMessage(
      [{ role: "assistant", content: `좋습니다.\n${questionText}` }],
      questionText,
    ),
    false,
  );
});

test("Office Hours continuation prompt prevents generic confirmation after structured submission", () => {
  const prompt = buildOfficeHoursStructuredInputContinuationPrompt({
    responseText: "실제 결제/계약이 있었다",
    responseDescription: "돈이 이미 움직였습니다.",
  });

  assert.match(prompt, /Office Hours structured-card answer received/);
  assert.match(prompt, /Do not end with a generic confirmation/);
  assert.match(prompt, /host structured input tool/);
  assert.match(prompt, /실제 결제\/계약이 있었다/);
});
