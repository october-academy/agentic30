export const INTERVIEW_DAY_CARD_SCHEMA_VERSION = 1;

const DEFAULT_TITLE = "Interview Day";
const DEFAULT_GOAL = "실제 고객의 과거 행동을 구체적으로 확인한다";
const DEFAULT_INTENT = "가정이 아니라 관찰 가능한 행동과 맥락을 확보한다.";

/**
 * Build the host-renderable card payload for an Interview curriculum question.
 * The nested `structuredPrompt` shape mirrors the existing sidecar
 * StructuredPromptRequest contract so the Mac chat surface can render it as a
 * card conversation without a separate UI protocol.
 */
export function renderInterviewDayQuestionCard({
  daySpec = {},
  question = null,
  questionIndex = 0,
  totalQuestions = null,
  requestId = null,
  sessionId = null,
  now = new Date(),
} = {}) {
  const normalizedDay = normalizeDaySpec(daySpec);
  const normalizedQuestion = normalizeQuestion(question ?? normalizedDay.questions[questionIndex]);
  const safeIndex = normalizeIndex(questionIndex);
  const safeTotal = normalizeTotal(totalQuestions, normalizedDay.questions.length, safeIndex);
  const header = `Q ${safeIndex + 1}/${safeTotal}`;
  const promptText = buildPromptText({
    dayId: normalizedDay.dayId,
    goal: normalizedDay.goal,
    questionText: normalizedQuestion.text,
  });

  const structuredQuestion = {
    questionId: normalizedQuestion.questionId || `day${normalizedDay.dayId}-question-${safeIndex + 1}`,
    header,
    question: promptText,
    helperText: buildHelperText(normalizedQuestion.intent),
    allowFreeText: true,
    requiresFreeText: true,
    freeTextPlaceholder: "한 사람의 실제 상황, 어제 한 행동, 현재 대안을 짧게 적어보세요.",
    textMode: "long",
  };

  return {
    schemaVersion: INTERVIEW_DAY_CARD_SCHEMA_VERSION,
    cardType: "curriculum_interview_question_card",
    dayId: normalizedDay.dayId,
    dayType: "interview",
    dayGoal: normalizedDay.goal,
    questionIndex: safeIndex,
    totalQuestions: safeTotal,
    promptText,
    intent: normalizedQuestion.intent,
    action: normalizedDay.action,
    dependencies: normalizedDay.dependencies,
    createdAt: toIso(now),
    card: {
      layout: "interview_card_conversation",
      tone: "friendly_senior",
      blocks: [
        {
          role: "assistant",
          kind: "prompt",
          text: promptText,
        },
        {
          role: "assistant",
          kind: "intent",
          text: normalizedQuestion.intent,
        },
        {
          role: "user",
          kind: "answer",
          input: {
            type: "long_text",
            required: true,
          },
        },
      ],
    },
    structuredPrompt: {
      requestId: requestId || null,
      sessionId: sessionId || null,
      toolName: "agentic30_curriculum_interview",
      title: `Day ${normalizedDay.dayId} Interview`,
      createdAt: toIso(now),
      intro: {
        title: normalizedDay.title,
        body: normalizedDay.goal,
        bullets: [
          "추측보다 실제 행동을 우선해보세요.",
          "짧아도 구체적인 한 사람의 사례가 좋습니다.",
        ],
      },
      questions: [structuredQuestion],
      generation: {
        mode: "curriculum_interview_renderer",
        docType: "curriculum_day",
      },
    },
  };
}

export function renderUnguidedInterviewDayQuestionSet({
  daySpec = {},
  questionRecords = null,
  requestId = null,
  sessionId = null,
  now = new Date(),
} = {}) {
  const normalizedDay = normalizeDaySpec(daySpec);
  const questions = normalizeUnguidedQuestionRecords(questionRecords, normalizedDay);
  const safeTotal = normalizeTotal(null, questions.length, 0);
  const structuredQuestions = questions.map((question, index) => {
    const questionIndex = normalizeIndex(question.questionIndex ?? index);
    const promptText = buildPromptText({
      dayId: normalizedDay.dayId,
      goal: normalizedDay.goal,
      questionText: question.text,
    });
    return {
      questionId: question.questionId || `day${normalizedDay.dayId}-question-${questionIndex + 1}`,
      header: `Q ${questionIndex + 1}/${safeTotal}`,
      question: promptText,
      helperText: buildHelperText(question.intent),
      allowFreeText: true,
      requiresFreeText: true,
      freeTextPlaceholder: "한 사람의 실제 상황, 어제 한 행동, 현재 대안을 짧게 적어보세요.",
      textMode: "long",
    };
  });
  const originalQuestionTexts = normalizedDay.questions.map((question) => question.text);
  const renderedQuestionTexts = questions.map((question) => question.text);
  const rendersCompleteOriginalQuestionSet = arraysEqual(originalQuestionTexts, renderedQuestionTexts);

  return {
    schemaVersion: INTERVIEW_DAY_CARD_SCHEMA_VERSION,
    cardType: "curriculum_interview_unguided_question_set",
    dayId: normalizedDay.dayId,
    dayType: "interview",
    dayGoal: normalizedDay.goal,
    totalQuestions: safeTotal,
    renderedQuestionCount: structuredQuestions.length,
    exposedOriginalQuestionCount: renderedQuestionTexts.length,
    rendersCompleteOriginalQuestionSet,
    renders_complete_original_question_set: rendersCompleteOriginalQuestionSet,
    action: normalizedDay.action,
    dependencies: normalizedDay.dependencies,
    createdAt: toIso(now),
    card: {
      layout: "interview_card_conversation",
      tone: "friendly_senior",
      blocks: questions.flatMap((question, index) => {
        const promptText = structuredQuestions[index]?.question ?? question.text;
        return [
          {
            role: "assistant",
            kind: "prompt",
            text: promptText,
          },
          {
            role: "assistant",
            kind: "intent",
            text: question.intent,
          },
          {
            role: "user",
            kind: "answer",
            input: {
              type: "long_text",
              required: true,
            },
          },
        ];
      }),
    },
    structuredPrompt: {
      requestId: requestId || null,
      sessionId: sessionId || null,
      toolName: "agentic30_curriculum_interview",
      title: `Day ${normalizedDay.dayId} Interview`,
      createdAt: toIso(now),
      intro: {
        title: normalizedDay.title,
        body: normalizedDay.goal,
        bullets: [
          "오버레이만 꺼졌고, Day 1 질문은 모두 그대로 남아 있습니다.",
          "각 답은 이후 Review와 적응형 코칭에 그대로 쓰입니다.",
        ],
      },
      questions: structuredQuestions,
      generation: {
        mode: "curriculum_interview_unguided_renderer",
        docType: "curriculum_day",
      },
    },
  };
}

export function advanceInterviewDayQuestion({
  daySpec = {},
  progress = {},
  answer = {},
  questionIndex = null,
  requestId = null,
  sessionId = null,
  now = new Date(),
} = {}) {
  const normalizedDay = normalizeDaySpec(daySpec);
  const normalizedProgress = normalizeInterviewProgress(progress, normalizedDay);
  const currentIndex = normalizeProgressQuestionIndex(
    questionIndex,
    normalizedProgress,
    normalizedDay.questions.length,
  );
  const normalizedQuestion = normalizeQuestion(normalizedDay.questions[currentIndex]);
  const normalizedAnswer = normalizeInterviewAnswer(answer);

  if (!normalizedAnswer.isValid) {
    return {
      didAdvance: false,
      validationError: "Interview day answers require a non-empty free-text response.",
      progress: normalizedProgress,
      nextCard: renderInterviewDayQuestionCard({
        daySpec: normalizedDay,
        question: normalizedQuestion,
        questionIndex: currentIndex,
        totalQuestions: normalizedDay.questions.length,
        requestId,
        sessionId,
        now,
      }),
    };
  }

  const answeredAt = toIso(now);
  const answeredQuestions = upsertAnsweredQuestion(normalizedProgress.answeredQuestions, {
    questionIndex: currentIndex,
    questionText: normalizedQuestion.text,
    intent: normalizedQuestion.intent,
    answerText: normalizedAnswer.answerText,
    selectedOptions: normalizedAnswer.selectedOptions,
    answeredAt,
  });
  const nextIndex = currentIndex + 1;
  const isComplete = nextIndex >= normalizedDay.questions.length;
  const nextProgress = {
    ...normalizedProgress,
    dayId: normalizedDay.dayId,
    dayType: "interview",
    dayGoal: normalizedDay.goal,
    totalQuestions: normalizedDay.questions.length,
    currentQuestionIndex: isComplete ? currentIndex : nextIndex,
    answeredQuestions,
    completedQuestionCount: answeredQuestions.length,
    allQuestionsAnswered: isComplete,
    completionConfirmed: normalizedProgress.completionConfirmed === true,
    updatedAt: answeredAt,
  };

  return {
    didAdvance: true,
    validationError: null,
    progress: nextProgress,
    nextCard: isComplete
      ? null
      : renderInterviewDayQuestionCard({
          daySpec: normalizedDay,
          question: normalizedDay.questions[nextIndex],
          questionIndex: nextIndex,
          totalQuestions: normalizedDay.questions.length,
          requestId,
          sessionId,
          now,
        }),
  };
}

export function buildPromptText({ dayId, goal, questionText } = {}) {
  const safeDayId = normalizeDayId(dayId);
  const safeGoal = stringOrDefault(goal, DEFAULT_GOAL);
  const safeQuestion = stringOrDefault(questionText, "오늘 확인할 고객의 실제 행동은 무엇인가요?");
  return [
    `Day ${safeDayId} Interview`,
    `목표: ${safeGoal}`,
    `질문: ${safeQuestion}`,
  ].join("\n");
}

function normalizeDaySpec(daySpec) {
  const raw = objectOrEmpty(daySpec);
  const questions = normalizeQuestions(
    raw.key_questions_with_intent
      ?? raw.keyQuestionsWithIntent
      ?? raw.key_questions
      ?? raw.keyQuestions
      ?? raw.questions,
  );
  return {
    dayId: normalizeDayId(raw.day_id ?? raw.dayId ?? raw.day),
    title: stringOrDefault(raw.title ?? raw.day_title ?? raw.dayTitle, DEFAULT_TITLE),
    goal: stringOrDefault(raw.day_goal ?? raw.dayGoal ?? raw.goal, DEFAULT_GOAL),
    questions,
    action: normalizeAction(raw.action_spec ?? raw.actionSpec ?? raw.action),
    dependencies: normalizeDependencies(raw.dependency_map ?? raw.dependencyMap ?? raw.dependencies),
  };
}

function normalizeQuestions(value) {
  const source = Array.isArray(value) ? value : [];
  const normalized = source.map(normalizeQuestion).filter((entry) => entry.text);
  if (normalized.length > 0) return normalized;
  return [
    {
      text: "오늘 확인할 고객의 실제 행동은 무엇인가요?",
      intent: DEFAULT_INTENT,
    },
  ];
}

function normalizeQuestion(value) {
  if (typeof value === "string") {
    return {
      questionId: "",
      text: value.trim(),
      intent: DEFAULT_INTENT,
    };
  }
  const raw = objectOrEmpty(value);
  return {
    questionId: stringOrDefault(raw.questionId ?? raw.question_id ?? raw.id, ""),
    text: stringOrDefault(raw.question ?? raw.text ?? raw.prompt, ""),
    intent: stringOrDefault(raw.intent ?? raw.intent_description ?? raw.intentDescription, DEFAULT_INTENT),
  };
}

function normalizeUnguidedQuestionRecords(questionRecords, normalizedDay) {
  const source = Array.isArray(questionRecords) && questionRecords.length
    ? questionRecords
    : normalizedDay.questions;
  const normalized = source
    .map((entry, index) => {
      const question = normalizeQuestion(entry);
      return {
        questionId: question.questionId || `day${normalizedDay.dayId}-question-${index + 1}`,
        questionIndex: index,
        text: question.text,
        intent: question.intent,
      };
    })
    .filter((entry) => entry.text);
  return normalized.length ? normalized : normalizedDay.questions.map((question, index) => ({
    questionId: question.questionId || `day${normalizedDay.dayId}-question-${index + 1}`,
    questionIndex: index,
    text: question.text,
    intent: question.intent,
  }));
}

function arraysEqual(lhs, rhs) {
  return lhs.length === rhs.length && lhs.every((value, index) => value === rhs[index]);
}

function normalizeAction(value) {
  const raw = objectOrEmpty(value);
  return {
    description: stringOrDefault(raw.description ?? raw.task, ""),
    completionSignal: stringOrDefault(raw.completion_signal ?? raw.completionSignal, ""),
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

function normalizeInterviewProgress(progress, normalizedDay) {
  const raw = objectOrEmpty(progress);
  const answeredQuestions = Array.isArray(raw.answeredQuestions)
    ? raw.answeredQuestions
        .map(normalizeAnsweredQuestion)
        .filter((entry) => entry.answerText)
    : [];
  return {
    dayId: normalizeDayId(raw.dayId ?? raw.day_id ?? normalizedDay.dayId),
    dayType: "interview",
    dayGoal: stringOrDefault(raw.dayGoal ?? raw.day_goal ?? normalizedDay.goal, normalizedDay.goal),
    totalQuestions: normalizeTotal(raw.totalQuestions ?? raw.total_questions, normalizedDay.questions.length, 0),
    currentQuestionIndex: normalizeIndex(raw.currentQuestionIndex ?? raw.current_question_index ?? answeredQuestions.length),
    answeredQuestions,
    completedQuestionCount: answeredQuestions.length,
    allQuestionsAnswered: raw.allQuestionsAnswered === true,
    completionConfirmed: raw.completionConfirmed === true,
    updatedAt: stringOrDefault(raw.updatedAt ?? raw.updated_at, ""),
  };
}

function normalizeProgressQuestionIndex(questionIndex, progress, questionCount) {
  const hasExplicitIndex = questionIndex !== null && questionIndex !== undefined;
  const explicit = hasExplicitIndex ? Number(questionIndex) : NaN;
  const raw = Number.isFinite(explicit) ? explicit : Number(progress.currentQuestionIndex);
  if (!Number.isFinite(raw)) return 0;
  return Math.min(Math.max(0, Math.trunc(raw)), Math.max(0, questionCount - 1));
}

function normalizeInterviewAnswer(value) {
  if (typeof value === "string") {
    const answerText = value.trim();
    return {
      answerText,
      selectedOptions: [],
      isValid: Boolean(answerText),
    };
  }
  const raw = objectOrEmpty(value);
  const selectedOptions = normalizeStringArray(raw.selectedOptions ?? raw.selected_options);
  const freeText = stringOrDefault(raw.freeText ?? raw.free_text ?? raw.answerText ?? raw.answer, "");
  const answerText = freeText || selectedOptions.join(", ");
  return {
    answerText,
    selectedOptions,
    isValid: Boolean(freeText),
  };
}

function normalizeAnsweredQuestion(value) {
  const raw = objectOrEmpty(value);
  return {
    questionIndex: normalizeIndex(raw.questionIndex ?? raw.question_index),
    questionText: stringOrDefault(raw.questionText ?? raw.question_text ?? raw.question, ""),
    intent: stringOrDefault(raw.intent, DEFAULT_INTENT),
    answerText: stringOrDefault(raw.answerText ?? raw.answer_text ?? raw.answer, ""),
    selectedOptions: normalizeStringArray(raw.selectedOptions ?? raw.selected_options),
    answeredAt: stringOrDefault(raw.answeredAt ?? raw.answered_at, ""),
  };
}

function upsertAnsweredQuestion(existing, entry) {
  const next = existing.filter((item) => item.questionIndex !== entry.questionIndex);
  next.push(entry);
  return next.sort((lhs, rhs) => lhs.questionIndex - rhs.questionIndex);
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => String(entry ?? "").trim())
    .filter(Boolean);
}

function buildHelperText(intent) {
  return `의도: ${stringOrDefault(intent, DEFAULT_INTENT)} 답은 나중에 적응형 코칭과 Review Day 요약에 그대로 쓰입니다.`;
}

function normalizeIndex(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.trunc(n));
}

function normalizeTotal(explicitTotal, questionCount, index) {
  const n = Number(explicitTotal);
  if (Number.isFinite(n) && n > 0) return Math.max(Math.trunc(n), index + 1);
  return Math.max(1, questionCount, index + 1);
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

function toIso(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : new Date().toISOString();
}
