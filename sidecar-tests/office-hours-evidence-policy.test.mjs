// The single acceptance-policy source must (a) import without throwing — its
// load-time invariant proves the contract grade ladder and the receipt claim ladder
// agree — and (b) expose exactly the four graded transitions with self-consistent
// requiredGrade / claimsAnyOf / canonicalKind. If any later edit drifts the contract
// kind→grade map, the receipt claim→grade map, or this policy out of agreement, the
// module import (and therefore this test) fails closed.
import test from "node:test";
import assert from "node:assert/strict";

import {
  ATTEMPT_EVIDENCE_POLICY,
  GRADED_ATTEMPT_EVIDENCE_TRANSITIONS,
  policyForTransition,
} from "../sidecar/office-hours-evidence-policy.mjs";
import { EVIDENCE_KIND_GRADE, NEGATIVE_OUTCOME_KINDS } from "../sidecar/office-hours-contract.mjs";
import { EVIDENCE_CLAIMS, GRADE_BY_CLAIM } from "../sidecar/office-hours-evidence-receipt.mjs";

test("policy covers exactly the four graded transitions", () => {
  assert.deepEqual(
    [...GRADED_ATTEMPT_EVIDENCE_TRANSITIONS].sort(),
    ["record_action_proof", "record_customer_outcome", "record_goal_proof", "record_negative_outcome"].sort(),
  );
});

test("each transition's canonical kind re-grades (via the reducer kind map) to its requiredGrade", () => {
  for (const [transition, policy] of Object.entries(ATTEMPT_EVIDENCE_POLICY)) {
    assert.equal(
      EVIDENCE_KIND_GRADE[policy.canonicalKind],
      policy.requiredGrade,
      `${transition}: canonicalKind ${policy.canonicalKind} must grade to ${policy.requiredGrade}`,
    );
  }
});

test("each claimsAnyOf claim is a known receipt claim that supports the required grade", () => {
  const rank = { action_proof: 1, customer_outcome: 2, goal_proof: 3 };
  for (const [transition, policy] of Object.entries(ATTEMPT_EVIDENCE_POLICY)) {
    assert.ok(policy.claimsAnyOf.length > 0, `${transition} must list claims`);
    for (const claim of policy.claimsAnyOf) {
      assert.ok(EVIDENCE_CLAIMS.includes(claim), `${claim} must be a receipt claim`);
      assert.ok(
        rank[GRADE_BY_CLAIM[claim]] >= rank[policy.requiredGrade],
        `${transition}: ${claim} (${GRADE_BY_CLAIM[claim]}) must support ${policy.requiredGrade}`,
      );
    }
  }
});

test("record_negative_outcome canonical kind is an allowed negative kind", () => {
  assert.ok(NEGATIVE_OUTCOME_KINDS.has(ATTEMPT_EVIDENCE_POLICY.record_negative_outcome.canonicalKind));
});

test("policyForTransition returns null for non-graded / unknown transitions", () => {
  assert.equal(policyForTransition("abandon_attempt"), null);
  assert.equal(policyForTransition("expire_no_response"), null);
  assert.equal(policyForTransition("schedule_execution"), null);
  assert.equal(policyForTransition(""), null);
  assert.equal(policyForTransition("nonsense"), null);
});

test("policyForTransition returns the frozen policy for a graded transition", () => {
  const p = policyForTransition("record_action_proof");
  assert.equal(p.requiredGrade, "action_proof");
  assert.equal(p.canonicalKind, "message_log");
  assert.ok(p.claimsAnyOf.includes("message.sent"));
  assert.throws(() => { p.requiredGrade = "goal_proof"; }, "policy must be frozen");
});
