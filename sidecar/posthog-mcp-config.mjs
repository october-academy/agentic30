import fsSync from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const POSTHOG_MCP_SERVER_NAME = "posthog";
export const POSTHOG_MCP_TOKEN_ENV_VAR = "POSTHOG_MCP_API_KEY";
export const POSTHOG_AUTH_HEADER_ENV_VAR = "POSTHOG_AUTH_HEADER";
export const DEFAULT_POSTHOG_MCP_REGION = "us";
export const DEFAULT_POSTHOG_MCP_URL = "https://mcp.posthog.com/mcp";
export const POSTHOG_EU_MCP_URL = "https://mcp-eu.posthog.com/mcp";
export const DEFAULT_POSTHOG_MCP_MODE = "tools";
export const DEFAULT_POSTHOG_MCP_CONSUMER = "agentic30";
export const DEFAULT_POSTHOG_MCP_READONLY = true;
export const DEFAULT_POSTHOG_MCP_FEATURES = Object.freeze([
  "sql",
  "data_schema",
  "insights",
  "web_analytics",
  "search",
  "docs",
]);
export const POSTHOG_EXTERNAL_CLIENT_TARGETS = Object.freeze([
  "codex-cli",
  "claude-code",
  "claude-app",
]);

export function defaultPostHogMcpUrlForRegion(region = DEFAULT_POSTHOG_MCP_REGION) {
  return normalizePostHogMcpRegion(region) === "eu"
    ? POSTHOG_EU_MCP_URL
    : DEFAULT_POSTHOG_MCP_URL;
}

export function normalizePostHogMcpRegion(value = "") {
  return String(value || "").trim().toLowerCase() === "eu" ? "eu" : "us";
}

export function isValidPostHogMcpToken(value = "") {
  const token = String(value || "").trim();
  return token.startsWith("phx_") || token.startsWith("pha_");
}

// MCP auth: "oauth" (default) delegates authentication to the provider's
// native MCP OAuth (browser login on first use; Claude/Codex cache the token),
// matching posthog.com/docs/model-context-protocol. "api_key" is the explicit
// escape hatch that pins the Bearer header to the stored personal API key —
// the key itself stays useful either way (direct HogQL drilldown collectors).
export function normalizePostHogMcpAuthMode(value = "") {
  return String(value || "").trim().toLowerCase() === "api_key" ? "api_key" : "oauth";
}

export function normalizePostHogMcpSettings(input = {}) {
  const region = normalizePostHogMcpRegion(input.region ?? input.mcpRegion);
  const authMode = normalizePostHogMcpAuthMode(input.authMode ?? input.mcpAuthMode);
  const token = String(input.token ?? input.apiKey ?? input.mcpApiKey ?? "").trim();
  const readonly = parseBoolean(input.readonly ?? input.mcpReadonly, DEFAULT_POSTHOG_MCP_READONLY);
  const features = normalizePostHogMcpFeatures(input.features ?? input.mcpFeatures);
  const mode = normalizePostHogMcpMode(input.mode ?? input.mcpMode);
  const consumer = String(input.consumer ?? input.mcpConsumer ?? DEFAULT_POSTHOG_MCP_CONSUMER).trim()
    || DEFAULT_POSTHOG_MCP_CONSUMER;
  const url = buildPostHogMcpUrl({
    url: input.url ?? input.mcpUrl ?? input.mcpURL,
    region,
    readonly,
    features,
    mode,
    consumer,
    tools: input.tools ?? input.mcpTools,
  });

  return {
    token,
    tokenValid: isValidPostHogMcpToken(token),
    url,
    region,
    readonly,
    features,
    mode,
    consumer,
    authMode,
    // Bearer-header auth only when explicitly requested AND the key is valid;
    // everything else delegates to provider OAuth (URL-only config).
    usesApiKeyAuth: authMode === "api_key" && isValidPostHogMcpToken(token),
  };
}

export function resolvePostHogMcpSettings({
  env = process.env,
  config = null,
  appSupportPath = "",
} = {}) {
  const loadedConfig = config ?? readAdConfig(appSupportPath);
  const posthog = loadedConfig?.posthog && typeof loadedConfig.posthog === "object"
    ? loadedConfig.posthog
    : {};
  const envRegion = env.POSTHOG_MCP_REGION || env.POSTHOG_REGION;
  const configRegion = posthog.mcpRegion || regionFromPostHogHost(posthog.host);
  return normalizePostHogMcpSettings({
    token: env[POSTHOG_MCP_TOKEN_ENV_VAR]
      || env.POSTHOG_API_KEY
      || posthog.mcpApiKey
      || posthog.apiKey,
    authMode: env.POSTHOG_MCP_AUTH_MODE || posthog.mcpAuthMode,
    url: env.POSTHOG_MCP_URL || posthog.mcpUrl || posthog.mcpURL,
    region: envRegion || configRegion,
    readonly: env.POSTHOG_MCP_READONLY ?? posthog.mcpReadonly,
    features: env.POSTHOG_MCP_FEATURES || posthog.mcpFeatures,
    mode: env.POSTHOG_MCP_MODE || posthog.mcpMode,
    consumer: env.POSTHOG_MCP_CONSUMER || posthog.mcpConsumer,
    tools: env.POSTHOG_MCP_TOOLS || posthog.mcpTools,
  });
}

export function buildPostHogMcpUrl({
  url = "",
  region = DEFAULT_POSTHOG_MCP_REGION,
  readonly = DEFAULT_POSTHOG_MCP_READONLY,
  features = DEFAULT_POSTHOG_MCP_FEATURES,
  mode = DEFAULT_POSTHOG_MCP_MODE,
  consumer = DEFAULT_POSTHOG_MCP_CONSUMER,
  tools = "",
} = {}) {
  const fallback = defaultPostHogMcpUrlForRegion(region);
  const raw = String(url || "").trim() || fallback;
  let parsed;
  try {
    parsed = new URL(raw.includes("://") ? raw : `https://${raw}`);
  } catch {
    parsed = new URL(fallback);
  }

  const host = parsed.hostname.replace(/^www\./, "").toLowerCase();
  if (host === "us.posthog.com") {
    parsed.hostname = "mcp.posthog.com";
    parsed.pathname = "/mcp";
  } else if (host === "eu.posthog.com") {
    parsed.hostname = "mcp-eu.posthog.com";
    parsed.pathname = "/mcp";
  } else if (!parsed.pathname || parsed.pathname === "/") {
    parsed.pathname = "/mcp";
  }

  parsed.searchParams.set("readonly", parseBoolean(readonly, DEFAULT_POSTHOG_MCP_READONLY) ? "1" : "0");
  const normalizedMode = normalizePostHogMcpMode(mode);
  if (normalizedMode) parsed.searchParams.set("mode", normalizedMode);
  const normalizedConsumer = String(consumer || "").trim();
  if (normalizedConsumer) parsed.searchParams.set("consumer", normalizedConsumer);
  const normalizedFeatures = normalizePostHogMcpFeatures(features);
  if (normalizedFeatures.length > 0) parsed.searchParams.set("features", normalizedFeatures.join(","));
  const normalizedTools = normalizeList(tools);
  if (normalizedTools.length > 0) parsed.searchParams.set("tools", normalizedTools.join(","));

  return parsed.toString().replace(/%2C/g, ",");
}

export function buildPostHogClaudeMcpConfigFromSources(options = {}) {
  return buildPostHogClaudeMcpConfig(resolvePostHogMcpSettings(options));
}

export function buildPostHogCodexMcpConfigFromSources(options = {}) {
  return buildPostHogCodexMcpConfig(resolvePostHogMcpSettings(options));
}

export function applyPostHogCodexEnvFromSources(env = {}, options = {}) {
  const nextEnv = { ...env };
  const sourceEnv = options.env || env;
  const settings = resolvePostHogMcpSettings({
    ...options,
    env: sourceEnv,
  });
  if (settings.usesApiKeyAuth) {
    nextEnv[POSTHOG_MCP_TOKEN_ENV_VAR] = settings.token;
  }
  return nextEnv;
}

export function buildPostHogClaudeMcpConfig(settings = {}) {
  const normalized = normalizePostHogMcpSettings(settings);
  if (normalized.usesApiKeyAuth) {
    return {
      [POSTHOG_MCP_SERVER_NAME]: {
        type: "http",
        url: normalized.url,
        headers: {
          Authorization: `Bearer ${normalized.token}`,
          Accept: "application/json, text/event-stream",
        },
      },
    };
  }
  // OAuth-first: URL-only config — the provider performs (or reuses) its own
  // PostHog MCP browser login. Works with zero stored keys.
  return {
    [POSTHOG_MCP_SERVER_NAME]: {
      type: "http",
      url: normalized.url,
    },
  };
}

export function buildPostHogCodexMcpConfig(settings = {}) {
  const normalized = normalizePostHogMcpSettings(settings);
  if (normalized.usesApiKeyAuth) {
    return {
      [POSTHOG_MCP_SERVER_NAME]: {
        url: normalized.url,
        bearer_token_env_var: POSTHOG_MCP_TOKEN_ENV_VAR,
      },
    };
  }
  // OAuth-first: Codex supports native MCP OAuth; URL-only config triggers it.
  return {
    [POSTHOG_MCP_SERVER_NAME]: {
      url: normalized.url,
    },
  };
}

export function buildPostHogExternalClaudeMcpConfig(settings = {}) {
  const normalized = normalizePostHogMcpSettings(settings);
  if (!normalized.usesApiKeyAuth) {
    // OAuth-first: mcp-remote runs the browser OAuth flow itself.
    return {
      command: "npx",
      args: ["-y", "mcp-remote@latest", normalized.url],
    };
  }
  return {
    command: "npx",
    args: [
      "-y",
      "mcp-remote@latest",
      normalized.url,
      "--header",
      `Authorization:\${${POSTHOG_AUTH_HEADER_ENV_VAR}}`,
    ],
    env: {
      [POSTHOG_AUTH_HEADER_ENV_VAR]: `Bearer ${normalized.token}`,
    },
  };
}

export async function syncExternalPostHogMcpClients({
  targets = POSTHOG_EXTERNAL_CLIENT_TARGETS,
  homeDir = os.homedir(),
  env = process.env,
  config = null,
  appSupportPath = "",
  dryRun = false,
} = {}) {
  const settings = resolvePostHogMcpSettings({ env, config, appSupportPath });
  if (settings.authMode === "api_key" && !settings.tokenValid) {
    throw new Error("PostHog MCP api_key 모드에는 phx_ 또는 pha_ 키가 필요합니다 (phc_ 프로젝트 키는 인증 불가). 키가 없으면 기본 OAuth 모드를 사용하세요.");
  }

  const normalizedTargets = normalizeExternalTargets(targets);
  const results = [];
  for (const target of normalizedTargets) {
    const filePath = externalConfigPathForTarget(target, homeDir);
    const current = await readTextFile(filePath);
    const next = target === "codex-cli"
      ? mergeCodexTomlPostHogMcpConfig(current, buildPostHogCodexMcpConfig(settings)[POSTHOG_MCP_SERVER_NAME])
      : mergeJsonPostHogMcpConfig(current, buildPostHogExternalClaudeMcpConfig(settings));
    const changed = current !== next;
    const result = {
      target,
      filePath,
      changed,
      dryRun: Boolean(dryRun),
      serverName: POSTHOG_MCP_SERVER_NAME,
    };
    if (!dryRun && changed) {
      result.backupPath = await writeConfigFileAtomically(filePath, next, { backupExisting: Boolean(current) });
    }
    results.push(result);
  }
  return results;
}

export function mergeJsonPostHogMcpConfig(raw = "", posthogConfig = null) {
  if (!posthogConfig) {
    throw new Error("PostHog MCP config is not available.");
  }
  let parsed = {};
  if (String(raw || "").trim()) {
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new Error(`Cannot parse existing JSON MCP config: ${error.message}`);
    }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Existing JSON MCP config must be an object.");
  }
  if (parsed.mcpServers === undefined) {
    parsed.mcpServers = {};
  }
  if (!parsed.mcpServers || typeof parsed.mcpServers !== "object" || Array.isArray(parsed.mcpServers)) {
    throw new Error("Existing JSON MCP config mcpServers field must be an object.");
  }
  parsed.mcpServers[POSTHOG_MCP_SERVER_NAME] = posthogConfig;
  return `${JSON.stringify(parsed, null, 2)}\n`;
}

export function mergeCodexTomlPostHogMcpConfig(raw = "", posthogConfig = null) {
  if (!posthogConfig) {
    throw new Error("PostHog MCP config is not available.");
  }
  const keptLines = [];
  let removingPostHogSection = false;
  for (const line of String(raw || "").split(/\r?\n/)) {
    const header = line.match(/^\s*\[([^\]]+)\]\s*$/);
    if (header) {
      removingPostHogSection = isCodexPostHogMcpSection(header[1]);
    }
    if (!removingPostHogSection) {
      keptLines.push(line);
    }
  }
  while (keptLines.length && keptLines[keptLines.length - 1].trim() === "") {
    keptLines.pop();
  }
  const prefix = keptLines.length ? `${keptLines.join("\n")}\n\n` : "";
  return `${prefix}${formatCodexPostHogMcpToml(posthogConfig)}\n`;
}

function formatCodexPostHogMcpToml(config) {
  return [
    `[mcp_servers.${POSTHOG_MCP_SERVER_NAME}]`,
    `url = ${tomlString(config.url)}`,
    `bearer_token_env_var = ${tomlString(config.bearer_token_env_var)}`,
  ].join("\n");
}

function isCodexPostHogMcpSection(sectionName = "") {
  const parts = String(sectionName || "")
    .split(".")
    .map((part) => unquoteTomlKey(part.trim()))
    .filter(Boolean);
  return parts[0] === "mcp_servers" && parts[1] === POSTHOG_MCP_SERVER_NAME;
}

function externalConfigPathForTarget(target, homeDir) {
  const home = path.resolve(String(homeDir || os.homedir()));
  switch (target) {
    case "codex-cli":
      return path.join(home, ".codex", "config.toml");
    case "claude-code":
      return path.join(home, ".claude", "mcp.json");
    case "claude-app":
      return path.join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json");
    default:
      throw new Error(`Unknown PostHog MCP external target: ${target}`);
  }
}

function normalizeExternalTargets(targets) {
  const rawTargets = Array.isArray(targets)
    ? targets
    : String(targets || "").split(",");
  const normalized = rawTargets
    .map((target) => String(target || "").trim().toLowerCase())
    .filter(Boolean)
    .map((target) => {
      if (target === "codex") return "codex-cli";
      if (target === "claude") return "claude-code";
      if (target === "claude-desktop" || target === "claude-app") return "claude-app";
      return target;
    });
  const unique = [...new Set(normalized.length ? normalized : POSTHOG_EXTERNAL_CLIENT_TARGETS)];
  for (const target of unique) {
    if (!POSTHOG_EXTERNAL_CLIENT_TARGETS.includes(target)) {
      throw new Error(`Unknown PostHog MCP external target: ${target}`);
    }
  }
  return unique;
}

function normalizePostHogMcpFeatures(value) {
  const normalized = normalizeList(value);
  return normalized.length ? normalized : [...DEFAULT_POSTHOG_MCP_FEATURES];
}

function normalizeList(value) {
  if (Array.isArray(value)) {
    return [...new Set(value.map((item) => String(item || "").trim()).filter(Boolean))];
  }
  return [...new Set(
    String(value || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  )];
}

function normalizePostHogMcpMode(value = "") {
  const mode = String(value || DEFAULT_POSTHOG_MCP_MODE).trim().toLowerCase();
  return ["tools", "cli"].includes(mode) ? mode : DEFAULT_POSTHOG_MCP_MODE;
}

function parseBoolean(value, defaultValue) {
  if (value === undefined || value === null || value === "") return Boolean(defaultValue);
  if (typeof value === "boolean") return value;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return Boolean(defaultValue);
}

function regionFromPostHogHost(host = "") {
  const value = String(host || "").trim().toLowerCase();
  if (value.includes("eu.posthog.com") || value.includes("eu.i.posthog.com")) return "eu";
  return DEFAULT_POSTHOG_MCP_REGION;
}

function readAdConfig(appSupportPath = "") {
  if (!appSupportPath) return null;
  try {
    const filePath = path.join(appSupportPath, "ad-config.json");
    if (!fsSync.existsSync(filePath)) return null;
    return JSON.parse(fsSync.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

async function readTextFile(filePath) {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return "";
    throw error;
  }
}

async function writeConfigFileAtomically(filePath, content, { backupExisting = true } = {}) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  let backupPath = null;
  if (backupExisting) {
    backupPath = `${filePath}.agentic30.bak`;
    try {
      await fs.copyFile(filePath, backupPath);
      await fs.chmod(backupPath, 0o600);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      backupPath = null;
    }
  }
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempPath, content, { mode: 0o600 });
  await fs.rename(tempPath, filePath);
  await fs.chmod(filePath, 0o600);
  return backupPath;
}

function tomlString(value = "") {
  return `"${String(value || "").replace(/\\/g, "\\\\").replace(/"/g, "\\\"")}"`;
}

function unquoteTomlKey(value = "") {
  const trimmed = String(value || "").trim();
  if (
    (trimmed.startsWith("\"") && trimmed.endsWith("\""))
    || (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}
