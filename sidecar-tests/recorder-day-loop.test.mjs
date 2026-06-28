import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { loadProofLedger } from "../sidecar/execution-os.mjs";
import {
  RecorderDayLoopError,
  runRecorderDayMemoryLoop,
} from "../sidecar/recorder-day-loop.mjs";
import { recordFrameCaptureEnvelope } from "../sidecar/recorder-ingest.mjs";
import { RecorderStore } from "../sidecar/recorder-store.mjs";

async function makeContext() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-recorder-day-loop-"));
  const workspaceRoot = path.join(root, "workspace");
  await fs.mkdir(workspaceRoot, { recursive: true });
  const store = new RecorderStore({ appSupportRoot: path.join(root, "app-support") }).open();
  return { root, workspaceRoot, store };
}

function frameEnvelope(overrides = {}) {
  return {
    id: "frame-1",
    workspaceId: "workspace-1",
    projectId: "project-1",
    capturedAt: "2026-06-27T10:00:00.000Z",
    monitorId: "main",
    captureTrigger: "typing_pause",
    appName: "Codex",
    windowTitle: "Founder Memory OS",
    browserDomain: "example.com",
    contentHash: "content-hash-1",
    text: {
      textSource: "accessibility",
      accessibilityText: "raw private customer@example.com",
      redactedText: "redacted founder activation friction",
      redactionStatus: "redacted",
      safeForSearch: true,
    },
    privacyState: "searchable_local",
    safeForMemory: true,
    safeForExport: false,
    snapshot: {
      id: "asset-frame-1",
      relativePath: "media/frames/frame-1.jpg",
      sha256: "sha256-frame-1",
      byteSize: 128,
      encrypted: true,
    },
    ...overrides,
  };
}

function insertProductEvent(store, overrides = {}) {
  store.insertRecord("product_events", {
    id: "event-1",
    workspace_id: "workspace-1",
    project_id: "project-1",
    event_type: "customer_interview",
    occurred_at: "2026-06-27T11:00:00.000Z",
    title: "Customer reply candidate",
    summary: "Named founder described activation friction",
    source_ids_json: JSON.stringify([
      { id: "frame-1", source_type: "frame" },
    ]),
    safe_for_search: 1,
    safe_for_memory: 1,
    safe_for_export: 0,
    verification_status: "unverified",
    proof_ledger_event_id: null,
    confidence: "medium",
    created_by: "test",
    created_at: "2026-06-27T11:05:00.000Z",
    deleted_at: null,
    ...overrides,
  });
}

test("runRecorderDayMemoryLoop builds review, Evidence Inbox candidates, next action, and snapshot without proof writes", async () => {
  const { workspaceRoot, store } = await makeContext();
  try {
    recordFrameCaptureEnvelope(store, frameEnvelope());
    insertProductEvent(store);

    const result = await runRecorderDayMemoryLoop({
      store,
      workspaceRoot,
      workspaceId: "workspace-1",
      projectId: "project-1",
      startedAt: "2026-06-27T00:00:00.000Z",
      endedAt: "2026-06-28T00:00:00.000Z",
      now: new Date("2026-06-27T18:00:00.000Z"),
      persistReviewSnapshot: true,
    });

    assert.equal(result.schema, "agentic30.recorder.day_loop.v1");
    assert.equal(result.proofBoundary.proofAcceptedByDayLoop, false);
    assert.equal(result.evidenceBuildResult.createdCount, 1);
    assert.equal(result.stages.reviewBeforeEvidence.evidenceInboxCounts.pending_review, 0);
    assert.equal(result.stages.finalReview.evidenceInboxCounts.pending_review, 1);
    assert.equal(result.review.evidenceInbox.unresolvedCount, 1);
    assert.equal(result.nextAction.action.actionType, "review_evidence_inbox");
    assert.equal(result.snapshot.persisted, true);
    assert.equal(result.snapshot.relativePath, path.join(".agentic30", "recorder", "memory-summaries", "day-memory-review-2026-06-27.json"));
    assert.equal(store.getRecord("product_events", "event-1").verification_status, "candidate_created");

    const persisted = JSON.parse(await fs.readFile(path.join(workspaceRoot, result.snapshot.relativePath), "utf8"));
    const json = JSON.stringify(persisted);
    assert.match(json, /redacted founder activation friction/);
    assert.doesNotMatch(json, /customer@example\.com/);

    const ledger = await loadProofLedger({ workspaceRoot });
    assert.equal(ledger.events.length, 0);
  } finally {
    store.close();
  }
});

test("runRecorderDayMemoryLoop names no-capture root cause and does not require snapshot persistence", async () => {
  const { store } = await makeContext();
  try {
    const result = await runRecorderDayMemoryLoop({
      store,
      workspaceId: "workspace-1",
      projectId: "project-1",
      startedAt: "2026-06-27T00:00:00.000Z",
      endedAt: "2026-06-28T00:00:00.000Z",
      now: new Date("2026-06-27T18:00:00.000Z"),
    });

    assert.equal(result.review.status.state, "empty");
    assert.equal(result.evidenceBuildResult.createdCount, 0);
    assert.equal(result.nextAction.action.actionType, "resolve_recorder_health");
    assert.match(result.nextAction.action.instruction, /no_capture_rows/);
    assert.equal(result.snapshot.persisted, false);
  } finally {
    store.close();
  }
});

test("runRecorderDayMemoryLoop fails explicitly for invalid range and missing snapshot workspace", async () => {
  const { store } = await makeContext();
  try {
    await assert.rejects(
      () => runRecorderDayMemoryLoop({
        store,
        startedAt: "2026-06-28T00:00:00.000Z",
        endedAt: "2026-06-27T00:00:00.000Z",
      }),
      (error) => error instanceof RecorderDayLoopError
        && error.code === "ERR_RECORDER_DAY_LOOP_INVALID_RANGE",
    );
    await assert.rejects(
      () => runRecorderDayMemoryLoop({
        store,
        startedAt: "2026-06-27T00:00:00.000Z",
        endedAt: "2026-06-28T00:00:00.000Z",
        persistReviewSnapshot: true,
      }),
      (error) => error instanceof RecorderDayLoopError
        && error.code === "ERR_RECORDER_DAY_LOOP_WORKSPACE_REQUIRED",
    );
  } finally {
    store.close();
  }
});
