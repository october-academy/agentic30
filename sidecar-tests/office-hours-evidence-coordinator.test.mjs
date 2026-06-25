// The coordinator turns a signed receipt into the host-minted reducer evidence record,
// reading binding context from durable authority. It must: reject a missing receipt
// (receipt_required, no compat), derive the canonical kind + provenance from a verified
// receipt, reject a receipt that is insufficient for the transition, and require the
// projection (for the derived evidenceContractId).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { prepareReceiptEvidence, AttemptEvidenceError } from "../sidecar/office-hours-evidence-coordinator.mjs";
import { ingestSwiftUpload } from "../sidecar/office-hours-evidence-ingress.mjs";
import { deriveEvidenceContractId } from "../sidecar/office-hours-evidence-binding.mjs";

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("cap")]);
const NOW = "2026-06-26T10:00:00.000Z";

// A projection whose evidence contract is defined (so deriveEvidenceContractId works).
function projection(over = {}) {
  return {
    id: "att_1",
    candidate: "AI로 많이 만든 사람",
    candidateId: "cand_1",
    externalAction: "DM 발송",
    attemptThreshold: "3명",
    successCondition: "1명 결제",
    expectedProofKind: "payment",
    evidenceLocation: "스크린샷",
    status: "execution_scheduled",
    ...over,
  };
}

async function withEnv(fn) {
  const store = await fs.mkdtemp(path.join(os.tmpdir(), "a30-coord-store-"));
  const ws = await fs.mkdtemp(path.join(os.tmpdir(), "a30-coord-ws-"));
  const prev = process.env.AGENTIC30_HOST_STORE_DIR;
  process.env.AGENTIC30_HOST_STORE_DIR = store;
  try {
    return await fn({ ws });
  } finally {
    if (prev === undefined) delete process.env.AGENTIC30_HOST_STORE_DIR;
    else process.env.AGENTIC30_HOST_STORE_DIR = prev;
    await fs.rm(store, { recursive: true, force: true });
    await fs.rm(ws, { recursive: true, force: true });
  }
}

// Ingest a real receipt bound to the SAME evidenceContractId the coordinator will derive.
async function ingestFor(ws, proj, attemptId = "att_1") {
  const evidenceContractId = deriveEvidenceContractId(proj);
  return ingestSwiftUpload({ workspaceRoot: ws }, { bytes: PNG, attemptId, evidenceContractId, now: NOW });
}

test("missing receipt → receipt_required (no compat)", async () => {
  await withEnv(async ({ ws }) => {
    await assert.rejects(
      () => prepareReceiptEvidence({ workspaceRoot: ws, attemptId: "att_1", transition: "record_action_proof", projection: projection(), receiptToken: "", now: NOW }),
      (e) => e instanceof AttemptEvidenceError && e.code === "ERR_RECEIPT_REQUIRED",
    );
  });
});

test("verified action receipt → host-minted message_log kind + provenance", async () => {
  await withEnv(async ({ ws }) => {
    const proj = projection();
    const res = await ingestFor(ws, proj);
    const prepared = await prepareReceiptEvidence({
      workspaceRoot: ws, attemptId: "att_1", transition: "record_action_proof",
      projection: proj, receiptToken: res.receiptToken, now: "2026-06-26T10:05:00.000Z",
    });
    assert.equal(prepared.fields.evidence.kind, "message_log");
    assert.equal(prepared.fields.evidence.ref, `artifact://${res.artifactId}`);
    assert.equal(prepared.fields.evidence.source, "host_receipt_v3");
    assert.equal(prepared.fields.evidence.verifiedClaim, "message.sent");
    assert.equal(prepared.fields.evidence.origin, "swift_upload");
    assert.equal(prepared.fields.evidence.trustTier, "artifact_backed");
    assert.equal(prepared.fields.evidence.sha256, res.sha256);
    assert.match(prepared.fields.evidence.receiptDigest, /^[0-9a-f]{64}$/);
    assert.equal(prepared.selectedClaim, "message.sent");
    assert.equal(prepared.evidenceIdentity, res.evidenceIdentity);
  });
});

test("an action receipt is INSUFFICIENT for record_goal_proof (honest dead-end)", async () => {
  await withEnv(async ({ ws }) => {
    const proj = projection({ status: "execution_scheduled" });
    const res = await ingestFor(ws, proj);
    await assert.rejects(
      () => prepareReceiptEvidence({
        workspaceRoot: ws, attemptId: "att_1", transition: "record_goal_proof",
        projection: proj, receiptToken: res.receiptToken, now: NOW,
      }),
      (e) => e instanceof AttemptEvidenceError && e.code === "ERR_RECEIPT_INSUFFICIENT",
    );
  });
});

test("a receipt bound to a DIFFERENT contract is rejected (binding mismatch)", async () => {
  await withEnv(async ({ ws }) => {
    const proj = projection();
    const res = await ingestFor(ws, proj);
    // The coordinator derives evidenceContractId from a DIFFERENT projection → mismatch.
    await assert.rejects(
      () => prepareReceiptEvidence({
        workspaceRoot: ws, attemptId: "att_1", transition: "record_action_proof",
        projection: projection({ successCondition: "2명 결제" }), receiptToken: res.receiptToken, now: NOW,
      }),
      (e) => e instanceof AttemptEvidenceError && e.code === "ERR_RECEIPT_REJECTED",
    );
  });
});
