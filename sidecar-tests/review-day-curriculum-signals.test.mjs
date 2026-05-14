import test from "node:test";
import assert from "node:assert/strict";

import {
  REVIEW_DAY_COACHING_SIGNAL_SCHEMA_VERSION,
  REVIEW_DAY_CURRICULUM_SIGNAL_SCHEMA_VERSION,
  collectReviewDayCoachingSignals,
  collectReviewDayCurriculumSignals,
  normalizeReviewDayCurriculumSignals,
} from "../sidecar/review-day-curriculum-signals.mjs";
import {
  generateReviewDaySummary,
} from "../sidecar/review-day-summary.mjs";

test("collectReviewDayCurriculumSignals normalizes eligible progress state into dashboard metrics", () => {
  const signals = collectReviewDayCurriculumSignals({
    reviewDay: 14,
    progressState: {
      dayRecords: [
        {
          day: 7,
          completed: true,
          question_progress: [
            { question_id: "prior", answer: "Excluded prior answer", status: "answered" },
          ],
        },
        {
          day: 8,
          completion_confirmed: true,
          question_progress: [
            { question_id: "q1", answer: "Interviewed one founder", status: "answered" },
            { question_id: "q2", answer: "", status: "draft" },
          ],
          actions: [
            {
              id: "a1",
              action_description: "Publish customer note",
              verification_result: { passed: true },
            },
          ],
        },
        {
          day: 10,
          completed: false,
          questionProgress: [
            { questionId: "q1", answer: "Drafted pricing ask", status: "completed" },
          ],
          action_items: [
            {
              action_id: "a2",
              action_description: "Send pricing ask",
              status: "pending",
            },
          ],
        },
      ],
      weeklySummaryStack: [
        { week_number: 1, summary_text: "Week 1 summary" },
      ],
      carryOverQueue: [
        { source_day: 10, action_description: "Send pricing ask" },
      ],
    },
    now: new Date("2026-05-14T06:00:00.000Z"),
  });

  assert.equal(signals.schemaVersion, REVIEW_DAY_CURRICULUM_SIGNAL_SCHEMA_VERSION);
  assert.equal(signals.schema, "agentic30.curriculum.review_day_curriculum_signals.v1");
  assert.equal(signals.generatedAt, "2026-05-14T06:00:00.000Z");
  assert.equal(signals.reviewDay, 14);
  assert.deepEqual(signals.dayRange, { start: 8, end: 14 });
  assert.equal(signals.hasSignals, true);
  assert.deepEqual(signals.selectedDayIds, [8, 10]);
  assert.equal(signals.expectedDayCount, 7);
  assert.equal(signals.completedDayCount, 1);
  assert.equal(signals.answeredQuestionCount, 2);
  assert.equal(signals.actionCount, 2);
  assert.equal(signals.verifiedActionCount, 1);
  assert.equal(signals.carryOverCount, 1);
  assert.equal(signals.weeklySummaryCount, 1);
  assert.deepEqual(
    signals.dashboardMetrics.map((metric) => [metric.label, metric.value, metric.trend]),
    [
      ["Curriculum source", "progress-state", "ready"],
      ["Eligible curriculum Days", "1/7", "in-progress"],
      ["Answered curriculum questions", "2", "evidence-backed"],
      ["Verified curriculum actions", "1/2", "verified"],
      ["Auto-verified Actions", "0", "none"],
      ["Evidence fallback Actions", "0", "none"],
      ["Missing Action sources", "0", "covered"],
      ["Carry-over coaching queue", "1", "non-blocking"],
      ["Adaptive coaching", "down/low_quality_progression", "difficulty-down"],
      ["Carry-over coaching", "1", "non-blocking"],
      ["Adaptive coach events", "0", "none"],
      ["Coaching sources", "3/5", "partial"],
    ],
  );
  assert.equal(signals.coachingSignals.schemaVersion, REVIEW_DAY_COACHING_SIGNAL_SCHEMA_VERSION);
  assert.equal(signals.coachingSignals.adaptiveDifficultyState.direction, "down");
  assert.equal(signals.coachingSignals.adaptiveDifficultyState.trigger, "low_quality_progression");
  assert.equal(signals.coachingSignals.carryOverCoaching.eligibleActionCount, 1);
  assert.ok(signals.dashboardInsights.some((insight) => insight.includes("1/7")));
  assert.ok(signals.dashboardActionItems.some((item) => item.includes("Carry-over Action")));
  assert.ok(signals.dashboardActionItems.some((item) => item.includes("template 기반 mini-action")));
});

test("collectReviewDayCurriculumSignals handles missing curriculum sources without throwing", () => {
  const signals = collectReviewDayCurriculumSignals({
    reviewDay: 7,
    progressState: {},
    now: new Date("2026-05-14T07:00:00.000Z"),
  });

  assert.equal(signals.generatedAt, "2026-05-14T07:00:00.000Z");
  assert.equal(signals.reviewDay, 7);
  assert.deepEqual(signals.dayRange, { start: 1, end: 7 });
  assert.equal(signals.hasSignals, false);
  assert.deepEqual(signals.selectedDayIds, []);
  assert.deepEqual(signals.missingSources, [
    "progressState",
    "dayRecords",
    "actionSources",
    "weeklySummaryStack",
    "carryOverQueue",
  ]);
  assert.deepEqual(
    signals.dashboardMetrics.map((metric) => [metric.label, metric.value, metric.trend]),
    [
      ["Curriculum source", "missing", "missing-source"],
      ["Eligible curriculum Days", "0/7", "no-progress"],
      ["Answered curriculum questions", "0", "needs-answers"],
      ["Verified curriculum actions", "0/0", "needs-evidence"],
      ["Auto-verified Actions", "0", "none"],
      ["Evidence fallback Actions", "0", "none"],
      ["Missing Action sources", "0", "covered"],
      ["Carry-over coaching queue", "0", "clear"],
      ["Adaptive coaching", "none", "steady"],
      ["Carry-over coaching", "0", "clear"],
      ["Adaptive coach events", "0", "none"],
      ["Coaching sources", "0/5", "partial"],
    ],
  );
  assert.deepEqual(signals.coachingSignals.missingSources, [
    "progressState",
    "adaptiveDifficultyState",
    "carryOverCoaching",
    "coachingFeedbackSurface",
    "adaptiveCoachEvents",
  ]);
  assert.ok(signals.dashboardInsights.some((insight) => insight.includes("Curriculum source")));
  assert.ok(signals.dashboardInsights.some((insight) => insight.includes("Coaching source")));
  assert.ok(signals.dashboardActionItems.some((item) => item.includes("Progress state")));
  assert.ok(signals.dashboardActionItems.some((item) => item.includes("Coaching state")));
});

test("collectReviewDayCoachingSignals normalizes adaptive-coach sources for Review dashboard", () => {
  const signals = collectReviewDayCoachingSignals({
    reviewDay: 21,
    progressState: {
      adaptive_difficulty_state: {
        direction: "up",
        trigger: "rushing",
        adjustments_applied: ["increase_prerequisite_evidence_required"],
        progression_blocked: false,
        can_advance_day: true,
      },
      carry_over_coaching: {
        has_eligible_actions: true,
        eligible_actions: [
          {
            action_id: "day-20-outreach",
            source_day: 20,
            target_day: 21,
            action_description: "Send 10 personalized DMs and record outcomes.",
            coaching_feedback: "증거 하나만 먼저 보강해보세요.",
            times_carried: 2,
          },
        ],
      },
      coaching_feedback_surface: {
        feedback_items: [
          { message: "빠르게 넘긴 실행은 proof부터 확인해보세요.", tone: "friendly_senior" },
        ],
      },
      adaptive_coach_events: [
        {
          event_type: "rush_detection",
          day: 20,
          message: "Multiple Days completed in a short window.",
          severity: "watch",
        },
      ],
    },
    now: new Date("2026-05-14T08:30:00.000Z"),
  });

  assert.equal(signals.schemaVersion, REVIEW_DAY_COACHING_SIGNAL_SCHEMA_VERSION);
  assert.equal(signals.generatedAt, "2026-05-14T08:30:00.000Z");
  assert.equal(signals.reviewDay, 21);
  assert.equal(signals.hasSignals, true);
  assert.deepEqual(signals.missingSources, []);
  assert.equal(signals.adaptiveDifficultyState.direction, "up");
  assert.equal(signals.adaptiveDifficultyState.trigger, "rushing");
  assert.equal(signals.adaptiveDifficultyState.progressionBlocked, false);
  assert.equal(signals.carryOverCoaching.eligibleActionCount, 1);
  assert.equal(signals.carryOverCoaching.eligibleActions[0].action_id, "day-20-outreach");
  assert.equal(signals.coachingFeedbackSurface.feedbackCount, 1);
  assert.equal(signals.adaptiveCoachEvents[0].type, "rush_detection");
  assert.deepEqual(
    signals.dashboardMetrics.map((metric) => [metric.label, metric.value, metric.trend]),
    [
      ["Adaptive coaching", "up/rushing", "difficulty-up"],
      ["Carry-over coaching", "1", "non-blocking"],
      ["Adaptive coach events", "1", "recorded"],
      ["Coaching sources", "5/5", "complete"],
    ],
  );
  assert.ok(signals.dashboardInsights.some((insight) => insight.includes("난이도를 up")));
  assert.ok(signals.dashboardActionItems.some((item) => item.includes("prior action 증거")));
});

test("collectReviewDayCurriculumSignals normalizes action verification and evidence signals", () => {
  const signals = collectReviewDayCurriculumSignals({
    reviewDay: 14,
    dayRecords: [
      {
        day: 8,
        dayType: "action",
        completionConfirmed: true,
        actionSpec: {
          id: "day-8-doc",
          actionDescription: "Write customer interview notes",
          completionSignal: "Google Doc contains two customer quotes",
        },
        verificationState: {
          status: "passed",
          verificationResult: {
            method: "google_docs",
            passed: true,
            outcome: "verified",
          },
        },
      },
      {
        day: 9,
        day_type: "action",
        completed: true,
        actions: [
          {
            action_id: "day-9-post",
            action_description: "Publish build-in-public post",
            completion_signal: "Post URL is reachable",
            evidence_submission: {
              type: "link",
              content: "https://example.com/post",
              validation_status: "accepted",
            },
          },
        ],
      },
      {
        day: 10,
        dayType: "education",
        completionConfirmed: true,
        questionProgress: [
          { questionId: "q1", answer: "No action on this worksheet", status: "answered" },
        ],
      },
    ],
    now: new Date("2026-05-14T07:30:00.000Z"),
  });

  assert.equal(signals.actionCount, 2);
  assert.equal(signals.verifiedActionCount, 2);
  assert.equal(signals.autoVerifiedActionCount, 1);
  assert.equal(signals.evidenceVerifiedActionCount, 1);
  assert.equal(signals.missingActionSourceCount, 1);
  assert.ok(signals.missingSources.includes("actionSources") === false);
  assert.deepEqual(
    signals.actionSignals.map((action) => [
      action.action_id,
      action.completion_signal,
      action.verification_method,
      action.verification_source,
      action.verified,
    ]),
    [
      ["day-8-doc", "Google Doc contains two customer quotes", "google_docs", "auto", true],
      ["day-9-post", "Post URL is reachable", "evidence_link", "evidence", true],
    ],
  );
  assert.deepEqual(
    signals.dashboardMetrics
      .filter((metric) => ["Auto-verified Actions", "Evidence fallback Actions", "Missing Action sources"].includes(metric.label))
      .map((metric) => [metric.label, metric.value, metric.trend]),
    [
      ["Auto-verified Actions", "1", "tool-verified"],
      ["Evidence fallback Actions", "1", "agent-validated"],
      ["Missing Action sources", "1", "missing-source"],
    ],
  );
  assert.ok(signals.dashboardInsights.some((insight) => insight.includes("자동 검증 1개")));
  assert.ok(signals.dashboardActionItems.some((item) => item.includes("Action source")));
});

test("normalizeReviewDayCurriculumSignals accepts pre-collected dashboard signal payloads", () => {
  const normalized = normalizeReviewDayCurriculumSignals({
    schema: "agentic30.curriculum.review_day_curriculum_signals.v1",
    review_day: 21,
    day_range: { start: 15, end: 21 },
    dashboard_metrics: [
      { name: "Eligible curriculum Days", count: "6/7", delta: "in-progress" },
    ],
    dashboard_insights: ["Existing signal insight"],
    dashboard_action_items: ["Existing action item"],
  });

  assert.equal(normalized.reviewDay, 21);
  assert.deepEqual(normalized.dayRange, { start: 15, end: 21 });
  assert.deepEqual(normalized.dashboardMetrics, [
    {
      label: "Eligible curriculum Days",
      value: "6/7",
      trend: "in-progress",
      intent: "",
      status: "",
    },
  ]);
  assert.deepEqual(normalized.dashboardInsights, ["Existing signal insight"]);
  assert.deepEqual(normalized.dashboardActionItems, ["Existing action item"]);
});

test("generateReviewDaySummary adds curriculum progress signals to review dashboard", () => {
  const generated = generateReviewDaySummary({
    reviewDay: 14,
    dayRecords: [
      {
        day: 8,
        completed: true,
        question_progress: [{ question_id: "q1", answer: "Included Day 8 answer", status: "answered" }],
        actions: [{ id: "a1", action_description: "Interview proof", verification_result: { passed: true } }],
      },
    ],
    progressState: {
      dayRecords: [
        {
          day: 8,
          completed: true,
          question_progress: [{ question_id: "q1", answer: "Included Day 8 answer", status: "answered" }],
          actions: [{ id: "a1", action_description: "Interview proof", verification_result: { passed: true } }],
        },
      ],
      carryOverQueue: [],
    },
    now: new Date("2026-05-14T08:00:00.000Z"),
  });

  assert.equal(generated.curriculumSignals.schema, "agentic30.curriculum.review_day_curriculum_signals.v1");
  assert.equal(generated.dashboard.curriculumSignals, generated.curriculumSignals);
  assert.deepEqual(
    generated.dashboard.curated_metrics.slice(4).map((metric) => [metric.label, metric.value]),
    [
      ["Curriculum source", "progress-state"],
      ["Eligible curriculum Days", "1/7"],
      ["Answered curriculum questions", "1"],
      ["Verified curriculum actions", "1/1"],
      ["Auto-verified Actions", "0"],
      ["Evidence fallback Actions", "0"],
      ["Missing Action sources", "0"],
      ["Carry-over coaching queue", "0"],
      ["Adaptive coaching", "none"],
      ["Carry-over coaching", "0"],
      ["Adaptive coach events", "0"],
      ["Coaching sources", "1/5"],
    ],
  );
  assert.equal(generated.curriculumSignals.coachingSignals.schema, "agentic30.curriculum.review_day_coaching_signals.v1");
  assert.ok(generated.dashboard.agent_insights.some((insight) => insight.includes("1/7")));
});
