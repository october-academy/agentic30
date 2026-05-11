import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import WebSocket from "ws";

const packageRoot = path.resolve(import.meta.dirname, "..");

test("closed WebSocket clients do not crash later broadcasts", async () => {
  const harness = await spawnSidecar();
  let first;
  let second;
  try {
    first = await connectAndAwaitReady(harness);
    second = await connectAndAwaitReady(harness);
    await closeWebSocket(first);
    first = null;

    const events = [];
    second.on("message", (raw) => events.push(JSON.parse(String(raw))));
    second.send(JSON.stringify({ type: "create_session", provider: "codex", model: "gpt-5.4-mini" }));

    const created = await waitForEvent(events, (event) => event.type === "session_created");
    assert.equal(created.session.provider, "codex");
    assert.equal(harness.child.exitCode, null);
  } finally {
    await closeWebSocket(first);
    await closeWebSocket(second);
    await harness.dispose();
  }
});

test("background promise rejection is logged without killing the sidecar", async () => {
  const harness = await spawnSidecar({
    env: {
      AGENTIC30_TEST_BACKGROUND_REJECTION: "1",
    },
  });
  let socket;
  try {
    socket = await connectAndAwaitReady(harness);
    const crashRecord = await waitForCrashRecord(
      harness.appSupportPath,
      (record) => record.phase === "background_rejection"
        && record.properties?.operation === "testBackgroundRejection",
    );
    assert.equal(harness.child.exitCode, null);
    assert.equal(crashRecord.activeRunCount, 0);
    assert.match(crashRecord.error, /Synthetic background rejection/);
  } finally {
    await closeWebSocket(socket);
    await harness.dispose();
  }
});

async function spawnSidecar({ env = {} } = {}) {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-sidecar-resilience-ws-"));
  const appSupportPath = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-sidecar-resilience-app-"));
  const child = spawn(process.execPath, ["sidecar/index.mjs", "--workspace", workspaceRoot], {
    cwd: packageRoot,
    env: {
      ...process.env,
      AGENTIC30_APP_SUPPORT_PATH: appSupportPath,
      AGENTIC30_DISABLE_QMD_BOOTSTRAP: "1",
      AGENTIC30_TEST_STUB_PROVIDER: "1",
      AGENTIC30_DISABLE_CODEX_WARMUP: "1",
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });

  let ready;
  try {
    ready = await readSidecarReady(child);
  } catch (error) {
    await terminateChild(child);
    throw new Error(`Sidecar boot failed: ${error?.message || error}. stderr: ${stderr}`);
  }

  return {
    ...ready,
    child,
    appSupportPath,
    workspaceRoot,
    async dispose() {
      await terminateChild(child);
      await fs.rm(workspaceRoot, { recursive: true, force: true });
      await fs.rm(appSupportPath, { recursive: true, force: true });
    },
  };
}

function readSidecarReady(child) {
  return new Promise((resolve, reject) => {
    let buffer = "";
    const timer = setTimeout(() => reject(new Error("Timed out waiting for sidecar ready")), 15_000);
    const onData = (chunk) => {
      buffer += String(chunk);
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        let parsed;
        try {
          parsed = JSON.parse(line);
        } catch {
          continue;
        }
        if (parsed?.type === "sidecar-ready" && Number.isFinite(parsed.port)) {
          clearTimeout(timer);
          child.stdout.off("data", onData);
          resolve(parsed);
          return;
        }
      }
    };
    child.stdout.on("data", onData);
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Sidecar exited before ready: code=${code}`));
    });
  });
}

async function connectAndAwaitReady(harness) {
  const ws = new WebSocket(`ws://127.0.0.1:${harness.port}`);
  await new Promise((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
  ws.send(JSON.stringify({ type: "authenticate", authToken: harness.authToken }));
  await waitForSocketEvent(ws, (event) => event.type === "ready");
  return ws;
}

function waitForSocketEvent(ws, predicate, timeoutMs = 5_000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      ws.off("message", onMessage);
      reject(new Error("Timed out waiting for socket event"));
    }, timeoutMs);
    const onMessage = (raw) => {
      const event = JSON.parse(String(raw));
      if (!predicate(event)) return;
      clearTimeout(timeout);
      ws.off("message", onMessage);
      resolve(event);
    };
    ws.on("message", onMessage);
  });
}

async function closeWebSocket(ws) {
  if (!ws || ws.readyState === WebSocket.CLOSED) return;
  if (ws.readyState === WebSocket.CONNECTING) {
    ws.terminate();
    return;
  }
  await new Promise((resolve) => {
    const timeout = setTimeout(resolve, 1_000);
    ws.once("close", () => {
      clearTimeout(timeout);
      resolve();
    });
    ws.close();
  });
}

async function terminateChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  await new Promise((resolve) => {
    const timeout = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch {}
      resolve();
    }, 2_000);
    child.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
    try { child.kill("SIGTERM"); } catch { resolve(); }
  });
}

async function waitForEvent(events, predicate, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const match = events.find(predicate);
    if (match) return match;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Timed out waiting for matching event");
}

async function waitForCrashRecord(appSupportPath, predicate, timeoutMs = 5_000) {
  const filePath = path.join(appSupportPath, "sidecar-crashes.jsonl");
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    let raw = "";
    try {
      raw = await fs.readFile(filePath, "utf8");
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      const record = JSON.parse(line);
      if (predicate(record)) return record;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Timed out waiting for sidecar crash record");
}
