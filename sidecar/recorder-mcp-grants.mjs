import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { atomicWriteJson, withFileLock } from "./atomic-store.mjs";
import {
  RECORDER_ACCESS_LEVELS,
  assertRecorderMcpAccess,
} from "./recorder-raw-api-auth.mjs";

export const RECORDER_MCP_GRANTS_SCHEMA_VERSION = 1;
export const RECORDER_MCP_GRANTS_FILE = "recorder-mcp-grants.json";

const DEFAULT_GRANT_TTL_MS = 5 * 60 * 1000;
const MAX_GRANT_TTL_MS = 15 * 60 * 1000;
const RAW_MCP_ACCESS_LEVELS = new Set(["raw_frame", "raw_audio", "export", "raw_sql", "raw_admin"]);

export class RecorderMcpGrantError extends Error {
  constructor(code, message, details = {}) {
    super(`${code}: ${message}`);
    this.name = "RecorderMcpGrantError";
    this.code = code;
    this.details = details;
  }
}

export function resolveRecorderMcpGrantsPath(appSupportPath = "") {
  const root = cleanRequired(appSupportPath, "appSupportPath", "ERR_RECORDER_MCP_GRANTS_APP_SUPPORT_REQUIRED", 1000);
  return path.join(path.resolve(root), RECORDER_MCP_GRANTS_FILE);
}

export async function loadRecorderMcpGrantStore({ appSupportPath = "", filePath = "" } = {}) {
  const resolvedPath = filePath || resolveRecorderMcpGrantsPath(appSupportPath);
  let parsed = null;
  try {
    parsed = JSON.parse(await fs.readFile(resolvedPath, "utf8"));
  } catch (error) {
    if (error?.code !== "ENOENT") {
      fail("ERR_RECORDER_MCP_GRANTS_READ_FAILED", "failed to read recorder MCP grants", {
        filePath: resolvedPath,
        cause: error?.message || String(error),
      });
    }
  }
  return normalizeRecorderMcpGrantStore(parsed || {});
}

export async function persistRecorderMcpGrantStore({ appSupportPath = "", filePath = "", state } = {}) {
  const resolvedPath = filePath || resolveRecorderMcpGrantsPath(appSupportPath);
  const normalized = normalizeRecorderMcpGrantStore(state);
  await withFileLock(resolvedPath, async () => {
    await atomicWriteJson(resolvedPath, normalized);
  });
  return normalized;
}

export async function grantRecorderMcpAccess({
  appSupportPath = "",
  toolName,
  accessLevels,
  ttlMs = DEFAULT_GRANT_TTL_MS,
  grantedBy = "local_user",
  reason = "",
  rawAdminConfirmed = false,
  now = new Date(),
  idFactory = randomUUID,
} = {}) {
  const filePath = resolveRecorderMcpGrantsPath(appSupportPath);
  const current = await loadRecorderMcpGrantStore({ filePath });
  const grant = buildRecorderMcpGrant({
    toolName,
    accessLevels,
    ttlMs,
    grantedBy,
    reason,
    rawAdminConfirmed,
    now,
    idFactory,
  });
  const next = normalizeRecorderMcpGrantStore({
    ...current,
    grants: [grant, ...current.grants],
  });
  await persistRecorderMcpGrantStore({ filePath, state: next });
  return grant;
}

export async function listRecorderMcpGrants({ appSupportPath = "", now = new Date() } = {}) {
  const state = await loadRecorderMcpGrantStore({ appSupportPath });
  return state.grants.map((grant) => decorateGrantState(grant, now));
}

export async function revokeRecorderMcpGrant({
  appSupportPath = "",
  grantId,
  revokedBy = "local_user",
  now = new Date(),
} = {}) {
  const filePath = resolveRecorderMcpGrantsPath(appSupportPath);
  const current = await loadRecorderMcpGrantStore({ filePath });
  const id = cleanRequired(grantId, "grantId", "ERR_RECORDER_MCP_GRANT_ID_REQUIRED", 240);
  let found = null;
  const revokedAt = toIso(now);
  const nextGrants = current.grants.map((grant) => {
    if (grant.id !== id) return grant;
    found = grant;
    return {
      ...grant,
      revokedAt,
      revoked_at: revokedAt,
      revokedBy: cleanString(revokedBy, 180) || "local_user",
      revoked_by: cleanString(revokedBy, 180) || "local_user",
    };
  });
  if (!found) {
    fail("ERR_RECORDER_MCP_GRANT_NOT_FOUND", `recorder MCP grant not found: ${id}`);
  }
  const next = normalizeRecorderMcpGrantStore({ ...current, grants: nextGrants });
  await persistRecorderMcpGrantStore({ filePath, state: next });
  return decorateGrantState(next.grants.find((grant) => grant.id === id), now);
}

export async function assertPersistedRecorderMcpAccess({
  appSupportPath = "",
  toolName,
  accessLevel,
  now = new Date(),
} = {}) {
  const grant = await findActiveRecorderMcpGrant({ appSupportPath, toolName, accessLevel, now });
  return assertRecorderMcpAccess({ accessLevel, toolName, grant, now });
}

export async function findActiveRecorderMcpGrant({
  appSupportPath = "",
  toolName,
  accessLevel,
  now = new Date(),
} = {}) {
  const tool = cleanRequired(toolName, "toolName", "ERR_RECORDER_MCP_TOOL_NAME_REQUIRED", 180);
  const state = await loadRecorderMcpGrantStore({ appSupportPath });
  for (const grant of state.grants) {
    if (grant.toolName !== tool) continue;
    if (grant.revokedAt) continue;
    try {
      assertRecorderMcpAccess({ accessLevel, toolName: tool, grant, now });
      return grant;
    } catch {
      // Keep searching; expired or scope-mismatched grants are not active grants.
    }
  }
  return null;
}

export function normalizeRecorderMcpGrantStore(input = {}) {
  const grants = Array.isArray(input?.grants)
    ? input.grants.map(normalizeRecorderMcpGrant).filter(Boolean)
    : [];
  return {
    schemaVersion: RECORDER_MCP_GRANTS_SCHEMA_VERSION,
    schema_version: RECORDER_MCP_GRANTS_SCHEMA_VERSION,
    grants,
  };
}

function buildRecorderMcpGrant({
  toolName,
  accessLevels,
  ttlMs,
  grantedBy,
  reason,
  rawAdminConfirmed,
  now,
  idFactory,
}) {
  const tool = cleanRequired(toolName, "toolName", "ERR_RECORDER_MCP_TOOL_NAME_REQUIRED", 180);
  const levels = normalizeGrantAccessLevels(accessLevels);
  if (levels.includes("raw_admin") && rawAdminConfirmed !== true) {
    fail("ERR_RECORDER_MCP_RAW_ADMIN_CONFIRMATION_REQUIRED", "raw_admin MCP grants require explicit local confirmation");
  }
  const ttl = normalizeGrantTtl(ttlMs);
  const grantedAt = toIso(now);
  const expiresAt = new Date(new Date(grantedAt).getTime() + ttl).toISOString();
  return normalizeRecorderMcpGrant({
    id: cleanRequired(idFactory(), "grantId", "ERR_RECORDER_MCP_GRANT_ID_REQUIRED", 240),
    granted: true,
    toolName: tool,
    tool_name: tool,
    accessLevels: levels,
    access_levels: levels,
    grantedBy: cleanRequired(grantedBy, "grantedBy", "ERR_RECORDER_MCP_GRANTED_BY_REQUIRED", 180),
    granted_by: cleanRequired(grantedBy, "grantedBy", "ERR_RECORDER_MCP_GRANTED_BY_REQUIRED", 180),
    grantedAt,
    granted_at: grantedAt,
    expiresAt,
    expires_at: expiresAt,
    reason: cleanString(reason, 500),
    revokedAt: null,
    revoked_at: null,
  });
}

function normalizeRecorderMcpGrant(input = {}) {
  const id = cleanString(input.id, 240);
  const toolName = cleanString(input.toolName ?? input.tool_name, 180);
  const accessLevels = normalizeGrantAccessLevels(input.accessLevels ?? input.access_levels ?? input.scopes ?? []);
  const grantedAt = normalizeIso(input.grantedAt ?? input.granted_at);
  const expiresAt = normalizeIso(input.expiresAt ?? input.expires_at);
  if (!id || !toolName || !accessLevels.length || !grantedAt || !expiresAt) return null;
  const revokedAt = normalizeNullableIso(input.revokedAt ?? input.revoked_at);
  return {
    id,
    granted: input.granted === false ? false : !revokedAt,
    toolName,
    tool_name: toolName,
    accessLevels,
    access_levels: accessLevels,
    grantedBy: cleanString(input.grantedBy ?? input.granted_by, 180) || "local_user",
    granted_by: cleanString(input.grantedBy ?? input.granted_by, 180) || "local_user",
    grantedAt,
    granted_at: grantedAt,
    expiresAt,
    expires_at: expiresAt,
    reason: cleanString(input.reason, 500),
    revokedAt,
    revoked_at: revokedAt,
    revokedBy: cleanString(input.revokedBy ?? input.revoked_by, 180),
    revoked_by: cleanString(input.revokedBy ?? input.revoked_by, 180),
  };
}

function decorateGrantState(grant, now) {
  const expiresAtMs = Date.parse(grant.expiresAt);
  const nowMs = new Date(now).getTime();
  const revoked = Boolean(grant.revokedAt);
  const expired = !Number.isFinite(expiresAtMs) || expiresAtMs <= nowMs;
  return {
    ...grant,
    active: !revoked && !expired && grant.granted === true,
    state: revoked ? "revoked" : expired ? "expired" : "active",
  };
}

function normalizeGrantAccessLevels(value) {
  const input = Array.isArray(value) ? value : [value];
  const output = [];
  const seen = new Set();
  for (const item of input) {
    const level = cleanString(item, 80);
    if (!level || seen.has(level)) continue;
    if (!RECORDER_ACCESS_LEVELS.includes(level)) {
      fail("ERR_RECORDER_MCP_GRANT_ACCESS_LEVEL_UNKNOWN", `unknown recorder MCP access level: ${level}`);
    }
    if (!RAW_MCP_ACCESS_LEVELS.has(level)) {
      fail("ERR_RECORDER_MCP_GRANT_RAW_ACCESS_REQUIRED", "MCP grants are only required for raw recorder access", {
        accessLevel: level,
      });
    }
    seen.add(level);
    output.push(level);
  }
  if (!output.length) {
    fail("ERR_RECORDER_MCP_GRANT_ACCESS_LEVEL_REQUIRED", "recorder MCP grant requires at least one raw access level");
  }
  return output;
}

function normalizeGrantTtl(value) {
  const ttl = Number.parseInt(String(value ?? DEFAULT_GRANT_TTL_MS), 10);
  if (!Number.isFinite(ttl) || ttl <= 0) {
    fail("ERR_RECORDER_MCP_GRANT_TTL_INVALID", "recorder MCP grant TTL must be a positive number of milliseconds");
  }
  if (ttl > MAX_GRANT_TTL_MS) {
    fail("ERR_RECORDER_MCP_GRANT_TTL_TOO_LONG", "recorder MCP grant TTL exceeds the maximum allowed", {
      ttlMs: ttl,
      maxTtlMs: MAX_GRANT_TTL_MS,
    });
  }
  return ttl;
}

function normalizeIso(value) {
  const text = cleanString(value, 80);
  if (!text) return "";
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function normalizeNullableIso(value) {
  const iso = normalizeIso(value);
  return iso || null;
}

function toIso(value) {
  const date = value instanceof Date ? value : new Date(value ?? Date.now());
  if (Number.isNaN(date.getTime())) {
    fail("ERR_RECORDER_MCP_GRANT_INVALID_TIMESTAMP", "recorder MCP grant timestamp is invalid");
  }
  return date.toISOString();
}

function cleanRequired(value, label, code, maxLength) {
  const cleaned = cleanString(value, maxLength);
  if (!cleaned) fail(code, `${label} is required`);
  return cleaned;
}

function cleanString(value = "", maxLength = 500) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function fail(code, message, details = {}) {
  throw new RecorderMcpGrantError(code, message, details);
}
