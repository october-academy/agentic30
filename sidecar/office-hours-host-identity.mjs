// office-hours-host-identity.mjs — the host-owned identity + HMAC key authority for
// A′ evidence receipts (GPT-5.5 Pro build-seq step 2).
//
// WHY OUTSIDE THE WORKSPACE: the evidence-receipt MAC key is the trust root that
// stops a self-attested {kind,ref} from clearing an evidence grade. A key under the
// workspace `.agentic30/memory/` is readable by any workspace-scoped Read/Bash tool
// running at the same OS-user privilege, so `0600` there is NOT a boundary against
// the model's tool surface (GPT-5.5 Pro Decision C). This module keeps the key in a
// host-only store OUTSIDE any workspace (parent dir 0700, files 0600), and the secret
// is returned ONLY to the in-process signer/verifier — never via env/argv/WS payload/
// logs/telemetry/provider-subprocess env.
//
// SCOPE (October 2026-06-26 "minimal honest action-rail"): host-FILE keyring, not the
// macOS Keychain native bridge (deferred). At N=0 single-user the live adversary is the
// model fabricating a receipt, and the model is already tool-gated out of WS commands +
// mutating tools in the office-hours flow; a host-only file outside the workspace closes
// the file-read path the receipt cares about. Keychain is a later hardening.
//
// IDENTITY MODEL (GPT-5.5 Pro Decision A): installActorId is INSTALL-scope (the founder
// principal — one per install); projectId is WORKSPACE-scope (one per canonical
// workspace realpath). Both are supplied to the verifier as binding context; they are
// NOT stored in the attempt projection.
//
// FAIL-CLOSED: a corrupt/unreadable store THROWS (never silently re-mints — silently
// minting a fresh key while signed receipts/attempts already exist would invisibly
// invalidate them). Mint-once is enforced under an owner-token lease lock.

import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { randomUUID, randomBytes } from "node:crypto";

export const HOST_IDENTITY_SCHEMA_VERSION = 1;
export const HOST_IDENTITY_SCHEMA = "agentic30.host.office_hours_identity.v1";
export const EVIDENCE_KEYRING_SCHEMA_VERSION = 1;
export const EVIDENCE_KEYRING_SCHEMA = "agentic30.host.office_hours_evidence_keyring.v1";

const KEY_BYTES = 32; // 256-bit HMAC secret.
const ID_RE = /^[A-Za-z0-9._:-]{1,200}$/;

const DEFAULT_LEASE_TIMEOUT_MS = 30_000;
const DEFAULT_ACQUIRE_TIMEOUT_MS = 30_000;
const DEFAULT_LEASE_POLL_MS = 25;

export class HostIdentityError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "HostIdentityError";
    this.code = code || "ERR_HOST_IDENTITY";
  }
}

// ── Host store location (OUTSIDE any workspace) ───────────────────────────────
// Override with AGENTIC30_HOST_STORE_DIR (used by tests + advanced deployments). On
// macOS the default is ~/Library/Application Support/agentic30; elsewhere ~/.config/
// agentic30. The directory is created 0700 (owner-only) on first write.
export function resolveHostStoreDir() {
  const override = String(process.env.AGENTIC30_HOST_STORE_DIR || "").trim();
  if (override) return path.resolve(override);
  const home = os.homedir();
  if (!home) throw new HostIdentityError("cannot resolve home directory for host store", "ERR_NO_HOME");
  if (process.platform === "darwin") {
    return path.join(home, "Library", "Application Support", "agentic30");
  }
  return path.join(home, ".config", "agentic30");
}

function identityFilePath() {
  return path.join(resolveHostStoreDir(), "office-hours-host-identity.json");
}
function keyringFilePath() {
  return path.join(resolveHostStoreDir(), "office-hours-evidence-keyring.json");
}

// Canonical, symlink-resolved workspace key. The verifier binds projectId, so the
// workspace→projectId map must be keyed on a stable canonical path (P1 #15: never
// trust a client-chosen path verbatim). realpath falls back to resolve() when the
// path does not yet exist on disk (fresh workspace).
async function canonicalWorkspaceKey(workspaceRoot) {
  const raw = String(workspaceRoot || "").trim();
  if (!raw) throw new HostIdentityError("workspaceRoot is required", "ERR_NO_WORKSPACE");
  try {
    return await fs.realpath(path.resolve(raw));
  } catch {
    return path.resolve(raw);
  }
}

// ── Owner-token lease lock (mirrors the artifact-registry pattern, kept local so
// this module stays I/O-self-contained) ──────────────────────────────────────
async function withHostStoreLock(lockBase, fn, {
  timeoutMs = DEFAULT_LEASE_TIMEOUT_MS,
  acquireTimeoutMs = DEFAULT_ACQUIRE_TIMEOUT_MS,
  pollMs = DEFAULT_LEASE_POLL_MS,
} = {}) {
  const dir = resolveHostStoreDir();
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const lockPath = `${lockBase}.lock`;
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
    let stat;
    try {
      stat = await fs.stat(lockPath);
    } catch {
      continue;
    }
    const existing = await readLockOwner(lockPath);
    const expired = Date.now() - stat.mtimeMs > timeoutMs;
    if (existing !== token && expired) {
      await fs.unlink(lockPath).catch(() => {});
      continue;
    }
    if (Date.now() - start > acquireTimeoutMs) {
      throw new HostIdentityError(`lock timeout for ${lockPath}`, "ERR_HOST_STORE_LOCK_TIMEOUT");
    }
    await sleep(pollMs);
  }
  try {
    return await fn();
  } finally {
    const owner = await readLockOwner(lockPath);
    if (owner === token) await fs.unlink(lockPath).catch(() => {});
  }
}

async function readLockOwner(lockPath) {
  try {
    const parsed = JSON.parse(await fs.readFile(lockPath, "utf8"));
    return typeof parsed?.owner === "string" ? parsed.owner : null;
  } catch {
    return null;
  }
}
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Durable writer (fsync file + dir; mirrors the registry) ───────────────────
async function durableWriteJson(filePath, payload) {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  const tempPath = path.join(dir, `.${base}.${randomUUID()}.tmp`);
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  let fh;
  try {
    fh = await fs.open(tempPath, "w", 0o600);
    await fh.writeFile(JSON.stringify(payload, null, 2));
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

// ── Strict loaders (fail-closed; absent → null, corrupt → throw) ──────────────
async function loadIdentityStore() {
  const filePath = identityFilePath();
  let raw;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch (err) {
    if (err && err.code === "ENOENT") return null;
    throw new HostIdentityError(`failed to read host identity at ${filePath}: ${err && err.message}`, "ERR_IDENTITY_READ");
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new HostIdentityError(`host identity is not valid JSON at ${filePath}: ${err && err.message}`, "ERR_IDENTITY_PARSE");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new HostIdentityError(`host identity root must be an object at ${filePath}`, "ERR_IDENTITY_PARSE");
  }
  if (parsed.schemaVersion !== HOST_IDENTITY_SCHEMA_VERSION) {
    throw new HostIdentityError(`host identity schemaVersion ${String(parsed.schemaVersion)} != ${HOST_IDENTITY_SCHEMA_VERSION}`, "ERR_IDENTITY_SCHEMA");
  }
  if (!ID_RE.test(String(parsed.installActorId || ""))) {
    throw new HostIdentityError(`host identity installActorId is invalid at ${filePath}`, "ERR_IDENTITY_SCHEMA");
  }
  if (!parsed.projects || typeof parsed.projects !== "object" || Array.isArray(parsed.projects)) {
    throw new HostIdentityError(`host identity "projects" must be an object at ${filePath}`, "ERR_IDENTITY_PARSE");
  }
  return parsed;
}

async function loadKeyringStore() {
  const filePath = keyringFilePath();
  let raw;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch (err) {
    if (err && err.code === "ENOENT") return null;
    throw new HostIdentityError(`failed to read evidence keyring at ${filePath}: ${err && err.message}`, "ERR_KEYRING_READ");
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new HostIdentityError(`evidence keyring is not valid JSON at ${filePath}: ${err && err.message}`, "ERR_KEYRING_PARSE");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new HostIdentityError(`evidence keyring root must be an object at ${filePath}`, "ERR_KEYRING_PARSE");
  }
  if (parsed.schemaVersion !== EVIDENCE_KEYRING_SCHEMA_VERSION) {
    throw new HostIdentityError(`evidence keyring schemaVersion ${String(parsed.schemaVersion)} != ${EVIDENCE_KEYRING_SCHEMA_VERSION}`, "ERR_KEYRING_SCHEMA");
  }
  if (!parsed.keysByProject || typeof parsed.keysByProject !== "object" || Array.isArray(parsed.keysByProject)) {
    throw new HostIdentityError(`evidence keyring "keysByProject" must be an object at ${filePath}`, "ERR_KEYRING_PARSE");
  }
  return parsed;
}

// ── Public: identity (install actor + per-workspace project id) ───────────────
/**
 * Resolve { installActorId, projectId } for a workspace, minting the install actor
 * and/or the project id ONCE under a lock. Stable across calls. Corrupt store throws.
 */
export async function resolveHostIdentity({ workspaceRoot } = {}) {
  const projectKey = await canonicalWorkspaceKey(workspaceRoot);
  const filePath = identityFilePath();
  return withHostStoreLock(filePath, async () => {
    const store = (await loadIdentityStore()) || {
      schemaVersion: HOST_IDENTITY_SCHEMA_VERSION,
      schema: HOST_IDENTITY_SCHEMA,
      installActorId: `actor_${randomUUID()}`,
      projects: {},
      updatedAt: "",
    };
    let mutated = !store.updatedAt; // freshly created
    let entry = store.projects[projectKey];
    if (!entry) {
      entry = { projectId: `proj_${randomUUID()}`, createdAt: new Date().toISOString() };
      store.projects = { ...store.projects, [projectKey]: entry };
      mutated = true;
    }
    if (mutated) {
      store.updatedAt = new Date().toISOString();
      await durableWriteJson(filePath, store);
    }
    return { installActorId: store.installActorId, projectId: entry.projectId };
  });
}

// ── Public: per-workspace HMAC keyring ────────────────────────────────────────
// A per-project keyring: { activeKeyId, keys: { <keyId>: { secret, createdAt,
// retiredAt?, revokedAt? } } }. Signing uses activeKeyId; verification keeps retired
// keys (revoked keys are excluded). The secret lives ONLY here + in the returned
// objects handed to the in-process signer/verifier.
async function ensureProjectKeyring({ projectId }) {
  if (!ID_RE.test(String(projectId || ""))) {
    throw new HostIdentityError("ensureProjectKeyring requires a valid projectId", "ERR_KEYRING_INPUT");
  }
  const filePath = keyringFilePath();
  return withHostStoreLock(filePath, async () => {
    const store = (await loadKeyringStore()) || {
      schemaVersion: EVIDENCE_KEYRING_SCHEMA_VERSION,
      schema: EVIDENCE_KEYRING_SCHEMA,
      keysByProject: {},
      updatedAt: "",
    };
    let project = store.keysByProject[projectId];
    if (!project) {
      const keyId = `k_${randomUUID()}`;
      project = {
        activeKeyId: keyId,
        keys: { [keyId]: { secret: randomBytes(KEY_BYTES).toString("hex"), createdAt: new Date().toISOString() } },
      };
      store.keysByProject = { ...store.keysByProject, [projectId]: project };
      store.updatedAt = new Date().toISOString();
      await durableWriteJson(filePath, store);
    }
    return project;
  });
}

/** The active (keyId, secret) the ingress signs with for this workspace's project. */
export async function resolveEvidenceSigningKey({ workspaceRoot } = {}) {
  const { projectId } = await resolveHostIdentity({ workspaceRoot });
  const project = await ensureProjectKeyring({ projectId });
  const keyId = project.activeKeyId;
  const entry = project.keys?.[keyId];
  if (!entry || !entry.secret) {
    throw new HostIdentityError(`active key ${keyId} missing its secret for project ${projectId}`, "ERR_KEYRING_NO_ACTIVE_SECRET");
  }
  return { keyId, secret: entry.secret, projectId };
}

/**
 * The verification keyring for this workspace's project, in the shape the receipt
 * verifier expects: { <keyId>: { secret, revoked } }. Retired keys are retained (a
 * receipt signed by a now-retired key still verifies during its lifetime); revoked
 * keys are marked so the verifier rejects them.
 */
export async function resolveEvidenceKeyring({ workspaceRoot } = {}) {
  const { projectId } = await resolveHostIdentity({ workspaceRoot });
  const project = await ensureProjectKeyring({ projectId });
  const keyring = {};
  for (const [keyId, entry] of Object.entries(project.keys || {})) {
    if (!entry || !entry.secret) continue;
    keyring[keyId] = { secret: entry.secret, revoked: Boolean(entry.revokedAt) };
  }
  return { keyring, projectId };
}
