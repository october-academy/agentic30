import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  DEFAULT_POSTHOG_MCP_FEATURES,
  POSTHOG_MCP_TOKEN_ENV_VAR,
  buildPostHogClaudeMcpConfig,
  buildPostHogCodexMcpConfig,
  buildPostHogMcpUrl,
  mergeCodexTomlPostHogMcpConfig,
  mergeJsonPostHogMcpConfig,
  resolvePostHogMcpSettings,
  syncExternalPostHogMcpClients,
} from "../sidecar/posthog-mcp-config.mjs";

async function withTmpHome(fn) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-posthog-mcp-"));
  try {
    return await fn(home);
  } finally {
    await fs.rm(home, { recursive: true, force: true });
  }
}

test("buildPostHogMcpUrl defaults to upstream US endpoint with read-only tools mode", () => {
  const url = buildPostHogMcpUrl();
  assert.equal(url, `https://mcp.posthog.com/mcp?readonly=1&mode=tools&consumer=agentic30&features=${DEFAULT_POSTHOG_MCP_FEATURES.join(",")}`);
});

test("buildPostHogMcpUrl maps old EU app host to upstream EU MCP endpoint", () => {
  const url = buildPostHogMcpUrl({ url: "https://eu.posthog.com", region: "eu" });
  assert.match(url, /^https:\/\/mcp-eu\.posthog\.com\/mcp\?/);
  assert.match(url, /readonly=1/);
});

test("resolvePostHogMcpSettings accepts phx and pha keys but not project keys", () => {
  assert.equal(resolvePostHogMcpSettings({ env: { POSTHOG_API_KEY: "phx_test" } }).tokenValid, true);
  assert.equal(resolvePostHogMcpSettings({ env: { POSTHOG_API_KEY: "pha_test" } }).tokenValid, true);
  assert.equal(resolvePostHogMcpSettings({ env: { POSTHOG_API_KEY: "phc_project" } }).tokenValid, false);
});

test("Claude MCP config is OAuth-first (URL-only) and uses headers only in api_key mode", () => {
  // OAuth-first: server entry exists with no key at all — the provider runs
  // (or reuses) its native PostHog MCP browser login.
  const oauth = buildPostHogClaudeMcpConfig().posthog;
  assert.equal(oauth.type, "http");
  assert.match(oauth.url, /^https:\/\/mcp\.posthog\.com\/mcp\?/);
  assert.equal(oauth.headers, undefined);

  // A stored key alone does NOT switch to header auth — OAuth keeps priority.
  assert.equal(buildPostHogClaudeMcpConfig({ token: "phx_test" }).posthog.headers, undefined);

  const config = buildPostHogClaudeMcpConfig({ token: "phx_test", authMode: "api_key" }).posthog;
  assert.equal(config.type, "http");
  assert.equal(config.headers.Authorization, "Bearer phx_test");
  assert.equal(config.headers.Accept, "application/json, text/event-stream");
});

test("Codex MCP config references token env var only in api_key mode", () => {
  const oauth = buildPostHogCodexMcpConfig({ token: "phx_secret" }).posthog;
  assert.equal(oauth.bearer_token_env_var, undefined);
  assert.match(oauth.url, /^https:\/\/mcp\.posthog\.com\/mcp\?/);

  const config = buildPostHogCodexMcpConfig({ token: "phx_secret", authMode: "api_key" }).posthog;
  assert.equal(config.bearer_token_env_var, POSTHOG_MCP_TOKEN_ENV_VAR);
  assert.equal(JSON.stringify(config).includes("phx_secret"), false);
});

test("external sync preserves existing Codex and Claude MCP servers", async () => {
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

    const results = await syncExternalPostHogMcpClients({
      homeDir: home,
      env: { POSTHOG_MCP_API_KEY: "phx_secret", POSTHOG_MCP_AUTH_MODE: "api_key" },
      dryRun: false,
    });

    assert.deepEqual(results.map((result) => result.target), ["codex-cli", "claude-code", "claude-app"]);
    const codex = await fs.readFile(codexPath, "utf8");
    assert.match(codex, /\[mcp_servers\.exa\]/);
    assert.match(codex, /\[mcp_servers\.posthog\]/);
    assert.match(codex, /bearer_token_env_var = "POSTHOG_MCP_API_KEY"/);
    assert.equal(codex.includes("phx_secret"), false);

    const claudeCode = JSON.parse(await fs.readFile(claudeCodePath, "utf8"));
    assert.ok(claudeCode.mcpServers.exa);
    assert.equal(claudeCode.mcpServers.posthog.command, "npx");
    assert.equal(claudeCode.mcpServers.posthog.env.POSTHOG_AUTH_HEADER, "Bearer phx_secret");

    const claudeApp = JSON.parse(await fs.readFile(claudeAppPath, "utf8"));
    assert.ok(claudeApp.mcpServers.filesystem);
    assert.equal(claudeApp.mcpServers.posthog.args[1], "mcp-remote@latest");
  });
});

test("external sync rejects invalid tokens and malformed JSON configs", async () => {
  await withTmpHome(async (home) => {
    await assert.rejects(
      syncExternalPostHogMcpClients({
        homeDir: home,
        env: { POSTHOG_MCP_API_KEY: "phc_project", POSTHOG_MCP_AUTH_MODE: "api_key" },
        targets: ["codex-cli"],
      }),
      /phx_ 또는 pha_/,
    );

    const claudePath = path.join(home, ".claude", "mcp.json");
    await fs.mkdir(path.dirname(claudePath), { recursive: true });
    await fs.writeFile(claudePath, "{bad json");
    await assert.rejects(
      syncExternalPostHogMcpClients({
        homeDir: home,
        env: { POSTHOG_MCP_API_KEY: "phx_secret" },
        targets: ["claude-code"],
      }),
      /Cannot parse existing JSON MCP config/,
    );
  });
});

test("merge helpers replace only the posthog server entry", () => {
  const codex = mergeCodexTomlPostHogMcpConfig([
    "[mcp_servers.posthog]",
    "url = \"https://old.example/mcp\"",
    "",
    "[mcp_servers.other]",
    "url = \"https://other.example/mcp\"",
  ].join("\n"), {
    url: "https://mcp.posthog.com/mcp?readonly=1",
    bearer_token_env_var: "POSTHOG_MCP_API_KEY",
  });
  assert.match(codex, /\[mcp_servers\.other\]/);
  assert.doesNotMatch(codex, /old\.example/);
  assert.match(codex, /mcp\.posthog\.com/);

  const claude = mergeJsonPostHogMcpConfig(JSON.stringify({
    mcpServers: { other: { command: "node" } },
  }), {
    command: "npx",
    args: ["-y", "mcp-remote@latest", "https://mcp.posthog.com/mcp"],
    env: { POSTHOG_AUTH_HEADER: "Bearer phx_secret" },
  });
  const parsed = JSON.parse(claude);
  assert.ok(parsed.mcpServers.other);
  assert.equal(parsed.mcpServers.posthog.command, "npx");
});
