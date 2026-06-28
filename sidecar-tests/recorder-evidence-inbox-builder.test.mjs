import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { loadProofLedger } from "../sidecar/execution-os.mjs";
import {
  RecorderEvidenceInboxBuilderError,
  buildRecorderEvidenceInboxCandidates,
} from "../sidecar/recorder-evidence-inbox-builder.mjs";
import { writeEvidenceCandidateThroughProofLedger } from "../sidecar/recorder-evidence-candidates.mjs";
import { RecorderStore } from "../sidecar/recorder-store.mjs";

async function makeContext() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-recorder-evidence-builder-"));
  const workspaceRoot = path.join(root, "workspace");
  await fs.mkdir(workspaceRoot, { recursive: true });
  const store = new RecorderStore({ appSupportRoot: path.join(root, "app-support") }).open();
  return { root, workspaceRoot, store };
}

function insertProductEvent(store, overrides = {}) {
  const id = overrides.id || "event-1";
  store.insertRecord("product_events", {
    id,
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

test("buildRecorderEvidenceInboxCandidates creates unverified candidates and updates product events", async () => {
  const { workspaceRoot, store } = await makeContext();
  try {
    insertProductEvent(store);

    const result = buildRecorderEvidenceInboxCandidates({
      store,
      workspaceId: "workspace-1",
      projectId: "project-1",
      startedAt: "2026-06-27T00:00:00.000Z",
      endedAt: "2026-06-28T00:00:00.000Z",
      now: new Date("2026-06-27T13:00:00.000Z"),
    });

    assert.equal(result.schema, "agentic30.recorder.evidence_inbox_builder.v1");
    assert.equal(result.createdCount, 1);
    assert.equal(result.proofBoundary.proofAcceptedByBuilder, false);
    const candidate = result.created[0];
    assert.equal(candidate.workspace_id, "workspace-1");
    assert.equal(candidate.project_id, "project-1");
    assert.equal(candidate.candidate_status, "pending_review");
    assert.equal(candidate.source_state, "memory_safe");
    assert.equal(candidate.proof_kind, "customer_reply");
    assert.match(candidate.claim, /Customer reply candidate/);
    assert.match(candidate.evidence_debt_json, /not proof without accepted external verifier review/);
    assert.match(candidate.source_ids_json, /product_event/);
    assert.match(candidate.source_ids_json, /raw_frame/);
    assert.match(candidate.source_ids_json, /memory_summary/);
    assert.equal(store.getRecord("product_events", "event-1").verification_status, "candidate_created");

    const mapping = JSON.parse(candidate.proof_ledger_mapping_json);
    mapping.event.status = "accepted";
    store.updateRecord("evidence_candidates", candidate.id, {
      candidate_status: "approved_bundle",
      proof_ledger_mapping_json: JSON.stringify(mapping),
    });
    const writeResult = await writeEvidenceCandidateThroughProofLedger({
      store,
      workspaceRoot,
      candidateId: candidate.id,
      now: new Date("2026-06-27T14:00:00.000Z"),
    });
    assert.equal(writeResult.status, "verifier_rejected");
    assert.match(writeResult.candidate.verifier_result_json, /ERR_RECORDER_PROOF_NON_EXTERNAL_SOURCE/);

    const ledger = await loadProofLedger({ workspaceRoot });
    assert.equal(ledger.events.length, 0);
  } finally {
    store.close();
  }
});

test("buildRecorderEvidenceInboxCandidates degrades source-less events and skips unsupported or out-of-scope events", async () => {
  const { store } = await makeContext();
  try {
    insertProductEvent(store, {
      id: "event-payment",
      event_type: "payment_record",
      title: "Payment record candidate",
      summary: "Payment processor receipt needs review",
      source_ids_json: JSON.stringify([]),
    });
    insertProductEvent(store, {
      id: "event-build",
      event_type: "build_or_test",
      title: "Build passed",
      summary: "Internal build output",
    });
    insertProductEvent(store, {
      id: "event-other-workspace",
      workspace_id: "workspace-2",
      project_id: "project-2",
      title: "Other workspace candidate",
      summary: "Should not be selected",
    });

    const result = buildRecorderEvidenceInboxCandidates({
      store,
      workspaceId: "workspace-1",
      projectId: "project-1",
      now: new Date("2026-06-27T13:00:00.000Z"),
    });

    assert.equal(result.createdCount, 1);
    assert.equal(result.created[0].candidate_status, "degraded");
    assert.equal(result.created[0].proof_kind, "payment");
    assert.match(result.created[0].evidence_debt_json, /no source ids/);
    assert.equal(result.skippedCount, 1);
    assert.equal(result.skipped[0].reason, "unsupported_product_event_type");
    assert.equal(store.getRecord("product_events", "event-payment").verification_status, "candidate_created");
    assert.equal(store.getRecord("product_events", "event-build").verification_status, "unverified");
    assert.equal(store.getRecord("product_events", "event-other-workspace").verification_status, "unverified");
  } finally {
    store.close();
  }
});

test("buildRecorderEvidenceInboxCandidates is deterministic and fails on unsafe safe-for-memory text", async () => {
  const { store } = await makeContext();
  try {
    insertProductEvent(store);

    const first = buildRecorderEvidenceInboxCandidates({
      store,
      workspaceId: "workspace-1",
      projectId: "project-1",
      now: new Date("2026-06-27T13:00:00.000Z"),
    });
    const second = buildRecorderEvidenceInboxCandidates({
      store,
      workspaceId: "workspace-1",
      projectId: "project-1",
      now: new Date("2026-06-27T13:05:00.000Z"),
    });

    assert.equal(first.createdCount, 1);
    assert.equal(second.createdCount, 0);
    assert.equal(second.skippedCount, 0);

    insertProductEvent(store, {
      id: "event-unsafe",
      title: "Unsafe customer@example.com candidate",
      summary: "contains secret: abc123",
    });
    assert.throws(
      () => buildRecorderEvidenceInboxCandidates({ store }),
      (error) => error instanceof RecorderEvidenceInboxBuilderError
        && error.code === "ERR_RECORDER_EVIDENCE_BUILDER_UNSAFE_PRODUCT_EVENT_TEXT",
    );
  } finally {
    store.close();
  }
});
