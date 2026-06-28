import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

export const RECORDER_RAW_API_AUTH_SCHEMA_VERSION = 1;

export const RECORDER_ACCESS_LEVELS = Object.freeze([
  "summary",
  "search",
  "frame",
  "raw_frame",
  "audio",
  "raw_audio",
  "export",
  "pipe",
  "raw_sql",
  "raw_admin",
]);

const ACCESS_LEVEL_SET = new Set(RECORDER_ACCESS_LEVELS);
const RAW_ACCESS_LEVELS = new Set(["raw_frame", "raw_audio", "export", "raw_sql", "raw_admin"]);
const MCP_DEFAULT_ACCESS_LEVELS = new Set(["summary", "search"]);
const DEFAULT_TOKEN_TTL_MS = 15 * 60 * 1000;
const MAX_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_RAW_TOKEN_TTL_MS = 15 * 60 * 1000;

const ACCESS_IMPLICATIONS = Object.freeze({
  summary: ["summary"],
  search: ["summary", "search"],
  frame: ["summary", "search", "frame"],
  raw_frame: ["summary", "search", "frame", "raw_frame"],
  audio: ["summary", "audio"],
  raw_audio: ["summary", "audio", "raw_audio"],
  export: ["export"],
  pipe: ["summary", "search", "pipe"],
  raw_sql: ["raw_sql"],
  raw_admin: RECORDER_ACCESS_LEVELS,
});

export class RecorderRawApiAuthError extends Error {
  constructor(code, message, details = {}) {
    super(`${code}: ${message}`);
    this.name = "RecorderRawApiAuthError";
    this.code = code;
    this.details = details;
  }
}

export function issueRecorderApiToken({
  store,
  clientId,
  clientName,
  actorType = "local_user",
  scopes = ["summary"],
  issuedBy = "sidecar",
  ttlMs = DEFAULT_TOKEN_TTL_MS,
  rawAdminConfirmed = false,
  now = new Date(),
  tokenFactory = defaultTokenFactory,
} = {}) {
  assertStore(store);
  const normalizedScopes = normalizeScopes(scopes);
  const expiresAt = computeExpiry({
    scopes: normalizedScopes,
    ttlMs,
    rawAdminConfirmed,
    now,
  });
  const token = cleanString(tokenFactory(), 1000);
  if (!token) {
    fail("ERR_RECORDER_RAW_API_TOKEN_FACTORY_EMPTY", "tokenFactory returned an empty token");
  }

  const issuedAt = toIso(now);
  const id = randomUUID();
  store.insertRecord("api_tokens", {
    id,
    token_hash: hashToken(token),
    client_id: cleanRequired(clientId, "clientId", "ERR_RECORDER_RAW_API_CLIENT_ID_REQUIRED", 180),
    client_name: cleanRequired(clientName, "clientName", "ERR_RECORDER_RAW_API_CLIENT_NAME_REQUIRED", 180),
    actor_type: cleanRequired(actorType, "actorType", "ERR_RECORDER_RAW_API_ACTOR_TYPE_REQUIRED", 80),
    scopes_json: JSON.stringify(normalizedScopes),
    issued_by: cleanRequired(issuedBy, "issuedBy", "ERR_RECORDER_RAW_API_ISSUED_BY_REQUIRED", 180),
    issued_at: issuedAt,
    expires_at: expiresAt,
    revoked_at: null,
    last_used_at: null,
  });

  return {
    schemaVersion: RECORDER_RAW_API_AUTH_SCHEMA_VERSION,
    token,
    tokenId: id,
    token_id: id,
    clientId: cleanString(clientId, 180),
    client_id: cleanString(clientId, 180),
    scopes: normalizedScopes,
    issuedAt,
    issued_at: issuedAt,
    expiresAt,
    expires_at: expiresAt,
  };
}

export function validateRecorderApiToken({
  store,
  token,
  requiredAccessLevel = "summary",
  now = new Date(),
} = {}) {
  assertStore(store);
  const rawToken = cleanString(token, 1000);
  if (!rawToken) {
    fail("ERR_RECORDER_RAW_API_TOKEN_REQUIRED", "raw API token is required");
  }
  const accessLevel = normalizeAccessLevel(requiredAccessLevel);
  const tokenHash = hashToken(rawToken);
  const row = findTokenByHash(store, tokenHash);
  if (!row) {
    fail("ERR_RECORDER_RAW_API_TOKEN_NOT_FOUND", "raw API token was not issued by this sidecar");
  }
  if (row.revoked_at) {
    fail("ERR_RECORDER_RAW_API_TOKEN_REVOKED", "raw API token is revoked", { tokenId: row.id });
  }
  if (new Date(row.expires_at).getTime() <= new Date(now).getTime()) {
    fail("ERR_RECORDER_RAW_API_TOKEN_EXPIRED", "raw API token is expired", { tokenId: row.id });
  }

  const scopes = parseScopes(row.scopes_json);
  if (!scopesAuthorize(scopes, accessLevel)) {
    fail("ERR_RECORDER_RAW_API_PERMISSION_DENIED", "raw API token does not grant the required access level", {
      tokenId: row.id,
      requiredAccessLevel: accessLevel,
      scopes,
    });
  }

  const usedAt = toIso(now);
  store.updateRecord("api_tokens", row.id, { last_used_at: usedAt });
  return tokenContext(row, scopes, accessLevel, usedAt);
}

export function revokeRecorderApiToken({
  store,
  tokenId,
  revokedAt = new Date(),
} = {}) {
  assertStore(store);
  const id = cleanRequired(tokenId, "tokenId", "ERR_RECORDER_RAW_API_TOKEN_ID_REQUIRED", 240);
  const row = store.getRecord("api_tokens", id);
  if (!row) {
    fail("ERR_RECORDER_RAW_API_TOKEN_NOT_FOUND", `raw API token not found: ${id}`);
  }
  store.updateRecord("api_tokens", id, { revoked_at: toIso(revokedAt) });
  return { tokenId: id, token_id: id, revokedAt: toIso(revokedAt), revoked_at: toIso(revokedAt) };
}

export function authorizeRecorderRawRead({
  store,
  token,
  requiredAccessLevel,
  endpoint,
  origin,
  requestId = randomUUID(),
  workspaceId = null,
  projectId = null,
  sourceIds = [],
  trustedOrigins = defaultTrustedOrigins(),
  now = new Date(),
} = {}) {
  assertStore(store);
  const auditBase = {
    store,
    requestId,
    actorType: "anonymous",
    actorId: "unknown",
    workspaceId,
    projectId,
    endpoint,
    accessLevel: requiredAccessLevel,
    sourceIds,
    now,
  };

  let context = null;
  try {
    assertAuditContext({ endpoint, requiredAccessLevel, requestId });
    assertTrustedOrigin(origin, trustedOrigins);
    context = validateRecorderApiToken({ store, token, requiredAccessLevel, now });
    const audit = recordRecorderAudit({
      ...auditBase,
      actorType: context.actorType,
      actorId: context.clientId,
      accessLevel: context.accessLevel,
      decision: "accepted",
      reason: "authorized_raw_read",
    });
    return {
      authorized: true,
      audit,
      token: context,
      canExposeFilesystemPaths: context.canExposeFilesystemPaths,
      can_expose_filesystem_paths: context.canExposeFilesystemPaths,
    };
  } catch (error) {
    const code = error?.code || "ERR_RECORDER_RAW_API_AUTH_FAILED";
    if (hasAuditContext({ endpoint, requiredAccessLevel, requestId })) {
      recordRecorderAudit({
        ...auditBase,
        actorType: context?.actorType || "anonymous",
        actorId: context?.clientId || "unknown",
        accessLevel: cleanString(requiredAccessLevel, 80) || "unknown",
        decision: "denied",
        reason: code,
      });
    }
    throw error;
  }
}

export function recordRecorderAudit({
  store,
  requestId,
  actorType,
  actorId,
  workspaceId = null,
  projectId = null,
  endpoint,
  accessLevel,
  sourceIds = [],
  decision,
  reason = "",
  now = new Date(),
} = {}) {
  assertStore(store);
  assertAuditContext({ endpoint, requiredAccessLevel: accessLevel, requestId });
  const normalizedDecision = cleanRequired(decision, "decision", "ERR_RECORDER_RAW_API_AUDIT_DECISION_REQUIRED", 80);
  if (!["accepted", "denied"].includes(normalizedDecision)) {
    fail("ERR_RECORDER_RAW_API_AUDIT_DECISION_UNKNOWN", "recorder audit decision must be accepted or denied", {
      decision: normalizedDecision,
    });
  }
  const id = randomUUID();
  const createdAt = toIso(now);
  store.insertRecord("recorder_audit", {
    id,
    request_id: cleanRequired(requestId, "requestId", "ERR_RECORDER_RAW_API_REQUEST_ID_REQUIRED", 240),
    actor_type: cleanRequired(actorType, "actorType", "ERR_RECORDER_RAW_API_ACTOR_TYPE_REQUIRED", 80),
    actor_id: cleanRequired(actorId, "actorId", "ERR_RECORDER_RAW_API_ACTOR_ID_REQUIRED", 180),
    workspace_id: cleanString(workspaceId, 240) || null,
    project_id: cleanString(projectId, 240) || null,
    endpoint: cleanRequired(endpoint, "endpoint", "ERR_RECORDER_RAW_API_ENDPOINT_REQUIRED", 240),
    access_level: cleanRequired(accessLevel, "accessLevel", "ERR_RECORDER_RAW_API_ACCESS_LEVEL_REQUIRED", 80),
    source_ids_json: JSON.stringify(normalizeSourceIds(sourceIds)),
    decision: normalizedDecision,
    reason: cleanString(reason, 500),
    created_at: createdAt,
  });
  return {
    id,
    requestId: cleanString(requestId, 240),
    request_id: cleanString(requestId, 240),
    decision: normalizedDecision,
    createdAt,
    created_at: createdAt,
  };
}

export function isRecorderMcpAccessAllowedByDefault(accessLevel) {
  return MCP_DEFAULT_ACCESS_LEVELS.has(normalizeAccessLevel(accessLevel));
}

export function assertRecorderMcpAccess({
  accessLevel,
  grant = null,
  toolName = "",
  now = new Date(),
} = {}) {
  const normalizedAccessLevel = normalizeAccessLevel(accessLevel);
  if (isRecorderMcpAccessAllowedByDefault(normalizedAccessLevel)) {
    return { allowed: true, decision: "default_allow", accessLevel: normalizedAccessLevel };
  }
  if (!grant || grant.granted !== true) {
    fail("ERR_RECORDER_MCP_RAW_ACCESS_DENIED", "MCP raw recorder access is denied until the local user grants a scoped capability", {
      accessLevel: normalizedAccessLevel,
    });
  }
  const grantToolName = cleanString(grant.toolName ?? grant.tool_name, 180);
  const requestedToolName = cleanString(toolName, 180);
  if (requestedToolName && grantToolName && requestedToolName !== grantToolName) {
    fail("ERR_RECORDER_MCP_GRANT_TOOL_MISMATCH", "MCP recorder grant is scoped to a different tool", {
      requestedToolName,
      grantToolName,
    });
  }
  const expiresAt = new Date(grant.expiresAt ?? grant.expires_at ?? 0);
  if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= new Date(now).getTime()) {
    fail("ERR_RECORDER_MCP_GRANT_EXPIRED", "MCP recorder grant is expired or missing expiresAt");
  }
  const grantScopes = normalizeScopes(grant.accessLevels ?? grant.access_levels ?? grant.scopes ?? []);
  if (!scopesAuthorize(grantScopes, normalizedAccessLevel)) {
    fail("ERR_RECORDER_MCP_GRANT_SCOPE_DENIED", "MCP recorder grant does not allow the requested access level", {
      accessLevel: normalizedAccessLevel,
      grantScopes,
    });
  }
  return { allowed: true, decision: "scoped_grant", accessLevel: normalizedAccessLevel };
}

function computeExpiry({
  scopes,
  ttlMs,
  rawAdminConfirmed,
  now,
}) {
  const ttl = Number.parseInt(String(ttlMs), 10);
  if (!Number.isFinite(ttl) || ttl <= 0) {
    fail("ERR_RECORDER_RAW_API_TOKEN_TTL_INVALID", "raw API token TTL must be a positive number of milliseconds");
  }
  const hasRawScope = scopes.some((scope) => RAW_ACCESS_LEVELS.has(scope));
  if (scopes.includes("raw_admin") && rawAdminConfirmed !== true) {
    fail("ERR_RECORDER_RAW_API_RAW_ADMIN_CONFIRMATION_REQUIRED", "raw_admin token issuance requires local user confirmation");
  }
  const maxTtl = hasRawScope ? MAX_RAW_TOKEN_TTL_MS : MAX_TOKEN_TTL_MS;
  if (ttl > maxTtl) {
    fail("ERR_RECORDER_RAW_API_TOKEN_TTL_TOO_LONG", "raw API token TTL exceeds the maximum allowed for its scopes", {
      ttlMs: ttl,
      maxTtlMs: maxTtl,
      scopes,
    });
  }
  return new Date(new Date(now).getTime() + ttl).toISOString();
}

function tokenContext(row, scopes, accessLevel, lastUsedAt) {
  return {
    tokenId: row.id,
    token_id: row.id,
    clientId: row.client_id,
    client_id: row.client_id,
    clientName: row.client_name,
    client_name: row.client_name,
    actorType: row.actor_type,
    actor_type: row.actor_type,
    scopes,
    accessLevel,
    access_level: accessLevel,
    expiresAt: row.expires_at,
    expires_at: row.expires_at,
    lastUsedAt,
    last_used_at: lastUsedAt,
    canExposeFilesystemPaths: scopes.includes("raw_admin"),
    can_expose_filesystem_paths: scopes.includes("raw_admin"),
  };
}

function findTokenByHash(store, tokenHash) {
  const rows = store.listRecords("api_tokens", { limit: 5000 });
  return rows.find((row) => tokenHashEquals(row.token_hash, tokenHash)) || null;
}

function tokenHashEquals(lhs, rhs) {
  const left = Buffer.from(String(lhs ?? ""));
  const right = Buffer.from(String(rhs ?? ""));
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function hashToken(token) {
  return `sha256:${createHash("sha256").update(String(token)).digest("hex")}`;
}

function defaultTokenFactory() {
  return `a30_recorder_${randomBytes(32).toString("base64url")}`;
}

function normalizeScopes(value) {
  const input = Array.isArray(value) ? value : [value];
  const output = [];
  const seen = new Set();
  for (const item of input) {
    const scope = normalizeAccessLevel(item);
    if (seen.has(scope)) continue;
    seen.add(scope);
    output.push(scope);
  }
  if (!output.length) {
    fail("ERR_RECORDER_RAW_API_SCOPES_REQUIRED", "raw API token requires at least one scope");
  }
  return output;
}

function parseScopes(scopesJson) {
  try {
    return normalizeScopes(JSON.parse(scopesJson));
  } catch {
    fail("ERR_RECORDER_RAW_API_SCOPES_INVALID", "stored raw API token scopes are invalid JSON");
  }
}

function scopesAuthorize(scopes, requiredAccessLevel) {
  const required = normalizeAccessLevel(requiredAccessLevel);
  return scopes.some((scope) => ACCESS_IMPLICATIONS[scope]?.includes(required));
}

function normalizeAccessLevel(value) {
  const accessLevel = cleanString(value, 80);
  if (!ACCESS_LEVEL_SET.has(accessLevel)) {
    fail("ERR_RECORDER_RAW_API_ACCESS_LEVEL_UNKNOWN", `unknown recorder access level: ${accessLevel || "(missing)"}`);
  }
  return accessLevel;
}

function assertTrustedOrigin(origin, trustedOrigins) {
  const normalizedOrigin = cleanString(origin, 240);
  if (!normalizedOrigin) {
    fail("ERR_RECORDER_RAW_API_ORIGIN_REQUIRED", "raw API request origin is required");
  }
  if (!isTrustedOrigin(normalizedOrigin, trustedOrigins)) {
    fail("ERR_RECORDER_RAW_API_ORIGIN_DENIED", "raw API origin is not trusted", { origin: normalizedOrigin });
  }
}

function isTrustedOrigin(origin, trustedOrigins = defaultTrustedOrigins()) {
  if (origin === "agentic30://app") return true;
  try {
    const parsed = new URL(origin);
    if (!["http:", "https:"].includes(parsed.protocol)) return false;
    if (!["127.0.0.1", "::1", "localhost"].includes(parsed.hostname)) return false;
  } catch {
    return false;
  }
  const allowed = new Set(trustedOrigins.map((item) => cleanString(item, 240)).filter(Boolean));
  return allowed.has(origin)
    || allowed.has(new URL(origin).origin)
    || [...allowed].some((item) => item.endsWith(":*") && origin.startsWith(item.slice(0, -1)));
}

function defaultTrustedOrigins() {
  return ["agentic30://app", "http://127.0.0.1:*", "http://localhost:*"];
}

function normalizeSourceIds(value) {
  const input = Array.isArray(value) ? value : [value];
  const output = [];
  const seen = new Set();
  for (const item of input) {
    if (item == null || item === "") continue;
    const id = typeof item === "string"
      ? cleanString(item, 240)
      : cleanString(item.id ?? item.sourceId ?? item.source_id, 240);
    if (!id || seen.has(id)) continue;
    if (id.startsWith("/") || id.includes("../")) {
      fail("ERR_RECORDER_RAW_API_AUDIT_SOURCE_ID_UNSAFE", "audit source IDs must not contain raw filesystem paths", {
        id,
      });
    }
    seen.add(id);
    const sourceType = typeof item === "string"
      ? "unknown"
      : cleanString(item.sourceType ?? item.source_type ?? item.sourceKind ?? item.source_kind, 80) || "unknown";
    output.push({ id, source_type: sourceType });
  }
  return output.slice(0, 100);
}

function assertAuditContext({ endpoint, requiredAccessLevel, requestId }) {
  cleanRequired(requestId, "requestId", "ERR_RECORDER_RAW_API_REQUEST_ID_REQUIRED", 240);
  cleanRequired(endpoint, "endpoint", "ERR_RECORDER_RAW_API_ENDPOINT_REQUIRED", 240);
  cleanRequired(requiredAccessLevel, "accessLevel", "ERR_RECORDER_RAW_API_ACCESS_LEVEL_REQUIRED", 80);
}

function hasAuditContext({ endpoint, requiredAccessLevel, requestId }) {
  return Boolean(cleanString(requestId, 240) && cleanString(endpoint, 240) && cleanString(requiredAccessLevel, 80));
}

function assertStore(store) {
  if (!store || typeof store.insertRecord !== "function" || typeof store.updateRecord !== "function" || typeof store.listRecords !== "function") {
    fail("ERR_RECORDER_RAW_API_STORE_REQUIRED", "raw API auth requires a RecorderStore-like store");
  }
}

function cleanRequired(value, label, code, maxLength) {
  const cleaned = cleanString(value, maxLength);
  if (!cleaned) fail(code, `${label} is required`);
  return cleaned;
}

function cleanString(value = "", maxLength = 500) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function toIso(value) {
  const date = value instanceof Date ? value : new Date(value ?? Date.now());
  if (Number.isNaN(date.getTime())) {
    fail("ERR_RECORDER_RAW_API_INVALID_TIME", "raw API auth received an invalid timestamp");
  }
  return date.toISOString();
}

function fail(code, message, details = {}) {
  throw new RecorderRawApiAuthError(code, message, details);
}
