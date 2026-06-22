import fsSync from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { query, listSessions } from "@anthropic-ai/claude-agent-sdk";
import { GoogleGenAI } from "@google/genai";
import { buildAuthEnv } from "./auth-context.mjs";
import { buildQmdGuidance, buildQmdMcpConfig } from "./qmd-support.mjs";
import { projectDocPath } from "./project-doc-paths.mjs";
import {
  buildPendingUserInputToolOutput,
  createUserInputRequest,
  deleteUserInputArtifacts,
  waitForUserInputResponse,
} from "./user-input.mjs";
import {
  CODEX_STRUCTURED_INPUT_TOOL,
} from "./structured-input-tools.mjs";
import {
  prepareOfficeHoursStructuredInputRequest,
} from "./office-hours-structured-input.mjs";
import { decorateIcpStructuredInput } from "./idd-doc-gate.mjs";
import {
  INLINE_DECISION_CONTRACT,
  INLINE_DECISION_SENTINEL_END,
  INLINE_DECISION_SENTINEL_START,
} from "./inline-decision.mjs";
import { buildReadOnlyWorkspaceCanUseTool } from "./read-only-workspace-tool-policy.mjs";
import {
  applyPostHogCodexEnvFromSources,
  buildPostHogClaudeMcpConfigFromSources,
  buildPostHogCodexMcpConfigFromSources,
} from "./posthog-mcp-config.mjs";
import {
  applyCloudflareCodexEnvFromSources,
  buildCloudflareClaudeMcpConfigFromSources,
  buildCloudflareCodexMcpConfigFromSources,
} from "./cloudflare-mcp-config.mjs";
import {
  applyGithubCodexEnvFromSources,
  buildGithubClaudeMcpConfigFromSources,
  buildGithubCodexMcpConfigFromSources,
} from "./github-mcp-config.mjs";
import {
  buildVercelClaudeMcpConfigFromSources,
  buildVercelCodexMcpConfigFromSources,
} from "./vercel-mcp-config.mjs";
import {
  parseClaudeSdkMessage,
  parseClaudeStreamEvent,
  parseClaudeStructuredInputToolInput,
  parseClaudeStructuredInputToolOutput,
  parseCodexSdkEvent,
  parseCodexThreadItem,
  parseStructuredPromptQuestionsOutput,
} from "./provider-sdk-contracts.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sidecarRoot = path.resolve(__dirname);
process.env.AGENTIC30_SIDECAR_ROOT ??= sidecarRoot;
const DEFAULT_CODEX_MODEL = "gpt-5.5";
const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash";
const DEFAULT_CURSOR_MODEL = "composer-2.5";
export const CODEX_BINARY_NOT_INSTALLED_ERROR_CODE = "ERR_CODEX_BINARY_NOT_INSTALLED";
export const OFFICE_HOURS_QUESTION_EXECUTION_MODE = "office_hours_question";
const CODEX_CLI_VERSION_TIMEOUT_MS = 2500;
const DEFAULT_CLAUDE_MODEL = "claude-opus-4-8";
const MINI_ACTION_EXECUTION_ONLY_MODE = "mini_action_execution_only";
const CODEX_REASONING_EFFORTS = new Set(["minimal", "low", "medium", "high", "xhigh"]);
// Claude Agent SDK `options.effort` levels. The SDK silently downgrades levels a
// model doesn't support (e.g. xhigh -> high below Opus 4.7), so validation here
// only guards against typos, not per-model capability.
const CLAUDE_REASONING_EFFORTS = new Set(["low", "medium", "high", "xhigh", "max"]);
// Gemini `thinkingConfig.thinkingLevel` values. Only the Gemini 3.x family
// accepts thinkingLevel (3 Pro rejects "minimal"); the 2.5 series uses numeric
// thinkingBudget and stays on its model default, so settings are ignored there.
const GEMINI_THINKING_LEVELS = new Set(["minimal", "low", "medium", "high"]);
const CODEX_MCP_TOOL_TIMEOUT_SEC = 60;
const CODEX_INTERNAL_MCP_TOOL_TIMEOUT_SEC = 60 * 30;
// Claude Agent SDK turn ceilings. The interactive lane keeps the historical 24;
// the read-only workspace scanner is bounded far tighter (discover → read →
// emit is ~3 turns, 5 leaves headroom) so a stuck scan fails fast instead of
// burning minutes — see resolveClaudeMaxTurns.
const DEFAULT_CLAUDE_MAX_TURNS = 24;
const WORKSPACE_SCAN_MAX_TURNS = 5;
const CODEX_INTERNAL_MCP_READ_ONLY_TOOLS = Object.freeze([
  "get_agentic30_context",
  CODEX_STRUCTURED_INPUT_TOOL,
  "AskUserQuestion",
  "ask_user_question",
  "list_workspace_files",
  "read_workspace_file",
  "search_workspace",
  "get_bip_context",
  "read_project_doc",
  "get_social_context",
  "gws_gmail_list",
  "gws_gmail_read",
  "gws_drive_list",
  "gws_calendar_list",
  "gws_sheets_read",
  "gws_docs_read",
  "get_rubric_status",
]);
const CODEX_OFFICE_HOURS_QUESTION_TOOLS = Object.freeze([
  CODEX_STRUCTURED_INPUT_TOOL,
  "AskUserQuestion",
  "ask_user_question",
]);
const GEMINI_CAPABLE_EXECUTION_MODES = new Set([
  "isolated_read_only",
  "judge_read_only",
  "idd_question_synthesis",
  "agentic",
  "workspace_scan_read_only",
  "memory_chat",
  OFFICE_HOURS_QUESTION_EXECUTION_MODE,
]);
// Cursor runs a local agent with filesystem tools, so the read-only judge
// modes (which rely on text-only execution) are excluded on purpose.
const CURSOR_CAPABLE_EXECUTION_MODES = new Set([
  "idd_question_synthesis",
  "agentic",
  "memory_chat",
]);
const RESPONSE_LANGUAGE_INSTRUCTION =
  "Reply in Korean (ko, 한국어) for all assistant-facing prose unless the user's prompt explicitly requests another language or an exact machine-readable output schema requires fixed tokens.";
const appSupportPath = process.env.AGENTIC30_APP_SUPPORT_PATH
  ? path.resolve(process.env.AGENTIC30_APP_SUPPORT_PATH)
  : path.join(
      os.homedir(),
      "Library",
      "Application Support",
      "agentic30",
    );
const codexHomePath = path.join(appSupportPath, "codex-home");
const internalMcpServerName = "agentic30_sidecar";
const notionConfigPath = path.join(appSupportPath, "notion-config.json");
let codexSdkImportPromise = null;
let cursorSdkImportPromise = null;
let providerSettings = {
  claude: {},
  codex: {},
  gemini: {},
  cursor: {},
};

export function updateProviderSettings(nextSettings = {}) {
  providerSettings = {
    claude: normalizeProviderSettings(nextSettings.claude),
    codex: normalizeProviderSettings(nextSettings.codex),
    gemini: normalizeProviderSettings(nextSettings.gemini),
    cursor: normalizeProviderSettings(nextSettings.cursor),
  };
  return getProviderSettingsSummary();
}

export function getProviderSettingsSummary() {
  return Object.fromEntries(
    Object.entries(providerSettings).map(([provider, settings]) => [
      provider,
      {
        authMode: settings.authMode || "local",
        hasApiKey: Boolean(settings.apiKey),
        hasEnvironment: Boolean(settings.environment),
        model: settings.model || "",
        reasoningEffort: settings.reasoningEffort || "",
      },
    ]),
  );
}

export function resetProviderSettingsForTest() {
  providerSettings = {
    claude: {},
    codex: {},
    gemini: {},
    cursor: {},
  };
}

function normalizeProviderSettings(settings = {}) {
  return {
    authMode: normalizeAuthMode(settings.authMode),
    apiKey: String(settings.apiKey || ""),
    environment: String(settings.environment || ""),
    model: String(settings.model || ""),
    reasoningEffort: String(settings.reasoningEffort || "").trim().toLowerCase(),
  };
}

function hasStructuredOutputSchema(schema) {
  return Boolean(schema && typeof schema === "object");
}

function normalizeAuthMode(authMode = "") {
  const normalized = String(authMode || "local").trim().toLowerCase();
  return [
    "local",
    "api_key",
    "bedrock",
    "vertex",
    "foundry",
    "custom",
  ].includes(normalized)
    ? normalized
    : "local";
}

export async function runProviderStream({
  provider,
  sessionRuntime = {},
  prompt,
  model = "",
  workspaceRoot,
  abortController,
  sessionIdForMcp,
  executionMode = "agentic",
  systemPromptOverride = "",
  specialist = null,
  approvedToolExecution = false,
  onTextDelta,
  onTextReplace,
  onToolEvent,
  onRuntimeUpdate,
  onRunEvent,
  stopAfterCodexThreadStarted = false,
  structuredOutputSchema = null,
}) {
  onRunEvent?.({
    phase: "provider.entry",
    provider,
    executionMode,
    approvedToolExecution: Boolean(approvedToolExecution),
  });
  const forcedTestError = forcedProviderTestError(provider);
  if (forcedTestError) {
    throw forcedTestError;
  }
  if (process.env.AGENTIC30_TEST_STUB_PROVIDER === "1") {
    if (
      process.env.AGENTIC30_TEST_STUB_OFFICE_HOURS_MCP_REQUEST === "1"
      && executionMode === OFFICE_HOURS_QUESTION_EXECUTION_MODE
    ) {
      if (process.env.AGENTIC30_TEST_STUB_OFFICE_HOURS_MCP_RESULT_ONLY === "1") {
        emitStubOfficeHoursMcpResultOnly({ provider, onToolEvent });
        onRunEvent?.({ phase: "provider.stub_response", provider });
        return { runtime: sessionRuntime };
      }
      const stubRequest = await createStubOfficeHoursUserInputRequest({ sessionIdForMcp });
      if (stubRequest) {
        onRunEvent?.({
          phase: "provider.stub_user_input_request",
          provider,
          requestId: stubRequest.requestId,
          questionCount: stubRequest.questions.length,
        });
      }
      await delayTestStubOfficeHoursMcpRequestIfNeeded();
      onRunEvent?.({ phase: "provider.stub_response", provider });
      return { runtime: sessionRuntime };
    }
    const stubText = buildStubResponse(prompt);
    onTextReplace?.(stubText);
    const stubRequest = await createStubIddUserInputRequest({
      sessionRuntime,
      sessionIdForMcp,
    });
    if (stubRequest) {
      onRunEvent?.({
        phase: "provider.stub_user_input_request",
        provider,
        requestId: stubRequest.requestId,
        docType: sessionRuntime?.iddPendingAdaptiveContinuation?.docType || "",
      });
    }
    await delayTestStubProviderIfNeeded();
    onRunEvent?.({ phase: "provider.stub_response", provider });
    return { runtime: sessionRuntime };
  }

  if (executionMode === "isolated_read_only" && provider !== "gemini" && provider !== "cursor") {
    await runTextOnlyProvider({
      provider,
      prompt,
      model,
      abortController,
      structuredOutputSchema,
      onTextReplace,
    });
    return { runtime: sessionRuntime };
  }

  if (provider === "gemini") {
    if (!supportsGeminiExecutionMode(executionMode)) {
      throw new Error(
        `Gemini provider does not support executionMode "${executionMode}". Use Claude or Codex for this workflow.`,
      );
    }
    return runGeminiProvider({
      sessionRuntime,
      prompt,
      model,
      workspaceRoot,
      abortController,
      executionMode,
      systemPromptOverride,
      approvedToolExecution,
      structuredOutputSchema,
      onTextDelta,
      onTextReplace,
      onToolEvent,
      onRuntimeUpdate,
      onRunEvent,
    });
  }

  if (provider === "cursor") {
    if (!supportsCursorExecutionMode(executionMode)) {
      throw new Error(
        `Cursor provider does not support executionMode "${executionMode}". Use Claude or Codex for this workflow.`,
      );
    }
    return runCursorProvider({
      sessionRuntime,
      prompt,
      model,
      workspaceRoot,
      abortController,
      executionMode,
      systemPromptOverride,
      onTextDelta,
      onTextReplace,
      onToolEvent,
      onRuntimeUpdate,
      onRunEvent,
    });
  }

  if (allowsProviderPermissionBypass({ executionMode, approvedToolExecution })) {
    await ensureNotionToken();
  }

  if (provider === "claude") {
    return runClaudeProvider({
      sessionRuntime,
      prompt,
      model,
      workspaceRoot,
      abortController,
      sessionIdForMcp,
      executionMode,
      systemPromptOverride,
      specialist,
      approvedToolExecution,
      structuredOutputSchema,
      onTextDelta,
      onTextReplace,
      onToolEvent,
      onRuntimeUpdate,
      onRunEvent,
    });
  }

  return runCodexProvider({
    sessionRuntime,
    prompt,
    model,
    workspaceRoot,
    abortController,
    sessionIdForMcp,
    executionMode,
    systemPromptOverride,
    specialist,
    approvedToolExecution,
    structuredOutputSchema,
    onTextDelta,
    onTextReplace,
    onToolEvent,
    onRuntimeUpdate,
    onRunEvent,
    stopAfterCodexThreadStarted,
  });
}

export function getProviderAuthState(provider) {
  if (process.env.AGENTIC30_TEST_STUB_PROVIDER === "1") {
    return {
      available: true,
      source: "test-stub",
      message: "Test stub provider",
    };
  }

  const mode = providerSettings[provider]?.authMode || "local";
  const env = buildProviderEnv(provider);

  if (provider === "claude" && mode === "local" && hasClaudeLocalSession()) {
    return {
      available: true,
      source: "local-session",
      message: "Local Claude login session",
    };
  }

  if (provider === "codex" && mode === "local" && hasCodexLocalSession()) {
    return {
      available: true,
      source: "local-session",
      message: "Local Codex login session",
    };
  }

  if (provider === "gemini" && mode === "local" && hasGeminiLocalSession()) {
    return {
      available: true,
      source: "local-session",
      message: "Local Google Application Default Credentials (gcloud)",
    };
  }

  const apiKey = readApiKey(provider, env);
  if ((mode === "api_key" || mode === "local") && apiKey) {
    return {
      available: true,
      source: "api-key",
      message:
        provider === "claude"
          ? "API key from ANTHROPIC_API_KEY"
          : provider === "gemini"
            ? "API key from GEMINI_API_KEY / GOOGLE_API_KEY"
            : provider === "cursor"
              ? "API key from CURSOR_API_KEY"
              : "API key from CODEX_API_KEY / OPENAI_API_KEY",
    };
  }

  if (provider === "claude" && ["bedrock", "vertex", "foundry", "custom"].includes(mode) && hasConfiguredEnvironment(env, mode)) {
    return {
      available: true,
      source: mode,
      message: `${mode} environment configured`,
    };
  }

  if (provider === "gemini" && mode === "vertex" && hasGeminiVertexEnv(env)) {
    return {
      available: true,
      source: "vertex",
      message: "Vertex AI environment configured",
    };
  }

  if (mode !== "local" && apiKey) {
    return {
      available: true,
      source: "api-key",
      message:
        provider === "gemini"
          ? "API key from GEMINI_API_KEY / GOOGLE_API_KEY"
          : provider === "claude"
            ? "API key from ANTHROPIC_API_KEY"
            : provider === "cursor"
              ? "API key from CURSOR_API_KEY"
              : "API key from CODEX_API_KEY / OPENAI_API_KEY",
    };
  }

  if (provider === "gemini") {
    const diagnostic = geminiAdcDiagnostic();
    return {
      available: false,
      source: "missing",
      message: diagnostic.gcloudInstalled
        ? "`gcloud auth application-default login`을 실행하거나 GEMINI_API_KEY / GOOGLE_API_KEY를 설정하거나 Vertex AI 환경을 구성하세요."
        : "Google Cloud SDK가 설치되어 있지 않습니다. GEMINI_API_KEY / GOOGLE_API_KEY를 설정하거나 Google Cloud SDK를 설치하세요.",
      geminiAdc: diagnostic,
    };
  }

  return {
    available: false,
    source: "missing",
    message:
      provider === "claude"
        ? "Claude Code에 로그인하거나 ANTHROPIC_API_KEY를 설정하세요."
        : provider === "cursor"
          ? "CURSOR_API_KEY를 설정하거나 설정에서 Cursor API 키를 추가하세요."
          : "Codex에 로그인하거나 CODEX_API_KEY / OPENAI_API_KEY를 설정하세요.",
  };
}

export function getProviderConnectionState(provider) {
  return {
    ...getProviderAuthState(provider),
    sdk: getProviderSdkState(provider),
  };
}

function providerAuthAction(provider, connection = {}) {
  if (connection.available) return null;
  if (provider === "claude") return "claude_login";
  if (provider === "codex") return "codex_login";
  if (provider === "gemini") {
    return connection.geminiAdc?.gcloudInstalled
      ? "gemini_adc_login"
      : "gemini_api_key";
  }
  if (provider === "cursor") return "cursor_api_key";
  return null;
}

export function getProviderScanReadiness(provider) {
  const connection = getProviderConnectionState(provider);
  const sdkInstalled = connection.sdk?.available === true;
  const authenticated = connection.available === true;
  const scanSupported = provider !== "cursor";
  return {
    provider,
    sdkInstalled,
    authenticated,
    scanReady: sdkInstalled && authenticated && scanSupported,
    scanSupported,
    ...(scanSupported ? {} : { scanDisabledReason: "read_only_tool_gating_unavailable" }),
    source: String(connection.source || ""),
    message: String(connection.message || ""),
    sdkMessage: String(connection.sdk?.message || ""),
    authAction: providerAuthAction(provider, connection),
  };
}

// Agent SDK >=0.3 ships the Claude Code CLI as a per-platform native binary in
// an optionalDependency package; <=0.2 bundled a Node `cli.js` inside the main
// package. Resolve whichever layout is installed (native first, then legacy).
export function resolveClaudeCodeEntrypoint() {
  const { platform, arch } = process;
  const suffixes = platform === "linux"
    ? [`${platform}-${arch}`, `${platform}-${arch}-musl`]
    : [`${platform}-${arch}`];
  for (const suffix of suffixes) {
    const root = resolveExistingInstalledPackageRoot("@anthropic-ai", `claude-agent-sdk-${suffix}`);
    if (!root) continue;
    const binary = path.join(root, platform === "win32" ? "claude.exe" : "claude");
    if (fsSync.existsSync(binary)) {
      return binary;
    }
  }
  const legacyCliPath = path.join(
    resolveInstalledPackageRoot("@anthropic-ai", "claude-agent-sdk"),
    "cli.js",
  );
  return fsSync.existsSync(legacyCliPath) ? legacyCliPath : null;
}

function getProviderSdkState(provider) {
  if (provider === "claude") {
    const packageName = "@anthropic-ai/claude-agent-sdk";
    const packageRoot = resolveInstalledPackageRoot("@anthropic-ai", "claude-agent-sdk");
    const entrypointPath = resolveClaudeCodeEntrypoint();
    const packageJson = readPackageJson(packageRoot);
    return {
      available: Boolean(entrypointPath),
      packageName,
      version: packageJson?.version ?? null,
      packageRoot,
      entrypointPath,
      message: entrypointPath
        ? "Claude Agent SDK CLI is installed"
        : "Claude Agent SDK CLI is missing",
    };
  }

  if (provider === "gemini") {
    const packageName = "@google/genai";
    const packageRoot = resolveInstalledPackageRoot("@google", "genai");
    const entrypointPath = path.join(packageRoot, "package.json");
    const packageJson = readPackageJson(packageRoot);
    const installed = fsSync.existsSync(entrypointPath);
    return {
      available: installed,
      packageName,
      version: packageJson?.version ?? null,
      packageRoot,
      entrypointPath,
      message: installed
        ? "Google Gen AI SDK is installed"
        : "Google Gen AI SDK is missing",
    };
  }

  if (provider === "cursor") {
    const packageName = "@cursor/sdk";
    const packageRoot = resolveInstalledPackageRoot("@cursor", "sdk");
    const entrypointPath = path.join(packageRoot, "package.json");
    const packageJson = readPackageJson(packageRoot);
    const installed = fsSync.existsSync(entrypointPath);
    return {
      available: installed,
      packageName,
      version: packageJson?.version ?? null,
      packageRoot,
      entrypointPath,
      message: installed
        ? "Cursor Agent SDK is installed"
        : "Cursor Agent SDK is missing",
    };
  }

  const packageName = "@openai/codex-sdk";
  const packageRoot = resolveInstalledPackageRoot("@openai", "codex-sdk");
  let codexCli = null;
  let binaryError = null;
  try {
    codexCli = resolveCodexCli();
  } catch (error) {
    if (error?.code !== CODEX_BINARY_NOT_INSTALLED_ERROR_CODE) {
      throw error;
    }
    binaryError = error;
  }
  const packageJson = readPackageJson(packageRoot);
  const binaryInstalled = Boolean(codexCli?.path && fsSync.existsSync(codexCli.path));
  return {
    available: binaryInstalled,
    packageName,
    version: packageJson?.version ?? null,
    packageRoot,
    entrypointPath: codexCli?.path ?? null,
    cliSource: codexCli?.source ?? "missing",
    cliPath: codexCli?.path ?? null,
    cliVersion: codexCli?.version ?? null,
    cliArch: codexCli?.arch ?? null,
    minimumVersionSatisfied: codexCli?.minimumVersionSatisfied ?? false,
    message: binaryError?.message
      ?? (binaryInstalled
        ? `Codex SDK and CLI binary are installed (${codexCli.source})`
        : "Codex CLI not found; install Codex or use bundled build"),
  };
}

function forcedProviderTestError(provider) {
  const forcedAbortProvider = String(process.env.AGENTIC30_TEST_FORCE_PROVIDER_ABORT || "")
    .trim()
    .toLowerCase();
  if (forcedAbortProvider && forcedAbortProvider === String(provider || "").toLowerCase()) {
    const error = new Error(`${provider === "claude" ? "Claude Code" : provider} process aborted by user`);
    error.name = "AbortError";
    error.code = "aborted";
    return error;
  }

  const forcedProvider = String(process.env.AGENTIC30_TEST_FORCE_PROVIDER_USAGE_LIMIT || "")
    .trim()
    .toLowerCase();
  if (!forcedProvider || forcedProvider !== String(provider || "").toLowerCase()) {
    return null;
  }
  const error = new Error(
    provider === "claude"
      ? "Claude Code returned an error result: You've hit your weekly limit · resets Jun 14 at 9am (Asia/Seoul)"
      : "You've hit your usage limit. Your limit resets later.",
  );
  error.code = "rate_limit";
  return error;
}

async function runClaudeProvider({
  sessionRuntime,
  prompt,
  model,
  workspaceRoot,
  abortController,
  sessionIdForMcp,
  executionMode,
  systemPromptOverride,
  specialist,
  approvedToolExecution = false,
  onTextDelta,
  onTextReplace,
  onToolEvent,
  onRuntimeUpdate,
  onRunEvent,
  structuredOutputSchema = null,
}) {
  let runtime = { ...sessionRuntime };
  let sawPartialText = false;
  onRunEvent?.({ phase: "provider.claude.prepare_start" });
  const systemPromptText = buildSystemPromptText({
    provider: "claude",
    workspaceRoot,
    executionMode,
    systemPromptOverride,
  });
  const cliPath = resolveClaudeCodeEntrypoint();
  const providerEnv = buildProviderEnv("claude");
  const mcpServers = {
    ...(usesInternalMcp(executionMode) && sessionIdForMcp
      ? {
          [internalMcpServerName]: buildMcpConfig(sessionIdForMcp, workspaceRoot, {
            executionMode,
            approvedToolExecution,
          }),
        }
      : {}),
    ...(allowsProviderPermissionBypass({ executionMode, approvedToolExecution }) ? buildNotionMcpConfig() : {}),
    ...(usesQmdMcp(executionMode) ? buildQmdMcpConfig({ sidecarRoot }) : {}),
    ...(usesPostHogMcp(executionMode) ? buildPostHogClaudeMcpConfigFromSources({ appSupportPath, env: providerEnv }) : {}),
    ...(usesCloudflareMcp(executionMode) ? buildCloudflareClaudeMcpConfigFromSources({ appSupportPath, env: providerEnv }) : {}),
    ...(usesGithubMcp(executionMode) ? buildGithubClaudeMcpConfigFromSources({ env: providerEnv }) : {}),
    ...(usesVercelMcp(executionMode) ? buildVercelClaudeMcpConfigFromSources({ env: providerEnv }) : {}),
  };
  const env = {
    ...providerEnv,
    SPAWNED_SESSION: "true",
    MODEL_OVERLAY: "claude",
  };
  const apiKey = readApiKey("claude", env);
  if ((providerSettings.claude?.authMode || "local") === "local" && hasClaudeLocalSession()) {
    delete env.ANTHROPIC_API_KEY;
  } else if (apiKey) {
    env.ANTHROPIC_API_KEY = apiKey;
  }

  const claudeVendor = specialist?.vendor?.claude;
  // Resolve through Settings (providerSettings.claude.model) so a session whose
  // model was cleared on provider switch still honors the user's chosen model
  // instead of silently falling back to the SDK default.
  const resolvedClaudeModel = resolveClaudeModel(model);
  const claudeEffort = resolveClaudeReasoningEffort();
  const options = {
    model: resolvedClaudeModel,
    ...(claudeEffort ? { effort: claudeEffort } : {}),
    pathToClaudeCodeExecutable: cliPath ?? undefined,
    executable: process.execPath,
    env,
    cwd: workspaceRoot,
    mcpServers,
    includePartialMessages: true,
    canUseTool: buildClaudeCanUseTool({
      sessionId: sessionIdForMcp,
      workspaceRoot,
      onRunEvent,
      executionMode,
      approvedToolExecution,
    }),
    toolConfig: {
      askUserQuestion: { previewFormat: "markdown" },
    },
    systemPrompt: {
      type: "preset",
      preset: "claude_code",
      append: systemPromptText,
    },
    abortController,
    maxTurns: resolveClaudeMaxTurns(executionMode),
    ...(hasStructuredOutputSchema(structuredOutputSchema)
      ? { outputFormat: { type: "json_schema", schema: structuredOutputSchema } }
      : {}),
    ...(claudeVendor?.exists && executionMode !== OFFICE_HOURS_QUESTION_EXECUTION_MODE
      ? {
          plugins: [{ type: "local", path: claudeVendor.pluginRoot }],
          skills: [claudeVendor.skillName],
          settingSources: ["skills"],
        }
      : {}),
  };
  if (claudeVendor?.exists && executionMode !== OFFICE_HOURS_QUESTION_EXECUTION_MODE) {
    onRunEvent?.({
      phase: "provider.claude.specialist_loaded",
      specialistId: claudeVendor.skillName,
      pluginRoot: claudeVendor.pluginRoot,
    });
  }

  if (allowsProviderPermissionBypass({ executionMode, approvedToolExecution })) {
    options.allowDangerouslySkipPermissions = true;
    options.permissionMode = "bypassPermissions";
  }

  if (sessionRuntime?.claudeSessionId) {
    const knownSessions = await listSessions().catch(() => []);
    const matchingSession = knownSessions.find(
      (item) => item.sessionId === sessionRuntime?.claudeSessionId,
    );
    if (matchingSession) {
      options.resume = sessionRuntime.claudeSessionId;
      options.cwd = matchingSession.cwd;
    }
  }

  const stream = query({
    prompt,
    options,
  });
  onRunEvent?.({
    phase: "provider.claude.stream_created",
    model: resolvedClaudeModel,
    effort: claudeEffort || "default",
  });

  for await (const rawEvent of stream) {
    const event = parseClaudeSdkMessage(rawEvent);
    onRunEvent?.({ phase: "provider.claude.first_event", once: true, eventType: event.type });
    if (event.type === "system" && event.subtype === "init") {
      runtime = {
        ...runtime,
        claudeSessionId: event.session_id,
      };
      onRuntimeUpdate?.(runtime);
      continue;
    }

    if (event.type === "stream_event") {
      const streamEvent = parseClaudeStreamEvent(event.event);
      const partialText = extractClaudePartialText(streamEvent);
      if (partialText) {
        sawPartialText = true;
        onRunEvent?.({ phase: "provider.claude.first_text", once: true });
        onTextDelta?.(partialText);
      }
      const toolProgress = extractClaudePartialToolEvent(streamEvent);
      if (toolProgress) {
        onToolEvent?.(toolProgress);
      }
      continue;
    }

    if (event.type === "assistant" && event.message?.content) {
      for (const content of event.message.content) {
        if (content.type === "text" && content.text) {
          onRunEvent?.({ phase: "provider.claude.first_text", once: true });
          if (!sawPartialText) {
            onTextDelta?.(content.text);
          }
        } else if (content.type === "tool_use") {
          onToolEvent?.({
            phase: "use",
            toolName: content.name,
            toolCallKey: content.id ?? content.name,
            payload: content.input ?? {},
          });
        } else if (content.type === "thinking") {
          onToolEvent?.({
            phase: "thinking",
            toolName: "reasoning",
            payload: { text: content.thinking },
          });
        }
      }
    }

    if (event.type === "result") {
      runtime = {
        ...runtime,
        claudeSessionId: event.session_id || runtime.claudeSessionId,
      };
      onRuntimeUpdate?.(runtime);
      onRunEvent?.({
        phase: "provider.claude.result",
        subtype: event.subtype,
        durationMs: event.duration_ms,
        apiDurationMs: event.duration_api_ms,
        turns: event.num_turns,
        costUsd: event.total_cost_usd,
      });
      if (event.subtype === "success") {
        if (hasStructuredOutputSchema(structuredOutputSchema)) {
          if (!Object.hasOwn(event, "structured_output")) {
            const error = new Error("Claude structured output missing structured_output");
            error.structuredOutputFailure = "missing_structured_output";
            throw error;
          }
          onTextReplace?.(JSON.stringify(event.structured_output));
        } else {
          onTextReplace?.(event.result ?? "");
        }
      } else {
        const error = new Error((event.errors ?? []).join("; ") || event.stop_reason || "Claude Agent SDK run failed.");
        if (hasStructuredOutputSchema(structuredOutputSchema)) {
          error.structuredOutputFailure = "provider_schema_rejected";
        }
        throw error;
      }
      continue;
    }

    if (event.type === "user" && event.message?.content && typeof event.message.content !== "string") {
      for (const content of event.message.content) {
        if (content.type === "tool_result") {
          onToolEvent?.({
            phase: "result",
            toolName: content.tool_use_id,
            toolCallKey: content.tool_use_id,
            payload: content.content,
          });
        }
      }
    }
  }

  return {
    runtime,
  };
}

export function buildClaudeCanUseTool({
  sessionId,
  workspaceRoot,
  onRunEvent,
  executionMode = "",
  approvedToolExecution = false,
} = {}) {
  const workspaceScanCanUseTool = executionMode === "workspace_scan_read_only"
    ? buildReadOnlyWorkspaceCanUseTool({
        workspaceRoot,
        onDecision: ({ toolName, decision }) => {
          onRunEvent?.({
            phase: decision.allowed
              ? "provider.claude.workspace_scan_tool_allowed"
              : "provider.claude.workspace_scan_tool_denied",
            toolName,
            reason: decision.reason,
          });
        },
      })
    : null;
  return async (toolName, input, context = {}) => {
    if (workspaceScanCanUseTool) {
      return workspaceScanCanUseTool(toolName, input);
    }
    if (executionMode === OFFICE_HOURS_QUESTION_EXECUTION_MODE && toolName !== "AskUserQuestion") {
      onRunEvent?.({
        phase: "provider.claude.tool_denied_office_hours_question",
        toolName,
      });
      return {
        behavior: "deny",
        message: "Office Hours question mode may only ask the host structured-input question. Do not inspect files, run commands, browse, or use other tools.",
      };
    }
    if (executionMode === "office_hours_digest_read_only") {
      const verdict = evaluateClaudeOfficeHoursDigestToolCall(toolName, input);
      if (verdict?.allow === true) {
        return { behavior: "allow", updatedInput: input };
      }
      if (verdict?.allow === false) {
        onRunEvent?.({
          phase: "provider.claude.tool_denied_office_hours_digest_read_only",
          toolName,
        });
        return { behavior: "deny", message: verdict.reason };
      }
      if (isClaudeOfficeHoursDigestUnsafeTool(toolName)) {
        onRunEvent?.({
          phase: "provider.claude.tool_denied_office_hours_digest_read_only",
          toolName,
        });
        return {
          behavior: "deny",
          message: "Office Hours digest mode is read-only. Use only list/get/read/query analytics tools and do not mutate external services.",
        };
      }
    }
    if (!approvedToolExecution && isClaudeMutatingTool(toolName)) {
      onRunEvent?.({
        phase: "provider.claude.tool_denied_read_only",
        toolName,
      });
      return {
        behavior: "deny",
        message: "This Agentic30 chat lane is read-only. Use an approved Apply/Run action before modifying files, running shell commands, or sending external messages.",
      };
    }
    if (toolName !== "AskUserQuestion") {
      return { behavior: "allow", updatedInput: input };
    }
    if (!sessionId) {
      return {
        behavior: "deny",
        message: "Host app session is not available for AskUserQuestion.",
      };
    }

    let structuredInput;
    try {
      structuredInput = parseClaudeStructuredInputToolInput(input ?? {});
    } catch (error) {
      return {
        behavior: "deny",
        message: error?.message || "AskUserQuestion input did not match the structured input contract.",
      };
    }

    const questions = normalizeClaudeQuestions(structuredInput.questions);
    if (questions.length === 0) {
      return {
        behavior: "deny",
        message: "AskUserQuestion did not include valid questions.",
      };
    }

    const rawRequest = {
      sessionId,
      toolName,
      title: context.title || structuredInput.title || "Claude needs input",
      intro: structuredInput.intro ?? null,
      resources: structuredInput.resources ?? null,
      questions,
      generation: structuredInput.generation ?? null,
    };
    const requestInput = executionMode === OFFICE_HOURS_QUESTION_EXECUTION_MODE
      ? prepareOfficeHoursStructuredInputRequest(rawRequest)
      : rawRequest;
    const request = await createUserInputRequest(appSupportPath, requestInput);
    onRunEvent?.({
      phase: "provider.claude.awaiting_user_input",
      toolName,
      requestId: request.requestId,
      questionCount: questions.length,
    });

    try {
      const response = await waitForUserInputResponse(appSupportPath, {
        sessionId,
        requestId: request.requestId,
        signal: context.signal,
      });
      onRunEvent?.({
        phase: "provider.claude.user_input_received",
        toolName,
        requestId: request.requestId,
      });
      return {
        behavior: "allow",
        updatedInput: parseClaudeStructuredInputToolOutput({
          questions,
          answers: response.answers ?? {},
          annotations: response.annotations ?? {},
        }),
      };
    } finally {
      await deleteUserInputArtifacts(appSupportPath, sessionId, request.requestId);
    }
  };
}

export function isClaudeMutatingTool(toolName = "") {
  const normalized = String(toolName || "").toLowerCase();
  if (!normalized) return false;
  if (/^mcp__vercel__/.test(normalized)) {
    const action = normalized.split("__").pop()?.split(/[./]/).pop() || normalized;
    if (/^(list|get|read|query|search|fetch|describe|inspect|show|find)(_|$)/.test(action)) {
      return false;
    }
    return [
      "create",
      "update",
      "delete",
      "deploy",
      "write",
      "edit",
      "publish",
      "set",
      "remove",
      "cancel",
      "rollback",
    ].some((token) => new RegExp(`(^|[_:\\-])${token}($|[_:\\-])`).test(action));
  }
  return [
    "bash",
    "edit",
    "multiedit",
    "write",
    "notebookedit",
    "task",
    "webfetch",
    "websearch",
  ].some((name) => normalized === name.toLowerCase())
    || normalized.includes("gws_gmail_send");
}

// 이름만 보는 휴리스틱(isClaudeOfficeHoursDigestUnsafeTool)의 실측 한계 보완:
// PostHog의 유일한 SQL 경로는 execute-sql(HogQL은 SELECT 전용 — DML이 없다),
// Cloudflare 통합 MCP의 유일한 데이터 경로는 execute(codemode JS 또는 REST 호출)다.
// 둘 다 "execute" 토큰 때문에 일괄 거부되면 digest가 데이터를 아예 못 읽는다
// (2026-06-10 실측: 모든 조회가 denied → 빈 응답 → 카드 실패). 이름 대신
// 호출 입력을 검사해 읽기 호출만 명시적으로 허용하고, 쓰기 흔적은 fail-closed로
// 거부한다. 의견이 없으면(null) 기존 이름 휴리스틱으로 폴백.
export function evaluateClaudeOfficeHoursDigestToolCall(toolName = "", input = {}) {
  const normalized = String(toolName || "").toLowerCase();
  if (/^mcp__posthog__execute[-_]sql$/.test(normalized)) {
    const rawQuery = typeof input?.query === "string"
      ? input.query
      : typeof input?.query?.query === "string"
        ? input.query.query
        : typeof input?.sql === "string"
          ? input.sql
          : "";
    if (/^\s*(select|with)\b/i.test(rawQuery)) return { allow: true };
    return {
      allow: false,
      reason: "PostHog execute-sql is allowed for read-only SELECT/WITH HogQL queries only.",
    };
  }
  if (/^mcp__cloudflare[-_]api__execute$/.test(normalized)) {
    const method = String(input?.method || "").trim().toUpperCase();
    if (method) {
      if (method === "GET" || method === "HEAD") return { allow: true };
      if (method === "POST" && /graphql/i.test(String(input?.path || input?.url || ""))) {
        // GraphQL Analytics는 읽기 쿼리지만 HTTP 동사는 POST다.
        return { allow: true };
      }
      return {
        allow: false,
        reason: "Cloudflare execute is allowed for read-only GET/HEAD requests or POST to /graphql analytics only.",
      };
    }
    const code = String(input?.code ?? input?.script ?? "");
    if (code) {
      const hasMutatingVerb = /["'`](PUT|PATCH|DELETE)["'`]/i.test(code);
      const hasNonGraphqlPost = /["'`]POST["'`]/i.test(code) && !/graphql/i.test(code);
      if (hasMutatingVerb || hasNonGraphqlPost) {
        return {
          allow: false,
          reason: "Cloudflare execute code must be read-only: GET/HEAD requests or POST to /graphql analytics only.",
        };
      }
      return { allow: true };
    }
    return {
      allow: false,
      reason: "Cloudflare execute call shape was not recognized; provide a read-only request.",
    };
  }
  return null;
}

export function isClaudeOfficeHoursDigestUnsafeTool(toolName = "") {
  const normalized = String(toolName || "").toLowerCase();
  if (!normalized) return false;
  if (isClaudeMutatingTool(normalized)) return true;
  const action = normalized.split("__").pop()?.split(/[./]/).pop() || normalized;
  if (/^(list|get|read|query|search|fetch|describe|inspect|show|count|aggregate|select|sql|insight|find)(_|$)/.test(action)) {
    return false;
  }
  return [
    "create",
    "update",
    "delete",
    "deploy",
    "write",
    "edit",
    "publish",
    "purge",
    "set",
    "insert",
    "post",
    "patch",
    "put",
    "remove",
    "send",
    "execute",
    "run",
    "mutate",
  ].some((token) => new RegExp(`(^|[_:\\-])${token}($|[_:\\-])`).test(action));
}

export function normalizeClaudeQuestions(questions) {
  if (!Array.isArray(questions)) return [];
  const normalized = questions
    .map((question) => {
      const options = Array.isArray(question?.options)
        ? question.options
            .map((option) => ({
              label: String(option?.label || "").trim().slice(0, 80),
              description: String(option?.description || "").trim().slice(0, 280),
              ...(option?.preview ? { preview: String(option.preview).slice(0, 4000) } : {}),
              ...(option?.nextIntent || option?.next_intent
                ? { nextIntent: String(option.nextIntent || option.next_intent).trim().slice(0, 160) }
                : {}),
              ...(typeof option?.recommended === "boolean" ? { recommended: option.recommended } : {}),
              ...(option?.risk ? { risk: String(option.risk).trim().slice(0, 280) } : {}),
              ...(option?.evidenceTarget || option?.evidence_target
                ? { evidenceTarget: String(option.evidenceTarget || option.evidence_target).trim().slice(0, 280) }
                : {}),
              ...(option?.mapsTo || option?.maps_to
                ? { mapsTo: String(option.mapsTo || option.maps_to).trim().slice(0, 160) }
                : {}),
              ...(option?.failureMode || option?.failure_mode
                ? { failureMode: String(option.failureMode || option.failure_mode).trim().slice(0, 280) }
                : {}),
            }))
            .filter((option) => {
              return option.label
                && option.description;
            })
            .slice(0, 7)
        : [];
      const allowFreeText = Boolean(question?.allowFreeText);
      return {
        ...(question?.questionId || question?.question_id || question?.id
          ? { questionId: String(question.questionId || question.question_id || question.id).trim().slice(0, 96) }
          : {}),
        question: String(question?.question || "").trim().slice(0, 400),
        // Leave an absent header empty; the Office Hours preparer fills a
        // deterministic Korean intent header so the card title never shows a raw
        // English placeholder. (Was a literal "Question" default.)
        header: String(question?.header || "").trim().slice(0, 32),
        options,
        multiSelect: Boolean(question?.multiSelect),
        allowFreeText,
        requiresFreeText: Boolean(question?.requiresFreeText),
        ...(question?.helperText ? { helperText: String(question.helperText).trim().slice(0, 280) } : {}),
        ...(question?.freeTextPlaceholder ? { freeTextPlaceholder: String(question.freeTextPlaceholder).trim().slice(0, 280) } : {}),
        ...(question?.textMode === "long" ? { textMode: "long" } : {}),
        // Carry question-statement highlight/emphasis spans through so the Office
        // Hours card can render the same inline styling the inline_decision
        // channel already produces. Shape-normalized here for Swift-decode safety;
        // the Office Hours preparer re-validates spans against the question text.
        ...(Array.isArray(question?.highlightPhrases) && question.highlightPhrases.length
          ? { highlightPhrases: question.highlightPhrases.map((phrase) => String(phrase || "").trim().slice(0, 280)).filter(Boolean).slice(0, 8) }
          : {}),
        ...(Array.isArray(question?.emphasis) && question.emphasis.length
          ? {
              emphasis: question.emphasis
                .map((span) => ({
                  phrase: String(span?.phrase || span?.text || "").trim().slice(0, 280),
                  style: ["strong", "mark", "code"].includes(String(span?.style || span?.kind))
                    ? String(span?.style || span?.kind)
                    : "mark",
                }))
                .filter((span) => span.phrase)
                .slice(0, 8),
            }
          : {}),
      };
    })
    .filter((question) => question.question && (question.options.length >= 2 || question.allowFreeText))
    .slice(0, 4);
  if (normalized.length === 0) return [];
  try {
    return parseStructuredPromptQuestionsOutput(normalized);
  } catch {
    return [];
  }
}

export function extractClaudePartialText(event) {
  if (event?.type !== "content_block_delta") return "";
  const delta = event.delta ?? {};
  if (delta.type === "text_delta" && typeof delta.text === "string") {
    return delta.text;
  }
  return "";
}

function extractClaudePartialToolEvent(event) {
  if (event?.type === "content_block_start" && event.content_block?.type === "tool_use") {
    const block = event.content_block;
    return {
      phase: "use",
      toolName: block.name,
      toolCallKey: block.id ?? block.name,
      payload: block.input ?? {},
    };
  }
  if (event?.type === "content_block_delta" && event.delta?.type === "thinking_delta") {
    return {
      phase: "thinking",
      toolName: "reasoning",
      payload: { text: event.delta.thinking },
    };
  }
  if (event?.type === "content_block_delta" && event.delta?.type === "input_json_delta") {
    return {
      phase: "input_delta",
      toolName: "tool_input",
      toolCallKey: String(event.index ?? "tool_input"),
      payload: { partialJson: event.delta.partial_json },
    };
  }
  return null;
}

async function runCodexProvider(args) {
  const MAX_ATTEMPTS = 2;
  let attempt = 0;
  let runtime = { ...(args.sessionRuntime ?? {}) };

  while (true) {
    attempt += 1;
    try {
      return await runCodexAttempt({ ...args, sessionRuntime: runtime });
    } catch (error) {
      if (args.abortController?.signal?.aborted || error?.name === "AbortError") {
        throw error;
      }
      const hadResumedThread = Boolean(runtime.codexThreadId);
      const shouldResetAndRetry =
        attempt < MAX_ATTEMPTS
        && hadResumedThread
        && isCodexRecoverableThreadResumeError(error);
      if (!shouldResetAndRetry) {
        throw error;
      }
      runtime = { ...runtime, codexThreadId: null };
      args.onRuntimeUpdate?.(runtime);
      args.onTextReplace?.(
        "이전 Codex 스레드를 이어갈 수 없어 새 스레드로 다시 시도합니다…",
      );
    }
  }
}

export function isCodexRecoverableThreadResumeError(error) {
  const message = String(error?.message ?? error ?? "").toLowerCase();
  return (
    isCodexContextOverflowError(error)
    || message.includes("thread/resume failed: no rollout found")
    || message.includes("no rollout found for thread id")
    || (message.includes("thread/resume failed")
      && message.includes("rollout at")
      && message.includes(" is empty"))
  );
}

export function isCodexContextOverflowError(error) {
  const message = String(error?.message ?? error ?? "").toLowerCase();
  if (!message) return false;
  return (
    message.includes("ran out of room")
    || message.includes("context window")
    || message.includes("context_length_exceeded")
  );
}

/**
 * Recognizes an expected upstream Codex/ChatGPT usage-limit (quota) condition,
 * e.g. "You've hit your usage limit. Your limit resets at …". This is a
 * recoverable "retry later / switch provider" state, not a code fault — callers
 * use it to route the error to a benign telemetry event and surface a
 * user-facing message instead of capturing a generic exception on either side
 * of the Swift-shell ↔ Node-sidecar bridge.
 */
export function isCodexUsageLimitError(error) {
  const message = String(error?.message ?? error ?? "").toLowerCase();
  if (!message) return false;
  return (
    message.includes("usage limit")
    || message.includes("usage_limit")
    || message.includes("session limit")
    || message.includes("weekly limit")
    || message.includes("quota")
    || message.includes("plan limit")
    || message.includes("you've reached your limit")
    || message.includes("you have reached your limit")
  );
}

/**
 * Provider-agnostic usage-limit (quota) detection. Covers the Codex/ChatGPT
 * message patterns above plus structured rate-limit errors from other SDKs —
 * notably the Cursor SDK's RateLimitError, which carries name/code/status
 * rather than a quota-worded message.
 */
export function isProviderUsageLimitError(error) {
  if (isCodexUsageLimitError(error)) return true;
  if (!error || typeof error !== "object") return false;
  const name = String(error.name || "");
  const code = String(error.code || "").toLowerCase();
  const status = Number(error.status ?? error.statusCode ?? NaN);
  const message = String(error.message ?? "").toLowerCase();
  return (
    name === "RateLimitError"
    || code === "rate_limit"
    || code === "rate_limit_exceeded"
    || status === 429
    || message.includes("rate limit")
  );
}

/**
 * Recognizes expected "provider is not signed in / no API key configured"
 * states. These require user action, but they are not sidecar faults and should
 * not become error-tracking issues when the app has already surfaced an auth
 * action.
 */
export function isProviderAuthRequiredError(error) {
  const message = String(error?.message ?? error ?? "").toLowerCase();
  if (!message) return false;
  return (
    message.includes("sign in with claude code or set anthropic_api_key")
    || message.includes("sign in with codex or set codex_api_key / openai_api_key")
    || message.includes("set cursor_api_key or add a cursor api key")
    || message.includes("run `gcloud auth application-default login`")
    || message.includes("gcloud sdk not installed")
    || message.includes("claude code에 로그인하거나 anthropic_api_key")
    || message.includes("codex에 로그인하거나 codex_api_key / openai_api_key")
    || message.includes("cursor_api_key를 설정하거나")
    || message.includes("cursor provider를 사용하려면 cursor_api_key")
    || message.includes("acp claude 모드를 사용하려면 anthropic_api_key")
    || message.includes("acp codex mode requires codex_api_key or openai_api_key")
    || message.includes("gcloud auth application-default login")
    || message.includes("google cloud sdk가 설치되어 있지 않습니다")
    || message.includes("invalid authentication credentials")
    || message.includes("401")
  );
}

async function runCodexAttempt({
  sessionRuntime,
  prompt,
  model,
  workspaceRoot,
  abortController,
  sessionIdForMcp,
  executionMode,
  systemPromptOverride,
  specialist,
  approvedToolExecution = false,
  onTextDelta,
  onTextReplace,
  onToolEvent,
  onRuntimeUpdate,
  onRunEvent,
  stopAfterCodexThreadStarted = false,
  structuredOutputSchema = null,
}) {
  let runtime = { ...sessionRuntime };
  onRunEvent?.({ phase: "provider.codex.prepare_start" });
  const systemPromptText = buildSystemPromptText({
    provider: "codex",
    workspaceRoot,
    executionMode,
    systemPromptOverride,
  });
  const codexEnv = buildCodexEnv();
  const apiKey = readApiKey("codex", codexEnv);
  const codexCli = resolveCodexCli();
  const codexOptions = {
    codexPathOverride: codexCli.path,
    env: codexEnv,
    config: buildCodexConfig({
      systemPromptText,
      executionMode,
      sessionIdForMcp,
      workspaceRoot,
      specialist,
      approvedToolExecution,
      posthogEnv: codexEnv,
    }),
  };
  if (specialist?.vendor?.codex?.exists) {
    onRunEvent?.({
      phase: "provider.codex.specialist_loaded",
      specialistId: specialist.vendor.codex.skillName,
      skillDir: specialist.vendor.codex.skillDir,
    });
  }
  onRunEvent?.({ phase: "provider.codex.config_built" });
  if (apiKey) {
    codexOptions.apiKey = apiKey;
  }
  const { Codex } = await loadCodexSdk();
  onRunEvent?.({ phase: "provider.codex.sdk_loaded" });
  const codex = new Codex(codexOptions);
  const resolvedModel = resolveCodexModel(model);
  onRunEvent?.({
    phase: "provider.codex.client_created",
    model: resolvedModel,
    cliSource: codexCli.source,
    cliVersion: codexCli.version,
    cliArch: codexCli.arch,
  });

  const threadOptions = {
    model: resolvedModel,
    skipGitRepoCheck: true,
    workingDirectory: workspaceRoot,
    webSearchEnabled: allowsProviderPermissionBypass({ executionMode, approvedToolExecution }),
    sandboxMode: codexSandboxForExecution({ executionMode, approvedToolExecution }),
    approvalPolicy: "never",
    modelReasoningEffort: resolveCodexReasoningEffort({ executionMode, prompt }),
  };

  const resumableThreadId = shouldResumeCodexThread(sessionRuntime, workspaceRoot, executionMode)
    ? sessionRuntime.codexThreadId
    : null;
  const thread = resumableThreadId
    ? codex.resumeThread(resumableThreadId, threadOptions)
    : codex.startThread(threadOptions);
  onRunEvent?.({
    phase: "provider.codex.thread_ready",
    resumed: Boolean(resumableThreadId),
    executionMode,
    reasoningEffort: threadOptions.modelReasoningEffort,
  });

  onRunEvent?.({ phase: "provider.codex.run_streamed_call_start" });
  const { events } = await thread.runStreamed(prompt, {
    signal: abortController.signal,
    ...(hasStructuredOutputSchema(structuredOutputSchema)
      ? { outputSchema: structuredOutputSchema }
      : {}),
  });
  onRunEvent?.({ phase: "provider.codex.stream_opened", promptChars: String(prompt || "").length });

  for await (const rawEvent of events) {
    const event = parseCodexSdkEvent(rawEvent);
    onRunEvent?.({ phase: "provider.codex.first_event", once: true, eventType: event.type });
    if (event.type === "thread.started") {
      onRunEvent?.({ phase: "provider.codex.event.thread_started" });
      runtime = {
        ...runtime,
        codexThreadId: event.thread_id,
        codexThreadMeta: {
          codexHome: codexHomePath,
          workspaceRoot,
          model: resolvedModel,
          executionMode,
          createdAt: runtime.codexThreadMeta?.createdAt || new Date().toISOString(),
          lastValidatedAt: new Date().toISOString(),
        },
      };
      onRuntimeUpdate?.(runtime);
      if (stopAfterCodexThreadStarted) {
        onRunEvent?.({ phase: "provider.codex.warm_thread_started" });
        abortController.abort();
        return { runtime };
      }
      continue;
    }

    if (event.type === "turn.started") {
      onRunEvent?.({ phase: "provider.codex.event.turn_started" });
      onRunEvent?.({ phase: "provider.codex.turn_started" });
      continue;
    }

    if (event.type === "item.started" && event.item?.type === "agent_message" && event.item.text) {
      onRunEvent?.({
        phase: "provider.codex.event.item_started_agent_message",
        textLength: event.item.text.length,
      });
      onRunEvent?.({ phase: "provider.codex.first_text", once: true });
      onTextReplace?.(event.item.text);
      continue;
    }

    if (event.type === "item.started") {
      assertCodexOfficeHoursQuestionItemAllowed(event.item, executionMode);
      onRunEvent?.({
        phase: "provider.codex.event.item_started",
        itemType: event.item?.type || "unknown",
        ...codexItemDiagnostics(event.item),
      });
      const toolEvent = mapCodexItemToToolEvent(event.item, "started");
      if (toolEvent) {
        onToolEvent?.(toolEvent);
      }
      continue;
    }

    if (event.type === "item.updated") {
      const item = event.item;
      assertCodexOfficeHoursQuestionItemAllowed(item, executionMode);
      if (item?.type === "agent_message") {
        onRunEvent?.({
          phase: "provider.codex.event.item_updated_agent_message",
          textLength: String(item.text || "").length,
        });
        onRunEvent?.({ phase: "provider.codex.first_text", once: true });
        onTextReplace?.(item.text ?? "");
      } else {
        onRunEvent?.({
          phase: "provider.codex.event.item_updated",
          itemType: item?.type || "unknown",
          ...codexItemDiagnostics(item),
        });
        const toolEvent = mapCodexItemToToolEvent(item, "updated");
        if (toolEvent) {
          onToolEvent?.(toolEvent);
        }
      }
      continue;
    }

    if (event.type === "item.completed") {
      const item = event.item;
      assertCodexOfficeHoursQuestionItemAllowed(item, executionMode);
      if (item.type === "agent_message") {
        onRunEvent?.({
          phase: "provider.codex.event.item_completed_agent_message",
          textLength: String(item.text || "").length,
        });
        onRunEvent?.({ phase: "provider.codex.final_message" });
        onTextReplace?.(item.text ?? "");
      } else {
        onRunEvent?.({
          phase: "provider.codex.event.item_completed",
          itemType: item?.type || "unknown",
          ...codexItemDiagnostics(item),
        });
        const toolEvent = mapCodexItemToToolEvent(item, "completed");
        if (toolEvent) {
          onToolEvent?.(toolEvent);
        }
      }
      continue;
    }

    if (event.type === "turn.completed") {
      onRunEvent?.({ phase: "provider.codex.event.turn_completed" });
      onRunEvent?.({
        phase: "provider.codex.turn_completed",
        usage: event.usage,
      });
      onToolEvent?.({
        phase: "usage",
        toolName: "codex",
        payload: event.usage,
      });
      continue;
    }

    if (event.type === "turn.failed") {
      throw new Error(event.error?.message || "Codex SDK turn failed.");
    }

    if (event.type === "error") {
      throw new Error(event.message);
    }
  }

  return {
    runtime,
  };
}

async function loadCodexSdk() {
  if (!codexSdkImportPromise) {
    codexSdkImportPromise = import("@openai/codex-sdk").catch((error) => {
      codexSdkImportPromise = null;
      throw error;
    });
  }
  return codexSdkImportPromise;
}

async function loadCursorSdk() {
  if (!cursorSdkImportPromise) {
    cursorSdkImportPromise = import("@cursor/sdk").catch((error) => {
      cursorSdkImportPromise = null;
      throw error;
    });
  }
  return cursorSdkImportPromise;
}

export function shouldResumeCodexThread(sessionRuntime = {}, workspaceRoot = "", executionMode = "") {
  if (!sessionRuntime?.codexThreadId) return false;
  const meta = sessionRuntime.codexThreadMeta || {};
  return meta.codexHome === codexHomePath
    && meta.workspaceRoot === workspaceRoot
    && (!executionMode || meta.executionMode === executionMode);
}

function assertCodexOfficeHoursQuestionItemAllowed(item, executionMode = "") {
  if (executionMode !== OFFICE_HOURS_QUESTION_EXECUTION_MODE || !item) return;
  if (item.type === "command_execution") {
    throw new Error("Office Hours question mode attempted command execution; refusing to fall back or continue.");
  }
  if (item.type === "web_search") {
    throw new Error("Office Hours question mode attempted web search; refusing to fall back or continue.");
  }
  if (item.type === "file_change") {
    throw new Error("Office Hours question mode attempted file changes; refusing to fall back or continue.");
  }
  if (item.type === "mcp_tool_call") {
    const toolName = String(item.tool || "");
    if (!CODEX_OFFICE_HOURS_QUESTION_TOOLS.includes(toolName)) {
      throw new Error(`Office Hours question mode attempted disallowed MCP tool "${toolName}"; refusing to fall back or continue.`);
    }
  }
}

export function mapCodexItemToToolEvent(item, lifecycle) {
  if (!item) return null;
  item = parseCodexThreadItem(item);
  if (item.type === "function_call" || item.type === "function_call_output") {
    const requestedToolName = item.name ?? item.call_name ?? item.tool ?? "function_call";
    const namespace = String(item.namespace || item.tool_namespace || "");
    const mcpServer = codexMcpServerFromFunctionNamespace(namespace);
    return {
      phase: lifecycle === "completed" ? (item.status === "failed" ? "error" : "result") : "use",
      toolName: requestedToolName,
      toolCallKey: item.call_id ?? item.id ?? requestedToolName,
      payload: {
        requestedToolName,
        ...(namespace ? { namespace } : {}),
        ...(mcpServer ? { server: mcpServer, tool: requestedToolName } : {}),
        eventItemType: item.type,
        providerMode: "codex",
        arguments: item.arguments ?? item.input ?? null,
        output: item.output ?? item.result ?? null,
      },
    };
  }
  if (item.type === "reasoning") {
    return {
      phase: "thinking",
      toolName: "reasoning",
      toolCallKey: item.id ?? "reasoning",
      payload: { text: item.text },
    };
  }
  if (item.type === "mcp_tool_call") {
    const terminalPhase = item.status === "failed" ? "error" : "result";
    const mcpDiagnostics = {
      server: item.server,
      tool: item.tool,
      status: item.status,
      errorMessage: item.error?.message || "",
    };
    return {
      phase: lifecycle === "completed" ? terminalPhase : "use",
      toolName: item.tool,
      toolCallKey: item.id ?? item.tool,
      payload: lifecycle === "completed"
        ? item.status === "failed"
          ? mcpDiagnostics
          : {
              ...mcpDiagnostics,
              result: item.result?.content ?? item.result,
            }
        : {
            ...mcpDiagnostics,
            arguments: item.arguments ?? {},
          },
    };
  }
  if (item.type === "command_execution") {
    const terminalPhase = item.status === "failed" ? "error" : "result";
    return {
      phase: lifecycle === "completed" ? terminalPhase : "use",
      toolName: "Bash",
      toolCallKey: item.id ?? "bash",
      payload: lifecycle === "completed"
        ? {
            command: item.command,
            output: item.aggregated_output,
            exitCode: item.exit_code,
          }
        : {
            command: item.command,
            output: item.aggregated_output,
          },
    };
  }
  if (item.type === "web_search") {
    return {
      phase: lifecycle === "completed" ? "result" : "use",
      toolName: "WebSearch",
      toolCallKey: item.id ?? "web_search",
      payload: { query: item.query },
    };
  }
  if (item.type === "file_change") {
    return {
      phase: item.status === "failed" ? "error" : lifecycle === "completed" ? "result" : "use",
      toolName: "FileChange",
      toolCallKey: item.id ?? "file_change",
      payload: {
        status: item.status,
        changes: item.changes ?? [],
      },
    };
  }
  if (item.type === "todo_list") {
    return {
      phase: lifecycle === "completed" ? "result" : "progress",
      toolName: "TodoList",
      toolCallKey: item.id ?? "todo_list",
      payload: { items: item.items ?? [] },
    };
  }
  if (item.type === "error") {
    return {
      phase: "error",
      toolName: "codex",
      toolCallKey: item.id ?? "error",
      payload: item.message,
    };
  }
  return null;
}

function codexMcpServerFromFunctionNamespace(namespace = "") {
  const value = String(namespace || "").trim();
  if (!value.startsWith("mcp__")) return "";
  const rawServer = value.slice("mcp__".length);
  if (rawServer === "cloudflare_api") return "cloudflare-api";
  return rawServer.replace(/_/g, "-");
}

function codexItemDiagnostics(item) {
  if (!item) {
    return {};
  }
  if (item.type === "mcp_tool_call") {
    return {
      mcpServer: item.server || "",
      mcpTool: item.tool || "",
      mcpStatus: item.status || "",
      mcpError: item.error?.message || "",
    };
  }
  if (item.type !== "function_call" && item.type !== "function_call_output") {
    return {};
  }
  const requestedToolName = item.name ?? item.call_name ?? item.tool ?? "function_call";
  return {
    requestedToolName,
    eventItemType: item.type,
    providerMode: "codex",
  };
}

export function buildCodexConfig({
  systemPromptText,
  executionMode,
  sessionIdForMcp,
  workspaceRoot,
  specialist = null,
  approvedToolExecution = false,
  posthogEnv = process.env,
}) {
  const codexVendor = specialist?.vendor?.codex;
  return {
    developer_instructions: systemPromptText,
    notify: [],
    features: {
      computer_use: false,
    },
    mcp_servers: {
      ...(usesInternalMcp(executionMode) && sessionIdForMcp
        ? {
            [internalMcpServerName]: buildCodexInternalMcpConfig(sessionIdForMcp, workspaceRoot, {
              executionMode,
              approvedToolExecution,
            }),
          }
        : {}),
      ...(allowsProviderPermissionBypass({ executionMode, approvedToolExecution })
        ? withCodexMcpApproval(buildNotionMcpConfig())
        : {}),
      ...(usesQmdMcp(executionMode) ? withCodexMcpApproval(buildQmdMcpConfig({ sidecarRoot })) : {}),
      ...(usesPostHogMcp(executionMode)
        ? withCodexMcpApproval(buildPostHogCodexMcpConfigFromSources({ appSupportPath, env: posthogEnv }))
        : {}),
      ...(usesCloudflareMcp(executionMode)
        ? withCodexMcpApproval(buildCloudflareCodexMcpConfigFromSources({ appSupportPath, env: posthogEnv }))
        : {}),
      ...(usesGithubMcp(executionMode)
        ? withCodexMcpApproval(buildGithubCodexMcpConfigFromSources({ env: posthogEnv }))
        : {}),
      ...(usesVercelMcp(executionMode)
        ? withCodexMcpApproval(buildVercelCodexMcpConfigFromSources({ env: posthogEnv }))
        : {}),
    },
    ...(codexVendor?.exists && executionMode !== OFFICE_HOURS_QUESTION_EXECUTION_MODE
      ? {
          skills: {
            include_instructions: true,
            bundled: { enabled: false },
            config: [{ path: codexVendor.skillDir, enabled: true }],
          },
        }
      : {}),
  };
}

export function buildCodexEnv(baseEnv = process.env) {
  ensureIsolatedCodexHome();
  const providerEnv = buildProviderEnv("codex", baseEnv);
  const env = applyGithubCodexEnvFromSources(applyCloudflareCodexEnvFromSources(applyPostHogCodexEnvFromSources({
    PATH: providerEnv.PATH || "/usr/bin:/bin:/usr/sbin:/sbin",
    HOME: providerEnv.HOME || os.homedir(),
    TMPDIR: providerEnv.TMPDIR || os.tmpdir(),
    LANG: providerEnv.LANG || "en_US.UTF-8",
    LC_ALL: providerEnv.LC_ALL,
    SHELL: providerEnv.SHELL,
    TERM: providerEnv.TERM,
    CODEX_HOME: codexHomePath,
    SPAWNED_SESSION: "true",
    MODEL_OVERLAY: "codex",
    AGENTIC30_SIDECAR_ROOT: sidecarRoot,
    AGENTIC30_APP_SUPPORT_PATH: appSupportPath,
    AGENTIC30_QMD_INDEX: providerEnv.AGENTIC30_QMD_INDEX || "agentic30",
    AGENTIC30_CODEX_MODEL: providerEnv.AGENTIC30_CODEX_MODEL,
    CODEX_MODEL: providerEnv.CODEX_MODEL,
    OPENAI_MODEL: providerEnv.OPENAI_MODEL,
    AGENTIC30_CODEX_REASONING_EFFORT: providerEnv.AGENTIC30_CODEX_REASONING_EFFORT,
    CODEX_REASONING_EFFORT: providerEnv.CODEX_REASONING_EFFORT,
    MODEL_REASONING_EFFORT: providerEnv.MODEL_REASONING_EFFORT,
  }, { appSupportPath, env: providerEnv }), { appSupportPath, env: providerEnv }), { env: providerEnv });
  if (providerEnv.CODEX_API_KEY) env.CODEX_API_KEY = providerEnv.CODEX_API_KEY;
  if (providerEnv.OPENAI_API_KEY) env.OPENAI_API_KEY = providerEnv.OPENAI_API_KEY;
  for (const key of Object.keys(env)) {
    if (env[key] === undefined || env[key] === "") {
      delete env[key];
    }
  }
  return env;
}

export function buildGeminiEnv(baseEnv = process.env) {
  const providerEnv = buildProviderEnv("gemini", baseEnv);
  const env = {
    PATH: providerEnv.PATH || "/usr/bin:/bin:/usr/sbin:/sbin",
    HOME: providerEnv.HOME || os.homedir(),
    TMPDIR: providerEnv.TMPDIR || os.tmpdir(),
    LANG: providerEnv.LANG || "en_US.UTF-8",
    LC_ALL: providerEnv.LC_ALL,
    SHELL: providerEnv.SHELL,
    TERM: providerEnv.TERM,
    SPAWNED_SESSION: "true",
    MODEL_OVERLAY: "gemini",
    AGENTIC30_SIDECAR_ROOT: sidecarRoot,
    AGENTIC30_APP_SUPPORT_PATH: appSupportPath,
    AGENTIC30_GEMINI_MODEL: providerEnv.AGENTIC30_GEMINI_MODEL,
    GEMINI_MODEL: providerEnv.GEMINI_MODEL,
    GOOGLE_GENAI_MODEL: providerEnv.GOOGLE_GENAI_MODEL,
    GEMINI_API_KEY: providerEnv.GEMINI_API_KEY,
    GOOGLE_API_KEY: providerEnv.GOOGLE_API_KEY,
    GOOGLE_GENAI_USE_VERTEXAI: providerEnv.GOOGLE_GENAI_USE_VERTEXAI,
    GOOGLE_CLOUD_PROJECT: providerEnv.GOOGLE_CLOUD_PROJECT,
    GOOGLE_CLOUD_LOCATION: providerEnv.GOOGLE_CLOUD_LOCATION,
    GOOGLE_APPLICATION_CREDENTIALS: providerEnv.GOOGLE_APPLICATION_CREDENTIALS,
  };
  for (const key of Object.keys(env)) {
    if (env[key] === undefined || env[key] === "") {
      delete env[key];
    }
  }
  return env;
}

export function buildCursorEnv(baseEnv = process.env) {
  const providerEnv = buildProviderEnv("cursor", baseEnv);
  const env = {
    PATH: providerEnv.PATH || "/usr/bin:/bin:/usr/sbin:/sbin",
    HOME: providerEnv.HOME || os.homedir(),
    TMPDIR: providerEnv.TMPDIR || os.tmpdir(),
    LANG: providerEnv.LANG || "en_US.UTF-8",
    LC_ALL: providerEnv.LC_ALL,
    SHELL: providerEnv.SHELL,
    TERM: providerEnv.TERM,
    SPAWNED_SESSION: "true",
    MODEL_OVERLAY: "cursor",
    AGENTIC30_SIDECAR_ROOT: sidecarRoot,
    AGENTIC30_APP_SUPPORT_PATH: appSupportPath,
    AGENTIC30_CURSOR_MODEL: providerEnv.AGENTIC30_CURSOR_MODEL,
    CURSOR_MODEL: providerEnv.CURSOR_MODEL,
    CURSOR_API_KEY: providerEnv.CURSOR_API_KEY,
  };
  for (const key of Object.keys(env)) {
    if (env[key] === undefined || env[key] === "") {
      delete env[key];
    }
  }
  return env;
}

export function buildProviderEnv(provider, baseEnv = process.env) {
  const settings = providerSettings[provider] || {};
  const parsed = parseProviderEnvironment(settings.environment);
  const env = {
    ...baseEnv,
    ...parsed,
  };
  if (settings.authMode === "api_key" && settings.apiKey) {
    if (provider === "claude") {
      env.ANTHROPIC_API_KEY = settings.apiKey;
    } else if (provider === "codex") {
      env.CODEX_API_KEY = settings.apiKey;
      env.OPENAI_API_KEY = settings.apiKey;
    } else if (provider === "gemini") {
      env.GEMINI_API_KEY = settings.apiKey;
      env.GOOGLE_API_KEY = settings.apiKey;
    } else if (provider === "cursor") {
      env.CURSOR_API_KEY = settings.apiKey;
    }
  }
  if (settings.model) {
    if (provider === "claude") {
      env.AGENTIC30_CLAUDE_MODEL = settings.model;
    } else if (provider === "codex") {
      env.AGENTIC30_CODEX_MODEL = settings.model;
    } else if (provider === "gemini") {
      env.AGENTIC30_GEMINI_MODEL = settings.model;
      env.GEMINI_MODEL = settings.model;
    } else if (provider === "cursor") {
      env.AGENTIC30_CURSOR_MODEL = settings.model;
      env.CURSOR_MODEL = settings.model;
    }
  }
  return env;
}

export function parseProviderEnvironment(value = "") {
  const env = {};
  for (const rawLine of String(value || "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) continue;
    const key = line.slice(0, separatorIndex).trim();
    const rawValue = line.slice(separatorIndex + 1).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    env[key] = stripEnvQuotes(rawValue);
  }
  return env;
}

function stripEnvQuotes(value = "") {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function ensureIsolatedCodexHome() {
  try {
    fsSync.mkdirSync(codexHomePath, { recursive: true });
    const configPath = path.join(codexHomePath, "config.toml");
    if (!fsSync.existsSync(configPath)) {
      fsSync.writeFileSync(
        configPath,
        [
          "# Managed by agentic30. Do not read ~/.codex/config.toml from sidecar runs.",
          "notify = []",
          "",
          "[features]",
          "computer_use = false",
          "",
          "[mcp_servers]",
          "",
        ].join("\n"),
      );
    }
    syncCodexAuthIntoIsolatedHome();
  } catch {
    // Codex can still run with SDK-provided API keys if local auth mirroring fails.
  }
}

function syncCodexAuthIntoIsolatedHome() {
  const source = path.join(os.homedir(), ".codex", "auth.json");
  const target = path.join(codexHomePath, "auth.json");
  if (!fsSync.existsSync(source)) {
    return;
  }
  try {
    const sourceStat = fsSync.statSync(source);
    const targetStat = fsSync.existsSync(target) ? fsSync.statSync(target) : null;
    if (targetStat && targetStat.mtimeMs >= sourceStat.mtimeMs && targetStat.size === sourceStat.size) {
      return;
    }
    fsSync.copyFileSync(source, target);
    fsSync.chmodSync(target, 0o600);
  } catch {
    // Local Codex auth is optional when API keys are configured.
  }
}

export function resolveCodexModel(model = "") {
  return String(
    model
      || process.env.AGENTIC30_CODEX_MODEL
      || process.env.CODEX_MODEL
      || process.env.OPENAI_MODEL
      || providerSettings.codex?.model
      || DEFAULT_CODEX_MODEL,
  ).trim();
}

export function resolveGeminiModel(model = "") {
  const env = buildProviderEnv("gemini");
  return String(
    model
      || env.AGENTIC30_GEMINI_MODEL
      || env.GEMINI_MODEL
      || env.GOOGLE_GENAI_MODEL
      || providerSettings.gemini?.model
      || DEFAULT_GEMINI_MODEL,
  ).trim();
}

export function resolveCursorModel(model = "") {
  const env = buildProviderEnv("cursor");
  return String(
    model
      || env.AGENTIC30_CURSOR_MODEL
      || env.CURSOR_MODEL
      || providerSettings.cursor?.model
      || DEFAULT_CURSOR_MODEL,
  ).trim();
}

export function resolveClaudeModel(model = "") {
  const env = buildProviderEnv("claude");
  return String(
    model
      || env.ANTHROPIC_MODEL
      || providerSettings.claude?.model
      || DEFAULT_CLAUDE_MODEL,
  ).trim();
}

export { DEFAULT_CLAUDE_MODEL };

export function supportsGeminiExecutionMode(executionMode = "") {
  return GEMINI_CAPABLE_EXECUTION_MODES.has(String(executionMode || ""));
}

export function supportsCursorExecutionMode(executionMode = "") {
  return CURSOR_CAPABLE_EXECUTION_MODES.has(String(executionMode || ""));
}

export function resolveCodexReasoningEffort({ executionMode = "", prompt = "" } = {}) {
  if (executionMode === "workspace_scan_read_only") {
    // Codex rejects reasoning.effort=minimal when its default tool set includes
    // image_gen. Keep the scan lightweight, but force the lowest compatible
    // effort regardless of env/settings overrides.
    return "low";
  }
  const configured = String(
    process.env.AGENTIC30_CODEX_REASONING_EFFORT
      || process.env.CODEX_REASONING_EFFORT
      || process.env.MODEL_REASONING_EFFORT
      || "",
  ).trim();
  if (CODEX_REASONING_EFFORTS.has(configured)) {
    return configured;
  }
  // Explicit user choice from Settings (provider_settings_update) beats the
  // execution-mode heuristic below; empty/auto falls through to the heuristic.
  const fromSettings = providerSettings.codex?.reasoningEffort || "";
  if (CODEX_REASONING_EFFORTS.has(fromSettings)) {
    return fromSettings;
  }
  const text = String(prompt || "").toLowerCase();
  const hasDeepWorkSignal = /debug|diagnos|root cause|investigate|analy[sz]e|implement|refactor|architecture|security|test|failure|failing|broken|복잡|분석|구현|리팩터|테스트|장애|오류|보안/.test(text);
  const hasLightWorkSignal = /quick|brief|summari[sz]e|간단|짧게|요약/.test(text);

  if (executionMode === "office_hours_digest_read_only") {
    return "low";
  }
  if (executionMode === OFFICE_HOURS_QUESTION_EXECUTION_MODE) {
    return "low";
  }
  if (executionMode === "isolated_read_only") {
    return hasDeepWorkSignal ? "medium" : "low";
  }
  if (executionMode === "judge_read_only") {
    return hasDeepWorkSignal ? "high" : "medium";
  }
  if (executionMode === "idd_question_synthesis") {
    return "low";
  }
  if (executionMode === "memory_chat") {
    return hasDeepWorkSignal ? "high" : "medium";
  }
  if (executionMode === "bip_coach_read_only") {
    return hasLightWorkSignal ? "high" : "xhigh";
  }
  if (executionMode === MINI_ACTION_EXECUTION_ONLY_MODE) {
    return "high";
  }
  if (executionMode === "agentic") {
    return hasLightWorkSignal && !hasDeepWorkSignal ? "medium" : "high";
  }
  return hasDeepWorkSignal ? "high" : "medium";
}

// Claude Agent SDK `options.effort`. Returns "" when neither env nor Settings
// pins a level, leaving the SDK default (high) in charge. The SDK silently
// downgrades unsupported levels per model, so no per-model table is needed here.
export function resolveClaudeReasoningEffort() {
  const configured = String(process.env.AGENTIC30_CLAUDE_REASONING_EFFORT || "")
    .trim()
    .toLowerCase();
  if (CLAUDE_REASONING_EFFORTS.has(configured)) {
    return configured;
  }
  const fromSettings = providerSettings.claude?.reasoningEffort || "";
  if (CLAUDE_REASONING_EFFORTS.has(fromSettings)) {
    return fromSettings;
  }
  return "";
}

// Claude Agent SDK `options.maxTurns`. The default interactive chat lane needs
// plenty of agentic turns, but the read-only workspace scanner has a tight
// happy path — discover docs, batch-read candidates, emit JSON — so it gets a
// hard low ceiling to stop a confused model from looping for minutes.
export function resolveClaudeMaxTurns(executionMode = "") {
  if (executionMode === "workspace_scan_read_only") {
    return WORKSPACE_SCAN_MAX_TURNS;
  }
  return DEFAULT_CLAUDE_MAX_TURNS;
}

// Gemini `thinkingConfig.thinkingLevel` (SDK enum strings, e.g. "LOW"). Returns
// "" for the 2.5 series (thinkingBudget-only) and when nothing is configured,
// so callers omit thinkingConfig entirely and keep the model default. Gemini 3
// Pro rejects "minimal" — coerce to "low" instead of failing the request.
export function resolveGeminiThinkingLevel(model = "") {
  const resolvedModel = resolveGeminiModel(model);
  if (!/^gemini-3/.test(resolvedModel)) {
    return "";
  }
  const configured = String(process.env.AGENTIC30_GEMINI_THINKING_LEVEL || "")
    .trim()
    .toLowerCase();
  const fromSettings = providerSettings.gemini?.reasoningEffort || "";
  let candidate = "";
  if (GEMINI_THINKING_LEVELS.has(configured)) {
    candidate = configured;
  } else if (GEMINI_THINKING_LEVELS.has(fromSettings)) {
    candidate = fromSettings;
  }
  if (!candidate) {
    return "";
  }
  if (candidate === "minimal" && /^gemini-3-pro/.test(resolvedModel)) {
    candidate = "low";
  }
  return candidate.toUpperCase();
}

function buildStubResponse(prompt) {
  const contexts = extractStubContextFiles(prompt);
  const value = String(prompt || "");
  if (value.includes("MORNING_BRIEFING_VERDICT_JSON")) {
    const numberFor = (pattern, fallback = 0) => {
      const match = value.match(pattern);
      const number = Number(match?.[1]);
      return Number.isFinite(number) ? number : fallback;
    };
    const commits = numberFor(/\bcommits[=\s:]+(\d+)/i, 0);
    const visits = numberFor(/\b(?:visits|uniqueVisitors)[=\s:]+(\d+)/i, 0);
    const conversions = numberFor(/\bconversions[=\s:]+(\d+)/i, 0);
    return JSON.stringify({
      state: conversions > 0 ? "healthy" : (visits > 0 ? "traffic_without_activation" : "build_without_customer_evidence"),
      title: conversions > 0
        ? "고객 행동 근거가 잡혔고 다음 공백을 좁힐 차례예요."
        : "빌드와 유입은 보이지만 고객 행동 근거가 아직 얇아요.",
      body: conversions > 0
        ? "Day 1 목표와 Office Hours 약속 기준으로 확인된 행동을 다음 질문과 실험으로 좁히면 됩니다."
        : "Day 1 목표와 Office Hours 약속 기준으로 Cloudflare 유입 이후 PostHog 첫 핵심 행동까지 연결되는지 먼저 확인해야 합니다.",
      primaryActionId: conversions > 0 ? "experiment" : "task",
      evidence: [
        `GitHub commits ${commits} 집계가 있습니다.`,
        `Cloudflare visits ${visits} 집계가 있습니다.`,
        `PostHog conversions ${conversions} 집계가 있습니다.`,
      ],
    });
  }
  if (
    process.env.AGENTIC30_TEST_STUB_MORNING_BRIEFING_EXTERNAL_DIGEST === "ready"
    && value.includes("Agentic30 Day 2+ Office Hours source digest")
  ) {
    const sourcesLine = value.match(/^Sources:\s*(.+)$/im)?.[1] || "";
    const wanted = sourcesLine
      .split(",")
      .map((source) => source.trim().toLowerCase())
      .filter(Boolean);
    return JSON.stringify({
      sources: wanted.map((source) => {
        if (source === "cloudflare") {
          return {
            id: "cloudflare",
            state: "ready",
            counts: { visits: 64, uniqueVisitors: 64, pageviews: 128, requests: 512, threats: 0 },
            highlights: ["Cloudflare 순 방문 64명 · 요청 512건"],
            summary: "Cloudflare 순 방문 64명",
            goalSignals: ["랜딩 방문이 유지됨"],
            evidenceGaps: ["방문 이후 핵심 행동 연결 필요"],
          };
        }
        return {
          id: "posthog",
          state: "ready",
          counts: { events: 26, activeUsers: 1, conversions: 0, signups: 0 },
          highlights: ["PostHog 활성 사용자 1명 · 전환 0건"],
          summary: "PostHog 활성 사용자 1명",
          goalSignals: ["첫 핵심 행동 사용자 1명"],
          evidenceGaps: ["전환 0건"],
        };
      }),
    });
  }
  if (/Agentic30 Day 1 STEP Office Hours|Office Hours를 시작한다/i.test(value)) {
    return [
      "Office Hours 질문을 선택지 카드로 준비했습니다.",
      INLINE_DECISION_SENTINEL_START,
      JSON.stringify({
        header: "수요 증거",
        intent: "demand",
        question: "Agentic30 수요를 실제 행동으로 확인한 가장 강한 증거는 무엇인가요?",
        helperText: "느낌이나 칭찬이 아니라 날짜와 행동으로 설명할 수 있는 증거를 고릅니다.",
        options: [
          {
            label: "실제 결제/계약이 있었다",
            description: "돈이 이미 움직였으므로 가장 강한 수요 증거입니다.",
          },
          {
            label: "구매 조건이 구체적으로 확인됐다",
            description: "가격, 범위, 일정 조건이 있으면 다음 검증은 실제 결제 전환입니다.",
          },
          {
            label: "현재 대안에 돈/시간을 쓰고 있다",
            description: "유료 대안이나 반복 행동이 있어도 전환 이유와 대체 우위는 남습니다.",
          },
          {
            label: "관심만 있거나 아직 증거가 없다",
            description: "칭찬, 가격 질문, 막연한 관심은 수요가 아니며 첫 행동 증거가 필요합니다.",
          },
        ],
        multiSelect: false,
        allowFreeText: true,
        requiresFreeText: false,
        textMode: "short",
      }),
      INLINE_DECISION_SENTINEL_END,
    ].join("\n");
  }
  if (/ICP\.md 문서 어디에 있어\?/i.test(value) && value.includes(`ICP doc: ${projectDocPath("icp")}`)) {
    return `\`ICP.md\`는 현재 BIP 설정 기준으로 \`${projectDocPath("icp")}\`에 있습니다.`;
  }
  if ((value.includes(`### ICP: ${projectDocPath("icp")}`) || value.includes("DAY1_ICP_TURN")) && /Day\s*1|Day 1|1일차/i.test(value)) {
    return [
      "ICP.md 확인: 전업 1인 개발자, 수익 0원, macOS, 고객 인터뷰 의향이 있으면 ICP 조건부 합격입니다.",
      "Day 1 응답: builder-state 진단을 먼저 하고, 기존 자산이 있으면 blank-slate discovery 대신 fast path로 SPEC.md v0 proof baseline과 다음 proof target을 정합니다.",
      "Day 7 readiness: 이번 주 안에 첫 사용자/수익 경로를 좁힐 기준 숫자 1개를 정하고, 반응이 없으면 질문을 바꿉니다.",
      "다음 액션: 오늘 고객 1명에게 반복 문제를 묻고 답변 원문을 SPEC.md에 붙입니다.",
      "증거 목표: 응답 1개를 확보한 뒤 그 응답 원문을 담은 Threads BIP 공개 proof URL 1개를 남깁니다.",
    ].join("\n");
  }

  // Workspace-scan verification prompt (runWorkspaceScanAgent): the stub must
  // emulate a healthy provider returning the semantic-only JSON shape. Anything
  // unparseable or unsupported now blocks the scan (fail-closed), which is the
  // production behavior but would wedge hermetic onboarding tests.
  if (/LOCAL_EVIDENCE_BUNDLE_JSON/i.test(value) || /Scan the current workspace for these project documents and return only JSON/i.test(value)) {
    return buildStubWorkspaceScanResponse(value);
  }

  if (!contexts.length) {
    const preview = value.trim().slice(0, 120) || "테스트 프롬프트";
    return `테스트 응답: ${preview} 확인했습니다.`;
  }

  const primary = contexts[0];
  return JSON.stringify({
    message: `Stub edit prepared for ${primary.displayName}`,
    edits: [
      {
        fileId: primary.fileId,
        content: `${primary.content}\n\n<!-- Stub ACP edit -->\n`,
      },
    ],
  });
}

function buildStubWorkspaceScanResponse(prompt) {
  const bundle = extractStubWorkspaceScanEvidenceBundle(prompt);
  const evidencePathsUsed = collectStubWorkspaceScanEvidencePaths(bundle);
  const confidence = evidencePathsUsed.length >= 2 ? "high" : evidencePathsUsed.length === 1 ? "medium" : "low";
  return JSON.stringify({
    onboardingHypothesis: {
      productName: "",
      projectKind: "unknown",
      targetUser: "",
      problem: "",
      purpose: "",
      goal: "",
      values: "",
      likelyUsers: [],
      stage: "unknown",
      evidence: evidencePathsUsed.slice(0, 5),
      confidence,
      suggestedFirstQuestion: "",
    },
    situationSignals: {
      channels: [],
      analyticsTools: [],
      events: [],
      customerActions: [],
      currentAlternatives: [],
      conversionSignals: [],
      missingAssumptions: [],
    },
    confidence,
    evidencePathsUsed,
  });
}

function extractStubWorkspaceScanEvidenceBundle(prompt) {
  const marker = "LOCAL_EVIDENCE_BUNDLE_JSON:";
  const markerIndex = String(prompt || "").indexOf(marker);
  if (markerIndex === -1) return null;
  const jsonText = String(prompt).slice(markerIndex + marker.length).trim();
  try {
    return JSON.parse(jsonText);
  } catch {
    return null;
  }
}

function collectStubWorkspaceScanEvidencePaths(bundle) {
  const paths = [];
  const seen = new Set();
  const push = (value) => {
    const text = String(value || "").trim();
    const key = text.toLowerCase();
    if (!text || seen.has(key)) return;
    seen.add(key);
    paths.push(text);
  };
  for (const doc of Object.values(bundle?.canonicalDocs || {})) {
    if (doc?.found === true) push(doc.path);
  }
  for (const ref of bundle?.evidenceRefs || []) {
    push(ref?.path);
  }
  return paths.slice(0, 8);
}

async function createStubIddUserInputRequest({
  sessionRuntime,
  sessionIdForMcp,
} = {}) {
  const pending = sessionRuntime?.iddPendingAdaptiveContinuation;
  if (!sessionIdForMcp || !pending?.docType || !pending?.prompt) {
    return null;
  }
  const docTitleByType = {
    icp: "ICP",
    goal: "GOAL",
    values: "VALUES",
    spec: "SPEC",
  };
  const title = docTitleByType[pending.docType] || "Foundation";
  // This is the only writer that persists generation.mode "provider_adaptive"
  // to disk. syncPendingUserInputRequests() checks isMissingIcpContextIntro()
  // on the raw on-disk request before any attach-time decoration runs, so an
  // undecorated ICP card here would be restarted, regenerated identically, and
  // restarted again — an infinite loop. Decorate at write time, like every
  // other ICP card writer.
  const payload = {
    sessionId: sessionIdForMcp,
    toolName: CODEX_STRUCTURED_INPUT_TOOL,
    title: `${title} adaptive follow-up`,
    generation: {
      mode: "provider_adaptive",
      docType: pending.docType,
    },
    questions: [
      {
        header: "근거 보완",
        helperText: "agentic30-public의 SwiftUI macOS 앱과 Node sidecar 구조를 기준으로 생성한 adaptive 질문입니다.",
        question: `${title} 문서를 다음 단계로 넘기려면 Codex/Claude provider와 30일 커리큘럼 흐름 중 어떤 실제 근거를 한 줄로 고정할까요?`,
        options: [
          {
            label: "SwiftUI 앱 사용자",
            description: "macOS 메뉴바/패널에서 겪는 실제 작업 흐름으로 보완합니다.",
          },
          {
            label: "Node sidecar 통합",
            description: "provider 실행, MCP 도구, 세션 저장 중 하나의 제약으로 보완합니다.",
          },
          {
            label: "30일 커리큘럼 Day 1",
            description: "Foundation Setup에서 다음 문서로 넘어가는 판단 기준으로 보완합니다.",
          },
        ],
        multiSelect: false,
        allowFreeText: true,
        requiresFreeText: false,
        freeTextPlaceholder: "예: Day 1 사용자가 sidecar 인증 실패를 겪으면 onboarding 질문보다 provider recovery를 먼저 보여준다",
        textMode: "short",
      },
    ],
  };
  return createUserInputRequest(
    appSupportPath,
    pending.docType === "icp" ? decorateIcpStructuredInput(payload) : payload,
  );
}

async function createStubOfficeHoursUserInputRequest({ sessionIdForMcp } = {}) {
  if (!sessionIdForMcp) return null;
  return createUserInputRequest(appSupportPath, {
    sessionId: sessionIdForMcp,
    toolName: CODEX_STRUCTURED_INPUT_TOOL,
    title: "Office Hours",
    generation: {
      mode: "office_hours_tool",
      signalId: "office_hours_demand_evidence",
      signalLabel: "Office Hours Q1 수요 증거",
    },
    questions: [
      {
        questionId: "office_hours_demand_evidence",
        header: "수요 증거",
        question: "Agentic30 수요를 실제 행동으로 확인한 가장 강한 증거는 무엇인가요?",
        helperText: "느낌이나 칭찬이 아니라 날짜와 행동으로 설명할 수 있는 증거를 고릅니다.",
        options: [
          {
            label: "실제 결제/계약이 있었다",
            description: "돈이 이미 움직였으므로 가장 강한 수요 증거입니다.",
          },
          {
            label: "구매 조건이 구체적으로 확인됐다",
            description: "가격, 범위, 일정 조건이 있으면 다음 검증은 실제 결제 전환입니다.",
          },
          {
            label: "현재 대안에 돈/시간을 쓰고 있다",
            description: "유료 대안이나 반복 행동이 있어도 전환 이유와 대체 우위는 남습니다.",
          },
          {
            label: "관심만 있거나 아직 증거가 없다",
            description: "칭찬, 가격 질문, 막연한 관심은 수요가 아니며 첫 행동 증거가 필요합니다.",
          },
        ],
        multiSelect: false,
        allowFreeText: true,
        requiresFreeText: false,
        textMode: "short",
      },
    ],
  });
}

function emitStubOfficeHoursMcpResultOnly({ provider, onToolEvent } = {}) {
  const requestId = "stub-office-hours-result-only";
  const question = {
    questionId: "office_hours_demand_evidence",
    header: "수요 증거",
    question: "Agentic30 수요를 실제 행동으로 확인한 가장 강한 증거는 무엇인가요?",
    options: [
      {
        label: "아직 보내지 못했다",
        description: "실제 고객 행동 증거는 아직 없고, 오늘 바로 외부 행동을 만들어야 합니다.",
      },
      {
        label: "실제 결제/계약이 있었다",
        description: "돈이 이미 움직였으므로 가장 강한 수요 증거입니다.",
      },
    ],
    multiSelect: false,
    allowFreeText: true,
    requiresFreeText: false,
    textMode: "short",
  };
  const generation = {
    mode: "office_hours_tool",
    signalId: "office_hours_demand_evidence",
    signalLabel: "Office Hours 수요 증거",
  };
  const toolCallKey = "stub-office-hours-result-only-call";
  onToolEvent?.({
    phase: "use",
    toolName: CODEX_STRUCTURED_INPUT_TOOL,
    toolCallKey,
    payload: {
      requestedToolName: CODEX_STRUCTURED_INPUT_TOOL,
      providerMode: provider || "codex",
      arguments: {
        title: "Office Hours",
        generation,
        questions: [question],
      },
    },
  });
  onToolEvent?.({
    phase: "result",
    toolName: CODEX_STRUCTURED_INPUT_TOOL,
    toolCallKey,
    payload: {
      requestedToolName: CODEX_STRUCTURED_INPUT_TOOL,
      providerMode: provider || "codex",
      result: {
        type: "text",
        text: JSON.stringify(buildPendingUserInputToolOutput({
          requestId,
          title: "Office Hours",
          questions: [question],
        })),
      },
    },
  });
}

async function delayTestStubOfficeHoursMcpRequestIfNeeded() {
  const delayMs = Number.parseInt(
    String(process.env.AGENTIC30_TEST_STUB_OFFICE_HOURS_MCP_REQUEST_DELAY_MS || ""),
    10,
  );
  if (!Number.isFinite(delayMs) || delayMs <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, Math.min(delayMs, 5_000)));
}

async function delayTestStubProviderIfNeeded() {
  const delayMs = Number.parseInt(
    String(process.env.AGENTIC30_TEST_STUB_PROVIDER_DELAY_MS || ""),
    10,
  );
  if (!Number.isFinite(delayMs) || delayMs <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, Math.min(delayMs, 5_000)));
}

function extractStubContextFiles(prompt) {
  const results = [];
  const matcher = /<<FILE_ID:(.+?)>>\nDisplay name: (.+?)\n([\s\S]*?)\n<<END_FILE>>/g;
  let match = matcher.exec(prompt);
  while (match) {
    results.push({
      fileId: match[1].trim(),
      displayName: match[2].trim(),
      content: match[3],
    });
    match = matcher.exec(prompt);
  }
  return results;
}

async function runGeminiProvider({
  sessionRuntime,
  prompt,
  model,
  workspaceRoot,
  abortController,
  executionMode,
  systemPromptOverride,
  approvedToolExecution = false,
  onTextDelta,
  onTextReplace,
  onToolEvent,
  onRuntimeUpdate,
  onRunEvent,
  structuredOutputSchema = null,
}) {
  let runtime = { ...sessionRuntime };
  onRunEvent?.({ phase: "provider.gemini.prepare_start" });
  const env = buildGeminiEnv();
  const useVertex = env.GOOGLE_GENAI_USE_VERTEXAI === "true" || env.GOOGLE_GENAI_USE_VERTEXAI === "1";
  const apiKey = env.GEMINI_API_KEY || env.GOOGLE_API_KEY || "";
  if (!useVertex && !apiKey) {
    throw new Error(
      "Gemini provider requires GOOGLE_API_KEY or GEMINI_API_KEY (or Vertex AI configuration).",
    );
  }
  const systemPromptText = buildSystemPromptText({
    provider: "gemini",
    workspaceRoot,
    executionMode,
    systemPromptOverride,
  });
  const resolvedModel = resolveGeminiModel(model);
  const ai = useVertex
    ? new GoogleGenAI({
        vertexai: true,
        project: env.GOOGLE_CLOUD_PROJECT,
        location: env.GOOGLE_CLOUD_LOCATION,
      })
    : new GoogleGenAI({ apiKey });
  onRunEvent?.({
    phase: "provider.gemini.client_created",
    model: resolvedModel,
    backend: useVertex ? "vertex" : "genai",
    approvedToolExecution: Boolean(approvedToolExecution),
  });

  const thinkingLevel = resolveGeminiThinkingLevel(resolvedModel);
  const stream = await ai.models.generateContentStream({
    model: resolvedModel,
    contents: prompt,
    config: {
      systemInstruction: systemPromptText,
      ...(thinkingLevel ? { thinkingConfig: { thinkingLevel } } : {}),
      ...(hasStructuredOutputSchema(structuredOutputSchema)
        ? {
            responseMimeType: "application/json",
            responseJsonSchema: structuredOutputSchema,
          }
        : {}),
    },
    abortSignal: abortController?.signal,
  });
  onRunEvent?.({
    phase: "provider.gemini.stream_opened",
    promptChars: String(prompt || "").length,
  });

  let accumulated = "";
  let firstTextEmitted = false;
  for await (const chunk of stream) {
    if (abortController?.signal?.aborted) {
      throw new Error("Gemini stream aborted");
    }
    const text = extractGeminiChunkText(chunk);
    if (text) {
      if (!firstTextEmitted) {
        onRunEvent?.({ phase: "provider.gemini.first_text" });
        firstTextEmitted = true;
      }
      accumulated += text;
      onTextDelta?.(text);
    }
    const toolEvents = extractGeminiFunctionCalls(chunk);
    for (const event of toolEvents) {
      onToolEvent?.(event);
    }
  }

  onTextReplace?.(accumulated);
  onRunEvent?.({
    phase: "provider.gemini.completed",
    textLength: accumulated.length,
  });
  onRuntimeUpdate?.(runtime);
  return { runtime };
}

export function extractGeminiChunkText(chunk) {
  if (!chunk) return "";
  if (typeof chunk.text === "string") {
    return chunk.text;
  }
  if (typeof chunk.text === "function") {
    const result = chunk.text();
    if (typeof result === "string") return result;
  }
  const candidates = Array.isArray(chunk.candidates) ? chunk.candidates : [];
  let collected = "";
  for (const candidate of candidates) {
    const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];
    for (const part of parts) {
      if (typeof part?.text === "string") {
        collected += part.text;
      }
    }
  }
  return collected;
}

export function extractGeminiFunctionCalls(chunk) {
  if (!chunk) return [];
  const events = [];
  const direct = Array.isArray(chunk.functionCalls) ? chunk.functionCalls : [];
  for (const call of direct) {
    events.push(buildGeminiToolEvent(call));
  }
  const candidates = Array.isArray(chunk.candidates) ? chunk.candidates : [];
  for (const candidate of candidates) {
    const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];
    for (const part of parts) {
      if (part?.functionCall) {
        events.push(buildGeminiToolEvent(part.functionCall));
      }
    }
  }
  return events;
}

function buildGeminiToolEvent(call) {
  const name = call?.name || "function_call";
  return {
    phase: "use",
    toolName: name,
    toolCallKey: call?.id || name,
    payload: call?.args ?? call?.arguments ?? {},
  };
}

async function runCursorProvider({
  sessionRuntime,
  prompt,
  model,
  workspaceRoot,
  abortController,
  executionMode,
  systemPromptOverride,
  onTextDelta,
  onTextReplace,
  onToolEvent,
  onRuntimeUpdate,
  onRunEvent,
}) {
  const runtime = { ...sessionRuntime };
  onRunEvent?.({ phase: "provider.cursor.prepare_start" });
  const env = buildCursorEnv();
  const apiKey = env.CURSOR_API_KEY || "";
  if (!apiKey) {
    throw new Error("Cursor provider를 사용하려면 CURSOR_API_KEY 또는 설정의 Cursor API 키가 필요합니다.");
  }
  const systemPromptText = buildSystemPromptText({
    provider: "cursor",
    workspaceRoot,
    executionMode,
    systemPromptOverride,
  });
  const resolvedModel = resolveCursorModel(model);
  const { Agent } = await loadCursorSdk();
  onRunEvent?.({ phase: "provider.cursor.sdk_loaded" });
  // The Cursor SDK has no system-prompt option on send(); the system text
  // rides at the top of the user prompt instead.
  const promptText = systemPromptText ? `${systemPromptText}\n\n${prompt}` : prompt;
  const agent = await Agent.create({
    apiKey,
    model: { id: resolvedModel },
    local: { cwd: workspaceRoot || process.cwd() },
  });
  onRunEvent?.({
    phase: "provider.cursor.client_created",
    model: resolvedModel,
  });
  try {
    const run = await agent.send(promptText);
    onRunEvent?.({
      phase: "provider.cursor.stream_opened",
      promptChars: String(prompt || "").length,
    });
    if (abortController?.signal) {
      const cancelRun = () => {
        Promise.resolve(run.cancel?.()).catch(() => {});
      };
      if (abortController.signal.aborted) {
        cancelRun();
      } else {
        abortController.signal.addEventListener("abort", cancelRun, { once: true });
      }
    }
    let accumulated = "";
    let firstTextEmitted = false;
    for await (const message of run.stream()) {
      if (abortController?.signal?.aborted) {
        throw new Error("Cursor stream aborted");
      }
      if (message?.type === "assistant") {
        const blocks = Array.isArray(message?.message?.content) ? message.message.content : [];
        for (const block of blocks) {
          if (block?.type !== "text" || !block.text) continue;
          if (!firstTextEmitted) {
            onRunEvent?.({ phase: "provider.cursor.first_text" });
            firstTextEmitted = true;
          }
          accumulated += block.text;
          onTextDelta?.(block.text);
        }
      } else if (message?.type === "tool_call") {
        onToolEvent?.({
          phase: message.status === "running" ? "use" : "result",
          toolName: message.name || "tool_call",
          toolCallKey: message.call_id || message.name || "tool_call",
          payload: message.args ?? {},
        });
      } else if (message?.type === "status" && message.status === "ERROR") {
        throw new Error(message.message || "Cursor run failed");
      }
    }
    // A stream can end without a terminal status message — surface run-level
    // failures (auth, rate limit) that only the awaited result carries.
    const result = await run.wait().catch((error) => {
      throw error instanceof Error ? error : new Error(String(error));
    });
    if (result?.status === "error") {
      throw new Error(result.result || "Cursor run failed");
    }
    onTextReplace?.(accumulated);
    onRunEvent?.({
      phase: "provider.cursor.completed",
      textLength: accumulated.length,
    });
    onRuntimeUpdate?.(runtime);
    return { runtime };
  } finally {
    try {
      agent.close();
    } catch {
      // close() failures must not mask the run outcome.
    }
  }
}

async function runTextOnlyProvider({
  provider,
  prompt,
  model,
  abortController,
  onTextReplace,
}) {
  if (provider === "claude") {
    const env = buildProviderEnv("claude");
    const apiKey = readApiKey("claude", env);
    if (!apiKey) {
      throw new Error("ACP Claude 모드를 사용하려면 ANTHROPIC_API_KEY가 필요합니다.");
    }

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: resolveClaudeModel(model),
        max_tokens: 4000,
        system: RESPONSE_LANGUAGE_INSTRUCTION,
        messages: [
          {
            role: "user",
            content: prompt,
          },
        ],
      }),
      signal: abortController.signal,
    });

    if (!response.ok) {
      throw new Error(`Anthropic API request failed with ${response.status}.`);
    }

    const payload = await response.json();
    const text = Array.isArray(payload?.content)
      ? payload.content
          .filter((item) => item?.type === "text" && typeof item.text === "string")
          .map((item) => item.text)
          .join("")
      : "";

    onTextReplace?.(text);
    return;
  }

  const env = buildProviderEnv("codex");
  const apiKey = readApiKey("codex", env);
  if (!apiKey) {
    throw new Error("ACP Codex mode requires CODEX_API_KEY or OPENAI_API_KEY.");
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: model || env.OPENAI_MODEL || DEFAULT_CODEX_MODEL,
      instructions: RESPONSE_LANGUAGE_INSTRUCTION,
      input: prompt,
    }),
    signal: abortController.signal,
  });

  if (!response.ok) {
    throw new Error(`OpenAI API request failed with ${response.status}.`);
  }

  const payload = await response.json();
  const text =
    payload?.output_text ||
    payload?.output
      ?.flatMap((entry) => entry?.content || [])
      ?.filter((item) => item?.type === "output_text" && typeof item.text === "string")
      ?.map((item) => item.text)
      ?.join("") ||
    "";

  onTextReplace?.(text);
}

export function resolveCodexCli({
  env = process.env,
  packageRootResolver = resolveExistingInstalledPackageRoot,
  fsImpl = fsSync,
  spawnSyncImpl = spawnSync,
  shellLookup = defaultCodexShellLookup,
  commonPaths = defaultCodexCommonPaths(os.homedir()),
} = {}) {
  const minimumVersion = resolveMinimumCodexCliVersion({ packageRootResolver });
  const bundledCandidate = resolveBundledCodexCandidate({ packageRootResolver, fsImpl });
  const candidates = [
    env.AGENTIC30_CODEX_BINARY
      ? { path: env.AGENTIC30_CODEX_BINARY, source: "env" }
      : null,
    shellLookup ? { path: shellLookup(), source: "shell" } : null,
    ...commonPaths.map((candidate) => ({ path: candidate, source: "common-path" })),
    bundledCandidate,
  ].filter((candidate) => candidate?.path);

  const rejected = [];
  for (const candidate of candidates) {
    const resolvedPath = expandHome(candidate.path, os.homedir());
    if (!fsImpl.existsSync(resolvedPath)) {
      rejected.push({ ...candidate, path: resolvedPath, reason: "missing" });
      continue;
    }
    const version = readCodexCliVersion(resolvedPath, { spawnSyncImpl });
    const minimumVersionSatisfied = isMinimumVersionSatisfied(version, minimumVersion);
    if (!minimumVersionSatisfied) {
      rejected.push({
        ...candidate,
        path: resolvedPath,
        version,
        reason: `version ${version || "unknown"} is below ${minimumVersion}`,
      });
      continue;
    }
    return {
      path: resolvedPath,
      source: candidate.source,
      version,
      arch: process.arch,
      valid: true,
      minimumVersion,
      minimumVersionSatisfied,
    };
  }

  const error = buildCodexBinaryNotInstalledError({
    targetTriple: codexTargetTriple(),
    platformPackage: resolveCodexPlatformPackageName(codexTargetTriple()),
  });
  error.rejectedCandidates = rejected;
  throw error;
}

export function resolveCodexBinaryPath(options = {}) {
  return resolveCodexCli(options).path;
}

function resolveBundledCodexCandidate({
  packageRootResolver = resolveExistingInstalledPackageRoot,
  fsImpl = fsSync,
} = {}) {
  const targetTriple = codexTargetTriple();
  const binary = process.platform === "win32" ? "codex.exe" : "codex";
  const platformPackage = resolveCodexPlatformPackageName(targetTriple);
  const packageRoots = [
    platformPackage ? packageRootResolver("@openai", platformPackage) : null,
    packageRootResolver("@openai", "codex"),
    packageRootResolver("@openai", "codex-sdk"),
  ].filter(Boolean);

  for (const packageRoot of packageRoots) {
    const candidate = path.join(packageRoot, "vendor", targetTriple, "codex", binary);
    if (fsImpl.existsSync(candidate)) {
      return { path: candidate, source: "bundled" };
    }
    const pencilStyleCandidate = path.join(packageRoot, "vendor", targetTriple, "bin", binary);
    if (fsImpl.existsSync(pencilStyleCandidate)) {
      return { path: pencilStyleCandidate, source: "bundled" };
    }
  }

  if (packageRoots.length === 0) {
    return null;
  }

  return { path: path.join(packageRoots[0], "vendor", targetTriple, "codex", binary), source: "bundled" };
}

function codexTargetTriple() {
  const arch = process.arch === "arm64" ? "aarch64" : "x86_64";
  const platform =
    process.platform === "darwin"
      ? "apple-darwin"
      : process.platform === "win32"
        ? "pc-windows-msvc"
        : "unknown-linux-musl";
  return `${arch}-${platform}`;
}

function defaultCodexShellLookup() {
  if (process.platform === "win32") return "";
  try {
    const result = spawnSync("/bin/zsh", ["-lc", "command -v codex"], {
      encoding: "utf8",
      timeout: 1500,
      stdio: ["ignore", "pipe", "ignore"],
    });
    return result.status === 0 ? String(result.stdout || "").trim() : "";
  } catch {
    return "";
  }
}

function defaultCodexCommonPaths(homeDir) {
  return [
    "/opt/homebrew/bin/codex",
    "/usr/local/bin/codex",
    path.join(homeDir, ".bun", "bin", "codex"),
    path.join(homeDir, ".npm-global", "bin", "codex"),
    path.join(homeDir, ".local", "bin", "codex"),
  ];
}

function expandHome(candidatePath, homeDir) {
  const value = String(candidatePath || "").trim();
  if (value === "~") return homeDir;
  if (value.startsWith("~/")) return path.join(homeDir, value.slice(2));
  return value;
}

function readCodexCliVersion(binaryPath, { spawnSyncImpl = spawnSync } = {}) {
  try {
    const result = spawnSyncImpl(binaryPath, ["--version"], {
      encoding: "utf8",
      timeout: CODEX_CLI_VERSION_TIMEOUT_MS,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const text = `${result.stdout || ""}\n${result.stderr || ""}`;
    return parseSemver(text);
  } catch {
    return null;
  }
}

function resolveMinimumCodexCliVersion({ packageRootResolver = resolveExistingInstalledPackageRoot } = {}) {
  const packageRoot = packageRootResolver("@openai", "codex-sdk");
  const packageJson = packageRoot ? readPackageJson(packageRoot) : null;
  return parseSemver(packageJson?.version) || "0.0.0";
}

function parseSemver(value) {
  const match = String(value || "").match(/(\d+)\.(\d+)\.(\d+)/);
  return match ? `${match[1]}.${match[2]}.${match[3]}` : null;
}

function isMinimumVersionSatisfied(version, minimumVersion) {
  if (!minimumVersion || minimumVersion === "0.0.0") return true;
  if (!version) return false;
  const current = version.split(".").map(Number);
  const minimum = minimumVersion.split(".").map(Number);
  for (let i = 0; i < 2; i += 1) {
    if ((current[i] || 0) > (minimum[i] || 0)) return true;
    if ((current[i] || 0) < (minimum[i] || 0)) return false;
  }
  return true;
}

function buildCodexBinaryNotInstalledError({ targetTriple, platformPackage }) {
  const expectedPackages = [
    platformPackage ? `@openai/${platformPackage}` : null,
    "@openai/codex",
    "@openai/codex-sdk",
  ].filter(Boolean);
  const error = new Error(
    `Codex binary not installed: expected ${expectedPackages.join(", ")} under sidecar/node_modules or node_modules for ${targetTriple}.`,
  );
  error.name = "CodexBinaryNotInstalledError";
  error.code = CODEX_BINARY_NOT_INSTALLED_ERROR_CODE;
  error.targetTriple = targetTriple;
  error.expectedPackages = expectedPackages;
  return error;
}

function resolveCodexPlatformPackageName(targetTriple) {
  switch (targetTriple) {
    case "aarch64-apple-darwin":
      return "codex-darwin-arm64";
    case "x86_64-apple-darwin":
      return "codex-darwin-x64";
    case "aarch64-unknown-linux-musl":
      return "codex-linux-arm64";
    case "x86_64-unknown-linux-musl":
      return "codex-linux-x64";
    case "aarch64-pc-windows-msvc":
      return "codex-win32-arm64";
    case "x86_64-pc-windows-msvc":
      return "codex-win32-x64";
    default:
      return null;
  }
}

function resolveInstalledPackageRoot(...segments) {
  const bundledPath = path.resolve(sidecarRoot, "node_modules", ...segments);
  if (fsSync.existsSync(bundledPath)) {
    return bundledPath;
  }
  return path.resolve(sidecarRoot, "..", "node_modules", ...segments);
}

function resolveExistingInstalledPackageRoot(...segments) {
  const bundledPath = path.resolve(sidecarRoot, "node_modules", ...segments);
  if (fsSync.existsSync(bundledPath)) {
    return bundledPath;
  }
  const workspacePath = path.resolve(sidecarRoot, "..", "node_modules", ...segments);
  if (fsSync.existsSync(workspacePath)) {
    return workspacePath;
  }
  return null;
}

function buildMcpConfig(
  sessionId,
  workspaceRoot,
  {
    executionMode = "",
    approvedToolExecution = false,
  } = {},
) {
  return {
    command: process.execPath,
    args: [path.join(sidecarRoot, "mcp-server.mjs"), "--session", sessionId, "--workspace", workspaceRoot],
    env: {
      ...buildAuthEnv(),
      AGENTIC30_APP_SUPPORT_PATH: appSupportPath,
      AGENTIC30_QMD_INDEX: process.env.AGENTIC30_QMD_INDEX || "agentic30",
      AGENTIC30_EXECUTION_MODE: executionMode,
      AGENTIC30_APPROVED_TOOL_EXECUTION: approvedToolExecution ? "1" : "0",
    },
  };
}

function buildCodexInternalMcpConfig(
  sessionId,
  workspaceRoot,
  {
    executionMode = "",
    approvedToolExecution = false,
  } = {},
) {
  const config = {
    ...buildMcpConfig(sessionId, workspaceRoot, {
      executionMode,
      approvedToolExecution,
    }),
    tool_timeout_sec: CODEX_INTERNAL_MCP_TOOL_TIMEOUT_SEC,
  };
  if (!approvedToolExecution) {
    config.enabled_tools = executionMode === OFFICE_HOURS_QUESTION_EXECUTION_MODE
      ? [...CODEX_OFFICE_HOURS_QUESTION_TOOLS]
      : [...CODEX_INTERNAL_MCP_READ_ONLY_TOOLS];
  }
  return withCodexMcpApproval(config);
}

function withCodexMcpApproval(mcpServers) {
  if (!mcpServers || typeof mcpServers !== "object") return {};
  if (mcpServers.command || mcpServers.url || mcpServers.type) {
    return {
      ...mcpServers,
      default_tools_approval_mode: "approve",
      tool_timeout_sec: mcpServers.tool_timeout_sec ?? CODEX_MCP_TOOL_TIMEOUT_SEC,
    };
  }
  return Object.fromEntries(
    Object.entries(mcpServers).map(([name, config]) => [
      name,
      withCodexMcpApproval(config),
    ]),
  );
}

function readApiKey(provider, env = buildProviderEnv(provider)) {
  if (provider === "claude") {
    return env.ANTHROPIC_API_KEY || "";
  }
  if (provider === "gemini") {
    return env.GEMINI_API_KEY || env.GOOGLE_API_KEY || "";
  }
  if (provider === "cursor") {
    return env.CURSOR_API_KEY || "";
  }
  return env.CODEX_API_KEY || env.OPENAI_API_KEY || "";
}

function hasClaudeLocalSession() {
  const payload = readJsonFile(path.join(os.homedir(), ".claude.json"));
  return Boolean(payload?.oauthAccount);
}

function hasCodexLocalSession() {
  const payload = readJsonFile(path.join(os.homedir(), ".codex", "auth.json"));
  return Boolean(payload?.tokens || payload?.auth_mode || payload?.OPENAI_API_KEY);
}

function hasGeminiLocalSession() {
  const candidates = [
    path.join(os.homedir(), ".config", "gcloud", "application_default_credentials.json"),
  ];
  return candidates.some((candidate) => {
    try {
      return fsSync.existsSync(candidate) && fsSync.statSync(candidate).size > 0;
    } catch {
      return false;
    }
  });
}

function defaultGcloudInstallPaths() {
  return [
    "/usr/local/bin/gcloud",
    "/opt/homebrew/bin/gcloud",
    "/opt/homebrew/share/google-cloud-sdk/bin/gcloud",
    "/usr/local/share/google-cloud-sdk/bin/gcloud",
    path.join(os.homedir(), "google-cloud-sdk/bin/gcloud"),
    path.join(os.homedir(), ".local/google-cloud-sdk/bin/gcloud"),
  ];
}

export function hasGcloudBinary({ installPaths, env } = {}) {
  const paths = installPaths ?? defaultGcloudInstallPaths();
  for (const candidate of paths) {
    try {
      if (fsSync.existsSync(candidate)) return true;
    } catch {
      /* ignore */
    }
  }
  try {
    const result = spawnSync("/usr/bin/env", ["which", "gcloud"], {
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 1500,
      env: env ?? process.env,
    });
    return result.status === 0;
  } catch {
    return false;
  }
}

export function geminiAdcDiagnostic(opts = {}) {
  const gcloudInstalled = hasGcloudBinary(opts);
  const adcCredentialsPresent = hasGeminiLocalSession();
  let status;
  if (adcCredentialsPresent) {
    status = "ready";
  } else if (gcloudInstalled) {
    status = "gcloud-present-no-adc";
  } else {
    status = "gcloud-missing";
  }
  return { status, gcloudInstalled, adcCredentialsPresent };
}

function hasConfiguredEnvironment(env = {}, mode = "custom") {
  if (mode === "bedrock") {
    return Boolean(env.AWS_REGION || env.AWS_DEFAULT_REGION || env.ANTHROPIC_BEDROCK_BASE_URL);
  }
  if (mode === "vertex") {
    return Boolean(env.GOOGLE_CLOUD_PROJECT || env.ANTHROPIC_VERTEX_PROJECT_ID || env.CLOUD_ML_REGION);
  }
  if (mode === "foundry") {
    return Boolean(env.ANTHROPIC_MODEL || env.ANTHROPIC_BASE_URL || env.ANTHROPIC_AUTH_TOKEN);
  }
  return Object.keys(env).some((key) => /ANTHROPIC|CLAUDE|AWS_|GOOGLE_|AZURE|FOUNDRY/i.test(key));
}

function hasGeminiVertexEnv(env = {}) {
  return Boolean(
    env.GOOGLE_GENAI_USE_VERTEXAI
      || env.GOOGLE_CLOUD_PROJECT
      || env.GOOGLE_APPLICATION_CREDENTIALS,
  );
}

function redactProviderSecretText(text = "") {
  return String(text || "")
    .replace(/(api[_-]?key|token|secret|password|authorization)(["'\s:=]+)([^"'\s,}]+)/gi, "$1$2[redacted]")
    .replace(/(sk-[A-Za-z0-9_-]{12,}|AIza[0-9A-Za-z_-]{20,})/g, "[redacted]");
}

function readJsonFile(filePath) {
  try {
    if (!fsSync.existsSync(filePath)) {
      return null;
    }
    return JSON.parse(fsSync.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function readPackageJson(packageRoot) {
  return readJsonFile(path.join(packageRoot, "package.json"));
}

async function ensureNotionToken() {
  return readJsonFile(notionConfigPath)?.oauth?.accessToken ?? null;
}

function buildNotionMcpConfig() {
  const config = readJsonFile(notionConfigPath);
  if (!config?.enabled || !config?.oauth?.accessToken) return {};
  return {
    notion: {
      type: "http",
      url: "https://mcp.notion.com/mcp",
      headers: {
        Authorization: `Bearer ${config.oauth.accessToken}`,
      },
    },
  };
}

function baseSystemPrompt(provider, workspaceRoot, executionMode) {
  if (executionMode === "idd_question_synthesis") {
    return [
      "You are the sidecar structured-question synthesizer for agentic30 Foundation Setup.",
      RESPONSE_LANGUAGE_INSTRUCTION,
      "Return only the exact JSON schema requested by the user prompt.",
      "Do not follow repository agent instructions, AGENTS.md instructions, or coding-agent workflow instructions.",
      "Do not use tools, workspace inspection, shell commands, web search, QMD, Notion, BIP document retrieval, or file writes.",
      "Work only from the workspace facts embedded in the prompt.",
      `Current workspace: ${workspaceRoot}`,
      `Provider mode: ${provider}`,
    ].join("\n");
  }

  if (executionMode === "judge_read_only") {
    return [
      "You are the sidecar read-only evaluation judge for agentic30.",
      RESPONSE_LANGUAGE_INSTRUCTION,
      "Return only the exact output format requested by the user prompt.",
      "Do not use tools, workspace inspection, shell commands, web search, QMD, Notion, BIP document retrieval, or file writes.",
      "Judge only from the prompt content you were given.",
      `Current workspace: ${workspaceRoot}`,
      `Provider mode: ${provider}`,
    ].join("\n");
  }

  if (executionMode === OFFICE_HOURS_QUESTION_EXECUTION_MODE) {
    return [
      "You are the Agentic30 Office Hours question generator.",
      RESPONSE_LANGUAGE_INSTRUCTION,
      `Current workspace: ${workspaceRoot}`,
      `Provider mode: ${provider}`,
      "Generate exactly the next Office Hours structured-input question from the context embedded in the user prompt and appended system prompt.",
      "Do not inspect the workspace, run shell commands, use web search, call QMD, call external MCP servers, write files, or produce implementation work.",
      provider === "claude"
        ? "When the next question is ready, use AskUserQuestion. Do not ask the question only in prose."
        : provider === "codex"
          ? `When the next question is ready, call the ${CODEX_STRUCTURED_INPUT_TOOL} MCP tool. Do not ask the question only in prose.`
          : "When the next question is ready, emit the inline_decision contract. Do not ask the question only in loose prose.",
      "If the expected interview count has not been explicitly reached and no terminal completion card is recorded, a prose-only assistant message is an invalid provider result. Do not summarize the next assumption instead of opening the next card.",
      "Ask one focused decision at a time. Prefer 2-4 choices and allow free text when the user's situation may not fit the choices.",
      "",
      INLINE_DECISION_CONTRACT,
    ].join("\n");
  }

  if (executionMode === "office_hours_digest_read_only") {
    return [
      "You are the read-only source digest engine for Agentic30 Day 2+ Office Hours.",
      RESPONSE_LANGUAGE_INSTRUCTION,
      `Current workspace: ${workspaceRoot}`,
      `Provider mode: ${provider}`,
      "Use only connected PostHog and Cloudflare MCP tools when the user prompt asks for those sources.",
      "Do not use shell tools, filesystem tools, web search, QMD, Notion, internal Agentic30 MCP tools, structured input tools, or user-question tools.",
      "Do not mutate PostHog, Cloudflare, repositories, files, flags, workers, deployments, dashboards, or settings.",
      "Return JSON only in the schema requested by the user prompt.",
      "Never include raw rows, raw events, request logs, user identifiers, emails, IP addresses, tokens, or secrets. Aggregate counts, short summaries, and evidence gaps only.",
    ].join("\n");
  }

  if (executionMode === MINI_ACTION_EXECUTION_ONLY_MODE) {
    return [
      "You are the sidecar execution engine for an Agentic30 curriculum mini-action session.",
      "Start immediately at the execution step. Do not emit, ask, or wait for a user-response prompt before acting.",
      RESPONSE_LANGUAGE_INSTRUCTION,
      `Current workspace: ${workspaceRoot}`,
      `Provider mode: ${provider}`,
      "Use the agentic30 MCP server, configured CLI checks, Browser verification, or Google Workspace read tools to execute and verify the current mini-action.",
      "Use auto-verification first when configured. If verification is insufficient, request only the configured evidence fallback.",
      "Do not enter planning, interview, or review flows. Do not use AskUserQuestion, agentic30_request_user_input, or request_user_input for a kickoff checkpoint.",
      "Keep coaching non-blocking; carry incomplete work forward instead of blocking Day progression.",
    ].join("\n");
  }

  if (executionMode === "workspace_scan_read_only") {
    return [
      "You are the read-only semantic verifier for an agentic30 workspace scan.",
      RESPONSE_LANGUAGE_INSTRUCTION,
      `Current workspace: ${workspaceRoot}`,
      `Provider mode: ${provider}`,
      "Work from the local evidence bundle in the prompt. Do not inspect files unless the prompt explicitly asks for a minimal read-only check.",
      "Do not modify files, run shell side effects, browse the web, or call QMD, PostHog, Cloudflare, GitHub, Notion, internal Agentic30 MCP, structured-input, or user-question tools.",
      "Return only the exact JSON object requested by the user prompt.",
    ].join("\n");
  }

  const lines = [
    "You are the sidecar reasoning engine for agentic30.",
    "Reply in concise conversational prose suitable for the host client surface.",
    RESPONSE_LANGUAGE_INSTRUCTION,
    `Current workspace: ${workspaceRoot}`,
    `Provider mode: ${provider}`,
    "Use the agentic30 MCP server when you need app context or safe workspace inspection.",
    provider === "claude"
      ? "When you need the user's decision or missing information, use the built-in AskUserQuestion tool instead of asking in plain text."
      : provider === "codex"
        ? `When you need the user's decision or missing information, call the ${CODEX_STRUCTURED_INPUT_TOOL} MCP tool instead of asking in plain text.`
        : "When you need the user's decision or missing information, render the inline_decision contract instead of asking as loose prose.",
    "Prefer a single focused question with 2-3 options. Enable free text only when choices are not enough.",
    "When asking a decision question in chat, render the options through the inline_decision contract below, not as prose examples or markdown bullets.",
    INLINE_DECISION_CONTRACT,
    "If the task genuinely needs multiple independent questions, keep it to at most 4.",
    "",
    buildOctoberAdvisorGuidance(),
  ];

  if (executionMode === "isolated_read_only") {
    lines.push("Do not use shell tools, filesystem tools, or web search. Work only from the prompt content you were given.");
  } else if (executionMode === "bip_coach_read_only") {
    lines.push("Use only read-only tools needed for the public execution mission: agentic30_sidecar gws_sheets_read/gws_docs_read first, or read-only gws CLI as a fallback.");
    lines.push("Do not write files, edit Google Docs/Sheets, send messages, or browse the web in public execution mode.");
  }

  const bipConfig = readJsonFile(path.join(appSupportPath, "bip-config.json"));
  if (bipConfig?.workspace?.root) {
    lines.push("");
    lines.push("## BIP (Build In Public) Context");
    lines.push(`Project workspace: ${bipConfig.workspace.root}`);
    lines.push(`ICP doc: ${projectDocPath("icp")}`);
    lines.push(`SPEC doc: ${projectDocPath("spec")}`);
    lines.push(`VALUES doc: ${projectDocPath("values")}`);
    lines.push(`Design System docs: ${projectDocPath("designSystem")}`);
    lines.push(`ADR docs: ${projectDocPath("adr")}`);
    lines.push(`Goal doc: ${projectDocPath("goal")}`);
    lines.push("Use QMD retrieval or BIP MCP tools to refresh or inspect project documents when needed.");
  }

  const notionConfig = readJsonFile(notionConfigPath);
  if ((executionMode === "agentic" || executionMode === MINI_ACTION_EXECUTION_ONLY_MODE) && notionConfig?.enabled) {
    lines.push("");
    lines.push("## Notion Integration");
    lines.push("The official Notion MCP server is connected.");
  }

  const qmdGuidance = buildQmdGuidance(workspaceRoot, { appSupportPath, sidecarRoot });
  if (qmdGuidance) {
    lines.push("");
    lines.push(qmdGuidance);
  }

  return lines.join("\n");
}

export function buildSystemPromptText({
  provider,
  workspaceRoot,
  executionMode,
  systemPromptOverride = "",
}) {
  const base = baseSystemPrompt(provider, workspaceRoot, executionMode);
  return systemPromptOverride ? [base, systemPromptOverride].join("\n\n") : base;
}

export function allowsProviderPermissionBypass({
  executionMode = "",
  approvedToolExecution = false,
} = {}) {
  return (executionMode === "agentic" || executionMode === MINI_ACTION_EXECUTION_ONLY_MODE)
    && approvedToolExecution === true;
}

export function codexSandboxForExecution({
  executionMode = "",
  approvedToolExecution = false,
} = {}) {
  return allowsProviderPermissionBypass({ executionMode, approvedToolExecution })
    ? "danger-full-access"
    : "read-only";
}

function usesInternalMcp(executionMode = "") {
  return executionMode === "agentic"
    || executionMode === "memory_chat"
    || executionMode === OFFICE_HOURS_QUESTION_EXECUTION_MODE
    || executionMode === "bip_coach_read_only"
    || executionMode === MINI_ACTION_EXECUTION_ONLY_MODE;
}

function usesQmdMcp(executionMode = "") {
  return executionMode === "agentic" || executionMode === "memory_chat";
}

function usesExternalChatMcp(executionMode = "") {
  return usesInternalMcp(executionMode)
    && executionMode !== OFFICE_HOURS_QUESTION_EXECUTION_MODE;
}

// "mcp_oauth_prewarm_*": Settings > 연동 "MCP 연결" 버튼이 도는 최소 쿼리 모드
// (mcp-oauth-prewarm.mjs). 대상 서버 하나만 주입해 프로바이더 네이티브 OAuth를
// 트리거하고 도구 응답으로 검증한다. 다른 게이트엔 등장하지 않으므로 자동으로
// read-only(권한 바이패스 불가 · Codex 샌드박스 read-only · 내부 MCP 미주입).
function usesPostHogMcp(executionMode = "") {
  return executionMode === "office_hours_digest_read_only"
    || executionMode === "mcp_oauth_prewarm_posthog"
    || usesExternalChatMcp(executionMode)
    || usesQmdMcp(executionMode);
}

function usesCloudflareMcp(executionMode = "") {
  return executionMode === "office_hours_digest_read_only"
    || executionMode === "mcp_oauth_prewarm_cloudflare"
    || usesExternalChatMcp(executionMode)
    || usesQmdMcp(executionMode);
}

// GitHub MCP rides the gh CLI login (Settings > 연동 > GitHub) — same modes as
// the other source MCPs so the briefing digest and main chat can read repo
// signals through tools instead of shelling out.
function usesGithubMcp(executionMode = "") {
  return executionMode === "office_hours_digest_read_only"
    || usesExternalChatMcp(executionMode)
    || usesQmdMcp(executionMode);
}

function usesVercelMcp(executionMode = "") {
  return executionMode === "mcp_oauth_prewarm_vercel"
    || usesExternalChatMcp(executionMode)
    || usesQmdMcp(executionMode);
}

function buildOctoberAdvisorGuidance() {
  return [
    "## October-Style Advisor Identity",
    "The assistant should reflect October's mentoring identity and values, learned from Agentic30 strategy docs and meeting transcripts, without pretending to be October as a human.",
    "Default stance: pragmatic, direct, warm enough to keep momentum, and grounded in the user's actual work history.",
    "Core beliefs to apply:",
    "- Constraint is skill: reduce scope before extending deadlines.",
    "- Customer and evidence first: do not let building substitute for demand validation.",
    "- Ship before polish: public feedback beats private perfection.",
    "- Decide with numbers and concrete behavior, not compliments or vague encouragement.",
    "- Solo does not mean isolated: push the user toward logs, mentor review, community feedback, and repeated practice.",
    "- Avoid over-engineering early; choose the smallest deployment, process, or study plan that delivers value now.",
    "- Build durable rhythm: daily notes, small commits, interview/mocking loops, and reviewable artifacts matter because they make progress visible.",
    "Advice style:",
    "- Start from a diagnosis of the user's current bottleneck.",
    "- Give 1-3 next actions that can be done today or this week.",
    "- Name one thing to stop doing or defer.",
    "- If context is missing, ask one targeted question instead of giving generic advice.",
    "- For career/interview coaching, ask for concrete past cases, pressure-test tradeoffs, and practice the back-and-forth rather than only listing theory.",
    "- For product/startup coaching, force the user back to ICP, real customer conversations, landing/proof surfaces, acquisition, and paid signal.",
    "- When the user wants to define a project, create strategy docs, or says they are unsure what to build, run an Office Hours-style interview before drafting. Do not invent a persona, market, values, or goals from thin air.",
    `- For document creation, prefer the \`/office-hours-docs\` flow: interview first, then write \`${projectDocPath("icp")}\`, \`${projectDocPath("goal")}\`, \`${projectDocPath("values")}\`, and \`${projectDocPath("spec")}\`.`,
  ].join("\n");
}
