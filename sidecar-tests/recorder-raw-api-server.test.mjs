import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { issueRecorderApiToken } from "../sidecar/recorder-raw-api-auth.mjs";
import {
  RecorderRawApiServerError,
  createRecorderRawApiServer,
} from "../sidecar/recorder-raw-api-server.mjs";
import {
  RECORDER_STORE_SCHEMA_VERSION,
  RecorderStore,
} from "../sidecar/recorder-store.mjs";
import { persistBuiltInRecorderPipes } from "../sidecar/recorder-pipes.mjs";

async function makeContext() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-recorder-raw-api-server-"));
  const store = new RecorderStore({ appSupportRoot: root }).open();
  await insertFrameFixture(store);
  await insertAudioTranscriptFixture(store);
  insertClipboardFixture(store);
  insertMemoryFixture(store);
  return { root, store };
}

async function insertFrameFixture(store) {
  const mediaRelativePath = "media/frames/frame-1.jpg";
  const mediaPath = path.join(path.dirname(store.dbPath), ...mediaRelativePath.split("/"));
  await fs.mkdir(path.dirname(mediaPath), { recursive: true });
  await fs.writeFile(mediaPath, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  store.insertRecord("media_assets", {
    id: "asset-frame-1",
    asset_type: "frame_jpeg",
    relative_path: mediaRelativePath,
    sha256: "sha256-frame-1",
    byte_size: 4,
    encrypted: 1,
    workspace_id: "workspace-1",
    project_id: "project-1",
    created_at: "2026-06-28T10:00:00.000Z",
  });
  store.insertRecord("frames", {
    id: "frame-1",
    schema_version: RECORDER_STORE_SCHEMA_VERSION,
    workspace_id: "workspace-1",
    project_id: "project-1",
    captured_at: "2026-06-28T10:00:01.000Z",
    monitor_id: "main",
    capture_trigger: "typing_pause",
    app_name: "Codex",
    window_title: "Founder Memory OS",
    browser_url: "https://example.com/private?token=secret",
    browser_domain: "example.com",
    browser_url_normalized: "https://example.com/private?token=secret",
    document_path: "/Users/october/private/customer-notes.md",
    snapshot_asset_id: "asset-frame-1",
    snapshot_sha256: "sha256-frame-1",
    content_hash: "content-hash-1",
    simhash: "",
    text_source: "accessibility",
    accessibility_text: "raw customer@example.com secret token",
    ocr_text: "raw OCR token",
    redacted_text: "redacted activation friction",
    redaction_status: "redacted",
    privacy_state: "searchable_local",
    data_class: "frame",
    safe_for_search: 1,
    safe_for_memory: 1,
    safe_for_export: 0,
    created_at: "2026-06-28T10:00:02.000Z",
    deleted_at: null,
  });
}

async function insertAudioTranscriptFixture(store) {
  const mediaRelativePath = "media/audio/audio-1.m4a";
  const mediaPath = path.join(path.dirname(store.dbPath), ...mediaRelativePath.split("/"));
  await fs.mkdir(path.dirname(mediaPath), { recursive: true });
  await fs.writeFile(mediaPath, Buffer.from("local audio bytes"));
  store.insertRecord("media_assets", {
    id: "asset-audio-1",
    asset_type: "audio_m4a",
    relative_path: mediaRelativePath,
    sha256: "sha256-audio-1",
    byte_size: 17,
    encrypted: 1,
    workspace_id: "workspace-1",
    project_id: "project-1",
    created_at: "2026-06-28T10:10:00.000Z",
  });
  store.insertRecord("audio_chunks", {
    id: "audio-1",
    workspace_id: "workspace-1",
    project_id: "project-1",
    started_at: "2026-06-28T10:10:00.000Z",
    ended_at: "2026-06-28T10:15:00.000Z",
    source: "meeting_audio",
    audio_asset_id: "asset-audio-1",
    transcript_status: "local_complete",
    redaction_status: "redacted",
    privacy_state: "searchable_local",
    created_at: "2026-06-28T10:16:00.000Z",
  });
  store.insertRecord("transcript_segments", {
    id: "segment-1",
    audio_chunk_id: "audio-1",
    workspace_id: "workspace-1",
    project_id: "project-1",
    started_at: "2026-06-28T10:11:00.000Z",
    ended_at: "2026-06-28T10:12:00.000Z",
    speaker_label: "customer",
    text: "raw transcript customer@example.com secret phrase",
    redacted_text: "customer described activation friction",
    redaction_status: "redacted",
    privacy_state: "searchable_local",
    safe_for_search: 1,
    safe_for_memory: 1,
    created_at: "2026-06-28T10:16:30.000Z",
  });
}

function insertClipboardFixture(store) {
  store.insertRecord("clipboard_events", {
    id: "clipboard-1",
    workspace_id: "workspace-1",
    project_id: "project-1",
    occurred_at: "2026-06-28T10:18:00.000Z",
    event_kind: "copy",
    capture_mode: "content_opt_in",
    app_name: "Agentic30",
    window_title: "Founder Replay",
    content_type: "text",
    content_hash: "sha256-clipboard-1",
    content_text: "raw clipboard customer@example.com token=secret",
    redacted_text: "redacted clipboard activation ask",
    redaction_status: "redacted",
    privacy_state: "searchable_local",
    safe_for_search: 1,
    safe_for_memory: 1,
    safe_for_export: 0,
    content_captured: 1,
    created_at: "2026-06-28T10:18:01.000Z",
    deleted_at: null,
  });
}

function insertMemoryFixture(store) {
  store.insertRecord("memory_items", {
    id: "memory-1",
    workspace_id: "workspace-1",
    project_id: "project-1",
    memory_type: "daily_summary",
    title: "Day Memory Review",
    summary: "Redacted summary of activation friction and next action",
    source_ids_json: JSON.stringify([{ id: "frame-1", source_type: "frame" }, { id: "segment-1", source_type: "transcript" }]),
    time_range_json: JSON.stringify({
      started_at: "2026-06-28T10:00:00.000Z",
      ended_at: "2026-06-28T11:00:00.000Z",
    }),
    redaction_status: "redacted",
    privacy_state: "memory_safe",
    safe_for_search: 1,
    safe_for_memory: 1,
    safe_for_export: 0,
    confidence: "medium",
    created_by: "daily-founder-memory",
    created_at: "2026-06-28T11:00:00.000Z",
  });
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
}

function insertExportProductEventFixture(store) {
  store.insertRecord("product_events", {
    id: "event-export-1",
    workspace_id: "workspace-1",
    project_id: "project-1",
    event_type: "customer_interview",
    occurred_at: "2026-06-28T10:20:00.000Z",
    title: "Exported customer signal",
    summary: "Redacted customer signal about activation friction",
    source_ids_json: JSON.stringify([{ id: "memory-1", source_type: "memory" }]),
    safe_for_search: 1,
    safe_for_memory: 1,
    safe_for_export: 1,
    verification_status: "unverified",
    proof_ledger_event_id: null,
    confidence: "medium",
    created_by: "test",
    created_at: "2026-06-28T10:21:00.000Z",
  });
  store.insertRecord("product_events", {
    id: "event-unsafe-export",
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
  });
}

function insertExportTranscriptFilterFixtures(store) {
  store.insertRecord("transcript_segments", {
    id: "segment-unsafe-export",
    audio_chunk_id: "audio-1",
    workspace_id: "workspace-1",
    project_id: "project-1",
    started_at: "2026-06-28T10:12:00.000Z",
    ended_at: "2026-06-28T10:13:00.000Z",
    speaker_label: "customer",
    text: "raw unsafe transcript export customer@example.com",
    redacted_text: "unsafe transcript export customer@example.com",
    redaction_status: "raw",
    privacy_state: "searchable_local",
    safe_for_search: 1,
    safe_for_memory: 1,
    created_at: "2026-06-28T10:16:40.000Z",
  });
  store.insertRecord("media_assets", {
    id: "asset-audio-2",
    asset_type: "audio_m4a",
    relative_path: "media/audio/audio-2.m4a",
    sha256: "sha256-audio-2",
    byte_size: 17,
    encrypted: 1,
    workspace_id: "workspace-1",
    project_id: "project-1",
    created_at: "2026-06-28T10:30:00.000Z",
  });
  store.insertRecord("audio_chunks", {
    id: "audio-2",
    workspace_id: "workspace-1",
    project_id: "project-1",
    started_at: "2026-06-28T10:30:00.000Z",
    ended_at: "2026-06-28T10:35:00.000Z",
    source: "meeting_audio",
    audio_asset_id: "asset-audio-2",
    transcript_status: "local_transcription_unavailable",
    redaction_status: "redacted",
    privacy_state: "searchable_local",
    created_at: "2026-06-28T10:36:00.000Z",
  });
  store.insertRecord("transcript_segments", {
    id: "segment-unavailable-export",
    audio_chunk_id: "audio-2",
    workspace_id: "workspace-1",
    project_id: "project-1",
    started_at: "2026-06-28T10:31:00.000Z",
    ended_at: "2026-06-28T10:32:00.000Z",
    speaker_label: "customer",
    text: "raw unavailable transcript export customer@example.com",
    redacted_text: "unavailable transcript export",
    redaction_status: "redacted",
    privacy_state: "searchable_local",
    safe_for_search: 1,
    safe_for_memory: 1,
    created_at: "2026-06-28T10:36:30.000Z",
  });
}

function issueToken(store, scopes, tokenSuffix, overrides = {}) {
  return issueRecorderApiToken({
    store,
    clientId: `${tokenSuffix}-client`,
    clientName: `${tokenSuffix} client`,
    scopes,
    issuedBy: "test",
    ttlMs: 60_000,
    rawAdminConfirmed: scopes.includes("raw_admin"),
    now: new Date("2026-06-28T10:00:00.000Z"),
    tokenFactory: () => `a30_recorder_${tokenSuffix}_token`,
    ...overrides,
  });
}

async function jsonFetch(baseUrl, endpoint, token, extraHeaders = {}) {
  const response = await fetch(`${baseUrl}${endpoint}`, {
    headers: {
      Origin: "http://127.0.0.1:5138",
      Authorization: `Bearer ${token}`,
      "x-request-id": `request-${endpoint.replace(/[^a-z0-9]+/gi, "-")}`,
      ...extraHeaders,
    },
  });
  return { response, body: await response.json() };
}

async function jsonPost(baseUrl, endpoint, token, payload, extraHeaders = {}) {
  const response = await fetch(`${baseUrl}${endpoint}`, {
    method: "POST",
    headers: {
      Origin: "http://127.0.0.1:5138",
      Authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "x-request-id": `request-post-${endpoint.replace(/[^a-z0-9]+/gi, "-")}`,
      ...extraHeaders,
    },
    body: typeof payload === "string" ? payload : JSON.stringify(payload),
  });
  return { response, body: await response.json() };
}

test("createRecorderRawApiServer refuses non-loopback binds", async () => {
  const { store } = await makeContext();
  try {
    await assert.rejects(
      () => createRecorderRawApiServer({ store, host: "0.0.0.0" }),
      (error) => error instanceof RecorderRawApiServerError
        && error.code === "ERR_RECORDER_RAW_API_NON_LOOPBACK_HOST",
    );
  } finally {
    store.close();
  }
});

test("recorder raw API serves health, redacted search, and frame metadata with audit rows", async () => {
  const { store } = await makeContext();
  const searchToken = issueToken(store, ["search"], "search");
  const frameToken = issueToken(store, ["frame"], "frame");
  const api = await createRecorderRawApiServer({
    store,
    now: () => new Date("2026-06-28T10:00:30.000Z"),
  });
  try {
    const health = await jsonFetch(api.url, "/recorder/health", searchToken.token);
    assert.equal(health.response.status, 200);
    assert.equal(health.body.status, "ok");
    assert.equal(health.body.counts.frames, 1);
    assert.equal(health.body.proofBoundary.proofAcceptedByRawApi, false);

    const search = await jsonFetch(api.url, "/recorder/search?q=activation&workspaceId=workspace-1&sourceTypes=frame", searchToken.token);
    assert.equal(search.response.status, 200);
    assert.equal(search.body.resultCount, 1);
    assert.equal(search.body.results[0].sourceType, "frame");
    assert.equal(search.body.rawApi.proofAcceptedByRawApi, false);
    const searchJson = JSON.stringify(search.body);
    assert.doesNotMatch(searchJson, /customer@example\.com/);
    assert.doesNotMatch(searchJson, /secret token/);
    assert.doesNotMatch(searchJson, /private\/customer-notes/);
    assert.doesNotMatch(searchJson, /private\?token=secret/);
    assert.doesNotMatch(searchJson, /browser_url/);
    assert.doesNotMatch(searchJson, /document_path/);

    const frames = await jsonFetch(api.url, "/recorder/frames?workspaceId=workspace-1&includeDebugPaths=1", frameToken.token);
    assert.equal(frames.response.status, 200);
    assert.equal(frames.body.resultCount, 1);
    assert.equal(frames.body.frames[0].redactedText, "redacted activation friction");
    assert.equal(frames.body.frames[0].browserDomain, "example.com");
    const framesJson = JSON.stringify(frames.body);
    assert.doesNotMatch(framesJson, /customer@example\.com/);
    assert.doesNotMatch(framesJson, /mediaPath/);
    assert.doesNotMatch(framesJson, /media_path/);
    assert.doesNotMatch(framesJson, /browser_url/);
    assert.doesNotMatch(framesJson, /document_path/);

    const audits = store.listRecords("recorder_audit");
    assert.equal(audits.length, 3);
    assert.deepEqual(audits.map((row) => row.decision), ["accepted", "accepted", "accepted"]);
  } finally {
    await api.close();
    store.close();
  }
});

test("recorder raw API gates raw frame text/image and never exposes filesystem paths", async () => {
  const { store } = await makeContext();
  const frameToken = issueToken(store, ["frame"], "frame");
  const rawFrameToken = issueToken(store, ["raw_frame"], "raw-frame");
  const api = await createRecorderRawApiServer({
    store,
    now: () => new Date("2026-06-28T10:00:30.000Z"),
  });
  try {
    const denied = await jsonFetch(api.url, "/recorder/frames/frame-1/image", frameToken.token);
    assert.equal(denied.response.status, 403);
    assert.equal(denied.body.error.code, "ERR_RECORDER_RAW_API_PERMISSION_DENIED");

    const text = await jsonFetch(api.url, "/recorder/frames/frame-1/text", rawFrameToken.token);
    assert.equal(text.response.status, 200);
    assert.equal(text.body.accessibilityText, "raw customer@example.com secret token");
    assert.equal(text.body.proofBoundary.proofAcceptedByRawApi, false);

    const image = await fetch(`${api.url}/recorder/frames/frame-1/image`, {
      headers: {
        Origin: "http://127.0.0.1:5138",
        Authorization: `Bearer ${rawFrameToken.token}`,
        "x-request-id": "request-frame-image-ok",
      },
    });
    assert.equal(image.status, 200);
    assert.equal(image.headers.get("content-type"), "image/jpeg");
    assert.equal(image.headers.get("x-agentic30-recorder-media-path"), null);
    assert.deepEqual([...new Uint8Array(await image.arrayBuffer())], [0xff, 0xd8, 0xff, 0xd9]);

    const audits = store.listRecords("recorder_audit");
    assert.equal(audits.length, 3);
    assert.equal(audits[0].decision, "denied");
    assert.equal(audits[0].reason, "ERR_RECORDER_RAW_API_PERMISSION_DENIED");
    assert.equal(audits[1].decision, "accepted");
    assert.equal(audits[2].decision, "accepted");
  } finally {
    await api.close();
    store.close();
  }
});

test("recorder raw API serves audio, transcript, and memory DTOs without raw text or media paths", async () => {
  const { store } = await makeContext();
  const searchToken = issueToken(store, ["search"], "search");
  const audioToken = issueToken(store, ["audio"], "audio");
  const rawAudioToken = issueToken(store, ["raw_audio"], "raw-audio");
  const api = await createRecorderRawApiServer({
    store,
    now: () => new Date("2026-06-28T10:00:30.000Z"),
  });
  try {
    const memory = await jsonFetch(api.url, "/recorder/memory?workspaceId=workspace-1", searchToken.token);
    assert.equal(memory.response.status, 200);
    assert.equal(memory.body.resultCount, 1);
    assert.equal(memory.body.memory[0].id, "memory-1");
    assert.equal(memory.body.memory[0].summary, "Redacted summary of activation friction and next action");
    assert.equal(memory.body.proofBoundary.proofAcceptedByRawApi, false);
    const memoryJson = JSON.stringify(memory.body);
    assert.doesNotMatch(memoryJson, /memory-unsafe/);
    assert.doesNotMatch(memoryJson, /customer@example\.com/);
    assert.doesNotMatch(memoryJson, /raw unsafe memory/);

    const audio = await jsonFetch(api.url, "/recorder/audio?workspaceId=workspace-1", audioToken.token);
    assert.equal(audio.response.status, 200);
    assert.equal(audio.body.resultCount, 1);
    assert.equal(audio.body.audio[0].id, "audio-1");
    assert.equal(audio.body.audio[0].transcriptStatus, "local_complete");
    const audioJson = JSON.stringify(audio.body);
    assert.doesNotMatch(audioJson, /media\/audio/);
    assert.doesNotMatch(audioJson, /local audio bytes/);
    assert.doesNotMatch(audioJson, /relative_path/);

    const audioById = await jsonFetch(api.url, "/recorder/audio/audio-1", audioToken.token);
    assert.equal(audioById.response.status, 200);
    assert.equal(audioById.body.audio.id, "audio-1");
    assert.equal(audioById.body.audio.mediaSha256, "sha256-audio-1");

    const deniedAudioMedia = await jsonFetch(api.url, "/recorder/audio/audio-1/media", audioToken.token);
    assert.equal(deniedAudioMedia.response.status, 403);
    assert.equal(deniedAudioMedia.body.error.code, "ERR_RECORDER_RAW_API_PERMISSION_DENIED");

    const rawAudio = await fetch(`${api.url}/recorder/audio/audio-1/media`, {
      headers: {
        Origin: "http://127.0.0.1:5138",
        Authorization: `Bearer ${rawAudioToken.token}`,
        "x-request-id": "request-raw-audio-ok",
      },
    });
    assert.equal(rawAudio.status, 200);
    assert.equal(rawAudio.headers.get("content-type"), "audio/mp4");
    assert.equal(rawAudio.headers.get("x-agentic30-recorder-media-path"), null);
    assert.equal(Buffer.from(await rawAudio.arrayBuffer()).toString("utf8"), "local audio bytes");

    const transcripts = await jsonFetch(api.url, "/recorder/transcripts?audioChunkId=audio-1", audioToken.token);
    assert.equal(transcripts.response.status, 200);
    assert.equal(transcripts.body.resultCount, 1);
    assert.equal(transcripts.body.transcripts[0].redactedText, "customer described activation friction");
    assert.equal(transcripts.body.transcripts[0].speakerLabel, "customer");
    const transcriptJson = JSON.stringify(transcripts.body);
    assert.doesNotMatch(transcriptJson, /raw transcript/);
    assert.doesNotMatch(transcriptJson, /secret phrase/);
    assert.doesNotMatch(transcriptJson, /customer@example\.com/);

    const deniedTranscripts = await jsonFetch(api.url, "/recorder/transcripts", searchToken.token);
    assert.equal(deniedTranscripts.response.status, 403);
    assert.equal(deniedTranscripts.body.error.code, "ERR_RECORDER_RAW_API_PERMISSION_DENIED");

    const audioMediaAudits = store.listRecords("recorder_audit")
      .filter((row) => row.endpoint === "/recorder/audio/audio-1/media");
    assert.equal(audioMediaAudits.length, 2);
    assert.deepEqual(audioMediaAudits.map((row) => row.decision).sort(), ["accepted", "denied"]);
  } finally {
    await api.close();
    store.close();
  }
});

test("recorder raw API gates Pipe listing, run, and cancel endpoints with pipe scope", async () => {
  const { store } = await makeContext();
  persistBuiltInRecorderPipes({
    store,
    workspaceId: "workspace-1",
    projectId: "project-1",
    now: new Date("2026-06-28T12:00:00.000Z"),
  });
  const tokenIssuedAt = new Date(2026, 5, 28, 18, 10, 30);
  const searchToken = issueToken(store, ["search"], "pipe-search", { now: tokenIssuedAt });
  const pipeToken = issueToken(store, ["pipe"], "pipe", { now: tokenIssuedAt });
  const api = await createRecorderRawApiServer({
    store,
    now: () => new Date(2026, 5, 28, 18, 11, 0),
  });
  try {
    const denied = await jsonFetch(api.url, "/recorder/pipes", searchToken.token);
    assert.equal(denied.response.status, 403);
    assert.equal(denied.body.error.code, "ERR_RECORDER_RAW_API_PERMISSION_DENIED");

    const pipes = await jsonFetch(api.url, "/recorder/pipes", pipeToken.token);
    assert.equal(pipes.response.status, 200);
    assert.equal(pipes.body.resultCount, 3);
    assert.equal(pipes.body.pipes[0].proofAcceptedByPipeDefinition, false);
    assert.equal(pipes.body.rawApi.proofAcceptedByRawApi, false);

    const missingRange = await jsonPost(api.url, "/recorder/pipes/daily-founder-memory/run", pipeToken.token, {
      workspaceId: "workspace-1",
      projectId: "project-1",
    });
    assert.equal(missingRange.response.status, 400);
    assert.equal(missingRange.body.error.code, "ERR_RECORDER_RAW_API_PIPE_RUN_TIME_RANGE_REQUIRED");

    const accepted = await jsonPost(api.url, "/recorder/pipes/daily-founder-memory/run", pipeToken.token, {
      workspaceId: "workspace-1",
      projectId: "project-1",
      startedAt: "2026-06-28T10:00:00.000Z",
      endedAt: "2026-06-28T12:00:00.000Z",
      runId: "raw-api-pipe-run",
      limit: 10,
    });
    assert.equal(accepted.response.status, 200);
    assert.equal(accepted.body.pipeRun.status, "succeeded");
    assert.equal(accepted.body.outputManifest.outputKind, "day_memory_review");
    assert.equal(accepted.body.outputManifest.proofBoundary.proofLedgerWriteAllowed, false);

    const runs = await jsonFetch(api.url, "/recorder/pipes/runs?pipeId=daily-founder-memory", pipeToken.token);
    assert.equal(runs.response.status, 200);
    assert.equal(runs.body.resultCount, 1);
    assert.equal(runs.body.runs[0].id, "raw-api-pipe-run");

    store.insertRecord("pipe_runs", {
      id: "raw-api-queued-run",
      pipe_id: "daily-founder-memory",
      workspace_id: "workspace-1",
      project_id: "project-1",
      trigger_reason: "scheduler",
      status: "queued",
      started_at: "2026-06-28T12:11:00.000Z",
      ended_at: null,
      input_manifest_json: JSON.stringify({ pipe_id: "daily-founder-memory", run_id: "raw-api-queued-run" }),
      output_manifest_json: null,
      audit_log_json: JSON.stringify([]),
      error_message: "",
    });
    const cancelled = await jsonPost(api.url, "/recorder/pipes/runs/raw-api-queued-run/cancel", pipeToken.token, {
      reason: "manual raw api test cancel",
    });
    assert.equal(cancelled.response.status, 200);
    assert.equal(cancelled.body.pipeRun.status, "cancelled");
    assert.equal(cancelled.body.outputManifest.outputKind, "pipe_cancelled");
    assert.equal(cancelled.body.outputManifest.items.complete, false);

    const terminalCancel = await jsonPost(api.url, "/recorder/pipes/runs/raw-api-pipe-run/cancel", pipeToken.token, {
      reason: "too late",
    });
    assert.equal(terminalCancel.response.status, 400);
    assert.equal(terminalCancel.body.error.code, "ERR_RECORDER_PIPE_RUN_TERMINAL");

    const schedulerTick = await jsonPost(api.url, "/recorder/pipes/scheduler/tick", pipeToken.token, {
      workspaceId: "workspace-1",
      projectId: "project-1",
      limit: 10,
      maxRuns: 3,
      autoRun: true,
    });
    assert.equal(schedulerTick.response.status, 200);
    assert.equal(schedulerTick.body.scheduler.queuedCount, 3);
    assert.equal(schedulerTick.body.scheduler.proofBoundary.proofLedgerWriteAllowed, false);
    assert.equal(schedulerTick.body.drainResult.executedCount, 3);
    assert.equal(schedulerTick.body.drainResult.failedCount, 0);
    assert.equal(schedulerTick.body.drainResult.executed.every((run) => run.status === "succeeded"), true);

    const json = JSON.stringify({
      pipes: pipes.body,
      accepted: accepted.body,
      runs: runs.body,
      cancelled: cancelled.body,
      schedulerTick: schedulerTick.body,
    });
    assert.doesNotMatch(json, /customer@example\.com/);
    assert.doesNotMatch(json, /secret token/);
    assert.doesNotMatch(json, /accessibility_text/);
    assert.doesNotMatch(json, /ocr_text/);
    assert.doesNotMatch(json, /browser_url/);
    assert.doesNotMatch(json, /document_path/);
    assert.doesNotMatch(json, /relative_path/);
    assert.doesNotMatch(json, /token_hash/);
    assert.doesNotMatch(json, /a30_recorder_pipe_token/);

    const audits = store.listRecords("recorder_audit")
      .filter((row) => row.endpoint.startsWith("/recorder/pipes"));
    assert.equal(audits.some((row) => row.decision === "denied" && row.reason === "ERR_RECORDER_RAW_API_PERMISSION_DENIED"), true);
    assert.equal(audits.some((row) => row.decision === "accepted" && row.access_level === "pipe"), true);
    assert.equal(audits.some((row) => row.endpoint === "/recorder/pipes/scheduler/tick" && row.decision === "accepted"), true);
  } finally {
    await api.close();
    store.close();
  }
});

test("recorder export endpoint returns a manifest-only safe_for_export view with audit rows", async () => {
  const { store } = await makeContext();
  store.updateRecord("frames", "frame-1", { safe_for_export: 1 });
  store.updateRecord("memory_items", "memory-1", { safe_for_export: 1 });
  insertExportProductEventFixture(store);
  insertExportTranscriptFilterFixtures(store);
  const exportToken = issueToken(store, ["export"], "export");
  const searchToken = issueToken(store, ["search"], "search");
  const api = await createRecorderRawApiServer({
    store,
    now: () => new Date("2026-06-28T10:00:30.000Z"),
  });
  try {
    const getDenied = await jsonFetch(api.url, "/recorder/export", exportToken.token);
    assert.equal(getDenied.response.status, 405);
    assert.equal(getDenied.body.error.code, "ERR_RECORDER_RAW_API_METHOD_NOT_ALLOWED");

    const scopeDenied = await jsonPost(api.url, "/recorder/export", searchToken.token, {
      dataClasses: ["frames"],
      workspaceId: "workspace-1",
    });
    assert.equal(scopeDenied.response.status, 403);
    assert.equal(scopeDenied.body.error.code, "ERR_RECORDER_RAW_API_PERMISSION_DENIED");

    const unsupported = await jsonPost(api.url, "/recorder/export", exportToken.token, {
      dataClasses: ["audio"],
      workspaceId: "workspace-1",
    });
    assert.equal(unsupported.response.status, 400);
    assert.equal(unsupported.body.error.code, "ERR_RECORDER_RAW_API_EXPORT_UNSUPPORTED_DATA_CLASS");

    const archiveMissingConfirmation = await jsonPost(api.url, "/recorder/export/archive", exportToken.token, {
      dataClasses: ["frames"],
      workspaceId: "workspace-1",
    });
    assert.equal(archiveMissingConfirmation.response.status, 400);
    assert.equal(archiveMissingConfirmation.body.error.code, "ERR_RECORDER_RAW_API_EXPORT_ARCHIVE_CONFIRMATION_REQUIRED");

    const archiveScopeDenied = await jsonPost(api.url, "/recorder/export/archive", searchToken.token, {
      dataClasses: ["frames"],
      workspaceId: "workspace-1",
      approvedByLocalUser: true,
    });
    assert.equal(archiveScopeDenied.response.status, 403);
    assert.equal(archiveScopeDenied.body.error.code, "ERR_RECORDER_RAW_API_PERMISSION_DENIED");

    const accepted = await jsonPost(api.url, "/recorder/export", exportToken.token, {
      dataClasses: ["frames", "transcripts", "memory", "product_events"],
      workspaceId: "workspace-1",
      projectId: "project-1",
      startedAt: "2026-06-28T10:00:00.000Z",
      endedAt: "2026-06-28T12:00:00.000Z",
      limit: 10,
      reason: "manual test export",
    });
    assert.equal(accepted.response.status, 200);
    assert.equal(accepted.body.rawApi.proofAcceptedByRawApi, false);
    assert.equal(accepted.body.proofBoundary.proofAcceptedByRawApi, false);
    assert.equal(accepted.body.exportManifest.proofBoundary.proofAcceptedByExport, false);
    assert.equal(accepted.body.exportManifest.itemCount, 4);
    assert.deepEqual(
      accepted.body.exportManifest.items.map((item) => item.dataClass).sort(),
      ["frame", "memory", "product_event", "transcript"],
    );
    assert.equal(accepted.body.exportManifest.filters.reason, undefined);
    assert.equal(accepted.body.exportManifest.reason, "manual test export");

    const exportJson = JSON.stringify(accepted.body);
    assert.match(exportJson, /redacted activation friction/);
    assert.match(exportJson, /Redacted summary of activation friction/);
    assert.match(exportJson, /Redacted customer signal/);
    assert.match(exportJson, /customer described activation friction/);
    assert.doesNotMatch(exportJson, /customer@example\.com/);
    assert.doesNotMatch(exportJson, /secret token/);
    assert.doesNotMatch(exportJson, /raw OCR/);
    assert.doesNotMatch(exportJson, /raw transcript/);
    assert.doesNotMatch(exportJson, /unsafe transcript export/);
    assert.doesNotMatch(exportJson, /unavailable transcript export/);
    assert.doesNotMatch(exportJson, /raw unsafe/);
    assert.doesNotMatch(exportJson, /private\/customer-notes/);
    assert.doesNotMatch(exportJson, /private\?token=secret/);
    assert.doesNotMatch(exportJson, /browser_url/);
    assert.doesNotMatch(exportJson, /document_path/);
    assert.doesNotMatch(exportJson, /accessibility_text/);
    assert.doesNotMatch(exportJson, /ocr_text/);
    assert.doesNotMatch(exportJson, /media\/frames/);
    assert.doesNotMatch(exportJson, /media\/audio/);
    assert.doesNotMatch(exportJson, /relative_path/);
    assert.doesNotMatch(exportJson, /token_hash/);
    assert.doesNotMatch(exportJson, /a30_recorder_export_token/);

    const archive = await jsonPost(api.url, "/recorder/export/archive", exportToken.token, {
      dataClasses: ["transcripts", "memory"],
      workspaceId: "workspace-1",
      projectId: "project-1",
      startedAt: "2026-06-28T10:00:00.000Z",
      endedAt: "2026-06-28T12:00:00.000Z",
      limit: 10,
      reason: "manual archive export",
      approvedByLocalUser: true,
    });
    assert.equal(archive.response.status, 200);
    assert.equal(archive.body.rawApi.proofAcceptedByRawApi, false);
    assert.equal(archive.body.exportArchive.pathExposed, false);
    assert.equal(archive.body.exportArchive.localOnly, true);
    assert.equal(archive.body.exportArchive.proofAcceptedByArchive, false);
    assert.equal(archive.body.exportArchive.proofAcceptedByExport, false);
    assert.equal(archive.body.exportArchive.itemCount, 2);
    assert.deepEqual(archive.body.exportArchive.dataClasses, ["transcripts", "memory"]);
    assert.match(archive.body.exportArchive.sha256, /^sha256:[0-9a-f]{64}$/);
    const archiveJson = JSON.stringify(archive.body);
    assert.doesNotMatch(archiveJson, /exports/);
    assert.doesNotMatch(archiveJson, /recorder\.sqlite/);
    assert.doesNotMatch(archiveJson, /customer@example\.com/);
    assert.doesNotMatch(archiveJson, /raw transcript/);
    assert.doesNotMatch(archiveJson, /a30_recorder_export_token/);

    const exportDir = path.join(path.dirname(store.dbPath), "exports");
    const archiveFiles = await fs.readdir(exportDir);
    assert.equal(archiveFiles.length, 1);
    assert.match(archiveFiles[0], /^archive-.+\.json$/);
    const archiveFileJson = await fs.readFile(path.join(exportDir, archiveFiles[0]), "utf8");
    const archiveFile = JSON.parse(archiveFileJson);
    assert.equal(archiveFile.schema, "agentic30.recorder.export_archive.v1");
    assert.equal(archiveFile.pathExposed, false);
    assert.equal(archiveFile.exportManifest.itemCount, 2);
    assert.equal(archiveFile.exportManifest.proofBoundary.proofAcceptedByExport, false);
    assert.doesNotMatch(archiveFileJson, /customer@example\.com/);
    assert.doesNotMatch(archiveFileJson, /raw transcript/);
    assert.doesNotMatch(archiveFileJson, /media\/audio/);
    assert.doesNotMatch(archiveFileJson, /token_hash/);

    const audits = store.listRecords("recorder_audit")
      .filter((row) => row.endpoint === "/recorder/export");
    assert.equal(audits.length, 2);
    assert.deepEqual(audits.map((row) => row.decision).sort(), ["accepted", "denied"]);
    assert.equal(audits.some((row) => row.access_level === "export"), true);
    const archiveAudits = store.listRecords("recorder_audit")
      .filter((row) => row.endpoint === "/recorder/export/archive");
    assert.equal(archiveAudits.length, 2);
    assert.deepEqual(archiveAudits.map((row) => row.decision).sort(), ["accepted", "denied"]);
  } finally {
    await api.close();
    store.close();
  }
});

test("recorder audit endpoint requires raw_admin and self-audits", async () => {
  const { store } = await makeContext();
  const rawFrameToken = issueToken(store, ["raw_frame"], "raw-frame");
  const rawAdminToken = issueToken(store, ["raw_admin"], "raw-admin");
  const api = await createRecorderRawApiServer({
    store,
    now: () => new Date("2026-06-28T10:00:30.000Z"),
  });
  try {
    const denied = await jsonFetch(api.url, "/recorder/audit", rawFrameToken.token);
    assert.equal(denied.response.status, 403);
    assert.equal(denied.body.error.code, "ERR_RECORDER_RAW_API_PERMISSION_DENIED");

    const accepted = await jsonFetch(api.url, "/recorder/audit", rawAdminToken.token);
    assert.equal(accepted.response.status, 200);
    assert.equal(accepted.body.proofBoundary.proofAcceptedByRawApi, false);
    assert.equal(accepted.body.audit.some((row) => row.endpoint === "/recorder/audit" && row.decision === "accepted"), true);
    const json = JSON.stringify(accepted.body);
    assert.doesNotMatch(json, /token_hash/);
    assert.doesNotMatch(json, /a30_recorder_raw-admin_token/);
  } finally {
    await api.close();
    store.close();
  }
});

test("recorder SQL inspector reads only allowlisted redacted views and audits decisions", async () => {
  const { store } = await makeContext();
  const searchToken = issueToken(store, ["search"], "sql-search");
  const rawSqlToken = issueToken(store, ["raw_sql"], "raw-sql");
  const rawAdminSqlToken = issueToken(store, ["raw_sql", "raw_admin"], "raw-admin-sql");
  const api = await createRecorderRawApiServer({
    store,
    now: () => new Date("2026-06-28T10:00:30.000Z"),
  });
  try {
    const deniedScope = await jsonPost(api.url, "/recorder/sql/query", searchToken.token, {
      query: "SELECT id, redacted_text FROM recorder_sql_frames_redacted LIMIT 5",
    });
    assert.equal(deniedScope.response.status, 403);
    assert.equal(deniedScope.body.error.code, "ERR_RECORDER_RAW_API_PERMISSION_DENIED");

    const accepted = await jsonPost(api.url, "/recorder/sql/query", rawSqlToken.token, {
      query: "SELECT id, redacted_text, browser_domain FROM recorder_sql_frames_redacted WHERE workspace_id = 'workspace-1' LIMIT 5",
    });
    assert.equal(accepted.response.status, 200);
    assert.equal(accepted.body.sql.schema, "agentic30.recorder.raw_sql.v1");
    assert.equal(accepted.body.sql.rowCount, 1);
    assert.equal(accepted.body.sql.rows[0].id, "frame-1");
    assert.equal(accepted.body.sql.rows[0].redacted_text, "redacted activation friction");
    assert.equal(accepted.body.sql.pathExposed, false);
    assert.equal(accepted.body.sql.proofAcceptedByRawSql, false);
    assert.equal(accepted.body.sql.proofLedgerWriteAllowed, false);
    assert.equal(accepted.body.rawApi.proofAcceptedByRawApi, false);
    const acceptedJson = JSON.stringify(accepted.body);
    assert.doesNotMatch(acceptedJson, /customer@example\.com/);
    assert.doesNotMatch(acceptedJson, /secret token/);
    assert.doesNotMatch(acceptedJson, /private\/customer-notes/);
    assert.doesNotMatch(acceptedJson, /media\/frames/);
    assert.doesNotMatch(acceptedJson, /a30_recorder_raw-sql_token/);
    assert.doesNotMatch(acceptedJson, /token_hash/);

    const aggregate = await jsonPost(api.url, "/recorder/sql/query", rawSqlToken.token, {
      query: "SELECT count(*) AS frame_count FROM recorder_sql_frames_redacted",
    });
    assert.equal(aggregate.response.status, 200);
    assert.equal(aggregate.body.sql.rows[0].frame_count, 1);

    const cte = await jsonPost(api.url, "/recorder/sql/query", rawSqlToken.token, {
      query: "WITH recent AS (SELECT id, redacted_text FROM recorder_sql_frames_redacted WHERE workspace_id = 'workspace-1') SELECT id, redacted_text FROM recent LIMIT 1",
    });
    assert.equal(cte.response.status, 200);
    assert.equal(cte.body.sql.rows[0].id, "frame-1");
    assert.deepEqual(cte.body.sql.allowedViews, ["recorder_sql_frames_redacted"]);

    const clipboardRedacted = await jsonPost(api.url, "/recorder/sql/query", rawSqlToken.token, {
      query: "SELECT id, redacted_text, content_captured FROM recorder_sql_clipboard_redacted WHERE id = 'clipboard-1' LIMIT 1",
    });
    assert.equal(clipboardRedacted.response.status, 200);
    assert.equal(clipboardRedacted.body.sql.rows[0].redacted_text, "redacted clipboard activation ask");
    assert.equal(clipboardRedacted.body.sql.rows[0].content_captured, 1);
    assert.equal(clipboardRedacted.body.sql.pathExposed, false);
    assert.doesNotMatch(JSON.stringify(clipboardRedacted.body), /raw clipboard|customer@example\.com|token=secret|content_text|clipboard_text/);

    const rawViewWithoutAdmin = await jsonPost(api.url, "/recorder/sql/query", rawSqlToken.token, {
      query: "SELECT id FROM recorder_sql_frames_raw_admin LIMIT 1",
      includeRawColumns: true,
    });
    assert.equal(rawViewWithoutAdmin.response.status, 400);
    assert.equal(rawViewWithoutAdmin.body.error.code, "ERR_RECORDER_RAW_API_SQL_RAW_ADMIN_REQUIRED");

    const rawViewWithoutFlag = await jsonPost(api.url, "/recorder/sql/query", rawAdminSqlToken.token, {
      query: "SELECT id FROM recorder_sql_frames_raw_admin LIMIT 1",
    });
    assert.equal(rawViewWithoutFlag.response.status, 400);
    assert.equal(rawViewWithoutFlag.body.error.code, "ERR_RECORDER_RAW_API_SQL_RAW_ADMIN_REQUIRED");

    const rawAdmin = await jsonPost(api.url, "/recorder/sql/query", rawAdminSqlToken.token, {
      query: "SELECT id, accessibility_text, ocr_text, browser_url, document_path, media_relative_path FROM recorder_sql_frames_raw_admin WHERE id = 'frame-1' LIMIT 1",
      includeRawColumns: true,
    });
    assert.equal(rawAdmin.response.status, 200);
    assert.equal(rawAdmin.body.sql.pathExposed, true);
    assert.equal(rawAdmin.body.sql.includeRawColumns, true);
    assert.equal(rawAdmin.body.sql.rows[0].accessibility_text, "raw customer@example.com secret token");
    assert.equal(rawAdmin.body.sql.rows[0].ocr_text, "raw OCR token");
    assert.equal(rawAdmin.body.sql.rows[0].browser_url, "https://example.com/private?token=secret");
    assert.equal(rawAdmin.body.sql.rows[0].document_path, "/Users/october/private/customer-notes.md");
    assert.equal(rawAdmin.body.sql.rows[0].media_relative_path, "media/frames/frame-1.jpg");
    const rawAdminJson = JSON.stringify(rawAdmin.body);
    assert.doesNotMatch(rawAdminJson, /a30_recorder_raw-admin-sql_token/);
    assert.doesNotMatch(rawAdminJson, /token_hash/);

    const rawTranscript = await jsonPost(api.url, "/recorder/sql/query", rawAdminSqlToken.token, {
      query: "SELECT id, transcript_text, audio_relative_path FROM recorder_sql_transcripts_raw_admin WHERE id = 'segment-1' LIMIT 1",
      includeRawColumns: true,
    });
    assert.equal(rawTranscript.response.status, 200);
    assert.equal(rawTranscript.body.sql.rows[0].transcript_text, "raw transcript customer@example.com secret phrase");
    assert.equal(rawTranscript.body.sql.rows[0].audio_relative_path, "media/audio/audio-1.m4a");

    const rawClipboard = await jsonPost(api.url, "/recorder/sql/query", rawAdminSqlToken.token, {
      query: "SELECT id, clipboard_text FROM recorder_sql_clipboard_raw_admin WHERE id = 'clipboard-1' LIMIT 1",
      includeRawColumns: true,
    });
    assert.equal(rawClipboard.response.status, 200);
    assert.equal(rawClipboard.body.sql.rows[0].clipboard_text, "raw clipboard customer@example.com token=secret");
    assert.equal(rawClipboard.body.sql.includeRawColumns, true);

    const cteBaseBypass = await jsonPost(api.url, "/recorder/sql/query", rawSqlToken.token, {
      query: "WITH leaked AS (SELECT id FROM frames) SELECT id FROM leaked LIMIT 1",
    });
    assert.equal(cteBaseBypass.response.status, 400);
    assert.equal(cteBaseBypass.body.error.code, "ERR_RECORDER_RAW_API_SQL_BASE_TABLE_REJECTED");

    const clipboardBaseBypass = await jsonPost(api.url, "/recorder/sql/query", rawSqlToken.token, {
      query: "SELECT id FROM clipboard_events LIMIT 1",
    });
    assert.equal(clipboardBaseBypass.response.status, 400);
    assert.equal(clipboardBaseBypass.body.error.code, "ERR_RECORDER_RAW_API_SQL_BASE_TABLE_REJECTED");

    const rawCteWithoutFlag = await jsonPost(api.url, "/recorder/sql/query", rawAdminSqlToken.token, {
      query: "WITH raw_frames AS (SELECT id FROM recorder_sql_frames_raw_admin) SELECT id FROM raw_frames LIMIT 1",
    });
    assert.equal(rawCteWithoutFlag.response.status, 400);
    assert.equal(rawCteWithoutFlag.body.error.code, "ERR_RECORDER_RAW_API_SQL_RAW_ADMIN_REQUIRED");

    const timeoutTooLong = await jsonPost(api.url, "/recorder/sql/query", rawSqlToken.token, {
      query: "SELECT id FROM recorder_sql_frames_redacted LIMIT 1",
      timeoutMs: 5001,
    });
    assert.equal(timeoutTooLong.response.status, 408);
    assert.equal(timeoutTooLong.body.error.code, "ERR_RECORDER_RAW_API_SQL_TIMEOUT_TOO_LONG");

    const timedOut = await jsonPost(api.url, "/recorder/sql/query", rawSqlToken.token, {
      query: "SELECT id FROM recorder_sql_frames_redacted LIMIT 1",
      timeoutMs: 1,
    });
    assert.equal(timedOut.response.status, 408);
    assert.equal(timedOut.body.error.code, "ERR_RECORDER_RAW_API_SQL_TIMEOUT");
    assert.equal("sql" in timedOut.body, false);

    const baseTable = await jsonPost(api.url, "/recorder/sql/query", rawSqlToken.token, {
      query: "SELECT accessibility_text FROM frames LIMIT 1",
    });
    assert.equal(baseTable.response.status, 400);
    assert.equal(baseTable.body.error.code, "ERR_RECORDER_RAW_API_SQL_RAW_COLUMN_REJECTED");

    const noLimit = await jsonPost(api.url, "/recorder/sql/query", rawSqlToken.token, {
      query: "SELECT id FROM recorder_sql_frames_redacted",
    });
    assert.equal(noLimit.response.status, 400);
    assert.equal(noLimit.body.error.code, "ERR_RECORDER_RAW_API_SQL_LIMIT_REQUIRED");

    const mutation = await jsonPost(api.url, "/recorder/sql/query", rawSqlToken.token, {
      query: "DELETE FROM recorder_sql_frames_redacted WHERE id = 'frame-1'",
    });
    assert.equal(mutation.response.status, 400);
    assert.equal(mutation.body.error.code, "ERR_RECORDER_RAW_API_SQL_STATEMENT_REJECTED");

    const attachAttempt = await jsonPost(api.url, "/recorder/sql/query", rawSqlToken.token, {
      query: "SELECT id FROM recorder_sql_frames_redacted ATTACH DATABASE 'x' AS leaked LIMIT 1",
    });
    assert.equal(attachAttempt.response.status, 400);
    assert.equal(attachAttempt.body.error.code, "ERR_RECORDER_RAW_API_SQL_FORBIDDEN_TOKEN");

    const extensionAttempt = await jsonPost(api.url, "/recorder/sql/query", rawSqlToken.token, {
      query: "SELECT load_extension('x') FROM recorder_sql_frames_redacted LIMIT 1",
    });
    assert.equal(extensionAttempt.response.status, 400);
    assert.equal(extensionAttempt.body.error.code, "ERR_RECORDER_RAW_API_SQL_FORBIDDEN_TOKEN");

    const comments = await jsonPost(api.url, "/recorder/sql/query", rawSqlToken.token, {
      query: "SELECT id FROM recorder_sql_frames_redacted -- hide a second statement\nLIMIT 1",
    });
    assert.equal(comments.response.status, 400);
    assert.equal(comments.body.error.code, "ERR_RECORDER_RAW_API_SQL_COMMENT_REJECTED");

    const audits = store.listRecords("recorder_audit")
      .filter((row) => row.endpoint === "/recorder/sql/query");
    assert.equal(audits.some((row) => row.access_level === "raw_sql" && row.decision === "accepted"), true);
    assert.equal(audits.some((row) => row.access_level === "raw_sql" && row.decision === "denied"), true);
    const auditJson = JSON.stringify(audits);
    assert.doesNotMatch(auditJson, /a30_recorder_raw-sql_token/);
    assert.doesNotMatch(auditJson, /token_hash/);
  } finally {
    await api.close();
    store.close();
  }
});
