import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EVIDENCE_RECEIPT_PROTOCOL,
  EVIDENCE_RECEIPT_ORIGINS,
  MAX_GRADE_BY_TRUST_TIER,
  REJECTED_REF_SCHEMES,
  trustTierForOrigin,
  maxGradeForTrustTier,
  isRejectedRefScheme,
  signEvidenceReceipt,
  verifyEvidenceReceipt,
  receiptSupportsGrade,
} from "../sidecar/office-hours-evidence-receipt.mjs";

const SECRET = "test-host-ingress-secret-0xABCDEF";
const NOW = "2026-06-25T11:00:00.000Z";

function baseFields(overrides = {}) {
  return {
    artifactId: "art_abc123",
    attemptId: "att_xyz789",
    actor: "session_oct_1",
    sha256: "a".repeat(64),
    byteLength: 18234,
    mediaType: "image/png",
    origin: "swift_upload",
    ingestedAt: "2026-06-25T10:59:30.000Z",
    verifiedClaims: ["bytes_hashed", "bound_to_attempt"],
    ...overrides,
  };
}

test("origin → trust tier mapping is total over the allowlist; unknown origin = null", () => {
  assert.equal(trustTierForOrigin("swift_upload"), "artifact_backed");
  assert.equal(trustTierForOrigin("url_snapshot"), "artifact_backed");
  assert.equal(trustTierForOrigin("recipient_callback"), "recipient_confirmed");
  assert.equal(trustTierForOrigin("provider_event"), "provider_confirmed");
  assert.equal(trustTierForOrigin("totally_made_up"), null);
  assert.equal(trustTierForOrigin(""), null);
});

test("trust-tier grade ceilings: artifact<customer<goal; unknown tier = null", () => {
  assert.equal(maxGradeForTrustTier("artifact_backed"), "action_proof");
  assert.equal(maxGradeForTrustTier("recipient_confirmed"), "customer_outcome");
  assert.equal(maxGradeForTrustTier("provider_confirmed"), "goal_proof");
  assert.equal(maxGradeForTrustTier("nonsense"), null);
});

test("rejected ref schemes: sim:// file:// data:// blob:// (case-insensitive)", () => {
  assert.equal(isRejectedRefScheme("sim://day1/payment.png"), true);
  assert.equal(isRejectedRefScheme("FILE:///etc/passwd"), true);
  assert.equal(isRejectedRefScheme("data:image/png;base64,AAAA"), true);
  assert.equal(isRejectedRefScheme("https://example.com/a.png"), false);
  assert.equal(isRejectedRefScheme(""), false);
  // every documented scheme is covered
  for (const scheme of REJECTED_REF_SCHEMES) {
    assert.equal(isRejectedRefScheme(`${scheme}whatever`), true);
  }
});

test("sign → verify round-trips and the receipt carries protocol 2 + verifier version", () => {
  const receipt = signEvidenceReceipt(baseFields(), SECRET);
  assert.equal(receipt.protocol, EVIDENCE_RECEIPT_PROTOCOL);
  assert.equal(typeof receipt.signature, "string");
  assert.ok(receipt.signature.length > 0);
  const v = verifyEvidenceReceipt(receipt, { secret: SECRET, attemptId: "att_xyz789", actor: "session_oct_1", now: NOW });
  assert.equal(v.ok, true);
  assert.equal(v.trustTier, "artifact_backed");
  assert.equal(v.maxGrade, "action_proof");
  assert.equal(v.evidence.sha256, "a".repeat(64));
});

test("signing fails closed on missing secret / missing field / bad origin", () => {
  assert.throws(() => signEvidenceReceipt(baseFields(), ""), /host ingress secret/);
  assert.throws(() => signEvidenceReceipt(baseFields({ sha256: "" }), SECRET), /missing required field "sha256"/);
  assert.throws(() => signEvidenceReceipt(baseFields({ origin: "evil_origin" }), SECRET), /not an allowlisted ingress origin/);
});

test("verify fails closed: tampered field breaks the signature", () => {
  const receipt = signEvidenceReceipt(baseFields(), SECRET);
  const tampered = { ...receipt, byteLength: 999999 }; // change a signed field
  const v = verifyEvidenceReceipt(tampered, { secret: SECRET, now: NOW });
  assert.equal(v.ok, false);
  assert.equal(v.rejection, "bad_signature");
});

test("verify fails closed: wrong secret, wrong attempt, wrong actor", () => {
  const receipt = signEvidenceReceipt(baseFields(), SECRET);
  assert.equal(verifyEvidenceReceipt(receipt, { secret: "other-secret", now: NOW }).rejection, "bad_signature");
  assert.equal(
    verifyEvidenceReceipt(receipt, { secret: SECRET, attemptId: "att_DIFFERENT", now: NOW }).rejection,
    "attempt_binding_mismatch",
  );
  assert.equal(
    verifyEvidenceReceipt(receipt, { secret: SECRET, actor: "someone_else", now: NOW }).rejection,
    "actor_binding_mismatch",
  );
});

test("verify fails closed: expired receipt and future-dated receipt", () => {
  const old = signEvidenceReceipt(baseFields({ ingestedAt: "2026-06-01T00:00:00.000Z" }), SECRET);
  assert.equal(verifyEvidenceReceipt(old, { secret: SECRET, now: NOW }).rejection, "receipt_expired");
  const future = signEvidenceReceipt(baseFields({ ingestedAt: "2026-06-25T12:00:00.000Z" }), SECRET);
  assert.equal(verifyEvidenceReceipt(future, { secret: SECRET, now: NOW }).rejection, "ingested_in_future");
});

test("verify fails closed: empty artifact, unsupported protocol, malformed", () => {
  const empty = signEvidenceReceipt(baseFields({ byteLength: 0 }), SECRET);
  assert.equal(verifyEvidenceReceipt(empty, { secret: SECRET, now: NOW }).rejection, "empty_artifact");
  const receipt = signEvidenceReceipt(baseFields(), SECRET);
  // protocol is checked before the signature, so a downgraded protocol is rejected
  // as unsupported_protocol (not bad_signature) even though it also breaks the sig.
  assert.equal(verifyEvidenceReceipt({ ...receipt, protocol: 1 }, { secret: SECRET, now: NOW }).rejection, "unsupported_protocol");
  assert.equal(verifyEvidenceReceipt(null, { secret: SECRET, now: NOW }).rejection, "malformed_receipt");
  assert.equal(verifyEvidenceReceipt({ protocol: 2 }, { secret: SECRET, now: NOW }).rejection, "missing_signature");
});

test("client-declared kind is irrelevant — grade ceiling comes from the verified origin", () => {
  // A founder labels a screenshot as a payment (goal-grade) — origin is still a
  // founder upload, so the host caps it at action_proof. The label cannot escalate.
  const receipt = signEvidenceReceipt(baseFields({ verifiedClaims: ["bytes_hashed"] }), SECRET);
  const v = verifyEvidenceReceipt(receipt, { secret: SECRET, now: NOW });
  assert.equal(v.ok, true);
  assert.equal(v.maxGrade, "action_proof");
  // record_goal_proof needs goal_proof grade — an artifact_backed receipt cannot.
  assert.equal(receiptSupportsGrade(v.trustTier, "goal_proof").ok, false);
  assert.equal(receiptSupportsGrade(v.trustTier, "action_proof").ok, true);
});

test("receiptSupportsGrade enforces the trust-tier ladder", () => {
  assert.equal(receiptSupportsGrade("artifact_backed", "action_proof").ok, true);
  assert.equal(receiptSupportsGrade("artifact_backed", "customer_outcome").ok, false);
  assert.equal(receiptSupportsGrade("recipient_confirmed", "customer_outcome").ok, true);
  assert.equal(receiptSupportsGrade("recipient_confirmed", "goal_proof").ok, false);
  assert.equal(receiptSupportsGrade("provider_confirmed", "goal_proof").ok, true);
  assert.equal(receiptSupportsGrade("artifact_backed", "made_up_grade").ok, false);
  assert.equal(receiptSupportsGrade("made_up_tier", "action_proof").ok, false);
});

test("★INVARIANT: no trust tier can mint a payment/strong grade — that ladder is proof-ledger-only", () => {
  // The grade ceilings only ever produce action_proof | customer_outcome | goal_proof.
  // There is deliberately NO mapping to any payment/strong grade here, so an
  // office_hours_attempt receipt can never satisfy the strong-payment gate.
  const grades = Object.values(MAX_GRADE_BY_TRUST_TIER);
  for (const g of grades) {
    assert.ok(["action_proof", "customer_outcome", "goal_proof"].includes(g), `unexpected mintable grade: ${g}`);
    assert.doesNotMatch(g, /payment|strong/i);
  }
  // Every allowlisted origin lands in a non-payment tier.
  for (const tier of Object.values(EVIDENCE_RECEIPT_ORIGINS)) {
    assert.doesNotMatch(String(maxGradeForTrustTier(tier)), /payment|strong/i);
  }
});
