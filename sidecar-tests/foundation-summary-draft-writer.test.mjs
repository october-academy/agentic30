/**
 * Tests for AC 13 Sub-AC 5 — foundation-summary draft.v2 writer.
 *
 * The writer is the disk-side closer of the Day 7 foundation-summary lane:
 *   - parseDraftV2Sections() pulls SPEC v3 / go-no-go / foundation-summary
 *     blocks out of the assistant's text via labelled markdown headings.
 *   - writeFoundationSummaryDraftV2() persists each non-empty section
 *     under workspace/.agentic30/foundation/<file>.md and writes a
 *     draft.v2.json audit sidecar capturing the v1 → v2 lineage.
 *
 * These tests use an in-memory fs stub so they stay deterministic and never
 * touch the real workspace. The clock is also injected for stable
 * `written_at` / audit timestamps.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  DRAFT_V2_SCHEMA_VERSION,
  FOUNDATION_DRAFT_V2_FILES,
  parseDraftV2Sections,
  writeFoundationSummaryDraftV2,
} from "../sidecar/foundation-summary/draft-writer.mjs";

// ────────────── helpers ──────────────

function makeFsStub() {
  const writes = new Map();
  const dirs = new Set();
  return {
    fs: {
      async mkdir(p, _opts) {
        dirs.add(p);
      },
      async writeFile(p, body, _opts) {
        writes.set(p, body);
      },
    },
    writes,
    dirs,
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
  "- 통증: 1인 개발자가 인터뷰 데이터를 손으로 합치고 있다.",
  "- 가설: AI 코파운더가 매일 첫 프롬프트 + 4종 인풋 ingest 자동화하면 30분 절약.",
  "- 검증: Day 6 monetization-ask 1명 yes (월 19,000원).",
  "",
  "## go-no-go.md",
  "결정: continue",
  "근거:",
  "- monetization yes 1건",
  "- artifacts_completeness 100%",
  "",
  "## foundation-summary.md",
  "Day 0-7 산출물 모두 존재. Build phase 진입 권고.",
].join("\n");

// ────────────── parseDraftV2Sections ──────────────

test("parseDraftV2Sections returns empty for non-string / blank input", () => {
  assert.deepEqual(parseDraftV2Sections(null), {
    spec_md_v3: "",
    go_no_go: "",
    foundation_summary: "",
  });
  assert.deepEqual(parseDraftV2Sections(""), {
    spec_md_v3: "",
    go_no_go: "",
    foundation_summary: "",
  });
  assert.deepEqual(parseDraftV2Sections("   \n\n  "), {
    spec_md_v3: "",
    go_no_go: "",
    foundation_summary: "",
  });
});

test("parseDraftV2Sections extracts each labelled section", () => {
  const sections = parseDraftV2Sections(PASSING_ASSISTANT_TEXT);
  assert.match(sections.spec_md_v3, /통증/);
  assert.match(sections.spec_md_v3, /가설/);
  assert.match(sections.go_no_go, /결정: continue/);
  assert.match(sections.foundation_summary, /Build phase/);
  // Headings themselves are stripped; bodies do not contain another labelled heading.
  assert.doesNotMatch(sections.spec_md_v3, /^## SPEC v3/m);
  assert.doesNotMatch(sections.go_no_go, /^## SPEC v3/m);
});

test("parseDraftV2Sections handles draft.v2 marker in heading", () => {
  const text = [
    "## SPEC.md v3 (draft.v2)",
    "spec body",
    "## go-no-go (draft.v2)",
    "decision body",
    "## foundation-summary.md (draft.v2)",
    "summary body",
  ].join("\n");
  const out = parseDraftV2Sections(text);
  assert.equal(out.spec_md_v3, "spec body");
  assert.equal(out.go_no_go, "decision body");
  assert.equal(out.foundation_summary, "summary body");
});

test("parseDraftV2Sections last-write-wins when label repeats", () => {
  const text = [
    "## SPEC v3",
    "first attempt",
    "## SPEC v3",
    "retry",
  ].join("\n");
  assert.equal(parseDraftV2Sections(text).spec_md_v3, "retry");
});

test("parseDraftV2Sections returns empty for assistant text with no headings", () => {
  const text = "어제: ok\n오늘: ok\nQ: ok?\n\nplain prose with no markdown headings";
  assert.deepEqual(parseDraftV2Sections(text), {
    spec_md_v3: "",
    go_no_go: "",
    foundation_summary: "",
  });
});

// ────────────── writeFoundationSummaryDraftV2 ──────────────

test("writeFoundationSummaryDraftV2 throws when workspaceRoot is empty", async () => {
  await assert.rejects(
    () => writeFoundationSummaryDraftV2({ workspaceRoot: "", sections: {} }),
    /requires a non-empty workspaceRoot/,
  );
});

test("writeFoundationSummaryDraftV2 writes all three artifacts + audit when all sections present", async () => {
  const { fs, writes } = makeFsStub();
  const sections = {
    spec_md_v3: "spec body",
    go_no_go: "decision body",
    foundation_summary: "summary body",
  };
  const result = await writeFoundationSummaryDraftV2({
    workspaceRoot: "/tmp/ws",
    sections,
    fs,
    now: fixedClock(),
  });

  assert.equal(result.schema_version, DRAFT_V2_SCHEMA_VERSION);
  assert.deepEqual(result.sections_present.sort(), [
    "foundation_summary",
    "go_no_go",
    "spec_md",
  ]);
  assert.deepEqual(result.sections_skipped, []);

  // Each artifact plus the audit are written.
  assert.equal(writes.size, 4);
  for (const key of ["spec_md", "go_no_go", "foundation_summary"]) {
    const filename = FOUNDATION_DRAFT_V2_FILES[key];
    const writtenPath = result.paths[key];
    assert.ok(writtenPath.endsWith(`.agentic30/foundation/${filename}`));
    const body = writes.get(writtenPath);
    assert.match(body, /\(draft\.v2\)/, `body for ${key} carries draft.v2 banner`);
    assert.match(body, /generated_at: 2026-05-08T00:00:00\.000Z/);
  }
  // Audit JSON is parseable + carries the lineage.
  const audit = JSON.parse(writes.get(result.paths.audit));
  assert.equal(audit.schema_version, DRAFT_V2_SCHEMA_VERSION);
  assert.equal(audit.sections_present.length, 3);
  assert.equal(audit.sections_skipped.length, 0);
  assert.equal(audit.section_chars.spec_md_v3, "spec body".length);
});

test("writeFoundationSummaryDraftV2 partial-write tolerant — missing sections are skipped, not blanked", async () => {
  const { fs, writes } = makeFsStub();
  const sections = {
    // Only SPEC v3 — go-no-go and foundation-summary are intentionally empty.
    spec_md_v3: "spec body only",
    go_no_go: "",
    foundation_summary: "",
  };
  const result = await writeFoundationSummaryDraftV2({
    workspaceRoot: "/tmp/ws",
    sections,
    fs,
    now: fixedClock(),
  });

  assert.deepEqual(result.sections_present, ["spec_md"]);
  assert.deepEqual(result.sections_skipped.sort(), ["foundation_summary", "go_no_go"]);
  // Only SPEC.md + audit are written. go-no-go.md / foundation-summary.md are
  // NOT touched — re-run safety so a half-finished review loop can't blank
  // a previously-good file.
  assert.equal(writes.size, 2);
  assert.ok(result.paths.spec_md);
  assert.ok(result.paths.audit);
  assert.equal(result.paths.go_no_go, undefined);
  assert.equal(result.paths.foundation_summary, undefined);
});

test("writeFoundationSummaryDraftV2 captures draft.v1 + verdict + reviewLoop in audit", async () => {
  const { fs, writes } = makeFsStub();
  const result = await writeFoundationSummaryDraftV2({
    workspaceRoot: "/tmp/ws",
    sections: { spec_md_v3: "spec" },
    draftV1: {
      schema_version: 1,
      spec_md_v3: "v1-spec",
      go_no_go_md: "v1-go",
      foundation_summary_md: "v1-sum",
    },
    verdict: {
      pass: true,
      score: 0.92,
      reasons: [],
      schema_version: 1,
    },
    reviewLoop: {
      status: "passed",
      passed: true,
      total_iterations: 2,
      max_iterations: 3,
      reason: "rule-check passed on iteration 2",
      finalized_at: "2026-05-08T00:00:01.000Z",
      schema_version: 1,
    },
    assistantText: "## SPEC v3\nspec",
    fs,
    now: fixedClock(),
  });
  const audit = JSON.parse(writes.get(result.paths.audit));
  assert.equal(audit.draft_v1.schema_version, 1);
  assert.equal(audit.draft_v1.spec_md_v3_chars, "v1-spec".length);
  assert.equal(audit.verdict.pass, true);
  assert.equal(audit.verdict.score, 0.92);
  assert.equal(audit.review_loop.status, "passed");
  assert.equal(audit.review_loop.total_iterations, 2);
  assert.equal(audit.assistant_text_chars, "## SPEC v3\nspec".length);
});

test("writeFoundationSummaryDraftV2 mkdir is invoked on the foundation dir", async () => {
  const { fs, dirs } = makeFsStub();
  await writeFoundationSummaryDraftV2({
    workspaceRoot: "/tmp/ws",
    sections: { spec_md_v3: "spec" },
    fs,
    now: fixedClock(),
  });
  // Foundation dir is created (recursive — parent .agentic30 is implicit).
  assert.ok(
    [...dirs].some((d) => d.endsWith(".agentic30/foundation")),
    "mkdir called on foundation dir",
  );
});
