import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  RecorderLiveVerifyError,
  assertLiveRecorderAudioChunkRow,
  assertLiveRecorderFrameRow,
  isLiveCapturedAudioChunkRow,
  isLiveCapturedFrameRow,
  isSeedFixtureAudioChunkRow,
  isSeedFixtureFrameRow,
  summarizeLiveRecorderCapture,
} from "../sidecar/recorder-live-verify.mjs";
import { RecorderStore } from "../sidecar/recorder-store.mjs";

async function makeStore() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-recorder-live-verify-"));
  const store = new RecorderStore({ appSupportRoot: path.join(root, "app-support") }).open();
  return { root, store };
}

const LIVE_FRAME_ID = "frame-11111111-2222-3333-4444-555555555555";
const LIVE_FRAME_ASSET_ID = "asset-aaaaaaaa-bbbb-cccc-dddd-ffffffffffff";
const EVENT_FRAME_ID = "frame-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const EVENT_FRAME_ASSET_ID = "asset-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const INPUT_FRAME_ID = "frame-99999999-8888-7777-6666-555555555555";
const INPUT_FRAME_ASSET_ID = "asset-99999999-8888-7777-6666-555555555555";

function insertFrameRow(store, overrides = {}) {
  const row = {
    id: LIVE_FRAME_ID,
    schema_version: "agentic30.recorder.frame.v1",
    workspace_id: "workspace-1",
    project_id: "project-1",
    captured_at: "2026-06-27T09:30:00.000Z",
    monitor_id: "main",
    capture_trigger: "manual_swift_screencapturekit",
    app_name: "Codex",
    window_title: "Founder Memory OS",
    snapshot_asset_id: LIVE_FRAME_ASSET_ID,
    snapshot_sha256: "sha256:snapshot",
    content_hash: "sha256:frame-content",
    text_source: "accessibility_only",
    accessibility_text: "raw private text",
    redacted_text: "customer reply activation friction",
    redaction_status: "redacted",
    privacy_state: "search_safe",
    data_class: "screen",
    safe_for_search: 1,
    safe_for_memory: 1,
    safe_for_export: 0,
    created_at: "2026-06-27T09:30:01.000Z",
    ...overrides,
  };
  if (!store.getRecord("media_assets", row.snapshot_asset_id)) {
    store.insertRecord("media_assets", {
      id: row.snapshot_asset_id,
      asset_type: "frame_jpeg",
      relative_path: `media/frames/${row.id}.jpg`,
      sha256: row.snapshot_sha256,
      byte_size: 128,
      encrypted: 0,
      workspace_id: row.workspace_id,
      project_id: row.project_id,
      created_at: row.created_at,
    });
  }
  store.insertRecord("frames", row);
  return row;
}

function insertAudioChunkRow(store, overrides = {}) {
  const row = {
    id: "audio-11111111-2222-3333-4444-555555555555",
    workspace_id: "workspace-1",
    project_id: "project-1",
    started_at: "2026-06-27T09:30:00.000Z",
    ended_at: "2026-06-27T09:30:05.000Z",
    source: "microphone",
    audio_asset_id: "asset-11111111-2222-3333-4444-555555555555",
    transcript_status: "local_transcription_unavailable",
    consent_grant_id: "recorder-consent-2026-06-27t09-00-00-000z",
    visible_notice_id: null,
    raw_audio_indicator_state: "visible_indicator_active",
    local_transcriber_name: null,
    local_transcriber_version: null,
    transcription_terminal_state: "local_unavailable_no_cloud_fallback",
    redaction_status: "not_redacted",
    privacy_state: "raw_local",
    created_at: "2026-06-27T09:30:06.000Z",
    ...overrides,
  };
  if (!store.getRecord("media_assets", row.audio_asset_id)) {
    store.insertRecord("media_assets", {
      id: row.audio_asset_id,
      asset_type: "audio_m4a",
      relative_path: `media/audio/${row.id}.m4a.enc`,
      sha256: "sha256:audio",
      byte_size: 128,
      encrypted: 1,
      workspace_id: row.workspace_id,
      project_id: row.project_id,
      created_at: row.created_at,
    });
  }
  store.insertRecord("audio_chunks", row);
  return row;
}

test("isSeedFixtureFrameRow flags the UI seed markers, not live rows", () => {
  assert.equal(isSeedFixtureFrameRow({ id: "ui-frame-1" }), true);
  assert.equal(isSeedFixtureFrameRow({ snapshot_asset_id: "ui-asset-frame-1" }), true);
  assert.equal(isSeedFixtureFrameRow({ capture_trigger: "ui_test_seed" }), true);
  assert.equal(isSeedFixtureFrameRow({ id: "frame-live-fixture", snapshot_asset_id: "asset-live-fixture" }), true);
  assert.equal(
    isSeedFixtureFrameRow({ id: LIVE_FRAME_ID, capture_trigger: "manual_swift_screencapturekit", snapshot_asset_id: LIVE_FRAME_ASSET_ID }),
    false,
  );
});

test("isLiveCapturedFrameRow requires Swift live id/asset shape, a real collector trigger, and non-deleted state", () => {
  const live = { id: LIVE_FRAME_ID, capture_trigger: "auto_swift_screencapturekit_interval", snapshot_asset_id: LIVE_FRAME_ASSET_ID };
  assert.equal(isLiveCapturedFrameRow(live), true);
  assert.equal(
    isLiveCapturedFrameRow({
      id: EVENT_FRAME_ID,
      capture_trigger: "auto_swift_event_tap_mouse_down",
      snapshot_asset_id: EVENT_FRAME_ASSET_ID,
    }),
    true,
  );
  assert.equal(
    isLiveCapturedFrameRow({
      id: INPUT_FRAME_ID,
      capture_trigger: "auto_swift_input_monitor_activity",
      snapshot_asset_id: INPUT_FRAME_ASSET_ID,
    }),
    true,
  );
  // Seeded → not live.
  assert.equal(isLiveCapturedFrameRow({ id: "ui-frame-1", capture_trigger: "ui_test_seed", snapshot_asset_id: "ui-asset-frame-1" }), false);
  assert.equal(isLiveCapturedFrameRow({ id: "frame-live-fixture", capture_trigger: "auto_swift_screencapturekit_interval", snapshot_asset_id: "asset-live-fixture" }), false);
  // Non-Swift id/asset shapes → not live.
  assert.equal(isLiveCapturedFrameRow({ id: "frame-abc", capture_trigger: "auto_swift_screencapturekit_interval", snapshot_asset_id: LIVE_FRAME_ASSET_ID }), false);
  assert.equal(isLiveCapturedFrameRow({ id: LIVE_FRAME_ID, capture_trigger: "auto_swift_screencapturekit_interval", snapshot_asset_id: "asset-abc" }), false);
  // A non-collector trigger (e.g. a test's made-up trigger) → not live.
  assert.equal(isLiveCapturedFrameRow({ id: LIVE_FRAME_ID, capture_trigger: "app_switch", snapshot_asset_id: LIVE_FRAME_ASSET_ID }), false);
  // Deleted → not live.
  assert.equal(isLiveCapturedFrameRow({ ...live, deleted_at: "2026-06-27T10:00:00.000Z" }), false);
  // Missing/seed asset → not live.
  assert.equal(isLiveCapturedFrameRow({ id: LIVE_FRAME_ID, capture_trigger: "auto_swift_screencapturekit_interval", snapshot_asset_id: "" }), false);
});

test("isLiveCapturedAudioChunkRow requires Swift live id/asset shape, consent, indicator, source, and non-deleted state", () => {
  const live = {
    id: "audio-11111111-2222-3333-4444-555555555555",
    audio_asset_id: "asset-11111111-2222-3333-4444-555555555555",
    source: "microphone",
    consent_grant_id: "recorder-consent-2026-06-27t09-00-00-000z",
    raw_audio_indicator_state: "visible_indicator_active",
  };
  assert.equal(isLiveCapturedAudioChunkRow(live), true);
  assert.equal(isSeedFixtureAudioChunkRow({ id: "audio-live-fixture", audio_asset_id: "asset-audio-live-fixture" }), true);
  assert.equal(isLiveCapturedAudioChunkRow({ ...live, id: "audio-live-fixture" }), false);
  assert.equal(isLiveCapturedAudioChunkRow({ ...live, audio_asset_id: "asset-audio-live-fixture" }), false);
  assert.equal(isLiveCapturedAudioChunkRow({ ...live, source: "meeting_audio" }), false);
  assert.equal(isLiveCapturedAudioChunkRow({ ...live, consent_grant_id: "consent-live-fixture" }), false);
  assert.equal(isLiveCapturedAudioChunkRow({ ...live, raw_audio_indicator_state: "unknown" }), false);
  assert.equal(isLiveCapturedAudioChunkRow({ ...live, deleted_at: "2026-06-27T10:00:00.000Z" }), false);
});

test("assertLiveRecorderAudioChunkRow accepts a live audio chunk and fails closed on seed/missing", async () => {
  const { store } = await makeStore();
  try {
    insertAudioChunkRow(store);
    insertAudioChunkRow(store, {
      id: "audio-live-fixture",
      audio_asset_id: "asset-audio-live-fixture",
      consent_grant_id: "consent-live-fixture",
    });

    const liveRow = assertLiveRecorderAudioChunkRow(store, "audio-11111111-2222-3333-4444-555555555555");
    assert.equal(liveRow.id, "audio-11111111-2222-3333-4444-555555555555");

    assert.throws(
      () => assertLiveRecorderAudioChunkRow(store, "audio-live-fixture"),
      (error) => error instanceof RecorderLiveVerifyError
        && error.code === "ERR_RECORDER_LIVE_VERIFY_AUDIO_IS_SEED_FIXTURE",
    );
    assert.throws(
      () => assertLiveRecorderAudioChunkRow(store, "audio-missing"),
      (error) => error.code === "ERR_RECORDER_LIVE_VERIFY_AUDIO_NOT_FOUND",
    );
  } finally {
    store.close();
  }
});

test("assertLiveRecorderFrameRow accepts a live row and fails closed on seed/missing", async () => {
  const { store } = await makeStore();
  try {
    insertFrameRow(store);
    insertFrameRow(store, {
      id: EVENT_FRAME_ID,
      capture_trigger: "auto_swift_event_tap_mouse_down",
      snapshot_asset_id: EVENT_FRAME_ASSET_ID,
      snapshot_sha256: "sha256:snapshot-event",
      content_hash: "sha256:frame-content-event",
    });
    insertFrameRow(store, {
      id: "ui-frame-1",
      capture_trigger: "ui_test_seed",
      snapshot_asset_id: "ui-asset-frame-1",
      snapshot_sha256: "sha256:seed",
      content_hash: "sha256:seed-frame-content",
    });

    const liveRow = assertLiveRecorderFrameRow(store, LIVE_FRAME_ID);
    assert.equal(liveRow.id, LIVE_FRAME_ID);
    const eventTapRow = assertLiveRecorderFrameRow(store, EVENT_FRAME_ID);
    assert.equal(eventTapRow.capture_trigger, "auto_swift_event_tap_mouse_down");

    assert.throws(
      () => assertLiveRecorderFrameRow(store, "ui-frame-1"),
      (error) => error instanceof RecorderLiveVerifyError
        && error.code === "ERR_RECORDER_LIVE_VERIFY_FRAME_IS_SEED_FIXTURE",
    );
    assert.throws(
      () => assertLiveRecorderFrameRow(store, "frame-missing"),
      (error) => error.code === "ERR_RECORDER_LIVE_VERIFY_FRAME_NOT_FOUND",
    );
  } finally {
    store.close();
  }
});

test("summarizeLiveRecorderCapture separates live from seeded frames", async () => {
  const { store } = await makeStore();
  try {
    insertFrameRow(store);
    insertFrameRow(store, {
      id: EVENT_FRAME_ID,
      capture_trigger: "auto_swift_event_tap_mouse_down",
      snapshot_asset_id: EVENT_FRAME_ASSET_ID,
      snapshot_sha256: "sha256:snapshot-event",
      content_hash: "sha256:frame-content-event",
    });
    insertFrameRow(store, {
      id: "ui-frame-1",
      capture_trigger: "ui_test_seed",
      snapshot_asset_id: "ui-asset-frame-1",
      snapshot_sha256: "sha256:seed",
      content_hash: "sha256:seed-frame-content",
    });

    const summary = summarizeLiveRecorderCapture(store);
    assert.equal(summary.liveFrameCount, 2);
    assert.equal(summary.liveSearchSafeFrameCount, 2);
    assert.equal(summary.seedFrameCount, 1);
    assert.equal(summary.hasLiveCapture, true);
    assert.deepEqual(summary.liveFrameIds, [LIVE_FRAME_ID, EVENT_FRAME_ID]);
    assert.equal(summary.proofBoundary.proofAcceptedByLiveVerify, false);
  } finally {
    store.close();
  }
});
