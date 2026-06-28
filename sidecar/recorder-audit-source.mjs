import { RECORDER_ACCESS_LEVELS } from "./recorder-raw-api-auth.mjs";

export const RECORDER_AUDIT_SOURCE_SCHEMA_VERSION = 1;

const AUDIT_SOURCE_SCHEMA = "agentic30.recorder.audit_source.v1";
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const ACCESS_LEVEL_SET = new Set(RECORDER_ACCESS_LEVELS);
const DECISION_SET = new Set(["accepted", "denied"]);

export class RecorderAuditSourceError extends Error {
  constructor(code, message, details = {}) {
    super(`${code}: ${message}`);
    this.name = "RecorderAuditSourceError";
    this.code = code;
    this.details = details;
  }
}

export function buildRecorderAuditSource({
  store,
  workspaceId = null,
  projectId = null,
  endpoint = null,
  accessLevel = null,
  decision = null,
  limit = DEFAULT_LIMIT,
  now = new Date(),
} = {}) {
  assertStore(store);
  const filters = normalizeFilters({ workspaceId, projectId, endpoint, accessLevel, decision, limit });
  const audit = store.listRecords("recorder_audit", { limit: 5000 })
    .filter((row) => auditRowMatchesFilters(row, filters))
    .sort((lhs, rhs) => String(rhs.created_at || "").localeCompare(String(lhs.created_at || "")))
    .slice(0, filters.limit)
    .map(auditDto);

  return {
    schema: AUDIT_SOURCE_SCHEMA,
    schemaVersion: RECORDER_AUDIT_SOURCE_SCHEMA_VERSION,
    schema_version: RECORDER_AUDIT_SOURCE_SCHEMA_VERSION,
    generatedAt: toIso(now),
    generated_at: toIso(now),
    filters,
    resultCount: audit.length,
    result_count: audit.length,
    audit,
    proofAcceptedByAuditSource: false,
    proof_accepted_by_audit_source: false,
    proofBoundary: proofBoundary(),
    proof_boundary: proofBoundary(),
  };
}

function auditRowMatchesFilters(row, filters) {
  if (filters.workspaceId && row.workspace_id !== filters.workspaceId) return false;
  if (filters.projectId && row.project_id !== filters.projectId) return false;
  if (filters.endpoint && row.endpoint !== filters.endpoint) return false;
  if (filters.accessLevel && row.access_level !== filters.accessLevel) return false;
  if (filters.decision && row.decision !== filters.decision) return false;
  return true;
}

function auditDto(row) {
  const sourceIds = parseAuditSourceIds(row.source_ids_json);
  return {
    id: cleanString(row.id, 240),
    requestId: cleanString(row.request_id, 240),
    request_id: cleanString(row.request_id, 240),
    actorType: cleanString(row.actor_type, 80),
    actor_type: cleanString(row.actor_type, 80),
    actorId: cleanString(row.actor_id, 180),
    actor_id: cleanString(row.actor_id, 180),
    workspaceId: cleanString(row.workspace_id, 240) || null,
    workspace_id: cleanString(row.workspace_id, 240) || null,
    projectId: cleanString(row.project_id, 240) || null,
    project_id: cleanString(row.project_id, 240) || null,
    endpoint: cleanString(row.endpoint, 240),
    accessLevel: cleanString(row.access_level, 80),
    access_level: cleanString(row.access_level, 80),
    sourceIds,
    source_ids: sourceIds,
    decision: cleanString(row.decision, 80),
    reason: cleanString(row.reason, 500),
    createdAt: cleanString(row.created_at, 80),
    created_at: cleanString(row.created_at, 80),
  };
}

function normalizeFilters({ workspaceId, projectId, endpoint, accessLevel, decision, limit }) {
  return {
    workspaceId: cleanString(workspaceId, 240) || null,
    workspace_id: cleanString(workspaceId, 240) || null,
    projectId: cleanString(projectId, 240) || null,
    project_id: cleanString(projectId, 240) || null,
    endpoint: cleanString(endpoint, 240) || null,
    accessLevel: normalizeAccessLevelFilter(accessLevel),
    access_level: normalizeAccessLevelFilter(accessLevel),
    decision: normalizeDecisionFilter(decision),
    limit: normalizeLimit(limit),
  };
}

function normalizeAccessLevelFilter(value) {
  const accessLevel = cleanString(value, 80);
  if (!accessLevel) return null;
  if (!ACCESS_LEVEL_SET.has(accessLevel)) {
    fail("ERR_RECORDER_AUDIT_SOURCE_ACCESS_LEVEL_UNKNOWN", `unknown recorder audit access level: ${accessLevel}`);
  }
  return accessLevel;
}

function normalizeDecisionFilter(value) {
  const decision = cleanString(value, 80);
  if (!decision) return null;
  if (!DECISION_SET.has(decision)) {
    fail("ERR_RECORDER_AUDIT_SOURCE_DECISION_UNKNOWN", "recorder audit decision filter must be accepted or denied", {
      decision,
    });
  }
  return decision;
}

function normalizeLimit(value) {
  const parsed = Number.parseInt(String(value ?? DEFAULT_LIMIT), 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    fail("ERR_RECORDER_AUDIT_SOURCE_INVALID_LIMIT", "recorder audit source limit must be a positive integer");
  }
  return Math.min(MAX_LIMIT, parsed);
}

function parseAuditSourceIds(value) {
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    return [];
  }
  const input = Array.isArray(parsed) ? parsed : [];
  const output = [];
  const seen = new Set();
  for (const item of input) {
    const id = typeof item === "string"
      ? cleanString(item, 240)
      : cleanString(item?.id ?? item?.sourceId ?? item?.source_id, 240);
    if (!id || seen.has(id)) continue;
    if (id.startsWith("/") || id.includes("../")) {
      fail("ERR_RECORDER_AUDIT_SOURCE_ID_UNSAFE", "recorder audit source IDs must not expose filesystem paths", {
        id,
      });
    }
    seen.add(id);
    const sourceType = typeof item === "string"
      ? "unknown"
      : cleanString(item?.sourceType ?? item?.source_type ?? item?.sourceKind ?? item?.source_kind, 80) || "unknown";
    output.push({
      id,
      sourceType,
      source_type: sourceType,
    });
  }
  return output.slice(0, 100);
}

function proofBoundary() {
  return {
    proofAcceptedByAuditSource: false,
    proof_accepted_by_audit_source: false,
    proofAcceptedByRawApi: false,
    proof_accepted_by_raw_api: false,
    proofLedgerWriteAllowed: false,
    proof_ledger_write_allowed: false,
    reason: "recorder_audit_source_lists_access_events_only",
  };
}

function assertStore(store) {
  if (!store || typeof store.listRecords !== "function") {
    fail("ERR_RECORDER_AUDIT_SOURCE_STORE_REQUIRED", "recorder audit source requires a RecorderStore-like store");
  }
}

function cleanString(value = "", maxLength = 500) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function toIso(value) {
  const date = value instanceof Date ? value : new Date(value ?? Date.now());
  if (Number.isNaN(date.getTime())) {
    fail("ERR_RECORDER_AUDIT_SOURCE_INVALID_TIMESTAMP", "recorder audit source received an invalid timestamp");
  }
  return date.toISOString();
}

function fail(code, message, details = {}) {
  throw new RecorderAuditSourceError(code, message, details);
}
