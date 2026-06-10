import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  MCP_OAUTH_STATE_FILE,
  isMcpOauthServerReady,
  normalizeMcpOauthState,
  persistMcpOauthConnectResult,
  readMcpOauthState,
  resolveMcpOauthStatePath,
} from "../sidecar/mcp-oauth-state.mjs";

async function makeTempAppSupport() {
  return fs.mkdtemp(path.join(os.tmpdir(), "mcp-oauth-state-"));
}

test("normalizeMcpOauthState keeps only known servers and valid states", () => {
  const state = normalizeMcpOauthState({
    servers: {
      posthog: { state: "ready", provider: "Claude", detail: "ok", checkedAt: "2026-06-10T11:00:00.000Z" },
      cloudflare: { state: "nonsense" },
      github: { state: "ready" },
    },
  });
  assert.deepEqual(Object.keys(state.servers), ["posthog"]);
  assert.equal(state.servers.posthog.provider, "claude");
  assert.equal(isMcpOauthServerReady(state, "posthog"), true);
  assert.equal(isMcpOauthServerReady(state, "cloudflare"), false);
  assert.equal(isMcpOauthServerReady(state, "github"), false);
});

test("persistMcpOauthConnectResult round-trips through readMcpOauthState", async () => {
  const appSupportPath = await makeTempAppSupport();
  try {
    await persistMcpOauthConnectResult({
      appSupportPath,
      result: {
        server: "posthog",
        provider: "claude",
        state: "ready",
        detail: "PostHog MCP 도구 호출 검증됨",
        checkedAt: "2026-06-10T11:00:00.000Z",
      },
    });
    const state = readMcpOauthState(appSupportPath);
    assert.equal(isMcpOauthServerReady(state, "posthog"), true);
    assert.equal(state.servers.posthog.detail, "PostHog MCP 도구 호출 검증됨");
    assert.equal(resolveMcpOauthStatePath(appSupportPath), path.join(appSupportPath, MCP_OAUTH_STATE_FILE));
  } finally {
    await fs.rm(appSupportPath, { recursive: true, force: true });
  }
});

test("latest connect attempt wins — a failed retry downgrades a previously ready server", async () => {
  const appSupportPath = await makeTempAppSupport();
  try {
    await persistMcpOauthConnectResult({
      appSupportPath,
      result: { server: "cloudflare", provider: "claude", state: "ready", detail: "ok", checkedAt: "2026-06-10T11:00:00.000Z" },
    });
    await persistMcpOauthConnectResult({
      appSupportPath,
      result: { server: "cloudflare", provider: "claude", state: "failed", detail: "connection lost", checkedAt: "2026-06-10T12:00:00.000Z" },
    });
    const state = readMcpOauthState(appSupportPath);
    assert.equal(isMcpOauthServerReady(state, "cloudflare"), false);
    assert.equal(state.servers.cloudflare.state, "failed");
  } finally {
    await fs.rm(appSupportPath, { recursive: true, force: true });
  }
});

test("persist ignores unknown servers and progress states; read survives corrupt files", async () => {
  const appSupportPath = await makeTempAppSupport();
  try {
    assert.equal(
      await persistMcpOauthConnectResult({
        appSupportPath,
        result: { server: "github", state: "ready" },
      }),
      null,
    );
    assert.equal(
      await persistMcpOauthConnectResult({
        appSupportPath,
        result: { server: "posthog", state: "progress" },
      }),
      null,
    );
    await fs.writeFile(resolveMcpOauthStatePath(appSupportPath), "not json");
    const state = readMcpOauthState(appSupportPath);
    assert.deepEqual(state.servers, {});
    assert.equal(isMcpOauthServerReady(readMcpOauthState(""), "posthog"), false);
  } finally {
    await fs.rm(appSupportPath, { recursive: true, force: true });
  }
});
