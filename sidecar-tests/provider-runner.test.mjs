import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  buildClaudePetHooks,
  buildCodexConfig,
  buildCodexEnv,
  extractClaudePartialText,
  getProviderAuthState,
  isCodexContextOverflowError,
  isCodexRecoverableThreadResumeError,
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
});

function restoreEnv(name, value) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
