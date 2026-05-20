import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { WebSocket } from "ws";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("workspace setup request_emit envelopes are host-routed and completion waits for first input", async () => {
  const harness = await spawnSidecar();
  let ws;
  try {
    await fs.mkdir(path.join(harness.workspacePath, "docs"), { recursive: true });
    await fs.writeFile(path.join(harness.workspacePath, "docs", "ICP.md"), "# ICP\n");
    await fs.writeFile(path.join(harness.workspacePath, "docs", "SPEC.md"), "# SPEC\n");

    ws = await connectAndCollect(harness);

    ws.send(JSON.stringify({
      type: "scan_workspace",
      root: harness.workspacePath,
      prompt: "where are the docs paths?",
    }));

    const started = await waitForEvent(ws.events, (event) =>
      event.type === "request_emit" && event.event === "workspace_setup_started",
    );
    assertRequestEmitEnvelope(started, "workspace_setup_started");

    const scanResult = await waitForEvent(ws.events, (event) => event.type === "workspace_scan_result");
    assert.equal(scanResult.day1Context, undefined);
    assert.equal(scanResult.composedOpening, undefined);
    assert.equal(scanResult.day1IcpPlan?.schemaVersion, 1);
    assert.ok(Array.isArray(scanResult.day1IcpPlan?.questions));
    assert.equal(
      ws.events.some((event) => event.type === "workspace_day1_compose_result"),
      false,
      "scan_workspace must not emit the legacy Day 1 compose event",
    );
    assert.equal(
      ws.events.some((event) =>
        event.type === "request_emit" && event.event === "workspace_setup_completed",
      ),
      false,
      "scan success alone must not complete workspace setup",
    );

    ws.send(JSON.stringify({ type: "create_session", provider: "codex", model: "gpt-5.4-mini" }));
    const created = await waitForEvent(ws.events, (event) =>
      event.type === "session_created" && event.session?.pendingUserInput?.requestId,
    );

    ws.send(JSON.stringify({
      type: "submit_user_input",
      sessionId: created.session.id,
      requestId: created.session.pendingUserInput.requestId,
      responses: [
        {
          question: "무엇부터 시작할까요?",
          selectedOptions: ["워크스페이스 살펴보기"],
          freeText: "",
        },
      ],
    }));

    const completed = await waitForEvent(ws.events, (event) =>
      event.type === "request_emit" && event.event === "workspace_setup_completed",
    );
    assertRequestEmitEnvelope(completed, "workspace_setup_completed");
    assert.equal(completed.properties.workspace_basename, path.basename(harness.workspacePath));
    assert.equal(completed.properties.input_source, "structured_input");
    assert.equal(typeof completed.properties.elapsed_ms, "number");
  } finally {
    ws?.close();
    await harness.close();
  }
});

test("workspace setup failures use the same request_emit envelope shape", async () => {
  const harness = await spawnSidecar();
  let ws;
  try {
    ws = await connectAndCollect(harness);
    const missingRoot = path.join(harness.workspacePath, "missing");

    ws.send(JSON.stringify({
      type: "scan_workspace",
      root: missingRoot,
      prompt: "where are the docs paths?",
    }));

    const failed = await waitForEvent(ws.events, (event) =>
      event.type === "request_emit" && event.event === "workspace_setup_failed",
    );
    assertRequestEmitEnvelope(failed, "workspace_setup_failed");
    assert.equal(failed.properties.workspace_basename, "missing");
    assert.ok(failed.properties.error_name);
  } finally {
    ws?.close();
    await harness.close();
  }
});

test("sidecar rejects unauthenticated websocket clients before ready payload", async () => {
  const harness = await spawnSidecar();
  let ws;
  try {
    ws = new WebSocket(`ws://127.0.0.1:${harness.port}`);
    const events = [];
    ws.on("message", (raw) => events.push(JSON.parse(String(raw))));
    await onceOpen(ws);
    ws.send(JSON.stringify({ type: "list_sessions" }));
    const close = await onceClose(ws);
    assert.equal(close.code, 1008);
    assert.equal(events.some((event) => event.type === "ready"), false);
  } finally {
    ws?.terminate();
    await harness.close();
  }
});

test("sidecar rejects websocket clients with an invalid auth token", async () => {
  const harness = await spawnSidecar();
  let ws;
  try {
    ws = new WebSocket(`ws://127.0.0.1:${harness.port}`);
    const events = [];
    ws.on("message", (raw) => events.push(JSON.parse(String(raw))));
    await onceOpen(ws);
    ws.send(JSON.stringify({ type: "authenticate", authToken: "wrong-token" }));
    const close = await onceClose(ws);
    assert.equal(close.code, 1008);
    assert.equal(events.some((event) => event.type === "ready"), false);
  } finally {
    ws?.terminate();
    await harness.close();
  }
});

function assertRequestEmitEnvelope(event, expectedEvent) {
  assert.equal(event.type, "request_emit");
  assert.equal(event.event, expectedEvent);
  assert.equal(event.event_schema_version, 1);
  assert.equal(typeof event.properties, "object");
  assert.equal(Array.isArray(event.properties), false);
}

async function spawnSidecar() {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-request-emit-"));
  const workspacePath = path.join(tempRoot, "workspace");
  const appSupportPath = path.join(tempRoot, "app-support");
  await fs.mkdir(workspacePath, { recursive: true });
  await fs.mkdir(appSupportPath, { recursive: true });

  const child = spawn(process.execPath, ["sidecar/index.mjs", "--workspace", workspacePath], {
    cwd: packageRoot,
    env: {
      ...process.env,
      AGENTIC30_APP_SUPPORT_PATH: appSupportPath,
      AGENTIC30_DISABLE_QMD_BOOTSTRAP: "1",
      AGENTIC30_TEST_STUB_PROVIDER: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });

  const ready = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timed out waiting for sidecar-ready. stderr:\n${stderr}`));
    }, 10_000);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
      const lines = stdout.split("\n");
      stdout = lines.pop() ?? "";
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line);
          if (parsed.type === "sidecar-ready" && parsed.port && parsed.authToken) {
            clearTimeout(timer);
            resolve(parsed);
          }
        } catch {
          // Ignore non-ready stdout.
        }
      }
    });
  });

  return {
    port: ready.port,
    authToken: ready.authToken,
    workspacePath,
    async close() {
      child.kill("SIGTERM");
      await new Promise((resolve) => {
        child.once("exit", resolve);
        setTimeout(resolve, 2_000);
      });
      await fs.rm(tempRoot, { recursive: true, force: true });
    },
  };
}

async function connectAndCollect(harness) {
  const ws = new WebSocket(`ws://127.0.0.1:${harness.port}`);
  ws.events = [];
  ws.on("message", (raw) => {
    ws.events.push(JSON.parse(String(raw)));
  });
  await onceOpen(ws);
  ws.send(JSON.stringify({ type: "authenticate", authToken: harness.authToken }));
  await waitForEvent(ws.events, (event) => event.type === "ready");
  return ws;
}

function onceOpen(ws) {
  return new Promise((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
}

function onceClose(ws) {
  return new Promise((resolve) => {
    ws.once("close", (code, reason) => resolve({ code, reason: String(reason || "") }));
  });
}

async function waitForEvent(events, predicate, timeoutMs = 10_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const found = events.find(predicate);
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for event. Saw: ${events.map((event) => event.type).join(", ")}`);
}
