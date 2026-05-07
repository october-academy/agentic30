/**
 * Foundation-summary sub-workflow — system prompt builder.
 *
 * Day 7 of the Foundation Phase. The Day 7 sub_workflow ("foundation-summary")
 * is the final proof loop in the 0-7 adaptive curriculum. It must:
 *   - Read the entire workspace (Day 0-6 artifacts under
 *     `workspace/.agentic30/foundation/`, plus SPEC.md v0/v1/v2 if present).
 *   - Cross-check evidence_refs JSON sidecars to gauge cumulative confidence.
 *   - Produce SPEC.md v3 (final), go-no-go.md, and foundation-summary.md
 *     candidate content the user accepts/edits via inline decisions.
 *
 * This module owns ONLY the prompt-building scaffold. The actual prose body
 * (full YC partner instructions, SPEC v3 schema, go-no-go decision tree,
 * monetization-yes counting rule) is filled in by later sub-ACs.
 *
 * Persona is fixed to "YC 파트너 / 시니어 메이커 (직설+압박, 반말 ~어/야)".
 * Template is fixed to the 3-section minimal Yesterday/Today/Q surface used
 * by the unified Foundation chat channel — even on the summary day, the
 * surface stays the same; only the *content* expands.
 */

const PERSONA = "YC 파트너 / 시니어 메이커 (직설+압박, 반말 ~어/야)";

const RESPONSE_LANGUAGE_INSTRUCTION =
  "한국어(반말 ~어/야)로 응답해. 정서 sugar 금지. 숫자/과거 행동/반증 데이터 강제.";

/**
 * Build the system prompt for the foundation-summary sub-workflow.
 *
 * @param {object} args
 * @param {string} args.workspaceRoot - Absolute workspace root path.
 * @param {object} [args.foundationContext] - Foundation context object built by
 *   `resolveFoundationContext()` in foundation-chat.mjs. Day must be 7.
 * @param {string} [args.bipManifest] - Optional BIP / workspace manifest text
 *   inserted as workspace context.
 * @returns {string} System prompt text suitable for Agent SDK `systemPrompt`
 *   append.
 */
export function buildFoundationSummarySystemPrompt({
  workspaceRoot = "",
  foundationContext = null,
  bipManifest = "",
} = {}) {
  const day = foundationContext?.day ?? 7;
  const lines = [
    "You are the Agentic30 Foundation Phase Day 7 summary partner.",
    "",
    "## Persona",
    `- ${PERSONA}`,
    "- 정서적 지지/응원 sugar 금지. 직설 + 압박 + 숫자 강제.",
    "- 미래 가정 / vibes 차단. 과거 행동 + 반증 데이터 우선.",
    "",
    "## Mission (Day 7 — foundation-summary sub-workflow)",
    "- Foundation 0-7일 누적 산출물을 읽고 SPEC v3 / go-no-go.md / foundation-summary.md 후보를 만든다.",
    "- monetization-ask 응답 yes 건수가 0이면 Pivot, 1+ 이면 Continue 권고.",
    "- 사용자가 mode를 선택할 일은 없다. 단일 채팅 surface 안에서 컨텍스트로만 응답한다.",
    "",
    "## Read-only Tools",
    "- 사용 가능한 도구: Read, Glob, Grep (워크스페이스 스캔 전용).",
    "- 파일 작성/명령 실행/외부 호출은 금지. 산출물은 텍스트 제안으로만 돌려준다.",
    "- 사용자가 inline_decision으로 수락하면 호스트가 파일에 반영한다.",
    "",
    "## Response Format",
    "- Yesterday 1줄 / Today 1줄 / Q 1줄 으로 시작한다 (3-section minimal).",
    "- 그 다음 SPEC v3 / go-no-go / foundation-summary 후보를 명시 라벨과 함께 출력한다.",
    "",
    RESPONSE_LANGUAGE_INSTRUCTION,
    `Workspace: ${workspaceRoot || "(unknown)"}`,
    `Foundation day: ${day}/7`,
  ];

  if (foundationContext?.core_question) {
    lines.push(`Core question: ${foundationContext.core_question}`);
  }
  if (Array.isArray(foundationContext?.artifacts) && foundationContext.artifacts.length) {
    lines.push(`Day 산출물 후보: ${foundationContext.artifacts.join(", ")}`);
  }
  if (bipManifest) {
    lines.push("");
    lines.push("## Workspace Manifest");
    lines.push(bipManifest);
  }
  // NOTE: Sub-AC 2+ will append the full SPEC v3 schema, go-no-go decision
  // tree, monetization-yes counting rule, and evidence_refs cross-check.
  return lines.join("\n");
}

/**
 * Build the initial user prompt that kicks off the Day 7 summary turn.
 * Subsequent sub-ACs will expand this with the actual SPEC v3 / go-no-go
 * checklist. For now it just frames the task.
 */
export function buildFoundationSummaryInitialPrompt({
  foundationContext = null,
  userMessage = "",
  draftV1Text = "",
} = {}) {
  const trimmed = String(userMessage || "").trim();
  const draft = String(draftV1Text || "").trim();
  const lines = [
    "Foundation Day 7 summary 세션이야.",
    "워크스페이스의 Day 0-6 산출물 + evidence_refs 사이드카를 읽고 SPEC v3 / go-no-go / foundation-summary 후보를 만들어.",
  ];
  if (foundationContext?.core_question) {
    lines.push(`Core question: ${foundationContext.core_question}`);
  }
  if (draft) {
    lines.push("");
    lines.push("## Pre-collected draft.v1 (Sub-AC 2)");
    lines.push("아래는 호스트가 워크스페이스에서 미리 모아둔 draft.v1이야. 이걸 출발점으로 해서 Read/Glob/Grep로 보강하고 다듬어. 비어있는 부분은 사용자에게 다시 물어 — 추측으로 채우지 마.");
    lines.push("");
    lines.push(draft);
  }
  if (trimmed) {
    lines.push("");
    lines.push("## User Message");
    lines.push(trimmed);
  }
  return lines.join("\n");
}

export const FOUNDATION_SUMMARY_PERSONA = PERSONA;
