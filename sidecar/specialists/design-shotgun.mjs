export const ID = "design-shotgun";
export const NAME = "Design Shotgun";
export const PHASES = ["planning", "build"];
export const DECISIONS = ["design-direction", "landing", "aesthetic-pick"];
export const RUBRIC = ["adaptability"];
export const SUMMARY =
  "여러 디자인 방향을 한 번에 펼쳐서 비교 보드로 빠르게 좁히는 진단 모드입니다.";

export function buildPrompt({ doc = null, observations = "", lastAnswer = "" } = {}) {
  const docTitle = doc?.title || "현재 문서";
  const obs = observations ? observations.trim() : "";
  const ans = lastAnswer ? lastAnswer.trim() : "";

  return [
    "## Specialist 모드: Design Shotgun",
    `대상 문서/표면: ${docTitle}`,
    "",
    "역할: 디자인 의사결정을 미리 좁히지 말고, 서로 다른 미적 가설을 동시에 열어 비교한다.",
    "사용자가 원하는 톤을 단어로 말 못해도, 실제 후보를 보고 고를 수 있게 만든다.",
    "",
    "이번 한 질문은 아래 중 하나를 묻는다:",
    "1. 톤 축 — 어떤 한 쌍의 축에서 결정할까? (예: 미니멀↔고밀도, 진지↔장난, 시스템↔수공예, 차분↔강렬)",
    "2. 레퍼런스 — 좋아하는 제품/사이트 1~3개와 그 중 가장 닮고 싶은 한 가지 디테일.",
    "3. 가짜 동의 차단 — '깔끔하게'는 답이 아니다. 어떤 화면/요소가 그래야 하나?",
    "4. 후보 비교 — 만든 후보 A/B/C 중 무엇이 ICP의 첫 인상을 가장 잘 설명하나?",
    "",
    "AskUserQuestion 작성 규칙:",
    "- options에는 반드시 서로 다른 미적 방향이 들어간다. 같은 방향의 변형은 한 옵션으로 합친다.",
    "- description은 추상 단어(modern, minimal) 대신 구체 동작(\"Helvetica + 16px body, 그리드 12 col\", \"브루탈 컬러 블록 + 큰 sans\")로 적는다.",
    "- 추천안에는 (recommended)와 그 이유(관찰한 ICP/제품 사실 1줄)를 단다.",
    "- 답변은 곧 design-system.md / landing 섹션 / 시각 디렉션 결정으로 매핑된다.",
    "",
    obs ? `## 관찰한 프로젝트 사실\n${obs}` : "## 관찰한 프로젝트 사실\n(여백) — README, 기존 design system, 현재 UI screenshot, 카피 톤을 짧게 점검한다.",
    "",
    ans ? `## 직전 사용자 답변\n${ans}\n\n이 답변에서 동의 받은 축 위에서 다음 비교지점을 노출한다.` : "직전 답변이 아직 없다. 톤 축 또는 레퍼런스로 첫 비교를 연다.",
  ].join("\n");
}
