// Weekly ritual triggers for the alignment runtime.
//
// The 5축 RUBRIC.md anchors describe Day 0 / Day 30 endpoints; the in-between
// rhythm is unforced unless the user crosses Day 7, 14, or 21 boundaries.
// 21 is the last ritual: Day 30 is the closing assessment, not another
// midpoint check (Gemini UX: "30일 결판"의 긴장감 보존).
//
// This module is pure. The caller (bip-coach-state) folds the boundary into
// state, persists, and only THEN emits a user-facing prompt — never the
// other way around (Codex MEDIUM: race 차단).

export const RITUAL_DAYS = Object.freeze([7, 14, 21]);

export function detectRitualBoundary({ curriculumDay, lastRitualDayObserved = 0 } = {}) {
  if (typeof curriculumDay !== "number" || !Number.isFinite(curriculumDay)) {
    return null;
  }
  for (const day of RITUAL_DAYS) {
    if (curriculumDay >= day && lastRitualDayObserved < day) {
      return { day, ritualKey: `weekly_ritual_day_${day}` };
    }
  }
  return null;
}

const RITUAL_FOCUS = Object.freeze({
  // Each ritual reuses the closest two RUBRIC.md axes so the question stays
  // a *single* decision (one question = one decision, per inline_decision
  // contract). Day 7 leans on Definition+Command (early problem framing);
  // Day 14 on Clout+Responsibility (first signals + commitments); Day 21 on
  // Adaptability+Command (pre-Day-30 honesty check).
  7: {
    title: "Day 7 — 한 줄 점검",
    body: "지난 7일 동안 잠재 고객 1명에게라도 한 가지 고통을 제대로 들었는가? 못 들었다면 그 이유 한 줄.",
    axes: ["definition", "command"],
  },
  14: {
    title: "Day 14 — 첫 신호 점검",
    body: "지난 7일 동안 도달·반응 신호가 1개라도 있었는가? 없었다면 다음 7일에 어떤 한 행동을 추가할 것인가.",
    axes: ["clout", "responsibility"],
  },
  21: {
    title: "Day 21 — 정직 모드 점검",
    body: "지금까지 가설을 데이터로 한 번이라도 수정했는가? Day 30 결산 직전, 정직하게 한 줄 적기.",
    axes: ["adaptability", "command"],
  },
});

export function buildRitualPrompt(day) {
  const focus = RITUAL_FOCUS[day];
  if (!focus) return null;
  return {
    ritualKey: `weekly_ritual_day_${day}`,
    title: focus.title,
    body: focus.body,
    axes: [...focus.axes],
  };
}
