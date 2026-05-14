import {
  assembleCurriculumDayContext,
  normalizeCurriculumProgressState,
  resolveReviewDayEligibleDayRange,
} from "./adaptive-curriculum.mjs";

export const REVIEW_DAY_CURRICULUM_SIGNAL_SCHEMA_VERSION = 1;
export const REVIEW_DAY_COACHING_SIGNAL_SCHEMA_VERSION = 1;

const REVIEW_DAY_IDS = Object.freeze([7, 14, 21, 28]);
const ACTION_COMPLETE_STATUSES = new Set([
  "accepted",
  "complete",
  "completed",
  "done",
  "ok",
  "passed",
  "success",
  "succeeded",
  "validated",
  "verified",
]);
const QUESTION_COMPLETE_STATUSES = new Set(["answered", "answer", "complete", "completed", "done"]);
const AUTO_VERIFICATION_METHODS = new Set(["mcp", "cli", "browser", "google_docs", "google_sheets"]);
const EVIDENCE_VERIFICATION_METHODS = new Set(["evidence_link", "evidence_file"]);

export function collectReviewDayCurriculumSignals({
  reviewDay = null,
  daySpec = {},
  progressState = null,
  dayRecords = null,
  reviewDayIds = REVIEW_DAY_IDS,
  curriculumDays = null,
  now = new Date(),
} = {}) {
  const rawDaySpec = objectOrEmpty(daySpec);
  const targetDay = normalizeDayNumber(
    reviewDay
      ?? rawDaySpec.dayId
      ?? rawDaySpec.day_id
      ?? rawDaySpec.day,
  ) ?? 7;
  const eligibility = resolveReviewDayEligibleDayRange({
    reviewDay: targetDay,
    reviewDayIds,
    curriculumDays,
  });
  const dayRange = eligibility.dayRange ?? eligibility.day_range ?? null;
  const rawProgressState = objectOrEmpty(progressState);
  const hasProgressStateSource = Object.keys(rawProgressState).length > 0;
  const normalizedProgressState = hasProgressStateSource
    ? normalizeCurriculumProgressState(rawProgressState)
    : null;
  const explicitDayRecordSource = Array.isArray(dayRecords);
  const sourceDayRecords = explicitDayRecordSource
    ? dayRecords
    : normalizedProgressState?.dayRecords ?? normalizedProgressState?.day_records ?? [];
  const normalizedDayRecords = normalizeSignalDayRecords(sourceDayRecords);
  const selectedDayRecords = dayRange
    ? normalizedDayRecords.filter((record) => record.day >= dayRange.start && record.day <= dayRange.end)
    : [];
  const expectedDayCount = dayRange ? Math.max(0, dayRange.end - dayRange.start + 1) : 0;
  const completedDayCount = selectedDayRecords.filter((record) => record.completed).length;
  const answeredQuestionCount = selectedDayRecords.reduce(
    (total, record) => total + record.questionProgress.filter((question) => question.answered).length,
    0,
  );
  const actionEntries = selectedDayRecords.flatMap((record) => record.actions);
  const verifiedActionCount = actionEntries.filter((action) => action.verified).length;
  const autoVerifiedActionCount = actionEntries.filter(
    (action) => action.verified && action.verificationSource === "auto",
  ).length;
  const evidenceVerifiedActionCount = actionEntries.filter(
    (action) => action.verified && action.verificationSource === "evidence",
  ).length;
  const missingActionSourceCount = selectedDayRecords.filter(
    (record) => !record.actionSourceAvailable,
  ).length;
  const carryOverQueue = normalizeCarryOverQueue(
    normalizedProgressState?.carryOverQueue
      ?? normalizedProgressState?.carry_over_queue
      ?? rawProgressState.carryOverQueue
      ?? rawProgressState.carry_over_queue,
  );
  const weeklySummaryStack = normalizeWeeklySummaryStack(
    normalizedProgressState?.weeklySummaryStack
      ?? normalizedProgressState?.weekly_summary_stack
      ?? rawProgressState.weeklySummaryStack
      ?? rawProgressState.weekly_summary_stack,
  );
  const coachingSignals = collectReviewDayCoachingSignals({
    reviewDay: targetDay,
    daySpec: rawDaySpec,
    progressState: rawProgressState,
    dayRecords: sourceDayRecords,
    hasProgressStateSource,
    now,
  });
  const sourceStatuses = normalizeSourceStatuses({
    hasProgressStateSource,
    explicitDayRecordSource,
    normalizedDayRecords,
    selectedDayRecords,
    actionEntries,
    weeklySummaryStack,
    carryOverQueue,
  });
  const missingSources = sourceStatuses.filter((source) => !source.available).map((source) => source.type);
  const hasSignals = selectedDayRecords.length > 0
    || weeklySummaryStack.length > 0
    || carryOverQueue.length > 0;
  const dashboardMetrics = buildDashboardMetrics({
    eligible: eligibility.eligible === true,
    dayRange,
    expectedDayCount,
    completedDayCount,
    selectedDayRecords,
    answeredQuestionCount,
    actionEntries,
    verifiedActionCount,
    autoVerifiedActionCount,
    evidenceVerifiedActionCount,
    missingActionSourceCount,
    carryOverQueue,
    coachingSignals,
    hasProgressStateSource,
    explicitDayRecordSource,
  });
  const dashboardInsights = buildDashboardInsights({
    eligible: eligibility.eligible === true,
    selectedDayRecords,
    expectedDayCount,
    completedDayCount,
    answeredQuestionCount,
    actionEntries,
    verifiedActionCount,
    autoVerifiedActionCount,
    evidenceVerifiedActionCount,
    missingSources,
    coachingSignals,
  });
  const dashboardActionItems = buildDashboardActionItems({
    eligible: eligibility.eligible === true,
    selectedDayRecords,
    missingSources,
    missingActionSourceCount,
    carryOverQueue,
    coachingSignals,
  });

  return {
    schemaVersion: REVIEW_DAY_CURRICULUM_SIGNAL_SCHEMA_VERSION,
    schema_version: REVIEW_DAY_CURRICULUM_SIGNAL_SCHEMA_VERSION,
    schema: "agentic30.curriculum.review_day_curriculum_signals.v1",
    generatedAt: toIso(now),
    generated_at: toIso(now),
    reviewDay: targetDay,
    review_day: targetDay,
    eligible: eligibility.eligible === true,
    dayRange,
    day_range: dayRange,
    hasSignals,
    has_signals: hasSignals,
    sourceStatuses,
    source_statuses: sourceStatuses,
    missingSources,
    missing_sources: missingSources,
    selectedDayRecords,
    selected_day_records: selectedDayRecords,
    selectedDayIds: selectedDayRecords.map((record) => record.day),
    selected_day_ids: selectedDayRecords.map((record) => record.day),
    expectedDayCount,
    expected_day_count: expectedDayCount,
    completedDayCount,
    completed_day_count: completedDayCount,
    answeredQuestionCount,
    answered_question_count: answeredQuestionCount,
    actionCount: actionEntries.length,
    action_count: actionEntries.length,
    verifiedActionCount,
    verified_action_count: verifiedActionCount,
    autoVerifiedActionCount,
    auto_verified_action_count: autoVerifiedActionCount,
    evidenceVerifiedActionCount,
    evidence_verified_action_count: evidenceVerifiedActionCount,
    missingActionSourceCount,
    missing_action_source_count: missingActionSourceCount,
    actionSignals: actionEntries,
    action_signals: actionEntries,
    carryOverCount: carryOverQueue.length,
    carry_over_count: carryOverQueue.length,
    weeklySummaryCount: weeklySummaryStack.length,
    weekly_summary_count: weeklySummaryStack.length,
    coachingSignals,
    coaching_signals: coachingSignals,
    dashboardMetrics,
    dashboard_metrics: dashboardMetrics,
    dashboardInsights,
    dashboard_insights: dashboardInsights,
    dashboardActionItems,
    dashboard_action_items: dashboardActionItems,
  };
}

export function collectReviewDayCoachingSignals({
  reviewDay = null,
  daySpec = {},
  progressState = null,
  dayRecords = null,
  hasProgressStateSource = null,
  now = new Date(),
} = {}) {
  const rawDaySpec = objectOrEmpty(daySpec);
  const targetDay = normalizeDayNumber(
    reviewDay
      ?? rawDaySpec.dayId
      ?? rawDaySpec.day_id
      ?? rawDaySpec.day,
  ) ?? 7;
  const rawProgressState = objectOrEmpty(progressState);
  const hasProgress = hasProgressStateSource ?? Object.keys(rawProgressState).length > 0;
  const explicitCoaching = normalizeExplicitCoachingSources(rawProgressState);
  const assembled = hasProgress
    ? safeAssembleCurriculumDayContext({
        day: targetDay,
        progressState: rawProgressState,
        dayRecords: Array.isArray(dayRecords) ? dayRecords : undefined,
        now,
      })
    : null;
  const adaptiveDifficultyState = normalizeAdaptiveDifficultyState(
    explicitCoaching.adaptiveDifficultyState
      ?? assembled?.adaptiveDifficultyState
      ?? assembled?.adaptive_difficulty_state,
  );
  const carryOverCoaching = normalizeCarryOverCoaching(
    explicitCoaching.carryOverCoaching
      ?? assembled?.carryOverCoaching
      ?? assembled?.carry_over_coaching,
  );
  const coachingFeedbackSurface = normalizeCoachingFeedbackSurface(
    explicitCoaching.coachingFeedbackSurface
      ?? assembled?.coachingFeedbackSurface
      ?? assembled?.coaching_feedback_surface,
  );
  const adaptiveCoachEvents = normalizeAdaptiveCoachEvents(
    rawProgressState.adaptiveCoachEvents
      ?? rawProgressState.adaptive_coach_events
      ?? rawProgressState.coachingEvents
      ?? rawProgressState.coaching_events
      ?? rawProgressState.coachingHistory
      ?? rawProgressState.coaching_history,
  );
  const sourceStatuses = normalizeCoachingSourceStatuses({
    hasProgress,
    adaptiveDifficultyState,
    carryOverCoaching,
    coachingFeedbackSurface,
    adaptiveCoachEvents,
  });
  const missingSources = sourceStatuses.filter((source) => !source.available).map((source) => source.type);
  const availableSourceCount = sourceStatuses.length - missingSources.length;
  const hasSignals = sourceStatuses.some((source) => source.available)
    || adaptiveDifficultyState.hasAdaptiveAdjustment
    || carryOverCoaching.eligibleActionCount > 0
    || adaptiveCoachEvents.length > 0;
  const dashboardMetrics = buildCoachingDashboardMetrics({
    adaptiveDifficultyState,
    carryOverCoaching,
    adaptiveCoachEvents,
    availableSourceCount,
    sourceStatuses,
  });
  const dashboardInsights = buildCoachingDashboardInsights({
    adaptiveDifficultyState,
    carryOverCoaching,
    adaptiveCoachEvents,
    missingSources,
  });
  const dashboardActionItems = buildCoachingDashboardActionItems({
    adaptiveDifficultyState,
    carryOverCoaching,
    missingSources,
  });

  return {
    schemaVersion: REVIEW_DAY_COACHING_SIGNAL_SCHEMA_VERSION,
    schema_version: REVIEW_DAY_COACHING_SIGNAL_SCHEMA_VERSION,
    schema: "agentic30.curriculum.review_day_coaching_signals.v1",
    generatedAt: toIso(now),
    generated_at: toIso(now),
    reviewDay: targetDay,
    review_day: targetDay,
    hasSignals,
    has_signals: hasSignals,
    sourceStatuses,
    source_statuses: sourceStatuses,
    missingSources,
    missing_sources: missingSources,
    availableSourceCount,
    available_source_count: availableSourceCount,
    missingSourceCount: missingSources.length,
    missing_source_count: missingSources.length,
    adaptiveDifficultyState,
    adaptive_difficulty_state: adaptiveDifficultyState,
    carryOverCoaching,
    carry_over_coaching: carryOverCoaching,
    coachingFeedbackSurface,
    coaching_feedback_surface: coachingFeedbackSurface,
    adaptiveCoachEvents,
    adaptive_coach_events: adaptiveCoachEvents,
    dashboardMetrics,
    dashboard_metrics: dashboardMetrics,
    dashboardInsights,
    dashboard_insights: dashboardInsights,
    dashboardActionItems,
    dashboard_action_items: dashboardActionItems,
  };
}

export function normalizeReviewDayCurriculumSignals(value = {}, options = {}) {
  const raw = objectOrEmpty(value);
  if (!Object.keys(raw).length || raw.schema !== "agentic30.curriculum.review_day_curriculum_signals.v1") {
    return collectReviewDayCurriculumSignals({
      ...options,
      progressState: raw.progressState ?? raw.progress_state ?? raw,
      dayRecords: raw.dayRecords ?? raw.day_records,
    });
  }
  const metrics = Array.isArray(raw.dashboardMetrics)
    ? raw.dashboardMetrics
    : Array.isArray(raw.dashboard_metrics)
      ? raw.dashboard_metrics
      : [];
  const insights = normalizeStringArray(raw.dashboardInsights ?? raw.dashboard_insights);
  const actionItems = normalizeStringArray(raw.dashboardActionItems ?? raw.dashboard_action_items);
  return {
    ...raw,
    schemaVersion: REVIEW_DAY_CURRICULUM_SIGNAL_SCHEMA_VERSION,
    schema_version: REVIEW_DAY_CURRICULUM_SIGNAL_SCHEMA_VERSION,
    schema: "agentic30.curriculum.review_day_curriculum_signals.v1",
    generatedAt: stringOrDefault(raw.generatedAt ?? raw.generated_at, toIso(options.now ?? new Date())),
    generated_at: stringOrDefault(raw.generatedAt ?? raw.generated_at, toIso(options.now ?? new Date())),
    reviewDay: normalizeDayNumber(raw.reviewDay ?? raw.review_day) ?? normalizeDayNumber(options.reviewDay) ?? 7,
    review_day: normalizeDayNumber(raw.reviewDay ?? raw.review_day) ?? normalizeDayNumber(options.reviewDay) ?? 7,
    dayRange: normalizeDayRange(raw.dayRange ?? raw.day_range),
    day_range: normalizeDayRange(raw.dayRange ?? raw.day_range),
    dashboardMetrics: metrics.map(normalizeMetric).filter((metric) => metric.label || metric.value),
    dashboard_metrics: metrics.map(normalizeMetric).filter((metric) => metric.label || metric.value),
    dashboardInsights: insights,
    dashboard_insights: insights,
    dashboardActionItems: actionItems,
    dashboard_action_items: actionItems,
  };
}

function normalizeSignalDayRecords(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map(normalizeSignalDayRecord)
    .filter(Boolean)
    .sort((a, b) => a.day - b.day);
}

function normalizeSignalDayRecord(value) {
  const raw = objectOrEmpty(value);
  const day = normalizeDayNumber(raw.day ?? raw.dayId ?? raw.day_id);
  if (!day) return null;
  const questionProgress = normalizeQuestionProgress(raw.questionProgress ?? raw.question_progress);
  const rawActionEntries = collectSignalActionEntries(raw);
  const actions = normalizeActionEntries(rawActionEntries, { sourceDay: day });
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
    actionSourceAvailable: rawActionEntries.length > 0,
    action_source_available: rawActionEntries.length > 0,
  };
}

function normalizeQuestionProgress(value) {
  if (!Array.isArray(value)) return [];
  return value.map((entry, index) => {
    const raw = objectOrEmpty(entry);
    const answer = String(raw.answer ?? raw.answerText ?? raw.answer_text ?? raw.response ?? "").trim();
    const status = String(raw.status ?? raw.answerStatus ?? raw.answer_status ?? "").trim().toLowerCase();
    return {
      questionId: stringOrDefault(raw.questionId ?? raw.question_id ?? raw.id, `question-${index + 1}`),
      question_id: stringOrDefault(raw.questionId ?? raw.question_id ?? raw.id, `question-${index + 1}`),
      answered: Boolean(answer) && QUESTION_COMPLETE_STATUSES.has(status || "answered"),
      status: status || (answer ? "answered" : "draft"),
      answer,
    };
  });
}

function collectSignalActionEntries(raw) {
  const entries = [
    ...(Array.isArray(raw.actions) ? raw.actions : []),
    ...(Array.isArray(raw.actionItems) ? raw.actionItems : []),
    ...(Array.isArray(raw.action_items) ? raw.action_items : []),
    ...(Array.isArray(raw.actionProgress) ? raw.actionProgress : []),
    ...(Array.isArray(raw.action_progress) ? raw.action_progress : []),
    ...(Array.isArray(raw.dayActions) ? raw.dayActions : []),
    ...(Array.isArray(raw.day_actions) ? raw.day_actions : []),
    ...(Array.isArray(raw.actionSpecs) ? raw.actionSpecs : []),
    ...(Array.isArray(raw.action_specs) ? raw.action_specs : []),
    ...(Array.isArray(raw.verificationStates) ? raw.verificationStates : []),
    ...(Array.isArray(raw.verification_states) ? raw.verification_states : []),
    ...(Array.isArray(raw.actionVerifications) ? raw.actionVerifications : []),
    ...(Array.isArray(raw.action_verifications) ? raw.action_verifications : []),
  ];
  const singleAction = raw.actionSpec ?? raw.action_spec;
  if (singleAction && typeof singleAction === "object") {
    entries.push({
      ...singleAction,
      verificationState: raw.verificationState ?? raw.verification_state ?? null,
      verificationResult: raw.verificationResult ?? raw.verification_result ?? null,
      evidenceSubmission: raw.evidenceSubmission ?? raw.evidence_submission ?? null,
      status: raw.actionStatus ?? raw.action_status ?? raw.status,
    });
  }
  const verificationState = raw.verificationState ?? raw.verification_state;
  if (verificationState && typeof verificationState === "object" && !singleAction) {
    entries.push({
      verificationState,
      verificationResult: raw.verificationResult ?? raw.verification_result ?? null,
      evidenceSubmission: raw.evidenceSubmission ?? raw.evidence_submission ?? null,
      status: raw.actionStatus ?? raw.action_status ?? raw.status,
    });
  }
  return entries.filter((entry) => entry && typeof entry === "object");
}

function normalizeActionEntries(value, { sourceDay = null } = {}) {
  if (!Array.isArray(value)) return [];
  return value.map((entry, index) => {
    const raw = objectOrEmpty(entry);
    const verificationState = objectOrEmpty(raw.verificationState ?? raw.verification_state);
    const verificationResult = objectOrEmpty(
      raw.verificationResult
        ?? raw.verification_result
        ?? verificationState.verificationResult
        ?? verificationState.verification_result,
    );
    const evidenceSubmission = objectOrEmpty(
      raw.evidenceSubmission
        ?? raw.evidence_submission
        ?? verificationState.evidenceSubmission
        ?? verificationState.evidence_submission,
    );
    const status = String(
      verificationResult.status
        ?? verificationResult.outcome
        ?? verificationState.status
        ?? evidenceSubmission.validationStatus
        ?? evidenceSubmission.validation_status
        ?? evidenceSubmission.status
        ?? raw.status
        ?? raw.progressStatus
        ?? raw.progress_status
        ?? verificationResult.status
        ?? "",
    ).trim().toLowerCase();
    const verified = verificationResult.passed === true
      || verificationResult.pass === true
      || verificationResult.verified === true
      || verificationState.passed === true
      || raw.verified === true
      || ACTION_COMPLETE_STATUSES.has(status);
    const method = normalizeVerificationMethod(
      verificationResult.method
        ?? verificationResult.verifier
        ?? verificationResult.type
        ?? verificationState.method
        ?? raw.verificationMethod
        ?? raw.verification_method
        ?? inferEvidenceMethod(evidenceSubmission),
    );
    const verificationSource = classifyVerificationSource(method, evidenceSubmission);
    const normalizedEvidence = normalizeEvidenceSubmission(evidenceSubmission);
    const actionId = stringOrDefault(raw.id ?? raw.actionId ?? raw.action_id, `action-${index + 1}`);
    const description = stringOrDefault(
      raw.description
        ?? raw.actionDescription
        ?? raw.action_description
        ?? raw.task
        ?? raw.title,
      "",
    );
    const completionSignal = stringOrDefault(
      raw.completionSignal
        ?? raw.completion_signal
        ?? raw.completion
        ?? raw.signal,
      "",
    );
    return {
      sourceDay,
      source_day: sourceDay,
      id: actionId,
      actionId,
      action_id: actionId,
      description,
      actionDescription: description,
      action_description: description,
      completionSignal,
      completion_signal: completionSignal,
      status,
      verified,
      verificationMethod: method,
      verification_method: method,
      verificationSource,
      verification_source: verificationSource,
      verificationResult: Object.keys(verificationResult).length ? verificationResult : null,
      verification_result: Object.keys(verificationResult).length ? verificationResult : null,
      evidenceSubmission: normalizedEvidence,
      evidence_submission: normalizedEvidence,
    };
  });
}

function normalizeVerificationMethod(value) {
  const normalized = String(value ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  const aliases = {
    browser_tool: "browser",
    evidence_file_upload: "evidence_file",
    evidence_link_url: "evidence_link",
    googledocs: "google_docs",
    google_doc: "google_docs",
    google_docs_read: "google_docs",
    google_document: "google_docs",
    google_sheets_read: "google_sheets",
    google_sheet: "google_sheets",
    googlesheets: "google_sheets",
    gws_docs_read: "google_docs",
    gws_sheets_read: "google_sheets",
  };
  return aliases[normalized] ?? normalized;
}

function inferEvidenceMethod(evidenceSubmission) {
  const raw = objectOrEmpty(evidenceSubmission);
  const type = String(raw.type ?? raw.evidenceType ?? raw.evidence_type ?? "").trim().toLowerCase();
  if (type === "link") return "evidence_link";
  if (type === "file") return "evidence_file";
  return "";
}

function classifyVerificationSource(method, evidenceSubmission) {
  if (AUTO_VERIFICATION_METHODS.has(method)) return "auto";
  if (EVIDENCE_VERIFICATION_METHODS.has(method)) return "evidence";
  if (Object.keys(objectOrEmpty(evidenceSubmission)).length > 0) return "evidence";
  return method ? "manual" : "unknown";
}

function normalizeEvidenceSubmission(value) {
  const raw = objectOrEmpty(value);
  if (!Object.keys(raw).length) return null;
  return {
    type: stringOrDefault(raw.type ?? raw.evidenceType ?? raw.evidence_type, ""),
    content: stringOrDefault(raw.content ?? raw.value ?? raw.url ?? raw.path, ""),
    validationStatus: stringOrDefault(raw.validationStatus ?? raw.validation_status ?? raw.status, ""),
    validation_status: stringOrDefault(raw.validationStatus ?? raw.validation_status ?? raw.status, ""),
  };
}

function normalizeCarryOverQueue(value) {
  return Array.isArray(value) ? value.filter((entry) => objectOrEmpty(entry)).map(objectOrEmpty) : [];
}

function normalizeWeeklySummaryStack(value) {
  return Array.isArray(value) ? value.filter((entry) => objectOrEmpty(entry)).map(objectOrEmpty) : [];
}

function normalizeSourceStatuses({
  hasProgressStateSource,
  explicitDayRecordSource,
  normalizedDayRecords,
  selectedDayRecords,
  actionEntries,
  weeklySummaryStack,
  carryOverQueue,
}) {
  return [
    {
      type: "progressState",
      source_type: "progressState",
      label: "Curriculum progress state",
      available: hasProgressStateSource,
      status: hasProgressStateSource ? "available" : "missing",
      detail: hasProgressStateSource ? "normalized" : "progress state source missing",
    },
    {
      type: "dayRecords",
      source_type: "dayRecords",
      label: "Day records",
      available: normalizedDayRecords.length > 0,
      status: normalizedDayRecords.length > 0 ? "available" : "missing",
      detail: explicitDayRecordSource ? "explicit day records" : "derived from progress state",
    },
    {
      type: "actionSources",
      source_type: "actionSources",
      label: "Action completion signals",
      available: actionEntries.length > 0,
      status: actionEntries.length > 0 ? "available" : "missing",
      detail: selectedDayRecords.length > 0
        ? `${actionEntries.length} actions across ${selectedDayRecords.length} eligible records`
        : "no eligible day records with action sources",
    },
    {
      type: "weeklySummaryStack",
      source_type: "weeklySummaryStack",
      label: "Weekly summary stack",
      available: weeklySummaryStack.length > 0,
      status: weeklySummaryStack.length > 0 ? "available" : "missing",
      detail: `${weeklySummaryStack.length} summaries`,
    },
    {
      type: "carryOverQueue",
      source_type: "carryOverQueue",
      label: "Carry-over queue",
      available: carryOverQueue.length > 0,
      status: carryOverQueue.length > 0 ? "available" : "missing",
      detail: `${carryOverQueue.length} items`,
    },
  ];
}

function buildDashboardMetrics({
  eligible,
  dayRange,
  expectedDayCount,
  completedDayCount,
  selectedDayRecords,
  answeredQuestionCount,
  actionEntries,
  verifiedActionCount,
  autoVerifiedActionCount,
  evidenceVerifiedActionCount,
  missingActionSourceCount,
  carryOverQueue,
  coachingSignals,
  hasProgressStateSource,
  explicitDayRecordSource,
}) {
  return [
    {
      label: "Curriculum source",
      value: hasProgressStateSource ? "progress-state" : explicitDayRecordSource ? "day-records" : "missing",
      trend: hasProgressStateSource || explicitDayRecordSource ? "ready" : "missing-source",
      intent: "Review Day 대시보드가 참조할 수 있는 curriculum progress/state",
      status: hasProgressStateSource || explicitDayRecordSource ? "healthy" : "watch",
    },
    {
      label: "Eligible curriculum Days",
      value: eligible && dayRange ? `${completedDayCount}/${expectedDayCount}` : "not-eligible",
      trend: selectedDayRecords.length === 0
        ? "no-progress"
        : completedDayCount >= expectedDayCount
          ? "complete"
          : "in-progress",
      intent: "Review 범위 안에서 완료 확인된 Day 수",
      status: completedDayCount >= expectedDayCount && expectedDayCount > 0 ? "healthy" : "watch",
    },
    {
      label: "Answered curriculum questions",
      value: String(answeredQuestionCount),
      trend: answeredQuestionCount > 0 ? "evidence-backed" : "needs-answers",
      intent: "Review 요약에 쓸 수 있는 실제 질문 답변 수",
      status: answeredQuestionCount > 0 ? "healthy" : "watch",
    },
    {
      label: "Verified curriculum actions",
      value: `${verifiedActionCount}/${actionEntries.length}`,
      trend: verifiedActionCount > 0 ? "verified" : "needs-evidence",
      intent: "자동 검증 또는 evidence 제출로 확인된 실행 수",
      status: verifiedActionCount > 0 ? "healthy" : "watch",
    },
    {
      label: "Auto-verified Actions",
      value: String(autoVerifiedActionCount),
      trend: autoVerifiedActionCount > 0 ? "tool-verified" : "none",
      intent: "MCP, CLI, Browser Tool, Google Docs, Google Sheets로 자동 확인된 실행",
      status: autoVerifiedActionCount > 0 ? "healthy" : "watch",
    },
    {
      label: "Evidence fallback Actions",
      value: String(evidenceVerifiedActionCount),
      trend: evidenceVerifiedActionCount > 0 ? "agent-validated" : "none",
      intent: "링크 또는 파일 evidence로 검증된 실행",
      status: evidenceVerifiedActionCount > 0 ? "healthy" : "watch",
    },
    {
      label: "Missing Action sources",
      value: String(missingActionSourceCount),
      trend: missingActionSourceCount > 0 ? "missing-source" : "covered",
      intent: "Review 범위에 있지만 action completion/verification 신호가 없는 Day record 수",
      status: missingActionSourceCount > 0 ? "watch" : "healthy",
    },
    {
      label: "Carry-over coaching queue",
      value: String(carryOverQueue.length),
      trend: carryOverQueue.length > 0 ? "non-blocking" : "clear",
      intent: "진행을 막지 않고 다시 코칭할 미완료 실행",
      status: carryOverQueue.length > 0 ? "watch" : "healthy",
    },
    ...normalizeCoachingDashboardList(coachingSignals?.dashboardMetrics ?? coachingSignals?.dashboard_metrics),
  ];
}

function buildDashboardInsights({
  eligible,
  selectedDayRecords,
  expectedDayCount,
  completedDayCount,
  answeredQuestionCount,
  actionEntries,
  verifiedActionCount,
  autoVerifiedActionCount,
  evidenceVerifiedActionCount,
  missingSources,
  coachingSignals,
}) {
  const insights = [];
  if (!eligible) {
    insights.push("현재 Day는 Review Day가 아니어서 curriculum signal을 참고 상태로만 표시합니다.");
  } else if (selectedDayRecords.length === 0) {
    insights.push("Review 범위 안의 curriculum progress가 아직 없어 대시보드는 빈 상태로 시작합니다.");
  } else {
    insights.push(`Review 범위에서 ${completedDayCount}/${expectedDayCount}개 Day가 완료 신호로 잡혔습니다.`);
  }
  if (answeredQuestionCount > 0) {
    insights.push(`답변 ${answeredQuestionCount}개를 agent summary의 정성 근거로 사용할 수 있습니다.`);
  }
  if (actionEntries.length > 0) {
    insights.push(`Action ${actionEntries.length}개 중 ${verifiedActionCount}개가 검증 신호를 갖고 있습니다.`);
    if (autoVerifiedActionCount > 0 || evidenceVerifiedActionCount > 0) {
      insights.push(
        `자동 검증 ${autoVerifiedActionCount}개, evidence fallback ${evidenceVerifiedActionCount}개를 Review metrics에 반영했습니다.`,
      );
    }
  }
  if (missingSources.includes("actionSources")) {
    insights.push("Action source가 없는 Day는 진행을 막지 않고 missing-source metric으로만 표시합니다.");
  }
  if (missingSources.includes("progressState") && missingSources.includes("dayRecords")) {
    insights.push("Curriculum source가 비어 있어 Review Day는 workspace/evidence fallback만 사용합니다.");
  }
  insights.push(...normalizeStringArray(coachingSignals?.dashboardInsights ?? coachingSignals?.dashboard_insights));
  return insights;
}

function buildDashboardActionItems({
  eligible,
  selectedDayRecords,
  missingSources,
  missingActionSourceCount = 0,
  carryOverQueue,
  coachingSignals,
}) {
  const items = [];
  if (eligible && selectedDayRecords.length === 0) {
    items.push("오늘 질문 하나만 답해도 다음 Review 대시보드가 자동으로 채워집니다.");
  }
  if (
    (missingSources.includes("actionSources") || missingActionSourceCount > 0)
    && selectedDayRecords.length > 0
  ) {
    items.push("Action source가 비어 있는 Day는 막지 말고 다음 질문에서 evidence 링크나 파일로 보강해보세요.");
  }
  if (missingSources.includes("progressState") && missingSources.includes("dayRecords")) {
    items.push("Progress state가 없으면 진행을 멈추지 말고 링크나 파일 evidence로 먼저 남겨보세요.");
  }
  if (carryOverQueue.length > 0) {
    items.push("Carry-over Action은 막힘이 아니라 다음 Day의 첫 mini-action 후보로 다시 다뤄보세요.");
  }
  items.push(...normalizeStringArray(coachingSignals?.dashboardActionItems ?? coachingSignals?.dashboard_action_items));
  return items;
}

function safeAssembleCurriculumDayContext(options) {
  try {
    return assembleCurriculumDayContext(options);
  } catch {
    return null;
  }
}

function normalizeExplicitCoachingSources(rawProgressState) {
  const raw = objectOrEmpty(rawProgressState);
  const providerContext = objectOrEmpty(raw.providerContext ?? raw.provider_context);
  const curriculumContext = objectOrEmpty(raw.curriculumContext ?? raw.curriculum_context);
  return {
    adaptiveDifficultyState:
      raw.adaptiveDifficultyState
      ?? raw.adaptive_difficulty_state
      ?? curriculumContext.adaptiveDifficultyState
      ?? curriculumContext.adaptive_difficulty_state
      ?? providerContext.adaptiveDifficultyState
      ?? providerContext.adaptive_difficulty_state,
    carryOverCoaching:
      raw.carryOverCoaching
      ?? raw.carry_over_coaching
      ?? curriculumContext.carryOverCoaching
      ?? curriculumContext.carry_over_coaching
      ?? providerContext.carryOverCoaching
      ?? providerContext.carry_over_coaching,
    coachingFeedbackSurface:
      raw.coachingFeedbackSurface
      ?? raw.coaching_feedback_surface
      ?? curriculumContext.coachingFeedbackSurface
      ?? curriculumContext.coaching_feedback_surface
      ?? providerContext.coachingFeedbackSurface
      ?? providerContext.coaching_feedback_surface,
  };
}

function normalizeAdaptiveDifficultyState(value) {
  const raw = objectOrEmpty(value);
  const direction = stringOrDefault(raw.direction, "none");
  const trigger = stringOrDefault(raw.trigger, "none");
  const adjustmentsApplied = normalizeStringArray(raw.adjustmentsApplied ?? raw.adjustments_applied);
  const progressionBlocked = raw.progressionBlocked === true || raw.progression_blocked === true || raw.blocking === true;
  const canAdvanceDay = raw.canAdvanceDay === false || raw.can_advance_day === false ? false : !progressionBlocked;
  const hasAdaptiveAdjustment = direction !== "none" || trigger !== "none" || adjustmentsApplied.length > 0;
  const generatedAt = stringOrDefault(raw.generatedAt ?? raw.generated_at, "");
  return {
    schema: stringOrDefault(raw.schema, "agentic30.curriculum.adaptive_difficulty_state.v1"),
    direction,
    trigger,
    adjustmentsApplied,
    adjustments_applied: adjustmentsApplied,
    progressionBlocked,
    progression_blocked: progressionBlocked,
    canAdvanceDay,
    can_advance_day: canAdvanceDay,
    generatedAt,
    generated_at: generatedAt,
    hasAdaptiveAdjustment,
    has_adaptive_adjustment: hasAdaptiveAdjustment,
  };
}

function normalizeCarryOverCoaching(value) {
  const raw = objectOrEmpty(value);
  const eligibleActions = normalizeCoachingActions(raw.eligibleActions ?? raw.eligible_actions);
  const hasEligibleActions = raw.hasEligibleActions === true
    || raw.has_eligible_actions === true
    || eligibleActions.length > 0;
  const eligibleActionCount = normalizeNumber(
    raw.eligibleActionCount ?? raw.eligible_action_count,
    eligibleActions.length,
  );
  const generatedAt = stringOrDefault(raw.generatedAt ?? raw.generated_at ?? raw.detectedAt ?? raw.detected_at, "");
  return {
    schema: stringOrDefault(raw.schema, "agentic30.curriculum.carry_over_coaching.v1"),
    hasEligibleActions,
    has_eligible_actions: hasEligibleActions,
    eligibleActionCount,
    eligible_action_count: eligibleActionCount,
    eligibleActions,
    eligible_actions: eligibleActions,
    coachingMode: stringOrDefault(raw.coachingMode ?? raw.coaching_mode, hasEligibleActions ? "non_blocking_carry_over" : ""),
    coaching_mode: stringOrDefault(raw.coachingMode ?? raw.coaching_mode, hasEligibleActions ? "non_blocking_carry_over" : ""),
    generatedAt,
    generated_at: generatedAt,
  };
}

function normalizeCoachingFeedbackSurface(value) {
  const raw = objectOrEmpty(value);
  const feedbackItems = normalizeCoachingFeedbackItems(
    raw.feedbackItems
      ?? raw.feedback_items
      ?? raw.items
      ?? raw.messages,
  );
  const feedbackCount = normalizeNumber(raw.feedbackCount ?? raw.feedback_count, feedbackItems.length);
  const progressionBlocked = raw.progressionBlocked === true || raw.progression_blocked === true || raw.blocking === true;
  return {
    schema: stringOrDefault(raw.schema, "agentic30.curriculum.coaching_feedback_surface.v1"),
    currentDay: normalizeDayNumber(raw.currentDay ?? raw.current_day),
    current_day: normalizeDayNumber(raw.currentDay ?? raw.current_day),
    feedbackItems,
    feedback_items: feedbackItems,
    feedbackCount,
    feedback_count: feedbackCount,
    progressionBlocked,
    progression_blocked: progressionBlocked,
  };
}

function normalizeAdaptiveCoachEvents(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry, index) => {
      const raw = objectOrEmpty(entry);
      const type = stringOrDefault(raw.type ?? raw.eventType ?? raw.event_type, "");
      const message = stringOrDefault(raw.message ?? raw.text ?? raw.coachingFeedback ?? raw.coaching_feedback, "");
      const day = normalizeDayNumber(raw.day ?? raw.dayId ?? raw.day_id);
      if (!type && !message) return null;
      const createdAt = stringOrDefault(raw.createdAt ?? raw.created_at ?? raw.timestamp, "");
      return {
        id: stringOrDefault(raw.id ?? raw.eventId ?? raw.event_id, `adaptive-coach-event-${index + 1}`),
        type,
        day,
        day_id: day,
        message,
        severity: stringOrDefault(raw.severity ?? raw.level, ""),
        createdAt,
        created_at: createdAt,
      };
    })
    .filter(Boolean);
}

function normalizeCoachingActions(value) {
  if (!Array.isArray(value)) return [];
  return value.map((entry, index) => {
    const raw = objectOrEmpty(entry);
    const sourceDay = normalizeDayNumber(raw.sourceDay ?? raw.source_day);
    const targetDay = normalizeDayNumber(raw.targetDay ?? raw.target_day);
    const actionId = stringOrDefault(raw.actionId ?? raw.action_id ?? raw.id, `carry-over-${index + 1}`);
    const actionDescription = stringOrDefault(raw.actionDescription ?? raw.action_description ?? raw.description, "");
    const coachingFeedback = stringOrDefault(raw.coachingFeedback ?? raw.coaching_feedback, "");
    const carryOverStatus = stringOrDefault(raw.carryOverStatus ?? raw.carry_over_status, "");
    const timesCarried = normalizeNumber(raw.timesCarried ?? raw.times_carried, 0);
    return {
      actionId,
      action_id: actionId,
      sourceDay,
      source_day: sourceDay,
      targetDay,
      target_day: targetDay,
      actionDescription,
      action_description: actionDescription,
      coachingFeedback,
      coaching_feedback: coachingFeedback,
      status: stringOrDefault(raw.status, ""),
      carryOverStatus,
      carry_over_status: carryOverStatus,
      timesCarried,
      times_carried: timesCarried,
    };
  });
}

function normalizeCoachingFeedbackItems(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry, index) => {
      if (typeof entry === "string") {
        const message = entry.trim();
        return message ? { id: `feedback-${index + 1}`, message } : null;
      }
      const raw = objectOrEmpty(entry);
      const message = stringOrDefault(raw.message ?? raw.text ?? raw.coachingFeedback ?? raw.coaching_feedback, "");
      return message ? {
        id: stringOrDefault(raw.id, `feedback-${index + 1}`),
        message,
        tone: stringOrDefault(raw.tone, ""),
      } : null;
    })
    .filter(Boolean);
}

function normalizeCoachingSourceStatuses({
  hasProgress,
  adaptiveDifficultyState,
  carryOverCoaching,
  coachingFeedbackSurface,
  adaptiveCoachEvents,
}) {
  const hasAdaptive = adaptiveDifficultyState.hasAdaptiveAdjustment;
  const hasCarryOver = carryOverCoaching.hasEligibleActions || carryOverCoaching.eligibleActionCount > 0;
  const hasFeedback = coachingFeedbackSurface.feedbackItems.length > 0 || coachingFeedbackSurface.feedbackCount > 0;
  return [
    {
      type: "progressState",
      source_type: "progressState",
      label: "Progress state coaching basis",
      available: hasProgress,
      status: hasProgress ? "available" : "missing",
      detail: hasProgress ? "progress state available for coaching scan" : "progress state missing",
    },
    {
      type: "adaptiveDifficultyState",
      source_type: "adaptiveDifficultyState",
      label: "Adaptive difficulty state",
      available: hasAdaptive,
      status: hasAdaptive ? "available" : "missing",
      detail: hasAdaptive
        ? `${adaptiveDifficultyState.direction}/${adaptiveDifficultyState.trigger}`
        : "no adaptive adjustment recorded",
    },
    {
      type: "carryOverCoaching",
      source_type: "carryOverCoaching",
      label: "Carry-over coaching",
      available: hasCarryOver,
      status: hasCarryOver ? "available" : "missing",
      detail: `${carryOverCoaching.eligibleActionCount} eligible actions`,
    },
    {
      type: "coachingFeedbackSurface",
      source_type: "coachingFeedbackSurface",
      label: "Coaching feedback surface",
      available: hasFeedback,
      status: hasFeedback ? "available" : "missing",
      detail: `${coachingFeedbackSurface.feedbackCount} feedback items`,
    },
    {
      type: "adaptiveCoachEvents",
      source_type: "adaptiveCoachEvents",
      label: "Adaptive coach events",
      available: adaptiveCoachEvents.length > 0,
      status: adaptiveCoachEvents.length > 0 ? "available" : "missing",
      detail: `${adaptiveCoachEvents.length} events`,
    },
  ];
}

function buildCoachingDashboardMetrics({
  adaptiveDifficultyState,
  carryOverCoaching,
  adaptiveCoachEvents,
  availableSourceCount,
  sourceStatuses,
}) {
  const direction = adaptiveDifficultyState.direction;
  const trigger = adaptiveDifficultyState.trigger;
  return [
    {
      label: "Adaptive coaching",
      value: adaptiveDifficultyState.hasAdaptiveAdjustment ? `${direction}/${trigger}` : "none",
      trend: direction === "up" ? "difficulty-up" : direction === "down" ? "difficulty-down" : "steady",
      intent: "Review Day가 난이도 조정 신호를 대시보드에 반영",
      status: adaptiveDifficultyState.progressionBlocked ? "watch" : "healthy",
    },
    {
      label: "Carry-over coaching",
      value: String(carryOverCoaching.eligibleActionCount),
      trend: carryOverCoaching.eligibleActionCount > 0 ? "non-blocking" : "clear",
      intent: "미완료 실행을 막지 않고 다시 다룰 coaching 후보",
      status: carryOverCoaching.eligibleActionCount > 0 ? "watch" : "healthy",
    },
    {
      label: "Adaptive coach events",
      value: String(adaptiveCoachEvents.length),
      trend: adaptiveCoachEvents.length > 0 ? "recorded" : "none",
      intent: "Review 기간에 수집된 adaptive-coach interaction/event 수",
      status: "healthy",
    },
    {
      label: "Coaching sources",
      value: `${availableSourceCount}/${sourceStatuses.length}`,
      trend: availableSourceCount === sourceStatuses.length ? "complete" : "partial",
      intent: "Review dashboard에 반영 가능한 coaching source coverage",
      status: availableSourceCount > 0 ? "healthy" : "watch",
    },
  ];
}

function buildCoachingDashboardInsights({
  adaptiveDifficultyState,
  carryOverCoaching,
  adaptiveCoachEvents,
  missingSources,
}) {
  const insights = [];
  if (adaptiveDifficultyState.hasAdaptiveAdjustment) {
    insights.push(
      `Adaptive coach는 ${adaptiveDifficultyState.trigger} 신호로 난이도를 ${adaptiveDifficultyState.direction} 방향으로 조정했습니다.`,
    );
  }
  if (carryOverCoaching.eligibleActionCount > 0) {
    insights.push(`Carry-over coaching 후보 ${carryOverCoaching.eligibleActionCount}개를 Review metric에 반영했습니다.`);
  }
  if (adaptiveCoachEvents.length > 0) {
    insights.push(`Adaptive-coach event ${adaptiveCoachEvents.length}개를 Review dashboard signal로 정규화했습니다.`);
  }
  if (missingSources.includes("progressState")) {
    insights.push("Coaching source가 없어도 Review 진행은 막지 않고 missing-source로만 표시합니다.");
  }
  return insights;
}

function buildCoachingDashboardActionItems({
  adaptiveDifficultyState,
  carryOverCoaching,
  missingSources,
}) {
  const items = [];
  if (adaptiveDifficultyState.direction === "down") {
    items.push("다음 Day는 범위를 줄이고 template 기반 mini-action으로 시작해보세요.");
  } else if (adaptiveDifficultyState.direction === "up") {
    items.push("빠르게 넘긴 구간은 prior action 증거 하나를 먼저 보강해보세요.");
  }
  if (carryOverCoaching.eligibleActionCount > 0) {
    items.push("Carry-over coaching은 진행을 막지 않고 다음 질문 앞에서 짧게 다시 꺼내보세요.");
  }
  if (missingSources.includes("progressState")) {
    items.push("Coaching state가 없으면 오늘 답변부터 저장해 다음 Review signal을 쌓아보세요.");
  }
  return items;
}

function normalizeCoachingDashboardList(value) {
  if (!Array.isArray(value)) return [];
  return value.map(normalizeMetric).filter((metric) => metric.label || metric.value);
}

function normalizeMetric(value) {
  const raw = objectOrEmpty(value);
  return {
    label: stringOrDefault(raw.label ?? raw.name, ""),
    value: stringOrDefault(raw.value ?? raw.count ?? raw.text, ""),
    trend: stringOrDefault(raw.trend ?? raw.delta, ""),
    intent: stringOrDefault(raw.intent ?? raw.description ?? raw.helperText, ""),
    status: stringOrDefault(raw.status ?? raw.state, ""),
  };
}

function normalizeDayRange(value) {
  const raw = objectOrEmpty(value);
  const start = normalizeDayNumber(raw.start ?? raw.from);
  const end = normalizeDayNumber(raw.end ?? raw.to);
  return start && end ? { start, end } : null;
}

function normalizeDayNumber(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.min(30, Math.max(1, Math.trunc(n)));
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => String(entry ?? "").trim()).filter(Boolean);
}

function normalizeNumber(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.trunc(n));
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
