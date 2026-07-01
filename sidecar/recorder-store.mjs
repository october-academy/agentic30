import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import Database from "better-sqlite3";

import { assertRecorderRedactionPolicyForRecord } from "./recorder-redaction-policy.mjs";

export const RECORDER_STORE_SCHEMA_VERSION = 12;

export const RECORDER_BASE_TABLES = Object.freeze([
  "frames",
  "media_assets",
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
]);

export const RECORDER_FTS_TABLES = Object.freeze([
  "frames_text_fts",
  "transcript_text_fts",
  "memory_items_fts",
  "product_events_fts",
]);

const RECORDER_SQL_INSPECTOR_VIEW_NAMES = Object.freeze([
  "recorder_sql_frames_redacted",
  "recorder_sql_transcripts_redacted",
  "recorder_sql_clipboard_redacted",
  "recorder_sql_frames_raw_admin",
  "recorder_sql_transcripts_raw_admin",
  "recorder_sql_clipboard_raw_admin",
  "recorder_sql_memory_items",
  "recorder_sql_product_events",
  "recorder_sql_storage_stats",
  "recorder_sql_capture_health",
  "recorder_sql_audit_sanitized",
]);

const BASE_TABLE_SET = new Set(RECORDER_BASE_TABLES);

const TABLE_COLUMNS = Object.freeze({
  frames: [
    "id", "schema_version", "workspace_id", "project_id", "captured_at", "monitor_id",
    "capture_trigger", "app_name", "window_title", "browser_url", "browser_domain",
    "browser_url_normalized", "browser_url_search_label", "document_path", "document_path_search_label",
    "snapshot_asset_id", "snapshot_sha256", "content_hash", "simhash", "text_source", "accessibility_text",
    "ocr_text", "text_provenance_root_cause", "redacted_text", "redaction_status", "privacy_state",
    "data_class", "safe_for_search", "safe_for_memory", "safe_for_export", "created_at", "deleted_at",
  ],
  media_assets: [
    "id", "asset_type", "relative_path", "sha256", "byte_size", "encrypted", "workspace_id",
    "project_id", "encryption_key_id", "encryption_alg", "encryption_nonce", "encryption_tag",
    "source_ids_json", "created_at", "deleted_at",
  ],
  audio_chunks: [
    "id", "workspace_id", "project_id", "started_at", "ended_at", "source", "audio_asset_id",
    "transcript_status", "consent_grant_id", "visible_notice_id", "raw_audio_indicator_state",
    "local_transcriber_name", "local_transcriber_version", "transcription_terminal_state",
    "redaction_status", "privacy_state", "created_at", "deleted_at",
  ],
  transcript_segments: [
    "id", "audio_chunk_id", "workspace_id", "project_id", "started_at", "ended_at",
    "speaker_label", "transcript_status", "speaker_label_provenance", "text", "redacted_text",
    "redaction_status", "privacy_state", "safe_for_search", "safe_for_memory",
    "deletion_source_id", "created_at", "deleted_at",
  ],
  clipboard_events: [
    "id", "workspace_id", "project_id", "captured_at", "event_kind", "policy_mode",
    "source_app_name", "source_window_title", "content_type", "content_size",
    "content_hash", "content_text", "redacted_text", "redaction_status",
    "privacy_state", "suppression_reason", "raw_retention_expires_at",
    "safe_for_search", "safe_for_memory", "safe_for_export", "content_captured",
    "created_at", "deleted_at",
  ],
  memory_items: [
    "id", "workspace_id", "project_id", "memory_type", "title", "summary", "source_ids_json",
    "time_range_json", "redaction_status", "privacy_state", "safe_for_search",
    "safe_for_memory", "safe_for_export", "confidence", "created_by", "created_at",
    "deleted_at",
  ],
  product_events: [
    "id", "workspace_id", "project_id", "event_type", "occurred_at", "title", "summary",
    "source_ids_json", "safe_for_search", "safe_for_memory", "safe_for_export",
    "verification_status", "proof_ledger_event_id", "confidence", "created_by",
    "created_at", "deleted_at",
  ],
  evidence_candidates: [
    "id", "workspace_id", "project_id", "candidate_status", "source_state", "claim",
    "proof_kind", "source_ids_json", "proof_ledger_mapping_json", "evidence_debt_json",
    "immutable_fingerprint", "idempotency_key", "verifier_result_json",
    "proof_ledger_event_id", "created_by", "created_at", "reviewed_at", "deleted_at",
  ],
  recorder_audit: [
    "id", "request_id", "actor_type", "actor_id", "workspace_id", "project_id", "endpoint",
    "access_level", "source_ids_json", "decision", "reason", "created_at", "deleted_at",
  ],
  api_tokens: [
    "id", "token_hash", "client_id", "client_name", "actor_type", "scopes_json",
    "issued_by", "issued_at", "expires_at", "revoked_at", "last_used_at",
  ],
  pipe_definitions: [
    "id", "workspace_id", "project_id", "path", "name", "schedule", "enabled",
    "pipe_kind", "permission_manifest_json", "created_at", "updated_at",
  ],
  pipe_runs: [
    "id", "pipe_id", "workspace_id", "project_id", "trigger_reason", "status", "started_at",
    "ended_at", "input_manifest_json", "output_manifest_json", "audit_log_json",
    "error_message", "deleted_at",
  ],
});

export class RecorderStoreError extends Error {
  constructor(code, message, details = {}) {
    super(`${code}: ${message}`);
    this.name = "RecorderStoreError";
    this.code = code;
    this.details = details;
  }
}

export class RecorderStore {
  constructor({
    dbPath = null,
    appSupportRoot = null,
    databaseFactory = (filename) => new Database(filename),
  } = {}) {
    this.dbPath = dbPath
      ? path.resolve(dbPath)
      : resolveRecorderDbPath({ appSupportRoot });
    this.databaseFactory = databaseFactory;
    this.db = null;
  }

  static resolveDbPath(options = {}) {
    return resolveRecorderDbPath(options);
  }

  open() {
    if (this.db) return this;
    ensureRecorderDirectory(path.dirname(this.dbPath));
    this.db = this.databaseFactory(this.dbPath);
    this.db.pragma("foreign_keys = ON");
    this.db.pragma("journal_mode = WAL");
    migrateRecorderDatabase(this.db);
    ensureRecorderSqlInspectorViews(this.db);
    return this;
  }

  close() {
    if (!this.db) return;
    this.db.close();
    this.db = null;
  }

  userVersion() {
    return this.database().pragma("user_version", { simple: true });
  }

  runMaintenance({ checkpointMode = "TRUNCATE", vacuum = false } = {}) {
    const db = this.database();
    const mode = normalizeCheckpointMode(checkpointMode);
    let checkpointRows;
    try {
      checkpointRows = db.pragma(`wal_checkpoint(${mode})`);
    } catch (error) {
      fail("ERR_RECORDER_STORE_WAL_CHECKPOINT_FAILED", "recorder.sqlite WAL checkpoint failed", {
        checkpointMode: mode,
        cause: error?.message || String(error),
      });
    }
    if (vacuum) {
      try {
        db.exec("VACUUM;");
      } catch (error) {
        fail("ERR_RECORDER_STORE_VACUUM_FAILED", "recorder.sqlite VACUUM failed", {
          cause: error?.message || String(error),
        });
      }
    }
    const walCheckpoint = {
      mode,
      rows: Array.isArray(checkpointRows) ? checkpointRows : [],
    };
    return {
      status: "ok",
      walCheckpoint,
      wal_checkpoint: walCheckpoint,
      vacuumRun: Boolean(vacuum),
      vacuum_run: Boolean(vacuum),
    };
  }

  baseTables() {
    return this.database()
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (SELECT value FROM json_each(?)) ORDER BY name")
      .all(JSON.stringify(RECORDER_BASE_TABLES))
      .map((row) => row.name);
  }

  ftsTables() {
    return this.database()
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (SELECT value FROM json_each(?)) ORDER BY name")
      .all(JSON.stringify(RECORDER_FTS_TABLES))
      .map((row) => row.name);
  }

  insertRecord(table, record = {}) {
    const db = this.database();
    const tableName = assertBaseTable(table);
    const allowedColumns = new Set(TABLE_COLUMNS[tableName]);
    const normalizedRecord = normalizeRecordForTable(tableName, record);
    const entries = Object.entries(normalizedRecord)
      .filter(([column]) => allowedColumns.has(column));
    if (!entries.length) {
      fail("ERR_RECORDER_STORE_EMPTY_INSERT", `insertRecord(${tableName}) requires at least one valid column`);
    }
    const columns = entries.map(([column]) => column);
    const placeholders = columns.map((column) => `@${column}`);
    const values = Object.fromEntries(entries);
    db.prepare(
      `INSERT INTO ${tableName} (${columns.join(", ")}) VALUES (${placeholders.join(", ")})`,
    ).run(values);
    return normalizedRecord;
  }

  withTransaction(callback) {
    if (typeof callback !== "function") {
      fail("ERR_RECORDER_STORE_INVALID_TRANSACTION", "withTransaction requires callback");
    }
    return this.database().transaction(() => callback())();
  }

  getRecord(table, id) {
    const tableName = assertBaseTable(table);
    const cleanId = cleanString(id, 240);
    if (!cleanId) fail("ERR_RECORDER_STORE_MISSING_ID", `getRecord(${tableName}) requires id`);
    return this.database().prepare(`SELECT * FROM ${tableName} WHERE id = ?`).get(cleanId) || null;
  }

  listRecords(table, { limit = 1000, offset = 0, orderBy = "id", direction = "ASC" } = {}) {
    const tableName = assertBaseTable(table);
    const max = Math.max(1, Math.min(50000, Number.parseInt(String(limit), 10) || 1000));
    const start = Math.max(0, Number.parseInt(String(offset), 10) || 0);
    const orderColumn = TABLE_COLUMNS[tableName].includes(orderBy) ? orderBy : "id";
    const sortDirection = String(direction).toUpperCase() === "DESC" ? "DESC" : "ASC";
    return this.database()
      .prepare(`SELECT * FROM ${tableName} ORDER BY ${orderColumn} ${sortDirection}, id ASC LIMIT ? OFFSET ?`)
      .all(max, start);
  }

  updateRecord(table, id, patch = {}) {
    const db = this.database();
    const tableName = assertBaseTable(table);
    const cleanId = cleanString(id, 240);
    if (!cleanId) fail("ERR_RECORDER_STORE_MISSING_ID", `updateRecord(${tableName}) requires id`);
    const allowedColumns = new Set(TABLE_COLUMNS[tableName].filter((column) => column !== "id"));
    const currentRecord = db.prepare(`SELECT * FROM ${tableName} WHERE id = ?`).get(cleanId) || null;
    const normalizedPatch = normalizeRecordForTable(tableName, patch, currentRecord);
    const entries = Object.entries(normalizedPatch)
      .filter(([column]) => allowedColumns.has(column));
    if (!entries.length) {
      fail("ERR_RECORDER_STORE_EMPTY_UPDATE", `updateRecord(${tableName}) requires at least one valid column`);
    }
    const assignments = entries.map(([column]) => `${column} = @${column}`);
    const values = { id: cleanId, ...Object.fromEntries(entries) };
    const result = db.prepare(
      `UPDATE ${tableName} SET ${assignments.join(", ")} WHERE id = @id`,
    ).run(values);
    return result.changes;
  }

  softDeleteRecord(table, id, { deletedAt = new Date().toISOString() } = {}) {
    return this.updateRecord(table, id, { deleted_at: toIso(deletedAt) });
  }

  search(query, { limit = 20, sourceTypes = ["frame", "transcript", "memory", "product_event"] } = {}) {
    const text = cleanString(query, 400);
    if (!text) return [];
    const max = Math.max(1, Math.min(100, Number.parseInt(String(limit), 10) || 20));
    const enabled = new Set(sourceTypes);
    const results = [];
    if (enabled.has("frame")) {
      results.push(...this.searchFrames(text, max));
    }
    if (enabled.has("transcript")) {
      results.push(...this.searchTranscripts(text, max));
    }
    if (enabled.has("memory")) {
      results.push(...this.searchMemoryItems(text, max));
    }
    if (enabled.has("product_event")) {
      results.push(...this.searchProductEvents(text, max));
    }
    return results
      .sort((lhs, rhs) => String(rhs.timestamp || "").localeCompare(String(lhs.timestamp || "")))
      .slice(0, max);
  }

  searchFrames(query, limit = 20) {
    const ftsQuery = toFtsQuery(query);
    return this.database().prepare(`
      SELECT
        'frame' AS source_type,
        frames.id AS source_id,
        frames.captured_at AS timestamp,
        frames.app_name,
        frames.window_title,
        frames.browser_domain,
        frames.browser_url_search_label,
        frames.document_path_search_label,
        snippet(frames_text_fts, 1, '[', ']', '...', 12) AS snippet
      FROM frames_text_fts
      JOIN frames ON frames.id = frames_text_fts.frame_id
      WHERE frames_text_fts MATCH ?
        AND frames.safe_for_search = 1
        AND frames.deleted_at IS NULL
      ORDER BY frames.captured_at DESC
      LIMIT ?
    `).all(ftsQuery, limit);
  }

  searchTranscripts(query, limit = 20) {
    const ftsQuery = toFtsQuery(query);
    return this.database().prepare(`
      SELECT
        'transcript' AS source_type,
        transcript_segments.id AS source_id,
        transcript_segments.started_at AS timestamp,
        transcript_segments.speaker_label,
        snippet(transcript_text_fts, 1, '[', ']', '...', 12) AS snippet
      FROM transcript_text_fts
      JOIN transcript_segments ON transcript_segments.id = transcript_text_fts.segment_id
      WHERE transcript_text_fts MATCH ?
        AND transcript_segments.safe_for_search = 1
        AND transcript_segments.deleted_at IS NULL
      ORDER BY transcript_segments.started_at DESC
      LIMIT ?
    `).all(ftsQuery, limit);
  }

  searchMemoryItems(query, limit = 20) {
    const ftsQuery = toFtsQuery(query);
    return this.database().prepare(`
      SELECT
        'memory' AS source_type,
        memory_items.id AS source_id,
        memory_items.created_at AS timestamp,
        memory_items.title,
        snippet(memory_items_fts, 1, '[', ']', '...', 12) AS snippet
      FROM memory_items_fts
      JOIN memory_items ON memory_items.id = memory_items_fts.memory_id
      WHERE memory_items_fts MATCH ?
        AND memory_items.safe_for_search = 1
        AND memory_items.deleted_at IS NULL
      ORDER BY memory_items.created_at DESC
      LIMIT ?
    `).all(ftsQuery, limit);
  }

  searchProductEvents(query, limit = 20) {
    const ftsQuery = toFtsQuery(query);
    return this.database().prepare(`
      SELECT
        'product_event' AS source_type,
        product_events.id AS source_id,
        product_events.occurred_at AS timestamp,
        product_events.event_type,
        product_events.title,
        snippet(product_events_fts, 1, '[', ']', '...', 12) AS snippet
      FROM product_events_fts
      JOIN product_events ON product_events.id = product_events_fts.product_event_id
      WHERE product_events_fts MATCH ?
        AND product_events.safe_for_search = 1
        AND product_events.deleted_at IS NULL
      ORDER BY product_events.occurred_at DESC
      LIMIT ?
    `).all(ftsQuery, limit);
  }

  database() {
    if (!this.db) this.open();
    return this.db;
  }
}

export function resolveRecorderDbPath({ appSupportRoot = null, env = process.env, homeDir = os.homedir() } = {}) {
  const base = appSupportRoot
    || cleanString(env.AGENTIC30_APP_SUPPORT_PATH, 1000)
    || path.join(homeDir, "Library", "Application Support", "agentic30");
  return path.join(path.resolve(base), "recorder", "recorder.sqlite");
}

export function migrateRecorderDatabase(db) {
  if (!db || typeof db.exec !== "function") {
    fail("ERR_RECORDER_STORE_INVALID_DB", "migrateRecorderDatabase requires a better-sqlite3 database");
  }
  const currentVersion = db.pragma("user_version", { simple: true });
  if (currentVersion > RECORDER_STORE_SCHEMA_VERSION) {
    fail(
      "ERR_RECORDER_STORE_UNSUPPORTED_SCHEMA",
      `recorder.sqlite schema version ${currentVersion} is newer than supported ${RECORDER_STORE_SCHEMA_VERSION}`,
      { currentVersion, supportedVersion: RECORDER_STORE_SCHEMA_VERSION },
    );
  }
  if (currentVersion < 1) {
    db.transaction(() => {
      db.exec(RECORDER_SCHEMA_SQL);
      db.pragma(`user_version = ${RECORDER_STORE_SCHEMA_VERSION}`);
    })();
  } else {
    db.transaction(() => {
      if (currentVersion < 2) {
        db.exec(RECORDER_SCHEMA_V2_SQL);
      }
      if (currentVersion < 3) {
        ensureMediaAssetEncryptionColumns(db);
      }
      if (currentVersion < 4) {
        ensureAudioProvenanceColumns(db);
      }
      if (currentVersion < 5) {
        ensurePipeRunDeletedAtColumn(db);
      }
      if (currentVersion < 6) {
        ensureAuditDeletedAtColumn(db);
      }
      if (currentVersion < 7) {
        ensureFrameBrowserUrlSearchLabelColumn(db);
        rebuildFramesFtsSchema(db);
      }
      if (currentVersion < 8) {
        ensureClipboardEnvelopeSchema(db);
      }
      if (currentVersion < 9) {
        ensureMediaAssetSourceIdsColumn(db);
      }
      if (currentVersion < 10) {
        if (recorderTableExists(db, "frames")) {
          sanitizeExistingFrameBrowserUrlSearchLabels(db);
          rebuildFramesFtsSchema(db);
        }
      }
      if (currentVersion < 11) {
        ensureFrameTextProvenanceRootCauseColumn(db);
        normalizeExistingFrameTextProvenance(db);
      }
      if (currentVersion < 12) {
        ensureFrameDocumentPathSearchLabelColumn(db);
        sanitizeExistingFrameMetadataSearchLabels(db);
        if (recorderTableExists(db, "frames")) {
          rebuildFramesFtsSchema(db);
        }
      }
      db.pragma(`user_version = ${RECORDER_STORE_SCHEMA_VERSION}`);
    })();
  }
  return db.pragma("user_version", { simple: true });
}

function ensureMediaAssetEncryptionColumns(db) {
  const existingColumns = new Set(db.pragma("table_info(media_assets)").map((column) => column.name));
  const columns = [
    ["encryption_key_id", "TEXT"],
    ["encryption_alg", "TEXT"],
    ["encryption_nonce", "TEXT"],
    ["encryption_tag", "TEXT"],
  ];
  for (const [column, definition] of columns) {
    if (!existingColumns.has(column)) {
      db.exec(`ALTER TABLE media_assets ADD COLUMN ${column} ${definition};`);
    }
  }
}

function ensureAudioProvenanceColumns(db) {
  const audioColumns = new Set(db.pragma("table_info(audio_chunks)").map((column) => column.name));
  const audioColumnDefinitions = [
    ["consent_grant_id", "TEXT"],
    ["visible_notice_id", "TEXT"],
    ["raw_audio_indicator_state", "TEXT NOT NULL DEFAULT 'unknown'"],
    ["local_transcriber_name", "TEXT"],
    ["local_transcriber_version", "TEXT"],
    ["transcription_terminal_state", "TEXT"],
  ];
  for (const [column, definition] of audioColumnDefinitions) {
    if (!audioColumns.has(column)) {
      db.exec(`ALTER TABLE audio_chunks ADD COLUMN ${column} ${definition};`);
    }
  }

  const transcriptColumns = new Set(db.pragma("table_info(transcript_segments)").map((column) => column.name));
  const transcriptColumnDefinitions = [
    ["transcript_status", "TEXT NOT NULL DEFAULT 'local_complete'"],
    ["speaker_label_provenance", "TEXT"],
    ["deletion_source_id", "TEXT"],
  ];
  for (const [column, definition] of transcriptColumnDefinitions) {
    if (!transcriptColumns.has(column)) {
      db.exec(`ALTER TABLE transcript_segments ADD COLUMN ${column} ${definition};`);
    }
  }
}

function ensureMediaAssetSourceIdsColumn(db) {
  if (!recorderTableExists(db, "media_assets")) return;
  const mediaColumns = new Set(db.pragma("table_info(media_assets)").map((column) => column.name));
  if (!mediaColumns.has("source_ids_json")) {
    db.exec("ALTER TABLE media_assets ADD COLUMN source_ids_json TEXT;");
  }
}

function sanitizeExistingFrameBrowserUrlSearchLabels(db) {
  sanitizeExistingFrameMetadataSearchLabels(db);
}

function sanitizeExistingFrameMetadataSearchLabels(db) {
  if (!recorderTableExists(db, "frames")) return;
  const frameColumns = new Set(db.pragma("table_info(frames)").map((column) => column.name));
  if (!frameColumns.has("browser_url_search_label")) return;
  const hasDocumentLabel = frameColumns.has("document_path_search_label");
  const rows = db.prepare(`
    SELECT
      id,
      browser_url,
      browser_domain,
      browser_url_search_label,
      document_path,
      ${hasDocumentLabel ? "document_path_search_label" : "NULL AS document_path_search_label"}
    FROM frames
  `).all();
  const update = hasDocumentLabel
    ? db.prepare("UPDATE frames SET browser_domain = @browser_domain, browser_url_search_label = @browser_url_search_label, document_path_search_label = @document_path_search_label WHERE id = @id")
    : db.prepare("UPDATE frames SET browser_domain = @browser_domain, browser_url_search_label = @browser_url_search_label WHERE id = @id");
  for (const row of rows) {
    const sanitizedDomain = sanitizeFrameBrowserDomain(row.browser_domain) || domainFromUrl(row.browser_url);
    const sanitized = sanitizeFrameBrowserUrlSearchLabel(row.browser_url_search_label, {
      browserUrl: row.browser_url,
      browserDomain: sanitizedDomain,
    });
    const documentLabel = hasDocumentLabel
      ? sanitizeFrameDocumentPathSearchLabel(row.document_path_search_label, { documentPath: row.document_path })
      : null;
    if (
      (sanitizedDomain || null) !== (row.browser_domain || null)
      || (sanitized || null) !== (row.browser_url_search_label || null)
      || (hasDocumentLabel && (documentLabel || null) !== (row.document_path_search_label || null))
    ) {
      update.run({
        id: row.id,
        browser_domain: sanitizedDomain,
        browser_url_search_label: sanitized,
        document_path_search_label: documentLabel,
      });
    }
  }
}

function recorderTableExists(db, tableName) {
  return Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(tableName));
}

function ensurePipeRunDeletedAtColumn(db) {
  const pipeRunColumns = new Set(db.pragma("table_info(pipe_runs)").map((column) => column.name));
  if (!pipeRunColumns.has("deleted_at")) {
    db.exec("ALTER TABLE pipe_runs ADD COLUMN deleted_at TEXT;");
  }
}

function ensureAuditDeletedAtColumn(db) {
  const auditColumns = new Set(db.pragma("table_info(recorder_audit)").map((column) => column.name));
  if (!auditColumns.has("deleted_at")) {
    db.exec("ALTER TABLE recorder_audit ADD COLUMN deleted_at TEXT;");
  }
}

function ensureFrameBrowserUrlSearchLabelColumn(db) {
  const frameColumns = new Set(db.pragma("table_info(frames)").map((column) => column.name));
  if (!frameColumns.has("browser_url_search_label")) {
    db.exec("ALTER TABLE frames ADD COLUMN browser_url_search_label TEXT;");
  }
}

function ensureFrameDocumentPathSearchLabelColumn(db) {
  if (!recorderTableExists(db, "frames")) return;
  const frameColumns = new Set(db.pragma("table_info(frames)").map((column) => column.name));
  if (!frameColumns.has("document_path_search_label")) {
    db.exec("ALTER TABLE frames ADD COLUMN document_path_search_label TEXT;");
  }
}

function ensureFrameTextProvenanceRootCauseColumn(db) {
  if (!recorderTableExists(db, "frames")) return;
  const frameColumns = new Set(db.pragma("table_info(frames)").map((column) => column.name));
  if (!frameColumns.has("text_provenance_root_cause")) {
    db.exec("ALTER TABLE frames ADD COLUMN text_provenance_root_cause TEXT;");
  }
}

function normalizeExistingFrameTextProvenance(db) {
  if (!recorderTableExists(db, "frames")) return;
  const frameColumns = new Set(db.pragma("table_info(frames)").map((column) => column.name));
  if (!frameColumns.has("text_source") || !frameColumns.has("text_provenance_root_cause")) return;
  const rows = db.prepare("SELECT id, text_source, accessibility_text, ocr_text, text_provenance_root_cause FROM frames").all();
  const update = db.prepare("UPDATE frames SET text_source = @text_source, text_provenance_root_cause = @text_provenance_root_cause WHERE id = @id");
  for (const row of rows) {
    const normalized = normalizeFrameTextProvenanceRow(row);
    if (normalized.text_source !== row.text_source || normalized.text_provenance_root_cause !== (row.text_provenance_root_cause || null)) {
      update.run({ id: row.id, ...normalized });
    }
  }
}

function ensureClipboardEnvelopeSchema(db) {
  const table = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'clipboard_events'").get();
  if (!table) {
    db.exec(RECORDER_SCHEMA_V2_SQL);
    return;
  }

  const columns = new Set(db.pragma("table_info(clipboard_events)").map((column) => column.name));
  const requiredColumns = [
    "captured_at",
    "policy_mode",
    "source_app_name",
    "source_window_title",
    "content_size",
    "suppression_reason",
    "raw_retention_expires_at",
  ];
  const legacyColumns = ["occurred_at", "capture_mode", "app_name", "window_title"];
  const hasRequiredColumns = requiredColumns.every((column) => columns.has(column));
  const hasLegacyColumns = legacyColumns.some((column) => columns.has(column));
  if (hasRequiredColumns && !hasLegacyColumns) {
    ensureClipboardIndexes(db);
    return;
  }

  dropSqlInspectorViews(db);
  db.exec(`
DROP INDEX IF EXISTS idx_clipboard_events_occurred_at;
DROP INDEX IF EXISTS idx_clipboard_events_workspace_project_time;
DROP INDEX IF EXISTS idx_clipboard_events_captured_at;
DROP INDEX IF EXISTS idx_clipboard_events_workspace_project_captured_at;
ALTER TABLE clipboard_events RENAME TO clipboard_events_legacy_v8;
`);
  db.exec(RECORDER_SCHEMA_V2_SQL);

  const columnExpr = (name, fallback = "NULL") => columns.has(name) ? name : fallback;
  const capturedAtExpr = columnExpr("captured_at", columnExpr("occurred_at", columnExpr("created_at", "CURRENT_TIMESTAMP")));
  const policyModeExpr = columnExpr("policy_mode", columnExpr("capture_mode", "'trigger_only'"));
  const sourceAppExpr = columnExpr("source_app_name", columnExpr("app_name"));
  const sourceWindowExpr = columnExpr("source_window_title", columnExpr("window_title"));
  const contentTextExpr = columnExpr("content_text");
  const contentSizeExpr = columnExpr(
    "content_size",
    contentTextExpr === "NULL" ? "NULL" : `length(${contentTextExpr})`,
  );
  const contentCapturedExpr = columnExpr(
    "content_captured",
    contentTextExpr === "NULL" ? "0" : `CASE WHEN ${contentTextExpr} IS NOT NULL THEN 1 ELSE 0 END`,
  );

  db.exec(`
INSERT INTO clipboard_events (
  id,
  workspace_id,
  project_id,
  captured_at,
  event_kind,
  policy_mode,
  source_app_name,
  source_window_title,
  content_type,
  content_size,
  content_hash,
  content_text,
  redacted_text,
  redaction_status,
  privacy_state,
  suppression_reason,
  raw_retention_expires_at,
  safe_for_search,
  safe_for_memory,
  safe_for_export,
  content_captured,
  created_at,
  deleted_at
)
SELECT
  id,
  ${columnExpr("workspace_id")},
  ${columnExpr("project_id")},
  ${capturedAtExpr},
  coalesce(${columnExpr("event_kind")}, 'unknown'),
  CASE
    WHEN ${policyModeExpr} IN ('trigger_only', 'content_opt_in', 'blocked') THEN ${policyModeExpr}
    ELSE 'trigger_only'
  END,
  ${sourceAppExpr},
  ${sourceWindowExpr},
  coalesce(${columnExpr("content_type")}, 'unknown'),
  ${contentSizeExpr},
  ${columnExpr("content_hash")},
  ${contentTextExpr},
  ${columnExpr("redacted_text")},
  coalesce(${columnExpr("redaction_status")}, 'none'),
  coalesce(${columnExpr("privacy_state")}, 'raw_local'),
  ${columnExpr("suppression_reason")},
  ${columnExpr("raw_retention_expires_at")},
  coalesce(${columnExpr("safe_for_search")}, 0),
  coalesce(${columnExpr("safe_for_memory")}, 0),
  coalesce(${columnExpr("safe_for_export")}, 0),
  coalesce(${contentCapturedExpr}, 0),
  coalesce(${columnExpr("created_at")}, ${capturedAtExpr}),
  ${columnExpr("deleted_at")}
FROM clipboard_events_legacy_v8;
DROP TABLE clipboard_events_legacy_v8;
`);
}

function ensureClipboardIndexes(db) {
  db.exec(`
CREATE INDEX IF NOT EXISTS idx_clipboard_events_captured_at ON clipboard_events(captured_at);
CREATE INDEX IF NOT EXISTS idx_clipboard_events_workspace_project_captured_at ON clipboard_events(workspace_id, project_id, captured_at);
`);
}

function rebuildFramesFtsSchema(db) {
  // The FTS backfill + AI/AU triggers below reference
  // frames.browser_url_search_label and frames.document_path_search_label. This
  // function is invoked from three migration steps (currentVersion < 7, < 10,
  // and < 12), but the document_path_search_label column is only formally added
  // by the < 12 step. A recorder.sqlite opened at user_version 2-9 therefore hit
  // "no such column: document_path_search_label" here, rolled back the entire
  // migration transaction, and — because the sidecar bootstrap process.exits on
  // a RecorderStore.open() failure — crashed the WHOLE sidecar (chat, office
  // hours, everything) on every launch. Ensure both label columns exist first
  // (each is an idempotent no-op when already present) so the rebuild is
  // self-consistent regardless of the caller's on-disk schema version.
  ensureFrameBrowserUrlSearchLabelColumn(db);
  ensureFrameDocumentPathSearchLabelColumn(db);
  db.exec(`
DROP TRIGGER IF EXISTS frames_text_fts_ai;
DROP TRIGGER IF EXISTS frames_text_fts_au;
DROP TRIGGER IF EXISTS frames_text_fts_ad;
DROP TABLE IF EXISTS frames_text_fts;

CREATE VIRTUAL TABLE IF NOT EXISTS frames_text_fts USING fts5(
  frame_id UNINDEXED,
  redacted_text,
  app_name,
  window_title,
  browser_domain,
  browser_url_search_label,
  document_path_search_label
);

CREATE TRIGGER IF NOT EXISTS frames_text_fts_ai AFTER INSERT ON frames
WHEN new.safe_for_search = 1 AND new.deleted_at IS NULL
BEGIN
  INSERT INTO frames_text_fts(frame_id, redacted_text, app_name, window_title, browser_domain, browser_url_search_label, document_path_search_label)
  VALUES (new.id, coalesce(new.redacted_text, ''), coalesce(new.app_name, ''), coalesce(new.window_title, ''), coalesce(new.browser_domain, ''), coalesce(new.browser_url_search_label, ''), coalesce(new.document_path_search_label, ''));
END;

CREATE TRIGGER IF NOT EXISTS frames_text_fts_au AFTER UPDATE ON frames
BEGIN
  DELETE FROM frames_text_fts WHERE frame_id = old.id;
  INSERT INTO frames_text_fts(frame_id, redacted_text, app_name, window_title, browser_domain, browser_url_search_label, document_path_search_label)
  SELECT new.id, coalesce(new.redacted_text, ''), coalesce(new.app_name, ''), coalesce(new.window_title, ''), coalesce(new.browser_domain, ''), coalesce(new.browser_url_search_label, ''), coalesce(new.document_path_search_label, '')
  WHERE new.safe_for_search = 1 AND new.deleted_at IS NULL;
END;

CREATE TRIGGER IF NOT EXISTS frames_text_fts_ad AFTER DELETE ON frames
BEGIN
  DELETE FROM frames_text_fts WHERE frame_id = old.id;
END;

INSERT INTO frames_text_fts(frame_id, redacted_text, app_name, window_title, browser_domain, browser_url_search_label, document_path_search_label)
SELECT id, coalesce(redacted_text, ''), coalesce(app_name, ''), coalesce(window_title, ''), coalesce(browser_domain, ''), coalesce(browser_url_search_label, ''), coalesce(document_path_search_label, '')
FROM frames
WHERE safe_for_search = 1 AND deleted_at IS NULL;
`);
}

export function ensureRecorderSqlInspectorViews(db) {
  if (!db || typeof db.exec !== "function") {
    fail("ERR_RECORDER_STORE_INVALID_DB", "ensureRecorderSqlInspectorViews requires a better-sqlite3 database");
  }
  dropSqlInspectorViews(db);
  db.exec(RECORDER_SQL_INSPECTOR_VIEWS_SQL);
}

function dropSqlInspectorViews(db) {
  for (const viewName of RECORDER_SQL_INSPECTOR_VIEW_NAMES) {
    db.exec(`DROP VIEW IF EXISTS ${viewName};`);
  }
}

function ensureRecorderDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(directory, 0o700);
  } catch {
    // Permission tightening can fail on non-POSIX volumes; DB open will still surface write failures.
  }
}

function assertBaseTable(table) {
  const tableName = cleanString(table, 120);
  if (!BASE_TABLE_SET.has(tableName)) {
    fail("ERR_RECORDER_STORE_UNKNOWN_TABLE", `unknown recorder table: ${tableName || "(missing)"}`);
  }
  return tableName;
}

function normalizeRecordForTable(tableName, record = {}, currentRecord = null) {
  let normalized = record;
  if (tableName === "frames") {
    const merged = { ...(currentRecord || {}), ...(record || {}) };
    const sanitizedDomain = sanitizeFrameBrowserDomain(merged.browser_domain) || domainFromUrl(merged.browser_url);
    const sanitizedLabel = sanitizeFrameBrowserUrlSearchLabel(merged.browser_url_search_label, {
      browserUrl: merged.browser_url,
      browserDomain: sanitizedDomain,
    });
    const sanitizedDocumentLabel = sanitizeFrameDocumentPathSearchLabel(merged.document_path_search_label, {
      documentPath: merged.document_path,
    });
    const shouldPatchLabel = !currentRecord
      || Object.hasOwn(record, "browser_url_search_label")
      || Object.hasOwn(record, "browser_url")
      || Object.hasOwn(record, "browser_domain")
      || Object.hasOwn(record, "document_path_search_label")
      || Object.hasOwn(record, "document_path")
      || Object.hasOwn(record, "safe_for_search");
    if (shouldPatchLabel) {
      normalized = {
        ...record,
        browser_domain: sanitizedDomain,
        browser_url_search_label: sanitizedLabel,
        document_path_search_label: sanitizedDocumentLabel,
      };
    }
  }
  assertRecorderRedactionPolicyForRecord(tableName, normalized, { currentRecord, fail });
  return normalized;
}

function normalizeFrameTextProvenanceRow(row = {}) {
  const textSource = cleanString(row.text_source, 120);
  const hasAccessibilityText = Boolean(textOrNull(row.accessibility_text));
  const hasOcrText = Boolean(textOrNull(row.ocr_text));
  if (textSource === "accessibility_only" && hasAccessibilityText && !hasOcrText) {
    return { text_source: textSource, text_provenance_root_cause: null };
  }
  if (textSource === "ocr_only" && hasOcrText && !hasAccessibilityText) {
    return { text_source: textSource, text_provenance_root_cause: null };
  }
  if (textSource === "ax_plus_ocr" && hasAccessibilityText && hasOcrText) {
    return { text_source: textSource, text_provenance_root_cause: null };
  }
  if (textSource === "ocr_unavailable_named_root_cause" && !hasOcrText) {
    return {
      text_source: textSource,
      text_provenance_root_cause: textOrNull(row.text_provenance_root_cause) || "legacy_ocr_unavailable_root_cause_missing",
    };
  }
  if (hasAccessibilityText && hasOcrText) {
    return { text_source: "ax_plus_ocr", text_provenance_root_cause: null };
  }
  if (hasAccessibilityText) {
    return { text_source: "accessibility_only", text_provenance_root_cause: null };
  }
  if (hasOcrText) {
    return { text_source: "ocr_only", text_provenance_root_cause: null };
  }
  return {
    text_source: "ocr_unavailable_named_root_cause",
    text_provenance_root_cause: textSource === "screen_capture"
      ? "legacy_screen_capture_text_extraction_unavailable"
      : "legacy_text_provenance_unavailable",
  };
}

function sanitizeFrameBrowserUrlSearchLabel(value, { browserUrl = null, browserDomain = null } = {}) {
  const domain = sanitizeFrameBrowserDomain(browserDomain) || domainFromUrl(browserUrl);
  const explicit = textOrNull(value);
  if (!explicit) return domain;
  const explicitDomain = domainFromUrl(explicit);
  if (explicitDomain) return explicitDomain;
  const label = explicit
    .replace(/https?:\/\/\S+/gi, domain || "")
    .replace(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/giu, "")
    .replace(/\b(?:token|api[_-]?key|password|passwd|secret|session|auth|authorization|bearer)[\w.-]*\s*[:=]\s*\S+/giu, "")
    .replace(/[?#].*$/u, "")
    .replace(/\/[^\s]*/gu, "")
    .trim();
  return textOrNull(label) || domain;
}

function sanitizeFrameDocumentPathSearchLabel(value, { documentPath = null } = {}) {
  const explicit = textOrNull(value);
  if (explicit && !looksLikeRawPathOrUrl(explicit)) {
    const label = sanitizePublicMetadataLabel(explicit);
    if (label) return label;
  }

  const extension = extensionFromPath(explicit) || extensionFromPath(documentPath);
  if (extension) return `${extension} document`;
  return documentPath || explicit ? "local document" : null;
}

function sanitizePublicMetadataLabel(value) {
  const label = cleanString(value, 160)
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/giu, "")
    .replace(/\b(?:token|api[_-]?key|password|passwd|secret|session|auth|authorization|bearer)[\w.-]*\s*[:=]\s*\S+/giu, "")
    .replace(/[?#].*$/u, "")
    .replace(/[\\/]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  return textOrNull(label);
}

function looksLikeRawPathOrUrl(value) {
  const text = textOrNull(value);
  if (!text) return false;
  if (domainFromUrl(text) || /^https?:\/\//iu.test(text)) return true;
  if (/^~[\\/]/u.test(text) || /^[a-z]:[\\/]/iu.test(text)) return true;
  if (text.includes("/") || text.includes("\\")) return true;
  return false;
}

function extensionFromPath(value) {
  const text = textOrNull(value);
  if (!text) return null;
  const basename = text.split(/[\\/]/u).filter(Boolean).at(-1) || "";
  const match = /\.([a-z0-9]{1,12})$/iu.exec(basename);
  if (!match) return null;
  const extension = match[1].toLowerCase();
  if (!/^[a-z0-9]+$/iu.test(extension)) return null;
  return extension;
}

function sanitizeFrameBrowserDomain(value) {
  const text = textOrNull(value);
  if (!text) return null;
  const parsedHost = domainFromUrl(text) || domainFromUrl(`https://${text}`);
  if (!parsedHost) return null;
  const hostname = parsedHost.replace(/^www\./i, "");
  return /^[a-z0-9.-]+$/iu.test(hostname) ? hostname : null;
}

function domainFromUrl(value) {
  const text = textOrNull(value);
  if (!text) return null;
  try {
    return new URL(text).hostname.replace(/^www\./i, "") || null;
  } catch {
    return null;
  }
}

function textOrNull(value) {
  const text = cleanString(value, 500);
  return text || null;
}

function normalizeCheckpointMode(value) {
  const mode = cleanString(value, 40).toUpperCase() || "TRUNCATE";
  if (!new Set(["PASSIVE", "FULL", "RESTART", "TRUNCATE"]).has(mode)) {
    fail("ERR_RECORDER_STORE_INVALID_CHECKPOINT_MODE", `unsupported recorder.sqlite WAL checkpoint mode: ${mode}`);
  }
  return mode;
}

function cleanString(value = "", maxLength = 500) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function toIso(value) {
  const date = value instanceof Date ? value : new Date(value ?? Date.now());
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function toFtsQuery(value = "") {
  const text = cleanString(value, 400).replace(/"/g, '""');
  return `"${text}"`;
}

function fail(code, message, details = {}) {
  throw new RecorderStoreError(code, message, details);
}

const RECORDER_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS media_assets (
  id TEXT PRIMARY KEY,
  asset_type TEXT NOT NULL CHECK (asset_type IN ('frame_jpeg', 'audio_m4a', 'export_bundle')),
  relative_path TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  encrypted INTEGER NOT NULL DEFAULT 0,
  workspace_id TEXT,
  project_id TEXT,
  encryption_key_id TEXT,
  encryption_alg TEXT,
  encryption_nonce TEXT,
  encryption_tag TEXT,
  source_ids_json TEXT,
  created_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS frames (
  id TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL,
  workspace_id TEXT,
  project_id TEXT,
  captured_at TEXT NOT NULL,
  monitor_id TEXT NOT NULL,
  capture_trigger TEXT NOT NULL,
  app_name TEXT,
  window_title TEXT,
  browser_url TEXT,
  browser_domain TEXT,
  browser_url_normalized TEXT,
  browser_url_search_label TEXT,
  document_path TEXT,
  document_path_search_label TEXT,
  snapshot_asset_id TEXT NOT NULL,
  snapshot_sha256 TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  simhash TEXT,
  text_source TEXT NOT NULL,
  text_provenance_root_cause TEXT,
  accessibility_text TEXT,
  ocr_text TEXT,
  redacted_text TEXT,
  redaction_status TEXT NOT NULL,
  privacy_state TEXT NOT NULL,
  data_class TEXT NOT NULL,
  safe_for_search INTEGER NOT NULL DEFAULT 0,
  safe_for_memory INTEGER NOT NULL DEFAULT 0,
  safe_for_export INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  deleted_at TEXT,
  FOREIGN KEY (snapshot_asset_id) REFERENCES media_assets(id)
);

CREATE INDEX IF NOT EXISTS idx_frames_captured_at ON frames(captured_at);
CREATE INDEX IF NOT EXISTS idx_frames_workspace_project_time ON frames(workspace_id, project_id, captured_at);
CREATE INDEX IF NOT EXISTS idx_frames_app_time ON frames(app_name, captured_at);
CREATE INDEX IF NOT EXISTS idx_frames_domain_time ON frames(browser_domain, captured_at);
CREATE INDEX IF NOT EXISTS idx_frames_trigger_time ON frames(capture_trigger, captured_at);

CREATE TABLE IF NOT EXISTS audio_chunks (
  id TEXT PRIMARY KEY,
  workspace_id TEXT,
  project_id TEXT,
  started_at TEXT NOT NULL,
  ended_at TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('microphone', 'system_audio', 'meeting_audio')),
  audio_asset_id TEXT NOT NULL,
  transcript_status TEXT NOT NULL,
  consent_grant_id TEXT,
  visible_notice_id TEXT,
  raw_audio_indicator_state TEXT NOT NULL DEFAULT 'unknown',
  local_transcriber_name TEXT,
  local_transcriber_version TEXT,
  transcription_terminal_state TEXT,
  redaction_status TEXT NOT NULL,
  privacy_state TEXT NOT NULL,
  created_at TEXT NOT NULL,
  deleted_at TEXT,
  FOREIGN KEY (audio_asset_id) REFERENCES media_assets(id)
);

CREATE TABLE IF NOT EXISTS transcript_segments (
  id TEXT PRIMARY KEY,
  audio_chunk_id TEXT NOT NULL,
  workspace_id TEXT,
  project_id TEXT,
  started_at TEXT NOT NULL,
  ended_at TEXT NOT NULL,
  speaker_label TEXT,
  transcript_status TEXT NOT NULL DEFAULT 'local_complete',
  speaker_label_provenance TEXT,
  text TEXT NOT NULL,
  redacted_text TEXT,
  redaction_status TEXT NOT NULL,
  privacy_state TEXT NOT NULL,
  safe_for_search INTEGER NOT NULL DEFAULT 0,
  safe_for_memory INTEGER NOT NULL DEFAULT 0,
  deletion_source_id TEXT,
  created_at TEXT NOT NULL,
  deleted_at TEXT,
  FOREIGN KEY (audio_chunk_id) REFERENCES audio_chunks(id)
);

CREATE TABLE IF NOT EXISTS clipboard_events (
  id TEXT PRIMARY KEY,
  workspace_id TEXT,
  project_id TEXT,
  captured_at TEXT NOT NULL,
  event_kind TEXT NOT NULL CHECK (event_kind IN ('copy', 'cut', 'paste', 'change', 'unknown')),
  policy_mode TEXT NOT NULL CHECK (policy_mode IN ('trigger_only', 'content_opt_in', 'blocked')),
  source_app_name TEXT,
  source_window_title TEXT,
  content_type TEXT NOT NULL CHECK (content_type IN ('text', 'url', 'file', 'image', 'unknown')),
  content_size INTEGER,
  content_hash TEXT,
  content_text TEXT,
  redacted_text TEXT,
  redaction_status TEXT NOT NULL,
  privacy_state TEXT NOT NULL,
  suppression_reason TEXT,
  raw_retention_expires_at TEXT,
  safe_for_search INTEGER NOT NULL DEFAULT 0,
  safe_for_memory INTEGER NOT NULL DEFAULT 0,
  safe_for_export INTEGER NOT NULL DEFAULT 0,
  content_captured INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  deleted_at TEXT,
  CHECK (content_captured IN (0, 1)),
  CHECK (content_captured = 1 OR content_text IS NULL)
);

CREATE INDEX IF NOT EXISTS idx_clipboard_events_captured_at ON clipboard_events(captured_at);
CREATE INDEX IF NOT EXISTS idx_clipboard_events_workspace_project_captured_at ON clipboard_events(workspace_id, project_id, captured_at);

CREATE TABLE IF NOT EXISTS memory_items (
  id TEXT PRIMARY KEY,
  workspace_id TEXT,
  project_id TEXT,
  memory_type TEXT NOT NULL CHECK (memory_type IN ('daily_summary', 'project_summary', 'product_event_summary', 'evidence_debt', 'pipe_output', 'execution_trace')),
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  source_ids_json TEXT NOT NULL,
  time_range_json TEXT NOT NULL,
  redaction_status TEXT NOT NULL,
  privacy_state TEXT NOT NULL,
  safe_for_search INTEGER NOT NULL DEFAULT 0,
  safe_for_memory INTEGER NOT NULL DEFAULT 0,
  safe_for_export INTEGER NOT NULL DEFAULT 0,
  confidence TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS product_events (
  id TEXT PRIMARY KEY,
  workspace_id TEXT,
  project_id TEXT,
  event_type TEXT NOT NULL CHECK (event_type IN ('customer_interview', 'customer_ask_sent', 'public_post', 'activation_observed', 'payment_intent', 'payment_record', 'traffic_snapshot', 'build_or_test', 'internal_product_change', 'blocker', 'negative_evidence', 'research_signal', 'pipe_generated_worklog')),
  occurred_at TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  source_ids_json TEXT NOT NULL,
  safe_for_search INTEGER NOT NULL DEFAULT 0,
  safe_for_memory INTEGER NOT NULL DEFAULT 0,
  safe_for_export INTEGER NOT NULL DEFAULT 0,
  verification_status TEXT NOT NULL DEFAULT 'unverified' CHECK (verification_status IN ('unverified', 'candidate_created', 'verifier_rejected', 'written_to_ledger')),
  proof_ledger_event_id TEXT,
  confidence TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS evidence_candidates (
  id TEXT PRIMARY KEY,
  workspace_id TEXT,
  project_id TEXT,
  candidate_status TEXT NOT NULL CHECK (candidate_status IN ('pending_review', 'degraded', 'rejected', 'approved_bundle', 'verifier_rejected', 'written_to_ledger')),
  source_state TEXT NOT NULL,
  claim TEXT NOT NULL,
  proof_kind TEXT NOT NULL,
  source_ids_json TEXT NOT NULL,
  proof_ledger_mapping_json TEXT NOT NULL,
  evidence_debt_json TEXT NOT NULL,
  immutable_fingerprint TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  verifier_result_json TEXT,
  proof_ledger_event_id TEXT UNIQUE,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  reviewed_at TEXT,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS recorder_audit (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  workspace_id TEXT,
  project_id TEXT,
  endpoint TEXT NOT NULL,
  access_level TEXT NOT NULL,
  source_ids_json TEXT NOT NULL,
  decision TEXT NOT NULL,
  reason TEXT,
  created_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS api_tokens (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  client_id TEXT NOT NULL,
  client_name TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  scopes_json TEXT NOT NULL,
  issued_by TEXT NOT NULL,
  issued_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  last_used_at TEXT
);

CREATE TABLE IF NOT EXISTS pipe_definitions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT,
  project_id TEXT,
  path TEXT NOT NULL,
  name TEXT NOT NULL,
  schedule TEXT NOT NULL,
  enabled INTEGER NOT NULL,
  pipe_kind TEXT NOT NULL CHECK (pipe_kind IN ('built_in', 'signed_template', 'custom_disabled')),
  permission_manifest_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pipe_runs (
  id TEXT PRIMARY KEY,
  pipe_id TEXT NOT NULL,
  workspace_id TEXT,
  project_id TEXT,
  trigger_reason TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled', 'timed_out')),
  started_at TEXT NOT NULL,
  ended_at TEXT,
  input_manifest_json TEXT NOT NULL,
  output_manifest_json TEXT,
  audit_log_json TEXT NOT NULL,
  error_message TEXT,
  deleted_at TEXT,
  FOREIGN KEY (pipe_id) REFERENCES pipe_definitions(id)
);

CREATE VIRTUAL TABLE IF NOT EXISTS frames_text_fts USING fts5(
  frame_id UNINDEXED,
  redacted_text,
  app_name,
  window_title,
  browser_domain,
  browser_url_search_label,
  document_path_search_label
);

CREATE VIRTUAL TABLE IF NOT EXISTS transcript_text_fts USING fts5(
  segment_id UNINDEXED,
  redacted_text,
  speaker_label
);

CREATE VIRTUAL TABLE IF NOT EXISTS memory_items_fts USING fts5(
  memory_id UNINDEXED,
  title,
  summary
);

CREATE VIRTUAL TABLE IF NOT EXISTS product_events_fts USING fts5(
  product_event_id UNINDEXED,
  title,
  summary
);

CREATE TRIGGER IF NOT EXISTS frames_text_fts_ai AFTER INSERT ON frames
WHEN new.safe_for_search = 1 AND new.deleted_at IS NULL
BEGIN
  INSERT INTO frames_text_fts(frame_id, redacted_text, app_name, window_title, browser_domain, browser_url_search_label, document_path_search_label)
  VALUES (new.id, coalesce(new.redacted_text, ''), coalesce(new.app_name, ''), coalesce(new.window_title, ''), coalesce(new.browser_domain, ''), coalesce(new.browser_url_search_label, ''), coalesce(new.document_path_search_label, ''));
END;

CREATE TRIGGER IF NOT EXISTS frames_text_fts_au AFTER UPDATE ON frames
BEGIN
  DELETE FROM frames_text_fts WHERE frame_id = old.id;
  INSERT INTO frames_text_fts(frame_id, redacted_text, app_name, window_title, browser_domain, browser_url_search_label, document_path_search_label)
  SELECT new.id, coalesce(new.redacted_text, ''), coalesce(new.app_name, ''), coalesce(new.window_title, ''), coalesce(new.browser_domain, ''), coalesce(new.browser_url_search_label, ''), coalesce(new.document_path_search_label, '')
  WHERE new.safe_for_search = 1 AND new.deleted_at IS NULL;
END;

CREATE TRIGGER IF NOT EXISTS frames_text_fts_ad AFTER DELETE ON frames
BEGIN
  DELETE FROM frames_text_fts WHERE frame_id = old.id;
END;

CREATE TRIGGER IF NOT EXISTS transcript_text_fts_ai AFTER INSERT ON transcript_segments
WHEN new.safe_for_search = 1 AND new.deleted_at IS NULL
BEGIN
  INSERT INTO transcript_text_fts(segment_id, redacted_text, speaker_label)
  VALUES (new.id, coalesce(new.redacted_text, ''), coalesce(new.speaker_label, ''));
END;

CREATE TRIGGER IF NOT EXISTS transcript_text_fts_au AFTER UPDATE ON transcript_segments
BEGIN
  DELETE FROM transcript_text_fts WHERE segment_id = old.id;
  INSERT INTO transcript_text_fts(segment_id, redacted_text, speaker_label)
  SELECT new.id, coalesce(new.redacted_text, ''), coalesce(new.speaker_label, '')
  WHERE new.safe_for_search = 1 AND new.deleted_at IS NULL;
END;

CREATE TRIGGER IF NOT EXISTS transcript_text_fts_ad AFTER DELETE ON transcript_segments
BEGIN
  DELETE FROM transcript_text_fts WHERE segment_id = old.id;
END;

CREATE TRIGGER IF NOT EXISTS memory_items_fts_ai AFTER INSERT ON memory_items
WHEN new.safe_for_search = 1 AND new.deleted_at IS NULL
BEGIN
  INSERT INTO memory_items_fts(memory_id, title, summary)
  VALUES (new.id, coalesce(new.title, ''), coalesce(new.summary, ''));
END;

CREATE TRIGGER IF NOT EXISTS memory_items_fts_au AFTER UPDATE ON memory_items
BEGIN
  DELETE FROM memory_items_fts WHERE memory_id = old.id;
  INSERT INTO memory_items_fts(memory_id, title, summary)
  SELECT new.id, coalesce(new.title, ''), coalesce(new.summary, '')
  WHERE new.safe_for_search = 1 AND new.deleted_at IS NULL;
END;

CREATE TRIGGER IF NOT EXISTS memory_items_fts_ad AFTER DELETE ON memory_items
BEGIN
  DELETE FROM memory_items_fts WHERE memory_id = old.id;
END;

CREATE TRIGGER IF NOT EXISTS product_events_fts_ai AFTER INSERT ON product_events
WHEN new.safe_for_search = 1 AND new.deleted_at IS NULL
BEGIN
  INSERT INTO product_events_fts(product_event_id, title, summary)
  VALUES (new.id, coalesce(new.title, ''), coalesce(new.summary, ''));
END;

CREATE TRIGGER IF NOT EXISTS product_events_fts_au AFTER UPDATE ON product_events
BEGIN
  DELETE FROM product_events_fts WHERE product_event_id = old.id;
  INSERT INTO product_events_fts(product_event_id, title, summary)
  SELECT new.id, coalesce(new.title, ''), coalesce(new.summary, '')
  WHERE new.safe_for_search = 1 AND new.deleted_at IS NULL;
END;

CREATE TRIGGER IF NOT EXISTS product_events_fts_ad AFTER DELETE ON product_events
BEGIN
  DELETE FROM product_events_fts WHERE product_event_id = old.id;
END;
`;

const RECORDER_SCHEMA_V2_SQL = `
CREATE TABLE IF NOT EXISTS clipboard_events (
  id TEXT PRIMARY KEY,
  workspace_id TEXT,
  project_id TEXT,
  captured_at TEXT NOT NULL,
  event_kind TEXT NOT NULL CHECK (event_kind IN ('copy', 'cut', 'paste', 'change', 'unknown')),
  policy_mode TEXT NOT NULL CHECK (policy_mode IN ('trigger_only', 'content_opt_in', 'blocked')),
  source_app_name TEXT,
  source_window_title TEXT,
  content_type TEXT NOT NULL CHECK (content_type IN ('text', 'url', 'file', 'image', 'unknown')),
  content_size INTEGER,
  content_hash TEXT,
  content_text TEXT,
  redacted_text TEXT,
  redaction_status TEXT NOT NULL,
  privacy_state TEXT NOT NULL,
  suppression_reason TEXT,
  raw_retention_expires_at TEXT,
  safe_for_search INTEGER NOT NULL DEFAULT 0,
  safe_for_memory INTEGER NOT NULL DEFAULT 0,
  safe_for_export INTEGER NOT NULL DEFAULT 0,
  content_captured INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  deleted_at TEXT,
  CHECK (content_captured IN (0, 1)),
  CHECK (content_captured = 1 OR content_text IS NULL)
);

CREATE INDEX IF NOT EXISTS idx_clipboard_events_captured_at ON clipboard_events(captured_at);
CREATE INDEX IF NOT EXISTS idx_clipboard_events_workspace_project_captured_at ON clipboard_events(workspace_id, project_id, captured_at);
`;

const RECORDER_SQL_INSPECTOR_VIEWS_SQL = `
CREATE VIEW IF NOT EXISTS recorder_sql_frames_redacted AS
SELECT
  id,
  workspace_id,
  project_id,
  captured_at,
  capture_trigger,
  app_name,
  window_title,
  browser_domain,
  browser_url_search_label,
  document_path_search_label,
  redacted_text,
  redaction_status,
  privacy_state,
  safe_for_search,
  safe_for_memory,
  safe_for_export,
  text_source,
  text_provenance_root_cause
FROM frames
WHERE deleted_at IS NULL AND safe_for_search = 1;

CREATE VIEW IF NOT EXISTS recorder_sql_transcripts_redacted AS
SELECT
  transcript_segments.id,
  transcript_segments.audio_chunk_id,
  transcript_segments.workspace_id,
  transcript_segments.project_id,
  transcript_segments.started_at,
  transcript_segments.ended_at,
  transcript_segments.speaker_label,
  transcript_segments.transcript_status AS segment_transcript_status,
  transcript_segments.speaker_label_provenance,
  transcript_segments.redacted_text,
  transcript_segments.redaction_status,
  transcript_segments.privacy_state,
  transcript_segments.safe_for_search,
  transcript_segments.safe_for_memory,
  audio_chunks.transcript_status,
  audio_chunks.source AS audio_source,
  audio_chunks.raw_audio_indicator_state,
  audio_chunks.local_transcriber_name,
  audio_chunks.local_transcriber_version,
  audio_chunks.transcription_terminal_state
FROM transcript_segments
JOIN audio_chunks ON audio_chunks.id = transcript_segments.audio_chunk_id
WHERE transcript_segments.deleted_at IS NULL
  AND audio_chunks.deleted_at IS NULL
  AND transcript_segments.safe_for_search = 1;

CREATE VIEW IF NOT EXISTS recorder_sql_clipboard_redacted AS
SELECT
  id,
  workspace_id,
  project_id,
  captured_at,
  event_kind,
  policy_mode,
  source_app_name,
  source_window_title,
  content_type,
  content_size,
  content_hash,
  redacted_text,
  redaction_status,
  privacy_state,
  suppression_reason,
  raw_retention_expires_at,
  safe_for_search,
  safe_for_memory,
  safe_for_export,
  content_captured
FROM clipboard_events
WHERE deleted_at IS NULL
  AND safe_for_search = 1;

CREATE VIEW IF NOT EXISTS recorder_sql_frames_raw_admin AS
SELECT
  frames.id,
  frames.workspace_id,
  frames.project_id,
  frames.captured_at,
  frames.capture_trigger,
  frames.app_name,
  frames.window_title,
  frames.browser_url,
  frames.browser_url_normalized,
  frames.browser_url_search_label,
  frames.browser_domain,
  frames.document_path,
  frames.document_path_search_label,
  frames.accessibility_text,
  frames.ocr_text,
  frames.redacted_text,
  frames.redaction_status,
  frames.privacy_state,
  frames.safe_for_search,
  frames.safe_for_memory,
  frames.safe_for_export,
  frames.text_source,
  frames.text_provenance_root_cause,
  frames.snapshot_asset_id,
  media_assets.relative_path AS media_relative_path,
  media_assets.sha256 AS media_sha256,
  media_assets.byte_size AS media_byte_size,
  media_assets.encrypted AS media_encrypted
FROM frames
JOIN media_assets ON media_assets.id = frames.snapshot_asset_id
WHERE frames.deleted_at IS NULL
  AND media_assets.deleted_at IS NULL;

CREATE VIEW IF NOT EXISTS recorder_sql_transcripts_raw_admin AS
SELECT
  transcript_segments.id,
  transcript_segments.audio_chunk_id,
  transcript_segments.workspace_id,
  transcript_segments.project_id,
  transcript_segments.started_at,
  transcript_segments.ended_at,
  transcript_segments.speaker_label,
  transcript_segments.transcript_status AS segment_transcript_status,
  transcript_segments.speaker_label_provenance,
  transcript_segments.text AS transcript_text,
  transcript_segments.redacted_text,
  transcript_segments.redaction_status,
  transcript_segments.privacy_state,
  transcript_segments.safe_for_search,
  transcript_segments.safe_for_memory,
  transcript_segments.deletion_source_id,
  audio_chunks.transcript_status,
  audio_chunks.source AS audio_source,
  audio_chunks.consent_grant_id,
  audio_chunks.visible_notice_id,
  audio_chunks.raw_audio_indicator_state,
  audio_chunks.local_transcriber_name,
  audio_chunks.local_transcriber_version,
  audio_chunks.transcription_terminal_state,
  audio_chunks.audio_asset_id,
  media_assets.relative_path AS audio_relative_path,
  media_assets.sha256 AS audio_sha256,
  media_assets.byte_size AS audio_byte_size,
  media_assets.encrypted AS audio_encrypted
FROM transcript_segments
JOIN audio_chunks ON audio_chunks.id = transcript_segments.audio_chunk_id
JOIN media_assets ON media_assets.id = audio_chunks.audio_asset_id
WHERE transcript_segments.deleted_at IS NULL
  AND audio_chunks.deleted_at IS NULL
  AND media_assets.deleted_at IS NULL;

CREATE VIEW IF NOT EXISTS recorder_sql_clipboard_raw_admin AS
SELECT
  id,
  workspace_id,
  project_id,
  captured_at,
  event_kind,
  policy_mode,
  source_app_name,
  source_window_title,
  content_type,
  content_size,
  content_hash,
  content_text AS clipboard_text,
  redacted_text,
  redaction_status,
  privacy_state,
  suppression_reason,
  raw_retention_expires_at,
  safe_for_search,
  safe_for_memory,
  safe_for_export,
  content_captured
FROM clipboard_events
WHERE deleted_at IS NULL;

CREATE VIEW IF NOT EXISTS recorder_sql_memory_items AS
SELECT
  id,
  workspace_id,
  project_id,
  memory_type,
  title,
  summary,
  time_range_json,
  redaction_status,
  privacy_state,
  safe_for_search,
  safe_for_memory,
  safe_for_export,
  confidence,
  created_by,
  created_at
FROM memory_items
WHERE deleted_at IS NULL AND safe_for_memory = 1;

CREATE VIEW IF NOT EXISTS recorder_sql_product_events AS
SELECT
  id,
  workspace_id,
  project_id,
  event_type,
  occurred_at,
  title,
  summary,
  source_ids_json,
  verification_status,
  confidence,
  created_by,
  created_at,
  safe_for_search,
  safe_for_memory,
  safe_for_export
FROM product_events
WHERE deleted_at IS NULL AND safe_for_search = 1;

CREATE VIEW IF NOT EXISTS recorder_sql_audit_sanitized AS
SELECT
  id,
  request_id,
  actor_type,
  actor_id,
  workspace_id,
  project_id,
  endpoint,
  access_level,
  decision,
  reason,
  created_at,
  deleted_at
FROM recorder_audit;

CREATE VIEW IF NOT EXISTS recorder_sql_storage_stats AS
SELECT
  workspace_id,
  project_id,
  asset_type,
  count(*) AS asset_count,
  sum(byte_size) AS total_byte_size,
  sum(CASE WHEN encrypted = 1 THEN 1 ELSE 0 END) AS encrypted_count,
  sum(CASE WHEN deleted_at IS NOT NULL THEN 1 ELSE 0 END) AS deleted_count
FROM media_assets
GROUP BY workspace_id, project_id, asset_type;

CREATE VIEW IF NOT EXISTS recorder_sql_capture_health AS
SELECT
  'frames' AS source_type,
  count(*) AS row_count,
  min(captured_at) AS started_at,
  max(captured_at) AS ended_at,
  sum(CASE WHEN safe_for_search = 1 THEN 1 ELSE 0 END) AS searchable_count,
  sum(CASE WHEN deleted_at IS NOT NULL THEN 1 ELSE 0 END) AS deleted_count
FROM frames
UNION ALL
SELECT
  'transcripts' AS source_type,
  count(*) AS row_count,
  min(started_at) AS started_at,
  max(ended_at) AS ended_at,
  sum(CASE WHEN safe_for_search = 1 THEN 1 ELSE 0 END) AS searchable_count,
  sum(CASE WHEN deleted_at IS NOT NULL THEN 1 ELSE 0 END) AS deleted_count
FROM transcript_segments
UNION ALL
SELECT
  'clipboard' AS source_type,
  count(*) AS row_count,
  min(captured_at) AS started_at,
  max(captured_at) AS ended_at,
  sum(CASE WHEN safe_for_search = 1 THEN 1 ELSE 0 END) AS searchable_count,
  sum(CASE WHEN deleted_at IS NOT NULL THEN 1 ELSE 0 END) AS deleted_count
FROM clipboard_events;
`;
