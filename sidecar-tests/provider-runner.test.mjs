import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  DEFAULT_CLAUDE_MODEL,
  allowsProviderPermissionBypass,
  buildGeminiEnv,
  CODEX_BINARY_NOT_INSTALLED_ERROR_CODE,
  buildCodexConfig,
  buildCodexEnv,
  buildProviderEnv,
  buildSystemPromptText,
  codexSandboxForExecution,
  extractClaudePartialText,
  getProviderAuthState,
  getProviderConnectionState,
  isCodexContextOverflowError,
  isCodexRecoverableThreadResumeError,
  isClaudeOfficeHoursDigestUnsafeTool,
  isClaudeMutatingTool,
  mapCodexItemToToolEvent,
  parseProviderEnvironment,
  resetProviderSettingsForTest,
  resolveClaudeModel,
  resolveCodexBinaryPath,
  resolveCodexCli,
  resolveCodexModel,
  resolveCodexReasoningEffort,
  resolveGeminiModel,
  shouldResumeCodexThread,
  updateProviderSettings,
} from "../sidecar/provider-runner.mjs";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { POSTHOG_MCP_TOKEN_ENV_VAR } from "../sidecar/posthog-mcp-config.mjs";
import { CLOUDFLARE_MCP_TOKEN_ENV_VAR } from "../sidecar/cloudflare-mcp-config.mjs";

test("test stub provider bypasses local provider auth checks", () => {
  const previous = process.env.AGENTIC30_TEST_STUB_PROVIDER;
  process.env.AGENTIC30_TEST_STUB_PROVIDER = "1";
  try {
    const state = getProviderAuthState("codex");
    assert.equal(state.available, true);
    assert.equal(state.source, "test-stub");
  } finally {
    if (previous === undefined) {
      delete process.env.AGENTIC30_TEST_STUB_PROVIDER;
    } else {
      process.env.AGENTIC30_TEST_STUB_PROVIDER = previous;
    }
  }
});

test("provider connection state reports SDK and CLI entrypoint health", () => {
  const claude = getProviderConnectionState("claude");
  const codex = getProviderConnectionState("codex");
  const gemini = getProviderConnectionState("gemini");

  assert.equal(claude.sdk.packageName, "@anthropic-ai/claude-agent-sdk");
  assert.equal(claude.sdk.available, true);
  assert.match(claude.sdk.entrypointPath, /@anthropic-ai\/claude-agent-sdk\/cli\.js$/);
  assert.match(claude.sdk.version, /^\d+\.\d+\.\d+/);

  assert.equal(codex.sdk.packageName, "@openai/codex-sdk");
  assert.equal(codex.sdk.available, true);
  assert.equal(codex.sdk.cliPath, codex.sdk.entrypointPath);
  assert.ok(["env", "shell", "common-path", "bundled"].includes(codex.sdk.cliSource));
  assert.match(codex.sdk.cliPath, /codex(?:\.exe)?$/);
  assert.equal(codex.sdk.minimumVersionSatisfied, true);
  assert.match(codex.sdk.version, /^\d+\.\d+\.\d+/);

  assert.equal(gemini.sdk.packageName, "@google/genai");
  assert.equal(gemini.sdk.available, true);
  assert.match(gemini.sdk.entrypointPath, /@google\/genai\/package\.json$/);
  assert.match(gemini.sdk.version, /^\d+\.\d+\.\d+/);
});

test("Claude local login session takes precedence over ANTHROPIC_API_KEY", async () => {
  const previousHome = process.env.HOME;
  const previousApiKey = process.env.ANTHROPIC_API_KEY;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-claude-home-"));
  try {
    process.env.HOME = dir;
    process.env.ANTHROPIC_API_KEY = "stale-api-key";
    await fs.writeFile(
      path.join(dir, ".claude.json"),
      JSON.stringify({ oauthAccount: { emailAddress: "user@example.com" } }),
    );

    const state = getProviderAuthState("claude");

    assert.equal(state.available, true);
    assert.equal(state.source, "local-session");
    assert.equal(state.message, "Local Claude login session");
  } finally {
    restoreEnv("HOME", previousHome);
    restoreEnv("ANTHROPIC_API_KEY", previousApiKey);
  }
});

test("Gemini auth state detects API key settings", () => {
  resetProviderSettingsForTest();
  try {
    updateProviderSettings({
      gemini: {
        authMode: "api_key",
        apiKey: "gemini-secret",
      },
    });

    const state = getProviderAuthState("gemini");
    const env = buildGeminiEnv({ PATH: "/usr/bin", HOME: "/tmp/home" });

    assert.equal(state.available, true);
    assert.equal(state.source, "api-key");
    assert.equal(env.GEMINI_API_KEY, "gemini-secret");
    assert.equal(env.GOOGLE_API_KEY, "gemini-secret");
  } finally {
    resetProviderSettingsForTest();
  }
});

test("Gemini auth state detects Vertex AI environment settings", () => {
  resetProviderSettingsForTest();
  try {
    updateProviderSettings({
      gemini: {
        authMode: "vertex",
        environment: [
          "GOOGLE_GENAI_USE_VERTEXAI=true",
          "GOOGLE_CLOUD_PROJECT=agentic30-test",
          "GOOGLE_CLOUD_LOCATION=us-central1",
        ].join("\n"),
      },
    });

    const state = getProviderAuthState("gemini");
    const env = buildGeminiEnv({ PATH: "/usr/bin", HOME: "/tmp/home" });

    assert.equal(state.available, true);
    assert.equal(state.source, "vertex");
    assert.equal(env.GOOGLE_GENAI_USE_VERTEXAI, "true");
    assert.equal(env.GOOGLE_CLOUD_PROJECT, "agentic30-test");
  } finally {
    resetProviderSettingsForTest();
  }
});

test("Gemini auth state detects local ADC credentials (gcloud)", async () => {
  const previousHome = process.env.HOME;
  const previousGeminiApiKey = process.env.GEMINI_API_KEY;
  const previousGoogleApiKey = process.env.GOOGLE_API_KEY;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-gemini-home-"));
  try {
    resetProviderSettingsForTest();
    process.env.HOME = dir;
    delete process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_API_KEY;
    await fs.mkdir(path.join(dir, ".config", "gcloud"), { recursive: true });
    await fs.writeFile(
      path.join(dir, ".config", "gcloud", "application_default_credentials.json"),
      JSON.stringify({ type: "authorized_user", refresh_token: "token" }),
    );

    const state = getProviderAuthState("gemini");

    assert.equal(state.available, true);
    assert.equal(state.source, "local-session");
    assert.match(state.message, /Application Default Credentials/);
  } finally {
    resetProviderSettingsForTest();
    restoreEnv("HOME", previousHome);
    restoreEnv("GEMINI_API_KEY", previousGeminiApiKey);
    restoreEnv("GOOGLE_API_KEY", previousGoogleApiKey);
  }
});

test("Gemini auth state reports missing auth when no markers or secrets exist", async () => {
  const previousHome = process.env.HOME;
  const previousGeminiApiKey = process.env.GEMINI_API_KEY;
  const previousGoogleApiKey = process.env.GOOGLE_API_KEY;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-gemini-empty-home-"));
  try {
    resetProviderSettingsForTest();
    process.env.HOME = dir;
    delete process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_API_KEY;

    const state = getProviderAuthState("gemini");

    assert.equal(state.available, false);
    assert.equal(state.source, "missing");
  } finally {
    resetProviderSettingsForTest();
    restoreEnv("HOME", previousHome);
    restoreEnv("GEMINI_API_KEY", previousGeminiApiKey);
    restoreEnv("GOOGLE_API_KEY", previousGoogleApiKey);
  }
});

test("isCodexContextOverflowError detects Codex context exhaustion signals", () => {
  assert.equal(
    isCodexContextOverflowError(
      new Error(
        "Codex ran out of room in the model's context window. Start a new thread or clear earlier history before retrying.",
      ),
    ),
    true,
  );
  assert.equal(
    isCodexContextOverflowError(new Error("request failed: context_length_exceeded")),
    true,
  );
  assert.equal(
    isCodexContextOverflowError({ message: "Model exceeded the context window limit" }),
    true,
  );
  assert.equal(
    isCodexContextOverflowError(new Error("spawn codex ENOENT")),
    false,
  );
  assert.equal(isCodexContextOverflowError(null), false);
  assert.equal(isCodexContextOverflowError(undefined), false);
});

test("isCodexRecoverableThreadResumeError detects missing rollout resume failures", () => {
  assert.equal(
    isCodexRecoverableThreadResumeError(
      new Error("thread/resume: thread/resume failed: no rollout found for thread id 019dc32f-4182"),
    ),
    true,
  );
  assert.equal(
    isCodexRecoverableThreadResumeError(new Error("request failed: context_length_exceeded")),
    true,
  );
  assert.equal(
    isCodexRecoverableThreadResumeError(new Error("spawn codex ENOENT")),
    false,
  );
});

test("resolveCodexModel defaults Codex sessions to GPT 5.5", () => {
  const previousAgenticModel = process.env.AGENTIC30_CODEX_MODEL;
  const previousCodexModel = process.env.CODEX_MODEL;
  const previousOpenAIModel = process.env.OPENAI_MODEL;
  try {
    delete process.env.AGENTIC30_CODEX_MODEL;
    delete process.env.CODEX_MODEL;
    delete process.env.OPENAI_MODEL;
    assert.equal(resolveCodexModel(), "gpt-5.5");
  } finally {
    restoreEnv("AGENTIC30_CODEX_MODEL", previousAgenticModel);
    restoreEnv("CODEX_MODEL", previousCodexModel);
    restoreEnv("OPENAI_MODEL", previousOpenAIModel);
  }
});

test("DEFAULT_CLAUDE_MODEL targets a non-deprecated Claude family supported by the bundled SDK", () => {
  assert.match(DEFAULT_CLAUDE_MODEL, /^claude-(opus|sonnet|haiku)-[0-9]/);

  const require = createRequire(import.meta.url);
  const sdkEntry = require.resolve("@anthropic-ai/claude-agent-sdk");
  const sdkSource = readFileSync(sdkEntry, "utf8");

  const deprecationTable = sdkSource.match(/\{[^{}]*"claude-3-7-sonnet-latest"\s*:[^{}]*\}/);
  if (deprecationTable) {
    assert.ok(
      !deprecationTable[0].includes(`"${DEFAULT_CLAUDE_MODEL}"`),
      `${DEFAULT_CLAUDE_MODEL} is listed as deprecated by the bundled @anthropic-ai/claude-agent-sdk`,
    );
  }
});

test("resolveClaudeModel falls back to DEFAULT_CLAUDE_MODEL and honors overrides", () => {
  const previousAnthropicModel = process.env.ANTHROPIC_MODEL;
  try {
    delete process.env.ANTHROPIC_MODEL;
    resetProviderSettingsForTest();
    assert.equal(resolveClaudeModel(), DEFAULT_CLAUDE_MODEL);

    process.env.ANTHROPIC_MODEL = "claude-sonnet-4-6";
    assert.equal(resolveClaudeModel(), "claude-sonnet-4-6");
    assert.equal(resolveClaudeModel("claude-opus-4-8"), "claude-opus-4-8");
  } finally {
    restoreEnv("ANTHROPIC_MODEL", previousAnthropicModel);
    resetProviderSettingsForTest();
  }
});

test("resolveCodexCli prefers explicit env override", async () => {
  const fixture = await createCodexResolverFixture();
  const envCodex = path.join(fixture.root, "bin", "codex-env");
  await fs.mkdir(path.dirname(envCodex), { recursive: true });
  await fs.writeFile(envCodex, "");

  const cli = resolveCodexCli({
    env: { AGENTIC30_CODEX_BINARY: envCodex },
    packageRootResolver: fixture.packageRootResolver,
    shellLookup: () => fixture.shellCodex,
    commonPaths: [],
    spawnSyncImpl: fixture.versionProbe(new Map([
      [envCodex, "codex 0.125.3"],
      [fixture.shellCodex, "codex 0.125.3"],
      [fixture.bundledCodex, "codex 0.125.3"],
    ])),
  });

  assert.equal(cli.path, envCodex);
  assert.equal(cli.source, "env");
  assert.equal(cli.version, "0.125.3");
});

test("resolveCodexCli reuses system Codex before bundled binary", async () => {
  const fixture = await createCodexResolverFixture();

  const cli = resolveCodexCli({
    env: {},
    packageRootResolver: fixture.packageRootResolver,
    shellLookup: () => fixture.shellCodex,
    commonPaths: [],
    spawnSyncImpl: fixture.versionProbe(new Map([
      [fixture.shellCodex, "codex 0.125.1"],
      [fixture.bundledCodex, "codex 0.125.1"],
    ])),
  });

  assert.equal(cli.path, fixture.shellCodex);
  assert.equal(cli.source, "shell");
});

test("resolveCodexCli falls back to bundled Codex when system Codex is too old", async () => {
  const fixture = await createCodexResolverFixture();

  const cli = resolveCodexCli({
    env: {},
    packageRootResolver: fixture.packageRootResolver,
    shellLookup: () => fixture.shellCodex,
    commonPaths: [],
    spawnSyncImpl: fixture.versionProbe(new Map([
      [fixture.shellCodex, "codex 0.124.9"],
      [fixture.bundledCodex, "codex 0.125.0"],
    ])),
  });

  assert.equal(cli.path, fixture.bundledCodex);
  assert.equal(cli.source, "bundled");
  assert.equal(cli.minimumVersionSatisfied, true);
});

test("resolveCodexBinaryPath uses Codex platform package layout", async () => {
  const fixture = await createCodexResolverFixture();
  const binaryPath = resolveCodexBinaryPath({
    packageRootResolver: fixture.packageRootResolver,
    shellLookup: () => "",
    commonPaths: [],
    spawnSyncImpl: fixture.versionProbe(new Map([[fixture.bundledCodex, "codex 0.125.0"]])),
  });

  assert.match(binaryPath, /node_modules\/@openai\/codex-(darwin|linux|win32)-(arm64|x64)\/vendor\//);
  assert.match(binaryPath, /\/codex\/codex(?:\.exe)?$/);
});

test("resolveCodexBinaryPath reports missing Codex packages clearly", () => {
  assert.throws(
    () => resolveCodexBinaryPath({
      packageRootResolver: () => null,
      shellLookup: () => "",
      commonPaths: [],
    }),
    (error) => {
      assert.equal(error.name, "CodexBinaryNotInstalledError");
      assert.equal(error.code, CODEX_BINARY_NOT_INSTALLED_ERROR_CODE);
      assert.match(error.message, /Codex binary not installed/);
      assert.match(error.message, /@openai\/codex-sdk/);
      assert.doesNotMatch(error.message, /ERR_INVALID_ARG_TYPE/);
      assert.deepEqual(error.rejectedCandidates, []);
      return true;
    },
  );
});

async function createCodexResolverFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-codex-resolver-"));
  const nodeModules = path.join(root, "node_modules");
  const sdkRoot = path.join(nodeModules, "@openai", "codex-sdk");
  const platformPackage = `codex-${process.platform}-${process.arch}`;
  const bundledRoot = path.join(nodeModules, "@openai", platformPackage);
  const triple = codexTestTargetTriple();
  const bundledCodex = path.join(
    bundledRoot,
    "vendor",
    triple,
    "codex",
    process.platform === "win32" ? "codex.exe" : "codex",
  );
  const shellCodex = path.join(root, "bin", "codex");

  await fs.mkdir(path.dirname(bundledCodex), { recursive: true });
  await fs.mkdir(path.dirname(shellCodex), { recursive: true });
  await fs.mkdir(sdkRoot, { recursive: true });
  await fs.writeFile(path.join(sdkRoot, "package.json"), JSON.stringify({ version: "0.125.0" }));
  await fs.writeFile(bundledCodex, "");
  await fs.writeFile(shellCodex, "");

  return {
    root,
    bundledCodex,
    shellCodex,
    packageRootResolver: (...segments) => {
      const candidate = path.join(nodeModules, ...segments);
      return fsSync.existsSync(candidate) ? candidate : null;
    },
    versionProbe:
      (versions) =>
      (command) => ({
        status: versions.has(command) ? 0 : 1,
        stdout: versions.get(command) || "",
        stderr: "",
      }),
  };
}

function codexTestTargetTriple() {
  const arch = process.arch === "arm64" ? "aarch64" : "x86_64";
  const platform =
    process.platform === "darwin"
      ? "apple-darwin"
      : process.platform === "win32"
        ? "pc-windows-msvc"
        : "unknown-linux-musl";
  return `${arch}-${platform}`;
}

test("buildCodexConfig isolates sidecar runs from global Codex notifier", () => {
  const config = buildCodexConfig({
    systemPromptText: "system",
    executionMode: "fast_chat",
    sessionIdForMcp: "session",
    workspaceRoot: "/tmp/workspace",
  });

  assert.deepEqual(config.notify, []);
  assert.equal(config.features.computer_use, false);
});

test("buildCodexConfig gives memory_chat both QMD and internal BIP MCP access", () => {
  const config = buildCodexConfig({
    systemPromptText: "system",
    executionMode: "memory_chat",
    sessionIdForMcp: "session",
    workspaceRoot: "/tmp/workspace",
  });

  assert.ok(config.mcp_servers.agentic30_sidecar);
  assert.match(config.mcp_servers.agentic30_sidecar.args.join(" "), /mcp-server\.mjs/);
  assert.equal(config.mcp_servers.agentic30_sidecar.env.AGENTIC30_APPROVED_TOOL_EXECUTION, "0");
  assert.equal(config.mcp_servers.agentic30_sidecar.default_tools_approval_mode, "approve");
  assert.equal(config.mcp_servers.agentic30_sidecar.tool_timeout_sec, 1800);
  assert.ok(config.mcp_servers.agentic30_sidecar.enabled_tools.includes("agentic30_request_user_input"));
  assert.ok(config.mcp_servers.agentic30_sidecar.enabled_tools.includes("list_workspace_files"));
  assert.equal(config.mcp_servers.agentic30_sidecar.enabled_tools.includes("gws_gmail_send"), false);
  assert.equal(config.mcp_servers.agentic30_sidecar.enabled_tools.includes("record_rubric_assessment"), false);
  if (config.mcp_servers.qmd) {
    assert.equal(config.mcp_servers.qmd.default_tools_approval_mode, "approve");
    assert.equal(config.mcp_servers.qmd.tool_timeout_sec, 60);
  }
});

test("buildCodexConfig keeps approved agentic internal MCP broad but auto-approved", () => {
  const config = buildCodexConfig({
    systemPromptText: "system",
    executionMode: "agentic",
    sessionIdForMcp: "session",
    workspaceRoot: "/tmp/workspace",
    approvedToolExecution: true,
  });

  assert.ok(config.mcp_servers.agentic30_sidecar);
  assert.equal(config.mcp_servers.agentic30_sidecar.env.AGENTIC30_APPROVED_TOOL_EXECUTION, "1");
  assert.equal(config.mcp_servers.agentic30_sidecar.default_tools_approval_mode, "approve");
  assert.equal(config.mcp_servers.agentic30_sidecar.tool_timeout_sec, 1800);
  assert.equal("enabled_tools" in config.mcp_servers.agentic30_sidecar, false);
});

test("buildCodexConfig adds read-only PostHog MCP for tool-capable sessions", () => {
  const previous = process.env.POSTHOG_API_KEY;
  process.env.POSTHOG_API_KEY = "phx_test";
  try {
    const config = buildCodexConfig({
      systemPromptText: "system",
      executionMode: "memory_chat",
      sessionIdForMcp: "session",
      workspaceRoot: "/tmp/workspace",
    });

    assert.ok(config.mcp_servers.posthog);
    assert.match(config.mcp_servers.posthog.url, /^https:\/\/mcp\.posthog\.com\/mcp\?/);
    assert.match(config.mcp_servers.posthog.url, /readonly=1/);
    assert.equal(config.mcp_servers.posthog.bearer_token_env_var, POSTHOG_MCP_TOKEN_ENV_VAR);
    assert.equal(config.mcp_servers.posthog.default_tools_approval_mode, "approve");
    assert.equal(config.mcp_servers.posthog.tool_timeout_sec, 60);
    assert.equal(JSON.stringify(config.mcp_servers.posthog).includes("phx_test"), false);
  } finally {
    restoreEnv("POSTHOG_API_KEY", previous);
  }
});

test("office_hours_digest_read_only Codex config uses external MCP without internal memory tools", () => {
  const previousPostHog = process.env.POSTHOG_API_KEY;
  const previousCloudflare = process.env.CLOUDFLARE_API_TOKEN;
  process.env.POSTHOG_API_KEY = "phx_test";
  process.env.CLOUDFLARE_API_TOKEN = "cf_test";
  try {
    const config = buildCodexConfig({
      systemPromptText: "system",
      executionMode: "office_hours_digest_read_only",
      sessionIdForMcp: "session",
      workspaceRoot: "/tmp/workspace",
    });

    assert.equal(config.mcp_servers.agentic30_sidecar, undefined);
    assert.equal(config.mcp_servers.qmd, undefined);
    assert.ok(config.mcp_servers.posthog);
    assert.ok(config.mcp_servers["cloudflare-api"]);
    assert.equal(config.mcp_servers.posthog.bearer_token_env_var, POSTHOG_MCP_TOKEN_ENV_VAR);
    assert.equal(config.mcp_servers["cloudflare-api"].bearer_token_env_var, CLOUDFLARE_MCP_TOKEN_ENV_VAR);
  } finally {
    restoreEnv("POSTHOG_API_KEY", previousPostHog);
    restoreEnv("CLOUDFLARE_API_TOKEN", previousCloudflare);
  }
});

test("office_hours_digest_read_only system prompt is JSON-only and read-only", () => {
  const prompt = buildSystemPromptText({
    provider: "codex",
    workspaceRoot: "/tmp/workspace",
    executionMode: "office_hours_digest_read_only",
  });

  assert.match(prompt, /read-only source digest engine/);
  assert.match(prompt, /Return JSON only/);
  assert.match(prompt, /Never include raw rows/);
  assert.doesNotMatch(prompt, /agentic30_request_user_input/);
});

test("provider permission bypass requires an approved agentic action", () => {
  assert.equal(
    allowsProviderPermissionBypass({ executionMode: "agentic", approvedToolExecution: true }),
    true,
  );
  assert.equal(
    allowsProviderPermissionBypass({ executionMode: "agentic", approvedToolExecution: false }),
    false,
  );
  assert.equal(
    allowsProviderPermissionBypass({ executionMode: "memory_chat", approvedToolExecution: true }),
    false,
  );
  assert.equal(
    codexSandboxForExecution({ executionMode: "agentic", approvedToolExecution: true }),
    "danger-full-access",
  );
  assert.equal(
    codexSandboxForExecution({ executionMode: "agentic", approvedToolExecution: false }),
    "read-only",
  );
});

test("Claude read-only gate treats shell, write, web, and mutating GWS tools as unsafe", () => {
  assert.equal(isClaudeMutatingTool("Bash"), true);
  assert.equal(isClaudeMutatingTool("Write"), true);
  assert.equal(isClaudeMutatingTool("mcp__agentic30_sidecar__gws_gmail_send"), true);
  assert.equal(isClaudeMutatingTool("mcp__agentic30_sidecar__gws_exec"), false);
  assert.equal(isClaudeMutatingTool("mcp__agentic30_sidecar__gws_sheets_read"), false);
  assert.equal(isClaudeMutatingTool("Read"), false);
});

test("Claude Office Hours digest gate treats mutating external tool names as unsafe", () => {
  assert.equal(isClaudeOfficeHoursDigestUnsafeTool("mcp__cloudflare-api__deploy_worker"), true);
  assert.equal(isClaudeOfficeHoursDigestUnsafeTool("mcp__posthog__update_feature_flag"), true);
  assert.equal(isClaudeOfficeHoursDigestUnsafeTool("mcp__posthog__list_events"), false);
  assert.equal(isClaudeOfficeHoursDigestUnsafeTool("mcp__cloudflare-api__get_worker"), false);
});

test("buildCodexConfig keeps judge_read_only isolated from MCP tools", () => {
  const previous = process.env.POSTHOG_API_KEY;
  process.env.POSTHOG_API_KEY = "phx_test";
  try {
    const config = buildCodexConfig({
      systemPromptText: "system",
      executionMode: "judge_read_only",
      sessionIdForMcp: "session",
      workspaceRoot: "/tmp/workspace",
    });

    assert.deepEqual(config.mcp_servers, {});
  } finally {
    restoreEnv("POSTHOG_API_KEY", previous);
  }
});

test("buildCodexEnv points Codex CLI at an isolated app config home", () => {
  const env = buildCodexEnv({
    PATH: "/usr/bin",
    HOME: "/Users/tester",
    TMPDIR: "/tmp",
    CODEX_API_KEY: "codex-key",
    OPENAI_API_KEY: "openai-key",
    POSTHOG_API_KEY: "phx_posthog",
  });

  assert.match(env.CODEX_HOME, /Application Support\/agentic30\/codex-home$/);
  assert.equal(env.PATH, "/usr/bin");
  assert.equal(env.CODEX_API_KEY, "codex-key");
  assert.equal(env.OPENAI_API_KEY, "openai-key");
  assert.equal(env.POSTHOG_MCP_API_KEY, "phx_posthog");
  assert.equal(env.AGENTIC30_QMD_INDEX, "agentic30");
});

test("provider environment parser accepts KEY=VALUE lines and strips quotes", () => {
  assert.deepEqual(
    parseProviderEnvironment([
      "# comment",
      "GOOGLE_CLOUD_PROJECT=agentic30",
      "GOOGLE_CLOUD_LOCATION=\"us-central1\"",
      "invalid key=value",
      "GEMINI_API_KEY='secret'",
    ].join("\n")),
    {
      GOOGLE_CLOUD_PROJECT: "agentic30",
      GOOGLE_CLOUD_LOCATION: "us-central1",
      GEMINI_API_KEY: "secret",
    },
  );
});

test("Gemini model resolves from settings override", () => {
  resetProviderSettingsForTest();
  try {
    updateProviderSettings({
      gemini: {
        model: "gemini-2.5-flash",
      },
    });

    assert.equal(resolveGeminiModel(), "gemini-2.5-flash");
  } finally {
    resetProviderSettingsForTest();
  }
});

test("resolveCodexReasoningEffort adapts to mode and prompt intent", () => {
  const previous = process.env.AGENTIC30_CODEX_REASONING_EFFORT;
  try {
    delete process.env.AGENTIC30_CODEX_REASONING_EFFORT;
    assert.equal(
      resolveCodexReasoningEffort({ executionMode: "fast_chat", prompt: "quick summary" }),
      "minimal",
    );
    assert.equal(
      resolveCodexReasoningEffort({ executionMode: "agentic", prompt: "implement and test this" }),
      "high",
    );
    assert.equal(
      resolveCodexReasoningEffort({ executionMode: "bip_coach_read_only", prompt: "analyze the sheet" }),
      "xhigh",
    );
    assert.equal(
      resolveCodexReasoningEffort({ executionMode: "judge_read_only", prompt: "quick score" }),
      "medium",
    );
    process.env.AGENTIC30_CODEX_REASONING_EFFORT = "medium";
    assert.equal(
      resolveCodexReasoningEffort({ executionMode: "bip_coach_read_only", prompt: "analyze" }),
      "medium",
    );
  } finally {
    restoreEnv("AGENTIC30_CODEX_REASONING_EFFORT", previous);
  }
});

test("shouldResumeCodexThread requires matching isolated home, workspace, and execution mode", () => {
  assert.equal(shouldResumeCodexThread({}, "/tmp/workspace"), false);
  assert.equal(
    shouldResumeCodexThread({
      codexThreadId: "thread-1",
      codexThreadMeta: {
        codexHome: "/tmp/wrong",
        workspaceRoot: "/tmp/workspace",
      },
    }, "/tmp/workspace", "memory_chat"),
    false,
  );
  assert.equal(
    shouldResumeCodexThread({
      codexThreadId: "thread-1",
      codexThreadMeta: {
        codexHome: process.env.AGENTIC30_APP_SUPPORT_PATH
          ? `${process.env.AGENTIC30_APP_SUPPORT_PATH}/codex-home`
          : `${process.env.HOME}/Library/Application Support/agentic30/codex-home`,
        workspaceRoot: "/tmp/workspace",
        executionMode: "fast_chat",
      },
    }, "/tmp/workspace", "memory_chat"),
    false,
  );
  assert.equal(
    shouldResumeCodexThread({
      codexThreadId: "thread-1",
      codexThreadMeta: {
        codexHome: process.env.AGENTIC30_APP_SUPPORT_PATH
          ? `${process.env.AGENTIC30_APP_SUPPORT_PATH}/codex-home`
          : `${process.env.HOME}/Library/Application Support/agentic30/codex-home`,
        workspaceRoot: "/tmp/workspace",
        executionMode: "memory_chat",
      },
    }, "/tmp/workspace", "memory_chat"),
    true,
  );
});

test("extractClaudePartialText maps Claude stream_event text deltas", () => {
  assert.equal(
    extractClaudePartialText({
      type: "content_block_delta",
      delta: { type: "text_delta", text: "안녕" },
    }),
    "안녕",
  );
  assert.equal(
    extractClaudePartialText({
      type: "content_block_delta",
      delta: { type: "input_json_delta", partial_json: "{}" },
    }),
    "",
  );
});

test("mapCodexItemToToolEvent normalizes streamed Codex item lifecycle events", () => {
  assert.deepEqual(
    mapCodexItemToToolEvent({
      id: "cmd-1",
      type: "command_execution",
      command: "npm test",
      aggregated_output: "ok",
      status: "completed",
      exit_code: 0,
    }, "completed"),
    {
      phase: "result",
      toolName: "Bash",
      toolCallKey: "cmd-1",
      payload: {
        command: "npm test",
        output: "ok",
        exitCode: 0,
      },
    },
  );
  assert.deepEqual(
    mapCodexItemToToolEvent({
      id: "todo-1",
      type: "todo_list",
      items: [{ text: "read docs", completed: false }],
    }, "updated"),
    {
      phase: "progress",
      toolName: "TodoList",
      toolCallKey: "todo-1",
      payload: { items: [{ text: "read docs", completed: false }] },
    },
  );
  assert.deepEqual(
    mapCodexItemToToolEvent({
      id: "fn-1",
      type: "function_call",
      name: "custom_function",
      call_id: "call-1",
      arguments: { questions: [] },
    }, "completed"),
    {
      phase: "result",
      toolName: "custom_function",
      toolCallKey: "call-1",
      payload: {
        requestedToolName: "custom_function",
        eventItemType: "function_call",
        providerMode: "codex",
        arguments: { questions: [] },
        output: null,
      },
    },
  );
  assert.deepEqual(
    mapCodexItemToToolEvent({
      id: "mcp-1",
      type: "mcp_tool_call",
      server: "agentic30_sidecar",
      tool: "list_workspace_files",
      arguments: { relativePath: "." },
      status: "failed",
      error: { message: "user cancelled MCP tool call" },
    }, "completed"),
    {
      phase: "error",
      toolName: "list_workspace_files",
      toolCallKey: "mcp-1",
      payload: {
        server: "agentic30_sidecar",
        tool: "list_workspace_files",
        status: "failed",
        errorMessage: "user cancelled MCP tool call",
      },
    },
  );
});

function restoreEnv(name, value) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

test("buildCodexConfig adds skills.config when specialist vendor is available", () => {
  const config = buildCodexConfig({
    systemPromptText: "system prompt",
    executionMode: "agentic",
    sessionIdForMcp: null,
    workspaceRoot: "/tmp/ws",
    specialist: {
      id: "office-hours",
      vendor: {
        codex: {
          exists: true,
          skillName: "office-hours",
          skillDir: "/abs/path/to/office-hours",
        },
      },
    },
  });
  assert.ok(config.skills);
  assert.equal(config.skills.include_instructions, true);
  assert.deepEqual(config.skills.bundled, { enabled: false });
  assert.equal(config.skills.config.length, 1);
  assert.equal(config.skills.config[0].path, "/abs/path/to/office-hours");
  assert.equal(config.skills.config[0].enabled, true);
});

test("buildCodexConfig omits skills block when vendor unavailable", () => {
  const config = buildCodexConfig({
    systemPromptText: "system prompt",
    executionMode: "agentic",
    sessionIdForMcp: null,
    workspaceRoot: "/tmp/ws",
    specialist: { id: "office-hours", vendor: { codex: { exists: false } } },
  });
  assert.equal(config.skills, undefined);
  assert.equal(config.developer_instructions, "system prompt");
});

test("buildCodexConfig omits skills block when no specialist passed (backward compat)", () => {
  const config = buildCodexConfig({
    systemPromptText: "system prompt",
    executionMode: "agentic",
    sessionIdForMcp: null,
    workspaceRoot: "/tmp/ws",
  });
  assert.equal(config.skills, undefined);
});

test("buildCodexEnv injects SPAWNED_SESSION=true and MODEL_OVERLAY=codex", () => {
  const env = buildCodexEnv({
    PATH: "/usr/bin",
    HOME: "/tmp/home",
    LANG: "C.UTF-8",
  });
  assert.equal(env.SPAWNED_SESSION, "true");
  assert.equal(env.MODEL_OVERLAY, "codex");
});

test("buildSystemPromptText sets Korean response language for provider SDK runs", () => {
  for (const provider of ["claude", "codex", "gemini"]) {
    const prompt = buildSystemPromptText({
      provider,
      workspaceRoot: "/tmp/workspace",
      executionMode: "agentic",
    });
    assert.match(prompt, /Reply in Korean \(ko, 한국어\)/);
    assert.match(prompt, new RegExp(`Provider mode: ${provider}`));
  }
});

test("buildSystemPromptText keeps Korean response language in judge lane", () => {
  const prompt = buildSystemPromptText({
    provider: "codex",
    workspaceRoot: "/tmp/workspace",
    executionMode: "judge_read_only",
  });
  assert.match(prompt, /Reply in Korean \(ko, 한국어\)/);
  assert.match(prompt, /Return only the exact output format requested/);
});

test("buildSystemPromptText starts mini-action execution-only sessions without user-response prompt", () => {
  const prompt = buildSystemPromptText({
    provider: "codex",
    workspaceRoot: "/tmp/workspace",
    executionMode: "mini_action_execution_only",
  });

  assert.match(prompt, /Start immediately at the execution step/);
  assert.match(prompt, /Do not emit, ask, or wait for a user-response prompt/);
  assert.match(prompt, /Use auto-verification first/);
  assert.match(prompt, /Do not enter planning, interview, or review flows/);
  assert.match(prompt, /agentic30_request_user_input/);
});
