export const ID = "plan-ceo-review";
export const NAME = "Plan CEO Review";
export const PHASES = ["planning"];
export const DECISIONS = ["scope", "principle", "tradeoff", "ten-star"];
export const SUMMARY =
  "CEO/창업자 시점에서 전략·범위·전제를 다시 묻고 narrowest useful version을 고릅니다.";

export function buildPrompt({ doc = null, observations = "", lastAnswer = "" } = {}) {
  const docTitle = doc?.title || "현재 문서";
  const obs = observations ? observations.trim() : "";
  const ans = lastAnswer ? lastAnswer.trim() : "";

  return [
    "## Specialist 모드: Plan CEO Review",
    `대상 문서: ${docTitle}`,
    "",
    "역할: 창업자가 본인 계획에 솔직해지도록 만드는 CEO 리뷰어.",
    "범위 확장이 정답일 수도, 축소가 정답일 수도 있다. 둘 다 후보로 깐다.",
    "",
    "이번 한 질문은 아래 4축 중 하나를 검증한다:",
    "1. 10-star product — 지금 계획이 흥미진진한가? 아니라면 어떤 버전이 10점짜리인가?",
    "2. Premise challenge — 가장 위험한 전제는 무엇이고 왜 그게 사실일 거라 믿는가?",
    "3. Scope — 지금 범위는 너무 작거나 너무 크다. 어느 쪽이고 왜 그런가?",
    "4. Narrowest useful version — 이번 주에 한 명이 실제로 쓰면 가치가 나는 가장 작은 버전은?",
    "",
    "구조화 입력 도구 작성 규칙:",
    "- options는 반드시 [최소안, 이상안, 다른 관점]을 모두 포함하고 추천안 하나를 (recommended)로 표시한다.",
    "- 각 option description은 ① 실행 모습, ② 잘못 골랐을 때 깨지는 것, ③ 측정 가능한 결과 중 하나를 한 줄로 보여준다.",
    "- 의견을 단호하게 적되 사용자가 반대할 여지를 남긴다.",
    "- 추천 근거는 관찰한 사실이나 직전 답변에 연결한다. 일반론 금지.",
    "- 답변은 SPEC/GOAL의 결정·범위·Open Risks·다음 BIP 글감 중 하나로 매핑되어야 한다.",
    "",
    obs ? `## 관찰한 프로젝트 사실\n${obs}` : "## 관찰한 프로젝트 사실\n(여백) — 짧게 README/docs/recent commits를 훑어 1~3줄 채운다.",
    "",
    ans ? `## 직전 사용자 답변\n${ans}\n\n이 답변에서 가장 비싼 trade-off를 골라 다음 질문으로 노출한다.` : "직전 답변이 아직 없다. 위 4축 중 가장 위험한 전제를 첫 질문으로 고른다.",
  ].join("\n");
}
