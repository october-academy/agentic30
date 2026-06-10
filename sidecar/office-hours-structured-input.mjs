import {
  CODEX_STRUCTURED_INPUT_TOOL,
  isStructuredInputToolName,
} from "./structured-input-tools.mjs";

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

const DEMAND_EVIDENCE_QUESTION_ID = "office_hours_demand_evidence";
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
const KNOWN_OFFICE_HOURS_INTENTS = new Set([
  "demand",
  "stage",
  "status_quo",
  "wedge",
  "observation",
  "premise",
  "alternatives",
  "future_fit",
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

export function normalizeOfficeHoursStructuredPromptRequest(request = {}) {
  if (!request || typeof request !== "object") return request;
  const questions = Array.isArray(request.questions) ? request.questions : [];
  let changed = false;
  const normalizedQuestions = questions.map((question) => {
    if (!isDemandEvidenceQuestion(question)) return question;
    changed = true;
    return normalizeDemandEvidenceQuestion(question);
  });
  return changed
    ? {
        ...request,
        questions: normalizedQuestions,
      }
    : request;
}

// Tool-channel requests (Claude AskUserQuestion via canUseTool, Codex
// agentic30_request_user_input via the MCP subprocess) reach the host through
// createUserInputRequest, which — unlike the inline-decision promotion path
// (buildOfficeHoursInlineStructuredPromptPayload) — attaches no generation
// stamp. Without `generation.mode`, the submit handler's
// isOfficeHoursStructuredInputResponse check is false, so the answer skips the
// Office Hours transcript question bubble and, more importantly, the
// appendOfficeHoursTurn memory log. This stamps a tool-channel Office Hours
// request so both providers get identical post-answer treatment.
//
// Conservative + idempotent: only stamps when NO generation is present at all
// (the tool-channel signature). Requests already carrying an Office Hours
// generation (inline promotion) or any other generation — e.g. an IDD adaptive
// continuation with a docType — are returned untouched.
export function ensureOfficeHoursGeneration(request = {}) {
  if (!request || typeof request !== "object") return request;
  const generation = request.generation;
  if (isOfficeHoursStructuredInputMode(generation?.mode)) return request;
  if (generation && (generation.mode || generation.docType)) return request;

  const firstQuestion = Array.isArray(request.questions) ? request.questions[0] : null;
  const intent = firstQuestion
    ? resolveOfficeHoursQuestionIntent({
        question: String(firstQuestion.question || ""),
        inlineDecision: {
          header: firstQuestion.header,
          question: firstQuestion.question,
          intent: firstQuestion.intent || firstQuestion.questionIntent,
          questionId: firstQuestion.questionId,
        },
      })
    : "";

  const stamped = {
    ...(generation || {}),
    mode: OFFICE_HOURS_TOOL_MODE,
  };
  if (intent) {
    stamped.signalId = resolveOfficeHoursSignalId(
      { questionId: firstQuestion?.questionId },
      intent,
    );
    stamped.signalLabel = officeHoursSignalLabel(intent);
  }
  return { ...request, generation: stamped };
}

// Single entry point that makes any structured-input request card-ready for the
// Office Hours surface: canonicalize the demand-evidence choices, then guarantee
// an Office Hours generation stamp. With the stamp the Mac timeline collapses
// the question/answer into a stacked submitted card (instead of a plain "you"
// bubble) and submit_user_input treats it as an Office Hours turn (transcript +
// appendOfficeHoursTurn memory log). Idempotent: requests already promoted from
// the inline_decision channel keep their richer generation untouched.
// Normalize one question's PRESENTATION so the stacked card renders identically
// regardless of which provider/channel produced it:
//  - header: tool channels (especially Claude's AskUserQuestion default) may emit
//    an empty or literal "Question" header; fall back to the same deterministic
//    Korean intent header the inline path uses so the card title never shows a
//    raw English placeholder.
//  - highlightPhrases / emphasis: validate + derive them the same way the inline
//    path does (option-label highlights, substring-checked emphasis spans) so the
//    question-statement styling is consistent across providers. The tool channels
//    now carry these through (mcp-server schema + normalizeClaudeQuestions), and
//    the prompt already asks every provider to attach emphasis spans.
function normalizeOfficeHoursQuestionPresentation(question = {}) {
  if (!question || typeof question !== "object") return question;
  const intent = resolveOfficeHoursQuestionIntent({
    question: String(question.question || ""),
    inlineDecision: {
      header: question.header,
      question: question.question,
      intent: question.intent || question.questionIntent,
      questionId: question.questionId,
    },
  });
  const rawHeader = String(question.header || "").trim();
  const header = !rawHeader || rawHeader.toLowerCase() === "question"
    ? officeHoursIntentHeader(intent)
    : rawHeader.slice(0, 32);
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
  const canonical = normalizeOfficeHoursStructuredPromptRequest(request);
  const withPresentation = Array.isArray(canonical?.questions)
    ? { ...canonical, questions: canonical.questions.map(normalizeOfficeHoursQuestionPresentation) }
    : canonical;
  return ensureOfficeHoursGeneration(withPresentation);
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
  const intent = resolveOfficeHoursQuestionIntent({
    inlineDecision,
    question,
    assistantContent: assistantMessage?.content || "",
  });
  const options = normalizeOfficeHoursOptions(inlineDecision?.options);
  const allowFreeText = inlineDecision.allowFreeText === true;
  const requiresFreeText = inlineDecision.requiresFreeText === true;
  if (options.length < 2 && !allowFreeText) return null;
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
      allowFreeText,
      requiresFreeText,
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
  return normalizeOfficeHoursIntent(intent) === "demand"
    ? normalizeOfficeHoursStructuredPromptRequest(payload)
    : payload;
}

export function buildOfficeHoursStructuredInputContinuationPrompt({
  responseText = "",
  responseDescription = "",
} = {}) {
  const lines = [
    "Office Hours structured-card answer received.",
    "Use this answer as the user's latest Office Hours response and continue the YC forcing-question conversation.",
    "Do not end with a vague confirmation. If another decision or missing input is needed, ask the next forcing question through the host structured input tool with 2-4 options and allowFreeText: true.",
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

function isDemandEvidenceQuestion(question = {}) {
  const id = String(question?.questionId || question?.question_id || question?.id || "")
    .trim()
    .toLowerCase();
  if (id === DEMAND_EVIDENCE_QUESTION_ID) return true;
  const text = [
    question?.header,
    question?.question,
  ].filter(Boolean).join("\n").toLowerCase();
  return /수요|demand/.test(text)
    && /증거|evidence|실제 행동|strongest/.test(text);
}

function normalizeDemandEvidenceQuestion(question = {}) {
  return {
    ...question,
    questionId: String(
      question.questionId
        || question.question_id
        || question.id
        || DEMAND_EVIDENCE_QUESTION_ID,
    ).trim().slice(0, 96) || DEMAND_EVIDENCE_QUESTION_ID,
    header: String(question.header || "").trim().slice(0, 32) || "수요 증거",
    question: cleanOfficeHoursQuestion(
      String(question.question || "").trim() || DEFAULT_OFFICE_HOURS_QUESTION,
    ),
    options: DEMAND_EVIDENCE_OPTIONS.map((option) => ({ ...option })),
    multiSelect: false,
    allowFreeText: false,
    requiresFreeText: false,
    freeTextPlaceholder: undefined,
    textMode: question.textMode === "long" ? "long" : "short",
  };
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
  if (key === "demand") return DEMAND_EVIDENCE_QUESTION_ID;
  if (key) return `office_hours_${key}`;
  return DEMAND_EVIDENCE_QUESTION_ID;
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
    default:
      return "수요 증거";
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
    default:
      return "Office Hours Q1 수요 증거";
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
