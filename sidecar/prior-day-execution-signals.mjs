export const PRIOR_DAY_EXECUTION_SIGNAL_SCHEMA_VERSION = 1;

const KNOWN_DAY_TYPES = new Set(["interview", "action", "review", "education"]);
const PASSED_STATUSES = new Set(["accepted", "passed", "pass", "valid", "validated", "verified", "success", "succeeded", "ok", "completed", "complete"]);
const FAILED_STATUSES = new Set(["failed", "fail", "insufficient", "invalid", "rejected", "error"]);
const PENDING_STATUSES = new Set(["pending", "running", "queued", "not_started", "not-started", "incomplete"]);

export function normalizePriorDayExecutionSignals(input = {}, {
  currentDay = null,
  eligibleDayRange = null,
  now = new Date(),
} = {}) {
  const source = Array.isArray(input) ? { dayOutcomes: input } : objectOrEmpty(input);
  const generatedAt = toIso(now);
  const targetDay = normalizeOptionalDayNumber(
    currentDay ?? source.currentDay ?? source.current_day ?? source.day ?? source.day_id,
  );
  const selectedDayRange = normalizeEligibleDayRange(
    eligibleDayRange
      ?? source.eligibleDayRange
      ?? source.eligible_day_range
      ?? source.resolvedEligibleDayRange
      ?? source.resolved_eligible_day_range
      ?? source.reviewDayEligibleRange
      ?? source.review_day_eligible_range
      ?? source.dayRange
      ?? source.day_range,
  );
  const rawOutcomes = collectRawDayOutcomes(source)
    .map((outcome) => normalizePriorDayOutcome(outcome, { generatedAt, eligibleDayRange: selectedDayRange }))
    .filter((outcome) => outcome.day_id !== null)
    .filter((outcome) => selectedDayRange
      ? isDayWithinRange(outcome.day_id, selectedDayRange)
      : !targetDay || outcome.day_id < targetDay)
    .sort((a, b) => a.day_id - b.day_id);

  const completedOutcomes = rawOutcomes.filter((outcome) => outcome.completion_confirmed);
  const completionTimes = completedOutcomes
    .map((outcome) => parseTimestamp(outcome.completed_at))
    .filter(Boolean)
    .sort((a, b) => a.getTime() - b.getTime());
  const startTimes = rawOutcomes
    .flatMap((outcome) => [outcome.started_at, outcome.completed_at])
    .map(parseTimestamp)
    .filter(Boolean)
    .sort((a, b) => a.getTime() - b.getTime());
  const firstStartedAt = startTimes[0] ?? completionTimes[0] ?? null;
  const lastCompletedAt = completionTimes.at(-1) ?? null;
  const elapsedRealDays = firstStartedAt && lastCompletedAt
    ? roundNumber(Math.max(0, lastCompletedAt.getTime() - firstStartedAt.getTime()) / 86_400_000, 3)
    : null;
  const elapsedDaysForRate = elapsedRealDays === null ? null : Math.max(elapsedRealDays, 1 / 24);
  const completedDaysPerElapsedDay = elapsedDaysForRate === null
    ? null
    : roundNumber(completedOutcomes.length / elapsedDaysForRate, 3);

  const actionCount = rawOutcomes.reduce((sum, outcome) => sum + outcome.action_count, 0);
  const verifiedActionCount = rawOutcomes.reduce((sum, outcome) => sum + outcome.verified_action_count, 0);
  const incompleteActionCount = rawOutcomes.reduce((sum, outcome) => sum + outcome.incomplete_action_count, 0);
  const rushingCandidate = completedOutcomes.length >= 2
    && elapsedDaysForRate !== null
    && completedOutcomes.length > Math.max(1, elapsedDaysForRate + 1);
  const riskFactors = [
    rushingCandidate ? "fast_multi_day_completion" : "",
    completedOutcomes.length >= 2 && actionCount > 0 && verifiedActionCount === 0 ? "answered_without_verified_actions" : "",
    incompleteActionCount >= 2 ? "accumulated_incomplete_actions" : "",
  ].filter(Boolean);

  const aggregate = {
    completed_day_count: completedOutcomes.length,
    completedDayCount: completedOutcomes.length,
    latest_completed_day: completedOutcomes.at(-1)?.day_id ?? null,
    latestCompletedDay: completedOutcomes.at(-1)?.day_id ?? null,
    first_started_at: firstStartedAt ? toIso(firstStartedAt) : null,
    firstStartedAt: firstStartedAt ? toIso(firstStartedAt) : null,
    last_completed_at: lastCompletedAt ? toIso(lastCompletedAt) : null,
    lastCompletedAt: lastCompletedAt ? toIso(lastCompletedAt) : null,
    elapsed_real_days: elapsedRealDays,
    elapsedRealDays,
    completed_days_per_elapsed_day: completedDaysPerElapsedDay,
    completedDaysPerElapsedDay,
    action_count: actionCount,
    actionCount,
    verified_action_count: verifiedActionCount,
    verifiedActionCount,
    incomplete_action_count: incompleteActionCount,
    incompleteActionCount,
    action_completion_rate: actionCount > 0 ? roundNumber(verifiedActionCount / actionCount, 3) : null,
    actionCompletionRate: actionCount > 0 ? roundNumber(verifiedActionCount / actionCount, 3) : null,
  };

  const rushingDetectionInput = {
    schema: "agentic30.curriculum.rushing_detection_input.v1",
    current_day: targetDay,
    currentDay: targetDay,
    completed_day_count: aggregate.completed_day_count,
    completedDayCount: aggregate.completed_day_count,
    latest_completed_day: aggregate.latest_completed_day,
    latestCompletedDay: aggregate.latest_completed_day,
    pace_metrics: {
      start_timestamp: aggregate.first_started_at,
      startTimestamp: aggregate.first_started_at,
      end_timestamp: aggregate.last_completed_at,
      endTimestamp: aggregate.last_completed_at,
      days_elapsed: aggregate.elapsed_real_days,
      daysElapsed: aggregate.elapsed_real_days,
      completed_days_per_elapsed_day: aggregate.completed_days_per_elapsed_day,
      completedDaysPerElapsedDay: aggregate.completed_days_per_elapsed_day,
    },
    action_execution: {
      action_count: aggregate.action_count,
      actionCount: aggregate.action_count,
      verified_action_count: aggregate.verified_action_count,
      verifiedActionCount: aggregate.verified_action_count,
      incomplete_action_count: aggregate.incomplete_action_count,
      incompleteActionCount: aggregate.incomplete_action_count,
      action_completion_rate: aggregate.action_completion_rate,
      actionCompletionRate: aggregate.action_completion_rate,
    },
    rushing_candidate: rushingCandidate,
    rushingCandidate,
    risk_factors: riskFactors,
    riskFactors,
  };

  return {
    schemaVersion: PRIOR_DAY_EXECUTION_SIGNAL_SCHEMA_VERSION,
    schema_version: PRIOR_DAY_EXECUTION_SIGNAL_SCHEMA_VERSION,
    schema: "agentic30.curriculum.prior_day_execution_signals.v1",
    generatedAt,
    generated_at: generatedAt,
    currentDay: targetDay,
    current_day: targetDay,
    eligibleDayRange: selectedDayRange,
    eligible_day_range: selectedDayRange,
    days: rawOutcomes,
    day_outcomes: rawOutcomes,
    aggregate,
    rushingDetectionInput,
    rushing_detection_input: rushingDetectionInput,
  };
}

export function normalizePriorDayOutcome(rawOutcome = {}, {
  generatedAt = toIso(new Date()),
  eligibleDayRange = null,
} = {}) {
  const raw = objectOrEmpty(rawOutcome);
  const dayId = normalizeOptionalDayNumber(raw.day ?? raw.dayId ?? raw.day_id ?? raw.id);
  const dayType = normalizeDayType(raw.dayType ?? raw.day_type ?? raw.type);
  const lifecycle = normalizeLifecycleSignals(raw.lifecycleEvents ?? raw.lifecycle_events);
  const startedAt = firstIso(
    raw.startedAt,
    raw.started_at,
    raw.startTimestamp,
    raw.start_timestamp,
    lifecycle.startedAt,
  );
  const completedAt = firstIso(
    raw.completedAt,
    raw.completed_at,
    raw.completionConfirmedAt,
    raw.completion_confirmed_at,
    raw.finishedAt,
    raw.finished_at,
    lifecycle.completedAt,
  );
  const selectedDayRange = normalizeEligibleDayRange(eligibleDayRange);
  const actions = collectActionEntries(raw)
    .filter((action) => isActionEntryWithinEligibleDayRange(action, selectedDayRange, dayId))
    .map((action) => normalizeActionExecutionSignal(action, { parentDayId: dayId }))
    .filter(Boolean);
  const questionSignals = normalizeQuestionSignals(raw);
  const completionConfirmed = Boolean(
    raw.completionConfirmed
      ?? raw.completion_confirmed
      ?? raw.dayCompleted
      ?? raw.day_completed
      ?? raw.completed
      ?? false,
  );
  const verifiedActionCount = actions.filter((action) => action.verified).length;
  const incompleteActionCount = actions.filter((action) => !action.verified).length;
  const elapsedMinutes = startedAt && completedAt
    ? roundNumber(Math.max(0, parseTimestamp(completedAt).getTime() - parseTimestamp(startedAt).getTime()) / 60_000, 2)
    : null;

  return {
    schema: "agentic30.curriculum.prior_day_execution_signal.v1",
    normalized_at: generatedAt,
    normalizedAt: generatedAt,
    day_id: dayId,
    dayId,
    day_type: dayType,
    dayType,
    started_at: startedAt,
    startedAt,
    completed_at: completedAt,
    completedAt,
    elapsed_minutes: elapsedMinutes,
    elapsedMinutes,
    completion_confirmed: completionConfirmed,
    completionConfirmed,
    completion_driver: stringOrDefault(raw.completionDriver ?? raw.completion_driver, ""),
    completionDriver: stringOrDefault(raw.completionDriver ?? raw.completion_driver, ""),
    question_count: questionSignals.questionCount,
    questionCount: questionSignals.questionCount,
    answered_question_count: questionSignals.answeredQuestionCount,
    answeredQuestionCount: questionSignals.answeredQuestionCount,
    all_questions_answered: questionSignals.allQuestionsAnswered,
    allQuestionsAnswered: questionSignals.allQuestionsAnswered,
    action_count: actions.length,
    actionCount: actions.length,
    verified_action_count: verifiedActionCount,
    verifiedActionCount,
    incomplete_action_count: incompleteActionCount,
    incompleteActionCount,
    action_completion_ratio: actions.length ? roundNumber(verifiedActionCount / actions.length, 3) : null,
    actionCompletionRatio: actions.length ? roundNumber(verifiedActionCount / actions.length, 3) : null,
    execution_state: completionConfirmed ? "completed" : "incomplete",
    quality_signal: qualitySignalFor({ dayType, actions, completionConfirmed, questionSignals }),
    actions,
    action_signals: actions,
  };
}

function collectRawDayOutcomes(source) {
  for (const key of ["dayOutcomes", "day_outcomes", "dayRecords", "day_records", "days", "completedDays", "completed_days"]) {
    if (Array.isArray(source[key])) return source[key].filter(Boolean);
  }
  const progress = objectOrEmpty(source.progressState ?? source.progress_state ?? source.curriculumProgress ?? source.curriculum_progress);
  for (const key of ["dayRecords", "day_records", "days"]) {
    if (Array.isArray(progress[key])) return progress[key].filter(Boolean);
  }
  return [];
}

function collectActionEntries(raw) {
  const entries = [];
  for (const key of [
    "actions",
    "actionItems",
    "action_items",
    "dayActions",
    "day_actions",
    "actionSpecs",
    "action_specs",
    "incompleteActions",
    "incomplete_actions",
    "carryOverQueue",
    "carry_over_queue",
  ]) {
    if (Array.isArray(raw[key])) entries.push(...raw[key].filter(Boolean));
  }
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
  return entries;
}

function normalizeActionExecutionSignal(rawAction = {}, { parentDayId = null } = {}) {
  const raw = objectOrEmpty(rawAction);
  if (!Object.keys(raw).length) return null;
  const actionDay = normalizeOptionalDayNumber(
    raw.day
      ?? raw.dayId
      ?? raw.day_id
      ?? raw.sourceDay
      ?? raw.source_day
      ?? raw.curriculumDay
      ?? raw.curriculum_day
      ?? parentDayId,
  );
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
  const evidenceStatus = normalizeStatus(evidenceSubmission.validationStatus ?? evidenceSubmission.validation_status);
  const status = normalizeStatus(
    verificationResult.status
      ?? verificationResult.outcome
      ?? verificationState.status
      ?? evidenceStatus
      ?? raw.status
      ?? raw.actionStatus
      ?? raw.action_status,
  );
  const passed = typeof verificationResult.passed === "boolean"
    ? verificationResult.passed
    : typeof verificationState.passed === "boolean"
      ? verificationState.passed
      : typeof raw.verified === "boolean"
        ? raw.verified
        : raw.completed === true || raw.completionConfirmed === true || PASSED_STATUSES.has(status);
  const actionId = stringOrDefault(raw.id ?? raw.actionId ?? raw.action_id, "");
  const description = stringOrDefault(raw.actionDescription ?? raw.action_description ?? raw.description ?? raw.task, "");
  const completionSignal = stringOrDefault(raw.completionSignal ?? raw.completion_signal ?? raw.completion, "");

  return {
    day_id: actionDay,
    dayId: actionDay,
    action_id: actionId,
    actionId,
    action_description: description,
    actionDescription: description,
    completion_signal: completionSignal,
    completionSignal,
    status: status || (passed ? "verified" : "pending"),
    verified: passed === true,
    verification_result: {
      method: stringOrDefault(verificationResult.method ?? verificationState.method ?? raw.verificationMethod ?? raw.verification_method, ""),
      passed: passed === true,
      outcome: stringOrDefault(verificationResult.outcome ?? verificationResult.status ?? verificationState.status ?? raw.status, ""),
      reason: stringOrDefault(verificationResult.reason ?? verificationState.reason ?? raw.reason, ""),
    },
    verificationResult: {
      method: stringOrDefault(verificationResult.method ?? verificationState.method ?? raw.verificationMethod ?? raw.verification_method, ""),
      passed: passed === true,
      outcome: stringOrDefault(verificationResult.outcome ?? verificationResult.status ?? verificationState.status ?? raw.status, ""),
      reason: stringOrDefault(verificationResult.reason ?? verificationState.reason ?? raw.reason, ""),
    },
    evidence_submission: Object.keys(evidenceSubmission).length ? {
      type: stringOrDefault(evidenceSubmission.type ?? evidenceSubmission.evidenceType ?? evidenceSubmission.evidence_type, ""),
      content: stringOrDefault(evidenceSubmission.content ?? evidenceSubmission.value ?? evidenceSubmission.url ?? evidenceSubmission.path, ""),
      validation_status: stringOrDefault(evidenceSubmission.validationStatus ?? evidenceSubmission.validation_status, ""),
    } : null,
    evidenceSubmission: Object.keys(evidenceSubmission).length ? {
      type: stringOrDefault(evidenceSubmission.type ?? evidenceSubmission.evidenceType ?? evidenceSubmission.evidence_type, ""),
      content: stringOrDefault(evidenceSubmission.content ?? evidenceSubmission.value ?? evidenceSubmission.url ?? evidenceSubmission.path, ""),
      validationStatus: stringOrDefault(evidenceSubmission.validationStatus ?? evidenceSubmission.validation_status, ""),
    } : null,
  };
}

function normalizeEligibleDayRange(value) {
  const raw = objectOrEmpty(value);
  const start = normalizeOptionalDayNumber(raw.start ?? raw.startDay ?? raw.start_day ?? raw.from ?? raw.fromDay ?? raw.from_day);
  const end = normalizeOptionalDayNumber(raw.end ?? raw.endDay ?? raw.end_day ?? raw.to ?? raw.toDay ?? raw.to_day);
  if (!start || !end) return null;
  return {
    start: Math.min(start, end),
    end: Math.max(start, end),
  };
}

function isDayWithinRange(day, range) {
  const normalizedDay = normalizeOptionalDayNumber(day);
  if (!normalizedDay || !range) return false;
  return normalizedDay >= range.start && normalizedDay <= range.end;
}

function isActionEntryWithinEligibleDayRange(action, range, parentDayId) {
  if (!range) return true;
  const raw = objectOrEmpty(action);
  const actionDay = normalizeOptionalDayNumber(
    raw.day
      ?? raw.dayId
      ?? raw.day_id
      ?? raw.sourceDay
      ?? raw.source_day
      ?? raw.curriculumDay
      ?? raw.curriculum_day
      ?? parentDayId,
  );
  return isDayWithinRange(actionDay, range);
}

function normalizeLifecycleSignals(value) {
  if (!Array.isArray(value)) {
    return { startedAt: null, completedAt: null };
  }
  const events = value
    .map((event) => {
      const raw = objectOrEmpty(event);
      const occurredAt = firstIso(raw.occurredAt, raw.occurred_at, raw.timestamp, raw.createdAt, raw.created_at);
      if (!occurredAt) return null;
      return {
        type: normalizeStatus(raw.type ?? raw.event ?? raw.name),
        occurredAt,
        completionDriver: raw.completionDriver === true || raw.completion_driver === true,
      };
    })
    .filter(Boolean)
    .sort((a, b) => parseTimestamp(a.occurredAt).getTime() - parseTimestamp(b.occurredAt).getTime());
  return {
    startedAt: events[0]?.occurredAt ?? null,
    completedAt: events.find((event) => (
      event.completionDriver
      || event.type === "day_completion_confirmed"
      || event.type === "completion_confirmed"
    ))?.occurredAt ?? null,
  };
}

function normalizeQuestionSignals(raw) {
  const questions = firstArray(raw.questions, raw.questionProgress, raw.question_progress, raw.answers, raw.answerRecords, raw.answer_records);
  const explicitCount = normalizeOptionalNumber(raw.questionCount ?? raw.question_count ?? raw.totalQuestions ?? raw.total_questions);
  const explicitAnswered = normalizeOptionalNumber(raw.answeredQuestionCount ?? raw.answered_question_count ?? raw.answersCount ?? raw.answers_count);
  const answeredFromRows = questions.filter((question) => {
    const item = objectOrEmpty(question);
    return item.completed === true
      || item.answered === true
      || hasText(item.answer)
      || hasText(item.response)
      || hasText(item.value);
  }).length;
  const questionCount = explicitCount ?? questions.length;
  const answeredQuestionCount = explicitAnswered ?? answeredFromRows;
  return {
    questionCount,
    answeredQuestionCount,
    allQuestionsAnswered: questionCount > 0 && answeredQuestionCount >= questionCount,
  };
}

function qualitySignalFor({ dayType, actions, completionConfirmed, questionSignals }) {
  if (actions.length > 0 && actions.every((action) => action.verified)) return "verified_action_execution";
  if (actions.length > 0 && actions.some((action) => !action.verified)) return "incomplete_action_execution";
  if (dayType !== "action" && questionSignals.allQuestionsAnswered) return "answered_curriculum_questions";
  if (completionConfirmed) return "completion_confirmed_without_execution_detail";
  return "insufficient_execution_signal";
}

function normalizeStatus(value) {
  const normalized = String(value ?? "").trim().toLowerCase().replace(/\s+/g, "_");
  if (PASSED_STATUSES.has(normalized)) return "verified";
  if (FAILED_STATUSES.has(normalized)) return "failed";
  if (PENDING_STATUSES.has(normalized)) return "pending";
  return normalized;
}

function normalizeDayType(value) {
  const normalized = String(value ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  return KNOWN_DAY_TYPES.has(normalized) ? normalized : "unknown";
}

function firstArray(...values) {
  return values.find((value) => Array.isArray(value)) ?? [];
}

function firstIso(...values) {
  for (const value of values) {
    const parsed = parseTimestamp(value);
    if (parsed) return toIso(parsed);
  }
  return null;
}

function parseTimestamp(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeOptionalDayNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  const integer = Math.trunc(number);
  return integer > 0 ? integer : null;
}

function normalizeOptionalNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function objectOrEmpty(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function stringOrDefault(value, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function hasText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function roundNumber(value, digits = 3) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function toIso(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
