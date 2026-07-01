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
      textSource: "ax_plus_ocr",
      accessibilityText: "raw customer@example.com secret token",
      ocrText: "raw OCR",
      redactedText: "customer reply activation friction",
      redactionStatus: "redacted",
    },
    ...overrides,
  };
}

function encryptionEnvelope(sha256) {
  const normalizedSha256 = String(sha256).startsWith("sha256:") ? sha256 : `sha256:${sha256}`;
  return {
    algorithm: "aes-256-gcm",
    keyId: "test-media-key",
    nonce: Buffer.alloc(12, 1).toString("base64"),
    tag: Buffer.alloc(16, 2).toString("base64"),
    ciphertextSha256: normalizedSha256,
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
    assert.equal(result.frame.browser_url_search_label, "example.com");
    assert.equal(result.frame.text_source, "ax_plus_ocr");
    assert.equal(result.frame.text_provenance_root_cause, null);

    const frame = store.getRecord("frames", "frame-1");
    const media = store.getRecord("media_assets", "asset-1");
    assert.equal(frame.snapshot_asset_id, "asset-1");
    assert.equal(frame.text_source, "ax_plus_ocr");
    assert.equal(media.sha256, "sha256:snapshot");

    assert.equal(store.search("activation friction").length, 1);
    assert.equal(store.search("example.com").length, 1);
    assert.equal(store.search("private").length, 0);
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
        textSource: "accessibility_only",
        accessibilityText: "raw only",
        redactionStatus: "raw",
      },
    })),
    (error) => error instanceof RecorderIngestError
      && error.code === "ERR_RECORDER_INGEST_SEARCH_REQUIRES_REDACTED_TEXT",
  );
});

test("normalizeFrameCaptureEnvelope derives redacted public text for safe local AX/OCR search sinks", async () => {
  const { store } = await makeStore();
  try {
    const result = recordFrameCaptureEnvelope(store, envelope({
      id: "frame-redaction-adapter",
      safeForSearch: true,
      safeForMemory: false,
      safeForExport: false,
      browserUrl: "https://private.example.com/customer/secret-path?token=raw",
      snapshot: {
        id: "asset-redaction-adapter",
        relativePath: "media/frames/2026-06-27/frame-redaction-adapter.jpg",
        sha256: "sha256:redaction-adapter",
        byteSize: 12345,
        encrypted: false,
      },
      text: {
        textSource: "accessibility_only",
        accessibilityText: "Customer customer@example.com opened https://private.example.com/customer/secret-path token=local-sensitive-token-value from /Users/october/secret.txt and asked about activation friction.",
        redactionStatus: "redacted",
      },
    }));

    assert.equal(result.frame.redaction_status, "redacted");
    assert.match(result.frame.redacted_text, /activation friction/);
    assert.match(result.frame.redacted_text, /\[redacted-email\]/);
    assert.match(result.frame.redacted_text, /\[redacted-secret\]/);
    assert.match(result.frame.redacted_text, /\[redacted-path\]/);
    assert.equal(result.frame.redacted_text.includes("customer@example.com"), false);
    assert.equal(result.frame.redacted_text.includes("/Users/october"), false);
    assert.equal(result.frame.redacted_text.includes("secret-path"), false);

    assert.equal(store.search("activation friction").length, 1);
    assert.equal(store.search("customer@example.com").length, 0);
    assert.equal(store.search("secret-path").length, 0);
    assert.equal(store.search("local-sensitive-token-value").length, 0);
  } finally {
    store.close();
  }
});

test("normalizeFrameCaptureEnvelope fails closed when safe sinks lack text to redact", () => {
  assert.throws(
    () => normalizeFrameCaptureEnvelope(envelope({
      safeForSearch: true,
      text: {
        textSource: "ocr_unavailable_named_root_cause",
        textProvenanceRootCause: "vision_ocr_unavailable_named_root_cause",
        redactionStatus: "redacted",
      },
    })),
    (error) => error instanceof RecorderIngestError
      && error.code === "ERR_RECORDER_INGEST_REDACTION_INPUT_REQUIRED",
  );
});

test("normalizeFrameCaptureEnvelope rejects unsafe supplied public redaction before receipt exposure", () => {
  assert.throws(
    () => normalizeFrameCaptureEnvelope(envelope({
      safeForSearch: false,
      safeForMemory: false,
      safeForExport: false,
      text: {
        textSource: "accessibility_only",
        accessibilityText: "raw local frame text",
        redactedText: "caller supplied https://private.example.test/customer/secret from /Users/october/private-note.md",
        redactionStatus: "redacted",
      },
    })),
    (error) => error instanceof RecorderIngestError
      && error.code === "ERR_RECORDER_REDACTION_POLICY_UNSAFE_PUBLIC_LOCATOR",
  );
});

test("normalizeFrameCaptureEnvelope rejects non-canonical text provenance states", () => {
  assert.throws(
    () => normalizeFrameCaptureEnvelope(envelope({
      text: {
        textSource: "screen_capture",
        redactionStatus: "not_redacted",
      },
    })),
    (error) => error instanceof RecorderIngestError
      && error.code === "ERR_RECORDER_INGEST_INVALID_TEXT_PROVENANCE",
  );

  assert.throws(
    () => normalizeFrameCaptureEnvelope(envelope({
      text: {
        textSource: "accessibility_only",
        accessibilityText: "raw AX",
        ocrText: "raw OCR",
        redactedText: "redacted",
        redactionStatus: "redacted",
      },
    })),
    (error) => error instanceof RecorderIngestError
      && error.code === "ERR_RECORDER_INGEST_TEXT_PROVENANCE_MISMATCH",
  );
});

test("normalizeFrameCaptureEnvelope requires named root cause when OCR is unavailable", () => {
  assert.throws(
    () => normalizeFrameCaptureEnvelope(envelope({
      safeForSearch: false,
      text: {
        textSource: "ocr_unavailable_named_root_cause",
        redactionStatus: "not_redacted",
      },
    })),
    (error) => error instanceof RecorderIngestError
      && error.code === "ERR_RECORDER_INGEST_OCR_UNAVAILABLE_ROOT_CAUSE_REQUIRED",
  );

  const normalized = normalizeFrameCaptureEnvelope(envelope({
    safeForSearch: false,
    text: {
      textSource: "ocr_unavailable_named_root_cause",
      textProvenanceRootCause: "vision_ocr_unavailable_named_root_cause",
      redactionStatus: "not_redacted",
    },
  }));
  assert.equal(normalized.frame.text_source, "ocr_unavailable_named_root_cause");
  assert.equal(normalized.frame.text_provenance_root_cause, "vision_ocr_unavailable_named_root_cause");
  assert.equal(normalized.frame.accessibility_text, null);
  assert.equal(normalized.frame.ocr_text, null);
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

test("recordFrameCaptureEnvelope requires encryption for automatic raw frame capture", async () => {
  const { store } = await makeStore();
  try {
    assert.throws(
      () => recordFrameCaptureEnvelope(store, envelope({
        id: "frame-auto",
        captureMode: "automatic",
        captureTrigger: "auto_arm",
        snapshot: {
          id: "asset-auto",
          relativePath: "media/frames/2026-06-27/frame-auto.jpg",
          sha256: "sha256:snapshot-auto",
          byteSize: 12345,
          encrypted: false,
        },
      })),
      (error) => error instanceof RecorderIngestError
        && error.code === "ERR_RECORDER_MEDIA_ENCRYPTION_REQUIRED",
    );
    assert.equal(store.getRecord("frames", "frame-auto"), null);

    assert.throws(
      () => recordFrameCaptureEnvelope(store, envelope({
        id: "frame-auto-missing-envelope",
        captureMode: "automatic",
        captureTrigger: "auto_arm",
        snapshot: {
          id: "asset-auto-missing-envelope",
          relativePath: "media/frames/2026-06-27/frame-auto-missing-envelope.jpg",
          sha256: "d".repeat(64),
          byteSize: 12345,
          encrypted: true,
        },
      })),
      (error) => error instanceof RecorderIngestError
        && error.code === "ERR_RECORDER_MEDIA_ENCRYPTION_ENVELOPE_REQUIRED",
    );
    assert.equal(store.getRecord("frames", "frame-auto-missing-envelope"), null);

    const result = recordFrameCaptureEnvelope(store, envelope({
      id: "frame-auto-encrypted",
      captureMode: "automatic",
      captureTrigger: "auto_arm",
      snapshot: {
        id: "asset-auto-encrypted",
        relativePath: "media/frames/2026-06-27/frame-auto-encrypted.jpg",
        sha256: "e".repeat(64),
        byteSize: 12345,
        encrypted: true,
        encryption: encryptionEnvelope("e".repeat(64)),
      },
    }));
    assert.equal(result.mediaAsset.encrypted, 1);
    assert.equal(result.mediaAsset.encryption_key_id, "test-media-key");
    assert.equal(result.mediaAsset.encryption_alg, "aes-256-gcm");
    const media = store.getRecord("media_assets", "asset-auto-encrypted");
    assert.equal(media.encryption_key_id, "test-media-key");
    assert.equal(media.encryption_nonce, Buffer.alloc(12, 1).toString("base64"));
  } finally {
    store.close();
  }
});
