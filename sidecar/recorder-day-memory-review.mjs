import path from "node:path";

import { atomicWriteJson, withFileLock } from "./atomic-store.mjs";

export const RECORDER_DAY_MEMORY_REVIEW_SCHEMA_VERSION = 1;

const SAFE_REDACTION_STATUSES = new Set([
  "redacted",
  "safe",
  "safe_redacted",
  "allowlisted",
]);

const EVIDENCE_STATUSES = [
  "pending_review",
  "degraded",
  "rejected",
  "approved_bundle",
  "verifier_rejected",
  "written_to_ledger",
];

export class RecorderDayMemoryReviewError extends Error {
  constructor(code, message, details = {}) {
    super(`${code}: ${message}`);
    this.name = "RecorderDayMemoryReviewError";
    this.code = code;
    this.details = details;
  }
}

export function buildRecorderDayMemoryReview({
  store,
  startedAt,
  endedAt,
  workspaceId = null,
  projectId = null,
  now = new Date(),
  limit = 2000,
} = {}) {
  if (!store) {
    fail("ERR_RECORDER_DAY_REVIEW_STORE_REQUIRED", "buildRecorderDayMemoryReview requires store");
  }
  const range = normalizeTimeRange({ startedAt, endedAt });
  const max = Math.max(1, Math.min(5000, Number.parseInt(String(limit), 10) || 2000));
  const generatedAt = toIso(now);
  const scope = {
    workspaceId: textOrNull(workspaceId),
    workspace_id: textOrNull(workspaceId),
    projectId: textOrNull(projectId),
    project_id: textOrNull(projectId),
  };

  const frames = scopedRows(
    store.listRecords("frames", { limit: max }),
    { workspaceId: scope.workspaceId, projectId: scope.projectId, timeField: "captured_at", range },
  );
  const activeFrames = frames.filter((row) => !row.deleted_at);
  const productEvents = scopedRows(
    store.listRecords("product_events", { limit: max }),
    { workspaceId: scope.workspaceId, projectId: scope.projectId, timeField: "occurred_at", range },
  ).filter((row) => !row.deleted_at);
  const evidenceCandidates = scopedRows(
    store.listRecords("evidence_candidates", { limit: max }),
    { workspaceId: scope.workspaceId, projectId: scope.projectId, timeField: "created_at", range },
  ).filter((row) => !row.deleted_at);
  const memoryItems = scopedRows(
    store.listRecords("memory_items", { limit: max }),
    { workspaceId: scope.workspaceId, projectId: scope.projectId, timeField: "created_at", range },
  ).filter((row) => !row.deleted_at);

  const capture = buildCaptureSummary({ frames, activeFrames });
  const evidenceInbox = buildEvidenceInboxSummary(evidenceCandidates);
  const productEventSummary = buildProductEventSummary(productEvents);
  const memorySummary = buildMemorySummary(memoryItems);
  const emptyStates = buildEmptyStates({
    activeFrames,
    productEvents,
    evidenceInbox,
  });
  const warnings = buildWarnings({
    capture,
    evidenceInbox,
    memorySummary,
  });

  return {
    schemaVersion: RECORDER_DAY_MEMORY_REVIEW_SCHEMA_VERSION,
    schema_version: RECORDER_DAY_MEMORY_REVIEW_SCHEMA_VERSION,
    schema: "agentic30.recorder.day_memory_review.v1",
    componentType: "recorder_day_memory_review",
    component_type: "recorder_day_memory_review",
    generatedAt,
    generated_at: generatedAt,
    timeRange: {
      startedAt: range.startedAt,
      started_at: range.startedAt,
      endedAt: range.endedAt,
      ended_at: range.endedAt,
    },
    time_range: {
      started_at: range.startedAt,
      ended_at: range.endedAt,
    },
    scope,
    status: {
      state: activeFrames.length ? "ready" : "empty",
      reason: activeFrames.length ? "recorder_rows_available" : "no_capture_rows",
    },
    capture,
    productEvents: productEventSummary,
    product_events: productEventSummary,
    memoryItems: memorySummary,
    memory_items: memorySummary,
    evidenceInbox,
    evidence_inbox: evidenceInbox,
    emptyStates,
    empty_states: emptyStates,
    warnings,
    proofBoundary: {
      proofAcceptedByReview: false,
      proof_accepted_by_review: false,
      statement: "Day Memory Review is not proof. Only verifier-compatible proof-ledger writes count.",
    },
    proof_boundary: {
      proof_accepted_by_review: false,
      statement: "Day Memory Review is not proof. Only verifier-compatible proof-ledger writes count.",
    },
  };
}

export function resolveRecorderMemorySummariesDir(workspaceRoot) {
  const root = cleanText(workspaceRoot, 2000);
  if (!root) {
    fail("ERR_RECORDER_DAY_REVIEW_WORKSPACE_REQUIRED", "workspaceRoot is required for memory summary snapshots");
  }
  return path.join(path.resolve(root), ".agentic30", "recorder", "memory-summaries");
}

export function resolveRecorderDayMemoryReviewSnapshotPath({ workspaceRoot, review } = {}) {
  const normalized = normalizeRecorderDayMemoryReviewSnapshot(review);
  const startedAt = normalized.timeRange.startedAt;
  const dateKey = startedAt.slice(0, 10);
  return path.join(resolveRecorderMemorySummariesDir(workspaceRoot), `day-memory-review-${dateKey}.json`);
}

export async function writeRecorderDayMemoryReviewSnapshot({
  workspaceRoot,
  review,
  now = new Date(),
} = {}) {
  const snapshot = normalizeRecorderDayMemoryReviewSnapshot(review, { now });
  const filePath = resolveRecorderDayMemoryReviewSnapshotPath({ workspaceRoot, review: snapshot });
  const relativePath = path.join(
    ".agentic30",
    "recorder",
    "memory-summaries",
    path.basename(filePath),
  );
  return withFileLock(filePath, async () => {
    await atomicWriteJson(filePath, snapshot);
    return {
      snapshot,
      filePath,
      file_path: filePath,
      relativePath,
      relative_path: relativePath,
    };
  });
}

export function normalizeRecorderDayMemoryReviewSnapshot(review = {}, { now = new Date() } = {}) {
  if (!review || typeof review !== "object" || Array.isArray(review)) {
    fail("ERR_RECORDER_DAY_REVIEW_INVALID_SNAPSHOT", "Day Memory Review snapshot must be an object");
  }
  if (review.schema !== "agentic30.recorder.day_memory_review.v1") {
    fail("ERR_RECORDER_DAY_REVIEW_INVALID_SCHEMA", "Day Memory Review snapshot has an unexpected schema", {
      schema: review.schema,
    });
  }
  assertNoUnsafeRawKeys(review);
  const startedAt = parseRequiredDate(review.timeRange?.startedAt ?? review.time_range?.started_at, "timeRange.startedAt");
  const endedAt = parseRequiredDate(review.timeRange?.endedAt ?? review.time_range?.ended_at, "timeRange.endedAt");
  if (endedAt.getTime() <= startedAt.getTime()) {
    fail("ERR_RECORDER_DAY_REVIEW_INVALID_RANGE", "Day Memory Review snapshot endedAt must be after startedAt");
  }
  return {
    ...review,
    schemaVersion: RECORDER_DAY_MEMORY_REVIEW_SCHEMA_VERSION,
    schema_version: RECORDER_DAY_MEMORY_REVIEW_SCHEMA_VERSION,
    persistedAt: toIso(now),
    persisted_at: toIso(now),
    timeRange: {
      ...review.timeRange,
      startedAt: startedAt.toISOString(),
      started_at: startedAt.toISOString(),
      endedAt: endedAt.toISOString(),
      ended_at: endedAt.toISOString(),
    },
    time_range: {
      ...(review.time_range || {}),
      started_at: startedAt.toISOString(),
      ended_at: endedAt.toISOString(),
    },
    proofBoundary: {
      ...(review.proofBoundary || {}),
      proofAcceptedByReview: false,
      proof_accepted_by_review: false,
    },
    proof_boundary: {
      ...(review.proof_boundary || {}),
      proof_accepted_by_review: false,
    },
  };
}

function buildCaptureSummary({ frames, activeFrames }) {
  const searchableFrames = activeFrames.filter((row) => row.safe_for_search === 1);
  const memorySafeFrames = activeFrames.filter((row) => row.safe_for_memory === 1);
  const samples = memorySafeFrames
    .filter((row) => safeRedacted(row) && textOrNull(row.redacted_text))
    .sort(descBy("captured_at"))
    .slice(0, 8)
    .map((row) => ({
      id: row.id,
      capturedAt: row.captured_at,
      captured_at: row.captured_at,
      appName: textOrNull(row.app_name),
      app_name: textOrNull(row.app_name),
      windowTitle: textOrNull(row.window_title),
      window_title: textOrNull(row.window_title),
      browserDomain: textOrNull(row.browser_domain),
      browser_domain: textOrNull(row.browser_domain),
      text: cleanText(row.redacted_text, 260),
      redactionStatus: row.redaction_status,
      redaction_status: row.redaction_status,
    }));
  return {
    frameCount: activeFrames.length,
    frame_count: activeFrames.length,
    deletedFrameCount: frames.length - activeFrames.length,
    deleted_frame_count: frames.length - activeFrames.length,
    searchSafeFrameCount: searchableFrames.length,
    search_safe_frame_count: searchableFrames.length,
    memorySafeFrameCount: memorySafeFrames.length,
    memory_safe_frame_count: memorySafeFrames.length,
    // topApps/topDomains expose hostile-controllable frame metadata
    // (app_name/browser_domain) as content in this memory_safe-labeled
    // snapshot, so they must be derived only from memory-safe frames — the
    // ones whose metadata passed the redaction-policy value scan at store
    // insert (same set samples[] uses). A raw_local frame (the default, all
    // safe_for_* = 0) is never sink-scanned, so aggregating it here leaked raw
    // email/secret-shaped app_name/browser_domain into the memory snapshot.
    // capture_trigger is a coarse collector-set id (not screen content), so it
    // stays over activeFrames.
    topApps: topCounts(memorySafeFrames.map((row) => row.app_name), 8),
    top_apps: topCounts(memorySafeFrames.map((row) => row.app_name), 8),
    topDomains: topCounts(memorySafeFrames.map((row) => row.browser_domain), 8),
    top_domains: topCounts(memorySafeFrames.map((row) => row.browser_domain), 8),
    triggers: topCounts(activeFrames.map((row) => row.capture_trigger), 8),
    samples,
  };
}

function buildProductEventSummary(rows) {
  const items = rows
    .sort(descBy("occurred_at"))
    .slice(0, 20)
    .map((row) => ({
      id: row.id,
      eventType: row.event_type,
      event_type: row.event_type,
      occurredAt: row.occurred_at,
      occurred_at: row.occurred_at,
      title: cleanText(row.title, 180),
      summary: cleanText(row.summary, 360),
      verificationStatus: row.verification_status,
      verification_status: row.verification_status,
      proofLedgerEventId: textOrNull(row.proof_ledger_event_id),
      proof_ledger_event_id: textOrNull(row.proof_ledger_event_id),
      sourceIds: parseJsonArray(row.source_ids_json).slice(0, 12),
      source_ids: parseJsonArray(row.source_ids_json).slice(0, 12),
    }));
  return {
    total: rows.length,
    byType: countBy(rows, "event_type"),
    by_type: countBy(rows, "event_type"),
    byVerificationStatus: countBy(rows, "verification_status"),
    by_verification_status: countBy(rows, "verification_status"),
    items,
  };
}

function buildEvidenceInboxSummary(rows) {
  const countsByStatus = Object.fromEntries(EVIDENCE_STATUSES.map((status) => [status, 0]));
  for (const row of rows) {
    const status = cleanToken(row.candidate_status);
    countsByStatus[status] = (countsByStatus[status] || 0) + 1;
  }
  const unresolvedStatuses = new Set(["pending_review", "degraded", "approved_bundle", "verifier_rejected"]);
  const unresolved = rows.filter((row) => unresolvedStatuses.has(cleanToken(row.candidate_status)));
  const writtenToLedger = rows.filter((row) => cleanToken(row.candidate_status) === "written_to_ledger");
  const candidates = rows
    .sort(descBy("created_at"))
    .slice(0, 20)
    .map((row) => ({
      id: row.id,
      candidateStatus: row.candidate_status,
      candidate_status: row.candidate_status,
      sourceState: row.source_state,
      source_state: row.source_state,
      proofKind: row.proof_kind,
      proof_kind: row.proof_kind,
      claim: cleanText(row.claim, 420),
      sourceIds: parseJsonArray(row.source_ids_json).slice(0, 12),
      source_ids: parseJsonArray(row.source_ids_json).slice(0, 12),
      proofLedgerEventId: textOrNull(row.proof_ledger_event_id),
      proof_ledger_event_id: textOrNull(row.proof_ledger_event_id),
      createdAt: row.created_at,
      created_at: row.created_at,
      reviewedAt: textOrNull(row.reviewed_at),
      reviewed_at: textOrNull(row.reviewed_at),
    }));
  return {
    total: rows.length,
    countsByStatus,
    counts_by_status: countsByStatus,
    unresolvedCount: unresolved.length,
    unresolved_count: unresolved.length,
    writtenToLedgerCount: writtenToLedger.length,
    written_to_ledger_count: writtenToLedger.length,
    candidates,
  };
}

function buildMemorySummary(rows) {
  const safeRows = rows.filter((row) => row.safe_for_memory === 1 && safeRedacted(row));
  const items = safeRows
    .sort(descBy("created_at"))
    .slice(0, 20)
    .map((row) => ({
      id: row.id,
      memoryType: row.memory_type,
      memory_type: row.memory_type,
      title: cleanText(row.title, 180),
      summary: cleanText(row.summary, 520),
      sourceIds: parseJsonArray(row.source_ids_json).slice(0, 12),
      source_ids: parseJsonArray(row.source_ids_json).slice(0, 12),
      confidence: cleanText(row.confidence, 80),
      createdBy: cleanText(row.created_by, 120),
      created_by: cleanText(row.created_by, 120),
      createdAt: row.created_at,
      created_at: row.created_at,
    }));
  return {
    total: rows.length,
    safeForMemoryCount: safeRows.length,
    safe_for_memory_count: safeRows.length,
    byType: countBy(rows, "memory_type"),
    by_type: countBy(rows, "memory_type"),
    items,
  };
}

function buildEmptyStates({ activeFrames, productEvents, evidenceInbox }) {
  const states = [];
  if (!activeFrames.length) {
    states.push({
      id: "no_capture",
      label: "No capture rows in range",
      action: "check_recorder_health",
    });
  }
  if (activeFrames.length && !productEvents.length) {
    states.push({
      id: "capture_but_no_product_signal",
      label: "Capture exists but no product event was derived",
      action: "ask_office_hours_narrowing_question",
    });
  }
  if (!evidenceInbox.writtenToLedgerCount) {
    states.push({
      id: "no_accepted_proof",
      label: "No recorder evidence has been written to the proof ledger",
      action: "open_evidence_inbox_or_choose_external_action",
    });
  }
  return states;
}

function buildWarnings({ capture, evidenceInbox, memorySummary }) {
  const warnings = [];
  if (capture.frameCount && !capture.searchSafeFrameCount) {
    warnings.push({
      id: "no_search_safe_frames",
      severity: "warning",
      message: "Captured frames exist, but none are safe for redacted search.",
    });
  }
  if (memorySummary.total && !memorySummary.safeForMemoryCount) {
    warnings.push({
      id: "no_memory_safe_items",
      severity: "warning",
      message: "Memory rows exist, but none are safe for Day Memory Review.",
    });
  }
  if (!evidenceInbox.writtenToLedgerCount) {
    warnings.push({
      id: "proof_not_advanced",
      severity: "info",
      message: "This review does not advance proof. A verifier-gated proof-ledger write is still required.",
    });
  }
  return warnings;
}

function scopedRows(rows, { workspaceId, projectId, timeField, range }) {
  return rows.filter((row) => {
    if (workspaceId && row.workspace_id !== workspaceId) return false;
    if (projectId && row.project_id !== projectId) return false;
    return inRange(row[timeField], range);
  });
}

function inRange(value, { startedAt, endedAt }) {
  const time = Date.parse(value);
  return Number.isFinite(time) && time >= Date.parse(startedAt) && time < Date.parse(endedAt);
}

function normalizeTimeRange({ startedAt, endedAt }) {
  const start = parseRequiredDate(startedAt, "startedAt");
  const end = parseRequiredDate(endedAt, "endedAt");
  if (end.getTime() <= start.getTime()) {
    fail("ERR_RECORDER_DAY_REVIEW_INVALID_RANGE", "endedAt must be after startedAt", {
      startedAt,
      endedAt,
    });
  }
  return {
    startedAt: start.toISOString(),
    endedAt: end.toISOString(),
  };
}

function parseRequiredDate(value, fieldName) {
  const date = value instanceof Date ? value : new Date(value ?? "");
  if (Number.isNaN(date.getTime())) {
    fail("ERR_RECORDER_DAY_REVIEW_INVALID_TIMESTAMP", `Day Memory Review requires valid ${fieldName}`, {
      fieldName,
      value,
    });
  }
  return date;
}

function assertNoUnsafeRawKeys(value, pathSegments = []) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoUnsafeRawKeys(item, [...pathSegments, String(index)]));
    return;
  }
  for (const [key, nested] of Object.entries(value)) {
    if ([
      "accessibility_text",
      "accessibilityText",
      "ocr_text",
      "ocrText",
      "browser_url",
      "browserUrl",
      "document_path",
      "documentPath",
      "snapshot_path",
      "snapshotPath",
      "relative_path",
      "relativePath",
    ].includes(key)) {
      fail("ERR_RECORDER_DAY_REVIEW_RAW_FIELD", "Day Memory Review snapshot includes an unsafe raw field", {
        fieldPath: [...pathSegments, key].join("."),
        field_path: [...pathSegments, key].join("."),
      });
    }
    assertNoUnsafeRawKeys(nested, [...pathSegments, key]);
  }
}

function safeRedacted(row) {
  return SAFE_REDACTION_STATUSES.has(cleanToken(row.redaction_status));
}

function countBy(rows, field) {
  const counts = {};
  for (const row of rows) {
    const key = cleanToken(row[field]) || "unknown";
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function topCounts(values, limit = 8) {
  const counts = {};
  for (const value of values) {
    const text = cleanText(value, 160);
    if (!text) continue;
    counts[text] = (counts[text] || 0) + 1;
  }
  return Object.entries(counts)
    .sort((lhs, rhs) => rhs[1] - lhs[1] || lhs[0].localeCompare(rhs[0]))
    .slice(0, limit)
    .map(([value, count]) => ({ value, count }));
}

function parseJsonArray(value) {
  try {
    const parsed = JSON.parse(String(value || "[]"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function descBy(field) {
  return (lhs, rhs) => String(rhs[field] || "").localeCompare(String(lhs[field] || ""));
}

function cleanToken(value) {
  return String(value ?? "").trim().toLowerCase();
}

function cleanText(value, maxLength = 500) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function textOrNull(value) {
  const text = cleanText(value, 500);
  return text || null;
}

function toIso(value) {
  const date = value instanceof Date ? value : new Date(value ?? Date.now());
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function fail(code, message, details = {}) {
  throw new RecorderDayMemoryReviewError(code, message, details);
}
