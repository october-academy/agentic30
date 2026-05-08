import { RUBRIC_AXES } from "./specialists/schema.mjs";

export const RUBRIC_ANCHOR_LEVELS = Object.freeze([1, 3, 5]);

export const RUBRIC_ANCHORS = Object.freeze({
  definition: Object.freeze({
    1: "문제를 한 줄로 적지 못한다. 만들고 싶은 것이 곧 시장 문제라고 가정한다.",
    3: "잠재 고객 1-2명에게서 들은 한 가지 고통 표현을 가지고 있다. 그들이 이미 시도한 우회책은 아직 모른다.",
    5: "5명 이상 인터뷰에서 반복되는 고통을 한 문장으로 정의했다. 우회책과 그것이 부족한 이유까지 알고 있다.",
  }),
  command: Object.freeze({
    1: "다음 행동을 누가 결정해야 할지 모른다. 외부 의견 없이는 결정하지 못한다.",
    3: "매일 다음 행동 1-2개를 스스로 정한다. 기록은 비정기적이다.",
    5: "매주 단호한 Go/Kill/Pivot 결정을 글로 남긴다. 외부 의견은 참고지 결정권자가 아니다.",
  }),
  clout: Object.freeze({
    1: "도달한 사람 0명. 공개 게시물도 없다.",
    3: "BIP 게시 10편 이상 + 누적 reach 측정 가능 + 첫 자발적 응답이 있다.",
    5: "결제 활성 1명 이상 또는 검증 가능한 시장 신호(가입 100+, 자발 인용, 업계 채널 언급) 보유.",
  }),
  responsibility: Object.freeze({
    1: "약속 이행 기록 없음. \"다음 주에 할게요\"가 누적되어 있다.",
    3: "주간 약속 1-2개를 기록하고 평가한다. 미이행도 솔직히 적는다.",
    5: "약속 ↔ 실행 ↔ 결과 cycle을 BIP에 공개한다. 환불·고객 응대를 본인이 직접 한다.",
  }),
  adaptability: Object.freeze({
    1: "처음 가설을 30일째까지 그대로 유지한다. 데이터를 봐도 \"더 노력하자\"라고 결론짓는다.",
    3: "데이터에 따라 한 번 이상 가설/타겟/wedge를 수정했다.",
    5: "정량 신호 기반으로 7일마다 가설을 점검하고 약하면 신속하게 변형/Kill로 이동한다.",
  }),
});

export function getAnchorText(axis, level) {
  const axisAnchors = RUBRIC_ANCHORS[axis];
  if (!axisAnchors) return null;
  return axisAnchors[level] ?? null;
}

export function nearestAnchorLevel(score) {
  if (typeof score !== "number" || Number.isNaN(score)) return null;
  if (score <= 2) return 1;
  if (score <= 4) return 3;
  return 5;
}

// Sanity check at import: every axis declared in RUBRIC_AXES must have full anchors.
// Throwing here is intentional — a missing anchor is a data integrity bug, not a runtime concern.
for (const axis of RUBRIC_AXES) {
  const anchors = RUBRIC_ANCHORS[axis];
  if (!anchors) {
    throw new Error(`rubric-anchors: missing axis "${axis}"`);
  }
  for (const level of RUBRIC_ANCHOR_LEVELS) {
    const text = anchors[level];
    if (typeof text !== "string" || text.length === 0) {
      throw new Error(
        `rubric-anchors: missing or empty anchor for axis "${axis}" level ${level}`,
      );
    }
  }
}
