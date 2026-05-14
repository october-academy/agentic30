import test from "node:test";
import assert from "node:assert/strict";

import {
  REVIEW_DAY_UI_COMPOSITION_SCHEMA_VERSION,
  renderReviewDayUIComposition,
} from "../sidecar/review-day-ui-composition.mjs";

test("renderReviewDayUIComposition displays summary and dashboard child modules with review-day data", () => {
  const composition = renderReviewDayUIComposition({
    daySpec: {
      day_id: 21,
      title: "Launch Review",
      day_goal: "공개 실행 증거와 응답 숫자로 다음 실험을 고른다",
    },
    reviewSummary: {
      summary_text: "이번 주는 공개 실행을 빠르게 만들었고 DM 응답률을 다음 병목으로 확인했습니다.",
      key_insights: [
        "조회수보다 직접 응답을 우선해야 합니다.",
        "증거 링크가 있는 Action은 다음 주 난이도를 올려도 됩니다.",
      ],
    },
    dashboard: {
      curated_metrics: [
        { label: "완료 Days", value: "21/21", trend: "fast" },
        { label: "검증된 Actions", value: "6", trend: "+2" },
      ],
      agent_insights: ["속도는 좋지만 Day 22 전에는 실제 응답 1개를 더 확보해보세요."],
      action_items: ["다음 가격 ask를 후보 1명에게 보내고 응답 링크를 남겨보세요."],
      tone: "achievement_summary",
    },
    progress: {
      completed_days: 21,
      incomplete_actions: 0,
      days_elapsed: 4,
    },
    requestId: "req-review-ui",
    sessionId: "session-review-ui",
    now: new Date("2026-05-14T15:00:00.000Z"),
  });

  assert.equal(composition.schemaVersion, REVIEW_DAY_UI_COMPOSITION_SCHEMA_VERSION);
  assert.equal(composition.componentType, "curriculum_review_day_ui");
  assert.equal(composition.dayId, 21);
  assert.equal(composition.dayType, "review");
  assert.equal(composition.status, "ready");
  assert.equal(composition.createdAt, "2026-05-14T15:00:00.000Z");

  assert.deepEqual(composition.displayedSections, ["summary", "dashboard"]);
  assert.deepEqual(composition.childComponentTypes, [
    "curriculum_review_summary_card",
    "curriculum_review_dashboard",
  ]);
  assert.deepEqual(
    composition.sections.map((section) => ({
      id: section.id,
      kind: section.kind,
      displayed: section.displayed,
      componentType: section.componentType,
    })),
    [
      {
        id: "review-agent-summary",
        kind: "summary",
        displayed: true,
        componentType: "curriculum_review_summary_card",
      },
      {
        id: "review-dashboard",
        kind: "dashboard",
        displayed: true,
        componentType: "curriculum_review_dashboard",
      },
    ],
  );

  const summary = composition.sections[0].data;
  assert.equal(summary.cardType, "curriculum_review_summary_card");
  assert.equal(summary.summaryText, "이번 주는 공개 실행을 빠르게 만들었고 DM 응답률을 다음 병목으로 확인했습니다.");
  assert.match(summary.formattedMarkdown, /### Agent Summary/);
  assert.match(summary.formattedMarkdown, /- 완료 Days: 21\/21 \(fast\)/);
  assert.equal(summary.structuredPrompt.requestId, "req-review-ui");
  assert.equal(summary.structuredPrompt.sessionId, "session-review-ui");

  const dashboard = composition.sections[1].data;
  assert.equal(dashboard.componentType, "curriculum_review_dashboard");
  assert.equal(dashboard.tone, "achievement_summary");
  assert.deepEqual(dashboard.labels, ["완료 Days", "검증된 Actions"]);
  assert.deepEqual(dashboard.values, ["21/21", "6"]);
  assert.deepEqual(dashboard.agentInsights, [
    "속도는 좋지만 Day 22 전에는 실제 응답 1개를 더 확보해보세요.",
  ]);
  assert.deepEqual(dashboard.actionItems, [
    "다음 가격 ask를 후보 1명에게 보내고 응답 링크를 남겨보세요.",
  ]);

  assert.equal(composition.card.layout, "review_day_summary_dashboard_composition");
  assert.deepEqual(composition.card.sections.map((section) => section.kind), ["summary", "dashboard"]);
});

test("renderReviewDayUIComposition keeps non-curated collected model fields out of dashboard render data", () => {
  const composition = renderReviewDayUIComposition({
    daySpec: {
      day_id: 7,
      title: "Go/No-Go Review",
    },
    reviewSummary: {
      summary_text: "Day 1-7 근거만 요약합니다.",
    },
    dashboard: {
      curated_metrics: [
        {
          label: "검증된 Actions",
          value: "3",
          trend: "evidence-backed",
          intent: "Review Day에 표시할 검증된 실행 수",
          status: "healthy",
          source_category: "verification",
          priority_trace: "SECRET_SOURCE_TRACE_DO_NOT_RENDER",
        },
      ],
      agent_insights: ["표시 가능한 인사이트만 렌더링합니다."],
      action_items: ["다음 Action Day에서 링크 증거를 남겨보세요."],
      source_statuses: [{ name: "browser", token: "SECRET_SOURCE_STATUS_DO_NOT_RENDER" }],
      source_categories: [{ category: "verification", raw: "SECRET_SOURCE_CATEGORY_DO_NOT_RENDER" }],
      raw_collected_model: "SECRET_RAW_MODEL_DO_NOT_RENDER",
      priority_trace: "SECRET_PRIORITY_TRACE_DO_NOT_RENDER",
      tone: "achievement_summary",
    },
    now: new Date("2026-05-14T15:00:00.000Z"),
  });

  const dashboard = composition.sections.find((section) => section.kind === "dashboard").data;
  const rendered = JSON.stringify({
    viewModel: composition.viewModel,
    dashboard,
    card: composition.card,
  });

  assert.deepEqual(composition.viewModel.curatedMetrics, [
    {
      label: "검증된 Actions",
      value: "3",
      trend: "evidence-backed",
      intent: "Review Day에 표시할 검증된 실행 수",
      status: "healthy",
    },
  ]);
  assert.deepEqual(dashboard.labels, ["검증된 Actions"]);
  assert.deepEqual(dashboard.values, ["3"]);
  assert.ok(rendered.includes("표시 가능한 인사이트만 렌더링합니다."));
  assert.equal(rendered.includes("SECRET_SOURCE_TRACE_DO_NOT_RENDER"), false);
  assert.equal(rendered.includes("SECRET_SOURCE_STATUS_DO_NOT_RENDER"), false);
  assert.equal(rendered.includes("SECRET_SOURCE_CATEGORY_DO_NOT_RENDER"), false);
  assert.equal(rendered.includes("SECRET_RAW_MODEL_DO_NOT_RENDER"), false);
  assert.equal(rendered.includes("SECRET_PRIORITY_TRACE_DO_NOT_RENDER"), false);
  assert.equal(rendered.includes("source_statuses"), false);
  assert.equal(rendered.includes("source_categories"), false);
  assert.equal(rendered.includes("raw_collected_model"), false);
});

test("renderReviewDayUIComposition preserves full collected model off-display while rendering curated projection", () => {
  const fullCollectedModel = {
    schema: "agentic30.curriculum.review_day_metrics_dashboard.v1",
    review_day: 14,
    day_range: { start: 8, end: 14 },
    generated_at: "2026-05-14T14:00:00.000Z",
    dashboard: {
      curated_metrics: [
        {
          label: "검증된 Actions",
          value: "4",
          trend: "evidence-backed",
          intent: "Review Day에 표시할 실행 증거",
          status: "healthy",
          source_category: "verification",
          priority_rank: 1,
        },
      ],
      agent_insights: ["표시 가능한 Review 인사이트입니다."],
      action_items: ["다음 Action은 증거 링크와 함께 남겨보세요."],
      tone: "achievement_summary",
    },
    source_categories: [
      {
        category: "verification",
        available: true,
        raw: {
          browser_trace: "SECRET_BROWSER_TRACE_OFF_DISPLAY",
          cli_stdout: "SECRET_CLI_STDOUT_OFF_DISPLAY",
        },
      },
    ],
    source_statuses: [{ type: "browser", detail: "SECRET_STATUS_OFF_DISPLAY" }],
    priority_trace: {
      metrics: [{ label: "검증된 Actions", reason: "SECRET_PRIORITY_REASON_OFF_DISPLAY" }],
    },
    raw_collected_model: {
      evidence_refs: ["SECRET_EVIDENCE_REF_OFF_DISPLAY"],
      workspace_snapshot: { path: "/tmp/private-workspace" },
    },
  };

  const composition = renderReviewDayUIComposition({
    daySpec: {
      day_id: 14,
      title: "Evidence Review",
    },
    reviewSummary: {
      summary_text: "이번 주 실행 증거만 요약합니다.",
    },
    dashboard: fullCollectedModel,
    now: new Date("2026-05-14T15:00:00.000Z"),
  });

  assert.deepEqual(composition.reviewDashboardState.fullCollectedModel, fullCollectedModel);
  assert.deepEqual(composition.reviewDashboardState.full_collected_model, fullCollectedModel);
  assert.equal(composition.reviewDashboardState.displayMode, "curated_projection");
  assert.deepEqual(composition.reviewDashboardState.curatedProjection, {
    curatedMetrics: [
      {
        label: "검증된 Actions",
        value: "4",
        trend: "evidence-backed",
        intent: "Review Day에 표시할 실행 증거",
        status: "healthy",
      },
    ],
    curated_metrics: [
      {
        label: "검증된 Actions",
        value: "4",
        trend: "evidence-backed",
        intent: "Review Day에 표시할 실행 증거",
        status: "healthy",
      },
    ],
    agentInsights: ["표시 가능한 Review 인사이트입니다."],
    agent_insights: ["표시 가능한 Review 인사이트입니다."],
    actionItems: ["다음 Action은 증거 링크와 함께 남겨보세요."],
    action_items: ["다음 Action은 증거 링크와 함께 남겨보세요."],
    tone: "achievement_summary",
  });

  const rendered = JSON.stringify({
    viewModel: composition.viewModel,
    card: composition.card,
    sections: composition.sections,
  });

  assert.ok(rendered.includes("표시 가능한 Review 인사이트입니다."));
  assert.equal(rendered.includes("SECRET_BROWSER_TRACE_OFF_DISPLAY"), false);
  assert.equal(rendered.includes("SECRET_CLI_STDOUT_OFF_DISPLAY"), false);
  assert.equal(rendered.includes("SECRET_STATUS_OFF_DISPLAY"), false);
  assert.equal(rendered.includes("SECRET_PRIORITY_REASON_OFF_DISPLAY"), false);
  assert.equal(rendered.includes("SECRET_EVIDENCE_REF_OFF_DISPLAY"), false);
  assert.equal(rendered.includes("source_categories"), false);
  assert.equal(rendered.includes("priority_trace"), false);
  assert.equal(rendered.includes("raw_collected_model"), false);
});
