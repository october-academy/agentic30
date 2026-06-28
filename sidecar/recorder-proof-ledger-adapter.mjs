import { createHash } from "node:crypto";
import {
  PROOF_EVENT_TYPES,
  appendProofLedgerEvent,
} from "./execution-os.mjs";
import {
  EVIDENCE_GRADES,
  EVIDENCE_KIND_GRADE,
  REJECTED_EVIDENCE_KINDS,
} from "./office-hours-contract.mjs";

export const RECORDER_PROOF_ADAPTER_SCHEMA_VERSION = 1;

export class RecorderProofAdapterError extends Error {
  constructor(code, message, details = {}) {
    super(`${code}: ${message}`);
    this.name = "RecorderProofAdapterError";
    this.code = code;
    this.details = details;
  }
}

export const RECORDER_PROOF_CANDIDATE_WRITE_STATUS = "approved_bundle";

export const RECORDER_PROOF_SAFE_SOURCE_STATES = Object.freeze(new Set([
  "searchable_local",
  "memory_safe",
  "export_safe",
  "approved_external",
  "external_evidence",
  "manual_evidence_approved",
  "verifier_accepted",
]));

export const RECORDER_PROOF_COMPLETED_STATUSES = Object.freeze(new Set([
  "accepted",
  "verified",
  "complete",
  "completed",
]));

const PROOF_EVENT_TYPE_VALUES = Object.freeze(new Set(Object.values(PROOF_EVENT_TYPES)));
const PROOF_EVENT_STATUSES = Object.freeze(new Set([
  "draft",
  "submitted",
  "accepted",
  "verified",
  "rejected",
  "insufficient",
  "blocked",
  "complete",
  "completed",
]));
const PROOF_EVENT_STRENGTHS = Object.freeze(new Set(["weak", "medium", "strong"]));
const PROTECTED_GATE_TARGETS = Object.freeze(new Set([
  "customer",
  "customer_evidence",
  "active_user",
  "active_users",
  "active_users_100",
  "revenue",
  "first_revenue",
]));
const NON_PROOF_SOURCE_KINDS = Object.freeze(new Set([
  ...REJECTED_EVIDENCE_KINDS,
  "agent_workpack",
  "build_log",
  "code_change",
  "demo_video",
  "internal_trace",
  "memory",
  "memory_item",
  "memory_summary",
  "pipe_output",
  "product_event",
  "raw_frame",
  "raw_search_hit",
  "search_hit",
  "transcript_hit",
  "work_log",
]));
const ALLOWED_PROOF_KINDS = Object.freeze(new Set([
  ...Object.keys(EVIDENCE_KIND_GRADE),
  ...EVIDENCE_GRADES,
  ...Object.values(PROOF_EVENT_TYPES),
  "active_user_progress",
  "customer_evidence",
  "revenue_proof",
]));

export function normalizeRecorderProofCandidate(candidate = {}, {
  seenIdempotencyKeys = null,
  existingCandidates = [],
} = {}) {
  if (!isPlainObject(candidate)) {
    fail("ERR_RECORDER_PROOF_MALFORMED_CANDIDATE", "candidate must be an object");
  }

  const candidateId = cleanString(candidate.id ?? candidate.candidateId ?? candidate.candidate_id, 160);
  const candidateStatus = normalizeToken(candidate.candidateStatus ?? candidate.candidate_status);
  if (candidateStatus !== RECORDER_PROOF_CANDIDATE_WRITE_STATUS) {
    fail(
      "ERR_RECORDER_PROOF_CANDIDATE_NOT_APPROVED",
      `candidate status must be ${RECORDER_PROOF_CANDIDATE_WRITE_STATUS}`,
      { candidateStatus },
    );
  }

  const sourceState = normalizeToken(candidate.sourceState ?? candidate.source_state);
  if (!RECORDER_PROOF_SAFE_SOURCE_STATES.has(sourceState)) {
    fail(
      "ERR_RECORDER_PROOF_UNSAFE_SOURCE_STATE",
      `candidate source_state is not safe for proof write: ${sourceState || "(missing)"}`,
      { sourceState },
    );
  }

  const proofKind = normalizeToken(candidate.proofKind ?? candidate.proof_kind);
  if (!proofKind) {
    fail("ERR_RECORDER_PROOF_MISSING_PROOF_KIND", "candidate proof_kind is required");
  }
  if (REJECTED_EVIDENCE_KINDS.has(proofKind)) {
    fail("ERR_RECORDER_PROOF_REJECTED_PROOF_KIND", `candidate proof_kind is rejected: ${proofKind}`, { proofKind });
  }
  if (!ALLOWED_PROOF_KINDS.has(proofKind)) {
    fail("ERR_RECORDER_PROOF_UNKNOWN_PROOF_KIND", `candidate proof_kind is not aligned with known evidence vocabulary: ${proofKind}`, { proofKind });
  }

  const sourceIds = normalizeSourceIds(candidate.sourceIds ?? candidate.source_ids ?? candidate.sourceIdsJson ?? candidate.source_ids_json);
  if (!sourceIds.length) {
    fail("ERR_RECORDER_PROOF_MISSING_SOURCE_IDS", "candidate source_ids_json must contain at least one source id");
  }

  const immutableFingerprint = cleanString(
    candidate.immutableFingerprint ?? candidate.immutable_fingerprint,
    240,
  );
  if (!immutableFingerprint) {
    fail("ERR_RECORDER_PROOF_MISSING_IMMUTABLE_FINGERPRINT", "candidate immutable_fingerprint is required");
  }

  const idempotencyKey = cleanString(candidate.idempotencyKey ?? candidate.idempotency_key, 240);
  if (!idempotencyKey) {
    fail("ERR_RECORDER_PROOF_MISSING_IDEMPOTENCY_KEY", "candidate idempotency_key is required");
  }
  assertUniqueIdempotencyKey(idempotencyKey, { seenIdempotencyKeys, existingCandidates });

  const proofLedgerMapping = parseJsonField(
    candidate.proofLedgerMapping ?? candidate.proof_ledger_mapping ?? candidate.proofLedgerMappingJson ?? candidate.proof_ledger_mapping_json,
    "proof_ledger_mapping_json",
  );
  const proofEvent = normalizeMappedProofEvent(proofLedgerMapping);
  const sourceKinds = normalizeSourceKinds(candidate);
  const targetGate = normalizeToken(
    candidate.targetGate ?? candidate.target_gate
      ?? proofLedgerMapping.targetGate ?? proofLedgerMapping.target_gate
      ?? proofEvent.metadata?.targetGate ?? proofEvent.metadata?.target_gate,
  );
  assertExternalSourceForProtectedGate({ targetGate, proofKind, sourceKinds });

  return {
    candidateId,
    candidateStatus,
    sourceState,
    proofKind,
    sourceIds,
    sourceKinds,
    immutableFingerprint,
    idempotencyKey,
    targetGate,
    proofLedgerMapping,
    proofEvent: attachCandidateMetadata(proofEvent, {
      candidateId,
      sourceIds,
      immutableFingerprint,
      idempotencyKey,
      proofKind,
      sourceState,
      targetGate,
    }),
  };
}

export async function writeRecorderProofCandidateToLedger({
  workspaceRoot,
  candidate,
  existingCandidates = [],
  seenIdempotencyKeys = null,
  now = new Date(),
  append = appendProofLedgerEvent,
} = {}) {
  if (!workspaceRoot || typeof workspaceRoot !== "string") {
    fail("ERR_RECORDER_PROOF_MISSING_WORKSPACE", "writeRecorderProofCandidateToLedger requires workspaceRoot");
  }
  const normalized = normalizeRecorderProofCandidate(candidate, {
    existingCandidates,
    seenIdempotencyKeys,
  });
  const result = await append({
    workspaceRoot,
    event: normalized.proofEvent,
    now,
  });
  return {
    ...result,
    candidate: normalized,
    proofLedgerEventId: result?.event?.id || "",
    proof_ledger_event_id: result?.event?.id || "",
  };
}

export function buildRecorderProofCandidateVerifierRejection(error, { now = new Date() } = {}) {
  const code = error instanceof RecorderProofAdapterError
    ? error.code
    : "ERR_RECORDER_PROOF_VERIFIER_REJECTED";
  const message = cleanString(error?.message || String(error || "Unknown recorder proof rejection"), 1000);
  const details = isPlainObject(error?.details) ? error.details : {};
  const reviewedAt = toIso(now);
  const verifierResult = {
    status: "rejected",
    code,
    message,
    details,
    reviewedAt,
    reviewed_at: reviewedAt,
  };
  return {
    candidateStatus: "verifier_rejected",
    candidate_status: "verifier_rejected",
    reviewedAt,
    reviewed_at: reviewedAt,
    verifierResult,
    verifier_result_json: JSON.stringify(verifierResult),
  };
}

function normalizeMappedProofEvent(mapping = {}) {
  if (!isPlainObject(mapping)) {
    fail("ERR_RECORDER_PROOF_MALFORMED_MAPPING", "proof_ledger_mapping_json must be an object");
  }
  const event = mapping.event ?? mapping.proofEvent ?? mapping.proof_event ?? mapping;
  if (!isPlainObject(event)) {
    fail("ERR_RECORDER_PROOF_MALFORMED_MAPPING", "proof_ledger_mapping_json must contain a proof event object");
  }

  const type = normalizeToken(event.type ?? event.eventType ?? event.event_type);
  if (!PROOF_EVENT_TYPE_VALUES.has(type)) {
    fail("ERR_RECORDER_PROOF_UNKNOWN_EVENT_TYPE", `unknown proof event type: ${type || "(missing)"}`, { type });
  }

  const status = normalizeToken(event.status ?? event.validationStatus ?? event.validation_status);
  if (!PROOF_EVENT_STATUSES.has(status)) {
    fail("ERR_RECORDER_PROOF_UNKNOWN_EVENT_STATUS", `unknown proof event status: ${status || "(missing)"}`, { status });
  }
  if (!RECORDER_PROOF_COMPLETED_STATUSES.has(status)) {
    fail("ERR_RECORDER_PROOF_UNACCEPTED_EVENT_STATUS", `proof event status is not verifier-complete: ${status}`, { status });
  }

  const strength = normalizeToken(event.strength ?? event.proofStrength ?? event.proof_strength);
  if (!PROOF_EVENT_STRENGTHS.has(strength)) {
    fail("ERR_RECORDER_PROOF_UNKNOWN_EVENT_STRENGTH", `unknown proof event strength: ${strength || "(missing)"}`, { strength });
  }

  return {
    ...event,
    type,
    status,
    strength,
  };
}

function assertExternalSourceForProtectedGate({ targetGate, proofKind, sourceKinds }) {
  const protectedGate = PROTECTED_GATE_TARGETS.has(targetGate) || [
    "customer_evidence",
    "active_user_progress",
    "revenue_proof",
  ].includes(proofKind);
  if (!protectedGate) return;
  const normalizedKinds = sourceKinds.map(normalizeToken).filter(Boolean);
  if (!normalizedKinds.length) return;
  if (normalizedKinds.every((kind) => NON_PROOF_SOURCE_KINDS.has(kind))) {
    fail(
      "ERR_RECORDER_PROOF_NON_EXTERNAL_SOURCE",
      "customer, active-user, and revenue gates require external accepted evidence; non-proof sources alone cannot write proof",
      { targetGate, sourceKinds: normalizedKinds },
    );
  }
}

function assertUniqueIdempotencyKey(idempotencyKey, { seenIdempotencyKeys, existingCandidates }) {
  if (seenIdempotencyKeys?.has?.(idempotencyKey)) {
    fail("ERR_RECORDER_PROOF_DUPLICATE_IDEMPOTENCY_KEY", `duplicate idempotency_key: ${idempotencyKey}`);
  }
  const duplicate = (Array.isArray(existingCandidates) ? existingCandidates : []).some((item) =>
    cleanString(item?.idempotencyKey ?? item?.idempotency_key, 240) === idempotencyKey
      && normalizeToken(item?.candidateStatus ?? item?.candidate_status) === "written_to_ledger",
  );
  if (duplicate) {
    fail("ERR_RECORDER_PROOF_DUPLICATE_IDEMPOTENCY_KEY", `idempotency_key already written to ledger: ${idempotencyKey}`);
  }
}

function attachCandidateMetadata(event, {
  candidateId,
  sourceIds,
  immutableFingerprint,
  idempotencyKey,
  proofKind,
  sourceState,
  targetGate,
}) {
  const metadata = isPlainObject(event.metadata) ? { ...event.metadata } : {};
  metadata.recorderProofAdapterSchemaVersion = RECORDER_PROOF_ADAPTER_SCHEMA_VERSION;
  metadata.recorderEvidenceCandidateId = candidateId;
  metadata.recorderEvidenceSourceIds = sourceIds;
  metadata.recorderEvidenceFingerprint = immutableFingerprint;
  metadata.recorderEvidenceDedupeHash = sha256Hex(idempotencyKey);
  metadata.recorderEvidenceProofKind = proofKind;
  metadata.recorderEvidenceSourceState = sourceState;
  if (targetGate) metadata.recorderEvidenceTargetGate = targetGate;
  return {
    ...event,
    refs: normalizeStringArray([...(Array.isArray(event.refs) ? event.refs : []), ...sourceIds], 30, 260),
    metadata,
  };
}

function normalizeSourceIds(value) {
  const parsed = parseMaybeJson(value);
  const input = Array.isArray(parsed) ? parsed : [];
  return normalizeStringArray(
    input.map((item) => {
      if (typeof item === "string") return item;
      if (isPlainObject(item)) return item.id ?? item.sourceId ?? item.source_id;
      return "";
    }),
    60,
    260,
  );
}

function normalizeSourceKinds(candidate = {}) {
  const direct = candidate.sourceKinds ?? candidate.source_kinds
    ?? candidate.sourceKindsJson ?? candidate.source_kinds_json;
  const parsed = parseMaybeJson(direct);
  const fromDirect = Array.isArray(parsed) ? parsed : [];
  const sourceIds = parseMaybeJson(candidate.sourceIds ?? candidate.source_ids ?? candidate.sourceIdsJson ?? candidate.source_ids_json);
  const fromObjects = Array.isArray(sourceIds)
    ? sourceIds.flatMap((item) => isPlainObject(item)
      ? [item.kind, item.sourceKind, item.source_kind, item.sourceType, item.source_type, item.dataClass, item.data_class]
      : [])
    : [];
  return normalizeStringArray([...fromDirect, ...fromObjects], 30, 120).map(normalizeToken);
}

function parseJsonField(value, fieldName) {
  const parsed = parseMaybeJson(value);
  if (!isPlainObject(parsed)) {
    fail("ERR_RECORDER_PROOF_MALFORMED_MAPPING", `${fieldName} must be valid JSON object`);
  }
  return parsed;
}

function parseMaybeJson(value) {
  if (typeof value !== "string") return value;
  const text = value.trim();
  if (!text) return value;
  try {
    return JSON.parse(text);
  } catch {
    return value;
  }
}

function normalizeStringArray(value = [], maxItems = 12, maxLength = 260) {
  const input = Array.isArray(value) ? value : [value];
  const seen = new Set();
  const output = [];
  for (const item of input) {
    const text = cleanString(item, maxLength);
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    output.push(text);
    if (output.length >= maxItems) break;
  }
  return output;
}

function normalizeToken(value = "") {
  return String(value || "")
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
    .replace(/[^a-z0-9가-힣_]/g, "")
    .slice(0, 120);
}

function cleanString(value = "", maxLength = 500) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function fail(code, message, details = {}) {
  throw new RecorderProofAdapterError(code, message, details);
}

function sha256Hex(value = "") {
  return createHash("sha256").update(String(value || "")).digest("hex");
}

function toIso(value) {
  const date = value instanceof Date ? value : new Date(value ?? Date.now());
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}
