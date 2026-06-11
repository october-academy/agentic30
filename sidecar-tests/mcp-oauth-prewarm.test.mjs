import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  buildCodexMcpOauthServerConfig,
  MCP_OAUTH_PREWARM_FAIL_SENTINEL,
  MCP_OAUTH_PREWARM_LOGIN_PENDING_SENTINEL,
  MCP_OAUTH_PREWARM_LOGIN_URL_SENTINEL,
  MCP_OAUTH_PREWARM_OK_SENTINEL,
  MCP_OAUTH_PREWARM_SERVERS,
  buildMcpOauthPrewarmPrompt,
  buildMcpOauthVerifyPrompt,
  extractFirstHttpUrl,
  extractMcpOauthLoginUrl,
  isProviderUsageLimitMessage,
  normalizeMcpOauthPrewarmServer,
  parseMcpOauthPrewarmReply,
  prewarmMcpOauth,
  providerDisplayLabel,
  resolveMcpOauthConnectProvider,
  runCodexMcpCommand,
  syncCodexMcpOauthServerConfig,
} from "../sidecar/mcp-oauth-prewarm.mjs";

async function withTmpDir(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-mcp-oauth-"));
  try {
    return await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test("normalizeMcpOauthPrewarmServer accepts supported OAuth MCP servers only", () => {
  assert.equal(normalizeMcpOauthPrewarmServer("posthog"), "posthog");
  assert.equal(normalizeMcpOauthPrewarmServer(" Cloudflare "), "cloudflare");
  assert.equal(normalizeMcpOauthPrewarmServer(" Vercel "), "vercel");
  assert.equal(normalizeMcpOauthPrewarmServer("github"), "");
  assert.equal(normalizeMcpOauthPrewarmServer(""), "");
  assert.equal(normalizeMcpOauthPrewarmServer(undefined), "");
});

test("resolveMcpOauthConnectProvider pins the selected provider instead of falling back", () => {
  // "MCP 연결"은 선택한 프로바이더의 토큰 캐시에 연결을 만든다 — 선택이
  // 미로그인이면 다른 프로바이더로 조용히 폴백하지 않고 명확히 실패해야 한다.
  const available = new Set(["claude"]);
  const isProviderAvailable = (provider) => available.has(provider);

  const pinned = resolveMcpOauthConnectProvider({
    requested: "Claude",
    isProviderAvailable,
    fallbackProvider: "claude",
  });
  assert.deepEqual(pinned, { provider: "claude", error: "" });

  // 선택(codex)이 미로그인 → claude가 가용해도 폴백하지 않는다.
  const unavailable = resolveMcpOauthConnectProvider({
    requested: "codex",
    isProviderAvailable,
    fallbackProvider: "claude",
  });
  assert.equal(unavailable.provider, "");
  assert.match(unavailable.error, /Codex.*로그인되어 있지 않아요/);

  // claude/codex 외(gemini 등)는 MCP prewarm 미지원 — 가용 프로바이더로 폴백.
  const geminiFallback = resolveMcpOauthConnectProvider({
    requested: "gemini",
    isProviderAvailable,
    fallbackProvider: "claude",
  });
  assert.deepEqual(geminiFallback, { provider: "claude", error: "" });

  const nothing = resolveMcpOauthConnectProvider({
    requested: "",
    isProviderAvailable,
    fallbackProvider: "",
  });
  assert.equal(nothing.provider, "");
  assert.match(nothing.error, /사용 가능한 AI 프로바이더가 없어요/);
});

test("providerDisplayLabel maps provider ids to badge labels", () => {
  assert.equal(providerDisplayLabel("claude"), "Claude");
  assert.equal(providerDisplayLabel(" CODEX "), "Codex");
  assert.equal(providerDisplayLabel("gemini"), "gemini");
  assert.equal(providerDisplayLabel(""), "—");
});

test("buildMcpOauthPrewarmPrompt targets the MCP server name and all sentinels", () => {
  const prompt = buildMcpOauthPrewarmPrompt("posthog");
  assert.ok(prompt.includes(`"${MCP_OAUTH_PREWARM_SERVERS.posthog.mcpServerName}"`));
  assert.ok(prompt.includes(MCP_OAUTH_PREWARM_OK_SENTINEL));
  assert.ok(prompt.includes(MCP_OAUTH_PREWARM_FAIL_SENTINEL));
  assert.ok(prompt.includes(MCP_OAUTH_PREWARM_LOGIN_URL_SENTINEL));
  assert.ok(prompt.includes(MCP_OAUTH_PREWARM_LOGIN_PENDING_SENTINEL));
  // 미인증 서버는 authenticate 플레이스홀더만 노출 — 프롬프트가 명시적으로
  // authenticate 호출 절차를 안내해야 OAuth가 시작된다 (실측 v2 수정).
  assert.ok(prompt.includes("mcp__posthog__authenticate"));

  const cloudflarePrompt = buildMcpOauthPrewarmPrompt("cloudflare");
  assert.ok(cloudflarePrompt.includes(`"${MCP_OAUTH_PREWARM_SERVERS.cloudflare.mcpServerName}"`));
  assert.ok(cloudflarePrompt.includes(`mcp__${MCP_OAUTH_PREWARM_SERVERS.cloudflare.mcpServerName}__authenticate`));

  const vercelPrompt = buildMcpOauthPrewarmPrompt("vercel");
  assert.ok(vercelPrompt.includes(`"${MCP_OAUTH_PREWARM_SERVERS.vercel.mcpServerName}"`));
  assert.ok(vercelPrompt.includes(`mcp__${MCP_OAUTH_PREWARM_SERVERS.vercel.mcpServerName}__authenticate`));
  assert.throws(() => buildMcpOauthPrewarmPrompt("github"));
});

test("buildMcpOauthVerifyPrompt forbids authenticate and keeps sentinels", () => {
  // 재확인 시도에서 authenticate를 다시 부르면 새 로그인 URL이 발급되어
  // 사용자의 진행 중 로그인 흐름이 깨진다 — 검증 전용 프롬프트의 핵심 계약.
  const prompt = buildMcpOauthVerifyPrompt("posthog");
  assert.ok(prompt.includes("Never call authenticate"));
  assert.ok(prompt.includes("do NOT call them"));
  assert.ok(prompt.includes(MCP_OAUTH_PREWARM_OK_SENTINEL));
  assert.ok(prompt.includes(MCP_OAUTH_PREWARM_LOGIN_PENDING_SENTINEL));
  assert.ok(prompt.includes(MCP_OAUTH_PREWARM_FAIL_SENTINEL));
  assert.throws(() => buildMcpOauthVerifyPrompt("github"));
});

test("prewarm executionModes inject only the target MCP server", () => {
  // provider-runner gating contract: one prewarm mode per server, and the modes
  // must not collide so connecting posthog never triggers cloudflare OAuth.
  assert.equal(MCP_OAUTH_PREWARM_SERVERS.posthog.executionMode, "mcp_oauth_prewarm_posthog");
  assert.equal(MCP_OAUTH_PREWARM_SERVERS.cloudflare.executionMode, "mcp_oauth_prewarm_cloudflare");
  assert.equal(MCP_OAUTH_PREWARM_SERVERS.vercel.executionMode, "mcp_oauth_prewarm_vercel");
  assert.equal(
    new Set(Object.values(MCP_OAUTH_PREWARM_SERVERS).map((server) => server.executionMode)).size,
    Object.values(MCP_OAUTH_PREWARM_SERVERS).length,
  );
});

test("extractMcpOauthLoginUrl pulls the URL from the sentinel line", () => {
  const url = "https://oauth.posthog.com/oauth/authorize/?code_challenge=abc";
  assert.equal(extractMcpOauthLoginUrl(`before\n${MCP_OAUTH_PREWARM_LOGIN_URL_SENTINEL}: ${url}\nafter`), url);
  assert.equal(extractMcpOauthLoginUrl("no sentinel"), "");
  assert.equal(extractMcpOauthLoginUrl(""), "");
});

test("extractFirstHttpUrl pulls plain Codex CLI login URLs", () => {
  assert.equal(
    extractFirstHttpUrl("Open this URL:\nhttps://auth.openai.com/oauth/authorize?state=abc.\n"),
    "https://auth.openai.com/oauth/authorize?state=abc",
  );
  assert.equal(extractFirstHttpUrl("no url"), "");
});

test("parseMcpOauthPrewarmReply detects all sentinels", () => {
  assert.deepEqual(
    parseMcpOauthPrewarmReply(`done\n${MCP_OAUTH_PREWARM_OK_SENTINEL}`),
    { ok: true, loginPending: false, reason: "", loginUrl: "" },
  );
  assert.deepEqual(
    parseMcpOauthPrewarmReply(`${MCP_OAUTH_PREWARM_FAIL_SENTINEL}: 인증 필요`),
    { ok: false, loginPending: false, reason: "인증 필요", loginUrl: "" },
  );
  const pending = parseMcpOauthPrewarmReply(
    `${MCP_OAUTH_PREWARM_LOGIN_URL_SENTINEL}: https://oauth.example.com/x\n${MCP_OAUTH_PREWARM_LOGIN_PENDING_SENTINEL}`,
  );
  assert.equal(pending.loginPending, true);
  assert.equal(pending.loginUrl, "https://oauth.example.com/x");
  assert.deepEqual(
    parseMcpOauthPrewarmReply("그냥 텍스트"),
    { ok: false, loginPending: false, reason: "", loginUrl: "" },
  );
});

test("prewarmMcpOauth returns ready when the model confirms a tool call", async () => {
  let seen = null;
  const progress = [];
  const result = await prewarmMcpOauth({
    server: "posthog",
    provider: "claude",
    workspaceRoot: "/tmp/ws",
    env: {},
    onProgress: (update) => progress.push(update),
    runProviderStreamImpl: async (args) => {
      seen = args;
      args.onToolEvent({ phase: "use", toolName: "mcp__posthog__get-organizations" });
      args.onTextDelta(MCP_OAUTH_PREWARM_OK_SENTINEL);
      return { runtime: {} };
    },
  });
  assert.equal(result.state, "ready");
  assert.equal(result.server, "posthog");
  assert.equal(result.provider, "claude");
  assert.ok(result.detail.includes("PostHog"));
  assert.ok(result.checkedAt);
  assert.equal(seen.executionMode, "mcp_oauth_prewarm_posthog");
  assert.equal(seen.workspaceRoot, "/tmp/ws");
  assert.ok(seen.abortController instanceof AbortController);
  assert.equal(progress[0].phase, "provider_started");
  assert.ok(progress.some((update) => update.phase === "tool_call"));
});

test("prewarmMcpOauth streams the login URL and lands on login_pending", async () => {
  const url = "https://oauth.posthog.com/oauth/authorize/?state=xyz";
  const progress = [];
  const result = await prewarmMcpOauth({
    server: "posthog",
    provider: "claude",
    env: {},
    maxRechecks: 0,
    onProgress: (update) => progress.push(update),
    runProviderStreamImpl: async (args) => {
      args.onToolEvent({ phase: "use", toolName: "mcp__posthog__authenticate" });
      // The login URL must surface mid-stream (so the app can open the browser
      // while the run is still alive), not only in the final transcript.
      args.onTextDelta(`${MCP_OAUTH_PREWARM_LOGIN_URL_SENTINEL}: ${url}\n`);
      args.onTextDelta(MCP_OAUTH_PREWARM_LOGIN_PENDING_SENTINEL);
    },
  });
  assert.equal(result.state, "login_pending");
  assert.equal(result.loginUrl, url);
  assert.ok(result.detail.includes("로그인"));
  assert.ok(progress.some((update) => update.phase === "authenticating"));
  const loginEvent = progress.find((update) => update.phase === "login_url");
  assert.ok(loginEvent);
  assert.equal(loginEvent.loginUrl, url);
  // URL은 한 번만 공지 — 같은 URL로 브라우저가 반복해서 열리면 안 된다.
  assert.equal(progress.filter((update) => update.phase === "login_url").length, 1);
});

test("prewarmMcpOauth extracts the login URL from the authenticate tool result", async () => {
  // 실측: 모델이 MCP_PREWARM_LOGIN_URL 센티널 라인을 종종 생략한다 — authenticate
  // 도구의 result payload에서 URL을 직접 추출해야 브라우저 오픈이 누락되지 않는다.
  const url = "https://oauth.posthog.com/oauth/authorize/?state=fromtool";
  const progress = [];
  const result = await prewarmMcpOauth({
    server: "posthog",
    provider: "claude",
    env: {},
    maxRechecks: 0,
    onProgress: (update) => progress.push(update),
    runProviderStreamImpl: async (args) => {
      args.onToolEvent({ phase: "use", toolName: "mcp__posthog__authenticate", toolCallKey: "toolu_1" });
      args.onToolEvent({
        phase: "result",
        toolName: "toolu_1",
        toolCallKey: "toolu_1",
        payload: `Ask the user to open this URL in their browser:\n\n${url}\n\nOnce they complete the flow...`,
      });
      args.onTextDelta(MCP_OAUTH_PREWARM_LOGIN_PENDING_SENTINEL);
    },
  });
  assert.equal(result.state, "login_pending");
  assert.equal(result.loginUrl, url);
  const loginEvent = progress.find((update) => update.phase === "login_url");
  assert.equal(loginEvent?.loginUrl, url);
});

test("prewarmMcpOauth auto-rechecks after login_pending and lands on ready", async () => {
  // 실측 레이스: 사용자가 로그인을 끝낸 시점이 1차 실행의 마지막 재시도
  // "이후"면 1차는 login_pending — 토큰은 영속되므로 자동 재확인이 잡아야 한다.
  const url = "https://oauth.posthog.com/oauth/authorize/?state=race";
  const prompts = [];
  const progress = [];
  const result = await prewarmMcpOauth({
    server: "posthog",
    provider: "claude",
    env: {},
    recheckDelayMs: 0,
    onProgress: (update) => progress.push(update),
    runProviderStreamImpl: async (args) => {
      prompts.push(args.prompt);
      if (prompts.length === 1) {
        args.onTextDelta(`${MCP_OAUTH_PREWARM_LOGIN_URL_SENTINEL}: ${url}\n`);
        args.onTextDelta(MCP_OAUTH_PREWARM_LOGIN_PENDING_SENTINEL);
        return;
      }
      args.onToolEvent({ phase: "use", toolName: "mcp__posthog__get-organizations" });
      args.onTextDelta(MCP_OAUTH_PREWARM_OK_SENTINEL);
    },
  });
  assert.equal(result.state, "ready");
  assert.equal(result.loginUrl, url);
  assert.equal(prompts.length, 2);
  // 재확인은 검증 전용 프롬프트 — authenticate 재호출(새 URL 발급) 금지.
  assert.ok(prompts[1].includes("Never call authenticate"));
  assert.ok(progress.some((update) => update.phase === "login_recheck"));
  assert.equal(progress.filter((update) => update.phase === "login_url").length, 1);
});

test("prewarmMcpOauth uses Codex CLI MCP login flow instead of provider ToolSearch", async () => {
  await withTmpDir(async (codexHome) => {
    const calls = [];
    let providerStreamCalled = false;
    const result = await prewarmMcpOauth({
      server: "posthog",
      provider: "codex",
      workspaceRoot: "/tmp/ws",
      env: {},
      buildCodexEnvImpl: () => ({ CODEX_HOME: codexHome, PATH: "/bin" }),
      resolveCodexBinaryPathImpl: () => "/usr/local/bin/codex",
      runProviderStreamImpl: async () => {
        providerStreamCalled = true;
      },
      runCodexMcpCommandImpl: async ({ args, cwd, onOutput }) => {
        calls.push({ args, cwd });
        if (args[1] === "get" && calls.length === 1) {
          return { exitCode: 1, stdout: "", stderr: "not found" };
        }
        if (args[1] === "add") {
          return { exitCode: 0, stdout: "Added posthog", stderr: "" };
        }
        if (args[1] === "login") {
          onOutput("Open this URL in your browser: https://oauth.posthog.com/authorize?state=abc\n");
          return { exitCode: 0, stdout: "Successfully logged in.", stderr: "" };
        }
        return { exitCode: 0, stdout: "{\"name\":\"posthog\"}", stderr: "" };
      },
    });

    assert.equal(result.state, "ready");
    assert.equal(result.provider, "codex");
    assert.equal(result.loginUrl, "https://oauth.posthog.com/authorize?state=abc");
    assert.equal(providerStreamCalled, false);
    assert.deepEqual(calls.map((call) => call.args.slice(0, 3)), [
      ["mcp", "get", "posthog"],
      ["mcp", "add", "posthog"],
      ["mcp", "login", "posthog"],
      ["mcp", "get", "posthog"],
    ]);
    assert.ok(calls.every((call) => call.cwd === "/tmp/ws"));

    const codexConfig = await fs.readFile(path.join(codexHome, "config.toml"), "utf8");
    assert.match(codexConfig, /\[mcp_servers\.posthog\]/);
    assert.match(codexConfig, /url = "https:\/\/mcp\.posthog\.com\/mcp\?/);
    assert.doesNotMatch(codexConfig, /bearer_token_env_var = "undefined"/);
  });
});

test("prewarmMcpOauth registers Cloudflare with oauth_resource for Codex", async () => {
  await withTmpDir(async (codexHome) => {
    const calls = [];
    const result = await prewarmMcpOauth({
      server: "cloudflare",
      provider: "codex",
      env: {},
      buildCodexEnvImpl: () => ({ CODEX_HOME: codexHome, PATH: "/bin" }),
      resolveCodexBinaryPathImpl: () => "/usr/local/bin/codex",
      runCodexMcpCommandImpl: async ({ args }) => {
        calls.push(args);
        if (args[1] === "get" && calls.length === 1) {
          return { exitCode: 1, stdout: "", stderr: "not found" };
        }
        return { exitCode: 0, stdout: "ok", stderr: "" };
      },
    });

    assert.equal(result.state, "ready");
    const addCall = calls.find((args) => args[1] === "add");
    assert.ok(addCall);
    assert.deepEqual(addCall.slice(0, 5), ["mcp", "add", "cloudflare-api", "--url", "https://mcp.cloudflare.com/mcp"]);
    assert.equal(addCall[addCall.indexOf("--oauth-resource") + 1], "https://mcp.cloudflare.com/mcp");

    const codexConfig = await fs.readFile(path.join(codexHome, "config.toml"), "utf8");
    assert.match(codexConfig, /\[mcp_servers\.cloudflare-api\]/);
    assert.match(codexConfig, /oauth_resource = "https:\/\/mcp\.cloudflare\.com\/mcp"/);
  });
});

test("prewarmMcpOauth reports Codex login URL timeout as login_pending", async () => {
  await withTmpDir(async (codexHome) => {
    const result = await prewarmMcpOauth({
      server: "posthog",
      provider: "codex",
      env: {},
      buildCodexEnvImpl: () => ({ CODEX_HOME: codexHome, PATH: "/bin" }),
      resolveCodexBinaryPathImpl: () => "/usr/local/bin/codex",
      runCodexMcpCommandImpl: async ({ args, onOutput }) => {
        if (args[1] === "get" && args[2] === "posthog") {
          return { exitCode: args.includes("--json") ? 0 : 1, stdout: "{}", stderr: "" };
        }
        if (args[1] === "login") {
          onOutput("Visit https://oauth.posthog.com/authorize?state=pending to authenticate\n");
          return { exitCode: null, timedOut: true, stdout: "", stderr: "" };
        }
        return { exitCode: 0, stdout: "ok", stderr: "" };
      },
    });

    assert.equal(result.state, "login_pending");
    assert.equal(result.loginUrl, "https://oauth.posthog.com/authorize?state=pending");
    assert.match(result.detail, /로그인/);
  });
});

test("runCodexMcpCommand backgrounds a Codex OAuth login after the URL is emitted", async () => {
  const kills = [];
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.pid = 987654321;
  child.kill = (signal) => {
    kills.push(signal);
    return true;
  };
  const resultPromise = runCodexMcpCommand({
    codexPath: "/usr/local/bin/codex",
    args: ["mcp", "login", "posthog"],
    env: {},
    cwd: "/tmp",
    timeoutMs: 10_000,
    spawnImpl: () => {
      setImmediate(() => {
        child.stdout.emit("data", "Open https://oauth.posthog.com/authorize?state=fast\n");
      });
      return child;
    },
    stopWhen: ({ stdout }) => stdout.includes("https://oauth.posthog.com/authorize"),
    backgroundOnStop: true,
  });

  const result = await resultPromise;
  assert.equal(result.backgrounded, true);
  assert.equal(result.signal, null);
  assert.match(result.stdout, /oauth\.posthog\.com/);
  assert.deepEqual(kills, []);
  child.emit("close", 0, null);
});

test("prewarmMcpOauth Codex api_key mode writes env var config and skips OAuth login", async () => {
  await withTmpDir(async (codexHome) => {
    const calls = [];
    const result = await prewarmMcpOauth({
      server: "posthog",
      provider: "codex",
      env: {
        POSTHOG_MCP_AUTH_MODE: "api_key",
        POSTHOG_MCP_API_KEY: "phx_secret",
      },
      buildCodexEnvImpl: (env) => ({ ...env, CODEX_HOME: codexHome, PATH: "/bin" }),
      resolveCodexBinaryPathImpl: () => "/usr/local/bin/codex",
      runCodexMcpCommandImpl: async ({ args }) => {
        calls.push(args);
        if (args[1] === "get" && calls.length === 1) {
          return { exitCode: 1, stdout: "", stderr: "not found" };
        }
        return { exitCode: 0, stdout: "ok", stderr: "" };
      },
    });

    assert.equal(result.state, "ready");
    assert.equal(calls.some((args) => args[1] === "login"), false);
    const addCall = calls.find((args) => args[1] === "add");
    assert.equal(addCall[addCall.indexOf("--bearer-token-env-var") + 1], "POSTHOG_MCP_API_KEY");

    const codexConfig = await fs.readFile(path.join(codexHome, "config.toml"), "utf8");
    assert.match(codexConfig, /bearer_token_env_var = "POSTHOG_MCP_API_KEY"/);
    assert.equal(codexConfig.includes("phx_secret"), false);
  });
});

test("syncCodexMcpOauthServerConfig preserves existing Codex servers and replaces target only", async () => {
  await withTmpDir(async (codexHome) => {
    const configPath = path.join(codexHome, "config.toml");
    await fs.writeFile(configPath, [
      "notify = []",
      "",
      "[mcp_servers.\"cloudflare-api\"]",
      "url = \"https://old.example/mcp\"",
      "",
      "[mcp_servers.exa]",
      "url = \"https://mcp.exa.ai/mcp\"",
      "",
    ].join("\n"));

    const syncResult = await syncCodexMcpOauthServerConfig({
      server: "cloudflare",
      codexHome,
      env: {},
    });

    assert.equal(syncResult.changed, true);
    assert.equal(syncResult.authMode, "oauth");
    const codexConfig = await fs.readFile(configPath, "utf8");
    assert.match(codexConfig, /\[mcp_servers\.exa\]/);
    assert.match(codexConfig, /\[mcp_servers\.cloudflare-api\]/);
    assert.match(codexConfig, /oauth_resource = "https:\/\/mcp\.cloudflare\.com\/mcp"/);
    assert.doesNotMatch(codexConfig, /old\.example/);
  });
});

test("syncCodexMcpOauthServerConfig writes Vercel URL-only config without touching other servers", async () => {
  await withTmpDir(async (codexHome) => {
    const configPath = path.join(codexHome, "config.toml");
    await fs.writeFile(configPath, [
      "notify = []",
      "",
      "[mcp_servers.vercel]",
      "url = \"https://old.example/mcp\"",
      "",
      "[mcp_servers.exa]",
      "url = \"https://mcp.exa.ai/mcp\"",
      "",
    ].join("\n"));

    const syncResult = await syncCodexMcpOauthServerConfig({
      server: "vercel",
      codexHome,
      env: { VERCEL_MCP_URL: "https://custom.example/mcp" },
    });

    assert.equal(syncResult.changed, true);
    assert.equal(syncResult.authMode, "oauth");
    const codexConfig = await fs.readFile(configPath, "utf8");
    assert.match(codexConfig, /\[mcp_servers\.exa\]/);
    assert.match(codexConfig, /\[mcp_servers\.vercel\]/);
    assert.match(codexConfig, /url = "https:\/\/mcp\.vercel\.com"/);
    assert.doesNotMatch(codexConfig, /old\.example/);
    assert.doesNotMatch(codexConfig, /custom\.example/);
    assert.doesNotMatch(codexConfig, /oauth_resource/);
    assert.doesNotMatch(codexConfig, /bearer_token_env_var/);
  });
});

test("buildCodexMcpOauthServerConfig keeps Cloudflare oauth_resource, Vercel fixed URL, and PostHog api-key env indirection", () => {
  const cloudflare = buildCodexMcpOauthServerConfig({ server: "cloudflare", env: {} });
  assert.equal(cloudflare.config.oauth_resource, "https://mcp.cloudflare.com/mcp");
  assert.equal(cloudflare.authMode, "oauth");

  const vercel = buildCodexMcpOauthServerConfig({
    server: "vercel",
    env: { VERCEL_MCP_URL: "https://custom.example/mcp" },
  });
  assert.equal(vercel.authMode, "oauth");
  assert.equal(vercel.config.url, "https://mcp.vercel.com");
  assert.equal(vercel.config.oauth_resource, undefined);
  assert.equal(vercel.config.bearer_token_env_var, undefined);

  const posthogApiKey = buildCodexMcpOauthServerConfig({
    server: "posthog",
    env: {
      POSTHOG_MCP_AUTH_MODE: "api_key",
      POSTHOG_MCP_API_KEY: "phx_secret",
    },
  });
  assert.equal(posthogApiKey.authMode, "api_key");
  assert.equal(posthogApiKey.config.bearer_token_env_var, "POSTHOG_MCP_API_KEY");
  assert.equal(JSON.stringify(posthogApiKey.config).includes("phx_secret"), false);
});

test("prewarmMcpOauth exhausts rechecks and reports login_pending", async () => {
  const url = "https://oauth.posthog.com/oauth/authorize/?state=slow";
  let calls = 0;
  const result = await prewarmMcpOauth({
    server: "posthog",
    provider: "claude",
    env: {},
    recheckDelayMs: 0,
    maxRechecks: 2,
    runProviderStreamImpl: async (args) => {
      calls += 1;
      if (calls === 1) {
        args.onTextDelta(`${MCP_OAUTH_PREWARM_LOGIN_URL_SENTINEL}: ${url}\n`);
      }
      args.onTextDelta(MCP_OAUTH_PREWARM_LOGIN_PENDING_SENTINEL);
    },
  });
  assert.equal(calls, 3);
  assert.equal(result.state, "login_pending");
  assert.equal(result.loginUrl, url);
});

test("prewarmMcpOauth emits verifying progress for non-MCP tools after login url", async () => {
  const url = "https://oauth.posthog.com/oauth/authorize/?state=verify";
  const progress = [];
  await prewarmMcpOauth({
    server: "posthog",
    provider: "claude",
    env: {},
    maxRechecks: 0,
    onProgress: (update) => progress.push(update),
    runProviderStreamImpl: async (args) => {
      args.onToolEvent({ phase: "use", toolName: "ToolSearch" });
      args.onTextDelta(`${MCP_OAUTH_PREWARM_LOGIN_URL_SENTINEL}: ${url}\n`);
      args.onToolEvent({ phase: "use", toolName: "ToolSearch" });
      args.onTextDelta(MCP_OAUTH_PREWARM_LOGIN_PENDING_SENTINEL);
    },
  });
  // URL 공지 전의 ToolSearch는 조용히, 공지 후엔 "확인 중" 진행을 알린다.
  assert.ok(progress.some((update) => update.phase === "verifying"));
  const verifyIndex = progress.findIndex((update) => update.phase === "verifying");
  const loginIndex = progress.findIndex((update) => update.phase === "login_url");
  assert.ok(loginIndex >= 0 && verifyIndex > loginIndex);
});

test("prewarmMcpOauth treats timeout-after-login-url as login_pending", async () => {
  const url = "https://oauth.example.com/authorize";
  const result = await prewarmMcpOauth({
    server: "cloudflare",
    provider: "claude",
    env: {},
    timeoutMs: 20,
    runProviderStreamImpl: async ({ abortController, onTextDelta }) => {
      onTextDelta(`${MCP_OAUTH_PREWARM_LOGIN_URL_SENTINEL}: ${url}\n`);
      return new Promise((_, reject) => {
        abortController.signal.addEventListener("abort", () => reject(new Error("aborted")));
      });
    },
  });
  assert.equal(result.state, "login_pending");
  assert.equal(result.loginUrl, url);
  assert.ok(result.detail.includes("다시 눌러"));
});

test("prewarmMcpOauth surfaces model-reported failure reason", async () => {
  const result = await prewarmMcpOauth({
    server: "cloudflare",
    provider: "claude",
    env: {},
    runProviderStreamImpl: async (args) => {
      args.onTextReplace(`${MCP_OAUTH_PREWARM_FAIL_SENTINEL}: 연결 오류`);
    },
  });
  assert.equal(result.state, "failed");
  assert.ok(result.detail.includes("연결 오류"));
});

test("prewarmMcpOauth fails closed without sentinel, on throw, and on timeout", async () => {
  const noSentinel = await prewarmMcpOauth({
    server: "posthog",
    provider: "claude",
    env: {},
    runProviderStreamImpl: async (args) => {
      args.onTextDelta("관련 없는 응답");
    },
  });
  assert.equal(noSentinel.state, "failed");
  assert.ok(noSentinel.detail.includes("확인 신호"));

  const thrown = await prewarmMcpOauth({
    server: "posthog",
    provider: "claude",
    env: {},
    runProviderStreamImpl: async () => {
      throw new Error("codex binary missing");
    },
  });
  assert.equal(thrown.state, "failed");
  assert.ok(thrown.detail.includes("codex binary missing"));

  const timedOut = await prewarmMcpOauth({
    server: "posthog",
    provider: "claude",
    env: {},
    timeoutMs: 10,
    runProviderStreamImpl: async ({ abortController }) =>
      new Promise((_, reject) => {
        abortController.signal.addEventListener("abort", () => reject(new Error("aborted")));
      }),
  });
  assert.equal(timedOut.state, "failed");
  assert.ok(timedOut.detail.includes("시간 초과"));
});

test("isProviderUsageLimitMessage recognizes provider quota errors only", () => {
  assert.equal(isProviderUsageLimitMessage("Claude Code returned an error result: You've hit your session limit · resets 10:40pm (Asia/Seoul)"), true);
  assert.equal(isProviderUsageLimitMessage("You've hit your usage limit. Your limit resets at 9pm."), true);
  assert.equal(isProviderUsageLimitMessage("Rate limit exceeded"), true);
  assert.equal(isProviderUsageLimitMessage("insufficient_quota"), true);
  assert.equal(isProviderUsageLimitMessage("codex binary missing"), false);
  assert.equal(isProviderUsageLimitMessage(""), false);
});

test("prewarmMcpOauth marks provider usage-limit errors as providerLimited", async () => {
  const limited = await prewarmMcpOauth({
    server: "cloudflare",
    provider: "claude",
    env: {},
    runProviderStreamImpl: async () => {
      throw new Error("Claude Code returned an error result: You've hit your session limit · resets 10:40pm (Asia/Seoul)");
    },
  });
  assert.equal(limited.state, "failed");
  assert.equal(limited.providerLimited, true);
  assert.ok(limited.detail.includes("사용량 한도"));
  assert.ok(limited.detail.includes("연결 문제 아님"));

  const plainError = await prewarmMcpOauth({
    server: "cloudflare",
    provider: "claude",
    env: {},
    runProviderStreamImpl: async () => {
      throw new Error("codex binary missing");
    },
  });
  assert.equal(plainError.providerLimited, undefined);
});

test("prewarmMcpOauth rejects unknown server and missing provider", async () => {
  const unknown = await prewarmMcpOauth({ server: "github", provider: "claude", env: {} });
  assert.equal(unknown.state, "failed");

  const noProvider = await prewarmMcpOauth({ server: "posthog", provider: "", env: {} });
  assert.equal(noProvider.state, "failed");
  assert.ok(noProvider.detail.includes("프로바이더"));
});

test("prewarmMcpOauth never lets a broken onProgress listener break the run", async () => {
  const result = await prewarmMcpOauth({
    server: "posthog",
    provider: "claude",
    env: {},
    onProgress: () => {
      throw new Error("listener bug");
    },
    runProviderStreamImpl: async (args) => {
      args.onTextDelta(MCP_OAUTH_PREWARM_OK_SENTINEL);
    },
  });
  assert.equal(result.state, "ready");
});

test("prewarmMcpOauth short-circuits under the hermetic stub provider", async () => {
  const result = await prewarmMcpOauth({
    server: "posthog",
    provider: "claude",
    env: { AGENTIC30_TEST_STUB_PROVIDER: "1" },
    runProviderStreamImpl: async () => {
      throw new Error("must not be called");
    },
  });
  assert.equal(result.state, "ready");
  assert.ok(result.detail.includes("stub"));
});
