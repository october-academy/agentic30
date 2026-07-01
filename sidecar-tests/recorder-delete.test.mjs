import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  RecorderDeleteError,
  deleteRecorderAudioChunksInRange,
  deleteRecorderAuditRowsInRange,
  deleteRecorderClipboardEventsInRange,
  deleteRecorderEvidenceCandidatesInRange,
  deleteRecorderExportArchivesInRange,
  deleteRecorderFrameCapture,
  deleteRecorderFrameCapturesInRange,
  deleteRecorderMemoryItemsInRange,
  deleteRecorderPipeRunOutput,
  deleteRecorderPipeRunsInRange,
  deleteRecorderProductEventsInRange,
  resolveRecorderAudioMediaPath,
  resolveRecorderExportArchiveMediaPath,
  resolveRecorderFrameMediaPath,
} from "../sidecar/recorder-delete.mjs";
import { recordAudioChunk } from "../sidecar/recorder-audio.mjs";
import { recordClipboardEvent } from "../sidecar/recorder-clipboard.mjs";
import {
  makeDefaultRecorderControlState,
  transitionRecorderControlState,
} from "../sidecar/recorder-control-state.mjs";
import { recordFrameCaptureEnvelope } from "../sidecar/recorder-ingest.mjs";
import { RecorderStore } from "../sidecar/recorder-store.mjs";

const DELETED_MEDIA_SHA256 = "0".repeat(64);

async function makeStore() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-recorder-delete-"));
  const store = new RecorderStore({ appSupportRoot: path.join(root, "app-support") }).open();
  return { root, store };
}

function envelope(overrides = {}) {
  return {
    id: "frame-1",
    workspaceId: "workspace-1",
    projectId: "project-1",
    capturedAt: "2026-06-27T12:00:00.000Z",
    monitorId: "main",
    captureTrigger: "typing_pause",
    appName: "Codex",
    windowTitle: "Founder Memory OS",
    contentHash: "sha256:frame-content",
    privacyState: "search_safe",
    dataClass: "screen",
    safeForSearch: true,
    safeForMemory: true,
    safeForExport: true,
    snapshot: {
      id: "asset-1",
      relativePath: "media/frames/2026-06-27/frame-1.jpg",
      sha256: "sha256:snapshot",
      byteSize: 14,
      encrypted: false,
    },
    text: {
      textSource: "accessibility_only",
      accessibilityText: "raw private customer@example.com",
      redactedText: "redacted deletion proof",
      redactionStatus: "redacted",
    },
    ...overrides,
  };
}

async function writePhysicalMedia(store, mediaAsset) {
  const mediaPath = resolveRecorderFrameMediaPath(store, mediaAsset);
  await fs.mkdir(path.dirname(mediaPath), { recursive: true });
  await fs.writeFile(mediaPath, "jpeg bytes here");
  return mediaPath;
}

async function writePhysicalAudio(store, mediaAsset) {
  const mediaPath = resolveRecorderAudioMediaPath(store, mediaAsset);
  await fs.mkdir(path.dirname(mediaPath), { recursive: true });
  await fs.writeFile(mediaPath, "m4a bytes here");
  return mediaPath;
}

async function writePhysicalExportArchive(store, mediaAsset, content = "{\"schema\":\"agentic30.recorder.export_archive.v1\"}") {
  const mediaPath = resolveRecorderExportArchiveMediaPath(store, mediaAsset);
  await fs.mkdir(path.dirname(mediaPath), { recursive: true });
  await fs.writeFile(mediaPath, content);
  return mediaPath;
}

function assertDeletedMediaAssetPurged(store, id, { assetType, deletedAt } = {}) {
  const row = store.getRecord("media_assets", id);
  assert.equal(row.deleted_at, deletedAt);
  assert.equal(row.relative_path, deletedMediaRelativePath({ assetType, id }));
  assert.equal(row.sha256, DELETED_MEDIA_SHA256);
  assert.equal(row.byte_size, 0);
  assert.equal(row.encrypted, 0);
  assert.equal(row.encryption_key_id, null);
  assert.equal(row.encryption_alg, null);
  assert.equal(row.encryption_nonce, null);
  assert.equal(row.encryption_tag, null);
  assert.equal(row.source_ids_json, "[]");
}

function deletedMediaRelativePath({ assetType, id } = {}) {
  if (assetType === "frame_jpeg") return `media/frames/deleted/${id}.deleted`;
  if (assetType === "audio_m4a") return `media/audio/deleted/${id}.deleted`;
  if (assetType === "export_bundle") return `exports/deleted-${id}.json`;
  throw new Error(`unsupported media asset test type: ${assetType}`);
}

function readyAudioControlState() {
  const now = new Date("2026-06-27T12:00:00.000Z");
  let state = makeDefaultRecorderControlState({ now });
  state = transitionRecorderControlState(state, {
    type: "grant_consent",
    visibleIndicatorAcknowledged: true,
  }, { now });
  for (const permission of ["screenRecording", "accessibility", "microphone"]) {
    state = transitionRecorderControlState(state, {
      type: "set_permission",
      permission,
      state: "granted",
    }, { now });
  }
  return transitionRecorderControlState(state, {
    type: "set_sensitive_capture",
    microphone: true,
  }, { now });
}

function audioChunk({ id, assetId, segmentId, startedAt, endedAt, redactedText, workspaceId = "workspace-1" } = {}) {
  return {
    id,
    workspaceId,
    projectId: "project-1",
    startedAt,
    endedAt,
    source: "microphone",
    transcriptStatus: "local_complete",
    consentGrantId: "consent-delete-test",
    rawAudioIndicatorState: "visible_indicator_active",
    localTranscriberName: "agentic30-local-transcriber-test",
    localTranscriberVersion: "0.0.0-test",
    redactionStatus: "redacted",
    privacyState: "raw_local",
    audioAsset: {
      id: assetId,
      relativePath: `media/audio/2026-06-27/${id}.m4a`,
      sha256: "a".repeat(64),
      byteSize: 1024,
      encrypted: false,
    },
    transcriptSegments: [
      {
        id: segmentId,
        startedAt,
        endedAt,
        speakerLabel: "founder",
        speakerLabelProvenance: "local_transcriber",
        text: `raw transcript ${id} customer@example.com token=secret`,
        redactedText,
        redactionStatus: "redacted",
        privacyState: "searchable_local",
        safeForSearch: true,
        safeForMemory: true,
      },
    ],
  };
}

function readyClipboardControlState({ contentOptIn = true } = {}) {
  const now = new Date("2026-06-27T12:00:00.000Z");
  let state = makeDefaultRecorderControlState({ now });
  state = transitionRecorderControlState(state, {
    type: "grant_consent",
    visibleIndicatorAcknowledged: true,
  }, { now });
  for (const permission of ["screenRecording", "accessibility", "clipboard"]) {
    state = transitionRecorderControlState(state, {
      type: "set_permission",
      permission,
      state: "granted",
    }, { now });
  }
  if (contentOptIn) {
    state = transitionRecorderControlState(state, {
      type: "set_sensitive_capture",
      clipboardMode: "content_opt_in",
    }, { now });
  }
  return state;
}

function clipboardEvent({ id, occurredAt, redactedText, contentText = "raw copied customer note", workspaceId = "workspace-1" } = {}) {
  return {
    id,
    workspaceId,
    projectId: "project-1",
    occurredAt,
    eventKind: "copy",
    appName: "Agentic30",
    windowTitle: "Founder Replay",
    contentType: "text",
    contentText,
    redactedText,
    redactionStatus: "redacted",
    privacyState: "searchable_local",
    safeForSearch: true,
    safeForMemory: true,
    safeForExport: true,
  };
}

function insertMemoryItem(store, {
  id,
  createdAt,
  title,
  summary,
  workspaceId = "workspace-1",
  sourceIds = [{ id: "frame-1", source_type: "frame" }],
} = {}) {
  store.insertRecord("memory_items", {
    id,
    workspace_id: workspaceId,
    project_id: "project-1",
    memory_type: "daily_summary",
    title,
    summary,
    source_ids_json: JSON.stringify(sourceIds),
    time_range_json: JSON.stringify({ start: "2026-06-27T00:00:00.000Z", end: "2026-06-27T23:59:59.000Z" }),
    redaction_status: "redacted",
    privacy_state: "memory_safe",
    safe_for_search: 1,
    safe_for_memory: 1,
    safe_for_export: 1,
    confidence: "medium",
    created_by: "daily-founder-memory",
    created_at: createdAt,
  });
}

function insertProductEvent(store, {
  id,
  occurredAt,
  title,
  summary,
  workspaceId = "workspace-1",
  proofLedgerEventId = null,
  sourceIds = [{ id: "memory-old", source_type: "memory" }],
} = {}) {
  store.insertRecord("product_events", {
    id,
    workspace_id: workspaceId,
    project_id: "project-1",
    event_type: "customer_interview",
    occurred_at: occurredAt,
    title,
    summary,
    source_ids_json: JSON.stringify(sourceIds),
    safe_for_search: 1,
    safe_for_memory: 1,
    safe_for_export: 1,
    verification_status: proofLedgerEventId ? "written_to_ledger" : "unverified",
    proof_ledger_event_id: proofLedgerEventId,
    confidence: "medium",
    created_by: "evidence-inbox-builder",
    created_at: occurredAt,
  });
}

function insertEvidenceCandidate(store, {
  id,
  candidateStatus = "pending_review",
  sourceState = "memory_safe",
  claim,
  proofKind = "customer_reply",
  createdAt,
  reviewedAt = null,
  workspaceId = "workspace-1",
  proofLedgerEventId = null,
  sourceIds = [{ id: "memory-old", source_type: "memory" }],
} = {}) {
  store.insertRecord("evidence_candidates", {
    id,
    workspace_id: workspaceId,
    project_id: "project-1",
    candidate_status: candidateStatus,
    source_state: sourceState,
    claim,
    proof_kind: proofKind,
    source_ids_json: JSON.stringify(sourceIds),
    proof_ledger_mapping_json: JSON.stringify({
      event: {
        type: "interview",
        status: "accepted",
        strength: "medium",
      },
    }),
    evidence_debt_json: JSON.stringify([]),
    immutable_fingerprint: `sha256:${id}`,
    idempotency_key: `${id}:write`,
    verifier_result_json: null,
    proof_ledger_event_id: proofLedgerEventId,
    created_by: "evidence-inbox-builder",
    created_at: createdAt,
    reviewed_at: reviewedAt,
  });
}

function assertDeletedCandidateMaterialPurged(candidate, { id, status, reasonCode } = {}) {
  assert.equal(candidate.claim, "");
  assert.equal(candidate.source_state, "deleted");
  assert.equal(candidate.proof_kind, "deleted");
  assert.equal(candidate.source_ids_json, "[]");
  assert.equal(candidate.proof_ledger_mapping_json, "{}");
  assert.equal(candidate.evidence_debt_json, "[]");
  assert.equal(candidate.immutable_fingerprint, `deleted:${id}`);
  assert.equal(candidate.idempotency_key, `deleted:${id}`);
  const verifierResult = JSON.parse(candidate.verifier_result_json);
  assert.equal(verifierResult.status, status);
  assert.equal(verifierResult.reasonCode, reasonCode);
  assert.equal(verifierResult.reason_code, reasonCode);
}

function insertPipeDefinition(store, { id = "daily-founder-memory", workspaceId = "workspace-1" } = {}) {
  store.insertRecord("pipe_definitions", {
    id,
    workspace_id: workspaceId,
    project_id: "project-1",
    path: `.agentic30/pipes/${id}/pipe.json`,
    name: id,
    schedule: "manual",
    enabled: 1,
    pipe_kind: "built_in",
    permission_manifest_json: JSON.stringify({ read: {}, write: {} }),
    created_at: "2026-06-27T08:00:00.000Z",
    updated_at: "2026-06-27T08:00:00.000Z",
  });
}

function insertPipeRun(store, {
  id,
  pipeId = "daily-founder-memory",
  status = "succeeded",
  startedAt,
  endedAt,
  outputManifest = null,
  workspaceId = "workspace-1",
} = {}) {
  store.insertRecord("pipe_runs", {
    id,
    pipe_id: pipeId,
    workspace_id: workspaceId,
    project_id: "project-1",
    trigger_reason: "manual",
    status,
    started_at: startedAt,
    ended_at: endedAt,
    input_manifest_json: JSON.stringify({ runId: id, pipeId }),
    output_manifest_json: outputManifest ? JSON.stringify(outputManifest) : null,
    audit_log_json: JSON.stringify([{ type: "pipe_succeeded", at: endedAt }]),
    error_message: "",
    deleted_at: null,
  });
}

function insertAuditRow(store, {
  id,
  createdAt,
  workspaceId = "workspace-1",
  endpoint = "/recorder/search",
  accessLevel = "search",
  decision = "accepted",
} = {}) {
  store.insertRecord("recorder_audit", {
    id,
    request_id: `request-${id}`,
    actor_type: "api_token",
    actor_id: "test-client",
    workspace_id: workspaceId,
    project_id: "project-1",
    endpoint,
    access_level: accessLevel,
    source_ids_json: JSON.stringify([{ id: "frame-1", source_type: "frame" }]),
    decision,
    reason: "authorized_raw_read",
    created_at: createdAt,
    deleted_at: null,
  });
}

function insertExportArchiveAsset(store, { id, createdAt, workspaceId = "workspace-1", sourceIds = [] } = {}) {
  store.insertRecord("media_assets", {
    id,
    asset_type: "export_bundle",
    relative_path: `exports/${id}.json`,
    sha256: `sha256:${id}`,
    byte_size: 128,
    encrypted: 0,
    workspace_id: workspaceId,
    project_id: "project-1",
    source_ids_json: JSON.stringify(sourceIds),
    created_at: createdAt,
    deleted_at: null,
  });
}

test("deleteRecorderExportArchivesInRange removes managed archive files and tombstones media rows", async () => {
  const { store } = await makeStore();
  try {
    insertExportArchiveAsset(store, {
      id: "archive-old",
      createdAt: "2026-06-26T09:00:00.000Z",
    });
    insertExportArchiveAsset(store, {
      id: "archive-recent",
      createdAt: "2026-06-28T09:00:00.000Z",
    });
    insertExportArchiveAsset(store, {
      id: "archive-other-workspace",
      createdAt: "2026-06-26T09:00:00.000Z",
      workspaceId: "workspace-2",
    });
    const oldPath = await writePhysicalExportArchive(store, store.getRecord("media_assets", "archive-old"));
    const recentPath = await writePhysicalExportArchive(store, store.getRecord("media_assets", "archive-recent"));
    const otherPath = await writePhysicalExportArchive(store, store.getRecord("media_assets", "archive-other-workspace"));

    const result = await deleteRecorderExportArchivesInRange(store, {
      workspaceId: "workspace-1",
      projectId: "project-1",
      startedAt: "2026-06-26T00:00:00.000Z",
      endedAt: "2026-06-27T00:00:00.000Z",
      now: new Date("2026-06-28T12:00:00.000Z"),
    });

    assert.deepEqual(result.exportArchiveIds, ["archive-old"]);
    assert.equal(result.exportArchiveCount, 1);
    assert.equal(result.mediaRemovedCount, 1);
    assert.doesNotMatch(JSON.stringify(result), /exports\//);
    await assert.rejects(fs.access(oldPath), { code: "ENOENT" });
    await fs.access(recentPath);
    await fs.access(otherPath);
    assertDeletedMediaAssetPurged(store, "archive-old", {
      assetType: "export_bundle",
      deletedAt: "2026-06-28T12:00:00.000Z",
    });
    assert.equal(store.getRecord("media_assets", "archive-recent").deleted_at, null);
    assert.equal(store.getRecord("media_assets", "archive-other-workspace").deleted_at, null);
  } finally {
    store.close();
  }
});

test("deleteRecorderFrameCapture removes frame media and purges frame search", async () => {
  const { store } = await makeStore();
  try {
    recordFrameCaptureEnvelope(store, envelope({
      documentPath: "/Users/october/Documents/customer-plan.md",
      documentPathSearchLabel: "Customer plan document",
    }));
    insertMemoryItem(store, {
      id: "memory-from-frame",
      createdAt: "2026-06-27T12:30:00.000Z",
      title: "Frame-derived memory",
      summary: "redacted derived frame memory proof",
    });
    store.insertRecord("memory_items", {
      id: "memory-from-frame-and-transcript",
      workspace_id: "workspace-1",
      project_id: "project-1",
      memory_type: "daily_summary",
      title: "Multi-source memory",
      summary: "redacted transcript-backed memory proof",
      source_ids_json: JSON.stringify([
        { id: "frame-1", source_type: "frame" },
        { id: "segment-keep", source_type: "transcript" },
      ]),
      time_range_json: JSON.stringify({ start: "2026-06-27T00:00:00.000Z", end: "2026-06-27T23:59:59.000Z" }),
      redaction_status: "redacted",
      privacy_state: "memory_safe",
      safe_for_search: 1,
      safe_for_memory: 1,
      safe_for_export: 1,
      confidence: "medium",
      created_by: "daily-founder-memory",
      created_at: "2026-06-27T12:35:00.000Z",
    });
    const media = store.getRecord("media_assets", "asset-1");
    const mediaPath = await writePhysicalMedia(store, media);
    insertExportArchiveAsset(store, {
      id: "archive-from-frame",
      createdAt: "2026-06-27T12:40:00.000Z",
      sourceIds: [{ id: "frame-1", source_type: "frame" }],
    });
    const archivePath = await writePhysicalExportArchive(store, store.getRecord("media_assets", "archive-from-frame"));

    assert.equal(store.search("deletion proof").length, 1);
    assert.equal(store.search("derived frame memory proof", { sourceTypes: ["memory"] }).length, 1);
    const frameBeforeDelete = store.getRecord("frames", "frame-1");
    assert.equal(frameBeforeDelete.document_path, "/Users/october/Documents/customer-plan.md");
    assert.equal(frameBeforeDelete.document_path_search_label, "Customer plan document");

    const result = await deleteRecorderFrameCapture(store, "frame-1", {
      now: new Date("2026-06-27T13:00:00.000Z"),
    });

    assert.equal(result.status, "deleted");
    assert.equal(result.mediaPath, mediaPath);
    assert.equal(result.invalidatedExportArchiveCount, 1);
    assert.equal(result.deletedAt, "2026-06-27T13:00:00.000Z");
    await assert.rejects(fs.access(mediaPath), { code: "ENOENT" });
    await assert.rejects(fs.access(archivePath), { code: "ENOENT" });
    const frameRow = store.getRecord("frames", "frame-1");
    assert.equal(frameRow.deleted_at, "2026-06-27T13:00:00.000Z");
    assert.equal(frameRow.accessibility_text, null);
    assert.equal(frameRow.ocr_text, null);
    assert.equal(frameRow.redacted_text, null);
    assert.equal(frameRow.browser_url, null);
    assert.equal(frameRow.browser_url_normalized, null);
    assert.equal(frameRow.browser_url_search_label, null);
    assert.equal(frameRow.document_path, null);
    assert.equal(frameRow.document_path_search_label, null);
    assertDeletedMediaAssetPurged(store, "asset-1", {
      assetType: "frame_jpeg",
      deletedAt: "2026-06-27T13:00:00.000Z",
    });
    assertDeletedMediaAssetPurged(store, "archive-from-frame", {
      assetType: "export_bundle",
      deletedAt: "2026-06-27T13:00:00.000Z",
    });
    const derivedMemory = store.getRecord("memory_items", "memory-from-frame");
    assert.equal(derivedMemory.deleted_at, "2026-06-27T13:00:00.000Z");
    assert.equal(derivedMemory.title, "");
    assert.equal(derivedMemory.summary, "");
    assert.equal(derivedMemory.source_ids_json, "[]");
    const multiSourceMemory = store.getRecord("memory_items", "memory-from-frame-and-transcript");
    assert.equal(multiSourceMemory.deleted_at, null);
    assert.equal(multiSourceMemory.title, "Multi-source memory");
    assert.deepEqual(JSON.parse(multiSourceMemory.source_ids_json), [{ id: "segment-keep", source_type: "transcript" }]);
    assert.equal(multiSourceMemory.safe_for_search, 0);
    assert.equal(multiSourceMemory.safe_for_memory, 0);
    assert.equal(multiSourceMemory.safe_for_export, 0);
    assert.deepEqual(store.search("deletion proof"), []);
    assert.deepEqual(store.search("derived frame memory proof", { sourceTypes: ["memory"] }), []);
  } finally {
    store.close();
  }
});

test("deleteRecorderFrameCapture purges browser_domain, not just browser_url_search_label", async () => {
  const { store } = await makeStore();
  try {
    recordFrameCaptureEnvelope(store, envelope({
      browserUrl: "https://secret-mybank.example.com/account/12345",
    }));
    const before = store.getRecord("frames", "frame-1");
    assert.equal(before.browser_domain, "secret-mybank.example.com");
    assert.equal(before.browser_url_search_label, "secret-mybank.example.com");
    await writePhysicalMedia(store, store.getRecord("media_assets", "asset-1"));

    await deleteRecorderFrameCapture(store, "frame-1", {
      now: new Date("2026-06-27T13:00:00.000Z"),
    });

    const frameRow = store.getRecord("frames", "frame-1");
    assert.equal(frameRow.browser_url, null);
    assert.equal(frameRow.browser_domain, null);
    // Regression: RecorderStore re-derives browser_url_search_label from
    // browser_domain on every frame update, so leaving browser_domain
    // populated silently undid the explicit null below before the fix.
    assert.equal(frameRow.browser_url_search_label, null);
  } finally {
    store.close();
  }
});

test("deleteRecorderFrameCapture invalidates transitive memory evidence archives", async () => {
  const { store } = await makeStore();
  try {
    recordFrameCaptureEnvelope(store, envelope());
    insertMemoryItem(store, {
      id: "memory-chain",
      createdAt: "2026-06-27T12:30:00.000Z",
      title: "Frame memory chain",
      summary: "redacted frame memory chain proof",
      sourceIds: [{ id: "frame-1", source_type: "frame" }],
    });
    insertEvidenceCandidate(store, {
      id: "candidate-chain",
      candidateStatus: "pending_review",
      claim: "Candidate from frame-derived memory",
      createdAt: "2026-06-27T12:35:00.000Z",
      sourceIds: [{ id: "memory-chain", source_type: "memory" }],
    });
    insertExportArchiveAsset(store, {
      id: "archive-from-candidate-chain",
      createdAt: "2026-06-27T12:40:00.000Z",
      sourceIds: [{ id: "candidate-chain", source_type: "evidence_candidate" }],
    });
    const mediaPath = await writePhysicalMedia(store, store.getRecord("media_assets", "asset-1"));
    const archivePath = await writePhysicalExportArchive(store, store.getRecord("media_assets", "archive-from-candidate-chain"));

    const result = await deleteRecorderFrameCapture(store, "frame-1", {
      now: new Date("2026-06-27T13:00:00.000Z"),
    });

    assert.equal(result.invalidatedExportArchiveCount, 1);
    await assert.rejects(fs.access(mediaPath), { code: "ENOENT" });
    await assert.rejects(fs.access(archivePath), { code: "ENOENT" });
    const memory = store.getRecord("memory_items", "memory-chain");
    assert.equal(memory.deleted_at, "2026-06-27T13:00:00.000Z");
    assert.equal(memory.source_ids_json, "[]");
    const candidate = store.getRecord("evidence_candidates", "candidate-chain");
    assert.equal(candidate.deleted_at, "2026-06-27T13:00:00.000Z");
    assert.equal(candidate.candidate_status, "rejected");
    assert.equal(candidate.source_ids_json, "[]");
    assertDeletedCandidateMaterialPurged(candidate, {
      id: "candidate-chain",
      status: "rejected",
      reasonCode: "ERR_RECORDER_DERIVED_SOURCE_DELETED",
    });
    assert.equal(store.getRecord("media_assets", "archive-from-candidate-chain").deleted_at, "2026-06-27T13:00:00.000Z");
  } finally {
    store.close();
  }
});

test("deleteRecorderMemoryItemsInRange tombstones scoped memory and purges memory search", async () => {
  const { store } = await makeStore();
  try {
    insertMemoryItem(store, {
      id: "memory-old",
      createdAt: "2026-06-27T09:00:00.000Z",
      title: "Old day memory",
      summary: "redacted old memory deletion proof",
    });
    insertMemoryItem(store, {
      id: "memory-recent",
      createdAt: "2026-06-28T09:00:00.000Z",
      title: "Recent day memory",
      summary: "redacted recent memory proof",
    });

    assert.equal(store.search("old memory deletion proof", { sourceTypes: ["memory"] }).length, 1);
    const result = deleteRecorderMemoryItemsInRange(store, {
      workspaceId: "workspace-1",
      projectId: "project-1",
      startedAt: "2026-06-27T00:00:00.000Z",
      endedAt: "2026-06-28T00:00:00.000Z",
      now: new Date("2026-06-27T20:00:00.000Z"),
    });

    assert.deepEqual(result.memoryItemIds, ["memory-old"]);
    assert.equal(result.memoryItemCount, 1);
    const oldRow = store.getRecord("memory_items", "memory-old");
    assert.equal(oldRow.deleted_at, "2026-06-27T20:00:00.000Z");
    assert.equal(oldRow.title, "");
    assert.equal(oldRow.summary, "");
    assert.equal(oldRow.source_ids_json, "[]");
    assert.equal(oldRow.safe_for_search, 0);
    assert.equal(oldRow.safe_for_memory, 0);
    assert.equal(oldRow.safe_for_export, 0);
    assert.equal(store.getRecord("memory_items", "memory-recent").deleted_at, null);
    assert.deepEqual(store.search("old memory deletion proof", { sourceTypes: ["memory"] }), []);
    assert.equal(store.search("recent memory proof", { sourceTypes: ["memory"] }).length, 1);
    assert.equal(
      store.database().prepare("SELECT count(*) AS count FROM recorder_sql_memory_items WHERE id = 'memory-old'").get().count,
      0,
    );
  } finally {
    store.close();
  }
});

test("deleteRecorderMemoryItemsInRange invalidates product evidence archive chains", async () => {
  const { store } = await makeStore();
  try {
    insertMemoryItem(store, {
      id: "memory-old",
      createdAt: "2026-06-27T09:00:00.000Z",
      title: "Old day memory",
      summary: "redacted old memory product chain proof",
    });
    insertProductEvent(store, {
      id: "event-from-memory",
      occurredAt: "2026-06-27T10:00:00.000Z",
      title: "Event from memory",
      summary: "redacted memory product chain proof",
      sourceIds: [{ id: "memory-old", source_type: "memory" }],
    });
    insertEvidenceCandidate(store, {
      id: "candidate-from-product",
      candidateStatus: "pending_review",
      claim: "Candidate from memory-derived product event",
      createdAt: "2026-06-27T10:05:00.000Z",
      sourceIds: [{ id: "event-from-memory", source_type: "product_event" }],
    });
    insertExportArchiveAsset(store, {
      id: "archive-from-product-candidate",
      createdAt: "2026-06-27T10:10:00.000Z",
      sourceIds: [{ id: "candidate-from-product", source_type: "evidence_candidate" }],
    });
    const archivePath = await writePhysicalExportArchive(store, store.getRecord("media_assets", "archive-from-product-candidate"));

    const result = deleteRecorderMemoryItemsInRange(store, {
      workspaceId: "workspace-1",
      projectId: "project-1",
      startedAt: "2026-06-27T00:00:00.000Z",
      endedAt: "2026-06-28T00:00:00.000Z",
      now: new Date("2026-06-27T20:00:00.000Z"),
    });

    assert.equal(result.invalidatedExportArchiveCount, 1);
    await assert.rejects(fs.access(archivePath), { code: "ENOENT" });
    assert.equal(store.getRecord("memory_items", "memory-old").deleted_at, "2026-06-27T20:00:00.000Z");
    const event = store.getRecord("product_events", "event-from-memory");
    assert.equal(event.deleted_at, "2026-06-27T20:00:00.000Z");
    assert.equal(event.source_ids_json, "[]");
    const candidate = store.getRecord("evidence_candidates", "candidate-from-product");
    assert.equal(candidate.deleted_at, "2026-06-27T20:00:00.000Z");
    assert.equal(candidate.candidate_status, "rejected");
    assert.equal(candidate.source_ids_json, "[]");
    assert.equal(store.getRecord("media_assets", "archive-from-product-candidate").deleted_at, "2026-06-27T20:00:00.000Z");
  } finally {
    store.close();
  }
});

test("deleteRecorderMemoryItemsInRange invalidates memory evidence archive chains", async () => {
  const { store } = await makeStore();
  try {
    insertMemoryItem(store, {
      id: "memory-old-root",
      createdAt: "2026-06-27T09:00:00.000Z",
      title: "Old root memory",
      summary: "redacted old root memory proof",
    });
    insertMemoryItem(store, {
      id: "memory-derived-child",
      createdAt: "2026-06-28T09:00:00.000Z",
      title: "Derived child memory",
      summary: "redacted derived child memory proof",
      sourceIds: [{ id: "memory-old-root", source_type: "memory" }],
    });
    insertEvidenceCandidate(store, {
      id: "candidate-from-memory-child",
      candidateStatus: "pending_review",
      claim: "Candidate from memory-derived memory",
      createdAt: "2026-06-28T09:05:00.000Z",
      sourceIds: [{ id: "memory-derived-child", source_type: "memory" }],
    });
    insertExportArchiveAsset(store, {
      id: "archive-from-memory-child-candidate",
      createdAt: "2026-06-28T09:10:00.000Z",
      sourceIds: [{ id: "candidate-from-memory-child", source_type: "evidence_candidate" }],
    });
    const archivePath = await writePhysicalExportArchive(store, store.getRecord("media_assets", "archive-from-memory-child-candidate"));

    const result = deleteRecorderMemoryItemsInRange(store, {
      workspaceId: "workspace-1",
      projectId: "project-1",
      startedAt: "2026-06-27T00:00:00.000Z",
      endedAt: "2026-06-28T00:00:00.000Z",
      now: new Date("2026-06-27T20:00:00.000Z"),
    });

    assert.deepEqual(result.memoryItemIds, ["memory-old-root"]);
    assert.equal(result.invalidatedExportArchiveCount, 1);
    await assert.rejects(fs.access(archivePath), { code: "ENOENT" });
    assert.equal(store.getRecord("memory_items", "memory-old-root").deleted_at, "2026-06-27T20:00:00.000Z");
    const child = store.getRecord("memory_items", "memory-derived-child");
    assert.equal(child.deleted_at, "2026-06-27T20:00:00.000Z");
    assert.equal(child.source_ids_json, "[]");
    const candidate = store.getRecord("evidence_candidates", "candidate-from-memory-child");
    assert.equal(candidate.deleted_at, "2026-06-27T20:00:00.000Z");
    assert.equal(candidate.candidate_status, "rejected");
    assert.equal(candidate.source_ids_json, "[]");
    assert.equal(store.getRecord("media_assets", "archive-from-memory-child-candidate").deleted_at, "2026-06-27T20:00:00.000Z");
  } finally {
    store.close();
  }
});

test("deleteRecorderProductEventsInRange tombstones scoped product events and preserves proof links", async () => {
  const { store } = await makeStore();
  try {
    insertProductEvent(store, {
      id: "event-old",
      occurredAt: "2026-06-27T09:00:00.000Z",
      title: "Old customer interview",
      summary: "redacted old product event deletion proof",
      proofLedgerEventId: "proof-ledger-event-1",
    });
    insertProductEvent(store, {
      id: "event-recent",
      occurredAt: "2026-06-28T09:00:00.000Z",
      title: "Recent customer interview",
      summary: "redacted recent product event proof",
    });

    assert.equal(store.search("old product event deletion proof", { sourceTypes: ["product_event"] }).length, 1);
    const result = deleteRecorderProductEventsInRange(store, {
      workspaceId: "workspace-1",
      projectId: "project-1",
      startedAt: "2026-06-27T00:00:00.000Z",
      endedAt: "2026-06-28T00:00:00.000Z",
      now: new Date("2026-06-27T20:00:00.000Z"),
    });

    assert.deepEqual(result.productEventIds, ["event-old"]);
    assert.equal(result.productEventCount, 1);
    const oldRow = store.getRecord("product_events", "event-old");
    assert.equal(oldRow.deleted_at, "2026-06-27T20:00:00.000Z");
    assert.equal(oldRow.title, "");
    assert.equal(oldRow.summary, "");
    assert.equal(oldRow.source_ids_json, "[]");
    assert.equal(oldRow.safe_for_search, 0);
    assert.equal(oldRow.safe_for_memory, 0);
    assert.equal(oldRow.safe_for_export, 0);
    assert.equal(oldRow.proof_ledger_event_id, "proof-ledger-event-1");
    assert.equal(oldRow.verification_status, "written_to_ledger");
    assert.equal(store.getRecord("product_events", "event-recent").deleted_at, null);
    assert.deepEqual(store.search("old product event deletion proof", { sourceTypes: ["product_event"] }), []);
    assert.equal(store.search("recent product event proof", { sourceTypes: ["product_event"] }).length, 1);
    assert.equal(
      store.database().prepare("SELECT count(*) AS count FROM recorder_sql_product_events WHERE id = 'event-old'").get().count,
      0,
    );
  } finally {
    store.close();
  }
});

test("deleteRecorderProductEventsInRange invalidates memory product evidence archive chains", async () => {
  const { store } = await makeStore();
  try {
    insertProductEvent(store, {
      id: "event-old-root",
      occurredAt: "2026-06-27T09:00:00.000Z",
      title: "Old root product event",
      summary: "redacted old root product event proof",
    });
    insertMemoryItem(store, {
      id: "memory-from-product-root",
      createdAt: "2026-06-28T09:00:00.000Z",
      title: "Memory from product root",
      summary: "redacted product-derived memory proof",
      sourceIds: [{ id: "event-old-root", source_type: "product_event" }],
    });
    insertProductEvent(store, {
      id: "event-from-product-root",
      occurredAt: "2026-06-28T09:05:00.000Z",
      title: "Event from product root",
      summary: "redacted product-derived event proof",
      sourceIds: [{ id: "event-old-root", source_type: "product_event" }],
    });
    insertEvidenceCandidate(store, {
      id: "candidate-from-product-children",
      candidateStatus: "pending_review",
      claim: "Candidate from product-derived rows",
      createdAt: "2026-06-28T09:10:00.000Z",
      sourceIds: [
        { id: "memory-from-product-root", source_type: "memory" },
        { id: "event-from-product-root", source_type: "product_event" },
      ],
    });
    insertExportArchiveAsset(store, {
      id: "archive-from-product-children-candidate",
      createdAt: "2026-06-28T09:15:00.000Z",
      sourceIds: [{ id: "candidate-from-product-children", source_type: "evidence_candidate" }],
    });
    const archivePath = await writePhysicalExportArchive(store, store.getRecord("media_assets", "archive-from-product-children-candidate"));

    const result = deleteRecorderProductEventsInRange(store, {
      workspaceId: "workspace-1",
      projectId: "project-1",
      startedAt: "2026-06-27T00:00:00.000Z",
      endedAt: "2026-06-28T00:00:00.000Z",
      now: new Date("2026-06-27T20:00:00.000Z"),
    });

    assert.deepEqual(result.productEventIds, ["event-old-root"]);
    assert.equal(result.invalidatedExportArchiveCount, 1);
    await assert.rejects(fs.access(archivePath), { code: "ENOENT" });
    assert.equal(store.getRecord("product_events", "event-old-root").deleted_at, "2026-06-27T20:00:00.000Z");
    const memory = store.getRecord("memory_items", "memory-from-product-root");
    assert.equal(memory.deleted_at, "2026-06-27T20:00:00.000Z");
    assert.equal(memory.source_ids_json, "[]");
    const childEvent = store.getRecord("product_events", "event-from-product-root");
    assert.equal(childEvent.deleted_at, "2026-06-27T20:00:00.000Z");
    assert.equal(childEvent.source_ids_json, "[]");
    const candidate = store.getRecord("evidence_candidates", "candidate-from-product-children");
    assert.equal(candidate.deleted_at, "2026-06-27T20:00:00.000Z");
    assert.equal(candidate.candidate_status, "rejected");
    assert.equal(candidate.source_ids_json, "[]");
    assert.equal(store.getRecord("media_assets", "archive-from-product-children-candidate").deleted_at, "2026-06-27T20:00:00.000Z");
  } finally {
    store.close();
  }
});

test("deleteRecorderEvidenceCandidatesInRange tombstones scoped candidates and rejects unresolved proof debt", async () => {
  const { store } = await makeStore();
  try {
    insertEvidenceCandidate(store, {
      id: "candidate-pending-old",
      candidateStatus: "pending_review",
      claim: "Old pending candidate deletion proof should not remain reviewable.",
      createdAt: "2026-06-27T09:00:00.000Z",
    });
    insertEvidenceCandidate(store, {
      id: "candidate-written-old",
      candidateStatus: "written_to_ledger",
      claim: "Old written candidate deletion proof keeps proof linkage.",
      createdAt: "2026-06-27T10:00:00.000Z",
      reviewedAt: "2026-06-27T11:00:00.000Z",
      proofLedgerEventId: "proof-ledger-event-1",
    });
    insertEvidenceCandidate(store, {
      id: "candidate-recent",
      candidateStatus: "pending_review",
      claim: "Recent candidate remains visible.",
      createdAt: "2026-06-28T09:00:00.000Z",
    });
    insertEvidenceCandidate(store, {
      id: "candidate-other-workspace",
      candidateStatus: "pending_review",
      claim: "Other workspace candidate remains visible.",
      createdAt: "2026-06-27T09:30:00.000Z",
      workspaceId: "workspace-2",
    });

    const result = deleteRecorderEvidenceCandidatesInRange(store, {
      workspaceId: "workspace-1",
      projectId: "project-1",
      startedAt: "2026-06-27T00:00:00.000Z",
      endedAt: "2026-06-28T00:00:00.000Z",
      now: new Date("2026-06-27T20:00:00.000Z"),
    });

    assert.deepEqual(result.evidenceCandidateIds, ["candidate-pending-old", "candidate-written-old"]);
    assert.equal(result.evidenceCandidateCount, 2);
    assert.equal(result.rejectedCandidateCount, 1);

    const pending = store.getRecord("evidence_candidates", "candidate-pending-old");
    assert.equal(pending.deleted_at, "2026-06-27T20:00:00.000Z");
    assert.equal(pending.candidate_status, "rejected");
    assert.equal(pending.claim, "");
    assert.equal(pending.source_ids_json, "[]");
    assert.equal(pending.proof_ledger_mapping_json, "{}");
    assert.equal(pending.evidence_debt_json, "[]");
    assert.equal(pending.reviewed_at, "2026-06-27T20:00:00.000Z");
    assert.match(pending.verifier_result_json, /ERR_RECORDER_EVIDENCE_CANDIDATE_DELETED/);
    assertDeletedCandidateMaterialPurged(pending, {
      id: "candidate-pending-old",
      status: "rejected",
      reasonCode: "ERR_RECORDER_EVIDENCE_CANDIDATE_DELETED",
    });

    const written = store.getRecord("evidence_candidates", "candidate-written-old");
    assert.equal(written.deleted_at, "2026-06-27T20:00:00.000Z");
    assert.equal(written.candidate_status, "written_to_ledger");
    assert.equal(written.claim, "");
    assert.equal(written.source_ids_json, "[]");
    assert.equal(written.proof_ledger_event_id, "proof-ledger-event-1");
    assertDeletedCandidateMaterialPurged(written, {
      id: "candidate-written-old",
      status: "deleted",
      reasonCode: "ERR_RECORDER_EVIDENCE_CANDIDATE_DELETED",
    });
    assert.equal(store.getRecord("evidence_candidates", "candidate-recent").deleted_at, null);
    assert.equal(store.getRecord("evidence_candidates", "candidate-other-workspace").deleted_at, null);
  } finally {
    store.close();
  }
});

test("deleteRecorderEvidenceCandidatesInRange invalidates candidate-linked export archives", async () => {
  const { store } = await makeStore();
  try {
    insertEvidenceCandidate(store, {
      id: "candidate-with-archive",
      candidateStatus: "pending_review",
      claim: "Archived candidate should not survive direct deletion.",
      createdAt: "2026-06-27T09:00:00.000Z",
    });
    insertExportArchiveAsset(store, {
      id: "archive-from-direct-candidate",
      createdAt: "2026-06-27T09:05:00.000Z",
      sourceIds: [{ id: "candidate-with-archive", source_type: "evidence_candidate" }],
    });
    const archivePath = await writePhysicalExportArchive(store, store.getRecord("media_assets", "archive-from-direct-candidate"));

    const result = deleteRecorderEvidenceCandidatesInRange(store, {
      workspaceId: "workspace-1",
      projectId: "project-1",
      startedAt: "2026-06-27T00:00:00.000Z",
      endedAt: "2026-06-28T00:00:00.000Z",
      now: new Date("2026-06-27T20:00:00.000Z"),
    });

    assert.deepEqual(result.evidenceCandidateIds, ["candidate-with-archive"]);
    assert.equal(result.invalidatedExportArchiveCount, 1);
    await assert.rejects(fs.access(archivePath), { code: "ENOENT" });
    const candidate = store.getRecord("evidence_candidates", "candidate-with-archive");
    assert.equal(candidate.deleted_at, "2026-06-27T20:00:00.000Z");
    assert.equal(candidate.candidate_status, "rejected");
    assert.equal(candidate.source_ids_json, "[]");
    assert.equal(store.getRecord("media_assets", "archive-from-direct-candidate").deleted_at, "2026-06-27T20:00:00.000Z");
  } finally {
    store.close();
  }
});

test("deleteRecorderPipeRunsInRange purges scoped terminal output manifests and preserves audit rows", async () => {
  const { store } = await makeStore();
  try {
    insertPipeDefinition(store);
    insertPipeRun(store, {
      id: "run-old-output",
      startedAt: "2026-06-27T08:00:00.000Z",
      endedAt: "2026-06-27T09:00:00.000Z",
      outputManifest: {
        outputKind: "day_memory_review",
        items: { note: "old pipe output deletion proof" },
        sourceIds: [{ id: "candidate-from-pipe", source_type: "evidence_candidate" }],
        proofAcceptedByPipeRun: false,
      },
    });
    store.insertRecord("evidence_candidates", {
      id: "candidate-from-pipe",
      workspace_id: "workspace-1",
      project_id: "project-1",
      candidate_status: "pending_review",
      source_state: "derived",
      claim: "Pipe-derived candidate should be rejected when run output is deleted",
      proof_kind: "activation_observed",
      source_ids_json: JSON.stringify([{ id: "run-old-output", source_type: "pipe_run" }]),
      proof_ledger_mapping_json: JSON.stringify({ eventType: "activation_observed" }),
      evidence_debt_json: JSON.stringify([]),
      immutable_fingerprint: "candidate-from-pipe-fingerprint",
      idempotency_key: "candidate-from-pipe-key",
      verifier_result_json: "{}",
      proof_ledger_event_id: null,
      created_by: "pipe-run",
      created_at: "2026-06-27T09:01:00.000Z",
      reviewed_at: null,
      deleted_at: null,
    });
    insertExportArchiveAsset(store, {
      id: "archive-from-pipe",
      createdAt: "2026-06-27T09:05:00.000Z",
      sourceIds: [{ id: "run-old-output", source_type: "pipe_run" }],
    });
    const pipeArchivePath = await writePhysicalExportArchive(store, store.getRecord("media_assets", "archive-from-pipe"));
    insertPipeRun(store, {
      id: "run-recent-output",
      startedAt: "2026-06-28T08:00:00.000Z",
      endedAt: "2026-06-28T09:00:00.000Z",
      outputManifest: {
        outputKind: "day_memory_review",
        items: { note: "recent pipe output proof" },
        proofAcceptedByPipeRun: false,
      },
    });
    insertPipeRun(store, {
      id: "run-old-queued",
      status: "queued",
      startedAt: "2026-06-27T08:00:00.000Z",
      endedAt: "2026-06-27T09:00:00.000Z",
      outputManifest: {
        outputKind: "queued_output_should_not_exist",
      },
    });

    const result = deleteRecorderPipeRunsInRange(store, {
      workspaceId: "workspace-1",
      projectId: "project-1",
      startedAt: "2026-06-27T00:00:00.000Z",
      endedAt: "2026-06-28T00:00:00.000Z",
      now: new Date("2026-06-28T12:00:00.000Z"),
    });

    assert.deepEqual(result.pipeRunIds, ["run-old-output"]);
    assert.equal(result.pipeRunCount, 1);
    assert.equal(result.outputPurgedCount, 1);
    assert.equal(result.invalidatedExportArchiveCount, 1);
    await assert.rejects(fs.access(pipeArchivePath), { code: "ENOENT" });
    const oldRun = store.getRecord("pipe_runs", "run-old-output");
    assert.equal(oldRun.output_manifest_json, null);
    assert.equal(oldRun.deleted_at, "2026-06-28T12:00:00.000Z");
    const candidate = store.getRecord("evidence_candidates", "candidate-from-pipe");
    assert.equal(candidate.candidate_status, "rejected");
    assert.equal(candidate.deleted_at, "2026-06-28T12:00:00.000Z");
    assert.equal(candidate.source_ids_json, "[]");
    assert.equal(store.getRecord("media_assets", "archive-from-pipe").deleted_at, "2026-06-28T12:00:00.000Z");
    assert.match(oldRun.audit_log_json, /pipe_succeeded/);
    assert.notEqual(store.getRecord("pipe_runs", "run-recent-output").output_manifest_json, null);
    assert.equal(store.getRecord("pipe_runs", "run-recent-output").deleted_at, null);
    assert.notEqual(store.getRecord("pipe_runs", "run-old-queued").output_manifest_json, null);
    assert.equal(store.getRecord("pipe_runs", "run-old-queued").deleted_at, null);
  } finally {
    store.close();
  }
});

test("deleteRecorderPipeRunOutput unlinks persisted sandbox artifacts and fails closed on unsafe paths", async () => {
  const { store } = await makeStore();
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-pipe-artifact-delete-"));
  try {
    insertPipeDefinition(store);
    const sandboxPath = ".agentic30/pipes/daily-founder-memory/runs/run-artifact/day-memory-review.json";
    const artifactFile = path.join(workspaceRoot, ...sandboxPath.split("/"));
    await fs.mkdir(path.dirname(artifactFile), { recursive: true });
    await fs.writeFile(artifactFile, JSON.stringify({ schema: "agentic30.recorder.day_memory_review.v1" }));
    const outputManifest = {
      outputKind: "day_memory_review",
      artifacts: [{ kind: "day_memory_review_snapshot", persisted: true, sandboxPath, sandbox_path: sandboxPath }],
      proofAcceptedByPipeRun: false,
    };
    insertPipeRun(store, {
      id: "run-artifact",
      startedAt: "2026-06-27T08:00:00.000Z",
      endedAt: "2026-06-27T09:00:00.000Z",
      outputManifest,
    });

    // Persisted artifact without workspaceRoot must fail closed with a named
    // root cause, before any row mutation.
    assert.throws(
      () => deleteRecorderPipeRunOutput(store, "run-artifact", { now: new Date("2026-06-28T12:00:00.000Z") }),
      (error) => error instanceof RecorderDeleteError
        && error.code === "ERR_RECORDER_DELETE_PIPE_ARTIFACT_WORKSPACE_ROOT_REQUIRED",
    );
    assert.notEqual(store.getRecord("pipe_runs", "run-artifact").output_manifest_json, null);

    const result = deleteRecorderPipeRunOutput(store, "run-artifact", {
      now: new Date("2026-06-28T12:00:00.000Z"),
      workspaceRoot,
    });
    assert.equal(result.artifactFileCount, 1);
    assert.equal(result.artifactFileUnlinkedCount, 1);
    await assert.rejects(fs.access(artifactFile), { code: "ENOENT" });
    const run = store.getRecord("pipe_runs", "run-artifact");
    assert.equal(run.output_manifest_json, null);
    assert.equal(run.deleted_at, "2026-06-28T12:00:00.000Z");

    // Sandbox-escaping artifact paths must fail closed before mutation.
    insertPipeRun(store, {
      id: "run-artifact-escape",
      startedAt: "2026-06-27T08:00:00.000Z",
      endedAt: "2026-06-27T09:00:00.000Z",
      outputManifest: {
        outputKind: "day_memory_review",
        artifacts: [{ persisted: true, sandboxPath: ".agentic30/pipes/daily-founder-memory/../../../etc/passwd" }],
      },
    });
    assert.throws(
      () => deleteRecorderPipeRunOutput(store, "run-artifact-escape", {
        now: new Date("2026-06-28T12:00:00.000Z"),
        workspaceRoot,
      }),
      (error) => error.code === "ERR_RECORDER_DELETE_PIPE_ARTIFACT_OUTSIDE_SANDBOX",
    );
    assert.notEqual(store.getRecord("pipe_runs", "run-artifact-escape").output_manifest_json, null);

    // Symlinked artifacts must be rejected, not followed.
    const symlinkSandboxPath = ".agentic30/pipes/daily-founder-memory/runs/run-artifact-symlink/day-memory-review.json";
    const symlinkFile = path.join(workspaceRoot, ...symlinkSandboxPath.split("/"));
    const symlinkVictim = path.join(workspaceRoot, "victim.json");
    await fs.mkdir(path.dirname(symlinkFile), { recursive: true });
    await fs.writeFile(symlinkVictim, "{}");
    await fs.symlink(symlinkVictim, symlinkFile);
    insertPipeRun(store, {
      id: "run-artifact-symlink",
      startedAt: "2026-06-27T08:00:00.000Z",
      endedAt: "2026-06-27T09:00:00.000Z",
      outputManifest: {
        outputKind: "day_memory_review",
        artifacts: [{ persisted: true, sandboxPath: symlinkSandboxPath }],
      },
    });
    assert.throws(
      () => deleteRecorderPipeRunOutput(store, "run-artifact-symlink", {
        now: new Date("2026-06-28T12:00:00.000Z"),
        workspaceRoot,
      }),
      (error) => error.code === "ERR_RECORDER_DELETE_PIPE_ARTIFACT_SYMLINK_REJECTED",
    );
    await fs.access(symlinkVictim);

    // Missing artifact files stay idempotent: purge proceeds.
    insertPipeRun(store, {
      id: "run-artifact-missing",
      startedAt: "2026-06-27T08:00:00.000Z",
      endedAt: "2026-06-27T09:00:00.000Z",
      outputManifest: {
        outputKind: "day_memory_review",
        artifacts: [{
          persisted: true,
          sandboxPath: ".agentic30/pipes/daily-founder-memory/runs/run-artifact-missing/day-memory-review.json",
        }],
      },
    });
    const missingResult = deleteRecorderPipeRunOutput(store, "run-artifact-missing", {
      now: new Date("2026-06-28T12:00:00.000Z"),
      workspaceRoot,
    });
    assert.equal(missingResult.artifactFileCount, 1);
    assert.equal(missingResult.artifactFileUnlinkedCount, 0);
    assert.equal(store.getRecord("pipe_runs", "run-artifact-missing").output_manifest_json, null);
  } finally {
    store.close();
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("deleteRecorderAuditRowsInRange tombstones scoped audit rows without clearing accountability fields", async () => {
  const { store } = await makeStore();
  try {
    insertAuditRow(store, {
      id: "audit-old",
      createdAt: "2026-06-27T09:00:00.000Z",
      endpoint: "/recorder/frames/frame-1/image",
      accessLevel: "raw_frame",
      decision: "accepted",
    });
    insertAuditRow(store, {
      id: "audit-recent",
      createdAt: "2026-06-28T09:00:00.000Z",
    });
    insertAuditRow(store, {
      id: "audit-other-workspace",
      createdAt: "2026-06-27T09:30:00.000Z",
      workspaceId: "workspace-2",
    });

    const result = deleteRecorderAuditRowsInRange(store, {
      workspaceId: "workspace-1",
      projectId: "project-1",
      startedAt: "2026-06-27T00:00:00.000Z",
      endedAt: "2026-06-28T00:00:00.000Z",
      now: new Date("2026-06-28T12:00:00.000Z"),
    });

    assert.deepEqual(result.auditRowIds, ["audit-old"]);
    assert.equal(result.auditRowCount, 1);
    assert.equal(result.tombstoneOnly, true);
    const oldAudit = store.getRecord("recorder_audit", "audit-old");
    assert.equal(oldAudit.deleted_at, "2026-06-28T12:00:00.000Z");
    assert.equal(oldAudit.endpoint, "/recorder/frames/frame-1/image");
    assert.equal(oldAudit.access_level, "raw_frame");
    assert.equal(oldAudit.decision, "accepted");
    assert.match(oldAudit.source_ids_json, /frame-1/);
    assert.equal(store.getRecord("recorder_audit", "audit-recent").deleted_at, null);
    assert.equal(store.getRecord("recorder_audit", "audit-other-workspace").deleted_at, null);
  } finally {
    store.close();
  }
});

test("deleteRecorderClipboardEventsInRange tombstones scoped clipboard rows and purges raw content", async () => {
  const { store } = await makeStore();
  try {
    const controlState = readyClipboardControlState();
    recordClipboardEvent(store, clipboardEvent({
      id: "clipboard-old",
      occurredAt: "2026-06-27T09:00:00.000Z",
      redactedText: "redacted old clipboard deletion proof",
    }), { controlState });
    recordClipboardEvent(store, clipboardEvent({
      id: "clipboard-recent",
      occurredAt: "2026-06-28T09:00:00.000Z",
      redactedText: "redacted recent clipboard proof",
    }), { controlState });

    assert.equal(
      store.database().prepare("SELECT count(*) AS count FROM recorder_sql_clipboard_redacted WHERE id = 'clipboard-old'").get().count,
      1,
    );

    const result = deleteRecorderClipboardEventsInRange(store, {
      workspaceId: "workspace-1",
      projectId: "project-1",
      startedAt: "2026-06-27T00:00:00.000Z",
      endedAt: "2026-06-28T00:00:00.000Z",
      now: new Date("2026-06-27T20:00:00.000Z"),
    });

    assert.deepEqual(result.clipboardEventIds, ["clipboard-old"]);
    assert.equal(result.clipboardEventCount, 1);
    assert.equal(result.contentPurgedCount, 1);
    const oldRow = store.getRecord("clipboard_events", "clipboard-old");
    assert.equal(oldRow.deleted_at, "2026-06-27T20:00:00.000Z");
    assert.equal(oldRow.content_size, null);
    assert.equal(oldRow.content_hash, null);
    assert.equal(oldRow.content_text, null);
    assert.equal(oldRow.redacted_text, null);
    assert.equal(oldRow.raw_retention_expires_at, null);
    assert.equal(oldRow.content_captured, 0);
    assert.equal(oldRow.safe_for_search, 0);
    assert.equal(oldRow.safe_for_memory, 0);
    assert.equal(oldRow.safe_for_export, 0);
    assert.equal(store.getRecord("clipboard_events", "clipboard-recent").deleted_at, null);
    assert.equal(
      store.database().prepare("SELECT count(*) AS count FROM recorder_sql_clipboard_redacted WHERE id = 'clipboard-old'").get().count,
      0,
    );
    assert.equal(
      store.database().prepare("SELECT count(*) AS count FROM recorder_sql_clipboard_raw_admin WHERE id = 'clipboard-old'").get().count,
      0,
    );
  } finally {
    store.close();
  }
});

test("deleteRecorderAudioChunksInRange removes scoped audio media and transcript search", async () => {
  const { store } = await makeStore();
  try {
    const controlState = readyAudioControlState();
    recordAudioChunk(store, audioChunk({
      id: "audio-old",
      assetId: "asset-audio-old",
      segmentId: "segment-audio-old",
      startedAt: "2026-06-27T09:00:00.000Z",
      endedAt: "2026-06-27T09:01:00.000Z",
      redactedText: "redacted old audio deletion proof",
    }), { controlState });
    recordAudioChunk(store, audioChunk({
      id: "audio-recent",
      assetId: "asset-audio-recent",
      segmentId: "segment-audio-recent",
      startedAt: "2026-06-28T09:00:00.000Z",
      endedAt: "2026-06-28T09:01:00.000Z",
      redactedText: "redacted recent audio proof",
    }), { controlState });
    const oldPath = await writePhysicalAudio(store, store.getRecord("media_assets", "asset-audio-old"));
    const recentPath = await writePhysicalAudio(store, store.getRecord("media_assets", "asset-audio-recent"));

    assert.equal(store.search("old audio deletion proof", { sourceTypes: ["transcript"] }).length, 1);

    const result = await deleteRecorderAudioChunksInRange(store, {
      workspaceId: "workspace-1",
      projectId: "project-1",
      startedAt: "2026-06-27T00:00:00.000Z",
      endedAt: "2026-06-28T00:00:00.000Z",
      now: new Date("2026-06-27T20:00:00.000Z"),
    });

    assert.deepEqual(result.audioChunkIds, ["audio-old"]);
    assert.deepEqual(result.transcriptSegmentIds, ["segment-audio-old"]);
    assert.equal(result.audioChunkCount, 1);
    assert.equal(result.transcriptSegmentCount, 1);
    assert.equal(result.mediaRemovedCount, 1);
    await assert.rejects(fs.access(oldPath), { code: "ENOENT" });
    await fs.access(recentPath);
    const oldAudio = store.getRecord("audio_chunks", "audio-old");
    assert.equal(oldAudio.deleted_at, "2026-06-27T20:00:00.000Z");
    assert.equal(oldAudio.redaction_status, "deleted");
    assert.equal(oldAudio.privacy_state, "deleted");
    assertDeletedMediaAssetPurged(store, "asset-audio-old", {
      assetType: "audio_m4a",
      deletedAt: "2026-06-27T20:00:00.000Z",
    });
    const oldSegment = store.getRecord("transcript_segments", "segment-audio-old");
    assert.equal(oldSegment.deleted_at, "2026-06-27T20:00:00.000Z");
    assert.equal(oldSegment.text, "");
    assert.equal(oldSegment.redacted_text, "");
    assert.equal(oldSegment.deletion_source_id, "audio-old");
    assert.equal(store.getRecord("audio_chunks", "audio-recent").deleted_at, null);
    assert.deepEqual(store.search("old audio deletion proof", { sourceTypes: ["transcript"] }), []);
    assert.equal(store.search("recent audio proof", { sourceTypes: ["transcript"] }).length, 1);
  } finally {
    store.close();
  }
});

test("deleteRecorderAudioChunksInRange tolerates a missing audio file: orphan is still tombstoned and siblings are purged", async () => {
  const { store } = await makeStore();
  try {
    const controlState = readyAudioControlState();
    recordAudioChunk(store, audioChunk({
      id: "audio-old-1",
      assetId: "asset-audio-old-1",
      segmentId: "segment-audio-old-1",
      startedAt: "2026-06-27T09:00:00.000Z",
      endedAt: "2026-06-27T09:01:00.000Z",
      redactedText: "redacted first audio retained proof",
    }), { controlState });
    recordAudioChunk(store, audioChunk({
      id: "audio-old-2",
      assetId: "asset-audio-old-2",
      segmentId: "segment-audio-old-2",
      startedAt: "2026-06-27T10:00:00.000Z",
      endedAt: "2026-06-27T10:01:00.000Z",
      redactedText: "redacted second audio retained proof",
    }), { controlState });
    // asset-audio-old-1 has a physical file; asset-audio-old-2 is an orphan
    // (row present, media file already gone).
    const existingPath = await writePhysicalAudio(store, store.getRecord("media_assets", "asset-audio-old-1"));

    const result = await deleteRecorderAudioChunksInRange(store, {
      startedAt: "2026-06-27T00:00:00.000Z",
      endedAt: "2026-06-28T00:00:00.000Z",
      now: new Date("2026-06-27T20:00:00.000Z"),
    });

    assert.equal(result.audioChunkCount, 2);
    assert.equal(result.mediaRemovedCount, 1);
    assert.equal(result.mediaAlreadyMissingCount, 1);
    assert.equal(result.media_already_missing_count, 1);
    // The present file was unlinked; the orphan stayed gone.
    await assert.rejects(fs.access(existingPath), { code: "ENOENT" });
    // The orphan row no longer poisons the batch: both rows are soft-deleted,
    // both media assets tombstoned, both transcripts purged.
    assert.equal(store.getRecord("audio_chunks", "audio-old-1").deleted_at, "2026-06-27T20:00:00.000Z");
    assert.equal(store.getRecord("audio_chunks", "audio-old-2").deleted_at, "2026-06-27T20:00:00.000Z");
    assertDeletedMediaAssetPurged(store, "asset-audio-old-1", {
      assetType: "audio_m4a",
      deletedAt: "2026-06-27T20:00:00.000Z",
    });
    assertDeletedMediaAssetPurged(store, "asset-audio-old-2", {
      assetType: "audio_m4a",
      deletedAt: "2026-06-27T20:00:00.000Z",
    });
    assert.equal(store.getRecord("transcript_segments", "segment-audio-old-1").deleted_at, "2026-06-27T20:00:00.000Z");
    assert.equal(store.getRecord("transcript_segments", "segment-audio-old-2").deleted_at, "2026-06-27T20:00:00.000Z");
    assert.deepEqual(store.search("first audio retained proof", { sourceTypes: ["transcript"] }), []);
    assert.deepEqual(store.search("second audio retained proof", { sourceTypes: ["transcript"] }), []);
  } finally {
    store.close();
  }
});

test("deleteRecorderAudioChunksInRange fails before mutation on a genuine non-ENOENT media error", async () => {
  const { store } = await makeStore();
  try {
    const controlState = readyAudioControlState();
    recordAudioChunk(store, audioChunk({
      id: "audio-old-1",
      assetId: "asset-audio-old-1",
      segmentId: "segment-audio-old-1",
      startedAt: "2026-06-27T09:00:00.000Z",
      endedAt: "2026-06-27T09:01:00.000Z",
      redactedText: "redacted first audio retained proof",
    }), { controlState });
    recordAudioChunk(store, audioChunk({
      id: "audio-old-2",
      assetId: "asset-audio-old-2",
      segmentId: "segment-audio-old-2",
      startedAt: "2026-06-27T10:00:00.000Z",
      endedAt: "2026-06-27T10:01:00.000Z",
      redactedText: "redacted second audio retained proof",
    }), { controlState });
    const existingPath = await writePhysicalAudio(store, store.getRecord("media_assets", "asset-audio-old-1"));
    // A directory where a media file is expected is a genuinely-unexpected
    // state (not ENOENT) and must fail-before-mutation.
    const blockedPath = resolveRecorderAudioMediaPath(store, store.getRecord("media_assets", "asset-audio-old-2"));
    await fs.mkdir(path.dirname(blockedPath), { recursive: true });
    await fs.mkdir(blockedPath, { recursive: true });

    await assert.rejects(
      () => deleteRecorderAudioChunksInRange(store, {
        startedAt: "2026-06-27T00:00:00.000Z",
        endedAt: "2026-06-28T00:00:00.000Z",
      }),
      (error) => error instanceof RecorderDeleteError
        && error.code === "ERR_RECORDER_DELETE_MEDIA_NOT_FILE"
        && error.details?.mediaAssetId === "asset-audio-old-2",
    );

    await fs.access(existingPath);
    assert.equal(store.getRecord("audio_chunks", "audio-old-1").deleted_at, null);
    assert.equal(store.getRecord("audio_chunks", "audio-old-2").deleted_at, null);
    assert.equal(store.getRecord("media_assets", "asset-audio-old-1").deleted_at, null);
    assert.equal(store.getRecord("media_assets", "asset-audio-old-2").deleted_at, null);
    assert.equal(store.getRecord("transcript_segments", "segment-audio-old-1").deleted_at, null);
    assert.equal(store.getRecord("transcript_segments", "segment-audio-old-2").deleted_at, null);
    assert.equal(store.search("first audio retained proof", { sourceTypes: ["transcript"] }).length, 1);
    assert.equal(store.search("second audio retained proof", { sourceTypes: ["transcript"] }).length, 1);
  } finally {
    store.close();
  }
});

test("deleteRecorderFrameCapture tolerates already-missing media and still soft-deletes the row", async () => {
  const { store } = await makeStore();
  try {
    recordFrameCaptureEnvelope(store, envelope());
    // No physical file written: the frame is an orphan. The row must still be
    // soft-deleted + tombstoned so retention can never deadlock on it.
    const result = await deleteRecorderFrameCapture(store, "frame-1", {
      now: new Date("2026-06-27T20:00:00.000Z"),
    });

    assert.equal(result.status, "deleted");
    assert.equal(result.mediaRemoved, false);
    assert.equal(result.media_removed, false);
    assert.equal(result.mediaAlreadyMissing, true);
    assert.equal(result.media_already_missing, true);
    assert.equal(store.getRecord("frames", "frame-1").deleted_at, "2026-06-27T20:00:00.000Z");
    assertDeletedMediaAssetPurged(store, "asset-1", {
      assetType: "frame_jpeg",
      deletedAt: "2026-06-27T20:00:00.000Z",
    });
    assert.deepEqual(store.search("deletion proof"), []);
  } finally {
    store.close();
  }
});

test("deleteRecorderFrameCapture fails before mutation on a genuine non-ENOENT media error", async () => {
  const { store } = await makeStore();
  try {
    recordFrameCaptureEnvelope(store, envelope());
    // A directory where the media file is expected is not ENOENT and must
    // fail-before-mutation.
    const blockedPath = resolveRecorderFrameMediaPath(store, store.getRecord("media_assets", "asset-1"));
    await fs.mkdir(blockedPath, { recursive: true });

    await assert.rejects(
      () => deleteRecorderFrameCapture(store, "frame-1"),
      (error) => error instanceof RecorderDeleteError
        && error.code === "ERR_RECORDER_DELETE_MEDIA_NOT_FILE",
    );
    assert.equal(store.getRecord("frames", "frame-1").deleted_at, null);
    assert.equal(store.getRecord("media_assets", "asset-1").deleted_at, null);
    assert.equal(store.search("deletion proof").length, 1);
  } finally {
    store.close();
  }
});

test("deleteRecorderFrameCapture rejects unsafe persisted media paths before filesystem access", async () => {
  const { store } = await makeStore();
  try {
    recordFrameCaptureEnvelope(store, envelope());
    store.updateRecord("media_assets", "asset-1", {
      relative_path: "../outside.jpg",
    });

    await assert.rejects(
      () => deleteRecorderFrameCapture(store, "frame-1"),
      (error) => error instanceof RecorderDeleteError
        && error.code === "ERR_RECORDER_DELETE_UNSAFE_MEDIA_PATH",
    );
    assert.equal(store.getRecord("frames", "frame-1").deleted_at, null);
  } finally {
    store.close();
  }
});

test("deleteRecorderFrameCapturesInRange removes only scoped in-range frame media", async () => {
  const { store } = await makeStore();
  try {
    recordFrameCaptureEnvelope(store, envelope({
      id: "frame-1",
      capturedAt: "2026-06-27T09:00:00.000Z",
      documentPath: "/Users/october/Documents/morning-plan.md",
      documentPathSearchLabel: "morning plan document",
      snapshot: {
        id: "asset-1",
        relativePath: "media/frames/2026-06-27/frame-1.jpg",
        sha256: "sha256:snapshot-1",
        byteSize: 14,
      },
      text: {
        textSource: "accessibility_only",
        accessibilityText: "raw morning deletion proof",
        redactedText: "redacted morning deletion proof",
        redactionStatus: "redacted",
      },
    }));
    recordFrameCaptureEnvelope(store, envelope({
      id: "frame-2",
      capturedAt: "2026-06-27T11:00:00.000Z",
      documentPath: "/Users/october/Documents/noon-plan.md",
      documentPathSearchLabel: "noon plan document",
      snapshot: {
        id: "asset-2",
        relativePath: "media/frames/2026-06-27/frame-2.jpg",
        sha256: "sha256:snapshot-2",
        byteSize: 14,
      },
      text: {
        textSource: "accessibility_only",
        accessibilityText: "raw noon deletion proof",
        redactedText: "redacted noon deletion proof",
        redactionStatus: "redacted",
      },
    }));
    recordFrameCaptureEnvelope(store, envelope({
      id: "frame-3",
      capturedAt: "2026-06-28T09:00:00.000Z",
      documentPath: "/Users/october/Documents/next-day-plan.md",
      documentPathSearchLabel: "next day document",
      snapshot: {
        id: "asset-3",
        relativePath: "media/frames/2026-06-28/frame-3.jpg",
        sha256: "sha256:snapshot-3",
        byteSize: 14,
      },
      text: {
        textSource: "accessibility_only",
        accessibilityText: "raw next day proof",
        redactedText: "redacted next day proof",
        redactionStatus: "redacted",
      },
    }));
    const paths = [];
    for (const id of ["asset-1", "asset-2", "asset-3"]) {
      paths.push(await writePhysicalMedia(store, store.getRecord("media_assets", id)));
    }

    const result = await deleteRecorderFrameCapturesInRange(store, {
      workspaceId: "workspace-1",
      projectId: "project-1",
      startedAt: "2026-06-27T00:00:00.000Z",
      endedAt: "2026-06-28T00:00:00.000Z",
      now: new Date("2026-06-27T20:00:00.000Z"),
    });

    assert.deepEqual(result.frameIds, ["frame-1", "frame-2"]);
    assert.equal(result.frameCount, 2);
    await assert.rejects(fs.access(paths[0]), { code: "ENOENT" });
    await assert.rejects(fs.access(paths[1]), { code: "ENOENT" });
    await fs.access(paths[2]);
    const frame1 = store.getRecord("frames", "frame-1");
    const frame2 = store.getRecord("frames", "frame-2");
    const frame3 = store.getRecord("frames", "frame-3");
    assert.equal(frame1.deleted_at, "2026-06-27T20:00:00.000Z");
    assert.equal(frame2.deleted_at, "2026-06-27T20:00:00.000Z");
    assert.equal(frame3.deleted_at, null);
    assertDeletedMediaAssetPurged(store, "asset-1", {
      assetType: "frame_jpeg",
      deletedAt: "2026-06-27T20:00:00.000Z",
    });
    assertDeletedMediaAssetPurged(store, "asset-2", {
      assetType: "frame_jpeg",
      deletedAt: "2026-06-27T20:00:00.000Z",
    });
    assert.equal(frame1.document_path, null);
    assert.equal(frame1.document_path_search_label, null);
    assert.equal(frame2.document_path, null);
    assert.equal(frame2.document_path_search_label, null);
    assert.equal(frame3.document_path, "/Users/october/Documents/next-day-plan.md");
    assert.equal(frame3.document_path_search_label, "next day document");
    assert.deepEqual(store.search("deletion proof"), []);
    assert.equal(store.search("next day proof").length, 1);
  } finally {
    store.close();
  }
});

test("deleteRecorderFrameCapturesInRange purges browser_domain, not just browser_url_search_label", async () => {
  const { store } = await makeStore();
  try {
    recordFrameCaptureEnvelope(store, envelope({
      browserUrl: "https://secret-mybank.example.com/account/12345",
    }));
    await writePhysicalMedia(store, store.getRecord("media_assets", "asset-1"));

    const result = await deleteRecorderFrameCapturesInRange(store, {
      workspaceId: "workspace-1",
      projectId: "project-1",
      startedAt: "2026-06-27T00:00:00.000Z",
      endedAt: "2026-06-28T00:00:00.000Z",
      now: new Date("2026-06-27T20:00:00.000Z"),
    });

    assert.deepEqual(result.frameIds, ["frame-1"]);
    const frameRow = store.getRecord("frames", "frame-1");
    assert.equal(frameRow.browser_url, null);
    assert.equal(frameRow.browser_domain, null);
    assert.equal(frameRow.browser_url_search_label, null);
  } finally {
    store.close();
  }
});

test("deleteRecorderFrameCapturesInRange tolerates a missing frame file: orphan tombstoned, siblings purged", async () => {
  const { store } = await makeStore();
  try {
    recordFrameCaptureEnvelope(store, envelope({
      id: "frame-1",
      snapshot: {
        id: "asset-1",
        relativePath: "media/frames/2026-06-27/frame-1.jpg",
        sha256: "sha256:snapshot-1",
        byteSize: 14,
      },
      text: {
        textSource: "accessibility_only",
        accessibilityText: "raw first deletion proof",
        redactedText: "redacted first deletion proof",
        redactionStatus: "redacted",
      },
    }));
    recordFrameCaptureEnvelope(store, envelope({
      id: "frame-2",
      capturedAt: "2026-06-27T12:10:00.000Z",
      snapshot: {
        id: "asset-2",
        relativePath: "media/frames/2026-06-27/frame-2.jpg",
        sha256: "sha256:snapshot-2",
        byteSize: 14,
      },
      text: {
        textSource: "accessibility_only",
        accessibilityText: "raw second deletion proof",
        redactedText: "redacted second deletion proof",
        redactionStatus: "redacted",
      },
    }));
    // asset-1 present; asset-2 is an orphan (row present, media file gone).
    const existingPath = await writePhysicalMedia(store, store.getRecord("media_assets", "asset-1"));

    const result = await deleteRecorderFrameCapturesInRange(store, {
      startedAt: "2026-06-27T00:00:00.000Z",
      endedAt: "2026-06-28T00:00:00.000Z",
      now: new Date("2026-06-27T20:00:00.000Z"),
    });

    assert.equal(result.frameCount, 2);
    assert.equal(result.mediaRemovedCount, 1);
    assert.equal(result.mediaAlreadyMissingCount, 1);
    assert.equal(result.media_already_missing_count, 1);
    await assert.rejects(fs.access(existingPath), { code: "ENOENT" });
    assert.equal(store.getRecord("frames", "frame-1").deleted_at, "2026-06-27T20:00:00.000Z");
    assert.equal(store.getRecord("frames", "frame-2").deleted_at, "2026-06-27T20:00:00.000Z");
    assertDeletedMediaAssetPurged(store, "asset-1", {
      assetType: "frame_jpeg",
      deletedAt: "2026-06-27T20:00:00.000Z",
    });
    assertDeletedMediaAssetPurged(store, "asset-2", {
      assetType: "frame_jpeg",
      deletedAt: "2026-06-27T20:00:00.000Z",
    });
    assert.deepEqual(store.search("first deletion proof"), []);
    assert.deepEqual(store.search("second deletion proof"), []);
  } finally {
    store.close();
  }
});

test("deleteRecorderFrameCapturesInRange fails before mutating rows on a genuine non-ENOENT media error", async () => {
  const { store } = await makeStore();
  try {
    recordFrameCaptureEnvelope(store, envelope({
      id: "frame-1",
      snapshot: {
        id: "asset-1",
        relativePath: "media/frames/2026-06-27/frame-1.jpg",
        sha256: "sha256:snapshot-1",
        byteSize: 14,
      },
      text: {
        textSource: "accessibility_only",
        accessibilityText: "raw first deletion proof",
        redactedText: "redacted first deletion proof",
        redactionStatus: "redacted",
      },
    }));
    recordFrameCaptureEnvelope(store, envelope({
      id: "frame-2",
      capturedAt: "2026-06-27T12:10:00.000Z",
      snapshot: {
        id: "asset-2",
        relativePath: "media/frames/2026-06-27/frame-2.jpg",
        sha256: "sha256:snapshot-2",
        byteSize: 14,
      },
      text: {
        textSource: "accessibility_only",
        accessibilityText: "raw second deletion proof",
        redactedText: "redacted second deletion proof",
        redactionStatus: "redacted",
      },
    }));
    const existingPath = await writePhysicalMedia(store, store.getRecord("media_assets", "asset-1"));
    // Directory where a media file is expected: genuine non-ENOENT error.
    const blockedPath = resolveRecorderFrameMediaPath(store, store.getRecord("media_assets", "asset-2"));
    await fs.mkdir(blockedPath, { recursive: true });

    await assert.rejects(
      () => deleteRecorderFrameCapturesInRange(store, {
        startedAt: "2026-06-27T00:00:00.000Z",
        endedAt: "2026-06-28T00:00:00.000Z",
      }),
      (error) => error instanceof RecorderDeleteError
        && error.code === "ERR_RECORDER_DELETE_MEDIA_NOT_FILE"
        && error.details?.mediaAssetId === "asset-2",
    );

    await fs.access(existingPath);
    assert.equal(store.getRecord("frames", "frame-1").deleted_at, null);
    assert.equal(store.getRecord("frames", "frame-2").deleted_at, null);
    assert.equal(store.getRecord("media_assets", "asset-1").deleted_at, null);
    assert.equal(store.getRecord("media_assets", "asset-2").deleted_at, null);
    assert.equal(store.search("first deletion proof").length, 1);
    assert.equal(store.search("second deletion proof").length, 1);
  } finally {
    store.close();
  }
});

test("deleteRecorderFrameCapturesInRange tolerates orphaned closure export-archive (ENOENT): orphan tombstoned, sibling frames purged, text removed from search", async () => {
  const { store } = await makeStore();
  try {
    recordFrameCaptureEnvelope(store, envelope({
      id: "frame-present-archive",
      capturedAt: "2026-06-27T09:00:00.000Z",
      snapshot: {
        id: "asset-present-archive",
        relativePath: "media/frames/2026-06-27/frame-present-archive.jpg",
        sha256: "sha256:present-archive-frame",
        byteSize: 14,
      },
      text: {
        textSource: "accessibility_only",
        accessibilityText: "raw present archive closure proof",
        redactedText: "redacted present archive closure proof",
        redactionStatus: "redacted",
      },
    }));
    recordFrameCaptureEnvelope(store, envelope({
      id: "frame-orphan-archive",
      capturedAt: "2026-06-27T10:00:00.000Z",
      snapshot: {
        id: "asset-orphan-archive",
        relativePath: "media/frames/2026-06-27/frame-orphan-archive.jpg",
        sha256: "sha256:orphan-archive-frame",
        byteSize: 14,
      },
      text: {
        textSource: "accessibility_only",
        accessibilityText: "raw orphan archive closure proof",
        redactedText: "redacted orphan archive closure proof",
        redactionStatus: "redacted",
      },
    }));
    // archive-bundle-present references frame-present-archive and has a physical file.
    insertExportArchiveAsset(store, {
      id: "archive-bundle-present",
      createdAt: "2026-06-27T09:30:00.000Z",
      sourceIds: [{ id: "frame-present-archive", source_type: "frame" }],
    });
    // archive-bundle-orphan references frame-orphan-archive but has NO physical file —
    // an orphan. This must NOT abort the batch after the fix.
    insertExportArchiveAsset(store, {
      id: "archive-bundle-orphan",
      createdAt: "2026-06-27T10:30:00.000Z",
      sourceIds: [{ id: "frame-orphan-archive", source_type: "frame" }],
    });
    const presentFramePath = await writePhysicalMedia(store, store.getRecord("media_assets", "asset-present-archive"));
    const orphanFramePath = await writePhysicalMedia(store, store.getRecord("media_assets", "asset-orphan-archive"));
    const presentArchivePath = await writePhysicalExportArchive(store, store.getRecord("media_assets", "archive-bundle-present"));
    // archive-bundle-orphan intentionally has no physical file written.

    const result = await deleteRecorderFrameCapturesInRange(store, {
      startedAt: "2026-06-27T00:00:00.000Z",
      endedAt: "2026-06-28T00:00:00.000Z",
      now: new Date("2026-06-27T20:00:00.000Z"),
    });

    assert.equal(result.frameCount, 2);
    assert.equal(result.invalidatedExportArchiveCount, 2);
    // Both frame media files removed.
    await assert.rejects(fs.access(presentFramePath), { code: "ENOENT" });
    await assert.rejects(fs.access(orphanFramePath), { code: "ENOENT" });
    // archive-bundle-present: file removed, row tombstoned.
    await assert.rejects(fs.access(presentArchivePath), { code: "ENOENT" });
    assertDeletedMediaAssetPurged(store, "archive-bundle-present", {
      assetType: "export_bundle",
      deletedAt: "2026-06-27T20:00:00.000Z",
    });
    // archive-bundle-orphan: physical file was already gone; row is still tombstoned.
    assertDeletedMediaAssetPurged(store, "archive-bundle-orphan", {
      assetType: "export_bundle",
      deletedAt: "2026-06-27T20:00:00.000Z",
    });
    // Expired frame text removed from search.
    assert.deepEqual(store.search("present archive closure proof"), []);
    assert.deepEqual(store.search("orphan archive closure proof"), []);
  } finally {
    store.close();
  }
});

test("deleteRecorderFrameCapturesInRange fails-before-mutation on non-ENOENT export-archive error (directory at bundle path)", async () => {
  const { store } = await makeStore();
  try {
    recordFrameCaptureEnvelope(store, envelope({
      id: "frame-dir-archive",
      capturedAt: "2026-06-27T09:00:00.000Z",
      snapshot: {
        id: "asset-dir-archive",
        relativePath: "media/frames/2026-06-27/frame-dir-archive.jpg",
        sha256: "sha256:dir-archive-frame",
        byteSize: 14,
      },
      text: {
        textSource: "accessibility_only",
        accessibilityText: "raw dir archive preflight proof",
        redactedText: "redacted dir archive preflight proof",
        redactionStatus: "redacted",
      },
    }));
    // Export archive linked to the frame; a DIRECTORY exists at the bundle
    // path — not ENOENT, so must fail-before-mutation with
    // ERR_RECORDER_DELETE_MEDIA_NOT_FILE.
    insertExportArchiveAsset(store, {
      id: "archive-dir-not-file",
      createdAt: "2026-06-27T09:30:00.000Z",
      sourceIds: [{ id: "frame-dir-archive", source_type: "frame" }],
    });
    const framePath = await writePhysicalMedia(store, store.getRecord("media_assets", "asset-dir-archive"));
    const archivePath = resolveRecorderExportArchiveMediaPath(store, store.getRecord("media_assets", "archive-dir-not-file"));
    await fs.mkdir(archivePath, { recursive: true });

    await assert.rejects(
      () => deleteRecorderFrameCapturesInRange(store, {
        startedAt: "2026-06-27T00:00:00.000Z",
        endedAt: "2026-06-28T00:00:00.000Z",
      }),
      (error) => error instanceof RecorderDeleteError
        && error.code === "ERR_RECORDER_DELETE_MEDIA_NOT_FILE"
        && error.details?.mediaAssetId === "archive-dir-not-file",
    );

    // Fail-before-mutation: frame row and both media assets untouched.
    await fs.access(framePath);
    assert.equal(store.getRecord("frames", "frame-dir-archive").deleted_at, null);
    assert.equal(store.getRecord("media_assets", "asset-dir-archive").deleted_at, null);
    assert.equal(store.getRecord("media_assets", "archive-dir-not-file").deleted_at, null);
    assert.equal(store.search("dir archive preflight proof").length, 1);
  } finally {
    store.close();
  }
});
