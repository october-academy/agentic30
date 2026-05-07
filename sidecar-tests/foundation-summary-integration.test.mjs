/**
 * Tests for AC 13 Sub-AC 5 — foundation-summary-integration.mjs.
 *
 * The integration module is the dispatcher-facing facade for the Day 7
 * foundation-summary outcome path. It must:
 *   1. Gate strictly on Day 7 + sub_workflow tag.
 *   2. Run the deterministic pipeline (collect evidence → parse sections →
 *      rule-check → write draft.v2 → emit evidence_refs).
 *   3. Stay partial-write tolerant (some sections missing → status=partial).
 *   4. Stay write-skip tolerant (no headings in assistant text → status=skipped).
 *   5. Tolerate evidence-collection failure (writer still runs).
 *   6. Round-trip session.runtime via attach/load helpers without mutating
 *      adjacent runtime branches (monetization-ask slot).
 *   7. Build a `foundation_summary_completed` event payload that matches
 *      the contract the dispatcher broadcasts.
 *
 * Tests inject `fs` + `now` so the run is deterministic + filesystem-free.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  applyFoundationSummaryOutcome,
  attachFoundationSummaryState,
  buildFoundationSummaryCompletedEvent,
  buildFoundationSummaryEvidenceRefs,
  DRAFT_V2_SCHEMA_VERSION,
  FOUNDATION_DRAFT_V2_FILES,
  FOUNDATION_SUMMARY_DAY,
  FOUNDATION_SUMMARY_EVIDENCE_REF_TYPE,
  FOUNDATION_SUMMARY_RUNTIME_KEY,
  FOUNDATION_SUMMARY_SUB_WORKFLOW,
  loadFoundationSummaryState,
  shouldRunFoundationSummary,
} from "../sidecar/foundation-summary-integration.mjs";

// ────────────── helpers ──────────────

function makeFsStub() {
  const writes = new Map();
  return {
    fs: {
      async mkdir(_p, _opts) {},
      async writeFile(p, body, _opts) {
        writes.set(p, body);
      },
      async stat() {
        const err = new Error("ENOENT");
        err.code = "ENOENT";
        throw err;
      },
      async readFile() {
        const err = new Error("ENOENT");
        err.code = "ENOENT";
        throw err;
      },
      async readdir() {
        const err = new Error("ENOENT");
        err.code = "ENOENT";
        throw err;
      },
    },
    writes,
  };
}

function fixedClock(iso = "2026-05-08T00:00:00.000Z") {
  return () => new Date(iso);
}

const PASSING_ASSISTANT_TEXT = [
  "어제: monetization-ask 끝났어 — 1명 yes 받아냈어.",
  "오늘: SPEC v3 박고 go-no-go.md 작성해.",
  "Q: continue / pivot / restart 셋 중 뭐야?",
  "",
  "## SPEC v3 (draft.v2)",
  "- 통증: 1인 개발자 인터뷰 데이터 수집 부담.",
  "- 가설: AI 코파운더가 4종 인풋 ingest 자동화하면 30분 절약.",
  "- 검증: Day 6 monetization yes 1건.",
  "",
  "## go-no-go.md",
  "결정: continue",
  "근거: monetization yes 1건 + artifacts_completeness 100%.",
  "",
  "## foundation-summary.md",
  "Day 0-7 산출물 모두 존재. Build phase 진입 권고.",
].join("\n");

const PARTIAL_ASSISTANT_TEXT = [
  "어제: ok",
  "오늘: ok",
  "Q: ok?",
  "",
  "## SPEC v3",
  "- 통증: spec body only",
].join("\n");

const NO_HEADING_ASSISTANT_TEXT = "어제: ok\n오늘: ok\nQ: 답해.";

// ────────────── shouldRunFoundationSummary ──────────────

test("shouldRunFoundationSummary gates on Day 7 + sub-workflow tag", () => {
  assert.equal(
    shouldRunFoundationSummary({
      day: FOUNDATION_SUMMARY_DAY,
      subWorkflow: FOUNDATION_SUMMARY_SUB_WORKFLOW,
    }),
    true,
  );
  assert.equal(
    shouldRunFoundationSummary({ day: 7, subWorkflow: "foundation-summary" }),
    true,
  );
  assert.equal(
    shouldRunFoundationSummary({ day: 7, subWorkflow: "monetization-ask" }),
    false,
  );
  assert.equal(
    shouldRunFoundationSummary({ day: 6, subWorkflow: "foundation-summary" }),
    false,
  );
  assert.equal(shouldRunFoundationSummary({}), false);
  assert.equal(shouldRunFoundationSummary({ day: "seven" }), false);
});

// ────────────── load/attach state round-trip ──────────────

test("loadFoundationSummaryState returns initial shell when slot is missing", () => {
  const state = loadFoundationSummaryState({});
  assert.equal(state.schema_version, DRAFT_V2_SCHEMA_VERSION);
  assert.equal(state.last_run_at, null);
  assert.equal(state.last_status, null);
  assert.deepEqual(state.last_artifacts, {});
});

test("loadFoundationSummaryState tolerates corrupt input", () => {
  assert.equal(loadFoundationSummaryState({ foundation: { foundationSummary: "garbage" } }).last_status, null);
  assert.equal(loadFoundationSummaryState({ foundation: { foundationSummary: 42 } }).last_status, null);
  assert.equal(loadFoundationSummaryState({ foundation: { foundationSummary: [1, 2] } }).last_status, null);
});

test("attachFoundationSummaryState round-trips state without mutating adjacent slots", () => {
  const initial = {
    foundation: {
      monetizationAsk: { schema_version: 1, turn: "T2" },
    },
    other: "preserved",
  };
  const attached = attachFoundationSummaryState(initial, {
    schema_version: DRAFT_V2_SCHEMA_VERSION,
    last_run_at: "2026-05-08T00:00:00.000Z",
    last_artifacts: { spec_md: "/tmp/ws/.agentic30/foundation/SPEC.md" },
    last_status: "draft_v2_written",
  });
  // Pure (no mutation).
  assert.equal(initial.foundation[FOUNDATION_SUMMARY_RUNTIME_KEY], undefined);
  // Adjacent monetization-ask slot is preserved.
  assert.equal(attached.foundation.monetizationAsk.turn, "T2");
  // foundation-summary slot is set.
  assert.equal(attached.foundation[FOUNDATION_SUMMARY_RUNTIME_KEY].last_status, "draft_v2_written");
  assert.equal(attached.other, "preserved");
  // Round-trip via load.
  const loaded = loadFoundationSummaryState(attached);
  assert.equal(loaded.last_status, "draft_v2_written");
  assert.equal(loaded.last_artifacts.spec_md, "/tmp/ws/.agentic30/foundation/SPEC.md");
});

// ────────────── applyFoundationSummaryOutcome happy path ──────────────

test("applyFoundationSummaryOutcome writes draft.v2 + emits evidence_refs on full assistant text", async () => {
  const { fs, writes } = makeFsStub();
  const outcome = await applyFoundationSummaryOutcome({
    assistantText: PASSING_ASSISTANT_TEXT,
    workspaceRoot: "/tmp/ws",
    precollectedEvidence: null, // forces collectFoundationEvidence — which fails on stub fs (ENOENT) → null
    fs,
    now: fixedClock(),
  });

  assert.equal(outcome.summary.status, "draft_v2_written");
  assert.deepEqual(outcome.sectionsPresent.sort(), [
    "foundation_summary",
    "go_no_go",
    "spec_md",
  ]);
  assert.equal(outcome.sectionsSkipped.length, 0);
  assert.equal(outcome.isTerminal, true);
  assert.equal(outcome.error, null);

  // Evidence refs cover each artifact + the audit JSON.
  assert.equal(outcome.evidenceRefs.length, 4);
  for (const ref of outcome.evidenceRefs) {
    assert.equal(ref.ref_type, FOUNDATION_SUMMARY_EVIDENCE_REF_TYPE);
    assert.ok(ref.file && typeof ref.file === "string");
    assert.ok(ref.location && typeof ref.location === "string");
    assert.ok(ref.field_used && typeof ref.field_used === "string");
  }
  const fieldUsed = outcome.evidenceRefs.map((r) => r.field_used).sort();
  assert.deepEqual(fieldUsed, [
    "draft_v2_audit",
    "foundation_summary_draft_v2",
    "go_no_go_draft_v2",
    "spec_md_v3_draft_v2",
  ]);

  // Files actually written on disk (stub).
  const writtenPaths = [...writes.keys()];
  assert.ok(writtenPaths.some((p) => p.endsWith(`/${FOUNDATION_DRAFT_V2_FILES.spec_md}`)));
  assert.ok(writtenPaths.some((p) => p.endsWith(`/${FOUNDATION_DRAFT_V2_FILES.go_no_go}`)));
  assert.ok(writtenPaths.some((p) => p.endsWith(`/${FOUNDATION_DRAFT_V2_FILES.foundation_summary}`)));
  assert.ok(writtenPaths.some((p) => p.endsWith(`/${FOUNDATION_DRAFT_V2_FILES.audit}`)));

  // State after — round-trips through attach/load.
  assert.equal(outcome.stateAfter.last_status, "draft_v2_written");
  assert.equal(outcome.stateAfter.last_run_at, "2026-05-08T00:00:00.000Z");
});

test("applyFoundationSummaryOutcome status=draft_v2_partial when only some sections present", async () => {
  const { fs } = makeFsStub();
  const outcome = await applyFoundationSummaryOutcome({
    assistantText: PARTIAL_ASSISTANT_TEXT,
    workspaceRoot: "/tmp/ws",
    fs,
    now: fixedClock(),
  });
  assert.equal(outcome.summary.status, "draft_v2_partial");
  assert.deepEqual(outcome.sectionsPresent, ["spec_md"]);
  assert.deepEqual(outcome.sectionsSkipped.sort(), ["foundation_summary", "go_no_go"]);
  assert.equal(outcome.isTerminal, true); // partial is still terminal — Day 7 advanced
});

test("applyFoundationSummaryOutcome status=draft_v2_skipped when assistant text has no headings", async () => {
  const { fs, writes } = makeFsStub();
  const outcome = await applyFoundationSummaryOutcome({
    assistantText: NO_HEADING_ASSISTANT_TEXT,
    workspaceRoot: "/tmp/ws",
    fs,
    now: fixedClock(),
  });
  assert.equal(outcome.summary.status, "draft_v2_skipped");
  assert.equal(outcome.isTerminal, false);
  assert.equal(outcome.evidenceRefs.length, 0);
  // Nothing on disk.
  assert.equal(writes.size, 0);
});

test("applyFoundationSummaryOutcome status=draft_v2_skipped when workspaceRoot missing", async () => {
  const outcome = await applyFoundationSummaryOutcome({
    assistantText: PASSING_ASSISTANT_TEXT,
    workspaceRoot: "",
  });
  assert.equal(outcome.summary.status, "draft_v2_skipped");
  assert.equal(outcome.isTerminal, false);
  assert.equal(outcome.evidenceRefs.length, 0);
});

test("applyFoundationSummaryOutcome status=draft_v2_error when writer throws", async () => {
  const fs = {
    async mkdir() {},
    async writeFile() {
      throw new Error("EROFS: read-only file system");
    },
  };
  const outcome = await applyFoundationSummaryOutcome({
    assistantText: PASSING_ASSISTANT_TEXT,
    workspaceRoot: "/tmp/ws",
    fs,
    now: fixedClock(),
  });
  assert.equal(outcome.summary.status, "draft_v2_error");
  assert.equal(outcome.isTerminal, false);
  assert.match(outcome.summary.reason, /EROFS/);
  assert.ok(outcome.error instanceof Error);
});

test("applyFoundationSummaryOutcome captures monetization signal from precollectedEvidence into the summary + go-no-go evidence_ref", async () => {
  const { fs } = makeFsStub();
  const evidence = {
    schema_version: 1,
    workspace_root: "/tmp/ws",
    foundation_dir: "/tmp/ws/.agentic30/foundation",
    foundation_dir_present: true,
    collected_at: "2026-05-08T00:00:00.000Z",
    days: [],
    spec_versions_expected: ["v0", "v1", "v2", "v3"],
    spec_versions_present: ["v0", "v1", "v2"],
    spec_md: { path: "", present: true, size: 100, mtime: null, headings: [] },
    monetization_ask: {
      artifact: "monetization-ask-result.md",
      path: "/tmp/ws/.agentic30/foundation/monetization-ask-result.md",
      present: true,
      classification: "yes",
      response_yes_count: 1,
      payment_executed: true,
      excerpt: "",
    },
    evidence_sidecars: { dir: "", present: true, files: [], total: 3 },
    artifacts_completeness: 0.95,
    monetization_signal: "yes",
    missing_inputs: [],
    go_no_go_recommendation: "continue",
    go_no_go_reason: "monetization yes 1건",
  };
  const outcome = await applyFoundationSummaryOutcome({
    assistantText: PASSING_ASSISTANT_TEXT,
    workspaceRoot: "/tmp/ws",
    precollectedEvidence: evidence,
    fs,
    now: fixedClock(),
  });
  assert.equal(outcome.summary.monetization_signal, "yes");
  assert.equal(outcome.summary.monetization_yes_count, 1);
  assert.equal(outcome.summary.go_no_go_recommendation, "continue");
  assert.equal(outcome.summary.artifacts_completeness, 0.95);
  // The go-no-go evidence_ref carries the monetization_yes_count.
  const goNoGoRef = outcome.evidenceRefs.find((r) => r.field_used === "go_no_go_draft_v2");
  assert.ok(goNoGoRef);
  assert.equal(goNoGoRef.extracted_value.monetization_yes_count, 1);
  assert.equal(goNoGoRef.extracted_value.recommendation, "continue");
});

// ────────────── buildFoundationSummaryEvidenceRefs ──────────────

test("buildFoundationSummaryEvidenceRefs returns [] when writeResult is missing", () => {
  assert.deepEqual(buildFoundationSummaryEvidenceRefs(), []);
  assert.deepEqual(buildFoundationSummaryEvidenceRefs({ writeResult: null }), []);
  assert.deepEqual(buildFoundationSummaryEvidenceRefs({ writeResult: {} }), []);
});

test("buildFoundationSummaryEvidenceRefs emits one ref per written artifact (audit included)", () => {
  const writeResult = {
    paths: {
      spec_md: "/tmp/ws/.agentic30/foundation/SPEC.md",
      go_no_go: "/tmp/ws/.agentic30/foundation/go-no-go.md",
      foundation_summary: "/tmp/ws/.agentic30/foundation/foundation-summary.md",
      audit: "/tmp/ws/.agentic30/foundation/draft.v2.json",
    },
    sections_present: ["spec_md", "go_no_go", "foundation_summary"],
    sections_skipped: [],
  };
  const refs = buildFoundationSummaryEvidenceRefs({ writeResult });
  assert.equal(refs.length, 4);
  for (const ref of refs) {
    assert.equal(ref.ref_type, FOUNDATION_SUMMARY_EVIDENCE_REF_TYPE);
  }
});

// ────────────── buildFoundationSummaryCompletedEvent ──────────────

test("buildFoundationSummaryCompletedEvent shapes the broadcast payload", () => {
  const event = buildFoundationSummaryCompletedEvent({
    sessionId: "sess-1",
    messageId: "msg-1",
    outcome: {
      summary: {
        status: "draft_v2_written",
        reason: "draft.v2 fully written",
        artifacts: { spec_md: "/tmp/ws/SPEC.md" },
        sections_present: ["spec_md", "go_no_go", "foundation_summary"],
        sections_skipped: [],
        monetization_signal: "yes",
        monetization_yes_count: 1,
        go_no_go_recommendation: "continue",
        verdict_pass: true,
        verdict_score: 0.9,
        completed_at: "2026-05-08T00:00:00.000Z",
      },
    },
  });
  assert.equal(event.type, "foundation_summary_completed");
  assert.equal(event.sessionId, "sess-1");
  assert.equal(event.messageId, "msg-1");
  assert.equal(event.status, "draft_v2_written");
  assert.equal(event.monetization_yes_count, 1);
  assert.equal(event.go_no_go_recommendation, "continue");
  assert.equal(event.verdict_pass, true);
  assert.equal(event.completed_at, "2026-05-08T00:00:00.000Z");
});

test("buildFoundationSummaryCompletedEvent returns null when outcome is missing", () => {
  assert.equal(buildFoundationSummaryCompletedEvent({ outcome: null }), null);
});
