import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_GITHUB_MCP_URL,
  GITHUB_MCP_SERVER_NAME,
  GITHUB_MCP_TOKEN_ENV_VAR,
  applyGithubCodexEnvFromSources,
  buildGithubClaudeMcpConfigFromSources,
  buildGithubCodexMcpConfigFromSources,
  resetGithubMcpTokenCacheForTesting,
  resolveGithubMcpSettings,
} from "../sidecar/github-mcp-config.mjs";

test.beforeEach(() => {
  resetGithubMcpTokenCacheForTesting();
});

test("resolveGithubMcpSettings prefers env vars over the gh CLI token", () => {
  const settings = resolveGithubMcpSettings({
    env: { GITHUB_MCP_TOKEN: "env-token" },
    ghTokenExec: () => { throw new Error("must not call gh"); },
  });
  assert.equal(settings.token, "env-token");
  assert.equal(settings.tokenValid, true);
  assert.equal(settings.url, DEFAULT_GITHUB_MCP_URL);

  const fromPat = resolveGithubMcpSettings({
    env: { GITHUB_PERSONAL_ACCESS_TOKEN: "pat-token" },
    ghTokenExec: () => { throw new Error("must not call gh"); },
  });
  assert.equal(fromPat.token, "pat-token");
});

test("resolveGithubMcpSettings falls back to gh auth token and caches it", () => {
  let calls = 0;
  const ghTokenExec = () => {
    calls += 1;
    return "gho_cli-token\n";
  };
  const first = resolveGithubMcpSettings({ env: {}, ghTokenExec, now: 1_000 });
  assert.equal(first.token, "gho_cli-token");
  const second = resolveGithubMcpSettings({ env: {}, ghTokenExec, now: 30_000 });
  assert.equal(second.token, "gho_cli-token");
  assert.equal(calls, 1, "cached within TTL");
  resolveGithubMcpSettings({ env: {}, ghTokenExec, now: 90_000 });
  assert.equal(calls, 2, "re-resolved after TTL");
});

test("resolveGithubMcpSettings reports invalid when gh has no login", () => {
  const settings = resolveGithubMcpSettings({ env: {}, ghTokenExec: () => "" });
  assert.equal(settings.tokenValid, false);
});

test("buildGithubClaudeMcpConfigFromSources emits HTTP config only with a token", () => {
  const config = buildGithubClaudeMcpConfigFromSources({
    env: { GITHUB_MCP_TOKEN: "gho_x" },
  });
  assert.equal(config[GITHUB_MCP_SERVER_NAME].type, "http");
  assert.equal(config[GITHUB_MCP_SERVER_NAME].url, DEFAULT_GITHUB_MCP_URL);
  assert.equal(config[GITHUB_MCP_SERVER_NAME].headers.Authorization, "Bearer gho_x");

  assert.deepEqual(buildGithubClaudeMcpConfigFromSources({ env: {}, ghTokenExec: () => "" }), {});
});

test("buildGithubCodexMcpConfigFromSources uses the bearer env var indirection", () => {
  const config = buildGithubCodexMcpConfigFromSources({ env: { GITHUB_MCP_TOKEN: "gho_x" } });
  assert.equal(config[GITHUB_MCP_SERVER_NAME].bearer_token_env_var, GITHUB_MCP_TOKEN_ENV_VAR);
  assert.deepEqual(buildGithubCodexMcpConfigFromSources({ env: {}, ghTokenExec: () => "" }), {});
});

test("applyGithubCodexEnvFromSources injects the token without mutating input", () => {
  const base = { PATH: "/usr/bin" };
  const next = applyGithubCodexEnvFromSources(base, {
    env: { GITHUB_TOKEN: "gho_y" },
  });
  assert.equal(next[GITHUB_MCP_TOKEN_ENV_VAR], "gho_y");
  assert.equal(base[GITHUB_MCP_TOKEN_ENV_VAR], undefined);

  const untouched = applyGithubCodexEnvFromSources(base, { env: {}, ghTokenExec: () => "" });
  assert.equal(untouched[GITHUB_MCP_TOKEN_ENV_VAR], undefined);
});

test("custom GITHUB_MCP_URL overrides the default", () => {
  const settings = resolveGithubMcpSettings({
    env: { GITHUB_MCP_TOKEN: "x", GITHUB_MCP_URL: "https://example.com/mcp" },
  });
  assert.equal(settings.url, "https://example.com/mcp");
});
