// office-hours-evidence-coordinator.mjs — the host-only coordinator that turns a SIGNED
// receipt token into the reducer evidence record for a graded attempt transition
// (A′ build-seq step 7). Extracted as a sibling of index.mjs per the repo's "don't split
// index.mjs, extract helpers into siblings" rule.
//
// It reads ALL binding context from DURABLE authority — the host identity store
// (installActorId + projectId) and the attempt projection (evidenceContractId derived
// from the contract content) — NEVER from the client payload or a prompt string (the
// load-bearing-state lesson). The client-declared kind/ref/claim are irrelevant: the
// host derives the canonical reducer kind from the VERIFIED claim via the single policy.
//
// This module does NOT consume the artifact or commit the attempt event — the caller
// owns that transaction ordering (dry-run → consume → commit) so the single-use gate and
// the attempt store stay under the caller's control. It only verifies + derives.

import { policyForTransition } from "./office-hours-evidence-policy.mjs";
import { deriveEvidenceContractId, sha256Hex } from "./office-hours-evidence-binding.mjs";
import { verifyEvidenceReceipt, receiptSatisfiesRequirement } from "./office-hours-evidence-receipt.mjs";
import { resolveHostIdentity, resolveEvidenceKeyring } from "./office-hours-host-identity.mjs";

// Host max lifetime for a receipt at verify time. Matches the ingress TTL ceiling: the
// minimal rail ingests + verifies inside one logical flow, so a receipt is minutes old.
export const RECEIPT_VERIFY_MAX_AGE_MS = 60 * 60 * 1000;

export class AttemptEvidenceError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "AttemptEvidenceError";
    this.code = code || "ERR_ATTEMPT_EVIDENCE";
  }
}

/**
 * Verify a receipt token for a graded transition and derive the host-minted reducer
 * evidence record. Throws AttemptEvidenceError on any failure (fail-closed; the caller
 * maps it to success:false and must NOT consume/commit).
 *
 * @returns { fields, evidenceContractId, evidenceIdentity, verified, selectedClaim }
 *   fields.evidence is the record handed to commitAttemptEvent (host-minted kind +
 *   artifact:// ref + signed capturedAt + full receipt provenance, which lives in
 *   fields.evidence — NOT audit — because the store's audit normalizer drops unknown
 *   keys while gradeEvidence spreads the evidence record, preserving the provenance).
 */
export async function prepareReceiptEvidence({
  workspaceRoot,
  attemptId,
  transition,
  projection,
  receiptToken,
  now,
} = {}) {
  const policy = policyForTransition(transition);
  if (!policy) {
    throw new AttemptEvidenceError(`transition ${transition} is not a graded receipt transition`, "ERR_NOT_GRADED");
  }
  const token = String(receiptToken || "").trim();
  if (!token) {
    // NO COMPAT: a graded transition with no receipt is refused. The legacy
    // self-attested {kind,ref} path is gone.
    throw new AttemptEvidenceError("receipt_required", "ERR_RECEIPT_REQUIRED");
  }
  if (!projection || typeof projection !== "object") {
    throw new AttemptEvidenceError("prepareReceiptEvidence requires the attempt projection", "ERR_NO_PROJECTION");
  }

  // Binding context from DURABLE authority — not the client.
  const { installActorId, projectId } = await resolveHostIdentity({ workspaceRoot });
  const evidenceContractId = deriveEvidenceContractId(projection);
  const { keyring } = await resolveEvidenceKeyring({ workspaceRoot });

  const verified = verifyEvidenceReceipt(token, {
    keyring,
    attemptId,
    actorId: installActorId,
    projectId,
    evidenceContractId,
    now,
    maxAgeMs: RECEIPT_VERIFY_MAX_AGE_MS,
  });
  if (!verified.ok) {
    throw new AttemptEvidenceError(`receipt_rejected:${verified.rejection}`, "ERR_RECEIPT_REJECTED");
  }

  // ANY-OF claim sufficiency: the transition is satisfied by any one of its policy
  // claims; pick the first (deterministic policy order) that the verified receipt
  // supports, and record exactly that one as selectedClaim.
  let selectedClaim = null;
  let lastReason = "";
  for (const claim of policy.claimsAnyOf) {
    const sat = receiptSatisfiesRequirement(verified, { requiredGrade: policy.requiredGrade, requiredClaim: claim });
    if (sat.ok) {
      selectedClaim = claim;
      break;
    }
    lastReason = sat.reason || lastReason;
  }
  if (!selectedClaim) {
    throw new AttemptEvidenceError(
      `receipt_insufficient_for_${transition}:${lastReason || "no_satisfying_claim"}`,
      "ERR_RECEIPT_INSUFFICIENT",
    );
  }

  const fields = {
    evidence: {
      // Host-minted reducer kind (the reducer re-grades this to policy.requiredGrade).
      kind: policy.canonicalKind,
      ref: `artifact://${verified.evidence.artifactId}`,
      capturedAt: verified.evidence.issuedAt, // host-stamped + signed; never client time
      source: "host_receipt_v3",
      // Provenance (additive; gradeEvidence spreads the record so these survive).
      verifiedClaim: selectedClaim,
      verifiedClaims: verified.verifiedClaims,
      origin: verified.evidence.origin,
      trustTier: verified.trustTier,
      artifactId: verified.evidence.artifactId,
      evidenceIdentity: verified.evidence.evidenceIdentity,
      sha256: verified.evidence.sha256,
      receiptDigest: sha256Hex(token),
    },
  };

  return {
    fields,
    evidenceContractId,
    evidenceIdentity: verified.evidence.evidenceIdentity,
    verified,
    selectedClaim,
  };
}
