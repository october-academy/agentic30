import { recordFeatureSurfaceOnce } from "./first-surface-tracker.mjs";

export const CURRICULUM_HINT_ELIGIBILITY_SCHEMA_VERSION = 1;
export const CURRICULUM_INLINE_HINT_TRIGGER_SCHEMA_VERSION = 1;
export const CURRICULUM_HINT_CONTENT_RESOLVER_SCHEMA_VERSION = 1;
export const CURRICULUM_INLINE_HINT_TOOLTIP_PRESENTATION_SCHEMA_VERSION = 1;

export const CURRICULUM_FEATURE_HINTS = Object.freeze([
  Object.freeze({
    featureId: "curriculum.navigator",
    targetElementId: "workspace.curriculumSidebar",
    label: "30-day curriculum navigator",
    day1Covered: true,
    hintTitle: "30일 경로",
    hintBody: "오늘 위치와 다음 Day를 여기서 확인합니다.",
  }),
  Object.freeze({
    featureId: "curriculum.day_card",
    targetElementId: "workspace.day.1",
    label: "Day card launcher",
    day1Covered: true,
    hintTitle: "Day 카드",
    hintBody: "카드를 열면 오늘 질문과 실행 기준이 나옵니다.",
  }),
  Object.freeze({
    featureId: "chat.structured_prompt",
    targetElementId: "workspace.chat.structuredPrompt",
    label: "Interview prompt card",
    day1Covered: true,
    hintTitle: "질문 카드",
    hintBody: "짧은 실제 사례를 답으로 남기면 이후 Review에 이어집니다.",
  }),
  Object.freeze({
    featureId: "assistant.send_prompt",
    targetElementId: "assistant.sendPromptButton",
    label: "Send answer button",
    day1Covered: true,
    hintTitle: "답 제출",
    hintBody: "작성한 답을 저장하고 다음 질문으로 넘어갑니다.",
  }),
  Object.freeze({
    featureId: "workspace.switcher",
    targetElementId: "workspace.switcher",
    label: "Workspace switcher",
    day1Covered: true,
    hintTitle: "워크스페이스 전환",
    hintBody: "커리큘럼, 최근 대화, 설정을 전환할 때 씁니다.",
  }),
  Object.freeze({
    featureId: "workspace.settings",
    targetElementId: "workspace.settingsButton",
    label: "Workspace settings",
    day1Covered: true,
    hintTitle: "설정",
    hintBody: "워크스페이스와 알림 설정을 바꿀 때 열어보세요.",
  }),
  Object.freeze({
    featureId: "workspace.help",
    targetElementId: "workspace.helpButton",
    label: "Workspace help",
    day1Covered: true,
    hintTitle: "도움말",
    hintBody: "막히면 도움말에서 현재 화면의 기준을 확인합니다.",
  }),
  Object.freeze({
    featureId: "workspace.recent_conversations",
    targetElementId: "workspace.recentConversationsButton",
    label: "Recent conversations",
    day1Covered: true,
    hintTitle: "최근 대화",
    hintBody: "이전 세션으로 돌아가거나 새 Codex 대화를 시작할 때 씁니다.",
  }),
  Object.freeze({
    featureId: "action.auto_verification",
    targetElementId: "workspace.action.autoVerification",
    label: "Action auto-verification",
    hintTitle: "자동 확인",
    hintBody: "MCP, CLI, Browser Tool, Google Docs/Sheets로 먼저 실행 증거를 확인해보세요.",
  }),
  Object.freeze({
    featureId: "action.evidence_submission",
    targetElementId: "workspace.action.evidenceSubmission",
    label: "Action evidence fallback",
    hintTitle: "증거 제출",
    hintBody: "자동 확인이 안 되면 링크나 파일 증거를 붙이면 됩니다. 진행은 막지 않습니다.",
  }),
  Object.freeze({
    featureId: "review.summary_dashboard",
    targetElementId: "workspace.review.summaryDashboard",
    label: "Review summary dashboard",
    hintTitle: "Review 대시보드",
    hintBody: "지난 7일 요약, 미완료 실행, 다음 행동을 한 번에 확인해보세요.",
  }),
  Object.freeze({
    featureId: "education.interactive_worksheet",
    targetElementId: "workspace.education.interactiveWorksheet",
    label: "Education interactive worksheet",
    hintTitle: "워크시트",
    hintBody: "개념을 읽고 빈칸에 내 제품 상황을 바로 넣어보세요.",
  }),
  Object.freeze({
    featureId: "curriculum.weekly_summary_stack",
    targetElementId: "workspace.curriculum.weeklySummaryStack",
    label: "Weekly summary stack",
    hintTitle: "주간 요약",
    hintBody: "7일마다 보존되는 요약이 다음 주 질문의 컨텍스트가 됩니다.",
  }),
  Object.freeze({
    featureId: "coaching.carry_over",
    targetElementId: "workspace.coaching.carryOver",
    label: "Carry-over coaching",
    hintTitle: "이어가기 코칭",
    hintBody: "미완료 실행은 막지 않고 다음 Day에서 작게 다시 제안합니다.",
  }),
  Object.freeze({
    featureId: "notification.daily_reminder",
    targetElementId: "workspace.settings.notifications",
    label: "9 PM daily reminder setting",
    hintTitle: "저녁 알림",
    hintBody: "미완료 Day는 밤 9시에 알려주며 설정에서 끌 수 있습니다.",
  }),
]);

export const CURRICULUM_ONBOARDING_INLINE_HINT_FEATURE_IDS = Object.freeze(
  CURRICULUM_FEATURE_HINTS.map((feature) => feature.featureId),
);

export function resolveCurriculumHintEligibility({
  features = CURRICULUM_FEATURE_HINTS,
  eligibleFeatureIds = CURRICULUM_ONBOARDING_INLINE_HINT_FEATURE_IDS,
  eligible_feature_ids = undefined,
  configuredOnboardingFeatureIds = undefined,
  configured_onboarding_feature_ids = undefined,
  onboardingFeatureIds = undefined,
  onboarding_feature_ids = undefined,
  day1TutorialModel = null,
  day1CoveredFeatureIds = [],
  day1CoveredTargetElementIds = [],
  state = {},
  now = new Date(),
} = {}) {
  const normalizedFeatures = normalizeFeatureHints(features);
  const eligibleOnboardingFeatureIds = resolveEligibleOnboardingFeatureIds({
    eligibleFeatureIds,
    eligible_feature_ids,
    configuredOnboardingFeatureIds,
    configured_onboarding_feature_ids,
    onboardingFeatureIds,
    onboarding_feature_ids,
  });
  const coverage = resolveDay1FeatureCoverage({
    features: normalizedFeatures,
    day1TutorialModel,
    day1CoveredFeatureIds,
    day1CoveredTargetElementIds,
  });
  const seenFeatureIds = resolveSeenInlineHintFeatureIds(state);
  const featureEvaluations = normalizedFeatures.map((feature) =>
    evaluateFeatureHintEligibility({
      feature,
      coverage,
      seenFeatureIds,
      eligibleOnboardingFeatureIds,
      evaluatedAt: now,
    }),
  );
  const requiredInlineHints = featureEvaluations.filter((feature) => feature.requiresInlineHint);
  const visibleInlineHints = requiredInlineHints.filter((feature) => feature.shouldShowInlineHint);
  const ineligibleFeatures = featureEvaluations.filter((feature) => !feature.requiresInlineHint);

  return {
    schemaVersion: CURRICULUM_HINT_ELIGIBILITY_SCHEMA_VERSION,
    schema: "agentic30.curriculum.hint_eligibility.v1",
    evaluatedAt: toIso(now),
    evaluated_at: toIso(now),
    day1Coverage: coverage,
    day1_coverage: coverage,
    eligibleOnboardingFeatureIds: [...eligibleOnboardingFeatureIds],
    eligible_onboarding_feature_ids: [...eligibleOnboardingFeatureIds],
    featureEvaluations,
    feature_evaluations: featureEvaluations,
    requiredInlineHints,
    required_inline_hints: requiredInlineHints,
    inlineHints: visibleInlineHints.map((feature) => feature.inlineHint),
    inline_hints: visibleInlineHints.map((feature) => feature.inlineHint),
    ineligibleFeatures,
    ineligible_features: ineligibleFeatures,
    requiredFeatureIds: requiredInlineHints.map((feature) => feature.featureId),
    required_feature_ids: requiredInlineHints.map((feature) => feature.featureId),
    visibleFeatureIds: visibleInlineHints.map((feature) => feature.featureId),
    visible_feature_ids: visibleInlineHints.map((feature) => feature.featureId),
  };
}

export function emitInlineHintTriggerForFeatureAppearance({
  state = {},
  featureId = "",
  surface = "",
  emit = null,
  now = new Date(),
  metadata = {},
  ...eligibilityOptions
} = {}) {
  const targetFeatureId = stringOrDefault(featureId, "");
  const rawState = objectOrEmpty(state);
  if (!targetFeatureId) {
    return buildInlineHintEmissionResult({
      state: rawState,
      featureId: "",
      emitted: false,
      reason: "missing_feature_id",
    });
  }

  const eligibility = resolveCurriculumHintEligibility({
    ...eligibilityOptions,
    state: rawState,
    now,
  });
  const featureEvaluation = eligibility.featureEvaluations.find(
    (feature) => feature.featureId === targetFeatureId,
  );

  if (!featureEvaluation?.requiresInlineHint) {
    return buildInlineHintEmissionResult({
      state: rawState,
      featureId: targetFeatureId,
      eligibility,
      featureEvaluation,
      emitted: false,
      reason: featureEvaluation?.reason ?? "unknown_feature",
    });
  }

  if (!featureEvaluation.shouldShowInlineHint) {
    return buildInlineHintEmissionResult({
      state: rawState,
      featureId: targetFeatureId,
      eligibility,
      featureEvaluation,
      emitted: false,
      reason: featureEvaluation.reason,
    });
  }

  const surfaceResult = recordFeatureSurfaceOnce(rawState, {
    featureId: targetFeatureId,
    surfacedAt: now,
    metadata: {
      ...objectOrEmpty(metadata),
      surface: stringOrDefault(surface, ""),
      targetElementId: featureEvaluation.targetElementId,
      target_element_id: featureEvaluation.targetElementId,
    },
  });

  if (!surfaceResult.firstAppearance) {
    return buildInlineHintEmissionResult({
      state: surfaceResult.state,
      featureId: targetFeatureId,
      eligibility,
      featureEvaluation,
      surfaceResult,
      emitted: false,
      reason: surfaceResult.reason,
    });
  }

  const trigger = buildInlineHintTriggerEvent({
    featureEvaluation,
    inlineHint: featureEvaluation.inlineHint,
    surface,
    surfaceRecord: surfaceResult.surfaceRecord,
    now,
  });
  if (typeof emit === "function") {
    emit(trigger);
  }

  return buildInlineHintEmissionResult({
    state: surfaceResult.state,
    featureId: targetFeatureId,
    eligibility,
    featureEvaluation,
    surfaceResult,
    trigger,
    emitted: true,
    reason: "inline_hint_trigger_emitted",
  });
}

export function resolveInlineHintContentForTriggeredFeature(input = {}) {
  const options = typeof input === "string" ? { featureId: input } : objectOrEmpty(input);
  const trigger = objectOrEmpty(options.trigger);
  const targetFeatureId = stringOrDefault(
    options.featureId
      ?? options.feature_id
      ?? options.triggeredFeatureId
      ?? options.triggered_feature_id
      ?? trigger.featureId
      ?? trigger.feature_id
      ?? trigger.id,
    "",
  );
  const resolvedAt = toIso(options.now ?? new Date());

  if (!targetFeatureId) {
    return buildInlineHintContentResolution({
      featureId: "",
      resolvedAt,
      didResolve: false,
      reason: "missing_feature_id",
    });
  }

  const feature = normalizeFeatureHints(options.features ?? CURRICULUM_FEATURE_HINTS)
    .find((candidate) => candidate.featureId === targetFeatureId);

  if (!feature) {
    return buildInlineHintContentResolution({
      featureId: targetFeatureId,
      resolvedAt,
      didResolve: false,
      reason: "unknown_feature",
    });
  }

  const inlineHint = buildInlineHint({
    feature,
    shouldShowInlineHint: true,
    reason: "triggered_feature_content_resolved",
    evaluatedAt: resolvedAt,
  });

  return buildInlineHintContentResolution({
    featureId: targetFeatureId,
    targetElementId: feature.targetElementId,
    resolvedAt,
    didResolve: true,
    reason: "hint_content_resolved",
    content: {
      title: feature.hintTitle,
      body: feature.hintBody,
      assistantMessage: inlineHint.assistantMessage,
      assistant_message: inlineHint.assistant_message,
      displayMode: inlineHint.displayMode,
      display_mode: inlineHint.display_mode,
      blocking: inlineHint.blocking,
      progressionBlocked: inlineHint.progressionBlocked,
      progression_blocked: inlineHint.progression_blocked,
      dismissible: inlineHint.dismissible,
    },
    inlineHint,
  });
}

export function resolveInlineHintTooltipPresentation(input = {}) {
  const options = objectOrEmpty(input);
  const explicitResolution = objectOrEmpty(
    options.resolution
      ?? options.contentResolution
      ?? options.content_resolution
      ?? options.resolvedHint
      ?? options.resolved_hint,
  );
  const resolution = Object.keys(explicitResolution).length > 0
    ? explicitResolution
    : options.didResolve !== undefined || options.did_resolve !== undefined
      ? options
      : {};
  const inlineHint = objectOrEmpty(
    options.inlineHint
      ?? options.inline_hint
      ?? resolution.inlineHint
      ?? resolution.inline_hint,
  );
  const content = objectOrEmpty(resolution.content ?? options.content);
  const presentedAt = toIso(options.now ?? options.presentedAt ?? options.presented_at ?? new Date());
  const featureId = stringOrDefault(
    options.featureId
      ?? options.feature_id
      ?? resolution.featureId
      ?? resolution.feature_id
      ?? inlineHint.featureId
      ?? inlineHint.feature_id,
    "",
  );
  const targetElementId = stringOrDefault(
    options.targetElementId
      ?? options.target_element_id
      ?? resolution.targetElementId
      ?? resolution.target_element_id
      ?? inlineHint.targetElementId
      ?? inlineHint.target_element_id,
    "",
  );
  const dismissed = options.dismissed === true || options.uiState === "dismissed" || options.ui_state === "dismissed";
  const didResolve = resolution.didResolve === true || resolution.did_resolve === true || Object.keys(content).length > 0;

  if (!didResolve || !featureId || !targetElementId) {
    return buildInlineHintTooltipPresentation({
      featureId,
      targetElementId,
      presentedAt,
      visible: false,
      uiState: "unresolved",
      reason: resolution.reason ?? "hint_content_unresolved",
    });
  }

  if (dismissed) {
    return buildInlineHintTooltipPresentation({
      featureId,
      targetElementId,
      presentedAt,
      visible: false,
      uiState: "dismissed",
      reason: "hint_tooltip_dismissed",
      content,
      inlineHint,
    });
  }

  const active = options.active ?? inlineHint.active ?? true;
  if (active === false) {
    return buildInlineHintTooltipPresentation({
      featureId,
      targetElementId,
      presentedAt,
      visible: false,
      uiState: "hidden",
      reason: "hint_tooltip_inactive",
      content,
      inlineHint,
    });
  }

  return buildInlineHintTooltipPresentation({
    featureId,
    targetElementId,
    presentedAt,
    visible: true,
    uiState: "visible",
    reason: "hint_tooltip_presented",
    content,
    inlineHint,
  });
}

export function resolveDay1FeatureCoverage({
  features = CURRICULUM_FEATURE_HINTS,
  day1TutorialModel = null,
  day1CoveredFeatureIds = [],
  day1CoveredTargetElementIds = [],
} = {}) {
  const normalizedFeatures = normalizeFeatureHints(features);
  const coveredTargetElementIds = new Set([
    ...normalizeStringArray(day1CoveredTargetElementIds),
    ...extractDay1TutorialTargetElementIds(day1TutorialModel),
  ]);
  const explicitCoveredFeatureIds = new Set([
    ...normalizeStringArray(day1CoveredFeatureIds),
    ...normalizeStringArray(day1TutorialModel?.day1CoveredFeatureIds),
    ...normalizeStringArray(day1TutorialModel?.day1_covered_feature_ids),
  ]);
  const coveredFeatureIds = normalizedFeatures
    .filter((feature) =>
      feature.day1Covered
        || explicitCoveredFeatureIds.has(feature.featureId)
        || coveredTargetElementIds.has(feature.targetElementId)
    )
    .map((feature) => feature.featureId);

  return {
    source: "day1_tutorial_and_explicit_feature_coverage",
    coveredFeatureIds,
    covered_feature_ids: coveredFeatureIds,
    coveredTargetElementIds: [...coveredTargetElementIds].sort(),
    covered_target_element_ids: [...coveredTargetElementIds].sort(),
  };
}

function evaluateFeatureHintEligibility({
  feature,
  coverage,
  seenFeatureIds,
  eligibleOnboardingFeatureIds,
  evaluatedAt,
}) {
  const coveredFeatureIds = new Set(coverage.coveredFeatureIds ?? coverage.covered_feature_ids ?? []);
  const coveredTargetElementIds = new Set(coverage.coveredTargetElementIds ?? coverage.covered_target_element_ids ?? []);
  const configuredForOnboarding = eligibleOnboardingFeatureIds.has(feature.featureId);
  const coveredInDay1 = coveredFeatureIds.has(feature.featureId)
    || coveredTargetElementIds.has(feature.targetElementId);
  const requiresInlineHint = configuredForOnboarding && !coveredInDay1;
  const alreadySeen = seenFeatureIds.has(feature.featureId);
  const shouldShowInlineHint = requiresInlineHint && !alreadySeen;
  const reason = resolveFeatureHintEligibilityReason({
    configuredForOnboarding,
    coveredInDay1,
    alreadySeen,
  });
  const inlineHint = requiresInlineHint
    ? buildInlineHint({ feature, shouldShowInlineHint, reason, evaluatedAt })
    : null;

  return {
    featureId: feature.featureId,
    feature_id: feature.featureId,
    targetElementId: feature.targetElementId,
    target_element_id: feature.targetElementId,
    label: feature.label,
    configuredForOnboarding,
    configured_for_onboarding: configuredForOnboarding,
    coveredInDay1,
    covered_in_day1: coveredInDay1,
    requiresInlineHint,
    requires_inline_hint: requiresInlineHint,
    shouldShowInlineHint,
    should_show_inline_hint: shouldShowInlineHint,
    reason,
    inlineHint,
    inline_hint: inlineHint,
  };
}

function resolveFeatureHintEligibilityReason({
  configuredForOnboarding,
  coveredInDay1,
  alreadySeen,
}) {
  if (!configuredForOnboarding) return "not_configured_for_onboarding_hint";
  if (coveredInDay1) return "covered_in_day1";
  if (alreadySeen) return "inline_hint_already_seen";
  return "not_covered_in_day1";
}

function resolveEligibleOnboardingFeatureIds({
  eligibleFeatureIds,
  eligible_feature_ids,
  configuredOnboardingFeatureIds,
  configured_onboarding_feature_ids,
  onboardingFeatureIds,
  onboarding_feature_ids,
}) {
  const explicitSources = [
    configuredOnboardingFeatureIds,
    configured_onboarding_feature_ids,
    onboardingFeatureIds,
    onboarding_feature_ids,
    eligible_feature_ids,
  ];
  const explicitFeatureIds = explicitSources.flatMap((source) => normalizeStringArray(source));
  const fallbackFeatureIds = normalizeStringArray(eligibleFeatureIds);
  return new Set(explicitFeatureIds.length > 0 ? explicitFeatureIds : fallbackFeatureIds);
}

function buildInlineHint({ feature, shouldShowInlineHint, reason, evaluatedAt }) {
  return {
    id: `inline-hint-${feature.featureId}`,
    featureId: feature.featureId,
    feature_id: feature.featureId,
    targetElementId: feature.targetElementId,
    target_element_id: feature.targetElementId,
    title: feature.hintTitle,
    body: feature.hintBody,
    assistantMessage: {
      role: "assistant",
      tone: "friendly_senior",
      content: `${feature.hintTitle}\n${feature.hintBody}`,
    },
    assistant_message: {
      role: "assistant",
      tone: "friendly_senior",
      content: `${feature.hintTitle}\n${feature.hintBody}`,
    },
    displayMode: "inline_non_blocking",
    display_mode: "inline_non_blocking",
    blocking: false,
    progressionBlocked: false,
    progression_blocked: false,
    dismissible: true,
    active: shouldShowInlineHint,
    reason,
    createdAt: toIso(evaluatedAt),
    created_at: toIso(evaluatedAt),
  };
}

function buildInlineHintTriggerEvent({
  featureEvaluation,
  inlineHint,
  surface,
  surfaceRecord,
  now,
}) {
  const emittedAt = toIso(now);
  const targetElementId = featureEvaluation.targetElementId;
  return {
    type: "curriculum_inline_hint_triggered",
    schemaVersion: CURRICULUM_INLINE_HINT_TRIGGER_SCHEMA_VERSION,
    schema_version: CURRICULUM_INLINE_HINT_TRIGGER_SCHEMA_VERSION,
    emittedAt,
    emitted_at: emittedAt,
    featureId: featureEvaluation.featureId,
    feature_id: featureEvaluation.featureId,
    targetElementId,
    target_element_id: targetElementId,
    surface: stringOrDefault(surface, ""),
    reason: "first_eligible_feature_surface",
    blocking: false,
    progressionBlocked: false,
    progression_blocked: false,
    displayMode: "inline_non_blocking",
    display_mode: "inline_non_blocking",
    inlineHint,
    inline_hint: inlineHint,
    firstSurface: surfaceRecord,
    first_surface: surfaceRecord,
  };
}

function buildInlineHintEmissionResult({
  state,
  featureId,
  eligibility = null,
  featureEvaluation = null,
  surfaceResult = null,
  trigger = null,
  emitted,
  reason,
}) {
  return {
    state,
    featureId,
    feature_id: featureId,
    eligibility,
    featureEvaluation,
    feature_evaluation: featureEvaluation,
    surfaceResult,
    surface_result: surfaceResult,
    trigger,
    emitted,
    didEmit: emitted,
    did_emit: emitted,
    reason,
  };
}

function buildInlineHintContentResolution({
  featureId,
  targetElementId = "",
  resolvedAt,
  didResolve,
  reason,
  content = null,
  inlineHint = null,
}) {
  return {
    schemaVersion: CURRICULUM_HINT_CONTENT_RESOLVER_SCHEMA_VERSION,
    schema_version: CURRICULUM_HINT_CONTENT_RESOLVER_SCHEMA_VERSION,
    schema: "agentic30.curriculum.hint_content_resolution.v1",
    resolvedAt,
    resolved_at: resolvedAt,
    featureId,
    feature_id: featureId,
    targetElementId,
    target_element_id: targetElementId,
    didResolve,
    did_resolve: didResolve,
    reason,
    content,
    inlineHint,
    inline_hint: inlineHint,
  };
}

function buildInlineHintTooltipPresentation({
  featureId,
  targetElementId,
  presentedAt,
  visible,
  uiState,
  reason,
  content = {},
  inlineHint = {},
}) {
  const title = stringOrDefault(content.title ?? inlineHint.title, "");
  const body = stringOrDefault(content.body ?? inlineHint.body, "");
  const assistantMessage = objectOrEmpty(content.assistantMessage ?? content.assistant_message ?? inlineHint.assistantMessage ?? inlineHint.assistant_message);
  const displayMode = stringOrDefault(content.displayMode ?? content.display_mode ?? inlineHint.displayMode ?? inlineHint.display_mode, "inline_non_blocking");
  const dismissible = content.dismissible === false || inlineHint.dismissible === false ? false : true;
  const blocking = content.blocking === true || inlineHint.blocking === true;
  const progressionBlocked = content.progressionBlocked === true
    || content.progression_blocked === true
    || inlineHint.progressionBlocked === true
    || inlineHint.progression_blocked === true;
  const tooltip = visible
    ? {
        role: "tooltip",
        variant: "inline_hint",
        title,
        body,
        assistantMessage,
        assistant_message: assistantMessage,
        placement: "near_target",
        targetElementId,
        target_element_id: targetElementId,
        arrow: true,
        dimBackground: false,
        dim_background: false,
        highlightTarget: true,
        highlight_target: true,
        dismissButton: dismissible
          ? {
              label: "알겠어요",
              action: "dismiss_inline_hint",
            }
          : null,
        dismiss_button: dismissible
          ? {
              label: "알겠어요",
              action: "dismiss_inline_hint",
            }
          : null,
      }
    : null;

  return {
    schemaVersion: CURRICULUM_INLINE_HINT_TOOLTIP_PRESENTATION_SCHEMA_VERSION,
    schema_version: CURRICULUM_INLINE_HINT_TOOLTIP_PRESENTATION_SCHEMA_VERSION,
    schema: "agentic30.curriculum.inline_hint_tooltip_presentation.v1",
    presentationId: featureId ? `inline-hint-tooltip-${featureId}` : "",
    presentation_id: featureId ? `inline-hint-tooltip-${featureId}` : "",
    featureId,
    feature_id: featureId,
    targetElementId,
    target_element_id: targetElementId,
    displayMode,
    display_mode: displayMode,
    visible,
    active: visible,
    uiState,
    ui_state: uiState,
    blocking,
    progressionBlocked,
    progression_blocked: progressionBlocked,
    dismissible,
    reason,
    presentedAt,
    presented_at: presentedAt,
    tooltip,
  };
}

function normalizeFeatureHints(value) {
  const rawFeatures = Array.isArray(value) ? value : [];
  const seenIds = new Set();
  return rawFeatures
    .map((entry) => {
      const raw = objectOrEmpty(entry);
      const featureId = stringOrDefault(raw.featureId ?? raw.feature_id ?? raw.id, "");
      const targetElementId = stringOrDefault(raw.targetElementId ?? raw.target_element_id, "");
      if (!featureId || !targetElementId || seenIds.has(featureId)) return null;
      seenIds.add(featureId);
      const hintTitle = stringOrDefault(raw.hintTitle ?? raw.hint_title ?? raw.title, raw.label ?? featureId);
      const hintBody = stringOrDefault(raw.hintBody ?? raw.hint_body ?? raw.body, "");
      return {
        ...raw,
        featureId,
        feature_id: featureId,
        targetElementId,
        target_element_id: targetElementId,
        label: stringOrDefault(raw.label, featureId),
        day1Covered: raw.day1Covered === true || raw.day1_covered === true,
        day1_covered: raw.day1Covered === true || raw.day1_covered === true,
        hintTitle,
        hint_title: hintTitle,
        hintBody,
        hint_body: hintBody,
      };
    })
    .filter(Boolean);
}

function extractDay1TutorialTargetElementIds(day1TutorialModel) {
  const raw = objectOrEmpty(day1TutorialModel);
  const stepTargets = Array.isArray(raw.steps)
    ? raw.steps.map((step) => objectOrEmpty(step).targetElementId ?? objectOrEmpty(step).target_element_id)
    : [];
  const explicitTargets = [
    ...(Array.isArray(raw.day1CoveredTargetElementIds) ? raw.day1CoveredTargetElementIds : []),
    ...(Array.isArray(raw.day1_covered_target_element_ids) ? raw.day1_covered_target_element_ids : []),
  ];
  return normalizeStringArray([...stepTargets, ...explicitTargets]);
}

function resolveSeenInlineHintFeatureIds(state) {
  const raw = objectOrEmpty(state);
  const registry = objectOrEmpty(raw.coachMarkRegistry ?? raw.coach_mark_registry ?? raw.hintRegistry ?? raw.hint_registry);
  const seenRecords = [
    ...normalizeStringArray(raw.seenInlineHintFeatureIds ?? raw.seen_inline_hint_feature_ids),
    ...normalizeStringArray(registry.seenInlineHintFeatureIds ?? registry.seen_inline_hint_feature_ids),
    ...normalizeStringArray(registry.dismissedInlineHintFeatureIds ?? registry.dismissed_inline_hint_feature_ids),
    ...normalizeStringArray(registry.seenFeatureHints ?? registry.seen_feature_hints),
    ...normalizeStringArray(registry.dismissedFeatureHints ?? registry.dismissed_feature_hints),
    ...featureIdsFromRecordMap(registry.inlineHintsSeen ?? registry.inline_hints_seen),
    ...featureIdsFromRecordMap(registry.inlineHintsDismissed ?? registry.inline_hints_dismissed),
  ];
  return new Set(seenRecords);
}

function featureIdsFromRecordMap(value) {
  const raw = objectOrEmpty(value);
  return Object.entries(raw)
    .filter(([, entry]) => entry === true || objectOrEmpty(entry).seen === true || objectOrEmpty(entry).dismissed === true)
    .map(([featureId]) => featureId);
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => String(entry ?? "").trim())
    .filter(Boolean);
}

function objectOrEmpty(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function stringOrDefault(value, fallback = "") {
  const text = typeof value === "string" ? value.trim() : "";
  return text || fallback;
}

function toIso(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString();
}
