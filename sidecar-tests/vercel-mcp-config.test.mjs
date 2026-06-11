import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_VERCEL_MCP_URL,
  VERCEL_MCP_SERVER_NAME,
  buildVercelClaudeMcpConfig,
  buildVercelCodexMcpConfig,
  mergeCodexTomlVercelMcpConfig,
  normalizeVercelMcpSettings,
} from "../sidecar/vercel-mcp-config.mjs";

test("Vercel MCP config is URL-only and pinned to the official endpoint", () => {
  assert.equal(VERCEL_MCP_SERVER_NAME, "vercel");
  assert.equal(DEFAULT_VERCEL_MCP_URL, "https://mcp.vercel.com");
  assert.deepEqual(
    normalizeVercelMcpSettings({ url: "https://custom.example/mcp" }),
    { url: "https://mcp.vercel.com" },
  );

  assert.deepEqual(buildVercelClaudeMcpConfig(), {
    vercel: {
      type: "http",
      url: "https://mcp.vercel.com",
    },
  });
  assert.deepEqual(buildVercelCodexMcpConfig(), {
    vercel: {
      url: "https://mcp.vercel.com",
    },
  });
});

test("mergeCodexTomlVercelMcpConfig replaces only the Vercel server section", () => {
  const merged = mergeCodexTomlVercelMcpConfig([
    "notify = []",
    "",
    "[mcp_servers.vercel]",
    "url = \"https://old.example/mcp\"",
    "",
    "[mcp_servers.exa]",
    "url = \"https://mcp.exa.ai/mcp\"",
    "",
  ].join("\n"), { url: "https://mcp.vercel.com" });

  assert.match(merged, /\[mcp_servers\.exa\]/);
  assert.match(merged, /\[mcp_servers\.vercel\]/);
  assert.match(merged, /url = "https:\/\/mcp\.vercel\.com"/);
  assert.doesNotMatch(merged, /old\.example/);
});
