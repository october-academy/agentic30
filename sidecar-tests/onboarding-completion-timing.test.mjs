import test from "node:test";
import assert from "node:assert/strict";
import {
  ONBOARDING_COMPLETION_TIMEBOX_SECONDS,
  ONBOARDING_CONTEXT_QUESTION_IDS,
  buildOnboardingCompletionTimingReport,
  verifyMeasuredOnboardingCompletion,
} from "../sidecar/onboarding-completion-timing.mjs";

test("onboarding timing plan covers full intro plus three context questions under 2 minutes", () => {
  const report = buildOnboardingCompletionTimingReport();

  assert.equal(report.introSceneCount, 4);
  assert.deepEqual(report.contextQuestionIds, [
    "business_description",
    "current_stage",
    "goal",
  ]);
  assert.deepEqual(report.contextQuestionIds, ONBOARDING_CONTEXT_QUESTION_IDS);
  assert.equal(report.estimatedSeconds, 110);
  assert.equal(report.maximumSeconds, ONBOARDING_COMPLETION_TIMEBOX_SECONDS);
  assert.equal(report.canCompleteWithinBudget, true);
  assert.equal(report.remainingSeconds, 10);
});

test("onboarding measured timing verifies intro viewed, all three answers, and 120s budget", () => {
  const startedAt = new Date("2026-05-14T00:00:00.000Z");
  const completedAt = new Date("2026-05-14T00:01:59.000Z");

  const report = verifyMeasuredOnboardingCompletion({
    startedAt,
    completedAt,
    introViewed: true,
    answeredQuestionIds: [
      "onboardingContext.goal",
      "onboardingContext.businessDescription",
      "onboardingContext.currentStage",
    ],
  });

  assert.equal(report.isComplete, true);
  assert.equal(report.isWithinBudget, true);
  assert.equal(report.hasRequiredQuestions, true);
  assert.deepEqual(report.missingQuestionIds, []);
  assert.deepEqual(report.answeredQuestionIds, [
    "business_description",
    "current_stage",
    "goal",
  ]);
});

test("onboarding measured timing rejects over-budget or incomplete flows", () => {
  const startedAt = new Date("2026-05-14T00:00:00.000Z");

  const overBudget = verifyMeasuredOnboardingCompletion({
    startedAt,
    completedAt: new Date("2026-05-14T00:02:01.000Z"),
    introViewed: true,
    answeredQuestionIds: ONBOARDING_CONTEXT_QUESTION_IDS,
  });
  assert.equal(overBudget.isComplete, false);
  assert.equal(overBudget.isWithinBudget, false);

  const missingGoal = verifyMeasuredOnboardingCompletion({
    startedAt,
    completedAt: new Date("2026-05-14T00:01:30.000Z"),
    introViewed: true,
    answeredQuestionIds: ["business_description", "current_stage"],
  });
  assert.equal(missingGoal.isComplete, false);
  assert.deepEqual(missingGoal.missingQuestionIds, ["goal"]);
});
