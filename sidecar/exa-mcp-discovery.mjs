import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client as McpClient } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

export const EXA_MCP_PROVIDERS = Object.freeze(["codex", "claude", "gemini", "cursor"]);
export const EXA_MCP_BASE_URL = "https://mcp.exa.ai/mcp";
export const EXA_MCP_TOOLS = Object.freeze([
  "web_search_exa",
  "web_search_advanced_exa",
  "web_fetch_exa",
]);
export const EXA_MCP_URL = exaMcpUrlWithTools(EXA_MCP_BASE_URL);
export const EXA_MCP_VALIDATION_TOOL = "web_search_exa";

const PROVIDER_LABELS = Object.freeze({
  codex: "Codex",
  claude: "Claude",
  gemini: "Gemini",
  cursor: "Cursor",
});

export function discoverExaMcpRoutes({
  homeDir = os.homedir(),
  fsImpl = fsSync,
} = {}) {
  const roots = buildProviderConfigSources(homeDir);
  const routes = [];
  for (const source of roots) {
    const entries = source.kind === "toml"
      ? readTomlMcpServers(source.filePath, { fsImpl })
      : readJsonMcpServers(source.filePath, { fsImpl });
    for (const entry of entries) {
      if (!isExaMcpServer(entry.name, entry.config)) continue;
      const mcpConfig = normalizeMcpServerConfig(entry.config);
      if (!mcpConfig) continue;
      routes.push({
        provider: source.provider,
        source: "provider_mcp",
        label: `${PROVIDER_LABELS[source.provider]} Exa MCP`,
        serverName: entry.name,
        configPath: source.filePath,
        mcpConfig,
      });
    }
  }
  return dedupeRoutes(routes);
}

export function orderExaMcpRoutes(routes = [], { preferredProvider = "" } = {}) {
  const providerOrder = orderedProviders(preferredProvider);
  return [...routes].sort((a, b) => {
    const aIndex = providerOrder.indexOf(a.provider);
    const bIndex = providerOrder.indexOf(b.provider);
    if (aIndex !== bIndex) return aIndex - bIndex;
    return String(a.configPath || "").localeCompare(String(b.configPath || ""));
  });
}

export function resolveExaResearchRoutes({
  discoveredRoutes = [],
  apiKey = "",
  preferredProvider = "",
} = {}) {
  const routes = [];
  const apiKeyRoute = buildExaApiKeyRoute({
    apiKey,
    provider: normalizeProvider(preferredProvider) || "codex",
  });
  if (apiKeyRoute) routes.push(apiKeyRoute);
  routes.push(...orderExaMcpRoutes(discoveredRoutes, { preferredProvider }));
  return dedupeRoutes(routes);
}

export function buildExaApiKeyRoute({
  apiKey = "",
  provider = "codex",
} = {}) {
  const key = String(apiKey || "").trim();
  if (!key) return null;
  const normalizedProvider = normalizeProvider(provider) || "codex";
  return {
    provider: normalizedProvider,
    source: "api_key",
    label: "Exa Search (EXA_API_KEY)",
    serverName: "exa",
    configPath: null,
    mcpConfig: {
      type: "http",
      url: EXA_MCP_URL,
      headers: {
        "x-api-key": key,
      },
    },
  };
}

export function redactExaResearchRoute(route = {}) {
  if (!route || typeof route !== "object") return null;
  const config = route.mcpConfig && typeof route.mcpConfig === "object" ? route.mcpConfig : {};
  return {
    provider: normalizeProvider(route.provider) || "",
    source: String(route.source || ""),
    label: String(route.label || ""),
    serverName: String(route.serverName || ""),
    configPath: route.configPath ? String(route.configPath) : null,
    transport: config.url ? "http" : config.command ? "stdio" : "",
    urlHost: hostFromUrl(config.url),
    command: config.command ? path.basename(String(config.command)) : "",
    hasHeaders: Boolean(config.headers && Object.keys(config.headers).length),
    hasEnv: Boolean(config.env && Object.keys(config.env).length),
  };
}

export function mergeCodexTomlExaMcpConfig(rawToml = "", { apiKey = "" } = {}) {
  const key = String(apiKey || "").trim();
  if (!key) {
    throw new Error("EXA_API_KEY is required to write Codex Exa MCP config.");
  }
  const original = normalizeTomlText(rawToml);
  const withoutExa = stripCodexExaTomlSections(original).trimEnd();
  const exaSection = renderCodexExaMcpTomlSection(key);
  const content = `${withoutExa ? `${withoutExa}\n\n` : ""}${exaSection}`;
  return {
    content,
    changed: content !== original,
  };
}

export function mergeJsonExaMcpConfig(rawJson = "", { apiKey = "", provider = "claude" } = {}) {
  const key = String(apiKey || "").trim();
  if (!key) {
    throw new Error("EXA_API_KEY is required to write Exa MCP config.");
  }
  const normalizedProvider = normalizeExaMcpProvider(provider);
  if (!normalizedProvider || normalizedProvider === "codex") {
    throw new Error(`Unsupported JSON Exa MCP provider: ${provider || ""}`);
  }
  const original = normalizeJsonText(rawJson);
  const parsed = parseJsonConfig(original, normalizedProvider);
  const next = cloneJsonConfig(parsed);
  if (!next.mcpServers || typeof next.mcpServers !== "object" || Array.isArray(next.mcpServers)) {
    next.mcpServers = {};
  }
  next.mcpServers.exa = buildJsonProviderExaMcpServerConfig(normalizedProvider, key);
  const content = `${JSON.stringify(next, null, 2)}\n`;
  return {
    content,
    changed: content !== original,
  };
}

export function assureExaMcpConfig({
  homeDir = os.homedir(),
  apiKey = "",
  provider = "codex",
  fsImpl = fsSync,
  now = new Date(),
} = {}) {
  const normalizedProvider = normalizeExaMcpProvider(provider) || "codex";
  const configPath = providerConfigPath(normalizedProvider, homeDir);
  const label = PROVIDER_LABELS[normalizedProvider] || normalizedProvider;
  const key = String(apiKey || "").trim();
  if (!key) {
    return exaMcpConfigResult({
      state: "missing",
      detail: `Exa API key is required to write ${label} Exa MCP config.`,
      changed: false,
      provider: normalizedProvider,
      configPath,
    });
  }

  let tmpPath = "";
  try {
    const configDir = path.dirname(configPath);
    fsImpl.mkdirSync(configDir, { recursive: true });
    const existed = fileExists(configPath, fsImpl);
    const original = existed ? fsImpl.readFileSync(configPath, "utf8") : "";
    const merged = normalizedProvider === "codex"
      ? mergeCodexTomlExaMcpConfig(original, { apiKey: key })
      : mergeJsonExaMcpConfig(original, { apiKey: key, provider: normalizedProvider });
    const route = redactExaResearchRoute(buildExaApiKeyRoute({ apiKey: key, provider: normalizedProvider }));

    if (!merged.changed) {
      return exaMcpConfigResult({
        state: "ready",
        detail: `${label} Exa MCP config is already up to date.`,
        changed: false,
        provider: normalizedProvider,
        configPath,
        route,
      });
    }

    const backupPath = existed ? uniqueBackupPath(configPath, { fsImpl, now }) : null;
    if (backupPath) {
      fsImpl.copyFileSync(configPath, backupPath);
    }

    const mode = existed ? (fsImpl.statSync(configPath).mode & 0o777) : 0o600;
    tmpPath = path.join(configDir, `.${path.basename(configPath)}.agentic30-exa-${process.pid}-${Date.now()}.tmp`);
    fsImpl.writeFileSync(tmpPath, merged.content, { encoding: "utf8", mode });
    fsImpl.renameSync(tmpPath, configPath);
    tmpPath = "";

    return exaMcpConfigResult({
      state: "ready",
      detail: `${label} Exa MCP config saved.`,
      changed: true,
      provider: normalizedProvider,
      configPath,
      backupPath,
      route,
    });
  } catch (error) {
    if (tmpPath) {
      try {
        fsImpl.unlinkSync(tmpPath);
      } catch {
        // Best-effort cleanup after a failed atomic write.
      }
    }
    return exaMcpConfigResult({
      state: "failed",
      detail: `${label} Exa MCP config write failed: ${String(error?.message || error)}`,
      changed: false,
      provider: normalizedProvider,
      configPath,
    });
  }
}

export function assureCodexExaMcpConfig(options = {}) {
  return assureExaMcpConfig({
    ...options,
    provider: "codex",
  });
}

export async function validateExaMcpApiKey({
  apiKey = "",
  clientFactory = defaultExaMcpValidationClientFactory,
  now = new Date(),
  provider = "codex",
  timeoutMs = 10_000,
} = {}) {
  const key = String(apiKey || "").trim();
  const normalizedProvider = normalizeProvider(provider) || "codex";
  const checkedAt = (now instanceof Date ? now : new Date(now)).toISOString();
  if (!key) {
    return exaMcpConnectResult({
      state: "missing",
      detail: "Exa API key is required.",
      checkedAt,
      validationTool: EXA_MCP_VALIDATION_TOOL,
    });
  }

  let client = null;
  try {
    client = await withTimeout(
      Promise.resolve(clientFactory({ apiKey: key, url: EXA_MCP_URL, toolName: EXA_MCP_VALIDATION_TOOL })),
      timeoutMs,
      "Exa MCP validation client connection timed out.",
    );
    const result = await withTimeout(
      Promise.resolve(client.callTool({
        name: EXA_MCP_VALIDATION_TOOL,
        arguments: {
          query: "Agentic30 Exa MCP validation",
        },
      })),
      timeoutMs,
      "Exa MCP validation tool call timed out.",
    );
    if (result?.isError === true) {
      throw new Error(extractMcpToolErrorText(result) || "Exa MCP tool returned an error.");
    }
    return exaMcpConnectResult({
      state: "ready",
      detail: "Exa MCP web_search_exa validation succeeded.",
      checkedAt,
      validationTool: EXA_MCP_VALIDATION_TOOL,
      route: redactExaResearchRoute(buildExaApiKeyRoute({ apiKey: key, provider: normalizedProvider })),
    });
  } catch (error) {
    return exaMcpConnectResult({
      state: "failed",
      detail: `Exa MCP validation failed: ${redactSecretInText(String(error?.message || error), key)}`,
      checkedAt,
      validationTool: EXA_MCP_VALIDATION_TOOL,
    });
  } finally {
    if (client && typeof client.close === "function") {
      try {
        await client.close();
      } catch {
        // Best-effort close after validation.
      }
    }
  }
}

export async function connectExaMcpWithApiKey({
  homeDir = os.homedir(),
  apiKey = "",
  provider = "codex",
  fsImpl = fsSync,
  now = new Date(),
  clientFactory,
  timeoutMs = 10_000,
} = {}) {
  const normalizedProvider = normalizeExaMcpProvider(provider) || "codex";
  const checkedAt = (now instanceof Date ? now : new Date(now)).toISOString();
  const validation = await validateExaMcpApiKey({
    apiKey,
    clientFactory,
    now,
    provider: normalizedProvider,
    timeoutMs,
  });
  if (validation.state !== "ready") {
    return exaMcpConnectResult({
      ...validation,
      provider: normalizedProvider,
      changed: false,
      checkedAt,
    });
  }

  const config = assureExaMcpConfig({
    homeDir,
    apiKey,
    provider: normalizedProvider,
    fsImpl,
    now,
  });
  if (config.state !== "ready") {
    return exaMcpConnectResult({
      state: "failed",
      detail: config.detail,
      provider: normalizedProvider,
      changed: false,
      configPath: config.configPath,
      backupPath: config.backupPath,
      route: config.route,
      validationTool: validation.validationTool,
      checkedAt,
    });
  }

  return exaMcpConnectResult({
    state: "ready",
    detail: config.detail,
    provider: normalizedProvider,
    changed: config.changed,
    configPath: config.configPath,
    backupPath: config.backupPath,
    route: config.route,
    validationTool: validation.validationTool,
    checkedAt,
  });
}

export function normalizeExaMcpProvider(value = "") {
  return normalizeProvider(value);
}

function buildProviderConfigSources(homeDir) {
  const home = path.resolve(String(homeDir || os.homedir()));
  return [
    {
      provider: "codex",
      kind: "toml",
      filePath: path.join(home, ".codex", "config.toml"),
    },
    {
      provider: "claude",
      kind: "json",
      filePath: path.join(home, ".claude", "mcp.json"),
    },
    {
      provider: "claude",
      kind: "json",
      filePath: path.join(home, ".claude", ".mcp.json"),
    },
    {
      provider: "claude",
      kind: "json",
      filePath: path.join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json"),
    },
    {
      provider: "claude",
      kind: "json",
      filePath: path.join(home, "Library", "Application Support", "Claude-3p", "claude_desktop_config.json"),
    },
    {
      provider: "gemini",
      kind: "json",
      filePath: path.join(home, ".gemini", "settings.json"),
    },
    {
      provider: "gemini",
      kind: "json",
      filePath: path.join(home, ".gemini", "config", "mcp_config.json"),
    },
    {
      provider: "cursor",
      kind: "json",
      filePath: path.join(home, ".cursor", "mcp.json"),
    },
  ];
}

function readJsonMcpServers(filePath, { fsImpl = fsSync } = {}) {
  const raw = readTextFile(filePath, fsImpl);
  if (!raw) return [];
  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  return collectMcpServerEntries(parsed);
}

function collectMcpServerEntries(value, { depth = 0, seen = new Set() } = {}) {
  if (!value || typeof value !== "object" || depth > 4 || seen.has(value)) return [];
  seen.add(value);
  const entries = [];
  for (const key of ["mcpServers", "mcp_servers", "servers", "context_servers"]) {
    if (value[key] && typeof value[key] === "object" && !Array.isArray(value[key])) {
      for (const [name, config] of Object.entries(value[key])) {
        entries.push({ name, config });
      }
    }
  }
  for (const child of Object.values(value)) {
    if (child && typeof child === "object") {
      entries.push(...collectMcpServerEntries(child, { depth: depth + 1, seen }));
    }
  }
  return entries;
}

function readTomlMcpServers(filePath, { fsImpl = fsSync } = {}) {
  const raw = readTextFile(filePath, fsImpl);
  if (!raw) return [];
  const servers = new Map();
  let current = null;
  for (const rawLine of raw.split(/\r?\n/)) {
    const line = stripTomlComment(rawLine).trim();
    if (!line) continue;
    const section = line.match(/^\[([^\]]+)\]$/);
    if (section) {
      const parts = splitTomlPath(section[1]);
      current = null;
      if (parts[0] === "mcp_servers" && parts[1]) {
        const serverName = parts[1];
        const field = parts[2] || null;
        if (!servers.has(serverName)) servers.set(serverName, {});
        current = { serverName, field };
      }
      continue;
    }
    if (!current) continue;
    const assignment = line.match(/^((?:"[^"]+")|(?:'[^']+')|[A-Za-z0-9_.-]+)\s*=\s*(.+)$/);
    if (!assignment) continue;
    const key = unquoteTomlKey(assignment[1]);
    const value = parseTomlValue(assignment[2]);
    const config = servers.get(current.serverName);
    if (current.field) {
      if (!config[current.field] || typeof config[current.field] !== "object") {
        config[current.field] = {};
      }
      config[current.field][key] = value;
    } else {
      config[key] = value;
    }
  }
  return [...servers.entries()].map(([name, config]) => ({ name, config }));
}

function normalizeMcpServerConfig(config = {}) {
  if (!config || typeof config !== "object" || Array.isArray(config)) return null;
  const normalized = {};
  const url = firstNonEmptyString(config.url, config.httpUrl, config.serverUrl);
  if (url) {
    normalized.type = typeof config.type === "string" && config.type.trim()
      ? config.type.trim()
      : "http";
    normalized.url = exaMcpUrlWithTools(url);
  }
  if (typeof config.command === "string" && config.command.trim()) {
    if (typeof config.type === "string" && config.type.trim()) {
      normalized.type = config.type.trim();
    }
    normalized.command = config.command.trim();
  }
  if (Array.isArray(config.args)) {
    normalized.args = config.args.map((arg) => String(arg)).filter(Boolean);
  }
  const headers = stringMap(config.headers);
  if (Object.keys(headers).length) normalized.headers = headers;
  const env = stringMap(config.env);
  if (Object.keys(env).length) normalized.env = env;
  const bearerTokenEnvVar = firstNonEmptyString(config.bearer_token_env_var, config.bearerTokenEnvVar);
  if (bearerTokenEnvVar) normalized.bearer_token_env_var = bearerTokenEnvVar;
  const apiKeyEnvVar = firstNonEmptyString(config.api_key_env_var, config.apiKeyEnvVar);
  if (apiKeyEnvVar) normalized.api_key_env_var = apiKeyEnvVar;
  if (!normalized.url && !normalized.command) return null;
  return normalized;
}

function stringMap(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key, entry]) => key && entry !== undefined && entry !== null)
      .map(([key, entry]) => [String(key), String(entry)]),
  );
}

function isExaMcpServer(name = "", config = {}) {
  const haystack = [
    name,
    config?.url,
    config?.httpUrl,
    config?.serverUrl,
    config?.command,
    ...(Array.isArray(config?.args) ? config.args : []),
  ].join(" ").toLowerCase();
  if (String(name || "").trim().toLowerCase() === "exa") return true;
  if (haystack.includes("mcp.exa.ai")) return true;
  return /\bexa\b/.test(haystack) && haystack.includes("mcp");
}

function dedupeRoutes(routes) {
  const seen = new Set();
  const result = [];
  for (const route of routes) {
    const key = [
      route.provider,
      route.serverName,
      route.mcpConfig?.url || "",
      route.mcpConfig?.command || "",
      (route.mcpConfig?.args || []).join("\u0000"),
    ].join("\u0001");
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(route);
  }
  return result;
}

function codexConfigPath(homeDir = os.homedir()) {
  const home = path.resolve(String(homeDir || os.homedir()));
  return path.join(home, ".codex", "config.toml");
}

function providerConfigPath(provider = "codex", homeDir = os.homedir()) {
  const home = path.resolve(String(homeDir || os.homedir()));
  switch (normalizeProvider(provider) || "codex") {
    case "claude":
      return path.join(home, ".claude", "mcp.json");
    case "gemini":
      return path.join(home, ".gemini", "settings.json");
    case "cursor":
      return path.join(home, ".cursor", "mcp.json");
    case "codex":
    default:
      return codexConfigPath(home);
  }
}

function renderCodexExaMcpTomlSection(apiKey) {
  return [
    "[mcp_servers.exa]",
    `url = ${tomlString(EXA_MCP_URL)}`,
    "",
    "[mcp_servers.exa.headers]",
    `"x-api-key" = ${tomlString(apiKey)}`,
    "",
  ].join("\n");
}

function buildJsonProviderExaMcpServerConfig(provider, apiKey) {
  const normalizedProvider = normalizeProvider(provider);
  const base = {
    headers: {
      "x-api-key": apiKey,
    },
  };
  if (normalizedProvider === "gemini") {
    return {
      type: "http",
      httpUrl: EXA_MCP_URL,
      ...base,
    };
  }
  if (normalizedProvider === "cursor") {
    return {
      url: EXA_MCP_URL,
      ...base,
    };
  }
  return {
    type: "http",
    url: EXA_MCP_URL,
    ...base,
  };
}

function exaMcpConfigResult({
  state = "missing",
  detail = "",
  changed = false,
  provider = "",
  configPath = "",
  backupPath = null,
  route = null,
} = {}) {
  return {
    state,
    detail: String(detail || "").slice(0, 240),
    changed: Boolean(changed),
    provider: normalizeProvider(provider) || "",
    configPath: configPath ? String(configPath) : "",
    backupPath: backupPath ? String(backupPath) : null,
    route: route || null,
  };
}

function exaMcpConnectResult({
  state = "missing",
  detail = "",
  provider = "",
  changed = false,
  configPath = "",
  backupPath = null,
  route = null,
  validationTool = EXA_MCP_VALIDATION_TOOL,
  checkedAt = new Date().toISOString(),
} = {}) {
  return {
    state,
    detail: String(detail || "").slice(0, 240),
    provider: normalizeProvider(provider) || "",
    changed: Boolean(changed),
    configPath: configPath ? String(configPath) : "",
    backupPath: backupPath ? String(backupPath) : null,
    route: route || null,
    validationTool: String(validationTool || EXA_MCP_VALIDATION_TOOL),
    checkedAt: String(checkedAt || ""),
  };
}

function stripCodexExaTomlSections(rawToml = "") {
  const lines = normalizeTomlText(rawToml).split("\n");
  const kept = [];
  let skipping = false;
  for (const line of lines) {
    const section = tomlSectionName(line);
    if (section) {
      skipping = isCodexExaTomlSection(section);
      if (skipping) continue;
    }
    if (skipping) continue;
    kept.push(line);
  }
  while (kept.length && !kept[kept.length - 1].trim()) {
    kept.pop();
  }
  return kept.join("\n");
}

function isCodexExaTomlSection(sectionName = "") {
  const parts = splitTomlPath(sectionName);
  return parts[0] === "mcp_servers" && parts[1] === "exa";
}

function tomlSectionName(line = "") {
  const trimmed = stripTomlComment(line).trim();
  const match = trimmed.match(/^\[([^\]]+)\]$/);
  return match ? match[1] : "";
}

function splitTomlPath(value = "") {
  const parts = [];
  let current = "";
  let inQuote = false;
  let quote = "";
  const source = String(value || "");
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if ((char === "\"" || char === "'") && source[index - 1] !== "\\") {
      if (!inQuote) {
        inQuote = true;
        quote = char;
      } else if (quote === char) {
        inQuote = false;
        quote = "";
      }
    }
    if (char === "." && !inQuote) {
      parts.push(unquoteTomlKey(current.trim()));
      current = "";
      continue;
    }
    current += char;
  }
  if (current.trim()) parts.push(unquoteTomlKey(current.trim()));
  return parts;
}

function normalizeTomlText(rawToml = "") {
  return String(rawToml || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function normalizeJsonText(rawJson = "") {
  return String(rawJson || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function parseJsonConfig(rawJson = "", provider = "") {
  const text = normalizeJsonText(rawJson);
  if (!text.trim()) return {};
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`Cannot parse existing ${PROVIDER_LABELS[provider] || provider} MCP config: ${String(error?.message || error)}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Existing ${PROVIDER_LABELS[provider] || provider} MCP config must be a JSON object.`);
  }
  return parsed;
}

function cloneJsonConfig(value = {}) {
  return JSON.parse(JSON.stringify(value));
}

function tomlString(value = "") {
  return JSON.stringify(String(value || ""));
}

function firstNonEmptyString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function fileExists(filePath, fsImpl) {
  try {
    return fsImpl.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function uniqueBackupPath(configPath, { fsImpl = fsSync, now = new Date() } = {}) {
  const stamp = safeTimestamp(now);
  let candidate = `${configPath}.agentic30-exa-backup-${stamp}`;
  let counter = 1;
  while (fileExists(candidate, fsImpl)) {
    counter += 1;
    candidate = `${configPath}.agentic30-exa-backup-${stamp}-${counter}`;
  }
  return candidate;
}

function safeTimestamp(now = new Date()) {
  const date = now instanceof Date ? now : new Date(now);
  const value = Number.isNaN(date.valueOf()) ? new Date() : date;
  return value.toISOString().replace(/[:.]/g, "-");
}

async function defaultExaMcpValidationClientFactory({ apiKey = "", url = EXA_MCP_URL } = {}) {
  const client = new McpClient({
    name: "agentic30-exa-validation",
    version: "1.0.0",
  });
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: {
      headers: {
        "x-api-key": String(apiKey || ""),
      },
    },
  });
  await client.connect(transport);
  return {
    callTool: (request) => client.callTool(request),
    close: async () => {
      await client.close();
      if (typeof transport.close === "function") {
        await transport.close();
      }
    },
  };
}

function withTimeout(promise, timeoutMs, message) {
  const ms = Number.isFinite(Number(timeoutMs)) ? Number(timeoutMs) : 10_000;
  let timer = null;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms);
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function extractMcpToolErrorText(result = {}) {
  if (typeof result?.content === "string") return result.content;
  if (Array.isArray(result?.content)) {
    return result.content
      .map((entry) => {
        if (typeof entry === "string") return entry;
        if (entry && typeof entry === "object") return entry.text || entry.message || "";
        return "";
      })
      .filter(Boolean)
      .join(" ");
  }
  return "";
}

function redactSecretInText(text = "", secret = "") {
  const value = String(text || "");
  const key = String(secret || "");
  if (!key) return value;
  return value.split(key).join("[redacted]");
}

function orderedProviders(preferredProvider = "") {
  const preferred = normalizeProvider(preferredProvider);
  return [
    ...(preferred ? [preferred] : []),
    ...EXA_MCP_PROVIDERS.filter((provider) => provider !== preferred),
  ];
}

function normalizeProvider(value = "") {
  const provider = String(value || "").trim().toLowerCase();
  return EXA_MCP_PROVIDERS.includes(provider) ? provider : "";
}

function readTextFile(filePath, fsImpl) {
  try {
    return fsImpl.readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

function stripTomlComment(line) {
  let inQuote = false;
  let quote = "";
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if ((char === "\"" || char === "'") && line[index - 1] !== "\\") {
      if (!inQuote) {
        inQuote = true;
        quote = char;
      } else if (quote === char) {
        inQuote = false;
        quote = "";
      }
    }
    if (char === "#" && !inQuote) return line.slice(0, index);
  }
  return line;
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

function parseTomlValue(value = "") {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";
  if (
    (trimmed.startsWith("\"") && trimmed.endsWith("\""))
    || (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return parseTomlArray(trimmed);
  }
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  return trimmed;
}

function parseTomlArray(value) {
  const items = [];
  let current = "";
  let inQuote = false;
  let quote = "";
  for (let index = 1; index < value.length - 1; index += 1) {
    const char = value[index];
    if ((char === "\"" || char === "'") && value[index - 1] !== "\\") {
      if (!inQuote) {
        inQuote = true;
        quote = char;
        continue;
      }
      if (quote === char) {
        inQuote = false;
        quote = "";
        continue;
      }
    }
    if (char === "," && !inQuote) {
      const item = current.trim();
      if (item) items.push(parseTomlValue(item));
      current = "";
      continue;
    }
    current += char;
  }
  const tail = current.trim();
  if (tail) items.push(parseTomlValue(tail));
  return items.map((item) => String(item));
}

function hostFromUrl(rawUrl = "") {
  try {
    return rawUrl ? new URL(rawUrl).host : "";
  } catch {
    return "";
  }
}

function exaMcpUrlWithTools(rawUrl = "") {
  try {
    const parsed = new URL(String(rawUrl || ""));
    if (parsed.hostname.replace(/^www\./, "").toLowerCase() !== "mcp.exa.ai") return String(rawUrl || "");
    if (parsed.pathname.replace(/\/+$/, "") !== "/mcp") return String(rawUrl || "");
    const existingTools = (parsed.searchParams.get("tools") || "")
      .split(",")
      .map((tool) => tool.trim())
      .filter(Boolean);
    const tools = [...new Set([...existingTools, ...EXA_MCP_TOOLS])];
    parsed.searchParams.set("tools", tools.join(","));
    return parsed.toString().replace(/%2C/g, ",");
  } catch {
    return String(rawUrl || "");
  }
}
