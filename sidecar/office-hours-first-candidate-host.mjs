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
// ICP/help direction capture plus EXACTLY one explicit "아직 후보 없음" blocker that
// routes to an acquisition branch. It does not fabricate a person name; instead it
// lets the founder pick the concrete ICP/value wedge Agentic30 should help with
// first, with optional name/handle refinement when one exists.
//
// Contract-compatible: allowFreeText:true / requiresFreeText:false (the office-hours
// structured-input contract mandates these), 2-4 options, explicit Korean header,
// stable signalId. The placeholder/question still carry specific-identity language
// so classifyFirstCandidateCard reports forcesSpecificity:true and genericOnly:false.
export function buildCanonicalFirstCandidateCard({
  sessionId = "",
  provider = "codex",
  toolName = "agentic30_request_user_input",
  attemptToken = null,
} = {}) {
  const question = {
    questionId: FIRST_CANDIDATE_SIGNAL_ID,
    header: "첫 고객 도움 만들기",
    question:
      "Agentic30가 오늘 바로 도울 첫 고객 후보와 보낼 요청까지 만들까요?",
    helperText: "기본안으로 바로 진행됩니다. 이미 떠오른 사람·채널·검색어가 있을 때만 한 줄로 바꾸세요.",
    freeTextPlaceholder: "선택사항: 사람·채널·검색어·보낼 요청",
    options: [
      {
        label: "첫 고객에게 줄 도움 만들기",
        description:
          "후보 조건, 검색 경로, 보낼 요청, 15분 도움안, 남길 흔적을 Agentic30가 한 번에 묶습니다.",
        answerText:
          "오늘 Threads나 커뮤니티에서 AI/macOS 앱을 만들지만 첫 고객 후보와 첫 요청 문장이 막힌 전업 1인 개발자 1명을 찾고, 15분 실행 도움 요청을 보낸다",
        candidate:
          "AI/macOS 앱을 만들지만 첫 고객 후보와 첫 요청 문장이 막힌 전업 1인 개발자",
        currentAlternative:
          "커뮤니티 글, Threads 검색, 지인 조언을 훑지만 실제로 보낼 요청문까지 가지 못한다.",
        externalAction:
          "오늘 후보 1명에게 15분 실행 도움 요청을 보내고 Agentic30가 첫 고객 요청문 또는 작은 결과물을 만들어 준다.",
        attemptThreshold: "후보 1명에게 도움 제안 1회",
        successCondition: "상대가 요청문이나 결과물을 보고 다음 행동, 사용 가능 여부, 또는 거절 이유를 답한다.",
        expectedProofKind: "screen_capture_with_note",
        evidenceLocation: ".agentic30/day1-notes.md",
        commitmentNote:
          "오늘 첫 고객 후보 1명에게 도움 요청을 보내고 결과 화면 캡처와 로컬 메모를 .agentic30/day1-notes.md에 남긴다.",
        nextIntent: "help_first_customer_with_value",
        recommended: true,
        risk: "후보를 넓게 고민하면 오늘 줄 도움이 조언으로 흐릅니다.",
        evidenceTarget: "후보 조건, 보낼 요청문, 실제 연락 흔적",
        mapsTo: "get_users_first_candidate",
        failureMode: "상대가 당장 얻을 결과가 없으면 고객 확보가 아니라 콘텐츠 소비로 끝납니다.",
        autoTransitions: [
          {
            type: "record_alternative",
            fields: {
              currentAlternative:
                "커뮤니티 글, Threads 검색, 지인 조언을 훑지만 실제로 보낼 요청문까지 가지 못한다.",
            },
          },
          {
            type: "define_action_contract",
            fields: {
              externalAction:
                "오늘 후보 1명에게 15분 실행 도움 요청을 보내고 Agentic30가 첫 고객 요청문 또는 작은 결과물을 만들어 준다.",
              attemptThreshold: "후보 1명에게 도움 제안 1회",
              successCondition:
                "상대가 요청문이나 결과물을 보고 다음 행동, 사용 가능 여부, 또는 거절 이유를 답한다.",
            },
            auditText: "후보 1명에게 바로 줄 도움을 실행안으로 둔다.",
          },
          {
            type: "define_evidence_contract",
            fields: {
              expectedProofKind: "screen_capture_with_note",
              evidenceLocation: ".agentic30/day1-notes.md",
            },
            auditText: "로컬 메모와 화면 캡처로 오늘 실행 흔적을 남긴다.",
          },
          {
            type: "schedule_execution",
            fields: {
              commitmentNote:
                "오늘 첫 고객 후보 1명에게 도움 요청을 보내고 결과 화면 캡처와 로컬 메모를 .agentic30/day1-notes.md에 남긴다.",
            },
            auditText: "추천 가치안 그대로 오늘 실행을 닫는다.",
          },
        ],
      },
    ],
    multiSelect: false,
    allowFreeText: true,
    requiresFreeText: false,
    allowsEmptySubmit: true,
    primaryTextInput: {
      label: "필요하면 한 줄 수정",
      placeholder: "선택사항: 사람·채널·검색어·보낼 요청",
      required: false,
      submitLabel: "추천안으로 진행",
      validationMessage: "입력하지 않아도 추천안으로 진행됩니다.",
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
      signalLabel: "첫 고객 도움",
      dimensionStepIndex: 1,
      dimensionTotal: 1,
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
    header: "첫 고객 도움 만들기",
    question:
      "아직 후보가 없다면 Agentic30가 고객 후보 1명과 첫 도움 요청까지 바로 만들까요?",
    helperText:
      "기본안으로 바로 진행됩니다. 이미 떠오른 사람·채널·검색어가 있을 때만 한 줄로 바꾸세요.",
    freeTextPlaceholder:
      "선택사항: 사람·채널·검색어가 있으면 한 줄 수정",
    options: [
      {
        label: "후보 찾기와 첫 도움 요청 만들기",
        description: "검색어, 후보 조건, 보낼 요청, 남길 흔적을 Agentic30가 한 번에 묶습니다.",
        answerText:
          "오늘 Threads에서 \"solo founder mac app\" 또는 \"AI로 앱 만들기\"로 검색해 전업 1인 개발자 1명을 찾고, 15분 실행 도움 DM을 보낸다",
        candidate:
          "Threads에서 \"solo founder mac app\" 또는 \"AI로 앱 만들기\"로 찾을 전업 1인 개발자 후보",
        currentAlternative:
          "후보가 비어 있어 고객 검증 대신 검색과 조언 소비에 머문다.",
        externalAction:
          "오늘 Threads나 커뮤니티에서 후보 1명을 찾고 15분 실행 도움 요청을 보낸다.",
        attemptThreshold: "후보 1명 찾기와 도움 제안 1회",
        successCondition: "상대가 도움 요청에 답하거나, 답이 없으면 보낸 요청과 내일 확인 시각이 남는다.",
        expectedProofKind: "message_log",
        evidenceLocation: ".agentic30/day1-notes.md",
        commitmentNote:
          "오늘 후보 1명을 찾고 첫 도움 요청 문장을 보내거나 발송 준비까지 마친 뒤 .agentic30/day1-notes.md에 남긴다.",
        nextIntent: "find_candidate_in_thread_or_community",
        recommended: true,
        evidenceTarget: "채널, 검색어/게시 위치, 후보 조건, 보낼 요청",
        mapsTo: FIRST_CANDIDATE_SIGNAL_ID,
        failureMode: "검색 후 바로 보낼 요청이 없으면 후보 찾기에서 멈춥니다.",
        autoTransitions: [
          {
            type: "record_alternative",
            fields: {
              currentAlternative:
                "후보가 비어 있어 고객 검증 대신 검색과 조언 소비에 머문다.",
            },
          },
          {
            type: "define_action_contract",
            fields: {
              externalAction:
                "오늘 Threads나 커뮤니티에서 후보 1명을 찾고 15분 실행 도움 요청을 보낸다.",
              attemptThreshold: "후보 1명 찾기와 도움 제안 1회",
              successCondition:
                "상대가 도움 요청에 답하거나, 답이 없으면 보낸 요청과 내일 확인 시각이 남는다.",
            },
            auditText: "후보 찾기와 첫 도움 요청을 오늘 실행안으로 둔다.",
          },
          {
            type: "define_evidence_contract",
            fields: {
              expectedProofKind: "message_log",
              evidenceLocation: ".agentic30/day1-notes.md",
            },
            auditText: "보낸 요청과 확인 시각을 로컬 메모로 남긴다.",
          },
          {
            type: "schedule_execution",
            fields: {
              commitmentNote:
                "오늘 후보 1명을 찾고 첫 도움 요청 문장을 보내거나 발송 준비까지 마친 뒤 .agentic30/day1-notes.md에 남긴다.",
            },
            auditText: "후보 찾기에서 멈추지 않고 첫 도움 요청까지 닫는다.",
          },
        ],
      },
    ],
    multiSelect: false,
    allowFreeText: true,
    requiresFreeText: false,
    allowsEmptySubmit: true,
    primaryTextInput: {
      label: "필요하면 한 줄 수정",
      placeholder: "선택사항: 사람·채널·검색어·보낼 요청",
      required: false,
      submitLabel: "추천안으로 진행",
      validationMessage: "입력하지 않아도 추천안으로 진행됩니다.",
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
      signalLabel: "첫 고객 도움",
      dimensionStepIndex: 1,
      dimensionTotal: 1,
      previousSignalId: FIRST_CANDIDATE_SIGNAL_ID,
    },
  };
}
