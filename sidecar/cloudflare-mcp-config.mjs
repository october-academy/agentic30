import fsSync from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const CLOUDFLARE_MCP_SERVER_NAME = "cloudflare-api";
export const CLOUDFLARE_MCP_TOKEN_ENV_VAR = "CLOUDFLARE_MCP_API_TOKEN";
export const CLOUDFLARE_API_TOKEN_ENV_VAR = "CLOUDFLARE_API_TOKEN";
export const CLOUDFLARE_AUTH_HEADER_ENV_VAR = "CLOUDFLARE_AUTH_HEADER";
export const DEFAULT_CLOUDFLARE_MCP_URL = "https://mcp.cloudflare.com/mcp";
export const CLOUDFLARE_EXTERNAL_CLIENT_TARGETS = Object.freeze([
  "codex-cli",
  "claude-code",
  "claude-app",
]);

// MCP auth: "oauth" (default) delegates to the provider's native MCP OAuth
// (browser login on first use — mcp.cloudflare.com supports it natively);
// "api_key" pins the Bearer header to the stored API token. The token stays
// useful either way (GraphQL Analytics drilldown collectors).
export function normalizeCloudflareMcpAuthMode(value = "") {
  return String(value || "").trim().toLowerCase() === "api_key" ? "api_key" : "oauth";
}

export function normalizeCloudflareMcpSettings(input = {}) {
  const token = String(input.token ?? input.apiToken ?? input.mcpApiToken ?? "").trim();
  const codemode = parseBoolean(input.codemode ?? input.mcpCodemode, true);
  const authMode = normalizeCloudflareMcpAuthMode(input.authMode ?? input.mcpAuthMode);
  const url = buildCloudflareMcpUrl({
    url: input.url ?? input.mcpUrl ?? input.mcpURL,
    codemode,
  });
  return {
    token,
    tokenValid: Boolean(token),
    url,
    codemode,
    authMode,
    usesApiKeyAuth: authMode === "api_key" && Boolean(token),
  };
}

export function resolveCloudflareMcpSettings({
  env = process.env,
  config = null,
  appSupportPath = "",
} = {}) {
  const loadedConfig = config ?? readCloudflareConfig(appSupportPath);
  const cloudflare = loadedConfig?.cloudflare && typeof loadedConfig.cloudflare === "object"
    ? loadedConfig.cloudflare
    : {};
  return normalizeCloudflareMcpSettings({
    token: env[CLOUDFLARE_MCP_TOKEN_ENV_VAR]
      || env[CLOUDFLARE_API_TOKEN_ENV_VAR]
      || cloudflare.mcpApiToken
      || cloudflare.apiToken,
    authMode: env.CLOUDFLARE_MCP_AUTH_MODE || cloudflare.mcpAuthMode,
    url: env.CLOUDFLARE_MCP_URL || cloudflare.mcpUrl || cloudflare.mcpURL,
    codemode: env.CLOUDFLARE_MCP_CODEMODE ?? cloudflare.mcpCodemode,
  });
}

export function buildCloudflareMcpUrl({
  url = "",
  codemode = true,
} = {}) {
  const raw = String(url || "").trim() || DEFAULT_CLOUDFLARE_MCP_URL;
  let parsed;
  try {
    parsed = new URL(raw.includes("://") ? raw : `https://${raw}`);
  } catch {
    parsed = new URL(DEFAULT_CLOUDFLARE_MCP_URL);
  }

  if (!parsed.pathname || parsed.pathname === "/") {
    parsed.pathname = "/mcp";
  }
  if (!parseBoolean(codemode, true)) {
    parsed.searchParams.set("codemode", "false");
  } else {
    parsed.searchParams.delete("codemode");
  }
  return parsed.toString();
}

export function buildCloudflareClaudeMcpConfigFromSources(options = {}) {
  return buildCloudflareClaudeMcpConfig(resolveCloudflareMcpSettings(options));
}

export function buildCloudflareCodexMcpConfigFromSources(options = {}) {
  return buildCloudflareCodexMcpConfig(resolveCloudflareMcpSettings(options));
}

export function applyCloudflareCodexEnvFromSources(env = {}, options = {}) {
  const nextEnv = { ...env };
  const sourceEnv = options.env || env;
  const settings = resolveCloudflareMcpSettings({
    ...options,
    env: sourceEnv,
  });
  if (settings.usesApiKeyAuth) {
    nextEnv[CLOUDFLARE_MCP_TOKEN_ENV_VAR] = settings.token;
  }
  return nextEnv;
}

export function buildCloudflareClaudeMcpConfig(settings = {}) {
  const normalized = normalizeCloudflareMcpSettings(settings);
  if (normalized.usesApiKeyAuth) {
    return {
      [CLOUDFLARE_MCP_SERVER_NAME]: {
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
  // Cloudflare MCP browser login. Works with zero stored tokens.
  return {
    [CLOUDFLARE_MCP_SERVER_NAME]: {
      type: "http",
      url: normalized.url,
    },
  };
}

export function buildCloudflareCodexMcpConfig(settings = {}) {
  const normalized = normalizeCloudflareMcpSettings(settings);
  if (normalized.usesApiKeyAuth) {
    return {
      [CLOUDFLARE_MCP_SERVER_NAME]: {
        url: normalized.url,
        bearer_token_env_var: CLOUDFLARE_MCP_TOKEN_ENV_VAR,
      },
    };
  }
  // OAuth-first: Codex native MCP OAuth handles the login.
  return {
    [CLOUDFLARE_MCP_SERVER_NAME]: {
      url: normalized.url,
      oauth_resource: DEFAULT_CLOUDFLARE_MCP_URL,
    },
  };
}

export function buildCloudflareExternalClaudeMcpConfig(settings = {}) {
  const normalized = normalizeCloudflareMcpSettings(settings);
  const base = {
    command: "npx",
    args: [
      "-y",
      "mcp-remote@latest",
      normalized.url,
    ],
  };
  if (!normalized.usesApiKeyAuth) return base;
  return {
    ...base,
    args: [
      ...base.args,
      "--header",
      `Authorization:\${${CLOUDFLARE_AUTH_HEADER_ENV_VAR}}`,
    ],
    env: {
      [CLOUDFLARE_AUTH_HEADER_ENV_VAR]: `Bearer ${normalized.token}`,
    },
  };
}

export function buildCloudflareExternalCodexMcpConfig(settings = {}) {
  const normalized = normalizeCloudflareMcpSettings(settings);
  if (normalized.usesApiKeyAuth) {
    return {
      url: normalized.url,
      bearer_token_env_var: CLOUDFLARE_MCP_TOKEN_ENV_VAR,
    };
  }
  return {
    url: normalized.url,
    oauth_resource: DEFAULT_CLOUDFLARE_MCP_URL,
  };
}

export async function syncExternalCloudflareMcpClients({
  targets = CLOUDFLARE_EXTERNAL_CLIENT_TARGETS,
  homeDir = os.homedir(),
  env = process.env,
  config = null,
  appSupportPath = "",
  dryRun = false,
} = {}) {
  const settings = resolveCloudflareMcpSettings({ env, config, appSupportPath });
  const normalizedTargets = normalizeExternalTargets(targets);
  const results = [];
  for (const target of normalizedTargets) {
    const filePath = externalConfigPathForTarget(target, homeDir);
    const current = await readTextFile(filePath);
    const next = target === "codex-cli"
      ? mergeCodexTomlCloudflareMcpConfig(current, buildCloudflareExternalCodexMcpConfig(settings))
      : mergeJsonCloudflareMcpConfig(current, buildCloudflareExternalClaudeMcpConfig(settings));
    const changed = current !== next;
    const result = {
      target,
      filePath,
      changed,
      dryRun: Boolean(dryRun),
      serverName: CLOUDFLARE_MCP_SERVER_NAME,
      authMode: settings.usesApiKeyAuth ? "api_token" : "oauth",
    };
    if (!dryRun && changed) {
      result.backupPath = await writeConfigFileAtomically(filePath, next, { backupExisting: Boolean(current) });
    }
    results.push(result);
  }
  return results;
}

export function mergeJsonCloudflareMcpConfig(raw = "", cloudflareConfig = null) {
  if (!cloudflareConfig) {
    throw new Error("Cloudflare MCP config is not available.");
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
  parsed.mcpServers[CLOUDFLARE_MCP_SERVER_NAME] = cloudflareConfig;
  return `${JSON.stringify(parsed, null, 2)}\n`;
}

export function mergeCodexTomlCloudflareMcpConfig(raw = "", cloudflareConfig = null) {
  if (!cloudflareConfig) {
    throw new Error("Cloudflare MCP config is not available.");
  }
  const keptLines = [];
  let removingCloudflareSection = false;
  for (const line of String(raw || "").split(/\r?\n/)) {
    const header = line.match(/^\s*\[([^\]]+)\]\s*$/);
    if (header) {
      removingCloudflareSection = isCodexCloudflareMcpSection(header[1]);
    }
    if (!removingCloudflareSection) {
      keptLines.push(line);
    }
  }
  while (keptLines.length && keptLines[keptLines.length - 1].trim() === "") {
    keptLines.pop();
  }
  const prefix = keptLines.length ? `${keptLines.join("\n")}\n\n` : "";
  return `${prefix}${formatCodexCloudflareMcpToml(cloudflareConfig)}\n`;
}

function formatCodexCloudflareMcpToml(config) {
  const lines = [
    `[mcp_servers.${tomlBareOrQuotedKey(CLOUDFLARE_MCP_SERVER_NAME)}]`,
    `url = ${tomlString(config.url)}`,
  ];
  if (config.oauth_resource) {
    lines.push(`oauth_resource = ${tomlString(config.oauth_resource)}`);
  }
  if (config.bearer_token_env_var) {
    lines.push(`bearer_token_env_var = ${tomlString(config.bearer_token_env_var)}`);
  }
  return lines.join("\n");
}

function isCodexCloudflareMcpSection(sectionName = "") {
  const parts = String(sectionName || "")
    .split(".")
    .map((part) => unquoteTomlKey(part.trim()))
    .filter(Boolean);
  return parts[0] === "mcp_servers" && parts[1] === CLOUDFLARE_MCP_SERVER_NAME;
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
      throw new Error(`Unknown Cloudflare MCP external target: ${target}`);
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
  const unique = [...new Set(normalized.length ? normalized : CLOUDFLARE_EXTERNAL_CLIENT_TARGETS)];
  for (const target of unique) {
    if (!CLOUDFLARE_EXTERNAL_CLIENT_TARGETS.includes(target)) {
      throw new Error(`Unknown Cloudflare MCP external target: ${target}`);
    }
  }
  return unique;
}

function readCloudflareConfig(appSupportPath = "") {
  if (!appSupportPath) return null;
  try {
    const directPath = path.join(appSupportPath, "cloudflare-config.json");
    if (fsSync.existsSync(directPath)) {
      return JSON.parse(fsSync.readFileSync(directPath, "utf8"));
    }
    const adConfigPath = path.join(appSupportPath, "ad-config.json");
    if (fsSync.existsSync(adConfigPath)) {
      return JSON.parse(fsSync.readFileSync(adConfigPath, "utf8"));
    }
  } catch {
    return null;
  }
  return null;
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

function parseBoolean(value, defaultValue) {
  if (value === undefined || value === null || value === "") return Boolean(defaultValue);
  if (typeof value === "boolean") return value;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return Boolean(defaultValue);
}

function tomlString(value = "") {
  return `"${String(value || "").replace(/\\/g, "\\\\").replace(/"/g, "\\\"")}"`;
}

function tomlBareOrQuotedKey(value = "") {
  return /^[A-Za-z_][A-Za-z0-9_-]*$/.test(value) ? value : tomlString(value);
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
