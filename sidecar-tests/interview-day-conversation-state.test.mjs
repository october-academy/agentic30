import test from "node:test";
import assert from "node:assert/strict";

import {
  INTERVIEW_DAY_CONVERSATION_STATE_SCHEMA_VERSION,
  INTERVIEW_DAY_CONVERSATION_STATUS,
  advanceInterviewDayConversationState,
  createInitialInterviewDayConversationState,
  ensureInterviewDayConversationState,
  getCurrentInterviewDayPrompt,
} from "../sidecar/interview-day-conversation-state.mjs";

function makeClock(start = "2026-05-14T09:00:00.000Z") {
  let next = new Date(start).getTime();
  return () => {
    const value = new Date(next);
    next += 1_000;
    return value;
  };
}

const DAY_SPEC = {
  day_id: 1,
  title: "첫 고객 행동 확인",
  day_goal: "고객의 어제 행동에서 통증 1개를 압축한다",
  key_questions_with_intent: [
    {
      id: "day1-q1",
      question: "누가 어제 이 문제를 겪었나요?",
      intent: "실제 사람과 최근 행동을 고정한다.",
    },
    {
      id: "day1-q2",
      question: "그 사람이 지금 쓰는 대안은 무엇인가요?",
      intent: "status quo를 확인한다.",
    },
  ],
  action_spec: {
    description: "인터뷰 후보 1명을 정하고 과거 행동 질문을 보낸다",
    completion_signal: "후보 이름과 보낸 질문 원문",
  },
  dependency_map: ["pre_day_1_context"],
};

test("createInitialInterviewDayConversationState starts on the first interview prompt", () => {
  const now = makeClock();
  const state = createInitialInterviewDayConversationState({
    daySpec: DAY_SPEC,
    requestId: "req-interview-initial",
    sessionId: "session-interview-initial",
    now,
  });

  assert.equal(state.schemaVersion, INTERVIEW_DAY_CONVERSATION_STATE_SCHEMA_VERSION);
  assert.equal(state.dayId, 1);
  assert.equal(state.dayType, "interview");
  assert.equal(state.dayGoal, "고객의 어제 행동에서 통증 1개를 압축한다");
  assert.equal(state.status, INTERVIEW_DAY_CONVERSATION_STATUS.active);
  assert.equal(state.startedAt, "2026-05-14T09:00:00.000Z");
  assert.equal(state.updatedAt, "2026-05-14T09:00:00.000Z");
  assert.equal(state.completedAt, null);
  assert.equal(state.currentQuestionIndex, 0);
  assert.equal(state.totalQuestions, 2);
  assert.equal(state.completedQuestionCount, 0);
  assert.equal(state.allQuestionsAnswered, false);
  assert.equal(state.completionConfirmed, false);

  assert.deepEqual(
    state.questionRecords.map((record) => [record.questionId, record.questionIndex, record.status]),
    [
      ["day1-q1", 0, "pending"],
      ["day1-q2", 1, "pending"],
    ],
  );
  assert.equal(state.questionRecords.every((record) => record.answerText === null), true);

  assert.equal(state.currentPrompt.cardType, "curriculum_interview_question_card");
  assert.equal(state.currentPrompt.questionIndex, 0);
  assert.equal(state.currentPrompt.totalQuestions, 2);
  assert.equal(state.currentPrompt.structuredPrompt.requestId, "req-interview-initial");
  assert.equal(state.currentPrompt.structuredPrompt.sessionId, "session-interview-initial");
  assert.equal(state.currentPrompt.structuredPrompt.questions[0].questionId, "day1-q1");
  assert.equal(state.currentPrompt.structuredPrompt.questions[0].header, "Q 1/2");
  assert.match(state.currentPrompt.promptText, /누가 어제 이 문제를 겪었나요\?/);
  assert.deepEqual(state.structuredDaySpec.dependencyMap, ["pre_day_1_context"]);
  assert.equal(state.structuredDaySpec.actionSpec.completionSignal, "후보 이름과 보낸 질문 원문");
});

test("advanceInterviewDayConversationState records an answer and moves to the next prompt", () => {
  const now = makeClock();
  const initial = createInitialInterviewDayConversationState({
    daySpec: DAY_SPEC,
    requestId: "req-initial",
    sessionId: "session-initial",
    now,
  });

  const result = advanceInterviewDayConversationState(initial, {
    answer: {
      freeText: "어제 베타 사용자 민지가 CSV를 손으로 다시 정리했습니다.",
    },
    requestId: "req-next",
    sessionId: "session-next",
    now,
  });

  assert.equal(result.advanced, true);
  assert.equal(result.validationError, null);
  assert.equal(result.reason, null);
  assert.equal(result.state.status, INTERVIEW_DAY_CONVERSATION_STATUS.active);
  assert.equal(result.state.updatedAt, "2026-05-14T09:00:01.000Z");
  assert.equal(result.state.completedAt, null);
  assert.equal(result.state.currentQuestionIndex, 1);
  assert.equal(result.state.completedQuestionCount, 1);
  assert.equal(result.state.allQuestionsAnswered, false);

  assert.deepEqual(result.state.questionRecords[0], {
    questionId: "day1-q1",
    questionIndex: 0,
    question: "누가 어제 이 문제를 겪었나요?",
    intent: "실제 사람과 최근 행동을 고정한다.",
    status: "answered",
    answerText: "어제 베타 사용자 민지가 CSV를 손으로 다시 정리했습니다.",
    selectedOptions: [],
    answeredAt: "2026-05-14T09:00:01.000Z",
  });
  assert.equal(result.state.questionRecords[1].status, "pending");
  assert.equal(result.state.currentPrompt.cardType, "curriculum_interview_question_card");
  assert.equal(result.state.currentPrompt.questionIndex, 1);
  assert.equal(result.state.currentPrompt.structuredPrompt.requestId, "req-next");
  assert.equal(result.state.currentPrompt.structuredPrompt.sessionId, "session-next");
  assert.equal(result.state.currentPrompt.structuredPrompt.questions[0].questionId, "day1-q2");
  assert.equal(result.state.currentPrompt.structuredPrompt.questions[0].header, "Q 2/2");
  assert.match(result.state.currentPrompt.promptText, /그 사람이 지금 쓰는 대안은 무엇인가요\?/);
});

test("ensureInterviewDayConversationState restores persisted records and current prompt", () => {
  const restored = ensureInterviewDayConversationState({
    dayId: 3,
    dayGoal: "Mom Test 인터뷰 질문을 만든다",
    currentQuestionIndex: 1,
    totalQuestions: 2,
    startedAt: "2026-05-14T08:00:00.000Z",
    updatedAt: "2026-05-14T08:03:00.000Z",
    questionRecords: [
      {
        questionId: "day3-q1",
        questionIndex: 0,
        question: "최근 이 문제를 겪은 사람은 누구인가요?",
        intent: "실제 인터뷰 후보를 고정한다.",
        status: "answered",
        answerText: "지난주 온보딩에서 막힌 지현님입니다.",
        answeredAt: "2026-05-14T08:01:00.000Z",
      },
      {
        questionId: "day3-q2",
        questionIndex: 1,
        question: "미래 의향 질문을 어떻게 과거 행동 질문으로 바꿀까요?",
        intent: "Mom Test 형식으로 질문을 고친다.",
        status: "pending",
      },
    ],
  }, {
    requestId: "req-restored",
    sessionId: "session-restored",
    now: makeClock(),
  });

  assert.equal(restored.dayId, 3);
  assert.equal(restored.completedQuestionCount, 1);
  assert.equal(restored.currentQuestionIndex, 1);
  assert.equal(restored.currentPrompt.structuredPrompt.requestId, "req-restored");
  assert.equal(restored.currentPrompt.structuredPrompt.questions[0].questionId, "day3-q2");
  assert.match(restored.currentPrompt.promptText, /미래 의향 질문을 어떻게 과거 행동 질문으로 바꿀까요\?/);

  const prompt = getCurrentInterviewDayPrompt(restored, {
    requestId: "req-current",
    sessionId: "session-current",
    now: makeClock(),
  });
  assert.equal(prompt.structuredPrompt.requestId, "req-current");
  assert.equal(prompt.structuredPrompt.questions[0].header, "Q 2/2");
});
