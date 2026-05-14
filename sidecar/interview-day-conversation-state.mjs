/**
 * Interview-day conversation state machine.
 *
 * Pure state module: no filesystem, provider, network, or UI side effects.
 * The Mac app can render `currentPrompt` with the existing interview card
 * contract while the sidecar keeps the day cursor and real curriculum answers.
 */

import {
  advanceInterviewDayQuestion,
  renderInterviewDayQuestionCard,
} from "./interview-day-card.mjs";

export const INTERVIEW_DAY_CONVERSATION_STATE_SCHEMA_VERSION = 1;

export const INTERVIEW_DAY_CONVERSATION_STATUS = Object.freeze({
  active: "active",
  completed: "completed",
});

const DEFAULT_GOAL = "실제 고객의 과거 행동을 구체적으로 확인한다";
const DEFAULT_INTENT = "가정이 아니라 관찰 가능한 행동과 맥락을 확보한다.";

export function createInitialInterviewDayConversationState({
  daySpec = {},
  requestId = null,
  sessionId = null,
  now = () => new Date(),
} = {}) {
  const normalizedDay = normalizeDaySpec(daySpec);
  const timestamp = nowIso(now);
  const currentPrompt = renderInterviewDayQuestionCard({
    daySpec: normalizedDay.rawForCard,
    questionIndex: 0,
    totalQuestions: normalizedDay.questions.length,
    requestId,
    sessionId,
    now: new Date(timestamp),
  });

  return {
    schemaVersion: INTERVIEW_DAY_CONVERSATION_STATE_SCHEMA_VERSION,
    dayId: normalizedDay.dayId,
    dayType: "interview",
    dayGoal: normalizedDay.goal,
    status: INTERVIEW_DAY_CONVERSATION_STATUS.active,
    startedAt: timestamp,
    updatedAt: timestamp,
    completedAt: null,
    currentQuestionIndex: 0,
    totalQuestions: normalizedDay.questions.length,
    completedQuestionCount: 0,
    allQuestionsAnswered: false,
    completionConfirmed: false,
    structuredDaySpec: normalizedDay.structuredDaySpec,
    questionRecords: normalizedDay.questions.map((question, index) => ({
      questionId: question.questionId || `day${normalizedDay.dayId}-question-${index + 1}`,
      questionIndex: index,
      question: question.text,
      intent: question.intent,
      status: "pending",
      answerText: null,
      selectedOptions: [],
      answeredAt: null,
    })),
    currentPrompt,
  };
}

export function ensureInterviewDayConversationState(input, {
  daySpec = {},
  requestId = null,
  sessionId = null,
  now = () => new Date(),
} = {}) {
  if (!input || typeof input !== "object") {
    return createInitialInterviewDayConversationState({ daySpec, requestId, sessionId, now });
  }

  const fallback = normalizeDaySpec(daySpec);
  const dayId = normalizeDayId(input.dayId ?? input.day_id ?? fallback.dayId);
  const dayGoal = stringOrDefault(input.dayGoal ?? input.day_goal ?? fallback.goal, fallback.goal);
  const questionRecords = normalizeQuestionRecords(input.questionRecords ?? input.question_records, {
    fallbackQuestions: fallback.questions,
    dayId,
  });
  const answeredCount = questionRecords.filter((record) => record.status === "answered").length;
  const totalQuestions = Math.max(1, normalizePositiveInteger(input.totalQuestions ?? input.total_questions, questionRecords.length));
  const allQuestionsAnswered = answeredCount >= totalQuestions || input.allQuestionsAnswered === true;
  const currentQuestionIndex = allQuestionsAnswered
    ? Math.max(0, Math.min(totalQuestions - 1, normalizeIndex(input.currentQuestionIndex ?? input.current_question_index)))
    : resolveCurrentQuestionIndex(input.currentQuestionIndex ?? input.current_question_index, questionRecords);
  const status = allQuestionsAnswered
    ? INTERVIEW_DAY_CONVERSATION_STATUS.completed
    : INTERVIEW_DAY_CONVERSATION_STATUS.active;
  const startedAt = normalizeIsoString(input.startedAt ?? input.started_at) || nowIso(now);
  const updatedAt = normalizeIsoString(input.updatedAt ?? input.updated_at) || startedAt;
  const completedAt = status === INTERVIEW_DAY_CONVERSATION_STATUS.completed
    ? (normalizeIsoString(input.completedAt ?? input.completed_at) || updatedAt)
    : null;
  const rawForCard = buildCardDaySpec({
    dayId,
    title: input.structuredDaySpec?.title ?? fallback.structuredDaySpec.title,
    goal: dayGoal,
    questions: questionRecords.map((record) => ({
      id: record.questionId,
      question: record.question,
      intent: record.intent,
    })),
    action: input.structuredDaySpec?.actionSpec ?? fallback.structuredDaySpec.actionSpec,
    dependencies: input.structuredDaySpec?.dependencyMap ?? fallback.structuredDaySpec.dependencyMap,
  });

  return {
    schemaVersion: INTERVIEW_DAY_CONVERSATION_STATE_SCHEMA_VERSION,
    dayId,
    dayType: "interview",
    dayGoal,
    status,
    startedAt,
    updatedAt,
    completedAt,
    currentQuestionIndex,
    totalQuestions,
    completedQuestionCount: answeredCount,
    allQuestionsAnswered,
    completionConfirmed: input.completionConfirmed === true,
    structuredDaySpec: {
      dayId,
      dayType: "interview",
      title: stringOrDefault(input.structuredDaySpec?.title, fallback.structuredDaySpec.title),
      dayGoal,
      keyQuestionsWithIntent: questionRecords.map((record) => ({
        questionId: record.questionId,
        question: record.question,
        intent: record.intent,
      })),
      actionSpec: normalizeAction(input.structuredDaySpec?.actionSpec ?? fallback.structuredDaySpec.actionSpec),
      dependencyMap: normalizeDependencies(input.structuredDaySpec?.dependencyMap ?? fallback.structuredDaySpec.dependencyMap),
    },
    questionRecords,
    currentPrompt: allQuestionsAnswered
      ? null
      : renderInterviewDayQuestionCard({
          daySpec: rawForCard,
          questionIndex: currentQuestionIndex,
          totalQuestions,
          requestId,
          sessionId,
          now: new Date(updatedAt),
        }),
  };
}

export function getCurrentInterviewDayPrompt(inputState, options = {}) {
  return ensureInterviewDayConversationState(inputState, options).currentPrompt;
}

export function advanceInterviewDayConversationState(
  inputState,
  {
    answer = {},
    requestId = null,
    sessionId = null,
    now = () => new Date(),
  } = {},
) {
  const state = ensureInterviewDayConversationState(inputState, { requestId, sessionId, now });
  if (state.allQuestionsAnswered) {
    return {
      advanced: false,
      validationError: null,
      reason: "already_complete",
      state,
    };
  }

  const timestamp = nowIso(now);
  const daySpec = buildCardDaySpec({
    dayId: state.dayId,
    title: state.structuredDaySpec.title,
    goal: state.dayGoal,
    questions: state.questionRecords.map((record) => ({
      id: record.questionId,
      question: record.question,
      intent: record.intent,
    })),
    action: state.structuredDaySpec.actionSpec,
    dependencies: state.structuredDaySpec.dependencyMap,
  });
  const progress = {
    dayId: state.dayId,
    dayType: "interview",
    dayGoal: state.dayGoal,
    totalQuestions: state.totalQuestions,
    currentQuestionIndex: state.currentQuestionIndex,
    answeredQuestions: state.questionRecords
      .filter((record) => record.status === "answered")
      .map((record) => ({
        questionIndex: record.questionIndex,
        questionText: record.question,
        intent: record.intent,
        answerText: record.answerText,
        selectedOptions: record.selectedOptions,
        answeredAt: record.answeredAt,
      })),
    completionConfirmed: state.completionConfirmed,
  };

  const result = advanceInterviewDayQuestion({
    daySpec,
    progress,
    answer,
    questionIndex: state.currentQuestionIndex,
    requestId,
    sessionId,
    now: new Date(timestamp),
  });

  if (!result.didAdvance) {
    return {
      advanced: false,
      validationError: result.validationError,
      reason: "validation_error",
      state: {
        ...state,
        updatedAt: timestamp,
        currentPrompt: result.nextCard,
      },
    };
  }

  const answeredByIndex = new Map(
    result.progress.answeredQuestions.map((record) => [record.questionIndex, record]),
  );
  const questionRecords = state.questionRecords.map((record) => {
    const answered = answeredByIndex.get(record.questionIndex);
    if (!answered) return record;
    return {
      ...record,
      status: "answered",
      answerText: answered.answerText,
      selectedOptions: answered.selectedOptions,
      answeredAt: answered.answeredAt,
    };
  });
  const completed = result.progress.allQuestionsAnswered === true;
  const nextState = {
    ...state,
    status: completed
      ? INTERVIEW_DAY_CONVERSATION_STATUS.completed
      : INTERVIEW_DAY_CONVERSATION_STATUS.active,
    updatedAt: timestamp,
    completedAt: completed ? timestamp : null,
    currentQuestionIndex: result.progress.currentQuestionIndex,
    completedQuestionCount: result.progress.completedQuestionCount,
    allQuestionsAnswered: completed,
    questionRecords,
    currentPrompt: result.nextCard,
  };

  return {
    advanced: true,
    validationError: null,
    reason: null,
    state: nextState,
  };
}

function normalizeDaySpec(daySpec) {
  const raw = objectOrEmpty(daySpec);
  const dayId = normalizeDayId(raw.day_id ?? raw.dayId ?? raw.day);
  const title = stringOrDefault(raw.title ?? raw.day_title ?? raw.dayTitle, "Interview Day");
  const goal = stringOrDefault(raw.day_goal ?? raw.dayGoal ?? raw.goal, DEFAULT_GOAL);
  const questions = normalizeQuestions(
    raw.key_questions_with_intent
      ?? raw.keyQuestionsWithIntent
      ?? raw.key_questions
      ?? raw.keyQuestions
      ?? raw.questions,
    dayId,
  );
  const actionSpec = normalizeAction(raw.action_spec ?? raw.actionSpec ?? raw.action);
  const dependencyMap = normalizeDependencies(raw.dependency_map ?? raw.dependencyMap ?? raw.dependencies);
  const structuredDaySpec = {
    dayId,
    dayType: "interview",
    title,
    dayGoal: goal,
    keyQuestionsWithIntent: questions.map((question, index) => ({
      questionId: question.questionId || `day${dayId}-question-${index + 1}`,
      question: question.text,
      intent: question.intent,
    })),
    actionSpec,
    dependencyMap,
  };

  return {
    dayId,
    title,
    goal,
    questions,
    structuredDaySpec,
    rawForCard: buildCardDaySpec({
      dayId,
      title,
      goal,
      questions: structuredDaySpec.keyQuestionsWithIntent,
      action: actionSpec,
      dependencies: dependencyMap,
    }),
  };
}

function normalizeQuestions(value, dayId) {
  const source = Array.isArray(value) ? value : [];
  const normalized = source.map((entry, index) => normalizeQuestion(entry, dayId, index)).filter((entry) => entry.text);
  if (normalized.length) return normalized;
  return [{
    questionId: `day${dayId}-question-1`,
    text: "오늘 확인할 고객의 실제 행동은 무엇인가요?",
    intent: DEFAULT_INTENT,
  }];
}

function normalizeQuestion(value, dayId, index) {
  if (typeof value === "string") {
    return {
      questionId: `day${dayId}-question-${index + 1}`,
      text: value.trim(),
      intent: DEFAULT_INTENT,
    };
  }
  const raw = objectOrEmpty(value);
  return {
    questionId: stringOrDefault(raw.questionId ?? raw.question_id ?? raw.id, `day${dayId}-question-${index + 1}`),
    text: stringOrDefault(raw.question ?? raw.text ?? raw.prompt, ""),
    intent: stringOrDefault(raw.intent ?? raw.intent_description ?? raw.intentDescription, DEFAULT_INTENT),
  };
}

function normalizeQuestionRecords(value, { fallbackQuestions, dayId }) {
  const source = Array.isArray(value) && value.length
    ? value
    : fallbackQuestions.map((question, index) => ({
        questionId: question.questionId,
        questionIndex: index,
        question: question.text,
        intent: question.intent,
      }));
  return source.map((entry, index) => {
    const raw = objectOrEmpty(entry);
    const answerText = normalizeNullableString(raw.answerText ?? raw.answer_text ?? raw.answer);
    const answeredAt = normalizeIsoString(raw.answeredAt ?? raw.answered_at);
    const status = raw.status === "answered" || answerText ? "answered" : "pending";
    return {
      questionId: stringOrDefault(raw.questionId ?? raw.question_id ?? raw.id, `day${dayId}-question-${index + 1}`),
      questionIndex: normalizeIndex(raw.questionIndex ?? raw.question_index ?? index),
      question: stringOrDefault(raw.question ?? raw.questionText ?? raw.question_text ?? raw.text, fallbackQuestions[index]?.text ?? ""),
      intent: stringOrDefault(raw.intent, fallbackQuestions[index]?.intent ?? DEFAULT_INTENT),
      status,
      answerText,
      selectedOptions: normalizeStringArray(raw.selectedOptions ?? raw.selected_options),
      answeredAt: status === "answered" ? answeredAt : null,
    };
  }).filter((entry) => entry.question);
}

function buildCardDaySpec({ dayId, title, goal, questions, action, dependencies }) {
  return {
    day_id: dayId,
    title,
    day_goal: goal,
    key_questions_with_intent: questions.map((question) => ({
      id: question.questionId ?? question.id,
      question: question.question ?? question.text,
      intent: question.intent,
    })),
    action_spec: normalizeAction(action),
    dependency_map: normalizeDependencies(dependencies),
  };
}

function resolveCurrentQuestionIndex(value, questionRecords) {
  const explicit = Number(value);
  if (Number.isFinite(explicit)) return Math.min(Math.max(0, Math.trunc(explicit)), Math.max(0, questionRecords.length - 1));
  const pending = questionRecords.find((record) => record.status !== "answered");
  return pending ? pending.questionIndex : Math.max(0, questionRecords.length - 1);
}

function normalizeAction(value) {
  const raw = objectOrEmpty(value);
  return {
    description: stringOrDefault(raw.description ?? raw.task, ""),
    completionSignal: stringOrDefault(raw.completionSignal ?? raw.completion_signal, ""),
  };
}

function normalizeDependencies(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (typeof entry === "string") return entry.trim();
      const raw = objectOrEmpty(entry);
      return stringOrDefault(raw.ref ?? raw.day_id ?? raw.dayId ?? raw.description, "");
    })
    .filter(Boolean);
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => String(entry ?? "").trim()).filter(Boolean);
}

function normalizeIsoString(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function normalizeNullableString(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

function normalizeIndex(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.trunc(n));
}

function normalizePositiveInteger(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return Math.max(1, fallback);
  return Math.trunc(n);
}

function normalizeDayId(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 1;
  return Math.min(30, Math.max(1, Math.trunc(n)));
}

function objectOrEmpty(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function stringOrDefault(value, fallback) {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function nowIso(now) {
  const value = typeof now === "function" ? now() : now;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : new Date().toISOString();
}
