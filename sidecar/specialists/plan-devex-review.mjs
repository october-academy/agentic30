import { projectDocPath } from "../project-doc-paths.mjs";

export const ID = "plan-devex-review";
export const NAME = "Plan DevEx Review";
export const PHASES = ["build"];
export const DECISIONS = ["devex-plan", "onboarding-flow", "developer-friction"];
export const RUBRIC = ["adaptability", "clout"];
export const SUMMARY =
  "개발자 경험을 측정 가능한 기준(TTHW, 단계 수, 에러 메시지 품질)으로 미리 점검합니다.";

export function buildPrompt({ doc = null, observations = "", lastAnswer = "" } = {}) {
  const docTitle = doc?.title || "현재 문서";
  const obs = observations ? observations.trim() : "";
  const ans = lastAnswer ? lastAnswer.trim() : "";

  return [
    "## Specialist 모드: Plan DevEx Review",
    `대상 문서/표면: ${docTitle}`,
    "",
    "역할: 개발자 경험(DX)을 추측 대신 측정 가능한 기준으로 미리 점검한다.",
    "구현 직전, 페르소나별 magic moment와 마찰을 끄집어낸다.",
    "",
    "이번 한 질문은 아래 5축 중 하나를 검증한다:",
    "1. TTHW — Time to Hello World. 첫 성공까지 몇 분/단계인가? 측정 가능한 단위로 적었나?",
    "2. 단계 수 — 처음 시작에서 첫 결과까지 명령/클릭이 몇 번인가? 어디가 줄여질 수 있나?",
    "3. 에러 메시지 — 실패 시 메시지가 ① 무엇이 문제이고 ② 왜 그런지 ③ 어떻게 고치는지 셋 다 알려주나?",
    "4. 다음 행동의 명확성 — 성공 직후 사용자가 다음에 할 일이 한 가지로 보이나?",
    "5. 페르소나 적합 — 초보/중급/고급 중 어떤 페르소나가 가장 매끄럽고, 누가 막히나?",
    "",
    "AskUserQuestion 작성 규칙:",
    "- options에는 측정값(분, 단계 수, 에러 케이스)을 명시한다. 일반론 금지.",
    "- 각 description은 어떤 페르소나/시나리오에서 어떤 마찰이 사라지거나 남는지 한 줄로 적는다.",
    "- 추천안은 magic moment를 가장 가깝게 만드는 쪽으로 (recommended).",
    `- 답변은 ADR/SPEC의 결정 또는 ${projectDocPath("docs")} 섹션으로 매핑된다.`,
    "",
    obs ? `## 관찰한 프로젝트 사실\n${obs}` : "## 관찰한 프로젝트 사실\n(여백) — README의 시작 안내, CLI/에러 패턴, 첫 화면, 최근 onboarding 변경을 짧게 본다.",
    "",
    ans ? `## 직전 사용자 답변\n${ans}\n\n이 답변에서 가장 큰 미측정 가정을 골라 다음 질문으로 좁힌다.` : "직전 답변이 아직 없다. TTHW 또는 다음 행동의 명확성을 첫 질문으로 고른다.",
  ].join("\n");
}
