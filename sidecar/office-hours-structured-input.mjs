import {
  CODEX_STRUCTURED_INPUT_TOOL,
  isStructuredInputToolName,
} from "./structured-input-tools.mjs";

export const OFFICE_HOURS_INLINE_MODE = "office_hours_inline";

const OFFICE_HOURS_STRUCTURED_MODES = new Set([
  "office_hours",
  OFFICE_HOURS_INLINE_MODE,
]);

const DEFAULT_OFFICE_HOURS_QUESTION =
  "Agentic30 수요를 실제 행동으로 확인한 가장 강한 증거는 무엇인가요?";

const DEMAND_EVIDENCE_QUESTION_ID = "office_hours_demand_evidence";
const DEMAND_EVIDENCE_OPTIONS = Object.freeze([
  Object.freeze({
    label: "실제 결제/계약이 있었다",
    description: "돈이 이미 움직였으므로 가장 강한 증거입니다. 다음 검증은 구매자가 ICP와 맞는지입니다.",
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

export function officeHoursStructuredInputToolName(provider = "codex") {
  return String(provider || "").toLowerCase() === "claude"
    ? "AskUserQuestion"
    : CODEX_STRUCTURED_INPUT_TOOL;
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

  const questions = [
    {
      questionId: resolveOfficeHoursQuestionId(inlineDecision, intent),
      header: String(inlineDecision?.header || "").trim().slice(0, 32) || officeHoursIntentHeader(intent),
      question,
      helperText:
        String(inlineDecision?.helperText || inlineDecision?.helper_text || "").trim().slice(0, 280)
        || "선택지로 답하면 Office Hours가 이어집니다.",
      ...(highlightPhrases.length ? { highlightPhrases } : {}),
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
    toolName: officeHoursStructuredInputToolName(provider),
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
    "Do not end with a generic confirmation. If another decision or missing input is needed, ask the next forcing question through the host structured input tool with 2-4 options and allowFreeText: true.",
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
      return "가장 좁은 wedge";
    case "observation":
      return "직접 관찰";
    case "premise":
      return "Premise Challenge";
    case "alternatives":
      return "Alternatives";
    case "future_fit":
      return "Future-fit";
    default:
      return "수요 증거";
  }
}

function officeHoursSignalLabel(intent = "") {
  switch (normalizeOfficeHoursIntent(intent)) {
    case "demand":
      return "Office Hours Q1 Demand Evidence";
    case "stage":
      return "Office Hours product stage";
    case "status_quo":
      return "Office Hours Q2 Status Quo";
    case "wedge":
      return "Office Hours Q4 Narrowest Wedge";
    case "observation":
      return "Office Hours Q5 Observation";
    case "premise":
      return "Office Hours Premise Challenge";
    case "alternatives":
      return "Office Hours Alternatives";
    case "future_fit":
      return "Office Hours Q6 Future-Fit";
    default:
      return "Office Hours Q1 Demand Evidence";
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
