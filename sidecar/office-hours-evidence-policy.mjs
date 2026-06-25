// office-hours-evidence-policy.mjs — the SINGLE acceptance-policy source for the A′
// receipt cutover (GPT-5.5 Pro build-sequence step 1: "Acceptance policy를 먼저
// 고정한다. … handler, ingress, Swift가 각각 별도 map을 가지면 안 된다.").
//
// One graded attempt-evidence transition maps to:
//   - requiredGrade : the reducer evidenceGrade the transition demands (the
//                     contract is still the grading AUTHORITY; this MIRRORS it).
//   - claimsAnyOf   : the verified receipt CLAIMS that satisfy the transition.
//                     ANY-OF — a goal proof is satisfied by `customer.converted`
//                     OR `goal.metric_observed`; the host selects exactly one.
//   - canonicalKind : the HOST-minted reducer kind derived from a verified claim.
//                     The client-declared kind is irrelevant after the cutover —
//                     the host translates a verified claim to this canonical kind
//                     so the existing reducer (which grades by kind) re-grades it
//                     to the SAME requiredGrade. This is the small, additive bridge
//                     GPT-5.5 Pro preferred over making the reducer receipt-aware.
//
// ★Load-time invariant (fail-closed at import): for every transition the canonical
//   kind's contract grade === requiredGrade, the kind is legal for the transition,
//   and every claimsAnyOf claim can support the grade. A future edit that breaks the
//   contract↔receipt↔policy agreement throws here instead of silently mis-grading.
//
// PURE: data + lookups only. No I/O. Importing the contract + receipt enums is what
// makes this the reconciliation point between the two grade ladders.

import {
  EVIDENCE_GRADES,
  EVIDENCE_KIND_GRADE,
  NEGATIVE_OUTCOME_KINDS,
} from "./office-hours-contract.mjs";
import {
  EVIDENCE_CLAIMS,
  GRADE_BY_CLAIM,
} from "./office-hours-evidence-receipt.mjs";

// Rank so "does this claim/kind support at least the required grade" is a comparison.
const GRADE_RANK = Object.freeze({ action_proof: 1, customer_outcome: 2, goal_proof: 3 });

// The four GRADED attempt-evidence transitions (1:1 with the reducer's
// evidenceGrade-bearing transitions). expire_no_response / abandon_attempt carry no
// evidence record and are intentionally NOT here.
export const ATTEMPT_EVIDENCE_POLICY = Object.freeze({
  record_action_proof: Object.freeze({
    requiredGrade: "action_proof",
    claimsAnyOf: Object.freeze(["message.sent", "message.delivered"]),
    canonicalKind: "message_log",
  }),
  record_customer_outcome: Object.freeze({
    requiredGrade: "customer_outcome",
    claimsAnyOf: Object.freeze(["recipient.replied"]),
    canonicalKind: "customer_reply",
  }),
  record_negative_outcome: Object.freeze({
    requiredGrade: "customer_outcome",
    claimsAnyOf: Object.freeze(["recipient.declined"]),
    canonicalKind: "refusal",
  }),
  record_goal_proof: Object.freeze({
    requiredGrade: "goal_proof",
    claimsAnyOf: Object.freeze(["customer.converted", "goal.metric_observed"]),
    canonicalKind: "activation_event",
  }),
});

export const GRADED_ATTEMPT_EVIDENCE_TRANSITIONS = Object.freeze(
  new Set(Object.keys(ATTEMPT_EVIDENCE_POLICY)),
);

/** Policy for a graded transition, or null for a non-graded / unknown transition. */
export function policyForTransition(transition = "") {
  const key = String(transition || "").trim();
  return Object.prototype.hasOwnProperty.call(ATTEMPT_EVIDENCE_POLICY, key)
    ? ATTEMPT_EVIDENCE_POLICY[key]
    : null;
}

// ── Load-time consistency invariant (fail-closed) ─────────────────────────────
// This is the whole point of centralizing the policy: a single place where the
// contract grade ladder and the receipt claim ladder are proven to agree.
for (const [transition, policy] of Object.entries(ATTEMPT_EVIDENCE_POLICY)) {
  const needRank = GRADE_RANK[policy.requiredGrade];
  if (!EVIDENCE_GRADES.includes(policy.requiredGrade) || !needRank) {
    throw new Error(
      `office-hours-evidence-policy: ${transition} has invalid requiredGrade "${policy.requiredGrade}".`,
    );
  }
  // The host-minted canonical kind must re-grade (via the reducer's kind→grade map)
  // to EXACTLY the required grade — else translating a verified claim to this kind
  // would let the reducer assign a different grade than the transition demands.
  if (EVIDENCE_KIND_GRADE[policy.canonicalKind] !== policy.requiredGrade) {
    throw new Error(
      `office-hours-evidence-policy: ${transition} canonicalKind "${policy.canonicalKind}" grades to ` +
        `"${EVIDENCE_KIND_GRADE[policy.canonicalKind] || "(none)"}", not requiredGrade "${policy.requiredGrade}".`,
    );
  }
  // Negative outcome is the one transition the reducer additionally restricts by
  // kind membership; the canonical kind must be an allowed negative kind.
  if (transition === "record_negative_outcome" && !NEGATIVE_OUTCOME_KINDS.has(policy.canonicalKind)) {
    throw new Error(
      `office-hours-evidence-policy: record_negative_outcome canonicalKind "${policy.canonicalKind}" ` +
        `is not a NEGATIVE_OUTCOME_KIND.`,
    );
  }
  if (!Array.isArray(policy.claimsAnyOf) || policy.claimsAnyOf.length === 0) {
    throw new Error(`office-hours-evidence-policy: ${transition} has empty claimsAnyOf.`);
  }
  for (const claim of policy.claimsAnyOf) {
    if (!EVIDENCE_CLAIMS.includes(claim)) {
      throw new Error(`office-hours-evidence-policy: ${transition} claim "${claim}" is not in the receipt claim enum.`);
    }
    const claimRank = GRADE_RANK[GRADE_BY_CLAIM[claim]];
    if (!(claimRank >= needRank)) {
      throw new Error(
        `office-hours-evidence-policy: ${transition} claim "${claim}" supports "${GRADE_BY_CLAIM[claim] || "(none)"}", ` +
          `below requiredGrade "${policy.requiredGrade}".`,
      );
    }
  }
}
