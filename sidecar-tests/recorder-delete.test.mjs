import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  RecorderDeleteError,
  deleteRecorderFrameCapture,
  deleteRecorderFrameCapturesInRange,
  resolveRecorderFrameMediaPath,
} from "../sidecar/recorder-delete.mjs";
import { recordFrameCaptureEnvelope } from "../sidecar/recorder-ingest.mjs";
import { RecorderStore } from "../sidecar/recorder-store.mjs";

async function makeStore() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-recorder-delete-"));
  const store = new RecorderStore({ appSupportRoot: path.join(root, "app-support") }).open();
  return { root, store };
}

function envelope(overrides = {}) {
  return {
    id: "frame-1",
    workspaceId: "workspace-1",
    projectId: "project-1",
    capturedAt: "2026-06-27T12:00:00.000Z",
    monitorId: "main",
    captureTrigger: "typing_pause",
    appName: "Codex",
    windowTitle: "Founder Memory OS",
    contentHash: "sha256:frame-content",
    privacyState: "search_safe",
    dataClass: "screen",
    safeForSearch: true,
    safeForMemory: true,
    safeForExport: true,
    snapshot: {
      id: "asset-1",
      relativePath: "media/frames/2026-06-27/frame-1.jpg",
      sha256: "sha256:snapshot",
      byteSize: 14,
      encrypted: false,
    },
    text: {
      textSource: "accessibility",
      accessibilityText: "raw private customer@example.com",
      redactedText: "redacted deletion proof",
      redactionStatus: "redacted",
    },
    ...overrides,
  };
}

async function writePhysicalMedia(store, mediaAsset) {
  const mediaPath = resolveRecorderFrameMediaPath(store, mediaAsset);
  await fs.mkdir(path.dirname(mediaPath), { recursive: true });
  await fs.writeFile(mediaPath, "jpeg bytes here");
  return mediaPath;
}

test("deleteRecorderFrameCapture removes frame media and purges frame search", async () => {
  const { store } = await makeStore();
  try {
    recordFrameCaptureEnvelope(store, envelope());
    const media = store.getRecord("media_assets", "asset-1");
    const mediaPath = await writePhysicalMedia(store, media);

    assert.equal(store.search("deletion proof").length, 1);

    const result = await deleteRecorderFrameCapture(store, "frame-1", {
      now: new Date("2026-06-27T13:00:00.000Z"),
    });

    assert.equal(result.status, "deleted");
    assert.equal(result.mediaPath, mediaPath);
    assert.equal(result.deletedAt, "2026-06-27T13:00:00.000Z");
    await assert.rejects(fs.access(mediaPath), { code: "ENOENT" });
    assert.equal(store.getRecord("frames", "frame-1").deleted_at, "2026-06-27T13:00:00.000Z");
    assert.equal(store.getRecord("media_assets", "asset-1").deleted_at, "2026-06-27T13:00:00.000Z");
    assert.deepEqual(store.search("deletion proof"), []);
  } finally {
    store.close();
  }
});

test("deleteRecorderFrameCapture fails explicitly when physical media is missing", async () => {
  const { store } = await makeStore();
  try {
    recordFrameCaptureEnvelope(store, envelope());

    await assert.rejects(
      () => deleteRecorderFrameCapture(store, "frame-1"),
      (error) => error instanceof RecorderDeleteError
        && error.code === "ERR_RECORDER_DELETE_MEDIA_MISSING",
    );
    assert.equal(store.getRecord("frames", "frame-1").deleted_at, null);
    assert.equal(store.getRecord("media_assets", "asset-1").deleted_at, null);
  } finally {
    store.close();
  }
});

test("deleteRecorderFrameCapture rejects unsafe persisted media paths before filesystem access", async () => {
  const { store } = await makeStore();
  try {
    recordFrameCaptureEnvelope(store, envelope());
    store.updateRecord("media_assets", "asset-1", {
      relative_path: "../outside.jpg",
    });

    await assert.rejects(
      () => deleteRecorderFrameCapture(store, "frame-1"),
      (error) => error instanceof RecorderDeleteError
        && error.code === "ERR_RECORDER_DELETE_UNSAFE_MEDIA_PATH",
    );
    assert.equal(store.getRecord("frames", "frame-1").deleted_at, null);
  } finally {
    store.close();
  }
});

test("deleteRecorderFrameCapturesInRange removes only scoped in-range frame media", async () => {
  const { store } = await makeStore();
  try {
    recordFrameCaptureEnvelope(store, envelope({
      id: "frame-1",
      capturedAt: "2026-06-27T09:00:00.000Z",
      snapshot: {
        id: "asset-1",
        relativePath: "media/frames/2026-06-27/frame-1.jpg",
        sha256: "sha256:snapshot-1",
        byteSize: 14,
      },
      text: {
        textSource: "accessibility",
        redactedText: "redacted morning deletion proof",
        redactionStatus: "redacted",
      },
    }));
    recordFrameCaptureEnvelope(store, envelope({
      id: "frame-2",
      capturedAt: "2026-06-27T11:00:00.000Z",
      snapshot: {
        id: "asset-2",
        relativePath: "media/frames/2026-06-27/frame-2.jpg",
        sha256: "sha256:snapshot-2",
        byteSize: 14,
      },
      text: {
        textSource: "accessibility",
        redactedText: "redacted noon deletion proof",
        redactionStatus: "redacted",
      },
    }));
    recordFrameCaptureEnvelope(store, envelope({
      id: "frame-3",
      capturedAt: "2026-06-28T09:00:00.000Z",
      snapshot: {
        id: "asset-3",
        relativePath: "media/frames/2026-06-28/frame-3.jpg",
        sha256: "sha256:snapshot-3",
        byteSize: 14,
      },
      text: {
        textSource: "accessibility",
        redactedText: "redacted next day proof",
        redactionStatus: "redacted",
      },
    }));
    const paths = [];
    for (const id of ["asset-1", "asset-2", "asset-3"]) {
      paths.push(await writePhysicalMedia(store, store.getRecord("media_assets", id)));
    }

    const result = await deleteRecorderFrameCapturesInRange(store, {
      workspaceId: "workspace-1",
      projectId: "project-1",
      startedAt: "2026-06-27T00:00:00.000Z",
      endedAt: "2026-06-28T00:00:00.000Z",
      now: new Date("2026-06-27T20:00:00.000Z"),
    });

    assert.deepEqual(result.frameIds, ["frame-1", "frame-2"]);
    assert.equal(result.frameCount, 2);
    await assert.rejects(fs.access(paths[0]), { code: "ENOENT" });
    await assert.rejects(fs.access(paths[1]), { code: "ENOENT" });
    await fs.access(paths[2]);
    assert.equal(store.getRecord("frames", "frame-1").deleted_at, "2026-06-27T20:00:00.000Z");
    assert.equal(store.getRecord("frames", "frame-2").deleted_at, "2026-06-27T20:00:00.000Z");
    assert.equal(store.getRecord("frames", "frame-3").deleted_at, null);
    assert.deepEqual(store.search("deletion proof"), []);
    assert.equal(store.search("next day proof").length, 1);
  } finally {
    store.close();
  }
});

test("deleteRecorderFrameCapturesInRange fails before mutating rows when any media file is missing", async () => {
  const { store } = await makeStore();
  try {
    recordFrameCaptureEnvelope(store, envelope({
      id: "frame-1",
      snapshot: {
        id: "asset-1",
        relativePath: "media/frames/2026-06-27/frame-1.jpg",
        sha256: "sha256:snapshot-1",
        byteSize: 14,
      },
      text: {
        textSource: "accessibility",
        redactedText: "redacted first deletion proof",
        redactionStatus: "redacted",
      },
    }));
    recordFrameCaptureEnvelope(store, envelope({
      id: "frame-2",
      capturedAt: "2026-06-27T12:10:00.000Z",
      snapshot: {
        id: "asset-2",
        relativePath: "media/frames/2026-06-27/frame-2.jpg",
        sha256: "sha256:snapshot-2",
        byteSize: 14,
      },
      text: {
        textSource: "accessibility",
        redactedText: "redacted second deletion proof",
        redactionStatus: "redacted",
      },
    }));
    const existingPath = await writePhysicalMedia(store, store.getRecord("media_assets", "asset-1"));

    await assert.rejects(
      () => deleteRecorderFrameCapturesInRange(store, {
        startedAt: "2026-06-27T00:00:00.000Z",
        endedAt: "2026-06-28T00:00:00.000Z",
      }),
      (error) => error instanceof RecorderDeleteError
        && error.code === "ERR_RECORDER_DELETE_MEDIA_MISSING"
        && error.details?.mediaAssetId === "asset-2",
    );

    await fs.access(existingPath);
    assert.equal(store.getRecord("frames", "frame-1").deleted_at, null);
    assert.equal(store.getRecord("frames", "frame-2").deleted_at, null);
    assert.equal(store.getRecord("media_assets", "asset-1").deleted_at, null);
    assert.equal(store.getRecord("media_assets", "asset-2").deleted_at, null);
    assert.equal(store.search("first deletion proof").length, 1);
    assert.equal(store.search("second deletion proof").length, 1);
  } finally {
    store.close();
  }
});
