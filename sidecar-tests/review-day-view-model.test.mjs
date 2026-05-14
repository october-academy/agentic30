import test from "node:test";
import assert from "node:assert/strict";

import {
  REVIEW_DAY_VIEW_MODEL_SCHEMA_VERSION,
  buildReviewDayViewModel,
} from "../sidecar/review-day-view-model.mjs";
import { composeReviewDayMetricsDashboard } from "../sidecar/review-day-metrics-collector.mjs";
import { renderReviewDayUIComposition } from "../sidecar/review-day-ui-composition.mjs";

test("buildReviewDayViewModel selectively projects curated metrics, insights, and next steps", () => {
  const collectedModel = composeReviewDayMetricsDashboard({
    reviewDay: 14,
    dayRange: { start: 8, end: 14 },
    summaryDashboard: {
      curated_metrics: [
        {
          label: "Verified actions",
          value: "4",
          trend: "evidence-backed",
          intent: "Review에 표시할 검증된 실행 수",
          status: "healthy",
          sourceCategory: "summary",
          priorityScore: 999,
        },
      ],
      agent_insights: ["자동 검증된 실행은 다음 주 난이도를 올리는 근거로 충분합니다."],
      action_items: ["Day 15 전에 응답 링크 1개를 추가로 남겨보세요."],
      tone: "achievement_summary",
    },
    curriculumSignals: {
      has_signals: true,
      dashboard_metrics: [{ label: "Answered questions", value: "19", trend: "complete" }],
      dashboard_insights: ["Curriculum-only insight"],
      dashboard_action_items: ["Curriculum next step"],
    },
    verificationSignals: {
      hasSignals: true,
      metrics: [{ label: "Auto verification sources", value: "2", trend: "mcp+browser" }],
      insights: ["Verification-only insight"],
      actionItems: ["Verification next step"],
    },
    progress: {
      completed_days: 14,
      incomplete_actions: 1,
      days_elapsed: 5,
    },
    now: new Date("2026-05-14T11:00:00.000Z"),
  });

  const viewModel = buildReviewDayViewModel({ collectedModel });

  assert.equal(viewModel.schemaVersion, REVIEW_DAY_VIEW_MODEL_SCHEMA_VERSION);
  assert.equal(viewModel.componentType, "curriculum_review_day_view_model");
  assert.equal(viewModel.reviewDay, 14);
  assert.deepEqual(viewModel.dayRange, { start: 8, end: 14 });
  assert.equal(viewModel.tone, "achievement_summary");
  assert.equal(viewModel.isEmpty, false);

  assert.ok(viewModel.curatedMetrics.length > 0);
  assert.ok(viewModel.curatedMetrics.every((metric) => (
    Object.keys(metric).every((key) => ["label", "value", "trend", "intent", "status"].includes(key))
  )));
  assert.ok(viewModel.insights.includes("Verification-only insight"));
  assert.ok(viewModel.nextSteps.includes("Verification next step"));

  assert.deepEqual(Object.keys(viewModel).sort(), [
    "componentType",
    "curatedMetrics",
    "dayRange",
    "insights",
    "isEmpty",
    "nextSteps",
    "reviewDay",
    "schemaVersion",
    "tone",
  ]);
  assert.equal("sourceCategories" in viewModel, false);
  assert.equal("source_categories" in viewModel, false);
  assert.equal("priorityTrace" in viewModel, false);
  assert.equal("priority_trace" in viewModel, false);
  assert.equal("progress" in viewModel, false);
  assert.equal("dashboard" in viewModel, false);
  assert.equal("actionItems" in viewModel, false);
});

test("buildReviewDayViewModel accepts dashboard aliases while hiding collector internals", () => {
  const viewModel = buildReviewDayViewModel({
    collectedModel: {
      review_day: 7,
      day_range: { start: 1, end: 7 },
      dashboard: {
        curated_metrics: [
          {
            label: "미완료 Carry-over",
            value: "2",
            trend: "non-blocking",
            intent: "다음 주에 다시 제시할 실행 수",
            status: "watch",
            source_category: "curriculum",
            priority_rank: 1,
          },
        ],
        agent_insights: ["미완료는 진행을 막지 않고 다음 Action 카드에서 다시 다룹니다."],
        action_items: ["가장 작은 후속 메시지 1개를 오늘 보내보세요."],
        tone: "deceleration_coaching",
      },
      source_statuses: [{ type: "curriculum", available: true }],
      priority_trace: { metrics: [{ label: "미완료 Carry-over" }] },
    },
  });

  assert.deepEqual(viewModel.curatedMetrics, [
    {
      label: "미완료 Carry-over",
      value: "2",
      trend: "non-blocking",
      intent: "다음 주에 다시 제시할 실행 수",
      status: "watch",
    },
  ]);
  assert.deepEqual(viewModel.insights, [
    "미완료는 진행을 막지 않고 다음 Action 카드에서 다시 다룹니다.",
  ]);
  assert.deepEqual(viewModel.nextSteps, [
    "가장 작은 후속 메시지 1개를 오늘 보내보세요.",
  ]);
  assert.equal(JSON.stringify(viewModel).includes("source_statuses"), false);
  assert.equal(JSON.stringify(viewModel).includes("priority_trace"), false);
  assert.equal(JSON.stringify(viewModel).includes("source_category"), false);
});

test("renderReviewDayUIComposition exposes the selective review-day view model", () => {
  const composition = renderReviewDayUIComposition({
    daySpec: {
      day_id: 21,
      title: "Evidence Review",
    },
    reviewSummary: {
      summary_text: "실행 증거를 중심으로 다음 병목을 정리했습니다.",
    },
    dashboard: {
      curated_metrics: [
        {
          label: "검증된 Actions",
          value: "6",
          trend: "evidence-backed",
          source_category: "verification",
        },
      ],
      agent_insights: ["검증된 Action이 충분해 다음 주 선행 조건을 올려도 됩니다."],
      action_items: ["다음 가격 ask는 링크 증거까지 한 번에 남겨보세요."],
      source_categories: [{ category: "verification", raw: { secret: "hidden" } }],
      tone: "achievement_summary",
    },
    now: new Date("2026-05-14T15:00:00.000Z"),
  });

  assert.equal(composition.viewModel.componentType, "curriculum_review_day_view_model");
  assert.equal(composition.viewModel.reviewDay, 21);
  assert.deepEqual(composition.viewModel.curatedMetrics, [
    {
      label: "검증된 Actions",
      value: "6",
      trend: "evidence-backed",
      intent: "",
      status: "",
    },
  ]);
  assert.deepEqual(composition.viewModel.insights, [
    "검증된 Action이 충분해 다음 주 선행 조건을 올려도 됩니다.",
  ]);
  assert.deepEqual(composition.viewModel.nextSteps, [
    "다음 가격 ask는 링크 증거까지 한 번에 남겨보세요.",
  ]);
  assert.deepEqual(composition.card.viewModel, composition.viewModel);
  assert.equal(JSON.stringify(composition.viewModel).includes("secret"), false);
  assert.equal(JSON.stringify(composition.viewModel).includes("source_categories"), false);
});
