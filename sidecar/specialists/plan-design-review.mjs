export const ID = "plan-design-review";
export const NAME = "Plan Design Review";
export const PHASES = ["build"];
export const DECISIONS = ["design-plan", "design-dimension-score", "design-system-gap"];
export const SUMMARY =
  "디자인 차원을 0~10으로 매기고 한 단계 올리는 가장 작은 수정을 묻습니다.";

export function buildPrompt({ doc = null, observations = "", lastAnswer = "" } = {}) {
  const docTitle = doc?.title || "현재 문서";
  const obs = observations ? observations.trim() : "";
  const ans = lastAnswer ? lastAnswer.trim() : "";

  return [
    "## Specialist 모드: Plan Design Review",
    `대상 문서/표면: ${docTitle}`,
    "",
    "역할: 디자이너 시점의 plan 리뷰. 디자인 차원을 0~10으로 매기고 한 단계 올릴 가장 작은 변경을 묻는다.",
    "추상 칭찬 금지. 차원당 점수와 그 점수를 1만큼 올릴 구체 액션을 강제한다.",
    "",
    "디자인 차원 (각 0~10 평가):",
    "- 위계 (Hierarchy)",
    "- 일관성 (Consistency)",
    "- 정체성/톤 (Identity & Tone)",
    "- 정보 밀도 (Density)",
    "- 인터랙션 신뢰 (Interaction trust)",
    "- 접근성 (Accessibility)",
    "- 카피 디자인 일치 (Copy ↔ Design)",
    "",
    "이번 한 질문은 아래 중 하나를 묻는다:",
    "1. 가장 약한 차원 — 7개 차원 중 지금 가장 점수가 낮은 한 가지는?",
    "2. +1 액션 — 그 차원을 1점 올리는 가장 작은 변경은? 한 컴포넌트, 한 토큰, 한 카피.",
    "3. 트레이드오프 — 그 변경이 다른 차원을 깨뜨리지 않는다는 보장은?",
    "4. 게이트 — 어떤 측정으로 \"+1 했다\"를 확인할 것인가? (스크린 비교, 점수 재평가, 사용자 반응)",
    "",
    "AskUserQuestion 작성 규칙:",
    "- options에는 변경 위치, 점수 차이, 측정 방식을 구체적으로 적는다.",
    "- 추천안은 가장 작은 변경으로 가장 큰 점수 차이를 만드는 쪽 (recommended).",
    "- description은 \"X에서 Y로 → 이유 Z\" 패턴.",
    "- 답변은 곧 design-system.md 결정 또는 다음 PR scope로 매핑된다.",
    "",
    obs ? `## 관찰한 프로젝트 사실\n${obs}` : "## 관찰한 프로젝트 사실\n(여백) — 현재 화면/디자인 토큰/이전 design ADR을 1~3줄로 점검한다.",
    "",
    ans ? `## 직전 사용자 답변\n${ans}\n\n이 답변에서 점수가 합의된 차원을 그대로 두고, 다음으로 약한 차원을 노출한다.` : "직전 답변이 아직 없다. 가장 약한 차원을 첫 질문으로 고른다.",
  ].join("\n");
}
