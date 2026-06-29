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
    consentGrantId: "consent-test-1",
    rawAudioIndicatorState: "visible_indicator_active",
    localTranscriberName: "agentic30-local-transcriber-test",
    localTranscriberVersion: "0.0.0-test",
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
        speakerLabelProvenance: "local_transcriber",
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

function encryptionEnvelope(sha256) {
  const normalizedSha256 = String(sha256).startsWith("sha256:") ? sha256 : `sha256:${sha256}`;
  return {
    algorithm: "aes-256-gcm",
    keyId: "test-media-key",
    nonce: Buffer.alloc(12, 3).toString("base64"),
    tag: Buffer.alloc(16, 4).toString("base64"),
    ciphertextSha256: normalizedSha256,
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
    assert.equal(result.audioChunk.consentGrantId, "consent-test-1");
    assert.equal(result.audioChunk.rawAudioIndicatorState, "visible_indicator_active");
    assert.equal(result.audioChunk.localTranscriberName, "agentic30-local-transcriber-test");
    assert.equal(result.audioChunk.localTranscriberVersion, "0.0.0-test");
    assert.equal(result.transcriptSegments[0].redactedText, "founder described activation friction");
    assert.equal(result.transcriptSegments[0].transcriptStatus, "local_complete");
    assert.equal(result.transcriptSegments[0].speakerLabelProvenance, "local_transcriber");
    assert.equal(result.transcriptSegments[0].rawTranscriptExposed, false);
    assert.equal(result.proofAcceptedByAudioChunk, false);
    assert.equal(result.proofLedgerWriteAllowed, false);
    assert.doesNotMatch(JSON.stringify(result), /raw transcript|customer@example.com|token=secret|relative_path|media\/audio|a30_recorder_|token_hash/);

    const audioRow = store.getRecord("audio_chunks", "audio-1");
    assert.equal(audioRow.audio_asset_id, "asset-audio-1");
    assert.equal(audioRow.consent_grant_id, "consent-test-1");
    assert.equal(audioRow.raw_audio_indicator_state, "visible_indicator_active");
    assert.equal(audioRow.local_transcriber_name, "agentic30-local-transcriber-test");
    assert.equal(audioRow.local_transcriber_version, "0.0.0-test");
    assert.equal(audioRow.transcription_terminal_state, null);
    const segmentRow = store.getRecord("transcript_segments", "segment-1");
    assert.equal(segmentRow.text, "raw transcript says customer@example.com and token=secret");
    assert.equal(segmentRow.redacted_text, "founder described activation friction");
    assert.equal(segmentRow.transcript_status, "local_complete");
    assert.equal(segmentRow.speaker_label_provenance, "local_transcriber");
    assert.equal(store.search("activation").some((row) => row.source_type === "transcript"), true);
    assert.deepEqual(store.search("customer@example.com"), []);
  } finally {
    store.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("recordAudioChunk derives search-safe redaction for local transcript segments", async () => {
  const { root, store } = await makeStore();
  try {
    const fakeOpenAIToken = `sk-proj-${"abcdefghijklmnopqrstuvwxyz123456"}`;
    const result = recordAudioChunk(store, audioChunk({
      id: "audio-derived-redaction",
      audioAsset: {
        id: "asset-audio-derived-redaction",
        relativePath: "media/audio/2026-06-28/audio-derived-redaction.m4a",
        sha256: "1".repeat(64),
        byteSize: 2048,
        encrypted: false,
      },
      transcriptSegments: [
        {
          id: "segment-derived-redaction",
          startedAt: "2026-06-28T14:01:10.000Z",
          endedAt: "2026-06-28T14:01:50.000Z",
          text: `activation friction from founder@example.com using ${fakeOpenAIToken} and https://example.com/path?token=abc`,
          redactionStatus: "not_redacted",
          privacyState: "raw_local",
          safeForSearch: false,
          safeForMemory: false,
        },
      ],
    }), {
      controlState: readyControlState(),
      now: new Date("2026-06-28T14:04:20.000Z"),
    });

    const segment = result.transcriptSegments[0];
    assert.equal(segment.redactionStatus, "redacted");
    assert.equal(segment.safeForSearch, true);
    assert.equal(segment.safeForMemory, true);
    assert.match(segment.redactedText, /activation friction/);
    assert.match(segment.redactedText, /‹redacted:email›/);
    assert.match(segment.redactedText, /‹redacted:openai-token›/);
    assert.match(segment.redactedText, /‹redacted:url›/);
    assert.equal(segment.rawTranscriptExposed, false);
    assert.doesNotMatch(JSON.stringify(result), /founder@example\.com|sk-proj-|example\.com\/path|relative_path|media\/audio/);

    const segmentRow = store.getRecord("transcript_segments", "segment-derived-redaction");
    assert.match(segmentRow.text, /founder@example\.com/);
    assert.match(segmentRow.text, /sk-proj-/);
    assert.match(segmentRow.redacted_text, /‹redacted:email›/);
    assert.equal(segmentRow.safe_for_search, 1);
    assert.equal(segmentRow.safe_for_memory, 1);
    assert.equal(store.search("activation", { sourceTypes: ["transcript"] }).some((row) => row.source_id === "segment-derived-redaction"), true);
    assert.deepEqual(store.search("founder@example.com", { sourceTypes: ["transcript"] }), []);
    assert.deepEqual(store.search("sk-proj", { sourceTypes: ["transcript"] }), []);
  } finally {
    store.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("recordAudioChunk records local transcription unavailable without segments or search indexing", async () => {
  const { root, store } = await makeStore();
  try {
    const result = recordAudioChunk(store, audioChunk({
      id: "audio-transcription-unavailable",
      transcriptStatus: "local_transcription_unavailable",
      localTranscriberName: undefined,
      localTranscriberVersion: undefined,
      transcriptionTerminalState: "local_unavailable_no_cloud_fallback",
      redactionStatus: "not_redacted",
      transcriptSegments: [],
      audioAsset: {
        id: "asset-audio-transcription-unavailable",
        relativePath: "media/audio/2026-06-28/audio-transcription-unavailable.m4a",
        sha256: "f".repeat(64),
        byteSize: 512,
        encrypted: false,
      },
    }), {
      controlState: readyControlState(),
      now: new Date("2026-06-28T14:04:30.000Z"),
    });

    assert.equal(result.audioChunk.id, "audio-transcription-unavailable");
    assert.equal(result.audioChunk.transcriptStatus, "local_transcription_unavailable");
    assert.equal(result.audioChunk.transcriptionTerminalState, "local_unavailable_no_cloud_fallback");
    assert.equal(result.audioChunk.localTranscriberName, null);
    assert.equal(result.transcriptSegments.length, 0);
    assert.equal(result.proofAcceptedByAudioChunk, false);
    assert.equal(result.proofLedgerWriteAllowed, false);
    assert.doesNotMatch(JSON.stringify(result), /raw transcript|customer@example.com|token=secret|relative_path|media\/audio/);
    const audioRow = store.getRecord("audio_chunks", "audio-transcription-unavailable");
    assert.equal(audioRow.transcript_status, "local_transcription_unavailable");
    assert.equal(audioRow.transcription_terminal_state, "local_unavailable_no_cloud_fallback");
    assert.equal(audioRow.local_transcriber_name, null);
    assert.deepEqual(store.search("activation", { sourceTypes: ["transcript"] }), []);
  } finally {
    store.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("recordAudioChunk fails closed when local transcript provenance is missing", async () => {
  const { root, store } = await makeStore();
  try {
    assert.throws(
      () => recordAudioChunk(store, audioChunk({
        id: "audio-missing-local-transcriber",
        localTranscriberName: "",
        localTranscriberVersion: "",
      }), {
        controlState: readyControlState(),
        now: new Date("2026-06-28T14:04:40.000Z"),
      }),
      (error) => error instanceof RecorderAudioError
        && error.code === "ERR_RECORDER_AUDIO_LOCAL_TRANSCRIBER_REQUIRED",
    );
    assert.equal(store.getRecord("audio_chunks", "audio-missing-local-transcriber"), null);

    assert.throws(
      () => recordAudioChunk(store, audioChunk({
        id: "audio-missing-speaker-provenance",
        transcriptSegments: [
          {
            id: "segment-missing-speaker-provenance",
            startedAt: "2026-06-28T14:01:10.000Z",
            endedAt: "2026-06-28T14:01:50.000Z",
            speakerLabel: "founder",
            text: "raw segment",
            redactedText: "redacted segment",
            redactionStatus: "redacted",
            safeForSearch: true,
          },
        ],
      }), {
        controlState: readyControlState(),
        now: new Date("2026-06-28T14:04:45.000Z"),
      }),
      (error) => error instanceof RecorderAudioError
        && error.code === "ERR_RECORDER_AUDIO_SPEAKER_LABEL_PROVENANCE_REQUIRED",
    );
    assert.equal(store.getRecord("audio_chunks", "audio-missing-speaker-provenance"), null);

    assert.throws(
      () => recordAudioChunk(store, audioChunk({
        id: "audio-meeting-no-notice",
        source: "meeting_audio",
      }), {
        controlState: readyControlState(),
        now: new Date("2026-06-28T14:04:50.000Z"),
      }),
      (error) => error instanceof RecorderAudioError
        && error.code === "ERR_RECORDER_AUDIO_MEETING_NOTICE_REQUIRED",
    );
    assert.equal(store.getRecord("audio_chunks", "audio-meeting-no-notice"), null);
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
        id: "audio-unsafe-search-redaction",
        transcriptSegments: [
          {
            id: "segment-unsafe-search-redaction",
            text: "raw segment",
            redactedText: "raw segment",
            redactionStatus: "not_redacted_confirmed",
            safeForSearch: true,
          },
        ],
      }), {
        controlState: readyControlState(),
        now: new Date("2026-06-28T14:08:00.000Z"),
      }),
      (error) => error instanceof RecorderAudioError
        && error.code === "ERR_RECORDER_AUDIO_TRANSCRIPT_UNSAFE_SEARCH_REDACTION",
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

test("recordAudioChunk requires encryption for background raw audio capture", async () => {
  const { root, store } = await makeStore();
  try {
    assert.throws(
      () => recordAudioChunk(store, audioChunk({
        id: "audio-background",
        captureMode: "background",
        audioAsset: {
          id: "asset-audio-background",
          relativePath: "media/audio/2026-06-28/audio-background.m4a",
          sha256: "b".repeat(64),
          byteSize: 1024,
          encrypted: false,
        },
      }), {
        controlState: readyControlState(),
        now: new Date("2026-06-28T14:12:00.000Z"),
      }),
      (error) => error instanceof RecorderAudioError
        && error.code === "ERR_RECORDER_MEDIA_ENCRYPTION_REQUIRED",
    );
    assert.equal(store.getRecord("audio_chunks", "audio-background"), null);

    assert.throws(
      () => recordAudioChunk(store, audioChunk({
        id: "audio-background-missing-envelope",
        captureMode: "background",
        audioAsset: {
          id: "asset-audio-background-missing-envelope",
          relativePath: "media/audio/2026-06-28/audio-background-missing-envelope.m4a",
          sha256: "d".repeat(64),
          byteSize: 1024,
          encrypted: true,
        },
      }), {
        controlState: readyControlState(),
        now: new Date("2026-06-28T14:12:30.000Z"),
      }),
      (error) => error instanceof RecorderAudioError
        && error.code === "ERR_RECORDER_MEDIA_ENCRYPTION_ENVELOPE_REQUIRED",
    );
    assert.equal(store.getRecord("audio_chunks", "audio-background-missing-envelope"), null);

    const result = recordAudioChunk(store, audioChunk({
      id: "audio-background-encrypted",
      captureMode: "background",
      audioAsset: {
        id: "asset-audio-background-encrypted",
        relativePath: "media/audio/2026-06-28/audio-background-encrypted.m4a",
        sha256: "c".repeat(64),
        byteSize: 1024,
        encrypted: true,
        encryption: encryptionEnvelope("c".repeat(64)),
      },
    }), {
      controlState: readyControlState(),
      now: new Date("2026-06-28T14:13:00.000Z"),
    });
    assert.equal(result.mediaAsset.encrypted, true);
    const media = store.getRecord("media_assets", "asset-audio-background-encrypted");
    assert.equal(media.encryption_key_id, "test-media-key");
    assert.equal(media.encryption_alg, "aes-256-gcm");
    assert.equal(media.encryption_tag, Buffer.alloc(16, 4).toString("base64"));
  } finally {
    store.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});
