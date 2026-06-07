import assert from "node:assert/strict";
import test from "node:test";
import os from "node:os";
import fs from "node:fs/promises";
import path from "node:path";

import {
  DAY_PROGRESS_SCHEMA,
  DAY_PROGRESS_SCHEMA_VERSION,
  DAY1_STEPS,
  STANDARD_STEPS,
  stepDefsForDay,
  dayKindForDay,
  computeDayNumber,
  normalizeDayProgress,
  normalizeDayRecord,
  loadDayProgress,
  patchDayStep,
  ensureChallengeStart,
  resolveDayProgressPath,
} from "../sidecar/day-progress-state.mjs";

async function tmpWorkspace() {
  return await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-dayprog-"));
}

test("stepDefsForDay gates step count by Day kind", () => {
  assert.equal(dayKindForDay(1), "day1");
  assert.equal(dayKindForDay(2), "standard");
  assert.deepEqual(stepDefsForDay(1), DAY1_STEPS);
  assert.equal(stepDefsForDay(1).length, 4);
  assert.deepEqual(stepDefsForDay(7), STANDARD_STEPS);
  assert.equal(stepDefsForDay(7).length, 5);
});

test("computeDayNumber is elapsed-days-from-start + 1 on local dates", () => {
  // 6/1 start, viewed on 6/3 local → Day 3 (decision: 시작일 경과일 = Day 번호)
  assert.equal(
    computeDayNumber({ challengeStartedAt: "2026-06-01", now: new Date(2026, 5, 3, 10, 0, 0) }),
    3,
  );
  // same local day → Day 1
  assert.equal(
    computeDayNumber({ challengeStartedAt: "2026-06-01", now: new Date(2026, 5, 1, 23, 59, 0) }),
    1,
  );
  // ISO timestamp start is accepted (date portion only)
  assert.equal(
    computeDayNumber({ challengeStartedAt: "2026-06-01T08:00:00.000Z", now: new Date(2026, 5, 8, 9, 0, 0) }),
    8,
  );
  // future start clamps to Day 1
  assert.equal(
    computeDayNumber({ challengeStartedAt: "2026-06-10", now: new Date(2026, 5, 3) }),
    1,
  );
  // no start recorded yet → null
  assert.equal(computeDayNumber({ challengeStartedAt: null, now: new Date(2026, 5, 3) }), null);
});

test("normalizeDayRecord fills steps by kind and coerces bad status to pending", () => {
  const rec = normalizeDayRecord(
    { day: 7, steps: { scan: "done", retro: "active", interview: "bogus" } },
    { now: new Date("2026-06-07T00:00:00.000Z") },
  );
  assert.equal(rec.kind, "standard");
  assert.deepEqual(Object.keys(rec.steps), STANDARD_STEPS);
  assert.equal(rec.steps.scan, "done");
  assert.equal(rec.steps.retro, "active");
  assert.equal(rec.steps.interview, "pending"); // bad value coerced
  assert.equal(rec.steps.execution, "pending"); // missing → pending
});

test("normalizeDayRecord drops day1-only step on standard day and vice versa", () => {
  // onboarding only exists for Day 1; a standard day must not carry it
  const standard = normalizeDayRecord({ day: 5, steps: { onboarding: "done", scan: "done" } });
  assert.ok(!("onboarding" in standard.steps));
  assert.equal(standard.steps.scan, "done");

  const day1 = normalizeDayRecord({ day: 1, steps: { onboarding: "done", execution: "done" } });
  assert.deepEqual(Object.keys(day1.steps), DAY1_STEPS);
  assert.ok(!("execution" in day1.steps));
  assert.equal(day1.steps.onboarding, "done");
});

test("normalizeDayProgress returns a clean default for garbage input", () => {
  for (const bad of [null, undefined, 42, "x", []]) {
    const norm = normalizeDayProgress(bad);
    assert.equal(norm.schema, DAY_PROGRESS_SCHEMA);
    assert.equal(norm.schemaVersion, DAY_PROGRESS_SCHEMA_VERSION);
    assert.equal(norm.challengeStartedAt, null);
    assert.deepEqual(norm.days, {});
  }
});

test("patchDayStep round-trips and auto-records challenge start", async () => {
  const ws = await tmpWorkspace();
  try {
    const now = new Date(2026, 5, 7, 12, 0, 0);
    const out = await patchDayStep({ workspaceRoot: ws, day: 7, stepId: "interview", status: "active", goalText: "Go/No-Go 결정하기", now });
    assert.equal(out.schema, DAY_PROGRESS_SCHEMA);
    assert.equal(out.challengeStartedAt, "2026-06-07"); // local date of `now`
    assert.equal(out.days["7"].kind, "standard");
    assert.equal(out.days["7"].steps.interview, "active");
    assert.equal(out.days["7"].steps.scan, "pending");
    assert.equal(out.days["7"].goalText, "Go/No-Go 결정하기");

    // reload from disk = same shape
    const reloaded = await loadDayProgress({ workspaceRoot: ws });
    assert.deepEqual(reloaded, out);

    // a second patch preserves prior steps + challengeStartedAt
    const out2 = await patchDayStep({ workspaceRoot: ws, day: 7, stepId: "goal", status: "done", now: new Date(2026, 5, 7, 13, 0, 0) });
    assert.equal(out2.challengeStartedAt, "2026-06-07");
    assert.equal(out2.days["7"].steps.goal, "done");
    assert.equal(out2.days["7"].steps.interview, "active"); // untouched
  } finally {
    await fs.rm(ws, { recursive: true, force: true });
  }
});

test("patchDayStep rejects an unknown step for the day kind", async () => {
  const ws = await tmpWorkspace();
  try {
    // 'retro' does not exist on Day 1 (day1 kind)
    await assert.rejects(
      () => patchDayStep({ workspaceRoot: ws, day: 1, stepId: "retro", status: "done" }),
      /unknown step/,
    );
    // 'onboarding' does not exist on a standard day
    await assert.rejects(
      () => patchDayStep({ workspaceRoot: ws, day: 4, stepId: "onboarding", status: "done" }),
      /unknown step/,
    );
  } finally {
    await fs.rm(ws, { recursive: true, force: true });
  }
});

test("ensureChallengeStart records once and is idempotent", async () => {
  const ws = await tmpWorkspace();
  try {
    const first = await ensureChallengeStart({ workspaceRoot: ws, now: new Date(2026, 5, 1, 9, 0, 0) });
    assert.equal(first.challengeStartedAt, "2026-06-01");
    // a later call must NOT overwrite the original start date
    const second = await ensureChallengeStart({ workspaceRoot: ws, now: new Date(2026, 5, 9, 9, 0, 0) });
    assert.equal(second.challengeStartedAt, "2026-06-01");
    // file on disk reflects the stable start
    const onDisk = JSON.parse(await fs.readFile(resolveDayProgressPath(ws), "utf8"));
    assert.equal(onDisk.challengeStartedAt, "2026-06-01");
  } finally {
    await fs.rm(ws, { recursive: true, force: true });
  }
});

test("loadDayProgress returns null when file is absent", async () => {
  const ws = await tmpWorkspace();
  try {
    assert.equal(await loadDayProgress({ workspaceRoot: ws }), null);
  } finally {
    await fs.rm(ws, { recursive: true, force: true });
  }
});
