import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import {
  RUBRIC_ASSESSMENT_FILE,
  TELEMETRY_EVENT_RECORDED,
  getRubricAssessmentPath,
  recordRubricAssessment,
  recordFlatRubricAssessment,
  getRubricStatus,
} from "../sidecar/rubric-assessment-host.mjs";

async function tempWorkspace() {
  return fs.mkdtemp(path.join(os.tmpdir(), "agentic30-host-"));
}

function validRecord(overrides = {}) {
  return {
    sessionId: "session-1",
    recordedAt: "2026-05-07T20:00:00.000Z",
    day: 0,
    axes: {
      definition: { score: 1, anchor_level: 1, anchor_text: "Day 0 baseline" },
      command: { score: 1, anchor_level: 1, anchor_text: "Day 0 baseline" },
      clout: { score: 1, anchor_level: 1, anchor_text: "Day 0 baseline" },
      responsibility: { score: 1, anchor_level: 1, anchor_text: "Day 0 baseline" },
      adaptability: { score: 1, anchor_level: 1, anchor_text: "Day 0 baseline" },
    },
    ...overrides,
  };
}

test("getRubricAssessmentPath joins workspace + canonical relative path", () => {
  const p = getRubricAssessmentPath("/tmp/ws");
  assert.equal(p, path.join("/tmp/ws", RUBRIC_ASSESSMENT_FILE));
});

test("getRubricAssessmentPath throws without workspaceRoot", () => {
  assert.throws(() => getRubricAssessmentPath(undefined), /requires workspaceRoot/);
});

test("recordRubricAssessment persists, returns saved record + path", async () => {
  const ws = await tempWorkspace();
  const result = await recordRubricAssessment({
    workspaceRoot: ws,
    record: validRecord(),
  });
  assert.equal(result.filePath, path.join(ws, RUBRIC_ASSESSMENT_FILE));
  assert.equal(result.record.day, 0);
  assert.equal(result.record.sessionId, "session-1");
  // File actually exists.
  const stat = await fs.stat(result.filePath);
  assert.ok(stat.isFile());
});

test("recordRubricAssessment emits telemetry with axis_count + day, no raw scores", async () => {
  const ws = await tempWorkspace();
  const events = [];
  const telemetry = {
    captureEvent: (event, props) => events.push({ event, props }),
  };
  await recordRubricAssessment({
    workspaceRoot: ws,
    record: validRecord(),
    telemetry,
  });
  assert.equal(events.length, 1);
  assert.equal(events[0].event, TELEMETRY_EVENT_RECORDED);
  assert.deepEqual(Object.keys(events[0].props).sort(), ["axis_count", "day"]);
  assert.equal(events[0].props.day, 0);
  assert.equal(events[0].props.axis_count, 5);
  // Critical: telemetry must NOT carry raw scores or evidence text.
  assert.equal(events[0].props.scores, undefined);
  assert.equal(events[0].props.evidence_refs, undefined);
  assert.equal(events[0].props.sessionId, undefined);
});

test("recordRubricAssessment survives telemetry exception", async () => {
  const ws = await tempWorkspace();
  const telemetry = {
    captureEvent: () => {
      throw new Error("telemetry boom");
    },
  };
  const result = await recordRubricAssessment({
    workspaceRoot: ws,
    record: validRecord(),
    telemetry,
  });
  assert.equal(result.record.day, 0);
});

test("recordRubricAssessment without workspaceRoot throws before persistence", async () => {
  await assert.rejects(
    recordRubricAssessment({ record: validRecord() }),
    /requires workspaceRoot/,
  );
});

test("recordRubricAssessment validates the record (rejects invalid day)", async () => {
  const ws = await tempWorkspace();
  await assert.rejects(
    recordRubricAssessment({ workspaceRoot: ws, record: validRecord({ day: 99 }) }),
    /invalid rubric assessment record/,
  );
});

test("getRubricStatus returns nulls for empty workspace", async () => {
  const ws = await tempWorkspace();
  const status = await getRubricStatus(ws);
  assert.equal(status.dayZero, null);
  assert.equal(status.dayThirty, null);
  assert.equal(status.delta, null);
  assert.equal(status.recordCount, 0);
});

test("getRubricStatus picks the latest record per day and computes delta", async () => {
  const ws = await tempWorkspace();
  await recordRubricAssessment({
    workspaceRoot: ws,
    record: validRecord({ sessionId: "s1", day: 0 }),
  });
  await recordRubricAssessment({
    workspaceRoot: ws,
    record: validRecord({
      sessionId: "s1",
      day: 30,
      recordedAt: "2026-06-06T20:00:00.000Z",
      axes: {
        definition: {
          score: 4,
          anchor_level: 3,
          anchor_text: "evidence-anchored",
          evidence_refs: [{ type: "session_message", ref: "msg-1" }],
        },
        // Day 30 closing rule: every axis must justify itself (evidence or
        // no_evidence_reason). These low-score axes use the reason path.
        command: {
          score: 1,
          anchor_level: 1,
          anchor_text: "...",
          no_evidence_reason: "still baseline",
        },
        clout: {
          score: 1,
          anchor_level: 1,
          anchor_text: "...",
          no_evidence_reason: "still baseline",
        },
        responsibility: {
          score: 1,
          anchor_level: 1,
          anchor_text: "...",
          no_evidence_reason: "still baseline",
        },
        adaptability: {
          score: 1,
          anchor_level: 1,
          anchor_text: "...",
          no_evidence_reason: "still baseline",
        },
      },
    }),
  });
  const status = await getRubricStatus(ws);
  assert.equal(status.recordCount, 2);
  assert.equal(status.dayZero.day, 0);
  assert.equal(status.dayThirty.day, 30);
  assert.equal(status.delta.length, 5);
  const def = status.delta.find((d) => d.axis === "definition");
  assert.equal(def.delta, 3);
});

test("getRubricStatus returns null delta when only Day 0 exists", async () => {
  const ws = await tempWorkspace();
  await recordRubricAssessment({ workspaceRoot: ws, record: validRecord() });
  const status = await getRubricStatus(ws);
  assert.equal(status.dayZero.day, 0);
  assert.equal(status.dayThirty, null);
  assert.equal(status.delta, null);
});

test("recordFlatRubricAssessment hydrates flat input with anchor_text + level", async () => {
  const ws = await tempWorkspace();
  const result = await recordFlatRubricAssessment({
    workspaceRoot: ws,
    sessionId: "flat-1",
    day: 0,
    axes: { definition: 1, command: 1, clout: 1, responsibility: 1, adaptability: 1 },
  });
  assert.equal(result.record.day, 0);
  assert.equal(result.record.sessionId, "flat-1");
  assert.equal(result.record.axes.definition.score, 1);
  assert.equal(result.record.axes.definition.anchor_level, 1);
  assert.equal(typeof result.record.axes.definition.anchor_text, "string");
  assert.ok(result.record.axes.definition.anchor_text.length > 10);
});

test("recordFlatRubricAssessment maps score 4 to anchor_level 3", async () => {
  const ws = await tempWorkspace();
  const result = await recordFlatRubricAssessment({
    workspaceRoot: ws,
    sessionId: "flat-2",
    day: 0,
    axes: { definition: 4, command: 1, clout: 1, responsibility: 1, adaptability: 1 },
    evidence: { definition: [{ type: "session_message", ref: "msg-1" }] },
  });
  assert.equal(result.record.axes.definition.anchor_level, 3);
  assert.equal(result.record.axes.definition.evidence_refs.length, 1);
});

test("recordFlatRubricAssessment throws if any axis score is missing", async () => {
  const ws = await tempWorkspace();
  await assert.rejects(
    recordFlatRubricAssessment({
      workspaceRoot: ws,
      sessionId: "flat-3",
      day: 0,
      axes: { definition: 1, command: 1 },
    }),
    /missing scores/,
  );
});

test("getRubricStatus picks latest by Date.parse, not string sort", async () => {
  // Codex LOW review: prior implementation used localeCompare on ISO strings,
  // which only happens to match wall-clock order for plain UTC timestamps in
  // the same calendar. This case writes two records whose textual sort order
  // disagrees with their actual instant — `+05:00` zone makes the lexically
  // larger string the chronologically older record.
  const ws = await tempWorkspace();
  // Record A: textually larger ("2026-12-15T23:..." starts higher), but the
  // +05:00 offset means the actual instant is 2026-12-15T18:00:00Z.
  await recordRubricAssessment({
    workspaceRoot: ws,
    record: validRecord({
      sessionId: "older-but-lex-larger",
      day: 0,
      recordedAt: "2026-12-15T23:00:00.000+05:00",
    }),
  });
  // Record B: textually smaller ("2026-12-15T20:..."), but instant is
  // 2026-12-15T20:00:00Z — i.e. two hours LATER than record A.
  await recordRubricAssessment({
    workspaceRoot: ws,
    record: validRecord({
      sessionId: "newer-but-lex-smaller",
      day: 0,
      recordedAt: "2026-12-15T20:00:00.000Z",
    }),
  });
  const status = await getRubricStatus(ws);
  assert.equal(status.recordCount, 2);
  // Date.parse picks the chronologically latest instant; string sort would
  // pick "older-but-lex-larger" instead.
  assert.equal(status.dayZero.sessionId, "newer-but-lex-smaller");
});

test("recordFlatRubricAssessment passes evidence_refs through to all axes", async () => {
  const ws = await tempWorkspace();
  const result = await recordFlatRubricAssessment({
    workspaceRoot: ws,
    sessionId: "flat-4",
    day: 30,
    axes: { definition: 5, command: 5, clout: 5, responsibility: 5, adaptability: 5 },
    evidence: {
      definition: [{ type: "session_message", ref: "m1" }],
      command: [{ type: "doc_path", ref: "docs/GOAL.md" }],
      clout: [{ type: "external_link", ref: "https://example.com" }],
      responsibility: [{ type: "session_message", ref: "m2" }],
      adaptability: [{ type: "session_message", ref: "m3" }],
    },
  });
  assert.equal(result.record.day, 30);
  assert.equal(result.record.axes.definition.evidence_refs.length, 1);
  assert.equal(result.record.axes.command.evidence_refs[0].type, "doc_path");
  assert.equal(result.record.axes.clout.evidence_refs[0].type, "external_link");
});
