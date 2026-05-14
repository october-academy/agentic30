import test from "node:test";
import assert from "node:assert/strict";

import {
  EDUCATION_DAY_WORKSHEET_SCHEMA_VERSION,
  EDUCATION_WORKSHEET_FEEDBACK_SCHEMA_VERSION,
  confirmEducationWorksheetCompletion,
  generateEducationWorksheetApplicationFeedback,
  renderEducationDayWorksheet,
  updateEducationWorksheetBlank,
} from "../sidecar/education-day-worksheet.mjs";

const DAY_SPEC = {
  day_id: 11,
  title: "No Login worksheet",
  day_goal: "첫 가치까지의 마찰을 한 문장으로 줄인다",
  worksheet_spec: {
    instruction: "빈칸을 채워 첫 사용 경로를 줄여보세요.",
    intent: "설명보다 실제 첫 가치 흐름을 고정한다.",
    template: "신규 사용자는 {{first_action}} 후 {{first_value}}를 보고, 막히면 {{fallback}}로 이동합니다.",
    blanks: [
      {
        id: "first_action",
        label: "첫 행동",
        placeholder: "예: 파일 1개 드롭",
        intent: "사용자가 처음 해야 할 행동을 하나로 제한한다.",
      },
      {
        id: "first_value",
        label: "첫 가치",
        placeholder: "예: 30초 요약",
        intent: "사용자가 바로 확인할 결과를 적는다.",
      },
      {
        id: "fallback",
        label: "막힘 폴백",
        placeholder: "예: 샘플 파일로 시작",
        intent: "막혔을 때 이탈하지 않게 하는 경로를 둔다.",
      },
    ],
  },
};

test("renderEducationDayWorksheet renders fill-in-the-blank worksheet blanks", () => {
  const view = renderEducationDayWorksheet({
    daySpec: DAY_SPEC,
    requestId: "req-education",
    sessionId: "session-education",
    now: new Date("2026-05-14T00:00:00.000Z"),
  });

  assert.equal(view.schemaVersion, EDUCATION_DAY_WORKSHEET_SCHEMA_VERSION);
  assert.equal(view.componentType, "curriculum_education_worksheet");
  assert.equal(view.dayType, "education");
  assert.equal(view.dayId, 11);
  assert.equal(view.dayGoal, "첫 가치까지의 마찰을 한 문장으로 줄인다");
  assert.equal(view.instruction, "빈칸을 채워 첫 사용 경로를 줄여보세요.");
  assert.equal(view.intent, "설명보다 실제 첫 가치 흐름을 고정한다.");
  assert.equal(view.requestId, "req-education");
  assert.equal(view.sessionId, "session-education");
  assert.equal(view.createdAt, "2026-05-14T00:00:00.000Z");

  assert.deepEqual(
    view.worksheet.blanks.map((blank) => [blank.id, blank.label, blank.placeholder, blank.filled]),
    [
      ["first_action", "첫 행동", "예: 파일 1개 드롭", false],
      ["first_value", "첫 가치", "예: 30초 요약", false],
      ["fallback", "막힘 폴백", "예: 샘플 파일로 시작", false],
    ],
  );
  assert.deepEqual(
    view.worksheet.segments.filter((segment) => segment.type === "blank").map((segment) => segment.blankId),
    ["first_action", "first_value", "fallback"],
  );
  assert.equal(view.progress.completedBlankCount, 0);
  assert.equal(view.progress.totalBlankCount, 3);
  assert.equal(view.progress.allBlanksFilled, false);
  assert.equal(view.progress.completionReady, false);
  assert.equal(view.applicationFeedback, null);
  assert.equal(view.card.layout, "education_interactive_worksheet");
  assert.equal(view.card.tone, "friendly_senior");
  assert.equal(view.card.state, "in_progress");
});

test("updateEducationWorksheetBlank saves user input and re-renders filled blanks", () => {
  const updated = updateEducationWorksheetBlank(null, {
    daySpec: DAY_SPEC,
    blankId: "first_action",
    value: "인터뷰 녹음 파일 1개를 드롭",
    now: () => new Date("2026-05-14T01:00:00.000Z"),
  });

  assert.equal(updated.didUpdate, true);
  assert.equal(updated.validationError, null);
  assert.equal(updated.progress.dayType, "education");
  assert.equal(updated.progress.completedBlankCount, 1);
  assert.equal(updated.progress.totalBlankCount, 3);
  assert.equal(updated.progress.allBlanksFilled, false);
  assert.deepEqual(updated.progress.answers, [
    {
      blankId: "first_action",
      label: "첫 행동",
      value: "인터뷰 녹음 파일 1개를 드롭",
      answeredAt: "2026-05-14T01:00:00.000Z",
    },
  ]);

  const rerendered = renderEducationDayWorksheet({
    daySpec: DAY_SPEC,
    progress: updated.progress,
    now: new Date("2026-05-14T01:01:00.000Z"),
  });
  const firstAction = rerendered.worksheet.blanks.find((blank) => blank.id === "first_action");

  assert.equal(firstAction.value, "인터뷰 녹음 파일 1개를 드롭");
  assert.equal(firstAction.filled, true);
  assert.equal(rerendered.card.state, "in_progress");
  assert.equal(rerendered.progress.completionReady, false);
  assert.equal(rerendered.applicationFeedback, null);
});

test("education worksheet reaches completion state after every required blank is filled", () => {
  const first = updateEducationWorksheetBlank(null, {
    daySpec: DAY_SPEC,
    blankId: "first_action",
    value: "인터뷰 녹음 파일 1개를 드롭",
    now: () => new Date("2026-05-14T01:00:00.000Z"),
  });
  const second = updateEducationWorksheetBlank(first.progress, {
    daySpec: DAY_SPEC,
    blankId: "first_value",
    value: "통증 quote 3개 자동 추출",
    now: () => new Date("2026-05-14T01:02:00.000Z"),
  });
  const third = updateEducationWorksheetBlank(second.progress, {
    daySpec: DAY_SPEC,
    blankId: "fallback",
    value: "샘플 transcript로 해보세요 안내",
    now: () => new Date("2026-05-14T01:03:00.000Z"),
  });

  assert.equal(third.progress.completedBlankCount, 3);
  assert.equal(third.progress.totalBlankCount, 3);
  assert.equal(third.progress.allBlanksFilled, true);
  assert.equal(third.progress.completionReady, true);
  assert.equal(third.progress.completionConfirmed, false);

  const confirmed = confirmEducationWorksheetCompletion(third.progress, {
    daySpec: DAY_SPEC,
    now: () => new Date("2026-05-14T01:04:00.000Z"),
  });
  const finalView = renderEducationDayWorksheet({
    daySpec: DAY_SPEC,
    progress: confirmed.progress,
    now: new Date("2026-05-14T01:05:00.000Z"),
  });

  assert.equal(confirmed.didConfirm, true);
  assert.equal(confirmed.validationError, null);
  assert.equal(confirmed.progress.completionConfirmed, true);
  assert.equal(confirmed.progress.completedAt, "2026-05-14T01:04:00.000Z");
  assert.equal(finalView.card.state, "complete");
  assert.equal(finalView.progress.completionReady, true);
  assert.equal(finalView.progress.completionConfirmed, true);
});

test("framework application feedback is generated and displayed after completed worksheet answers", () => {
  const first = updateEducationWorksheetBlank(null, {
    daySpec: DAY_SPEC,
    blankId: "first_action",
    value: "인터뷰 녹음 파일 1개를 드롭",
    now: () => new Date("2026-05-14T01:00:00.000Z"),
  });
  const second = updateEducationWorksheetBlank(first.progress, {
    daySpec: DAY_SPEC,
    blankId: "first_value",
    value: "통증 quote 3개 자동 추출",
    now: () => new Date("2026-05-14T01:02:00.000Z"),
  });
  const third = updateEducationWorksheetBlank(second.progress, {
    daySpec: DAY_SPEC,
    blankId: "fallback",
    value: "샘플 transcript로 해보세요 안내",
    now: () => new Date("2026-05-14T01:03:00.000Z"),
  });

  const feedback = generateEducationWorksheetApplicationFeedback({
    daySpec: DAY_SPEC,
    progress: third.progress,
    now: new Date("2026-05-14T01:04:00.000Z"),
  });
  const rendered = renderEducationDayWorksheet({
    daySpec: DAY_SPEC,
    progress: third.progress,
    now: new Date("2026-05-14T01:04:00.000Z"),
  });
  const feedbackBlock = rendered.card.blocks.find((block) => block.kind === "framework_application_feedback");

  assert.equal(feedback.schemaVersion, EDUCATION_WORKSHEET_FEEDBACK_SCHEMA_VERSION);
  assert.equal(feedback.componentType, "curriculum_education_framework_application_feedback");
  assert.equal(feedback.state, "ready");
  assert.equal(feedback.generatedAt, "2026-05-14T01:04:00.000Z");
  assert.equal(feedback.title, "프레임워크 적용 피드백");
  assert.match(feedback.summary, /실행 문장/);
  assert.deepEqual(
    feedback.highlights.map((entry) => [entry.blankId, entry.label, entry.assessment]),
    [
      ["first_action", "첫 행동", "concrete"],
      ["first_value", "첫 가치", "concrete"],
      ["fallback", "막힘 폴백", "concrete"],
    ],
  );
  assert.match(feedback.nextApplication, /다음 Action Day/);
  assert.equal(rendered.applicationFeedback.state, "ready");
  assert.ok(feedbackBlock);
  assert.equal(feedbackBlock.feedback.layout, "education_framework_application_feedback");
  assert.equal(feedbackBlock.feedback.visible, true);
  assert.deepEqual(
    feedbackBlock.feedback.blocks.map((block) => block.kind),
    ["summary", "answer_highlights", "refinements", "next_application"],
  );
});
