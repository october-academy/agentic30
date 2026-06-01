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
    const scanStarted = ws.events.find((event) => event.type === "workspace_scan_started");
    assert.equal(scanStarted?.stage, "local");
    assert.equal(scanStarted?.stepIndex, 1);
    assert.equal(scanStarted?.totalSteps, 3);
    const scanStartedIndex = ws.events.findIndex((event) => event === scanStarted);
    const verifyingIndex = ws.events.findIndex((event) =>
      event.type === "workspace_scan_progress"
        && event.stage === "verifying"
        && event.stepIndex === 2
        && event.totalSteps === 3
        && event.foundCount >= 2
    );
    const composingIndex = ws.events.findIndex((event) =>
      event.type === "workspace_scan_progress"
        && event.stage === "composing"
        && event.stepIndex === 3
        && event.totalSteps === 3
    );
    assert.notEqual(verifyingIndex, -1, "local-only scan should emit structured verifying progress");
    assert.notEqual(composingIndex, -1, "scan_workspace should emit structured composing progress");
    assert.ok(
      scanStartedIndex < verifyingIndex && verifyingIndex < composingIndex,
      "local-only scan progress should move from 1/3 to 2/3 to 3/3",
    );
    assert.equal(
      ws.events.some((event) =>
        event.type === "workspace_scan_progress"
          && event.stage === "composing"
          && event.stepIndex === 3
          && event.totalSteps === 3
      ),
      true,
      "scan_workspace should emit structured composing progress",
    );
    assert.equal(
      ws.events.some((event) =>
        event.type === "workspace_scan_progress"
          && event.stage === "merged"
          && event.stepIndex === 3
          && event.totalSteps === 3
          && event.foundCount >= 2
      ),
      true,
      "scan_workspace should emit structured merged progress with foundCount",
    );
    assert.equal(
      ws.events.some((event) =>
        event.type === "workspace_scan_progress"
          && event.progressText === "frontier 선택지 생성 중"
      ),
      false,
      "background frontier enrichment must not reuse foreground workspace_scan_progress",
    );
    assert.equal(scanResult.day1Context, undefined);
    assert.equal(scanResult.composedOpening, undefined);
    assert.equal(scanResult.day1AlignmentPlan?.schemaVersion, 1);
    assert.equal(scanResult.day1AlignmentPlan?.components?.icp?.title, "고객");
    assert.equal(scanResult.day1AlignmentPlan?.components?.painPoint?.title, "문제");
    assert.equal(scanResult.day1AlignmentPlan?.components?.outcome?.title, "확인할 행동");
    assert.equal(typeof scanResult.day1AlignmentPlan?.qualityGate?.score, "number");
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

test("office_hours_start preserves custom source and ignores duplicate concurrent starts", async () => {
  const harness = await spawnSidecar();
  let ws;
  try {
    ws = await connectAndCollect(harness);

    ws.send(JSON.stringify({
      type: "create_session",
      provider: "codex",
      model: "gpt-5.4-mini",
      suppressBootstrapIntake: true,
    }));
    const created = await waitForEvent(ws.events, (event) =>
      event.type === "session_created" && event.session?.status === "idle",
    );

    const officeHoursStartPayload = {
      type: "office_hours_start",
      sessionId: created.session.id,
      context: "Workspace: Revenue analytics dashboard. ICP: B2B founders. Problem: activation drop-off.",
      visiblePrompt: "Test Office Hours on current project",
      source: "day1_real_project_test",
    };
    ws.send(JSON.stringify(officeHoursStartPayload));
    ws.send(JSON.stringify(officeHoursStartPayload));

    const started = await waitForEvent(ws.events, (event) =>
      event.type === "session_updated"
        && event.session?.id === created.session.id
        && event.session?.runtime?.officeHours?.source === "day1_real_project_test",
    );
    const duplicateError = await waitForEvent(ws.events, (event) =>
      event.type === "error"
        && event.sessionId === created.session.id
        && /waiting for the current run/i.test(event.message || ""),
    );
    assert.equal(started.session.runtime.officeHours.active, true);
    assert.equal(started.session.runtime.officeHours.source, "day1_real_project_test");
    assert.match(started.session.runtime.officeHours.context, /Revenue analytics dashboard/);
    assert.equal(duplicateError.sessionId, created.session.id);
    assert.equal(
      started.session.messages.filter((message) =>
        message.role === "user" && message.content === "Test Office Hours on current project",
      ).length,
      1,
    );

    ws.send(JSON.stringify({ type: "stop_session", sessionId: created.session.id }));
    await waitForEvent(ws.events, (event) =>
      event.type === "session_updated"
        && event.session?.id === created.session.id
        && event.session?.status === "idle",
    );
  } finally {
    ws?.close();
    await harness.close();
  }
});

test("office_hours structured submission keeps question before visible answer", async () => {
  const harness = await spawnSidecar();
  let ws;
  try {
    ws = await connectAndCollect(harness);

    ws.send(JSON.stringify({
      type: "create_session",
      provider: "codex",
      model: "gpt-5.4-mini",
      suppressBootstrapIntake: true,
    }));
    const created = await waitForEvent(ws.events, (event) =>
      event.type === "session_created" && event.session?.status === "idle",
    );

    ws.send(JSON.stringify({
      type: "office_hours_start",
      sessionId: created.session.id,
      context: [
        "Project: agentic30 Mac - native macOS menu bar assistant",
        "Customer: 전업 1인 개발자",
        "Problem: 공개와 판매를 미루며 시간을 반복 낭비함",
      ].join("\n"),
      visiblePrompt: "Office Hours",
      source: "transcript_regression",
    }));

    const awaitingQuestion = await waitForEvent(ws.events, (event) =>
      event.type === "session_updated"
        && event.session?.id === created.session.id
        && event.session?.pendingUserInput?.generation?.mode === "office_hours_fallback",
    );
    const request = awaitingQuestion.session.pendingUserInput;
    const questionText = request.questions[0].question;
    const selectedOption = request.questions[0].options[0].label;
    const freeText = "이번 주 1명에게 유료 파일럿 제안";
    const eventCursor = ws.events.length;

    ws.send(JSON.stringify({
      type: "submit_user_input",
      sessionId: created.session.id,
      requestId: request.requestId,
      responses: [
        {
          question: request.questions[0].question,
          selectedOptions: [selectedOption],
          freeText,
        },
      ],
    }));

    const firstSubmittedUpdate = await waitForEventAfter(ws.events, eventCursor, (event) =>
      event.type === "session_updated"
        && event.session?.id === created.session.id
        && event.session?.pendingUserInput == null
        && event.session?.messages?.some((message) =>
          message.role === "user" && String(message.content || "").includes(freeText)
        ),
    );
    assert.equal(firstSubmittedUpdate.session.status, "running");
    assert.ok(
      firstSubmittedUpdate.session.messages.some((message) =>
        message.role === "assistant"
          && message.state === "streaming"
          && String(message.content || "") === ""
      ),
      "first post-submit update should include a streaming assistant placeholder",
    );

    const replacement = await waitForEventAfter(ws.events, eventCursor, (event) =>
      event.type === "message_replaced"
        && event.sessionId === created.session.id
        && event.state === "streaming",
    );
    assert.equal(replacement.state, "streaming");

    const submitted = await waitForEventAfter(ws.events, eventCursor, (event) =>
      event.type === "session_updated"
        && event.session?.id === created.session.id
        && event.session?.pendingUserInput == null
        && event.session?.messages?.some((message) =>
          message.role === "assistant" && message.content === questionText
        )
        && event.session?.messages?.some((message) =>
          message.role === "user" && String(message.content || "").includes(freeText)
        ),
    );
    const messages = submitted.session.messages;
    const questionIndex = messages.findIndex((message) =>
      message.role === "assistant" && message.content === questionText
    );
    const answerIndex = messages.findIndex((message) =>
      message.role === "user" && String(message.content || "").includes(freeText)
    );

    assert.notEqual(questionIndex, -1);
    assert.notEqual(answerIndex, -1);
    assert.ok(questionIndex < answerIndex);
    assert.equal(
      messages.filter((message) =>
        message.role === "assistant" && message.content === questionText
      ).length,
      1,
    );
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

    const scanResult = await waitForEvent(ws.events, (event) => event.type === "workspace_scan_result");
    assert.equal(scanResult.stage, "failed");
    assert.equal(scanResult.stepIndex, 1);
    assert.equal(scanResult.totalSteps, 3);
    assert.equal(scanResult.foundCount, 0);

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

async function waitForEventAfter(events, startIndex, predicate, timeoutMs = 10_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const found = events.slice(startIndex).find(predicate);
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for event after ${startIndex}. Saw: ${events.slice(startIndex).map((event) => event.type).join(", ")}`);
}
