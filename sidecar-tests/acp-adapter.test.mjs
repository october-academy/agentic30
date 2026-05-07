import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { spawn } from "node:child_process";

const adapterPath = new URL("../sidecar/acp-adapter.mjs", import.meta.url);

test("ACP adapter reads file context through fs/read_text_file and applies edits via fs/write_text_file", async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-acp-"));
  const targetFile = path.join(workspaceRoot, "demo.md");
  await fs.writeFile(targetFile, "# Demo\n");

  const child = spawn(process.execPath, [adapterPath.pathname, "--workspace", workspaceRoot], {
    cwd: workspaceRoot,
    env: {
      ...process.env,
      AGENTIC30_TEST_STUB_PROVIDER: "1",
    },
    stdio: ["pipe", "pipe", "pipe"],
  });

  const pending = new Map();
  const notifications = [];

  let buffer = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      const message = JSON.parse(line);
      if (message.id && !message.method) {
        const resolver = pending.get(message.id);
        if (resolver) {
          pending.delete(message.id);
          resolver(message);
        }
        continue;
      }

      if (message.method === "fs/read_text_file") {
        fs.readFile(message.params.path, "utf8").then((content) => {
          child.stdin.write(
            `${JSON.stringify({
              jsonrpc: "2.0",
              id: message.id,
              result: { content },
            })}\n`,
          );
        });
        continue;
      }

      if (message.method === "fs/write_text_file") {
        fs.writeFile(message.params.path, message.params.content, "utf8").then(() => {
          child.stdin.write(
            `${JSON.stringify({
              jsonrpc: "2.0",
              id: message.id,
              result: null,
            })}\n`,
          );
        });
        continue;
      }

      notifications.push(message);
    }
  });

  const request = (id, method, params) => {
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    return new Promise((resolve) => pending.set(id, resolve));
  };

  const initResponse = await request(1, "initialize", {
    protocolVersion: 1,
    clientCapabilities: {
      fs: {
        readTextFile: true,
        writeTextFile: true,
      },
    },
    clientInfo: {
      name: "test-client",
      version: "1.0.0",
    },
  });
  assert.equal(initResponse.result.protocolVersion, 1);

  const sessionResponse = await request(2, "session/new", {
    cwd: workspaceRoot,
  });
  const sessionId = sessionResponse.result.sessionId;
  assert.ok(sessionId);

  const promptResponse = await request(3, "session/prompt", {
    sessionId,
    prompt: [
      { type: "text", text: "Please update the referenced markdown file." },
      {
        type: "resource",
        resource: {
          uri: `file://${targetFile}`,
          mimeType: "text/markdown",
        },
      },
    ],
  });

  assert.equal(promptResponse.result.stopReason, "end_turn");

  const writtenContent = await fs.readFile(targetFile, "utf8");
  assert.match(writtenContent, /Stub ACP edit/);
  assert.ok(
    notifications.some(
      (message) =>
        message.method === "session/update" &&
        message.params?.update?.sessionUpdate === "tool_call",
    ),
  );

  child.kill("SIGTERM");
});

test("ACP adapter refuses stale writes when the editor buffer changes mid-run", async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-acp-stale-"));
  const targetFile = path.join(workspaceRoot, "demo.md");
  await fs.writeFile(targetFile, "# Demo\n");

  const child = spawn(process.execPath, [adapterPath.pathname, "--workspace", workspaceRoot], {
    cwd: workspaceRoot,
    env: {
      ...process.env,
      AGENTIC30_TEST_STUB_PROVIDER: "1",
    },
    stdio: ["pipe", "pipe", "pipe"],
  });

  const pending = new Map();
  let readCount = 0;
  let buffer = "";

  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      const message = JSON.parse(line);
      if (message.id && !message.method) {
        const resolver = pending.get(message.id);
        if (resolver) {
          pending.delete(message.id);
          resolver(message);
        }
        continue;
      }

      if (message.method === "fs/read_text_file") {
        readCount += 1;
        const content = readCount === 1 ? "# Demo\n" : "# Demo changed while agent was running\n";
        child.stdin.write(
          `${JSON.stringify({
            jsonrpc: "2.0",
            id: message.id,
            result: { content },
          })}\n`,
        );
        continue;
      }

      if (message.method === "fs/write_text_file") {
        child.stdin.write(
          `${JSON.stringify({
            jsonrpc: "2.0",
            id: message.id,
            result: null,
          })}\n`,
        );
      }
    }
  });

  const request = (id, method, params) => {
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    return new Promise((resolve) => pending.set(id, resolve));
  };

  await request(1, "initialize", {
    protocolVersion: 1,
    clientCapabilities: {
      fs: {
        readTextFile: true,
        writeTextFile: true,
      },
    },
    clientInfo: {
      name: "test-client",
      version: "1.0.0",
    },
  });

  const sessionResponse = await request(2, "session/new", {
    cwd: workspaceRoot,
  });
  const sessionId = sessionResponse.result.sessionId;

  const promptResponse = await request(3, "session/prompt", {
    sessionId,
    prompt: [
      { type: "text", text: "Please update the referenced markdown file." },
      {
        type: "resource",
        resource: {
          uri: `file://${targetFile}`,
          mimeType: "text/markdown",
        },
      },
    ],
  });

  assert.equal(promptResponse.error?.message, "Refusing to overwrite demo.md because it changed after the prompt started.");
  child.kill("SIGTERM");
});
