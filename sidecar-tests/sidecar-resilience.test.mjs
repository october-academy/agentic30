import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
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
    second.send(JSON.stringify({ type: "create_session", provider: "codex", model: "gpt-5.5" }));

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
  const sink = await startTelemetrySink();
  const harness = await spawnSidecar({
    env: {
      ...postHogTelemetryEnv(sink.url),
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
    const logRequest = await sink.waitFor((request) =>
      Boolean(findLogRecord(request, "sidecar background task failed", (attributes) =>
        attributes.operation === "testBackgroundRejection"
          && /Synthetic background rejection/.test(attributes.error_message || ""))),
    );
    const logRecord = findLogRecord(logRequest, "sidecar background task failed");
    assert.equal(logRecord.record.severityText, "ERROR");
    assert.equal(logRecord.attributes.error_type, "Error");
  } finally {
    await closeWebSocket(socket);
    await harness.dispose();
    await sink.close();
  }
});

test("bootstrap failures reach PostHog Error Tracking and Logs", async () => {
  const sink = await startTelemetrySink();
  const failed = await spawnSidecarExpectFailure({
    env: {
      ...postHogTelemetryEnv(sink.url),
      AGENTIC30_TEST_BOOTSTRAP_FAILURE: "1",
    },
  });
  try {
    assert.notEqual(failed.code, 0);
    await sink.waitFor((request) =>
      request.url === "/i/v0/e/"
        && request.body?.event === "$exception"
        && request.body?.properties?.operation === "sidecar_bootstrap",
      10_000,
    );
    const logRequest = await sink.waitFor((request) =>
      Boolean(findLogRecord(request, "sidecar bootstrap failed", (attributes) =>
        attributes.operation === "sidecar_bootstrap"
          && /Synthetic bootstrap failure/.test(attributes.error_message || ""))),
      10_000,
    );
    const logRecord = findLogRecord(logRequest, "sidecar bootstrap failed");
    assert.equal(logRecord.record.severityText, "ERROR");
    const crashRecord = await waitForCrashRecord(
      failed.appSupportPath,
      (record) => record.phase === "sidecar_bootstrap"
        && record.properties?.operation === "sidecar_bootstrap",
    );
    assert.match(crashRecord.error, /Synthetic bootstrap failure/);
  } finally {
    await failed.dispose();
    await sink.close();
  }
});

test("Office Hours source gate blocks emit warning logs", async () => {
  const sink = await startTelemetrySink();
  const harness = await spawnSidecar({
    env: postHogTelemetryEnv(sink.url),
  });
  let socket;
  try {
    socket = await connectAndAwaitReady(harness);
    const events = [];
    socket.on("message", (raw) => events.push(JSON.parse(String(raw))));
    socket.send(JSON.stringify({
      type: "create_session",
      provider: "codex",
      model: "gpt-5.5",
      suppressBootstrapIntake: true,
      officeHoursDay: 2,
    }));
    const created = await waitForEvent(events, (event) =>
      event.type === "session_created" && event.session?.status === "idle",
    );

    socket.send(JSON.stringify({
      type: "office_hours_start",
      sessionId: created.session.id,
      context: "DAY2_PLUS_GOAL_DRIVEN_OFFICE_HOURS\nGoal lane: build_product",
      visiblePrompt: "Blocked source gate test",
      source: "office_hours_day_2",
      day: 2,
    }));

    const gate = await waitForEvent(events, (event) =>
      event.type === "office_hours_source_gate"
        && event.sessionId === created.session.id
        && event.status === "blocked",
    );
    assert.equal(gate.officeHoursSourceGate.reason, "no_live_sources");
    const logRequest = await sink.waitFor((request) =>
      Boolean(findLogRecord(request, "office_hours_source_gate_blocked", (attributes) =>
        attributes.session_id === created.session.id
          && attributes.provider === "codex"
          && attributes.day === 2
          && attributes.reason === "no_live_sources")),
    );
    const logRecord = findLogRecord(logRequest, "office_hours_source_gate_blocked");
    assert.equal(logRecord.record.severityText, "WARN");
    assert.deepEqual(logRecord.attributes.selected_sources, []);
    assert.deepEqual(logRecord.attributes.missing_required_sources, []);
    assert.ok(logRecord.attributes.connect_action_count >= 1);
  } finally {
    await closeWebSocket(socket);
    await harness.dispose();
    await sink.close();
  }
});

test("Office Hours past-day snapshot fail-open check errors are reported", async () => {
  const sink = await startTelemetrySink();
  const harness = await spawnSidecar({
    env: {
      ...postHogTelemetryEnv(sink.url),
      AGENTIC30_TEST_OFFICE_HOURS_PAST_DAY_SNAPSHOT_CHECK_FAILURE: "1",
    },
  });
  let socket;
  try {
    socket = await connectAndAwaitReady(harness);
    const events = [];
    socket.on("message", (raw) => events.push(JSON.parse(String(raw))));
    socket.send(JSON.stringify({
      type: "create_session",
      provider: "codex",
      model: "gpt-5.5",
      suppressBootstrapIntake: true,
      officeHoursDay: 1,
    }));
    const created = await waitForEvent(events, (event) =>
      event.type === "session_created" && event.session?.status === "idle",
    );
    socket.send(JSON.stringify({
      type: "office_hours_start",
      sessionId: created.session.id,
      context: "Day 1 Office Hours",
      visiblePrompt: "Snapshot check failure test",
      source: "office_hours_day_1",
      day: 1,
    }));
    const logRequest = await sink.waitFor((request) =>
      Boolean(findLogRecord(request, "sidecar swallowed error", (attributes) =>
        attributes.operation === "office_hours_past_day_snapshot_check"
          && attributes.session_id === created.session.id
          && /snapshot check failure/.test(attributes.error_message || ""))),
      10_000,
    );
    const logRecord = findLogRecord(logRequest, "sidecar swallowed error");
    assert.equal(logRecord.record.severityText, "ERROR");
    assert.equal(harness.child.exitCode, null);
  } finally {
    await closeWebSocket(socket);
    await harness.dispose();
    await sink.close();
  }
});

test("Office Hours past-day snapshot turn-load errors are reported", async () => {
  const sink = await startTelemetrySink();
  const harness = await spawnSidecar({
    env: {
      ...postHogTelemetryEnv(sink.url),
      AGENTIC30_TEST_OFFICE_HOURS_PAST_DAY_SNAPSHOT_TURNS_LOAD_FAILURE: "1",
    },
  });
  let socket;
  try {
    await writeElapsedChallengeDay(harness.workspaceRoot);
    socket = await connectAndAwaitReady(harness);
    const events = [];
    socket.on("message", (raw) => events.push(JSON.parse(String(raw))));
    socket.send(JSON.stringify({
      type: "create_session",
      provider: "codex",
      model: "gpt-5.5",
      suppressBootstrapIntake: true,
      officeHoursDay: 1,
    }));
    const created = await waitForEvent(events, (event) =>
      event.type === "session_created" && event.session?.status === "idle",
    );
    socket.send(JSON.stringify({
      type: "office_hours_start",
      sessionId: created.session.id,
      context: "Day 1 Office Hours",
      visiblePrompt: "Snapshot turn-load failure test",
      source: "office_hours_day_1",
      day: 1,
    }));
    const logRequest = await sink.waitFor((request) =>
      Boolean(findLogRecord(request, "sidecar swallowed error", (attributes) =>
        attributes.operation === "office_hours_past_day_snapshot_turns_load"
          && attributes.session_id === created.session.id
          && /snapshot turns load failure/.test(attributes.error_message || ""))),
      10_000,
    );
    const logRecord = findLogRecord(logRequest, "sidecar swallowed error");
    assert.equal(logRecord.record.severityText, "ERROR");
    assert.equal(harness.child.exitCode, null);
  } finally {
    await closeWebSocket(socket);
    await harness.dispose();
    await sink.close();
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
      GH_CONFIG_DIR: path.join(appSupportPath, "gh-config"),
      GH_TOKEN: "",
      GITHUB_TOKEN: "",
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

async function spawnSidecarExpectFailure({ env = {} } = {}) {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-sidecar-resilience-fail-ws-"));
  const appSupportPath = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-sidecar-resilience-fail-app-"));
  const child = spawn(process.execPath, ["sidecar/index.mjs", "--workspace", workspaceRoot], {
    cwd: packageRoot,
    env: {
      ...process.env,
      AGENTIC30_APP_SUPPORT_PATH: appSupportPath,
      AGENTIC30_DISABLE_QMD_BOOTSTRAP: "1",
      AGENTIC30_TEST_STUB_PROVIDER: "1",
      AGENTIC30_DISABLE_CODEX_WARMUP: "1",
      GH_CONFIG_DIR: path.join(appSupportPath, "gh-config"),
      GH_TOKEN: "",
      GITHUB_TOKEN: "",
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += String(chunk);
  });
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });

  const { code, signal } = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch {}
      reject(new Error(`Timed out waiting for sidecar failure. stderr: ${stderr}`));
    }, 10_000);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (exitCode, exitSignal) => {
      clearTimeout(timer);
      resolve({ code: exitCode, signal: exitSignal });
    });
  });

  return {
    code,
    signal,
    stdout,
    stderr,
    appSupportPath,
    workspaceRoot,
    async dispose() {
      await fs.rm(workspaceRoot, { recursive: true, force: true });
      await fs.rm(appSupportPath, { recursive: true, force: true });
    },
  };
}

function postHogTelemetryEnv(host) {
  return {
    POSTHOG_PROJECT_API_KEY: "phc_sidecar_resilience_test",
    POSTHOG_HOST: host,
    AGENTIC30_TELEMETRY_ENVIRONMENT: "production",
    AGENTIC30_BUILD_CONFIGURATION: "release",
    AGENTIC30_INTERNAL_TRAFFIC: "0",
    AGENTIC30_DISABLE_TELEMETRY: "0",
  };
}

async function startTelemetrySink() {
  const requests = [];
  const server = createServer((req, res) => {
    let rawBody = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      rawBody += chunk;
    });
    req.on("end", () => {
      let body = null;
      try {
        body = rawBody ? JSON.parse(rawBody) : null;
      } catch {
        body = null;
      }
      requests.push({
        method: req.method,
        url: req.url,
        headers: req.headers,
        rawBody,
        body,
      });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end("{}");
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  return {
    url: `http://127.0.0.1:${address.port}`,
    requests,
    waitFor(predicate, timeoutMs = 5_000) {
      return waitForEvent(requests, predicate, timeoutMs);
    },
    close() {
      return new Promise((resolve) => server.close(resolve));
    },
  };
}

function findLogRecord(request, message, predicate = () => true) {
  if (request?.url !== "/i/v1/logs") return null;
  const records = request.body?.resourceLogs
    ?.flatMap((resourceLog) => resourceLog.scopeLogs || [])
    ?.flatMap((scopeLog) => scopeLog.logRecords || []) || [];
  for (const record of records) {
    const body = otlpValueToJs(record.body);
    const attributes = otlpAttributesToObject(record.attributes || []);
    if (body === message && predicate(attributes, record)) {
      return { record, attributes };
    }
  }
  return null;
}

function otlpAttributesToObject(attributes = []) {
  const output = {};
  for (const attribute of attributes) {
    output[attribute.key] = otlpValueToJs(attribute.value);
  }
  return output;
}

function otlpValueToJs(value) {
  if (!value || typeof value !== "object") return undefined;
  if (Object.hasOwn(value, "stringValue")) return value.stringValue;
  if (Object.hasOwn(value, "boolValue")) return value.boolValue;
  if (Object.hasOwn(value, "intValue")) return Number(value.intValue);
  if (Object.hasOwn(value, "doubleValue")) return value.doubleValue;
  if (value.arrayValue) {
    return (value.arrayValue.values || []).map(otlpValueToJs);
  }
  if (value.kvlistValue) {
    return otlpAttributesToObject(value.kvlistValue.values || []);
  }
  return undefined;
}

async function writeElapsedChallengeDay(workspaceRoot) {
  const agentic30Dir = path.join(workspaceRoot, ".agentic30");
  await fs.mkdir(agentic30Dir, { recursive: true });
  await fs.writeFile(
    path.join(agentic30Dir, "day-progress.json"),
    JSON.stringify({
      schemaVersion: 1,
      schema: "agentic30.day_progress.v1",
      challengeStartedAt: "2020-01-01",
      days: {},
    }),
  );
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
