import test from "node:test";
import assert from "node:assert/strict";
import {
  buildOfficeHoursIncompleteInterviewMessage,
  countOfficeHoursTurnsForSession,
  parseExpectedOfficeHoursQuestionCount,
} from "../sidecar/office-hours-structured-input.mjs";

// Mirrors the shape ContentView's office-hours context builder emits: the
// count line sits between unrelated "key: value" lines, so the parser must
// anchor on the whole line and not on a substring of another fact.
const DAY1_CONTEXT = [
  "Office Hours screen context",
  "Workspace: /tmp/example",
  "Office Hours day: 1",
  "Office Hours mode: Startup",
  "Mode goal: 증거, 현재 대안, 가장 작은 유료 진입점을 묻는다.",
  "Expected question count: 6",
  "Scan artifacts: docs/ICP.md, docs/SPEC.md",
].join("\n");

test("parseExpectedOfficeHoursQuestionCount reads the embedded count line", () => {
  assert.equal(parseExpectedOfficeHoursQuestionCount(DAY1_CONTEXT), 6);
});

test("parseExpectedOfficeHoursQuestionCount returns 0 when no count is embedded", () => {
  assert.equal(parseExpectedOfficeHoursQuestionCount(""), 0);
  assert.equal(parseExpectedOfficeHoursQuestionCount(null), 0);
  assert.equal(parseExpectedOfficeHoursQuestionCount("Office Hours mode: Startup"), 0);
});

test("parseExpectedOfficeHoursQuestionCount rejects zero and non-line matches", () => {
  // 0 means "unknown" — callers skip enforcement entirely.
  assert.equal(parseExpectedOfficeHoursQuestionCount("Expected question count: 0"), 0);
  // The count must be its own context line, not a fragment inside prose.
  assert.equal(
    parseExpectedOfficeHoursQuestionCount("note: Expected question count: 6 was discussed"),
    0,
  );
});

test("countOfficeHoursTurnsForSession counts only the given session's turns", () => {
  const turnLog = {
    turns: [
      { sessionId: "a", questionText: "q1", responseText: "r1" },
      { sessionId: "b", questionText: "q2", responseText: "r2" },
      { sessionId: "a", questionText: "q3", responseText: "r3" },
      { questionText: "q4", responseText: "r4" },
    ],
  };
  assert.equal(countOfficeHoursTurnsForSession(turnLog, "a"), 2);
  assert.equal(countOfficeHoursTurnsForSession(turnLog, "b"), 1);
  assert.equal(countOfficeHoursTurnsForSession(turnLog, "missing"), 0);
});

test("countOfficeHoursTurnsForSession tolerates malformed input", () => {
  assert.equal(countOfficeHoursTurnsForSession(null, "a"), 0);
  assert.equal(countOfficeHoursTurnsForSession({}, "a"), 0);
  assert.equal(countOfficeHoursTurnsForSession({ turns: "nope" }, "a"), 0);
  assert.equal(countOfficeHoursTurnsForSession({ turns: [] }, ""), 0);
});

test("buildOfficeHoursIncompleteInterviewMessage names both counts", () => {
  const message = buildOfficeHoursIncompleteInterviewMessage({ expected: 6, answered: 5 });
  assert.match(message, /6개/);
  assert.match(message, /5개/);
  assert.match(message, /다시 시도/);
});
