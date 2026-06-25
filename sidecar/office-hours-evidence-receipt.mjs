// Host-owned evidence-receipt VERIFIER — the "verifier authority" from the GPT-5.5
// Pro architecture verdict (A′, C4). Today the office-hours evidence handler trusts
// a self-attested `kind` label and a non-empty `ref` string and NEVER dereferences
// the artifact, so a `sim://day1/payment.png` clears the attempt-evidence grade
// identically to a real screenshot. This module makes the HOST the sole authority on
// "does an artifact exist, what is its provenance, and what evidence class does it
// support" — the four-authority rule: host owns protocol, model proposes, user owns
// commitments, VERIFIER owns evidence.
//
// PURE + deterministic (node:crypto only; no fs, no network). The Swift shell owns
// acquisition (it reads the file/image/URL bytes and POSTs them to a host-owned
// artifact ingress); the ingress computes the hash, snapshots mutable URLs, binds the
// receipt to ONE attempt + ONE actor, and SIGNS a receipt. The WebSocket evidence
// command then carries only the signed receipt token — never a raw local path. This
// module signs (ingress side) and verifies (handler side) those receipts and derives
// the canonical evidence class HOST-side, ignoring any client-declared `kind`.
//
// ★Load-bearing invariant (must never regress): this path can record an
// artifact-backed CLAIMED outcome, but it can NEVER mint a `proof_ledger` event or
// satisfy the strong-payment anti-gaming gate. Only the existing proof-ledger path
// does that. The canonical attempt evidence stays sourceType:"office_hours_attempt".

import { createHmac, timingSafeEqual } from "node:crypto";

export const EVIDENCE_RECEIPT_PROTOCOL = 2;
export const EVIDENCE_RECEIPT_VERIFIER_VERSION = "v2.0";

// Origins the ingress may stamp. Each maps to exactly one trust tier. An origin not
// in this table is rejected (fail-closed) — there is no "unknown origin → trust it".
export const EVIDENCE_RECEIPT_ORIGINS = Object.freeze({
  // Founder-supplied artifact (uploaded screenshot/file) or an immutable snapshot of
  // a founder-supplied URL. Strong-er than self-report (the bytes exist + are hashed
  // + bound), but still founder-originated — NOT independent ground truth.
  swift_upload: "artifact_backed",
  url_snapshot: "artifact_backed",
  // A one-time signed recipient callback / externally-originated inbound message:
  // a real non-founder participant produced an observed event.
  recipient_callback: "recipient_confirmed",
  // A first-party provider event (Gmail/Slack/Stripe/analytics/proof-ledger webhook)
  // confirms the behavior.
  provider_event: "provider_confirmed",
});

export const EVIDENCE_TRUST_TIERS = Object.freeze([
  "artifact_backed",
  "recipient_confirmed",
  "provider_confirmed",
]);

// The MAX evidence grade each trust tier may support. The three positive grades match
// the reducer's contract grades (gradeEvidence): action_proof < customer_outcome <
// goal_proof. An artifact the founder supplied proves an ACTION happened (execution),
// never that the customer responded or the goal passed — those require a recipient-
// or provider-confirmed receipt. Payment/strong-payment is NOT in this ladder: it is
// minted ONLY by the proof-ledger path, never here.
export const MAX_GRADE_BY_TRUST_TIER = Object.freeze({
  artifact_backed: "action_proof",
  recipient_confirmed: "customer_outcome",
  provider_confirmed: "goal_proof",
});

// Ref schemes that are categorically rejected in PRODUCTION: a synthetic/local
// pointer is not a verified artifact. The eval harness must instead register a
// fixture in a test artifact store and receive a real signed receipt marked with an
// eval metric-epoch — there is no env flag that makes `sim://` valid here.
export const REJECTED_REF_SCHEMES = Object.freeze(["sim:", "file:", "data:", "blob:"]);

const GRADE_RANK = Object.freeze({ action_proof: 1, customer_outcome: 2, goal_proof: 3 });

/** Canonical, stable serialization of the signed fields (signature excluded). */
function canonicalReceiptPayload(receipt) {
  return JSON.stringify({
    protocol: receipt.protocol,
    artifactId: receipt.artifactId,
    attemptId: receipt.attemptId,
    actor: receipt.actor,
    sha256: receipt.sha256,
    byteLength: receipt.byteLength,
    mediaType: receipt.mediaType,
    origin: receipt.origin,
    ingestedAt: receipt.ingestedAt,
    verifiedClaims: Array.isArray(receipt.verifiedClaims) ? [...receipt.verifiedClaims].sort() : [],
    verifierVersion: receipt.verifierVersion,
  });
}

/** Map an origin to its trust tier, or null when the origin is not allowlisted. */
export function trustTierForOrigin(origin = "") {
  return EVIDENCE_RECEIPT_ORIGINS[String(origin || "").trim()] || null;
}

/** The max evidence grade a trust tier may support (null for an unknown tier). */
export function maxGradeForTrustTier(trustTier = "") {
  return MAX_GRADE_BY_TRUST_TIER[String(trustTier || "").trim()] || null;
}

/** True iff `ref` uses a categorically-rejected scheme (sim://, file://, ...). */
export function isRejectedRefScheme(ref = "") {
  const r = String(ref || "").trim().toLowerCase();
  return REJECTED_REF_SCHEMES.some((scheme) => r.startsWith(scheme));
}

/**
 * Ingress-side: sign a receipt. Returns a NEW receipt object with `protocol`,
 * `verifierVersion`, and `signature` stamped. `secret` is the host ingress secret
 * (never logged, never sent to the model). Throws on a missing secret or required
 * field — fail-closed, no silent unsigned receipt.
 */
export function signEvidenceReceipt(fields = {}, secret = "") {
  const key = String(secret || "");
  if (!key) throw new Error("signEvidenceReceipt requires a host ingress secret.");
  for (const required of ["artifactId", "attemptId", "actor", "sha256", "byteLength", "mediaType", "origin", "ingestedAt"]) {
    if (fields[required] == null || String(fields[required]).trim() === "") {
      throw new Error(`signEvidenceReceipt: missing required field "${required}".`);
    }
  }
  if (!trustTierForOrigin(fields.origin)) {
    throw new Error(`signEvidenceReceipt: origin "${fields.origin}" is not an allowlisted ingress origin.`);
  }
  const receipt = {
    protocol: EVIDENCE_RECEIPT_PROTOCOL,
    artifactId: String(fields.artifactId),
    attemptId: String(fields.attemptId),
    actor: String(fields.actor),
    sha256: String(fields.sha256),
    byteLength: Number(fields.byteLength),
    mediaType: String(fields.mediaType),
    origin: String(fields.origin),
    ingestedAt: String(fields.ingestedAt),
    verifiedClaims: Array.isArray(fields.verifiedClaims) ? fields.verifiedClaims.map(String) : [],
    verifierVersion: EVIDENCE_RECEIPT_VERIFIER_VERSION,
  };
  receipt.signature = createHmac("sha256", key).update(canonicalReceiptPayload(receipt)).digest("hex");
  return receipt;
}

/**
 * Handler-side: verify a receipt and derive the canonical evidence class HOST-side.
 * Returns { ok:true, trustTier, maxGrade, evidence:{ origin, trustTier, artifactId,
 * sha256, mediaType, ingestedAt } } on success, or { ok:false, rejection:<code> } on
 * any failure. NEVER throws for a bad receipt (the bad-receipt path is a normal,
 * fail-closed rejection); throws only on a missing host secret (a host misconfig).
 *
 * Checks (all fail-closed): protocol == 2; signature matches (constant-time);
 * attemptId binds to the expected attempt; actor binds to the expected actor (when
 * given); not expired (ingestedAt within maxAgeMs of now); origin allowlisted. The
 * client-declared evidence `kind` is IGNORED — the grade ceiling is derived from the
 * verified origin's trust tier. This path can never mint proof_ledger/strong-payment.
 */
export function verifyEvidenceReceipt(receipt, {
  secret = "",
  attemptId = "",
  actor = "",
  now = "",
  maxAgeMs = 7 * 24 * 60 * 60 * 1000,
} = {}) {
  const key = String(secret || "");
  if (!key) throw new Error("verifyEvidenceReceipt requires a host ingress secret.");
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) {
    return { ok: false, rejection: "malformed_receipt" };
  }
  if (Number(receipt.protocol) !== EVIDENCE_RECEIPT_PROTOCOL) {
    return { ok: false, rejection: "unsupported_protocol" };
  }
  const signature = String(receipt.signature || "");
  if (!signature) return { ok: false, rejection: "missing_signature" };
  const expected = createHmac("sha256", key).update(canonicalReceiptPayload(receipt)).digest("hex");
  // constant-time compare; mismatched lengths fail without leaking timing.
  const sigBuf = Buffer.from(signature, "hex");
  const expBuf = Buffer.from(expected, "hex");
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
    return { ok: false, rejection: "bad_signature" };
  }
  const wantAttempt = String(attemptId || "").trim();
  if (wantAttempt && String(receipt.attemptId || "").trim() !== wantAttempt) {
    return { ok: false, rejection: "attempt_binding_mismatch" };
  }
  const wantActor = String(actor || "").trim();
  if (wantActor && String(receipt.actor || "").trim() !== wantActor) {
    return { ok: false, rejection: "actor_binding_mismatch" };
  }
  const trustTier = trustTierForOrigin(receipt.origin);
  if (!trustTier) return { ok: false, rejection: "unknown_origin" };
  const nowMs = Date.parse(String(now || ""));
  const ingestedMs = Date.parse(String(receipt.ingestedAt || ""));
  if (Number.isFinite(nowMs) && Number.isFinite(ingestedMs)) {
    if (ingestedMs > nowMs) return { ok: false, rejection: "ingested_in_future" };
    if (nowMs - ingestedMs > maxAgeMs) return { ok: false, rejection: "receipt_expired" };
  }
  if (!(Number(receipt.byteLength) > 0)) return { ok: false, rejection: "empty_artifact" };
  const maxGrade = maxGradeForTrustTier(trustTier);
  return {
    ok: true,
    trustTier,
    maxGrade,
    evidence: {
      origin: receipt.origin,
      trustTier,
      artifactId: String(receipt.artifactId),
      sha256: String(receipt.sha256),
      mediaType: String(receipt.mediaType),
      ingestedAt: String(receipt.ingestedAt),
    },
  };
}

/**
 * Decide whether a verified receipt's trust tier is sufficient for a requested
 * evidence grade. The grade a transition requires (requiredGradeForTransition) must
 * be <= the receipt's trust-tier ceiling. e.g. an artifact_backed receipt (founder
 * screenshot) supports record_action_proof (action_proof) but NOT record_goal_proof
 * (goal_proof). Returns { ok, reason }. Pure.
 */
export function receiptSupportsGrade(trustTier = "", requiredGrade = "") {
  const ceiling = maxGradeForTrustTier(trustTier);
  const needRank = GRADE_RANK[String(requiredGrade || "").trim()];
  const ceilRank = GRADE_RANK[String(ceiling || "").trim()];
  if (!needRank) return { ok: false, reason: `unknown_required_grade:${requiredGrade || "(none)"}` };
  if (!ceilRank) return { ok: false, reason: `unknown_trust_tier:${trustTier || "(none)"}` };
  if (needRank > ceilRank) {
    return { ok: false, reason: `trust_tier_${trustTier}_caps_at_${ceiling}_below_required_${requiredGrade}` };
  }
  return { ok: true, reason: "" };
}
