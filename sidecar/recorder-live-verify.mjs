// Live-vs-seeded recorder capture discriminator.
//
// The decisive acceptance criterion for the recorder is a REAL captured row
// produced by the macOS collector under granted TCC — not the UI-test seed
// fixture (`seedFounderReplayDayMemoryCandidateFixture`). Today that distinction
// is only an implicit id/trigger convention split between the Swift collector
// (`frame-<uuid>` / `manual_swift_screencapturekit`) and the seed fixture
// (`ui-frame-1` / `ui_test_seed`). This module makes the contract explicit and
// testable so the GRANTED-TCC acceptance runbook — or any future sidecar test —
// cannot certify a seeded row as live.
//
// Pure over RecorderStore rows: no filesystem access, no proof effect. A live
// frame is recorder-derived and never proof by itself.

// Real macOS frame/event collectors stamp one of these capture triggers
// (agentic30/AgenticViewModel.swift). Seeded/manual-diagnostic rows do not.
const LIVE_CAPTURE_TRIGGER_PATTERN = /screencapturekit|event_tap|input_monitor/i;

// The UI seed fixture uses these deterministic markers.
const SEED_ID_PREFIX = "ui-";
const SEED_CAPTURE_TRIGGER = "ui_test_seed";
const SEED_FIXTURE_PATTERN = /fixture|ui_test_seed/i;
const LIVE_AUDIO_ID_PATTERN = /^audio-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LIVE_AUDIO_ASSET_ID_PATTERN = /^asset-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LIVE_AUDIO_SOURCES = new Set(["microphone", "system_audio"]);
const LIVE_AUDIO_INDICATOR_STATES = new Set(["visible_indicator_active"]);

function text(value) {
  return String(value ?? "").trim();
}

export function isSeedFixtureFrameRow(row = {}) {
  const id = text(row.id);
  const trigger = text(row.capture_trigger ?? row.captureTrigger);
  const assetId = text(row.snapshot_asset_id ?? row.snapshotAssetId);
  return (
    id.startsWith(SEED_ID_PREFIX) ||
    assetId.startsWith(SEED_ID_PREFIX) ||
    trigger === SEED_CAPTURE_TRIGGER
  );
}

export function isSeedFixtureAudioChunkRow(row = {}) {
  const id = text(row.id);
  const assetId = text(row.audio_asset_id ?? row.audioAssetId);
  const consentGrantId = text(row.consent_grant_id ?? row.consentGrantId);
  const visibleNoticeId = text(row.visible_notice_id ?? row.visibleNoticeId);
  return (
    id.startsWith(SEED_ID_PREFIX) ||
    assetId.startsWith(SEED_ID_PREFIX) ||
    SEED_FIXTURE_PATTERN.test(id) ||
    SEED_FIXTURE_PATTERN.test(assetId) ||
    SEED_FIXTURE_PATTERN.test(consentGrantId) ||
    SEED_FIXTURE_PATTERN.test(visibleNoticeId)
  );
}

// A frame row is "live" only when it is NOT the seed fixture, carries a real
// macOS-collector capture trigger, has a non-seed media asset id, and is not
// soft-deleted. Callers use this to prove a live-capture acceptance run
// produced a genuine row rather than reusing a fixture.
export function isLiveCapturedFrameRow(row = {}) {
  if (!row || typeof row !== "object") return false;
  if (isSeedFixtureFrameRow(row)) return false;
  if (text(row.deleted_at ?? row.deletedAt)) return false;
  const trigger = text(row.capture_trigger ?? row.captureTrigger);
  if (!LIVE_CAPTURE_TRIGGER_PATTERN.test(trigger)) return false;
  const assetId = text(row.snapshot_asset_id ?? row.snapshotAssetId);
  if (!assetId || assetId.startsWith(SEED_ID_PREFIX)) return false;
  return true;
}

export function isLiveCapturedAudioChunkRow(row = {}) {
  if (!row || typeof row !== "object") return false;
  if (isSeedFixtureAudioChunkRow(row)) return false;
  if (text(row.deleted_at ?? row.deletedAt)) return false;
  const id = text(row.id);
  if (!LIVE_AUDIO_ID_PATTERN.test(id)) return false;
  const assetId = text(row.audio_asset_id ?? row.audioAssetId);
  if (!LIVE_AUDIO_ASSET_ID_PATTERN.test(assetId)) return false;
  if (!LIVE_AUDIO_SOURCES.has(text(row.source))) return false;
  if (!text(row.consent_grant_id ?? row.consentGrantId).startsWith("recorder-consent-")) return false;
  const indicatorState = text(row.raw_audio_indicator_state ?? row.rawAudioIndicatorState);
  if (!LIVE_AUDIO_INDICATOR_STATES.has(indicatorState)) return false;
  return true;
}

export class RecorderLiveVerifyError extends Error {
  constructor(code, message, details = {}) {
    super(`${code}: ${message}`);
    this.name = "RecorderLiveVerifyError";
    this.code = code;
    this.details = details;
  }
}

// Throws unless the named frame exists in the store and is a live-captured row.
// Used by the acceptance runbook / gate to fail closed on a seeded or missing row.
export function assertLiveRecorderFrameRow(store, frameId) {
  if (!store || typeof store.getRecord !== "function") {
    throw new RecorderLiveVerifyError(
      "ERR_RECORDER_LIVE_VERIFY_STORE_REQUIRED",
      "assertLiveRecorderFrameRow requires a RecorderStore",
    );
  }
  const id = text(frameId);
  if (!id) {
    throw new RecorderLiveVerifyError(
      "ERR_RECORDER_LIVE_VERIFY_FRAME_ID_REQUIRED",
      "assertLiveRecorderFrameRow requires a frameId",
    );
  }
  const row = store.getRecord("frames", id);
  if (!row) {
    throw new RecorderLiveVerifyError(
      "ERR_RECORDER_LIVE_VERIFY_FRAME_NOT_FOUND",
      `frame not found: ${id}`,
      { frameId: id },
    );
  }
  if (isSeedFixtureFrameRow(row)) {
    throw new RecorderLiveVerifyError(
      "ERR_RECORDER_LIVE_VERIFY_FRAME_IS_SEED_FIXTURE",
      `frame ${id} is the UI seed fixture, not a live-captured row`,
      { frameId: id, captureTrigger: text(row.capture_trigger) },
    );
  }
  if (!isLiveCapturedFrameRow(row)) {
    throw new RecorderLiveVerifyError(
      "ERR_RECORDER_LIVE_VERIFY_FRAME_NOT_LIVE",
      `frame ${id} is not a live-captured row (trigger, asset, or deleted state)`,
      { frameId: id, captureTrigger: text(row.capture_trigger) },
    );
  }
  return row;
}

export function assertLiveRecorderAudioChunkRow(store, audioChunkId) {
  if (!store || typeof store.getRecord !== "function") {
    throw new RecorderLiveVerifyError(
      "ERR_RECORDER_LIVE_VERIFY_STORE_REQUIRED",
      "assertLiveRecorderAudioChunkRow requires a RecorderStore",
    );
  }
  const id = text(audioChunkId);
  if (!id) {
    throw new RecorderLiveVerifyError(
      "ERR_RECORDER_LIVE_VERIFY_AUDIO_ID_REQUIRED",
      "assertLiveRecorderAudioChunkRow requires an audioChunkId",
    );
  }
  const row = store.getRecord("audio_chunks", id);
  if (!row) {
    throw new RecorderLiveVerifyError(
      "ERR_RECORDER_LIVE_VERIFY_AUDIO_NOT_FOUND",
      `audio chunk not found: ${id}`,
      { audioChunkId: id },
    );
  }
  if (isSeedFixtureAudioChunkRow(row)) {
    throw new RecorderLiveVerifyError(
      "ERR_RECORDER_LIVE_VERIFY_AUDIO_IS_SEED_FIXTURE",
      `audio chunk ${id} is a seed fixture, not a live-captured row`,
      { audioChunkId: id, audioAssetId: text(row.audio_asset_id) },
    );
  }
  if (!isLiveCapturedAudioChunkRow(row)) {
    throw new RecorderLiveVerifyError(
      "ERR_RECORDER_LIVE_VERIFY_AUDIO_NOT_LIVE",
      `audio chunk ${id} is not a live-captured row (id, asset, source, consent, indicator, or deleted state)`,
      {
        audioChunkId: id,
        audioAssetId: text(row.audio_asset_id),
        source: text(row.source),
        rawAudioIndicatorState: text(row.raw_audio_indicator_state),
      },
    );
  }
  return row;
}

// Pure summary over the store's frame rows: counts live vs seeded vs deleted so
// the acceptance operator can run one call and capture its result as evidence.
// Filesystem/media presence and FTS/audit checks stay in the runbook's explicit
// SQL/`ls` steps (they need the resolved recorder root) and are intentionally
// out of this pure helper.
export function summarizeLiveRecorderCapture(store, { limit = 5000 } = {}) {
  if (!store || typeof store.listRecords !== "function") {
    throw new RecorderLiveVerifyError(
      "ERR_RECORDER_LIVE_VERIFY_STORE_REQUIRED",
      "summarizeLiveRecorderCapture requires a RecorderStore",
    );
  }
  const frames = store.listRecords("frames", { limit });
  let liveFrameCount = 0;
  let liveSearchSafeFrameCount = 0;
  let seedFrameCount = 0;
  let deletedFrameCount = 0;
  const liveFrameIds = [];
  for (const row of frames) {
    if (text(row.deleted_at ?? row.deletedAt)) {
      deletedFrameCount += 1;
      continue;
    }
    if (isSeedFixtureFrameRow(row)) {
      seedFrameCount += 1;
      continue;
    }
    if (isLiveCapturedFrameRow(row)) {
      liveFrameCount += 1;
      if (Number(row.safe_for_search) === 1) liveSearchSafeFrameCount += 1;
      if (liveFrameIds.length < 20) liveFrameIds.push(text(row.id));
    }
  }
  return {
    totalFrameCount: frames.length,
    liveFrameCount,
    liveSearchSafeFrameCount,
    seedFrameCount,
    deletedFrameCount,
    liveFrameIds,
    // The acceptance gate is met only when at least one live frame exists.
    hasLiveCapture: liveFrameCount > 0,
    proofBoundary: {
      // Recorder capture is input only; a live frame is never proof by itself.
      proofAcceptedByLiveVerify: false,
      proof_accepted_by_live_verify: false,
    },
  };
}
