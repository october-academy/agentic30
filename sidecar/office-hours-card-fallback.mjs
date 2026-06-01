import {
  CODEX_STRUCTURED_INPUT_TOOL,
  isStructuredInputToolName,
} from "./structured-input-tools.mjs";

export const OFFICE_HOURS_FALLBACK_MODE = "office_hours_fallback";
export const OFFICE_HOURS_INLINE_MODE = "office_hours_inline";

const OFFICE_HOURS_STRUCTURED_MODES = new Set([
  "office_hours",
  OFFICE_HOURS_FALLBACK_MODE,
  OFFICE_HOURS_INLINE_MODE,
]);

const DEFAULT_OFFICE_HOURS_QUESTION =
  "누가 이 문제에 이미 돈, 시간, 우회 수단을 쓰고 있다는 가장 강한 증거는 무엇인가요?";

const DEFAULT_OFFICE_HOURS_OPTIONS = Object.freeze([
  Object.freeze({
    label: "돈/결제 신호",
    description: "이미 돈을 냈거나 유료 제안에 답할 후보를 기준으로 검증합니다.",
    recommended: true,
    risk: "관심 표현만 수요로 착각하는 리스크를 줄입니다.",
    evidenceTarget: "결제, 유료 제안 응답, 예산 보유 같은 돈의 증거",
    mapsTo: "Q1 Demand Reality",
    failureMode: "돈 신호가 없으면 이번 주 검증 행동으로 내려야 합니다.",
  }),
  Object.freeze({
    label: "시간/우회 수단",
    description: "현재 시간을 쓰거나 수작업으로 해결하는 사람의 비용을 확인합니다.",
    risk: "시간 비용이 작으면 nice-to-have일 가능성이 큽니다.",
    evidenceTarget: "주당 시간, 수작업, 기존 도구 조합",
    mapsTo: "Q2 Status Quo",
    failureMode: "우회 수단이 없으면 문제 강도부터 다시 봅니다.",
  }),
  Object.freeze({
    label: "실사용 관찰",
    description: "옆에서 실제 워크플로가 막히는 장면을 보고 다음 실험을 정합니다.",
    risk: "데모콜이나 설문은 실제 사용 마찰을 가립니다.",
    evidenceTarget: "도움 없이 막힌 단계, 예상과 다른 행동",
    mapsTo: "Q5 Observation",
    failureMode: "관찰이 없으면 assignment는 기능 추가가 아니라 관찰입니다.",
  }),
  Object.freeze({
    label: "증거 없음",
    description: "근거가 부족하다고 인정하고 오늘 바로 확인할 가장 작은 행동을 고릅니다.",
    risk: "근거 없이 계속 만들면 build-first 루프로 돌아갑니다.",
    evidenceTarget: "이번 주 연락/관찰/유료 제안 계획",
    mapsTo: "Evidence Gap",
    failureMode: "증거 공백을 숨기면 Office Hours 진단이 무의미해집니다.",
  }),
]);

const OFFICE_HOURS_INTENT_OPTION_SETS = Object.freeze({
  stage: Object.freeze([
    Object.freeze({
      label: "Pre-product",
      description: "아직 사용자가 없으면 수요, 현재 대안, 가장 절박한 사람부터 확인합니다.",
      recommended: false,
      risk: "사용자 없이 wedge부터 정하면 가설이 너무 빨리 굳습니다.",
      evidenceTarget: "실제 사용자 전 단계라는 명시적 상태",
      mapsTo: "stage:pre_product",
      failureMode: "stage를 잘못 고르면 질문 routing이 빗나갑니다.",
      nextIntent: "stage_pre_product",
    }),
    Object.freeze({
      label: "Has users",
      description: "사용자는 있지만 결제 전이면 status quo, 이번 주 wedge, 관찰 증거를 우선합니다.",
      recommended: true,
      risk: "관심/사용을 결제로 착각하면 수요 강도를 과대평가합니다.",
      evidenceTarget: "사용자 존재, 무과금, 반복/완료 행동",
      mapsTo: "stage:has_users",
      failureMode: "결제 전 단계의 가장 큰 공백은 관찰과 paid intent입니다.",
      nextIntent: "stage_has_users",
    }),
    Object.freeze({
      label: "Has paying customers",
      description: "결제자가 있으면 가장 작은 유료 wedge, 관찰 surprise, future-fit을 봅니다.",
      risk: "초기 결제를 넓은 시장 신호로 과대해석할 수 있습니다.",
      evidenceTarget: "결제자, 사용 확장, 깨졌을 때의 반응",
      mapsTo: "stage:has_paying_customers",
      failureMode: "결제자가 구체적이지 않으면 has-users로 낮춰 봐야 합니다.",
      nextIntent: "stage_has_paying_customers",
    }),
    Object.freeze({
      label: "Engineering/infra",
      description: "시장 세션이 아니라 내부 workflow라면 현재 대안과 가장 작은 greenlight demo만 봅니다.",
      risk: "비즈니스 질문을 억지로 묻는 낭비를 줄입니다.",
      evidenceTarget: "내부 sponsor, 반복 업무, 승인 기준",
      mapsTo: "stage:engineering_infra",
      failureMode: "sponsor가 없으면 internal project도 수요가 약합니다.",
      nextIntent: "stage_engineering_infra",
    }),
  ]),
  status_quo: Object.freeze([
    Object.freeze({
      label: "수작업",
      description: "반복 복사, 정리, 추적 같은 손작업이면 시간 비용을 바로 측정할 수 있습니다.",
      recommended: true,
      risk: "시간 비용이 작으면 결제 근거가 약합니다.",
      evidenceTarget: "주당 시간, 반복 횟수, 실수 비용",
      mapsTo: "Q2 Status Quo",
      failureMode: "수작업 비용을 못 대면 problem intensity가 약합니다.",
    }),
    Object.freeze({
      label: "기존 도구 조합",
      description: "여러 앱을 이어 붙이는 우회라면 전환 비용과 깨지는 지점을 확인합니다.",
      risk: "기존 조합이 충분히 좋으면 새 제품이 끼어들기 어렵습니다.",
      evidenceTarget: "현재 쓰는 도구, 연결 마찰, 실패 단계",
      mapsTo: "Q2 Status Quo",
      failureMode: "대체재가 강하면 wedge를 더 좁혀야 합니다.",
    }),
    Object.freeze({
      label: "그냥 방치",
      description: "아무것도 하지 않는다면 왜 방치해도 되는지와 실제 손실을 먼저 봅니다.",
      risk: "방치 가능한 문제는 유료 수요가 아닐 수 있습니다.",
      evidenceTarget: "방치 결과, 놓친 돈/시간/평판",
      mapsTo: "Q2 Status Quo",
      failureMode: "손실이 없으면 다른 문제로 reframing해야 합니다.",
    }),
  ]),
  wedge: Object.freeze([
    Object.freeze({
      label: "이번 주 유료 한 가지",
      description: "가장 작은 paid workflow를 골라 full platform 도피를 막습니다.",
      recommended: true,
      risk: "너무 작게 잡으면 장기 비전 증거는 부족할 수 있습니다.",
      evidenceTarget: "이번 주 결제 가능 feature/workflow",
      mapsTo: "Q4 Narrowest Wedge",
      failureMode: "한 가지로 줄지 않으면 value prop이 아직 흐립니다.",
    }),
    Object.freeze({
      label: "수동 concierge",
      description: "자동화 없이 직접 결과를 만들어 paid intent와 결과 만족도를 먼저 봅니다.",
      risk: "수동 운영 비용은 제품화 전에 별도 검증이 필요합니다.",
      evidenceTarget: "수동 제공 결과, 결제/반복 의사",
      mapsTo: "Q4 Narrowest Wedge",
      failureMode: "수동으로도 가치가 없으면 자동화해도 약합니다.",
    }),
    Object.freeze({
      label: "전체 플랫폼",
      description: "비전은 보존하지만 이번 주 수요 검증에는 가장 느린 선택입니다.",
      risk: "아키텍처 애착이 고객 가치보다 앞설 수 있습니다.",
      evidenceTarget: "작게 쪼갤 수 없는 이유",
      mapsTo: "Q4 Red Flag",
      failureMode: "플랫폼만 가능하다는 답은 wedge를 다시 물어야 합니다.",
    }),
  ]),
  observation: Object.freeze([
    Object.freeze({
      label: "직접 관찰함",
      description: "도움 없이 막힌 장면과 예상 밖 행동이 있으면 가장 강한 사용 증거입니다.",
      recommended: true,
      risk: "관찰 대상이 ICP가 아니면 제품 판단을 흐릴 수 있습니다.",
      evidenceTarget: "누가, 어디서, 어떤 단계에서 막혔는지",
      mapsTo: "Q5 Observation",
      failureMode: "surprise가 없으면 관찰이 아니라 데모였을 수 있습니다.",
    }),
    Object.freeze({
      label: "인터뷰/설문만 있음",
      description: "pain은 들었지만 실제 workflow friction은 아직 검증되지 않았습니다.",
      risk: "말한 것과 실제 행동이 다를 수 있습니다.",
      evidenceTarget: "관찰로 확인해야 할 단계",
      mapsTo: "Q5 Observation Gap",
      failureMode: "다음 assignment는 직접 관찰입니다.",
    }),
    Object.freeze({
      label: "아직 못 봄",
      description: "가장 큰 공백을 인정하고 이번 주 관찰 assignment로 내려야 합니다.",
      risk: "기능 추가가 관찰 부족을 가릴 수 있습니다.",
      evidenceTarget: "관찰할 ICP, workflow, 완료 기준",
      mapsTo: "Q5 Observation Gap",
      failureMode: "관찰 없이 진단을 닫으면 가정이 남습니다.",
    }),
  ]),
  alternatives: Object.freeze([
    Object.freeze({
      label: "최소안",
      description: "가장 작은 변경으로 이번 주 evidence gap 하나를 닫습니다.",
      recommended: true,
      risk: "장기 구조는 덜 예쁠 수 있지만 검증 속도가 빠릅니다.",
      evidenceTarget: "하나의 관찰/결제/완료 신호",
      mapsTo: "Alternatives:minimal",
      failureMode: "최소안도 실행이 크면 다시 쪼갭니다.",
    }),
    Object.freeze({
      label: "이상안",
      description: "원본 office-hours 흐름을 가장 완전하게 구현해 장기 품질을 높입니다.",
      risk: "초기 구현 범위가 커져 실사용 검증이 늦어질 수 있습니다.",
      evidenceTarget: "전체 세션 품질과 회귀 테스트",
      mapsTo: "Alternatives:ideal",
      failureMode: "품질보다 범위가 앞서면 shipping이 늦습니다.",
    }),
    Object.freeze({
      label: "다른 관점",
      description: "질문 품질보다 사용자 관찰/문서화 workflow를 먼저 좁히는 접근입니다.",
      risk: "원본 parity는 늦지만 실제 사용 증거에 더 가까울 수 있습니다.",
      evidenceTarget: "관찰 assignment completion",
      mapsTo: "Alternatives:lateral",
      failureMode: "세션 구조 개선이 뒤로 밀릴 수 있습니다.",
    }),
  ]),
});

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

export function defaultOfficeHoursFallbackOptions(intent = "") {
  const key = normalizeOfficeHoursIntent(intent);
  const options = OFFICE_HOURS_INTENT_OPTION_SETS[key] || DEFAULT_OFFICE_HOURS_OPTIONS;
  return options.map((option) => ({ ...option }));
}

export function extractOfficeHoursQuestion(content = "") {
  const cleaned = stripTrailingRubricFocusMetadata(content);
  const lines = cleaned
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const questionLine = [...lines]
    .reverse()
    .find((line) => isLikelyOfficeHoursQuestion(line));
  return questionLine || "";
}

export function hasLikelyOfficeHoursQuestion(content = "") {
  return Boolean(extractOfficeHoursQuestion(content));
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

export function buildOfficeHoursStructuredPromptPayload({
  sessionId,
  provider = "codex",
  assistantMessage = null,
  mode = OFFICE_HOURS_FALLBACK_MODE,
  allowDefaultQuestion = true,
  context = "",
} = {}) {
  if (!sessionId) return null;
  const inlineDecision = assistantMessage?.inlineDecision || null;
  const hasInlineDecision = Boolean(inlineDecision);
  const resolvedMode = hasInlineDecision ? OFFICE_HOURS_INLINE_MODE : mode;
  const extractedQuestion = extractOfficeHoursQuestion(assistantMessage?.content || "");
  const defaultQuestion = buildContextualOfficeHoursQuestion(context);
  const question = cleanOfficeHoursQuestion(hasInlineDecision
    ? String(inlineDecision.question || "").trim() || defaultQuestion
    : extractedQuestion || defaultQuestion);
  const intent = resolveOfficeHoursQuestionIntent({
    inlineDecision,
    question,
    assistantContent: assistantMessage?.content || "",
  });
  const options = normalizeOfficeHoursOptions(inlineDecision?.options, intent);
  const highlightPhrases = normalizeOfficeHoursHighlightPhrases(
    inlineDecision?.highlightPhrases
      || inlineDecision?.highlight_phrases
      || inlineDecision?.highlights
      || inlineDecision?.highlight,
    question,
    options,
  );

  if (!hasInlineDecision && !extractedQuestion && !allowDefaultQuestion) {
    return null;
  }

  return {
    sessionId,
    toolName: officeHoursStructuredInputToolName(provider),
    title: "Office Hours",
    questions: [
      {
        questionId: resolveOfficeHoursQuestionId(inlineDecision, intent),
        header: String(inlineDecision?.header || "").trim().slice(0, 32) || officeHoursIntentHeader(intent),
        question,
        helperText: "선택지로 답하거나 직접 입력하면 Office Hours가 이어집니다.",
        ...(highlightPhrases.length ? { highlightPhrases } : {}),
        options,
        multiSelect: false,
        allowFreeText: true,
        requiresFreeText: false,
        freeTextPlaceholder: "예: 이번 주 3명에게 유료 제안을 보내고 답변을 기록",
        textMode: "short",
      },
    ],
    generation: {
      mode: resolvedMode,
      docType: "day1_step",
      signalId: resolveOfficeHoursSignalId(inlineDecision, intent),
      signalLabel: officeHoursSignalLabel(intent),
    },
  };
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

function normalizeOfficeHoursOptions(options, intent = "") {
  if (!Array.isArray(options)) return defaultOfficeHoursFallbackOptions(intent);
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
    .slice(0, 4);

  return normalized.length >= 2 ? normalized : defaultOfficeHoursFallbackOptions(intent);
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
    return "";
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
  if (text.includes("stage")) return "stage";
  if (text.includes("status_quo") || text.includes("status") || text.includes("q2")) return "status_quo";
  if (text.includes("wedge") || text.includes("q4")) return "wedge";
  if (text.includes("observation") || text.includes("observe") || text.includes("q5")) return "observation";
  if (text.includes("premise")) return "premise";
  if (text.includes("alternative")) return "alternatives";
  if (text.includes("future") || text.includes("q6")) return "future_fit";
  return text in OFFICE_HOURS_INTENT_OPTION_SETS ? text : "";
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
  if (key) return `office_hours_${key}`;
  return "office_hours_forcing_question";
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
      return "Office Hours forcing question";
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

function isLikelyOfficeHoursQuestion(line = "") {
  const text = String(line || "").trim();
  if (!text || text.length > 420) return false;
  return /[?？]$/.test(text)
    || /(무엇인가요|무엇입니까|어떤 .*(?:인가요|입니까|까요|주세요)|누가 .*(?:인가요|입니까|까요)|언제 .*(?:인가요|입니까|까요)|어디.*(?:인가요|입니까|까요)|어떻게.*(?:인가요|입니까|까요|나요)|왜 .*(?:인가요|입니까|까요)|알려\s*주세요|정해\s*주세요|골라\s*주세요|고르세요|선택(?:해\s*주세요|하세요))/i.test(text);
}
