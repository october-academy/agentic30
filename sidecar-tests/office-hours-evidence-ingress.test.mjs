// The swift-upload ingress adapter must compose blob store + identity/key + registry +
// receipt into a signed action-proof receipt whose claim is HOST-FIXED (message.sent),
// which then verifies, satisfies the action_proof requirement, and consumes once.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { ingestSwiftUpload, EvidenceIngressError } from "../sidecar/office-hours-evidence-ingress.mjs";
import { resolveEvidenceKeyring } from "../sidecar/office-hours-host-identity.mjs";
import { verifyEvidenceReceipt, receiptSatisfiesRequirement } from "../sidecar/office-hours-evidence-receipt.mjs";
import { consumeArtifact } from "../sidecar/office-hours-artifact-registry.mjs";

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("day1-dm-screenshot")]);
const NOW = "2026-06-26T10:00:00.000Z";

async function withEnv(fn) {
  const store = await fs.mkdtemp(path.join(os.tmpdir(), "a30-ingress-store-"));
  const ws = await fs.mkdtemp(path.join(os.tmpdir(), "a30-ingress-ws-"));
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

test("ingest → verify → satisfy(action_proof) → consume, with a host-fixed message.sent claim", async () => {
  await withEnv(async ({ ws }) => {
    const attemptId = "att_1";
    const evidenceContractId = "ec_test_1";
    const res = await ingestSwiftUpload({ workspaceRoot: ws }, { bytes: PNG, declaredMediaType: "image/png", attemptId, evidenceContractId, now: NOW });
    assert.match(res.receiptToken, /^v3\./);
    assert.match(res.sha256, /^[0-9a-f]{64}$/);
    assert.equal(res.artifactId, res.sha256);
    assert.equal(res.detectedMediaType, "image/png");

    const { keyring } = await resolveEvidenceKeyring({ workspaceRoot: ws });
    const verified = verifyEvidenceReceipt(res.receiptToken, {
      keyring, attemptId, actorId: res.actorId, projectId: res.projectId, evidenceContractId,
      now: "2026-06-26T10:05:00.000Z", maxAgeMs: 60 * 60 * 1000,
    });
    assert.equal(verified.ok, true, verified.rejection || "");
    assert.deepEqual(verified.verifiedClaims, ["message.sent"]);
    assert.equal(verified.maxGrade, "action_proof");
    assert.equal(verified.evidence.evidenceIdentity, res.evidenceIdentity);

    const sat = receiptSatisfiesRequirement(verified, { requiredGrade: "action_proof", requiredClaim: "message.sent" });
    assert.equal(sat.ok, true, sat.reason || "");

    const consumed = await consumeArtifact({ workspaceRoot: ws }, {
      evidenceIdentity: verified.evidence.evidenceIdentity,
      attemptId, evidenceContractId, eventId: "evt_1",
      sha256: verified.evidence.sha256, origin: verified.evidence.origin,
    });
    assert.equal(consumed.ok, true);
    assert.equal(consumed.idempotent, false);
  });
});

test("a swift-upload receipt can NEVER satisfy a goal_proof requirement (ceiling honored)", async () => {
  await withEnv(async ({ ws }) => {
    const res = await ingestSwiftUpload({ workspaceRoot: ws }, { bytes: PNG, attemptId: "att_1", evidenceContractId: "ec_1", now: NOW });
    const { keyring } = await resolveEvidenceKeyring({ workspaceRoot: ws });
    const verified = verifyEvidenceReceipt(res.receiptToken, {
      keyring, attemptId: "att_1", actorId: res.actorId, projectId: res.projectId, evidenceContractId: "ec_1",
      now: NOW, maxAgeMs: 60 * 60 * 1000,
    });
    assert.equal(verified.ok, true);
    const sat = receiptSatisfiesRequirement(verified, { requiredGrade: "goal_proof", requiredClaim: "goal.metric_observed" });
    assert.equal(sat.ok, false, "an uploaded screenshot must not clear a goal proof");
  });
});

test("unrecognized (non-image/pdf) bytes are refused before any receipt is minted", async () => {
  await withEnv(async ({ ws }) => {
    await assert.rejects(
      () => ingestSwiftUpload({ workspaceRoot: ws }, { bytes: Buffer.from("just some text, not a capture"), attemptId: "att_1", evidenceContractId: "ec_1", now: NOW }),
      (e) => e instanceof EvidenceIngressError && e.code === "ERR_INGRESS_UNRECOGNIZED_MEDIA",
    );
  });
});

test("missing attempt/contract context fails closed", async () => {
  await withEnv(async ({ ws }) => {
    await assert.rejects(() => ingestSwiftUpload({ workspaceRoot: ws }, { bytes: PNG, evidenceContractId: "ec_1", now: NOW }));
    await assert.rejects(() => ingestSwiftUpload({ workspaceRoot: ws }, { bytes: PNG, attemptId: "att_1", now: NOW }));
  });
});
