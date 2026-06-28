import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { loadProofLedger } from "../sidecar/execution-os.mjs";
import {
  RecorderProofAdapterError,
  buildRecorderProofCandidateVerifierRejection,
  normalizeRecorderProofCandidate,
  writeRecorderProofCandidateToLedger,
} from "../sidecar/recorder-proof-ledger-adapter.mjs";

function baseCandidate(overrides = {}) {
  const mapping = overrides.proofLedgerMapping ?? {
    event: {
      type: "interview",
      day: 1,
      status: "accepted",
      strength: "medium",
      evidenceType: "link",
      sourceUrl: "https://example.com/interview/reply",
      customer: "founder A",
      metadata: { kind: "customer_reply" },
    },
  };
  return {
    id: "candidate-1",
    candidateStatus: "approved_bundle",
    sourceState: "memory_safe",
    claim: "A named founder replied with a concrete problem.",
    proofKind: "customer_reply",
    sourceIds: ["frame:1", "product_event:2"],
    sourceKinds: ["customer_reply"],
    proofLedgerMapping: mapping,
    evidenceDebt: [],
    immutableFingerprint: "sha256:candidate-1",
    idempotencyKey: "candidate-1:write",
    ...overrides,
  };
}

function assertAdapterCode(fn, code) {
  assert.throws(
    fn,
    (error) => error instanceof RecorderProofAdapterError && error.code === code,
  );
}

test("writeRecorderProofCandidateToLedger writes approved candidates through the existing proof ledger", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-recorder-proof-"));

  const result = await writeRecorderProofCandidateToLedger({
    workspaceRoot: root,
    candidate: baseCandidate(),
    now: new Date("2026-06-27T12:00:00.000Z"),
  });

  assert.equal(result.event.type, "interview");
  assert.equal(result.event.status, "accepted");
  assert.equal(result.event.strength, "medium");
  assert.equal(result.event.metadata.recorderEvidenceCandidateId, "candidate-1");
  assert.match(result.event.metadata.recorderEvidenceDedupeHash, /^[a-f0-9]{64}$/);
  assert.deepEqual(result.event.metadata.recorderEvidenceSourceIds, ["frame:1", "product_event:2"]);
  assert.equal(result.event.metadata.recorderEvidenceFingerprint, "sha256:candidate-1");
  assert.equal(result.proofLedgerEventId, result.event.id);

  const ledger = await loadProofLedger({ workspaceRoot: root });
  assert.equal(ledger.events.length, 1);
  assert.equal(ledger.events[0].metadata.recorderEvidenceProofKind, "customer_reply");
});

test("normalizeRecorderProofCandidate rejects unknown proof event fields before ledger normalization can default them", () => {
  assertAdapterCode(
    () => normalizeRecorderProofCandidate(baseCandidate({
      proofLedgerMapping: { event: { type: "imaginary_type", status: "accepted", strength: "medium" } },
    })),
    "ERR_RECORDER_PROOF_UNKNOWN_EVENT_TYPE",
  );
  assertAdapterCode(
    () => normalizeRecorderProofCandidate(baseCandidate({
      proofLedgerMapping: { event: { type: "interview", status: "made_up", strength: "medium" } },
    })),
    "ERR_RECORDER_PROOF_UNKNOWN_EVENT_STATUS",
  );
  assertAdapterCode(
    () => normalizeRecorderProofCandidate(baseCandidate({
      proofLedgerMapping: { event: { type: "interview", status: "accepted", strength: "heroic" } },
    })),
    "ERR_RECORDER_PROOF_UNKNOWN_EVENT_STRENGTH",
  );
});

test("normalizeRecorderProofCandidate rejects candidates that are not verifier-complete and approved", () => {
  assertAdapterCode(
    () => normalizeRecorderProofCandidate(baseCandidate({ candidateStatus: "pending_review" })),
    "ERR_RECORDER_PROOF_CANDIDATE_NOT_APPROVED",
  );
  assertAdapterCode(
    () => normalizeRecorderProofCandidate(baseCandidate({
      proofLedgerMapping: { event: { type: "interview", status: "submitted", strength: "medium" } },
    })),
    "ERR_RECORDER_PROOF_UNACCEPTED_EVENT_STATUS",
  );
});

test("normalizeRecorderProofCandidate rejects unsafe source state and missing immutable source identity", () => {
  assertAdapterCode(
    () => normalizeRecorderProofCandidate(baseCandidate({ sourceState: "raw_local" })),
    "ERR_RECORDER_PROOF_UNSAFE_SOURCE_STATE",
  );
  assertAdapterCode(
    () => normalizeRecorderProofCandidate(baseCandidate({ sourceIds: [] })),
    "ERR_RECORDER_PROOF_MISSING_SOURCE_IDS",
  );
  assertAdapterCode(
    () => normalizeRecorderProofCandidate(baseCandidate({ immutableFingerprint: "" })),
    "ERR_RECORDER_PROOF_MISSING_IMMUTABLE_FINGERPRINT",
  );
});

test("normalizeRecorderProofCandidate rejects duplicate idempotency keys already written to ledger", () => {
  assertAdapterCode(
    () => normalizeRecorderProofCandidate(baseCandidate(), {
      existingCandidates: [
        { idempotencyKey: "candidate-1:write", candidateStatus: "written_to_ledger" },
      ],
    }),
    "ERR_RECORDER_PROOF_DUPLICATE_IDEMPOTENCY_KEY",
  );
});

test("buildRecorderProofCandidateVerifierRejection preserves root-cause code for candidate state", () => {
  let rejectionError = null;
  try {
    normalizeRecorderProofCandidate(baseCandidate({ sourceState: "raw_local" }));
  } catch (error) {
    rejectionError = error;
  }

  const patch = buildRecorderProofCandidateVerifierRejection(rejectionError, {
    now: new Date("2026-06-27T13:00:00.000Z"),
  });

  assert.equal(patch.candidate_status, "verifier_rejected");
  assert.equal(patch.verifierResult.status, "rejected");
  assert.equal(patch.verifierResult.code, "ERR_RECORDER_PROOF_UNSAFE_SOURCE_STATE");
  assert.equal(patch.reviewed_at, "2026-06-27T13:00:00.000Z");
  assert.match(patch.verifier_result_json, /ERR_RECORDER_PROOF_UNSAFE_SOURCE_STATE/);
});

test("normalizeRecorderProofCandidate rejects non-proof sources for customer, active-user, and revenue gates", () => {
  assertAdapterCode(
    () => normalizeRecorderProofCandidate(baseCandidate({
      proofKind: "self_report",
      sourceKinds: ["self_report"],
      targetGate: "customer_evidence",
    })),
    "ERR_RECORDER_PROOF_REJECTED_PROOF_KIND",
  );
  assertAdapterCode(
    () => normalizeRecorderProofCandidate(baseCandidate({
      proofKind: "active_user_progress",
      sourceKinds: ["memory_summary", "pipe_output"],
      targetGate: "active_user",
    })),
    "ERR_RECORDER_PROOF_NON_EXTERNAL_SOURCE",
  );
  assertAdapterCode(
    () => normalizeRecorderProofCandidate(baseCandidate({
      proofKind: "revenue_proof",
      sourceKinds: ["product_event", "internal_trace"],
      targetGate: "revenue",
    })),
    "ERR_RECORDER_PROOF_NON_EXTERNAL_SOURCE",
  );
});
