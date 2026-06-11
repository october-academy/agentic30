import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  MCP_OAUTH_STATE_FILE,
  isMcpOauthServerReady,
  mcpOauthReadyProviders,
  normalizeMcpOauthState,
  persistMcpOauthConnectResult,
  readMcpOauthState,
  resolveMcpOauthStatePath,
} from "../sidecar/mcp-oauth-state.mjs";

async function makeTempAppSupport() {
  return fs.mkdtemp(path.join(os.tmpdir(), "mcp-oauth-state-"));
}

test("normalizeMcpOauthState keeps only known servers and migrates v1 records under providers", () => {
  const state = normalizeMcpOauthState({
    servers: {
      // v1 형태: 단일 레코드 + provider 필드 → providers[provider]로 승격.
      posthog: { state: "ready", provider: "Claude", detail: "ok", checkedAt: "2026-06-10T11:00:00.000Z" },
      cloudflare: { state: "nonsense" },
      github: { state: "ready" },
    },
  });
  assert.deepEqual(Object.keys(state.servers), ["posthog"]);
  assert.equal(state.servers.posthog.providers.claude.state, "ready");
  assert.equal(isMcpOauthServerReady(state, "posthog"), true);
  assert.equal(isMcpOauthServerReady(state, "posthog", "claude"), true);
  // 프로바이더별 토큰 캐시는 분리돼 있다 — claude 검증이 codex를 보증하지 않는다.
  assert.equal(isMcpOauthServerReady(state, "posthog", "codex"), false);
  assert.equal(isMcpOauthServerReady(state, "cloudflare"), false);
  assert.equal(isMcpOauthServerReady(state, "github"), false);
  assert.deepEqual(mcpOauthReadyProviders(state, "posthog"), ["claude"]);
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
    assert.equal(state.servers.posthog.providers.claude.detail, "PostHog MCP 도구 호출 검증됨");
    assert.equal(resolveMcpOauthStatePath(appSupportPath), path.join(appSupportPath, MCP_OAUTH_STATE_FILE));
  } finally {
    await fs.rm(appSupportPath, { recursive: true, force: true });
  }
});

test("latest connect attempt wins — a failed retry downgrades a previously ready provider", async () => {
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
    assert.equal(state.servers.cloudflare.providers.claude.state, "failed");
  } finally {
    await fs.rm(appSupportPath, { recursive: true, force: true });
  }
});

test("a failed retry on one provider does not touch another provider's ready record", async () => {
  const appSupportPath = await makeTempAppSupport();
  try {
    await persistMcpOauthConnectResult({
      appSupportPath,
      result: { server: "cloudflare", provider: "claude", state: "ready", detail: "ok", checkedAt: "2026-06-10T11:00:00.000Z" },
    });
    await persistMcpOauthConnectResult({
      appSupportPath,
      result: { server: "cloudflare", provider: "codex", state: "failed", detail: "codex login missing", checkedAt: "2026-06-10T12:00:00.000Z" },
    });
    const state = readMcpOauthState(appSupportPath);
    assert.equal(isMcpOauthServerReady(state, "cloudflare", "claude"), true);
    assert.equal(isMcpOauthServerReady(state, "cloudflare", "codex"), false);
    assert.equal(isMcpOauthServerReady(state, "cloudflare"), true);
  } finally {
    await fs.rm(appSupportPath, { recursive: true, force: true });
  }
});

test("providerLimited failure keeps a previously ready provider (no downgrade)", async () => {
  const appSupportPath = await makeTempAppSupport();
  try {
    await persistMcpOauthConnectResult({
      appSupportPath,
      result: { server: "cloudflare", provider: "claude", state: "ready", detail: "ok", checkedAt: "2026-06-10T11:00:00.000Z" },
    });
    // 사용량 한도 실패는 연결 상태 정보가 없다 — ready 유지.
    await persistMcpOauthConnectResult({
      appSupportPath,
      result: {
        server: "cloudflare",
        provider: "claude",
        state: "failed",
        detail: "사용량 한도",
        providerLimited: true,
        checkedAt: "2026-06-10T12:00:00.000Z",
      },
    });
    const state = readMcpOauthState(appSupportPath);
    assert.equal(isMcpOauthServerReady(state, "cloudflare"), true);
    assert.equal(state.servers.cloudflare.providers.claude.detail, "ok");

    // ready 기록이 없으면 한도 실패도 그대로 기록된다(첫 시도 가시성).
    await persistMcpOauthConnectResult({
      appSupportPath,
      result: {
        server: "posthog",
        provider: "claude",
        state: "failed",
        detail: "사용량 한도",
        providerLimited: true,
        checkedAt: "2026-06-10T12:00:00.000Z",
      },
    });
    assert.equal(readMcpOauthState(appSupportPath).servers.posthog.providers.claude.state, "failed");
  } finally {
    await fs.rm(appSupportPath, { recursive: true, force: true });
  }
});

test("persist ignores unknown servers, unknown providers, and progress states; read survives corrupt files", async () => {
  const appSupportPath = await makeTempAppSupport();
  try {
    assert.equal(
      await persistMcpOauthConnectResult({
        appSupportPath,
        result: { server: "github", provider: "claude", state: "ready" },
      }),
      null,
    );
    assert.equal(
      await persistMcpOauthConnectResult({
        appSupportPath,
        result: { server: "posthog", provider: "gemini", state: "ready" },
      }),
      null,
    );
    assert.equal(
      await persistMcpOauthConnectResult({
        appSupportPath,
        result: { server: "posthog", provider: "claude", state: "progress" },
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
