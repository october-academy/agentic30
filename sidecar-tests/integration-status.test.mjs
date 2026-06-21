import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  collectIntegrationStatus,
  integrationProbeLogLevel,
  mergeMcpOauthConnectResultIntoIntegrationStatus,
  probeCloudflareIntegration,
  probeExaIntegration,
  probeGithubIntegration,
  probePosthogIntegration,
  probeVercelIntegration,
} from "../sidecar/integration-status.mjs";
import { resetGithubMcpTokenCacheForTesting } from "../sidecar/github-mcp-config.mjs";

test.beforeEach(() => {
  resetGithubMcpTokenCacheForTesting();
});

function jsonResponse(payload, ok = true, status = 200) {
  return { ok, status, json: async () => payload };
}

test("integrationProbeLogLevel reserves warnings for actionable failures", () => {
  assert.equal(integrationProbeLogLevel("failed"), "error");
  assert.equal(integrationProbeLogLevel("missing"), "info");
  assert.equal(integrationProbeLogLevel("ready"), null);
  assert.equal(integrationProbeLogLevel("oauth"), null);
  assert.equal(integrationProbeLogLevel(""), null);
});

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

test("probes report ready when MCP OAuth state is verified and no key is stored", async () => {
  // OAuth-first 연결은 키가 디스크에 없다 — "MCP 연결"이 영속한 ready 상태가
  // Settings 배지에서 연결됨으로 보여야 한다.
  const appSupportPath = await fs.mkdtemp(path.join(os.tmpdir(), "integration-oauth-"));
  try {
    await fs.writeFile(
      path.join(appSupportPath, "mcp-oauth-state.json"),
      JSON.stringify({
        schemaVersion: 1,
        servers: {
          posthog: { state: "ready", provider: "claude", detail: "ok", checkedAt: "2026-06-10T11:00:00.000Z" },
          cloudflare: { state: "ready", provider: "claude", detail: "ok", checkedAt: "2026-06-10T11:00:00.000Z" },
          vercel: { state: "ready", provider: "claude", detail: "ok", checkedAt: "2026-06-10T11:00:00.000Z" },
        },
      }),
    );
    const posthog = await probePosthogIntegration({
      env: {},
      appSupportPath,
      fetchImpl: async () => { throw new Error("must not call"); },
    });
    assert.equal(posthog.state, "ready");
    assert.match(posthog.detail, /OAuth 연결 검증됨/);

    const cloudflare = await probeCloudflareIntegration({
      env: {},
      appSupportPath,
      fetchImpl: async () => { throw new Error("must not call"); },
    });
    assert.equal(cloudflare.state, "ready");
    assert.match(cloudflare.detail, /OAuth 연결 검증됨/);

    const vercel = await probeVercelIntegration({ appSupportPath });
    assert.equal(vercel.state, "ready");
    assert.match(vercel.detail, /OAuth 연결 검증됨/);
  } finally {
    await fs.rm(appSupportPath, { recursive: true, force: true });
  }
});

test("OAuth badge is provider-scoped — verification on one provider does not light up another", async () => {
  // 토큰 캐시는 프로바이더(Claude/Codex)별 — claude로 검증한 상태에서 현재
  // 선택이 codex면 "연결됨" 대신 재연결 안내가 보여야 한다.
  const appSupportPath = await fs.mkdtemp(path.join(os.tmpdir(), "integration-oauth-provider-"));
  try {
    await fs.writeFile(
      path.join(appSupportPath, "mcp-oauth-state.json"),
      JSON.stringify({
        schemaVersion: 1,
        servers: {
          posthog: { state: "ready", provider: "claude", detail: "ok", checkedAt: "2026-06-10T11:00:00.000Z" },
          cloudflare: { state: "ready", provider: "claude", detail: "ok", checkedAt: "2026-06-10T11:00:00.000Z" },
          vercel: { state: "ready", provider: "claude", detail: "ok", checkedAt: "2026-06-10T11:00:00.000Z" },
        },
      }),
    );
    const mustNotFetch = async () => { throw new Error("must not call"); };

    const matching = await probePosthogIntegration({
      env: {},
      appSupportPath,
      fetchImpl: mustNotFetch,
      provider: "claude",
    });
    assert.equal(matching.state, "ready");
    assert.match(matching.detail, /\(Claude\)/);

    const mismatched = await probePosthogIntegration({
      env: {},
      appSupportPath,
      fetchImpl: mustNotFetch,
      provider: "codex",
    });
    assert.equal(mismatched.state, "oauth");
    assert.match(mismatched.detail, /Claude에서만 검증됐어요/);
    assert.match(mismatched.detail, /Codex/);

    const cloudflareMismatched = await probeCloudflareIntegration({
      env: {},
      appSupportPath,
      fetchImpl: mustNotFetch,
      provider: "codex",
    });
    assert.equal(cloudflareMismatched.state, "oauth");
    assert.match(cloudflareMismatched.detail, /Claude에서만 검증됐어요/);

    const vercelMismatched = await probeVercelIntegration({
      appSupportPath,
      provider: "codex",
    });
    assert.equal(vercelMismatched.state, "oauth");
    assert.match(vercelMismatched.detail, /Claude에서만 검증됐어요/);
  } finally {
    await fs.rm(appSupportPath, { recursive: true, force: true });
  }
});

test("probeVercelIntegration reports OAuth delegated when not yet verified", async () => {
  const oauthDelegated = await probeVercelIntegration({
    appSupportPath: "/nonexistent",
  });
  assert.equal(oauthDelegated.state, "oauth");
  assert.match(oauthDelegated.detail, /OAuth/);
});

test("probeExaIntegration reports missing without a key or discovered route", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "integration-exa-missing-"));
  try {
    const result = await probeExaIntegration({
      env: {},
      homeDir: home,
      provider: "codex",
    });
    assert.equal(result.state, "missing");
    assert.match(result.detail, /Exa MCP/);
  } finally {
    await fs.rm(home, { recursive: true, force: true });
  }
});

test("probeExaIntegration reports ready from EXA_API_KEY without leaking the key", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "integration-exa-env-"));
  try {
    const result = await probeExaIntegration({
      env: { EXA_API_KEY: "exa_secret" },
      homeDir: home,
      provider: "codex",
    });
    assert.equal(result.state, "ready");
    assert.match(result.detail, /Exa MCP/);
    assert.equal(result.route.hasHeaders, true);
    assert.equal(JSON.stringify(result).includes("exa_secret"), false);
  } finally {
    await fs.rm(home, { recursive: true, force: true });
  }
});

test("probeExaIntegration reports ready from saved Exa API key without leaking the key", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "integration-exa-saved-"));
  try {
    const result = await probeExaIntegration({
      env: {},
      exaApiKey: "exa_saved_secret",
      homeDir: home,
      provider: "codex",
    });
    assert.equal(result.state, "ready");
    assert.match(result.detail, /direct Exa Search key/);
    assert.equal(result.route.hasHeaders, true);
    assert.equal(JSON.stringify(result).includes("exa_saved_secret"), false);
  } finally {
    await fs.rm(home, { recursive: true, force: true });
  }
});

test("probeExaIntegration reports missing when a discovered Codex MCP route has no direct key", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "integration-exa-codex-route-only-"));
  try {
    await fs.mkdir(path.join(home, ".codex"), { recursive: true });
    await fs.writeFile(path.join(home, ".codex", "config.toml"), [
      "[mcp_servers.exa]",
      "url = \"https://mcp.exa.ai/mcp\"",
    ].join("\n"));

    const result = await probeExaIntegration({
      env: {},
      homeDir: home,
      provider: "codex",
    });
    assert.equal(result.state, "missing");
    assert.match(result.detail, /route는 발견됐지만 direct Exa Search 키가 없습니다/);
    assert.equal(result.route.provider, "codex");
    assert.equal(result.route.hasHeaders, false);
  } finally {
    await fs.rm(home, { recursive: true, force: true });
  }
});

test("probeExaIntegration reports ready from discovered Codex MCP header key", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "integration-exa-codex-"));
  try {
    await fs.mkdir(path.join(home, ".codex"), { recursive: true });
    await fs.writeFile(path.join(home, ".codex", "config.toml"), [
      "[mcp_servers.exa]",
      "url = \"https://mcp.exa.ai/mcp\"",
      "",
      "[mcp_servers.exa.headers]",
      "\"x-api-key\" = \"codex-secret\"",
    ].join("\n"));

    const result = await probeExaIntegration({
      env: {},
      homeDir: home,
      provider: "codex",
    });
    assert.equal(result.state, "ready");
    assert.match(result.detail, /Codex/);
    assert.equal(result.route.provider, "codex");
    assert.equal(JSON.stringify(result).includes("codex-secret"), false);
  } finally {
    await fs.rm(home, { recursive: true, force: true });
  }
});

test("probeExaIntegration reports ready from discovered MCP env key without leaking it", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "integration-exa-env-route-"));
  try {
    await fs.mkdir(path.join(home, ".gemini"), { recursive: true });
    await fs.writeFile(path.join(home, ".gemini", "settings.json"), JSON.stringify({
      mcpServers: {
        exa: {
          url: "https://mcp.exa.ai/mcp",
          env: { EXA_API_KEY: "gemini-secret" },
        },
      },
    }));

    const result = await probeExaIntegration({
      env: {},
      homeDir: home,
      provider: "gemini",
    });
    assert.equal(result.state, "ready");
    assert.match(result.detail, /Gemini/);
    assert.equal(result.route.provider, "gemini");
    assert.equal(result.route.hasEnv, true);
    assert.equal(JSON.stringify(result).includes("gemini-secret"), false);
  } finally {
    await fs.rm(home, { recursive: true, force: true });
  }
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
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "integration-status-home-"));
  try {
    const result = await collectIntegrationStatus({
      env: {
        POSTHOG_MCP_API_KEY: "phx_good",
        CLOUDFLARE_API_TOKEN: "ok",
        GITHUB_MCP_TOKEN: "gho_x",
        EXA_API_KEY: "exa_secret",
      },
      homeDir: home,
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
    assert.equal(result.vercel.state, "oauth");
    assert.equal(result.exa.state, "ready");
    assert.equal(JSON.stringify(result.exa).includes("exa_secret"), false);
    assert.equal(result.checkedAt, "2026-06-10T09:00:00.000Z");
  } finally {
    await fs.rm(home, { recursive: true, force: true });
  }
});

test("mergeMcpOauthConnectResultIntoIntegrationStatus updates only the connected server", () => {
  const current = {
    github: { state: "ready", detail: "gh ok" },
    githubMcp: { state: "ready", detail: "mcp ok" },
    posthog: { state: "oauth", detail: "needs login" },
    cloudflare: { state: "ready", detail: "cf ok" },
    vercel: { state: "oauth", detail: "needs login" },
    checkedAt: "2026-06-10T09:00:00.000Z",
  };
  const merged = mergeMcpOauthConnectResultIntoIntegrationStatus({
    current,
    provider: "codex",
    now: new Date("2026-06-10T09:01:00.000Z"),
    result: {
      server: "posthog",
      provider: "codex",
      state: "ready",
      detail: "PostHog MCP OAuth 로그인과 도구 호출이 확인됨",
    },
  });

  assert.equal(merged.github.detail, "gh ok");
  assert.equal(merged.cloudflare.detail, "cf ok");
  assert.equal(merged.posthog.state, "ready");
  assert.match(merged.posthog.detail, /PostHog MCP/);
  assert.equal(merged.provider, "codex");
  assert.equal(merged.checkedAt, "2026-06-10T09:01:00.000Z");
});
