export const VERCEL_MCP_SERVER_NAME = "vercel";
export const DEFAULT_VERCEL_MCP_URL = "https://mcp.vercel.com";

export function normalizeVercelMcpSettings(input = {}) {
  const raw = String(input.url ?? input.mcpUrl ?? input.mcpURL ?? "").trim() || DEFAULT_VERCEL_MCP_URL;
  let url = DEFAULT_VERCEL_MCP_URL;
  try {
    const parsed = new URL(raw.includes("://") ? raw : `https://${raw}`);
    url = parsed.toString().replace(/\/$/, "");
  } catch {
    url = DEFAULT_VERCEL_MCP_URL;
  }
  if (url !== DEFAULT_VERCEL_MCP_URL) {
    url = DEFAULT_VERCEL_MCP_URL;
  }
  return { url };
}

export function resolveVercelMcpSettings({ env = process.env } = {}) {
  return normalizeVercelMcpSettings({
    url: env.VERCEL_MCP_URL,
  });
}

export function buildVercelClaudeMcpConfig(settings = {}) {
  const normalized = normalizeVercelMcpSettings(settings);
  return {
    [VERCEL_MCP_SERVER_NAME]: {
      type: "http",
      url: normalized.url,
    },
  };
}

export function buildVercelClaudeMcpConfigFromSources(options = {}) {
  return buildVercelClaudeMcpConfig(resolveVercelMcpSettings(options));
}

export function buildVercelCodexMcpConfig(settings = {}) {
  const normalized = normalizeVercelMcpSettings(settings);
  return {
    [VERCEL_MCP_SERVER_NAME]: {
      url: normalized.url,
    },
  };
}

export function buildVercelCodexMcpConfigFromSources(options = {}) {
  return buildVercelCodexMcpConfig(resolveVercelMcpSettings(options));
}

export function mergeCodexTomlVercelMcpConfig(raw = "", vercelConfig = null) {
  if (!vercelConfig) {
    throw new Error("Vercel MCP config is not available.");
  }
  const keptLines = [];
  let removingVercelSection = false;
  for (const line of String(raw || "").split(/\r?\n/)) {
    const header = line.match(/^\s*\[([^\]]+)\]\s*$/);
    if (header) {
      removingVercelSection = isCodexVercelMcpSection(header[1]);
    }
    if (!removingVercelSection) {
      keptLines.push(line);
    }
  }
  while (keptLines.length && keptLines[keptLines.length - 1].trim() === "") {
    keptLines.pop();
  }
  const prefix = keptLines.length ? `${keptLines.join("\n")}\n\n` : "";
  return `${prefix}${formatCodexVercelMcpToml(vercelConfig)}\n`;
}

function formatCodexVercelMcpToml(config) {
  return [
    `[mcp_servers.${VERCEL_MCP_SERVER_NAME}]`,
    `url = ${tomlString(config.url)}`,
  ].join("\n");
}

function isCodexVercelMcpSection(sectionName = "") {
  const parts = String(sectionName || "")
    .split(".")
    .map((part) => unquoteTomlKey(part.trim()))
    .filter(Boolean);
  return parts[0] === "mcp_servers" && parts[1] === VERCEL_MCP_SERVER_NAME;
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
