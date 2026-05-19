import fsSync from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { query, listSessions } from "@anthropic-ai/claude-agent-sdk";
import { GoogleGenAI } from "@google/genai";
import { buildAuthEnv } from "./auth-context.mjs";
import { buildQmdGuidance, buildQmdMcpConfig } from "./qmd-support.mjs";
import {
  createUserInputRequest,
  deleteUserInputArtifacts,
  waitForUserInputResponse,
} from "./user-input.mjs";
import {
  CODEX_STRUCTURED_INPUT_TOOL,
} from "./structured-input-tools.mjs";
import { INLINE_DECISION_CONTRACT } from "./inline-decision.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sidecarRoot = path.resolve(__dirname);
process.env.AGENTIC30_SIDECAR_ROOT ??= sidecarRoot;
const DEFAULT_CODEX_MODEL = "gpt-5.5";
const DEFAULT_GEMINI_MODEL = "gemini-3.1-pro-preview";
const MINI_ACTION_EXECUTION_ONLY_MODE = "mini_action_execution_only";
const CODEX_REASONING_EFFORTS = new Set(["minimal", "low", "medium", "high", "xhigh"]);
const GEMINI_CAPABLE_EXECUTION_MODES = new Set([
  "isolated_read_only",
  "judge_read_only",
  "idd_question_synthesis",
  "agentic",
  "fast_chat",
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
let providerSettings = {
  claude: {},
  codex: {},
  gemini: {},
};

export function updateProviderSettings(nextSettings = {}) {
  providerSettings = {
    claude: normalizeProviderSettings(nextSettings.claude),
    codex: normalizeProviderSettings(nextSettings.codex),
    gemini: normalizeProviderSettings(nextSettings.gemini),
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
      },
    ]),
  );
}

export function resetProviderSettingsForTest() {
  providerSettings = {
    claude: {},
    codex: {},
    gemini: {},
  };
}

function normalizeProviderSettings(settings = {}) {
  return {
    authMode: normalizeAuthMode(settings.authMode),
    apiKey: String(settings.apiKey || ""),
    environment: String(settings.environment || ""),
    model: String(settings.model || ""),
  };
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
}) {
  onRunEvent?.({
    phase: "provider.entry",
    provider,
    executionMode,
    approvedToolExecution: Boolean(approvedToolExecution),
  });
  if (process.env.AGENTIC30_TEST_STUB_PROVIDER === "1") {
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
    onRunEvent?.({ phase: "provider.stub_response", provider });
    return { runtime: sessionRuntime };
  }

  if (executionMode === "isolated_read_only" && provider !== "gemini") {
    await runTextOnlyProvider({
      provider,
      prompt,
      model,
      abortController,
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
            : "API key from CODEX_API_KEY / OPENAI_API_KEY",
    };
  }

  if (provider === "gemini") {
    const diagnostic = geminiAdcDiagnostic();
    return {
      available: false,
      source: "missing",
      message: diagnostic.gcloudInstalled
        ? "Run `gcloud auth application-default login`, set GEMINI_API_KEY / GOOGLE_API_KEY, or configure Vertex AI"
        : "gcloud SDK not installed — set GEMINI_API_KEY / GOOGLE_API_KEY or install Google Cloud SDK",
      geminiAdc: diagnostic,
    };
  }

  return {
    available: false,
    source: "missing",
    message:
      provider === "claude"
        ? "Sign in with Claude Code or set ANTHROPIC_API_KEY"
        : "Sign in with Codex or set CODEX_API_KEY / OPENAI_API_KEY",
  };
}

export function getProviderConnectionState(provider) {
  return {
    ...getProviderAuthState(provider),
    sdk: getProviderSdkState(provider),
  };
}

function getProviderSdkState(provider) {
  if (provider === "claude") {
    const packageName = "@anthropic-ai/claude-agent-sdk";
    const packageRoot = resolveInstalledPackageRoot("@anthropic-ai", "claude-agent-sdk");
    const cliPath = path.join(packageRoot, "cli.js");
    const packageJson = readPackageJson(packageRoot);
    return {
      available: fsSync.existsSync(cliPath),
      packageName,
      version: packageJson?.version ?? null,
      packageRoot,
      entrypointPath: cliPath,
      message: fsSync.existsSync(cliPath)
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

  const packageName = "@openai/codex-sdk";
  const packageRoot = resolveInstalledPackageRoot("@openai", "codex-sdk");
  const binaryPath = resolveCodexBinaryPath();
  const packageJson = readPackageJson(packageRoot);
  return {
    available: fsSync.existsSync(binaryPath),
    packageName,
    version: packageJson?.version ?? null,
    packageRoot,
    entrypointPath: binaryPath,
    message: fsSync.existsSync(binaryPath)
      ? "Codex SDK and CLI binary are installed"
      : "Codex CLI binary is missing",
  };
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
  const packagePath = resolveInstalledPackageRoot("@anthropic-ai", "claude-agent-sdk");
  const cliPath = path.join(packagePath, "cli.js");
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
  };
  const env = {
    ...buildProviderEnv("claude"),
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
  const options = {
    model: model || undefined,
    pathToClaudeCodeExecutable: cliPath,
    executable: process.execPath,
    env,
    cwd: workspaceRoot,
    mcpServers,
    maxTurns: 24,
    includePartialMessages: true,
    canUseTool: buildClaudeCanUseTool({
      sessionId: sessionIdForMcp,
      onRunEvent,
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
    ...(claudeVendor?.exists
      ? {
          plugins: [{ type: "local", path: claudeVendor.pluginRoot }],
          skills: [claudeVendor.skillName],
          settingSources: ["skills"],
        }
      : {}),
  };
  if (claudeVendor?.exists) {
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

  if (executionMode === "fast_chat" && sessionRuntime?.claudeSessionId) {
    options.resume = sessionRuntime.claudeSessionId;
  } else if (executionMode !== "fast_chat") {
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
  onRunEvent?.({ phase: "provider.claude.stream_created" });

  for await (const event of stream) {
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
      const partialText = extractClaudePartialText(event.event);
      if (partialText) {
        sawPartialText = true;
        onRunEvent?.({ phase: "provider.claude.first_text", once: true });
        onTextDelta?.(partialText);
      }
      const toolProgress = extractClaudePartialToolEvent(event.event);
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
        onTextReplace?.(event.result ?? "");
      } else {
        throw new Error((event.errors ?? []).join("; ") || event.stop_reason || "Claude Agent SDK run failed.");
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

function buildClaudeCanUseTool({
  sessionId,
  onRunEvent,
  approvedToolExecution = false,
} = {}) {
  return async (toolName, input, context = {}) => {
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

    const questions = normalizeClaudeQuestions(input?.questions);
    if (questions.length === 0) {
      return {
        behavior: "deny",
        message: "AskUserQuestion did not include valid questions.",
      };
    }

    const request = await createUserInputRequest(appSupportPath, {
      sessionId,
      toolName,
      title: context.title || input?.title || "Claude needs input",
      questions,
    });
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
        updatedInput: {
          questions,
          answers: response.answers ?? {},
          annotations: response.annotations ?? {},
        },
      };
    } finally {
      await deleteUserInputArtifacts(appSupportPath, sessionId, request.requestId);
    }
  };
}

export function isClaudeMutatingTool(toolName = "") {
  const normalized = String(toolName || "").toLowerCase();
  if (!normalized) return false;
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

function normalizeClaudeQuestions(questions) {
  if (!Array.isArray(questions)) return [];
  return questions
    .map((question) => ({
      question: String(question?.question || "").trim(),
      header: String(question?.header || "Question").trim().slice(0, 12) || "Question",
      options: Array.isArray(question?.options)
        ? question.options
            .map((option) => ({
              label: String(option?.label || "").trim(),
              description: String(option?.description || "").trim(),
              ...(option?.preview ? { preview: String(option.preview) } : {}),
            }))
            .filter((option) => {
              return option.label
                && option.description
                && !isOtherTextOptionLabel(option.label);
            })
            .slice(0, 4)
        : [],
      multiSelect: Boolean(question?.multiSelect),
      allowFreeText: Boolean(question?.allowFreeText),
      requiresFreeText: Boolean(question?.requiresFreeText),
      ...(question?.helperText ? { helperText: String(question.helperText).trim().slice(0, 280) } : {}),
      ...(question?.freeTextPlaceholder ? { freeTextPlaceholder: String(question.freeTextPlaceholder).trim().slice(0, 280) } : {}),
      ...(question?.textMode === "long" ? { textMode: "long" } : {}),
    }))
    .filter((question) => question.question && question.options.length >= 2)
    .slice(0, 4);
}

function isOtherTextOptionLabel(label) {
  const normalized = String(label || "")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[()（）]/g, " ")
    .toLowerCase()
    .trim();
  return /(?:^|[\s:：\-_/])직접\s*입력(?:$|[\s:：\-_/])/.test(normalized)
    || /^기타(?:$|[\s:：\-_/])/.test(normalized)
    || /^other(?:$|[\s:：\-_/])/.test(normalized);
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
  const codexOptions = {
    codexPathOverride: resolveCodexBinaryPath(),
    env: codexEnv,
    config: buildCodexConfig({
      systemPromptText,
      executionMode,
      sessionIdForMcp,
      workspaceRoot,
      specialist,
      approvedToolExecution,
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
  onRunEvent?.({ phase: "provider.codex.client_created", model: resolvedModel });

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
  });
  onRunEvent?.({ phase: "provider.codex.stream_opened", promptChars: String(prompt || "").length });

  for await (const event of events) {
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

export function shouldResumeCodexThread(sessionRuntime = {}, workspaceRoot = "", executionMode = "") {
  if (!sessionRuntime?.codexThreadId) return false;
  const meta = sessionRuntime.codexThreadMeta || {};
  return meta.codexHome === codexHomePath
    && meta.workspaceRoot === workspaceRoot
    && (!executionMode || meta.executionMode === executionMode);
}

export function mapCodexItemToToolEvent(item, lifecycle) {
  if (!item) return null;
  if (item.type === "function_call" || item.type === "function_call_output") {
    const requestedToolName = item.name ?? item.call_name ?? item.tool ?? "function_call";
    return {
      phase: lifecycle === "completed" ? (item.status === "failed" ? "error" : "result") : "use",
      toolName: requestedToolName,
      toolCallKey: item.call_id ?? item.id ?? requestedToolName,
      payload: {
        requestedToolName,
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
            [internalMcpServerName]: buildMcpConfig(sessionIdForMcp, workspaceRoot, {
              executionMode,
              approvedToolExecution,
            }),
          }
        : {}),
      ...(allowsProviderPermissionBypass({ executionMode, approvedToolExecution }) ? buildNotionMcpConfig() : {}),
      ...(usesQmdMcp(executionMode) ? buildQmdMcpConfig({ sidecarRoot }) : {}),
    },
    ...(codexVendor?.exists
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
  const env = {
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
    AGENTIC30_CODEX_MODEL: providerEnv.AGENTIC30_CODEX_MODEL,
    CODEX_MODEL: providerEnv.CODEX_MODEL,
    OPENAI_MODEL: providerEnv.OPENAI_MODEL,
    AGENTIC30_CODEX_REASONING_EFFORT: providerEnv.AGENTIC30_CODEX_REASONING_EFFORT,
    CODEX_REASONING_EFFORT: providerEnv.CODEX_REASONING_EFFORT,
    MODEL_REASONING_EFFORT: providerEnv.MODEL_REASONING_EFFORT,
  };
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

export function supportsGeminiExecutionMode(executionMode = "") {
  return GEMINI_CAPABLE_EXECUTION_MODES.has(String(executionMode || ""));
}

export function resolveCodexReasoningEffort({ executionMode = "", prompt = "" } = {}) {
  const configured = String(
    process.env.AGENTIC30_CODEX_REASONING_EFFORT
      || process.env.CODEX_REASONING_EFFORT
      || process.env.MODEL_REASONING_EFFORT
      || "",
  ).trim();
  if (CODEX_REASONING_EFFORTS.has(configured)) {
    return configured;
  }
  const text = String(prompt || "").toLowerCase();
  const hasDeepWorkSignal = /debug|diagnos|root cause|investigate|analy[sz]e|implement|refactor|architecture|security|test|failure|failing|broken|복잡|분석|구현|리팩터|테스트|장애|오류|보안/.test(text);
  const hasLightWorkSignal = /quick|brief|summari[sz]e|간단|짧게|요약/.test(text);

  if (executionMode === "fast_chat") {
    return hasDeepWorkSignal ? "medium" : "minimal";
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

function buildStubResponse(prompt) {
  const contexts = extractStubContextFiles(prompt);
  const value = String(prompt || "");
  if (/ICP\.md 문서 어디에 있어\?/i.test(value) && value.includes("ICP doc: docs/ICP.md")) {
    return "`ICP.md`는 현재 BIP 설정 기준으로 `docs/ICP.md`에 있습니다.";
  }
  if ((value.includes("### ICP: docs/ICP.md") || value.includes("DAY1_ICP_TURN")) && /Day\s*1|Day 1|1일차/i.test(value)) {
    return [
      "ICP.md 확인: 전업 1인 개발자, 수익 0원, macOS, 고객 인터뷰 의향이 있으면 ICP 조건부 합격입니다.",
      "Day 1 응답: builder-state 진단을 먼저 하고, 기존 자산이 있으면 blank-slate discovery 대신 fast path로 SPEC.md v0 proof baseline과 다음 proof target을 정합니다.",
      "Day 7 readiness: 이번 주 안에 첫 사용자/수익 경로를 좁힐 기준 숫자 1개를 정하고, 반응이 없으면 질문을 바꿉니다.",
      "다음 액션: 오늘 고객 1명에게 반복 문제를 묻고 답변 원문을 SPEC.md에 붙입니다.",
      "증거 목표: 응답 1개를 확보한 뒤 그 응답 원문을 담은 Threads BIP 공개 proof URL 1개를 남깁니다.",
    ].join("\n");
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
  return createUserInputRequest(appSupportPath, {
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
  });
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

  const stream = await ai.models.generateContentStream({
    model: resolvedModel,
    contents: prompt,
    config: {
      systemInstruction: systemPromptText,
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
      throw new Error("ACP Claude mode requires ANTHROPIC_API_KEY.");
    }

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: model || env.ANTHROPIC_MODEL || "claude-3-7-sonnet-latest",
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

export function resolveCodexBinaryPath() {
  const arch = process.arch === "arm64" ? "aarch64" : "x86_64";
  const platform =
    process.platform === "darwin"
      ? "apple-darwin"
      : process.platform === "win32"
        ? "pc-windows-msvc"
        : "unknown-linux-musl";
  const binary = process.platform === "win32" ? "codex.exe" : "codex";
  const targetTriple = `${arch}-${platform}`;
  const platformPackage = resolveCodexPlatformPackageName(targetTriple);
  const packageRoots = [
    platformPackage ? resolveInstalledPackageRoot("@openai", platformPackage) : null,
    resolveInstalledPackageRoot("@openai", "codex"),
    resolveInstalledPackageRoot("@openai", "codex-sdk"),
  ].filter(Boolean);

  for (const packageRoot of packageRoots) {
    const candidate = path.join(packageRoot, "vendor", targetTriple, "codex", binary);
    if (fsSync.existsSync(candidate)) {
      return candidate;
    }
  }

  return path.join(packageRoots[0], "vendor", targetTriple, "codex", binary);
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
      AGENTIC30_EXECUTION_MODE: executionMode,
      AGENTIC30_APPROVED_TOOL_EXECUTION: approvedToolExecution ? "1" : "0",
    },
  };
}

function readApiKey(provider, env = buildProviderEnv(provider)) {
  if (provider === "claude") {
    return env.ANTHROPIC_API_KEY || "";
  }
  if (provider === "gemini") {
    return env.GEMINI_API_KEY || env.GOOGLE_API_KEY || "";
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

  if (executionMode === "fast_chat") {
    return [
      "You are the sidecar chat engine for agentic30.",
      "Reply in concise conversational prose.",
      RESPONSE_LANGUAGE_INSTRUCTION,
      `Current workspace: ${workspaceRoot}`,
      `Provider mode: ${provider}`,
      "This is a fast chat lane. Do not use tools, workspace inspection, web search, QMD, Notion, or BIP document retrieval.",
      "",
      INLINE_DECISION_CONTRACT,
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
    if (bipConfig.workspace.icp) lines.push(`ICP doc: ${bipConfig.workspace.icp}`);
    if (bipConfig.workspace.spec) lines.push(`SPEC doc: ${bipConfig.workspace.spec}`);
    if (bipConfig.workspace.values) lines.push(`VALUES doc: ${bipConfig.workspace.values}`);
    if (bipConfig.workspace.designSystem) lines.push(`Design System docs: ${bipConfig.workspace.designSystem}`);
    if (bipConfig.workspace.adr) lines.push(`ADR docs: ${bipConfig.workspace.adr}`);
    if (bipConfig.workspace.goal) lines.push(`Goal doc: ${bipConfig.workspace.goal}`);
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
    || executionMode === "bip_coach_read_only"
    || executionMode === MINI_ACTION_EXECUTION_ONLY_MODE;
}

function usesQmdMcp(executionMode = "") {
  return executionMode === "agentic" || executionMode === "memory_chat";
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
    "- For document creation, prefer the `/office-hours-docs` flow: interview first, then write `docs/ICP.md`, `docs/GOAL.md`, `docs/VALUES.md`, and `docs/SPEC.md`.",
  ].join("\n");
}
