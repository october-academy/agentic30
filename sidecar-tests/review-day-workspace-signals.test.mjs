import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  REVIEW_DAY_WORKSPACE_SIGNAL_SCHEMA_VERSION,
  collectReviewDayWorkspaceSignals,
  normalizeReviewDayWorkspaceSignals,
} from "../sidecar/review-day-workspace-signals.mjs";
import {
  generateReviewDaySummary,
} from "../sidecar/review-day-summary.mjs";

async function withTempWorkspace(fn) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-review-workspace-signals-"));
  try {
    await fs.mkdir(path.join(root, "docs"), { recursive: true });
    return await fn(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

test("collectReviewDayWorkspaceSignals normalizes readable workspace docs and external source state", async () => {
  await withTempWorkspace(async (root) => {
    await fs.writeFile(path.join(root, "docs", "ICP.md"), "# ICP\n전업 1인 개발자\n");
    await fs.writeFile(path.join(root, "docs", "VALUES.md"), "# VALUES\nWarm concise coaching\n");
    await fs.writeFile(path.join(root, "docs", "GOAL.md"), "# GOAL\nDay 30 graduation\n");
    await fs.writeFile(path.join(root, "docs", "SPEC.md"), "# SPEC\nReview dashboard metrics\n");
    await fs.writeFile(path.join(root, "README.md"), "# Agentic30\n");

    const signals = await collectReviewDayWorkspaceSignals({
      workspaceRoot: root,
      workspaceState: {
        mcp: { available: true, detail: "list_workspace_files/read_workspace_file" },
        cli: { available: true, detail: "git status ready" },
        browser: { available: false, reason: "not needed for this action" },
        googleDocs: { configured: true, detail: "journal doc connected" },
        googleSheets: { configured: false, reason: "sheet not configured" },
      },
      now: new Date("2026-05-14T03:00:00.000Z"),
    });

    assert.equal(signals.schemaVersion, REVIEW_DAY_WORKSPACE_SIGNAL_SCHEMA_VERSION);
    assert.equal(signals.generatedAt, "2026-05-14T03:00:00.000Z");
    assert.equal(signals.workspaceRoot, root);
    assert.equal(signals.hasSignals, true);
    assert.equal(signals.foundExpectedDocCount, 4);
    assert.equal(signals.expectedDocCount, 4);
    assert.equal(signals.optionalFoundDocCount, 1);
    assert.equal(signals.availableExternalSourceCount, 3);
    assert.deepEqual(
      signals.localDocs
        .filter((doc) => doc.required)
        .map((doc) => [doc.type, doc.path, doc.found]),
      [
        ["icp", "docs/ICP.md", true],
        ["values", "docs/VALUES.md", true],
        ["goal", "docs/GOAL.md", true],
        ["spec", "docs/SPEC.md", true],
      ],
    );
    assert.deepEqual(
      signals.dashboardMetrics.map((metric) => [metric.label, metric.value, metric.trend]),
      [
        ["Workspace sources", "5/7", "missing-sources"],
        ["Workspace docs", "4/4", "context-ready"],
        ["External verification sources", "3/5", "auto-verify-ready"],
        ["Optional workspace refs", "1", "extra-context"],
      ],
    );
    assert.ok(signals.dashboardInsights.some((insight) => insight.includes("필수 문서가 Review Day")));
  });
});

test("normalizeReviewDayWorkspaceSignals handles missing workspace sources without throwing", () => {
  const signals = normalizeReviewDayWorkspaceSignals({
    workspace_root: "",
    sources: {
      localWorkspace: { available: false, reason: "workspace_root_missing" },
      mcp: { available: false, reason: "not configured" },
      cli: { available: false, reason: "not configured" },
      browser: { available: false, reason: "not configured" },
      google_docs: { configured: false, reason: "not connected" },
      google_sheets: { configured: false, reason: "not connected" },
    },
  }, {
    reviewDay: 7,
    eligibleDayRange: { start: 1, end: 7 },
    now: new Date("2026-05-14T04:00:00.000Z"),
  });

  assert.equal(signals.generatedAt, "2026-05-14T04:00:00.000Z");
  assert.equal(signals.reviewDay, 7);
  assert.deepEqual(signals.eligibleDayRange, { start: 1, end: 7 });
  assert.equal(signals.hasSignals, false);
  assert.equal(signals.availableSourceCount, 0);
  assert.equal(signals.missingSourceCount, 7);
  assert.deepEqual(signals.missingRequiredDocs, ["icp", "values", "goal", "spec"]);
  assert.deepEqual(
    signals.dashboardMetrics.map((metric) => [metric.label, metric.value, metric.trend]),
    [
      ["Workspace sources", "0/7", "missing-sources"],
      ["Workspace docs", "0/4", "needs-docs"],
      ["External verification sources", "0/5", "fallback-evidence"],
      ["Optional workspace refs", "0", "minimal-context"],
    ],
  );
  assert.ok(signals.dashboardActionItems.some((item) => item.includes("링크나 파일 증거")));
});

test("generateReviewDaySummary adds normalized workspace metrics to review dashboard", () => {
  const generated = generateReviewDaySummary({
    reviewDay: 14,
    dayRecords: [
      {
        day: 8,
        completed: true,
        question_progress: [{ question_id: "q1", answer: "Included answer", status: "answered" }],
        actions: [{ id: "a1", action_description: "Interview proof", verification_result: { passed: true } }],
      },
    ],
    workspaceSignals: {
      workspace_root: "/tmp/agentic30-workspace",
      sources: {
        localWorkspace: { available: true },
        localDocs: [
          { type: "icp", path: "docs/ICP.md", found: true, required: true },
          { type: "values", path: "docs/VALUES.md", found: true, required: true },
          { type: "goal", path: "", found: false, required: true },
          { type: "spec", path: "docs/SPEC.md", found: true, required: true },
        ],
        mcp: { available: true },
        cli: { available: false },
        browser: { available: true },
        googleDocs: { available: false },
        googleSheets: { available: false },
      },
    },
    now: new Date("2026-05-14T05:00:00.000Z"),
  });

  assert.equal(generated.workspaceSignals.schema, "agentic30.curriculum.review_day_workspace_signals.v1");
  assert.equal(generated.dashboard.workspaceSignals, generated.workspaceSignals);
  assert.deepEqual(
    generated.dashboard.curated_metrics.slice(4).map((metric) => [metric.label, metric.value]),
    [
      ["Workspace sources", "4/7"],
      ["Workspace docs", "3/4"],
      ["External verification sources", "2/5"],
      ["Optional workspace refs", "0"],
    ],
  );
  assert.ok(generated.dashboard.agent_insights.some((insight) => insight.includes("goal")));
  assert.ok(generated.dashboard.action_items.some((item) => item.includes("GOAL")));
});
