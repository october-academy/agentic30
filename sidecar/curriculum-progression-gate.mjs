export const CURRICULUM_PROGRESSION_GATE_SCHEMA_VERSION = 1;
export const CURRICULUM_BLOCKED_STATE_METADATA_SCHEMA_VERSION = 1;

const ALLOWED_STATUS = "allowed";
const BLOCKED_STATUS = "blocked";
const PASSED_STATUSES = new Set([
  "accepted",
  "complete",
  "completed",
  "ok",
  "pass",
  "passed",
  "success",
  "succeeded",
  "valid",
  "validated",
  "verified",
]);
const FAILED_STATUSES = new Set([
  "failed",
  "fail",
  "insufficient",
  "invalid",
  "rejected",
  "error",
]);
const BLOCKING_REQUIREMENT_MODES = new Set([
  "blocking",
  "blocking_prerequisite",
  "hard_prerequisite",
  "required_prerequisite",
]);
const BLOCKING_REQUIRED_BEFORE = new Set([
  "day_unlock",
  "day_start",
  "next_day_unlock",
  "progression",
  "progression_gate",
]);

export function evaluateCurriculumProgressionGate({
  currentDay = null,
  prerequisiteRequirements = null,
  progressState = {},
  dayRecords = null,
  verificationStates = null,
  now = new Date(),
} = {}) {
  const generatedAt = toIso(now);
  const targetDay = normalizeOptionalDayNumber(
    currentDay
      ?? prerequisiteRequirements?.currentDay
      ?? prerequisiteRequirements?.current_day,
  );
  const requirements = extractPrerequisiteRequirements(prerequisiteRequirements)
    .map((requirement, index) => normalizeGateRequirement(requirement, {
      index,
      currentDay: targetDay,
    }))
    .filter(Boolean);
  const actionSignals = collectGateActionSignals({ progressState, dayRecords, verificationStates });
  const requirementEvaluations = requirements.map((requirement) =>
    evaluateGateRequirement(requirement, actionSignals),
  );
  const blockingFailures = requirementEvaluations.filter((evaluation) =>
    evaluation.blocking === true && evaluation.satisfied === false,
  );
  const status = blockingFailures.length ? BLOCKED_STATUS : ALLOWED_STATUS;
  const blockedStateMetadata = buildBlockedStateMetadata({
    currentDay: targetDay,
    status,
    blockingFailures,
    generatedAt,
  });

  return {
    schemaVersion: CURRICULUM_PROGRESSION_GATE_SCHEMA_VERSION,
    schema_version: CURRICULUM_PROGRESSION_GATE_SCHEMA_VERSION,
    schema: "agentic30.curriculum.progression_gate.v1",
    generatedAt,
    generated_at: generatedAt,
    currentDay: targetDay,
    current_day: targetDay,
    status,
    gateStatus: status,
    gate_status: status,
    allowed: status === ALLOWED_STATUS,
    blocked: status === BLOCKED_STATUS,
    progressionBlocked: status === BLOCKED_STATUS,
    progression_blocked: status === BLOCKED_STATUS,
    canAdvanceDay: status === ALLOWED_STATUS,
    can_advance_day: status === ALLOWED_STATUS,
    hasRequirements: requirements.length > 0,
    has_requirements: requirements.length > 0,
    requirementCount: requirements.length,
    requirement_count: requirements.length,
    satisfiedRequirementCount: requirementEvaluations.filter((evaluation) => evaluation.satisfied).length,
    satisfied_requirement_count: requirementEvaluations.filter((evaluation) => evaluation.satisfied).length,
    unmetRequirementCount: requirementEvaluations.filter((evaluation) => !evaluation.satisfied).length,
    unmet_requirement_count: requirementEvaluations.filter((evaluation) => !evaluation.satisfied).length,
    blockingFailureCount: blockingFailures.length,
    blocking_failure_count: blockingFailures.length,
    blockingRequirementIds: blockingFailures.map((evaluation) => evaluation.requirement_id),
    blocking_requirement_ids: blockingFailures.map((evaluation) => evaluation.requirement_id),
    blockedStateMetadata,
    blocked_state_metadata: blockedStateMetadata,
    unmetPrerequisiteActions: blockedStateMetadata.unmetPrerequisiteActions,
    unmet_prerequisite_actions: blockedStateMetadata.unmet_prerequisite_actions,
    requirementEvaluations,
    requirement_evaluations: requirementEvaluations,
    actionSignals,
    action_signals: actionSignals,
  };
}

function buildBlockedStateMetadata({
  currentDay = null,
  status = ALLOWED_STATUS,
  blockingFailures = [],
  generatedAt = "",
} = {}) {
  const unmetActions = blockingFailures
    .map((evaluation, index) => normalizeUnmetPrerequisiteAction(evaluation, index))
    .filter(Boolean);
  const blocked = status === BLOCKED_STATUS;

  return {
    schemaVersion: CURRICULUM_BLOCKED_STATE_METADATA_SCHEMA_VERSION,
    schema_version: CURRICULUM_BLOCKED_STATE_METADATA_SCHEMA_VERSION,
    schema: "agentic30.curriculum.blocked_state_metadata.v1",
    generatedAt,
    generated_at: generatedAt,
    currentDay,
    current_day: currentDay,
    status: blocked ? BLOCKED_STATUS : "clear",
    blocked,
    progressionBlocked: blocked,
    progression_blocked: blocked,
    canAdvanceDay: !blocked,
    can_advance_day: !blocked,
    mutatesProgressionState: false,
    mutates_progression_state: false,
    progressionStateMutationRequired: false,
    progression_state_mutation_required: false,
    displayMode: blocked ? "user_facing_unmet_prerequisite_actions" : "none",
    display_mode: blocked ? "user_facing_unmet_prerequisite_actions" : "none",
    title: blocked ? "먼저 확인할 액션이 있어요" : "",
    message: blocked
      ? "아래 이전 액션의 완료 신호를 확인한 뒤 다시 이어가 보세요."
      : "",
    unmetPrerequisiteCount: unmetActions.length,
    unmet_prerequisite_count: unmetActions.length,
    unmetPrerequisiteActions: unmetActions,
    unmet_prerequisite_actions: unmetActions,
  };
}

function normalizeUnmetPrerequisiteAction(evaluation = {}, index = 0) {
  const requirementId = stringOrDefault(
    evaluation.requirementId ?? evaluation.requirement_id,
    `unmet-prerequisite-${index + 1}`,
  );
  const sourceActionId = stringOrDefault(
    evaluation.sourceActionId
      ?? evaluation.source_action_id
      ?? evaluation.actionId
      ?? evaluation.action_id,
    requirementId,
  );
  const matchedSignal = objectOrEmpty(
    evaluation.matchedActionSignals?.[0]
      ?? evaluation.matched_action_signals?.[0],
  );
  const actionDescription = stringOrDefault(
    evaluation.actionDescription
      ?? evaluation.action_description
      ?? matchedSignal.actionDescription
      ?? matchedSignal.action_description
      ?? evaluation.task
      ?? evaluation.description,
    "이전 Day 액션의 완료 증거를 확인해 주세요.",
  );
  const completionSignal = stringOrDefault(
    evaluation.completionSignal
      ?? evaluation.completion_signal
      ?? matchedSignal.completionSignal
      ?? matchedSignal.completion_signal
      ?? evaluation.signal,
    "자동 확인 또는 제출한 증거가 완료로 판정되어야 합니다.",
  );
  const verificationResult = objectOrEmpty(
    evaluation.verificationResult
      ?? evaluation.verification_result
      ?? matchedSignal.verificationResult
      ?? matchedSignal.verification_result,
  );
  const latestStatus = stringOrDefault(
    verificationResult.status
      ?? verificationResult.outcome
      ?? matchedSignal.status
      ?? evaluation.status,
    "unmet",
  );

  return {
    requirementId,
    requirement_id: requirementId,
    sourceDay: normalizeOptionalDayNumber(evaluation.sourceDay ?? evaluation.source_day),
    source_day: normalizeOptionalDayNumber(evaluation.sourceDay ?? evaluation.source_day),
    sourceActionId,
    source_action_id: sourceActionId,
    actionId: sourceActionId,
    action_id: sourceActionId,
    actionDescription,
    action_description: actionDescription,
    completionSignal,
    completion_signal: completionSignal,
    verificationMethod: stringOrDefault(
      evaluation.verificationMethod
        ?? evaluation.verification_method
        ?? evaluation.configuredVerifier
        ?? evaluation.configured_verifier,
      "",
    ),
    verification_method: stringOrDefault(
      evaluation.verificationMethod
        ?? evaluation.verification_method
        ?? evaluation.configuredVerifier
        ?? evaluation.configured_verifier,
      "",
    ),
    evidenceType: stringOrDefault(evaluation.evidenceType ?? evaluation.evidence_type, ""),
    evidence_type: stringOrDefault(evaluation.evidenceType ?? evaluation.evidence_type, ""),
    latestStatus,
    latest_status: latestStatus,
    latestVerificationPassed: verificationResult.passed === true,
    latest_verification_passed: verificationResult.passed === true,
    reason: stringOrDefault(evaluation.reason, "blocking_prerequisite_action_incomplete_or_unverified"),
    userFacing: true,
    user_facing: true,
  };
}

function evaluateGateRequirement(requirement = {}, actionSignals = []) {
  const matchingSignals = actionSignals.filter((signal) => matchesGateRequirement(requirement, signal));
  const directSignal = normalizeCompletionSignal({
    status: requirement.status,
    completed: requirement.completed,
    completionConfirmed: requirement.completionConfirmed ?? requirement.completion_confirmed,
    verified: requirement.verified,
    verificationResult: requirement.verificationResult ?? requirement.verification_result,
    verificationState: requirement.verificationState ?? requirement.verification_state,
    evidenceSubmission: requirement.evidenceSubmission ?? requirement.evidence_submission,
  });
  const matchedSignal = matchingSignals.find((signal) => signal.satisfied)
    ?? matchingSignals.find((signal) => signal.verification_result?.passed === false)
    ?? matchingSignals[0]
    ?? null;
  const directSatisfied = satisfiesConfiguredVerifier(requirement, directSignal);
  const matchedSatisfied = matchedSignal ? satisfiesConfiguredVerifier(requirement, matchedSignal) : false;
  const satisfied = directSatisfied || matchedSatisfied;
  const verificationResult = directSignal.verification_result ?? matchedSignal?.verification_result ?? null;
  const evidenceSubmission = directSignal.evidence_submission ?? matchedSignal?.evidence_submission ?? null;
  const source = directSatisfied ? "requirement" : matchedSignal ? "matched_action" : "none";
  const configuredVerifier = normalizeVerifierMethod(
    requirement.verificationMethod ?? requirement.verification_method,
  );
  const configuredVerifierSucceeded = satisfied && Boolean(configuredVerifier);

  return {
    ...requirement,
    satisfied,
    status: satisfied ? "satisfied" : "unmet",
    gateStatus: satisfied ? ALLOWED_STATUS : requirement.blocking ? BLOCKED_STATUS : ALLOWED_STATUS,
    gate_status: satisfied ? ALLOWED_STATUS : requirement.blocking ? BLOCKED_STATUS : ALLOWED_STATUS,
    blocking: requirement.blocking,
    progressionBlocked: requirement.blocking && !satisfied,
    progression_blocked: requirement.blocking && !satisfied,
    canAdvanceDay: !requirement.blocking || satisfied,
    can_advance_day: !requirement.blocking || satisfied,
    completionSource: source,
    completion_source: source,
    matchedActionCount: matchingSignals.length,
    matched_action_count: matchingSignals.length,
    matchedActionSignals: matchingSignals,
    matched_action_signals: matchingSignals,
    verificationResult,
    verification_result: verificationResult,
    evidenceSubmission,
    evidence_submission: evidenceSubmission,
    configuredVerifier: configuredVerifier || "",
    configured_verifier: configuredVerifier || "",
    configuredVerifierSucceeded,
    configured_verifier_succeeded: configuredVerifierSucceeded,
    reason: satisfied
      ? "prerequisite_action_satisfied"
      : requirement.blocking
        ? "blocking_prerequisite_action_incomplete_or_unverified"
        : "non_blocking_prerequisite_action_incomplete_or_unverified",
  };
}

function satisfiesConfiguredVerifier(requirement = {}, signal = {}) {
  if (!signal?.satisfied) return false;
  const configuredMethod = normalizeVerifierMethod(
    requirement.verificationMethod ?? requirement.verification_method,
  );
  if (!configuredMethod) return true;

  const result = objectOrEmpty(signal.verificationResult ?? signal.verification_result);
  if (result.passed !== true) return false;
  const resultMethod = normalizeVerifierMethod(result.method ?? result.verifier ?? result.type);
  if (!resultMethod) return false;
  return resultMethod === configuredMethod;
}

function collectGateActionSignals({ progressState = {}, dayRecords = null, verificationStates = null } = {}) {
  const records = [
    ...asArray(dayRecords),
    ...asArray(progressState?.dayRecords),
    ...asArray(progressState?.day_records),
    ...asArray(progressState?.days),
  ];
  const recordSignals = records.flatMap((record) => collectRecordActionSignals(record));
  const explicitSignals = collectExplicitVerificationSignals(verificationStates);
  return dedupeActionSignals([...recordSignals, ...explicitSignals]);
}

function collectRecordActionSignals(record = {}) {
  const raw = objectOrEmpty(record);
  const sourceDay = normalizeOptionalDayNumber(raw.day ?? raw.dayId ?? raw.day_id);
  const entries = [];
  for (const key of [
    "actions",
    "actionProgress",
    "action_progress",
    "actionSpecs",
    "action_specs",
    "verificationStates",
    "verification_states",
    "actionVerifications",
    "action_verifications",
  ]) {
    entries.push(...asArray(raw[key]));
  }
  const actionSpec = raw.actionSpec ?? raw.action_spec;
  if (actionSpec && typeof actionSpec === "object") {
    entries.push({
      ...actionSpec,
      verificationResult: raw.verificationResult ?? raw.verification_result ?? null,
      verificationState: raw.verificationState ?? raw.verification_state ?? null,
      evidenceSubmission: raw.evidenceSubmission ?? raw.evidence_submission ?? null,
      status: raw.actionStatus ?? raw.action_status ?? raw.status,
      completed: raw.completed,
      completionConfirmed: raw.completionConfirmed ?? raw.completion_confirmed,
    });
  }
  const verificationState = raw.verificationState ?? raw.verification_state;
  if (verificationState && typeof verificationState === "object" && !actionSpec) {
    entries.push({
      verificationState,
      verificationResult: raw.verificationResult ?? raw.verification_result ?? null,
      evidenceSubmission: raw.evidenceSubmission ?? raw.evidence_submission ?? null,
      status: raw.status,
      completed: raw.completed,
      completionConfirmed: raw.completionConfirmed ?? raw.completion_confirmed,
    });
  }
  return entries
    .map((entry, index) => normalizeGateActionSignal(entry, { sourceDay, index }))
    .filter(Boolean);
}

function collectExplicitVerificationSignals(verificationStates = null) {
  if (!verificationStates) return [];
  if (Array.isArray(verificationStates)) {
    return verificationStates
      .map((entry, index) => normalizeGateActionSignal(entry, { index }))
      .filter(Boolean);
  }
  const raw = objectOrEmpty(verificationStates);
  return Object.entries(raw)
    .map(([key, value], index) => normalizeGateActionSignal({
      actionId: key,
      verificationState: value,
      ...(objectOrEmpty(value)),
    }, { index }))
    .filter(Boolean);
}

function normalizeGateActionSignal(entry = {}, { sourceDay = null, index = 0 } = {}) {
  const raw = objectOrEmpty(entry);
  if (!Object.keys(raw).length) return null;
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
  const actionId = stringOrDefault(
    raw.actionId
      ?? raw.action_id
      ?? raw.sourceActionId
      ?? raw.source_action_id
      ?? raw.id
      ?? verificationState.actionId
      ?? verificationState.action_id,
    sourceDay ? `day-${sourceDay}-action-${index + 1}` : `action-${index + 1}`,
  );
  const completion = normalizeCompletionSignal({
    status: raw.status ?? raw.actionStatus ?? raw.action_status,
    completed: raw.completed,
    completionConfirmed: raw.completionConfirmed ?? raw.completion_confirmed,
    verified: raw.verified,
    verificationResult,
    verificationState,
    evidenceSubmission,
  });

  return {
    sourceDay: normalizeOptionalDayNumber(raw.sourceDay ?? raw.source_day ?? raw.day ?? raw.dayId ?? raw.day_id ?? sourceDay),
    source_day: normalizeOptionalDayNumber(raw.sourceDay ?? raw.source_day ?? raw.day ?? raw.dayId ?? raw.day_id ?? sourceDay),
    actionId,
    action_id: actionId,
    sourceActionId: stringOrDefault(raw.sourceActionId ?? raw.source_action_id, actionId),
    source_action_id: stringOrDefault(raw.sourceActionId ?? raw.source_action_id, actionId),
    actionDescription: stringOrDefault(raw.actionDescription ?? raw.action_description ?? raw.description, ""),
    action_description: stringOrDefault(raw.actionDescription ?? raw.action_description ?? raw.description, ""),
    completionSignal: stringOrDefault(raw.completionSignal ?? raw.completion_signal ?? raw.signal, ""),
    completion_signal: stringOrDefault(raw.completionSignal ?? raw.completion_signal ?? raw.signal, ""),
    status: completion.status,
    satisfied: completion.satisfied,
    completed: completion.completed,
    verified: completion.verified,
    verificationResult: completion.verification_result,
    verification_result: completion.verification_result,
    evidenceSubmission: completion.evidence_submission,
    evidence_submission: completion.evidence_submission,
  };
}

function normalizeCompletionSignal({
  status = "",
  completed = false,
  completionConfirmed = false,
  verified = false,
  verificationResult = null,
  verificationState = null,
  evidenceSubmission = null,
} = {}) {
  const verification = objectOrEmpty(verificationResult);
  const state = objectOrEmpty(verificationState);
  const evidence = objectOrEmpty(evidenceSubmission);
  const normalizedStatus = normalizeStatus(
    verification.status
      ?? verification.outcome
      ?? state.status
      ?? evidence.validationStatus
      ?? evidence.validation_status
      ?? evidence.status
      ?? status,
  );
  const verificationPassed = verification.passed === true || state.passed === true;
  const completionPassed = completed === true || completionConfirmed === true || verified === true;
  const statusPassed = PASSED_STATUSES.has(normalizedStatus);
  const explicitlyFailed = verification.passed === false || FAILED_STATUSES.has(normalizedStatus);
  const satisfied = verificationPassed || (!explicitlyFailed && (completionPassed || statusPassed));

  return {
    status: normalizedStatus || (satisfied ? "verified" : ""),
    satisfied,
    completed: completionPassed,
    verified: verificationPassed || statusPassed,
    failed: explicitlyFailed && !verificationPassed,
    verification_result: Object.keys(verification).length ? verification : null,
    evidence_submission: Object.keys(evidence).length ? evidence : null,
  };
}

function normalizeGateRequirement(requirement = {}, { index = 0, currentDay = null } = {}) {
  const raw = objectOrEmpty(requirement);
  if (!Object.keys(raw).length) return null;
  const sourceDay = normalizeOptionalDayNumber(raw.sourceDay ?? raw.source_day);
  const sourceActionId = stringOrDefault(
    raw.sourceActionId
      ?? raw.source_action_id
      ?? raw.actionId
      ?? raw.action_id
      ?? raw.id,
    "",
  );
  const requirementId = stringOrDefault(
    raw.requirementId ?? raw.requirement_id,
    sourceActionId
      ? `day-${currentDay || "unknown"}-requires-${sourceActionId}`
      : `day-${currentDay || "unknown"}-requirement-${index + 1}`,
  );
  const requirementMode = normalizeStatus(raw.requirementMode ?? raw.requirement_mode);
  const requiredBefore = normalizeStatus(raw.requiredBefore ?? raw.required_before);
  const blocking = raw.blocking === true
    || raw.progressionBlocked === true
    || raw.progression_blocked === true
    || raw.canAdvanceDay === false
    || raw.can_advance_day === false
    || BLOCKING_REQUIREMENT_MODES.has(requirementMode)
    || BLOCKING_REQUIRED_BEFORE.has(requiredBefore);

  return {
    ...raw,
    requirementId,
    requirement_id: requirementId,
    requirementType: stringOrDefault(raw.requirementType ?? raw.requirement_type, "prerequisite_action"),
    requirement_type: stringOrDefault(raw.requirementType ?? raw.requirement_type, "prerequisite_action"),
    requirementMode: requirementMode || "non_blocking_prerequisite",
    requirement_mode: requirementMode || "non_blocking_prerequisite",
    requiredBefore: requiredBefore || stringOrDefault(raw.requiredBefore ?? raw.required_before, ""),
    required_before: requiredBefore || stringOrDefault(raw.requiredBefore ?? raw.required_before, ""),
    sourceDay,
    source_day: sourceDay,
    sourceActionId,
    source_action_id: sourceActionId,
    actionId: stringOrDefault(raw.actionId ?? raw.action_id, sourceActionId),
    action_id: stringOrDefault(raw.actionId ?? raw.action_id, sourceActionId),
    currentDay: normalizeOptionalDayNumber(raw.currentDay ?? raw.current_day ?? currentDay),
    current_day: normalizeOptionalDayNumber(raw.currentDay ?? raw.current_day ?? currentDay),
    targetDay: normalizeOptionalDayNumber(raw.targetDay ?? raw.target_day ?? currentDay),
    target_day: normalizeOptionalDayNumber(raw.targetDay ?? raw.target_day ?? currentDay),
    blocking,
  };
}

function matchesGateRequirement(requirement = {}, signal = {}) {
  const requirementActionIds = [
    requirement.sourceActionId,
    requirement.source_action_id,
    requirement.actionId,
    requirement.action_id,
  ].map((value) => stringOrDefault(value, "")).filter(Boolean);
  const signalActionIds = [
    signal.sourceActionId,
    signal.source_action_id,
    signal.actionId,
    signal.action_id,
  ].map((value) => stringOrDefault(value, "")).filter(Boolean);
  const actionMatches = requirementActionIds.length === 0
    || requirementActionIds.some((id) => signalActionIds.includes(id));
  const requiredSourceDay = normalizeOptionalDayNumber(requirement.sourceDay ?? requirement.source_day);
  const signalSourceDay = normalizeOptionalDayNumber(signal.sourceDay ?? signal.source_day);
  const dayMatches = !requiredSourceDay || !signalSourceDay || requiredSourceDay === signalSourceDay;
  return actionMatches && dayMatches;
}

function extractPrerequisiteRequirements(payload = null) {
  if (Array.isArray(payload)) return payload;
  const source = objectOrEmpty(payload);
  const list = source.requirements
    ?? source.prerequisiteRequirements
    ?? source.prerequisite_requirements
    ?? source.prerequisites
    ?? [];
  return Array.isArray(list) ? list : [];
}

function dedupeActionSignals(signals = []) {
  const byKey = new Map();
  for (const signal of signals) {
    const key = [
      signal.source_day ?? "",
      signal.source_action_id || signal.action_id || "",
    ].join("::");
    if (!byKey.has(key) || signal.satisfied) {
      byKey.set(key, signal);
    }
  }
  return [...byKey.values()];
}

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function objectOrEmpty(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function stringOrDefault(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function normalizeOptionalDayNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  const integer = Math.trunc(number);
  return integer > 0 ? integer : null;
}

function normalizeStatus(value) {
  return String(value || "")
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

function normalizeVerifierMethod(value) {
  const normalized = normalizeStatus(value);
  if (!normalized) return "";
  if (normalized === "googlesheets" || normalized === "google_sheet" || normalized === "sheets") {
    return "google_sheets";
  }
  if (normalized === "googledocs" || normalized === "google_doc" || normalized === "docs") {
    return "google_docs";
  }
  if (normalized === "browser_harness" || normalized === "browser_tool") {
    return "browser";
  }
  if (normalized === "command_line" || normalized === "shell") {
    return "cli";
  }
  return normalized;
}

function toIso(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}
