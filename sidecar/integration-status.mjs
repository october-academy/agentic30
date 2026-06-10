import { execFile } from "node:child_process";

import { resolveCloudflareMcpSettings } from "./cloudflare-mcp-config.mjs";
import { resolvePostHogMcpSettings } from "./posthog-mcp-config.mjs";
import { resolveGithubMcpSettings } from "./github-mcp-config.mjs";

// Live integration checks for Settings > 연동. Each probe verifies the stored
// credential against the real service (gh auth status, PostHog /users/@me,
// Cloudflare /zones) so the badge means "actually works", not "field is
// non-empty". Shapes are stable: { state: ready|missing|failed, detail }.

const PROBE_TIMEOUT_MS = 10_000;

function status(state, detail) {
  return { state, detail: String(detail || "").slice(0, 200) };
}

function defaultExec(cmd, args) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: PROBE_TIMEOUT_MS, encoding: "utf8" }, (error, stdout, stderr) => {
      resolve({ ok: !error, stdout: String(stdout || ""), stderr: String(stderr || "") });
    });
  });
}

async function fetchJson(fetchImpl, url, headers) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, { headers, signal: controller.signal });
    const payload = await response.json().catch(() => null);
    return { ok: response.ok, status: response.status, payload };
  } catch (error) {
    return { ok: false, status: 0, payload: null, error: String(error?.message || error) };
  } finally {
    clearTimeout(timer);
  }
}

export async function probeGithubIntegration({ execImpl = defaultExec, env = process.env } = {}) {
  const auth = await execImpl("gh", ["auth", "status"]);
  if (!auth.ok) {
    return {
      cli: status("missing", "gh auth status 실패 — gh auth login이 필요해요."),
      mcp: status("missing", "gh 로그인 후 GitHub MCP가 자동으로 연결돼요."),
    };
  }
  const mcpSettings = resolveGithubMcpSettings({ env });
  return {
    cli: status("ready", "gh auth status 통과"),
    mcp: mcpSettings.tokenValid
      ? status("ready", "gh 토큰으로 GitHub MCP 연결됨 — AI 실행에서 GitHub 도구 사용 가능")
      : status("failed", "gh 로그인은 됐지만 gh auth token을 읽지 못했어요."),
  };
}

export async function probePosthogIntegration({
  appSupportPath = "",
  env = process.env,
  fetchImpl = fetch,
} = {}) {
  const settings = resolvePostHogMcpSettings({ env, appSupportPath });
  if (!settings.token) {
    // MCP itself is OAuth-first: the provider handles the browser login, so
    // no key is required for AI-run PostHog tools. The key only upgrades the
    // briefing drilldown numbers to direct HogQL aggregation.
    return status("oauth", "MCP는 OAuth로 동작 — AI 첫 사용 시 브라우저 로그인. phx_/pha_ 키 저장 시 드릴다운 숫자를 직접 집계해요.");
  }
  if (!settings.tokenValid) {
    return status("failed", "키는 phx_ 또는 pha_로 시작해야 해요 (phc_ 프로젝트 키는 인증 불가).");
  }
  const host = settings.region === "eu" ? "https://eu.posthog.com" : "https://us.posthog.com";
  const result = await fetchJson(fetchImpl, `${host}/api/users/@me/`, {
    Authorization: `Bearer ${settings.token}`,
  });
  if (!result.ok) {
    return status("failed", `PostHog API 검증 실패 (HTTP ${result.status || "—"}) — 키와 리전을 확인해 주세요.`);
  }
  return status("ready", `PostHog API 검증됨 · ${settings.region.toUpperCase()} — HogQL 드릴다운 직접 집계 · MCP는 OAuth(${settings.authMode === "api_key" ? "키 인증으로 전환됨" : "기본"})`);
}

export async function probeCloudflareIntegration({
  appSupportPath = "",
  env = process.env,
  fetchImpl = fetch,
} = {}) {
  const settings = resolveCloudflareMcpSettings({ env, appSupportPath });
  if (!settings.tokenValid) {
    // MCP itself is OAuth-first; the token only upgrades the briefing traffic
    // drilldown to direct GraphQL Analytics aggregation.
    return status("oauth", "MCP는 OAuth로 동작 — AI 첫 사용 시 브라우저 로그인. API 토큰 저장 시 트래픽 드릴다운 숫자를 직접 집계해요.");
  }
  const result = await fetchJson(fetchImpl, "https://api.cloudflare.com/client/v4/zones?status=active&per_page=5", {
    Authorization: `Bearer ${settings.token}`,
  });
  if (!result.ok) {
    return status("failed", `Cloudflare API 검증 실패 (HTTP ${result.status || "—"}) — 토큰 권한(Analytics Read)을 확인해 주세요.`);
  }
  const zones = Array.isArray(result.payload?.result) ? result.payload.result : [];
  if (!zones.length) {
    return status("failed", "토큰은 유효하지만 접근 가능한 존이 없어요.");
  }
  return status("ready", `존 ${zones[0].name}${zones.length > 1 ? ` 외 ${zones.length - 1}개` : ""} — GraphQL 드릴다운 직접 집계 · MCP는 OAuth(${settings.authMode === "api_key" ? "키 인증으로 전환됨" : "기본"})`);
}

export async function collectIntegrationStatus({
  appSupportPath = "",
  env = process.env,
  execImpl = defaultExec,
  fetchImpl = fetch,
  now = new Date(),
} = {}) {
  const [github, posthog, cloudflare] = await Promise.all([
    probeGithubIntegration({ execImpl, env }).catch((error) => ({
      cli: status("failed", String(error?.message || error)),
      mcp: status("failed", String(error?.message || error)),
    })),
    probePosthogIntegration({ appSupportPath, env, fetchImpl }).catch((error) =>
      status("failed", String(error?.message || error))),
    probeCloudflareIntegration({ appSupportPath, env, fetchImpl }).catch((error) =>
      status("failed", String(error?.message || error))),
  ]);
  return {
    github: github.cli,
    githubMcp: github.mcp,
    posthog,
    cloudflare,
    checkedAt: (now instanceof Date ? now : new Date(now)).toISOString(),
  };
}
