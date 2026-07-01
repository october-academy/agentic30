import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";

export class RecorderDeleteError extends Error {
  constructor(code, message, details = {}) {
    super(`${code}: ${message}`);
    this.name = "RecorderDeleteError";
    this.code = code;
    this.details = details;
  }
}

const UNRESOLVED_EVIDENCE_CANDIDATE_STATUSES = new Set([
  "pending_review",
  "degraded",
  "approved_bundle",
]);

const TERMINAL_PIPE_RUN_STATUSES = new Set([
  "succeeded",
  "failed",
  "cancelled",
  "timed_out",
]);

const DELETED_REDACTION_STATUS = "deleted";
const DELETED_PRIVACY_STATE = "deleted";
const EMPTY_SOURCE_IDS_JSON = "[]";
const DELETED_MEDIA_SHA256 = "0".repeat(64);

export async function deleteRecorderFrameCapture(store, frameId, { now = new Date() } = {}) {
  if (!store) {
    fail("ERR_RECORDER_DELETE_STORE_REQUIRED", "deleteRecorderFrameCapture requires store");
  }
  const cleanFrameId = requiredText(frameId, "frameId");
  const frame = store.getRecord("frames", cleanFrameId);
  if (!frame) {
    fail("ERR_RECORDER_DELETE_FRAME_NOT_FOUND", `recorder frame not found: ${cleanFrameId}`);
  }
  if (frame.deleted_at) {
    fail("ERR_RECORDER_DELETE_FRAME_ALREADY_DELETED", `recorder frame already deleted: ${cleanFrameId}`);
  }
  const mediaAsset = store.getRecord("media_assets", frame.snapshot_asset_id);
  if (!mediaAsset) {
    fail("ERR_RECORDER_DELETE_MEDIA_NOT_FOUND", `snapshot media asset not found: ${frame.snapshot_asset_id}`);
  }
  if (mediaAsset.deleted_at) {
    fail("ERR_RECORDER_DELETE_MEDIA_ALREADY_DELETED", `snapshot media asset already deleted: ${mediaAsset.id}`);
  }
  if (mediaAsset.asset_type !== "frame_jpeg") {
    fail("ERR_RECORDER_DELETE_UNEXPECTED_MEDIA_TYPE", `frame snapshot media must be frame_jpeg, got ${mediaAsset.asset_type}`, {
      mediaAssetId: mediaAsset.id,
      assetType: mediaAsset.asset_type,
    });
  }

  const sourceRefs = [{ id: frame.id, source_type: "frame" }];
  const mediaPath = resolveRecorderFrameMediaPath(store, mediaAsset);
  const invalidation = prepareRecorderInvalidation(store, sourceRefs);
  const exportArchiveTargets = invalidation.exportArchiveTargets;
  const mediaPresent = await preflightMediaFilePresence(mediaPath, mediaAsset.id, "frame");
  preflightExportArchiveTargetsSync(exportArchiveTargets);

  const deletedAt = toIso(now);
  const mediaRemoved = mediaPresent
    ? await unlinkPhysicalFile(mediaPath, mediaAsset.id, "frame")
    : false;
  unlinkExportArchiveTargetsSync(exportArchiveTargets);
  store.withTransaction(() => {
    store.updateRecord("frames", frame.id, {
      browser_url: null,
      browser_url_normalized: null,
      browser_domain: null,
      browser_url_search_label: null,
      document_path: null,
      document_path_search_label: null,
      accessibility_text: null,
      ocr_text: null,
      redacted_text: null,
      redaction_status: DELETED_REDACTION_STATUS,
      privacy_state: DELETED_PRIVACY_STATE,
      safe_for_search: 0,
      safe_for_memory: 0,
      safe_for_export: 0,
      deleted_at: deletedAt,
    });
    store.updateRecord("media_assets", mediaAsset.id, deletedMediaAssetPatch(mediaAsset, { deletedAt }));
    invalidateDerivedRowsForSources(store, invalidation.sourceRefs, {
      deletedAt,
      exportArchiveTargets,
    });
  });

  return {
    status: "deleted",
    frameId: frame.id,
    frame_id: frame.id,
    mediaAssetId: mediaAsset.id,
    media_asset_id: mediaAsset.id,
    mediaPath,
    media_path: mediaPath,
    mediaRemoved,
    media_removed: mediaRemoved,
    mediaAlreadyMissing: !mediaPresent,
    media_already_missing: !mediaPresent,
    invalidatedExportArchiveCount: exportArchiveTargets.length,
    invalidated_export_archive_count: exportArchiveTargets.length,
    deletedAt,
    deleted_at: deletedAt,
  };
}

export async function deleteRecorderFrameCapturesInRange(store, {
  startedAt,
  endedAt,
  workspaceId = null,
  projectId = null,
  now = new Date(),
  limit = 5000,
} = {}) {
  if (!store) {
    fail("ERR_RECORDER_DELETE_STORE_REQUIRED", "deleteRecorderFrameCapturesInRange requires store");
  }
  const range = normalizeRange({ startedAt, endedAt });
  const max = Math.max(1, Math.min(50000, Number.parseInt(String(limit), 10) || 5000));
  const scopedWorkspaceId = textOrNull(workspaceId);
  const scopedProjectId = textOrNull(projectId);
  const frames = store.listRecords("frames", { limit: max, orderBy: "captured_at" })
    .filter((frame) => {
      if (frame.deleted_at) return false;
      if (scopedWorkspaceId && frame.workspace_id !== scopedWorkspaceId) return false;
      if (scopedProjectId && frame.project_id !== scopedProjectId) return false;
      const capturedAt = Date.parse(frame.captured_at);
      return Number.isFinite(capturedAt) && capturedAt >= range.startedAtMs && capturedAt < range.endedAtMs;
    });
  const targets = frames.map((frame) => {
    const mediaAsset = store.getRecord("media_assets", frame.snapshot_asset_id);
    if (!mediaAsset) {
      fail("ERR_RECORDER_DELETE_MEDIA_NOT_FOUND", `snapshot media asset not found: ${frame.snapshot_asset_id}`);
    }
    if (mediaAsset.deleted_at) {
      fail("ERR_RECORDER_DELETE_MEDIA_ALREADY_DELETED", `snapshot media asset already deleted: ${mediaAsset.id}`);
    }
    if (mediaAsset.asset_type !== "frame_jpeg") {
      fail("ERR_RECORDER_DELETE_UNEXPECTED_MEDIA_TYPE", `frame snapshot media must be frame_jpeg, got ${mediaAsset.asset_type}`, {
        mediaAssetId: mediaAsset.id,
        assetType: mediaAsset.asset_type,
      });
    }
    return {
      frame,
      mediaAsset,
      mediaPath: resolveRecorderFrameMediaPath(store, mediaAsset),
    };
  });

  const sourceRefs = targets.map((target) => ({
    id: target.frame.id,
    source_type: "frame",
  }));
  const invalidation = prepareRecorderInvalidation(store, sourceRefs);
  const exportArchiveTargets = invalidation.exportArchiveTargets;
  const mediaPresence = [];
  for (const target of targets) {
    mediaPresence.push(await preflightMediaFilePresence(target.mediaPath, target.mediaAsset.id, "frame"));
  }
  preflightExportArchiveTargetsSync(exportArchiveTargets);

  const deletedAt = toIso(now);
  let mediaRemovedCount = 0;
  let mediaAlreadyMissingCount = 0;
  for (let index = 0; index < targets.length; index += 1) {
    const removed = mediaPresence[index]
      ? await unlinkPhysicalFile(targets[index].mediaPath, targets[index].mediaAsset.id, "frame")
      : false;
    if (removed) {
      mediaRemovedCount += 1;
    } else {
      mediaAlreadyMissingCount += 1;
    }
  }
  unlinkExportArchiveTargetsSync(exportArchiveTargets);
  store.withTransaction(() => {
    for (const { frame, mediaAsset } of targets) {
      store.updateRecord("frames", frame.id, {
        browser_url: null,
        browser_url_normalized: null,
        browser_domain: null,
        browser_url_search_label: null,
        document_path: null,
        document_path_search_label: null,
        accessibility_text: null,
        ocr_text: null,
        redacted_text: null,
        redaction_status: DELETED_REDACTION_STATUS,
        privacy_state: DELETED_PRIVACY_STATE,
        safe_for_search: 0,
        safe_for_memory: 0,
        safe_for_export: 0,
        deleted_at: deletedAt,
      });
      store.updateRecord("media_assets", mediaAsset.id, {
        ...deletedMediaAssetPatch(mediaAsset, { deletedAt }),
      });
    }
    invalidateDerivedRowsForSources(store, invalidation.sourceRefs, { deletedAt, exportArchiveTargets });
  });

  return {
    status: "deleted",
    frameCount: targets.length,
    frame_count: targets.length,
    mediaRemovedCount,
    media_removed_count: mediaRemovedCount,
    mediaAlreadyMissingCount,
    media_already_missing_count: mediaAlreadyMissingCount,
    frameIds: targets.map((target) => target.frame.id),
    frame_ids: targets.map((target) => target.frame.id),
    mediaAssetIds: targets.map((target) => target.mediaAsset.id),
    media_asset_ids: targets.map((target) => target.mediaAsset.id),
    invalidatedExportArchiveCount: exportArchiveTargets.length,
    invalidated_export_archive_count: exportArchiveTargets.length,
    deletedAt,
    deleted_at: deletedAt,
  };
}

export async function deleteRecorderAudioChunksInRange(store, {
  startedAt,
  endedAt,
  workspaceId = null,
  projectId = null,
  now = new Date(),
  limit = 5000,
} = {}) {
  if (!store) {
    fail("ERR_RECORDER_DELETE_STORE_REQUIRED", "deleteRecorderAudioChunksInRange requires store");
  }
  const range = normalizeRange({ startedAt, endedAt });
  const max = Math.max(1, Math.min(50000, Number.parseInt(String(limit), 10) || 5000));
  const scopedWorkspaceId = textOrNull(workspaceId);
  const scopedProjectId = textOrNull(projectId);
  const audioChunks = store.listRecords("audio_chunks", { limit: max, orderBy: "started_at" })
    .filter((audio) => {
      if (audio.deleted_at) return false;
      if (scopedWorkspaceId && audio.workspace_id !== scopedWorkspaceId) return false;
      if (scopedProjectId && audio.project_id !== scopedProjectId) return false;
      const started = Date.parse(audio.started_at);
      return Number.isFinite(started) && started >= range.startedAtMs && started < range.endedAtMs;
    });
  const transcriptRows = store.listRecords("transcript_segments", { limit: 50000 });
  const targets = audioChunks.map((audio) => {
    const mediaAsset = store.getRecord("media_assets", audio.audio_asset_id);
    if (!mediaAsset) {
      fail("ERR_RECORDER_DELETE_MEDIA_NOT_FOUND", `audio media asset not found: ${audio.audio_asset_id}`);
    }
    if (mediaAsset.deleted_at) {
      fail("ERR_RECORDER_DELETE_MEDIA_ALREADY_DELETED", `audio media asset already deleted: ${mediaAsset.id}`);
    }
    if (mediaAsset.asset_type !== "audio_m4a") {
      fail("ERR_RECORDER_DELETE_UNEXPECTED_MEDIA_TYPE", `audio media must be audio_m4a, got ${mediaAsset.asset_type}`, {
        mediaAssetId: mediaAsset.id,
        assetType: mediaAsset.asset_type,
      });
    }
    return {
      audio,
      mediaAsset,
      mediaPath: resolveRecorderAudioMediaPath(store, mediaAsset),
      transcriptSegments: transcriptRows.filter((segment) => segment.audio_chunk_id === audio.id && !segment.deleted_at),
    };
  });

  const sourceRefs = targets.flatMap((target) => [
    { id: target.audio.id, source_type: "audio" },
    { id: target.audio.id, source_type: "audio_chunk" },
    ...target.transcriptSegments.map((segment) => ({
      id: segment.id,
      source_type: "transcript",
    })),
  ]);
  const invalidation = prepareRecorderInvalidation(store, sourceRefs);
  const exportArchiveTargets = invalidation.exportArchiveTargets;
  const mediaPresence = [];
  for (const target of targets) {
    mediaPresence.push(await preflightMediaFilePresence(target.mediaPath, target.mediaAsset.id, "audio"));
  }
  preflightExportArchiveTargetsSync(exportArchiveTargets);

  const deletedAt = toIso(now);
  let mediaRemovedCount = 0;
  let mediaAlreadyMissingCount = 0;
  for (let index = 0; index < targets.length; index += 1) {
    const removed = mediaPresence[index]
      ? await unlinkPhysicalFile(targets[index].mediaPath, targets[index].mediaAsset.id, "audio")
      : false;
    if (removed) {
      mediaRemovedCount += 1;
    } else {
      mediaAlreadyMissingCount += 1;
    }
  }
  unlinkExportArchiveTargetsSync(exportArchiveTargets);
  store.withTransaction(() => {
    for (const { audio, mediaAsset, transcriptSegments } of targets) {
      store.updateRecord("audio_chunks", audio.id, {
        redaction_status: DELETED_REDACTION_STATUS,
        privacy_state: DELETED_PRIVACY_STATE,
        deleted_at: deletedAt,
      });
      store.updateRecord("media_assets", mediaAsset.id, {
        ...deletedMediaAssetPatch(mediaAsset, { deletedAt }),
      });
      for (const segment of transcriptSegments) {
        store.updateRecord("transcript_segments", segment.id, {
          text: "",
          redacted_text: "",
          redaction_status: DELETED_REDACTION_STATUS,
          privacy_state: DELETED_PRIVACY_STATE,
          safe_for_search: 0,
          safe_for_memory: 0,
          deletion_source_id: audio.id,
          deleted_at: deletedAt,
        });
      }
    }
    invalidateDerivedRowsForSources(store, invalidation.sourceRefs, { deletedAt, exportArchiveTargets });
  });

  return {
    status: "deleted",
    audioChunkCount: targets.length,
    audio_chunk_count: targets.length,
    transcriptSegmentCount: targets.reduce((sum, target) => sum + target.transcriptSegments.length, 0),
    transcript_segment_count: targets.reduce((sum, target) => sum + target.transcriptSegments.length, 0),
    mediaRemovedCount,
    media_removed_count: mediaRemovedCount,
    mediaAlreadyMissingCount,
    media_already_missing_count: mediaAlreadyMissingCount,
    audioChunkIds: targets.map((target) => target.audio.id),
    audio_chunk_ids: targets.map((target) => target.audio.id),
    transcriptSegmentIds: targets.flatMap((target) => target.transcriptSegments.map((segment) => segment.id)),
    transcript_segment_ids: targets.flatMap((target) => target.transcriptSegments.map((segment) => segment.id)),
    mediaAssetIds: targets.map((target) => target.mediaAsset.id),
    media_asset_ids: targets.map((target) => target.mediaAsset.id),
    invalidatedExportArchiveCount: exportArchiveTargets.length,
    invalidated_export_archive_count: exportArchiveTargets.length,
    deletedAt,
    deleted_at: deletedAt,
  };
}

export function deleteRecorderClipboardEventsInRange(store, {
  startedAt,
  endedAt,
  workspaceId = null,
  projectId = null,
  now = new Date(),
  limit = 5000,
} = {}) {
  if (!store) {
    fail("ERR_RECORDER_DELETE_STORE_REQUIRED", "deleteRecorderClipboardEventsInRange requires store");
  }
  const range = normalizeRange({ startedAt, endedAt });
  const max = Math.max(1, Math.min(50000, Number.parseInt(String(limit), 10) || 5000));
  const scopedWorkspaceId = textOrNull(workspaceId);
  const scopedProjectId = textOrNull(projectId);
  const targets = store.listRecords("clipboard_events", { limit: max, orderBy: "captured_at" })
    .filter((event) => {
      if (event.deleted_at) return false;
      if (scopedWorkspaceId && event.workspace_id !== scopedWorkspaceId) return false;
      if (scopedProjectId && event.project_id !== scopedProjectId) return false;
      const capturedAt = Date.parse(event.captured_at);
      return Number.isFinite(capturedAt) && capturedAt >= range.startedAtMs && capturedAt < range.endedAtMs;
    });

  const sourceRefs = targets.map((event) => ({
    id: event.id,
    source_type: "clipboard",
  }));
  const invalidation = prepareRecorderInvalidation(store, sourceRefs);
  const exportArchiveTargets = invalidation.exportArchiveTargets;
  preflightExportArchiveTargetsSync(exportArchiveTargets);

  const deletedAt = toIso(now);
  unlinkExportArchiveTargetsSync(exportArchiveTargets);
  store.withTransaction(() => {
    for (const event of targets) {
      store.updateRecord("clipboard_events", event.id, {
        content_size: null,
        content_hash: null,
        content_text: null,
        redacted_text: null,
        redaction_status: DELETED_REDACTION_STATUS,
        privacy_state: DELETED_PRIVACY_STATE,
        suppression_reason: null,
        raw_retention_expires_at: null,
        content_captured: 0,
        safe_for_search: 0,
        safe_for_memory: 0,
        safe_for_export: 0,
        deleted_at: deletedAt,
      });
    }
    invalidateDerivedRowsForSources(store, invalidation.sourceRefs, { deletedAt, exportArchiveTargets });
  });

  return {
    status: "deleted",
    clipboardEventCount: targets.length,
    clipboard_event_count: targets.length,
    contentPurgedCount: targets.filter((event) => event.content_captured === 1 || event.content_text).length,
    content_purged_count: targets.filter((event) => event.content_captured === 1 || event.content_text).length,
    clipboardEventIds: targets.map((event) => event.id),
    clipboard_event_ids: targets.map((event) => event.id),
    invalidatedExportArchiveCount: exportArchiveTargets.length,
    invalidated_export_archive_count: exportArchiveTargets.length,
    deletedAt,
    deleted_at: deletedAt,
  };
}

export function deleteRecorderMemoryItemsInRange(store, {
  startedAt,
  endedAt,
  workspaceId = null,
  projectId = null,
  now = new Date(),
  limit = 5000,
} = {}) {
  if (!store) {
    fail("ERR_RECORDER_DELETE_STORE_REQUIRED", "deleteRecorderMemoryItemsInRange requires store");
  }
  const range = normalizeRange({ startedAt, endedAt });
  const targets = scopedRowsInRange(store, "memory_items", {
    timeColumn: "created_at",
    range,
    workspaceId,
    projectId,
    limit,
  });
  const sourceRefs = targets.map((item) => ({
    id: item.id,
    source_type: "memory",
  }));
  const invalidation = prepareRecorderInvalidation(store, sourceRefs);
  const exportArchiveTargets = invalidation.exportArchiveTargets;
  preflightExportArchiveTargetsSync(exportArchiveTargets);

  const deletedAt = toIso(now);
  unlinkExportArchiveTargetsSync(exportArchiveTargets);
  store.withTransaction(() => {
    for (const item of targets) {
      store.updateRecord("memory_items", item.id, {
        title: "",
        summary: "",
        source_ids_json: EMPTY_SOURCE_IDS_JSON,
        redaction_status: DELETED_REDACTION_STATUS,
        privacy_state: DELETED_PRIVACY_STATE,
        safe_for_search: 0,
        safe_for_memory: 0,
        safe_for_export: 0,
        deleted_at: deletedAt,
      });
    }
    invalidateDerivedRowsForSources(store, invalidation.sourceRefs, { deletedAt, exportArchiveTargets });
  });
  return {
    status: "deleted",
    memoryItemCount: targets.length,
    memory_item_count: targets.length,
    memoryItemIds: targets.map((item) => item.id),
    memory_item_ids: targets.map((item) => item.id),
    invalidatedExportArchiveCount: exportArchiveTargets.length,
    invalidated_export_archive_count: exportArchiveTargets.length,
    deletedAt,
    deleted_at: deletedAt,
  };
}

export function deleteRecorderProductEventsInRange(store, {
  startedAt,
  endedAt,
  workspaceId = null,
  projectId = null,
  now = new Date(),
  limit = 5000,
} = {}) {
  if (!store) {
    fail("ERR_RECORDER_DELETE_STORE_REQUIRED", "deleteRecorderProductEventsInRange requires store");
  }
  const range = normalizeRange({ startedAt, endedAt });
  const targets = scopedRowsInRange(store, "product_events", {
    timeColumn: "occurred_at",
    range,
    workspaceId,
    projectId,
    limit,
  });
  const sourceRefs = targets.map((event) => ({
    id: event.id,
    source_type: "product_event",
  }));
  const invalidation = prepareRecorderInvalidation(store, sourceRefs);
  const exportArchiveTargets = invalidation.exportArchiveTargets;
  preflightExportArchiveTargetsSync(exportArchiveTargets);

  const deletedAt = toIso(now);
  unlinkExportArchiveTargetsSync(exportArchiveTargets);
  store.withTransaction(() => {
    for (const event of targets) {
      store.updateRecord("product_events", event.id, {
        title: "",
        summary: "",
        source_ids_json: EMPTY_SOURCE_IDS_JSON,
        safe_for_search: 0,
        safe_for_memory: 0,
        safe_for_export: 0,
        deleted_at: deletedAt,
      });
    }
    invalidateDerivedRowsForSources(store, invalidation.sourceRefs, { deletedAt, exportArchiveTargets });
  });
  return {
    status: "deleted",
    productEventCount: targets.length,
    product_event_count: targets.length,
    productEventIds: targets.map((event) => event.id),
    product_event_ids: targets.map((event) => event.id),
    invalidatedExportArchiveCount: exportArchiveTargets.length,
    invalidated_export_archive_count: exportArchiveTargets.length,
    deletedAt,
    deleted_at: deletedAt,
  };
}

export function deleteRecorderEvidenceCandidatesInRange(store, {
  startedAt,
  endedAt,
  workspaceId = null,
  projectId = null,
  now = new Date(),
  limit = 5000,
  timeColumn = "created_at",
  candidateStatuses = null,
  reasonCode = "ERR_RECORDER_EVIDENCE_CANDIDATE_DELETED",
  reason = "evidence candidate deleted by recorder retention or user delete",
} = {}) {
  if (!store) {
    fail("ERR_RECORDER_DELETE_STORE_REQUIRED", "deleteRecorderEvidenceCandidatesInRange requires store");
  }
  const cleanTimeColumn = requiredText(timeColumn, "timeColumn");
  if (!["created_at", "reviewed_at"].includes(cleanTimeColumn)) {
    fail("ERR_RECORDER_DELETE_INVALID_TIME_COLUMN", "evidence candidate delete timeColumn must be created_at or reviewed_at", {
      timeColumn: cleanTimeColumn,
    });
  }
  const statusFilter = candidateStatuses
    ? new Set([candidateStatuses].flat().map((status) => String(status ?? "").trim()).filter(Boolean))
    : null;
  const range = normalizeRange({ startedAt, endedAt });
  const targets = scopedRowsInRange(store, "evidence_candidates", {
    timeColumn: cleanTimeColumn,
    range,
    workspaceId,
    projectId,
    limit,
  }).filter((candidate) => !statusFilter || statusFilter.has(candidate.candidate_status));
  const sourceRefs = targets.map((candidate) => ({
    id: candidate.id,
    source_type: "evidence_candidate",
  }));
  const invalidation = prepareRecorderInvalidation(store, sourceRefs);
  const exportArchiveTargets = invalidation.exportArchiveTargets;
  preflightExportArchiveTargetsSync(exportArchiveTargets);
  const deletedAt = toIso(now);
  let rejectedCandidateCount = 0;
  unlinkExportArchiveTargetsSync(exportArchiveTargets);
  store.withTransaction(() => {
    for (const candidate of targets) {
      const shouldReject = UNRESOLVED_EVIDENCE_CANDIDATE_STATUSES.has(candidate.candidate_status);
      const patch = deletedEvidenceCandidatePatch(candidate, {
        deletedAt,
        reasonCode,
        reason,
        status: shouldReject ? "rejected" : "deleted",
      });
      if (shouldReject) {
        rejectedCandidateCount += 1;
        patch.candidate_status = "rejected";
        patch.reviewed_at = deletedAt;
      }
      store.updateRecord("evidence_candidates", candidate.id, patch);
    }
    invalidateDerivedRowsForSources(store, invalidation.sourceRefs, { deletedAt, exportArchiveTargets });
  });
  return {
    status: "deleted",
    evidenceCandidateCount: targets.length,
    evidence_candidate_count: targets.length,
    rejectedCandidateCount,
    rejected_candidate_count: rejectedCandidateCount,
    invalidatedExportArchiveCount: exportArchiveTargets.length,
    invalidated_export_archive_count: exportArchiveTargets.length,
    evidenceCandidateIds: targets.map((candidate) => candidate.id),
    evidence_candidate_ids: targets.map((candidate) => candidate.id),
    deletedAt,
    deleted_at: deletedAt,
  };
}

export function deleteRecorderPipeRunsInRange(store, {
  startedAt,
  endedAt,
  workspaceId = null,
  projectId = null,
  now = new Date(),
  limit = 5000,
} = {}) {
  if (!store) {
    fail("ERR_RECORDER_DELETE_STORE_REQUIRED", "deleteRecorderPipeRunsInRange requires store");
  }
  const range = normalizeRange({ startedAt, endedAt });
  const targets = scopedRowsInRange(store, "pipe_runs", {
    timeColumn: "ended_at",
    range,
    workspaceId,
    projectId,
    limit,
  }).filter((run) => TERMINAL_PIPE_RUN_STATUSES.has(run.status) && textOrNull(run.output_manifest_json));
  const sourceRefs = targets.flatMap((run) => sourceRefsForPipeRun(run));
  const invalidation = prepareRecorderInvalidation(store, sourceRefs);
  const exportArchiveTargets = invalidation.exportArchiveTargets;
  preflightExportArchiveTargetsSync(exportArchiveTargets);
  const deletedAt = toIso(now);
  unlinkExportArchiveTargetsSync(exportArchiveTargets);
  store.withTransaction(() => {
    for (const run of targets) {
      store.updateRecord("pipe_runs", run.id, {
        output_manifest_json: null,
        deleted_at: deletedAt,
      });
    }
    invalidateDerivedRowsForSources(store, invalidation.sourceRefs, { deletedAt, exportArchiveTargets });
  });
  return {
    status: "deleted",
    pipeRunCount: targets.length,
    pipe_run_count: targets.length,
    outputPurgedCount: targets.length,
    output_purged_count: targets.length,
    pipeRunIds: targets.map((run) => run.id),
    pipe_run_ids: targets.map((run) => run.id),
    invalidatedExportArchiveCount: exportArchiveTargets.length,
    invalidated_export_archive_count: exportArchiveTargets.length,
    deletedAt,
    deleted_at: deletedAt,
  };
}

export function deleteRecorderAuditRowsInRange(store, {
  startedAt,
  endedAt,
  workspaceId = null,
  projectId = null,
  now = new Date(),
  limit = 5000,
} = {}) {
  if (!store) {
    fail("ERR_RECORDER_DELETE_STORE_REQUIRED", "deleteRecorderAuditRowsInRange requires store");
  }
  const range = normalizeRange({ startedAt, endedAt });
  const targets = scopedRowsInRange(store, "recorder_audit", {
    timeColumn: "created_at",
    range,
    workspaceId,
    projectId,
    limit,
  });
  const deletedAt = toIso(now);
  store.withTransaction(() => {
    for (const audit of targets) {
      store.updateRecord("recorder_audit", audit.id, {
        deleted_at: deletedAt,
      });
    }
  });
  return {
    status: "deleted",
    auditRowCount: targets.length,
    audit_row_count: targets.length,
    auditRowIds: targets.map((audit) => audit.id),
    audit_row_ids: targets.map((audit) => audit.id),
    tombstoneOnly: true,
    tombstone_only: true,
    deletedAt,
    deleted_at: deletedAt,
  };
}

export async function deleteRecorderExportArchivesInRange(store, {
  startedAt,
  endedAt,
  workspaceId = null,
  projectId = null,
  now = new Date(),
  limit = 5000,
} = {}) {
  if (!store) {
    fail("ERR_RECORDER_DELETE_STORE_REQUIRED", "deleteRecorderExportArchivesInRange requires store");
  }
  const range = normalizeRange({ startedAt, endedAt });
  const targets = scopedRowsInRange(store, "media_assets", {
    timeColumn: "created_at",
    range,
    workspaceId,
    projectId,
    limit,
  })
    .filter((asset) => asset.asset_type === "export_bundle")
    .map((mediaAsset) => ({
      mediaAsset,
      mediaPath: resolveRecorderExportArchiveMediaPath(store, mediaAsset),
    }));

  // A MISSING file (ENOENT) is treated as already-satisfied: skip the unlink
  // but still tombstone the media row. Genuinely-unexpected states (not-a-file,
  // EACCES/EBUSY, any other stat error) fail-before-mutation.
  const mediaPresence = [];
  for (const target of targets) {
    mediaPresence.push(await preflightMediaFilePresence(target.mediaPath, target.mediaAsset.id, "export"));
  }

  const deletedAt = toIso(now);
  let mediaRemovedCount = 0;
  let mediaAlreadyMissingCount = 0;
  for (let index = 0; index < targets.length; index += 1) {
    const removed = mediaPresence[index]
      ? await unlinkPhysicalFile(targets[index].mediaPath, targets[index].mediaAsset.id, "export")
      : false;
    if (removed) {
      mediaRemovedCount += 1;
    } else {
      mediaAlreadyMissingCount += 1;
    }
  }
  store.withTransaction(() => {
    for (const target of targets) {
      store.updateRecord("media_assets", target.mediaAsset.id, deletedMediaAssetPatch(target.mediaAsset, { deletedAt }));
    }
  });

  return {
    status: "deleted",
    exportArchiveCount: targets.length,
    export_archive_count: targets.length,
    mediaRemovedCount,
    media_removed_count: mediaRemovedCount,
    mediaAlreadyMissingCount,
    media_already_missing_count: mediaAlreadyMissingCount,
    exportArchiveIds: targets.map((target) => target.mediaAsset.id),
    export_archive_ids: targets.map((target) => target.mediaAsset.id),
    deletedAt,
    deleted_at: deletedAt,
  };
}

export function resolveRecorderFrameMediaPath(store, mediaAsset = {}) {
  if (!store?.dbPath) {
    fail("ERR_RECORDER_DELETE_STORE_PATH_REQUIRED", "store.dbPath is required to resolve recorder media");
  }
  const relativePath = normalizeFrameMediaRelativePath(mediaAsset.relative_path);
  const recorderRoot = path.dirname(path.resolve(store.dbPath));
  const mediaPath = path.resolve(recorderRoot, ...relativePath.split("/"));
  const relativeToRoot = path.relative(recorderRoot, mediaPath);
  if (relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot)) {
    fail("ERR_RECORDER_DELETE_MEDIA_PATH_ESCAPE", "frame media path escapes recorder root", {
      relativePath,
      recorderRoot,
      mediaPath,
    });
  }
  return mediaPath;
}

function scopedRowsInRange(store, table, {
  timeColumn,
  range,
  workspaceId = null,
  projectId = null,
  limit = 5000,
}) {
  const max = Math.max(1, Math.min(50000, Number.parseInt(String(limit), 10) || 5000));
  const scopedWorkspaceId = textOrNull(workspaceId);
  const scopedProjectId = textOrNull(projectId);
  return store.listRecords(table, { limit: max, orderBy: timeColumn })
    .filter((row) => {
      if (row.deleted_at) return false;
      if (scopedWorkspaceId && row.workspace_id !== scopedWorkspaceId) return false;
      if (scopedProjectId && row.project_id !== scopedProjectId) return false;
      const timestamp = Date.parse(row[timeColumn]);
      return Number.isFinite(timestamp) && timestamp >= range.startedAtMs && timestamp < range.endedAtMs;
    });
}

export function resolveRecorderAudioMediaPath(store, mediaAsset = {}) {
  if (!store?.dbPath) {
    fail("ERR_RECORDER_DELETE_STORE_PATH_REQUIRED", "store.dbPath is required to resolve recorder media");
  }
  const relativePath = normalizeAudioMediaRelativePath(mediaAsset.relative_path);
  const recorderRoot = path.dirname(path.resolve(store.dbPath));
  const mediaPath = path.resolve(recorderRoot, ...relativePath.split("/"));
  const relativeToRoot = path.relative(recorderRoot, mediaPath);
  if (relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot)) {
    fail("ERR_RECORDER_DELETE_MEDIA_PATH_ESCAPE", "audio media path escapes recorder root", {
      relativePath,
      recorderRoot,
      mediaPath,
    });
  }
  return mediaPath;
}

export function resolveRecorderExportArchiveMediaPath(store, mediaAsset = {}) {
  if (!store?.dbPath) {
    fail("ERR_RECORDER_DELETE_STORE_PATH_REQUIRED", "store.dbPath is required to resolve recorder export archive");
  }
  const relativePath = normalizeExportArchiveRelativePath(mediaAsset.relative_path);
  const recorderRoot = path.dirname(path.resolve(store.dbPath));
  const mediaPath = path.resolve(recorderRoot, ...relativePath.split("/"));
  const relativeToRoot = path.relative(recorderRoot, mediaPath);
  if (relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot)) {
    fail("ERR_RECORDER_DELETE_MEDIA_PATH_ESCAPE", "export archive path escapes recorder root", {
      relativePath,
      recorderRoot,
      mediaPath,
    });
  }
  return mediaPath;
}

function normalizeRange({ startedAt, endedAt }) {
  const start = parseRequiredDate(startedAt, "startedAt");
  const end = parseRequiredDate(endedAt, "endedAt");
  if (end.getTime() <= start.getTime()) {
    fail("ERR_RECORDER_DELETE_INVALID_RANGE", "endedAt must be after startedAt", {
      startedAt,
      endedAt,
    });
  }
  return {
    startedAt: start.toISOString(),
    endedAt: end.toISOString(),
    startedAtMs: start.getTime(),
    endedAtMs: end.getTime(),
  };
}

function parseRequiredDate(value, fieldName) {
  const date = value instanceof Date ? value : new Date(value ?? "");
  if (Number.isNaN(date.getTime())) {
    fail("ERR_RECORDER_DELETE_INVALID_TIMESTAMP", `delete requires valid ${fieldName}`, {
      fieldName,
      value,
    });
  }
  return date;
}

function normalizeFrameMediaRelativePath(value) {
  const raw = requiredText(value, "media.relative_path").replace(/\\/g, "/");
  if (path.posix.isAbsolute(raw) || /^[A-Za-z]:\//.test(raw)) {
    fail("ERR_RECORDER_DELETE_ABSOLUTE_MEDIA_PATH", "media relative_path must not be absolute", { relativePath: raw });
  }
  const normalized = path.posix.normalize(raw);
  if (normalized === "." || normalized.startsWith("../") || normalized.includes("/../")) {
    fail("ERR_RECORDER_DELETE_UNSAFE_MEDIA_PATH", "media relative_path must stay under recorder root", {
      relativePath: raw,
    });
  }
  if (!normalized.startsWith("media/frames/")) {
    fail("ERR_RECORDER_DELETE_UNEXPECTED_MEDIA_PREFIX", "frame media must live under media/frames/", {
      relativePath: raw,
    });
  }
  return normalized;
}

function normalizeAudioMediaRelativePath(value) {
  const raw = requiredText(value, "media.relative_path").replace(/\\/g, "/");
  if (path.posix.isAbsolute(raw) || /^[A-Za-z]:\//.test(raw)) {
    fail("ERR_RECORDER_DELETE_ABSOLUTE_MEDIA_PATH", "media relative_path must not be absolute", { relativePath: raw });
  }
  const normalized = path.posix.normalize(raw);
  if (normalized === "." || normalized.startsWith("../") || normalized.includes("/../")) {
    fail("ERR_RECORDER_DELETE_UNSAFE_MEDIA_PATH", "media relative_path must stay under recorder root", {
      relativePath: raw,
    });
  }
  if (!normalized.startsWith("media/audio/")) {
    fail("ERR_RECORDER_DELETE_UNEXPECTED_MEDIA_PREFIX", "audio media must live under media/audio/", {
      relativePath: raw,
    });
  }
  return normalized;
}

function normalizeExportArchiveRelativePath(value) {
  const raw = requiredText(value, "media.relative_path").replace(/\\/g, "/");
  if (path.posix.isAbsolute(raw) || /^[A-Za-z]:\//.test(raw)) {
    fail("ERR_RECORDER_DELETE_ABSOLUTE_MEDIA_PATH", "media relative_path must not be absolute", { relativePath: raw });
  }
  const normalized = path.posix.normalize(raw);
  if (normalized.startsWith("../") || normalized === "..") {
    fail("ERR_RECORDER_DELETE_UNSAFE_MEDIA_PATH", "media relative_path must stay under recorder root", {
      relativePath: raw,
      normalized,
    });
  }
  if (!normalized.startsWith("exports/") || !normalized.endsWith(".json")) {
    fail("ERR_RECORDER_DELETE_UNEXPECTED_MEDIA_PREFIX", "export archive media must live under exports/ as JSON", {
      relativePath: raw,
      normalized,
    });
  }
  return normalized;
}

async function assertPhysicalFile(mediaPath, mediaAssetId, mediaKind = "frame") {
  let stat;
  try {
    stat = await fs.stat(mediaPath);
  } catch (error) {
    if (error?.code === "ENOENT") {
      fail("ERR_RECORDER_DELETE_MEDIA_MISSING", `${mediaKind} media file is missing: ${mediaAssetId}`, {
        mediaAssetId,
        mediaPath,
      });
    }
    fail("ERR_RECORDER_DELETE_MEDIA_STAT_FAILED", `failed to inspect ${mediaKind} media: ${mediaAssetId}`, {
      mediaAssetId,
      mediaPath,
      cause: error?.message || String(error),
    });
  }
  if (!stat.isFile()) {
    fail("ERR_RECORDER_DELETE_MEDIA_NOT_FILE", `${mediaKind} media path is not a file: ${mediaAssetId}`, {
      mediaAssetId,
      mediaPath,
    });
  }
}

// Preflight a row's media file for raw frame/audio purge. A MISSING file
// (ENOENT) is treated as already-satisfied — the caller skips the unlink but
// still soft-deletes + tombstones the row so one orphan cannot poison the
// whole sweep. Genuinely-unexpected states (not-a-file, EACCES/EPERM/EBUSY,
// any other stat error) fail-before-mutation with a named root cause.
async function preflightMediaFilePresence(mediaPath, mediaAssetId, mediaKind = "frame") {
  let stat;
  try {
    stat = await fs.stat(mediaPath);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return false;
    }
    fail("ERR_RECORDER_DELETE_MEDIA_STAT_FAILED", `failed to inspect ${mediaKind} media: ${mediaAssetId}`, {
      mediaAssetId,
      mediaPath,
      cause: error?.message || String(error),
    });
  }
  if (!stat.isFile()) {
    fail("ERR_RECORDER_DELETE_MEDIA_NOT_FILE", `${mediaKind} media path is not a file: ${mediaAssetId}`, {
      mediaAssetId,
      mediaPath,
    });
  }
  return true;
}

async function unlinkPhysicalFile(mediaPath, mediaAssetId, mediaKind = "frame") {
  try {
    await fs.unlink(mediaPath);
  } catch (error) {
    if (error?.code === "ENOENT") {
      // Raced with another remover between preflight and unlink — the file is
      // already gone, which is exactly the post-condition we wanted.
      return false;
    }
    fail("ERR_RECORDER_DELETE_MEDIA_UNLINK_FAILED", `failed to remove ${mediaKind} media: ${mediaAssetId}`, {
      mediaAssetId,
      mediaPath,
      cause: error?.message || String(error),
    });
  }
  return true;
}

function deletedEvidenceCandidatePatch(candidate, {
  deletedAt,
  reasonCode,
  reason,
  status = "deleted",
} = {}) {
  const result = {
    status,
    reasonCode,
    reason_code: reasonCode,
    reason,
    deletedAt,
    deleted_at: deletedAt,
  };
  if (status === "rejected") {
    result.reviewedAt = deletedAt;
    result.reviewed_at = deletedAt;
  }
  return {
    claim: "",
    source_state: DELETED_PRIVACY_STATE,
    proof_kind: DELETED_PRIVACY_STATE,
    source_ids_json: EMPTY_SOURCE_IDS_JSON,
    proof_ledger_mapping_json: "{}",
    evidence_debt_json: "[]",
    immutable_fingerprint: `deleted:${candidate.id}`,
    idempotency_key: `deleted:${candidate.id}`,
    verifier_result_json: JSON.stringify(result),
    deleted_at: deletedAt,
  };
}

function deletedMediaAssetPatch(mediaAsset = {}, { deletedAt } = {}) {
  return {
    relative_path: deletedMediaAssetRelativePath(mediaAsset),
    sha256: DELETED_MEDIA_SHA256,
    byte_size: 0,
    encrypted: 0,
    encryption_key_id: null,
    encryption_alg: null,
    encryption_nonce: null,
    encryption_tag: null,
    source_ids_json: EMPTY_SOURCE_IDS_JSON,
    deleted_at: deletedAt,
  };
}

function deletedMediaAssetRelativePath(mediaAsset = {}) {
  const id = requiredText(mediaAsset.id, "mediaAsset.id").replace(/[^A-Za-z0-9._-]/g, "_");
  if (mediaAsset.asset_type === "frame_jpeg") {
    return `media/frames/deleted/${id}.deleted`;
  }
  if (mediaAsset.asset_type === "audio_m4a") {
    return `media/audio/deleted/${id}.deleted`;
  }
  if (mediaAsset.asset_type === "export_bundle") {
    return `exports/deleted-${id}.json`;
  }
  fail("ERR_RECORDER_DELETE_UNEXPECTED_MEDIA_TYPE", `deleted media tombstone does not support asset type ${mediaAsset.asset_type}`, {
    mediaAssetId: mediaAsset.id,
    assetType: mediaAsset.asset_type,
  });
}

function invalidateDerivedRowsForSources(store, sourceRefs = [], {
  deletedAt,
  includeMemoryItems = true,
  includeProductEvents = true,
  includeEvidenceCandidates = true,
  exportArchiveTargets = [],
} = {}) {
  const refs = normalizeSourceRefs(sourceRefs);
  if (!refs.length) return {
    memoryItemCount: 0,
    productEventCount: 0,
    evidenceCandidateCount: 0,
    exportArchiveCount: 0,
  };
  let memoryItemCount = 0;
  let productEventCount = 0;
  let evidenceCandidateCount = 0;
  let exportArchiveCount = 0;
  if (includeMemoryItems) {
    for (const item of store.listRecords("memory_items", { limit: 50000, orderBy: "created_at" })) {
      if (item.deleted_at) continue;
      const impact = sourceReferenceImpact(item, refs);
      if (!impact.matched) continue;
      if (impact.allRemoved) {
        store.updateRecord("memory_items", item.id, {
          title: "",
          summary: "",
          source_ids_json: EMPTY_SOURCE_IDS_JSON,
          redaction_status: DELETED_REDACTION_STATUS,
          privacy_state: DELETED_PRIVACY_STATE,
          safe_for_search: 0,
          safe_for_memory: 0,
          safe_for_export: 0,
          deleted_at: deletedAt,
        });
      } else {
        store.updateRecord("memory_items", item.id, {
          source_ids_json: JSON.stringify(impact.remaining),
          safe_for_search: 0,
          safe_for_memory: 0,
          safe_for_export: 0,
        });
      }
      memoryItemCount += 1;
    }
  }
  if (includeProductEvents) {
    for (const event of store.listRecords("product_events", { limit: 50000, orderBy: "occurred_at" })) {
      if (event.deleted_at) continue;
      const impact = sourceReferenceImpact(event, refs);
      if (!impact.matched) continue;
      if (impact.allRemoved) {
        store.updateRecord("product_events", event.id, {
          title: "",
          summary: "",
          source_ids_json: EMPTY_SOURCE_IDS_JSON,
          safe_for_search: 0,
          safe_for_memory: 0,
          safe_for_export: 0,
          deleted_at: deletedAt,
        });
      } else {
        store.updateRecord("product_events", event.id, {
          source_ids_json: JSON.stringify(impact.remaining),
          safe_for_search: 0,
          safe_for_memory: 0,
          safe_for_export: 0,
        });
      }
      productEventCount += 1;
    }
  }
  if (includeEvidenceCandidates) {
    for (const candidate of store.listRecords("evidence_candidates", { limit: 50000, orderBy: "created_at" })) {
      if (candidate.deleted_at) continue;
      const impact = sourceReferenceImpact(candidate, refs);
      if (!impact.matched) continue;
      const shouldReject = UNRESOLVED_EVIDENCE_CANDIDATE_STATUSES.has(candidate.candidate_status);
      const patch = impact.allRemoved
        ? deletedEvidenceCandidatePatch(candidate, {
          deletedAt,
          reasonCode: "ERR_RECORDER_DERIVED_SOURCE_DELETED",
          reason: "evidence candidate source was deleted",
          status: shouldReject ? "rejected" : "deleted",
        })
        : {
          source_state: "degraded",
          source_ids_json: JSON.stringify(impact.remaining),
        };
      if (impact.allRemoved && shouldReject) {
        patch.candidate_status = "rejected";
        patch.reviewed_at = deletedAt;
      } else if (!impact.allRemoved && shouldReject) {
        patch.candidate_status = "degraded";
      }
      store.updateRecord("evidence_candidates", candidate.id, patch);
      evidenceCandidateCount += 1;
    }
  }
  for (const target of exportArchiveTargets) {
    if (!target?.mediaAsset?.id) continue;
    store.updateRecord("media_assets", target.mediaAsset.id, deletedMediaAssetPatch(target.mediaAsset, { deletedAt }));
    exportArchiveCount += 1;
  }
  return { memoryItemCount, productEventCount, evidenceCandidateCount, exportArchiveCount };
}

export function resolveExportArchiveInvalidationTargets(store, sourceRefs = []) {
  const refs = normalizeSourceRefs(sourceRefs);
  if (!refs.length) return [];
  const seen = new Set();
  return store.listRecords("media_assets", { limit: 50000, orderBy: "created_at" })
    .filter((asset) => asset.asset_type === "export_bundle" && !asset.deleted_at && rowReferencesAnySource(asset, refs))
    .flatMap((mediaAsset) => {
      if (seen.has(mediaAsset.id)) return [];
      seen.add(mediaAsset.id);
      return [{
        mediaAsset,
        mediaPath: resolveRecorderExportArchiveMediaPath(store, mediaAsset),
      }];
    });
}

export function resolveExportArchiveInvalidationClosureTargets(store, sourceRefs = []) {
  return resolveExportArchiveInvalidationTargets(
    store,
    collectRecorderInvalidationSourceRefs(store, sourceRefs),
  );
}

function prepareRecorderInvalidation(store, sourceRefs = []) {
  const closureRefs = collectRecorderInvalidationSourceRefs(store, sourceRefs);
  return {
    sourceRefs: closureRefs,
    exportArchiveTargets: resolveExportArchiveInvalidationTargets(store, closureRefs),
  };
}

export function collectRecorderInvalidationSourceRefs(store, sourceRefs = []) {
  const refs = [];
  const seen = new Set();
  const addRef = (id, sourceType = null) => {
    const cleanId = textOrNull(id);
    if (!cleanId) return false;
    const cleanType = textOrNull(sourceType);
    const key = `${cleanType || ""}:${cleanId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    refs.push(cleanType ? { id: cleanId, source_type: cleanType } : { id: cleanId });
    return true;
  };
  for (const ref of normalizeSourceRefs(sourceRefs)) {
    addRef(ref.id, ref.source_type);
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const item of store.listRecords("memory_items", { limit: 50000 })) {
      if (!item.deleted_at && rowReferencesAnySource(item, refs)) {
        changed = addRef(item.id, "memory") || changed;
      }
    }
    for (const event of store.listRecords("product_events", { limit: 50000 })) {
      if (!event.deleted_at && rowReferencesAnySource(event, refs)) {
        changed = addRef(event.id, "product_event") || changed;
      }
    }
    for (const candidate of store.listRecords("evidence_candidates", { limit: 50000 })) {
      if (!candidate.deleted_at && rowReferencesAnySource(candidate, refs)) {
        changed = addRef(candidate.id, "evidence_candidate") || changed;
      }
    }
    for (const run of store.listRecords("pipe_runs", { limit: 50000 })) {
      if (run.deleted_at || !textOrNull(run.output_manifest_json)) continue;
      const runRefs = sourceRefsForPipeRun(run);
      if (runRefs.some((ref) => sourceRefsMatchAny(ref, refs))) {
        changed = addRef(run.id, "pipe_run") || changed;
      }
    }
  }
  return refs;
}

// Preflight export-archive targets before deletion. A MISSING file (ENOENT)
// is treated as already-satisfied: target.alreadyMissing is set to true so
// the caller skips the unlink, while invalidateDerivedRowsForSources still
// tombstones the row. Genuinely-unexpected states (not-a-file,
// EACCES/EBUSY, any other stat error) fail-before-mutation so no partial
// mutation occurs.
export function preflightExportArchiveTargetsSync(targets = []) {
  for (const target of targets) {
    try {
      const stat = fsSync.statSync(target.mediaPath);
      if (!stat.isFile()) {
        fail("ERR_RECORDER_DELETE_MEDIA_NOT_FILE", `export archive is not a file: ${target.mediaAsset.id}`, {
          mediaAssetId: target.mediaAsset.id,
          mediaPath: target.mediaPath,
        });
      }
    } catch (error) {
      if (error instanceof RecorderDeleteError) throw error;
      if (error?.code === "ENOENT") {
        // File already gone — skip the unlink but still tombstone the row so
        // one orphan export bundle cannot deadlock the sweep.
        target.alreadyMissing = true;
        continue;
      }
      fail("ERR_RECORDER_DELETE_MEDIA_STAT_FAILED", `failed to inspect export archive: ${target.mediaAsset.id}`, {
        mediaAssetId: target.mediaAsset.id,
        mediaPath: target.mediaPath,
        cause: error?.message || String(error),
      });
    }
  }
}

function sourceRefsMatchAny(candidateRef, sourceRefs = []) {
  const id = textOrNull(candidateRef?.id);
  const sourceType = textOrNull(candidateRef?.source_type ?? candidateRef?.sourceType);
  if (!id) return false;
  return sourceRefs.some((ref) => {
    if (id !== ref.id) return false;
    return !sourceType || !ref.source_type || sourceType === ref.source_type;
  });
}

function unlinkExportArchiveTargetsSync(targets = []) {
  for (const target of targets) {
    if (target.alreadyMissing) continue;
    try {
      fsSync.unlinkSync(target.mediaPath);
    } catch (error) {
      fail("ERR_RECORDER_DELETE_MEDIA_UNLINK_FAILED", `failed to remove export media: ${target.mediaAsset.id}`, {
        mediaAssetId: target.mediaAsset.id,
        mediaPath: target.mediaPath,
        cause: error?.message || String(error),
      });
    }
  }
}

function normalizeSourceRefs(sourceRefs = []) {
  return sourceRefs
    .map((ref) => {
      if (typeof ref === "string") return { id: ref, source_type: null };
      return {
        id: textOrNull(ref?.id),
        source_type: textOrNull(ref?.source_type ?? ref?.sourceType),
      };
    })
    .filter((ref) => ref.id);
}

function rowReferencesAnySource(row, sourceRefs = []) {
  const values = parseSourceIds(row.source_ids_json);
  return values.some((entry) => {
    const entryId = typeof entry === "string" ? entry : textOrNull(entry?.id);
    const entryType = typeof entry === "string" ? null : textOrNull(entry?.source_type ?? entry?.sourceType);
    if (!entryId) return false;
    return sourceRefs.some((ref) => {
      if (entryId !== ref.id) return false;
      return !ref.source_type || !entryType || entryType === ref.source_type;
    });
  });
}

function sourceReferenceImpact(row, sourceRefs = []) {
  const values = parseSourceIds(row.source_ids_json);
  const remaining = [];
  let removedCount = 0;
  for (const entry of values) {
    const entryId = typeof entry === "string" ? entry : textOrNull(entry?.id);
    const entryType = typeof entry === "string" ? null : textOrNull(entry?.source_type ?? entry?.sourceType);
    if (!entryId) continue;
    const removed = sourceRefs.some((ref) => {
      if (entryId !== ref.id) return false;
      return !ref.source_type || !entryType || entryType === ref.source_type;
    });
    if (removed) {
      removedCount += 1;
    } else {
      remaining.push(entry);
    }
  }
  return {
    matched: removedCount > 0,
    allRemoved: removedCount > 0 && remaining.length === 0,
    remaining,
  };
}

export function sourceRefsForPipeRun(run = {}) {
  const refs = [{ id: run.id, source_type: "pipe_run" }];
  const manifest = parseJsonObject(run.output_manifest_json);
  collectManifestSourceRefs(manifest, refs);
  return normalizeSourceRefs(refs);
}

function collectManifestSourceRefs(value, refs) {
  if (!value) return;
  if (Array.isArray(value)) {
    for (const item of value) collectManifestSourceRefs(item, refs);
    return;
  }
  if (typeof value !== "object") return;
  for (const key of ["sourceIds", "source_ids"]) {
    if (!Array.isArray(value[key])) continue;
    for (const entry of value[key]) {
      if (typeof entry === "string") {
        refs.push({ id: entry, source_type: null });
      } else if (entry && typeof entry === "object") {
        refs.push({
          id: entry.id,
          source_type: entry.source_type ?? entry.sourceType,
        });
      }
    }
  }
  for (const nested of Object.values(value)) {
    if (nested && typeof nested === "object") collectManifestSourceRefs(nested, refs);
  }
}

function parseSourceIds(value) {
  try {
    const parsed = JSON.parse(String(value || "[]"));
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [];
  }
}

function parseJsonObject(value) {
  try {
    const parsed = JSON.parse(String(value || "{}"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function requiredText(value, fieldName) {
  const text = String(value ?? "").trim();
  if (!text) {
    fail("ERR_RECORDER_DELETE_MISSING_FIELD", `delete requires ${fieldName}`, { fieldName });
  }
  return text;
}

function textOrNull(value) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text || null;
}

function toIso(value) {
  const date = value instanceof Date ? value : new Date(value ?? Date.now());
  if (Number.isNaN(date.getTime())) {
    fail("ERR_RECORDER_DELETE_INVALID_TIMESTAMP", "delete timestamp is invalid", { value });
  }
  return date.toISOString();
}

function fail(code, message, details = {}) {
  throw new RecorderDeleteError(code, message, details);
}
