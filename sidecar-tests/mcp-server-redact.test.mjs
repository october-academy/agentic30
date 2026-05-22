import test from "node:test";
import assert from "node:assert/strict";

import {
  redactRubricStatus,
  summarizeOriginalForMcp,
} from "../sidecar/rubric-redact.mjs";

// R6-P1A / CCG-Codex: get_rubric_status가 raw evidence/notes/anchor_text/
// no_evidence_reason을 provider context로 흘려보내면 local-only privacy
// contract와 충돌. redact form만 응답에 들어가는지 검증.

function fullDay30Record() {
  return {
    sessionId: "session-1",
    recordedAt: "2026-06-06T20:00:00.000Z",
    day: 30,
    notes: "이건 사용자 사적 메모. MCP로 흘러서는 안 됨.",
    axes: {
      definition: {
        score: 4,
        anchor_level: 3,
        anchor_text: "ANCHOR-TEXT-MUST-NOT-LEAK",
        evidence_refs: [{ type: "session_message", ref: "msg-42" }],
      },
      command: {
        score: 2,
        anchor_level: 1,
        anchor_text: "Day 0 baseline",
        no_evidence_reason: "이번 주 결정 기록 안 함 (사적 회고)",
      },
      clout: {
        score: 1,
        anchor_level: 1,
        anchor_text: "...",
        no_evidence_reason: "PRIVATE-REASON-MUST-NOT-LEAK",
      },
      responsibility: { score: 3, anchor_level: 3, anchor_text: "..." },
      adaptability: { score: 2, anchor_level: 1, anchor_text: "..." },
    },
  };
}

test("redactRubricStatus strips evidence_refs, anchor_text, no_evidence_reason, notes from records", () => {
  const status = {
    dayZero: { ...fullDay30Record(), day: 0 },
    dayThirty: fullDay30Record(),
    delta: [{ axis: "definition", day0_score: 1, day30_score: 4, delta: 3 }],
    recordCount: 2,
  };
  const redacted = redactRubricStatus(status);
  const json = JSON.stringify(redacted);
  // The raw text strings must not appear anywhere in the output.
  assert.equal(json.includes("ANCHOR-TEXT-MUST-NOT-LEAK"), false, "anchor_text leaked");
  assert.equal(json.includes("PRIVATE-REASON-MUST-NOT-LEAK"), false, "no_evidence_reason leaked");
  assert.equal(json.includes("이건 사용자 사적 메모"), false, "notes leaked");
  assert.equal(json.includes("session_message"), false, "evidence_refs entries leaked");
  assert.equal(json.includes("msg-42"), false, "evidence ref id leaked");
});

test("redactRubricStatus keeps non-sensitive metadata (sessionId, day, recordedAt, axisScores, delta)", () => {
  const status = {
    dayZero: { ...fullDay30Record(), day: 0 },
    dayThirty: fullDay30Record(),
    delta: [{ axis: "definition", day0_score: 1, day30_score: 4, delta: 3 }],
    recordCount: 2,
  };
  const redacted = redactRubricStatus(status);
  assert.equal(redacted.dayZero.sessionId, "session-1");
  assert.equal(redacted.dayZero.day, 0);
  assert.equal(redacted.dayZero.recordedAt, "2026-06-06T20:00:00.000Z");
  // axisScores keeps just the numeric score per axis.
  assert.deepEqual(
    Object.keys(redacted.dayZero.axisScores).sort(),
    ["adaptability", "clout", "command", "definition", "responsibility"],
  );
  assert.equal(redacted.dayZero.axisScores.definition, 4);
  // axisCount is a non-leaking summary.
  assert.equal(redacted.dayZero.axisCount, 5);
  // delta passes through (already non-sensitive).
  assert.equal(redacted.delta[0].delta, 3);
  assert.equal(redacted.recordCount, 2);
});

test("summarizeOriginalForMcp returns identifier-only string (no raw payload)", () => {
  // The Mac client uses originalSummary as a list label. raw `original` (사용자
  // 임의 JSON, 사적 메모 포함 가능) must never appear in MCP results.
  const summary = summarizeOriginalForMcp({
    sessionId: "session-x",
    day: 30,
    notes: "PRIVATE-NOTE-MUST-NOT-LEAK",
    axes: { definition: { score: 4 } },
  });
  assert.equal(summary, "session-x · Day 30");
  assert.equal(summarizeOriginalForMcp(null), null);
  assert.equal(summarizeOriginalForMcp({ sessionId: "x" }), "x");
  assert.equal(summarizeOriginalForMcp({ day: 30 }), "Day 30");
  assert.equal(summarizeOriginalForMcp({}), null);
});

test("redactRubricStatus handles null records and missing axes gracefully", () => {
  const empty = redactRubricStatus({ dayZero: null, dayThirty: null, delta: null, recordCount: 0 });
  assert.equal(empty.dayZero, null);
  assert.equal(empty.dayThirty, null);
  assert.equal(empty.recordCount, 0);
  // Missing axes object → axisCount=0, axisScores={}.
  const partial = redactRubricStatus({
    dayZero: { sessionId: "x", day: 0, recordedAt: "2026-05-08T00:00:00Z" },
    dayThirty: null,
    delta: null,
    recordCount: 1,
  });
  assert.equal(partial.dayZero.axisCount, 0);
  assert.deepEqual(partial.dayZero.axisScores, {});
});
