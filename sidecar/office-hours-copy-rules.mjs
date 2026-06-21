// Office Hours UI-copy contract inspired by im-not-ai's quick-rules shape:
// classify visible Korean-copy risks, inject the contract into the provider
// prompt, and expose a validator for tests/telemetry. Runtime normalization is
// intentionally conservative: only visible card copy is rewritten, and unresolved
// S1 copy fails explicitly instead of relying on a quiet host fallback.

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
    id: "OH-S1-CLOSING-JARGON",
    severity: "S1",
    pattern: /닫(?:을까요|을까|게|기|다|는다|을|은|힌|히는)|Day\s*(?:를\s*)?닫|증거\s*마감|마감(?:할까요|할까|하기|한다|할지|상태|조건)|\bevidence-closing\b|\bclose\s+the\s+Day\b|\bcommitment\s+close\b/gi,
    problem: "내부 완료 처리 용어가 사용자 질문에 직역되어 노출됨",
    guidance: "질문형은 `어떻게 마무리할까요?`, 상태 선택형은 `완료, 보류, 내일로 넘김 중 어떤 상태로 정리할까요?`, 실행 정리형은 `오늘 실행할 가장 작은 행동을 어떻게 정리할까요?`처럼 쓴다.",
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
    id: "OH-S2-CAPTURE-SPELLING",
    severity: "S2",
    pattern: /\uCEA1\uCCD0/g,
    problem: "화면 문구에 맞춤법이 어색한 캡처 표기가 노출됨",
    guidance: "캡처로 쓰고, 답장 캡처처럼 앞말과 붙은 경우는 띄어 쓴다.",
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
    "For closing-state questions, keep the internal evidence-closing concept but write user-visible Korean as 마무리, 정리, or 상태 정하기. Never literally translate close/closing into 닫다 or expose 증거 마감 as screen copy.",
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
  if (!request || typeof request !== "object" || !Array.isArray(request.questions)) {
    return request;
  }
  const rewritten = {
    ...request,
    questions: request.questions.map(humanizeOfficeHoursQuestionCopy),
  };
  const unresolvedS1 = inspectOfficeHoursUiCopyRequest(rewritten)
    .filter((issue) => issue.severity === "S1");
  if (unresolvedS1.length > 0) {
    const detail = unresolvedS1
      .map((issue) => `${issue.ruleId} at questions.${issue.questionIndex}.${issue.path}: ${issue.value}`)
      .join("; ");
    const error = new Error(`Office Hours Korean UI copy humanization failed: S1 issues remain after rewrite. ${detail}`);
    error.code = "ERR_OFFICE_HOURS_UI_COPY_CONTRACT";
    error.issues = unresolvedS1;
    throw error;
  }
  return rewritten;
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

function humanizeOfficeHoursQuestionCopy(question = {}) {
  if (!question || typeof question !== "object") return question;
  const next = { ...question };
  rewriteVisibleStringField(next, "header");
  rewriteVisibleStringField(next, "question");
  rewriteVisibleStringField(next, "helperText");
  rewriteVisibleStringField(next, "helper_text");
  rewriteVisibleStringField(next, "freeTextPlaceholder");
  rewriteVisibleStringField(next, "free_text_placeholder");
  if (Array.isArray(question.options)) {
    next.options = question.options.map((option) => humanizeOfficeHoursOptionCopy(option));
  }
  return next;
}

function humanizeOfficeHoursOptionCopy(option = {}) {
  if (!option || typeof option !== "object") return option;
  const next = { ...option };
  rewriteVisibleStringField(next, "label");
  rewriteVisibleStringField(next, "description");
  return next;
}

function rewriteVisibleStringField(target, key) {
  if (!Object.prototype.hasOwnProperty.call(target, key) || typeof target[key] !== "string") return;
  target[key] = humanizeOfficeHoursVisibleText(target[key]);
}

export function humanizeOfficeHoursVisibleText(value = "") {
  const original = String(value ?? "");
  if (!original.trim()) return original;
  const { masked, restore } = maskDoNotRewriteSpans(original);
  let text = masked;

  text = rewriteOfficeHoursJargon(text);
  text = rewriteHumanizeKoreanS1Patterns(text);
  text = rewriteOfficeHoursS2Copy(text);
  text = rewriteOfficeHoursKoreanSpelling(text);
  text = text.replace(/\s{2,}/g, " ").trim();

  const restored = restore(text);
  const fixedS1 = hasS1OfficeHoursCopyIssue(original) && !hasS1OfficeHoursCopyIssue(restored);
  return changeRatio(original, restored) > 0.5 && !fixedS1 ? original : restored;
}

function rewriteOfficeHoursJargon(text) {
  let out = text;
  out = out.replace(/\bICP\b/g, "고객 후보");
  out = out.replace(/\bactivation action\b/gi, "핵심 행동");
  out = out.replace(/\bvanity traffic\b/gi, "조회, 좋아요, 팔로워");
  out = out.replace(/허영\s*지표/g, "조회, 좋아요, 팔로워");
  out = out.replace(/\bwedge\b/gi, "첫 진입점");
  out = out.replace(/\bproof target\b/gi, "검증 기준");
  out = out.replace(/집합명사/g, "넓은 표현");
  out = out.replace(/가입자\s*100명/g, "활성 사용자 100명");
  out = out.replace(/\bevidence-closing\b/gi, "증거 정리");
  out = out.replace(/\bclose\s+the\s+Day\b/gi, "오늘 상태 정리");
  out = out.replace(/\bcommitment\s+close\b/gi, "약속 상태 정리");
  out = out.replace(/Day\s*(?:를\s*)?닫(?:을까요|을까|기|게|다|는다|을|은|힌|히는)?/gi, "오늘 상태를 정리");
  out = out.replace(/증거\s*마감/g, "증거 정리");
  out = out.replace(/마감할까요/g, "정리할까요");
  out = out.replace(/마감할까/g, "정리할까");
  out = out.replace(/마감하기/g, "정리하기");
  out = out.replace(/마감한다/g, "정리한다");
  out = out.replace(/마감할지/g, "정리할지");
  out = out.replace(/마감상태|마감\s*상태/g, "정리 상태");
  out = out.replace(/마감조건|마감\s*조건/g, "정리 조건");
  out = out.replace(/닫을까요/g, "마무리할까요");
  out = out.replace(/닫을까/g, "마무리할까");
  out = out.replace(/닫기/g, "마무리하기");
  out = out.replace(/닫게/g, "마무리하게");
  out = out.replace(/닫는다/g, "마무리한다");
  out = out.replace(/닫다/g, "마무리하다");
  out = out.replace(/닫을/g, "마무리할");
  out = out.replace(/닫은/g, "마무리한");
  out = out.replace(/닫힌/g, "정리된");
  out = out.replace(/닫히는/g, "정리되는");
  return out;
}

function rewriteHumanizeKoreanS1Patterns(text) {
  let out = text;
  out = out.replace(/가지고 있습니다/g, "있습니다");
  out = out.replace(/가지고 있다/g, "있다");
  out = out.replace(/가지고 있는/g, "있는");
  out = out.replace(/되어진다/g, "된다");
  out = out.replace(/되어집니다/g, "됩니다");
  out = out.replace(/되어진/g, "된");
  out = out.replace(/결론적으로|그러므로|요약하면|본질적으로|핵심적으로/g, "");
  out = out.replace(/이를\s*통해/g, "이렇게");
  out = out.replace(/시사하는\s*바가\s*크다/g, "분명하게 드러난다");
  out = out.replace(/주목할\s*만하다/g, "눈여겨볼 만하다");
  out = out.replace(/([가-힣])고,\s+/g, "$1고 ");
  out = out.replace(/([가-힣])며,\s+/g, "$1며 ");
  out = out.replace(/([가-힣])지만,\s+/g, "$1지만 ");
  out = out.replace(/([가-힣])면서,\s+/g, "$1면서 ");
  out = out.replace(/([가-힣])아서,\s+/g, "$1아서 ");
  out = out.replace(/([가-힣])어서,\s+/g, "$1어서 ");
  out = out.replace(/인\s*것입니다/g, "입니다");
  out = out.replace(/인\s*것이다/g, "이다");
  out = out.replace(/한\s*것입니다/g, "했습니다");
  out = out.replace(/한\s*것이다/g, "했다");
  return out.replace(/\s{2,}/g, " ").trim();
}

function rewriteOfficeHoursS2Copy(text) {
  let out = text;
  out = out.replace(/랜딩\s*\/\s*가입\s*구간/g, "랜딩에서 가입까지의 흐름");
  out = out.replace(/게시물\s*(?:→|->)\s*가입(?:\s*전환)?/g, "게시물을 본 뒤 가입까지 이어진 흐름");
  out = out.replace(/(?:^|\s)리스크\s*[:：]\s*/g, (match) => (match.startsWith(" ") ? " 주의할 점은 " : "주의할 점은 "));
  out = out.replace(/가장\s*강함\.\s*다음\s*[:：]\s*/g, "가장 강한 신호입니다. 다음으로 ");
  out = out.replace(/0부터\s*시작/g, "처음부터 시작");
  out = out.replace(/\((넓은 표현)\s*말고\)/g, "$1은 빼고");
  return out;
}

function rewriteOfficeHoursKoreanSpelling(text) {
  let out = text;
  out = out.replace(/답장\s*\uCEA1\uCCD0/g, "답장 캡처");
  out = out.replace(/\b([A-Za-z][A-Za-z0-9]{1,20})[-\s]*\uCEA1\uCCD0/g, "$1 캡처");
  out = out.replace(/\uCEA1\uCCD0/g, "캡처");
  return out;
}

function maskDoNotRewriteSpans(text) {
  const spans = [];
  const token = (index) => `__A30_COPY_DONOT_${index}__`;
  const masked = String(text).replace(
    /https?:\/\/[^\s)）]+|`[^`]*`|"[^"]*"|'[^']*'|“[^”]*”|‘[^’]*’|(?=[\p{L}\p{N}_./:-]*\uCEA1\uCCD0)(?=[\p{L}\p{N}_./:-]*[A-Za-z_])(?=[\p{L}\p{N}_./:-]*[_./:-])[\p{L}\p{N}_./:-]+/gu,
    (match) => {
      if (!shouldMaskDoNotRewriteSpan(match)) return match;
      const index = spans.length;
      spans.push(match);
      return token(index);
    },
  );
  return {
    masked,
    restore(value) {
      return String(value).replace(/__A30_COPY_DONOT_(\d+)__/g, (_match, rawIndex) => {
        const index = Number(rawIndex);
        return spans[index] ?? "";
      });
    },
  };
}

function shouldMaskDoNotRewriteSpan(value) {
  const text = String(value || "");
  if (/^https?:\/\//.test(text)) return true;
  if (/^`[^`]*`$|^"[^"]*"$|^'[^']*'$|^“[^”]*”$|^‘[^’]*’$/.test(text)) return true;
  if (!/\uCEA1\uCCD0/.test(text)) return false;
  if (/[_.:/]/.test(text)) return true;
  const hyphenCount = (text.match(/-/g) || []).length;
  return hyphenCount >= 2 || (hyphenCount >= 1 && /\d/.test(text));
}

function changeRatio(before, after) {
  const source = String(before ?? "");
  const target = String(after ?? "");
  const maxLen = Math.max(source.length, target.length, 1);
  return levenshteinDistance(source, target) / maxLen;
}

function hasS1OfficeHoursCopyIssue(value) {
  const text = String(value || "");
  return OFFICE_HOURS_COPY_RULEBOOK.some((rule) => {
    if (rule.severity !== "S1") return false;
    rule.pattern.lastIndex = 0;
    return rule.pattern.test(text);
  });
}

function levenshteinDistance(a, b) {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_value, index) => index);
  const curr = Array.from({ length: b.length + 1 }, () => 0);
  for (let i = 1; i <= a.length; i += 1) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        curr[j - 1] + 1,
        prev[j] + 1,
        prev[j - 1] + cost,
      );
    }
    for (let j = 0; j <= b.length; j += 1) prev[j] = curr[j];
  }
  return prev[b.length];
}
