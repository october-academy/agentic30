import test from "node:test";
import assert from "node:assert/strict";

import {
  MCP_OAUTH_PREWARM_FAIL_SENTINEL,
  MCP_OAUTH_PREWARM_LOGIN_PENDING_SENTINEL,
  MCP_OAUTH_PREWARM_LOGIN_URL_SENTINEL,
  MCP_OAUTH_PREWARM_OK_SENTINEL,
  MCP_OAUTH_PREWARM_SERVERS,
  buildMcpOauthPrewarmPrompt,
  buildMcpOauthVerifyPrompt,
  extractMcpOauthLoginUrl,
  isProviderUsageLimitMessage,
  normalizeMcpOauthPrewarmServer,
  parseMcpOauthPrewarmReply,
  prewarmMcpOauth,
  providerDisplayLabel,
  resolveMcpOauthConnectProvider,
} from "../sidecar/mcp-oauth-prewarm.mjs";

test("normalizeMcpOauthPrewarmServer accepts posthog/cloudflare only", () => {
  assert.equal(normalizeMcpOauthPrewarmServer("posthog"), "posthog");
  assert.equal(normalizeMcpOauthPrewarmServer(" Cloudflare "), "cloudflare");
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
  assert.notEqual(
    MCP_OAUTH_PREWARM_SERVERS.posthog.executionMode,
    MCP_OAUTH_PREWARM_SERVERS.cloudflare.executionMode,
  );
});

test("extractMcpOauthLoginUrl pulls the URL from the sentinel line", () => {
  const url = "https://oauth.posthog.com/oauth/authorize/?code_challenge=abc";
  assert.equal(extractMcpOauthLoginUrl(`before\n${MCP_OAUTH_PREWARM_LOGIN_URL_SENTINEL}: ${url}\nafter`), url);
  assert.equal(extractMcpOauthLoginUrl("no sentinel"), "");
  assert.equal(extractMcpOauthLoginUrl(""), "");
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
    provider: "codex",
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
