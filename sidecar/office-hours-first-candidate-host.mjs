// HOST-side enforcement for the locked Day-1 get_users first_candidate card.
//
// GPT-5.5 Pro's finding: prompt wording alone is insufficient — the standalone
// sourcing question is already forbidden in office-hours-chat-prompt.mjs, yet a
// generic-category card ("이번 주 첫 검증 상대를 어디서 잡을까요?" + 4 buckets) still
// shipped. So the HOST must reject + regenerate, and fail closed into a canonical
// host-authored card if the model still emits generic-only.
//
// Shares the deterministic matcher with the harness (Deliverable A) via
// office-hours-first-candidate-grounding.mjs — the classification is byte-for-byte
// identical on both sides. This module owns only the host policy: when to validate,
// and the canonical fallback card.
//
// Pure: no I/O, standard library only, explicit throws (no flag/shadow/silent
// accept). Callers do the regenerate round-trip; this module classifies and builds.

import { classifyFirstCandidateCard } from "./office-hours-first-candidate-grounding.mjs";

// "Verified Candidate Hints" are available ONLY when the office-hours context the
// host injected actually carries a non-empty `## Verified Candidate Hints` section.
// Substrate reality: this section is never injected today (no customer-contact
// event source), so the EMPTY-hints branch — force a named free-text capture — is
// the live path. The hints-present branch (grounded hint options) is dormant-but-ready
// for when extraction exists. "available" is mechanical: section present & non-empty.
const VERIFIED_CANDIDATE_HINTS_HEADING = "## Verified Candidate Hints";

export function hasVerifiedCandidateHints(context = "") {
  const text = String(context || "");
  const idx = text.indexOf(VERIFIED_CANDIDATE_HINTS_HEADING);
  if (idx === -1) return false;
  // Non-empty = at least one non-heading, non-blank line before the next "## " or EOF.
  const after = text.slice(idx + VERIFIED_CANDIDATE_HINTS_HEADING.length);
  for (const rawLine of after.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith("## ")) break; // next section, hints body was empty
    return true;
  }
  return false;
}

/** The single canonical signalId / questionId for the first_candidate slot. */
export const FIRST_CANDIDATE_SIGNAL_ID = "get_users_first_candidate";
export const FIRST_CANDIDATE_UNBLOCK_SIGNAL_ID = "get_users_first_candidate_unblock";

export function isFirstCandidateSignal(signalId = "") {
  const id = String(signalId || "").trim();
  return id === FIRST_CANDIDATE_SIGNAL_ID || id === `office_hours_${FIRST_CANDIDATE_SIGNAL_ID}`;
}

/**
 * Decide whether a prepared/promoted office-hours payload is a first_candidate card
 * that the host must validate. TRUE only when (a) the card's slot is the
 * first_candidate slot, and (b) no Verified Candidate Hints were injected — the
 * EMPTY-hints reality where generic categories are the failure mode. With hints
 * present (dormant branch) the model is told to emit grounded hint options, which
 * the matcher recognizes as forces_specificity, so no host fallback is needed.
 */
export function shouldValidateFirstCandidatePayload(payload = {}, context = "") {
  if (!payload || typeof payload !== "object") return false;
  const signalId = String(payload?.generation?.signalId || payload?.generation?.signal_id || "").trim();
  if (!isFirstCandidateSignal(signalId)) return false;
  return !hasVerifiedCandidateHints(context);
}

/**
 * Classify the first question of a payload as a first_candidate card. Returns the
 * classification ({ genericOnly, forcesSpecificity, blockerCount, ... }) or null
 * when there is no question to classify (fail-closed: caller treats null as
 * "cannot validate" and rejects).
 */
export function classifyFirstCandidatePayload(payload = {}) {
  const questions = Array.isArray(payload?.questions) ? payload.questions : [];
  const question = questions[0];
  if (!question || typeof question !== "object") return null;
  return classifyFirstCandidateCard(question);
}

export function hasRequiredFirstCandidatePrimaryTextInput(question = {}) {
  if (!question || typeof question !== "object" || Array.isArray(question)) return false;
  const input = question.primaryTextInput || question.primary_text_input;
  if (!input || typeof input !== "object" || Array.isArray(input)) return false;
  const label = String(input.label || "").trim();
  const placeholder = String(input.placeholder || input.freeTextPlaceholder || input.free_text_placeholder || "").trim();
  return Boolean(label && placeholder && input.required === true);
}

// Canonical host-authored first_candidate card (EMPTY-hints path). Forces a named
// free-text capture of an exact reachable person/handle/thread/source, plus EXACTLY
// one explicit "아직 후보 없음" blocker that routes to an acquisition branch. Never
// fabricates a name. The visible copy is honest and project-agnostic so it is safe
// as a deterministic substitute when the model keeps emitting generic categories.
//
// Contract-compatible: allowFreeText:true / requiresFreeText:false (the office-hours
// structured-input contract mandates these), 2-4 options, explicit Korean header,
// stable signalId. The placeholder + the first option label carry a specific-identity
// instruction so classifyFirstCandidateCard reports forcesSpecificity:true and
// genericOnly:false.
export function buildCanonicalFirstCandidateCard({
  sessionId = "",
  provider = "codex",
  toolName = "agentic30_request_user_input",
  attemptToken = null,
} = {}) {
  const question = {
    questionId: FIRST_CANDIDATE_SIGNAL_ID,
    header: "첫 후보 확정",
    question:
      "오늘 실제로 연락하거나 글을 올릴 수 있는 첫 사람의 실명·핸들, 또는 구체적 스레드·모임·채널을 한 곳만 적어 주세요.",
    helperText: "범주(지인·커뮤니티)가 아니라, 오늘 바로 닿을 수 있는 한 사람/한 스레드를 정확히 적어 주세요.",
    freeTextPlaceholder: "예: 실명 또는 @핸들 — 오늘 DM·카톡으로 보낼 이 검증 요청 한 줄",
    options: [
      {
        label: "오늘 연락할 실명·핸들을 직접 적기",
        description:
          "지금 바로 닿을 수 있는 한 사람의 실명이나 @핸들, 또는 구체적 스레드/모임/채널을 자유 입력으로 적습니다.",
        nextIntent: "named_reachable_candidate",
        recommended: true,
        risk: "범주로 답하면 후보를 좁히지 못해 오늘 보낼 요청이 비어 있게 됩니다.",
        evidenceTarget: "실명 또는 @핸들, 닿을 채널, 오늘 보낼 요청",
        mapsTo: "get_users_first_candidate",
        failureMode: "이름 대신 범주를 적으면 후보 확정이 아니라 후보 찾기로 낮춥니다.",
      },
      {
        label: "아직 후보 없음 — 오늘은 이름 찾기부터",
        description:
          "정직하게 비어 있으면 오늘 할 일은 후보 한 명의 실명·핸들을 찾는 행동을 정하는 것입니다.",
        nextIntent: "no_candidate_yet",
        risk: "후보가 계속 비면 검증이 시작되지 않습니다.",
        evidenceTarget: "오늘 안에 후보 1명을 찾을 구체적 경로",
        mapsTo: "get_users_first_candidate",
        failureMode: "후보 찾기 행동조차 비우면 Day가 진전 없이 끝납니다.",
      },
    ],
    multiSelect: false,
    allowFreeText: true,
    requiresFreeText: false,
    primaryTextInput: {
      label: "실명·핸들 또는 구체적 스레드",
      placeholder: "예: 김OO 또는 @handle — 오늘 DM·카톡으로 보낼 검증 요청 한 줄",
      required: true,
      submitLabel: "첫 후보 확정",
      validationMessage: "실명·핸들 또는 구체적 스레드와 오늘 보낼 요청을 입력해야 합니다.",
    },
    textMode: "short",
  };
  const payload = {
    sessionId: String(sessionId || ""),
    toolName,
    title: "Office Hours",
    questions: [question],
    generation: {
      mode: "office_hours_inline",
      docType: "day1_step",
      signalId: FIRST_CANDIDATE_SIGNAL_ID,
      signalLabel: "첫 후보 확정",
      ...(attemptToken && typeof attemptToken === "object" ? attemptToken : {}),
    },
  };
  return payload;
}

export function buildNoCandidateUnblockCard({
  sessionId = "",
  provider = "codex",
  toolName = "agentic30_request_user_input",
} = {}) {
  const question = {
    questionId: FIRST_CANDIDATE_UNBLOCK_SIGNAL_ID,
    header: "후보 확보",
    question:
      "아직 후보가 없다면 오늘 30분 안에 어느 채널에서 어떤 검색어·게시글·소개 요청으로 실명·핸들 1명을 찾고, 찾은 뒤 어떤 한 줄 요청을 보낼 건가요?",
    helperText:
      "범주가 아니라 시간, 채널, 검색어 또는 게시 위치, 후보 조건, 보낼 요청까지 적습니다.",
    freeTextPlaceholder:
      "예: 오늘 18:00까지 Threads에서 \"solo founder mac app\"으로 검색해 @handle 1명을 찾고, '이번 주 15분만 실제 프로젝트 연결을 봐달라'고 DM 보낸다",
    options: [
      {
        label: "스레드/커뮤니티에서 찾기",
        description: "검색어, 게시 위치, 후보 조건, 보낼 요청을 한 줄로 적습니다.",
        nextIntent: "find_candidate_in_thread_or_community",
        recommended: true,
        evidenceTarget: "채널, 검색어/게시 위치, 후보 조건, 보낼 요청",
        mapsTo: FIRST_CANDIDATE_SIGNAL_ID,
        failureMode: "채널만 적으면 실행 가능한 후보 확보 행동이 아닙니다.",
      },
      {
        label: "기존 네트워크에서 소개 요청",
        description: "누구에게 어떤 소개 문장을 보낼지 적습니다.",
        nextIntent: "ask_network_for_intro",
        evidenceTarget: "소개 요청 대상, 소개받을 후보 조건, 보낼 문장",
        mapsTo: FIRST_CANDIDATE_SIGNAL_ID,
        failureMode: "소개 요청 대상이 없으면 오늘 실행할 행동이 비어 있습니다.",
      },
      {
        label: "사용자 흔적에서 찾기",
        description: "GitHub, PostHog, Discord, 이메일 등 실제 흔적에서 누구를 찾을지 적습니다.",
        nextIntent: "find_candidate_from_usage_signal",
        evidenceTarget: "사용자 흔적 위치, 후보 조건, 보낼 요청",
        mapsTo: FIRST_CANDIDATE_SIGNAL_ID,
        failureMode: "흔적 위치가 없으면 후보 찾기가 추상적입니다.",
      },
    ],
    multiSelect: false,
    allowFreeText: true,
    requiresFreeText: false,
    primaryTextInput: {
      label: "후보 확보 행동",
      placeholder: "시간 + 채널 + 검색어/게시 위치 + 보낼 요청",
      required: true,
      submitLabel: "후보 찾기 행동 확정",
      validationMessage: "시간, 채널, 찾는 방법, 보낼 요청을 적어야 합니다.",
    },
    textMode: "short",
  };

  return {
    sessionId: String(sessionId || ""),
    toolName,
    title: "Office Hours",
    questions: [question],
    generation: {
      mode: "office_hours",
      docType: "day1_candidate_unblock",
      signalId: FIRST_CANDIDATE_UNBLOCK_SIGNAL_ID,
      signalLabel: "후보 확보",
      previousSignalId: FIRST_CANDIDATE_SIGNAL_ID,
    },
  };
}
