export const ID = "devex-review";
export const NAME = "DevEx Review (live audit)";
export const PHASES = ["build"];
export const DECISIONS = ["devex-audit", "docs-quality", "first-run"];
export const RUBRIC = ["adaptability", "clout"];
export const SUMMARY =
  "실제로 시도해 본 결과를 기반으로 개발자 경험을 점수 매기고 마찰을 잡습니다.";

export function buildPrompt({ doc = null, observations = "", lastAnswer = "" } = {}) {
  const docTitle = doc?.title || "현재 문서";
  const obs = observations ? observations.trim() : "";
  const ans = lastAnswer ? lastAnswer.trim() : "";

  return [
    "## Specialist 모드: DevEx Review (live audit)",
    `대상 문서/표면: ${docTitle}`,
    "",
    "역할: 추측 대신 실제로 따라 해보고 막힌 지점을 보고하는 모드.",
    "사용자/팀이 직접 한 번 첫 사용을 따라 해본 결과를 기반으로 점수와 다음 액션을 묻는다.",
    "",
    "이번 한 질문은 아래 중 하나를 묻는다:",
    "1. 첫 5분 — 처음 5분 안에 어디서 막혔는가? 명령/링크/문장 단위로 한 곳을 지목하라.",
    "2. 에러 reproducibility — 같은 에러를 다른 환경에서 재현할 수 있나? 못 한다면 무엇이 빠졌나?",
    "3. 문서/코드 불일치 — 문서가 약속한 것과 실제 동작 사이에 가장 큰 갭은 어디인가?",
    "4. 첫 magic moment — 사용자가 \"오\" 한 순간이 있다면 무엇이고, 없다면 어디에 넣을 수 있나?",
    "5. 점수 — 1~10으로 첫 사용 점수를 매기고, 1점 더 올리려면 정확히 무엇을 고치는가?",
    "",
    "AskUserQuestion 작성 규칙:",
    "- options는 측정 가능한 마찰 지점이나 점수 변화로 표현한다.",
    "- description은 실제 관찰(에러 텍스트, 단계 번호, 페이지 위치) 1줄을 포함한다.",
    "- 답변은 곧 GitHub issue 후보, README 패치, ADR 결정 중 하나로 매핑된다.",
    "- 추천안은 가장 작은 1점 상승을 만드는 쪽으로 (recommended).",
    "",
    obs ? `## 관찰한 프로젝트 사실\n${obs}` : "## 관찰한 프로젝트 사실\n(여백) — 가능하면 실제 명령을 따라 해보고 출력을 1~3줄로 적는다.",
    "",
    ans ? `## 직전 사용자 답변\n${ans}\n\n이 답변에서 가장 큰 마찰을 골라 다음 질문으로 좁힌다.` : "직전 답변이 아직 없다. 첫 5분 마찰 또는 점수를 첫 질문으로 고른다.",
  ].join("\n");
}
