export const ID = "design-consultation";
export const NAME = "Design Consultation";
export const PHASES = ["planning", "build"];
export const DECISIONS = ["design-system", "aesthetic", "component-rules"];
export const RUBRIC = ["adaptability"];
export const SUMMARY =
  "제품 정체성·디자인 시스템·컴포넌트 규칙을 종단으로 묶어 잠그는 모드입니다.";

export function buildPrompt({ doc = null, observations = "", lastAnswer = "" } = {}) {
  const docTitle = doc?.title || "현재 문서";
  const obs = observations ? observations.trim() : "";
  const ans = lastAnswer ? lastAnswer.trim() : "";

  return [
    "## Specialist 모드: Design Consultation",
    `대상 문서/표면: ${docTitle}`,
    "",
    "역할: 제품의 미적 정체성, 디자인 시스템, 컴포넌트 규칙, 광고 에셋 규칙까지 일관된 한 시스템으로 묶는다.",
    "각 결정은 ICP의 첫 인상과 본 제품 가치 사이의 거리를 줄여야 한다.",
    "",
    "이번 한 질문은 아래 중 하나를 묻는다:",
    "1. 정체성 — 이 제품을 한 단어/한 그림으로 표현하면? 그게 ICP에게 즉시 통하나?",
    "2. 토큰 시스템 — 색/타이포/스페이싱/모서리/그림자 토큰의 source of truth가 하나로 모여 있나?",
    "3. 컴포넌트 규칙 — Button/Card/Input 같은 핵심 컴포넌트의 변형 규칙(variant, size, state)이 정의돼 있나?",
    "4. 광고/외부 에셋 — 랜딩, 광고 이미지, 소셜 카드도 같은 토큰을 따르나, 아니면 따로 노나?",
    "5. 거버넌스 — 새 컴포넌트가 추가될 때 어디서 결정되고 어디서 기록되는가?",
    "",
    "AskUserQuestion 작성 규칙:",
    "- options는 \"있다 / 없다 / 일부 있다\" 같은 추상 답 금지. 어디에·어떻게 정의돼 있는지를 구체로 묻는다.",
    "- description은 결정이 매핑될 파일/섹션을 1줄로 적는다(예: docs/DESIGN_SYSTEM.md > Tokens).",
    "- 추천안은 기존 시스템을 깨뜨리지 않으면서 가장 큰 갭을 메우는 쪽 (recommended).",
    "- 답변은 곧 docs/DESIGN_SYSTEM.md 또는 design ADR의 섹션으로 매핑된다.",
    "",
    obs ? `## 관찰한 프로젝트 사실\n${obs}` : "## 관찰한 프로젝트 사실\n(여백) — 현재 design tokens 위치, 컴포넌트 라이브러리, 광고/소셜 에셋 패턴을 짧게 점검한다.",
    "",
    ans ? `## 직전 사용자 답변\n${ans}\n\n이 답변에서 합의된 정체성을 그대로 두고 가장 큰 시스템 갭을 다음 질문으로 노출한다.` : "직전 답변이 아직 없다. 정체성 또는 토큰 시스템을 첫 질문으로 고른다.",
  ].join("\n");
}
