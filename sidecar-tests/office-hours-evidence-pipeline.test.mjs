// Integration test: the A′ outcome-capture EVIDENCE PIPELINE end-to-end, composing the
// two host-owned authorities (office-hours-evidence-receipt verifier + artifact-registry)
// exactly as the index.mjs handler cutover will wire them — BEFORE that wiring exists.
// This is the "simulation + evaluation" of the reframed pipeline: it proves the verifier↔
// registry seam is closed (the signed evidenceIdentity flows verify→consume) for every
// origin, that single-use + idempotency hold across the composed flow, and that a rejected
// receipt never reaches the registry. It would have caught the seam gap (a provider_event/
// recipient_callback identity is not reconstructable from artifactId/sha256 alone).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  signEvidenceReceipt,
  verifyEvidenceReceipt,
  receiptSatisfiesRequirement,
} from "../sidecar/office-hours-evidence-receipt.mjs";
import {
  deriveEvidenceIdentity,
  registerArtifact,
  consumeArtifact,
} from "../sidecar/office-hours-artifact-registry.mjs";

const KEY_ID = "k1";
const SECRET = Buffer.from("0123456789abcdef0123456789abcdef");
const KEYRING = { k1: { secret: SECRET } };
const NOW = "2026-06-25T11:00:00.000Z";
const SHA = "a".repeat(64);

async function tmpWorkspace() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "a30-evidence-pipeline-"));
  return root;
}

// Simulate the FULL host path for one piece of evidence: ingress derives the identity +
// registers the artifact + signs a receipt; the handler verifies, checks the requirement,
// and consumes. Returns the intermediate values so tests can assert each seam.
async function runPipeline(workspaceRoot, {
  origin = "swift_upload",
  actorId = "actor_1",
  attemptId = "att_1",
  evidenceContractId = "ec_1",
  eventId = "evt_1",
  sha256 = SHA,
  providerAccount,
  providerEventId,
  callbackNonce,
  verifiedClaims = ["message.sent"],
  requiredGrade = "action_proof",
  requiredClaim = "message.sent",
  register = true,
  signOver = {},
} = {}) {
  // ── ingress ──
  const evidenceIdentity = deriveEvidenceIdentity({ origin, actorId, sha256, providerAccount, providerEventId, callbackNonce });
  if (register) {
    await registerArtifact({ workspaceRoot }, { evidenceIdentity, artifactId: "art_1", sha256, origin, mediaType: "image/png", byteLength: 1234 });
  }
  const token = signEvidenceReceipt({
    evidenceIdentity, artifactId: "art_1", projectId: "proj_1", attemptId, actorId, evidenceContractId,
    sha256, byteLength: 1234, declaredMediaType: "image/png", detectedMediaType: "image/png",
    contentValidation: "image_decode_succeeded", origin,
    issuedAt: "2026-06-25T10:59:30.000Z", expiresAt: "2026-06-25T11:59:30.000Z", verifiedClaims,
    ...signOver,
  }, { secret: SECRET, keyId: KEY_ID });
  // ── handler ──
  const verified = verifyEvidenceReceipt(token, {
    keyring: KEYRING, attemptId, actorId, projectId: "proj_1", evidenceContractId, now: NOW, maxAgeMs: 7 * 24 * 60 * 60 * 1000,
  });
  if (!verified.ok) return { verified, consumed: null, evidenceIdentity };
  const sat = receiptSatisfiesRequirement(verified, { requiredGrade, requiredClaim });
  if (!sat.ok) return { verified, sat, consumed: null, evidenceIdentity };
  const consumed = await consumeArtifact({ workspaceRoot }, {
    evidenceIdentity: verified.evidence.evidenceIdentity, // ← the SIGNED identity drives consume
    attemptId, evidenceContractId, eventId,
    sha256: verified.evidence.sha256, origin: verified.evidence.origin,
  });
  return { verified, sat, consumed, evidenceIdentity };
}

test("happy path: ingress→verify→satisfy→consume, seam closed (signed identity flows through)", async () => {
  const ws = await tmpWorkspace();
  try {
    const r = await runPipeline(ws);
    assert.equal(r.verified.ok, true);
    // the identity the handler consumes is the SAME one the verifier returned from the signed token.
    assert.equal(r.verified.evidence.evidenceIdentity, r.evidenceIdentity);
    assert.equal(r.sat.ok, true);
    assert.equal(r.consumed.ok, true);
    assert.equal(r.consumed.idempotent, false);
  } finally { await fs.rm(ws, { recursive: true, force: true }); }
});

test("idempotent retry: the same identity+attempt+contract+event consumes once", async () => {
  const ws = await tmpWorkspace();
  try {
    const first = await runPipeline(ws);
    assert.equal(first.consumed.idempotent, false);
    // replay the SAME tuple (no re-register; identity already known)
    const again = await runPipeline(ws, { register: false });
    assert.equal(again.consumed.ok, true);
    assert.equal(again.consumed.idempotent, true);
  } finally { await fs.rm(ws, { recursive: true, force: true }); }
});

test("single-use: the same evidence cannot be reused for a different attempt", async () => {
  const ws = await tmpWorkspace();
  try {
    const first = await runPipeline(ws, { attemptId: "att_1" });
    assert.equal(first.consumed.ok, true);
    // same upload (same actor+sha → same identity), different attempt → reuse rejected.
    const reuse = await runPipeline(ws, { attemptId: "att_2", register: false });
    assert.equal(reuse.consumed.ok, false);
    assert.equal(reuse.consumed.rejection, "artifact_reuse");
  } finally { await fs.rm(ws, { recursive: true, force: true }); }
});

test("provider_event origin composes (the seam that artifactId/sha256 alone could not close)", async () => {
  const ws = await tmpWorkspace();
  try {
    const r = await runPipeline(ws, {
      origin: "provider_event", providerAccount: "stripe_acct_1", providerEventId: "evt_stripe_99",
      verifiedClaims: ["goal.metric_observed"], requiredGrade: "goal_proof", requiredClaim: "goal.metric_observed",
    });
    assert.equal(r.verified.ok, true);
    assert.equal(r.verified.evidence.evidenceIdentity, "provider:stripe_acct_1:evt_stripe_99");
    assert.equal(r.sat.ok, true);
    assert.equal(r.consumed.ok, true);
  } finally { await fs.rm(ws, { recursive: true, force: true }); }
});

test("metadata mismatch: a verified receipt whose sha256 differs from the registration is rejected", async () => {
  const ws = await tmpWorkspace();
  try {
    // provider identity is independent of sha256, so we can register one sha and present another.
    const evidenceIdentity = deriveEvidenceIdentity({ origin: "provider_event", providerAccount: "acct", providerEventId: "ev1" });
    await registerArtifact({ workspaceRoot: ws }, { evidenceIdentity, artifactId: "art_1", sha256: SHA, origin: "provider_event", mediaType: "application/json", byteLength: 50 });
    const r = await runPipeline(ws, {
      origin: "provider_event", providerAccount: "acct", providerEventId: "ev1", register: false,
      sha256: "b".repeat(64), verifiedClaims: ["goal.metric_observed"], requiredGrade: "goal_proof", requiredClaim: "goal.metric_observed",
    });
    assert.equal(r.verified.ok, true); // the receipt itself is valid…
    assert.equal(r.consumed.ok, false); // …but its sha256 ≠ the registered artifact.
    assert.equal(r.consumed.rejection, "metadata_mismatch");
  } finally { await fs.rm(ws, { recursive: true, force: true }); }
});

test("a REJECTED receipt never reaches the registry (expired → no consume)", async () => {
  const ws = await tmpWorkspace();
  try {
    const r = await runPipeline(ws, { signOver: { issuedAt: "2026-06-25T09:00:00.000Z", expiresAt: "2026-06-25T10:00:00.000Z" } });
    assert.equal(r.verified.ok, false);
    assert.equal(r.verified.rejection, "receipt_expired");
    assert.equal(r.consumed, null); // the pipeline stopped before consume.
  } finally { await fs.rm(ws, { recursive: true, force: true }); }
});

test("an insufficient claim is rejected at the requirement gate, before consume", async () => {
  const ws = await tmpWorkspace();
  try {
    // artifact_backed upload can only claim message.sent; requiring a goal proof fails the gate.
    const r = await runPipeline(ws, { requiredGrade: "goal_proof", requiredClaim: "goal.metric_observed" });
    assert.equal(r.verified.ok, true);
    assert.equal(r.sat.ok, false);
    assert.equal(r.consumed, null);
  } finally { await fs.rm(ws, { recursive: true, force: true }); }
});
