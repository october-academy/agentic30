// Office Hours loading-card status copy.
//
// Two parallel tables drive the "준비 중" loading card the Mac app renders while
// an Office Hours / Day 1 interview question is being generated:
//
//   OFFICE_HOURS_STATUS_COPY                — follow-up / continuation questions
//   OFFICE_HOURS_FIRST_QUESTION_STATUS_COPY — the first question of a session
//
// emitOfficeHoursStatus (index.mjs) resolves a stage to title/detail/progressText
// server-side and broadcasts the resolved text; the Swift client renders it
// verbatim. The caller selects which table to resolve against. There is NO
// cross-table fallback: each emit resolves against exactly one table.
//
// Which table applies is a per-question decision, not a per-run one. Claude's
// blocking-continue model runs the WHOLE interview inside a single
// runOfficeHours call (AskUserQuestion blocks until the user answers, then the
// same stream generates the next question), so runOfficeHours selects the table
// per emit via selectOfficeHoursStatusCopy below: first-question copy until the
// first structured answer arrives, follow-up copy afterwards. Codex ends its run
// after each question; its continuation runs go through the chat path, which
// always uses the follow-up table.
//
// IMPORTANT INVARIANT: the first-question table MUST define the same stage keys
// as the regular table. A missing key means emitOfficeHoursStatus resolves empty
// copy and skips the broadcast, so the loading card would stall on that stage —
// and within EACH table the two in-progress stages a provider interleaves per
// token (provider_thinking ↔ tool_running, e.g. Claude's thinking/tool-input
// deltas) MUST resolve to identical copy so the card never oscillates. The
// office-hours-status test pins both relationships.

export const OFFICE_HOURS_STATUS_COPY = Object.freeze({
  context_loaded: {
    title: "답변 확인 중",
    detail: "방금 답변과 프로젝트 정보를 확인하고 있습니다.",
    progressText: "질문에 필요한 맥락 확인 중",
  },
  specialist_routed: {
    title: "다음 질문 방향 정하는 중",
    detail: "무엇을 더 물어보면 좋을지 고르고 있습니다.",
    progressText: "다음 질문 방향 정하는 중",
  },
  provider_starting: {
    title: "다음 질문 준비 중",
    detail: "답변과 프로젝트 맥락에 맞는 다음 질문을 준비하고 있습니다.",
    progressText: "프로젝트 맥락에 맞는 다음 질문 준비 중",
  },
  provider_thinking: {
    title: "다음 질문 준비 중",
    detail: "선택한 답변과 입력 내용을 바탕으로 이어서 물어볼 질문을 정리하고 있습니다.",
    progressText: "답변을 바탕으로 다음 질문 준비 중",
  },
  // Deliberately identical to provider_thinking — same anti-flicker invariant
  // as the first-question table. Claude's blocking-continue interview keeps
  // questions 2..N inside the same run, interleaving thinking_delta
  // (→ provider_thinking) and input_json_delta (→ tool_running) per token while
  // building each follow-up question; distinct copy here made the card
  // oscillate between two titles once the table switched over.
  tool_running: {
    title: "다음 질문 준비 중",
    detail: "선택한 답변과 입력 내용을 바탕으로 이어서 물어볼 질문을 정리하고 있습니다.",
    progressText: "답변을 바탕으로 다음 질문 준비 중",
  },
  structured_input_requested: {
    title: "질문 화면 여는 중",
    detail: "곧 다음 질문이 선택지와 함께 표시됩니다.",
    progressText: "다음 질문 화면 여는 중",
  },
  question_ready: {
    title: "다음 질문 준비 완료",
    detail: "선택하거나 직접 입력하면 이어서 진행합니다.",
    progressText: "다음 질문 준비 완료",
  },
  completed: {
    title: "응답 정리 중",
    detail: "방금 답변을 저장하고 화면 상태를 정리하고 있습니다.",
    progressText: "응답 정리 중",
  },
  failed: {
    title: "질문 준비 실패",
    detail: "오류 내용을 화면에 반영하고 있습니다.",
    progressText: "질문 준비 실패",
  },
  aborted: {
    title: "질문 준비 중단됨",
    detail: "요청을 멈추고 화면 상태를 정리하고 있습니다.",
    progressText: "질문 준비 중단됨",
  },
});

export const OFFICE_HOURS_FIRST_QUESTION_STATUS_COPY = Object.freeze({
  context_loaded: {
    title: "목표 확인 중",
    detail: "목표와 프로젝트 정보를 확인하고 있습니다.",
    progressText: "목표와 프로젝트 정보 확인 중",
  },
  specialist_routed: {
    title: "첫 질문 방향 정하는 중",
    detail: "가장 먼저 확인할 내용을 고르고 있습니다.",
    progressText: "첫 질문 방향 정하는 중",
  },
  provider_starting: {
    title: "첫 질문 준비 중",
    detail: "프로젝트 맥락에 맞는 첫 질문을 준비하고 있습니다.",
    progressText: "프로젝트 맥락에 맞는 첫 질문 준비 중",
  },
  provider_thinking: {
    title: "첫 질문 준비 중",
    detail: "목표와 세션 맥락을 바탕으로 확인할 질문을 정리하고 있습니다.",
    progressText: "목표와 세션 맥락으로 첫 질문 준비 중",
  },
  // Deliberately identical to provider_thinking. During first-question
  // generation the Claude SDK streams thinking_delta (→ provider_thinking) and
  // input_json_delta (→ tool_running) interleaved per token; without this key
  // tool_running fell through to the regular OFFICE_HOURS_STATUS_COPY copy
  // ("선택지 준비 중"), so the loading card oscillated between two titles. Making
  // the two stages resolve to identical copy keeps the first-question card
  // steady regardless of how the provider interleaves the deltas.
  tool_running: {
    title: "첫 질문 준비 중",
    detail: "목표와 세션 맥락을 바탕으로 확인할 질문을 정리하고 있습니다.",
    progressText: "목표와 세션 맥락으로 첫 질문 준비 중",
  },
  structured_input_requested: {
    title: "질문 화면 여는 중",
    detail: "곧 첫 질문이 선택지와 함께 표시됩니다.",
    progressText: "첫 질문 화면 여는 중",
  },
  question_ready: {
    title: "첫 질문 준비 완료",
    detail: "선택하거나 직접 입력하면 Office Hours를 시작합니다.",
    progressText: "첫 질문 준비 완료",
  },
  // Terminal stages mirror OFFICE_HOURS_STATUS_COPY so the first-question table
  // is a complete superset of the regular stage keys (no silent fall-through).
  completed: {
    title: "응답 정리 중",
    detail: "방금 답변을 저장하고 화면 상태를 정리하고 있습니다.",
    progressText: "응답 정리 중",
  },
  failed: {
    title: "질문 준비 실패",
    detail: "오류 내용을 화면에 반영하고 있습니다.",
    progressText: "질문 준비 실패",
  },
  aborted: {
    title: "질문 준비 중단됨",
    detail: "요청을 멈추고 화면 상태를 정리하고 있습니다.",
    progressText: "질문 준비 중단됨",
  },
});

// Per-emit table selection for the single-run (blocking-continue) interview
// path: first-question copy until the first structured answer arrives,
// follow-up copy for every question after it.
export function selectOfficeHoursStatusCopy({ firstQuestionAnswered = false } = {}) {
  return firstQuestionAnswered
    ? OFFICE_HOURS_STATUS_COPY
    : OFFICE_HOURS_FIRST_QUESTION_STATUS_COPY;
}
