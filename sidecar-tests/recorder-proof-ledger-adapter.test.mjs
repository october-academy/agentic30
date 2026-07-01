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

test("normalizeRecorderProofCandidate fails closed when a protected gate has no external source kinds", () => {
  // Empty source kinds must not skip the gate (corrupt plain-string source rows).
  assertAdapterCode(
    () => normalizeRecorderProofCandidate(baseCandidate({
      proofKind: "customer_evidence",
      targetGate: "customer_evidence",
      sourceIds: ["frame:1", "memory:2"],
      sourceKinds: [],
    })),
    "ERR_RECORDER_PROOF_NON_EXTERNAL_SOURCE",
  );
  // A single unknown/garbage source kind must not satisfy the gate.
  assertAdapterCode(
    () => normalizeRecorderProofCandidate(baseCandidate({
      proofKind: "active_user_progress",
      targetGate: "active_user",
      sourceKinds: ["banana"],
    })),
    "ERR_RECORDER_PROOF_NON_EXTERNAL_SOURCE",
  );
  // Recorder-only legacy sources (recorder_source) are not external proof.
  assertAdapterCode(
    () => normalizeRecorderProofCandidate(baseCandidate({
      proofKind: "revenue_proof",
      targetGate: "revenue",
      sourceKinds: ["recorder_source"],
    })),
    "ERR_RECORDER_PROOF_NON_EXTERNAL_SOURCE",
  );
});

test("normalizeRecorderProofCandidate accepts a protected gate with allowlisted external evidence", () => {
  // Mirrors the legit approve path: external_evidence marker + known evidence kind,
  // even when recorder-only sources are also present.
  const normalized = normalizeRecorderProofCandidate(baseCandidate({
    proofKind: "customer_evidence",
    targetGate: "customer_evidence",
    sourceIds: [
      { id: "artifact-1", source_kind: "customer_reply", source_type: "external_evidence" },
      { id: "frame:1", source_kind: "recorder_source", source_type: "recorder_source" },
    ],
    sourceKinds: undefined,
  }));
  assert.equal(normalized.proofKind, "customer_evidence");
  assert.equal(normalized.targetGate, "customer_evidence");
  assert.ok(normalized.sourceKinds.includes("external_evidence"));
});

test("normalizeRecorderProofCandidate protects revenue/customer proof EVENT TYPES even when targetGate/proofKind are unprotected", () => {
  // Forge attempt #1 (revenue): omit targetGate and use a non-protected proofKind,
  // but write an accepted payment_record event from recorder-only sources.
  assertAdapterCode(
    () => normalizeRecorderProofCandidate(baseCandidate({
      proofKind: "action_evidence",
      sourceIds: ["frame:1", "memory:2", "product_event:3"],
      sourceKinds: ["raw_frame", "memory_summary", "product_event"],
      proofLedgerMapping: { event: { type: "payment_record", status: "accepted", strength: "strong" } },
      // no targetGate set anywhere
    })),
    "ERR_RECORDER_PROOF_NON_EXTERNAL_SOURCE",
  );
  // Forge attempt #2 (customer): dm_ask event with a targetGate outside PROTECTED_GATE_TARGETS.
  assertAdapterCode(
    () => normalizeRecorderProofCandidate(baseCandidate({
      proofKind: "action_evidence",
      targetGate: "paying_customer",
      sourceIds: ["transcript:1"],
      sourceKinds: ["transcript_hit"],
      proofLedgerMapping: { event: { type: "dm_ask", status: "accepted", strength: "strong" } },
    })),
    "ERR_RECORDER_PROOF_NON_EXTERNAL_SOURCE",
  );
  // Legit: the same protected event type with external accepted evidence still writes.
  const normalized = normalizeRecorderProofCandidate(baseCandidate({
    proofKind: "action_evidence",
    sourceIds: [{ id: "receipt-1", source_kind: "payment_receipt", source_type: "external_evidence" }],
    sourceKinds: ["external_evidence"],
    proofLedgerMapping: { event: { type: "payment_record", status: "accepted", strength: "strong" } },
  }));
  assert.equal(normalized.proofEvent.type, "payment_record");
  assert.ok(normalized.sourceKinds.includes("external_evidence"));
});

test("normalizeRecorderProofCandidate fail-closed protects gate-advancing event types (traffic_snapshot G5, interview G1/G2) from recorder-only sources", () => {
  // traffic_snapshot drives the G5 first-external-traffic acquisition gate; a
  // recorder-only screen capture must not forge it (metadata.observed defaults true).
  assertAdapterCode(
    () => normalizeRecorderProofCandidate(baseCandidate({
      proofKind: "action_evidence",
      sourceIds: ["rec-1"],
      sourceKinds: ["screen_recording"],
      proofLedgerMapping: { event: { type: "traffic_snapshot", status: "accepted", strength: "strong", metadata: { observed: true } } },
    })),
    "ERR_RECORDER_PROOF_NON_EXTERNAL_SOURCE",
  );
  // Same with no metadata at all (observed defaults true downstream in the gate engine).
  assertAdapterCode(
    () => normalizeRecorderProofCandidate(baseCandidate({
      proofKind: "action_evidence",
      sourceIds: ["rec-2"],
      sourceKinds: ["ocr_text"],
      proofLedgerMapping: { event: { type: "traffic_snapshot", status: "complete", strength: "weak" } },
    })),
    "ERR_RECORDER_PROOF_NON_EXTERNAL_SOURCE",
  );
  // interview drives G1/G2 interview_strong_evidence; recorder-only audio must not forge it.
  assertAdapterCode(
    () => normalizeRecorderProofCandidate(baseCandidate({
      proofKind: "action_evidence",
      sourceIds: ["rec-3"],
      sourceKinds: ["audio_transcript"],
      proofLedgerMapping: { event: { type: "interview", status: "verified", strength: "strong" } },
    })),
    "ERR_RECORDER_PROOF_NON_EXTERNAL_SOURCE",
  );
  // Not over-blocked: a self-reportable internal milestone (work_log) from
  // recorder-only sources is still accepted — recorder data is valid INPUT; the
  // boundary only blocks recorder-only customer/active/revenue/foundation PROOF.
  const normalized = normalizeRecorderProofCandidate(baseCandidate({
    proofKind: "action_evidence",
    sourceIds: ["rec-4"],
    sourceKinds: ["screen_recording"],
    proofLedgerMapping: { event: { type: "work_log", status: "complete", strength: "weak" } },
  }));
  assert.equal(normalized.proofEvent.type, "work_log");
});
