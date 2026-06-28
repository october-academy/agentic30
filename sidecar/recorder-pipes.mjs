import { randomUUID } from "node:crypto";

import {
  buildRecorderDayMemoryReview,
  writeRecorderDayMemoryReviewSnapshot,
} from "./recorder-day-memory-review.mjs";
import { buildRecorderEvidenceInboxCandidates } from "./recorder-evidence-inbox-builder.mjs";
import { buildRecorderNextAction } from "./recorder-next-action.mjs";

export const RECORDER_PIPES_SCHEMA_VERSION = 1;
export const RECORDER_PIPES_SCHEMA = "agentic30.recorder.pipes.v1";
export const RECORDER_PIPE_RUN_SCHEMA = "agentic30.recorder.pipe_run.v1";
export const RECORDER_PIPE_OUTPUT_MANIFEST_SCHEMA = "agentic30.recorder.pipe_output_manifest.v1";
export const RECORDER_PIPE_SCHEDULER_SCHEMA = "agentic30.recorder.pipe_scheduler.v1";

const BUILT_IN_PIPE_IDS = Object.freeze([
  "daily-founder-memory",
  "evidence-inbox-builder",
  "stale-debt-resurfacer",
]);
const TERMINAL_PIPE_RUN_STATUSES = new Set(["succeeded", "failed", "cancelled", "timed_out"]);
const ACTIVE_PIPE_RUN_STATUSES = new Set(["queued", "running"]);

const ALLOWED_ACTIONS = new Set([
  "recorder.search",
  "recorder.memory.read",
  "memory.write_daily_summary",
  "memory.write_project_summary",
  "evidence_candidate.create_unverified",
  "office_hours.emit_next_action_input",
  "notify.local",
  "file.write_report",
]);

const BLOCKED_ACTIONS = [
  "shell",
  "network",
  "browser_automation",
  "customer_outreach",
  "public_post",
  "deploy",
  "payment_mutation",
  "raw_file_read",
  "raw_media_read",
];

const RAW_ENDPOINT_PATTERNS = [
  /^GET \/recorder\/frames\/[^/]+\/(?:text|image)$/i,
  /^GET \/recorder\/audio\/[^/]+\/media$/i,
  /^GET \/recorder\/audit$/i,
  /^POST \/recorder\/export(?:\/archive)?$/i,
];
const ACTION_ENDPOINTS = Object.freeze({
  "recorder.search": "GET /recorder/search",
  "recorder.memory.read": "GET /recorder/memory",
});
const RAW_OUTPUT_FIELD_NAMES = new Set([
  "accessibility_text",
  "accessibilityText",
  "ocr_text",
  "ocrText",
  "text",
  "browser_url",
  "browserUrl",
  "document_path",
  "documentPath",
  "relative_path",
  "relativePath",
  "mediaPath",
  "media_path",
  "token",
  "token_hash",
]);
const RAW_OUTPUT_VALUE_PATTERNS = Object.freeze([
  { name: "filesystem_or_media_path", pattern: /(?:^|[\s"'`])(?:~\/|\/Users\/|\/Volumes\/|\/private\/var\/|media\/(?:frames|audio)\/)/i },
  { name: "raw_api_token", pattern: /\ba30_recorder_[a-z0-9_:-]+/i },
  { name: "bearer_token", pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]+/i },
  { name: "secret_material", pattern: /\b(?:api[_-]?key|oauth|password|secret|token)\s*[:=]\s*\S+/i },
]);

export class RecorderPipeError extends Error {
  constructor(code, message, details = {}) {
    super(`${code}: ${message}`);
    this.name = "RecorderPipeError";
    this.code = code;
    this.details = details;
  }
}

export const BUILT_IN_RECORDER_PIPES = Object.freeze([
  pipeDefinition({
    id: "daily-founder-memory",
    name: "Daily Founder Memory",
    schedule: "every day at 18:00",
    permissions: {
      read: {
        data_classes: ["frame", "transcript", "memory", "product_event"],
        content_types: ["accessibility", "ocr", "transcript", "memory"],
        raw_access: false,
      },
      write: {
        memory_items: true,
        evidence_candidates: false,
        files_under: ".agentic30/pipes/daily-founder-memory/",
      },
      endpoints: ["GET /recorder/search", "GET /recorder/memory"],
    },
    actions: ["recorder.search", "recorder.memory.read", "memory.write_daily_summary", "notify.local"],
  }),
  pipeDefinition({
    id: "evidence-inbox-builder",
    name: "Evidence Inbox Builder",
    schedule: "every day at 18:05",
    permissions: {
      read: {
        data_classes: ["memory", "product_event"],
        content_types: ["memory"],
        raw_access: false,
      },
      write: {
        memory_items: false,
        evidence_candidates: true,
        files_under: ".agentic30/pipes/evidence-inbox-builder/",
      },
      endpoints: ["GET /recorder/memory"],
    },
    actions: ["recorder.memory.read", "evidence_candidate.create_unverified", "notify.local"],
  }),
  pipeDefinition({
    id: "stale-debt-resurfacer",
    name: "Stale Debt Resurfacer",
    schedule: "every day at 18:10",
    permissions: {
      read: {
        data_classes: ["memory", "product_event"],
        content_types: ["memory"],
        raw_access: false,
      },
      write: {
        memory_items: false,
        evidence_candidates: false,
        files_under: ".agentic30/pipes/stale-debt-resurfacer/",
      },
      endpoints: ["GET /recorder/memory"],
    },
    actions: ["recorder.memory.read", "office_hours.emit_next_action_input", "notify.local"],
  }),
]);

export function listBuiltInRecorderPipes() {
  return BUILT_IN_RECORDER_PIPES.map((pipe) => validateRecorderPipeDefinition(pipe));
}

export function persistBuiltInRecorderPipes({
  store,
  workspaceId = null,
  projectId = null,
  now = new Date(),
} = {}) {
  assertStore(store);
  const persisted = [];
  const timestamp = toIso(now);
  for (const pipe of listBuiltInRecorderPipes()) {
    const record = {
      id: pipe.id,
      workspace_id: cleanNullable(workspaceId),
      project_id: cleanNullable(projectId),
      path: pipe.path,
      name: pipe.name,
      schedule: pipe.schedule,
      enabled: pipe.enabled ? 1 : 0,
      pipe_kind: pipe.kind,
      permission_manifest_json: JSON.stringify(pipe.permissions),
      created_at: timestamp,
      updated_at: timestamp,
    };
    const existing = store.getRecord("pipe_definitions", pipe.id);
    if (existing) {
      store.updateRecord("pipe_definitions", pipe.id, {
        workspace_id: record.workspace_id,
        project_id: record.project_id,
        path: record.path,
        name: record.name,
        schedule: record.schedule,
        enabled: record.enabled,
        pipe_kind: record.pipe_kind,
        permission_manifest_json: record.permission_manifest_json,
        updated_at: record.updated_at,
      });
    } else {
      store.insertRecord("pipe_definitions", record);
    }
    persisted.push(pipe.id);
  }
  return {
    schema: RECORDER_PIPES_SCHEMA,
    schemaVersion: RECORDER_PIPES_SCHEMA_VERSION,
    schema_version: RECORDER_PIPES_SCHEMA_VERSION,
    persistedCount: persisted.length,
    persisted_count: persisted.length,
    persisted,
    proofAcceptedByPipes: false,
    proof_accepted_by_pipes: false,
  };
}

export function validateRecorderPipeDefinition(value = {}) {
  const pipe = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const id = cleanRequired(pipe.id, "id", "ERR_RECORDER_PIPE_ID_REQUIRED", 120);
  if (!BUILT_IN_PIPE_IDS.includes(id)) {
    fail("ERR_RECORDER_PIPE_UNKNOWN_BUILTIN", `unknown built-in recorder pipe: ${id}`, { id });
  }
  const kind = cleanToken(pipe.kind);
  if (kind !== "built_in") {
    fail("ERR_RECORDER_PIPE_KIND_UNSUPPORTED", "recorder built-in pipe must use kind=built_in", { id, kind });
  }
  const permissions = normalizePermissionManifest(pipe.permissions, { id });
  const actions = normalizeActions(pipe.actions, { id, permissions });
  const path = normalizePipePath(pipe.path, { id });
  return {
    schema: RECORDER_PIPES_SCHEMA,
    schemaVersion: RECORDER_PIPES_SCHEMA_VERSION,
    schema_version: RECORDER_PIPES_SCHEMA_VERSION,
    id,
    kind,
    name: cleanRequired(pipe.name, "name", "ERR_RECORDER_PIPE_NAME_REQUIRED", 180),
    schedule: cleanRequired(pipe.schedule, "schedule", "ERR_RECORDER_PIPE_SCHEDULE_REQUIRED", 180),
    enabled: pipe.enabled !== false,
    workspace: cleanString(pipe.workspace, 80) || "current",
    permissions,
    timeoutSeconds: normalizePositiveInteger(pipe.timeoutSeconds ?? pipe.timeout_seconds, 120, {
      id,
      code: "ERR_RECORDER_PIPE_TIMEOUT_INVALID",
      max: 300,
    }),
    timeout_seconds: normalizePositiveInteger(pipe.timeoutSeconds ?? pipe.timeout_seconds, 120, {
      id,
      code: "ERR_RECORDER_PIPE_TIMEOUT_INVALID",
      max: 300,
    }),
    concurrency: normalizeConcurrency(pipe.concurrency),
    retentionDays: normalizePositiveInteger(pipe.retentionDays ?? pipe.retention_days, 30, {
      id,
      code: "ERR_RECORDER_PIPE_RETENTION_INVALID",
      max: 365,
    }),
    retention_days: normalizePositiveInteger(pipe.retentionDays ?? pipe.retention_days, 30, {
      id,
      code: "ERR_RECORDER_PIPE_RETENTION_INVALID",
      max: 365,
    }),
    path,
    actions,
    proofAcceptedByPipeDefinition: false,
    proof_accepted_by_pipe_definition: false,
  };
}

export function assertRecorderPipeEndpointAllowed(pipeDefinition, endpoint, {
  rawAccessApproved = false,
} = {}) {
  const pipe = validateRecorderPipeDefinition(pipeDefinition);
  const normalizedEndpoint = normalizeEndpoint(endpoint, { id: pipe.id });
  if (!pipe.permissions.endpoints.includes(normalizedEndpoint)) {
    fail("ERR_RECORDER_PIPE_ENDPOINT_DENIED", "recorder pipe endpoint is outside its permission manifest", {
      pipeId: pipe.id,
      pipe_id: pipe.id,
      endpoint: normalizedEndpoint,
    });
  }
  if (isRawEndpoint(normalizedEndpoint) && rawAccessApproved !== true) {
    fail("ERR_RECORDER_PIPE_RAW_ENDPOINT_REQUIRES_APPROVAL", "recorder pipe raw endpoint access requires explicit local user approval", {
      pipeId: pipe.id,
      pipe_id: pipe.id,
      endpoint: normalizedEndpoint,
    });
  }
  return {
    allowed: true,
    pipeId: pipe.id,
    pipe_id: pipe.id,
    endpoint: normalizedEndpoint,
    rawAccessApproved: rawAccessApproved === true,
    raw_access_approved: rawAccessApproved === true,
  };
}

export function listRecorderPipeDefinitions({ store, limit = 100 } = {}) {
  assertStore(store);
  return store.listRecords("pipe_definitions", { limit: normalizeListLimit(limit) })
    .sort((lhs, rhs) => lhs.id.localeCompare(rhs.id))
    .map(pipeDefinitionDto);
}

export function listRecorderPipeRuns({ store, pipeId = null, limit = 100 } = {}) {
  assertStore(store);
  const filterPipeId = cleanString(pipeId, 120);
  return store.listRecords("pipe_runs", { limit: normalizeListLimit(limit) })
    .filter((row) => !filterPipeId || row.pipe_id === filterPipeId)
    .sort((lhs, rhs) => String(rhs.started_at || "").localeCompare(String(lhs.started_at || "")))
    .map(pipeRunDto);
}

export function enqueueDueRecorderPipeRuns({
  store,
  workspaceId = null,
  projectId = null,
  now = new Date(),
  limit = 2000,
} = {}) {
  assertStore(store);
  const queued = [];
  const skipped = [];
  const timestamp = toDate(now);
  for (const definition of listRecorderPipeDefinitions({ store, limit: 5000 })) {
    const pipe = requirePersistedBuiltInPipe(store, definition.id);
    const scheduleState = evaluateDailyPipeSchedule(pipe, timestamp);
    if (pipe.enabled !== true) {
      skipped.push(scheduleSkip(pipe, "disabled", scheduleState));
      continue;
    }
    if (!scheduleState.due) {
      skipped.push(scheduleSkip(pipe, "not_due", scheduleState));
      continue;
    }
    const runId = scheduledPipeRunId(pipe, scheduleState);
    const existing = store.getRecord("pipe_runs", runId);
    if (existing) {
      skipped.push(scheduleSkip(pipe, "already_scheduled", scheduleState, existing));
      continue;
    }
    const active = findActivePipeRun(store, pipe.id);
    if (active && pipe.concurrency === "skip_if_running") {
      skipped.push(scheduleSkip(pipe, "concurrency_skip_if_running", scheduleState, active));
      continue;
    }
    const run = createPipeRunRecord({
      store,
      pipe,
      workspaceId,
      projectId,
      startedAt: startOfLocalDay(timestamp),
      endedAt: timestamp,
      triggerReason: "scheduler",
      now: timestamp,
      runId,
      limit,
      status: "queued",
      auditEventType: "pipe_queued",
      scheduleState,
    });
    queued.push(pipeRunDto(store.getRecord("pipe_runs", run.id)));
  }
  return schedulerResult({
    now: timestamp,
    queued,
    skipped,
    executed: [],
    failed: [],
  });
}

export async function runQueuedRecorderPipeRuns({
  store,
  workspaceRoot = null,
  now = new Date(),
  maxRuns = 10,
  timeoutMs = null,
} = {}) {
  assertStore(store);
  const timestamp = toDate(now);
  const queuedRows = store.listRecords("pipe_runs", { limit: 5000 })
    .filter((row) => row.status === "queued")
    .sort((lhs, rhs) => String(lhs.started_at || "").localeCompare(String(rhs.started_at || "")))
    .slice(0, normalizeListLimit(maxRuns));
  const executed = [];
  const failed = [];
  const skipped = [];
  for (const row of queuedRows) {
    const pipe = requirePersistedBuiltInPipe(store, row.pipe_id);
    const active = findActivePipeRun(store, pipe.id, { excludeRunId: row.id, statuses: ["running"] });
    if (active && pipe.concurrency === "skip_if_running") {
      skipped.push(scheduleSkip(pipe, "concurrency_skip_if_running", parseJsonObject(row.input_manifest_json).schedulerState, active));
      continue;
    }
    const inputManifest = parseJsonObject(row.input_manifest_json);
    const auditLog = [
      ...parseJsonArray(row.audit_log_json),
      auditEvent("pipe_started", { pipeId: pipe.id, runId: row.id }, timestamp),
    ];
    store.updateRecord("pipe_runs", row.id, {
      status: "running",
      started_at: toIso(timestamp),
      audit_log_json: JSON.stringify(auditLog),
      error_message: "",
    });
    const run = { id: row.id, auditLog };
    try {
      assertPipeActionsAllowed(pipe);
      const outputManifest = await executeBuiltInPipeWithTimeout({
        pipe,
        runId: row.id,
        timeoutMs: normalizePipeTimeoutMs(timeoutMs, pipe),
        execute: () => executeBuiltInPipe({
          store,
          pipe,
          workspaceRoot,
          workspaceId: inputManifest.workspaceId ?? inputManifest.workspace_id,
          projectId: inputManifest.projectId ?? inputManifest.project_id,
          startedAt: inputManifest.timeRange?.startedAt ?? inputManifest.time_range?.started_at,
          endedAt: inputManifest.timeRange?.endedAt ?? inputManifest.time_range?.ended_at,
          now: timestamp,
          runId: row.id,
          limit: inputManifest.limit,
        }),
      });
      assertOutputManifestSafe(outputManifest);
      executed.push(finalizePipeRun({
        store,
        run,
        pipe,
        status: "succeeded",
        outputManifest,
        auditType: "pipe_succeeded",
        now: timestamp,
      }));
    } catch (error) {
      const code = error?.code || "ERR_RECORDER_PIPE_RUN_FAILED";
      const timedOut = code === "ERR_RECORDER_PIPE_TIMEOUT";
      const updatedRun = finalizePipeRun({
        store,
        run,
        pipe,
        status: timedOut ? "timed_out" : "failed",
        outputManifest: timedOut
          ? incompleteOutputManifest({ pipe, runId: row.id, now: timestamp, outputKind: "pipe_timed_out", reason: code })
          : null,
        auditType: timedOut ? "pipe_timed_out" : "pipe_failed",
        now: timestamp,
        errorMessage: cleanString(error?.message || String(error), 500),
      });
      failed.push({
        run: updatedRun,
        pipeRun: updatedRun,
        pipe_run: updatedRun,
        code,
      });
    }
  }
  return schedulerResult({
    now: timestamp,
    queued: [],
    skipped,
    executed,
    failed,
  });
}

export async function runBuiltInRecorderPipe({
  store,
  pipeId,
  workspaceRoot = null,
  workspaceId = null,
  projectId = null,
  startedAt,
  endedAt,
  triggerReason = "manual",
  now = new Date(),
  runId = randomUUID(),
  limit = 2000,
  timeoutMs = null,
} = {}) {
  assertStore(store);
  const pipe = requirePersistedBuiltInPipe(store, pipeId);
  const timeout = normalizePipeTimeoutMs(timeoutMs, pipe);
  const run = createPipeRunRecord({
    store,
    pipe,
    workspaceId,
    projectId,
    startedAt,
    endedAt,
    triggerReason,
    now,
    runId,
    limit,
  });
  try {
    assertPipeActionsAllowed(pipe);
    const outputManifest = await executeBuiltInPipeWithTimeout({
      pipe,
      runId: run.id,
      timeoutMs: timeout,
      execute: () => executeBuiltInPipe({
        store,
        pipe,
        workspaceRoot,
        workspaceId,
        projectId,
        startedAt,
        endedAt,
        now,
        runId: run.id,
        limit,
      }),
    });
    assertOutputManifestSafe(outputManifest);
    const updatedRun = finalizePipeRun({
      store,
      run,
      pipe,
      status: "succeeded",
      outputManifest,
      auditType: "pipe_succeeded",
      now,
    });
    return {
      schema: RECORDER_PIPE_RUN_SCHEMA,
      schemaVersion: RECORDER_PIPES_SCHEMA_VERSION,
      schema_version: RECORDER_PIPES_SCHEMA_VERSION,
      run: updatedRun,
      pipeRun: updatedRun,
      pipe_run: updatedRun,
      outputManifest,
      output_manifest: outputManifest,
      proofAcceptedByPipeRun: false,
      proof_accepted_by_pipe_run: false,
    };
  } catch (error) {
    const code = error?.code || "ERR_RECORDER_PIPE_RUN_FAILED";
    const timedOut = code === "ERR_RECORDER_PIPE_TIMEOUT";
    finalizePipeRun({
      store,
      run,
      pipe,
      status: timedOut ? "timed_out" : "failed",
      outputManifest: timedOut
        ? incompleteOutputManifest({ pipe, runId: run.id, now, outputKind: "pipe_timed_out", reason: code })
        : null,
      auditType: timedOut ? "pipe_timed_out" : "pipe_failed",
      now,
      errorMessage: cleanString(error?.message || String(error), 500),
    });
    throw error;
  }
}

export function cancelRecorderPipeRun({
  store,
  runId,
  now = new Date(),
  reason = "local_user_cancelled",
} = {}) {
  assertStore(store);
  const id = cleanRequired(runId, "runId", "ERR_RECORDER_PIPE_RUN_ID_REQUIRED", 240);
  const row = store.getRecord("pipe_runs", id);
  if (!row) {
    fail("ERR_RECORDER_PIPE_RUN_NOT_FOUND", `recorder pipe run not found: ${id}`, { runId: id, run_id: id });
  }
  if (TERMINAL_PIPE_RUN_STATUSES.has(row.status)) {
    fail("ERR_RECORDER_PIPE_RUN_TERMINAL", "recorder pipe run is already terminal and cannot be cancelled", {
      runId: id,
      run_id: id,
      status: row.status,
    });
  }
  const pipe = requirePersistedBuiltInPipe(store, row.pipe_id);
  const outputManifest = incompleteOutputManifest({
    pipe,
    runId: id,
    now,
    outputKind: "pipe_cancelled",
    reason: cleanString(reason, 240) || "local_user_cancelled",
  });
  const auditLog = parseJsonArray(row.audit_log_json);
  store.updateRecord("pipe_runs", id, {
    status: "cancelled",
    ended_at: toIso(now),
    output_manifest_json: JSON.stringify(outputManifest),
    audit_log_json: JSON.stringify([
      ...auditLog,
      auditEvent("pipe_cancelled", { pipeId: pipe.id, runId: id, reason: outputManifest.items.reason }, now),
    ]),
    error_message: `ERR_RECORDER_PIPE_CANCELLED: ${outputManifest.items.reason}`,
  });
  const updatedRun = pipeRunDto(store.getRecord("pipe_runs", id));
  return {
    schema: RECORDER_PIPE_RUN_SCHEMA,
    schemaVersion: RECORDER_PIPES_SCHEMA_VERSION,
    schema_version: RECORDER_PIPES_SCHEMA_VERSION,
    run: updatedRun,
    pipeRun: updatedRun,
    pipe_run: updatedRun,
    outputManifest,
    output_manifest: outputManifest,
    proofAcceptedByPipeRun: false,
    proof_accepted_by_pipe_run: false,
  };
}

function requirePersistedBuiltInPipe(store, pipeId) {
  const id = cleanRequired(pipeId, "pipeId", "ERR_RECORDER_PIPE_ID_REQUIRED", 120);
  const definition = listBuiltInRecorderPipes().find((pipe) => pipe.id === id);
  if (!definition) {
    fail("ERR_RECORDER_PIPE_UNKNOWN_BUILTIN", `unknown built-in recorder pipe: ${id}`, { id });
  }
  const record = store.getRecord("pipe_definitions", id);
  if (!record) {
    fail("ERR_RECORDER_PIPE_DEFINITION_NOT_PERSISTED", "recorder pipe definition must be persisted before execution", {
      id,
    });
  }
  return validateRecorderPipeDefinition({
    ...definition,
    permissions: JSON.parse(record.permission_manifest_json),
    enabled: Boolean(Number(record.enabled)),
  });
}

function createPipeRunRecord({
  store,
  pipe,
  workspaceId,
  projectId,
  startedAt,
  endedAt,
  triggerReason,
  now,
  runId,
  limit,
  status = "running",
  auditEventType = "pipe_started",
  scheduleState = null,
}) {
  const id = cleanString(runId, 240) || randomUUID();
  const timestamp = toIso(now);
  const inputManifest = {
    schema: "agentic30.recorder.pipe_input_manifest.v1",
    schemaVersion: RECORDER_PIPES_SCHEMA_VERSION,
    schema_version: RECORDER_PIPES_SCHEMA_VERSION,
    pipeId: pipe.id,
    pipe_id: pipe.id,
    runId: id,
    run_id: id,
    triggerReason: cleanString(triggerReason, 120) || "manual",
    trigger_reason: cleanString(triggerReason, 120) || "manual",
    workspaceId: cleanNullable(workspaceId),
    workspace_id: cleanNullable(workspaceId),
    projectId: cleanNullable(projectId),
    project_id: cleanNullable(projectId),
    timeRange: {
      startedAt: toIso(startedAt),
      started_at: toIso(startedAt),
      endedAt: toIso(endedAt),
      ended_at: toIso(endedAt),
    },
    time_range: {
      started_at: toIso(startedAt),
      ended_at: toIso(endedAt),
    },
    actions: pipe.actions,
    permissionManifest: pipe.permissions,
    permission_manifest: pipe.permissions,
    rawAccess: false,
    raw_access: false,
    timeoutSeconds: pipe.timeoutSeconds,
    timeout_seconds: pipe.timeoutSeconds,
    limit: normalizePositiveInteger(limit, 2000, {
      id: pipe.id,
      code: "ERR_RECORDER_PIPE_LIMIT_INVALID",
      max: 5000,
    }),
  };
  if (scheduleState) {
    inputManifest.schedulerState = scheduleState;
    inputManifest.scheduler_state = scheduleState;
  }
  const auditLog = [auditEvent(auditEventType, { pipeId: pipe.id, runId: id }, now)];
  store.insertRecord("pipe_runs", {
    id,
    pipe_id: pipe.id,
    workspace_id: cleanNullable(workspaceId),
    project_id: cleanNullable(projectId),
    trigger_reason: inputManifest.triggerReason,
    status,
    started_at: timestamp,
    ended_at: null,
    input_manifest_json: JSON.stringify(inputManifest),
    output_manifest_json: null,
    audit_log_json: JSON.stringify(auditLog),
    error_message: "",
  });
  return { id, inputManifest, auditLog };
}

function finalizePipeRun({
  store,
  run,
  pipe,
  status,
  outputManifest,
  auditType,
  now,
  errorMessage = "",
}) {
  const current = store.getRecord("pipe_runs", run.id);
  if (!current) {
    fail("ERR_RECORDER_PIPE_RUN_NOT_FOUND", `recorder pipe run not found: ${run.id}`, { runId: run.id, run_id: run.id });
  }
  if (TERMINAL_PIPE_RUN_STATUSES.has(current.status)) {
    return pipeRunDto(current);
  }
  const auditLog = parseJsonArray(current.audit_log_json || JSON.stringify(run.auditLog));
  store.updateRecord("pipe_runs", run.id, {
    status,
    ended_at: toIso(now),
    output_manifest_json: outputManifest ? JSON.stringify(outputManifest) : null,
    audit_log_json: JSON.stringify([
      ...auditLog,
      auditEvent(auditType, { pipeId: pipe.id, runId: run.id, code: status }, now),
    ]),
    error_message: cleanString(errorMessage, 500),
  });
  return pipeRunDto(store.getRecord("pipe_runs", run.id));
}

function executeBuiltInPipeWithTimeout({
  pipe,
  runId,
  timeoutMs,
  execute,
}) {
  if (timeoutMs === 0) {
    throw pipeTimeoutError({ pipe, runId, timeoutMs });
  }
  let timeout = null;
  return Promise.race([
    Promise.resolve().then(execute),
    new Promise((_, reject) => {
      timeout = setTimeout(() => {
        reject(pipeTimeoutError({ pipe, runId, timeoutMs }));
      }, timeoutMs);
      timeout.unref?.();
    }),
  ]).finally(() => {
    if (timeout) clearTimeout(timeout);
  });
}

function pipeTimeoutError({ pipe, runId, timeoutMs }) {
  return new RecorderPipeError(
    "ERR_RECORDER_PIPE_TIMEOUT",
    "recorder pipe run exceeded its timeout before producing a complete output manifest",
    { pipeId: pipe.id, pipe_id: pipe.id, runId, run_id: runId, timeoutMs, timeout_ms: timeoutMs },
  );
}

async function executeBuiltInPipe({
  store,
  pipe,
  workspaceRoot,
  workspaceId,
  projectId,
  startedAt,
  endedAt,
  now,
  runId,
  limit,
}) {
  if (pipe.enabled !== true) {
    fail("ERR_RECORDER_PIPE_DISABLED", "recorder pipe is disabled", { pipeId: pipe.id, pipe_id: pipe.id });
  }
  if (pipe.id === "daily-founder-memory") {
    const review = buildRecorderDayMemoryReview({
      store,
      workspaceId,
      projectId,
      startedAt,
      endedAt,
      now,
      limit,
    });
    let artifact = null;
    if (workspaceRoot) {
      const snapshot = await writeRecorderDayMemoryReviewSnapshot({ workspaceRoot, review, now });
      artifact = {
        kind: "day_memory_review_snapshot",
        persisted: true,
        privacyState: "memory_safe",
        privacy_state: "memory_safe",
      };
    }
    return outputManifest({
      pipe,
      runId,
      now,
      outputKind: "day_memory_review",
      items: {
        frameCount: numberValue(review.capture?.frameCount ?? review.capture?.frame_count),
        frame_count: numberValue(review.capture?.frameCount ?? review.capture?.frame_count),
        productEventCount: numberValue(review.productEvents?.total ?? review.product_events?.total),
        product_event_count: numberValue(review.productEvents?.total ?? review.product_events?.total),
        evidenceCandidateCount: numberValue(review.evidenceInbox?.total ?? review.evidence_inbox?.total),
        evidence_candidate_count: numberValue(review.evidenceInbox?.total ?? review.evidence_inbox?.total),
      },
      artifacts: artifact ? [artifact] : [],
      actionResults: [
        actionResult("recorder.memory.read", "succeeded"),
        actionResult("memory.write_daily_summary", artifact ? "succeeded" : "skipped", artifact ? "" : "workspace_root_not_supplied"),
      ],
    });
  }
  if (pipe.id === "evidence-inbox-builder") {
    const result = buildRecorderEvidenceInboxCandidates({
      store,
      workspaceId,
      projectId,
      startedAt,
      endedAt,
      now,
      limit,
    });
    return outputManifest({
      pipe,
      runId,
      now,
      outputKind: "evidence_inbox_candidates",
      items: {
        createdCount: result.createdCount,
        created_count: result.created_count,
        skippedCount: result.skippedCount,
        skipped_count: result.skipped_count,
      },
      sourceIds: result.created.map((candidate) => candidate.id),
      actionResults: [
        actionResult("recorder.memory.read", "succeeded"),
        actionResult("evidence_candidate.create_unverified", "succeeded"),
      ],
    });
  }
  if (pipe.id === "stale-debt-resurfacer") {
    const review = buildRecorderDayMemoryReview({
      store,
      workspaceId,
      projectId,
      startedAt,
      endedAt,
      now,
      limit,
    });
    const nextAction = buildRecorderNextAction({ review, now });
    return outputManifest({
      pipe,
      runId,
      now,
      outputKind: "office_hours_next_action_input",
      items: {
        actionId: nextAction.action?.id || "",
        action_id: nextAction.action?.id || "",
        actionType: nextAction.action?.actionType || nextAction.action?.action_type || "",
        action_type: nextAction.action?.actionType || nextAction.action?.action_type || "",
        priority: nextAction.action?.priority || "",
      },
      sourceIds: nextAction.action?.sourceIds ?? nextAction.action?.source_ids ?? [],
      actionResults: [
        actionResult("recorder.memory.read", "succeeded"),
        actionResult("office_hours.emit_next_action_input", "succeeded"),
      ],
    });
  }
  fail("ERR_RECORDER_PIPE_UNKNOWN_BUILTIN", `unknown built-in recorder pipe: ${pipe.id}`, { id: pipe.id });
}

function assertPipeActionsAllowed(pipe) {
  for (const action of pipe.actions) {
    const endpoint = ACTION_ENDPOINTS[action];
    if (endpoint) assertRecorderPipeEndpointAllowed(pipe, endpoint);
    if (action === "memory.write_daily_summary" && pipe.permissions.write.memoryItems !== true) {
      fail("ERR_RECORDER_PIPE_ACTION_PERMISSION_DENIED", "daily summary writes require memory_items write permission", {
        pipeId: pipe.id,
        pipe_id: pipe.id,
        action,
      });
    }
    if (action === "evidence_candidate.create_unverified" && pipe.permissions.write.evidenceCandidates !== true) {
      fail("ERR_RECORDER_PIPE_ACTION_PERMISSION_DENIED", "candidate creation requires evidence_candidates write permission", {
        pipeId: pipe.id,
        pipe_id: pipe.id,
        action,
      });
    }
  }
}

function outputManifest({
  pipe,
  runId,
  now,
  outputKind,
  items = {},
  sourceIds = [],
  artifacts = [],
  actionResults = [],
}) {
  return {
    schema: RECORDER_PIPE_OUTPUT_MANIFEST_SCHEMA,
    schemaVersion: RECORDER_PIPES_SCHEMA_VERSION,
    schema_version: RECORDER_PIPES_SCHEMA_VERSION,
    generatedAt: toIso(now),
    generated_at: toIso(now),
    pipeId: pipe.id,
    pipe_id: pipe.id,
    runId,
    run_id: runId,
    outputKind,
    output_kind: outputKind,
    privacyState: "memory_safe",
    privacy_state: "memory_safe",
    sourceIds: normalizeStringArray(sourceIds, 100, 240),
    source_ids: normalizeStringArray(sourceIds, 100, 240),
    items,
    artifacts,
    actionResults,
    action_results: actionResults,
    proofAcceptedByPipeRun: false,
    proof_accepted_by_pipe_run: false,
    proofBoundary: {
      proofAcceptedByPipeRun: false,
      proof_accepted_by_pipe_run: false,
      proofLedgerWriteAllowed: false,
      proof_ledger_write_allowed: false,
      message: "Pipe outputs are local execution support and never proof without user review and verifier acceptance.",
    },
    proof_boundary: {
      proof_accepted_by_pipe_run: false,
      proof_ledger_write_allowed: false,
      message: "Pipe outputs are local execution support and never proof without user review and verifier acceptance.",
    },
  };
}

function incompleteOutputManifest({ pipe, runId, now, outputKind, reason }) {
  return outputManifest({
    pipe,
    runId,
    now,
    outputKind,
    items: {
      status: outputKind,
      reason: cleanString(reason, 240),
      complete: false,
    },
    actionResults: pipe.actions.map((action) => actionResult(action, "incomplete", reason)),
  });
}

function actionResult(action, status, reason = "") {
  return {
    action,
    status,
    reason: cleanString(reason, 240),
    proofEffect: "none",
    proof_effect: "none",
  };
}

function auditEvent(type, details, now) {
  return {
    type,
    at: toIso(now),
    ...details,
  };
}

function assertOutputManifestSafe(value, pathSegments = []) {
  if (typeof value === "string") {
    assertOutputStringSafe(value, pathSegments);
    return;
  }
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertOutputManifestSafe(item, [...pathSegments, String(index)]));
    return;
  }
  for (const [key, nested] of Object.entries(value)) {
    if (RAW_OUTPUT_FIELD_NAMES.has(key)) {
      fail("ERR_RECORDER_PIPE_OUTPUT_RAW_FIELD", "recorder pipe output manifest contains a raw field", {
        fieldPath: [...pathSegments, key].join("."),
        field_path: [...pathSegments, key].join("."),
      });
    }
    assertOutputManifestSafe(nested, [...pathSegments, key]);
  }
}

function assertOutputStringSafe(value, pathSegments) {
  for (const { name, pattern } of RAW_OUTPUT_VALUE_PATTERNS) {
    if (pattern.test(value)) {
      fail("ERR_RECORDER_PIPE_OUTPUT_RAW_VALUE", "recorder pipe output manifest contains a raw-looking value", {
        fieldPath: pathSegments.join("."),
        field_path: pathSegments.join("."),
        rule: name,
      });
    }
  }
}

function pipeDefinitionDto(row) {
  const permissionManifest = parseJsonObject(row.permission_manifest_json);
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    workspace_id: row.workspace_id,
    projectId: row.project_id,
    project_id: row.project_id,
    path: row.path,
    name: row.name,
    schedule: row.schedule,
    enabled: Boolean(Number(row.enabled)),
    kind: row.pipe_kind,
    pipeKind: row.pipe_kind,
    pipe_kind: row.pipe_kind,
    permissionManifest,
    permission_manifest: permissionManifest,
    createdAt: row.created_at,
    created_at: row.created_at,
    updatedAt: row.updated_at,
    updated_at: row.updated_at,
    proofAcceptedByPipeDefinition: false,
    proof_accepted_by_pipe_definition: false,
  };
}

function pipeRunDto(row) {
  const inputManifest = parseJsonObject(row.input_manifest_json);
  const outputManifest = row.output_manifest_json ? parseJsonObject(row.output_manifest_json) : null;
  return {
    id: row.id,
    pipeId: row.pipe_id,
    pipe_id: row.pipe_id,
    workspaceId: row.workspace_id,
    workspace_id: row.workspace_id,
    projectId: row.project_id,
    project_id: row.project_id,
    triggerReason: row.trigger_reason,
    trigger_reason: row.trigger_reason,
    status: row.status,
    startedAt: row.started_at,
    started_at: row.started_at,
    endedAt: row.ended_at,
    ended_at: row.ended_at,
    inputManifest,
    input_manifest: inputManifest,
    outputManifest,
    output_manifest: outputManifest,
    auditLog: parseJsonArray(row.audit_log_json),
    audit_log: parseJsonArray(row.audit_log_json),
    errorMessage: cleanString(row.error_message, 500),
    error_message: cleanString(row.error_message, 500),
    proofAcceptedByPipeRun: false,
    proof_accepted_by_pipe_run: false,
  };
}

function parseJsonArray(value) {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseJsonObject(value) {
  try {
    const parsed = JSON.parse(value || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function normalizePipeTimeoutMs(value, pipe) {
  if (value === null || value === undefined || value === "") {
    return pipe.timeoutSeconds * 1000;
  }
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    fail("ERR_RECORDER_PIPE_TIMEOUT_INVALID", "recorder pipe timeoutMs must be zero or a positive integer", {
      pipeId: pipe.id,
      pipe_id: pipe.id,
      timeoutMs: value,
      timeout_ms: value,
    });
  }
  return Math.min(parsed, pipe.timeoutSeconds * 1000);
}

function normalizeListLimit(value) {
  return Math.max(1, Math.min(5000, Number.parseInt(String(value), 10) || 100));
}

function schedulerResult({
  now,
  queued,
  skipped,
  executed,
  failed,
}) {
  return {
    schema: RECORDER_PIPE_SCHEDULER_SCHEMA,
    schemaVersion: RECORDER_PIPES_SCHEMA_VERSION,
    schema_version: RECORDER_PIPES_SCHEMA_VERSION,
    generatedAt: toIso(now),
    generated_at: toIso(now),
    queuedCount: queued.length,
    queued_count: queued.length,
    skippedCount: skipped.length,
    skipped_count: skipped.length,
    executedCount: executed.length,
    executed_count: executed.length,
    failedCount: failed.length,
    failed_count: failed.length,
    queued,
    skipped,
    executed,
    failed,
    proofAcceptedByScheduler: false,
    proof_accepted_by_scheduler: false,
    proofBoundary: {
      proofAcceptedByScheduler: false,
      proof_accepted_by_scheduler: false,
      proofLedgerWriteAllowed: false,
      proof_ledger_write_allowed: false,
      message: "Pipe scheduler state is local automation metadata and never accepted proof.",
    },
    proof_boundary: {
      proof_accepted_by_scheduler: false,
      proof_ledger_write_allowed: false,
      message: "Pipe scheduler state is local automation metadata and never accepted proof.",
    },
  };
}

function evaluateDailyPipeSchedule(pipe, now) {
  const match = /^every day at ([01]\d|2[0-3]):([0-5]\d)$/i.exec(pipe.schedule);
  if (!match) {
    fail("ERR_RECORDER_PIPE_SCHEDULE_UNSUPPORTED", "recorder pipe scheduler only supports 'every day at HH:MM' schedules", {
      pipeId: pipe.id,
      pipe_id: pipe.id,
      schedule: pipe.schedule,
    });
  }
  const hour = Number.parseInt(match[1], 10);
  const minute = Number.parseInt(match[2], 10);
  const scheduledAt = new Date(now);
  scheduledAt.setHours(hour, minute, 0, 0);
  const dateKey = localDateKey(scheduledAt);
  const timeKey = `${pad2(hour)}${pad2(minute)}`;
  return {
    schedule: pipe.schedule,
    scheduleTimeZone: "local",
    schedule_time_zone: "local",
    scheduledAt: toIso(scheduledAt),
    scheduled_at: toIso(scheduledAt),
    scheduleDate: dateKey,
    schedule_date: dateKey,
    scheduleKey: `${dateKey}-${timeKey}`,
    schedule_key: `${dateKey}-${timeKey}`,
    due: now.getTime() >= scheduledAt.getTime(),
  };
}

function scheduledPipeRunId(pipe, scheduleState) {
  return `scheduler-${pipe.id}-${scheduleState.scheduleKey}`.replace(/[^a-z0-9._:-]+/gi, "-").slice(0, 240);
}

function scheduleSkip(pipe, reason, scheduleState = {}, activeRun = null) {
  return {
    pipeId: pipe.id,
    pipe_id: pipe.id,
    reason,
    scheduleState,
    schedule_state: scheduleState,
    activeRunId: activeRun?.id || "",
    active_run_id: activeRun?.id || "",
    activeRunStatus: activeRun?.status || "",
    active_run_status: activeRun?.status || "",
    proofAcceptedByScheduler: false,
    proof_accepted_by_scheduler: false,
  };
}

function findActivePipeRun(store, pipeId, {
  excludeRunId = "",
  statuses = [...ACTIVE_PIPE_RUN_STATUSES],
} = {}) {
  const allowed = new Set(statuses);
  return store.listRecords("pipe_runs", { limit: 5000 })
    .find((row) => row.pipe_id === pipeId && row.id !== excludeRunId && allowed.has(row.status)) || null;
}

function startOfLocalDay(value) {
  const date = toDate(value);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
}

function localDateKey(value) {
  const date = toDate(value);
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function pipeDefinition({ id, name, schedule, permissions, actions }) {
  return Object.freeze({
    id,
    kind: "built_in",
    name,
    schedule,
    enabled: true,
    workspace: "current",
    permissions,
    timeoutSeconds: 120,
    timeout_seconds: 120,
    concurrency: "skip_if_running",
    retentionDays: 30,
    retention_days: 30,
    path: `.agentic30/pipes/${id}/pipe.md`,
    actions,
  });
}

function normalizePermissionManifest(value = {}, { id }) {
  const manifest = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const read = manifest.read && typeof manifest.read === "object" ? manifest.read : {};
  const write = manifest.write && typeof manifest.write === "object" ? manifest.write : {};
  const rawAccess = read.rawAccess === true || read.raw_access === true;
  if (rawAccess) {
    fail("ERR_RECORDER_PIPE_RAW_ACCESS_DENIED", "built-in recorder pipes cannot request raw access by default", { id });
  }
  const fileScopeCandidates = [write.filesUnder, write.files_under]
    .map((candidate) => cleanString(candidate, 240))
    .filter(Boolean);
  for (const candidate of fileScopeCandidates) {
    assertSafePipeWriteScope(candidate, { id });
  }
  const filesUnder = fileScopeCandidates[0] || "";
  const endpoints = normalizeEndpoints(manifest.endpoints, { id });
  for (const endpoint of endpoints) {
    if (isRawEndpoint(endpoint)) {
      fail("ERR_RECORDER_PIPE_RAW_ENDPOINT_DENIED", "built-in recorder pipes cannot declare raw endpoints by default", {
        id,
        endpoint,
      });
    }
  }
  return {
    read: {
      dataClasses: normalizeStringArray(read.dataClasses ?? read.data_classes),
      data_classes: normalizeStringArray(read.dataClasses ?? read.data_classes),
      apps: normalizeStringArray(read.apps),
      contentTypes: normalizeStringArray(read.contentTypes ?? read.content_types),
      content_types: normalizeStringArray(read.contentTypes ?? read.content_types),
      rawAccess: false,
      raw_access: false,
    },
    write: {
      memoryItems: write.memoryItems === true || write.memory_items === true,
      memory_items: write.memoryItems === true || write.memory_items === true,
      evidenceCandidates: write.evidenceCandidates === true || write.evidence_candidates === true,
      evidence_candidates: write.evidenceCandidates === true || write.evidence_candidates === true,
      filesUnder,
      files_under: filesUnder,
    },
    endpoints,
  };
}

function normalizeActions(values = [], { id, permissions }) {
  const actions = normalizeStringArray(values, 50, 120);
  if (!actions.length) {
    fail("ERR_RECORDER_PIPE_ACTIONS_REQUIRED", "recorder pipe requires at least one DSL action", { id });
  }
  for (const action of actions) {
    if (isBlockedPipeAction(action)) {
      fail("ERR_RECORDER_PIPE_ACTION_BLOCKED", "recorder pipe action is blocked by the local DSL policy", { id, action });
    }
    if (!ALLOWED_ACTIONS.has(action)) {
      fail("ERR_RECORDER_PIPE_ACTION_UNKNOWN", "recorder pipe action is not in the allowed DSL action set", { id, action });
    }
    if (action === "memory.write_daily_summary" && permissions.write.memoryItems !== true) {
      fail("ERR_RECORDER_PIPE_ACTION_PERMISSION_DENIED", "daily summary writes require memory_items write permission", { id, action });
    }
    if (action === "evidence_candidate.create_unverified" && permissions.write.evidenceCandidates !== true) {
      fail("ERR_RECORDER_PIPE_ACTION_PERMISSION_DENIED", "candidate creation requires evidence_candidates write permission", { id, action });
    }
  }
  return actions;
}

function isBlockedPipeAction(action) {
  return BLOCKED_ACTIONS.some((blocked) => action === blocked || action.startsWith(`${blocked}.`));
}

function assertSafePipeWriteScope(filesUnder, { id }) {
  if (filesUnder.includes("..") || filesUnder.startsWith("/") || filesUnder.startsWith("~")) {
    fail("ERR_RECORDER_PIPE_WRITE_SCOPE_UNSAFE", "recorder pipe file write scope must be workspace-relative and non-traversing", {
      id,
      filesUnder,
      files_under: filesUnder,
    });
  }
  if (!filesUnder.startsWith(`.agentic30/pipes/${id}/`)) {
    fail("ERR_RECORDER_PIPE_WRITE_SCOPE_DENIED", "recorder pipe file writes must stay under its execution-scoped directory", {
      id,
      filesUnder,
      files_under: filesUnder,
    });
  }
}

function normalizeEndpoints(values = [], { id }) {
  const endpoints = normalizeStringArray(values, 30, 200).map((endpoint) => normalizeEndpoint(endpoint, { id }));
  if (!endpoints.length) {
    fail("ERR_RECORDER_PIPE_ENDPOINTS_REQUIRED", "recorder pipe requires at least one endpoint permission", { id });
  }
  return [...new Set(endpoints)];
}

function normalizeEndpoint(value, { id }) {
  const endpoint = cleanString(value, 200).replace(/\s+/g, " ");
  if (!/^(GET|POST) \/recorder\/[a-z0-9/_:-]+$/i.test(endpoint)) {
    fail("ERR_RECORDER_PIPE_ENDPOINT_INVALID", "recorder pipe endpoint permission must be a recorder HTTP method/path pair", {
      id,
      endpoint,
    });
  }
  const [method, path] = endpoint.split(" ");
  return `${method.toUpperCase()} ${path}`;
}

function isRawEndpoint(endpoint) {
  return RAW_ENDPOINT_PATTERNS.some((pattern) => pattern.test(endpoint));
}

function normalizePipePath(value, { id }) {
  const pipePath = cleanString(value, 240);
  const expectedPrefix = `.agentic30/pipes/${id}/`;
  if (!pipePath.startsWith(expectedPrefix) || pipePath.includes("..") || pipePath.startsWith("/") || pipePath.startsWith("~")) {
    fail("ERR_RECORDER_PIPE_PATH_UNSAFE", "recorder pipe path must stay under its workspace pipe directory", {
      id,
      path: pipePath,
      expectedPrefix,
      expected_prefix: expectedPrefix,
    });
  }
  return pipePath;
}

function normalizeConcurrency(value) {
  const concurrency = cleanToken(value) || "skip_if_running";
  if (!["skip_if_running", "queue_one", "forbid_overlap"].includes(concurrency)) {
    fail("ERR_RECORDER_PIPE_CONCURRENCY_INVALID", "recorder pipe concurrency policy is unsupported", { concurrency });
  }
  return concurrency;
}

function normalizePositiveInteger(value, fallback, { id, code, max }) {
  const parsed = Number.parseInt(String(value ?? fallback), 10);
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > max) {
    fail(code, "recorder pipe numeric policy is out of range", { id, value, max });
  }
  return parsed;
}

function numberValue(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeStringArray(values = [], maxItems = 20, maxLength = 120) {
  const input = Array.isArray(values) ? values : [values];
  const output = [];
  for (const value of input) {
    const text = cleanString(value, maxLength);
    if (text && !output.includes(text)) output.push(text);
    if (output.length >= maxItems) break;
  }
  return output;
}

function assertStore(store) {
  if (!store || typeof store.getRecord !== "function" || typeof store.insertRecord !== "function" || typeof store.updateRecord !== "function") {
    fail("ERR_RECORDER_PIPE_STORE_REQUIRED", "recorder pipe persistence requires a RecorderStore-like store");
  }
}

function cleanRequired(value, label, code, maxLength) {
  const text = cleanString(value, maxLength);
  if (!text) fail(code, `recorder pipe ${label} is required`);
  return text;
}

function cleanNullable(value) {
  const text = cleanString(value, 240);
  return text || null;
}

function cleanToken(value = "") {
  return cleanString(value, 120).toLowerCase().replace(/[^a-z0-9_:-]+/g, "_").replace(/^_+|_+$/g, "");
}

function cleanString(value = "", maxLength = 500) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function toIso(value) {
  const date = value instanceof Date ? value : new Date(value ?? Date.now());
  if (Number.isNaN(date.getTime())) {
    fail("ERR_RECORDER_PIPE_INVALID_TIMESTAMP", "recorder pipe timestamp must be valid ISO-compatible input", { value });
  }
  return date.toISOString();
}

function toDate(value) {
  const date = value instanceof Date ? value : new Date(value ?? Date.now());
  if (Number.isNaN(date.getTime())) {
    fail("ERR_RECORDER_PIPE_INVALID_TIMESTAMP", "recorder pipe timestamp must be valid ISO-compatible input", { value });
  }
  return date;
}

function fail(code, message, details = {}) {
  throw new RecorderPipeError(code, message, details);
}
