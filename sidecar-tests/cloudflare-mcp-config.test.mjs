import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  CLOUDFLARE_MCP_TOKEN_ENV_VAR,
  applyCloudflareCodexEnvFromSources,
  buildCloudflareClaudeMcpConfig,
  buildCloudflareCodexMcpConfig,
  buildCloudflareMcpUrl,
  mergeCodexTomlCloudflareMcpConfig,
  mergeJsonCloudflareMcpConfig,
  resolveCloudflareMcpSettings,
  syncExternalCloudflareMcpClients,
} from "../sidecar/cloudflare-mcp-config.mjs";

async function withTmpHome(fn) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-cloudflare-mcp-"));
  try {
    return await fn(home);
  } finally {
    await fs.rm(home, { recursive: true, force: true });
  }
}

test("buildCloudflareMcpUrl defaults to upstream code mode endpoint", () => {
  assert.equal(buildCloudflareMcpUrl(), "https://mcp.cloudflare.com/mcp");
  assert.equal(
    buildCloudflareMcpUrl({ codemode: false }),
    "https://mcp.cloudflare.com/mcp?codemode=false",
  );
});

test("resolveCloudflareMcpSettings reads env token aliases and codemode flag", () => {
  const settings = resolveCloudflareMcpSettings({
    env: {
      CLOUDFLARE_API_TOKEN: "cf_secret",
      CLOUDFLARE_MCP_CODEMODE: "false",
    },
  });
  assert.equal(settings.tokenValid, true);
  assert.equal(settings.token, "cf_secret");
  assert.equal(settings.url, "https://mcp.cloudflare.com/mcp?codemode=false");
});

test("Claude MCP config is OAuth-first (URL-only) and uses headers only in api_key mode", () => {
  // OAuth-first: even with no token, the server entry exists so the provider
  // can run its native browser login.
  const oauth = buildCloudflareClaudeMcpConfig()["cloudflare-api"];
  assert.equal(oauth.type, "http");
  assert.equal(oauth.url, "https://mcp.cloudflare.com/mcp");
  assert.equal(oauth.headers, undefined);

  // A stored token alone does NOT switch to header auth — OAuth keeps priority.
  const tokenStillOauth = buildCloudflareClaudeMcpConfig({ token: "cf_secret" })["cloudflare-api"];
  assert.equal(tokenStillOauth.headers, undefined);

  // Explicit api_key mode pins the Bearer header.
  const apiKey = buildCloudflareClaudeMcpConfig({ token: "cf_secret", authMode: "api_key" })["cloudflare-api"];
  assert.equal(apiKey.headers.Authorization, "Bearer cf_secret");
  assert.equal(apiKey.headers.Accept, "application/json, text/event-stream");
});

test("Codex MCP config references token env var only in api_key mode", () => {
  const oauth = buildCloudflareCodexMcpConfig({ token: "cf_secret" })["cloudflare-api"];
  assert.equal(oauth.url, "https://mcp.cloudflare.com/mcp");
  assert.equal(oauth.bearer_token_env_var, undefined);

  const config = buildCloudflareCodexMcpConfig({ token: "cf_secret", authMode: "api_key" })["cloudflare-api"];
  assert.equal(config.url, "https://mcp.cloudflare.com/mcp");
  assert.equal(config.bearer_token_env_var, CLOUDFLARE_MCP_TOKEN_ENV_VAR);
  assert.equal(JSON.stringify(config).includes("cf_secret"), false);
});

test("applyCloudflareCodexEnvFromSources forwards token only in api_key mode", () => {
  const oauthEnv = applyCloudflareCodexEnvFromSources(
    { PATH: "/bin" },
    { env: { CLOUDFLARE_API_TOKEN: "cf_secret" } },
  );
  assert.equal(oauthEnv.CLOUDFLARE_MCP_API_TOKEN, undefined);

  const env = applyCloudflareCodexEnvFromSources(
    { PATH: "/bin" },
    { env: { CLOUDFLARE_API_TOKEN: "cf_secret", CLOUDFLARE_MCP_AUTH_MODE: "api_key" } },
  );
  assert.equal(env.PATH, "/bin");
  assert.equal(env.CLOUDFLARE_MCP_API_TOKEN, "cf_secret");
});

test("external sync preserves existing MCP servers and supports OAuth without token", async () => {
  await withTmpHome(async (home) => {
    const codexPath = path.join(home, ".codex", "config.toml");
    const claudeCodePath = path.join(home, ".claude", "mcp.json");
    const claudeAppPath = path.join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json");
    await fs.mkdir(path.dirname(codexPath), { recursive: true });
    await fs.mkdir(path.dirname(claudeCodePath), { recursive: true });
    await fs.mkdir(path.dirname(claudeAppPath), { recursive: true });
    await fs.writeFile(codexPath, [
      "notify = []",
      "",
      "[mcp_servers.exa]",
      "url = \"https://mcp.exa.ai/mcp\"",
    ].join("\n"));
    await fs.writeFile(claudeCodePath, JSON.stringify({
      mcpServers: {
        exa: { command: "npx", args: ["exa-mcp-server"] },
      },
    }));
    await fs.writeFile(claudeAppPath, JSON.stringify({
      mcpServers: {
        filesystem: { command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem"] },
      },
    }));

    const results = await syncExternalCloudflareMcpClients({
      homeDir: home,
      env: {},
      dryRun: false,
    });

    assert.deepEqual(results.map((result) => result.authMode), ["oauth", "oauth", "oauth"]);
    const codex = await fs.readFile(codexPath, "utf8");
    assert.match(codex, /\[mcp_servers\.exa\]/);
    assert.match(codex, /\[mcp_servers\.cloudflare-api\]/);
    assert.doesNotMatch(codex, /bearer_token_env_var/);

    const claudeCode = JSON.parse(await fs.readFile(claudeCodePath, "utf8"));
    assert.ok(claudeCode.mcpServers.exa);
    assert.equal(claudeCode.mcpServers["cloudflare-api"].command, "npx");
    assert.equal(claudeCode.mcpServers["cloudflare-api"].args[1], "mcp-remote@latest");
    assert.equal(claudeCode.mcpServers["cloudflare-api"].args[2], "https://mcp.cloudflare.com/mcp");
    assert.equal(claudeCode.mcpServers["cloudflare-api"].env, undefined);

    const claudeApp = JSON.parse(await fs.readFile(claudeAppPath, "utf8"));
    assert.ok(claudeApp.mcpServers.filesystem);
    assert.equal(claudeApp.mcpServers["cloudflare-api"].args[1], "mcp-remote@latest");
  });
});

test("external sync uses API token auth without writing raw token to Codex config", async () => {
  await withTmpHome(async (home) => {
    const results = await syncExternalCloudflareMcpClients({
      homeDir: home,
      env: { CLOUDFLARE_API_TOKEN: "cf_secret", CLOUDFLARE_MCP_AUTH_MODE: "api_key" },
      targets: ["codex-cli", "claude-code"],
      dryRun: false,
    });

    assert.deepEqual(results.map((result) => result.authMode), ["api_token", "api_token"]);
    const codex = await fs.readFile(path.join(home, ".codex", "config.toml"), "utf8");
    assert.match(codex, /bearer_token_env_var = "CLOUDFLARE_MCP_API_TOKEN"/);
    assert.equal(codex.includes("cf_secret"), false);

    const claudeCode = JSON.parse(await fs.readFile(path.join(home, ".claude", "mcp.json"), "utf8"));
    assert.equal(claudeCode.mcpServers["cloudflare-api"].env.CLOUDFLARE_AUTH_HEADER, "Bearer cf_secret");
  });
});

test("merge helpers replace only the cloudflare server entry", () => {
  const codex = mergeCodexTomlCloudflareMcpConfig([
    "[mcp_servers.\"cloudflare-api\"]",
    "url = \"https://old.example/mcp\"",
    "",
    "[mcp_servers.other]",
    "url = \"https://other.example/mcp\"",
  ].join("\n"), {
    url: "https://mcp.cloudflare.com/mcp",
    bearer_token_env_var: "CLOUDFLARE_MCP_API_TOKEN",
  });
  assert.match(codex, /\[mcp_servers\.other\]/);
  assert.doesNotMatch(codex, /old\.example/);
  assert.match(codex, /mcp\.cloudflare\.com/);

  const claude = mergeJsonCloudflareMcpConfig(JSON.stringify({
    mcpServers: { other: { command: "node" } },
  }), {
    command: "npx",
    args: ["-y", "mcp-remote@latest", "https://mcp.cloudflare.com/mcp"],
  });
  const parsed = JSON.parse(claude);
  assert.ok(parsed.mcpServers.other);
  assert.equal(parsed.mcpServers["cloudflare-api"].command, "npx");
});
