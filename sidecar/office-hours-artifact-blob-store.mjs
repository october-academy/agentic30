// office-hours-artifact-blob-store.mjs — the immutable, content-addressed store for the
// actual evidence bytes (A′ build-seq step 4; GPT-5.5 Pro P0 #6 "실제 artifact 부재").
//
// The artifact-registry stores only METADATA (artifactId, sha256, mediaType, …). Without
// the real bytes persisted, a receipt can be valid while the original screenshot is gone.
// This store durably writes the bytes BEFORE a receipt is signed and lets the host
// re-fetch them by artifactId.
//
// CONTENT-ADDRESSED: artifactId == sha256(bytes). Writing the same bytes twice is
// idempotent (same path). Because the address IS the hash and the receipt MACs the
// sha256, swapping the bytes under a path breaks the hash → the receipt no longer matches
// → tampering is detected. This is why an in-workspace location (.agentic30/memory/
// evidence-artifacts/) is acceptable at N=0: the integrity of the blob does not rest on
// the directory being unwritable, it rests on content addressing.
//
// Host-only inputs: callers pass raw bytes (Buffer). The MIME is sniffed from magic bytes
// HOST-side — a client-declared media type is advisory only.

import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";

export const ARTIFACT_BLOB_DIRNAME = "evidence-artifacts";
// DoS bound: reject artifacts larger than this before hashing/writing (a screenshot is
// well under this; a decompression-bomb upload is refused).
export const MAX_ARTIFACT_BYTES = 25 * 1024 * 1024;
const SHA256_RE = /^[0-9a-f]{64}$/;

export class ArtifactBlobError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "ArtifactBlobError";
    this.code = code || "ERR_ARTIFACT_BLOB";
  }
}

export function resolveArtifactBlobDir({ workspaceRoot } = {}) {
  if (!workspaceRoot || typeof workspaceRoot !== "string" || !workspaceRoot.trim()) {
    throw new ArtifactBlobError("workspaceRoot is required", "ERR_NO_WORKSPACE");
  }
  return path.join(path.resolve(String(workspaceRoot)), ".agentic30", "memory", ARTIFACT_BLOB_DIRNAME);
}

// ── Magic-byte MIME sniff (host-side; client media type is advisory) ──────────
export function sniffMediaType(buffer) {
  const b = buffer;
  if (!Buffer.isBuffer(b) || b.length < 4) return { detectedMediaType: "application/octet-stream", contentValidation: "unrecognized" };
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) {
    return { detectedMediaType: "image/png", contentValidation: "image_magic_byte_ok" };
  }
  // JPEG: FF D8 FF
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    return { detectedMediaType: "image/jpeg", contentValidation: "image_magic_byte_ok" };
  }
  // GIF: "GIF87a" / "GIF89a"
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) {
    return { detectedMediaType: "image/gif", contentValidation: "image_magic_byte_ok" };
  }
  // WEBP: "RIFF" .... "WEBP"
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) {
    return { detectedMediaType: "image/webp", contentValidation: "image_magic_byte_ok" };
  }
  // PDF: "%PDF"
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) {
    return { detectedMediaType: "application/pdf", contentValidation: "pdf_magic_byte_ok" };
  }
  return { detectedMediaType: "application/octet-stream", contentValidation: "unrecognized" };
}

export function isImageMediaType(mediaType = "") {
  return String(mediaType || "").startsWith("image/");
}

async function durableWriteBytes(filePath, buffer) {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  const tempPath = path.join(dir, `.${base}.${randomUUID()}.tmp`);
  await fs.mkdir(dir, { recursive: true });
  let fh;
  try {
    fh = await fs.open(tempPath, "w", 0o600);
    await fh.writeFile(buffer);
    await fh.sync();
  } finally {
    if (fh) await fh.close().catch(() => {});
  }
  try {
    await fs.rename(tempPath, filePath);
  } catch (err) {
    await fs.unlink(tempPath).catch(() => {});
    throw err;
  }
  let dh;
  try {
    dh = await fs.open(dir, "r");
    await dh.sync();
  } catch {
    // directory fsync unsupported on some platforms; rename is still atomic.
  } finally {
    if (dh) await dh.close().catch(() => {});
  }
}

/**
 * Persist evidence bytes immutably and content-addressed. Returns
 * { artifactId, sha256, byteLength, detectedMediaType, contentValidation }.
 * artifactId === sha256. Idempotent: re-putting identical bytes is a no-op write.
 * Throws on empty / oversized input (infra failure, not a verdict).
 */
export async function putArtifactBlob({ workspaceRoot } = {}, { bytes, declaredMediaType } = {}) {
  if (!Buffer.isBuffer(bytes)) {
    throw new ArtifactBlobError("putArtifactBlob: bytes must be a Buffer", "ERR_BLOB_INPUT");
  }
  if (bytes.length === 0) {
    throw new ArtifactBlobError("putArtifactBlob: bytes must be non-empty", "ERR_BLOB_EMPTY");
  }
  if (bytes.length > MAX_ARTIFACT_BYTES) {
    throw new ArtifactBlobError(`putArtifactBlob: artifact exceeds ${MAX_ARTIFACT_BYTES} bytes`, "ERR_BLOB_TOO_LARGE");
  }
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const { detectedMediaType, contentValidation } = sniffMediaType(bytes);
  const dir = resolveArtifactBlobDir({ workspaceRoot });
  const blobPath = path.join(dir, sha256);
  // Idempotent: if a blob with this exact content already exists, do not rewrite.
  let exists = false;
  try {
    const st = await fs.stat(blobPath);
    exists = st.isFile() && st.size === bytes.length;
  } catch { exists = false; }
  if (!exists) {
    await durableWriteBytes(blobPath, bytes);
  }
  return {
    artifactId: sha256,
    sha256,
    byteLength: bytes.length,
    detectedMediaType,
    contentValidation,
    declaredMediaType: typeof declaredMediaType === "string" ? declaredMediaType.slice(0, 128) : "",
  };
}

/**
 * Re-fetch the bytes for an artifactId (== sha256). Returns { bytes, sha256,
 * byteLength } or null if absent. Verifies the on-disk bytes still hash to the
 * artifactId — a mismatch THROWS (tamper detected), it is never returned as valid.
 */
export async function getArtifactBlob({ workspaceRoot } = {}, { artifactId } = {}) {
  const id = String(artifactId || "").trim();
  if (!SHA256_RE.test(id)) {
    throw new ArtifactBlobError("getArtifactBlob: artifactId must be 64 lowercase hex (sha256)", "ERR_BLOB_INPUT");
  }
  const blobPath = path.join(resolveArtifactBlobDir({ workspaceRoot }), id);
  let bytes;
  try {
    bytes = await fs.readFile(blobPath);
  } catch (err) {
    if (err && err.code === "ENOENT") return null;
    throw new ArtifactBlobError(`getArtifactBlob: failed to read ${blobPath}: ${err && err.message}`, "ERR_BLOB_READ");
  }
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== id) {
    throw new ArtifactBlobError(`getArtifactBlob: content hash ${actual} != artifactId ${id} (tamper)`, "ERR_BLOB_TAMPER");
  }
  return { bytes, sha256: id, byteLength: bytes.length };
}
