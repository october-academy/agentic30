import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  AGENTIC30_THREE_LAYERS,
  CURRICULUM_DAY_TYPE_COACH_MARK_SCHEMA_VERSION,
  CURRICULUM_CARRY_OVER_COACHING_SCHEMA_VERSION,
  CURRICULUM_DAY_TRANSITION_ACTION_SCHEMA_VERSION,
  CURRICULUM_COACHING_FEEDBACK_SURFACE_SCHEMA_VERSION,
  CURRICULUM_DAY_TYPES,
  CURRICULUM_REVIEW_DAY_IDS,
  CURRICULUM_GRADUATION_STATE_SCHEMA_VERSION,
  CURRICULUM_PROGRESS_EVENT_TYPES,
  CURRICULUM_PROVIDER_CONTEXT_SCHEMA_VERSION,
  CURRICULUM_PREREQUISITE_REQUIREMENT_SCHEMA_VERSION,
  CURRICULUM_PROGRESS_SCHEMA_VERSION,
  CURRICULUM_LOW_QUALITY_PROGRESSION_SCHEMA_VERSION,
  CURRICULUM_RUSHING_RISK_SCHEMA_VERSION,
  CURRICULUM_STATUSES,
  CURRICULUM_TOO_FAST_PROGRESSION_SCHEMA_VERSION,
  CURRICULUM_WEEK_TYPE_DISTRIBUTIONS,
  IDD_BASE_CURRICULUM,
  adaptCurriculumDay,
  applyCurriculumProgressEvent,
  assembleCurriculumDayContext,
  buildAdaptiveCurriculum,
  buildCarryOverCoachingFeedbackContent,
  buildCurriculumCoachingFeedbackSurface,
  buildCurriculumProviderContextPayload,
  buildPrerequisiteRequirementsFromCarryOver,
  buildPrerequisiteRequirementsFromTooFastProgression,
  mergeCarriedOverPrerequisiteRequirementsIntoCurriculumDay,
  buildMiniActionSessionTriggerEvent,
  deriveCurriculumSignals,
  classifyRushingRisk,
  detectLowQualityProgression,
  detectTooFastProgression,
  detectHaventDoneItResponse,
  detectHaventDoneResponse,
  finalizeWeeklySummaryForCompletedDay,
  identifyCarriedOverIncompleteActionsForCoaching,
  identifyIncompleteDayActionsForTransition,
  identifyPriorIncompleteActionsEligibleForCarryOver,
  identifyNextUnansweredDayQuestion,
  isCurriculumGraduated,
  isCurriculumNotificationEligible,
  loadCurriculumProgressState,
  makeDefaultCurriculumProgressState,
  persistIncompleteDayActionsForNextDay,
  persistCurriculumProgressState,
  recordDayTypeFirstEncounter,
  resolveCurriculumNotificationEligibility,
  resolveReviewDayEligibleDayRange,
  resolveCurriculumLaunchRouteFromPersistedProgress,
  resolveCurriculumLaunchRouteFromRestoredState,
  restoreNextUnansweredDayQuestionFromPersistedProgress,
  restoreNextUnansweredDayQuestionFromProgressState,
  resolveCurriculumDayTypeCoachMarkPresentation,
  resolveCurriculumDayTypeCoachMarkContent,
} from "../sidecar/adaptive-curriculum.mjs";
import {
  ACTION_VERIFICATION_METHOD,
  createActionDayVerificationState,
  failActionVerification,
  startActionVerification,
} from "../sidecar/action-day-verification-state.mjs";
import { FOUNDATION_DAYS } from "../sidecar/foundation-chat.mjs";

test("IDD base curriculum covers exactly 30 days and keeps the Q2 phase shape", () => {
  assert.equal(IDD_BASE_CURRICULUM.length, 30);
  assert.deepEqual(
    IDD_BASE_CURRICULUM.map((day) => day.day),
    Array.from({ length: 30 }, (_, index) => index + 1),
  );
  assert.equal(IDD_BASE_CURRICULUM.filter((day) => day.phase === "foundation").length, 7);
  assert.equal(IDD_BASE_CURRICULUM.filter((day) => day.phase === "build").length, 10);
  assert.equal(IDD_BASE_CURRICULUM.filter((day) => day.phase === "launch").length, 7);
  assert.equal(IDD_BASE_CURRICULUM.filter((day) => day.phase === "grow").length, 6);
});

test("Week 1 curriculum type distribution keeps the 50/20/20/10 target mix", () => {
  const week1 = CURRICULUM_WEEK_TYPE_DISTRIBUTIONS[1];
  const week1Days = IDD_BASE_CURRICULUM.filter((day) => day.curriculumWeek === 1);
  const weightedActual = week1Days.reduce((acc, day) => {
    acc[day.dayType] = (acc[day.dayType] ?? 0) + day.distributionWeight;
    return acc;
  }, {});

  assert.deepEqual(week1.targetPercentages, {
    interview: 50,
    action: 20,
    review: 20,
    education: 10,
  });
  assert.deepEqual(weightedActual, week1.targetPercentages);
  assert.deepEqual(
    week1Days.map((day) => [day.day, day.dayType]),
    [
      [1, CURRICULUM_DAY_TYPES.interview],
      [2, CURRICULUM_DAY_TYPES.action],
      [3, CURRICULUM_DAY_TYPES.interview],
      [4, CURRICULUM_DAY_TYPES.education],
      [5, CURRICULUM_DAY_TYPES.interview],
      [6, CURRICULUM_DAY_TYPES.interview],
      [7, CURRICULUM_DAY_TYPES.review],
    ],
  );
  assert.equal(week1Days.reduce((sum, day) => sum + day.distributionWeight, 0), 100);
});

test("Week 2-3 curriculum distribution assigns 35 percent to Action days", () => {
  for (const weekNumber of [2, 3]) {
    const distribution = CURRICULUM_WEEK_TYPE_DISTRIBUTIONS[weekNumber];
    const weekDays = IDD_BASE_CURRICULUM.filter((day) => day.curriculumWeek === weekNumber);
    const weightedActual = weekDays.reduce((acc, day) => {
      acc[day.dayType] = (acc[day.dayType] ?? 0) + day.distributionWeight;
      return acc;
    }, {});

    assert.equal(distribution.targetPercentages.action, 35);
    assert.equal(Math.round(weightedActual.action * 100) / 100, 35);
    assert.deepEqual(distribution.targetPercentages, {
      interview: 40,
      action: 35,
      review: 15,
      education: 10,
    });
    assert.equal(Math.round(weekDays.reduce((sum, day) => sum + day.distributionWeight, 0) * 100) / 100, 100);
    assert.deepEqual(weightedActual, distribution.targetPercentages);
    assert.deepEqual(
      weekDays.map((day) => day.day),
      distribution.daySlots.map((slot) => slot.day),
    );
    assert.equal(weekDays.filter((day) => day.dayType === CURRICULUM_DAY_TYPES.action).length, 2);
    assert.equal(weekDays.find((day) => day.day === weekNumber * 7).dayType, CURRICULUM_DAY_TYPES.review);
  }
});

test("Week 2-3 curriculum distribution assigns 10 percent to Education days", () => {
  for (const weekNumber of [2, 3]) {
    const distribution = CURRICULUM_WEEK_TYPE_DISTRIBUTIONS[weekNumber];
    const weekDays = IDD_BASE_CURRICULUM.filter((day) => day.curriculumWeek === weekNumber);
    const educationDays = weekDays.filter((day) => day.dayType === CURRICULUM_DAY_TYPES.education);
    const educationWeight = educationDays.reduce((sum, day) => sum + day.distributionWeight, 0);

    assert.equal(distribution.targetPercentages.education, 10);
    assert.equal(distribution.target_percentages.education, 10);
    assert.equal(Math.round(educationWeight * 100) / 100, 10);
    assert.deepEqual(
      educationDays.map((day) => day.day),
      [weekNumber === 2 ? 10 : 16],
    );
    assert.equal(distribution.daySlots.find((slot) => slot.day === educationDays[0].day).distributionWeight, 10);
  }
});

test("Week 2-3 curriculum distribution assigns 15 percent to Review days", () => {
  for (const weekNumber of [2, 3]) {
    const distribution = CURRICULUM_WEEK_TYPE_DISTRIBUTIONS[weekNumber];
    const weekDays = IDD_BASE_CURRICULUM.filter((day) => day.curriculumWeek === weekNumber);
    const reviewDays = weekDays.filter((day) => day.dayType === CURRICULUM_DAY_TYPES.review);
    const reviewWeight = reviewDays.reduce((sum, day) => sum + day.distributionWeight, 0);

    assert.equal(distribution.targetPercentages.review, 15);
    assert.equal(distribution.target_percentages.review, 15);
    assert.equal(Math.round(reviewWeight * 100) / 100, 15);
    assert.deepEqual(
      reviewDays.map((day) => day.day),
      [weekNumber * 7],
    );
    assert.equal(distribution.daySlots.find((slot) => slot.day === weekNumber * 7).distributionWeight, 15);
  }
});

test("Week 4 curriculum distribution keeps the 30/40/20/10 target mix", () => {
  const week4 = CURRICULUM_WEEK_TYPE_DISTRIBUTIONS[4];
  const week4Days = IDD_BASE_CURRICULUM.filter((day) => day.curriculumWeek === 4);
  const weightedActual = week4Days.reduce((acc, day) => {
    acc[day.dayType] = (acc[day.dayType] ?? 0) + day.distributionWeight;
    return acc;
  }, {});

  assert.deepEqual(week4.targetPercentages, {
    interview: 30,
    action: 40,
    review: 20,
    education: 10,
  });
  assert.deepEqual(week4.target_percentages, week4.targetPercentages);
  assert.equal(Math.round(weightedActual.action * 100) / 100, 40);
  assert.equal(Math.round(week4Days.reduce((sum, day) => sum + day.distributionWeight, 0) * 100) / 100, 100);
  assert.deepEqual(weightedActual, week4.targetPercentages);
  assert.deepEqual(
    week4Days.map((day) => [day.day, day.dayType]),
    [
      [22, CURRICULUM_DAY_TYPES.action],
      [23, CURRICULUM_DAY_TYPES.education],
      [24, CURRICULUM_DAY_TYPES.interview],
      [25, CURRICULUM_DAY_TYPES.action],
      [26, CURRICULUM_DAY_TYPES.interview],
      [27, CURRICULUM_DAY_TYPES.action],
      [28, CURRICULUM_DAY_TYPES.review],
    ],
  );
  assert.equal(week4Days.filter((day) => day.dayType === CURRICULUM_DAY_TYPES.interview).length, 2);
  assert.equal(week4Days.filter((day) => day.dayType === CURRICULUM_DAY_TYPES.action).length, 3);
  assert.equal(week4Days.filter((day) => day.dayType === CURRICULUM_DAY_TYPES.review).length, 1);
  assert.equal(week4Days.filter((day) => day.dayType === CURRICULUM_DAY_TYPES.education).length, 1);
  assert.equal(week4Days.find((day) => day.day === 28).dayType, CURRICULUM_DAY_TYPES.review);
});

test("resolveReviewDayEligibleDayRange resolves configured Review Day source ranges", () => {
  assert.deepEqual(CURRICULUM_REVIEW_DAY_IDS, [7, 14, 21, 28]);

  assert.deepEqual(resolveReviewDayEligibleDayRange({ reviewDay: 7 }).dayRange, { start: 1, end: 7 });
  assert.deepEqual(resolveReviewDayEligibleDayRange({ review_day: 14 }).day_range, { start: 8, end: 14 });
  assert.deepEqual(resolveReviewDayEligibleDayRange({ day: 21 }).dayRange, { start: 15, end: 21 });
  assert.deepEqual(resolveReviewDayEligibleDayRange(28).day_range, { start: 22, end: 28 });
});

test("resolveReviewDayEligibleDayRange honours custom configured Review Day ids", () => {
  const resolved = resolveReviewDayEligibleDayRange({
    reviewDay: 18,
    reviewDayIds: [6, 12, 18, 24],
  });

  assert.equal(resolved.eligible, true);
  assert.equal(resolved.is_review_day, true);
  assert.deepEqual(resolved.configured_review_day_ids, [6, 12, 18, 24]);
  assert.equal(resolved.previous_review_day, 12);
  assert.equal(resolved.next_review_day, 24);
  assert.deepEqual(resolved.day_range, { start: 13, end: 18 });
  assert.equal(resolved.basis, "configured_review_day_sequence");
});

test("resolveReviewDayEligibleDayRange derives Review Day ids from curriculum config and rejects non-review days", () => {
  const resolved = resolveReviewDayEligibleDayRange({
    reviewDay: 12,
    curriculumDays: [
      { day: 4, dayType: CURRICULUM_DAY_TYPES.review },
      { day: 8, dayType: CURRICULUM_DAY_TYPES.action },
      { day: 12, dayType: CURRICULUM_DAY_TYPES.review },
    ],
  });
  const ineligible = resolveReviewDayEligibleDayRange({
    reviewDay: 8,
    curriculumDays: [
      { day: 4, dayType: CURRICULUM_DAY_TYPES.review },
      { day: 8, dayType: CURRICULUM_DAY_TYPES.action },
      { day: 12, dayType: CURRICULUM_DAY_TYPES.review },
    ],
  });

  assert.equal(resolved.eligible, true);
  assert.deepEqual(resolved.day_range, { start: 5, end: 12 });
  assert.equal(ineligible.eligible, false);
  assert.equal(ineligible.isReviewDay, false);
  assert.equal(ineligible.dayRange, null);
  assert.deepEqual(ineligible.configuredReviewDayIds, [4, 12]);
});

test("Day type first-encounter tracker returns true once per curriculum UI type", () => {
  let state = makeDefaultCurriculumProgressState(new Date("2026-05-14T08:59:00.000Z"));

  const firstInterview = recordDayTypeFirstEncounter(state, {
    dayType: CURRICULUM_DAY_TYPES.interview,
    encounteredAt: "2026-05-14T09:00:00.000Z",
  });
  state = firstInterview.state;
  const secondInterview = recordDayTypeFirstEncounter(state, {
    dayType: CURRICULUM_DAY_TYPES.interview,
    encounteredAt: "2026-05-14T09:01:00.000Z",
  });
  state = secondInterview.state;
  const firstAction = recordDayTypeFirstEncounter(state, {
    curriculumDay: { dayType: CURRICULUM_DAY_TYPES.action },
    encounteredAt: "2026-05-14T09:02:00.000Z",
  });
  state = firstAction.state;
  const firstEducation = recordDayTypeFirstEncounter(state, {
    day: 4,
    encounteredAt: "2026-05-14T09:03:00.000Z",
  });
  state = firstEducation.state;
  const firstReview = recordDayTypeFirstEncounter(state, {
    day: 7,
    encounteredAt: "2026-05-14T09:04:00.000Z",
  });
  state = firstReview.state;
  const secondAction = recordDayTypeFirstEncounter(state, {
    dayType: CURRICULUM_DAY_TYPES.action,
    encounteredAt: "2026-05-14T09:05:00.000Z",
  });

  assert.equal(firstInterview.firstEncounter, true);
  assert.equal(firstInterview.shouldShowCoachMark, true);
  assert.equal(firstInterview.coachMarkContent.didResolve, true);
  assert.equal(firstInterview.coachMarkContent.coachMark.coachMarkId, "day-type-interview-card-conversation");
  assert.equal(secondInterview.firstEncounter, false);
  assert.equal(secondInterview.shouldShowCoachMark, false);
  assert.equal(secondInterview.coachMarkContent, null);
  assert.equal(firstAction.firstEncounter, true);
  assert.equal(firstEducation.firstEncounter, true);
  assert.equal(firstEducation.coachMarkContent.didResolve, true);
  assert.equal(firstEducation.coachMarkContent.coachMark.coachMarkId, "day-type-education-interactive-worksheet");
  assert.equal(firstReview.firstEncounter, true);
  assert.equal(firstReview.coachMarkContent.didResolve, true);
  assert.equal(firstReview.coachMarkContent.coachMark.coachMarkId, "day-type-review-summary-dashboard");
  assert.equal(secondAction.firstEncounter, false);
  assert.deepEqual(
    Object.entries(secondAction.state.coachMarkRegistry.dayTypeFirstEncounters)
      .map(([dayType, entry]) => [dayType, entry.encountered])
      .sort(),
    [
      [CURRICULUM_DAY_TYPES.action, true],
      [CURRICULUM_DAY_TYPES.education, true],
      [CURRICULUM_DAY_TYPES.interview, true],
      [CURRICULUM_DAY_TYPES.review, true],
    ].sort(),
  );
  assert.equal(
    secondAction.state.coachMarkRegistry.dayTypeFirstEncounters.interview.firstEncounteredAt,
    "2026-05-14T09:00:00.000Z",
  );
  assert.equal(
    secondAction.state.coachMarkRegistry.dayTypeFirstEncounters.action.firstEncounteredAt,
    "2026-05-14T09:02:00.000Z",
  );
});

test("Day type coach-mark presentation shows just-in-time overlay only on first encounter", () => {
  let state = makeDefaultCurriculumProgressState(new Date("2026-05-14T08:59:00.000Z"));

  const firstAction = resolveCurriculumDayTypeCoachMarkPresentation(state, {
    curriculumDay: {
      day: 2,
      dayType: CURRICULUM_DAY_TYPES.action,
    },
    presentedAt: "2026-05-14T09:02:00.000Z",
  });
  state = firstAction.state;
  const repeatAction = resolveCurriculumDayTypeCoachMarkPresentation(state, {
    curriculumDay: {
      day: 6,
      dayType: CURRICULUM_DAY_TYPES.action,
    },
    presentedAt: "2026-05-14T09:06:00.000Z",
  });
  const firstReview = resolveCurriculumDayTypeCoachMarkPresentation(repeatAction.state, {
    day: 7,
    presentedAt: "2026-05-14T09:07:00.000Z",
  });
  const unsupported = resolveCurriculumDayTypeCoachMarkPresentation(firstReview.state, {
    dayType: "foundation",
    presentedAt: "2026-05-14T09:08:00.000Z",
  });

  assert.equal(firstAction.didPresent, true);
  assert.equal(firstAction.reason, "first_day_type_encounter");
  assert.equal(firstAction.presentation.mode, "just_in_time_first_encounter");
  assert.equal(firstAction.presentation.overlay.active, true);
  assert.equal(firstAction.presentation.overlay.blocking, false);
  assert.equal(firstAction.presentation.overlay.highlightTarget, true);
  assert.equal(firstAction.presentation.overlay.presentationMode, "just_in_time");
  assert.equal(firstAction.presentation.coachMark.coachMarkId, "day-type-action-auto-verify-evidence");
  assert.equal(firstAction.presentation.targetElementId, "workspace.action.autoVerification");
  assert.match(firstAction.presentation.assistantMessage.content, /자동 확인/);
  assert.equal(
    firstAction.state.coachMarkRegistry.dayTypeFirstEncounters.action.firstEncounteredAt,
    "2026-05-14T09:02:00.000Z",
  );

  assert.equal(repeatAction.didPresent, false);
  assert.equal(repeatAction.reason, "day_type_already_encountered");
  assert.equal(repeatAction.presentation, null);
  assert.equal(repeatAction.shouldShowCoachMark, false);
  assert.equal(
    repeatAction.state.coachMarkRegistry.dayTypeFirstEncounters.action.firstEncounteredAt,
    "2026-05-14T09:02:00.000Z",
  );

  assert.equal(firstReview.did_present, true);
  assert.equal(firstReview.presentation.day_type, CURRICULUM_DAY_TYPES.review);
  assert.equal(firstReview.presentation.coach_mark.coach_mark_id, "day-type-review-summary-dashboard");
  assert.equal(firstReview.presentation.overlay.target_element_id, "workspace.review.summaryDashboard");

  assert.equal(unsupported.didPresent, false);
  assert.equal(unsupported.reason, "unsupported_day_type");
  assert.equal(unsupported.presentation, null);
});

test("Interview day coach-mark content resolves expected overlay copy and configuration", () => {
  const resolved = resolveCurriculumDayTypeCoachMarkContent({
    dayType: CURRICULUM_DAY_TYPES.interview,
    curriculumDay: {
      day: 3,
      dayType: CURRICULUM_DAY_TYPES.interview,
    },
    resolvedAt: "2026-05-14T09:00:00.000Z",
  });

  assert.equal(resolved.didResolve, true);
  assert.equal(resolved.reason, "resolved");
  assert.equal(resolved.dayType, CURRICULUM_DAY_TYPES.interview);
  assert.equal(resolved.resolvedAt, "2026-05-14T09:00:00.000Z");

  const coachMark = resolved.coachMark;
  assert.equal(coachMark.schemaVersion, CURRICULUM_DAY_TYPE_COACH_MARK_SCHEMA_VERSION);
  assert.equal(coachMark.coachMarkId, "day-type-interview-card-conversation");
  assert.equal(coachMark.dayType, CURRICULUM_DAY_TYPES.interview);
  assert.equal(coachMark.dayId, 3);
  assert.equal(coachMark.title, "Interview Day");
  assert.equal(coachMark.headline, "카드 대화로 실제 행동을 좁혀요");
  assert.match(coachMark.body, /한 사람의 어제 행동/);
  assert.match(coachMark.body, /Review와 적응형 코칭/);
  assert.equal(coachMark.actionLabel, "답변 시작하기");
  assert.equal(coachMark.targetElementId, "workspace.chat.structuredPrompt");
  assert.deepEqual(coachMark.assistantMessage, {
    role: "assistant",
    tone: "friendly_senior",
    content: [
      "카드 대화로 실제 행동을 좁혀요",
      "질문마다 한 사람의 어제 행동, 현재 대안, 막힌 지점을 짧게 답해보세요. 이 답변은 연습이 아니라 다음 Review와 적응형 코칭에 그대로 쓰입니다.",
    ].join("\n"),
  });
  assert.deepEqual(coachMark.overlay, {
    mode: "first_encounter",
    blocking: false,
    dimNonTargetAreas: false,
    dim_non_target_areas: false,
    highlightTarget: true,
    highlight_target: true,
    dismissible: true,
    skipAvailable: true,
    skip_available: true,
    skipEffect: "dismiss_coach_mark_only",
    skip_effect: "dismiss_coach_mark_only",
    targetElementId: "workspace.chat.structuredPrompt",
    target_element_id: "workspace.chat.structuredPrompt",
  });
  assert.deepEqual(coachMark.configuration, {
    layout: "interview_card_conversation",
    placement: "near_target",
    targetElementId: "workspace.chat.structuredPrompt",
    target_element_id: "workspace.chat.structuredPrompt",
    showOncePerDayType: true,
    show_once_per_day_type: true,
    blocksProgression: false,
    blocks_progression: false,
    progressionGuardActive: false,
    progression_guard_active: false,
    autoDismissOnAnswer: true,
    auto_dismiss_on_answer: true,
  });
});

test("Action day coach-mark content resolves expected overlay copy and configuration", () => {
  const resolved = resolveCurriculumDayTypeCoachMarkContent({
    dayType: CURRICULUM_DAY_TYPES.action,
    curriculumDay: {
      day: 2,
      dayType: CURRICULUM_DAY_TYPES.action,
    },
    resolvedAt: "2026-05-14T09:02:00.000Z",
  });

  assert.equal(resolved.didResolve, true);
  assert.equal(resolved.reason, "resolved");
  assert.equal(resolved.dayType, CURRICULUM_DAY_TYPES.action);
  assert.equal(resolved.resolvedAt, "2026-05-14T09:02:00.000Z");

  const coachMark = resolved.coachMark;
  assert.equal(coachMark.schemaVersion, CURRICULUM_DAY_TYPE_COACH_MARK_SCHEMA_VERSION);
  assert.equal(coachMark.coachMarkId, "day-type-action-auto-verify-evidence");
  assert.equal(coachMark.dayType, CURRICULUM_DAY_TYPES.action);
  assert.equal(coachMark.dayId, 2);
  assert.equal(coachMark.title, "Action Day");
  assert.equal(coachMark.headline, "자동 확인으로 실행 증거를 남겨요");
  assert.match(coachMark.body, /MCP, CLI, Browser Tool, Google Docs\/Sheets/);
  assert.match(coachMark.body, /링크나 파일 증거/);
  assert.match(coachMark.body, /진행은 막지 않습니다/);
  assert.equal(coachMark.actionLabel, "자동 확인 시작하기");
  assert.equal(coachMark.targetElementId, "workspace.action.autoVerification");
  assert.deepEqual(coachMark.assistantMessage, {
    role: "assistant",
    tone: "friendly_senior",
    content: [
      "자동 확인으로 실행 증거를 남겨요",
      "먼저 MCP, CLI, Browser Tool, Google Docs/Sheets로 오늘 실행 결과를 자동 확인해보세요. 확인이 안 되면 링크나 파일 증거를 붙이면 되고, 미완료여도 다음 Day 진행은 막지 않습니다.",
    ].join("\n"),
  });
  assert.deepEqual(coachMark.overlay, {
    mode: "first_encounter",
    blocking: false,
    dimNonTargetAreas: false,
    dim_non_target_areas: false,
    highlightTarget: true,
    highlight_target: true,
    dismissible: true,
    skipAvailable: true,
    skip_available: true,
    skipEffect: "dismiss_coach_mark_only",
    skip_effect: "dismiss_coach_mark_only",
    targetElementId: "workspace.action.autoVerification",
    target_element_id: "workspace.action.autoVerification",
  });
  assert.deepEqual(coachMark.configuration, {
    layout: "action_auto_verify_evidence",
    placement: "near_target",
    targetElementId: "workspace.action.autoVerification",
    target_element_id: "workspace.action.autoVerification",
    showOncePerDayType: true,
    show_once_per_day_type: true,
    blocksProgression: false,
    blocks_progression: false,
    progressionGuardActive: false,
    progression_guard_active: false,
    autoVerificationFirst: true,
    auto_verification_first: true,
    preferredVerificationOrder: ["mcp", "cli", "browser", "google_docs", "google_sheets"],
    preferred_verification_order: ["mcp", "cli", "browser", "google_docs", "google_sheets"],
    evidenceFallbackEnabled: true,
    evidence_fallback_enabled: true,
    evidenceFallbackTypes: ["link", "file"],
    evidence_fallback_types: ["link", "file"],
    carryOverOnInsufficient: true,
    carry_over_on_insufficient: true,
  });
});

test("Review day coach-mark content resolves expected overlay copy and configuration", () => {
  const resolved = resolveCurriculumDayTypeCoachMarkContent({
    dayType: CURRICULUM_DAY_TYPES.review,
    curriculumDay: {
      day: 14,
      dayType: CURRICULUM_DAY_TYPES.review,
    },
    resolvedAt: "2026-05-14T09:04:00.000Z",
  });

  assert.equal(resolved.didResolve, true);
  assert.equal(resolved.reason, "resolved");
  assert.equal(resolved.dayType, CURRICULUM_DAY_TYPES.review);
  assert.equal(resolved.resolvedAt, "2026-05-14T09:04:00.000Z");

  const coachMark = resolved.coachMark;
  assert.equal(coachMark.schemaVersion, CURRICULUM_DAY_TYPE_COACH_MARK_SCHEMA_VERSION);
  assert.equal(coachMark.coachMarkId, "day-type-review-summary-dashboard");
  assert.equal(coachMark.dayType, CURRICULUM_DAY_TYPES.review);
  assert.equal(coachMark.dayId, 14);
  assert.equal(coachMark.title, "Review Day");
  assert.equal(coachMark.headline, "요약과 대시보드로 다음 7일을 고릅니다");
  assert.match(coachMark.body, /Agent Summary/);
  assert.match(coachMark.body, /미완료 carry-over/);
  assert.match(coachMark.body, /Dashboard/);
  assert.match(coachMark.body, /성취 요약 또는 감속 코칭/);
  assert.equal(coachMark.actionLabel, "Review 확인하기");
  assert.equal(coachMark.targetElementId, "workspace.review.summaryDashboard");
  assert.deepEqual(coachMark.assistantMessage, {
    role: "assistant",
    tone: "friendly_senior",
    content: [
      "요약과 대시보드로 다음 7일을 고릅니다",
      "Agent Summary에서 지난 7일의 답변, 실행 증거, 미완료 carry-over를 먼저 확인해보세요. Dashboard는 속도와 완료 상태에 맞춰 성취 요약 또는 감속 코칭으로 다음 행동을 정리합니다.",
    ].join("\n"),
  });
  assert.deepEqual(coachMark.overlay, {
    mode: "first_encounter",
    blocking: false,
    dimNonTargetAreas: false,
    dim_non_target_areas: false,
    highlightTarget: true,
    highlight_target: true,
    dismissible: true,
    skipAvailable: true,
    skip_available: true,
    skipEffect: "dismiss_coach_mark_only",
    skip_effect: "dismiss_coach_mark_only",
    targetElementId: "workspace.review.summaryDashboard",
    target_element_id: "workspace.review.summaryDashboard",
  });
  assert.deepEqual(coachMark.configuration, {
    layout: "review_agent_summary_dashboard",
    placement: "near_target",
    targetElementId: "workspace.review.summaryDashboard",
    target_element_id: "workspace.review.summaryDashboard",
    showOncePerDayType: true,
    show_once_per_day_type: true,
    blocksProgression: false,
    blocks_progression: false,
    progressionGuardActive: false,
    progression_guard_active: false,
    summaryFirst: true,
    summary_first: true,
    dashboardVisible: true,
    dashboard_visible: true,
    paceAdjustedTone: true,
    pace_adjusted_tone: true,
    reviewDayIds: [7, 14, 21, 28],
    review_day_ids: [7, 14, 21, 28],
    weeklySummaryStackRequired: true,
    weekly_summary_stack_required: true,
    actionItemsVisible: true,
    action_items_visible: true,
  });
});

test("Education day coach-mark content resolves expected overlay copy and configuration", () => {
  const resolved = resolveCurriculumDayTypeCoachMarkContent({
    dayType: CURRICULUM_DAY_TYPES.education,
    curriculumDay: {
      day: 4,
      dayType: CURRICULUM_DAY_TYPES.education,
    },
    resolvedAt: "2026-05-14T09:03:00.000Z",
  });

  assert.equal(resolved.didResolve, true);
  assert.equal(resolved.reason, "resolved");
  assert.equal(resolved.dayType, CURRICULUM_DAY_TYPES.education);
  assert.equal(resolved.resolvedAt, "2026-05-14T09:03:00.000Z");

  const coachMark = resolved.coachMark;
  assert.equal(coachMark.schemaVersion, CURRICULUM_DAY_TYPE_COACH_MARK_SCHEMA_VERSION);
  assert.equal(coachMark.coachMarkId, "day-type-education-interactive-worksheet");
  assert.equal(coachMark.dayType, CURRICULUM_DAY_TYPES.education);
  assert.equal(coachMark.dayId, 4);
  assert.equal(coachMark.title, "Education Day");
  assert.equal(coachMark.headline, "프레임워크를 내 문장으로 바꿔요");
  assert.match(coachMark.body, /빈칸 워크시트/);
  assert.match(coachMark.body, /적용 피드백/);
  assert.match(coachMark.body, /다음 Action Day/);
  assert.equal(coachMark.actionLabel, "워크시트 시작하기");
  assert.equal(coachMark.targetElementId, "workspace.education.interactiveWorksheet");
  assert.deepEqual(coachMark.assistantMessage, {
    role: "assistant",
    tone: "friendly_senior",
    content: [
      "프레임워크를 내 문장으로 바꿔요",
      "짧은 개념을 읽고 빈칸 워크시트에 내 제품 상황을 바로 넣어보세요. 모든 필수 칸을 채우면 적용 피드백이 나오고, 다음 Action Day에서 쓸 실행 기준으로 이어집니다.",
    ].join("\n"),
  });
  assert.deepEqual(coachMark.overlay, {
    mode: "first_encounter",
    blocking: false,
    dimNonTargetAreas: false,
    dim_non_target_areas: false,
    highlightTarget: true,
    highlight_target: true,
    dismissible: true,
    skipAvailable: true,
    skip_available: true,
    skipEffect: "dismiss_coach_mark_only",
    skip_effect: "dismiss_coach_mark_only",
    targetElementId: "workspace.education.interactiveWorksheet",
    target_element_id: "workspace.education.interactiveWorksheet",
  });
  assert.deepEqual(coachMark.configuration, {
    layout: "education_interactive_worksheet",
    placement: "near_target",
    targetElementId: "workspace.education.interactiveWorksheet",
    target_element_id: "workspace.education.interactiveWorksheet",
    showOncePerDayType: true,
    show_once_per_day_type: true,
    blocksProgression: false,
    blocks_progression: false,
    progressionGuardActive: false,
    progression_guard_active: false,
    worksheetFirst: true,
    worksheet_first: true,
    fillInTheBlankEnabled: true,
    fill_in_the_blank_enabled: true,
    frameworkFeedbackEnabled: true,
    framework_feedback_enabled: true,
    completionRequiresRequiredBlanks: true,
    completion_requires_required_blanks: true,
    nextActionApplicationVisible: true,
    next_action_application_visible: true,
  });
});

test("Interview day coach-mark resolver suppresses unsupported or unrequested overlays", () => {
  const unrequested = resolveCurriculumDayTypeCoachMarkContent({
    dayType: CURRICULUM_DAY_TYPES.interview,
    shouldShowCoachMark: false,
  });
  const unsupported = resolveCurriculumDayTypeCoachMarkContent({
    dayType: "foundation",
  });

  assert.equal(unrequested.didResolve, false);
  assert.equal(unrequested.reason, "coach_mark_not_requested");
  assert.equal(unrequested.coachMark, null);
  assert.equal(unsupported.didResolve, false);
  assert.equal(unsupported.reason, "unsupported_day_type");
  assert.equal(unsupported.dayType, "");
  assert.equal(unsupported.coachMark, null);
});

test("Day type first-encounter tracker preserves persisted registry state", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-day-type-encounter-"));
  const filePath = path.join(dir, "curriculum-progress.json");
  const first = recordDayTypeFirstEncounter({}, {
    dayType: CURRICULUM_DAY_TYPES.review,
    encounteredAt: "2026-05-14T09:00:00.000Z",
  });
  await persistCurriculumProgressState(filePath, first.state, {
    now: () => new Date("2026-05-14T09:00:01.000Z"),
  });
  const loaded = await loadCurriculumProgressState(filePath);
  const repeat = recordDayTypeFirstEncounter(loaded, {
    dayType: CURRICULUM_DAY_TYPES.review,
    encounteredAt: "2026-05-14T09:10:00.000Z",
  });
  const newType = recordDayTypeFirstEncounter(repeat.state, {
    dayType: CURRICULUM_DAY_TYPES.education,
    encounteredAt: "2026-05-14T09:11:00.000Z",
  });
  const invalid = recordDayTypeFirstEncounter(newType.state, {
    dayType: "foundation",
  });

  assert.equal(loaded.coach_mark_registry.day_type_first_encounters.review.encountered, true);
  assert.equal(repeat.firstEncounter, false);
  assert.equal(repeat.state.coachMarkRegistry.dayTypeFirstEncounters.review.firstEncounteredAt, "2026-05-14T09:00:00.000Z");
  assert.equal(newType.first_encounter, true);
  assert.equal(newType.day_type, CURRICULUM_DAY_TYPES.education);
  assert.equal(invalid.firstEncounter, false);
  assert.equal(invalid.dayType, "");
});

test("three-layer strategy separates Builder, Program, and Product decisions", () => {
  assert.equal(AGENTIC30_THREE_LAYERS.founder.name, "Builder");
  assert.equal(AGENTIC30_THREE_LAYERS.company.name, "Program");
  assert.equal(AGENTIC30_THREE_LAYERS.product.name, "Agentic30");

  const plan = buildAdaptiveCurriculum({
    selectedDay: 24,
    state: {},
    now: new Date("2026-05-07T00:00:00.000Z"),
  });

  assert.equal(plan.strategy.layers.company.subject, "반복 가능한 교육/코칭 시스템");
  assert.deepEqual(plan.selectedDay.layerFocus, ["company", "product"]);
  assert.ok(plan.selectedDay.layerChecks.some((line) => /Program/.test(line)));
  assert.ok(plan.selectedDay.layerChecks.some((line) => /Agentic30/.test(line)));
});

test("adaptive Foundation days mirror Foundation chat day semantics", () => {
  const foundationDays = IDD_BASE_CURRICULUM.filter((day) => day.phase === "foundation");

  assert.deepEqual(foundationDays.map((day) => day.day), [1, 2, 3, 4, 5, 6, 7]);
  for (const day of foundationDays) {
    assert.equal(typeof day.valueContract?.todayValue, "string", `Day ${day.day} value`);
    assert.equal(typeof day.valueContract?.evidenceArtifact, "string", `Day ${day.day} artifact`);
    assert.equal(typeof day.valueContract?.passGate, "string", `Day ${day.day} pass gate`);
    assert.equal(typeof day.valueContract?.failGate, "string", `Day ${day.day} fail gate`);
    assert.ok(Array.isArray(day.valueContract?.canonicalDocs), `Day ${day.day} canonical docs`);
    assert.ok(day.valueContract.canonicalDocs.length >= 2, `Day ${day.day} canonical docs non-empty`);
    assert.match(day.valueContract?.frictionLogPrompt || "", /막혔/);
    assert.match(day.valueContract?.resourceObservationPrompt || "", /자료|예시|템플릿/);
    assert.match(day.valueContract?.antiDisplacementGate?.rule || "", /hotfix|dogfood/);
  }
  assert.match(foundationDays[2].valueContract.externalLockIn, /ICP 후보 최소 1명/);
  assert.doesNotMatch(foundationDays[2].valueContract.externalLockIn, /승연|송재진|조제표/);
  const docPaths = new Set(foundationDays.flatMap((day) =>
    day.valueContract.canonicalDocs.map((entry) => entry.path),
  ));
  assert.deepEqual(
    [...docPaths].sort(),
    ["docs/GOAL.md", "docs/ICP.md", "docs/SPEC.md", "docs/VALUES.md"].sort(),
  );
  assert.match(foundationDays[0].title, /목표와 고객 정렬문/);
  assert.match(FOUNDATION_DAYS[1].core_question, /ICP, Pain Point, Outcome/);
  assert.match(foundationDays[1].title, /돈이 흐르는 기준 시장/);
  assert.match(FOUNDATION_DAYS[2].core_question, /시장·고객 데이터/);
  assert.match(foundationDays[2].title, /Mom Test/);
  assert.equal(FOUNDATION_DAYS[3].sub_workflow, "office-hours-docs");
  assert.match(foundationDays[3].title, /약한 섹션/);
  assert.match(FOUNDATION_DAYS[4].core_question, /섹션을 다시 쓸/);
  assert.match(foundationDays[4].title, /수요 시그널/);
  assert.equal(FOUNDATION_DAYS[5].sub_workflow, "analyze-ads");
  assert.match(foundationDays[5].title, /돈\/시간 ask/);
  assert.equal(FOUNDATION_DAYS[6].sub_workflow, "monetization-ask");
  assert.match(foundationDays[6].title, /Go\/No-Go/);
  assert.equal(FOUNDATION_DAYS[7].sub_workflow, "foundation-summary");
});

test("base curriculum carries cross-platform app monetization lessons", () => {
  const day2 = IDD_BASE_CURRICULUM.find((day) => day.day === 2);
  const day13 = IDD_BASE_CURRICULUM.find((day) => day.day === 13);
  const day15 = IDD_BASE_CURRICULUM.find((day) => day.day === 15);
  const day16 = IDD_BASE_CURRICULUM.find((day) => day.day === 16);
  const day23 = IDD_BASE_CURRICULUM.find((day) => day.day === 23);
  const day28 = IDD_BASE_CURRICULUM.find((day) => day.day === 28);

  assert.match(day2.summary, /iOS\/Android\/Web\/Mac/);
  assert.ok(day2.tasks.some((task) => /ASO|광고 앱/.test(task)));
  assert.match(day13.summary, /iOS\/Android\/Web\/Mac/);
  assert.match(day15.title, /수익모델/);
  assert.ok(day15.tasks.some((task) => /광고\/구독\/일회성 결제/.test(task)));
  assert.ok(day16.tasks.some((task) => /App Store\/Google Play\/Web\/Mac/.test(task)));
  assert.ok(day23.tasks.some((task) => /store conversion/.test(task)));
  assert.ok(day28.tasks.some((task) => /App Store\/Google Play/.test(task)));
});

test("adaptive curriculum is grounded in direction doc north star and selected day", () => {
  const plan = buildAdaptiveCurriculum({
    selectedDay: { day: 12, title: "Static day title" },
    state: {},
    now: new Date("2026-05-07T00:00:00.000Z"),
  });

  assert.equal(plan.source, "docs/AGENTIC30-DIRECTION.md");
  assert.match(plan.strategy.northStar, /IDD Engine/);
  assert.match(plan.strategy.p0, /folder watch/);
  assert.equal(plan.days.length, 30);
  assert.equal(plan.selectedDay.day, 12);
  assert.equal(plan.selectedDay.title, "Static day title");
  assert.match(plan.selectedDay.summary, /L2 입력 공백/);
  assert.deepEqual(plan.selectedDay.personalization.evidenceGaps.slice(0, 3), [
    "interview_transcript",
    "journal",
    "bip",
  ]);
});

test("Day 1 completion persists only after explicit completion confirmation event", () => {
  const lifecycleOnly = applyCurriculumProgressEvent(
    {},
    {
      type: "day_started",
      day: 1,
      occurredAt: "2026-05-14T09:01:00.000Z",
    },
  );
  const confirmed = applyCurriculumProgressEvent(
    lifecycleOnly,
    {
      type: CURRICULUM_PROGRESS_EVENT_TYPES.dayCompletionConfirmed,
      day: 1,
      occurredAt: "2026-05-14T09:10:00.000Z",
    },
  );

  assert.equal(lifecycleOnly.dayRecords[0].completionConfirmed, false);
  assert.equal(confirmed.dayRecords[0].completed, true);
  assert.equal(confirmed.dayRecords[0].completionConfirmed, true);
  assert.equal(confirmed.dayRecords[0].completedAt, "2026-05-14T09:10:00.000Z");
  assert.deepEqual(
    confirmed.dayRecords[0].lifecycleEvents.map((event) => [event.type, event.completionDriver]),
    [
      ["day_started", false],
      [CURRICULUM_PROGRESS_EVENT_TYPES.dayCompletionConfirmed, true],
    ],
  );
});

test("Day 1 generic completion-like event paths do not persist completion", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-day1-completion-boundary-"));
  const filePath = path.join(dir, "curriculum-progress.json");
  let state = makeDefaultCurriculumProgressState(new Date("2026-05-14T08:59:00.000Z"));
  const nonCompletionEvents = [
    "day_completed",
    "day_complete",
    "completion_confirmed",
    "completion_card_confirmed",
  ];

  for (const [index, type] of nonCompletionEvents.entries()) {
    state = applyCurriculumProgressEvent(state, {
      type,
      day: 1,
      dayType: CURRICULUM_DAY_TYPES.interview,
      completed: true,
      completionConfirmed: true,
      completion_confirmed: true,
      occurredAt: `2026-05-14T09:0${index}:00.000Z`,
    });

    const record = state.dayRecords[0];
    assert.equal(record.completed, false);
    assert.equal(record.completionConfirmed, false);
    assert.equal(record.completedAt, "");
  }

  assert.deepEqual(
    state.dayRecords[0].lifecycleEvents.map((event) => [event.type, event.completionDriver]),
    nonCompletionEvents.map((type) => [type, false]),
  );

  await persistCurriculumProgressState(filePath, state, {
    now: () => new Date("2026-05-14T09:04:00.000Z"),
  });
  const loaded = await loadCurriculumProgressState(filePath);
  assert.equal(loaded.dayRecords[0].completed, false);
  assert.equal(loaded.dayRecords[0].completionConfirmed, false);
  assert.equal(loaded.dayRecords[0].completion_confirmed, false);
  assert.equal(loaded.dayRecords[0].completedAt, "");
});

test("Day 1 explicit completion confirmation event persists completion", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-day1-explicit-completion-"));
  const filePath = path.join(dir, "curriculum-progress.json");
  const state = applyCurriculumProgressEvent(
    {
      dayRecords: [
        {
          day: 1,
          dayType: CURRICULUM_DAY_TYPES.interview,
          completed: false,
          completionConfirmed: false,
        },
      ],
    },
    {
      type: CURRICULUM_PROGRESS_EVENT_TYPES.dayCompletionConfirmed,
      day: 1,
      occurredAt: "2026-05-14T09:10:00.000Z",
    },
  );

  assert.equal(state.dayRecords[0].completed, true);
  assert.equal(state.dayRecords[0].completionConfirmed, true);
  assert.equal(state.dayRecords[0].completedAt, "2026-05-14T09:10:00.000Z");
  assert.deepEqual(
    state.dayRecords[0].lifecycleEvents.map((event) => [event.type, event.completionDriver]),
    [[CURRICULUM_PROGRESS_EVENT_TYPES.dayCompletionConfirmed, true]],
  );

  await persistCurriculumProgressState(filePath, state, {
    now: () => new Date("2026-05-14T09:10:01.000Z"),
  });
  const loaded = await loadCurriculumProgressState(filePath);
  assert.equal(loaded.dayRecords[0].completed, true);
  assert.equal(loaded.dayRecords[0].completionConfirmed, true);
  assert.equal(loaded.dayRecords[0].completion_confirmed, true);
  assert.equal(loaded.dayRecords[0].completedAt, "2026-05-14T09:10:00.000Z");
});

test("Day 30 completion transitions curriculum progress into terminal graduation state", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-day30-graduation-"));
  const filePath = path.join(dir, "curriculum-progress.json");
  const state = applyCurriculumProgressEvent(
    makeDefaultCurriculumProgressState(new Date("2026-05-14T08:59:00.000Z")),
    {
      type: CURRICULUM_PROGRESS_EVENT_TYPES.dayCompletionConfirmed,
      day: 30,
      dayType: CURRICULUM_DAY_TYPES.interview,
      occurredAt: "2026-06-12T21:30:00.000Z",
    },
  );

  assert.equal(state.curriculumStatus, CURRICULUM_STATUSES.graduated);
  assert.equal(state.curriculum_status, CURRICULUM_STATUSES.graduated);
  assert.equal(state.terminalState, true);
  assert.equal(state.terminal_state, true);
  assert.equal(isCurriculumGraduated(state), true);
  assert.equal(state.dayRecords[0].day, 30);
  assert.equal(state.dayRecords[0].completionConfirmed, true);
  assert.equal(state.dayRecords[0].completedAt, "2026-06-12T21:30:00.000Z");
  assert.equal(state.graduationState.schemaVersion, CURRICULUM_GRADUATION_STATE_SCHEMA_VERSION);
  assert.equal(state.graduationState.status, CURRICULUM_STATUSES.graduated);
  assert.equal(state.graduationState.terminal, true);
  assert.equal(state.graduationState.finalDay, 30);
  assert.equal(state.graduationState.nextDay, null);
  assert.equal(state.graduationState.continuationMode, false);
  assert.equal(state.graduationState.pushNotificationsStopped, true);
  assert.equal(state.graduationState.day30CompletedAt, "2026-06-12T21:30:00.000Z");
  assert.equal(state.graduationState.graduationScreen.title, "30일 완주");
  assert.equal(state.notificationConfig.enabled, false);
  assert.equal(state.notificationConfig.fixedTime, "21:00");
  assert.equal(state.notificationConfig.permanentlyStopped, true);

  await persistCurriculumProgressState(filePath, state, {
    now: () => new Date("2026-06-12T21:30:01.000Z"),
  });
  const loaded = await loadCurriculumProgressState(filePath);
  assert.equal(loaded.curriculumStatus, CURRICULUM_STATUSES.graduated);
  assert.equal(loaded.terminalState, true);
  assert.equal(loaded.graduationState.day30CompletedAt, "2026-06-12T21:30:00.000Z");
  assert.equal(loaded.notificationConfig.enabled, false);

  const restoration = restoreNextUnansweredDayQuestionFromProgressState({
    progressState: loaded,
    curriculumDays: IDD_BASE_CURRICULUM,
  });
  assert.equal(restoration.didRestore, true);
  assert.equal(restoration.didResolve, true);
  assert.equal(restoration.reason, "curriculum_graduated_terminal_state");
  assert.equal(restoration.nextQuestion, null);
  assert.equal(restoration.allQuestionsAnswered, true);
  assert.equal(restoration.progressionBlocked, false);

  const route = resolveCurriculumLaunchRouteFromRestoredState({
    progressState: loaded,
    curriculumDays: IDD_BASE_CURRICULUM,
  });
  assert.equal(route.didRoute, true);
  assert.equal(route.routeKind, "curriculum_graduation");
  assert.equal(route.reason, "curriculum_graduated_terminal_state");
  assert.equal(route.destination.route, "curriculum_graduation");
  assert.equal(route.destination.componentType, "graduation_terminal_screen");
  assert.equal(route.destination.graduationState.status, CURRICULUM_STATUSES.graduated);
  assert.equal(route.progressionBlocked, false);
});

test("blocked curriculum progression gate prevents Day completion confirmation from advancing progress", () => {
  const state = applyCurriculumProgressEvent(
    {
      dayRecords: [
        {
          day: 2,
          dayType: CURRICULUM_DAY_TYPES.action,
          completed: true,
          completionConfirmed: true,
          action_spec: {
            id: "day-2-market-log",
            action_description: "Record five paid alternatives.",
            completion_signal: "day-2-evidence-log.md includes five priced competitors.",
          },
          verification_result: {
            method: "google_docs",
            passed: false,
            reason: "Only two competitors were found.",
          },
        },
        {
          day: 6,
          dayType: CURRICULUM_DAY_TYPES.action,
          prerequisite_requirements: {
            current_day: 6,
            requirements: [
              {
                requirement_id: "day-6-requires-day-2-market-log",
                requirement_mode: "blocking_prerequisite",
                required_before: "day_unlock",
                source_day: 2,
                source_action_id: "day-2-market-log",
              },
            ],
          },
        },
      ],
    },
    {
      type: CURRICULUM_PROGRESS_EVENT_TYPES.dayCompletionConfirmed,
      day: 6,
      occurredAt: "2026-05-19T09:30:00.000Z",
    },
  );

  const day6 = state.dayRecords.find((record) => record.day === 6);
  assert.equal(day6.completed, false);
  assert.equal(day6.completionConfirmed, false);
  assert.equal(day6.completedAt, "");
  assert.equal(day6.progression_blocked, true);
  assert.equal(day6.blocked_reason, "curriculum_progression_gate_blocked");
  assert.equal(day6.progression_gate.status, "blocked");
  assert.equal(day6.progression_gate.can_advance_day, false);
  assert.deepEqual(day6.progression_gate.blocking_requirement_ids, ["day-6-requires-day-2-market-log"]);
  assert.equal(day6.progression_gate.blocked_state_metadata.status, "blocked");
  assert.equal(day6.progression_gate.blocked_state_metadata.mutates_progression_state, false);
  assert.deepEqual(
    day6.progression_gate.blocked_state_metadata.unmet_prerequisite_actions.map((action) => ({
      requirement_id: action.requirement_id,
      source_day: action.source_day,
      source_action_id: action.source_action_id,
      action_description: action.action_description,
      completion_signal: action.completion_signal,
      latest_status: action.latest_status,
    })),
    [
      {
        requirement_id: "day-6-requires-day-2-market-log",
        source_day: 2,
        source_action_id: "day-2-market-log",
        action_description: "Record five paid alternatives.",
        completion_signal: "day-2-evidence-log.md includes five priced competitors.",
        latest_status: "unmet",
      },
    ],
  );
  assert.deepEqual(
    day6.lifecycleEvents.map((event) => [event.type, event.completionDriver]),
    [[CURRICULUM_PROGRESS_EVENT_TYPES.dayCompletionConfirmed, false]],
  );
});

test("allowed curriculum progression gate permits Day completion confirmation", () => {
  const state = applyCurriculumProgressEvent(
    {
      dayRecords: [
        {
          day: 2,
          dayType: CURRICULUM_DAY_TYPES.action,
          completed: true,
          completionConfirmed: true,
          action_spec: {
            id: "day-2-market-log",
          },
          verification_result: {
            method: "google_docs",
            passed: true,
          },
        },
        {
          day: 6,
          dayType: CURRICULUM_DAY_TYPES.action,
          prerequisite_requirements: {
            current_day: 6,
            requirements: [
              {
                requirement_id: "day-6-requires-day-2-market-log",
                requirement_mode: "blocking_prerequisite",
                source_day: 2,
                source_action_id: "day-2-market-log",
              },
            ],
          },
        },
      ],
    },
    {
      type: CURRICULUM_PROGRESS_EVENT_TYPES.dayCompletionConfirmed,
      day: 6,
      occurredAt: "2026-05-19T09:30:00.000Z",
    },
  );

  const day6 = state.dayRecords.find((record) => record.day === 6);
  assert.equal(day6.completed, true);
  assert.equal(day6.completionConfirmed, true);
  assert.equal(day6.completedAt, "2026-05-19T09:30:00.000Z");
  assert.equal(day6.progression_blocked, false);
  assert.equal(day6.progression_gate.status, "allowed");
  assert.equal(day6.progression_gate.can_advance_day, true);
  assert.equal(day6.lifecycleEvents.at(-1).completionDriver, true);
});

test("curriculum notification eligibility is false when current Day is complete", () => {
  const state = applyCurriculumProgressEvent(
    makeDefaultCurriculumProgressState(new Date("2026-05-14T20:59:00.000Z")),
    {
      type: CURRICULUM_PROGRESS_EVENT_TYPES.dayCompletionConfirmed,
      day: 4,
      dayType: CURRICULUM_DAY_TYPES.education,
      occurredAt: "2026-05-14T20:59:30.000Z",
    },
  );

  const eligibility = resolveCurriculumNotificationEligibility({ progressState: state, currentDay: 4 });
  assert.equal(isCurriculumNotificationEligible({ progressState: state, currentDay: 4 }), false);
  assert.deepEqual(
    {
      eligible: eligibility.eligible,
      reason: eligibility.reason,
      day: eligibility.day,
    },
    {
      eligible: false,
      reason: "day_already_complete",
      day: 4,
    },
  );
});

test("curriculum notification eligibility is true when current Day is incomplete and notifications are enabled", () => {
  const state = {
    ...makeDefaultCurriculumProgressState(new Date("2026-05-14T20:59:00.000Z")),
    currentDay: 5,
    dayRecords: [
      {
        day: 5,
        dayType: CURRICULUM_DAY_TYPES.interview,
        completionConfirmed: false,
        completed: false,
      },
    ],
  };

  assert.equal(isCurriculumNotificationEligible({ progressState: state }), true);
  const eligibility = resolveCurriculumNotificationEligibility({ progressState: state });
  assert.equal(eligibility.eligible, true);
  assert.equal(eligibility.reason, "day_incomplete_notifications_enabled");
  assert.equal(eligibility.day, 5);
  assert.equal(eligibility.currentDay, 5);
  assert.equal(eligibility.fixedTime, "21:00");
});

test("curriculum notification eligibility is false when notifications are disabled", () => {
  const state = {
    ...makeDefaultCurriculumProgressState(new Date("2026-05-14T20:59:00.000Z")),
    currentDay: 6,
    notificationConfig: {
      enabled: false,
      fixedTime: "21:00",
    },
    dayRecords: [
      {
        day: 6,
        dayType: CURRICULUM_DAY_TYPES.interview,
        completionConfirmed: false,
        completed: false,
      },
    ],
  };

  assert.equal(isCurriculumNotificationEligible({ progressState: state }), false);
  const eligibility = resolveCurriculumNotificationEligibility({ progressState: state });
  assert.equal(eligibility.eligible, false);
  assert.equal(eligibility.reason, "notifications_disabled");
});

test("curriculum notification eligibility rejects future locked and invalid Days", () => {
  const state = {
    ...makeDefaultCurriculumProgressState(new Date("2026-05-14T20:59:00.000Z")),
    currentDay: 8,
    dayRecords: [
      {
        day: 8,
        dayType: CURRICULUM_DAY_TYPES.action,
        completionConfirmed: false,
      },
      {
        day: 9,
        dayType: CURRICULUM_DAY_TYPES.interview,
        completionConfirmed: false,
      },
    ],
  };

  const future = resolveCurriculumNotificationEligibility({ progressState: state, day: 9 });
  assert.equal(future.eligible, false);
  assert.equal(future.reason, "day_not_unlocked");
  assert.equal(future.day, 9);
  assert.equal(future.currentDay, 8);

  const invalid = resolveCurriculumNotificationEligibility({ progressState: state, day: 31 });
  assert.equal(invalid.eligible, false);
  assert.equal(invalid.reason, "invalid_day");
});

test("curriculum notification eligibility rejects repeat sends on the same UTC day", () => {
  const state = {
    ...makeDefaultCurriculumProgressState(new Date("2026-05-14T20:59:00.000Z")),
    currentDay: 10,
    notificationConfig: {
      enabled: true,
      fixedTime: "21:00",
      lastSent: "2026-05-14T12:00:00.000Z",
    },
    dayRecords: [
      {
        day: 10,
        dayType: CURRICULUM_DAY_TYPES.education,
        completionConfirmed: false,
      },
    ],
  };

  const alreadySent = resolveCurriculumNotificationEligibility({
    progressState: state,
    now: new Date("2026-05-14T21:00:00.000Z"),
  });
  assert.equal(alreadySent.eligible, false);
  assert.equal(alreadySent.reason, "notification_already_sent_today");

  const nextDay = resolveCurriculumNotificationEligibility({
    progressState: state,
    now: new Date("2026-05-15T21:00:00.000Z"),
  });
  assert.equal(nextDay.eligible, true);
  assert.equal(nextDay.reason, "day_incomplete_notifications_enabled");
});

test("curriculum notification eligibility stops permanently after graduation", () => {
  const state = applyCurriculumProgressEvent(
    {
      ...makeDefaultCurriculumProgressState(new Date("2026-05-14T20:59:00.000Z")),
      currentDay: 30,
    },
    {
      type: CURRICULUM_PROGRESS_EVENT_TYPES.dayCompletionConfirmed,
      day: 30,
      dayType: CURRICULUM_DAY_TYPES.action,
      occurredAt: "2026-05-14T20:59:30.000Z",
    },
  );

  assert.equal(isCurriculumNotificationEligible({ progressState: state, currentDay: 30 }), false);
  const eligibility = resolveCurriculumNotificationEligibility({ progressState: state, currentDay: 30 });
  assert.equal(eligibility.eligible, false);
  assert.equal(eligibility.reason, "curriculum_graduated");
});

test("Day 1 partial task progress events do not persist completion", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-day1-partial-progress-"));
  const filePath = path.join(dir, "curriculum-progress.json");
  let state = makeDefaultCurriculumProgressState(new Date("2026-05-14T08:59:00.000Z"));
  const partialEvents = [
    {
      type: CURRICULUM_PROGRESS_EVENT_TYPES.day1DraftAnswerSaved,
      day: 1,
      dayType: CURRICULUM_DAY_TYPES.interview,
      completed: true,
      completionConfirmed: true,
      draft: true,
      answerStatus: "draft",
      occurredAt: "2026-05-14T09:01:00.000Z",
    },
    {
      type: CURRICULUM_PROGRESS_EVENT_TYPES.day1IncompleteActionRecorded,
      day_id: 1,
      day_type: CURRICULUM_DAY_TYPES.interview,
      completed: true,
      completion_confirmed: true,
      action_status: "incomplete",
      occurred_at: "2026-05-14T09:02:00.000Z",
    },
    {
      type: CURRICULUM_PROGRESS_EVENT_TYPES.day1VerificationFailed,
      day: 1,
      completed: true,
      completionConfirmed: true,
      verificationResult: {
        method: "browser",
        passed: false,
        reason: "Submitted page did not include the requested completion signal.",
      },
      occurredAt: "2026-05-14T09:03:00.000Z",
    },
  ];

  for (const event of partialEvents) {
    state = applyCurriculumProgressEvent(state, event);
    const record = state.dayRecords[0];
    assert.equal(record.day, 1);
    assert.equal(record.completed, false);
    assert.equal(record.completionConfirmed, false);
    assert.equal(record.completedAt, "");
  }

  assert.deepEqual(
    state.dayRecords[0].lifecycleEvents.map((event) => [event.type, event.completionDriver]),
    [
      [CURRICULUM_PROGRESS_EVENT_TYPES.day1DraftAnswerSaved, false],
      [CURRICULUM_PROGRESS_EVENT_TYPES.day1IncompleteActionRecorded, false],
      [CURRICULUM_PROGRESS_EVENT_TYPES.day1VerificationFailed, false],
    ],
  );

  await persistCurriculumProgressState(filePath, state, {
    now: () => new Date("2026-05-14T09:03:05.000Z"),
  });
  const loaded = await loadCurriculumProgressState(filePath);
  assert.equal(loaded.dayRecords[0].completed, false);
  assert.equal(loaded.dayRecords[0].completionConfirmed, false);
  assert.equal(loaded.dayRecords[0].completion_confirmed, false);
  assert.equal(loaded.dayRecords[0].completedAt, "");
});

test("Day 2+ question progress persists and restores across curriculum module reloads", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-day2-question-progress-"));
  const filePath = path.join(dir, "curriculum-progress.json");
  let state = makeDefaultCurriculumProgressState(new Date("2026-05-14T08:59:00.000Z"));
  const day2Spec = {
    day: 2,
    dayType: CURRICULUM_DAY_TYPES.action,
    day_goal: "돈이 흐르는 기준 시장을 고른다",
    key_questions_with_intent: [
      {
        id: "day-2-market-category",
        question: "어느 기준 시장에서 이미 돈이 흐르나요?",
        intent: "사용자가 실제 지불 행동이 있는 시장을 고르게 한다.",
      },
      {
        id: "day-2-paid-comparables",
        question: "유료 앱 5개 중 반복되는 가격·리뷰 신호는 무엇인가요?",
        intent: "시장 선택을 추측이 아니라 공개 지불 증거로 좁힌다.",
      },
      {
        id: "day-2-evidence-location",
        question: "오늘 증거 로그는 어디에 남겼나요?",
        intent: "다음 Review Day가 자동으로 근거를 찾을 수 있게 한다.",
      },
    ],
  };

  state = applyCurriculumProgressEvent(state, {
    type: CURRICULUM_PROGRESS_EVENT_TYPES.dayQuestionProgressSaved,
    day: 2,
    dayType: CURRICULUM_DAY_TYPES.action,
    questionId: "day-2-market-category",
    question: "어느 기준 시장에서 이미 돈이 흐르나요?",
    intent: "사용자가 실제 지불 행동이 있는 시장을 고르게 한다.",
    answer: "Mac menu bar productivity tools with paid indie apps.",
    answerStatus: "draft",
    occurredAt: "2026-05-14T09:11:00.000Z",
  });
  state = applyCurriculumProgressEvent(state, {
    event_type: "question_answer_saved",
    day_id: 2,
    day_type: CURRICULUM_DAY_TYPES.action,
    question_id: "day-2-market-category",
    answer: "Mac menu bar productivity tools with five paid indie comparables.",
    answer_status: "answered",
    occurred_at: "2026-05-14T09:12:00.000Z",
  });
  state = applyCurriculumProgressEvent(state, {
    type: CURRICULUM_PROGRESS_EVENT_TYPES.dayQuestionProgressSaved,
    day: 2,
    dayType: CURRICULUM_DAY_TYPES.action,
    questionId: "day-2-paid-comparables",
    question: "유료 앱 5개 중 반복되는 가격·리뷰 신호는 무엇인가요?",
    intent: "시장 선택을 추측이 아니라 공개 지불 증거로 좁힌다.",
    answer: "Still gathering the fifth comparable.",
    answerStatus: "draft",
    occurredAt: "2026-05-14T09:12:30.000Z",
  });
  state = applyCurriculumProgressEvent(state, {
    type: CURRICULUM_PROGRESS_EVENT_TYPES.day1DraftAnswerSaved,
    day: 1,
    questionId: "day-1-should-not-restore",
    answer: "Day 1 practice answer remains reset-bound before completion.",
    answerStatus: "draft",
    occurredAt: "2026-05-14T09:13:00.000Z",
  });

  await persistCurriculumProgressState(filePath, state, {
    now: () => new Date("2026-05-14T09:12:05.000Z"),
  });

  const reloadedModule = await import(
    `../sidecar/adaptive-curriculum.mjs?state-restore=${Date.now()}`
  );
  const restored = await reloadedModule.loadCurriculumProgressState(filePath);

  const day2 = restored.dayRecords.find((record) => record.day === 2);
  const day1 = restored.dayRecords.find((record) => record.day === 1);

  assert.equal(restored.schemaVersion, CURRICULUM_PROGRESS_SCHEMA_VERSION);
  assert.equal(day2.dayType, CURRICULUM_DAY_TYPES.action);
  assert.equal(day2.completed, false);
  assert.equal(day2.completionConfirmed, false);
  assert.equal(day2.questionProgress.length, 2);
  assert.equal(day2.question_progress, day2.questionProgress);
  assert.deepEqual(day2.questionProgress[0], {
    questionId: "day-2-market-category",
    question_id: "day-2-market-category",
    question: "어느 기준 시장에서 이미 돈이 흐르나요?",
    intent: "사용자가 실제 지불 행동이 있는 시장을 고르게 한다.",
    answer: "Mac menu bar productivity tools with five paid indie comparables.",
    status: "answered",
    answerStatus: "answered",
    answer_status: "answered",
    answeredAt: "2026-05-14T09:12:00.000Z",
    answered_at: "2026-05-14T09:12:00.000Z",
    updatedAt: "2026-05-14T09:12:00.000Z",
    updated_at: "2026-05-14T09:12:00.000Z",
  });
  assert.deepEqual(day2.questionProgress[1], {
    questionId: "day-2-paid-comparables",
    question_id: "day-2-paid-comparables",
    question: "유료 앱 5개 중 반복되는 가격·리뷰 신호는 무엇인가요?",
    intent: "시장 선택을 추측이 아니라 공개 지불 증거로 좁힌다.",
    answer: "Still gathering the fifth comparable.",
    status: "draft",
    answerStatus: "draft",
    answer_status: "draft",
    answeredAt: "",
    answered_at: "",
    updatedAt: "2026-05-14T09:12:30.000Z",
    updated_at: "2026-05-14T09:12:30.000Z",
  });
  assert.equal(day1.questionProgress.length, 0);

  const nextFromRestored = reloadedModule.identifyNextUnansweredDayQuestion({
    progressState: restored,
    curriculumDay: day2Spec,
  });
  assert.equal(nextFromRestored.didResolve, true);
  assert.equal(nextFromRestored.reason, "next_unanswered_question_resolved");
  assert.equal(nextFromRestored.questionIndex, 1);
  assert.equal(nextFromRestored.nextQuestion.id, "day-2-paid-comparables");
  assert.deepEqual(nextFromRestored.answeredQuestionIds, ["day-2-market-category"]);

  const answeredSecond = reloadedModule.applyCurriculumProgressEvent(restored, {
    event_type: "question_answer_saved",
    day_id: 2,
    day_type: CURRICULUM_DAY_TYPES.action,
    question_id: "day-2-paid-comparables",
    answer: "Five paid tools cluster around $8-15/mo and praise fast menu bar capture.",
    answer_status: "answered",
    occurred_at: "2026-05-14T09:15:00.000Z",
  });
  const nextAfterSecondAnswer = identifyNextUnansweredDayQuestion({
    progressState: answeredSecond,
    curriculumDay: day2Spec,
  });
  assert.equal(nextAfterSecondAnswer.questionIndex, 2);
  assert.equal(nextAfterSecondAnswer.next_question.id, "day-2-evidence-location");

  const answeredAll = applyCurriculumProgressEvent(answeredSecond, {
    type: CURRICULUM_PROGRESS_EVENT_TYPES.dayQuestionProgressSaved,
    day: 2,
    dayType: CURRICULUM_DAY_TYPES.action,
    questionId: "day-2-evidence-location",
    answer: "docs/day-2-evidence-log.md",
    answerStatus: "answered",
    occurredAt: "2026-05-14T09:16:00.000Z",
  });
  const completeResolution = identifyNextUnansweredDayQuestion({
    progressState: answeredAll,
    curriculumDay: day2Spec,
  });
  assert.equal(completeResolution.allQuestionsAnswered, true);
  assert.equal(completeResolution.nextQuestion, null);
  assert.equal(completeResolution.progressionBlocked, false);
});

test("persisted progress restoration finds the next unanswered Day 2+ onboarding question", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-restore-next-question-"));
  const filePath = path.join(dir, "curriculum-progress.json");
  const curriculumDays = [
    {
      day: 1,
      dayType: CURRICULUM_DAY_TYPES.interview,
      keyQuestions: [
        { id: "day-1-practice", question: "Day 1 should never be restored here." },
      ],
    },
    {
      day: 2,
      dayType: CURRICULUM_DAY_TYPES.action,
      keyQuestions: [
        { id: "day-2-market", question: "어느 시장을 고를까요?" },
      ],
    },
    {
      day: 3,
      dayType: CURRICULUM_DAY_TYPES.interview,
      keyQuestions: [
        { id: "day-3-subject", question: "누구를 인터뷰할까요?" },
        { id: "day-3-question", question: "가장 먼저 물어볼 과거 행동 질문은 무엇인가요?" },
      ],
    },
  ];
  let state = makeDefaultCurriculumProgressState(new Date("2026-05-14T08:59:00.000Z"));

  state = applyCurriculumProgressEvent(state, {
    event_type: "question_answer_saved",
    day_id: 2,
    day_type: CURRICULUM_DAY_TYPES.action,
    question_id: "day-2-market",
    answer: "Mac menu bar productivity.",
    answer_status: "answered",
    occurred_at: "2026-05-14T09:01:00.000Z",
  });
  state = applyCurriculumProgressEvent(state, {
    type: CURRICULUM_PROGRESS_EVENT_TYPES.dayCompletionConfirmed,
    day: 2,
    occurredAt: "2026-05-14T09:02:00.000Z",
  });
  state = applyCurriculumProgressEvent(state, {
    event_type: "question_answer_saved",
    day_id: 3,
    day_type: CURRICULUM_DAY_TYPES.interview,
    question_id: "day-3-subject",
    answer: "An indie Mac app founder who recently paid for an automation tool.",
    answer_status: "answered",
    occurred_at: "2026-05-14T09:03:00.000Z",
  });

  await persistCurriculumProgressState(filePath, state, {
    now: () => new Date("2026-05-14T09:04:00.000Z"),
  });

  const restored = await restoreNextUnansweredDayQuestionFromPersistedProgress(filePath, {
    curriculumDays,
  });

  assert.equal(restored.didRestore, true);
  assert.equal(restored.restoredFromPersistedProgress, true);
  assert.equal(restored.didResolve, true);
  assert.equal(restored.reason, "next_unanswered_question_resolved");
  assert.equal(restored.dayId, 3);
  assert.equal(restored.dayType, CURRICULUM_DAY_TYPES.interview);
  assert.equal(restored.questionIndex, 1);
  assert.equal(restored.nextQuestion.id, "day-3-question");
  assert.deepEqual(restored.answeredQuestionIds, ["day-3-subject"]);
  assert.equal(restored.progressionBlocked, false);
  assert.equal(restored.progressState.dayRecords.find((record) => record.day === 2).completed, true);

  const day1Resolution = restoreNextUnansweredDayQuestionFromProgressState({
    progressState: restored.progressState,
    curriculumDays,
    day: 1,
  });
  assert.equal(day1Resolution.didRestore, false);
  assert.equal(day1Resolution.reason, "day1_progress_resets_before_completion");
  assert.equal(day1Resolution.nextQuestion, null);
});

test("launch routing maps restored Day 2+ state to the next unanswered question destination", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-launch-route-"));
  const filePath = path.join(dir, "curriculum-progress.json");
  const curriculumDays = [
    {
      day: 2,
      dayType: CURRICULUM_DAY_TYPES.action,
      keyQuestions: [
        { id: "day-2-market", question: "어느 시장을 고를까요?" },
        { id: "day-2-evidence", question: "증거는 어디에 남겼나요?" },
      ],
    },
    {
      day: 3,
      dayType: CURRICULUM_DAY_TYPES.interview,
      keyQuestions: [
        { id: "day-3-subject", question: "누구를 인터뷰할까요?" },
      ],
    },
  ];
  let state = makeDefaultCurriculumProgressState(new Date("2026-05-14T08:59:00.000Z"));
  state = applyCurriculumProgressEvent(state, {
    type: CURRICULUM_PROGRESS_EVENT_TYPES.dayQuestionProgressSaved,
    day: 2,
    dayType: CURRICULUM_DAY_TYPES.action,
    questionId: "day-2-market",
    question: "어느 시장을 고를까요?",
    answer: "Mac menu bar productivity.",
    answerStatus: "answered",
    occurredAt: "2026-05-14T09:01:00.000Z",
  });

  await persistCurriculumProgressState(filePath, state, {
    now: () => new Date("2026-05-14T09:02:00.000Z"),
  });

  const route = await resolveCurriculumLaunchRouteFromPersistedProgress(filePath, {
    curriculumDays,
  });

  assert.equal(route.schema, "agentic30.curriculum.launch_route.v1");
  assert.equal(route.didRoute, true);
  assert.equal(route.did_route, true);
  assert.equal(route.routeKind, "curriculum_day_question");
  assert.equal(route.reason, "restored_next_unanswered_question_destination");
  assert.equal(route.progressionBlocked, false);
  assert.equal(route.destination.surface, "workspace_curriculum_day");
  assert.equal(route.destination.dayId, 2);
  assert.equal(route.destination.dayType, CURRICULUM_DAY_TYPES.action);
  assert.equal(route.destination.componentType, "action_auto_verify_evidence");
  assert.equal(route.destination.questionIndex, 1);
  assert.equal(route.destination.questionId, "day-2-evidence");
  assert.equal(route.destination.focusElementId, "workspace.curriculum.day.2.question.day-2-evidence");
  assert.equal(route.destination.nextQuestion.question, "증거는 어디에 남겼나요?");
  assert.deepEqual(route.restoration.answeredQuestionIds, ["day-2-market"]);
});

test("blocked curriculum progression gate prevents launch routing into a locked Day", () => {
  const curriculumDays = [
    {
      day: 6,
      dayType: CURRICULUM_DAY_TYPES.action,
      keyQuestions: [
        { id: "day-6-evidence", question: "증거는 어디에 남겼나요?" },
      ],
      prerequisite_requirements: {
        current_day: 6,
        requirements: [
          {
            requirement_id: "day-6-requires-day-2-market-log",
            requirement_mode: "blocking_prerequisite",
            required_before: "day_unlock",
            source_day: 2,
            source_action_id: "day-2-market-log",
          },
        ],
      },
    },
  ];
  const progressState = {
    dayRecords: [
      {
        day: 2,
        dayType: CURRICULUM_DAY_TYPES.action,
        completionConfirmed: true,
        action_spec: {
          id: "day-2-market-log",
        },
        verification_result: {
          method: "google_docs",
          passed: false,
          reason: "Only two competitors were found.",
        },
      },
    ],
  };
  const progressStateBeforeRouting = JSON.stringify(progressState);

  const restoration = restoreNextUnansweredDayQuestionFromProgressState({
    progressState,
    curriculumDays,
    day: 6,
  });
  assert.equal(restoration.didRestore, false);
  assert.equal(restoration.reason, "curriculum_progression_gate_blocked");
  assert.equal(restoration.progressionBlocked, true);
  assert.equal(restoration.progression_gate.status, "blocked");
  assert.equal(restoration.progression_gate.can_advance_day, false);
  assert.equal(restoration.blocked_state_metadata.status, "blocked");
  assert.equal(restoration.blocked_state_metadata.display_mode, "user_facing_unmet_prerequisite_actions");
  assert.equal(restoration.blocked_state_metadata.mutates_progression_state, false);
  assert.equal(restoration.blocked_state_metadata.progression_state_mutation_required, false);
  assert.deepEqual(
    restoration.blocked_state_metadata.unmet_prerequisite_actions.map((action) => ({
      requirement_id: action.requirement_id,
      source_day: action.source_day,
      source_action_id: action.source_action_id,
      action_description: action.action_description,
      completion_signal: action.completion_signal,
      latest_status: action.latest_status,
      user_facing: action.user_facing,
    })),
    [
      {
        requirement_id: "day-6-requires-day-2-market-log",
        source_day: 2,
        source_action_id: "day-2-market-log",
        action_description: "이전 Day 액션의 완료 증거를 확인해 주세요.",
        completion_signal: "자동 확인 또는 제출한 증거가 완료로 판정되어야 합니다.",
        latest_status: "unmet",
        user_facing: true,
      },
    ],
  );
  assert.equal(restoration.nextQuestion, null);

  const route = resolveCurriculumLaunchRouteFromRestoredState({
    progressState,
    curriculumDays,
    day: 6,
  });
  assert.equal(route.didRoute, false);
  assert.equal(route.routeKind, "progression_gate_blocked");
  assert.equal(route.progressionBlocked, true);
  assert.equal(route.progression_gate.status, "blocked");
  assert.equal(route.blocked_state_metadata.status, "blocked");
  assert.equal(route.blocked_state_metadata.unmet_prerequisite_actions[0].source_action_id, "day-2-market-log");
  assert.equal(route.destination, null);
  assert.equal(JSON.stringify(progressState), progressStateBeforeRouting);
  assert.equal(progressState.dayRecords[0].progression_blocked, undefined);
  assert.equal(progressState.dayRecords[0].blocked_state_metadata, undefined);
});

test("launch routing does not restore Day 1 or block progression when no Day 2+ question is pending", () => {
  const curriculumDays = [
    {
      day: 1,
      dayType: CURRICULUM_DAY_TYPES.interview,
      keyQuestions: [
        { id: "day-1-practice", question: "Day 1 practice question." },
      ],
    },
  ];
  const route = resolveCurriculumLaunchRouteFromRestoredState({
    progressState: makeDefaultCurriculumProgressState(new Date("2026-05-14T08:59:00.000Z")),
    curriculumDays,
    day: 1,
  });

  assert.equal(route.didRoute, false);
  assert.equal(route.destination, null);
  assert.equal(route.routeKind, "none");
  assert.equal(route.reason, "day1_progress_resets_before_completion");
  assert.equal(route.progressionBlocked, false);
});

test("Day 1 failed verification result is not a completion driver even with completion-ish event type", () => {
  const nowValues = [
    "2026-05-14T09:04:00.000Z",
    "2026-05-14T09:04:05.000Z",
    "2026-05-14T09:04:10.000Z",
  ].map((value) => new Date(value));
  const now = () => nowValues.shift() ?? new Date("2026-05-14T09:04:10.000Z");
  const pending = createActionDayVerificationState({
    dayId: 1,
    actionId: "day-1-practice-action",
    actionDescription: "Practice answer evidence check.",
    completionSignal: "Submitted answer includes concrete yesterday behavior.",
    preferredMethods: [ACTION_VERIFICATION_METHOD.browser],
    now,
  });
  const running = startActionVerification(pending, {
    method: ACTION_VERIFICATION_METHOD.browser,
    verifier: "browser-harness",
    now,
  });
  const failed = failActionVerification(running, {
    reason: "No concrete yesterday behavior found.",
    agentAssessment: "The practice answer is still a draft, so Day 1 must stay incomplete.",
    now,
  });
  const state = applyCurriculumProgressEvent(
    {},
    {
      type: "day_completed",
      day: 1,
      completed: true,
      completionConfirmed: true,
      verificationState: failed,
      verificationResult: failed.verificationResult,
      occurredAt: "2026-05-14T09:04:11.000Z",
    },
  );

  assert.equal(failed.status, "failed");
  assert.equal(failed.verificationResult.passed, false);
  assert.equal(state.dayRecords[0].completed, false);
  assert.equal(state.dayRecords[0].completionConfirmed, false);
  assert.equal(state.dayRecords[0].completedAt, "");
  assert.deepEqual(
    state.dayRecords[0].lifecycleEvents.map((event) => [event.type, event.completionDriver]),
    [["day_completed", false]],
  );
});

test("deriveCurriculumSignals detects L2, BIP, journal, and revenue evidence", () => {
  const signals = deriveCurriculumSignals({
    evidence: {
      fullRead: true,
      docText: "오늘 고객 인터뷰 transcript에서 가격 질문을 받았다. 결제 가능성 있음.",
      allRows: [
        { date: "2026-05-01", posts: ["첫 BIP"], insights: "L2 고객 발화 정리" },
        { date: "2026-05-02", posts: ["둘째 BIP"], insights: "가격 ask 보냄" },
      ],
      recentRows: [
        { date: "2026-05-02", posts: ["둘째 BIP"], insights: "가격 ask 보냄" },
      ],
    },
    currentMission: { status: "completed" },
  }, {
    now: new Date("2026-05-07T00:00:00.000Z"),
  });

  assert.ok(signals.interviewCount >= 1);
  assert.equal(signals.bipRows, 2);
  assert.equal(signals.hasJournal, true);
  assert.equal(signals.hasRevenueSignal, true);
  assert.equal(signals.currentMissionCompleted, true);
  assert.ok(!signals.evidenceGaps.includes("interview_transcript"));
});

test("deriveCurriculumSignals treats app-store and ad metrics as platform evidence", () => {
  const signals = deriveCurriculumSignals({
    evidence: {
      docText: "iOS 구독 paywall 가격 테스트와 Android AdMob eCPM, CPI, store conversion 기록.",
      allRows: [
        { date: "2026-05-03", posts: ["ASO 테스트"], insights: "first_value activation 개선" },
      ],
    },
  }, {
    now: new Date("2026-05-07T00:00:00.000Z"),
  });

  assert.equal(signals.hasRevenueSignal, true);
  assert.equal(signals.hasUserCountSignal, true);
  assert.ok(!signals.evidenceGaps.includes("revenue_or_time_ask"));
});

test("detectHaventDoneItResponse flags in-Day messages where the action is not done", () => {
  const english = detectHaventDoneItResponse({
    role: "user",
    dayId: 16,
    content: "I haven't sent the tester install note yet.",
  });
  const korean = detectHaventDoneResponse({
    role: "user",
    day_id: 16,
    answer: "아직 체크리스트 실행 못 했어요.",
  });

  assert.equal(english.detected, true);
  assert.equal(english.isHaventDoneItResponse, true);
  assert.equal(english.shouldStartMiniAction, true);
  assert.equal(english.actionSufficiency, "insufficient");
  assert.equal(english.reason, "user_reports_action_not_done");
  assert.equal(english.coachingMode, "non_blocking_mini_action");
  assert.equal(korean.detected, true);
  assert.equal(korean.shouldStartMiniAction, true);
  assert.equal(detectHaventDoneItResponse({ role: "user", text: "No, I haven't." }).detected, true);
  assert.equal(detectHaventDoneItResponse({ role: "user", text: "아직요" }).detected, true);
});

test("detectHaventDoneItResponse does not flag completed or assistant messages", () => {
  assert.equal(detectHaventDoneItResponse("Done, I sent the DM and logged the reply.").detected, false);
  assert.equal(detectHaventDoneItResponse({
    role: "assistant",
    content: "If you haven't done it, use this template.",
  }).detected, false);
  assert.equal(detectHaventDoneItResponse({
    role: "user",
    content: "I did it, but not sure whether the evidence is strong enough.",
  }).detected, false);
});

test("buildMiniActionSessionTriggerEvent emits non-blocking trigger payload for haven't-done-it answers", () => {
  const event = buildMiniActionSessionTriggerEvent({
    sessionId: "session-16",
    curriculumDay: { day: 16, dayType: "action", title: "Release Gate" },
    message: {
      role: "user",
      content: "I haven't sent the tester install note yet.",
    },
  });

  assert.equal(event.type, "curriculum_mini_action_session_triggered");
  assert.equal(event.schemaVersion, 1);
  assert.equal(event.sessionId, "session-16");
  assert.equal(event.day, 16);
  assert.equal(event.componentType, "curriculum_mini_action_session");
  assert.equal(event.interactive, false);
  assert.equal(event.non_interactive, true);
  assert.equal(event.interaction_mode, "non_interactive_execution");
  assert.equal(event.current_step, "execution");
  assert.equal(event.start_step, "execution");
  assert.equal(event.auto_proceed_to_execution, true);
  assert.equal(event.emit_user_response_prompt, false);
  assert.equal(event.await_user_response_prompt, false);
  assert.equal(event.requires_user_input_checkpoint, false);
  assert.equal(event.required_user_input_checkpoint, false);
  assert.equal(event.user_input_checkpoint_required, false);
  assert.equal(event.checkpoint_policy.required_user_input_checkpoint, false);
  assert.equal(event.trigger.reason, "user_reports_action_not_done");
  assert.equal(event.trigger.coachingMode, "non_blocking_mini_action");
  assert.equal(event.trigger.actionSufficiency, "insufficient");
  assert.equal(
    buildMiniActionSessionTriggerEvent({
      sessionId: "session-16",
      curriculumDay: { day: 16 },
      message: { role: "user", content: "Done, I sent it." },
    }),
    null,
  );
});

test("adaptCurriculumDay evolves missing-interview foundation days into evidence capture", () => {
  const day = adaptCurriculumDay({
    curriculumDay: {
      day: 5,
      phase: "foundation",
      title: "첫 결제 구조를 세운다",
      tasks: ["유료화할 가치 1개 선택"],
      output: "페이월 카피",
    },
    state: {
      evidence: {
        fullRead: true,
        allRows: [],
        recentRows: [],
        docText: "",
      },
    },
  });

  assert.equal(day.day, 5);
  assert.match(day.tasks[0], /L2 인터뷰 transcript/);
  assert.match(day.tasks[1], /시간\/돈\/다음 일정 ask/);
  assert.match(day.valueContract.todayValue, /수요 신호/);
  assert.match(day.valueContract.passGate, /reply|install|price/);
  assert.ok(day.evidenceNeeds.includes("L2 quote required before insight claims"));
  assert.ok(day.evidenceNeeds.includes("time_or_money_ask"));
  assert.match(day.nextQuestions[0], /office-hours/);
  assert.match(day.nextQuestions[1], /plan-ceo-review/);
  assert.ok(day.layerChecks.some((line) => /Builder/.test(line)));
  assert.ok(day.layerChecks.some((line) => /Product/.test(line)));
});

test("adaptCurriculumDay carries completed mission result into next tasks", () => {
  const day = adaptCurriculumDay({
    curriculumDay: { day: 20, phase: "launch", title: "Warm outreach" },
    state: {
      evidence: {
        fullRead: true,
        docText: "고객 인터뷰 transcript 있음",
        allRows: [
          { date: "2026-05-06", posts: ["진행 공개"], insights: "DM 응답은 아직 없음" },
        ],
      },
      currentMission: {
        status: "completed",
        mission: "DM 10개 발송 완료",
      },
    },
  });

  assert.equal(day.day, 20);
  assert.ok(day.tasks.some((task) => /어제 완료한 미션 결과/.test(task)));
  assert.match(day.output, /최근 배움 반영/);
});

test("finalizeWeeklySummaryForCompletedDay appends one finalized summary at week completion", () => {
  const initial = makeDefaultCurriculumProgressState(new Date("2026-05-01T00:00:00.000Z"));
  const result = finalizeWeeklySummaryForCompletedDay(initial, {
    completedDay: 7,
    dayRecords: [
      { day: 1, title: "Pain", completionConfirmed: true },
      { day: 7, title: "Go/No-Go", completionConfirmed: true },
    ],
    summaryText: "Week 1: pain evidence narrowed and go/no-go decision recorded.",
    keyInsights: ["One narrow pain beat broad ideation"],
    unresolvedActions: ["Run one more interview"],
    finalizedAt: new Date("2026-05-07T21:00:00.000Z"),
  });

  assert.equal(result.didFinalize, true);
  assert.equal(result.finalizedSummary.status, "finalized");
  assert.equal(result.finalizedSummary.weekNumber, 1);
  assert.deepEqual(result.finalizedSummary.dayRange, { start: 1, end: 7 });
  assert.deepEqual(result.finalizedSummary.completedDays, [1, 7]);
  assert.equal(result.state.weeklySummaryStack.length, 1);
  assert.equal(result.state.weeklySummaryStack[0].summaryText, "Week 1: pain evidence narrowed and go/no-go decision recorded.");
  assert.deepEqual(result.state.weeklySummaryStack[0].keyInsights, ["One narrow pain beat broad ideation"]);
  assert.deepEqual(result.state.weeklySummaryStack[0].unresolvedActions, ["Run one more interview"]);
});

test("finalizeWeeklySummaryForCompletedDay is idempotent and only fires on 7-day boundaries through Day 28", () => {
  const first = finalizeWeeklySummaryForCompletedDay({}, {
    completedDay: 7,
    summaryText: "Week 1 final",
    finalizedAt: new Date("2026-05-07T21:00:00.000Z"),
  });
  const duplicate = finalizeWeeklySummaryForCompletedDay(first.state, {
    completedDay: 7,
    summaryText: "Week 1 rewritten",
    finalizedAt: new Date("2026-05-08T21:00:00.000Z"),
  });
  const betweenWeeks = finalizeWeeklySummaryForCompletedDay(duplicate.state, {
    completedDay: 8,
    summaryText: "Should not persist",
  });
  const day30 = finalizeWeeklySummaryForCompletedDay(betweenWeeks.state, {
    completedDay: 30,
    summaryText: "Graduation is not a weekly compaction boundary",
  });

  assert.equal(first.didFinalize, true);
  assert.equal(duplicate.didFinalize, false);
  assert.equal(duplicate.state.weeklySummaryStack.length, 1);
  assert.equal(duplicate.state.weeklySummaryStack[0].summaryText, "Week 1 final");
  assert.equal(betweenWeeks.didFinalize, false);
  assert.equal(day30.didFinalize, false);
  assert.equal(day30.state.weeklySummaryStack.length, 1);
});

test("finalizeWeeklySummaryForCompletedDay reuses an existing finalized week when duplicate records exist", () => {
  const result = finalizeWeeklySummaryForCompletedDay({
    weeklySummaryStack: [
      {
        weekNumber: 1,
        status: "draft",
        summaryText: "Week 1 old draft",
      },
      {
        weekNumber: 1,
        status: "finalized",
        finalizedAt: "2026-05-07T21:00:00.000Z",
        summaryText: "Week 1 original final",
        keyInsights: ["Original insight"],
      },
      {
        weekNumber: 1,
        status: "draft",
        summaryText: "Week 1 stale draft that must not replace final",
      },
    ],
  }, {
    completedDay: 7,
    summaryText: "Week 1 duplicate final",
    finalizedAt: new Date("2026-05-08T21:00:00.000Z"),
  });

  assert.equal(result.didFinalize, false);
  assert.equal(result.finalizedSummary.status, "finalized");
  assert.equal(result.finalizedSummary.summaryText, "Week 1 original final");
  assert.deepEqual(result.finalizedSummary.keyInsights, ["Original insight"]);
  assert.deepEqual(
    result.state.weeklySummaryStack.map((entry) => [entry.weekNumber, entry.status, entry.summaryText]),
    [[1, "finalized", "Week 1 original final"]],
  );
});

test("curriculum progress persistence preserves finalized weekly summary stack records", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-curriculum-progress-"));
  const filePath = path.join(dir, "curriculum-progress.json");
  const week1 = finalizeWeeklySummaryForCompletedDay({}, {
    completedDay: 7,
    summaryText: "Week 1 standalone summary",
    keyInsights: ["Pain was concrete"],
    unresolvedActions: ["Collect one transcript"],
    finalizedAt: new Date("2026-05-07T21:00:00.000Z"),
  });
  const week2 = finalizeWeeklySummaryForCompletedDay(week1.state, {
    completedDay: 14,
    summaryText: "Week 2 standalone summary",
    keyInsights: ["Activation needs instrumentation"],
    unresolvedActions: [],
    finalizedAt: new Date("2026-05-14T21:00:00.000Z"),
  });

  await persistCurriculumProgressState(filePath, week2.state, {
    now: () => new Date("2026-05-14T21:01:00.000Z"),
  });
  const loaded = await loadCurriculumProgressState(filePath);

  assert.equal(loaded.schemaVersion, CURRICULUM_PROGRESS_SCHEMA_VERSION);
  assert.equal(loaded.weeklySummaryStack.length, 2);
  assert.deepEqual(
    loaded.weeklySummaryStack.map((entry) => [entry.weekNumber, entry.status, entry.summaryText]),
    [
      [1, "finalized", "Week 1 standalone summary"],
      [2, "finalized", "Week 2 standalone summary"],
    ],
  );
  assert.deepEqual(loaded.weeklySummaryStack[0].keyInsights, ["Pain was concrete"]);
  assert.deepEqual(loaded.weeklySummaryStack[0].unresolvedActions, ["Collect one transcript"]);
});

test("Day 22 context assembly includes finalized Weeks 1, 2, and 3 in chronological order", () => {
  const context = assembleCurriculumDayContext({
    day: 22,
    progressState: {
      weeklySummaryStack: [
        {
          weekNumber: 3,
          status: "finalized",
          summaryText: "Week 3 launch proof and observation summary",
          keyInsights: ["Warm outreach produced tester observations"],
        },
        {
          weekNumber: 1,
          status: "finalized",
          summaryText: "Week 1 foundation summary",
          keyInsights: ["Pain was concrete"],
        },
        {
          weekNumber: 2,
          status: "draft",
          summaryText: "Week 2 draft must not enter Day 22 context",
        },
        {
          weekNumber: 2,
          status: "finalized",
          summaryText: "Week 2 build summary",
          keyInsights: ["Activation instrumentation was the weak spot"],
        },
        {
          weekNumber: 4,
          status: "finalized",
          summaryText: "Future week must not enter Day 22 context",
        },
      ],
    },
    projectContext: { product: "Agentic30" },
    currentWeekRawAnswers: [
      { day: 21, questionId: "observe", answer: "Previous week answer" },
      { day: 22, questionId: "demo-hook", answer: "Lead with the 60 second result" },
      { day: 24, questionId: "decision", answer: "Use install and first_value numbers" },
      { day: 29, questionId: "pmf", answer: "Future week answer" },
    ],
  });

  assert.deepEqual(context.includedWeeks, [1, 2, 3]);
  assert.deepEqual(context.missingFinalizedWeeks, []);
  assert.deepEqual(
    context.priorWeeklySummaries.map((summary) => summary.summaryText),
    [
      "Week 1 foundation summary",
      "Week 2 build summary",
      "Week 3 launch proof and observation summary",
    ],
  );
  assert.deepEqual(context.contextOrder.slice(0, 3), [
    "week_1_summary",
    "week_2_summary",
    "week_3_summary",
  ]);
  assert.deepEqual(
    context.currentWeekRawAnswers.map((answer) => [answer.day, answer.questionId]),
    [
      [22, "demo-hook"],
      [24, "decision"],
    ],
  );
});

test("Day 30 context assembly includes all finalized weekly summaries chronologically", () => {
  const context = assembleCurriculumDayContext({
    day: 30,
    progressState: {
      weeklySummaryStack: [
        { weekNumber: 4, status: "finalized", summaryText: "Week 4 grow summary" },
        { weekNumber: 2, status: "finalized", summaryText: "Week 2 build summary" },
        { weekNumber: 1, status: "finalized", summaryText: "Week 1 foundation summary" },
        { weekNumber: 3, status: "finalized", summaryText: "Week 3 launch summary" },
      ],
      rawAnswers: [
        { day: 28, questionId: "review", answer: "Prior week raw answer must be compacted" },
        { day: 29, questionId: "pmf-memo", answer: "Evidence memo answer" },
        { day: 30, questionId: "final-decision", answer: "Continue with evidence" },
      ],
    },
  });

  assert.equal(context.weekNumber, 5);
  assert.deepEqual(context.currentWeekRange, { start: 29, end: 30 });
  assert.deepEqual(context.includedWeeks, [1, 2, 3, 4]);
  assert.deepEqual(context.missingFinalizedWeeks, []);
  assert.deepEqual(
    context.priorWeeklySummaries.map((summary) => summary.summaryText),
    [
      "Week 1 foundation summary",
      "Week 2 build summary",
      "Week 3 launch summary",
      "Week 4 grow summary",
    ],
  );
  assert.deepEqual(
    context.contextOrder,
    [
      "week_1_summary",
      "week_2_summary",
      "week_3_summary",
      "week_4_summary",
      "project_context",
      "carry_over_coaching",
      "rushing_risk",
      "adaptive_difficulty_state",
      "prerequisite_requirements",
      "coaching_feedback_surface",
      "current_week_raw_answers",
    ],
  );
  assert.deepEqual(
    context.currentWeekRawAnswers.map((answer) => [answer.day, answer.questionId]),
    [
      [29, "pmf-memo"],
      [30, "final-decision"],
    ],
  );
});

test("Day 22 context assembly includes raw answers from the current week only", () => {
  const context = assembleCurriculumDayContext({
    day: 22,
    progressState: {
      rawAnswers: [
        { day: 1, questionId: "pain", answer: "Week 1 raw answer must be compacted only" },
        { day: 7, questionId: "foundation-review", answer: "Week 1 review answer must be excluded" },
        { day: 8, questionId: "core-action", answer: "Week 2 raw answer must be compacted only" },
        { day: 14, questionId: "measurement", answer: "Week 2 review answer must be excluded" },
        { day: 15, questionId: "revenue-dry-run", answer: "Week 3 raw answer must be compacted only" },
        { day: 21, questionId: "observe", answer: "Week 3 review answer must be excluded" },
        { day: 22, questionId: "demo-hook", answer: "Open with the result before process" },
        { day: 23, questionId: "paid-learning", answer: "Test one tiny hook with a stop rule" },
        { day: 28, questionId: "acquisition-loop", answer: "Tighten the store page hook" },
        { day: 29, questionId: "pmf-memo", answer: "Future week PMF answer" },
      ],
    },
  });

  assert.deepEqual(context.currentWeekRange, { start: 22, end: 28 });
  assert.deepEqual(
    context.currentWeekRawAnswers.map((answer) => [answer.day, answer.questionId]),
    [
      [22, "demo-hook"],
      [23, "paid-learning"],
      [28, "acquisition-loop"],
    ],
  );
  assert.deepEqual(
    [...new Set(context.currentWeekRawAnswers.map((answer) => Math.ceil(answer.day / 7)))],
    [4],
  );
  assert.doesNotMatch(
    JSON.stringify(context.currentWeekRawAnswers),
    /Week [123] raw answer|Week [123] review answer/,
  );
  assert.ok(context.currentWeekRawAnswers.every((answer) =>
    answer.day >= context.currentWeekRange.start && answer.day <= context.currentWeekRange.end
  ));
});

test("Day 22 context assembly keeps only current-week raw interview answers", () => {
  const context = assembleCurriculumDayContext({
    day: 22,
    progressState: {
      rawInterviewAnswers: [
        {
          day: 20,
          questionId: "warm-outreach-reflection",
          question: "What did the outreach replies reveal?",
          answer: "Prior-week interview answer must stay behind the week summary.",
          dayType: "interview",
        },
        {
          day: 22,
          questionId: "demo-interview-opening",
          question: "What should this week's interview-driven demo open with?",
          answer: "Open with the visible customer result before showing process.",
          dayType: "interview",
        },
        {
          day: 24,
          questionId: "launch-decision-interview",
          question: "Which customer phrase should guide the launch decision?",
          answer: "Use the phrase about setup friction as the decision anchor.",
          dayType: "interview",
        },
        {
          day: 29,
          questionId: "pmf-interview",
          question: "What did the final PMF conversation say?",
          answer: "Future-week interview answer must not enter Day 22 context.",
          dayType: "interview",
        },
      ],
    },
  });

  assert.deepEqual(context.currentWeekRange, { start: 22, end: 28 });
  assert.deepEqual(
    context.currentWeekRawInterviewAnswers.map((answer) => [answer.day, answer.questionId, answer.answer]),
    [
      [22, "demo-interview-opening", "Open with the visible customer result before showing process."],
      [24, "launch-decision-interview", "Use the phrase about setup friction as the decision anchor."],
    ],
  );
  assert.deepEqual(context.currentWeekRawAnswers, context.currentWeekRawInterviewAnswers);
  assert.doesNotMatch(
    JSON.stringify(context.currentWeekRawInterviewAnswers),
    /Prior-week interview answer|Future-week interview answer/,
  );
});

test("Day 22 context assembly selects onboarding answers from the current week only", () => {
  const plan = buildAdaptiveCurriculum({
    selectedDay: 22,
    state: {
      onboardingAnswers: [
        { day: 6, questionId: "ask", answer: "Week 1 onboarding answer must stay compacted" },
        { day: 15, questionId: "dry-run", answer: "Week 3 onboarding answer must stay compacted" },
        { day: 22, questionId: "demo-hook", answer: "Lead with one visible result" },
        { day: 24, questionId: "launch-decision", answer: "Reuse this as the launch CTA" },
        { day: 29, questionId: "pmf-memo", answer: "Future onboarding answer must be excluded" },
      ],
    },
    now: new Date("2026-05-22T09:00:00.000Z"),
  });

  assert.deepEqual(plan.curriculumContext.currentWeekRange, { start: 22, end: 28 });
  assert.deepEqual(
    plan.curriculumContext.currentWeekRawAnswers.map((answer) => [answer.day, answer.questionId]),
    [
      [22, "demo-hook"],
      [24, "launch-decision"],
    ],
  );
  assert.doesNotMatch(
    JSON.stringify(plan.curriculumContext.currentWeekRawAnswers),
    /Week [13] onboarding answer|Future onboarding answer/,
  );
});

test("buildAdaptiveCurriculum exposes Day 22 weekly summary context on the selected day", () => {
  const plan = buildAdaptiveCurriculum({
    selectedDay: 22,
    state: {
      weeklySummaryStack: [
        { weekNumber: 2, status: "finalized", summaryText: "Week 2" },
        { weekNumber: 1, status: "finalized", summaryText: "Week 1" },
        { weekNumber: 3, status: "finalized", summaryText: "Week 3" },
      ],
      currentWeekRawAnswers: [
        { day: 22, questionId: "demo", answer: "Demo answer" },
      ],
    },
    now: new Date("2026-05-22T09:00:00.000Z"),
  });

  assert.equal(plan.selectedDay.day, 22);
  assert.deepEqual(plan.curriculumContext.includedWeeks, [1, 2, 3]);
  assert.deepEqual(plan.selectedDay.curriculumContext.includedWeeks, [1, 2, 3]);
  assert.deepEqual(
    plan.selectedDay.curriculumContext.priorWeeklySummaries.map((summary) => summary.summaryText),
    ["Week 1", "Week 2", "Week 3"],
  );
});

test("Day context assembly keeps current project metadata separate from weekly summaries", () => {
  const plan = buildAdaptiveCurriculum({
    selectedDay: 22,
    state: {
      currentProjectContext: {
        metadata: {
          workspaceRoot: "/Users/october/prj/agentic30-public",
          projectName: "Agentic30 Public",
          platform: "macOS menubar app",
        },
        context: {
          activeSurface: "Curriculum navigator",
          currentObjective: "Build Day 22 launch demo verification",
          canonicalDocs: ["docs/ICP.md", "docs/SPEC.md"],
        },
      },
      weeklySummaryStack: [
        {
          weekNumber: 1,
          status: "finalized",
          summaryText: "Week 1 foundation summary",
          keyInsights: ["Pain evidence narrowed"],
        },
        {
          weekNumber: 2,
          status: "finalized",
          summaryText: "Week 2 build summary",
          keyInsights: ["Activation instrumentation lagged"],
        },
        {
          weekNumber: 3,
          status: "finalized",
          summaryText: "Week 3 launch summary",
          keyInsights: ["Warm outreach produced tester notes"],
        },
      ],
      rawAnswers: [
        { day: 22, questionId: "demo", answer: "Show one visible result first." },
      ],
    },
    now: new Date("2026-05-22T09:00:00.000Z"),
  });

  assert.equal(plan.curriculumContext.projectContext.metadata.projectName, "Agentic30 Public");
  assert.equal(plan.providerContextPayload.project_context.metadata.platform, "macOS menubar app");
  assert.deepEqual(
    plan.selectedDay.providerContextPayload.project_context.context.canonicalDocs,
    ["docs/ICP.md", "docs/SPEC.md"],
  );

  const projectBlock = plan.providerContextPayload.context_blocks.find((block) => block.id === "project_context");
  assert.equal(projectBlock.type, "project_context");
  assert.equal(projectBlock.content.metadata.workspaceRoot, "/Users/october/prj/agentic30-public");
  assert.deepEqual(
    plan.providerContextPayload.context_blocks.map((block) => block.id),
    [
      "week_1_summary",
      "week_2_summary",
      "week_3_summary",
      "project_context",
      "carry_over_coaching",
      "rushing_risk",
      "adaptive_difficulty_state",
      "prerequisite_requirements",
      "coaching_feedback_surface",
      "current_week_raw_answers",
    ],
  );

  const weeklySummaryJson = JSON.stringify(plan.providerContextPayload.selected_weekly_summaries);
  assert.doesNotMatch(weeklySummaryJson, /Agentic30 Public|macOS menubar app|workspaceRoot|canonicalDocs/);
  assert.doesNotMatch(JSON.stringify(plan.providerContextPayload.context_blocks.slice(0, 3)), /Agentic30 Public/);
});

test("Day 22 provider context payload uses selected summaries plus current-week raw answers", () => {
  const payload = buildCurriculumProviderContextPayload({
    day: 22,
    curriculumDay: {
      day: 22,
      phase: "launch",
      title: "60초 demo를 만든다",
    },
    progressState: {
      weeklySummaryStack: [
        {
          weekNumber: 3,
          status: "finalized",
          dayRange: { start: 15, end: 21 },
          summaryText: "Week 3 launch summary",
          keyInsights: ["Tester observation exposed onboarding friction"],
          unresolvedActions: ["Record the visible result"],
        },
        {
          weekNumber: 1,
          status: "finalized",
          dayRange: { start: 1, end: 7 },
          summaryText: "Week 1 foundation summary",
        },
        {
          weekNumber: 2,
          status: "finalized",
          dayRange: { start: 8, end: 14 },
          summaryText: "Week 2 build summary",
        },
        {
          weekNumber: 4,
          status: "finalized",
          summaryText: "Future summary must not be selected",
        },
      ],
      rawAnswers: [
        { day: 21, questionId: "observe", answer: "Prior week raw answer must be compacted only" },
        {
          day: 22,
          questionId: "demo-hook",
          question: "What should the demo open with?",
          answer: "Open with one visible result.",
          answeredAt: "2026-05-22T09:00:00.000Z",
          dayType: "action",
        },
        { day: 23, questionId: "paid-learning", answer: "One hook, one stop rule." },
        { day: 29, questionId: "pmf", answer: "Future week raw answer must be excluded" },
      ],
    },
    projectContext: { product: "Agentic30", channel: "BIP" },
    generatedAt: new Date("2026-05-22T10:00:00.000Z"),
  });

  assert.equal(payload.schemaVersion, CURRICULUM_PROVIDER_CONTEXT_SCHEMA_VERSION);
  assert.equal(payload.schema, "agentic30.curriculum.provider_context.v1");
  assert.equal(payload.day_id, 22);
  assert.equal(payload.day_type, "launch");
  assert.equal(payload.day_goal, "60초 demo를 만든다");
  assert.equal(payload.curriculum_week, 4);
  assert.deepEqual(payload.current_week_range, { start: 22, end: 28 });
  assert.deepEqual(
    payload.selected_weekly_summaries.map((summary) => [summary.week_number, summary.summary_text]),
    [
      [1, "Week 1 foundation summary"],
      [2, "Week 2 build summary"],
      [3, "Week 3 launch summary"],
    ],
  );
  assert.deepEqual(
    payload.current_week_raw_answers.map((answer) => [answer.day_id, answer.question_id, answer.answer]),
    [
      [22, "demo-hook", "Open with one visible result."],
      [23, "paid-learning", "One hook, one stop rule."],
    ],
  );
  assert.deepEqual(
    payload.context_blocks.map((block) => block.id),
    [
      "week_1_summary",
      "week_2_summary",
      "week_3_summary",
      "project_context",
      "carry_over_coaching",
      "rushing_risk",
      "adaptive_difficulty_state",
      "prerequisite_requirements",
      "coaching_feedback_surface",
      "current_week_raw_answers",
    ],
  );
  assert.equal(payload.context_blocks.find((block) => block.id === "current_week_raw_answers").answers.length, 2);
  assert.doesNotMatch(JSON.stringify(payload), /Future summary|Prior week raw|Future week raw/);
});

test("buildAdaptiveCurriculum attaches provider-ready Day 22 context payload", () => {
  const plan = buildAdaptiveCurriculum({
    selectedDay: 22,
    state: {
      weeklySummaryStack: [
        { weekNumber: 1, status: "finalized", summaryText: "Week 1" },
        { weekNumber: 2, status: "finalized", summaryText: "Week 2" },
        { weekNumber: 3, status: "finalized", summaryText: "Week 3" },
      ],
      currentWeekRawAnswers: [
        { day: 22, questionId: "demo", answer: "Demo answer" },
      ],
    },
    now: new Date("2026-05-22T09:00:00.000Z"),
  });

  assert.equal(plan.providerContextPayload.day_id, 22);
  assert.equal(plan.selectedDay.providerContextPayload.day_id, 22);
  assert.deepEqual(
    plan.selectedDay.providerContextPayload.selected_weekly_summaries.map((summary) => summary.week_number),
    [1, 2, 3],
  );
  assert.deepEqual(
    plan.selectedDay.providerContextPayload.current_week_raw_answers.map((answer) => answer.question_id),
    ["demo"],
  );
});

test("identifyIncompleteDayActionsForTransition extracts current Day pending and insufficient actions", () => {
  const result = identifyIncompleteDayActionsForTransition({
    currentDayState: {
      day: 20,
      dayType: CURRICULUM_DAY_TYPES.action,
      actions: [
        {
          id: "day-20-outreach-tracker",
          actionDescription: "Send 10 personalized DMs and record outcomes.",
          completionSignal: "Google Sheet contains 10 sent rows.",
          verificationState: {
            status: "failed",
            verificationResult: {
              method: "google_sheets",
              passed: false,
              outcome: "failed",
              reason: "Only three sent rows were found.",
            },
          },
          evidenceSubmission: {
            type: "link",
            content: "https://docs.google.com/spreadsheets/d/example",
            validationStatus: "rejected",
          },
        },
        {
          id: "day-20-warm-reply-log",
          action_description: "Capture reply/no-reply status for every sent DM.",
          completion_signal: "Tracker has response_status for each row.",
          status: "pending",
        },
        {
          id: "day-20-message-template",
          actionDescription: "Draft the DM template.",
          completionSignal: "Template is saved.",
          verificationResult: {
            method: "manual",
            passed: true,
            outcome: "verified",
          },
        },
      ],
    },
    now: new Date("2026-05-20T21:00:00.000Z"),
  });

  assert.equal(result.schemaVersion, CURRICULUM_DAY_TRANSITION_ACTION_SCHEMA_VERSION);
  assert.equal(result.schema, "agentic30.curriculum.day_transition_incomplete_actions.v1");
  assert.equal(result.source_day, 20);
  assert.equal(result.target_day, 21);
  assert.equal(result.source_day_type, CURRICULUM_DAY_TYPES.action);
  assert.equal(result.progression_blocked, false);
  assert.equal(result.has_incomplete_actions, true);
  assert.equal(result.incomplete_actions.length, 2);
  assert.deepEqual(
    result.incomplete_actions.map((action) => [action.action_id, action.status, action.reason]),
    [
      ["day-20-outreach-tracker", "insufficient", "action_verification_not_sufficient"],
      ["day-20-warm-reply-log", "pending", "action_verification_pending_at_transition"],
    ],
  );
  assert.equal(result.incomplete_actions[0].verification_result.passed, false);
  assert.equal(result.incomplete_actions[0].evidence_submission.validationStatus, "rejected");
  assert.match(result.incomplete_actions[0].coaching_feedback, /진행은 막지 않습니다/);
  assert.equal(result.carry_over_candidates, result.incomplete_actions);
});

test("identifyIncompleteDayActionsForTransition can read the current Day from progress state", () => {
  const result = identifyIncompleteDayActionsForTransition({
    currentDay: 12,
    progressState: {
      dayRecords: [
        {
          day: 11,
          dayType: CURRICULUM_DAY_TYPES.interview,
          completed: true,
        },
        {
          day: 12,
          dayType: CURRICULUM_DAY_TYPES.action,
          action_spec: {
            id: "day-12-dogfood-e2e",
            action_type: "checklist",
            action_description: "Run one end-to-end dogfood with a real input.",
            completion_signal: "Dogfood log contains input, output, and next action.",
          },
          verification_state: {
            status: "running",
          },
        },
      ],
    },
    now: new Date("2026-05-21T09:00:00.000Z"),
  });

  assert.equal(result.source_day, 12);
  assert.equal(result.target_day, 13);
  assert.equal(result.incomplete_actions.length, 1);
  assert.equal(result.incomplete_actions[0].action_id, "day-12-dogfood-e2e");
  assert.equal(result.incomplete_actions[0].status, "pending");
  assert.equal(result.incomplete_actions[0].reason, "action_verification_pending_at_transition");
  assert.equal(result.incomplete_actions[0].action_spec.action_type, "checklist");
});

test("persistIncompleteDayActionsForNextDay stores carry-over items on the next Day and progress queue", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-carry-over-"));
  const filePath = path.join(dir, "curriculum-progress.json");
  const result = persistIncompleteDayActionsForNextDay({
    progressState: {
      dayRecords: [
        {
          day: 20,
          dayType: CURRICULUM_DAY_TYPES.action,
          blocked: true,
          currentDayBlocked: true,
          current_day_blocked: true,
          progressionBlocked: true,
          progression_blocked: true,
          blockedReason: "failed_action_verification",
          action_spec: {
            id: "day-20-outreach-tracker",
            action_description: "Send 10 personalized DMs and record outcomes.",
            completion_signal: "Google Sheet contains 10 sent rows.",
          },
          verification_state: {
            status: "failed",
            verification_result: {
              method: "google_sheets",
              passed: false,
              outcome: "failed",
              reason: "Only three sent rows were found.",
            },
          },
        },
      ],
    },
    currentDay: 20,
    now: new Date("2026-05-21T09:00:00.000Z"),
  });

  assert.equal(result.did_persist, true);
  assert.equal(result.transition.source_day, 20);
  assert.equal(result.transition.target_day, 21);
  assert.equal(result.current_day_blocked, false);
  assert.equal(result.progression_blocked, false);
  assert.equal(result.persisted_items.length, 1);
  assert.equal(result.state.carry_over_queue.length, 1);
  assert.equal(result.state.current_day_blocked, false);
  assert.equal(result.state.progression_blocked, false);
  assert.equal(result.state.carry_over_queue[0].source_day, 20);
  assert.equal(result.state.carry_over_queue[0].target_day, 21);
  assert.equal(result.state.carry_over_queue[0].action_id, "day-20-outreach-tracker");
  assert.equal(result.state.carry_over_queue[0].times_carried, 1);
  assert.equal(result.state.carry_over_queue[0].carry_over_status, "active");
  assert.equal(result.state.carry_over_queue[0].verification_result.passed, false);
  assert.match(result.state.carry_over_queue[0].coaching_feedback, /진행은 막지 않습니다/);

  const day20 = result.state.day_records.find((record) => record.day === 20);
  assert.equal(day20.blocked, false);
  assert.equal(day20.current_day_blocked, false);
  assert.equal(day20.progression_blocked, false);
  assert.equal(day20.blocked_reason, "");

  const day21 = result.state.day_records.find((record) => record.day === 21);
  assert.equal(day21.day_type, CURRICULUM_DAY_TYPES.review);
  assert.equal(day21.blocked, false);
  assert.equal(day21.current_day_blocked, false);
  assert.equal(day21.progression_blocked, false);
  assert.equal(day21.carry_over_queue.length, 1);
  assert.deepEqual(day21.carry_over_queue[0], result.state.carry_over_queue[0]);

  await persistCurriculumProgressState(filePath, result.state, {
    now: () => new Date("2026-05-21T09:00:01.000Z"),
  });
  const loaded = await loadCurriculumProgressState(filePath);

  assert.equal(loaded.carry_over_queue.length, 1);
  assert.equal(loaded.carry_over_queue[0].action_description, "Send 10 personalized DMs and record outcomes.");
  assert.equal(loaded.day_records.find((record) => record.day === 21).carry_over_queue.length, 1);
});

test("persistIncompleteDayActionsForNextDay is idempotent for the same transition", () => {
  const first = persistIncompleteDayActionsForNextDay({
    progressState: {},
    currentDayState: {
      day: 12,
      dayType: CURRICULUM_DAY_TYPES.action,
      action_spec: {
        id: "day-12-dogfood-e2e",
        action_description: "Run one end-to-end dogfood with a real input.",
        completion_signal: "Dogfood log contains input, output, and next action.",
      },
      verification_state: { status: "running" },
    },
    now: new Date("2026-05-21T09:00:00.000Z"),
  });
  const second = persistIncompleteDayActionsForNextDay({
    progressState: first.state,
    currentDayState: {
      day: 12,
      dayType: CURRICULUM_DAY_TYPES.action,
      action_spec: {
        id: "day-12-dogfood-e2e",
        action_description: "Run one end-to-end dogfood with a real input.",
        completion_signal: "Dogfood log contains input, output, and next action.",
      },
      verification_state: { status: "running" },
    },
    now: new Date("2026-05-21T09:05:00.000Z"),
  });

  assert.equal(first.state.carry_over_queue.length, 1);
  assert.equal(second.state.carry_over_queue.length, 1);
  assert.equal(second.state.carry_over_queue[0].times_carried, 1);
  assert.equal(second.state.day_records.find((record) => record.day === 13).carry_over_queue.length, 1);
});

test("identifyPriorIncompleteActionsEligibleForCarryOver returns incomplete prior Action Day items", () => {
  const result = identifyPriorIncompleteActionsEligibleForCarryOver({
    currentDay: 21,
    progressState: {
      dayRecords: [
        {
          day: 20,
          dayType: CURRICULUM_DAY_TYPES.action,
          action_spec: {
            id: "day-20-outreach-tracker",
            action_description: "Send 10 personalized DMs and record outcomes.",
            completion_signal: "Google Sheet contains 10 sent rows.",
            verification_method: "google_sheets",
          },
          verification_state: {
            status: "failed",
            verification_result: {
              method: "google_sheets",
              passed: false,
              reason: "Only three sent rows were found.",
            },
          },
        },
      ],
    },
    now: new Date("2026-05-21T09:00:00.000Z"),
  });

  assert.equal(result.schema, "agentic30.curriculum.prior_incomplete_actions_carry_over.v1");
  assert.equal(result.current_day, 21);
  assert.equal(result.progression_blocked, false);
  assert.equal(result.has_eligible_actions, true);
  assert.equal(result.eligible_actions.length, 1);
  assert.equal(result.eligible_actions[0].source_day, 20);
  assert.equal(result.eligible_actions[0].target_day, 21);
  assert.equal(result.eligible_actions[0].action_id, "day-20-outreach-tracker");
  assert.equal(result.eligible_actions[0].status, "insufficient");
  assert.equal(result.eligible_actions[0].carry_over_status, "active");
  assert.equal(result.eligible_actions[0].verification_result.passed, false);
  assert.match(result.eligible_actions[0].coaching_feedback, /진행은 막지 않습니다/);
});

test("identifyPriorIncompleteActionsEligibleForCarryOver excludes completed prior Action Day items", () => {
  const result = identifyPriorIncompleteActionsEligibleForCarryOver({
    currentDay: 21,
    progressState: {
      dayRecords: [
        {
          day: 20,
          dayType: CURRICULUM_DAY_TYPES.action,
          actions: [
            {
              id: "day-20-outreach-tracker",
              action_description: "Send 10 personalized DMs and record outcomes.",
              completion_signal: "Google Sheet contains 10 sent rows.",
              completed: true,
            },
          ],
        },
      ],
    },
    now: new Date("2026-05-21T09:00:00.000Z"),
  });

  assert.equal(result.has_eligible_actions, false);
  assert.deepEqual(result.eligible_actions, []);
});

test("identifyPriorIncompleteActionsEligibleForCarryOver excludes non-action prior Day items", () => {
  const result = identifyPriorIncompleteActionsEligibleForCarryOver({
    currentDay: 21,
    progressState: {
      dayRecords: [
        {
          day: 18,
          dayType: CURRICULUM_DAY_TYPES.interview,
          action_spec: {
            id: "day-18-interview-note",
            action_description: "Write a launch story note.",
            completion_signal: "Note exists.",
          },
          verification_state: {
            status: "failed",
            verification_result: { passed: false },
          },
        },
        {
          day: 21,
          dayType: CURRICULUM_DAY_TYPES.review,
          action_spec: {
            id: "current-review-action",
            action_description: "Review dashboard action.",
            completion_signal: "Dashboard action noted.",
          },
          status: "pending",
        },
      ],
    },
    now: new Date("2026-05-21T09:00:00.000Z"),
  });

  assert.equal(result.has_eligible_actions, false);
  assert.deepEqual(result.eligible_actions, []);
});

test("identifyCarriedOverIncompleteActionsForCoaching detects active carry-over without blocking progression", () => {
  const result = identifyCarriedOverIncompleteActionsForCoaching({
    currentDay: 21,
    progressState: {
      carry_over_queue: [
        {
          source_day: 20,
          target_day: 21,
          action_id: "day-20-outreach-tracker",
          action_description: "Send 10 personalized DMs and record outcomes.",
          completion_signal: "Google Sheet contains 10 sent rows.",
          status: "insufficient",
          carry_over_status: "active",
          times_carried: 1,
          verification_result: {
            method: "google_sheets",
            passed: false,
            reason: "Only three sent rows were found.",
          },
          evidence_submission: {
            type: "link",
            content: "https://docs.google.com/spreadsheets/d/example",
            validation_status: "rejected",
          },
        },
      ],
    },
    now: new Date("2026-05-21T09:30:00.000Z"),
  });

  assert.equal(result.schemaVersion, CURRICULUM_CARRY_OVER_COACHING_SCHEMA_VERSION);
  assert.equal(result.schema, "agentic30.curriculum.carry_over_coaching.v1");
  assert.equal(result.current_day, 21);
  assert.equal(result.progression_blocked, false);
  assert.equal(result.coaching_mode, "non_blocking_carry_over");
  assert.equal(result.has_eligible_actions, true);
  assert.equal(result.has_feedback_content, true);
  assert.equal(result.eligible_actions.length, 1);
  assert.equal(result.feedback_items.length, 1);
  assert.equal(result.eligible_actions[0].action_id, "day-20-outreach-tracker");
  assert.equal(result.eligible_actions[0].eligible_for_coaching, true);
  assert.equal(result.eligible_actions[0].coaching_mode, "non_blocking_carry_over");
  assert.equal(result.eligible_actions[0].verification_result.passed, false);
  assert.match(result.eligible_actions[0].coaching_feedback, /진행은 막지 않습니다|진행을 막지 않고/);
  assert.equal(result.feedback_items[0].action_id, "day-20-outreach-tracker");
  assert.equal(result.feedback_items[0].progression_blocked, false);
  assert.equal(result.feedback_items[0].blocking, false);
  assert.equal(result.feedback_items[0].coaching_mode, "non_blocking_carry_over");
  assert.equal(result.feedback_items[0].tone, "friendly_senior");
  assert.match(result.feedback_items[0].assistant_message, /진행은 막지 않고/);
  assert.match(result.feedback_items[0].assistant_message, /증거 1개/);
  assert.match(result.feedback_items[0].cta_text, /해보세요/);
});

test("buildPrerequisiteRequirementsFromCarryOver converts carry-over actions into subsequent Day requirements", () => {
  const result = buildPrerequisiteRequirementsFromCarryOver({
    currentDay: 21,
    generatedAt: new Date("2026-05-21T09:45:00.000Z"),
    carryOverItems: [
      {
        source_day: 20,
        target_day: 21,
        action_id: "day-20-outreach-tracker",
        action_description: "Send 10 personalized DMs and record outcomes.",
        completion_signal: "Google Sheet contains 10 sent rows.",
        status: "insufficient",
        carry_over_status: "active",
        times_carried: 1,
        action_spec: {
          verification_method: "google_sheets",
          evidence_type: "link",
        },
        verification_result: {
          method: "google_sheets",
          passed: false,
          reason: "Only three sent rows were found.",
        },
        evidence_submission: {
          type: "link",
          content: "https://docs.google.com/spreadsheets/d/example",
          validation_status: "rejected",
        },
      },
    ],
  });

  assert.equal(result.schemaVersion, CURRICULUM_PREREQUISITE_REQUIREMENT_SCHEMA_VERSION);
  assert.equal(result.schema, "agentic30.curriculum.prerequisite_requirements.v1");
  assert.equal(result.current_day, 21);
  assert.equal(result.requirement_mode, "non_blocking_prerequisite");
  assert.equal(result.progression_blocked, false);
  assert.equal(result.has_requirements, true);
  assert.equal(result.requirements.length, 1);
  assert.equal(result.prerequisite_requirements, result.requirements);

  const requirement = result.requirements[0];
  assert.equal(requirement.schema, "agentic30.curriculum.prerequisite_requirement.v1");
  assert.equal(requirement.requirement_type, "carry_over_incomplete_action");
  assert.equal(requirement.requirement_mode, "non_blocking_prerequisite");
  assert.equal(requirement.source_day, 20);
  assert.equal(requirement.target_day, 21);
  assert.equal(requirement.current_day, 21);
  assert.equal(requirement.source_action_id, "day-20-outreach-tracker");
  assert.equal(requirement.action_id, "day-20-outreach-tracker");
  assert.match(requirement.requirement_id, /day-21-requires-day-20-day-20-outreach-tracker/);
  assert.equal(requirement.action_description, "Send 10 personalized DMs and record outcomes.");
  assert.equal(requirement.completion_signal, "Google Sheet contains 10 sent rows.");
  assert.equal(requirement.verification_method, "google_sheets");
  assert.equal(requirement.evidence_type, "link");
  assert.equal(requirement.required_before, "day_quality_completion");
  assert.equal(requirement.required_for_quality_gate, true);
  assert.equal(requirement.progression_blocked, false);
  assert.equal(requirement.can_advance_day, true);
  assert.equal(requirement.times_carried, 1);
  assert.equal(requirement.verification_result.passed, false);
  assert.equal(requirement.evidence_submission.validation_status, "rejected");
  assert.match(requirement.requirement_text, /Google Sheet contains 10 sent rows/);
});

test("detectTooFastProgression combines timing, skipped steps, and minimum engagement thresholds", () => {
  const result = detectTooFastProgression({
    currentDay: 4,
    now: new Date("2026-05-04T10:00:00.000Z"),
    progressState: {
      dayRecords: [
        {
          day: 1,
          dayType: CURRICULUM_DAY_TYPES.interview,
          startedAt: "2026-05-04T09:00:00.000Z",
          completedAt: "2026-05-04T09:03:00.000Z",
          completionConfirmed: true,
          lifecycleEvents: [
            {
              type: "day_step_skipped",
              occurredAt: "2026-05-04T09:01:00.000Z",
            },
          ],
          questionProgress: [
            { questionId: "day-1-q1", answer: "ok", status: "answered" },
          ],
        },
        {
          day: 2,
          dayType: CURRICULUM_DAY_TYPES.action,
          startedAt: "2026-05-04T09:04:00.000Z",
          completedAt: "2026-05-04T09:08:00.000Z",
          completionConfirmed: true,
          questionProgress: [
            { questionId: "day-2-q1", answer: "", status: "skipped" },
          ],
        },
        {
          day: 3,
          dayType: CURRICULUM_DAY_TYPES.interview,
          startedAt: "2026-05-04T09:09:00.000Z",
          completedAt: "2026-05-04T09:16:00.000Z",
          completionConfirmed: true,
          questionProgress: [
            { questionId: "day-3-q1", answer: "thin", status: "answered" },
          ],
        },
      ],
    },
  });

  assert.equal(result.schemaVersion, CURRICULUM_TOO_FAST_PROGRESSION_SCHEMA_VERSION);
  assert.equal(result.schema, "agentic30.curriculum.too_fast_progression_detection.v1");
  assert.equal(result.detected, true);
  assert.equal(result.progression_blocked, false);
  assert.equal(result.completion_timing.completed_day_count, 3);
  assert.equal(result.completion_timing.average_minutes_per_completed_day, 5.33);
  assert.equal(result.completion_timing.timing_too_fast, true);
  assert.equal(result.skipped_steps.skipped_step_count, 2);
  assert.equal(result.minimum_engagement.minimum_engagement_met, false);
  assert.deepEqual(result.risk_factors, [
    "completion_timing_too_fast",
    "skipped_curriculum_steps",
    "below_minimum_engagement_threshold",
  ]);
  assert.equal(result.adaptive_difficulty_state.direction, "up");
  assert.equal(result.adaptive_difficulty_state.trigger, "rushing");
  assert.deepEqual(result.adaptive_difficulty_state.adjustments_applied, [
    "increase_prerequisite_evidence_required",
    "ask_for_one_verified_prior_action_before_quality_completion",
  ]);
});

test("detectTooFastProgression stays off when pacing and engagement clear thresholds", () => {
  const result = detectTooFastProgression({
    currentDay: 4,
    progressState: {
      dayRecords: [
        {
          day: 1,
          startedAt: "2026-05-01T09:00:00.000Z",
          completedAt: "2026-05-01T09:30:00.000Z",
          completionConfirmed: true,
          questionProgress: [
            { questionId: "day-1-q1", answer: "Customer support teams lose time copying call notes into CRM.", status: "answered" },
          ],
        },
        {
          day: 2,
          startedAt: "2026-05-02T09:00:00.000Z",
          completedAt: "2026-05-02T09:28:00.000Z",
          completionConfirmed: true,
          questionProgress: [
            { questionId: "day-2-q1", answer: "I found five paid tools and logged pricing and review proof.", status: "answered" },
          ],
        },
      ],
    },
  });

  assert.equal(result.detected, false);
  assert.equal(result.completion_timing.timing_too_fast, false);
  assert.equal(result.skipped_steps.has_skipped_steps, false);
  assert.equal(result.minimum_engagement.minimum_engagement_met, true);
  assert.equal(result.adaptive_difficulty_state.direction, "none");
  assert.equal(result.adaptive_difficulty_state.trigger, "none");
});

test("detectLowQualityProgression detects failed verification, shallow answers, and missing artifacts", () => {
  const result = detectLowQualityProgression({
    currentDay: 4,
    now: new Date("2026-05-04T10:00:00.000Z"),
    progressState: {
      dayRecords: [
        {
          day: 1,
          dayType: CURRICULUM_DAY_TYPES.interview,
          completedAt: "2026-05-01T09:30:00.000Z",
          completionConfirmed: true,
          questionProgress: [
            { questionId: "day-1-q1", answer: "ok", status: "answered" },
            { questionId: "day-1-q2", answer: "", status: "skipped" },
          ],
        },
        {
          day: 2,
          dayType: CURRICULUM_DAY_TYPES.action,
          completedAt: "2026-05-02T09:30:00.000Z",
          completionConfirmed: true,
          action_spec: {
            id: "day-2-evidence-log",
            action_description: "Record five paid alternatives.",
            completion_signal: "day-2-evidence-log.md includes five priced competitors.",
            verification_method: "google_docs",
          },
          verification_state: {
            status: "failed",
            verification_result: {
              method: "google_docs",
              passed: false,
              confidence: 0.31,
              reason: "Only one competitor row was found.",
            },
          },
        },
        {
          day: 3,
          dayType: CURRICULUM_DAY_TYPES.action,
          completedAt: "2026-05-03T09:30:00.000Z",
          completionConfirmed: true,
          action_spec: {
            id: "day-3-interview-script",
            action_description: "Write five Mom Test questions.",
            completion_signal: "day-3-interview-script.md exists with five past-behavior questions.",
          },
        },
      ],
    },
  });

  assert.equal(result.schemaVersion, CURRICULUM_LOW_QUALITY_PROGRESSION_SCHEMA_VERSION);
  assert.equal(result.schema, "agentic30.curriculum.low_quality_progression_detection.v1");
  assert.equal(result.detected, true);
  assert.equal(result.progression_blocked, false);
  assert.equal(result.verification_quality.weak_verification_signal_count, 1);
  assert.equal(result.verification_quality.weak_signals[0].action_id, "day-2-evidence-log");
  assert.equal(result.response_quality.shallow_response_count, 2);
  assert.equal(result.required_artifacts.missing_required_artifact_count, 2);
  assert.deepEqual(result.risk_factors, [
    "failed_or_weak_verification_signal",
    "shallow_response_detail",
    "missing_required_artifact",
  ]);
  assert.equal(result.adaptive_difficulty_state.direction, "down");
  assert.equal(result.adaptive_difficulty_state.trigger, "low_quality_progression");
  assert.deepEqual(result.adaptive_difficulty_state.adjustments_applied, [
    "reduce_next_action_scope",
    "prefer_mini_action_with_template",
    "carry_missing_artifacts_forward_non_blockingly",
  ]);
});

test("detectLowQualityProgression stays off when evidence and answer quality are sufficient", () => {
  const result = detectLowQualityProgression({
    currentDay: 3,
    progressState: {
      dayRecords: [
        {
          day: 1,
          completionConfirmed: true,
          questionProgress: [
            {
              questionId: "day-1-q1",
              answer: "Customer support leads spend two hours weekly copying call notes into CRM fields.",
              status: "answered",
            },
          ],
        },
        {
          day: 2,
          dayType: CURRICULUM_DAY_TYPES.action,
          completionConfirmed: true,
          action_spec: {
            id: "day-2-evidence-log",
            completion_signal: "day-2-evidence-log.md includes five priced competitors.",
          },
          verification_result: {
            method: "google_docs",
            passed: true,
            confidence: 0.91,
          },
          evidence_submission: {
            type: "link",
            content: "https://docs.google.com/document/d/example",
            validation_status: "accepted",
          },
        },
      ],
    },
  });

  assert.equal(result.detected, false);
  assert.equal(result.verification_quality.has_weak_verification_signals, false);
  assert.equal(result.response_quality.has_shallow_responses, false);
  assert.equal(result.required_artifacts.has_missing_required_artifacts, false);
  assert.equal(result.adaptive_difficulty_state.direction, "none");
  assert.equal(result.adaptive_difficulty_state.trigger, "none");
});

test("classifyRushingRisk combines normalized too-fast and low-quality signals with reasons", () => {
  const tooFastProgression = detectTooFastProgression({
    currentDay: 4,
    now: new Date("2026-05-04T10:00:00.000Z"),
    progressState: {
      dayRecords: [
        {
          day: 1,
          startedAt: "2026-05-04T09:00:00.000Z",
          completedAt: "2026-05-04T09:02:00.000Z",
          completionConfirmed: true,
          lifecycleEvents: [
            {
              type: "day_step_skipped",
              occurredAt: "2026-05-04T09:01:00.000Z",
            },
          ],
          questionProgress: [
            { questionId: "day-1-q1", answer: "ok", status: "answered" },
          ],
        },
        {
          day: 2,
          startedAt: "2026-05-04T09:03:00.000Z",
          completedAt: "2026-05-04T09:06:00.000Z",
          completionConfirmed: true,
          questionProgress: [
            { questionId: "day-2-q1", answer: "", status: "skipped" },
          ],
        },
      ],
    },
  });
  const lowQualityProgression = detectLowQualityProgression({
    currentDay: 4,
    progressState: {
      dayRecords: [
        {
          day: 2,
          dayType: CURRICULUM_DAY_TYPES.action,
          completionConfirmed: true,
          action_spec: {
            id: "day-2-proof",
            completion_signal: "Evidence link shows the public proof.",
          },
          verification_result: {
            passed: false,
            method: "browser",
            reason: "URL did not show a public post.",
          },
          questionProgress: [
            { questionId: "day-2-q1", answer: "ok", status: "answered" },
          ],
        },
      ],
    },
  });

  const result = classifyRushingRisk({
    tooFastProgression,
    lowQualityProgression,
    currentDay: 4,
    now: new Date("2026-05-04T10:01:00.000Z"),
  });

  assert.equal(result.schemaVersion, CURRICULUM_RUSHING_RISK_SCHEMA_VERSION);
  assert.equal(result.schema, "agentic30.curriculum.rushing_risk.v1");
  assert.equal(result.current_day, 4);
  assert.equal(result.rushing_risk_detected, true);
  assert.equal(result.risk_level, "high");
  assert.equal(result.risk_score, 1);
  assert.deepEqual(result.component_scores, {
    too_fast: 1,
    low_quality: 1,
  });
  assert.deepEqual(result.reason_codes, [
    "completion_timing_too_fast",
    "skipped_curriculum_steps",
    "below_minimum_engagement_threshold",
    "failed_or_weak_verification_signal",
    "shallow_response_detail",
    "missing_required_artifact",
  ]);
  assert.equal(result.reasons[0].signal, "too_fast");
  assert.equal(result.reasons.at(-1).signal, "low_quality");
  assert.equal(result.adaptive_difficulty_state.direction, "up");
  assert.equal(result.adaptive_difficulty_state.trigger, "rushing");
  assert.equal(result.progression_blocked, false);
});

test("classifyRushingRisk does not treat low quality alone as rushing", () => {
  const result = classifyRushingRisk({
    currentDay: 4,
    tooFastProgression: {
      detected: false,
      completion_timing: { timing_too_fast: false },
      skipped_steps: { has_skipped_steps: false },
      minimum_engagement: { minimum_engagement_met: true },
    },
    lowQualityProgression: {
      detected: true,
      verification_quality: { has_weak_verification_signals: true },
      response_quality: { has_shallow_responses: true },
      required_artifacts: { has_missing_required_artifacts: true },
    },
  });

  assert.equal(result.rushing_risk_detected, false);
  assert.equal(result.risk_level, "low");
  assert.equal(result.component_scores.too_fast, 0);
  assert.equal(result.component_scores.low_quality, 1);
  assert.equal(result.adaptive_difficulty_state.direction, "none");
  assert.equal(result.adaptive_difficulty_state.trigger, "none");
});

test("buildPrerequisiteRequirementsFromTooFastProgression raises non-blocking quality requirements", () => {
  const detection = detectTooFastProgression({
    currentDay: 4,
    progressState: {
      dayRecords: [
        {
          day: 1,
          startedAt: "2026-05-04T09:00:00.000Z",
          completedAt: "2026-05-04T09:02:00.000Z",
          completionConfirmed: true,
          lifecycleEvents: [
            {
              type: "day_step_skipped",
              occurredAt: "2026-05-04T09:01:00.000Z",
            },
          ],
        },
        {
          day: 2,
          startedAt: "2026-05-04T09:03:00.000Z",
          completedAt: "2026-05-04T09:05:00.000Z",
          completionConfirmed: true,
          questionProgress: [
            { questionId: "day-2-q1", answer: "ok", status: "answered" },
          ],
        },
      ],
    },
  });
  const result = buildPrerequisiteRequirementsFromTooFastProgression({
    tooFastProgression: detection,
    currentDay: 4,
    generatedAt: new Date("2026-05-04T10:00:00.000Z"),
  });

  assert.equal(result.schema, "agentic30.curriculum.prerequisite_requirements.v1");
  assert.equal(result.has_requirements, true);
  assert.equal(result.progression_blocked, false);
  assert.equal(result.requirements.length, 1);
  assert.equal(result.requirements[0].requirement_type, "rushing_minimum_engagement");
  assert.equal(result.requirements[0].source_day, 2);
  assert.equal(result.requirements[0].target_day, 4);
  assert.equal(result.requirements[0].progression_blocked, false);
  assert.equal(result.requirements[0].can_advance_day, true);
  assert.match(result.requirements[0].completion_signal, /accepted evidence|expanded/);
});

test("buildPrerequisiteRequirementsFromTooFastProgression uses prior Action Day details when rushing is detected", () => {
  const result = buildPrerequisiteRequirementsFromTooFastProgression({
    currentDay: 5,
    generatedAt: new Date("2026-05-05T10:00:00.000Z"),
    tooFastProgression: {
      schema: "agentic30.curriculum.rushing_risk.v1",
      current_day: 5,
      detected: true,
      rushing_risk_detected: true,
      adaptive_difficulty_state: {
        direction: "up",
        trigger: "rushing",
      },
      low_quality_progression: {
        verification_quality: {
          weak_signals: [
            {
              day: 2,
              action_id: "day-2-customer-outreach",
              method: "google_sheets",
              status: "failed_or_insufficient",
            },
          ],
        },
      },
    },
    progressState: {
      dayRecords: [
        {
          day: 2,
          dayType: CURRICULUM_DAY_TYPES.action,
          completionConfirmed: true,
          action_spec: {
            id: "day-2-customer-outreach",
            action_description: "Send three customer outreach messages and record replies.",
            completion_signal: "Google Sheet has three sent rows with reply status.",
            verification_method: "google_sheets",
            evidence_type: "link",
          },
          verification_result: {
            method: "google_sheets",
            passed: false,
            reason: "Only one outreach row was found.",
          },
        },
      ],
    },
  });

  const requirement = result.requirements[0];

  assert.equal(result.has_requirements, true);
  assert.equal(requirement.requirement_type, "rushing_minimum_engagement");
  assert.equal(requirement.source_day, 2);
  assert.equal(requirement.source_action_id, "day-2-customer-outreach");
  assert.equal(requirement.action_description, "Send three customer outreach messages and record replies.");
  assert.equal(requirement.completion_signal, "Google Sheet has three sent rows with reply status.");
  assert.equal(requirement.verification_method, "google_sheets");
  assert.equal(requirement.evidence_type, "link");
  assert.equal(requirement.prerequisite_action_generated, true);
  assert.equal(requirement.progression_blocked, false);
  assert.equal(requirement.can_advance_day, true);
});

test("buildAdaptiveCurriculum merges too-fast progression into selected Day prerequisites and provider context", () => {
  const plan = buildAdaptiveCurriculum({
    selectedDay: 4,
    now: new Date("2026-05-04T10:00:00.000Z"),
    state: {
      dayRecords: [
        {
          day: 1,
          startedAt: "2026-05-04T09:00:00.000Z",
          completedAt: "2026-05-04T09:03:00.000Z",
          completionConfirmed: true,
          lifecycleEvents: [
            {
              type: "day_step_skipped",
              occurredAt: "2026-05-04T09:01:00.000Z",
            },
          ],
          questionProgress: [
            { questionId: "day-1-q1", answer: "ok", status: "answered" },
          ],
        },
        {
          day: 2,
          startedAt: "2026-05-04T09:04:00.000Z",
          completedAt: "2026-05-04T09:07:00.000Z",
          completionConfirmed: true,
          questionProgress: [
            { questionId: "day-2-q1", answer: "go", status: "answered" },
          ],
        },
      ],
    },
  });

  const adaptiveBlock = plan.providerContextPayload.context_blocks.find((block) => block.id === "adaptive_difficulty_state");
  const requirement = plan.selectedDay.prerequisite_requirements.requirements[0];

  assert.equal(plan.curriculumContext.too_fast_progression.detected, true);
  assert.equal(plan.curriculumContext.adaptive_difficulty_state.trigger, "rushing");
  assert.equal(adaptiveBlock.type, "adaptive_difficulty_state");
  assert.equal(adaptiveBlock.content.direction, "up");
  assert.equal(plan.selectedDay.prerequisite_requirements.has_requirements, true);
  assert.equal(requirement.requirement_type, "rushing_minimum_engagement");
  assert.equal(requirement.progression_blocked, false);
  assert.equal(requirement.can_advance_day, true);
  assert.equal(plan.providerContextPayload.prerequisite_requirements.requirements[0].requirement_type, "rushing_minimum_engagement");
});

test("buildAdaptiveCurriculum attaches rushing prerequisite action requirements to selected Day and provider context", () => {
  const plan = buildAdaptiveCurriculum({
    selectedDay: 4,
    now: new Date("2026-05-04T10:00:00.000Z"),
    state: {
      dayRecords: [
        {
          day: 1,
          startedAt: "2026-05-04T09:00:00.000Z",
          completedAt: "2026-05-04T09:02:00.000Z",
          completionConfirmed: true,
          lifecycleEvents: [
            {
              type: "day_step_skipped",
              occurredAt: "2026-05-04T09:01:00.000Z",
            },
          ],
          questionProgress: [
            { questionId: "day-1-q1", answer: "ok", status: "answered" },
          ],
        },
        {
          day: 2,
          dayType: CURRICULUM_DAY_TYPES.action,
          startedAt: "2026-05-04T09:03:00.000Z",
          completedAt: "2026-05-04T09:05:00.000Z",
          completionConfirmed: true,
          action_spec: {
            id: "day-2-public-proof",
            action_description: "Publish one public proof post.",
            completion_signal: "Browser verification finds the public post URL.",
            verification_method: "browser",
            evidence_type: "link",
          },
          verification_result: {
            method: "browser",
            passed: false,
            reason: "No public URL evidence was attached.",
          },
          questionProgress: [
            { questionId: "day-2-q1", answer: "go", status: "answered" },
          ],
        },
      ],
    },
  });

  const requirement = plan.selectedDay.prerequisite_requirements.requirements[0];
  const providerRequirement = plan.providerContextPayload.prerequisite_requirements.requirements[0];

  assert.equal(plan.curriculumContext.rushing_risk.rushing_risk_detected, true);
  assert.equal(plan.curriculumContext.adaptive_difficulty_state.trigger, "rushing");
  assert.equal(requirement.source_action_id, "day-2-public-proof");
  assert.equal(requirement.action_description, "Publish one public proof post.");
  assert.equal(requirement.completion_signal, "Browser verification finds the public post URL.");
  assert.equal(requirement.verification_method, "browser");
  assert.equal(requirement.progression_blocked, false);
  assert.equal(requirement.can_advance_day, true);
  assert.equal(providerRequirement.source_action_id, "day-2-public-proof");
  assert.equal(providerRequirement.prerequisite_action_generated, true);
});

test("buildAdaptiveCurriculum exposes low-quality progression as downshifted adaptive context", () => {
  const plan = buildAdaptiveCurriculum({
    selectedDay: 4,
    now: new Date("2026-05-04T10:00:00.000Z"),
    state: {
      dayRecords: [
        {
          day: 1,
          startedAt: "2026-05-01T09:00:00.000Z",
          completedAt: "2026-05-01T09:35:00.000Z",
          completionConfirmed: true,
          questionProgress: [
            { questionId: "day-1-q1", answer: "ok", status: "answered" },
          ],
        },
        {
          day: 2,
          dayType: CURRICULUM_DAY_TYPES.action,
          startedAt: "2026-05-02T09:00:00.000Z",
          completedAt: "2026-05-02T09:35:00.000Z",
          completionConfirmed: true,
          action_spec: {
            id: "day-2-evidence-log",
            action_description: "Record five paid alternatives.",
            completion_signal: "day-2-evidence-log.md includes five priced competitors.",
          },
          verification_result: {
            method: "google_docs",
            passed: true,
            confidence: 0.42,
          },
        },
      ],
    },
  });

  const adaptiveBlock = plan.providerContextPayload.context_blocks.find((block) => block.id === "adaptive_difficulty_state");

  assert.equal(plan.curriculumContext.too_fast_progression.detected, false);
  assert.equal(plan.curriculumContext.low_quality_progression.detected, true);
  assert.equal(plan.curriculumContext.adaptive_difficulty_state.direction, "down");
  assert.equal(plan.curriculumContext.adaptive_difficulty_state.trigger, "low_quality_progression");
  assert.equal(adaptiveBlock.content.trigger, "low_quality_progression");
  assert.equal(plan.providerContextPayload.low_quality_progression.detected, true);
  assert.equal(plan.providerContextPayload.adaptive_difficulty_state.direction, "down");
  assert.equal(plan.selectedDay.prerequisite_requirements.progression_blocked, false);
});

test("mergeCarriedOverPrerequisiteRequirementsIntoCurriculumDay keeps authored prerequisites first and dedupes carry-over", () => {
  const result = mergeCarriedOverPrerequisiteRequirementsIntoCurriculumDay({
    generatedAt: new Date("2026-05-21T09:50:00.000Z"),
    curriculumDay: {
      day: 21,
      dayType: CURRICULUM_DAY_TYPES.review,
      title: "첫 설치/사용 관찰을 한다",
      dependencyRefs: ["day-19-public-proof"],
      prerequisiteRequirements: {
        requirements: [
          {
            requirement_id: "authored-public-proof",
            source_day: 19,
            source_action_id: "day-19-public-proof",
            target_day: 21,
            action_description: "Attach the public proof post before reviewing observation quality.",
          },
          {
            requirement_id: "authored-outreach-tracker",
            source_day: 20,
            source_action_id: "day-20-outreach-tracker",
            target_day: 21,
            action_description: "Use the outreach tracker before writing Review Day conclusions.",
          },
        ],
      },
    },
    prerequisiteRequirements: {
      current_day: 21,
      requirements: [
        {
          requirement_id: "carried-duplicate-outreach-tracker",
          source_day: 20,
          source_action_id: "day-20-outreach-tracker",
          action_id: "day-20-outreach-tracker",
          target_day: 21,
          action_description: "Send 10 personalized DMs and record outcomes.",
        },
        {
          requirement_id: "carried-launch-story",
          source_day: 18,
          source_action_id: "day-18-launch-story",
          action_id: "day-18-launch-story",
          target_day: 21,
          action_description: "Publish a launch story using three customer quotes.",
        },
      ],
    },
  });

  assert.equal(result.prerequisite_requirements.schema, "agentic30.curriculum.prerequisite_requirements.v1");
  assert.equal(result.prerequisite_requirements.current_day, 21);
  assert.equal(result.prerequisite_requirements.has_requirements, true);
  assert.deepEqual(
    result.prerequisite_requirements.requirements.map((requirement) => requirement.requirement_id),
    [
      "authored-public-proof",
      "authored-outreach-tracker",
      "carried-launch-story",
    ],
  );
  assert.deepEqual(
    result.prerequisite_requirements.requirements.map((requirement) => requirement.source_action_id),
    [
      "day-19-public-proof",
      "day-20-outreach-tracker",
      "day-18-launch-story",
    ],
  );
  assert.equal(result.prerequisite_requirements.requirements[1].action_description, "Use the outreach tracker before writing Review Day conclusions.");
  assert.equal(result.prerequisites, result.prerequisite_requirements.requirements);
  assert.deepEqual(result.dependency_refs, [
    "day-19-public-proof",
    "day-20-outreach-tracker",
    "day-18-launch-story",
  ]);
});

test("buildAdaptiveCurriculum merges carried-over requirements into the selected Day without duplicating existing prerequisites", () => {
  const plan = buildAdaptiveCurriculum({
    selectedDay: {
      day: 21,
      dayType: CURRICULUM_DAY_TYPES.review,
      title: "Observe",
      prerequisiteRequirements: {
        requirements: [
          {
            requirement_id: "authored-outreach-tracker",
            source_day: 20,
            source_action_id: "day-20-outreach-tracker",
            target_day: 21,
            action_description: "Use the outreach tracker before drawing Review Day conclusions.",
          },
        ],
      },
    },
    state: {
      carryOverQueue: [
        {
          sourceDay: 18,
          targetDay: 21,
          actionId: "day-18-launch-story",
          actionDescription: "Publish a launch story using three customer quotes.",
          completionSignal: "Public post URL is attached.",
          status: "pending",
          carryOverStatus: "active",
        },
        {
          sourceDay: 20,
          targetDay: 21,
          actionId: "day-20-outreach-tracker",
          actionDescription: "Send 10 personalized DMs and record outcomes.",
          completionSignal: "Google Sheet contains 10 sent rows.",
          status: "insufficient",
          carryOverStatus: "active",
        },
      ],
    },
    now: new Date("2026-05-21T10:00:00.000Z"),
  });

  const requirements = plan.selectedDay.prerequisite_requirements.requirements;

  assert.equal(plan.selectedDay.day, 21);
  assert.equal(plan.selectedDay.prerequisite_requirements.has_requirements, true);
  assert.deepEqual(
    requirements.map((requirement) => requirement.source_action_id),
    [
      "day-20-outreach-tracker",
      "day-18-launch-story",
    ],
  );
  assert.equal(requirements[0].requirement_id, "authored-outreach-tracker");
  assert.equal(requirements[0].action_description, "Use the outreach tracker before drawing Review Day conclusions.");
  assert.equal(requirements[1].requirement_type, "carry_over_incomplete_action");
  assert.equal(requirements[1].progression_blocked, false);
  assert.equal(requirements[1].can_advance_day, true);
  assert.deepEqual(plan.selectedDay.dependency_refs, [
    "day-20-outreach-tracker",
    "day-18-launch-story",
  ]);
  assert.equal(plan.providerContextPayload.prerequisite_requirements.requirements.length, 2);
});

test("buildCarryOverCoachingFeedbackContent generates downshifted non-blocking feedback for repeated carry-over", () => {
  const feedback = buildCarryOverCoachingFeedbackContent({
    source_day: 18,
    target_day: 21,
    action_id: "day-18-launch-story",
    action_description: "Publish a launch story using three customer quotes.",
    completion_signal: "Public post URL is attached.",
    status: "failed",
    carry_over_status: "active",
    times_carried: 3,
    verification_result: {
      method: "browser",
      passed: false,
      reason: "The URL did not contain a public post.",
    },
  }, {
    currentDay: 21,
    generatedAt: new Date("2026-05-21T10:15:00.000Z"),
  });

  assert.equal(feedback.schema, "agentic30.curriculum.carry_over_feedback_content.v1");
  assert.equal(feedback.source_day, 18);
  assert.equal(feedback.target_day, 21);
  assert.equal(feedback.current_day, 21);
  assert.equal(feedback.generated_at, "2026-05-21T10:15:00.000Z");
  assert.equal(feedback.progression_blocked, false);
  assert.equal(feedback.blocking, false);
  assert.equal(feedback.eligible_for_coaching, true);
  assert.equal(feedback.times_carried, 3);
  assert.equal(feedback.cta_text, "5분 증거 만들기");
  assert.match(feedback.title, /Day 18/);
  assert.match(feedback.body, /난이도를 낮춥니다/);
  assert.match(feedback.body, /가능한 최소 버전/);
  assert.match(feedback.micro_action_prompt, /5분/);
});

test("identifyCarriedOverIncompleteActionsForCoaching ignores future, resolved, and verified carry-overs", () => {
  const result = identifyCarriedOverIncompleteActionsForCoaching({
    currentDay: 21,
    progressState: {
      carryOverQueue: [
        {
          sourceDay: 20,
          targetDay: 22,
          actionId: "future-action",
          actionDescription: "Future targeted action.",
          carryOverStatus: "active",
        },
        {
          sourceDay: 19,
          targetDay: 21,
          actionId: "resolved-action",
          actionDescription: "Already resolved action.",
          carryOverStatus: "resolved",
        },
        {
          sourceDay: 18,
          targetDay: 21,
          actionId: "verified-action",
          actionDescription: "Verified action.",
          carryOverStatus: "active",
          verificationResult: { passed: true },
        },
      ],
      dayRecords: [
        {
          day: 21,
          carryOverQueue: [
            {
              sourceDay: 17,
              targetDay: 21,
              actionId: "active-review-coaching",
              actionDescription: "Review the tester observation note.",
              carryOverStatus: "active",
              status: "pending",
            },
          ],
        },
      ],
    },
    now: new Date("2026-05-21T10:00:00.000Z"),
  });

  assert.equal(result.has_eligible_actions, true);
  assert.deepEqual(
    result.eligible_actions.map((action) => action.action_id),
    ["active-review-coaching"],
  );
  assert.equal(result.eligible_actions[0].source_day, 17);
  assert.equal(result.progression_blocked, false);
});

test("provider context includes carry-over coaching before current week raw answers", () => {
  const payload = buildCurriculumProviderContextPayload({
    day: 21,
    curriculumDay: { day: 21, dayType: CURRICULUM_DAY_TYPES.review, title: "Observe" },
    progressState: {
      carryOverQueue: [
        {
          sourceDay: 20,
          targetDay: 21,
          actionId: "day-20-outreach-tracker",
          actionDescription: "Send 10 personalized DMs and record outcomes.",
          status: "pending",
          carryOverStatus: "active",
        },
      ],
    },
    generatedAt: new Date("2026-05-21T11:00:00.000Z"),
  });

  assert.deepEqual(
    payload.context_order.slice(-7),
    [
      "project_context",
      "carry_over_coaching",
      "rushing_risk",
      "adaptive_difficulty_state",
      "prerequisite_requirements",
      "coaching_feedback_surface",
      "current_week_raw_answers",
    ],
  );
  const carryOverBlock = payload.context_blocks.find((block) => block.id === "carry_over_coaching");
  assert.equal(carryOverBlock.type, "carry_over_coaching");
  assert.equal(carryOverBlock.content.has_eligible_actions, true);
  assert.equal(carryOverBlock.content.eligible_actions[0].action_id, "day-20-outreach-tracker");
  const prerequisiteBlock = payload.context_blocks.find((block) => block.id === "prerequisite_requirements");
  assert.equal(prerequisiteBlock.type, "prerequisite_requirements");
  assert.equal(prerequisiteBlock.content.has_requirements, true);
  assert.equal(prerequisiteBlock.content.requirements[0].source_day, 20);
  assert.equal(prerequisiteBlock.content.requirements[0].target_day, 21);
  assert.equal(prerequisiteBlock.content.requirements[0].source_action_id, "day-20-outreach-tracker");
  assert.equal(prerequisiteBlock.content.requirements[0].progression_blocked, false);
  assert.equal(payload.prerequisite_requirements.requirements[0].source_day, 20);
  const surfaceBlock = payload.context_blocks.find((block) => block.id === "coaching_feedback_surface");
  assert.equal(surfaceBlock.type, "non_blocking_coaching_feedback");
  assert.equal(surfaceBlock.content.progression_blocked, false);
  assert.equal(surfaceBlock.content.display_mode, "non_modal");
  assert.equal(surfaceBlock.content.has_visible_feedback, true);
  assert.equal(surfaceBlock.content.feedback_items[0].type, "inline_coaching_card");
  assert.equal(surfaceBlock.content.feedback_items[0].can_continue_workflow, true);
  assert.match(surfaceBlock.content.feedback_items[0].assistant_message, /진행은 막지 않고/);
});

test("buildCurriculumCoachingFeedbackSurface exposes generated feedback as dismissible non-blocking cards", () => {
  const surface = buildCurriculumCoachingFeedbackSurface({
    currentDay: 21,
    generatedAt: new Date("2026-05-21T11:30:00.000Z"),
    coachingFeedback: {
      coaching_mode: "non_blocking_carry_over",
      feedback_items: [
        {
          action_id: "day-20-outreach-tracker",
          source_day: 20,
          target_day: 21,
          title: "Day 20 실행 이어가기",
          assistant_message: "진행은 막지 않고, 오늘 답변 전에 증거 1개만 가볍게 보강해보세요.",
          cta_text: "10분 버전으로 해보세요",
          micro_action_prompt: "10분 안에 sent row 1개를 추가해보세요.",
        },
      ],
    },
  });

  assert.equal(surface.schemaVersion, CURRICULUM_COACHING_FEEDBACK_SURFACE_SCHEMA_VERSION);
  assert.equal(surface.schema, "agentic30.curriculum.coaching_feedback_surface.v1");
  assert.equal(surface.current_day, 21);
  assert.equal(surface.generated_at, "2026-05-21T11:30:00.000Z");
  assert.equal(surface.presentation, "inline_assistant_coaching");
  assert.equal(surface.display_mode, "non_modal");
  assert.equal(surface.progression_blocked, false);
  assert.equal(surface.blocking, false);
  assert.equal(surface.dismissible, true);
  assert.equal(surface.can_advance_day, true);
  assert.equal(surface.can_continue_workflow, true);
  assert.equal(surface.has_visible_feedback, true);
  assert.equal(surface.feedback_items.length, 1);
  assert.equal(surface.feedback_items[0].type, "inline_coaching_card");
  assert.equal(surface.feedback_items[0].progression_blocked, false);
  assert.equal(surface.feedback_items[0].blocking, false);
  assert.equal(surface.feedback_items[0].dismissal_behavior, "dismiss_hint_only");
  assert.equal(surface.feedback_items[0].can_advance_day, true);
  assert.match(surface.feedback_items[0].assistant_message, /증거 1개/);
});
