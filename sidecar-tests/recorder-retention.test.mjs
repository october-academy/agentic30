import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
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
import {
  RecorderRetentionError,
  applyRecorderRetentionPolicy,
  buildRecorderRetentionPlan,
  normalizeRecorderRetentionPolicy,
} from "../sidecar/recorder-retention.mjs";
import { RecorderStore } from "../sidecar/recorder-store.mjs";

const DELETED_MEDIA_SHA256 = "0".repeat(64);

async function makeStore() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-recorder-retention-"));
  const store = new RecorderStore({ appSupportRoot: path.join(root, "app-support") }).open();
  return { root, store };
}

function frameEnvelope({ id, assetId, capturedAt, text, workspaceId = "workspace-1" } = {}) {
  return {
    id,
    workspaceId,
    projectId: "project-1",
    capturedAt,
    monitorId: "main",
    captureTrigger: "typing_pause",
    appName: "Codex",
    windowTitle: "Founder Memory OS",
    contentHash: `sha256:${id}`,
    privacyState: "search_safe",
    dataClass: "screen",
    safeForSearch: true,
    safeForMemory: true,
    safeForExport: false,
    snapshot: {
      id: assetId,
      relativePath: `media/frames/2026-06-27/${id}.jpg`,
      sha256: `sha256:${assetId}`,
      byteSize: 14,
    },
    text: {
      textSource: "accessibility_only",
      accessibilityText: `raw ${id}@example.com`,
      redactedText: text,
      redactionStatus: "redacted",
    },
  };
}

async function writePhysicalMedia(store, assetId) {
  const media = store.getRecord("media_assets", assetId);
  const mediaPath = resolveRecorderFrameMediaPath(store, media);
  await fs.mkdir(path.dirname(mediaPath), { recursive: true });
  await fs.writeFile(mediaPath, "jpeg bytes here");
  return mediaPath;
}

async function writePhysicalAudio(store, assetId) {
  const media = store.getRecord("media_assets", assetId);
  const mediaPath = resolveRecorderAudioMediaPath(store, media);
  await fs.mkdir(path.dirname(mediaPath), { recursive: true });
  await fs.writeFile(mediaPath, "m4a bytes here");
  return mediaPath;
}

async function writePhysicalExportArchive(store, assetId, content = "{\"schema\":\"agentic30.recorder.export_archive.v1\"}") {
  const media = store.getRecord("media_assets", assetId);
  const mediaPath = resolveRecorderExportArchiveMediaPath(store, media);
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

function audioChunk({ id, assetId, segmentId, startedAt, endedAt, text, workspaceId = "workspace-1" } = {}) {
  return {
    id,
    workspaceId,
    projectId: "project-1",
    startedAt,
    endedAt,
    source: "microphone",
    transcriptStatus: "local_complete",
    consentGrantId: "consent-retention-test",
    rawAudioIndicatorState: "visible_indicator_active",
    localTranscriberName: "agentic30-local-transcriber-test",
    localTranscriberVersion: "0.0.0-test",
    redactionStatus: "redacted",
    privacyState: "raw_local",
    audioAsset: {
      id: assetId,
      relativePath: `media/audio/2026-06-27/${id}.m4a`,
      sha256: "b".repeat(64),
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
        redactedText: text,
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

function clipboardEvent({ id, occurredAt, text, workspaceId = "workspace-1" } = {}) {
  return {
    id,
    workspaceId,
    projectId: "project-1",
    occurredAt,
    eventKind: "copy",
    appName: "Agentic30",
    windowTitle: "Founder Replay",
    contentType: "text",
    contentText: `raw ${id} customer note`,
    redactedText: text,
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
  candidateStatus = "written_to_ledger",
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

test("buildRecorderRetentionPlan targets only expired frame media in scope", async () => {
  const { store } = await makeStore();
  try {
    recordFrameCaptureEnvelope(store, frameEnvelope({
      id: "old-frame",
      assetId: "old-asset",
      capturedAt: "2026-06-26T00:00:00.000Z",
      text: "redacted old retention proof",
    }));
    recordFrameCaptureEnvelope(store, frameEnvelope({
      id: "recent-frame",
      assetId: "recent-asset",
      capturedAt: "2026-06-27T18:00:00.000Z",
      text: "redacted recent retention proof",
    }));
    recordFrameCaptureEnvelope(store, frameEnvelope({
      id: "other-workspace-frame",
      assetId: "other-workspace-asset",
      capturedAt: "2026-06-26T00:00:00.000Z",
      workspaceId: "workspace-2",
      text: "redacted other workspace proof",
    }));

    const plan = buildRecorderRetentionPlan(store, {
      workspaceId: "workspace-1",
      projectId: "project-1",
      now: new Date("2026-06-28T12:00:00.000Z"),
    });

    assert.equal(plan.cutoffAt, "2026-06-27T12:00:00.000Z");
    assert.equal(plan.targetCount, 1);
    assert.deepEqual(plan.targets.map((target) => target.frameId), ["old-frame"]);
    assert.equal(plan.targets[0].pathExposed, false);
    assert.equal(plan.targets[0].mediaPath, undefined);
    assert.equal(plan.deleteRange.startedAt, "2026-06-26T00:00:00.000Z");
    assert.equal(plan.deleteRange.endedAt, "2026-06-27T12:00:00.000Z");
  } finally {
    store.close();
  }
});

test("buildRecorderRetentionPlan targets expired audio separately from frames", async () => {
  const { store } = await makeStore();
  try {
    const controlState = readyAudioControlState();
    recordAudioChunk(store, audioChunk({
      id: "old-audio",
      assetId: "old-audio-asset",
      segmentId: "old-audio-segment",
      startedAt: "2026-06-26T00:00:00.000Z",
      endedAt: "2026-06-26T00:01:00.000Z",
      text: "redacted old audio retention proof",
    }), { controlState });
    recordAudioChunk(store, audioChunk({
      id: "recent-audio",
      assetId: "recent-audio-asset",
      segmentId: "recent-audio-segment",
      startedAt: "2026-06-27T18:00:00.000Z",
      endedAt: "2026-06-27T18:01:00.000Z",
      text: "redacted recent audio retention proof",
    }), { controlState });

    const plan = buildRecorderRetentionPlan(store, {
      workspaceId: "workspace-1",
      projectId: "project-1",
      now: new Date("2026-06-28T12:00:00.000Z"),
    });

    assert.equal(plan.audioCutoffAt, "2026-06-27T12:00:00.000Z");
    assert.equal(plan.frameTargetCount, 0);
    assert.equal(plan.audioTargetCount, 1);
    assert.equal(plan.targetCount, 1);
    assert.deepEqual(plan.audioTargets.map((target) => target.audioChunkId), ["old-audio"]);
    assert.equal(plan.audioTargets[0].transcriptCount, 1);
    assert.equal(plan.audioTargets[0].pathExposed, false);
    assert.equal(plan.audioTargets[0].mediaPath, undefined);
    assert.equal(plan.audioDeleteRange.startedAt, "2026-06-26T00:00:00.000Z");
    assert.equal(plan.audioDeleteRange.endedAt, "2026-06-27T12:00:00.000Z");
  } finally {
    store.close();
  }
});

test("buildRecorderRetentionPlan targets expired clipboard events without raw content exposure", async () => {
  const { store } = await makeStore();
  try {
    const controlState = readyClipboardControlState();
    recordClipboardEvent(store, clipboardEvent({
      id: "old-clipboard",
      occurredAt: "2026-06-26T00:00:00.000Z",
      text: "redacted old clipboard retention proof",
    }), { controlState });
    recordClipboardEvent(store, clipboardEvent({
      id: "recent-clipboard",
      occurredAt: "2026-06-27T18:00:00.000Z",
      text: "redacted recent clipboard retention proof",
    }), { controlState });

    const plan = buildRecorderRetentionPlan(store, {
      workspaceId: "workspace-1",
      projectId: "project-1",
      now: new Date("2026-06-28T12:00:00.000Z"),
    });

    assert.equal(plan.clipboardCutoffAt, "2026-06-27T12:00:00.000Z");
    assert.equal(plan.frameTargetCount, 0);
    assert.equal(plan.audioTargetCount, 0);
    assert.equal(plan.clipboardTargetCount, 1);
    assert.equal(plan.targetCount, 1);
    assert.deepEqual(plan.clipboardTargets.map((target) => target.clipboardEventId), ["old-clipboard"]);
    assert.equal(plan.clipboardTargets[0].contentCaptured, true);
    assert.equal(plan.clipboardTargets[0].rawContentExposed, false);
    assert.equal(plan.clipboardTargets[0].pathExposed, false);
    assert.doesNotMatch(JSON.stringify(plan), /raw old-clipboard customer note|content_text/);
    assert.equal(plan.clipboardDeleteRange.startedAt, "2026-06-26T00:00:00.000Z");
    assert.equal(plan.clipboardDeleteRange.endedAt, "2026-06-27T12:00:00.000Z");
  } finally {
    store.close();
  }
});

test("buildRecorderRetentionPlan targets expired memory and product events without content exposure", async () => {
  const { store } = await makeStore();
  try {
    insertMemoryItem(store, {
      id: "old-memory",
      createdAt: "2026-06-26T00:00:00.000Z",
      title: "Old memory",
      summary: "redacted old memory retention proof",
    });
    insertMemoryItem(store, {
      id: "recent-memory",
      createdAt: "2026-06-27T18:00:00.000Z",
      title: "Recent memory",
      summary: "redacted recent memory retention proof",
    });
    insertProductEvent(store, {
      id: "old-event",
      occurredAt: "2026-06-26T00:00:00.000Z",
      title: "Old product event",
      summary: "redacted old product event retention proof",
      proofLedgerEventId: "proof-ledger-event-1",
    });
    insertProductEvent(store, {
      id: "recent-event",
      occurredAt: "2026-06-27T18:00:00.000Z",
      title: "Recent product event",
      summary: "redacted recent product event retention proof",
    });

    const plan = buildRecorderRetentionPlan(store, {
      workspaceId: "workspace-1",
      projectId: "project-1",
      now: new Date("2026-06-28T12:00:00.000Z"),
      policy: {
        rawFrameRetentionHours: 999,
        rawAudioRetentionHours: 999,
        rawClipboardRetentionHours: 999,
        memoryRetentionHours: 24,
        productEventRetentionHours: 24,
      },
    });

    assert.equal(plan.memoryCutoffAt, "2026-06-27T12:00:00.000Z");
    assert.equal(plan.productEventCutoffAt, "2026-06-27T12:00:00.000Z");
    assert.equal(plan.frameTargetCount, 0);
    assert.equal(plan.audioTargetCount, 0);
    assert.equal(plan.clipboardTargetCount, 0);
    assert.equal(plan.memoryTargetCount, 1);
    assert.equal(plan.productEventTargetCount, 1);
    assert.equal(plan.targetCount, 2);
    assert.deepEqual(plan.memoryTargets.map((target) => target.memoryItemId), ["old-memory"]);
    assert.deepEqual(plan.productEventTargets.map((target) => target.productEventId), ["old-event"]);
    assert.equal(plan.memoryTargets[0].contentExposed, false);
    assert.equal(plan.productEventTargets[0].contentExposed, false);
    assert.equal(plan.productEventTargets[0].proofLedgerLinked, true);
    assert.doesNotMatch(
      JSON.stringify(plan),
      /redacted old memory retention proof|redacted old product event retention proof|Old memory|Old product event/,
    );
  } finally {
    store.close();
  }
});

test("buildRecorderRetentionPlan targets resolved evidence candidates without proof payload exposure", async () => {
  const { store } = await makeStore();
  try {
    insertEvidenceCandidate(store, {
      id: "old-written-candidate",
      candidateStatus: "written_to_ledger",
      claim: "Old written evidence candidate retention proof",
      createdAt: "2026-06-25T12:00:00.000Z",
      reviewedAt: "2026-06-26T00:00:00.000Z",
      proofLedgerEventId: "proof-ledger-event-1",
    });
    insertEvidenceCandidate(store, {
      id: "old-pending-candidate",
      candidateStatus: "pending_review",
      claim: "Old pending evidence candidate must remain reviewable",
      createdAt: "2026-06-25T12:00:00.000Z",
    });
    insertEvidenceCandidate(store, {
      id: "recent-rejected-candidate",
      candidateStatus: "rejected",
      claim: "Recent rejected evidence candidate remains retained",
      createdAt: "2026-06-27T09:00:00.000Z",
      reviewedAt: "2026-06-27T18:00:00.000Z",
    });

    const plan = buildRecorderRetentionPlan(store, {
      workspaceId: "workspace-1",
      projectId: "project-1",
      now: new Date("2026-06-28T12:00:00.000Z"),
      policy: {
        rawFrameRetentionHours: 999,
        rawAudioRetentionHours: 999,
        rawClipboardRetentionHours: 999,
        memoryRetentionHours: 999,
        productEventRetentionHours: 999,
        evidenceCandidateRetentionHours: 24,
      },
    });

    assert.equal(plan.evidenceCandidateCutoffAt, "2026-06-27T12:00:00.000Z");
    assert.equal(plan.frameTargetCount, 0);
    assert.equal(plan.audioTargetCount, 0);
    assert.equal(plan.clipboardTargetCount, 0);
    assert.equal(plan.memoryTargetCount, 0);
    assert.equal(plan.productEventTargetCount, 0);
    assert.equal(plan.evidenceCandidateTargetCount, 1);
    assert.equal(plan.targetCount, 1);
    assert.deepEqual(plan.evidenceCandidateTargets.map((target) => target.evidenceCandidateId), ["old-written-candidate"]);
    assert.equal(plan.evidenceCandidateTargets[0].candidateStatus, "written_to_ledger");
    assert.equal(plan.evidenceCandidateTargets[0].proofLedgerLinked, true);
    assert.equal(plan.evidenceCandidateTargets[0].contentExposed, false);
    assert.equal(plan.evidenceCandidateTargets[0].pathExposed, false);
    assert.equal(plan.evidenceCandidateDeleteRange.startedAt, "2026-06-26T00:00:00.000Z");
    assert.equal(plan.evidenceCandidateDeleteRange.endedAt, "2026-06-27T12:00:00.000Z");
    assert.doesNotMatch(
      JSON.stringify(plan),
      /Old written evidence candidate retention proof|Old pending evidence candidate|Recent rejected evidence candidate|proof_ledger_mapping_json|source_ids_json/,
    );
  } finally {
    store.close();
  }
});

test("buildRecorderRetentionPlan targets expired Pipe outputs without manifest exposure", async () => {
  const { store } = await makeStore();
  try {
    insertPipeDefinition(store);
    insertPipeRun(store, {
      id: "run-old-output",
      startedAt: "2026-06-26T08:00:00.000Z",
      endedAt: "2026-06-26T09:00:00.000Z",
      outputManifest: {
        outputKind: "day_memory_review",
        items: { note: "old pipe output retention proof" },
        artifacts: [{ kind: "day_memory_review_snapshot", persisted: true }],
        actionResults: [{ action: "recorder.memory.read", status: "succeeded" }],
        proofAcceptedByPipeRun: false,
      },
    });
    insertPipeRun(store, {
      id: "run-recent-output",
      startedAt: "2026-06-27T18:00:00.000Z",
      endedAt: "2026-06-27T19:00:00.000Z",
      outputManifest: {
        outputKind: "day_memory_review",
        items: { note: "recent pipe output proof" },
        proofAcceptedByPipeRun: false,
      },
    });
    insertPipeRun(store, {
      id: "run-old-queued",
      status: "queued",
      startedAt: "2026-06-26T08:00:00.000Z",
      endedAt: "2026-06-26T09:00:00.000Z",
      outputManifest: { outputKind: "queued_output_should_not_target" },
    });

    const plan = buildRecorderRetentionPlan(store, {
      workspaceId: "workspace-1",
      projectId: "project-1",
      now: new Date("2026-06-28T12:00:00.000Z"),
      policy: {
        rawFrameRetentionHours: 999,
        rawAudioRetentionHours: 999,
        rawClipboardRetentionHours: 999,
        memoryRetentionHours: 999,
        productEventRetentionHours: 999,
        evidenceCandidateRetentionHours: 999,
        pipeOutputRetentionHours: 24,
      },
    });

    assert.equal(plan.pipeOutputCutoffAt, "2026-06-27T12:00:00.000Z");
    assert.equal(plan.pipeOutputTargetCount, 1);
    assert.equal(plan.targetCount, 1);
    assert.deepEqual(plan.pipeOutputTargets.map((target) => target.pipeRunId), ["run-old-output"]);
    assert.equal(plan.pipeOutputTargets[0].outputKind, "day_memory_review");
    assert.equal(plan.pipeOutputTargets[0].artifactCount, 1);
    assert.equal(plan.pipeOutputTargets[0].actionResultCount, 1);
    assert.equal(plan.pipeOutputTargets[0].contentExposed, false);
    assert.equal(plan.pipeOutputTargets[0].pathExposed, false);
    assert.equal(plan.pipeOutputTargets[0].proofAcceptedByPipeRun, false);
    assert.equal(plan.pipeOutputDeleteRange.startedAt, "2026-06-26T09:00:00.000Z");
    assert.equal(plan.pipeOutputDeleteRange.endedAt, "2026-06-27T12:00:00.000Z");
    assert.doesNotMatch(
      JSON.stringify(plan),
      /old pipe output retention proof|recent pipe output proof|queued_output_should_not_target|output_manifest_json/,
    );
  } finally {
    store.close();
  }
});

test("buildRecorderRetentionPlan targets expired audits as tombstone-only accountability rows", async () => {
  const { store } = await makeStore();
  try {
    insertAuditRow(store, {
      id: "audit-old",
      createdAt: "2026-06-26T09:00:00.000Z",
      endpoint: "/recorder/frames/frame-1/image",
      accessLevel: "raw_frame",
      decision: "accepted",
    });
    insertAuditRow(store, {
      id: "audit-recent",
      createdAt: "2026-06-27T18:00:00.000Z",
    });

    const plan = buildRecorderRetentionPlan(store, {
      workspaceId: "workspace-1",
      projectId: "project-1",
      now: new Date("2026-06-28T12:00:00.000Z"),
      policy: {
        rawFrameRetentionHours: 999,
        rawAudioRetentionHours: 999,
        rawClipboardRetentionHours: 999,
        memoryRetentionHours: 999,
        productEventRetentionHours: 999,
        evidenceCandidateRetentionHours: 999,
        pipeOutputRetentionHours: 999,
        auditRetentionHours: 24,
      },
    });

    assert.equal(plan.auditCutoffAt, "2026-06-27T12:00:00.000Z");
    assert.equal(plan.auditTargetCount, 1);
    assert.equal(plan.targetCount, 1);
    assert.deepEqual(plan.auditTargets.map((target) => target.auditRowId), ["audit-old"]);
    assert.equal(plan.auditTargets[0].endpoint, "/recorder/frames/frame-1/image");
    assert.equal(plan.auditTargets[0].accessLevel, "raw_frame");
    assert.equal(plan.auditTargets[0].decision, "accepted");
    assert.equal(plan.auditTargets[0].tombstoneOnly, true);
    assert.equal(plan.auditTargets[0].contentExposed, false);
    assert.equal(plan.auditTargets[0].pathExposed, false);
    assert.equal(plan.auditDeleteRange.startedAt, "2026-06-26T09:00:00.000Z");
    assert.equal(plan.auditDeleteRange.endedAt, "2026-06-27T12:00:00.000Z");
    assert.doesNotMatch(JSON.stringify(plan), /source_ids_json|request-audit-old|test-client/);
  } finally {
    store.close();
  }
});

test("buildRecorderRetentionPlan targets expired export archives without path or content exposure", async () => {
  const { store } = await makeStore();
  try {
    insertExportArchiveAsset(store, {
      id: "archive-old",
      createdAt: "2026-06-26T09:00:00.000Z",
    });
    insertExportArchiveAsset(store, {
      id: "archive-recent",
      createdAt: "2026-06-27T18:00:00.000Z",
    });
    insertExportArchiveAsset(store, {
      id: "archive-other-workspace",
      createdAt: "2026-06-26T09:00:00.000Z",
      workspaceId: "workspace-2",
    });

    const plan = buildRecorderRetentionPlan(store, {
      workspaceId: "workspace-1",
      projectId: "project-1",
      now: new Date("2026-06-28T12:00:00.000Z"),
      policy: {
        rawFrameRetentionHours: 999,
        rawAudioRetentionHours: 999,
        rawClipboardRetentionHours: 999,
        memoryRetentionHours: 999,
        productEventRetentionHours: 999,
        evidenceCandidateRetentionHours: 999,
        pipeOutputRetentionHours: 999,
        auditRetentionHours: 999,
        exportArchiveRetentionHours: 24,
      },
    });

    assert.equal(plan.exportArchiveCutoffAt, "2026-06-27T12:00:00.000Z");
    assert.equal(plan.exportArchiveTargetCount, 1);
    assert.equal(plan.targetCount, 1);
    assert.deepEqual(plan.exportArchiveTargets.map((target) => target.exportArchiveId), ["archive-old"]);
    assert.equal(plan.exportArchiveTargets[0].mediaAssetId, "archive-old");
    assert.equal(plan.exportArchiveTargets[0].byteSize, 128);
    assert.equal(plan.exportArchiveTargets[0].contentExposed, false);
    assert.equal(plan.exportArchiveTargets[0].pathExposed, false);
    assert.equal(plan.exportArchiveTargets[0].proofAcceptedByExport, false);
    assert.equal(plan.exportArchiveDeleteRange.startedAt, "2026-06-26T09:00:00.000Z");
    assert.equal(plan.exportArchiveDeleteRange.endedAt, "2026-06-27T12:00:00.000Z");
    assert.doesNotMatch(JSON.stringify(plan), /exports\/|agentic30\.recorder\.export_archive|archive-recent|archive-other-workspace/);
  } finally {
    store.close();
  }
});

test("applyRecorderRetentionPolicy physically deletes expired frames and preserves recent frames", async () => {
  const { store } = await makeStore();
  try {
    recordFrameCaptureEnvelope(store, frameEnvelope({
      id: "old-frame",
      assetId: "old-asset",
      capturedAt: "2026-06-26T00:00:00.000Z",
      text: "redacted old retention proof",
    }));
    recordFrameCaptureEnvelope(store, frameEnvelope({
      id: "recent-frame",
      assetId: "recent-asset",
      capturedAt: "2026-06-27T18:00:00.000Z",
      text: "redacted recent retention proof",
    }));
    const oldPath = await writePhysicalMedia(store, "old-asset");
    const recentPath = await writePhysicalMedia(store, "recent-asset");

    const result = await applyRecorderRetentionPolicy(store, {
      workspaceId: "workspace-1",
      projectId: "project-1",
      now: new Date("2026-06-28T12:00:00.000Z"),
    });

    assert.equal(result.status, "applied");
    assert.equal(result.deletedFrameCount, 1);
    assert.deepEqual(result.deleteResult.frameIds, ["old-frame"]);
    assert.equal(result.storeMaintenance.walCheckpoint.mode, "TRUNCATE");
    assert.equal(result.storeMaintenance.vacuumRun, true);
    await assert.rejects(fs.access(oldPath), { code: "ENOENT" });
    await fs.access(recentPath);
    assert.equal(store.getRecord("frames", "old-frame").deleted_at, "2026-06-28T12:00:00.000Z");
    assert.equal(store.getRecord("frames", "recent-frame").deleted_at, null);
    assertDeletedMediaAssetPurged(store, "old-asset", {
      assetType: "frame_jpeg",
      deletedAt: "2026-06-28T12:00:00.000Z",
    });
    assert.equal(store.search("old retention proof").length, 0);
    assert.equal(store.search("recent retention proof").length, 1);
  } finally {
    store.close();
  }
});

test("applyRecorderRetentionPolicy physically deletes expired audio and purges transcript search", async () => {
  const { store } = await makeStore();
  try {
    const controlState = readyAudioControlState();
    recordAudioChunk(store, audioChunk({
      id: "old-audio",
      assetId: "old-audio-asset",
      segmentId: "old-audio-segment",
      startedAt: "2026-06-26T00:00:00.000Z",
      endedAt: "2026-06-26T00:01:00.000Z",
      text: "redacted old audio retention proof",
    }), { controlState });
    recordAudioChunk(store, audioChunk({
      id: "recent-audio",
      assetId: "recent-audio-asset",
      segmentId: "recent-audio-segment",
      startedAt: "2026-06-27T18:00:00.000Z",
      endedAt: "2026-06-27T18:01:00.000Z",
      text: "redacted recent audio retention proof",
    }), { controlState });
    const oldPath = await writePhysicalAudio(store, "old-audio-asset");
    const recentPath = await writePhysicalAudio(store, "recent-audio-asset");

    const result = await applyRecorderRetentionPolicy(store, {
      workspaceId: "workspace-1",
      projectId: "project-1",
      now: new Date("2026-06-28T12:00:00.000Z"),
    });

    assert.equal(result.status, "applied");
    assert.equal(result.deletedFrameCount, 0);
    assert.equal(result.deletedAudioChunkCount, 1);
    assert.equal(result.deletedTranscriptSegmentCount, 1);
    assert.equal(result.deletedMediaCount, 1);
    assert.deepEqual(result.audioDeleteResult.audioChunkIds, ["old-audio"]);
    await assert.rejects(fs.access(oldPath), { code: "ENOENT" });
    await fs.access(recentPath);
    assert.equal(store.getRecord("audio_chunks", "old-audio").deleted_at, "2026-06-28T12:00:00.000Z");
    assert.equal(store.getRecord("audio_chunks", "recent-audio").deleted_at, null);
    assertDeletedMediaAssetPurged(store, "old-audio-asset", {
      assetType: "audio_m4a",
      deletedAt: "2026-06-28T12:00:00.000Z",
    });
    assert.equal(store.getRecord("transcript_segments", "old-audio-segment").deleted_at, "2026-06-28T12:00:00.000Z");
    assert.equal(store.search("old audio retention proof", { sourceTypes: ["transcript"] }).length, 0);
    assert.equal(store.search("recent audio retention proof", { sourceTypes: ["transcript"] }).length, 1);
  } finally {
    store.close();
  }
});

test("applyRecorderRetentionPolicy tombstones expired clipboard events and purges raw content", async () => {
  const { store } = await makeStore();
  try {
    const controlState = readyClipboardControlState();
    recordClipboardEvent(store, clipboardEvent({
      id: "old-clipboard",
      occurredAt: "2026-06-26T00:00:00.000Z",
      text: "redacted old clipboard retention proof",
    }), { controlState });
    recordClipboardEvent(store, clipboardEvent({
      id: "recent-clipboard",
      occurredAt: "2026-06-27T18:00:00.000Z",
      text: "redacted recent clipboard retention proof",
    }), { controlState });

    const result = await applyRecorderRetentionPolicy(store, {
      workspaceId: "workspace-1",
      projectId: "project-1",
      now: new Date("2026-06-28T12:00:00.000Z"),
    });

    assert.equal(result.status, "applied");
    assert.equal(result.deletedFrameCount, 0);
    assert.equal(result.deletedAudioChunkCount, 0);
    assert.equal(result.deletedClipboardEventCount, 1);
    assert.equal(result.purgedClipboardContentCount, 1);
    assert.deepEqual(result.clipboardDeleteResult.clipboardEventIds, ["old-clipboard"]);
    const oldRow = store.getRecord("clipboard_events", "old-clipboard");
    assert.equal(oldRow.deleted_at, "2026-06-28T12:00:00.000Z");
    assert.equal(oldRow.content_text, null);
    assert.equal(oldRow.content_captured, 0);
    assert.equal(oldRow.safe_for_search, 0);
    assert.equal(store.getRecord("clipboard_events", "recent-clipboard").deleted_at, null);
    assert.equal(
      store.database().prepare("SELECT count(*) AS count FROM recorder_sql_clipboard_redacted WHERE id = 'old-clipboard'").get().count,
      0,
    );
    assert.equal(
      store.database().prepare("SELECT count(*) AS count FROM recorder_sql_clipboard_redacted WHERE id = 'recent-clipboard'").get().count,
      1,
    );
    assert.doesNotMatch(JSON.stringify(result), /raw old-clipboard customer note|content_text/);
  } finally {
    store.close();
  }
});

test("applyRecorderRetentionPolicy tombstones expired memory and product events", async () => {
  const { store } = await makeStore();
  try {
    insertMemoryItem(store, {
      id: "old-memory",
      createdAt: "2026-06-26T00:00:00.000Z",
      title: "Old memory",
      summary: "redacted old memory retention proof",
    });
    insertMemoryItem(store, {
      id: "recent-memory",
      createdAt: "2026-06-27T18:00:00.000Z",
      title: "Recent memory",
      summary: "redacted recent memory retention proof",
    });
    insertProductEvent(store, {
      id: "old-event",
      occurredAt: "2026-06-26T00:00:00.000Z",
      title: "Old product event",
      summary: "redacted old product event retention proof",
      proofLedgerEventId: "proof-ledger-event-1",
    });
    insertProductEvent(store, {
      id: "recent-event",
      occurredAt: "2026-06-27T18:00:00.000Z",
      title: "Recent product event",
      summary: "redacted recent product event retention proof",
    });

    const result = await applyRecorderRetentionPolicy(store, {
      workspaceId: "workspace-1",
      projectId: "project-1",
      now: new Date("2026-06-28T12:00:00.000Z"),
      policy: {
        rawFrameRetentionHours: 999,
        rawAudioRetentionHours: 999,
        rawClipboardRetentionHours: 999,
        memoryRetentionHours: 24,
        productEventRetentionHours: 24,
      },
    });

    assert.equal(result.status, "applied");
    assert.equal(result.deletedMemoryItemCount, 1);
    assert.equal(result.deletedProductEventCount, 1);
    assert.deepEqual(result.memoryDeleteResult.memoryItemIds, ["old-memory"]);
    assert.deepEqual(result.productEventDeleteResult.productEventIds, ["old-event"]);
    const oldMemory = store.getRecord("memory_items", "old-memory");
    assert.equal(oldMemory.deleted_at, "2026-06-28T12:00:00.000Z");
    assert.equal(oldMemory.safe_for_search, 0);
    assert.equal(oldMemory.safe_for_memory, 0);
    assert.equal(oldMemory.safe_for_export, 0);
    const oldEvent = store.getRecord("product_events", "old-event");
    assert.equal(oldEvent.deleted_at, "2026-06-28T12:00:00.000Z");
    assert.equal(oldEvent.safe_for_search, 0);
    assert.equal(oldEvent.safe_for_memory, 0);
    assert.equal(oldEvent.safe_for_export, 0);
    assert.equal(oldEvent.proof_ledger_event_id, "proof-ledger-event-1");
    assert.equal(oldEvent.verification_status, "written_to_ledger");
    assert.equal(store.getRecord("memory_items", "recent-memory").deleted_at, null);
    assert.equal(store.getRecord("product_events", "recent-event").deleted_at, null);
    assert.equal(store.search("old memory retention proof", { sourceTypes: ["memory"] }).length, 0);
    assert.equal(store.search("recent memory retention proof", { sourceTypes: ["memory"] }).length, 1);
    assert.equal(store.search("old product event retention proof", { sourceTypes: ["product_event"] }).length, 0);
    assert.equal(store.search("recent product event retention proof", { sourceTypes: ["product_event"] }).length, 1);
    assert.equal(
      store.database().prepare("SELECT count(*) AS count FROM recorder_sql_memory_items WHERE id = 'old-memory'").get().count,
      0,
    );
    assert.equal(
      store.database().prepare("SELECT count(*) AS count FROM recorder_sql_product_events WHERE id = 'old-event'").get().count,
      0,
    );
    assert.doesNotMatch(
      JSON.stringify(result),
      /redacted old memory retention proof|redacted old product event retention proof|Old memory|Old product event/,
    );
  } finally {
    store.close();
  }
});

test("applyRecorderRetentionPolicy invalidates memory-to-memory evidence archive chains", async () => {
  const { store } = await makeStore();
  try {
    insertMemoryItem(store, {
      id: "old-memory-root",
      createdAt: "2026-06-26T00:00:00.000Z",
      title: "Old root memory",
      summary: "redacted retention memory root proof",
    });
    insertMemoryItem(store, {
      id: "recent-memory-child",
      createdAt: "2026-06-28T09:00:00.000Z",
      title: "Recent child memory",
      summary: "redacted retention memory child proof",
      sourceIds: [{ id: "old-memory-root", source_type: "memory" }],
    });
    insertEvidenceCandidate(store, {
      id: "candidate-from-retention-memory-child",
      candidateStatus: "pending_review",
      claim: "Candidate from retained child memory",
      createdAt: "2026-06-28T09:05:00.000Z",
      sourceIds: [{ id: "recent-memory-child", source_type: "memory" }],
    });
    insertExportArchiveAsset(store, {
      id: "archive-from-retention-memory-child",
      createdAt: "2026-06-28T09:10:00.000Z",
      sourceIds: [{ id: "candidate-from-retention-memory-child", source_type: "evidence_candidate" }],
    });
    const archivePath = await writePhysicalExportArchive(store, "archive-from-retention-memory-child");

    const result = await applyRecorderRetentionPolicy(store, {
      workspaceId: "workspace-1",
      projectId: "project-1",
      now: new Date("2026-06-28T12:00:00.000Z"),
      policy: {
        rawFrameRetentionHours: 999,
        rawAudioRetentionHours: 999,
        rawClipboardRetentionHours: 999,
        memoryRetentionHours: 24,
        productEventRetentionHours: 999,
        evidenceCandidateRetentionHours: 999,
        pipeOutputRetentionHours: 999,
        auditRetentionHours: 999,
        exportArchiveRetentionHours: 999,
      },
    });

    assert.equal(result.status, "applied");
    assert.deepEqual(result.memoryDeleteResult.memoryItemIds, ["old-memory-root"]);
    assert.equal(result.memoryDeleteResult.invalidatedExportArchiveCount, 1);
    await assert.rejects(fs.access(archivePath), { code: "ENOENT" });
    assert.equal(store.getRecord("memory_items", "old-memory-root").deleted_at, "2026-06-28T12:00:00.000Z");
    const child = store.getRecord("memory_items", "recent-memory-child");
    assert.equal(child.deleted_at, "2026-06-28T12:00:00.000Z");
    assert.equal(child.source_ids_json, "[]");
    const candidate = store.getRecord("evidence_candidates", "candidate-from-retention-memory-child");
    assert.equal(candidate.deleted_at, "2026-06-28T12:00:00.000Z");
    assert.equal(candidate.candidate_status, "rejected");
    assert.equal(candidate.source_ids_json, "[]");
    assertDeletedMediaAssetPurged(store, "archive-from-retention-memory-child", {
      assetType: "export_bundle",
      deletedAt: "2026-06-28T12:00:00.000Z",
    });
  } finally {
    store.close();
  }
});

test("applyRecorderRetentionPolicy invalidates product-to-memory-product evidence archive chains", async () => {
  const { store } = await makeStore();
  try {
    insertProductEvent(store, {
      id: "old-event-root",
      occurredAt: "2026-06-26T00:00:00.000Z",
      title: "Old root event",
      summary: "redacted retention product root proof",
    });
    insertMemoryItem(store, {
      id: "recent-memory-from-event",
      createdAt: "2026-06-28T09:00:00.000Z",
      title: "Recent memory from event",
      summary: "redacted retention product memory proof",
      sourceIds: [{ id: "old-event-root", source_type: "product_event" }],
    });
    insertProductEvent(store, {
      id: "recent-event-from-event",
      occurredAt: "2026-06-28T09:05:00.000Z",
      title: "Recent event from event",
      summary: "redacted retention product event proof",
      sourceIds: [{ id: "old-event-root", source_type: "product_event" }],
    });
    insertEvidenceCandidate(store, {
      id: "candidate-from-retention-product-children",
      candidateStatus: "pending_review",
      claim: "Candidate from product-retention children",
      createdAt: "2026-06-28T09:10:00.000Z",
      sourceIds: [
        { id: "recent-memory-from-event", source_type: "memory" },
        { id: "recent-event-from-event", source_type: "product_event" },
      ],
    });
    insertExportArchiveAsset(store, {
      id: "archive-from-retention-product-children",
      createdAt: "2026-06-28T09:15:00.000Z",
      sourceIds: [{ id: "candidate-from-retention-product-children", source_type: "evidence_candidate" }],
    });
    const archivePath = await writePhysicalExportArchive(store, "archive-from-retention-product-children");

    const result = await applyRecorderRetentionPolicy(store, {
      workspaceId: "workspace-1",
      projectId: "project-1",
      now: new Date("2026-06-28T12:00:00.000Z"),
      policy: {
        rawFrameRetentionHours: 999,
        rawAudioRetentionHours: 999,
        rawClipboardRetentionHours: 999,
        memoryRetentionHours: 999,
        productEventRetentionHours: 24,
        evidenceCandidateRetentionHours: 999,
        pipeOutputRetentionHours: 999,
        auditRetentionHours: 999,
        exportArchiveRetentionHours: 999,
      },
    });

    assert.equal(result.status, "applied");
    assert.deepEqual(result.productEventDeleteResult.productEventIds, ["old-event-root"]);
    assert.equal(result.productEventDeleteResult.invalidatedExportArchiveCount, 1);
    await assert.rejects(fs.access(archivePath), { code: "ENOENT" });
    assert.equal(store.getRecord("product_events", "old-event-root").deleted_at, "2026-06-28T12:00:00.000Z");
    const memory = store.getRecord("memory_items", "recent-memory-from-event");
    assert.equal(memory.deleted_at, "2026-06-28T12:00:00.000Z");
    assert.equal(memory.source_ids_json, "[]");
    const event = store.getRecord("product_events", "recent-event-from-event");
    assert.equal(event.deleted_at, "2026-06-28T12:00:00.000Z");
    assert.equal(event.source_ids_json, "[]");
    const candidate = store.getRecord("evidence_candidates", "candidate-from-retention-product-children");
    assert.equal(candidate.deleted_at, "2026-06-28T12:00:00.000Z");
    assert.equal(candidate.candidate_status, "rejected");
    assert.equal(candidate.source_ids_json, "[]");
    assert.equal(store.getRecord("media_assets", "archive-from-retention-product-children").deleted_at, "2026-06-28T12:00:00.000Z");
  } finally {
    store.close();
  }
});

test("applyRecorderRetentionPolicy tombstones expired resolved evidence candidates", async () => {
  const { store } = await makeStore();
  try {
    insertEvidenceCandidate(store, {
      id: "old-written-candidate",
      candidateStatus: "written_to_ledger",
      claim: "Old written evidence candidate retention proof",
      createdAt: "2026-06-25T12:00:00.000Z",
      reviewedAt: "2026-06-26T00:00:00.000Z",
      proofLedgerEventId: "proof-ledger-event-1",
    });
    insertEvidenceCandidate(store, {
      id: "old-pending-candidate",
      candidateStatus: "pending_review",
      claim: "Old pending evidence candidate must remain reviewable",
      createdAt: "2026-06-25T12:00:00.000Z",
    });
    insertEvidenceCandidate(store, {
      id: "recent-rejected-candidate",
      candidateStatus: "rejected",
      claim: "Recent rejected evidence candidate remains retained",
      createdAt: "2026-06-27T09:00:00.000Z",
      reviewedAt: "2026-06-27T18:00:00.000Z",
    });

    const result = await applyRecorderRetentionPolicy(store, {
      workspaceId: "workspace-1",
      projectId: "project-1",
      now: new Date("2026-06-28T12:00:00.000Z"),
      policy: {
        rawFrameRetentionHours: 999,
        rawAudioRetentionHours: 999,
        rawClipboardRetentionHours: 999,
        memoryRetentionHours: 999,
        productEventRetentionHours: 999,
        evidenceCandidateRetentionHours: 24,
      },
    });

    assert.equal(result.status, "applied");
    assert.equal(result.deletedEvidenceCandidateCount, 1);
    assert.equal(result.rejectedEvidenceCandidateCount, 0);
    assert.deepEqual(result.evidenceCandidateDeleteResult.evidenceCandidateIds, ["old-written-candidate"]);

    const oldWritten = store.getRecord("evidence_candidates", "old-written-candidate");
    assert.equal(oldWritten.deleted_at, "2026-06-28T12:00:00.000Z");
    assert.equal(oldWritten.candidate_status, "written_to_ledger");
    assert.equal(oldWritten.proof_ledger_event_id, "proof-ledger-event-1");
    assertDeletedCandidateMaterialPurged(oldWritten, {
      id: "old-written-candidate",
      status: "deleted",
      reasonCode: "ERR_RECORDER_EVIDENCE_CANDIDATE_RETENTION_EXPIRED",
    });
    assert.equal(store.getRecord("evidence_candidates", "old-pending-candidate").deleted_at, null);
    assert.equal(store.getRecord("evidence_candidates", "old-pending-candidate").candidate_status, "pending_review");
    assert.equal(store.getRecord("evidence_candidates", "recent-rejected-candidate").deleted_at, null);
    assert.doesNotMatch(
      JSON.stringify(result),
      /Old written evidence candidate retention proof|Old pending evidence candidate|Recent rejected evidence candidate|proof_ledger_mapping_json|source_ids_json/,
    );
  } finally {
    store.close();
  }
});

test("applyRecorderRetentionPolicy purges expired Pipe output manifests", async () => {
  const { store } = await makeStore();
  try {
    insertPipeDefinition(store);
    insertPipeRun(store, {
      id: "run-old-output",
      startedAt: "2026-06-26T08:00:00.000Z",
      endedAt: "2026-06-26T09:00:00.000Z",
      outputManifest: {
        outputKind: "day_memory_review",
        items: { note: "old pipe output retention proof" },
        artifacts: [{ kind: "day_memory_review_snapshot", persisted: true }],
        proofAcceptedByPipeRun: false,
      },
    });
    insertPipeRun(store, {
      id: "run-recent-output",
      startedAt: "2026-06-27T18:00:00.000Z",
      endedAt: "2026-06-27T19:00:00.000Z",
      outputManifest: {
        outputKind: "day_memory_review",
        items: { note: "recent pipe output proof" },
        proofAcceptedByPipeRun: false,
      },
    });
    insertPipeRun(store, {
      id: "run-old-queued",
      status: "queued",
      startedAt: "2026-06-26T08:00:00.000Z",
      endedAt: "2026-06-26T09:00:00.000Z",
      outputManifest: { outputKind: "queued_output_should_not_target" },
    });
    insertExportArchiveAsset(store, {
      id: "archive-from-expired-pipe-output",
      createdAt: "2026-06-26T09:05:00.000Z",
      sourceIds: [{ id: "run-old-output", source_type: "pipe_run" }],
    });
    const pipeArchivePath = await writePhysicalExportArchive(store, "archive-from-expired-pipe-output");

    const result = await applyRecorderRetentionPolicy(store, {
      workspaceId: "workspace-1",
      projectId: "project-1",
      now: new Date("2026-06-28T12:00:00.000Z"),
      policy: {
        rawFrameRetentionHours: 999,
        rawAudioRetentionHours: 999,
        rawClipboardRetentionHours: 999,
        memoryRetentionHours: 999,
        productEventRetentionHours: 999,
        evidenceCandidateRetentionHours: 999,
        pipeOutputRetentionHours: 24,
      },
    });

    assert.equal(result.status, "applied");
    assert.equal(result.deletedPipeRunCount, 1);
    assert.equal(result.purgedPipeOutputCount, 1);
    assert.deepEqual(result.pipeOutputDeleteResult.pipeRunIds, ["run-old-output"]);
    assert.equal(result.pipeOutputDeleteResult.invalidatedExportArchiveCount, 1);
    await assert.rejects(fs.access(pipeArchivePath), { code: "ENOENT" });
    const oldRun = store.getRecord("pipe_runs", "run-old-output");
    assert.equal(oldRun.output_manifest_json, null);
    assert.equal(oldRun.deleted_at, "2026-06-28T12:00:00.000Z");
    assert.match(oldRun.audit_log_json, /pipe_succeeded/);
    assertDeletedMediaAssetPurged(store, "archive-from-expired-pipe-output", {
      assetType: "export_bundle",
      deletedAt: "2026-06-28T12:00:00.000Z",
    });
    assert.notEqual(store.getRecord("pipe_runs", "run-recent-output").output_manifest_json, null);
    assert.equal(store.getRecord("pipe_runs", "run-recent-output").deleted_at, null);
    assert.notEqual(store.getRecord("pipe_runs", "run-old-queued").output_manifest_json, null);
    assert.equal(store.getRecord("pipe_runs", "run-old-queued").deleted_at, null);
    assert.doesNotMatch(
      JSON.stringify(result),
      /old pipe output retention proof|recent pipe output proof|queued_output_should_not_target|output_manifest_json/,
    );
  } finally {
    store.close();
  }
});

test("applyRecorderRetentionPolicy tombstones expired audits without clearing accountability fields", async () => {
  const { store } = await makeStore();
  try {
    insertAuditRow(store, {
      id: "audit-old",
      createdAt: "2026-06-26T09:00:00.000Z",
      endpoint: "/recorder/frames/frame-1/image",
      accessLevel: "raw_frame",
      decision: "accepted",
    });
    insertAuditRow(store, {
      id: "audit-recent",
      createdAt: "2026-06-27T18:00:00.000Z",
    });

    const result = await applyRecorderRetentionPolicy(store, {
      workspaceId: "workspace-1",
      projectId: "project-1",
      now: new Date("2026-06-28T12:00:00.000Z"),
      policy: {
        rawFrameRetentionHours: 999,
        rawAudioRetentionHours: 999,
        rawClipboardRetentionHours: 999,
        memoryRetentionHours: 999,
        productEventRetentionHours: 999,
        evidenceCandidateRetentionHours: 999,
        pipeOutputRetentionHours: 999,
        auditRetentionHours: 24,
      },
    });

    assert.equal(result.status, "applied");
    assert.equal(result.tombstonedAuditRowCount, 1);
    assert.deepEqual(result.auditDeleteResult.auditRowIds, ["audit-old"]);
    assert.equal(result.auditDeleteResult.tombstoneOnly, true);
    const oldAudit = store.getRecord("recorder_audit", "audit-old");
    assert.equal(oldAudit.deleted_at, "2026-06-28T12:00:00.000Z");
    assert.equal(oldAudit.endpoint, "/recorder/frames/frame-1/image");
    assert.equal(oldAudit.access_level, "raw_frame");
    assert.equal(oldAudit.decision, "accepted");
    assert.match(oldAudit.source_ids_json, /frame-1/);
    assert.equal(store.getRecord("recorder_audit", "audit-recent").deleted_at, null);
    assert.doesNotMatch(JSON.stringify(result), /source_ids_json|request-audit-old|test-client/);
  } finally {
    store.close();
  }
});

test("applyRecorderRetentionPolicy deletes expired managed export archives", async () => {
  const { store } = await makeStore();
  try {
    insertExportArchiveAsset(store, {
      id: "archive-old",
      createdAt: "2026-06-26T09:00:00.000Z",
    });
    insertExportArchiveAsset(store, {
      id: "archive-recent",
      createdAt: "2026-06-27T18:00:00.000Z",
    });
    insertExportArchiveAsset(store, {
      id: "archive-other-workspace",
      createdAt: "2026-06-26T09:00:00.000Z",
      workspaceId: "workspace-2",
    });
    const oldPath = await writePhysicalExportArchive(store, "archive-old");
    const recentPath = await writePhysicalExportArchive(store, "archive-recent");
    const otherPath = await writePhysicalExportArchive(store, "archive-other-workspace");

    const result = await applyRecorderRetentionPolicy(store, {
      workspaceId: "workspace-1",
      projectId: "project-1",
      now: new Date("2026-06-28T12:00:00.000Z"),
      policy: {
        rawFrameRetentionHours: 999,
        rawAudioRetentionHours: 999,
        rawClipboardRetentionHours: 999,
        memoryRetentionHours: 999,
        productEventRetentionHours: 999,
        evidenceCandidateRetentionHours: 999,
        pipeOutputRetentionHours: 999,
        auditRetentionHours: 999,
        exportArchiveRetentionHours: 24,
      },
    });

    assert.equal(result.status, "applied");
    assert.equal(result.deletedExportArchiveCount, 1);
    assert.equal(result.deletedMediaCount, 1);
    assert.deepEqual(result.exportArchiveDeleteResult.exportArchiveIds, ["archive-old"]);
    await assert.rejects(fs.access(oldPath), { code: "ENOENT" });
    await fs.access(recentPath);
    await fs.access(otherPath);
    assertDeletedMediaAssetPurged(store, "archive-old", {
      assetType: "export_bundle",
      deletedAt: "2026-06-28T12:00:00.000Z",
    });
    assert.equal(store.getRecord("media_assets", "archive-recent").deleted_at, null);
    assert.equal(store.getRecord("media_assets", "archive-other-workspace").deleted_at, null);
    assert.doesNotMatch(JSON.stringify(result), /exports\/|agentic30\.recorder\.export_archive/);
  } finally {
    store.close();
  }
});

test("applyRecorderRetentionPolicy tolerates a missing expired frame file: orphan never deadlocks the sweep", async () => {
  const { store } = await makeStore();
  try {
    recordFrameCaptureEnvelope(store, frameEnvelope({
      id: "old-frame-1",
      assetId: "old-asset-1",
      capturedAt: "2026-06-26T00:00:00.000Z",
      text: "redacted retained first proof",
    }));
    recordFrameCaptureEnvelope(store, frameEnvelope({
      id: "old-frame-2",
      assetId: "old-asset-2",
      capturedAt: "2026-06-26T01:00:00.000Z",
      text: "redacted retained second proof",
    }));
    // old-asset-1 present; old-asset-2 is an orphan (row present, file gone).
    const existingPath = await writePhysicalMedia(store, "old-asset-1");

    const result = await applyRecorderRetentionPolicy(store, {
      now: new Date("2026-06-28T12:00:00.000Z"),
    });

    assert.equal(result.deletedFrameCount, 2);
    assert.equal(result.deleteResult.mediaRemovedCount, 1);
    assert.equal(result.deleteResult.mediaAlreadyMissingCount, 1);
    await assert.rejects(fs.access(existingPath), { code: "ENOENT" });
    // The orphan no longer blocks retention: both expired raw frames are purged.
    assert.equal(store.getRecord("frames", "old-frame-1").deleted_at, "2026-06-28T12:00:00.000Z");
    assert.equal(store.getRecord("frames", "old-frame-2").deleted_at, "2026-06-28T12:00:00.000Z");
    assertDeletedMediaAssetPurged(store, "old-asset-1", {
      assetType: "frame_jpeg",
      deletedAt: "2026-06-28T12:00:00.000Z",
    });
    assertDeletedMediaAssetPurged(store, "old-asset-2", {
      assetType: "frame_jpeg",
      deletedAt: "2026-06-28T12:00:00.000Z",
    });
    assert.deepEqual(store.search("retained first proof"), []);
    assert.deepEqual(store.search("retained second proof"), []);
  } finally {
    store.close();
  }
});

test("applyRecorderRetentionPolicy tolerates a missing expired audio file while purging frame + audio", async () => {
  const { store } = await makeStore();
  try {
    recordFrameCaptureEnvelope(store, frameEnvelope({
      id: "old-frame",
      assetId: "old-frame-asset",
      capturedAt: "2026-06-26T00:00:00.000Z",
      text: "redacted mixed retention frame proof",
    }));
    const controlState = readyAudioControlState();
    recordAudioChunk(store, audioChunk({
      id: "old-audio-missing",
      assetId: "old-audio-missing-asset",
      segmentId: "old-audio-missing-segment",
      startedAt: "2026-06-26T01:00:00.000Z",
      endedAt: "2026-06-26T01:01:00.000Z",
      text: "redacted mixed retention audio proof",
    }), { controlState });
    // Frame present; audio media file is an orphan.
    const framePath = await writePhysicalMedia(store, "old-frame-asset");

    const result = await applyRecorderRetentionPolicy(store, {
      now: new Date("2026-06-28T12:00:00.000Z"),
    });

    assert.equal(result.deletedFrameCount, 1);
    assert.equal(result.deletedAudioChunkCount, 1);
    assert.equal(result.audioDeleteResult.mediaRemovedCount, 0);
    assert.equal(result.audioDeleteResult.mediaAlreadyMissingCount, 1);
    await assert.rejects(fs.access(framePath), { code: "ENOENT" });
    assert.equal(store.getRecord("frames", "old-frame").deleted_at, "2026-06-28T12:00:00.000Z");
    assertDeletedMediaAssetPurged(store, "old-frame-asset", {
      assetType: "frame_jpeg",
      deletedAt: "2026-06-28T12:00:00.000Z",
    });
    assert.equal(store.getRecord("audio_chunks", "old-audio-missing").deleted_at, "2026-06-28T12:00:00.000Z");
    assertDeletedMediaAssetPurged(store, "old-audio-missing-asset", {
      assetType: "audio_m4a",
      deletedAt: "2026-06-28T12:00:00.000Z",
    });
    assert.equal(store.getRecord("transcript_segments", "old-audio-missing-segment").deleted_at, "2026-06-28T12:00:00.000Z");
    assert.deepEqual(store.search("mixed retention frame proof"), []);
    assert.deepEqual(store.search("mixed retention audio proof", { sourceTypes: ["transcript"] }), []);
  } finally {
    store.close();
  }
});

test("applyRecorderRetentionPolicy still fails before mutation on a genuine non-ENOENT frame media error", async () => {
  const { store } = await makeStore();
  try {
    recordFrameCaptureEnvelope(store, frameEnvelope({
      id: "old-frame-1",
      assetId: "old-asset-1",
      capturedAt: "2026-06-26T00:00:00.000Z",
      text: "redacted retained first proof",
    }));
    recordFrameCaptureEnvelope(store, frameEnvelope({
      id: "old-frame-2",
      assetId: "old-asset-2",
      capturedAt: "2026-06-26T01:00:00.000Z",
      text: "redacted retained second proof",
    }));
    const existingPath = await writePhysicalMedia(store, "old-asset-1");
    // Directory where a frame file is expected: genuine non-ENOENT error must
    // fail-before-mutation across the whole sweep.
    const blockedPath = resolveRecorderFrameMediaPath(store, store.getRecord("media_assets", "old-asset-2"));
    await fs.mkdir(blockedPath, { recursive: true });

    await assert.rejects(
      () => applyRecorderRetentionPolicy(store, {
        now: new Date("2026-06-28T12:00:00.000Z"),
      }),
      /ERR_RECORDER_DELETE_MEDIA_NOT_FILE/,
    );

    await fs.access(existingPath);
    assert.equal(store.getRecord("frames", "old-frame-1").deleted_at, null);
    assert.equal(store.getRecord("frames", "old-frame-2").deleted_at, null);
    assert.equal(store.getRecord("media_assets", "old-asset-1").deleted_at, null);
    assert.equal(store.getRecord("media_assets", "old-asset-2").deleted_at, null);
    assert.equal(store.search("retained first proof").length, 1);
    assert.equal(store.search("retained second proof").length, 1);
  } finally {
    store.close();
  }
});

test("applyRecorderRetentionPolicy tolerates missing direct export archive: sweep continues, all expired content deleted, orphan tombstoned", async () => {
  const { store } = await makeStore();
  try {
    recordFrameCaptureEnvelope(store, frameEnvelope({
      id: "old-frame-with-export-missing",
      assetId: "old-frame-with-export-missing-asset",
      capturedAt: "2026-06-26T00:00:00.000Z",
      text: "redacted mixed export retention frame proof",
    }));
    insertMemoryItem(store, {
      id: "old-memory-export-preflight",
      createdAt: "2026-06-26T00:30:00.000Z",
      title: "Old memory export preflight",
      summary: "redacted mixed export retention memory proof",
    });
    insertProductEvent(store, {
      id: "old-event-export-preflight",
      occurredAt: "2026-06-26T01:00:00.000Z",
      title: "Old event export preflight",
      summary: "redacted mixed export retention product proof",
    });
    // Export archive has expired and its physical file is missing — an orphan.
    // After the fix this must NOT abort the sweep.
    insertExportArchiveAsset(store, {
      id: "archive-missing-export-preflight",
      createdAt: "2026-06-26T02:00:00.000Z",
    });
    const framePath = await writePhysicalMedia(store, "old-frame-with-export-missing-asset");

    await applyRecorderRetentionPolicy(store, {
      workspaceId: "workspace-1",
      projectId: "project-1",
      now: new Date("2026-06-28T12:00:00.000Z"),
      policy: {
        rawFrameRetentionHours: 24,
        rawAudioRetentionHours: 999,
        rawClipboardRetentionHours: 999,
        memoryRetentionHours: 24,
        productEventRetentionHours: 24,
        evidenceCandidateRetentionHours: 999,
        pipeOutputRetentionHours: 999,
        auditRetentionHours: 999,
        exportArchiveRetentionHours: 24,
      },
    });

    // Frame deleted and its physical file removed.
    await assert.rejects(fs.access(framePath), { code: "ENOENT" });
    const frame = store.getRecord("frames", "old-frame-with-export-missing");
    assert.notEqual(frame.deleted_at, null);
    assert.equal(frame.safe_for_search, 0);
    assert.notEqual(store.getRecord("media_assets", "old-frame-with-export-missing-asset").deleted_at, null);
    // Memory and product event deleted by their own retention.
    assert.notEqual(store.getRecord("memory_items", "old-memory-export-preflight").deleted_at, null);
    assert.notEqual(store.getRecord("product_events", "old-event-export-preflight").deleted_at, null);
    // Orphan export archive row tombstoned even though its physical file was already gone.
    assert.notEqual(store.getRecord("media_assets", "archive-missing-export-preflight").deleted_at, null);
    assert.equal(store.search("mixed export retention frame proof").length, 0);
    assert.equal(store.search("mixed export retention memory proof", { sourceTypes: ["memory"] }).length, 0);
    assert.equal(store.search("mixed export retention product proof", { sourceTypes: ["product_event"] }).length, 0);
  } finally {
    store.close();
  }
});

test("applyRecorderRetentionPolicy tolerates missing source-linked export archive: sweep continues, source rows deleted, orphan tombstoned", async () => {
  const { store } = await makeStore();
  try {
    recordFrameCaptureEnvelope(store, frameEnvelope({
      id: "old-frame-before-source-archive",
      assetId: "old-frame-before-source-archive-asset",
      capturedAt: "2026-06-26T00:00:00.000Z",
      text: "redacted source archive preflight frame proof",
    }));
    insertMemoryItem(store, {
      id: "old-memory-source-archive",
      createdAt: "2026-06-26T01:00:00.000Z",
      title: "Old memory source archive",
      summary: "redacted source archive preflight memory proof",
    });
    // Archive is recent (not expired directly) but its physical file is
    // missing — an orphan closure target. After the fix the sweep must NOT
    // abort; the archive must be tombstoned when the memory it references
    // is deleted by its own retention policy.
    insertExportArchiveAsset(store, {
      id: "archive-recent-missing-for-memory-source",
      createdAt: "2026-06-28T11:00:00.000Z",
      sourceIds: [{ id: "old-memory-source-archive", source_type: "memory" }],
    });
    const framePath = await writePhysicalMedia(store, "old-frame-before-source-archive-asset");

    await applyRecorderRetentionPolicy(store, {
      workspaceId: "workspace-1",
      projectId: "project-1",
      now: new Date("2026-06-28T12:00:00.000Z"),
      policy: {
        rawFrameRetentionHours: 24,
        rawAudioRetentionHours: 999,
        rawClipboardRetentionHours: 999,
        memoryRetentionHours: 24,
        productEventRetentionHours: 999,
        evidenceCandidateRetentionHours: 999,
        pipeOutputRetentionHours: 999,
        auditRetentionHours: 999,
        exportArchiveRetentionHours: 999,
      },
    });

    // Frame deleted and physical file removed.
    await assert.rejects(fs.access(framePath), { code: "ENOENT" });
    const frame = store.getRecord("frames", "old-frame-before-source-archive");
    assert.notEqual(frame.deleted_at, null);
    assert.equal(frame.safe_for_search, 0);
    assert.notEqual(store.getRecord("media_assets", "old-frame-before-source-archive-asset").deleted_at, null);
    // Memory deleted by its own retention policy.
    assert.notEqual(store.getRecord("memory_items", "old-memory-source-archive").deleted_at, null);
    // Orphan archive tombstoned via the memory deletion's invalidation sweep.
    assert.notEqual(store.getRecord("media_assets", "archive-recent-missing-for-memory-source").deleted_at, null);
    assert.equal(store.search("source archive preflight frame proof").length, 0);
    assert.equal(store.search("source archive preflight memory proof", { sourceTypes: ["memory"] }).length, 0);
  } finally {
    store.close();
  }
});

test("applyRecorderRetentionPolicy tolerates missing derived-row export archive: sweep continues, frame deleted, memory soft-deleted", async () => {
  const { store } = await makeStore();
  try {
    recordFrameCaptureEnvelope(store, frameEnvelope({
      id: "old-frame-derived-archive",
      assetId: "old-frame-derived-archive-asset",
      capturedAt: "2026-06-26T00:00:00.000Z",
      text: "redacted derived archive preflight frame proof",
    }));
    insertMemoryItem(store, {
      id: "recent-memory-derived-from-old-frame",
      createdAt: "2026-06-28T11:00:00.000Z",
      title: "Recent memory derived from old frame",
      summary: "redacted derived archive preflight memory proof",
      sourceIds: [{ id: "old-frame-derived-archive", source_type: "frame" }],
    });
    // Archive references the recent memory which itself references the expiring
    // frame. The archive's physical file is already missing (orphan). After
    // the fix the closure preflight tolerates ENOENT; the frame deletion's
    // closure invalidation finds the archive via the memory chain and
    // tombstones the row even though its physical file was already gone.
    insertExportArchiveAsset(store, {
      id: "archive-recent-missing-for-derived-memory",
      createdAt: "2026-06-28T11:30:00.000Z",
      sourceIds: [{ id: "recent-memory-derived-from-old-frame", source_type: "memory" }],
    });
    const framePath = await writePhysicalMedia(store, "old-frame-derived-archive-asset");

    await applyRecorderRetentionPolicy(store, {
      workspaceId: "workspace-1",
      projectId: "project-1",
      now: new Date("2026-06-28T12:00:00.000Z"),
      policy: {
        rawFrameRetentionHours: 24,
        rawAudioRetentionHours: 999,
        rawClipboardRetentionHours: 999,
        memoryRetentionHours: 999,
        productEventRetentionHours: 999,
        evidenceCandidateRetentionHours: 999,
        pipeOutputRetentionHours: 999,
        auditRetentionHours: 999,
        exportArchiveRetentionHours: 999,
      },
    });

    // Frame deleted and its physical file removed.
    await assert.rejects(fs.access(framePath), { code: "ENOENT" });
    const frame = store.getRecord("frames", "old-frame-derived-archive");
    assert.notEqual(frame.deleted_at, null);
    assert.equal(frame.safe_for_search, 0);
    assert.notEqual(store.getRecord("media_assets", "old-frame-derived-archive-asset").deleted_at, null);
    // Memory soft-deleted by invalidateDerivedRowsForSources (its only source, the frame, was deleted).
    const memory = store.getRecord("memory_items", "recent-memory-derived-from-old-frame");
    assert.notEqual(memory.deleted_at, null);
    assert.equal(memory.safe_for_search, 0);
    // Archive tombstoned: the frame deletion closure expands through the memory,
    // so the archive is found as a direct invalidation target and tombstoned.
    assert.notEqual(store.getRecord("media_assets", "archive-recent-missing-for-derived-memory").deleted_at, null);
    assert.equal(store.search("derived archive preflight frame proof").length, 0);
    assert.equal(store.search("derived archive preflight memory proof", { sourceTypes: ["memory"] }).length, 0);
  } finally {
    store.close();
  }
});

test("normalizeRecorderRetentionPolicy rejects invalid retention durations", () => {
  assert.throws(
    () => normalizeRecorderRetentionPolicy({ rawFrameRetentionHours: 0 }),
    (error) => error instanceof RecorderRetentionError
      && error.code === "ERR_RECORDER_RETENTION_INVALID_POLICY",
  );
});

test("applyRecorderRetentionPolicy: orphaned direct export archive (ENOENT) no longer aborts sweep — orphan tombstoned, expired raw frame purged, text removed from search", async () => {
  // Regression for the ENOENT deadlock: a missing export-bundle file on disk
  // must not permanently block the always-on retention sweep from purging
  // expired raw frames that remain live and searchable.
  const { store } = await makeStore();
  try {
    recordFrameCaptureEnvelope(store, frameEnvelope({
      id: "frame-orphan-archive-regression",
      assetId: "asset-orphan-archive-regression",
      capturedAt: "2026-06-26T00:00:00.000Z",
      text: "redacted orphan archive regression proof",
    }));
    // Export archive has itself expired but its physical file is missing.
    insertExportArchiveAsset(store, {
      id: "direct-orphan-archive",
      createdAt: "2026-06-26T01:00:00.000Z",
    });
    const framePath = await writePhysicalMedia(store, "asset-orphan-archive-regression");

    await applyRecorderRetentionPolicy(store, {
      workspaceId: "workspace-1",
      projectId: "project-1",
      now: new Date("2026-06-28T12:00:00.000Z"),
      policy: {
        rawFrameRetentionHours: 24,
        rawAudioRetentionHours: 999,
        rawClipboardRetentionHours: 999,
        memoryRetentionHours: 999,
        productEventRetentionHours: 999,
        evidenceCandidateRetentionHours: 999,
        pipeOutputRetentionHours: 999,
        auditRetentionHours: 999,
        exportArchiveRetentionHours: 24,
      },
    });

    // Expired raw frame purged: physical file gone, row deleted, text not searchable.
    await assert.rejects(fs.access(framePath), { code: "ENOENT" });
    assert.notEqual(store.getRecord("frames", "frame-orphan-archive-regression").deleted_at, null);
    assert.equal(store.search("orphan archive regression proof").length, 0);
    // Orphan export archive row tombstoned even though its physical file was already gone.
    assert.notEqual(store.getRecord("media_assets", "direct-orphan-archive").deleted_at, null);
  } finally {
    store.close();
  }
});

test("applyRecorderRetentionPolicy: non-ENOENT direct export archive (directory at bundle path) still fails-before-mutation", async () => {
  const { store } = await makeStore();
  try {
    recordFrameCaptureEnvelope(store, frameEnvelope({
      id: "frame-dir-retention-archive",
      assetId: "asset-dir-retention-archive",
      capturedAt: "2026-06-26T00:00:00.000Z",
      text: "redacted dir retention fail proof",
    }));
    // Export archive expired; a DIRECTORY sits at the bundle path.
    // Not ENOENT → must fail-before-mutation.
    insertExportArchiveAsset(store, {
      id: "dir-retention-archive",
      createdAt: "2026-06-26T01:00:00.000Z",
    });
    const framePath = await writePhysicalMedia(store, "asset-dir-retention-archive");
    const archiveMedia = store.getRecord("media_assets", "dir-retention-archive");
    const archivePath = resolveRecorderExportArchiveMediaPath(store, archiveMedia);
    await fs.mkdir(archivePath, { recursive: true });

    await assert.rejects(
      () => applyRecorderRetentionPolicy(store, {
        workspaceId: "workspace-1",
        projectId: "project-1",
        now: new Date("2026-06-28T12:00:00.000Z"),
        policy: {
          rawFrameRetentionHours: 24,
          rawAudioRetentionHours: 999,
          rawClipboardRetentionHours: 999,
          memoryRetentionHours: 999,
          productEventRetentionHours: 999,
          evidenceCandidateRetentionHours: 999,
          pipeOutputRetentionHours: 999,
          auditRetentionHours: 999,
          exportArchiveRetentionHours: 24,
        },
      }),
      /ERR_RECORDER_DELETE_MEDIA_NOT_FILE/,
    );

    // Fail-before-mutation: frame row intact, text still searchable.
    await fs.access(framePath);
    assert.equal(store.getRecord("frames", "frame-dir-retention-archive").deleted_at, null);
    assert.equal(store.getRecord("media_assets", "dir-retention-archive").deleted_at, null);
    assert.equal(store.search("dir retention fail proof").length, 1);
  } finally {
    store.close();
  }
});
