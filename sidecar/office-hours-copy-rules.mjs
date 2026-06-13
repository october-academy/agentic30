// Office Hours UI-copy contract inspired by im-not-ai's quick-rules shape:
// classify visible Korean-copy risks, inject the contract into the provider
// prompt, and expose a validator for tests/telemetry. This module deliberately
// does not rewrite model output into fixed Korean strings; the copy should be
// improved by instruction and contract, not screenshot-specific hardcoding.

export const OFFICE_HOURS_COPY_CONTRACT_VERSION = 1;

export const OFFICE_HOURS_COPY_RULEBOOK = Object.freeze([
  Object.freeze({
    id: "OH-S1-ICP",
    severity: "S1",
    pattern: /\bICP\b/g,
    problem: "사용자가 바로 이해하기 어려운 내부 약어",
    guidance: "고객 후보, 고객 조건처럼 화면에서 바로 읽히는 말로 풀어 쓴다.",
  }),
  Object.freeze({
    id: "OH-S1-ACTIVATION",
    severity: "S1",
    pattern: /\bactivation action\b/gi,
    problem: "영어 제품 분석 용어가 사용자 문장에 노출됨",
    guidance: "핵심 행동처럼 사용자가 실제로 끝낼 행동으로 쓴다.",
  }),
  Object.freeze({
    id: "OH-S1-VANITY",
    severity: "S1",
    pattern: /\bvanity traffic\b|허영\s*지표/g,
    problem: "비판적 분석 용어가 그대로 노출되어 의미가 흐림",
    guidance: "조회, 좋아요, 팔로워처럼 실제 화면 숫자를 직접 말한다.",
  }),
  Object.freeze({
    id: "OH-S1-WEDGE",
    severity: "S1",
    pattern: /\bwedge\b/gi,
    problem: "YC식 내부 용어가 선택지에 노출됨",
    guidance: "첫 진입점, 처음 공략할 좁은 길처럼 풀어 쓴다.",
  }),
  Object.freeze({
    id: "OH-S1-PROOF",
    severity: "S1",
    pattern: /\bproof target\b/gi,
    problem: "검증 설계 용어가 사용자 질문처럼 보임",
    guidance: "검증 기준, 확인할 숫자처럼 구체 행동 기준으로 쓴다.",
  }),
  Object.freeze({
    id: "OH-S1-COLLECTIVE",
    severity: "S1",
    pattern: /집합명사/g,
    problem: "글쓰기 평가 용어가 인터뷰 질문에 섞임",
    guidance: "넓은 말 대신 실제 사람, 상황, 행동을 묻는다.",
  }),
  Object.freeze({
    id: "OH-S1-SIGNUP-GOAL",
    severity: "S1",
    pattern: /가입자\s*100명/g,
    problem: "get_users 목표를 가입 수로 되돌려 활성 사용자 기준을 흐림",
    guidance: "활성 사용자 100명, 또는 핵심 행동을 끝낸 사용자 100명으로 유지한다.",
  }),
  Object.freeze({
    id: "OH-S2-LANDING-SIGNUP",
    severity: "S2",
    pattern: /랜딩\s*\/\s*가입\s*구간/g,
    problem: "슬래시로 묶은 내부 분석 라벨",
    guidance: "사용자가 지나가는 실제 흐름을 한 문장으로 풀어 쓴다.",
  }),
  Object.freeze({
    id: "OH-S2-POST-SIGNUP",
    severity: "S2",
    pattern: /게시물\s*(?:→|->)\s*가입(?:\s*전환)?/g,
    problem: "화살표식 분석 메모가 UI 선택지에 노출됨",
    guidance: "게시물을 본 뒤 어떤 행동까지 이어졌는지 자연어로 묻는다.",
  }),
  Object.freeze({
    id: "OH-S2-INTERNAL-RISK",
    severity: "S2",
    pattern: /(?:^|\s)리스크\s*[:：]/g,
    problem: "metadata에 있어야 할 분석 태그가 설명문에 노출됨",
    guidance: "위험/주의점은 risk metadata에 두고, 설명문은 쉬운 한 문장으로 쓴다.",
  }),
  Object.freeze({
    id: "OH-S2-STRONG-NEXT",
    severity: "S2",
    pattern: /가장\s*강함\.\s*다음\s*[:：]/g,
    problem: "모델의 판정 메모가 사용자 문장에 노출됨",
    guidance: "판정은 metadata로 보내고, 화면에는 선택 결과만 설명한다.",
  }),
  Object.freeze({
    id: "OH-S2-ZERO",
    severity: "S2",
    pattern: /0부터\s*시작/g,
    problem: "번역투 숫자 표현",
    guidance: "처음부터 시작, 아직 기준이 없다처럼 자연스럽게 쓴다.",
  }),
  Object.freeze({
    id: "OH-S3-SLASH",
    severity: "S3",
    pattern: /[^\s]+\/[^\s]+/g,
    problem: "짧은 UI 문구에 슬래시 묶음이 많아 스캔이 어려움",
    guidance: "짧은 명사구 하나로 줄이거나 한 문장으로 풀어 쓴다.",
  }),
  Object.freeze({
    id: "OH-S3-PAREN",
    severity: "S3",
    pattern: /[（(][^)）]{6,}[)）]/g,
    problem: "괄호 설명이 길어 카드 문장이 끊김",
    guidance: "괄호 안 설명을 별도 문장이나 metadata로 옮긴다.",
  }),
]);

export function buildOfficeHoursUiCopyContractPrompt() {
  const rules = OFFICE_HOURS_COPY_RULEBOOK.map((rule) => (
    `- ${rule.severity} ${rule.id}: ${rule.problem}. ${rule.guidance}`
  ));
  return [
    "## Korean UI Copy Contract",
    "Apply this contract to every user-visible `question`, `header`, `helperText`, option `label`, option `description`, and `freeTextPlaceholder` in Office Hours structured-input cards.",
    "Question: exactly one natural Korean sentence, scoped to one decision.",
    "Option label: short Korean noun phrase, not a sentence fragment copied from internal analysis.",
    "Option description: one easy Korean sentence. Do not expose `risk`, `evidenceTarget`, `failureMode`, or scoring notes as visible prefixes.",
    "Do-NOT preservation: keep `questionId`, `generation.signalId`, `generation.signalLabel`, `allowFreeText`, `requiresFreeText`, `recommended`, `risk`, `evidenceTarget`, `mapsTo`, and `failureMode` semantically intact. Never remove generation metadata, never promote general interview cards to `requiresFreeText: true`, and never rely on the host to repair missing Office Hours contract fields. Evidence text is optional when choices exist. Move analysis details into metadata instead of deleting them.",
    "For get_users goals, never weaken the target into signups. Keep the 기준 as active users completing the chosen 핵심 행동.",
    "Severity: S1 must be rewritten before showing the card; S2 should be rewritten unless the user's own wording requires it; S3 is polish for readability.",
    ...rules,
    "Self-check before calling the structured-input tool: visible Korean reads like a Korean app screen, preserves the startup judgment, and has no S1 violations.",
  ].join("\n");
}

export function inspectOfficeHoursUiCopyRequest(request = {}) {
  if (!request || typeof request !== "object" || !Array.isArray(request.questions)) {
    return [];
  }
  const issues = [];
  request.questions.forEach((question, questionIndex) => {
    for (const field of visibleQuestionFields(question)) {
      for (const rule of OFFICE_HOURS_COPY_RULEBOOK) {
        rule.pattern.lastIndex = 0;
        if (!rule.pattern.test(field.value)) continue;
        issues.push({
          version: OFFICE_HOURS_COPY_CONTRACT_VERSION,
          ruleId: rule.id,
          severity: rule.severity,
          questionIndex,
          path: field.path,
          problem: rule.problem,
          guidance: rule.guidance,
          value: field.value,
        });
      }
    }
  });
  return issues;
}

export function normalizeOfficeHoursUiCopyRequest(request = {}) {
  // Contract-only gate: no deterministic copy rewriting. Keeping this as a
  // pass-through makes the runtime call sites explicit while avoiding hidden UI
  // copy substitutions that would fight the model's question intent.
  return request;
}

function visibleQuestionFields(question = {}) {
  if (!question || typeof question !== "object") return [];
  const fields = [
    ["header", question.header],
    ["question", question.question],
    ["helperText", question.helperText],
    ["helper_text", question.helper_text],
    ["freeTextPlaceholder", question.freeTextPlaceholder],
    ["free_text_placeholder", question.free_text_placeholder],
  ];
  const options = Array.isArray(question.options) ? question.options : [];
  options.forEach((option, optionIndex) => {
    fields.push([`options.${optionIndex}.label`, option?.label]);
    fields.push([`options.${optionIndex}.description`, option?.description]);
  });
  return fields
    .map(([path, value]) => ({ path, value: String(value || "").replace(/\s+/g, " ").trim() }))
    .filter((field) => field.value);
}
