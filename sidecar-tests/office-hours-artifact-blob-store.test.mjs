// The content-addressed blob store must persist bytes durably, sniff MIME from magic
// bytes, round-trip by artifactId, be idempotent on identical content, detect tamper,
// and fail closed on empty/oversized/bad input.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  putArtifactBlob,
  getArtifactBlob,
  sniffMediaType,
  resolveArtifactBlobDir,
  ArtifactBlobError,
  MAX_ARTIFACT_BYTES,
} from "../sidecar/office-hours-artifact-blob-store.mjs";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 9, 9, 9]);
const PDF = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 1, 2]);

async function tmpWs() {
  return fs.mkdtemp(path.join(os.tmpdir(), "a30-blob-"));
}

test("sniffMediaType recognizes image + pdf magic bytes", () => {
  assert.equal(sniffMediaType(PNG).detectedMediaType, "image/png");
  assert.equal(sniffMediaType(PNG).contentValidation, "image_magic_byte_ok");
  assert.equal(sniffMediaType(JPEG).detectedMediaType, "image/jpeg");
  assert.equal(sniffMediaType(PDF).detectedMediaType, "application/pdf");
  assert.equal(sniffMediaType(Buffer.from([0, 1, 2, 3])).contentValidation, "unrecognized");
});

test("put → get round-trip; artifactId is the sha256 content address", async () => {
  const ws = await tmpWs();
  try {
    const meta = await putArtifactBlob({ workspaceRoot: ws }, { bytes: PNG, declaredMediaType: "image/png" });
    assert.match(meta.sha256, /^[0-9a-f]{64}$/);
    assert.equal(meta.artifactId, meta.sha256);
    assert.equal(meta.detectedMediaType, "image/png");
    assert.equal(meta.byteLength, PNG.length);
    const got = await getArtifactBlob({ workspaceRoot: ws }, { artifactId: meta.artifactId });
    assert.deepEqual(got.bytes, PNG);
    assert.equal(got.sha256, meta.sha256);
    // stored under .agentic30/memory/evidence-artifacts/<sha256>
    const blobPath = path.join(resolveArtifactBlobDir({ workspaceRoot: ws }), meta.sha256);
    const st = await fs.stat(blobPath);
    assert.equal(st.mode & 0o777, 0o600);
  } finally {
    await fs.rm(ws, { recursive: true, force: true });
  }
});

test("idempotent: identical bytes produce the same artifactId and a single blob", async () => {
  const ws = await tmpWs();
  try {
    const a = await putArtifactBlob({ workspaceRoot: ws }, { bytes: JPEG });
    const b = await putArtifactBlob({ workspaceRoot: ws }, { bytes: JPEG });
    assert.equal(a.artifactId, b.artifactId);
    const entries = await fs.readdir(resolveArtifactBlobDir({ workspaceRoot: ws }));
    assert.equal(entries.filter((e) => !e.startsWith(".")).length, 1);
  } finally {
    await fs.rm(ws, { recursive: true, force: true });
  }
});

test("getArtifactBlob detects tamper (on-disk bytes no longer hash to the id)", async () => {
  const ws = await tmpWs();
  try {
    const meta = await putArtifactBlob({ workspaceRoot: ws }, { bytes: PNG });
    const blobPath = path.join(resolveArtifactBlobDir({ workspaceRoot: ws }), meta.artifactId);
    await fs.writeFile(blobPath, Buffer.from([9, 9, 9, 9])); // tamper
    await assert.rejects(
      () => getArtifactBlob({ workspaceRoot: ws }, { artifactId: meta.artifactId }),
      (e) => e instanceof ArtifactBlobError && e.code === "ERR_BLOB_TAMPER",
    );
  } finally {
    await fs.rm(ws, { recursive: true, force: true });
  }
});

test("absent artifact → null", async () => {
  const ws = await tmpWs();
  try {
    const got = await getArtifactBlob({ workspaceRoot: ws }, { artifactId: "a".repeat(64) });
    assert.equal(got, null);
  } finally {
    await fs.rm(ws, { recursive: true, force: true });
  }
});

test("fail-closed on empty, oversized, and bad input", async () => {
  const ws = await tmpWs();
  try {
    await assert.rejects(() => putArtifactBlob({ workspaceRoot: ws }, { bytes: Buffer.alloc(0) }));
    await assert.rejects(() => putArtifactBlob({ workspaceRoot: ws }, { bytes: "not a buffer" }));
    await assert.rejects(() => putArtifactBlob({ workspaceRoot: ws }, { bytes: Buffer.alloc(MAX_ARTIFACT_BYTES + 1) }));
    await assert.rejects(() => getArtifactBlob({ workspaceRoot: ws }, { artifactId: "not-hex" }));
  } finally {
    await fs.rm(ws, { recursive: true, force: true });
  }
});
