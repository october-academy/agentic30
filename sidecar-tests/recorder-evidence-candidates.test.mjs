import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { loadProofLedger } from "../sidecar/execution-os.mjs";
import {
  insertRecorderEvidenceCandidate,
  writeEvidenceCandidateThroughProofLedger,
} from "../sidecar/recorder-evidence-candidates.mjs";
import { RecorderStore } from "../sidecar/recorder-store.mjs";

async function makeContext() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-recorder-evidence-"));
  const appSupport = path.join(root, "app-support");
  const workspaceRoot = path.join(root, "workspace");
  await fs.mkdir(workspaceRoot, { recursive: true });
  const store = new RecorderStore({ appSupportRoot: appSupport }).open();
  return { root, workspaceRoot, store };
}

function candidate(overrides = {}) {
  return {
    id: "candidate-1",
    candidateStatus: "approved_bundle",
    sourceState: "memory_safe",
    claim: "Named customer replied with concrete activation friction.",
    proofKind: "customer_reply",
    sourceIds: [
      { id: "frame-1", source_kind: "customer_reply" },
      { id: "memory-1", source_kind: "memory_summary" },
    ],
    proofLedgerMapping: {
      targetGate: "customer_evidence",
      event: {
        type: "interview",
        day: 1,
        status: "accepted",
        strength: "medium",
        evidenceType: "link",
        sourceUrl: "https://example.com/customer-reply",
        customer: "founder A",
        metadata: { kind: "customer_reply", targetGate: "customer_evidence" },
      },
    },
    evidenceDebt: [],
    immutableFingerprint: "sha256:candidate-1",
    idempotencyKey: "candidate-1:write",
    createdBy: "evidence-inbox-builder",
    createdAt: "2026-06-27T12:00:00.000Z",
    ...overrides,
  };
}

test("writeEvidenceCandidateThroughProofLedger marks approved candidates written_to_ledger", async () => {
  const { workspaceRoot, store } = await makeContext();
  try {
    insertRecorderEvidenceCandidate(store, candidate());

    const result = await writeEvidenceCandidateThroughProofLedger({
      store,
      workspaceRoot,
      candidateId: "candidate-1",
      now: new Date("2026-06-27T13:00:00.000Z"),
    });

    assert.equal(result.status, "written_to_ledger");
    assert.equal(result.candidate.candidate_status, "written_to_ledger");
    assert.equal(result.candidate.reviewed_at, "2026-06-27T13:00:00.000Z");
    assert.equal(Boolean(result.candidate.proof_ledger_event_id), true);
    assert.match(result.candidate.verifier_result_json, /written_to_ledger/);

    const ledger = await loadProofLedger({ workspaceRoot });
    assert.equal(ledger.events.length, 1);
    assert.equal(ledger.events[0].metadata.recorderEvidenceCandidateId, "candidate-1");
  } finally {
    store.close();
  }
});

test("writeEvidenceCandidateThroughProofLedger records verifier_rejected with root cause", async () => {
  const { workspaceRoot, store } = await makeContext();
  try {
    insertRecorderEvidenceCandidate(store, candidate({
      id: "candidate-unsafe",
      sourceState: "raw_local",
      idempotencyKey: "candidate-unsafe:write",
    }));

    const result = await writeEvidenceCandidateThroughProofLedger({
      store,
      workspaceRoot,
      candidateId: "candidate-unsafe",
      now: new Date("2026-06-27T14:00:00.000Z"),
    });

    assert.equal(result.status, "verifier_rejected");
    assert.equal(result.candidate.candidate_status, "verifier_rejected");
    assert.match(result.candidate.verifier_result_json, /ERR_RECORDER_PROOF_UNSAFE_SOURCE_STATE/);

    const ledger = await loadProofLedger({ workspaceRoot });
    assert.equal(ledger.events.length, 0);
  } finally {
    store.close();
  }
});
