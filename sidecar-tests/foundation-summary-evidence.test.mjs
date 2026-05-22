import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import {
  collectFoundationEvidence,
  buildFoundationSummaryDraftV1,
  formatEvidenceContextBlock,
  __test__,
} from "../sidecar/foundation-summary/evidence-collector.mjs";

async function withTempWorkspace(fn) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-foundation-evidence-"));
  try {
    await fs.mkdir(path.join(root, ".agentic30", "foundation"), { recursive: true });
    return await fn(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

async function writeArtifact(root, file, body) {
  const abs = path.join(root, ".agentic30", "foundation", file);
  await fs.writeFile(abs, body, "utf8");
  return abs;
}

async function writeEvidenceSidecar(root, sessionId, messageId, payload) {
  const dir = path.join(root, ".agentic30", "foundation", "evidence", sessionId);
  await fs.mkdir(dir, { recursive: true });
  const abs = path.join(dir, `${messageId}.json`);
  await fs.writeFile(abs, JSON.stringify(payload), "utf8");
  return abs;
}

// ────────────── core collector behavior ──────────────

test("collectFoundationEvidence returns empty shell when workspaceRoot missing", async () => {
  const evidence = await collectFoundationEvidence({ workspaceRoot: "" });
  assert.equal(evidence.workspace_root, "");
  assert.equal(evidence.foundation_dir_present, false);
  assert.equal(evidence.artifacts_completeness, 0);
  assert.equal(evidence.monetization_signal, "missing");
  assert.equal(evidence.go_no_go_recommendation, "restart");
  assert.equal(evidence.days.length, 8); // Day 0-7
  assert.equal(evidence.spec_versions_expected.length, 4);
});

test("collectFoundationEvidence enumerates Day 0-7 expected artifacts", async () => {
  await withTempWorkspace(async (root) => {
    const evidence = await collectFoundationEvidence({ workspaceRoot: root });
    assert.equal(evidence.foundation_dir_present, true);
    assert.equal(evidence.days[0].day, 0);
    assert.equal(evidence.days[7].day, 7);

    // Day 0: day-0-channel-setup.md
    assert.deepEqual(evidence.days[0].artifacts_expected, ["day-0-channel-setup.md"]);
    // Day 1: SPEC.md + day-1-alignment-statement.md
    assert.ok(evidence.days[1].artifacts_expected.includes("SPEC.md"));
    assert.ok(evidence.days[1].artifacts_expected.includes("day-1-alignment-statement.md"));
    // Day 6: monetization-ask-result.md
    assert.deepEqual(evidence.days[6].artifacts_expected, ["monetization-ask-result.md"]);

    // Nothing on disk → all marked missing.
    for (const day of evidence.days) {
      assert.equal(day.artifacts_found.length, 0);
      assert.equal(day.missing.length, day.artifacts_expected.length);
    }
    assert.equal(evidence.artifacts_completeness, 0);
    assert.equal(evidence.go_no_go_recommendation, "restart");
  });
});

test("collectFoundationEvidence reads artifact bodies and reports excerpts + size", async () => {
  await withTempWorkspace(async (root) => {
    const body = "# Day 1 Alignment Statement\n\nProject Goal + ICP + Pain Point + Outcome.";
    await writeArtifact(root, "day-1-alignment-statement.md", body);
    await writeArtifact(root, "SPEC.md", "# SPEC\n\n## SPEC v0\n\n약한 가설 H1.");

    const evidence = await collectFoundationEvidence({ workspaceRoot: root });
    const day1 = evidence.days[1];
    const alignment = day1.artifacts_found.find((a) => a.file === "day-1-alignment-statement.md");
    assert.ok(alignment);
    assert.equal(alignment.exists, true);
    assert.ok(alignment.size > 0);
    assert.ok(alignment.excerpt.startsWith("# Day 1 Alignment Statement"));
    assert.ok(day1.missing.length === 0);
    assert.equal(evidence.spec_md.present, true);
    assert.ok(evidence.spec_md.headings.length >= 1);
  });
});

test("collectFoundationEvidence walks evidence sidecar directory", async () => {
  await withTempWorkspace(async (root) => {
    await writeEvidenceSidecar(root, "sess-1", "msg-a", {
      session_id: "sess-1",
      message_id: "msg-a",
      day: 1,
      sub_workflow: "office-hours-docs",
      overall_confidence: 0.6,
    });
    await writeEvidenceSidecar(root, "sess-1", "msg-b", {
      session_id: "sess-1",
      message_id: "msg-b",
      day: 6,
      sub_workflow: "monetization-ask",
      overall_confidence: 0.8,
    });
    await writeEvidenceSidecar(root, "sess-2", "msg-c", {
      session_id: "sess-2",
      message_id: "msg-c",
      day: 7,
      sub_workflow: "foundation-summary",
      overall_confidence: 0.9,
    });

    const evidence = await collectFoundationEvidence({ workspaceRoot: root });
    assert.equal(evidence.evidence_sidecars.present, true);
    assert.equal(evidence.evidence_sidecars.total, 3);
    assert.equal(evidence.days[1].evidence_refs_count, 1);
    assert.equal(evidence.days[6].evidence_refs_count, 1);
    assert.equal(evidence.days[7].evidence_refs_count, 1);
  });
});

test("collectFoundationEvidence parses monetization classification + yes count", async () => {
  await withTempWorkspace(async (root) => {
    const body = [
      "# Day 6 monetization-ask",
      "- target: 김아무개",
      "- response_classification: yes",
      "- payment_executed: true",
      "- response_verbatim: 5만원 보낼게.",
    ].join("\n");
    await writeArtifact(root, "monetization-ask-result.md", body);

    const evidence = await collectFoundationEvidence({ workspaceRoot: root });
    assert.equal(evidence.monetization_ask.present, true);
    assert.equal(evidence.monetization_ask.classification, "yes");
    assert.equal(evidence.monetization_ask.response_yes_count, 1);
    assert.equal(evidence.monetization_ask.payment_executed, true);
    assert.equal(evidence.monetization_signal, "yes");
    assert.equal(evidence.go_no_go_recommendation, "continue");
  });
});

test("collectFoundationEvidence recommends pivot when monetization=no AND mostly complete", async () => {
  await withTempWorkspace(async (root) => {
    // Mostly complete: Day 0,1,2,3,4,5,6 artifacts present.
    await writeArtifact(root, "day-0-channel-setup.md", "ok");
    await writeArtifact(root, "SPEC.md", "# SPEC\n## SPEC v0\n## SPEC v1\n## SPEC v2");
    await writeArtifact(root, "day-1-alignment-statement.md", "alignment");
    await writeArtifact(root, "day-2-evidence-log.md", "ev");
    await writeArtifact(root, "day-3-interview-script.md", "iv");
    await writeArtifact(root, "day-4-rewrite-decision.md", "rw");
    await writeArtifact(root, "day-5-demand-signal.md", "ds");
    await writeArtifact(
      root,
      "monetization-ask-result.md",
      "response_classification: no\npayment_executed: false",
    );

    const evidence = await collectFoundationEvidence({ workspaceRoot: root });
    assert.equal(evidence.monetization_ask.classification, "no");
    assert.ok(evidence.artifacts_completeness >= 0.7, `completeness=${evidence.artifacts_completeness}`);
    assert.equal(evidence.go_no_go_recommendation, "pivot");
  });
});

test("collectFoundationEvidence recommends restart when monetization=no_reply", async () => {
  await withTempWorkspace(async (root) => {
    await writeArtifact(
      root,
      "monetization-ask-result.md",
      "response_classification: no_reply",
    );
    const evidence = await collectFoundationEvidence({ workspaceRoot: root });
    assert.equal(evidence.go_no_go_recommendation, "restart");
    assert.match(evidence.go_no_go_reason, /no_reply/);
  });
});

// ────────────── draft.v1 rendering ──────────────

test("buildFoundationSummaryDraftV1 produces three labelled markdown bodies", async () => {
  await withTempWorkspace(async (root) => {
    await writeArtifact(root, "day-1-alignment-statement.md", "## 핵심 가설\nProject Goal + ICP + Pain Point + Outcome.");
    await writeArtifact(root, "SPEC.md", "# SPEC\n## SPEC v0");
    await writeArtifact(
      root,
      "monetization-ask-result.md",
      "response_classification: yes\npayment_executed: true",
    );
    const evidence = await collectFoundationEvidence({ workspaceRoot: root });
    const draft = buildFoundationSummaryDraftV1(evidence);

    assert.equal(draft.schema_version, 1);
    assert.match(draft.spec_md_v3, /# SPEC v3 \(draft\.v1\)/);
    assert.match(draft.spec_md_v3, /핵심 가설/);
    assert.match(draft.go_no_go_md, /# go-no-go\.md \(draft\.v1\)/);
    assert.match(draft.go_no_go_md, /계속 \(Build phase 진입\)/);
    assert.match(draft.foundation_summary_md, /# foundation-summary\.md \(draft\.v1\)/);
    assert.match(draft.foundation_summary_md, /Day 0/);
    assert.match(draft.foundation_summary_md, /Day 7/);
    assert.match(draft.text, /draft\.v1 — SPEC\.md v3 candidate/);
    assert.match(draft.text, /draft\.v1 — go-no-go\.md candidate/);
    assert.match(draft.text, /draft\.v1 — foundation-summary\.md candidate/);
  });
});

test("buildFoundationSummaryDraftV1 marks missing day-files honestly", async () => {
  await withTempWorkspace(async (root) => {
    const evidence = await collectFoundationEvidence({ workspaceRoot: root });
    const draft = buildFoundationSummaryDraftV1(evidence);
    assert.match(draft.spec_md_v3, /day-1-alignment-statement\.md 없음 — 채워서 다시 와/);
    assert.match(draft.go_no_go_md, /재시작/);
  });
});

test("buildFoundationSummaryDraftV1 returns empty bundle when evidence is null/garbage", () => {
  const empty = buildFoundationSummaryDraftV1(null);
  assert.equal(empty.text, "");
  assert.equal(empty.spec_md_v3, "");
  assert.equal(empty.go_no_go_md, "");
  assert.equal(empty.foundation_summary_md, "");
});

test("formatEvidenceContextBlock embeds workspace snapshot + draft.v1 text", async () => {
  await withTempWorkspace(async (root) => {
    await writeArtifact(
      root,
      "monetization-ask-result.md",
      "response_classification: yes",
    );
    const evidence = await collectFoundationEvidence({ workspaceRoot: root });
    const block = formatEvidenceContextBlock(evidence);
    assert.match(block, /Workspace Evidence Snapshot \(Sub-AC 2\)/);
    assert.match(block, /collected_at:/);
    assert.match(block, /artifacts_completeness:/);
    assert.match(block, /monetization_signal: yes/);
    assert.match(block, /Pre-collected Evidence \(draft\.v1\)/);
  });
});

test("formatEvidenceContextBlock returns empty string for empty workspace", () => {
  assert.equal(formatEvidenceContextBlock(null), "");
  assert.equal(formatEvidenceContextBlock({ workspace_root: "" }), "");
});

// ────────────── unit-level helpers ──────────────

test("parseMonetizationClassification handles markdown variations", () => {
  const { parseMonetizationClassification } = __test__;
  assert.equal(parseMonetizationClassification("- response_classification: yes"), "yes");
  assert.equal(parseMonetizationClassification("response-classification = no_reply"), "no_reply");
  assert.equal(parseMonetizationClassification('response_classification: "no"'), "no");
  assert.equal(parseMonetizationClassification("classification: maybe"), "maybe");
  assert.equal(parseMonetizationClassification(""), null);
  assert.equal(parseMonetizationClassification("관심 있다 했음"), null);
});

test("countMonetizationYes counts repeated yes blocks", () => {
  const { countMonetizationYes } = __test__;
  const body = [
    "- response_classification: yes",
    "- response_classification: no",
    "- response_classification: yes",
  ].join("\n");
  assert.equal(countMonetizationYes(body), 2);
});

test("recommendGoNoGo returns continue when at least 1 yes, regardless of completeness", () => {
  const { recommendGoNoGo } = __test__;
  const result = recommendGoNoGo({
    monetization: { present: true, classification: "yes", response_yes_count: 1 },
    completeness: 0.3,
    days: [],
  });
  assert.equal(result.recommendation, "continue");
});

test("recommendGoNoGo returns restart when monetization-ask file absent", () => {
  const { recommendGoNoGo } = __test__;
  const result = recommendGoNoGo({
    monetization: { present: false, classification: null, response_yes_count: 0 },
    completeness: 0.9,
    days: [],
  });
  assert.equal(result.recommendation, "restart");
  assert.match(result.reason, /monetization-ask-result\.md/);
});
