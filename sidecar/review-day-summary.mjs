import {
  metricLines,
  normalizeDashboardProgress,
  normalizeReviewDashboard,
  renderReviewDashboardPresentation,
} from "./review-dashboard-presentation.mjs";
import {
  resolveReviewDayEligibleDayRange,
} from "./adaptive-curriculum.mjs";
import {
  normalizeReviewDayWorkspaceSignals,
} from "./review-day-workspace-signals.mjs";
import {
  collectReviewDayCurriculumSignals,
  normalizeReviewDayCurriculumSignals,
} from "./review-day-curriculum-signals.mjs";

export const REVIEW_DAY_SUMMARY_SCHEMA_VERSION = 1;
export const REVIEW_DAY_PACE_CLASSIFIER_SCHEMA_VERSION = 1;
export const REVIEW_DAY_IDS = Object.freeze([7, 14, 21, 28]);
export const REVIEW_DAY_PACE_LABELS = Object.freeze({
  RUSHER: "rusher",
  STEADY_PROGRESSOR: "steady_progressor",
});

const DEFAULT_TITLE = "Review Day";
const DEFAULT_GOAL = "지난 실행을 증거로 정리하고 다음 7일의 행동을 고른다";
const DEFAULT_EMPTY_MESSAGE = "아직 요약할 답변이나 실행 증거가 없습니다. 오늘 답변을 남기면 Review가 자동으로 채워집니다.";
const DEFAULT_LOADING_MESSAGE = "Review 요약을 만들고 있습니다. 잠시만 기다려보세요.";

export function selectReviewDayRecordsForGeneration({
  reviewDay = null,
  daySpec = {},
  dayRecords = [],
  reviewDayIds = REVIEW_DAY_IDS,
  curriculumDays = null,
} = {}) {
  const targetDay = normalizeDayNumber(reviewDay ?? daySpec.day_id ?? daySpec.dayId ?? daySpec.day) ?? 7;
  const eligibility = resolveReviewDayEligibleDayRange({
    reviewDay: targetDay,
    reviewDayIds,
    curriculumDays,
  });
  const range = eligibility.dayRange ?? eligibility.day_range;
  const normalizedRecords = normalizeDayRecords(dayRecords);
  const selectedDayRecords = range
    ? normalizedRecords.filter((record) => record.day >= range.start && record.day <= range.end)
    : [];
  const excludedDayRecords = range
    ? normalizedRecords.filter((record) => record.day < range.start || record.day > range.end)
    : normalizedRecords;

  return {
    schema: "agentic30.curriculum.review_day_record_selection.v1",
    reviewDay: targetDay,
    review_day: targetDay,
    eligible: eligibility.eligible === true,
    dayRange: range ?? null,
    day_range: range ?? null,
    selectedDayRecords,
    selected_day_records: selectedDayRecords,
    excludedDayRecords,
    excluded_day_records: excludedDayRecords,
    selectedDayIds: selectedDayRecords.map((record) => record.day),
    selected_day_ids: selectedDayRecords.map((record) => record.day),
    excludedDayIds: excludedDayRecords.map((record) => record.day),
    excluded_day_ids: excludedDayRecords.map((record) => record.day),
  };
}

export function generateReviewDaySummary({
  daySpec = {},
  reviewDay = null,
  dayRecords = [],
  reviewDayIds = REVIEW_DAY_IDS,
  curriculumDays = null,
  paceMetrics = {},
  workspaceSignals = null,
  curriculumSignals = null,
  progressState = null,
  now = new Date(),
} = {}) {
  const normalizedDay = normalizeDaySpec({
    ...daySpec,
    day: reviewDay ?? daySpec.day ?? daySpec.dayId ?? daySpec.day_id,
  });
  const selection = selectReviewDayRecordsForGeneration({
    reviewDay: normalizedDay.dayId,
    daySpec: normalizedDay,
    dayRecords,
    reviewDayIds,
    curriculumDays,
  });
  const selectedRecords = selection.selectedDayRecords;
  const selectedAnswers = selectedRecords.flatMap(extractAnsweredQuestions);
  const selectedActions = selectedRecords.flatMap(extractActionEntries);
  const verifiedActions = selectedActions.filter((action) => action.verified);
  const incompleteActions = selectedActions.filter((action) => !action.verified);
  const completedDays = selectedRecords.filter((record) => record.completed).length;
  const range = selection.dayRange ?? { start: normalizedDay.dayId, end: normalizedDay.dayId };
  const paceClassification = classifyReviewDayPace({
    reviewDay: normalizedDay.dayId,
    reviewDayIds,
    curriculumDays,
    paceMetrics,
  });
  const tone = resolveReviewTone({
    reviewDay: normalizedDay.dayId,
    reviewDayIds,
    curriculumDays,
    selectedRecords,
    paceMetrics,
  });
  const coachingCopy = buildGeneratedReviewCoachingCopy({
    tone,
    paceClassification,
    range,
    selectedRecords,
    selectedAnswers,
    verifiedActions,
    incompleteActions,
  });
  const normalizedWorkspaceSignals = workspaceSignals
    ? normalizeReviewDayWorkspaceSignals(workspaceSignals, {
        reviewDay: normalizedDay.dayId,
        eligibleDayRange: range,
        now,
      })
    : null;
  const normalizedCurriculumSignals = curriculumSignals
    ? normalizeReviewDayCurriculumSignals(curriculumSignals, {
        reviewDay: normalizedDay.dayId,
        daySpec: normalizedDay,
        curriculumDays,
        now,
      })
    : progressState
      ? collectReviewDayCurriculumSignals({
          reviewDay: normalizedDay.dayId,
          daySpec: normalizedDay,
          progressState,
          dayRecords,
          reviewDayIds,
          curriculumDays,
          now,
        })
      : null;
  const generationSelection = {
    ...selection,
    excludedDayRecords: [],
    excluded_day_records: [],
  };
  const summaryText = buildGeneratedReviewSummaryText({
    daySpec: normalizedDay,
    range,
    selectedRecords,
    selectedAnswers,
    verifiedActions,
    incompleteActions,
  });
  const dashboard = {
    curated_metrics: [
      {
        label: "Review 범위",
        value: `Day ${range.start}-${range.end}`,
        trend: "filtered",
      },
      {
        label: "완료 Days",
        value: `${completedDays}/${selectedRecords.length}`,
        trend: completedDays === selectedRecords.length ? "complete" : "in-progress",
      },
      {
        label: "검증된 Actions",
        value: String(verifiedActions.length),
        trend: verifiedActions.length > 0 ? "evidence-backed" : "needs-proof",
      },
      {
        label: "미완료 Carry-over",
        value: String(incompleteActions.length),
        trend: incompleteActions.length > 0 ? "non-blocking" : "clear",
      },
      ...(normalizedCurriculumSignals?.dashboardMetrics ?? []),
      ...(normalizedWorkspaceSignals?.dashboardMetrics ?? []),
    ],
    agent_insights: [
      ...buildGeneratedReviewInsights({
        selectedAnswers,
        verifiedActions,
        incompleteActions,
      }),
      ...(normalizedCurriculumSignals?.dashboardInsights ?? []),
      ...(normalizedWorkspaceSignals?.dashboardInsights ?? []),
    ],
    action_items: [
      ...buildGeneratedReviewActionItems({
        incompleteActions,
        selectedAnswers,
      }),
      ...(normalizedCurriculumSignals?.dashboardActionItems ?? []),
      ...(normalizedWorkspaceSignals?.dashboardActionItems ?? []),
    ],
    coachingCopy,
    coaching_copy: coachingCopy,
    pace_classification: paceClassification,
    paceClassification,
    tone,
  };
  if (normalizedWorkspaceSignals) {
    dashboard.workspace_signals = normalizedWorkspaceSignals;
    dashboard.workspaceSignals = normalizedWorkspaceSignals;
  }
  if (normalizedCurriculumSignals) {
    dashboard.curriculum_signals = normalizedCurriculumSignals;
    dashboard.curriculumSignals = normalizedCurriculumSignals;
  }

  return {
    schemaVersion: REVIEW_DAY_SUMMARY_SCHEMA_VERSION,
    schema: "agentic30.curriculum.review_day_generation.v1",
    generatedAt: toIso(now),
    dayId: normalizedDay.dayId,
    day_id: normalizedDay.dayId,
    dayType: "review",
    day_type: "review",
    dayGoal: normalizedDay.goal,
    day_goal: normalizedDay.goal,
    selection: generationSelection,
    selectedDayRecords: selectedRecords,
    selected_day_records: selectedRecords,
    summaryText,
    summary_text: summaryText,
    keyInsights: dashboard.agent_insights,
    key_insights: dashboard.agent_insights,
    unresolvedActions: incompleteActions.map((action) => action.description),
    unresolved_actions: incompleteActions.map((action) => action.description),
    workspaceSignals: normalizedWorkspaceSignals,
    workspace_signals: normalizedWorkspaceSignals,
    curriculumSignals: normalizedCurriculumSignals,
    curriculum_signals: normalizedCurriculumSignals,
    dashboard,
    reviewDashboard: dashboard,
    review_dashboard: dashboard,
  };
}

export function computeExpectedElapsedCurriculumTimeForReviewDay(options = {}) {
  const source = objectOrEmpty(options);
  const daySpec = objectOrEmpty(source.daySpec ?? source.day_spec);
  const reviewDayIds = source.reviewDayIds ?? source.review_day_ids ?? REVIEW_DAY_IDS;
  const curriculumDays = source.curriculumDays ?? source.curriculum_days ?? null;
  const targetDay = normalizeDayNumber(
    source.reviewDay
      ?? source.review_day
      ?? source.day
      ?? daySpec.dayId
      ?? daySpec.day_id
      ?? daySpec.day,
  ) ?? 7;
  const eligibility = resolveReviewDayEligibleDayRange({
    reviewDay: targetDay,
    reviewDayIds,
    curriculumDays,
  });
  const dayRange = eligibility.dayRange ?? eligibility.day_range;
  const normalizedPace = normalizeCurriculumPaceInputs({
    ...(objectOrEmpty(source.paceInputs ?? source.pace_inputs)),
    ...(objectOrEmpty(source.pace)),
    daysPerCurriculumDay: source.daysPerCurriculumDay ?? source.days_per_curriculum_day,
    hoursPerCurriculumDay: source.hoursPerCurriculumDay ?? source.hours_per_curriculum_day,
    minutesPerCurriculumDay: source.minutesPerCurriculumDay ?? source.minutes_per_curriculum_day,
    millisecondsPerCurriculumDay: source.millisecondsPerCurriculumDay ?? source.milliseconds_per_curriculum_day,
  });

  if (!eligibility.eligible || !dayRange) {
    return {
      schema: "agentic30.curriculum.review_day_expected_elapsed.v1",
      reviewDay: targetDay,
      review_day: targetDay,
      eligible: false,
      dayRange: null,
      day_range: null,
      curriculumDayCount: 0,
      curriculum_day_count: 0,
      paceInputs: normalizedPace,
      pace_inputs: normalizedPace,
      expectedElapsedMilliseconds: null,
      expected_elapsed_milliseconds: null,
      expectedElapsedMinutes: null,
      expected_elapsed_minutes: null,
      expectedElapsedHours: null,
      expected_elapsed_hours: null,
      expectedElapsedDays: null,
      expected_elapsed_days: null,
    };
  }

  const curriculumDayCount = Math.max(0, dayRange.end - dayRange.start + 1);
  const expectedElapsedMilliseconds = Math.round(curriculumDayCount * normalizedPace.millisecondsPerCurriculumDay);

  return {
    schema: "agentic30.curriculum.review_day_expected_elapsed.v1",
    reviewDay: targetDay,
    review_day: targetDay,
    eligible: true,
    dayRange,
    day_range: dayRange,
    curriculumDayCount,
    curriculum_day_count: curriculumDayCount,
    paceInputs: normalizedPace,
    pace_inputs: normalizedPace,
    expectedElapsedMilliseconds,
    expected_elapsed_milliseconds: expectedElapsedMilliseconds,
    expectedElapsedMinutes: roundNumber(expectedElapsedMilliseconds / 60_000, 3),
    expected_elapsed_minutes: roundNumber(expectedElapsedMilliseconds / 60_000, 3),
    expectedElapsedHours: roundNumber(expectedElapsedMilliseconds / 3_600_000, 3),
    expected_elapsed_hours: roundNumber(expectedElapsedMilliseconds / 3_600_000, 3),
    expectedElapsedDays: roundNumber(expectedElapsedMilliseconds / 86_400_000, 3),
    expected_elapsed_days: roundNumber(expectedElapsedMilliseconds / 86_400_000, 3),
  };
}

export function classifyReviewDayPace(options = {}) {
  const source = objectOrEmpty(options);
  const paceMetrics = objectOrEmpty(source.paceMetrics ?? source.pace_metrics ?? source.pace);
  const thresholds = normalizeReviewDayPaceThresholds(source.thresholds ?? source.paceThresholds ?? source.pace_thresholds);
  const expectedElapsed = normalizeExpectedElapsedDays(
    source.expectedElapsed
      ?? source.expected_elapsed
      ?? source.expectedElapsedTime
      ?? source.expected_elapsed_time,
  ) ?? normalizeExpectedElapsedDays(computeExpectedElapsedCurriculumTimeForReviewDay({
    reviewDay: source.reviewDay ?? source.review_day ?? source.day,
    daySpec: source.daySpec ?? source.day_spec,
    reviewDayIds: source.reviewDayIds ?? source.review_day_ids ?? REVIEW_DAY_IDS,
    curriculumDays: source.curriculumDays ?? source.curriculum_days ?? null,
    paceInputs: source.paceInputs ?? source.pace_inputs ?? paceMetrics,
  }));
  const realElapsedDays = normalizeRealElapsedDays(paceMetrics);
  const eligible = expectedElapsed.eligible === true && expectedElapsed.expectedElapsedDays !== null;
  const rusherThresholdDays = eligible
    ? roundNumber(expectedElapsed.expectedElapsedDays * thresholds.rusherMaxExpectedRatio, 3)
    : null;
  const label = eligible
    && realElapsedDays !== null
    && rusherThresholdDays !== null
    && realElapsedDays <= rusherThresholdDays
    ? REVIEW_DAY_PACE_LABELS.RUSHER
    : REVIEW_DAY_PACE_LABELS.STEADY_PROGRESSOR;
  const reason = !eligible
    ? "not_eligible_review_day"
    : realElapsedDays === null
      ? "missing_elapsed_time"
      : label === REVIEW_DAY_PACE_LABELS.RUSHER
        ? "real_elapsed_time_below_rusher_threshold"
        : "real_elapsed_time_within_steady_threshold";

  return {
    schemaVersion: REVIEW_DAY_PACE_CLASSIFIER_SCHEMA_VERSION,
    schema_version: REVIEW_DAY_PACE_CLASSIFIER_SCHEMA_VERSION,
    schema: "agentic30.curriculum.review_day_pace_classification.v1",
    reviewDay: expectedElapsed.reviewDay,
    review_day: expectedElapsed.reviewDay,
    eligible,
    label,
    paceLabel: label,
    pace_label: label,
    userType: label,
    user_type: label,
    reason,
    realElapsedDays: realElapsedDays === null ? null : roundNumber(realElapsedDays, 3),
    real_elapsed_days: realElapsedDays === null ? null : roundNumber(realElapsedDays, 3),
    expectedElapsedDays: expectedElapsed.expectedElapsedDays,
    expected_elapsed_days: expectedElapsed.expectedElapsedDays,
    elapsedToExpectedRatio: eligible && realElapsedDays !== null
      ? roundNumber(realElapsedDays / expectedElapsed.expectedElapsedDays, 3)
      : null,
    elapsed_to_expected_ratio: eligible && realElapsedDays !== null
      ? roundNumber(realElapsedDays / expectedElapsed.expectedElapsedDays, 3)
      : null,
    thresholds,
    rusherThresholdDays,
    rusher_threshold_days: rusherThresholdDays,
    expectedElapsed,
    expected_elapsed: expectedElapsed,
  };
}

export function renderReviewDaySummaryCard({
  daySpec = {},
  reviewSummary = null,
  dashboard = null,
  progress = {},
  isLoading = false,
  requestId = null,
  sessionId = null,
  now = new Date(),
} = {}) {
  const normalizedDay = normalizeDaySpec(daySpec);
  const normalizedProgress = normalizeDashboardProgress(progress);
  const normalizedSummary = normalizeReviewSummary(reviewSummary);
  const normalizedDashboard = normalizeReviewDashboard(dashboard ?? normalizedSummary.dashboard);
  const status = resolveStatus({ isLoading, summary: normalizedSummary, dashboard: normalizedDashboard });
  const stateMessage = status === "loading"
    ? DEFAULT_LOADING_MESSAGE
    : status === "empty"
      ? DEFAULT_EMPTY_MESSAGE
      : "";
  const formattedMarkdown = status === "ready"
    ? formatReviewDaySummaryMarkdown({
        daySpec: normalizedDay,
        reviewSummary: normalizedSummary,
        dashboard: normalizedDashboard,
      })
    : stateMessage;

  return {
    schemaVersion: REVIEW_DAY_SUMMARY_SCHEMA_VERSION,
    cardType: "curriculum_review_summary_card",
    dayId: normalizedDay.dayId,
    dayType: "review",
    dayGoal: normalizedDay.goal,
    status,
    createdAt: toIso(now),
    title: `Day ${normalizedDay.dayId} Review`,
    summaryText: normalizedSummary.summaryText,
    formattedMarkdown,
    dashboard: normalizedDashboard,
    progress: normalizedProgress,
    card: buildCardPayload({
      daySpec: normalizedDay,
      status,
      stateMessage,
      reviewSummary: normalizedSummary,
      dashboard: normalizedDashboard,
      formattedMarkdown,
      progress: normalizedProgress,
    }),
    structuredPrompt: {
      requestId: requestId || null,
      sessionId: sessionId || null,
      toolName: "agentic30_curriculum_review",
      title: `Day ${normalizedDay.dayId} Review`,
      createdAt: toIso(now),
      state: status,
      markdown: formattedMarkdown,
      generation: {
        mode: "curriculum_review_summary_renderer",
        docType: "curriculum_review_day",
      },
    },
  };
}

export function formatReviewDaySummaryMarkdown({
  daySpec = {},
  reviewSummary = {},
  dashboard = {},
} = {}) {
  const normalizedDay = normalizeDaySpec(daySpec);
  const summary = normalizeReviewSummary(reviewSummary);
  const reviewDashboard = normalizeReviewDashboard(dashboard ?? summary.dashboard);
  const lines = [
    `## Day ${normalizedDay.dayId} Review - ${normalizedDay.title}`,
    "",
    `목표: ${normalizedDay.goal}`,
    "",
    "### Agent Summary",
    summary.summaryText || "아직 생성된 요약이 없습니다.",
    "",
    "### Key Insights",
    ...bulletLines(summary.keyInsights, "아직 고정된 인사이트가 없습니다."),
    "",
    "### Dashboard",
    ...metricLines(reviewDashboard.curatedMetrics),
    "",
    "### Action Items",
    ...bulletLines(reviewDashboard.actionItems, "다음 행동은 요약 생성 후 제안됩니다."),
  ];

  if (reviewDashboard.coachingCopy.body || reviewDashboard.coachingCopy.reflectionPrompt) {
    lines.push("", "### Coaching");
    if (reviewDashboard.coachingCopy.headline) lines.push(reviewDashboard.coachingCopy.headline);
    if (reviewDashboard.coachingCopy.body) lines.push(reviewDashboard.coachingCopy.body);
    if (reviewDashboard.coachingCopy.reflectionPrompt) lines.push(reviewDashboard.coachingCopy.reflectionPrompt);
  }

  if (reviewDashboard.tone) {
    lines.push("", `Tone: ${reviewDashboard.tone}`);
  }

  return compactMarkdown(lines);
}

function buildCardPayload({
  daySpec,
  status,
  stateMessage,
  reviewSummary,
  dashboard,
  formattedMarkdown,
  progress = {},
}) {
  if (status !== "ready") {
    return {
      layout: "review_agent_summary_dashboard",
      tone: "friendly_senior",
      state: status,
      blocks: [
        {
          role: "assistant",
          kind: status,
          text: stateMessage,
        },
      ],
    };
  }

  const dashboardPresentation = renderReviewDashboardPresentation({
    dashboard,
    progress,
    title: `${daySpec.title} dashboard`,
  });

  const blocks = [
    {
      role: "assistant",
      kind: "summary",
      title: daySpec.title,
      text: reviewSummary.summaryText,
    },
    dashboardPresentation.cardBlock,
    {
      role: "assistant",
      kind: "action_items",
      items: dashboard.actionItems,
    },
  ];
  if (dashboard.coachingCopy.body || dashboard.coachingCopy.reflectionPrompt) {
    blocks.push({
      role: "assistant",
      kind: "coaching",
      ...dashboard.coachingCopy,
    });
  }
  blocks.push({
    role: "assistant",
    kind: "markdown",
    text: formattedMarkdown,
  });

  return {
    layout: "review_agent_summary_dashboard",
    tone: "friendly_senior",
    state: "ready",
    blocks,
  };
}

function resolveStatus({ isLoading, summary, dashboard }) {
  if (isLoading) return "loading";
  const hasSummary = Boolean(summary.summaryText);
  const hasDashboardContent = dashboard.curatedMetrics.length > 0
    || dashboard.agentInsights.length > 0
    || dashboard.actionItems.length > 0;
  return hasSummary || hasDashboardContent ? "ready" : "empty";
}

function normalizeDaySpec(daySpec) {
  const raw = objectOrEmpty(daySpec);
  const dayId = normalizeReviewDayId(raw.day_id ?? raw.dayId ?? raw.day);
  return {
    dayId,
    title: stringOrDefault(raw.title ?? raw.day_title ?? raw.dayTitle, DEFAULT_TITLE),
    goal: stringOrDefault(raw.day_goal ?? raw.dayGoal ?? raw.goal, DEFAULT_GOAL),
  };
}

function normalizeReviewSummary(value) {
  const raw = objectOrEmpty(value);
  return {
    summaryText: stringOrDefault(raw.summaryText ?? raw.summary_text ?? raw.summary ?? raw.content, ""),
    keyInsights: normalizeStringArray(raw.keyInsights ?? raw.key_insights ?? raw.insights),
    unresolvedActions: normalizeStringArray(raw.unresolvedActions ?? raw.unresolved_actions),
    dashboard: objectOrEmpty(raw.dashboard ?? raw.reviewDashboard ?? raw.review_dashboard),
  };
}

function normalizeDayRecords(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map(normalizeDayRecord)
    .filter(Boolean)
    .sort((a, b) => a.day - b.day);
}

function normalizeDayRecord(value) {
  const raw = objectOrEmpty(value);
  const day = normalizeDayNumber(raw.day ?? raw.dayId ?? raw.day_id);
  if (!day) return null;
  const questionProgress = Array.isArray(raw.questionProgress)
    ? raw.questionProgress
    : Array.isArray(raw.question_progress)
      ? raw.question_progress
      : [];
  const actions = [
    ...(Array.isArray(raw.actions) ? raw.actions : []),
    ...(Array.isArray(raw.actionItems) ? raw.actionItems : []),
    ...(Array.isArray(raw.action_items) ? raw.action_items : []),
    ...(Array.isArray(raw.dayActions) ? raw.dayActions : []),
    ...(Array.isArray(raw.day_actions) ? raw.day_actions : []),
  ];
  return {
    ...raw,
    day,
    dayId: day,
    day_id: day,
    dayType: stringOrDefault(raw.dayType ?? raw.day_type, ""),
    day_type: stringOrDefault(raw.dayType ?? raw.day_type, ""),
    completed: raw.completed === true || raw.completionConfirmed === true || raw.completion_confirmed === true,
    questionProgress,
    question_progress: questionProgress,
    actions,
  };
}

function extractAnsweredQuestions(record) {
  return record.questionProgress
    .map((entry) => {
      const raw = objectOrEmpty(entry);
      const answer = String(raw.answer ?? raw.answerText ?? raw.answer_text ?? raw.response ?? "").trim();
      if (!answer) return null;
      const status = String(raw.status ?? raw.answerStatus ?? raw.answer_status ?? "answered").trim().toLowerCase();
      if (!["answered", "answer", "complete", "completed", "done"].includes(status)) return null;
      return {
        day: record.day,
        questionId: stringOrDefault(raw.questionId ?? raw.question_id ?? raw.id, ""),
        question: stringOrDefault(raw.question ?? raw.prompt ?? raw.text, ""),
        answer,
      };
    })
    .filter(Boolean);
}

function extractActionEntries(record) {
  return record.actions
    .map((entry, index) => {
      const raw = objectOrEmpty(entry);
      const verificationState = objectOrEmpty(raw.verificationState ?? raw.verification_state);
      const verificationResult = objectOrEmpty(
        raw.verificationResult
          ?? raw.verification_result
          ?? verificationState.verificationResult
          ?? verificationState.verification_result,
      );
      const description = stringOrDefault(
        raw.actionDescription
          ?? raw.action_description
          ?? raw.description
          ?? raw.task
          ?? raw.template,
        `Day ${record.day} action ${index + 1}`,
      );
      return {
        day: record.day,
        actionId: stringOrDefault(raw.id ?? raw.actionId ?? raw.action_id, `day-${record.day}-action-${index + 1}`),
        description,
        verified: verificationResult.passed === true
          || verificationState.status === "passed"
          || verificationState.status === "verified"
          || raw.status === "verified"
          || raw.status === "completed",
      };
    });
}

function resolveReviewTone({
  reviewDay = null,
  reviewDayIds = REVIEW_DAY_IDS,
  curriculumDays = null,
  selectedRecords = [],
  paceMetrics = {},
} = {}) {
  const raw = objectOrEmpty(paceMetrics);
  const daysElapsed = Number(raw.daysElapsed ?? raw.days_elapsed);
  const paceClassification = classifyReviewDayPace({
    reviewDay,
    reviewDayIds,
    curriculumDays,
    paceMetrics: raw,
  });
  const expectedElapsed = computeExpectedElapsedCurriculumTimeForReviewDay({
    reviewDay,
    reviewDayIds,
    curriculumDays,
    paceInputs: raw,
  });
  const expectedElapsedDays = expectedElapsed.expectedElapsedDays ?? expectedElapsed.expected_elapsed_days;
  const incompleteCount = selectedRecords.filter((record) => !record.completed).length;
  if (
    paceClassification.label === REVIEW_DAY_PACE_LABELS.RUSHER
    || paceClassification.pace_label === REVIEW_DAY_PACE_LABELS.RUSHER
    || (Number.isFinite(daysElapsed)
      && Number.isFinite(expectedElapsedDays)
      && daysElapsed > expectedElapsedDays)
    || incompleteCount >= 2
  ) {
    return "deceleration_coaching";
  }
  return "achievement_summary";
}

function buildGeneratedReviewSummaryText({
  daySpec,
  range,
  selectedRecords,
  selectedAnswers,
  verifiedActions,
  incompleteActions,
}) {
  if (!selectedRecords.length) {
    return `Day ${daySpec.dayId} Review는 Day ${range.start}-${range.end} 기록을 기다리고 있습니다. 오늘 답변을 남겨보세요.`;
  }
  const answerLine = selectedAnswers.length
    ? `핵심 답변은 ${selectedAnswers.slice(0, 3).map((answer) => `Day ${answer.day}: ${answer.answer}`).join(" / ")}입니다.`
    : "아직 답변 근거는 부족합니다.";
  const actionLine = verifiedActions.length
    ? `검증된 실행 ${verifiedActions.length}개가 다음 주 판단 근거입니다.`
    : "검증된 실행은 아직 없어서 다음 주 첫 행동은 증거 확보로 줄입니다.";
  const carryLine = incompleteActions.length
    ? `미완료 Action ${incompleteActions.length}개는 진행을 막지 않고 carry-over로 다시 다룹니다.`
    : "미완료 Action 없이 다음 주로 넘어갈 수 있습니다.";
  return `Day ${range.start}-${range.end} 기록 ${selectedRecords.length}개로 ${daySpec.title}를 생성했습니다. ${answerLine} ${actionLine} ${carryLine}`;
}

function buildGeneratedReviewInsights({ selectedAnswers, verifiedActions, incompleteActions }) {
  const insights = [];
  if (selectedAnswers[0]) {
    insights.push(`가장 최근 답변 근거: Day ${selectedAnswers[0].day} - ${selectedAnswers[0].answer}`);
  }
  if (verifiedActions.length) {
    insights.push(`검증된 실행 ${verifiedActions.length}개는 다음 난이도를 올릴 수 있는 근거입니다.`);
  }
  if (incompleteActions.length) {
    insights.push(`미완료 실행은 막지 말고 다음 Day에서 짧게 다시 해보세요.`);
  }
  return insights.length ? insights : ["Review 범위 안의 답변이나 실행 증거를 먼저 남겨보세요."];
}

function buildGeneratedReviewActionItems({ incompleteActions, selectedAnswers }) {
  if (incompleteActions.length) {
    return incompleteActions
      .slice(0, 3)
      .map((action) => `Day ${action.day} 미완료 실행을 증거 1개로 닫아보세요: ${action.description}`);
  }
  if (selectedAnswers.length) {
    return ["다음 7일 첫 Action은 위 답변 중 가장 강한 고객/실행 근거 하나에 연결해보세요."];
  }
  return ["오늘 Review 질문 1개에 먼저 답하고 다음 Action을 작게 정해보세요."];
}

function buildGeneratedReviewCoachingCopy({
  tone,
  paceClassification,
  range,
  selectedRecords,
  selectedAnswers,
  verifiedActions,
  incompleteActions,
}) {
  const isRusher = paceClassification.label === REVIEW_DAY_PACE_LABELS.RUSHER
    || paceClassification.pace_label === REVIEW_DAY_PACE_LABELS.RUSHER;
  const isSteadyProgressor = paceClassification.label === REVIEW_DAY_PACE_LABELS.STEADY_PROGRESSOR
    || paceClassification.pace_label === REVIEW_DAY_PACE_LABELS.STEADY_PROGRESSOR;

  if (tone === "achievement_summary" && isSteadyProgressor) {
    const completedCount = selectedRecords.filter((record) => record.completed).length;
    const accomplishmentSummary = `Day ${range.start}-${range.end}에서 ${completedCount}개 Day와 검증된 Action ${verifiedActions.length}개를 쌓았습니다.`;
    return {
      headline: "이번 주 리듬은 안정적으로 쌓였습니다.",
      accomplishmentSummary,
      accomplishment_summary: accomplishmentSummary,
      body: `Day ${range.start}-${range.end}에서 ${completedCount}개 Day를 완료했습니다. 지금 속도는 다음 주 실행으로 이어가기 좋으니, 가장 강한 증거 하나를 기준으로 다음 행동을 골라보세요.`,
      reflectionPrompt: buildSteadyProgressorReflectionPrompt({
        selectedAnswers,
        verifiedActions,
        incompleteActions,
      }),
      reason: "steady_progressor_achievement_summary",
    };
  }

  if (tone !== "deceleration_coaching" || !isRusher) {
    return {
      headline: "",
      body: "",
      reflectionPrompt: "",
      reason: isRusher ? "rusher_without_deceleration_tone" : "not_achievement_or_rusher",
    };
  }

  const completedCount = selectedRecords.filter((record) => record.completed).length;
  return {
    headline: "속도보다 흡수 시간을 먼저 잡아보세요.",
    body: `Day ${range.start}-${range.end} 기록은 그대로 유지합니다. ${completedCount}개 Day를 빠르게 지나왔으니 오늘은 새 Day로 바로 뛰기보다 답변과 실행 증거를 한 번 다시 읽어보세요.`,
    reflectionPrompt: buildRusherReflectionPrompt({
      selectedAnswers,
      verifiedActions,
      incompleteActions,
    }),
    reason: "rusher_deceleration_coaching",
  };
}

function buildSteadyProgressorReflectionPrompt({ selectedAnswers, verifiedActions, incompleteActions }) {
  if (verifiedActions.length) {
    return `검증된 Action ${verifiedActions.length}개 중 다음 주에 반복할 증거 하나를 골라보세요.`;
  }
  if (incompleteActions.length) {
    return `미완료 Action ${incompleteActions.length}개는 막지 않습니다. 다음 주 첫 10분 행동으로 닫을 것 하나만 골라보세요.`;
  }
  if (selectedAnswers.length) {
    return "이번 주 답변 중 다음 행동을 가장 분명하게 만드는 문장 하나를 골라보세요.";
  }
  return "다음 주 첫 행동으로 바로 이어질 관찰 하나를 적어보세요.";
}

function buildRusherReflectionPrompt({ selectedAnswers, verifiedActions, incompleteActions }) {
  if (incompleteActions.length) {
    return `미완료 Action ${incompleteActions.length}개 중 하나만 골라 "왜 아직 증거가 없었는지"를 한 줄로 적어보세요. 진행은 막지 않습니다.`;
  }
  if (verifiedActions.length) {
    return `검증된 Action ${verifiedActions.length}개 중 가장 강한 증거 하나를 골라 "다음 판단을 어떻게 바꿨는지"를 한 줄로 적어보세요.`;
  }
  if (selectedAnswers.length) {
    return `가장 중요한 답변 하나를 골라 "아직 확인하지 않은 가정"을 한 줄로 적어보세요.`;
  }
  return "오늘은 새 행동을 추가하기 전에 확인하고 싶은 가정 하나를 한 줄로 적어보세요.";
}

function bulletLines(items, fallback) {
  if (!items.length) return [`- ${fallback}`];
  return items.map((item) => `- ${item}`);
}

function compactMarkdown(lines) {
  const compacted = [];
  for (const line of lines.map((entry) => String(entry ?? "").trimEnd())) {
    const previous = compacted[compacted.length - 1];
    if (line === "" && previous === "") continue;
    compacted.push(line);
  }
  while (compacted[compacted.length - 1] === "") compacted.pop();
  return compacted.join("\n");
}

function normalizeReviewDayId(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 7;
  const day = Math.min(30, Math.max(1, Math.trunc(n)));
  return REVIEW_DAY_IDS.includes(day) ? day : 7;
}

function normalizeDayNumber(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.min(30, Math.max(1, Math.trunc(n)));
}

function normalizeCurriculumPaceInputs(value = {}) {
  const raw = objectOrEmpty(value);
  const millisecondsPerCurriculumDay = positiveNumber(
    raw.millisecondsPerCurriculumDay
      ?? raw.milliseconds_per_curriculum_day
      ?? raw.msPerCurriculumDay
      ?? raw.ms_per_curriculum_day,
  );
  const minutesPerCurriculumDay = positiveNumber(
    raw.minutesPerCurriculumDay
      ?? raw.minutes_per_curriculum_day
      ?? raw.minutesPerDay
      ?? raw.minutes_per_day,
  );
  const hoursPerCurriculumDay = positiveNumber(
    raw.hoursPerCurriculumDay
      ?? raw.hours_per_curriculum_day
      ?? raw.hoursPerDay
      ?? raw.hours_per_day,
  );
  const daysPerCurriculumDay = positiveNumber(
    raw.daysPerCurriculumDay
      ?? raw.days_per_curriculum_day
      ?? raw.realDaysPerCurriculumDay
      ?? raw.real_days_per_curriculum_day
      ?? raw.expectedDaysPerCurriculumDay
      ?? raw.expected_days_per_curriculum_day,
  );
  const curriculumDaysPerElapsedDay = positiveNumber(
    raw.curriculumDaysPerElapsedDay
      ?? raw.curriculum_days_per_elapsed_day
      ?? raw.curriculumDaysPerRealDay
      ?? raw.curriculum_days_per_real_day,
  );
  const resolvedMilliseconds = millisecondsPerCurriculumDay
    ?? (minutesPerCurriculumDay ? minutesPerCurriculumDay * 60_000 : null)
    ?? (hoursPerCurriculumDay ? hoursPerCurriculumDay * 3_600_000 : null)
    ?? (daysPerCurriculumDay ? daysPerCurriculumDay * 86_400_000 : null)
    ?? (curriculumDaysPerElapsedDay ? 86_400_000 / curriculumDaysPerElapsedDay : null)
    ?? 86_400_000;
  const resolvedDays = resolvedMilliseconds / 86_400_000;

  return {
    millisecondsPerCurriculumDay: resolvedMilliseconds,
    milliseconds_per_curriculum_day: resolvedMilliseconds,
    minutesPerCurriculumDay: roundNumber(resolvedMilliseconds / 60_000, 3),
    minutes_per_curriculum_day: roundNumber(resolvedMilliseconds / 60_000, 3),
    hoursPerCurriculumDay: roundNumber(resolvedMilliseconds / 3_600_000, 3),
    hours_per_curriculum_day: roundNumber(resolvedMilliseconds / 3_600_000, 3),
    daysPerCurriculumDay: roundNumber(resolvedDays, 3),
    days_per_curriculum_day: roundNumber(resolvedDays, 3),
    source: millisecondsPerCurriculumDay ? "milliseconds_per_curriculum_day"
      : minutesPerCurriculumDay ? "minutes_per_curriculum_day"
        : hoursPerCurriculumDay ? "hours_per_curriculum_day"
          : daysPerCurriculumDay ? "days_per_curriculum_day"
            : curriculumDaysPerElapsedDay ? "curriculum_days_per_elapsed_day"
              : "default_one_day_per_curriculum_day",
  };
}

function normalizeReviewDayPaceThresholds(value = {}) {
  const raw = objectOrEmpty(value);
  const rusherMaxExpectedRatio = positiveNumber(
    raw.rusherMaxExpectedRatio
      ?? raw.rusher_max_expected_ratio
      ?? raw.rusherThresholdRatio
      ?? raw.rusher_threshold_ratio
      ?? raw.maxRusherRatio
      ?? raw.max_rusher_ratio,
  ) ?? 0.75;
  return {
    rusherMaxExpectedRatio,
    rusher_max_expected_ratio: rusherMaxExpectedRatio,
  };
}

function normalizeExpectedElapsedDays(value = {}) {
  const raw = objectOrEmpty(value);
  const reviewDay = normalizeDayNumber(raw.reviewDay ?? raw.review_day ?? raw.day) ?? null;
  const eligible = raw.eligible === true;
  const expectedElapsedDays = positiveOrZeroNumber(
    raw.expectedElapsedDays
      ?? raw.expected_elapsed_days,
  ) ?? millisecondsToDays(
    raw.expectedElapsedMilliseconds
      ?? raw.expected_elapsed_milliseconds,
  ) ?? hoursToDays(
    raw.expectedElapsedHours
      ?? raw.expected_elapsed_hours,
  ) ?? minutesToDays(
    raw.expectedElapsedMinutes
      ?? raw.expected_elapsed_minutes,
  );
  if (!eligible && expectedElapsedDays === null) return null;
  return {
    ...raw,
    reviewDay,
    review_day: reviewDay,
    eligible,
    expectedElapsedDays,
    expected_elapsed_days: expectedElapsedDays,
  };
}

function normalizeRealElapsedDays(value = {}) {
  const raw = objectOrEmpty(value);
  return positiveOrZeroNumber(raw.daysElapsed ?? raw.days_elapsed ?? raw.elapsedRealDays ?? raw.elapsed_real_days)
    ?? millisecondsToDays(raw.elapsedMilliseconds ?? raw.elapsed_milliseconds)
    ?? hoursToDays(raw.elapsedHours ?? raw.elapsed_hours)
    ?? minutesToDays(raw.elapsedMinutes ?? raw.elapsed_minutes)
    ?? elapsedDaysFromTimestamps(raw);
}

function elapsedDaysFromTimestamps(value = {}) {
  const raw = objectOrEmpty(value);
  const start = parseTimestamp(
    raw.startTimestamp
      ?? raw.start_timestamp
      ?? raw.firstStartedAt
      ?? raw.first_started_at,
  );
  const end = parseTimestamp(
    raw.endTimestamp
      ?? raw.end_timestamp
      ?? raw.lastCompletedAt
      ?? raw.last_completed_at,
  );
  if (!start || !end) return null;
  return Math.max(0, (end.getTime() - start.getTime()) / 86_400_000);
}

function millisecondsToDays(value) {
  const n = positiveOrZeroNumber(value);
  return n === null ? null : n / 86_400_000;
}

function minutesToDays(value) {
  const n = positiveOrZeroNumber(value);
  return n === null ? null : n / 1_440;
}

function hoursToDays(value) {
  const n = positiveOrZeroNumber(value);
  return n === null ? null : n / 24;
}

function positiveNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function positiveOrZeroNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function parseTimestamp(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function roundNumber(value, decimals = 3) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => String(entry ?? "").trim())
    .filter(Boolean);
}

function objectOrEmpty(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function stringOrDefault(value, fallback) {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function toIso(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : new Date().toISOString();
}
