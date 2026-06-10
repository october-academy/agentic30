// Office Hours commitment-candidate suggestion.
//
// The interview's last stage is the commitment close: the founder names ONE next
// CUSTOMER action to close the cycle. Historically the close opened with a bare
// free-text field, which reads as abrupt after a flow of clickable forcing
// questions. This module produces 2–3 context-aware candidates derived from the
// interview's own answers so the close mirrors the interview (model PROPOSES,
// founder SELECTS or rewrites) — never the model deciding for them.
//
// IMPORTANT (user-origin / anti-displacement): candidates are PROPOSALS only. The
// stored commitment is always the founder's resolved selection (or their own typed
// line); the user-origin gate in office-hours-memory.mjs still governs the write.
// So a candidate is a starting point, never a fabricated commitment. The prompt is
// tuned to keep candidates as customer-facing actions (ask/message/call a named
// person with a price + deadline), not infra/research costumes.
//
// The prompt builder and the parser are PURE so they unit-test without a provider.

export const MAX_COMMITMENT_CANDIDATES = 3;
const MAX_CANDIDATE_CHARS = 80;
const MAX_TURNS_IN_PROMPT = 8;
const MAX_THREADS_IN_PROMPT = 4;
const MAX_PROMPT_FIELD_CHARS = 320;

function clip(value, max) {
  const text = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  if (!text) return "";
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

// One candidate string: strip leading bullets / list numbering / surrounding
// quotes, collapse whitespace, clamp length. Returns "" for anything unusable.
function cleanCandidate(value) {
  let text = typeof value === "string" ? value : "";
  text = text.replace(/\s+/g, " ").trim();
  if (!text) return "";
  // Strip a single leading list marker: "1.", "1)", "-", "*", "•", "·".
  text = text.replace(/^\s*(?:[-*•·]|\(?\d{1,2}[.)])\s+/, "");
  // Strip symmetric wrapping quotes.
  text = text.replace(/^["'“”‘’]+/, "").replace(/["'“”‘’]+$/, "").trim();
  if (!text) return "";
  return text.length > MAX_CANDIDATE_CHARS
    ? `${text.slice(0, MAX_CANDIDATE_CHARS - 1).trimEnd()}…`
    : text;
}

// Dedupe case-insensitively while preserving first-seen order; clamp to ≤ max.
function dedupeCandidates(candidates, max = MAX_COMMITMENT_CANDIDATES) {
  const seen = new Set();
  const result = [];
  for (const raw of Array.isArray(candidates) ? candidates : []) {
    const cleaned = cleanCandidate(raw);
    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(cleaned);
    if (result.length >= max) break;
  }
  return result;
}

// Pure. Builds the generation prompt from the interview's own Q/A turns plus any
// still-open memory threads. The model must return strict JSON; we never trust it
// to enforce the user-origin contract — that's the parser's + index.mjs's job.
export function buildOfficeHoursCommitmentCandidatesPrompt({
  turns = [],
  openThreads = [],
  day = null,
} = {}) {
  const qa = (Array.isArray(turns) ? turns : [])
    .slice(-MAX_TURNS_IN_PROMPT)
    .map((turn, index) => {
      const q = clip(turn?.questionText ?? turn?.question, MAX_PROMPT_FIELD_CHARS);
      const a = clip(turn?.responseText ?? turn?.answer, MAX_PROMPT_FIELD_CHARS);
      if (!q || !a) return "";
      return `${index + 1}. Q: ${q}\n   A: ${a}`;
    })
    .filter(Boolean);

  const threads = (Array.isArray(openThreads) ? openThreads : [])
    .map((thread) => clip(thread, MAX_PROMPT_FIELD_CHARS))
    .filter(Boolean)
    .slice(0, MAX_THREADS_IN_PROMPT);

  const lines = [
    "당신은 YC식 office-hours 인터뷰의 마지막 단계를 돕는다.",
    day ? `오늘은 Day ${day}.` : "",
    "방금 끝난 인터뷰의 질문과 답변은 아래와 같다:",
    "",
    qa.length ? qa.join("\n") : "(이번 인터뷰 답변 기록 없음)",
    "",
    threads.length
      ? `아직 증거로 닫히지 않은 이전 약속/스레드:\n${threads.map((t) => `- ${t}`).join("\n")}\n`
      : "",
    "위 답변의 맥락에서, 창업자가 '오늘 닫기 전에 약속할 다음 한 가지 고객 행동' 후보를",
    `${MAX_COMMITMENT_CANDIDATES}개 이하로 제안하라. 규칙:`,
    "- 반드시 고객을 향한 행동이어야 한다(특정 1명에게 묻기/메시지/통화/결제요청 등). 인프라·리서치·리팩터·문서 정리 같은 코스튬은 금지.",
    "- 가능한 한 구체적으로: 대상(누구), 무엇을 요청, 가격/약속/기한이 드러나게.",
    "- 한국어 명령형 한 줄. 각 후보는 짧게(공백 포함 40자 안팎).",
    "- 답변에 근거가 없으면 지어내지 말고 더 적게(0~1개) 제안하라.",
    "- 이건 제안일 뿐이다. 창업자가 고르거나 직접 고쳐 쓴다.",
    "",
    "출력은 설명 없이 아래 형식의 JSON만:",
    '{"candidates": ["...", "..."]}',
  ];
  return lines.filter((line) => line !== null && line !== undefined).join("\n");
}

// Pure. Extracts the candidate list from a model's (possibly noisy) text output.
// Accepts a fenced/unfenced JSON object {"candidates":[...]} or a bare JSON array.
// Returns a cleaned, deduped string[] (≤ MAX_COMMITMENT_CANDIDATES). Never throws.
export function parseOfficeHoursCommitmentCandidates(text) {
  const raw = typeof text === "string" ? text : "";
  if (!raw.trim()) return [];

  const tryParse = (snippet) => {
    try {
      return JSON.parse(snippet);
    } catch {
      return undefined;
    }
  };

  const candidatesFrom = (value) => {
    if (Array.isArray(value)) return value;
    if (value && typeof value === "object") {
      const list = value.candidates ?? value.options ?? value.actions;
      if (Array.isArray(list)) return list;
    }
    return null;
  };

  // 1) Whole-string parse (strip a leading ```json fence if present).
  const stripped = raw
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
  let parsed = candidatesFrom(tryParse(stripped));

  // 2) First balanced object, then first array, by bracket span.
  if (!parsed) {
    const objStart = stripped.indexOf("{");
    const objEnd = stripped.lastIndexOf("}");
    if (objStart !== -1 && objEnd > objStart) {
      parsed = candidatesFrom(tryParse(stripped.slice(objStart, objEnd + 1)));
    }
  }
  if (!parsed) {
    const arrStart = stripped.indexOf("[");
    const arrEnd = stripped.lastIndexOf("]");
    if (arrStart !== -1 && arrEnd > arrStart) {
      parsed = candidatesFrom(tryParse(stripped.slice(arrStart, arrEnd + 1)));
    }
  }

  if (!parsed) return [];
  // A candidate may arrive as a bare string or as {label|text|action}.
  const normalized = parsed.map((entry) => {
    if (typeof entry === "string") return entry;
    if (entry && typeof entry === "object") {
      return entry.label ?? entry.text ?? entry.action ?? entry.title ?? "";
    }
    return "";
  });
  return dedupeCandidates(normalized);
}

// Pure. Merges model-generated candidates (priority) with a local fallback
// (memory-derived open threads), deduped, ≤ MAX_COMMITMENT_CANDIDATES. Either side
// may be empty; an all-empty result is valid (the Mac then shows only "직접 적기").
export function mergeCommitmentCandidates(generated = [], fallback = []) {
  return dedupeCandidates([
    ...(Array.isArray(generated) ? generated : []),
    ...(Array.isArray(fallback) ? fallback : []),
  ]);
}
