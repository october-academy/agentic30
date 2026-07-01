// Recorder MCP tools — the deny-by-default raw surface for external MCP clients.
//
// Gate B requires "MCP raw access is denied by default and must be granted per
// tool." The recorder MCP grant policy (recorder-mcp-grants.mjs +
// assertRecorderMcpAccess) already existed, but no MCP tool consulted it — the
// deny-by-default policy guarded a door the MCP surface never opened. This
// module is that door: a bounded read-only recorder SQL inspector tool that
// fails closed unless the local user has granted a scoped `raw_sql` capability
// for the calling tool, and that reuses the vetted raw-API pipeline
// (handleRecorderRawApiRequest) for validation, the sandboxed worker, per-value
// redaction, and the accepted/denied audit row.
//
// Two auth models are bridged deliberately: the MCP grant (deny-by-default,
// per-tool, local-user-scoped) authorizes the CALL; on success an ephemeral,
// short-lived, immediately-revoked raw_sql API token drives the existing raw-API
// SQL path so there is exactly one SQL execution + redaction + audit code path.
// Recorder SQL output is local, redacted, audited, and never proof.

import { randomUUID } from "node:crypto";

import {
  assertRecorderMcpAccess,
  issueRecorderApiToken,
  recordRecorderAudit,
  revokeRecorderApiToken,
} from "./recorder-raw-api-auth.mjs";
import { handleRecorderRawApiRequest } from "./recorder-raw-api-server.mjs";
import { findActiveRecorderMcpGrant } from "./recorder-mcp-grants.mjs";

export const RECORDER_MCP_RAW_SQL_TOOL = "recorder_raw_sql_query";
const MCP_TOOL_ENDPOINT = "/recorder/mcp/sql/query";
const EPHEMERAL_TOKEN_TTL_MS = 30_000;

export class RecorderMcpToolError extends Error {
  constructor(code, message, details = {}) {
    super(`${code}: ${message}`);
    this.name = "RecorderMcpToolError";
    this.code = code;
    this.details = details;
  }
}

function toolActorId(toolName) {
  return `mcp:${String(toolName ?? "").trim().slice(0, 160) || RECORDER_MCP_RAW_SQL_TOOL}`;
}

// The raw-API handler returns { status, headers, body } with body as a Buffer.
// Normalize to { status, body } with body parsed to an object for MCP consumers.
function normalizeRawApiResponse(response) {
  const status = response?.status ?? response?.statusCode ?? 0;
  let body = response?.body;
  if (Buffer.isBuffer(body)) body = body.toString("utf8");
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      // Leave non-JSON bodies as-is.
    }
  }
  return { status, body };
}

// Pure/DI form: the caller resolves the MCP grant (or passes null) and provides
// the RecorderStore. Fully testable without the filesystem.
//
// grant === null / expired / wrong-scope / wrong-tool -> assertRecorderMcpAccess
// throws ERR_RECORDER_MCP_RAW_ACCESS_DENIED (or a more specific reason); we still
// write a DENIED audit row for the raw-access attempt, then rethrow (fail-closed).
// grant valid -> issue an ephemeral raw_sql token, run the query through the
// existing raw-API SQL pipeline (which writes the ACCEPTED audit row and redacts
// every value), revoke the token, and return the raw-API response verbatim.
export async function runRecorderMcpRawSqlQuery({
  store,
  grant = null,
  toolName = RECORDER_MCP_RAW_SQL_TOOL,
  query,
  timeoutMs,
  now = new Date(),
  tokenFactory,
} = {}) {
  if (!store || typeof store.insertRecord !== "function") {
    throw new RecorderMcpToolError(
      "ERR_RECORDER_MCP_TOOL_STORE_REQUIRED",
      "runRecorderMcpRawSqlQuery requires a RecorderStore",
    );
  }
  const cleanTool = String(toolName ?? "").trim() || RECORDER_MCP_RAW_SQL_TOOL;
  const requestId = randomUUID();

  // 1. Deny-by-default MCP grant check.
  try {
    assertRecorderMcpAccess({ accessLevel: "raw_sql", grant, toolName: cleanTool, now });
  } catch (error) {
    recordRecorderAudit({
      store,
      requestId,
      actorType: "mcp_tool",
      actorId: toolActorId(cleanTool),
      endpoint: MCP_TOOL_ENDPOINT,
      accessLevel: "raw_sql",
      decision: "denied",
      reason: error?.code || "ERR_RECORDER_MCP_RAW_ACCESS_DENIED",
      now,
    });
    throw error;
  }

  // 2. Bridge to the vetted raw-API SQL pipeline with an ephemeral raw_sql token.
  const issued = issueRecorderApiToken({
    store,
    clientId: toolActorId(cleanTool),
    clientName: cleanTool,
    actorType: "mcp_tool",
    scopes: ["raw_sql"],
    issuedBy: "mcp-server",
    ttlMs: EPHEMERAL_TOKEN_TTL_MS,
    now,
    ...(tokenFactory ? { tokenFactory } : {}),
  });
  try {
    const response = await handleRecorderRawApiRequest({
      store,
      method: "POST",
      url: "/recorder/sql/query",
      headers: {
        authorization: `Bearer ${issued.token}`,
        origin: "agentic30://app",
        "x-agentic30-recorder-request-id": requestId,
      },
      body: JSON.stringify({ query, ...(timeoutMs == null ? {} : { timeoutMs }) }),
      now,
    });
    return normalizeRawApiResponse(response);
  } finally {
    // The token lives only for this one call; revoke immediately regardless of outcome.
    revokeRecorderApiToken({ store, tokenId: issued.tokenId, revokedAt: now });
  }
}

// Convenience form for the MCP server: resolves the active per-tool grant from
// the on-disk grant store under appSupportPath, then delegates to the DI form.
export async function runRecorderMcpRawSqlQueryFromAppSupport({
  store,
  appSupportPath = "",
  toolName = RECORDER_MCP_RAW_SQL_TOOL,
  query,
  timeoutMs,
  now = new Date(),
} = {}) {
  const grant = await findActiveRecorderMcpGrant({
    appSupportPath,
    toolName,
    accessLevel: "raw_sql",
    now,
  });
  return runRecorderMcpRawSqlQuery({ store, grant, toolName, query, timeoutMs, now });
}
