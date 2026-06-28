import fs from "node:fs/promises";
import { createServer } from "node:http";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { Worker } from "node:worker_threads";

import { resolveRecorderFrameMediaPath } from "./recorder-delete.mjs";
import { buildRecorderSearchResults } from "./recorder-search.mjs";
import {
  authorizeRecorderRawRead,
  recordRecorderAudit,
} from "./recorder-raw-api-auth.mjs";
import { atomicWriteJson } from "./atomic-store.mjs";
import {
  cancelRecorderPipeRun,
  enqueueDueRecorderPipeRuns,
  listRecorderPipeDefinitions,
  listRecorderPipeRuns,
  runQueuedRecorderPipeRuns,
  runBuiltInRecorderPipe,
} from "./recorder-pipes.mjs";

export const RECORDER_RAW_API_SERVER_SCHEMA_VERSION = 1;

const RAW_API_SCHEMA = "agentic30.recorder.raw_api.v1";
const EXPORT_ARCHIVE_SCHEMA = "agentic30.recorder.export_archive.v1";
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const MAX_EXPORT_BODY_BYTES = 256 * 1024;
const MAX_SQL_QUERY_BODY_BYTES = 64 * 1024;
const MAX_SQL_QUERY_BYTES = 16 * 1024;
const MAX_SQL_ROWS = 1000;
const DEFAULT_SQL_TIMEOUT_MS = 2000;
const MAX_SQL_TIMEOUT_MS = 5000;
const EXPORT_DATA_CLASSES = new Set(["frames", "transcripts", "memory", "product_events"]);
const SQL_INSPECTOR_SCHEMA = "agentic30.recorder.raw_sql.v1";
const SQL_INSPECTOR_VIEWS = Object.freeze([
  "recorder_sql_frames_redacted",
  "recorder_sql_transcripts_redacted",
  "recorder_sql_clipboard_redacted",
  "recorder_sql_memory_items",
  "recorder_sql_product_events",
  "recorder_sql_audit_sanitized",
  "recorder_sql_capture_health",
  "recorder_sql_storage_stats",
]);
const SQL_INSPECTOR_RAW_ADMIN_VIEWS = Object.freeze([
  "recorder_sql_frames_raw_admin",
  "recorder_sql_transcripts_raw_admin",
  "recorder_sql_clipboard_raw_admin",
]);
const SQL_INSPECTOR_VIEW_SET = new Set([
  ...SQL_INSPECTOR_VIEWS,
  ...SQL_INSPECTOR_RAW_ADMIN_VIEWS,
]);
const SQL_INSPECTOR_RAW_ADMIN_VIEW_SET = new Set(SQL_INSPECTOR_RAW_ADMIN_VIEWS);
const SQL_FORBIDDEN_TOKENS = Object.freeze([
  "insert",
  "update",
  "delete",
  "upsert",
  "replace",
  "drop",
  "create",
  "alter",
  "attach",
  "detach",
  "vacuum",
  "reindex",
  "pragma",
  "load_extension",
]);
const SQL_FORBIDDEN_SOURCES = new Set([
  "media_assets",
  "frames",
  "audio_chunks",
  "transcript_segments",
  "clipboard_events",
  "memory_items",
  "product_events",
  "evidence_candidates",
  "recorder_audit",
  "api_tokens",
  "pipe_definitions",
  "pipe_runs",
  "frames_text_fts",
  "transcript_text_fts",
  "clipboard_text_fts",
  "memory_items_fts",
  "product_events_fts",
  "sqlite_master",
  "sqlite_schema",
  "sqlite_temp_master",
]);
const SQL_RAW_COLUMN_TOKENS = Object.freeze([
  "accessibility_text",
  "ocr_text",
  "transcript_text",
  "clipboard_text",
  "content_text",
  "browser_url",
  "document_path",
  "relative_path",
  "media_relative_path",
  "audio_relative_path",
  "token_hash",
  "scopes_json",
  "permission_manifest_json",
  "input_manifest_json",
  "output_manifest_json",
  "audit_log_json",
]);

export class RecorderRawApiServerError extends Error {
  constructor(code, message, details = {}) {
    super(`${code}: ${message}`);
    this.name = "RecorderRawApiServerError";
    this.code = code;
    this.details = details;
  }
}

export async function createRecorderRawApiServer({
  store,
  host = "127.0.0.1",
  port = 0,
  trustedOrigins = undefined,
  now = () => new Date(),
} = {}) {
  assertLoopbackHost(host);
  assertStore(store);
  const server = createServer(async (req, res) => {
    let response;
    try {
      response = await handleRecorderRawApiRequest({
        store,
        method: req.method,
        url: req.url,
        headers: req.headers,
        body: await readRequestBody(req),
        trustedOrigins,
        now: typeof now === "function" ? now() : now,
      });
    } catch (error) {
      response = errorResponse(error);
    }
    writeHttpResponse(res, response);
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  return {
    server,
    host,
    port: address.port,
    url: `http://${host}:${address.port}`,
    close: () => new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    }),
  };
}

export async function handleRecorderRawApiRequest({
  store,
  method = "GET",
  url = "/",
  headers = {},
  body = "",
  trustedOrigins = undefined,
  now = new Date(),
} = {}) {
  try {
    assertStore(store);
    const request = normalizeRequest({ method, url, headers, now });
    if (
      request.method !== "GET"
      && !(request.method === "POST" && isAllowedPostPath(request.path))
    ) {
      fail("ERR_RECORDER_RAW_API_METHOD_NOT_ALLOWED", "recorder raw API route does not allow this method", {
        method: request.method,
        path: request.path,
      });
    }

    if (request.path === "/recorder/export/archive") {
      if (request.method !== "POST") {
        fail("ERR_RECORDER_RAW_API_METHOD_NOT_ALLOWED", "recorder export archive requires POST");
      }
      const exportRequest = parseExportRequest(body);
      assertExportArchiveConfirmed(exportRequest);
      const authorization = authorize(request, store, "export", [{ id: "export_archive", source_type: "export_archive" }], trustedOrigins);
      const manifest = buildExportManifest({
        store,
        request: exportRequest,
        generatedAt: request.now,
      });
      const archive = await writeExportArchive({
        store,
        manifest,
        request: exportRequest,
        generatedAt: request.now,
      });
      return jsonResponse(200, withRawApiBoundary({
        schema: RAW_API_SCHEMA,
        schemaVersion: RECORDER_RAW_API_SERVER_SCHEMA_VERSION,
        schema_version: RECORDER_RAW_API_SERVER_SCHEMA_VERSION,
        exportArchive: archive,
        export_archive: archive,
      }, authorization.audit));
    }
    if (request.path === "/recorder/export") {
      if (request.method !== "POST") {
        fail("ERR_RECORDER_RAW_API_METHOD_NOT_ALLOWED", "recorder export requires POST");
      }
      const exportRequest = parseExportRequest(body);
      const authorization = authorize(request, store, "export", [{ id: "export_manifest", source_type: "export_manifest" }], trustedOrigins);
      const manifest = buildExportManifest({
        store,
        request: exportRequest,
        generatedAt: request.now,
      });
      return jsonResponse(200, withRawApiBoundary({
        schema: RAW_API_SCHEMA,
        schemaVersion: RECORDER_RAW_API_SERVER_SCHEMA_VERSION,
        schema_version: RECORDER_RAW_API_SERVER_SCHEMA_VERSION,
        exportManifest: manifest,
        export_manifest: manifest,
      }, authorization.audit));
    }
    if (request.path === "/recorder/sql/query") {
      if (request.method !== "POST") {
        fail("ERR_RECORDER_RAW_API_METHOD_NOT_ALLOWED", "recorder SQL inspector requires POST");
      }
      const authorization = authorize(
        request,
        store,
        "raw_sql",
        [{ id: "recorder_sql_query", source_type: "raw_sql" }],
        trustedOrigins,
      );
      try {
        const sqlRequest = parseSqlQueryRequest(body);
        const plan = validateRecorderSqlQuery(sqlRequest, authorization);
        const sqlResult = await executeRecorderSqlQuery({
          store,
          sqlRequest,
          plan,
          generatedAt: request.now,
        });
        return jsonResponse(200, withRawApiBoundary({
          schema: RAW_API_SCHEMA,
          schemaVersion: RECORDER_RAW_API_SERVER_SCHEMA_VERSION,
          schema_version: RECORDER_RAW_API_SERVER_SCHEMA_VERSION,
          sql: sqlResult,
          rawSql: sqlResult,
          raw_sql: sqlResult,
        }, authorization.audit));
      } catch (error) {
        recordSqlInspectorDeniedAudit({ store, request, authorization, error });
        throw error;
      }
    }
    if (request.path === "/recorder/health") {
      const authorization = authorize(request, store, "summary", [], trustedOrigins);
      return jsonResponse(200, healthDto(store, authorization.audit, request.now));
    }
    if (request.path === "/recorder/search") {
      const authorization = authorize(request, store, "search", [], trustedOrigins);
      const query = request.searchParams.get("q") || request.searchParams.get("query") || "";
      const response = buildRecorderSearchResults({
        store,
        query,
        workspaceId: request.searchParams.get("workspaceId") || request.searchParams.get("workspace_id"),
        projectId: request.searchParams.get("projectId") || request.searchParams.get("project_id"),
        startedAt: request.searchParams.get("startedAt") || request.searchParams.get("started_at"),
        endedAt: request.searchParams.get("endedAt") || request.searchParams.get("ended_at"),
        sourceTypes: parseCsv(request.searchParams.get("sourceTypes") || request.searchParams.get("source_types")) || undefined,
        limit: request.searchParams.get("limit") || DEFAULT_LIMIT,
        now: request.now,
      });
      return jsonResponse(200, withRawApiBoundary(response, authorization.audit));
    }
    if (request.path === "/recorder/frames") {
      const authorization = authorize(request, store, "frame", [], trustedOrigins);
      const frames = listFrameRows(store, request.searchParams)
        .map((frame) => frameDto({ store, frame, includeDebugPaths: shouldExposeDebugPaths(request, authorization) }));
      return jsonResponse(200, withRawApiBoundary({
        schema: RAW_API_SCHEMA,
        schemaVersion: RECORDER_RAW_API_SERVER_SCHEMA_VERSION,
        schema_version: RECORDER_RAW_API_SERVER_SCHEMA_VERSION,
        generatedAt: toIso(request.now),
        generated_at: toIso(request.now),
        resultCount: frames.length,
        result_count: frames.length,
        frames,
      }, authorization.audit));
    }
    const frameMatch = request.path.match(/^\/recorder\/frames\/([^/]+)$/);
    if (frameMatch) {
      const frameId = decodeURIComponent(frameMatch[1]);
      const authorization = authorize(request, store, "frame", [{ id: frameId, source_type: "frame" }], trustedOrigins);
      const frame = requireFrame(store, frameId);
      return jsonResponse(200, withRawApiBoundary({
        schema: RAW_API_SCHEMA,
        schemaVersion: RECORDER_RAW_API_SERVER_SCHEMA_VERSION,
        schema_version: RECORDER_RAW_API_SERVER_SCHEMA_VERSION,
        frame: frameDto({ store, frame, includeDebugPaths: shouldExposeDebugPaths(request, authorization) }),
      }, authorization.audit));
    }
    const frameTextMatch = request.path.match(/^\/recorder\/frames\/([^/]+)\/text$/);
    if (frameTextMatch) {
      const frameId = decodeURIComponent(frameTextMatch[1]);
      const authorization = authorize(request, store, "raw_frame", [{ id: frameId, source_type: "frame" }], trustedOrigins);
      const frame = requireFrame(store, frameId);
      return jsonResponse(200, withRawApiBoundary({
        schema: RAW_API_SCHEMA,
        schemaVersion: RECORDER_RAW_API_SERVER_SCHEMA_VERSION,
        schema_version: RECORDER_RAW_API_SERVER_SCHEMA_VERSION,
        frameId: frame.id,
        frame_id: frame.id,
        textSource: cleanString(frame.text_source, 80),
        text_source: cleanString(frame.text_source, 80),
        accessibilityText: cleanString(frame.accessibility_text, 20000),
        accessibility_text: cleanString(frame.accessibility_text, 20000),
        ocrText: cleanString(frame.ocr_text, 20000),
        ocr_text: cleanString(frame.ocr_text, 20000),
        redactedText: cleanString(frame.redacted_text, 20000),
        redacted_text: cleanString(frame.redacted_text, 20000),
      }, authorization.audit));
    }
    const frameImageMatch = request.path.match(/^\/recorder\/frames\/([^/]+)\/image$/);
    if (frameImageMatch) {
      const frameId = decodeURIComponent(frameImageMatch[1]);
      const authorization = authorize(request, store, "raw_frame", [{ id: frameId, source_type: "frame" }], trustedOrigins);
      const frame = requireFrame(store, frameId);
      const mediaAsset = requireMediaAsset(store, frame.snapshot_asset_id);
      const mediaPath = resolveRecorderFrameMediaPath(store, mediaAsset);
      const body = await fs.readFile(mediaPath);
      return {
        status: 200,
        headers: {
          "content-type": "image/jpeg",
          "cache-control": "no-store",
          "x-agentic30-recorder-frame-id": frame.id,
          "x-agentic30-recorder-media-asset-id": mediaAsset.id,
          "x-agentic30-recorder-audit-id": authorization.audit.id,
        },
        body,
      };
    }
    if (request.path === "/recorder/audio") {
      const authorization = authorize(request, store, "audio", [], trustedOrigins);
      const audio = listAudioRows(store, request.searchParams)
        .map((row) => audioDto({ store, audio: row }));
      return jsonResponse(200, withRawApiBoundary({
        schema: RAW_API_SCHEMA,
        schemaVersion: RECORDER_RAW_API_SERVER_SCHEMA_VERSION,
        schema_version: RECORDER_RAW_API_SERVER_SCHEMA_VERSION,
        generatedAt: toIso(request.now),
        generated_at: toIso(request.now),
        resultCount: audio.length,
        result_count: audio.length,
        audio,
      }, authorization.audit));
    }
    const audioMatch = request.path.match(/^\/recorder\/audio\/([^/]+)$/);
    if (audioMatch) {
      const audioId = decodeURIComponent(audioMatch[1]);
      const authorization = authorize(request, store, "audio", [{ id: audioId, source_type: "audio_chunk" }], trustedOrigins);
      const audio = requireAudioChunk(store, audioId);
      return jsonResponse(200, withRawApiBoundary({
        schema: RAW_API_SCHEMA,
        schemaVersion: RECORDER_RAW_API_SERVER_SCHEMA_VERSION,
        schema_version: RECORDER_RAW_API_SERVER_SCHEMA_VERSION,
        audio: audioDto({ store, audio }),
      }, authorization.audit));
    }
    const audioMediaMatch = request.path.match(/^\/recorder\/audio\/([^/]+)\/media$/);
    if (audioMediaMatch) {
      const audioId = decodeURIComponent(audioMediaMatch[1]);
      const authorization = authorize(request, store, "raw_audio", [{ id: audioId, source_type: "audio_chunk" }], trustedOrigins);
      const audio = requireAudioChunk(store, audioId);
      const mediaAsset = requireAudioMediaAsset(store, audio.audio_asset_id);
      const mediaPath = resolveRecorderAudioMediaPath(store, mediaAsset);
      const body = await readRawMediaFile(mediaPath, mediaAsset.id, "audio");
      return {
        status: 200,
        headers: {
          "content-type": "audio/mp4",
          "cache-control": "no-store",
          "x-agentic30-recorder-audio-id": audio.id,
          "x-agentic30-recorder-media-asset-id": mediaAsset.id,
          "x-agentic30-recorder-audit-id": authorization.audit.id,
        },
        body,
      };
    }
    if (request.path === "/recorder/transcripts") {
      const authorization = authorize(request, store, "audio", [], trustedOrigins);
      const transcripts = listTranscriptRows(store, request.searchParams)
        .map((row) => transcriptDto(row));
      return jsonResponse(200, withRawApiBoundary({
        schema: RAW_API_SCHEMA,
        schemaVersion: RECORDER_RAW_API_SERVER_SCHEMA_VERSION,
        schema_version: RECORDER_RAW_API_SERVER_SCHEMA_VERSION,
        generatedAt: toIso(request.now),
        generated_at: toIso(request.now),
        resultCount: transcripts.length,
        result_count: transcripts.length,
        transcripts,
      }, authorization.audit));
    }
    if (request.path === "/recorder/memory") {
      const authorization = authorize(request, store, "summary", [], trustedOrigins);
      const memory = listMemoryRows(store, request.searchParams)
        .map((row) => memoryDto(row));
      return jsonResponse(200, withRawApiBoundary({
        schema: RAW_API_SCHEMA,
        schemaVersion: RECORDER_RAW_API_SERVER_SCHEMA_VERSION,
        schema_version: RECORDER_RAW_API_SERVER_SCHEMA_VERSION,
        generatedAt: toIso(request.now),
        generated_at: toIso(request.now),
        resultCount: memory.length,
        result_count: memory.length,
        memory,
      }, authorization.audit));
    }
    if (request.path === "/recorder/pipes") {
      const authorization = authorize(request, store, "pipe", [], trustedOrigins);
      const pipes = listRecorderPipeDefinitions({
        store,
        limit: request.searchParams.get("limit") || DEFAULT_LIMIT,
      });
      return jsonResponse(200, withRawApiBoundary({
        schema: RAW_API_SCHEMA,
        schemaVersion: RECORDER_RAW_API_SERVER_SCHEMA_VERSION,
        schema_version: RECORDER_RAW_API_SERVER_SCHEMA_VERSION,
        generatedAt: toIso(request.now),
        generated_at: toIso(request.now),
        resultCount: pipes.length,
        result_count: pipes.length,
        pipes,
      }, authorization.audit));
    }
    if (request.path === "/recorder/pipes/runs") {
      const authorization = authorize(request, store, "pipe", [], trustedOrigins);
      const runs = listRecorderPipeRuns({
        store,
        pipeId: request.searchParams.get("pipeId") || request.searchParams.get("pipe_id"),
        limit: request.searchParams.get("limit") || DEFAULT_LIMIT,
      });
      return jsonResponse(200, withRawApiBoundary({
        schema: RAW_API_SCHEMA,
        schemaVersion: RECORDER_RAW_API_SERVER_SCHEMA_VERSION,
        schema_version: RECORDER_RAW_API_SERVER_SCHEMA_VERSION,
        generatedAt: toIso(request.now),
        generated_at: toIso(request.now),
        resultCount: runs.length,
        result_count: runs.length,
        runs,
      }, authorization.audit));
    }
    if (request.path === "/recorder/pipes/scheduler/tick") {
      if (request.method !== "POST") {
        fail("ERR_RECORDER_RAW_API_METHOD_NOT_ALLOWED", "recorder pipe scheduler tick requires POST");
      }
      const tickRequest = parsePipeSchedulerTickRequest(body);
      const authorization = authorize(request, store, "pipe", [{ id: "pipe_scheduler", source_type: "pipe_scheduler" }], trustedOrigins);
      const enqueueResult = enqueueDueRecorderPipeRuns({
        store,
        workspaceId: tickRequest.workspaceId,
        projectId: tickRequest.projectId,
        limit: tickRequest.limit,
        now: request.now,
      });
      const drainResult = tickRequest.autoRun
        ? await runQueuedRecorderPipeRuns({
          store,
          maxRuns: tickRequest.maxRuns,
          timeoutMs: tickRequest.timeoutMs,
          now: request.now,
        })
        : null;
      return jsonResponse(200, withRawApiBoundary({
        schema: RAW_API_SCHEMA,
        schemaVersion: RECORDER_RAW_API_SERVER_SCHEMA_VERSION,
        schema_version: RECORDER_RAW_API_SERVER_SCHEMA_VERSION,
        scheduler: enqueueResult,
        enqueueResult,
        enqueue_result: enqueueResult,
        drainResult,
        drain_result: drainResult,
      }, authorization.audit));
    }
    const pipeRunMatch = request.path.match(/^\/recorder\/pipes\/([^/]+)\/run$/);
    if (pipeRunMatch) {
      if (request.method !== "POST") {
        fail("ERR_RECORDER_RAW_API_METHOD_NOT_ALLOWED", "recorder pipe run requires POST");
      }
      const pipeId = decodeURIComponent(pipeRunMatch[1]);
      const runRequest = parsePipeRunRequest(body);
      const authorization = authorize(request, store, "pipe", [{ id: pipeId, source_type: "pipe_definition" }], trustedOrigins);
      const result = await runBuiltInRecorderPipe({
        store,
        pipeId,
        workspaceId: runRequest.workspaceId,
        projectId: runRequest.projectId,
        startedAt: runRequest.startedAt,
        endedAt: runRequest.endedAt,
        triggerReason: runRequest.triggerReason,
        runId: runRequest.runId,
        limit: runRequest.limit,
        timeoutMs: runRequest.timeoutMs,
        now: request.now,
      });
      return jsonResponse(200, withRawApiBoundary({
        schema: RAW_API_SCHEMA,
        schemaVersion: RECORDER_RAW_API_SERVER_SCHEMA_VERSION,
        schema_version: RECORDER_RAW_API_SERVER_SCHEMA_VERSION,
        pipeRun: result.pipeRun,
        pipe_run: result.pipe_run,
        outputManifest: result.outputManifest,
        output_manifest: result.output_manifest,
      }, authorization.audit));
    }
    const pipeCancelMatch = request.path.match(/^\/recorder\/pipes\/runs\/([^/]+)\/cancel$/);
    if (pipeCancelMatch) {
      if (request.method !== "POST") {
        fail("ERR_RECORDER_RAW_API_METHOD_NOT_ALLOWED", "recorder pipe cancel requires POST");
      }
      const cancelRequest = parsePipeCancelRequest(body);
      const runId = decodeURIComponent(pipeCancelMatch[1]);
      const authorization = authorize(request, store, "pipe", [{ id: runId, source_type: "pipe_run" }], trustedOrigins);
      const result = cancelRecorderPipeRun({
        store,
        runId,
        reason: cancelRequest.reason,
        now: request.now,
      });
      return jsonResponse(200, withRawApiBoundary({
        schema: RAW_API_SCHEMA,
        schemaVersion: RECORDER_RAW_API_SERVER_SCHEMA_VERSION,
        schema_version: RECORDER_RAW_API_SERVER_SCHEMA_VERSION,
        pipeRun: result.pipeRun,
        pipe_run: result.pipe_run,
        outputManifest: result.outputManifest,
        output_manifest: result.output_manifest,
      }, authorization.audit));
    }
    if (request.path === "/recorder/audit") {
      const authorization = authorize(request, store, "raw_admin", [{ id: "recorder_audit", source_type: "recorder_audit" }], trustedOrigins);
      const rows = listAuditRows(store, request.searchParams);
      return jsonResponse(200, withRawApiBoundary({
        schema: RAW_API_SCHEMA,
        schemaVersion: RECORDER_RAW_API_SERVER_SCHEMA_VERSION,
        schema_version: RECORDER_RAW_API_SERVER_SCHEMA_VERSION,
        generatedAt: toIso(request.now),
        generated_at: toIso(request.now),
        resultCount: rows.length,
        result_count: rows.length,
        audit: rows,
      }, authorization.audit));
    }

    fail("ERR_RECORDER_RAW_API_ROUTE_NOT_FOUND", `recorder raw API route not found: ${request.path}`, {
      path: request.path,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

function authorize(request, store, requiredAccessLevel, sourceIds, trustedOrigins) {
  return authorizeRecorderRawRead({
    store,
    token: request.token,
    requiredAccessLevel,
    endpoint: request.path,
    origin: request.origin,
    requestId: request.requestId,
    workspaceId: request.searchParams.get("workspaceId") || request.searchParams.get("workspace_id"),
    projectId: request.searchParams.get("projectId") || request.searchParams.get("project_id"),
    sourceIds,
    trustedOrigins,
    now: request.now,
  });
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalBytes = 0;
    let tooLarge = false;
    req.on("data", (chunk) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      totalBytes += buffer.byteLength;
      if (totalBytes > MAX_EXPORT_BODY_BYTES) {
        tooLarge = true;
        chunks.length = 0;
        return;
      }
      if (!tooLarge) chunks.push(buffer);
    });
    req.on("error", (error) => {
      reject(error);
    });
    req.on("end", () => {
      if (tooLarge) {
        reject(new RecorderRawApiServerError(
          "ERR_RECORDER_RAW_API_BODY_TOO_LARGE",
          "recorder raw API request body exceeds the maximum allowed size",
          { maxBytes: MAX_EXPORT_BODY_BYTES },
        ));
        return;
      }
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
  });
}

function parseExportRequest(body) {
  const text = String(body ?? "").trim();
  if (!text) {
    fail("ERR_RECORDER_RAW_API_EXPORT_BODY_REQUIRED", "recorder export requires an explicit JSON body");
  }
  if (Buffer.byteLength(text, "utf8") > MAX_EXPORT_BODY_BYTES) {
    fail("ERR_RECORDER_RAW_API_BODY_TOO_LARGE", "recorder export request body exceeds the maximum allowed size", {
      maxBytes: MAX_EXPORT_BODY_BYTES,
    });
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    fail("ERR_RECORDER_RAW_API_EXPORT_BODY_INVALID_JSON", "recorder export requires a valid JSON body");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    fail("ERR_RECORDER_RAW_API_EXPORT_BODY_INVALID", "recorder export body must be a JSON object");
  }

  const startedAt = cleanString(parsed.startedAt ?? parsed.started_at, 80) || null;
  const endedAt = cleanString(parsed.endedAt ?? parsed.ended_at, 80) || null;
  return {
    dataClasses: normalizeExportDataClasses(parsed.dataClasses ?? parsed.data_classes),
    workspaceId: cleanString(parsed.workspaceId ?? parsed.workspace_id, 240) || null,
    projectId: cleanString(parsed.projectId ?? parsed.project_id, 240) || null,
    startedAt,
    endedAt,
    range: normalizeOptionalRange({ startedAt, endedAt, label: "recorder export" }),
    limit: normalizeLimit(parsed.limit ?? DEFAULT_LIMIT),
    reason: cleanString(parsed.reason, 240) || "manual_export",
    approvedByLocalUser: parsed.approvedByLocalUser === true || parsed.approved_by_local_user === true,
    approved_by_local_user: parsed.approvedByLocalUser === true || parsed.approved_by_local_user === true,
  };
}

function parseSqlQueryRequest(body) {
  const rawBody = String(body ?? "");
  if (!rawBody.trim()) {
    fail("ERR_RECORDER_RAW_API_SQL_BODY_REQUIRED", "recorder SQL inspector requires an explicit JSON body");
  }
  if (Buffer.byteLength(rawBody, "utf8") > MAX_SQL_QUERY_BODY_BYTES) {
    fail("ERR_RECORDER_RAW_API_SQL_BODY_TOO_LARGE", "recorder SQL inspector request body exceeds the maximum allowed size", {
      maxBytes: MAX_SQL_QUERY_BODY_BYTES,
    });
  }
  let parsed;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    fail("ERR_RECORDER_RAW_API_SQL_BODY_INVALID_JSON", "recorder SQL inspector requires a valid JSON body");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    fail("ERR_RECORDER_RAW_API_SQL_BODY_INVALID", "recorder SQL inspector body must be a JSON object");
  }
  const query = String(parsed.query ?? parsed.sql ?? "").trim();
  if (!query) {
    fail("ERR_RECORDER_RAW_API_SQL_QUERY_REQUIRED", "recorder SQL inspector requires query");
  }
  if (Buffer.byteLength(query, "utf8") > MAX_SQL_QUERY_BYTES) {
    fail("ERR_RECORDER_RAW_API_SQL_QUERY_TOO_LARGE", "recorder SQL query exceeds the maximum allowed size", {
      maxBytes: MAX_SQL_QUERY_BYTES,
    });
  }
  const timeoutMs = normalizeSqlTimeout(parsed.timeoutMs ?? parsed.timeout_ms ?? DEFAULT_SQL_TIMEOUT_MS);
  return {
    query,
    includeRawColumns: parsed.includeRawColumns === true || parsed.include_raw_columns === true,
    include_raw_columns: parsed.includeRawColumns === true || parsed.include_raw_columns === true,
    timeoutMs,
    timeout_ms: timeoutMs,
  };
}

function parsePipeRunRequest(body) {
  const parsed = parseJsonBody(body, {
    required: true,
    emptyCode: "ERR_RECORDER_RAW_API_PIPE_RUN_BODY_REQUIRED",
    invalidJsonCode: "ERR_RECORDER_RAW_API_PIPE_RUN_BODY_INVALID_JSON",
    invalidBodyCode: "ERR_RECORDER_RAW_API_PIPE_RUN_BODY_INVALID",
    label: "recorder pipe run",
  });
  const startedAt = cleanString(parsed.startedAt ?? parsed.started_at, 80);
  const endedAt = cleanString(parsed.endedAt ?? parsed.ended_at, 80);
  if (!startedAt || !endedAt) {
    fail("ERR_RECORDER_RAW_API_PIPE_RUN_TIME_RANGE_REQUIRED", "recorder pipe run requires both startedAt and endedAt");
  }
  normalizeOptionalRange({ startedAt, endedAt, label: "recorder pipe run" });
  const timeoutCandidate = parsed.timeoutMs ?? parsed.timeout_ms;
  const timeoutMs = timeoutCandidate === undefined || timeoutCandidate === null || timeoutCandidate === ""
    ? null
    : normalizeNonNegativeInteger(timeoutCandidate, "timeoutMs", "ERR_RECORDER_RAW_API_PIPE_TIMEOUT_INVALID", 300_000);
  return {
    workspaceId: cleanString(parsed.workspaceId ?? parsed.workspace_id, 240) || null,
    projectId: cleanString(parsed.projectId ?? parsed.project_id, 240) || null,
    startedAt,
    endedAt,
    triggerReason: cleanString(parsed.triggerReason ?? parsed.trigger_reason, 120) || "manual_raw_api",
    runId: cleanString(parsed.runId ?? parsed.run_id, 240) || undefined,
    limit: normalizeLimit(parsed.limit ?? DEFAULT_LIMIT),
    timeoutMs,
  };
}

function parsePipeCancelRequest(body) {
  const parsed = parseJsonBody(body, {
    required: false,
    emptyCode: "ERR_RECORDER_RAW_API_PIPE_CANCEL_BODY_REQUIRED",
    invalidJsonCode: "ERR_RECORDER_RAW_API_PIPE_CANCEL_BODY_INVALID_JSON",
    invalidBodyCode: "ERR_RECORDER_RAW_API_PIPE_CANCEL_BODY_INVALID",
    label: "recorder pipe cancel",
  });
  return {
    reason: cleanString(parsed.reason, 240) || "local_user_cancelled",
  };
}

function parsePipeSchedulerTickRequest(body) {
  const parsed = parseJsonBody(body, {
    required: false,
    emptyCode: "ERR_RECORDER_RAW_API_PIPE_SCHEDULER_BODY_REQUIRED",
    invalidJsonCode: "ERR_RECORDER_RAW_API_PIPE_SCHEDULER_BODY_INVALID_JSON",
    invalidBodyCode: "ERR_RECORDER_RAW_API_PIPE_SCHEDULER_BODY_INVALID",
    label: "recorder pipe scheduler tick",
  });
  const timeoutCandidate = parsed.timeoutMs ?? parsed.timeout_ms;
  return {
    workspaceId: cleanString(parsed.workspaceId ?? parsed.workspace_id, 240) || null,
    projectId: cleanString(parsed.projectId ?? parsed.project_id, 240) || null,
    limit: normalizeLimit(parsed.limit ?? DEFAULT_LIMIT),
    maxRuns: normalizeLimit(parsed.maxRuns ?? parsed.max_runs ?? 10),
    timeoutMs: timeoutCandidate === undefined || timeoutCandidate === null || timeoutCandidate === ""
      ? null
      : normalizeNonNegativeInteger(timeoutCandidate, "timeoutMs", "ERR_RECORDER_RAW_API_PIPE_TIMEOUT_INVALID", 300_000),
    autoRun: parsed.autoRun !== false && parsed.auto_run !== false,
  };
}

function parseJsonBody(body, {
  required,
  emptyCode,
  invalidJsonCode,
  invalidBodyCode,
  label,
}) {
  const text = String(body ?? "").trim();
  if (!text) {
    if (!required) return {};
    fail(emptyCode, `${label} requires an explicit JSON body`);
  }
  if (Buffer.byteLength(text, "utf8") > MAX_EXPORT_BODY_BYTES) {
    fail("ERR_RECORDER_RAW_API_BODY_TOO_LARGE", `${label} request body exceeds the maximum allowed size`, {
      maxBytes: MAX_EXPORT_BODY_BYTES,
    });
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    fail(invalidJsonCode, `${label} requires a valid JSON body`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    fail(invalidBodyCode, `${label} body must be a JSON object`);
  }
  return parsed;
}

function normalizeExportDataClasses(value) {
  if (!Array.isArray(value) || value.length === 0) {
    fail("ERR_RECORDER_RAW_API_EXPORT_DATA_CLASSES_REQUIRED", "recorder export requires at least one data class");
  }
  const output = [];
  const seen = new Set();
  for (const item of value) {
    const raw = cleanString(item, 80);
    const key = raw.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase().replace(/[\s-]+/g, "_");
    const normalized = {
      frame: "frames",
      frames: "frames",
      memory: "memory",
      memory_item: "memory",
      memory_items: "memory",
      transcript: "transcripts",
      transcripts: "transcripts",
      transcript_segment: "transcripts",
      transcript_segments: "transcripts",
      product_event: "product_events",
      product_events: "product_events",
      productevents: "product_events",
      events: "product_events",
    }[key];
    if (!normalized || !EXPORT_DATA_CLASSES.has(normalized)) {
      fail("ERR_RECORDER_RAW_API_EXPORT_UNSUPPORTED_DATA_CLASS", "recorder export does not support this data class yet", {
        dataClass: raw || "(missing)",
        supportedDataClasses: [...EXPORT_DATA_CLASSES],
      });
    }
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    output.push(normalized);
  }
  return output;
}

function buildExportManifest({ store, request, generatedAt }) {
  const items = [];
  for (const dataClass of request.dataClasses) {
    if (dataClass === "frames") {
      items.push(...listExportFrameRows(store, request).map(exportFrameItem));
    } else if (dataClass === "transcripts") {
      items.push(...listExportTranscriptRows(store, request).map(exportTranscriptItem));
    } else if (dataClass === "memory") {
      items.push(...listExportMemoryRows(store, request).map(exportMemoryItem));
    } else if (dataClass === "product_events") {
      items.push(...listExportProductEventRows(store, request).map(exportProductEventItem));
    } else {
      fail("ERR_RECORDER_RAW_API_EXPORT_UNSUPPORTED_DATA_CLASS", "recorder export does not support this data class yet", {
        dataClass,
      });
    }
  }

  const sortedItems = items
    .sort((lhs, rhs) => String(rhs.timestamp || "").localeCompare(String(lhs.timestamp || "")))
    .slice(0, request.limit);
  const timeRange = request.startedAt && request.endedAt
    ? { startedAt: request.startedAt, started_at: request.startedAt, endedAt: request.endedAt, ended_at: request.endedAt }
    : null;

  return {
    id: `export-${randomUUID()}`,
    schema: "agentic30.recorder.export_manifest.v1",
    schemaVersion: RECORDER_RAW_API_SERVER_SCHEMA_VERSION,
    schema_version: RECORDER_RAW_API_SERVER_SCHEMA_VERSION,
    generatedAt: toIso(generatedAt),
    generated_at: toIso(generatedAt),
    reason: request.reason,
    filters: stripEmpty({
      workspaceId: request.workspaceId,
      workspace_id: request.workspaceId,
      projectId: request.projectId,
      project_id: request.projectId,
      timeRange,
      time_range: timeRange,
      dataClasses: request.dataClasses,
      data_classes: request.dataClasses,
      limit: request.limit,
    }),
    itemCount: sortedItems.length,
    item_count: sortedItems.length,
    items: sortedItems,
    proofBoundary: {
      proofAcceptedByExport: false,
      proof_accepted_by_export: false,
      message: "Recorder export manifests are local data access, not accepted proof.",
    },
    proof_boundary: {
      proof_accepted_by_export: false,
      message: "Recorder export manifests are local data access, not accepted proof.",
    },
  };
}

async function writeExportArchive({ store, manifest, request, generatedAt }) {
  assertExportArchiveConfirmed(request);
  const archiveId = `archive-${randomUUID()}`;
  const archiveFile = resolveRecorderExportArchivePath(store, archiveId);
  const payload = {
    schema: EXPORT_ARCHIVE_SCHEMA,
    schemaVersion: RECORDER_RAW_API_SERVER_SCHEMA_VERSION,
    schema_version: RECORDER_RAW_API_SERVER_SCHEMA_VERSION,
    archiveId,
    archive_id: archiveId,
    manifestId: manifest.id,
    manifest_id: manifest.id,
    generatedAt: toIso(generatedAt),
    generated_at: toIso(generatedAt),
    reason: request.reason,
    localOnly: true,
    local_only: true,
    pathExposed: false,
    path_exposed: false,
    exportManifest: manifest,
    export_manifest: manifest,
    proofBoundary: {
      proofAcceptedByArchive: false,
      proof_accepted_by_archive: false,
      proofAcceptedByExport: false,
      proof_accepted_by_export: false,
      message: "Recorder export archives are user-triggered local files, not accepted proof.",
    },
    proof_boundary: {
      proof_accepted_by_archive: false,
      proof_accepted_by_export: false,
      message: "Recorder export archives are user-triggered local files, not accepted proof.",
    },
  };
  await atomicWriteJson(archiveFile, payload);
  const raw = await fs.readFile(archiveFile);
  const sha256 = `sha256:${createHash("sha256").update(raw).digest("hex")}`;
  return {
    id: archiveId,
    archiveId,
    archive_id: archiveId,
    manifestId: manifest.id,
    manifest_id: manifest.id,
    generatedAt: toIso(generatedAt),
    generated_at: toIso(generatedAt),
    itemCount: manifest.itemCount,
    item_count: manifest.itemCount,
    dataClasses: request.dataClasses,
    data_classes: request.dataClasses,
    byteSize: raw.byteLength,
    byte_size: raw.byteLength,
    sha256,
    localOnly: true,
    local_only: true,
    pathExposed: false,
    path_exposed: false,
    proofAcceptedByArchive: false,
    proof_accepted_by_archive: false,
    proofAcceptedByExport: false,
    proof_accepted_by_export: false,
  };
}

function resolveRecorderExportArchivePath(store, archiveId) {
  const recorderRoot = path.dirname(store.dbPath);
  const id = cleanString(archiveId, 240);
  if (!id || id.includes("/") || id.includes("\\") || id.includes("..")) {
    fail("ERR_RECORDER_RAW_API_EXPORT_ARCHIVE_ID_INVALID", "recorder export archive id is invalid");
  }
  return path.join(recorderRoot, "exports", `${id}.json`);
}

function assertExportArchiveConfirmed(request) {
  if (request?.approvedByLocalUser !== true && request?.approved_by_local_user !== true) {
    fail(
      "ERR_RECORDER_RAW_API_EXPORT_ARCHIVE_CONFIRMATION_REQUIRED",
      "recorder export archive writing requires explicit local user approval",
    );
  }
}

function listExportFrameRows(store, request) {
  return store.listRecords("frames", { limit: 5000 })
    .filter((row) => exportRowAllowed(row, request, "captured_at"))
    .sort((lhs, rhs) => String(rhs.captured_at || "").localeCompare(String(lhs.captured_at || "")));
}

function listExportTranscriptRows(store, request) {
  return store.listRecords("transcript_segments", { limit: 5000 })
    .map((transcript) => ({
      transcript,
      audio: transcript.audio_chunk_id ? store.getRecord("audio_chunks", transcript.audio_chunk_id) : null,
    }))
    .filter(({ transcript, audio }) => transcriptExportRowAllowed(transcript, audio, request))
    .sort((lhs, rhs) => String(rhs.transcript.started_at || "").localeCompare(String(lhs.transcript.started_at || "")));
}

function listExportMemoryRows(store, request) {
  return store.listRecords("memory_items", { limit: 5000 })
    .filter((row) => exportRowAllowed(row, request, "created_at"))
    .sort((lhs, rhs) => String(rhs.created_at || "").localeCompare(String(lhs.created_at || "")));
}

function listExportProductEventRows(store, request) {
  return store.listRecords("product_events", { limit: 5000 })
    .filter((row) => exportRowAllowed(row, request, "occurred_at"))
    .sort((lhs, rhs) => String(rhs.occurred_at || "").localeCompare(String(lhs.occurred_at || "")));
}

function exportRowAllowed(row, request, timestampField) {
  if (row.deleted_at) return false;
  if (Number(row.safe_for_export) !== 1) return false;
  if (request.workspaceId && row.workspace_id !== request.workspaceId) return false;
  if (request.projectId && row.project_id !== request.projectId) return false;
  if (request.range) {
    const timestamp = Date.parse(row[timestampField]);
    if (!Number.isFinite(timestamp) || timestamp < request.range.startedAtMs || timestamp >= request.range.endedAtMs) return false;
  }
  return true;
}

function transcriptExportRowAllowed(row, audio, request) {
  if (row.deleted_at) return false;
  if (!audio || audio.deleted_at) return false;
  if (audio.transcript_status !== "local_complete") return false;
  if (Number(row.safe_for_search) !== 1 || Number(row.safe_for_memory) !== 1) return false;
  if (row.redaction_status !== "redacted") return false;
  if (!["searchable_local", "memory_safe"].includes(row.privacy_state)) return false;
  if (request.workspaceId && row.workspace_id !== request.workspaceId) return false;
  if (request.projectId && row.project_id !== request.projectId) return false;
  if (request.range) {
    const timestamp = Date.parse(row.started_at);
    if (!Number.isFinite(timestamp) || timestamp < request.range.startedAtMs || timestamp >= request.range.endedAtMs) return false;
  }
  return true;
}

function exportFrameItem(frame) {
  return stripEmpty({
    dataClass: "frame",
    data_class: "frame",
    sourceId: frame.id,
    source_id: frame.id,
    id: frame.id,
    workspaceId: frame.workspace_id,
    workspace_id: frame.workspace_id,
    projectId: frame.project_id,
    project_id: frame.project_id,
    timestamp: frame.captured_at,
    capturedAt: frame.captured_at,
    captured_at: frame.captured_at,
    appName: frame.app_name,
    app_name: frame.app_name,
    windowTitle: frame.window_title,
    window_title: frame.window_title,
    browserDomain: frame.browser_domain,
    browser_domain: frame.browser_domain,
    snapshotSha256: frame.snapshot_sha256,
    snapshot_sha256: frame.snapshot_sha256,
    contentHash: frame.content_hash,
    content_hash: frame.content_hash,
    textSource: frame.text_source,
    text_source: frame.text_source,
    redactedText: frame.redacted_text,
    redacted_text: frame.redacted_text,
    redactionStatus: frame.redaction_status,
    redaction_status: frame.redaction_status,
    privacyState: frame.privacy_state,
    privacy_state: frame.privacy_state,
    safeForExport: true,
    safe_for_export: true,
  });
}

function exportTranscriptItem({ transcript, audio }) {
  return stripEmpty({
    dataClass: "transcript",
    data_class: "transcript",
    sourceId: transcript.id,
    source_id: transcript.id,
    id: transcript.id,
    audioChunkId: transcript.audio_chunk_id,
    audio_chunk_id: transcript.audio_chunk_id,
    workspaceId: transcript.workspace_id,
    workspace_id: transcript.workspace_id,
    projectId: transcript.project_id,
    project_id: transcript.project_id,
    timestamp: transcript.started_at,
    startedAt: transcript.started_at,
    started_at: transcript.started_at,
    endedAt: transcript.ended_at,
    ended_at: transcript.ended_at,
    speakerLabel: transcript.speaker_label,
    speaker_label: transcript.speaker_label,
    redactedText: transcript.redacted_text,
    redacted_text: transcript.redacted_text,
    redactionStatus: transcript.redaction_status,
    redaction_status: transcript.redaction_status,
    privacyState: transcript.privacy_state,
    privacy_state: transcript.privacy_state,
    transcriptStatus: audio?.transcript_status || "",
    transcript_status: audio?.transcript_status || "",
    safeForSearch: Boolean(Number(transcript.safe_for_search)),
    safe_for_search: Boolean(Number(transcript.safe_for_search)),
    safeForMemory: Boolean(Number(transcript.safe_for_memory)),
    safe_for_memory: Boolean(Number(transcript.safe_for_memory)),
    exportEligible: true,
    export_eligible: true,
  });
}

function exportMemoryItem(row) {
  return {
    dataClass: "memory",
    data_class: "memory",
    sourceId: row.id,
    source_id: row.id,
    timestamp: row.created_at,
    ...memoryDto(row),
  };
}

function exportProductEventItem(row) {
  return stripEmpty({
    dataClass: "product_event",
    data_class: "product_event",
    sourceId: row.id,
    source_id: row.id,
    id: row.id,
    workspaceId: row.workspace_id,
    workspace_id: row.workspace_id,
    projectId: row.project_id,
    project_id: row.project_id,
    timestamp: row.occurred_at,
    eventType: row.event_type,
    event_type: row.event_type,
    occurredAt: row.occurred_at,
    occurred_at: row.occurred_at,
    title: row.title,
    summary: row.summary,
    sourceIds: parseJsonArray(row.source_ids_json),
    source_ids: parseJsonArray(row.source_ids_json),
    safeForSearch: Boolean(Number(row.safe_for_search)),
    safe_for_search: Boolean(Number(row.safe_for_search)),
    safeForMemory: Boolean(Number(row.safe_for_memory)),
    safe_for_memory: Boolean(Number(row.safe_for_memory)),
    safeForExport: true,
    safe_for_export: true,
    verificationStatus: row.verification_status,
    verification_status: row.verification_status,
    proofLedgerEventId: row.proof_ledger_event_id,
    proof_ledger_event_id: row.proof_ledger_event_id,
    confidence: row.confidence,
    createdBy: row.created_by,
    created_by: row.created_by,
    createdAt: row.created_at,
    created_at: row.created_at,
  });
}

function normalizeRequest({ method, url, headers, now }) {
  const parsed = new URL(url || "/", "http://127.0.0.1");
  const normalizedHeaders = normalizeHeaders(headers);
  return {
    method: cleanString(method, 16).toUpperCase() || "GET",
    path: parsed.pathname,
    searchParams: parsed.searchParams,
    headers: normalizedHeaders,
    token: bearerToken(normalizedHeaders.authorization) || normalizedHeaders["x-agentic30-recorder-token"] || "",
    origin: normalizedHeaders.origin || normalizedHeaders["x-agentic30-origin"] || "",
    requestId: normalizedHeaders["x-request-id"] || randomUUID(),
    now,
  };
}

function healthDto(store, audit, now) {
  const memoryItems = store.listRecords("memory_items", { limit: 5000 }).filter((row) => !row.deleted_at).length;
  const productEvents = store.listRecords("product_events", { limit: 5000 }).filter((row) => !row.deleted_at).length;
  return withRawApiBoundary({
    schema: RAW_API_SCHEMA,
    schemaVersion: RECORDER_RAW_API_SERVER_SCHEMA_VERSION,
    schema_version: RECORDER_RAW_API_SERVER_SCHEMA_VERSION,
    generatedAt: toIso(now),
    generated_at: toIso(now),
    status: "ok",
    database: {
      schemaVersion: typeof store.userVersion === "function" ? store.userVersion() : null,
      schema_version: typeof store.userVersion === "function" ? store.userVersion() : null,
    },
    counts: {
      frames: store.listRecords("frames", { limit: 5000 }).filter((row) => !row.deleted_at).length,
      memoryItems,
      memory_items: memoryItems,
      productEvents,
      product_events: productEvents,
    },
  }, audit);
}

function frameDto({ store, frame, includeDebugPaths = false }) {
  const mediaAsset = frame.snapshot_asset_id ? store.getRecord("media_assets", frame.snapshot_asset_id) : null;
  const dto = stripEmpty({
    id: frame.id,
    workspaceId: frame.workspace_id,
    workspace_id: frame.workspace_id,
    projectId: frame.project_id,
    project_id: frame.project_id,
    capturedAt: frame.captured_at,
    captured_at: frame.captured_at,
    monitorId: frame.monitor_id,
    monitor_id: frame.monitor_id,
    captureTrigger: frame.capture_trigger,
    capture_trigger: frame.capture_trigger,
    appName: frame.app_name,
    app_name: frame.app_name,
    windowTitle: frame.window_title,
    window_title: frame.window_title,
    browserDomain: frame.browser_domain,
    browser_domain: frame.browser_domain,
    snapshotSha256: frame.snapshot_sha256,
    snapshot_sha256: frame.snapshot_sha256,
    contentHash: frame.content_hash,
    content_hash: frame.content_hash,
    textSource: frame.text_source,
    text_source: frame.text_source,
    redactedText: frame.redacted_text,
    redacted_text: frame.redacted_text,
    redactionStatus: frame.redaction_status,
    redaction_status: frame.redaction_status,
    privacyState: frame.privacy_state,
    privacy_state: frame.privacy_state,
    dataClass: frame.data_class,
    data_class: frame.data_class,
    safeForSearch: Boolean(Number(frame.safe_for_search)),
    safe_for_search: Boolean(Number(frame.safe_for_search)),
    safeForMemory: Boolean(Number(frame.safe_for_memory)),
    safe_for_memory: Boolean(Number(frame.safe_for_memory)),
    safeForExport: Boolean(Number(frame.safe_for_export)),
    safe_for_export: Boolean(Number(frame.safe_for_export)),
    mediaAssetId: mediaAsset?.id || "",
    media_asset_id: mediaAsset?.id || "",
    mediaByteSize: mediaAsset?.byte_size ?? null,
    media_byte_size: mediaAsset?.byte_size ?? null,
    mediaEncrypted: mediaAsset ? Boolean(Number(mediaAsset.encrypted)) : null,
    media_encrypted: mediaAsset ? Boolean(Number(mediaAsset.encrypted)) : null,
  });
  if (includeDebugPaths && mediaAsset) {
    dto.mediaPath = resolveRecorderFrameMediaPath(store, mediaAsset);
    dto.media_path = dto.mediaPath;
  }
  return dto;
}

function listFrameRows(store, searchParams) {
  const workspaceId = nullableQuery(searchParams, "workspaceId", "workspace_id");
  const projectId = nullableQuery(searchParams, "projectId", "project_id");
  const startedAt = nullableQuery(searchParams, "startedAt", "started_at");
  const endedAt = nullableQuery(searchParams, "endedAt", "ended_at");
  const limit = normalizeLimit(searchParams.get("limit"));
  const startedAtMs = startedAt ? parseTime(startedAt, "startedAt") : null;
  const endedAtMs = endedAt ? parseTime(endedAt, "endedAt") : null;
  if ((startedAtMs === null) !== (endedAtMs === null)) {
    fail("ERR_RECORDER_RAW_API_INCOMPLETE_TIME_RANGE", "frame list time range requires both startedAt and endedAt");
  }
  if (startedAtMs !== null && endedAtMs <= startedAtMs) {
    fail("ERR_RECORDER_RAW_API_INVALID_TIME_RANGE", "frame list endedAt must be after startedAt");
  }
  return store.listRecords("frames", { limit: 5000 })
    .filter((frame) => {
      if (frame.deleted_at) return false;
      if (workspaceId && frame.workspace_id !== workspaceId) return false;
      if (projectId && frame.project_id !== projectId) return false;
      if (startedAtMs !== null) {
        const capturedAt = Date.parse(frame.captured_at);
        if (!Number.isFinite(capturedAt) || capturedAt < startedAtMs || capturedAt >= endedAtMs) return false;
      }
      return true;
    })
    .sort((lhs, rhs) => String(rhs.captured_at || "").localeCompare(String(lhs.captured_at || "")))
    .slice(0, limit);
}

function listAudioRows(store, searchParams) {
  const workspaceId = nullableQuery(searchParams, "workspaceId", "workspace_id");
  const projectId = nullableQuery(searchParams, "projectId", "project_id");
  const startedAt = nullableQuery(searchParams, "startedAt", "started_at");
  const endedAt = nullableQuery(searchParams, "endedAt", "ended_at");
  const limit = normalizeLimit(searchParams.get("limit"));
  const range = normalizeOptionalRange({ startedAt, endedAt, label: "audio list" });
  return store.listRecords("audio_chunks", { limit: 5000 })
    .filter((row) => {
      if (row.deleted_at) return false;
      if (workspaceId && row.workspace_id !== workspaceId) return false;
      if (projectId && row.project_id !== projectId) return false;
      if (range) {
        const started = Date.parse(row.started_at);
        if (!Number.isFinite(started) || started < range.startedAtMs || started >= range.endedAtMs) return false;
      }
      return true;
    })
    .sort((lhs, rhs) => String(rhs.started_at || "").localeCompare(String(lhs.started_at || "")))
    .slice(0, limit);
}

function listTranscriptRows(store, searchParams) {
  const workspaceId = nullableQuery(searchParams, "workspaceId", "workspace_id");
  const projectId = nullableQuery(searchParams, "projectId", "project_id");
  const audioChunkId = nullableQuery(searchParams, "audioChunkId", "audio_chunk_id");
  const startedAt = nullableQuery(searchParams, "startedAt", "started_at");
  const endedAt = nullableQuery(searchParams, "endedAt", "ended_at");
  const limit = normalizeLimit(searchParams.get("limit"));
  const range = normalizeOptionalRange({ startedAt, endedAt, label: "transcript list" });
  return store.listRecords("transcript_segments", { limit: 5000 })
    .filter((row) => {
      if (row.deleted_at) return false;
      if (workspaceId && row.workspace_id !== workspaceId) return false;
      if (projectId && row.project_id !== projectId) return false;
      if (audioChunkId && row.audio_chunk_id !== audioChunkId) return false;
      if (range) {
        const started = Date.parse(row.started_at);
        if (!Number.isFinite(started) || started < range.startedAtMs || started >= range.endedAtMs) return false;
      }
      return true;
    })
    .sort((lhs, rhs) => String(rhs.started_at || "").localeCompare(String(lhs.started_at || "")))
    .slice(0, limit);
}

function listMemoryRows(store, searchParams) {
  const workspaceId = nullableQuery(searchParams, "workspaceId", "workspace_id");
  const projectId = nullableQuery(searchParams, "projectId", "project_id");
  const memoryType = nullableQuery(searchParams, "memoryType", "memory_type");
  const limit = normalizeLimit(searchParams.get("limit"));
  return store.listRecords("memory_items", { limit: 5000 })
    .filter((row) => {
      if (row.deleted_at) return false;
      if (workspaceId && row.workspace_id !== workspaceId) return false;
      if (projectId && row.project_id !== projectId) return false;
      if (memoryType && row.memory_type !== memoryType) return false;
      if (Number(row.safe_for_memory) !== 1) return false;
      return true;
    })
    .sort((lhs, rhs) => String(rhs.created_at || "").localeCompare(String(lhs.created_at || "")))
    .slice(0, limit);
}

function listAuditRows(store, searchParams) {
  const workspaceId = nullableQuery(searchParams, "workspaceId", "workspace_id");
  const projectId = nullableQuery(searchParams, "projectId", "project_id");
  return store.listRecords("recorder_audit", { limit: normalizeLimit(searchParams.get("limit")) })
    .filter((row) => {
      if (workspaceId && row.workspace_id !== workspaceId) return false;
      if (projectId && row.project_id !== projectId) return false;
      return true;
    })
    .sort((lhs, rhs) => String(rhs.created_at || "").localeCompare(String(lhs.created_at || "")))
    .map((row) => ({
      id: row.id,
      requestId: row.request_id,
      request_id: row.request_id,
      actorType: row.actor_type,
      actor_type: row.actor_type,
      actorId: row.actor_id,
      actor_id: row.actor_id,
      workspaceId: row.workspace_id,
      workspace_id: row.workspace_id,
      projectId: row.project_id,
      project_id: row.project_id,
      endpoint: row.endpoint,
      accessLevel: row.access_level,
      access_level: row.access_level,
      sourceIds: parseJsonArray(row.source_ids_json),
      source_ids: parseJsonArray(row.source_ids_json),
      decision: row.decision,
      reason: row.reason,
      createdAt: row.created_at,
      created_at: row.created_at,
    }));
}

function requireFrame(store, frameId) {
  const id = cleanString(frameId, 240);
  const frame = id ? store.getRecord("frames", id) : null;
  if (!frame || frame.deleted_at) {
    fail("ERR_RECORDER_RAW_API_FRAME_NOT_FOUND", `recorder frame not found: ${id || "(missing)"}`);
  }
  return frame;
}

function requireAudioChunk(store, audioId) {
  const id = cleanString(audioId, 240);
  const audio = id ? store.getRecord("audio_chunks", id) : null;
  if (!audio || audio.deleted_at) {
    fail("ERR_RECORDER_RAW_API_AUDIO_NOT_FOUND", `recorder audio chunk not found: ${id || "(missing)"}`);
  }
  return audio;
}

function requireAudioMediaAsset(store, mediaAssetId) {
  const id = cleanString(mediaAssetId, 240);
  const asset = id ? store.getRecord("media_assets", id) : null;
  if (!asset || asset.deleted_at) {
    fail("ERR_RECORDER_RAW_API_AUDIO_MEDIA_NOT_FOUND", `recorder audio media asset not found: ${id || "(missing)"}`);
  }
  if (asset.asset_type !== "audio_m4a") {
    fail("ERR_RECORDER_RAW_API_UNEXPECTED_MEDIA_TYPE", "audio media endpoint requires audio_m4a media", {
      mediaAssetId: asset.id,
      assetType: asset.asset_type,
    });
  }
  return asset;
}

function resolveRecorderAudioMediaPath(store, mediaAsset = {}) {
  if (!store?.dbPath) {
    fail("ERR_RECORDER_RAW_API_STORE_PATH_REQUIRED", "store.dbPath is required to resolve recorder media");
  }
  const relativePath = normalizeAudioMediaRelativePath(mediaAsset.relative_path);
  const recorderRoot = path.dirname(path.resolve(store.dbPath));
  const mediaPath = path.resolve(recorderRoot, ...relativePath.split("/"));
  const relativeToRoot = path.relative(recorderRoot, mediaPath);
  if (relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot)) {
    fail("ERR_RECORDER_RAW_API_MEDIA_PATH_ESCAPE", "audio media path escapes recorder root", {
      relativePath,
      recorderRoot,
      mediaPath,
    });
  }
  return mediaPath;
}

function normalizeAudioMediaRelativePath(value) {
  const raw = String(value ?? "").trim().replace(/\\/g, "/");
  if (!raw) {
    fail("ERR_RECORDER_RAW_API_MEDIA_PATH_REQUIRED", "audio media asset requires a relative_path");
  }
  if (path.posix.isAbsolute(raw) || /^[A-Za-z]:\//.test(raw)) {
    fail("ERR_RECORDER_RAW_API_ABSOLUTE_MEDIA_PATH", "audio media relative_path must not be absolute", {
      relativePath: raw,
    });
  }
  const normalized = path.posix.normalize(raw);
  if (normalized === "." || normalized.startsWith("../") || normalized.includes("/../")) {
    fail("ERR_RECORDER_RAW_API_UNSAFE_MEDIA_PATH", "audio media relative_path must stay under recorder root", {
      relativePath: raw,
    });
  }
  if (!normalized.startsWith("media/audio/")) {
    fail("ERR_RECORDER_RAW_API_UNEXPECTED_MEDIA_PREFIX", "audio media must live under media/audio/", {
      relativePath: raw,
    });
  }
  return normalized;
}

async function readRawMediaFile(mediaPath, mediaAssetId, mediaKind) {
  try {
    return await fs.readFile(mediaPath);
  } catch (error) {
    if (error?.code === "ENOENT") {
      fail("ERR_RECORDER_RAW_API_MEDIA_MISSING", `recorder ${mediaKind} media file is missing`, {
        mediaAssetId,
      });
    }
    fail("ERR_RECORDER_RAW_API_MEDIA_READ_FAILED", `failed to read recorder ${mediaKind} media file`, {
      mediaAssetId,
      cause: error?.message || String(error),
    });
  }
}

function audioDto({ store, audio }) {
  const mediaAsset = audio.audio_asset_id ? store.getRecord("media_assets", audio.audio_asset_id) : null;
  return stripEmpty({
    id: audio.id,
    workspaceId: audio.workspace_id,
    workspace_id: audio.workspace_id,
    projectId: audio.project_id,
    project_id: audio.project_id,
    startedAt: audio.started_at,
    started_at: audio.started_at,
    endedAt: audio.ended_at,
    ended_at: audio.ended_at,
    source: audio.source,
    transcriptStatus: audio.transcript_status,
    transcript_status: audio.transcript_status,
    redactionStatus: audio.redaction_status,
    redaction_status: audio.redaction_status,
    privacyState: audio.privacy_state,
    privacy_state: audio.privacy_state,
    mediaAssetId: mediaAsset?.id || "",
    media_asset_id: mediaAsset?.id || "",
    mediaSha256: mediaAsset?.sha256 || "",
    media_sha256: mediaAsset?.sha256 || "",
    mediaByteSize: mediaAsset?.byte_size ?? null,
    media_byte_size: mediaAsset?.byte_size ?? null,
    mediaEncrypted: mediaAsset ? Boolean(Number(mediaAsset.encrypted)) : null,
    media_encrypted: mediaAsset ? Boolean(Number(mediaAsset.encrypted)) : null,
  });
}

function transcriptDto(row) {
  return stripEmpty({
    id: row.id,
    audioChunkId: row.audio_chunk_id,
    audio_chunk_id: row.audio_chunk_id,
    workspaceId: row.workspace_id,
    workspace_id: row.workspace_id,
    projectId: row.project_id,
    project_id: row.project_id,
    startedAt: row.started_at,
    started_at: row.started_at,
    endedAt: row.ended_at,
    ended_at: row.ended_at,
    speakerLabel: row.speaker_label,
    speaker_label: row.speaker_label,
    redactedText: row.redacted_text,
    redacted_text: row.redacted_text,
    redactionStatus: row.redaction_status,
    redaction_status: row.redaction_status,
    privacyState: row.privacy_state,
    privacy_state: row.privacy_state,
    safeForSearch: Boolean(Number(row.safe_for_search)),
    safe_for_search: Boolean(Number(row.safe_for_search)),
    safeForMemory: Boolean(Number(row.safe_for_memory)),
    safe_for_memory: Boolean(Number(row.safe_for_memory)),
  });
}

function memoryDto(row) {
  return stripEmpty({
    id: row.id,
    workspaceId: row.workspace_id,
    workspace_id: row.workspace_id,
    projectId: row.project_id,
    project_id: row.project_id,
    memoryType: row.memory_type,
    memory_type: row.memory_type,
    title: row.title,
    summary: row.summary,
    sourceIds: parseJsonArray(row.source_ids_json),
    source_ids: parseJsonArray(row.source_ids_json),
    timeRange: parseJsonObject(row.time_range_json),
    time_range: parseJsonObject(row.time_range_json),
    redactionStatus: row.redaction_status,
    redaction_status: row.redaction_status,
    privacyState: row.privacy_state,
    privacy_state: row.privacy_state,
    safeForSearch: Boolean(Number(row.safe_for_search)),
    safe_for_search: Boolean(Number(row.safe_for_search)),
    safeForMemory: Boolean(Number(row.safe_for_memory)),
    safe_for_memory: Boolean(Number(row.safe_for_memory)),
    safeForExport: Boolean(Number(row.safe_for_export)),
    safe_for_export: Boolean(Number(row.safe_for_export)),
    confidence: row.confidence,
    createdBy: row.created_by,
    created_by: row.created_by,
    createdAt: row.created_at,
    created_at: row.created_at,
  });
}

function requireMediaAsset(store, mediaAssetId) {
  const id = cleanString(mediaAssetId, 240);
  const asset = id ? store.getRecord("media_assets", id) : null;
  if (!asset || asset.deleted_at) {
    fail("ERR_RECORDER_RAW_API_MEDIA_NOT_FOUND", `recorder media asset not found: ${id || "(missing)"}`);
  }
  if (asset.asset_type !== "frame_jpeg") {
    fail("ERR_RECORDER_RAW_API_UNEXPECTED_MEDIA_TYPE", "frame image endpoint requires frame_jpeg media", {
      mediaAssetId: asset.id,
      assetType: asset.asset_type,
    });
  }
  return asset;
}

function shouldExposeDebugPaths(request, authorization) {
  return authorization.canExposeFilesystemPaths === true
    && ["1", "true", "yes"].includes(cleanString(request.searchParams.get("includeDebugPaths"), 12).toLowerCase());
}

function withRawApiBoundary(payload, audit) {
  return {
    ...payload,
    rawApi: {
      auditId: audit.id,
      audit_id: audit.id,
      proofAcceptedByRawApi: false,
      proof_accepted_by_raw_api: false,
    },
    raw_api: {
      audit_id: audit.id,
      proof_accepted_by_raw_api: false,
    },
    proofBoundary: {
      ...(payload.proofBoundary || {}),
      proofAcceptedByRawApi: false,
      proof_accepted_by_raw_api: false,
      message: "Recorder raw API responses are local data access, not accepted proof.",
    },
    proof_boundary: {
      ...(payload.proof_boundary || {}),
      proof_accepted_by_raw_api: false,
      message: "Recorder raw API responses are local data access, not accepted proof.",
    },
  };
}

function jsonResponse(status, body) {
  return {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
    body: Buffer.from(`${JSON.stringify(body)}\n`, "utf8"),
  };
}

function errorResponse(error) {
  const status = statusForError(error);
  return jsonResponse(status, {
    schema: RAW_API_SCHEMA,
    schemaVersion: RECORDER_RAW_API_SERVER_SCHEMA_VERSION,
    schema_version: RECORDER_RAW_API_SERVER_SCHEMA_VERSION,
    ok: false,
    error: {
      code: error?.code || "ERR_RECORDER_RAW_API_INTERNAL",
      message: cleanString(error?.message || String(error), 500),
    },
  });
}

function writeHttpResponse(res, response) {
  res.writeHead(response.status, response.headers);
  res.end(response.body);
}

function statusForError(error) {
  const code = error?.code || "";
  if (code.includes("TOKEN_REQUIRED") || code.includes("TOKEN_NOT_FOUND") || code.includes("TOKEN_EXPIRED") || code.includes("TOKEN_REVOKED")) {
    return 401;
  }
  if (code.includes("BODY_TOO_LARGE")) return 413;
  if (code.includes("TIMEOUT")) return 408;
  if (code.includes("PERMISSION_DENIED") || code.includes("ORIGIN_DENIED") || code.includes("RAW_ACCESS_DENIED") || code.includes("GRANT_")) {
    return 403;
  }
  if (code.includes("NOT_FOUND")) return 404;
  if (code.includes("METHOD_NOT_ALLOWED")) return 405;
  return 400;
}

function normalizeLimit(value) {
  const parsed = Number.parseInt(String(value ?? DEFAULT_LIMIT), 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    fail("ERR_RECORDER_RAW_API_INVALID_LIMIT", "raw API limit must be a positive integer");
  }
  return Math.min(MAX_LIMIT, parsed);
}

function normalizeNonNegativeInteger(value, label, code, max) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    fail(code, `raw API ${label} must be zero or a positive integer`);
  }
  return Math.min(parsed, max);
}

function isAllowedPostPath(pathname) {
  return ["/recorder/export", "/recorder/export/archive", "/recorder/sql/query"].includes(pathname)
    || pathname === "/recorder/pipes/scheduler/tick"
    || /^\/recorder\/pipes\/[^/]+\/run$/.test(pathname)
    || /^\/recorder\/pipes\/runs\/[^/]+\/cancel$/.test(pathname);
}

function validateRecorderSqlQuery(sqlRequest, authorization) {
  const query = String(sqlRequest.query ?? "").trim();
  const rawAdminGranted = authorization?.token?.scopes?.includes("raw_admin") === true;
  const includeRawColumns = sqlRequest.includeRawColumns === true;
  if (includeRawColumns && !rawAdminGranted) {
    fail("ERR_RECORDER_RAW_API_SQL_RAW_ADMIN_REQUIRED", "includeRawColumns requires raw_admin in addition to raw_sql");
  }
  if (query.includes("\0")) {
    fail("ERR_RECORDER_RAW_API_SQL_NUL_REJECTED", "recorder SQL query cannot contain NUL bytes");
  }
  if (/--|\/\*|\*\//.test(query)) {
    fail("ERR_RECORDER_RAW_API_SQL_COMMENT_REJECTED", "recorder SQL query cannot contain comments");
  }
  if (query.includes(";")) {
    fail("ERR_RECORDER_RAW_API_SQL_MULTISTATEMENT_REJECTED", "recorder SQL inspector allows one statement only");
  }
  const normalized = query.replace(/\s+/g, " ").trim();
  const lower = normalized.toLowerCase();
  if (!/^(select|with|explain)\b/.test(lower)) {
    fail("ERR_RECORDER_RAW_API_SQL_STATEMENT_REJECTED", "recorder SQL inspector only allows SELECT, WITH, or EXPLAIN statements");
  }
  for (const token of SQL_FORBIDDEN_TOKENS) {
    const pattern = new RegExp(`\\b${token}\\b`, "i");
    if (pattern.test(lower)) {
      fail("ERR_RECORDER_RAW_API_SQL_FORBIDDEN_TOKEN", `recorder SQL query uses forbidden token: ${token}`, { token });
    }
  }
  for (const token of SQL_RAW_COLUMN_TOKENS) {
    const pattern = new RegExp(`\\b${token}\\b`, "i");
    if (pattern.test(lower) && !(includeRawColumns && rawAdminGranted)) {
      fail("ERR_RECORDER_RAW_API_SQL_RAW_COLUMN_REJECTED", `recorder SQL query references forbidden raw column: ${token}`, {
        column: token,
      });
    }
  }
  const sources = extractSqlSources(normalized);
  const cteNames = extractSqlCteNames(normalized);
  const viewSources = [];
  let rawAdminViewUsed = false;
  for (const source of sources) {
    if (cteNames.has(source)) {
      continue;
    }
    if (SQL_FORBIDDEN_SOURCES.has(source)) {
      fail("ERR_RECORDER_RAW_API_SQL_BASE_TABLE_REJECTED", `recorder SQL query cannot read base table: ${source}`, {
        source,
      });
    }
    if (SQL_INSPECTOR_RAW_ADMIN_VIEW_SET.has(source)) {
      if (!includeRawColumns || !rawAdminGranted) {
        fail("ERR_RECORDER_RAW_API_SQL_RAW_ADMIN_REQUIRED", "raw SQL raw-admin views require raw_sql, raw_admin, and includeRawColumns=true", {
          source,
        });
      }
      rawAdminViewUsed = true;
      viewSources.push(source);
      continue;
    }
    if (!SQL_INSPECTOR_VIEW_SET.has(source)) {
      fail("ERR_RECORDER_RAW_API_SQL_SOURCE_REJECTED", `recorder SQL query can read only recorder SQL inspector views: ${source}`, {
        source,
      });
    }
    viewSources.push(source);
  }
  const limit = extractSqlLimit(lower);
  if (limit !== null && limit > MAX_SQL_ROWS) {
    fail("ERR_RECORDER_RAW_API_SQL_LIMIT_TOO_HIGH", "recorder SQL LIMIT exceeds the maximum allowed rows", {
      limit,
      maxLimit: MAX_SQL_ROWS,
    });
  }
  if (requiresSqlLimit(lower) && limit === null) {
    fail("ERR_RECORDER_RAW_API_SQL_LIMIT_REQUIRED", "row-returning recorder SQL queries require LIMIT");
  }
  return {
    normalized,
    sources: viewSources,
    cteNames: [...cteNames],
    limit,
    rowCap: Math.min(limit ?? MAX_SQL_ROWS, MAX_SQL_ROWS),
    startsWithExplain: lower.startsWith("explain"),
    includeRawColumns,
    rawAdminViewUsed,
  };
}

async function executeRecorderSqlQuery({ store, sqlRequest, plan, generatedAt }) {
  const workerResult = await executeRecorderSqlQueryInWorker({
    dbPath: store.dbPath,
    query: sqlRequest.query,
    rowCap: plan.rowCap,
    timeoutMs: sqlRequest.timeoutMs,
  });
  const cappedRows = workerResult.rows;
  return {
    schema: SQL_INSPECTOR_SCHEMA,
    schemaVersion: RECORDER_RAW_API_SERVER_SCHEMA_VERSION,
    schema_version: RECORDER_RAW_API_SERVER_SCHEMA_VERSION,
    generatedAt: toIso(generatedAt),
    generated_at: toIso(generatedAt),
    queryFingerprint: `sha256:${createHash("sha256").update(sqlRequest.query).digest("hex")}`,
    query_fingerprint: `sha256:${createHash("sha256").update(sqlRequest.query).digest("hex")}`,
    allowedViews: plan.sources,
    allowed_views: plan.sources,
    rowCount: cappedRows.length,
    row_count: cappedRows.length,
    truncated: workerResult.truncated === true,
    limit: plan.limit,
    rowCap: plan.rowCap,
    row_cap: plan.rowCap,
    timeoutMs: sqlRequest.timeoutMs,
    timeout_ms: sqlRequest.timeoutMs,
    includeRawColumns: sqlRequest.includeRawColumns === true,
    include_raw_columns: sqlRequest.includeRawColumns === true,
    pathExposed: plan.rawAdminViewUsed === true && plan.includeRawColumns === true,
    path_exposed: plan.rawAdminViewUsed === true && plan.includeRawColumns === true,
    rows: cappedRows.map((row) => sanitizeSqlRow(row, {
      includeRawColumns: plan.includeRawColumns,
    })),
    proofAcceptedByRawSql: false,
    proof_accepted_by_raw_sql: false,
    proofAcceptedByRawApi: false,
    proof_accepted_by_raw_api: false,
    proofLedgerWriteAllowed: false,
    proof_ledger_write_allowed: false,
  };
}

function executeRecorderSqlQueryInWorker({
  dbPath,
  query,
  rowCap,
  timeoutMs,
}) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./recorder-sql-worker.mjs", import.meta.url), {
      workerData: {
        dbPath,
        query,
        rowCap,
      },
    });
    let settled = false;
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback();
    };
    const timer = setTimeout(() => {
      finish(() => {
        worker.terminate().catch(() => {});
        reject(new RecorderRawApiServerError(
          "ERR_RECORDER_RAW_API_SQL_TIMEOUT",
          "recorder SQL query exceeded the configured timeout",
          { timeoutMs },
        ));
      });
    }, timeoutMs);
    worker.once("message", (message) => {
      finish(() => {
        if (message?.ok === true) {
          resolve({
            rows: Array.isArray(message.rows) ? message.rows : [],
            truncated: message.truncated === true,
          });
          return;
        }
        reject(new RecorderRawApiServerError(
          message?.code || "ERR_RECORDER_RAW_API_SQL_EXECUTION_FAILED",
          message?.message || "recorder SQL query execution failed",
        ));
      });
    });
    worker.once("error", (error) => {
      finish(() => {
        reject(new RecorderRawApiServerError(
          "ERR_RECORDER_RAW_API_SQL_EXECUTION_FAILED",
          "recorder SQL query worker failed",
          { cause: cleanString(error?.message || String(error), 300) },
        ));
      });
    });
    worker.once("exit", (code) => {
      if (settled || code === 0) return;
      finish(() => {
        reject(new RecorderRawApiServerError(
          "ERR_RECORDER_RAW_API_SQL_EXECUTION_FAILED",
          "recorder SQL query worker exited unexpectedly",
          { code },
        ));
      });
    });
  });
}

function extractSqlSources(query) {
  const sources = [];
  const seen = new Set();
  const pattern = /\b(?:from|join)\s+([`"[]?)([a-zA-Z_][a-zA-Z0-9_]*)(?:[`"\]]?)/gi;
  for (const match of query.matchAll(pattern)) {
    const source = cleanString(match[2], 120).toLowerCase();
    if (!source || seen.has(source)) continue;
    seen.add(source);
    sources.push(source);
  }
  return sources;
}

function extractSqlCteNames(query) {
  const lower = String(query || "").trim().toLowerCase();
  if (!lower.startsWith("with ")) return new Set();
  const names = new Set();
  const pattern = /(?:\bwith\s+(?:recursive\s+)?|,\s*)([`"[]?)([a-zA-Z_][a-zA-Z0-9_]*)(?:[`"\]]?)(?:\s*\([^)]*\))?\s+as\s*\(/gi;
  for (const match of query.matchAll(pattern)) {
    const name = cleanString(match[2], 120).toLowerCase();
    if (name) names.add(name);
  }
  return names;
}

function extractSqlLimit(lowerQuery) {
  const matches = [...lowerQuery.matchAll(/\blimit\s+(\d+)\b/g)];
  if (!matches.length) return null;
  const parsed = Number.parseInt(matches[matches.length - 1][1], 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    fail("ERR_RECORDER_RAW_API_SQL_LIMIT_INVALID", "recorder SQL LIMIT must be a positive integer");
  }
  return parsed;
}

function requiresSqlLimit(lowerQuery) {
  if (lowerQuery.startsWith("explain")) return false;
  const aggregateWithoutGroup = /\b(count|sum|avg|min|max)\s*\(/.test(lowerQuery)
    && !/\bgroup\s+by\b/.test(lowerQuery);
  return !aggregateWithoutGroup;
}

function normalizeSqlTimeout(value) {
  const parsed = Number.parseInt(String(value ?? DEFAULT_SQL_TIMEOUT_MS), 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    fail("ERR_RECORDER_RAW_API_SQL_TIMEOUT_INVALID", "recorder SQL timeout must be a positive integer");
  }
  if (parsed > MAX_SQL_TIMEOUT_MS) {
    fail("ERR_RECORDER_RAW_API_SQL_TIMEOUT_TOO_LONG", "recorder SQL timeout exceeds the hard cap", {
      timeoutMs: parsed,
      maxTimeoutMs: MAX_SQL_TIMEOUT_MS,
    });
  }
  return parsed;
}

function sanitizeSqlRow(row = {}, { includeRawColumns = false } = {}) {
  const output = {};
  for (const [key, value] of Object.entries(row || {})) {
    const normalizedKey = cleanString(key, 120);
    if (!normalizedKey || shouldDropSqlColumn(normalizedKey, { includeRawColumns })) {
      continue;
    }
    output[normalizedKey] = sanitizeSqlValue(value, { includeRawColumns });
  }
  return output;
}

function shouldDropSqlColumn(key = "", { includeRawColumns = false } = {}) {
  if (/token_hash|raw_api_token|bearer_token|scopes_json|permission_manifest_json|input_manifest_json|output_manifest_json|audit_log_json/i.test(key)) {
    return true;
  }
  if (!includeRawColumns && /relative_path|document_path|browser_url|media_path|clipboard_text|content_text/i.test(key)) {
    return true;
  }
  return false;
}

function sanitizeSqlValue(value, { includeRawColumns = false } = {}) {
  if (value === null || value === undefined) return null;
  if (Buffer.isBuffer(value)) return "[binary-redacted]";
  if (typeof value === "number" || typeof value === "boolean") return value;
  const text = String(value)
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [redacted]");
  return (includeRawColumns ? text : text.replace(/\/Users\/[^"'\s,}]+/g, "[redacted-local-path]"))
    .slice(0, 2000);
}

function recordSqlInspectorDeniedAudit({ store, request, authorization, error }) {
  const token = authorization?.token || {};
  recordRecorderAudit({
    store,
    requestId: request.requestId,
    actorType: token.actorType || token.actor_type || "anonymous",
    actorId: token.clientId || token.client_id || "unknown",
    workspaceId: request.searchParams.get("workspaceId") || request.searchParams.get("workspace_id"),
    projectId: request.searchParams.get("projectId") || request.searchParams.get("project_id"),
    endpoint: request.path,
    accessLevel: "raw_sql",
    sourceIds: [{ id: "recorder_sql_query", source_type: "raw_sql" }],
    decision: "denied",
    reason: error?.code || "ERR_RECORDER_RAW_API_SQL_QUERY_DENIED",
    now: request.now,
  });
}

function normalizeOptionalRange({ startedAt, endedAt, label }) {
  const hasStartedAt = Boolean(startedAt);
  const hasEndedAt = Boolean(endedAt);
  if (!hasStartedAt && !hasEndedAt) return null;
  if (!hasStartedAt || !hasEndedAt) {
    fail("ERR_RECORDER_RAW_API_INCOMPLETE_TIME_RANGE", `${label} time range requires both startedAt and endedAt`);
  }
  const startedAtMs = parseTime(startedAt, "startedAt");
  const endedAtMs = parseTime(endedAt, "endedAt");
  if (endedAtMs <= startedAtMs) {
    fail("ERR_RECORDER_RAW_API_INVALID_TIME_RANGE", `${label} endedAt must be after startedAt`);
  }
  return { startedAtMs, endedAtMs };
}

function parseTime(value, fieldName) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    fail("ERR_RECORDER_RAW_API_INVALID_TIMESTAMP", `raw API requires valid ${fieldName}`);
  }
  return date.getTime();
}

function parseCsv(value) {
  const text = cleanString(value, 500);
  if (!text) return null;
  return text.split(",").map((item) => cleanString(item, 80)).filter(Boolean);
}

function nullableQuery(searchParams, camelKey, snakeKey) {
  return cleanString(searchParams.get(camelKey) || searchParams.get(snakeKey), 240) || null;
}

function bearerToken(value = "") {
  const text = cleanString(value, 1200);
  const match = /^Bearer\s+(.+)$/i.exec(text);
  return match ? match[1].trim() : "";
}

function normalizeHeaders(headers = {}) {
  const output = {};
  for (const [key, value] of Object.entries(headers || {})) {
    output[String(key).toLowerCase()] = Array.isArray(value) ? value.join(", ") : String(value ?? "");
  }
  return output;
}

function assertLoopbackHost(host) {
  if (!["127.0.0.1", "localhost", "::1"].includes(String(host))) {
    fail("ERR_RECORDER_RAW_API_NON_LOOPBACK_HOST", "recorder raw API server must bind only to loopback", { host });
  }
}

function assertStore(store) {
  if (!store || typeof store.getRecord !== "function" || typeof store.listRecords !== "function") {
    fail("ERR_RECORDER_RAW_API_STORE_REQUIRED", "recorder raw API server requires a RecorderStore-like store");
  }
}

function stripEmpty(object) {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== "" && value !== null && value !== undefined));
}

function parseJsonArray(value) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseJsonObject(value) {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function cleanString(value = "", maxLength = 500) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function toIso(value) {
  const date = value instanceof Date ? value : new Date(value ?? Date.now());
  if (Number.isNaN(date.getTime())) {
    fail("ERR_RECORDER_RAW_API_INVALID_TIMESTAMP", "raw API received an invalid timestamp");
  }
  return date.toISOString();
}

function fail(code, message, details = {}) {
  throw new RecorderRawApiServerError(code, message, details);
}
