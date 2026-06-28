import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  RecorderDayMemoryReviewError,
  buildRecorderDayMemoryReview,
  writeRecorderDayMemoryReviewSnapshot,
} from "../sidecar/recorder-day-memory-review.mjs";
import { insertRecorderEvidenceCandidate } from "../sidecar/recorder-evidence-candidates.mjs";
import { recordFrameCaptureEnvelope } from "../sidecar/recorder-ingest.mjs";
import { RecorderStore } from "../sidecar/recorder-store.mjs";

async function makeStore() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-recorder-day-review-"));
  const store = new RecorderStore({ appSupportRoot: path.join(root, "app-support") }).open();
  return { root, store };
}

function frameEnvelope(overrides = {}) {
  return {
    id: "frame-1",
    workspaceId: "workspace-1",
    projectId: "project-1",
    capturedAt: "2026-06-27T09:30:00.000Z",
    monitorId: "main",
    captureTrigger: "app_switch",
    appName: "Codex",
    windowTitle: "Founder Memory OS",
    browserUrl: "https://example.com/customer#raw",
    contentHash: "sha256:frame-content",
    privacyState: "search_safe",
    dataClass: "screen",
    safeForSearch: true,
    safeForMemory: true,
    safeForExport: false,
    snapshot: {
      id: "asset-1",
      relativePath: "media/frames/2026-06-27/frame-1.jpg",
      sha256: "sha256:snapshot",
      byteSize: 128,
      encrypted: false,
    },
    text: {
      textSource: "accessibility",
      accessibilityText: "raw private customer@example.com secret token",
      ocrText: "raw OCR token",
      redactedText: "customer reply activation friction",
      redactionStatus: "redacted",
    },
    ...overrides,
  };
}

function insertProductEvent(store) {
  store.insertRecord("product_events", {
    id: "product-event-1",
    workspace_id: "workspace-1",
    project_id: "project-1",
    event_type: "customer_interview",
    occurred_at: "2026-06-27T10:00:00.000Z",
    title: "Customer interview reviewed",
    summary: "Redacted customer activation friction was found.",
    source_ids_json: JSON.stringify([{ id: "frame-1", source_kind: "frame" }]),
    safe_for_search: 1,
    safe_for_memory: 1,
    safe_for_export: 0,
    verification_status: "candidate_created",
    proof_ledger_event_id: null,
    confidence: "medium",
    created_by: "day-memory-review-test",
    created_at: "2026-06-27T10:01:00.000Z",
  });
}

function insertMemoryItem(store, overrides = {}) {
  store.insertRecord("memory_items", {
    id: "memory-1",
    workspace_id: "workspace-1",
    project_id: "project-1",
    memory_type: "daily_summary",
    title: "Day Memory Review",
    summary: "Redacted summary: activation friction and next external ask.",
    source_ids_json: JSON.stringify([{ id: "frame-1", source_kind: "frame" }]),
    time_range_json: JSON.stringify({
      started_at: "2026-06-27T09:00:00.000Z",
      ended_at: "2026-06-27T18:00:00.000Z",
    }),
    redaction_status: "redacted",
    privacy_state: "memory_safe",
    safe_for_search: 1,
    safe_for_memory: 1,
    safe_for_export: 0,
    confidence: "medium",
    created_by: "day-memory-review-test",
    created_at: "2026-06-27T10:05:00.000Z",
    ...overrides,
  });
}

function insertPendingCandidate(store) {
  insertRecorderEvidenceCandidate(store, {
    id: "candidate-1",
    workspaceId: "workspace-1",
    projectId: "project-1",
    candidateStatus: "pending_review",
    sourceState: "memory_safe",
    claim: "Redacted customer replied with concrete activation friction.",
    proofKind: "customer_reply",
    sourceIds: [{ id: "frame-1", source_kind: "frame" }],
    proofLedgerMapping: {},
    evidenceDebt: [],
    immutableFingerprint: "sha256:candidate-1",
    idempotencyKey: "candidate-1:write",
    createdBy: "day-memory-review-test",
    createdAt: "2026-06-27T10:10:00.000Z",
  });
}

test("buildRecorderDayMemoryReview summarizes recorder rows without raw frame text", async () => {
  const { store } = await makeStore();
  try {
    recordFrameCaptureEnvelope(store, frameEnvelope());
    recordFrameCaptureEnvelope(store, frameEnvelope({
      id: "frame-2",
      capturedAt: "2026-06-27T11:30:00.000Z",
      captureTrigger: "typing_pause",
      appName: "Agentic30",
      snapshot: {
        id: "asset-2",
        relativePath: "media/frames/2026-06-27/frame-2.jpg",
        sha256: "sha256:snapshot-2",
        byteSize: 256,
      },
      text: {
        textSource: "ocr",
        accessibilityText: "raw another@example.com",
        redactedText: "redacted product event evidence",
        redactionStatus: "redacted",
      },
    }));
    insertProductEvent(store);
    insertMemoryItem(store);
    insertPendingCandidate(store);

    const review = buildRecorderDayMemoryReview({
      store,
      workspaceId: "workspace-1",
      projectId: "project-1",
      startedAt: "2026-06-27T00:00:00.000Z",
      endedAt: "2026-06-28T00:00:00.000Z",
      now: new Date("2026-06-27T12:00:00.000Z"),
    });

    assert.equal(review.status.state, "ready");
    assert.equal(review.capture.frameCount, 2);
    assert.equal(review.capture.searchSafeFrameCount, 2);
    assert.equal(review.capture.samples.length, 2);
    assert.deepEqual(review.capture.topApps.map((item) => item.value).sort(), ["Agentic30", "Codex"]);
    assert.equal(review.productEvents.total, 1);
    assert.equal(review.memoryItems.safeForMemoryCount, 1);
    assert.equal(review.evidenceInbox.countsByStatus.pending_review, 1);
    assert.equal(review.evidenceInbox.writtenToLedgerCount, 0);
    assert.equal(review.proofBoundary.proofAcceptedByReview, false);

    const json = JSON.stringify(review);
    assert.match(json, /customer reply activation friction/);
    assert.doesNotMatch(json, /customer@example\.com/);
    assert.doesNotMatch(json, /another@example\.com/);
    assert.doesNotMatch(json, /secret token/);
    assert.doesNotMatch(json, /raw OCR token/);
  } finally {
    store.close();
  }
});

test("buildRecorderDayMemoryReview returns explicit empty states for no capture", async () => {
  const { store } = await makeStore();
  try {
    const review = buildRecorderDayMemoryReview({
      store,
      startedAt: "2026-06-27T00:00:00.000Z",
      endedAt: "2026-06-28T00:00:00.000Z",
    });

    assert.equal(review.status.state, "empty");
    assert.equal(review.capture.frameCount, 0);
    assert.deepEqual(review.emptyStates.map((state) => state.id), ["no_capture", "no_accepted_proof"]);
    assert.equal(review.warnings.some((warning) => warning.id === "proof_not_advanced"), true);
  } finally {
    store.close();
  }
});

test("buildRecorderDayMemoryReview requires explicit time range", async () => {
  const { store } = await makeStore();
  try {
    assert.throws(
      () => buildRecorderDayMemoryReview({
        store,
        startedAt: "2026-06-28T00:00:00.000Z",
        endedAt: "2026-06-27T00:00:00.000Z",
      }),
      (error) => error instanceof RecorderDayMemoryReviewError
        && error.code === "ERR_RECORDER_DAY_REVIEW_INVALID_RANGE",
    );
  } finally {
    store.close();
  }
});

test("writeRecorderDayMemoryReviewSnapshot persists redacted review under workspace recorder summaries", async () => {
  const { store } = await makeStore();
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-recorder-day-review-workspace-"));
  try {
    recordFrameCaptureEnvelope(store, frameEnvelope());
    insertProductEvent(store);
    insertMemoryItem(store);
    insertPendingCandidate(store);
    const review = buildRecorderDayMemoryReview({
      store,
      workspaceId: "workspace-1",
      projectId: "project-1",
      startedAt: "2026-06-27T00:00:00.000Z",
      endedAt: "2026-06-28T00:00:00.000Z",
      now: new Date("2026-06-27T12:00:00.000Z"),
    });

    const result = await writeRecorderDayMemoryReviewSnapshot({
      workspaceRoot,
      review,
      now: new Date("2026-06-27T12:30:00.000Z"),
    });

    assert.equal(result.relativePath, path.join(".agentic30", "recorder", "memory-summaries", "day-memory-review-2026-06-27.json"));
    const persisted = JSON.parse(await fs.readFile(result.filePath, "utf8"));
    assert.equal(persisted.schema, "agentic30.recorder.day_memory_review.v1");
    assert.equal(persisted.persistedAt, "2026-06-27T12:30:00.000Z");
    assert.equal(persisted.proofBoundary.proofAcceptedByReview, false);
    const json = JSON.stringify(persisted);
    assert.match(json, /customer reply activation friction/);
    assert.doesNotMatch(json, /customer@example\.com/);
    assert.doesNotMatch(json, /secret token/);
  } finally {
    store.close();
  }
});

test("writeRecorderDayMemoryReviewSnapshot rejects raw frame fields", async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-recorder-day-review-workspace-"));
  await assert.rejects(
    () => writeRecorderDayMemoryReviewSnapshot({
      workspaceRoot,
      review: {
        schema: "agentic30.recorder.day_memory_review.v1",
        timeRange: {
          startedAt: "2026-06-27T00:00:00.000Z",
          endedAt: "2026-06-28T00:00:00.000Z",
        },
        capture: {
          samples: [{ accessibility_text: "raw private text" }],
        },
      },
    }),
    (error) => error instanceof RecorderDayMemoryReviewError
      && error.code === "ERR_RECORDER_DAY_REVIEW_RAW_FIELD",
  );
});
