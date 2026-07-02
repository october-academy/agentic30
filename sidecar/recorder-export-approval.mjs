import { randomUUID } from "node:crypto";

export const RECORDER_EXPORT_APPROVAL_SCHEMA_VERSION = 1;
export const DEFAULT_EXPORT_APPROVAL_TTL_MS = 2 * 60 * 1000;
export const MAX_EXPORT_APPROVAL_TTL_MS = 5 * 60 * 1000;

export class RecorderExportApprovalError extends Error {
  constructor(code, message, details = {}) {
    super(`${code}: ${message}`);
    this.name = "RecorderExportApprovalError";
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details = {}) {
  throw new RecorderExportApprovalError(code, message, details);
}

function cleanString(value = "", maxLength = 240) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function toIso(value, label) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    fail("ERR_RECORDER_EXPORT_APPROVAL_INVALID_TIMESTAMP", `recorder export approval received an invalid ${label}`);
  }
  return date.toISOString();
}

// Approval grants are deliberately in-memory only: an export-archive approval
// is an ephemeral interactive act, and persisting it would let a stale
// approval survive a sidecar restart. Fail-closed means "restart forgets".
export function createRecorderExportApprovals() {
  return { grants: new Map() };
}

function assertApprovals(approvals) {
  if (!approvals || !(approvals.grants instanceof Map)) {
    fail("ERR_RECORDER_EXPORT_APPROVAL_STATE_INVALID", "recorder export approval state is not initialized");
  }
}

function pruneExpiredGrants(approvals, nowMs) {
  for (const [id, grant] of approvals.grants) {
    if (Date.parse(grant.expiresAt) <= nowMs) {
      approvals.grants.delete(id);
    }
  }
}

export function createRecorderExportApprovalGrant(approvals, {
  reason,
  ttlMs = DEFAULT_EXPORT_APPROVAL_TTL_MS,
  now = new Date(),
} = {}) {
  assertApprovals(approvals);
  const createdAt = toIso(now, "now");
  const nowMs = Date.parse(createdAt);
  const ttl = Number(ttlMs);
  if (!Number.isInteger(ttl) || ttl <= 0) {
    fail("ERR_RECORDER_EXPORT_APPROVAL_TTL_INVALID", "recorder export approval ttlMs must be a positive integer", {
      ttlMs,
    });
  }
  if (ttl > MAX_EXPORT_APPROVAL_TTL_MS) {
    fail("ERR_RECORDER_EXPORT_APPROVAL_TTL_TOO_LONG", "recorder export approval ttlMs exceeds the maximum allowed", {
      ttlMs: ttl,
      maxTtlMs: MAX_EXPORT_APPROVAL_TTL_MS,
      max_ttl_ms: MAX_EXPORT_APPROVAL_TTL_MS,
    });
  }
  pruneExpiredGrants(approvals, nowMs);
  const grant = {
    id: `recorder-export-approval-${randomUUID()}`,
    reason: cleanString(reason) || "manual_export_archive",
    createdAt,
    expiresAt: new Date(nowMs + ttl).toISOString(),
    ttlMs: ttl,
    consumedAt: null,
  };
  approvals.grants.set(grant.id, grant);
  return recorderExportApprovalGrantDto(grant);
}

export function consumeRecorderExportApprovalGrant(approvals, {
  approvalGrantId,
  now = new Date(),
} = {}) {
  assertApprovals(approvals);
  const id = cleanString(approvalGrantId);
  if (!id) return false;
  const nowMs = Date.parse(toIso(now, "now"));
  pruneExpiredGrants(approvals, nowMs);
  const grant = approvals.grants.get(id);
  if (!grant || grant.consumedAt) return false;
  if (Date.parse(grant.expiresAt) <= nowMs) {
    approvals.grants.delete(id);
    return false;
  }
  grant.consumedAt = new Date(nowMs).toISOString();
  approvals.grants.delete(id);
  return true;
}

export function buildRecorderExportApprovalVerifier(approvals, { now = () => new Date() } = {}) {
  assertApprovals(approvals);
  return async ({ approvalGrantId } = {}) => consumeRecorderExportApprovalGrant(approvals, {
    approvalGrantId,
    now: typeof now === "function" ? now() : now,
  });
}

function recorderExportApprovalGrantDto(grant) {
  return {
    schemaVersion: RECORDER_EXPORT_APPROVAL_SCHEMA_VERSION,
    schema_version: RECORDER_EXPORT_APPROVAL_SCHEMA_VERSION,
    id: grant.id,
    reason: grant.reason,
    createdAt: grant.createdAt,
    created_at: grant.createdAt,
    expiresAt: grant.expiresAt,
    expires_at: grant.expiresAt,
    ttlMs: grant.ttlMs,
    ttl_ms: grant.ttlMs,
    oneShot: true,
    one_shot: true,
    proofAcceptedByExportApproval: false,
    proof_accepted_by_export_approval: false,
  };
}
