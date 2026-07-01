import path from "node:path";

import {
  RecorderControlStateError,
  assertRecorderCaptureReady,
} from "./recorder-control-state.mjs";
import {
  assertRawMediaEncryptionPolicy,
  normalizeMediaCaptureMode,
} from "./recorder-media-protection.mjs";
import {
  assertRecorderRedactionPolicyForRecord,
  redactRecorderPublicText,
} from "./recorder-redaction-policy.mjs";

export const RECORDER_CAPTURE_ENVELOPE_SCHEMA_VERSION = 1;

export const RECORDER_TEXT_PROVENANCE_STATES = Object.freeze([
  "accessibility_only",
  "ocr_only",
  "ax_plus_ocr",
  "ocr_unavailable_named_root_cause",
]);

const RECORDER_TEXT_PROVENANCE_STATE_SET = new Set(RECORDER_TEXT_PROVENANCE_STATES);

const SEARCH_SAFE_REDACTION_STATUSES = new Set([
  "redacted",
  "safe",
  "safe_redacted",
  "allowlisted",
]);

const DEFAULT_PRIVACY_STATE = "raw_local";
const DEFAULT_DATA_CLASS = "screen";

export class RecorderIngestError extends Error {
  constructor(code, message, details = {}) {
    super(`${code}: ${message}`);
    this.name = "RecorderIngestError";
    this.code = code;
    this.details = details;
  }
}

export function recordFrameCaptureEnvelope(store, envelope = {}, { now = new Date(), controlState = null } = {}) {
  if (!store) {
    fail("ERR_RECORDER_INGEST_STORE_REQUIRED", "recordFrameCaptureEnvelope requires store");
  }
  if (controlState) {
    try {
      assertRecorderCaptureReady(controlState, { now });
    } catch (error) {
      if (!(error instanceof RecorderControlStateError)) throw error;
      fail("ERR_RECORDER_INGEST_CAPTURE_NOT_READY", "capture envelope cannot be recorded while recorder is not ready", {
        controlErrorCode: error.code,
        control_error_code: error.code,
        readiness: error.details?.readiness || null,
      });
    }
  }
  const createdAt = toIso(now);
  const normalized = normalizeFrameCaptureEnvelope(envelope, { createdAt });

  if (store.getRecord("media_assets", normalized.mediaAsset.id)) {
    fail("ERR_RECORDER_INGEST_DUPLICATE_MEDIA_ASSET", `media asset already exists: ${normalized.mediaAsset.id}`);
  }
  if (store.getRecord("frames", normalized.frame.id)) {
    fail("ERR_RECORDER_INGEST_DUPLICATE_FRAME", `frame already exists: ${normalized.frame.id}`);
  }

  const persisted = store.withTransaction(() => {
    const mediaAsset = store.insertRecord("media_assets", normalized.mediaAsset);
    const frame = store.insertRecord("frames", normalized.frame);
    return { mediaAsset, frame };
  });

  return {
    ...normalized,
    mediaAsset: persisted.mediaAsset,
    frame: persisted.frame,
  };
}

export function normalizeFrameCaptureEnvelope(envelope = {}, { createdAt = new Date().toISOString() } = {}) {
  const source = objectOrFail(envelope, "ERR_RECORDER_INGEST_INVALID_ENVELOPE", "capture envelope must be an object");
  const snapshot = objectOrFail(
    source.snapshot ?? source.snapshotAsset ?? source.snapshot_asset ?? {},
    "ERR_RECORDER_INGEST_INVALID_SNAPSHOT",
    "capture envelope requires snapshot asset",
  );
  const text = source.text && typeof source.text === "object" ? source.text : source;
  const safeForSearch = boolean01(text.safeForSearch ?? text.safe_for_search ?? source.safeForSearch ?? source.safe_for_search);
  const redactionStatus = requiredText(
    text.redactionStatus ?? text.redaction_status ?? source.redactionStatus ?? source.redaction_status,
    "redaction_status",
  );
  const accessibilityText = textOrNull(
    text.accessibilityText ?? text.accessibility_text ?? source.accessibilityText ?? source.accessibility_text,
  );
  const ocrText = textOrNull(text.ocrText ?? text.ocr_text ?? source.ocrText ?? source.ocr_text);
  let redactedText = textOrNull(text.redactedText ?? text.redacted_text ?? source.redactedText ?? source.redacted_text);
  const safeForMemory = boolean01(source.safeForMemory ?? source.safe_for_memory);
  const safeForExport = boolean01(source.safeForExport ?? source.safe_for_export);
  if (
    !redactedText
    && (safeForSearch || safeForMemory || safeForExport)
    && SEARCH_SAFE_REDACTION_STATUSES.has(redactionStatus)
  ) {
    const rawTextForRedaction = accessibilityText || ocrText;
    if (!rawTextForRedaction) {
      fail(
        "ERR_RECORDER_INGEST_REDACTION_INPUT_REQUIRED",
        "safe recorder sinks require redacted_text or local AX/OCR text to redact",
      );
    }
    redactedText = redactRecorderPublicText(rawTextForRedaction, { fail });
  }
  const textSource = requiredText(text.textSource ?? text.text_source ?? source.textSource ?? source.text_source, "text_source");
  const textProvenanceRootCause = textOrNull(
    text.textProvenanceRootCause
      ?? text.text_provenance_root_cause
      ?? text.ocrUnavailableRootCause
      ?? text.ocr_unavailable_root_cause
      ?? source.textProvenanceRootCause
      ?? source.text_provenance_root_cause
      ?? source.ocrUnavailableRootCause
      ?? source.ocr_unavailable_root_cause,
  );
  const normalizedTextProvenance = normalizeTextProvenance(textSource, {
    accessibilityText,
    ocrText,
    textProvenanceRootCause,
  });
  if (safeForSearch && !redactedText) {
    fail("ERR_RECORDER_INGEST_SEARCH_REQUIRES_REDACTED_TEXT", "safe_for_search requires redacted_text");
  }
  if (redactedText) {
    assertRecorderRedactionPolicyForRecord("frames", {
      redacted_text: redactedText,
      redaction_status: redactionStatus,
      safe_for_search: 1,
    }, { fail });
  }
  if (safeForSearch && !SEARCH_SAFE_REDACTION_STATUSES.has(redactionStatus)) {
    fail(
      "ERR_RECORDER_INGEST_UNSAFE_SEARCH_REDACTION",
      `safe_for_search requires search-safe redaction_status, got ${redactionStatus}`,
      { redactionStatus },
    );
  }

  const assetId = requiredText(snapshot.id ?? snapshot.assetId ?? snapshot.asset_id, "snapshot.id");
  const snapshotSha256 = requiredText(snapshot.sha256 ?? source.snapshotSha256 ?? source.snapshot_sha256, "snapshot.sha256");
  const capturedAt = toIso(source.capturedAt ?? source.captured_at ?? createdAt);
  const workspaceId = textOrNull(source.workspaceId ?? source.workspace_id);
  const projectId = textOrNull(source.projectId ?? source.project_id);
  const browserUrl = textOrNull(source.browserUrl ?? source.browser_url);
  const browserDomain = textOrNull(source.browserDomain ?? source.browser_domain) || domainFromUrl(browserUrl);
  const browserUrlNormalized = textOrNull(source.browserUrlNormalized ?? source.browser_url_normalized) || normalizeUrl(browserUrl);
  const browserUrlSearchLabel = sanitizeBrowserUrlSearchLabel(
    source.browserUrlSearchLabel ?? source.browser_url_search_label,
    { browserUrl: browserUrlNormalized || browserUrl, browserDomain },
  );
  const captureTrigger = requiredText(source.captureTrigger ?? source.capture_trigger, "capture_trigger");
  const automaticCapture = boolean01(source.automatic ?? source.automaticCapture ?? source.automatic_capture);
  const backgroundCapture = boolean01(
    source.background ?? source.backgroundCapture ?? source.background_capture ?? source.alwaysOn ?? source.always_on,
  );
  const captureMode = normalizeMediaCaptureMode(
    source.captureMode ?? source.capture_mode
      ?? source.mediaCaptureMode ?? source.media_capture_mode
      ?? (automaticCapture ? "automatic" : backgroundCapture ? "background" : ""),
  );
  const encrypted = boolean01(snapshot.encrypted ?? 0);
  const encryptionEnvelope = assertRawMediaEncryptionPolicy({
    mediaKind: "frame",
    encrypted: Boolean(encrypted),
    encryption: snapshot.encryption ?? snapshot.encryptionEnvelope ?? snapshot.encryption_envelope,
    mediaSha256: snapshotSha256,
    captureMode,
    captureTrigger,
    fail,
  });

  const mediaAsset = {
    id: assetId,
    asset_type: "frame_jpeg",
    relative_path: normalizeMediaRelativePath(snapshot.relativePath ?? snapshot.relative_path),
    sha256: snapshotSha256,
    byte_size: positiveInteger(snapshot.byteSize ?? snapshot.byte_size, "snapshot.byte_size"),
    encrypted,
    encryption_key_id: encryptionEnvelope?.key_id ?? null,
    encryption_alg: encryptionEnvelope?.algorithm ?? null,
    encryption_nonce: encryptionEnvelope?.nonce ?? null,
    encryption_tag: encryptionEnvelope?.tag ?? null,
    workspace_id: workspaceId,
    project_id: projectId,
    created_at: toIso(snapshot.createdAt ?? snapshot.created_at ?? createdAt),
    deleted_at: null,
  };

  const frame = {
    id: requiredText(source.id ?? source.frameId ?? source.frame_id, "id"),
    schema_version: RECORDER_CAPTURE_ENVELOPE_SCHEMA_VERSION,
    workspace_id: workspaceId,
    project_id: projectId,
    captured_at: capturedAt,
    monitor_id: requiredText(source.monitorId ?? source.monitor_id ?? "main", "monitor_id"),
    capture_trigger: captureTrigger,
    app_name: textOrNull(source.appName ?? source.app_name),
    window_title: textOrNull(source.windowTitle ?? source.window_title),
    browser_url: browserUrl,
    browser_domain: browserDomain,
    browser_url_normalized: browserUrlNormalized,
    browser_url_search_label: browserUrlSearchLabel,
    document_path: textOrNull(source.documentPath ?? source.document_path),
    document_path_search_label: textOrNull(source.documentPathSearchLabel ?? source.document_path_search_label),
    snapshot_asset_id: assetId,
    snapshot_sha256: snapshotSha256,
    content_hash: requiredText(source.contentHash ?? source.content_hash, "content_hash"),
    simhash: textOrNull(source.simhash),
    text_source: normalizedTextProvenance.textSource,
    text_provenance_root_cause: normalizedTextProvenance.textProvenanceRootCause,
    accessibility_text: accessibilityText,
    ocr_text: ocrText,
    redacted_text: redactedText,
    redaction_status: redactionStatus,
    privacy_state: requiredText(source.privacyState ?? source.privacy_state ?? DEFAULT_PRIVACY_STATE, "privacy_state"),
    data_class: requiredText(source.dataClass ?? source.data_class ?? DEFAULT_DATA_CLASS, "data_class"),
    safe_for_search: safeForSearch,
    safe_for_memory: safeForMemory,
    safe_for_export: safeForExport,
    created_at: toIso(source.createdAt ?? source.created_at ?? createdAt),
    deleted_at: null,
  };

  return { frame, mediaAsset };
}

function normalizeTextProvenance(textSource, { accessibilityText = null, ocrText = null, textProvenanceRootCause = null } = {}) {
  if (!RECORDER_TEXT_PROVENANCE_STATE_SET.has(textSource)) {
    fail(
      "ERR_RECORDER_INGEST_INVALID_TEXT_PROVENANCE",
      `capture envelope text_source must be one of ${RECORDER_TEXT_PROVENANCE_STATES.join(", ")}, got ${textSource}`,
      { textSource },
    );
  }

  if (textSource === "accessibility_only") {
    if (!accessibilityText || ocrText) {
      fail("ERR_RECORDER_INGEST_TEXT_PROVENANCE_MISMATCH", "accessibility_only requires accessibility_text and no ocr_text", {
        textSource,
        hasAccessibilityText: Boolean(accessibilityText),
        hasOcrText: Boolean(ocrText),
      });
    }
    return { textSource, textProvenanceRootCause: null };
  }

  if (textSource === "ocr_only") {
    if (!ocrText || accessibilityText) {
      fail("ERR_RECORDER_INGEST_TEXT_PROVENANCE_MISMATCH", "ocr_only requires ocr_text and no accessibility_text", {
        textSource,
        hasAccessibilityText: Boolean(accessibilityText),
        hasOcrText: Boolean(ocrText),
      });
    }
    return { textSource, textProvenanceRootCause: null };
  }

  if (textSource === "ax_plus_ocr") {
    if (!accessibilityText || !ocrText) {
      fail("ERR_RECORDER_INGEST_TEXT_PROVENANCE_MISMATCH", "ax_plus_ocr requires both accessibility_text and ocr_text", {
        textSource,
        hasAccessibilityText: Boolean(accessibilityText),
        hasOcrText: Boolean(ocrText),
      });
    }
    return { textSource, textProvenanceRootCause: null };
  }

  if (!textProvenanceRootCause) {
    fail(
      "ERR_RECORDER_INGEST_OCR_UNAVAILABLE_ROOT_CAUSE_REQUIRED",
      "ocr_unavailable_named_root_cause requires text_provenance_root_cause",
      { textSource },
    );
  }
  if (ocrText) {
    fail("ERR_RECORDER_INGEST_TEXT_PROVENANCE_MISMATCH", "ocr_unavailable_named_root_cause requires no ocr_text", {
      textSource,
      hasAccessibilityText: Boolean(accessibilityText),
      hasOcrText: Boolean(ocrText),
    });
  }
  return { textSource, textProvenanceRootCause };
}

function normalizeMediaRelativePath(value) {
  const raw = requiredText(value, "snapshot.relative_path").replace(/\\/g, "/");
  if (path.posix.isAbsolute(raw)) {
    fail("ERR_RECORDER_INGEST_ABSOLUTE_MEDIA_PATH", "snapshot relative_path must not be absolute", { relativePath: raw });
  }
  const normalized = path.posix.normalize(raw);
  if (normalized === "." || normalized.startsWith("../") || normalized.includes("/../")) {
    fail("ERR_RECORDER_INGEST_UNSAFE_MEDIA_PATH", "snapshot relative_path must stay under recorder media", { relativePath: raw });
  }
  if (!normalized.startsWith("media/frames/")) {
    fail("ERR_RECORDER_INGEST_UNEXPECTED_MEDIA_PREFIX", "frame snapshots must live under media/frames/", { relativePath: raw });
  }
  return normalized;
}

function objectOrFail(value, code, message) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(code, message);
  }
  return value;
}

function requiredText(value, fieldName) {
  const text = String(value ?? "").trim();
  if (!text) {
    fail("ERR_RECORDER_INGEST_MISSING_FIELD", `capture envelope requires ${fieldName}`, { fieldName });
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
    fail("ERR_RECORDER_INGEST_INVALID_INTEGER", `capture envelope requires non-negative integer ${fieldName}`, { fieldName });
  }
  return parsed;
}

function toIso(value) {
  const date = value instanceof Date ? value : new Date(value ?? Date.now());
  if (Number.isNaN(date.getTime())) {
    fail("ERR_RECORDER_INGEST_INVALID_TIMESTAMP", "capture envelope includes invalid timestamp", { value });
  }
  return date.toISOString();
}

function domainFromUrl(value) {
  if (!value) return null;
  try {
    return new URL(value).hostname || null;
  } catch {
    return null;
  }
}

function normalizeUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(value);
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function sanitizeBrowserUrlSearchLabel(value, { browserUrl = null, browserDomain = null } = {}) {
  const domain = textOrNull(browserDomain) || domainFromUrl(browserUrl);
  const explicit = textOrNull(value);
  if (!explicit) return domain;
  const explicitDomain = domainFromUrl(explicit);
  if (explicitDomain) return explicitDomain;
  const label = explicit
    .replace(/https?:\/\/\S+/gi, domain || "")
    .replace(/[?#].*$/u, "")
    .replace(/\/[^\s]*/gu, "")
    .trim();
  return textOrNull(label) || domain;
}

function fail(code, message, details = {}) {
  throw new RecorderIngestError(code, message, details);
}
