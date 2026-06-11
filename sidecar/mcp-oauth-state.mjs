import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

import { normalizeMcpOauthPrewarmServer } from "./mcp-oauth-prewarm.mjs";

// OAuth-first MCP(PostHog/Cloudflare)의 연결 검증 결과 영속 저장소.
// 토큰 자체는 프로바이더(Claude/Codex)가 자기 캐시에 보관하므로 사이드카는
// 토큰을 볼 수 없다 — 대신 "MCP 연결" 버튼이 실증한 마지막 결과를 기록해
// 브리핑 소스 게이트와 Settings 상태 배지가 OAuth 연결을 인정할 수 있게 한다.
// 토큰이 아니라 검증 사실만 저장하므로 시크릿이 디스크에 남지 않는다.
//
// 스키마 v2: 토큰 캐시가 프로바이더별로 분리돼 있으므로(Claude 캐시 검증이
// Codex 캐시를 보증하지 않음) 검증 결과도 servers[server].providers[provider]
// 단위로 기록한다. v1(servers[server] = { state, provider, ... })은 읽기 시
// provider 키 아래로 자동 승격된다.

export const MCP_OAUTH_STATE_FILE = "mcp-oauth-state.json";
export const MCP_OAUTH_STATE_SCHEMA_VERSION = 2;
export const MCP_OAUTH_STATE_PROVIDERS = Object.freeze(["claude", "codex"]);

export function resolveMcpOauthStatePath(appSupportPath) {
  return path.join(String(appSupportPath || "."), MCP_OAUTH_STATE_FILE);
}

export function normalizeMcpOauthProvider(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return MCP_OAUTH_STATE_PROVIDERS.includes(normalized) ? normalized : "";
}

function normalizeProviderRecord(record = {}) {
  const state = String(record?.state || "").trim().toLowerCase();
  if (!["ready", "login_pending", "failed"].includes(state)) return null;
  return {
    state,
    detail: String(record?.detail || "").slice(0, 200),
    checkedAt: String(record?.checkedAt || ""),
  };
}

function normalizeServerEntry(value = {}) {
  const providers = {};
  if (value?.providers && typeof value.providers === "object") {
    for (const [providerKey, record] of Object.entries(value.providers)) {
      const provider = normalizeMcpOauthProvider(providerKey);
      const normalized = normalizeProviderRecord(record);
      if (provider && normalized) providers[provider] = normalized;
    }
  } else {
    // v1 마이그레이션: 단일 레코드의 provider 필드를 키로 승격. provider가
    // claude/codex가 아니면(빈 값 포함) 어느 캐시 검증인지 알 수 없어 버린다.
    const provider = normalizeMcpOauthProvider(value?.provider);
    const record = normalizeProviderRecord(value);
    if (provider && record) providers[provider] = record;
  }
  return Object.keys(providers).length ? { providers } : null;
}

export function normalizeMcpOauthState(input = {}) {
  const servers = {};
  const rawServers = input?.servers && typeof input.servers === "object" ? input.servers : {};
  for (const [key, value] of Object.entries(rawServers)) {
    const server = normalizeMcpOauthPrewarmServer(key);
    if (!server) continue;
    const entry = normalizeServerEntry(value);
    if (entry) servers[server] = entry;
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

export function mcpOauthProviderRecord(state, server, provider) {
  const normalizedServer = normalizeMcpOauthPrewarmServer(server);
  const normalizedProvider = normalizeMcpOauthProvider(provider);
  if (!normalizedServer || !normalizedProvider) return null;
  return state?.servers?.[normalizedServer]?.providers?.[normalizedProvider] || null;
}

export function mcpOauthReadyProviders(state, server) {
  const normalizedServer = normalizeMcpOauthPrewarmServer(server);
  if (!normalizedServer) return [];
  const providers = state?.servers?.[normalizedServer]?.providers || {};
  return Object.entries(providers)
    .filter(([, record]) => record?.state === "ready")
    .map(([provider]) => provider);
}

// provider를 지정하면 그 프로바이더의 토큰 캐시 기준으로만 ready를 판정한다.
// provider가 비어 있거나 claude/codex가 아니면(MCP prewarm 미지원 프로바이더)
// "어느 프로바이더로든 검증됨"(any-ready)으로 판정한다 — v1 동작과 호환.
export function isMcpOauthServerReady(state, server, provider = "") {
  const normalizedProvider = normalizeMcpOauthProvider(provider);
  if (normalizedProvider) {
    return mcpOauthProviderRecord(state, server, normalizedProvider)?.state === "ready";
  }
  return mcpOauthReadyProviders(state, server).length > 0;
}

// "MCP 연결" 결과를 서버×프로바이더 단위로 갱신. 같은 프로바이더의 최신 시도가
// 진실 — 이전에 ready였어도 재시도가 failed면 failed로 내려간다(연결이 실제로
// 깨졌을 수 있으므로). 다른 프로바이더의 기록은 건드리지 않는다.
export async function persistMcpOauthConnectResult({
  appSupportPath = "",
  result = {},
  fsImpl = fs,
} = {}) {
  const server = normalizeMcpOauthPrewarmServer(result?.server);
  const provider = normalizeMcpOauthProvider(result?.provider);
  if (!appSupportPath || !server || !provider) return null;
  const record = normalizeProviderRecord(result);
  if (!record) return null;
  const current = readMcpOauthState(appSupportPath);
  const currentRecord = current.servers?.[server]?.providers?.[provider];
  // 프로바이더 사용량 한도(providerLimited)로 검증이 막힌 실패는 연결 상태에
  // 대한 정보가 없다 — OAuth 토큰 캐시는 그대로 유효하므로 같은 프로바이더의
  // 기존 ready를 failed로 격하하지 않고 마지막 검증 결과를 유지한다.
  if (
    record.state === "failed"
    && result?.providerLimited
    && currentRecord?.state === "ready"
  ) {
    return current;
  }
  const next = {
    ...current,
    servers: {
      ...current.servers,
      [server]: {
        providers: {
          ...(current.servers?.[server]?.providers || {}),
          [provider]: record,
        },
      },
    },
  };
  const filePath = resolveMcpOauthStatePath(appSupportPath);
  await fsImpl.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.tmp`;
  await fsImpl.writeFile(tempPath, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  await fsImpl.rename(tempPath, filePath);
  return next;
}
