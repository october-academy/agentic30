import test from "node:test";
import assert from "node:assert/strict";

import {
  collectIntegrationStatus,
  probeCloudflareIntegration,
  probeGithubIntegration,
  probePosthogIntegration,
} from "../sidecar/integration-status.mjs";
import { resetGithubMcpTokenCacheForTesting } from "../sidecar/github-mcp-config.mjs";

test.beforeEach(() => {
  resetGithubMcpTokenCacheForTesting();
});

function jsonResponse(payload, ok = true, status = 200) {
  return { ok, status, json: async () => payload };
}

test("probeGithubIntegration: gh login drives both CLI and MCP states", async () => {
  const loggedIn = await probeGithubIntegration({
    execImpl: async () => ({ ok: true, stdout: "Logged in", stderr: "" }),
    env: { GITHUB_MCP_TOKEN: "gho_x" },
  });
  assert.equal(loggedIn.cli.state, "ready");
  assert.equal(loggedIn.mcp.state, "ready");

  const loggedOut = await probeGithubIntegration({
    execImpl: async () => ({ ok: false, stdout: "", stderr: "not logged in" }),
    env: {},
  });
  assert.equal(loggedOut.cli.state, "missing");
  assert.equal(loggedOut.mcp.state, "missing");
});

test("probePosthogIntegration distinguishes missing, malformed, failed, and ready", async () => {
  // No key → MCP still works through provider OAuth; the badge says so.
  const oauthDelegated = await probePosthogIntegration({
    env: {},
    appSupportPath: "/nonexistent",
    fetchImpl: async () => { throw new Error("must not call"); },
  });
  assert.equal(oauthDelegated.state, "oauth");
  assert.match(oauthDelegated.detail, /OAuth/);

  const malformed = await probePosthogIntegration({
    env: { POSTHOG_MCP_API_KEY: "phc_project-key" },
    fetchImpl: async () => { throw new Error("must not call"); },
  });
  assert.equal(malformed.state, "failed");
  assert.match(malformed.detail, /phx_/);

  const unauthorized = await probePosthogIntegration({
    env: { POSTHOG_MCP_API_KEY: "phx_bad" },
    fetchImpl: async () => jsonResponse({ detail: "nope" }, false, 401),
  });
  assert.equal(unauthorized.state, "failed");
  assert.match(unauthorized.detail, /401/);

  let calledUrl = "";
  const ready = await probePosthogIntegration({
    env: { POSTHOG_MCP_API_KEY: "phx_good" },
    fetchImpl: async (url) => { calledUrl = url; return jsonResponse({ uuid: "u" }); },
  });
  assert.equal(ready.state, "ready");
  assert.match(calledUrl, /^https:\/\/us\.posthog\.com\/api\/users\/@me/);
});

test("probeCloudflareIntegration verifies token against /zones", async () => {
  const oauthDelegated = await probeCloudflareIntegration({
    env: {},
    appSupportPath: "/nonexistent",
    fetchImpl: async () => { throw new Error("must not call"); },
  });
  assert.equal(oauthDelegated.state, "oauth");
  assert.match(oauthDelegated.detail, /OAuth/);

  const failed = await probeCloudflareIntegration({
    env: { CLOUDFLARE_API_TOKEN: "bad" },
    fetchImpl: async () => jsonResponse({ errors: [{}] }, false, 403),
  });
  assert.equal(failed.state, "failed");

  const noZones = await probeCloudflareIntegration({
    env: { CLOUDFLARE_API_TOKEN: "ok" },
    fetchImpl: async () => jsonResponse({ result: [] }),
  });
  assert.equal(noZones.state, "failed");
  assert.match(noZones.detail, /존이 없어요/);

  const ready = await probeCloudflareIntegration({
    env: { CLOUDFLARE_API_TOKEN: "ok" },
    fetchImpl: async () => jsonResponse({ result: [{ name: "agentic30.dev" }, { name: "two.dev" }] }),
  });
  assert.equal(ready.state, "ready");
  assert.match(ready.detail, /agentic30\.dev 외 1개/);
});

test("collectIntegrationStatus aggregates all probes with a timestamp", async () => {
  const result = await collectIntegrationStatus({
    env: { POSTHOG_MCP_API_KEY: "phx_good", CLOUDFLARE_API_TOKEN: "ok", GITHUB_MCP_TOKEN: "gho_x" },
    execImpl: async () => ({ ok: true, stdout: "Logged in", stderr: "" }),
    fetchImpl: async (url) => url.includes("cloudflare")
      ? jsonResponse({ result: [{ name: "agentic30.dev" }] })
      : jsonResponse({ uuid: "u" }),
    now: new Date("2026-06-10T09:00:00.000Z"),
  });
  assert.equal(result.github.state, "ready");
  assert.equal(result.githubMcp.state, "ready");
  assert.equal(result.posthog.state, "ready");
  assert.equal(result.cloudflare.state, "ready");
  assert.equal(result.checkedAt, "2026-06-10T09:00:00.000Z");
});
