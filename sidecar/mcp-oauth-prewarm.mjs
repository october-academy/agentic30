import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { z } from "zod";
import {
  POSTHOG_MCP_SERVER_NAME,
  buildPostHogCodexMcpConfigFromSources,
  mergeCodexTomlPostHogMcpConfig,
} from "./posthog-mcp-config.mjs";
import {
  CLOUDFLARE_MCP_SERVER_NAME,
  DEFAULT_CLOUDFLARE_MCP_URL,
  buildCloudflareCodexMcpConfigFromSources,
  mergeCodexTomlCloudflareMcpConfig,
} from "./cloudflare-mcp-config.mjs";
import {
  VERCEL_MCP_SERVER_NAME,
  buildVercelCodexMcpConfigFromSources,
  mergeCodexTomlVercelMcpConfig,
} from "./vercel-mcp-config.mjs";

// Settings > 연동 "MCP 연결" 버튼의 실체. OAuth-first MCP(PostHog/Cloudflare)는
// 프로바이더(Claude Agent SDK / Codex)가 토큰을 "자기 캐시"에 저장한다 —
// 사이드카가 mcp-remote 등으로 대신 로그인하면 토큰이 다른 캐시에 남아
// 헛수고가 된다. 그래서 연결 버튼은 대상 MCP 도구를 호출하는 최소 프로바이더
// 쿼리를 돌려서 연결을 실증한다.
//
// 실측한 OAuth 핸드셰이크 메커니즘 (Claude Agent SDK 기준):
//   미인증 서버는 실제 도구 대신 mcp__<server>__authenticate /
//   complete_authentication 플레이스홀더 2개만 노출한다. authenticate를
//   호출하면 로그인 URL이 반환되고(콜백은 그 실행이 띄운 localhost 서버),
//   사용자가 브라우저에서 완료하면 토큰이 영속 캐시에 저장된다 — 이후의 새
//   실행은 즉시 실제 도구를 본다. "첫 사용 시 자동 브라우저 로그인"이 아니라
//   명시적 authenticate 호출이 트리거다.
//
// 타이밍 레이스 대응: 사용자가 로그인을 끝낸 시점이 모델의 마지막 재시도
// "이후"면 1차 실행은 login_pending으로 끝난다(실측된 시나리오). 토큰은
// 영속되므로, 1차가 login_pending이면 짧은 간격으로 검증 전용 재확인
// (authenticate 금지 — 새 URL 발급으로 기존 로그인 흐름을 깨지 않게)을
// 자동으로 돌려 ready를 잡는다.

export const MCP_OAUTH_PREWARM_OK_SENTINEL = "MCP_PREWARM_OK";
export const MCP_OAUTH_PREWARM_FAIL_SENTINEL = "MCP_PREWARM_FAIL";
export const MCP_OAUTH_PREWARM_LOGIN_URL_SENTINEL = "MCP_PREWARM_LOGIN_URL";
export const MCP_OAUTH_PREWARM_LOGIN_PENDING_SENTINEL = "MCP_PREWARM_LOGIN_PENDING";

// OAuth 첫 연결은 사용자가 브라우저에서 손으로 로그인을 끝내야 하므로 넉넉히.
export const MCP_OAUTH_PREWARM_TIMEOUT_MS = 240_000;
export const MCP_OAUTH_PREWARM_RECHECK_DELAY_MS = 12_000;
export const MCP_OAUTH_PREWARM_VERIFY_TIMEOUT_MS = 90_000;
export const MCP_OAUTH_PREWARM_MAX_RECHECKS = 2;
export const CODEX_MCP_CLI_GET_TIMEOUT_MS = 15_000;
export const MCP_OAUTH_LOGIN_URL_MAX_LENGTH = 16_384;

const MCP_OAUTH_CONNECT_RESULT_STATE_VALUES = ["ready", "login_pending", "verification_pending", "failed"];
const MCP_OAUTH_CONNECT_STATUS_STATE_VALUES = ["progress"];
export const MCP_OAUTH_CONNECT_STATES = Object.freeze([
  ...MCP_OAUTH_CONNECT_STATUS_STATE_VALUES,
  ...MCP_OAUTH_CONNECT_RESULT_STATE_VALUES,
]);

const boundedString = (maxLength) =>
  z.preprocess((value) => String(value ?? "").slice(0, maxLength), z.string().max(maxLength));
const optionalLoginUrl = z.string().url().max(MCP_OAUTH_LOGIN_URL_MAX_LENGTH).optional();
const contractState = (values) =>
  z.preprocess((value) => String(value ?? "").trim().toLowerCase(), z.enum(values));

export const McpOauthConnectResultSchema = z.object({
  server: boundedString(40),
  provider: boundedString(40),
  state: contractState(MCP_OAUTH_CONNECT_RESULT_STATE_VALUES),
  detail: boundedString(200),
  loginUrl: optionalLoginUrl,
  checkedAt: z.string().datetime(),
  providerLimited: z.boolean().optional(),
}).strict();

export const McpOauthConnectStatusSchema = z.object({
  server: boundedString(40).pipe(z.string().min(1).max(40)),
  provider: boundedString(40),
  state: contractState(MCP_OAUTH_CONNECT_STATUS_STATE_VALUES),
  detail: boundedString(200),
  loginUrl: optionalLoginUrl,
  openBrowser: z.boolean().optional(),
}).strict();

export const McpOauthProgressUpdateSchema = z.object({
  server: boundedString(40).pipe(z.string().min(1).max(40)),
  phase: boundedString(80).pipe(z.string().min(1).max(80)),
  detail: boundedString(200),
  loginUrl: optionalLoginUrl,
  openBrowser: z.boolean().optional(),
}).strict();

const McpOauthVerificationToolSchema = z.object({
  tool: z.string().min(1).max(80),
  prompt: z.string().min(1).max(1600),
}).strict();

export const McpOauthServerProfileSchema = z.object({
  server: z.string().min(1).max(40),
  label: z.string().min(1).max(80),
  mcpServerName: z.string().min(1).max(80),
  mcpNamespaceAliases: z.array(z.string().min(1).max(120)).min(1).max(4),
  executionMode: z.string().min(1).max(120),
  verificationTools: z.array(McpOauthVerificationToolSchema).max(6).default([]),
}).strict();

function zodIssueSummary(error) {
  return error.issues
    .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
    .join("; ");
}

function parseMcpOauthContract(schema, value, label) {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  throw new Error(`${label} contract violation: ${zodIssueSummary(parsed.error)}`);
}

export function parseMcpOauthConnectResult(value) {
  return parseMcpOauthContract(McpOauthConnectResultSchema, value, "MCP OAuth connect result");
}

export function parseMcpOauthConnectStatus(value) {
  return parseMcpOauthContract(McpOauthConnectStatusSchema, value, "MCP OAuth connect status");
}

export function parseMcpOauthProgressUpdate(value) {
  return parseMcpOauthContract(McpOauthProgressUpdateSchema, value, "MCP OAuth progress update");
}

export function parseMcpOauthServerProfile(value) {
  return parseMcpOauthContract(McpOauthServerProfileSchema, value, "MCP OAuth server profile");
}

function mcpNamespaceAliases(mcpServerName = "") {
  const name = String(mcpServerName || "").trim();
  const underscored = name.replace(/-/g, "_");
  return [...new Set([`mcp__${name}`, `mcp__${underscored}`])];
}

export const MCP_OAUTH_PREWARM_SERVERS = Object.freeze({
  posthog: {
    server: "posthog",
    label: "PostHog",
    mcpServerName: POSTHOG_MCP_SERVER_NAME,
    mcpNamespaceAliases: mcpNamespaceAliases(POSTHOG_MCP_SERVER_NAME),
    executionMode: "mcp_oauth_prewarm_posthog",
  },
  cloudflare: {
    server: "cloudflare",
    label: "Cloudflare",
    mcpServerName: CLOUDFLARE_MCP_SERVER_NAME,
    mcpNamespaceAliases: mcpNamespaceAliases(CLOUDFLARE_MCP_SERVER_NAME),
    executionMode: "mcp_oauth_prewarm_cloudflare",
    verificationTools: [
      {
        tool: "execute",
        prompt: [
          "Cloudflare exposes tools under the mcp__cloudflare_api namespace in Codex even though the configured server is cloudflare-api.",
          "Search ToolSearch for: cloudflare-api cloudflare_api mcp__cloudflare_api execute.",
          "Use mcp__cloudflare_api.execute, not a literal cloudflare-api tool.",
          "Call execute with this read-only code exactly:",
          'async () => cloudflare.request({ method: "GET", path: "/zones?status=active&per_page=1" })',
          "Do not count docs or search as verification; only execute proves the authenticated API path works.",
        ].join(" "),
      },
    ],
  },
  vercel: {
    server: "vercel",
    label: "Vercel",
    mcpServerName: VERCEL_MCP_SERVER_NAME,
    mcpNamespaceAliases: mcpNamespaceAliases(VERCEL_MCP_SERVER_NAME),
    executionMode: "mcp_oauth_prewarm_vercel",
  },
});
for (const profile of Object.values(MCP_OAUTH_PREWARM_SERVERS)) {
  parseMcpOauthServerProfile(profile);
}

// MCP OAuth prewarm을 지원하는 프로바이더 — 토큰 캐시가 이 둘에만 존재한다.
export const MCP_OAUTH_PREWARM_PROVIDERS = Object.freeze(["claude", "codex"]);

export function providerDisplayLabel(provider = "") {
  const normalized = String(provider || "").trim().toLowerCase();
  if (normalized === "claude") return "Claude";
  if (normalized === "codex") return "Codex";
  return normalized || "—";
}

// "MCP 연결"은 현재 선택한 프로바이더의 토큰 캐시에 연결을 만든다. 선택한
// 프로바이더(claude/codex)가 로그인돼 있지 않으면 다른 프로바이더로 조용히
// 넘어가는 대신 명확히 실패한다 — 다른 캐시를 검증해 봤자 사용자가 선택한
// 프로바이더의 AI 실행에서는 여전히 미인증이라 "연결됨" 배지가 거짓이 된다.
// claude/codex 외 프로바이더(gemini 등)는 MCP prewarm 자체가 없으므로 가용한
// 캐시로 폴백한다(기존 동작 유지).
export function resolveMcpOauthConnectProvider({
  requested = "",
  isProviderAvailable = () => false,
  fallbackProvider = "",
} = {}) {
  const normalized = String(requested || "").trim().toLowerCase();
  if (MCP_OAUTH_PREWARM_PROVIDERS.includes(normalized)) {
    if (isProviderAvailable(normalized)) return { provider: normalized, error: "" };
    return {
      provider: "",
      error: `선택한 프로바이더(${providerDisplayLabel(normalized)})가 로그인되어 있지 않아요 — 로그인 후 다시 'MCP 연결'을 누르거나 프로바이더를 변경해 주세요.`,
    };
  }
  if (fallbackProvider) return { provider: fallbackProvider, error: "" };
  return { provider: "", error: "사용 가능한 AI 프로바이더가 없어요 — Claude 또는 Codex 로그인이 필요해요." };
}

// 프로바이더 사용량 한도(세션/사용량/쿼터/레이트리밋) 에러 — MCP 연결 상태와
// 무관한 "나중에 재시도" 조건. 실측 메시지: Claude "You've hit your session
// limit · resets 10:40pm", Codex "You've hit your usage limit". 이걸 연결
// 실패로 격하하면 멀쩡한 OAuth 연결이 '미연결'로 둔갑한다.
export function isProviderUsageLimitMessage(message = "") {
  const value = String(message || "").toLowerCase();
  if (!value) return false;
  return (
    value.includes("session limit")
    || value.includes("usage limit")
    || value.includes("usage_limit")
    || value.includes("rate limit")
    || value.includes("rate_limit")
    || value.includes("quota")
    || value.includes("plan limit")
    || value.includes("hit your limit")
    || value.includes("reached your limit")
  );
}

export function normalizeMcpOauthPrewarmServer(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return MCP_OAUTH_PREWARM_SERVERS[normalized] ? normalized : "";
}

function requireTarget(server) {
  const target = MCP_OAUTH_PREWARM_SERVERS[normalizeMcpOauthPrewarmServer(server)];
  if (!target) {
    throw new Error(`Unknown MCP OAuth prewarm server: ${server}`);
  }
  return target;
}

export function buildMcpOauthPrewarmPrompt(server) {
  const target = requireTarget(server);
  const name = target.mcpServerName;
  const namespaceHint = mcpNamespacePromptHint(target);
  const verificationHint = mcpVerificationPromptHint(target);
  const authHint = mcpAuthPlaceholderPromptHint(target);
  return [
    `You are connecting and verifying the "${name}" MCP server. Follow these steps exactly.`,
    `1. Discover this server's tools. ${namespaceHint} If tools are deferred, load them via ToolSearch.`,
    `2. If real read-only tools are available, call the verification tool described here. ${verificationHint} When it returns a response (even an empty list), reply with exactly: ${MCP_OAUTH_PREWARM_OK_SENTINEL}`,
    `3. If only authentication placeholder tools exist (e.g. ${authHint}), the server is not authorized yet. Call the authenticate placeholder for this server. It returns a login URL. Immediately output this single line so the host app can open the browser:`,
    `${MCP_OAUTH_PREWARM_LOGIN_URL_SENTINEL}: <the full login URL>`,
    `4. After emitting the login URL line, give the user time to finish the browser login — they typically need 30-60 seconds. Re-discover the server's tools (ToolSearch again) and retry step 2 up to 8 times, patiently. The OAuth redirect only works while this session is alive, so do not give up early. If the real tools appear and a call succeeds, reply ${MCP_OAUTH_PREWARM_OK_SENTINEL}.`,
    `5. If the tools are still placeholder-only after the retries, the user has not finished the browser login yet. Reply with exactly: ${MCP_OAUTH_PREWARM_LOGIN_PENDING_SENTINEL}`,
    `6. If anything fails in a way that is not a pending login (connection error, tool error, no "${name}" tools at all), reply with exactly: ${MCP_OAUTH_PREWARM_FAIL_SENTINEL}: <one-line reason in Korean>`,
    "Rules: only use ToolSearch and this server's MCP tools. Do not read or write files. Do not run shell commands. End your reply with exactly one sentinel line.",
  ].join("\n");
}

// 재확인(2차 이후) 전용: authenticate를 다시 부르면 새 URL이 발급되어 사용자가
// 진행 중인 로그인 흐름을 깨므로, 토큰 캐시가 반영됐는지 "검증만" 한다.
export function buildMcpOauthVerifyPrompt(server) {
  const target = requireTarget(server);
  const name = target.mcpServerName;
  const namespaceHint = mcpNamespacePromptHint(target);
  const verificationHint = mcpVerificationPromptHint(target);
  const authHint = mcpAuthPlaceholderPromptHint(target);
  return [
    `You are verifying that the "${name}" MCP server is now authorized. The user just finished (or is finishing) a browser OAuth login.`,
    `1. Discover this server's tools. ${namespaceHint} If tools are deferred, load them via ToolSearch.`,
    `2. If real read-only tools are available, call the verification tool described here. ${verificationHint} When it returns a response (even an empty list), reply with exactly: ${MCP_OAUTH_PREWARM_OK_SENTINEL}`,
    `3. If only authentication placeholder tools exist (e.g. ${authHint}), do NOT call them — calling authenticate would issue a fresh login URL and break the user's in-progress login. Reply with exactly: ${MCP_OAUTH_PREWARM_LOGIN_PENDING_SENTINEL}`,
    `4. If anything fails in a way that is not a pending login (connection error, tool error, no "${name}" tools at all), reply with exactly: ${MCP_OAUTH_PREWARM_FAIL_SENTINEL}: <one-line reason in Korean>`,
    "Rules: only use ToolSearch and this server's MCP tools. Never call authenticate or complete_authentication. Do not read or write files. Do not run shell commands. End your reply with exactly one sentinel line.",
  ].join("\n");
}

function mcpNamespacePromptHint(target) {
  const aliases = targetNamespaceAliases(target);
  const prefixed = aliases.map((alias) => `${alias}__*`).join(" or ");
  const searchTerms = [
    target.mcpServerName,
    target.mcpServerName.replace(/-/g, "_"),
    ...aliases,
    ...targetVerificationToolNames(target),
  ].join(" ");
  return `Tool names may appear under ${prefixed}. Use ToolSearch query: "${searchTerms}".`;
}

function mcpVerificationPromptHint(target) {
  const tools = targetVerificationTools(target);
  if (!tools.length) {
    return "Call exactly one cheap read-only list/get/search tool with minimal arguments.";
  }
  return tools.map((tool) => tool.prompt).join(" ");
}

function mcpAuthPlaceholderPromptHint(target) {
  return targetNamespaceAliases(target)
    .map((alias) => `${alias}__authenticate`)
    .join(" or ");
}

export function extractMcpOauthLoginUrl(text) {
  const match = String(text || "").match(
    new RegExp(`${MCP_OAUTH_PREWARM_LOGIN_URL_SENTINEL}\\s*:\\s*(https?://\\S+)`),
  );
  return match ? match[1] : "";
}

export function parseMcpOauthPrewarmReply(text) {
  const value = String(text || "");
  const loginUrl = extractMcpOauthLoginUrl(value);
  if (value.includes(MCP_OAUTH_PREWARM_OK_SENTINEL)) {
    return { ok: true, loginPending: false, reason: "", loginUrl };
  }
  if (value.includes(MCP_OAUTH_PREWARM_LOGIN_PENDING_SENTINEL)) {
    return { ok: false, loginPending: true, reason: "", loginUrl };
  }
  const failIndex = value.indexOf(MCP_OAUTH_PREWARM_FAIL_SENTINEL);
  if (failIndex >= 0) {
    const reason = value
      .slice(failIndex + MCP_OAUTH_PREWARM_FAIL_SENTINEL.length)
      .replace(/^[:\s-]+/, "")
      .split("\n")[0]
      .trim();
    return { ok: false, loginPending: false, reason, loginUrl };
  }
  return { ok: false, loginPending: false, reason: "", loginUrl };
}

function result(server, provider, state, detail, loginUrl = "", extra = {}) {
  const candidate = {
    server,
    provider,
    state,
    detail: String(detail || "").slice(0, 200),
    ...(loginUrl ? { loginUrl } : {}),
    checkedAt: new Date().toISOString(),
    ...extra,
  };
  const parsed = McpOauthConnectResultSchema.safeParse(candidate);
  if (parsed.success) return parsed.data;
  return McpOauthConnectResultSchema.parse({
    server: String(server ?? "").slice(0, 40),
    provider: String(provider ?? "").slice(0, 40),
    state: "failed",
    detail: `MCP OAuth 결과 계약 오류: ${zodIssueSummary(parsed.error)}`.slice(0, 200),
    checkedAt: new Date().toISOString(),
    ...(typeof extra.providerLimited === "boolean" ? { providerLimited: extra.providerLimited } : {}),
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function defaultAppSupportPath() {
  return path.join(os.homedir(), "Library", "Application Support", "agentic30");
}

function defaultCodexHomePath(env = process.env) {
  return String(env.CODEX_HOME || path.join(env.AGENTIC30_APP_SUPPORT_PATH || defaultAppSupportPath(), "codex-home"));
}

function defaultCodexConfigToml() {
  return [
    "# Managed by agentic30. Do not read ~/.codex/config.toml from sidecar runs.",
    "notify = []",
    "",
    "[features]",
    "computer_use = false",
    "",
    "[mcp_servers]",
    "",
  ].join("\n");
}

const ANSI_ESCAPE_PATTERN = /\x1B\[[0-?]*[ -/]*[@-~]/g;
const HTTP_URL_PATTERN = /https?:\/\/[^\s"'<>\\]+/g;

function normalizeExtractedHttpUrl(url = "") {
  return String(url || "").replace(/[)\].,;]+$/, "");
}

export function extractHttpUrls(text = "") {
  const cleaned = String(text || "").replace(ANSI_ESCAPE_PATTERN, "");
  const matches = cleaned.match(HTTP_URL_PATTERN) || [];
  return [...new Set(matches.map(normalizeExtractedHttpUrl).filter(Boolean))];
}

export function extractFirstHttpUrl(text = "") {
  return extractHttpUrls(text)[0] || "";
}

function isMcpResourceUrl(url = "") {
  try {
    const parsed = new URL(url);
    return parsed.pathname.replace(/\/+$/, "") === "/mcp";
  } catch {
    return false;
  }
}

function isOauthAuthorizeUrl(url = "") {
  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname.toLowerCase();
    return pathname.split("/").includes("authorize")
      || (parsed.searchParams.get("response_type") === "code" && parsed.searchParams.has("client_id"))
      || (parsed.searchParams.has("code_challenge") && parsed.searchParams.has("redirect_uri"));
  } catch {
    return false;
  }
}

export function extractCodexMcpLoginUrl(text = "") {
  const urls = extractHttpUrls(text);
  return urls.find(isOauthAuthorizeUrl)
    || urls.find((url) => !isMcpResourceUrl(url))
    || "";
}

export function buildCodexMcpOauthServerConfig({
  server,
  env = process.env,
  appSupportPath = "",
} = {}) {
  const normalized = normalizeMcpOauthPrewarmServer(server);
  const target = MCP_OAUTH_PREWARM_SERVERS[normalized];
  if (!target) {
    throw new Error(`Unknown MCP OAuth prewarm server: ${server}`);
  }
  const sourceOptions = {
    env,
    appSupportPath: appSupportPath || env.AGENTIC30_APP_SUPPORT_PATH || defaultAppSupportPath(),
  };
  const map = normalized === "posthog"
    ? buildPostHogCodexMcpConfigFromSources(sourceOptions)
    : normalized === "cloudflare"
      ? buildCloudflareCodexMcpConfigFromSources(sourceOptions)
      : buildVercelCodexMcpConfigFromSources(sourceOptions);
  const config = { ...(map[target.mcpServerName] || {}) };
  if (normalized === "cloudflare" && !config.bearer_token_env_var && !config.oauth_resource) {
    config.oauth_resource = DEFAULT_CLOUDFLARE_MCP_URL;
  }
  return {
    server: normalized,
    label: target.label,
    mcpServerName: target.mcpServerName,
    config,
    authMode: config.bearer_token_env_var ? "api_key" : "oauth",
  };
}

export async function syncCodexMcpOauthServerConfig({
  server,
  codexHome = "",
  env = process.env,
  appSupportPath = "",
} = {}) {
  const codexHomePath = codexHome ? path.resolve(codexHome) : defaultCodexHomePath(env);
  const configPath = path.join(codexHomePath, "config.toml");
  const desired = buildCodexMcpOauthServerConfig({ server, env, appSupportPath });
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  let current = "";
  try {
    current = await fs.readFile(configPath, "utf8");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    current = defaultCodexConfigToml();
  }
  const next = desired.server === "posthog"
    ? mergeCodexTomlPostHogMcpConfig(current, desired.config)
    : desired.server === "cloudflare"
      ? mergeCodexTomlCloudflareMcpConfig(current, desired.config)
      : mergeCodexTomlVercelMcpConfig(current, desired.config);
  const changed = current !== next;
  if (changed) {
    await writeTextFileAtomically(configPath, next);
  }
  return {
    ...desired,
    codexHome: codexHomePath,
    configPath,
    changed,
  };
}

async function writeTextFileAtomically(filePath, content) {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempPath, content, { mode: 0o600 });
  await fs.rename(tempPath, filePath);
  await fs.chmod(filePath, 0o600).catch(() => {});
}

export async function runCodexMcpCommand({
  codexPath,
  args = [],
  env = process.env,
  cwd = process.cwd(),
  timeoutMs = MCP_OAUTH_PREWARM_TIMEOUT_MS,
  onOutput,
  stopWhen,
  backgroundOnStop = false,
  spawnImpl = spawn,
} = {}) {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;
    let killTimer = null;
    let child = null;
    const cleanupTimers = () => {
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
    };
    const resolveOnce = (payload) => {
      if (settled) return false;
      settled = true;
      resolve({ stdout, stderr, timedOut, ...payload });
      return true;
    };
    const finish = (payload) => {
      cleanupTimers();
      resolveOnce(payload);
    };
    const terminate = (signal = "SIGTERM") => {
      if (!child) return;
      try {
        if (process.platform !== "win32" && child.pid) {
          process.kill(-child.pid, signal);
        } else {
          child.kill(signal);
        }
      } catch {
        try {
          child.kill(signal);
        } catch {
          // best effort
        }
      }
    };
    const maybeStopEarly = (stream) => {
      if (settled || typeof stopWhen !== "function") return;
      let shouldStop = false;
      try {
        shouldStop = Boolean(stopWhen({ stdout, stderr, stream }));
      } catch {
        shouldStop = false;
      }
      if (!shouldStop) return;
      if (backgroundOnStop) {
        resolveOnce({ exitCode: null, signal: null, backgrounded: true });
        return;
      }
      terminate("SIGTERM");
      finish({ exitCode: null, signal: "SIGTERM", earlyStopped: true });
    };
    child = spawnImpl(codexPath, args, {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
    });
    const timer = setTimeout(() => {
      timedOut = true;
      terminate("SIGTERM");
      killTimer = setTimeout(() => {
        terminate("SIGKILL");
        finish({ exitCode: null, signal: "SIGKILL" });
      }, 1500);
    }, timeoutMs);
    child.stdout?.on("data", (chunk) => {
      const text = String(chunk || "");
      stdout += text;
      onOutput?.(text, "stdout");
      maybeStopEarly("stdout");
    });
    child.stderr?.on("data", (chunk) => {
      const text = String(chunk || "");
      stderr += text;
      onOutput?.(text, "stderr");
      maybeStopEarly("stderr");
    });
    child.on("error", (error) => finish({ exitCode: null, error }));
    child.on("close", (exitCode, signal) => finish({ exitCode, signal }));
  });
}

async function resolveCodexCliRuntime({
  env = process.env,
  buildCodexEnvImpl,
  resolveCodexBinaryPathImpl,
} = {}) {
  let buildEnv = buildCodexEnvImpl;
  let resolveBinaryPath = resolveCodexBinaryPathImpl;
  if (typeof buildEnv !== "function" || typeof resolveBinaryPath !== "function") {
    const providerRunner = await import("./provider-runner.mjs");
    buildEnv ||= providerRunner.buildCodexEnv;
    resolveBinaryPath ||= providerRunner.resolveCodexBinaryPath;
  }
  const codexEnv = buildEnv(env);
  const codexPath = resolveBinaryPath();
  if (!codexPath) {
    throw new Error("Codex CLI binary path is empty.");
  }
  return {
    codexPath,
    codexEnv,
    codexHome: defaultCodexHomePath(codexEnv),
  };
}

function isSuccessfulCodexCommand(commandResult = {}) {
  return !commandResult.timedOut && !commandResult.error && commandResult.exitCode === 0;
}

function summarizeCodexCommandFailure(commandResult = {}) {
  const text = [
    commandResult.error?.message,
    commandResult.stderr,
    commandResult.stdout,
    commandResult.signal ? `signal=${commandResult.signal}` : "",
    commandResult.exitCode !== null && commandResult.exitCode !== undefined ? `exit=${commandResult.exitCode}` : "",
  ]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return (text || "Codex CLI 명령이 실패했어요.").slice(0, 160);
}

function codexMcpAddArgs(desired) {
  const args = ["mcp", "add", desired.mcpServerName, "--url", desired.config.url];
  if (desired.config.bearer_token_env_var) {
    args.push("--bearer-token-env-var", desired.config.bearer_token_env_var);
  }
  if (desired.config.oauth_resource) {
    args.push("--oauth-resource", desired.config.oauth_resource);
  }
  return args;
}

async function prewarmCodexMcpOauth({
  normalized,
  target,
  workspaceRoot,
  env,
  timeoutMs,
  verifyTimeoutMs,
  progress,
  runProviderStreamImpl,
  runCodexMcpCommandImpl,
  buildCodexEnvImpl,
  resolveCodexBinaryPathImpl,
} = {}) {
  let runtime;
  try {
    runtime = await resolveCodexCliRuntime({
      env,
      buildCodexEnvImpl,
      resolveCodexBinaryPathImpl,
    });
  } catch (error) {
    return result(normalized, "codex", "failed", `Codex CLI를 사용할 수 없어요: ${error?.message || error}`);
  }

  const runCommandImpl = runCodexMcpCommandImpl || runCodexMcpCommand;
  let loginUrlAnnounced = "";
  let commandTranscript = "";
  const announceLoginUrl = (text) => {
    if (loginUrlAnnounced) return;
    const url = extractCodexMcpLoginUrl(text);
    if (!url) return;
    loginUrlAnnounced = url;
    progress("login_url", "브라우저가 열렸어요. 로그인 완료 후 앱에서 자동으로 MCP 도구 호출을 검증합니다.", {
      loginUrl: url,
      openBrowser: false,
    });
  };
  const runCli = async (args, phase, detail, commandTimeoutMs, options = {}) => {
    commandTranscript = "";
    progress(phase, detail);
    let commandResult;
    try {
      commandResult = await runCommandImpl({
        codexPath: runtime.codexPath,
        args,
        env: runtime.codexEnv,
        cwd: workspaceRoot || process.cwd(),
        timeoutMs: commandTimeoutMs,
        onOutput: (chunk) => {
          commandTranscript += String(chunk || "");
          announceLoginUrl(commandTranscript);
        },
        stopWhen: options.stopWhen,
        backgroundOnStop: Boolean(options.backgroundOnStop),
      });
    } catch (error) {
      commandResult = {
        stdout: commandTranscript,
        stderr: "",
        timedOut: false,
        exitCode: null,
        error,
      };
    }
    announceLoginUrl(`${commandResult.stdout || ""}\n${commandResult.stderr || ""}`);
    return commandResult;
  };

  progress("provider_started", `${target.label} MCP 서버를 Codex 설정에 등록하는 중… (codex)`);
  const appSupportPath = runtime.codexEnv.AGENTIC30_APP_SUPPORT_PATH || env.AGENTIC30_APP_SUPPORT_PATH || "";
  const desired = buildCodexMcpOauthServerConfig({
    server: normalized,
    env: runtime.codexEnv,
    appSupportPath,
  });

  const getTimeoutMs = Math.min(verifyTimeoutMs, CODEX_MCP_CLI_GET_TIMEOUT_MS);
  const initialGet = await runCli(
    ["mcp", "get", desired.mcpServerName, "--json"],
    "registering",
    `${target.label} MCP 서버 등록 여부를 확인하는 중…`,
    getTimeoutMs,
  );
  if (!isSuccessfulCodexCommand(initialGet)) {
    const addResult = await runCli(
      codexMcpAddArgs(desired),
      "registering",
      `${target.label} MCP 서버를 Codex에 등록하는 중…`,
      timeoutMs,
    );
    try {
      await syncCodexMcpOauthServerConfig({
        server: normalized,
        codexHome: runtime.codexHome,
        env: runtime.codexEnv,
        appSupportPath,
      });
    } catch (error) {
      return result(normalized, "codex", "failed", `Codex MCP 설정 저장 실패: ${error?.message || error}`, loginUrlAnnounced);
    }
    if ((addResult.timedOut || addResult.earlyStopped || addResult.backgrounded) && loginUrlAnnounced) {
      return result(
        normalized,
        "codex",
        "login_pending",
        `${target.label} 브라우저 로그인이 필요해요 — 로그인 완료 후 'MCP 연결'을 다시 눌러 검증해 주세요.`,
        loginUrlAnnounced,
      );
    }
    if (!isSuccessfulCodexCommand(addResult)) {
      return result(
        normalized,
        "codex",
        loginUrlAnnounced ? "login_pending" : "failed",
        loginUrlAnnounced
          ? `${target.label} 브라우저 로그인이 필요해요 — 로그인 완료 후 'MCP 연결'을 다시 눌러 검증해 주세요.`
          : `${target.label} MCP Codex 등록 실패: ${summarizeCodexCommandFailure(addResult)}`,
        loginUrlAnnounced,
      );
    }
  } else {
    try {
      await syncCodexMcpOauthServerConfig({
        server: normalized,
        codexHome: runtime.codexHome,
        env: runtime.codexEnv,
        appSupportPath,
      });
    } catch (error) {
      return result(normalized, "codex", "failed", `Codex MCP 설정 저장 실패: ${error?.message || error}`, loginUrlAnnounced);
    }
  }

  if (desired.authMode === "api_key") {
    return result(
      normalized,
      "codex",
      "ready",
      `${target.label} MCP 설정이 Codex에 등록됨 (${providerDisplayLabel("codex")}, API key) — 이 프로바이더의 AI 실행에서 바로 사용 가능해요.`,
    );
  }

  const loginResult = await runCli(
    ["mcp", "login", desired.mcpServerName],
    "authenticating",
    `${target.label} MCP OAuth 로그인을 Codex에서 시작하는 중…`,
    timeoutMs,
  );
  if (loginResult.timedOut) {
    return result(
      normalized,
      "codex",
      loginUrlAnnounced ? "login_pending" : "failed",
      loginUrlAnnounced
        ? `${target.label} 브라우저 로그인이 끝나지 않았어요 — 로그인 완료 후 'MCP 연결'을 다시 눌러 주세요.`
        : `${target.label} MCP Codex 로그인 시작이 시간 초과됐어요 — 다시 시도해 주세요.`,
      loginUrlAnnounced,
    );
  }
  if (!isSuccessfulCodexCommand(loginResult)) {
    return result(
      normalized,
      "codex",
      loginUrlAnnounced ? "login_pending" : "failed",
      loginUrlAnnounced
        ? `${target.label} 브라우저 로그인이 필요해요 — 로그인 완료 후 'MCP 연결'을 다시 눌러 검증해 주세요.`
        : `${target.label} MCP Codex 로그인 실패: ${summarizeCodexCommandFailure(loginResult)}`,
      loginUrlAnnounced,
    );
  }

  const verifyResult = await runCli(
    ["mcp", "get", desired.mcpServerName, "--json"],
    "verifying",
    `${target.label} MCP Codex 설정을 검증하는 중…`,
    getTimeoutMs,
  );
  if (!isSuccessfulCodexCommand(verifyResult)) {
    return result(
      normalized,
      "codex",
      "failed",
      `${target.label} MCP Codex 로그인 후 설정 검증 실패: ${summarizeCodexCommandFailure(verifyResult)}`,
      loginUrlAnnounced,
    );
  }

  if (typeof runProviderStreamImpl === "function") {
    const providerVerification = await verifyCodexMcpOauthWithProvider({
      normalized,
      target,
      workspaceRoot,
      runProviderStreamImpl,
      verifyTimeoutMs,
      progress,
      loginUrl: loginUrlAnnounced,
    });
    if (providerVerification) return providerVerification;
  }

  return result(
    normalized,
    "codex",
    "failed",
    `${target.label} Codex 설정은 확인됐지만 AI 실행에서 도구 호출 확인을 완료하지 못했어요 — 다시 'MCP 연결'을 눌러 검증해 주세요.`,
    loginUrlAnnounced,
  );
}

async function verifyCodexMcpOauthWithProvider({
  normalized,
  target,
  workspaceRoot,
  runProviderStreamImpl,
  verifyTimeoutMs,
  progress,
  loginUrl = "",
} = {}) {
  progress("verifying", `${target.label} MCP 도구 호출로 Codex 연결을 검증하는 중…`);
  const abortController = new AbortController();
  const timer = setTimeout(() => abortController.abort(), verifyTimeoutMs);
  let transcript = "";
  let sawTargetMcpToolCall = false;
  try {
    await runProviderStreamImpl({
      provider: "codex",
      prompt: buildMcpOauthVerifyPrompt(normalized),
      workspaceRoot,
      abortController,
      executionMode: target.executionMode,
      onTextDelta: (delta) => {
        transcript += String(delta || "");
      },
      onTextReplace: (text) => {
        transcript = String(text || "");
      },
      onToolEvent: (event) => {
        const toolName = String(event?.toolName || "");
        if (isTargetMcpToolUseEvent(event, target)) {
          sawTargetMcpToolCall = true;
          progress("tool_call", `${target.label} MCP 도구(${mcpToolDisplayName(event)}) 호출 중…`);
        }
      },
    });
  } catch (error) {
    if (abortController.signal.aborted) {
      return result(
        normalized,
        "codex",
        "verification_pending",
        `${target.label} 브라우저 로그인은 시작됐고 Codex 설정도 확인됐지만 MCP 도구 호출 검증이 시간 초과됐어요 — 'MCP 연결'을 다시 누르면 새 로그인 없이 검증을 이어갑니다.`,
        loginUrl,
      );
    }
    const message = String(error?.message || error);
    if (isProviderUsageLimitMessage(message)) {
      return result(
        normalized,
        "codex",
        "failed",
        `${target.label} MCP 연결을 확인하지 못했어요 — AI 프로바이더 사용량 한도예요(연결 문제 아님). ${message}`,
        loginUrl,
        { providerLimited: true },
      );
    }
    return result(
      normalized,
      "codex",
      "failed",
      `${target.label} Codex 도구 호출 확인 실패: ${message}`,
      loginUrl,
    );
  } finally {
    clearTimeout(timer);
  }

  const parsed = parseMcpOauthPrewarmReply(transcript);
  if (parsed.ok) {
    if (!sawTargetMcpToolCall) {
      return result(
        normalized,
        "codex",
        "failed",
        `${target.label} 로그인은 됐지만 Codex에서 실제 도구 호출을 확인하지 못했어요 — 다시 'MCP 연결'을 눌러 검증해 주세요.`,
        loginUrl || parsed.loginUrl,
      );
    }
    return result(
      normalized,
      "codex",
      "ready",
      `${target.label} MCP OAuth 로그인과 도구 호출이 확인됨 (${providerDisplayLabel("codex")}) — 이 프로바이더의 AI 실행에서 바로 사용 가능해요.`,
      loginUrl || parsed.loginUrl,
    );
  }
  if (parsed.loginPending) {
    return result(
      normalized,
      "codex",
      "login_pending",
      `${target.label} 브라우저 로그인이 아직 Codex 도구에 반영되지 않았어요 — 완료했다면 'MCP 연결'을 다시 눌러 새 로그인 없이 검증해 주세요.`,
      loginUrl || parsed.loginUrl,
    );
  }
  if (parsed.reason) {
    return result(
      normalized,
      "codex",
      "failed",
      `${target.label} Codex 연결 실패: ${parsed.reason}`,
      loginUrl || parsed.loginUrl,
    );
  }
  return result(
    normalized,
    "codex",
    "failed",
    `${target.label} Codex 도구 호출 확인 결과를 읽지 못했어요 — 다시 'MCP 연결'을 눌러 주세요.`,
    loginUrl || parsed.loginUrl,
  );
}

function targetNamespaceAliases(target) {
  return Array.isArray(target?.mcpNamespaceAliases) && target.mcpNamespaceAliases.length
    ? target.mcpNamespaceAliases
    : mcpNamespaceAliases(target?.mcpServerName);
}

function targetVerificationTools(target) {
  return Array.isArray(target?.verificationTools) ? target.verificationTools : [];
}

function targetVerificationToolNames(target) {
  return targetVerificationTools(target).map((tool) => tool.tool).filter(Boolean);
}

function normalizeMcpIdentifier(value = "") {
  return String(value || "").trim().toLowerCase().replace(/_/g, "-");
}

function targetServerMatches(value, target) {
  if (!value) return false;
  return normalizeMcpIdentifier(value) === normalizeMcpIdentifier(target?.mcpServerName);
}

function targetNamespaceMatches(value, target) {
  const normalized = String(value || "").trim().toLowerCase();
  return targetNamespaceAliases(target)
    .map((alias) => String(alias || "").trim().toLowerCase())
    .includes(normalized);
}

function parseTargetMcpToolName(toolName = "", target) {
  const value = String(toolName || "").trim();
  const lower = value.toLowerCase();
  for (const alias of [...targetNamespaceAliases(target)].sort((a, b) => b.length - a.length)) {
    const prefix = `${String(alias).toLowerCase()}__`;
    if (lower.startsWith(prefix)) {
      return {
        namespace: value.slice(0, alias.length),
        tool: value.slice(alias.length + 2),
      };
    }
  }
  return null;
}

function isTargetVerificationTool(toolName = "", target) {
  const allowed = targetVerificationToolNames(target).map((tool) => tool.toLowerCase());
  if (!allowed.length) return true;
  return allowed.includes(String(toolName || "").trim().toLowerCase());
}

function isTargetMcpToolUseEvent(event, target) {
  if (event?.phase !== "use") return false;
  const parsedName = parseTargetMcpToolName(event?.toolName, target);
  if (parsedName) {
    return !isMcpAuthPlaceholderToolName(parsedName.tool)
      && isTargetVerificationTool(parsedName.tool, target);
  }
  const payload = event?.payload && typeof event.payload === "object" ? event.payload : {};
  if (!targetServerMatches(payload.server, target) && !targetNamespaceMatches(payload.namespace, target)) return false;
  const toolName = String(payload.tool || payload.requestedToolName || event?.toolName || "");
  return !isMcpAuthPlaceholderToolName(toolName) && isTargetVerificationTool(toolName, target);
}

function isMcpAuthPlaceholderToolName(toolName = "") {
  const normalized = String(toolName || "").trim().toLowerCase();
  const shortName = normalized.includes("__") ? normalized.split("__").pop() : normalized;
  return shortName === "authenticate" || shortName === "complete_authentication";
}

function isTargetMcpAuthPlaceholderEvent(event, target) {
  if (event?.phase !== "use") return false;
  const parsedName = parseTargetMcpToolName(event?.toolName, target);
  if (parsedName) {
    return isMcpAuthPlaceholderToolName(parsedName.tool);
  }
  const payload = event?.payload && typeof event.payload === "object" ? event.payload : {};
  if (!targetServerMatches(payload.server, target) && !targetNamespaceMatches(payload.namespace, target)) return false;
  return isMcpAuthPlaceholderToolName(payload.tool || payload.requestedToolName || event?.toolName);
}

function mcpToolDisplayName(event) {
  const toolName = String(event?.toolName || "");
  if (toolName.includes("__")) return toolName.split("__").pop();
  const payload = event?.payload && typeof event.payload === "object" ? event.payload : {};
  return String(payload.tool || payload.requestedToolName || toolName || "tool");
}

export async function prewarmMcpOauth({
  server,
  provider,
  workspaceRoot,
  runProviderStreamImpl,
  onProgress,
  env = process.env,
  timeoutMs = MCP_OAUTH_PREWARM_TIMEOUT_MS,
  verifyTimeoutMs = MCP_OAUTH_PREWARM_VERIFY_TIMEOUT_MS,
  recheckDelayMs = MCP_OAUTH_PREWARM_RECHECK_DELAY_MS,
  maxRechecks = MCP_OAUTH_PREWARM_MAX_RECHECKS,
  runCodexMcpCommandImpl,
  buildCodexEnvImpl,
  resolveCodexBinaryPathImpl,
} = {}) {
  const normalized = normalizeMcpOauthPrewarmServer(server);
  const target = MCP_OAUTH_PREWARM_SERVERS[normalized];
  if (!target) {
    return result(String(server || ""), provider || "", "failed", "알 수 없는 MCP 서버예요 (posthog, cloudflare 또는 vercel).");
  }
  if (!provider) {
    return result(normalized, "", "failed", "사용 가능한 AI 프로바이더가 없어요 — Claude 또는 Codex 로그인이 필요해요.");
  }
  if (env.AGENTIC30_TEST_STUB_PROVIDER === "1") {
    // Hermetic UI tests: stub provider can't run MCP OAuth — succeed deterministically.
    return result(normalized, provider, "ready", `${target.label} MCP 연결 확인됨 (stub)`);
  }

  const progress = (phase, detail, extra = {}) => {
    try {
      const update = parseMcpOauthProgressUpdate({ server: normalized, phase, detail, ...extra });
      onProgress?.(update);
    } catch {
      // progress is best-effort; never let a listener break the prewarm
    }
  };

  if (String(provider || "").trim().toLowerCase() === "codex") {
    return prewarmCodexMcpOauth({
      normalized,
      target,
      workspaceRoot,
      env,
      timeoutMs,
      verifyTimeoutMs,
      progress,
      runProviderStreamImpl,
      runCodexMcpCommandImpl,
      buildCodexEnvImpl,
      resolveCodexBinaryPathImpl,
    });
  }

  if (typeof runProviderStreamImpl !== "function") {
    return result(normalized, provider, "failed", "프로바이더 실행기를 사용할 수 없어요.");
  }

  // 로그인 URL은 전체 시도에 걸쳐 한 번만 공지 — 재확인 시도에서 새 URL이
  // 나와도 브라우저를 다시 열어 사용자의 진행 중 로그인을 깨면 안 된다.
  let loginUrlAnnounced = "";
  const announceLoginUrl = (url) => {
    if (loginUrlAnnounced || !url) return;
    loginUrlAnnounced = url;
    progress("login_url", "브라우저가 열렸어요. 로그인 완료 후 앱에서 자동으로 MCP 도구 호출을 검증합니다.", { loginUrl: url });
  };

  const runAttempt = async ({ prompt, attemptTimeoutMs }) => {
    const abortController = new AbortController();
    const timer = setTimeout(() => abortController.abort(), attemptTimeoutMs);
    let transcript = "";
    let sawTargetMcpToolCall = false;
    const checkLoginUrl = () => announceLoginUrl(extractMcpOauthLoginUrl(transcript));
    // authenticate 도구의 result payload에서 로그인 URL을 직접 추출 — 모델이
    // 센티널 라인을 생략해도(실측: 종종 생략함) 브라우저 오픈이 누락되지 않게.
    const authenticateCallKeys = new Set();
    try {
      await runProviderStreamImpl({
        provider,
        prompt,
        workspaceRoot,
        abortController,
        executionMode: target.executionMode,
        onTextDelta: (delta) => {
          transcript += String(delta || "");
          checkLoginUrl();
        },
        onTextReplace: (text) => {
          transcript = String(text || "");
          checkLoginUrl();
        },
        onToolEvent: (event) => {
          const toolName = String(event?.toolName || "");
          const callKey = String(event?.toolCallKey || "");
          if (event?.phase === "use") {
            if (isTargetMcpAuthPlaceholderEvent(event, target)) {
              if (callKey) authenticateCallKeys.add(callKey);
              progress("authenticating", "OAuth 로그인 URL을 발급받는 중…");
            } else if (isTargetMcpToolUseEvent(event, target)) {
              sawTargetMcpToolCall = true;
              progress("tool_call", `${target.label} MCP 도구(${mcpToolDisplayName(event)}) 호출 중…`);
            } else if (loginUrlAnnounced) {
              // 로그인 URL 공지 이후의 도구 탐색은 "완료 확인" 단계 — 캡션이
              // "로그인을 완료해 주세요"에 멈춰 보이지 않게 진행을 알린다.
              progress("verifying", "브라우저 로그인 완료 여부를 확인하는 중…");
            }
            return;
          }
          if (event?.phase === "result" && callKey && authenticateCallKeys.has(callKey)) {
            const payloadText = typeof event.payload === "string"
              ? event.payload
              : JSON.stringify(event.payload || "");
            const match = payloadText.match(/https?:\/\/[^\s"'\\]+/);
            if (match) announceLoginUrl(match[0]);
          }
        },
      });
    } catch (error) {
      if (abortController.signal.aborted) {
        return { kind: "timeout" };
      }
      return { kind: "error", message: String(error?.message || error) };
    } finally {
      clearTimeout(timer);
    }
    return { kind: "done", parsed: parseMcpOauthPrewarmReply(transcript), sawTargetMcpToolCall };
  };

  progress("provider_started", `${target.label} MCP 도구 호출로 연결을 확인하는 중… (${provider})`);
  let attempt = await runAttempt({
    prompt: buildMcpOauthPrewarmPrompt(normalized),
    attemptTimeoutMs: timeoutMs,
  });

  // 1차가 login_pending이면 토큰 영속 캐시를 믿고 자동 재확인: 사용자가
  // 로그인을 끝낸 직후라면 새 실행이 즉시 실제 도구를 본다(실측 확인).
  let rechecksUsed = 0;
  while (
    rechecksUsed < maxRechecks
    && attempt.kind === "done"
    && !attempt.parsed.ok
    && (attempt.parsed.loginPending || (loginUrlAnnounced && !attempt.parsed.reason))
  ) {
    rechecksUsed += 1;
    progress(
      "login_recheck",
      `로그인 완료를 자동으로 재확인하는 중 (${rechecksUsed}/${maxRechecks})…`,
    );
    await sleep(recheckDelayMs);
    attempt = await runAttempt({
      prompt: buildMcpOauthVerifyPrompt(normalized),
      attemptTimeoutMs: verifyTimeoutMs,
    });
  }

  if (attempt.kind === "timeout") {
    return result(
      normalized,
      provider,
      loginUrlAnnounced ? "login_pending" : "failed",
      loginUrlAnnounced
        ? `${target.label} 브라우저 로그인이 끝나지 않았어요 — 로그인 완료 후 'MCP 연결'을 다시 눌러 주세요.`
        : `${target.label} MCP 연결 확인이 시간 초과됐어요 — 다시 시도해 주세요.`,
      loginUrlAnnounced,
    );
  }
  if (attempt.kind === "error") {
    if (isProviderUsageLimitMessage(attempt.message)) {
      // 한도 에러는 연결을 검증할 수 없었을 뿐 — 연결 실패가 아니다. 호출자
      // (persistMcpOauthConnectResult)는 이 플래그로 기존 ready 격하를 막는다.
      return result(
        normalized,
        provider,
        "failed",
        `${target.label} MCP 연결을 확인하지 못했어요 — AI 프로바이더 사용량 한도예요(연결 문제 아님). ${attempt.message}`,
        loginUrlAnnounced,
        { providerLimited: true },
      );
    }
    return result(normalized, provider, "failed", `${target.label} MCP 연결 확인 실패: ${attempt.message}`, loginUrlAnnounced);
  }

  const parsed = attempt.parsed;
  const loginUrl = loginUrlAnnounced || parsed.loginUrl;
  if (parsed.ok) {
    if (!attempt.sawTargetMcpToolCall) {
      return result(
        normalized,
        provider,
        "failed",
        `${target.label} 로그인은 됐지만 실제 MCP 도구 호출을 확인하지 못했어요 — 다시 'MCP 연결'을 눌러 검증해 주세요.`,
        loginUrl,
      );
    }
    // 어느 프로바이더 캐시에 연결됐는지를 배지 캡션에 남긴다 — 토큰 캐시는
    // 프로바이더별이라 이 라벨이 곧 "어디서 쓸 수 있는 연결인지"다.
    return result(
      normalized,
      provider,
      "ready",
      `${target.label} MCP 도구 호출 검증됨 (${providerDisplayLabel(provider)}) — 이 프로바이더의 AI 실행에서 바로 사용 가능해요.`,
      loginUrl,
    );
  }
  if (parsed.loginPending || (loginUrl && !parsed.reason)) {
    return result(
      normalized,
      provider,
      "login_pending",
      `${target.label} 브라우저 로그인이 필요해요 — 로그인 완료 후 'MCP 연결'을 다시 눌러 검증해 주세요.`,
      loginUrl,
    );
  }
  if (parsed.reason) {
    return result(normalized, provider, "failed", `${target.label} MCP 연결 실패: ${parsed.reason}`, loginUrl);
  }
  return result(normalized, provider, "failed", `${target.label} MCP 응답에서 확인 신호를 찾지 못했어요 — 다시 시도해 주세요.`, loginUrl);
}
