import test from "node:test";
import assert from "node:assert/strict";
import {
  OFFICE_HOURS_CONTRACTS,
  VALIDATION_ATTEMPT_STATES,
  createValidationAttempt,
  reduceValidationAttempt,
  ValidationAttemptTransitionError,
  gradeEvidence,
  nextCardType,
  missingFields,
  canonicalCardForSignal,
  isAcceptableDay1Close,
  canStartNewAttempt,
  buildValidationAttemptFromTurns,
} from "../sidecar/office-hours-contract.mjs";

// Drive an attempt to ready_to_execute (define + select candidate).
function readyAttempt() {
  let a = createValidationAttempt({ id: "a1", createdAt: "2026-06-24T00:00:00Z" });
  a = reduceValidationAttempt(a, { type: "define_activation", fields: { activationDefinition: "첫 명상 1회 완료" } });
  a = reduceValidationAttempt(a, { type: "select_candidate", fields: { candidate: "김OO" } });
  return a;
}

test("contract registry exposes the canonical locked_day1_get_users lifecycle", () => {
  const c = OFFICE_HOURS_CONTRACTS.locked_day1_get_users;
  assert.ok(c && c.schemaVersion === 1);
  assert.deepEqual(c.states, VALIDATION_ATTEMPT_STATES);
  // canonical cards map to the six legacy signalIds (prefixed + bare)
  assert.equal(canonicalCardForSignal("get_users_active_user_definition"), "activation_definition");
  assert.equal(canonicalCardForSignal("office_hours_get_users_first_candidate"), "candidate_selection");
  assert.equal(canonicalCardForSignal("get_users_today_request"), "action_contract");
  assert.equal(canonicalCardForSignal("get_users_day1_commitment"), "action_contract");
  assert.equal(canonicalCardForSignal("bogus"), "");
});

test("happy path advances through the canonical states once each", () => {
  let a = readyAttempt();
  assert.equal(a.status, "ready_to_execute");
  a = reduceValidationAttempt(a, { type: "perform_action", fields: { externalAction: "카톡 전송", dueAt: "2026-06-24T18:00:00Z", attemptThreshold: "1명 1회", successCondition: "핵심 흐름 완료" } });
  assert.equal(a.status, "action_performed");
  a = reduceValidationAttempt(a, { type: "attach_action_proof", fields: { evidence: { kind: "dm_sent_screenshot", ref: "cap1.png" } } });
  assert.equal(a.status, "awaiting_customer_outcome");
  assert.equal(a.actionProof.grade, "action_proof");
  a = reduceValidationAttempt(a, { type: "attach_outcome", fields: { evidence: { kind: "customer_reply", ref: "reply.png" } } });
  assert.equal(a.status, "evidence_received");
  a = reduceValidationAttempt(a, { type: "succeed", fields: { evidence: { kind: "core_flow_completed", ref: "event.json" } } });
  assert.equal(a.status, "succeeded");
});

// Invariant 1: the same linear transition is never applied twice.
test("invariant: a linear transition cannot be applied twice (no duplicate slot)", () => {
  let a = createValidationAttempt({ id: "a1" });
  a = reduceValidationAttempt(a, { type: "define_activation", fields: { activationDefinition: "x" } });
  assert.throws(
    () => reduceValidationAttempt(a, { type: "define_activation", fields: { activationDefinition: "y" } }),
    (e) => e instanceof ValidationAttemptTransitionError && (e.code === "ERR_DUPLICATE_TRANSITION" || e.code === "ERR_ILLEGAL_FROM"),
  );
});

// Invariant 2: no new attempt while a prior one is unresolved.
test("invariant: cannot start a new attempt while one is unresolved", () => {
  const open = createValidationAttempt({ id: "a1" }); // needs_definition (active)
  assert.equal(canStartNewAttempt([open]), false);
  const carried = reduceValidationAttempt(open, { type: "carry", fields: { carryReason: "오늘 막힘" } });
  assert.equal(canStartNewAttempt([carried]), true);
});

// Invariant 3: cannot reach succeeded without goal evidence.
test("invariant: succeeded requires goal_proof evidence", () => {
  let a = readyAttempt();
  a = reduceValidationAttempt(a, { type: "perform_action", fields: { externalAction: "x", dueAt: "t", attemptThreshold: "1", successCondition: "y" } });
  a = reduceValidationAttempt(a, { type: "attach_action_proof", fields: { evidence: { kind: "dm_sent_screenshot" } } });
  a = reduceValidationAttempt(a, { type: "attach_outcome", fields: { evidence: { kind: "customer_reply" } } });
  // succeed with no evidence → missing goalProof
  assert.throws(() => reduceValidationAttempt(a, { type: "succeed", fields: {} }), /goalProof|goal_proof/);
  // succeed with wrong-grade evidence (action proof, not goal) → rejected
  assert.throws(
    () => reduceValidationAttempt(a, { type: "succeed", fields: { evidence: { kind: "dm_sent_screenshot" } } }),
    (e) => e.code === "ERR_WRONG_EVIDENCE_GRADE",
  );
});

// Invariant 4: blocked/carried require reason + next external action.
test("invariant: blocked requires reason and next unblock action", () => {
  const a = createValidationAttempt({ id: "a1" });
  assert.throws(() => reduceValidationAttempt(a, { type: "block", fields: { blockerReason: "후보 없음" } }), /nextUnblockAction/);
  const blocked = reduceValidationAttempt(a, { type: "block", fields: { blockerReason: "후보 없음", nextUnblockAction: "지인 1명 목록화" } });
  assert.equal(blocked.status, "blocked");
});

// Invariant 5: the LLM cannot move state or grade evidence — only validated events can.
test("invariant: self-report/AI/draft evidence is rejected (not gradeable)", () => {
  for (const kind of ["self_report", "ai_output", "draft", "demo", "plan", "intent_only"]) {
    assert.equal(gradeEvidence({ kind }).rejected, true);
    assert.equal(gradeEvidence({ kind }).grade, null);
  }
  // an unknown kind is also rejected (cannot silently become evidence)
  assert.equal(gradeEvidence({ kind: "vibes" }).rejected, true);
  // a real action proof grades correctly
  assert.equal(gradeEvidence({ kind: "dm_sent_screenshot" }).grade, "action_proof");
  assert.equal(gradeEvidence({ kind: "payment" }).grade, "goal_proof");
});

// Invariant 6: resume yields the same next transition/card (deterministic, idempotent).
test("invariant: nextCardType/missingFields are deterministic across resume", () => {
  const a = readyAttempt();
  // recompute twice (simulating a resume) → identical
  assert.equal(nextCardType(a), nextCardType(structuredClone(a)));
  assert.equal(nextCardType(a), "action_contract");
  assert.deepEqual(
    missingFields(a).sort(),
    ["attemptThreshold", "dueAt", "externalAction", "successCondition"].sort(),
  );
});

test("Day-1 close: a plan/commitment alone does NOT close; action proof or explicit blocker does", () => {
  // ready_to_execute (planned only) is NOT an acceptable close
  assert.equal(isAcceptableDay1Close(readyAttempt()), false);
  // action performed WITH proof attached IS acceptable
  let a = readyAttempt();
  a = reduceValidationAttempt(a, { type: "perform_action", fields: { externalAction: "x", dueAt: "t", attemptThreshold: "1", successCondition: "y" } });
  a = reduceValidationAttempt(a, { type: "attach_action_proof", fields: { evidence: { kind: "dm_sent_screenshot" } } });
  assert.equal(isAcceptableDay1Close(a), true);
  // explicit blocker is acceptable
  const blocked = reduceValidationAttempt(createValidationAttempt({ id: "b" }), { type: "block", fields: { blockerReason: "r", nextUnblockAction: "n" } });
  assert.equal(isAcceptableDay1Close(blocked), true);
});

test("nextCardType returns empty for resolved/terminal attempts", () => {
  const carried = reduceValidationAttempt(createValidationAttempt({ id: "a" }), { type: "carry", fields: { carryReason: "r" } });
  assert.equal(nextCardType(carried), "");
});
