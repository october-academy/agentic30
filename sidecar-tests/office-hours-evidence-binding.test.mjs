// deriveEvidenceContractId must be deterministic, content-bound (a superseded contract
// yields a new id), attempt-scoped (not a constant alias of attemptId), and fail-closed
// when the evidence contract is not yet defined.
import test from "node:test";
import assert from "node:assert/strict";

import { deriveEvidenceContractId, sha256Hex } from "../sidecar/office-hours-evidence-binding.mjs";

function attempt(over = {}) {
  return {
    id: "att_1",
    candidate: "AI로 많이 만들었지만 못 판 사람",
    candidateId: "cand_1",
    externalAction: "DM 발송",
    attemptThreshold: "3명",
    successCondition: "1명 결제",
    expectedProofKind: "payment",
    evidenceLocation: "스크린샷",
    ...over,
  };
}

test("deterministic for identical contract content", () => {
  assert.equal(deriveEvidenceContractId(attempt()), deriveEvidenceContractId(attempt()));
  assert.match(deriveEvidenceContractId(attempt()), /^ec_[0-9a-f]{64}$/);
});

test("content-bound: changing any contract field changes the id (supersede invalidation)", () => {
  const base = deriveEvidenceContractId(attempt());
  assert.notEqual(base, deriveEvidenceContractId(attempt({ expectedProofKind: "activation_event" })));
  assert.notEqual(base, deriveEvidenceContractId(attempt({ evidenceLocation: "Stripe 대시보드" })));
  assert.notEqual(base, deriveEvidenceContractId(attempt({ externalAction: "이메일 발송" })));
  assert.notEqual(base, deriveEvidenceContractId(attempt({ successCondition: "2명 결제" })));
});

test("attempt-scoped: same contract under a different attempt yields a different id", () => {
  assert.notEqual(deriveEvidenceContractId(attempt()), deriveEvidenceContractId(attempt({ id: "att_2" })));
});

test("fail-closed when the evidence contract is undefined", () => {
  assert.throws(() => deriveEvidenceContractId(attempt({ expectedProofKind: "" })));
  assert.throws(() => deriveEvidenceContractId(attempt({ evidenceLocation: "" })));
  assert.throws(() => deriveEvidenceContractId(attempt({ id: "" })));
  assert.throws(() => deriveEvidenceContractId(null));
});

test("sha256Hex is stable 64-hex", () => {
  assert.match(sha256Hex("hello"), /^[0-9a-f]{64}$/);
  assert.equal(sha256Hex("hello"), sha256Hex("hello"));
  assert.notEqual(sha256Hex("hello"), sha256Hex("world"));
});
