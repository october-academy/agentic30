import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  buildExaApiKeyRoute,
  discoverExaMcpRoutes,
  orderExaMcpRoutes,
  redactExaResearchRoute,
} from "../sidecar/exa-mcp-discovery.mjs";

async function withTmpHome(fn) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-exa-home-"));
  try {
    return await fn(home);
  } finally {
    await fs.rm(home, { recursive: true, force: true });
  }
}

test("discovers Exa MCP from Codex TOML, Claude JSON, and Gemini JSON", async () => {
  await withTmpHome(async (home) => {
    await fs.mkdir(path.join(home, ".codex"), { recursive: true });
    await fs.mkdir(path.join(home, ".claude"), { recursive: true });
    await fs.mkdir(path.join(home, ".gemini", "config"), { recursive: true });
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
    await fs.writeFile(path.join(home, ".gemini", "config", "mcp_config.json"), "");

    const routes = discoverExaMcpRoutes({ homeDir: home });
    assert.deepEqual(routes.map((route) => route.provider).sort(), ["claude", "codex", "gemini"]);
    assert.equal(routes.find((route) => route.provider === "codex").mcpConfig.headers["x-api-key"], "codex-secret");
    assert.equal(routes.find((route) => route.provider === "gemini").mcpConfig.env.EXA_API_KEY, "gemini-secret");
  });
});

test("orders discovered Exa routes by preferred provider", () => {
  const ordered = orderExaMcpRoutes([
    { provider: "claude", configPath: "b" },
    { provider: "gemini", configPath: "c" },
    { provider: "codex", configPath: "a" },
  ], { preferredProvider: "gemini" });
  assert.deepEqual(ordered.map((route) => route.provider), ["gemini", "codex", "claude"]);
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
  assert.equal(summary.label, "EXA_API_KEY fallback");
  assert.equal(summary.hasHeaders, true);
  assert.equal(summary.hasEnv, true);
  assert.equal(JSON.stringify(summary).includes("exa_secret"), false);
  assert.equal(JSON.stringify(summary).includes("env-secret"), false);
});
