// Host-owned evidence-receipt VERIFIER — the "verifier authority" from the GPT-5.5
// Pro architecture verdict (A′, C4). Today the office-hours evidence handler trusts a
// self-attested `kind` and a non-empty `ref` and never dereferences the artifact, so
// a `sim://day1/payment.png` clears the attempt-evidence grade like a real screenshot.
// This module makes the HOST the sole authority on artifact existence/provenance/claim
// — the four-authority rule: host owns protocol, model proposes, user owns commitments,
// VERIFIER owns evidence.
//
// PROTOCOL v3 (v2 was never wired; there is NO v2 fallback — GPT-5.5 Pro review). v2
// had P0 holes this version closes: freshness-fail-open, hex-suffix signature
// truncation, unsigned extension fields, optional binding, and trust-tier confused
// with verified proposition.
//
// SHAPE: a receipt is an OPAQUE TOKEN string `v3.<b64url(canonicalPayload)>.<b64url(mac)>`
// — NOT an extensible object — so no unsigned field can ride alongside the MAC. The
// ingress (Swift shell → host) signs; the handler verifies and derives the canonical
// evidence class HOST-side, ignoring any client-declared kind/grade. PURE + deterministic
// (node:crypto only; no fs, no network).
//
// ★Load-bearing invariant (tested, must never regress): no origin/tier/claim maps to a
// payment/strong grade. An office_hours_attempt receipt can NEVER mint a proof_ledger
// event or satisfy the strong-payment gate — that authority stays physically disjoint.

import { createHmac, timingSafeEqual } from "node:crypto";

export const EVIDENCE_RECEIPT_PROTOCOL = 3;
// Domain-separation prefix: MAC is over (DOMAIN || "\0" || canonicalPayload) so this
// key can never be confused with any other use of the same secret.
const MAC_DOMAIN = "agentic30.office_hours.evidence_receipt.v3";

// Origins the ingress may stamp → trust tier. Unknown origin = fail-closed reject.
// NOTE: proof-ledger events are deliberately NOT an origin here — the proof-ledger
// authority (strong payment) is physically and logically disjoint from receipt ingress.
export const EVIDENCE_RECEIPT_ORIGINS = Object.freeze({
  swift_upload: "artifact_backed",   // founder-uploaded bytes (hashed + bound). Founder-originated.
  url_snapshot: "artifact_backed",   // immutable host snapshot of a founder URL.
  recipient_callback: "recipient_confirmed", // one-time signed recipient response / inbound.
  provider_event: "provider_confirmed",      // first-party provider event (Gmail/Slack/Stripe/analytics).
});

export const EVIDENCE_TRUST_TIERS = Object.freeze(["artifact_backed", "recipient_confirmed", "provider_confirmed"]);

// MAX grade each tier may support (a CEILING — necessary, not sufficient; the verified
// CLAIM is the second gate). Matches the reducer grades action_proof<customer_outcome<
// goal_proof. Payment/strong is NOT in this ladder: minted ONLY by the proof ledger.
export const MAX_GRADE_BY_TRUST_TIER = Object.freeze({
  artifact_backed: "action_proof",
  recipient_confirmed: "customer_outcome",
  provider_confirmed: "goal_proof",
});

// CLOSED claim enum (host-minted only — NOT arbitrary ingress strings). A claim answers
// "which proposition was established"; a tier answers "who originated the observation".
// Both are required. Each claim is allowed only for certain origins.
export const EVIDENCE_CLAIMS = Object.freeze([
  "message.sent",
  "message.delivered",
  "recipient.replied",
  "recipient.declined",
  "customer.converted",
  "goal.metric_observed",
]);
export const CLAIMS_BY_ORIGIN = Object.freeze({
  swift_upload: Object.freeze(["message.sent"]),
  url_snapshot: Object.freeze(["message.sent", "message.delivered"]),
  recipient_callback: Object.freeze(["message.delivered", "recipient.replied", "recipient.declined"]),
  provider_event: Object.freeze(["message.delivered", "recipient.replied", "recipient.declined", "customer.converted", "goal.metric_observed"]),
});
// The grade a claim can support (claim → grade). Still capped by the tier ceiling.
export const GRADE_BY_CLAIM = Object.freeze({
  "message.sent": "action_proof",
  "message.delivered": "action_proof",
  "recipient.replied": "customer_outcome",
  "recipient.declined": "customer_outcome",
  "customer.converted": "goal_proof",
  "goal.metric_observed": "goal_proof",
});

// Ingress-only helper (the receipt itself carries NO ref): a synthetic/local pointer is
// never a verified artifact. Kept exported for the ingress URL parser; does no security
// work in the verifier because the receipt binds an immutable artifactId + sha256.
export const REJECTED_REF_SCHEMES = Object.freeze(["sim:", "file:", "data:", "blob:"]);
export function isRejectedRefScheme(ref = "") {
  const r = String(ref || "").trim().toLowerCase();
  return REJECTED_REF_SCHEMES.some((scheme) => r.startsWith(scheme));
}

const GRADE_RANK = Object.freeze({ action_proof: 1, customer_outcome: 2, goal_proof: 3 });
const HEX64 = /^[0-9a-f]{64}$/;
const ID_RE = /^[A-Za-z0-9._:-]{1,200}$/;
const MAX_TOKEN_BYTES = 8192; // DoS bound on token size.

function b64urlEncode(str) {
  return Buffer.from(str, "utf8").toString("base64url");
}
function b64urlDecodeToString(seg) {
  return Buffer.from(seg, "base64url").toString("utf8");
}

export function trustTierForOrigin(origin = "") {
  return Object.prototype.hasOwnProperty.call(EVIDENCE_RECEIPT_ORIGINS, origin) ? EVIDENCE_RECEIPT_ORIGINS[origin] : null;
}
export function maxGradeForTrustTier(trustTier = "") {
  return Object.prototype.hasOwnProperty.call(MAX_GRADE_BY_TRUST_TIER, trustTier) ? MAX_GRADE_BY_TRUST_TIER[trustTier] : null;
}

// Canonical, fixed-order serialization of the SIGNED fields. Deterministic for this
// module (issuer and verifier share it). Every field is normalized before MACing.
function canonicalPayload(p) {
  return JSON.stringify({
    protocol: EVIDENCE_RECEIPT_PROTOCOL,
    keyId: p.keyId,
    artifactId: p.artifactId,
    projectId: p.projectId,
    attemptId: p.attemptId,
    actorId: p.actorId,
    evidenceContractId: p.evidenceContractId,
    sha256: p.sha256,
    byteLength: p.byteLength,
    declaredMediaType: p.declaredMediaType,
    detectedMediaType: p.detectedMediaType,
    contentValidation: p.contentValidation,
    origin: p.origin,
    issuedAt: p.issuedAt,
    expiresAt: p.expiresAt,
    verifiedClaims: p.verifiedClaims,
  });
}

function macHex(secret, payloadStr) {
  // secret may be a string, Buffer, or KeyObject — pass through to createHmac as-is
  // (String()-coercing would corrupt binary key material).
  return createHmac("sha256", secret).update(`${MAC_DOMAIN}\0${payloadStr}`).digest("hex");
}

function isFiniteInt(n) {
  return Number.isInteger(n) && Number.isFinite(n);
}
function normClaims(claims, origin) {
  if (!Array.isArray(claims) || claims.length === 0) return null;
  const allowed = CLAIMS_BY_ORIGIN[origin] || [];
  const out = [];
  for (const c of claims) {
    const s = String(c || "").trim();
    if (!EVIDENCE_CLAIMS.includes(s)) return null;       // not in the closed enum
    if (!allowed.includes(s)) return null;                // not allowed for this origin
    if (!out.includes(s)) out.push(s);
  }
  return out.sort();
}

/**
 * Ingress-side: sign a receipt → an opaque token STRING. `secret` is the host ingress
 * key (string|Buffer|KeyObject); `keyId` selects it in the host keyring. Throws on any
 * invalid/missing field — fail-closed, no silent malformed token.
 */
export function signEvidenceReceipt(fields = {}, { secret, keyId } = {}) {
  if (secret == null || secret === "") throw new Error("signEvidenceReceipt requires a host ingress secret.");
  const kid = String(keyId || "").trim();
  if (!ID_RE.test(kid)) throw new Error("signEvidenceReceipt requires a valid keyId.");
  for (const f of ["artifactId", "projectId", "attemptId", "actorId", "evidenceContractId"]) {
    if (!ID_RE.test(String(fields[f] ?? "").trim())) throw new Error(`signEvidenceReceipt: invalid id field "${f}".`);
  }
  if (!HEX64.test(String(fields.sha256 ?? "").trim())) throw new Error("signEvidenceReceipt: sha256 must be 64 lowercase hex.");
  if (!(isFiniteInt(fields.byteLength) && fields.byteLength > 0)) throw new Error("signEvidenceReceipt: byteLength must be a positive integer.");
  if (!trustTierForOrigin(String(fields.origin ?? "").trim())) throw new Error(`signEvidenceReceipt: origin "${fields.origin}" not allowlisted.`);
  const issuedAtMs = Date.parse(String(fields.issuedAt ?? ""));
  const expiresAtMs = Date.parse(String(fields.expiresAt ?? ""));
  if (!Number.isFinite(issuedAtMs)) throw new Error("signEvidenceReceipt: issuedAt must be a valid timestamp.");
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= issuedAtMs) throw new Error("signEvidenceReceipt: expiresAt must be a valid timestamp after issuedAt.");
  const origin = String(fields.origin).trim();
  const claims = normClaims(fields.verifiedClaims, origin);
  if (!claims) throw new Error("signEvidenceReceipt: verifiedClaims must be a non-empty subset of the closed claim enum allowed for this origin.");
  const payload = {
    keyId: kid,
    artifactId: String(fields.artifactId).trim(),
    projectId: String(fields.projectId).trim(),
    attemptId: String(fields.attemptId).trim(),
    actorId: String(fields.actorId).trim(),
    evidenceContractId: String(fields.evidenceContractId).trim(),
    sha256: String(fields.sha256).trim(),
    byteLength: fields.byteLength,
    declaredMediaType: String(fields.declaredMediaType ?? "").slice(0, 128),
    detectedMediaType: String(fields.detectedMediaType ?? "").slice(0, 128),
    contentValidation: String(fields.contentValidation ?? "none").slice(0, 64),
    origin,
    issuedAt: new Date(issuedAtMs).toISOString(),
    expiresAt: new Date(expiresAtMs).toISOString(),
    verifiedClaims: claims,
  };
  const payloadStr = canonicalPayload(payload);
  const mac = macHex(secret, payloadStr);
  return `v3.${b64urlEncode(payloadStr)}.${b64urlEncode(mac)}`;
}

/**
 * Handler-side: verify an opaque receipt token. ALL binding context is MANDATORY — a
 * missing keyring/now/attemptId/actorId/projectId/evidenceContractId/maxAgeMs is host
 * MISCONFIG and throws (a wiring mistake must not silently disable a security check).
 * Returns { ok:true, trustTier, maxGrade, verifiedClaims, evidence } or { ok:false,
 * rejection }. The client-declared kind/grade is irrelevant; the grade ceiling is
 * derived host-side from the verified origin. NEVER mints proof_ledger/strong-payment.
 */
export function verifyEvidenceReceipt(token, {
  keyring,
  attemptId,
  actorId,
  projectId,
  evidenceContractId,
  now,
  maxAgeMs,
} = {}) {
  if (!keyring || typeof keyring !== "object") throw new Error("verifyEvidenceReceipt requires a host keyring.");
  for (const [name, val] of [["attemptId", attemptId], ["actorId", actorId], ["projectId", projectId], ["evidenceContractId", evidenceContractId]]) {
    if (!ID_RE.test(String(val ?? "").trim())) throw new Error(`verifyEvidenceReceipt: mandatory context "${name}" missing/invalid.`);
  }
  const nowMs = Date.parse(String(now ?? ""));
  if (!Number.isFinite(nowMs)) throw new Error("verifyEvidenceReceipt: a valid `now` timestamp is mandatory.");
  if (!(isFiniteInt(maxAgeMs) && maxAgeMs > 0)) throw new Error("verifyEvidenceReceipt: maxAgeMs must be a finite positive integer.");

  if (typeof token !== "string" || token.length === 0) return { ok: false, rejection: "malformed_token" };
  if (Buffer.byteLength(token, "utf8") > MAX_TOKEN_BYTES) return { ok: false, rejection: "token_too_large" };
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "v3") return { ok: false, rejection: "unsupported_protocol" };
  let payloadStr;
  let payload;
  try {
    payloadStr = b64urlDecodeToString(parts[1]);
    payload = JSON.parse(payloadStr);
  } catch { return { ok: false, rejection: "malformed_payload" }; }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return { ok: false, rejection: "malformed_payload" };

  const sig = parts[2];
  // Must be a canonical b64url of a 64-hex MAC; re-encode and compare to reject any
  // suffix/garbage that base64/hex decoders would silently truncate.
  let macHexStr;
  try { macHexStr = b64urlDecodeToString(sig); } catch { return { ok: false, rejection: "malformed_signature" }; }
  if (!HEX64.test(macHexStr) || b64urlEncode(macHexStr) !== sig) return { ok: false, rejection: "malformed_signature" };

  const kid = String(payload.keyId || "").trim();
  if (!ID_RE.test(kid)) return { ok: false, rejection: "malformed_payload" };
  const keyEntry = keyring[kid];
  if (!keyEntry || keyEntry.revoked === true || keyEntry.secret == null) return { ok: false, rejection: "unknown_or_revoked_key" };

  const expected = macHex(keyEntry.secret, payloadStr);
  const sigBuf = Buffer.from(macHexStr, "hex");
  const expBuf = Buffer.from(expected, "hex");
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) return { ok: false, rejection: "bad_signature" };

  // Signature valid → now enforce bindings + freshness + structure (all fail-closed).
  if (Number(payload.protocol) !== EVIDENCE_RECEIPT_PROTOCOL) return { ok: false, rejection: "unsupported_protocol" };
  if (String(payload.attemptId) !== String(attemptId).trim()) return { ok: false, rejection: "attempt_binding_mismatch" };
  if (String(payload.actorId) !== String(actorId).trim()) return { ok: false, rejection: "actor_binding_mismatch" };
  if (String(payload.projectId) !== String(projectId).trim()) return { ok: false, rejection: "project_binding_mismatch" };
  if (String(payload.evidenceContractId) !== String(evidenceContractId).trim()) return { ok: false, rejection: "evidence_contract_binding_mismatch" };

  const trustTier = trustTierForOrigin(String(payload.origin || "").trim());
  if (!trustTier) return { ok: false, rejection: "unknown_origin" };
  if (!HEX64.test(String(payload.sha256 || ""))) return { ok: false, rejection: "malformed_payload" };
  if (!(isFiniteInt(payload.byteLength) && payload.byteLength > 0)) return { ok: false, rejection: "empty_artifact" };
  const claims = normClaims(payload.verifiedClaims, String(payload.origin).trim());
  if (!claims) return { ok: false, rejection: "invalid_claims" };

  const issuedMs = Date.parse(String(payload.issuedAt || ""));
  const expiresMs = Date.parse(String(payload.expiresAt || ""));
  if (!Number.isFinite(issuedMs) || !Number.isFinite(expiresMs)) return { ok: false, rejection: "invalid_timestamps" };
  if (issuedMs > nowMs) return { ok: false, rejection: "issued_in_future" };
  if (nowMs >= expiresMs) return { ok: false, rejection: "receipt_expired" };
  if (nowMs - issuedMs > maxAgeMs) return { ok: false, rejection: "exceeds_host_max_lifetime" };

  return {
    ok: true,
    trustTier,
    maxGrade: maxGradeForTrustTier(trustTier),
    verifiedClaims: claims,
    evidence: {
      origin: payload.origin,
      trustTier,
      artifactId: String(payload.artifactId),
      sha256: String(payload.sha256),
      detectedMediaType: String(payload.detectedMediaType || ""),
      contentValidation: String(payload.contentValidation || "none"),
      issuedAt: payload.issuedAt,
    },
  };
}

/**
 * Sufficiency gate: does a VERIFIED receipt satisfy a transition's requirement? Needs
 * BOTH (a) requiredGrade <= the receipt's trust-tier ceiling AND (b) requiredClaim is in
 * the receipt's host-minted verifiedClaims AND (c) that claim itself supports the grade.
 * Provenance tier alone is NOT sufficient (a generic provider event can't mint goal
 * proof). Pure. `verified` is the success object from verifyEvidenceReceipt.
 */
export function receiptSatisfiesRequirement(verified, { requiredGrade, requiredClaim } = {}) {
  if (!verified || verified.ok !== true) return { ok: false, reason: "receipt_not_verified" };
  const needRank = GRADE_RANK[String(requiredGrade || "").trim()];
  const ceilRank = GRADE_RANK[String(verified.maxGrade || "").trim()];
  if (!needRank) return { ok: false, reason: `unknown_required_grade:${requiredGrade || "(none)"}` };
  if (!ceilRank) return { ok: false, reason: `unknown_trust_tier_ceiling` };
  if (needRank > ceilRank) return { ok: false, reason: `tier_${verified.trustTier}_caps_at_${verified.maxGrade}_below_${requiredGrade}` };
  const claim = String(requiredClaim || "").trim();
  if (!EVIDENCE_CLAIMS.includes(claim)) return { ok: false, reason: `unknown_required_claim:${claim || "(none)"}` };
  if (!Array.isArray(verified.verifiedClaims) || !verified.verifiedClaims.includes(claim)) {
    return { ok: false, reason: `required_claim_${claim}_not_verified` };
  }
  const claimGradeRank = GRADE_RANK[GRADE_BY_CLAIM[claim]];
  if (!(claimGradeRank >= needRank)) return { ok: false, reason: `claim_${claim}_supports_${GRADE_BY_CLAIM[claim]}_below_${requiredGrade}` };
  return { ok: true, reason: "" };
}
