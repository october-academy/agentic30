import test from "node:test";
import assert from "node:assert/strict";
import {
  OFFICE_HOURS_FALLBACK_MODE,
  OFFICE_HOURS_INLINE_MODE,
  buildContextualOfficeHoursQuestion,
  buildOfficeHoursStructuredQuestionTranscriptText,
  buildOfficeHoursStructuredInputContinuationPrompt,
  buildOfficeHoursStructuredPromptPayload,
  defaultOfficeHoursFallbackOptions,
  extractOfficeHoursQuestion,
  hasLikelyOfficeHoursQuestion,
  isOfficeHoursStructuredInputMode,
  isOfficeHoursStructuredInputToolEvent,
  shouldAppendOfficeHoursStructuredQuestionMessage,
  stripTrailingRubricFocusMetadata,
} from "../sidecar/office-hours-card-fallback.mjs";

test("Office Hours fallback payload converts plain provider question into pendingUserInput card", () => {
  const payload = buildOfficeHoursStructuredPromptPayload({
    sessionId: "session-1",
    provider: "codex",
    assistantMessage: {
      content: [
        "현재 가설은 solo macOS 개발자가 검증을 미룬다는 것입니다.",
        "칭찬 말고, 누가 이 문제에 이미 비용을 치르고 있다는 가장 강한 증거는 무엇인가요?",
        'rubric_focus: ["clout"]',
      ].join("\n"),
      inlineDecision: null,
    },
  });

  assert.equal(payload.toolName, "agentic30_request_user_input");
  assert.equal(payload.title, "Office Hours");
  assert.equal(payload.generation.mode, OFFICE_HOURS_FALLBACK_MODE);
  assert.equal(payload.questions.length, 1);
  assert.equal(
    payload.questions[0].question,
    "칭찬 말고, 누가 이 문제에 이미 비용을 치르고 있다는 가장 강한 증거는 무엇인가요?",
  );
  assert.equal(payload.questions[0].options.length, 4);
  assert.deepEqual(
    payload.questions[0].options.map((option) => option.label),
    ["돈/결제 신호", "시간/우회 수단", "실사용 관찰", "증거 없음"],
  );
  assert.equal(payload.questions[0].options[0].recommended, true);
  assert.match(payload.questions[0].options[0].risk, /관심 표현/);
  assert.match(payload.questions[0].options[0].evidenceTarget, /결제/);
  assert.equal(payload.questions[0].options[0].mapsTo, "Q1 Demand Reality");
  assert.match(payload.questions[0].options[0].failureMode, /검증 행동/);
  assert.equal(payload.questions[0].allowFreeText, true);
  assert.equal(payload.questions[0].requiresFreeText, false);
});

test("Office Hours fallback can withhold default question after a prior structured tool call", () => {
  const payload = buildOfficeHoursStructuredPromptPayload({
    sessionId: "session-1",
    provider: "codex",
    assistantMessage: { content: "좋습니다. 다음 답변을 바탕으로 더 좁히겠습니다." },
    allowDefaultQuestion: false,
  });

  assert.equal(payload, null);
});

test("Office Hours fallback default question uses project context", () => {
  const context = [
    "Day 1 STEP Office Hours context",
    "Project: agentic30 Mac - native macOS menu bar assistant",
    "Customer: 전업 1인 개발자 (수익 0원, macOS)",
    "Problem: 만들 줄은 알지만 무엇을 팔아야 하는지, 어떻게 사람을 데려와야 하는지, 오늘 무엇을 검증해야 하는지 모른다",
  ].join("\n");
  const payload = buildOfficeHoursStructuredPromptPayload({
    sessionId: "session-1",
    provider: "codex",
    assistantMessage: {
      content: "입력 카드가 취소되어 Office Hours 질문을 진행하지 못했습니다.",
    },
    context,
  });

  assert.equal(payload.questions.length, 1);
  assert.match(payload.questions[0].question, /agentic30 Mac/);
  assert.match(payload.questions[0].question, /전업 1인 개발자/);
  assert.match(payload.questions[0].question, /무엇을 팔아야 하는지/);
  assert.equal(payload.questions[0].options.length, 4);
  assert.equal(payload.questions[0].allowFreeText, true);
});

test("Office Hours contextual question falls back when context is sparse", () => {
  assert.equal(
    buildContextualOfficeHoursQuestion("Project: agentic30 Mac\nCustomer: solo founder"),
    "agentic30 Mac의 첫 고객 가정인 solo founder가 지금 이 문제를 직접 해결하려는 가장 강한 증거는 무엇인가요?",
  );
});

test("Office Hours inline decision payload is promoted into host structured input shape", () => {
  const payload = buildOfficeHoursStructuredPromptPayload({
    sessionId: "session-2",
    provider: "claude",
    assistantMessage: {
      content: "어떤 증거부터 확인할까요?",
      inlineDecision: {
        header: "증거",
        question: "어떤 증거부터 확인할까요?",
        options: [
          {
            label: "결제",
            description: "",
            recommended: true,
            risk: "관심만 보고 넘어가는 리스크를 줄입니다.",
            evidenceTarget: "유료 제안 응답",
            mapsTo: "Q1 Demand Reality",
            failureMode: "결제자가 없으면 관찰로 낮춥니다.",
          },
          {
            label: "관찰",
            description: "사용 장면을 봅니다.",
            evidence_target: "막힌 단계",
            failure_mode: "관찰이 없으면 데모콜로 남습니다.",
          },
        ],
        allowFreeText: true,
      },
    },
  });

  assert.equal(payload.toolName, "AskUserQuestion");
  assert.equal(payload.generation.mode, OFFICE_HOURS_INLINE_MODE);
  assert.equal(payload.questions[0].header, "증거");
  assert.equal(payload.questions[0].options.length, 2);
  assert.equal(payload.questions[0].options[0].recommended, true);
  assert.equal(payload.questions[0].options[0].risk, "관심만 보고 넘어가는 리스크를 줄입니다.");
  assert.equal(payload.questions[0].options[0].evidenceTarget, "유료 제안 응답");
  assert.equal(payload.questions[0].options[0].mapsTo, "Q1 Demand Reality");
  assert.equal(payload.questions[0].options[0].failureMode, "결제자가 없으면 관찰로 낮춥니다.");
  assert.equal(payload.questions[0].options[1].evidenceTarget, "막힌 단계");
  assert.equal(payload.questions[0].options[1].failureMode, "관찰이 없으면 데모콜로 남습니다.");
  assert.equal(
    payload.questions[0].options[0].description,
    "선택한 방향으로 Office Hours를 이어갑니다.",
  );
});

test("Office Hours fallback chooses intent-specific stage and alternatives options", () => {
  const stagePayload = buildOfficeHoursStructuredPromptPayload({
    sessionId: "session-stage",
    provider: "codex",
    assistantMessage: {
      content: "제품 단계가 불명확합니다. 지금 단계는 무엇인가요?",
      inlineDecision: null,
    },
  });

  assert.equal(stagePayload.questions[0].questionId, "office_hours_stage");
  assert.equal(stagePayload.generation.signalId, "office_hours_stage");
  assert.deepEqual(
    stagePayload.questions[0].options.map((option) => option.nextIntent),
    ["stage_pre_product", "stage_has_users", "stage_has_paying_customers", "stage_engineering_infra"],
  );
  assert.equal(stagePayload.questions[0].options[1].recommended, true);

  const alternativesPayload = buildOfficeHoursStructuredPromptPayload({
    sessionId: "session-alt",
    provider: "codex",
    assistantMessage: {
      content: "Alternatives를 고르세요. 최소안, 이상안, 다른 관점 중 어디로 갈까요?",
      inlineDecision: null,
    },
  });

  assert.equal(alternativesPayload.questions[0].questionId, "office_hours_alternatives");
  assert.equal(alternativesPayload.generation.signalId, "office_hours_alternatives");
  assert.deepEqual(
    alternativesPayload.questions[0].options.map((option) => option.label),
    ["최소안", "이상안", "다른 관점"],
  );
});

test("Office Hours inline decision preserves Open Design question highlights", () => {
  const payload = buildOfficeHoursStructuredPromptPayload({
    sessionId: "session-2",
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
  const payload = buildOfficeHoursStructuredPromptPayload({
    sessionId: "session-2",
    provider: "codex",
    assistantMessage: {
      content: "어떤 증거부터 확인할까요?",
      inlineDecision: {
        header: "증거",
        question: "관심 말고 행동이나 돈의 증거는 무엇인가요?",
        highlight: "행동이나 돈의 증거",
        options: [
          { label: "결제", description: "돈을 냈습니다." },
          { label: "관찰", description: "사용 장면을 봅니다." },
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

test("Office Hours helpers detect questions, structured tool events, and continuation modes", () => {
  assert.equal(
    extractOfficeHoursQuestion("요약\n가장 강한 수요 증거는 무엇인가요?"),
    "가장 강한 수요 증거는 무엇인가요?",
  );
  assert.equal(hasLikelyOfficeHoursQuestion("어떤 증거를 확인할지 선택해 주세요."), true);
  assert.equal(hasLikelyOfficeHoursQuestion("다음 액션을 정하겠습니다."), false);
  assert.equal(isOfficeHoursStructuredInputMode("office_hours_fallback"), true);
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
      {
        question: " 이번 주 실제 고객 접점 범위는\n 어디까지 잡겠습니까? ",
      },
    ],
  };
  const questionText = buildOfficeHoursStructuredQuestionTranscriptText(request);

  assert.equal(questionText, "이번 주 실제 고객 접점 범위는 어디까지 잡겠습니까?");
  assert.equal(shouldAppendOfficeHoursStructuredQuestionMessage([], questionText), true);
  assert.equal(
    shouldAppendOfficeHoursStructuredQuestionMessage(
      [
        {
          role: "assistant",
          content: `좋습니다.\n${questionText}`,
        },
      ],
      questionText,
    ),
    false,
  );
  assert.equal(
    shouldAppendOfficeHoursStructuredQuestionMessage(
      [
        {
          role: "assistant",
          content: "다른 질문입니다.",
        },
        {
          role: "user",
          content: questionText,
        },
      ],
      questionText,
    ),
    true,
  );
});

test("Office Hours continuation prompt prevents generic confirmation after fallback submission", () => {
  const prompt = buildOfficeHoursStructuredInputContinuationPrompt({
    responseText: "돈/결제 신호 — 이번 주 1명에게 유료 제안",
    responseDescription: defaultOfficeHoursFallbackOptions()[0].description,
  });

  assert.match(prompt, /Office Hours structured-card answer received/);
  assert.match(prompt, /Do not end with a generic confirmation/);
  assert.match(prompt, /host structured input tool/);
  assert.match(prompt, /돈\/결제 신호/);
});
