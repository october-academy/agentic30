export const ID = "design-review";
export const NAME = "Design Review (visual QA)";
export const PHASES = ["build"];
export const DECISIONS = ["visual-qa", "ui-polish", "ai-slop"];
export const SUMMARY =
  "관찰 기반(I notice / I wonder / What if / I think because)으로 시각·정보 위계를 점검합니다.";

export function buildPrompt({ doc = null, observations = "", lastAnswer = "" } = {}) {
  const docTitle = doc?.title || "현재 문서";
  const obs = observations ? observations.trim() : "";
  const ans = lastAnswer ? lastAnswer.trim() : "";

  return [
    "## Specialist 모드: Design Review (visual QA)",
    `대상 문서/표면: ${docTitle}`,
    "",
    "역할: 추측 대신 관찰에서 시작해 시각·정보 위계·AI slop 패턴을 잡아낸다.",
    "보이는 그대로를 적고 (I notice), 의문을 적고 (I wonder), 가설을 적고 (What if),",
    "근거 있는 의견 (I think ... because) 으로 한 가지 결정만 밀어붙인다.",
    "",
    "이번 한 질문은 아래 중 하나를 묻는다:",
    "1. 위계 — 첫 화면/스크린에서 가장 먼저 읽혀야 하는 한 요소는? 지금 그게 가장 크게 보이나?",
    "2. 시각적 일관성 — 컴포넌트/스페이싱/색이 같은 의미인데 다르게 그려진 곳이 있나?",
    "3. AI slop — 모든 카드가 동격, 무의미한 그라데이션/이모지/필러 카피, 의미 없는 동치 4단/3단 등은 없나?",
    "4. 인터랙션 신뢰 — hover/active/disabled/loading 상태 중 빠지거나 어색한 한 곳은?",
    "5. 카피와 디자인의 일치 — 가장 강조된 자리에 가장 강한 메시지가 있나?",
    "",
    "AskUserQuestion 작성 규칙:",
    "- options는 \"I notice X, so I think Y because Z\" 패턴으로 적는다.",
    "- description은 화면 좌표/컴포넌트 이름/측정값을 1줄로 넣는다.",
    "- 추천안은 위계나 카피 일치를 깨뜨리지 않는 쪽 (recommended).",
    "- 답변은 곧 컴포넌트 변경, design-system.md 노트, 또는 시각 결정 ADR로 매핑된다.",
    "",
    obs ? `## 관찰한 프로젝트 사실\n${obs}` : "## 관찰한 프로젝트 사실\n(여백) — 가능하면 실제 화면/스크린샷/HTML 파일을 1곳 이상 본다.",
    "",
    ans ? `## 직전 사용자 답변\n${ans}\n\n이 답변에서 가장 약한 위계 또는 일관성 깨짐을 골라 다음 질문으로 좁힌다.` : "직전 답변이 아직 없다. 위계 또는 AI slop을 첫 질문으로 고른다.",
  ].join("\n");
}
