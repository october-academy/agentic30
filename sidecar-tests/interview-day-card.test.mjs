import test from "node:test";
import assert from "node:assert/strict";

import {
  INTERVIEW_DAY_CARD_SCHEMA_VERSION,
  advanceInterviewDayQuestion,
  buildPromptText,
  renderInterviewDayQuestionCard,
  renderUnguidedInterviewDayQuestionSet,
} from "../sidecar/interview-day-card.mjs";

test("renderInterviewDayQuestionCard renders prompt text and host card structure", () => {
  const card = renderInterviewDayQuestionCard({
    daySpec: {
      day_id: 1,
      title: "첫 고객 행동 확인",
      day_goal: "고객의 어제 행동에서 통증 1개를 압축한다",
      key_questions_with_intent: [
        {
          question: "그 통증, 누가 어제 어떤 행동으로 보여줬나요?",
          intent: "사용자가 상상한 페르소나가 아니라 실제 관찰된 행동을 확보한다.",
        },
        {
          question: "현재 대안은 무엇이고 비용은 얼마인가요?",
          intent: "status quo와 전환 비용을 확인한다.",
        },
      ],
      action_spec: {
        description: "인터뷰 후보 1명을 정하고 과거 행동 질문을 보낸다",
        completion_signal: "후보 이름과 보낸 질문 원문",
      },
      dependency_map: ["pre_day_1_context"],
    },
    questionIndex: 0,
    totalQuestions: 2,
    requestId: "req-1",
    sessionId: "session-1",
    now: new Date("2026-05-14T00:00:00.000Z"),
  });

  assert.equal(card.schemaVersion, INTERVIEW_DAY_CARD_SCHEMA_VERSION);
  assert.equal(card.cardType, "curriculum_interview_question_card");
  assert.equal(card.dayType, "interview");
  assert.equal(card.dayId, 1);
  assert.equal(card.questionIndex, 0);
  assert.equal(card.totalQuestions, 2);
  assert.match(card.promptText, /Day 1 Interview/);
  assert.match(card.promptText, /목표: 고객의 어제 행동에서 통증 1개를 압축한다/);
  assert.match(card.promptText, /질문: 그 통증, 누가 어제 어떤 행동으로 보여줬나요\?/);
  assert.equal(card.intent, "사용자가 상상한 페르소나가 아니라 실제 관찰된 행동을 확보한다.");
  assert.deepEqual(card.dependencies, ["pre_day_1_context"]);
  assert.equal(card.action.completionSignal, "후보 이름과 보낸 질문 원문");

  assert.equal(card.card.layout, "interview_card_conversation");
  assert.equal(card.card.tone, "friendly_senior");
  assert.deepEqual(
    card.card.blocks.map((block) => block.kind),
    ["prompt", "intent", "answer"],
  );
  assert.equal(card.card.blocks[2].input.type, "long_text");
  assert.equal(card.card.blocks[2].input.required, true);

  assert.equal(card.structuredPrompt.requestId, "req-1");
  assert.equal(card.structuredPrompt.sessionId, "session-1");
  assert.equal(card.structuredPrompt.toolName, "agentic30_curriculum_interview");
  assert.equal(card.structuredPrompt.title, "Day 1 Interview");
  assert.equal(card.structuredPrompt.createdAt, "2026-05-14T00:00:00.000Z");
  assert.equal(card.structuredPrompt.questions.length, 1);

  const [question] = card.structuredPrompt.questions;
  assert.equal(question.header, "Q 1/2");
  assert.equal(question.question, card.promptText);
  assert.match(question.helperText, /의도: 사용자가 상상한 페르소나/);
  assert.equal(question.allowFreeText, true);
  assert.equal(question.requiresFreeText, true);
  assert.equal(question.textMode, "long");
  assert.match(question.freeTextPlaceholder, /실제 상황/);
});

test("buildPromptText normalizes sparse input into a stable Interview prompt", () => {
  assert.equal(
    buildPromptText({
      dayId: 99,
      goal: "  ",
      questionText: "이번 주 첫 인터뷰 대상은 누구인가요?",
    }),
    [
      "Day 30 Interview",
      "목표: 실제 고객의 과거 행동을 구체적으로 확인한다",
      "질문: 이번 주 첫 인터뷰 대상은 누구인가요?",
    ].join("\n"),
  );
});

test("advanceInterviewDayQuestion advances to the next question card after a valid answer", () => {
  const daySpec = {
    day_id: 1,
    title: "첫 고객 행동 확인",
    day_goal: "고객의 어제 행동에서 통증 1개를 압축한다",
    key_questions_with_intent: [
      {
        question: "누가 어제 이 문제를 겪었나요?",
        intent: "실제 사람과 최근 행동을 고정한다.",
      },
      {
        question: "그 사람이 지금 쓰는 대안은 무엇인가요?",
        intent: "status quo를 확인한다.",
      },
    ],
  };

  const result = advanceInterviewDayQuestion({
    daySpec,
    progress: {
      dayId: 1,
      currentQuestionIndex: 0,
      answeredQuestions: [],
    },
    answer: {
      freeText: "어제 베타 사용자 민지가 CSV를 손으로 다시 정리했습니다.",
    },
    requestId: "req-next",
    sessionId: "session-next",
    now: new Date("2026-05-14T01:02:03.000Z"),
  });

  assert.equal(result.didAdvance, true);
  assert.equal(result.validationError, null);
  assert.equal(result.progress.currentQuestionIndex, 1);
  assert.equal(result.progress.completedQuestionCount, 1);
  assert.equal(result.progress.allQuestionsAnswered, false);
  assert.equal(result.progress.answeredQuestions.length, 1);
  assert.deepEqual(result.progress.answeredQuestions[0], {
    questionIndex: 0,
    questionText: "누가 어제 이 문제를 겪었나요?",
    intent: "실제 사람과 최근 행동을 고정한다.",
    answerText: "어제 베타 사용자 민지가 CSV를 손으로 다시 정리했습니다.",
    selectedOptions: [],
    answeredAt: "2026-05-14T01:02:03.000Z",
  });

  assert.ok(result.nextCard);
  assert.equal(result.nextCard.cardType, "curriculum_interview_question_card");
  assert.equal(result.nextCard.questionIndex, 1);
  assert.equal(result.nextCard.totalQuestions, 2);
  assert.equal(result.nextCard.structuredPrompt.requestId, "req-next");
  assert.equal(result.nextCard.structuredPrompt.sessionId, "session-next");
  assert.equal(result.nextCard.structuredPrompt.questions[0].header, "Q 2/2");
  assert.match(result.nextCard.promptText, /그 사람이 지금 쓰는 대안은 무엇인가요\?/);
});

test("renderUnguidedInterviewDayQuestionSet renders every exposed original interview question", () => {
  const daySpec = {
    day_id: 1,
    title: "첫 고객 행동 확인",
    day_goal: "고객의 어제 행동에서 통증 1개를 압축한다",
    key_questions_with_intent: [
      {
        id: "day1-question-1",
        question: "누가 어제 이 문제를 겪었나요?",
        intent: "실제 사람과 최근 행동을 고정한다.",
      },
      {
        id: "day1-question-2",
        question: "그 사람이 지금 쓰는 대안은 무엇인가요?",
        intent: "status quo를 확인한다.",
      },
      {
        id: "day1-question-3",
        question: "오늘 바로 다시 물어볼 수 있는 사람은 누구인가요?",
        intent: "Day 1 이후 실행 연결을 만든다.",
      },
    ],
  };
  const questionRecords = daySpec.key_questions_with_intent.map((question) => ({
    questionId: question.id,
    question: question.question,
    intent: question.intent,
    status: "pending",
  }));

  const payload = renderUnguidedInterviewDayQuestionSet({
    daySpec,
    questionRecords,
    requestId: "req-unguided",
    sessionId: "session-unguided",
    now: new Date("2026-05-14T02:03:04.000Z"),
  });

  assert.equal(payload.cardType, "curriculum_interview_unguided_question_set");
  assert.equal(payload.renderedQuestionCount, 3);
  assert.equal(payload.rendersCompleteOriginalQuestionSet, true);
  assert.equal(payload.structuredPrompt.requestId, "req-unguided");
  assert.equal(payload.structuredPrompt.sessionId, "session-unguided");
  assert.equal(payload.structuredPrompt.generation.mode, "curriculum_interview_unguided_renderer");
  assert.deepEqual(
    payload.structuredPrompt.questions.map((question) => question.questionId),
    ["day1-question-1", "day1-question-2", "day1-question-3"],
  );
  assert.deepEqual(
    payload.structuredPrompt.questions.map((question) => question.header),
    ["Q 1/3", "Q 2/3", "Q 3/3"],
  );
  for (const original of daySpec.key_questions_with_intent) {
    assert.equal(
      payload.structuredPrompt.questions.some((question) => question.question.includes(original.question)),
      true,
      `${original.question} should render in the unguided prompt`,
    );
  }
  assert.equal(payload.structuredPrompt.questions.every((question) => question.allowFreeText === true), true);
  assert.equal(payload.structuredPrompt.questions.every((question) => question.requiresFreeText === true), true);
});
