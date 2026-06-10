import test from "node:test";
import assert from "node:assert/strict";
import {
  buildOfficeHoursResumePreamble,
  countOfficeHoursResumeTurnsFromOtherSessions,
  selectOfficeHoursResumeTurns,
  shouldSeedOfficeHoursResumeTranscript,
} from "../sidecar/office-hours-resume.mjs";

const makeTurn = (overrides = {}) => ({
  id: `oh-1-${Math.floor(Math.random() * 1e9)}`,
  day: 1,
  sessionId: "prior-session",
  requestId: "req-1",
  mode: "office_hours_tool",
  questionText: "지금까지 나온 가장 강한 실제 신호는 무엇인가요?",
  responseText: "답장이 왔고 현재 대안/비용을 말했다",
  occurredAt: "2026-06-09T23:32:34.881Z",
  ...overrides,
});

const day1ActiveProgress = (overrides = {}) => ({
  schemaVersion: 1,
  schema: "agentic30.day_progress.v1",
  challengeStartedAt: "2026-06-10",
  days: {
    1: {
      day: 1,
      kind: "day1",
      steps: {
        onboarding: "done",
        scan: "done",
        goal: "done",
        first_interview: "active",
        ...overrides,
      },
    },
  },
});

test("selectOfficeHoursResumeTurns returns day-scoped turns while first_interview is active", () => {
  const turns = selectOfficeHoursResumeTurns({
    turnLog: { turns: [makeTurn(), makeTurn({ id: "t2", questionText: "두 번째 질문?" })] },
    day: 1,
    dayProgress: day1ActiveProgress(),
  });
  assert.equal(turns.length, 2);
});

test("selectOfficeHoursResumeTurns is empty once the interview step is done", () => {
  const turns = selectOfficeHoursResumeTurns({
    turnLog: { turns: [makeTurn()] },
    day: 1,
    dayProgress: day1ActiveProgress({ first_interview: "done" }),
  });
  assert.deepEqual(turns, []);
});

test("selectOfficeHoursResumeTurns only applies to day1-kind days", () => {
  const dayProgress = {
    days: {
      2: { day: 2, kind: "standard", steps: { interview: "active" } },
    },
  };
  const turns = selectOfficeHoursResumeTurns({
    turnLog: { turns: [makeTurn({ day: 2 })] },
    day: 2,
    dayProgress,
  });
  assert.deepEqual(turns, []);
});

test("selectOfficeHoursResumeTurns drops other-day and incomplete turns", () => {
  const turns = selectOfficeHoursResumeTurns({
    turnLog: {
      turns: [
        makeTurn({ day: 3 }),
        makeTurn({ responseText: "  " }),
        makeTurn({ questionText: "" }),
        makeTurn({ id: "keep" }),
      ],
    },
    day: 1,
    dayProgress: day1ActiveProgress(),
  });
  assert.equal(turns.length, 1);
  assert.equal(turns[0].id, "keep");
});

test("selectOfficeHoursResumeTurns is empty without turns, day, or progress", () => {
  assert.deepEqual(selectOfficeHoursResumeTurns({ turnLog: { turns: [] }, day: 1, dayProgress: day1ActiveProgress() }), []);
  assert.deepEqual(selectOfficeHoursResumeTurns({ turnLog: { turns: [makeTurn()] }, day: null, dayProgress: day1ActiveProgress() }), []);
  assert.deepEqual(selectOfficeHoursResumeTurns({ turnLog: { turns: [makeTurn()] }, day: 1, dayProgress: null }), []);
});

test("selectOfficeHoursResumeTurns never fires for a /office-hours slash start", () => {
  // runtimeDay falls back to the elapsed challenge day, so without the source
  // gate an ad-hoc slash session would inherit the Day-1 interview history.
  const turns = selectOfficeHoursResumeTurns({
    turnLog: { turns: [makeTurn()] },
    day: 1,
    dayProgress: day1ActiveProgress(),
    source: "slash_command",
  });
  assert.deepEqual(turns, []);
});

test("selectOfficeHoursResumeTurns collapses re-asked questions to the latest answer", () => {
  // The pre-resume restart bug re-asked question 1 on every relaunch, so legacy
  // turn logs hold duplicates. The raw count must not overstate progress (it
  // feeds the k+1 index and the wrap-up decision).
  const turns = selectOfficeHoursResumeTurns({
    turnLog: {
      turns: [
        makeTurn({ id: "old", questionText: "같은 질문?", responseText: "옛 답" }),
        makeTurn({ id: "other", questionText: "다른 질문?", responseText: "다른 답" }),
        makeTurn({ id: "new", questionText: "같은  질문?", responseText: "새 답" }),
      ],
    },
    day: 1,
    dayProgress: day1ActiveProgress(),
  });
  assert.equal(turns.length, 2);
  assert.deepEqual(turns.map((turn) => turn.id), ["other", "new"]);
  assert.equal(turns.at(-1).responseText, "새 답");
});

test("countOfficeHoursResumeTurnsFromOtherSessions excludes the current session's own turns", () => {
  // The Mac retry path re-enters runOfficeHours on the SAME failed session;
  // its own turns are already counted by countOfficeHoursTurnsForSession, so
  // the resume offset must only carry other-session turns or an incomplete
  // interview would read as completed.
  const turns = [
    makeTurn({ sessionId: "prior-session" }),
    makeTurn({ sessionId: "prior-session", questionText: "둘째?" }),
    makeTurn({ sessionId: "current-session", questionText: "셋째?" }),
  ];
  assert.equal(countOfficeHoursResumeTurnsFromOtherSessions(turns, "current-session"), 2);
  assert.equal(countOfficeHoursResumeTurnsFromOtherSessions(turns, "unrelated"), 3);
  assert.equal(countOfficeHoursResumeTurnsFromOtherSessions([], "current-session"), 0);
});

test("selectOfficeHoursResumeTurns caps a pathological turn log", () => {
  const turns = selectOfficeHoursResumeTurns({
    turnLog: {
      turns: Array.from({ length: 40 }, (_, index) =>
        makeTurn({ id: `t${index}`, questionText: `질문 ${index}?` })),
    },
    day: 1,
    dayProgress: day1ActiveProgress(),
  });
  assert.ok(turns.length <= 8, `expected a cap, got ${turns.length}`);
  // keeps the most recent entries
  assert.equal(turns.at(-1).id, "t39");
});

test("shouldSeedOfficeHoursResumeTranscript: fresh session seeds, answered transcript does not", () => {
  assert.equal(shouldSeedOfficeHoursResumeTranscript({ messages: [] }), true);
  // synthetic start prompt + streaming assistant only -> still seedable
  assert.equal(
    shouldSeedOfficeHoursResumeTranscript({
      messages: [
        { role: "user", content: "Office Hours" },
        { role: "assistant", content: "" },
      ],
    }),
    true,
  );
  // a real answer row (e.g. retry after a failed resumed run) blocks re-seeding
  assert.equal(
    shouldSeedOfficeHoursResumeTranscript({
      messages: [
        { role: "assistant", content: "질문?" },
        { role: "user", content: "답변했다" },
      ],
    }),
    false,
  );
});

test("buildOfficeHoursResumePreamble lists prior turns and continues at k+1", () => {
  const preamble = buildOfficeHoursResumePreamble({
    turns: [
      makeTurn({ questionText: "첫 질문", responseText: "첫 답변" }),
      makeTurn({ questionText: "둘째 질문", responseText: "둘째 답변" }),
    ],
    expected: 6,
  });
  assert.match(preamble, /RESUME/);
  assert.match(preamble, /6개 질문 중 2개/);
  assert.match(preamble, /첫 질문/);
  assert.match(preamble, /둘째 답변/);
  assert.match(preamble, /질문 3\/6부터 이어서/);
  assert.match(preamble, /처음부터 다시 시작하지 마라/);
});

test("buildOfficeHoursResumePreamble switches to wrap-up when every question is answered", () => {
  const preamble = buildOfficeHoursResumePreamble({
    turns: Array.from({ length: 6 }, (_, index) => makeTurn({ id: `t${index}` })),
    expected: 6,
  });
  assert.match(preamble, /새 질문을 만들지 말고/);
  assert.match(preamble, /마무리/);
  assert.doesNotMatch(preamble, /질문 7\/6/);
});

test("buildOfficeHoursResumePreamble works without an expected count", () => {
  const preamble = buildOfficeHoursResumePreamble({
    turns: [makeTurn()],
    expected: 0,
  });
  assert.match(preamble, /다음 질문부터 이어서/);
  assert.doesNotMatch(preamble, /\/0/);
});

test("buildOfficeHoursResumePreamble is empty without turns", () => {
  assert.equal(buildOfficeHoursResumePreamble({ turns: [], expected: 6 }), "");
  assert.equal(buildOfficeHoursResumePreamble({}), "");
});

test("buildOfficeHoursResumePreamble clips oversized question/answer text", () => {
  const preamble = buildOfficeHoursResumePreamble({
    turns: [makeTurn({ questionText: "질".repeat(600), responseText: "답".repeat(900) })],
    expected: 6,
  });
  // 240 question chars + 320 answer chars + framing must stay compact
  assert.ok(preamble.length < 1_400, `preamble too long: ${preamble.length}`);
  assert.match(preamble, /…/);
});
