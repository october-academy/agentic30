import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { deleteRecorderFrameCapture } from "../sidecar/recorder-delete.mjs";
import { RecorderStore } from "../sidecar/recorder-store.mjs";

const execFileAsync = promisify(execFile);

const LIVE_FRAME_ID = "frame-11111111-2222-3333-4444-555555555555";
const LIVE_FRAME_ASSET_ID = "asset-aaaaaaaa-bbbb-cccc-dddd-ffffffffffff";

async function makeFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-live-recorder-verifier-"));
  const appSupportRoot = path.join(root, "app-support");
  const store = new RecorderStore({ appSupportRoot }).open();
  return { root, appSupportRoot, store };
}

async function writeRecorderMedia(appSupportRoot, relativePath, content) {
  const mediaPath = path.join(appSupportRoot, "recorder", relativePath);
  await fs.mkdir(path.dirname(mediaPath), { recursive: true });
  await fs.writeFile(mediaPath, content);
  return mediaPath;
}

async function insertLiveFrameFixture(store, appSupportRoot, {
  id = LIVE_FRAME_ID,
  assetId = LIVE_FRAME_ASSET_ID,
  trigger = "auto_swift_event_tap_mouse_down",
  redactedText = "Agentic30 founder replay captured activation evidence",
} = {}) {
  const relativePath = `media/frames/2026-07-01/${assetId}.jpg`;
  await writeRecorderMedia(appSupportRoot, relativePath, "jpeg bytes");
  store.insertRecord("media_assets", {
    id: assetId,
    asset_type: "frame_jpeg",
    relative_path: relativePath,
    sha256: "sha256-live-frame-fixture",
    byte_size: 10,
    encrypted: 1,
    workspace_id: "workspace-1",
    project_id: "project-1",
    created_at: "2000-01-01T08:00:00.000Z",
  });
  store.insertRecord("frames", {
    id,
    schema_version: "agentic30.recorder.frame.v1",
    workspace_id: "workspace-1",
    project_id: "project-1",
    captured_at: "2000-01-01T08:00:01.000Z",
    monitor_id: "main",
    capture_trigger: trigger,
    app_name: "Agentic30",
    window_title: "Founder Replay",
    snapshot_asset_id: assetId,
    snapshot_sha256: "sha256-live-frame-fixture",
    content_hash: "sha256-live-frame-content",
    text_source: "accessibility_only",
    accessibility_text: "raw private text",
    redacted_text: redactedText,
    redaction_status: "redacted",
    privacy_state: "searchable_local",
    data_class: "screen",
    safe_for_search: 1,
    safe_for_memory: 1,
    safe_for_export: 0,
    created_at: "2000-01-01T08:00:02.000Z",
  });
  return { id, assetId };
}

async function insertLiveAudioFixture(store, appSupportRoot, {
  id = "audio-11111111-2222-3333-4444-555555555555",
  assetId = "asset-11111111-2222-3333-4444-555555555555",
  consentGrantId = "recorder-consent-2026-07-01t08-00-00-000z",
} = {}) {
  const relativePath = `media/audio/2026-07-01/${assetId}.m4a`;
  await writeRecorderMedia(appSupportRoot, relativePath, "m4a bytes");
  store.insertRecord("media_assets", {
    id: assetId,
    asset_type: "audio_m4a",
    relative_path: relativePath,
    sha256: "sha256-live-audio-fixture",
    byte_size: 9,
    encrypted: 1,
    workspace_id: "workspace-1",
    project_id: "project-1",
    created_at: "2000-01-01T08:00:03.000Z",
  });
  store.insertRecord("audio_chunks", {
    id,
    workspace_id: "workspace-1",
    project_id: "project-1",
    started_at: "2000-01-01T08:00:04.000Z",
    ended_at: "2000-01-01T08:00:05.000Z",
    source: "microphone",
    audio_asset_id: assetId,
    transcript_status: "local_complete",
    consent_grant_id: consentGrantId,
    visible_notice_id: "notice-live",
    raw_audio_indicator_state: "visible_indicator_active",
    local_transcriber_name: "agentic30-local-transcriber-test",
    local_transcriber_version: "0.0.0-test",
    redaction_status: "redacted",
    privacy_state: "raw_local",
    created_at: "2000-01-01T08:00:06.000Z",
  });
  return { id, assetId };
}

function insertAcceptedAuditFixture(store, frameId, overrides = {}) {
  store.insertRecord("recorder_audit", {
    id: "audit-live-frame-read",
    request_id: "request-live-frame-read",
    actor_type: "local_operator",
    actor_id: "agentic30-live-recorder-verifier-test",
    workspace_id: "workspace-1",
    project_id: "project-1",
    endpoint: `/recorder/frames/${frameId}/text`,
    access_level: "raw_frame",
    source_ids_json: JSON.stringify([{ id: frameId, source_type: "frame" }]),
    decision: "accepted",
    reason: "fixture accepted raw-read audit",
    created_at: "2026-07-01T08:00:07.000Z",
    ...overrides,
  });
}

async function runVerifier(args) {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  return execFileAsync(process.execPath, ["scripts/verify-live-recorder-acceptance.mjs", ...args], {
    cwd: repoRoot,
    maxBuffer: 1024 * 1024,
  });
}

test("verify-live-recorder-acceptance accepts live frame/search/audio/audit and applies retention", async () => {
  const { root, appSupportRoot, store } = await makeFixture();
  try {
    const liveFrame = await insertLiveFrameFixture(store, appSupportRoot);
    const liveAudio = await insertLiveAudioFixture(store, appSupportRoot);
    insertAcceptedAuditFixture(store, liveFrame.id);
    store.close();

    const outputPath = path.join(root, "verifier.json");
    const { stdout } = await runVerifier([
      "--app-support", appSupportRoot,
      "--search-query", "Agentic30",
      "--frame-id", liveFrame.id,
      "--apply-retention",
      "--json-output", outputPath,
    ]);
    const evidence = JSON.parse(stdout);
    const writtenEvidence = JSON.parse(await fs.readFile(outputPath, "utf8"));

    assert.equal(evidence.schema, "agentic30.live_recorder_acceptance.v1");
    assert.equal(evidence.requestedFrameId, liveFrame.id);
    assert.equal(evidence.liveFrame.id, liveFrame.id);
    assert.equal(evidence.liveCaptureSummary.liveFrameCount, 1);
    assert.deepEqual(evidence.liveCaptureSummary.liveFrameIds, [liveFrame.id]);
    assert.equal(evidence.search.matchingResult.sourceId, liveFrame.id);
    assert.equal(evidence.search.proofAcceptedBySearch, false);
    assert.equal(evidence.audio.id, liveAudio.id);
    assert.equal(evidence.rawReadAudit.decision, "accepted");
    assert.equal(evidence.rawReadAudit.endpoint, `/recorder/frames/${liveFrame.id}/text`);
    assert.equal(evidence.rawReadAudit.accessLevel, "raw_frame");
    assert.deepEqual(evidence.rawReadAudit.sourceIds, [{ id: liveFrame.id, sourceType: "frame" }]);
    assert.equal(evidence.retention.status, "applied");
    assert.equal(evidence.retention.deletedFrameCount, 1);
    assert.equal(evidence.retention.deletedAudioChunkCount, 1);
    assert.equal(evidence.retention.deletedMediaCount, 2);
    assert.equal(evidence.proofAccepted, false);
    assert.equal(writtenEvidence.liveFrame.id, liveFrame.id);
  } finally {
    store.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("verify-live-recorder-acceptance rejects accepted non-raw-frame audit rows", async () => {
  const { root, appSupportRoot, store } = await makeFixture();
  try {
    const liveFrame = await insertLiveFrameFixture(store, appSupportRoot);
    await insertLiveAudioFixture(store, appSupportRoot);
    insertAcceptedAuditFixture(store, liveFrame.id, {
      id: "audit-summary-frame-read",
      endpoint: `/recorder/frames/${liveFrame.id}`,
      access_level: "frame",
    });
    store.close();

    await assert.rejects(
      runVerifier([
        "--app-support", appSupportRoot,
        "--search-query", "Agentic30",
        "--frame-id", liveFrame.id,
      ]),
      (error) => {
        assert.match(String(error.stderr || error.message), /No accepted raw-read audit row references live frame/);
        return true;
      },
    );
  } finally {
    store.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("verify-live-recorder-acceptance rejects raw-frame audits for a different endpoint frame id", async () => {
  const { root, appSupportRoot, store } = await makeFixture();
  try {
    const liveFrame = await insertLiveFrameFixture(store, appSupportRoot);
    await insertLiveAudioFixture(store, appSupportRoot);
    insertAcceptedAuditFixture(store, liveFrame.id, {
      id: "audit-different-endpoint-frame",
      endpoint: "/recorder/frames/frame-99999999-8888-7777-6666-555555555555/text",
    });
    store.close();

    await assert.rejects(
      runVerifier([
        "--app-support", appSupportRoot,
        "--search-query", "Agentic30",
        "--frame-id", liveFrame.id,
      ]),
      (error) => {
        assert.match(String(error.stderr || error.message), /No accepted raw-read audit row references live frame/);
        return true;
      },
    );
  } finally {
    store.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("verify-live-recorder-acceptance rejects seeded UI frame fixtures", async () => {
  const { root, appSupportRoot, store } = await makeFixture();
  try {
    await insertLiveFrameFixture(store, appSupportRoot, {
      id: "ui-frame-1",
      assetId: "ui-asset-frame-1",
      trigger: "ui_test_seed",
    });
    store.close();

    await assert.rejects(
      runVerifier([
        "--app-support", appSupportRoot,
        "--search-query", "Agentic30",
        "--frame-id", "ui-frame-1",
        "--allow-missing-audio",
        "--allow-missing-audit",
      ]),
      (error) => {
        assert.match(String(error.stderr || error.message), /ERR_RECORDER_LIVE_VERIFY_FRAME_IS_SEED_FIXTURE/);
        return true;
      },
    );
  } finally {
    store.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("verify-live-recorder-acceptance rejects synthetic non-UUID frame fixtures", async () => {
  const { root, appSupportRoot, store } = await makeFixture();
  try {
    await insertLiveFrameFixture(store, appSupportRoot, {
      id: "frame-live-fixture",
      assetId: "asset-live-fixture",
    });
    store.close();

    await assert.rejects(
      runVerifier([
        "--app-support", appSupportRoot,
        "--search-query", "Agentic30",
        "--frame-id", "frame-live-fixture",
        "--allow-missing-audio",
        "--allow-missing-audit",
      ]),
      (error) => {
        assert.match(String(error.stderr || error.message), /ERR_RECORDER_LIVE_VERIFY_FRAME_IS_SEED_FIXTURE/);
        return true;
      },
    );
  } finally {
    store.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("verify-live-recorder-acceptance rejects seeded audio fixtures for full audio acceptance", async () => {
  const { root, appSupportRoot, store } = await makeFixture();
  try {
    const liveFrame = await insertLiveFrameFixture(store, appSupportRoot);
    await insertLiveAudioFixture(store, appSupportRoot, {
      id: "audio-live-fixture",
      assetId: "asset-audio-live-fixture",
      consentGrantId: "consent-live-fixture",
    });
    insertAcceptedAuditFixture(store, liveFrame.id);
    store.close();

    await assert.rejects(
      runVerifier([
        "--app-support", appSupportRoot,
        "--search-query", "Agentic30",
        "--frame-id", liveFrame.id,
      ]),
      (error) => {
        assert.match(String(error.stderr || error.message), /ERR_RECORDER_LIVE_VERIFY_AUDIO_IS_SEED_FIXTURE/);
        return true;
      },
    );
  } finally {
    store.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("verify-live-recorder-acceptance verifies a deleted frame tombstone", async () => {
  const { root, appSupportRoot, store } = await makeFixture();
  try {
    const liveFrame = await insertLiveFrameFixture(store, appSupportRoot);
    await deleteRecorderFrameCapture(store, liveFrame.id, {
      now: new Date("2026-07-01T08:01:00.000Z"),
    });
    store.close();

    const outputPath = path.join(root, "deleted-verifier.json");
    const { stdout } = await runVerifier([
      "--app-support", appSupportRoot,
      "--search-query", "Agentic30",
      "--deleted-frame-id", liveFrame.id,
      "--json-output", outputPath,
    ]);
    const evidence = JSON.parse(stdout);
    const writtenEvidence = JSON.parse(await fs.readFile(outputPath, "utf8"));

    assert.equal(evidence.schema, "agentic30.live_recorder_delete_acceptance.v1");
    assert.equal(evidence.requestedDeletedFrameId, liveFrame.id);
    assert.equal(evidence.deletedFrame.id, liveFrame.id);
    assert.equal(evidence.deletedFrame.redactionStatus, "deleted");
    assert.equal(evidence.deletedFrame.privacyState, "deleted");
    assert.equal(evidence.deletedFrame.safeForSearch, false);
    assert.equal(evidence.deletedFrame.mediaAssetId, liveFrame.assetId);
    assert.equal(evidence.deletedFrame.mediaDeletedAt, "2026-07-01T08:01:00.000Z");
    assert.equal(evidence.deletedFrame.mediaByteSize, 0);
    assert.equal(evidence.deletedFrame.mediaExists, false);
    assert.equal(evidence.deletedFrame.searchResultCount, 0);
    assert.equal(evidence.proofAccepted, false);
    assert.equal(writtenEvidence.deletedFrame.id, liveFrame.id);
  } finally {
    store.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("verify-live-recorder-acceptance rejects deleted-frame checks before delete", async () => {
  const { root, appSupportRoot, store } = await makeFixture();
  try {
    const liveFrame = await insertLiveFrameFixture(store, appSupportRoot);
    store.close();

    await assert.rejects(
      runVerifier([
        "--app-support", appSupportRoot,
        "--search-query", "Agentic30",
        "--deleted-frame-id", liveFrame.id,
      ]),
      (error) => {
        assert.match(String(error.stderr || error.message), /Frame frame-11111111-2222-3333-4444-555555555555 is not deleted/);
        return true;
      },
    );
  } finally {
    store.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});
