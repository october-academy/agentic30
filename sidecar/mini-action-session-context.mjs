import { resolveActionAutoVerificationPlan } from "./action-day-auto-verification.mjs";
import { resolveActionEvidenceInputMode } from "./action-day-evidence-submission.mjs";
import {
  CURRICULUM_DAY_TYPES,
  buildCurriculumProviderContextPayload,
} from "./adaptive-curriculum.mjs";

export const MINI_ACTION_SESSION_CONTEXT_SCHEMA_VERSION = 1;
export const MINI_ACTION_SESSION_PAYLOAD_SCHEMA_VERSION = 1;
export const MINI_ACTION_COMPLETION_SIGNAL_SCHEMA_VERSION = 1;
export const MINI_ACTION_ORIGINAL_QUESTION_RESOLUTION_SCHEMA_VERSION = 1;
export const MINI_ACTION_REALTIME_REFRAME_SCHEMA_VERSION = 1;
export const MINI_ACTION_RESPONSE_REFERENCE_SCHEMA_VERSION = 1;
export const MINI_ACTION_ANSWERABILITY_VALIDATION_SCHEMA_VERSION = 1;
export const MINI_ACTION_EXECUTION_ONLY_MODE = "mini_action_execution_only";
export const MINI_ACTION_NON_INTERACTIVE_MODE = "non_interactive_execution";
export const MINI_ACTION_EXECUTION_STEP = "execution";
export const MINI_ACTION_EXECUTION_DISABLED_CAPABILITIES = Object.freeze([
  "planning",
  "interview",
  "review",
]);
export const MINI_ACTION_EXECUTION_ONLY_CAPABILITIES = Object.freeze({
  executeAction: true,
  autoVerifyAction: true,
  requestEvidenceFallback: true,
  carryOverCoaching: true,
  planning: false,
  interview: false,
  review: false,
});
export const MINI_ACTION_COMPLETION_DRIVER = Object.freeze({
  actionExecutionResult: "action_execution_result",
  none: "not_completed",
});
export const MINI_ACTION_SESSION_COMPLETION_STATUS = Object.freeze({
  pending: "pending",
  completed: "completed",
  insufficient: "insufficient",
});
export const MINI_ACTION_COMPLETION_SIGNAL_TYPE = "curriculum_mini_action_completed";
export const MINI_ACTION_REALTIME_REFRAME_TYPE = "curriculum_original_question_reframed";
export const MINI_ACTION_TEMPLATE_IDS = Object.freeze({
  customAuthored: "custom_authored_action_template",
  prerequisiteEvidence: "prerequisite_evidence_before_next_action",
  guidedRecovery: "guided_recovery_micro_action",
  interview: "interview_answer_to_action",
  actionAutoVerify: "action_auto_verify_execution",
  review: "review_summary_to_next_action",
  education: "education_worksheet_execution",
  googleSheet: "google_sheet_tracker_update",
  googleDoc: "google_doc_evidence_note",
  browser: "browser_public_proof",
  cli: "cli_local_artifact_check",
  fileEvidence: "file_evidence_capture",
  linkEvidence: "link_evidence_capture",
  generic: "generic_mini_action",
});

export function buildMiniActionNonInteractiveClassification() {
  const checkpointPolicy = {
    requiredUserInputCheckpoint: false,
    required_user_input_checkpoint: false,
    userInputCheckpointRequired: false,
    user_input_checkpoint_required: false,
    reason: "execution_only_mini_action_sessions_do_not_require_user_input_checkpoints",
  };
  return {
    interactive: false,
    nonInteractive: true,
    non_interactive: true,
    interactionMode: MINI_ACTION_NON_INTERACTIVE_MODE,
    interaction_mode: MINI_ACTION_NON_INTERACTIVE_MODE,
    currentStep: MINI_ACTION_EXECUTION_STEP,
    current_step: MINI_ACTION_EXECUTION_STEP,
    startStep: MINI_ACTION_EXECUTION_STEP,
    start_step: MINI_ACTION_EXECUTION_STEP,
    autoProceedToExecution: true,
    auto_proceed_to_execution: true,
    emitUserResponsePrompt: false,
    emit_user_response_prompt: false,
    awaitUserResponsePrompt: false,
    await_user_response_prompt: false,
    requiresUserInput: false,
    requires_user_input: false,
    requiresUserInputCheckpoint: false,
    requires_user_input_checkpoint: false,
    requiredUserInputCheckpoint: false,
    required_user_input_checkpoint: false,
    userInputCheckpointRequired: false,
    user_input_checkpoint_required: false,
    checkpointPolicy,
    checkpoint_policy: checkpointPolicy,
  };
}

export function composeFinalMiniActionSessionPayload({
  dayContextPayload = null,
  executionSettings = {},
  sessionId = null,
  generatedAt = new Date(),
  ...dayContextInput
} = {}) {
  const dayContext = applyExecutionOnlyModeToMiniActionSessionPayload(
    dayContextPayload ?? deriveMiniActionSessionDayContextPayload({
      ...dayContextInput,
      generatedAt,
    }),
  );
  const settings = normalizeMiniActionExecutionSettings(executionSettings, dayContext);
  const selectedActionTemplate = resolveSelectedMiniActionTemplate(dayContext);
  const nonInteractive = buildMiniActionNonInteractiveClassification();
  const providerContext = applyExecutionOnlyModeToMiniActionSessionPayload({
    providerContextPayload: dayContext.providerContextPayload ?? dayContext.provider_context_payload,
    capabilities: settings.capabilities,
  }).providerContextPayload;

  return {
    schemaVersion: MINI_ACTION_SESSION_PAYLOAD_SCHEMA_VERSION,
    schema: "agentic30.curriculum.mini_action_session_payload.v1",
    ...nonInteractive,
    generatedAt: toIso(generatedAt),
    sessionId: firstString(sessionId, settings.sessionId, `mini-action-day-${dayContext.day_id}`),
    session_id: firstString(sessionId, settings.sessionId, `mini-action-day-${dayContext.day_id}`),
    componentType: "curriculum_mini_action_session",
    component_type: "curriculum_mini_action_session",
    dayId: dayContext.day_id,
    day_id: dayContext.day_id,
    dayType: dayContext.day_type,
    day_type: dayContext.day_type,
    curriculumWeek: dayContext.curriculum_week,
    curriculum_week: dayContext.curriculum_week,
    executionMode: MINI_ACTION_EXECUTION_ONLY_MODE,
    execution_mode: MINI_ACTION_EXECUTION_ONLY_MODE,
    progressionBlocked: false,
    progression_blocked: false,
    coachingMode: "non_blocking_mini_action",
    coaching_mode: "non_blocking_mini_action",
    dayContext,
    day_context: dayContext,
    executionSettings: settings,
    execution_settings: settings,
    selectedActionTemplate,
    selected_action_template: selectedActionTemplate,
    actionTemplate: selectedActionTemplate,
    action_template: selectedActionTemplate,
    actionSpec: dayContext.actionSpec,
    action_spec: dayContext.action_spec,
    verificationRequest: buildMiniActionVerificationRequest(dayContext, settings),
    verification_request: buildMiniActionVerificationRequest(dayContext, settings),
    evidenceFallback: buildMiniActionEvidenceFallback(dayContext, settings),
    evidence_fallback: buildMiniActionEvidenceFallback(dayContext, settings),
    completionPolicy: buildMiniActionCompletionPolicy(),
    completion_policy: buildMiniActionCompletionPolicy(),
    providerPayload: {
      schema: "agentic30.curriculum.mini_action_session_provider_payload.v1",
      ...nonInteractive,
      executionMode: MINI_ACTION_EXECUTION_ONLY_MODE,
      execution_mode: MINI_ACTION_EXECUTION_ONLY_MODE,
      capabilityPolicy: dayContext.capabilityPolicy,
      capability_policy: dayContext.capability_policy,
      context: providerContext,
      dayContext,
      day_context: dayContext,
      selectedActionTemplate,
      selected_action_template: selectedActionTemplate,
      actionTemplate: selectedActionTemplate,
      action_template: selectedActionTemplate,
      completionPolicy: buildMiniActionCompletionPolicy(),
      completion_policy: buildMiniActionCompletionPolicy(),
      instructions: buildMiniActionProviderInstructions(dayContext, settings),
    },
    provider_payload: {
      schema: "agentic30.curriculum.mini_action_session_provider_payload.v1",
      ...nonInteractive,
      executionMode: MINI_ACTION_EXECUTION_ONLY_MODE,
      execution_mode: MINI_ACTION_EXECUTION_ONLY_MODE,
      capabilityPolicy: dayContext.capabilityPolicy,
      capability_policy: dayContext.capability_policy,
      context: providerContext,
      dayContext,
      day_context: dayContext,
      selectedActionTemplate,
      selected_action_template: selectedActionTemplate,
      actionTemplate: selectedActionTemplate,
      action_template: selectedActionTemplate,
      completionPolicy: buildMiniActionCompletionPolicy(),
      completion_policy: buildMiniActionCompletionPolicy(),
      instructions: buildMiniActionProviderInstructions(dayContext, settings),
    },
  };
}

export function resolveMiniActionSessionCompletionState({
  actionExecutionResult = null,
  verificationState = null,
  userMessageReceipt = null,
  providerRunEvent = null,
  now = new Date(),
} = {}) {
  const result = normalizeMiniActionExecutionResult(actionExecutionResult)
    ?? normalizeMiniActionExecutionResult(verificationState?.verificationResult)
    ?? normalizeMiniActionExecutionResult(verificationState);
  const hasUserMessageReceipt = Boolean(userMessageReceipt);
  const hasProviderRunCompletion = isProviderRunCompletionEvent(providerRunEvent);

  if (result?.passed === true) {
    return {
      status: MINI_ACTION_SESSION_COMPLETION_STATUS.completed,
      completed: true,
      completionConfirmed: true,
      completion_confirmed: true,
      completedAt: toIso(result.completedAt || now),
      completed_at: toIso(result.completedAt || now),
      completionDriver: MINI_ACTION_COMPLETION_DRIVER.actionExecutionResult,
      completion_driver: MINI_ACTION_COMPLETION_DRIVER.actionExecutionResult,
      actionExecutionResult: result,
      action_execution_result: result,
      progressionBlocked: false,
      progression_blocked: false,
      ignoredUserMessageReceipt: hasUserMessageReceipt,
      ignored_user_message_receipt: hasUserMessageReceipt,
      ignoredProviderRunCompletion: hasProviderRunCompletion,
      ignored_provider_run_completion: hasProviderRunCompletion,
      reason: "action_execution_result_passed",
    };
  }

  if (result?.passed === false) {
    return {
      status: MINI_ACTION_SESSION_COMPLETION_STATUS.insufficient,
      completed: false,
      completionConfirmed: false,
      completion_confirmed: false,
      completedAt: null,
      completed_at: null,
      completionDriver: MINI_ACTION_COMPLETION_DRIVER.none,
      completion_driver: MINI_ACTION_COMPLETION_DRIVER.none,
      actionExecutionResult: result,
      action_execution_result: result,
      progressionBlocked: false,
      progression_blocked: false,
      carryOverQueued: true,
      carry_over_queued: true,
      ignoredUserMessageReceipt: hasUserMessageReceipt,
      ignored_user_message_receipt: hasUserMessageReceipt,
      ignoredProviderRunCompletion: hasProviderRunCompletion,
      ignored_provider_run_completion: hasProviderRunCompletion,
      reason: "action_execution_result_insufficient",
    };
  }

  return {
    status: MINI_ACTION_SESSION_COMPLETION_STATUS.pending,
    completed: false,
    completionConfirmed: false,
    completion_confirmed: false,
    completedAt: null,
    completed_at: null,
    completionDriver: MINI_ACTION_COMPLETION_DRIVER.none,
    completion_driver: MINI_ACTION_COMPLETION_DRIVER.none,
    actionExecutionResult: null,
    action_execution_result: null,
    progressionBlocked: false,
    progression_blocked: false,
    carryOverQueued: false,
    carry_over_queued: false,
    ignoredUserMessageReceipt: hasUserMessageReceipt,
    ignored_user_message_receipt: hasUserMessageReceipt,
    ignoredProviderRunCompletion: hasProviderRunCompletion,
    ignored_provider_run_completion: hasProviderRunCompletion,
    reason: hasUserMessageReceipt || hasProviderRunCompletion
      ? "awaiting_action_execution_result"
      : "not_completed",
  };
}

export function detectMiniActionCompletionEvent({
  event = null,
  sessionId = "",
  dayContext = null,
  dayId = null,
  actionId = null,
  now = new Date(),
} = {}) {
  const source = objectOrEmpty(event);
  const result = extractMiniActionCompletionResult(source);
  const state = resolveMiniActionSessionCompletionState({
    actionExecutionResult: result,
    providerRunEvent: source,
    now,
  });

  if (!state.completed) return null;

  return buildMiniActionCompletionSignal({
    event: source,
    state,
    sessionId,
    dayContext,
    dayId,
    actionId,
    now,
  });
}

export function buildMiniActionCompletionSignal({
  event = null,
  state = null,
  sessionId = "",
  dayContext = null,
  dayId = null,
  actionId = null,
  now = new Date(),
} = {}) {
  const source = objectOrEmpty(event);
  const payload = objectOrEmpty(source.payload);
  const data = objectOrEmpty(source.data);
  const context = objectOrEmpty(dayContext ?? source.dayContext ?? source.day_context);
  const completionState = state ?? resolveMiniActionSessionCompletionState({
    actionExecutionResult: extractMiniActionCompletionResult(source),
    providerRunEvent: source,
    now,
  });
  if (!completionState?.completed) return null;

  const result = objectOrEmpty(
    completionState.actionExecutionResult
      ?? completionState.action_execution_result,
  );
  const resolvedDayId = normalizeOptionalMiniActionDayId(
    dayId
      ?? source.dayId
      ?? source.day_id
      ?? source.day
      ?? payload.dayId
      ?? payload.day_id
      ?? payload.day
      ?? data.dayId
      ?? data.day_id
      ?? data.day
      ?? context.dayId
      ?? context.day_id,
  );
  const resolvedActionId = firstString(
    actionId,
    source.actionId,
    source.action_id,
    payload.actionId,
    payload.action_id,
    data.actionId,
    data.action_id,
    context.actionSpec?.id,
    context.action_spec?.id,
  );
  const resolvedSessionId = firstString(
    sessionId,
    source.sessionId,
    source.session_id,
    payload.sessionId,
    payload.session_id,
    data.sessionId,
    data.session_id,
    context.sessionId,
    context.session_id,
  );
  const completedAt = firstString(
    completionState.completedAt,
    completionState.completed_at,
    result.completedAt,
    result.completed_at,
  ) || toIso(now);
  const sourceEventType = firstString(source.type, source.eventType, source.event_type, source.phase);
  const originalQuestionResolution = resolveActiveOriginalQuestionAfterMiniAction({
    completionSignal: {
      dayId: resolvedDayId,
      day_id: resolvedDayId,
      actionId: resolvedActionId,
      action_id: resolvedActionId,
      completedAt,
      completed_at: completedAt,
      verificationResult: result,
      verification_result: result,
    },
    dayContext: context,
    event: source,
    state: completionState,
    now,
  });
  const signal = {
    type: MINI_ACTION_COMPLETION_SIGNAL_TYPE,
    schemaVersion: MINI_ACTION_COMPLETION_SIGNAL_SCHEMA_VERSION,
    schema: "agentic30.curriculum.mini_action_completion_signal.v1",
    signal: "mini_action_completed",
    sessionId: resolvedSessionId,
    session_id: resolvedSessionId,
    dayId: resolvedDayId,
    day_id: resolvedDayId,
    actionId: resolvedActionId,
    action_id: resolvedActionId,
    status: MINI_ACTION_SESSION_COMPLETION_STATUS.completed,
    completed: true,
    completionConfirmed: true,
    completion_confirmed: true,
    completedAt,
    completed_at: completedAt,
    completionDriver: MINI_ACTION_COMPLETION_DRIVER.actionExecutionResult,
    completion_driver: MINI_ACTION_COMPLETION_DRIVER.actionExecutionResult,
    method: firstString(result.method, "manual"),
    passed: true,
    outcome: firstString(result.outcome, "verified"),
    confidence: normalizeNumber(result.confidence, 1),
    reason: firstString(result.reason, ""),
    agentAssessment: firstString(result.agentAssessment, result.agent_assessment, ""),
    agent_assessment: firstString(result.agentAssessment, result.agent_assessment, ""),
    actionExecutionResult: result,
    action_execution_result: result,
    verificationResult: result,
    verification_result: result,
    originalQuestionResolution,
    original_question_resolution: originalQuestionResolution,
    resolvedOriginalQuestion: originalQuestionResolution,
    resolved_original_question: originalQuestionResolution,
    activeOriginalQuestionResolved: Boolean(originalQuestionResolution?.resolved),
    active_original_question_resolved: Boolean(originalQuestionResolution?.resolved),
    sourceEventType,
    source_event_type: sourceEventType,
    progressionBlocked: false,
    progression_blocked: false,
  };

  return signal;
}

export function buildRealTimeReframeFromMiniActionCompletionSignal({
  completionSignal = null,
  dayContext = null,
  event = null,
  now = new Date(),
} = {}) {
  const signal = objectOrEmpty(completionSignal);
  const isCompletionSignal = signal.type === MINI_ACTION_COMPLETION_SIGNAL_TYPE
    || signal.signal === "mini_action_completed"
    || signal.completed === true
    || signal.completionConfirmed === true
    || signal.completion_confirmed === true
    || signal.passed === true
    || objectOrEmpty(signal.verificationResult ?? signal.verification_result).passed === true;
  if (!isCompletionSignal) return null;

  const resolution = normalizeOriginalQuestionResolution(
    signal.originalQuestionResolution
      ?? signal.original_question_resolution
      ?? signal.resolvedOriginalQuestion
      ?? signal.resolved_original_question,
  ) ?? resolveActiveOriginalQuestionAfterMiniAction({
    completionSignal: signal,
    dayContext,
    event,
    state: { completed: true },
    now,
  });
  if (!resolution?.resolved) return null;

  const reframingContext = normalizeReframingContext({
    resolution,
    signal,
  });
  const responseDataReferences = normalizeMiniActionResponseReferenceList(
    resolution.responseDataReferences
      ?? resolution.response_data_references
      ?? reframingContext.responseDataReferences
      ?? reframingContext.response_data_references,
  );
  const dependenciesResolvedBy = responseDataReferences.length > 0
    ? "known_mini_action_context"
    : "mini_action_execution_evidence";
  const answerabilityValidation = validateMiniActionReframedQuestionAnswerability({
    reframedQuestion: reframingContext.reframedVariant,
    originalQuestion: resolution.originalQuestion,
    intent: resolution.intent,
    responseDataReferences,
    reframingContext,
  });

  return {
    type: MINI_ACTION_REALTIME_REFRAME_TYPE,
    schemaVersion: MINI_ACTION_REALTIME_REFRAME_SCHEMA_VERSION,
    schema: "agentic30.curriculum.realtime_question_reframe.v1",
    trigger: "mini_action_completion_signal",
    triggerEventType: MINI_ACTION_COMPLETION_SIGNAL_TYPE,
    trigger_event_type: MINI_ACTION_COMPLETION_SIGNAL_TYPE,
    realTime: true,
    real_time: true,
    sessionId: firstString(signal.sessionId, signal.session_id, ""),
    session_id: firstString(signal.sessionId, signal.session_id, ""),
    dayId: normalizeOptionalMiniActionDayId(signal.dayId ?? signal.day_id ?? signal.day),
    day_id: normalizeOptionalMiniActionDayId(signal.dayId ?? signal.day_id ?? signal.day),
    actionId: firstString(signal.actionId, signal.action_id, ""),
    action_id: firstString(signal.actionId, signal.action_id, ""),
    questionId: resolution.questionId,
    question_id: resolution.questionId,
    originalQuestion: resolution.originalQuestion,
    original_question: resolution.originalQuestion,
    intent: resolution.intent,
    reframingContext,
    reframing_context: reframingContext,
    reframedVariant: reframingContext.reframedVariant,
    reframed_variant: reframingContext.reframedVariant,
    reframedQuestion: reframingContext.reframedVariant,
    reframed_question: reframingContext.reframedVariant,
    responseDataReferences,
    response_data_references: responseDataReferences,
    responseDataDependencyCount: responseDataReferences.length,
    response_data_dependency_count: responseDataReferences.length,
    responseDataDependenciesResolvedBy: dependenciesResolvedBy,
    response_data_dependencies_resolved_by: dependenciesResolvedBy,
    transformedQuestionAnswerability: answerabilityValidation,
    transformed_question_answerability: answerabilityValidation,
    answerabilityValidation,
    answerability_validation: answerabilityValidation,
    answerableWithoutMiniActionResponseData: answerabilityValidation.answerable,
    answerable_without_mini_action_response_data: answerabilityValidation.answerable,
    answerSource: firstString(resolution.answerSource, "action_execution_result"),
    answer_source: firstString(resolution.answerSource, "action_execution_result"),
    responseDataRequired: false,
    response_data_required: false,
    requiresResponseData: false,
    requires_response_data: false,
    requiresUserResponse: false,
    requires_user_response: false,
    progressionBlocked: false,
    progression_blocked: false,
    preserveIntent: answerabilityValidation.intentPreserved,
    preserve_intent: answerabilityValidation.intentPreserved,
    emittedAt: toIso(now),
    emitted_at: toIso(now),
  };
}

export function resolveActiveOriginalQuestionAfterMiniAction({
  completionSignal = null,
  dayContext = null,
  event = null,
  state = null,
  now = new Date(),
} = {}) {
  const signal = objectOrEmpty(completionSignal);
  const context = objectOrEmpty(dayContext ?? signal.dayContext ?? signal.day_context);
  const sourceEvent = objectOrEmpty(event);
  const completionState = objectOrEmpty(state);
  const result = objectOrEmpty(
    signal.verificationResult
      ?? signal.verification_result
      ?? signal.actionExecutionResult
      ?? signal.action_execution_result
      ?? completionState.actionExecutionResult
      ?? completionState.action_execution_result,
  );
  const isCompleted = signal.completed === true
    || signal.completionConfirmed === true
    || signal.completion_confirmed === true
    || completionState.completed === true
    || result.passed === true;

  if (!isCompleted) return null;

  const activeQuestion = resolveMiniActionActiveOriginalQuestion({
    dayContext: context,
    event: sourceEvent,
    completionSignal: signal,
  });
  if (!activeQuestion) return null;

  const completedAt = firstString(
    signal.completedAt,
    signal.completed_at,
    completionState.completedAt,
    completionState.completed_at,
    result.completedAt,
    result.completed_at,
  ) || toIso(now);
  const method = firstString(result.method, signal.method, "manual");
  const outcome = firstString(result.outcome, result.status, signal.outcome, "verified");
  const confidence = normalizeNumber(result.confidence ?? signal.confidence, 1);
  const agentAssessment = firstString(
    result.agentAssessment,
    result.agent_assessment,
    signal.agentAssessment,
    signal.agent_assessment,
  );
  const actionSpec = objectOrEmpty(context.actionSpec ?? context.action_spec);
  const selectedActionTemplate = objectOrEmpty(
    actionSpec.actionTemplate
      ?? actionSpec.action_template
      ?? context.selectedActionTemplate
      ?? context.selected_action_template
      ?? context.actionTemplate
      ?? context.action_template,
  );
  const miniActionMetadata = buildMiniActionKnownContextMetadata({
    actionSpec,
    selectedActionTemplate,
    verificationResult: result,
  });
  const answerText = buildOriginalQuestionResolutionAnswer({
    method,
    outcome,
    agentAssessment,
  });
  const rawResponseDataReferences = extractMiniActionResponseDataReferences({
    originalQuestion: activeQuestion.question,
    intent: activeQuestion.intent,
    existingReferences: activeQuestion.responseDataReferences,
  });
  const responseDataReferences = rewriteMiniActionResponseDataReferences({
    references: rawResponseDataReferences,
    actionSpec,
    selectedActionTemplate,
    verificationResult: result,
  });
  const responseDataDependenciesResolvedBy = responseDataReferences.length > 0
    ? "known_mini_action_context"
    : "mini_action_execution_evidence";
  const reframedVariant = buildKnownContextReframedVariant({
    originalQuestion: activeQuestion.question,
    intent: activeQuestion.intent,
    responseDataReferences,
    miniActionMetadata,
  });
  const reframingContext = {
    originalQuestion: activeQuestion.question,
    original_question: activeQuestion.question,
    intent: activeQuestion.intent,
    availableData: {
      method,
      outcome,
      confidence,
      agentAssessment,
      agent_assessment: agentAssessment,
      miniActionMetadata,
      mini_action_metadata: miniActionMetadata,
      verificationResult: result,
      verification_result: result,
    },
    available_data: {
      method,
      outcome,
      confidence,
      agentAssessment,
      agent_assessment: agentAssessment,
      miniActionMetadata,
      mini_action_metadata: miniActionMetadata,
      verificationResult: result,
      verification_result: result,
    },
    responseDataReferences,
    response_data_references: responseDataReferences,
    responseDataDependencyCount: responseDataReferences.length,
    response_data_dependency_count: responseDataReferences.length,
    responseDataDependenciesResolvedBy: responseDataDependenciesResolvedBy,
    response_data_dependencies_resolved_by: responseDataDependenciesResolvedBy,
    reframedVariant: reframedVariant,
    reframed_variant: reframedVariant,
  };
  const answerabilityValidation = validateMiniActionReframedQuestionAnswerability({
    reframedQuestion: reframedVariant,
    originalQuestion: activeQuestion.question,
    intent: activeQuestion.intent,
    responseDataReferences,
    reframingContext,
  });

  return {
    schemaVersion: MINI_ACTION_ORIGINAL_QUESTION_RESOLUTION_SCHEMA_VERSION,
    schema: "agentic30.curriculum.mini_action_original_question_resolution.v1",
    status: "resolved",
    resolved: true,
    resolvedBy: "completed_mini_action",
    resolved_by: "completed_mini_action",
    questionId: activeQuestion.id,
    question_id: activeQuestion.id,
    originalQuestion: activeQuestion.question,
    original_question: activeQuestion.question,
    intent: activeQuestion.intent,
    answerText,
    answer_text: answerText,
    answerSource: "action_execution_result",
    answer_source: "action_execution_result",
    answerData: {
      method,
      outcome,
      confidence,
      agentAssessment,
      agent_assessment: agentAssessment,
      miniActionMetadata,
      mini_action_metadata: miniActionMetadata,
      verificationResult: result,
      verification_result: result,
    },
    answer_data: {
      method,
      outcome,
      confidence,
      agentAssessment,
      agent_assessment: agentAssessment,
      miniActionMetadata,
      mini_action_metadata: miniActionMetadata,
      verificationResult: result,
      verification_result: result,
    },
    responseDataReferences,
    response_data_references: responseDataReferences,
    responseDataDependencyCount: responseDataReferences.length,
    response_data_dependency_count: responseDataReferences.length,
    responseDataDependenciesResolvedBy: responseDataDependenciesResolvedBy,
    response_data_dependencies_resolved_by: responseDataDependenciesResolvedBy,
    transformedQuestionAnswerability: answerabilityValidation,
    transformed_question_answerability: answerabilityValidation,
    answerabilityValidation,
    answerability_validation: answerabilityValidation,
    answerableWithoutMiniActionResponseData: answerabilityValidation.answerable,
    answerable_without_mini_action_response_data: answerabilityValidation.answerable,
    reframingContext,
    reframing_context: reframingContext,
    completedAt,
    completed_at: completedAt,
    preserveIntent: answerabilityValidation.intentPreserved,
    preserve_intent: answerabilityValidation.intentPreserved,
    responseDataRequired: false,
    response_data_required: false,
    requiresUserResponse: false,
    requires_user_response: false,
    progressionBlocked: false,
    progression_blocked: false,
  };
}

export function validateMiniActionReframedQuestionAnswerability({
  reframedQuestion = "",
  transformedQuestion = "",
  question = "",
  originalQuestion = "",
  intent = "",
  responseDataReferences = [],
  reframingContext = null,
} = {}) {
  const transformed = firstString(reframedQuestion, transformedQuestion, question);
  const references = normalizeMiniActionResponseReferenceList(responseDataReferences);
  const context = objectOrEmpty(reframingContext);
  const availableData = objectOrEmpty(context.availableData ?? context.available_data);
  const unresolvedReferences = references.filter((reference) =>
    reference.requires_response_data !== false
      || reference.response_data_required !== false
      || !firstString(reference.resolved_by, reference.resolvedBy)
  );
  const leakedReferenceTerms = references
    .filter((reference) => reference.original_requires_response_data === true)
    .filter((reference) => miniActionResponseReferenceAppearsInQuestion(transformed, reference.text));
  const hasKnownExecutionEvidence = Boolean(
    firstString(
      availableData.method,
      availableData.outcome,
      availableData.agentAssessment,
      availableData.agent_assessment,
      context.responseDataDependenciesResolvedBy,
      context.response_data_dependencies_resolved_by,
    )
      || Object.keys(objectOrEmpty(availableData.verificationResult ?? availableData.verification_result)).length > 0
      || (
        references.length > 0
        && references.every((reference) => firstString(reference.known_context_source, reference.knownContextSource))
      ),
  );
  const reasons = [];
  if (!transformed) reasons.push("missing_transformed_question");
  if (unresolvedReferences.length > 0) reasons.push("unresolved_response_data_references");
  if (leakedReferenceTerms.length > 0) reasons.push("transformed_question_still_names_response_data");
  if (!hasKnownExecutionEvidence) reasons.push("missing_known_execution_evidence");
  const intentValidation = validateMiniActionReframedQuestionIntent({
    reframedQuestion: transformed,
    originalQuestion,
    intent,
  });
  if (!intentValidation.intentPreserved) reasons.push("intent_not_preserved");

  return {
    schemaVersion: MINI_ACTION_ANSWERABILITY_VALIDATION_SCHEMA_VERSION,
    schema: "agentic30.curriculum.mini_action_answerability_validation.v1",
    answerable: reasons.length === 0,
    answerableWithoutMiniActionResponseData: reasons.length === 0,
    answerable_without_mini_action_response_data: reasons.length === 0,
    transformedQuestion: transformed,
    transformed_question: transformed,
    originalQuestion: firstString(originalQuestion, ""),
    original_question: firstString(originalQuestion, ""),
    intent: firstString(intent, ""),
    responseDataReferenceCount: references.length,
    response_data_reference_count: references.length,
    unresolvedResponseDataReferenceCount: unresolvedReferences.length,
    unresolved_response_data_reference_count: unresolvedReferences.length,
    leakedResponseDataTerms: leakedReferenceTerms.map((reference) => reference.text),
    leaked_response_data_terms: leakedReferenceTerms.map((reference) => reference.text),
    knownExecutionEvidenceAvailable: hasKnownExecutionEvidence,
    known_execution_evidence_available: hasKnownExecutionEvidence,
    intentPreserved: intentValidation.intentPreserved,
    intent_preserved: intentValidation.intentPreserved,
    userGoalOrDecisionAligned: intentValidation.userGoalOrDecisionAligned,
    user_goal_or_decision_aligned: intentValidation.userGoalOrDecisionAligned,
    intentValidation,
    intent_validation: intentValidation,
    reasons,
  };
}

export function validateMiniActionReframedQuestionIntent({
  reframedQuestion = "",
  transformedQuestion = "",
  originalQuestion = "",
  intent = "",
} = {}) {
  const transformed = firstString(reframedQuestion, transformedQuestion);
  const original = firstString(originalQuestion, "");
  const originalIntent = firstString(intent, "");
  const transformedTokens = significantIntentTokens(transformed);
  const intentTokens = significantIntentTokens(originalIntent);
  const originalQuestionTokens = significantIntentTokens(original);
  const targetTokens = intentTokens.length > 0 ? intentTokens : originalQuestionTokens;
  const matchedIntentTokens = targetTokens.filter((token) => transformedTokens.includes(token));
  const matchedQuestionTokens = originalQuestionTokens.filter((token) => transformedTokens.includes(token));
  const exactIntentIncluded = Boolean(
    originalIntent
      && transformed.toLocaleLowerCase().includes(originalIntent.toLocaleLowerCase()),
  );
  const exactQuestionIncluded = Boolean(
    original
      && transformed.toLocaleLowerCase().includes(original.toLocaleLowerCase()),
  );
  const minimumMatches = Math.min(2, targetTokens.length);
  const aligned = Boolean(
    transformed
      && (
        exactIntentIncluded
        || exactQuestionIncluded
        || targetTokens.length === 0
        || matchedIntentTokens.length >= minimumMatches
        || (
          matchedIntentTokens.length >= 1
          && matchedQuestionTokens.length >= 1
        )
      ),
  );

  return {
    schemaVersion: 1,
    schema: "agentic30.curriculum.reframed_question_intent_validation.v1",
    intentPreserved: aligned,
    intent_preserved: aligned,
    userGoalOrDecisionAligned: aligned,
    user_goal_or_decision_aligned: aligned,
    originalQuestion: original,
    original_question: original,
    intent: originalIntent,
    reframedQuestion: transformed,
    reframed_question: transformed,
    targetTokens,
    target_tokens: targetTokens,
    matchedIntentTokens,
    matched_intent_tokens: matchedIntentTokens,
    matchedQuestionTokens,
    matched_question_tokens: matchedQuestionTokens,
    exactIntentIncluded,
    exact_intent_included: exactIntentIncluded,
    exactQuestionIncluded,
    exact_question_included: exactQuestionIncluded,
  };
}

function miniActionResponseReferenceAppearsInQuestion(question, referenceText) {
  const haystack = String(question || "");
  const needle = String(referenceText || "").trim();
  if (!haystack || !needle) return false;
  if (/^[\p{Script=Latin}\p{N}_-]+$/u.test(needle)) {
    const escaped = escapeRegExp(needle);
    return new RegExp(`(?<![\\p{L}\\p{N}_-])${escaped}(?![\\p{L}\\p{N}_-])`, "iu").test(haystack);
  }
  return haystack.includes(needle);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const MINI_ACTION_INTENT_STOP_WORDS = new Set([
  "the",
  "and",
  "or",
  "to",
  "into",
  "with",
  "from",
  "that",
  "this",
  "what",
  "which",
  "when",
  "where",
  "how",
  "why",
  "can",
  "could",
  "should",
  "would",
  "does",
  "did",
  "will",
  "are",
  "is",
  "was",
  "were",
  "for",
  "of",
  "in",
  "on",
  "by",
  "as",
  "a",
  "an",
  "it",
  "its",
  "user",
  "users",
  "question",
  "answer",
  "기준",
  "답해보세요",
  "어떤",
  "무엇",
  "누구",
  "어디",
  "언제",
  "어떻게",
  "왜",
  "오늘",
  "지금",
]);

function significantIntentTokens(value) {
  const normalized = String(value || "")
    .toLocaleLowerCase()
    .normalize("NFKC");
  const latinTokens = normalized.match(/[\p{Script=Latin}\p{N}][\p{Script=Latin}\p{N}_-]{2,}/gu) ?? [];
  const koreanTokens = normalized.match(/[\p{Script=Hangul}]{2,}/gu) ?? [];
  return [...new Set([...latinTokens, ...koreanTokens])]
    .map((token) => token.replace(/^[\s_-]+|[\s_-]+$/g, ""))
    .filter((token) => token.length >= 2 && !MINI_ACTION_INTENT_STOP_WORDS.has(token));
}

export function extractMiniActionResponseDataReferences({
  originalQuestion = "",
  question = "",
  intent = "",
  existingReferences = null,
} = {}) {
  const explicitReferences = normalizeMiniActionResponseReferenceList(existingReferences);
  if (explicitReferences.length > 0) return explicitReferences;

  const text = firstString(originalQuestion, question);
  if (!text) return [];

  const patterns = [
    { kind: "reply", pattern: /\b(?:reply|replies|replied|respond|responds|responded|response|responses)\b/gi },
    { kind: "reaction", pattern: /\b(?:reaction|reactions|feedback|objection|objections)\b/gi },
    { kind: "outcome", pattern: /\b(?:no[-\s]?reply|yes|no|maybe|accepted|rejected|conversion|converted)\b/gi },
    { kind: "korean_reply", pattern: /응답|답장|회신|반응|피드백|거절|승낙|수락|무응답|전환/g },
  ];
  const references = [];
  const seen = new Set();

  for (const { kind, pattern } of patterns) {
    for (const match of text.matchAll(pattern)) {
      const matchedText = String(match[0] || "").trim();
      if (!matchedText) continue;
      const start = match.index ?? 0;
      const end = start + matchedText.length;
      const key = `${kind}:${matchedText.toLowerCase()}:${start}`;
      if (seen.has(key)) continue;
      seen.add(key);
      references.push(buildMiniActionResponseReference({
        kind,
        text: matchedText,
        start,
        end,
        originalQuestion: text,
        intent,
      }));
    }
  }

  return references;
}

export function rewriteMiniActionResponseDataReferences({
  references = [],
  actionSpec = null,
  selectedActionTemplate = null,
  verificationResult = null,
} = {}) {
  const normalizedReferences = normalizeMiniActionResponseReferenceList(references);
  if (normalizedReferences.length === 0) return [];

  const metadata = buildMiniActionKnownContextMetadata({
    actionSpec,
    selectedActionTemplate,
    verificationResult,
  });

  return normalizedReferences.map((reference) => ({
    ...reference,
    rewrittenText: metadata.referenceText,
    rewritten_text: metadata.referenceText,
    knownContextSource: metadata.source,
    known_context_source: metadata.source,
    knownContextSourceText: metadata.sourceText,
    known_context_source_text: metadata.sourceText,
    resolvedBy: "known_mini_action_context",
    resolved_by: "known_mini_action_context",
    originalRequiresResponseData: true,
    original_requires_response_data: true,
    requiresResponseData: false,
    requires_response_data: false,
    responseDataRequired: false,
    response_data_required: false,
    reason: "response_data_reference_rewritten_to_known_mini_action_context",
    fallbackDataSource: metadata.source,
    fallback_data_source: metadata.source,
  }));
}

export function deriveMiniActionSessionDayContextPayload({
  curriculumDay = null,
  daySpec = null,
  trigger = null,
  progressState = {},
  projectContext = null,
  currentWeekRawAnswers = null,
  dayRecords = [],
  providerContextPayload = null,
  configuredMcpServers = {},
  configuredMcpTools = null,
  configuredCliCommands = null,
  learnerState = null,
  generatedAt = new Date(),
} = {}) {
  const sourceDay = objectOrEmpty(daySpec ?? curriculumDay);
  const dayId = normalizeDayId(
    sourceDay.day
      ?? sourceDay.dayId
      ?? sourceDay.day_id
      ?? providerContextPayload?.day_id,
  );
  const dayType = stringOrDefault(
    sourceDay.dayType
      ?? sourceDay.day_type
      ?? providerContextPayload?.day_type,
    CURRICULUM_DAY_TYPES.action,
  );
  const dayGoal = stringOrDefault(
    sourceDay.dayGoal
      ?? sourceDay.day_goal
      ?? sourceDay.goal
      ?? sourceDay.title
      ?? providerContextPayload?.day_goal,
    "",
  );
  const actionSpec = normalizeMiniActionSpec(sourceDay, {
    dayId,
    dayGoal,
    dayType,
    learnerState: learnerState ?? progressState,
  });
  const verificationPlan = resolveActionAutoVerificationPlan({
    actionSpec,
    configuredMcpServers,
    configuredMcpTools,
    configuredCliCommands,
  });
  const evidenceInput = resolveActionEvidenceInputMode(actionSpec, {
    actionType: actionSpec.actionType,
    expectedEvidenceTypes: actionSpec.expectedEvidenceTypes,
  });
  const providerContext = providerContextPayload ?? buildCurriculumProviderContextPayload({
    day: dayId,
    curriculumDay: {
      ...sourceDay,
      day: dayId,
      dayType,
      title: dayGoal,
      goal: dayGoal,
    },
    progressState,
    projectContext,
    currentWeekRawAnswers,
    dayRecords,
    generatedAt,
  });
  const keyQuestions = normalizeKeyQuestions(sourceDay);
  const dependencies = normalizeDependencyRefs(sourceDay, actionSpec);

  return applyExecutionOnlyModeToMiniActionSessionPayload({
    schemaVersion: MINI_ACTION_SESSION_CONTEXT_SCHEMA_VERSION,
    schema: "agentic30.curriculum.mini_action_session_context.v1",
    generatedAt: toIso(generatedAt),
    dayId,
    day_id: dayId,
    dayType,
    day_type: dayType,
    curriculumWeek: normalizePositiveInteger(
      sourceDay.curriculumWeek
        ?? sourceDay.curriculum_week
        ?? providerContext.curriculum_week,
      Math.ceil(dayId / 7),
    ),
    curriculum_week: normalizePositiveInteger(
      sourceDay.curriculumWeek
        ?? sourceDay.curriculum_week
        ?? providerContext.curriculum_week,
      Math.ceil(dayId / 7),
    ),
    dayGoal,
    day_goal: dayGoal,
    componentType: "curriculum_mini_action_session",
    progressionBlocked: false,
    progression_blocked: false,
    coachingMode: "non_blocking_mini_action",
    coaching_mode: "non_blocking_mini_action",
    tone: "friendly_senior",
    userFacingNudge: buildUserFacingNudge(actionSpec),
    user_facing_nudge: buildUserFacingNudge(actionSpec),
    trigger: normalizeTrigger(trigger),
    keyQuestions,
    key_questions_with_intent: keyQuestions,
    actionSpec,
    action_spec: actionSpec,
    dependencyRefs: dependencies,
    dependency_refs: dependencies,
    verification: {
      autoFirst: true,
      auto_first: true,
      preferredMethods: verificationPlan.preferredMethods,
      preferred_methods: verificationPlan.preferredMethods,
      resolved: verificationPlan.resolved,
      skipped: verificationPlan.skipped,
      fallbackEvidenceInput: evidenceInput,
      fallback_evidence_input: evidenceInput,
    },
    providerContextPayload: providerContext,
    provider_context_payload: providerContext,
  });
}

export function applyExecutionOnlyModeToMiniActionSessionPayload(payload = {}) {
  const source = objectOrEmpty(payload);
  const providerContext = objectOrEmpty(source.providerContextPayload ?? source.provider_context_payload);
  const capabilities = buildExecutionOnlyCapabilities(source.capabilities, providerContext.capabilities);
  const disabledCapabilities = MINI_ACTION_EXECUTION_DISABLED_CAPABILITIES.slice();
  const nonInteractive = buildMiniActionNonInteractiveClassification();
  const capabilityPolicy = {
    mode: MINI_ACTION_EXECUTION_ONLY_MODE,
    mode_reason: "mini_action_sessions_execute_and_verify_only",
    capabilities,
    disabledCapabilities,
    disabled_capabilities: disabledCapabilities,
    planningEnabled: false,
    planning_enabled: false,
    interviewEnabled: false,
    interview_enabled: false,
    reviewEnabled: false,
    review_enabled: false,
    guardrails: [
      "Execute the current mini-action and verify evidence.",
      "Do not enter planning, interview, or review flows from this payload.",
      "Keep coaching non-blocking; carry incomplete work forward instead of blocking progression.",
    ],
  };
  const nextProviderContext = {
    ...providerContext,
    ...nonInteractive,
    executionMode: MINI_ACTION_EXECUTION_ONLY_MODE,
    execution_mode: MINI_ACTION_EXECUTION_ONLY_MODE,
    capabilities,
    disabledCapabilities,
    disabled_capabilities: disabledCapabilities,
    capabilityPolicy,
    capability_policy: capabilityPolicy,
  };

  return {
    ...source,
    ...nonInteractive,
    executionMode: MINI_ACTION_EXECUTION_ONLY_MODE,
    execution_mode: MINI_ACTION_EXECUTION_ONLY_MODE,
    executionOnly: true,
    execution_only: true,
    capabilities,
    disabledCapabilities,
    disabled_capabilities: disabledCapabilities,
    capabilityPolicy,
    capability_policy: capabilityPolicy,
    providerContextPayload: nextProviderContext,
    provider_context_payload: nextProviderContext,
  };
}

function normalizeMiniActionExecutionSettings(executionSettings, dayContext) {
  const source = objectOrEmpty(executionSettings);
  const verification = objectOrEmpty(dayContext.verification);
  const fallback = objectOrEmpty(
    source.evidenceFallback
      ?? source.evidence_fallback
      ?? verification.fallbackEvidenceInput
      ?? verification.fallback_evidence_input,
  );
  const preferredMethods = normalizeStringArray(
    source.preferredVerificationMethods
      ?? source.preferred_verification_methods
      ?? source.verificationMethods
      ?? source.verification_methods
      ?? verification.preferredMethods
      ?? verification.preferred_methods,
  );
  const capabilities = buildExecutionOnlyCapabilities(source.capabilities, dayContext.capabilities);
  const nonInteractive = buildMiniActionNonInteractiveClassification();
  return {
    sessionId: firstString(source.sessionId, source.session_id),
    ...nonInteractive,
    mode: MINI_ACTION_EXECUTION_ONLY_MODE,
    mode_reason: "mini_action_sessions_execute_and_verify_only",
    autoVerifyFirst: source.autoVerifyFirst !== false,
    auto_verify_first: source.autoVerifyFirst !== false,
    progressionBlocked: false,
    progression_blocked: false,
    allowPlanning: false,
    allow_planning: false,
    allowInterview: false,
    allow_interview: false,
    allowReview: false,
    allow_review: false,
    allowManualEvidenceFallback: source.allowManualEvidenceFallback !== false,
    allow_manual_evidence_fallback: source.allowManualEvidenceFallback !== false,
    maxSessionMinutes: normalizePositiveInteger(
      source.maxSessionMinutes ?? source.max_session_minutes,
      10,
    ),
    max_session_minutes: normalizePositiveInteger(
      source.maxSessionMinutes ?? source.max_session_minutes,
      10,
    ),
    preferredVerificationMethods: preferredMethods,
    preferred_verification_methods: preferredMethods,
    evidenceFallback: fallback,
    evidence_fallback: fallback,
    capabilities,
    disabledCapabilities: MINI_ACTION_EXECUTION_DISABLED_CAPABILITIES.slice(),
    disabled_capabilities: MINI_ACTION_EXECUTION_DISABLED_CAPABILITIES.slice(),
  };
}

function buildMiniActionVerificationRequest(dayContext, settings) {
  const verification = objectOrEmpty(dayContext.verification);
  const resolved = Array.isArray(verification.resolved) ? verification.resolved : [];
  const skipped = Array.isArray(verification.skipped) ? verification.skipped : [];
  return {
    autoFirst: settings.autoVerifyFirst,
    auto_first: settings.auto_verify_first,
    preferredMethods: settings.preferredVerificationMethods,
    preferred_methods: settings.preferred_verification_methods,
    resolved,
    skipped,
    actionSpec: dayContext.actionSpec,
    action_spec: dayContext.action_spec,
  };
}

function buildMiniActionEvidenceFallback(dayContext, settings) {
  const fallback = objectOrEmpty(settings.evidenceFallback ?? settings.evidence_fallback);
  const allowedTypes = Array.isArray(fallback.allowedTypes)
    ? fallback.allowedTypes.slice()
    : normalizeStringArray(fallback.allowed_types);
  return {
    enabled: settings.allowManualEvidenceFallback,
    evidenceType: stringOrDefault(fallback.evidenceType ?? fallback.evidence_type, "link"),
    evidence_type: stringOrDefault(fallback.evidenceType ?? fallback.evidence_type, "link"),
    inputMode: stringOrDefault(fallback.inputMode ?? fallback.input_mode ?? fallback.mode, "link"),
    input_mode: stringOrDefault(fallback.inputMode ?? fallback.input_mode ?? fallback.mode, "link"),
    allowedTypes,
    allowed_types: allowedTypes,
    actionSpec: dayContext.actionSpec,
    action_spec: dayContext.action_spec,
  };
}

function buildMiniActionCompletionPolicy() {
  return {
    completionDriver: MINI_ACTION_COMPLETION_DRIVER.actionExecutionResult,
    completion_driver: MINI_ACTION_COMPLETION_DRIVER.actionExecutionResult,
    requiredSignal: "passed_action_execution_result",
    required_signal: "passed_action_execution_result",
    ignoreUserMessageReceipt: true,
    ignore_user_message_receipt: true,
    ignoreProviderRunCompletion: true,
    ignore_provider_run_completion: true,
    nonBlockingOnInsufficientResult: true,
    non_blocking_on_insufficient_result: true,
    reason: "execution_only_mini_action_sessions_complete_only_after_action_verification_passes",
  };
}

function resolveSelectedMiniActionTemplate(dayContext) {
  const actionSpec = objectOrEmpty(dayContext.actionSpec ?? dayContext.action_spec);
  return objectOrEmpty(
    actionSpec.actionTemplate
      ?? actionSpec.action_template
      ?? dayContext.selectedActionTemplate
      ?? dayContext.selected_action_template
      ?? dayContext.actionTemplate
      ?? dayContext.action_template,
  );
}

function buildMiniActionProviderInstructions(dayContext, settings) {
  return [
    "Run only the current mini-action session.",
    "Start immediately at the execution step; do not emit, ask, or wait for a user-response prompt first.",
    "Use configured auto-verification first when available.",
    settings.allowManualEvidenceFallback
      ? "If auto-verification is insufficient, request the configured evidence fallback."
      : "Do not request manual evidence fallback unless later enabled.",
    "Keep coaching non-blocking and concise; never block Day progression.",
    `Friendly senior tone: ${dayContext.user_facing_nudge || "가장 작은 실행부터 해보세요."}`,
  ];
}

function buildExecutionOnlyCapabilities(...existingEntries) {
  const source = Object.assign({}, ...existingEntries.map(objectOrEmpty));
  return {
    ...source,
    ...MINI_ACTION_EXECUTION_ONLY_CAPABILITIES,
  };
}

export function selectMiniActionTemplate({
  dayType = CURRICULUM_DAY_TYPES.action,
  actionMetadata = {},
  learnerState = {},
} = {}) {
  const metadata = objectOrEmpty(actionMetadata);
  const state = normalizeLearnerActionState(learnerState);
  const normalizedDayType = normalizeDayType(dayType);
  const actionType = normalizeActionType(metadata.actionType ?? metadata.action_type);
  const verificationMethods = normalizeVerificationMethods(
    metadata.verificationMethods
      ?? metadata.verification_methods
      ?? metadata.verificationMethod
      ?? metadata.verification_method,
  );
  const expectedEvidenceTypes = normalizeStringArray(
    metadata.expectedEvidenceTypes
      ?? metadata.expected_evidence_types
      ?? metadata.evidenceTypes
      ?? metadata.evidence_types,
  );
  const completionSignal = firstString(metadata.completionSignal, metadata.completion_signal);
  const description = firstString(metadata.description, metadata.actionDescription, metadata.action_description, metadata.action);
  const explicitTemplate = firstString(
    metadata.explicitTemplate,
    metadata.explicit_template,
    metadata.template,
    metadata.script,
  );
  const base = selectBaseActionTemplate({
    dayType: normalizedDayType,
    actionType,
    verificationMethods,
    expectedEvidenceTypes,
    explicitTemplate,
    description,
  });
  const selected = applyLearnerTemplateAdjustment(base, state);

  return {
    id: selected.id,
    templateId: selected.id,
    template_id: selected.id,
    source: selected.source,
    dayType: normalizedDayType,
    day_type: normalizedDayType,
    actionType,
    action_type: actionType,
    template: selected.template,
    rationale: selected.rationale,
    learnerAdjustment: selected.learnerAdjustment,
    learner_adjustment: selected.learnerAdjustment,
    difficultyDirection: state.difficultyDirection,
    difficulty_direction: state.difficultyDirection,
    trigger: state.trigger,
    verificationMethods,
    verification_methods: verificationMethods,
    expectedEvidenceTypes,
    expected_evidence_types: expectedEvidenceTypes,
    completionSignal,
    completion_signal: completionSignal,
  };
}

function selectBaseActionTemplate({
  dayType,
  actionType,
  verificationMethods,
  expectedEvidenceTypes,
  explicitTemplate,
  description,
}) {
  if (explicitTemplate) {
    return {
      id: MINI_ACTION_TEMPLATE_IDS.customAuthored,
      source: "action_metadata.template",
      template: explicitTemplate,
      rationale: "Use the authored Day action template unless learner state requires an adjustment.",
    };
  }

  if (dayType === CURRICULUM_DAY_TYPES.interview) {
    return actionTemplate(
      MINI_ACTION_TEMPLATE_IDS.interview,
      "day_type.interview",
      "Turn the strongest answer into one 10-minute external action, then capture the evidence link or note.",
      "Interview Days convert answers into a small real action when a mini-action is needed.",
    );
  }
  if (dayType === CURRICULUM_DAY_TYPES.review) {
    return actionTemplate(
      MINI_ACTION_TEMPLATE_IDS.review,
      "day_type.review",
      "Pick one unresolved Review insight, execute the smallest next action, and attach the resulting proof.",
      "Review Days should act on summarized evidence rather than start a new interview.",
    );
  }
  if (dayType === CURRICULUM_DAY_TYPES.education) {
    return actionTemplate(
      MINI_ACTION_TEMPLATE_IDS.education,
      "day_type.education",
      "Fill the worksheet with one concrete example, apply it to today’s project, and save the artifact.",
      "Education Days use worksheet execution so learning produces a durable artifact.",
    );
  }

  if (verificationMethods.includes("google_sheets") || /sheet|tracker|outreach/.test(actionType)) {
    return actionTemplate(
      MINI_ACTION_TEMPLATE_IDS.googleSheet,
      "action_metadata.google_sheets",
      "Add dated rows with target, action taken, status, result, and next step; verify the sheet after saving.",
      "Spreadsheet actions need structured rows that Google Sheets verification can inspect.",
    );
  }
  if (verificationMethods.includes("google_docs") || /doc|journal|memo|checklist/.test(actionType)) {
    return actionTemplate(
      MINI_ACTION_TEMPLATE_IDS.googleDoc,
      "action_metadata.google_docs",
      "Write a dated evidence note with decision, source, result, and next action; verify the document after saving.",
      "Document actions need a compact note that Google Docs verification can inspect.",
    );
  }
  if (verificationMethods.includes("browser") || /public_post|landing|proof|community|url/.test(actionType)) {
    return actionTemplate(
      MINI_ACTION_TEMPLATE_IDS.browser,
      "action_metadata.browser",
      "Publish one visible proof update with context, evidence, and next action; verify the public URL in Browser.",
      "Public proof actions should produce a URL that Browser verification can check.",
    );
  }
  if (verificationMethods.includes("cli") || /cli|build|test|demo_asset/.test(actionType)) {
    return actionTemplate(
      MINI_ACTION_TEMPLATE_IDS.cli,
      "action_metadata.cli",
      "Create the local artifact, run the configured CLI check, and keep the terminal result as evidence.",
      "Local artifact actions should be verified by the configured CLI command first.",
    );
  }
  if (expectedEvidenceTypes.includes("file")) {
    return actionTemplate(
      MINI_ACTION_TEMPLATE_IDS.fileEvidence,
      "action_metadata.file_evidence",
      "Create or attach the smallest file proof, name it with today’s Day number, and submit it as evidence.",
      "File evidence actions need a concrete artifact for fallback validation.",
    );
  }
  if (expectedEvidenceTypes.includes("link")) {
    return actionTemplate(
      MINI_ACTION_TEMPLATE_IDS.linkEvidence,
      "action_metadata.link_evidence",
      "Create one shareable link proof, check that it opens, and submit the URL as evidence.",
      "Link evidence actions need a reachable URL for fallback validation.",
    );
  }

  return actionTemplate(
    MINI_ACTION_TEMPLATE_IDS.actionAutoVerify,
    "day_type.action",
    buildDefaultTemplate({ actionType, description }),
    "Action Days default to the metadata-specific execution template.",
  );
}

function applyLearnerTemplateAdjustment(baseTemplate, learnerState) {
  if (learnerState.isRushing) {
    return {
      ...baseTemplate,
      id: MINI_ACTION_TEMPLATE_IDS.prerequisiteEvidence,
      source: "learner_state.rushing",
      template: `Before moving ahead, verify one prerequisite action first: ${baseTemplate.template}`,
      rationale: "Rushing increases difficulty by requiring proof from the prerequisite action before the new action.",
      learnerAdjustment: "increase_prerequisite_evidence_required",
    };
  }
  if (learnerState.hasIncompleteAccumulation) {
    return {
      ...baseTemplate,
      id: MINI_ACTION_TEMPLATE_IDS.guidedRecovery,
      source: "learner_state.incomplete_accumulation",
      template: `Recover the smallest incomplete action in 10 minutes: ${baseTemplate.template}`,
      rationale: "Accumulated incompletions lower difficulty into a guided recovery action without blocking progression.",
      learnerAdjustment: "decrease_to_guided_recovery",
    };
  }
  return {
    ...baseTemplate,
    learnerAdjustment: "none",
  };
}

function actionTemplate(id, source, template, rationale) {
  return { id, source, template, rationale };
}

function normalizeMiniActionSpec(sourceDay, { dayId, dayGoal, dayType, learnerState }) {
  const explicit = objectOrEmpty(
    sourceDay.actionSpec
      ?? sourceDay.action_spec
      ?? sourceDay.actionWithSignal
      ?? sourceDay.action_with_signal,
  );
  const tasks = normalizeStringArray(sourceDay.tasks);
  const description = firstString(
    explicit.description,
    explicit.actionDescription,
    explicit.action_description,
    explicit.task,
    explicit.action,
    sourceDay.actionDescription,
    sourceDay.action_description,
    tasks[0],
    dayGoal,
  );
  const completionSignal = firstString(
    explicit.completionSignal,
    explicit.completion_signal,
    explicit.signal,
    explicit.completion,
    sourceDay.completionSignal,
    sourceDay.completion_signal,
    sourceDay.output,
  );
  const actionType = normalizeActionType(firstString(
    explicit.actionType,
    explicit.action_type,
    sourceDay.actionType,
    sourceDay.action_type,
    inferActionType({ description, completionSignal, dayGoal }),
  ));
  const verificationMethods = normalizeVerificationMethods(
    explicit.verificationMethods
      ?? explicit.verification_methods
      ?? explicit.verificationMethod
      ?? explicit.verification_method
      ?? sourceDay.verificationMethods
      ?? sourceDay.verification_methods
      ?? sourceDay.verificationMethod
      ?? sourceDay.verification_method
      ?? inferVerificationMethod({ actionType, description, completionSignal }),
  );
  const expectedEvidenceTypes = normalizeStringArray(
    explicit.expectedEvidenceTypes
      ?? explicit.expected_evidence_types
      ?? explicit.evidenceTypes
      ?? explicit.evidence_types
      ?? sourceDay.expectedEvidenceTypes
      ?? sourceDay.expected_evidence_types,
  );
  const selectedTemplate = selectMiniActionTemplate({
    dayType,
    actionMetadata: {
      ...sourceDay,
      ...explicit,
      actionType,
      action_type: actionType,
      description,
      completionSignal,
      completion_signal: completionSignal,
      verificationMethods,
      verification_methods: verificationMethods,
      expectedEvidenceTypes,
      expected_evidence_types: expectedEvidenceTypes,
      explicitTemplate: firstString(
        explicit.template,
        explicit.script,
        sourceDay.template,
        sourceDay.miniActionTemplate,
        sourceDay.mini_action_template,
      ),
    },
    learnerState,
  });

  return {
    id: firstString(explicit.id, explicit.actionId, explicit.action_id, `day-${dayId}-mini-action`),
    dayId,
    day_id: dayId,
    actionType,
    action_type: actionType,
    description,
    template: selectedTemplate.template,
    actionTemplate: selectedTemplate,
    action_template: selectedTemplate,
    completionSignal,
    completion_signal: completionSignal,
    verificationMethods,
    verification_methods: verificationMethods,
    verificationMethod: verificationMethods[0] ?? "manual",
    verification_method: verificationMethods[0] ?? "manual",
    expectedEvidenceTypes,
    expected_evidence_types: expectedEvidenceTypes,
    dependencies: normalizeStringArray(
      explicit.dependencies
        ?? explicit.dependencyRefs
        ?? explicit.dependency_refs
        ?? sourceDay.dependencies
        ?? sourceDay.dependencyRefs
        ?? sourceDay.dependency_refs,
    ),
  };
}

function normalizeKeyQuestions(sourceDay) {
  const source = sourceDay.keyQuestionsWithIntent
    ?? sourceDay.key_questions_with_intent
    ?? sourceDay.keyQuestions
    ?? sourceDay.key_questions
    ?? [];
  const normalized = Array.isArray(source)
    ? source.map((entry, index) => normalizeKeyQuestion(entry, index)).filter(Boolean)
    : [];
  if (normalized.length > 0) return normalized;

  return normalizeStringArray(sourceDay.tasks).slice(0, 2).map((task, index) => ({
    id: `task-${index + 1}`,
    question: task,
    intent: index === 0
      ? "Turn the current Day requirement into one concrete action."
      : "Clarify what evidence will prove the action happened.",
  }));
}

function normalizeKeyQuestion(entry, index) {
  if (typeof entry === "string") {
    const text = entry.trim();
    if (!text) return null;
    return {
      id: `question-${index + 1}`,
      question: text,
      intent: "Use the answer to reframe the mini-action without blocking progression.",
    };
  }
  const value = objectOrEmpty(entry);
  const question = firstString(value.question, value.text, value.prompt);
  if (!question) return null;
  return {
    id: firstString(value.id, value.questionId, value.question_id, `question-${index + 1}`),
    question,
    intent: firstString(value.intent, value.why, value.purpose, "Use this intent to reframe the action in real time."),
  };
}

function resolveMiniActionActiveOriginalQuestion({
  dayContext = null,
  event = null,
  completionSignal = null,
} = {}) {
  const context = objectOrEmpty(dayContext);
  const sourceEvent = objectOrEmpty(event);
  const signal = objectOrEmpty(completionSignal);
  const payload = objectOrEmpty(sourceEvent.payload);
  const data = objectOrEmpty(sourceEvent.data);
  const trigger = objectOrEmpty(context.trigger ?? sourceEvent.trigger ?? payload.trigger ?? data.trigger);
  const explicitSource = signal.activeOriginalQuestion
    ?? signal.active_original_question
    ?? signal.originalQuestion
    ?? signal.original_question
    ?? sourceEvent.activeOriginalQuestion
    ?? sourceEvent.active_original_question
    ?? sourceEvent.originalQuestion
    ?? sourceEvent.original_question
    ?? payload.activeOriginalQuestion
    ?? payload.active_original_question
    ?? payload.originalQuestion
    ?? payload.original_question
    ?? data.activeOriginalQuestion
    ?? data.active_original_question
    ?? data.originalQuestion
    ?? data.original_question
    ?? context.activeOriginalQuestion
    ?? context.active_original_question
    ?? context.originalQuestion
    ?? context.original_question
    ?? trigger.activeOriginalQuestion
    ?? trigger.active_original_question
    ?? trigger.originalQuestion
    ?? trigger.original_question;
  const explicit = objectOrEmpty(explicitSource);
  const keyQuestions = normalizeMiniActionQuestionList(
    context.keyQuestions
      ?? context.key_questions_with_intent
      ?? context.questions
      ?? payload.keyQuestions
      ?? payload.key_questions_with_intent
      ?? data.keyQuestions
      ?? data.key_questions_with_intent,
  );
  const activeQuestionId = firstString(
    signal.activeQuestionId,
    signal.active_question_id,
    signal.questionId,
    signal.question_id,
    sourceEvent.activeQuestionId,
    sourceEvent.active_question_id,
    sourceEvent.currentQuestionId,
    sourceEvent.current_question_id,
    sourceEvent.questionId,
    sourceEvent.question_id,
    payload.activeQuestionId,
    payload.active_question_id,
    payload.currentQuestionId,
    payload.current_question_id,
    payload.questionId,
    payload.question_id,
    data.activeQuestionId,
    data.active_question_id,
    data.currentQuestionId,
    data.current_question_id,
    data.questionId,
    data.question_id,
    context.activeQuestionId,
    context.active_question_id,
    context.currentQuestionId,
    context.current_question_id,
    context.questionId,
    context.question_id,
    trigger.activeQuestionId,
    trigger.active_question_id,
    trigger.currentQuestionId,
    trigger.current_question_id,
    trigger.questionId,
    trigger.question_id,
    explicit.id,
    explicit.questionId,
    explicit.question_id,
  );

  const matched = activeQuestionId
    ? keyQuestions.find((question) => question.id === activeQuestionId)
    : null;
  const candidate = normalizeMiniActionQuestion(explicitSource, 0)
    ?? matched
    ?? (activeQuestionId ? null : keyQuestions[0] ?? null);

  if (!candidate?.question) return null;
  return {
    id: firstString(candidate.id, activeQuestionId, "active-original-question"),
    question: candidate.question,
    intent: candidate.intent,
    responseDataReferences: extractMiniActionResponseDataReferences({
      originalQuestion: candidate.question,
      intent: candidate.intent,
      existingReferences: candidate.responseDataReferences ?? candidate.response_data_references,
    }),
    response_data_references: extractMiniActionResponseDataReferences({
      originalQuestion: candidate.question,
      intent: candidate.intent,
      existingReferences: candidate.responseDataReferences ?? candidate.response_data_references,
    }),
  };
}

function normalizeMiniActionQuestionList(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry, index) => normalizeMiniActionQuestion(entry, index))
    .filter(Boolean);
}

function normalizeMiniActionQuestion(entry, index) {
  if (typeof entry === "string") {
    const question = entry.trim();
    if (!question) return null;
    return {
      id: `question-${index + 1}`,
      question,
      intent: "Preserve the original question intent after mini-action completion.",
      responseDataReferences: extractMiniActionResponseDataReferences({ originalQuestion: question }),
      response_data_references: extractMiniActionResponseDataReferences({ originalQuestion: question }),
    };
  }
  const value = objectOrEmpty(entry);
  const question = firstString(
    value.question,
    value.text,
    value.prompt,
    value.originalQuestion,
    value.original_question,
  );
  if (!question) return null;
  return {
    id: firstString(value.id, value.questionId, value.question_id, `question-${index + 1}`),
    question,
    intent: firstString(value.intent, value.why, value.purpose, ""),
    responseDataReferences: extractMiniActionResponseDataReferences({
      originalQuestion: question,
      intent: firstString(value.intent, value.why, value.purpose, ""),
      existingReferences: value.responseDataReferences ?? value.response_data_references,
    }),
    response_data_references: extractMiniActionResponseDataReferences({
      originalQuestion: question,
      intent: firstString(value.intent, value.why, value.purpose, ""),
      existingReferences: value.responseDataReferences ?? value.response_data_references,
    }),
  };
}

function normalizeOriginalQuestionResolution(value) {
  const resolution = objectOrEmpty(value);
  const originalQuestion = firstString(
    resolution.originalQuestion,
    resolution.original_question,
    resolution.question,
  );
  if (!originalQuestion) return null;
  const resolved = resolution.resolved === true
    || firstString(resolution.status, "") === "resolved";
  if (!resolved) return null;
  const responseDataReferences = normalizeMiniActionResponseReferenceList(
    resolution.responseDataReferences ?? resolution.response_data_references,
  );
  const answerData = objectOrEmpty(resolution.answerData ?? resolution.answer_data);
  const resolvedReferences = rewriteMiniActionResponseDataReferences({
    references: responseDataReferences.length > 0
      ? responseDataReferences
      : extractMiniActionResponseDataReferences({
        originalQuestion,
        intent: firstString(resolution.intent, ""),
      }),
    verificationResult: objectOrEmpty(
      answerData.verificationResult
        ?? answerData.verification_result
        ?? answerData,
    ),
  });
  return {
    ...resolution,
    resolved: true,
    questionId: firstString(
      resolution.questionId,
      resolution.question_id,
      "active-original-question",
    ),
    originalQuestion,
    intent: firstString(resolution.intent, ""),
    answerSource: firstString(
      resolution.answerSource,
      resolution.answer_source,
      "action_execution_result",
    ),
    answerData,
    responseDataReferences: resolvedReferences,
    reframingContext: objectOrEmpty(
      resolution.reframingContext
        ?? resolution.reframing_context,
    ),
  };
}

function normalizeReframingContext({
  resolution = {},
  signal = {},
} = {}) {
  const context = objectOrEmpty(resolution.reframingContext ?? resolution.reframing_context);
  const originalQuestion = firstString(
    context.originalQuestion,
    context.original_question,
    resolution.originalQuestion,
  );
  const intent = firstString(context.intent, resolution.intent, "");
  const availableData = objectOrEmpty(
    context.availableData
      ?? context.available_data
      ?? resolution.answerData
      ?? resolution.answer_data
      ?? signal.verificationResult
      ?? signal.verification_result,
  );
  const miniActionMetadata = objectOrEmpty(
    availableData.miniActionMetadata
      ?? availableData.mini_action_metadata,
  );
  const responseDataReferences = normalizeMiniActionResponseReferenceList(
    context.responseDataReferences
      ?? context.response_data_references
      ?? resolution.responseDataReferences
      ?? resolution.response_data_references,
  );
  const metadataReframedVariant = buildKnownContextReframedVariant({
    originalQuestion,
    intent,
    responseDataReferences,
    miniActionMetadata,
  });
  const explicitReframedVariant = firstString(
    context.reframedVariant,
    context.reframed_variant,
  );
  const explicitStillDependsOnResponseData = responseDataReferences.some((reference) =>
    firstString(reference.text, "") && explicitReframedVariant.includes(reference.text)
  );
  const reframedVariant = explicitStillDependsOnResponseData
    ? metadataReframedVariant
    : firstString(explicitReframedVariant, metadataReframedVariant);

  return {
    originalQuestion,
    original_question: originalQuestion,
    intent,
    availableData,
    available_data: availableData,
    responseDataReferences,
    response_data_references: responseDataReferences,
    responseDataDependencyCount: responseDataReferences.length,
    response_data_dependency_count: responseDataReferences.length,
    responseDataDependenciesResolvedBy: responseDataReferences.length > 0
      ? "known_mini_action_context"
      : "mini_action_execution_evidence",
    response_data_dependencies_resolved_by: responseDataReferences.length > 0
      ? "known_mini_action_context"
      : "mini_action_execution_evidence",
    reframedVariant,
    reframed_variant: reframedVariant,
  };
}

function normalizeMiniActionResponseReferenceList(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry, index) => normalizeMiniActionResponseReference(entry, index))
    .filter(Boolean);
}

function normalizeMiniActionResponseReference(entry, index) {
  if (typeof entry === "string") {
    const text = entry.trim();
    if (!text) return null;
    return buildMiniActionResponseReference({ text, start: null, end: null, kind: "explicit" }, index);
  }
  const value = objectOrEmpty(entry);
  const text = firstString(value.text, value.reference, value.term, value.match);
  if (!text) return null;
  return buildMiniActionResponseReference({
    id: value.id,
    kind: value.kind,
    text,
    start: value.start,
    end: value.end,
    originalQuestion: value.originalQuestion ?? value.original_question,
    intent: value.intent,
    reason: value.reason,
    fallbackDataSource: value.fallbackDataSource ?? value.fallback_data_source,
    rewrittenText: value.rewrittenText ?? value.rewritten_text,
    knownContextSource: value.knownContextSource ?? value.known_context_source,
    knownContextSourceText: value.knownContextSourceText ?? value.known_context_source_text,
    resolvedBy: value.resolvedBy ?? value.resolved_by,
    requiresResponseData: value.requiresResponseData ?? value.requires_response_data,
    responseDataRequired: value.responseDataRequired ?? value.response_data_required,
    originalRequiresResponseData: value.originalRequiresResponseData ?? value.original_requires_response_data,
  }, index);
}

function buildMiniActionResponseReference({
  id = "",
  kind = "response",
  text = "",
  start = null,
  end = null,
  originalQuestion = "",
  intent = "",
  reason = "",
  fallbackDataSource = "mini_action_execution_evidence",
  rewrittenText = "",
  knownContextSource = "",
  knownContextSourceText = "",
  resolvedBy = "",
  requiresResponseData = true,
  responseDataRequired = null,
  originalRequiresResponseData = null,
} = {}, index = null) {
  const normalizedText = String(text || "").trim();
  if (!normalizedText) return null;
  const normalizedStart = Number.isFinite(Number(start)) ? Number(start) : null;
  const normalizedEnd = Number.isFinite(Number(end)) ? Number(end) : null;
  const normalizedKind = String(kind || "response").trim().toLowerCase().replace(/[\s-]+/g, "_");
  const normalizedRequiresResponseData = requiresResponseData !== false;
  const normalizedResponseDataRequired = responseDataRequired === null
    ? normalizedRequiresResponseData
    : responseDataRequired !== false;
  const generatedId = [
    "response-ref",
    normalizedKind || "response",
    normalizedStart ?? index ?? 0,
    normalizedText.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "") || "term",
  ].join("-");
  return {
    schemaVersion: MINI_ACTION_RESPONSE_REFERENCE_SCHEMA_VERSION,
    schema: "agentic30.curriculum.mini_action_response_reference.v1",
    id: firstString(id, generatedId),
    kind: normalizedKind || "response",
    text: normalizedText,
    originalQuestion: firstString(originalQuestion, ""),
    original_question: firstString(originalQuestion, ""),
    intent: firstString(intent, ""),
    start: normalizedStart,
    end: normalizedEnd,
    rewrittenText: firstString(rewrittenText, ""),
    rewritten_text: firstString(rewrittenText, ""),
    knownContextSource: firstString(knownContextSource, ""),
    known_context_source: firstString(knownContextSource, ""),
    knownContextSourceText: firstString(knownContextSourceText, ""),
    known_context_source_text: firstString(knownContextSourceText, ""),
    resolvedBy: firstString(resolvedBy, ""),
    resolved_by: firstString(resolvedBy, ""),
    originalRequiresResponseData: originalRequiresResponseData === null
      ? normalizedRequiresResponseData
      : originalRequiresResponseData === true,
    original_requires_response_data: originalRequiresResponseData === null
      ? normalizedRequiresResponseData
      : originalRequiresResponseData === true,
    requiresResponseData: normalizedRequiresResponseData,
    requires_response_data: normalizedRequiresResponseData,
    responseDataRequired: normalizedResponseDataRequired,
    response_data_required: normalizedResponseDataRequired,
    reason: firstString(
      reason,
      normalizedRequiresResponseData
        ? "original_question_reference_depends_on_mini_action_response_data"
        : "response_data_reference_rewritten_to_known_mini_action_context",
    ),
    fallbackDataSource: firstString(fallbackDataSource, "mini_action_execution_evidence"),
    fallback_data_source: firstString(fallbackDataSource, "mini_action_execution_evidence"),
  };
}

function buildMiniActionKnownContextMetadata({
  actionSpec = null,
  selectedActionTemplate = null,
  verificationResult = null,
} = {}) {
  const spec = objectOrEmpty(actionSpec);
  const template = objectOrEmpty(
    selectedActionTemplate
      ?? spec.actionTemplate
      ?? spec.action_template,
  );
  const result = objectOrEmpty(verificationResult);
  const verificationMethods = normalizeVerificationMethods(
    spec.verificationMethods
      ?? spec.verification_methods
      ?? spec.verificationMethod
      ?? spec.verification_method
      ?? result.method,
  );
  const completionSignal = firstString(spec.completionSignal, spec.completion_signal);
  const description = firstString(spec.description, spec.actionDescription, spec.action_description, spec.action);
  const templateText = firstString(template.template, spec.template);
  const method = firstString(result.method, verificationMethods[0], "manual");
  const outcome = firstString(result.outcome, result.status, "verified");
  const referenceText = firstString(
    completionSignal && `completion signal: ${completionSignal}`,
    description && `action: ${description}`,
    templateText && `template: ${templateText}`,
    `verified mini-action via ${method}`,
  );
  return {
    source: "mini_action_metadata",
    sourceText: referenceText,
    source_text: referenceText,
    referenceText,
    reference_text: referenceText,
    actionId: firstString(spec.id, spec.actionId, spec.action_id, ""),
    action_id: firstString(spec.id, spec.actionId, spec.action_id, ""),
    actionType: firstString(spec.actionType, spec.action_type, ""),
    action_type: firstString(spec.actionType, spec.action_type, ""),
    description,
    completionSignal,
    completion_signal: completionSignal,
    template: templateText,
    verificationMethods,
    verification_methods: verificationMethods,
    method,
    outcome,
  };
}

function buildKnownContextReframedVariant({
  originalQuestion = "",
  intent = "",
  responseDataReferences = [],
  miniActionMetadata = {},
} = {}) {
  const references = normalizeMiniActionResponseReferenceList(responseDataReferences);
  const metadata = objectOrEmpty(miniActionMetadata);
  const sourceText = firstString(
    metadata.referenceText,
    metadata.reference_text,
    metadata.sourceText,
    metadata.source_text,
    metadata.completionSignal,
    metadata.completion_signal,
    metadata.description,
    "방금 완료한 mini-action 증거",
  );
  if (references.length > 0) {
    return intent
      ? `${sourceText} 기준으로 ${intent}에 답해보세요. 실제 응답 데이터는 기다리지 말고 알려진 실행 증거만 사용하세요.`
      : `${sourceText} 기준으로 원래 질문의 의도에 답해보세요. 실제 응답 데이터는 기다리지 말고 알려진 실행 증거만 사용하세요.`;
  }
  return intent
    ? `${originalQuestion} 방금 실행한 증거를 기준으로 ${intent}에 답해보세요.`
    : `${originalQuestion} 방금 실행한 증거를 기준으로 답해보세요.`;
}

function buildOriginalQuestionResolutionAnswer({
  method = "manual",
  outcome = "verified",
  agentAssessment = "",
} = {}) {
  const assessment = agentAssessment ? ` ${agentAssessment}` : "";
  return `Mini-action completed via ${method} verification (${outcome}).${assessment}`.trim();
}

function normalizeDependencyRefs(sourceDay, actionSpec) {
  return normalizeStringArray(
    sourceDay.dependencyRefs
      ?? sourceDay.dependency_refs
      ?? sourceDay.dependencies
      ?? actionSpec.dependencies,
  );
}

function normalizeTrigger(trigger) {
  const value = objectOrEmpty(trigger);
  return {
    reason: stringOrDefault(value.reason, "user_reports_action_not_done"),
    coachingMode: stringOrDefault(value.coachingMode ?? value.coaching_mode, "non_blocking_mini_action"),
    actionSufficiency: stringOrDefault(value.actionSufficiency ?? value.action_sufficiency, "insufficient"),
    confidence: normalizeNumber(value.confidence, null),
    normalizedText: stringOrDefault(value.normalizedText ?? value.normalized_text, ""),
  };
}

function inferActionType({ description, completionSignal, dayGoal }) {
  const text = `${description}\n${completionSignal}\n${dayGoal}`.toLowerCase();
  if (/google\s*sheet|sheet|tracker|row|outreach/.test(text)) return "google_sheet";
  if (/google\s*doc|doc|journal|memo|script|checklist/.test(text)) return "google_doc";
  if (/landing|public\s*url|website|community|post|thread|sns|bip|proof/.test(text)) return "public_post";
  if (/demo|screen\s*recording|video|asset|record/.test(text)) return "demo_asset";
  if (/cli|build|test|command/.test(text)) return "cli_check";
  return "mini_action";
}

function inferVerificationMethod({ actionType, description, completionSignal }) {
  const text = `${actionType}\n${description}\n${completionSignal}`.toLowerCase();
  if (/google_sheet|sheet|tracker|row/.test(text)) return ["google_sheets"];
  if (/google_doc|doc|journal/.test(text)) return ["google_docs"];
  if (/landing|public_post|website|url|thread|sns|bip/.test(text)) return ["browser"];
  if (/cli|build|test|command/.test(text)) return ["cli"];
  return ["manual"];
}

function buildDefaultTemplate({ actionType, description }) {
  if (actionType === "google_sheet") return "Add one dated row with target, status, result, and next step.";
  if (actionType === "google_doc") return "Write the smallest dated note that captures the decision and evidence.";
  if (actionType === "public_post") return "Post one concise proof update with context, evidence, and next action.";
  if (actionType === "demo_asset") return "Capture one visible before-to-after result and add a short caption.";
  return description;
}

function buildUserFacingNudge(actionSpec) {
  const action = actionSpec.description || "오늘 행동을 가장 작게 실행";
  const signal = actionSpec.completionSignal
    ? ` 완료 신호는 ${actionSpec.completionSignal}입니다.`
    : "";
  return `${action}부터 10분짜리로 해보세요.${signal}`;
}

function normalizeVerificationMethods(value) {
  return normalizeStringArray(value).map(normalizeVerificationMethod).filter(Boolean);
}

function normalizeVerificationMethod(value) {
  const normalized = String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (normalized === "googledocs" || normalized === "google_doc" || normalized === "docs") return "google_docs";
  if (normalized === "googlesheets" || normalized === "google_sheet" || normalized === "sheets") return "google_sheets";
  if (["mcp", "cli", "browser", "manual"].includes(normalized)) return normalized;
  if (normalized === "evidence_link" || normalized === "link") return "evidence_link";
  if (normalized === "evidence_file" || normalized === "file") return "evidence_file";
  return normalized;
}

function normalizeActionType(value) {
  return String(value || "mini_action").trim().toLowerCase().replace(/[\s-]+/g, "_") || "mini_action";
}

function normalizeDayType(value) {
  const normalized = String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  return Object.values(CURRICULUM_DAY_TYPES).includes(normalized)
    ? normalized
    : CURRICULUM_DAY_TYPES.action;
}

function normalizeLearnerActionState(value) {
  const state = objectOrEmpty(value);
  const adaptive = objectOrEmpty(
    state.adaptiveDifficultyState
      ?? state.adaptive_difficulty_state
      ?? state.difficulty,
  );
  const pace = objectOrEmpty(state.paceMetrics ?? state.pace_metrics);
  const carryOverQueue = Array.isArray(state.carryOverQueue)
    ? state.carryOverQueue
    : Array.isArray(state.carry_over_queue)
      ? state.carry_over_queue
      : [];
  const incompleteCount = normalizeNumber(
    state.incompleteActionCount
      ?? state.incomplete_action_count
      ?? state.accumulatedIncompletions
      ?? state.accumulated_incompletions
      ?? adaptive.incompleteActionCount
      ?? adaptive.incomplete_action_count
      ?? carryOverQueue.length,
    0,
  );
  const trigger = stringOrDefault(
    adaptive.trigger
      ?? state.trigger
      ?? state.adaptiveTrigger
      ?? state.adaptive_trigger,
    "",
  );
  const direction = stringOrDefault(
    adaptive.direction
      ?? state.difficultyDirection
      ?? state.difficulty_direction,
    "",
  );
  const daysElapsed = normalizeNumber(pace.daysElapsed ?? pace.days_elapsed, null);
  const completedDayCount = normalizeNumber(
    state.completedDayCount ?? state.completed_day_count ?? state.completedDays ?? state.completed_days,
    null,
  );
  const isRushing = Boolean(
    state.rushing
      ?? state.rushDetected
      ?? state.rush_detected
      ?? trigger === "rushing"
      ?? trigger === "rush_detection"
      ?? direction === "up",
  ) || (
    completedDayCount !== null
      && daysElapsed !== null
      && completedDayCount >= 2
      && completedDayCount > Math.max(1, daysElapsed + 1)
  );
  const hasIncompleteAccumulation = Boolean(
    state.hasIncompleteAccumulation
      ?? state.has_incomplete_accumulation
      ?? trigger === "incomplete_accumulation"
      ?? direction === "down",
  ) || incompleteCount >= 2 || carryOverQueue.length >= 2;

  return {
    isRushing,
    hasIncompleteAccumulation,
    incompleteCount,
    carryOverCount: carryOverQueue.length,
    trigger: trigger || (isRushing ? "rushing" : hasIncompleteAccumulation ? "incomplete_accumulation" : "none"),
    difficultyDirection: direction || (isRushing ? "up" : hasIncompleteAccumulation ? "down" : "steady"),
  };
}

function normalizeMiniActionExecutionResult(value) {
  const source = objectOrEmpty(value);
  if (Object.keys(source).length === 0) return null;
  const status = String(source.status || source.outcome || source.result || "").trim().toLowerCase();
  const passed = typeof source.passed === "boolean"
    ? source.passed
    : ["passed", "pass", "verified", "success", "succeeded", "ok", "completed"].includes(status)
      ? true
      : ["failed", "fail", "insufficient", "rejected", "error"].includes(status)
        ? false
        : null;
  if (passed === null) return null;
  return {
    method: firstString(source.method, source.verificationMethod, source.verification_method, source.tool, "manual"),
    passed,
    outcome: firstString(source.outcome, source.status, passed ? "verified" : "failed"),
    confidence: normalizeNumber(source.confidence, passed ? 1 : 0),
    reason: firstString(source.reason, source.error, source.message, ""),
    agentAssessment: firstString(source.agentAssessment, source.agent_assessment, source.assessment, ""),
    raw: objectOrEmpty(source.raw),
    completedAt: firstString(source.completedAt, source.completed_at, ""),
    completed_at: firstString(source.completedAt, source.completed_at, ""),
  };
}

function extractMiniActionCompletionResult(event) {
  const source = objectOrEmpty(event);
  const payload = objectOrEmpty(source.payload);
  const data = objectOrEmpty(source.data);
  const candidates = [
    source.actionExecutionResult,
    source.action_execution_result,
    source.verificationResult,
    source.verification_result,
    source.result,
    payload.actionExecutionResult,
    payload.action_execution_result,
    payload.verificationResult,
    payload.verification_result,
    payload.result,
    data.actionExecutionResult,
    data.action_execution_result,
    data.verificationResult,
    data.verification_result,
    data.result,
    source,
  ];

  for (const candidate of candidates) {
    const result = normalizeMiniActionExecutionResult(candidate);
    if (result) return result;
  }
  return null;
}

function isProviderRunCompletionEvent(event) {
  const source = objectOrEmpty(event);
  const type = String(source.eventType || source.event_type || source.type || "").trim();
  const phase = String(source.phase || "").trim();
  return type === "run.completed" || phase === "provider.codex.turn_completed" || phase === "completed";
}

function normalizeDayId(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 1;
  return Math.min(30, Math.max(1, Math.trunc(n)));
}

function normalizeOptionalMiniActionDayId(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const day = Math.trunc(n);
  return day >= 1 && day <= 30 ? day : null;
}

function normalizePositiveInteger(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.trunc(n);
}

function normalizeNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeStringArray(value) {
  const values = Array.isArray(value) ? value : [value];
  return values
    .flatMap((entry) => Array.isArray(entry) ? entry : [entry])
    .map((entry) => String(entry ?? "").trim())
    .filter(Boolean);
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value !== "string" && typeof value !== "number") continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return "";
}

function stringOrDefault(value, fallback) {
  const text = typeof value === "string" || typeof value === "number"
    ? String(value).trim()
    : "";
  return text || fallback;
}

function objectOrEmpty(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function toIso(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString();
}
