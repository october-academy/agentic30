import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { resolveRecorderFrameMediaPath } from "../sidecar/recorder-delete.mjs";
import { recordFrameCaptureEnvelope } from "../sidecar/recorder-ingest.mjs";
import {
  RecorderRetentionError,
  applyRecorderRetentionPolicy,
  buildRecorderRetentionPlan,
  normalizeRecorderRetentionPolicy,
} from "../sidecar/recorder-retention.mjs";
import { RecorderStore } from "../sidecar/recorder-store.mjs";

async function makeStore() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-recorder-retention-"));
  const store = new RecorderStore({ appSupportRoot: path.join(root, "app-support") }).open();
  return { root, store };
}

function frameEnvelope({ id, assetId, capturedAt, text, workspaceId = "workspace-1" } = {}) {
  return {
    id,
    workspaceId,
    projectId: "project-1",
    capturedAt,
    monitorId: "main",
    captureTrigger: "typing_pause",
    appName: "Codex",
    windowTitle: "Founder Memory OS",
    contentHash: `sha256:${id}`,
    privacyState: "search_safe",
    dataClass: "screen",
    safeForSearch: true,
    safeForMemory: true,
    safeForExport: false,
    snapshot: {
      id: assetId,
      relativePath: `media/frames/2026-06-27/${id}.jpg`,
      sha256: `sha256:${assetId}`,
      byteSize: 14,
    },
    text: {
      textSource: "accessibility",
      accessibilityText: `raw ${id}@example.com`,
      redactedText: text,
      redactionStatus: "redacted",
    },
  };
}

async function writePhysicalMedia(store, assetId) {
  const media = store.getRecord("media_assets", assetId);
  const mediaPath = resolveRecorderFrameMediaPath(store, media);
  await fs.mkdir(path.dirname(mediaPath), { recursive: true });
  await fs.writeFile(mediaPath, "jpeg bytes here");
  return mediaPath;
}

test("buildRecorderRetentionPlan targets only expired frame media in scope", async () => {
  const { store } = await makeStore();
  try {
    recordFrameCaptureEnvelope(store, frameEnvelope({
      id: "old-frame",
      assetId: "old-asset",
      capturedAt: "2026-06-26T00:00:00.000Z",
      text: "redacted old retention proof",
    }));
    recordFrameCaptureEnvelope(store, frameEnvelope({
      id: "recent-frame",
      assetId: "recent-asset",
      capturedAt: "2026-06-27T18:00:00.000Z",
      text: "redacted recent retention proof",
    }));
    recordFrameCaptureEnvelope(store, frameEnvelope({
      id: "other-workspace-frame",
      assetId: "other-workspace-asset",
      capturedAt: "2026-06-26T00:00:00.000Z",
      workspaceId: "workspace-2",
      text: "redacted other workspace proof",
    }));

    const plan = buildRecorderRetentionPlan(store, {
      workspaceId: "workspace-1",
      projectId: "project-1",
      now: new Date("2026-06-28T12:00:00.000Z"),
    });

    assert.equal(plan.cutoffAt, "2026-06-27T12:00:00.000Z");
    assert.equal(plan.targetCount, 1);
    assert.deepEqual(plan.targets.map((target) => target.frameId), ["old-frame"]);
    assert.equal(plan.deleteRange.startedAt, "2026-06-26T00:00:00.000Z");
    assert.equal(plan.deleteRange.endedAt, "2026-06-27T12:00:00.000Z");
  } finally {
    store.close();
  }
});

test("applyRecorderRetentionPolicy physically deletes expired frames and preserves recent frames", async () => {
  const { store } = await makeStore();
  try {
    recordFrameCaptureEnvelope(store, frameEnvelope({
      id: "old-frame",
      assetId: "old-asset",
      capturedAt: "2026-06-26T00:00:00.000Z",
      text: "redacted old retention proof",
    }));
    recordFrameCaptureEnvelope(store, frameEnvelope({
      id: "recent-frame",
      assetId: "recent-asset",
      capturedAt: "2026-06-27T18:00:00.000Z",
      text: "redacted recent retention proof",
    }));
    const oldPath = await writePhysicalMedia(store, "old-asset");
    const recentPath = await writePhysicalMedia(store, "recent-asset");

    const result = await applyRecorderRetentionPolicy(store, {
      workspaceId: "workspace-1",
      projectId: "project-1",
      now: new Date("2026-06-28T12:00:00.000Z"),
    });

    assert.equal(result.status, "applied");
    assert.equal(result.deletedFrameCount, 1);
    assert.deepEqual(result.deleteResult.frameIds, ["old-frame"]);
    await assert.rejects(fs.access(oldPath), { code: "ENOENT" });
    await fs.access(recentPath);
    assert.equal(store.getRecord("frames", "old-frame").deleted_at, "2026-06-28T12:00:00.000Z");
    assert.equal(store.getRecord("frames", "recent-frame").deleted_at, null);
    assert.equal(store.search("old retention proof").length, 0);
    assert.equal(store.search("recent retention proof").length, 1);
  } finally {
    store.close();
  }
});

test("applyRecorderRetentionPolicy fails before mutation when an expired media file is missing", async () => {
  const { store } = await makeStore();
  try {
    recordFrameCaptureEnvelope(store, frameEnvelope({
      id: "old-frame-1",
      assetId: "old-asset-1",
      capturedAt: "2026-06-26T00:00:00.000Z",
      text: "redacted retained first proof",
    }));
    recordFrameCaptureEnvelope(store, frameEnvelope({
      id: "old-frame-2",
      assetId: "old-asset-2",
      capturedAt: "2026-06-26T01:00:00.000Z",
      text: "redacted retained second proof",
    }));
    const existingPath = await writePhysicalMedia(store, "old-asset-1");

    await assert.rejects(
      () => applyRecorderRetentionPolicy(store, {
        now: new Date("2026-06-28T12:00:00.000Z"),
      }),
      /ERR_RECORDER_DELETE_MEDIA_MISSING/,
    );

    await fs.access(existingPath);
    assert.equal(store.getRecord("frames", "old-frame-1").deleted_at, null);
    assert.equal(store.getRecord("frames", "old-frame-2").deleted_at, null);
    assert.equal(store.search("retained first proof").length, 1);
    assert.equal(store.search("retained second proof").length, 1);
  } finally {
    store.close();
  }
});

test("normalizeRecorderRetentionPolicy rejects invalid retention durations", () => {
  assert.throws(
    () => normalizeRecorderRetentionPolicy({ rawFrameRetentionHours: 0 }),
    (error) => error instanceof RecorderRetentionError
      && error.code === "ERR_RECORDER_RETENTION_INVALID_POLICY",
  );
});
