import { createHash } from "node:crypto";

import {
  RecorderControlStateError,
  evaluateRecorderExpandedMediaPolicy,
} from "./recorder-control-state.mjs";
import {
  assertRecorderRedactionPolicyForRecord,
  redactRecorderPublicText,
} from "./recorder-redaction-policy.mjs";
import { containsSecret } from "./workspace-safety.mjs";

export const RECORDER_CLIPBOARD_EVENT_SCHEMA_VERSION = 2;

const MAX_CLIPBOARD_CONTENT_CHARS = 2000;
const EVENT_KINDS = new Set(["copy", "cut", "paste", "change", "unknown"]);
const CONTENT_TYPES = new Set(["text", "url", "file", "image", "unknown"]);
const SEARCH_SAFE_REDACTION_STATUSES = new Set([
  "redacted",
  "safe",
  "safe_redacted",
  "allowlisted",
]);
const CONTENT_REDACTION_STATUS_OVERRIDES = new Set(["none", "not_collected", "pending"]);

export class RecorderClipboardError extends Error {
  constructor(code, message, details = {}) {
    super(`${code}: ${message}`);
    this.name = "RecorderClipboardError";
    this.code = code;
    this.details = details;
  }
}

export function recordClipboardEvent(store, event = {}, {
  now = new Date(),
  controlState = null,
} = {}) {
  if (!store || typeof store.insertRecord !== "function" || typeof store.getRecord !== "function") {
    fail("ERR_RECORDER_CLIPBOARD_STORE_REQUIRED", "recordClipboardEvent requires a RecorderStore-like store");
  }
  if (!controlState) {
    fail("ERR_RECORDER_CLIPBOARD_CONTROL_STATE_REQUIRED", "clipboard capture requires recorder control state policy");
  }
  const clipboardPolicy = evaluateClipboardPolicy(controlState, { now });
  const normalized = normalizeClipboardEvent(event, {
    createdAt: toIso(now),
    clipboardPolicy,
  });

  if (store.getRecord("clipboard_events", normalized.id)) {
    fail("ERR_RECORDER_CLIPBOARD_DUPLICATE_EVENT", `clipboard event already exists: ${normalized.id}`);
  }

  store.insertRecord("clipboard_events", normalized);
  return {
    schema: "agentic30.recorder.clipboard_event.v1",
    schemaVersion: RECORDER_CLIPBOARD_EVENT_SCHEMA_VERSION,
    schema_version: RECORDER_CLIPBOARD_EVENT_SCHEMA_VERSION,
    event: sanitizedClipboardEvent(normalized),
    clipboardEvent: sanitizedClipboardEvent(normalized),
    clipboard_event: sanitizedClipboardEvent(normalized),
    proofAcceptedByClipboardEvent: false,
    proof_accepted_by_clipboard_event: false,
  };
}

export function normalizeClipboardEvent(event = {}, {
  createdAt = new Date().toISOString(),
  clipboardPolicy = null,
} = {}) {
  const source = objectOrFail(event, "ERR_RECORDER_CLIPBOARD_INVALID_EVENT", "clipboard event must be an object");
  const policy = clipboardPolicy ? normalizeClipboardPolicy(clipboardPolicy) : null;
  const contentText = clipboardContentTextOrNull(source.contentText ?? source.content_text ?? source.content?.text);
  const hasContent = Boolean(contentText);
  const contentCaptureRequested = hasContent || boolean01(source.contentCaptured ?? source.content_captured) === 1;

  if (policy) {
    if (policy.mode === "blocked") {
      fail("ERR_RECORDER_CLIPBOARD_CAPTURE_BLOCKED", "clipboard capture is blocked by policy", {
        status: policy.status,
        mode: policy.mode,
      });
    }
    if (!policy.canCaptureTrigger) {
      fail("ERR_RECORDER_CLIPBOARD_TRIGGER_BLOCKED", "clipboard trigger capture is unavailable", {
        status: policy.status,
        mode: policy.mode,
      });
    }
    if (contentCaptureRequested && !policy.canCaptureContents) {
      fail("ERR_RECORDER_CLIPBOARD_CONTENT_BLOCKED", "clipboard content capture requires explicit content opt-in policy", {
        status: policy.status,
        mode: policy.mode,
      });
    }
  } else if (contentCaptureRequested) {
    fail("ERR_RECORDER_CLIPBOARD_CONTENT_POLICY_REQUIRED", "clipboard content capture requires explicit content policy");
  }

  const captureMode = contentCaptureRequested ? "content_opt_in" : "trigger_only";
  const safeForSearch = boolean01(source.safeForSearch ?? source.safe_for_search);
  let redactedText = textOrNull(source.redactedText ?? source.redacted_text);
  let redactionStatus = cleanString(source.redactionStatus ?? source.redaction_status, 120);
  if (contentText) {
    if (containsSecret(contentText)) {
      fail("ERR_RECORDER_CLIPBOARD_CONTENT_SECRET_BLOCKED", "clipboard content capture detected secret-shaped text", {
        status: policy?.status ?? "unknown",
        mode: policy?.mode ?? "unknown",
        secretSuppression: true,
        secret_suppression: true,
      });
    }
    const derivedRedactedText = redactRecorderPublicText(contentText, { fail });
    redactedText = derivedRedactedText;
    redactionStatus = derivedRedactedText === contentText ? "safe" : "redacted";
  } else if (!redactionStatus) {
    redactionStatus = redactedText ? "redacted" : "none";
  }
  redactionStatus = requiredText(redactionStatus, "redaction_status");
  if (redactedText) {
    assertRecorderRedactionPolicyForRecord("clipboard_events", {
      redacted_text: redactedText,
      redaction_status: redactionStatus,
      safe_for_search: 1,
    }, { fail });
  }
  if (safeForSearch && !redactedText) {
    fail("ERR_RECORDER_CLIPBOARD_SEARCH_REQUIRES_REDACTED_TEXT", "safe_for_search clipboard event requires redacted_text");
  }
  if (safeForSearch && !SEARCH_SAFE_REDACTION_STATUSES.has(redactionStatus)) {
    fail("ERR_RECORDER_CLIPBOARD_UNSAFE_SEARCH_REDACTION", "safe_for_search clipboard event requires search-safe redaction_status", {
      redactionStatus,
      redaction_status: redactionStatus,
    });
  }

  const capturedAt = toIso(source.capturedAt ?? source.captured_at ?? source.occurredAt ?? source.occurred_at ?? createdAt);
  const contentHash = textOrNull(source.contentHash ?? source.content_hash)
    || (contentText ? `sha256:${sha256Hex(contentText)}` : null);
  const contentSize = Number.isFinite(source.contentSize)
    ? Math.max(0, Math.trunc(source.contentSize))
    : Number.isFinite(source.content_size)
      ? Math.max(0, Math.trunc(source.content_size))
      : contentText
        ? contentText.length
        : null;
  return {
    id: requiredText(source.id ?? source.eventId ?? source.event_id, "id"),
    workspace_id: textOrNull(source.workspaceId ?? source.workspace_id),
    project_id: textOrNull(source.projectId ?? source.project_id),
    captured_at: capturedAt,
    event_kind: normalizeToken(source.eventKind ?? source.event_kind, EVENT_KINDS, "unknown"),
    policy_mode: captureMode,
    source_app_name: textOrNull(source.sourceAppName ?? source.source_app_name ?? source.appName ?? source.app_name),
    source_window_title: textOrNull(source.sourceWindowTitle ?? source.source_window_title ?? source.windowTitle ?? source.window_title),
    content_type: normalizeToken(source.contentType ?? source.content_type, CONTENT_TYPES, contentText ? "text" : "unknown"),
    content_size: contentSize,
    content_hash: contentHash,
    content_text: contentCaptureRequested ? contentText : null,
    redacted_text: redactedText,
    redaction_status: redactionStatus,
    privacy_state: requiredText(source.privacyState ?? source.privacy_state ?? "raw_local", "privacy_state"),
    suppression_reason: textOrNull(source.suppressionReason ?? source.suppression_reason),
    raw_retention_expires_at: dateOrNull(source.rawRetentionExpiresAt ?? source.raw_retention_expires_at),
    safe_for_search: safeForSearch,
    safe_for_memory: boolean01(source.safeForMemory ?? source.safe_for_memory),
    safe_for_export: boolean01(source.safeForExport ?? source.safe_for_export),
    content_captured: contentCaptureRequested ? 1 : 0,
    created_at: toIso(source.createdAt ?? source.created_at ?? createdAt),
    deleted_at: null,
  };
}

function evaluateClipboardPolicy(controlState, { now }) {
  try {
    return evaluateRecorderExpandedMediaPolicy(controlState, { now }).clipboard;
  } catch (error) {
    if (!(error instanceof RecorderControlStateError)) throw error;
    fail("ERR_RECORDER_CLIPBOARD_POLICY_INVALID", "clipboard policy could not be evaluated from recorder control state", {
      controlErrorCode: error.code,
      control_error_code: error.code,
    });
  }
}

function normalizeClipboardPolicy(value = {}) {
  const policy = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    mode: cleanString(policy.mode, 60) || "trigger_only",
    status: cleanString(policy.status, 120) || "unknown",
    canCaptureTrigger: policy.canCaptureTrigger === true || policy.can_capture_trigger === true,
    canCaptureContents: policy.canCaptureContents === true || policy.can_capture_contents === true,
  };
}

function sanitizedClipboardEvent(row) {
  const redactedText = row.policy_mode === "content_opt_in" && row.redacted_text === row.content_text
    ? null
    : row.redacted_text;
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    workspace_id: row.workspace_id,
    projectId: row.project_id,
    project_id: row.project_id,
    capturedAt: row.captured_at,
    captured_at: row.captured_at,
    occurredAt: row.captured_at,
    occurred_at: row.captured_at,
    eventKind: row.event_kind,
    event_kind: row.event_kind,
    policyMode: row.policy_mode,
    policy_mode: row.policy_mode,
    captureMode: row.policy_mode,
    capture_mode: row.policy_mode,
    sourceAppName: row.source_app_name,
    source_app_name: row.source_app_name,
    appName: row.source_app_name,
    app_name: row.source_app_name,
    sourceWindowTitle: row.source_window_title,
    source_window_title: row.source_window_title,
    windowTitle: row.source_window_title,
    window_title: row.source_window_title,
    contentType: row.content_type,
    content_type: row.content_type,
    contentSize: row.content_size,
    content_size: row.content_size,
    contentHash: row.content_hash,
    content_hash: row.content_hash,
    redactedText,
    redacted_text: redactedText,
    redactionStatus: row.redaction_status,
    redaction_status: row.redaction_status,
    privacyState: row.privacy_state,
    privacy_state: row.privacy_state,
    suppressionReason: row.suppression_reason,
    suppression_reason: row.suppression_reason,
    rawRetentionExpiresAt: row.raw_retention_expires_at,
    raw_retention_expires_at: row.raw_retention_expires_at,
    safeForSearch: row.safe_for_search === 1,
    safe_for_search: row.safe_for_search === 1,
    safeForMemory: row.safe_for_memory === 1,
    safe_for_memory: row.safe_for_memory === 1,
    safeForExport: row.safe_for_export === 1,
    safe_for_export: row.safe_for_export === 1,
    contentCaptured: row.content_captured === 1,
    content_captured: row.content_captured === 1,
    pathExposed: false,
    path_exposed: false,
    rawContentExposed: false,
    raw_content_exposed: false,
  };
}

function objectOrFail(value, code, message) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(code, message);
  }
  return value;
}

function requiredText(value, fieldName) {
  const text = cleanString(value, 500);
  if (!text) {
    fail("ERR_RECORDER_CLIPBOARD_MISSING_FIELD", `clipboard event requires ${fieldName}`, { fieldName });
  }
  return text;
}

function textOrNull(value) {
  const text = cleanString(value, 2000);
  return text || null;
}

function dateOrNull(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    fail("ERR_RECORDER_CLIPBOARD_INVALID_RAW_RETENTION_EXPIRES_AT", "clipboard event raw_retention_expires_at must be an ISO timestamp when provided");
  }
  return date.toISOString();
}

function clipboardContentTextOrNull(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).replace(/\r\n/g, "\n").trim();
  if (!text) return null;
  if (text.length > MAX_CLIPBOARD_CONTENT_CHARS) {
    fail("ERR_RECORDER_CLIPBOARD_CONTENT_TOO_LARGE", "clipboard content exceeds recorder content size cap", {
      maxLength: MAX_CLIPBOARD_CONTENT_CHARS,
      max_length: MAX_CLIPBOARD_CONTENT_CHARS,
      length: text.length,
    });
  }
  return text;
}

function cleanString(value = "", maxLength = 500) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function normalizeToken(value, allowed, fallback) {
  const token = cleanString(value, 120).toLowerCase().replace(/[^a-z0-9_:-]+/g, "_").replace(/^_+|_+$/g, "");
  return allowed.has(token) ? token : fallback;
}

function boolean01(value) {
  return value === true || value === 1 || value === "1" || value === "true" ? 1 : 0;
}

function toIso(value) {
  const date = value instanceof Date ? value : new Date(value ?? Date.now());
  if (Number.isNaN(date.getTime())) {
    fail("ERR_RECORDER_CLIPBOARD_INVALID_TIMESTAMP", "clipboard event includes invalid timestamp", { value });
  }
  return date.toISOString();
}

function sha256Hex(value = "") {
  return createHash("sha256").update(String(value || "")).digest("hex");
}

function fail(code, message, details = {}) {
  throw new RecorderClipboardError(code, message, details);
}
