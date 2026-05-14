import test from "node:test";
import assert from "node:assert/strict";

import {
  REVIEW_DASHBOARD_PRESENTATION_SCHEMA_VERSION,
  formatReviewDashboardMarkdown,
  renderReviewDashboardPresentation,
} from "../sidecar/review-dashboard-presentation.mjs";

test("renderReviewDashboardPresentation renders key metrics, labels, and values", () => {
  const dashboard = renderReviewDashboardPresentation({
    title: "Week 2 evidence dashboard",
    dashboard: {
      curated_metrics: [
        {
          label: "완료 Days",
          value: "14/14",
          trend: "on-track",
          intent: "Review Day까지 완료한 커리큘럼 진행량",
          status: "healthy",
        },
        {
          label: "검증된 Actions",
          value: "5",
          trend: "+2",
          intent: "자동 검증 또는 증거 제출로 통과한 실행 수",
          status: "improving",
        },
        {
          label: "미완료 Carry-over",
          value: "1",
          trend: "needs coaching",
          intent: "다음 주에 비차단 코칭으로 다시 제시할 행동 수",
          status: "watch",
        },
      ],
      agent_insights: [
        "Build 속도는 좋지만 검증 증거가 부족한 Action은 다음 주 첫 카드에 다시 올리세요.",
      ],
      action_items: [
        "Day 15 전에 가격 ask 응답 1개를 Google Sheet에 기록해보세요.",
      ],
      tone: "achievement_summary",
    },
    progress: {
      completed_days: 14,
      incomplete_actions: 1,
      days_elapsed: 6,
    },
    now: new Date("2026-05-14T12:30:00.000Z"),
  });

  assert.equal(dashboard.schemaVersion, REVIEW_DASHBOARD_PRESENTATION_SCHEMA_VERSION);
  assert.equal(dashboard.componentType, "curriculum_review_dashboard");
  assert.equal(dashboard.title, "Week 2 evidence dashboard");
  assert.equal(dashboard.createdAt, "2026-05-14T12:30:00.000Z");
  assert.equal(dashboard.tone, "achievement_summary");
  assert.equal(dashboard.isEmpty, false);

  assert.deepEqual(dashboard.progress, {
    completedDays: 14,
    incompleteActions: 1,
    daysElapsed: 6,
  });

  assert.deepEqual(dashboard.labels, [
    "완료 Days",
    "검증된 Actions",
    "미완료 Carry-over",
  ]);
  assert.deepEqual(dashboard.values, ["14/14", "5", "1"]);
  assert.deepEqual(dashboard.metricRows, [
    "완료 Days: 14/14 (on-track)",
    "검증된 Actions: 5 (+2)",
    "미완료 Carry-over: 1 (needs coaching)",
  ]);

  assert.deepEqual(dashboard.metrics[1], {
    label: "검증된 Actions",
    value: "5",
    trend: "+2",
    intent: "자동 검증 또는 증거 제출로 통과한 실행 수",
    status: "improving",
  });

  assert.equal(dashboard.cardBlock.kind, "dashboard");
  assert.equal(dashboard.cardBlock.title, "Week 2 evidence dashboard");
  assert.equal(dashboard.cardBlock.metrics.length, 3);
  assert.deepEqual(dashboard.cardBlock.metricRows, dashboard.metricRows);
  assert.deepEqual(dashboard.cardBlock.agentInsights, dashboard.agentInsights);
  assert.deepEqual(dashboard.cardBlock.actionItems, dashboard.actionItems);
});

test("formatReviewDashboardMarkdown renders stable rows for dashboard presentation", () => {
  const markdown = formatReviewDashboardMarkdown({
    metrics: [
      { name: "인터뷰 증거", count: "3", delta: "+1" },
      { label: "BIP 로그", value: "4/5" },
    ],
    insights: ["인터뷰 수는 충분하지만 원문 인용을 더 남겨보세요."],
    actionItems: ["다음 Action은 링크 증거부터 자동 검증해보세요."],
    tone: "deceleration_coaching",
  });

  assert.equal(
    markdown,
    [
      "- 인터뷰 증거: 3 (+1)",
      "- BIP 로그: 4/5",
      "",
      "Agent insights",
      "- 인터뷰 수는 충분하지만 원문 인용을 더 남겨보세요.",
      "",
      "Action items",
      "- 다음 Action은 링크 증거부터 자동 검증해보세요.",
      "",
      "Tone: deceleration_coaching",
    ].join("\n"),
  );
});

test("renderReviewDashboardPresentation preserves deceleration coaching copy for rusher review dashboards", () => {
  const dashboard = renderReviewDashboardPresentation({
    dashboard: {
      curated_metrics: [{ label: "Review 범위", value: "Day 1-7" }],
      tone: "deceleration_coaching",
      coaching_copy: {
        headline: "속도보다 흡수 시간을 먼저 잡아보세요.",
        body: "Day 1-7 기록은 그대로 유지합니다. 오늘은 답변과 실행 증거를 한 번 다시 읽어보세요.",
        reflection_prompt: "가장 중요한 답변 하나를 골라 확인하지 않은 가정을 한 줄로 적어보세요.",
      },
    },
  });

  assert.equal(dashboard.tone, "deceleration_coaching");
  assert.deepEqual(dashboard.coachingCopy, {
    headline: "속도보다 흡수 시간을 먼저 잡아보세요.",
    body: "Day 1-7 기록은 그대로 유지합니다. 오늘은 답변과 실행 증거를 한 번 다시 읽어보세요.",
    reflectionPrompt: "가장 중요한 답변 하나를 골라 확인하지 않은 가정을 한 줄로 적어보세요.",
  });
  assert.deepEqual(dashboard.cardBlock.coachingCopy, dashboard.coachingCopy);
  assert.equal(dashboard.isEmpty, false);

  const markdown = formatReviewDashboardMarkdown({
    metrics: [{ label: "Review 범위", value: "Day 1-7" }],
    tone: "deceleration_coaching",
    coaching: dashboard.coachingCopy,
  });
  assert.match(markdown, /Coaching/);
  assert.match(markdown, /속도보다 흡수 시간을 먼저 잡아보세요/);
  assert.match(markdown, /한 줄로 적어보세요/);
});
