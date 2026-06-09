import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";

export const EXA_MCP_PROVIDERS = Object.freeze(["codex", "claude", "gemini"]);
export const EXA_MCP_TOOLS = Object.freeze([
  "web_search_advanced_exa",
  "web_fetch_exa",
]);
export const EXA_MCP_URL = exaMcpUrlWithTools("https://mcp.exa.ai/mcp");

const PROVIDER_LABELS = Object.freeze({
  codex: "Codex",
  claude: "Claude",
  gemini: "Gemini",
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
    label: "EXA_API_KEY fallback",
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
      const parts = section[1].split(".").map((part) => part.trim()).filter(Boolean);
      current = null;
      if (parts[0] === "mcp_servers" && parts[1]) {
        const serverName = unquoteTomlKey(parts[1]);
        const field = parts[2] ? unquoteTomlKey(parts[2]) : null;
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
  if (typeof config.url === "string" && config.url.trim()) {
    normalized.type = typeof config.type === "string" && config.type.trim()
      ? config.type.trim()
      : "http";
    normalized.url = exaMcpUrlWithTools(config.url.trim());
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
