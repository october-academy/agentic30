// Validates and normalizes inline_decision payloads attached to assistant
// ChatMessage. Mutually exclusive with form-style ChatSession.pendingUserInput
// (the producer is responsible for not emitting both at once). When validation
// fails, returns null and logs a warning — the caller falls back to plain text
// (no UI card is rendered).
//
// Schema (mirrors AgenticModels.swift StructuredPromptQuestion):
//   {
//     header?: string,
//     question: string,                  // required
//     helperText?: string,
//     options?: [{ label, description?, preview?, nextIntent? }],
//     multiSelect?: boolean,             // default false
//     allowFreeText?: boolean,           // default false
//     requiresFreeText?: boolean,        // default false
//     freeTextPlaceholder?: string,
//     questionId?: string,
//     intent?: string,
//     signalId?: string,
//     signalLabel?: string,
//     textMode?: "short" | "long"        // default "short"
//   }
// At least one of options.length > 0 OR allowFreeText === true must hold.

export function validateInlineDecision(decision, { logger = console } = {}) {
  if (!decision || typeof decision !== "object") return null;

  const question = typeof decision.question === "string" ? decision.question.trim() : "";
  if (!question) {
    logger.warn?.("[inline-decision] dropped: missing question");
    return null;
  }

  const options = Array.isArray(decision.options)
    ? decision.options.map(normalizeOption).filter(Boolean)
    : [];

  const allowFreeText = decision.allowFreeText === true;

  if (options.length === 0 && !allowFreeText) {
    logger.warn?.("[inline-decision] dropped: no options and allowFreeText=false");
    return null;
  }

  return {
    header: typeof decision.header === "string" ? decision.header : "",
    question,
    helperText: typeof decision.helperText === "string" ? decision.helperText : null,
    options: options.length ? options : null,
    multiSelect: decision.multiSelect === true,
    allowFreeText,
    requiresFreeText: decision.requiresFreeText === true,
    freeTextPlaceholder:
      typeof decision.freeTextPlaceholder === "string" ? decision.freeTextPlaceholder : null,
    questionId: typeof decision.questionId === "string"
      ? decision.questionId.trim().slice(0, 96)
      : null,
    question_id: typeof decision.question_id === "string"
      ? decision.question_id.trim().slice(0, 96)
      : null,
    intent: typeof decision.intent === "string"
      ? decision.intent.trim().slice(0, 96)
      : null,
    questionIntent: typeof decision.questionIntent === "string"
      ? decision.questionIntent.trim().slice(0, 96)
      : null,
    question_intent: typeof decision.question_intent === "string"
      ? decision.question_intent.trim().slice(0, 96)
      : null,
    signalId: typeof decision.signalId === "string"
      ? decision.signalId.trim().slice(0, 96)
      : null,
    signal_id: typeof decision.signal_id === "string"
      ? decision.signal_id.trim().slice(0, 96)
      : null,
    signalLabel: typeof decision.signalLabel === "string"
      ? decision.signalLabel.trim().slice(0, 160)
      : null,
    signal_label: typeof decision.signal_label === "string"
      ? decision.signal_label.trim().slice(0, 160)
      : null,
    textMode: decision.textMode === "long" ? "long" : "short",
  };
}

function normalizeOption(opt) {
  if (!opt || typeof opt !== "object") return null;
  const label = typeof opt.label === "string" ? opt.label.trim() : "";
  if (!label) return null;
  return {
    label,
    description: typeof opt.description === "string" ? opt.description : "",
    preview: typeof opt.preview === "string" ? opt.preview : null,
    nextIntent: typeof opt.nextIntent === "string" ? opt.nextIntent : null,
  };
}

// Sentinel tokens for embedding inline_decision JSON inside the LLM's text
// response. Provider SDKs (Anthropic, OpenAI Codex) do not expose a metadata
// channel for arbitrary payloads, so we ride the existing text channel and
// strip the sentinel block before showing the message to the user.
//
// Wire contract:
//   <visible message body>
//   ===INLINE_DECISION===
//   { ...JSON matching StructuredPromptQuestion shape... }
//   ===END===
//
// The block can appear anywhere; the parser finds it, validates the JSON,
// and removes the entire sentinel region (including any wrapping newlines)
// from the user-visible text. If parsing fails, the sentinel block is left
// in place as a debug hint and `decision` is null.
export const INLINE_DECISION_SENTINEL_START = "===INLINE_DECISION===";
export const INLINE_DECISION_SENTINEL_END = "===END===";

/// Extracts an inline_decision JSON payload from assistant text. Returns
/// `{ text, decision }` where `text` is the original input with the sentinel
/// block removed and `decision` is the validated payload (or null if no
/// sentinel was found, JSON parse failed, or validation rejected the payload).
/// On parse/validation failure the original text is returned unchanged so the
/// SwiftUI client can render it as plain text instead of crashing.
export function extractInlineDecision(text, { logger = console } = {}) {
  if (typeof text !== "string" || !text.length) {
    return { text: text ?? "", decision: null };
  }
  const startIdx = text.indexOf(INLINE_DECISION_SENTINEL_START);
  if (startIdx === -1) {
    return { text, decision: null };
  }
  const afterStart = startIdx + INLINE_DECISION_SENTINEL_START.length;
  const endIdx = text.indexOf(INLINE_DECISION_SENTINEL_END, afterStart);
  if (endIdx === -1) {
    logger.warn?.("[inline-decision] sentinel start without matching end");
    return { text, decision: null };
  }
  const jsonStr = text.slice(afterStart, endIdx).trim();
  let payload;
  try {
    payload = JSON.parse(jsonStr);
  } catch (err) {
    logger.warn?.(`[inline-decision] sentinel JSON parse failed: ${err.message}`);
    return { text, decision: null };
  }
  const validated = validateInlineDecision(payload, { logger });
  if (!validated) {
    return { text, decision: null };
  }
  const before = text.slice(0, startIdx);
  const after = text.slice(endIdx + INLINE_DECISION_SENTINEL_END.length);
  const cleanedText = `${before.replace(/\s+$/, "")}${
    before && after.replace(/^\s+/, "") ? "\n\n" : ""
  }${after.replace(/^\s+/, "")}`.trim();
  return { text: cleanedText, decision: validated };
}

/**
 * Best-effort safety net for model replies that violate the inline_decision
 * contract by asking a question in prose and then listing options as bullets.
 * This keeps the Mac surface interactive even when the provider ignores the
 * sentinel format. The heuristic is intentionally narrow: only short
 * decision-seeking messages with an "예:"/example marker and 2-4 bullets are
 * converted.
 */
export function inferInlineDecisionFromPlainText(text, { logger = console } = {}) {
  if (typeof text !== "string" || !text.trim()) {
    return { text: text ?? "", decision: null };
  }
  if (text.includes(INLINE_DECISION_SENTINEL_START)) {
    return { text, decision: null };
  }

  const normalized = text.replace(/\r\n/g, "\n").trim();
  const markerMatch = normalized.match(/\n\s*(?:예시?|옵션|선택지)\s*[:：]\s*\n/i);
  if (!markerMatch) {
    return { text, decision: null };
  }

  const before = normalized.slice(0, markerMatch.index).trim();
  const after = normalized.slice(markerMatch.index + markerMatch[0].length);
  if (!before || !looksLikeDecisionPrompt(before)) {
    return { text, decision: null };
  }

  const options = [];
  for (const rawLine of after.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    const match = line.match(/^(?:[-*•]|[0-9]+[.)])\s+(.+)$/);
    if (!match) {
      if (options.length) break;
      continue;
    }
    const label = match[1].trim();
    if (!label || label.length > 80) {
      return { text, decision: null };
    }
    options.push({ label, description: "" });
    if (options.length > 4) {
      return { text, decision: null };
    }
  }

  if (options.length < 2) {
    return { text, decision: null };
  }

  const question = extractQuestionLine(before);
  const decision = validateInlineDecision({
    header: "",
    question,
    options,
    multiSelect: false,
    allowFreeText: true,
    freeTextPlaceholder: "직접 입력",
    textMode: "short",
  }, { logger });
  if (!decision) {
    return { text, decision: null };
  }
  return { text: before, decision };
}

function looksLikeDecisionPrompt(text) {
  return /(원하|정해주|골라|선택|알려주|어디에|어떤|무엇|어떻게|확인해|고르|택하)/.test(text);
}

function extractQuestionLine(text) {
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  const question = [...lines].reverse().find((line) => /[?？]$/.test(line));
  return question || lines[lines.length - 1] || text.trim();
}

// Inject this fragment into specialist prompts so LLMs emit inline_decision
// payloads instead of rendering numbered lists in plain text. The mac SwiftUI
// client renders these as a Decision Card Stack inline below the assistant
// bubble. The host enforces mutual exclusion with form-style intake.
export const INLINE_DECISION_CONTRACT = `
## Inline decision contract
사용자에게 선택지를 제시하거나 사용자의 결정/누락 정보를 받아야 할 때, 본문에 "예:\n- ..." 같은 예시 목록이나 "1. ..., 2. ..., 3. ..." 같은 번호 리스트를 쓰지 마세요. 대신 응답 끝에 sentinel 블록으로 inline_decision JSON을 emit하세요. 본문은 짧은 질문 한 줄만.

응답 형식 (sentinel 블록은 사용자에게 보이지 않습니다 — 호스트가 자동 제거):

\`\`\`
<짧은 본문 — 한 줄 질문>

===INLINE_DECISION===
{
  "header": "전략 문서 용도",
  "question": "전략 문서의 용도는 무엇인가요?",
  "options": [
    { "label": "내부 의사결정용 요약본", "description": "팀 내부에 빠르게 공유" },
    { "label": "외부 공유/피칭용 전략 문서", "description": "투자자/파트너용" },
    { "label": "ICP/GOAL/VALUES/SPEC 마스터 문서", "description": "기존 4개 통합" }
  ],
  "multiSelect": false,
  "allowFreeText": false,
  "textMode": "short"
}
===END===
\`\`\`

Schema (StructuredPromptQuestion):
- header: string? — 예: "전략 문서 용도"
- question: string — 본문과 동일한 한 줄
- helperText: string? — optional 보조 설명
- options: [{ label: string, description?: string }]
- multiSelect: boolean — default false
- allowFreeText: boolean — default false; true면 자유입력 폴백 노출
- requiresFreeText: boolean — default false; true면 자유입력 필수
- freeTextPlaceholder: string? — allowFreeText=true일 때만
- textMode: "short" | "long" — default "short"

Constraints:
- options 배열은 최소 1개 이상이거나, allowFreeText=true 중 하나는 만족해야 합니다.
- 본문에 옵션 라벨을 텍스트로 다시 적지 마세요 (sentinel + 본문 이중 노출 방지).
- 라벨 60자 이내, description 80자 이내 권장.
- sentinel 토큰 \`===INLINE_DECISION===\` / \`===END===\`는 정확히 그대로 사용. 다른 형식은 무시됩니다.

Mutual exclusion: form-style intake가 active할 때(session.pendingUserInput exists)는 inline_decision을 emit하지 마세요. 호스트가 active intake가 있으면 sentinel을 자동 무시합니다.
`.trim();
