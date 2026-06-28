import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { WebSocket } from "ws";

import { RecorderStore } from "../sidecar/recorder-store.mjs";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("sidecar starts recorder raw API and issues scoped tokens through the authenticated bridge", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-recorder-raw-api-runtime-"));
  const workspacePath = path.join(root, "workspace");
  const appSupportPath = path.join(root, "app-support");
  const homePath = path.join(root, "home");
  await fs.mkdir(workspacePath, { recursive: true });
  await fs.mkdir(appSupportPath, { recursive: true });
  await fs.mkdir(homePath, { recursive: true });

  const child = spawn(process.execPath, ["sidecar/index.mjs", "--workspace", workspacePath], {
    cwd: packageRoot,
    env: {
      ...process.env,
      AGENTIC30_APP_SUPPORT_PATH: appSupportPath,
      AGENTIC30_DISABLE_QMD_BOOTSTRAP: "1",
      AGENTIC30_TEST_STUB_PROVIDER: "1",
      HOME: homePath,
      GH_TOKEN: "",
      GITHUB_TOKEN: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let ws = null;
  try {
    const ready = await waitForSidecarReady(child);
    assert.equal(ready.recorderRawApi.enabled, true);
    assert.equal(ready.recorderRawApi.host, "127.0.0.1");
    assert.equal(typeof ready.recorderRawApi.port, "number");
    assert.match(ready.recorderRawApi.url, /^http:\/\/127\.0\.0\.1:\d+$/);
    assert.equal(ready.recorderRawApi.proofAcceptedByRawApi, false);

    ws = await connectAuthenticated(ready.port, ready.authToken);
    const readyEvent = await waitForEvent(ws.events, (event) => event.type === "ready");
    assert.equal(readyEvent.recorderRawApi.url, ready.recorderRawApi.url);
    assert.equal(readyEvent.recorderRawApi.proofAcceptedByRawApi, false);

    const initialControl = await sendBridgeRequest(ws, { type: "recorder_control_state_get" }, "recorder_control_state");
    assert.equal(initialControl.controlState.mode, "inactive");
    assert.equal(initialControl.controlState.consent.status, "not_requested");
    assert.equal(initialControl.readiness.canRecord, false);
    assert.equal(initialControl.readiness.blockers.some((blocker) => blocker.id === "consent_not_granted"), true);
    assert.equal(initialControl.proofAcceptedByRecorderControl, false);
    assert.equal(initialControl.proofAcceptedByCaptureReadiness, false);

    const consentedControl = await sendBridgeRequest(ws, {
      type: "recorder_control_action",
      action: {
        type: "grant_consent",
        visibleIndicatorAcknowledged: true,
      },
    }, "recorder_control_state");
    assert.equal(consentedControl.controlState.mode, "active");
    assert.equal(consentedControl.controlState.consent.status, "granted");
    assert.equal(consentedControl.controlState.consent.visibleIndicatorAcknowledged, true);
    assert.equal(consentedControl.readiness.canRecord, false);
    assert.equal(consentedControl.readiness.blockers.some((blocker) => blocker.permission === "screenRecording"), true);

    let captureReadyControl = consentedControl;
    for (const permission of [
      "screenRecording",
      "accessibility",
      "inputMonitoring",
      "visionOcr",
      "browserMetadata",
      "documentMetadata",
      "clipboard",
    ]) {
      captureReadyControl = await sendBridgeRequest(ws, {
        type: "recorder_control_action",
        action: {
          type: "set_permission",
          permission,
          state: "granted",
        },
      }, "recorder_control_state");
    }
    assert.equal(captureReadyControl.readiness.canRecord, true);
    assert.equal(captureReadyControl.readiness.state, "ready");
    assert.equal(captureReadyControl.controlState.permissions.screenRecording, "granted");
    assert.equal(captureReadyControl.controlState.permissions.accessibility, "granted");

    const pausedControl = await sendBridgeRequest(ws, {
      type: "recorder_control_action",
      action: {
        type: "pause",
        reason: "runtime_test_pause",
      },
    }, "recorder_control_state");
    assert.equal(pausedControl.controlState.mode, "paused");
    assert.equal(pausedControl.readiness.canRecord, false);
    assert.equal(pausedControl.readiness.blockers.some((blocker) => blocker.id === "recording_paused"), true);

    const resumedControl = await sendBridgeRequest(ws, {
      type: "recorder_control_action",
      action: {
        type: "resume",
        reason: "runtime_test_resume",
      },
    }, "recorder_control_state");
    assert.equal(resumedControl.controlState.mode, "active");
    assert.equal(resumedControl.readiness.canRecord, true);
    assert.doesNotMatch(JSON.stringify(resumedControl), /token_hash|a30_recorder_/);

    const ingestMarker = ws.events.length;
    ws.send(JSON.stringify({
      type: "recorder_frame_capture_ingest",
      envelope: {
        id: "frame-runtime-1",
        capturedAt: "2026-06-28T09:00:00.000Z",
        monitorId: "display-1",
        captureTrigger: "manual_runtime_test",
        appName: "Agentic30",
        windowTitle: "Founder Replay",
        contentHash: "runtime-content-hash-1",
        textSource: "screen_capture",
        accessibilityText: "raw visible screen text must not echo",
        redactionStatus: "not_redacted",
        safeForSearch: false,
        safeForMemory: false,
        safeForExport: false,
        snapshot: {
          id: "asset-runtime-1",
          relativePath: "media/frames/2026-06-28/frame-runtime-1.jpg",
          sha256: "1".repeat(64),
          byteSize: 42,
          encrypted: false,
        },
      },
    }));
    const ingested = await waitForEvent(ws.events, (event) =>
      ws.events.indexOf(event) >= ingestMarker && event.type === "recorder_frame_capture_ingested"
    );
    assert.equal(ingested.frame.id, "frame-runtime-1");
    assert.equal(ingested.mediaAsset.id, "asset-runtime-1");
    assert.equal(ingested.mediaAsset.pathExposed, false);
    assert.equal(ingested.proofAcceptedByRecorderIngest, false);
    assert.doesNotMatch(JSON.stringify(ingested), /raw visible screen text|relative_path|media\/frames|token_hash|a30_recorder_/);

    const clipboardMarker = ws.events.length;
    ws.send(JSON.stringify({
      type: "recorder_clipboard_event_record",
      event: {
        id: "clipboard-runtime-1",
        occurredAt: "2026-06-28T09:00:10.000Z",
        eventKind: "copy",
        appName: "Agentic30",
        windowTitle: "Founder Replay",
        contentType: "text",
        contentHash: "sha256:clipboard-runtime-1",
        redactedText: "redacted copied activation ask",
        redactionStatus: "redacted",
        privacyState: "searchable_local",
        safeForSearch: true,
        safeForMemory: true,
        safeForExport: false,
      },
    }));
    const clipboardRecorded = await waitForEvent(ws.events, (event) =>
      ws.events.indexOf(event) >= clipboardMarker && event.type === "recorder_clipboard_event_recorded"
    );
    assert.equal(clipboardRecorded.clipboardEvent.id, "clipboard-runtime-1");
    assert.equal(clipboardRecorded.clipboardEvent.captureMode, "trigger_only");
    assert.equal(clipboardRecorded.clipboardEvent.contentCaptured, false);
    assert.equal(clipboardRecorded.proofAcceptedByClipboardEvent, false);
    assert.equal(clipboardRecorded.proofLedgerWriteAllowed, false);
    assert.doesNotMatch(JSON.stringify(clipboardRecorded), /content_text|raw copied|token_hash|a30_recorder_/);

    await sendBridgeRequest(ws, {
      type: "recorder_control_action",
      action: {
        type: "set_permission",
        permission: "microphone",
        state: "granted",
      },
    }, "recorder_control_state");
    const audioPolicyControl = await sendBridgeRequest(ws, {
      type: "recorder_control_action",
      action: {
        type: "set_sensitive_capture",
        microphone: true,
      },
    }, "recorder_control_state");
    assert.equal(audioPolicyControl.controlState.sensitiveCapture.microphone, true);
    assert.equal(audioPolicyControl.readiness.expandedMedia.audio.microphone.canCapture, true);

    const audioMarker = ws.events.length;
    ws.send(JSON.stringify({
      type: "recorder_audio_chunk_record",
      audio: {
        id: "audio-runtime-1",
        startedAt: "2026-06-28T09:00:20.000Z",
        endedAt: "2026-06-28T09:01:20.000Z",
        source: "microphone",
        transcriptStatus: "local_complete",
        redactionStatus: "redacted",
        privacyState: "raw_local",
        audioAsset: {
          id: "asset-audio-runtime-1",
          relativePath: "media/audio/2026-06-28/audio-runtime-1.m4a",
          sha256: "3".repeat(64),
          byteSize: 4096,
          encrypted: false,
        },
        transcriptSegments: [
          {
            id: "segment-runtime-1",
            startedAt: "2026-06-28T09:00:25.000Z",
            endedAt: "2026-06-28T09:00:55.000Z",
            speakerLabel: "founder",
            text: "raw spoken text token=secret must not echo",
            redactedText: "founder described activation friction",
            redactionStatus: "redacted",
            privacyState: "searchable_local",
            safeForSearch: true,
            safeForMemory: true,
          },
        ],
      },
    }));
    const audioRecorded = await waitForEvent(ws.events, (event) =>
      ws.events.indexOf(event) >= audioMarker && event.type === "recorder_audio_chunk_recorded"
    );
    assert.equal(audioRecorded.audioChunk.id, "audio-runtime-1");
    assert.equal(audioRecorded.audioChunk.source, "microphone");
    assert.equal(audioRecorded.audioChunk.rawAudioExposed, false);
    assert.equal(audioRecorded.audioChunk.pathExposed, false);
    assert.equal(audioRecorded.transcriptSegments[0].id, "segment-runtime-1");
    assert.equal(audioRecorded.transcriptSegments[0].rawTranscriptExposed, false);
    assert.equal(audioRecorded.proofAcceptedByAudioChunk, false);
    assert.equal(audioRecorded.proofLedgerWriteAllowed, false);
    assert.doesNotMatch(JSON.stringify(audioRecorded), /raw spoken text|token=secret|relative_path|media\/audio|token_hash|a30_recorder_/);

    const runtimeFrameMediaPath = path.join(appSupportPath, "recorder", "media", "frames", "2026-06-28", "frame-runtime-1.jpg");
    await fs.mkdir(path.dirname(runtimeFrameMediaPath), { recursive: true });
    await fs.writeFile(runtimeFrameMediaPath, "jpeg bytes here");

    const rangeFrameMediaPaths = [];
    for (const frame of [
      {
        id: "frame-runtime-range-1",
        assetId: "asset-runtime-range-1",
        capturedAt: "2026-06-28T10:00:30.000Z",
        relativePath: "media/frames/2026-06-28/frame-runtime-range-1.jpg",
      },
      {
        id: "frame-runtime-range-2",
        assetId: "asset-runtime-range-2",
        capturedAt: "2026-06-28T10:01:30.000Z",
        relativePath: "media/frames/2026-06-28/frame-runtime-range-2.jpg",
      },
    ]) {
      const marker = ws.events.length;
      ws.send(JSON.stringify({
        type: "recorder_frame_capture_ingest",
        envelope: {
          id: frame.id,
          capturedAt: frame.capturedAt,
          monitorId: "display-1",
          captureTrigger: "manual_runtime_range_test",
          appName: "Agentic30",
          windowTitle: "Founder Replay Range",
          contentHash: `${frame.id}-hash`,
          textSource: "screen_capture",
          accessibilityText: "range delete raw text must not echo",
          redactedText: "range delete redacted text",
          redactionStatus: "redacted",
          safeForSearch: true,
          safeForMemory: true,
          safeForExport: false,
          snapshot: {
            id: frame.assetId,
            relativePath: frame.relativePath,
            sha256: "2".repeat(64),
            byteSize: 42,
            encrypted: false,
          },
        },
      }));
      const rangeIngested = await waitForEvent(ws.events, (event) =>
        ws.events.indexOf(event) >= marker && event.type === "recorder_frame_capture_ingested"
      );
      assert.equal(rangeIngested.frame.id, frame.id);
      const mediaPath = path.join(appSupportPath, "recorder", frame.relativePath);
      await fs.mkdir(path.dirname(mediaPath), { recursive: true });
      await fs.writeFile(mediaPath, "range jpeg bytes");
      rangeFrameMediaPaths.push(mediaPath);
    }

    const frameListMarker = ws.events.length;
    ws.send(JSON.stringify({
      type: "recorder_frame_captures_list",
      limit: 10,
    }));
    const frameList = await waitForEvent(ws.events, (event) =>
      ws.events.indexOf(event) >= frameListMarker && event.type === "recorder_frame_captures"
    );
    assert.equal(frameList.frames.some((frame) => frame.id === "frame-runtime-1"), true);
    assert.equal(frameList.frames.some((frame) => frame.id === "frame-runtime-range-1"), true);
    assert.equal(frameList.frames.some((frame) => frame.id === "frame-runtime-range-2"), true);
    assert.equal(frameList.proofAcceptedByRecorderFrames, false);
    assert.equal(frameList.proofLedgerWriteAllowed, false);
    assert.doesNotMatch(JSON.stringify(frameList), /raw visible screen text|relative_path|media\/frames|token_hash|a30_recorder_/);

    const statusMarker = ws.events.length;
    ws.send(JSON.stringify({ type: "recorder_raw_api_status" }));
    const status = await waitForEvent(ws.events, (event) =>
      ws.events.indexOf(event) >= statusMarker && event.type === "recorder_raw_api_status"
    );
    assert.equal(status.recorderRawApi.url, ready.recorderRawApi.url);

    const tokenMarker = ws.events.length;
    ws.send(JSON.stringify({
      type: "recorder_raw_api_token_issue",
      scopes: ["search"],
      ttlMs: 60_000,
      clientId: "runtime-test",
      clientName: "Runtime test",
    }));
    const issued = await waitForEvent(ws.events, (event) =>
      ws.events.indexOf(event) >= tokenMarker && event.type === "recorder_raw_api_token_issued"
    );
    assert.match(issued.token.token, /^a30_recorder_/);
    assert.deepEqual(issued.token.scopes, ["search"]);
    assert.equal(issued.proofAcceptedByRawApi, false);
    assert.equal(JSON.stringify(issued).includes("token_hash"), false);

    const health = await fetch(`${ready.recorderRawApi.url}/recorder/health`, {
      headers: {
        Origin: "agentic30://app",
        Authorization: `Bearer ${issued.token.token}`,
        "x-request-id": "runtime-health",
      },
    });
    const body = await health.json();
    assert.equal(health.status, 200);
    assert.equal(body.status, "ok");
    assert.equal(body.rawApi.proofAcceptedByRawApi, false);

    const rawFrameTokenMarker = ws.events.length;
    ws.send(JSON.stringify({
      type: "recorder_raw_api_token_issue",
      scopes: ["raw_frame"],
      ttlMs: 60_000,
      clientId: "runtime-frame-image",
      clientName: "Runtime frame image",
    }));
    const rawFrameToken = await waitForEvent(ws.events, (event) =>
      ws.events.indexOf(event) >= rawFrameTokenMarker && event.type === "recorder_raw_api_token_issued"
    );
    assert.deepEqual(rawFrameToken.token.scopes, ["raw_frame"]);
    assert.equal(rawFrameToken.proofAcceptedByRawApi, false);

    const frameImage = await fetch(`${ready.recorderRawApi.url}/recorder/frames/frame-runtime-1/image`, {
      headers: {
        Origin: "agentic30://app",
        Authorization: `Bearer ${rawFrameToken.token.token}`,
        "x-request-id": "runtime-frame-image",
      },
    });
    assert.equal(frameImage.status, 200);
    assert.equal(frameImage.headers.get("content-type"), "image/jpeg");
    assert.equal(frameImage.headers.get("x-agentic30-recorder-frame-id"), "frame-runtime-1");
    assert.equal(frameImage.headers.get("x-agentic30-recorder-media-asset-id"), "asset-runtime-1");
    assert.match(
      frameImage.headers.get("x-agentic30-recorder-audit-id") || "",
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    assert.equal(frameImage.headers.has("x-agentic30-recorder-media-path"), false);
    assert.equal(await frameImage.text(), "jpeg bytes here");

    const auditMarker = ws.events.length;
    ws.send(JSON.stringify({
      type: "recorder_audit_list",
      limit: 10,
      decision: "accepted",
    }));
    const audit = await waitForEvent(ws.events, (event) =>
      ws.events.indexOf(event) >= auditMarker && event.type === "recorder_audit_events"
    );
    assert.equal(audit.proofAcceptedByAuditSource, false);
    assert.equal(audit.recorderAuditSource.proofAcceptedByAuditSource, false);
    assert.equal(audit.recorderAuditSource.proofBoundary.proofLedgerWriteAllowed, false);
    assert.equal(audit.audit.some((row) =>
      row.requestId === "runtime-health"
      && row.endpoint === "/recorder/health"
      && row.accessLevel === "summary"
      && row.decision === "accepted"
    ), true);
    assert.equal(audit.audit.some((row) =>
      row.requestId === "runtime-frame-image"
      && row.endpoint === "/recorder/frames/frame-runtime-1/image"
      && row.accessLevel === "raw_frame"
      && row.decision === "accepted"
    ), true);
    const auditJson = JSON.stringify(audit);
    assert.doesNotMatch(auditJson, /a30_recorder_/);
    assert.doesNotMatch(auditJson, /token_hash/);
    assert.doesNotMatch(auditJson, /Authorization/i);

    const errorMarker = ws.events.length;
    ws.send(JSON.stringify({
      type: "recorder_raw_api_token_issue",
      scopes: ["raw_admin"],
      ttlMs: 60_000,
      clientId: "runtime-test",
      clientName: "Runtime test",
    }));
    const denied = await waitForEvent(ws.events, (event) =>
      ws.events.indexOf(event) >= errorMarker && event.type === "error"
    );
    assert.match(denied.message, /ERR_RECORDER_RAW_API_RAW_ADMIN_CONFIRMATION_REQUIRED/);

    const grantMarker = ws.events.length;
    ws.send(JSON.stringify({
      type: "recorder_mcp_grant_create",
      toolName: "recorder.rawFrame",
      accessLevels: ["raw_frame"],
      ttlMs: 60_000,
      reason: "runtime grant test",
    }));
    const createdGrant = await waitForEvent(ws.events, (event) =>
      ws.events.indexOf(event) >= grantMarker && event.type === "recorder_mcp_grant_created"
    );
    assert.equal(createdGrant.grant.toolName, "recorder.rawFrame");
    assert.deepEqual(createdGrant.grant.accessLevels, ["raw_frame"]);
    assert.equal(createdGrant.proofAcceptedByMcpGrant, false);

    const checkMarker = ws.events.length;
    ws.send(JSON.stringify({
      type: "recorder_mcp_access_check",
      toolName: "recorder.rawFrame",
      accessLevel: "raw_frame",
    }));
    const checked = await waitForEvent(ws.events, (event) =>
      ws.events.indexOf(event) >= checkMarker && event.type === "recorder_mcp_access_checked"
    );
    assert.equal(checked.access.decision, "scoped_grant");

    const listMarker = ws.events.length;
    ws.send(JSON.stringify({ type: "recorder_mcp_grants_list" }));
    const listed = await waitForEvent(ws.events, (event) =>
      ws.events.indexOf(event) >= listMarker && event.type === "recorder_mcp_grants"
    );
    assert.equal(listed.grants.length, 1);
    assert.equal(listed.grants[0].state, "active");

    const revokeMarker = ws.events.length;
    ws.send(JSON.stringify({
      type: "recorder_mcp_grant_revoke",
      grantId: createdGrant.grant.id,
    }));
    const revoked = await waitForEvent(ws.events, (event) =>
      ws.events.indexOf(event) >= revokeMarker && event.type === "recorder_mcp_grant_revoked"
    );
    assert.equal(revoked.grant.state, "revoked");

    const deniedCheckMarker = ws.events.length;
    ws.send(JSON.stringify({
      type: "recorder_mcp_access_check",
      toolName: "recorder.rawFrame",
      accessLevel: "raw_frame",
    }));
    const deniedCheck = await waitForEvent(ws.events, (event) =>
      ws.events.indexOf(event) >= deniedCheckMarker && event.type === "error"
    );
    assert.match(deniedCheck.message, /ERR_RECORDER_MCP_RAW_ACCESS_DENIED/);

    const pipesMarker = ws.events.length;
    ws.send(JSON.stringify({
      type: "recorder_pipes_list",
      limit: 10,
      runLimit: 10,
    }));
    const pipesState = await waitForEvent(ws.events, (event) =>
      ws.events.indexOf(event) >= pipesMarker && event.type === "recorder_pipes_state"
    );
    assert.deepEqual(pipesState.pipes.map((pipe) => pipe.id).sort(), [
      "daily-founder-memory",
      "evidence-inbox-builder",
      "stale-debt-resurfacer",
    ]);
    assert.equal(pipesState.proofAcceptedByPipeDefinition, false);
    assert.equal(pipesState.proofAcceptedByPipeRun, false);
    assert.equal(JSON.stringify(pipesState).includes("token_hash"), false);

    const now = new Date("2026-06-28T09:00:00.000Z");
    const runMarker = ws.events.length;
    ws.send(JSON.stringify({
      type: "recorder_pipe_run",
      pipeId: "daily-founder-memory",
      startedAt: new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString(),
      endedAt: now.toISOString(),
      triggerReason: "manual",
      limit: 10,
      runLimit: 10,
    }));
    const pipeRun = await waitForEvent(ws.events, (event) =>
      ws.events.indexOf(event) >= runMarker && event.type === "recorder_pipe_run_result"
    );
    assert.equal(pipeRun.pipeRun.pipeId, "daily-founder-memory");
    assert.equal(pipeRun.pipeRun.status, "succeeded");
    assert.equal(pipeRun.proofAcceptedByPipeRun, false);
    assert.equal(pipeRun.runs.some((run) => run.id === pipeRun.pipeRun.id), true);
    const pipeRunJson = JSON.stringify(pipeRun);
    assert.doesNotMatch(pipeRunJson, /token_hash|a30_recorder_|rawText|raw_text|media\/frames|media\/audio/);

    const schedulerMarker = ws.events.length;
    ws.send(JSON.stringify({
      type: "recorder_pipe_scheduler_tick",
      autoRun: false,
      limit: 10,
      runLimit: 10,
    }));
    const scheduler = await waitForEvent(ws.events, (event) =>
      ws.events.indexOf(event) >= schedulerMarker && event.type === "recorder_pipe_scheduler_tick_result"
    );
    assert.equal(scheduler.proofAcceptedByScheduler, false);
    assert.equal(scheduler.enqueueResult.proofAcceptedByScheduler, false);
    assert.equal(Array.isArray(scheduler.runs), true);
    assert.equal(JSON.stringify(scheduler).includes("token_hash"), false);

    const rangeDeleteMarker = ws.events.length;
    ws.send(JSON.stringify({
      type: "recorder_frame_captures_delete_range",
      startedAt: "2026-06-28T10:00:00.000Z",
      endedAt: "2026-06-28T10:03:00.000Z",
      limit: 10,
      confirm: true,
    }));
    const rangeDeleted = await waitForEvent(ws.events, (event) =>
      ws.events.indexOf(event) >= rangeDeleteMarker && event.type === "recorder_frame_captures_deleted"
    );
    assert.equal(rangeDeleted.deletionRange.status, "deleted");
    assert.equal(rangeDeleted.deletionRange.frameCount, 2);
    assert.deepEqual(rangeDeleted.deletionRange.frameIds.sort(), [
      "frame-runtime-range-1",
      "frame-runtime-range-2",
    ]);
    assert.equal(rangeDeleted.deletionRange.mediaRemovedCount, 2);
    assert.equal(rangeDeleted.deletionRange.pathExposed, false);
    assert.equal(rangeDeleted.proofAcceptedByRecorderDelete, false);
    assert.equal(rangeDeleted.proofLedgerWriteAllowed, false);
    assert.doesNotMatch(JSON.stringify(rangeDeleted), /media\/frames|relative_path|mediaPath|media_path|token_hash|a30_recorder_/);
    for (const mediaPath of rangeFrameMediaPaths) {
      await assert.rejects(fs.access(mediaPath), { code: "ENOENT" });
    }

    const deleteMarker = ws.events.length;
    ws.send(JSON.stringify({
      type: "recorder_frame_capture_delete",
      frameId: "frame-runtime-1",
    }));
    const deleted = await waitForEvent(ws.events, (event) =>
      ws.events.indexOf(event) >= deleteMarker && event.type === "recorder_frame_capture_deleted"
    );
    assert.equal(deleted.deletion.status, "deleted");
    assert.equal(deleted.deletion.frameId, "frame-runtime-1");
    assert.equal(deleted.deletion.mediaAssetId, "asset-runtime-1");
    assert.equal(deleted.deletion.mediaRemoved, true);
    assert.equal(deleted.deletion.pathExposed, false);
    assert.equal(deleted.proofAcceptedByRecorderDelete, false);
    assert.equal(deleted.proofLedgerWriteAllowed, false);
    assert.doesNotMatch(JSON.stringify(deleted), /media\/frames|relative_path|mediaPath|media_path|token_hash|a30_recorder_/);
    await assert.rejects(fs.access(runtimeFrameMediaPath), { code: "ENOENT" });

    const deletedFrameListMarker = ws.events.length;
    ws.send(JSON.stringify({
      type: "recorder_frame_captures_list",
      limit: 10,
    }));
    const deletedFrameList = await waitForEvent(ws.events, (event) =>
      ws.events.indexOf(event) >= deletedFrameListMarker && event.type === "recorder_frame_captures"
    );
    assert.equal(deletedFrameList.frames.some((frame) => frame.id === "frame-runtime-1"), false);
    assert.equal(deletedFrameList.frames.some((frame) => frame.id === "frame-runtime-range-1"), false);
    assert.equal(deletedFrameList.frames.some((frame) => frame.id === "frame-runtime-range-2"), false);

    await fs.access(path.join(appSupportPath, "recorder", "recorder.sqlite"));
    const runtimeStore = new RecorderStore({ appSupportRoot: appSupportPath }).open();
    try {
      const pipeRows = runtimeStore.listRecords("pipe_definitions", { limit: 10 })
        .sort((lhs, rhs) => lhs.id.localeCompare(rhs.id));
      assert.deepEqual(pipeRows.map((row) => row.id), [
        "daily-founder-memory",
        "evidence-inbox-builder",
        "stale-debt-resurfacer",
      ]);
      const pipeJson = JSON.stringify(pipeRows);
      assert.doesNotMatch(pipeJson, /a30_recorder_/);
      assert.doesNotMatch(pipeJson, /token_hash/);
      assert.doesNotMatch(pipeJson, /media\/frames/);
      assert.doesNotMatch(pipeJson, /media\/audio/);
      const frameRow = runtimeStore.getRecord("frames", "frame-runtime-1");
      assert.equal(frameRow?.snapshot_asset_id, "asset-runtime-1");
      assert.equal(typeof frameRow?.deleted_at, "string");
      const mediaRow = runtimeStore.getRecord("media_assets", "asset-runtime-1");
      assert.equal(mediaRow?.relative_path, "media/frames/2026-06-28/frame-runtime-1.jpg");
      assert.equal(typeof mediaRow?.deleted_at, "string");
      const audioRow = runtimeStore.getRecord("audio_chunks", "audio-runtime-1");
      assert.equal(audioRow?.audio_asset_id, "asset-audio-runtime-1");
      const transcriptRow = runtimeStore.getRecord("transcript_segments", "segment-runtime-1");
      assert.equal(transcriptRow?.redacted_text, "founder described activation friction");
      assert.equal(transcriptRow?.text, "raw spoken text token=secret must not echo");
      assert.equal(typeof runtimeStore.getRecord("frames", "frame-runtime-range-1")?.deleted_at, "string");
      assert.equal(typeof runtimeStore.getRecord("frames", "frame-runtime-range-2")?.deleted_at, "string");
      assert.equal(typeof runtimeStore.getRecord("media_assets", "asset-runtime-range-1")?.deleted_at, "string");
      assert.equal(typeof runtimeStore.getRecord("media_assets", "asset-runtime-range-2")?.deleted_at, "string");
    } finally {
      runtimeStore.close();
    }
    const grantsJson = await fs.readFile(path.join(appSupportPath, "recorder-mcp-grants.json"), "utf8");
    assert.doesNotMatch(grantsJson, /a30_recorder_/);
    assert.doesNotMatch(grantsJson, /token_hash/);
  } finally {
    ws?.close();
    child.kill("SIGTERM");
    await waitForExit(child);
    await fs.rm(root, { recursive: true, force: true });
  }
});

function waitForSidecarReady(child) {
  let stdout = "";
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timed out waiting for sidecar-ready. stderr:\n${stderr}`));
    }, 10_000);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
      const lines = stdout.split("\n");
      stdout = lines.pop() ?? "";
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line);
          if (parsed.type === "sidecar-ready") {
            clearTimeout(timer);
            resolve(parsed);
          }
        } catch {
          // Ignore non-ready stdout.
        }
      }
    });
  });
}

async function connectAuthenticated(port, authToken) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  ws.events = [];
  ws.on("message", (raw) => {
    ws.events.push(JSON.parse(String(raw)));
  });
  await onceOpen(ws);
  ws.send(JSON.stringify({ type: "authenticate", authToken }));
  return ws;
}

function onceOpen(ws) {
  return new Promise((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
}

function waitForEvent(events, predicate, timeoutMs = 10_000) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(() => {
      const found = events.find(predicate);
      if (found) {
        clearInterval(timer);
        resolve(found);
      } else if (Date.now() - started > timeoutMs) {
        clearInterval(timer);
        const tail = events.slice(-8).map((event) => ({
          type: event?.type,
          message: event?.message,
          errorKind: event?.errorKind,
        }));
        reject(new Error(`Timed out waiting for event. Recent events: ${JSON.stringify(tail)}`));
      }
    }, 10);
  });
}

async function sendBridgeRequest(ws, payload, expectedType) {
  const marker = ws.events.length;
  ws.send(JSON.stringify(payload));
  return waitForEvent(ws.events, (event) =>
    ws.events.indexOf(event) >= marker && event.type === expectedType
  );
}

function waitForExit(child) {
  return new Promise((resolve) => {
    child.once("exit", resolve);
    setTimeout(resolve, 2_000);
  });
}
