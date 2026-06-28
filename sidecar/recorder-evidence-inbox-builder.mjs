import { createHash } from "node:crypto";

import { insertRecorderEvidenceCandidate } from "./recorder-evidence-candidates.mjs";

export const RECORDER_EVIDENCE_INBOX_BUILDER_SCHEMA_VERSION = 1;

const SOURCE_KIND_PRODUCT_EVENT = "product_event";
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const UNSAFE_TEXT_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|(?:api[_-]?key|oauth|secret|token|password)\s*[:=]/i;

const EVENT_CANDIDATE_MAPPINGS = Object.freeze({
  customer_interview: {
    proofKind: "customer_reply",
    proofEventType: "interview",
    targetGate: "customer_evidence",
    strength: "medium",
    evidenceDebt: [
      "Attach the external customer reply, call note, or interview artifact before approving this candidate.",
    ],
  },
  customer_ask_sent: {
    proofKind: "message_log",
    proofEventType: "dm_ask",
    targetGate: "customer_evidence",
    strength: "medium",
    evidenceDebt: [
      "Attach the sent-message screenshot or message log before approving this candidate.",
      "This candidate proves outreach only; customer outcome still needs a separate external artifact.",
    ],
  },
  public_post: {
    proofKind: "shared_url",
    proofEventType: "action_evidence",
    targetGate: "external_action",
    strength: "medium",
    evidenceDebt: [
      "Attach the public URL or screenshot before approving this candidate.",
    ],
  },
  activation_observed: {
    proofKind: "activation_event",
    proofEventType: "action_evidence",
    targetGate: "active_user",
    strength: "medium",
    evidenceDebt: [
      "Attach accepted external or instrumented activation evidence before approving active-user progress.",
    ],
  },
  payment_intent: {
    proofKind: "payment",
    proofEventType: "payment_intent",
    targetGate: "revenue",
    strength: "strong",
    evidenceDebt: [
      "Attach the external payment intent, invoice, contract, or checkout artifact before approving revenue progress.",
    ],
  },
  payment_record: {
    proofKind: "payment",
    proofEventType: "payment_record",
    targetGate: "revenue",
    strength: "strong",
    evidenceDebt: [
      "Attach the external payment processor receipt or bank/payment artifact before approving revenue progress.",
    ],
  },
  negative_evidence: {
    proofKind: "refusal",
    proofEventType: "interview",
    targetGate: "customer_evidence",
    strength: "medium",
    evidenceDebt: [
      "Attach the external refusal or drop-off artifact before treating this as a customer outcome.",
    ],
  },
});

export class RecorderEvidenceInboxBuilderError extends Error {
  constructor(code, message, details = {}) {
    super(`${code}: ${message}`);
    this.name = "RecorderEvidenceInboxBuilderError";
    this.code = code;
    this.details = details;
  }
}

export function buildRecorderEvidenceInboxCandidates({
  store,
  workspaceId = null,
  projectId = null,
  startedAt = null,
  endedAt = null,
  limit = DEFAULT_LIMIT,
  now = new Date(),
} = {}) {
  if (!store || typeof store.listRecords !== "function" || typeof store.insertRecord !== "function") {
    fail("ERR_RECORDER_EVIDENCE_BUILDER_STORE_REQUIRED", "buildRecorderEvidenceInboxCandidates requires a RecorderStore-like store");
  }

  const max = normalizeLimit(limit);
  const timeRange = normalizeTimeRange({ startedAt, endedAt });
  const scope = {
    workspaceId: cleanNullableString(workspaceId),
    projectId: cleanNullableString(projectId),
  };
  const createdAt = toIso(now);
  const existingCandidates = store.listRecords("evidence_candidates", { limit: 5000 });
  const existingCandidateIds = new Set(existingCandidates.map((row) => cleanString(row.id, 240)).filter(Boolean));
  const existingIdempotencyKeys = new Set(existingCandidates.map((row) => cleanString(row.idempotency_key, 300)).filter(Boolean));
  const productEvents = store.listRecords("product_events", { limit: 5000 })
    .filter((row) => isEligibleProductEvent(row, { scope, timeRange }))
    .sort((lhs, rhs) => String(lhs.occurred_at || "").localeCompare(String(rhs.occurred_at || "")))
    .slice(0, max);

  const created = [];
  const skipped = [];

  for (const event of productEvents) {
    const mapping = EVENT_CANDIDATE_MAPPINGS[event.event_type];
    if (!mapping) {
      skipped.push(skip(event, "unsupported_product_event_type"));
      continue;
    }
    assertSafeProductEventText(event);
    const candidate = productEventToCandidate(event, mapping, { createdAt });
    if (existingCandidateIds.has(candidate.id) || existingIdempotencyKeys.has(candidate.idempotencyKey)) {
      skipped.push(skip(event, "candidate_already_exists"));
      store.updateRecord("product_events", event.id, { verification_status: "candidate_created" });
      continue;
    }

    store.withTransaction(() => {
      insertRecorderEvidenceCandidate(store, candidate);
      store.updateRecord("product_events", event.id, { verification_status: "candidate_created" });
    });
    created.push(store.getRecord("evidence_candidates", candidate.id));
    existingCandidateIds.add(candidate.id);
    existingIdempotencyKeys.add(candidate.idempotencyKey);
  }

  return {
    schema: "agentic30.recorder.evidence_inbox_builder.v1",
    schemaVersion: RECORDER_EVIDENCE_INBOX_BUILDER_SCHEMA_VERSION,
    schema_version: RECORDER_EVIDENCE_INBOX_BUILDER_SCHEMA_VERSION,
    generatedAt: createdAt,
    generated_at: createdAt,
    filters: {
      workspaceId: scope.workspaceId,
      workspace_id: scope.workspaceId,
      projectId: scope.projectId,
      project_id: scope.projectId,
      timeRange: timeRange
        ? { startedAt: timeRange.startedAt, endedAt: timeRange.endedAt }
        : null,
      time_range: timeRange
        ? { started_at: timeRange.startedAt, ended_at: timeRange.endedAt }
        : null,
      limit: max,
    },
    createdCount: created.length,
    created_count: created.length,
    skippedCount: skipped.length,
    skipped_count: skipped.length,
    created,
    skipped,
    proofBoundary: {
      proofAcceptedByBuilder: false,
      proof_accepted_by_builder: false,
      message: "Evidence Inbox candidate generation creates unverified review material only; proof writes require verifier approval and the strict proof-ledger adapter.",
    },
    proof_boundary: {
      proof_accepted_by_builder: false,
      message: "Evidence Inbox candidate generation creates unverified review material only; proof writes require verifier approval and the strict proof-ledger adapter.",
    },
  };
}

function productEventToCandidate(event, mapping, { createdAt }) {
  const sourceIds = normalizeSourceObjects(event.source_ids_json);
  const eventSource = {
    id: event.id,
    source_kind: SOURCE_KIND_PRODUCT_EVENT,
    source_type: SOURCE_KIND_PRODUCT_EVENT,
  };
  const allSourceIds = [
    eventSource,
    ...sourceIds,
  ];
  const status = sourceIds.length ? "pending_review" : "degraded";
  const claim = cleanString(`${event.title}: ${event.summary}`, 500);
  const evidenceDebt = [
    ...mapping.evidenceDebt,
    ...(sourceIds.length ? [] : ["Recorder product event has no source ids, so source identity must be repaired before review."]),
    "Product events, memory summaries, raw frames, search hits, and pipe output are not proof without accepted external verifier review.",
  ];
  const fingerprint = sha256Hex(JSON.stringify({
    eventId: event.id,
    eventType: event.event_type,
    occurredAt: event.occurred_at,
    title: event.title,
    summary: event.summary,
    sourceIds: allSourceIds,
    mapping,
  }));
  const candidateId = `recorder-candidate-${fingerprint.slice(0, 24)}`;

  return {
    id: candidateId,
    workspaceId: cleanNullableString(event.workspace_id),
    projectId: cleanNullableString(event.project_id),
    candidateStatus: status,
    sourceState: event.safe_for_memory === 1 ? "memory_safe" : "searchable_local",
    claim,
    proofKind: mapping.proofKind,
    sourceIds: allSourceIds,
    proofLedgerMapping: {
      targetGate: mapping.targetGate,
      event: {
        type: mapping.proofEventType,
        status: "submitted",
        strength: mapping.strength,
        evidenceType: "recorder_candidate",
        title: event.title,
        summary: event.summary,
        refs: allSourceIds.map((item) => item.id),
        metadata: {
          targetGate: mapping.targetGate,
          recorderProductEventId: event.id,
          recorder_product_event_id: event.id,
          recorderCandidateSource: "evidence-inbox-builder",
          recorder_candidate_source: "evidence-inbox-builder",
        },
      },
    },
    evidenceDebt,
    immutableFingerprint: `sha256:${fingerprint}`,
    idempotencyKey: `recorder-evidence:${fingerprint}`,
    createdBy: "evidence-inbox-builder",
    createdAt,
  };
}

function isEligibleProductEvent(row, { scope, timeRange }) {
  if (!row || row.deleted_at) return false;
  if (row.verification_status !== "unverified") return false;
  if (row.safe_for_memory !== 1) return false;
  if (scope.workspaceId && row.workspace_id !== scope.workspaceId) return false;
  if (scope.projectId && row.project_id !== scope.projectId) return false;
  if (!matchesTimeRange(row.occurred_at, timeRange)) return false;
  return true;
}

function assertSafeProductEventText(event) {
  const text = `${event.title || ""}\n${event.summary || ""}`;
  if (UNSAFE_TEXT_PATTERN.test(text)) {
    fail("ERR_RECORDER_EVIDENCE_BUILDER_UNSAFE_PRODUCT_EVENT_TEXT", "safe_for_memory product event appears to contain unredacted sensitive text", {
      productEventId: event.id,
      product_event_id: event.id,
    });
  }
}

function normalizeSourceObjects(value) {
  let parsed = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      parsed = [];
    }
  }
  const input = Array.isArray(parsed) ? parsed : [];
  const output = [];
  const seen = new Set();
  for (const item of input) {
    const source = localSourceObject(item);
    if (!source.id || seen.has(source.id)) continue;
    seen.add(source.id);
    output.push(source);
  }
  return output;
}

function localSourceObject(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const id = cleanString(value.id ?? value.sourceId ?? value.source_id, 240);
    const sourceType = cleanString(value.sourceType ?? value.source_type ?? value.kind ?? value.sourceKind ?? value.source_kind, 120);
    return {
      id,
      source_kind: nonProofSourceKind(sourceType),
      source_type: nonProofSourceKind(sourceType),
    };
  }
  const id = cleanString(value, 240);
  const prefix = id.includes(":") ? id.split(":")[0] : "";
  return {
    id,
    source_kind: nonProofSourceKind(prefix),
    source_type: nonProofSourceKind(prefix),
  };
}

function nonProofSourceKind(value) {
  const sourceType = cleanString(value, 120).toLowerCase();
  if (["frame", "screen", "screenshot"].includes(sourceType)) return "raw_frame";
  if (["memory", "memory_item", "memory_summary"].includes(sourceType)) return "memory_summary";
  if (["transcript", "transcript_segment", "audio"].includes(sourceType)) return "transcript_hit";
  if (["search", "search_hit", "raw_search_hit"].includes(sourceType)) return "raw_search_hit";
  if (sourceType === "product_event") return "product_event";
  if (sourceType === "pipe_output") return "pipe_output";
  return "internal_trace";
}

function skip(event, reason) {
  return {
    productEventId: event?.id || "",
    product_event_id: event?.id || "",
    eventType: event?.event_type || "",
    event_type: event?.event_type || "",
    reason,
  };
}

function normalizeLimit(limit) {
  const parsed = Number.parseInt(String(limit), 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    fail("ERR_RECORDER_EVIDENCE_BUILDER_INVALID_LIMIT", "Evidence Inbox candidate build limit must be a positive integer", {
      limit,
    });
  }
  return Math.min(MAX_LIMIT, parsed);
}

function normalizeTimeRange({ startedAt, endedAt }) {
  const hasStart = startedAt !== null && startedAt !== undefined && String(startedAt).trim() !== "";
  const hasEnd = endedAt !== null && endedAt !== undefined && String(endedAt).trim() !== "";
  if (!hasStart && !hasEnd) return null;
  if (!hasStart || !hasEnd) {
    fail("ERR_RECORDER_EVIDENCE_BUILDER_INCOMPLETE_TIME_RANGE", "Evidence Inbox candidate build time range requires both startedAt and endedAt");
  }
  const start = parseRequiredDate(startedAt, "startedAt");
  const end = parseRequiredDate(endedAt, "endedAt");
  if (end.getTime() <= start.getTime()) {
    fail("ERR_RECORDER_EVIDENCE_BUILDER_INVALID_TIME_RANGE", "Evidence Inbox candidate build endedAt must be after startedAt");
  }
  return {
    startedAt: start.toISOString(),
    endedAt: end.toISOString(),
  };
}

function matchesTimeRange(timestamp, timeRange) {
  if (!timeRange) return true;
  const date = parseDateOrNull(timestamp);
  if (!date) return false;
  return date.getTime() >= Date.parse(timeRange.startedAt)
    && date.getTime() < Date.parse(timeRange.endedAt);
}

function parseRequiredDate(value, fieldName) {
  const date = parseDateOrNull(value);
  if (!date) {
    fail("ERR_RECORDER_EVIDENCE_BUILDER_INVALID_DATE", "Evidence Inbox candidate build date must be valid ISO-compatible input", {
      fieldName,
      field_name: fieldName,
      value,
    });
  }
  return date;
}

function parseDateOrNull(value) {
  const date = value instanceof Date ? value : new Date(value ?? "");
  return Number.isNaN(date.getTime()) ? null : date;
}

function toIso(value) {
  return parseRequiredDate(value, "timestamp").toISOString();
}

function cleanNullableString(value) {
  const text = cleanString(value, 240);
  return text || null;
}

function cleanString(value = "", maxLength = 500) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function sha256Hex(value = "") {
  return createHash("sha256").update(String(value || "")).digest("hex");
}

function fail(code, message, details = {}) {
  throw new RecorderEvidenceInboxBuilderError(code, message, details);
}
