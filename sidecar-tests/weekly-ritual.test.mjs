import test from "node:test";
import assert from "node:assert/strict";

import {
  RITUAL_DAYS,
  detectRitualBoundary,
  buildRitualPrompt,
} from "../sidecar/weekly-ritual.mjs";
import {
  acknowledgePendingRitual,
  applyCurriculumDayUpdate,
  makeDefaultBipCoachState,
} from "../sidecar/bip-coach-state.mjs";

test("RITUAL_DAYS is the canonical 7/14/21 (Day 30 is the closing assessment, not a ritual)", () => {
  assert.deepEqual([...RITUAL_DAYS], [7, 14, 21]);
});

test("detectRitualBoundary fires day=7 when curriculumDay=7 and nothing observed yet", () => {
  const result = detectRitualBoundary({ curriculumDay: 7, lastRitualDayObserved: 0 });
  assert.deepEqual(result, { day: 7, ritualKey: "weekly_ritual_day_7" });
});

test("detectRitualBoundary stays silent between boundaries", () => {
  // After Day 7 ritual was already observed, Day 10 should not re-fire.
  assert.equal(detectRitualBoundary({ curriculumDay: 10, lastRitualDayObserved: 7 }), null);
  // Before the first boundary, also silent.
  assert.equal(detectRitualBoundary({ curriculumDay: 6, lastRitualDayObserved: 0 }), null);
});

test("detectRitualBoundary fires the next boundary even when day jumps past it", () => {
  // Skipping from day 7 straight to day 16 should still surface day 14.
  const result = detectRitualBoundary({ curriculumDay: 16, lastRitualDayObserved: 7 });
  assert.equal(result?.day, 14);
});

test("detectRitualBoundary returns null for non-numeric or NaN curriculumDay", () => {
  assert.equal(detectRitualBoundary({ curriculumDay: null }), null);
  assert.equal(detectRitualBoundary({ curriculumDay: undefined }), null);
  assert.equal(detectRitualBoundary({ curriculumDay: NaN }), null);
  assert.equal(detectRitualBoundary({ curriculumDay: "7" }), null);
});

test("buildRitualPrompt returns a focused single-decision payload for each ritual day", () => {
  for (const day of RITUAL_DAYS) {
    const prompt = buildRitualPrompt(day);
    assert.ok(prompt, `missing prompt for day ${day}`);
    assert.equal(prompt.ritualKey, `weekly_ritual_day_${day}`);
    assert.ok(prompt.title.includes(`Day ${day}`));
    assert.ok(prompt.body.length > 10);
    assert.ok(prompt.axes.length >= 1 && prompt.axes.length <= 2, "1-2 axes per ritual");
  }
  assert.equal(buildRitualPrompt(30), null, "Day 30 is the closing assessment, not a ritual");
});

test("applyCurriculumDayUpdate folds boundary atomically: lastRitualDayObserved updates BEFORE caller emits", () => {
  // Codex MEDIUM: two sessions racing through the same day must not both
  // fire. The state mutation must precede emission so the second caller
  // already sees lastRitualDayObserved=7 and gets pendingRitual=null.
  const initial = makeDefaultBipCoachState();
  const session1 = applyCurriculumDayUpdate(initial, { curriculumDay: 7 });
  assert.equal(session1.pendingRitual?.day, 7, "session 1 should fire");
  assert.equal(session1.lastRitualDayObserved, 7, "lastRitualDayObserved updated in same transition");

  // A second session reads the persisted state (after session1 saved) and
  // applies the same curriculumDay — must NOT fire again.
  const session2 = applyCurriculumDayUpdate(session1, { curriculumDay: 7 });
  assert.equal(session2.pendingRitual, null, "duplicate call must not re-fire ritual");
  assert.equal(session2.lastRitualDayObserved, 7);
});

test("applyCurriculumDayUpdate sets pendingRitualKey and pendingRitualDay alongside the transition", () => {
  // R6 / CCG-Codex: state must persist a pending ritual BEFORE broadcast,
  // so a crash between persist and emit replays on next boot.
  const initial = makeDefaultBipCoachState();
  const next = applyCurriculumDayUpdate(initial, { curriculumDay: 7 });
  assert.equal(next.pendingRitualKey, "weekly_ritual_day_7");
  assert.equal(next.pendingRitualDay, 7);
  assert.equal(next.pendingRitual?.day, 7);
});

test("acknowledgePendingRitual clears pending fields when day matches", () => {
  // applyCurriculumDayUpdate fires the EARLIEST unobserved boundary first.
  // From default lastObserved=0, curriculumDay=14 surfaces day=7 (the next
  // ritual the user has yet to see).
  let state = makeDefaultBipCoachState();
  state = applyCurriculumDayUpdate(state, { curriculumDay: 14 });
  assert.equal(state.pendingRitualDay, 7);
  state = acknowledgePendingRitual(state, { day: 7 });
  assert.equal(state.pendingRitualKey, null);
  assert.equal(state.pendingRitualDay, null);
});

test("acknowledgePendingRitual ignores stale ack for a different day (does not swallow fresh prompt)", () => {
  // Skip directly to the Day 14 boundary by simulating that Day 7 was
  // already observed. The pending prompt is now Day 14; an out-of-order
  // ack for Day 7 must not silently swallow it.
  let state = makeDefaultBipCoachState();
  state = { ...state, lastRitualDayObserved: 7 };
  state = applyCurriculumDayUpdate(state, { curriculumDay: 14 });
  assert.equal(state.pendingRitualDay, 14);
  const afterStale = acknowledgePendingRitual(state, { day: 7 });
  assert.equal(afterStale.pendingRitualKey, "weekly_ritual_day_14");
  assert.equal(afterStale.pendingRitualDay, 14);
});

test("applyCurriculumDayUpdate normalizes legacy state without lastRitualDayObserved field", () => {
  const legacy = { ...makeDefaultBipCoachState() };
  delete legacy.lastRitualDayObserved;
  const next = applyCurriculumDayUpdate(legacy, { curriculumDay: 14 });
  // Legacy default of 0 means day=7 fires first (the earliest ritual not yet
  // observed), since the user has effectively never seen any ritual.
  assert.equal(next.pendingRitual?.day, 7);
  assert.equal(next.lastRitualDayObserved, 7);
});
