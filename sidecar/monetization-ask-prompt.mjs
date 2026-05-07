/**
 * monetization-ask sub-workflow (Foundation Day 6).
 *
 * Day 6 forces the creator to make ONE explicit monetization ask to ONE
 * specific person and capture their response verbatim. The AI co-founder
 * runs a 4-turn structured loop:
 *
 *     target  →  draft  →  sent  →  response
 *
 * Each turn binds:
 *  - core_question : the single question the user must answer this turn
 *  - first_prompt  : the AI's opening message for that turn (3-section minimal
 *                    Yesterday/Today/Q template, YC partner persona, 반말)
 *  - transition    : validation rules that advance (or reject) the turn
 *  - captures      : dynamic_variables harvested when the turn closes
 *
 * Sub-workflow-level invariants (apply to ALL turns):
 *  - Persona: YC 파트너 / 시니어 메이커 (직설+압박, 반말 ~어/야)
 *  - Template: 3-section minimal (Yesterday 1줄 / Today 1줄 / Q 1줄)
 *  - Anti-patterns: waitlist signups, "관심 있다" / "재밌다" / "나중에 살게",
 *    free trial sign-ups, and email-only signups DO NOT count as monetization.
 *  - Output artifact: workspace/.agentic30/foundation/monetization-ask-result.md
 *
 * The dispatcher (foundation-chat.mjs / index.mjs) reads MONETIZATION_ASK_TURNS
 * to (a) pick the right turn-prompt for the current state and (b) decide when
 * to advance the workflow. The persistent turn cursor lives on the session
 * runtime as `session.runtime.foundation.monetizationAsk.turn`.
 *
 * Day-6 → Foundation linkage:
 *  FOUNDATION_DAYS[6].sub_workflow === "monetization-ask"
 *  FOUNDATION_DAYS[6].artifacts    === ["monetization-ask-result.md"]
 */

const PERSONA = "YC 파트너 / 시니어 메이커 (직설+압박, 반말 ~어/야)";
const TEMPLATE = "3-section minimal (Yesterday 1줄 / Today 1줄 / Q 1줄)";

/**
 * 4-turn workflow definition. Frozen so callers can't mutate at runtime.
 * `id` values are the canonical turn keys persisted to session runtime.
 */
export const MONETIZATION_ASK_TURNS = Object.freeze([
  Object.freeze({
    id: "target",
    label: "Target — 누구한테 물어볼 거야",
    order: 1,
    core_question: "오늘 돈 내달라고 명시적으로 물어볼 사람 1명은 누구야? 이름·역할·맥락 다 말해.",
    first_prompt: Object.freeze({
      yesterday:
        "Day 5에서 광고/노출 신호를 봤어. 가장 강한 시그널이 어떤 사람이었는지 너가 이미 알고 있어.",
      today:
        "오늘 한 사람한테만 명시적으로 결제 요청해. 웨이팅리스트·관심 표명·무료 시도는 monetization 아니야.",
      question:
        "그 한 명, 이름·직함·회사·왜 이 사람인지 한 줄로 말해. (모호하면 다시 좁힌다)",
    }),
    captures: Object.freeze([
      "target_name",
      "target_role",
      "target_context",
      "why_this_person",
    ]),
    /**
     * Advance to `draft` only when we have a NAMED individual + concrete
     * context. Reject집합명사("개발자들", "초기 사용자", "팀장님들") and
     * anonymized handles without context.
     */
    transition: Object.freeze({
      next: "draft",
      requires: Object.freeze([
        "named_individual_present", // 실명 또는 식별 가능한 1인
        "role_or_company_present", // 역할/회사명/관계 중 1개 이상
        "why_this_person_specific", // 왜 이 사람인지 구체적
      ]),
      rejects: Object.freeze([
        "collective_noun_only", // "개발자들", "팀장들" 등 집합명사
        "vague_persona", // "early adopter 타입"
        "no_named_relationship", // 이름은 있는데 너와의 관계 불명
      ]),
      pushback_template:
        "그건 사람이 아니라 카테고리야. 이번 주에 메시지 보낼 수 있는 실제 한 명, 이름·직함·연락 가능한 채널까지 한 줄로 다시.",
    }),
  }),

  Object.freeze({
    id: "draft",
    label: "Draft — 결제 요청 메시지 초안",
    order: 2,
    core_question: "그 사람한테 보낼 결제 요청 메시지, 가격·약속·기한 다 들어간 1문단으로 써.",
    first_prompt: Object.freeze({
      yesterday:
        "Target 1명 잡았어. 이제 모호한 ‘관심 있냐’ 메시지로 도망갈 자리 없어.",
      today:
        "결제 요청 초안 1문단 — (a) 가격, (b) 받을 약속, (c) 응답 기한. 셋 다 빠지면 monetization ask 아니야.",
      question:
        "지금 그 사람한테 보낼 메시지 1문단을 그대로 붙여넣어. 가격·약속·기한 빠진 곳 내가 짚는다.",
    }),
    captures: Object.freeze([
      "draft_text",
      "price_amount",
      "promise_delivered",
      "response_deadline",
    ]),
    /**
     * Advance to `sent` only when the draft contains all three pillars.
     * Reject "혹시 관심 있어?" / "베타 써볼래?" / "주변에 필요한 사람 있어?"
     * — these are not monetization asks even if they get a yes.
     */
    transition: Object.freeze({
      next: "sent",
      requires: Object.freeze([
        "explicit_price", // 가격 명시 (₩/$ 또는 free-trial-then-paid)
        "explicit_promise", // 무엇을 받는지 1줄
        "explicit_deadline", // 응답 또는 결제 기한
      ]),
      rejects: Object.freeze([
        "interest_check_only", // "관심 있냐"만 묻는 메시지
        "free_trial_only", // 무료 체험만 권유, 결제 의무 없음
        "waitlist_signup_ask", // 웨이팅리스트 등록 요청
        "referral_ask", // "주변에 필요한 사람 있냐"
      ]),
      pushback_template:
        "이건 결제 요청이 아니라 관심 점검이야. 가격·약속·기한 셋 중 빠진 거: {missing}. 다시 1문단으로 써.",
    }),
  }),

  Object.freeze({
    id: "sent",
    label: "Sent — 실제로 보냈어",
    order: 3,
    core_question: "그 메시지를 언제, 어떤 채널로 보냈어? 보낸 증거(스크린샷 경로/링크/타임스탬프)는?",
    first_prompt: Object.freeze({
      yesterday: "초안 통과했어. 이제 보내야 해. 안 보내면 Day 6 못 끝나.",
      today: "지금 그 사람한테 그 메시지를 보내. 30분 안에 돌아와서 ‘보냈다’ 확정해.",
      question:
        "보낸 시간·채널(DM/이메일/대면)·증거 1줄로 말해. 증거 없으면 안 보낸 거야.",
    }),
    captures: Object.freeze([
      "sent_at",
      "sent_channel",
      "sent_evidence_ref",
    ]),
    /**
     * Advance to `response` only when there's a timestamp + channel + an
     * evidence pointer (file path, URL, message ID). Reject vague "보냈어".
     */
    transition: Object.freeze({
      next: "response",
      requires: Object.freeze([
        "timestamp_present", // ISO 또는 "오늘 14:32" 등 구체적
        "channel_named", // DM / 이메일 / 대면 / Slack 등
        "evidence_pointer", // 스크린샷 경로/메시지 링크/회의 메모
      ]),
      rejects: Object.freeze([
        "vague_sent_claim", // "보냈어" only
        "future_tense", // "보낼 거야"
        "no_evidence", // 증거 누락
      ]),
      pushback_template:
        "‘보냈어’만으론 부족해. 시간·채널·증거 — 셋 중 빠진 거: {missing}. 보낸 게 사실이면 1분이면 채울 수 있어.",
    }),
  }),

  Object.freeze({
    id: "response",
    label: "Response — 그 사람이 뭐라고 했어",
    order: 4,
    core_question: "그 사람의 응답을 그대로 옮겨. yes / no / maybe / no_reply 중 하나로 분류해.",
    first_prompt: Object.freeze({
      yesterday: "메시지 보낸 거 확인됐어. 이제 응답을 받아야 끝나.",
      today:
        "응답이 오면 verbatim으로 붙여넣어. 응답 없으면 24시간 기다린 뒤 no_reply로 마감해.",
      question:
        "응답 본문 그대로 + 분류(yes/no/maybe/no_reply) + 결제 실행 여부 1줄. 요약하지 마, 그대로.",
    }),
    captures: Object.freeze([
      "response_verbatim",
      "response_classification", // yes | no | maybe | no_reply
      "payment_executed", // boolean
      "follow_up_needed",
    ]),
    /**
     * Terminal turn. Closing this turn writes
     * workspace/.agentic30/foundation/monetization-ask-result.md and stamps
     * `session.runtime.foundation.monetizationAsk.completedAt`. The Day 7
     * foundation-summary sub-workflow reads this artifact + classification
     * to compute go/no-go.
     */
    transition: Object.freeze({
      next: null, // terminal
      requires: Object.freeze([
        "response_verbatim_present", // 그대로 옮긴 텍스트 또는 명시적 no_reply
        "classification_present", // yes/no/maybe/no_reply 중 하나
      ]),
      rejects: Object.freeze([
        "summarized_response", // "긍정적이었어" 같은 요약
        "self_interpretation_only", // 너의 해석만 있고 원문 없음
      ]),
      pushback_template:
        "요약하면 데이터 죽어. 그 사람 말 그대로 — 한 글자도 바꾸지 마. no_reply면 ‘24h no_reply’ 한 줄.",
      on_complete: Object.freeze({
        artifact: "monetization-ask-result.md",
        next_day_signal: "foundation-summary", // Day 7 sub-workflow
      }),
    }),
  }),
]);

/**
 * Sub-workflow level metadata. Mirrored into evidence_refs sidecar so KR4.1
 * (user rating) and KR4.2 (cross-check 정합) can audit consistency.
 */
export const MONETIZATION_ASK_META = Object.freeze({
  name: "monetization-ask",
  day: 6,
  persona: PERSONA,
  template: TEMPLATE,
  artifact: "monetization-ask-result.md",
  total_turns: MONETIZATION_ASK_TURNS.length,
  invariants: Object.freeze([
    "no_waitlist_as_proof", // 웨이팅리스트는 monetization 아님
    "no_interest_as_proof", // 관심 표명은 monetization 아님
    "no_free_signup_as_proof", // 무료 가입은 monetization 아님
    "verbatim_response_required", // 응답은 그대로
    "named_target_required", // 타겟은 1명 named
  ]),
  classification_values: Object.freeze(["yes", "no", "maybe", "no_reply"]),
});

/**
 * Lookup helper: get a turn descriptor by id.
 * Returns null when the id does not match a defined turn.
 */
export function getMonetizationAskTurn(turnId) {
  if (!turnId || typeof turnId !== "string") return null;
  return MONETIZATION_ASK_TURNS.find((t) => t.id === turnId) || null;
}

/**
 * Resolve the "next" turn descriptor after the given turn id. Returns null
 * when the current turn is terminal or the id is unknown.
 */
export function getNextMonetizationAskTurn(currentTurnId) {
  const current = getMonetizationAskTurn(currentTurnId);
  if (!current || !current.transition?.next) return null;
  return getMonetizationAskTurn(current.transition.next);
}

/**
 * Initial turn — used when a session enters the monetization-ask workflow
 * for the first time (no prior `runtime.foundation.monetizationAsk.turn`).
 */
export function getInitialMonetizationAskTurn() {
  return MONETIZATION_ASK_TURNS[0];
}

/**
 * Render a turn-specific system prompt block. The dispatcher concatenates
 * this with the unified Foundation context built by foundation-chat.mjs —
 * single AI surface, no extra channel.
 *
 * The output is intentionally short: foundation-chat already injects persona,
 * template, and Day-6 core question. This block adds ONLY the per-turn
 * focus + transition rules so the model knows what advances the workflow.
 */
export function buildMonetizationAskTurnSystemBlock(turnId) {
  const turn = getMonetizationAskTurn(turnId) || getInitialMonetizationAskTurn();
  const lines = [];
  lines.push("# Sub-workflow: monetization-ask (Day 6)");
  lines.push(`- 현재 턴: ${turn.order}/${MONETIZATION_ASK_TURNS.length} — ${turn.label}`);
  lines.push(`- 이 턴의 핵심 질문: ${turn.core_question}`);
  if (turn.captures?.length) {
    lines.push(`- 이 턴에서 추출할 변수: ${turn.captures.join(", ")}`);
  }
  if (turn.transition?.requires?.length) {
    lines.push(`- 다음 턴(${turn.transition.next || "종료"})으로 가려면: ${turn.transition.requires.join(", ")}`);
  }
  if (turn.transition?.rejects?.length) {
    lines.push(`- 이 답변은 거부: ${turn.transition.rejects.join(", ")}`);
  }
  if (turn.transition?.pushback_template) {
    lines.push(`- 거부 시 pushback 톤: ${turn.transition.pushback_template}`);
  }
  lines.push("");
  lines.push("## 응답 규칙 (turn-local)");
  lines.push("- 3-section minimal 그대로: Yesterday 1줄 / Today 1줄 / Q 1줄.");
  lines.push("- 요약·해석 금지. 사용자 답변에서 captures를 그대로 추출.");
  lines.push("- Anti-pattern 감지 시: 다음 턴으로 advance 금지, pushback 1문장 + 같은 턴 반복.");
  lines.push("- 웨이팅리스트·관심 표명·무료 가입은 monetization proof 아님. 단호하게 reject.");
  return lines.join("\n");
}

/**
 * Render the AI's first message for a turn — the 3-section minimal opener
 * the chat surface displays when entering this turn. The dispatcher uses
 * this when:
 *   (a) the user just typed `/monetization-ask` (turn=target),
 *   (b) the previous turn's transition.requires were met and we advanced.
 */
export function buildMonetizationAskTurnFirstPrompt(turnId) {
  const turn = getMonetizationAskTurn(turnId) || getInitialMonetizationAskTurn();
  const fp = turn.first_prompt;
  return [
    `Yesterday: ${fp.yesterday}`,
    `Today: ${fp.today}`,
    `Q: ${fp.question}`,
  ].join("\n");
}

/**
 * Default export: a single-call builder used by the foundation-chat
 * dispatcher. Given the current turn id (or undefined for "start"), returns
 * everything the unified channel needs to render the turn:
 *
 *   {
 *     turn,                  // frozen turn descriptor
 *     systemBlock,           // string — turn-local system context
 *     firstPrompt,           // string — 3-section minimal opener
 *     nextTurnId,            // string | null — what advances to
 *     persona, template,     // sub-workflow invariants for telemetry
 *   }
 *
 * The caller stays single-channel: it only feeds `systemBlock` into the
 * existing composeUnifiedFoundationPrompt() pipeline.
 */
export default function buildMonetizationAskWorkflow(currentTurnId) {
  const turn = getMonetizationAskTurn(currentTurnId) || getInitialMonetizationAskTurn();
  return Object.freeze({
    name: MONETIZATION_ASK_META.name,
    day: MONETIZATION_ASK_META.day,
    persona: PERSONA,
    template: TEMPLATE,
    turn,
    systemBlock: buildMonetizationAskTurnSystemBlock(turn.id),
    firstPrompt: buildMonetizationAskTurnFirstPrompt(turn.id),
    nextTurnId: turn.transition?.next || null,
    isTerminal: !turn.transition?.next,
    artifact: MONETIZATION_ASK_META.artifact,
  });
}
