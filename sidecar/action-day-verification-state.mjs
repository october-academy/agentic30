/**
 * Action-day verification state machine.
 *
 * Pure state module: no MCP, CLI, Browser, Google, filesystem, or network IO.
 * Tool-specific verifiers call this module to record attempts and outcomes.
 */

export const ACTION_DAY_VERIFICATION_STATE_SCHEMA_VERSION = 1;

export const ACTION_VERIFICATION_STATUS = Object.freeze({
  pending: "pending",
  running: "running",
  passed: "passed",
  failed: "failed",
});

export const ACTION_VERIFICATION_METHOD = Object.freeze({
  mcp: "mcp",
  cli: "cli",
  browser: "browser",
  googleDocs: "google_docs",
  googleSheets: "google_sheets",
  evidenceLink: "evidence_link",
  evidenceFile: "evidence_file",
  manual: "manual",
});

const TERMINAL_STATUSES = new Set([
  ACTION_VERIFICATION_STATUS.passed,
  ACTION_VERIFICATION_STATUS.failed,
]);

const KNOWN_METHODS = new Set(Object.values(ACTION_VERIFICATION_METHOD));
const MAX_TEXT_CHARS = 4000;

export function createActionDayVerificationState({
  dayId,
  actionId = null,
  actionDescription = "",
  completionSignal = "",
  preferredMethods = [],
  now = () => new Date(),
} = {}) {
  const createdAt = nowIso(now);
  return {
    schemaVersion: ACTION_DAY_VERIFICATION_STATE_SCHEMA_VERSION,
    dayId: normalizeDayId(dayId),
    actionId: normalizeNullableString(actionId),
    actionDescription: trimText(actionDescription),
    completionSignal: trimText(completionSignal),
    preferredMethods: normalizeMethods(preferredMethods),
    status: ACTION_VERIFICATION_STATUS.pending,
    createdAt,
    updatedAt: createdAt,
    startedAt: null,
    completedAt: null,
    attemptCount: 0,
    retryCount: 0,
    currentAttempt: null,
    verificationResult: null,
    evidenceSubmission: null,
    history: [],
  };
}

export function ensureActionDayVerificationState(input, { now = () => new Date() } = {}) {
  if (!input || typeof input !== "object") {
    return createActionDayVerificationState({ now });
  }

  const status = normalizeStatus(input.status);
  const history = Array.isArray(input.history)
    ? input.history.filter((entry) => entry && typeof entry === "object").map(normalizeHistoryEntry)
    : [];
  const currentAttempt = normalizeAttempt(input.currentAttempt);
  const attemptCount = normalizeNonNegativeInteger(input.attemptCount, history.length);
  const retryCount = normalizeNonNegativeInteger(input.retryCount, 0);
  const createdAt = normalizeIsoString(input.createdAt) || nowIso(now);
  const updatedAt = normalizeIsoString(input.updatedAt) || createdAt;

  return {
    schemaVersion: ACTION_DAY_VERIFICATION_STATE_SCHEMA_VERSION,
    dayId: normalizeDayId(input.dayId),
    actionId: normalizeNullableString(input.actionId),
    actionDescription: trimText(input.actionDescription),
    completionSignal: trimText(input.completionSignal),
    preferredMethods: normalizeMethods(input.preferredMethods),
    status,
    createdAt,
    updatedAt,
    startedAt: normalizeIsoString(input.startedAt),
    completedAt: normalizeIsoString(input.completedAt),
    attemptCount,
    retryCount,
    currentAttempt: status === ACTION_VERIFICATION_STATUS.running ? currentAttempt : null,
    verificationResult: normalizeVerificationResult(input.verificationResult),
    evidenceSubmission: normalizeEvidenceSubmission(input.evidenceSubmission),
    history,
  };
}

export function startActionVerification(
  inputState,
  {
    method = ACTION_VERIFICATION_METHOD.manual,
    verifier = "",
    evidenceSubmission = null,
    metadata = {},
    now = () => new Date(),
  } = {},
) {
  const state = ensureActionDayVerificationState(inputState, { now });
  assertCanStart(state);

  const timestamp = nowIso(now);
  const attemptNumber = state.attemptCount + 1;
  const normalizedMethod = normalizeMethod(method);
  const attempt = {
    attemptNumber,
    method: normalizedMethod,
    verifier: trimText(verifier),
    status: ACTION_VERIFICATION_STATUS.running,
    startedAt: timestamp,
    completedAt: null,
    result: null,
    metadata: normalizePlainObject(metadata),
  };

  return {
    ...state,
    status: ACTION_VERIFICATION_STATUS.running,
    updatedAt: timestamp,
    startedAt: state.startedAt || timestamp,
    completedAt: null,
    attemptCount: attemptNumber,
    currentAttempt: attempt,
    evidenceSubmission: evidenceSubmission
      ? normalizeEvidenceSubmission(evidenceSubmission)
      : state.evidenceSubmission,
    history: state.history.concat(attempt),
  };
}

export function passActionVerification(
  inputState,
  {
    method = null,
    confidence = 1,
    agentAssessment = "",
    evidenceSubmission = null,
    raw = {},
    now = () => new Date(),
  } = {},
) {
  return completeActionVerification(inputState, {
    passed: true,
    method,
    confidence,
    agentAssessment,
    evidenceSubmission,
    raw,
    now,
  });
}

export function failActionVerification(
  inputState,
  {
    method = null,
    reason = "",
    agentAssessment = "",
    evidenceSubmission = null,
    raw = {},
    now = () => new Date(),
  } = {},
) {
  return completeActionVerification(inputState, {
    passed: false,
    method,
    reason,
    agentAssessment,
    evidenceSubmission,
    raw,
    now,
  });
}

export function retryActionVerification(
  inputState,
  {
    reason = "",
    nextMethod = null,
    evidenceSubmission = null,
    now = () => new Date(),
  } = {},
) {
  const state = ensureActionDayVerificationState(inputState, { now });
  if (!TERMINAL_STATUSES.has(state.status)) {
    throw new Error(`Cannot retry action verification from ${state.status}`);
  }

  const timestamp = nowIso(now);
  const retryEvent = {
    attemptNumber: state.attemptCount,
    method: nextMethod ? normalizeMethod(nextMethod) : null,
    verifier: "",
    status: "retry",
    startedAt: timestamp,
    completedAt: timestamp,
    result: {
      passed: false,
      reason: trimText(reason),
      agentAssessment: "",
    },
    metadata: {},
  };

  return {
    ...state,
    status: ACTION_VERIFICATION_STATUS.pending,
    updatedAt: timestamp,
    completedAt: null,
    retryCount: state.retryCount + 1,
    currentAttempt: null,
    verificationResult: null,
    evidenceSubmission: evidenceSubmission
      ? normalizeEvidenceSubmission(evidenceSubmission)
      : state.evidenceSubmission,
    preferredMethods: nextMethod
      ? [normalizeMethod(nextMethod), ...state.preferredMethods.filter((item) => item !== normalizeMethod(nextMethod))]
      : state.preferredMethods,
    history: state.history.concat(retryEvent),
  };
}

export function isActionVerificationPending(state) {
  return ensureActionDayVerificationState(state).status === ACTION_VERIFICATION_STATUS.pending;
}

export function isActionVerificationRunning(state) {
  return ensureActionDayVerificationState(state).status === ACTION_VERIFICATION_STATUS.running;
}

export function isActionVerificationPassed(state) {
  return ensureActionDayVerificationState(state).status === ACTION_VERIFICATION_STATUS.passed;
}

export function isActionVerificationFailed(state) {
  return ensureActionDayVerificationState(state).status === ACTION_VERIFICATION_STATUS.failed;
}

function completeActionVerification(
  inputState,
  {
    passed,
    method = null,
    confidence = 0,
    reason = "",
    agentAssessment = "",
    evidenceSubmission = null,
    raw = {},
    now = () => new Date(),
  } = {},
) {
  const state = ensureActionDayVerificationState(inputState, { now });
  if (state.status !== ACTION_VERIFICATION_STATUS.running || !state.currentAttempt) {
    throw new Error(`Cannot complete action verification from ${state.status}`);
  }

  const timestamp = nowIso(now);
  const result = {
    method: method ? normalizeMethod(method) : state.currentAttempt.method,
    passed: Boolean(passed),
    outcome: trimText(raw?.outcome || (passed ? "verified" : "failed")),
    confidence: clampNumber(confidence, 0, 1),
    reason: trimText(reason),
    agentAssessment: trimText(agentAssessment),
    raw: normalizePlainObject(raw),
    completedAt: timestamp,
  };
  const status = result.passed
    ? ACTION_VERIFICATION_STATUS.passed
    : ACTION_VERIFICATION_STATUS.failed;
  const completedAttempt = {
    ...state.currentAttempt,
    status,
    completedAt: timestamp,
    result,
  };

  return {
    ...state,
    status,
    updatedAt: timestamp,
    completedAt: timestamp,
    currentAttempt: null,
    verificationResult: result,
    evidenceSubmission: evidenceSubmission
      ? normalizeEvidenceSubmission(evidenceSubmission)
      : state.evidenceSubmission,
    history: replaceLastRunningAttempt(state.history, completedAttempt),
  };
}

function assertCanStart(state) {
  if (state.status === ACTION_VERIFICATION_STATUS.pending) {
    return;
  }
  if (state.status === ACTION_VERIFICATION_STATUS.running) {
    throw new Error("Cannot start action verification while another attempt is running");
  }
  throw new Error(`Cannot start action verification from ${state.status}; retry first`);
}

function replaceLastRunningAttempt(history, completedAttempt) {
  const next = history.slice();
  for (let index = next.length - 1; index >= 0; index -= 1) {
    const entry = next[index];
    if (
      entry?.status === ACTION_VERIFICATION_STATUS.running
      && entry?.attemptNumber === completedAttempt.attemptNumber
    ) {
      next[index] = completedAttempt;
      return next;
    }
  }
  return next.concat(completedAttempt);
}

function normalizeHistoryEntry(entry) {
  return {
    attemptNumber: normalizeNonNegativeInteger(entry.attemptNumber, 0),
    method: entry.method ? normalizeMethod(entry.method) : null,
    verifier: trimText(entry.verifier),
    status: typeof entry.status === "string" ? entry.status : ACTION_VERIFICATION_STATUS.pending,
    startedAt: normalizeIsoString(entry.startedAt),
    completedAt: normalizeIsoString(entry.completedAt),
    result: normalizeVerificationResult(entry.result),
    metadata: normalizePlainObject(entry.metadata),
  };
}

function normalizeAttempt(input) {
  if (!input || typeof input !== "object") return null;
  return normalizeHistoryEntry(input);
}

function normalizeVerificationResult(input) {
  if (!input || typeof input !== "object") return null;
  return {
    method: input.method ? normalizeMethod(input.method) : ACTION_VERIFICATION_METHOD.manual,
    passed: Boolean(input.passed),
    outcome: trimText(input.outcome || input.raw?.outcome || (input.passed ? "verified" : "failed")),
    confidence: clampNumber(input.confidence, 0, 1),
    reason: trimText(input.reason),
    agentAssessment: trimText(input.agentAssessment),
    raw: normalizePlainObject(input.raw),
    completedAt: normalizeIsoString(input.completedAt),
  };
}

function normalizeEvidenceSubmission(input) {
  if (!input || typeof input !== "object") return null;
  const type = String(input.type || "").trim();
  const normalizedType = type === "file" ? "file" : type === "link" ? "link" : "unknown";
  return {
    type: normalizedType,
    content: trimText(input.content),
    submittedAt: normalizeIsoString(input.submittedAt),
    validationStatus: trimText(input.validationStatus || "pending"),
  };
}

function normalizeStatus(status) {
  return Object.values(ACTION_VERIFICATION_STATUS).includes(status)
    ? status
    : ACTION_VERIFICATION_STATUS.pending;
}

function normalizeMethod(method) {
  const value = String(method || "").trim();
  return KNOWN_METHODS.has(value) ? value : ACTION_VERIFICATION_METHOD.manual;
}

function normalizeMethods(methods) {
  if (!Array.isArray(methods)) return [];
  return [...new Set(methods.map(normalizeMethod))];
}

function normalizeDayId(dayId) {
  const value = Number(dayId);
  return Number.isInteger(value) && value >= 1 && value <= 30 ? value : null;
}

function normalizeNullableString(value) {
  const text = trimText(value);
  return text ? text : null;
}

function normalizeIsoString(value) {
  return typeof value === "string" && value.trim() ? value : null;
}

function normalizeNonNegativeInteger(value, fallback) {
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : fallback;
}

function normalizePlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return { ...value };
}

function trimText(value) {
  return String(value || "").trim().slice(0, MAX_TEXT_CHARS);
}

function clampNumber(value, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return min;
  return Math.min(max, Math.max(min, numeric));
}

function nowIso(now) {
  const value = typeof now === "function" ? now() : now;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}
