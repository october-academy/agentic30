#!/usr/bin/env node
import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const DEFAULT_STATE_PATH = ".omx/posthog-release-funnel-state.json";
const DEFAULT_REPO = "october-academy/agentic30-private";
const DEFAULT_HOST = "https://us.i.posthog.com";

function parseArgs(argv) {
  const args = {
    repo: process.env.GITHUB_REPOSITORY || DEFAULT_REPO,
    tag: process.env.AGENTIC30_RELEASE_TAG || "",
    asset: process.env.AGENTIC30_INSTALLER_ASSET_NAME || process.env.AGENTIC30_DMG_ASSET_NAME || "",
    state: process.env.AGENTIC30_RELEASE_FUNNEL_STATE || DEFAULT_STATE_PATH,
    event: "installer_downloaded",
    source: "github_release_asset",
    dryRun: false,
    maxEvents: 1000,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const readValue = () => {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`Missing value for ${arg}`);
      }
      index += 1;
      return value;
    };

    if (arg === "--repo") args.repo = readValue();
    else if (arg === "--tag") args.tag = readValue();
    else if (arg === "--asset") args.asset = readValue();
    else if (arg === "--state") args.state = readValue();
    else if (arg === "--event") args.event = readValue();
    else if (arg === "--source") args.source = readValue();
    else if (arg === "--max-events") args.maxEvents = Number.parseInt(readValue(), 10);
    else if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!Number.isFinite(args.maxEvents) || args.maxEvents < 1) {
    throw new Error("--max-events must be a positive integer");
  }
  return args;
}

function usage() {
  return `Usage: node scripts/posthog-release-funnel.mjs [options]

Poll GitHub release asset download_count via gh CLI and emit new installer downloads
to PostHog as installer_downloaded events.

Options:
  --repo <owner/name>     GitHub repo to inspect (default: ${DEFAULT_REPO})
  --tag <tag>             Release tag. Omit to use latest release.
  --asset <name>          Exact asset name. Omit to track .pkg and .dmg assets.
  --state <path>          Local state file (default: ${DEFAULT_STATE_PATH})
  --dry-run               Print planned events without sending PostHog captures.
  --max-events <n>        Safety cap per run (default: 1000)

Environment:
  POSTHOG_PROJECT_TOKEN or POSTHOG_API_KEY  Project token used for capture.
  POSTHOG_HOST                             Ingest host (default: ${DEFAULT_HOST}).
`;
}

async function ghApi(pathname) {
  const { stdout } = await execFileAsync("gh", ["api", pathname], {
    maxBuffer: 10 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

async function loadRelease(repo, tag) {
  const releasePath = tag
    ? `repos/${repo}/releases/tags/${encodeURIComponent(tag)}`
    : `repos/${repo}/releases/latest`;
  return ghApi(releasePath);
}

async function loadState(statePath) {
  try {
    const raw = await fs.readFile(statePath, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (error) {
    if (error?.code === "ENOENT") return {};
    throw error;
  }
}

async function saveState(statePath, state) {
  await fs.mkdir(path.dirname(statePath), { recursive: true });
  // Atomic write: temp sibling + rename so a crashed/concurrent run never
  // leaves a partial JSON file. fs.rename is POSIX-atomic on the same FS.
  const tempPath = `${statePath}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await fs.rename(tempPath, statePath);
}

function trimmedEnv(name) {
  const raw = process.env[name];
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function selectedAssets(release, assetName = "") {
  const assets = Array.isArray(release?.assets) ? release.assets : [];
  if (assetName) {
    return assets.filter((asset) => asset.name === assetName);
  }
  return assets.filter((asset) => {
    const name = String(asset.name || "").toLowerCase();
    return name.endsWith(".pkg") || name.endsWith(".dmg");
  });
}

function stateKeyForAsset(asset) {
  return String(asset.id ?? asset.name);
}

function downloadInsertID(stateKey, downloadIndex) {
  return `github-release-asset-${stateKey}-download-${downloadIndex}`;
}

function deterministicUUID(value) {
  const hex = crypto.createHash("sha256").update(value).digest("hex").slice(0, 32);
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `5${hex.slice(13, 16)}`,
    ((Number.parseInt(hex.slice(16, 18), 16) & 0x3f) | 0x80).toString(16).padStart(2, "0") + hex.slice(18, 20),
    hex.slice(20, 32),
  ].join("-");
}

export function computeDownloadEvents({
  release,
  assets,
  previousState = {},
  repo,
  event = "installer_downloaded",
  source = "github_release_asset",
  maxEvents = 1000,
}) {
  const nextState = { ...previousState };
  const events = [];
  let skippedEvents = 0;

  for (const asset of assets) {
    const stateKey = stateKeyForAsset(asset);
    const previousCount = Number(previousState[stateKey]?.download_count ?? 0);
    const totalCount = Number(asset.download_count ?? 0);
    const delta = Math.max(0, totalCount - previousCount);
    const emitCount = Math.min(delta, Math.max(0, maxEvents - events.length));
    skippedEvents += delta - emitCount;

    for (let offset = 1; offset <= emitCount; offset += 1) {
      const downloadIndex = previousCount + offset;
      const insertID = downloadInsertID(stateKey, downloadIndex);
      const eventUUID = deterministicUUID(insertID);
      events.push({
        event,
        distinct_id: insertID,
        uuid: eventUUID,
        properties: {
          event_schema_version: 1,
          source,
          repo,
          idempotency_key: insertID,
          release_id: release.id,
          release_tag: release.tag_name,
          release_name: release.name || "",
          asset_id: asset.id,
          asset_name: asset.name,
          asset_label: asset.label || "",
          asset_content_type: asset.content_type || "",
          asset_size: asset.size || 0,
          download_index: downloadIndex,
          download_count_total: totalCount,
          download_count_delta: delta,
          browser_download_url: asset.browser_download_url || "",
        },
      });
    }

    nextState[stateKey] = {
      asset_id: asset.id,
      asset_name: asset.name,
      release_id: release.id,
      release_tag: release.tag_name,
      download_count: totalCount,
      checked_at: new Date().toISOString(),
    };
  }

  return { events, nextState, skippedEvents };
}

export function normalizePostHogHost(rawHost = DEFAULT_HOST) {
  const trimmed = String(rawHost || "").trim() || DEFAULT_HOST;
  const withScheme = trimmed.includes("://") ? trimmed : `https://${trimmed}`;
  const url = new URL(withScheme);
  if (url.hostname === "us.posthog.com") return `${url.protocol}//us.i.posthog.com`;
  if (url.hostname === "eu.posthog.com") return `${url.protocol}//eu.i.posthog.com`;
  return `${url.protocol}//${url.host}`;
}

export function buildPostHogPayload(projectToken, event) {
  return {
    api_key: projectToken,
    event: event.event,
    distinct_id: event.distinct_id,
    uuid: event.uuid,
    properties: event.properties,
    timestamp: new Date().toISOString(),
  };
}

async function sendPostHogEvent({ host, projectToken, event }) {
  const base = normalizePostHogHost(host);
  const response = await fetch(new URL("i/v0/e/", `${base}/`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildPostHogPayload(projectToken, event)),
  });
  if (!response.ok) {
    throw new Error(`PostHog capture failed (${response.status}): ${await response.text()}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }

  const release = await loadRelease(args.repo, args.tag);
  const assets = selectedAssets(release, args.asset);
  if (assets.length === 0) {
    throw new Error(args.asset
      ? `No release asset named ${args.asset}`
      : "No .dmg release assets found");
  }

  const previousState = await loadState(args.state);
  const { events, nextState, skippedEvents } = computeDownloadEvents({
    release,
    assets,
    previousState,
    repo: args.repo,
    event: args.event,
    source: args.source,
    maxEvents: args.maxEvents,
  });

  console.log(JSON.stringify({
    repo: args.repo,
    release_tag: release.tag_name,
    assets: assets.map((asset) => ({
      id: asset.id,
      name: asset.name,
      download_count: asset.download_count,
    })),
    events_to_send: events.length,
    skipped_events: skippedEvents,
    dry_run: args.dryRun,
  }, null, 2));

  if (args.dryRun) {
    return;
  }

  if (events.length === 0) {
    await saveState(args.state, nextState);
    return;
  }

  const projectToken = trimmedEnv("POSTHOG_PROJECT_TOKEN") || trimmedEnv("POSTHOG_API_KEY");
  if (!projectToken) {
    throw new Error("POSTHOG_PROJECT_TOKEN or POSTHOG_API_KEY is required unless --dry-run is used");
  }
  const host = trimmedEnv("POSTHOG_HOST") || DEFAULT_HOST;

  // Track per-asset high water marks so a partial failure persists exactly
  // the events we successfully sent, not the totalCount computeDownloadEvents
  // optimistically wrote into nextState. Resume from the cursor next run.
  // Deterministic uuid per event (PostHog ingest dedupes on it) makes any
  // residual replay idempotent.
  const sentHighWater = {};
  for (const stateKey of Object.keys(nextState)) {
    sentHighWater[stateKey] = Number(previousState[stateKey]?.download_count ?? 0);
  }

  try {
    for (const event of events) {
      await sendPostHogEvent({ host, projectToken, event });
      const stateKey = String(event.properties.asset_id);
      sentHighWater[stateKey] = event.properties.download_index;
    }
  } finally {
    for (const [stateKey, highWater] of Object.entries(sentHighWater)) {
      if (nextState[stateKey]) {
        nextState[stateKey].download_count = highWater;
      }
    }
    await saveState(args.state, nextState);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error?.stack || error?.message || String(error));
    process.exitCode = 1;
  });
}
