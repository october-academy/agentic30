import test from "node:test";
import assert from "node:assert/strict";
import {
  parseClaudeSdkMessage,
  parseClaudeStreamEvent,
  parseClaudeStructuredInputToolInput,
  parseClaudeStructuredInputToolOutput,
  parseCodexStructuredInputToolInput,
  parseCodexStructuredInputToolOutput,
  parseCodexSdkEvent,
  parseCodexThreadItem,
  parseStructuredPromptRequestOutput,
} from "../sidecar/provider-sdk-contracts.mjs";

test("parseCodexSdkEvent accepts completed MCP tool events", () => {
  const event = parseCodexSdkEvent({
    type: "item.completed",
    item: {
      id: "call-1",
      type: "mcp_tool_call",
      server: "agentic30_sidecar",
      tool: "agentic30_request_user_input",
      arguments: { questions: [] },
      result: {
        content: [{ type: "text", text: "ok" }],
        structured_content: { requestId: "req-1" },
      },
      status: "completed",
    },
  });

  assert.equal(event.type, "item.completed");
  assert.equal(event.item.tool, "agentic30_request_user_input");
  assert.equal(event.item.result.structured_content.requestId, "req-1");
});

test("parseCodexSdkEvent accepts in-progress MCP tool events with null result and error", () => {
  const event = parseCodexSdkEvent({
    type: "item.updated",
    item: {
      id: "call-cloudflare-1",
      type: "mcp_tool_call",
      server: "cloudflare-api",
      tool: "execute",
      arguments: {
        code: "async () => cloudflare.request({ method: \"GET\", path: \"/zones?status=active&per_page=1\" })",
      },
      result: null,
      error: null,
      status: "in_progress",
    },
  });

  assert.equal(event.type, "item.updated");
  assert.equal(event.item.server, "cloudflare-api");
  assert.equal(event.item.tool, "execute");
  assert.equal(event.item.result, null);
  assert.equal(event.item.error, null);
});

test("parseCodexSdkEvent accepts failed MCP tool events with error details", () => {
  const event = parseCodexSdkEvent({
    type: "item.completed",
    item: {
      id: "call-exa-timeout",
      type: "mcp_tool_call",
      server: "exa",
      tool: "web_fetch_exa",
      arguments: { url: "https://example.com" },
      result: null,
      error: { message: "timed out awaiting tools/call after 300s" },
      status: "failed",
    },
  });

  assert.equal(event.type, "item.completed");
  assert.equal(event.item.server, "exa");
  assert.equal(event.item.tool, "web_fetch_exa");
  assert.equal(event.item.status, "failed");
  assert.equal(event.item.error.message, "timed out awaiting tools/call after 300s");
});

test("parseCodexSdkEvent rejects malformed known item events", () => {
  assert.throws(
    () => parseCodexSdkEvent({
      type: "item.completed",
      item: {
        id: "call-1",
        type: "mcp_tool_call",
        server: "agentic30_sidecar",
        arguments: {},
        status: "completed",
      },
    }),
    /Codex Agent SDK thread item contract violation/,
  );
});

test("parseCodexSdkEvent accepts in-progress command execution with null exit code", () => {
  const event = parseCodexSdkEvent({
    type: "item.updated",
    item: {
      id: "cmd-1",
      type: "command_execution",
      command: "find . -maxdepth 2 -type f",
      aggregated_output: "README.md\n",
      exit_code: null,
      status: "in_progress",
    },
  });

  assert.equal(event.type, "item.updated");
  assert.equal(event.item.type, "command_execution");
  assert.equal(event.item.exit_code, null);
});

test("parseCodexThreadItem accepts unknown item types with a type discriminator", () => {
  const item = parseCodexThreadItem({
    id: "future-1",
    type: "future_item",
    payload: { ok: true },
  });

  assert.equal(item.type, "future_item");
  assert.deepEqual(item.payload, { ok: true });
});

test("parseCodexThreadItem validates function_call namespace and arguments contracts", () => {
  const item = parseCodexThreadItem({
    type: "function_call",
    namespace: "mcp__cloudflare_api",
    name: "execute",
    call_id: "call-cf-1",
    arguments: "{\"code\":\"async () => cloudflare.request({ method: \\\"GET\\\", path: \\\"/zones?status=active&per_page=1\\\" })\"}",
  });

  assert.equal(item.namespace, "mcp__cloudflare_api");
  assert.equal(item.name, "execute");
  assert.equal(item.call_id, "call-cf-1");

  assert.throws(
    () => parseCodexThreadItem({
      type: "function_call",
      namespace: "mcp__cloudflare_api",
      call_id: "call-cf-1",
      arguments: "{}",
    }),
    /Codex Agent SDK thread item contract violation/,
  );

  const output = parseCodexThreadItem({
    type: "function_call_output",
    namespace: "mcp__cloudflare_api",
    name: "execute",
    call_id: "call-cf-1",
    output: "{\"success\":true}",
  });
  assert.equal(output.output, "{\"success\":true}");

  const pendingOutput = parseCodexThreadItem({
    type: "function_call_output",
    namespace: "mcp__posthog",
    name: "query",
    call_id: "call-ph-1",
    result: null,
    error: null,
    status: "in_progress",
  });
  assert.equal(pendingOutput.result, null);
  assert.equal(pendingOutput.error, null);
});

test("parseClaudeSdkMessage accepts assistant and result messages", () => {
  const assistant = parseClaudeSdkMessage({
    type: "assistant",
    session_id: "claude-session",
    message: {
      content: [
        { type: "text", text: "질문입니다." },
        { type: "tool_use", id: "tool-1", name: "AskUserQuestion", input: {} },
      ],
    },
  });
  const result = parseClaudeSdkMessage({
    type: "result",
    subtype: "success",
    duration_ms: 10,
    duration_api_ms: 8,
    is_error: false,
    num_turns: 1,
    result: "done",
    stop_reason: null,
    total_cost_usd: 0,
    usage: {},
    modelUsage: {},
    permission_denials: [],
    session_id: "claude-session",
  });

  assert.equal(assistant.message.content[1].name, "AskUserQuestion");
  assert.equal(result.subtype, "success");
});

test("parseClaudeSdkMessage validates known Claude content blocks with zod", () => {
  assert.throws(
    () => parseClaudeSdkMessage({
      type: "assistant",
      message: {
        content: [
          { type: "tool_use", id: "tool-1", input: {} },
        ],
      },
    }),
    /Claude Agent SDK message contract violation/,
  );
});

test("parseClaudeStreamEvent validates streamed tool_use and text deltas with zod", () => {
  const toolStart = parseClaudeStreamEvent({
    type: "content_block_start",
    index: 0,
    content_block: {
      type: "tool_use",
      id: "toolu_1",
      name: "mcp__cloudflare-api__execute",
      input: {},
    },
  });
  const textDelta = parseClaudeStreamEvent({
    type: "content_block_delta",
    index: 1,
    delta: { type: "text_delta", text: "MCP_PREWARM_OK" },
  });

  assert.equal(toolStart.content_block.name, "mcp__cloudflare-api__execute");
  assert.equal(textDelta.delta.text, "MCP_PREWARM_OK");
});

test("parseClaudeStreamEvent rejects malformed known Claude stream events", () => {
  assert.throws(
    () => parseClaudeStreamEvent({
      type: "content_block_start",
      content_block: {
        type: "tool_use",
        id: "toolu_1",
      },
    }),
    /Claude Agent SDK stream event contract violation/,
  );
  assert.throws(
    () => parseClaudeStreamEvent({
      type: "content_block_delta",
      delta: { type: "input_json_delta" },
    }),
    /Claude Agent SDK stream event contract violation/,
  );
});

test("parseClaudeSdkMessage rejects malformed known assistant messages", () => {
  assert.throws(
    () => parseClaudeSdkMessage({
      type: "assistant",
      message: { content: { type: "text", text: "not an SDK content array" } },
    }),
    /Claude Agent SDK message contract violation/,
  );
});

test("parseCodexStructuredInputToolInput accepts the strict MCP structured-input contract", () => {
  const input = parseCodexStructuredInputToolInput({
    title: "Choose scope",
    questions: [
      {
        header: "Scope",
        question: "Which scope should we use?",
        options: [
          { label: "Hero", description: "Work on the hero only." },
          { label: "App", description: "Work on the full app." },
        ],
        allowFreeText: true,
      },
    ],
  });

  assert.equal(input.questions[0].header, "Scope");
  assert.equal(input.questions[0].options[1].description, "Work on the full app.");
});

test("parseCodexStructuredInputToolInput rejects invalid Codex structured-input shapes", () => {
  assert.throws(
    () => parseCodexStructuredInputToolInput({
      questions: [
        {
          question: "Missing header and only one option",
          options: [{ label: "Only", description: "Not enough choices." }],
        },
      ],
    }),
    /Codex structured input tool input contract violation/,
  );
});

test("parseClaudeStructuredInputToolInput accepts Claude AskUserQuestion input before normalization", () => {
  const input = parseClaudeStructuredInputToolInput({
    title: "Claude needs input",
    questions: [
      {
        question: "What should Claude do next?",
        options: [
          { label: "Continue", description: "Continue with the current plan." },
          { label: "Stop" },
        ],
      },
    ],
  });

  assert.equal(input.questions[0].header, undefined);
  assert.equal(input.questions[0].options[1].description, undefined);
});

test("structured prompt request output requires the canonical app-facing shape", () => {
  assert.throws(
    () => parseStructuredPromptRequestOutput({
      requestId: "req-1",
      sessionId: "session-1",
      toolName: "AskUserQuestion",
      createdAt: new Date().toISOString(),
      questions: [
        {
          question: "No header field should fail the Swift-facing request contract.",
          allowFreeText: true,
        },
      ],
    }),
    /structured input request output contract violation/,
  );
});

test("parseClaudeStructuredInputToolOutput validates the Claude SDK handback payload", () => {
  const output = parseClaudeStructuredInputToolOutput({
    questions: [
      {
        header: "",
        question: "What should Claude do next?",
        options: [
          { label: "Continue", description: "Continue with the current plan." },
          { label: "Stop", description: "" },
        ],
      },
    ],
    answers: { "What should Claude do next?": "Continue" },
    annotations: {},
  });

  assert.equal(output.questions[0].question, "What should Claude do next?");
  assert.equal(output.answers["What should Claude do next?"], "Continue");
});

test("parseCodexStructuredInputToolOutput validates the Codex MCP result payload", () => {
  const output = parseCodexStructuredInputToolOutput({
    requestId: "req-1",
    title: "Choose scope",
    questions: [
      {
        header: "Scope",
        question: "Which scope should we use?",
        options: [
          { label: "Hero", description: "Work on the hero only." },
          { label: "App", description: "Work on the full app." },
        ],
      },
    ],
    answers: { "Which scope should we use?": "App" },
    annotations: {},
    responses: [
      {
        question: "Which scope should we use?",
        selectedOptions: ["App"],
        freeText: "",
      },
    ],
  });

  assert.equal(output.requestId, "req-1");
  assert.equal(output.responses[0].selectedOptions[0], "App");
});
