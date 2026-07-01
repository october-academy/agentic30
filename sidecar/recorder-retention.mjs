import fs from "node:fs/promises";

import {
  deleteRecorderAudioChunksInRange,
  deleteRecorderAuditRowsInRange,
  deleteRecorderClipboardEventsInRange,
  deleteRecorderEvidenceCandidatesInRange,
  deleteRecorderExportArchivesInRange,
  deleteRecorderFrameCapturesInRange,
  deleteRecorderMemoryItemsInRange,
  deleteRecorderPipeRunsInRange,
  deleteRecorderProductEventsInRange,
  preflightExportArchiveTargetsSync,
  resolveExportArchiveInvalidationClosureTargets,
  resolveRecorderAudioMediaPath,
  resolveRecorderExportArchiveMediaPath,
  resolveRecorderFrameMediaPath,
  sourceRefsForPipeRun,
} from "./recorder-delete.mjs";

export const RECORDER_RETENTION_SCHEMA_VERSION = 1;

export const DEFAULT_RECORDER_RETENTION_POLICY = Object.freeze({
  rawFrameRetentionHours: 24,
  raw_frame_retention_hours: 24,
  rawAudioRetentionHours: 24,
  raw_audio_retention_hours: 24,
  rawClipboardRetentionHours: 24,
  raw_clipboard_retention_hours: 24,
  memoryRetentionHours: 168,
  memory_retention_hours: 168,
  productEventRetentionHours: 168,
  product_event_retention_hours: 168,
  evidenceCandidateRetentionHours: 720,
  evidence_candidate_retention_hours: 720,
  pipeOutputRetentionHours: 720,
  pipe_output_retention_hours: 720,
  auditRetentionHours: 8760,
  audit_retention_hours: 8760,
  exportArchiveRetentionHours: 87600,
  export_archive_retention_hours: 87600,
});

const RESOLVED_EVIDENCE_CANDIDATE_STATUSES = Object.freeze([
  "rejected",
  "verifier_rejected",
  "written_to_ledger",
]);

const TERMINAL_PIPE_RUN_STATUSES = new Set([
  "succeeded",
  "failed",
  "cancelled",
  "timed_out",
]);

export class RecorderRetentionError extends Error {
  constructor(code, message, details = {}) {
    super(`${code}: ${message}`);
    this.name = "RecorderRetentionError";
    this.code = code;
    this.details = details;
  }
}

export function normalizeRecorderRetentionPolicy(policy = {}) {
  const rawFrameRetentionHours = positiveNumber(
    policy.rawFrameRetentionHours ?? policy.raw_frame_retention_hours ?? DEFAULT_RECORDER_RETENTION_POLICY.rawFrameRetentionHours,
    "rawFrameRetentionHours",
  );
  const rawAudioRetentionHours = positiveNumber(
    policy.rawAudioRetentionHours ?? policy.raw_audio_retention_hours ?? DEFAULT_RECORDER_RETENTION_POLICY.rawAudioRetentionHours,
    "rawAudioRetentionHours",
  );
  const rawClipboardRetentionHours = positiveNumber(
    policy.rawClipboardRetentionHours ?? policy.raw_clipboard_retention_hours ?? DEFAULT_RECORDER_RETENTION_POLICY.rawClipboardRetentionHours,
    "rawClipboardRetentionHours",
  );
  const memoryRetentionHours = positiveNumber(
    policy.memoryRetentionHours ?? policy.memory_retention_hours ?? DEFAULT_RECORDER_RETENTION_POLICY.memoryRetentionHours,
    "memoryRetentionHours",
  );
  const productEventRetentionHours = positiveNumber(
    policy.productEventRetentionHours ?? policy.product_event_retention_hours ?? DEFAULT_RECORDER_RETENTION_POLICY.productEventRetentionHours,
    "productEventRetentionHours",
  );
  const evidenceCandidateRetentionHours = positiveNumber(
    policy.evidenceCandidateRetentionHours
      ?? policy.evidence_candidate_retention_hours
      ?? DEFAULT_RECORDER_RETENTION_POLICY.evidenceCandidateRetentionHours,
    "evidenceCandidateRetentionHours",
  );
  const pipeOutputRetentionHours = positiveNumber(
    policy.pipeOutputRetentionHours ?? policy.pipe_output_retention_hours ?? DEFAULT_RECORDER_RETENTION_POLICY.pipeOutputRetentionHours,
    "pipeOutputRetentionHours",
  );
  const auditRetentionHours = positiveNumber(
    policy.auditRetentionHours ?? policy.audit_retention_hours ?? DEFAULT_RECORDER_RETENTION_POLICY.auditRetentionHours,
    "auditRetentionHours",
  );
  const exportArchiveRetentionHours = positiveNumber(
    policy.exportArchiveRetentionHours
      ?? policy.export_archive_retention_hours
      ?? DEFAULT_RECORDER_RETENTION_POLICY.exportArchiveRetentionHours,
    "exportArchiveRetentionHours",
  );
  return {
    schemaVersion: RECORDER_RETENTION_SCHEMA_VERSION,
    schema_version: RECORDER_RETENTION_SCHEMA_VERSION,
    schema: "agentic30.recorder.retention_policy.v1",
    rawFrameRetentionHours,
    raw_frame_retention_hours: rawFrameRetentionHours,
    rawAudioRetentionHours,
    raw_audio_retention_hours: rawAudioRetentionHours,
    rawClipboardRetentionHours,
    raw_clipboard_retention_hours: rawClipboardRetentionHours,
    memoryRetentionHours,
    memory_retention_hours: memoryRetentionHours,
    productEventRetentionHours,
    product_event_retention_hours: productEventRetentionHours,
    evidenceCandidateRetentionHours,
    evidence_candidate_retention_hours: evidenceCandidateRetentionHours,
    pipeOutputRetentionHours,
    pipe_output_retention_hours: pipeOutputRetentionHours,
    auditRetentionHours,
    audit_retention_hours: auditRetentionHours,
    exportArchiveRetentionHours,
    export_archive_retention_hours: exportArchiveRetentionHours,
  };
}

export function buildRecorderRetentionPlan(store, {
  policy = DEFAULT_RECORDER_RETENTION_POLICY,
  workspaceId = null,
  projectId = null,
  now = new Date(),
  limit = 5000,
} = {}) {
  if (!store) {
    fail("ERR_RECORDER_RETENTION_STORE_REQUIRED", "buildRecorderRetentionPlan requires store");
  }
  const normalizedPolicy = normalizeRecorderRetentionPolicy(policy);
  const evaluatedAt = toIso(now);
  const frameCutoff = new Date(new Date(evaluatedAt).getTime() - normalizedPolicy.rawFrameRetentionHours * 60 * 60 * 1000);
  const frameCutoffIso = frameCutoff.toISOString();
  const audioCutoff = new Date(new Date(evaluatedAt).getTime() - normalizedPolicy.rawAudioRetentionHours * 60 * 60 * 1000);
  const audioCutoffIso = audioCutoff.toISOString();
  const clipboardCutoff = new Date(new Date(evaluatedAt).getTime() - normalizedPolicy.rawClipboardRetentionHours * 60 * 60 * 1000);
  const clipboardCutoffIso = clipboardCutoff.toISOString();
  const memoryCutoff = new Date(new Date(evaluatedAt).getTime() - normalizedPolicy.memoryRetentionHours * 60 * 60 * 1000);
  const memoryCutoffIso = memoryCutoff.toISOString();
  const productEventCutoff = new Date(new Date(evaluatedAt).getTime() - normalizedPolicy.productEventRetentionHours * 60 * 60 * 1000);
  const productEventCutoffIso = productEventCutoff.toISOString();
  const evidenceCandidateCutoff = new Date(new Date(evaluatedAt).getTime() - normalizedPolicy.evidenceCandidateRetentionHours * 60 * 60 * 1000);
  const evidenceCandidateCutoffIso = evidenceCandidateCutoff.toISOString();
  const pipeOutputCutoff = new Date(new Date(evaluatedAt).getTime() - normalizedPolicy.pipeOutputRetentionHours * 60 * 60 * 1000);
  const pipeOutputCutoffIso = pipeOutputCutoff.toISOString();
  const auditCutoff = new Date(new Date(evaluatedAt).getTime() - normalizedPolicy.auditRetentionHours * 60 * 60 * 1000);
  const auditCutoffIso = auditCutoff.toISOString();
  const exportArchiveCutoff = new Date(new Date(evaluatedAt).getTime() - normalizedPolicy.exportArchiveRetentionHours * 60 * 60 * 1000);
  const exportArchiveCutoffIso = exportArchiveCutoff.toISOString();
  const scopedWorkspaceId = textOrNull(workspaceId);
  const scopedProjectId = textOrNull(projectId);
  const max = Math.max(1, Math.min(50000, Number.parseInt(String(limit), 10) || 5000));
  const targets = store.listRecords("frames", { limit: max, orderBy: "captured_at" })
    .filter((frame) => {
      if (frame.deleted_at) return false;
      if (scopedWorkspaceId && frame.workspace_id !== scopedWorkspaceId) return false;
      if (scopedProjectId && frame.project_id !== scopedProjectId) return false;
      const capturedAt = Date.parse(frame.captured_at);
      return Number.isFinite(capturedAt) && capturedAt < frameCutoff.getTime();
    })
    .sort((lhs, rhs) => String(lhs.captured_at || "").localeCompare(String(rhs.captured_at || "")))
    .map((frame) => {
      const mediaAsset = store.getRecord("media_assets", frame.snapshot_asset_id);
      return {
        frameId: frame.id,
        frame_id: frame.id,
        capturedAt: frame.captured_at,
        captured_at: frame.captured_at,
        mediaAssetId: mediaAsset?.id || frame.snapshot_asset_id,
        media_asset_id: mediaAsset?.id || frame.snapshot_asset_id,
        pathExposed: false,
        path_exposed: false,
      };
    });
  const audioTargets = store.listRecords("audio_chunks", { limit: max, orderBy: "started_at" })
    .filter((audio) => {
      if (audio.deleted_at) return false;
      if (scopedWorkspaceId && audio.workspace_id !== scopedWorkspaceId) return false;
      if (scopedProjectId && audio.project_id !== scopedProjectId) return false;
      const startedAtMs = Date.parse(audio.started_at);
      return Number.isFinite(startedAtMs) && startedAtMs < audioCutoff.getTime();
    })
    .sort((lhs, rhs) => String(lhs.started_at || "").localeCompare(String(rhs.started_at || "")))
    .map((audio) => {
      const mediaAsset = store.getRecord("media_assets", audio.audio_asset_id);
      const transcriptCount = store.listRecords("transcript_segments", { limit: 50000 })
        .filter((segment) => segment.audio_chunk_id === audio.id && !segment.deleted_at)
        .length;
      return {
        audioChunkId: audio.id,
        audio_chunk_id: audio.id,
        startedAt: audio.started_at,
        started_at: audio.started_at,
        endedAt: audio.ended_at,
        ended_at: audio.ended_at,
        source: audio.source,
        transcriptCount,
        transcript_count: transcriptCount,
        mediaAssetId: mediaAsset?.id || audio.audio_asset_id,
        media_asset_id: mediaAsset?.id || audio.audio_asset_id,
        pathExposed: false,
        path_exposed: false,
      };
    });
  const firstCapturedAt = targets[0]?.capturedAt ?? null;
  const startedAt = firstCapturedAt || frameCutoffIso;
  const firstAudioStartedAt = audioTargets[0]?.startedAt ?? null;
  const audioStartedAt = firstAudioStartedAt || audioCutoffIso;
  const clipboardTargets = store.listRecords("clipboard_events", { limit: max, orderBy: "captured_at" })
    .filter((event) => {
      if (event.deleted_at) return false;
      if (scopedWorkspaceId && event.workspace_id !== scopedWorkspaceId) return false;
      if (scopedProjectId && event.project_id !== scopedProjectId) return false;
      const capturedAtMs = Date.parse(event.captured_at);
      return Number.isFinite(capturedAtMs) && capturedAtMs < clipboardCutoff.getTime();
    })
    .sort((lhs, rhs) => String(lhs.captured_at || "").localeCompare(String(rhs.captured_at || "")))
    .map((event) => ({
      clipboardEventId: event.id,
      clipboard_event_id: event.id,
      capturedAt: event.captured_at,
      captured_at: event.captured_at,
      occurredAt: event.captured_at,
      occurred_at: event.captured_at,
      eventKind: event.event_kind,
      event_kind: event.event_kind,
      policyMode: event.policy_mode,
      policy_mode: event.policy_mode,
      captureMode: event.policy_mode,
      capture_mode: event.policy_mode,
      contentCaptured: event.content_captured === 1,
      content_captured: event.content_captured === 1,
      rawContentExposed: false,
      raw_content_exposed: false,
      pathExposed: false,
      path_exposed: false,
    }));
  const firstClipboardCapturedAt = clipboardTargets[0]?.capturedAt ?? null;
  const clipboardStartedAt = firstClipboardCapturedAt || clipboardCutoffIso;
  const memoryTargets = derivedTargets(store, "memory_items", {
    timeColumn: "created_at",
    cutoff: memoryCutoff,
    workspaceId: scopedWorkspaceId,
    projectId: scopedProjectId,
    limit: max,
    mapRow: (item) => ({
      memoryItemId: item.id,
      memory_item_id: item.id,
      memoryType: item.memory_type,
      memory_type: item.memory_type,
      createdAt: item.created_at,
      created_at: item.created_at,
      contentExposed: false,
      content_exposed: false,
      pathExposed: false,
      path_exposed: false,
    }),
  });
  const firstMemoryCreatedAt = memoryTargets[0]?.createdAt ?? null;
  const memoryStartedAt = firstMemoryCreatedAt || memoryCutoffIso;
  const productEventTargets = derivedTargets(store, "product_events", {
    timeColumn: "occurred_at",
    cutoff: productEventCutoff,
    workspaceId: scopedWorkspaceId,
    projectId: scopedProjectId,
    limit: max,
    mapRow: (event) => ({
      productEventId: event.id,
      product_event_id: event.id,
      eventType: event.event_type,
      event_type: event.event_type,
      occurredAt: event.occurred_at,
      occurred_at: event.occurred_at,
      verificationStatus: event.verification_status,
      verification_status: event.verification_status,
      proofLedgerLinked: Boolean(event.proof_ledger_event_id),
      proof_ledger_linked: Boolean(event.proof_ledger_event_id),
      contentExposed: false,
      content_exposed: false,
      pathExposed: false,
      path_exposed: false,
    }),
  });
  const firstProductEventOccurredAt = productEventTargets[0]?.occurredAt ?? null;
  const productEventStartedAt = firstProductEventOccurredAt || productEventCutoffIso;
  const evidenceCandidateTargets = store.listRecords("evidence_candidates", { limit: max, orderBy: "reviewed_at" })
    .filter((candidate) => {
      if (candidate.deleted_at) return false;
      if (scopedWorkspaceId && candidate.workspace_id !== scopedWorkspaceId) return false;
      if (scopedProjectId && candidate.project_id !== scopedProjectId) return false;
      if (!RESOLVED_EVIDENCE_CANDIDATE_STATUSES.includes(candidate.candidate_status)) return false;
      const reviewedAtMs = Date.parse(candidate.reviewed_at);
      return Number.isFinite(reviewedAtMs) && reviewedAtMs < evidenceCandidateCutoff.getTime();
    })
    .sort((lhs, rhs) => String(lhs.reviewed_at || "").localeCompare(String(rhs.reviewed_at || "")))
    .map((candidate) => ({
      evidenceCandidateId: candidate.id,
      evidence_candidate_id: candidate.id,
      candidateStatus: candidate.candidate_status,
      candidate_status: candidate.candidate_status,
      proofKind: candidate.proof_kind,
      proof_kind: candidate.proof_kind,
      sourceState: candidate.source_state,
      source_state: candidate.source_state,
      createdAt: candidate.created_at,
      created_at: candidate.created_at,
      reviewedAt: candidate.reviewed_at,
      reviewed_at: candidate.reviewed_at,
      proofLedgerLinked: Boolean(candidate.proof_ledger_event_id),
      proof_ledger_linked: Boolean(candidate.proof_ledger_event_id),
      contentExposed: false,
      content_exposed: false,
      pathExposed: false,
      path_exposed: false,
    }));
  const firstEvidenceCandidateReviewedAt = evidenceCandidateTargets[0]?.reviewedAt ?? null;
  const evidenceCandidateStartedAt = firstEvidenceCandidateReviewedAt || evidenceCandidateCutoffIso;
  const pipeOutputTargets = store.listRecords("pipe_runs", { limit: max, orderBy: "ended_at" })
    .filter((run) => {
      if (run.deleted_at) return false;
      if (scopedWorkspaceId && run.workspace_id !== scopedWorkspaceId) return false;
      if (scopedProjectId && run.project_id !== scopedProjectId) return false;
      if (!TERMINAL_PIPE_RUN_STATUSES.has(run.status)) return false;
      if (!textOrNull(run.output_manifest_json)) return false;
      const endedAtMs = Date.parse(run.ended_at);
      return Number.isFinite(endedAtMs) && endedAtMs < pipeOutputCutoff.getTime();
    })
    .sort((lhs, rhs) => String(lhs.ended_at || "").localeCompare(String(rhs.ended_at || "")))
    .map((run) => {
      const output = parseJsonObject(run.output_manifest_json);
      const artifacts = Array.isArray(output.artifacts) ? output.artifacts : [];
      const actionResults = Array.isArray(output.actionResults ?? output.action_results)
        ? output.actionResults ?? output.action_results
        : [];
      return {
        pipeRunId: run.id,
        pipe_run_id: run.id,
        pipeId: run.pipe_id,
        pipe_id: run.pipe_id,
        runStatus: run.status,
        run_status: run.status,
        outputKind: textOrNull(output.outputKind ?? output.output_kind),
        output_kind: textOrNull(output.outputKind ?? output.output_kind),
        startedAt: run.started_at,
        started_at: run.started_at,
        endedAt: run.ended_at,
        ended_at: run.ended_at,
        artifactCount: artifacts.length,
        artifact_count: artifacts.length,
        actionResultCount: actionResults.length,
        action_result_count: actionResults.length,
        contentExposed: false,
        content_exposed: false,
        pathExposed: false,
        path_exposed: false,
        proofAcceptedByPipeRun: false,
        proof_accepted_by_pipe_run: false,
      };
    });
  const firstPipeOutputEndedAt = pipeOutputTargets[0]?.endedAt ?? null;
  const pipeOutputStartedAt = firstPipeOutputEndedAt || pipeOutputCutoffIso;
  const auditTargets = derivedTargets(store, "recorder_audit", {
    timeColumn: "created_at",
    cutoff: auditCutoff,
    workspaceId: scopedWorkspaceId,
    projectId: scopedProjectId,
    limit: max,
    mapRow: (audit) => ({
      auditRowId: audit.id,
      audit_row_id: audit.id,
      endpoint: audit.endpoint,
      accessLevel: audit.access_level,
      access_level: audit.access_level,
      decision: audit.decision,
      createdAt: audit.created_at,
      created_at: audit.created_at,
      tombstoneOnly: true,
      tombstone_only: true,
      contentExposed: false,
      content_exposed: false,
      pathExposed: false,
      path_exposed: false,
    }),
  });
  const firstAuditCreatedAt = auditTargets[0]?.createdAt ?? null;
  const auditStartedAt = firstAuditCreatedAt || auditCutoffIso;
  const exportArchiveTargets = derivedTargets(store, "media_assets", {
    timeColumn: "created_at",
    cutoff: exportArchiveCutoff,
    workspaceId: scopedWorkspaceId,
    projectId: scopedProjectId,
    limit: max,
    mapRow: (asset) => asset,
  })
    .filter((asset) => asset.asset_type === "export_bundle")
    .map((asset) => ({
      exportArchiveId: asset.id,
      export_archive_id: asset.id,
      mediaAssetId: asset.id,
      media_asset_id: asset.id,
      createdAt: asset.created_at,
      created_at: asset.created_at,
      byteSize: Number(asset.byte_size) || 0,
      byte_size: Number(asset.byte_size) || 0,
      sha256: asset.sha256,
      contentExposed: false,
      content_exposed: false,
      pathExposed: false,
      path_exposed: false,
      proofAcceptedByExport: false,
      proof_accepted_by_export: false,
    }));
  const firstExportArchiveCreatedAt = exportArchiveTargets[0]?.createdAt ?? null;
  const exportArchiveStartedAt = firstExportArchiveCreatedAt || exportArchiveCutoffIso;

  return {
    schemaVersion: RECORDER_RETENTION_SCHEMA_VERSION,
    schema_version: RECORDER_RETENTION_SCHEMA_VERSION,
    schema: "agentic30.recorder.retention_plan.v1",
    evaluatedAt,
    evaluated_at: evaluatedAt,
    policy: normalizedPolicy,
    cutoffAt: frameCutoffIso,
    cutoff_at: frameCutoffIso,
    audioCutoffAt: audioCutoffIso,
    audio_cutoff_at: audioCutoffIso,
    clipboardCutoffAt: clipboardCutoffIso,
    clipboard_cutoff_at: clipboardCutoffIso,
    memoryCutoffAt: memoryCutoffIso,
    memory_cutoff_at: memoryCutoffIso,
    productEventCutoffAt: productEventCutoffIso,
    product_event_cutoff_at: productEventCutoffIso,
    evidenceCandidateCutoffAt: evidenceCandidateCutoffIso,
    evidence_candidate_cutoff_at: evidenceCandidateCutoffIso,
    pipeOutputCutoffAt: pipeOutputCutoffIso,
    pipe_output_cutoff_at: pipeOutputCutoffIso,
    auditCutoffAt: auditCutoffIso,
    audit_cutoff_at: auditCutoffIso,
    exportArchiveCutoffAt: exportArchiveCutoffIso,
    export_archive_cutoff_at: exportArchiveCutoffIso,
    workspaceId: scopedWorkspaceId,
    workspace_id: scopedWorkspaceId,
    projectId: scopedProjectId,
    project_id: scopedProjectId,
    action: "delete_expired_recorder_media",
    targetCount: targets.length + audioTargets.length + clipboardTargets.length + memoryTargets.length + productEventTargets.length + evidenceCandidateTargets.length + pipeOutputTargets.length + auditTargets.length + exportArchiveTargets.length,
    target_count: targets.length + audioTargets.length + clipboardTargets.length + memoryTargets.length + productEventTargets.length + evidenceCandidateTargets.length + pipeOutputTargets.length + auditTargets.length + exportArchiveTargets.length,
    frameTargetCount: targets.length,
    frame_target_count: targets.length,
    audioTargetCount: audioTargets.length,
    audio_target_count: audioTargets.length,
    clipboardTargetCount: clipboardTargets.length,
    clipboard_target_count: clipboardTargets.length,
    memoryTargetCount: memoryTargets.length,
    memory_target_count: memoryTargets.length,
    productEventTargetCount: productEventTargets.length,
    product_event_target_count: productEventTargets.length,
    evidenceCandidateTargetCount: evidenceCandidateTargets.length,
    evidence_candidate_target_count: evidenceCandidateTargets.length,
    pipeOutputTargetCount: pipeOutputTargets.length,
    pipe_output_target_count: pipeOutputTargets.length,
    auditTargetCount: auditTargets.length,
    audit_target_count: auditTargets.length,
    exportArchiveTargetCount: exportArchiveTargets.length,
    export_archive_target_count: exportArchiveTargets.length,
    deleteRange: {
      startedAt,
      started_at: startedAt,
      endedAt: frameCutoffIso,
      ended_at: frameCutoffIso,
    },
    delete_range: {
      started_at: startedAt,
      ended_at: frameCutoffIso,
    },
    audioDeleteRange: {
      startedAt: audioStartedAt,
      started_at: audioStartedAt,
      endedAt: audioCutoffIso,
      ended_at: audioCutoffIso,
    },
    audio_delete_range: {
      started_at: audioStartedAt,
      ended_at: audioCutoffIso,
    },
    clipboardDeleteRange: {
      startedAt: clipboardStartedAt,
      started_at: clipboardStartedAt,
      endedAt: clipboardCutoffIso,
      ended_at: clipboardCutoffIso,
    },
    clipboard_delete_range: {
      started_at: clipboardStartedAt,
      ended_at: clipboardCutoffIso,
    },
    memoryDeleteRange: {
      startedAt: memoryStartedAt,
      started_at: memoryStartedAt,
      endedAt: memoryCutoffIso,
      ended_at: memoryCutoffIso,
    },
    memory_delete_range: {
      started_at: memoryStartedAt,
      ended_at: memoryCutoffIso,
    },
    productEventDeleteRange: {
      startedAt: productEventStartedAt,
      started_at: productEventStartedAt,
      endedAt: productEventCutoffIso,
      ended_at: productEventCutoffIso,
    },
    product_event_delete_range: {
      started_at: productEventStartedAt,
      ended_at: productEventCutoffIso,
    },
    evidenceCandidateDeleteRange: {
      startedAt: evidenceCandidateStartedAt,
      started_at: evidenceCandidateStartedAt,
      endedAt: evidenceCandidateCutoffIso,
      ended_at: evidenceCandidateCutoffIso,
    },
    evidence_candidate_delete_range: {
      started_at: evidenceCandidateStartedAt,
      ended_at: evidenceCandidateCutoffIso,
    },
    pipeOutputDeleteRange: {
      startedAt: pipeOutputStartedAt,
      started_at: pipeOutputStartedAt,
      endedAt: pipeOutputCutoffIso,
      ended_at: pipeOutputCutoffIso,
    },
    pipe_output_delete_range: {
      started_at: pipeOutputStartedAt,
      ended_at: pipeOutputCutoffIso,
    },
    auditDeleteRange: {
      startedAt: auditStartedAt,
      started_at: auditStartedAt,
      endedAt: auditCutoffIso,
      ended_at: auditCutoffIso,
    },
    audit_delete_range: {
      started_at: auditStartedAt,
      ended_at: auditCutoffIso,
    },
    exportArchiveDeleteRange: {
      startedAt: exportArchiveStartedAt,
      started_at: exportArchiveStartedAt,
      endedAt: exportArchiveCutoffIso,
      ended_at: exportArchiveCutoffIso,
    },
    export_archive_delete_range: {
      started_at: exportArchiveStartedAt,
      ended_at: exportArchiveCutoffIso,
    },
    targets,
    audioTargets,
    audio_targets: audioTargets,
    clipboardTargets,
    clipboard_targets: clipboardTargets,
    memoryTargets,
    memory_targets: memoryTargets,
    productEventTargets,
    product_event_targets: productEventTargets,
    evidenceCandidateTargets,
    evidence_candidate_targets: evidenceCandidateTargets,
    pipeOutputTargets,
    pipe_output_targets: pipeOutputTargets,
    auditTargets,
    audit_targets: auditTargets,
    exportArchiveTargets,
    export_archive_targets: exportArchiveTargets,
  };
}

export async function applyRecorderRetentionPolicy(store, options = {}) {
  const plan = buildRecorderRetentionPlan(store, options);
  if (!plan.targetCount) {
    return {
      schemaVersion: RECORDER_RETENTION_SCHEMA_VERSION,
      schema_version: RECORDER_RETENTION_SCHEMA_VERSION,
      schema: "agentic30.recorder.retention_result.v1",
      status: "noop",
      plan,
      deletedFrameCount: 0,
      deleted_frame_count: 0,
      deletedAudioChunkCount: 0,
      deleted_audio_chunk_count: 0,
      deletedTranscriptSegmentCount: 0,
      deleted_transcript_segment_count: 0,
      deletedClipboardEventCount: 0,
      deleted_clipboard_event_count: 0,
      purgedClipboardContentCount: 0,
      purged_clipboard_content_count: 0,
      deletedMemoryItemCount: 0,
      deleted_memory_item_count: 0,
      deletedProductEventCount: 0,
      deleted_product_event_count: 0,
      deletedEvidenceCandidateCount: 0,
      deleted_evidence_candidate_count: 0,
      rejectedEvidenceCandidateCount: 0,
      rejected_evidence_candidate_count: 0,
      deletedPipeRunCount: 0,
      deleted_pipe_run_count: 0,
      purgedPipeOutputCount: 0,
      purged_pipe_output_count: 0,
      tombstonedAuditRowCount: 0,
      tombstoned_audit_row_count: 0,
      deletedExportArchiveCount: 0,
      deleted_export_archive_count: 0,
      deletedMediaCount: 0,
      deleted_media_count: 0,
    };
  }

  await assertRetentionTargetFilesAvailable(store, plan);

  const frameResult = plan.frameTargetCount > 0
    ? await deleteRecorderFrameCapturesInRange(store, {
      workspaceId: plan.workspaceId,
      projectId: plan.projectId,
      startedAt: plan.deleteRange.startedAt,
      endedAt: plan.deleteRange.endedAt,
      now: options.now ?? new Date(),
      limit: options.limit ?? 5000,
    })
    : null;
  const audioResult = plan.audioTargetCount > 0
    ? await deleteRecorderAudioChunksInRange(store, {
      workspaceId: plan.workspaceId,
      projectId: plan.projectId,
      startedAt: plan.audioDeleteRange.startedAt,
      endedAt: plan.audioDeleteRange.endedAt,
      now: options.now ?? new Date(),
      limit: options.limit ?? 5000,
    })
    : null;
  const clipboardResult = plan.clipboardTargetCount > 0
    ? deleteRecorderClipboardEventsInRange(store, {
      workspaceId: plan.workspaceId,
      projectId: plan.projectId,
      startedAt: plan.clipboardDeleteRange.startedAt,
      endedAt: plan.clipboardDeleteRange.endedAt,
      now: options.now ?? new Date(),
      limit: options.limit ?? 5000,
    })
    : null;
  const memoryResult = plan.memoryTargetCount > 0
    ? deleteRecorderMemoryItemsInRange(store, {
      workspaceId: plan.workspaceId,
      projectId: plan.projectId,
      startedAt: plan.memoryDeleteRange.startedAt,
      endedAt: plan.memoryDeleteRange.endedAt,
      now: options.now ?? new Date(),
      limit: options.limit ?? 5000,
    })
    : null;
  const productEventResult = plan.productEventTargetCount > 0
    ? deleteRecorderProductEventsInRange(store, {
      workspaceId: plan.workspaceId,
      projectId: plan.projectId,
      startedAt: plan.productEventDeleteRange.startedAt,
      endedAt: plan.productEventDeleteRange.endedAt,
      now: options.now ?? new Date(),
      limit: options.limit ?? 5000,
    })
    : null;
  const evidenceCandidateResult = plan.evidenceCandidateTargetCount > 0
    ? deleteRecorderEvidenceCandidatesInRange(store, {
      workspaceId: plan.workspaceId,
      projectId: plan.projectId,
      startedAt: plan.evidenceCandidateDeleteRange.startedAt,
      endedAt: plan.evidenceCandidateDeleteRange.endedAt,
      now: options.now ?? new Date(),
      limit: options.limit ?? 5000,
      timeColumn: "reviewed_at",
      candidateStatuses: RESOLVED_EVIDENCE_CANDIDATE_STATUSES,
      reasonCode: "ERR_RECORDER_EVIDENCE_CANDIDATE_RETENTION_EXPIRED",
      reason: "resolved evidence candidate exceeded recorder retention policy",
    })
    : null;
  const pipeOutputResult = plan.pipeOutputTargetCount > 0
    ? deleteRecorderPipeRunsInRange(store, {
      workspaceId: plan.workspaceId,
      projectId: plan.projectId,
      workspaceRoot: options.workspaceRoot ?? null,
      startedAt: plan.pipeOutputDeleteRange.startedAt,
      endedAt: plan.pipeOutputDeleteRange.endedAt,
      now: options.now ?? new Date(),
      limit: options.limit ?? 5000,
    })
    : null;
  const auditResult = plan.auditTargetCount > 0
    ? deleteRecorderAuditRowsInRange(store, {
      workspaceId: plan.workspaceId,
      projectId: plan.projectId,
      startedAt: plan.auditDeleteRange.startedAt,
      endedAt: plan.auditDeleteRange.endedAt,
      now: options.now ?? new Date(),
      limit: options.limit ?? 5000,
    })
    : null;
  const exportArchiveResult = plan.exportArchiveTargetCount > 0
    ? await deleteRecorderExportArchivesInRange(store, {
      workspaceId: plan.workspaceId,
      projectId: plan.projectId,
      startedAt: plan.exportArchiveDeleteRange.startedAt,
      endedAt: plan.exportArchiveDeleteRange.endedAt,
      now: options.now ?? new Date(),
      limit: options.limit ?? 5000,
    })
    : null;
  const hadRetentionWork = Boolean(
    frameResult
    || audioResult
    || clipboardResult
    || memoryResult
    || productEventResult
    || evidenceCandidateResult
    || pipeOutputResult
    || auditResult
    || exportArchiveResult
  );
  const storeMaintenance = options.runStoreMaintenance === false || options.run_store_maintenance === false
    ? null
    : store.runMaintenance({
      checkpointMode: options.checkpointMode ?? options.checkpoint_mode ?? "TRUNCATE",
      vacuum: options.vacuumAfterRetention ?? options.vacuum_after_retention ?? hadRetentionWork,
    });

  return {
    schemaVersion: RECORDER_RETENTION_SCHEMA_VERSION,
    schema_version: RECORDER_RETENTION_SCHEMA_VERSION,
    schema: "agentic30.recorder.retention_result.v1",
    status: "applied",
    plan,
    deleteResult: frameResult,
    delete_result: frameResult,
    audioDeleteResult: audioResult,
    audio_delete_result: audioResult,
    clipboardDeleteResult: clipboardResult,
    clipboard_delete_result: clipboardResult,
    memoryDeleteResult: memoryResult,
    memory_delete_result: memoryResult,
    productEventDeleteResult: productEventResult,
    product_event_delete_result: productEventResult,
    evidenceCandidateDeleteResult: evidenceCandidateResult,
    evidence_candidate_delete_result: evidenceCandidateResult,
    pipeOutputDeleteResult: pipeOutputResult,
    pipe_output_delete_result: pipeOutputResult,
    auditDeleteResult: auditResult,
    audit_delete_result: auditResult,
    exportArchiveDeleteResult: exportArchiveResult,
    export_archive_delete_result: exportArchiveResult,
    storeMaintenance,
    store_maintenance: storeMaintenance,
    deletedFrameCount: frameResult?.frameCount ?? 0,
    deleted_frame_count: frameResult?.frameCount ?? 0,
    deletedAudioChunkCount: audioResult?.audioChunkCount ?? 0,
    deleted_audio_chunk_count: audioResult?.audioChunkCount ?? 0,
    deletedTranscriptSegmentCount: audioResult?.transcriptSegmentCount ?? 0,
    deleted_transcript_segment_count: audioResult?.transcriptSegmentCount ?? 0,
    deletedClipboardEventCount: clipboardResult?.clipboardEventCount ?? 0,
    deleted_clipboard_event_count: clipboardResult?.clipboardEventCount ?? 0,
    purgedClipboardContentCount: clipboardResult?.contentPurgedCount ?? 0,
    purged_clipboard_content_count: clipboardResult?.contentPurgedCount ?? 0,
    deletedMemoryItemCount: memoryResult?.memoryItemCount ?? 0,
    deleted_memory_item_count: memoryResult?.memoryItemCount ?? 0,
    deletedProductEventCount: productEventResult?.productEventCount ?? 0,
    deleted_product_event_count: productEventResult?.productEventCount ?? 0,
    deletedEvidenceCandidateCount: evidenceCandidateResult?.evidenceCandidateCount ?? 0,
    deleted_evidence_candidate_count: evidenceCandidateResult?.evidenceCandidateCount ?? 0,
    rejectedEvidenceCandidateCount: evidenceCandidateResult?.rejectedCandidateCount ?? 0,
    rejected_evidence_candidate_count: evidenceCandidateResult?.rejectedCandidateCount ?? 0,
    deletedPipeRunCount: pipeOutputResult?.pipeRunCount ?? 0,
    deleted_pipe_run_count: pipeOutputResult?.pipeRunCount ?? 0,
    purgedPipeOutputCount: pipeOutputResult?.outputPurgedCount ?? 0,
    purged_pipe_output_count: pipeOutputResult?.outputPurgedCount ?? 0,
    tombstonedAuditRowCount: auditResult?.auditRowCount ?? 0,
    tombstoned_audit_row_count: auditResult?.auditRowCount ?? 0,
    deletedExportArchiveCount: exportArchiveResult?.exportArchiveCount ?? 0,
    deleted_export_archive_count: exportArchiveResult?.exportArchiveCount ?? 0,
    deletedMediaCount: (frameResult?.mediaRemovedCount ?? 0) + (audioResult?.mediaRemovedCount ?? 0) + (exportArchiveResult?.mediaRemovedCount ?? 0),
    deleted_media_count: (frameResult?.mediaRemovedCount ?? 0) + (audioResult?.mediaRemovedCount ?? 0) + (exportArchiveResult?.mediaRemovedCount ?? 0),
  };
}

function positiveNumber(value, fieldName) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    fail("ERR_RECORDER_RETENTION_INVALID_POLICY", `retention policy requires positive ${fieldName}`, {
      fieldName,
      value,
    });
  }
  return parsed;
}

async function assertRetentionTargetFilesAvailable(store, plan) {
  for (const target of plan.targets) {
    const mediaAsset = store.getRecord("media_assets", target.mediaAssetId);
    if (!mediaAsset) {
      fail("ERR_RECORDER_DELETE_MEDIA_NOT_FOUND", `retention frame media asset not found: ${target.mediaAssetId}`, {
        mediaAssetId: target.mediaAssetId,
      });
    }
    await assertRetentionFileAccessible(resolveRecorderFrameMediaPath(store, mediaAsset), target.mediaAssetId, "frame");
  }
  for (const target of plan.audioTargets) {
    const mediaAsset = store.getRecord("media_assets", target.mediaAssetId);
    if (!mediaAsset) {
      fail("ERR_RECORDER_DELETE_MEDIA_NOT_FOUND", `retention audio media asset not found: ${target.mediaAssetId}`, {
        mediaAssetId: target.mediaAssetId,
      });
    }
    await assertRetentionFileAccessible(resolveRecorderAudioMediaPath(store, mediaAsset), target.mediaAssetId, "audio");
  }
  preflightExportArchiveTargetsSync(
    resolveExportArchiveInvalidationClosureTargets(store, retentionSourceRefsForPlan(store, plan)),
  );
  for (const target of plan.exportArchiveTargets) {
    const mediaAsset = store.getRecord("media_assets", target.mediaAssetId);
    if (!mediaAsset) {
      fail("ERR_RECORDER_DELETE_MEDIA_NOT_FOUND", `retention export archive media asset not found: ${target.mediaAssetId}`, {
        mediaAssetId: target.mediaAssetId,
      });
    }
    await assertRetentionFileAvailable(resolveRecorderExportArchiveMediaPath(store, mediaAsset), target.mediaAssetId, "export");
  }
}

function retentionSourceRefsForPlan(store, plan) {
  const refs = [];
  const seen = new Set();
  const addRef = (id, sourceType = null) => {
    const cleanId = textOrNull(id);
    if (!cleanId) return;
    const cleanType = textOrNull(sourceType);
    const key = `${cleanType || ""}:${cleanId}`;
    if (seen.has(key)) return;
    seen.add(key);
    refs.push(cleanType ? { id: cleanId, source_type: cleanType } : { id: cleanId });
  };
  for (const target of plan.targets) {
    addRef(target.frameId, "frame");
  }
  const audioChunkIds = new Set();
  for (const target of plan.audioTargets) {
    addRef(target.audioChunkId, "audio");
    addRef(target.audioChunkId, "audio_chunk");
    audioChunkIds.add(target.audioChunkId);
  }
  if (audioChunkIds.size) {
    for (const segment of store.listRecords("transcript_segments", { limit: 50000 })) {
      if (!segment.deleted_at && audioChunkIds.has(segment.audio_chunk_id)) {
        addRef(segment.id, "transcript");
      }
    }
  }
  for (const target of plan.clipboardTargets) {
    addRef(target.clipboardEventId, "clipboard");
  }
  for (const target of plan.memoryTargets) {
    addRef(target.memoryItemId, "memory");
  }
  for (const target of plan.productEventTargets) {
    addRef(target.productEventId, "product_event");
  }
  for (const target of plan.evidenceCandidateTargets) {
    addRef(target.evidenceCandidateId, "evidence_candidate");
  }
  for (const target of plan.pipeOutputTargets) {
    const run = store.getRecord("pipe_runs", target.pipeRunId);
    for (const ref of run ? sourceRefsForPipeRun(run) : [{ id: target.pipeRunId, source_type: "pipe_run" }]) {
      addRef(ref.id, ref.source_type ?? ref.sourceType);
    }
  }
  for (const target of plan.auditTargets) {
    addRef(target.auditRowId, "recorder_audit");
  }
  return refs;
}

// Export-archive direct-retention variant of assertRetentionFileAccessible.
// A MISSING file (ENOENT) is treated as already-satisfied: the unlink is
// skipped by deleteRecorderExportArchivesInRange but the media row is still
// tombstoned so one orphan export bundle cannot deadlock the sweep.
// Genuinely-unexpected states (not-a-file, EACCES/EBUSY, any other stat
// error) fail-before-mutation with a named root cause.
async function assertRetentionFileAvailable(mediaPath, mediaAssetId, mediaKind) {
  let stat;
  try {
    stat = await fs.stat(mediaPath);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return;
    }
    fail("ERR_RECORDER_DELETE_MEDIA_STAT_FAILED", `failed to inspect retention ${mediaKind} media: ${mediaAssetId}`, {
      mediaAssetId,
      cause: error?.message || String(error),
    });
  }
  if (!stat.isFile()) {
    fail("ERR_RECORDER_DELETE_MEDIA_NOT_FILE", `retention ${mediaKind} media path is not a file: ${mediaAssetId}`, {
      mediaAssetId,
    });
  }
}

// Raw frame/audio retention must never deadlock on an orphan row whose media
// file is already gone: a MISSING file (ENOENT) is treated as already-purged,
// so the downstream delete still soft-deletes + tombstones the row instead of
// aborting the whole sweep. Genuinely-unexpected states (not-a-file,
// EACCES/EPERM/EBUSY, any other stat error) still fail-before-mutation.
async function assertRetentionFileAccessible(mediaPath, mediaAssetId, mediaKind) {
  let stat;
  try {
    stat = await fs.stat(mediaPath);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return;
    }
    fail("ERR_RECORDER_DELETE_MEDIA_STAT_FAILED", `failed to inspect retention ${mediaKind} media: ${mediaAssetId}`, {
      mediaAssetId,
      cause: error?.message || String(error),
    });
  }
  if (!stat.isFile()) {
    fail("ERR_RECORDER_DELETE_MEDIA_NOT_FILE", `retention ${mediaKind} media path is not a file: ${mediaAssetId}`, {
      mediaAssetId,
    });
  }
}

function derivedTargets(store, table, {
  timeColumn,
  cutoff,
  workspaceId = null,
  projectId = null,
  limit = 5000,
  mapRow,
}) {
  return store.listRecords(table, { limit, orderBy: timeColumn })
    .filter((row) => {
      if (row.deleted_at) return false;
      if (workspaceId && row.workspace_id !== workspaceId) return false;
      if (projectId && row.project_id !== projectId) return false;
      const timestamp = Date.parse(row[timeColumn]);
      return Number.isFinite(timestamp) && timestamp < cutoff.getTime();
    })
    .sort((lhs, rhs) => String(lhs[timeColumn] || "").localeCompare(String(rhs[timeColumn] || "")))
    .map(mapRow);
}

function textOrNull(value) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text || null;
}

function parseJsonObject(value) {
  try {
    const parsed = JSON.parse(value || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function toIso(value) {
  const date = value instanceof Date ? value : new Date(value ?? Date.now());
  if (Number.isNaN(date.getTime())) {
    fail("ERR_RECORDER_RETENTION_INVALID_TIMESTAMP", "retention timestamp is invalid", { value });
  }
  return date.toISOString();
}

function fail(code, message, details = {}) {
  throw new RecorderRetentionError(code, message, details);
}
