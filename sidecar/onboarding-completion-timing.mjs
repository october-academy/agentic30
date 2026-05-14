export const ONBOARDING_COMPLETION_TIMEBOX_SECONDS = 120;

export const ONBOARDING_CONTEXT_QUESTION_IDS = Object.freeze([
  "business_description",
  "current_stage",
  "goal",
]);

export const ONBOARDING_COMPLETION_TIMING_STEPS = Object.freeze([
  Object.freeze({ id: "intro_welcome", kind: "program_intro", estimatedSeconds: 8 }),
  Object.freeze({ id: "intro_assistant", kind: "program_intro", estimatedSeconds: 8 }),
  Object.freeze({ id: "business_description", kind: "context_question", estimatedSeconds: 24 }),
  Object.freeze({ id: "current_stage", kind: "context_question", estimatedSeconds: 24 }),
  Object.freeze({ id: "goal", kind: "context_question", estimatedSeconds: 24 }),
  Object.freeze({ id: "submit_context", kind: "completion", estimatedSeconds: 6 }),
]);

export function buildOnboardingCompletionTimingReport({
  steps = ONBOARDING_COMPLETION_TIMING_STEPS,
  maximumSeconds = ONBOARDING_COMPLETION_TIMEBOX_SECONDS,
} = {}) {
  const normalizedSteps = Array.isArray(steps) ? steps.filter(Boolean) : [];
  const contextQuestionIds = normalizedSteps
    .filter((step) => step.kind === "context_question")
    .map((step) => String(step.id || "").trim())
    .filter(Boolean);
  const estimatedSeconds = normalizedSteps.reduce((total, step) =>
    total + Math.max(0, Number(step.estimatedSeconds) || 0), 0);

  return {
    introSceneCount: normalizedSteps.filter((step) => step.kind === "program_intro").length,
    contextQuestionIds,
    estimatedSeconds,
    maximumSeconds,
    remainingSeconds: maximumSeconds - estimatedSeconds,
    canCompleteWithinBudget: estimatedSeconds <= maximumSeconds,
  };
}

export function verifyMeasuredOnboardingCompletion({
  startedAt,
  completedAt,
  introViewed,
  answeredQuestionIds = [],
  maximumSeconds = ONBOARDING_COMPLETION_TIMEBOX_SECONDS,
} = {}) {
  const started = timestampMs(startedAt);
  const completed = timestampMs(completedAt);
  const elapsedSeconds = Math.max(0, (completed - started) / 1000);
  const answered = new Set(
    (Array.isArray(answeredQuestionIds) ? answeredQuestionIds : [])
      .map(normalizeQuestionId)
      .filter(Boolean),
  );
  const missingQuestionIds = ONBOARDING_CONTEXT_QUESTION_IDS.filter((id) => !answered.has(id));
  const isWithinBudget = elapsedSeconds <= maximumSeconds;
  const hasRequiredQuestions = missingQuestionIds.length === 0;

  return {
    introViewed: Boolean(introViewed),
    answeredQuestionIds: ONBOARDING_CONTEXT_QUESTION_IDS.filter((id) => answered.has(id)),
    missingQuestionIds,
    elapsedSeconds,
    maximumSeconds,
    isWithinBudget,
    hasRequiredQuestions,
    isComplete: Boolean(introViewed) && hasRequiredQuestions && isWithinBudget,
  };
}

function normalizeQuestionId(value) {
  const id = String(value || "").trim();
  if (id === "onboardingContext.businessDescription") return "business_description";
  if (id === "onboardingContext.currentStage") return "current_stage";
  if (id === "onboardingContext.goal") return "goal";
  return id;
}

function timestampMs(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : 0;
}
