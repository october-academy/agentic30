#!/usr/bin/env node
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { applyRecorderRetentionPolicy } from "../sidecar/recorder-retention.mjs";
import {
  evaluateRecorderCaptureReadiness,
  loadRecorderControlState,
} from "../sidecar/recorder-control-state.mjs";
import {
  assertLiveRecorderAudioChunkRow,
  assertLiveRecorderFrameRow,
  isLiveCapturedAudioChunkRow,
  isLiveCapturedFrameRow,
  isSeedFixtureFrameRow,
  summarizeLiveRecorderCapture,
} from "../sidecar/recorder-live-verify.mjs";
import { buildRecorderSearchResults } from "../sidecar/recorder-search.mjs";
import { RecorderStore } from "../sidecar/recorder-store.mjs";

const USAGE = `Usage: node scripts/verify-live-recorder-acceptance.mjs --app-support <path> [options]
       node scripts/verify-live-recorder-acceptance.mjs --launchservices-handoff <path> [options]

Options:
  --launchservices-handoff <path>
                              Read app-support and launch metadata from a
                              LaunchServices prepare handoff manifest
  --audio-only                Verify live audio chunk/media evidence without
                              requiring a frame/search/raw-audit row
  --search-query <text>       Query used for redacted frame search (default: Agentic30)
  --frame-id <id>             Require the verifier to validate this live frame id
  --deleted-frame-id <id>     Require this frame id to be deleted/tombstoned
  --apply-retention           Apply a tiny retention window to prove purge behavior
  --json-output <path>        Write the evidence JSON to a file
  --allow-missing-audio       Do not fail when no live audio-<uuid> chunk exists
                              (forces the live_recorder_triage.v1 schema; the
                              result can never back an e2e_accepted claim)
  --allow-missing-audit       Do not fail when no accepted raw-read audit exists
  --skip-wal-checkpoint       Do not checkpoint WAL before reading the DB
  --help                      Show this message
`;

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LIVE_FRAME_RAW_READ_ENDPOINT_PATTERN = /^\/recorder\/frames\/([^/]+)\/(?:text|image)$/;
const LIVE_ACCEPTANCE_RETENTION_HOURS = 0.0001;
const LIVE_ACCEPTANCE_RETENTION_MARGIN_MS = 1000;

function parseArgs(argv) {
  const options = {
    appSupportPath: process.env.AGENTIC30_APP_SUPPORT_PATH || "",
    appSupportPathExplicit: false,
    launchServicesHandoffPath: "",
    audioOnly: false,
    searchQuery: "Agentic30",
    frameId: "",
    deletedFrameId: "",
    applyRetention: false,
    jsonOutput: "",
    allowMissingAudio: false,
    allowMissingAudit: false,
    skipWalCheckpoint: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--app-support") {
      options.appSupportPath = requireValue(argv, index += 1, arg);
      options.appSupportPathExplicit = true;
    } else if (arg === "--launchservices-handoff") {
      options.launchServicesHandoffPath = requireValue(argv, index += 1, arg);
    } else if (arg === "--audio-only") {
      options.audioOnly = true;
    } else if (arg === "--search-query") {
      options.searchQuery = requireValue(argv, index += 1, arg);
    } else if (arg === "--frame-id") {
      options.frameId = requireValue(argv, index += 1, arg);
    } else if (arg === "--deleted-frame-id") {
      options.deletedFrameId = requireValue(argv, index += 1, arg);
    } else if (arg === "--json-output") {
      options.jsonOutput = requireValue(argv, index += 1, arg);
    } else if (arg === "--apply-retention") {
      options.applyRetention = true;
    } else if (arg === "--allow-missing-audio") {
      options.allowMissingAudio = true;
    } else if (arg === "--allow-missing-audit") {
      options.allowMissingAudit = true;
    } else if (arg === "--skip-wal-checkpoint") {
      options.skipWalCheckpoint = true;
    } else {
      throw new Error(`Unknown argument: ${arg}\n\n${USAGE}`);
    }
  }
  return options;
}

function requireValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

async function writeEvidenceJson(jsonOutput, evidence) {
  if (!jsonOutput) return;
  const resolved = path.resolve(jsonOutput);
  await fsp.mkdir(path.dirname(resolved), { recursive: true });
  await fsp.writeFile(resolved, `${JSON.stringify(evidence, null, 2)}\n`);
}

function parseLaunchServicesHandoff(content, manifestPath) {
  const fields = {};
  for (const line of String(content || "").split(/\r?\n/)) {
    const match = /^([A-Za-z0-9_]+):\s*(.*)$/.exec(line);
    if (!match) continue;
    fields[match[1]] = match[2].trim();
  }
  if (!fields.status) {
    throw new Error(`LaunchServices handoff is missing status: ${manifestPath}`);
  }
  if (fields.status !== "open_succeeded") {
    throw new Error(`LaunchServices handoff did not record a successful app launch: status=${fields.status}`);
  }
  if (!fields.app_support) {
    throw new Error(`LaunchServices handoff is missing app_support: ${manifestPath}`);
  }
  return {
    path: manifestPath,
    status: fields.status,
    generatedAt: fields.generated_at || "",
    app: fields.app || "",
    bundleId: fields.bundle_id || "",
    runRoot: fields.run_root || "",
    workspace: fields.workspace || "",
    appSupport: fields.app_support,
    diagnostics: fields.diagnostics || "",
    acceptanceState: fields.acceptance_state || "",
    proofBoundary: fields.proof_boundary || "",
    nextLiveSignedRunCommand: fields.next_live_signed_run_command || "",
    nextAcceptanceVerifierCommand: fields.next_acceptance_verifier_command || "",
  };
}

function loadLaunchServicesHandoff(manifestPath) {
  const resolved = path.resolve(String(manifestPath || ""));
  if (!resolved || !fs.existsSync(resolved)) {
    throw new Error(`LaunchServices handoff not found: ${resolved || manifestPath}`);
  }
  return parseLaunchServicesHandoff(fs.readFileSync(resolved, "utf8"), resolved);
}

function loadLaunchDiagnostics(diagnosticsPath) {
  const inputPath = String(diagnosticsPath || "").trim();
  if (!inputPath) {
    return { path: "", exists: false };
  }
  const resolved = path.resolve(inputPath);
  if (!resolved || !fs.existsSync(resolved)) {
    return { path: resolved, exists: false };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(resolved, "utf8"));
    return {
      path: resolved,
      exists: true,
      schemaVersion: parsed?.schemaVersion ?? null,
      writtenAt: parsed?.writtenAt || "",
      processIdentifier: parsed?.processIdentifier ?? null,
      bundleIdentifier: parsed?.bundleIdentifier || "",
      uiTesting: parsed?.uiTesting === true,
      workspaceSettings: parsed?.workspaceSettings || null,
      viewModel: parsed?.viewModel || null,
      defaults: parsed?.defaults || null,
      files: parsed?.files || null,
      environment: parsed?.environment || null,
    };
  } catch (error) {
    return {
      path: resolved,
      exists: true,
      error: error?.message || String(error),
    };
  }
}

function resolveAppSupportRoot(options, launchServicesHandoff) {
  const explicitAppSupport = options.appSupportPathExplicit
    ? String(options.appSupportPath || "").trim()
    : "";
  const envAppSupport = options.appSupportPathExplicit
    ? ""
    : String(options.appSupportPath || "").trim();
  const handoffAppSupport = String(launchServicesHandoff?.appSupport || "").trim();
  if (explicitAppSupport && handoffAppSupport) {
    const explicitResolved = path.resolve(explicitAppSupport);
    const handoffResolved = path.resolve(handoffAppSupport);
    if (explicitResolved !== handoffResolved) {
      throw new Error(`--app-support does not match LaunchServices handoff app_support: ${explicitResolved} != ${handoffResolved}`);
    }
    return explicitResolved;
  }
  if (handoffAppSupport) return path.resolve(handoffAppSupport);
  if (explicitAppSupport) return path.resolve(explicitAppSupport);
  if (envAppSupport) return path.resolve(envAppSupport);
  throw new Error("--app-support or --launchservices-handoff is required.");
}

function summarizeFrame(frame, media, mediaPath, mediaExists) {
  return {
    id: frame.id,
    capturedAt: frame.captured_at,
    captureTrigger: frame.capture_trigger,
    textSource: frame.text_source,
    redactionStatus: frame.redaction_status,
    safeForSearch: Boolean(frame.safe_for_search),
    mediaAssetId: media?.id || "",
    mediaRelativePath: media?.relative_path || "",
    mediaByteSize: Number(media?.byte_size || 0),
    mediaPath,
    mediaExists,
  };
}

function findLatestLiveFrame(store) {
  return store
    .listRecords("frames", { limit: 50000, orderBy: "captured_at", direction: "DESC" })
    .find((frame) => isLiveCapturedFrameRow(frame)) || null;
}

function mediaPathFor(appSupportRoot, media) {
  const relativePath = String(media?.relative_path || "");
  if (!relativePath || relativePath.includes("..") || path.isAbsolute(relativePath)) {
    return "";
  }
  return path.join(appSupportRoot, "recorder", relativePath);
}

function findLiveAudioChunk(store) {
  return store
    .listRecords("audio_chunks", { limit: 50000, orderBy: "started_at", direction: "DESC" })
    .find((chunk) => isLiveCapturedAudioChunkRow(chunk)) || null;
}

function findLatestAudioChunk(store) {
  return store
    .listRecords("audio_chunks", { limit: 50000, orderBy: "started_at", direction: "DESC" })
    .find((chunk) => !chunk.deleted_at) || null;
}

function collectAcceptedRawReadAudit(store, sourceId) {
  return store
    .listRecords("recorder_audit", { limit: 50000, orderBy: "created_at", direction: "DESC" })
    .find((row) => {
      if (row.deleted_at || row.decision !== "accepted") return false;
      if (row.access_level !== "raw_frame") return false;
      const endpointMatch = LIVE_FRAME_RAW_READ_ENDPOINT_PATTERN.exec(String(row.endpoint || ""));
      if (!endpointMatch || endpointMatch[1] !== sourceId) return false;
      const sourceIds = parseSourceIds(row.source_ids_json);
      return sourceIds.some((source) => source.id === sourceId && source.sourceType === "frame");
    }) || null;
}

function parseSourceIds(value) {
  let parsed;
  try {
    parsed = JSON.parse(String(value || "[]"));
  } catch {
    return [];
  }
  const input = Array.isArray(parsed) ? parsed : [];
  return input.map((item) => {
    if (typeof item === "string") {
      return { id: item, sourceType: "unknown" };
    }
    return {
      id: String(item?.id ?? item?.sourceId ?? item?.source_id ?? "").trim(),
      sourceType: String(item?.sourceType ?? item?.source_type ?? item?.sourceKind ?? item?.source_kind ?? "").trim() || "unknown",
    };
  }).filter((item) => item.id);
}

function assertRawReadAuditEvidence(store, sourceId, allowMissingAudit) {
  const audit = collectAcceptedRawReadAudit(store, sourceId);
  if (!audit) {
    if (allowMissingAudit) return { status: "missing_allowed" };
    throw new Error(`No accepted raw-read audit row references live frame ${sourceId}. Re-run with --allow-missing-audit only for non-raw-read triage.`);
  }
  return {
    id: audit.id,
    endpoint: audit.endpoint,
    accessLevel: audit.access_level,
    decision: audit.decision,
    requestId: audit.request_id,
    sourceIds: parseSourceIds(audit.source_ids_json),
  };
}

function assertLiveFrameEvidence(appSupportRoot, store, frameId = "") {
  const frame = frameId
    ? assertLiveRecorderFrameRow(store, frameId)
    : findLatestLiveFrame(store);
  if (!frame) {
    throw new Error("No undeleted live frame row found: expected a non-seed frame with a live macOS collector trigger.");
  }
  const verifiedFrame = frameId ? frame : assertLiveRecorderFrameRow(store, frame.id);
  const media = store.getRecord("media_assets", verifiedFrame.snapshot_asset_id);
  if (!media || !String(media.id || "").startsWith("asset-")) {
    throw new Error(`Live frame ${verifiedFrame.id} does not reference a live asset-% media row.`);
  }
  const mediaPath = mediaPathFor(appSupportRoot, media);
  const mediaExists = mediaPath ? fs.existsSync(mediaPath) : false;
  if (!mediaExists || Number(media.byte_size || 0) <= 0) {
    throw new Error(`Live frame ${verifiedFrame.id} media file is missing or empty: ${mediaPath || "<invalid path>"}`);
  }
  return { frame: verifiedFrame, media, mediaPath, summary: summarizeFrame(verifiedFrame, media, mediaPath, mediaExists) };
}

function summarizeDeletedFrame(frame, media, mediaPath, mediaExists, search) {
  return {
    id: frame.id,
    deletedAt: frame.deleted_at,
    redactionStatus: frame.redaction_status,
    privacyState: frame.privacy_state,
    safeForSearch: Boolean(frame.safe_for_search),
    safeForMemory: Boolean(frame.safe_for_memory),
    safeForExport: Boolean(frame.safe_for_export),
    mediaAssetId: media?.id || "",
    mediaRelativePath: media?.relative_path || "",
    mediaDeletedAt: media?.deleted_at || "",
    mediaByteSize: Number(media?.byte_size || 0),
    mediaPath,
    mediaExists,
    searchResultCount: search.resultCount,
  };
}

function assertDeletedFrameEvidence(appSupportRoot, store, frameId, query) {
  const cleanFrameId = String(frameId || "").trim();
  if (!cleanFrameId) {
    throw new Error("--deleted-frame-id requires a frame id.");
  }
  const frame = store.getRecord("frames", cleanFrameId);
  if (!frame) {
    throw new Error(`Deleted-frame verifier could not find frame ${cleanFrameId}.`);
  }
  if (!frame.deleted_at) {
    throw new Error(`Frame ${cleanFrameId} is not deleted.`);
  }
  const unsafeFrameFields = [
    "browser_url",
    "browser_url_normalized",
    "browser_domain",
    "browser_url_search_label",
    "document_path",
    "document_path_search_label",
    "accessibility_text",
    "ocr_text",
    "redacted_text",
  ].filter((field) => String(frame[field] ?? "").trim());
  if (unsafeFrameFields.length) {
    throw new Error(`Deleted frame ${cleanFrameId} still exposes raw/search fields: ${unsafeFrameFields.join(", ")}`);
  }
  if (
    frame.redaction_status !== "deleted"
    || frame.privacy_state !== "deleted"
    || Number(frame.safe_for_search) !== 0
    || Number(frame.safe_for_memory) !== 0
    || Number(frame.safe_for_export) !== 0
  ) {
    throw new Error(`Deleted frame ${cleanFrameId} has incomplete tombstone flags.`);
  }
  const media = store.getRecord("media_assets", frame.snapshot_asset_id);
  if (!media) {
    throw new Error(`Deleted frame ${cleanFrameId} is missing media asset ${frame.snapshot_asset_id}.`);
  }
  if (!media.deleted_at) {
    throw new Error(`Deleted frame ${cleanFrameId} media asset ${media.id} is not deleted.`);
  }
  if (
    media.asset_type !== "frame_jpeg"
    || !String(media.relative_path || "").startsWith("media/frames/deleted/")
    || Number(media.byte_size) !== 0
    || Number(media.encrypted) !== 0
    || String(media.sha256 || "") !== "0".repeat(64)
  ) {
    throw new Error(`Deleted frame ${cleanFrameId} media asset ${media.id} has incomplete tombstone fields.`);
  }
  const mediaPath = mediaPathFor(appSupportRoot, media);
  const mediaExists = mediaPath ? fs.existsSync(mediaPath) : false;
  if (mediaExists) {
    throw new Error(`Deleted frame ${cleanFrameId} tombstone media path still exists: ${mediaPath}`);
  }
  const search = buildRecorderSearchResults({
    store,
    query,
    sourceTypes: ["frame"],
    limit: 12,
  });
  const matching = search.results.find((row) => row.sourceType === "frame" && row.sourceId === cleanFrameId);
  if (matching) {
    throw new Error(`Deleted frame ${cleanFrameId} still appears in redacted search results.`);
  }
  return { frame, media, mediaPath, summary: summarizeDeletedFrame(frame, media, mediaPath, mediaExists, search), search };
}

function assertSearchEvidence(store, query, frameId) {
  const search = buildRecorderSearchResults({
    store,
    query,
    sourceTypes: ["frame"],
    limit: 12,
  });
  const matching = search.results.find((row) => row.sourceType === "frame" && row.sourceId === frameId);
  if (!matching) {
    throw new Error(`Redacted search query "${query}" did not return live frame ${frameId}.`);
  }
  const proofAcceptedBySearch = Boolean(
    search.proofBoundary?.proofAcceptedBySearch
      ?? search.proof_boundary?.proof_accepted_by_search
      ?? false,
  );
  if (proofAcceptedBySearch) {
    throw new Error("Recorder search result claims proofAcceptedBySearch=true; search hits are never proof.");
  }
  return {
    schema: search.schema,
    resultCount: search.resultCount,
    proofAcceptedBySearch,
    matchingResult: {
      id: matching.id,
      sourceId: matching.sourceId,
      timestamp: matching.timestamp,
      snippet: matching.snippet,
      metadata: matching.metadata,
    },
  };
}

function assertAudioEvidence(appSupportRoot, store, allowMissingAudio) {
  let audio = findLiveAudioChunk(store);
  if (!audio) {
    if (allowMissingAudio) return { status: "missing_allowed" };
    const latestAudio = findLatestAudioChunk(store);
    if (latestAudio) {
      assertLiveRecorderAudioChunkRow(store, latestAudio.id);
    }
    throw new Error("No live audio-<uuid> chunk found. Re-run with --allow-missing-audio only for frame-only acceptance triage.");
  }
  audio = assertLiveRecorderAudioChunkRow(store, audio.id);
  const media = store.getRecord("media_assets", audio.audio_asset_id);
  const mediaPath = mediaPathFor(appSupportRoot, media);
  const mediaExists = mediaPath ? fs.existsSync(mediaPath) : false;
  if (!media || !mediaExists || Number(media.byte_size || 0) <= 0) {
    throw new Error(`Live audio chunk ${audio.id} media file is missing or empty: ${mediaPath || "<invalid path>"}`);
  }
  return {
    id: audio.id,
    startedAt: audio.started_at,
    endedAt: audio.ended_at,
    source: audio.source,
    transcriptStatus: audio.transcript_status,
    rawAudioIndicatorState: audio.raw_audio_indicator_state,
    mediaAssetId: media.id,
    mediaRelativePath: media.relative_path,
    mediaByteSize: Number(media.byte_size || 0),
    mediaPath,
  };
}

function summarizeReadinessItems(items = []) {
  return items.map((item) => ({
    id: String(item?.id || ""),
    severity: String(item?.severity || ""),
    message: String(item?.message || ""),
    permission: String(item?.permission || ""),
    state: String(item?.state || ""),
  }));
}

async function assertControlStateEvidence(appSupportRoot) {
  const controlState = await loadRecorderControlState({ appSupportRoot });
  const readiness = evaluateRecorderCaptureReadiness(controlState, { now: new Date() });
  const consent = controlState.consent || {};
  if (consent.status !== "granted") {
    throw new Error(`Recorder control consent must be granted before live recorder acceptance: ${consent.status || "unknown"}`);
  }
  if (consent.visibleIndicatorRequired !== true || consent.visibleIndicatorAcknowledged !== true) {
    throw new Error("Recorder control visible indicator must be required and acknowledged before live recorder acceptance.");
  }
  const permissions = controlState.permissions || {};
  const requiredPermissions = ["screenRecording", "accessibility", "inputMonitoring"];
  const missingPermissions = requiredPermissions.filter((permission) => permissions[permission] !== "granted");
  if (missingPermissions.length) {
    throw new Error(`Recorder control state is missing granted permissions: ${missingPermissions.join(", ")}`);
  }
  const modeReadiness = readiness.modeReadiness || readiness.mode_readiness || {};
  const coreFrameCapture = modeReadiness.coreFrameCapture || modeReadiness.core_frame_capture || {};
  const eventDrivenCapture = modeReadiness.eventDrivenCapture || modeReadiness.event_driven_capture || {};
  if (readiness.canRecord !== true || coreFrameCapture.ready !== true || eventDrivenCapture.ready !== true) {
    throw new Error(`Recorder control state is not ready for live frame/event capture: ${JSON.stringify({
      canRecord: readiness.canRecord,
      coreFrameCaptureReady: coreFrameCapture.ready,
      eventDrivenCaptureReady: eventDrivenCapture.ready,
      blockers: summarizeReadinessItems(readiness.blockers),
    })}`);
  }
  return {
    schema: "agentic30.live_recorder_control_state.v1",
    mode: controlState.mode,
    consentStatus: consent.status,
    consentGrantId: consent.grantId || consent.grant_id || "",
    visibleIndicatorRequired: consent.visibleIndicatorRequired === true,
    visibleIndicatorAcknowledged: consent.visibleIndicatorAcknowledged === true,
    permissions: {
      screenRecording: permissions.screenRecording,
      accessibility: permissions.accessibility,
      inputMonitoring: permissions.inputMonitoring,
    },
    readiness: {
      schema: readiness.schema,
      canRecord: readiness.canRecord === true,
      state: readiness.state,
      coreFrameCaptureReady: coreFrameCapture.ready === true,
      eventDrivenCaptureReady: eventDrivenCapture.ready === true,
      blockers: summarizeReadinessItems(readiness.blockers),
      warnings: summarizeReadinessItems(readiness.warnings),
      proofAcceptedByReadiness: false,
    },
    proofAccepted: false,
  };
}

function summarizeDeletedAudioChunk(audio, media, mediaPath, mediaExists) {
  return {
    id: audio.id,
    deletedAt: audio.deleted_at,
    redactionStatus: audio.redaction_status,
    privacyState: audio.privacy_state,
    mediaAssetId: media?.id || "",
    mediaRelativePath: media?.relative_path || "",
    mediaDeletedAt: media?.deleted_at || "",
    mediaByteSize: Number(media?.byte_size || 0),
    mediaPath,
    mediaExists,
  };
}

function assertDeletedAudioEvidence(appSupportRoot, store, audioId) {
  const cleanAudioId = String(audioId || "").trim();
  if (!cleanAudioId) {
    throw new Error("Deleted-audio verifier requires an audio id.");
  }
  const audio = store.getRecord("audio_chunks", cleanAudioId);
  if (!audio) {
    throw new Error(`Deleted-audio verifier could not find audio chunk ${cleanAudioId}.`);
  }
  if (!audio.deleted_at) {
    throw new Error(`Audio chunk ${cleanAudioId} is not deleted.`);
  }
  if (audio.redaction_status !== "deleted" || audio.privacy_state !== "deleted") {
    throw new Error(`Deleted audio chunk ${cleanAudioId} has incomplete tombstone flags.`);
  }
  const media = store.getRecord("media_assets", audio.audio_asset_id);
  if (!media) {
    throw new Error(`Deleted audio chunk ${cleanAudioId} is missing media asset ${audio.audio_asset_id}.`);
  }
  if (!media.deleted_at) {
    throw new Error(`Deleted audio chunk ${cleanAudioId} media asset ${media.id} is not deleted.`);
  }
  if (
    media.asset_type !== "audio_m4a"
    || !String(media.relative_path || "").startsWith("media/audio/deleted/")
    || Number(media.byte_size) !== 0
    || Number(media.encrypted) !== 0
    || String(media.sha256 || "") !== "0".repeat(64)
  ) {
    throw new Error(`Deleted audio chunk ${cleanAudioId} media asset ${media.id} has incomplete tombstone fields.`);
  }
  const mediaPath = mediaPathFor(appSupportRoot, media);
  const mediaExists = mediaPath ? fs.existsSync(mediaPath) : false;
  if (mediaExists) {
    throw new Error(`Deleted audio chunk ${cleanAudioId} tombstone media path still exists: ${mediaPath}`);
  }
  return {
    audio,
    media,
    mediaPath,
    summary: summarizeDeletedAudioChunk(audio, media, mediaPath, mediaExists),
  };
}

function summarizeRecentFrames(store, limit = 8) {
  return store
    .listRecords("frames", { limit, orderBy: "captured_at", direction: "DESC" })
    .map((row) => ({
      id: row.id,
      capturedAt: row.captured_at,
      captureTrigger: row.capture_trigger,
      textSource: row.text_source,
      redactionStatus: row.redaction_status,
      privacyState: row.privacy_state,
      safeForSearch: Number(row.safe_for_search) === 1,
      snapshotAssetId: row.snapshot_asset_id,
      deletedAt: row.deleted_at || "",
      liveCaptured: isLiveCapturedFrameRow(row),
      seedFixture: isSeedFixtureFrameRow(row),
    }));
}

function summarizeRecentAudioChunks(store, limit = 8) {
  return store
    .listRecords("audio_chunks", { limit, orderBy: "started_at", direction: "DESC" })
    .map((row) => ({
      id: row.id,
      startedAt: row.started_at,
      source: row.source,
      transcriptStatus: row.transcript_status,
      rawAudioIndicatorState: row.raw_audio_indicator_state,
      consentGrantId: row.consent_grant_id,
      audioAssetId: row.audio_asset_id,
      deletedAt: row.deleted_at || "",
      liveCaptured: isLiveCapturedAudioChunkRow(row),
    }));
}

function buildLiveVerifierFailureContext({
  appSupportRoot,
  dbPath,
  launchServicesHandoff,
  liveCaptureSummary,
  store,
} = {}) {
  return {
    appSupportRoot,
    recorderDatabase: dbPath,
    launchServicesHandoff,
    launchDiagnostics: loadLaunchDiagnostics(launchServicesHandoff?.diagnostics),
    liveCaptureSummary,
    recentFrames: summarizeRecentFrames(store),
    recentAudioChunks: summarizeRecentAudioChunks(store),
    proofAccepted: false,
  };
}

function buildLiveFailureEvidence(error, context) {
  const message = error?.message || String(error);
  return {
    schema: "agentic30.live_recorder_acceptance_failure.v1",
    generatedAt: new Date().toISOString(),
    error: {
      name: error?.name || "Error",
      code: error?.code || "",
      message,
    },
    ...context,
  };
}

function rethrowWithLiveFailureContext(error, failureEvidence) {
  const message = error?.message || String(error);
  const enriched = new Error(`${message}\n\nLive recorder verifier failure context:\n${JSON.stringify(failureEvidence, null, 2)}`);
  enriched.cause = error;
  throw enriched;
}

function retentionEvaluationNowFromEvidence(timestamps = []) {
  const retentionWindowMs = LIVE_ACCEPTANCE_RETENTION_HOURS * 60 * 60 * 1000;
  const latestEvidenceTime = timestamps
    .map((timestamp) => Date.parse(String(timestamp || "")))
    .filter((value) => Number.isFinite(value))
    .reduce((latest, value) => Math.max(latest, value), 0);
  if (latestEvidenceTime <= 0) return new Date();
  return new Date(latestEvidenceTime + retentionWindowMs + LIVE_ACCEPTANCE_RETENTION_MARGIN_MS);
}

async function applyTinyRetention(store, { timestamps = [] } = {}) {
  const now = retentionEvaluationNowFromEvidence(timestamps);
  const result = await applyRecorderRetentionPolicy(store, {
    policy: {
      rawFrameRetentionHours: LIVE_ACCEPTANCE_RETENTION_HOURS,
      rawAudioRetentionHours: LIVE_ACCEPTANCE_RETENTION_HOURS,
    },
    now,
  });
  return {
    ...result,
    evaluatedAt: now.toISOString(),
    evaluated_at: now.toISOString(),
    acceptanceRetentionHours: LIVE_ACCEPTANCE_RETENTION_HOURS,
    acceptance_retention_hours: LIVE_ACCEPTANCE_RETENTION_HOURS,
  };
}

function assertRetentionResult(retention, { audioRequired = true, frameRequired = true } = {}) {
  if (!retention) return null;
  const deletedFrameCount = Number(retention.deletedFrameCount ?? retention.deleted_frame_count ?? 0);
  const deletedAudioChunkCount = Number(retention.deletedAudioChunkCount ?? retention.deleted_audio_chunk_count ?? 0);
  const deletedMediaCount = Number(retention.deletedMediaCount ?? retention.deleted_media_count ?? 0);
  if (retention.status !== "applied" || deletedMediaCount < 1) {
    throw new Error(`Retention did not purge a live media asset: ${JSON.stringify({
      status: retention.status,
      deletedFrameCount,
      deletedAudioChunkCount,
      deletedMediaCount,
    })}`);
  }
  if (frameRequired && deletedFrameCount < 1) {
    throw new Error(`Retention did not purge a live frame: ${JSON.stringify({
      status: retention.status,
      deletedFrameCount,
      deletedAudioChunkCount,
      deletedMediaCount,
    })}`);
  }
  if (audioRequired && deletedAudioChunkCount < 1) {
    throw new Error(`Retention did not purge a live audio chunk: ${JSON.stringify({
      status: retention.status,
      deletedFrameCount,
      deletedAudioChunkCount,
      deletedMediaCount,
    })}`);
  }
  return {
    status: retention.status,
    evaluatedAt: retention.evaluatedAt ?? retention.evaluated_at ?? "",
    deletedFrameCount,
    deletedAudioChunkCount,
    deletedMediaCount,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(USAGE);
    return;
  }
  const launchServicesHandoff = options.launchServicesHandoffPath
    ? loadLaunchServicesHandoff(options.launchServicesHandoffPath)
    : null;
  const appSupportRoot = resolveAppSupportRoot(options, launchServicesHandoff);
  if (!appSupportRoot || appSupportRoot === path.parse(appSupportRoot).root) {
    throw new Error("--app-support must point to the live run app-support root.");
  }
  if (options.audioOnly && options.frameId) {
    throw new Error("--audio-only cannot be combined with --frame-id.");
  }
  if (options.audioOnly && options.deletedFrameId) {
    throw new Error("--audio-only cannot be combined with --deleted-frame-id.");
  }
  if (options.audioOnly && options.allowMissingAudio) {
    throw new Error("--audio-only cannot be combined with --allow-missing-audio.");
  }
  const dbPath = path.join(appSupportRoot, "recorder", "recorder.sqlite");
  if (!fs.existsSync(dbPath)) {
    throw new Error(`Missing recorder database: ${dbPath}`);
  }

  const store = new RecorderStore({ appSupportRoot }).open();
  try {
    if (!options.skipWalCheckpoint) {
      store.database().pragma("wal_checkpoint(TRUNCATE)");
    }
    if (options.audioOnly) {
      const liveCaptureSummary = summarizeLiveRecorderCapture(store);
      let audio;
      let retention;
      let controlStateEvidence;
      try {
        controlStateEvidence = await assertControlStateEvidence(appSupportRoot);
        audio = assertAudioEvidence(appSupportRoot, store, false);
        if (options.applyRetention) {
          const retentionResult = assertRetentionResult(await applyTinyRetention(store, {
            timestamps: [audio.startedAt],
          }), {
            audioRequired: true,
            frameRequired: false,
          });
          const deletedLiveAudio = assertDeletedAudioEvidence(appSupportRoot, store, audio.id);
          retention = {
            ...retentionResult,
            deletedLiveAudio: deletedLiveAudio.summary,
          };
        }
      } catch (error) {
        const failureEvidence = buildLiveFailureEvidence(error, buildLiveVerifierFailureContext({
          appSupportRoot,
          dbPath,
          launchServicesHandoff,
          liveCaptureSummary,
          store,
        }));
        await writeEvidenceJson(options.jsonOutput, failureEvidence);
        rethrowWithLiveFailureContext(error, failureEvidence);
      }
      const evidence = {
        schema: "agentic30.live_recorder_audio_acceptance.v1",
        generatedAt: new Date().toISOString(),
        appSupportRoot,
        launchServicesHandoff,
        recorderDatabase: dbPath,
        repoRoot,
        liveCaptureSummary,
        controlState: controlStateEvidence,
        audio,
        retention,
        proofAccepted: false,
      };
      await writeEvidenceJson(options.jsonOutput, evidence);
      process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
      return;
    }
    if (options.deletedFrameId) {
      if (options.applyRetention) {
        throw new Error("--deleted-frame-id cannot be combined with --apply-retention.");
      }
      const deletedFrame = assertDeletedFrameEvidence(appSupportRoot, store, options.deletedFrameId, options.searchQuery);
      const evidence = {
        schema: "agentic30.live_recorder_delete_acceptance.v1",
        generatedAt: new Date().toISOString(),
        appSupportRoot,
        launchServicesHandoff,
        recorderDatabase: dbPath,
        repoRoot,
        requestedDeletedFrameId: options.deletedFrameId,
        deletedFrame: deletedFrame.summary,
        proofAccepted: false,
      };
      await writeEvidenceJson(options.jsonOutput, evidence);
      process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
      return;
    }
    const liveCaptureSummary = summarizeLiveRecorderCapture(store);
    let liveFrame;
    let search;
    let audio;
    let rawReadAudit;
    let retention;
    let controlStateEvidence;
    try {
      liveFrame = assertLiveFrameEvidence(appSupportRoot, store, options.frameId);
      controlStateEvidence = await assertControlStateEvidence(appSupportRoot);
      search = assertSearchEvidence(store, options.searchQuery, liveFrame.frame.id);
      audio = assertAudioEvidence(appSupportRoot, store, options.allowMissingAudio);
      rawReadAudit = assertRawReadAuditEvidence(store, liveFrame.frame.id, options.allowMissingAudit);
      if (options.applyRetention) {
        const retentionTimestamps = [
          liveFrame.frame.captured_at,
          audio.status === "missing_allowed" ? "" : audio.startedAt,
        ];
        const retentionResult = assertRetentionResult(await applyTinyRetention(store, {
          timestamps: retentionTimestamps,
        }), {
          audioRequired: audio.status !== "missing_allowed",
        });
        const deletedLiveFrame = assertDeletedFrameEvidence(appSupportRoot, store, liveFrame.frame.id, options.searchQuery);
        const deletedLiveAudio = audio.status === "missing_allowed"
          ? null
          : assertDeletedAudioEvidence(appSupportRoot, store, audio.id);
        retention = {
          ...retentionResult,
          deletedLiveFrame: deletedLiveFrame.summary,
          deletedLiveAudio: deletedLiveAudio?.summary ?? null,
        };
      }
    } catch (error) {
      const failureEvidence = buildLiveFailureEvidence(error, buildLiveVerifierFailureContext({
        appSupportRoot,
        dbPath,
        launchServicesHandoff,
        liveCaptureSummary,
        store,
      }));
      await writeEvidenceJson(options.jsonOutput, failureEvidence);
      rethrowWithLiveFailureContext(error, failureEvidence);
    }
    // Triage flags must not be able to mint the acceptance schema: a run that
    // skipped audio or raw-read-audit evidence is a triage run, and its JSON
    // must say so structurally, not just in a nested status field.
    const triageReasons = [];
    if (audio?.status === "missing_allowed") triageReasons.push("audio_missing_allowed");
    if (rawReadAudit?.status === "missing_allowed") triageReasons.push("raw_read_audit_missing_allowed");
    const evidence = {
      schema: triageReasons.length
        ? "agentic30.live_recorder_triage.v1"
        : "agentic30.live_recorder_acceptance.v1",
      acceptance: triageReasons.length === 0,
      triageReasons,
      generatedAt: new Date().toISOString(),
      appSupportRoot,
      launchServicesHandoff,
      recorderDatabase: dbPath,
      repoRoot,
      requestedFrameId: options.frameId || null,
      liveCaptureSummary,
      controlState: controlStateEvidence,
      liveFrame: liveFrame.summary,
      search,
      audio,
      rawReadAudit,
      retention,
      proofAccepted: false,
    };
    await writeEvidenceJson(options.jsonOutput, evidence);
    process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
  } finally {
    store.close();
  }
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error?.message || String(error)}\n`);
  process.exitCode = 1;
});
