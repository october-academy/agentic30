import { getSpecialist, listSpecialists } from "./specialists/index.mjs";

export const PLANNING_DOC_TYPES = Object.freeze(["icp", "goal", "values", "spec"]);
export const PHASES = Object.freeze({ PLANNING: "planning", BUILD: "build" });

const DOC_TYPE_DEFAULT_SPECIALIST = Object.freeze({
  icp: "office-hours",
  goal: "plan-ceo-review",
  spec: "plan-ceo-review",
  values: "plan-ceo-review",
  designSystem: "design-consultation",
  adr: "plan-ceo-review",
  docs: "plan-devex-review",
  sheet: "office-hours",
});

const DESIGN_KEYWORD_RE = /(디자인|design|시각|레이아웃|landing|랜딩|레퍼런스|aesthetic|톤|미적)/i;
const DESIGN_HTML_KEYWORD_RE = /(html|css|토큰|spacing|컴포넌트.*구현|production.*디자인|코드로 굳)/i;
const DESIGN_REVIEW_KEYWORD_RE = /(스크린샷|화면 캡처|위계|hierarchy|시각 qa|ai slop|폴리시|polish)/i;
const DESIGN_PLAN_KEYWORD_RE = /(디자인 점수|차원|디자인 plan|design plan|점수 1점|평가표)/i;
const DEVEX_KEYWORD_RE = /(개발자 경험|developer|onboarding|cli|tthw|time to hello|에러 메시지|setup|install)/i;
const DEVEX_AUDIT_KEYWORD_RE = /(직접 따라|첫 5분|재현|first run|live audit|점수.*매겼)/i;
const DESIGN_SYSTEM_KEYWORD_RE = /(디자인 시스템|design system|토큰 시스템|컴포넌트 규칙|광고 에셋)/i;
const SHOTGUN_KEYWORD_RE = /(여러 시안|several variants|shotgun|후보 비교|design 후보)/i;

export function detectPhase({ bipSetupGate, signals = {} } = {}) {
  const docs = bipSetupGate?.localDocs ?? [];
  const planningPending = docs.filter(
    (doc) => PLANNING_DOC_TYPES.includes(doc?.type) && !doc?.found,
  );
  if (planningPending.length > 0) return PHASES.PLANNING;
  if (signals?.hasRecentSourceChanges) return PHASES.BUILD;
  return PHASES.BUILD;
}

export function classifyDecisionKind({
  doc = null,
  lastAnswer = "",
  promptText = "",
} = {}) {
  const text = `${lastAnswer || ""}\n${promptText || ""}`;
  if (SHOTGUN_KEYWORD_RE.test(text)) return "design-direction";
  if (DESIGN_HTML_KEYWORD_RE.test(text)) return "html-finalize";
  if (DESIGN_REVIEW_KEYWORD_RE.test(text)) return "visual-qa";
  if (DESIGN_PLAN_KEYWORD_RE.test(text)) return "design-plan";
  if (DESIGN_SYSTEM_KEYWORD_RE.test(text)) return "design-system";
  if (DEVEX_AUDIT_KEYWORD_RE.test(text)) return "devex-audit";
  if (DEVEX_KEYWORD_RE.test(text)) return "devex-plan";
  if (DESIGN_KEYWORD_RE.test(text)) {
    return "design-direction";
  }

  if (doc?.type === "icp" || doc?.type === "sheet") return "customer";
  if (doc?.type === "spec" || doc?.type === "goal") return "scope";
  if (doc?.type === "values") return "principle";
  if (doc?.type === "designSystem") return "design-system";
  if (doc?.type === "adr") return "scope";
  if (doc?.type === "docs") return "devex-plan";
  return "scope";
}

export function selectSpecialistId({
  phase,
  decisionKind,
  doc = null,
} = {}) {
  if (phase === PHASES.PLANNING) {
    if (["customer", "demand", "wedge", "evidence"].includes(decisionKind)) return "office-hours";
    if (decisionKind === "design-direction") return "design-shotgun";
    if (decisionKind === "design-system") return "design-consultation";
    if (["scope", "principle", "tradeoff", "ten-star"].includes(decisionKind)) return "plan-ceo-review";
    if (decisionKind === "devex-plan") return "plan-devex-review";
    if (doc?.type && DOC_TYPE_DEFAULT_SPECIALIST[doc.type]) {
      return DOC_TYPE_DEFAULT_SPECIALIST[doc.type];
    }
    return "office-hours";
  }

  if (decisionKind === "html-finalize") return "design-html";
  if (decisionKind === "visual-qa") return "design-review";
  if (decisionKind === "design-plan") return "plan-design-review";
  if (decisionKind === "design-direction") return "design-shotgun";
  if (decisionKind === "design-system") return "design-consultation";
  if (decisionKind === "devex-audit") return "devex-review";
  if (decisionKind === "devex-plan") return "plan-devex-review";
  if (decisionKind === "customer") return "office-hours";
  if (decisionKind === "principle" || decisionKind === "scope") return "plan-ceo-review";
  if (doc?.type === "designSystem") return "plan-design-review";
  if (doc?.type === "docs") return "devex-review";
  if (doc?.type && DOC_TYPE_DEFAULT_SPECIALIST[doc.type]) {
    return DOC_TYPE_DEFAULT_SPECIALIST[doc.type];
  }
  return "design-review";
}

export function selectSpecialist({
  bipSetupGate = null,
  doc = null,
  lastAnswer = "",
  promptText = "",
  signals = {},
  observations = "",
} = {}) {
  const phase = detectPhase({ bipSetupGate, signals });
  const decisionKind = classifyDecisionKind({ doc, lastAnswer, promptText });
  const id = selectSpecialistId({ phase, decisionKind, doc });
  const entry = getSpecialist(id) || getSpecialist("office-hours");
  const promptBody = entry.build({ doc, observations, lastAnswer });
  const reason = buildSelectionReason({ phase, decisionKind, doc, entry });
  return {
    id: entry.id,
    name: entry.name,
    phase,
    decisionKind,
    reason,
    promptText: promptBody,
    summary: entry.summary,
  };
}

export function buildSpecialistInjection(selection) {
  if (!selection) return "";
  const header = [
    "",
    `## Auto-routed specialist: ${selection.name} (${selection.id})`,
    `Phase: ${selection.phase} · Decision: ${selection.decisionKind}`,
    `Why this specialist: ${selection.reason}`,
    "",
    "사용자에게 specialist 이름을 알리지 마세요. 그 specialist의 사고 방식 그대로 다음 한 질문만 만드세요.",
    "",
  ].join("\n");
  return `${header}${selection.promptText || ""}`;
}

function buildSelectionReason({ phase, decisionKind, doc, entry }) {
  const parts = [];
  if (phase === PHASES.PLANNING) {
    parts.push("BIP 핵심 4문서(ICP/GOAL/VALUES/SPEC) 중 비어 있는 칸이 있어 planning phase로 판정");
  } else {
    parts.push("BIP 핵심 4문서 모두 채워져 build phase로 판정");
  }
  if (decisionKind) parts.push(`다음 결정 종류=${decisionKind}`);
  if (doc?.type) parts.push(`현재 IDD 대상 문서=${doc.type}`);
  if (entry?.id) parts.push(`따라서 ${entry.id} 선택`);
  return parts.join(" · ");
}

export function describeAvailableSpecialists() {
  return listSpecialists().map(({ id, name, phases, summary }) => ({
    id,
    name,
    phases,
    summary,
  }));
}
