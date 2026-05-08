import { z } from "zod";

export const RUBRIC_AXES = Object.freeze([
  "definition",
  "command",
  "clout",
  "responsibility",
  "adaptability",
]);

const AXIS_LABELS_KO = Object.freeze({
  definition: "문제 정의력",
  command: "주도력",
  clout: "영향력",
  responsibility: "책임감",
  adaptability: "적응력",
});

export const RubricFieldSchema = z
  .array(z.enum(RUBRIC_AXES))
  .min(1, "RUBRIC must declare at least one axis")
  .max(3, "RUBRIC supports at most 3 axes")
  .refine(
    (axes) => new Set(axes).size === axes.length,
    "RUBRIC axes must be distinct",
  );

export function assertValidSpecialistModule(mod) {
  const id = mod?.ID || "<unknown>";
  if (!Array.isArray(mod?.RUBRIC)) {
    throw new Error(
      `Specialist ${id} is missing RUBRIC export (expected array of axis ids from ${RUBRIC_AXES.join("/")})`,
    );
  }
  const result = RubricFieldSchema.safeParse(mod.RUBRIC);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join(".") || "rubric"}: ${issue.message}`)
      .join("; ");
    throw new Error(`Specialist ${id} RUBRIC is invalid: ${issues}`);
  }
}

export function formatRubricInstruction(rubric) {
  if (!Array.isArray(rubric) || rubric.length === 0) return "";
  const focus = rubric
    .map((axis) => `${axis} (${AXIS_LABELS_KO[axis] || axis})`)
    .join(", ");
  const metadataKey = `rubric_focus: [${rubric.map((a) => `"${a}"`).join(", ")}]`;
  return [
    "",
    "",
    "## Alignment rubric",
    `이 응답은 5축 사령관 루브릭 중 ${focus} 축을 단련시키는 데 초점이 있다.`,
    `최소 한 가지 inline_decision option은 위 축의 행동을 직접 강화하도록 만들고, 응답 마지막에 ${metadataKey} 한 줄을 metadata로 남긴다.`,
  ].join("\n");
}

export function formatQuestionQualityContract({ specialistId = "" } = {}) {
  const normalizedId = String(specialistId || "").trim();
  const specialistRule = normalizedId === "office-hours"
    ? "- office-hours 질문은 수요 증거, 현재 대안, 실제 사람, 가장 작은 wedge 중 오늘 가장 빈 칸 하나를 찌른다."
    : normalizedId === "plan-ceo-review"
      ? "- plan-ceo-review 질문은 가장 위험한 전제, 범위 선택, 10점 경험, 이번 주 유용한 최소 버전 중 하나를 decision brief로 만든다."
      : "- 라우팅된 specialist의 판단 축 하나만 골라 질문한다. 여러 specialist 사고방식을 한 질문에 섞지 않는다.";
  return [
    "",
    "",
    "## Agentic30 question quality contract",
    "- One question = one decision. 여러 결정을 한 카드에 묶지 않는다.",
    "- 후보군은 prose가 아니라 AskUserQuestion / request_user_input 계열 구조화 입력으로 제시한다. 각 tool call은 한 질문과 2-4개 후보 options를 가져야 한다.",
    "- 질문은 README, docs, 최근 답변, 실행 기록, 고객 발화 중 하나 이상의 관찰 근거에 연결한다.",
    "- 첫 ICP 질문은 제품 이름, 대상 유저, 해결 문제, 제품 목적을 진단한 뒤 더 구체적인 고객 세그먼트를 좁히는 질문이어야 한다.",
    "- 범주형 답변을 허용하지 않는다. \"개발자\", \"유저\", \"창업자\"가 나오면 실제 이름, 역할, 상황, 이미 쓰는 대안으로 좁힌다.",
    "- 좋은 느낌, 관심, waitlist는 수요로 취급하지 않는다. 돈, 시간, 우회 수단, 다음 일정 약속, 사용 관찰을 요구한다.",
    "- 후보 options는 2-4개로 제한하고, 각 description은 실행 모습이나 잘못 고르면 깨지는 것을 한 줄로 보여준다.",
    "- 추천안이 있으면 이유를 관찰 근거에 붙인다. 근거 없이 중립적으로 늘어놓지 않는다.",
    "- 답변은 대상 문서 섹션, Open Risk, 다음 BIP proof, 오늘 실행 중 하나로 이어져야 한다.",
    specialistRule,
  ].join("\n");
}
