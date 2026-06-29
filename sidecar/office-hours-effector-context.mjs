// Office Hours effector context — pure builder for the gstack-quality "effector"
// phases (landscape awareness / cross-model second opinion / external context /
// alternatives). Per SPEC v3 §5 (port-on-top):
//
//   prompt  owns FLOW    — buildOfficeHoursChatSystemPrompt ladder rules
//   prompt  owns COPY    — gstack questions / Voice / decision-brief
//   host    owns EFFECTS — orchestrates I/O, then calls THIS pure assembler
//
// This module is intentionally a PURE function set. It takes precomputed inputs
// (snapshots already loaded by the host, a second-opinion result already obtained
// through a judge_read_only subcall) and returns a read-only CONTEXT STRING. It:
//   - NEVER owns or mutates state,
//   - NEVER performs a subcall or any I/O,
//   - NEVER emits a question or a structured-input card.
//
// The second-opinion subcall itself runs in the host (index.mjs) using the
// judge_read_only execution mode so it stays read-only and CANNOT touch
// session.pendingUserInput / runtime (two-writer guard). On any failure the host
// records `second_opinion_unavailable` debt and passes { status: "unavailable" }
// here so Office Hours never blocks (fail-open).

export const OFFICE_HOURS_SECOND_OPINION_EXECUTION_MODE = "judge_read_only";

export const OFFICE_HOURS_EFFECTOR_CONTEXT_HEADER =
  "## Office Hours 보조 컨텍스트 (읽기 전용 배경)";

// The one rule that makes the whole effector phase safe: this context is
// background only. Questions still come from the Office Hours system prompt and
// structured-input tool path, not from this context.
export const OFFICE_HOURS_EFFECTOR_CONTEXT_GUARD =
  "이 섹션은 읽기 전용 배경 자료다. 여기에서 새 structured input 카드나 질문을 만들지 않는다. 질문 순서와 카드는 Office Hours 시스템 프롬프트와 structured input 경로에서만 나온다. 이 배경은 답변을 더 날카롭게 만들 때만 참고한다.";

function cleanText(value) {
  return String(value ?? "").replace(/[ 	]+/g, " ").trim();
}

function asLines(value) {
  if (Array.isArray(value)) {
    return value.map((item) => cleanText(item)).filter(Boolean);
  }
  const text = cleanText(value);
  return text ? [text] : [];
}

// ---------------------------------------------------------------------------
// Second opinion (Phase 3.5) — prompt builder + strict-JSON parser.
// The prompt is fed to a judge_read_only subcall by the host. The parser is
// fail-open: anything it cannot read becomes { status: "unavailable" }.
// ---------------------------------------------------------------------------

const SECOND_OPINION_FIELDS = ["steelman", "strongestSignal", "wrongPremise", "prototype48h"];

export function buildOfficeHoursSecondOpinionPrompt({
  goalType = "",
  goalText = "",
  problemStatement = "",
  keyAnswers = [],
  landscape = "",
  premises = [],
  codebaseContext = "",
} = {}) {
  const contextBlock = [
    goalType ? `30일 목표 종류: ${cleanText(goalType)}` : "",
    goalText ? `30일 목표: ${cleanText(goalText)}` : "",
    problemStatement ? `문제 정의: ${cleanText(problemStatement)}` : "",
    asLines(keyAnswers).length ? `핵심 답변:\n${asLines(keyAnswers).map((line) => `- ${line}`).join("\n")}` : "",
    cleanText(landscape) ? `시장 지형 요약:\n${cleanText(landscape)}` : "",
    asLines(premises).length ? `합의된 전제:\n${asLines(premises).map((line) => `- ${line}`).join("\n")}` : "",
    cleanText(codebaseContext) ? `코드베이스 맥락: ${cleanText(codebaseContext)}` : "",
  ].filter(Boolean).join("\n");

  return [
    "You are an independent technical advisor reading a structured summary of a solo founder's Office Hours session. You have NOT seen the conversation — judge only from the summary below.",
    "",
    contextBlock || "(요약 컨텍스트가 비어 있다.)",
    "",
    "Return ONLY a single JSON object, no prose, no markdown fences, with exactly these string fields:",
    '{ "steelman": "이 사람이 만들려는 것의 가장 강한 버전 2-3문장", "strongestSignal": "답변 중 무엇을 실제로 만들어야 하는지 가장 잘 드러내는 한 가지 — 인용 + 이유", "wrongPremise": "틀렸다고 보는 합의된 전제 하나 + 그것을 증명할 증거", "prototype48h": "엔지니어 1명과 48시간이 있다면 무엇을 만들지 — 구체적으로, 무엇을 생략할지 포함" }',
    "Be direct and terse. Write each field in Korean. No preamble.",
  ].join("\n");
}

export function parseOfficeHoursSecondOpinion(rawOutput = "") {
  const text = cleanText(rawOutput);
  if (!text) return { status: "unavailable", reason: "empty" };
  let parsed;
  try {
    parsed = JSON.parse(extractJsonObject(text));
  } catch {
    return { status: "unavailable", reason: "unparseable" };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { status: "unavailable", reason: "not_object" };
  }
  const result = { status: "ok" };
  let anyField = false;
  for (const field of SECOND_OPINION_FIELDS) {
    const value = cleanText(parsed[field]);
    result[field] = value;
    if (value) anyField = true;
  }
  if (!anyField) return { status: "unavailable", reason: "no_fields" };
  return result;
}

// Tolerate a judge that wraps the object in prose or a code fence by slicing the
// outermost {...}. Pure string surgery — no eval.
function extractJsonObject(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return text;
  return text.slice(start, end + 1);
}

function formatSecondOpinionSection(secondOpinion) {
  if (!secondOpinion || typeof secondOpinion !== "object") return "";
  if (secondOpinion.status !== "ok") {
    // Fail-open: surface that the cross-model read did not run so the model does
    // not pretend it has one, but never block.
    return [
      "### 교차 모델 second opinion",
      "이번 세션에서는 독립 모델 의견을 받지 못했다 (사용 불가). 없는 second opinion을 있는 것처럼 인용하지 않는다.",
    ].join("\n");
  }
  const rows = [
    secondOpinion.steelman ? `- 가장 강한 버전: ${secondOpinion.steelman}` : "",
    secondOpinion.strongestSignal ? `- 가장 강한 신호: ${secondOpinion.strongestSignal}` : "",
    secondOpinion.wrongPremise ? `- 의심되는 전제: ${secondOpinion.wrongPremise}` : "",
    secondOpinion.prototype48h ? `- 48시간 프로토타입 제안: ${secondOpinion.prototype48h}` : "",
  ].filter(Boolean);
  if (!rows.length) return "";
  return ["### 교차 모델 second opinion (독립 관점)", ...rows].join("\n");
}

// ---------------------------------------------------------------------------
// The pure context assembler. Every input is already computed by the host.
// Returns "" when there is nothing to inject so the caller can skip cleanly.
// ---------------------------------------------------------------------------

export function buildOfficeHoursEffectorContext({
  landscape = "",
  secondOpinion = null,
  externalContext = "",
  alternatives = [],
  builderJourney = "",
} = {}) {
  const sections = [];

  const landscapeLines = asLines(landscape);
  if (landscapeLines.length) {
    sections.push(["### 시장 지형 (landscape, 하루 1회 캐시)", ...landscapeLines.map((line) => `- ${line}`)].join("\n"));
  }

  const secondOpinionSection = formatSecondOpinionSection(secondOpinion);
  if (secondOpinionSection) sections.push(secondOpinionSection);

  const externalLines = asLines(externalContext);
  if (externalLines.length) {
    sections.push(["### 외부 맥락 (Founder Replay / morning briefing)", ...externalLines.map((line) => `- ${line}`)].join("\n"));
  }

  const alternativeLines = asLines(alternatives);
  if (alternativeLines.length) {
    sections.push([
      "### 대안 후보 (alternatives — 참고만, 카드 선택은 reducer)",
      ...alternativeLines.map((line) => `- ${line}`),
    ].join("\n"));
  }

  // Phase 6 builder-journey close (self-headed READ-ONLY guidance built by the host).
  // It is injected on every turn, so it carries an explicit gate: apply ONLY when the
  // interview has actually ended. The reducer still owns progression — this closing COPY
  // must never short-circuit the forcing questions mid-session.
  if (typeof builderJourney === "string" && builderJourney.trim()) {
    sections.push([
      "> 아래 Phase 6 마무리 가이드는 인터뷰가 실제로 끝나 세션을 닫을 때만 적용한다."
        + " 진행 중에는 다음 forcing question을 계속하고, 마무리 문구나 권유를 미리 노출하지 않는다.",
      builderJourney.trim(),
    ].join("\n\n"));
  }

  if (!sections.length) return "";

  return [
    OFFICE_HOURS_EFFECTOR_CONTEXT_HEADER,
    OFFICE_HOURS_EFFECTOR_CONTEXT_GUARD,
    "",
    sections.join("\n\n"),
  ].join("\n");
}
