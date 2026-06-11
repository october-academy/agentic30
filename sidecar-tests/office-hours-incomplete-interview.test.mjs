import test from "node:test";
import assert from "node:assert/strict";
import {
  buildOfficeHoursIncompleteInterviewMessage,
  countOfficeHoursTurnsForSession,
  hasOfficeHoursTerminalTurnForSession,
  isOfficeHoursTerminalAlternativesRequest,
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

// The prompt smart-skips routed questions and closes with the 대안 비교 card,
// so a finished interview can hold fewer answers than the expected count.
// The gate must recognize that closing card — the Day 2 regression ended a
// legitimate 5-answer interview as "5/6 incomplete" and every retry saw a
// finished transcript, asked nothing, and tripped the same check forever.
test("isOfficeHoursTerminalAlternativesRequest recognizes the closing card", () => {
  // Signal stamp (inline-decision promotion path).
  assert.equal(
    isOfficeHoursTerminalAlternativesRequest({
      generation: { signalId: "office_hours_alternatives" },
      questions: [{ question: "어떤 안으로 보낼 건가?" }],
    }),
    true,
  );
  // Canonical header (tool channel after presentation normalization).
  assert.equal(
    isOfficeHoursTerminalAlternativesRequest({
      questions: [{ header: "대안 비교", question: "어떤 안으로 진행할까?" }],
    }),
    true,
  );
  // Mandated option labels — the live Day 2 card carried 최소안/이상안/다른 관점
  // but a header the intent regexes misroute ("대안" also matches status_quo).
  assert.equal(
    isOfficeHoursTerminalAlternativesRequest({
      questions: [{
        header: "발송안 선택",
        question: "오늘 그 한 통을 어떤 안으로 보낼 건가?",
        options: [
          { label: "최소안: 지금 박고 오늘 발송" },
          { label: "이상안: 대안 비용 확인+다음 후보까지" },
          { label: "다른 관점: '작은 유료 진입점'으로 발송" },
        ],
      }],
    }),
    true,
  );
});

test("isOfficeHoursTerminalAlternativesRequest rejects ordinary forcing questions", () => {
  assert.equal(isOfficeHoursTerminalAlternativesRequest(null), false);
  assert.equal(isOfficeHoursTerminalAlternativesRequest({}), false);
  // A demand-evidence card must not read as terminal.
  assert.equal(
    isOfficeHoursTerminalAlternativesRequest({
      generation: { signalId: "office_hours_demand_evidence" },
      questions: [{
        header: "수요 증거",
        question: "가장 강한 증거는 무엇인가요?",
        options: [
          { label: "실제 결제/계약이 있었다" },
          { label: "관심만 있거나 아직 증거가 없다" },
        ],
      }],
    }),
    false,
  );
  // One matching label alone (no 이상안) is not the closing card.
  assert.equal(
    isOfficeHoursTerminalAlternativesRequest({
      questions: [{
        header: "오늘 행동",
        question: "오늘 가장 작은 행동은?",
        options: [
          { label: "최소안으로 보낸다" },
          { label: "내일로 미룬다" },
        ],
      }],
    }),
    false,
  );
});

test("hasOfficeHoursTerminalTurnForSession scopes the terminal stamp to the session", () => {
  const turnLog = {
    turns: [
      { sessionId: "a", questionText: "q1", responseText: "r1" },
      { sessionId: "a", questionText: "q5", responseText: "r5", terminal: true },
      { sessionId: "b", questionText: "q1", responseText: "r1" },
    ],
  };
  assert.equal(hasOfficeHoursTerminalTurnForSession(turnLog, "a"), true);
  assert.equal(hasOfficeHoursTerminalTurnForSession(turnLog, "b"), false);
  assert.equal(hasOfficeHoursTerminalTurnForSession(turnLog, ""), false);
  assert.equal(hasOfficeHoursTerminalTurnForSession(null, "a"), false);
});
