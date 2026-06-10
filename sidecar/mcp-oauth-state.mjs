import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

import { normalizeMcpOauthPrewarmServer } from "./mcp-oauth-prewarm.mjs";

// OAuth-first MCP(PostHog/Cloudflare)의 연결 검증 결과 영속 저장소.
// 토큰 자체는 프로바이더(Claude/Codex)가 자기 캐시에 보관하므로 사이드카는
// 토큰을 볼 수 없다 — 대신 "MCP 연결" 버튼이 실증한 마지막 결과를 기록해
// 브리핑 소스 게이트와 Settings 상태 배지가 OAuth 연결을 인정할 수 있게 한다.
// 토큰이 아니라 검증 사실만 저장하므로 시크릿이 디스크에 남지 않는다.

export const MCP_OAUTH_STATE_FILE = "mcp-oauth-state.json";
export const MCP_OAUTH_STATE_SCHEMA_VERSION = 1;

export function resolveMcpOauthStatePath(appSupportPath) {
  return path.join(String(appSupportPath || "."), MCP_OAUTH_STATE_FILE);
}

function normalizeServerRecord(record = {}) {
  const state = String(record?.state || "").trim().toLowerCase();
  if (!["ready", "login_pending", "failed"].includes(state)) return null;
  return {
    state,
    provider: String(record?.provider || "").trim().toLowerCase(),
    detail: String(record?.detail || "").slice(0, 200),
    checkedAt: String(record?.checkedAt || ""),
  };
}

export function normalizeMcpOauthState(input = {}) {
  const servers = {};
  const rawServers = input?.servers && typeof input.servers === "object" ? input.servers : {};
  for (const [key, value] of Object.entries(rawServers)) {
    const server = normalizeMcpOauthPrewarmServer(key);
    if (!server) continue;
    const record = normalizeServerRecord(value);
    if (record) servers[server] = record;
  }
  return { schemaVersion: MCP_OAUTH_STATE_SCHEMA_VERSION, servers };
}

// 소스 게이트(externalSourceStatus)는 동기 컨텍스트라 readAdConfig와 같은
// 패턴의 동기 읽기를 제공한다. 파일이 없거나 깨졌으면 빈 상태.
export function readMcpOauthState(appSupportPath = "") {
  if (!appSupportPath) return normalizeMcpOauthState();
  try {
    const filePath = resolveMcpOauthStatePath(appSupportPath);
    if (!fsSync.existsSync(filePath)) return normalizeMcpOauthState();
    return normalizeMcpOauthState(JSON.parse(fsSync.readFileSync(filePath, "utf8")));
  } catch {
    return normalizeMcpOauthState();
  }
}

export function isMcpOauthServerReady(state, server) {
  const normalized = normalizeMcpOauthPrewarmServer(server);
  if (!normalized) return false;
  return state?.servers?.[normalized]?.state === "ready";
}

// "MCP 연결" 결과를 서버 단위로 갱신. 최신 시도가 진실 — 이전에 ready였어도
// 재시도가 failed면 failed로 내려간다(연결이 실제로 깨졌을 수 있으므로).
export async function persistMcpOauthConnectResult({
  appSupportPath = "",
  result = {},
  fsImpl = fs,
} = {}) {
  const server = normalizeMcpOauthPrewarmServer(result?.server);
  if (!appSupportPath || !server) return null;
  const record = normalizeServerRecord(result);
  if (!record) return null;
  const current = readMcpOauthState(appSupportPath);
  const next = {
    ...current,
    servers: { ...current.servers, [server]: record },
  };
  const filePath = resolveMcpOauthStatePath(appSupportPath);
  await fsImpl.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.tmp`;
  await fsImpl.writeFile(tempPath, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  await fsImpl.rename(tempPath, filePath);
  return next;
}
