import path from "node:path";

import {
  RecorderControlStateError,
  assertRecorderCaptureReady,
  evaluateRecorderExpandedMediaPolicy,
} from "./recorder-control-state.mjs";
import {
  assertRawMediaEncryptionPolicy,
  normalizeMediaCaptureMode,
} from "./recorder-media-protection.mjs";
import { redactRecorderPublicText } from "./recorder-redaction-policy.mjs";

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
const TRANSCRIPT_REDACTION_STATUS_OVERRIDES = new Set([
  "none",
  "not_collected",
  "not_redacted",
  "pending",
]);
const RAW_AUDIO_INDICATOR_STATES = new Set([
  "unknown",
  "visible_indicator_active",
  "visible_indicator_acknowledged",
  "not_applicable",
]);
const SPEAKER_LABEL_PROVENANCE = new Set([
  "local_transcriber",
  "manual",
  "meeting_app_metadata",
  "unknown",
]);
const LOCAL_UNAVAILABLE_NO_CLOUD_FALLBACK = "local_unavailable_no_cloud_fallback";
const TRANSCRIPTION_TERMINAL_STATES = new Set([
  LOCAL_UNAVAILABLE_NO_CLOUD_FALLBACK,
  "local_unavailable_speech_framework_missing_no_cloud_fallback",
  "local_unavailable_speech_permission_missing_no_cloud_fallback",
  "local_unavailable_speech_recognizer_unavailable_no_cloud_fallback",
  "local_unavailable_speech_recognition_error_no_cloud_fallback",
  "local_unavailable_speech_timeout_no_cloud_fallback",
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
  const automaticCapture = boolean01(source.automatic ?? source.automaticCapture ?? source.automatic_capture);
  const backgroundCapture = boolean01(
    source.background ?? source.backgroundCapture ?? source.background_capture ?? source.alwaysOn ?? source.always_on,
  );
  const captureMode = normalizeMediaCaptureMode(
    source.captureMode ?? source.capture_mode
      ?? source.mediaCaptureMode ?? source.media_capture_mode
      ?? (automaticCapture ? "automatic" : backgroundCapture ? "background" : ""),
  );
  const captureTrigger = textOrNull(source.captureTrigger ?? source.capture_trigger) || audioSource;
  const encrypted = boolean01(asset.encrypted ?? 0);
  const assetSha256 = requiredText(asset.sha256, "audio_asset.sha256");
  const encryptionEnvelope = assertRawMediaEncryptionPolicy({
    mediaKind: "audio",
    encrypted: Boolean(encrypted),
    encryption: asset.encryption ?? asset.encryptionEnvelope ?? asset.encryption_envelope,
    mediaSha256: assetSha256,
    captureMode,
    captureTrigger,
    fail,
  });
  const transcriptStatus = normalizeTranscriptStatus(source.transcriptStatus ?? source.transcript_status ?? "not_requested");
  const consentGrantId = requiredText(source.consentGrantId ?? source.consent_grant_id, "consent_grant_id");
  const visibleNoticeId = textOrNull(source.visibleNoticeId ?? source.visible_notice_id);
  const rawAudioIndicatorState = normalizeRawAudioIndicatorState(
    source.rawAudioIndicatorState ?? source.raw_audio_indicator_state,
  );
  const localTranscriberName = textOrNull(source.localTranscriberName ?? source.local_transcriber_name);
  const localTranscriberVersion = textOrNull(source.localTranscriberVersion ?? source.local_transcriber_version);
  const transcriptionTerminalState = normalizeTranscriptionTerminalState(
    source.transcriptionTerminalState ?? source.transcription_terminal_state,
    { transcriptStatus },
  );
  assertAudioProvenance({
    audioSource,
    transcriptStatus,
    visibleNoticeId,
    localTranscriberName,
    localTranscriberVersion,
  });
  const segments = normalizeTranscriptSegments(source.transcriptSegments ?? source.transcript_segments ?? [], {
    audioChunkId: requiredText(source.id ?? source.audioChunkId ?? source.audio_chunk_id, "id"),
    workspaceId,
    projectId,
    chunkStartedAt: startedAt,
    chunkEndedAt: endedAt,
    transcriptStatus,
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
    sha256: assetSha256,
    byte_size: positiveInteger(asset.byteSize ?? asset.byte_size, "audio_asset.byte_size"),
    encrypted,
    encryption_key_id: encryptionEnvelope?.key_id ?? null,
    encryption_alg: encryptionEnvelope?.algorithm ?? null,
    encryption_nonce: encryptionEnvelope?.nonce ?? null,
    encryption_tag: encryptionEnvelope?.tag ?? null,
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
    consent_grant_id: consentGrantId,
    visible_notice_id: visibleNoticeId,
    raw_audio_indicator_state: rawAudioIndicatorState,
    local_transcriber_name: localTranscriberName,
    local_transcriber_version: localTranscriberVersion,
    transcription_terminal_state: transcriptionTerminalState,
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
  transcriptStatus,
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
    const rawText = requiredText(source.text, "transcript_segment.text");
    const transcriptRedaction = normalizeTranscriptRedaction({
      rawText,
      redactedText: source.redactedText ?? source.redacted_text,
      redactionStatus: source.redactionStatus ?? source.redaction_status,
      transcriptStatus,
    });
    const safeForSearch = boolean01(source.safeForSearch ?? source.safe_for_search)
      || (transcriptRedaction.searchEligible ? 1 : 0);
    const safeForMemory = boolean01(source.safeForMemory ?? source.safe_for_memory)
      || (transcriptRedaction.searchEligible ? 1 : 0);
    const redactionStatus = transcriptRedaction.redactionStatus;
    const redactedText = transcriptRedaction.redactedText;
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
      transcript_status: transcriptStatus,
      speaker_label_provenance: normalizeSpeakerLabelProvenance(
        source.speakerLabelProvenance ?? source.speaker_label_provenance,
        { speakerLabel: textOrNull(source.speakerLabel ?? source.speaker_label) },
      ),
      text: rawText,
      redacted_text: redactedText,
      redaction_status: redactionStatus,
      privacy_state: requiredText(source.privacyState ?? source.privacy_state ?? "raw_local", "transcript_segment.privacy_state"),
      safe_for_search: safeForSearch,
      safe_for_memory: safeForMemory,
      deletion_source_id: textOrNull(source.deletionSourceId ?? source.deletion_source_id),
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

function normalizeTranscriptRedaction({
  rawText,
  redactedText,
  redactionStatus,
  transcriptStatus,
} = {}) {
  let normalizedRedactedText = textOrNull(redactedText);
  let normalizedStatus = cleanToken(redactionStatus);
  const canDeriveLocalRedaction = transcriptStatus === "local_complete"
    && (!normalizedRedactedText || !normalizedStatus || TRANSCRIPT_REDACTION_STATUS_OVERRIDES.has(normalizedStatus));
  if (canDeriveLocalRedaction) {
    const derivedRedactedText = redactRecorderPublicText(rawText, { fail });
    normalizedRedactedText = normalizedRedactedText || derivedRedactedText;
    if (!normalizedStatus || TRANSCRIPT_REDACTION_STATUS_OVERRIDES.has(normalizedStatus)) {
      normalizedStatus = derivedRedactedText === rawText ? "safe" : "redacted";
    }
  }
  normalizedStatus = requiredText(normalizedStatus, "transcript_segment.redaction_status");
  return {
    redactedText: normalizedRedactedText,
    redactionStatus: normalizedStatus,
    searchEligible: Boolean(normalizedRedactedText && SEARCH_SAFE_REDACTION_STATUSES.has(normalizedStatus)),
  };
}

function assertAudioProvenance({
  audioSource,
  transcriptStatus,
  visibleNoticeId,
  localTranscriberName,
  localTranscriberVersion,
} = {}) {
  if (audioSource === "meeting_audio" && !visibleNoticeId) {
    fail("ERR_RECORDER_AUDIO_MEETING_NOTICE_REQUIRED", "meeting_audio chunks require visible_notice_id");
  }
  if (transcriptStatus === "local_complete" && (!localTranscriberName || !localTranscriberVersion)) {
    fail(
      "ERR_RECORDER_AUDIO_LOCAL_TRANSCRIBER_REQUIRED",
      "local_complete transcript status requires local_transcriber_name and local_transcriber_version",
    );
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
    consentGrantId: row.consent_grant_id,
    consent_grant_id: row.consent_grant_id,
    visibleNoticeId: row.visible_notice_id,
    visible_notice_id: row.visible_notice_id,
    rawAudioIndicatorState: row.raw_audio_indicator_state,
    raw_audio_indicator_state: row.raw_audio_indicator_state,
    localTranscriberName: row.local_transcriber_name,
    local_transcriber_name: row.local_transcriber_name,
    localTranscriberVersion: row.local_transcriber_version,
    local_transcriber_version: row.local_transcriber_version,
    transcriptionTerminalState: row.transcription_terminal_state,
    transcription_terminal_state: row.transcription_terminal_state,
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
    transcriptStatus: row.transcript_status,
    transcript_status: row.transcript_status,
    speakerLabelProvenance: row.speaker_label_provenance,
    speaker_label_provenance: row.speaker_label_provenance,
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
    deletionSourceId: row.deletion_source_id,
    deletion_source_id: row.deletion_source_id,
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

function normalizeRawAudioIndicatorState(value) {
  const state = cleanToken(value);
  if (!state || state === "unknown") {
    fail(
      "ERR_RECORDER_AUDIO_INDICATOR_STATE_REQUIRED",
      "audio ingest requires explicit raw_audio_indicator_state",
    );
  }
  if (RAW_AUDIO_INDICATOR_STATES.has(state)) return state;
  fail("ERR_RECORDER_AUDIO_UNKNOWN_INDICATOR_STATE", `unknown recorder raw_audio_indicator_state: ${state || "(missing)"}`);
}

function normalizeTranscriptionTerminalState(value, { transcriptStatus } = {}) {
  const state = cleanToken(value);
  if (!state && transcriptStatus === "local_transcription_unavailable") {
    return LOCAL_UNAVAILABLE_NO_CLOUD_FALLBACK;
  }
  if (!state) return null;
  if (transcriptStatus !== "local_transcription_unavailable") {
    fail(
      "ERR_RECORDER_AUDIO_TRANSCRIPTION_TERMINAL_STATE_MISMATCH",
      "transcription_terminal_state is only valid when transcript_status=local_transcription_unavailable",
    );
  }
  if (TRANSCRIPTION_TERMINAL_STATES.has(state)) return state;
  fail("ERR_RECORDER_AUDIO_UNKNOWN_TRANSCRIPTION_TERMINAL_STATE", `unknown recorder transcription_terminal_state: ${state}`);
}

function normalizeSpeakerLabelProvenance(value, { speakerLabel } = {}) {
  const provenance = cleanToken(value);
  if (!speakerLabel && !provenance) return null;
  if (speakerLabel && !provenance) {
    fail("ERR_RECORDER_AUDIO_SPEAKER_LABEL_PROVENANCE_REQUIRED", "speaker_label requires speaker_label_provenance");
  }
  if (SPEAKER_LABEL_PROVENANCE.has(provenance)) return provenance;
  fail("ERR_RECORDER_AUDIO_UNKNOWN_SPEAKER_LABEL_PROVENANCE", `unknown speaker_label_provenance: ${provenance || "(missing)"}`);
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
