import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import {
  assertInsideWorkspace,
  buildAutoSuggestProposal,
  listQuarantinedFiles,
  proposeFixForEntry,
  pruneExpiredQuarantineFiles,
  readQuarantineDump,
  restoreQuarantinedRecord,
} from "../sidecar/quarantine-recovery.mjs";
import {
  loadAssessmentsFromFile,
} from "../sidecar/rubric-assessment.mjs";

async function tempWorkspace() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-quar-"));
  const agentic = path.join(root, ".agentic30");
  await fs.mkdir(agentic, { recursive: true });
  return { root, agentic };
}

function legacyDay30Record(overrides = {}) {
  return {
    sessionId: "legacy-1",
    recordedAt: "2026-06-06T20:00:00.000Z",
    day: 30,
    axes: {
      definition: { score: 2, anchor_level: 1, anchor_text: "..." },
      command: { score: 2, anchor_level: 1, anchor_text: "..." },
      clout: { score: 2, anchor_level: 1, anchor_text: "..." },
      responsibility: { score: 2, anchor_level: 1, anchor_text: "..." },
      adaptability: { score: 2, anchor_level: 1, anchor_text: "..." },
    },
    ...overrides,
  };
}

async function writeQuarantineDump(quarantinePath, sourceFile, records) {
  const payload = {
    schemaVersion: 1,
    quarantinedAt: "2026-05-08T01:00:00.000Z",
    sourceFile,
    records,
  };
  await fs.writeFile(quarantinePath, JSON.stringify(payload, null, 2), { mode: 0o600 });
}

test("listQuarantinedFiles returns [] when .agentic30 is missing", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-quar-empty-"));
  const files = await listQuarantinedFiles({ workspaceRoot: root });
  assert.deepEqual(files, []);
});

test("listQuarantinedFiles only matches .invalid-* files (ignores .corrupt-* and others)", async () => {
  const { root, agentic } = await tempWorkspace();
  await fs.writeFile(path.join(agentic, "rubric-assessments.json.invalid-2026-05-08T01-00.json"), "{\"records\":[]}");
  await fs.writeFile(path.join(agentic, "rubric-assessments.json.corrupt-2026-05-08T02-00"), "{junk");
  await fs.writeFile(path.join(agentic, "rubric-assessments.json"), "{}");
  const files = await listQuarantinedFiles({ workspaceRoot: root });
  assert.equal(files.length, 1);
  assert.match(files[0].name, /\.invalid-/);
});

test("readQuarantineDump exposes records with mtimeMs ETag and proposal field", async () => {
  const { root, agentic } = await tempWorkspace();
  const sourceFile = path.join(agentic, "rubric-assessments.json");
  const quarantinePath = path.join(agentic, "rubric-assessments.json.invalid-2026-05-08T01-00.json");
  await writeQuarantineDump(quarantinePath, sourceFile, [
    {
      original: legacyDay30Record(),
      issues: [
        { path: ["axes", "clout", "evidence_refs"], message: "Day 30 requires evidence_refs or no_evidence_reason" },
      ],
    },
  ]);
  const dump = await readQuarantineDump({ workspaceRoot: root, quarantinePath });
  assert.equal(dump.sourceFile, sourceFile);
  assert.equal(typeof dump.mtimeMs, "number");
  assert.equal(dump.records.length, 1);
  assert.equal(dump.records[0].index, 0);
  // Auto-suggest proposal hooked from issue path/message.
  assert.equal(dump.records[0].proposal?.kind, "missing_no_evidence_reason");
  assert.equal(dump.records[0].proposal?.axis, "clout");
});

test("restoreQuarantinedRecord rejects fixedRecord that still fails schema", async () => {
  const { root, agentic } = await tempWorkspace();
  const sourceFile = path.join(agentic, "rubric-assessments.json");
  const quarantinePath = path.join(agentic, "rubric-assessments.json.invalid-2026-05-08T01-00.json");
  await writeQuarantineDump(quarantinePath, sourceFile, [{ original: legacyDay30Record(), issues: [] }]);
  await assert.rejects(
    restoreQuarantinedRecord({
      workspaceRoot: root,
      quarantinePath,
      recordIndex: 0,
      fixedRecord: { day: 99 },
    }),
    /still invalid/,
  );
});

test("restoreQuarantinedRecord enforces optimistic concurrency via expectedMtimeMs", async () => {
  const { root, agentic } = await tempWorkspace();
  const sourceFile = path.join(agentic, "rubric-assessments.json");
  const quarantinePath = path.join(agentic, "rubric-assessments.json.invalid-2026-05-08T01-00.json");
  await writeQuarantineDump(quarantinePath, sourceFile, [{ original: legacyDay30Record(), issues: [] }]);
  const fixed = { ...legacyDay30Record(), axes: { ...legacyDay30Record().axes } };
  for (const axis of Object.keys(fixed.axes)) {
    fixed.axes[axis] = { ...fixed.axes[axis], no_evidence_reason: "still baseline" };
  }
  // Stale ETag: pass a deliberately-wrong mtime.
  await assert.rejects(
    restoreQuarantinedRecord({
      workspaceRoot: root,
      quarantinePath,
      recordIndex: 0,
      fixedRecord: fixed,
      expectedMtimeMs: 1, // any value that won't match
    }),
    /changed since list|refresh and retry/,
  );
});

test("restoreQuarantinedRecord consumes the entry, deletes the file when empty, and appends to canonical store", async () => {
  const { root, agentic } = await tempWorkspace();
  const sourceFile = path.join(agentic, "rubric-assessments.json");
  // Seed canonical file with one valid record so we can verify append.
  const validValid = {
    schemaVersion: 1,
    savedAt: "2026-05-08T00:00:00.000Z",
    records: [
      {
        sessionId: "preexisting",
        recordedAt: "2026-05-07T10:00:00.000Z",
        day: 0,
        axes: {
          definition: { score: 1, anchor_level: 1, anchor_text: "Day 0" },
          command: { score: 1, anchor_level: 1, anchor_text: "Day 0" },
          clout: { score: 1, anchor_level: 1, anchor_text: "Day 0" },
          responsibility: { score: 1, anchor_level: 1, anchor_text: "Day 0" },
          adaptability: { score: 1, anchor_level: 1, anchor_text: "Day 0" },
        },
      },
    ],
  };
  await fs.writeFile(sourceFile, JSON.stringify(validValid), { mode: 0o600 });

  const quarantinePath = path.join(agentic, "rubric-assessments.json.invalid-2026-05-08T01-00.json");
  await writeQuarantineDump(quarantinePath, sourceFile, [
    { original: legacyDay30Record({ sessionId: "to-restore" }), issues: [] },
  ]);

  const fixed = legacyDay30Record({ sessionId: "to-restore" });
  for (const axis of Object.keys(fixed.axes)) {
    fixed.axes[axis] = { ...fixed.axes[axis], no_evidence_reason: "honest mode" };
  }
  const result = await restoreQuarantinedRecord({
    workspaceRoot: root,
    quarantinePath,
    recordIndex: 0,
    fixedRecord: fixed,
  });
  assert.equal(result.restoredSessionId, "to-restore");
  assert.equal(result.remainingInvalidCount, 0);

  // Quarantine file deleted (empty).
  await assert.rejects(fs.stat(quarantinePath), /ENOENT/);

  // Canonical file gained the restored record.
  const loaded = await loadAssessmentsFromFile(sourceFile);
  assert.equal(loaded.length, 2);
  assert.ok(loaded.some((r) => r.sessionId === "to-restore"));
});

test("assertInsideWorkspace blocks paths outside the workspace root", async () => {
  const { root } = await tempWorkspace();
  // Inside is fine.
  assert.doesNotThrow(() =>
    assertInsideWorkspace(root, path.join(root, ".agentic30/x.invalid-1.json")),
  );
  // Path traversal blocked.
  assert.throws(
    () => assertInsideWorkspace(root, path.resolve(root, "..", "etc", "passwd")),
    /must stay inside the workspace/,
  );
  // Sibling of root blocked.
  assert.throws(
    () => assertInsideWorkspace(root, "/tmp/somewhere-else.json"),
    /must stay inside the workspace/,
  );
});

test("proposeFixForEntry preserves original axis scores and only fills reason on flagged axes", () => {
  // Round 6 / CCG-UX: Round 4 composeFixedRecord overwrote everything with
  // score=1 stubs. The new behavior must preserve user progress.
  const original = legacyDay30Record({
    sessionId: "preserved-scores",
    axes: {
      definition: { score: 4, anchor_level: 3, anchor_text: "evidence-anchored",
        evidence_refs: [{ type: "session_message", ref: "msg-1" }] },
      command: { score: 3, anchor_level: 3, anchor_text: "..." }, // missing reason — issue
      clout: { score: 2, anchor_level: 1, anchor_text: "..." }, // missing reason — Day 30 issue
      responsibility: { score: 4, anchor_level: 3, anchor_text: "...",
        evidence_refs: [{ type: "doc_path", ref: "docs/GOAL.md" }] },
      adaptability: { score: 2, anchor_level: 1, anchor_text: "..." }, // missing reason — issue
    },
  });
  const entry = {
    original,
    issues: [
      { path: ["axes", "command", "evidence_refs"], message: "score >= 3 requires" },
      { path: ["axes", "clout", "evidence_refs"], message: "Day 30 requires" },
      { path: ["axes", "adaptability", "evidence_refs"], message: "Day 30 requires" },
    ],
  };
  const fix = proposeFixForEntry(entry, "이번 주 수요 검증 안 한 상태");
  assert.equal(fix.sessionId, "preserved-scores");
  assert.equal(fix.day, 30);
  // Scores preserved.
  assert.equal(fix.axes.definition.score, 4);
  assert.equal(fix.axes.command.score, 3);
  assert.equal(fix.axes.clout.score, 2);
  assert.equal(fix.axes.responsibility.score, 4);
  assert.equal(fix.axes.adaptability.score, 2);
  // evidence_refs preserved on axes that had them.
  assert.equal(fix.axes.definition.evidence_refs.length, 1);
  assert.equal(fix.axes.responsibility.evidence_refs.length, 1);
  // Reason filled on the flagged axes (which lack evidence/reason).
  assert.equal(fix.axes.command.no_evidence_reason, "이번 주 수요 검증 안 한 상태");
  assert.equal(fix.axes.clout.no_evidence_reason, "이번 주 수요 검증 안 한 상태");
  assert.equal(fix.axes.adaptability.no_evidence_reason, "이번 주 수요 검증 안 한 상태");
  // Axes that had evidence keep evidence — reason is NOT applied to them.
  assert.equal(fix.axes.definition.no_evidence_reason, undefined);
  assert.equal(fix.axes.responsibility.no_evidence_reason, undefined);
});

test("proposeFixForEntry falls back to baseline skeleton when original is missing or unusable", () => {
  // Corrupted entry → safe baseline + reason on every axis. The schema
  // re-validates downstream, so any structural gap surfaces as an explicit
  // error rather than as a silently bad record.
  const fix = proposeFixForEntry({ original: null, issues: [] }, "정직 모드 한 줄");
  assert.equal(fix.day, 30);
  for (const axis of ["definition", "command", "clout", "responsibility", "adaptability"]) {
    assert.equal(fix.axes[axis].score, 1, `axis ${axis} should be baseline 1`);
    assert.equal(fix.axes[axis].no_evidence_reason, "정직 모드 한 줄");
  }
  // Empty reason rejected.
  assert.throws(() => proposeFixForEntry({ original: null, issues: [] }, ""));
  assert.throws(() => proposeFixForEntry({ original: null, issues: [] }, "   "));
});

test("buildAutoSuggestProposal: pattern 1 — Day 30 missing reason", () => {
  const proposal = buildAutoSuggestProposal({
    issues: [
      {
        path: ["axes", "definition", "evidence_refs"],
        message: "Day 30 requires evidence_refs or no_evidence_reason for axis \"definition\"",
      },
    ],
  });
  assert.equal(proposal?.kind, "missing_no_evidence_reason");
  assert.equal(proposal?.axis, "definition");
  assert.equal(proposal?.fixHint?.type, "fill_no_evidence_reason");
});

test("buildAutoSuggestProposal: pattern 2 — score >= 3 missing evidence", () => {
  const proposal = buildAutoSuggestProposal({
    issues: [
      {
        path: ["axes", "clout", "evidence_refs"],
        message: "score >= 3 requires at least one evidence_refs entry or a no_evidence_reason",
      },
    ],
  });
  assert.equal(proposal?.kind, "missing_evidence_refs");
  assert.equal(proposal?.axis, "clout");
});

test("restoreQuarantinedRecord — same entry restored twice does not duplicate canonical record", async () => {
  // Round 6 / CCG-Codex: canonical-first ordering means a duplicate restore
  // could in principle re-insert the same record. The dedupe key
  // (sessionId|recordedAt) must catch this.
  const { root, agentic } = await tempWorkspace();
  const sourceFile = path.join(agentic, "rubric-assessments.json");
  const quarantinePath1 = path.join(agentic, "rubric-assessments.json.invalid-2026-05-08T01-00.json");
  const quarantinePath2 = path.join(agentic, "rubric-assessments.json.invalid-2026-05-08T02-00.json");
  // Two quarantine files containing the same legacy record (e.g. multiple
  // sidecar restarts each quarantined the same input).
  await writeQuarantineDump(quarantinePath1, sourceFile, [
    { original: legacyDay30Record({ sessionId: "dup-session" }), issues: [] },
  ]);
  await writeQuarantineDump(quarantinePath2, sourceFile, [
    { original: legacyDay30Record({ sessionId: "dup-session" }), issues: [] },
  ]);
  const fixed = legacyDay30Record({ sessionId: "dup-session" });
  for (const axis of Object.keys(fixed.axes)) {
    fixed.axes[axis] = { ...fixed.axes[axis], no_evidence_reason: "honest" };
  }
  await restoreQuarantinedRecord({
    workspaceRoot: root,
    quarantinePath: quarantinePath1,
    recordIndex: 0,
    fixedRecord: fixed,
  });
  const second = await restoreQuarantinedRecord({
    workspaceRoot: root,
    quarantinePath: quarantinePath2,
    recordIndex: 0,
    fixedRecord: fixed,
  });
  assert.equal(second.duplicateAvoided, true, "second restore must flag duplicateAvoided");
  // Canonical file has exactly one copy of dup-session.
  const loaded = await loadAssessmentsFromFile(sourceFile);
  const dups = loaded.filter((r) => r.sessionId === "dup-session");
  assert.equal(dups.length, 1, `expected 1 dup-session record, got ${dups.length}`);
});

test("restoreQuarantinedRecord — quarantine entry is preserved when canonical sourceFile is missing", async () => {
  // Round 6 / CCG-Codex: data-loss guard. If anything between fixedRecord
  // validation and quarantine consume fails, the entry must remain so the
  // user can retry. We simulate a missing sourceFile (pointed elsewhere).
  const { root, agentic } = await tempWorkspace();
  // sourceFile path resolves to a directory that does not exist as a file —
  // persistAssessmentsToFile will throw inside the canonical lock.
  const sourceFile = path.join(agentic, "rubric-assessments.json");
  const quarantinePath = path.join(agentic, "rubric-assessments.json.invalid-2026-05-08T01-00.json");
  await writeQuarantineDump(quarantinePath, sourceFile, [
    { original: legacyDay30Record(), issues: [] },
  ]);
  // Hold the source path as a directory so writeFile/rename fails.
  await fs.mkdir(sourceFile, { recursive: true });
  const fixed = legacyDay30Record({ sessionId: "preserve-me" });
  for (const axis of Object.keys(fixed.axes)) {
    fixed.axes[axis] = { ...fixed.axes[axis], no_evidence_reason: "honest" };
  }
  await assert.rejects(
    restoreQuarantinedRecord({
      workspaceRoot: root,
      quarantinePath,
      recordIndex: 0,
      fixedRecord: fixed,
    }),
  );
  // Quarantine entry must still be on disk.
  const dump = JSON.parse(await fs.readFile(quarantinePath, "utf8"));
  assert.equal(dump.records.length, 1, "quarantine entry must remain after failed canonical write");
});

test("restoreQuarantinedRecord — entry consumed only after canonical append succeeds", async () => {
  // Sanity check the happy path order: canonical lands first, quarantine
  // shrinks afterwards. We assert canonical contains the new record AND
  // the quarantine entry is gone.
  const { root, agentic } = await tempWorkspace();
  const sourceFile = path.join(agentic, "rubric-assessments.json");
  const quarantinePath = path.join(agentic, "rubric-assessments.json.invalid-2026-05-08T01-00.json");
  await writeQuarantineDump(quarantinePath, sourceFile, [
    { original: legacyDay30Record({ sessionId: "happy" }), issues: [] },
  ]);
  const fixed = legacyDay30Record({ sessionId: "happy" });
  for (const axis of Object.keys(fixed.axes)) {
    fixed.axes[axis] = { ...fixed.axes[axis], no_evidence_reason: "honest" };
  }
  const result = await restoreQuarantinedRecord({
    workspaceRoot: root,
    quarantinePath,
    recordIndex: 0,
    fixedRecord: fixed,
  });
  assert.equal(result.duplicateAvoided, false);
  assert.equal(result.remainingInvalidCount, 0);
  const loaded = await loadAssessmentsFromFile(sourceFile);
  assert.ok(loaded.some((r) => r.sessionId === "happy"));
  await assert.rejects(fs.stat(quarantinePath), /ENOENT/);
});

test("pruneExpiredQuarantineFiles removes .invalid-* files older than maxAgeDays", async () => {
  // R5-2 archival: quarantine should not accumulate forever. Files past the
  // age cutoff are unlinked silently; recent ones are preserved.
  const { root, agentic } = await tempWorkspace();
  const sourceFile = path.join(agentic, "rubric-assessments.json");
  // Filenames must match INVALID_FILE_PATTERN (timestamp-shaped suffix).
  const oldPath = path.join(agentic, "rubric-assessments.json.invalid-2025-12-01T00-00-00-000Z.json");
  const recentPath = path.join(agentic, "rubric-assessments.json.invalid-2026-05-07T00-00-00-000Z.json");
  await writeQuarantineDump(oldPath, sourceFile, []);
  await writeQuarantineDump(recentPath, sourceFile, []);
  // Manually backdate the old file's mtime to 100 days ago.
  const hundredDaysAgo = (Date.now() - 100 * 24 * 60 * 60 * 1000) / 1000;
  await fs.utimes(oldPath, hundredDaysAgo, hundredDaysAgo);
  const removed = await pruneExpiredQuarantineFiles({
    workspaceRoot: root,
    maxAgeDays: 90,
  });
  assert.equal(removed.length, 1);
  assert.match(removed[0], /\.invalid-2025-12-01/);
  // Recent file still there.
  await fs.stat(recentPath); // does not throw
  await assert.rejects(fs.stat(oldPath), /ENOENT/);
});

test("listQuarantinedFiles best-effort prunes expired files before returning the list", async () => {
  // The prune is wired into listQuarantinedFiles so callers don't need a
  // separate cron. Files older than maxAgeDays drop out of the list.
  const { root, agentic } = await tempWorkspace();
  const sourceFile = path.join(agentic, "rubric-assessments.json");
  const oldPath = path.join(agentic, "rubric-assessments.json.invalid-2025-09-01T00-00-00-000Z.json");
  const recentPath = path.join(agentic, "rubric-assessments.json.invalid-2026-05-07T00-00-00-000Z.json");
  await writeQuarantineDump(oldPath, sourceFile, []);
  await writeQuarantineDump(recentPath, sourceFile, []);
  const stale = (Date.now() - 200 * 24 * 60 * 60 * 1000) / 1000;
  await fs.utimes(oldPath, stale, stale);
  const list = await listQuarantinedFiles({ workspaceRoot: root, maxAgeDays: 90 });
  assert.equal(list.length, 1);
  assert.match(list[0].name, /\.invalid-2026-05-07/);
});

test("buildAutoSuggestProposal returns null when no recognized pattern matches", () => {
  assert.equal(
    buildAutoSuggestProposal({ issues: [{ path: ["unknown"], message: "weird" }] }),
    null,
  );
  assert.equal(buildAutoSuggestProposal({}), null);
  assert.equal(buildAutoSuggestProposal(null), null);
});
