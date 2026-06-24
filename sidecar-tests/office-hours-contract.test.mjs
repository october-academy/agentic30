import test from "node:test";
import assert from "node:assert/strict";
import {
  OFFICE_HOURS_CONTRACTS,
  OFFICE_HOURS_CONTRACT_SCHEMA_VERSION,
  VALIDATION_ATTEMPT_STATES,
  VALIDATION_ATTEMPT_ACTIVE_STATES,
  VALIDATION_ATTEMPT_WAIT_STATES,
  VALIDATION_ATTEMPT_TERMINAL_STATES,
  VALIDATION_ATTEMPT_SUSPENDED_STATES,
  VALIDATION_ATTEMPT_RESOLVED_STATES,
  VALIDATION_ATTEMPT_TRANSITIONS,
  VALIDATION_ATTEMPT_CARD_TYPES,
  LEGACY_SIGNAL_ALIASES,
  NEGATIVE_OUTCOME_KINDS,
  LEGACY_MIGRATION_DISPOSITION_UNVERIFIED,
  createValidationAttempt,
  reduceValidationAttempt,
  ValidationAttemptTransitionError,
  ValidationAttemptMigrationError,
  gradeEvidence,
  stableStringify,
  payloadHashOf,
  nextCardType,
  nextAttemptAction,
  missingFields,
  canonicalCardForSignal,
  isAcceptableDay1Close,
  canStartNewAttempt,
  buildValidationAttemptFromTurns,
  GET_USERS_LADDER_SIGNAL_ORDER,
  canonicalLadderSignal,
  isGetUsersLadderSignal,
  nextLadderSignal,
} from "../sidecar/office-hours-contract.mjs";

// ── Helpers ────────────────────────────────────────────────────────────────────
let __eid = 0;
/** Apply one event with an auto-generated unique eventId (so tests don't repeat). */
function step(attempt, type, fields, at) {
  __eid += 1;
  const event = { type, eventId: `t-${__eid}`, fields };
  if (at) event.at = at;
  return reduceValidationAttempt(attempt, event);
}

/** Drive an attempt to `execution_scheduled` through all six gather slots. */
function scheduledAttempt() {
  let a = createValidationAttempt({ id: "a1", createdAt: "2026-06-24T00:00:00Z" });
  a = step(a, "define_activation", { activationDefinition: "첫 명상 1회 완료" });
  a = step(a, "select_candidate", { candidate: "김OO" });
  a = step(a, "record_alternative", { currentAlternative: "유튜브 명상 영상" });
  a = step(a, "define_action_contract", { externalAction: "카톡 전송", attemptThreshold: "1명 1회", successCondition: "핵심 흐름 완료" });
  a = step(a, "define_evidence_contract", { expectedProofKind: "dm_sent_screenshot", evidenceLocation: "카톡 캡처" });
  a = step(a, "schedule_execution", { dueAt: "2026-06-24T18:00:00Z", commitmentNote: "퇴근 후 발송" });
  return a;
}

/** execution_scheduled → awaiting_customer_outcome via real action proof. */
function awaitingAttempt() {
  let a = scheduledAttempt();
  a = step(a, "record_action_proof", { evidence: { kind: "dm_sent_screenshot", ref: "cap1.png" } });
  return a;
}

/** awaiting → outcome_observed via customer reply. */
function outcomeObservedAttempt() {
  let a = awaitingAttempt();
  a = step(a, "record_customer_outcome", { evidence: { kind: "customer_reply", ref: "reply.png" } });
  return a;
}

// Map: which state each gather transition legally fires from (single-source for the matrix).
const GATHER_FROM = {
  define_activation: "needs_definition",
  select_candidate: "needs_candidate",
  record_alternative: "needs_alternative",
  define_action_contract: "needs_action_contract",
  define_evidence_contract: "needs_evidence_contract",
  schedule_execution: "needs_commitment",
};

// Build a minimally-valid fields object for any transition fired from a legal state.
function fieldsFor(type) {
  switch (type) {
    case "define_activation": return { activationDefinition: "x" };
    case "select_candidate": return { candidate: "x" };
    case "record_alternative": return { currentAlternative: "x" };
    case "define_action_contract": return { externalAction: "x", attemptThreshold: "1", successCondition: "y" };
    case "define_evidence_contract": return { expectedProofKind: "dm_sent_screenshot", evidenceLocation: "loc" };
    case "schedule_execution": return { dueAt: "2026-06-24T18:00:00Z" };
    case "record_action_proof": return { evidence: { kind: "dm_sent_screenshot" } };
    case "record_customer_outcome": return { evidence: { kind: "customer_reply" } };
    case "record_goal_proof": return { evidence: { kind: "payment" } };
    case "record_negative_outcome": return { evidence: { kind: "refusal" } };
    case "expire_no_response": return { responseDueAt: "2026-06-24T00:00:00Z", now: "2026-06-25T00:00:00Z" };
    case "abandon_attempt": return { abandonReason: "사용자 중단 승인" };
    case "block": return { blockerReason: "후보 없음", nextUnblockAction: "지인 1명 목록화" };
    case "carry": return { carryReason: "오늘 막힘" };
    case "unblock": return {};
    case "resume": return {};
    default: return {};
  }
}

// Produce a fresh attempt parked in a given status (for matrix tests).
function attemptInStatus(status) {
  if (status === "needs_definition") return createValidationAttempt({ id: "s" });
  if (status === "needs_candidate") return step(createValidationAttempt({ id: "s" }), "define_activation", { activationDefinition: "x" });
  if (status === "needs_alternative") return step(step(createValidationAttempt({ id: "s" }), "define_activation", { activationDefinition: "x" }), "select_candidate", { candidate: "y" });
  if (status === "needs_action_contract") return step(attemptInStatus("needs_alternative"), "record_alternative", { currentAlternative: "z" });
  if (status === "needs_evidence_contract") return step(attemptInStatus("needs_action_contract"), "define_action_contract", { externalAction: "a", attemptThreshold: "1", successCondition: "b" });
  if (status === "needs_commitment") return step(attemptInStatus("needs_evidence_contract"), "define_evidence_contract", { expectedProofKind: "dm_sent_screenshot", evidenceLocation: "l" });
  if (status === "execution_scheduled") return scheduledAttempt();
  if (status === "awaiting_customer_outcome") return awaitingAttempt();
  if (status === "outcome_observed") return outcomeObservedAttempt();
  if (status === "succeeded") return step(scheduledAttempt(), "record_goal_proof", { evidence: { kind: "payment" } });
  if (status === "failed") return step(scheduledAttempt(), "abandon_attempt", { abandonReason: "중단" });
  if (status === "blocked") return step(createValidationAttempt({ id: "s" }), "block", { blockerReason: "r", nextUnblockAction: "n" });
  if (status === "carried") return step(createValidationAttempt({ id: "s" }), "carry", { carryReason: "r" });
  throw new Error(`no builder for status ${status}`);
}

// The legal (from-status, transition) pairs — the authoritative legal matrix.
const ACTIVE = VALIDATION_ATTEMPT_ACTIVE_STATES;
const LEGAL = [];
for (const [t, from] of Object.entries(GATHER_FROM)) LEGAL.push([from, t]);
LEGAL.push(["execution_scheduled", "record_action_proof"]);
LEGAL.push(["awaiting_customer_outcome", "record_customer_outcome"]);
LEGAL.push(["execution_scheduled", "record_goal_proof"]);
LEGAL.push(["awaiting_customer_outcome", "record_goal_proof"]);
LEGAL.push(["outcome_observed", "record_goal_proof"]);
LEGAL.push(["awaiting_customer_outcome", "record_negative_outcome"]);
LEGAL.push(["outcome_observed", "record_negative_outcome"]);
LEGAL.push(["awaiting_customer_outcome", "expire_no_response"]);
// abandon from any active ∪ wait ∪ suspended
for (const s of [...ACTIVE, ...VALIDATION_ATTEMPT_WAIT_STATES, ...VALIDATION_ATTEMPT_SUSPENDED_STATES]) LEGAL.push([s, "abandon_attempt"]);
// block/carry from any active
for (const s of ACTIVE) { LEGAL.push([s, "block"]); LEGAL.push([s, "carry"]); }
LEGAL.push(["blocked", "unblock"]);
LEGAL.push(["carried", "resume"]);
const LEGAL_SET = new Set(LEGAL.map(([s, t]) => `${s}::${t}`));

// ── Registry / schema ────────────────────────────────────────────────────────
test("contract registry exposes the canonical locked_day1_get_users lifecycle (schema v2)", () => {
  const c = OFFICE_HOURS_CONTRACTS.locked_day1_get_users;
  assert.ok(c && c.schemaVersion === OFFICE_HOURS_CONTRACT_SCHEMA_VERSION);
  assert.equal(OFFICE_HOURS_CONTRACT_SCHEMA_VERSION, 2);
  assert.deepEqual(c.states, VALIDATION_ATTEMPT_STATES);
  assert.equal(VALIDATION_ATTEMPT_STATES.length, 13);
  assert.equal(VALIDATION_ATTEMPT_ACTIVE_STATES.length, 6);
  assert.deepEqual([...VALIDATION_ATTEMPT_TERMINAL_STATES], ["succeeded", "failed"]);
  assert.deepEqual([...VALIDATION_ATTEMPT_SUSPENDED_STATES], ["blocked", "carried"]);
});

// ── 6-card 1:1 (GPT 6.1) ──────────────────────────────────────────────────────
test("6 cards map 1:1 to the six ladder slots (no folding)", () => {
  assert.equal(VALIDATION_ATTEMPT_CARD_TYPES.length, 6);
  assert.deepEqual(VALIDATION_ATTEMPT_CARD_TYPES, [
    "activation_definition", "candidate_selection", "current_alternative",
    "action_request", "evidence_contract", "commitment",
  ]);
});

test("canonicalCardForSignal resolves all six slots 1:1 (bare + office_hours_ prefixed)", () => {
  const pairs = [
    ["get_users_active_user_definition", "activation_definition"],
    ["get_users_first_candidate", "candidate_selection"],
    ["get_users_current_alternative", "current_alternative"],
    ["get_users_today_request", "action_request"],
    ["get_users_evidence_format", "evidence_contract"],
    ["get_users_day1_commitment", "commitment"],
  ];
  for (const [bare, card] of pairs) {
    assert.equal(canonicalCardForSignal(bare), card, `bare ${bare}`);
    assert.equal(canonicalCardForSignal(`office_hours_${bare}`), card, `prefixed ${bare}`);
  }
  assert.equal(canonicalCardForSignal("bogus"), "");
  // LEGACY_SIGNAL_ALIASES is 1:1 (no two legacy ids collapse to the same "action_contract").
  const distinctCards = new Set(Object.values(LEGACY_SIGNAL_ALIASES));
  assert.equal(distinctCards.size, 6);
});

// ── Happy path through the new graph ───────────────────────────────────────────
test("happy path: six gather slots → execution_scheduled → action → outcome → succeeded", () => {
  let a = scheduledAttempt();
  assert.equal(a.status, "execution_scheduled");
  a = step(a, "record_action_proof", { evidence: { kind: "dm_sent_screenshot", ref: "c.png" } });
  assert.equal(a.status, "awaiting_customer_outcome");
  assert.equal(a.actionProof.grade, "action_proof");
  a = step(a, "record_customer_outcome", { evidence: { kind: "customer_reply" } });
  assert.equal(a.status, "outcome_observed");
  assert.equal(a.customerOutcome.grade, "customer_outcome");
  a = step(a, "record_goal_proof", { evidence: { kind: "payment" } });
  assert.equal(a.status, "succeeded");
  assert.equal(a.goalProof.grade, "goal_proof");
});

// ── 6.2: perform_action removed; plan answers can never become action_performed ─
test("perform_action no longer exists; planning never produces action proof", () => {
  assert.equal(VALIDATION_ATTEMPT_TRANSITIONS.includes("perform_action"), false);
  // Completing the plan (schedule_execution) leaves WAIT with no action proof.
  const a = scheduledAttempt();
  assert.equal(a.actionProof, null);
  assert.equal(a.status, "execution_scheduled");
  // record_action_proof requires REAL evidence, not a plan field.
  assert.throws(
    () => step(a, "record_action_proof", { evidence: { kind: "plan" } }),
    (e) => e.code === "ERR_WRONG_EVIDENCE_GRADE",
  );
});

// ── Full legal/illegal transition matrix ───────────────────────────────────────
test("legal/illegal transition matrix: every (state × transition) is legal or throws ERR_ILLEGAL_FROM", () => {
  for (const status of VALIDATION_ATTEMPT_STATES) {
    for (const type of VALIDATION_ATTEMPT_TRANSITIONS) {
      const key = `${status}::${type}`;
      const expectLegal = LEGAL_SET.has(key);
      const base = attemptInStatus(status);
      const event = { type, eventId: `matrix-${status}-${type}`, fields: fieldsFor(type) };
      if (expectLegal) {
        const next = reduceValidationAttempt(base, event);
        assert.ok(next && next.status, `${key} should be legal`);
      } else {
        assert.throws(
          () => reduceValidationAttempt(base, event),
          (e) => e instanceof ValidationAttemptTransitionError && e.code === "ERR_ILLEGAL_FROM",
          `${key} should throw ERR_ILLEGAL_FROM`,
        );
      }
    }
  }
});

// ── 6.10: allowedFields allowlist / field injection ────────────────────────────
test("arbitrary field injection is rejected (ERR_UNKNOWN_FIELD)", () => {
  const a = createValidationAttempt({ id: "a" });
  assert.throws(
    () => step(a, "define_activation", { activationDefinition: "x", status: "succeeded" }),
    (e) => e.code === "ERR_UNKNOWN_FIELD",
  );
  // Cannot smuggle a proof slot through a gather transition.
  assert.throws(
    () => step(a, "define_activation", { activationDefinition: "x", actionProof: { kind: "payment" } }),
    (e) => e.code === "ERR_UNKNOWN_FIELD",
  );
  // candidateId IS allowed alongside candidate.
  const c = step(a, "define_activation", { activationDefinition: "x" });
  const sel = step(c, "select_candidate", { candidate: "김", candidateId: "u_123" });
  assert.equal(sel.candidateId, "u_123");
});

test("evidence is only acceptable through its grade path, not as a raw stored field", () => {
  const a = scheduledAttempt();
  // record_action_proof allows ONLY `evidence`; raw `actionProof` field is rejected.
  assert.throws(
    () => step(a, "record_action_proof", { actionProof: { kind: "dm_sent_screenshot" } }),
    (e) => e.code === "ERR_UNKNOWN_FIELD",
  );
});

// ── Evidence grading / unknown kind ────────────────────────────────────────────
test("unknown / self-report / draft evidence kinds are rejected", () => {
  for (const kind of ["self_report", "ai_output", "draft", "demo", "plan", "intent_only"]) {
    assert.equal(gradeEvidence({ kind }).rejected, true);
    assert.equal(gradeEvidence({ kind }).grade, null);
  }
  assert.equal(gradeEvidence({ kind: "vibes" }).rejected, true); // unknown
  assert.equal(gradeEvidence({}).rejected, true); // empty
  assert.equal(gradeEvidence({ kind: "dm_sent_screenshot" }).grade, "action_proof");
  assert.equal(gradeEvidence({ kind: "customer_reply" }).grade, "customer_outcome");
  assert.equal(gradeEvidence({ kind: "payment" }).grade, "goal_proof");
});

test("record_action_proof rejects an unknown evidence kind (cannot move state)", () => {
  const a = scheduledAttempt();
  assert.throws(
    () => step(a, "record_action_proof", { evidence: { kind: "vibes" } }),
    (e) => e.code === "ERR_WRONG_EVIDENCE_GRADE",
  );
});

// ── 6.5: record_customer_outcome grade enforcement ─────────────────────────────
test("record_customer_outcome enforces grade==customer_outcome (action_proof/draft throw)", () => {
  const a = awaitingAttempt();
  // wrong grade: action proof
  assert.throws(
    () => step(a, "record_customer_outcome", { evidence: { kind: "dm_sent_screenshot" } }),
    (e) => e.code === "ERR_WRONG_EVIDENCE_GRADE",
  );
  // wrong grade: goal proof
  assert.throws(
    () => step(a, "record_customer_outcome", { evidence: { kind: "payment" } }),
    (e) => e.code === "ERR_WRONG_EVIDENCE_GRADE",
  );
  // rejected: draft
  assert.throws(
    () => step(a, "record_customer_outcome", { evidence: { kind: "draft" } }),
    (e) => e.code === "ERR_WRONG_EVIDENCE_GRADE",
  );
  // correct: customer reply
  const ok = step(a, "record_customer_outcome", { evidence: { kind: "customer_reply" } });
  assert.equal(ok.status, "outcome_observed");
});

// ── 6.6: direct goal proof ─────────────────────────────────────────────────────
test("direct goal proof: record_goal_proof succeeds from execution_scheduled and from awaiting", () => {
  // straight from execution_scheduled (paid right after outreach)
  let a = scheduledAttempt();
  a = step(a, "record_goal_proof", { evidence: { kind: "payment", ref: "pay.png" } });
  assert.equal(a.status, "succeeded");

  // and from awaiting_customer_outcome
  let b = awaitingAttempt();
  b = step(b, "record_goal_proof", { evidence: { kind: "activation_event" } });
  assert.equal(b.status, "succeeded");

  // and from outcome_observed
  let c = outcomeObservedAttempt();
  c = step(c, "record_goal_proof", { evidence: { kind: "core_flow_completed" } });
  assert.equal(c.status, "succeeded");

  // wrong-grade goal proof throws
  assert.throws(
    () => step(scheduledAttempt(), "record_goal_proof", { evidence: { kind: "dm_sent_screenshot" } }),
    (e) => e.code === "ERR_WRONG_EVIDENCE_GRADE",
  );
});

// ── 6.7: negative outcome / fail paths ─────────────────────────────────────────
test("record_negative_outcome requires customer_outcome grade AND a refusal/drop_off kind", () => {
  const a = awaitingAttempt();
  // valid: refusal
  const r = step(a, "record_negative_outcome", { evidence: { kind: "refusal", ref: "no.png" } });
  assert.equal(r.status, "failed");
  assert.equal(r.negativeOutcome.kind, "refusal");

  // valid: drop_off_step (from outcome_observed too)
  const d = step(outcomeObservedAttempt(), "record_negative_outcome", { evidence: { kind: "drop_off_step" } });
  assert.equal(d.status, "failed");

  // customer_outcome grade but NOT a negative kind → ERR_WRONG_EVIDENCE_KIND
  assert.throws(
    () => step(a, "record_negative_outcome", { evidence: { kind: "customer_reply" } }),
    (e) => e.code === "ERR_WRONG_EVIDENCE_KIND",
  );
  // wrong grade entirely (action proof) → ERR_WRONG_EVIDENCE_GRADE
  assert.throws(
    () => step(a, "record_negative_outcome", { evidence: { kind: "dm_sent_screenshot" } }),
    (e) => e.code === "ERR_WRONG_EVIDENCE_GRADE",
  );
  assert.deepEqual([...NEGATIVE_OUTCOME_KINDS].sort(), ["drop_off_step", "refusal"]);
});

// ── 6.7: deadline-driven fail (expire_no_response) ─────────────────────────────
test("expire_no_response: rejected before the deadline, allowed at/after it", () => {
  const a = awaitingAttempt();
  // now < responseDueAt → ERR_DEADLINE_NOT_REACHED
  assert.throws(
    () => step(a, "expire_no_response", { responseDueAt: "2026-06-30T00:00:00Z", now: "2026-06-25T00:00:00Z" }),
    (e) => e.code === "ERR_DEADLINE_NOT_REACHED",
  );
  // now == responseDueAt → allowed
  const onTime = step(a, "expire_no_response", { responseDueAt: "2026-06-25T00:00:00Z", now: "2026-06-25T00:00:00Z" });
  assert.equal(onTime.status, "failed");
  // now > responseDueAt → allowed
  const after = step(awaitingAttempt(), "expire_no_response", { responseDueAt: "2026-06-25T00:00:00Z", now: "2026-06-26T00:00:00Z" });
  assert.equal(after.status, "failed");
  // missing `now` → cannot verify → throw
  assert.throws(
    () => step(awaitingAttempt(), "expire_no_response", { responseDueAt: "2026-06-25T00:00:00Z" }),
    (e) => e.code === "ERR_DEADLINE_NOT_REACHED",
  );
});

test("abandon_attempt is the only free-text fail path (active, wait, or suspended)", () => {
  // from active
  const a = step(createValidationAttempt({ id: "a" }), "abandon_attempt", { abandonReason: "중단 승인" });
  assert.equal(a.status, "failed");
  // from wait
  const w = step(scheduledAttempt(), "abandon_attempt", { abandonReason: "중단" });
  assert.equal(w.status, "failed");
  // from suspended (blocked)
  const blocked = step(createValidationAttempt({ id: "b" }), "block", { blockerReason: "r", nextUnblockAction: "n" });
  const ab = step(blocked, "abandon_attempt", { abandonReason: "포기" });
  assert.equal(ab.status, "failed");
  // requires abandonReason
  assert.throws(
    () => step(createValidationAttempt({ id: "c" }), "abandon_attempt", {}),
    (e) => e.code === "ERR_MISSING_REQUIRED_FIELD",
  );
});

// ── requires gate (GPT 6.3) ────────────────────────────────────────────────────
test("transition-level requires is enforced even when allowedFields are present-but-empty", () => {
  const a = attemptInStatus("needs_action_contract");
  // externalAction present, but attemptThreshold/successCondition empty → throw
  assert.throws(
    () => step(a, "define_action_contract", { externalAction: "x", attemptThreshold: "", successCondition: "" }),
    (e) => e.code === "ERR_MISSING_REQUIRED_FIELD",
  );
  // block requires nextUnblockAction (allowed field, but missing → required-field gate)
  assert.throws(
    () => step(createValidationAttempt({ id: "b" }), "block", { blockerReason: "후보 없음" }),
    (e) => e.code === "ERR_MISSING_REQUIRED_FIELD",
  );
});

// ── 6.9: eventId idempotency ───────────────────────────────────────────────────
test("eventId is required (ERR_EVENT_ID_REQUIRED)", () => {
  const a = createValidationAttempt({ id: "a" });
  assert.throws(
    () => reduceValidationAttempt(a, { type: "define_activation", fields: { activationDefinition: "x" } }),
    (e) => e.code === "ERR_EVENT_ID_REQUIRED",
  );
  assert.throws(
    () => reduceValidationAttempt(a, { type: "define_activation", eventId: "   ", fields: { activationDefinition: "x" } }),
    (e) => e.code === "ERR_EVENT_ID_REQUIRED",
  );
});

test("same eventId + same payload replays as a no-op (idempotent)", () => {
  const a = createValidationAttempt({ id: "a" });
  const ev = { type: "define_activation", eventId: "evt-1", fields: { activationDefinition: "x" } };
  const once = reduceValidationAttempt(a, ev);
  const twice = reduceValidationAttempt(once, ev); // replay
  assert.strictEqual(twice, once); // unchanged reference
  assert.equal(once.appliedEvents.length, 1);
  assert.equal(once.appliedEvents[0].eventId, "evt-1");
  assert.ok(once.appliedEvents[0].payloadHash);
});

test("same eventId + different payload conflicts (ERR_EVENT_ID_CONFLICT)", () => {
  const a = createValidationAttempt({ id: "a" });
  const once = reduceValidationAttempt(a, { type: "define_activation", eventId: "evt-1", fields: { activationDefinition: "x" } });
  // After advancing to needs_candidate, replay evt-1 with different payload:
  assert.throws(
    () => reduceValidationAttempt(once, { type: "define_activation", eventId: "evt-1", fields: { activationDefinition: "DIFFERENT" } }),
    (e) => e.code === "ERR_EVENT_ID_CONFLICT",
  );
});

test("payloadHash is order-independent (stable stringify) and `at` is part of the payload", () => {
  const h1 = payloadHashOf({ type: "x", fields: { a: 1, b: 2 } });
  const h2 = payloadHashOf({ type: "x", fields: { b: 2, a: 1 } });
  assert.equal(h1, h2);
  assert.notEqual(payloadHashOf({ type: "x", fields: { a: 1 } }), payloadHashOf({ type: "x", fields: { a: 2 } }));
  // stableStringify sorts keys
  assert.equal(stableStringify({ b: 1, a: 2 }), '{"a":2,"b":1}');
  assert.equal(stableStringify(undefined), "null");
});

// ── 6.8: blocked/carried suspend + resume ──────────────────────────────────────
test("block then unblock returns to the saved resumeState", () => {
  const a = attemptInStatus("needs_alternative");
  const blocked = step(a, "block", { blockerReason: "후보 막힘", nextUnblockAction: "지인 목록화" });
  assert.equal(blocked.status, "blocked");
  assert.equal(blocked.resumeState, "needs_alternative");
  const resumed = step(blocked, "unblock", {});
  assert.equal(resumed.status, "needs_alternative");
  assert.equal(resumed.resumeState, "");
});

test("carry then resume returns to the saved resumeState", () => {
  const a = attemptInStatus("needs_action_contract");
  const carried = step(a, "carry", { carryReason: "내일 이어서" });
  assert.equal(carried.status, "carried");
  assert.equal(carried.resumeState, "needs_action_contract");
  const resumed = step(carried, "resume", {});
  assert.equal(resumed.status, "needs_action_contract");
});

test("unblock from a state with no saved resumeState throws (cannot fabricate)", () => {
  // Manually craft a blocked attempt with no resumeState (defensive).
  const bogus = { ...createValidationAttempt({ id: "z" }), status: "blocked", resumeState: "" };
  assert.throws(
    () => reduceValidationAttempt(bogus, { type: "unblock", eventId: "u1", fields: {} }),
    (e) => e.code === "ERR_NO_RESUME_STATE",
  );
});

// ── 6.8: RESOLVED = terminal only; canStartNewAttempt ──────────────────────────
test("canStartNewAttempt: suspended (carried/blocked) is NOT resolved → false", () => {
  const open = createValidationAttempt({ id: "a1" }); // active
  assert.equal(canStartNewAttempt([open]), false);
  const carried = step(open, "carry", { carryReason: "오늘 막힘" });
  assert.equal(canStartNewAttempt([carried]), false); // CHANGED contract: carried is suspended
  const blocked = step(createValidationAttempt({ id: "b" }), "block", { blockerReason: "r", nextUnblockAction: "n" });
  assert.equal(canStartNewAttempt([blocked]), false);
  // terminal succeeded/failed ARE resolved
  const succeeded = step(scheduledAttempt(), "record_goal_proof", { evidence: { kind: "payment" } });
  assert.equal(canStartNewAttempt([succeeded]), true);
  const failed = step(createValidationAttempt({ id: "c" }), "abandon_attempt", { abandonReason: "중단" });
  assert.equal(canStartNewAttempt([failed]), true);
  assert.equal(canStartNewAttempt([succeeded, carried]), false); // any unresolved blocks
});

// ── nextCardType: 6-step advance then "" at execution_scheduled ─────────────────
test("nextCardType advances through the six gather states in order, then '' at execution_scheduled", () => {
  let a = createValidationAttempt({ id: "a" });
  const expected = [
    ["needs_definition", "activation_definition", "define_activation", { activationDefinition: "x" }],
    ["needs_candidate", "candidate_selection", "select_candidate", { candidate: "y" }],
    ["needs_alternative", "current_alternative", "record_alternative", { currentAlternative: "z" }],
    ["needs_action_contract", "action_request", "define_action_contract", { externalAction: "a", attemptThreshold: "1", successCondition: "b" }],
    ["needs_evidence_contract", "evidence_contract", "define_evidence_contract", { expectedProofKind: "dm_sent_screenshot", evidenceLocation: "l" }],
    ["needs_commitment", "commitment", "schedule_execution", { dueAt: "2026-06-24T18:00:00Z" }],
  ];
  for (const [status, card, type, fields] of expected) {
    assert.equal(a.status, status);
    assert.equal(nextCardType(a), card);
    a = step(a, type, fields);
  }
  assert.equal(a.status, "execution_scheduled");
  assert.equal(nextCardType(a), ""); // WAIT → no card
});

test("nextCardType returns '' for wait/terminal/suspended states", () => {
  assert.equal(nextCardType(scheduledAttempt()), "");
  assert.equal(nextCardType(awaitingAttempt()), "");
  assert.equal(nextCardType(attemptInStatus("blocked")), "");
  assert.equal(nextCardType(attemptInStatus("carried")), "");
  assert.equal(nextCardType(attemptInStatus("succeeded")), "");
  assert.equal(nextCardType(attemptInStatus("failed")), "");
});

// ── 6.11: nextAttemptAction typed union per state + unmapped throw ──────────────
test("nextAttemptAction returns the typed union for each reachable state", () => {
  assert.deepEqual(nextAttemptAction(createValidationAttempt({ id: "a" })), { kind: "card", cardType: "activation_definition" });
  assert.deepEqual(nextAttemptAction(attemptInStatus("needs_commitment")), { kind: "card", cardType: "commitment" });
  assert.deepEqual(nextAttemptAction(scheduledAttempt()), { kind: "wait", reason: "action" });
  assert.deepEqual(nextAttemptAction(awaitingAttempt()), { kind: "wait", reason: "customer_outcome" });
  assert.deepEqual(nextAttemptAction(outcomeObservedAttempt()), { kind: "wait", reason: "goal" });
  assert.deepEqual(nextAttemptAction(attemptInStatus("succeeded")), { kind: "terminal", outcome: "succeeded" });
  assert.deepEqual(nextAttemptAction(attemptInStatus("failed")), { kind: "terminal", outcome: "failed" });

  const blocked = attemptInStatus("blocked");
  assert.deepEqual(nextAttemptAction(blocked), { kind: "blocked", blocker: { blockerReason: blocked.blockerReason, nextUnblockAction: blocked.nextUnblockAction } });
  const carried = attemptInStatus("carried");
  assert.deepEqual(nextAttemptAction(carried), { kind: "carried", carry: { carryReason: carried.carryReason } });
});

test("nextAttemptAction throws ERR_UNMAPPED_STATE for a malformed status", () => {
  const bogus = { ...createValidationAttempt({ id: "z" }), status: "weird_state" };
  assert.throws(
    () => nextAttemptAction(bogus),
    (e) => e instanceof ValidationAttemptTransitionError && e.code === "ERR_UNMAPPED_STATE",
  );
  // every real state is mapped (no throw)
  for (const status of VALIDATION_ATTEMPT_STATES) {
    assert.doesNotThrow(() => nextAttemptAction(attemptInStatus(status)), `state ${status} must be mapped`);
  }
});

// ── missingFields determinism ──────────────────────────────────────────────────
test("missingFields is deterministic across a simulated resume", () => {
  const a = attemptInStatus("needs_action_contract");
  assert.equal(nextCardType(a), nextCardType(structuredClone(a)));
  assert.deepEqual(
    missingFields(a).sort(),
    ["attemptThreshold", "externalAction", "successCondition"].sort(),
  );
  assert.deepEqual(missingFields(scheduledAttempt()), []); // no card → no missing fields
});

// ── isAcceptableDay1Close ──────────────────────────────────────────────────────
test("isAcceptableDay1Close: plan-only false; scheduled/action-proof/blocked/carried true", () => {
  // plan-only gather states → false
  for (const s of VALIDATION_ATTEMPT_ACTIVE_STATES) {
    assert.equal(isAcceptableDay1Close(attemptInStatus(s)), false, `gather ${s} must not close`);
  }
  // execution_scheduled WITH dueAt → true (timeboxed lease)
  assert.equal(isAcceptableDay1Close(scheduledAttempt()), true);
  // execution_scheduled WITHOUT dueAt → false (defensive)
  assert.equal(isAcceptableDay1Close({ ...scheduledAttempt(), dueAt: "" }), false);
  // action proof attached → true
  assert.equal(isAcceptableDay1Close(awaitingAttempt()), true);
  // blocked with reason + next action → true
  assert.equal(isAcceptableDay1Close(attemptInStatus("blocked")), true);
  // carried with reason → true
  assert.equal(isAcceptableDay1Close(attemptInStatus("carried")), true);
  // null → false
  assert.equal(isAcceptableDay1Close(null), false);
});

// ── 6.12: migration ────────────────────────────────────────────────────────────
test("migration: complete legacy turns advance through the recoverable gather slots, tagged unverified", () => {
  const turns = [
    { signalId: "get_users_active_user_definition", responseText: "첫 명상 완료" },
    { signalId: "office_hours_get_users_first_candidate", responseText: "김OO" },
    { signalId: "get_users_current_alternative", responseText: "유튜브" },
    { signalId: "get_users_today_request", responseText: "카톡으로 권유" },
    { signalId: "get_users_evidence_format", responseText: "캡처" },
    { signalId: "get_users_day1_commitment", responseText: "오늘 저녁" },
  ];
  const a = buildValidationAttemptFromTurns(turns, { id: "mig1", createdAt: "2026-06-01T00:00:00Z" });
  // Recovered the three clean slots + externalAction; stopped before fabricating contract fields.
  assert.equal(a.activationDefinition, "첫 명상 완료");
  assert.equal(a.candidate, "김OO");
  assert.equal(a.currentAlternative, "유튜브");
  assert.equal(a.externalAction, "카톡으로 권유");
  // Never fabricated dueAt / attemptThreshold / successCondition.
  assert.equal(a.dueAt, "");
  assert.equal(a.attemptThreshold, "");
  assert.equal(a.successCondition, "");
  // Did NOT advance into WAIT — execution unverified.
  assert.equal(a.status, "needs_action_contract");
  assert.equal(a.migrationDisposition, LEGACY_MIGRATION_DISPOSITION_UNVERIFIED);
  // No fabricated evidence / appliedEvents reference only real migrate events.
  assert.equal(a.actionProof, null);
  assert.equal(a.evidence.length, 0);
});

test("migration: a short legacy log advances only as far as it cleanly can", () => {
  const turns = [
    { signalId: "get_users_active_user_definition", responseText: "A" },
    { signalId: "get_users_first_candidate", responseText: "B" },
  ];
  const a = buildValidationAttemptFromTurns(turns, { id: "mig2" });
  assert.equal(a.status, "needs_alternative");
  assert.equal(a.candidate, "B");
  assert.equal(a.migrationDisposition, undefined); // not yet at the unverified action slot
});

test("migration is fail-closed: ambiguity throws ERR_MIGRATION_AMBIGUOUS, no fabrication", () => {
  // conflicting answers for the same slot
  assert.throws(
    () => buildValidationAttemptFromTurns([
      { signalId: "get_users_active_user_definition", responseText: "A" },
      { signalId: "get_users_active_user_definition", responseText: "B" },
    ], { id: "m" }),
    (e) => e instanceof ValidationAttemptMigrationError && e.code === "ERR_MIGRATION_AMBIGUOUS",
  );
  // prefixed + bare alias of the same slot disagreeing
  assert.throws(
    () => buildValidationAttemptFromTurns([
      { signalId: "get_users_first_candidate", responseText: "X" },
      { signalId: "office_hours_get_users_first_candidate", responseText: "Y" },
    ], { id: "m" }),
    (e) => e.code === "ERR_MIGRATION_AMBIGUOUS",
  );
  // downstream slot present while an upstream slot is missing (gap)
  assert.throws(
    () => buildValidationAttemptFromTurns([
      { signalId: "get_users_active_user_definition", responseText: "A" },
      { signalId: "get_users_current_alternative", responseText: "C" }, // skipped candidate
    ], { id: "m" }),
    (e) => e.code === "ERR_MIGRATION_AMBIGUOUS",
  );
  // unrecognized signalId mixed into the ladder
  assert.throws(
    () => buildValidationAttemptFromTurns([
      { signalId: "get_users_active_user_definition", responseText: "A" },
      { signalId: "totally_unknown_signal", responseText: "??" },
    ], { id: "m" }),
    (e) => e.code === "ERR_MIGRATION_AMBIGUOUS",
  );
});

test("migration: identical duplicate answers are harmless (not ambiguous)", () => {
  const a = buildValidationAttemptFromTurns([
    { signalId: "get_users_active_user_definition", responseText: "same" },
    { signalId: "office_hours_get_users_active_user_definition", responseText: "same" },
    { signalId: "get_users_first_candidate", responseText: "김" },
  ], { id: "m" });
  assert.equal(a.activationDefinition, "same");
  assert.equal(a.status, "needs_alternative");
});

test("migration: empty turn list yields a fresh needs_definition attempt", () => {
  const a = buildValidationAttemptFromTurns([], { id: "m" });
  assert.equal(a.status, "needs_definition");
  assert.equal(a.migrationDisposition, undefined);
});

// ── Property: terminal/suspended states never transition back to active ─────────
test("property: no transition can move a TERMINAL attempt back to an active state", () => {
  for (const status of ["succeeded", "failed"]) {
    const a = attemptInStatus(status);
    for (const type of VALIDATION_ATTEMPT_TRANSITIONS) {
      const event = { type, eventId: `term-${status}-${type}`, fields: fieldsFor(type) };
      let next;
      try {
        next = reduceValidationAttempt(a, event);
      } catch {
        continue; // illegal — fine
      }
      assert.ok(
        !VALIDATION_ATTEMPT_ACTIVE_STATES.includes(next.status),
        `${status} → ${type} reached active ${next.status}`,
      );
    }
  }
});

// ── Determinism ────────────────────────────────────────────────────────────────
test("determinism: the same event sequence yields the same final attempt", () => {
  const seq = [
    { type: "define_activation", eventId: "e1", fields: { activationDefinition: "d" } },
    { type: "select_candidate", eventId: "e2", fields: { candidate: "c" } },
    { type: "record_alternative", eventId: "e3", fields: { currentAlternative: "alt" } },
    { type: "define_action_contract", eventId: "e4", fields: { externalAction: "act", attemptThreshold: "1", successCondition: "ok" } },
    { type: "define_evidence_contract", eventId: "e5", fields: { expectedProofKind: "dm_sent_screenshot", evidenceLocation: "loc" } },
    { type: "schedule_execution", eventId: "e6", fields: { dueAt: "2026-06-24T18:00:00Z" } },
    { type: "record_action_proof", eventId: "e7", fields: { evidence: { kind: "dm_sent_screenshot", ref: "r" } } },
  ];
  const run = () => {
    let a = createValidationAttempt({ id: "det", createdAt: "2026-06-24T00:00:00Z" });
    for (const ev of seq) a = reduceValidationAttempt(a, ev);
    return a;
  };
  const a = run();
  const b = run();
  assert.deepEqual(a, b);
  assert.equal(a.status, "awaiting_customer_outcome");
  assert.equal(a.appliedEvents.length, 7);
  assert.deepEqual(a.appliedTransitions, seq.map((e) => e.type));
});

// ── Stable ladder exports (the byte-stable, LIVE-validated interview slot ladder) ─
test("stable ladder exports resolve identically (unchanged contract)", () => {
  assert.deepEqual(GET_USERS_LADDER_SIGNAL_ORDER, [
    "get_users_active_user_definition",
    "get_users_first_candidate",
    "get_users_current_alternative",
    "get_users_today_request",
    "get_users_evidence_format",
    "get_users_day1_commitment",
  ]);
  assert.equal(canonicalLadderSignal("office_hours_get_users_first_candidate"), "get_users_first_candidate");
  assert.equal(canonicalLadderSignal("nope"), "");
  assert.equal(isGetUsersLadderSignal("get_users_today_request"), true);
  assert.equal(isGetUsersLadderSignal("nope"), false);
  assert.equal(nextLadderSignal([]), "get_users_active_user_definition");
  assert.equal(nextLadderSignal(["get_users_active_user_definition"]), "get_users_first_candidate");
  assert.equal(nextLadderSignal(GET_USERS_LADDER_SIGNAL_ORDER), "");
});
