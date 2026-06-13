import {
  CODEX_STRUCTURED_INPUT_TOOL,
  isStructuredInputToolName,
} from "./structured-input-tools.mjs";
import { normalizeOfficeHoursUiCopyRequest } from "./office-hours-copy-rules.mjs";

export const OFFICE_HOURS_INLINE_MODE = "office_hours_inline";
// Origin stamp for Office Hours questions asked through the host TOOL channel
// (Claude AskUserQuestion via canUseTool, Codex agentic30_request_user_input via
// the MCP subprocess) as opposed to the inline-decision text channel. Kept
// distinct from OFFICE_HOURS_INLINE_MODE so memory turns and telemetry can tell
// which channel produced the answer, while both are recognized as Office Hours
// structured input.
export const OFFICE_HOURS_TOOL_MODE = "office_hours_tool";

const OFFICE_HOURS_STRUCTURED_MODES = new Set([
  "office_hours",
  OFFICE_HOURS_INLINE_MODE,
  OFFICE_HOURS_TOOL_MODE,
]);

const DEFAULT_OFFICE_HOURS_QUESTION =
  "Agentic30 수요를 실제 행동으로 확인한 가장 강한 증거는 무엇인가요?";

// 모든 Office Hours 인터뷰 질문은 선택지와 자유 입력 탈출구를 명시해야 한다.
// 이 모듈은 누락된 allowFreeText/requiresFreeText/generation 계약을 보정하지
// 않는다. 잘못된 provider payload는 즉시 계약 위반으로 실패한다.
const DEMAND_EVIDENCE_QUESTION_ID = "office_hours_demand_evidence";
const ACTIVE_USER_DEFINITION_QUESTION_ID = "get_users_active_user_definition";
const DEMAND_EVIDENCE_OPTIONS = Object.freeze([
  Object.freeze({
    label: "실제 결제/계약이 있었다",
    description: "돈이 이미 움직였으므로 가장 강한 증거입니다. 다음 검증은 구매자가 고객 후보와 맞는지입니다.",
    nextIntent: "actual_payment_or_contract",
    recommended: true,
    risk: "결제 주체와 날짜가 없으면 말뿐인 관심으로 낮춰 봐야 합니다.",
    evidenceTarget: "실명, 날짜, 결제 또는 계약 절차",
    mapsTo: "Q1 Demand Reality",
    failureMode: "돈이 움직였다는 사실을 못 쓰면 구매 조건 이하로 낮춥니다.",
  }),
  Object.freeze({
    label: "구매 조건이 구체적으로 확인됐다",
    description: "가격, 범위, 일정 조건이 있으면 다음 검증은 실제 결제 전환입니다.",
    nextIntent: "concrete_purchase_conditions",
    risk: "실제 결제 전환 전까지는 의향 신호에 머뭅니다.",
    evidenceTarget: "가격, 범위, 구매 시점, 결제권자 중 하나 이상",
    mapsTo: "Q1 Demand Reality",
    failureMode: "조건이 구체적이지 않으면 관심 신호로 낮춥니다.",
  }),
  Object.freeze({
    label: "현재 대안에 돈/시간을 쓰고 있다",
    description: "유료 대안이나 반복 행동이 있어도 전환 이유와 대체 우위는 남습니다.",
    nextIntent: "paid_or_time_current_alternative",
    risk: "현재 방식이 충분히 싸거나 익숙하면 전환 동기가 약할 수 있습니다.",
    evidenceTarget: "현재 대안 비용, 반복 시간, 우회 수단",
    mapsTo: "Q1 Demand Reality",
    failureMode: "돈이나 반복 시간이 작으면 관심 신호로 낮춥니다.",
  }),
  Object.freeze({
    label: "관심만 있거나 아직 증거가 없다",
    description: "칭찬, 가격 질문, 막연한 관심은 수요가 아니며 첫 행동 증거가 필요합니다.",
    nextIntent: "verbal_interest_or_no_evidence",
    risk: "오늘 답으로는 수요 판단이 불가능합니다.",
    evidenceTarget: "실명 3명의 현재 대안, 지출, 첫 결제 조건",
    mapsTo: "Q1 Demand Reality",
    failureMode: "실제 행동 없이 제품을 만들면 수요 공백이 남습니다.",
  }),
]);
const ACTIVE_USER_DEFINITION_OPTIONS = Object.freeze([
  Object.freeze({
    label: "첫 가치 완료",
    description: "고객 후보가 첫 실행 기록, 검증 행동, 다음 과제까지 제품의 핵심 결과를 처음 끝낸 순간만 활성 사용자로 셉니다.",
    nextIntent: "first_value_completed",
    recommended: true,
    risk: "가입이나 방문만으로는 실제 사용이 증명되지 않습니다.",
    evidenceTarget: "첫 가치 완료 이벤트, 실행 기록, 검증 행동, 다음 과제",
    mapsTo: "get_users_active_user_definition",
    failureMode: "핵심 결과 완료가 없으면 활성 사용자로 세지 않습니다.",
  }),
  Object.freeze({
    label: "반복 사용 완료",
    description: "정해진 기간 안에 같은 고객 후보가 다시 돌아와 핵심 행동을 반복한 경우만 셉니다.",
    nextIntent: "repeat_use_completed",
    risk: "반복 기준이 너무 높으면 초기 유입 실험 속도가 느려질 수 있습니다.",
    evidenceTarget: "재방문/반복 핵심 행동 이벤트",
    mapsTo: "get_users_active_user_definition",
    failureMode: "한 번 둘러본 사용자나 단순 가입자는 제외합니다.",
  }),
  Object.freeze({
    label: "수동 파일럿 성공",
    description: "자동화 전이라도 수동으로 고객 후보의 문제를 해결하고 결과 확인까지 끝낸 사람만 셉니다.",
    nextIntent: "manual_pilot_success",
    risk: "수동 성공을 제품 사용으로 착각하지 않도록 완료 기준과 증거를 남겨야 합니다.",
    evidenceTarget: "파일럿 완료 기록, 사용자 반응, 다음 행동/과제",
    mapsTo: "get_users_active_user_definition",
    failureMode: "관심 표현이나 미완료 상담은 제외합니다.",
  }),
]);
const KNOWN_OFFICE_HOURS_INTENTS = new Set([
  "demand",
  "stage",
  "status_quo",
  "wedge",
  "observation",
  "premise",
  "alternatives",
  "future_fit",
  "get_users_active_user_definition",
]);

// Single source of truth for HOW each provider asks an Office Hours forcing
// question. The asking mechanism differs by provider capability, but all three
// converge on the same pendingUserInput card:
//   - claude: native AskUserQuestion tool (intercepted in-process by canUseTool)
//   - codex:  agentic30_request_user_input MCP tool (spawned subprocess)
//   - gemini: inline_decision sentinel — text-only, no host tool channel
// `promptToken` is the noun the system prompt interpolates into its
// forcing-question rules; `toolName` is the label carried on the promoted /
// answered request; `kind` ("tool" | "inline") drives tool-vs-sentinel guidance
// without hard-coding a provider name.
export function officeHoursStructuredInputChannel(provider = "codex") {
  const normalized = String(provider || "").toLowerCase();
  if (normalized === "claude") {
    return Object.freeze({
      provider: "claude",
      kind: "tool",
      toolName: "AskUserQuestion",
      promptToken: "AskUserQuestion",
    });
  }
  if (normalized === "gemini") {
    return Object.freeze({
      provider: "gemini",
      kind: "inline",
      // Label only — Gemini cannot invoke a host tool; its card is produced by
      // promoting the inline_decision sentinel it emits as text.
      toolName: CODEX_STRUCTURED_INPUT_TOOL,
      promptToken: "inline_decision sentinel block",
    });
  }
  return Object.freeze({
    provider: "codex",
    kind: "tool",
    toolName: CODEX_STRUCTURED_INPUT_TOOL,
    promptToken: CODEX_STRUCTURED_INPUT_TOOL,
  });
}

export function isOfficeHoursStructuredInputMode(mode = "") {
  return OFFICE_HOURS_STRUCTURED_MODES.has(String(mode || "").trim());
}

export function isOfficeHoursStructuredInputToolEvent(event = {}) {
  const payload = event?.payload && typeof event.payload === "object" ? event.payload : {};
  return [
    event?.toolName,
    payload.requestedToolName,
    payload.toolName,
    payload.name,
  ].some((value) => isStructuredInputToolName(value));
}

// Single entry point that makes an explicitly stamped Office Hours structured
// input request card-ready. This is fail-closed: callers must provide
// generation.mode, signal lineage, options, and free-text flags up front.
// Normalize one question's PRESENTATION so the stacked card renders identically
// regardless of which provider/channel produced it:
//  - highlightPhrases / emphasis: validate + derive them the same way the inline
//    path does (option-label highlights, substring-checked emphasis spans) so the
//    question-statement styling is consistent across providers. The tool channels
//    now carry these through (mcp-server schema + normalizeClaudeQuestions), and
//    the prompt already asks every provider to attach emphasis spans.
function normalizeOfficeHoursQuestionPresentation(question = {}) {
  if (!question || typeof question !== "object") return question;
  const rawHeader = String(question.header || "").trim();
  const header = rawHeader.slice(0, 32);
  const highlightPhrases = normalizeOfficeHoursHighlightPhrases(
    question.highlightPhrases || question.highlight_phrases || question.highlights,
    question.question,
    Array.isArray(question.options) ? question.options : [],
  );
  const emphasis = normalizeOfficeHoursEmphasis(
    question.emphasis || question.emphasis_spans || question.emphasisSpans,
    question.question,
  );
  const next = { ...question, header };
  if (highlightPhrases.length) next.highlightPhrases = highlightPhrases;
  else delete next.highlightPhrases;
  if (emphasis.length) next.emphasis = emphasis;
  else delete next.emphasis;
  return next;
}

export function prepareOfficeHoursStructuredInputRequest(request = {}) {
  const shouldValidate = isLikelyOfficeHoursStructuredInputRequest(request);
  if (shouldValidate) {
    assertOfficeHoursStructuredInputContract(request);
  }
  const withUiCopy = isOfficeHoursStructuredInputMode(request?.generation?.mode)
    ? normalizeOfficeHoursUiCopyRequest(request)
    : request;
  const withPresentation = Array.isArray(withUiCopy?.questions)
    ? { ...withUiCopy, questions: withUiCopy.questions.map(normalizeOfficeHoursQuestionPresentation) }
    : withUiCopy;
  if (shouldValidate) {
    assertOfficeHoursStructuredInputContract(withPresentation);
  }
  return withPresentation;
}

function isLikelyOfficeHoursStructuredInputRequest(request = {}) {
  if (!request || typeof request !== "object") return false;
  if (isOfficeHoursStructuredInputMode(request.generation?.mode)) return true;
  return String(request.title || "").trim().toLowerCase() === "office hours";
}

export function assertOfficeHoursStructuredInputContract(request = {}) {
  if (!request || typeof request !== "object") {
    throw officeHoursStructuredInputContractError("request must be an object");
  }
  if (!isOfficeHoursStructuredInputMode(request.generation?.mode)) {
    throw officeHoursStructuredInputContractError("generation.mode must be office_hours_tool or office_hours_inline");
  }
  const signalId = String(request.generation?.signalId || request.generation?.signal_id || "").trim();
  const signalLabel = String(request.generation?.signalLabel || request.generation?.signal_label || "").trim();
  if (!signalId) {
    throw officeHoursStructuredInputContractError("generation.signalId is required");
  }
  if (!signalLabel) {
    throw officeHoursStructuredInputContractError("generation.signalLabel is required");
  }
  const questions = Array.isArray(request.questions) ? request.questions : [];
  if (questions.length !== 1) {
    throw officeHoursStructuredInputContractError("Office Hours requests must contain exactly one question");
  }
  const question = questions[0] || {};
  const header = String(question.header || "").trim();
  if (!header || header.toLowerCase() === "question") {
    throw officeHoursStructuredInputContractError("question.header must be an explicit Korean card header");
  }
  if (question.allowFreeText !== true) {
    throw officeHoursStructuredInputContractError("question.allowFreeText must be true");
  }
  if (question.requiresFreeText !== false) {
    throw officeHoursStructuredInputContractError("question.requiresFreeText must be false");
  }
  const options = Array.isArray(question.options) ? question.options : [];
  if (options.length < 2 || options.length > 4) {
    throw officeHoursStructuredInputContractError("question.options must contain 2-4 choices");
  }
  if (options.some((option) => isOtherTextOptionLabel(option?.label))) {
    throw officeHoursStructuredInputContractError("direct-input choices are not allowed; use allowFreeText instead");
  }
  if (signalId === DEMAND_EVIDENCE_QUESTION_ID) {
    assertExactOfficeHoursOptionLabels(
      options,
      DEMAND_EVIDENCE_OPTIONS.map((option) => option.label),
      "office_hours_demand_evidence",
    );
  }
  if (signalId === ACTIVE_USER_DEFINITION_QUESTION_ID) {
    assertExactOfficeHoursOptionLabels(
      options,
      ACTIVE_USER_DEFINITION_OPTIONS.map((option) => option.label),
      "get_users_active_user_definition",
    );
  }
}

function assertExactOfficeHoursOptionLabels(options, expectedLabels, signalId) {
  const labels = options.map((option) => String(option?.label || "").trim());
  if (labels.length !== expectedLabels.length
    || labels.some((label, index) => label !== expectedLabels[index])) {
    throw officeHoursStructuredInputContractError(
      `${signalId} options must be exactly: ${expectedLabels.join("; ")}`,
    );
  }
}

function officeHoursStructuredInputContractError(detail) {
  const error = new Error(`Office Hours structured input contract violation: ${detail}.`);
  error.code = "ERR_OFFICE_HOURS_STRUCTURED_INPUT_CONTRACT";
  return error;
}

function isOtherTextOptionLabel(label) {
  const normalized = String(label || "")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[()（）]/g, " ")
    .toLowerCase()
    .trim();
  return /(?:^|[\s:：\-_/])직접\s*입력(?:$|[\s:：\-_/])/.test(normalized)
    || /^기타(?:$|[\s:：\-_/])/.test(normalized)
    || /^other(?:$|[\s:：\-_/])/.test(normalized);
}

export function stripTrailingRubricFocusMetadata(content = "") {
  let cleaned = String(content ?? "");
  let previous;
  do {
    previous = cleaned;
    cleaned = cleaned.replace(
      /(?:\r?\n)?[ \t]*rubric_focus\s*:\s*\[[^\]\r\n]*\][ \t]*$/i,
      "",
    );
  } while (cleaned !== previous);
  return cleaned.trim();
}

export function buildOfficeHoursStructuredQuestionTranscriptText(promptRequest = {}) {
  const questions = Array.isArray(promptRequest?.questions) ? promptRequest.questions : [];
  return questions
    .map((question) => normalizeTranscriptQuestionText(question?.question))
    .filter(Boolean)
    .join("\n\n");
}

export function shouldAppendOfficeHoursStructuredQuestionMessage(messages = [], questionText = "") {
  const normalizedQuestion = normalizeTranscriptQuestionText(questionText).toLowerCase();
  if (!normalizedQuestion) return false;
  const lastAssistant = [...(Array.isArray(messages) ? messages : [])]
    .reverse()
    .find((message) => message?.role === "assistant" || message?.role === "system");
  const normalizedAssistant = normalizeTranscriptQuestionText(lastAssistant?.content).toLowerCase();
  return !normalizedAssistant.includes(normalizedQuestion);
}

export function buildOfficeHoursInlineStructuredPromptPayload({
  sessionId,
  provider = "codex",
  assistantMessage = null,
  context = "",
} = {}) {
  if (!sessionId) return null;
  const inlineDecision = assistantMessage?.inlineDecision || null;
  if (!inlineDecision) return null;
  const defaultQuestion = buildContextualOfficeHoursQuestion(context);
  const question = cleanOfficeHoursQuestion(
    String(inlineDecision.question || "").trim() || defaultQuestion,
  );
  const options = normalizeOfficeHoursOptions(inlineDecision?.options);
  if (options.length < 2) {
    throw officeHoursStructuredInputContractError("inline_decision.options must contain at least two choices");
  }
  const intent = resolveOfficeHoursQuestionIntent({
    inlineDecision,
    question,
    assistantContent: assistantMessage?.content || "",
  });
  if (!intent) {
    throw officeHoursStructuredInputContractError("inline_decision intent or signalId is required");
  }
  if (inlineDecision.allowFreeText !== true) {
    throw officeHoursStructuredInputContractError("inline_decision.allowFreeText must be true");
  }
  if (inlineDecision.requiresFreeText !== false) {
    throw officeHoursStructuredInputContractError("inline_decision.requiresFreeText must be false");
  }
  const highlightPhrases = normalizeOfficeHoursHighlightPhrases(
    inlineDecision?.highlightPhrases
      || inlineDecision?.highlight_phrases
      || inlineDecision?.highlights
      || inlineDecision?.highlight,
    question,
    options,
  );
  const emphasis = normalizeOfficeHoursEmphasis(
    inlineDecision?.emphasis
      || inlineDecision?.emphasis_spans
      || inlineDecision?.emphasisSpans,
    question,
  );

  const questions = [
    {
      questionId: resolveOfficeHoursQuestionId(inlineDecision, intent),
      header: String(inlineDecision?.header || "").trim().slice(0, 32) || officeHoursIntentHeader(intent),
      question,
      helperText:
        String(inlineDecision?.helperText || inlineDecision?.helper_text || "").trim().slice(0, 280)
        || "선택지로 답하면 Office Hours가 이어집니다.",
      ...(highlightPhrases.length ? { highlightPhrases } : {}),
      ...(emphasis.length ? { emphasis } : {}),
      ...(options.length ? { options } : {}),
      multiSelect: inlineDecision.multiSelect === true,
      allowFreeText: inlineDecision.allowFreeText,
      requiresFreeText: inlineDecision.requiresFreeText,
      ...(inlineDecision.freeTextPlaceholder || inlineDecision.free_text_placeholder
        ? {
            freeTextPlaceholder: String(
              inlineDecision.freeTextPlaceholder || inlineDecision.free_text_placeholder,
            ).trim().slice(0, 280),
          }
        : {}),
      textMode: inlineDecision.textMode === "long" ? "long" : "short",
    },
  ];

  const payload = {
    sessionId,
    toolName: officeHoursStructuredInputChannel(provider).toolName,
    title: "Office Hours",
    questions,
    generation: {
      mode: OFFICE_HOURS_INLINE_MODE,
      docType: "day1_step",
      signalId: resolveOfficeHoursSignalId(inlineDecision, intent),
      signalLabel: officeHoursSignalLabel(intent),
    },
  };
  return prepareOfficeHoursStructuredInputRequest(normalizeOfficeHoursUiCopyRequest(payload));
}

export function buildOfficeHoursStructuredInputContinuationPrompt({
  responseText = "",
  responseDescription = "",
} = {}) {
  const lines = [
    "Office Hours structured-card answer received.",
    "Use this answer as the user's latest Office Hours response and continue the YC forcing-question conversation.",
    "Do not end with a vague confirmation. If another decision or missing input is needed, ask the next forcing question through the host structured input tool with 2-4 options and allowFreeText: true.",
    "For fixed-count interviews, keep opening the next structured card until the expected count is reached or a terminal completion card is recorded; prose-only 'next assumption' text is a provider failure.",
    "",
    "## User structured-card answer",
    String(responseText || "").trim() || "(empty)",
  ];
  const description = String(responseDescription || "").trim();
  if (description) {
    lines.push("", "## Selected option evidence hints", description);
  }
  return lines.join("\n");
}

export function buildOfficeHoursInterviewAnswerLogAttributes({
  session = null,
  pendingUserInput = null,
  response = null,
  responseText = "",
  responseDescription = "",
  terminal = false,
} = {}) {
  const generation = pendingUserInput?.generation || {};
  const questions = Array.isArray(pendingUserInput?.questions) ? pendingUserInput.questions : [];
  const responseEntries = Array.isArray(response?.responses) ? response.responses : [];
  const responseByQuestion = new Map(
    responseEntries.map((entry) => [String(entry?.question || ""), entry]),
  );
  const normalizedResponses = questions.map((question) => {
    const questionText = String(question?.question || "");
    const entry = responseByQuestion.get(questionText) || {};
    const selectedOptions = Array.isArray(entry?.selectedOptions)
      ? entry.selectedOptions.map((option) => String(option)).filter(Boolean)
      : [];
    const selected = new Set(selectedOptions);
    const options = Array.isArray(question?.options)
      ? question.options.map((option) => normalizeOfficeHoursLogOption(option, selected))
      : [];
    return {
      question_id: String(question?.questionId || question?.question_id || question?.id || ""),
      header: String(question?.header || ""),
      question_text: questionText,
      helper_text: String(question?.helperText || question?.helper_text || ""),
      allow_free_text: question?.allowFreeText === true,
      requires_free_text: question?.requiresFreeText === true,
      multi_select: question?.multiSelect === true,
      text_mode: String(question?.textMode || question?.text_mode || ""),
      options,
      selected_options: selectedOptions,
      free_text: typeof entry?.freeText === "string" ? entry.freeText : "",
    };
  });
  return {
    log_type: "office_hours_interview_answer",
    session_id: String(session?.id || pendingUserInput?.sessionId || ""),
    request_id: String(pendingUserInput?.requestId || ""),
    provider: String(session?.provider || ""),
    day: normalizeOfficeHoursLogDay(session?.runtime?.officeHours?.day),
    source: String(session?.runtime?.officeHours?.source || ""),
    mode: String(generation?.mode || ""),
    signal_id: String(generation?.signalId || generation?.signal_id || ""),
    signal_label: String(generation?.signalLabel || generation?.signal_label || ""),
    terminal: terminal === true,
    question_count: normalizedResponses.length,
    responses: normalizedResponses,
    response_text: String(responseText || ""),
    response_description: String(responseDescription || ""),
  };
}

function normalizeOfficeHoursLogOption(option = {}, selected = new Set()) {
  const label = String(option?.label || "");
  return {
    label,
    description: String(option?.description || ""),
    next_intent: String(option?.nextIntent || option?.next_intent || ""),
    recommended: option?.recommended === true,
    risk: String(option?.risk || ""),
    evidence_target: String(option?.evidenceTarget || option?.evidence_target || ""),
    maps_to: String(option?.mapsTo || option?.maps_to || ""),
    failure_mode: String(option?.failureMode || option?.failure_mode || ""),
    selected: selected.has(label),
  };
}

function normalizeOfficeHoursLogDay(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

// Resolve a picked option back into a single hint string for the agent SDK.
// The card UI deliberately hides risk / evidence target / failure mode to stay
// scannable; this folds that same reasoning into the context the model receives
// alongside the user's choice so it can steer the next forcing question. Options
// without metadata (most non–Office-Hours cards) collapse to the description
// alone, preserving the prior behaviour.
export function formatSelectedOptionEvidenceHint(option = {}) {
  if (!option || typeof option !== "object") return "";
  const description = String(option.description || "").trim();
  if (!description) return "";
  const risk = String(option.risk || "").trim();
  const evidenceTarget = String(option.evidenceTarget || option.evidence_target || "").trim();
  const failureMode = String(option.failureMode || option.failure_mode || "").trim();
  const extras = [];
  if (risk) extras.push(`리스크: ${risk}`);
  if (evidenceTarget) extras.push(`근거: ${evidenceTarget}`);
  if (failureMode) extras.push(`실패 조건: ${failureMode}`);
  return extras.length ? `${description} (${extras.join(" · ")})` : description;
}

// The Mac client embeds "Expected question count: N" in the office-hours
// context it sends on start (ContentView's office-hours context builder).
// 0 means "unknown" — callers must treat that as "do not enforce a count".
export function parseExpectedOfficeHoursQuestionCount(context = "") {
  const match = /^Expected question count:\s*(\d+)\s*$/im.exec(String(context || ""));
  if (!match) return 0;
  const count = Number.parseInt(match[1], 10);
  return Number.isInteger(count) && count > 0 ? count : 0;
}

// Counts answered interview turns recorded for one session in the workspace
// turn log (workspace-memory.mjs appendOfficeHoursTurn writes one entry per
// submitted structured answer).
export function countOfficeHoursTurnsForSession(turnLog, sessionId = "") {
  const id = String(sessionId || "").trim();
  if (!id) return 0;
  const turns = Array.isArray(turnLog?.turns) ? turnLog.turns : [];
  return turns.filter((turn) => String(turn?.sessionId || "") === id).length;
}

export function buildOfficeHoursIncompleteInterviewMessage({ expected = 0, answered = 0 } = {}) {
  return `Office Hours 인터뷰가 질문 ${expected}개 중 ${answered}개만 진행하고 종료했습니다. 다시 시도해 주세요.`;
}

// The interview's contractual closing card. The system prompt tells the
// provider to smart-skip routed questions ("Do not force all six questions")
// and close with two terminal cards, the last being 대안 비교 with 최소안 /
// 이상안 / 다른 관점 options — so a legitimate interview can conclude with
// FEWER answers than the Mac client's "Expected question count" line says.
// Recognizing the closing card at answer-submit time lets the
// incomplete-interview gate treat "대안 비교 answered" as completion instead
// of failing the run on raw answer count (which permanently blocked Day 2:
// the retry rerun sees a finished transcript, asks nothing, and trips the
// same count check again).
// Matches any of: the alternatives signal stamp, the canonical 대안 비교
// header, or both 최소안 and 이상안 appearing among the option labels (the
// prompt mandates all three labels on the closing card; intent inference
// cannot be trusted here because "대안" also matches the status_quo regex).
export function isOfficeHoursTerminalAlternativesRequest(request = {}) {
  if (!request || typeof request !== "object") return false;
  const signalId = String(request?.generation?.signalId || "").trim().toLowerCase();
  if (signalId === "office_hours_alternatives") return true;
  const questions = Array.isArray(request.questions) ? request.questions : [];
  return questions.some((question) => {
    if (!question || typeof question !== "object") return false;
    const header = String(question.header || "").replace(/\s+/g, " ").trim();
    if (header === "대안 비교") return true;
    const labels = (Array.isArray(question.options) ? question.options : [])
      .map((option) => String(option?.label || ""));
    return labels.some((label) => label.includes("최소안"))
      && labels.some((label) => label.includes("이상안"));
  });
}

// True when the workspace turn log records a terminal (대안 비교) answer for
// this session — the durable counterpart of the runtime `terminalAnswered`
// stamp, so the incomplete-interview gate stays satisfied on a retry that
// rebuilt the session runtime after the closing answer was already submitted.
export function hasOfficeHoursTerminalTurnForSession(turnLog, sessionId = "") {
  const id = String(sessionId || "").trim();
  if (!id) return false;
  const turns = Array.isArray(turnLog?.turns) ? turnLog.turns : [];
  return turns.some((turn) => String(turn?.sessionId || "") === id && turn?.terminal === true);
}

export function buildContextualOfficeHoursQuestion(context = "") {
  const facts = extractOfficeHoursContextFacts(context);
  const customer = facts.customer || facts.icp;
  const problem = facts.problem || facts.pain || facts.missingSignal;
  const project = facts.project;

  if (project && customer && problem) {
    return `${project}에서 ${customer}가 “${problem}” 문제에 이미 돈, 시간, 우회 수단을 쓰고 있다는 가장 강한 증거는 무엇인가요?`;
  }
  if (customer && problem) {
    return `${customer}가 “${problem}” 문제에 이미 돈, 시간, 우회 수단을 쓰고 있다는 가장 강한 증거는 무엇인가요?`;
  }
  if (project && problem) {
    return `${project}에서 “${problem}” 문제가 실제 수요라는 가장 강한 증거는 무엇인가요?`;
  }
  if (project && customer) {
    return `${project}의 첫 고객 가정인 ${customer}가 지금 이 문제를 직접 해결하려는 가장 강한 증거는 무엇인가요?`;
  }
  return DEFAULT_OFFICE_HOURS_QUESTION;
}

function normalizeOfficeHoursOptions(options) {
  if (!Array.isArray(options)) return [];
  const normalized = options
    .map((option) => {
      const label = String(option?.label || "").trim();
      if (!label) return null;
      return {
        label: label.slice(0, 80),
        description:
          String(option?.description || "").trim().slice(0, 280)
          || "선택한 방향으로 Office Hours를 이어갑니다.",
        ...(option?.preview ? { preview: String(option.preview) } : {}),
        ...(option?.nextIntent ? { nextIntent: String(option.nextIntent) } : {}),
        ...(typeof option?.recommended === "boolean" ? { recommended: option.recommended } : {}),
        ...(option?.risk ? { risk: String(option.risk).trim().slice(0, 280) } : {}),
        ...(option?.evidenceTarget || option?.evidence_target
          ? { evidenceTarget: String(option.evidenceTarget || option.evidence_target).trim().slice(0, 280) }
          : {}),
        ...(option?.mapsTo || option?.maps_to
          ? { mapsTo: String(option.mapsTo || option.maps_to).trim().slice(0, 160) }
          : {}),
        ...(option?.failureMode || option?.failure_mode
          ? { failureMode: String(option.failureMode || option.failure_mode).trim().slice(0, 280) }
          : {}),
      };
    })
    .filter(Boolean)
    .slice(0, 7);

  return normalized;
}

function resolveOfficeHoursQuestionIntent({
  inlineDecision = null,
  question = "",
  assistantContent = "",
} = {}) {
  const explicit = normalizeOfficeHoursIntent(
    inlineDecision?.intent
      || inlineDecision?.questionIntent
      || inlineDecision?.question_intent
      || inlineDecision?.signalId
      || inlineDecision?.signal_id
      || inlineDecision?.header,
  );
  if (explicit) return explicit;

  const haystack = [
    question,
    assistantContent,
    inlineDecision?.question,
    inlineDecision?.header,
  ].filter(Boolean).join("\n").toLowerCase();
  if (/active user|activated users|activation action|활성 사용자|활성\s*행동|핵심\s*활성|첫 가치|반복 사용|수동 파일럿/.test(haystack)) {
    return "get_users_active_user_definition";
  }
  if (/demand|수요|증거|누가.*원하|관심 말고|돈.*시간.*우회|would.*upset/.test(haystack)) {
    return "demand";
  }
  if (/stage|단계|pre[-_ ]?product|has users|paying customers|제품 단계|사용자.*있|결제/.test(haystack)) {
    return "stage";
  }
  if (/status quo|대안|우회|수작업|지금.*쓰|무엇으로 버티|cost|비용/.test(haystack)) {
    return "status_quo";
  }
  if (/wedge|가장 작은|smallest|이번 주.*돈|유료.*버전|결제.*작은/.test(haystack)) {
    return "wedge";
  }
  if (/observe|observation|관찰|도움 없이|막히|surprise|놀라/.test(haystack)) {
    return "observation";
  }
  if (/premise|전제|맞는 문제|do nothing|안 하면|증거 공백|evidence gap/.test(haystack)) {
    return "premise";
  }
  if (/alternative|alternatives|접근|최소안|이상안|다른 관점|approach/.test(haystack)) {
    return "alternatives";
  }
  if (/future|3년|미래|trend|추세/.test(haystack)) {
    return "future_fit";
  }
  return "";
}

function normalizeOfficeHoursIntent(value = "") {
  const text = String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (!text) return "";
  if (text.includes("demand") || text.includes("q1") || text.includes("수요")) return "demand";
  if (text.includes("stage")) return "stage";
  if (text.includes("status_quo") || text.includes("status") || text.includes("q2")) return "status_quo";
  if (text.includes("wedge") || text.includes("q4")) return "wedge";
  if (text.includes("observation") || text.includes("observe") || text.includes("q5")) return "observation";
  if (text.includes("premise")) return "premise";
  if (text.includes("alternative")) return "alternatives";
  if (text.includes("future") || text.includes("q6")) return "future_fit";
  if (text.includes("get_users_active_user_definition") || text.includes("active_user") || text.includes("activation")) return "get_users_active_user_definition";
  return KNOWN_OFFICE_HOURS_INTENTS.has(text) ? text : "";
}

function resolveOfficeHoursQuestionId(inlineDecision, intent = "") {
  const explicit = String(
    inlineDecision?.questionId
      || inlineDecision?.question_id
      || inlineDecision?.id
      || "",
  ).trim();
  if (explicit) return explicit.slice(0, 96);
  const key = normalizeOfficeHoursIntent(intent);
  if (key === "premise") return "office_hours_premise_challenge";
  if (key === "alternatives") return "office_hours_alternatives";
  if (key === "get_users_active_user_definition") return ACTIVE_USER_DEFINITION_QUESTION_ID;
  if (key === "demand") return DEMAND_EVIDENCE_QUESTION_ID;
  if (key) return `office_hours_${key}`;
  return "";
}

function resolveOfficeHoursSignalId(inlineDecision, intent = "") {
  const explicit = String(
    inlineDecision?.signalId
      || inlineDecision?.signal_id
      || "",
  ).trim();
  if (explicit) return explicit.slice(0, 96);
  return resolveOfficeHoursQuestionId(inlineDecision, intent);
}

function officeHoursIntentHeader(intent = "") {
  switch (normalizeOfficeHoursIntent(intent)) {
    case "demand":
      return "수요 증거";
    case "stage":
      return "제품 단계";
    case "status_quo":
      return "현재 대안";
    case "wedge":
      return "가장 좁은 첫 진입점";
    case "observation":
      return "직접 관찰";
    case "premise":
      return "전제 확인";
    case "alternatives":
      return "대안 비교";
    case "future_fit":
      return "앞으로 더 중요해질 이유";
    case "get_users_active_user_definition":
      return "활성 사용자 기준";
    default:
      return "";
  }
}

function officeHoursSignalLabel(intent = "") {
  switch (normalizeOfficeHoursIntent(intent)) {
    case "demand":
      return "Office Hours Q1 수요 증거";
    case "stage":
      return "Office Hours 제품 단계";
    case "status_quo":
      return "Office Hours Q2 현재 대안";
    case "wedge":
      return "Office Hours Q4 가장 좁은 첫 진입점";
    case "observation":
      return "Office Hours Q5 직접 관찰";
    case "premise":
      return "Office Hours 전제 확인";
    case "alternatives":
      return "Office Hours 대안 비교";
    case "future_fit":
      return "Office Hours Q6 앞으로 더 중요해질 이유";
    case "get_users_active_user_definition":
      return "활성 사용자 기준";
    default:
      return "";
  }
}

function normalizeOfficeHoursHighlightPhrases(value, question = "", options = []) {
  const explicit = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? [value]
      : [];
  const questionText = String(question || "");
  const derived = [];
  for (const option of options) {
    for (const candidate of optionHighlightCandidates(option?.label || "")) {
      if (candidate && questionText.toLowerCase().includes(candidate.toLowerCase())) {
        derived.push(candidate);
      }
    }
  }

  const seen = new Set();
  return [...explicit, ...derived]
    .map((entry) => String(entry || "").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length || a.localeCompare(b))
    .filter((entry) => {
      const key = entry.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 5);
}

const OFFICE_HOURS_EMPHASIS_STYLES = new Set(["strong", "mark", "code"]);

// Validate and normalize dynamic emphasis spans the LLM attached to a question.
// Each span is { phrase, style }: phrase must be a non-empty trimmed string and,
// when `text` is provided, a case-insensitive substring of it (so the Mac
// renderer can actually match it). Unknown/unsupported styles fall back to
// "mark". Dedups by phrase and caps at five spans to keep statements scannable.
export function normalizeOfficeHoursEmphasis(raw, text = "") {
  const list = Array.isArray(raw) ? raw : raw && typeof raw === "object" ? [raw] : [];
  const source = String(text || "");
  const hasSource = source.length > 0;
  const lowerSource = source.toLowerCase();
  const seen = new Set();
  const normalized = [];
  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue;
    const phrase = String(entry.phrase || entry.text || "")
      .replace(/\s+/g, " ")
      .trim();
    if (!phrase) continue;
    if (hasSource && !lowerSource.includes(phrase.toLowerCase())) continue;
    const key = phrase.toLowerCase();
    if (seen.has(key)) continue;
    const rawStyle = String(entry.style || entry.kind || "").trim().toLowerCase();
    const style = OFFICE_HOURS_EMPHASIS_STYLES.has(rawStyle) ? rawStyle : "mark";
    seen.add(key);
    normalized.push({ phrase, style });
    if (normalized.length >= 5) break;
  }
  return normalized;
}

// Sentinel tokens for embedding dynamic emphasis spans inside an Office Hours
// free-response chat reply. Provider SDKs do not expose a metadata side-channel,
// so — mirroring INLINE_DECISION_SENTINEL — the LLM rides the text channel and
// emits an emphasis block; the host strips it before showing the message.
//
// Wire contract:
//   <visible reply body>
//   ===EMPHASIS===
//   [{ "phrase": "<exact substring of the body>", "style": "strong|mark|code" }]
//   ===END===
//
// The block may appear anywhere. `phrase` MUST be an exact (case-insensitive)
// substring of the cleaned reply body or it is dropped by
// `normalizeOfficeHoursEmphasis`. Unknown styles fall back to "mark". Capped at
// five spans. Reuses the END token from the inline_decision contract so the
// two wire formats share a single closing delimiter.
export const OFFICE_HOURS_EMPHASIS_SENTINEL_START = "===EMPHASIS===";
export const OFFICE_HOURS_EMPHASIS_SENTINEL_END = "===END===";

// Extracts an emphasis array from a chat free-response body. Returns
// `{ text, emphasis }` where `text` is the input with the sentinel block
// removed and `emphasis` is the normalized span list (substring-matched against
// the cleaned text, deduped, max 5). When no sentinel is present, or JSON parse
// fails, or no span survives normalization, returns the original text unchanged
// and an empty `emphasis` array so the SwiftUI client renders plain text.
export function extractOfficeHoursChatEmphasis(text, { logger = console } = {}) {
  if (typeof text !== "string" || !text.length) {
    return { text: text ?? "", emphasis: [] };
  }
  const startIdx = text.indexOf(OFFICE_HOURS_EMPHASIS_SENTINEL_START);
  if (startIdx === -1) {
    return { text, emphasis: [] };
  }
  const afterStart = startIdx + OFFICE_HOURS_EMPHASIS_SENTINEL_START.length;
  const endIdx = text.indexOf(OFFICE_HOURS_EMPHASIS_SENTINEL_END, afterStart);
  if (endIdx === -1) {
    logger.warn?.("[office-hours-emphasis] sentinel start without matching end");
    return { text, emphasis: [] };
  }
  const jsonStr = text.slice(afterStart, endIdx).trim();
  let payload;
  try {
    payload = JSON.parse(jsonStr);
  } catch (err) {
    logger.warn?.(`[office-hours-emphasis] sentinel JSON parse failed: ${err.message}`);
    return { text, emphasis: [] };
  }
  const before = text.slice(0, startIdx);
  const after = text.slice(endIdx + OFFICE_HOURS_EMPHASIS_SENTINEL_END.length);
  const cleanedText = `${before.replace(/\s+$/, "")}${
    before && after.replace(/^\s+/, "") ? "\n\n" : ""
  }${after.replace(/^\s+/, "")}`.trim();
  const emphasis = normalizeOfficeHoursEmphasis(payload, cleanedText);
  return { text: cleanedText, emphasis };
}

function optionHighlightCandidates(label = "") {
  const trimmed = String(label || "").replace(/\s+/g, " ").trim();
  if (!trimmed) return [];
  const candidates = [trimmed];
  for (const suffix of ["일 수 있습니다", "일 수 있다", "일 수 있음", "입니다", "이다"]) {
    if (trimmed.endsWith(suffix)) {
      const candidate = trimmed.slice(0, -suffix.length).trim();
      if (candidate) candidates.push(candidate);
    }
  }
  return candidates;
}

function normalizeTranscriptQuestionText(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function extractOfficeHoursContextFacts(context = "") {
  const facts = {};
  const lines = String(context || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    const [rawKey, ...rawValue] = line.split(":");
    if (!rawKey || rawValue.length === 0) continue;
    const key = rawKey.trim().toLowerCase();
    const value = rawValue.join(":").trim();
    if (!value) continue;

    if (key === "project") {
      const [name, oneLine] = value.split(/\s+-\s+/, 2);
      facts.project = cleanContextFact(name || value, 64);
      if (!facts.problem && oneLine) facts.problem = cleanContextFact(oneLine, 120);
    } else if (key === "customer") {
      facts.customer = cleanContextFact(value, 96);
    } else if (key === "problem") {
      facts.problem = cleanContextFact(value, 130);
    } else if (key === "icp") {
      facts.icp = cleanContextFact(value, 96);
    } else if (key === "pain") {
      facts.pain = cleanContextFact(value, 130);
    } else if (key === "diagnosis") {
      const missing = value.match(/missing signal:\s*(.+)$/i)?.[1];
      if (missing) facts.missingSignal = cleanContextFact(missing, 120);
    }
  }

  return facts;
}

function cleanContextFact(value = "", max = 120) {
  const cleaned = String(value || "")
    .replace(/\s+/g, " ")
    .replace(/^["'“”]+|["'“”]+$/g, "")
    .trim();
  if (cleaned.length <= max) return cleaned;
  return `${cleaned.slice(0, Math.max(0, max - 1)).trim()}…`;
}

function cleanOfficeHoursQuestion(value = "") {
  const text = String(value || "")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= 400) return text;
  return `${text.slice(0, 398).replace(/[?？.,，。;；:\s]+$/g, "").trim()}?`;
}
