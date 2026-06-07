// Round 6 / CCG-Codex Privacy 권고: get_rubric_status가 raw evidence/notes/
// anchor_text/no_evidence_reason을 그대로 응답으로 흘려보내면 결과가 caller
// (Claude/Codex provider)의 context로 들어간다. local-only privacy contract와
// 정면 충돌하므로 redact form만
// 반환한다. raw record는 사용자가 직접 `<workspace>/.agentic30/rubric-assessments.json`
// 에서 읽도록 안내.
//
// 도메인 함수는 mcp-server.mjs(stdio transport top-level await)와 분리해서
// unit test가 hang 없이 import할 수 있도록 본 모듈에 둔다.

function redactRubricRecord(record) {
  if (!record || typeof record !== "object") return null;
  const axes = record.axes && typeof record.axes === "object" ? record.axes : {};
  const axisScores = {};
  for (const [axis, entry] of Object.entries(axes)) {
    if (entry && typeof entry === "object" && typeof entry.score === "number") {
      axisScores[axis] = entry.score;
    }
  }
  return {
    sessionId: typeof record.sessionId === "string" ? record.sessionId : null,
    day: typeof record.day === "number" ? record.day : null,
    recordedAt: typeof record.recordedAt === "string" ? record.recordedAt : null,
    axisCount: Object.keys(axisScores).length,
    axisScores,
  };
}

export function redactRubricStatus(status) {
  if (!status || typeof status !== "object") {
    return { dayZero: null, dayThirty: null, delta: null, recordCount: 0 };
  }
  return {
    dayZero: redactRubricRecord(status.dayZero),
    dayThirty: redactRubricRecord(status.dayThirty),
    // delta는 axis별 숫자 차이 (이미 evidence/notes 없는 형태) — 그대로 통과.
    delta: Array.isArray(status.delta) ? status.delta : null,
    recordCount: typeof status.recordCount === "number" ? status.recordCount : 0,
  };
}
