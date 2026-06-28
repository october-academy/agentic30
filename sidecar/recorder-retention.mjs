import {
  deleteRecorderFrameCapturesInRange,
  resolveRecorderFrameMediaPath,
} from "./recorder-delete.mjs";

export const RECORDER_RETENTION_SCHEMA_VERSION = 1;

export const DEFAULT_RECORDER_RETENTION_POLICY = Object.freeze({
  rawFrameRetentionHours: 24,
  raw_frame_retention_hours: 24,
});

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
  return {
    schemaVersion: RECORDER_RETENTION_SCHEMA_VERSION,
    schema_version: RECORDER_RETENTION_SCHEMA_VERSION,
    schema: "agentic30.recorder.retention_policy.v1",
    rawFrameRetentionHours,
    raw_frame_retention_hours: rawFrameRetentionHours,
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
  const cutoff = new Date(new Date(evaluatedAt).getTime() - normalizedPolicy.rawFrameRetentionHours * 60 * 60 * 1000);
  const cutoffIso = cutoff.toISOString();
  const scopedWorkspaceId = textOrNull(workspaceId);
  const scopedProjectId = textOrNull(projectId);
  const max = Math.max(1, Math.min(5000, Number.parseInt(String(limit), 10) || 5000));
  const targets = store.listRecords("frames", { limit: max })
    .filter((frame) => {
      if (frame.deleted_at) return false;
      if (scopedWorkspaceId && frame.workspace_id !== scopedWorkspaceId) return false;
      if (scopedProjectId && frame.project_id !== scopedProjectId) return false;
      const capturedAt = Date.parse(frame.captured_at);
      return Number.isFinite(capturedAt) && capturedAt < cutoff.getTime();
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
        mediaPath: mediaAsset ? resolveRecorderFrameMediaPath(store, mediaAsset) : null,
        media_path: mediaAsset ? resolveRecorderFrameMediaPath(store, mediaAsset) : null,
      };
    });
  const firstCapturedAt = targets[0]?.capturedAt ?? null;
  const startedAt = firstCapturedAt || cutoffIso;

  return {
    schemaVersion: RECORDER_RETENTION_SCHEMA_VERSION,
    schema_version: RECORDER_RETENTION_SCHEMA_VERSION,
    schema: "agentic30.recorder.retention_plan.v1",
    evaluatedAt,
    evaluated_at: evaluatedAt,
    policy: normalizedPolicy,
    cutoffAt: cutoffIso,
    cutoff_at: cutoffIso,
    workspaceId: scopedWorkspaceId,
    workspace_id: scopedWorkspaceId,
    projectId: scopedProjectId,
    project_id: scopedProjectId,
    action: "delete_expired_frame_media",
    targetCount: targets.length,
    target_count: targets.length,
    deleteRange: {
      startedAt,
      started_at: startedAt,
      endedAt: cutoffIso,
      ended_at: cutoffIso,
    },
    delete_range: {
      started_at: startedAt,
      ended_at: cutoffIso,
    },
    targets,
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
      deletedMediaCount: 0,
      deleted_media_count: 0,
    };
  }

  const result = await deleteRecorderFrameCapturesInRange(store, {
    workspaceId: plan.workspaceId,
    projectId: plan.projectId,
    startedAt: plan.deleteRange.startedAt,
    endedAt: plan.deleteRange.endedAt,
    now: options.now ?? new Date(),
    limit: options.limit ?? 5000,
  });

  return {
    schemaVersion: RECORDER_RETENTION_SCHEMA_VERSION,
    schema_version: RECORDER_RETENTION_SCHEMA_VERSION,
    schema: "agentic30.recorder.retention_result.v1",
    status: "applied",
    plan,
    deleteResult: result,
    delete_result: result,
    deletedFrameCount: result.frameCount,
    deleted_frame_count: result.frameCount,
    deletedMediaCount: result.mediaRemovedCount,
    deleted_media_count: result.mediaRemovedCount,
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

function textOrNull(value) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text || null;
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
