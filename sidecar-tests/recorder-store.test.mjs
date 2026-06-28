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
  RecorderStore,
} from "../sidecar/recorder-store.mjs";

const require = createRequire(import.meta.url);

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
    text_source: "accessibility",
    accessibility_text: "raw private customer@example.com",
    ocr_text: "",
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
