import {
  buildRecorderDayMemoryReview,
  writeRecorderDayMemoryReviewSnapshot,
} from "./recorder-day-memory-review.mjs";
import { buildRecorderEvidenceInboxCandidates } from "./recorder-evidence-inbox-builder.mjs";
import { buildRecorderNextAction } from "./recorder-next-action.mjs";

export const RECORDER_DAY_LOOP_SCHEMA_VERSION = 1;

export class RecorderDayLoopError extends Error {
  constructor(code, message, details = {}) {
    super(`${code}: ${message}`);
    this.name = "RecorderDayLoopError";
    this.code = code;
    this.details = details;
  }
}

export async function runRecorderDayMemoryLoop({
  store,
  workspaceRoot = null,
  workspaceId = null,
  projectId = null,
  startedAt,
  endedAt,
  now = new Date(),
  persistReviewSnapshot = false,
  limit = 2000,
} = {}) {
  if (!store) {
    fail("ERR_RECORDER_DAY_LOOP_STORE_REQUIRED", "runRecorderDayMemoryLoop requires store");
  }
  const generatedAt = toIso(now);
  const range = normalizeTimeRange({ startedAt, endedAt });
  const scope = {
    workspaceId: textOrNull(workspaceId),
    workspace_id: textOrNull(workspaceId),
    projectId: textOrNull(projectId),
    project_id: textOrNull(projectId),
  };

  const reviewBeforeEvidence = buildRecorderDayMemoryReview({
    store,
    startedAt: range.startedAt,
    endedAt: range.endedAt,
    workspaceId: scope.workspaceId,
    projectId: scope.projectId,
    now,
    limit,
  });
  const evidenceBuildResult = buildRecorderEvidenceInboxCandidates({
    store,
    startedAt: range.startedAt,
    endedAt: range.endedAt,
    workspaceId: scope.workspaceId,
    projectId: scope.projectId,
    now,
    limit,
  });
  const review = buildRecorderDayMemoryReview({
    store,
    startedAt: range.startedAt,
    endedAt: range.endedAt,
    workspaceId: scope.workspaceId,
    projectId: scope.projectId,
    now,
    limit,
  });
  const nextAction = buildRecorderNextAction({
    review,
    evidenceBuildResult,
    now,
  });
  const snapshot = await maybePersistReviewSnapshot({
    workspaceRoot,
    review,
    now,
    persistReviewSnapshot,
  });

  return {
    schema: "agentic30.recorder.day_loop.v1",
    schemaVersion: RECORDER_DAY_LOOP_SCHEMA_VERSION,
    schema_version: RECORDER_DAY_LOOP_SCHEMA_VERSION,
    generatedAt,
    generated_at: generatedAt,
    scope,
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
    stages: {
      reviewBeforeEvidence: {
        status: reviewBeforeEvidence.status,
        evidenceInboxCounts: reviewBeforeEvidence.evidenceInbox?.countsByStatus || {},
        evidence_inbox_counts: reviewBeforeEvidence.evidence_inbox?.counts_by_status || {},
      },
      review_before_evidence: {
        status: reviewBeforeEvidence.status,
        evidence_inbox_counts: reviewBeforeEvidence.evidence_inbox?.counts_by_status || {},
      },
      evidenceBuild: {
        createdCount: evidenceBuildResult.createdCount,
        created_count: evidenceBuildResult.created_count,
        skippedCount: evidenceBuildResult.skippedCount,
        skipped_count: evidenceBuildResult.skipped_count,
      },
      evidence_build: {
        created_count: evidenceBuildResult.created_count,
        skipped_count: evidenceBuildResult.skipped_count,
      },
      finalReview: {
        status: review.status,
        evidenceInboxCounts: review.evidenceInbox?.countsByStatus || {},
        evidence_inbox_counts: review.evidence_inbox?.counts_by_status || {},
      },
      final_review: {
        status: review.status,
        evidence_inbox_counts: review.evidence_inbox?.counts_by_status || {},
      },
    },
    review,
    evidenceBuildResult,
    evidence_build_result: evidenceBuildResult,
    nextAction,
    next_action: nextAction,
    snapshot,
    proofBoundary: {
      proofAcceptedByDayLoop: false,
      proof_accepted_by_day_loop: false,
      message: "The recorder day loop builds review, candidate, and next-action surfaces only. Proof changes still require verifier-gated proof-ledger writes.",
    },
    proof_boundary: {
      proof_accepted_by_day_loop: false,
      message: "The recorder day loop builds review, candidate, and next-action surfaces only. Proof changes still require verifier-gated proof-ledger writes.",
    },
  };
}

// Local-day window [startOfDay, now) for the Day-0-3 auto-fire path. Guarantees
// endedAt > startedAt even at exactly local midnight (where now === startOfDay),
// so normalizeTimeRange's range guard (ERR_RECORDER_DAY_LOOP_INVALID_RANGE) never
// throws. Keeping the day-window math here co-locates it with the loop and lets
// recorder-day-loop.test.mjs cover the midnight edge independently of index.mjs.
export function recorderDayMemoryLoopLocalDayRange(now = new Date()) {
  const end = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(end.getTime())) {
    fail("ERR_RECORDER_DAY_LOOP_INVALID_TIMESTAMP", "recorderDayMemoryLoopLocalDayRange requires a valid now");
  }
  const start = new Date(end.getFullYear(), end.getMonth(), end.getDate(), 0, 0, 0, 0);
  let endedAt = end;
  if (endedAt.getTime() <= start.getTime()) {
    endedAt = new Date(start.getTime() + 1);
  }
  return { startedAt: start.toISOString(), endedAt: endedAt.toISOString() };
}

async function maybePersistReviewSnapshot({
  workspaceRoot,
  review,
  now,
  persistReviewSnapshot,
}) {
  if (!persistReviewSnapshot) {
    return {
      persisted: false,
      persisted_at: null,
      relativePath: null,
      relative_path: null,
    };
  }
  if (!workspaceRoot || typeof workspaceRoot !== "string") {
    fail("ERR_RECORDER_DAY_LOOP_WORKSPACE_REQUIRED", "workspaceRoot is required when persistReviewSnapshot=true");
  }
  const result = await writeRecorderDayMemoryReviewSnapshot({
    workspaceRoot,
    review,
    now,
  });
  return {
    persisted: true,
    persistedAt: result.snapshot.persistedAt,
    persisted_at: result.snapshot.persisted_at,
    relativePath: result.relativePath,
    relative_path: result.relative_path,
  };
}

function normalizeTimeRange({ startedAt, endedAt }) {
  const start = parseRequiredDate(startedAt, "startedAt");
  const end = parseRequiredDate(endedAt, "endedAt");
  if (end.getTime() <= start.getTime()) {
    fail("ERR_RECORDER_DAY_LOOP_INVALID_RANGE", "runRecorderDayMemoryLoop endedAt must be after startedAt", {
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
    fail("ERR_RECORDER_DAY_LOOP_INVALID_TIMESTAMP", `runRecorderDayMemoryLoop requires valid ${fieldName}`, {
      fieldName,
      field_name: fieldName,
      value,
    });
  }
  return date;
}

function toIso(value) {
  const date = value instanceof Date ? value : new Date(value ?? Date.now());
  if (Number.isNaN(date.getTime())) {
    fail("ERR_RECORDER_DAY_LOOP_INVALID_TIMESTAMP", "runRecorderDayMemoryLoop timestamp must be valid ISO-compatible input", {
      value,
    });
  }
  return date.toISOString();
}

function textOrNull(value) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text || null;
}

function fail(code, message, details = {}) {
  throw new RecorderDayLoopError(code, message, details);
}
