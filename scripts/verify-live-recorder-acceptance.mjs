#!/usr/bin/env node
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { applyRecorderRetentionPolicy } from "../sidecar/recorder-retention.mjs";
import {
  assertLiveRecorderAudioChunkRow,
  assertLiveRecorderFrameRow,
  isLiveCapturedAudioChunkRow,
  isLiveCapturedFrameRow,
  summarizeLiveRecorderCapture,
} from "../sidecar/recorder-live-verify.mjs";
import { buildRecorderSearchResults } from "../sidecar/recorder-search.mjs";
import { RecorderStore } from "../sidecar/recorder-store.mjs";

const USAGE = `Usage: node scripts/verify-live-recorder-acceptance.mjs --app-support <path> [options]

Options:
  --search-query <text>       Query used for redacted frame search (default: Agentic30)
  --frame-id <id>             Require the verifier to validate this live frame id
  --deleted-frame-id <id>     Require this frame id to be deleted/tombstoned
  --apply-retention           Apply a tiny retention window to prove purge behavior
  --json-output <path>        Write the evidence JSON to a file
  --allow-missing-audio       Do not fail when no live audio-<uuid> chunk exists
  --allow-missing-audit       Do not fail when no accepted raw-read audit exists
  --skip-wal-checkpoint       Do not checkpoint WAL before reading the DB
  --help                      Show this message
`;

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LIVE_FRAME_RAW_READ_ENDPOINT_PATTERN = /^\/recorder\/frames\/([^/]+)\/(?:text|image)$/;

function parseArgs(argv) {
  const options = {
    appSupportPath: process.env.AGENTIC30_APP_SUPPORT_PATH || "",
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
  return {
    schema: search.schema,
    resultCount: search.resultCount,
    proofAcceptedBySearch: Boolean(
      search.proofBoundary?.proofAcceptedBySearch
        ?? search.proof_boundary?.proof_accepted_by_search
        ?? false,
    ),
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
    source: audio.source,
    transcriptStatus: audio.transcript_status,
    rawAudioIndicatorState: audio.raw_audio_indicator_state,
    mediaAssetId: media.id,
    mediaRelativePath: media.relative_path,
    mediaByteSize: Number(media.byte_size || 0),
    mediaPath,
  };
}

async function applyTinyRetention(store) {
  return applyRecorderRetentionPolicy(store, {
    policy: {
      rawFrameRetentionHours: 0.0001,
      rawAudioRetentionHours: 0.0001,
    },
    now: new Date(),
  });
}

function assertRetentionResult(retention, { audioRequired = true } = {}) {
  if (!retention) return null;
  const deletedFrameCount = Number(retention.deletedFrameCount ?? retention.deleted_frame_count ?? 0);
  const deletedAudioChunkCount = Number(retention.deletedAudioChunkCount ?? retention.deleted_audio_chunk_count ?? 0);
  const deletedMediaCount = Number(retention.deletedMediaCount ?? retention.deleted_media_count ?? 0);
  if (retention.status !== "applied" || deletedFrameCount < 1 || deletedMediaCount < 1) {
    throw new Error(`Retention did not purge a live frame/media asset: ${JSON.stringify({
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
  return { status: retention.status, deletedFrameCount, deletedAudioChunkCount, deletedMediaCount };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(USAGE);
    return;
  }
  const appSupportRoot = path.resolve(options.appSupportPath);
  if (!appSupportRoot || appSupportRoot === path.parse(appSupportRoot).root) {
    throw new Error("--app-support must point to the live run app-support root.");
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
    if (options.deletedFrameId) {
      if (options.applyRetention) {
        throw new Error("--deleted-frame-id cannot be combined with --apply-retention.");
      }
      const deletedFrame = assertDeletedFrameEvidence(appSupportRoot, store, options.deletedFrameId, options.searchQuery);
      const evidence = {
        schema: "agentic30.live_recorder_delete_acceptance.v1",
        generatedAt: new Date().toISOString(),
        appSupportRoot,
        recorderDatabase: dbPath,
        repoRoot,
        requestedDeletedFrameId: options.deletedFrameId,
        deletedFrame: deletedFrame.summary,
        proofAccepted: false,
      };
      if (options.jsonOutput) {
        await fsp.mkdir(path.dirname(path.resolve(options.jsonOutput)), { recursive: true });
        await fsp.writeFile(path.resolve(options.jsonOutput), `${JSON.stringify(evidence, null, 2)}\n`);
      }
      process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
      return;
    }
    const liveCaptureSummary = summarizeLiveRecorderCapture(store);
    const liveFrame = assertLiveFrameEvidence(appSupportRoot, store, options.frameId);
    const search = assertSearchEvidence(store, options.searchQuery, liveFrame.frame.id);
    const audio = assertAudioEvidence(appSupportRoot, store, options.allowMissingAudio);
    const rawReadAudit = assertRawReadAuditEvidence(store, liveFrame.frame.id, options.allowMissingAudit);
    const retention = options.applyRetention
      ? assertRetentionResult(await applyTinyRetention(store), { audioRequired: audio.status !== "missing_allowed" })
      : null;
    const evidence = {
      schema: "agentic30.live_recorder_acceptance.v1",
      generatedAt: new Date().toISOString(),
      appSupportRoot,
      recorderDatabase: dbPath,
      repoRoot,
      requestedFrameId: options.frameId || null,
      liveCaptureSummary,
      liveFrame: liveFrame.summary,
      search,
      audio,
      rawReadAudit,
      retention,
      proofAccepted: false,
    };
    if (options.jsonOutput) {
      await fsp.mkdir(path.dirname(path.resolve(options.jsonOutput)), { recursive: true });
      await fsp.writeFile(path.resolve(options.jsonOutput), `${JSON.stringify(evidence, null, 2)}\n`);
    }
    process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
  } finally {
    store.close();
  }
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error?.message || String(error)}\n`);
  process.exitCode = 1;
});
