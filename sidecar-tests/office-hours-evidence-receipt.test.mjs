import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EVIDENCE_RECEIPT_PROTOCOL,
  EVIDENCE_RECEIPT_ORIGINS,
  MAX_GRADE_BY_TRUST_TIER,
  EVIDENCE_CLAIMS,
  GRADE_BY_CLAIM,
  isRejectedRefScheme,
  trustTierForOrigin,
  maxGradeForTrustTier,
  signEvidenceReceipt,
  verifyEvidenceReceipt,
  receiptSatisfiesRequirement,
} from "../sidecar/office-hours-evidence-receipt.mjs";

const KEY_ID = "k1";
const SECRET = Buffer.from("0123456789abcdef0123456789abcdef"); // 32-byte binary key
const KEYRING = { k1: { secret: SECRET } };
const NOW = "2026-06-25T11:00:00.000Z";
const CTX = Object.freeze({
  keyring: KEYRING, attemptId: "att_1", actorId: "actor_1", projectId: "proj_1",
  evidenceContractId: "ec_1", now: NOW, maxAgeMs: 7 * 24 * 60 * 60 * 1000,
});

function fields(over = {}) {
  return {
    artifactId: "art_1", projectId: "proj_1", attemptId: "att_1", actorId: "actor_1", evidenceContractId: "ec_1",
    sha256: "a".repeat(64), byteLength: 1234,
    declaredMediaType: "image/png", detectedMediaType: "image/png", contentValidation: "image_decode_succeeded",
    origin: "swift_upload", issuedAt: "2026-06-25T10:59:30.000Z", expiresAt: "2026-06-25T11:59:30.000Z",
    verifiedClaims: ["message.sent"],
    ...over,
  };
}
const sign = (over = {}, signOpts = {}) => signEvidenceReceipt(fields(over), { secret: SECRET, keyId: KEY_ID, ...signOpts });
const verify = (token, over = {}) => verifyEvidenceReceipt(token, { ...CTX, ...over });

test("protocol is v3 and round-trips: opaque token sign → verify (Buffer key)", () => {
  assert.equal(EVIDENCE_RECEIPT_PROTOCOL, 3);
  const token = sign();
  assert.ok(token.startsWith("v3."), "token is the opaque v3 envelope");
  assert.equal(token.split(".").length, 3);
  const v = verify(token);
  assert.equal(v.ok, true);
  assert.equal(v.trustTier, "artifact_backed");
  assert.equal(v.maxGrade, "action_proof");
  assert.deepEqual(v.verifiedClaims, ["message.sent"]);
  assert.equal(v.evidence.sha256, "a".repeat(64));
  // the verified evidence NEVER carries a client sourceType/strength/kind.
  assert.equal(v.evidence.sourceType, undefined);
  assert.equal(v.evidence.strength, undefined);
});

test("mandatory verifier context throws (a wiring mistake must not disable a check)", () => {
  const token = sign();
  assert.throws(() => verifyEvidenceReceipt(token, { ...CTX, keyring: undefined }), /keyring/);
  assert.throws(() => verifyEvidenceReceipt(token, { ...CTX, now: "" }), /valid `now`/);
  assert.throws(() => verifyEvidenceReceipt(token, { ...CTX, now: "not-a-date" }), /valid `now`/);
  assert.throws(() => verifyEvidenceReceipt(token, { ...CTX, maxAgeMs: NaN }), /maxAgeMs/);
  assert.throws(() => verifyEvidenceReceipt(token, { ...CTX, maxAgeMs: Infinity }), /maxAgeMs/);
  for (const ctxKey of ["attemptId", "actorId", "projectId", "evidenceContractId"]) {
    assert.throws(() => verifyEvidenceReceipt(token, { ...CTX, [ctxKey]: "" }), new RegExp(ctxKey));
  }
});

test("P0 freshness is fail-CLOSED: expired / future / exceeds-host-lifetime", () => {
  // expired: now past expiresAt
  assert.equal(verify(sign({ issuedAt: "2026-06-25T09:00:00.000Z", expiresAt: "2026-06-25T10:00:00.000Z" })).rejection, "receipt_expired");
  // issued in the future
  assert.equal(verify(sign({ issuedAt: "2026-06-25T12:00:00.000Z", expiresAt: "2026-06-25T13:00:00.000Z" })).rejection, "issued_in_future");
  // within signed window but beyond host max-lifetime
  const longLived = sign({ issuedAt: "2026-06-25T10:59:00.000Z", expiresAt: "2026-12-31T00:00:00.000Z" });
  // 60s elapsed (10:59:00 → now 11:00:00) exceeds a 30s host max-lifetime cap.
  assert.equal(verify(longLived, { maxAgeMs: 30_000 }).rejection, "exceeds_host_max_lifetime");
  // signing rejects a non-future expiresAt outright
  assert.throws(() => sign({ issuedAt: "2026-06-25T10:00:00.000Z", expiresAt: "2026-06-25T10:00:00.000Z" }), /expiresAt/);
});

test("P0 signature: suffix garbage / tampered payload / wrong key all fail closed", () => {
  const token = sign();
  const [p0, p1, p2] = token.split(".");
  // append junk to the signature segment — must be rejected, not silently truncated.
  assert.equal(verify(`${p0}.${p1}.${p2}AA`).rejection, "malformed_signature");
  assert.equal(verify(`${p0}.${p1}.${p2}zz`).rejection, "malformed_signature");
  // tamper the payload segment (re-encode a mutated payload) → MAC mismatch.
  const mutated = JSON.parse(Buffer.from(p1, "base64url").toString("utf8"));
  mutated.byteLength = 999999;
  const tamperedPayload = Buffer.from(JSON.stringify(mutated), "utf8").toString("base64url");
  assert.equal(verify(`${p0}.${tamperedPayload}.${p2}`).rejection, "bad_signature");
  // wrong key in the keyring
  assert.equal(verify(token, { keyring: { k1: { secret: Buffer.from("xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx") } } }).rejection, "bad_signature");
  // unknown / revoked keyId
  assert.equal(verify(token, { keyring: {} }).rejection, "unknown_or_revoked_key");
  assert.equal(verify(token, { keyring: { k1: { secret: SECRET, revoked: true } } }).rejection, "unknown_or_revoked_key");
});

test("P0 no unsigned extension fields: an injected proof_ledger/strength can never ride along", () => {
  // Attempt to sneak privileged fields in at signing — canonicalPayload drops them, so
  // they are neither MACed nor returned.
  const token = sign({ sourceType: "proof_ledger", strength: "strong", kind: "goal_proof" });
  const v = verify(token);
  assert.equal(v.ok, true);
  assert.equal(JSON.stringify(v.evidence).includes("proof_ledger"), false);
  assert.equal(JSON.stringify(v).includes("strong"), false);
  assert.equal(v.maxGrade, "action_proof"); // origin still caps it
});

test("P0 bindings: wrong attempt / actor / project / evidenceContract each rejected", () => {
  const token = sign();
  assert.equal(verify(token, { attemptId: "att_OTHER" }).rejection, "attempt_binding_mismatch");
  assert.equal(verify(token, { actorId: "actor_OTHER" }).rejection, "actor_binding_mismatch");
  assert.equal(verify(token, { projectId: "proj_OTHER" }).rejection, "project_binding_mismatch");
  assert.equal(verify(token, { evidenceContractId: "ec_OTHER" }).rejection, "evidence_contract_binding_mismatch");
});

test("P0 tier ≠ claim: provenance alone is insufficient; the verified CLAIM gates the grade", () => {
  // artifact_backed + message.sent supports action_proof (with the matching claim)…
  const upload = verify(sign({ origin: "swift_upload", verifiedClaims: ["message.sent"] }));
  assert.equal(receiptSatisfiesRequirement(upload, { requiredGrade: "action_proof", requiredClaim: "message.sent" }).ok, true);
  // …but NOT customer_outcome or goal_proof (tier ceiling), nor a claim it didn't verify.
  assert.equal(receiptSatisfiesRequirement(upload, { requiredGrade: "goal_proof", requiredClaim: "goal.metric_observed" }).ok, false);
  assert.equal(receiptSatisfiesRequirement(upload, { requiredGrade: "customer_outcome", requiredClaim: "recipient.replied" }).ok, false);
  // a provider event that only confirms delivery cannot satisfy a goal-metric requirement.
  const delivered = verify(sign({ origin: "provider_event", verifiedClaims: ["message.delivered"] }));
  assert.equal(receiptSatisfiesRequirement(delivered, { requiredGrade: "goal_proof", requiredClaim: "goal.metric_observed" }).ok, false);
  // but a provider event that DID verify the goal metric does.
  const converted = verify(sign({ origin: "provider_event", verifiedClaims: ["goal.metric_observed"] }));
  assert.equal(receiptSatisfiesRequirement(converted, { requiredGrade: "goal_proof", requiredClaim: "goal.metric_observed" }).ok, true);
});

test("claims are a CLOSED enum, allowlisted per origin (no arbitrary ingress strings)", () => {
  // claim not in the enum → signing throws
  assert.throws(() => sign({ verifiedClaims: ["totally.made_up"] }), /verifiedClaims/);
  // claim not allowed for this origin (swift_upload can't claim recipient.replied) → throws
  assert.throws(() => sign({ origin: "swift_upload", verifiedClaims: ["recipient.replied"] }), /verifiedClaims/);
  // empty claims → throws
  assert.throws(() => sign({ verifiedClaims: [] }), /verifiedClaims/);
});

test("signing fails closed on bad ids / sha256 / byteLength / origin / missing key", () => {
  assert.throws(() => signEvidenceReceipt(fields(), { secret: SECRET, keyId: "" }), /keyId/);
  assert.throws(() => signEvidenceReceipt(fields(), { secret: "", keyId: KEY_ID }), /secret/);
  assert.throws(() => sign({ sha256: "nothex" }), /sha256/);
  assert.throws(() => sign({ byteLength: 0 }), /byteLength/);
  assert.throws(() => sign({ byteLength: 1.5 }), /byteLength/);
  assert.throws(() => sign({ origin: "evil_origin" }), /origin/);
  assert.throws(() => sign({ attemptId: "" }), /attemptId/);
});

test("malformed tokens rejected (not thrown): bad protocol, shape, oversized", () => {
  assert.equal(verify("v2.aaa.bbb").rejection, "unsupported_protocol");
  assert.equal(verify("garbage").rejection, "unsupported_protocol");
  assert.equal(verify("v3.@@@.bbb").rejection, "malformed_payload");
  assert.equal(verifyEvidenceReceipt("", CTX).rejection, "malformed_token");
  assert.equal(verify(`v3.${"a".repeat(9000)}.bbb`).rejection, "token_too_large");
});

test("origin/tier mapping + ingress ref-scheme helper", () => {
  assert.equal(trustTierForOrigin("swift_upload"), "artifact_backed");
  assert.equal(trustTierForOrigin("provider_event"), "provider_confirmed");
  assert.equal(trustTierForOrigin("unknown"), null);
  assert.equal(maxGradeForTrustTier("recipient_confirmed"), "customer_outcome");
  assert.equal(isRejectedRefScheme("sim://x"), true);
  assert.equal(isRejectedRefScheme("https://x"), false);
});

test("★INVARIANT: no origin / tier / claim maps to a payment or strong grade", () => {
  for (const g of Object.values(MAX_GRADE_BY_TRUST_TIER)) {
    assert.ok(["action_proof", "customer_outcome", "goal_proof"].includes(g));
    assert.doesNotMatch(g, /payment|strong/i);
  }
  for (const tier of Object.values(EVIDENCE_RECEIPT_ORIGINS)) {
    assert.doesNotMatch(String(maxGradeForTrustTier(tier)), /payment|strong/i);
  }
  for (const c of EVIDENCE_CLAIMS) {
    assert.doesNotMatch(c, /payment|strong/i);
    assert.ok(["action_proof", "customer_outcome", "goal_proof"].includes(GRADE_BY_CLAIM[c]));
  }
  // receiptSatisfiesRequirement can never be asked for, nor yield, a strong/payment grade.
  const v = verify(sign());
  assert.equal(receiptSatisfiesRequirement(v, { requiredGrade: "strong_payment", requiredClaim: "message.sent" }).ok, false);
});
