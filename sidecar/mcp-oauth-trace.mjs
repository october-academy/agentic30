import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

export const MCP_OAUTH_TRACE_FILE = "mcp-oauth-traces.jsonl";
const DEFAULT_TRACE_LIMIT = 10;

export function createMcpOauthTraceId() {
  return randomUUID();
}

export function resolveMcpOauthTracePath(appSupportPath = "") {
  return path.join(String(appSupportPath || "."), MCP_OAUTH_TRACE_FILE);
}

function sanitizeTraceEntry(entry = {}) {
  return {
    traceId: String(entry.traceId || "").slice(0, 80),
    at: String(entry.at || new Date().toISOString()),
    server: String(entry.server || "").slice(0, 40),
    provider: String(entry.provider || "").slice(0, 40),
    phase: String(entry.phase || "").slice(0, 80),
    durationMs: Math.max(0, Math.round(Number(entry.durationMs) || 0)),
    state: String(entry.state || "").slice(0, 40),
    hasLoginUrl: Boolean(entry.hasLoginUrl),
    commandCount: Math.max(0, Math.round(Number(entry.commandCount) || 0)),
    providerRunCount: Math.max(0, Math.round(Number(entry.providerRunCount) || 0)),
  };
}

export async function appendMcpOauthTrace({
  appSupportPath = "",
  entry = {},
  fsImpl = fs,
} = {}) {
  if (!appSupportPath) return null;
  const filePath = resolveMcpOauthTracePath(appSupportPath);
  const sanitized = sanitizeTraceEntry(entry);
  await fsImpl.mkdir(path.dirname(filePath), { recursive: true });
  await fsImpl.appendFile(filePath, `${JSON.stringify(sanitized)}\n`, { mode: 0o600 });
  await fsImpl.chmod?.(filePath, 0o600).catch?.(() => {});
  return sanitized;
}

export function readRecentMcpOauthTraces({
  appSupportPath = "",
  limit = DEFAULT_TRACE_LIMIT,
} = {}) {
  if (!appSupportPath) return [];
  try {
    const filePath = resolveMcpOauthTracePath(appSupportPath);
    if (!fsSync.existsSync(filePath)) return [];
    const max = Math.max(0, Math.min(100, Number.parseInt(limit, 10) || DEFAULT_TRACE_LIMIT));
    return fsSync.readFileSync(filePath, "utf8")
      .split(/\r?\n/)
      .filter(Boolean)
      .slice(-max)
      .map((line) => {
        try {
          return sanitizeTraceEntry(JSON.parse(line));
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}
