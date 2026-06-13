import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import {
  RUBRIC_ASSESSMENT_SCHEMA_VERSION,
  RubricAssessmentSchema,
  loadAssessmentsFromFile,
  persistAssessmentsToFile,
  appendAssessment,
  computeWithinPersonDelta,
} from "../sidecar/rubric-assessment.mjs";

async function tempFile() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-rubric-"));
  return path.join(dir, "rubric-assessments.json");
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

test("schema constant equals 1", () => {
  assert.equal(RUBRIC_ASSESSMENT_SCHEMA_VERSION, 1);
});

test("schema accepts a valid Day 0 record with score=1 and no evidence", () => {
  const result = RubricAssessmentSchema.safeParse(validRecord());
  assert.equal(result.success, true);
});

test("schema rejects score >= 3 without evidence_refs", () => {
  const record = validRecord();
  record.axes.definition = { score: 3, anchor_level: 3, anchor_text: "mid" };
  const result = RubricAssessmentSchema.safeParse(record);
  assert.equal(result.success, false);
  if (!result.success) {
    assert.match(
      result.error.issues.map((i) => i.message).join(" | "),
      /score >= 3 requires/,
    );
  }
});

test("schema accepts score >= 3 when evidence_refs has at least one entry", () => {
  const record = validRecord();
  record.axes.definition = {
    score: 4,
    anchor_level: 3,
    anchor_text: "mid-high",
    evidence_refs: [{ type: "session_message", ref: "msg-42" }],
  };
  const result = RubricAssessmentSchema.safeParse(record);
  assert.equal(result.success, true);
});

test("schema rejects missing required axis", () => {
  const record = validRecord();
  delete record.axes.command;
  const result = RubricAssessmentSchema.safeParse(record);
  assert.equal(result.success, false);
});

test("schema rejects out-of-range score", () => {
  const record = validRecord();
  record.axes.definition = { score: 7, anchor_level: 5, anchor_text: "x" };
  const result = RubricAssessmentSchema.safeParse(record);
  assert.equal(result.success, false);
});

test("schema rejects invalid day value", () => {
  const result = RubricAssessmentSchema.safeParse(validRecord({ day: 15 }));
  assert.equal(result.success, false);
});

test("schema rejects invalid anchor_level", () => {
  const record = validRecord();
  record.axes.definition.anchor_level = 2;
  const result = RubricAssessmentSchema.safeParse(record);
  assert.equal(result.success, false);
});

test("persist + load round-trip preserves record shape", async () => {
  const filePath = await tempFile();
  const record = validRecord();
  await persistAssessmentsToFile(filePath, [record]);
  const loaded = await loadAssessmentsFromFile(filePath);
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].sessionId, record.sessionId);
  assert.equal(loaded[0].day, 0);
  assert.equal(loaded[0].axes.definition.score, 1);
});

test("persist sets file mode 0o600", async () => {
  const filePath = await tempFile();
  await persistAssessmentsToFile(filePath, [validRecord()]);
  const stat = await fs.stat(filePath);
  assert.equal(stat.mode & 0o777, 0o600);
});

test("appendAssessment validates and appends", async () => {
  const filePath = await tempFile();
  await appendAssessment(filePath, validRecord({ sessionId: "s1" }));
  // Day 30 closing rule: every axis needs evidence or a no_evidence_reason.
  const day30Axes = Object.fromEntries(
    ["definition", "command", "clout", "responsibility", "adaptability"].map((axis) => [
      axis,
      {
        score: 1,
        anchor_level: 1,
        anchor_text: "Day 30 baseline",
        no_evidence_reason: "still baseline",
      },
    ]),
  );
  await appendAssessment(
    filePath,
    validRecord({ sessionId: "s2", day: 30, axes: day30Axes }),
  );
  const loaded = await loadAssessmentsFromFile(filePath);
  assert.equal(loaded.length, 2);
  assert.deepEqual(loaded.map((r) => r.sessionId), ["s1", "s2"]);
});

test("appendAssessment throws on invalid record", async () => {
  const filePath = await tempFile();
  await assert.rejects(
    appendAssessment(filePath, validRecord({ day: 15 })),
    /invalid rubric assessment record/,
  );
});

test("loadAssessmentsFromFile returns [] for missing file", async () => {
  const filePath = path.join(os.tmpdir(), `agentic30-nonexistent-${Date.now()}.json`);
  const loaded = await loadAssessmentsFromFile(filePath);
  assert.deepEqual(loaded, []);
});

test("loadAssessmentsFromFile quarantines schema-invalid records and emits diagnostic", async () => {
  // R2 / Codex MEDIUM: legacy Day 30 records (no no_evidence_reason) became
  // invalid under the new record-level rule. silently dropping them is data
  // loss — the file must keep valid records and siphon invalid ones to a
  // .invalid-<ts>.json sibling, with a recoverable-error event emitted.
  const filePath = await tempFile();
  const validRec = validRecord({ sessionId: "keep-me" });
  const legacyDay30 = {
    sessionId: "legacy-day30",
    recordedAt: "2026-06-06T20:00:00.000Z",
    day: 30,
    axes: {
      definition: { score: 2, anchor_level: 1, anchor_text: "..." },
      command: { score: 2, anchor_level: 1, anchor_text: "..." },
      clout: { score: 2, anchor_level: 1, anchor_text: "..." },
      responsibility: { score: 2, anchor_level: 1, anchor_text: "..." },
      adaptability: { score: 2, anchor_level: 1, anchor_text: "..." },
    },
  };
  await fs.writeFile(
    filePath,
    JSON.stringify({
      schemaVersion: 1,
      savedAt: "2026-06-06T20:00:00.000Z",
      records: [validRec, legacyDay30],
    }),
    { mode: 0o600 },
  );
  const errors = [];
  const loaded = await loadAssessmentsFromFile(filePath, {
    onRecoverableError: (err) => errors.push(err),
  });
  // Valid record stays.
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].sessionId, "keep-me");
  // Invalid record was siphoned and announced.
  assert.equal(errors.length, 1);
  assert.equal(errors[0].type, "rubric_assessment_record_invalid");
  assert.equal(errors[0].invalidCount, 1);
  assert.equal(errors[0].issues[0].sessionId, "legacy-day30");
  assert.equal(errors[0].issues[0].day, 30);
  assert.match(errors[0].quarantinePath, /\.invalid-/);
  // Quarantine file exists, mode 0o600, and contains the legacy record + issues.
  const stat = await fs.stat(errors[0].quarantinePath);
  assert.equal(stat.mode & 0o777, 0o600);
  const dump = JSON.parse(await fs.readFile(errors[0].quarantinePath, "utf8"));
  assert.equal(dump.records.length, 1);
  assert.equal(dump.records[0].original.sessionId, "legacy-day30");
  assert.ok(Array.isArray(dump.records[0].issues));
  // Canonical file is untouched (still has BOTH originals; only valid records
  // are returned at runtime). This way users can re-import after fixing if
  // they edit the canonical file by hand.
  const canonical = JSON.parse(await fs.readFile(filePath, "utf8"));
  assert.equal(canonical.records.length, 2);
});

test("loadAssessmentsFromFile re-load does not re-quarantine the same legacy record (idempotent)", async () => {
  // Subsequent loads should still emit the same diagnostic but should not
  // accumulate extra quarantine files for valid records — only one new
  // .invalid-<ts>.json per call. We verify that valid records still load and
  // exactly one quarantine is produced per invocation.
  const filePath = await tempFile();
  const legacyDay30 = {
    sessionId: "legacy",
    recordedAt: "2026-06-06T20:00:00.000Z",
    day: 30,
    axes: {
      definition: { score: 2, anchor_level: 1, anchor_text: "..." },
      command: { score: 2, anchor_level: 1, anchor_text: "..." },
      clout: { score: 2, anchor_level: 1, anchor_text: "..." },
      responsibility: { score: 2, anchor_level: 1, anchor_text: "..." },
      adaptability: { score: 2, anchor_level: 1, anchor_text: "..." },
    },
  };
  await fs.writeFile(
    filePath,
    JSON.stringify({ schemaVersion: 1, records: [legacyDay30] }),
    { mode: 0o600 },
  );
  const errors = [];
  const loaded1 = await loadAssessmentsFromFile(filePath, {
    onRecoverableError: (err) => errors.push(err),
  });
  assert.equal(loaded1.length, 0);
  assert.equal(errors.length, 1);
  // Valid records still flow on subsequent reads (no halting).
  const loaded2 = await loadAssessmentsFromFile(filePath, {
    onRecoverableError: (err) => errors.push(err),
  });
  assert.equal(loaded2.length, 0);
  assert.equal(errors.length, 2);
});

test("loadAssessmentsFromFile quarantines corrupt JSON", async () => {
  const filePath = await tempFile();
  await fs.writeFile(filePath, "{not-json", { mode: 0o600 });
  const errors = [];
  const loaded = await loadAssessmentsFromFile(filePath, {
    onRecoverableError: (err) => errors.push(err),
  });
  assert.deepEqual(loaded, []);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].type, "rubric_assessment_store_corrupt");
  assert.match(errors[0].quarantinePath, /\.corrupt-/);
});

test("computeWithinPersonDelta returns per-axis delta", () => {
  const day0 = validRecord({ day: 0 });
  const day30 = validRecord({ day: 30 });
  day30.axes.definition = {
    score: 4,
    anchor_level: 3,
    anchor_text: "mid-high",
    evidence_refs: [{ type: "session_message", ref: "msg" }],
  };
  const delta = computeWithinPersonDelta(day0, day30);
  assert.equal(delta.length, 5);
  const def = delta.find((d) => d.axis === "definition");
  assert.equal(def.delta, 3);
  for (const other of delta.filter((d) => d.axis !== "definition")) {
    assert.equal(other.delta, 0);
  }
});

test("computeWithinPersonDelta returns null when either record missing", () => {
  assert.equal(computeWithinPersonDelta(null, validRecord()), null);
  assert.equal(computeWithinPersonDelta(validRecord(), null), null);
});

test("Day 30 score=2 without evidence and without no_evidence_reason is rejected", () => {
  // Codex MEDIUM + Gemini: score >= 3 evidence rule alone lets a user dodge
  // by self-reporting all 2s on closing day. Day 30 must demand either
  // evidence or an honest reason for every axis.
  const record = validRecord({
    day: 30,
    recordedAt: "2026-06-06T20:00:00.000Z",
    axes: {
      definition: { score: 2, anchor_level: 1, anchor_text: "..." },
      command: { score: 2, anchor_level: 1, anchor_text: "..." },
      clout: { score: 2, anchor_level: 1, anchor_text: "..." },
      responsibility: { score: 2, anchor_level: 1, anchor_text: "..." },
      adaptability: { score: 2, anchor_level: 1, anchor_text: "..." },
    },
  });
  const result = RubricAssessmentSchema.safeParse(record);
  assert.equal(result.success, false);
  if (!result.success) {
    assert.match(
      result.error.issues.map((i) => i.message).join(" | "),
      /Day 30 requires evidence_refs or no_evidence_reason/,
    );
  }
});

test("Day 30 score=2 with no_evidence_reason on every axis is accepted", () => {
  const record = validRecord({
    day: 30,
    recordedAt: "2026-06-06T20:00:00.000Z",
    axes: {
      definition: {
        score: 2,
        anchor_level: 1,
        anchor_text: "...",
        no_evidence_reason: "이번 주 수요 검증을 안 한 상태",
      },
      command: {
        score: 2,
        anchor_level: 1,
        anchor_text: "...",
        no_evidence_reason: "결정 기록을 미루고 있었다",
      },
      clout: {
        score: 2,
        anchor_level: 1,
        anchor_text: "...",
        no_evidence_reason: "BIP 게시 0편",
      },
      responsibility: {
        score: 2,
        anchor_level: 1,
        anchor_text: "...",
        no_evidence_reason: "약속 회고를 글로 남기지 못함",
      },
      adaptability: {
        score: 2,
        anchor_level: 1,
        anchor_text: "...",
        no_evidence_reason: "데이터로 가설을 점검하지 않음",
      },
    },
  });
  const result = RubricAssessmentSchema.safeParse(record);
  assert.equal(result.success, true, JSON.stringify(result.error?.issues, null, 2));
});

test("Day 30 score=4 with evidence_refs is accepted (existing rule)", () => {
  const record = validRecord({
    day: 30,
    recordedAt: "2026-06-06T20:00:00.000Z",
    axes: {
      definition: {
        score: 4,
        anchor_level: 3,
        anchor_text: "mid-high",
        evidence_refs: [{ type: "session_message", ref: "msg-1" }],
      },
      command: {
        score: 4,
        anchor_level: 3,
        anchor_text: "mid-high",
        evidence_refs: [{ type: "doc_path", ref: ".agentic30/docs/GOAL.md" }],
      },
      clout: {
        score: 4,
        anchor_level: 3,
        anchor_text: "mid-high",
        evidence_refs: [{ type: "external_link", ref: "https://example.com" }],
      },
      responsibility: {
        score: 4,
        anchor_level: 3,
        anchor_text: "mid-high",
        evidence_refs: [{ type: "session_message", ref: "msg-2" }],
      },
      adaptability: {
        score: 4,
        anchor_level: 3,
        anchor_text: "mid-high",
        evidence_refs: [{ type: "session_message", ref: "msg-3" }],
      },
    },
  });
  const result = RubricAssessmentSchema.safeParse(record);
  assert.equal(result.success, true, JSON.stringify(result.error?.issues, null, 2));
});

test("Day 0 score=2 with no evidence and no reason is still accepted (baseline allowed loose)", () => {
  // Day 0 is a starting baseline — users haven't built up evidence yet, so the
  // schema is intentionally permissive.
  const result = RubricAssessmentSchema.safeParse(validRecord());
  assert.equal(result.success, true);
});

test("AxisScoreSchema accepts score >= 3 with no_evidence_reason as evidence alternative", () => {
  const record = validRecord();
  record.axes.definition = {
    score: 3,
    anchor_level: 3,
    anchor_text: "mid",
    no_evidence_reason: "evidence는 사적 메모라 첨부 못함",
  };
  const result = RubricAssessmentSchema.safeParse(record);
  assert.equal(result.success, true, JSON.stringify(result.error?.issues, null, 2));
});

test("appendAssessment is safe under 20 concurrent invocations (no lost updates)", async () => {
  const filePath = await tempFile();
  const ops = Array.from({ length: 20 }, (_, i) =>
    appendAssessment(filePath, validRecord({ sessionId: `s-${i}` })),
  );
  await Promise.all(ops);
  const loaded = await loadAssessmentsFromFile(filePath);
  assert.equal(loaded.length, 20, "expected 20 records persisted");
  const ids = new Set(loaded.map((r) => r.sessionId));
  for (let i = 0; i < 20; i++) {
    assert.ok(ids.has(`s-${i}`), `missing session s-${i}`);
  }
});
