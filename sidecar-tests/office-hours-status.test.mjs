import test from "node:test";
import assert from "node:assert/strict";
import {
  OFFICE_HOURS_STATUS_COPY,
  OFFICE_HOURS_FIRST_QUESTION_STATUS_COPY,
  selectOfficeHoursStatusCopy,
} from "../sidecar/office-hours-status.mjs";

const hasCopy = (entry) =>
  Boolean(entry)
  && typeof entry.title === "string" && entry.title.length > 0
  && typeof entry.detail === "string" && entry.detail.length > 0
  && typeof entry.progressText === "string" && entry.progressText.length > 0;

test("both status tables define non-empty copy for every stage", () => {
  for (const [stage, entry] of Object.entries(OFFICE_HOURS_STATUS_COPY)) {
    assert.ok(hasCopy(entry), `regular stage "${stage}" must define non-empty copy`);
  }
  for (const [stage, entry] of Object.entries(OFFICE_HOURS_FIRST_QUESTION_STATUS_COPY)) {
    assert.ok(hasCopy(entry), `first-question stage "${stage}" must define non-empty copy`);
  }
});

test("first-question table is a superset of the regular table (no missing stage keys)", () => {
  // emitOfficeHoursStatus resolves against exactly one table with no cross-table
  // fallback. If the first-question table omits a stage the run emits, the card
  // would stall on that stage. Pin that every regular stage exists here too.
  const regularKeys = Object.keys(OFFICE_HOURS_STATUS_COPY);
  const firstQuestionKeys = new Set(Object.keys(OFFICE_HOURS_FIRST_QUESTION_STATUS_COPY));
  const missing = regularKeys.filter((key) => !firstQuestionKeys.has(key));
  assert.deepEqual(missing, [], `first-question copy is missing stages: ${missing.join(", ")}`);
});

test("first-question in-progress stages provider_thinking and tool_running are identical (anti-flicker)", () => {
  // Claude streams thinking_delta (→ provider_thinking) and input_json_delta
  // (→ tool_running) interleaved per token while building the first question.
  // If the two stages resolve to different copy the loading card shakes between
  // two titles, so they MUST be identical.
  assert.deepEqual(
    OFFICE_HOURS_FIRST_QUESTION_STATUS_COPY.tool_running,
    OFFICE_HOURS_FIRST_QUESTION_STATUS_COPY.provider_thinking,
  );
});

test("follow-up in-progress stages provider_thinking and tool_running are identical (anti-flicker)", () => {
  // Claude's blocking-continue interview generates questions 2..N inside the
  // same runOfficeHours call, interleaving the same thinking/tool-input deltas
  // per token. Once the per-emit selection switches to the follow-up table, it
  // must obey the same anti-flicker identity or the card oscillates.
  assert.deepEqual(
    OFFICE_HOURS_STATUS_COPY.tool_running,
    OFFICE_HOURS_STATUS_COPY.provider_thinking,
  );
});

test("selectOfficeHoursStatusCopy flips from first-question to follow-up copy at the first answer", () => {
  // runOfficeHours selects the table per emit: with Claude the whole interview
  // runs inside one call, so a per-run table would keep questions 2..N reading
  // "첫 질문 …" (the Day 1 loading-card bug this pins against).
  assert.equal(
    selectOfficeHoursStatusCopy({ firstQuestionAnswered: false }),
    OFFICE_HOURS_FIRST_QUESTION_STATUS_COPY,
  );
  assert.equal(
    selectOfficeHoursStatusCopy({ firstQuestionAnswered: true }),
    OFFICE_HOURS_STATUS_COPY,
  );
  assert.equal(selectOfficeHoursStatusCopy(), OFFICE_HOURS_FIRST_QUESTION_STATUS_COPY);
});

test("first-question table uses first-question phrasing, distinct from the follow-up table", () => {
  // The whole point of the separate table: the first question must not read like
  // a follow-up ("다음 질문"). Pin the divergence on a representative stage.
  assert.match(OFFICE_HOURS_FIRST_QUESTION_STATUS_COPY.provider_starting.title, /첫 질문/);
  assert.match(OFFICE_HOURS_STATUS_COPY.provider_starting.title, /다음 질문/);
  assert.notEqual(
    OFFICE_HOURS_FIRST_QUESTION_STATUS_COPY.provider_starting.title,
    OFFICE_HOURS_STATUS_COPY.provider_starting.title,
  );
});

test("status tables are frozen (immutable copy source of truth)", () => {
  assert.ok(Object.isFrozen(OFFICE_HOURS_STATUS_COPY));
  assert.ok(Object.isFrozen(OFFICE_HOURS_FIRST_QUESTION_STATUS_COPY));
});
