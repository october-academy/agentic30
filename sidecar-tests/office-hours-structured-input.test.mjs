import test from "node:test";
import assert from "node:assert/strict";
import {
  OFFICE_HOURS_INLINE_MODE,
  OFFICE_HOURS_TOOL_MODE,
  OFFICE_HOURS_EMPHASIS_SENTINEL_END,
  OFFICE_HOURS_EMPHASIS_SENTINEL_START,
  buildContextualOfficeHoursQuestion,
  buildOfficeHoursInlineStructuredPromptPayload,
  buildOfficeHoursStructuredQuestionTranscriptText,
  buildOfficeHoursStructuredInputContinuationPrompt,
  ensureOfficeHoursGeneration,
  extractOfficeHoursChatEmphasis,
  formatSelectedOptionEvidenceHint,
  isOfficeHoursStructuredInputMode,
  isOfficeHoursStructuredInputToolEvent,
  officeHoursStructuredInputChannel,
  prepareOfficeHoursStructuredInputRequest,
  normalizeOfficeHoursEmphasis,
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

test("ensureOfficeHoursGeneration stamps a tool-channel request so it is treated as Office Hours", () => {
  // Shape produced by createUserInputRequest in canUseTool / mcp-server: no generation.
  const stamped = ensureOfficeHoursGeneration({
    toolName: "AskUserQuestion",
    title: "Office Hours",
    questions: [
      {
        header: "수요 증거",
        question: "Agentic30 수요를 실제 행동으로 확인한 가장 강한 증거는 무엇인가요?",
        options: [{ label: "실제 결제/계약이 있었다", description: "돈이 움직였다" }],
      },
    ],
  });

  assert.equal(stamped.generation.mode, OFFICE_HOURS_TOOL_MODE);
  assert.equal(isOfficeHoursStructuredInputMode(stamped.generation.mode), true);
  // Intent is derived from the demand header so the turn carries signal lineage.
  assert.equal(stamped.generation.signalId, "office_hours_demand_evidence");
  assert.equal(typeof stamped.generation.signalLabel, "string");
  assert.ok(stamped.generation.signalLabel.length > 0);
});

test("ensureOfficeHoursGeneration leaves an existing Office Hours generation untouched", () => {
  const inline = {
    title: "Office Hours",
    questions: [{ header: "현재 대안", question: "지금 무엇으로 버티나요?" }],
    generation: { mode: OFFICE_HOURS_INLINE_MODE, signalId: "office_hours_status_quo" },
  };
  const result = ensureOfficeHoursGeneration(inline);
  assert.equal(result, inline);
  assert.equal(result.generation.mode, OFFICE_HOURS_INLINE_MODE);
});

test("ensureOfficeHoursGeneration does not override a non-Office-Hours generation (IDD docType)", () => {
  const idd = {
    title: "ICP adaptive follow-up",
    questions: [{ header: "근거 보완", question: "어떤 근거를 고정할까요?" }],
    generation: { mode: "provider_adaptive", docType: "icp" },
  };
  const result = ensureOfficeHoursGeneration(idd);
  assert.equal(result, idd);
  assert.equal(result.generation.docType, "icp");
  assert.equal(isOfficeHoursStructuredInputMode(result.generation.mode), false);
});

test("ensureOfficeHoursGeneration stamps mode only when intent is unresolved", () => {
  const stamped = ensureOfficeHoursGeneration({
    title: "Office Hours",
    questions: [{ header: "메모", question: "한 줄로 정리해 주세요." }],
  });
  assert.equal(stamped.generation.mode, OFFICE_HOURS_TOOL_MODE);
  // No confident intent -> no misleading demand signal stamped.
  assert.equal(stamped.generation.signalId, undefined);
  assert.equal(stamped.generation.signalLabel, undefined);
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

test("prepareOfficeHoursStructuredInputRequest canonicalizes choices and stamps a tool-channel request", () => {
  // Shape produced by createUserInputRequest in canUseTool / mcp-server: no generation.
  const prepared = prepareOfficeHoursStructuredInputRequest({
    toolName: "agentic30_request_user_input",
    title: "Office Hours",
    questions: [
      {
        questionId: "office_hours_demand_evidence",
        header: "수요 증거",
        question: "Agentic30 수요를 실제 행동으로 확인한 가장 강한 증거는 무엇인가요?",
        options: [
          { label: "old 1", description: "돈" },
          { label: "old 2", description: "조건" },
        ],
        allowFreeText: true,
        requiresFreeText: true,
      },
    ],
  });

  // normalize: demand choices canonicalized to the fixed four.
  assert.deepEqual(
    prepared.questions[0].options.map((o) => o.label),
    [
      "실제 결제/계약이 있었다",
      "구매 조건이 구체적으로 확인됐다",
      "현재 대안에 돈/시간을 쓰고 있다",
      "관심만 있거나 아직 증거가 없다",
    ],
  );
  // ensure: Office Hours generation stamped so the Mac timeline renders a card.
  assert.equal(prepared.generation.mode, OFFICE_HOURS_TOOL_MODE);
  assert.equal(isOfficeHoursStructuredInputMode(prepared.generation.mode), true);
  assert.equal(prepared.generation.signalId, "office_hours_demand_evidence");
});

test("prepareOfficeHoursStructuredInputRequest leaves an inline-promoted request untouched", () => {
  const inline = {
    title: "Office Hours",
    questions: [{ header: "현재 대안", question: "지금 무엇으로 버티나요?" }],
    generation: { mode: OFFICE_HOURS_INLINE_MODE, signalId: "office_hours_status_quo" },
  };
  const prepared = prepareOfficeHoursStructuredInputRequest(inline);
  assert.equal(prepared.generation.mode, OFFICE_HOURS_INLINE_MODE);
  assert.equal(prepared.generation.signalId, "office_hours_status_quo");
});

test("prepareOfficeHoursStructuredInputRequest fills an empty or 'Question' header with the intent header (card-title parity)", () => {
  // Claude's normalizeClaudeQuestions can leave the header empty (and historically
  // injected a literal English "Question"); the tool-channel card must show the
  // same Korean intent header the inline (Gemini) path produces, never a placeholder.
  const baseQuestion = {
    question: "지금 이 문제를 어떤 대안으로 해결하고 있나요?",
    options: [
      { label: "수작업", description: "직접 처리" },
      { label: "다른 도구", description: "우회" },
    ],
  };

  const emptyHeader = prepareOfficeHoursStructuredInputRequest({
    title: "Office Hours",
    questions: [{ ...baseQuestion, header: "" }],
  });
  assert.equal(emptyHeader.questions[0].header, "현재 대안");

  const literalHeader = prepareOfficeHoursStructuredInputRequest({
    title: "Office Hours",
    questions: [{ ...baseQuestion, header: "Question" }],
  });
  assert.notEqual(literalHeader.questions[0].header, "Question");
  assert.equal(literalHeader.questions[0].header, "현재 대안");
});

test("prepareOfficeHoursStructuredInputRequest carries and validates tool-channel emphasis spans (statement-styling parity)", () => {
  const prepared = prepareOfficeHoursStructuredInputRequest({
    title: "Office Hours",
    questions: [
      {
        header: "현재 대안",
        question: "지금 이 문제를 어떤 대안으로 해결하고 있나요?",
        options: [
          { label: "수작업", description: "직접 처리" },
          { label: "다른 도구", description: "우회" },
        ],
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
