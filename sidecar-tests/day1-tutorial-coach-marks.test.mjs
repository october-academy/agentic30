import test from "node:test";
import assert from "node:assert/strict";

import {
  DAY1_TUTORIAL_C_METHOD_ASSISTANT_MESSAGE_CATALOG,
  DAY1_TUTORIAL_COACH_MARK_SCHEMA_VERSION,
  DAY1_TUTORIAL_FLOW_MODES,
  DAY1_TUTORIAL_TARGETS,
  advanceDay1TutorialCoachMarkProgression,
  buildDay1TutorialCoachMarkModel,
  buildDay1UnguidedInterviewModePayload,
  completeDay1TutorialTargetInteraction,
  renderDay1TutorialCMethodAssistantMessageContent,
  renderDay1TutorialDimmingOverlayGeometry,
  renderDay1TutorialHighlightViewState,
  resolveDay1TutorialTargetSelection,
  resolveNextDay1TutorialCoachMarkControllerState,
  skipDay1TutorialCoachMarkOverlay,
  validateDay1TutorialCoachMarkStep,
} from "../sidecar/day1-tutorial-coach-marks.mjs";

const DAY_1_SPEC = {
  day_id: 1,
  day_goal: "고객의 어제 행동에서 통증 1개를 압축한다",
  key_questions_with_intent: [
    {
      question: "그 통증, 누가 어제 어떤 행동으로 보여줬나요?",
      intent: "상상한 페르소나가 아니라 실제 관찰된 행동을 확보한다.",
    },
    {
      question: "현재 대안은 무엇이고 비용은 어느 정도인가요?",
      intent: "status quo와 전환 비용을 확인한다.",
    },
  ],
};

const EXPECTED_DAY1_C_METHOD_ASSISTANT_CONTENT = Object.freeze({
  "day1-cue-curriculum": [
    "먼저 30일 커리큘럼에서 오늘 위치를 확인해보세요. Day 1은 튜토리얼이면서 실제 첫 데이터입니다.",
    "",
    `현재 질문: ${DAY_1_SPEC.key_questions_with_intent[0].question}`,
    `의도: ${DAY_1_SPEC.key_questions_with_intent[0].intent}`,
  ].join("\n"),
  "day1-context-first-card": [
    "Day 1 카드를 열면 첫 Interview 질문이 나옵니다. 답은 연습용이 아니라 이후 Review와 적응형 코칭에 그대로 쓰여요.",
    "",
    `현재 질문: ${DAY_1_SPEC.key_questions_with_intent[1].question}`,
    `의도: ${DAY_1_SPEC.key_questions_with_intent[1].intent}`,
  ].join("\n"),
  "day1-compose-answer": [
    "한 사람의 어제 행동을 기준으로 짧게 적어보세요. 추측보다 실제 상황, 현재 대안, 막힌 지점을 우선하면 됩니다.",
    "",
    `현재 질문: ${DAY_1_SPEC.key_questions_with_intent[1].question}`,
    `의도: ${DAY_1_SPEC.key_questions_with_intent[1].intent}`,
  ].join("\n"),
  "day1-commit-send": [
    "보내기를 누르면 첫 답이 Day 1 진행 데이터로 저장됩니다. 남은 질문은 같은 흐름으로 이어가면 됩니다.",
    "",
    `현재 질문: ${DAY_1_SPEC.key_questions_with_intent[1].question}`,
    `의도: ${DAY_1_SPEC.key_questions_with_intent[1].intent}`,
  ].join("\n"),
});

test("Day 1 tutorial coach-mark model composes ordered C-method steps", () => {
  const model = buildDay1TutorialCoachMarkModel({
    daySpec: DAY_1_SPEC,
    now: new Date("2026-05-14T09:00:00.000Z"),
  });

  assert.equal(model.schemaVersion, DAY1_TUTORIAL_COACH_MARK_SCHEMA_VERSION);
  assert.equal(model.dayId, 1);
  assert.equal(model.dayType, "interview");
  assert.equal(model.tutorialType, "day1_blocking_c_method");
  assert.equal(model.createdAt, "2026-05-14T09:00:00.000Z");
  assert.equal(model.overlay.mode, "blocking");
  assert.equal(model.overlay.dimNonTargetAreas, true);
  assert.equal(model.overlay.highlightTarget, true);
  assert.equal(model.overlay.skipAvailable, true);
  assert.equal(model.overlay.skipEffect, "disable_overlay_only");
  assert.equal(model.tutorialConfig.guidedQuestionsRemaining, 2);
  assert.equal(model.tutorialConfig.overlayActive, true);
  assert.equal(model.tutorialConfig.guidedQuestionActive, true);
  assert.equal(model.tutorialConfig.activeGuidedQuestionId, "day1-question-1");
  assert.equal(model.tutorialConfig.flowMode, DAY1_TUTORIAL_FLOW_MODES.guided);
  assert.equal(model.tutorialConfig.interviewFlowMode, DAY1_TUTORIAL_FLOW_MODES.guided);
  assert.equal(model.tutorialConfig.guidanceMode, "blocking_coach_mark");
  assert.deepEqual(model.tutorialConfig.menubarTourStepsCompleted, []);
  assert.deepEqual(
    model.interviewQuestionRecords.map((question) => [
      question.questionId,
      question.answer,
      question.status,
      question.completed,
      question.completionConfirmed,
    ]),
    [
      ["day1-question-1", "", "pending", false, false],
      ["day1-question-2", "", "pending", false, false],
    ],
  );

  assert.deepEqual(model.cMethod.sequence, ["cue", "context", "compose", "commit"]);
  assert.deepEqual(
    model.steps.map((step) => [step.order, step.id, step.cMethodStep]),
    [
      [1, "day1-cue-curriculum", "cue"],
      [2, "day1-context-first-card", "context"],
      [3, "day1-compose-answer", "compose"],
      [4, "day1-commit-send", "commit"],
    ],
  );
  assert.deepEqual(
    model.steps.map((step) => step.targetElementId),
    [
      DAY1_TUTORIAL_TARGETS.curriculumNavigator,
      DAY1_TUTORIAL_TARGETS.dayOneCard,
      DAY1_TUTORIAL_TARGETS.structuredPrompt,
      DAY1_TUTORIAL_TARGETS.sendButton,
    ],
  );
});

test("Day 1 C-method message catalog defines every blocking coach-mark Assistant message", () => {
  assert.equal(Object.isFrozen(DAY1_TUTORIAL_C_METHOD_ASSISTANT_MESSAGE_CATALOG), true);
  assert.deepEqual(
    Object.keys(DAY1_TUTORIAL_C_METHOD_ASSISTANT_MESSAGE_CATALOG),
    [
      "day1-cue-curriculum",
      "day1-context-first-card",
      "day1-compose-answer",
      "day1-commit-send",
    ],
  );

  assert.deepEqual(
    Object.values(DAY1_TUTORIAL_C_METHOD_ASSISTANT_MESSAGE_CATALOG).map((entry) => [
      Object.isFrozen(entry),
      entry.stepId,
      entry.cMethodStep,
      entry.headline,
      entry.actionLabel,
      entry.body,
    ]),
    [
      [
        true,
        "day1-cue-curriculum",
        "cue",
        "Day 1 위치 확인",
        "Day 1 보기",
        "먼저 30일 커리큘럼에서 오늘 위치를 확인해보세요. Day 1은 튜토리얼이면서 실제 첫 데이터입니다.",
      ],
      [
        true,
        "day1-context-first-card",
        "context",
        "첫 질문 열기",
        "질문 열기",
        "Day 1 카드를 열면 첫 Interview 질문이 나옵니다. 답은 연습용이 아니라 이후 Review와 적응형 코칭에 그대로 쓰여요.",
      ],
      [
        true,
        "day1-compose-answer",
        "compose",
        "실제 사례로 답하기",
        "답 작성",
        "한 사람의 어제 행동을 기준으로 짧게 적어보세요. 추측보다 실제 상황, 현재 대안, 막힌 지점을 우선하면 됩니다.",
      ],
      [
        true,
        "day1-commit-send",
        "commit",
        "답 제출",
        "제출하기",
        "보내기를 누르면 첫 답이 Day 1 진행 데이터로 저장됩니다. 남은 질문은 같은 흐름으로 이어가면 됩니다.",
      ],
    ],
  );
});

test("Day 1 C-method catalog renders exact Assistant chat content for every blocking step", () => {
  const model = buildDay1TutorialCoachMarkModel({ daySpec: DAY_1_SPEC });

  assert.deepEqual(
    model.steps.map((step) => [
      step.id,
      step.title,
      step.actionLabel,
      step.assistantMessage,
    ]),
    [
      [
        "day1-cue-curriculum",
        "Day 1 위치 확인",
        "Day 1 보기",
        {
          role: "assistant",
          tone: "friendly_senior",
          content: EXPECTED_DAY1_C_METHOD_ASSISTANT_CONTENT["day1-cue-curriculum"],
        },
      ],
      [
        "day1-context-first-card",
        "첫 질문 열기",
        "질문 열기",
        {
          role: "assistant",
          tone: "friendly_senior",
          content: EXPECTED_DAY1_C_METHOD_ASSISTANT_CONTENT["day1-context-first-card"],
        },
      ],
      [
        "day1-compose-answer",
        "실제 사례로 답하기",
        "답 작성",
        {
          role: "assistant",
          tone: "friendly_senior",
          content: EXPECTED_DAY1_C_METHOD_ASSISTANT_CONTENT["day1-compose-answer"],
        },
      ],
      [
        "day1-commit-send",
        "답 제출",
        "제출하기",
        {
          role: "assistant",
          tone: "friendly_senior",
          content: EXPECTED_DAY1_C_METHOD_ASSISTANT_CONTENT["day1-commit-send"],
        },
      ],
    ],
  );

  for (const step of model.steps) {
    assert.equal(
      renderDay1TutorialCMethodAssistantMessageContent({
        stepId: step.id,
        questionGuidance: step.questionGuidance,
      }),
      EXPECTED_DAY1_C_METHOD_ASSISTANT_CONTENT[step.id],
      `${step.id} should render catalog body plus question context`,
    );
  }
});

test("Day 1 tutorial overlay is active only while a guided question is active", () => {
  const model = buildDay1TutorialCoachMarkModel({ daySpec: DAY_1_SPEC });
  const inactiveGuidedQuestionConfig = {
    ...model.tutorialConfig,
    overlayActive: true,
    guidedQuestionsRemaining: 0,
    guidedQuestionActive: false,
    activeGuidedQuestionId: null,
  };

  const progression = advanceDay1TutorialCoachMarkProgression({
    model,
    tutorialConfig: inactiveGuidedQuestionConfig,
    currentStepId: "day1-cue-curriculum",
    interaction: {
      targetElementId: DAY1_TUTORIAL_TARGETS.curriculumNavigator,
      completed: false,
    },
  });

  assert.equal(progression.accepted, true);
  assert.equal(progression.reason, "overlay_inactive");
  assert.equal(progression.progressionGuardActive, false);
  assert.equal(progression.tutorialConfig.overlayActive, false);
  assert.equal(progression.tutorialConfig.guidedQuestionActive, false);
  assert.equal(progression.tutorialConfig.activeGuidedQuestionId, null);

  const viewState = renderDay1TutorialHighlightViewState({
    model,
    tutorialConfig: inactiveGuidedQuestionConfig,
    currentStepId: "day1-cue-curriculum",
    viewportFrame: { x: 0, y: 0, width: 420, height: 640 },
    registeredElements: [
      {
        registrationId: "sidebar-root",
        accessibilityIdentifier: DAY1_TUTORIAL_TARGETS.curriculumNavigator,
        frame: { x: 12, y: 12, width: 120, height: 44 },
      },
    ],
  });

  assert.equal(viewState.didRender, false);
  assert.equal(viewState.reason, "guided_question_inactive");
  assert.equal(viewState.overlayActive, false);
  assert.equal(viewState.dimNonTargetAreas, false);
  assert.equal(viewState.highlightSuppressed, true);
  assert.equal(viewState.elements[0].isDimmed, false);
  assert.equal(viewState.elements[0].isHighlighted, false);
});

test("Day 1 tutorial coach-mark steps include required UI target and Assistant chat fields", () => {
  const model = buildDay1TutorialCoachMarkModel({ daySpec: DAY_1_SPEC });

  for (const step of model.steps) {
    assert.equal(validateDay1TutorialCoachMarkStep(step), true, `${step.id} should be valid`);
    assert.equal(step.blocking, true);
    assert.equal(step.dimNonTargetAreas, true);
    assert.equal(step.highlight.targetElementId, step.targetElementId);
    assert.equal(step.highlight.style, "spotlight");
    assert.equal(step.assistantMessage.role, "assistant");
    assert.equal(step.assistantMessage.tone, "friendly_senior");
    assert.match(step.assistantMessage.content, /해보세요|됩니다|쓰여요|됩니다\./);
    assert.match(step.assistantMessage.content, /현재 질문:/);
    assert.match(step.assistantMessage.content, /의도:/);
    assert.equal(step.reframingContext.availableData.includes("pre_day_1_context"), true);
  }

  assert.equal(
    model.steps[0].assistantMessage.content.includes(DAY_1_SPEC.key_questions_with_intent[0].question),
    true,
  );
  assert.equal(
    model.steps.at(-1).assistantMessage.content.includes(DAY_1_SPEC.key_questions_with_intent[1].question),
    true,
  );
});

test("Day 1 tutorial coach-mark model clamps guided overlay to the first one or two questions", () => {
  const oneQuestion = buildDay1TutorialCoachMarkModel({
    daySpec: {
      ...DAY_1_SPEC,
      key_questions_with_intent: DAY_1_SPEC.key_questions_with_intent.slice(0, 1),
    },
    guidedQuestionCount: 9,
  });
  const skipOnlyOverlay = buildDay1TutorialCoachMarkModel({
    daySpec: DAY_1_SPEC,
    guidedQuestionCount: 0,
  });

  assert.equal(oneQuestion.tutorialConfig.guidedQuestionsRemaining, 1);
  assert.equal(skipOnlyOverlay.tutorialConfig.guidedQuestionsRemaining, 1);
  assert.equal(skipOnlyOverlay.overlay.skipEffect, "disable_overlay_only");
  assert.equal(skipOnlyOverlay.steps.length, 4);
});

test("Day 1 tutorial marks only the first configured questions as guided and leaves later questions unguided", () => {
  const model = buildDay1TutorialCoachMarkModel({
    daySpec: {
      ...DAY_1_SPEC,
      key_questions_with_intent: [
        ...DAY_1_SPEC.key_questions_with_intent,
        {
          question: "그 사람이 이 문제를 해결하려고 마지막으로 시도한 방법은 무엇인가요?",
          intent: "최근 해결 시도에서 실제 강도를 확인한다.",
        },
        {
          question: "오늘 바로 다시 물어볼 수 있는 사람은 누구인가요?",
          intent: "Day 1 이후 실행 연결을 만든다.",
        },
      ],
    },
    guidedQuestionCount: 2,
  });

  assert.equal(model.tutorialConfig.guidedQuestionsRemaining, 2);
  assert.equal(model.tutorialConfig.unguidedQuestionCount, 2);
  assert.deepEqual(
    model.questionGuidance.map((question) => [
      question.questionIndex,
      question.questionId,
      question.guided,
      question.guidanceMode,
      question.overlayEligible,
    ]),
    [
      [1, "day1-question-1", true, "blocking_coach_mark", true],
      [2, "day1-question-2", true, "blocking_coach_mark", true],
      [3, "day1-question-3", false, "unguided_chat", false],
      [4, "day1-question-4", false, "unguided_chat", false],
    ],
  );
  assert.deepEqual(
    model.steps.map((step) => step.questionGuidance.questionId),
    [
      "day1-question-1",
      "day1-question-2",
      "day1-question-2",
      "day1-question-2",
    ],
  );
  assert.equal(
    model.steps.some((step) => step.questionGuidance.questionId === "day1-question-3"),
    false,
  );
  assert.equal(
    model.steps.some((step) => step.questionGuidance.questionId === "day1-question-4"),
    false,
  );
});

test("Day 1 tutorial suppresses the overlay after the guided question limit is reached", () => {
  const model = buildDay1TutorialCoachMarkModel({
    daySpec: {
      ...DAY_1_SPEC,
      key_questions_with_intent: [
        ...DAY_1_SPEC.key_questions_with_intent,
        {
          question: "그 사람이 이 문제를 해결하려고 마지막으로 시도한 방법은 무엇인가요?",
          intent: "최근 해결 시도에서 실제 강도를 확인한다.",
        },
      ],
    },
    guidedQuestionCount: 2,
  });
  const staleActiveOverlayConfig = {
    ...model.tutorialConfig,
    overlayActive: true,
    guidedQuestionActive: true,
    guidedQuestionsRemaining: 2,
    currentQuestionId: "day1-question-3",
  };

  const progression = advanceDay1TutorialCoachMarkProgression({
    model,
    tutorialConfig: staleActiveOverlayConfig,
    currentStepId: "day1-compose-answer",
    interaction: {
      targetElementId: DAY1_TUTORIAL_TARGETS.structuredPrompt,
      completed: false,
    },
  });

  assert.equal(progression.accepted, true);
  assert.equal(progression.reason, "overlay_inactive");
  assert.equal(progression.progressionGuardActive, false);
  assert.equal(progression.tutorialConfig.overlayActive, false);
  assert.equal(progression.tutorialConfig.guidedQuestionActive, false);
  assert.equal(progression.tutorialConfig.guidedQuestionsRemaining, 0);
  assert.equal(progression.tutorialConfig.activeGuidedQuestionId, null);
  assert.equal(progression.tutorialConfig.currentQuestionId, "day1-question-3");
  assert.equal(progression.tutorialConfig.overlaySuppressedReason, "guided_question_limit_reached");

  const viewState = renderDay1TutorialHighlightViewState({
    model,
    tutorialConfig: staleActiveOverlayConfig,
    currentStepId: "day1-compose-answer",
    registeredElements: [
      {
        registrationId: "structured-prompt-card",
        accessibilityIdentifier: DAY1_TUTORIAL_TARGETS.structuredPrompt,
        frame: { x: 24, y: 180, width: 360, height: 96 },
      },
    ],
  });

  assert.equal(viewState.didRender, false);
  assert.equal(viewState.reason, "guided_question_limit_reached");
  assert.equal(viewState.overlayActive, false);
  assert.equal(viewState.dimNonTargetAreas, false);
  assert.equal(viewState.highlightSuppressed, true);
  assert.equal(viewState.elements[0].isHighlighted, false);
  assert.equal(viewState.elements[0].isDimmed, false);
});

test("Day 1 tutorial progression guard rejects advance while current target interaction is incomplete", () => {
  const model = buildDay1TutorialCoachMarkModel({ daySpec: DAY_1_SPEC });

  const result = advanceDay1TutorialCoachMarkProgression({
    model,
    currentStepId: "day1-cue-curriculum",
    interaction: {
      targetElementId: DAY1_TUTORIAL_TARGETS.curriculumNavigator,
      completed: false,
    },
  });

  assert.equal(result.accepted, false);
  assert.equal(result.reason, "target_interaction_incomplete");
  assert.equal(result.progressionGuardActive, true);
  assert.equal(result.currentStep.id, "day1-cue-curriculum");
  assert.equal(result.expectedTargetElementId, DAY1_TUTORIAL_TARGETS.curriculumNavigator);
  assert.deepEqual(result.tutorialConfig.menubarTourStepsCompleted, []);
  assert.match(result.assistantMessage, /먼저 완료해보세요/);
});

test("Day 1 tutorial progression guard advances only after the highlighted target interaction completes", () => {
  const model = buildDay1TutorialCoachMarkModel({
    daySpec: DAY_1_SPEC,
    now: new Date("2026-05-14T09:00:00.000Z"),
  });

  const wrongTarget = advanceDay1TutorialCoachMarkProgression({
    model,
    currentStepId: "day1-cue-curriculum",
    interaction: {
      targetElementId: DAY1_TUTORIAL_TARGETS.dayOneCard,
      completed: true,
    },
  });
  assert.equal(wrongTarget.accepted, false);
  assert.deepEqual(wrongTarget.tutorialConfig.menubarTourStepsCompleted, []);

  const advanced = advanceDay1TutorialCoachMarkProgression({
    model,
    currentStepId: "day1-cue-curriculum",
    interaction: {
      targetElementId: DAY1_TUTORIAL_TARGETS.curriculumNavigator,
      completed: true,
    },
    now: new Date("2026-05-14T09:01:00.000Z"),
  });

  assert.equal(advanced.accepted, true);
  assert.equal(advanced.reason, "advanced");
  assert.equal(advanced.progressionGuardActive, true);
  assert.equal(advanced.currentStep.id, "day1-cue-curriculum");
  assert.equal(advanced.nextStep.id, "day1-context-first-card");
  assert.equal(advanced.tutorialConfig.overlayActive, true);
  assert.equal(advanced.tutorialConfig.lastProgressedAt, "2026-05-14T09:01:00.000Z");
  assert.deepEqual(advanced.tutorialConfig.menubarTourStepsCompleted, ["day1-cue-curriculum"]);
});

test("Day 1 tutorial completion handling marks the current target interaction completed and allows progression", () => {
  const model = buildDay1TutorialCoachMarkModel({
    daySpec: DAY_1_SPEC,
    now: new Date("2026-05-14T09:00:00.000Z"),
  });

  const completed = completeDay1TutorialTargetInteraction({
    model,
    currentStepId: "day1-cue-curriculum",
    targetElementId: DAY1_TUTORIAL_TARGETS.curriculumNavigator,
    now: new Date("2026-05-14T09:01:00.000Z"),
  });

  assert.equal(completed.didComplete, true);
  assert.equal(completed.canProgress, true);
  assert.equal(completed.reason, "advanced");
  assert.equal(completed.progressionGuardActive, true);
  assert.deepEqual(completed.completedInteraction, {
    stepId: "day1-cue-curriculum",
    targetElementId: DAY1_TUTORIAL_TARGETS.curriculumNavigator,
    cMethodStep: "cue",
    completed: true,
    completedAt: "2026-05-14T09:01:00.000Z",
  });
  assert.deepEqual(
    completed.tutorialConfig.targetInteractionsCompleted,
    [completed.completedInteraction],
  );
  assert.deepEqual(completed.tutorialConfig.menubarTourStepsCompleted, ["day1-cue-curriculum"]);
  assert.equal(completed.nextStep.id, "day1-context-first-card");
});

test("Day 1 tutorial next-step resolver advances controller state after target completion", () => {
  const model = buildDay1TutorialCoachMarkModel({
    daySpec: DAY_1_SPEC,
    now: new Date("2026-05-14T09:00:00.000Z"),
  });

  const firstResolution = resolveNextDay1TutorialCoachMarkControllerState({
    model,
    currentStepId: "day1-cue-curriculum",
    targetElementId: DAY1_TUTORIAL_TARGETS.curriculumNavigator,
    now: new Date("2026-05-14T09:01:00.000Z"),
  });

  assert.equal(firstResolution.didResolve, true);
  assert.equal(firstResolution.didAdvance, true);
  assert.equal(firstResolution.reason, "advanced");
  assert.equal(firstResolution.previousStep.id, "day1-cue-curriculum");
  assert.equal(firstResolution.nextStep.id, "day1-context-first-card");
  assert.deepEqual(firstResolution.tutorialConfig.menubarTourStepsCompleted, ["day1-cue-curriculum"]);
  assert.deepEqual(firstResolution.controllerState, {
    schemaVersion: DAY1_TUTORIAL_COACH_MARK_SCHEMA_VERSION,
    dayId: 1,
    state: "active",
    reason: "advanced",
    overlayActive: true,
    progressionGuardActive: true,
    flowMode: DAY1_TUTORIAL_FLOW_MODES.guided,
    interviewFlowMode: DAY1_TUTORIAL_FLOW_MODES.guided,
    guidanceMode: "blocking_coach_mark",
    activeStepId: "day1-context-first-card",
    activeStep: {
      id: "day1-context-first-card",
      order: 2,
      cMethodStep: "context",
      targetElementId: DAY1_TUTORIAL_TARGETS.dayOneCard,
    },
    activeCoachMark: model.steps[1],
    activeTargetElementId: DAY1_TUTORIAL_TARGETS.dayOneCard,
    completedStepIds: ["day1-cue-curriculum"],
    targetInteractionsCompleted: [
      {
        stepId: "day1-cue-curriculum",
        targetElementId: DAY1_TUTORIAL_TARGETS.curriculumNavigator,
        cMethodStep: "cue",
        completed: true,
        completedAt: "2026-05-14T09:01:00.000Z",
      },
    ],
  });

  const secondResolution = resolveNextDay1TutorialCoachMarkControllerState({
    model,
    tutorialConfig: firstResolution.tutorialConfig,
    currentStepId: firstResolution.controllerState.activeStepId,
    targetElementId: firstResolution.controllerState.activeTargetElementId,
    now: new Date("2026-05-14T09:02:00.000Z"),
  });

  assert.equal(secondResolution.didResolve, true);
  assert.equal(secondResolution.didAdvance, true);
  assert.equal(secondResolution.controllerState.activeStepId, "day1-compose-answer");
  assert.equal(secondResolution.controllerState.activeTargetElementId, DAY1_TUTORIAL_TARGETS.structuredPrompt);
  assert.deepEqual(secondResolution.controllerState.completedStepIds, [
    "day1-cue-curriculum",
    "day1-context-first-card",
  ]);
});

test("Day 1 tutorial target-selection model resolves the active step target to exactly one registered UI element", () => {
  const model = buildDay1TutorialCoachMarkModel({ daySpec: DAY_1_SPEC });

  const selection = resolveDay1TutorialTargetSelection({
    model,
    currentStepId: "day1-compose-answer",
    registeredElements: [
      {
        registrationId: "sidebar-root",
        accessibilityIdentifier: DAY1_TUTORIAL_TARGETS.curriculumNavigator,
        role: "group",
      },
      {
        registrationId: "structured-prompt-card",
        accessibilityIdentifier: DAY1_TUTORIAL_TARGETS.structuredPrompt,
        role: "card",
        frame: { x: 24, y: 180, width: 360, height: 96 },
      },
      {
        registrationId: "composer-send",
        accessibilityIdentifier: DAY1_TUTORIAL_TARGETS.sendButton,
        role: "button",
      },
    ],
  });

  assert.equal(selection.didResolve, true);
  assert.equal(selection.reason, "target_resolved");
  assert.equal(selection.activeStep.id, "day1-compose-answer");
  assert.equal(selection.targetElementId, DAY1_TUTORIAL_TARGETS.structuredPrompt);
  assert.equal(selection.registeredElementCount, 1);
  assert.deepEqual(selection.registeredElementIds, ["structured-prompt-card"]);
  assert.deepEqual(selection.registeredElement, {
    registrationId: "structured-prompt-card",
    targetElementId: DAY1_TUTORIAL_TARGETS.structuredPrompt,
    accessibilityIdentifier: DAY1_TUTORIAL_TARGETS.structuredPrompt,
    role: "card",
    visible: true,
    enabled: true,
    frame: { x: 24, y: 180, width: 360, height: 96 },
  });
});

test("Day 1 tutorial target-selection model rejects non-matching and duplicate target registrations", () => {
  const model = buildDay1TutorialCoachMarkModel({ daySpec: DAY_1_SPEC });

  const missing = resolveDay1TutorialTargetSelection({
    model,
    currentStepId: "day1-commit-send",
    registeredElements: [
      {
        registrationId: "sidebar-root",
        accessibilityIdentifier: DAY1_TUTORIAL_TARGETS.curriculumNavigator,
      },
      {
        registrationId: "wrong-send-button",
        accessibilityIdentifier: "assistant.otherButton",
      },
    ],
  });

  assert.equal(missing.didResolve, false);
  assert.equal(missing.reason, "target_not_registered");
  assert.equal(missing.targetElementId, DAY1_TUTORIAL_TARGETS.sendButton);
  assert.equal(missing.registeredElement, null);
  assert.equal(missing.registeredElementCount, 0);
  assert.deepEqual(missing.registeredElementIds, []);

  const duplicate = resolveDay1TutorialTargetSelection({
    model,
    currentStepId: "day1-commit-send",
    registeredElements: [
      {
        registrationId: "send-primary",
        accessibilityIdentifier: DAY1_TUTORIAL_TARGETS.sendButton,
      },
      {
        registrationId: "send-shadow-copy",
        accessibilityIdentifier: DAY1_TUTORIAL_TARGETS.sendButton,
      },
    ],
  });

  assert.equal(duplicate.didResolve, false);
  assert.equal(duplicate.reason, "target_registration_ambiguous");
  assert.equal(duplicate.targetElementId, DAY1_TUTORIAL_TARGETS.sendButton);
  assert.equal(duplicate.registeredElement, null);
  assert.equal(duplicate.registeredElementCount, 2);
  assert.deepEqual(duplicate.registeredElementIds, ["send-primary", "send-shadow-copy"]);
});

test("Day 1 tutorial highlight view renderer applies highlight only to the resolved target element", () => {
  const model = buildDay1TutorialCoachMarkModel({ daySpec: DAY_1_SPEC });

  const viewState = renderDay1TutorialHighlightViewState({
    model,
    currentStepId: "day1-compose-answer",
    viewportFrame: { x: 0, y: 0, width: 420, height: 640 },
    highlightPadding: 8,
    registeredElements: [
      {
        registrationId: "sidebar-root",
        accessibilityIdentifier: DAY1_TUTORIAL_TARGETS.curriculumNavigator,
        role: "group",
      },
      {
        registrationId: "day-card-one",
        accessibilityIdentifier: DAY1_TUTORIAL_TARGETS.dayOneCard,
        role: "button",
      },
      {
        registrationId: "structured-prompt-card",
        accessibilityIdentifier: DAY1_TUTORIAL_TARGETS.structuredPrompt,
        role: "card",
        frame: { x: 24, y: 180, width: 360, height: 96 },
      },
      {
        registrationId: "composer-send",
        accessibilityIdentifier: DAY1_TUTORIAL_TARGETS.sendButton,
        role: "button",
      },
    ],
  });

  assert.equal(viewState.didRender, true);
  assert.equal(viewState.reason, "target_resolved");
  assert.equal(viewState.overlayActive, true);
  assert.equal(viewState.dimNonTargetAreas, true);
  assert.equal(viewState.highlightSuppressed, false);
  assert.equal(viewState.fallbackAction, "render_highlight");
  assert.equal(viewState.targetElementId, DAY1_TUTORIAL_TARGETS.structuredPrompt);
  assert.equal(viewState.highlightedRegistrationId, "structured-prompt-card");
  assert.equal(viewState.highlightedElement.registrationId, "structured-prompt-card");
  assert.equal(viewState.overlayGeometry.didRender, true);
  assert.equal(viewState.overlayGeometry.preservesTargetVisibility, true);
  assert.deepEqual(viewState.overlayGeometry.overlayFrame, {
    x: 0,
    y: 0,
    width: 420,
    height: 640,
  });
  assert.deepEqual(viewState.overlayGeometry.targetCutoutFrame, {
    x: 16,
    y: 172,
    width: 376,
    height: 112,
  });
  assert.deepEqual(
    viewState.overlayGeometry.dimRegions.map((region) => [region.id, region.frame]),
    [
      ["top", { x: 0, y: 0, width: 420, height: 172 }],
      ["bottom", { x: 0, y: 284, width: 420, height: 356 }],
      ["left", { x: 0, y: 172, width: 16, height: 112 }],
      ["right", { x: 392, y: 172, width: 28, height: 112 }],
    ],
  );
  assert.equal(viewState.overlayGeometry.coverage.coversViewportWithoutTarget, true);
  assert.deepEqual(
    viewState.elements.map((element) => [
      element.registrationId,
      element.highlightState,
      element.isHighlighted,
      element.isDimmed,
    ]),
    [
      ["sidebar-root", "unhighlighted", false, true],
      ["day-card-one", "unhighlighted", false, true],
      ["structured-prompt-card", "highlighted", true, false],
      ["composer-send", "unhighlighted", false, true],
    ],
  );
  assert.equal(viewState.elements.filter((element) => element.isHighlighted).length, 1);
});

test("Day 1 tutorial dimming overlay geometry covers non-target regions and leaves target transparent", () => {
  const model = buildDay1TutorialCoachMarkModel({ daySpec: DAY_1_SPEC });
  const selection = resolveDay1TutorialTargetSelection({
    model,
    currentStepId: "day1-compose-answer",
    registeredElements: [
      {
        registrationId: "structured-prompt-card",
        accessibilityIdentifier: DAY1_TUTORIAL_TARGETS.structuredPrompt,
        frame: { x: 24, y: 180, width: 360, height: 96 },
      },
    ],
  });

  const geometry = renderDay1TutorialDimmingOverlayGeometry({
    selection,
    viewportFrame: { x: 0, y: 0, width: 420, height: 640 },
    highlightPadding: 8,
  });

  assert.equal(geometry.didRender, true);
  assert.equal(geometry.reason, "geometry_rendered");
  assert.equal(geometry.dimNonTargetAreas, true);
  assert.equal(geometry.preservesTargetVisibility, true);
  assert.deepEqual(geometry.overlayFrame, { x: 0, y: 0, width: 420, height: 640 });
  assert.equal(geometry.dimRegionCount, 4);
  assert.equal(geometry.targetVisibleArea, 42112);
  assert.equal(geometry.dimmedArea, 226688);
  assert.deepEqual(geometry.coverage, {
    viewportArea: 268800,
    dimmedArea: 226688,
    transparentArea: 42112,
    coversViewportWithoutTarget: true,
  });

  for (const region of geometry.dimRegions) {
    assert.equal(region.opacity > 0, true);
    assert.equal(region.opacity < 1, true);
    assert.equal(rectanglesOverlap(region.frame, geometry.targetCutoutFrame), false);
  }
});

test("Day 1 tutorial dimming overlay geometry clips target cutout at viewport edge", () => {
  const geometry = renderDay1TutorialDimmingOverlayGeometry({
    selection: {
      didResolve: true,
      registeredElement: {
        registrationId: "edge-target",
        frame: { x: 360, y: 610, width: 80, height: 60 },
      },
    },
    viewportFrame: { x: 0, y: 0, width: 420, height: 640 },
    highlightPadding: 12,
  });

  assert.equal(geometry.didRender, true);
  assert.deepEqual(geometry.targetCutoutFrame, {
    x: 348,
    y: 598,
    width: 72,
    height: 42,
  });
  assert.deepEqual(
    geometry.dimRegions.map((region) => region.id),
    ["top", "left"],
  );
  assert.equal(geometry.coverage.coversViewportWithoutTarget, true);
});

test("Day 1 tutorial highlight view renderer leaves siblings unhighlighted when target resolution fails", () => {
  const model = buildDay1TutorialCoachMarkModel({ daySpec: DAY_1_SPEC });

  const missingTargetViewState = renderDay1TutorialHighlightViewState({
    model,
    currentStepId: "day1-commit-send",
    registeredElements: [
      {
        registrationId: "sidebar-root",
        accessibilityIdentifier: DAY1_TUTORIAL_TARGETS.curriculumNavigator,
      },
      {
        registrationId: "wrong-send-button",
        accessibilityIdentifier: "assistant.otherButton",
      },
      {
        registrationId: "structured-prompt-card",
        accessibilityIdentifier: DAY1_TUTORIAL_TARGETS.structuredPrompt,
      },
    ],
  });

  assert.equal(missingTargetViewState.didRender, false);
  assert.equal(missingTargetViewState.reason, "target_not_registered");
  assert.equal(missingTargetViewState.overlayActive, false);
  assert.equal(missingTargetViewState.dimNonTargetAreas, false);
  assert.equal(missingTargetViewState.highlightSuppressed, true);
  assert.equal(missingTargetViewState.fallbackAction, "suppress_highlight");
  assert.equal(missingTargetViewState.targetElementId, DAY1_TUTORIAL_TARGETS.sendButton);
  assert.equal(missingTargetViewState.highlightedRegistrationId, null);
  assert.equal(missingTargetViewState.highlightedElement, null);
  assert.deepEqual(
    missingTargetViewState.elements.map((element) => [
      element.registrationId,
      element.targetElementId,
      element.highlightState,
      element.isHighlighted,
      element.isDimmed,
    ]),
    [
      ["sidebar-root", DAY1_TUTORIAL_TARGETS.curriculumNavigator, "unhighlighted", false, false],
      ["wrong-send-button", "assistant.otherButton", "unhighlighted", false, false],
      ["structured-prompt-card", DAY1_TUTORIAL_TARGETS.structuredPrompt, "unhighlighted", false, false],
    ],
  );
  assert.equal(missingTargetViewState.elements.filter((element) => element.isHighlighted).length, 0);

  const duplicateTargetViewState = renderDay1TutorialHighlightViewState({
    model,
    currentStepId: "day1-commit-send",
    registeredElements: [
      {
        registrationId: "send-primary",
        accessibilityIdentifier: DAY1_TUTORIAL_TARGETS.sendButton,
      },
      {
        registrationId: "send-shadow-copy",
        accessibilityIdentifier: DAY1_TUTORIAL_TARGETS.sendButton,
      },
      {
        registrationId: "structured-prompt-card",
        accessibilityIdentifier: DAY1_TUTORIAL_TARGETS.structuredPrompt,
      },
    ],
  });

  assert.equal(duplicateTargetViewState.didRender, false);
  assert.equal(duplicateTargetViewState.reason, "target_registration_ambiguous");
  assert.equal(duplicateTargetViewState.overlayActive, false);
  assert.equal(duplicateTargetViewState.highlightSuppressed, true);
  assert.equal(duplicateTargetViewState.fallbackAction, "suppress_highlight");
  assert.equal(duplicateTargetViewState.highlightedRegistrationId, null);
  assert.deepEqual(
    duplicateTargetViewState.elements.map((element) => [
      element.registrationId,
      element.highlightState,
      element.isHighlighted,
      element.isDimmed,
    ]),
    [
      ["send-primary", "unhighlighted", false, false],
      ["send-shadow-copy", "unhighlighted", false, false],
      ["structured-prompt-card", "unhighlighted", false, false],
    ],
  );
  assert.equal(duplicateTargetViewState.elements.filter((element) => element.isHighlighted).length, 0);
});

test("Day 1 tutorial next-step resolver completes controller after final coach mark", () => {
  const model = buildDay1TutorialCoachMarkModel({ daySpec: DAY_1_SPEC });
  const result = resolveNextDay1TutorialCoachMarkControllerState({
    model,
    tutorialConfig: {
      ...model.tutorialConfig,
      menubarTourStepsCompleted: [
        "day1-cue-curriculum",
        "day1-context-first-card",
        "day1-compose-answer",
      ],
    },
    currentStepId: "day1-commit-send",
    targetElementId: DAY1_TUTORIAL_TARGETS.sendButton,
    now: new Date("2026-05-14T09:04:00.000Z"),
  });

  assert.equal(result.didResolve, true);
  assert.equal(result.didAdvance, false);
  assert.equal(result.reason, "tutorial_complete");
  assert.equal(result.nextStep, null);
  assert.equal(result.tutorialConfig.overlayActive, false);
  assert.equal(result.tutorialConfig.flowMode, DAY1_TUTORIAL_FLOW_MODES.unguided);
  assert.equal(result.tutorialConfig.interviewFlowMode, DAY1_TUTORIAL_FLOW_MODES.unguided);
  assert.equal(result.tutorialConfig.guidanceMode, "unguided_chat");
  assert.deepEqual(result.tutorialConfig.menubarTourStepsCompleted, [
    "day1-cue-curriculum",
    "day1-context-first-card",
    "day1-compose-answer",
    "day1-commit-send",
  ]);
  assert.deepEqual(result.controllerState, {
    schemaVersion: DAY1_TUTORIAL_COACH_MARK_SCHEMA_VERSION,
    dayId: 1,
    state: "complete",
    reason: "tutorial_complete",
    overlayActive: false,
    progressionGuardActive: false,
    flowMode: DAY1_TUTORIAL_FLOW_MODES.unguided,
    interviewFlowMode: DAY1_TUTORIAL_FLOW_MODES.unguided,
    guidanceMode: "unguided_chat",
    activeStepId: null,
    activeStep: null,
    activeCoachMark: null,
    activeTargetElementId: null,
    completedStepIds: [
      "day1-cue-curriculum",
      "day1-context-first-card",
      "day1-compose-answer",
      "day1-commit-send",
    ],
    targetInteractionsCompleted: [
      {
        stepId: "day1-commit-send",
        targetElementId: DAY1_TUTORIAL_TARGETS.sendButton,
        cMethodStep: "commit",
        completed: true,
        completedAt: "2026-05-14T09:04:00.000Z",
      },
    ],
  });
});

test("Day 1 tutorial progression can advance from a previously recorded target completion", () => {
  const model = buildDay1TutorialCoachMarkModel({ daySpec: DAY_1_SPEC });

  const result = advanceDay1TutorialCoachMarkProgression({
    model,
    currentStepId: "day1-cue-curriculum",
    tutorialConfig: {
      ...model.tutorialConfig,
      targetInteractionsCompleted: [
        {
          stepId: "day1-cue-curriculum",
          targetElementId: DAY1_TUTORIAL_TARGETS.curriculumNavigator,
          cMethodStep: "cue",
          completed: true,
          completedAt: "2026-05-14T09:01:00.000Z",
        },
      ],
    },
    now: new Date("2026-05-14T09:02:00.000Z"),
  });

  assert.equal(result.accepted, true);
  assert.equal(result.reason, "advanced");
  assert.deepEqual(result.tutorialConfig.menubarTourStepsCompleted, ["day1-cue-curriculum"]);
  assert.equal(result.nextStep.id, "day1-context-first-card");
});

test("Day 1 tutorial completion handling rejects non-current target completions", () => {
  const model = buildDay1TutorialCoachMarkModel({ daySpec: DAY_1_SPEC });

  const result = completeDay1TutorialTargetInteraction({
    model,
    currentStepId: "day1-cue-curriculum",
    targetElementId: DAY1_TUTORIAL_TARGETS.dayOneCard,
  });

  assert.equal(result.didComplete, false);
  assert.equal(result.canProgress, false);
  assert.equal(result.reason, "target_interaction_mismatch");
  assert.equal(result.progressionGuardActive, true);
  assert.equal(result.expectedTargetElementId, DAY1_TUTORIAL_TARGETS.curriculumNavigator);
  assert.deepEqual(result.tutorialConfig.menubarTourStepsCompleted, []);
  assert.deepEqual(result.tutorialConfig.targetInteractionsCompleted, []);
});

test("Day 1 tutorial progression guard becomes non-blocking when overlay is skipped", () => {
  const model = buildDay1TutorialCoachMarkModel({ daySpec: DAY_1_SPEC });

  const result = advanceDay1TutorialCoachMarkProgression({
    model,
    tutorialConfig: {
      ...model.tutorialConfig,
      overlayActive: false,
      skipActivated: true,
    },
    currentStepId: "day1-cue-curriculum",
    interaction: {
      targetElementId: DAY1_TUTORIAL_TARGETS.curriculumNavigator,
      completed: false,
    },
  });

  assert.equal(result.accepted, true);
  assert.equal(result.reason, "overlay_inactive");
  assert.equal(result.progressionGuardActive, false);
  assert.equal(result.tutorialConfig.skipActivated, true);
  assert.equal(result.tutorialConfig.overlayActive, false);
});

test("Day 1 tutorial skip action advances from the current overlay step to the next step", () => {
  const model = buildDay1TutorialCoachMarkModel({ daySpec: DAY_1_SPEC });

  const skipped = skipDay1TutorialCoachMarkOverlay({
    model,
    currentStepId: "day1-context-first-card",
    now: new Date("2026-05-14T09:03:00.000Z"),
  });

  assert.equal(skipped.accepted, true);
  assert.equal(skipped.reason, "overlay_skipped_to_next_step");
  assert.equal(skipped.progressionGuardActive, false);
  assert.deepEqual(skipped.currentStep, {
    id: "day1-context-first-card",
    order: 2,
    cMethodStep: "context",
    targetElementId: DAY1_TUTORIAL_TARGETS.dayOneCard,
  });
  assert.deepEqual(skipped.nextStep, {
    id: "day1-compose-answer",
    order: 3,
    cMethodStep: "compose",
    targetElementId: DAY1_TUTORIAL_TARGETS.structuredPrompt,
  });
  assert.equal(skipped.tutorialConfig.overlayActive, false);
  assert.equal(skipped.tutorialConfig.skipActivated, true);
  assert.equal(skipped.tutorialConfig.guidedQuestionActive, false);
  assert.equal(skipped.tutorialConfig.activeGuidedQuestionId, null);
  assert.equal(skipped.tutorialConfig.flowMode, DAY1_TUTORIAL_FLOW_MODES.unguided);
  assert.equal(skipped.tutorialConfig.interviewFlowMode, DAY1_TUTORIAL_FLOW_MODES.unguided);
  assert.equal(skipped.tutorialConfig.guidanceMode, "unguided_chat");
  assert.equal(skipped.tutorialConfig.overlaySuppressedReason, "user_skipped_overlay");
  assert.equal(skipped.tutorialConfig.skippedOverlayStepId, "day1-context-first-card");
  assert.equal(skipped.tutorialConfig.skippedOverlayAt, "2026-05-14T09:03:00.000Z");
  assert.deepEqual(
    skipped.interviewQuestionRecords.map((question) => [
      question.questionId,
      question.answer,
      question.status,
      question.completed,
      question.completionConfirmed,
    ]),
    [
      ["day1-question-1", "", "pending", false, false],
      ["day1-question-2", "", "pending", false, false],
    ],
  );
  assert.deepEqual(skipped.tutorialConfig.menubarTourStepsCompleted, [
    "day1-cue-curriculum",
    "day1-context-first-card",
  ]);
  assert.deepEqual(skipped.tutorialConfig.targetInteractionsCompleted, []);
  assert.equal(skipped.controllerState.state, "skipped");
  assert.equal(skipped.controllerState.overlayActive, false);
  assert.equal(skipped.controllerState.progressionGuardActive, false);
  assert.equal(skipped.controllerState.flowMode, DAY1_TUTORIAL_FLOW_MODES.unguided);
  assert.equal(skipped.controllerState.interviewFlowMode, DAY1_TUTORIAL_FLOW_MODES.unguided);
  assert.equal(skipped.controllerState.guidanceMode, "unguided_chat");
  assert.equal(skipped.controllerState.activeStepId, null);
  assert.equal(skipped.controllerState.activeStep, null);
  assert.equal(skipped.controllerState.activeCoachMark, null);
  assert.equal(skipped.controllerState.activeTargetElementId, null);
});

test("Day 1 unguided interview mode exposes the complete original interview question set", () => {
  const fullQuestionSpec = {
    ...DAY_1_SPEC,
    key_questions_with_intent: [
      ...DAY_1_SPEC.key_questions_with_intent,
      {
        question: "그 사람이 이 문제를 해결하려고 마지막으로 시도한 방법은 무엇인가요?",
        intent: "최근 해결 시도에서 실제 강도를 확인한다.",
      },
      {
        question: "오늘 바로 다시 물어볼 수 있는 사람은 누구인가요?",
        intent: "Day 1 이후 실행 연결을 만든다.",
      },
    ],
  };
  const model = buildDay1TutorialCoachMarkModel({
    daySpec: fullQuestionSpec,
    guidedQuestionCount: 2,
  });

  const payload = buildDay1UnguidedInterviewModePayload({
    model,
    now: new Date("2026-05-14T09:05:00.000Z"),
  });
  const skipped = skipDay1TutorialCoachMarkOverlay({
    model,
    currentStepId: "day1-context-first-card",
    now: new Date("2026-05-14T09:05:00.000Z"),
  });

  assert.equal(model.tutorialConfig.guidedQuestionsRemaining, 2);
  assert.equal(payload.mode, DAY1_TUTORIAL_FLOW_MODES.unguided);
  assert.equal(payload.exposesCompleteOriginalQuestionSet, true);
  assert.equal(payload.rendersEveryExposedOriginalQuestion, true);
  assert.equal(payload.originalQuestionCount, fullQuestionSpec.key_questions_with_intent.length);
  assert.equal(payload.exposedQuestionCount, fullQuestionSpec.key_questions_with_intent.length);
  assert.equal(payload.structuredPrompt.questions.length, fullQuestionSpec.key_questions_with_intent.length);
  assert.deepEqual(
    payload.structuredPrompt.questions.map((question) => question.questionId),
    ["day1-question-1", "day1-question-2", "day1-question-3", "day1-question-4"],
  );
  assert.deepEqual(
    payload.questionRecords.map((question) => question.question),
    fullQuestionSpec.key_questions_with_intent.map((question) => question.question),
  );
  for (const original of fullQuestionSpec.key_questions_with_intent) {
    assert.equal(
      payload.structuredPrompt.questions.some((question) => question.question.includes(original.question)),
      true,
      `${original.question} should render after overlay skip`,
    );
  }
  assert.equal(payload.questionGuidance.every((question) => question.guided === false), true);
  assert.equal(payload.questionGuidance.every((question) => question.overlayEligible === false), true);
  assert.deepEqual(
    skipped.interviewQuestionRecords.map((question) => question.question),
    fullQuestionSpec.key_questions_with_intent.map((question) => question.question),
  );
  assert.equal(skipped.unguidedInterviewMode.exposesCompleteOriginalQuestionSet, true);
  assert.equal(skipped.unguidedInterviewMode.rendersEveryExposedOriginalQuestion, true);
  assert.equal(skipped.unguidedInterviewMode.structuredPrompt.questions.length, 4);
  assert.equal(skipped.unguidedInterviewMode.exposedQuestionCount, 4);
});

test("Day 1 tutorial skip action preserves prior completed steps and moves beyond the active overlay", () => {
  const model = buildDay1TutorialCoachMarkModel({ daySpec: DAY_1_SPEC });

  const skipped = skipDay1TutorialCoachMarkOverlay({
    model,
    tutorialConfig: {
      ...model.tutorialConfig,
      menubarTourStepsCompleted: ["day1-cue-curriculum"],
    },
    currentStepId: "day1-context-first-card",
    now: new Date("2026-05-14T09:04:00.000Z"),
  });

  assert.equal(skipped.reason, "overlay_skipped_to_next_step");
  assert.deepEqual(skipped.tutorialConfig.menubarTourStepsCompleted, [
    "day1-cue-curriculum",
    "day1-context-first-card",
  ]);
  assert.equal(skipped.nextStep.id, "day1-compose-answer");
  assert.equal(skipped.controllerState.activeStepId, null);
  assert.equal(skipped.controllerState.activeTargetElementId, null);
  assert.equal(skipped.controllerState.completedStepIds.includes("day1-cue-curriculum"), true);
});

test("Day 1 tutorial clears blocking overlay visibility after advancing beyond the guided overlay step", () => {
  const model = buildDay1TutorialCoachMarkModel({ daySpec: DAY_1_SPEC });

  const skipped = skipDay1TutorialCoachMarkOverlay({
    model,
    currentStepId: "day1-context-first-card",
    now: new Date("2026-05-14T09:03:00.000Z"),
  });
  const viewState = renderDay1TutorialHighlightViewState({
    model,
    tutorialConfig: skipped.tutorialConfig,
    controllerState: skipped.controllerState,
    currentStepId: skipped.nextStep.id,
    viewportFrame: { x: 0, y: 0, width: 420, height: 640 },
    registeredElements: [
      {
        registrationId: "structured-prompt-card",
        accessibilityIdentifier: DAY1_TUTORIAL_TARGETS.structuredPrompt,
        frame: { x: 24, y: 180, width: 360, height: 96 },
      },
    ],
  });

  assert.equal(skipped.nextStep.id, "day1-compose-answer");
  assert.equal(skipped.tutorialConfig.overlayActive, false);
  assert.equal(skipped.controllerState.overlayActive, false);
  assert.equal(skipped.controllerState.activeStepId, null);
  assert.equal(skipped.controllerState.activeTargetElementId, null);
  assert.equal(viewState.didRender, false);
  assert.equal(viewState.reason, "overlay_skipped");
  assert.equal(viewState.targetElementId, null);
  assert.equal(viewState.overlayActive, false);
  assert.equal(viewState.dimNonTargetAreas, false);
  assert.equal(viewState.highlightSuppressed, true);
  assert.equal(viewState.highlightedElement, null);
  assert.deepEqual(
    viewState.elements.map((element) => [
      element.registrationId,
      element.highlightState,
      element.isHighlighted,
      element.isDimmed,
    ]),
    [["structured-prompt-card", "unhighlighted", false, false]],
  );
});

function rectanglesOverlap(lhs, rhs) {
  const lhsRight = lhs.x + lhs.width;
  const lhsBottom = lhs.y + lhs.height;
  const rhsRight = rhs.x + rhs.width;
  const rhsBottom = rhs.y + rhs.height;
  return lhs.x < rhsRight
    && lhsRight > rhs.x
    && lhs.y < rhsBottom
    && lhsBottom > rhs.y;
}
