import { renderUnguidedInterviewDayQuestionSet } from "./interview-day-card.mjs";

export const DAY1_TUTORIAL_COACH_MARK_SCHEMA_VERSION = 1;

export const DAY1_TUTORIAL_TARGETS = Object.freeze({
  curriculumNavigator: "workspace.curriculumSidebar",
  dayOneCard: "workspace.day.1",
  chatThread: "workspace.chatThread",
  structuredPrompt: "workspace.chat.structuredPrompt",
  structuredInput: "workspace.chat.inlineDecisionFreeText",
  sendButton: "assistant.sendPromptButton",
});
export const DAY1_TUTORIAL_FLOW_MODES = Object.freeze({
  guided: "guided",
  unguided: "unguided",
});

const DEFAULT_DAY_1_GOAL = "고객의 어제 행동에서 통증 1개를 압축한다";

export const DAY1_TUTORIAL_C_METHOD_ASSISTANT_MESSAGE_CATALOG = Object.freeze({
  "day1-cue-curriculum": Object.freeze({
    stepId: "day1-cue-curriculum",
    cMethodStep: "cue",
    headline: "Day 1 위치 확인",
    body: "먼저 30일 커리큘럼에서 오늘 위치를 확인해보세요. Day 1은 튜토리얼이면서 실제 첫 데이터입니다.",
    actionLabel: "Day 1 보기",
  }),
  "day1-context-first-card": Object.freeze({
    stepId: "day1-context-first-card",
    cMethodStep: "context",
    headline: "첫 질문 열기",
    body: "Day 1 카드를 열면 첫 Interview 질문이 나옵니다. 답은 연습용이 아니라 이후 Review와 적응형 코칭에 그대로 쓰여요.",
    actionLabel: "질문 열기",
  }),
  "day1-compose-answer": Object.freeze({
    stepId: "day1-compose-answer",
    cMethodStep: "compose",
    headline: "실제 사례로 답하기",
    body: "한 사람의 어제 행동을 기준으로 짧게 적어보세요. 추측보다 실제 상황, 현재 대안, 막힌 지점을 우선하면 됩니다.",
    actionLabel: "답 작성",
  }),
  "day1-commit-send": Object.freeze({
    stepId: "day1-commit-send",
    cMethodStep: "commit",
    headline: "답 제출",
    body: "보내기를 누르면 첫 답이 Day 1 진행 데이터로 저장됩니다. 남은 질문은 같은 흐름으로 이어가면 됩니다.",
    actionLabel: "제출하기",
  }),
});

const BASE_DAY_1_C_METHOD_STEPS = Object.freeze([
  Object.freeze({
    id: "day1-cue-curriculum",
    cMethodStep: "cue",
    targetElementId: DAY1_TUTORIAL_TARGETS.curriculumNavigator,
  }),
  Object.freeze({
    id: "day1-context-first-card",
    cMethodStep: "context",
    targetElementId: DAY1_TUTORIAL_TARGETS.dayOneCard,
  }),
  Object.freeze({
    id: "day1-compose-answer",
    cMethodStep: "compose",
    targetElementId: DAY1_TUTORIAL_TARGETS.structuredPrompt,
  }),
  Object.freeze({
    id: "day1-commit-send",
    cMethodStep: "commit",
    targetElementId: DAY1_TUTORIAL_TARGETS.sendButton,
  }),
]);

export function buildDay1TutorialCoachMarkModel({
  daySpec = {},
  guidedQuestionCount = 2,
  now = new Date(),
} = {}) {
  const goal = stringOrDefault(
    daySpec.day_goal ?? daySpec.dayGoal ?? daySpec.goal,
    DEFAULT_DAY_1_GOAL,
  );
  const questions = normalizeQuestions(
    daySpec.key_questions_with_intent
      ?? daySpec.keyQuestionsWithIntent
      ?? daySpec.key_questions
      ?? daySpec.keyQuestions
      ?? daySpec.questions,
  );
  const safeGuidedQuestionCount = Math.min(
    Math.max(1, normalizePositiveInteger(guidedQuestionCount, 2)),
    2,
    Math.max(1, questions.length),
  );
  const questionGuidance = buildDay1QuestionGuidance({
    questions,
    guidedQuestionCount: safeGuidedQuestionCount,
  });
  const interviewQuestionRecords = buildPendingInterviewQuestionRecords(questionGuidance, now);
  const steps = BASE_DAY_1_C_METHOD_STEPS.map((step, index) =>
    normalizeCoachMarkStep({
      ...step,
      order: index + 1,
      dayGoal: goal,
      questionGuidance: questionGuidance[Math.min(index, safeGuidedQuestionCount - 1)] ?? null,
    }),
  );

  return {
    schemaVersion: DAY1_TUTORIAL_COACH_MARK_SCHEMA_VERSION,
    dayId: 1,
    dayType: "interview",
    tutorialType: "day1_blocking_c_method",
    createdAt: toIso(now),
    interviewQuestionRecords,
    interview_question_records: interviewQuestionRecords,
    overlay: {
      mode: "blocking",
      dimNonTargetAreas: true,
      highlightTarget: true,
      skipAvailable: true,
      skipEffect: "disable_overlay_only",
    },
    tutorialConfig: {
      guidedQuestionsRemaining: safeGuidedQuestionCount,
      unguidedQuestionCount: questionGuidance.filter((question) => !question.guided).length,
      overlayActive: true,
      guidedQuestionActive: true,
      activeGuidedQuestionId: questionGuidance.find((question) => question.guided)?.questionId ?? null,
      flowMode: DAY1_TUTORIAL_FLOW_MODES.guided,
      interviewFlowMode: DAY1_TUTORIAL_FLOW_MODES.guided,
      guidanceMode: "blocking_coach_mark",
      skipActivated: false,
      menubarTourStepsCompleted: [],
    },
    questionGuidance,
    cMethod: {
      name: "C-method",
      sequence: steps.map((step) => step.cMethodStep),
      description: "Assistant chat message plus highlighted target element for each blocking coach mark.",
    },
    steps,
  };
}

export function buildDay1UnguidedInterviewModePayload({
  model = {},
  daySpec = {},
  requestId = null,
  sessionId = null,
  now = new Date(),
} = {}) {
  const questionGuidance = Array.isArray(model?.questionGuidance)
    ? model.questionGuidance.map((question, index) =>
        normalizeQuestionGuidance({
          ...objectOrEmpty(question),
          questionIndex: question?.questionIndex ?? index + 1,
          guidanceMode: "unguided_chat",
          guided: false,
          overlayEligible: false,
        }),
      )
    : [];
  const questionRecords = buildPendingInterviewQuestionRecords(questionGuidance, now);
  const renderer = renderUnguidedInterviewDayQuestionSet({
    daySpec: {
      day_id: 1,
      day_goal: model?.steps?.[0]?.dayGoal ?? daySpec.day_goal ?? daySpec.dayGoal ?? daySpec.goal,
      title: daySpec.title ?? daySpec.day_title ?? daySpec.dayTitle ?? "Day 1 Interview",
      key_questions_with_intent: questionGuidance.map((question) => ({
        id: question.questionId,
        question: question.text,
        intent: question.intent,
      })),
      action_spec: daySpec.action_spec ?? daySpec.actionSpec ?? daySpec.action,
      dependency_map: daySpec.dependency_map ?? daySpec.dependencyMap ?? daySpec.dependencies,
    },
    questionRecords,
    requestId,
    sessionId,
    now,
  });
  const rendersEveryExposedOriginalQuestion =
    renderer.structuredPrompt.questions.length === questionRecords.length
    && questionRecords.every((record) =>
      renderer.structuredPrompt.questions.some((question) => question.question.includes(record.question))
    );
  return {
    mode: DAY1_TUTORIAL_FLOW_MODES.unguided,
    interviewFlowMode: DAY1_TUTORIAL_FLOW_MODES.unguided,
    guidanceMode: "unguided_chat",
    originalQuestionCount: questionGuidance.length,
    exposedQuestionCount: questionRecords.length,
    questionGuidance,
    question_guidance: questionGuidance,
    questionRecords,
    question_records: questionRecords,
    structuredPrompt: renderer.structuredPrompt,
    structured_prompt: renderer.structuredPrompt,
    renderPayload: renderer,
    render_payload: renderer,
    exposesCompleteOriginalQuestionSet: questionRecords.length === questionGuidance.length,
    exposes_complete_original_question_set: questionRecords.length === questionGuidance.length,
    rendersEveryExposedOriginalQuestion,
    renders_every_exposed_original_question: rendersEveryExposedOriginalQuestion,
  };
}

export function validateDay1TutorialCoachMarkStep(step) {
  const raw = objectOrEmpty(step);
  return Boolean(
    raw.id
      && Number.isInteger(raw.order)
      && raw.order > 0
      && raw.cMethodStep
      && raw.targetElementId
      && raw.highlight?.targetElementId === raw.targetElementId
      && raw.assistantMessage?.role === "assistant"
      && raw.assistantMessage?.content,
  );
}

export function renderDay1TutorialCMethodAssistantMessageContent({
  stepId,
  questionGuidance,
} = {}) {
  const catalogEntry = DAY1_TUTORIAL_C_METHOD_ASSISTANT_MESSAGE_CATALOG[stringOrDefault(stepId, "")];
  if (!catalogEntry) return "";
  return appendQuestionContext(catalogEntry.body, normalizeQuestionGuidance(questionGuidance));
}

export function advanceDay1TutorialCoachMarkProgression({
  model,
  tutorialConfig,
  currentStepId,
  interaction,
  now = new Date(),
} = {}) {
  const steps = Array.isArray(model?.steps)
    ? model.steps.filter(validateDay1TutorialCoachMarkStep)
    : [];
  const config = resolveTutorialConfigForModel({ model, tutorialConfig });
  const completedStepIds = new Set(config.menubarTourStepsCompleted);

  if (!config.overlayActive || config.skipActivated) {
    return {
      accepted: true,
      reason: "overlay_inactive",
      progressionGuardActive: false,
      currentStep: null,
      tutorialConfig: config,
    };
  }

  const currentStep = resolveCurrentStep({ steps, completedStepIds, currentStepId });
  if (!currentStep) {
    return {
      accepted: true,
      reason: "tutorial_complete",
      progressionGuardActive: false,
      currentStep: null,
      tutorialConfig: {
        ...config,
        overlayActive: false,
      },
    };
  }

  if (!isCurrentTargetInteractionComplete({ step: currentStep, interaction, tutorialConfig: config })) {
    return {
      accepted: false,
      reason: "target_interaction_incomplete",
      progressionGuardActive: true,
      currentStep: summarizeStep(currentStep),
      expectedTargetElementId: currentStep.targetElementId,
      assistantMessage: `${currentStep.actionLabel}을 먼저 완료해보세요.`,
      tutorialConfig: config,
    };
  }

  completedStepIds.add(currentStep.id);
  const existingTargetInteractionCompletion = findTargetInteractionCompletion(
    config.targetInteractionsCompleted,
    currentStep,
  );
  const targetInteractionsCompleted = upsertTargetInteractionCompletion(
    config.targetInteractionsCompleted,
    hasExplicitCompletedInteraction(interaction)
      ? buildTargetInteractionCompletion(currentStep, interaction, now)
      : existingTargetInteractionCompletion ?? buildTargetInteractionCompletion(currentStep, interaction, now),
  );
  const nextStep = steps.find((step) => !completedStepIds.has(step.id)) ?? null;
  const guidedQuestionState = buildGuidedQuestionStateForRemainingSteps({
    steps,
    completedStepIds,
    nextStep,
  });
  const nextConfig = {
    ...config,
    ...guidedQuestionState,
    overlayActive: Boolean(nextStep && guidedQuestionState.guidedQuestionActive),
    menubarTourStepsCompleted: steps
      .filter((step) => completedStepIds.has(step.id))
      .map((step) => step.id),
    targetInteractionsCompleted,
    lastProgressedAt: toIso(now),
  };

  return {
    accepted: true,
    reason: nextStep ? "advanced" : "tutorial_complete",
    progressionGuardActive: Boolean(nextStep),
    currentStep: summarizeStep(currentStep),
    nextStep: nextStep ? summarizeStep(nextStep) : null,
    tutorialConfig: nextConfig,
  };
}

export function completeDay1TutorialTargetInteraction({
  model,
  tutorialConfig,
  currentStepId,
  targetElementId,
  interaction,
  now = new Date(),
} = {}) {
  const steps = Array.isArray(model?.steps)
    ? model.steps.filter(validateDay1TutorialCoachMarkStep)
    : [];
  const config = resolveTutorialConfigForModel({ model, tutorialConfig });

  if (!config.overlayActive || config.skipActivated) {
    return {
      didComplete: false,
      canProgress: true,
      reason: "overlay_inactive",
      progressionGuardActive: false,
      currentStep: null,
      tutorialConfig: config,
    };
  }

  const completedStepIds = new Set(config.menubarTourStepsCompleted);
  const currentStep = resolveCurrentStep({ steps, completedStepIds, currentStepId });
  if (!currentStep) {
    return {
      didComplete: false,
      canProgress: true,
      reason: "tutorial_complete",
      progressionGuardActive: false,
      currentStep: null,
      tutorialConfig: {
        ...config,
        overlayActive: false,
      },
    };
  }

  const normalizedTargetElementId = stringOrDefault(
    targetElementId
      ?? interaction?.targetElementId
      ?? interaction?.completedTargetElementId
      ?? interaction?.elementId,
    "",
  );
  if (normalizedTargetElementId !== currentStep.targetElementId) {
    return {
      didComplete: false,
      canProgress: false,
      reason: "target_interaction_mismatch",
      progressionGuardActive: true,
      currentStep: summarizeStep(currentStep),
      expectedTargetElementId: currentStep.targetElementId,
      receivedTargetElementId: normalizedTargetElementId,
      tutorialConfig: config,
    };
  }

  const completedInteraction = buildTargetInteractionCompletion(
    currentStep,
    {
      ...objectOrEmpty(interaction),
      targetElementId: normalizedTargetElementId,
      completed: true,
    },
    now,
  );
  const nextConfig = {
    ...config,
    targetInteractionsCompleted: upsertTargetInteractionCompletion(
      config.targetInteractionsCompleted,
      completedInteraction,
    ),
  };
  const progression = advanceDay1TutorialCoachMarkProgression({
    model,
    tutorialConfig: nextConfig,
    currentStepId: currentStep.id,
    now,
  });

  return {
    didComplete: progression.accepted,
    canProgress: progression.accepted,
    reason: progression.reason,
    progressionGuardActive: progression.progressionGuardActive,
    completedInteraction,
    currentStep: progression.currentStep,
    nextStep: progression.nextStep ?? null,
    tutorialConfig: progression.tutorialConfig,
    progression,
  };
}

export function skipDay1TutorialCoachMarkOverlay({
  model,
  tutorialConfig,
  currentStepId,
  now = new Date(),
} = {}) {
  const steps = Array.isArray(model?.steps)
    ? model.steps.filter(validateDay1TutorialCoachMarkStep)
    : [];
  const config = resolveTutorialConfigForModel({ model, tutorialConfig });
  const completedStepIds = new Set(config.menubarTourStepsCompleted);
  const requestedStepId = stringOrDefault(currentStepId, "");
  const currentStep = requestedStepId
    ? steps.find((step) => step.id === requestedStepId) ?? null
    : resolveCurrentStep({ steps, completedStepIds, currentStepId });

  if (currentStep) {
    for (const step of steps) {
      if (step.order <= currentStep.order) {
        completedStepIds.add(step.id);
      }
    }
  }

  const nextStep = steps.find((step) => !completedStepIds.has(step.id)) ?? null;
  const nextConfig = {
    ...config,
    overlayActive: false,
    skipActivated: true,
    guidedQuestionActive: false,
    activeGuidedQuestionId: null,
    flowMode: DAY1_TUTORIAL_FLOW_MODES.unguided,
    interviewFlowMode: DAY1_TUTORIAL_FLOW_MODES.unguided,
    guidanceMode: "unguided_chat",
    overlaySuppressedReason: "user_skipped_overlay",
    menubarTourStepsCompleted: steps
      .filter((step) => completedStepIds.has(step.id))
      .map((step) => step.id),
    skippedOverlayStepId: currentStep?.id ?? null,
    skippedOverlayAt: toIso(now),
  };
  const unguidedInterviewMode = buildDay1UnguidedInterviewModePayload({ model, now });
  const interviewQuestionRecords = unguidedInterviewMode.questionRecords;
  const controllerState = buildCoachMarkControllerState({
    model,
    tutorialConfig: nextConfig,
    activeStep: nextStep,
    reason: currentStep ? "overlay_skipped_to_next_step" : "overlay_skipped",
    progressionGuardActive: false,
  });

  return {
    accepted: true,
    reason: currentStep ? "overlay_skipped_to_next_step" : "overlay_skipped",
    progressionGuardActive: false,
    currentStep: currentStep ? summarizeStep(currentStep) : null,
    nextStep: nextStep ? summarizeStep(nextStep) : null,
    unguidedInterviewMode,
    unguided_interview_mode: unguidedInterviewMode,
    interviewQuestionRecords,
    interview_question_records: interviewQuestionRecords,
    tutorialConfig: nextConfig,
    controllerState,
  };
}

export function resolveNextDay1TutorialCoachMarkControllerState({
  model,
  tutorialConfig,
  currentStepId,
  targetElementId,
  interaction,
  now = new Date(),
} = {}) {
  const completion = completeDay1TutorialTargetInteraction({
    model,
    tutorialConfig,
    currentStepId,
    targetElementId,
    interaction,
    now,
  });
  const controllerState = buildCoachMarkControllerState({
    model,
    tutorialConfig: completion.tutorialConfig,
    activeStep: completion.nextStep,
    reason: completion.reason,
    progressionGuardActive: completion.progressionGuardActive,
  });

  return {
    didResolve: completion.didComplete,
    didAdvance: completion.reason === "advanced",
    reason: completion.reason,
    completedInteraction: completion.completedInteraction ?? null,
    previousStep: completion.currentStep ?? null,
    nextStep: completion.nextStep ?? null,
    tutorialConfig: completion.tutorialConfig,
    controllerState,
    completion,
  };
}

export function resolveDay1TutorialTargetSelection({
  model,
  tutorialConfig,
  controllerState,
  currentStepId,
  registeredElements,
} = {}) {
  const steps = Array.isArray(model?.steps)
    ? model.steps.filter(validateDay1TutorialCoachMarkStep)
    : [];
  const config = resolveTutorialConfigForModel({ model, tutorialConfig });
  const completedStepIds = new Set(config.menubarTourStepsCompleted);
  const activeStep = resolveActiveTargetSelectionStep({
    steps,
    completedStepIds,
    controllerState,
    currentStepId,
  });
  const targetElementId = stringOrDefault(
    controllerState?.activeTargetElementId ?? activeStep?.targetElementId,
    "",
  );

  if (!activeStep || !targetElementId) {
    return {
      didResolve: false,
      reason: "active_step_not_found",
      activeStep: null,
      targetElementId,
      registeredElement: null,
      registeredElementCount: 0,
    };
  }

  const normalizedRegisteredElements = normalizeRegisteredUiElements(registeredElements);
  const matches = normalizedRegisteredElements.filter((element) =>
    element.targetElementId === targetElementId
  );
  const didResolve = matches.length === 1;
  return {
    didResolve,
    reason: didResolve
      ? "target_resolved"
      : matches.length === 0
        ? "target_not_registered"
        : "target_registration_ambiguous",
    activeStep: summarizeStep(activeStep),
    targetElementId,
    registeredElement: didResolve ? matches[0] : null,
    registeredElementCount: matches.length,
    registeredElementIds: matches.map((element) => element.registrationId),
  };
}

export function renderDay1TutorialHighlightViewState({
  model,
  tutorialConfig,
  controllerState,
  currentStepId,
  registeredElements,
  viewportFrame,
  highlightPadding,
} = {}) {
  const config = resolveTutorialConfigForModel({ model, tutorialConfig });
  if (!config.overlayActive) {
    const elements = normalizeRegisteredUiElements(registeredElements);
    return {
      didRender: false,
      reason: config.skipActivated
        ? "overlay_skipped"
        : config.overlaySuppressedReason || "guided_question_inactive",
      overlayActive: false,
      dimNonTargetAreas: false,
      targetElementId: null,
      highlightSuppressed: true,
      fallbackAction: "suppress_highlight",
      highlightedRegistrationId: null,
      highlightedElement: null,
      overlayGeometry: renderDay1TutorialDimmingOverlayGeometry({
        selection: { didResolve: false, reason: config.overlaySuppressedReason || "guided_question_inactive" },
        viewportFrame,
        highlightPadding,
      }),
      elements: elements.map((element) => ({
        ...element,
        highlightState: "unhighlighted",
        isHighlighted: false,
        isDimmed: false,
      })),
    };
  }

  const selection = resolveDay1TutorialTargetSelection({
    model,
    tutorialConfig: config,
    controllerState,
    currentStepId,
    registeredElements,
  });
  const elements = normalizeRegisteredUiElements(registeredElements);
  const highlightedRegistrationId = selection.didResolve
    ? selection.registeredElement.registrationId
    : null;
  const overlayGeometry = renderDay1TutorialDimmingOverlayGeometry({
    selection,
    viewportFrame,
    highlightPadding,
  });

  return {
    didRender: selection.didResolve,
    reason: selection.reason,
    overlayActive: selection.didResolve,
    dimNonTargetAreas: selection.didResolve,
    targetElementId: selection.targetElementId,
    highlightSuppressed: !selection.didResolve,
    fallbackAction: selection.didResolve ? "render_highlight" : "suppress_highlight",
    highlightedRegistrationId,
    highlightedElement: selection.registeredElement,
    overlayGeometry,
    elements: elements.map((element) => {
      const isHighlighted = element.registrationId === highlightedRegistrationId;
      return {
        ...element,
        highlightState: isHighlighted ? "highlighted" : "unhighlighted",
        isHighlighted,
        isDimmed: selection.didResolve ? !isHighlighted : false,
      };
    }),
  };
}

export function renderDay1TutorialDimmingOverlayGeometry({
  selection,
  viewportFrame,
  targetFrame,
  highlightPadding = 8,
} = {}) {
  const viewport = normalizeFrame(viewportFrame);
  const rawTarget = normalizeFrame(targetFrame ?? selection?.registeredElement?.frame);
  const didResolve = selection?.didResolve === true;

  if (!didResolve || !viewport || !rawTarget) {
    return {
      didRender: false,
      reason: didResolve ? "missing_geometry" : selection?.reason ?? "target_not_resolved",
      dimNonTargetAreas: false,
      preservesTargetVisibility: false,
      overlayFrame: viewport,
      viewportFrame: viewport,
      targetFrame: rawTarget,
      targetCutoutFrame: null,
      dimRegions: [],
      dimRegionCount: 0,
      dimmedArea: 0,
      targetVisibleArea: 0,
      coverage: null,
    };
  }

  const paddedTarget = expandFrame(rawTarget, normalizeNonNegativeNumber(highlightPadding, 8));
  const targetCutout = intersectFrames(viewport, paddedTarget);
  if (!targetCutout) {
    return {
      didRender: false,
      reason: "target_outside_viewport",
      dimNonTargetAreas: false,
      preservesTargetVisibility: false,
      overlayFrame: viewport,
      viewportFrame: viewport,
      targetFrame: rawTarget,
      targetCutoutFrame: null,
      dimRegions: [],
      dimRegionCount: 0,
      dimmedArea: 0,
      targetVisibleArea: 0,
      coverage: null,
    };
  }

  const viewportRight = viewport.x + viewport.width;
  const viewportBottom = viewport.y + viewport.height;
  const cutoutRight = targetCutout.x + targetCutout.width;
  const cutoutBottom = targetCutout.y + targetCutout.height;
  const dimRegions = [
    makeDimRegion("top", viewport.x, viewport.y, viewport.width, targetCutout.y - viewport.y),
    makeDimRegion("bottom", viewport.x, cutoutBottom, viewport.width, viewportBottom - cutoutBottom),
    makeDimRegion("left", viewport.x, targetCutout.y, targetCutout.x - viewport.x, targetCutout.height),
    makeDimRegion("right", cutoutRight, targetCutout.y, viewportRight - cutoutRight, targetCutout.height),
  ].filter(Boolean);
  const dimmedArea = dimRegions.reduce((sum, region) => sum + region.area, 0);
  const targetVisibleArea = frameArea(targetCutout);
  const viewportArea = frameArea(viewport);

  return {
    didRender: true,
    reason: "geometry_rendered",
    dimNonTargetAreas: true,
    preservesTargetVisibility: targetVisibleArea > 0,
    overlayFrame: viewport,
    viewportFrame: viewport,
    targetFrame: rawTarget,
    targetCutoutFrame: targetCutout,
    dimRegions,
    dimRegionCount: dimRegions.length,
    dimmedArea,
    targetVisibleArea,
    coverage: {
      viewportArea,
      dimmedArea,
      transparentArea: targetVisibleArea,
      coversViewportWithoutTarget: dimmedArea + targetVisibleArea === viewportArea,
    },
  };
}

function normalizeCoachMarkStep(step) {
  const targetElementId = stringOrDefault(step.targetElementId, "");
  const questionGuidance = normalizeQuestionGuidance(step.questionGuidance);
  const catalogEntry = DAY1_TUTORIAL_C_METHOD_ASSISTANT_MESSAGE_CATALOG[stringOrDefault(step.id, "")];
  const assistantContent = renderDay1TutorialCMethodAssistantMessageContent({
    stepId: step.id,
    questionGuidance,
  });
  return {
    id: stringOrDefault(step.id, ""),
    order: normalizePositiveInteger(step.order, 1),
    cMethodStep: stringOrDefault(step.cMethodStep, ""),
    targetElementId,
    title: stringOrDefault(step.title ?? catalogEntry?.headline, ""),
    actionLabel: stringOrDefault(step.actionLabel ?? catalogEntry?.actionLabel, "계속"),
    blocking: true,
    dimNonTargetAreas: true,
    highlight: {
      targetElementId,
      style: "spotlight",
    },
    assistantMessage: {
      role: "assistant",
      tone: "friendly_senior",
      content: assistantContent,
    },
    questionGuidance,
    reframingContext: {
      originalQuestion: questionGuidance.text,
      intent: questionGuidance.intent,
      availableData: ["pre_day_1_context", "day_1_current_answer"],
      reframedVariant: questionGuidance.text,
    },
  };
}

function buildCoachMarkControllerState({
  model,
  tutorialConfig,
  activeStep,
  reason,
  progressionGuardActive,
}) {
  const config = resolveTutorialConfigForModel({ model, tutorialConfig });
  const step = activeStep ? summarizeStep(activeStep) : null;
  const fullStep = step ? resolveFullStep(model?.steps, step.id) ?? activeStep : null;
  const state = config.skipActivated
    ? "skipped"
    : config.overlayActive && step
      ? "active"
      : "complete";
  const visibleStep = state === "active" ? step : null;
  const visibleFullStep = state === "active" ? fullStep : null;

  return {
    schemaVersion: DAY1_TUTORIAL_COACH_MARK_SCHEMA_VERSION,
    dayId: 1,
    state,
    reason,
    overlayActive: config.overlayActive && state === "active",
    progressionGuardActive: Boolean(progressionGuardActive && state === "active"),
    flowMode: config.flowMode,
    interviewFlowMode: config.interviewFlowMode,
    guidanceMode: config.guidanceMode,
    activeStepId: visibleStep?.id ?? null,
    activeStep: visibleStep,
    activeCoachMark: visibleFullStep ? normalizeControllerCoachMark(visibleFullStep) : null,
    activeTargetElementId: visibleStep?.targetElementId ?? null,
    completedStepIds: config.menubarTourStepsCompleted,
    targetInteractionsCompleted: config.targetInteractionsCompleted,
  };
}

function normalizeControllerCoachMark(step) {
  return {
    id: step.id,
    order: step.order,
    cMethodStep: step.cMethodStep,
    targetElementId: step.targetElementId,
    title: step.title ?? "",
    actionLabel: step.actionLabel ?? "계속",
    blocking: step.blocking === true,
    dimNonTargetAreas: step.dimNonTargetAreas === true,
    highlight: step.highlight ?? {
      targetElementId: step.targetElementId,
      style: "spotlight",
    },
    assistantMessage: step.assistantMessage ?? null,
    questionGuidance: step.questionGuidance ?? null,
    reframingContext: step.reframingContext ?? null,
  };
}

function resolveFullStep(steps, stepId) {
  if (!Array.isArray(steps)) return null;
  return steps.find((step) => step?.id === stepId) ?? null;
}

function resolveTutorialConfigForModel({ model, tutorialConfig } = {}) {
  const config = normalizeTutorialConfig(tutorialConfig ?? model?.tutorialConfig);
  const guidance = resolveCurrentQuestionGuidance({
    questionGuidance: model?.questionGuidance,
    currentQuestionId: config.currentQuestionId ?? config.activeGuidedQuestionId,
  });

  if (guidance && (guidance.guided !== true || guidance.overlayEligible !== true)) {
    return {
      ...config,
      guidedQuestionsRemaining: 0,
      guidedQuestionActive: false,
      activeGuidedQuestionId: null,
      overlayActive: false,
      flowMode: DAY1_TUTORIAL_FLOW_MODES.unguided,
      interviewFlowMode: DAY1_TUTORIAL_FLOW_MODES.unguided,
      guidanceMode: "unguided_chat",
      overlaySuppressedReason: "guided_question_limit_reached",
    };
  }

  return config;
}

function resolveCurrentQuestionGuidance({ questionGuidance, currentQuestionId } = {}) {
  const questionId = stringOrDefault(currentQuestionId, "");
  if (!questionId || !Array.isArray(questionGuidance)) return null;
  return questionGuidance.find((question) => question?.questionId === questionId) ?? null;
}

function resolveCurrentStep({ steps, completedStepIds, currentStepId }) {
  if (currentStepId) {
    const requested = steps.find((step) => step.id === currentStepId);
    if (requested && !completedStepIds.has(requested.id)) return requested;
  }
  return steps.find((step) => !completedStepIds.has(step.id)) ?? null;
}

function resolveActiveTargetSelectionStep({
  steps,
  completedStepIds,
  controllerState,
  currentStepId,
}) {
  const activeStepId = stringOrDefault(
    controllerState?.activeStepId
      ?? controllerState?.activeStep?.id
      ?? currentStepId,
    "",
  );
  if (activeStepId) {
    const requested = steps.find((step) => step.id === activeStepId);
    if (requested) return requested;
  }

  const activeTargetElementId = stringOrDefault(controllerState?.activeTargetElementId, "");
  if (activeTargetElementId) {
    const requested = steps.find((step) => step.targetElementId === activeTargetElementId);
    if (requested) return requested;
  }

  return resolveCurrentStep({ steps, completedStepIds, currentStepId: null });
}

function isCurrentTargetInteractionComplete({ step, interaction, tutorialConfig }) {
  const raw = objectOrEmpty(interaction);
  if (hasExplicitCompletedInteraction(raw)) {
    const targetElementId = stringOrDefault(
      raw.targetElementId
        ?? raw.completedTargetElementId
        ?? raw.elementId,
      step.targetElementId,
    );
    return targetElementId === step.targetElementId;
  }

  const config = normalizeTutorialConfig(tutorialConfig);
  return config.targetInteractionsCompleted.some((entry) =>
    entry.stepId === step.id && entry.targetElementId === step.targetElementId
  );
}

function hasExplicitCompletedInteraction(interaction) {
  const raw = objectOrEmpty(interaction);
  const completed = raw.completed
    ?? raw.interactionCompleted
    ?? raw.currentTargetInteractionComplete
    ?? false;
  return completed === true;
}

function normalizeTutorialConfig(value) {
  const raw = objectOrEmpty(value);
  const guidedQuestionsRemaining = normalizeNonNegativeInteger(raw.guidedQuestionsRemaining, 1);
  const activeGuidedQuestionId = stringOrDefault(
    raw.activeGuidedQuestionId
      ?? raw.active_guided_question_id
      ?? raw.currentGuidedQuestionId
      ?? raw.current_guided_question_id,
    "",
  );
  const currentQuestionId = stringOrDefault(
    raw.currentQuestionId
      ?? raw.current_question_id
      ?? raw.activeQuestionId
      ?? raw.active_question_id
      ?? raw.questionId
      ?? raw.question_id
      ?? activeGuidedQuestionId,
    "",
  );
  const hasExplicitGuidedQuestionActivity = Object.prototype.hasOwnProperty.call(raw, "guidedQuestionActive")
    || Object.prototype.hasOwnProperty.call(raw, "guided_question_active")
    || Object.prototype.hasOwnProperty.call(raw, "activeGuidedQuestionId")
    || Object.prototype.hasOwnProperty.call(raw, "active_guided_question_id")
    || Object.prototype.hasOwnProperty.call(raw, "currentGuidedQuestionId")
    || Object.prototype.hasOwnProperty.call(raw, "current_guided_question_id");
  const hasExplicitGuidedQuestionActiveFlag = Object.prototype.hasOwnProperty.call(raw, "guidedQuestionActive")
    || Object.prototype.hasOwnProperty.call(raw, "guided_question_active");
  const guidedQuestionActive = hasExplicitGuidedQuestionActivity
    ? hasExplicitGuidedQuestionActiveFlag
      ? (raw.guidedQuestionActive ?? raw.guided_question_active) === true
      : Boolean(activeGuidedQuestionId)
    : guidedQuestionsRemaining > 0;
  const skipActivated = raw.skipActivated === true || raw.skip_activated === true;
  const flowMode = normalizeTutorialFlowMode(raw.flowMode ?? raw.flow_mode, {
    fallback: skipActivated ? DAY1_TUTORIAL_FLOW_MODES.unguided : DAY1_TUTORIAL_FLOW_MODES.guided,
  });
  const interviewFlowMode = normalizeTutorialFlowMode(
    raw.interviewFlowMode ?? raw.interview_flow_mode,
    { fallback: flowMode },
  );
  const guidanceMode = stringOrDefault(
    raw.guidanceMode ?? raw.guidance_mode,
    interviewFlowMode === DAY1_TUTORIAL_FLOW_MODES.unguided
      ? "unguided_chat"
      : "blocking_coach_mark",
  );
  return {
    guidedQuestionsRemaining,
    activeGuidedQuestionId: activeGuidedQuestionId || null,
    currentQuestionId: currentQuestionId || null,
    guidedQuestionActive,
    overlayActive: raw.overlayActive !== false
      && !skipActivated
      && guidedQuestionsRemaining > 0
      && guidedQuestionActive,
    skipActivated,
    flowMode,
    interviewFlowMode,
    guidanceMode,
    menubarTourStepsCompleted: Array.isArray(raw.menubarTourStepsCompleted)
      ? raw.menubarTourStepsCompleted.map((entry) => String(entry ?? "").trim()).filter(Boolean)
      : [],
    targetInteractionsCompleted: normalizeTargetInteractionCompletions(raw.targetInteractionsCompleted),
    skippedOverlayStepId: stringOrDefault(raw.skippedOverlayStepId ?? raw.skipped_overlay_step_id, "") || null,
    skippedOverlayAt: stringOrDefault(raw.skippedOverlayAt ?? raw.skipped_overlay_at, ""),
    overlaySuppressedReason: stringOrDefault(raw.overlaySuppressedReason ?? raw.overlay_suppressed_reason, ""),
  };
}

function normalizeTutorialFlowMode(value, { fallback } = {}) {
  const normalized = String(value ?? "")
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  return Object.values(DAY1_TUTORIAL_FLOW_MODES).includes(normalized)
    ? normalized
    : fallback;
}

function buildTargetInteractionCompletion(step, interaction, completedAt) {
  const raw = objectOrEmpty(interaction);
  return {
    stepId: step.id,
    targetElementId: step.targetElementId,
    cMethodStep: step.cMethodStep,
    completed: true,
    completedAt: toIso(raw.completedAt ?? raw.completed_at ?? completedAt),
  };
}

function upsertTargetInteractionCompletion(existing, completion) {
  const normalized = normalizeTargetInteractionCompletions(existing);
  const next = normalized.filter((entry) =>
    !(entry.stepId === completion.stepId && entry.targetElementId === completion.targetElementId)
  );
  next.push(completion);
  return next.sort((lhs, rhs) => lhs.completedAt.localeCompare(rhs.completedAt));
}

function findTargetInteractionCompletion(existing, step) {
  return normalizeTargetInteractionCompletions(existing).find((entry) =>
    entry.stepId === step.id && entry.targetElementId === step.targetElementId
  ) ?? null;
}

function normalizeTargetInteractionCompletions(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      const raw = objectOrEmpty(entry);
      const stepId = stringOrDefault(raw.stepId ?? raw.step_id, "");
      const targetElementId = stringOrDefault(raw.targetElementId ?? raw.target_element_id, "");
      if (!stepId || !targetElementId) return null;
      return {
        stepId,
        targetElementId,
        cMethodStep: stringOrDefault(raw.cMethodStep ?? raw.c_method_step, ""),
        completed: true,
        completedAt: stringOrDefault(raw.completedAt ?? raw.completed_at, ""),
      };
    })
    .filter(Boolean);
}

function buildGuidedQuestionStateForRemainingSteps({ steps, completedStepIds, nextStep }) {
  const remainingGuidedQuestionIds = new Set(
    steps
      .filter((step) => !completedStepIds.has(step.id))
      .map((step) => step.questionGuidance)
      .filter((question) => question?.guided === true && question?.overlayEligible === true)
      .map((question) => question.questionId)
      .filter(Boolean),
  );
  const nextQuestion = nextStep?.questionGuidance;
  const nextActiveGuidedQuestionId = nextQuestion?.guided === true && nextQuestion?.overlayEligible === true
    ? nextQuestion.questionId
    : null;
  const hasActiveGuidedQuestion = Boolean(nextActiveGuidedQuestionId);

  return {
    guidedQuestionsRemaining: remainingGuidedQuestionIds.size,
    activeGuidedQuestionId: nextActiveGuidedQuestionId,
    guidedQuestionActive: hasActiveGuidedQuestion,
    flowMode: hasActiveGuidedQuestion
      ? DAY1_TUTORIAL_FLOW_MODES.guided
      : DAY1_TUTORIAL_FLOW_MODES.unguided,
    interviewFlowMode: hasActiveGuidedQuestion
      ? DAY1_TUTORIAL_FLOW_MODES.guided
      : DAY1_TUTORIAL_FLOW_MODES.unguided,
    guidanceMode: hasActiveGuidedQuestion ? "blocking_coach_mark" : "unguided_chat",
  };
}

function normalizeRegisteredUiElements(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry, index) => {
      const raw = objectOrEmpty(entry);
      const targetElementId = stringOrDefault(
        raw.targetElementId
          ?? raw.target_element_id
          ?? raw.accessibilityIdentifier
          ?? raw.accessibility_identifier
          ?? raw.identifier
          ?? raw.id,
        "",
      );
      if (!targetElementId) return null;
      return {
        registrationId: stringOrDefault(
          raw.registrationId ?? raw.registration_id ?? raw.nodeId ?? raw.node_id,
          `${targetElementId}#${index + 1}`,
        ),
        targetElementId,
        accessibilityIdentifier: stringOrDefault(
          raw.accessibilityIdentifier ?? raw.accessibility_identifier ?? raw.identifier,
          targetElementId,
        ),
        role: stringOrDefault(raw.role ?? raw.kind ?? raw.elementType ?? raw.element_type, "unknown"),
        visible: raw.visible !== false,
        enabled: raw.enabled !== false,
        frame: normalizeFrame(raw.frame) ?? objectOrEmpty(raw.frame),
      };
    })
    .filter(Boolean);
}

function normalizeFrame(value) {
  const raw = objectOrEmpty(value);
  const x = normalizeFiniteNumber(raw.x ?? raw.left ?? raw.minX, null);
  const y = normalizeFiniteNumber(raw.y ?? raw.top ?? raw.minY, null);
  const width = normalizeFiniteNumber(raw.width ?? raw.w, null);
  const height = normalizeFiniteNumber(raw.height ?? raw.h, null);
  if (x === null || y === null || width === null || height === null || width <= 0 || height <= 0) {
    return null;
  }
  return { x, y, width, height };
}

function expandFrame(frame, padding) {
  return {
    x: frame.x - padding,
    y: frame.y - padding,
    width: frame.width + padding * 2,
    height: frame.height + padding * 2,
  };
}

function intersectFrames(lhs, rhs) {
  const x = Math.max(lhs.x, rhs.x);
  const y = Math.max(lhs.y, rhs.y);
  const right = Math.min(lhs.x + lhs.width, rhs.x + rhs.width);
  const bottom = Math.min(lhs.y + lhs.height, rhs.y + rhs.height);
  const width = right - x;
  const height = bottom - y;
  if (width <= 0 || height <= 0) return null;
  return { x, y, width, height };
}

function makeDimRegion(id, x, y, width, height) {
  if (width <= 0 || height <= 0) return null;
  const frame = { x, y, width, height };
  return {
    id,
    frame,
    opacity: 0.62,
    area: frameArea(frame),
  };
}

function frameArea(frame) {
  return frame.width * frame.height;
}

function summarizeStep(step) {
  return {
    id: step.id,
    order: step.order,
    cMethodStep: step.cMethodStep,
    targetElementId: step.targetElementId,
  };
}

function appendQuestionContext(content, question) {
  if (!question.text) return content;
  return `${content}\n\n현재 질문: ${question.text}\n의도: ${question.intent}`;
}

function buildDay1QuestionGuidance({ questions, guidedQuestionCount }) {
  return questions.map((question, index) => {
    const normalized = normalizeQuestion(question);
    const questionIndex = index + 1;
    const guided = questionIndex <= guidedQuestionCount;
    return {
      dayId: 1,
      questionIndex,
      questionId: `day1-question-${questionIndex}`,
      text: normalized.text,
      intent: normalized.intent,
      guided,
      guidanceMode: guided ? "blocking_coach_mark" : "unguided_chat",
      overlayEligible: guided,
    };
  });
}

function buildPendingInterviewQuestionRecords(questionGuidance, now) {
  const updatedAt = toIso(now);
  return Array.isArray(questionGuidance)
    ? questionGuidance.map((question, index) => {
        const normalized = normalizeQuestionGuidance({
          ...objectOrEmpty(question),
          questionIndex: question?.questionIndex ?? index + 1,
        });
        return {
          questionId: normalized.questionId,
          question_id: normalized.questionId,
          question: normalized.text,
          intent: normalized.intent,
          answer: "",
          status: "pending",
          answerStatus: "pending",
          answer_status: "pending",
          completed: false,
          completionConfirmed: false,
          completion_confirmed: false,
          answeredAt: "",
          answered_at: "",
          updatedAt,
          updated_at: updatedAt,
        };
      })
    : [];
}

function normalizeQuestionGuidance(value) {
  const raw = objectOrEmpty(value);
  if (!raw.text && !raw.question && !raw.prompt) {
    const question = normalizeQuestion(value);
    return {
      dayId: 1,
      questionIndex: 1,
      questionId: "day1-question-1",
      text: question.text,
      intent: question.intent,
      guided: true,
      guidanceMode: "blocking_coach_mark",
      overlayEligible: true,
    };
  }
  const questionIndex = normalizePositiveInteger(raw.questionIndex ?? raw.question_index, 1);
  const guided = raw.guided !== false && raw.guidanceMode !== "unguided_chat";
  return {
    dayId: normalizePositiveInteger(raw.dayId ?? raw.day_id, 1),
    questionIndex,
    questionId: stringOrDefault(raw.questionId ?? raw.question_id, `day1-question-${questionIndex}`),
    text: stringOrDefault(raw.text ?? raw.question ?? raw.prompt, ""),
    intent: stringOrDefault(
      raw.intent ?? raw.intent_description ?? raw.intentDescription,
      "질문 의도에 맞춰 구체적인 실제 행동을 확보한다.",
    ),
    guided,
    guidanceMode: guided ? "blocking_coach_mark" : "unguided_chat",
    overlayEligible: guided,
  };
}

function normalizeQuestions(value) {
  const source = Array.isArray(value) ? value : [];
  const normalized = source.map(normalizeQuestion).filter((entry) => entry.text);
  if (normalized.length > 0) return normalized;
  return [
    {
      text: "그 통증, 누가 어제 어떤 행동으로 보여줬나요?",
      intent: "상상한 페르소나가 아니라 실제 관찰된 행동을 확보한다.",
    },
    {
      text: "현재 대안은 무엇이고 비용은 어느 정도인가요?",
      intent: "status quo와 전환 비용을 확인한다.",
    },
  ];
}

function normalizeQuestion(value) {
  if (!value) {
    return { text: "", intent: "" };
  }
  if (typeof value === "string") {
    return {
      text: value.trim(),
      intent: "질문 의도에 맞춰 구체적인 실제 행동을 확보한다.",
    };
  }
  const raw = objectOrEmpty(value);
  return {
    text: stringOrDefault(raw.question ?? raw.text ?? raw.prompt, ""),
    intent: stringOrDefault(
      raw.intent ?? raw.intent_description ?? raw.intentDescription,
      "질문 의도에 맞춰 구체적인 실제 행동을 확보한다.",
    ),
  };
}

function normalizePositiveInteger(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.trunc(n));
}

function normalizeNonNegativeInteger(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.trunc(n));
}

function normalizeNonNegativeNumber(value, fallback) {
  const n = normalizeFiniteNumber(value, fallback);
  return Math.max(0, n);
}

function normalizeFiniteNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
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
