import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  RecorderControlStateError,
  applyRecorderControlAction,
  evaluateRecorderCaptureReadiness,
  evaluateRecorderExpandedMediaPolicy,
  loadRecorderControlState,
  makeDefaultRecorderControlState,
  resolveRecorderControlStatePath,
  transitionRecorderControlState,
} from "../sidecar/recorder-control-state.mjs";
import { RecorderIngestError, recordFrameCaptureEnvelope } from "../sidecar/recorder-ingest.mjs";
import { RecorderStore } from "../sidecar/recorder-store.mjs";

async function makeContext() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-recorder-control-"));
  const appSupportRoot = path.join(root, "app-support");
  const store = new RecorderStore({ appSupportRoot }).open();
  return { root, appSupportRoot, store };
}

function grantCorePermissions(state) {
  let next = state;
  next = transitionRecorderControlState(next, {
    type: "set_permission",
    permission: "screenRecording",
    state: "granted",
  });
  next = transitionRecorderControlState(next, {
    type: "set_permission",
    permission: "accessibility",
    state: "granted",
  });
  return next;
}

function envelope() {
  return {
    id: "frame-1",
    workspaceId: "workspace-1",
    projectId: "project-1",
    capturedAt: "2026-06-27T12:00:00.000Z",
    monitorId: "main",
    captureTrigger: "app_switch",
    appName: "Agentic30",
    windowTitle: "Day Memory Review",
    contentHash: "sha256:frame-content",
    privacyState: "search_safe",
    dataClass: "screen",
    safeForSearch: true,
    safeForMemory: true,
    safeForExport: false,
    snapshot: {
      id: "asset-1",
      relativePath: "media/frames/2026-06-27/frame-1.jpg",
      sha256: "sha256:snapshot",
      byteSize: 12345,
    },
    text: {
      textSource: "accessibility",
      accessibilityText: "raw private customer@example.com",
      redactedText: "redacted activation friction",
      redactionStatus: "redacted",
    },
  };
}

test("recorder control state blocks capture until consent, indicator, and core permissions are ready", () => {
  const now = new Date("2026-06-27T09:00:00.000Z");
  const defaultState = makeDefaultRecorderControlState({ now });
  const initial = evaluateRecorderCaptureReadiness(defaultState, { now });
  assert.equal(initial.canRecord, false);
  assert.deepEqual(initial.blockers.map((blocker) => blocker.id), [
    "consent_not_granted",
    "visible_indicator_not_acknowledged",
    "screen_recording_missing",
    "accessibility_missing",
    "recording_inactive",
  ]);

  assert.throws(
    () => transitionRecorderControlState(defaultState, { type: "grant_consent" }, { now }),
    (error) => error instanceof RecorderControlStateError
      && error.code === "ERR_RECORDER_CONTROL_VISIBLE_INDICATOR_REQUIRED",
  );

  const consented = transitionRecorderControlState(defaultState, {
    type: "grant_consent",
    visibleIndicatorAcknowledged: true,
  }, { now });
  const readyState = grantCorePermissions(consented);
  const ready = evaluateRecorderCaptureReadiness(readyState, { now });
  assert.equal(ready.canRecord, true);
  assert.equal(ready.state, "degraded");
  assert.deepEqual(ready.blockers, []);
  assert.equal(ready.warnings.some((warning) => warning.id === "input_monitoring_degraded"), true);
});

test("recorder control state models pause, resume, and stop-for-today explicitly", () => {
  const now = new Date("2026-06-27T10:00:00.000Z");
  let state = makeDefaultRecorderControlState({ now });
  state = transitionRecorderControlState(state, {
    type: "grant_consent",
    visibleIndicatorAcknowledged: true,
  }, { now });
  state = grantCorePermissions(state);

  const paused = transitionRecorderControlState(state, {
    type: "pause",
    reason: "lunch",
  }, { now: new Date("2026-06-27T10:30:00.000Z") });
  const pausedReadiness = evaluateRecorderCaptureReadiness(paused, { now });
  assert.equal(pausedReadiness.canRecord, false);
  assert.equal(pausedReadiness.blockers.some((blocker) => blocker.id === "recording_paused"), true);

  const resumed = transitionRecorderControlState(paused, {
    type: "resume",
  }, { now: new Date("2026-06-27T10:40:00.000Z") });
  assert.equal(evaluateRecorderCaptureReadiness(resumed, { now }).canRecord, true);

  const stopped = transitionRecorderControlState(resumed, {
    type: "stop_for_today",
    reason: "done",
    localDate: "2026-06-27",
  }, { now: new Date("2026-06-27T18:00:00.000Z") });
  const stoppedReadiness = evaluateRecorderCaptureReadiness(stopped, { now });
  assert.equal(stoppedReadiness.canRecord, false);
  assert.equal(stoppedReadiness.blockers.some((blocker) => blocker.id === "stopped_for_today"), true);
  assert.throws(
    () => transitionRecorderControlState(stopped, { type: "resume" }, { now }),
    (error) => error instanceof RecorderControlStateError
      && error.code === "ERR_RECORDER_CONTROL_STOPPED_FOR_TODAY",
  );
});

test("recorder control state models Gate C clipboard, audio, and metadata policies explicitly", () => {
  const now = new Date("2026-06-27T11:30:00.000Z");
  let state = makeDefaultRecorderControlState({ now });
  state = transitionRecorderControlState(state, {
    type: "grant_consent",
    visibleIndicatorAcknowledged: true,
  }, { now });
  state = grantCorePermissions(state);

  const defaultPolicy = evaluateRecorderExpandedMediaPolicy(state, { now });
  assert.equal(defaultPolicy.clipboard.mode, "trigger_only");
  assert.equal(defaultPolicy.clipboard.canCaptureContents, false);
  assert.equal(defaultPolicy.clipboard.status, "trigger_degraded");
  assert.equal(defaultPolicy.audio.microphone.status, "disabled_by_policy");
  assert.equal(defaultPolicy.audio.systemAudio.status, "disabled_by_policy");
  assert.equal(defaultPolicy.metadata.browserMetadata.status, "degraded");
  assert.equal(defaultPolicy.metadata.documentMetadata.status, "degraded");
  assert.equal(defaultPolicy.proofAcceptedByExpandedMediaPolicy, false);
  assert.equal(defaultPolicy.degradedStates.some((warning) => warning.id === "clipboard_trigger_degraded"), true);
  assert.equal(defaultPolicy.degradedStates.some((warning) => warning.id === "browser_metadata_degraded"), true);
  assert.equal(defaultPolicy.degradedStates.some((warning) => warning.id === "document_metadata_degraded"), true);

  state = transitionRecorderControlState(state, {
    type: "set_permission",
    permission: "clipboard",
    state: "granted",
  }, { now });
  state = transitionRecorderControlState(state, {
    type: "set_sensitive_capture",
    clipboardMode: "content_opt_in",
    microphone: true,
    systemAudio: true,
  }, { now });
  let optInPolicy = evaluateRecorderExpandedMediaPolicy(state, { now });
  assert.equal(optInPolicy.clipboard.status, "content_enabled");
  assert.equal(optInPolicy.clipboard.canCaptureContents, true);
  assert.equal(optInPolicy.audio.microphone.status, "blocked_by_permission");
  assert.equal(optInPolicy.audio.systemAudio.status, "blocked_by_permission");
  assert.equal(optInPolicy.degradedStates.some((warning) => warning.id === "microphone_capture_blocked_by_permission"), true);
  assert.equal(optInPolicy.degradedStates.some((warning) => warning.id === "system_audio_capture_blocked_by_permission"), true);

  state = transitionRecorderControlState(state, {
    type: "set_permission",
    permission: "microphone",
    state: "granted",
  }, { now });
  state = transitionRecorderControlState(state, {
    type: "set_permission",
    permission: "system_audio",
    state: "granted",
  }, { now });
  state = transitionRecorderControlState(state, {
    type: "set_permission",
    permission: "browser_metadata",
    state: "granted",
  }, { now });
  state = transitionRecorderControlState(state, {
    type: "set_permission",
    permission: "document_metadata",
    state: "granted",
  }, { now });
  optInPolicy = evaluateRecorderExpandedMediaPolicy(state, { now });
  assert.equal(optInPolicy.audio.microphone.status, "enabled");
  assert.equal(optInPolicy.audio.systemAudio.status, "enabled");
  assert.equal(optInPolicy.metadata.browserMetadata.status, "available");
  assert.equal(optInPolicy.metadata.documentMetadata.status, "available");
  assert.equal(optInPolicy.degradedStates.some((warning) => warning.id === "microphone_capture_blocked_by_permission"), false);
  assert.equal(optInPolicy.degradedStates.some((warning) => warning.id === "browser_metadata_degraded"), false);

  const readiness = evaluateRecorderCaptureReadiness(state, { now });
  assert.equal(readiness.canRecord, true);
  assert.equal(readiness.expandedMedia.clipboard.status, "content_enabled");
});

test("recorder control state persists under the recorder host directory and fails on corrupt JSON", async () => {
  const { appSupportRoot, store } = await makeContext();
  try {
    const filePath = resolveRecorderControlStatePath({ appSupportRoot });
    let saved = await applyRecorderControlAction({
      appSupportRoot,
      action: {
        type: "grant_consent",
        visibleIndicatorAcknowledged: true,
      },
      now: new Date("2026-06-27T11:00:00.000Z"),
    });
    saved = await applyRecorderControlAction({
      appSupportRoot,
      action: {
        type: "set_permission",
        permission: "screen_recording",
        state: "granted",
      },
      now: new Date("2026-06-27T11:01:00.000Z"),
    });
    assert.equal(saved.permissions.screenRecording, "granted");
    assert.equal(filePath, path.join(appSupportRoot, "recorder", "recorder-control-state.json"));
    const loaded = await loadRecorderControlState({ appSupportRoot });
    assert.equal(loaded.consent.status, "granted");
    assert.equal(loaded.permissions.screenRecording, "granted");

    await fs.writeFile(filePath, "{not json");
    await assert.rejects(
      () => loadRecorderControlState({ appSupportRoot }),
      (error) => error instanceof RecorderControlStateError
        && error.code === "ERR_RECORDER_CONTROL_STATE_CORRUPT",
    );
  } finally {
    store.close();
  }
});

test("recordFrameCaptureEnvelope rejects writes when supplied recorder control state is blocked", async () => {
  const { store } = await makeContext();
  try {
    const paused = transitionRecorderControlState(grantCorePermissions(transitionRecorderControlState(
      makeDefaultRecorderControlState({ now: new Date("2026-06-27T12:00:00.000Z") }),
      {
        type: "grant_consent",
        visibleIndicatorAcknowledged: true,
      },
      { now: new Date("2026-06-27T12:00:00.000Z") },
    )), {
      type: "pause",
      reason: "private window",
    }, { now: new Date("2026-06-27T12:10:00.000Z") });

    assert.throws(
      () => recordFrameCaptureEnvelope(store, envelope(), { controlState: paused }),
      (error) => error instanceof RecorderIngestError
        && error.code === "ERR_RECORDER_INGEST_CAPTURE_NOT_READY"
        && error.details?.readiness?.blockers?.some((blocker) => blocker.id === "recording_paused"),
    );

    const active = transitionRecorderControlState(paused, {
      type: "resume",
    }, { now: new Date("2026-06-27T12:15:00.000Z") });
    recordFrameCaptureEnvelope(store, envelope(), { controlState: active });
    assert.equal(store.getRecord("frames", "frame-1").id, "frame-1");
  } finally {
    store.close();
  }
});
