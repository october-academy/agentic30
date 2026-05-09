import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  allowsProviderPermissionBypass,
  buildClaudePetHooks,
  buildCodexConfig,
  buildCodexEnv,
  buildSystemPromptText,
  codexSandboxForExecution,
  extractClaudePartialText,
  getProviderAuthState,
  getProviderConnectionState,
  isCodexContextOverflowError,
  isCodexRecoverableThreadResumeError,
  isClaudeMutatingTool,
  mapCodexItemToToolEvent,
  resolveCodexBinaryPath,
  resolveCodexModel,
  resolveCodexReasoningEffort,
  shouldResumeCodexThread,
} from "../sidecar/provider-runner.mjs";

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

  assert.equal(claude.sdk.packageName, "@anthropic-ai/claude-agent-sdk");
  assert.equal(claude.sdk.available, true);
  assert.match(claude.sdk.entrypointPath, /@anthropic-ai\/claude-agent-sdk\/cli\.js$/);
  assert.match(claude.sdk.version, /^\d+\.\d+\.\d+/);

  assert.equal(codex.sdk.packageName, "@openai/codex-sdk");
  assert.equal(codex.sdk.available, true);
  assert.match(codex.sdk.entrypointPath, /\/codex\/codex(?:\.exe)?$/);
  assert.match(codex.sdk.version, /^\d+\.\d+\.\d+/);
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

test("buildClaudePetHooks only creates Claude lifecycle hooks when a broadcaster is provided", async () => {
  assert.equal(buildClaudePetHooks(undefined, "session-1"), undefined);

  const payloads = [];
  const hooks = buildClaudePetHooks((payload) => payloads.push(payload), "session-1");

  assert.ok(hooks.Stop);
  assert.equal(Object.hasOwn(hooks, "PreToolUse"), false);

  const result = await hooks.Stop[0].hooks[0]({ session_id: "claude-session" });
  assert.deepEqual(result, { continue: true });
  assert.deepEqual(payloads, [
    {
      type: "pet_hook",
      message: "Stop",
      sessionId: "session-1",
    },
  ]);
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

test("resolveCodexBinaryPath uses Codex platform package layout", () => {
  const binaryPath = resolveCodexBinaryPath();
  assert.match(binaryPath, /node_modules\/@openai\/codex-(darwin|linux|win32)-(arm64|x64)\/vendor\//);
  assert.match(binaryPath, /\/codex\/codex(?:\.exe)?$/);
});

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

test("buildCodexConfig keeps judge_read_only isolated from MCP tools", () => {
  const config = buildCodexConfig({
    systemPromptText: "system",
    executionMode: "judge_read_only",
    sessionIdForMcp: "session",
    workspaceRoot: "/tmp/workspace",
  });

  assert.deepEqual(config.mcp_servers, {});
});

test("buildCodexEnv points Codex CLI at an isolated app config home", () => {
  const env = buildCodexEnv({
    PATH: "/usr/bin",
    HOME: "/Users/tester",
    TMPDIR: "/tmp",
    CODEX_API_KEY: "codex-key",
    OPENAI_API_KEY: "openai-key",
  });

  assert.match(env.CODEX_HOME, /Application Support\/agentic30\/codex-home$/);
  assert.equal(env.PATH, "/usr/bin");
  assert.equal(env.CODEX_API_KEY, "codex-key");
  assert.equal(env.OPENAI_API_KEY, "openai-key");
});

test("resolveCodexReasoningEffort adapts to mode and prompt intent", () => {
  const previous = process.env.AGENTIC30_CODEX_REASONING_EFFORT;
  try {
    delete process.env.AGENTIC30_CODEX_REASONING_EFFORT;
    assert.equal(
      resolveCodexReasoningEffort({ executionMode: "fast_chat", prompt: "quick summary" }),
      "low",
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

test("buildSystemPromptText sets Korean response language for Claude and Codex SDK runs", () => {
  for (const provider of ["claude", "codex"]) {
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
