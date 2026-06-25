// office-hours-artifact-registry.mjs — durable, append-only authority that
// enforces SINGLE-USE of an evidence IDENTITY and idempotent retry for Office
// Hours attempt-evidence (A′, GPT-5.5 Pro sequenced "now, isolated").
//
// What this module is: the durable replay-rejection store. The evidence-receipt
// verifier (office-hours-evidence-receipt.mjs) proves a receipt's integrity,
// binding and claim, but it CANNOT stop the same underlying evidence being
// replayed across attempts/contracts — a `Set` keyed on artifactId is bypassable
// (same bytes re-uploaded → new artifactId). This module is the durable,
// append-only authority that enforces single-use of an EVIDENCE IDENTITY (a
// content/actor/provider-derived key, NOT artifactId) and idempotent retry.
//
// What this module is NOT: it is buildable in isolation and is NOT wired into
// index.mjs / the attempt-store yet (blast-radius-0). It does not advance attempt
// state, does not call the LLM, and is not referenced by the running daemon.
//
// Design constraints (spec §Constraints):
//   - no-legacy / clean / fail-closed / EXPLICIT throws. A rejection
//     ({ ok:false, rejection:<code> }) is a real VERDICT; a THROWN error is an
//     infra failure — the caller treats a throw as fail-closed-no-event.
//   - The single-use constraint is enforced in DURABLE storage UNDER A LOCK, not
//     a process-local Set or a check-then-write race.
//   - All I/O is confined to THIS module. We deliberately do NOT route the
//     authoritative write through atomic-store.atomicWriteJson (it lacks fsync +
//     dir-sync) nor through atomic-store.withFileLock (no owner token — it can
//     unlink a lock another writer legitimately stole). We mirror the proven
//     durable-writer + owner-token lease-lock pattern from
//     office-hours-attempt-store.mjs locally, keeping the module standalone.
//   - STRICT fail-closed loader: a corrupt/parse/schema error THROWS — a corrupt
//     store is NEVER silently treated as empty (that would fabricate authority and
//     let a write destroy corrupt-but-present prior data).

import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

export const ARTIFACT_REGISTRY_SCHEMA_VERSION = 1;
export const ARTIFACT_REGISTRY_SCHEMA = "agentic30.memory.office_hours_artifact_registry.v1";

// Origins whose evidence identity this registry knows how to derive. Mirrors the
// receipt verifier's EVIDENCE_RECEIPT_ORIGINS shape but is kept local so this
// module stays I/O-self-contained and does not depend on the verifier.
export const ARTIFACT_REGISTRY_ORIGINS = Object.freeze([
  "swift_upload",
  "url_snapshot",
  "provider_event",
  "recipient_callback",
]);

const REGISTRATION_STATES = Object.freeze(["available", "revoked", "quarantined"]);

// Lease timeout: large enough that a slow read-modify-write under contention does
// not get its lock stolen, but finite so a crashed writer eventually frees the
// file. The acquisition budget (how long WE wait to take the lock) is separate
// from the lease expiry (how stale a foreign lock must be before it may be
// stolen) so a short wait can never classify a live foreign lock as expired.
const DEFAULT_LEASE_TIMEOUT_MS = 30_000;
const DEFAULT_ACQUIRE_TIMEOUT_MS = 30_000;
const DEFAULT_LEASE_POLL_MS = 25;

const SHA256_RE = /^[0-9a-f]{64}$/;

// ── Coded error ──────────────────────────────────────────────────────────────
// Every infra failure (bad input, read/parse/schema, write, lock) throws one of
// these. A coded throw is fail-closed-no-event; it is NOT a verdict.
export class ArtifactRegistryError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "ArtifactRegistryError";
    this.code = code || "ERR_ARTIFACT_REGISTRY";
  }
}

// ── Path resolution (mirrors attempt-store's local resolver) ──────────────────
export function resolveArtifactRegistryPath({ workspaceRoot } = {}) {
  if (!workspaceRoot || typeof workspaceRoot !== "string" || !workspaceRoot.trim()) {
    throw new ArtifactRegistryError("workspaceRoot is required", "ERR_NO_WORKSPACE");
  }
  return path.join(
    path.resolve(String(workspaceRoot)),
    ".agentic30",
    "memory",
    "office-hours-artifact-registry.json",
  );
}

// ── evidenceIdentity (the durable replay key — NOT artifactId) ────────────────
// A stable opaque string scoped so that the SAME underlying evidence yields the
// SAME identity regardless of a re-upload producing a fresh artifactId. Missing
// inputs for the origin throw (fail-closed) — we never fabricate a partial key.
export function deriveEvidenceIdentity({
  origin,
  actorId,
  sha256,
  providerAccount,
  providerEventId,
  callbackNonce,
} = {}) {
  if (!origin || typeof origin !== "string") {
    throw new ArtifactRegistryError("deriveEvidenceIdentity: origin is required", "ERR_IDENTITY_INPUT");
  }
  switch (origin) {
    case "swift_upload":
    case "url_snapshot": {
      const actor = requireField(actorId, "actorId", origin);
      const hash = requireSha256(sha256, origin);
      return `upload:${actor}:${hash}`;
    }
    case "provider_event": {
      const account = requireField(providerAccount, "providerAccount", origin);
      const eventId = requireField(providerEventId, "providerEventId", origin);
      return `provider:${account}:${eventId}`;
    }
    case "recipient_callback": {
      const nonce = requireField(callbackNonce, "callbackNonce", origin);
      return `callback:${nonce}`;
    }
    default:
      throw new ArtifactRegistryError(
        `deriveEvidenceIdentity: unknown origin "${String(origin)}"`,
        "ERR_IDENTITY_ORIGIN",
      );
  }
}

function requireField(value, name, origin) {
  if (typeof value !== "string" || !value.trim()) {
    throw new ArtifactRegistryError(
      `deriveEvidenceIdentity: ${name} is required for origin "${origin}"`,
      "ERR_IDENTITY_INPUT",
    );
  }
  return value.trim();
}

function requireSha256(value, origin) {
  if (typeof value !== "string" || !SHA256_RE.test(value)) {
    throw new ArtifactRegistryError(
      `deriveEvidenceIdentity: sha256 must be 64 lowercase hex for origin "${origin}"`,
      "ERR_IDENTITY_INPUT",
    );
  }
  return value;
}

// ── Strict loader (spec §loadArtifactRegistry; fail-CLOSED) ───────────────────
// Absent file → empty store. Any read/parse error, bad root shape, schemaVersion
// mismatch, or per-record corruption THROWS. A corrupt store is NEVER silently
// coerced to empty — that would fabricate authority and let a write destroy the
// corrupt-but-present prior data.
export async function loadArtifactRegistry({ workspaceRoot } = {}) {
  const filePath = resolveArtifactRegistryPath({ workspaceRoot });
  let raw;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch (err) {
    if (err && err.code === "ENOENT") {
      return emptyRegistry();
    }
    throw new ArtifactRegistryError(
      `failed to read artifact registry at ${filePath}: ${err && err.message}`,
      "ERR_REGISTRY_READ",
    );
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new ArtifactRegistryError(
      `artifact registry is not valid JSON at ${filePath}: ${err && err.message}`,
      "ERR_REGISTRY_PARSE",
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ArtifactRegistryError(
      `artifact registry root must be an object at ${filePath}`,
      "ERR_REGISTRY_PARSE",
    );
  }
  if (parsed.schemaVersion !== ARTIFACT_REGISTRY_SCHEMA_VERSION) {
    throw new ArtifactRegistryError(
      `artifact registry schemaVersion ${String(parsed.schemaVersion)} != ${ARTIFACT_REGISTRY_SCHEMA_VERSION}`,
      "ERR_REGISTRY_SCHEMA",
    );
  }
  if (!parsed.registrations || typeof parsed.registrations !== "object" || Array.isArray(parsed.registrations)) {
    throw new ArtifactRegistryError(
      `artifact registry "registrations" must be an object at ${filePath}`,
      "ERR_REGISTRY_PARSE",
    );
  }
  if (!Array.isArray(parsed.consumptions)) {
    throw new ArtifactRegistryError(
      `artifact registry "consumptions" must be an array at ${filePath}`,
      "ERR_REGISTRY_PARSE",
    );
  }
  // Per-record strict validation (fail-closed; no fail-open coercion). A
  // structurally-valid root with a corrupt record must THROW — never be silently
  // dropped by a downstream `|| {}` / filter, which would let a write overwrite or
  // destroy the corrupt-but-present prior data.
  for (const [key, record] of Object.entries(parsed.registrations)) {
    assertRegistrationRecord(key, record, filePath);
  }
  parsed.consumptions.forEach((record, idx) => {
    assertConsumptionRecord(idx, record, filePath);
  });
  return parsed;
}

function assertRegistrationRecord(key, record, filePath) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    throw new ArtifactRegistryError(`registration ${key} must be an object at ${filePath}`, "ERR_REGISTRY_SCHEMA");
  }
  if (record.evidenceIdentity !== key) {
    throw new ArtifactRegistryError(
      `registration ${key} evidenceIdentity must match its key at ${filePath}`,
      "ERR_REGISTRY_SCHEMA",
    );
  }
  if (typeof record.artifactId !== "string" || !record.artifactId.trim()) {
    throw new ArtifactRegistryError(`registration ${key} has invalid artifactId at ${filePath}`, "ERR_REGISTRY_SCHEMA");
  }
  if (typeof record.sha256 !== "string" || !SHA256_RE.test(record.sha256)) {
    throw new ArtifactRegistryError(`registration ${key} has invalid sha256 at ${filePath}`, "ERR_REGISTRY_SCHEMA");
  }
  if (!ARTIFACT_REGISTRY_ORIGINS.includes(record.origin)) {
    throw new ArtifactRegistryError(`registration ${key} has invalid origin at ${filePath}`, "ERR_REGISTRY_SCHEMA");
  }
  if (!REGISTRATION_STATES.includes(record.status)) {
    throw new ArtifactRegistryError(`registration ${key} has invalid status at ${filePath}`, "ERR_REGISTRY_SCHEMA");
  }
  if (!Number.isInteger(record.byteLength) || record.byteLength <= 0) {
    throw new ArtifactRegistryError(`registration ${key} has invalid byteLength at ${filePath}`, "ERR_REGISTRY_SCHEMA");
  }
}

function assertConsumptionRecord(idx, record, filePath) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    throw new ArtifactRegistryError(`consumption[${idx}] must be an object at ${filePath}`, "ERR_REGISTRY_SCHEMA");
  }
  for (const field of ["evidenceIdentity", "attemptId", "evidenceContractId", "eventId"]) {
    if (typeof record[field] !== "string" || !record[field].trim()) {
      throw new ArtifactRegistryError(
        `consumption[${idx}] has invalid ${field} at ${filePath}`,
        "ERR_REGISTRY_SCHEMA",
      );
    }
  }
}

function emptyRegistry() {
  return {
    schemaVersion: ARTIFACT_REGISTRY_SCHEMA_VERSION,
    schema: ARTIFACT_REGISTRY_SCHEMA,
    updatedAt: "",
    registrations: {},
    consumptions: [],
  };
}

// ── Durable writer ────────────────────────────────────────────────────────────
// temp write → FileHandle.sync() (fsync the file bytes) → rename → directory
// fsync (so the rename itself is durable). This is stronger than
// atomic-store.atomicWriteJson, which omits the fsync steps — for a security-
// critical single-use store the durability of an appended consumption matters.
async function durableWriteJson(filePath, payload) {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  const tempPath = path.join(dir, `.${base}.${randomUUID()}.tmp`);
  await fs.mkdir(dir, { recursive: true });

  let fh;
  try {
    fh = await fs.open(tempPath, "w", 0o600);
    await fh.writeFile(JSON.stringify(payload, null, 2));
    await fh.sync(); // fsync the file contents before exposing it via rename
  } finally {
    if (fh) await fh.close().catch(() => {});
  }
  try {
    await fs.rename(tempPath, filePath);
  } catch (err) {
    await fs.unlink(tempPath).catch(() => {});
    throw err;
  }
  // fsync the directory so the rename (a metadata op) is itself durable.
  await fsyncDir(dir);
}

async function fsyncDir(dir) {
  let dh;
  try {
    dh = await fs.open(dir, "r");
    await dh.sync();
  } catch {
    // Some platforms (notably Windows) reject opening a directory for fsync.
    // The rename above is still atomic; we degrade the durability guarantee on
    // those platforms rather than throwing. On POSIX (our target) this succeeds.
  } finally {
    if (dh) await dh.close().catch(() => {});
  }
}

// ── Owner-token lease lock ────────────────────────────────────────────────────
// O_EXCL create wins the lock and writes {owner, at}. A held lock is only stolen
// if it is NOT ours AND its lease has expired (mtime older than timeout). The
// finally only unlinks when the lockfile still carries OUR token — we never delete
// a lock another writer legitimately holds or stole. This is the load-bearing
// primitive: every read-modify-write of the durable store runs inside it, so the
// single-use uniqueness check + the append are one atomic critical section. There
// is no check-then-write race and no process-local Set.
async function withRegistryLeaseLock(
  filePath,
  fn,
  {
    timeoutMs = DEFAULT_LEASE_TIMEOUT_MS, // lease expiry — when a foreign lock may be stolen
    acquireTimeoutMs = DEFAULT_ACQUIRE_TIMEOUT_MS, // how long WE wait to acquire
    pollMs = DEFAULT_LEASE_POLL_MS,
  } = {},
) {
  const lockPath = `${filePath}.lock`;
  await fs.mkdir(path.dirname(lockPath), { recursive: true });
  const token = randomUUID();
  const start = Date.now();

  while (true) {
    let acquired = false;
    try {
      const fh = await fs.open(lockPath, "wx", 0o600);
      try {
        await fh.writeFile(JSON.stringify({ owner: token, at: new Date().toISOString() }));
        await fh.sync().catch(() => {});
      } finally {
        await fh.close().catch(() => {});
      }
      acquired = true;
    } catch (err) {
      if (!err || err.code !== "EEXIST") throw err;
    }

    if (acquired) break;

    // Lock is held by someone. Only steal it if it is NOT ours and expired.
    let stat;
    try {
      stat = await fs.stat(lockPath);
    } catch {
      continue; // lock vanished between EEXIST and stat — retry create
    }
    const existing = await readLockOwner(lockPath);
    const expired = Date.now() - stat.mtimeMs > timeoutMs;
    if (existing !== token && expired) {
      // Steal: remove the expired foreign lock, then loop to re-create as ours.
      await fs.unlink(lockPath).catch(() => {});
      continue;
    }
    if (Date.now() - start > acquireTimeoutMs) {
      throw new ArtifactRegistryError(`lock timeout for ${lockPath}`, "ERR_REGISTRY_LOCK_TIMEOUT");
    }
    await sleep(pollMs);
  }

  try {
    return await fn();
  } finally {
    // Only unlink if WE still own the lock (no lock-stealing on release).
    const owner = await readLockOwner(lockPath);
    if (owner === token) {
      await fs.unlink(lockPath).catch(() => {});
    }
  }
}

async function readLockOwner(lockPath) {
  try {
    const raw = await fs.readFile(lockPath, "utf8");
    const parsed = JSON.parse(raw);
    return typeof parsed?.owner === "string" ? parsed.owner : null;
  } catch {
    return null;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Operation 1: registerArtifact ─────────────────────────────────────────────
// Bind an evidenceIdentity to its (artifactId, sha256, origin, ...) metadata.
// Idempotent on an identical (artifactId, sha256) re-register; a same-identity
// re-register under a DIFFERENT artifactId or sha256 is an evidence_identity_conflict
// (same bytes re-registered under another id / identity collision). Invalid inputs
// THROW (infra failure, not a verdict).
export async function registerArtifact(
  { workspaceRoot } = {},
  { evidenceIdentity, artifactId, sha256, origin, mediaType, byteLength } = {},
) {
  const filePath = resolveArtifactRegistryPath({ workspaceRoot });
  validateNonEmptyString(evidenceIdentity, "evidenceIdentity");
  validateNonEmptyString(artifactId, "artifactId");
  if (typeof sha256 !== "string" || !SHA256_RE.test(sha256)) {
    throw new ArtifactRegistryError("registerArtifact: sha256 must be 64 lowercase hex", "ERR_REGISTER_INPUT");
  }
  if (!ARTIFACT_REGISTRY_ORIGINS.includes(origin)) {
    throw new ArtifactRegistryError(`registerArtifact: origin "${String(origin)}" is not allowlisted`, "ERR_REGISTER_INPUT");
  }
  if (!Number.isInteger(byteLength) || byteLength <= 0) {
    throw new ArtifactRegistryError("registerArtifact: byteLength must be a positive integer", "ERR_REGISTER_INPUT");
  }
  validateNonEmptyString(mediaType, "mediaType");

  return withRegistryLeaseLock(filePath, async () => {
    const store = await loadArtifactRegistry({ workspaceRoot });
    const existing = store.registrations[evidenceIdentity];
    if (existing) {
      if (existing.artifactId === artifactId && existing.sha256 === sha256) {
        // Idempotent re-register: return the existing record unchanged.
        return { ok: true, idempotent: true, registration: existing };
      }
      // Same identity, different bytes/id → conflict (a real verdict, not a throw).
      return { ok: false, rejection: "evidence_identity_conflict" };
    }
    const registration = {
      evidenceIdentity,
      artifactId,
      sha256,
      origin,
      mediaType,
      byteLength,
      status: "available",
      registeredAt: new Date().toISOString(),
    };
    const next = {
      ...store,
      registrations: { ...store.registrations, [evidenceIdentity]: registration },
      updatedAt: new Date().toISOString(),
    };
    await durableWriteJson(filePath, next);
    return { ok: true, idempotent: false, registration };
  });
}

// ── Operation 2: consumeArtifact (the single-use gate) ────────────────────────
// The load-bearing single-use gate. The entire read-check-append runs inside the
// lease lock, so the uniqueness constraint is enforced in DURABLE storage as one
// atomic critical section — NOT a process-local Set or a check-then-write race.
// Two concurrent consumes of the SAME evidenceIdentity for DIFFERENT attempts
// serialize through the lock: the first appends a consumption, the second observes
// it and rejects `artifact_reuse`. Exactly one success.
export async function consumeArtifact(
  { workspaceRoot } = {},
  { evidenceIdentity, attemptId, evidenceContractId, eventId, sha256, origin } = {},
) {
  const filePath = resolveArtifactRegistryPath({ workspaceRoot });
  validateNonEmptyString(evidenceIdentity, "evidenceIdentity");
  validateNonEmptyString(attemptId, "attemptId");
  validateNonEmptyString(evidenceContractId, "evidenceContractId");
  validateNonEmptyString(eventId, "eventId");
  if (typeof sha256 !== "string" || !SHA256_RE.test(sha256)) {
    throw new ArtifactRegistryError("consumeArtifact: sha256 must be 64 lowercase hex", "ERR_CONSUME_INPUT");
  }
  if (!ARTIFACT_REGISTRY_ORIGINS.includes(origin)) {
    throw new ArtifactRegistryError(`consumeArtifact: origin "${String(origin)}" is not allowlisted`, "ERR_CONSUME_INPUT");
  }

  return withRegistryLeaseLock(filePath, async () => {
    const store = await loadArtifactRegistry({ workspaceRoot });
    const registration = store.registrations[evidenceIdentity];
    if (!registration) {
      return { ok: false, rejection: "not_registered" };
    }
    if (registration.status !== "available") {
      return { ok: false, rejection: "not_available" };
    }
    if (registration.sha256 !== sha256 || registration.origin !== origin) {
      return { ok: false, rejection: "metadata_mismatch" };
    }

    const priorForIdentity = store.consumptions.filter(
      (c) => c.evidenceIdentity === evidenceIdentity,
    );
    // Idempotent retry: the identical (identity, attempt, contract, event) tuple
    // already consumed → success with no duplicate appended.
    const sameTuple = priorForIdentity.find(
      (c) =>
        c.attemptId === attemptId &&
        c.evidenceContractId === evidenceContractId &&
        c.eventId === eventId,
    );
    if (sameTuple) {
      return { ok: true, idempotent: true, consumption: sameTuple };
    }
    // Any prior consumption of this identity under a DIFFERENT attempt or contract
    // is replay across attempts/contracts → reject. (A different eventId alone,
    // same attempt + contract, is still reuse — only the full identical tuple is
    // idempotent, handled above.)
    if (priorForIdentity.length > 0) {
      return { ok: false, rejection: "artifact_reuse" };
    }

    const consumption = {
      evidenceIdentity,
      attemptId,
      evidenceContractId,
      eventId,
      consumedAt: new Date().toISOString(),
    };
    const next = {
      ...store,
      consumptions: [...store.consumptions, consumption],
      updatedAt: new Date().toISOString(),
    };
    await durableWriteJson(filePath, next);
    return { ok: true, idempotent: false, consumption };
  });
}

// ── Operation 3: revokeEvidence (append-only invalidation) ────────────────────
// Append-only: set registration.status="revoked" (never delete a registration;
// never delete a consumption). A later consume of a revoked identity →
// not_available. Revoking an unknown identity → not_registered verdict (not a
// throw). Idempotent on an already-revoked identity.
export async function revokeEvidence(
  { workspaceRoot } = {},
  { evidenceIdentity, reason } = {},
) {
  const filePath = resolveArtifactRegistryPath({ workspaceRoot });
  validateNonEmptyString(evidenceIdentity, "evidenceIdentity");

  return withRegistryLeaseLock(filePath, async () => {
    const store = await loadArtifactRegistry({ workspaceRoot });
    const existing = store.registrations[evidenceIdentity];
    if (!existing) {
      return { ok: false, rejection: "not_registered" };
    }
    if (existing.status === "revoked") {
      return { ok: true, idempotent: true, registration: existing };
    }
    const registration = {
      ...existing,
      status: "revoked",
      revokedAt: new Date().toISOString(),
      revokedReason: typeof reason === "string" ? reason : "",
    };
    const next = {
      ...store,
      registrations: { ...store.registrations, [evidenceIdentity]: registration },
      updatedAt: new Date().toISOString(),
    };
    await durableWriteJson(filePath, next);
    return { ok: true, idempotent: false, registration };
  });
}

function validateNonEmptyString(value, name) {
  if (typeof value !== "string" || !value.trim()) {
    throw new ArtifactRegistryError(`${name} is required`, "ERR_INPUT");
  }
}
