import path from "node:path";

import {
  RecorderControlStateError,
  assertRecorderCaptureReady,
  evaluateRecorderExpandedMediaPolicy,
} from "./recorder-control-state.mjs";

export const RECORDER_AUDIO_CHUNK_SCHEMA_VERSION = 1;

const AUDIO_SOURCES = new Set(["microphone", "system_audio", "meeting_audio"]);
const TRANSCRIPT_STATUSES = new Set([
  "not_requested",
  "local_pending",
  "local_complete",
  "local_transcription_unavailable",
]);
const SEARCH_SAFE_REDACTION_STATUSES = new Set([
  "redacted",
  "safe",
  "safe_redacted",
  "allowlisted",
]);
const CLOUD_TRANSCRIPTION_PROVIDERS = new Set([
  "cloud",
  "openai",
  "openai_whisper",
  "whisper_api",
  "deepgram",
  "assemblyai",
  "google",
  "aws",
  "azure",
]);

export class RecorderAudioError extends Error {
  constructor(code, message, details = {}) {
    super(`${code}: ${message}`);
    this.name = "RecorderAudioError";
    this.code = code;
    this.details = details;
  }
}

export function recordAudioChunk(store, audio = {}, { now = new Date(), controlState = null } = {}) {
  if (!store) {
    fail("ERR_RECORDER_AUDIO_STORE_REQUIRED", "recordAudioChunk requires a RecorderStore-like store");
  }
  if (!controlState) {
    fail("ERR_RECORDER_AUDIO_CONTROL_STATE_REQUIRED", "audio ingest requires recorder control state");
  }
  try {
    assertRecorderCaptureReady(controlState, { now });
  } catch (error) {
    if (!(error instanceof RecorderControlStateError)) throw error;
    fail("ERR_RECORDER_AUDIO_CAPTURE_NOT_READY", "audio cannot be recorded while recorder is not ready", {
      controlErrorCode: error.code,
      control_error_code: error.code,
      readiness: error.details?.readiness || null,
    });
  }

  const policy = evaluateRecorderExpandedMediaPolicy(controlState, { now }).audio;
  const createdAt = toIso(now);
  const normalized = normalizeAudioChunk(audio, { createdAt, policy });

  if (store.getRecord("media_assets", normalized.mediaAsset.id)) {
    fail("ERR_RECORDER_AUDIO_DUPLICATE_MEDIA_ASSET", `audio media asset already exists: ${normalized.mediaAsset.id}`);
  }
  if (store.getRecord("audio_chunks", normalized.audioChunk.id)) {
    fail("ERR_RECORDER_AUDIO_DUPLICATE_CHUNK", `audio chunk already exists: ${normalized.audioChunk.id}`);
  }
  for (const segment of normalized.transcriptSegments) {
    if (store.getRecord("transcript_segments", segment.id)) {
      fail("ERR_RECORDER_AUDIO_DUPLICATE_TRANSCRIPT_SEGMENT", `transcript segment already exists: ${segment.id}`);
    }
  }

  store.withTransaction(() => {
    store.insertRecord("media_assets", normalized.mediaAsset);
    store.insertRecord("audio_chunks", normalized.audioChunk);
    for (const segment of normalized.transcriptSegments) {
      store.insertRecord("transcript_segments", segment);
    }
  });

  const receipt = {
    schemaVersion: RECORDER_AUDIO_CHUNK_SCHEMA_VERSION,
    schema_version: RECORDER_AUDIO_CHUNK_SCHEMA_VERSION,
    audioChunk: audioChunkReceipt(normalized.audioChunk, normalized.mediaAsset),
    audio_chunk: audioChunkReceipt(normalized.audioChunk, normalized.mediaAsset),
    transcriptSegments: normalized.transcriptSegments.map(transcriptSegmentReceipt),
    transcript_segments: normalized.transcriptSegments.map(transcriptSegmentReceipt),
    mediaAsset: mediaAssetReceipt(normalized.mediaAsset),
    media_asset: mediaAssetReceipt(normalized.mediaAsset),
    rawAudioExposed: false,
    raw_audio_exposed: false,
    rawTranscriptExposed: false,
    raw_transcript_exposed: false,
    pathExposed: false,
    path_exposed: false,
    proofAcceptedByAudioChunk: false,
    proof_accepted_by_audio_chunk: false,
    proofLedgerWriteAllowed: false,
    proof_ledger_write_allowed: false,
  };
  return {
    ...normalized,
    ...receipt,
  };
}

export function normalizeAudioChunk(audio = {}, { createdAt = new Date().toISOString(), policy = null } = {}) {
  const source = objectOrFail(audio, "ERR_RECORDER_AUDIO_INVALID_CHUNK", "audio chunk must be an object");
  const asset = objectOrFail(
    source.audioAsset ?? source.audio_asset ?? source.asset ?? {},
    "ERR_RECORDER_AUDIO_INVALID_ASSET",
    "audio chunk requires audio asset metadata",
  );
  const audioSource = normalizeAudioSource(source.source ?? source.audioSource ?? source.audio_source);
  assertAudioPolicyAllows(audioSource, policy);
  assertLocalTranscriptionOnly(source);

  const startedAt = toIso(source.startedAt ?? source.started_at ?? createdAt);
  const endedAt = toIso(source.endedAt ?? source.ended_at ?? startedAt);
  if (Date.parse(endedAt) < Date.parse(startedAt)) {
    fail("ERR_RECORDER_AUDIO_INVALID_TIME_RANGE", "audio ended_at must not be before started_at");
  }
  const workspaceId = textOrNull(source.workspaceId ?? source.workspace_id);
  const projectId = textOrNull(source.projectId ?? source.project_id);
  const assetId = requiredText(asset.id ?? asset.assetId ?? asset.asset_id, "audio_asset.id");
  const transcriptStatus = normalizeTranscriptStatus(source.transcriptStatus ?? source.transcript_status ?? "not_requested");
  const segments = normalizeTranscriptSegments(source.transcriptSegments ?? source.transcript_segments ?? [], {
    audioChunkId: requiredText(source.id ?? source.audioChunkId ?? source.audio_chunk_id, "id"),
    workspaceId,
    projectId,
    chunkStartedAt: startedAt,
    chunkEndedAt: endedAt,
    createdAt,
  });
  if (transcriptStatus === "local_complete" && segments.length === 0) {
    fail("ERR_RECORDER_AUDIO_TRANSCRIPT_SEGMENTS_REQUIRED", "local_complete transcript status requires at least one transcript segment");
  }
  if (transcriptStatus !== "local_complete" && segments.length > 0) {
    fail("ERR_RECORDER_AUDIO_TRANSCRIPT_STATUS_MISMATCH", "transcript segments require transcript_status=local_complete");
  }

  const mediaAsset = {
    id: assetId,
    asset_type: "audio_m4a",
    relative_path: normalizeAudioMediaRelativePath(asset.relativePath ?? asset.relative_path),
    sha256: requiredText(asset.sha256, "audio_asset.sha256"),
    byte_size: positiveInteger(asset.byteSize ?? asset.byte_size, "audio_asset.byte_size"),
    encrypted: boolean01(asset.encrypted ?? 0),
    workspace_id: workspaceId,
    project_id: projectId,
    created_at: toIso(asset.createdAt ?? asset.created_at ?? createdAt),
    deleted_at: null,
  };
  const audioChunk = {
    id: requiredText(source.id ?? source.audioChunkId ?? source.audio_chunk_id, "id"),
    workspace_id: workspaceId,
    project_id: projectId,
    started_at: startedAt,
    ended_at: endedAt,
    source: audioSource,
    audio_asset_id: assetId,
    transcript_status: transcriptStatus,
    redaction_status: requiredText(source.redactionStatus ?? source.redaction_status ?? "not_redacted", "redaction_status"),
    privacy_state: requiredText(source.privacyState ?? source.privacy_state ?? "raw_local", "privacy_state"),
    created_at: toIso(source.createdAt ?? source.created_at ?? createdAt),
    deleted_at: null,
  };
  return {
    mediaAsset,
    audioChunk,
    audio_chunk: audioChunk,
    transcriptSegments: segments,
    transcript_segments: segments,
  };
}

function normalizeTranscriptSegments(value, {
  audioChunkId,
  workspaceId,
  projectId,
  chunkStartedAt,
  chunkEndedAt,
  createdAt,
} = {}) {
  if (!Array.isArray(value)) {
    fail("ERR_RECORDER_AUDIO_INVALID_TRANSCRIPT_SEGMENTS", "transcript_segments must be an array");
  }
  return value.map((segment, index) => {
    const source = objectOrFail(
      segment,
      "ERR_RECORDER_AUDIO_INVALID_TRANSCRIPT_SEGMENT",
      "transcript segment must be an object",
    );
    const safeForSearch = boolean01(source.safeForSearch ?? source.safe_for_search);
    const redactionStatus = requiredText(source.redactionStatus ?? source.redaction_status, "transcript_segment.redaction_status");
    const redactedText = textOrNull(source.redactedText ?? source.redacted_text);
    if (safeForSearch && !redactedText) {
      fail("ERR_RECORDER_AUDIO_TRANSCRIPT_SEARCH_REQUIRES_REDACTED_TEXT", "safe_for_search transcript segment requires redacted_text");
    }
    if (safeForSearch && !SEARCH_SAFE_REDACTION_STATUSES.has(redactionStatus)) {
      fail(
        "ERR_RECORDER_AUDIO_TRANSCRIPT_UNSAFE_SEARCH_REDACTION",
        `safe_for_search transcript segment requires search-safe redaction_status, got ${redactionStatus}`,
        { redactionStatus },
      );
    }
    const startedAt = toIso(source.startedAt ?? source.started_at ?? chunkStartedAt);
    const endedAt = toIso(source.endedAt ?? source.ended_at ?? startedAt);
    if (Date.parse(endedAt) < Date.parse(startedAt)) {
      fail("ERR_RECORDER_AUDIO_TRANSCRIPT_INVALID_TIME_RANGE", "transcript segment ended_at must not be before started_at");
    }
    if (Date.parse(startedAt) < Date.parse(chunkStartedAt) || Date.parse(endedAt) > Date.parse(chunkEndedAt)) {
      fail("ERR_RECORDER_AUDIO_TRANSCRIPT_OUT_OF_RANGE", "transcript segment must stay inside audio chunk time range");
    }
    return {
      id: requiredText(source.id ?? source.segmentId ?? source.segment_id ?? `${audioChunkId}-segment-${index + 1}`, "transcript_segment.id"),
      audio_chunk_id: audioChunkId,
      workspace_id: textOrNull(source.workspaceId ?? source.workspace_id) || workspaceId,
      project_id: textOrNull(source.projectId ?? source.project_id) || projectId,
      started_at: startedAt,
      ended_at: endedAt,
      speaker_label: textOrNull(source.speakerLabel ?? source.speaker_label),
      text: requiredText(source.text, "transcript_segment.text"),
      redacted_text: redactedText,
      redaction_status: redactionStatus,
      privacy_state: requiredText(source.privacyState ?? source.privacy_state ?? "raw_local", "transcript_segment.privacy_state"),
      safe_for_search: safeForSearch,
      safe_for_memory: boolean01(source.safeForMemory ?? source.safe_for_memory),
      created_at: toIso(source.createdAt ?? source.created_at ?? createdAt),
      deleted_at: null,
    };
  });
}

function assertAudioPolicyAllows(source, policy) {
  if (!policy || typeof policy !== "object") {
    fail("ERR_RECORDER_AUDIO_POLICY_REQUIRED", "audio ingest requires expanded media policy");
  }
  const microphone = policy.microphone || {};
  const systemAudio = policy.systemAudio || policy.system_audio || {};
  const allowed = source === "microphone"
    ? microphone.canCapture === true || microphone.can_capture === true
    : source === "system_audio"
      ? systemAudio.canCapture === true || systemAudio.can_capture === true
      : microphone.canCapture === true
        || microphone.can_capture === true
        || systemAudio.canCapture === true
        || systemAudio.can_capture === true;
  if (allowed) return;
  fail("ERR_RECORDER_AUDIO_CAPTURE_BLOCKED", `${source} capture is blocked by policy or permission`, {
    source,
    microphoneStatus: microphone.status || "",
    microphone_status: microphone.status || "",
    microphonePermission: microphone.permission || "",
    microphone_permission: microphone.permission || "",
    systemAudioStatus: systemAudio.status || "",
    system_audio_status: systemAudio.status || "",
    systemAudioPermission: systemAudio.permission || "",
    system_audio_permission: systemAudio.permission || "",
  });
}

function assertLocalTranscriptionOnly(source) {
  const provider = cleanToken(source.transcriptionProvider ?? source.transcription_provider ?? source.provider ?? "local");
  const status = cleanToken(source.transcriptStatus ?? source.transcript_status ?? "");
  if (CLOUD_TRANSCRIPTION_PROVIDERS.has(provider) || status.startsWith("cloud_")) {
    fail("ERR_RECORDER_AUDIO_CLOUD_TRANSCRIPTION_BLOCKED", "recorder audio ingest cannot use cloud transcription fallback", {
      provider,
      transcriptStatus: status,
      transcript_status: status,
    });
  }
}

function normalizeAudioMediaRelativePath(value) {
  const raw = requiredText(value, "audio_asset.relative_path").replace(/\\/g, "/");
  if (path.posix.isAbsolute(raw)) {
    fail("ERR_RECORDER_AUDIO_ABSOLUTE_MEDIA_PATH", "audio relative_path must not be absolute");
  }
  const normalized = path.posix.normalize(raw);
  if (normalized === "." || normalized.startsWith("../") || normalized.includes("/../")) {
    fail("ERR_RECORDER_AUDIO_UNSAFE_MEDIA_PATH", "audio relative_path must stay under recorder media");
  }
  if (!normalized.startsWith("media/audio/")) {
    fail("ERR_RECORDER_AUDIO_UNEXPECTED_MEDIA_PREFIX", "audio chunks must live under media/audio/");
  }
  return normalized;
}

function audioChunkReceipt(row, mediaAsset) {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    workspace_id: row.workspace_id,
    projectId: row.project_id,
    project_id: row.project_id,
    startedAt: row.started_at,
    started_at: row.started_at,
    endedAt: row.ended_at,
    ended_at: row.ended_at,
    source: row.source,
    audioAssetId: row.audio_asset_id,
    audio_asset_id: row.audio_asset_id,
    transcriptStatus: row.transcript_status,
    transcript_status: row.transcript_status,
    redactionStatus: row.redaction_status,
    redaction_status: row.redaction_status,
    privacyState: row.privacy_state,
    privacy_state: row.privacy_state,
    mediaSha256: mediaAsset.sha256,
    media_sha256: mediaAsset.sha256,
    mediaByteSize: mediaAsset.byte_size,
    media_byte_size: mediaAsset.byte_size,
    mediaEncrypted: Boolean(mediaAsset.encrypted),
    media_encrypted: Boolean(mediaAsset.encrypted),
    rawAudioExposed: false,
    raw_audio_exposed: false,
    pathExposed: false,
    path_exposed: false,
  };
}

function transcriptSegmentReceipt(row) {
  return {
    id: row.id,
    audioChunkId: row.audio_chunk_id,
    audio_chunk_id: row.audio_chunk_id,
    workspaceId: row.workspace_id,
    workspace_id: row.workspace_id,
    projectId: row.project_id,
    project_id: row.project_id,
    startedAt: row.started_at,
    started_at: row.started_at,
    endedAt: row.ended_at,
    ended_at: row.ended_at,
    speakerLabel: row.speaker_label,
    speaker_label: row.speaker_label,
    redactedText: row.redacted_text,
    redacted_text: row.redacted_text,
    redactionStatus: row.redaction_status,
    redaction_status: row.redaction_status,
    privacyState: row.privacy_state,
    privacy_state: row.privacy_state,
    safeForSearch: Boolean(row.safe_for_search),
    safe_for_search: Boolean(row.safe_for_search),
    safeForMemory: Boolean(row.safe_for_memory),
    safe_for_memory: Boolean(row.safe_for_memory),
    rawTranscriptExposed: false,
    raw_transcript_exposed: false,
  };
}

function mediaAssetReceipt(row) {
  return {
    id: row.id,
    assetType: row.asset_type,
    asset_type: row.asset_type,
    sha256: row.sha256,
    byteSize: row.byte_size,
    byte_size: row.byte_size,
    encrypted: Boolean(row.encrypted),
    pathExposed: false,
    path_exposed: false,
  };
}

function objectOrFail(value, code, message) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(code, message);
  }
  return value;
}

function normalizeAudioSource(value) {
  const source = cleanToken(value);
  if (AUDIO_SOURCES.has(source)) return source;
  fail("ERR_RECORDER_AUDIO_UNKNOWN_SOURCE", `unknown recorder audio source: ${source || "(missing)"}`);
}

function normalizeTranscriptStatus(value) {
  const status = cleanToken(value);
  if (TRANSCRIPT_STATUSES.has(status)) return status;
  fail("ERR_RECORDER_AUDIO_UNKNOWN_TRANSCRIPT_STATUS", `unknown recorder transcript_status: ${status || "(missing)"}`);
}

function requiredText(value, fieldName) {
  const text = String(value ?? "").trim();
  if (!text) {
    fail("ERR_RECORDER_AUDIO_MISSING_FIELD", `audio ingest requires ${fieldName}`, { fieldName });
  }
  return text;
}

function textOrNull(value) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text || null;
}

function boolean01(value) {
  return value === true || value === 1 || value === "1" || value === "true" ? 1 : 0;
}

function positiveInteger(value, fieldName) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    fail("ERR_RECORDER_AUDIO_INVALID_INTEGER", `audio ingest requires non-negative integer ${fieldName}`, { fieldName });
  }
  return parsed;
}

function toIso(value) {
  const date = value instanceof Date ? value : new Date(value ?? Date.now());
  if (Number.isNaN(date.getTime())) {
    fail("ERR_RECORDER_AUDIO_INVALID_TIMESTAMP", "audio ingest includes invalid timestamp", { value });
  }
  return date.toISOString();
}

function cleanToken(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
    .slice(0, 120);
}

function fail(code, message, details = {}) {
  throw new RecorderAudioError(code, message, details);
}
