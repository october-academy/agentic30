import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  EXA_MCP_URL,
  connectExaMcpWithApiKey,
  assureExaMcpConfig,
  assureCodexExaMcpConfig,
  buildExaApiKeyRoute,
  discoverExaMcpRoutes,
  mergeJsonExaMcpConfig,
  mergeCodexTomlExaMcpConfig,
  orderExaMcpRoutes,
  redactExaResearchRoute,
  resolveExaResearchRoutes,
  validateExaMcpApiKey,
} from "../sidecar/exa-mcp-discovery.mjs";

async function withTmpHome(fn) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-exa-home-"));
  try {
    return await fn(home);
  } finally {
    await fs.rm(home, { recursive: true, force: true });
  }
}

test("discovers Exa MCP from Codex TOML, Claude JSON, Gemini JSON, and Cursor JSON", async () => {
  await withTmpHome(async (home) => {
    await fs.mkdir(path.join(home, ".codex"), { recursive: true });
    await fs.mkdir(path.join(home, ".claude"), { recursive: true });
    await fs.mkdir(path.join(home, ".gemini", "config"), { recursive: true });
    await fs.mkdir(path.join(home, ".cursor"), { recursive: true });
    await fs.writeFile(path.join(home, ".codex", "config.toml"), [
      "[mcp_servers.exa]",
      "url = \"https://mcp.exa.ai/mcp\"",
      "",
      "[mcp_servers.exa.headers]",
      "\"x-api-key\" = \"codex-secret\"",
    ].join("\n"));
    await fs.writeFile(path.join(home, ".claude", "mcp.json"), JSON.stringify({
      mcpServers: {
        exa: {
          type: "http",
          url: "https://mcp.exa.ai/mcp",
          headers: { Authorization: "Bearer claude-secret" },
        },
      },
    }));
    await fs.writeFile(path.join(home, ".gemini", "settings.json"), JSON.stringify({
      mcpServers: {
        marketSearch: {
          command: "npx",
          args: ["-y", "exa-mcp-server"],
          env: { EXA_API_KEY: "gemini-secret" },
        },
      },
    }));
    await fs.writeFile(path.join(home, ".cursor", "mcp.json"), JSON.stringify({
      mcpServers: {
        exa: {
          url: "https://mcp.exa.ai/mcp",
          headers: { "x-api-key": "cursor-secret" },
        },
      },
    }));
    await fs.writeFile(path.join(home, ".gemini", "config", "mcp_config.json"), "");

    const routes = discoverExaMcpRoutes({ homeDir: home });
    assert.deepEqual(routes.map((route) => route.provider).sort(), ["claude", "codex", "cursor", "gemini"]);
    assert.equal(routes.find((route) => route.provider === "codex").mcpConfig.headers["x-api-key"], "codex-secret");
    assert.equal(routes.find((route) => route.provider === "gemini").mcpConfig.env.EXA_API_KEY, "gemini-secret");
    assert.equal(routes.find((route) => route.provider === "cursor").mcpConfig.headers["x-api-key"], "cursor-secret");
    assert.match(routes.find((route) => route.provider === "codex").mcpConfig.url, /web_search_exa/);
    assert.match(routes.find((route) => route.provider === "codex").mcpConfig.url, /web_search_advanced_exa/);
    assert.match(routes.find((route) => route.provider === "codex").mcpConfig.url, /web_fetch_exa/);
  });
});

test("EXA_API_KEY route enables advanced Exa search and fetch tools", () => {
  const route = buildExaApiKeyRoute({ apiKey: "exa_secret", provider: "codex" });
  assert.equal(route.mcpConfig.url, EXA_MCP_URL);
  assert.match(route.mcpConfig.url, /web_search_exa/);
  assert.match(route.mcpConfig.url, /web_search_advanced_exa/);
  assert.match(route.mcpConfig.url, /web_fetch_exa/);
});

test("discovers Exa MCP from Gemini httpUrl config", async () => {
  await withTmpHome(async (home) => {
    await fs.mkdir(path.join(home, ".gemini"), { recursive: true });
    await fs.writeFile(path.join(home, ".gemini", "settings.json"), JSON.stringify({
      mcpServers: {
        exa: {
          type: "http",
          httpUrl: "https://mcp.exa.ai/mcp",
          headers: { "x-api-key": "gemini-secret" },
        },
      },
    }));

    const routes = discoverExaMcpRoutes({ homeDir: home });
    assert.equal(routes.length, 1);
    assert.equal(routes[0].provider, "gemini");
    assert.equal(routes[0].mcpConfig.url, EXA_MCP_URL);
    assert.equal(routes[0].mcpConfig.headers["x-api-key"], "gemini-secret");
  });
});

test("orders discovered Exa routes by preferred provider", () => {
  const ordered = orderExaMcpRoutes([
    { provider: "claude", configPath: "b" },
    { provider: "gemini", configPath: "c" },
    { provider: "cursor", configPath: "d" },
    { provider: "codex", configPath: "a" },
  ], { preferredProvider: "cursor" });
  assert.deepEqual(ordered.map((route) => route.provider), ["cursor", "codex", "claude", "gemini"]);
});

test("configured EXA_API_KEY route wins before discovered provider MCP routes", () => {
  const routes = resolveExaResearchRoutes({
    apiKey: "exa_secret",
    preferredProvider: "gemini",
    discoveredRoutes: [
      {
        provider: "codex",
        source: "provider_mcp",
        label: "Codex Exa MCP",
        serverName: "exa",
        configPath: "a",
        mcpConfig: { type: "http", url: EXA_MCP_URL },
      },
      {
        provider: "gemini",
        source: "provider_mcp",
        label: "Gemini Exa MCP",
        serverName: "exa",
        configPath: "b",
        mcpConfig: { type: "http", url: "https://mcp.exa.ai/mcp?alt=1" },
      },
    ],
  });

  assert.equal(routes[0].source, "api_key");
  assert.equal(routes[0].provider, "gemini");
  assert.equal(routes[0].label, "Exa Search (EXA_API_KEY)");
  assert.equal(routes[1].provider, "gemini");
  assert.equal(routes[2].provider, "codex");
});

test("redacted Exa route summary excludes header and env values", () => {
  const route = buildExaApiKeyRoute({ apiKey: "exa_secret", provider: "codex" });
  const summary = redactExaResearchRoute({
    ...route,
    mcpConfig: {
      ...route.mcpConfig,
      env: { EXA_API_KEY: "env-secret" },
    },
  });
  assert.equal(summary.label, "Exa Search (EXA_API_KEY)");
  assert.equal(summary.hasHeaders, true);
  assert.equal(summary.hasEnv, true);
  assert.equal(JSON.stringify(summary).includes("exa_secret"), false);
  assert.equal(JSON.stringify(summary).includes("env-secret"), false);
});

test("mergeCodexTomlExaMcpConfig replaces only the Codex Exa MCP section and is idempotent", () => {
  const original = [
    "model = \"gpt-5\"",
    "",
    "[mcp_servers.github]",
    "url = \"https://api.githubcopilot.com/mcp\"",
    "",
    "[mcp_servers.exa]",
    "url = \"https://old.example/mcp\"",
    "",
    "[mcp_servers.exa.headers]",
    "\"x-api-key\" = \"old-secret\"",
    "",
    "[projects.\"/tmp/app\"]",
    "trust_level = \"trusted\"",
    "",
  ].join("\n");

  const first = mergeCodexTomlExaMcpConfig(original, { apiKey: "exa_secret" });
  assert.equal(first.changed, true);
  assert.match(first.content, /model = "gpt-5"/);
  assert.match(first.content, /\[mcp_servers\.github\]/);
  assert.match(first.content, /\[projects\."\/tmp\/app"\]/);
  assert.doesNotMatch(first.content, /old-secret/);
  assert.doesNotMatch(first.content, /old\.example/);
  assert.match(first.content, /\[mcp_servers\.exa\]/);
  assert.match(first.content, /web_search_exa/);
  assert.match(first.content, /web_search_advanced_exa/);
  assert.match(first.content, /web_fetch_exa/);
  assert.match(first.content, /"x-api-key" = "exa_secret"/);

  const second = mergeCodexTomlExaMcpConfig(first.content, { apiKey: "exa_secret" });
  assert.equal(second.changed, false);
  assert.equal(second.content, first.content);
});

test("assureCodexExaMcpConfig backs up existing config, writes atomically, and redacts result", async () => {
  await withTmpHome(async (home) => {
    const configPath = path.join(home, ".codex", "config.toml");
    const original = [
      "model = \"gpt-5\"",
      "",
      "[mcp_servers.github]",
      "url = \"https://api.githubcopilot.com/mcp\"",
      "",
    ].join("\n");
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(configPath, original);

    const result = assureCodexExaMcpConfig({ homeDir: home, apiKey: "exa_secret" });
    assert.equal(result.state, "ready");
    assert.equal(result.changed, true);
    assert.equal(result.configPath, configPath);
    assert.ok(result.backupPath);
    assert.equal(JSON.stringify(result).includes("exa_secret"), false);

    const written = await fs.readFile(configPath, "utf8");
    assert.match(written, /\[mcp_servers\.github\]/);
    assert.match(written, /\[mcp_servers\.exa\]/);
    assert.match(written, /web_search_exa/);
    assert.match(written, /"x-api-key" = "exa_secret"/);
    assert.equal(await fs.readFile(result.backupPath, "utf8"), original);

    const second = assureCodexExaMcpConfig({ homeDir: home, apiKey: "exa_secret" });
    assert.equal(second.state, "ready");
    assert.equal(second.changed, false);
    assert.equal(second.backupPath, null);
  });
});

test("mergeJsonExaMcpConfig preserves unrelated provider JSON and is idempotent", () => {
  const original = JSON.stringify({
    theme: "dark",
    mcpServers: {
      filesystem: { command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem"] },
      exa: { url: "https://old.example/mcp", headers: { "x-api-key": "old-secret" } },
    },
  }, null, 2) + "\n";

  const first = mergeJsonExaMcpConfig(original, { apiKey: "exa_secret", provider: "claude" });
  assert.equal(first.changed, true);
  const parsed = JSON.parse(first.content);
  assert.equal(parsed.theme, "dark");
  assert.equal(parsed.mcpServers.filesystem.command, "npx");
  assert.equal(parsed.mcpServers.exa.type, "http");
  assert.equal(parsed.mcpServers.exa.url, EXA_MCP_URL);
  assert.equal(parsed.mcpServers.exa.headers["x-api-key"], "exa_secret");
  assert.equal(first.content.includes("old-secret"), false);

  const second = mergeJsonExaMcpConfig(first.content, { apiKey: "exa_secret", provider: "claude" });
  assert.equal(second.changed, false);
  assert.equal(second.content, first.content);
});

test("assureExaMcpConfig writes Claude, Gemini, and Cursor configs with backups and redacted results", async () => {
  await withTmpHome(async (home) => {
    const cases = [
      { provider: "claude", configPath: path.join(home, ".claude", "mcp.json"), urlField: "url" },
      { provider: "gemini", configPath: path.join(home, ".gemini", "settings.json"), urlField: "httpUrl" },
      { provider: "cursor", configPath: path.join(home, ".cursor", "mcp.json"), urlField: "url" },
    ];
    for (const item of cases) {
      await fs.mkdir(path.dirname(item.configPath), { recursive: true });
      const original = JSON.stringify({
        mcpServers: {
          github: { url: "https://api.githubcopilot.com/mcp" },
        },
      }, null, 2) + "\n";
      await fs.writeFile(item.configPath, original);

      const result = assureExaMcpConfig({
        homeDir: home,
        provider: item.provider,
        apiKey: `${item.provider}_secret`,
        now: new Date("2026-06-14T00:00:00.000Z"),
      });
      assert.equal(result.state, "ready");
      assert.equal(result.provider, item.provider);
      assert.equal(result.changed, true);
      assert.ok(result.backupPath);
      assert.equal(JSON.stringify(result).includes(`${item.provider}_secret`), false);

      const written = JSON.parse(await fs.readFile(item.configPath, "utf8"));
      assert.equal(written.mcpServers.github.url, "https://api.githubcopilot.com/mcp");
      assert.equal(written.mcpServers.exa[item.urlField], EXA_MCP_URL);
      assert.equal(written.mcpServers.exa.headers["x-api-key"], `${item.provider}_secret`);
      assert.equal(await fs.readFile(result.backupPath, "utf8"), original);

      const second = assureExaMcpConfig({
        homeDir: home,
        provider: item.provider,
        apiKey: `${item.provider}_secret`,
      });
      assert.equal(second.state, "ready");
      assert.equal(second.changed, false);
      assert.equal(second.backupPath, null);
    }
  });
});

test("validateExaMcpApiKey calls web_search_exa and redacts failures", async () => {
  const calls = [];
  const success = await validateExaMcpApiKey({
    apiKey: "exa_secret",
    clientFactory: async ({ apiKey, url, toolName }) => {
      calls.push({ apiKey, url, toolName });
      return {
        callTool: async (request) => {
          calls.push(request);
          return { content: [{ type: "text", text: "ok" }] };
        },
        close: async () => calls.push({ close: true }),
      };
    },
    now: new Date("2026-06-14T00:00:00.000Z"),
  });
  assert.equal(success.state, "ready");
  assert.equal(success.validationTool, "web_search_exa");
  assert.equal(calls[1].name, "web_search_exa");
  assert.equal(calls[1].arguments.query, "Agentic30 Exa MCP validation");
  assert.equal(JSON.stringify(success).includes("exa_secret"), false);

  const failed = await validateExaMcpApiKey({
    apiKey: "exa_secret",
    clientFactory: async () => ({
      callTool: async () => {
        throw new Error("bad key exa_secret");
      },
      close: async () => {},
    }),
  });
  assert.equal(failed.state, "failed");
  assert.equal(JSON.stringify(failed).includes("exa_secret"), false);
  assert.match(failed.detail, /\[redacted\]/);
});

test("connectExaMcpWithApiKey validates before writing provider config", async () => {
  await withTmpHome(async (home) => {
    const configPath = path.join(home, ".cursor", "mcp.json");
    const failed = await connectExaMcpWithApiKey({
      homeDir: home,
      provider: "cursor",
      apiKey: "exa_secret",
      clientFactory: async () => ({
        callTool: async () => ({ isError: true, content: [{ type: "text", text: "unauthorized exa_secret" }] }),
        close: async () => {},
      }),
    });
    assert.equal(failed.state, "failed");
    assert.equal(JSON.stringify(failed).includes("exa_secret"), false);
    await assert.rejects(fs.stat(configPath), /ENOENT/);

    const ready = await connectExaMcpWithApiKey({
      homeDir: home,
      provider: "cursor",
      apiKey: "exa_secret",
      clientFactory: async () => ({
        callTool: async () => ({ content: [{ type: "text", text: "ok" }] }),
        close: async () => {},
      }),
      now: new Date("2026-06-14T00:00:00.000Z"),
    });
    assert.equal(ready.state, "ready");
    assert.equal(ready.provider, "cursor");
    assert.equal(ready.changed, true);
    assert.equal(ready.route.provider, "cursor");
    assert.equal(ready.validationTool, "web_search_exa");
    assert.equal(JSON.stringify(ready).includes("exa_secret"), false);
    const written = JSON.parse(await fs.readFile(configPath, "utf8"));
    assert.equal(written.mcpServers.exa.headers["x-api-key"], "exa_secret");
  });
});
