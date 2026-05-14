import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  CURRICULUM_PROGRESS_EVENT_TYPES,
  applyCurriculumProgressEvent,
  loadCurriculumProgressState,
  makeDefaultCurriculumProgressState,
  persistCurriculumProgressState,
} from "../sidecar/adaptive-curriculum.mjs";
import {
  DAY1_TUTORIAL_INTERACTION_TYPES,
  handleDay1TutorialInteraction,
  normalizeDay1TutorialInteraction,
} from "../sidecar/day1-tutorial-interaction-handler.mjs";

test("Day 1 tutorial intermediate interactions never persist Day 1 completion", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-day1-tutorial-interactions-"));
  const filePath = path.join(dir, "curriculum-progress.json");
  let state = makeDefaultCurriculumProgressState(new Date("2026-05-14T08:59:00.000Z"));
  const interactions = [
    {
      type: DAY1_TUTORIAL_INTERACTION_TYPES.coachMarkDisplayed,
      stepId: "day1-cue-curriculum",
      targetElementId: "workspace.curriculumSidebar",
      completed: true,
      completionConfirmed: true,
      occurredAt: "2026-05-14T09:00:00.000Z",
    },
    {
      type: DAY1_TUTORIAL_INTERACTION_TYPES.coachMarkDismissed,
      step_id: "day1-cue-curriculum",
      completed: true,
      completion_confirmed: true,
      occurred_at: "2026-05-14T09:00:05.000Z",
    },
    {
      type: DAY1_TUTORIAL_INTERACTION_TYPES.coachMarkNavigation,
      fromStepId: "day1-cue-curriculum",
      toStepId: "day1-context-first-card",
      completed: true,
      completionConfirmed: true,
      occurredAt: "2026-05-14T09:00:10.000Z",
    },
    {
      type: DAY1_TUTORIAL_INTERACTION_TYPES.promptViewed,
      promptId: "day1-question-1",
      completed: true,
      completionConfirmed: true,
      occurredAt: "2026-05-14T09:00:15.000Z",
    },
  ];

  for (const interaction of interactions) {
    const handled = handleDay1TutorialInteraction({ state, interaction });
    state = handled.state;

    assert.equal(handled.accepted, true);
    assert.equal(handled.didPersistDayCompletion, false);
    assert.equal(handled.progressEvent.completed, false);
    assert.equal(handled.progressEvent.completionConfirmed, false);
    assert.equal(handled.state.dayRecords[0].completed, false);
    assert.equal(handled.state.dayRecords[0].completionConfirmed, false);
    assert.equal(handled.state.dayRecords[0].completedAt, "");
  }

  assert.deepEqual(
    state.dayRecords[0].lifecycleEvents.map((event) => [event.type, event.completionDriver]),
    [
      ["day1_tutorial_coach_mark_displayed", false],
      ["day1_tutorial_coach_mark_dismissed", false],
      ["day1_tutorial_coach_mark_navigation", false],
      ["day1_tutorial_prompt_viewed", false],
    ],
  );

  await persistCurriculumProgressState(filePath, state, {
    now: () => new Date("2026-05-14T09:00:16.000Z"),
  });
  const loaded = await loadCurriculumProgressState(filePath);
  assert.equal(loaded.dayRecords[0].completed, false);
  assert.equal(loaded.dayRecords[0].completionConfirmed, false);
  assert.equal(loaded.dayRecords[0].completion_confirmed, false);
  assert.equal(loaded.dayRecords[0].completedAt, "");
});

test("Day 1 tutorial interaction handler leaves explicit completion confirmation as the only completion driver", () => {
  const displayed = handleDay1TutorialInteraction({
    state: {},
    interaction: {
      event_type: "coach-mark-displayed",
      step_id: "day1-cue-curriculum",
      occurred_at: "2026-05-14T09:00:00.000Z",
      completed: true,
      completion_confirmed: true,
    },
  });

  const confirmed = applyCurriculumProgressEvent(
    displayed.state,
    {
      type: CURRICULUM_PROGRESS_EVENT_TYPES.dayCompletionConfirmed,
      day: 1,
      occurredAt: "2026-05-14T09:12:00.000Z",
    },
  );

  assert.equal(displayed.accepted, true);
  assert.equal(displayed.state.dayRecords[0].completed, false);
  assert.equal(displayed.state.dayRecords[0].completionConfirmed, false);
  assert.equal(confirmed.dayRecords[0].completed, true);
  assert.equal(confirmed.dayRecords[0].completionConfirmed, true);
  assert.equal(confirmed.dayRecords[0].completedAt, "2026-05-14T09:12:00.000Z");
  assert.deepEqual(
    confirmed.dayRecords[0].lifecycleEvents.map((event) => [event.type, event.completionDriver]),
    [
      ["day1_tutorial_coach_mark_displayed", false],
      [CURRICULUM_PROGRESS_EVENT_TYPES.dayCompletionConfirmed, true],
    ],
  );
});

test("Day 1 tutorial interaction handler rejects unsupported events without changing completion", () => {
  const initial = applyCurriculumProgressEvent(
    {},
    {
      type: CURRICULUM_PROGRESS_EVENT_TYPES.day1SessionInitialized,
      day: 1,
      occurredAt: "2026-05-14T09:00:00.000Z",
    },
  );
  const handled = handleDay1TutorialInteraction({
    state: initial,
    interaction: {
      type: "completion-card-confirmed",
      occurredAt: "2026-05-14T09:01:00.000Z",
      completed: true,
      completionConfirmed: true,
    },
  });

  assert.equal(handled.accepted, false);
  assert.equal(handled.reason, "unsupported_day1_tutorial_interaction");
  assert.equal(handled.progressEvent, null);
  assert.equal(handled.didPersistDayCompletion, false);
  assert.equal(handled.state.dayRecords[0].completed, false);
  assert.equal(handled.state.dayRecords[0].completionConfirmed, false);
  assert.deepEqual(
    handled.state.dayRecords[0].lifecycleEvents.map((event) => event.type),
    [CURRICULUM_PROGRESS_EVENT_TYPES.day1SessionInitialized],
  );
});

test("Day 1 tutorial interaction normalization accepts UI-friendly aliases", () => {
  const interaction = normalizeDay1TutorialInteraction({
    event_type: "coach mark navigation",
    from_step_id: "day1-cue-curriculum",
    to_step_id: "day1-context-first-card",
    target_element_id: "workspace.day.1",
    occurred_at: "2026-05-14T09:02:00.000Z",
  });

  assert.deepEqual(interaction, {
    type: DAY1_TUTORIAL_INTERACTION_TYPES.coachMarkNavigation,
    day: 1,
    dayType: "interview",
    occurredAt: "2026-05-14T09:02:00.000Z",
    stepId: "",
    targetElementId: "workspace.day.1",
    fromStepId: "day1-cue-curriculum",
    toStepId: "day1-context-first-card",
    promptId: "",
    questionRecords: [],
  });
});

test("Day 1 tutorial overlay skip preserves interview question records as pending", () => {
  const handled = handleDay1TutorialInteraction({
    state: {
      dayRecords: [
        {
          day: 1,
          dayType: "interview",
          questionProgress: [
            {
              questionId: "day1-question-1",
              question: "기존 질문은 그대로 남나요?",
              intent: "기존 Day 1 기록을 보존한다.",
              answer: "",
              status: "pending",
            },
          ],
        },
      ],
    },
    interaction: {
      type: DAY1_TUTORIAL_INTERACTION_TYPES.overlaySkipped,
      occurredAt: "2026-05-14T09:03:00.000Z",
      questionRecords: [
        {
          id: "day1-question-1",
          question: "기존 질문은 그대로 남나요?",
          intent: "기존 Day 1 기록을 보존한다.",
        },
        {
          id: "day1-question-2",
          question: "건너뛰어도 두 번째 질문은 남나요?",
          intent: "오버레이만 끄고 인터뷰 질문은 유지한다.",
        },
      ],
    },
  });

  const record = handled.state.dayRecords[0];
  assert.equal(handled.accepted, true);
  assert.equal(handled.progressEvent.type, CURRICULUM_PROGRESS_EVENT_TYPES.day1TutorialSkipped);
  assert.equal(record.completed, false);
  assert.equal(record.completionConfirmed, false);
  assert.equal(record.tutorialConfig.overlayActive, false);
  assert.equal(record.tutorialConfig.skipActivated, true);
  assert.equal(record.tutorialConfig.flowMode, "unguided");
  assert.equal(record.tutorialConfig.interviewFlowMode, "unguided");
  assert.equal(record.tutorialConfig.guidanceMode, "unguided_chat");
  assert.deepEqual(
    record.questionProgress.map((question) => [
      question.questionId,
      question.question,
      question.answer,
      question.status,
      question.answeredAt,
    ]),
    [
      ["day1-question-1", "기존 질문은 그대로 남나요?", "", "pending", ""],
      ["day1-question-2", "건너뛰어도 두 번째 질문은 남나요?", "", "pending", ""],
    ],
  );
  assert.equal(record.questionProgress.every((question) => question.status !== "answered"), true);
});
