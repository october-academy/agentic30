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
  setDayActiveStep,
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

test("normalizeDayRecord repairs legacy Day 1 goal text and clears it from later days", () => {
  const legacyGoal = "전업 1인 개발자 (수익 0원, macOS)가 만들 줄은 알지만 무엇을 팔아야 하는지, 어떻게 사람을 데려와야 하는지, 오늘 무엇을 검증해야 하는지 모른다에 돈이나 시간을 쓸지 지불 의향과 현재 대안을 첫 고객 대화에서 묻는다.으로 확인한다.";

  const day1 = normalizeDayRecord({ day: 1, steps: {}, goalText: legacyGoal });
  assert.equal(day1.goalText, "30일 안에 첫 유료 결제 1건을 만든다.");
  assert.doesNotMatch(day1.goalText, /모른다에|[.!?。！？]으로 확인한다/);

  const day2 = normalizeDayRecord({ day: 2, steps: {}, goalText: legacyGoal });
  assert.equal(day2.goalText, "");
});

test("normalizeDayRecord repairs legacy Day 1 get_users target to active users", () => {
  const day1 = normalizeDayRecord({ day: 1, steps: {}, goalText: "30일 안에 가입자 100명을 모은다." });
  assert.equal(day1.goalText, "30일 안에 핵심 활성 행동을 끝낸 사용자 100명을 만든다.");
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

test("setDayActiveStep marks earlier steps done and the target active", async () => {
  const ws = await tmpWorkspace();
  try {
    const now = new Date(2026, 5, 7, 9, 0, 0);
    // scan complete → goal active on a standard day (Day 7)
    const afterScan = await setDayActiveStep({ workspaceRoot: ws, day: 7, stepId: "goal", goalText: "Go/No-Go 결정하기", now });
    const d7 = afterScan.days["7"];
    assert.equal(d7.steps.scan, "done");
    assert.equal(d7.steps.retro, "done"); // auto-completed (no dedicated screen)
    assert.equal(d7.steps.goal, "active");
    assert.equal(d7.steps.interview, "pending");
    assert.equal(d7.steps.execution, "pending");
    assert.equal(d7.goalText, "Go/No-Go 결정하기");
    assert.equal(afterScan.challengeStartedAt, "2026-06-07");

    // goal confirmed → interview active, goal now done
    const afterGoal = await setDayActiveStep({ workspaceRoot: ws, day: 7, stepId: "interview", now: new Date(2026, 5, 7, 10, 0, 0) });
    const g7 = afterGoal.days["7"];
    assert.equal(g7.steps.goal, "done");
    assert.equal(g7.steps.interview, "active");
    assert.equal(g7.steps.execution, "pending");
  } finally {
    await fs.rm(ws, { recursive: true, force: true });
  }
});

test("setDayActiveStep is monotonic — a re-scan never regresses past progress", async () => {
  const ws = await tmpWorkspace();
  try {
    const now = new Date(2026, 5, 7, 9, 0, 0);
    await setDayActiveStep({ workspaceRoot: ws, day: 7, stepId: "interview", now }); // advanced to interview
    // a later re-scan targets the earlier "goal" step — must NOT pull back
    const afterRescan = await setDayActiveStep({ workspaceRoot: ws, day: 7, stepId: "goal", now: new Date(2026, 5, 7, 11, 0, 0) });
    const d7 = afterRescan.days["7"];
    assert.equal(d7.steps.goal, "done");      // stays done
    assert.equal(d7.steps.interview, "active"); // stays active (no regression)
  } finally {
    await fs.rm(ws, { recursive: true, force: true });
  }
});

test("setDayActiveStep on Day 1 uses the day1 step set", async () => {
  const ws = await tmpWorkspace();
  try {
    const now = new Date(2026, 5, 1, 9, 0, 0);
    const afterGoal = await setDayActiveStep({ workspaceRoot: ws, day: 1, stepId: "first_interview", now });
    const d1 = afterGoal.days["1"];
    assert.deepEqual(Object.keys(d1.steps), ["onboarding", "scan", "goal", "first_interview"]);
    assert.equal(d1.steps.onboarding, "done");
    assert.equal(d1.steps.scan, "done");
    assert.equal(d1.steps.goal, "done");
    assert.equal(d1.steps.first_interview, "active");
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

// --- Milestone gate ordering (spec §10.1): the day_progress_patch handler runs
// evaluateDayProgressPatchGate BEFORE patchDayStep. These tests pin that contract
// at the module level: a blocked milestone gate withholds the patch entirely.
test("milestone gate withholds a Day 8 patch until G2 evidence exists, then allows it", async () => {
  const { evaluateDayProgressPatchGate } = await import("../sidecar/program-gate-engine.mjs");
  const { appendProofLedgerEvent } = await import("../sidecar/execution-os.mjs");
  const ws = await tmpWorkspace();
  try {
    const now = new Date("2026-06-12T09:00:00.000Z");
    const blocked = await evaluateDayProgressPatchGate({ workspaceRoot: ws, day: 8, stepId: "scan", now });
    assert.equal(blocked.blocked, true);
    assert.equal(blocked.gate.gateId, "G2");
    // Handler contract: a blocked check means patchDayStep is never called, so
    // no day-progress file is created by the withheld patch.
    assert.equal(await loadDayProgress({ workspaceRoot: ws }), null);

    for (const event of [
      { id: "supporting-1", type: "landing_metric", day: 6, status: "verified", strength: "medium", polarity: "supporting" },
      { id: "counter-1", type: "interview", day: 5, status: "verified", strength: "strong", polarity: "counter" },
      { id: "decision-1", type: "day_decision", day: 7, status: "accepted", decision: "continue" },
    ]) {
      await appendProofLedgerEvent({ workspaceRoot: ws, event, now });
    }
    const allowed = await evaluateDayProgressPatchGate({ workspaceRoot: ws, day: 8, stepId: "scan", now });
    assert.equal(allowed.blocked, false);
    const progress = await patchDayStep({ workspaceRoot: ws, day: 8, stepId: "scan", status: "done", now });
    assert.equal(progress.days["8"].steps.scan, "done");
  } finally {
    await fs.rm(ws, { recursive: true, force: true });
  }
});

test("G1 blocks only the Day 4 goal step and later steps, not scan/retro", async () => {
  const { evaluateDayProgressPatchGate } = await import("../sidecar/program-gate-engine.mjs");
  const ws = await tmpWorkspace();
  try {
    const now = new Date("2026-06-12T09:00:00.000Z");
    const scan = await evaluateDayProgressPatchGate({ workspaceRoot: ws, day: 4, stepId: "scan", now });
    assert.equal(scan.blocked, false);
    const retro = await evaluateDayProgressPatchGate({ workspaceRoot: ws, day: 4, stepId: "retro", now });
    assert.equal(retro.blocked, false);
    const goal = await evaluateDayProgressPatchGate({ workspaceRoot: ws, day: 4, stepId: "goal", now });
    assert.equal(goal.blocked, true);
    assert.equal(goal.gate.gateId, "G1");
    const execution = await evaluateDayProgressPatchGate({ workspaceRoot: ws, day: 4, stepId: "execution", now });
    assert.equal(execution.blocked, true);
    // Day 1-3 are never milestone-blocked.
    const day3 = await evaluateDayProgressPatchGate({ workspaceRoot: ws, day: 3, stepId: "goal", now });
    assert.equal(day3.blocked, false);
  } finally {
    await fs.rm(ws, { recursive: true, force: true });
  }
});
