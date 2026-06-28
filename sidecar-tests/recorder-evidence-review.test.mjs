import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { loadProofLedger } from "../sidecar/execution-os.mjs";
import { insertRecorderEvidenceCandidate, writeEvidenceCandidateThroughProofLedger } from "../sidecar/recorder-evidence-candidates.mjs";
import {
  RecorderEvidenceReviewError,
  reviewRecorderEvidenceCandidate,
} from "../sidecar/recorder-evidence-review.mjs";
import { buildRecorderEvidenceInboxCandidates } from "../sidecar/recorder-evidence-inbox-builder.mjs";
import { RecorderStore } from "../sidecar/recorder-store.mjs";

async function makeContext() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-recorder-evidence-review-"));
  const workspaceRoot = path.join(root, "workspace");
  await fs.mkdir(workspaceRoot, { recursive: true });
  const store = new RecorderStore({ appSupportRoot: path.join(root, "app-support") }).open();
  return { root, workspaceRoot, store };
}

function insertProductEvent(store, overrides = {}) {
  store.insertRecord("product_events", {
    id: "event-1",
    workspace_id: "workspace-1",
    project_id: "project-1",
    event_type: "customer_interview",
    occurred_at: "2026-06-27T12:00:00.000Z",
    title: "Customer reply candidate",
    summary: "Named founder described activation friction",
    source_ids_json: JSON.stringify([
      { id: "frame-1", source_type: "frame" },
      { id: "memory-1", source_type: "memory_summary" },
    ]),
    safe_for_search: 1,
    safe_for_memory: 1,
    safe_for_export: 0,
    verification_status: "unverified",
    proof_ledger_event_id: null,
    confidence: "medium",
    created_by: "test",
    created_at: "2026-06-27T12:05:00.000Z",
    deleted_at: null,
    ...overrides,
  });
}

function pendingCandidate(overrides = {}) {
  return {
    id: "candidate-1",
    workspaceId: "workspace-1",
    projectId: "project-1",
    candidateStatus: "pending_review",
    sourceState: "memory_safe",
    claim: "Named customer replied with activation friction.",
    proofKind: "customer_reply",
    sourceIds: [
      { id: "frame-1", source_kind: "raw_frame" },
      { id: "memory-1", source_kind: "memory_summary" },
    ],
    proofLedgerMapping: {
      targetGate: "customer_evidence",
      event: {
        type: "interview",
        day: 1,
        status: "submitted",
        strength: "medium",
        evidenceType: "recorder_candidate",
        title: "Customer reply candidate",
        summary: "Named customer replied with activation friction.",
        metadata: { targetGate: "customer_evidence" },
      },
    },
    evidenceDebt: ["Attach external customer reply before approval."],
    immutableFingerprint: "sha256:candidate-1",
    idempotencyKey: "candidate-1:write",
    createdBy: "evidence-inbox-builder",
    createdAt: "2026-06-27T12:00:00.000Z",
    ...overrides,
  };
}

test("reviewRecorderEvidenceCandidate approves with external artifact, then strict adapter writes proof", async () => {
  const { workspaceRoot, store } = await makeContext();
  try {
    insertProductEvent(store);
    const build = buildRecorderEvidenceInboxCandidates({
      store,
      workspaceId: "workspace-1",
      projectId: "project-1",
      now: new Date("2026-06-27T13:00:00.000Z"),
    });
    const candidateId = build.created[0].id;

    const review = reviewRecorderEvidenceCandidate({
      store,
      candidateId,
      decision: "approve_bundle",
      reviewerId: "user-1",
      reason: "Verified customer reply screenshot.",
      externalArtifact: {
        id: "external-reply-1",
        kind: "customer_reply",
        url: "https://example.com/customer-reply",
        customer: "founder A",
        status: "accepted",
        strength: "medium",
      },
      now: new Date("2026-06-27T13:30:00.000Z"),
    });

    assert.equal(review.status, "approved_bundle");
    assert.equal(review.proofAcceptedByReview, false);
    assert.equal(review.candidate.candidate_status, "approved_bundle");
    assert.equal(review.candidate.source_state, "approved_external");
    assert.equal(review.candidate.reviewed_at, "2026-06-27T13:30:00.000Z");
    assert.equal(JSON.parse(review.candidate.evidence_debt_json).length, 0);
    assert.match(review.candidate.source_ids_json, /external-reply-1/);
    assert.match(review.candidate.verifier_result_json, /Verified customer reply screenshot/);

    const writeResult = await writeEvidenceCandidateThroughProofLedger({
      store,
      workspaceRoot,
      candidateId,
      now: new Date("2026-06-27T14:00:00.000Z"),
    });
    assert.equal(writeResult.status, "written_to_ledger");
    const ledger = await loadProofLedger({ workspaceRoot });
    assert.equal(ledger.events.length, 1);
    assert.equal(ledger.events[0].status, "accepted");
    assert.equal(ledger.events[0].metadata.recorderEvidenceExternalArtifactId, "external-reply-1");
  } finally {
    store.close();
  }
});

test("reviewRecorderEvidenceCandidate rejects with root cause and never writes proof", async () => {
  const { workspaceRoot, store } = await makeContext();
  try {
    insertRecorderEvidenceCandidate(store, pendingCandidate());

    const review = reviewRecorderEvidenceCandidate({
      store,
      candidateId: "candidate-1",
      decision: "rejected",
      reviewerId: "user-1",
      reason: "This was an internal note, not a customer artifact.",
      now: new Date("2026-06-27T13:30:00.000Z"),
    });

    assert.equal(review.status, "rejected");
    assert.equal(review.candidate.candidate_status, "rejected");
    assert.match(review.candidate.verifier_result_json, /USER_REJECTED_RECORDER_EVIDENCE/);
    assert.match(review.candidate.verifier_result_json, /internal note/);

    const writeResult = await writeEvidenceCandidateThroughProofLedger({
      store,
      workspaceRoot,
      candidateId: "candidate-1",
      now: new Date("2026-06-27T14:00:00.000Z"),
    });
    assert.equal(writeResult.status, "verifier_rejected");
    assert.match(writeResult.candidate.verifier_result_json, /ERR_RECORDER_PROOF_CANDIDATE_NOT_APPROVED/);
    const ledger = await loadProofLedger({ workspaceRoot });
    assert.equal(ledger.events.length, 0);
  } finally {
    store.close();
  }
});

test("reviewRecorderEvidenceCandidate requires external artifacts and root-cause rejection reasons", async () => {
  const { store } = await makeContext();
  try {
    insertRecorderEvidenceCandidate(store, pendingCandidate());

    assert.throws(
      () => reviewRecorderEvidenceCandidate({
        store,
        candidateId: "candidate-1",
        decision: "approve_bundle",
        externalArtifact: { id: "draft-1", kind: "draft", url: "https://example.com/draft" },
      }),
      (error) => error instanceof RecorderEvidenceReviewError
        && error.code === "ERR_RECORDER_EVIDENCE_REVIEW_REJECTED_KIND",
    );
    assert.throws(
      () => reviewRecorderEvidenceCandidate({
        store,
        candidateId: "candidate-1",
        decision: "approve_bundle",
        externalArtifact: { id: "reply-1", kind: "customer_reply" },
      }),
      (error) => error instanceof RecorderEvidenceReviewError
        && error.code === "ERR_RECORDER_EVIDENCE_REVIEW_EXTERNAL_ARTIFACT_LOCATION_REQUIRED",
    );
    assert.throws(
      () => reviewRecorderEvidenceCandidate({
        store,
        candidateId: "candidate-1",
        decision: "rejected",
      }),
      (error) => error instanceof RecorderEvidenceReviewError
        && error.code === "ERR_RECORDER_EVIDENCE_REVIEW_REASON_REQUIRED",
    );
  } finally {
    store.close();
  }
});
