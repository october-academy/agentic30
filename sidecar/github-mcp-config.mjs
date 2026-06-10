import { execFileSync } from "node:child_process";

// GitHub MCP wiring. The user already authenticates GitHub through `gh auth
// login` (Settings > 연동 > GitHub), so the official GitHub MCP server rides
// the same credential: `gh auth token` — no second secret to manage. Env vars
// (GITHUB_MCP_TOKEN / GITHUB_PERSONAL_ACCESS_TOKEN / GITHUB_TOKEN) win over the
// CLI so CI and power users can override.

export const GITHUB_MCP_SERVER_NAME = "github";
export const GITHUB_MCP_TOKEN_ENV_VAR = "GITHUB_MCP_TOKEN";
export const DEFAULT_GITHUB_MCP_URL = "https://api.githubcopilot.com/mcp/";

const GH_TOKEN_CACHE_TTL_MS = 60_000;
const GH_TOKEN_TIMEOUT_MS = 4_000;

let ghTokenCache = { token: "", at: Number.NEGATIVE_INFINITY };

export function resetGithubMcpTokenCacheForTesting() {
  ghTokenCache = { token: "", at: Number.NEGATIVE_INFINITY };
}

function defaultGhTokenExec() {
  try {
    return execFileSync("gh", ["auth", "token"], {
      timeout: GH_TOKEN_TIMEOUT_MS,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

function ghCliToken({ now = Date.now(), ghTokenExec = defaultGhTokenExec } = {}) {
  if (now - ghTokenCache.at < GH_TOKEN_CACHE_TTL_MS) return ghTokenCache.token;
  const token = String(ghTokenExec() || "").trim();
  ghTokenCache = { token, at: now };
  return token;
}

export function resolveGithubMcpSettings({
  env = process.env,
  ghTokenExec,
  now,
} = {}) {
  const token = String(
    env[GITHUB_MCP_TOKEN_ENV_VAR]
      || env.GITHUB_PERSONAL_ACCESS_TOKEN
      || env.GITHUB_TOKEN
      || ghCliToken({ ghTokenExec, now })
      || "",
  ).trim();
  const url = String(env.GITHUB_MCP_URL || "").trim() || DEFAULT_GITHUB_MCP_URL;
  return {
    token,
    tokenValid: Boolean(token),
    url,
  };
}

export function buildGithubClaudeMcpConfig(settings = {}) {
  if (!settings?.tokenValid) return {};
  return {
    [GITHUB_MCP_SERVER_NAME]: {
      type: "http",
      url: settings.url || DEFAULT_GITHUB_MCP_URL,
      headers: {
        Authorization: `Bearer ${settings.token}`,
        Accept: "application/json, text/event-stream",
      },
    },
  };
}

export function buildGithubClaudeMcpConfigFromSources(options = {}) {
  return buildGithubClaudeMcpConfig(resolveGithubMcpSettings(options));
}

export function buildGithubCodexMcpConfig(settings = {}) {
  if (!settings?.tokenValid) return {};
  return {
    [GITHUB_MCP_SERVER_NAME]: {
      url: settings.url || DEFAULT_GITHUB_MCP_URL,
      bearer_token_env_var: GITHUB_MCP_TOKEN_ENV_VAR,
    },
  };
}

export function buildGithubCodexMcpConfigFromSources(options = {}) {
  return buildGithubCodexMcpConfig(resolveGithubMcpSettings(options));
}

export function applyGithubCodexEnvFromSources(env = {}, options = {}) {
  const nextEnv = { ...env };
  const settings = resolveGithubMcpSettings({ ...options, env: options.env || env });
  if (settings.tokenValid) {
    nextEnv[GITHUB_MCP_TOKEN_ENV_VAR] = settings.token;
  }
  return nextEnv;
}
