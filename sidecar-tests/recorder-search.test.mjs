import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  RecorderSearchError,
  buildRecorderSearchResults,
} from "../sidecar/recorder-search.mjs";
import {
  RECORDER_STORE_SCHEMA_VERSION,
  RecorderStore,
} from "../sidecar/recorder-store.mjs";

async function makeStore() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-recorder-search-"));
  const store = new RecorderStore({ appSupportRoot: root }).open();
  return { root, store };
}

function insertFrame(store, overrides = {}) {
  const id = overrides.id || "frame-1";
  const assetId = overrides.snapshot_asset_id || `asset-${id}`;
  store.insertRecord("media_assets", {
    id: assetId,
    asset_type: "frame_jpeg",
    relative_path: `media/frames/${id}.jpg`,
    sha256: `sha256-${id}`,
    byte_size: 128,
    encrypted: 1,
    workspace_id: overrides.workspace_id || "workspace-1",
    project_id: overrides.project_id || "project-1",
    created_at: overrides.created_at || "2026-06-27T10:00:00.000Z",
  });
  store.insertRecord("frames", {
    id,
    schema_version: RECORDER_STORE_SCHEMA_VERSION,
    workspace_id: "workspace-1",
    project_id: "project-1",
    captured_at: "2026-06-27T10:00:01.000Z",
    monitor_id: "main",
    capture_trigger: "typing_pause",
    app_name: "Codex",
    window_title: "Founder Memory OS",
    browser_url: "https://example.com/private?token=secret",
    browser_domain: "example.com",
    browser_url_normalized: "https://example.com/private?token=secret",
    document_path: "/Users/october/private/customer-notes.md",
    snapshot_asset_id: assetId,
    snapshot_sha256: `sha256-${id}`,
    content_hash: `content-hash-${id}`,
    simhash: "",
    text_source: "ax_plus_ocr",
    text_provenance_root_cause: null,
    accessibility_text: "raw customer@example.com secret token",
    ocr_text: "raw OCR token",
    redacted_text: "redacted founder activation friction",
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

function insertTranscript(store, overrides = {}) {
  store.insertRecord("media_assets", {
    id: "asset-audio-1",
    asset_type: "audio_m4a",
    relative_path: "media/audio/audio-1.m4a",
    sha256: "sha256-audio-1",
    byte_size: 256,
    encrypted: 1,
    workspace_id: "workspace-1",
    project_id: "project-1",
    created_at: "2026-06-27T11:00:00.000Z",
  });
  store.insertRecord("audio_chunks", {
    id: "audio-1",
    workspace_id: "workspace-1",
    project_id: "project-1",
    started_at: "2026-06-27T11:00:00.000Z",
    ended_at: "2026-06-27T11:05:00.000Z",
    source: "meeting_audio",
    audio_asset_id: "asset-audio-1",
    transcript_status: "local_complete",
    redaction_status: "redacted",
    privacy_state: "searchable_local",
    created_at: "2026-06-27T11:06:00.000Z",
  });
  store.insertRecord("transcript_segments", {
    id: "segment-1",
    audio_chunk_id: "audio-1",
    workspace_id: "workspace-1",
    project_id: "project-1",
    started_at: "2026-06-27T11:01:00.000Z",
    ended_at: "2026-06-27T11:02:00.000Z",
    speaker_label: "customer",
    text: "raw transcript text customer@example.com",
    redacted_text: "customer described activation proof",
    redaction_status: "redacted",
    privacy_state: "searchable_local",
    safe_for_search: 1,
    safe_for_memory: 1,
    created_at: "2026-06-27T11:06:30.000Z",
    ...overrides,
  });
}

function insertMemory(store, overrides = {}) {
  store.insertRecord("memory_items", {
    id: "memory-1",
    workspace_id: "workspace-1",
    project_id: "project-1",
    memory_type: "daily_summary",
    title: "Day Memory Review",
    summary: "Activation evidence surfaced from redacted local search",
    source_ids_json: JSON.stringify(["frame-1"]),
    time_range_json: JSON.stringify({ start: "2026-06-27T09:00:00.000Z", end: "2026-06-27T18:00:00.000Z" }),
    redaction_status: "redacted",
    privacy_state: "memory_safe",
    safe_for_search: 1,
    safe_for_memory: 1,
    safe_for_export: 0,
    confidence: "medium",
    created_by: "daily-founder-memory",
    created_at: "2026-06-27T18:00:00.000Z",
    ...overrides,
  });
}

function insertProductEvent(store, overrides = {}) {
  store.insertRecord("product_events", {
    id: "event-1",
    workspace_id: "workspace-1",
    project_id: "project-1",
    event_type: "customer_interview",
    occurred_at: "2026-06-27T12:00:00.000Z",
    title: "Activation proof candidate",
    summary: "Founder asked one named customer for activation proof",
    source_ids_json: JSON.stringify(["memory-1"]),
    safe_for_search: 1,
    safe_for_memory: 1,
    safe_for_export: 0,
    verification_status: "unverified",
    proof_ledger_event_id: null,
    confidence: "medium",
    created_by: "evidence-inbox-builder",
    created_at: "2026-06-27T12:05:00.000Z",
    ...overrides,
  });
}

test("buildRecorderSearchResults returns scoped redacted results without raw URLs, paths, or captured text", async () => {
  const { store } = await makeStore();
  try {
    insertFrame(store);
    insertFrame(store, {
      id: "frame-other-workspace",
      snapshot_asset_id: "asset-other-workspace",
      workspace_id: "workspace-2",
      project_id: "project-2",
      redacted_text: "redacted founder activation friction",
    });

    const response = buildRecorderSearchResults({
      store,
      query: "activation",
      workspaceId: "workspace-1",
      projectId: "project-1",
      startedAt: "2026-06-27T00:00:00.000Z",
      endedAt: "2026-06-28T00:00:00.000Z",
      now: new Date("2026-06-27T12:00:00.000Z"),
    });

    assert.equal(response.schema, "agentic30.recorder.search.v1");
    assert.equal(response.generatedAt, "2026-06-27T12:00:00.000Z");
    assert.equal(response.resultCount, 1);
    assert.equal(response.results[0].sourceType, "frame");
    assert.equal(response.results[0].sourceId, "frame-1");
    assert.equal(response.results[0].metadata.browserDomain, "example.com");
    assert.equal(response.results[0].metadata.browserUrlSearchLabel, "example.com");
    assert.equal(response.results[0].metadata.documentPathSearchLabel, "md document");
    assert.equal(response.proofBoundary.proofAcceptedBySearch, false);

    const json = JSON.stringify(response);
    assert.doesNotMatch(json, /customer@example\.com/);
    assert.doesNotMatch(json, /secret token/);
    assert.doesNotMatch(json, /private\/customer-notes/);
    assert.doesNotMatch(json, /private\?token=secret/);
    assert.doesNotMatch(json, /"browser_url"\s*:/);
    assert.doesNotMatch(json, /"browserUrl"\s*:/);
    assert.doesNotMatch(json, /"document_path"\s*:/);
    assert.doesNotMatch(json, /"documentPath"\s*:/);
  } finally {
    store.close();
  }
});

test("buildRecorderSearchResults fails explicitly on corrupt safe-for-search rows", async () => {
  const { store } = await makeStore();
  try {
    insertProductEvent(store, {
      id: "event-unsafe-search",
      title: "Unsafe search candidate",
      summary: "unsafe search summary contains sk-1234567890abcdef",
      safe_for_search: 0,
      safe_for_memory: 0,
      safe_for_export: 0,
    });
    store.database().prepare(`
      UPDATE product_events
      SET safe_for_search = 1
      WHERE id = 'event-unsafe-search'
    `).run();

    assert.throws(
      () => buildRecorderSearchResults({
        store,
        query: "unsafe",
        sourceTypes: ["product_event"],
        limit: 10,
      }),
      (error) => error instanceof RecorderSearchError
        && error.code === "ERR_RECORDER_SEARCH_UNSAFE_PUBLIC_RECORD"
        && error.details.policyErrorCode === "ERR_RECORDER_REDACTION_POLICY_UNSAFE_TEXT"
        && error.details.sourceId === "event-unsafe-search",
    );
  } finally {
    store.close();
  }
});

test("buildRecorderSearchResults validates source type and time filters", async () => {
  const { store } = await makeStore();
  try {
    insertFrame(store);
    insertTranscript(store);
    insertMemory(store);
    insertProductEvent(store);

    const response = buildRecorderSearchResults({
      store,
      query: "activation",
      sourceTypes: ["memory", "product_event"],
      startedAt: "2026-06-27T11:30:00.000Z",
      endedAt: "2026-06-27T19:00:00.000Z",
      limit: 10,
    });

    assert.deepEqual(response.results.map((result) => result.sourceType), ["memory", "product_event"]);
    assert.equal(response.results.some((result) => result.sourceType === "frame"), false);
    assert.equal(response.results.some((result) => result.sourceType === "transcript"), false);

    assert.throws(
      () => buildRecorderSearchResults({ store, query: "activation", sourceTypes: ["raw_frame"] }),
      (error) => error instanceof RecorderSearchError
        && error.code === "ERR_RECORDER_SEARCH_UNKNOWN_SOURCE_TYPE",
    );
    assert.throws(
      () => buildRecorderSearchResults({ store, query: "activation", startedAt: "2026-06-27T00:00:00.000Z" }),
      (error) => error instanceof RecorderSearchError
        && error.code === "ERR_RECORDER_SEARCH_INCOMPLETE_TIME_RANGE",
    );
  } finally {
    store.close();
  }
});

test("buildRecorderSearchResults fails explicitly on missing query and reports empty scoped results", async () => {
  const { store } = await makeStore();
  try {
    insertFrame(store);
    assert.throws(
      () => buildRecorderSearchResults({ store, query: "   " }),
      (error) => error instanceof RecorderSearchError
        && error.code === "ERR_RECORDER_SEARCH_QUERY_REQUIRED",
    );

    const response = buildRecorderSearchResults({
      store,
      query: "activation",
      startedAt: "2026-06-28T00:00:00.000Z",
      endedAt: "2026-06-29T00:00:00.000Z",
    });

    assert.equal(response.resultCount, 0);
    assert.deepEqual(response.emptyStates.map((state) => state.id), ["no_redacted_search_results"]);
  } finally {
    store.close();
  }
});
