import {
  CURRICULUM_DAY_TYPES,
  CURRICULUM_PROGRESS_EVENT_TYPES,
  applyCurriculumProgressEvent,
} from "./adaptive-curriculum.mjs";

export const DAY1_TUTORIAL_INTERACTION_TYPES = Object.freeze({
  coachMarkDisplayed: "coach_mark_displayed",
  coachMarkDismissed: "coach_mark_dismissed",
  coachMarkNavigation: "coach_mark_navigation",
  overlaySkipped: "overlay_skipped",
  promptViewed: "prompt_viewed",
});

const DAY1_TUTORIAL_INTERACTION_EVENT_PREFIX = "day1_tutorial";
const NON_COMPLETION_INTERACTION_TYPES = new Set(Object.values(DAY1_TUTORIAL_INTERACTION_TYPES));

export function handleDay1TutorialInteraction({
  state = {},
  interaction = {},
  now = new Date(),
} = {}) {
  const normalizedInteraction = normalizeDay1TutorialInteraction(interaction, now);
  if (!normalizedInteraction.type) {
    const unchanged = applyCurriculumProgressEvent(state, {}, { now });
    return {
      accepted: false,
      reason: "unsupported_day1_tutorial_interaction",
      interaction: normalizedInteraction,
      progressEvent: null,
      state: unchanged,
      didPersistDayCompletion: getDay1CompletionConfirmed(unchanged),
    };
  }

  const progressEvent = buildNonCompletionProgressEvent(normalizedInteraction);
  const nextState = applyCurriculumProgressEvent(state, progressEvent, {
    now: normalizedInteraction.occurredAt,
  });

  return {
    accepted: true,
    reason: "day1_tutorial_interaction_recorded",
    interaction: normalizedInteraction,
    progressEvent,
    state: nextState,
    didPersistDayCompletion: getDay1CompletionConfirmed(nextState),
  };
}

export function normalizeDay1TutorialInteraction(interaction = {}, now = new Date()) {
  const raw = objectOrEmpty(interaction);
  const type = normalizeInteractionType(raw.type ?? raw.eventType ?? raw.event_type);
  const occurredAt = toIso(raw.occurredAt ?? raw.occurred_at ?? now);
  return {
    type,
    day: 1,
    dayType: CURRICULUM_DAY_TYPES.interview,
    occurredAt,
    stepId: stringOrDefault(raw.stepId ?? raw.step_id ?? raw.coachMarkId ?? raw.coach_mark_id, ""),
    targetElementId: stringOrDefault(raw.targetElementId ?? raw.target_element_id, ""),
    fromStepId: stringOrDefault(raw.fromStepId ?? raw.from_step_id, ""),
    toStepId: stringOrDefault(raw.toStepId ?? raw.to_step_id, ""),
    promptId: stringOrDefault(raw.promptId ?? raw.prompt_id, ""),
    questionRecords: normalizeQuestionRecordList(
      raw.questionRecords
        ?? raw.question_records
        ?? raw.interviewQuestionRecords
        ?? raw.interview_question_records
        ?? raw.questions,
    ),
  };
}

function buildNonCompletionProgressEvent(interaction) {
  const progressEventType = interaction.type === DAY1_TUTORIAL_INTERACTION_TYPES.overlaySkipped
    ? CURRICULUM_PROGRESS_EVENT_TYPES.day1TutorialSkipped
    : `${DAY1_TUTORIAL_INTERACTION_EVENT_PREFIX}_${interaction.type}`;
  return {
    type: progressEventType,
    day: 1,
    dayType: CURRICULUM_DAY_TYPES.interview,
    occurredAt: interaction.occurredAt,
    completed: false,
    completionConfirmed: false,
    completion_confirmed: false,
    metadata: {
      interactionType: interaction.type,
      stepId: interaction.stepId,
      targetElementId: interaction.targetElementId,
      fromStepId: interaction.fromStepId,
      toStepId: interaction.toStepId,
      promptId: interaction.promptId,
    },
    ...(interaction.questionRecords.length
      ? {
          questionRecords: interaction.questionRecords,
          question_records: interaction.questionRecords,
        }
      : {}),
  };
}

function getDay1CompletionConfirmed(state) {
  const records = Array.isArray(state?.dayRecords) ? state.dayRecords : [];
  return records.some((record) => record?.day === 1 && record?.completionConfirmed === true);
}

function normalizeInteractionType(value) {
  const normalized = String(value || "")
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  return NON_COMPLETION_INTERACTION_TYPES.has(normalized) ? normalized : "";
}

function objectOrEmpty(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizeQuestionRecordList(value) {
  return Array.isArray(value)
    ? value.map((entry) => objectOrEmpty(entry)).filter((entry) => Object.keys(entry).length)
    : [];
}

function stringOrDefault(value, fallback) {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function toIso(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : new Date().toISOString();
}
