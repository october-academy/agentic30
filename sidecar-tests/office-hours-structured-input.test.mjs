import test from "node:test";
import assert from "node:assert/strict";
import {
  OFFICE_HOURS_INLINE_MODE,
  OFFICE_HOURS_TOOL_MODE,
  OFFICE_HOURS_EMPHASIS_SENTINEL_END,
  OFFICE_HOURS_EMPHASIS_SENTINEL_START,
  buildContextualOfficeHoursQuestion,
  buildOfficeHoursInterviewAnswerLogAttributes,
  buildOfficeHoursInlineStructuredPromptPayload,
  buildOfficeHoursStructuredQuestionTranscriptText,
  buildOfficeHoursStructuredInputContinuationPrompt,
  extractOfficeHoursChatEmphasis,
  formatSelectedOptionEvidenceHint,
  isOfficeHoursStructuredInputMode,
  isOfficeHoursStructuredInputToolEvent,
  officeHoursStructuredInputChannel,
  prepareOfficeHoursStructuredInputRequest,
  normalizeOfficeHoursEmphasis,
  shouldAppendOfficeHoursStructuredQuestionMessage,
  stripTrailingRubricFocusMetadata,
} from "../sidecar/office-hours-structured-input.mjs";
import {
  humanizeOfficeHoursVisibleText,
  inspectOfficeHoursUiCopyRequest,
  normalizeOfficeHoursUiCopyRequest,
} from "../sidecar/office-hours-copy-rules.mjs";

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
            label: "구매 조건이 구체적으로 확인됐다",
            description: "가격, 범위, 일정 조건이 확인됐습니다.",
          },
          {
            label: "현재 대안에 돈/시간을 쓰고 있다",
            description: "현재 대안 비용이나 반복 시간이 있습니다.",
          },
          {
            label: "관심만 있거나 아직 증거가 없다",
            description: "칭찬이나 가격 질문은 수요가 아닙니다.",
            risk: "실제 행동 검증이 남습니다.",
          },
        ],
        allowFreeText: true,
        requiresFreeText: false,
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
  assert.equal(payload.questions[0].options[0].risk, "결제 주체가 ICP가 아닐 수 있습니다.");
  assert.equal(payload.questions[0].options[0].evidenceTarget, "실명, 날짜, 결제 절차");
  assert.equal(payload.questions[0].options[3].label, "관심만 있거나 아직 증거가 없다");
  assert.equal(payload.questions[0].allowFreeText, true);
  assert.equal(payload.questions[0].requiresFreeText, false);
});

test("prepareOfficeHoursStructuredInputRequest rejects non-canonical demand choices", () => {
  assert.throws(() => prepareOfficeHoursStructuredInputRequest({
    toolName: "AskUserQuestion",
    title: "Office Hours",
    generation: {
      mode: OFFICE_HOURS_TOOL_MODE,
      signalId: "office_hours_demand_evidence",
      signalLabel: "Office Hours Q1 수요 증거",
    },
    questions: [
      {
        questionId: "office_hours_demand_evidence",
        header: "수요 증거",
        question: "Agentic30 수요를 실제 행동으로 확인한 가장 강한 증거는 무엇인가요?",
        options: [
          { label: "old option 1", description: "돈" },
          { label: "old option 2", description: "조건" },
        ],
        allowFreeText: true,
        requiresFreeText: false,
      },
    ],
  }), /options must be exactly/);
});

test("prepareOfficeHoursStructuredInputRequest rejects missing Office Hours free-text contract", () => {
  assert.throws(() => prepareOfficeHoursStructuredInputRequest({
    toolName: "AskUserQuestion",
    title: "Office Hours",
    generation: {
      mode: OFFICE_HOURS_TOOL_MODE,
      signalId: "office_hours_premise_challenge",
      signalLabel: "Office Hours 전제 확인",
    },
    questions: [
      {
        questionId: "office_hours_premise_challenge",
        header: "전제 확인",
        question: "이게 맞는 문제라는 가장 강한 증거는 무엇인가요?",
        options: [
          { label: "맞는 문제다", description: "증거가 있다" },
          { label: "확실하지 않다", description: "증거 공백이 있다" },
        ],
        allowFreeText: false,
        requiresFreeText: false,
      },
    ],
  }), /allowFreeText must be true/);
});

test("prepareOfficeHoursStructuredInputRequest keeps current-alternative cards selection-only", () => {
  const prepared = prepareOfficeHoursStructuredInputRequest({
    toolName: "AskUserQuestion",
    title: "Office Hours",
    generation: {
      mode: OFFICE_HOURS_TOOL_MODE,
      signalId: "office_hours_status_quo",
      signalLabel: "Office Hours Q2 현재 대안",
    },
    questions: [
      {
        questionId: "office_hours_status_quo",
        header: "현재 대안",
        question: "지금 이 문제를 어떤 현재 대안으로 해결하고 있나요?",
        options: [
          { label: "혼자 더 만들기", description: "직접 기능을 더 만듭니다." },
          { label: "수작업", description: "매번 수동으로 처리합니다." },
        ],
        allowFreeText: true,
        requiresFreeText: false,
      },
    ],
  });

  assert.equal(prepared.questions[0].allowFreeText, true);
  assert.equal(prepared.questions[0].requiresFreeText, false);
});

test("prepareOfficeHoursStructuredInputRequest leaves non-Office-Hours free-text flags alone", () => {
  const prepared = prepareOfficeHoursStructuredInputRequest({
    toolName: "AskUserQuestion",
    title: "Ideal Customer Profile 1/4",
    generation: { mode: "sidecar_agent_synthesized", docType: "icp" },
    questions: [
      {
        header: "첫 고객",
        question: "누구부터 검증할까요?",
        options: [
          { label: "후보 A", description: "a" },
          { label: "후보 B", description: "b" },
        ],
        allowFreeText: false,
      },
    ],
  });

  assert.equal(prepared.questions[0].allowFreeText, false);
});

test("prepareOfficeHoursStructuredInputRequest rejects missing generation", () => {
  assert.throws(() => prepareOfficeHoursStructuredInputRequest({
    toolName: "agentic30_request_user_input",
    title: "Office Hours",
    questions: [
      {
        header: "활성 사용자 기준",
        question: "이 목표에서 활성 사용자 1명으로 세려면 고객 후보가 어떤 핵심 행동을 끝내야 하나요?",
        options: [
          { label: "첫 가치 완료", description: "핵심 결과를 처음 끝냅니다." },
          { label: "반복 사용 완료", description: "정해진 기간에 다시 씁니다." },
          { label: "수동 파일럿 성공", description: "수동으로라도 원하는 결과를 얻습니다." },
        ],
      },
    ],
  }), /generation\.mode/);
});

test("prepareOfficeHoursStructuredInputRequest accepts explicit active-user-definition card", () => {
  const prepared = prepareOfficeHoursStructuredInputRequest({
    toolName: "agentic30_request_user_input",
    title: "Office Hours",
    generation: {
      mode: OFFICE_HOURS_TOOL_MODE,
      signalId: "get_users_active_user_definition",
      signalLabel: "활성 사용자 기준",
    },
    questions: [
      {
        header: "활성 사용자 기준",
        question: "이 목표에서 활성 사용자 1명으로 세려면 고객 후보가 어떤 핵심 행동을 끝내야 하나요?",
        options: [
          { label: "첫 가치 완료", description: "핵심 결과를 처음 끝냅니다." },
          { label: "반복 사용 완료", description: "정해진 기간에 다시 씁니다." },
          { label: "수동 파일럿 성공", description: "수동으로라도 원하는 결과를 얻습니다." },
        ],
        allowFreeText: true,
        requiresFreeText: false,
      },
    ],
  });

  assert.equal(prepared.questions[0].header, "활성 사용자 기준");
  assert.equal(
    prepared.questions[0].question,
    "이 목표에서 활성 사용자 1명으로 세려면 고객 후보가 어떤 핵심 행동을 끝내야 하나요?",
  );
  assert.equal(prepared.generation.signalId, "get_users_active_user_definition");
});

test("Office Hours Korean UI-copy contract detects awkward visible copy before rewrite", () => {
  const request = {
    title: "Office Hours",
    generation: { mode: OFFICE_HOURS_TOOL_MODE, signalId: "office_hours_channel" },
    questions: [
      {
        header: "채널 증거",
        question: "30일 안에 가입자 100명을 데려올, 지금 가장 현실적인 첫 유입 경로는 무엇인가요? (집합명사 말고)",
        options: [
          {
            label: "콘텐츠/SNS 유입 (릴스·글)",
            description: "감정일기 관련 짧은 콘텐츠로 유입. 리스크: 허영 지표만 보고 착각할 수 있음.",
          },
          {
            label: "게시물→가입 전환 수치를 안다",
            description: "가장 강함. 다음: UTM으로 proof target을 확인한다.",
          },
          {
            label: "랜딩/가입 구간을 내가 직접 통과해보며 이탈 지점 찾기",
            description: "activation action 전 이탈을 찾는다.",
          },
          {
            label: "오늘 요청을 닫기",
            description: "오늘 요청을 어떤 방식으로 지금 닫을까요?",
          },
        ],
      },
    ],
  };

  const issues = inspectOfficeHoursUiCopyRequest(request);
  assert.ok(issues.length >= 6);
  assert.deepEqual(
    [...new Set(issues.map((issue) => issue.severity))].sort(),
    ["S1", "S2", "S3"],
  );
  assert.ok(issues.some((issue) => issue.ruleId === "OH-S1-SIGNUP-GOAL"));
  assert.ok(issues.some((issue) => issue.ruleId === "OH-S1-COLLECTIVE"));
  assert.ok(issues.some((issue) => issue.ruleId === "OH-S1-CLOSING-JARGON"));
  assert.ok(issues.some((issue) => issue.ruleId === "OH-S2-INTERNAL-RISK"));
  assert.ok(issues.some((issue) => issue.ruleId === "OH-S2-POST-SIGNUP"));
});

test("Office Hours Korean UI-copy humanizer rewrites S1 visible copy and preserves metadata", () => {
  const request = {
    title: "Office Hours",
    generation: {
      mode: OFFICE_HOURS_TOOL_MODE,
      signalId: "office_hours_day3_customer_evidence_next_action",
      signalLabel: "Office Hours Day 3 고객 증거 다음 행동",
    },
    questions: [
      {
        questionId: "office_hours_day3_customer_evidence_next_action",
        header: "오늘 발송 행동",
        question: "Day 3에 박조은님께 아직 보내지 못한 프로젝트 기록 요청을 오늘 어떤 확인 가능한 행동으로 닫을까요?",
        helperText: "API/MCP 로그와 https://example.com/proof 는 그대로 둡니다.",
        options: [
          {
            label: "오늘 요청을 닫기",
            description: "가입자 100명 목표를 위해 activation action 전 이 요청부터 닫을까요?",
            nextIntent: "send_project_record_request",
            risk: "API/MCP 연결 여부는 metadata에서 그대로 유지합니다.",
            evidenceTarget: "박조은님, Day 3, https://example.com/proof, API/MCP",
            mapsTo: "customer evidence",
            failureMode: "요청을 보내지 않으면 증거가 없습니다.",
          },
          {
            label: "보류",
            description: "막힌 이유를 남기고 내일 이어갑니다.",
          },
        ],
        allowFreeText: true,
        requiresFreeText: false,
      },
    ],
  };

  const normalized = normalizeOfficeHoursUiCopyRequest(request);
  assert.equal(normalized.generation.signalId, request.generation.signalId);
  assert.equal(normalized.generation.signalLabel, request.generation.signalLabel);
  assert.equal(normalized.questions[0].questionId, request.questions[0].questionId);
  assert.equal(
    normalized.questions[0].question,
    "Day 3에 박조은님께 아직 보내지 못한 프로젝트 기록 요청을 오늘 어떤 확인 가능한 행동으로 마무리할까요?",
  );
  assert.equal(
    normalized.questions[0].helperText,
    "API/MCP 로그와 https://example.com/proof 는 그대로 둡니다.",
  );
  assert.equal(normalized.questions[0].options[0].label, "오늘 요청을 마무리하기");
  assert.equal(
    normalized.questions[0].options[0].description,
    "활성 사용자 100명 목표를 위해 핵심 행동 전 이 요청부터 마무리할까요?",
  );
  assert.equal(normalized.questions[0].options[0].nextIntent, "send_project_record_request");
  assert.equal(normalized.questions[0].options[0].evidenceTarget, "박조은님, Day 3, https://example.com/proof, API/MCP");
  assert.equal(normalized.questions[0].allowFreeText, true);
  assert.equal(normalized.questions[0].requiresFreeText, false);
  assert.equal(
    inspectOfficeHoursUiCopyRequest(normalized).some((issue) => issue.severity === "S1"),
    false,
  );
});

test("Office Hours Korean UI-copy humanizer fails explicitly when S1 copy remains", () => {
  assert.throws(() => normalizeOfficeHoursUiCopyRequest({
    title: "Office Hours",
    generation: { mode: OFFICE_HOURS_TOOL_MODE, signalId: "office_hours_channel" },
    questions: [
      {
        header: "채널 증거",
        question: "`ICP` 기준으로 오늘 연락할 사람은 누구인가요?",
        options: [
          {
            label: "고객 후보",
            description: "실제 이름을 씁니다.",
          },
          {
            label: "보류",
            description: "아직 모릅니다.",
          },
        ],
      },
    ],
  }), /S1 issues remain after rewrite/);
});

test("Office Hours Korean UI-copy humanizer does not rewrite deadline wording", () => {
  assert.equal(
    humanizeOfficeHoursVisibleText("오늘 마감일은 6월 4일까지입니다. API/MCP 기록은 그대로 둡니다."),
    "오늘 마감일은 6월 4일까지입니다. API/MCP 기록은 그대로 둡니다.",
  );
});

test("Office Hours Korean UI-copy contract allows natural closing copy", () => {
  const request = {
    title: "Office Hours",
    generation: { mode: OFFICE_HOURS_TOOL_MODE, signalId: "office_hours_close_state" },
    questions: [
      {
        header: "상태 정리",
        question: "오늘 요청을 어떻게 마무리할까요?",
        options: [
          {
            label: "완료",
            description: "오늘 필요한 행동이 끝났고 기록할 증거가 있습니다.",
          },
          {
            label: "보류",
            description: "막힌 이유를 남기고 다시 볼 상태로 둡니다.",
          },
          {
            label: "내일로 넘김",
            description: "내일 이어서 할 가장 작은 행동을 정합니다.",
          },
        ],
      },
    ],
  };

  const issues = inspectOfficeHoursUiCopyRequest(request);
  assert.equal(
    issues.some((issue) => issue.ruleId === "OH-S1-CLOSING-JARGON"),
    false,
  );
  assert.deepEqual(normalizeOfficeHoursUiCopyRequest(request), request);
});

test("officeHoursStructuredInputChannel maps each provider to its asking mechanism", () => {
  const claude = officeHoursStructuredInputChannel("claude");
  assert.equal(claude.kind, "tool");
  assert.equal(claude.toolName, "AskUserQuestion");
  assert.equal(claude.promptToken, "AskUserQuestion");

  const codex = officeHoursStructuredInputChannel("codex");
  assert.equal(codex.kind, "tool");
  assert.equal(codex.toolName, "agentic30_request_user_input");
  assert.equal(codex.promptToken, "agentic30_request_user_input");

  // Gemini is text-only: inline channel, sentinel prompt token, no callable tool.
  const gemini = officeHoursStructuredInputChannel("gemini");
  assert.equal(gemini.kind, "inline");
  assert.equal(gemini.promptToken, "inline_decision sentinel block");

  // Unknown / empty providers default to the Codex tool channel.
  assert.equal(officeHoursStructuredInputChannel("").kind, "tool");
});

test("prepareOfficeHoursStructuredInputRequest accepts an explicit demand contract", () => {
  const prepared = prepareOfficeHoursStructuredInputRequest({
    toolName: "agentic30_request_user_input",
    title: "Office Hours",
    generation: {
      mode: OFFICE_HOURS_TOOL_MODE,
      signalId: "office_hours_demand_evidence",
      signalLabel: "Office Hours Q1 수요 증거",
    },
    questions: [
      {
        questionId: "office_hours_demand_evidence",
        header: "수요 증거",
        question: "Agentic30 수요를 실제 행동으로 확인한 가장 강한 증거는 무엇인가요?",
        options: [
          { label: "실제 결제/계약이 있었다", description: "돈이 이미 움직였습니다." },
          { label: "구매 조건이 구체적으로 확인됐다", description: "가격, 범위, 일정 조건이 확인됐습니다." },
          { label: "현재 대안에 돈/시간을 쓰고 있다", description: "현재 대안 비용이나 반복 시간이 있습니다." },
          { label: "관심만 있거나 아직 증거가 없다", description: "칭찬이나 가격 질문은 수요가 아닙니다." },
        ],
        allowFreeText: true,
        requiresFreeText: false,
      },
    ],
  });

  assert.deepEqual(
    prepared.questions[0].options.map((o) => o.label),
    [
      "실제 결제/계약이 있었다",
      "구매 조건이 구체적으로 확인됐다",
      "현재 대안에 돈/시간을 쓰고 있다",
      "관심만 있거나 아직 증거가 없다",
    ],
  );
  assert.equal(prepared.generation.mode, OFFICE_HOURS_TOOL_MODE);
  assert.equal(isOfficeHoursStructuredInputMode(prepared.generation.mode), true);
  assert.equal(prepared.generation.signalId, "office_hours_demand_evidence");
  assert.equal(prepared.questions[0].requiresFreeText, false);
});

test("prepareOfficeHoursStructuredInputRequest leaves an inline-promoted request untouched", () => {
  const inline = {
    title: "Office Hours",
    questions: [
      {
        header: "현재 대안",
        question: "지금 무엇으로 버티나요?",
        options: [
          { label: "수작업", description: "직접 처리합니다." },
          { label: "다른 도구", description: "이미 쓰는 도구가 있습니다." },
        ],
        allowFreeText: true,
        requiresFreeText: false,
      },
    ],
    generation: {
      mode: OFFICE_HOURS_INLINE_MODE,
      signalId: "office_hours_status_quo",
      signalLabel: "Office Hours Q2 현재 대안",
    },
  };
  const prepared = prepareOfficeHoursStructuredInputRequest(inline);
  assert.equal(prepared.generation.mode, OFFICE_HOURS_INLINE_MODE);
  assert.equal(prepared.generation.signalId, "office_hours_status_quo");
});

test("prepareOfficeHoursStructuredInputRequest rejects an empty or literal Question header", () => {
  const baseQuestion = {
    question: "지금 이 문제를 어떤 대안으로 해결하고 있나요?",
    options: [
      { label: "수작업", description: "직접 처리" },
      { label: "다른 도구", description: "우회" },
    ],
    allowFreeText: true,
    requiresFreeText: false,
  };
  const baseRequest = {
    title: "Office Hours",
    generation: {
      mode: OFFICE_HOURS_TOOL_MODE,
      signalId: "office_hours_status_quo",
      signalLabel: "Office Hours Q2 현재 대안",
    },
  };

  assert.throws(() => prepareOfficeHoursStructuredInputRequest({
    ...baseRequest,
    questions: [{ ...baseQuestion, header: "" }],
  }), /explicit Korean card header/);

  assert.throws(() => prepareOfficeHoursStructuredInputRequest({
    ...baseRequest,
    questions: [{ ...baseQuestion, header: "Question" }],
  }), /explicit Korean card header/);
});

test("prepareOfficeHoursStructuredInputRequest carries and validates tool-channel emphasis spans (statement-styling parity)", () => {
  const prepared = prepareOfficeHoursStructuredInputRequest({
    title: "Office Hours",
    generation: {
      mode: OFFICE_HOURS_TOOL_MODE,
      signalId: "office_hours_status_quo",
      signalLabel: "Office Hours Q2 현재 대안",
    },
    questions: [
      {
        header: "현재 대안",
        question: "지금 이 문제를 어떤 대안으로 해결하고 있나요?",
        options: [
          { label: "수작업", description: "직접 처리" },
          { label: "다른 도구", description: "우회" },
        ],
        allowFreeText: true,
        requiresFreeText: false,
        emphasis: [
          { phrase: "어떤 대안으로", style: "mark" },
          { phrase: "이 문장에 없는 구절", style: "strong" }, // dropped: not a substring of the question
        ],
      },
    ],
  });
  const question = prepared.questions[0];
  assert.ok(Array.isArray(question.emphasis));
  assert.equal(question.emphasis.length, 1);
  assert.equal(question.emphasis[0].phrase, "어떤 대안으로");
  assert.equal(question.emphasis[0].style, "mark");
});

test("Office Hours inline decision without choices is rejected", () => {
  assert.throws(() => buildOfficeHoursInlineStructuredPromptPayload({
    sessionId: "session-3",
    assistantMessage: {
      inlineDecision: {
        question: "무엇을 확인했나요?",
        options: [],
        allowFreeText: false,
      },
    },
  }), /options must contain at least two choices/);

  assert.throws(() => buildOfficeHoursInlineStructuredPromptPayload({
    sessionId: "session-3",
    assistantMessage: {
      inlineDecision: {
        header: "근거",
        question: "무엇을 확인했나요?",
        options: [],
        allowFreeText: true,
        requiresFreeText: false,
        freeTextPlaceholder: "예: 6/2 A가 결제 링크를 요청했다.",
      },
    },
  }), /options must contain at least two choices/);
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
        allowFreeText: true,
        requiresFreeText: false,
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
        allowFreeText: true,
        requiresFreeText: false,
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

test("Office Hours continuation prompt prevents vague confirmation after structured submission", () => {
  const prompt = buildOfficeHoursStructuredInputContinuationPrompt({
    responseText: "실제 결제/계약이 있었다",
    responseDescription: "돈이 이미 움직였습니다.",
  });

  assert.match(prompt, /Office Hours structured-card answer received/);
  assert.match(prompt, /Do not end with a vague confirmation/);
  assert.match(prompt, /host structured input tool/);
  assert.match(prompt, /실제 결제\/계약이 있었다/);
});

test("Office Hours answer log attributes include raw question, options, selected value, free text, and signal metadata", () => {
  const pendingUserInput = {
    sessionId: "session-office-hours",
    requestId: "request-1",
    title: "Office Hours",
    generation: {
      mode: OFFICE_HOURS_TOOL_MODE,
      signalId: "office_hours_demand_evidence",
      signalLabel: "Office Hours Q1 수요 증거",
    },
    questions: [
      {
        questionId: "office_hours_demand_evidence",
        header: "수요 증거",
        question: "Agentic30 수요를 실제 행동으로 확인한 가장 강한 증거는 무엇인가요?",
        helperText: "칭찬은 수요가 아닙니다.",
        allowFreeText: true,
        requiresFreeText: false,
        multiSelect: false,
        textMode: "short",
        options: [
          {
            label: "실제 결제/계약이 있었다",
            description: "돈이 이미 움직였습니다.",
            nextIntent: "actual_payment_or_contract",
            recommended: true,
            risk: "결제 주체와 날짜가 필요합니다.",
            evidenceTarget: "실명, 날짜, 결제 절차",
            mapsTo: "Q1 Demand Reality",
            failureMode: "돈이 움직이지 않았으면 낮춥니다.",
          },
          {
            label: "관심만 있거나 아직 증거가 없다",
            description: "칭찬이나 가격 질문은 수요가 아닙니다.",
            risk: "실제 행동 검증이 남습니다.",
          },
        ],
      },
    ],
  };
  const attributes = buildOfficeHoursInterviewAnswerLogAttributes({
    session: {
      id: "session-office-hours",
      provider: "codex",
      runtime: {
        officeHours: {
          day: 3,
          source: "office_hours_screen_day_3",
        },
      },
    },
    pendingUserInput,
    response: {
      responses: [
        {
          question: pendingUserInput.questions[0].question,
          selectedOptions: ["실제 결제/계약이 있었다"],
          freeText: "6/10에 A가 10만원 결제 링크를 요청했다.",
        },
      ],
    },
    responseText: "실제 결제/계약이 있었다 — 6/10에 A가 10만원 결제 링크를 요청했다.",
    responseDescription: "돈이 이미 움직였습니다. (근거: 실명, 날짜, 결제 절차)",
    terminal: true,
  });

  assert.equal(attributes.log_type, "office_hours_interview_answer");
  assert.equal(attributes.session_id, "session-office-hours");
  assert.equal(attributes.request_id, "request-1");
  assert.equal(attributes.provider, "codex");
  assert.equal(attributes.day, 3);
  assert.equal(attributes.source, "office_hours_screen_day_3");
  assert.equal(attributes.mode, OFFICE_HOURS_TOOL_MODE);
  assert.equal(attributes.signal_id, "office_hours_demand_evidence");
  assert.equal(attributes.signal_label, "Office Hours Q1 수요 증거");
  assert.equal(attributes.terminal, true);
  assert.equal(attributes.response_text, "실제 결제/계약이 있었다 — 6/10에 A가 10만원 결제 링크를 요청했다.");
  assert.equal(attributes.response_description, "돈이 이미 움직였습니다. (근거: 실명, 날짜, 결제 절차)");
  assert.equal(attributes.question_count, 1);
  assert.equal(attributes.responses[0].question_id, "office_hours_demand_evidence");
  assert.equal(
    attributes.responses[0].question_text,
    "Agentic30 수요를 실제 행동으로 확인한 가장 강한 증거는 무엇인가요?",
  );
  assert.deepEqual(attributes.responses[0].selected_options, ["실제 결제/계약이 있었다"]);
  assert.equal(attributes.responses[0].free_text, "6/10에 A가 10만원 결제 링크를 요청했다.");
  assert.equal(attributes.responses[0].options.length, 2);
  assert.equal(attributes.responses[0].options[0].label, "실제 결제/계약이 있었다");
  assert.equal(attributes.responses[0].options[0].description, "돈이 이미 움직였습니다.");
  assert.equal(attributes.responses[0].options[0].next_intent, "actual_payment_or_contract");
  assert.equal(attributes.responses[0].options[0].recommended, true);
  assert.equal(attributes.responses[0].options[0].risk, "결제 주체와 날짜가 필요합니다.");
  assert.equal(attributes.responses[0].options[0].evidence_target, "실명, 날짜, 결제 절차");
  assert.equal(attributes.responses[0].options[0].maps_to, "Q1 Demand Reality");
  assert.equal(attributes.responses[0].options[0].failure_mode, "돈이 움직이지 않았으면 낮춥니다.");
  assert.equal(attributes.responses[0].options[0].selected, true);
  assert.equal(attributes.responses[0].options[1].selected, false);
});

test("formatSelectedOptionEvidenceHint folds risk/evidence/failure into the agent context", () => {
  const hint = formatSelectedOptionEvidenceHint({
    label: "실제 결제/계약이 있었다",
    description: "돈이 이미 움직였습니다.",
    risk: "결제 주체가 ICP가 아닐 수 있습니다.",
    evidenceTarget: "실명, 날짜, 결제 절차",
    failureMode: "돈이 움직였다는 사실을 못 쓰면 구매 조건 이하로 낮춥니다.",
  });
  assert.match(hint, /^돈이 이미 움직였습니다\. \(/);
  assert.match(hint, /리스크: 결제 주체가 ICP가 아닐 수 있습니다\./);
  assert.match(hint, /근거: 실명, 날짜, 결제 절차/);
  assert.match(hint, /실패 조건: 돈이 움직였다는 사실을 못 쓰면 구매 조건 이하로 낮춥니다\./);

  // snake_case metadata is accepted as well.
  assert.match(
    formatSelectedOptionEvidenceHint({
      description: "조건이 구체적입니다.",
      evidence_target: "가격, 범위, 구매 시점",
      failure_mode: "조건이 모호하면 관심으로 낮춥니다.",
    }),
    /근거: 가격, 범위, 구매 시점.*실패 조건: 조건이 모호하면 관심으로 낮춥니다\./,
  );

  // Options without metadata collapse to the description alone (back-compat).
  assert.equal(
    formatSelectedOptionEvidenceHint({ label: "관심만 있다", description: "아직 증거가 없습니다." }),
    "아직 증거가 없습니다.",
  );
  // Empty/description-less options yield nothing.
  assert.equal(formatSelectedOptionEvidenceHint({ label: "no desc" }), "");
  assert.equal(formatSelectedOptionEvidenceHint(), "");
});

test("normalizeOfficeHoursEmphasis validates phrases, styles, substring, dedup, and cap", () => {
  const text = "파일 config.json 의 마감일은 금요일이고 핵심 수치는 100명입니다";
  const emphasis = normalizeOfficeHoursEmphasis(
    [
      { phrase: "  config.json ", style: "code" },
      { phrase: "마감일은 금요일", style: "mark" },
      { phrase: "100명", style: "strong" },
      { phrase: "100명", style: "strong" }, // duplicate dropped
      { phrase: "존재하지 않는 구절", style: "mark" }, // not a substring -> dropped
      { phrase: "수치", style: "unknown-style" }, // unsupported style -> mark
      { phrase: "   ", style: "code" }, // empty after trim -> dropped
    ],
    text,
  );

  assert.deepEqual(emphasis, [
    { phrase: "config.json", style: "code" },
    { phrase: "마감일은 금요일", style: "mark" },
    { phrase: "100명", style: "strong" },
    { phrase: "수치", style: "mark" },
  ]);
});

test("normalizeOfficeHoursEmphasis caps at five spans", () => {
  const text = "a b c d e f g";
  const emphasis = normalizeOfficeHoursEmphasis(
    ["a", "b", "c", "d", "e", "f", "g"].map((phrase) => ({ phrase, style: "strong" })),
    text,
  );
  assert.equal(emphasis.length, 5);
});

test("normalizeOfficeHoursEmphasis returns [] for non-array/empty input", () => {
  assert.deepEqual(normalizeOfficeHoursEmphasis(undefined, "anything"), []);
  assert.deepEqual(normalizeOfficeHoursEmphasis([], "anything"), []);
  assert.deepEqual(normalizeOfficeHoursEmphasis("not an object", "anything"), []);
});

test("Office Hours inline decision forwards normalized emphasis alongside highlightPhrases", () => {
  const question = "config.json 파일에 마감일을 기록했나요?";
  const payload = buildOfficeHoursInlineStructuredPromptPayload({
    sessionId: "session-emphasis",
    provider: "claude",
    assistantMessage: {
      content: "다음 증거를 확인할까요?",
      inlineDecision: {
        header: "현재 대안",
        intent: "status_quo",
        question,
        helperText: "한 가지 증거만 고르세요.",
        highlightPhrases: ["config.json"],
        emphasis: [
          { phrase: "config.json", style: "code" },
          { phrase: "마감일", style: "mark" },
          { phrase: "없는 구절", style: "strong" }, // not in text -> dropped
        ],
        options: [
          { label: "기록했다", description: "증거가 있습니다." },
          { label: "아직 안 했다", description: "증거가 없습니다." },
        ],
        allowFreeText: true,
        requiresFreeText: false,
      },
    },
  });

  assert.ok(payload, "payload should be produced");
  const built = payload.questions[0];
  // highlightPhrases remains for back-compat.
  assert.deepEqual(built.highlightPhrases, ["config.json"]);
  // emphasis carries style-aware spans, drops the non-substring entry.
  assert.deepEqual(built.emphasis, [
    { phrase: "config.json", style: "code" },
    { phrase: "마감일", style: "mark" },
  ]);
});

test("Office Hours inline decision omits emphasis key when none survive normalization", () => {
  const payload = buildOfficeHoursInlineStructuredPromptPayload({
    sessionId: "session-no-emphasis",
    provider: "claude",
    assistantMessage: {
      content: "다음 증거를 확인할까요?",
      inlineDecision: {
        header: "현재 대안",
        intent: "status_quo",
        question: "지금은 무엇으로 버티고 있나요?",
        options: [
          { label: "수작업", description: "직접 합니다." },
          { label: "다른 도구", description: "유료 도구를 씁니다." },
        ],
        allowFreeText: true,
        requiresFreeText: false,
      },
    },
  });

  assert.ok(payload, "payload should be produced");
  assert.equal("emphasis" in payload.questions[0], false);
});

test("extractOfficeHoursChatEmphasis strips the sentinel block and normalizes spans", () => {
  const reply = [
    "오늘 마감은 6월 4일까지입니다. config.json 파일을 먼저 확인하세요.",
    "",
    OFFICE_HOURS_EMPHASIS_SENTINEL_START,
    JSON.stringify([
      { phrase: "6월 4일", style: "mark" },
      { phrase: "config.json", style: "code" },
      { phrase: "오늘 마감", style: "strong" },
    ]),
    OFFICE_HOURS_EMPHASIS_SENTINEL_END,
  ].join("\n");

  const { text, emphasis } = extractOfficeHoursChatEmphasis(reply);

  assert.equal(text, "오늘 마감은 6월 4일까지입니다. config.json 파일을 먼저 확인하세요.");
  assert.equal(text.includes(OFFICE_HOURS_EMPHASIS_SENTINEL_START), false);
  assert.equal(text.includes(OFFICE_HOURS_EMPHASIS_SENTINEL_END), false);
  assert.deepEqual(emphasis, [
    { phrase: "6월 4일", style: "mark" },
    { phrase: "config.json", style: "code" },
    { phrase: "오늘 마감", style: "strong" },
  ]);
});

test("extractOfficeHoursChatEmphasis drops spans that are not substrings of the cleaned body", () => {
  const reply = [
    "핵심은 실제 결제 증거입니다.",
    OFFICE_HOURS_EMPHASIS_SENTINEL_START,
    JSON.stringify([
      { phrase: "실제 결제", style: "strong" },
      { phrase: "존재하지 않는 구절", style: "mark" },
    ]),
    OFFICE_HOURS_EMPHASIS_SENTINEL_END,
  ].join("\n");

  const { text, emphasis } = extractOfficeHoursChatEmphasis(reply);

  assert.equal(text, "핵심은 실제 결제 증거입니다.");
  assert.deepEqual(emphasis, [{ phrase: "실제 결제", style: "strong" }]);
});

test("extractOfficeHoursChatEmphasis is a no-op when no sentinel is present", () => {
  const reply = "평범한 자유 응답입니다. 강조 없음.";
  const { text, emphasis } = extractOfficeHoursChatEmphasis(reply);
  assert.equal(text, reply);
  assert.deepEqual(emphasis, []);
});

test("extractOfficeHoursChatEmphasis tolerates malformed sentinel JSON without throwing", () => {
  const reply = [
    "본문은 보존되어야 합니다.",
    OFFICE_HOURS_EMPHASIS_SENTINEL_START,
    "{ not valid json",
    OFFICE_HOURS_EMPHASIS_SENTINEL_END,
  ].join("\n");

  const { text, emphasis } = extractOfficeHoursChatEmphasis(reply, { logger: { warn: () => {} } });

  assert.equal(text, reply);
  assert.deepEqual(emphasis, []);
});

test("extractOfficeHoursChatEmphasis returns empty for non-string input", () => {
  assert.deepEqual(extractOfficeHoursChatEmphasis(undefined), { text: "", emphasis: [] });
  assert.deepEqual(extractOfficeHoursChatEmphasis(""), { text: "", emphasis: [] });
});
