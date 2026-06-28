import fs from "node:fs/promises";
import path from "node:path";

export class RecorderDeleteError extends Error {
  constructor(code, message, details = {}) {
    super(`${code}: ${message}`);
    this.name = "RecorderDeleteError";
    this.code = code;
    this.details = details;
  }
}

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

  const mediaPath = resolveRecorderFrameMediaPath(store, mediaAsset);
  await assertPhysicalFile(mediaPath, mediaAsset.id);

  const deletedAt = toIso(now);
  store.withTransaction(() => {
    store.updateRecord("frames", frame.id, {
      safe_for_search: 0,
      safe_for_memory: 0,
      safe_for_export: 0,
      deleted_at: deletedAt,
    });
    store.updateRecord("media_assets", mediaAsset.id, {
      deleted_at: deletedAt,
    });
  });

  try {
    await fs.unlink(mediaPath);
  } catch (error) {
    fail("ERR_RECORDER_DELETE_MEDIA_UNLINK_FAILED", `failed to remove frame media: ${mediaAsset.id}`, {
      mediaAssetId: mediaAsset.id,
      mediaPath,
      cause: error?.message || String(error),
    });
  }

  return {
    status: "deleted",
    frameId: frame.id,
    frame_id: frame.id,
    mediaAssetId: mediaAsset.id,
    media_asset_id: mediaAsset.id,
    mediaPath,
    media_path: mediaPath,
    mediaRemoved: true,
    media_removed: true,
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
  const max = Math.max(1, Math.min(5000, Number.parseInt(String(limit), 10) || 5000));
  const scopedWorkspaceId = textOrNull(workspaceId);
  const scopedProjectId = textOrNull(projectId);
  const frames = store.listRecords("frames", { limit: max })
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

  for (const target of targets) {
    await assertPhysicalFile(target.mediaPath, target.mediaAsset.id);
  }

  const deletedAt = toIso(now);
  store.withTransaction(() => {
    for (const { frame, mediaAsset } of targets) {
      store.updateRecord("frames", frame.id, {
        safe_for_search: 0,
        safe_for_memory: 0,
        safe_for_export: 0,
        deleted_at: deletedAt,
      });
      store.updateRecord("media_assets", mediaAsset.id, {
        deleted_at: deletedAt,
      });
    }
  });

  for (const target of targets) {
    try {
      await fs.unlink(target.mediaPath);
    } catch (error) {
      fail("ERR_RECORDER_DELETE_MEDIA_UNLINK_FAILED", `failed to remove frame media: ${target.mediaAsset.id}`, {
        mediaAssetId: target.mediaAsset.id,
        mediaPath: target.mediaPath,
        cause: error?.message || String(error),
      });
    }
  }

  return {
    status: "deleted",
    frameCount: targets.length,
    frame_count: targets.length,
    mediaRemovedCount: targets.length,
    media_removed_count: targets.length,
    frameIds: targets.map((target) => target.frame.id),
    frame_ids: targets.map((target) => target.frame.id),
    mediaAssetIds: targets.map((target) => target.mediaAsset.id),
    media_asset_ids: targets.map((target) => target.mediaAsset.id),
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

async function assertPhysicalFile(mediaPath, mediaAssetId) {
  let stat;
  try {
    stat = await fs.stat(mediaPath);
  } catch (error) {
    if (error?.code === "ENOENT") {
      fail("ERR_RECORDER_DELETE_MEDIA_MISSING", `frame media file is missing: ${mediaAssetId}`, {
        mediaAssetId,
        mediaPath,
      });
    }
    fail("ERR_RECORDER_DELETE_MEDIA_STAT_FAILED", `failed to inspect frame media: ${mediaAssetId}`, {
      mediaAssetId,
      mediaPath,
      cause: error?.message || String(error),
    });
  }
  if (!stat.isFile()) {
    fail("ERR_RECORDER_DELETE_MEDIA_NOT_FILE", `frame media path is not a file: ${mediaAssetId}`, {
      mediaAssetId,
      mediaPath,
    });
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
