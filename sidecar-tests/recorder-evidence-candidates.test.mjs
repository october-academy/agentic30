import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { appendProofLedgerEvent, loadProofLedger } from "../sidecar/execution-os.mjs";
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

test("writeEvidenceCandidateThroughProofLedger double-writing an already-written candidate is an idempotent no-op", async () => {
  const { workspaceRoot, store } = await makeContext();
  try {
    insertRecorderEvidenceCandidate(store, candidate());

    const first = await writeEvidenceCandidateThroughProofLedger({
      store,
      workspaceRoot,
      candidateId: "candidate-1",
      now: new Date("2026-06-27T13:00:00.000Z"),
    });
    assert.equal(first.status, "written_to_ledger");
    const eventId = first.candidate.proof_ledger_event_id;
    assert.equal(Boolean(eventId), true);

    const second = await writeEvidenceCandidateThroughProofLedger({
      store,
      workspaceRoot,
      candidateId: "candidate-1",
      now: new Date("2026-06-27T15:00:00.000Z"),
    });

    // Idempotent no-op: status preserved, NOT flipped to verifier_rejected.
    assert.equal(second.status, "written_to_ledger");
    assert.equal(second.idempotent, true);
    assert.equal(second.proof_ledger_event_id, eventId);

    const reloaded = store.getRecord("evidence_candidates", "candidate-1");
    assert.equal(reloaded.candidate_status, "written_to_ledger");
    assert.equal(reloaded.proof_ledger_event_id, eventId);

    // The first call's ledger event must survive — no second event, no desync.
    const ledger = await loadProofLedger({ workspaceRoot });
    assert.equal(ledger.events.length, 1);
    assert.equal(ledger.events[0].metadata.recorderEvidenceCandidateId, "candidate-1");
  } finally {
    store.close();
  }
});

test("writeEvidenceCandidateThroughProofLedger does not clobber a candidate deleted while the ledger append was in flight", async () => {
  const { workspaceRoot, store } = await makeContext();
  try {
    insertRecorderEvidenceCandidate(store, candidate());

    const result = await writeEvidenceCandidateThroughProofLedger({
      store,
      workspaceRoot,
      candidateId: "candidate-1",
      now: new Date("2026-06-27T13:00:00.000Z"),
      // Simulate a concurrent retention/consent-revocation delete that
      // rejects this exact candidate while the (real, async) ledger append
      // is in flight, then let the real append complete normally.
      append: async (args) => {
        store.updateRecord("evidence_candidates", "candidate-1", {
          candidate_status: "rejected",
          deleted_at: "2026-06-27T13:00:00.500Z",
        });
        return appendProofLedgerEvent(args);
      },
    });

    assert.equal(result.status, "written_to_ledger_candidate_deleted");

    const reloaded = store.getRecord("evidence_candidates", "candidate-1");
    // The deletion's protective state must survive the race, not be
    // silently overwritten back to written_to_ledger.
    assert.equal(reloaded.candidate_status, "rejected");
    assert.equal(reloaded.deleted_at, "2026-06-27T13:00:00.500Z");

    // The ledger append is append-only and already durably completed; it
    // cannot be retracted, but it must not be duplicated either.
    const ledger = await loadProofLedger({ workspaceRoot });
    assert.equal(ledger.events.length, 1);
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
