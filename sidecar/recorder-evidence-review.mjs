import {
  EVIDENCE_KIND_GRADE,
  REJECTED_EVIDENCE_KINDS,
} from "./office-hours-contract.mjs";

export const RECORDER_EVIDENCE_REVIEW_SCHEMA_VERSION = 1;

const REVIEWABLE_STATUSES = new Set([
  "pending_review",
  "degraded",
  "verifier_rejected",
]);
const APPROVE_DECISIONS = new Set(["approve", "approved", "approve_bundle", "approved_bundle"]);
const REJECT_DECISIONS = new Set(["reject", "rejected"]);
const EXTERNAL_ARTIFACT_KINDS = new Set([
  ...Object.keys(EVIDENCE_KIND_GRADE),
  "external_evidence",
  "manual_evidence_approved",
]);

export class RecorderEvidenceReviewError extends Error {
  constructor(code, message, details = {}) {
    super(`${code}: ${message}`);
    this.name = "RecorderEvidenceReviewError";
    this.code = code;
    this.details = details;
  }
}

export function reviewRecorderEvidenceCandidate({
  store,
  candidateId,
  decision,
  reviewerId = "local-user",
  reason = "",
  externalArtifact = null,
  now = new Date(),
} = {}) {
  if (!store || typeof store.getRecord !== "function" || typeof store.updateRecord !== "function") {
    fail("ERR_RECORDER_EVIDENCE_REVIEW_STORE_REQUIRED", "reviewRecorderEvidenceCandidate requires a RecorderStore-like store");
  }
  const id = cleanString(candidateId, 240);
  if (!id) {
    fail("ERR_RECORDER_EVIDENCE_REVIEW_CANDIDATE_REQUIRED", "candidateId is required");
  }
  const row = store.getRecord("evidence_candidates", id);
  if (!row || row.deleted_at) {
    fail("ERR_RECORDER_EVIDENCE_REVIEW_CANDIDATE_NOT_FOUND", `evidence candidate not found: ${id}`);
  }

  const reviewDecision = normalizeDecision(decision);
  const reviewedAt = toIso(now);
  if (!REVIEWABLE_STATUSES.has(cleanToken(row.candidate_status))) {
    fail("ERR_RECORDER_EVIDENCE_REVIEW_STATUS_NOT_REVIEWABLE", "candidate status cannot be reviewed by this control", {
      candidateId: id,
      candidate_id: id,
      candidateStatus: row.candidate_status,
      candidate_status: row.candidate_status,
    });
  }

  if (APPROVE_DECISIONS.has(reviewDecision)) {
    return approveCandidate({ store, row, reviewerId, reason, externalArtifact, reviewedAt });
  }
  if (REJECT_DECISIONS.has(reviewDecision)) {
    return rejectCandidate({ store, row, reviewerId, reason, reviewedAt });
  }
  fail("ERR_RECORDER_EVIDENCE_REVIEW_UNKNOWN_DECISION", "Evidence review decision must be approve_bundle or rejected", {
    decision,
  });
}

function approveCandidate({
  store,
  row,
  reviewerId,
  reason,
  externalArtifact,
  reviewedAt,
}) {
  const artifact = normalizeExternalArtifact(externalArtifact);
  const mapping = normalizeMapping(row.proof_ledger_mapping_json);
  const event = normalizeMappingEvent(mapping);
  const metadata = isPlainObject(event.metadata) ? { ...event.metadata } : {};
  metadata.recorderEvidenceReviewedBy = cleanString(reviewerId, 160) || "local-user";
  metadata.recorder_evidence_reviewed_by = metadata.recorderEvidenceReviewedBy;
  metadata.recorderEvidenceReviewedAt = reviewedAt;
  metadata.recorder_evidence_reviewed_at = reviewedAt;
  metadata.recorderEvidenceReviewReason = cleanString(reason, 500);
  metadata.recorder_evidence_review_reason = metadata.recorderEvidenceReviewReason;
  metadata.recorderEvidenceExternalArtifactId = artifact.id;
  metadata.recorder_evidence_external_artifact_id = artifact.id;
  metadata.recorderEvidenceExternalArtifactKind = artifact.kind;
  metadata.recorder_evidence_external_artifact_kind = artifact.kind;

  mapping.event = {
    ...event,
    status: artifact.status,
    strength: artifact.strength || event.strength || "medium",
    evidenceType: artifact.kind,
    evidence_type: artifact.kind,
    sourceUrl: artifact.url || event.sourceUrl || event.source_url || "",
    source_url: artifact.url || event.sourceUrl || event.source_url || "",
    artifactPath: artifact.artifactPath || event.artifactPath || event.artifact_path || "",
    artifact_path: artifact.artifactPath || event.artifactPath || event.artifact_path || "",
    customer: artifact.customer || event.customer || "",
    refs: normalizeStringArray([
      ...(Array.isArray(event.refs) ? event.refs : []),
      artifact.id,
    ], 30, 260),
    metadata,
  };

  const sourceIds = appendExternalArtifactSource(row.source_ids_json, artifact);
  const verifierResult = {
    status: "approved_bundle",
    decision: "approve_bundle",
    reviewerId: cleanString(reviewerId, 160) || "local-user",
    reviewer_id: cleanString(reviewerId, 160) || "local-user",
    reviewedAt,
    reviewed_at: reviewedAt,
    reason: cleanString(reason, 500),
    externalArtifact: artifact,
    external_artifact: artifact,
  };

  store.updateRecord("evidence_candidates", row.id, {
    candidate_status: "approved_bundle",
    source_state: "approved_external",
    source_ids_json: JSON.stringify(sourceIds),
    proof_ledger_mapping_json: JSON.stringify(mapping),
    evidence_debt_json: JSON.stringify([]),
    verifier_result_json: JSON.stringify(verifierResult),
    reviewed_at: reviewedAt,
  });

  return {
    status: "approved_bundle",
    candidate: store.getRecord("evidence_candidates", row.id),
    verifierResult,
    verifier_result: verifierResult,
    proofAcceptedByReview: false,
    proof_accepted_by_review: false,
  };
}

function rejectCandidate({
  store,
  row,
  reviewerId,
  reason,
  reviewedAt,
}) {
  const cleanReason = cleanString(reason, 1000);
  if (!cleanReason) {
    fail("ERR_RECORDER_EVIDENCE_REVIEW_REASON_REQUIRED", "rejecting an evidence candidate requires a root-cause reason");
  }
  const verifierResult = {
    status: "rejected",
    decision: "rejected",
    code: "USER_REJECTED_RECORDER_EVIDENCE",
    reason: cleanReason,
    reviewerId: cleanString(reviewerId, 160) || "local-user",
    reviewer_id: cleanString(reviewerId, 160) || "local-user",
    reviewedAt,
    reviewed_at: reviewedAt,
  };
  store.updateRecord("evidence_candidates", row.id, {
    candidate_status: "rejected",
    reviewed_at: reviewedAt,
    verifier_result_json: JSON.stringify(verifierResult),
  });
  return {
    status: "rejected",
    candidate: store.getRecord("evidence_candidates", row.id),
    verifierResult,
    verifier_result: verifierResult,
    proofAcceptedByReview: false,
    proof_accepted_by_review: false,
  };
}

function normalizeExternalArtifact(value) {
  if (!isPlainObject(value)) {
    fail("ERR_RECORDER_EVIDENCE_REVIEW_EXTERNAL_ARTIFACT_REQUIRED", "approving a candidate requires an external artifact object");
  }
  const id = cleanString(value.id ?? value.artifactId ?? value.artifact_id ?? value.sourceId ?? value.source_id, 240);
  if (!id) {
    fail("ERR_RECORDER_EVIDENCE_REVIEW_EXTERNAL_ARTIFACT_ID_REQUIRED", "external artifact requires id");
  }
  const kind = cleanToken(value.kind ?? value.evidenceKind ?? value.evidence_kind ?? value.sourceKind ?? value.source_kind);
  if (!kind) {
    fail("ERR_RECORDER_EVIDENCE_REVIEW_EXTERNAL_ARTIFACT_KIND_REQUIRED", "external artifact requires evidence kind");
  }
  if (REJECTED_EVIDENCE_KINDS.has(kind)) {
    fail("ERR_RECORDER_EVIDENCE_REVIEW_REJECTED_KIND", `external artifact kind is rejected: ${kind}`, { kind });
  }
  if (!EXTERNAL_ARTIFACT_KINDS.has(kind)) {
    fail("ERR_RECORDER_EVIDENCE_REVIEW_UNKNOWN_KIND", `external artifact kind is not reviewable: ${kind}`, { kind });
  }
  const url = cleanString(value.url ?? value.sourceUrl ?? value.source_url, 1000);
  const artifactPath = cleanString(value.artifactPath ?? value.artifact_path ?? value.path, 1000);
  if (!url && !artifactPath) {
    fail("ERR_RECORDER_EVIDENCE_REVIEW_EXTERNAL_ARTIFACT_LOCATION_REQUIRED", "external artifact requires source URL or artifact path");
  }
  const status = cleanToken(value.status ?? "accepted");
  if (!["accepted", "verified", "complete", "completed"].includes(status)) {
    fail("ERR_RECORDER_EVIDENCE_REVIEW_UNACCEPTED_STATUS", "external artifact status must be accepted or verified", {
      status,
    });
  }
  const strength = cleanToken(value.strength ?? value.proofStrength ?? value.proof_strength);
  if (strength && !["weak", "medium", "strong"].includes(strength)) {
    fail("ERR_RECORDER_EVIDENCE_REVIEW_UNKNOWN_STRENGTH", "external artifact strength must be weak, medium, or strong", {
      strength,
    });
  }
  return {
    id,
    kind,
    status,
    strength: strength || "",
    url,
    artifactPath,
    artifact_path: artifactPath,
    customer: cleanString(value.customer ?? value.person ?? value.targetCustomer ?? value.target_customer, 180),
  };
}

function appendExternalArtifactSource(sourceIdsJson, artifact) {
  const current = parseJsonArray(sourceIdsJson);
  const externalSource = {
    id: artifact.id,
    source_kind: artifact.kind,
    source_type: "external_evidence",
    review_status: artifact.status,
  };
  const output = [];
  const seen = new Set();
  for (const item of [...current, externalSource]) {
    const id = typeof item === "string"
      ? item
      : cleanString(item?.id ?? item?.sourceId ?? item?.source_id, 240);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    output.push(typeof item === "string" ? { id, source_kind: "recorder_source", source_type: "recorder_source" } : item);
  }
  return output;
}

function normalizeMapping(value) {
  const mapping = parseJsonObject(value);
  if (!mapping.event && !mapping.proofEvent && !mapping.proof_event) {
    return { event: mapping };
  }
  return { ...mapping };
}

function normalizeMappingEvent(mapping) {
  const event = mapping.event ?? mapping.proofEvent ?? mapping.proof_event;
  if (!isPlainObject(event)) {
    fail("ERR_RECORDER_EVIDENCE_REVIEW_MALFORMED_MAPPING", "candidate proof_ledger_mapping_json must contain an event object");
  }
  return { ...event };
}

function normalizeDecision(value) {
  const decision = cleanToken(value);
  if (!decision) {
    fail("ERR_RECORDER_EVIDENCE_REVIEW_DECISION_REQUIRED", "evidence review requires decision");
  }
  return decision;
}

function normalizeStringArray(value = [], maxItems = 12, maxLength = 260) {
  const input = Array.isArray(value) ? value : [value];
  const output = [];
  const seen = new Set();
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

function parseJsonArray(value) {
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value || "[]"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseJsonObject(value) {
  if (isPlainObject(value)) return value;
  try {
    const parsed = JSON.parse(String(value || "{}"));
    return isPlainObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function toIso(value) {
  const date = value instanceof Date ? value : new Date(value ?? Date.now());
  if (Number.isNaN(date.getTime())) {
    fail("ERR_RECORDER_EVIDENCE_REVIEW_INVALID_TIMESTAMP", "evidence review timestamp must be valid ISO-compatible input", {
      value,
    });
  }
  return date.toISOString();
}

function cleanToken(value = "") {
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
  throw new RecorderEvidenceReviewError(code, message, details);
}
