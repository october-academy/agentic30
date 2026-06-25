// office-hours-evidence-ingress.mjs — origin-specific evidence INGRESS adapters
// (A′ build-seq step 6; GPT-5.5 Pro Decision D).
//
// The receipt verifier only proves a token's integrity + bindings; it cannot prove the
// PROPOSITION ("a message was sent", "a customer replied"). That proposition is minted
// HERE, per origin, and is NEVER taken from the client (a client-chosen claim would just
// move self-attestation from `kind` to `claim`). There is deliberately NO generic public
// signer: each adapter is the only place its claim is created.
//
// MINIMAL ACTION-RAIL SCOPE (October 2026-06-26): only `ingestSwiftUpload` ships — a
// founder-uploaded screenshot proves the founder's own OUTBOUND action (`message.sent` →
// action_proof) and nothing more. customer_outcome / goal_proof legitimately need a
// recipient_callback / provider_event adapter (authenticated inbound / first-party
// provider event); those are deferred until a real provider hookup exists, so an attempt
// honestly sits at awaiting_customer_outcome rather than letting a screenshot self-attest
// a customer's reaction. That honesty IS the point of the hard-evidence rule.
//
// The adapter persists the bytes (immutable, content-addressed) BEFORE signing, so a
// valid receipt always points at durable bytes (P0 #6).

import { putArtifactBlob } from "./office-hours-artifact-blob-store.mjs";
import { deriveEvidenceIdentity, registerArtifact } from "./office-hours-artifact-registry.mjs";
import { signEvidenceReceipt } from "./office-hours-evidence-receipt.mjs";
import { resolveHostIdentity, resolveEvidenceSigningKey } from "./office-hours-host-identity.mjs";

// How long an ingress receipt stays valid. The minimal rail ingests and verifies inside
// one composite command, so the receipt is seconds old at verify; a 1h ceiling bounds the
// window without being so tight that a slow UI fails.
export const INGRESS_RECEIPT_TTL_MS = 60 * 60 * 1000;

export class EvidenceIngressError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "EvidenceIngressError";
    this.code = code || "ERR_EVIDENCE_INGRESS";
  }
}

function isoPlus(nowIso, ms) {
  const t = Date.parse(String(nowIso || ""));
  if (!Number.isFinite(t)) throw new EvidenceIngressError("ingress requires a valid `now` timestamp", "ERR_INGRESS_NOW");
  return new Date(t + ms).toISOString();
}

/**
 * Swift-upload adapter: founder-provided bytes → durable blob → registry registration →
 * signed action-proof receipt (fixed claim `message.sent`). The CLAIM, ORIGIN, and KIND
 * are host-fixed here; the only founder input is the raw bytes (+ an advisory media type).
 *
 * Inputs (the coordinator supplies attempt/contract context, NOT the client):
 *   workspaceRoot, bytes (Buffer), declaredMediaType?, attemptId, evidenceContractId, now (ISO)
 * Returns { receiptToken, artifactId, sha256, evidenceIdentity, detectedMediaType,
 *           byteLength, projectId, actorId, keyId, issuedAt, expiresAt }.
 * Throws (fail-closed) on unrecognized/empty bytes or missing context.
 */
export async function ingestSwiftUpload({ workspaceRoot } = {}, {
  bytes,
  declaredMediaType,
  attemptId,
  evidenceContractId,
  now,
} = {}) {
  const attempt = String(attemptId || "").trim();
  const contract = String(evidenceContractId || "").trim();
  if (!attempt) throw new EvidenceIngressError("ingestSwiftUpload requires attemptId", "ERR_INGRESS_CONTEXT");
  if (!contract) throw new EvidenceIngressError("ingestSwiftUpload requires evidenceContractId", "ERR_INGRESS_CONTEXT");

  // 1) Persist the bytes immutably + content-address them + sniff the MIME host-side.
  const blob = await putArtifactBlob({ workspaceRoot }, { bytes, declaredMediaType });
  // A founder action-proof capture must be a recognized artifact (image/pdf), not
  // arbitrary bytes — reject "unrecognized" so an octet-stream blob can't back a proof.
  if (blob.contentValidation === "unrecognized") {
    throw new EvidenceIngressError(
      `ingestSwiftUpload: artifact media type not recognized (${blob.detectedMediaType}); a screenshot/PDF capture is required`,
      "ERR_INGRESS_UNRECOGNIZED_MEDIA",
    );
  }

  // 2) Resolve host identity (founder principal + project) — the binding context.
  const { installActorId, projectId } = await resolveHostIdentity({ workspaceRoot });
  const actorId = installActorId;

  // 3) Durable single-use identity + registration (same bytes re-uploaded → same identity).
  const evidenceIdentity = deriveEvidenceIdentity({ origin: "swift_upload", actorId, sha256: blob.sha256 });
  const registration = await registerArtifact(
    { workspaceRoot },
    {
      evidenceIdentity,
      artifactId: blob.artifactId,
      sha256: blob.sha256,
      origin: "swift_upload",
      mediaType: blob.detectedMediaType,
      byteLength: blob.byteLength,
    },
  );
  if (registration.ok === false) {
    throw new EvidenceIngressError(
      `ingestSwiftUpload: registry rejected the artifact (${registration.rejection})`,
      "ERR_INGRESS_REGISTER",
    );
  }

  // 4) Sign the receipt with the active per-project key. Claim is HOST-FIXED.
  const { keyId, secret } = await resolveEvidenceSigningKey({ workspaceRoot });
  const issuedAt = new Date(Date.parse(String(now))).toISOString();
  const expiresAt = isoPlus(now, INGRESS_RECEIPT_TTL_MS);
  const receiptToken = signEvidenceReceipt(
    {
      evidenceIdentity,
      artifactId: blob.artifactId,
      projectId,
      attemptId: attempt,
      actorId,
      evidenceContractId: contract,
      sha256: blob.sha256,
      byteLength: blob.byteLength,
      declaredMediaType: blob.declaredMediaType || "",
      detectedMediaType: blob.detectedMediaType,
      contentValidation: blob.contentValidation,
      origin: "swift_upload",
      issuedAt,
      expiresAt,
      verifiedClaims: ["message.sent"], // ← host-fixed for the swift-upload action rail
    },
    { secret, keyId },
  );

  return {
    receiptToken,
    artifactId: blob.artifactId,
    sha256: blob.sha256,
    evidenceIdentity,
    detectedMediaType: blob.detectedMediaType,
    byteLength: blob.byteLength,
    projectId,
    actorId,
    keyId,
    issuedAt,
    expiresAt,
  };
}
