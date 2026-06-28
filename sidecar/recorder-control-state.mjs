import fs from "node:fs/promises";
import path from "node:path";

import { atomicWriteJson, withFileLock } from "./atomic-store.mjs";
import { resolveRecorderDbPath } from "./recorder-store.mjs";

export const RECORDER_CONTROL_SCHEMA_VERSION = 1;
export const RECORDER_CONTROL_SCHEMA = "agentic30.recorder.control_state.v1";

export const RECORDER_CONTROL_MODES = Object.freeze({
  inactive: "inactive",
  active: "active",
  paused: "paused",
  stoppedForToday: "stopped_for_today",
});

const PERMISSION_STATES = new Set([
  "unknown",
  "not_determined",
  "granted",
  "denied",
  "restricted",
  "unavailable",
]);

const CORE_PERMISSION_IDS = Object.freeze(["screenRecording", "accessibility"]);
const PERMISSION_IDS = Object.freeze([
  ...CORE_PERMISSION_IDS,
  "inputMonitoring",
  "visionOcr",
  "browserMetadata",
  "documentMetadata",
  "clipboard",
  "microphone",
  "systemAudio",
]);
const CLIPBOARD_CAPTURE_MODES = new Set(["trigger_only", "content_opt_in", "blocked"]);

export class RecorderControlStateError extends Error {
  constructor(code, message, details = {}) {
    super(`${code}: ${message}`);
    this.name = "RecorderControlStateError";
    this.code = code;
    this.details = details;
  }
}

export function resolveRecorderControlStatePath(options = {}) {
  return path.join(path.dirname(resolveRecorderDbPath(options)), "recorder-control-state.json");
}

export async function loadRecorderControlState({
  filePath = null,
  appSupportRoot = null,
  env = process.env,
  homeDir = undefined,
  fsImpl = fs,
  now = new Date(),
} = {}) {
  const resolvedPath = filePath || resolveRecorderControlStatePath({ appSupportRoot, env, homeDir });
  try {
    const raw = await fsImpl.readFile(resolvedPath, "utf8");
    return normalizeRecorderControlState(JSON.parse(raw), { now });
  } catch (error) {
    if (error?.code === "ENOENT") return makeDefaultRecorderControlState({ now });
    if (error instanceof SyntaxError) {
      fail("ERR_RECORDER_CONTROL_STATE_CORRUPT", `recorder control state is not valid JSON: ${resolvedPath}`, {
        filePath: resolvedPath,
      });
    }
    throw error;
  }
}

export async function saveRecorderControlState({
  state,
  filePath = null,
  appSupportRoot = null,
  env = process.env,
  homeDir = undefined,
  now = new Date(),
} = {}) {
  const resolvedPath = filePath || resolveRecorderControlStatePath({ appSupportRoot, env, homeDir });
  const normalized = normalizeRecorderControlState(state, { now });
  return withFileLock(resolvedPath, async () => {
    await atomicWriteJson(resolvedPath, normalized);
    return normalized;
  });
}

export async function applyRecorderControlAction({
  action,
  state = null,
  filePath = null,
  appSupportRoot = null,
  env = process.env,
  homeDir = undefined,
  now = new Date(),
} = {}) {
  const resolvedPath = filePath || resolveRecorderControlStatePath({ appSupportRoot, env, homeDir });
  const current = state
    ? normalizeRecorderControlState(state, { now })
    : await loadRecorderControlState({ filePath: resolvedPath, now });
  const next = transitionRecorderControlState(current, action, { now });
  return withFileLock(resolvedPath, async () => {
    await atomicWriteJson(resolvedPath, next);
    return next;
  });
}

export function transitionRecorderControlState(state = {}, action = {}, { now = new Date() } = {}) {
  const current = normalizeRecorderControlState(state, { now });
  const type = cleanToken(action.type ?? action.action);
  const timestamp = toIso(now);
  switch (type) {
    case "grant_consent":
      if (action.visibleIndicatorAcknowledged !== true && action.visible_indicator_acknowledged !== true) {
        fail(
          "ERR_RECORDER_CONTROL_VISIBLE_INDICATOR_REQUIRED",
          "recorder consent requires visible indicator acknowledgement",
        );
      }
      return normalizeRecorderControlState({
        ...current,
        mode: RECORDER_CONTROL_MODES.active,
        consent: {
          ...current.consent,
          status: "granted",
          grantedAt: timestamp,
          granted_at: timestamp,
          revokedAt: null,
          revoked_at: null,
          visibleIndicatorRequired: true,
          visible_indicator_required: true,
          visibleIndicatorAcknowledged: true,
          visible_indicator_acknowledged: true,
        },
        pause: null,
        stoppedForToday: null,
        stopped_for_today: null,
        updatedAt: timestamp,
        updated_at: timestamp,
      }, { now });
    case "revoke_consent":
      return normalizeRecorderControlState({
        ...current,
        mode: RECORDER_CONTROL_MODES.inactive,
        consent: {
          ...current.consent,
          status: "revoked",
          revokedAt: timestamp,
          revoked_at: timestamp,
        },
        pause: null,
        stoppedForToday: null,
        stopped_for_today: null,
        updatedAt: timestamp,
        updated_at: timestamp,
      }, { now });
    case "set_permission": {
      const permissionId = normalizePermissionId(action.permission ?? action.permissionId ?? action.permission_id);
      const permissionState = normalizePermissionState(action.state ?? action.status);
      return normalizeRecorderControlState({
        ...current,
        permissions: {
          ...current.permissions,
          [permissionId]: permissionState,
        },
        updatedAt: timestamp,
        updated_at: timestamp,
      }, { now });
    }
    case "set_sensitive_capture":
      assertConsentGranted(current);
      return normalizeRecorderControlState({
        ...current,
        sensitiveCapture: mergeSensitiveCapturePatch(current.sensitiveCapture, action),
        sensitive_capture: mergeSensitiveCapturePatch(current.sensitiveCapture, action),
        updatedAt: timestamp,
        updated_at: timestamp,
      }, { now });
    case "pause":
      assertConsentGranted(current);
      return normalizeRecorderControlState({
        ...current,
        mode: RECORDER_CONTROL_MODES.paused,
        pause: {
          pausedAt: timestamp,
          paused_at: timestamp,
          reason: cleanString(action.reason, 240) || "user_pause",
        },
        updatedAt: timestamp,
        updated_at: timestamp,
      }, { now });
    case "resume":
      assertConsentGranted(current);
      if (current.mode === RECORDER_CONTROL_MODES.stoppedForToday) {
        fail("ERR_RECORDER_CONTROL_STOPPED_FOR_TODAY", "recorder was stopped for today and cannot resume until a new session starts");
      }
      return normalizeRecorderControlState({
        ...current,
        mode: RECORDER_CONTROL_MODES.active,
        pause: null,
        updatedAt: timestamp,
        updated_at: timestamp,
      }, { now });
    case "stop_for_today":
      assertConsentGranted(current);
      return normalizeRecorderControlState({
        ...current,
        mode: RECORDER_CONTROL_MODES.stoppedForToday,
        pause: null,
        stoppedForToday: {
          localDate: cleanString(action.localDate ?? action.local_date, 20) || localDateKey(now),
          local_date: cleanString(action.localDate ?? action.local_date, 20) || localDateKey(now),
          stoppedAt: timestamp,
          stopped_at: timestamp,
          reason: cleanString(action.reason, 240) || "user_stop_for_today",
        },
        updatedAt: timestamp,
        updated_at: timestamp,
      }, { now });
    default:
      fail("ERR_RECORDER_CONTROL_UNKNOWN_ACTION", `unknown recorder control action: ${type || "(missing)"}`);
  }
}

export function evaluateRecorderCaptureReadiness(state = {}, { now = new Date() } = {}) {
  const normalized = normalizeRecorderControlState(state, { now });
  const blockers = [];
  const warnings = [];
  if (normalized.consent.status !== "granted") {
    blockers.push(blocker("consent_not_granted", "Core Memory consent has not been granted."));
  }
  if (normalized.consent.visibleIndicatorRequired && !normalized.consent.visibleIndicatorAcknowledged) {
    blockers.push(blocker("visible_indicator_not_acknowledged", "Recording requires a visible indicator."));
  }
  for (const permissionId of CORE_PERMISSION_IDS) {
    if (normalized.permissions[permissionId] !== "granted") {
      blockers.push(blocker(
        `${permissionToSnake(permissionId)}_missing`,
        `${permissionLabel(permissionId)} permission is required for recorder capture.`,
        { permission: permissionId, state: normalized.permissions[permissionId] },
      ));
    }
  }
  if (normalized.mode === RECORDER_CONTROL_MODES.paused) {
    blockers.push(blocker("recording_paused", "Recorder is paused by the user.", normalized.pause || {}));
  } else if (normalized.mode === RECORDER_CONTROL_MODES.stoppedForToday) {
    blockers.push(blocker("stopped_for_today", "Recorder is stopped for today.", normalized.stoppedForToday || {}));
  } else if (normalized.mode !== RECORDER_CONTROL_MODES.active) {
    blockers.push(blocker("recording_inactive", "Recorder mode is not active.", { mode: normalized.mode }));
  }

  for (const permissionId of ["inputMonitoring", "visionOcr"]) {
    if (normalized.permissions[permissionId] !== "granted") {
      warnings.push({
        id: `${permissionToSnake(permissionId)}_degraded`,
        severity: "degraded",
        message: `${permissionLabel(permissionId)} is unavailable; capture will run with less context.`,
        permission: permissionId,
        state: normalized.permissions[permissionId],
      });
    }
  }
  const expandedMedia = evaluateRecorderExpandedMediaPolicy(normalized, { now });
  warnings.push(...expandedMedia.degradedStates);

  const ready = blockers.length === 0;
  return {
    schemaVersion: RECORDER_CONTROL_SCHEMA_VERSION,
    schema_version: RECORDER_CONTROL_SCHEMA_VERSION,
    schema: "agentic30.recorder.capture_readiness.v1",
    evaluatedAt: toIso(now),
    evaluated_at: toIso(now),
    canRecord: ready,
    can_record: ready,
    state: ready ? (warnings.length ? "degraded" : "ready") : "blocked",
    mode: normalized.mode,
    blockers,
    warnings,
    visibleIndicatorRequired: normalized.consent.visibleIndicatorRequired,
    visible_indicator_required: normalized.consent.visibleIndicatorRequired,
    visibleIndicatorAcknowledged: normalized.consent.visibleIndicatorAcknowledged,
    visible_indicator_acknowledged: normalized.consent.visibleIndicatorAcknowledged,
    expandedMedia,
    expanded_media: expandedMedia,
  };
}

export function assertRecorderCaptureReady(state = {}, { now = new Date() } = {}) {
  const readiness = evaluateRecorderCaptureReadiness(state, { now });
  if (!readiness.canRecord) {
    fail("ERR_RECORDER_CONTROL_CAPTURE_BLOCKED", "recorder capture is not ready", { readiness });
  }
  return readiness;
}

export function evaluateRecorderExpandedMediaPolicy(state = {}, { now = new Date() } = {}) {
  const normalized = normalizeRecorderControlState(state, { now });
  const clipboard = clipboardPolicyDto(normalized);
  const microphone = audioPolicyDto(normalized, "microphone");
  const systemAudio = audioPolicyDto(normalized, "systemAudio");
  const browserMetadata = metadataPolicyDto(normalized, "browserMetadata");
  const documentMetadata = metadataPolicyDto(normalized, "documentMetadata");
  const degradedStates = [
    clipboard.degradedState,
    microphone.degradedState,
    systemAudio.degradedState,
    browserMetadata.degradedState,
    documentMetadata.degradedState,
  ].filter(Boolean);
  return {
    schemaVersion: RECORDER_CONTROL_SCHEMA_VERSION,
    schema_version: RECORDER_CONTROL_SCHEMA_VERSION,
    schema: "agentic30.recorder.expanded_media_policy.v1",
    evaluatedAt: toIso(now),
    evaluated_at: toIso(now),
    clipboard,
    audio: {
      microphone,
      systemAudio,
      system_audio: systemAudio,
    },
    metadata: {
      browserMetadata,
      browser_metadata: browserMetadata,
      documentMetadata,
      document_metadata: documentMetadata,
    },
    degradedStates,
    degraded_states: degradedStates,
    proofAcceptedByExpandedMediaPolicy: false,
    proof_accepted_by_expanded_media_policy: false,
  };
}

export function normalizeRecorderControlState(value = {}, { now = new Date() } = {}) {
  const raw = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const generatedAt = toIso(now);
  const permissions = {};
  const rawPermissions = raw.permissions && typeof raw.permissions === "object" ? raw.permissions : {};
  for (const permissionId of PERMISSION_IDS) {
    permissions[permissionId] = normalizePermissionState(rawPermissions[permissionId] ?? rawPermissions[permissionToSnake(permissionId)]);
  }
  return {
    schemaVersion: RECORDER_CONTROL_SCHEMA_VERSION,
    schema_version: RECORDER_CONTROL_SCHEMA_VERSION,
    schema: RECORDER_CONTROL_SCHEMA,
    updatedAt: normalizeIso(raw.updatedAt ?? raw.updated_at, generatedAt),
    updated_at: normalizeIso(raw.updatedAt ?? raw.updated_at, generatedAt),
    mode: normalizeMode(raw.mode),
    consent: normalizeConsent(raw.consent, { now }),
    permissions,
    sensitiveCapture: normalizeSensitiveCapture(raw.sensitiveCapture ?? raw.sensitive_capture),
    sensitive_capture: normalizeSensitiveCapture(raw.sensitiveCapture ?? raw.sensitive_capture),
    pause: normalizePause(raw.pause),
    stoppedForToday: normalizeStoppedForToday(raw.stoppedForToday ?? raw.stopped_for_today),
    stopped_for_today: normalizeStoppedForToday(raw.stoppedForToday ?? raw.stopped_for_today),
    degradedReasons: normalizeStringArray(raw.degradedReasons ?? raw.degraded_reasons),
    degraded_reasons: normalizeStringArray(raw.degradedReasons ?? raw.degraded_reasons),
  };
}

export function makeDefaultRecorderControlState({ now = new Date() } = {}) {
  return normalizeRecorderControlState({
    updatedAt: toIso(now),
    mode: RECORDER_CONTROL_MODES.inactive,
    consent: {
      status: "not_requested",
      visibleIndicatorRequired: true,
      visibleIndicatorAcknowledged: false,
    },
  }, { now });
}

function normalizeConsent(value = {}, { now = new Date() } = {}) {
  const raw = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const status = ["not_requested", "granted", "revoked"].includes(cleanToken(raw.status))
    ? cleanToken(raw.status)
    : "not_requested";
  return {
    status,
    grantedAt: normalizeNullableIso(raw.grantedAt ?? raw.granted_at),
    granted_at: normalizeNullableIso(raw.grantedAt ?? raw.granted_at),
    revokedAt: normalizeNullableIso(raw.revokedAt ?? raw.revoked_at),
    revoked_at: normalizeNullableIso(raw.revokedAt ?? raw.revoked_at),
    visibleIndicatorRequired: raw.visibleIndicatorRequired ?? raw.visible_indicator_required ?? true ? true : false,
    visible_indicator_required: raw.visibleIndicatorRequired ?? raw.visible_indicator_required ?? true ? true : false,
    visibleIndicatorAcknowledged: raw.visibleIndicatorAcknowledged === true || raw.visible_indicator_acknowledged === true,
    visible_indicator_acknowledged: raw.visibleIndicatorAcknowledged === true || raw.visible_indicator_acknowledged === true,
    firstSeenAt: normalizeIso(raw.firstSeenAt ?? raw.first_seen_at, toIso(now)),
    first_seen_at: normalizeIso(raw.firstSeenAt ?? raw.first_seen_at, toIso(now)),
  };
}

function normalizeSensitiveCapture(value = {}) {
  const raw = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const clipboardMode = normalizeClipboardCaptureMode(raw.clipboardMode ?? raw.clipboard_mode, {
    clipboardContents: raw.clipboardContents ?? raw.clipboard_contents,
  });
  return {
    clipboardMode,
    clipboard_mode: clipboardMode,
    clipboardContents: clipboardMode === "content_opt_in",
    clipboard_contents: clipboardMode === "content_opt_in",
    microphone: raw.microphone === true,
    systemAudio: raw.systemAudio === true || raw.system_audio === true,
    system_audio: raw.systemAudio === true || raw.system_audio === true,
  };
}

function mergeSensitiveCapturePatch(current = {}, action = {}) {
  const source = action.sensitiveCapture ?? action.sensitive_capture ?? action;
  const raw = source && typeof source === "object" && !Array.isArray(source) ? source : {};
  const patch = {
    clipboardMode: current.clipboardMode ?? current.clipboard_mode,
    microphone: current.microphone === true,
    systemAudio: current.systemAudio === true || current.system_audio === true,
  };
  if (Object.prototype.hasOwnProperty.call(raw, "clipboardMode") || Object.prototype.hasOwnProperty.call(raw, "clipboard_mode")) {
    patch.clipboardMode = raw.clipboardMode ?? raw.clipboard_mode;
  } else if (Object.prototype.hasOwnProperty.call(raw, "clipboardContents") || Object.prototype.hasOwnProperty.call(raw, "clipboard_contents")) {
    patch.clipboardMode = (raw.clipboardContents === true || raw.clipboard_contents === true)
      ? "content_opt_in"
      : "trigger_only";
  }
  if (Object.prototype.hasOwnProperty.call(raw, "microphone")) {
    patch.microphone = raw.microphone === true;
  }
  if (Object.prototype.hasOwnProperty.call(raw, "systemAudio") || Object.prototype.hasOwnProperty.call(raw, "system_audio")) {
    patch.systemAudio = raw.systemAudio === true || raw.system_audio === true;
  }
  return normalizeSensitiveCapture(patch);
}

function normalizeClipboardCaptureMode(value, { clipboardContents = false } = {}) {
  const mode = cleanToken(value);
  if (CLIPBOARD_CAPTURE_MODES.has(mode)) return mode;
  return clipboardContents === true ? "content_opt_in" : "trigger_only";
}

function clipboardPolicyDto(state) {
  const mode = state.sensitiveCapture.clipboardMode;
  const permissionState = state.permissions.clipboard;
  const permissionGranted = permissionState === "granted";
  const canCaptureTrigger = mode !== "blocked" && permissionGranted;
  const canCaptureContents = mode === "content_opt_in" && permissionGranted;
  const status = mode === "blocked"
    ? "blocked_by_policy"
    : mode === "content_opt_in"
      ? (permissionGranted ? "content_enabled" : "content_blocked_by_permission")
      : (permissionGranted ? "trigger_only" : "trigger_degraded");
  const degradedState = !permissionGranted && mode !== "blocked"
    ? {
        id: mode === "content_opt_in" ? "clipboard_contents_blocked_by_permission" : "clipboard_trigger_degraded",
        severity: "degraded",
        message: mode === "content_opt_in"
          ? "Clipboard content capture is enabled but Clipboard permission is not granted."
          : "Clipboard trigger context is unavailable; recorder capture will run without clipboard trigger context.",
        permission: "clipboard",
        state: permissionState,
        policy: mode,
      }
    : null;
  return {
    mode,
    permission: permissionState,
    status,
    canCaptureTrigger,
    can_capture_trigger: canCaptureTrigger,
    canCaptureContents,
    can_capture_contents: canCaptureContents,
    rawContentsDefault: false,
    raw_contents_default: false,
    degradedState,
    degraded_state: degradedState,
  };
}

function audioPolicyDto(state, key) {
  const enabled = state.sensitiveCapture[key] === true;
  const permissionState = state.permissions[key];
  const permissionGranted = permissionState === "granted";
  const status = !enabled
    ? "disabled_by_policy"
    : permissionGranted
      ? "enabled"
      : "blocked_by_permission";
  const degradedState = enabled && !permissionGranted
    ? {
        id: `${permissionToSnake(key)}_capture_blocked_by_permission`,
        severity: "degraded",
        message: `${permissionLabel(key)} capture is enabled but permission is not granted.`,
        permission: key,
        state: permissionState,
        policy: "opt_in_enabled",
      }
    : null;
  return {
    enabled,
    permission: permissionState,
    status,
    canCapture: enabled && permissionGranted,
    can_capture: enabled && permissionGranted,
    degradedState,
    degraded_state: degradedState,
  };
}

function metadataPolicyDto(state, permissionId) {
  const permissionState = state.permissions[permissionId];
  const available = permissionState === "granted";
  const degradedState = available
    ? null
    : {
        id: `${permissionToSnake(permissionId)}_degraded`,
        severity: "degraded",
        message: `${permissionLabel(permissionId)} is unavailable; capture will run with less context.`,
        permission: permissionId,
        state: permissionState,
      };
  return {
    permission: permissionState,
    status: available ? "available" : "degraded",
    available,
    degradedState,
    degraded_state: degradedState,
  };
}

function normalizePause(value = null) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const pausedAt = normalizeNullableIso(value.pausedAt ?? value.paused_at);
  return pausedAt
    ? {
        pausedAt,
        paused_at: pausedAt,
        reason: cleanString(value.reason, 240),
      }
    : null;
}

function normalizeStoppedForToday(value = null) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const stoppedAt = normalizeNullableIso(value.stoppedAt ?? value.stopped_at);
  const localDate = cleanString(value.localDate ?? value.local_date, 20);
  return stoppedAt && localDate
    ? {
        localDate,
        local_date: localDate,
        stoppedAt,
        stopped_at: stoppedAt,
        reason: cleanString(value.reason, 240),
      }
    : null;
}

function normalizeMode(value) {
  const mode = cleanToken(value);
  return Object.values(RECORDER_CONTROL_MODES).includes(mode) ? mode : RECORDER_CONTROL_MODES.inactive;
}

function normalizePermissionId(value) {
  const key = String(value ?? "").replace(/[^A-Za-z0-9]/g, "").toLowerCase();
  const token = PERMISSION_IDS.find((permissionId) => permissionId.toLowerCase() === key);
  if (!token) {
    fail("ERR_RECORDER_CONTROL_UNKNOWN_PERMISSION", `unknown recorder permission: ${value || "(missing)"}`);
  }
  return token;
}

function normalizePermissionState(value) {
  const token = cleanToken(value);
  return PERMISSION_STATES.has(token) ? token : "unknown";
}

function assertConsentGranted(state) {
  if (state.consent.status !== "granted") {
    fail("ERR_RECORDER_CONTROL_CONSENT_REQUIRED", "recorder control action requires granted consent");
  }
}

function blocker(id, message, details = {}) {
  return { id, severity: "blocker", message, ...details };
}

function normalizeStringArray(values = [], maxItems = 20, maxLength = 240) {
  const input = Array.isArray(values) ? values : [];
  const output = [];
  for (const value of input) {
    const text = cleanString(value, maxLength);
    if (text && !output.includes(text)) output.push(text);
    if (output.length >= maxItems) break;
  }
  return output;
}

function permissionToSnake(value) {
  return String(value).replace(/[A-Z]/g, (char) => `_${char.toLowerCase()}`);
}

function permissionLabel(value) {
  return {
    screenRecording: "Screen Recording",
    accessibility: "Accessibility",
    inputMonitoring: "Input Monitoring",
    visionOcr: "Vision OCR",
    browserMetadata: "Browser metadata",
    documentMetadata: "Document metadata",
    clipboard: "Clipboard",
    microphone: "Microphone",
    systemAudio: "System Audio",
  }[value] || value;
}

function normalizeIso(value, fallback) {
  const date = new Date(value ?? "");
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
}

function normalizeNullableIso(value) {
  const date = new Date(value ?? "");
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function toIso(value) {
  const date = value instanceof Date ? value : new Date(value ?? Date.now());
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function localDateKey(value) {
  const date = value instanceof Date ? value : new Date(value ?? Date.now());
  if (Number.isNaN(date.getTime())) return new Date().toISOString().slice(0, 10);
  return date.toISOString().slice(0, 10);
}

function cleanToken(value) {
  return String(value ?? "").trim().toLowerCase();
}

function cleanString(value, maxLength = 500) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function fail(code, message, details = {}) {
  throw new RecorderControlStateError(code, message, details);
}
