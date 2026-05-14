import test from "node:test";
import assert from "node:assert/strict";

import {
  CURRICULUM_PROGRESSION_GATE_SCHEMA_VERSION,
  evaluateCurriculumProgressionGate,
} from "../sidecar/curriculum-progression-gate.mjs";

test("evaluateCurriculumProgressionGate blocks hard prerequisite actions until completion is verified", () => {
  const result = evaluateCurriculumProgressionGate({
    currentDay: 6,
    now: new Date("2026-05-14T12:00:00.000Z"),
    prerequisiteRequirements: {
      requirements: [
        {
          requirement_id: "day-6-requires-day-2-market-log",
          requirement_mode: "blocking_prerequisite",
          required_before: "day_unlock",
          source_day: 2,
          source_action_id: "day-2-market-log",
          action_description: "Record five paid alternatives.",
        },
      ],
    },
    progressState: {
      dayRecords: [
        {
          day: 2,
          action_spec: {
            id: "day-2-market-log",
            completion_signal: "day-2-evidence-log.md includes five priced competitors.",
          },
          verification_result: {
            method: "google_docs",
            passed: false,
            reason: "Only two competitors were found.",
          },
        },
      ],
    },
  });

  assert.equal(result.schemaVersion, CURRICULUM_PROGRESSION_GATE_SCHEMA_VERSION);
  assert.equal(result.schema, "agentic30.curriculum.progression_gate.v1");
  assert.equal(result.status, "blocked");
  assert.equal(result.gate_status, "blocked");
  assert.equal(result.allowed, false);
  assert.equal(result.blocked, true);
  assert.equal(result.progression_blocked, true);
  assert.equal(result.can_advance_day, false);
  assert.equal(result.blocking_failure_count, 1);
  assert.deepEqual(result.blocking_requirement_ids, ["day-6-requires-day-2-market-log"]);

  const evaluation = result.requirement_evaluations[0];
  assert.equal(evaluation.requirement_id, "day-6-requires-day-2-market-log");
  assert.equal(evaluation.satisfied, false);
  assert.equal(evaluation.blocking, true);
  assert.equal(evaluation.gate_status, "blocked");
  assert.equal(evaluation.reason, "blocking_prerequisite_action_incomplete_or_unverified");
  assert.equal(evaluation.matched_action_count, 1);
  assert.equal(evaluation.verification_result.passed, false);
});

test("evaluateCurriculumProgressionGate allows progression when prerequisite verification passed", () => {
  const result = evaluateCurriculumProgressionGate({
    currentDay: 6,
    prerequisiteRequirements: {
      requirements: [
        {
          requirement_id: "day-6-requires-day-2-market-log",
          requirement_mode: "blocking_prerequisite",
          verification_method: "google_docs",
          source_day: 2,
          source_action_id: "day-2-market-log",
        },
      ],
    },
    verificationStates: {
      "day-2-market-log": {
        status: "passed",
        verificationResult: {
          method: "google_docs",
          passed: true,
          confidence: 0.92,
        },
      },
    },
  });

  assert.equal(result.status, "allowed");
  assert.equal(result.allowed, true);
  assert.equal(result.blocked, false);
  assert.equal(result.progression_blocked, false);
  assert.equal(result.can_advance_day, true);
  assert.equal(result.satisfied_requirement_count, 1);
  assert.equal(result.unmet_requirement_count, 0);
  assert.equal(result.blocking_failure_count, 0);
  assert.equal(result.requirement_evaluations[0].satisfied, true);
  assert.equal(result.requirement_evaluations[0].completion_source, "matched_action");
  assert.equal(result.requirement_evaluations[0].verification_result.passed, true);
  assert.equal(result.requirement_evaluations[0].configured_verifier_succeeded, true);
});

test("evaluateCurriculumProgressionGate does not mark prerequisite verified before configured verifier succeeds", () => {
  const result = evaluateCurriculumProgressionGate({
    currentDay: 6,
    prerequisiteRequirements: {
      requirements: [
        {
          requirement_id: "day-6-requires-day-2-market-log",
          requirement_mode: "blocking_prerequisite",
          verification_method: "google_sheets",
          source_day: 2,
          source_action_id: "day-2-market-log",
        },
      ],
    },
    verificationStates: {
      "day-2-market-log": {
        status: "passed",
        verified: true,
        verificationResult: {
          method: "google_docs",
          passed: true,
          confidence: 0.95,
        },
      },
    },
  });

  assert.equal(result.status, "blocked");
  assert.equal(result.allowed, false);
  assert.equal(result.satisfied_requirement_count, 0);
  assert.equal(result.blocking_failure_count, 1);

  const evaluation = result.requirement_evaluations[0];
  assert.equal(evaluation.satisfied, false);
  assert.equal(evaluation.configured_verifier, "google_sheets");
  assert.equal(evaluation.configured_verifier_succeeded, false);
  assert.equal(evaluation.verification_result.passed, true);
  assert.equal(evaluation.verification_result.method, "google_docs");
  assert.equal(evaluation.reason, "blocking_prerequisite_action_incomplete_or_unverified");
});

test("evaluateCurriculumProgressionGate ignores optimistic prerequisite flags without a passing verifier result", () => {
  const optimisticOnly = evaluateCurriculumProgressionGate({
    currentDay: 6,
    prerequisiteRequirements: {
      requirements: [
        {
          requirement_id: "day-6-requires-day-2-market-log",
          requirement_mode: "blocking_prerequisite",
          verification_method: "google_docs",
          source_day: 2,
          source_action_id: "day-2-market-log",
        },
      ],
    },
    verificationStates: {
      "day-2-market-log": {
        status: "verified",
        verified: true,
      },
    },
  });

  assert.equal(optimisticOnly.status, "blocked");
  assert.equal(optimisticOnly.requirement_evaluations[0].satisfied, false);
  assert.equal(optimisticOnly.requirement_evaluations[0].configured_verifier_succeeded, false);

  const failedVerifier = evaluateCurriculumProgressionGate({
    currentDay: 6,
    prerequisiteRequirements: {
      requirements: [
        {
          requirement_id: "day-6-requires-day-2-market-log",
          requirement_mode: "blocking_prerequisite",
          verification_method: "google_docs",
          source_day: 2,
          source_action_id: "day-2-market-log",
        },
      ],
    },
    verificationStates: {
      "day-2-market-log": {
        status: "failed",
        verificationResult: {
          method: "google_docs",
          passed: false,
          reason: "The configured verifier found only two rows.",
        },
      },
    },
  });

  assert.equal(failedVerifier.status, "blocked");
  assert.equal(failedVerifier.requirement_evaluations[0].satisfied, false);
  assert.equal(failedVerifier.requirement_evaluations[0].verification_result.passed, false);
  assert.equal(failedVerifier.requirement_evaluations[0].configured_verifier_succeeded, false);
});

test("evaluateCurriculumProgressionGate keeps non-blocking carry-over allowed but reports unmet prerequisite", () => {
  const result = evaluateCurriculumProgressionGate({
    currentDay: 21,
    prerequisiteRequirements: {
      requirement_mode: "non_blocking_prerequisite",
      requirements: [
        {
          requirement_id: "day-21-requires-day-20-outreach-tracker",
          requirement_type: "carry_over_incomplete_action",
          requirement_mode: "non_blocking_prerequisite",
          required_before: "day_quality_completion",
          source_day: 20,
          source_action_id: "day-20-outreach-tracker",
          progression_blocked: false,
          can_advance_day: true,
        },
      ],
    },
    dayRecords: [
      {
        day: 20,
        actions: [
          {
            action_id: "day-20-outreach-tracker",
            status: "pending",
            verification_result: {
              method: "google_sheets",
              passed: false,
              reason: "Only three sent rows were found.",
            },
          },
        ],
      },
    ],
  });

  assert.equal(result.status, "allowed");
  assert.equal(result.allowed, true);
  assert.equal(result.progression_blocked, false);
  assert.equal(result.can_advance_day, true);
  assert.equal(result.has_requirements, true);
  assert.equal(result.satisfied_requirement_count, 0);
  assert.equal(result.unmet_requirement_count, 1);
  assert.equal(result.blocking_failure_count, 0);

  const evaluation = result.requirement_evaluations[0];
  assert.equal(evaluation.satisfied, false);
  assert.equal(evaluation.blocking, false);
  assert.equal(evaluation.gate_status, "allowed");
  assert.equal(evaluation.can_advance_day, true);
  assert.equal(evaluation.reason, "non_blocking_prerequisite_action_incomplete_or_unverified");
});
