import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  OFFICE_HOURS_MEMORY_SCHEMA_VERSION,
  OFFICE_HOURS_MEMORY_SCHEMA,
  MAX_TIMELINE_ENTRIES,
  MAX_CYCLE_LEDGER,
  ABANDONED_THREAD_CYCLES,
  resolveOfficeHoursMemoryPath,
  loadOfficeHoursMemory,
  makeDefaultOfficeHoursMemory,
  normalizeOfficeHoursMemory,
  appendCommitment,
  gradeCommitment,
  appendCycle,
  appendTimeline,
  appendPrediction,
  gradePrediction,
  latestUnresolvedPrediction,
  summarizePredictionCalibration,
  recompileCompiledTruth,
  buildCompiledTruth,
  detectAbandonedThreads,
  buildPriorCycle,
  summarizeOfficeHoursMemory,
  formatPriorCycleOpening,
  classifyInterviewGate,
  isGatedInterviewStep,
} from "../sidecar/office-hours-memory.mjs";

async function tempWorkspace() {
  return fs.mkdtemp(path.join(os.tmpdir(), "oh-mem-"));
}

const NOW = new Date("2026-06-08T09:00:00.000Z");

test("makeDefault + normalize roundtrip is stable and self-describing", () => {
  const def = makeDefaultOfficeHoursMemory({ now: NOW });
  assert.equal(def.schemaVersion, OFFICE_HOURS_MEMORY_SCHEMA_VERSION);
  assert.equal(def.schema, OFFICE_HOURS_MEMORY_SCHEMA);
  const round = normalizeOfficeHoursMemory(JSON.parse(JSON.stringify(def)), { now: NOW });
  assert.deepEqual(round, def);
});

test("appendCommitment persists, loads back identically, and is user-origin", async () => {
  const ws = await tempWorkspace();
  const saved = await appendCommitment({
    workspaceRoot: ws,
    text: "Joe 네트워크에 DM 5개 보내기",
    cycle: 9,
    day: 12,
    originText: "내가 직접 Joe 네트워크에 DM 5개 보낼게",
    now: NOW,
  });
  assert.equal(saved.commitments.length, 1);
  assert.equal(saved.commitments[0].status, "open");
  assert.equal(saved.commitments[0].origin, "user");
  // round-trips from disk
  const loaded = await loadOfficeHoursMemory({ workspaceRoot: ws, now: NOW });
  assert.deepEqual(loaded.commitments, saved.commitments);
  // file lives under .agentic30/
  const p = resolveOfficeHoursMemoryPath(ws);
  assert.ok(p.endsWith(path.join(".agentic30", "office-hours-memory.json")));
  await fs.rm(ws, { recursive: true, force: true });
});

test("user-origin gate: empty originText throws (no model/tool fabrication)", async () => {
  const ws = await tempWorkspace();
  await assert.rejects(
    () => appendCommitment({ workspaceRoot: ws, text: "x", cycle: 1, originText: "", now: NOW }),
    /user-origin gate/,
  );
  await assert.rejects(
    () => appendCommitment({ workspaceRoot: ws, text: "x", cycle: 1, now: NOW }),
    /user-origin gate/,
  );
  await fs.rm(ws, { recursive: true, force: true });
});

test("grade with HARD evidence -> met; non-hard kind -> missed (never met)", async () => {
  const ws = await tempWorkspace();
  const saved = await appendCommitment({
    workspaceRoot: ws,
    text: "DM 보내기",
    cycle: 9,
    originText: "DM 보낼게",
    now: NOW,
  });
  const id = saved.commitments[0].id;

  // praise/interest is NOT hard evidence -> missed
  const soft = await gradeCommitment({
    workspaceRoot: ws,
    commitmentId: id,
    evidence: { kind: "praise", note: "좋다고 했음" },
    gradedCycle: 10,
    now: NOW,
  });
  assert.equal(soft.graded, false);
  assert.equal(soft.memory.commitments[0].status, "missed");
  assert.equal(soft.memory.commitments[0].evidence, null);

  // a real capture URL -> met
  const hard = await gradeCommitment({
    workspaceRoot: ws,
    commitmentId: id,
    evidence: { kind: "screenshot", url: "https://example.com/dm-capture.png" },
    gradedCycle: 10,
    now: NOW,
  });
  assert.equal(hard.graded, true);
  assert.equal(hard.memory.commitments[0].status, "met");
  assert.equal(hard.memory.commitments[0].evidence.kind, "screenshot");
  await fs.rm(ws, { recursive: true, force: true });
});

test("duplicate same-text/same-cycle commitments get distinct ids and grade independently", async () => {
  const ws = await tempWorkspace();
  await appendCommitment({ workspaceRoot: ws, text: "DM 5개 보내기", cycle: 9, originText: "보낼게", now: NOW });
  const second = await appendCommitment({ workspaceRoot: ws, text: "DM 5개 보내기", cycle: 9, originText: "또 보낼게", now: NOW });
  assert.equal(second.commitments.length, 2);
  const [id1, id2] = second.commitments.map((c) => c.id);
  assert.notEqual(id1, id2);
  const graded = await gradeCommitment({
    workspaceRoot: ws, commitmentId: id2, evidence: { kind: "url", url: "https://x/y" }, gradedCycle: 10, now: NOW,
  });
  assert.equal(graded.memory.commitments.find((c) => c.id === id2).status, "met");
  assert.equal(graded.memory.commitments.find((c) => c.id === id1).status, "open"); // first untouched
  await fs.rm(ws, { recursive: true, force: true });
});

test("met-with-evidence is never wiped by a later soft re-grade; new hard evidence replaces", async () => {
  const ws = await tempWorkspace();
  const saved = await appendCommitment({ workspaceRoot: ws, text: "DM", cycle: 9, originText: "보낼게", now: NOW });
  const id = saved.commitments[0].id;
  await gradeCommitment({ workspaceRoot: ws, commitmentId: id, evidence: { kind: "url", url: "https://proof/1" }, gradedCycle: 10, now: NOW });
  // a later soft re-grade is a NO-OP — proven evidence survives
  const soft = await gradeCommitment({ workspaceRoot: ws, commitmentId: id, evidence: { kind: "praise", note: "좋대" }, gradedCycle: 11, now: NOW });
  assert.equal(soft.graded, false);
  assert.equal(soft.memory.commitments[0].status, "met");
  assert.equal(soft.memory.commitments[0].evidence.url, "https://proof/1");
  // NEW hard evidence replaces prior proof
  const re = await gradeCommitment({ workspaceRoot: ws, commitmentId: id, evidence: { kind: "payment", url: "https://proof/2" }, gradedCycle: 12, now: NOW });
  assert.equal(re.graded, true);
  assert.equal(re.memory.commitments[0].evidence.kind, "payment");
  assert.equal(re.memory.commitments[0].evidence.url, "https://proof/2");
  await fs.rm(ws, { recursive: true, force: true });
});

test("status-aware cap never drops an open commitment (costume targets survive)", () => {
  const memory = makeDefaultOfficeHoursMemory({ now: NOW });
  const openOld = Array.from({ length: 3 }, (_, i) => ({
    id: `o${i}`, cycle: 2, createdDay: 2, createdAt: NOW.toISOString(), text: `open-${i}`, status: "open", evidence: null, origin: "user",
  }));
  const resolvedNewer = Array.from({ length: 70 }, (_, i) => ({
    id: `r${i}`, cycle: 5, createdDay: 5, createdAt: NOW.toISOString(), text: `r${i}`, status: "met",
    evidence: { kind: "url", url: "x", note: "", gradedCycle: 5, gradedAt: NOW.toISOString() }, origin: "user",
  }));
  memory.commitments = [...openOld, ...resolvedNewer]; // 73 total, open are oldest
  const norm = normalizeOfficeHoursMemory(memory, { now: NOW });
  assert.ok(norm.commitments.length < 73); // some resolved trimmed
  for (const o of openOld) {
    assert.ok(norm.commitments.some((c) => c.id === o.id), `open ${o.id} must survive the cap`);
  }
});

test("detectAbandonedThreads never under-reports via a negative silence (fallback considers commitments)", () => {
  const memory = makeDefaultOfficeHoursMemory({ now: NOW });
  memory.commitments = [
    { id: "a", cycle: 7, createdDay: 7, createdAt: NOW.toISOString(), text: "DM 5개", status: "open", evidence: null, origin: "user" },
  ];
  assert.equal(detectAbandonedThreads(memory, { currentCycle: 9 })[0].cyclesSilent, 2);
  // omitted currentCycle + empty cycle ledger -> no crash, no negative silence
  const fired = detectAbandonedThreads(memory, {});
  assert.ok(fired.every((t) => t.cyclesSilent >= 0));
});

test("detectAbandonedThreads fires at the threshold, silent below", () => {
  const memory = makeDefaultOfficeHoursMemory({ now: NOW });
  memory.commitments = [
    { id: "a", cycle: 7, createdDay: 7, createdAt: NOW.toISOString(), text: "DM 5개", status: "open", evidence: null, origin: "user" },
    { id: "b", cycle: 9, createdDay: 9, createdAt: NOW.toISOString(), text: "어제 약속", status: "open", evidence: null, origin: "user" },
  ];
  // current cycle 9: 'a' is 2 cycles silent (>= threshold), 'b' is 0 -> only 'a'
  const fired = detectAbandonedThreads(memory, { currentCycle: 9 });
  assert.equal(fired.length, 1);
  assert.equal(fired[0].text, "DM 5개");
  assert.equal(fired[0].cyclesSilent, 2);
  assert.equal(ABANDONED_THREAD_CYCLES, 2);
  // a met commitment with evidence never counts as abandoned
  memory.commitments[0].status = "met";
  memory.commitments[0].evidence = { kind: "url", url: "x", note: "", gradedCycle: 9, gradedAt: NOW.toISOString() };
  assert.equal(detectAbandonedThreads(memory, { currentCycle: 9 }).length, 0);
});

test("recompileCompiledTruth copies prior text into .previous (Supersedes analog)", async () => {
  const ws = await tempWorkspace();
  await appendCycle({ workspaceRoot: ws, cycle: 8, day: 11, step: "interview", outcome: "blocked", lastAssignment: "DM 보내기", now: NOW });
  const first = await recompileCompiledTruth({ workspaceRoot: ws, text: "Cycle 8 상태", now: NOW });
  assert.equal(first.compiledTruth.text, "Cycle 8 상태");
  assert.equal(first.compiledTruth.previous, null);
  const later = new Date("2026-06-09T09:00:00.000Z");
  const second = await recompileCompiledTruth({ workspaceRoot: ws, text: "Cycle 9 상태", now: later });
  assert.equal(second.compiledTruth.text, "Cycle 9 상태");
  assert.equal(second.compiledTruth.previous.text, "Cycle 8 상태");
  await fs.rm(ws, { recursive: true, force: true });
});

test("buildPriorCycle returns null on a cold brain, populated after a cycle", async () => {
  const ws = await tempWorkspace();
  const cold = buildPriorCycle(await loadOfficeHoursMemory({ workspaceRoot: ws, now: NOW }), { currentCycle: 1 });
  assert.equal(cold, null);

  await appendCommitment({ workspaceRoot: ws, text: "DM 5개", cycle: 8, day: 11, originText: "DM 보낼게", now: NOW });
  await appendCycle({ workspaceRoot: ws, cycle: 8, day: 11, step: "interview", outcome: "blocked", lastAssignment: "DM 5개", now: NOW });
  const later = new Date("2026-06-10T09:00:00.000Z");
  const warm = buildPriorCycle(await loadOfficeHoursMemory({ workspaceRoot: ws, now: later }), { currentCycle: 10 });
  assert.equal(warm.priorCycle, 8);
  assert.equal(warm.lastAssignment, "DM 5개");
  assert.equal(warm.lastOutcome, "blocked");
  assert.equal(warm.hasOpenCommitment, true);
  // 10 - 8 = 2 cycles silent -> surfaced
  assert.equal(warm.abandonedThreads.length, 1);
  await fs.rm(ws, { recursive: true, force: true });
});

test("timeline + cycles prune to MAX_* (oldest dropped), append-only", async () => {
  const huge = makeDefaultOfficeHoursMemory({ now: NOW });
  huge.timeline = Array.from({ length: MAX_TIMELINE_ENTRIES + 25 }, (_, i) => ({
    id: `tl-${i}`, date: NOW.toISOString(), cycle: 1, source: "interview", summary: `s${i}`, detail: "", origin: "system",
  }));
  huge.cycles = Array.from({ length: MAX_CYCLE_LEDGER + 12 }, (_, i) => ({
    cycle: i + 1, day: i + 1, date: NOW.toISOString(), step: "interview", outcome: "success", lastAssignment: "", note: "",
  }));
  const norm = normalizeOfficeHoursMemory(huge, { now: NOW });
  assert.equal(norm.timeline.length, MAX_TIMELINE_ENTRIES);
  assert.equal(norm.cycles.length, MAX_CYCLE_LEDGER);
  // oldest dropped -> the newest survive
  assert.equal(norm.timeline.at(-1).summary, `s${MAX_TIMELINE_ENTRIES + 24}`);
  assert.equal(norm.cycles.at(-1).cycle, MAX_CYCLE_LEDGER + 12);
});

test("migration: schemaVersion:0 / missing-field blob normalizes without throw and bumps to v1", () => {
  const legacy = {
    schemaVersion: 0,
    cycles: [{ cycle: 3, lastAssignment: "old" }, { junk: true }, null],
    commitments: [{ text: "keep me" }, {}],
    timeline: "not-an-array",
    compiledTruth: { text: "x".repeat(9000) }, // over cap
  };
  const norm = normalizeOfficeHoursMemory(legacy, { now: NOW });
  assert.equal(norm.schemaVersion, OFFICE_HOURS_MEMORY_SCHEMA_VERSION);
  assert.equal(norm.schema, OFFICE_HOURS_MEMORY_SCHEMA);
  assert.equal(norm.cycles.length, 1); // only the valid one survives
  assert.equal(norm.cycles[0].cycle, 3);
  assert.equal(norm.commitments.length, 1);
  assert.equal(norm.commitments[0].text, "keep me");
  assert.ok(Array.isArray(norm.timeline) && norm.timeline.length === 0);
  assert.ok(norm.compiledTruth.text.length <= 2000);
  // garbage input never throws
  assert.doesNotThrow(() => normalizeOfficeHoursMemory(null, { now: NOW }));
  assert.doesNotThrow(() => normalizeOfficeHoursMemory("nope", { now: NOW }));
  assert.doesNotThrow(() => normalizeOfficeHoursMemory(42, { now: NOW }));
});

test("injectable now: no wall-clock — timestamps derive from the injected now", async () => {
  const ws = await tempWorkspace();
  const fixed = new Date("2026-01-02T03:04:05.000Z");
  const saved = await appendCycle({ workspaceRoot: ws, cycle: 1, day: 1, step: "first_interview", outcome: "success", now: fixed });
  assert.equal(saved.updatedAt, fixed.toISOString());
  assert.equal(saved.cycles[0].date, fixed.toISOString());
  await fs.rm(ws, { recursive: true, force: true });
});

test("formatPriorCycleOpening: cold brain empty; warm opens with Cycle#N evidence demand + costume line", async () => {
  const ws = await tempWorkspace();
  assert.equal(formatPriorCycleOpening(null), ""); // cold brain renders clean-start upstream
  // warm: one blocked cycle + an open commitment 2 cycles silent
  await appendCommitment({ workspaceRoot: ws, text: "DM 5개 보내기", cycle: 8, day: 11, originText: "DM 보낼게", now: NOW });
  await appendCycle({ workspaceRoot: ws, cycle: 8, day: 11, step: "interview", outcome: "blocked", lastAssignment: "DM 5개 보내기", now: NOW });
  const later = new Date("2026-06-10T09:00:00.000Z");
  const prior = buildPriorCycle(await loadOfficeHoursMemory({ workspaceRoot: ws, now: later }), { currentCycle: 10 });
  const opening = formatPriorCycleOpening(prior);
  assert.ok(opening.includes("직전 사이클 회상 — Cycle 8"));
  assert.ok(opening.includes("DM 5개 보내기"));
  assert.ok(opening.includes("하드 증거")); // evidence demand
  assert.ok(opening.includes("코스튬")); // abandoned-thread detector fired (2 cycles silent)
  await fs.rm(ws, { recursive: true, force: true });
});

test("classifyInterviewGate: block-once-then-confession on interview/first_interview done", () => {
  assert.equal(classifyInterviewGate({ stepId: "goal", status: "done" }).mode, "passthrough");
  assert.equal(classifyInterviewGate({ stepId: "interview", status: "active" }).mode, "passthrough");
  assert.equal(classifyInterviewGate({ stepId: "interview", status: "done" }).mode, "block");
  assert.equal(classifyInterviewGate({ stepId: "first_interview", status: "done" }).mode, "block");
  assert.equal(classifyInterviewGate({ stepId: "interview", status: "done", commitmentText: "DM 5개" }).mode, "commit");
  assert.equal(classifyInterviewGate({ stepId: "first_interview", status: "done", confession: "오늘 못 보냄" }).mode, "confess");
  // a concrete commitment wins over a confession when both are present
  assert.equal(classifyInterviewGate({ stepId: "interview", status: "done", commitmentText: "DM", confession: "x" }).mode, "commit");
  assert.ok(isGatedInterviewStep("first_interview"));
  assert.ok(!isGatedInterviewStep("goal"));
});

test("summarizeOfficeHoursMemory yields the additive broadcast payload shape", async () => {
  const ws = await tempWorkspace();
  await appendCommitment({ workspaceRoot: ws, text: "DM 5개", cycle: 7, day: 9, originText: "보낼게", now: NOW });
  await recompileCompiledTruth({ workspaceRoot: ws, text: "현재 상태", now: NOW });
  const mem = await loadOfficeHoursMemory({ workspaceRoot: ws, now: NOW });
  const summary = summarizeOfficeHoursMemory(mem, { currentCycle: 9 });
  assert.equal(summary.compiledTruth, "현재 상태");
  assert.ok(summary.openThreads.includes("DM 5개"));
  assert.equal(summary.abandonedThreads.length, 1);
  // calibration-lite is additive: empty until a forecast is captured/graded.
  assert.equal(summary.calibrationLine, "");
  assert.equal(summary.pendingPrediction, "");
  await fs.rm(ws, { recursive: true, force: true });
});

// ── calibration-lite (predictions: capture → grade → "예측 적중 N/M") ─────────────

test("appendPrediction persists user-origin forecast as unresolved and round-trips", async () => {
  const ws = await tempWorkspace();
  const saved = await appendPrediction({
    workspaceRoot: ws,
    claim: "보낸 DM 5개 중 2개는 답이 올 거야",
    cycle: 9,
    originText: "내 예측: 5개 중 2개 답장",
    now: NOW,
  });
  assert.equal(saved.predictions.length, 1);
  assert.equal(saved.predictions[0].verdict, "unresolved");
  assert.equal(saved.predictions[0].origin, "user");
  assert.equal(saved.predictions[0].cycle, 9);
  const loaded = await loadOfficeHoursMemory({ workspaceRoot: ws, now: NOW });
  assert.deepEqual(loaded.predictions, saved.predictions);
  await fs.rm(ws, { recursive: true, force: true });
});

test("appendPrediction is user-origin gated (no model/tool fabrication)", async () => {
  const ws = await tempWorkspace();
  await assert.rejects(
    () => appendPrediction({ workspaceRoot: ws, claim: "x", cycle: 1, originText: "", now: NOW }),
    /user-origin gate/,
  );
  await fs.rm(ws, { recursive: true, force: true });
});

test("gradePrediction sets a resolved verdict + gradedCycle; rejects unresolved/unknown", async () => {
  const ws = await tempWorkspace();
  const saved = await appendPrediction({
    workspaceRoot: ws, claim: "2개 답장", cycle: 9, originText: "예측", now: NOW,
  });
  const id = saved.predictions[0].id;
  const { memory, graded } = await gradePrediction({
    workspaceRoot: ws, predictionId: id, verdict: "incorrect", gradedCycle: 10, now: NOW,
  });
  assert.equal(graded, true);
  assert.equal(memory.predictions[0].verdict, "incorrect");
  assert.equal(memory.predictions[0].gradedCycle, 10);
  // "unresolved" is the open state and cannot be set as a grade
  await assert.rejects(
    () => gradePrediction({ workspaceRoot: ws, predictionId: id, verdict: "unresolved", now: NOW }),
    /verdict must be one of/,
  );
  // unknown id throws
  await assert.rejects(
    () => gradePrediction({ workspaceRoot: ws, predictionId: "pr-nope", verdict: "correct", now: NOW }),
    /unknown prediction/,
  );
  await fs.rm(ws, { recursive: true, force: true });
});

test("latestUnresolvedPrediction picks the most recent open forecast only", async () => {
  const ws = await tempWorkspace();
  await appendPrediction({ workspaceRoot: ws, claim: "예측 A", cycle: 7, originText: "a", now: NOW });
  const second = await appendPrediction({ workspaceRoot: ws, claim: "예측 B", cycle: 9, originText: "b", now: NOW });
  // grade the older one — it must drop out of "latest unresolved"
  const aId = second.predictions.find((p) => p.cycle === 7).id;
  await gradePrediction({ workspaceRoot: ws, predictionId: aId, verdict: "correct", gradedCycle: 9, now: NOW });
  const mem = await loadOfficeHoursMemory({ workspaceRoot: ws, now: NOW });
  const pending = latestUnresolvedPrediction(mem);
  assert.equal(pending.claim, "예측 B");
  assert.equal(latestUnresolvedPrediction({ predictions: [] }), null);
  await fs.rm(ws, { recursive: true, force: true });
});

test("summarizePredictionCalibration is a simple count with DESIGN-voice line", () => {
  // nothing graded yet → empty surface (hidden on cold/partial brains)
  assert.deepEqual(
    summarizePredictionCalibration({ predictions: [{ verdict: "unresolved" }] }),
    { total: 0, correct: 0, missed: 0, line: "" },
  );
  // 1 correct of 3 graded (partial counts as a miss — simple count, not Brier)
  const mixed = summarizePredictionCalibration({
    predictions: [
      { verdict: "correct" },
      { verdict: "incorrect" },
      { verdict: "partial" },
      { verdict: "unresolved" },
    ],
  });
  assert.equal(mixed.total, 3);
  assert.equal(mixed.correct, 1);
  assert.equal(mixed.missed, 2);
  assert.match(mixed.line, /예측 적중 1\/3/);
  assert.match(mixed.line, /2개 빗나갔어/);
  // a perfect run uses the encouraging branch, never the miss branch
  const clean = summarizePredictionCalibration({ predictions: [{ verdict: "correct" }, { verdict: "correct" }] });
  assert.match(clean.line, /예측 적중 2\/2/);
  assert.doesNotMatch(clean.line, /빗나/);
});

test("summarizeOfficeHoursMemory surfaces calibrationLine + pendingPrediction end-to-end", async () => {
  const ws = await tempWorkspace();
  // cycle 9: capture a forecast → it is the pending prediction, nothing graded yet
  await appendPrediction({ workspaceRoot: ws, claim: "5개 중 2개 답장", cycle: 9, originText: "예측", now: NOW });
  let mem = await loadOfficeHoursMemory({ workspaceRoot: ws, now: NOW });
  let summary = summarizeOfficeHoursMemory(mem, { currentCycle: 9 });
  assert.equal(summary.calibrationLine, "");
  assert.equal(summary.pendingPrediction, "5개 중 2개 답장");
  // cycle 10: grade it incorrect → calibration line appears, pending clears
  const pending = latestUnresolvedPrediction(mem);
  await gradePrediction({ workspaceRoot: ws, predictionId: pending.id, verdict: "incorrect", gradedCycle: 10, now: NOW });
  mem = await loadOfficeHoursMemory({ workspaceRoot: ws, now: NOW });
  summary = summarizeOfficeHoursMemory(mem, { currentCycle: 10 });
  assert.match(summary.calibrationLine, /예측 적중 0\/1/);
  assert.equal(summary.pendingPrediction, "");
  await fs.rm(ws, { recursive: true, force: true });
});
