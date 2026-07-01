import { assertRecorderRedactionPolicyForRecord } from "./recorder-redaction-policy.mjs";

export const RECORDER_SEARCH_SCHEMA_VERSION = 1;

const RECORDER_SEARCH_SCHEMA = "agentic30.recorder.search.v1";
const DEFAULT_SOURCE_TYPES = Object.freeze(["frame", "transcript", "memory", "product_event"]);
const ALLOWED_SOURCE_TYPES = new Set(DEFAULT_SOURCE_TYPES);

const SOURCE_TABLE_BY_TYPE = Object.freeze({
  frame: "frames",
  transcript: "transcript_segments",
  memory: "memory_items",
  product_event: "product_events",
});

export class RecorderSearchError extends Error {
  constructor(code, message, details = {}) {
    super(`${code}: ${message}`);
    this.name = "RecorderSearchError";
    this.code = code;
    this.details = details;
  }
}

export function buildRecorderSearchResults({
  store,
  query,
  workspaceId = null,
  projectId = null,
  startedAt = null,
  endedAt = null,
  sourceTypes = DEFAULT_SOURCE_TYPES,
  limit = 20,
  now = new Date(),
} = {}) {
  if (!store || typeof store.search !== "function" || typeof store.getRecord !== "function") {
    fail("ERR_RECORDER_SEARCH_STORE_REQUIRED", "buildRecorderSearchResults requires a RecorderStore-like store");
  }

  const normalizedQuery = cleanString(query, 400);
  if (!normalizedQuery) {
    fail("ERR_RECORDER_SEARCH_QUERY_REQUIRED", "Recorder search requires a non-empty query");
  }

  const normalizedSourceTypes = normalizeSourceTypes(sourceTypes);
  const max = normalizeLimit(limit);
  const timeRange = normalizeTimeRange({ startedAt, endedAt });
  const scope = {
    workspaceId: cleanNullableString(workspaceId),
    projectId: cleanNullableString(projectId),
  };

  const rawResults = store.search(normalizedQuery, {
    limit: 100,
    sourceTypes: normalizedSourceTypes,
  });

  const results = [];
  for (const rawResult of rawResults) {
    const sourceType = rawResult?.source_type;
    const table = SOURCE_TABLE_BY_TYPE[sourceType];
    if (!table) continue;
    const sourceId = cleanString(rawResult.source_id, 240);
    if (!sourceId) continue;
    const record = store.getRecord(table, sourceId);
    if (!record || !isSearchSafeRecord(record)) continue;
    if (!matchesScope(record, scope)) continue;
    if (!matchesTimeRange(recordTimestamp(sourceType, record), timeRange)) continue;
    assertSearchPublicRecord(table, record, sourceType);
    results.push(toSearchResult(rawResult, record));
    if (results.length >= max) break;
  }

  const emptyStates = results.length ? [] : [
    {
      id: "no_redacted_search_results",
      severity: "info",
      message: "No redacted recorder search results matched the query and scope.",
    },
  ];

  return {
    schema: RECORDER_SEARCH_SCHEMA,
    schemaVersion: RECORDER_SEARCH_SCHEMA_VERSION,
    schema_version: RECORDER_SEARCH_SCHEMA_VERSION,
    generatedAt: toIso(now),
    generated_at: toIso(now),
    query: normalizedQuery,
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
      sourceTypes: normalizedSourceTypes,
      source_types: normalizedSourceTypes,
      limit: max,
    },
    resultCount: results.length,
    result_count: results.length,
    results,
    emptyStates,
    empty_states: emptyStates,
    proofBoundary: {
      proofAcceptedBySearch: false,
      proof_accepted_by_search: false,
      message: "Recorder search results are memory context and evidence input, not accepted proof.",
    },
    proof_boundary: {
      proof_accepted_by_search: false,
      message: "Recorder search results are memory context and evidence input, not accepted proof.",
    },
  };
}

function toSearchResult(rawResult, record) {
  const sourceType = rawResult.source_type;
  const sourceId = cleanString(rawResult.source_id, 240);
  const timestamp = toIso(recordTimestamp(sourceType, record));
  const result = {
    id: `${sourceType}:${sourceId}`,
    sourceType,
    source_type: sourceType,
    sourceId,
    source_id: sourceId,
    timestamp,
    snippet: cleanString(rawResult.snippet, 1000),
    metadata: metadataFor(sourceType, rawResult, record),
  };
  const title = cleanString(rawResult.title ?? record.title, 240);
  if (title) result.title = title;
  return result;
}

function metadataFor(sourceType, rawResult, record) {
  if (sourceType === "frame") {
    return stripEmpty({
      appName: cleanString(rawResult.app_name ?? record.app_name, 160),
      app_name: cleanString(rawResult.app_name ?? record.app_name, 160),
      windowTitle: cleanString(rawResult.window_title ?? record.window_title, 240),
      window_title: cleanString(rawResult.window_title ?? record.window_title, 240),
      browserDomain: cleanString(rawResult.browser_domain ?? record.browser_domain, 240),
      browser_domain: cleanString(rawResult.browser_domain ?? record.browser_domain, 240),
      browserUrlSearchLabel: cleanString(rawResult.browser_url_search_label ?? record.browser_url_search_label, 240),
      browser_url_search_label: cleanString(rawResult.browser_url_search_label ?? record.browser_url_search_label, 240),
      documentPathSearchLabel: cleanString(rawResult.document_path_search_label ?? record.document_path_search_label, 240),
      document_path_search_label: cleanString(rawResult.document_path_search_label ?? record.document_path_search_label, 240),
      captureTrigger: cleanString(record.capture_trigger, 120),
      capture_trigger: cleanString(record.capture_trigger, 120),
      textSource: cleanString(record.text_source, 80),
      text_source: cleanString(record.text_source, 80),
    });
  }
  if (sourceType === "transcript") {
    return stripEmpty({
      speakerLabel: cleanString(rawResult.speaker_label ?? record.speaker_label, 120),
      speaker_label: cleanString(rawResult.speaker_label ?? record.speaker_label, 120),
    });
  }
  if (sourceType === "memory") {
    return stripEmpty({
      memoryType: cleanString(record.memory_type, 120),
      memory_type: cleanString(record.memory_type, 120),
      confidence: cleanString(record.confidence, 80),
      createdBy: cleanString(record.created_by, 120),
      created_by: cleanString(record.created_by, 120),
    });
  }
  if (sourceType === "product_event") {
    return stripEmpty({
      eventType: cleanString(rawResult.event_type ?? record.event_type, 120),
      event_type: cleanString(rawResult.event_type ?? record.event_type, 120),
      verificationStatus: cleanString(record.verification_status, 120),
      verification_status: cleanString(record.verification_status, 120),
      confidence: cleanString(record.confidence, 80),
      createdBy: cleanString(record.created_by, 120),
      created_by: cleanString(record.created_by, 120),
    });
  }
  return {};
}

function normalizeSourceTypes(sourceTypes) {
  const values = Array.isArray(sourceTypes) ? sourceTypes : [sourceTypes];
  const normalized = [];
  const seen = new Set();
  for (const value of values) {
    const sourceType = cleanString(value, 80);
    if (!sourceType) continue;
    if (!ALLOWED_SOURCE_TYPES.has(sourceType)) {
      fail("ERR_RECORDER_SEARCH_UNKNOWN_SOURCE_TYPE", "Recorder search source type is not supported", {
        sourceType,
        source_type: sourceType,
      });
    }
    if (!seen.has(sourceType)) {
      seen.add(sourceType);
      normalized.push(sourceType);
    }
  }
  if (!normalized.length) {
    fail("ERR_RECORDER_SEARCH_SOURCE_TYPES_REQUIRED", "Recorder search requires at least one source type");
  }
  return normalized;
}

function normalizeLimit(limit) {
  const parsed = Number.parseInt(String(limit), 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    fail("ERR_RECORDER_SEARCH_INVALID_LIMIT", "Recorder search limit must be a positive integer", {
      limit,
    });
  }
  return Math.min(50, parsed);
}

function normalizeTimeRange({ startedAt, endedAt }) {
  const hasStart = startedAt !== null && startedAt !== undefined && String(startedAt).trim() !== "";
  const hasEnd = endedAt !== null && endedAt !== undefined && String(endedAt).trim() !== "";
  if (!hasStart && !hasEnd) return null;
  if (!hasStart || !hasEnd) {
    fail("ERR_RECORDER_SEARCH_INCOMPLETE_TIME_RANGE", "Recorder search time range requires both startedAt and endedAt");
  }
  const start = parseRequiredDate(startedAt, "startedAt");
  const end = parseRequiredDate(endedAt, "endedAt");
  if (end.getTime() <= start.getTime()) {
    fail("ERR_RECORDER_SEARCH_INVALID_TIME_RANGE", "Recorder search endedAt must be after startedAt");
  }
  return {
    startedAt: start.toISOString(),
    endedAt: end.toISOString(),
  };
}

function matchesScope(record, scope) {
  if (scope.workspaceId && record.workspace_id !== scope.workspaceId) return false;
  if (scope.projectId && record.project_id !== scope.projectId) return false;
  return true;
}

function matchesTimeRange(timestamp, timeRange) {
  if (!timeRange) return true;
  const date = parseDateOrNull(timestamp);
  if (!date) return false;
  return date.getTime() >= Date.parse(timeRange.startedAt)
    && date.getTime() < Date.parse(timeRange.endedAt);
}

function recordTimestamp(sourceType, record) {
  if (sourceType === "frame") return record.captured_at;
  if (sourceType === "transcript") return record.started_at;
  if (sourceType === "memory") return record.created_at;
  if (sourceType === "product_event") return record.occurred_at;
  return null;
}

function isSearchSafeRecord(record) {
  return Number(record.safe_for_search) === 1 && !record.deleted_at;
}

function assertSearchPublicRecord(tableName, record = {}, sourceType = "") {
  try {
    assertRecorderRedactionPolicyForRecord(tableName, record, { fail });
  } catch (error) {
    const policyErrorCode = cleanString(error?.code, 160) || "ERR_RECORDER_REDACTION_POLICY_FAILED";
    fail(
      "ERR_RECORDER_SEARCH_UNSAFE_PUBLIC_RECORD",
      `Recorder search refused to expose ${sourceType || tableName} result because ${policyErrorCode}`,
      {
        tableName,
        table_name: tableName,
        sourceType: cleanString(sourceType, 80),
        source_type: cleanString(sourceType, 80),
        sourceId: cleanString(record?.id, 240) || null,
        source_id: cleanString(record?.id, 240) || null,
        policyErrorCode,
        policy_error_code: policyErrorCode,
      },
    );
  }
}

function stripEmpty(object) {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== ""));
}

function parseRequiredDate(value, fieldName) {
  const date = parseDateOrNull(value);
  if (!date) {
    fail("ERR_RECORDER_SEARCH_INVALID_DATE", "Recorder search date must be valid ISO-compatible input", {
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

function fail(code, message, details = {}) {
  throw new RecorderSearchError(code, message, details);
}
