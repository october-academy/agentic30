import readline from "node:readline";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runProviderStream, getProviderAuthState } from "./provider-runner.mjs";
import {
  buildProviderPrompt,
  ensureAbsolutePathWithinCwd,
  extractPromptContext,
  parseAgentJsonResponse,
} from "./acp-utils.mjs";

const sessions = new Map();
const pendingResponses = new Map();
let nextRequestId = 1;
let clientCapabilities = {
  fs: {
    readTextFile: false,
    writeTextFile: false,
  },
};

const rl = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
});

rl.on("line", async (line) => {
  if (!line.trim()) return;

  let message;
  try {
    message = JSON.parse(line);
  } catch (error) {
    sendError(null, -32700, `Invalid JSON: ${error.message}`);
    return;
  }

  if (message.id && !message.method) {
    const pending = pendingResponses.get(message.id);
    if (!pending) return;
    pendingResponses.delete(message.id);
    if (message.error) {
      pending.reject(new Error(message.error.message || "Client method failed."));
    } else {
      pending.resolve(message.result);
    }
    return;
  }

  if (!message.method) return;

  try {
    if (message.id !== undefined) {
      const result = await handleRequest(message.method, message.params || {});
      sendResponse(message.id, result);
    } else {
      await handleNotification(message.method, message.params || {});
    }
  } catch (error) {
    if (message.id !== undefined) {
      sendError(message.id, -32000, error.message);
    }
  }
});

async function handleRequest(method, params) {
  switch (method) {
    case "initialize":
      clientCapabilities = params.clientCapabilities || clientCapabilities;
      return {
        protocolVersion: 1,
        agentCapabilities: {
          loadSession: true,
          promptCapabilities: {
            embeddedContext: true,
          },
        },
        agentInfo: {
          name: "agentic30-acp",
          title: "Agentic30 ACP Adapter",
          version: "0.1.0",
        },
        authMethods: [],
      };
    case "session/new":
      return createSession(params);
    case "session/load":
      return loadSession(params);
    case "session/prompt":
      return promptSession(params);
    default:
      throw new Error(`Unsupported method: ${method}`);
  }
}

async function handleNotification(method, params) {
  if (method === "session/cancel") {
    const session = getSession(params.sessionId);
    session.pendingAbortController?.abort();
  }
}

function createSession(params) {
  const cwd = path.resolve(params.cwd || process.cwd());
  // Honor any explicitly selected provider (including gemini); default to codex
  // only for unset/unknown values. The old `=== "claude" ? "claude" : "codex"`
  // ternary silently downgraded a gemini selection to codex.
  const requestedProvider = String(params.sessionConfig?.provider || "").trim().toLowerCase();
  const provider = ["claude", "codex", "gemini"].includes(requestedProvider)
    ? requestedProvider
    : "codex";
  const model = typeof params.sessionConfig?.model === "string" ? params.sessionConfig.model : "";
  const sessionId = `sess_${randomUUID().replace(/-/g, "")}`;

  sessions.set(sessionId, {
    id: sessionId,
    cwd,
    provider,
    model,
    runtime: {},
    messages: [],
    pendingAbortController: null,
    providerToolCallIds: new Map(),
  });

  return { sessionId };
}

function loadSession(params) {
  const session = getSession(params.sessionId);
  if (params.cwd) {
    session.cwd = path.resolve(params.cwd);
  }

  for (const entry of session.messages) {
    sendNotification("session/update", {
      sessionId: session.id,
      update: {
        sessionUpdate: entry.role === "user" ? "user_message_chunk" : "agent_message_chunk",
        content: {
          type: "text",
          text: entry.content,
        },
      },
    });
  }

  return null;
}

async function promptSession(params) {
  const session = getSession(params.sessionId);
  if (session.pendingAbortController) {
    throw new Error("This ACP session is already running.");
  }

  const authState = getProviderAuthState(session.provider);
  if (!authState.available) {
    throw new Error(authState.message);
  }

  const { promptText, resources } = extractPromptContext(params.prompt);
  const fileContexts = await resolveFileContexts(session, resources);

  session.messages.push({
    role: "user",
    content: promptText,
  });
  sendNotification("session/update", {
    sessionId: session.id,
    update: {
      sessionUpdate: "user_message_chunk",
      content: {
        type: "text",
        text: promptText,
      },
    },
  });

  if (fileContexts.length) {
    const readToolCallId = `call_${randomUUID().replace(/-/g, "")}`;
    sendNotification("session/update", {
      sessionId: session.id,
      update: {
        sessionUpdate: "tool_call",
        toolCallId: readToolCallId,
        title: "Reading editor file context",
        kind: "other",
        status: "pending",
      },
    });
    sendNotification("session/update", {
      sessionId: session.id,
      update: {
        sessionUpdate: "tool_call_update",
        toolCallId: readToolCallId,
        status: "completed",
        content: [
          {
            type: "content",
            content: {
              type: "text",
              text: `Loaded ${fileContexts.length} file context item(s).`,
            },
          },
        ],
      },
    });
  }

  const assistantChunks = [];
  const abortController = new AbortController();
  session.pendingAbortController = abortController;

  const providerPrompt = buildProviderPrompt({
    promptText,
    fileContexts,
  });
  const isolatedWorkspaceRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "agentic30-acp-run-"),
  );

  try {
    try {
      const { runtime } = await runProviderStream({
        provider: session.provider,
        sessionRuntime: session.runtime,
        prompt: providerPrompt,
        model: session.model,
        workspaceRoot: isolatedWorkspaceRoot,
        abortController,
        sessionIdForMcp: null,
        executionMode: "isolated_read_only",
        onTextDelta: (chunk) => {
          assistantChunks.push(chunk);
        },
        onTextReplace: (content) => {
          assistantChunks.length = 0;
          assistantChunks.push(content);
        },
        onToolEvent: ({ phase, toolName, payload, toolCallKey }) => {
          reportProviderToolEvent({
            session,
            phase,
            toolName,
            payload,
            toolCallKey,
          });
        },
        onRuntimeUpdate: (nextRuntime) => {
          session.runtime = nextRuntime;
        },
      });
      session.runtime = runtime;
    } catch (error) {
      if (abortController.signal.aborted) {
        return { stopReason: "cancelled" };
      }
      throw error;
    }

    const finalText = assistantChunks.join("");
    const result = parseAgentJsonResponse(finalText);

    if (result.edits.length && clientCapabilities?.fs?.writeTextFile) {
      for (const edit of result.edits) {
        const targetContext =
          (edit.fileId && fileContexts.find((file) => file.fileId === edit.fileId)) ||
          (typeof edit.path === "string"
            ? fileContexts.find((file) => file.path === ensureAbsolutePathWithinCwd(session.cwd, edit.path))
            : null);
        if (!targetContext) {
          throw new Error("Agent returned an edit for an unknown file target.");
        }

        const currentContent = clientCapabilities?.fs?.readTextFile
          ? (
              await callClient("fs/read_text_file", {
                sessionId: session.id,
                path: targetContext.path,
              })
            )?.content || ""
          : targetContext.content;

        if (currentContent !== targetContext.content) {
          throw new Error(
            `Refusing to overwrite ${targetContext.displayName} because it changed after the prompt started.`,
          );
        }

        const writeToolCallId = `call_${randomUUID().replace(/-/g, "")}`;
        sendNotification("session/update", {
          sessionId: session.id,
          update: {
            sessionUpdate: "tool_call",
            toolCallId: writeToolCallId,
            title: `Writing ${targetContext.displayName}`,
            kind: "edit",
            status: "pending",
          },
        });
        await callClient("fs/write_text_file", {
          sessionId: session.id,
          path: targetContext.path,
          content: edit.content,
        });
        sendNotification("session/update", {
          sessionId: session.id,
          update: {
            sessionUpdate: "tool_call_update",
            toolCallId: writeToolCallId,
            status: "completed",
          },
        });
      }
    }

    if (result.message) {
      sendNotification("session/update", {
        sessionId: session.id,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: {
            type: "text",
            text: result.message,
          },
        },
      });
    }

    session.messages.push({
      role: "assistant",
      content: result.message || finalText,
    });

    return {
      stopReason: abortController.signal.aborted ? "cancelled" : "end_turn",
    };
  } finally {
    session.pendingAbortController = null;
    await fs.rm(isolatedWorkspaceRoot, { recursive: true, force: true });
  }
}

async function resolveFileContexts(session, resources) {
  const fileContexts = [];
  for (const resource of resources) {
    if (!resource.path) continue;
    const safePath = ensureAbsolutePathWithinCwd(session.cwd, resource.path);
    let content = resource.text;
    if (!content && clientCapabilities?.fs?.readTextFile) {
      const result = await callClient("fs/read_text_file", {
        sessionId: session.id,
        path: safePath,
      });
      content = result?.content || "";
    }
    fileContexts.push({
      fileId: `file_${fileContexts.length + 1}`,
      path: safePath,
      displayName: path.basename(safePath),
      content: content || "",
      mimeType: resource.mimeType,
    });
  }
  return fileContexts;
}

function getSession(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) {
    throw new Error(`Unknown session: ${sessionId}`);
  }
  return session;
}

function reportProviderToolEvent({
  session,
  phase,
  toolName,
  payload,
  toolCallKey,
}) {
  const stableKey = toolCallKey || `${toolName}:${phase}:${randomUUID()}`;
  let toolCallId = session.providerToolCallIds.get(stableKey);
  if (!toolCallId) {
    toolCallId = `call_${randomUUID().replace(/-/g, "")}`;
    session.providerToolCallIds.set(stableKey, toolCallId);
    sendNotification("session/update", {
      sessionId: session.id,
      update: {
        sessionUpdate: "tool_call",
        toolCallId,
        title: toolName,
        kind: "other",
        status: phase === "use" ? "pending" : "in_progress",
      },
    });
  }

  const status =
    phase === "error"
      ? "failed"
      : phase === "result"
        ? "completed"
        : phase === "use"
          ? "pending"
          : "in_progress";

  if (payload) {
    sendNotification("session/update", {
      sessionId: session.id,
      update: {
        sessionUpdate: "tool_call_update",
        toolCallId,
        status,
        content: [
          {
            type: "content",
            content: {
              type: "text",
              text: `${toolName}: ${stringifyPayload(payload)}`,
            },
          },
        ],
      },
    });
  } else if (status !== "pending") {
    sendNotification("session/update", {
      sessionId: session.id,
      update: {
        sessionUpdate: "tool_call_update",
        toolCallId,
        status,
      },
    });
  }

  if (status === "completed" || status === "failed") {
    session.providerToolCallIds.delete(stableKey);
  }
}

function callClient(method, params) {
  const id = nextRequestId++;
  const payload = {
    jsonrpc: "2.0",
    id,
    method,
    params,
  };
  send(payload);
  return new Promise((resolve, reject) => {
    pendingResponses.set(id, { resolve, reject });
  });
}

function sendNotification(method, params) {
  send({
    jsonrpc: "2.0",
    method,
    params,
  });
}

function sendResponse(id, result) {
  send({
    jsonrpc: "2.0",
    id,
    result,
  });
}

function sendError(id, code, message) {
  send({
    jsonrpc: "2.0",
    id,
    error: {
      code,
      message,
    },
  });
}

function send(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function stringifyPayload(payload) {
  if (typeof payload === "string") return payload;
  try {
    return JSON.stringify(payload);
  } catch {
    return String(payload);
  }
}
