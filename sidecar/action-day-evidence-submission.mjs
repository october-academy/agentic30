import {
  ACTION_VERIFICATION_METHOD,
  ACTION_VERIFICATION_STATUS,
  failActionVerification,
  passActionVerification,
  retryActionVerification,
  startActionVerification,
} from "./action-day-verification-state.mjs";

export const ACTION_EVIDENCE_SUBMISSION_STATUS = Object.freeze({
  invalid: "invalid",
  blocked: "blocked",
  submitted: "submitted",
  accepted: "accepted",
  rejected: "rejected",
});

export const ACTION_EVIDENCE_SUBMISSION_COMPONENT_SCHEMA_VERSION = 1;
export const ACTION_EVIDENCE_SUBMISSION_EVENT_TYPE = "submit_action_evidence";

export const ACTION_EVIDENCE_TYPE = Object.freeze({
  link: "link",
  file: "file",
});

export const ACTION_EVIDENCE_INPUT_MODE = Object.freeze({
  link: "link",
  fileUpload: "file_upload",
});

const MAX_CONTENT_CHARS = 4000;
const MAX_NOTE_CHARS = 1000;
const FILE_PATH_PATTERN = /^(\/|~\/|\.{1,2}\/|[A-Za-z0-9_. -]+\/)[^\0]+$/;

const LINK_ACTION_TYPES = new Set([
  "bip_post",
  "build_in_public",
  "community",
  "community_post",
  "dm_log",
  "google_doc",
  "google_docs",
  "google_sheet",
  "google_sheets",
  "landing",
  "landing_page",
  "outreach_tracker",
  "post",
  "public_post",
  "public_proof",
  "sheet",
  "social",
  "sns",
  "sns_post",
  "thread",
  "threads",
  "tracker",
  "url",
  "website",
]);

const FILE_ACTION_TYPES = new Set([
  "audio",
  "checklist",
  "demo_asset",
  "document",
  "evidence_log",
  "file",
  "image",
  "interview_recording",
  "interview_transcript",
  "journal",
  "log",
  "memo",
  "meeting_recording",
  "meeting_transcript",
  "note",
  "observation_note",
  "recording",
  "screen_recording",
  "screenshot",
  "script",
  "transcript",
  "video",
  "voice_recording",
  "voice_transcription",
  "worksheet",
]);

const LINK_KEYWORDS = [
  "http://",
  "https://",
  "public url",
  "shareable url",
  "landing page",
  "public post",
  "proof post",
  "community post",
  "threads",
  "social post",
  "google doc",
  "google sheet",
  "sheet url",
  "doc url",
];

const FILE_KEYWORDS = [
  ".md",
  ".txt",
  ".pdf",
  ".png",
  ".jpg",
  ".jpeg",
  ".mov",
  ".mp4",
  ".m4a",
  ".wav",
  "file path",
  "upload",
  "recording",
  "transcript",
  "screenshot",
  "screen recording",
  "audio",
  "local file",
  "memo file",
];

export function resolveActionEvidenceInputMode(actionSpec = {}, {
  actionType = "",
  expectedEvidenceTypes = null,
} = {}) {
  const spec = normalizeActionSpec(actionSpec);
  const explicit = normalizeEvidenceTypes(
    expectedEvidenceTypes
      ?? spec.expectedEvidenceTypes
      ?? spec.expected_evidence_types
      ?? spec.evidenceTypes
      ?? spec.evidence_types
      ?? spec.allowedEvidenceTypes
      ?? spec.allowed_evidence_types
      ?? spec.evidenceType
      ?? spec.evidence_type
      ?? spec.evidenceInputMode
      ?? spec.evidence_input_mode
      ?? spec.inputMode
      ?? spec.input_mode
  );
  if (explicit.length > 0) {
    const evidenceType = explicit[0];
    return makeEvidenceModeResolution({
      evidenceType,
      allowedTypes: explicit,
      actionType: normalizeActionType(actionType || getActionSpecType(spec)),
      source: "explicit",
    });
  }

  const normalizedActionType = normalizeActionType(actionType || getActionSpecType(spec));
  if (LINK_ACTION_TYPES.has(normalizedActionType)) {
    return makeEvidenceModeResolution({
      evidenceType: ACTION_EVIDENCE_TYPE.link,
      allowedTypes: [ACTION_EVIDENCE_TYPE.link],
      actionType: normalizedActionType,
      source: "action_type",
    });
  }
  if (FILE_ACTION_TYPES.has(normalizedActionType)) {
    return makeEvidenceModeResolution({
      evidenceType: ACTION_EVIDENCE_TYPE.file,
      allowedTypes: [ACTION_EVIDENCE_TYPE.file],
      actionType: normalizedActionType,
      source: "action_type",
    });
  }

  const verificationEvidenceType = inferEvidenceTypeFromVerification(spec);
  if (verificationEvidenceType) {
    return makeEvidenceModeResolution({
      evidenceType: verificationEvidenceType,
      allowedTypes: [verificationEvidenceType],
      actionType: normalizedActionType,
      source: "verification_method",
    });
  }

  const keywordEvidenceType = inferEvidenceTypeFromSpecText(spec);
  if (keywordEvidenceType) {
    return makeEvidenceModeResolution({
      evidenceType: keywordEvidenceType,
      allowedTypes: [keywordEvidenceType],
      actionType: normalizedActionType,
      source: "spec_text",
    });
  }

  return makeEvidenceModeResolution({
    evidenceType: ACTION_EVIDENCE_TYPE.link,
    allowedTypes: [ACTION_EVIDENCE_TYPE.link, ACTION_EVIDENCE_TYPE.file],
    actionType: normalizedActionType,
    source: "default",
  });
}

export function validateActionEvidenceSubmission(input = {}, {
  actionType = "",
  actionSpec = {},
  expectedEvidenceTypes = null,
} = {}) {
  const evidence = normalizeActionEvidenceSubmission(input);
  const evidenceMode = resolveActionEvidenceInputMode(actionSpec, {
    actionType,
    expectedEvidenceTypes,
  });
  const allowedTypes = evidenceMode.allowedTypes;
  const errors = [];

  if (!allowedTypes.includes(evidence.type)) {
    errors.push(`Evidence type must be ${allowedTypes.join(" or ")}`);
  }
  if (!evidence.content) {
    errors.push("Evidence content is required");
  } else if (evidence.type === ACTION_EVIDENCE_TYPE.link && !isHttpUrl(evidence.content)) {
    errors.push("Link evidence must be an http(s) URL");
  } else if (evidence.type === ACTION_EVIDENCE_TYPE.file && !looksLikeFilePath(evidence.content)) {
    errors.push("File evidence must be a local file path");
  }

  return {
    valid: errors.length === 0,
    errors,
    evidence: {
      ...evidence,
      validationStatus: errors.length === 0 ? "valid" : "invalid",
    },
    evidenceMode,
    allowedTypes,
  };
}

export function submitActionEvidence(inputState, input = {}, {
  actionType = "",
  actionSpec = {},
  expectedEvidenceTypes = null,
  verifier = "evidence-submission",
  metadata = {},
  now = () => new Date(),
} = {}) {
  const evidenceGate = getActionEvidenceSubmissionView(inputState);
  if (!evidenceGate.canSubmitEvidence) {
    return {
      status: ACTION_EVIDENCE_SUBMISSION_STATUS.blocked,
      reason: evidenceGate.gateReason,
      validation: null,
      state: inputState,
    };
  }

  const validation = validateActionEvidenceSubmission(input, {
    actionType,
    actionSpec,
    expectedEvidenceTypes,
  });

  if (!validation.valid) {
    return {
      status: ACTION_EVIDENCE_SUBMISSION_STATUS.invalid,
      validation,
      state: inputState,
    };
  }

  const method = methodForEvidenceType(validation.evidence.type);
  const startState = String(inputState?.status || ACTION_VERIFICATION_STATUS.pending) === ACTION_VERIFICATION_STATUS.failed
    ? retryActionVerification(inputState, {
      reason: "Submitting fallback evidence after auto-verification completed.",
      nextMethod: method,
      evidenceSubmission: validation.evidence,
      now,
    })
    : inputState;
  const state = startActionVerification(startState, {
    method,
    verifier,
    evidenceSubmission: validation.evidence,
    metadata: {
      ...normalizePlainObject(metadata),
      actionType: String(actionType || "").trim(),
      evidenceType: validation.evidence.type,
    },
    now,
  });

  return {
    status: ACTION_EVIDENCE_SUBMISSION_STATUS.submitted,
    validation,
    state,
  };
}

export function submitActionEvidenceComponentPayload(inputState, payload = {}, {
  actionType = "",
  actionSpec = {},
  expectedEvidenceTypes = null,
  verifier = "evidence-submission",
  metadata = {},
  component = null,
  now = () => new Date(),
} = {}) {
  const normalized = normalizeActionEvidenceComponentPayload(payload, {
    component,
    actionType,
    actionSpec,
    expectedEvidenceTypes,
  });

  if (!normalized.valid) {
    return {
      status: ACTION_EVIDENCE_SUBMISSION_STATUS.invalid,
      validation: normalized.validation,
      state: inputState,
    };
  }

  return submitActionEvidence(inputState, normalized.evidence, {
    actionType,
    actionSpec,
    expectedEvidenceTypes,
    verifier,
    metadata: {
      ...normalizePlainObject(metadata),
      requestId: normalized.requestId,
      sessionId: normalized.sessionId,
      componentType: "curriculum_action_evidence_submission",
      componentSchemaVersion: ACTION_EVIDENCE_SUBMISSION_COMPONENT_SCHEMA_VERSION,
      evidenceNote: normalized.evidence.note,
    },
    now,
  });
}

export function normalizeActionEvidenceComponentPayload(payload = {}, {
  component = null,
  actionType = "",
  actionSpec = {},
  expectedEvidenceTypes = null,
} = {}) {
  const evidenceMode = component?.evidenceMode
    ?? resolveActionEvidenceInputMode(actionSpec, {
      actionType,
      expectedEvidenceTypes,
    });
  const errors = [];
  const requestId = trimText(payload.requestId ?? payload.request_id, 200);
  const sessionId = trimText(payload.sessionId ?? payload.session_id, 200);

  if (component?.requestId && requestId && requestId !== component.requestId) {
    errors.push("Evidence payload requestId does not match the active component");
  }
  if (component?.sessionId && sessionId && sessionId !== component.sessionId) {
    errors.push("Evidence payload sessionId does not match the active component");
  }

  const evidenceType = normalizeComponentEvidenceType(payload, evidenceMode);
  const evidence = {
    type: evidenceType,
    content: evidenceType === ACTION_EVIDENCE_TYPE.file
      ? normalizeEvidenceFileContent(payload)
      : trimText(payload.evidenceUrl ?? payload.url ?? payload.link ?? payload.content),
    note: trimText(payload.evidenceNote ?? payload.note, MAX_NOTE_CHARS),
    submittedAt: normalizeSubmittedAt(payload.submittedAt ?? payload.submitted_at),
  };
  const validation = validateActionEvidenceSubmission(evidence, {
    actionType,
    actionSpec,
    expectedEvidenceTypes: evidenceMode.allowedTypes,
  });

  if (!validation.valid) {
    errors.push(...validation.errors);
  }

  const mergedValidation = {
    ...validation,
    valid: errors.length === 0,
    errors,
    evidence: {
      ...validation.evidence,
      validationStatus: errors.length === 0 ? "valid" : "invalid",
    },
  };

  return {
    valid: errors.length === 0,
    errors,
    requestId,
    sessionId,
    evidence: mergedValidation.evidence,
    validation: mergedValidation,
    evidenceMode,
  };
}

export function acceptActionEvidence(inputState, {
  agentAssessment = "Evidence matches the action completion signal.",
  confidence = 0.8,
  raw = {},
  now = () => new Date(),
} = {}) {
  const state = passActionVerification(inputState, {
    confidence,
    agentAssessment,
    raw,
    now,
  });

  return {
    status: ACTION_EVIDENCE_SUBMISSION_STATUS.accepted,
    state: markEvidenceValidationStatus(state, "accepted"),
  };
}

export function rejectActionEvidence(inputState, {
  reason = "Evidence does not satisfy the action completion signal.",
  agentAssessment = "",
  raw = {},
  now = () => new Date(),
} = {}) {
  const state = failActionVerification(inputState, {
    reason,
    agentAssessment,
    raw,
    now,
  });

  return {
    status: ACTION_EVIDENCE_SUBMISSION_STATUS.rejected,
    state: markEvidenceValidationStatus(state, "rejected"),
  };
}

export function getActionEvidenceSubmissionView(state = {}) {
  const status = String(state?.status || ACTION_VERIFICATION_STATUS.pending);
  const evidenceSubmission = state?.evidenceSubmission ?? null;
  const autoVerification = getAutoVerificationGate(state);
  const cliAutoVerification = getCliAutoVerificationGate(state);
  const browserAutoVerification = getBrowserAutoVerificationGate(state);
  const configuredMcpVerification = getConfiguredMcpVerificationGate(state);
  const autoFallbackSatisfied = !autoVerification.required
    || browserAutoVerification.nonVerifiedOutcomeReturned;
  const canSubmitEvidence = (status === ACTION_VERIFICATION_STATUS.failed && autoFallbackSatisfied)
    || (
      status === ACTION_VERIFICATION_STATUS.pending
      && !autoVerification.required
    );
  const gateReason = canSubmitEvidence
    ? ""
    : evidenceGateReason(status, autoVerification, cliAutoVerification, browserAutoVerification);

  return {
    status,
    evidenceSubmission,
    canSubmitEvidence,
    autoVerificationRequired: autoVerification.required,
    autoVerificationCompleted: autoVerification.completed,
    cliAutoVerificationRequired: cliAutoVerification.required,
    cliAutoVerificationCompleted: cliAutoVerification.completed,
    cliAutoVerificationNonVerifiedOutcomeReturned: cliAutoVerification.nonVerifiedOutcomeReturned,
    browserAutoVerificationRequired: browserAutoVerification.required,
    browserAutoVerificationCompleted: browserAutoVerification.completed,
    browserAutoVerificationNonVerifiedOutcomeReturned: browserAutoVerification.nonVerifiedOutcomeReturned,
    configuredMcpVerificationRequired: configuredMcpVerification.required,
    configuredMcpVerificationCompleted: configuredMcpVerification.completed,
    configuredMcpInsufficientEvidenceReturned: configuredMcpVerification.insufficientEvidenceReturned,
    gateReason,
    isSubmitted: status === ACTION_VERIFICATION_STATUS.running,
    isAccepted: status === ACTION_VERIFICATION_STATUS.passed,
    isRejected: status === ACTION_VERIFICATION_STATUS.failed,
    latestAssessment: state?.verificationResult?.agentAssessment || "",
    latestReason: state?.verificationResult?.reason || "",
  };
}

export function renderActionEvidenceSubmissionComponent({
  state = {},
  actionSpec = {},
  actionType = "",
  expectedEvidenceTypes = null,
  requestId = null,
  sessionId = null,
  now = new Date(),
} = {}) {
  const evidenceMode = resolveActionEvidenceInputMode(actionSpec, {
    actionType,
    expectedEvidenceTypes,
  });
  const view = getActionEvidenceSubmissionView(state);
  const fields = buildEvidenceInputFields(evidenceMode, view);

  return {
    schemaVersion: ACTION_EVIDENCE_SUBMISSION_COMPONENT_SCHEMA_VERSION,
    componentType: "curriculum_action_evidence_submission",
    requestId: requestId || null,
    sessionId: sessionId || null,
    createdAt: toIso(now),
    mode: evidenceMode.mode,
    evidenceType: evidenceMode.evidenceType,
    allowedTypes: evidenceMode.allowedTypes,
    acceptsLink: evidenceMode.acceptsLink,
    acceptsFileUpload: evidenceMode.acceptsFileUpload,
    evidenceMode,
    view,
    fields,
    primaryField: fields[0] ?? null,
    submitAction: buildEvidenceSubmitAction({
      requestId,
      sessionId,
      evidenceMode,
      view,
    }),
    card: {
      layout: "action_evidence_submission",
      tone: "friendly_senior",
      state: view.canSubmitEvidence ? "ready" : "gated",
      title: "실행 증거 제출",
      helperText: view.canSubmitEvidence
        ? "자동 확인이 안 되면 실행 증거를 붙여주세요."
        : view.gateReason,
      ctaText: evidenceMode.mode === ACTION_EVIDENCE_INPUT_MODE.fileUpload
        ? "파일 증거 제출"
        : "링크 증거 제출",
      fields: fields.map(({ id, type, evidenceType, label, placeholder, required, disabled }) => ({
        id,
        type,
        evidenceType,
        label,
        placeholder,
        required,
        disabled,
      })),
    },
  };
}

function buildEvidenceSubmitAction({
  requestId = null,
  sessionId = null,
  evidenceMode,
  view,
}) {
  return {
    type: ACTION_EVIDENCE_SUBMISSION_EVENT_TYPE,
    componentType: "curriculum_action_evidence_submission",
    schemaVersion: ACTION_EVIDENCE_SUBMISSION_COMPONENT_SCHEMA_VERSION,
    requestId: requestId || null,
    sessionId: sessionId || null,
    enabled: view.canSubmitEvidence,
    evidenceType: evidenceMode.evidenceType,
    allowedTypes: evidenceMode.allowedTypes,
    fieldNames: {
      link: evidenceMode.acceptsLink ? "evidenceUrl" : null,
      file: evidenceMode.acceptsFileUpload ? "evidenceFile" : null,
      note: "evidenceNote",
    },
    requiredPayloadKeys: evidenceMode.evidenceType === ACTION_EVIDENCE_TYPE.file
      ? ["evidenceFile"]
      : ["evidenceUrl"],
  };
}

function getAutoVerificationGate(state = {}) {
  const preferredMethods = Array.isArray(state?.preferredMethods) ? state.preferredMethods : [];
  const required = preferredMethods.some(isAutoVerificationMethod);
  const history = Array.isArray(state?.history) ? state.history : [];
  const completed = history.some((entry) =>
    isAutoVerificationMethod(entry?.method)
    && (
      entry?.status === ACTION_VERIFICATION_STATUS.passed
      || entry?.status === ACTION_VERIFICATION_STATUS.failed
    )
  );

  return { required, completed };
}

function getCliAutoVerificationGate(state = {}) {
  const preferredMethods = Array.isArray(state?.preferredMethods) ? state.preferredMethods : [];
  const required = preferredMethods.includes(ACTION_VERIFICATION_METHOD.cli);
  const history = Array.isArray(state?.history) ? state.history : [];
  const completed = history.some((entry) =>
    entry?.method === ACTION_VERIFICATION_METHOD.cli
    && (
      entry?.status === ACTION_VERIFICATION_STATUS.passed
      || entry?.status === ACTION_VERIFICATION_STATUS.failed
    )
  );
  const nonVerifiedOutcomeReturned = history.some((entry) =>
    entry?.method === ACTION_VERIFICATION_METHOD.cli
    && entry?.status === ACTION_VERIFICATION_STATUS.failed
    && entry?.result?.passed === false
    && entry?.result?.outcome !== "verified"
  );

  return { required, completed, nonVerifiedOutcomeReturned };
}

function getBrowserAutoVerificationGate(state = {}) {
  const preferredMethods = Array.isArray(state?.preferredMethods) ? state.preferredMethods : [];
  const history = Array.isArray(state?.history) ? state.history : [];
  const browserAttempted = history.some((entry) => entry?.method === ACTION_VERIFICATION_METHOD.browser);
  const required = preferredMethods.includes(ACTION_VERIFICATION_METHOD.browser) || browserAttempted;
  const completed = history.some((entry) =>
    entry?.method === ACTION_VERIFICATION_METHOD.browser
    && (
      entry?.status === ACTION_VERIFICATION_STATUS.passed
      || entry?.status === ACTION_VERIFICATION_STATUS.failed
    )
  );
  const nonVerifiedOutcomeReturned = history.some((entry) =>
    entry?.method === ACTION_VERIFICATION_METHOD.browser
    && entry?.status === ACTION_VERIFICATION_STATUS.failed
    && entry?.result?.passed === false
  );

  return { required, completed, nonVerifiedOutcomeReturned };
}

function getConfiguredMcpVerificationGate(state = {}) {
  const preferredMethods = Array.isArray(state?.preferredMethods) ? state.preferredMethods : [];
  const required = preferredMethods.some(isConfiguredMcpVerificationMethod);
  const history = Array.isArray(state?.history) ? state.history : [];
  const completed = history.some((entry) =>
    isConfiguredMcpVerificationMethod(entry?.method)
    && (
      entry?.status === ACTION_VERIFICATION_STATUS.passed
      || entry?.status === ACTION_VERIFICATION_STATUS.failed
    )
  );
  const insufficientEvidenceReturned = history.some((entry) =>
    isConfiguredMcpVerificationMethod(entry?.method)
    && entry?.status === ACTION_VERIFICATION_STATUS.failed
    && entry?.result?.passed === false
  );

  return { required, completed, insufficientEvidenceReturned };
}

function evidenceGateReason(status, autoVerification, cliAutoVerification, browserAutoVerification) {
  if (status === ACTION_VERIFICATION_STATUS.running) {
    return "Auto-verification is still running. Evidence fallback unlocks after it completes.";
  }
  if (status === ACTION_VERIFICATION_STATUS.passed) {
    return "Auto-verification already confirmed the action.";
  }
  if (autoVerification.required && !browserAutoVerification.nonVerifiedOutcomeReturned) {
    return "Browser Tool auto-verification is required before requesting fallback evidence.";
  }
  if (cliAutoVerification.required && !cliAutoVerification.nonVerifiedOutcomeReturned) {
    return cliAutoVerification.completed
      ? "CLI auto-verification already verified the action."
      : "Run CLI auto-verification before submitting fallback evidence.";
  }
  if (status === ACTION_VERIFICATION_STATUS.pending && autoVerification.required && !autoVerification.completed) {
    return "Run auto-verification before submitting fallback evidence.";
  }
  return "Evidence submission is not available for the current verification state.";
}

function buildEvidenceInputFields(evidenceMode, view) {
  const disabled = !view.canSubmitEvidence;
  const fields = [];

  if (evidenceMode.acceptsLink) {
    fields.push({
      id: "evidence-link",
      kind: "input",
      type: "url",
      inputMode: ACTION_EVIDENCE_INPUT_MODE.link,
      evidenceType: ACTION_EVIDENCE_TYPE.link,
      name: "evidenceUrl",
      label: "증거 링크",
      placeholder: "https://example.com/proof",
      required: evidenceMode.evidenceType === ACTION_EVIDENCE_TYPE.link,
      disabled,
      validation: {
        required: true,
        pattern: "^https?://",
        message: "http(s) 링크를 넣어주세요.",
      },
    });
  }

  if (evidenceMode.acceptsFileUpload) {
    fields.push({
      id: "evidence-file",
      kind: "input",
      control: "file_upload",
      type: "file",
      inputMode: ACTION_EVIDENCE_INPUT_MODE.fileUpload,
      evidenceType: ACTION_EVIDENCE_TYPE.file,
      name: "evidenceFile",
      label: "증거 파일",
      placeholder: "",
      required: evidenceMode.evidenceType === ACTION_EVIDENCE_TYPE.file,
      disabled,
      multiple: false,
      accept: [
        "audio/*",
        "image/*",
        "video/*",
        ".md",
        ".pdf",
        ".txt",
      ],
      validation: {
        required: true,
        message: "로컬 파일을 첨부해주세요.",
      },
    });
  }

  fields.push({
    id: "evidence-note",
    kind: "textarea",
    type: "textarea",
    inputMode: "note",
    evidenceType: null,
    name: "evidenceNote",
    label: "메모",
    placeholder: "확인해야 할 위치나 맥락을 짧게 적어주세요.",
    required: false,
    disabled,
    maxLength: MAX_NOTE_CHARS,
  });

  return fields;
}

function isAutoVerificationMethod(method) {
  return [
    ACTION_VERIFICATION_METHOD.mcp,
    ACTION_VERIFICATION_METHOD.cli,
    ACTION_VERIFICATION_METHOD.browser,
    ACTION_VERIFICATION_METHOD.googleDocs,
    ACTION_VERIFICATION_METHOD.googleSheets,
  ].includes(method);
}

function isConfiguredMcpVerificationMethod(method) {
  return [
    ACTION_VERIFICATION_METHOD.mcp,
    ACTION_VERIFICATION_METHOD.googleDocs,
    ACTION_VERIFICATION_METHOD.googleSheets,
  ].includes(method);
}

function normalizeActionEvidenceSubmission(input = {}) {
  const type = String(input.type || "").trim().toLowerCase();
  return {
    type: type === ACTION_EVIDENCE_TYPE.file ? ACTION_EVIDENCE_TYPE.file : ACTION_EVIDENCE_TYPE.link,
    content: trimText(input.content),
    note: trimText(input.note, MAX_NOTE_CHARS),
    submittedAt: normalizeSubmittedAt(input.submittedAt),
    validationStatus: "pending",
  };
}

function normalizeComponentEvidenceType(payload, evidenceMode) {
  const explicit = normalizeEvidenceTypes(payload.type ?? payload.evidenceType ?? payload.evidence_type);
  if (explicit.length > 0) return explicit[0];
  if (payload.evidenceFile || payload.file || payload.selectedFile || payload.evidenceFilePath) {
    return ACTION_EVIDENCE_TYPE.file;
  }
  if (payload.evidenceUrl || payload.url || payload.link) return ACTION_EVIDENCE_TYPE.link;
  return evidenceMode.evidenceType;
}

function normalizeEvidenceFileContent(payload = {}) {
  const candidate = payload.evidenceFilePath
    ?? payload.evidence_file_path
    ?? payload.evidenceFile
    ?? payload.file
    ?? payload.selectedFile
    ?? payload.content;

  if (typeof candidate === "string") return trimText(candidate);
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return trimText(candidate);

  return trimText(
    candidate.path
      ?? candidate.filePath
      ?? candidate.file_path
      ?? candidate.url
      ?? candidate.name
      ?? candidate.filename
  );
}

function normalizeAllowedEvidenceTypes(expectedEvidenceTypes, actionType) {
  return resolveActionEvidenceInputMode({}, {
    actionType,
    expectedEvidenceTypes,
  }).allowedTypes;
}

function methodForEvidenceType(type) {
  return type === ACTION_EVIDENCE_TYPE.file
    ? ACTION_VERIFICATION_METHOD.evidenceFile
    : ACTION_VERIFICATION_METHOD.evidenceLink;
}

function markEvidenceValidationStatus(state, validationStatus) {
  if (!state?.evidenceSubmission) return state;
  return {
    ...state,
    evidenceSubmission: {
      ...state.evidenceSubmission,
      validationStatus,
    },
  };
}

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function looksLikeFilePath(value) {
  return FILE_PATH_PATTERN.test(value);
}

function normalizeSubmittedAt(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function toIso(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function normalizePlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return { ...value };
}

function trimText(value, limit = MAX_CONTENT_CHARS) {
  return String(value || "").trim().slice(0, limit);
}

function normalizeActionSpec(value) {
  if (typeof value === "string") return { actionType: value };
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const nested = value.actionSpec ?? value.action_spec;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    return { ...value, ...nested };
  }
  return value;
}

function getActionSpecType(spec) {
  return spec.actionType
    ?? spec.action_type
    ?? spec.type
    ?? spec.kind
    ?? spec.category
    ?? "";
}

function normalizeActionType(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

function normalizeEvidenceTypes(value) {
  const items = Array.isArray(value) ? value : [value];
  return [...new Set(items.flatMap(normalizeEvidenceType).filter(Boolean))];
}

function normalizeEvidenceType(value) {
  const text = normalizeActionType(value);
  if (!text) return [];
  if (
    text === ACTION_EVIDENCE_TYPE.link
    || text === ACTION_EVIDENCE_INPUT_MODE.link
    || text === "url"
    || text === "external_link"
    || text === "evidence_link"
  ) {
    return [ACTION_EVIDENCE_TYPE.link];
  }
  if (
    text === ACTION_EVIDENCE_TYPE.file
    || text === ACTION_EVIDENCE_INPUT_MODE.fileUpload
    || text === "file_upload"
    || text === "upload"
    || text === "attachment"
    || text === "evidence_file"
  ) {
    return [ACTION_EVIDENCE_TYPE.file];
  }
  return [];
}

function makeEvidenceModeResolution({
  evidenceType,
  allowedTypes,
  actionType,
  source,
}) {
  const normalizedAllowedTypes = normalizeEvidenceTypes(allowedTypes);
  const primaryType = evidenceType === ACTION_EVIDENCE_TYPE.file
    ? ACTION_EVIDENCE_TYPE.file
    : ACTION_EVIDENCE_TYPE.link;
  return {
    mode: primaryType === ACTION_EVIDENCE_TYPE.file
      ? ACTION_EVIDENCE_INPUT_MODE.fileUpload
      : ACTION_EVIDENCE_INPUT_MODE.link,
    evidenceType: primaryType,
    allowedTypes: normalizedAllowedTypes.length > 0 ? normalizedAllowedTypes : [primaryType],
    actionType: actionType || "",
    source,
    acceptsLink: normalizedAllowedTypes.includes(ACTION_EVIDENCE_TYPE.link) || primaryType === ACTION_EVIDENCE_TYPE.link,
    acceptsFileUpload: normalizedAllowedTypes.includes(ACTION_EVIDENCE_TYPE.file) || primaryType === ACTION_EVIDENCE_TYPE.file,
  };
}

function inferEvidenceTypeFromVerification(spec) {
  const source = spec.verification_method
    ?? spec.verificationMethod
    ?? spec.verification
    ?? spec.verification_methods
    ?? spec.verificationMethods
    ?? [];
  const text = flattenText(source);
  if (!text) return null;
  if (
    text.includes("browser")
    || text.includes("google_docs")
    || text.includes("google docs")
    || text.includes("google_sheets")
    || text.includes("google sheets")
    || text.includes("gws_docs")
    || text.includes("gws_sheets")
  ) {
    return ACTION_EVIDENCE_TYPE.link;
  }
  return null;
}

function inferEvidenceTypeFromSpecText(spec) {
  const text = flattenText([
    spec.description,
    spec.actionDescription,
    spec.action_description,
    spec.task,
    spec.action,
    spec.actionSpec,
    spec.action_spec,
    spec.actionWithSignal,
    spec.action_with_signal,
    spec.output,
    spec.template,
    spec.completionSignal,
    spec.completion_signal,
    spec.completion,
  ]);
  if (!text) return null;

  const linkIndex = firstKeywordIndex(text, LINK_KEYWORDS);
  const fileIndex = firstKeywordIndex(text, FILE_KEYWORDS);
  if (linkIndex === -1 && fileIndex === -1) return null;
  if (linkIndex === -1) return ACTION_EVIDENCE_TYPE.file;
  if (fileIndex === -1) return ACTION_EVIDENCE_TYPE.link;
  return linkIndex <= fileIndex ? ACTION_EVIDENCE_TYPE.link : ACTION_EVIDENCE_TYPE.file;
}

function firstKeywordIndex(text, keywords) {
  return keywords.reduce((best, keyword) => {
    const index = text.indexOf(keyword);
    if (index === -1) return best;
    return best === -1 ? index : Math.min(best, index);
  }, -1);
}

function flattenText(value) {
  if (Array.isArray(value)) {
    return value.map(flattenText).filter(Boolean).join(" ").toLowerCase();
  }
  if (value && typeof value === "object") {
    return Object.values(value).map(flattenText).filter(Boolean).join(" ").toLowerCase();
  }
  return String(value || "").trim().toLowerCase();
}
