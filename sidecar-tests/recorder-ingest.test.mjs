import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  RecorderIngestError,
  normalizeFrameCaptureEnvelope,
  recordFrameCaptureEnvelope,
} from "../sidecar/recorder-ingest.mjs";
import { RecorderStore } from "../sidecar/recorder-store.mjs";

async function makeStore() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-recorder-ingest-"));
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
    captureTrigger: "app_switch",
    appName: "Agentic30",
    windowTitle: "Day Memory Review",
    browserUrl: "https://example.com/customer#private",
    contentHash: "sha256:frame-content",
    simhash: "simhash-1",
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
      encrypted: false,
    },
    text: {
      textSource: "accessibility",
      accessibilityText: "raw customer@example.com secret token",
      ocrText: "raw OCR",
      redactedText: "customer reply activation friction",
      redactionStatus: "redacted",
    },
    ...overrides,
  };
}

test("recordFrameCaptureEnvelope writes media and frame rows with redacted FTS only", async () => {
  const { store } = await makeStore();
  try {
    const result = recordFrameCaptureEnvelope(store, envelope(), {
      now: new Date("2026-06-27T12:01:00.000Z"),
    });

    assert.equal(result.mediaAsset.relative_path, "media/frames/2026-06-27/frame-1.jpg");
    assert.equal(result.frame.browser_domain, "example.com");
    assert.equal(result.frame.browser_url_normalized, "https://example.com/customer");

    const frame = store.getRecord("frames", "frame-1");
    const media = store.getRecord("media_assets", "asset-1");
    assert.equal(frame.snapshot_asset_id, "asset-1");
    assert.equal(media.sha256, "sha256:snapshot");

    assert.equal(store.search("activation friction").length, 1);
    assert.equal(store.search("customer@example.com").length, 0);
  } finally {
    store.close();
  }
});

test("normalizeFrameCaptureEnvelope rejects unsafe search indexing without redacted text", () => {
  assert.throws(
    () => normalizeFrameCaptureEnvelope(envelope({
      safeForSearch: true,
      text: {
        textSource: "accessibility",
        accessibilityText: "raw only",
        redactionStatus: "raw",
      },
    })),
    (error) => error instanceof RecorderIngestError
      && error.code === "ERR_RECORDER_INGEST_SEARCH_REQUIRES_REDACTED_TEXT",
  );
});

test("normalizeFrameCaptureEnvelope rejects frame media paths outside recorder media", () => {
  assert.throws(
    () => normalizeFrameCaptureEnvelope(envelope({
      snapshot: {
        id: "asset-unsafe",
        relativePath: "../frame-1.jpg",
        sha256: "sha256:snapshot",
        byteSize: 12345,
      },
    })),
    (error) => error instanceof RecorderIngestError
      && error.code === "ERR_RECORDER_INGEST_UNSAFE_MEDIA_PATH",
  );

  assert.throws(
    () => normalizeFrameCaptureEnvelope(envelope({
      snapshot: {
        id: "asset-absolute",
        relativePath: "/tmp/frame-1.jpg",
        sha256: "sha256:snapshot",
        byteSize: 12345,
      },
    })),
    (error) => error instanceof RecorderIngestError
      && error.code === "ERR_RECORDER_INGEST_ABSOLUTE_MEDIA_PATH",
  );
});

test("recordFrameCaptureEnvelope rejects duplicate ids before SQLite constraint fallback", async () => {
  const { store } = await makeStore();
  try {
    recordFrameCaptureEnvelope(store, envelope());

    assert.throws(
      () => recordFrameCaptureEnvelope(store, envelope({
        id: "frame-2",
      })),
      (error) => error instanceof RecorderIngestError
        && error.code === "ERR_RECORDER_INGEST_DUPLICATE_MEDIA_ASSET",
    );

    assert.throws(
      () => recordFrameCaptureEnvelope(store, envelope({
        snapshot: {
          id: "asset-2",
          relativePath: "media/frames/2026-06-27/frame-2.jpg",
          sha256: "sha256:snapshot-2",
          byteSize: 23456,
        },
      })),
      (error) => error instanceof RecorderIngestError
        && error.code === "ERR_RECORDER_INGEST_DUPLICATE_FRAME",
    );
  } finally {
    store.close();
  }
});
