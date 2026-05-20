import test from "node:test";
import assert from "node:assert/strict";

import {
  CURRICULUM_FEATURE_HINTS,
  CURRICULUM_HINT_CONTENT_RESOLVER_SCHEMA_VERSION,
  CURRICULUM_HINT_ELIGIBILITY_SCHEMA_VERSION,
  CURRICULUM_INLINE_HINT_TOOLTIP_PRESENTATION_SCHEMA_VERSION,
  CURRICULUM_INLINE_HINT_TRIGGER_SCHEMA_VERSION,
  CURRICULUM_ONBOARDING_INLINE_HINT_FEATURE_IDS,
  emitInlineHintTriggerForFeatureAppearance,
  resolveCurriculumHintEligibility,
  resolveDay1FeatureCoverage,
  resolveInlineHintContentForTriggeredFeature,
  resolveInlineHintTooltipPresentation,
} from "../sidecar/curriculum-hint-eligibility.mjs";
test("hint eligibility marks features not covered in OpenDesign Day as requiring inline hints", () => {
  const eligibility = resolveCurriculumHintEligibility({
    now: "2026-05-14T09:10:00.000Z",
  });

  assert.equal(eligibility.schemaVersion, CURRICULUM_HINT_ELIGIBILITY_SCHEMA_VERSION);
  assert.equal(eligibility.evaluatedAt, "2026-05-14T09:10:00.000Z");
  assert.equal(
    eligibility.day1Coverage.coveredFeatureIds.includes("chat.structured_prompt"),
    true,
  );
  assert.equal(
    eligibility.requiredFeatureIds.includes("chat.structured_prompt"),
    false,
  );
  assert.deepEqual(
    [
      "action.auto_verification",
      "action.evidence_submission",
      "review.summary_dashboard",
      "education.interactive_worksheet",
      "curriculum.weekly_summary_stack",
      "coaching.carry_over",
      "notification.daily_reminder",
    ].every((featureId) => eligibility.requiredFeatureIds.includes(featureId)),
    true,
  );
  assert.equal(
    eligibility.featureEvaluations.find((item) => item.featureId === "action.auto_verification").reason,
    "not_covered_in_day1",
  );
  assert.equal(
    eligibility.featureEvaluations.find((item) => item.featureId === "action.auto_verification").inlineHint.blocking,
    false,
  );
  assert.equal(
    eligibility.featureEvaluations.find((item) => item.featureId === "action.auto_verification").inlineHint.displayMode,
    "inline_non_blocking",
  );
});

test("Day 1 feature coverage combines explicit flags and OpenDesign target matches", () => {
  const coverage = resolveDay1FeatureCoverage({
    features: [
      {
        featureId: "covered.by.target",
        targetElementId: "workspace.chat.structuredPrompt",
        label: "Covered by Day 1 step target",
      },
      {
        featureId: "covered.by.explicit.id",
        targetElementId: "workspace.otherExplicit",
        label: "Covered by explicit id",
      },
      {
        featureId: "covered.by.flag",
        targetElementId: "workspace.otherFlag",
        label: "Covered by Day 1 flag",
        day1Covered: true,
      },
      {
        featureId: "uncovered",
        targetElementId: "workspace.futureFeature",
        label: "Future feature",
      },
    ],
    day1CoveredTargetElementIds: ["workspace.chat.structuredPrompt"],
    day1CoveredFeatureIds: ["covered.by.explicit.id"],
  });

  assert.deepEqual(
    coverage.coveredFeatureIds.sort(),
    [
      "covered.by.explicit.id",
      "covered.by.flag",
      "covered.by.target",
    ].sort(),
  );
  assert.equal(coverage.coveredFeatureIds.includes("uncovered"), false);
  assert.deepEqual(coverage.coveredTargetElementIds, ["workspace.chat.structuredPrompt"]);
});

test("seen or dismissed non-Day-1 features still require hints but are not shown again", () => {
  const eligibility = resolveCurriculumHintEligibility({
    features: CURRICULUM_FEATURE_HINTS,
    state: {
      coachMarkRegistry: {
        seenInlineHintFeatureIds: ["action.auto_verification"],
        inlineHintsDismissed: {
          "review.summary_dashboard": {
            dismissed: true,
            dismissedAt: "2026-05-14T09:08:00.000Z",
          },
        },
      },
    },
    now: "2026-05-14T09:10:00.000Z",
  });
  const action = eligibility.featureEvaluations.find((item) => item.featureId === "action.auto_verification");
  const review = eligibility.featureEvaluations.find((item) => item.featureId === "review.summary_dashboard");

  assert.equal(action.requiresInlineHint, true);
  assert.equal(action.shouldShowInlineHint, false);
  assert.equal(action.reason, "inline_hint_already_seen");
  assert.equal(action.inlineHint.active, false);
  assert.equal(review.requires_inline_hint, true);
  assert.equal(review.should_show_inline_hint, false);
  assert.equal(eligibility.visibleFeatureIds.includes("action.auto_verification"), false);
  assert.equal(eligibility.visibleFeatureIds.includes("review.summary_dashboard"), false);
  assert.equal(eligibility.requiredFeatureIds.includes("action.auto_verification"), true);
  assert.equal(eligibility.requiredFeatureIds.includes("review.summary_dashboard"), true);
});

test("only configured onboarding features can produce inline hint triggers", () => {
  const eligibility = resolveCurriculumHintEligibility({
    features: [
      ...CURRICULUM_FEATURE_HINTS,
      {
        featureId: "experimental.unconfigured_feature",
        targetElementId: "workspace.experimental.unconfiguredFeature",
        label: "Experimental feature",
        hintTitle: "Experimental",
        hintBody: "This should not appear during onboarding.",
      },
    ],
    now: "2026-05-14T09:10:00.000Z",
  });
  const unconfigured = eligibility.featureEvaluations.find(
    (item) => item.featureId === "experimental.unconfigured_feature",
  );

  assert.deepEqual(
    eligibility.eligibleOnboardingFeatureIds,
    [...CURRICULUM_ONBOARDING_INLINE_HINT_FEATURE_IDS],
  );
  assert.equal(unconfigured.configuredForOnboarding, false);
  assert.equal(unconfigured.requiresInlineHint, false);
  assert.equal(unconfigured.shouldShowInlineHint, false);
  assert.equal(unconfigured.inlineHint, null);
  assert.equal(unconfigured.reason, "not_configured_for_onboarding_hint");
  assert.equal(eligibility.requiredFeatureIds.includes("experimental.unconfigured_feature"), false);
  assert.equal(eligibility.visibleFeatureIds.includes("experimental.unconfigured_feature"), false);
});

test("configured onboarding feature allowlist can be supplied explicitly", () => {
  const eligibility = resolveCurriculumHintEligibility({
    features: [
      {
        featureId: "configured.custom_feature",
        targetElementId: "workspace.customFeature",
        label: "Configured custom feature",
        hintTitle: "Custom feature",
        hintBody: "This configured feature can show an inline hint.",
      },
      {
        featureId: "unconfigured.custom_feature",
        targetElementId: "workspace.unconfiguredCustomFeature",
        label: "Unconfigured custom feature",
        hintTitle: "Unconfigured feature",
        hintBody: "This feature is not part of onboarding.",
      },
    ],
    configuredOnboardingFeatureIds: ["configured.custom_feature"],
    now: "2026-05-14T09:10:00.000Z",
  });
  const configured = eligibility.featureEvaluations.find((item) => item.featureId === "configured.custom_feature");
  const unconfigured = eligibility.featureEvaluations.find((item) => item.featureId === "unconfigured.custom_feature");

  assert.deepEqual(eligibility.eligibleOnboardingFeatureIds, ["configured.custom_feature"]);
  assert.equal(configured.configuredForOnboarding, true);
  assert.equal(configured.requiresInlineHint, true);
  assert.equal(configured.shouldShowInlineHint, true);
  assert.equal(configured.inlineHint.active, true);
  assert.equal(unconfigured.configuredForOnboarding, false);
  assert.equal(unconfigured.requiresInlineHint, false);
  assert.equal(unconfigured.inlineHint, null);
  assert.deepEqual(eligibility.requiredFeatureIds, ["configured.custom_feature"]);
  assert.deepEqual(eligibility.visibleFeatureIds, ["configured.custom_feature"]);
});

test("eligible feature appearance emits exactly one inline hint trigger on first surface", () => {
  const emitted = [];
  const first = emitInlineHintTriggerForFeatureAppearance({
    state: {},
    featureId: "action.auto_verification",
    surface: "action_day_card",
    now: "2026-05-14T09:10:00.000Z",
    metadata: {
      dayId: 2,
    },
    emit: (event) => emitted.push(event),
  });
  const repeat = emitInlineHintTriggerForFeatureAppearance({
    state: first.state,
    featureId: "action.auto_verification",
    surface: "action_day_card",
    now: "2026-05-14T09:12:00.000Z",
    emit: (event) => emitted.push(event),
  });

  assert.equal(first.emitted, true);
  assert.equal(first.reason, "inline_hint_trigger_emitted");
  assert.equal(first.trigger.type, "curriculum_inline_hint_triggered");
  assert.equal(first.trigger.schemaVersion, CURRICULUM_INLINE_HINT_TRIGGER_SCHEMA_VERSION);
  assert.equal(first.trigger.featureId, "action.auto_verification");
  assert.equal(first.trigger.targetElementId, "workspace.action.autoVerification");
  assert.equal(first.trigger.surface, "action_day_card");
  assert.equal(first.trigger.blocking, false);
  assert.equal(first.trigger.inlineHint.displayMode, "inline_non_blocking");
  assert.equal(first.trigger.firstSurface.firstSurfacedAt, "2026-05-14T09:10:00.000Z");
  assert.equal(first.state.firstSurfaceRegistry.surfacedFeatures["action.auto_verification"].metadata.dayId, 2);
  assert.equal(repeat.emitted, false);
  assert.equal(repeat.reason, "already_surfaced");
  assert.equal(
    repeat.state.firstSurfaceRegistry.surfacedFeatures["action.auto_verification"].firstSurfacedAt,
    "2026-05-14T09:10:00.000Z",
  );
  assert.equal(emitted.length, 1);
  assert.deepEqual(emitted[0], first.trigger);
});

test("inline hint trigger emission skips Day-1-covered and already-seen surfaces", () => {
  const emitted = [];
  const covered = emitInlineHintTriggerForFeatureAppearance({
    state: {},
    featureId: "chat.structured_prompt",
    now: "2026-05-14T09:10:00.000Z",
    emit: (event) => emitted.push(event),
  });
  const alreadySeen = emitInlineHintTriggerForFeatureAppearance({
    state: {
      coachMarkRegistry: {
        seenInlineHintFeatureIds: ["review.summary_dashboard"],
      },
    },
    featureId: "review.summary_dashboard",
    now: "2026-05-14T09:11:00.000Z",
    emit: (event) => emitted.push(event),
  });

  assert.equal(covered.emitted, false);
  assert.equal(covered.reason, "covered_in_day1");
  assert.equal(covered.state.firstSurfaceRegistry, undefined);
  assert.equal(alreadySeen.emitted, false);
  assert.equal(alreadySeen.reason, "inline_hint_already_seen");
  assert.equal(alreadySeen.state.firstSurfaceRegistry, undefined);
  assert.equal(emitted.length, 0);
});

test("hint content resolver maps a triggered feature id to the canonical inline hint", () => {
  const resolved = resolveInlineHintContentForTriggeredFeature({
    featureId: "action.auto_verification",
    now: "2026-05-14T09:15:00.000Z",
  });

  assert.equal(resolved.schemaVersion, CURRICULUM_HINT_CONTENT_RESOLVER_SCHEMA_VERSION);
  assert.equal(resolved.schema, "agentic30.curriculum.hint_content_resolution.v1");
  assert.equal(resolved.didResolve, true);
  assert.equal(resolved.reason, "hint_content_resolved");
  assert.equal(resolved.featureId, "action.auto_verification");
  assert.equal(resolved.targetElementId, "workspace.action.autoVerification");
  assert.equal(resolved.resolvedAt, "2026-05-14T09:15:00.000Z");
  assert.equal(resolved.content.title, "자동 확인");
  assert.match(resolved.content.body, /MCP, CLI, Browser Tool, Google Docs\/Sheets/);
  assert.equal(resolved.content.displayMode, "inline_non_blocking");
  assert.equal(resolved.content.blocking, false);
  assert.equal(resolved.content.progressionBlocked, false);
  assert.equal(resolved.content.dismissible, true);
  assert.deepEqual(resolved.content.assistantMessage, {
    role: "assistant",
    tone: "friendly_senior",
    content: "자동 확인\nMCP, CLI, Browser Tool, Google Docs/Sheets로 먼저 실행 증거를 확인해보세요.",
  });
  assert.equal(resolved.inlineHint.id, "inline-hint-action.auto_verification");
  assert.equal(resolved.inlineHint.active, true);
  assert.equal(resolved.inlineHint.reason, "triggered_feature_content_resolved");
  assert.equal(resolved.inline_hint, resolved.inlineHint);
});

test("hint content resolver accepts emitted trigger payloads and snake-case ids", () => {
  const fromTrigger = resolveInlineHintContentForTriggeredFeature({
    trigger: {
      feature_id: "review.summary_dashboard",
    },
    now: "2026-05-14T09:16:00.000Z",
  });
  const fromSnakeCase = resolveInlineHintContentForTriggeredFeature({
    triggered_feature_id: "education.interactive_worksheet",
    now: "2026-05-14T09:17:00.000Z",
  });

  assert.equal(fromTrigger.didResolve, true);
  assert.equal(fromTrigger.content.title, "Review 대시보드");
  assert.match(fromTrigger.content.body, /지난 7일 요약/);
  assert.equal(fromTrigger.target_element_id, "workspace.review.summaryDashboard");
  assert.equal(fromSnakeCase.did_resolve, true);
  assert.equal(fromSnakeCase.content.title, "워크시트");
  assert.match(fromSnakeCase.content.body, /빈칸/);
  assert.equal(fromSnakeCase.targetElementId, "workspace.education.interactiveWorksheet");
});

test("hint content resolver supports configured custom feature hint content", () => {
  const resolved = resolveInlineHintContentForTriggeredFeature({
    featureId: "custom.guided_widget",
    features: [
      {
        feature_id: "custom.guided_widget",
        target_element_id: "workspace.custom.guidedWidget",
        label: "Custom guided widget",
        title: "Custom hint",
        body: "Use this configured widget when the curriculum surfaces it.",
      },
    ],
    now: "2026-05-14T09:18:00.000Z",
  });

  assert.equal(resolved.didResolve, true);
  assert.equal(resolved.feature_id, "custom.guided_widget");
  assert.equal(resolved.targetElementId, "workspace.custom.guidedWidget");
  assert.equal(resolved.content.title, "Custom hint");
  assert.equal(resolved.content.body, "Use this configured widget when the curriculum surfaces it.");
  assert.equal(resolved.inlineHint.assistantMessage.content, "Custom hint\nUse this configured widget when the curriculum surfaces it.");
});

test("hint content resolver returns explicit misses for missing or unknown feature ids", () => {
  const missing = resolveInlineHintContentForTriggeredFeature({
    now: "2026-05-14T09:19:00.000Z",
  });
  const unknown = resolveInlineHintContentForTriggeredFeature({
    featureId: "unknown.feature",
    now: "2026-05-14T09:20:00.000Z",
  });

  assert.equal(missing.didResolve, false);
  assert.equal(missing.reason, "missing_feature_id");
  assert.equal(missing.content, null);
  assert.equal(missing.inlineHint, null);
  assert.equal(unknown.didResolve, false);
  assert.equal(unknown.reason, "unknown_feature");
  assert.equal(unknown.featureId, "unknown.feature");
  assert.equal(unknown.content, null);
  assert.equal(unknown.inlineHint, null);
});

test("inline hint tooltip presentation displays resolved hint content as a visible non-blocking tooltip", () => {
  const resolution = resolveInlineHintContentForTriggeredFeature({
    featureId: "action.auto_verification",
    now: "2026-05-14T09:15:00.000Z",
  });
  const presentation = resolveInlineHintTooltipPresentation({
    resolution,
    now: "2026-05-14T09:16:00.000Z",
  });
  const directPresentation = resolveInlineHintTooltipPresentation({
    ...resolution,
    now: "2026-05-14T09:16:30.000Z",
  });

  assert.equal(presentation.schemaVersion, CURRICULUM_INLINE_HINT_TOOLTIP_PRESENTATION_SCHEMA_VERSION);
  assert.equal(presentation.schema, "agentic30.curriculum.inline_hint_tooltip_presentation.v1");
  assert.equal(presentation.presentationId, "inline-hint-tooltip-action.auto_verification");
  assert.equal(presentation.featureId, "action.auto_verification");
  assert.equal(presentation.targetElementId, "workspace.action.autoVerification");
  assert.equal(presentation.visible, true);
  assert.equal(presentation.active, true);
  assert.equal(presentation.uiState, "visible");
  assert.equal(presentation.displayMode, "inline_non_blocking");
  assert.equal(presentation.blocking, false);
  assert.equal(presentation.progressionBlocked, false);
  assert.equal(presentation.dismissible, true);
  assert.equal(presentation.reason, "hint_tooltip_presented");
  assert.equal(presentation.presentedAt, "2026-05-14T09:16:00.000Z");
  assert.equal(presentation.tooltip.role, "tooltip");
  assert.equal(presentation.tooltip.variant, "inline_hint");
  assert.equal(presentation.tooltip.title, "자동 확인");
  assert.match(presentation.tooltip.body, /MCP, CLI, Browser Tool, Google Docs\/Sheets/);
  assert.equal(presentation.tooltip.placement, "near_target");
  assert.equal(presentation.tooltip.targetElementId, "workspace.action.autoVerification");
  assert.equal(presentation.tooltip.arrow, true);
  assert.equal(presentation.tooltip.dimBackground, false);
  assert.equal(presentation.tooltip.highlightTarget, true);
  assert.deepEqual(presentation.tooltip.dismissButton, {
    label: "알겠어요",
    action: "dismiss_inline_hint",
  });
  assert.equal(
    presentation.tooltip.assistantMessage.content,
    "자동 확인\nMCP, CLI, Browser Tool, Google Docs/Sheets로 먼저 실행 증거를 확인해보세요.",
  );
  assert.equal(directPresentation.visible, true);
  assert.equal(directPresentation.uiState, "visible");
  assert.equal(directPresentation.presentedAt, "2026-05-14T09:16:30.000Z");
});

test("inline hint tooltip presentation exposes dismissed and inactive UI states without tooltip chrome", () => {
  const resolution = resolveInlineHintContentForTriggeredFeature({
    featureId: "review.summary_dashboard",
    now: "2026-05-14T09:17:00.000Z",
  });
  const dismissed = resolveInlineHintTooltipPresentation({
    resolution,
    dismissed: true,
    now: "2026-05-14T09:18:00.000Z",
  });
  const hidden = resolveInlineHintTooltipPresentation({
    resolution: {
      ...resolution,
      inlineHint: {
        ...resolution.inlineHint,
        active: false,
      },
    },
    now: "2026-05-14T09:19:00.000Z",
  });

  assert.equal(dismissed.visible, false);
  assert.equal(dismissed.active, false);
  assert.equal(dismissed.uiState, "dismissed");
  assert.equal(dismissed.reason, "hint_tooltip_dismissed");
  assert.equal(dismissed.tooltip, null);
  assert.equal(dismissed.target_element_id, "workspace.review.summaryDashboard");
  assert.equal(hidden.visible, false);
  assert.equal(hidden.ui_state, "hidden");
  assert.equal(hidden.reason, "hint_tooltip_inactive");
  assert.equal(hidden.tooltip, null);
  assert.equal(hidden.displayMode, "inline_non_blocking");
});

test("inline hint tooltip presentation returns unresolved state when content cannot be resolved", () => {
  const unresolved = resolveInlineHintTooltipPresentation({
    resolution: resolveInlineHintContentForTriggeredFeature({
      featureId: "unknown.feature",
      now: "2026-05-14T09:20:00.000Z",
    }),
    now: "2026-05-14T09:21:00.000Z",
  });

  assert.equal(unresolved.visible, false);
  assert.equal(unresolved.active, false);
  assert.equal(unresolved.uiState, "unresolved");
  assert.equal(unresolved.reason, "unknown_feature");
  assert.equal(unresolved.tooltip, null);
  assert.equal(unresolved.featureId, "unknown.feature");
  assert.equal(unresolved.targetElementId, "");
  assert.equal(unresolved.presentationId, "inline-hint-tooltip-unknown.feature");
});
