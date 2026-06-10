import { POSTHOG_MCP_SERVER_NAME } from "./posthog-mcp-config.mjs";
import { CLOUDFLARE_MCP_SERVER_NAME } from "./cloudflare-mcp-config.mjs";

// Settings > 연동 "MCP 연결" 버튼의 실체. OAuth-first MCP(PostHog/Cloudflare)는
// 프로바이더(Claude Agent SDK / Codex)가 토큰을 "자기 캐시"에 저장한다 —
// 사이드카가 mcp-remote 등으로 대신 로그인하면 토큰이 다른 캐시에 남아
// 헛수고가 된다. 그래서 연결 버튼은 대상 MCP 도구를 호출하는 최소 프로바이더
// 쿼리를 돌려서 연결을 실증한다.
//
// 실측한 OAuth 핸드셰이크 메커니즘 (Claude Agent SDK 기준):
//   미인증 서버는 실제 도구 대신 mcp__<server>__authenticate /
//   complete_authentication 플레이스홀더 2개만 노출한다. authenticate를
//   호출하면 로그인 URL이 반환되고(콜백은 그 실행이 띄운 localhost 서버),
//   사용자가 브라우저에서 완료하면 토큰이 영속 캐시에 저장된다 — 이후의 새
//   실행은 즉시 실제 도구를 본다. "첫 사용 시 자동 브라우저 로그인"이 아니라
//   명시적 authenticate 호출이 트리거다.
//
// 타이밍 레이스 대응: 사용자가 로그인을 끝낸 시점이 모델의 마지막 재시도
// "이후"면 1차 실행은 login_pending으로 끝난다(실측된 시나리오). 토큰은
// 영속되므로, 1차가 login_pending이면 짧은 간격으로 검증 전용 재확인
// (authenticate 금지 — 새 URL 발급으로 기존 로그인 흐름을 깨지 않게)을
// 자동으로 돌려 ready를 잡는다.

export const MCP_OAUTH_PREWARM_OK_SENTINEL = "MCP_PREWARM_OK";
export const MCP_OAUTH_PREWARM_FAIL_SENTINEL = "MCP_PREWARM_FAIL";
export const MCP_OAUTH_PREWARM_LOGIN_URL_SENTINEL = "MCP_PREWARM_LOGIN_URL";
export const MCP_OAUTH_PREWARM_LOGIN_PENDING_SENTINEL = "MCP_PREWARM_LOGIN_PENDING";

// OAuth 첫 연결은 사용자가 브라우저에서 손으로 로그인을 끝내야 하므로 넉넉히.
export const MCP_OAUTH_PREWARM_TIMEOUT_MS = 240_000;
export const MCP_OAUTH_PREWARM_RECHECK_DELAY_MS = 12_000;
export const MCP_OAUTH_PREWARM_VERIFY_TIMEOUT_MS = 90_000;
export const MCP_OAUTH_PREWARM_MAX_RECHECKS = 2;

export const MCP_OAUTH_PREWARM_SERVERS = {
  posthog: {
    server: "posthog",
    label: "PostHog",
    mcpServerName: POSTHOG_MCP_SERVER_NAME,
    executionMode: "mcp_oauth_prewarm_posthog",
  },
  cloudflare: {
    server: "cloudflare",
    label: "Cloudflare",
    mcpServerName: CLOUDFLARE_MCP_SERVER_NAME,
    executionMode: "mcp_oauth_prewarm_cloudflare",
  },
};

export function normalizeMcpOauthPrewarmServer(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return MCP_OAUTH_PREWARM_SERVERS[normalized] ? normalized : "";
}

function requireTarget(server) {
  const target = MCP_OAUTH_PREWARM_SERVERS[normalizeMcpOauthPrewarmServer(server)];
  if (!target) {
    throw new Error(`Unknown MCP OAuth prewarm server: ${server}`);
  }
  return target;
}

export function buildMcpOauthPrewarmPrompt(server) {
  const target = requireTarget(server);
  const name = target.mcpServerName;
  return [
    `You are connecting and verifying the "${name}" MCP server. Follow these steps exactly.`,
    `1. Discover this server's tools (tool names start with "mcp__${name}__"). If tools are deferred, load them via ToolSearch.`,
    `2. If real read-only tools are available, call exactly one cheap one (a list/get/search tool with minimal arguments). When it returns a response (even an empty list), reply with exactly: ${MCP_OAUTH_PREWARM_OK_SENTINEL}`,
    `3. If only authentication placeholder tools exist (e.g. mcp__${name}__authenticate), the server is not authorized yet. Call mcp__${name}__authenticate. It returns a login URL. Immediately output this single line so the host app can open the browser:`,
    `${MCP_OAUTH_PREWARM_LOGIN_URL_SENTINEL}: <the full login URL>`,
    `4. After emitting the login URL line, give the user time to finish the browser login — they typically need 30-60 seconds. Re-discover the server's tools (ToolSearch again) and retry step 2 up to 8 times, patiently. The OAuth redirect only works while this session is alive, so do not give up early. If the real tools appear and a call succeeds, reply ${MCP_OAUTH_PREWARM_OK_SENTINEL}.`,
    `5. If the tools are still placeholder-only after the retries, the user has not finished the browser login yet. Reply with exactly: ${MCP_OAUTH_PREWARM_LOGIN_PENDING_SENTINEL}`,
    `6. If anything fails in a way that is not a pending login (connection error, tool error, no "${name}" tools at all), reply with exactly: ${MCP_OAUTH_PREWARM_FAIL_SENTINEL}: <one-line reason in Korean>`,
    "Rules: only use ToolSearch and this server's MCP tools. Do not read or write files. Do not run shell commands. End your reply with exactly one sentinel line.",
  ].join("\n");
}

// 재확인(2차 이후) 전용: authenticate를 다시 부르면 새 URL이 발급되어 사용자가
// 진행 중인 로그인 흐름을 깨므로, 토큰 캐시가 반영됐는지 "검증만" 한다.
export function buildMcpOauthVerifyPrompt(server) {
  const target = requireTarget(server);
  const name = target.mcpServerName;
  return [
    `You are verifying that the "${name}" MCP server is now authorized. The user just finished (or is finishing) a browser OAuth login.`,
    `1. Discover this server's tools (tool names start with "mcp__${name}__"). If tools are deferred, load them via ToolSearch.`,
    `2. If real read-only tools are available, call exactly one cheap one (a list/get/search tool with minimal arguments). When it returns a response (even an empty list), reply with exactly: ${MCP_OAUTH_PREWARM_OK_SENTINEL}`,
    `3. If only authentication placeholder tools exist (e.g. mcp__${name}__authenticate), do NOT call them — calling authenticate would issue a fresh login URL and break the user's in-progress login. Reply with exactly: ${MCP_OAUTH_PREWARM_LOGIN_PENDING_SENTINEL}`,
    `4. If anything fails in a way that is not a pending login (connection error, tool error, no "${name}" tools at all), reply with exactly: ${MCP_OAUTH_PREWARM_FAIL_SENTINEL}: <one-line reason in Korean>`,
    "Rules: only use ToolSearch and this server's MCP tools. Never call authenticate or complete_authentication. Do not read or write files. Do not run shell commands. End your reply with exactly one sentinel line.",
  ].join("\n");
}

export function extractMcpOauthLoginUrl(text) {
  const match = String(text || "").match(
    new RegExp(`${MCP_OAUTH_PREWARM_LOGIN_URL_SENTINEL}\\s*:\\s*(https?://\\S+)`),
  );
  return match ? match[1] : "";
}

export function parseMcpOauthPrewarmReply(text) {
  const value = String(text || "");
  const loginUrl = extractMcpOauthLoginUrl(value);
  if (value.includes(MCP_OAUTH_PREWARM_OK_SENTINEL)) {
    return { ok: true, loginPending: false, reason: "", loginUrl };
  }
  if (value.includes(MCP_OAUTH_PREWARM_LOGIN_PENDING_SENTINEL)) {
    return { ok: false, loginPending: true, reason: "", loginUrl };
  }
  const failIndex = value.indexOf(MCP_OAUTH_PREWARM_FAIL_SENTINEL);
  if (failIndex >= 0) {
    const reason = value
      .slice(failIndex + MCP_OAUTH_PREWARM_FAIL_SENTINEL.length)
      .replace(/^[:\s-]+/, "")
      .split("\n")[0]
      .trim();
    return { ok: false, loginPending: false, reason, loginUrl };
  }
  return { ok: false, loginPending: false, reason: "", loginUrl };
}

function result(server, provider, state, detail, loginUrl = "") {
  return {
    server,
    provider,
    state,
    detail: String(detail || "").slice(0, 200),
    ...(loginUrl ? { loginUrl } : {}),
    checkedAt: new Date().toISOString(),
  };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function prewarmMcpOauth({
  server,
  provider,
  workspaceRoot,
  runProviderStreamImpl,
  onProgress,
  env = process.env,
  timeoutMs = MCP_OAUTH_PREWARM_TIMEOUT_MS,
  verifyTimeoutMs = MCP_OAUTH_PREWARM_VERIFY_TIMEOUT_MS,
  recheckDelayMs = MCP_OAUTH_PREWARM_RECHECK_DELAY_MS,
  maxRechecks = MCP_OAUTH_PREWARM_MAX_RECHECKS,
} = {}) {
  const normalized = normalizeMcpOauthPrewarmServer(server);
  const target = MCP_OAUTH_PREWARM_SERVERS[normalized];
  if (!target) {
    return result(String(server || ""), provider || "", "failed", "알 수 없는 MCP 서버예요 (posthog 또는 cloudflare).");
  }
  if (!provider) {
    return result(normalized, "", "failed", "사용 가능한 AI 프로바이더가 없어요 — Claude 또는 Codex 로그인이 필요해요.");
  }
  if (env.AGENTIC30_TEST_STUB_PROVIDER === "1") {
    // Hermetic UI tests: stub provider can't run MCP OAuth — succeed deterministically.
    return result(normalized, provider, "ready", `${target.label} MCP 연결 확인됨 (stub)`);
  }
  if (typeof runProviderStreamImpl !== "function") {
    return result(normalized, provider, "failed", "프로바이더 실행기를 사용할 수 없어요.");
  }

  const progress = (phase, detail, extra = {}) => {
    try {
      onProgress?.({ server: normalized, phase, detail, ...extra });
    } catch {
      // progress is best-effort; never let a listener break the prewarm
    }
  };

  // 로그인 URL은 전체 시도에 걸쳐 한 번만 공지 — 재확인 시도에서 새 URL이
  // 나와도 브라우저를 다시 열어 사용자의 진행 중 로그인을 깨면 안 된다.
  let loginUrlAnnounced = "";
  const announceLoginUrl = (url) => {
    if (loginUrlAnnounced || !url) return;
    loginUrlAnnounced = url;
    progress("login_url", "브라우저에서 OAuth 로그인을 완료해 주세요.", { loginUrl: url });
  };

  const runAttempt = async ({ prompt, attemptTimeoutMs }) => {
    const abortController = new AbortController();
    const timer = setTimeout(() => abortController.abort(), attemptTimeoutMs);
    let transcript = "";
    const checkLoginUrl = () => announceLoginUrl(extractMcpOauthLoginUrl(transcript));
    // authenticate 도구의 result payload에서 로그인 URL을 직접 추출 — 모델이
    // 센티널 라인을 생략해도(실측: 종종 생략함) 브라우저 오픈이 누락되지 않게.
    const authenticateCallKeys = new Set();
    try {
      await runProviderStreamImpl({
        provider,
        prompt,
        workspaceRoot,
        abortController,
        executionMode: target.executionMode,
        onTextDelta: (delta) => {
          transcript += String(delta || "");
          checkLoginUrl();
        },
        onTextReplace: (text) => {
          transcript = String(text || "");
          checkLoginUrl();
        },
        onToolEvent: (event) => {
          const toolName = String(event?.toolName || "");
          const callKey = String(event?.toolCallKey || "");
          if (event?.phase === "use") {
            if (toolName.includes("authenticate")) {
              if (callKey) authenticateCallKeys.add(callKey);
              progress("authenticating", "OAuth 로그인 URL을 발급받는 중…");
            } else if (toolName.startsWith(`mcp__${target.mcpServerName}__`)) {
              progress("tool_call", `${target.label} MCP 도구(${toolName.split("__").pop()}) 호출 중…`);
            } else if (loginUrlAnnounced) {
              // 로그인 URL 공지 이후의 도구 탐색은 "완료 확인" 단계 — 캡션이
              // "로그인을 완료해 주세요"에 멈춰 보이지 않게 진행을 알린다.
              progress("verifying", "로그인 완료 여부를 확인하는 중…");
            }
            return;
          }
          if (event?.phase === "result" && callKey && authenticateCallKeys.has(callKey)) {
            const payloadText = typeof event.payload === "string"
              ? event.payload
              : JSON.stringify(event.payload || "");
            const match = payloadText.match(/https?:\/\/[^\s"'\\]+/);
            if (match) announceLoginUrl(match[0]);
          }
        },
      });
    } catch (error) {
      if (abortController.signal.aborted) {
        return { kind: "timeout" };
      }
      return { kind: "error", message: String(error?.message || error) };
    } finally {
      clearTimeout(timer);
    }
    return { kind: "done", parsed: parseMcpOauthPrewarmReply(transcript) };
  };

  progress("provider_started", `${target.label} MCP 도구 호출로 연결을 확인하는 중… (${provider})`);
  let attempt = await runAttempt({
    prompt: buildMcpOauthPrewarmPrompt(normalized),
    attemptTimeoutMs: timeoutMs,
  });

  // 1차가 login_pending이면 토큰 영속 캐시를 믿고 자동 재확인: 사용자가
  // 로그인을 끝낸 직후라면 새 실행이 즉시 실제 도구를 본다(실측 확인).
  let rechecksUsed = 0;
  while (
    rechecksUsed < maxRechecks
    && attempt.kind === "done"
    && !attempt.parsed.ok
    && (attempt.parsed.loginPending || (loginUrlAnnounced && !attempt.parsed.reason))
  ) {
    rechecksUsed += 1;
    progress(
      "login_recheck",
      `로그인 완료를 자동으로 재확인하는 중 (${rechecksUsed}/${maxRechecks})…`,
    );
    await sleep(recheckDelayMs);
    attempt = await runAttempt({
      prompt: buildMcpOauthVerifyPrompt(normalized),
      attemptTimeoutMs: verifyTimeoutMs,
    });
  }

  if (attempt.kind === "timeout") {
    return result(
      normalized,
      provider,
      loginUrlAnnounced ? "login_pending" : "failed",
      loginUrlAnnounced
        ? `${target.label} 브라우저 로그인이 끝나지 않았어요 — 로그인 완료 후 'MCP 연결'을 다시 눌러 주세요.`
        : `${target.label} MCP 연결 확인이 시간 초과됐어요 — 다시 시도해 주세요.`,
      loginUrlAnnounced,
    );
  }
  if (attempt.kind === "error") {
    return result(normalized, provider, "failed", `${target.label} MCP 연결 확인 실패: ${attempt.message}`, loginUrlAnnounced);
  }

  const parsed = attempt.parsed;
  const loginUrl = loginUrlAnnounced || parsed.loginUrl;
  if (parsed.ok) {
    return result(normalized, provider, "ready", `${target.label} MCP 도구 호출 검증됨 — AI 실행에서 바로 사용 가능해요.`, loginUrl);
  }
  if (parsed.loginPending || (loginUrl && !parsed.reason)) {
    return result(
      normalized,
      provider,
      "login_pending",
      `${target.label} 브라우저 로그인이 필요해요 — 로그인 완료 후 'MCP 연결'을 다시 눌러 검증해 주세요.`,
      loginUrl,
    );
  }
  if (parsed.reason) {
    return result(normalized, provider, "failed", `${target.label} MCP 연결 실패: ${parsed.reason}`, loginUrl);
  }
  return result(normalized, provider, "failed", `${target.label} MCP 응답에서 확인 신호를 찾지 못했어요 — 다시 시도해 주세요.`, loginUrl);
}
