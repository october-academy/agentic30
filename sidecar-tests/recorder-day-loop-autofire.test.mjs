import test from "node:test";
import assert from "node:assert/strict";

import {
  recorderDayMemoryLoopRanForDayKey,
  shouldAutoRunRecorderDayMemoryLoop,
} from "../sidecar/recorder-day-loop-autofire.mjs";

const todayKey = (date) => date.toISOString().slice(0, 10);

test("shouldAutoRunRecorderDayMemoryLoop fires in the Day-0-3 window when ready and not yet run today", () => {
  assert.deepEqual(
    shouldAutoRunRecorderDayMemoryLoop({
      recorderStoreReady: true,
      day: 2,
      readinessCanRecord: true,
      lastRunDayKey: "2026-06-30",
      todayKey: "2026-07-01",
    }),
    { fire: true, reason: "ok" },
  );
});

test("shouldAutoRunRecorderDayMemoryLoop skips when the recorder store is not running", () => {
  assert.deepEqual(
    shouldAutoRunRecorderDayMemoryLoop({ recorderStoreReady: false, day: 2, readinessCanRecord: true }),
    { fire: false, reason: "not_running" },
  );
});

test("shouldAutoRunRecorderDayMemoryLoop skips outside the Day-0-3 window but allows unknown day", () => {
  assert.deepEqual(
    shouldAutoRunRecorderDayMemoryLoop({ recorderStoreReady: true, day: 5, readinessCanRecord: true, todayKey: "2026-07-01" }),
    { fire: false, reason: "out_of_window" },
  );
  // Day 4 is the inclusive edge — still fires.
  assert.equal(
    shouldAutoRunRecorderDayMemoryLoop({ recorderStoreReady: true, day: 4, readinessCanRecord: true, todayKey: "2026-07-01" }).fire,
    true,
  );
  // Unknown day (null) must NOT gate out the very first session.
  assert.deepEqual(
    shouldAutoRunRecorderDayMemoryLoop({ recorderStoreReady: true, day: null, readinessCanRecord: true, todayKey: "2026-07-01" }),
    { fire: true, reason: "ok" },
  );
});

test("shouldAutoRunRecorderDayMemoryLoop is idempotent per local day", () => {
  assert.deepEqual(
    shouldAutoRunRecorderDayMemoryLoop({
      recorderStoreReady: true,
      day: 1,
      readinessCanRecord: true,
      lastRunDayKey: "2026-07-01",
      todayKey: "2026-07-01",
    }),
    { fire: false, reason: "already_ran_today" },
  );
});

test("shouldAutoRunRecorderDayMemoryLoop skips when capture readiness is blocked", () => {
  assert.deepEqual(
    shouldAutoRunRecorderDayMemoryLoop({
      recorderStoreReady: true,
      day: 1,
      readinessCanRecord: false,
      lastRunDayKey: "",
      todayKey: "2026-07-01",
    }),
    { fire: false, reason: "not_ready" },
  );
});

test("shouldAutoRunRecorderDayMemoryLoop precedence: not_running beats out_of_window and idempotency", () => {
  assert.equal(
    shouldAutoRunRecorderDayMemoryLoop({
      recorderStoreReady: false,
      day: 9,
      readinessCanRecord: false,
      lastRunDayKey: "2026-07-01",
      todayKey: "2026-07-01",
    }).reason,
    "not_running",
  );
  // out_of_window beats already_ran_today + not_ready.
  assert.equal(
    shouldAutoRunRecorderDayMemoryLoop({
      recorderStoreReady: true,
      day: 9,
      readinessCanRecord: false,
      lastRunDayKey: "2026-07-01",
      todayKey: "2026-07-01",
    }).reason,
    "out_of_window",
  );
});

test("recorderDayMemoryLoopRanForDayKey derives the local-day key from generatedAt", () => {
  assert.equal(
    recorderDayMemoryLoopRanForDayKey({ generatedAt: "2026-07-01T10:00:00.000Z" }, { todayKey }),
    "2026-07-01",
  );
  assert.equal(
    recorderDayMemoryLoopRanForDayKey({ generated_at: "2026-07-01T23:59:00.000Z" }, { todayKey }),
    "2026-07-01",
  );
  assert.equal(recorderDayMemoryLoopRanForDayKey(null, { todayKey }), "");
  assert.equal(recorderDayMemoryLoopRanForDayKey({ generatedAt: "not-a-date" }, { todayKey }), "");
  // No todayKey fn -> empty (defensive).
  assert.equal(recorderDayMemoryLoopRanForDayKey({ generatedAt: "2026-07-01T10:00:00.000Z" }), "");
});
