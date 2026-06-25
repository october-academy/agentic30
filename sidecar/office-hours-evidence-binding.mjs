// office-hours-evidence-binding.mjs — derive the receipt binding ids from DURABLE
// attempt authority (A′ Decision A, minimal-scope form).
//
// The receipt MACs an `evidenceContractId`. GPT-5.5 Pro rejected `evidenceContractId =
// attemptId` (a constant alias loses contract versioning) and recommended a host-minted
// id stored on the attempt via a new define_evidence_contract `requires` field. That
// reducer change breaks every existing caller that commits define_evidence_contract
// (seed helpers, gather submit, tests) — out of scope for the minimal action-rail.
//
// Instead this module DERIVES the id deterministically from the attempt projection's
// evidence-contract fields at BOTH sign-time (ingress) and verify-time (handler). It
// keeps every property GPT cared about WITHOUT touching the reducer:
//   - content-bound: a superseded contract (different fields) yields a DIFFERENT id, so
//     a receipt bound to the old contract no longer verifies (versioning).
//   - not a constant alias of attemptId: two attempts with identical contracts still
//     differ because attemptId is mixed in; one attempt's contract has exactly one id.
//   - read from durable authority (the projected attempt), never from a prompt string
//     (the load-bearing-state lesson).
// Pure; crypto SHA-256 (NOT the contract's non-cryptographic payloadHashOf).

import { createHash } from "node:crypto";
import { stableStringify } from "./office-hours-contract.mjs";

const EVIDENCE_CONTRACT_DOMAIN = "agentic30.office_hours.evidence_contract.v1";

/**
 * Derive the stable evidenceContractId for an attempt whose evidence contract is
 * defined (status at/after needs_commitment). Throws if the attempt has no id or no
 * defined evidence contract — a receipt may not be bound to a contract that does not
 * exist yet (fail-closed).
 */
export function deriveEvidenceContractId(attempt) {
  const attemptId = String(attempt?.id || "").trim();
  if (!attemptId) {
    throw new Error("deriveEvidenceContractId: attempt.id is required");
  }
  const expectedProofKind = String(attempt?.expectedProofKind || "").trim();
  const evidenceLocation = String(attempt?.evidenceLocation || "").trim();
  if (!expectedProofKind || !evidenceLocation) {
    throw new Error("deriveEvidenceContractId: attempt has no defined evidence contract");
  }
  // The full action+evidence contract content. Any change to these via answer_superseded
  // re-derives a new id and invalidates receipts bound to the prior contract.
  const contract = {
    candidate: String(attempt?.candidate || ""),
    candidateId: String(attempt?.candidateId || ""),
    externalAction: String(attempt?.externalAction || ""),
    attemptThreshold: String(attempt?.attemptThreshold || ""),
    successCondition: String(attempt?.successCondition || ""),
    expectedProofKind,
    evidenceLocation,
  };
  const canonical = stableStringify(contract);
  const digest = createHash("sha256")
    .update(`${EVIDENCE_CONTRACT_DOMAIN}\0${attemptId}\0${canonical}`)
    .digest("hex");
  return `ec_${digest}`;
}

/** SHA-256 hex of an arbitrary string — the crypto digest used for receipt/command
 * binding (GPT: "비암호학적 payloadHashOf가 아니라 crypto SHA-256"). */
export function sha256Hex(input) {
  return createHash("sha256").update(String(input)).digest("hex");
}
