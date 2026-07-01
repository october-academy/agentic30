import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

import {
  RECORDER_BASE_TABLES,
  RECORDER_FTS_TABLES,
  RECORDER_STORE_SCHEMA_VERSION,
  RecorderStoreError,
  RecorderStore,
  migrateRecorderDatabase,
} from "../sidecar/recorder-store.mjs";
import { RECORDER_REDACTION_POLICY_MATRIX } from "../sidecar/recorder-redaction-policy.mjs";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");

async function makeStore() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-recorder-store-"));
  const store = new RecorderStore({ appSupportRoot: root }).open();
  return { root, store };
}

function insertFrameFixture(store, overrides = {}) {
  store.insertRecord("media_assets", {
    id: overrides.snapshot_asset_id || "asset-frame-1",
    asset_type: "frame_jpeg",
    relative_path: "media/frames/frame-1.jpg",
    sha256: "sha256-frame-1",
    byte_size: 128,
    encrypted: 1,
    workspace_id: "workspace-1",
    project_id: "project-1",
    created_at: "2026-06-27T10:00:00.000Z",
  });
  store.insertRecord("frames", {
    id: "frame-1",
    schema_version: RECORDER_STORE_SCHEMA_VERSION,
    workspace_id: "workspace-1",
    project_id: "project-1",
    captured_at: "2026-06-27T10:00:01.000Z",
    monitor_id: "main",
    capture_trigger: "typing_pause",
    app_name: "Codex",
    window_title: "Founder Memory OS",
    browser_url: "",
    browser_domain: "",
    browser_url_normalized: "",
    document_path: "",
    snapshot_asset_id: "asset-frame-1",
    snapshot_sha256: "sha256-frame-1",
    content_hash: "content-hash-1",
    simhash: "",
    text_source: "ax_plus_ocr",
    text_provenance_root_cause: null,
    accessibility_text: "raw private customer@example.com",
    ocr_text: "raw OCR private",
    redacted_text: "redacted founder memory review",
    redaction_status: "redacted",
    privacy_state: "searchable_local",
    data_class: "frame",
    safe_for_search: 1,
    safe_for_memory: 1,
    safe_for_export: 0,
    created_at: "2026-06-27T10:00:02.000Z",
    deleted_at: null,
    ...overrides,
  });
}

test("RecorderStore opens recorder.sqlite with direct better-sqlite3 dependency and current migrations", async () => {
  const packageJson = require("../package.json");
  assert.equal(packageJson.dependencies["better-sqlite3"], "12.8.0");

  const { root, store } = await makeStore();
  try {
    assert.equal(store.userVersion(), RECORDER_STORE_SCHEMA_VERSION);
    assert.equal(store.dbPath, path.join(root, "recorder", "recorder.sqlite"));
    assert.deepEqual(store.baseTables(), [...RECORDER_BASE_TABLES].sort());
    assert.deepEqual(store.ftsTables(), [...RECORDER_FTS_TABLES].sort());
    const mediaColumns = store.database().pragma("table_info(media_assets)").map((column) => column.name);
    for (const column of ["encryption_key_id", "encryption_alg", "encryption_nonce", "encryption_tag", "source_ids_json"]) {
      assert.equal(mediaColumns.includes(column), true);
    }
    const frameColumns = store.database().pragma("table_info(frames)").map((column) => column.name);
    assert.equal(frameColumns.includes("browser_url_search_label"), true);
    assert.equal(frameColumns.includes("document_path_search_label"), true);
    assert.equal(frameColumns.includes("text_provenance_root_cause"), true);
    const frameFtsColumns = store.database().pragma("table_info(frames_text_fts)").map((column) => column.name);
    assert.equal(frameFtsColumns.includes("browser_url_search_label"), true);
    assert.equal(frameFtsColumns.includes("document_path_search_label"), true);
    assert.equal(frameFtsColumns.includes("browser_url_normalized"), false);
    assert.equal(frameFtsColumns.includes("document_path"), false);
    const audioColumns = store.database().pragma("table_info(audio_chunks)").map((column) => column.name);
    for (const column of [
      "consent_grant_id",
      "visible_notice_id",
      "raw_audio_indicator_state",
      "local_transcriber_name",
      "local_transcriber_version",
      "transcription_terminal_state",
    ]) {
      assert.equal(audioColumns.includes(column), true);
    }
    const transcriptColumns = store.database().pragma("table_info(transcript_segments)").map((column) => column.name);
    for (const column of ["transcript_status", "speaker_label_provenance", "deletion_source_id"]) {
      assert.equal(transcriptColumns.includes(column), true);
    }
    const pipeRunColumns = store.database().pragma("table_info(pipe_runs)").map((column) => column.name);
    assert.equal(pipeRunColumns.includes("deleted_at"), true);
    const auditColumns = store.database().pragma("table_info(recorder_audit)").map((column) => column.name);
    assert.equal(auditColumns.includes("deleted_at"), true);
    const clipboardColumns = store.database().pragma("table_info(clipboard_events)").map((column) => column.name);
    for (const column of [
      "captured_at",
      "policy_mode",
      "source_app_name",
      "source_window_title",
      "content_size",
      "suppression_reason",
      "raw_retention_expires_at",
    ]) {
      assert.equal(clipboardColumns.includes(column), true);
    }
    for (const legacyColumn of ["occurred_at", "capture_mode", "app_name", "window_title"]) {
      assert.equal(clipboardColumns.includes(legacyColumn), false);
    }
    const sqlInspectorViews = store.database()
      .prepare("SELECT name FROM sqlite_master WHERE type = 'view' AND name LIKE 'recorder_sql_%' ORDER BY name")
      .all()
      .map((row) => row.name);
    assert.deepEqual(sqlInspectorViews, [
      "recorder_sql_audit_sanitized",
      "recorder_sql_capture_health",
      "recorder_sql_clipboard_raw_admin",
      "recorder_sql_clipboard_redacted",
      "recorder_sql_frames_raw_admin",
      "recorder_sql_frames_redacted",
      "recorder_sql_memory_items",
      "recorder_sql_product_events",
      "recorder_sql_storage_stats",
      "recorder_sql_transcripts_raw_admin",
      "recorder_sql_transcripts_redacted",
    ]);
  } finally {
    store.close();
  }
});

test("RecorderStore redaction policy matrix covers search and memory write sinks", () => {
  for (const tableName of ["frames", "transcript_segments", "clipboard_events", "memory_items", "product_events"]) {
    assert.equal(Boolean(RECORDER_REDACTION_POLICY_MATRIX[tableName]), true);
    assert.equal(RECORDER_REDACTION_POLICY_MATRIX[tableName].sinks.search.flagColumn, "safe_for_search");
    assert.equal(RECORDER_REDACTION_POLICY_MATRIX[tableName].sinks.memory.flagColumn, "safe_for_memory");
  }
  assert.equal(
    RECORDER_REDACTION_POLICY_MATRIX.frames.publicTextColumns.includes("document_path_search_label"),
    true,
  );
});

test("RecorderStore rejects direct safe-for-search frame rows without redacted text", async () => {
  const { store } = await makeStore();
  try {
    assert.throws(
      () => insertFrameFixture(store, {
        id: "frame-unredacted",
        snapshot_asset_id: "asset-frame-unredacted",
        redacted_text: null,
      }),
      (error) => error instanceof RecorderStoreError
        && error.code === "ERR_RECORDER_REDACTION_POLICY_MISSING_TEXT",
    );
    assert.equal(store.getRecord("frames", "frame-unredacted"), null);
    assert.deepEqual(store.search("private"), []);
  } finally {
    store.close();
  }
});

test("RecorderStore rejects unsafe memory and product-event eligibility before FTS or memory use", async () => {
  const { store } = await makeStore();
  try {
    store.insertRecord("memory_items", {
      id: "memory-unsafe",
      workspace_id: "workspace-1",
      project_id: "project-1",
      memory_type: "daily_summary",
      title: "Unsafe raw memory",
      summary: "customer@example.com raw unsafe memory",
      source_ids_json: JSON.stringify(["frame-1"]),
      time_range_json: JSON.stringify({}),
      redaction_status: "raw",
      privacy_state: "blocked",
      safe_for_search: 0,
      safe_for_memory: 0,
      safe_for_export: 0,
      confidence: "low",
      created_by: "test",
      created_at: "2026-06-28T11:01:00.000Z",
    });
    assert.equal(store.search("customer@example.com").length, 0);
    assert.throws(
      () => store.updateRecord("memory_items", "memory-unsafe", { safe_for_memory: 1 }),
      (error) => error instanceof RecorderStoreError
        && error.code === "ERR_RECORDER_REDACTION_POLICY_UNSAFE_STATUS",
    );

    assert.throws(
      () => store.insertRecord("product_events", {
        id: "event-unsafe",
        workspace_id: "workspace-1",
        project_id: "project-1",
        event_type: "customer_interview",
        occurred_at: "2026-06-28T10:22:00.000Z",
        title: "Unsafe customer signal",
        summary: "customer@example.com raw unsafe product event",
        source_ids_json: JSON.stringify([{ id: "frame-1", source_type: "frame" }]),
        safe_for_search: 1,
        safe_for_memory: 1,
        safe_for_export: 0,
        verification_status: "unverified",
        proof_ledger_event_id: null,
        confidence: "low",
        created_by: "test",
        created_at: "2026-06-28T10:23:00.000Z",
      }),
      (error) => error instanceof RecorderStoreError
        && error.code === "ERR_RECORDER_REDACTION_POLICY_UNSAFE_TEXT",
    );
    assert.equal(store.getRecord("product_events", "event-unsafe"), null);

    assert.throws(
      () => store.insertRecord("product_events", {
        id: "event-token-phone-unsafe",
        workspace_id: "workspace-1",
        project_id: "project-1",
        event_type: "customer_interview",
        occurred_at: "2026-06-28T10:24:00.000Z",
        title: "Unsafe customer signal",
        summary: "raw token sk-1234567890abcdef and phone +1 555 123 4567",
        source_ids_json: JSON.stringify([{ id: "frame-1", source_type: "frame" }]),
        safe_for_search: 1,
        safe_for_memory: 1,
        safe_for_export: 0,
        verification_status: "unverified",
        proof_ledger_event_id: null,
        confidence: "low",
        created_by: "test",
        created_at: "2026-06-28T10:25:00.000Z",
      }),
      (error) => error instanceof RecorderStoreError
        && error.code === "ERR_RECORDER_REDACTION_POLICY_UNSAFE_TEXT",
    );
    assert.equal(store.getRecord("product_events", "event-token-phone-unsafe"), null);
  } finally {
    store.close();
  }
});

test("migrateRecorderDatabase canonicalizes legacy frame text provenance", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-recorder-store-frame-provenance-"));
  const dbPath = path.join(root, "recorder.sqlite");
  const db = new Database(dbPath);
  try {
    db.exec(`
CREATE TABLE media_assets (
  id TEXT PRIMARY KEY,
  asset_type TEXT NOT NULL,
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
CREATE TABLE frames (
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
  snapshot_asset_id TEXT NOT NULL,
  snapshot_sha256 TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  simhash TEXT,
  text_source TEXT NOT NULL,
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
  deleted_at TEXT
);
INSERT INTO media_assets (
  id,
  asset_type,
  relative_path,
  sha256,
  byte_size,
  encrypted,
  created_at
) VALUES (
  'asset-legacy',
  'frame_jpeg',
  'media/frames/legacy.jpg',
  'sha256-legacy',
  4,
  0,
  '2026-06-28T10:00:00.000Z'
);
INSERT INTO frames (
  id,
  schema_version,
  captured_at,
  monitor_id,
  capture_trigger,
  snapshot_asset_id,
  snapshot_sha256,
  content_hash,
  text_source,
  redaction_status,
  privacy_state,
  data_class,
  created_at
) VALUES (
  'frame-legacy',
  1,
  '2026-06-28T10:00:01.000Z',
  'main',
  'manual_swift_screencapturekit',
  'asset-legacy',
  'sha256-legacy',
  'content-legacy',
  'screen_capture',
  'not_redacted',
  'raw_local',
  'screen',
  '2026-06-28T10:00:02.000Z'
);
PRAGMA user_version = 10;
`);

    assert.equal(migrateRecorderDatabase(db), RECORDER_STORE_SCHEMA_VERSION);
    const frame = db.prepare("SELECT text_source, text_provenance_root_cause FROM frames WHERE id = 'frame-legacy'").get();
    assert.equal(frame.text_source, "ocr_unavailable_named_root_cause");
    assert.equal(frame.text_provenance_root_cause, "legacy_screen_capture_text_extraction_unavailable");
  } finally {
    db.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("migrateRecorderDatabase migrates a pre-document-column frames DB (v9) without crashing the FTS rebuild", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-recorder-store-migrate-v9-"));
  const dbPath = path.join(root, "recorder.sqlite");
  const db = new Database(dbPath);
  try {
    // Regression for the FTS-rebuild ordering crash: a frames table that predates
    // document_path_search_label (added only at schema v12), stamped at
    // user_version 9 so the `currentVersion < 10` step runs rebuildFramesFtsSchema
    // BEFORE the v12 ADD-COLUMN step. Before the fix this raised
    // "no such column: document_path_search_label", rolled back the whole
    // migration, and — since the sidecar bootstrap process.exits on open()
    // failure — crashed the entire sidecar on every launch. The real dogfood
    // machine's recorder.sqlite is at user_version 7 and hits the same rebuild site.
    db.exec(`
CREATE TABLE frames (
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
  snapshot_asset_id TEXT NOT NULL,
  snapshot_sha256 TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  simhash TEXT,
  text_source TEXT NOT NULL,
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
  deleted_at TEXT
);
INSERT INTO frames (
  id, schema_version, captured_at, monitor_id, capture_trigger,
  app_name, browser_url_search_label,
  snapshot_asset_id, snapshot_sha256, content_hash, text_source,
  redacted_text, redaction_status, privacy_state, data_class,
  safe_for_search, created_at
) VALUES (
  'frame-legacy-v9', 1, '2026-06-28T10:00:01.000Z', 'main', 'manual_swift_screencapturekit',
  'Codex', 'agentic30.example',
  'asset-legacy', 'sha256-legacy', 'content-legacy', 'screen_capture',
  'redacted activation summary', 'redacted', 'searchable_local', 'screen',
  1, '2026-06-28T10:00:02.000Z'
);
PRAGMA user_version = 9;
`);

    // Before the fix this threw and left user_version at 9.
    assert.equal(migrateRecorderDatabase(db), RECORDER_STORE_SCHEMA_VERSION);

    const frameColumns = db.pragma("table_info(frames)").map((column) => column.name);
    assert.equal(frameColumns.includes("document_path_search_label"), true);

    const ftsColumns = db.pragma("table_info(frames_text_fts)").map((column) => column.name);
    assert.equal(ftsColumns.includes("document_path_search_label"), true);

    // The safe_for_search frame was backfilled into FTS by the rebuild.
    const hit = db.prepare("SELECT frame_id FROM frames_text_fts WHERE frames_text_fts MATCH 'activation'").get();
    assert.equal(hit.frame_id, "frame-legacy-v9");
  } finally {
    db.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("migrateRecorderDatabase rebuilds legacy clipboard_events into the Gate C envelope", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-recorder-store-migrate-"));
  const dbPath = path.join(root, "recorder.sqlite");
  const db = new Database(dbPath);
  try {
    db.exec(`
CREATE TABLE clipboard_events (
  id TEXT PRIMARY KEY,
  workspace_id TEXT,
  project_id TEXT,
  occurred_at TEXT NOT NULL,
  event_kind TEXT NOT NULL,
  capture_mode TEXT NOT NULL,
  app_name TEXT,
  window_title TEXT,
  content_type TEXT NOT NULL,
  content_hash TEXT,
  content_text TEXT,
  redacted_text TEXT,
  redaction_status TEXT NOT NULL,
  privacy_state TEXT NOT NULL,
  safe_for_search INTEGER NOT NULL DEFAULT 0,
  safe_for_memory INTEGER NOT NULL DEFAULT 0,
  safe_for_export INTEGER NOT NULL DEFAULT 0,
  content_captured INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  deleted_at TEXT
);
INSERT INTO clipboard_events (
  id,
  workspace_id,
  project_id,
  occurred_at,
  event_kind,
  capture_mode,
  app_name,
  window_title,
  content_type,
  content_hash,
  content_text,
  redacted_text,
  redaction_status,
  privacy_state,
  safe_for_search,
  safe_for_memory,
  safe_for_export,
  content_captured,
  created_at,
  deleted_at
) VALUES (
  'clipboard-legacy',
  'workspace-1',
  'project-1',
  '2026-06-28T10:18:00.000Z',
  'copy',
  'content_opt_in',
  'Agentic30',
  'Founder Replay',
  'text',
  'sha256-legacy',
  'legacy raw content',
  'legacy redacted content',
  'redacted',
  'searchable_local',
  1,
  1,
  0,
  1,
  '2026-06-28T10:18:01.000Z',
  NULL
);
PRAGMA user_version = 7;
`);

    assert.equal(migrateRecorderDatabase(db), RECORDER_STORE_SCHEMA_VERSION);
    const columns = db.pragma("table_info(clipboard_events)").map((column) => column.name);
    for (const column of ["captured_at", "policy_mode", "source_app_name", "source_window_title", "content_size"]) {
      assert.equal(columns.includes(column), true);
    }
    for (const legacyColumn of ["occurred_at", "capture_mode", "app_name", "window_title"]) {
      assert.equal(columns.includes(legacyColumn), false);
    }
    const row = db.prepare("SELECT * FROM clipboard_events WHERE id = ?").get("clipboard-legacy");
    assert.equal(row.captured_at, "2026-06-28T10:18:00.000Z");
    assert.equal(row.policy_mode, "content_opt_in");
    assert.equal(row.source_app_name, "Agentic30");
    assert.equal(row.source_window_title, "Founder Replay");
    assert.equal(row.content_size, "legacy raw content".length);
    assert.equal(row.content_text, "legacy raw content");
  } finally {
    db.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("RecorderStore runMaintenance checkpoints WAL and can vacuum explicitly", async () => {
  const { root, store } = await makeStore();
  try {
    const result = store.runMaintenance({ checkpointMode: "TRUNCATE", vacuum: true });
    assert.equal(result.status, "ok");
    assert.equal(result.walCheckpoint.mode, "TRUNCATE");
    assert.equal(Array.isArray(result.walCheckpoint.rows), true);
    assert.equal(result.vacuumRun, true);
    assert.throws(
      () => store.runMaintenance({ checkpointMode: "DELETE" }),
      (error) => error.code === "ERR_RECORDER_STORE_INVALID_CHECKPOINT_MODE",
    );
  } finally {
    store.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("RecorderStore FTS indexes only redacted safe-for-search frame text and purges deleted rows", async () => {
  const { store } = await makeStore();
  try {
    insertFrameFixture(store);

    const redactedResults = store.search("founder");
    assert.equal(redactedResults.length, 1);
    assert.equal(redactedResults[0].source_type, "frame");
    assert.equal(redactedResults[0].source_id, "frame-1");

    assert.deepEqual(store.search("customer@example.com"), []);

    store.softDeleteRecord("frames", "frame-1", {
      deletedAt: "2026-06-27T10:30:00.000Z",
    });
    assert.deepEqual(store.search("founder"), []);
  } finally {
    store.close();
  }
});

test("RecorderStore sanitizes frame browser and document metadata labels before FTS writes", async () => {
  const { store } = await makeStore();
  try {
    insertFrameFixture(store, {
      id: "frame-url-label",
      snapshot_asset_id: "asset-frame-url-label",
      browser_url: "https://agentic30.example/private/path?token=secret#fragment",
      browser_domain: "https://user:pass@agentic30.example/private/path?token=secret#fragment",
      browser_url_search_label: "https://user:pass@agentic30.example/private/path?token=secret#fragment customer@example.com api_key=secret",
      document_path: "/Users/october/private/Customer Folder/secret-roadmap.md",
      document_path_search_label: "/Users/october/private/Customer Folder/secret-roadmap.md?token=secret",
      redacted_text: "redacted url label proof",
    });

    let row = store.getRecord("frames", "frame-url-label");
    assert.equal(row.browser_domain, "agentic30.example");
    assert.equal(row.browser_url_search_label, "agentic30.example");
    assert.equal(row.document_path_search_label, "md document");
    assert.equal(store.search("agentic30.example").some((result) => result.source_id === "frame-url-label"), true);
    assert.equal(store.search("document").some((result) => result.source_id === "frame-url-label"), true);
    for (const unsafe of [
      "Users",
      "october",
      "private",
      "Customer",
      "Folder",
      "secret-roadmap",
      "token",
      "secret",
      "fragment",
      "customer@example.com",
      "api_key",
    ]) {
      assert.equal(store.search(unsafe).some((result) => result.source_id === "frame-url-label"), false);
    }

    store.updateRecord("frames", "frame-url-label", {
      browser_url_search_label: "https://agentic30.example/another/path?password=leak#frag",
      document_path_search_label: "/Users/october/private/acme-notes.pdf",
      safe_for_search: 1,
    });
    row = store.getRecord("frames", "frame-url-label");
    assert.equal(row.browser_url_search_label, "agentic30.example");
    assert.equal(row.document_path_search_label, "pdf document");
    assert.equal(store.search("another").some((result) => result.source_id === "frame-url-label"), false);
    assert.equal(store.search("password").some((result) => result.source_id === "frame-url-label"), false);
    assert.equal(store.search("acme-notes").some((result) => result.source_id === "frame-url-label"), false);
    assert.equal(store.search("pdf").some((result) => result.source_id === "frame-url-label"), true);
  } finally {
    store.close();
  }
});

test("RecorderStore FTS follows safe_for_search updates for memory and product events", async () => {
  const { store } = await makeStore();
  try {
    store.insertRecord("media_assets", {
      id: "asset-audio-1",
      asset_type: "audio_m4a",
      relative_path: "media/audio/audio-1.m4a",
      sha256: "sha256-audio-1",
      byte_size: 256,
      encrypted: 1,
      workspace_id: "workspace-1",
      project_id: "project-1",
      created_at: "2026-06-27T10:30:00.000Z",
    });
    store.insertRecord("audio_chunks", {
      id: "audio-1",
      workspace_id: "workspace-1",
      project_id: "project-1",
      started_at: "2026-06-27T10:30:00.000Z",
      ended_at: "2026-06-27T10:35:00.000Z",
      source: "meeting_audio",
      audio_asset_id: "asset-audio-1",
      transcript_status: "local_complete",
      redaction_status: "redacted",
      privacy_state: "searchable_local",
      created_at: "2026-06-27T10:36:00.000Z",
    });
    store.insertRecord("transcript_segments", {
      id: "segment-1",
      audio_chunk_id: "audio-1",
      workspace_id: "workspace-1",
      project_id: "project-1",
      started_at: "2026-06-27T10:31:00.000Z",
      ended_at: "2026-06-27T10:32:00.000Z",
      speaker_label: "customer",
      text: "raw transcript text",
      redacted_text: "customer described activation friction",
      redaction_status: "redacted",
      privacy_state: "searchable_local",
      safe_for_search: 1,
      safe_for_memory: 1,
      created_at: "2026-06-27T10:36:30.000Z",
    });
    assert.equal(store.search("activation").some((row) => row.source_type === "transcript"), true);
    store.softDeleteRecord("transcript_segments", "segment-1", {
      deletedAt: "2026-06-27T10:40:00.000Z",
    });
    assert.equal(store.search("activation").some((row) => row.source_type === "transcript"), false);

    store.insertRecord("memory_items", {
      id: "memory-1",
      workspace_id: "workspace-1",
      project_id: "project-1",
      memory_type: "daily_summary",
      title: "Day Memory Review",
      summary: "Evidence Inbox candidate found from redacted local search",
      source_ids_json: JSON.stringify(["frame-1"]),
      time_range_json: JSON.stringify({ start: "2026-06-27T09:00:00.000Z", end: "2026-06-27T18:00:00.000Z" }),
      redaction_status: "redacted",
      privacy_state: "memory_safe",
      safe_for_search: 0,
      safe_for_memory: 1,
      safe_for_export: 0,
      confidence: "medium",
      created_by: "daily-founder-memory",
      created_at: "2026-06-27T18:00:00.000Z",
    });
    assert.deepEqual(store.search("Evidence"), []);
    store.updateRecord("memory_items", "memory-1", { safe_for_search: 1 });
    assert.equal(store.search("Evidence")[0].source_type, "memory");

    store.insertRecord("product_events", {
      id: "event-1",
      workspace_id: "workspace-1",
      project_id: "project-1",
      event_type: "customer_interview",
      occurred_at: "2026-06-27T11:00:00.000Z",
      title: "Customer interview evidence",
      summary: "Founder asked one named customer for proof",
      source_ids_json: JSON.stringify(["memory-1"]),
      safe_for_search: 1,
      safe_for_memory: 1,
      safe_for_export: 0,
      verification_status: "unverified",
      proof_ledger_event_id: null,
      confidence: "medium",
      created_by: "evidence-inbox-builder",
      created_at: "2026-06-27T11:05:00.000Z",
    });
    assert.equal(store.search("customer").some((row) => row.source_type === "product_event"), true);
    store.updateRecord("product_events", "event-1", { safe_for_search: 0 });
    assert.equal(store.search("customer").some((row) => row.source_type === "product_event"), false);
  } finally {
    store.close();
  }
});
