import test from "node:test";
import assert from "node:assert/strict";

import {
  REVIEW_DAY_METRICS_COLLECTOR_SCHEMA_VERSION,
  REVIEW_DAY_DISPLAY_LIMITS,
  REVIEW_DAY_PRIORITY_SCHEMA_VERSION,
  collectReviewDayMetricsDashboard,
  composeReviewDayMetricsDashboard,
  dedupeReviewDashboardInsights,
  dedupeReviewDashboardMetrics,
  prioritizeReviewDashboardInsights,
  prioritizeReviewDashboardMetrics,
  scoreReviewDashboardMetric,
} from "../sidecar/review-day-metrics-collector.mjs";

test("composeReviewDayMetricsDashboard merges summary, curriculum, workspace, coaching, and verification outputs", () => {
  const dashboard = composeReviewDayMetricsDashboard({
    reviewDay: 14,
    dayRange: { start: 8, end: 14 },
    summaryDashboard: {
      curated_metrics: [
        { label: "Review range", value: "Day 8-14", trend: "filtered" },
        { label: "Verified actions", value: "3", trend: "evidence-backed" },
      ],
      agent_insights: ["Summary insight"],
      action_items: ["Summary action"],
      tone: "achievement_summary",
    },
    curriculumSignals: {
      schema: "agentic30.curriculum.review_day_curriculum_signals.v1",
      review_day: 14,
      day_range: { start: 8, end: 14 },
      has_signals: true,
      completed_day_count: 6,
      dashboard_metrics: [
        { label: "Answered questions", value: "18", trend: "complete" },
        { label: "Verified actions", value: "3", trend: "evidence-backed" },
      ],
      dashboard_insights: ["Curriculum insight"],
      dashboard_action_items: ["Curriculum action"],
    },
    workspaceSignals: {
      schema: "agentic30.curriculum.review_day_workspace_signals.v1",
      review_day: 14,
      workspace_root: "/tmp/project",
      sources: {
        localWorkspace: { available: true },
        mcp: { available: true },
        cli: { available: false },
      },
      local_docs: [
        { type: "icp", found: true, required: true },
        { type: "values", found: true, required: true },
        { type: "goal", found: false, required: true },
        { type: "spec", found: false, required: true },
      ],
      dashboard_metrics: [{ label: "Project docs", value: "2/4", trend: "partial" }],
      dashboard_insights: ["Workspace insight"],
      dashboard_action_items: ["Workspace action"],
    },
    coachingSignals: {
      has_signals: true,
      dashboard_metrics: [{ label: "Adaptive direction", value: "up", trend: "rushing" }],
      dashboard_insights: ["Coaching insight"],
      dashboard_action_items: ["Coaching action"],
    },
    verificationSignals: {
      hasSignals: true,
      metrics: [{ label: "Auto verification sources", value: "2", trend: "mcp+browser" }],
      insights: ["Verification insight"],
      actionItems: ["Verification action"],
    },
    progress: {
      completed_days: 14,
      incomplete_actions: 1,
      days_elapsed: 5,
    },
    now: new Date("2026-05-14T09:00:00.000Z"),
  });

  assert.equal(dashboard.schemaVersion, REVIEW_DAY_METRICS_COLLECTOR_SCHEMA_VERSION);
  assert.equal(dashboard.schema, "agentic30.curriculum.review_day_metrics_dashboard.v1");
  assert.equal(dashboard.generatedAt, "2026-05-14T09:00:00.000Z");
  assert.equal(dashboard.review_day, 14);
  assert.deepEqual(dashboard.day_range, { start: 8, end: 14 });
  assert.equal(dashboard.tone, "achievement_summary");
  assert.equal(dashboard.has_dashboard_data, true);

  assert.deepEqual(
    dashboard.source_categories.map((source) => [source.category, source.available]),
    [
      ["summary", true],
      ["curriculum", true],
      ["workspace", true],
      ["coaching", true],
      ["verification", true],
    ],
  );
  assert.equal(dashboard.source_categories.find((source) => source.category === "summary").metric_count, 2);
  assert.equal(dashboard.source_categories.find((source) => source.category === "curriculum").metric_count, 2);
  assert.ok(dashboard.source_categories.find((source) => source.category === "workspace").metric_count >= 1);
  assert.equal(dashboard.source_categories.find((source) => source.category === "coaching").metric_count, 1);
  assert.equal(dashboard.source_categories.find((source) => source.category === "verification").metric_count, 1);
  assert.equal(dashboard.available_source_count, 5);
  assert.deepEqual(dashboard.missing_sources, []);

  assert.deepEqual(
    dashboard.curated_metrics.slice(0, 4).map((metric) => [metric.label, metric.value, metric.source_category]),
    [
      ["External verification sources", "1/5", "workspace"],
      ["Auto verification sources", "2", "verification"],
      ["Workspace sources", "3/7", "workspace"],
      ["Workspace docs", "2/4", "workspace"],
    ],
  );
  assert.equal(dashboard.priority_schema_version, REVIEW_DAY_PRIORITY_SCHEMA_VERSION);
  assert.deepEqual(
    dashboard.curated_metrics.slice(0, 4).map((metric) => metric.priority_rank),
    [1, 2, 3, 4],
  );
  assert.ok(dashboard.curated_metrics[0].priority_score > dashboard.curated_metrics.at(-1).priority_score);
  assert.deepEqual(
    dashboard.priority_trace.metrics.slice(0, 2).map((entry) => [entry.rank, entry.label, entry.score]),
    [
      [1, "External verification sources", 48],
      [2, "Auto verification sources", 46],
    ],
  );
  assert.ok(dashboard.curated_metrics.some((metric) => metric.label === "Workspace docs" && metric.value === "2/4"));
  assert.ok(dashboard.curated_metrics.some((metric) => metric.label === "Adaptive direction" && metric.source_category === "coaching"));
  assert.ok(dashboard.curated_metrics.some((metric) => metric.label === "Auto verification sources" && metric.source_category === "verification"));
  assert.deepEqual(dashboard.agent_insights.slice(0, 2), [
    "자동 검증 소스 1개를 Action 증거 확인에 바로 쓸 수 있습니다.",
    "Verification insight",
  ]);
  assert.ok(dashboard.agent_insights.some((insight) => insight.includes("Review 판단 근거")));
  assert.ok(dashboard.agent_insights.includes("Coaching insight"));
  assert.ok(dashboard.agent_insights.includes("Verification insight"));
  assert.deepEqual(dashboard.action_items.slice(0, 2), ["Summary action", "Curriculum action"]);
  assert.ok(dashboard.action_items.some((item) => item.includes("GOAL")));
  assert.ok(dashboard.action_items.includes("Coaching action"));
  assert.ok(dashboard.action_items.includes("Verification action"));
  assert.deepEqual(dashboard.progress, {
    completedDays: 14,
    completed_days: 14,
    incompleteActions: 1,
    incomplete_actions: 1,
    daysElapsed: 5,
    days_elapsed: 5,
  });
  assert.deepEqual(dashboard.dashboard, {
    curated_metrics: dashboard.curated_metrics,
    agent_insights: dashboard.agent_insights,
    action_items: dashboard.action_items,
    tone: "achievement_summary",
  });
});

test("composeReviewDayMetricsDashboard dedupes collected dashboard metrics and insights across sources", () => {
  const dashboard = composeReviewDayMetricsDashboard({
    reviewDay: 7,
    summaryDashboard: {
      curated_metrics: [
        { label: "Verified actions", value: "3", trend: "evidence-backed" },
        { label: "Completed days", value: "7/7", trend: "complete" },
      ],
      agent_insights: [
        "Action evidence is missing for two carry-over items.",
        "Browser verification passed for the landing page.",
      ],
    },
    curriculumSignals: {
      has_signals: true,
      dashboard_metrics: [
        { label: "Verified action count", value: "3 actions", trend: "evidence backed" },
        { label: "Completed Days", value: "7 / 7", trend: "complete" },
      ],
      dashboard_insights: [
        "Action evidence missing for two carry over items!",
      ],
    },
    verificationSignals: {
      hasSignals: true,
      metrics: [
        { label: "Verified action total", value: "3", trend: "proof" },
      ],
      insights: [
        "Action evidence missing for two carry-over items.",
        "Browser verification passed for the landing page.",
      ],
    },
    now: new Date("2026-05-14T12:00:00.000Z"),
  });

  const verifiedActionMetrics = dashboard.curated_metrics.filter((metric) => (
    /verified action/i.test(metric.label) && metric.value === "3"
  ));
  const completedDayMetrics = dashboard.priority_trace.metrics.filter((metric) => (
    /completed day/i.test(metric.label)
  ));
  assert.equal(verifiedActionMetrics.length, 1);
  assert.equal(verifiedActionMetrics[0].source_category, "verification");
  assert.equal(completedDayMetrics.length, 1);
  assert.equal(completedDayMetrics[0].source_category, "summary");
  assert.equal(dashboard.curated_metrics.length, REVIEW_DAY_DISPLAY_LIMITS.curatedMetrics);
  assert.equal(
    dashboard.agent_insights.filter((insight) => /action evidence/i.test(insight)).length,
    1,
  );
  assert.equal(
    dashboard.agent_insights.filter((insight) => /browser verification/i.test(insight)).length,
    1,
  );
});

test("composeReviewDayMetricsDashboard applies final curated display limits after ranking", () => {
  const dashboard = composeReviewDayMetricsDashboard({
    reviewDay: 21,
    summaryDashboard: {
      curated_metrics: Array.from({ length: 9 }, (_, index) => ({
        label: `Ranked metric ${index + 1}`,
        value: String(index + 1),
        priority: 9 - index,
      })),
      agent_insights: Array.from({ length: 7 }, (_, index) => `Neutral insight ${index + 1}`),
      action_items: Array.from({ length: 8 }, (_, index) => `Summary action ${index + 1}`),
    },
    now: new Date("2026-05-14T13:00:00.000Z"),
  });

  assert.equal(dashboard.curated_metrics.length, REVIEW_DAY_DISPLAY_LIMITS.curatedMetrics);
  assert.equal(dashboard.agent_insights.length, REVIEW_DAY_DISPLAY_LIMITS.agentInsights);
  assert.equal(dashboard.action_items.length, REVIEW_DAY_DISPLAY_LIMITS.actionItems);
  assert.deepEqual(dashboard.display_limits, REVIEW_DAY_DISPLAY_LIMITS);
  assert.deepEqual(
    dashboard.curated_metrics.map((metric) => metric.label),
    [
      "Ranked metric 1",
      "Ranked metric 2",
      "Ranked metric 3",
      "Ranked metric 4",
      "Ranked metric 5",
      "Ranked metric 6",
    ],
  );
  assert.deepEqual(
    dashboard.agent_insights,
    [
      "Neutral insight 1",
      "Neutral insight 2",
      "Neutral insight 3",
      "Neutral insight 4",
      "Neutral insight 5",
    ],
  );
  assert.deepEqual(
    dashboard.action_items,
    [
      "Summary action 1",
      "Summary action 2",
      "Summary action 3",
      "Summary action 4",
      "Summary action 5",
    ],
  );
});

test("composeReviewDayMetricsDashboard preserves selected ordering when trimming mixed source output", () => {
  const dashboard = composeReviewDayMetricsDashboard({
    reviewDay: 28,
    summaryDashboard: {
      curated_metrics: [
        { label: "Summary steady progress", value: "7/7", priority: 2 },
        { label: "Summary neutral note", value: "ok", priority: 1 },
      ],
      agent_insights: ["Summary first", "Summary second", "Summary third"],
      action_items: ["Summary action A", "Summary action B"],
    },
    verificationSignals: {
      has_signals: true,
      metrics: [
        { label: "Verification risk one", value: "missing", priority: 5 },
        { label: "Verification risk two", value: "failed", priority: 4 },
        { label: "Verification risk three", value: "pending", priority: 3 },
        { label: "Verification risk four", value: "evidence", priority: 2 },
        { label: "Verification risk five", value: "proof", priority: 1 },
      ],
      insights: ["Verification first", "Verification second", "Verification third"],
      actionItems: ["Verification action A", "Verification action B", "Verification action C", "Verification action D"],
    },
    now: new Date("2026-05-14T13:30:00.000Z"),
  });

  assert.equal(dashboard.curated_metrics.length, REVIEW_DAY_DISPLAY_LIMITS.curatedMetrics);
  assert.deepEqual(
    dashboard.curated_metrics.map((metric) => metric.label),
    dashboard.priority_trace.metrics
      .slice(0, REVIEW_DAY_DISPLAY_LIMITS.curatedMetrics)
      .map((entry) => entry.label),
  );
  assert.deepEqual(
    dashboard.action_items,
    ["Summary action A", "Summary action B", "Verification action A", "Verification action B", "Verification action C"],
  );
  assert.deepEqual(
    dashboard.dashboard.curated_metrics.map((metric) => metric.label),
    dashboard.curated_metrics.map((metric) => metric.label),
  );
  assert.deepEqual(dashboard.dashboard.action_items, dashboard.action_items);
});

test("collectReviewDayMetricsDashboard invokes curriculum and workspace collectors and normalizes missing categories", async () => {
  const statCalls = [];
  const fsImpl = {
    async stat(path) {
      statCalls.push(path);
      if (path.endsWith("/workspace") || path.endsWith("/workspace/docs/ICP.md")) {
        return {
          isDirectory: () => path.endsWith("/workspace"),
          isFile: () => path.endsWith("/workspace/docs/ICP.md"),
        };
      }
      throw new Error("missing");
    },
  };

  const dashboard = await collectReviewDayMetricsDashboard({
    reviewDay: 7,
    summaryDashboard: {
      metrics: [{ label: "Review range", value: "Day 1-7" }],
      insights: ["Base summary"],
      actionItems: ["Base next step"],
      tone: "deceleration_coaching",
    },
    progressState: {
      dayRecords: [
        {
          day: 1,
          completed: true,
          question_progress: [{ question_id: "q1", answer: "Answered", status: "answered" }],
          actions: [
            {
              action_id: "a1",
              action_description: "Publish interview ask",
              verification_result: { passed: true, method: "browser" },
            },
          ],
        },
      ],
      carry_over_queue: [{ source_day: 2, action_description: "Follow up", times_carried: 1 }],
    },
    workspaceRoot: "/tmp/workspace",
    fsImpl,
    now: new Date("2026-05-14T10:00:00.000Z"),
  });

  assert.equal(dashboard.review_day, 7);
  assert.equal(dashboard.generated_at, "2026-05-14T10:00:00.000Z");
  assert.deepEqual(dashboard.day_range, { start: 1, end: 7 });
  assert.equal(dashboard.tone, "deceleration_coaching");
  assert.ok(statCalls.some((entry) => entry.endsWith("/workspace/docs/ICP.md")));

  const byCategory = new Map(dashboard.source_statuses.map((source) => [source.type, source]));
  assert.equal(byCategory.get("summary").available, true);
  assert.equal(byCategory.get("curriculum").available, true);
  assert.equal(byCategory.get("workspace").available, true);
  assert.equal(byCategory.get("coaching").available, false);
  assert.equal(byCategory.get("verification").available, false);
  assert.deepEqual(dashboard.missing_sources, ["coaching", "verification"]);

  assert.ok(dashboard.curated_metrics.some((metric) => metric.source_category === "curriculum"));
  assert.ok(dashboard.priority_trace.metrics.some((metric) => metric.source_category === "workspace"));
  assert.equal(dashboard.curated_metrics.length, REVIEW_DAY_DISPLAY_LIMITS.curatedMetrics);
  assert.ok(dashboard.priority_trace.insights.some((insight) => insight.text.includes("Base summary")));
  assert.equal(dashboard.agent_insights.length, REVIEW_DAY_DISPLAY_LIMITS.agentInsights);
  assert.ok(dashboard.action_items.some((item) => item.includes("Base next step")));
  assert.equal(dashboard.progress.completed_days, 1);
});

test("prioritizeReviewDashboardMetrics scores explicit priority, risk, evidence, and stable ranks", () => {
  const scored = prioritizeReviewDashboardMetrics([
    {
      label: "Answered questions",
      value: "20",
      trend: "complete",
      sourceCategory: "summary",
    },
    {
      label: "미완료 Carry-over",
      value: "3",
      trend: "needs coaching",
      sourceCategory: "curriculum",
    },
    {
      label: "Auto verification sources",
      value: "2",
      trend: "evidence-backed",
      sourceCategory: "verification",
    },
    {
      label: "Founder note",
      value: "1",
      priority: 5,
      sourceCategory: "summary",
    },
  ]);

  assert.equal(scored.schema_version, REVIEW_DAY_PRIORITY_SCHEMA_VERSION);
  assert.deepEqual(
    scored.items.map((metric) => [metric.priority_rank, metric.label, metric.priority_score]),
    [
      [1, "미완료 Carry-over", 80],
      [2, "Founder note", 58],
      [3, "Auto verification sources", 46],
      [4, "Answered questions", 16],
    ],
  );
  assert.deepEqual(
    scored.items.map((metric) => metric.label),
    [
      "미완료 Carry-over",
      "Founder note",
      "Auto verification sources",
      "Answered questions",
    ],
  );
  assert.ok(scored.items[0].priority_reasons.some((reason) => reason.reason === "risk_or_gap"));
  assert.ok(scored.items[1].priority_reasons.some((reason) => reason.reason === "explicit_priority"));

  const evidenceScore = scoreReviewDashboardMetric({
    label: "Auto verification sources",
    trend: "evidence-backed",
    sourceCategory: "verification",
  });
  assert.equal(evidenceScore.score, 46);
  assert.deepEqual(
    evidenceScore.reasons.map((reason) => reason.reason),
    ["source:verification", "evidence"],
  );
});

test("dedupeReviewDashboardMetrics collapses exact metric identity and near-duplicate labels", () => {
  const deduped = dedupeReviewDashboardMetrics([
    {
      label: "Auto verification sources",
      value: "2",
      trend: "evidence-backed",
      sourceCategory: "summary",
    },
    {
      label: "Auto verification sources",
      value: "2",
      trend: "evidence-backed",
      sourceCategory: "verification",
    },
    {
      label: "Verified action count",
      value: "3 actions",
      trend: "proof",
      sourceCategory: "curriculum",
    },
    {
      label: "Verified Actions",
      value: "3",
      trend: "evidence-backed",
      sourceCategory: "summary",
    },
    {
      label: "Incomplete carry-over",
      value: "1",
      sourceCategory: "coaching",
    },
  ]);

  assert.deepEqual(
    deduped.map((metric) => [metric.label, metric.value, metric.source_category]),
    [
      ["Auto verification sources", "2", "verification"],
      ["Verified action count", "3 actions", "curriculum"],
      ["Incomplete carry-over", "1", "coaching"],
    ],
  );
});

test("prioritizeReviewDashboardMetrics tie-breaks by source order then input order", () => {
  const tiedBySource = prioritizeReviewDashboardMetrics([
    {
      label: "Connector tie",
      sourceCategory: "verification",
    },
    {
      label: "Summary tie",
      sourceCategory: "summary",
      priority: 1.6,
    },
  ]);
  assert.deepEqual(
    tiedBySource.items.map((metric) => [metric.label, metric.priority_score]),
    [
      ["Summary tie", 24],
      ["Connector tie", 24],
    ],
  );

  const tiedByInput = prioritizeReviewDashboardMetrics([
    {
      label: "B same-source tie",
      sourceCategory: "workspace",
    },
    {
      label: "A same-source tie",
      sourceCategory: "workspace",
    },
  ]);
  assert.deepEqual(
    tiedByInput.items.map((metric) => metric.label),
    ["B same-source tie", "A same-source tie"],
  );
});

test("prioritizeReviewDashboardInsights orders insight copy with the same scoring rules and dedupes", () => {
  const prioritized = prioritizeReviewDashboardInsights([
    { text: "Summary progress looks steady.", sourceCategory: "summary" },
    { text: "Action evidence is missing for two carry-over items.", sourceCategory: "curriculum" },
    { text: "Browser verification passed for the landing page.", sourceCategory: "verification" },
    { text: "Action evidence is missing for two carry-over items.", sourceCategory: "workspace" },
  ]);

  assert.deepEqual(prioritized.items, [
    "Action evidence is missing for two carry-over items.",
    "Browser verification passed for the landing page.",
    "Summary progress looks steady.",
  ]);
  assert.deepEqual(
    prioritized.trace.map((entry) => [entry.rank, entry.source_category]),
    [
      [1, "curriculum"],
      [2, "verification"],
      [3, "summary"],
    ],
  );
});

test("dedupeReviewDashboardInsights collapses exact and near-duplicate insight copy", () => {
  const deduped = dedupeReviewDashboardInsights([
    { text: "Browser verification passed for the landing page.", sourceCategory: "summary" },
    { text: "Browser verification passed for the landing page.", sourceCategory: "verification" },
    { text: "Action evidence is missing for two carry-over items.", sourceCategory: "curriculum" },
    { text: "Action evidence missing for two carry over items!", sourceCategory: "verification" },
    { text: "Summary progress looks steady.", sourceCategory: "summary" },
  ]);

  assert.deepEqual(deduped, [
    "Browser verification passed for the landing page.",
    "Action evidence missing for two carry over items!",
    "Summary progress looks steady.",
  ]);
});

test("composeReviewDayMetricsDashboard returns a complete empty dashboard when no source output is present", () => {
  const dashboard = composeReviewDayMetricsDashboard({
    reviewDay: 28,
    now: new Date("2026-05-14T11:00:00.000Z"),
  });

  assert.equal(dashboard.review_day, 28);
  assert.equal(dashboard.has_dashboard_data, false);
  assert.deepEqual(dashboard.curated_metrics, []);
  assert.deepEqual(dashboard.agent_insights, []);
  assert.deepEqual(dashboard.action_items, []);
  assert.deepEqual(dashboard.missing_sources, [
    "summary",
    "curriculum",
    "workspace",
    "coaching",
    "verification",
  ]);
  assert.equal(dashboard.available_source_count, 0);
  assert.equal(dashboard.missing_source_count, 5);
});
