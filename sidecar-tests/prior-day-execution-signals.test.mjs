import test from "node:test";
import assert from "node:assert/strict";
import {
  PRIOR_DAY_EXECUTION_SIGNAL_SCHEMA_VERSION,
  normalizePriorDayExecutionSignals,
  normalizePriorDayOutcome,
} from "../sidecar/prior-day-execution-signals.mjs";

test("normalizePriorDayExecutionSignals converts mixed raw outcomes into stable rushing input", () => {
  const result = normalizePriorDayExecutionSignals({
    current_day: 4,
    day_records: [
      {
        day: 1,
        day_type: "interview",
        started_at: "2026-05-01T09:00:00.000Z",
        completed_at: "2026-05-01T09:12:00.000Z",
        completion_confirmed: true,
        question_progress: [
          { question_id: "q1", answer: "Founder context" },
          { question_id: "q2", answer: "Customer segment" },
        ],
      },
      {
        dayId: 2,
        dayType: "action",
        startedAt: "2026-05-01T09:20:00.000Z",
        completedAt: "2026-05-01T09:35:00.000Z",
        completionConfirmed: true,
        actions: [
          {
            actionId: "day-2-market-log",
            actionDescription: "Log five paid competitors.",
            completionSignal: "Sheet contains five competitor rows.",
            verificationResult: {
              method: "google_sheets",
              passed: true,
              outcome: "verified",
            },
          },
        ],
      },
      {
        day: 3,
        day_type: "action",
        started_at: "2026-05-01T09:40:00.000Z",
        completed_at: "2026-05-01T09:50:00.000Z",
        completion_confirmed: true,
        action_spec: {
          id: "day-3-interview-script",
          action_description: "Write five Mom Test questions.",
          completion_signal: "Interview script file exists.",
        },
        verification_state: {
          status: "failed",
          verification_result: {
            method: "cli",
            passed: false,
            reason: "File did not exist.",
          },
        },
      },
      {
        day: 4,
        day_type: "education",
        completion_confirmed: true,
      },
    ],
  }, {
    now: new Date("2026-05-01T10:00:00.000Z"),
  });

  assert.equal(result.schemaVersion, PRIOR_DAY_EXECUTION_SIGNAL_SCHEMA_VERSION);
  assert.equal(result.schema, "agentic30.curriculum.prior_day_execution_signals.v1");
  assert.equal(result.current_day, 4);
  assert.deepEqual(result.days.map((day) => day.day_id), [1, 2, 3]);
  assert.equal(result.days[0].question_count, 2);
  assert.equal(result.days[0].answered_question_count, 2);
  assert.equal(result.days[0].quality_signal, "answered_curriculum_questions");
  assert.equal(result.days[1].verified_action_count, 1);
  assert.equal(result.days[1].quality_signal, "verified_action_execution");
  assert.equal(result.days[2].incomplete_action_count, 1);
  assert.equal(result.days[2].actions[0].verification_result.method, "cli");
  assert.equal(result.days[2].quality_signal, "incomplete_action_execution");

  assert.equal(result.aggregate.completed_day_count, 3);
  assert.equal(result.aggregate.latest_completed_day, 3);
  assert.equal(result.aggregate.action_count, 2);
  assert.equal(result.aggregate.verified_action_count, 1);
  assert.equal(result.aggregate.incomplete_action_count, 1);
  assert.equal(result.aggregate.action_completion_rate, 0.5);
  assert.equal(result.rushing_detection_input.completed_day_count, 3);
  assert.equal(result.rushing_detection_input.pace_metrics.days_elapsed, 0.035);
  assert.equal(result.rushing_detection_input.rushing_candidate, true);
  assert.deepEqual(result.rushing_detection_input.risk_factors, ["fast_multi_day_completion"]);
});

test("normalizePriorDayExecutionSignals accepts progressState aliases and reports action incompletion risk", () => {
  const result = normalizePriorDayExecutionSignals({
    currentDay: 8,
    progressState: {
      dayRecords: [
        {
          day: 5,
          dayType: "action",
          completionConfirmed: true,
          completedAt: "2026-05-07T09:00:00.000Z",
          actions: [
            { id: "a", status: "pending", completionSignal: "Evidence link attached." },
            { id: "b", status: "failed", completionSignal: "Doc contains decision." },
          ],
        },
        {
          day: 6,
          dayType: "interview",
          completed: true,
          completedAt: "2026-05-08T09:00:00.000Z",
          questionCount: 2,
          answeredQuestionCount: 2,
        },
        {
          day: 9,
          dayType: "action",
          completionConfirmed: true,
          completedAt: "2026-05-08T10:00:00.000Z",
        },
      ],
    },
  });

  assert.deepEqual(result.days.map((day) => day.day_id), [5, 6]);
  assert.equal(result.aggregate.completed_day_count, 2);
  assert.equal(result.aggregate.action_count, 2);
  assert.equal(result.aggregate.verified_action_count, 0);
  assert.equal(result.aggregate.incomplete_action_count, 2);
  assert.equal(result.rushing_detection_input.action_execution.incomplete_action_count, 2);
  assert.deepEqual(
    result.rushing_detection_input.risk_factors,
    ["answered_without_verified_actions", "accumulated_incomplete_actions"],
  );
});

test("normalizePriorDayExecutionSignals filters completed outcomes and activities to eligible day range", () => {
  const result = normalizePriorDayExecutionSignals({
    currentDay: 21,
    resolved_eligible_day_range: { start: 15, end: 21 },
    dayRecords: [
      {
        day: 14,
        dayType: "review",
        completionConfirmed: true,
        completedAt: "2026-05-14T21:00:00.000Z",
        actions: [
          {
            id: "day-14-archive",
            status: "passed",
          },
        ],
      },
      {
        day: 15,
        dayType: "action",
        completionConfirmed: true,
        completedAt: "2026-05-15T21:00:00.000Z",
        actions: [
          {
            id: "day-15-interview-proof",
            day: 15,
            verificationResult: { passed: true, outcome: "verified" },
          },
          {
            id: "day-14-carried-old-proof",
            sourceDay: 14,
            verificationResult: { passed: true, outcome: "verified" },
          },
        ],
      },
      {
        day: 20,
        dayType: "action",
        completionConfirmed: true,
        completedAt: "2026-05-20T21:00:00.000Z",
        actions: [
          {
            id: "day-20-outreach-proof",
            verificationResult: { passed: true, outcome: "verified" },
          },
        ],
      },
      {
        day: 22,
        dayType: "education",
        completionConfirmed: true,
        completedAt: "2026-05-22T21:00:00.000Z",
        actions: [
          {
            id: "day-22-future-proof",
            status: "passed",
          },
        ],
      },
    ],
  }, {
    now: new Date("2026-05-21T09:00:00.000Z"),
  });

  assert.deepEqual(result.eligible_day_range, { start: 15, end: 21 });
  assert.deepEqual(result.days.map((day) => day.day_id), [15, 20]);
  assert.deepEqual(
    result.days.flatMap((day) => day.actions.map((action) => action.action_id)),
    ["day-15-interview-proof", "day-20-outreach-proof"],
  );
  assert.equal(result.aggregate.completed_day_count, 2);
  assert.equal(result.aggregate.action_count, 2);
  assert.equal(result.aggregate.verified_action_count, 2);
  assert.equal(result.aggregate.latest_completed_day, 20);
});

test("normalizePriorDayOutcome produces deterministic defaults for sparse records", () => {
  const result = normalizePriorDayOutcome({
    day: "14",
    type: "Review",
    completed: true,
    completionDriver: "completion-card-confirmed",
  }, {
    generatedAt: "2026-05-14T00:00:00.000Z",
  });

  assert.equal(result.day_id, 14);
  assert.equal(result.day_type, "review");
  assert.equal(result.completion_confirmed, true);
  assert.equal(result.completion_driver, "completion-card-confirmed");
  assert.equal(result.started_at, null);
  assert.equal(result.completed_at, null);
  assert.equal(result.elapsed_minutes, null);
  assert.equal(result.action_count, 0);
  assert.equal(result.quality_signal, "completion_confirmed_without_execution_detail");
});

test("normalizePriorDayOutcome derives execution timing from lifecycle events", () => {
  const result = normalizePriorDayOutcome({
    day: 6,
    dayType: "interview",
    completed: true,
    lifecycleEvents: [
      {
        type: "day_started",
        occurredAt: "2026-05-06T09:00:00.000Z",
      },
      {
        type: "day_completion_confirmed",
        occurredAt: "2026-05-06T09:18:30.000Z",
        completionDriver: true,
      },
    ],
  }, {
    generatedAt: "2026-05-06T10:00:00.000Z",
  });

  assert.equal(result.started_at, "2026-05-06T09:00:00.000Z");
  assert.equal(result.completed_at, "2026-05-06T09:18:30.000Z");
  assert.equal(result.elapsed_minutes, 18.5);
});

test("normalizePriorDayExecutionSignals treats accepted fallback evidence as verified action execution", () => {
  const result = normalizePriorDayExecutionSignals({
    currentDay: 20,
    dayRecords: [
      {
        day: 19,
        dayType: "action",
        completed: true,
        completedAt: "2026-05-19T21:00:00.000Z",
        actionSpec: {
          id: "day-19-public-proof",
          actionDescription: "Publish first public proof.",
          completionSignal: "A public URL is attached.",
        },
        verificationState: {
          status: "passed",
          evidenceSubmission: {
            type: "link",
            content: "https://example.com/proof",
            validationStatus: "accepted",
          },
        },
      },
    ],
  }, {
    now: new Date("2026-05-20T09:00:00.000Z"),
  });

  assert.equal(result.days[0].verified_action_count, 1);
  assert.equal(result.days[0].quality_signal, "verified_action_execution");
  assert.equal(result.days[0].actions[0].evidence_submission.validation_status, "accepted");
  assert.equal(result.aggregate.action_completion_rate, 1);
  assert.equal(result.rushing_detection_input.action_execution.verified_action_count, 1);
});
