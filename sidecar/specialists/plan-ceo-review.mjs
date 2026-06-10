export const ID = "plan-ceo-review";
export const NAME = "Plan CEO Review";
export const PHASES = ["planning"];
export const DECISIONS = ["scope", "principle", "tradeoff", "ten-star"];
export const RUBRIC = ["definition", "responsibility"];
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

// Day 30 결산 prompt. Command 5점 anchor("매주 단호한 Go/Kill/Pivot
// 결정")와 specialist 코드가 어긋나 있던 문제를 닫는다. 톤은 코칭 — 한국어
// 사용자에게 "Go/Kill/Pivot"이 공격적이라는 Gemini 권고를 받아
// "지속/전환/중단"으로 옮긴다. Decision 직후의 "공백" UX 위험을 차단하기 위해
// 각 옵션이 다음 한 줄 행동(nextAction hint)도 함께 요청하게 한다.
//
// Pure helper — caller(MCP host)가 inline_decision 형태로 사용자에게 surface.
export function buildDay30NoGoPrompt({ rubricStatus = null } = {}) {
  if (!rubricStatus || !rubricStatus.dayThirty) {
    return null;
  }
  const dayThirty = rubricStatus.dayThirty;
  const delta = Array.isArray(rubricStatus.delta) ? rubricStatus.delta : [];
  const deltaSummary = delta.length
    ? delta
        .map((entry) => {
          const arrow = entry.delta == null ? "·" : entry.delta > 0 ? "↑" : entry.delta < 0 ? "↓" : "—";
          const value = entry.delta == null ? "n/a" : `${entry.delta >= 0 ? "+" : ""}${entry.delta}`;
          return `- ${entry.axis}: ${arrow} ${value}`;
        })
        .join("\n")
    : "- (Day 0 baseline 부재 — within-person delta는 다음 cycle부터)";
  const honestyMemo = collectNoEvidenceReasons(dayThirty);

  const body = [
    "## Day 30 결산 — 한 결정",
    "",
    "지금까지의 5축 변화와 정직 모드 메모를 본 뒤, **지금 이 시점에 어디로 갈지** 한 줄로 정한다. 이건 코칭 질문이고, 답에 따라 다음 7일이 다르게 짜인다.",
    "",
    "### 5축 변화 (Day 0 → Day 30)",
    deltaSummary,
    honestyMemo ? `\n### 정직 모드 메모\n${honestyMemo}` : "",
    "",
    "### 옵션",
    "- **지속(Continue)** — 가설은 살아 있다. 다음 7일 wedge를 한 줄로 적어라.",
    "- **전환(Pivot)** — 어느 한 가설을 폐기하고 어느 새 가설을 검증할지 한 줄.",
    "- **중단(Stop)** — 무엇을 학습으로 남기고 무엇을 다시 안 할지 한 줄.",
    "",
    "**규칙**: 셋 중 하나만 고른다. 함께 적은 한 줄(nextAction)이 다음 cycle의 시작점이 된다.",
  ]
    .filter(Boolean)
    .join("\n");

  return {
    promptKey: "day30_no_go_decision",
    title: "Day 30 결산",
    body,
    options: [
      {
        key: "continue",
        label: "지속(Continue)",
        description: "다음 7일 wedge를 한 줄로 적기",
        nextActionPlaceholder: "다음 7일에 검증할 한 가지 wedge를 한 줄로",
      },
      {
        key: "pivot",
        label: "전환(Pivot)",
        description: "어느 가설을 폐기하고 어느 새 가설로 갈지 한 줄",
        nextActionPlaceholder: "폐기 → 새 가설 한 줄 (예: A 대신 B)",
      },
      {
        key: "stop",
        label: "중단(Stop)",
        description: "학습으로 남길 것과 다시 안 할 것 한 줄",
        nextActionPlaceholder: "남길 학습 / 다시 안 할 행동",
      },
    ],
  };
}

function collectNoEvidenceReasons(dayThirty) {
  if (!dayThirty?.axes) return "";
  const lines = [];
  for (const [axis, entry] of Object.entries(dayThirty.axes)) {
    if (entry?.no_evidence_reason) {
      lines.push(`- ${axis}: ${entry.no_evidence_reason}`);
    }
  }
  return lines.join("\n");
}
