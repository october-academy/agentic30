import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  RecorderAudioError,
  recordAudioChunk,
} from "../sidecar/recorder-audio.mjs";
import {
  makeDefaultRecorderControlState,
  transitionRecorderControlState,
} from "../sidecar/recorder-control-state.mjs";
import { RecorderStore } from "../sidecar/recorder-store.mjs";

async function makeStore() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-recorder-audio-"));
  const store = new RecorderStore({ appSupportRoot: path.join(root, "app-support") }).open();
  return { root, store };
}

function readyControlState({ microphone = true, systemAudio = false, grantMicrophone = true, grantSystemAudio = false } = {}) {
  const now = new Date("2026-06-28T14:00:00.000Z");
  let state = makeDefaultRecorderControlState({ now });
  state = transitionRecorderControlState(state, {
    type: "grant_consent",
    visibleIndicatorAcknowledged: true,
  }, { now });
  for (const permission of ["screenRecording", "accessibility"]) {
    state = transitionRecorderControlState(state, {
      type: "set_permission",
      permission,
      state: "granted",
    }, { now });
  }
  if (grantMicrophone) {
    state = transitionRecorderControlState(state, {
      type: "set_permission",
      permission: "microphone",
      state: "granted",
    }, { now });
  }
  if (grantSystemAudio) {
    state = transitionRecorderControlState(state, {
      type: "set_permission",
      permission: "systemAudio",
      state: "granted",
    }, { now });
  }
  state = transitionRecorderControlState(state, {
    type: "set_sensitive_capture",
    microphone,
    systemAudio,
  }, { now });
  return state;
}

function audioChunk(overrides = {}) {
  return {
    id: "audio-1",
    workspaceId: "workspace-1",
    projectId: "project-1",
    startedAt: "2026-06-28T14:01:00.000Z",
    endedAt: "2026-06-28T14:03:00.000Z",
    source: "microphone",
    transcriptStatus: "local_complete",
    redactionStatus: "redacted",
    privacyState: "raw_local",
    audioAsset: {
      id: "asset-audio-1",
      relativePath: "media/audio/2026-06-28/audio-1.m4a",
      sha256: "a".repeat(64),
      byteSize: 1024,
      encrypted: false,
    },
    transcriptSegments: [
      {
        id: "segment-1",
        startedAt: "2026-06-28T14:01:10.000Z",
        endedAt: "2026-06-28T14:01:50.000Z",
        speakerLabel: "founder",
        text: "raw transcript says customer@example.com and token=secret",
        redactedText: "founder described activation friction",
        redactionStatus: "redacted",
        privacyState: "searchable_local",
        safeForSearch: true,
        safeForMemory: true,
      },
    ],
    ...overrides,
  };
}

test("recordAudioChunk stores opted-in microphone audio and only indexes redacted transcript text", async () => {
  const { root, store } = await makeStore();
  try {
    const result = recordAudioChunk(store, audioChunk(), {
      controlState: readyControlState(),
      now: new Date("2026-06-28T14:04:00.000Z"),
    });

    assert.equal(result.audioChunk.id, "audio-1");
    assert.equal(result.audioChunk.source, "microphone");
    assert.equal(result.audioChunk.pathExposed, false);
    assert.equal(result.audioChunk.rawAudioExposed, false);
    assert.equal(result.transcriptSegments[0].redactedText, "founder described activation friction");
    assert.equal(result.transcriptSegments[0].rawTranscriptExposed, false);
    assert.equal(result.proofAcceptedByAudioChunk, false);
    assert.equal(result.proofLedgerWriteAllowed, false);
    assert.doesNotMatch(JSON.stringify(result), /raw transcript|customer@example.com|token=secret|relative_path|media\/audio|a30_recorder_|token_hash/);

    const audioRow = store.getRecord("audio_chunks", "audio-1");
    assert.equal(audioRow.audio_asset_id, "asset-audio-1");
    const segmentRow = store.getRecord("transcript_segments", "segment-1");
    assert.equal(segmentRow.text, "raw transcript says customer@example.com and token=secret");
    assert.equal(segmentRow.redacted_text, "founder described activation friction");
    assert.equal(store.search("activation").some((row) => row.source_type === "transcript"), true);
    assert.deepEqual(store.search("customer@example.com"), []);
  } finally {
    store.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("recordAudioChunk fails closed when audio capture is disabled or permission is missing", async () => {
  const { root, store } = await makeStore();
  try {
    assert.throws(
      () => recordAudioChunk(store, audioChunk({ id: "audio-disabled" }), {
        controlState: readyControlState({ microphone: false }),
        now: new Date("2026-06-28T14:05:00.000Z"),
      }),
      (error) => error instanceof RecorderAudioError
        && error.code === "ERR_RECORDER_AUDIO_CAPTURE_BLOCKED",
    );

    assert.throws(
      () => recordAudioChunk(store, audioChunk({ id: "audio-permission-missing" }), {
        controlState: readyControlState({ microphone: true, grantMicrophone: false }),
        now: new Date("2026-06-28T14:06:00.000Z"),
      }),
      (error) => error instanceof RecorderAudioError
        && error.code === "ERR_RECORDER_AUDIO_CAPTURE_BLOCKED",
    );
  } finally {
    store.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("recordAudioChunk rejects cloud transcription fallback and unsafe transcript search text", async () => {
  const { root, store } = await makeStore();
  try {
    assert.throws(
      () => recordAudioChunk(store, audioChunk({
        id: "audio-cloud",
        transcriptionProvider: "openai",
      }), {
        controlState: readyControlState(),
        now: new Date("2026-06-28T14:07:00.000Z"),
      }),
      (error) => error instanceof RecorderAudioError
        && error.code === "ERR_RECORDER_AUDIO_CLOUD_TRANSCRIPTION_BLOCKED",
    );

    assert.throws(
      () => recordAudioChunk(store, audioChunk({
        id: "audio-missing-redaction",
        transcriptSegments: [
          {
            id: "segment-missing-redaction",
            text: "raw segment",
            redactionStatus: "not_redacted",
            safeForSearch: true,
          },
        ],
      }), {
        controlState: readyControlState(),
        now: new Date("2026-06-28T14:08:00.000Z"),
      }),
      (error) => error instanceof RecorderAudioError
        && error.code === "ERR_RECORDER_AUDIO_TRANSCRIPT_SEARCH_REQUIRES_REDACTED_TEXT",
    );
  } finally {
    store.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("recordAudioChunk rejects unsafe media paths and duplicate ids before partial writes", async () => {
  const { root, store } = await makeStore();
  try {
    assert.throws(
      () => recordAudioChunk(store, audioChunk({
        id: "audio-unsafe-path",
        audioAsset: {
          id: "asset-unsafe-path",
          relativePath: "../audio.m4a",
          sha256: "b".repeat(64),
          byteSize: 64,
        },
      }), {
        controlState: readyControlState(),
        now: new Date("2026-06-28T14:09:00.000Z"),
      }),
      (error) => error instanceof RecorderAudioError
        && error.code === "ERR_RECORDER_AUDIO_UNSAFE_MEDIA_PATH",
    );
    assert.equal(store.getRecord("audio_chunks", "audio-unsafe-path"), null);

    recordAudioChunk(store, audioChunk({ id: "audio-duplicate" }), {
      controlState: readyControlState(),
      now: new Date("2026-06-28T14:10:00.000Z"),
    });
    assert.throws(
      () => recordAudioChunk(store, audioChunk({ id: "audio-duplicate" }), {
        controlState: readyControlState(),
        now: new Date("2026-06-28T14:11:00.000Z"),
      }),
      (error) => error instanceof RecorderAudioError
        && error.code === "ERR_RECORDER_AUDIO_DUPLICATE_MEDIA_ASSET",
    );
  } finally {
    store.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});
