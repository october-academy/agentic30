import test from "node:test";
import assert from "node:assert/strict";

import {
  REVIEW_DAY_PACE_CLASSIFIER_SCHEMA_VERSION,
  REVIEW_DAY_PACE_LABELS,
  REVIEW_DAY_SUMMARY_SCHEMA_VERSION,
  classifyReviewDayPace,
  computeExpectedElapsedCurriculumTimeForReviewDay,
  formatReviewDaySummaryMarkdown,
  generateReviewDaySummary,
  renderReviewDaySummaryCard,
  selectReviewDayRecordsForGeneration,
} from "../sidecar/review-day-summary.mjs";

test("renderReviewDaySummaryCard renders agent-generated summary content and dashboard blocks", () => {
  const card = renderReviewDaySummaryCard({
    daySpec: {
      day_id: 14,
      title: "Build Review",
      day_goal: "MVP 실행 증거로 다음 7일 범위를 정한다",
    },
    reviewSummary: {
      summary_text: "이번 주는 핵심 행동을 하나로 줄였고 첫 dogfood 로그까지 남겼습니다.",
      key_insights: [
        "로그인 없는 첫 가치 경로가 전환을 낮췄습니다.",
        "L2 인용 없이 추가한 기능은 다음 주 범위에서 제외하세요.",
      ],
    },
    dashboard: {
      curated_metrics: [
        { label: "완료 Days", value: "7/7", trend: "steady" },
        { label: "미완료 Action", value: "1", trend: "carry-over" },
      ],
      agent_insights: ["첫 가치까지 30초 기준을 계속 유지해보세요."],
      action_items: ["Day 15 전에 가격 ask 문장을 실제 후보 1명에게 보내보세요."],
      tone: "achievement_summary",
    },
    progress: {
      completed_days: 14,
      incomplete_actions: 1,
      days_elapsed: 5,
    },
    requestId: "req-review",
    sessionId: "session-review",
    now: new Date("2026-05-14T09:00:00.000Z"),
  });

  assert.equal(card.schemaVersion, REVIEW_DAY_SUMMARY_SCHEMA_VERSION);
  assert.equal(card.cardType, "curriculum_review_summary_card");
  assert.equal(card.dayType, "review");
  assert.equal(card.dayId, 14);
  assert.equal(card.status, "ready");
  assert.equal(card.createdAt, "2026-05-14T09:00:00.000Z");
  assert.equal(card.summaryText, "이번 주는 핵심 행동을 하나로 줄였고 첫 dogfood 로그까지 남겼습니다.");
  assert.deepEqual(card.progress, {
    completedDays: 14,
    incompleteActions: 1,
    daysElapsed: 5,
  });

  assert.equal(card.card.layout, "review_agent_summary_dashboard");
  assert.equal(card.card.tone, "friendly_senior");
  assert.deepEqual(
    card.card.blocks.map((block) => block.kind),
    ["summary", "dashboard", "action_items", "markdown"],
  );
  assert.equal(card.card.blocks[1].metrics.length, 2);
  assert.deepEqual(card.card.blocks[1].agentInsights, ["첫 가치까지 30초 기준을 계속 유지해보세요."]);
  assert.equal(card.card.blocks[1].tone, "achievement_summary");
  assert.deepEqual(card.card.blocks[2].items, ["Day 15 전에 가격 ask 문장을 실제 후보 1명에게 보내보세요."]);

  assert.equal(card.structuredPrompt.requestId, "req-review");
  assert.equal(card.structuredPrompt.sessionId, "session-review");
  assert.equal(card.structuredPrompt.toolName, "agentic30_curriculum_review");
  assert.equal(card.structuredPrompt.state, "ready");
  assert.match(card.formattedMarkdown, /## Day 14 Review - Build Review/);
  assert.match(card.formattedMarkdown, /### Agent Summary/);
  assert.match(card.formattedMarkdown, /- 완료 Days: 7\/7 \(steady\)/);
  assert.match(card.formattedMarkdown, /Tone: achievement_summary/);
});

test("renderReviewDaySummaryCard renders loading and empty states", () => {
  const loading = renderReviewDaySummaryCard({
    daySpec: { day: 7 },
    isLoading: true,
    now: new Date("2026-05-14T09:01:00.000Z"),
  });
  assert.equal(loading.status, "loading");
  assert.equal(loading.formattedMarkdown, "Review 요약을 만들고 있습니다. 잠시만 기다려보세요.");
  assert.equal(loading.card.blocks.length, 1);
  assert.equal(loading.card.blocks[0].kind, "loading");

  const empty = renderReviewDaySummaryCard({
    daySpec: { day: 28 },
    reviewSummary: {},
    dashboard: {},
    now: new Date("2026-05-14T09:02:00.000Z"),
  });
  assert.equal(empty.status, "empty");
  assert.equal(empty.dayId, 28);
  assert.match(empty.formattedMarkdown, /아직 요약할 답변이나 실행 증거가 없습니다/);
  assert.equal(empty.card.blocks[0].kind, "empty");
});

test("formatReviewDaySummaryMarkdown produces stable markdown without duplicate blank lines", () => {
  const markdown = formatReviewDaySummaryMarkdown({
    daySpec: {
      day: 21,
      title: "Launch Review",
      goal: "공개 실행과 응답 숫자로 다음 실험을 고른다",
    },
    reviewSummary: {
      summaryText: "공개 proof는 만들었지만 warm outreach 응답이 부족합니다.",
      keyInsights: ["조회수보다 DM 응답을 우선하세요."],
    },
    dashboard: {
      metrics: [{ label: "DM 응답", value: "2/10" }],
      actionItems: ["무응답 8명에게 다른 hook으로 한 번만 재시도해보세요."],
      tone: "deceleration_coaching",
    },
  });

  assert.equal(
    markdown,
    [
      "## Day 21 Review - Launch Review",
      "",
      "목표: 공개 실행과 응답 숫자로 다음 실험을 고른다",
      "",
      "### Agent Summary",
      "공개 proof는 만들었지만 warm outreach 응답이 부족합니다.",
      "",
      "### Key Insights",
      "- 조회수보다 DM 응답을 우선하세요.",
      "",
      "### Dashboard",
      "- DM 응답: 2/10",
      "",
      "### Action Items",
      "- 무응답 8명에게 다른 hook으로 한 번만 재시도해보세요.",
      "",
      "Tone: deceleration_coaching",
    ].join("\n"),
  );
  assert.doesNotMatch(markdown, /\n{3,}/);
  assert.doesNotMatch(markdown, /[ \t]$/m);
});

test("generateReviewDaySummary uses filtered Review Day records and excludes out-of-range records", () => {
  const dayRecords = [
    {
      day: 7,
      completed: true,
      question_progress: [
        {
          question_id: "prior-review",
          answer: "EXCLUDED_WEEK_1_REVIEW_SHOULD_NOT_APPEAR",
          status: "answered",
        },
      ],
      actions: [
        {
          id: "prior-action",
          action_description: "EXCLUDED_WEEK_1_ACTION_SHOULD_NOT_APPEAR",
          verification_result: { passed: true },
        },
      ],
    },
    {
      day: 8,
      completed: true,
      question_progress: [
        {
          question_id: "core-action",
          question: "What did the core action prove?",
          answer: "Included Day 8 core action answer",
          status: "answered",
        },
      ],
      actions: [
        {
          id: "day-8-verified",
          action_description: "Included verified Day 8 dogfood",
          verification_result: { passed: true },
        },
      ],
    },
    {
      day: 12,
      completion_confirmed: true,
      questionProgress: [
        {
          questionId: "e2e",
          answer: "Included Day 12 E2E finding",
          status: "answered",
        },
      ],
      actionItems: [
        {
          actionId: "day-12-pending",
          actionDescription: "Included pending Day 12 evidence upload",
          status: "pending",
        },
      ],
    },
    {
      day: 15,
      completed: true,
      question_progress: [
        {
          question_id: "future-week",
          answer: "EXCLUDED_WEEK_3_SHOULD_NOT_APPEAR",
          status: "answered",
        },
      ],
    },
  ];

  const selection = selectReviewDayRecordsForGeneration({
    reviewDay: 14,
    dayRecords,
  });
  assert.deepEqual(selection.day_range, { start: 8, end: 14 });
  assert.deepEqual(selection.selected_day_ids, [8, 12]);
  assert.deepEqual(selection.excluded_day_ids, [7, 15]);

  const generated = generateReviewDaySummary({
    reviewDay: 14,
    daySpec: {
      day: 14,
      title: "Build Review",
      goal: "MVP 실행 증거로 다음 7일 범위를 정한다",
    },
    dayRecords,
    paceMetrics: { days_elapsed: 6 },
    now: new Date("2026-05-14T10:00:00.000Z"),
  });

  assert.equal(generated.schema, "agentic30.curriculum.review_day_generation.v1");
  assert.equal(generated.generatedAt, "2026-05-14T10:00:00.000Z");
  assert.equal(generated.day_id, 14);
  assert.deepEqual(generated.selection.selected_day_ids, [8, 12]);
  assert.deepEqual(generated.selection.excluded_day_ids, [7, 15]);
  assert.equal(generated.dashboard.tone, "achievement_summary");
  assert.deepEqual(
    generated.dashboard.curated_metrics.map((metric) => [metric.label, metric.value]),
    [
      ["Review 범위", "Day 8-14"],
      ["완료 Days", "2/2"],
      ["검증된 Actions", "1"],
      ["미완료 Carry-over", "1"],
    ],
  );
  assert.match(generated.summary_text, /Included Day 8 core action answer/);
  assert.match(generated.summary_text, /Included Day 12 E2E finding/);
  assert.match(JSON.stringify(generated), /Included verified Day 8 dogfood/);
  assert.match(JSON.stringify(generated), /Included pending Day 12 evidence upload/);

  const card = renderReviewDaySummaryCard({
    daySpec: { day: 14, title: "Build Review" },
    reviewSummary: generated,
    dashboard: generated.dashboard,
  });
  const rendered = JSON.stringify({
    generated,
    markdown: card.formattedMarkdown,
    card: card.card,
  });
  assert.doesNotMatch(rendered, /EXCLUDED_WEEK_1_REVIEW_SHOULD_NOT_APPEAR/);
  assert.doesNotMatch(rendered, /EXCLUDED_WEEK_1_ACTION_SHOULD_NOT_APPEAR/);
  assert.doesNotMatch(rendered, /EXCLUDED_WEEK_3_SHOULD_NOT_APPEAR/);
});

test("computeExpectedElapsedCurriculumTimeForReviewDay derives default weekly pace for Review Days", () => {
  const result = computeExpectedElapsedCurriculumTimeForReviewDay({
    reviewDay: 14,
  });

  assert.equal(result.schema, "agentic30.curriculum.review_day_expected_elapsed.v1");
  assert.equal(result.review_day, 14);
  assert.equal(result.eligible, true);
  assert.deepEqual(result.day_range, { start: 8, end: 14 });
  assert.equal(result.curriculum_day_count, 7);
  assert.equal(result.pace_inputs.source, "default_one_day_per_curriculum_day");
  assert.equal(result.expected_elapsed_days, 7);
  assert.equal(result.expected_elapsed_hours, 168);
  assert.equal(result.expected_elapsed_minutes, 10080);
  assert.equal(result.expected_elapsed_milliseconds, 604800000);
});

test("computeExpectedElapsedCurriculumTimeForReviewDay honors custom Review days and pace aliases", () => {
  const result = computeExpectedElapsedCurriculumTimeForReviewDay({
    review_day: 18,
    reviewDayIds: [6, 12, 18, 24],
    paceInputs: {
      curriculum_days_per_elapsed_day: 2,
    },
  });

  assert.equal(result.review_day, 18);
  assert.deepEqual(result.day_range, { start: 13, end: 18 });
  assert.equal(result.curriculum_day_count, 6);
  assert.equal(result.pace_inputs.source, "curriculum_days_per_elapsed_day");
  assert.equal(result.pace_inputs.days_per_curriculum_day, 0.5);
  assert.equal(result.expected_elapsed_days, 3);
  assert.equal(result.expected_elapsed_hours, 72);
});

test("computeExpectedElapsedCurriculumTimeForReviewDay returns null elapsed values for non-review days", () => {
  const result = computeExpectedElapsedCurriculumTimeForReviewDay({
    reviewDay: 10,
    paceInputs: {
      minutes_per_curriculum_day: 30,
    },
  });

  assert.equal(result.review_day, 10);
  assert.equal(result.eligible, false);
  assert.equal(result.day_range, null);
  assert.equal(result.curriculum_day_count, 0);
  assert.equal(result.pace_inputs.source, "minutes_per_curriculum_day");
  assert.equal(result.expected_elapsed_days, null);
  assert.equal(result.expected_elapsed_milliseconds, null);
});

test("classifyReviewDayPace labels Review Day users as rusher below elapsed threshold", () => {
  const result = classifyReviewDayPace({
    reviewDay: 7,
    paceMetrics: {
      days_elapsed: 4.9,
      days_per_curriculum_day: 1,
    },
  });

  assert.equal(result.schemaVersion, REVIEW_DAY_PACE_CLASSIFIER_SCHEMA_VERSION);
  assert.equal(result.schema, "agentic30.curriculum.review_day_pace_classification.v1");
  assert.equal(result.review_day, 7);
  assert.equal(result.eligible, true);
  assert.equal(result.label, REVIEW_DAY_PACE_LABELS.RUSHER);
  assert.equal(result.pace_label, "rusher");
  assert.equal(result.user_type, "rusher");
  assert.equal(result.reason, "real_elapsed_time_below_rusher_threshold");
  assert.equal(result.expected_elapsed_days, 7);
  assert.equal(result.real_elapsed_days, 4.9);
  assert.equal(result.rusher_threshold_days, 5.25);
  assert.equal(result.elapsed_to_expected_ratio, 0.7);
});

test("classifyReviewDayPace labels Review Day users as steady progressor at or above threshold", () => {
  const result = classifyReviewDayPace({
    reviewDay: 14,
    pace_metrics: {
      start_timestamp: "2026-05-01T09:00:00.000Z",
      end_timestamp: "2026-05-07T09:00:00.000Z",
      days_per_curriculum_day: 1,
    },
  });

  assert.equal(result.label, REVIEW_DAY_PACE_LABELS.STEADY_PROGRESSOR);
  assert.equal(result.pace_label, "steady_progressor");
  assert.equal(result.reason, "real_elapsed_time_within_steady_threshold");
  assert.equal(result.expected_elapsed_days, 7);
  assert.equal(result.real_elapsed_days, 6);
  assert.equal(result.elapsed_to_expected_ratio, 0.857);
});

test("classifyReviewDayPace honors custom elapsed thresholds without mutating inputs", () => {
  const paceMetrics = {
    elapsed_hours: 72,
    curriculum_days_per_elapsed_day: 2,
  };
  const thresholds = {
    rusher_max_expected_ratio: 0.6,
  };

  const result = classifyReviewDayPace({
    review_day: 18,
    reviewDayIds: [6, 12, 18, 24],
    paceMetrics,
    thresholds,
  });

  assert.equal(result.expected_elapsed_days, 3);
  assert.equal(result.real_elapsed_days, 3);
  assert.equal(result.rusher_threshold_days, 1.8);
  assert.equal(result.label, "steady_progressor");
  assert.deepEqual(paceMetrics, {
    elapsed_hours: 72,
    curriculum_days_per_elapsed_day: 2,
  });
  assert.deepEqual(thresholds, {
    rusher_max_expected_ratio: 0.6,
  });
});

test("generateReviewDaySummary compares pace against expected Review Day elapsed time", () => {
  const dayRecords = Array.from({ length: 7 }, (_, index) => ({
    day: index + 1,
    completed: true,
    question_progress: [
      {
        question_id: `day-${index + 1}-q1`,
        answer: `Day ${index + 1} answer`,
        status: "answered",
      },
    ],
  }));

  const onPace = generateReviewDaySummary({
    reviewDay: 7,
    dayRecords,
    paceMetrics: {
      days_elapsed: 7,
      days_per_curriculum_day: 1,
    },
  });
  assert.equal(onPace.dashboard.tone, "achievement_summary");
  assert.equal(onPace.dashboard.pace_classification.label, "steady_progressor");

  const slowerThanExpected = generateReviewDaySummary({
    reviewDay: 7,
    dayRecords,
    paceMetrics: {
      days_elapsed: 7.5,
      days_per_curriculum_day: 1,
    },
  });
  assert.equal(slowerThanExpected.dashboard.tone, "deceleration_coaching");

  const rusher = generateReviewDaySummary({
    reviewDay: 7,
    dayRecords,
    paceMetrics: {
      days_elapsed: 4,
      days_per_curriculum_day: 1,
    },
  });
  assert.equal(rusher.dashboard.pace_classification.label, "rusher");
  assert.equal(rusher.dashboard.tone, "deceleration_coaching");
});

test("generateReviewDaySummary selects achievement-summary copy for steady progressors", () => {
  const dayRecords = Array.from({ length: 7 }, (_, index) => ({
    day: index + 1,
    completed: true,
    question_progress: [
      {
        question_id: `day-${index + 1}-q1`,
        answer: `Day ${index + 1} steady answer`,
        status: "answered",
      },
    ],
    actions: index === 4
      ? [
          {
            id: "day-5-proof",
            action_description: "Published customer interview note",
            verification_result: { passed: true },
          },
        ]
      : [],
  }));

  const generated = generateReviewDaySummary({
    reviewDay: 7,
    dayRecords,
    paceMetrics: {
      days_elapsed: 6,
      days_per_curriculum_day: 1,
    },
  });

  assert.equal(generated.dashboard.pace_classification.label, REVIEW_DAY_PACE_LABELS.STEADY_PROGRESSOR);
  assert.equal(generated.dashboard.tone, "achievement_summary");
  assert.equal(generated.dashboard.coaching_copy.reason, "steady_progressor_achievement_summary");
  assert.match(generated.dashboard.coaching_copy.headline, /리듬은 안정적으로 쌓였습니다/);
  assert.match(generated.dashboard.coaching_copy.accomplishment_summary, /Day 1-7에서 7개 Day와 검증된 Action 1개/);
  assert.match(generated.dashboard.coaching_copy.body, /Day 1-7/);
  assert.match(generated.dashboard.coaching_copy.body, /다음 주 실행/);
  assert.match(generated.dashboard.coaching_copy.reflectionPrompt, /검증된 Action 1개/);

  const card = renderReviewDaySummaryCard({
    daySpec: { day: 7, title: "Foundation Review" },
    reviewSummary: generated,
    dashboard: generated.dashboard,
  });
  assert.deepEqual(
    card.card.blocks.map((block) => block.kind),
    ["summary", "dashboard", "action_items", "coaching", "markdown"],
  );
  assert.match(card.formattedMarkdown, /### Coaching/);
  assert.match(card.formattedMarkdown, /이번 주 리듬은 안정적으로 쌓였습니다/);
  assert.match(card.formattedMarkdown, /Tone: achievement_summary/);
});

test("generateReviewDaySummary adds achievement accomplishment copy without changing sourced Day-range summary", () => {
  const dayRecords = Array.from({ length: 7 }, (_, index) => ({
    day: index + 1,
    completed: true,
    question_progress: [
      {
        question_id: `day-${index + 1}-q1`,
        answer: `SOURCED_DAY_${index + 1}_ACHIEVEMENT_ANSWER`,
        status: "answered",
      },
    ],
    actions: index === 4
      ? [
          {
            id: "day-5-achievement-proof",
            action_description: "SOURCED_DAY_5_ACHIEVEMENT_ACTION",
            verification_result: { passed: true },
          },
        ]
      : [],
  }));

  const generated = generateReviewDaySummary({
    daySpec: { day: 7, title: "Foundation Review" },
    reviewDay: 7,
    dayRecords,
    paceMetrics: {
      days_elapsed: 6,
      days_per_curriculum_day: 1,
    },
  });

  const expectedSourcedSummary = [
    "Day 1-7 기록 7개로 Foundation Review를 생성했습니다.",
    "핵심 답변은 Day 1: SOURCED_DAY_1_ACHIEVEMENT_ANSWER / Day 2: SOURCED_DAY_2_ACHIEVEMENT_ANSWER / Day 3: SOURCED_DAY_3_ACHIEVEMENT_ANSWER입니다.",
    "검증된 실행 1개가 다음 주 판단 근거입니다.",
    "미완료 Action 없이 다음 주로 넘어갈 수 있습니다.",
  ].join(" ");

  assert.equal(generated.dashboard.tone, "achievement_summary");
  assert.equal(generated.summary_text, expectedSourcedSummary);
  assert.equal(generated.summaryText, expectedSourcedSummary);
  assert.doesNotMatch(generated.summary_text, /이번 주 리듬|쌓았습니다|accomplishment|성과/);
  assert.match(generated.dashboard.coaching_copy.accomplishment_summary, /Day 1-7에서 7개 Day와 검증된 Action 1개를 쌓았습니다/);
  assert.match(generated.dashboard.coachingCopy.accomplishmentSummary, /Day 1-7에서 7개 Day와 검증된 Action 1개를 쌓았습니다/);
  assert.match(JSON.stringify(generated.selected_day_records), /SOURCED_DAY_5_ACHIEVEMENT_ACTION/);
  assert.match(generated.summary_text, /SOURCED_DAY_1_ACHIEVEMENT_ANSWER/);
});

test("generateReviewDaySummary adds rusher deceleration copy without changing sourced Day-range summary", () => {
  const dayRecords = Array.from({ length: 7 }, (_, index) => ({
    day: index + 1,
    completed: true,
    question_progress: [
      {
        question_id: `day-${index + 1}-q1`,
        answer: `SOURCED_DAY_${index + 1}_ANSWER`,
        status: "answered",
      },
    ],
    actions: index === 2
      ? [
          {
            id: "day-3-proof",
            action_description: "SOURCED_DAY_3_ACTION",
            verification_result: { passed: true },
          },
        ]
      : [],
  }));

  const steady = generateReviewDaySummary({
    reviewDay: 7,
    dayRecords,
    paceMetrics: {
      days_elapsed: 7,
      days_per_curriculum_day: 1,
    },
  });
  const rusher = generateReviewDaySummary({
    reviewDay: 7,
    dayRecords,
    paceMetrics: {
      days_elapsed: 2.5,
      days_per_curriculum_day: 1,
    },
  });

  assert.equal(rusher.dashboard.pace_classification.label, "rusher");
  assert.equal(rusher.dashboard.tone, "deceleration_coaching");
  assert.equal(rusher.summary_text, steady.summary_text);
  assert.match(rusher.summary_text, /SOURCED_DAY_1_ANSWER/);
  assert.match(JSON.stringify(rusher), /SOURCED_DAY_3_ACTION/);
  assert.equal(rusher.dashboard.coaching_copy.reason, "rusher_deceleration_coaching");
  assert.match(rusher.dashboard.coaching_copy.headline, /속도보다 흡수 시간/);
  assert.match(rusher.dashboard.coaching_copy.body, /Day 1-7 기록은 그대로 유지합니다/);
  assert.match(rusher.dashboard.coaching_copy.body, /다시 읽어보세요/);
  assert.match(rusher.dashboard.coaching_copy.reflectionPrompt, /한 줄로 적어보세요/);

  const card = renderReviewDaySummaryCard({
    daySpec: { day: 7, title: "Foundation Review" },
    reviewSummary: rusher,
    dashboard: rusher.dashboard,
  });
  assert.deepEqual(
    card.card.blocks.map((block) => block.kind),
    ["summary", "dashboard", "action_items", "coaching", "markdown"],
  );
  assert.match(card.formattedMarkdown, /### Coaching/);
  assert.match(card.formattedMarkdown, /속도보다 흡수 시간을 먼저 잡아보세요/);
  assert.match(card.formattedMarkdown, /Tone: deceleration_coaching/);
});
